"""Content registry: look packs up by id with helpful errors."""
from __future__ import annotations

from outbreak.content.eras import ERAS, EraPack
from outbreak.content.openings import OPENINGS, OpeningDef, get_opening
from outbreak.content.perks import BRANCHES, ORIGINS, PERKS, OriginDef, PerkDef
from outbreak.content.recipes import RECIPES, Recipe
from outbreak.content.scenarios import SCENARIOS, ScenarioDef
from outbreak.content.zombies import PRESETS, SPECIALS, ZombieProfile


def _get(table, kind: str, key: str):
    try:
        return table[key]
    except KeyError:
        raise KeyError(f"unknown {kind} {key!r}; choose one of: {', '.join(sorted(table))}") from None


def get_era(era_id: str) -> EraPack:
    return _get(ERAS, "era", era_id)


def get_preset(preset_id: str) -> ZombieProfile:
    return _get(PRESETS, "zombie preset", preset_id)


def get_scenario(scenario_id: str) -> ScenarioDef:
    return _get(SCENARIOS, "scenario", scenario_id)


def get_origin(origin_id: str) -> OriginDef:
    return _get(ORIGINS, "origin", origin_id)


__all__ = [
    "OPENINGS", "OpeningDef", "get_opening", "ERAS", "PRESETS", "SCENARIOS", "ORIGINS", "PERKS", "BRANCHES", "SPECIALS", "RECIPES",
    "EraPack", "ZombieProfile", "ScenarioDef", "OriginDef", "PerkDef", "Recipe",
    "get_era", "get_preset", "get_scenario", "get_origin",
]
