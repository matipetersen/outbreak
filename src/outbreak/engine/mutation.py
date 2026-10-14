"""The strain changes, and it changes differently in different places.

How much depends on the plague and on the world it spreads in: an engineered plague in a world of labs mutates fast, the
same shambling dead in a medieval world hardly at all.  *Where* it changes is regional: the map is cut into districts, each
with its own run of traits.  Places with labs, bases and the first outbreak breed it faster.  Crossing into a district tells
you what the dead there have become, so the road you choose is a choice of which mutations to meet.
"""
from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Optional

from outbreak.util import compass

MAX_TRAITS = 4                      # per district
RAMP_DAYS = 12                      # the strain needs this long to reach its full pace
DISTRICT_TILES = 56                 # roughly how wide a district is
# id: (what you are told, short name, stat factors).  Not every change is an improvement.
TRAITS = {
    "fleet": ("They move faster than they did.", "faster", {"speed": 1.12}),
    "tough": ("They take more killing: the hides are tougher.", "tougher", {"hp": 1.2}),
    "keen": ("They hear and see more than they did.", "keener senses", {"hearing": 1.2, "sight": 1.1}),
    "frenzied": ("They hit harder.", "harder hitting", {"dmg": 1.2}),
    "hulking": ("They have swollen: huge and a little slower.", "hulking", {"hp": 1.35, "speed": 0.95}),
    "withered": ("They are wasted and brittle, and much quicker for it.", "brittle but quick", {"hp": 0.8, "speed": 1.15}),
    "howling": ("They have found their voices: they hear everything.", "howling", {"hearing": 1.4}),
    "swift": ("They close the distance faster still.", "swifter", {"speed": 1.1}),
}
SHORT = {k: v[1] for k, v in TRAITS.items()}
NOUN = {"medical": "Hospital", "market": "Market", "guard": "Barracks", "lab": "Labs", "transit": "Station",
        "military": "Garrison", "faith": "Chapel", "industry": "Works"}
HOT = {"lab": 0.6, "military": 0.6, "medical": 0.25}              # places that breed it faster


@dataclass
class Region:
    id: int
    name: str
    cx: int
    cy: int
    heat: float = 1.0
    traits: List[str] = field(default_factory=list)
    known: bool = False                                          # you have been there


def build(game) -> None:
    """Cut the map into districts (deterministic from the seed; it never touches the game's own dice)."""
    lv = game.world.level
    w, h = lv.w, lv.h
    rng = random.Random(game.seed ^ 0x5A17)
    n = max(6, min(30, round(w * h / (DISTRICT_TILES * DISTRICT_TILES))))
    cols = max(2, round((n * w / h) ** 0.5))
    rows = max(2, round(n / cols))
    regions = []
    for j in range(rows):
        for i in range(cols):
            cx = int((i + 0.5 + rng.uniform(-0.3, 0.3)) * w / cols)
            cy = int((j + 0.5 + rng.uniform(-0.3, 0.3)) * h / rows)
            regions.append(Region(len(regions), "", cx, cy))
    game.regions = regions
    kinds = {r.id: Counter() for r in regions}
    for poi in game.pois.values():
        r = region_of(game, poi.x, poi.y)
        kinds[r.id][poi.kind] += 1
        r.heat += HOT.get(poi.kind, 0.0) * 0.5
    start = region_of(game, *game.world.start)
    start.heat += 0.5                                            # ground zero
    seen = Counter()
    for r in regions:
        r.heat = min(2.5, r.heat)
        common = [k for k, _ in kinds[r.id].most_common() if k in NOUN]
        where = compass(r.cx - w / 2, r.cy - h / 2) if abs(r.cx - w / 2) + abs(r.cy - h / 2) > min(w, h) * 0.18 else "central"
        base = f"{where.title()} {NOUN[common[0]] if common else 'Fields'}"
        seen[base] += 1
        r.name = base if seen[base] == 1 else f"{base} {'I' * seen[base]}"
    game.region_id = -1


