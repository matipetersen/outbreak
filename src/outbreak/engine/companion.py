"""One companion at a time: someone with a name, a strength, a flaw, a bond with you, and a death that sticks.

Anyone who is not hostile can become your companion (``recruit``).  The profile they get comes from who they are (a healer
is a medic) and from their id.  Strengths and flaws are small, regular effects applied from ``tick``; the bond between you
grows when you spend time together and win, and shrinks when you do things they cannot stand.  When the bond breaks they
leave; when they die, they stay dead, and the log says so.
"""
from __future__ import annotations

import dataclasses
import random
from typing import Optional

from outbreak.content.companions import (ARCHETYPES, BY_ID, ERA_VARIANTS, COMBAT_LINES, FLAWS, NAMES, GEAR_SAY, PERSONAL, PERSONAL_VARIANTS, ROLE_ARCHETYPE,
                                         SITUATION_LINES, STRENGTHS)
from outbreak.engine import tiles as T
from outbreak.engine.model import Human, Item
from outbreak.util import cheb, compass, dist_words

BOND_START_STRANGER = 10
BOND_START_ALLY = 25
BOND_LEAVES = 5
STORY_AT = (35, 60, 85)                       # bond at which each part of their story comes out
SAY_EVERY = (110, 230)
WANDER_NOISE = 6
MEDIC_EVERY, TINKER_EVERY, HUNGRY_EVERY, LOUD_EVERY, CALM_EVERY, SCOUT_EVERY = 60, 60, 160, 25, 8, 4


# ------------------------------------------------------------------ who they are
def person_rng(game, uid: int) -> random.Random:
    return random.Random(f"{game.seed}:person:{uid}")        # their own stream: it never disturbs the world's


def ensure_person(game, h: Human, archetype: Optional[str] = None) -> None:
    """Give someone a personal name and a profile (once), fixed by who they are."""
    if h.trait:
        return
    rng = person_rng(game, h.uid)
    pick = archetype or (ROLE_ARCHETYPE.get(h.role) if h.role in ("healer", "trader", "scholar") or h.uid % 3 else None)
    arch = BY_ID.get(pick) if pick else rng.choice(ARCHETYPES)
    taken = {n for n, _ in getattr(game, "fallen_allies", [])} | {a.name for a in game.world.level.actors if isinstance(a, Human) and a.trait}
    names = [n for n in NAMES if n not in taken] or list(NAMES)
    h.name = rng.choice(names)
    h.trait = arch.id
    h.glyph = h.name[0].upper()
    h.max_hp = h.hp = int(arch.hp * 1.6) + 10          # sturdy enough to stand beside a player who starts at 80
    h.dmg, h.acc = arch.dmg, arch.acc
    if (game.era.firearms or game.era.tech == 0) and arch.id in ("veteran", "hunter"):
        h.reach = 6
        h.mag = h.ammo = 8 if game.era.firearms else 0
    elif h.reach > 1:
        h.reach = 1


_ERA = ["modern"]
_VARIANTS: dict = {}


def set_era(era_id: str) -> None:
    """The age the game is set in: the same archetypes are called, and talk, a little differently."""
    _ERA[0] = era_id


def personal_of(arch_id: str) -> dict:
    """Their errand, worded for the age the game is set in."""
    spec = PERSONAL[arch_id]
    over = PERSONAL_VARIANTS.get((arch_id, _ERA[0]))
    return {**spec, **over} if over else spec


def arch_of(h: Human):
    a = BY_ID.get(h.trait)
    if a is None:
        return None
    over = ERA_VARIANTS.get((a.id, _ERA[0]))
    if not over:
        return a
    key = (a.id, _ERA[0])
    if key not in _VARIANTS:
        _VARIANTS[key] = dataclasses.replace(a, **over)
    return _VARIANTS[key]


def current(game) -> Optional[Human]:
    """The companion, if you have one and they are alive and with you (on the open map)."""
    uid = getattr(game, "companion_uid", 0)
    if not uid:
        return None
    for lv in (game.level, game.world.level):                       # with you in the building, or outside where you left them
        for a in lv.actors:
            if isinstance(a, Human) and a.uid == uid and a.hp > 0 and a.state in ("follow", "wait"):
                return a
    return None


CARRY_RANGE = 20


def carry(game, old, target, dest, from_pos) -> None:
    """Through a door, up a stair, out into the street: whoever is following you comes too."""
    uid = getattr(game, "companion_uid", 0)
    c = next((a for a in old.actors if isinstance(a, Human) and a.uid == uid and a.hp > 0 and a.state == "follow"), None) if uid else None
    if c is None or (old is game.world.level and cheb(c.pos, from_pos) > CARRY_RANGE):
        return                                             # too far behind: they wait out here until you come back
    spot = target.free_spot_near(dest[0], dest[1], 3)
    if spot is None:
        return
    old.remove_actor(c)
    c.x, c.y = spot
    target.add_actor(c)


def say(game, c: Human, text: str) -> None:
    game.msg(f"{c.name}: {text}", "ally")


def note(game, text: str, key: bool = False) -> None:
    game.msg(text, "ally", key=key)


def add_bond(c: Human, n: int) -> None:
    c.bond = max(0, min(100, c.bond + n))


