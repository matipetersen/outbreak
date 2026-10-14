"""Soldiers at the roadside: checkpoints, searches for contraband, tolls, and the ones who can be bought.

A checkpoint is three soldiers standing on a highway.  When you come within sight of one (closer if you
are creeping) and it has not already dealt with you, it stops you and opens an event: submit to the search,
offer a bribe, talk your way through, or draw.  What they take goes into the leader's pockets (an honest
one means to hand it in; a corrupt one sells it on), so killing him gets it back.  Roaming military
patrols make the same spot checks now and then.  Everything is deterministic from the seed.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from outbreak.engine.model import Human, Item, T
from outbreak.engine.fov import has_los
from outbreak.util import cheb

SIGHT = 7                       # a checkpoint stops you from this far...
SNEAK_SIGHT = 3                 # ...or from this far if you are creeping
PASS_TURNS = 500                # once they are done with you they leave you alone for this long
PATROL_EVERY = 300              # a roaming patrol checks you at most this often
CORRUPT_PCT = 38
SHOOT_ON_SIGHT = -50            # military reputation at which checkpoints open fire
BANNED = {"medieval": ("crossbow",)}
MEDS = ("medkit", "suppressant", "painkiller")


@dataclass
class Checkpoint:
    id: int
    x: int
    y: int
    pass_until: int = 0
    hostile: bool = False


def corrupt_of(uid: int) -> bool:
    """Deterministic from the soldier's id, so a chunk painted late gives the same men."""
    return (uid * 7919) % 100 < CORRUPT_PCT


def _store(game) -> dict:
    cps = getattr(game, "checkpoints", None)
    if cps is None:
        cps = game.checkpoints = {}
    return cps


def register(game, cid: int, x: int, y: int) -> Checkpoint:
    cp = Checkpoint(cid, x, y)
    _store(game)[cid] = cp
    return cp


def post_guards(game, lv, cp: Checkpoint, n: int = 3) -> int:
    """Stand ``n`` soldiers round the gate of ``cp``; returns how many were placed."""
    from outbreak.engine.spawn import make_patrol
    placed = 0
    for _ in range(n):
        spot = lv.free_spot_near(cp.x, cp.y, 3)
        if not spot:
            continue
        h = make_patrol(game, "soldier", spot[0], spot[1], 0)
        h.state, h.cp, h.post = "guard", cp.id, spot
        lv.add_actor(h)
        placed += 1
    return placed


def build(game) -> None:
    """Checkpoints on the far roads (the small map gets two; bigger ones get more)."""
    lv, rng, start = game.world.level, game.rng, game.world.start
    roads = [(x, y) for y in range(3, lv.h - 3) for x in range(3, lv.w - 3)
             if lv.tiles[y][x] == T.ROAD and cheb((x, y), start) >= 35]
    if not roads:
        return
    want = 2 + (lv.w * lv.h) // 14000
    chosen: List = []
    for _ in range(60):
        if len(chosen) >= want:
            break
        pos = rng.choice(roads)
        if all(cheb(pos, c) >= 30 for c in chosen):
            chosen.append(pos)
    for i, (x, y) in enumerate(chosen):
        cp = register(game, i + 1, x, y)
        post_guards(game, lv, cp)


# ------------------------------------------------------------------ who is who
def crew(game, h: Human) -> List[Human]:
    return [a for a in game.level.actors if isinstance(a, Human) and a.role == "soldier" and a.hp > 0 and
            ((h.cp and a.cp == h.cp) or (not h.cp and h.group and a.group == h.group))]


def turn_on(game, h: Human) -> None:
    """The whole crew goes for you."""
    for a in crew(game, h) or [h]:
        a.hostile, a.state, a.target = True, "hunt", game.player.pos
        if a.cp:
            cp = _store(game).get(a.cp)
            if cp:
                cp.hostile = True


def rally(game, h: Human) -> None:
    """One soldier of a crew was hit: the others join in."""
    if h.role == "soldier" and (h.cp or h.group):
        turn_on(game, h)


