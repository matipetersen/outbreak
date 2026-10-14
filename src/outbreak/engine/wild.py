"""The wild: game to hunt and plants to gather, so food is something you can go and find.

Rabbits, deer and boar graze on open ground.  They notice you from a few tiles (fewer if you are creeping), bolt, and run
a little slower than you do, so a chase can end.  A creeping hunter can stab an unaware one for triple damage.  A boar
turns and gores whatever hurt it.  Kills drop raw meat; eaten raw it can make you ill, with a plank it can be cooked
(the ``cook`` recipe).  Foraging takes a few turns on grass or brush and a patch stays picked for a while.
"""
from __future__ import annotations

from typing import Optional, Tuple

from outbreak.engine import tiles as T
from outbreak.engine.fov import has_los
from outbreak.engine.model import Animal, Item
from outbreak.util import DIRS8, cheb

# species: hp, glyph, (meat min, meat max), notice radius, dmg when cornered, spawn weight
SPECIES = {
    "rabbit": (4, "r", (1, 1), 5, (0, 0), 50),
    "deer": (14, "d", (2, 3), 7, (0, 0), 35),
    "boar": (20, "b", (2, 3), 4, (3, 7), 15),
    "wolf": (12, "w", (1, 2), 7, (3, 6), 0),            # packs in the deep woods only
}
NAMES = {"rabbit": "Rabbit", "deer": "Deer", "boar": "Boar", "wolf": "Wolf"}
WOLF_BURST = 4                                        # every fourth turn a charging wolf takes two steps
FLEE_BURST = 3                                        # every third turn a fleeing animal takes two steps
SNEAK_NOTICE = 0.3                                    # chance per turn a creeping hunter is noticed inside the animal's range
FIGHTERS = ("boar", "wolf")                           # these turn on you instead of running
FOREST_TREES = 7                                      # trees in the 5x5 round you that make it deep woods
FOREST_SIGHT = 0.75                                   # the dead see this much less far from inside it
GRAZING = (T.GRASS, T.BRUSH)
FORAGE_TURNS = 5
PATCH_TURNS = 800
FORAGE_CHANCE = {T.BRUSH: 0.65, T.GRASS: 0.4}
SNEAK_BLOW = 3.0


def make_animal(game, x: int, y: int, species: str) -> Animal:
    hp, glyph, _meat, _r, _d, _w = SPECIES[species]
    return Animal(uid=game.next_uid(), name=NAMES[species], glyph=glyph, x=x, y=y, hp=hp, max_hp=hp, species=species)