def region_of(game, x: int, y: int) -> Region:
    return min(game.regions, key=lambda r: (r.cx - x) ** 2 + (r.cy - y) ** 2)


def region_at(game, level, pos) -> Region:
    """The district a level belongs to: the overworld by position, a building by where it stands."""
    if level.kind != "overworld":
        poi = game.poi_of_level(level)
        if poi is not None:
            return region_of(game, poi.x, poi.y)
    return region_of(game, pos[0], pos[1])


def here(game) -> Region:
    return region_at(game, game.level, game.player.pos)


def traits_text(r: Region) -> str:
    return ", ".join(SHORT[t] for t in r.traits) if r.traits else "unchanged"


def strength(game) -> float:
    """0 (never changes) .. about 1.4 (an engineered plague in a world of labs, at full pace); each region scales it by its heat."""
    day = game.clock.day
    return game.profile.mutates * game.era.rules.lab * min(1.0, max(0, day - 1) / RAMP_DAYS)


def boost_at(game, level, pos) -> float:
    """More of the strange ones where the strain has run ahead."""
    return 1.0 + 0.6 * strength(game) * region_at(game, level, pos).heat / 1.5


def _apply(z, trait: str) -> None:
    for stat, k in TRAITS[trait][2].items():
        if stat == "speed":
            z.speed *= k
        elif stat == "hp":
            z.hp = max(1, int(z.hp * k))
            z.max_hp = max(1, int(z.max_hp * k))
        elif stat == "hearing":
            z.hearing *= k
        elif stat == "sight":
            z.sight *= k
        elif stat == "dmg":
            z.dmg = (max(1, int(z.dmg[0] * k)), max(int(z.dmg[0] * k), int(z.dmg[1] * k)))


def apply(game, z, level, pos) -> None:
    """A new zombie is born with every change its district has seen."""
    for trait in region_at(game, level, pos).traits:
        _apply(z, trait)


def daily(game) -> None:
    """Once a day each district may change; the dead already walking in it change with it."""
    s = strength(game)
    if s <= 0:
        return
    mine = here(game)
    for r in game.regions:
        if len(r.traits) >= MAX_TRAITS or game.rng.random() >= min(0.8, 0.5 * s * r.heat / 1.5):
            continue
        trait = game.rng.choice([t for t in TRAITS if t not in r.traits])
        r.traits.append(trait)
        for lv in game.levels.values():
            for a in lv.actors:
                if getattr(a, "special", None) is not None and hasattr(a, "hearing") and region_at(game, lv, a.pos) is r:
                    _apply(a, trait)
        if r is mine:
            game.msg(f"Day {game.clock.day}: the strain has changed in the {r.name}. {TRAITS[trait][0]}", "lore")
        elif r.known and game.rng.random() < 0.5:
            game.msg(f"Word reaches you: the dead of the {r.name} have changed ({SHORT[trait]}).", "info")


def crossing(game) -> None:
    """Tell the player what the dead are like in a district the first time (and each time) they cross into it."""
    r = here(game)
    if r.id == game.region_id:
        return
    first = not r.known
    game.region_id = r.id
    r.known = True
    if r.traits:
        game.msg(f"You enter the {r.name}. The dead here are {traits_text(r)}.", "warn")
    elif first:
        game.msg(f"You enter the {r.name}.", "info")


def matchup(era, profile) -> str:
    """One honest sentence for the briefing about how this plague plays in this era."""
    m = profile.mutates * era.rules.lab
    if m < 0.1:
        how = "The strain hardly changes here: the dead of the last day are the dead of the first."
    elif m < 0.4:
        how = "The strain changes slowly. Expect a new trait now and then, and not everywhere."
    elif m < 0.8:
        how = "The strain changes steadily, district by district; after a couple of weeks it is not what it was."
    else:
        how = ("The strain mutates fast here, and differently district by district: labs and bases breed it worst. "
               "Expect a new trait every few days somewhere, and the strange ones to multiply.")
    return f"{era.rules.feel} {how}".strip()