# ------------------------------------------------------------------ contraband
def banned_ids(game) -> set:
    ids = set(BANNED.get(game.era.id, ()))
    if game.era.firearms:
        for d in game.items.values():
            if d.style == "firearm" or (d.kind == "ammo" and d.id not in ("arrow", "shaft")):
                ids.add(d.id)
    for d in game.items.values():
        if d.id in MEDS or d.kind == "throw":
            ids.add(d.id)
    return ids


def contraband(game) -> List[Item]:
    p, ids = game.player, banned_ids(game)
    found = [i for i in p.inventory if i.id in ids and not i.key]
    if p.weapon is not None and p.weapon.id in ids:
        found.append(p.weapon)
    return found


def _names(game, items: List[Item]) -> str:
    return ", ".join(f"{game.item_def(i.id).name.lower()}" + (f" x{i.qty}" if i.qty > 1 else "") for i in items)


def bribe_price(contra: List[Item], sick: bool) -> int:
    return 4 + 2 * len(contra) + (8 if sick else 0)


def _leader(game, h: Human) -> Human:
    return (crew(game, h) or [h])[0]


MAX_TAKEN = 3                    # a checkpoint takes the most valuable few stacks, not your whole kit


def _seize(game, h: Human, contra: List[Item]) -> str:
    p, lead = game.player, _leader(game, h)
    contra = sorted(contra, key=lambda i: (i is p.weapon, -game.item_def(i.id).value * i.qty))[:MAX_TAKEN]
    names = _names(game, contra)
    for it in contra:
        if p.weapon is it:
            p.weapon = None
        else:
            p.take(it.id, it.qty)
        lead.loot.append(Item(it.id, it.qty, it.dur))
    if h.corrupt:
        return f"He takes your {names} and drops it into his own pack, looking past you. It will not be going into any evidence locker."
    return f"A soldier bags your {names} and stamps a slip you are not allowed to keep."


# ------------------------------------------------------------------ the stop
def inspect(game, h: Human, cp_id: int) -> None:
    """Open the checkpoint event, or wave you through if you carry nothing."""
    from outbreak.engine import encounters
    p, rng = game.player, game.rng
    cps = _store(game)
    cp = cps.get(cp_id)
    if cp is None:
        cp = cps[cp_id] = Checkpoint(cp_id, h.x, h.y)
    contra = contraband(game)
    sick = bool(p.infected) and rng.random() < 0.4
    cp.pass_until = game.clock.turn + PASS_TURNS
    who = game.era.factions["military"][0]
    if not contra and not sick:
        if h.corrupt and rng.random() < 0.5:
            price = 3
            data = {"kind": "toll", "contra": [], "sick": False, "price": price, "uid": h.uid, "cp": cp_id}
            text = (f"A {who} soldier steps into the road. 'Papers? Nobody has papers. Road tax, then: {price} "
                    f"{game.era.coin}.' He rubs two fingers together.")
            game.pending_event = encounters.start(game, encounters.BY_ID["mil_checkpoint"], text, data)
            return
        game.msg(f"A {who} soldier looks through your pack and waves you on. 'Move along.'", "lore")
        return
    price = bribe_price(contra, sick)
    data = {"kind": "search", "contra": [(i.id, i.qty) for i in contra], "sick": sick, "price": price, "uid": h.uid, "cp": cp_id}
    text = f"'Halt! {who.capitalize()} checkpoint. Open your pack.' Three rifles cover the road."
    if sick:
        text = f"'Halt! {who.capitalize()} checkpoint.' A soldier stares at your arm. 'Show me that. Slowly.'"
    if h.corrupt:
        text += " The one in charge keeps glancing at your pockets."
    game.pending_event = encounters.start(game, encounters.BY_ID["mil_checkpoint"], text, data)