def populate(game) -> None:
    """Scatter game over the open ground, away from where you start."""
    lv, rng, start = game.world.level, game.rng, game.world.start
    spots = [(x, y) for y in range(3, lv.h - 3) for x in range(3, lv.w - 3)
             if lv.tiles[y][x] in GRAZING and cheb((x, y), start) >= 14]
    if not spots:
        return
    kinds = [k for k in SPECIES if SPECIES[k][5]]
    weights = [SPECIES[k][5] for k in kinds]
    for _ in range(max(6, (lv.w * lv.h) // 400)):
        x, y = rng.choice(spots)
        if lv.free(x, y):
            lv.add_actor(make_animal(game, x, y, rng.choices(kinds, weights)[0]))


    deep = [s for s in spots if in_forest_at(lv, s) and cheb(s, start) >= 20]
    for _ in range(max(2, (lv.w * lv.h) // 3500)) if deep else ():       # wolf packs
        x, y = rng.choice(deep)
        for _m in range(rng.randint(2, 3)):
            spot = lv.free_spot_near(x, y, 2)
            if spot:
                lv.add_actor(make_animal(game, spot[0], spot[1], "wolf"))


# ------------------------------------------------------------------ the deep woods
def in_forest_at(lv, pos) -> bool:
    n = 0
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if lv.in_bounds(pos[0] + dx, pos[1] + dy) and lv.tile(pos[0] + dx, pos[1] + dy) == T.TREE:
                n += 1
    return n >= FOREST_TREES and lv.kind == "overworld"


def forest_here(game) -> bool:
    """Is the player in deep woods?  Cached for the turn: perception asks for it once per zombie."""
    p = game.player
    key = (game.clock.turn, p.pos, id(game.level))
    cache = getattr(game, "_forest_cache", None)
    if cache is None or cache[0] != key:
        cache = game._forest_cache = (key, in_forest_at(game.level, p.pos))
    return cache[1]


def forest_note(game) -> None:
    """Say so once when you walk in under the canopy."""
    inside = forest_here(game)
    was = getattr(game, "in_forest", False)
    game.in_forest = inside
    if inside and not was:
        game.msg("The canopy closes over you. It is quieter here, and the dead will not see you from far. "
                 "Wolves hunt in woods like this.", "info")


# ------------------------------------------------------------------ behaviour
def _step_away(game, a: Animal) -> Optional[Tuple[int, int]]:
    """Run from the player, sliding along obstacles and preferring open ground over dead ends; None if cornered."""
    lv, p = game.level, game.player
    here = (a.x - p.x) ** 2 + (a.y - p.y) ** 2
    best, best_score = None, here - 0.5
    for dx, dy in DIRS8:
        n = (a.x + dx, a.y + dy)
        if not (lv.free(*n) and lv.tile(*n) in GRAZING + (T.ROAD,)):
            continue
        open_ = sum(1 for ddx, ddy in DIRS8 if lv.free(n[0] + ddx, n[1] + ddy) and lv.tile(n[0] + ddx, n[1] + ddy) in GRAZING + (T.ROAD,))
        score = (n[0] - p.x) ** 2 + (n[1] - p.y) ** 2 + 0.6 * open_ + game.rng.random() * 0.3
        if score > best_score:
            best, best_score = n, score
    return best


def tick(game, a: Animal) -> None:
    p, lv, t = game.player, game.level, game.clock.turn
    if a.species not in SPECIES:                                         # a dog, a cat, a crow, a fox: strays and pets
        from outbreak.engine import pets
        pets.tick_animal(game, a)
        return
    if lv.kind != "overworld":
        return
    d = cheb(a.pos, p.pos)
    radius = SPECIES[a.species][3]
    if a.species == "wolf" and not game.clock.is_day:
        radius += 3
    if p.sneaking:
        radius = max(2, radius - 3)
    # a creeping player is only noticed now and then, which is what makes a stalk possible
    if not a.alert and d <= radius and has_los(lv, a.pos, p.pos) and (not p.sneaking or game.rng.random() < SNEAK_NOTICE):
        a.alert = True
        a.state = "charge" if (a.species == "wolf" or (a.species == "boar" and d <= 3)) else "flee"
        if a.species == "wolf":                                          # the pack hears it
            for m in lv.actors:
                if isinstance(m, Animal) and m.species == "wolf" and cheb(m.pos, a.pos) <= 9:
                    m.alert, m.state = True, "charge"
    if a.alert and d > radius + 6:
        a.alert, a.state = False, "graze"                               # it calms down once you are well away
    if a.state == "flee":
        for _ in range(1 + (t % FLEE_BURST == 0)):                      # it runs a little faster than you can: walking one down fails
            nxt = _step_away(game, a)
            if nxt:
                lv.move_actor(a, *nxt)
        return
    if a.state == "charge":
        if a.species == "wolf" and d > radius + 8:
            a.alert, a.state = False, "graze"
            return
        if d == 1:
            _bite(game, a)
        elif d <= (14 if a.species == "wolf" else 8):
            from outbreak.engine.pathing import greedy_step
            for _ in range(1 + (a.species == "wolf" and t % WOLF_BURST == 0)):   # a wolf cannot be outwalked: a doorway can stop it
                if cheb(a.pos, p.pos) <= 1:
                    _bite(game, a)                                       # its spare step is a bite at your heels
                    break
                nxt = greedy_step(lv, a.pos, p.pos, game.rng, can_pass=lambda n: lv.tile(*n) in GRAZING + (T.ROAD,))
                if nxt and lv.free(*nxt):
                    lv.move_actor(a, *nxt)
        return
    if game.rng.random() < 0.18:                                        # graze: drift about
        dx, dy = game.rng.choice(DIRS8)
        n = (a.x + dx, a.y + dy)
        if lv.free(*n) and lv.tile(*n) in GRAZING:
            lv.move_actor(a, *n)


BITE_ACC = {"wolf": 65, "boar": 70}


def _bite(game, a: Animal) -> None:
    """A wolf or boar strikes: it can miss, armour takes the edge off and wears, and a deep wound can bleed."""
    from outbreak.engine import combat
    from outbreak.util import clamp
    p = game.player
    if game.rng.random() * 100 >= clamp(BITE_ACC.get(a.species, 60) - p.evade, 15, 92):
        game.msg(f"The {a.name.lower()} snaps and misses.", "combat")
        return
    lo, hi = SPECIES[a.species][4]
    armor = game.item_def(p.armor.id) if p.armor else None
    dmg = max(1, int(round(game.rng.randint(lo, hi) * game.diff.damage - (armor.defense if armor else 0))))
    if armor and p.armor.dur is not None:
        p.armor.dur -= 1
        if p.armor.dur <= 0:
            game.msg(f"Your {armor.name.lower()} falls apart!", "bad")
            p.armor = None
    game.msg(f"The {a.name.lower()} {'mauls' if a.species == 'wolf' else 'gores'} you for {dmg}.", "bad")
    combat.damage_player(game, dmg, "mauled by wolves" if a.species == "wolf" else "gored by a boar", a)
    if p.alive and dmg >= 4 and game.rng.random() < 0.2 * (1.0 - p.mod("bleed_resist")):
        p.bleeding = min(3, p.bleeding + 1)
        game.msg("You are bleeding.", "bad")


# ------------------------------------------------------------------ the hunt
def attack(game, a: Animal, unaware: bool, acc: float, dmg: float) -> bool:
    """The player strikes ``a``; ``acc`` is hit chance in percent and ``dmg`` the damage of an ordinary blow."""
    if not unaware and game.rng.random() * 100 >= acc:
        game.msg(f"You swing at the {a.name.lower()} and miss.", "combat")
        a.alert, a.state = True, ("charge" if a.species in FIGHTERS else "flee")
        return True
    hurt = max(1, int(dmg * (SNEAK_BLOW if unaware else 1.0)))
    a.hp -= hurt
    if a.hp <= 0:
        kill(game, a)
        return True
    a.alert = True
    a.state = "charge" if a.species in FIGHTERS else "flee"
    game.msg(f"You hit the {a.name.lower()} for {hurt}.", "combat")
    return True


def kill(game, a: Animal) -> None:
    lv = game.level
    lv.remove_actor(a)
    lo, hi = SPECIES[a.species][2]
    n = game.rng.randint(lo, hi)
    lv.drop(a.pos, Item("raw_meat", n))
    game.player.gain_xp(3)
    game.player.bump("game")
    game.msg(f"The {a.name.lower()} drops. {n} cut{'s' if n != 1 else ''} of meat lie there: pick it up, and cook it.", "good")


# ------------------------------------------------------------------ foraging
def can_forage(game) -> str:
    """Why you cannot forage here, or an empty string."""
    p, lv = game.player, game.level
    if lv.kind != "overworld":
        return "There is nothing to gather indoors."
    if lv.tile(*p.pos) not in GRAZING:
        return "Nothing edible grows on this. Try grass or brush."
    if game.visible_hostiles():
        return "Not with something hunting you."
    return ""


def forage(game) -> bool:
    """Gather what is edible round you.  Returns True if time passed."""
    if not game._begin_action():
        return False
    why = can_forage(game)
    if why:
        game.msg(why, "info")
        return False
    p, lv, t = game.player, game.level, game.clock.turn
    patches = getattr(game, "foraged", None)
    if patches is None:
        patches = game.foraged = {}
    if any(cheb(pos, p.pos) <= 2 and t - when < PATCH_TURNS for pos, when in patches.items()):
        game.msg("This patch is already picked over. Move on.", "info")
        return False
    for _ in range(FORAGE_TURNS):
        game._spend(1)
        if game.over:
            return True
        if game.visible_hostiles():
            game.msg("You stop gathering: something is coming.", "warn")
            return True
    game.emit_noise(p.pos, 2, "player")
    patches[p.pos] = t
    deep = forest_here(game)
    chance = FORAGE_CHANCE.get(lv.tile(*p.pos), 0.4) + (0.2 if deep else 0.0)
    if game.weather in ("rain", "fog"):
        chance += 0.1
    if not game.clock.is_day:
        chance -= 0.25
    if game.rng.random() < chance:
        n = game.rng.randint(1, 2)
        if deep and game.rng.random() < 0.25:
            game.give_item(Item("herbs", n))
            game.msg(f"You find wild herbs growing in the shade ({n}).", "good")
        else:
            game.give_item(Item("forage", n))
            game.msg(f"You gather wild greens and berries ({n}).", "good")
    else:
        game.msg("You find nothing worth eating here.", "info")
    return True


# ------------------------------------------------------------------ trees and water
CHOP_TURNS = {"blade": 6, "blunt": 9, "polearm": 9}
CHOP_NOISE = 8


def _neighbours(p, lv):
    for dx, dy in DIRS8:
        n = (p.x + dx, p.y + dy)
        if lv.in_bounds(*n):
            yield n


def tree_beside(game):
    p, lv = game.player, game.level
    if lv.kind != "overworld":
        return None
    for n in _neighbours(p, lv):
        if lv.tile(*n) == T.TREE and 0 < n[0] < lv.w - 1 and 0 < n[1] < lv.h - 1:      # the rim of the world is not for felling
            return n
    return None


def water_beside(game):
    p, lv = game.player, game.level
    if lv.kind != "overworld":
        return None
    if lv.tile(*p.pos) == T.SHALLOW:
        return p.pos
    for n in _neighbours(p, lv):
        if lv.tile(*n) in (T.WATER, T.SHALLOW):
            return n
    return None


def chop(game) -> bool:
    """Fell the tree beside you: planks for the price of time and noise.  It needs an edge or some weight."""
    if not game._begin_action():
        return False
    tree = tree_beside(game)
    p, lv = game.player, game.level
    if tree is None:
        game.msg("There is no tree within reach.", "info")
        return False
    w = game.item_def(p.weapon.id) if p.weapon else None
    turns = CHOP_TURNS.get(w.style) if w else None
    if turns is None:
        game.msg("You need something with an edge or some weight to cut with.", "info")
        return False
    if game.visible_hostiles():
        game.msg("Not with something hunting you.", "info")
        return False
    for i in range(turns):
        game._spend(1)
        if game.over:
            return True
        if i % 3 == 0:
            game.emit_noise(p.pos, CHOP_NOISE, "player")
        if game.visible_hostiles():
            game.msg("You stop chopping: something is coming.", "warn")
            return True
    lv.set_tile(tree[0], tree[1], T.GRASS)
    n = game.rng.randint(2, 4)
    game.give_item(Item("wood", n))
    game.msg(f"The tree comes down. {n} planks, and a clearing where it stood.", "good")
    return True


def fish(game) -> bool:
    """Fish the water beside you with a rod or a net.  Quiet, slow, and the net wears out."""
    if not game._begin_action():
        return False
    p, lv = game.player, game.level
    gear = next((i for i in p.inventory if "fish" in game.item_def(i.id).effect), None)
    if gear is None:
        game.msg("You have nothing to fish with. Craft a rod or a net.", "info")
        return False
    if game.visible_hostiles():
        game.msg("Not with something hunting you.", "info")
        return False
    eff = game.item_def(gear.id).effect
    turns, most = (8, 1) if most_is_rod(eff) else (12, int(eff["fish"]))
    for _ in range(turns):
        game._spend(1)
        if game.over:
            return True
        if game.visible_hostiles():
            game.msg("You stop fishing: something is coming.", "warn")
            return True
    chance = 0.5 if most == 1 else 0.65
    if game.weather in ("rain", "fog"):
        chance += 0.1
    if not game.clock.is_day:
        chance -= 0.2
    if game.rng.random() < chance:
        n = game.rng.randint(1, most)
        game.give_item(Item("fish", n))
        game.msg(f"You land {n} fish." if n > 1 else "You land a fish.", "good")
    else:
        game.msg("Nothing bites.", "info")
    if game.rng.random() < float(eff.get("tear", 0)):
        p.take(gear.id, 1)
        game.msg(f"Your {game.item_def(gear.id).name.lower()} {'tears apart' if most > 1 else 'snaps'}.", "warn")
    return True


def most_is_rod(eff) -> bool:
    return int(eff.get("fish", 1)) == 1


def target(game) -> str:
    """What the gather key would do here: chop | fish | forage | '' (nothing possible)."""
    if tree_beside(game) is not None and game.player.weapon is not None:
        return "chop"
    if water_beside(game) is not None and any("fish" in game.item_def(i.id).effect for i in game.player.inventory):
        return "fish"
    return "forage" if not can_forage(game) else ""


def gather(game) -> bool:
    """One key for living off the land: fell a tree, fish the water, or forage the ground."""
    what = target(game)
    if what == "chop":
        return chop(game)
    if what == "fish":
        return fish(game)
    if what == "forage":
        return forage(game)
    if tree_beside(game) is not None:
        game.msg("You need a weapon with an edge or some weight to fell a tree.", "info")
    elif water_beside(game) is not None:
        game.msg("You have nothing to fish with. Craft a rod or a net.", "info")
    else:
        game.msg(can_forage(game) or "Nothing to gather here.", "info")
    return False
