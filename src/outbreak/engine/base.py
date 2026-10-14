"""A base of your own: claim a cleared building, fit it out, and hold it.

Claim an interior once nothing hostile is left in it.  Inside it you can build a workshop (weapons are made beside
one), cots (sleep, safely), a locker (a stash that outlives you) and barricades (braced gates the dead must batter
down).  At night the dead find it and come in through the entrance in a raid, so the fittings matter.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import List, Optional, Tuple

from outbreak.engine import tiles as T
from outbreak.engine.model import Human, Item, Zombie
from outbreak.util import DIRS4, DIRS8

BARRICADE_HP = 40
RAID_GAP = 150                                # turns between raids at the soonest


@dataclass(frozen=True)
class Structure:
    id: str
    name: str
    tile: int
    cost: Tuple[Tuple[str, int], ...]
    desc: str
    limit: int


STRUCTURES = (
    Structure("workshop", "Workshop", T.WORKSHOP, (("wood", 4), ("scrap", 3)), "Weapons are made beside it.", 1),
    Structure("cot", "Cot", T.BED, (("wood", 2), ("cloth", 3)), "Somewhere safe to sleep and heal.", 2),
    Structure("locker", "Locker", T.LOCKER, (("wood", 3), ("scrap", 2)), "A stash that survives you.", 1),
    Structure("barricade", "Barricade", T.DOOR, (("wood", 2), ("scrap", 1)),
              "A braced gate. The dead have to batter it down.", 6),
)
BY_ID = {s.id: s for s in STRUCTURES}


def in_base(game) -> bool:
    return game.base_id is not None and game.level.id == game.base_id


def hostiles_in(level) -> List:
    return [a for a in level.actors if (isinstance(a, Zombie) and a.hp > 0) or (isinstance(a, Human) and a.hostile and a.hp > 0)]


def can_claim(game) -> str:
    """'' if you can claim here, else the reason you cannot."""
    lv = game.level
    if lv.kind != "interior":
        return "A base has to be a building with walls: step inside one."
    if game.base_id == lv.id:
        return "This is already your base."
    if hostiles_in(lv):
        return "Something is still in here. Clear it first."
    return ""


def claim(game) -> int:
    reason = can_claim(game)
    if reason:
        game.msg(reason, "warn")
        return 0
    old = game.base_id
    lv = game.level
    if old and old in game.levels:
        game.levels[old].safe = False
    game.base_id = lv.id
    lv.safe = True
    game.raid_next = game.clock.turn + RAID_GAP
    game.msg(f"You claim {lv.name} as your base." + (" The old one is left to the dead." if old else ""), "good", key=True)
    return 2


def _count(level, sid: str) -> int:
    return sum(1 for v in level.built.values() if v == sid)


def _connected(level, start, goal) -> bool:
    seen, q = {start}, deque([start])
    while q:
        x, y = q.popleft()
        if (x, y) == goal:
            return True
        for dx, dy in DIRS4:
            n = (x + dx, y + dy)
            if n not in seen and level.walkable(*n):
                seen.add(n)
                q.append(n)
    return False


def status(game, s: Structure) -> Tuple[bool, str]:
    if not in_base(game):
        return False, "only in your base"
    if _count(game.level, s.id) >= s.limit:
        return False, "you have all you need"
    missing = [f"{q}x {game.item_def(i).name.lower()}" for i, q in s.cost if game.player.count(i) < q]
    return (False, "missing " + ", ".join(missing)) if missing else (True, "")


def _site(game) -> Optional[Tuple[int, int]]:
    lv, p = game.level, game.player
    for dx, dy in DIRS4 + tuple(d for d in DIRS8 if d not in DIRS4):
        pos = (p.x + dx, p.y + dy)
        if lv.tile(*pos) == T.FLOOR and pos not in lv.occ and pos not in lv.items and pos not in lv.portals \
                and pos not in lv.containers and pos not in lv.hazards:
            return pos
    return None


def build(game, sid: str) -> int:
    s = BY_ID.get(sid)
    if s is None:
        return 0
    ok, why = status(game, s)
    if not ok:
        game.msg(f"You cannot build that: {why}.", "warn")
        return 0
    lv, p = game.level, game.player
    pos = _site(game)
    if pos is None:
        game.msg("There is no clear floor next to you to build on.", "warn")
        return 0
    lv.set_tile(pos[0], pos[1], s.tile)
    if not _connected(lv, p.pos, lv.entry):               # never wall yourself in
        lv.set_tile(pos[0], pos[1], T.FLOOR)
        game.msg("That would block the way through. Build somewhere else.", "warn")
        return 0
    for item_id, qty in s.cost:
        p.take(item_id, qty)
    lv.built[pos] = s.id
    if s.id == "barricade":
        lv.door_hp[pos] = BARRICADE_HP
    p.gain_xp(4)
    game.msg(f"You build a {s.name.lower()}.", "good", key=s.id != "barricade")
    return 4


# ------------------------------------------------------------------ the locker
def stash_put(game, index: int) -> bool:
    lv, p = game.level, game.player
    if not (0 <= index < len(p.inventory)):
        return False
    item = p.inventory[index]
    if item is p.weapon or item is p.armor or item is p.light:
        game.msg("Unequip it first.", "warn")
        return False
    p.inventory.pop(index)
    for have in lv.stash:
        if have.id == item.id and game.item_def(item.id).stackable:
            have.qty += item.qty
            break
    else:
        lv.stash.append(item)
    game.msg(f"You put the {game.item_def(item.id).name.lower()} in the locker.", "info")
    return True


def stash_take(game, index: int) -> bool:
    lv, p = game.level, game.player
    if not (0 <= index < len(lv.stash)):
        return False
    item = lv.stash[index]
    if not p.add_item(item, game.item_def(item.id).stackable):
        game.msg("Your pack is full.", "warn")
        return False
    lv.stash.pop(index)
    game.msg(f"You take the {game.item_def(item.id).name.lower()} from the locker.", "info")
    return True
