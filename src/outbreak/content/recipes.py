"""Crafting recipes.  Higher-tier ones need fluency in the era's cipher: you
can only build what you can read the manual for."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class Recipe:
    id: str
    out: str                              # item id; "@ammo" means the era's main ammunition
    qty: int
    inputs: Tuple[Tuple[str, int], ...]
    fluency: float = 0.0
    needs: str = ""                       # "" | "firearms" | "electricity" | "workshop" (beside one you built)
    turns: int = 3
    starter: bool = True                  # everyone knows it; the rest are learned from a manual you decipher


RECIPES: Tuple[Recipe, ...] = (
    Recipe("bandage", "bandage", 2, (("cloth", 2),)),
    Recipe("cook", "meat", 1, (("raw_meat", 1), ("wood", 1)), turns=4),
    Recipe("cook_fish", "grilled_fish", 1, (("fish", 1), ("wood", 1)), turns=3),
    Recipe("rod", "rod", 1, (("wood", 1), ("cloth", 1), ("scrap", 1)), turns=4),
    Recipe("net", "net", 1, (("cloth", 3), ("wood", 1)), turns=5),
    Recipe("nailbomb", "nailbomb", 1, (("chem", 1), ("scrap", 2), ("cloth", 1)), turns=4),
    Recipe("splint", "splint", 1, (("wood", 1), ("cloth", 1))),
    Recipe("molotov", "molotov", 1, (("fuel", 1), ("cloth", 1))),
    Recipe("noisemaker", "noisemaker", 1, (("parts", 1), ("scrap", 1))),
    Recipe("barricade", "barricade_kit", 1, (("wood", 2), ("scrap", 1))),
    Recipe("spike_trap", "spike_trap", 1, (("wood", 1), ("scrap", 2)), starter=False),
    Recipe("nailbat", "nailbat", 1, (("wood", 1), ("scrap", 2)), needs="workshop", turns=6),
    Recipe("shiv", "shiv", 1, (("scrap", 3), ("cloth", 1)), needs="workshop", turns=6, starter=False),
    Recipe("pike", "pike", 1, (("wood", 2), ("scrap", 2)), needs="workshop", turns=8, starter=False),
    Recipe("scrapbow", "scrapbow", 1, (("wood", 3), ("cloth", 2)), needs="workshop", turns=10, starter=False),
    Recipe("shaft", "shaft", 4, (("wood", 1), ("scrap", 1)), needs="workshop", turns=4, starter=False),
    Recipe("repair", "repair_kit", 1, (("scrap", 2), ("parts", 1)), fluency=0.08, starter=False),
    Recipe("filter", "filter", 1, (("cloth", 1), ("chem", 1)), fluency=0.10, starter=False),
    Recipe("medkit", "medkit", 1, (("bandage", 2), ("chem", 1)), fluency=0.15, starter=False),
    Recipe("suppressant", "suppressant", 1, (("chem", 2), ("cloth", 1)), fluency=0.25, turns=5, starter=False),
    Recipe("ammo", "@ammo", 4, (("scrap", 1), ("chem", 1)), fluency=0.12, starter=False),
)


STARTERS: Tuple[str, ...] = tuple(r.id for r in RECIPES if r.starter)


def by_id() -> Dict[str, Recipe]:
    return {r.id: r for r in RECIPES}
