"""The player character: stats, conditions, inventory and perks."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from outbreak.content.perks import PERKS
from outbreak.content.recipes import STARTERS
from outbreak.engine.model import Actor, Item

INVENTORY_SLOTS = 26
MAX_LEVEL = 14
STYLE_RANKS = 5


def xp_for(level: int) -> int:
    return 40 + 35 * (level - 1) + 6 * (level - 1) ** 2


@dataclass(eq=False)
class Player(Actor):
    is_player = True
    stamina: float = 100.0
    fatigue: int = 0                 # 0 fresh, 1 winded, 2 exhausted (only for the warnings)
    max_stamina: float = 100.0
    panic: float = 0.0
    max_panic: float = 100.0
    humanity: int = 70
    hunger: float = 0.0
    xp: int = 0
    level: int = 1
    perk_points: int = 0
    perks: Dict[str, int] = field(default_factory=dict)
    coins: int = 0
    inventory: List[Item] = field(default_factory=list)
    weapon: Optional[Item] = None
    armor: Optional[Item] = None
    light: Optional[Item] = None
    style_xp: Dict[str, int] = field(default_factory=dict)
    # conditions
    infected: bool = False
    infection_timer: int = 0
    bite_limb: str = ""              # arm | leg | torso | neck: where the infecting bite landed
    bite_window: int = 0             # turns left in which amputation can still save you
    lost: List[str] = field(default_factory=list)    # limbs amputated: "arm", "leg"
    bleeding: int = 0
    hemorrhage: bool = False         # a fresh stump: it will not stop bleeding by itself
    fracture: bool = False
    filter_turns: int = 0
    disguise_turns: int = 0
    sneaking: bool = False
    sprinting: bool = False
    light_on: bool = True
    # records
    kills: int = 0
    documents: List[str] = field(default_factory=list)
    recipes: List[str] = field(default_factory=lambda: list(STARTERS))    # what you know how to make
    stats: Dict[str, int] = field(default_factory=dict)

    # ------------------------------------------------------------ modifiers
    def mod(self, key: str) -> float:
        total = 0.0
        for pid, rank in self.perks.items():
            perk = PERKS.get(pid)
            if perk and key in perk.mods:
                total += perk.mods[key] * rank
        return total

    def bump(self, stat: str, n: int = 1) -> None:
        self.stats[stat] = self.stats.get(stat, 0) + n

    @property
    def evade(self) -> float:
        return (5 + self.mod("evade") - (6 if self.fracture else 0) - (8 if "leg" in self.lost else 0)
                - (4 if len(self.lost) >= 2 else 0))

    # ------------------------------------------------------------ progression
    def style_rank(self, style: str) -> int:
        xp = self.style_xp.get(style, 0)
        rank = 0
        while rank < STYLE_RANKS and xp >= 8 * (rank + 1) * (rank + 2) // 2:
            rank += 1
        return rank

    def gain_xp(self, amount: int) -> int:
        """Add experience; returns the number of levels gained."""
        gained = 0
        self.xp += amount
        while self.level < MAX_LEVEL and self.xp >= xp_for(self.level):
            self.xp -= xp_for(self.level)
            self.level += 1
            self.perk_points += 1
            self.max_hp += 3
            self.hp = min(self.max_hp, self.hp + 8)
            self.max_stamina += 2
            gained += 1
        return gained

    def learn_perk(self, perk_id: str) -> bool:
        perk = PERKS[perk_id]
        rank = self.perks.get(perk_id, 0)
        if self.perk_points < 1 or rank >= perk.max_rank:
            return False
        self.perks[perk_id] = rank + 1
        self.perk_points -= 1
        if "max_hp" in perk.mods:
            self.max_hp += int(perk.mods["max_hp"])
            self.hp += int(perk.mods["max_hp"])
        return True

    def grant_perk(self, perk_id: str, ranks: int = 1) -> None:
        """Origin perks are free and bypass the point cost."""
        perk = PERKS[perk_id]
        have = self.perks.get(perk_id, 0)
        new = min(perk.max_rank, have + ranks)
        self.perks[perk_id] = new
        if "max_hp" in perk.mods:
            self.max_hp += int(perk.mods["max_hp"]) * (new - have)
            self.hp = self.max_hp

    # ------------------------------------------------------------ inventory
    def count(self, item_id: str) -> int:
        return sum(i.qty for i in self.inventory if i.id == item_id)

    @property
    def capacity(self) -> int:
        return INVENTORY_SLOTS - (8 if "arm" in self.lost else 0)     # one arm carries less

    def slots_used(self) -> int:
        return sum(1 for i in self.inventory if not i.key)

    def can_hold(self, item: Item, stackable: bool) -> bool:
        if item.key or (stackable and any(i.id == item.id for i in self.inventory)):
            return True
        return self.slots_used() < self.capacity

    def add_item(self, item: Item, stackable: bool) -> bool:
        if not self.can_hold(item, stackable):
            return False
        if stackable or item.key:
            for have in self.inventory:
                if have.id == item.id:
                    have.qty += item.qty
                    return True
        self.inventory.append(item)
        return True

    def take(self, item_id: str, qty: int = 1) -> bool:
        """Remove ``qty`` of a stackable id from the inventory.  False if there is not enough."""
        if self.count(item_id) < qty:
            return False
        for have in list(self.inventory):
            if have.id != item_id:
                continue
            used = min(qty, have.qty)
            have.qty -= used
            qty -= used
            if have.qty <= 0:
                self.inventory.remove(have)
            if qty <= 0:
                break
        return True

    def equipped(self) -> List[Item]:
        return [i for i in (self.weapon, self.armor, self.light) if i is not None]