def describe(c: Human) -> str:
    a = arch_of(c)
    if a is None:
        return c.name
    trouble = f"{FLAWS[a.flaw]} (overcome)" if c.tamed else FLAWS[a.flaw]
    return f"{c.name}, {a.label}. Good at it: {STRENGTHS[a.strength]}. Trouble: {trouble}."


def bond_word(c: Human) -> str:
    return ("a stranger", "wary of you", "getting used to you", "a friend", "someone who would die for you")[min(4, c.bond // 22)]


# ------------------------------------------------------------------ joining and leaving
def refusal(game, npc: Human) -> str:
    if npc.hostile:
        return "They would sooner shoot you."
    if game.player.humanity < 20:
        return "They will not follow what you have become."
    if current(game) is not None:
        return "You already travel with someone. Only one can keep up with you."
    if npc.role in ("scout", "soldier"):
        trusted = game.rep.get(npc.faction, 0) >= 15 or game.aided.get(npc.group) is True
        if not trusted:
            return "They do not know you well enough to follow you. Earn their trust: answer a call for help, or do them a favour."
    elif npc.role in ("trader", "healer", "scholar"):
        if game.rep.get("enclave", 0) < 20 and game.player.humanity < 50:
            return "They have a place here, and you have not given them a reason to leave it. Be better known, or better liked."
    return ""


def recruit(game, npc: Human, archetype: Optional[str] = None, bond: int = BOND_START_STRANGER) -> None:
    """Bring ``npc`` into your life.  They may have to be brought out of the building they live in."""
    ensure_person(game, npc, archetype)
    world = game.world.level
    if npc not in world.actors:
        for lv in game.levels.values():
            if npc in lv.actors:
                lv.remove_actor(npc)
        spot = world.free_spot_near(game.player.x, game.player.y, 3) if game.level is world else None
        if spot is None:
            site = next((p for p in game.pois.values() if p.kind == "refuge"), None)
            spot = world.free_spot_near(site.x, site.y + 1, 4) if site else world.free_spot_near(*game.world.start, 4)
        if spot is None:
            return
        npc.x, npc.y = spot
        world.add_actor(npc)
    npc.state, npc.hostile, npc.talked = "follow", False, True
    npc.bond = max(npc.bond, bond)
    npc.since = game.clock.turn
    npc.nextsay = game.clock.turn + 80
    game.companion_uid = npc.uid
    a = arch_of(npc)
    note(game, f"{npc.name} the {a.label} joins you.", key=True)
    say(game, npc, a.intro)
    note(game, f"  Good at it: {STRENGTHS[a.strength]}. Trouble: {FLAWS[a.flaw]}.")


def release(game, c: Human, why: str, state: str = "patrol") -> None:
    return_gear(game, c)
    c.state = state
    game.companion_uid = 0
    if c.group and game.patrol_nodes:
        game.patrol_goals[c.group] = game.rng.choice(game.patrol_nodes)
    note(game, why, key=True)


def dismiss(game, c: Human) -> str:
    release(game, c, f"{c.name} goes their own way.")
    return f"{c.name} nods and goes their own way."


def toggle_wait(game, c: Human) -> str:
    if c.state == "follow":
        c.state = "wait"
        return f"{c.name} stays where they are and keeps watch."
    c.state = "follow"
    return f"{c.name} falls in beside you again."


# ------------------------------------------------------------------ the effects, every turn
# ------------------------------------------------------------------ orders
ORDERS = {                     # id: (label, what it does, how long it holds, line when they obey)
    "engage": ("Engage nearest", "go for the nearest enemy and do not stop until it is down", 40, "\"On it.\""),
    "fallback": ("Fall back", "break off, come back to your side and only defend themselves", 30, "\"Falling back!\""),
    "escape": ("Escape!", "drop everything and run with you, at a sprint, no fighting", 40, "\"Run! Go go go!\""),
    "ranged": ("Fire from a distance", "keep their distance and shoot (needs a ranged weapon)", 60, "\"I have got a clear line. Covering you.\""),
    "guard": ("Stay close", "stick to your shoulder and fight only what comes near you", 60, "\"Right behind you.\""),
}
ORDER_SIGHT = 10


def order_of(h: Human) -> str:
    return h.order if h.order and h.order_until > 0 else ""


def give_order(game, c: Human, kind: str) -> str:
    """Give a standing order.  Returns what they say (or why not)."""
    label, _what, turns, ack = ORDERS[kind]
    foe = min((z for z in game.visible_hostiles() if cheb(z.pos, c.pos) <= ORDER_SIGHT), key=lambda z: cheb(z.pos, c.pos), default=None)
    a, rng = arch_of(c), game.rng
    if c.state == "wait":
        c.state = "follow"
    if kind == "ranged" and c.reach <= 1:
        line = f"{c.name}: \"I have nothing to shoot with. I would only get in their face.\""
        game.msg(line, "ally")
        return line
    if kind == "engage" and foe is None:
        line = f"{c.name}: \"Nothing in sight to go for.\""
        game.msg(line, "ally")
        return line
    if a is not None and not c.tamed:
        if kind == "engage" and a.flaw == "coward" and rng.random() < 0.5:
            line = f"{c.name}: \"I... no. I cannot. Not that.\""
            game.msg(line, "ally")
            add_bond(c, -1)
            return line
        if kind in ("fallback", "escape") and a.flaw == "reckless" and rng.random() < 0.4:
            line = f"{c.name}: \"Not yet! One more!\""
            game.msg(line, "ally")
            return line
    c.order, c.order_until = kind, game.clock.turn + turns
    line = f"{c.name}: {ack}"
    game.msg(line, "ally")
    return line


def end_order(game, c: Human, why: str = "") -> None:
    c.order, c.order_until = "", 0
    if why:
        note(game, f"{c.name}: {why}")


def mirror(game, c: Human) -> None:
    """Your companion does what you do: creeps when you creep, runs when you run."""
    p, t = game.player, game.clock.turn
    calm = c.state == "follow" and t - c.lastfought > 3
    if c.order and game.clock.turn >= c.order_until:
        end_order(game, c, "\"Back to normal, then.\"")
    sneak, sprint = bool(p.sneaking and calm), bool((p.sprinting and calm) or c.order == "escape")
    if c.order in ("fallback", "escape", "engage", "ranged"):
        sneak = False
    if sneak and not c.sneaking and cheb(c.pos, p.pos) <= 8:
        note(game, f"{c.name} drops low and creeps beside you.")
    elif sprint and not c.sprinting and cheb(c.pos, p.pos) <= 8:
        note(game, f"{c.name} breaks into a run after you.")
    c.sneaking, c.sprinting = sneak, sprint


def grow(game, c: Human) -> None:
    """Your companion levels up when you do."""
    p = game.player
    if c.lvl >= p.level:
        return
    n = p.level - c.lvl
    _base(c)
    for _ in range(n):
        c.lvl += 1
        c.max_hp += 3
        c.hp = min(c.max_hp, c.hp + 6)
        c.bdmg = (c.bdmg[0] + (c.lvl % 2), c.bdmg[1] + 1)
        c.bacc = min(90, c.bacc + 2)
    refit(game, c)
    note(game, f"{c.name} grows with you: level {c.lvl}.", key=True)


WARP_DISTANCE = 30


def catch_up(game, c: Human) -> None:
    """Left far behind (out of sight, nothing hunting them): they catch up, out of breath, rather than being lost."""
    p = game.player
    if c.state != "follow" or cheb(c.pos, p.pos) < WARP_DISTANCE:
        return
    if any(cheb(z.pos, c.pos) <= 12 for z in game.level.actors if z.hp > 0 and getattr(z, "state", "") == "hunt" and z is not c):
        return
    lv = game.level
    spot = lv.free_spot_near(p.x - 3, p.y, 3) or lv.free_spot_near(p.x, p.y, 4)
    if spot is None:
        return
    lv.move_actor(c, *spot)
    note(game, f"{c.name} catches up, out of breath. \"You walk fast.\"")


def unstick(game, c: Human) -> None:
    """A companion that cannot find a way through (a dense forest, a rubble field): they work their way round to you."""
    p, lv = game.player, game.level
    spot = next((s for r in (2, 3, 4) for s in [lv.free_spot_near(p.x, p.y, r)] if s and cheb(s, p.pos) >= 1), None)
    if spot is None:
        return
    lv.move_actor(c, *spot)
    note(game, f"{c.name} pushes through the undergrowth to reach you.")


def tick(game) -> None:
    c = current(game)
    if c is not None and c.level_id == game.level.id:
        mirror(game, c)
        grow(game, c)
        catch_up(game, c)
    if c is None or game.level is not game.world.level or arch_of(c) is None:
        return
    t, p, a = game.clock.turn, game.player, arch_of(c)
    near = cheb(c.pos, p.pos) <= 10
    if t % 100 == 0:
        add_bond(c, 1)
    if t % 15 == 0 and c.hp < c.max_hp and not any(True for z in game.visible_hostiles() if cheb(z.pos, c.pos) <= 6):
        c.hp += 1
    if p.humanity < 20:
        release(game, c, f"{c.name} looks at what you have become, and walks away.")
        return
    if c.bond <= BOND_LEAVES:
        say(game, c, "\"I am done. I cannot do this with you.\"")
        release(game, c, f"{c.name} leaves you.")
        return
    if near:
        _strength(game, c, a.strength, t)
        _flaw(game, c, a.flaw, t)
    _chatter(game, c, t)
    _watch(game, c, t)
    if t % 5 == 0:
        if c.quest == 0 and c.bond >= QUEST_BOND and not game.pending_event and not game.visible_hostiles():
            offer_personal(game, c)
        personal_tick(game, c)


def _strength(game, c: Human, s: str, t: int) -> None:
    p = game.player
    if s == "medic" and t >= c.nextfx and cheb(c.pos, p.pos) <= 6 and (p.hp < p.max_hp * 0.6 or p.bleeding):
        c.nextfx = t + MEDIC_EVERY
        p.hp = min(p.max_hp, p.hp + 8)
        p.bleeding = 0
        add_bond(c, 1)
        say(game, c, "\"Hold still.\"")
        note(game, f"{c.name} dresses your wounds. (+8)")
    elif s == "calm" and t % CALM_EVERY == 0 and p.panic > 20:
        game.add_panic(-3, raw=True)
    elif s == "tinker" and t % TINKER_EVERY == 0 and p.weapon is not None and p.weapon.dur is not None:
        d = game.item_def(p.weapon.id)
        if d.durability and p.weapon.dur < d.durability:
            p.weapon.dur = min(d.durability, p.weapon.dur + 2)
            if t % (TINKER_EVERY * 3) == 0:
                say(game, c, "\"Your grip was loose. Better now.\"")
    elif s == "scout" and t % SCOUT_EVERY == 0:
        _spot(game, c)


def _spot(game, c: Human) -> None:
    """A scout sees what lies in wait before you walk into it."""
    lv = game.level
    for h in lv.actors:
        if isinstance(h, Human) and h.hidden and cheb(h.pos, c.pos) <= 8:
            h.hidden = False
            h.state = "idle"
            say(game, c, "\"Down! There, in the cover. They are waiting for us.\"")
            note(game, f"{c.name} spots an ambush.")
            add_bond(c, 2)
            return
    for pos, hz in lv.hazards.items():
        if hz.kind == "snare" and hz.hidden and cheb(pos, c.pos) <= 6:
            hz.hidden = False
            say(game, c, "\"Wire. Do not step there.\"")
            return


def _flaw(game, c: Human, f: str, t: int) -> None:
    if c.tamed:                                                      # they have made their peace with it
        return
    p = game.player
    if f == "loud" and t % LOUD_EVERY == 0 and game.rng.random() < 0.3:
        game.emit_noise(c.pos, WANDER_NOISE, "player")
        note(game, f"{c.name} knocks something over. That was loud.")
    elif f == "hungry" and t >= c.nextfx2 and t - c.since >= HUNGRY_EVERY:
        c.nextfx2 = t + HUNGRY_EVERY
        food = next((i for i in p.inventory if game.item_def(i.id).kind == "food"), None)
        if food is not None:
            p.take(food.id, 1)
            note(game, f"{c.name} takes {game.item_def(food.id).name.lower()} from your pack without asking.")
        else:
            add_bond(c, -2)
            say(game, c, "\"I have not eaten in a day. Are we going to do something about that?\"")


def _chatter(game, c: Human, t: int) -> None:
    if t < c.nextsay or game.visible_hostiles():
        return
    rng = game.rng
    c.nextsay = t + rng.randint(*SAY_EVERY)
    p, a = game.player, arch_of(c)
    pool = []
    if p.hp < p.max_hp * 0.4:
        pool += SITUATION_LINES["hurt"]
    if game.is_dark():
        pool += SITUATION_LINES["night"]
    if game.weather in SITUATION_LINES and game.weather != "clear":
        pool += SITUATION_LINES[game.weather]
    from outbreak.engine import wild
    if wild.forest_here(game):
        pool += SITUATION_LINES["forest"]
    if getattr(game.cfg, "needs", False) and p.hunger > 60:
        pool += SITUATION_LINES["hungry"]
    pool += list(a.idle) * 2
    say(game, c, rng.choice(pool))


def _watch(game, c: Human, t: int) -> None:
    """Warn of what they see before you do."""
    if t % 6 or t < c.nextwarn:
        return
    for z in game.level.actors:
        if z.hp > 0 and getattr(z, "special", None) and cheb(z.pos, c.pos) <= 9 and z.pos not in game.visible \
                and z.state not in ("dormant",):
            c.nextwarn = t + 60
            say(game, c, f"\"{compass(z.x - c.x, z.y - c.y).capitalize()}! Something is moving.\"")
            return


# ------------------------------------------------------------------ moments
def on_enter(game, target) -> None:
    c = current(game)
    if c is None or arch_of(c) is None:
        return
    poi = game.poi_of_level(target)
    _place_keepsake(game, target)
    if poi is not None and poi.kind == "cave":
        say(game, c, SITUATION_LINES["cave"][0])
    elif c.level_id == target.id:
        say(game, c, "\"Stay close. I have got your back.\"")
    else:
        say(game, c, "\"I will keep watch out here.\"")
    add_bond(c, 0)


def on_return(game) -> None:
    """You come out of a building: whoever waited outside has been busy."""
    c = current(game)
    if c is None or arch_of(c) is None:
        return
    s = arch_of(c).strength
    rng = game.rng
    if s in ("scavenger", "lucky") and rng.random() < (0.45 if s == "scavenger" else 0.35):
        item = rng.choice(["scrap", "cloth", "wood", "food", "bandage"] + (["chem"] if s == "lucky" else []))
        if item in game.items:
            game.give_item(Item(item, rng.randint(1, 2)))
            say(game, c, f"\"Picked this up on the way out. {game.item_def(item).name}. You are welcome.\"")
            add_bond(c, 1)
            if s == "lucky" and rng.random() < 0.5:
                game.player.coins += rng.randint(1, 4)
    elif rng.random() < 0.3:
        say(game, c, "\"Nothing out here. Good. Let us keep it that way.\"")


def on_ally_kill(game, c: Human, victim) -> None:
    c.kills += 1
    add_bond(c, 1)
    a = arch_of(c)
    if a and game.rng.random() < 0.35:
        say(game, c, game.rng.choice(a.kill))


def on_player_kills_human(game, victim: Human) -> None:
    """You killed a person who was not trying to kill you: it is not forgotten."""
    c = current(game)
    if c is None or arch_of(c) is None or victim is c:
        return
    if victim.hostile:
        return
    a = arch_of(c)
    if a.flaw == "pacifist":
        add_bond(c, -15)
        say(game, c, "\"No. No, no. That was a person.\"")
    else:
        add_bond(c, -4)
        say(game, c, "\"Did they have to die?\"")


def on_hurt(game, c: Human) -> None:
    a = arch_of(c)
    if a and game.rng.random() < 0.3:
        say(game, c, game.rng.choice(a.hurt))


def on_death(game, h: Human, killer=None) -> None:
    if h.uid != getattr(game, "companion_uid", 0):
        return
    a = arch_of(h)
    drop_gear(game, h)
    days = max(0, (game.clock.turn - h.since) // 240)
    by = f" at the hands of {killer.name.lower()}" if killer is not None and not isinstance(killer, str) else ""
    note(game, f"{h.name} is dead{by}. {days} day{'s' if days != 1 else ''} together, {h.kills} kill{'s' if h.kills != 1 else ''}. "
               f"Gone for good.", key=True)
    if a:
        note(game, f"You remember what {h.name} said: {a.farewell}")
    fallen = getattr(game, "fallen_allies", None)
    if fallen is None:
        fallen = game.fallen_allies = []
    fallen.append((h.name, f"{a.label if a else 'survivor'}, {days}d, {h.kills} kills"))
    game.companion_uid = 0
    game.add_panic(12 + h.bond / 5, raw=True)
    from outbreak.engine import director, memory
    memory.on_ally_death(game, h.name, a.label if a else "survivor", a.farewell if a else "...", h.pos)
    director.mourn(game)
    if h.bond >= 50:
        game.adjust_humanity(-3, "")


# ------------------------------------------------------------------ talking
def talk(game, c: Human) -> str:
    a = arch_of(c)
    t = game.clock.turn
    if c.story < 3 and c.bond >= STORY_AT[c.story]:
        line = a.backstory[c.story]
        c.story += 1
        reward = _reward(game, c)
        say(game, c, line)
        return f"{c.name}: {line}\n{reward}"
    line = game.rng.choice(list(a.idle) + [l for l in SITUATION_LINES["night" if game.is_dark() else "warning"]][:1])
    if t - c.lasttalk > 200:
        add_bond(c, 1)
    c.lasttalk = t
    game._spend(1)
    return f"{c.name}: {line}"


def _reward(game, c: Human) -> str:
    n = c.story
    if n == 1:
        add_bond(c, 2)
        if game.reveal_random_lead():
            return f"{c.name} shares something they know: a lead is on your map."
        return f"{c.name} seems lighter for having said it."
    if n == 2:
        game.give_item(Item("medkit" if "medkit" in game.items else "bandage", 1))
        add_bond(c, 2)
        return f"{c.name} hands you a medkit they had been saving."
    c.max_hp += 6
    c.hp = c.max_hp
    game.player.max_hp += 3
    game.player.hp = min(game.player.max_hp, game.player.hp + 3)
    return f"You would trust {c.name} with your life. Something in you steadies. (+3 max health; {c.name} +6)"


def give(game, c: Human, index: int) -> str:
    p = game.player
    if not 0 <= index < len(p.inventory):
        return ""
    it = p.inventory[index]
    d = game.item_def(it.id)
    if d.kind == "food":
        p.take(it.id, 1)
        add_bond(c, 4)
        c.nextfx2 = game.clock.turn + HUNGRY_EVERY
        say(game, c, "\"Thank you. I mean it.\"")
        return f"{c.name} eats gratefully."
    if d.kind == "med":
        if c.hp >= c.max_hp:
            return f"{c.name} is not hurt."
        p.take(it.id, 1)
        c.hp = min(c.max_hp, c.hp + int(d.effect.get("heal", 6)))
        add_bond(c, 3)
        say(game, c, "\"You did not have to.\"")
        return f"You patch {c.name} up."
    return f"{c.name} has no use for the {d.name.lower()}."


# ------------------------------------------------------------------ gear
GEAR_AMMO_MAX = 40


def _base(c: Human) -> None:
    if c.bdmg == (0, 0):
        c.bdmg, c.bacc, c.breach = c.dmg, c.acc, c.reach


def refit(game, c: Human) -> None:
    """Their fighting stats from who they are and what they carry."""
    _base(c)
    w = game.item_def(c.gear_weapon.id) if c.gear_weapon is not None else None
    if w is None:
        c.dmg, c.acc, c.reach = c.bdmg, c.bacc, c.breach
        return
    c.dmg = (w.dmg[0] + c.bdmg[0] // 2, w.dmg[1] + c.bdmg[1] // 2)
    c.acc = min(92, c.bacc + w.accuracy + 6)
    c.reach = min(8, w.reach) if w.is_ranged and (not w.ammo or c.gear_ammo > 0) else 1


def _hand_back(game, item) -> None:
    p = game.player
    d = game.item_def(item.id)
    if not p.add_item(item, d.stackable):
        game.level.drop(p.pos, item)


def gear_lines(game, c: Human) -> list:
    out = []
    if c.gear_weapon is not None:
        w = game.item_def(c.gear_weapon.id)
        out.append(f"Carries: {w.name.lower()}" + (f", {c.gear_ammo} {game.item_def(w.ammo).name.lower()}" if w.ammo else ""))
    if c.gear_armor is not None:
        out.append(f"Wears: {game.item_def(c.gear_armor.id).name.lower()}")
    return out


def equip(game, c: Human, index: int) -> str:
    """Hand them a weapon or armour from your pack, or ammunition for the weapon they carry."""
    p = game.player
    if not 0 <= index < len(p.inventory):
        return ""
    it = p.inventory[index]
    d = game.item_def(it.id)
    a, rng = arch_of(c), game.rng
    if d.kind == "weapon":
        if a is not None and a.flaw == "pacifist" and not c.tamed:
            return f"{c.name} shakes their head. \"I will not carry that.\""
        old = c.gear_weapon
        p.inventory.pop(index)
        if old is not None:
            _hand_back(game, old)
            if c.gear_ammo and game.item_def(old.id).ammo:
                _hand_back(game, Item(game.item_def(old.id).ammo, c.gear_ammo))
            c.gear_ammo = 0
        c.gear_weapon = it
        refit(game, c)
        pool = GEAR_SAY["reckless_weapon"] if (a is not None and a.flaw == "reckless") else GEAR_SAY["weapon"]
        say(game, c, rng.choice(pool))
        add_bond(c, 2)
        extra = f" It needs {game.item_def(d.ammo).name.lower()}: hand some over." if d.ammo else ""
        return f"{c.name} takes the {d.name.lower()}.{extra}"
    if d.kind == "armor":
        old = c.gear_armor
        p.inventory.pop(index)
        if old is not None:
            _hand_back(game, old)
        c.gear_armor = it
        pool = GEAR_SAY["coward_armor"] if (a is not None and a.flaw == "coward") else GEAR_SAY["armor"]
        say(game, c, rng.choice(pool))
        add_bond(c, 2)
        return f"{c.name} puts on the {d.name.lower()}."
    if d.kind == "ammo":
        w = game.item_def(c.gear_weapon.id) if c.gear_weapon is not None else None
        if w is None or w.ammo != it.id:
            return f"{c.name} has nothing that uses {d.name.lower()}."
        n = min(it.qty, GEAR_AMMO_MAX - c.gear_ammo)
        if n <= 0:
            return f"{c.name} is carrying all they can."
        p.take(it.id, n)
        c.gear_ammo += n
        refit(game, c)
        say(game, c, rng.choice(GEAR_SAY["ammo"]))
        add_bond(c, 1)
        return f"{c.name} takes {n} {d.name.lower()}."
    return f"{c.name} has no use for the {d.name.lower()}."


def unequip(game, c: Human, slot: str) -> str:
    """Take it back."""
    if slot == "weapon" and c.gear_weapon is not None:
        w = game.item_def(c.gear_weapon.id)
        _hand_back(game, c.gear_weapon)
        if c.gear_ammo and w.ammo:
            _hand_back(game, Item(w.ammo, c.gear_ammo))
        c.gear_weapon, c.gear_ammo = None, 0
        refit(game, c)
        return f"You take the {w.name.lower()} back."
    if slot == "armor" and c.gear_armor is not None:
        d = game.item_def(c.gear_armor.id)
        _hand_back(game, c.gear_armor)
        c.gear_armor = None
        return f"You take the {d.name.lower()} back."
    return ""


def return_gear(game, c: Human) -> None:
    """They go their own way: what you gave them comes back to you."""
    unequip(game, c, "weapon")
    unequip(game, c, "armor")


def drop_gear(game, c: Human) -> None:
    """They fall: what they carried is left where they fell."""
    lv = game.level
    if c.gear_weapon is not None:
        lv.drop(c.pos, c.gear_weapon)
        w = game.item_def(c.gear_weapon.id)
        if c.gear_ammo and w.ammo:
            lv.drop(c.pos, Item(w.ammo, c.gear_ammo))
    if c.gear_armor is not None:
        lv.drop(c.pos, c.gear_armor)
    c.gear_weapon = c.gear_armor = None
    c.gear_ammo = 0


def use_ammo(game, c: Human) -> None:
    """One shot fired from what you handed them; when it runs out they fall back to melee."""
    if c.gear_weapon is None or not game.item_def(c.gear_weapon.id).ammo:
        return
    c.gear_ammo = max(0, c.gear_ammo - 1)
    if c.gear_ammo == 0:
        refit(game, c)
        say(game, c, "\"I am out! Hand me more, or I am swinging.\"")


def advice(game) -> str:
    """Their read on what to do next, in their own voice."""
    c = current(game)
    p = game.player
    todo = next((text for text, done in game.objectives() if not done), None)
    bits = []
    if p.hp < p.max_hp * 0.5:
        bits.append("You are hurt: patch yourself up first.")
    if getattr(game.cfg, "needs", False) and p.hunger > 60:
        bits.append("You need to eat.")
    if todo:
        bits.append(f"What we came for: {todo}.")
    site = game.pois.get(game.final_site_id)
    if site is not None and site.revealed:
        bits.append(f"{site.name} is {compass(site.x - p.x, site.y - p.y)}, {dist_words(game.era.id, cheb(site.pos, p.pos))}.")
    lead = next((q for q in game.pois.values() if q.lead and not q.done and q.component), None)
    if lead is not None:
        bits.append(f"A lead: {lead.name}, {compass(lead.x - p.x, lead.y - p.y)}, {dist_words(game.era.id, cheb(lead.pos, p.pos))}.")
    return f"{c.name}: " + " ".join(bits or ["Keep moving and keep quiet."])


# ------------------------------------------------------------------ in a fight
LEASH = 6                      # a companion fights within this many tiles of you, not further
LEASH_RECKLESS = 12
LEASH_TIDE = 3                 # while the opening tide is on, they stay at your shoulder
GRACE_TURNS = 480              # the first two days: the dead go for you first, and what they do to your people is halved
GRACE_DAMAGE = 0.4
FIGHT_SAY_EVERY = 40


def early_grace(game) -> bool:
    """The opening: a new companion has not had time to be good at this, so the world goes easy on them."""
    ring = getattr(game, "ring", None)
    return game.clock.turn < GRACE_TURNS or bool(ring is not None and ring.active)


def leash(h: Human, game=None) -> int:
    if order_of(h) == "guard":
        return 2
    if order_of(h) in ("engage", "ranged"):
        return 30
    if game is not None and getattr(game, "ring", None) is not None and game.ring.active:
        return LEASH_TIDE
    return LEASH_RECKLESS if is_reckless(h) else LEASH


def should_hold_back(game, h: Human, foe) -> bool:
    """When you run, they run with you: a foe that is not on top of them is no reason to leave you."""
    return cheb(h.pos, game.player.pos) > leash(h, game) and cheb(h.pos, foe.pos) > 1


def _shout(game, h: Human, kind: str, field_name: str, every: int) -> None:
    t = game.clock.turn
    if t < getattr(h, field_name):
        return
    setattr(h, field_name, t + every)
    say(game, h, game.rng.choice(COMBAT_LINES[kind]))


def on_fight(game, h: Human, foe) -> None:
    """They throw themselves in: say so (not every swing)."""
    if arch_of(h) is not None and h.state in ("follow", "wait"):
        _shout(game, h, "engage", "nextfight", FIGHT_SAY_EVERY)


def on_regroup(game, h: Human) -> None:
    """You are running and they are being left behind."""
    if arch_of(h) is not None:
        _shout(game, h, "regroup", "nextcall", FIGHT_SAY_EVERY)


def on_flee(game, h: Human) -> None:
    if arch_of(h) is not None:
        _shout(game, h, "flee", "nextcall", FIGHT_SAY_EVERY)


def on_player_hurt(game, amount: int) -> None:
    c = current(game)
    if c is not None and arch_of(c) is not None and amount >= 3 and cheb(c.pos, game.player.pos) <= 8:
        _shout(game, c, "player_hurt", "nextfight", 25)


# ------------------------------------------------------------------ the AI's questions
def flee_below(h: Human) -> float:
    a = arch_of(h)
    return 0.6 if a and a.flaw == "coward" and not h.tamed else 0.3


def refuses_to_fight(h: Human, foe) -> bool:
    a = arch_of(h)
    return bool(a and a.flaw == "pacifist" and not h.tamed and isinstance(foe, Human))


def is_reckless(h: Human) -> bool:
    a = arch_of(h)
    return bool(a and a.flaw == "reckless" and not h.tamed)


# ------------------------------------------------------------------ the start
def spawn_start(game) -> None:
    """You do not begin alone: someone is already with you."""
    rng = random.Random(f"{game.seed}:companion")
    arch = rng.choice(ARCHETYPES)
    lv, p = game.world.level, game.player
    spot = lv.free_spot_near(p.x, p.y, 3)
    if spot is None:
        return
    h = Human(game.next_uid(), "Survivor", "S", spot[0], spot[1], 30, 30, role="survivor", faction="enclave", hostile=False,
              state="follow")
    ensure_person(game, h, arch.id)
    lv.add_actor(h)
    h.bond, h.since, h.nextsay = BOND_START_ALLY, 0, 90
    game.companion_uid = h.uid
    a = arch_of(h)
    note(game, f"{h.name} the {a.label} is with you.", key=True)
    say(game, h, a.intro)
    note(game, f"  Good at it: {STRENGTHS[a.strength]}. Trouble: {FLAWS[a.flaw]}.")


def offer_stranger(game, chance: float) -> None:
    """Someone you helped asks to come along (if you travel alone), or thanks you and goes."""
    if game.rng.random() >= chance:
        return
    lv, p = game.world.level, game.player
    if game.level is not lv or current(game) is not None:
        return
    spot = lv.free_spot_near(p.x, p.y, 3)
    if spot is None:
        return
    h = Human(game.next_uid(), "Survivor", "S", spot[0], spot[1], 30, 30, role="survivor", faction="enclave", hostile=False,
              state="follow")
    lv.add_actor(h)
    recruit(game, h, None, bond=15)


# ------------------------------------------------------------------ their one personal errand
QUEST_BOND = 60
QUEST_RANGE = 70
SCENE_RANGE = 3


def quest_poi(game):
    q = getattr(game, "personal", None)
    return game.pois.get(q["poi"]) if q else None


def offer_personal(game, c: Human) -> bool:
    """At a bond of 60 they ask you for one thing: go to a place that was theirs and bring back what is left of it."""
    a = arch_of(c)
    if a is None or c.quest or c.bond < QUEST_BOND or getattr(game, "personal", None):
        return False
    spec = personal_of(a.id)
    p = game.player
    pool = [q for q in game.pois.values() if q.kind == spec["kind"] and not q.visited and cheb(q.pos, p.pos) <= QUEST_RANGE]
    if not pool:
        pool = [q for q in game.pois.values() if q.kind not in ("breach", "refuge", "pad", "cave") and not q.visited
                and cheb(q.pos, p.pos) <= QUEST_RANGE]
    if not pool:
        c.quest = 3                                                    # nothing left to go back to
        return False
    poi = min(pool, key=lambda q: cheb(q.pos, p.pos))
    poi.revealed = True
    c.quest = 1
    game.personal = {"uid": c.uid, "poi": poi.id, "stage": 1}
    say(game, c, spec["ask"])
    game.msg(f"{c.name} asks you for one thing: {poi.name}, {compass(poi.x - p.x, poi.y - p.y)}, {dist_words(game.era.id, cheb(poi.pos, p.pos))}. "
             f"It is marked on your map.", "obj", key=True)
    return True


def personal_objective(game):
    """The errand as an objective line: (text, done), or None."""
    q = getattr(game, "personal", None)
    c = current(game)
    if not q or c is None or c.uid != q["uid"] or c.quest in (0, 3):
        return None
    poi = game.pois.get(q["poi"])
    what = "bring it back to them" if c.quest == 2 else f"find what is left at {poi.name}"
    return (f"{c.name}'s errand: {what}", False)


def _place_keepsake(game, target) -> None:
    """The first time you step into the place, what they asked for is there."""
    q = getattr(game, "personal", None)
    poi = game.poi_of_level(target)
    if not q or poi is None or poi.id != q["poi"] or q["stage"] != 1:
        return
    rng = game.rng
    # the last floor, if there are several: that is where things end up
    if poi.floors > 1 and not target.id.endswith(f":{poi.floors - 1}"):
        return
    item = Item("keepsake", 1)
    item.key = True
    crates = list(target.containers.values())
    if crates:
        rng.choice(crates).loot.append(item)
    else:
        spot = target.free_spot_near(target.entry[0], target.entry[1], 4)
        if spot:
            target.drop(spot, item)
    q["stage"] = 1.5
    game.msg("Somewhere in here is what they asked you for.", "obj")


def personal_tick(game, c: Human) -> None:
    q = getattr(game, "personal", None)
    if not q or q["uid"] != c.uid:
        return
    p = game.player
    if c.quest == 1 and p.count("keepsake") > 0:
        c.quest, q["stage"] = 2, 2
        game.msg(f"You have it. Take it back to {c.name}.", "obj", key=True)
    if c.quest == 2 and game.level is game.world.level and cheb(c.pos, p.pos) <= SCENE_RANGE and not game.pending_event \
            and not game.visible_hostiles():
        from outbreak.engine import encounters
        a = arch_of(c)
        spec = personal_of(a.id)
        text = f"{c.name} sees what you are carrying. {spec['found']} {spec['scene']}"
        game.pending_event = encounters.start(game, encounters.BY_ID["story_personal"], text, {"uid": c.uid})


def resolve_personal(game, active, index: int) -> str:
    c = next((a for a in game.world.level.actors if isinstance(a, Human) and a.uid == active.data.get("uid")), None)
    if c is None or arch_of(c) is None:
        active.result, active.resolved = "They are gone.", True
        return active.result
    a, spec, p = arch_of(c), personal_of(arch_of(c).id), game.player
    p.take("keepsake", 1)
    c.quest = 3
    game.personal = None
    if index == 0:                                                       # give it back
        add_bond(c, 20)
        c.tamed = True
        _boon(game, c)
        game.adjust_humanity(4, "")
        text = f"{spec['give']}\n{c.name} has overcome something: {spec['boon']}"
    elif index == 1:                                                     # keep it
        add_bond(c, -25)
        game.adjust_humanity(-6, "")
        p.coins += 6
        text = f"{spec['keep']}"
    else:                                                                # read it together
        add_bond(c, 10)
        game.adjust_humanity(2, "")
        game.add_panic(-15, raw=True)
        c.story = 3
        text = f"{spec['read']}"
    active.result, active.resolved = text, True
    game.msg(text, "ally", key=True)
    return text


def _boon(game, c: Human) -> None:
    a = arch_of(c)
    if a.flaw == "frail":
        c.max_hp += 12
        c.hp = c.max_hp
    elif a.flaw == "reckless":
        c.max_hp += 8
        c.hp = c.max_hp
