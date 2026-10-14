"""Building interiors: houses, multi-floor points of interest with a locked
vault on the last floor, and the two safe havens (refuge and extraction point)."""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

from outbreak.content.eras import EraPack
from outbreak.content.zombies import ZombieProfile
from outbreak.engine import loot
from outbreak.engine import tiles as T
from outbreak.engine.model import POI, Container, Hazard, Item, Level, Portal
from outbreak.engine.worldgen import UNSET
from outbreak.util import DIRS4, Pos, cheb

Rect = Tuple[int, int, int, int]

HOUSE_SIZE = (9, 7)
LEVEL_SIZE = (46, 28)
CRATES_PER_ROOM = {"medical": 1.0, "market": 1.0, "guard": 0.8, "lab": 0.8, "transit": 0.5, "military": 1.0,
                   "faith": 0.7, "industry": 0.9}


@dataclass
class GenContext:
    """Everything an interior generator needs from the running game."""
    era: EraPack
    profile: ZombieProfile
    loot_mult: float
    zombie_mult: float
    spawn: Callable[..., object]          # spawn(level, pos, special=None, dormant=True)
    day: int = 1


# ------------------------------------------------------------------ geometry
def _center(r: Rect) -> Pos:
    return (r[0] + r[2] // 2, r[1] + r[3] // 2)


def _ring(r: Rect, x: int, y: int) -> bool:
    return (x in (r[0] - 1, r[0] + r[2]) and r[1] - 1 <= y <= r[1] + r[3]) or \
           (y in (r[1] - 1, r[1] + r[3]) and r[0] - 1 <= x <= r[0] + r[2])


def _carve(level: Level, r: Rect, tile: int = T.FLOOR) -> None:
    for y in range(r[1], r[1] + r[3]):
        for x in range(r[0], r[0] + r[2]):
            level.set_tile(x, y, tile)


def _overlaps(a: Rect, b: Rect, margin: int = 2) -> bool:
    return not (a[0] + a[2] + margin <= b[0] or b[0] + b[2] + margin <= a[0] or
                a[1] + a[3] + margin <= b[1] or b[1] + b[3] + margin <= a[1])


def _corridor(level: Level, a: Pos, b: Pos, rng: random.Random) -> List[Pos]:
    """Carve an L-shaped corridor; return the tiles that were walls before."""
    x, y = a
    opened: List[Pos] = []
    legs = [(b[0], y), b] if rng.random() < 0.5 else [(x, b[1]), b]
    for tx, ty in legs:
        while (x, y) != (tx, ty):
            x += (tx > x) - (tx < x)
            y += (ty > y) - (ty < y)
            if level.tile(x, y) == T.WALL:
                level.set_tile(x, y, T.FLOOR)
                opened.append((x, y))
    return opened


def _place_rooms(rng: random.Random, w: int, h: int, count: int, avoid: Optional[List[Rect]] = None) -> List[Rect]:
    rooms: List[Rect] = list(avoid or [])
    mine: List[Rect] = []
    for _ in range(400):
        if len(mine) >= count:
            break
        rw, rh = rng.randint(5, 10), rng.randint(4, 7)
        r = (rng.randint(2, w - rw - 3), rng.randint(2, h - rh - 3), rw, rh)
        if any(_overlaps(r, o) for o in rooms):
            continue
        rooms.append(r)
        mine.append(r)
    return mine


def _door_pass(level: Level, rooms: List[Rect], rng: random.Random, p: float = 0.55) -> None:
    """Turn narrow openings on room borders into doors."""
    for r in rooms:
        for y in range(r[1] - 1, r[1] + r[3] + 1):
            for x in range(r[0] - 1, r[0] + r[2] + 1):
                if not _ring(r, x, y) or level.tile(x, y) != T.FLOOR:
                    continue
                horizontal = level.tile(x - 1, y) == T.WALL and level.tile(x + 1, y) == T.WALL
                vertical = level.tile(x, y - 1) == T.WALL and level.tile(x, y + 1) == T.WALL
                if (horizontal or vertical) and rng.random() < p:
                    level.set_tile(x, y, T.DOOR)


def _near_opening(level: Level, x: int, y: int) -> bool:
    for dx, dy in DIRS4:
        if level.tile(x + dx, y + dy) in (T.DOOR, T.LOCKED, T.STAIRS_UP, T.STAIRS_DOWN, T.PORTAL):
            return True
    return False


def _crate_spots(level: Level, room: Rect) -> List[Pos]:
    """Floor tiles against a wall that cannot block a passage."""
    spots = []
    for y in range(room[1], room[1] + room[3]):
        for x in range(room[0], room[0] + room[2]):
            if level.tile(x, y) != T.FLOOR or _near_opening(level, x, y):
                continue
            walls = sum(1 for dx, dy in DIRS4 if level.tile(x + dx, y + dy) == T.WALL)
            if walls >= 1 and all(level.tile(x + dx, y + dy) != T.FLOOR or _inside(room, x + dx, y + dy)
                                  for dx, dy in DIRS4):
                spots.append((x, y))
    return spots


def _inside(r: Rect, x: int, y: int) -> bool:
    return r[0] <= x < r[0] + r[2] and r[1] <= y < r[1] + r[3]


# ------------------------------------------------------------------ content
def _stock_crates(level: Level, rng: random.Random, ctx: GenContext, kind: str, rooms: List[Rect],
                  per_room: float, taken: set, docs: List[str]) -> List[Pos]:
    placed: List[Pos] = []
    for room in rooms:
        spots = [s for s in _crate_spots(level, room) if s not in taken]
        rng.shuffle(spots)
        n = int(per_room) + (1 if rng.random() < per_room - int(per_room) else 0)
        for pos in spots[:n]:
            if any(cheb(pos, q) < 2 for q in placed):
                continue
            level.set_tile(pos[0], pos[1], T.CRATE)
            level.containers[pos] = Container(
                loot=loot.roll_items(rng, ctx.era, kind, rng.uniform(1.5, 3.2), ctx.loot_mult),
                coins=loot.roll_coins(rng, ctx.loot_mult))
            placed.append(pos)
    # documents ride in crates (or in any crate that exists)
    crates = [p for p in placed if not level.containers[p].note]
    rng.shuffle(crates)
    for doc_id, pos in zip(docs, crates):
        level.containers[pos].docs.append(doc_id)
    return placed


def _place_loose_docs(level: Level, docs: List[str]) -> None:
    """Documents that found no crate lie on the floor near the entrance rather than vanish."""
    stocked = {d for c in level.containers.values() for d in c.docs}
    for doc_id in docs:
        if doc_id in stocked:
            continue
        spot = level.free_spot_near(level.entry[0], level.entry[1], 5)
        if spot:
            level.docs.setdefault(spot, []).append(doc_id)


def _scatter_zombies(level: Level, rng: random.Random, ctx: GenContext, rooms: List[Rect], danger: float,
                     per_room: float, skip: Optional[Rect] = None) -> None:
    for room in rooms:
        if skip and room == skip:
            continue
        expected = per_room * danger * ctx.zombie_mult * ctx.profile.density
        n = int(expected) + (1 if rng.random() < expected - int(expected) else 0)
        for _ in range(n):
            pos = (rng.randint(room[0], room[0] + room[2] - 1), rng.randint(room[1], room[1] + room[3] - 1))
            if level.free(*pos) and level.tile(*pos) == T.FLOOR:
                ctx.spawn(level, pos, None, True)


def _spore_patches(level: Level, rng: random.Random, ctx: GenContext, rooms: List[Rect], p: float) -> None:
    if ctx.profile.vector != "spore":
        return
    for room in rooms:
        if rng.random() > p:
            continue
        cx, cy = _center(room)
        for dy in range(-1, 2):
            for dx in range(-2, 3):
                if level.tile(cx + dx, cy + dy) == T.FLOOR and rng.random() < 0.7:
                    level.hazards[(cx + dx, cy + dy)] = Hazard("spore", 10 ** 9)


# ------------------------------------------------------------------ houses
def generate_house(rng: random.Random, poi: POI, ctx: GenContext, docs: List[str]) -> Level:
    w, h = HOUSE_SIZE
    level = Level(poi.level_id, poi.name, w + 4, h + 4, "interior")
    room: Rect = (2, 2, w, h)
    _carve(level, room)
    if rng.random() < 0.6:                                    # a dividing wall with a door
        wx = rng.randint(room[0] + 3, room[0] + w - 4)
        for y in range(room[1], room[1] + h):
            level.set_tile(wx, y, T.WALL)
        level.set_tile(wx, room[1] + rng.randint(1, h - 2), T.DOOR)
    ex, ey = 2 + w // 2, 2 + h - 1
    level.set_tile(ex, ey, T.PORTAL)
    level.portals[(ex, ey)] = Portal("world", poi.pos, "outside")
    level.entry = (ex, ey - 1)
    level.arrivals["entry"] = level.entry
    sub_rooms = [(2, 2, w, h)]
    _stock_crates(level, rng, ctx, "house", sub_rooms, rng.uniform(1.5, 2.6), {level.entry}, docs)
    _place_loose_docs(level, docs)
    _scatter_zombies(level, rng, ctx, sub_rooms, poi.danger, 1.1)
    # keep the entry clear
    occ = level.occ.get(level.entry)
    if occ is not None:
        level.remove_actor(occ)
    return level


# ------------------------------------------------------------------ multi-floor buildings
def generate_floor(rng: random.Random, poi: POI, floor: int, ctx: GenContext, docs: List[str]) -> Level:
    """One floor of a point of interest.  Stairs link floors; the last floor holds the vault."""
    w, h = LEVEL_SIZE
    last = floor == poi.floors - 1
    level = Level(f"{poi.id}:{floor}", f"{poi.name} - floor {floor + 1}", w, h, "interior")
    n_rooms = rng.randint(7, 10)
    rooms = _place_rooms(rng, w, h, n_rooms + (1 if last and poi.component else 0))
    if len(rooms) < 4:                                       # pathological roll: try again deterministically
        rooms = _place_rooms(rng, w, h, n_rooms)
    vault: Optional[Rect] = None
    if last and poi.component and len(rooms) >= 5:
        vault = min(rooms[1:], key=lambda r: r[2] * r[3])
        rooms = [r for r in rooms if r != vault]
    for r in rooms:
        _carve(level, r)
    # connect rooms: nearest-neighbour chain plus a couple of loops
    connected = [rooms[0]]
    rest = rooms[1:]
    while rest:
        a, b = min(((a, b) for a in connected for b in rest),
                   key=lambda p: cheb(_center(p[0]), _center(p[1])))
        _corridor(level, _center(a), _center(b), rng)
        connected.append(b)
        rest.remove(b)
    for _ in range(2):
        a, b = rng.sample(rooms, 2)
        _corridor(level, _center(a), _center(b), rng)

    vault_pos: Optional[Pos] = None
    if vault is not None:
        _carve(level, vault)
        nearest = min(rooms, key=lambda r: cheb(_center(r), _center(vault)))
        opened = _corridor(level, _center(nearest), _center(vault), rng)
        for p in opened:                                      # the first tile on the vault wall is the lock
            if _ring(vault, *p):
                level.set_tile(p[0], p[1], T.LOCKED)
                vault_pos = p
                break
        if vault_pos is None:                                 # corridor never crossed the ring: lock the nearest gap
            for y in range(vault[1] - 1, vault[1] + vault[3] + 1):
                for x in range(vault[0] - 1, vault[0] + vault[2] + 1):
                    if vault_pos is None and _ring(vault, x, y) and level.tile(x, y) == T.FLOOR:
                        level.set_tile(x, y, T.LOCKED)
                        vault_pos = (x, y)
    _door_pass(level, rooms, rng)

    # entry / stairs
    bottom = max(rooms, key=lambda r: r[1] + r[3])
    far = max(rooms, key=lambda r: cheb(_center(r), _center(bottom)))
    if floor == 0:
        ex, ey = bottom[0] + bottom[2] // 2, bottom[1] + bottom[3] - 1
        level.set_tile(ex, ey, T.PORTAL)
        level.portals[(ex, ey)] = Portal("world", poi.pos, "outside")
        level.entry = (ex, ey - 1)
        level.arrivals["entry"] = level.entry
        up_room = bottom
    else:
        ux, uy = _center(bottom)
        level.set_tile(ux, uy, T.STAIRS_UP)
        level.portals[(ux, uy)] = Portal(f"{poi.id}:{floor - 1}", UNSET, "up", "from_below")
        level.arrivals["from_above"] = (ux + 1, uy) if level.walkable(ux + 1, uy) else (ux, uy + 1)
        level.entry = level.arrivals["from_above"]
        up_room = bottom
    if not last:
        dr = far if far != up_room else rooms[-1]
        dx, dy = _center(dr)
        level.set_tile(dx, dy, T.STAIRS_DOWN)
        level.portals[(dx, dy)] = Portal(f"{poi.id}:{floor + 1}", UNSET, "down", "from_above")
        level.arrivals["from_below"] = (dx + 1, dy) if level.walkable(dx + 1, dy) else (dx, dy + 1)
    for key, pos in list(level.arrivals.items()):
        if not level.walkable(*pos):                          # never arrive inside a wall
            level.arrivals[key] = level.free_spot_near(*pos, 3) or pos
    level.entry = level.arrivals.get("entry") or level.arrivals.get("from_above") or level.entry

    # contents
    reserved = {p for p in level.arrivals.values()}
    stock_rooms = [r for r in rooms]
    _stock_crates(level, rng, ctx, poi.kind, stock_rooms, CRATES_PER_ROOM.get(poi.kind, 0.8), reserved, docs)
    _place_loose_docs(level, docs)
    hall = max(rooms, key=lambda r: r[2] * r[3])
    _scatter_zombies(level, rng, ctx, rooms, poi.danger * (1.0 + 0.25 * floor), 1.0, skip=up_room if floor == 0 else None)
    if poi.kind == "faith":                                   # a congregation in the main hall
        for _ in range(rng.randint(3, 6)):
            ctx.spawn(level, _center(hall), None, True)
    _spore_patches(level, rng, ctx, rooms, 0.4 if poi.kind in ("lab", "medical", "transit", "industry") else 0.1)
    if vault is not None:
        _fill_vault(level, rng, ctx, poi, vault, vault_pos)
    for z in list(level.actors):                              # nothing waiting on the arrival tiles
        if z.pos in reserved or cheb(z.pos, level.entry) < 2:
            level.remove_actor(z)
    return level


def _fill_vault(level: Level, rng: random.Random, ctx: GenContext, poi: POI, vault: Rect, lock: Optional[Pos]) -> None:
    cx, cy = _center(vault)
    level.set_tile(cx, cy, T.CRATE)
    level.containers[cx, cy] = Container(
        loot=loot.roll_items(rng, ctx.era, poi.kind, 2.5, ctx.loot_mult), note="vault")
    for _ in range(2 + int(poi.danger > 1.2)):
        pos = (rng.randint(vault[0], vault[0] + vault[2] - 1), rng.randint(vault[1], vault[1] + vault[3] - 1))
        if level.free(*pos) and pos != (cx, cy):
            ctx.spawn(level, pos, "brute" if rng.random() < 0.4 else None, True)
    level.vault_lock = lock


# ------------------------------------------------------------------ havens
def generate_haven(rng: random.Random, poi: POI, ctx: GenContext) -> Level:
    """The refuge (cure bench, trader, healer, scholar) and the extraction point (console)."""
    w, h = 30, 16
    level = Level(poi.level_id, poi.name, w, h, "haven")
    level.safe = True
    hall: Rect = (2, 2, w - 4, h - 4)
    _carve(level, hall)
    ex, ey = w // 2, hall[1] + hall[3]                       # the exit sits in the bottom wall
    level.set_tile(ex, ey, T.PORTAL)
    level.portals[(ex, ey)] = Portal("world", poi.pos, "outside")
    level.entry = (ex, ey - 1)
    level.arrivals["entry"] = level.entry
    for pos in ((hall[0] - 1, hall[1] + hall[3] // 2), (hall[0] + hall[2], hall[1] + hall[3] // 2),
                (w // 2, hall[1] - 1)):                      # side doors: the places a siege breaks in
        level.set_tile(pos[0], pos[1], T.DOOR)
    for i in range(3):
        level.set_tile(hall[0] + 1 + 2 * i, hall[1], T.BED)
    level.bench = (hall[0] + hall[2] - 3, hall[1] + 1)
    level.set_tile(*level.bench, T.BENCH)
    for x, y in ((hall[0] + hall[2] - 1, hall[1] + hall[3] - 1), (hall[0], hall[1] + hall[3] - 1)):
        level.set_tile(x, y, T.CRATE)
        level.containers[x, y] = Container(loot=loot.roll_items(rng, ctx.era, "refuge", 2, ctx.loot_mult))
    return level


# ------------------------------------------------------------------ caves
CAVE_SIZE = (44, 30)


def _cave_floor(rng: random.Random, w: int, h: int) -> set:
    """Cellular automaton: random rock, smoothed into winding chambers; the largest connected part is the cave."""
    for _try in range(12):
        floor = {(x, y) for y in range(2, h - 2) for x in range(2, w - 2) if rng.random() < 0.47}
        for _ in range(4):
            nxt = set()
            for y in range(2, h - 2):
                for x in range(2, w - 2):
                    n = sum(1 for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx or dy) and (x + dx, y + dy) in floor)
                    if n >= 4:
                        nxt.add((x, y))
            floor = nxt
        best: set = set()
        seen: set = set()
        for start in floor:
            if start in seen:
                continue
            comp, queue = {start}, [start]
            seen.add(start)
            while queue:
                cx, cy = queue.pop()
                for dx, dy in DIRS4:
                    q = (cx + dx, cy + dy)
                    if q in floor and q not in seen:
                        seen.add(q)
                        comp.add(q)
                        queue.append(q)
            if len(comp) > len(best):
                best = comp
        if len(best) >= 330:
            return best
    return {(x, y) for y in range(8, h - 8) for x in range(8, w - 8)}          # a plain chamber if the dice never gave a cave


def generate_cave(rng: random.Random, poi: POI, ctx: GenContext) -> Level:
    """A dark system of chambers: unlit you see three tiles.  Dormant dead in nests, rich crates, mushrooms, and
    spore beds when the plague is a spore.  The way out is where you came in."""
    w, h = CAVE_SIZE
    level = Level(poi.level_id, poi.name, w, h, "interior")
    floor = _cave_floor(rng, w, h)
    for x, y in floor:
        level.set_tile(x, y, T.FLOOR)
    # the mouth: the floor tile lowest on the map, with the doorway in the wall beneath it
    ex, ey = max(floor, key=lambda t: (t[1], -abs(t[0] - w // 2)))
    door = (ex, ey + 1)
    level.set_tile(door[0], door[1], T.PORTAL)
    level.portals[door] = Portal("world", poi.pos, "outside")
    level.entry = (ex, ey)
    level.arrivals["entry"] = level.entry
    far = [t for t in floor if cheb(t, level.entry) >= 9]
    rng.shuffle(far)
    # dormant dead sleep in nests of two to four, so waking one is a decision
    nests = max(2, int(round(3 * poi.danger * ctx.zombie_mult * ctx.profile.density)))
    for _ in range(nests):
        if not far:
            break
        cx, cy = far.pop()
        for _m in range(rng.randint(2, 4)):
            spot = level.free_spot_near(cx, cy, 2)
            if spot and spot in floor:
                ctx.spawn(level, spot, None, True)
    # crates sit in dead ends and far chambers
    crates = 0
    for pos in sorted(far, key=lambda t: -cheb(t, level.entry))[:90]:
        if crates >= 7:
            break
        walls = sum(1 for dx, dy in DIRS4 if (pos[0] + dx, pos[1] + dy) not in floor)
        if walls >= 2 and level.free(*pos) and all(cheb(pos, c) >= 5 for c in level.containers):
            level.set_tile(pos[0], pos[1], T.CRATE)
            level.containers[pos] = Container(loot=loot.roll_items(rng, ctx.era, "cave", rng.uniform(3.0, 4.6), ctx.loot_mult),
                                              coins=loot.roll_coins(rng, ctx.loot_mult))
            crates += 1
    for pos in rng.sample(sorted(floor), min(len(floor), 7)):                      # pale mushrooms on the damp floor
        if pos != level.entry and pos not in level.containers:
            level.drop(pos, Item("mushroom", rng.randint(1, 2)))
    if ctx.profile.vector == "spore":                                               # spore beds: the dark suits them
        for _ in range(3):
            cx, cy = rng.choice(sorted(floor))
            if cheb((cx, cy), level.entry) < 8:
                continue
            for dy in range(-1, 2):
                for dx in range(-2, 3):
                    if (cx + dx, cy + dy) in floor and rng.random() < 0.7:
                        level.hazards[(cx + dx, cy + dy)] = Hazard("spore", 10 ** 9)
    occ = level.occ.get(level.entry)
    if occ is not None:
        level.remove_actor(occ)
    return level


def generate(poi: POI, floor: int, seed: int, ctx: GenContext, docs: List[str]) -> Level:
    """Entry point: deterministic per (seed, building, floor)."""
    rng = random.Random(f"{seed}:{poi.id}:{floor}")
    if poi.kind == "cave":
        return generate_cave(rng, poi, ctx)
    if poi.kind in ("refuge", "pad"):
        return generate_haven(rng, poi, ctx)
    if poi.kind == "house":
        return generate_house(rng, poi, ctx, docs)
    return generate_floor(rng, poi, floor, ctx, docs)