def resolve(game, active, index: int) -> str:
    """Interpret one of the four choices.  Returns the text; ``"You cannot afford that."`` leaves the event open."""
    p, rng = game.player, game.rng
    d = active.data
    h = next((a for a in game.level.actors if isinstance(a, Human) and a.uid == d["uid"]), None)
    if h is None:                                              # he died or left: nobody to answer to
        active.result, active.resolved = "The soldiers are gone.", True
        return active.result
    kind, sick, price = d["kind"], d["sick"], d["price"]
    contra = [it for it in contraband(game)]
    mil = game.rep.get("military", 0)
    done = lambda txt: _finish(game, active, txt)                                    # noqa: E731
    if index == 3:
        game.rep["military"] = max(-100, mil - 40)
        turn_on(game, h)
        return done("You go for your weapon. 'Contact!' Every rifle on the road turns toward you.")
    if kind == "toll":
        if index == 0:
            if p.coins < price:
                return "You cannot afford that."
            p.coins -= price
            return done("He pockets the coins and nods, almost kindly. 'Safe travels.'")
        chance = 0.5 if index == 1 else 0.3 + max(0, game.player.humanity) / 250
        if rng.random() < chance:
            if index == 1 and p.coins >= price // 2:
                p.coins -= price // 2
                return done("You haggle. He sighs and takes half.")
            return done("He looks at your face for a long moment. 'Go on.'")
        p.coins = max(0, p.coins - price)
        return done("He does not like the haggling. You pay full, and a little more besides.")
    if index == 0:                                                       # submit
        if sick:
            turn_on(game, h)
            return done("They find the bite. 'INFECTED!' The soldiers do not wait for you to explain.")
        return done(_seize(game, h, contra))
    if index == 1:                                                       # bribe
        cost = price * (2 if sick else 1)
        if p.coins < cost:
            return "You cannot afford that."
        accept = (0.75 if sick else 0.9) if h.corrupt else (0.0 if sick else 0.15)
        p.coins -= cost
        if rng.random() < accept:
            game.rep["military"] = max(-100, mil - 2)
            return done(f"The coins vanish. 'Nothing in there I need to see.' He waves you through, eyes elsewhere.")
        game.rep["military"] = max(-100, mil - 10)
        if sick:
            turn_on(game, h)
            return done("'You think you can BUY your way past the sick?' The rifles come up.")
        return done("'Bribing a soldier.' He keeps the coins and takes the rest too. " + _seize(game, h, contra))
    chance = 0.22 + max(0, p.humanity) / 220 + mil / 250 - (0.15 if sick else 0.0)         # talk
    if rng.random() < chance:
        p.gain_xp(5)
        return done("You keep your voice level and your hands open. After a long moment they let you go.")
    if sick:
        turn_on(game, h)
        return done("'Sure you are fine.' The safety clicks off. They have seen this before.")
    return done("It does not work. " + _seize(game, h, contra))


def _finish(game, active, text: str) -> str:
    active.result, active.resolved = text, True
    game.msg(text, "lore")
    return text


# ------------------------------------------------------------------ every turn
def tick(game) -> None:
    if game.pending_event or game.final or game.level is not game.world.level:
        return
    t, p = game.clock.turn, game.player
    if t % 2:
        return
    sight = SNEAK_SIGHT if p.sneaking else SIGHT
    mil = game.rep.get("military", 0)
    cps = _store(game)
    for h in game.level.actors:
        if not isinstance(h, Human) or h.role != "soldier" or h.hostile or h.hp <= 0 or h.stun > 0:
            continue
        if not (h.cp or (h.group and h.state == "patrol")):
            continue
        d = cheb(h.pos, p.pos)
        if d > max(sight, 9 if mil <= SHOOT_ON_SIGHT else 0) or not has_los(game.level, h.pos, p.pos):
            continue
        if mil <= SHOOT_ON_SIGHT:
            game.msg(f"The {h.name.lower()} knows your face. 'That's the one!'", "bad", key=True)
            turn_on(game, h)
            return
        if d > sight:
            continue
        cid = h.cp or -h.group
        cp = cps.get(cid)
        if cp is not None and (cp.hostile or t < cp.pass_until):
            continue
        if h.cp == 0:                                            # a roaming patrol: it does not stop everyone
            if cp is None:
                cp = cps[cid] = Checkpoint(cid, h.x, h.y)
            if game.rng.random() < 0.5:
                cp.pass_until = t + PATROL_EVERY
                continue
        inspect(game, h, cid)
        return
