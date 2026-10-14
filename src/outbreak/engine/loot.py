"""Loot tables.  Items are weighted by category per building type, by rarity,
and by whether the building favours them (a hospital stocks medicine)."""
from __future__ import annotations

import random
from functools import lru_cache
from typing import List, Tuple

from outbreak.content.eras import EraPack
from outbreak.content.items import ItemDef
from outbreak.engine.model import Item
from outbreak.util import weighted_choice

CATEGORY_WEIGHTS = {
    "medical": {"med": 6, "food": 1, "material": 1, "tool": 0.5, "throw": 0.3},
    "market": {"food": 5, "material": 2, "med": 1.5, "tool": 1, "armor": 0.8, "weapon": 0.8, "light": 1, "ammo": 0.8},
    "guard": {"weapon": 3, "ammo": 3, "armor": 2, "med": 1.5, "tool": 1, "throw": 1, "food": 1},
    "lab": {"med": 3, "material": 3, "tool": 1, "throw": 0.5, "food": 0.5},
    "transit": {"material": 3, "tool": 1.5, "light": 1, "weapon": 1, "food": 1, "throw": 1},
    "military": {"weapon": 3, "ammo": 3.5, "armor": 2.5, "med": 2, "food": 1.5, "throw": 1.5, "tool": 1},
    "faith": {"food": 2, "med": 2, "material": 2, "light": 1, "weapon": 1},
    "industry": {"material": 4, "tool": 2.5, "weapon": 1.2, "throw": 1, "light": 1, "food": 0.5},
    "house": {"food": 3, "med": 1.5, "material": 2, "weapon": 1.2, "light": 1, "tool": 1, "ammo": 0.8, "armor": 0.6},
    "camp": {"food": 2, "weapon": 2, "ammo": 2, "med": 2, "material": 1, "throw": 1.5},
    "refuge": {"food": 2, "med": 2, "material": 2},
    "pad": {"material": 2, "tool": 2, "med": 1, "food": 1},
}


@lru_cache(maxsize=None)
def _pool(era_id: str, kind: str) -> Tuple[Tuple[ItemDef, float], ...]:
    from outbreak.content import get_era
    era = get_era(era_id)
    table = CATEGORY_WEIGHTS.get(kind, CATEGORY_WEIGHTS["house"])
    out = []
    for it in era.items.values():
        if "crafted" in it.tags:
            continue                                              # made at a workshop, never lying around
        weight = table.get(it.kind, 0.0)
        if weight <= 0:
            continue
        weight /= it.rarity ** 1.4
        if kind in it.poi:
            weight *= 2.5
        out.append((it, weight))
    return tuple(out)


def make_item(rng: random.Random, it: ItemDef) -> Item:
    if it.kind == "ammo":
        return Item(it.id, rng.randint(3, 8))
    if it.stackable:
        return Item(it.id, rng.randint(1, 2) if it.rarity <= 1 else 1)
    if it.durability:
        return Item(it.id, 1, max(1, int(it.durability * rng.uniform(0.4, 1.0))))
    return Item(it.id, 1)


def roll_items(rng: random.Random, era: EraPack, kind: str, count: float, loot_mult: float = 1.0) -> List[Item]:
    pool = _pool(era.id, kind)
    n = max(0, int(round(count * loot_mult + rng.uniform(-0.45, 0.45))))
    return [make_item(rng, weighted_choice(rng, pool)) for _ in range(n)] if pool else []


def roll_coins(rng: random.Random, loot_mult: float = 1.0) -> int:
    return int(rng.choice((0, 0, 1, 2, 3, 5)) * loot_mult)
