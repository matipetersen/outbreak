"""Skill trees and character origins.

Perks only ever change *named modifiers* (see MODIFIER_KEYS); the engine reads
``player.mod("melee_dmg")`` and never asks which perk provided it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class PerkDef:
    id: str
    branch: str
    name: str
    desc: str
    max_rank: int
    mods: Dict[str, float]         # modifier key -> value gained per rank


BRANCHES = ("brawler", "shooter", "medic", "ghost", "scholar")
BRANCH_NAMES = {"brawler": "Brawler", "shooter": "Marksman", "medic": "Medic", "ghost": "Ghost",
                "scholar": "Scavenger"}

PERKS: Dict[str, PerkDef] = {p.id: p for p in (
    PerkDef("heavy", "brawler", "Heavy hitter", "+12% melee damage per rank.", 3, {"melee_dmg": 0.12}),
    PerkDef("skull", "brawler", "Skull cracker", "+6% melee headshot chance per rank.", 3, {"head_melee": 0.06}),
    PerkDef("tough", "brawler", "Tough", "+8 maximum health per rank.", 3, {"max_hp": 8}),
    PerkDef("rugged", "brawler", "Rugged", "15% per rank to not wear down your weapon.", 2, {"dur_save": 0.15}),
    PerkDef("aim", "shooter", "Steady aim", "+5 accuracy with ranged weapons per rank.", 3, {"ranged_acc": 5}),
    PerkDef("deadeye", "shooter", "Dead eye", "+6% ranged headshot chance per rank.", 3, {"head_ranged": 0.06}),
    PerkDef("thrifty", "shooter", "Thrifty", "12% per rank to not spend ammunition.", 2, {"ammo_save": 0.12}),
    PerkDef("quiet", "shooter", "Quiet shot", "-12% noise from ranged weapons per rank.", 2, {"ranged_noise": -0.12}),
    PerkDef("medic", "medic", "Field medic", "+25% healing per rank.", 2, {"heal_mult": 0.25}),
    PerkDef("immune", "medic", "Resistant", "-12% chance per rank that a bite takes hold.", 3, {"infect_resist": 0.12}),
    PerkDef("hands", "medic", "Steady hands", "-20% bleeding chance per rank.", 2, {"bleed_resist": 0.20}),
    PerkDef("surgeon", "medic", "Surgeon", "Amputation window +8 turns per rank, less shock.", 2, {"surgeon": 8}),
    PerkDef("feet", "ghost", "Light feet", "-1 noise per step per rank.", 2, {"move_noise": -1}),
    PerkDef("eyes", "ghost", "Night eyes", "+1 vision radius in the dark per rank.", 3, {"night_vision": 1}),
    PerkDef("nerves", "ghost", "Cold nerves", "-12% panic gain per rank.", 3, {"panic_resist": 0.12}),
    PerkDef("evade", "ghost", "Evasion", "+4 evade per rank.", 3, {"evade": 4}),
    PerkDef("linguist", "scholar", "Linguist", "+15% chance to decode words per rank.", 3, {"study_bonus": 0.15}),
    PerkDef("scav", "scholar", "Scavenger", "+12% loot found per rank.", 3, {"loot": 0.12}),
    PerkDef("tinker", "scholar", "Tinkerer", "15% per rank to keep a crafting material.", 2, {"craft_save": 0.15}),
    PerkDef("cartog", "scholar", "Cartographer", "Sense points of interest 8 tiles further away per rank.", 2,
            {"poi_sense": 8}),
)}

MODIFIER_KEYS = frozenset(k for p in PERKS.values() for k in p.mods)


@dataclass(frozen=True)
class OriginDef:
    id: str
    blurb: str
    perks: Dict[str, int]                  # perk id -> starting ranks
    kit: Tuple[Tuple[str, int], ...]       # item id or @role, quantity
    hp_bonus: int = 0
    words: int = 0                         # starting vocabulary
    coins: int = 5


ORIGINS: Dict[str, OriginDef] = {o.id: o for o in (
    OriginDef("medic", "Treats wounds better, resists infection, starts with medical supplies.",
              {"medic": 1, "immune": 1}, (("@melee", 1), ("@light", 1), ("bandage", 3), ("medkit", 1),
                                           ("painkiller", 1)), words=3),
    OriginDef("soldier", "Hits hard, shoots straight, starts armed and armoured.",
              {"heavy": 1, "aim": 1}, (("@melee_good", 1), ("@ranged", 1), ("@ammo", 8), ("@armor", 1),
                                        ("@light", 1), ("bandage", 1)), hp_bonus=12),
    OriginDef("scholar", "Reads the cipher from the start and finds more loot.",
              {"linguist": 2, "scav": 1}, (("@melee", 1), ("@light", 1), ("cloth", 3), ("bandage", 2)),
              words=12, coins=8),
    OriginDef("outlaw", "Quiet, evasive, good with locks and bad ideas.",
              {"feet": 1, "evade": 1, "scav": 1}, (("@melee_good", 1), ("@light", 1), ("noisemaker", 1),
                                                    ("bandage", 2)), coins=14),
    OriginDef("guard", "Balanced: some armour, a sidearm, a steady nerve.",
              {"tough": 1, "nerves": 1}, (("@melee", 1), ("@ranged", 1), ("@ammo", 5), ("@armor", 1),
                                           ("@light", 1), ("bandage", 2)), hp_bonus=6),
)}
