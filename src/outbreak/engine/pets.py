"""Pets: strays you can win over with food, and what they do for you once they are yours.

Strays (a dog, a cat, a crow, a fox) live out in the world.  They are curious, not tame: they come close and keep their
distance until you offer them food while standing next to them.  One pet travels with you at a time, alongside your human
companion.  Each has a strength and a flaw, needs feeding now and then, waits outside when you go indoors, and when it dies
it stays dead.  Zombies will go for it.
"""
from __future__ import annotations

import random
from typing import Optional

from outbreak.content.pets import BY_SPECIES, PET_NAMES, PETS
from outbreak.engine import tiles as T
from outbreak.engine.fov import has_los
from outbreak.engine.model import Animal, Item, Zombie
from outbreak.engine.pathing import greedy_step
from outbreak.util import DIRS8, cheb, compass

HUNGRY_AFTER = 500            # turns without food before it is hungry
STARVING_AFTER = 900          # ...and before the bond starts to fray
CURIOUS_RANGE = 9
GIFT_EVERY = 400
CALM_EVERY = 6
WARN_EVERY = 6
SCRAPS_EVERY = 500
ALLOWED = (T.GRASS, T.BRUSH, T.ROAD, T.FLOOR)


def spec_of(a: Animal):
    return BY_SPECIES.get(a.species)


def is_pet_species(a) -> bool:
    return isinstance(a, Animal) and a.species in BY_SPECIES


# ------------------------------------------------------------------ strays
def make_stray(game, species: str, x: int, y: int) -> Animal:
    sp = BY_SPECIES[species]
    a = Animal(uid=game.next_uid(), name=species.capitalize(), glyph=sp.glyph, x=x, y=y, hp=sp.hp, max_hp=sp.hp,
               species=species, state="graze", stray=True, dmg=sp.dmg, acc=sp.acc)
    return a


def populate(game) -> None:
    """A few strays about the map: dogs and cats near the buildings, crows and foxes out in the woods."""
    lv, rng, start = game.world.level, game.rng, game.world.start
    near_houses = [(p.x, p.y + 2) for p in game.pois.values() if p.kind not in ("breach", "cave")]
    wild_spots = [(x, y) for y in range(3, lv.h - 3) for x in range(3, lv.w - 3)
                  if lv.tiles[y][x] in (T.GRASS, T.BRUSH) and cheb((x, y), start) >= 14]
    per = max(1, (lv.w * lv.h) // 4500)
    for species in ("dog", "cat", "crow", "fox"):
        for _ in range(per):
            pool = near_houses if species in ("dog", "cat") and near_houses else wild_spots
            if not pool:
                continue
            x, y = rng.choice(pool)
            spot = lv.free_spot_near(x, y, 3)
            if spot and cheb(spot, start) >= 10 and lv.tile(*spot) in ALLOWED:
                lv.add_actor(make_stray(game, species, spot[0], spot[1]))


def stray_beat(game) -> None:
    """The Director's gift in the middle of the road: a stray that follows you at a distance, waiting to be fed."""
    lv, p = game.world.level, game.player
    if current(game) is not None or game.level is not lv:
        return
    species = game.rng.choice(("dog", "cat", "crow", "fox"))
    for _ in range(30):
        x, y = p.x + game.rng.randint(-14, 14), p.y + game.rng.randint(-14, 14)
        if 8 <= cheb((x, y), p.pos) and lv.in_bounds(x, y) and lv.free(x, y) and lv.tile(x, y) in ALLOWED:
            lv.add_actor(make_stray(game, species, x, y))
            game.msg(f"A stray {species} has been keeping its distance from you for a while. It is watching your pack.", "dir")
            return


# ------------------------------------------------------------------ yours
def current(game) -> Optional[Animal]:
    uid = getattr(game, "pet_uid", 0)
    if not uid:
        return None
    for a in game.world.level.actors:
        if isinstance(a, Animal) and a.uid == uid and a.pet and a.hp > 0:
            return a
    return None


def say(game, a: Animal, text: str) -> None:
    game.msg(f"{a.name} {text}", "ally")


def note(game, text: str, key: bool = False) -> None:
    game.msg(text, "ally", key=key)


def add_bond(a: Animal, n: int) -> None:
    a.bond = max(0, min(100, a.bond + n))


def describe(a: Animal) -> str:
    sp = spec_of(a)
    return f"{a.name}, a {sp.label}. Good at it: {sp.strength}. Trouble: {sp.flaw}."


def hunger_of(game, a: Animal) -> str:
    waited = game.clock.turn - a.fed
    return "starving" if waited > STARVING_AFTER else "hungry" if waited > HUNGRY_AFTER else "fed"


def can_befriend(game, a: Animal) -> str:
    if not a.stray or not is_pet_species(a):
        return "It is not interested."
    if current(game) is not None:
        return f"You already have {current(game).name}. One is plenty to feed."
    if not any(game.item_def(i.id).kind == "food" for i in game.player.inventory):
        return f"The {a.species} watches your hands. Bring it something to eat."
    return ""


def befriend(game, a: Animal, sure: bool = False) -> str:
    """Offer the stray food.  It may take it, and you."""
    why = can_befriend(game, a)
    if why:
        return why
    p, rng = game.player, game.rng
    food = next(i for i in p.inventory if game.item_def(i.id).kind == "food")
    p.take(food.id, 1)
    chance = BY_SPECIES[a.species].accept + (0.15 if p.sneaking else 0.0) + (0.1 if p.humanity >= 60 else 0.0)
    if not sure and rng.random() >= chance:
        a.state, a.alert = "flee", True
        return f"The {a.species} snatches the food and bolts. Maybe next time."
    rng2 = random.Random(f"{game.seed}:pet:{a.uid}")
    a.name = rng2.choice(PET_NAMES)
    a.pet, a.stray, a.state = True, False, "follow"
    a.bond, a.fed, a.since, a.nextfx = 20, game.clock.turn, game.clock.turn, game.clock.turn + GIFT_EVERY
    game.pet_uid = a.uid
    note(game, f"{a.name} the {a.species} is yours now. {BY_SPECIES[a.species].intro}", key=True)
    return f"{a.name} the {a.species} is yours now."


def offer_pet(game, chance: float) -> None:
    """A road event: a stray comes to you, if you have no pet."""
    if game.rng.random() >= chance or current(game) is not None:
        return
    lv, p = game.world.level, game.player
    if game.level is not lv:
        return
    spot = lv.free_spot_near(p.x, p.y, 3)
    if spot is None:
        return
    a = make_stray(game, game.rng.choice(("dog", "cat", "crow", "fox")), spot[0], spot[1])
    lv.add_actor(a)
    a.stray = True
    if not any(game.item_def(i.id).kind == "food" for i in game.player.inventory):
        game.give_item(Item("food", 1))
    befriend(game, a, sure=True)                                           # it is already half yours


def pet_it(game, a: Animal) -> str:
    sp = spec_of(a)
    t = game.clock.turn
    if t - a.lasttalk > 100:
        add_bond(a, 1)
    a.lasttalk = t
    game._spend(1)
    return f"{a.name} {game.rng.choice(sp.idle)}"


def feed(game, a: Animal, index: int) -> str:
    p = game.player
    if not 0 <= index < len(p.inventory):
        return ""
    it = p.inventory[index]
    if game.item_def(it.id).kind != "food":
        return f"{a.name} sniffs it and turns away."
    p.take(it.id, 1)
    a.fed = game.clock.turn
    a.hp = min(a.max_hp, a.hp + 3)
    add_bond(a, 4)
    return f"{a.name} eats, and stays close."


def toggle_wait(game, a: Animal) -> str:
    if a.state == "follow":
        a.state = "wait"
        return f"{a.name} sits and waits."
    a.state = "follow"
    return f"{a.name} gets up and follows."


def release(game, a: Animal, why: str) -> None:
    a.pet, a.stray, a.state, a.alert = False, True, "graze", False
    game.pet_uid = 0
    note(game, why, key=True)


def dismiss(game, a: Animal) -> str:
    release(game, a, f"{a.name} trots off, and does not look back.")
    return f"{a.name} trots off."


# ------------------------------------------------------------------ what a pet does
def tick_animal(game, a: Animal) -> None:
    """Called from the animals' AI for every pet species: strays wander and look, pets follow and fight."""
    p, lv = game.player, game.level
    if lv.kind != "overworld":
        return
    d = cheb(a.pos, p.pos)
    if a.pet:
        _pet_ai(game, a, d)
        return
    # a stray: curious, not tame
    if a.state == "flee":
        if d > 12:
            a.state, a.alert = "graze", False
            return
        _step_away(game, a)
        return
    if d <= CURIOUS_RANGE and a.species in ("dog", "cat") and has_los(lv, a.pos, p.pos):
        if d > 3:
            nxt = greedy_step(lv, a.pos, p.pos, game.rng, can_pass=lambda n: lv.tile(*n) in ALLOWED)
            if nxt and lv.free(*nxt):
                lv.move_actor(a, *nxt)
        return
    if a.species in ("crow", "fox") and d <= 4 and game.rng.random() < 0.5:
        _step_away(game, a)
        return
    if game.rng.random() < 0.18:
        dx, dy = game.rng.choice(DIRS8)
        n = (a.x + dx, a.y + dy)
        if lv.free(*n) and lv.tile(*n) in ALLOWED:
            lv.move_actor(a, *n)


def _step_away(game, a: Animal) -> None:
    lv, p = game.level, game.player
    best, best_d = None, cheb(a.pos, p.pos)
    for dx, dy in DIRS8:
        n = (a.x + dx, a.y + dy)
        if lv.free(*n) and lv.tile(*n) in ALLOWED and cheb(n, p.pos) > best_d:
            best, best_d = n, cheb(n, p.pos)
    if best:
        lv.move_actor(a, *best)


def _pet_ai(game, a: Animal, d: int) -> None:
    from outbreak.engine import combat
    lv, p = game.level, game.player
    sp = spec_of(a)
    foe = _nearest_foe(game, a)
    fights = a.species in ("dog", "fox", "cat", "crow")
    if foe is not None and a.state == "follow" and fights and d <= 8:
        coward = a.species in ("cat", "fox", "crow") or a.hp < a.max_hp * 0.3
        if coward and cheb(a.pos, foe.pos) <= 3:
            _step_away_from(game, a, foe)
            return
        if a.species == "dog" and cheb(a.pos, foe.pos) == 1:
            combat.attack_actor(game, a, foe)
            return
        if a.species == "dog" and cheb(a.pos, foe.pos) > 1:
            nxt = greedy_step(lv, a.pos, foe.pos, game.rng, can_pass=lambda n: lv.tile(*n) in ALLOWED)
            if nxt and lv.free(*nxt):
                lv.move_actor(a, *nxt)
            return
    if a.state == "wait":
        return
    if d <= 2:
        return
    field = game.get_field()
    from outbreak.engine.pathing import descend
    nxt = descend(lv, field, a.pos, game.rng) if a.pos in field else None
    if nxt is None:
        nxt = greedy_step(lv, a.pos, p.pos, game.rng, can_pass=lambda n: lv.tile(*n) in ALLOWED)
    if nxt and lv.free(*nxt):
        lv.move_actor(a, *nxt)


def _nearest_foe(game, a: Animal):
    best, bd = None, 99
    for z in game.level.actors:
        if isinstance(z, Zombie) and z.hp > 0 and z.state != "dormant":
            d = cheb(a.pos, z.pos)
            if d < bd and d <= 8:
                best, bd = z, d
    return best


def _step_away_from(game, a: Animal, foe) -> None:
    lv = game.level
    best, best_d = None, cheb(a.pos, foe.pos)
    for dx, dy in DIRS8:
        n = (a.x + dx, a.y + dy)
        if lv.free(*n) and lv.tile(*n) in ALLOWED and cheb(n, foe.pos) > best_d:
            best, best_d = n, cheb(n, foe.pos)
    if best:
        lv.move_actor(a, *best)


def tick(game) -> None:
    a = current(game)
    if a is None or game.level is not game.world.level:
        return
    t, p = game.clock.turn, game.player
    sp = spec_of(a)
    near = cheb(a.pos, p.pos) <= 10
    if t % 100 == 0:
        add_bond(a, 1 if hunger_of(game, a) != "starving" else -3)
    if t % 15 == 0 and a.hp < a.max_hp and not any(True for z in game.visible_hostiles() if cheb(z.pos, a.pos) <= 6):
        a.hp += 1
    if hunger_of(game, a) == "hungry" and t % 150 == 0:
        note(game, f"{a.name} looks at your pack and whines. It is hungry.")
    if a.bond <= 0:
        release(game, a, f"{a.name} drifts away: it has had enough of going hungry.")
        return
    if not near:
        return
    if a.species == "dog":
        if t % WARN_EVERY == 0:
            _growl(game, a)
        if t % 40 == 0 and game.rng.random() < 0.25:
            game.emit_noise(a.pos, 6, "player")
            note(game, f"{a.name} barks. Loudly.")
    elif a.species == "cat":
        if t % CALM_EVERY == 0 and p.panic > 15:
            game.add_panic(-2, raw=True)
        if t - a.lasttalk > 800 and t % 100 == 0:
            add_bond(a, -3)                                       # aloof: it wants a little attention now and then
    elif a.species == "crow":
        if t >= a.nextfx and t % 5 == 0:
            a.nextfx = t + 300
            site = next((q for q in sorted(game.pois.values(), key=lambda q: cheb(q.pos, p.pos))
                         if not q.revealed and q.kind not in ("breach", "cave")), None)
            if site is not None and cheb(site.pos, p.pos) <= 45:
                site.revealed = True
                note(game, f"{a.name} circles over something to the {compass(site.x - p.x, site.y - p.y)}: {site.name} is marked on your map.")
        if t % 40 == 0 and game.rng.random() < 0.2:
            game.emit_noise(a.pos, 5, "player")
            note(game, f"{a.name} caws. The whole street heard it.")
    if sp.gift and t >= a.nextfx and a.species in ("fox",) and hunger_of(game, a) == "fed":
        a.nextfx = t + GIFT_EVERY
        if game.rng.random() < 0.6:
            game.give_item(Item("raw_meat", 1))
            note(game, f"{a.name} drops a rabbit at your feet.")
            add_bond(a, 1)


def _growl(game, a: Animal) -> None:
    """A dog knows something is wrong before you do."""
    lv = game.level
    for h in lv.actors:
        if getattr(h, "hidden", False) and cheb(h.pos, a.pos) <= 9:
            h.hidden, h.state = False, "idle"
            note(game, f"{a.name} growls at the cover ahead. Someone is there.")
            add_bond(a, 1)
            return
    for z in lv.actors:
        if isinstance(z, Zombie) and z.hp > 0 and z.pos not in game.visible and cheb(z.pos, a.pos) <= 9 \
                and z.state != "dormant" and game.clock.turn >= a.nextfx - GIFT_EVERY + 40:
            note(game, f"{a.name} growls, hackles up, toward the {compass(z.x - a.x, z.y - a.y)}.")
            return


# ------------------------------------------------------------------ moments
def on_enter(game, target) -> None:
    a = current(game)
    if a is not None:
        note(game, f"{a.name} sits outside and waits.")


def on_return(game) -> None:
    a = current(game)
    if a is None:
        return
    sp = spec_of(a)
    if sp.gift and a.species in ("cat", "crow") and game.rng.random() < 0.3:
        if sp.gift == "coins":
            n = game.rng.randint(1, 4)
            game.player.coins += n
            note(game, f"{a.name} drops something bright at your feet: {n} {game.era.coin}.")
        else:
            game.give_item(Item(sp.gift, 1))
            note(game, f"{a.name} has caught something while you were gone.")
        add_bond(a, 1)


def on_kill(game, a: Animal, victim) -> None:
    a.kills += 1
    add_bond(a, 1)
    if game.rng.random() < 0.3:
        note(game, f"{a.name} worries the body. It looks pleased with itself.")


def on_hurt(game, a: Animal) -> None:
    if game.rng.random() < 0.4:
        note(game, f"{a.name} yelps.")


def on_death(game, a: Animal, killer=None) -> None:
    """A pet's death is permanent, and it is mourned in the log."""
    lv = game.level
    if a in lv.actors:
        lv.remove_actor(a)
    if not a.pet:
        return
    days = max(0, (game.clock.turn - a.since) // 240)
    by = f" at the hands of {killer.name.lower()}" if killer is not None and hasattr(killer, "name") else ""
    note(game, f"{a.name} is dead{by}. {days} day{'s' if days != 1 else ''} together. Gone for good.", key=True)
    fallen = getattr(game, "fallen_allies", None)
    if fallen is None:
        fallen = game.fallen_allies = []
    fallen.append((a.name, f"{a.species}, {days}d, {a.kills} kills"))
    game.pet_uid = 0
    game.add_panic(6 + a.bond / 8, raw=True)
    from outbreak.engine import director, memory
    memory.on_ally_death(game, a.name, a.species, f"{a.name} was a good {a.species}.", a.pos)
    director.mourn(game)
