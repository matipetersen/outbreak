"""Overworld generation: terrain, city blocks, buildings, points of interest, roads."""
from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List

from outbreak.content.eras import POI_KINDS, EraPack
from outbreak.engine import tiles as T
from outbreak.engine.model import POI, Level, Portal
from outbreak.util import DIRS4, Pos, cheb

UNSET: Pos = (-1, -1)          # portal arrival "use the level's entry point"

CAVE_NAMES = ("Cave", "Old mine", "Sinkhole", "Quarry tunnel")
CAVE_SIZE = (4, 2)
FLOORS = {"cave": 1, "medical": 3, "market": 2, "guard": 2, "lab": 3, "transit": 3, "military": 3, "faith": 2,
          "industry": 2, "refuge": 1, "pad": 1, "house": 1}
SIZES = {"faith": (9, 7), "industry": (13, 7), "refuge": (13, 8), "pad": (13, 8)}
DEFAULT_SIZE = (11, 7)
POI_ZONE = {"medical": 2, "market": 2, "guard": 2, "lab": 1, "transit": 2, "military": 0, "faith": 1, "industry": 0}


@dataclass
class World:
    level: Level
    pois: Dict[str, POI]
    start: Pos
    camps: List[Pos] = field(default_factory=list)
    zone: List[bytearray] = field(default_factory=list)       # 0 rural, 1 suburb, 2 city


# ------------------------------------------------------------------ noise
def _noise(rng: random.Random, w: int, h: int, scale: int, octaves: int = 3) -> List[List[float]]:
    out = [[0.0] * w for _ in range(h)]
    amp, total = 1.0, 0.0
    for o in range(octaves):
        s = max(2, scale >> o)
        grid = [[rng.random() for _ in range(w // s + 3)] for _ in range(h // s + 3)]
        for y in range(h):
            gy, fy = divmod(y, s)
            fy = fy / s
            fy = fy * fy * (3 - 2 * fy)
            r0, r1 = grid[gy], grid[gy + 1]
            row = out[y]
            for x in range(w):
                gx, fx = divmod(x, s)
                fx = fx / s
                fx = fx * fx * (3 - 2 * fx)
                top = r0[gx] + (r0[gx + 1] - r0[gx]) * fx
                bot = r1[gx] + (r1[gx + 1] - r1[gx]) * fx
                row[x] += (top + (bot - top) * fy) * amp
        total += amp
        amp *= 0.5
    return [[v / total for v in row] for row in out]


def _percentile(field: List[List[float]], p: float) -> float:
    flat = sorted(v for row in field for v in row)
    return flat[min(len(flat) - 1, int(len(flat) * p))]


# ------------------------------------------------------------------ helpers
class _Canvas:
    """Level plus a mask of tiles that buildings already claimed."""

    def __init__(self, level: Level):
        self.level = level
        self.taken = [bytearray(level.w) for _ in range(level.h)]

    def region_ok(self, x: int, y: int, w: int, h: int, margin: int = 1) -> bool:
        lv = self.level
        if x - margin < 1 or y - margin < 1 or x + w + margin >= lv.w - 1 or y + h + margin >= lv.h - 1:
            return False
        for yy in range(y - margin, y + h + margin):
            row = lv.tiles[yy]
            taken = self.taken[yy]
            for xx in range(x - margin, x + w + margin):
                if taken[xx] or row[xx] in (T.WATER, T.SHALLOW):
                    return False
        return True

    def claim(self, x: int, y: int, w: int, h: int, margin: int = 1) -> None:
        for yy in range(y - margin, y + h + margin):
            for xx in range(x - margin, x + w + margin):
                if 0 <= xx < self.level.w and 0 <= yy < self.level.h:
                    self.taken[yy][xx] = 1

    def block(self, x: int, y: int, w: int, h: int, door: Pos) -> None:
        """Solid building footprint with a door tile (``PORTAL``) in its wall."""
        lv = self.level
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                lv.set_tile(xx, yy, T.WALL)
        lv.set_tile(door[0], door[1], T.PORTAL)
        # a patch of road in front of the entrance so it is never boxed in
        fx, fy = door[0], door[1] + 1
        for dx in (-1, 0, 1):
            lv.set_tile(fx + dx, fy, T.ROAD)


def _line_road(level: Level, a: Pos, b: Pos) -> None:
    """Carve an L-shaped road, bridging water and cutting through forest."""
    x, y = a
    horizontal_first = (abs(a[0] - b[0]) > abs(a[1] - b[1]))
    legs = [(b[0], y), (b[0], b[1])] if horizontal_first else [(x, b[1]), (b[0], b[1])]
    for tx, ty in legs:
        while (x, y) != (tx, ty):
            x += (tx > x) - (tx < x)
            y += (ty > y) - (ty < y)
            if level.in_bounds(x, y) and level.tile(x, y) not in (T.WALL, T.PORTAL, T.FENCE):
                level.set_tile(x, y, T.ROAD)


# ------------------------------------------------------------------ main entry
def generate_overworld(rng: random.Random, era: EraPack, w: int, h: int) -> World:
    level = Level("world", era.terrain["urban"], w, h, "overworld", fill=T.GRASS)
    elev = _noise(rng, w, h, 28)
    urb = _noise(rng, w, h, 34)
    wood = _noise(rng, w, h, 14)
    water_thr, shallow_thr = _percentile(elev, 0.11), _percentile(elev, 0.15)
    city_thr, sub_thr = _percentile(urb, 0.72), _percentile(urb, 0.46)
    wood_thr = _percentile(wood, 0.55)

    zone = [bytearray(w) for _ in range(h)]
    for y in range(h):
        for x in range(w):
            e = elev[y][x]
            if e < water_thr:
                level.tiles[y][x] = T.WATER
            elif e < shallow_thr:
                level.tiles[y][x] = T.SHALLOW
            else:
                u = urb[y][x]
                z = 2 if u >= city_thr else 1 if u >= sub_thr else 0
                zone[y][x] = z
                if z == 0 and wood[y][x] > wood_thr:
                    roll = rng.random()
                    level.tiles[y][x] = T.TREE if roll < 0.55 else T.BRUSH if roll < 0.85 else T.GRASS
                elif z == 0 and rng.random() < 0.02:
                    level.tiles[y][x] = T.BRUSH
    # clear a one-tile border so nothing is sealed against the edge
    for x in range(w):
        for y in (0, h - 1):
            level.tiles[y][x] = T.TREE
    for y in range(h):
        for x in (0, w - 1):
            level.tiles[y][x] = T.TREE

    _street_grid(level, zone)
    for x in range(w):
        level.tiles[0][x] = level.tiles[h - 1][x] = T.TREE
    for y in range(h):
        level.tiles[y][0] = level.tiles[y][w - 1] = T.TREE
    canvas = _Canvas(level)
    pois: Dict[str, POI] = {}
    world = World(level, pois, (w // 2, h // 2), zone=zone)

    start = _place_start(rng, canvas, era, world)
    world.start = start
    sites = _place_special_sites(rng, canvas, era, world)
    _place_pois(rng, canvas, era, world)
    _place_houses(rng, canvas, era, world)
    _place_camps(rng, canvas, world)
    _place_caves(rng, canvas, world)
    _link_roads(rng, level, world, sites)
    _ensure_connected(level, world)
    return world


# ------------------------------------------------------------------ pieces
CELL_W, CELL_H = 9, 7


def _street_grid(level: Level, zone: List[bytearray]) -> None:
    """Streets: every cell edge in the city, every other one in the suburbs."""
    for y in range(level.h):
        for x in range(level.w):
            z = zone[y][x]
            if z == 0 or level.tiles[y][x] in (T.WATER, T.SHALLOW):
                continue
            row_street = y % CELL_H == 0 and (z == 2 or (y // CELL_H) % 2 == 0)
            col_street = x % CELL_W == 0 and (z == 2 or (x // CELL_W) % 2 == 0)
            if row_street or col_street:
                level.tiles[y][x] = T.ROAD



def _poi(world: World, kind: str, name: str, door: Pos, box, danger: float = 1.0) -> POI:
    pid = f"{kind[:3]}{len(world.pois)}"
    poi = POI(pid, kind, name, door[0], door[1], box=box, floors=FLOORS.get(kind, 1), danger=danger)
    world.pois[pid] = poi
    world.level.portals[door] = Portal(poi.level_id, (-1, -1), name)
    return poi


def _place_start(rng, canvas: _Canvas, era: EraPack, world: World) -> Pos:
    lv = canvas.level
    cx, cy = lv.w // 2, lv.h // 2
    for _ in range(400):
        x = cx + rng.randint(-14, 14)
        y = cy + rng.randint(-9, 9)
        if canvas.region_ok(x - 4, y - 3, 9, 7, 0):
            for yy in range(y - 3, y + 4):
                for xx in range(x - 4, x + 5):
                    t = T.ROAD if (yy == y or xx == x) else T.GRASS
                    if rng.random() < 0.08 and t == T.GRASS:
                        t = T.RUBBLE
                    lv.set_tile(xx, yy, t)
            canvas.claim(x - 4, y - 3, 9, 7, 1)
            poi = POI("breach", "breach", era.breach, x, y, box=(x - 4, y - 3, 9, 7), revealed=True, visited=True)
            world.pois["breach"] = poi
            return (x, y)
    # extremely unlikely: fall back to the map centre and clear it by force
    for yy in range(cy - 2, cy + 3):
        for xx in range(cx - 3, cx + 4):
            lv.set_tile(xx, yy, T.ROAD)
    world.pois["breach"] = POI("breach", "breach", era.breach, cx, cy, revealed=True, visited=True)
    return (cx, cy)


def _try_site(rng, canvas, world, kind, name, w, h, min_start, avoid, tries=1500):
    """Place a special site far from the start; relax the distance rather than fail on an unlucky map."""
    lv = canvas.level
    for attempt in range(tries):
        relax = 1.0 - 0.6 * attempt / tries                      # 1.0 -> 0.4 of the wanted distance
        x = rng.randint(3, lv.w - w - 3)
        y = rng.randint(3, lv.h - h - 4)
        door = (x + w // 2, y + h - 1)
        if cheb(door, world.start) < min_start * relax:
            continue
        if any(cheb(door, a.pos) < 28 * relax for a in avoid):
            continue
        if not canvas.region_ok(x, y, w, h, 2):
            continue
        canvas.claim(x, y, w, h, 2)
        canvas.block(x, y, w, h, door)
        return _poi(world, kind, name, door, (x, y, w, h), danger=1.2)
    raise RuntimeError(f"could not place {kind}: map {lv.w}x{lv.h} is too small or too wet")


def _place_special_sites(rng, canvas, era, world) -> List[POI]:
    far = int(min(canvas.level.w, canvas.level.h * 1.6) * 0.42)
    refuge = _try_site(rng, canvas, world, "refuge", era.refuge, *SIZES["refuge"], far, [])
    pad_name = era.pad[4:] if era.pad.startswith("the ") else era.pad
    pad = _try_site(rng, canvas, world, "pad", pad_name[:1].upper() + pad_name[1:], *SIZES["pad"], far, [refuge])
    refuge.revealed = True
    return [refuge, pad]


def _try_poi(rng, canvas, era, world, kind: str, spacing: int, tries: int = 500, use_zone: bool = True) -> bool:
    w, h = SIZES.get(kind, DEFAULT_SIZE)
    lv = canvas.level
    for _ in range(tries):
        x = rng.randint(3, lv.w - w - 3)
        y = rng.randint(3, lv.h - h - 4)
        door = (x + w // 2, y + h - 1)
        if use_zone and world.zone[y + h // 2][x + w // 2] < POI_ZONE[kind] and rng.random() < 0.85:
            continue
        if cheb(door, world.start) < 12 or any(cheb(door, p.pos) < spacing for p in world.pois.values()
                                                if p.kind != "breach"):
            continue
        if not canvas.region_ok(x, y, w, h, 1):
            continue
        canvas.claim(x, y, w, h, 1)
        canvas.block(x, y, w, h, door)
        names = era.pois[kind]
        n = sum(1 for p in world.pois.values() if p.kind == kind)
        name = names[n % len(names)] + (f" {n // len(names) + 1}" if n >= len(names) else "")
        _poi(world, kind, name, door, (x, y, w, h), danger=round(rng.uniform(0.9, 1.5), 2))
        return True
    return False


def _place_pois(rng, canvas, era, world) -> None:
    lv = canvas.level
    copies = 2 if lv.w * lv.h >= 8000 else 1                 # small maps get fewer buildings
    kinds = list(POI_KINDS) * copies + rng.sample(POI_KINDS, 4 if copies == 2 else 2)
    rng.shuffle(kinds)
    for kind in kinds:
        _try_poi(rng, canvas, era, world, kind, 14)
    # scenarios need at least one of every kind: squeeze it in, relaxing the rules, if the map was crowded
    for kind in POI_KINDS:
        if any(p.kind == kind for p in world.pois.values()):
            continue
        attempts = [(10, True), (6, True), (6, False), (3, False), (1, False)]
        if not any(_try_poi(rng, canvas, era, world, kind, spacing, 1500, zone) for spacing, zone in attempts):
            raise RuntimeError(f"could not place a {kind} building; map too small")


def _place_houses(rng, canvas, era, world) -> None:
    lv = canvas.level
    zone = world.zone
    count = 0
    for by in range(CELL_H, lv.h - CELL_H - 2, CELL_H):
        for bx in range(CELL_W, lv.w - CELL_W - 2, CELL_W):
            z = zone[by + 3][bx + 4]
            p_build = 0.85 if z == 2 else 0.5 if z == 1 else 0.06
            if rng.random() > p_build:
                continue
            w, h = rng.randint(4, 6), rng.randint(3, 4)
            x, y = bx + 1 + rng.randint(0, 2), by + 1 + rng.randint(0, 1)
            if not canvas.region_ok(x, y, w, h, 0):
                continue
            door = (x + rng.randint(1, w - 2), y + h - 1)
            canvas.claim(x, y, w, h, 0)
            canvas.block(x, y, w, h, door)
            name = era.houses[count % len(era.houses)]
            _poi(world, "house", name, door, (x, y, w, h), danger=round(rng.uniform(0.6, 1.1), 2))
            count += 1


def _trees_near(lv: Level, x: int, y: int, r: int = 5) -> int:
    return sum(1 for yy in range(max(0, y - r), min(lv.h, y + r + 1)) for xx in range(max(0, x - r), min(lv.w, x + r + 1))
               if lv.tiles[yy][xx] == T.TREE)


def _place_caves(rng, canvas, world) -> None:
    """A few cave mouths, out in the woods and far from the start: small rock outcrops with a dark doorway."""
    lv = canvas.level
    wanted = min(8, max(2, (lv.w * lv.h) // 5000))
    w, h = CAVE_SIZE
    for tries in range(1, 6000):
        if sum(1 for p in world.pois.values() if p.kind == "cave") >= wanted:
            return
        x, y = rng.randint(9, lv.w - w - 10), rng.randint(9, lv.h - h - 11)
        door = (x + w // 2, y + h - 1)
        near, spacing = (24, 12) if tries < 2000 else (16, 6)                  # a crowded small map relaxes the distances
        if cheb(door, world.start) < near or any(cheb(door, p.pos) < spacing for p in world.pois.values() if p.kind != "breach"):
            continue
        if world.zone[y + 1][x + 1] != 0 or not canvas.region_ok(x, y, w, h, 1):
            continue
        if tries < 3000 and _trees_near(lv, x, y) < 7:                      # prefer the woods; relax if the map has none left
            continue
        n = sum(1 for p in world.pois.values() if p.kind == "cave")
        canvas.claim(x, y, w, h, 1)
        canvas.block(x, y, w, h, door)
        _poi(world, "cave", CAVE_NAMES[n % len(CAVE_NAMES)] + (f" {n // len(CAVE_NAMES) + 1}" if n >= len(CAVE_NAMES) else ""),
             door, (x, y, w, h), danger=round(rng.uniform(1.1, 1.6), 2))


def _place_camps(rng, canvas, world) -> None:
    lv = canvas.level
    wanted = max(3, (lv.w * lv.h) // 2600)
    for _ in range(300):
        if len(world.camps) >= wanted:
            break
        x = rng.randint(6, lv.w - 7)
        y = rng.randint(6, lv.h - 7)
        if cheb((x, y), world.start) < 26 or any(cheb((x, y), c) < 22 for c in world.camps):
            continue
        if not canvas.region_ok(x - 3, y - 2, 7, 5, 1):
            continue
        canvas.claim(x - 3, y - 2, 7, 5, 1)
        for yy in range(y - 2, y + 3):
            for xx in range(x - 3, x + 4):
                lv.set_tile(xx, yy, T.GRASS)
        lv.set_tile(x, y, T.CAMPFIRE)
        lv.set_tile(x + 2, y - 1, T.CRATE)
        world.camps.append((x, y))


def _link_roads(rng, level: Level, world: World, sites: List[POI]) -> None:
    """Connect every doorway to the road network so nothing is cut off by water or woods."""
    nodes: List[Pos] = [world.start]
    for poi in world.pois.values():
        if poi.kind == "breach":
            continue
        nodes.append((poi.x, poi.y + 1))
    nodes.extend((c[0], c[1] + 1) for c in world.camps)
    connected = [nodes[0]]
    rest = nodes[1:]
    while rest:
        best = min(((cheb(a, b), a, b) for a in connected for b in rest), key=lambda t: t[0])
        _, a, b = best
        _line_road(level, a, b)
        connected.append(b)
        rest.remove(b)
    # an extra loop or two so the map is not a pure tree
    for _ in range(4):
        a, b = rng.sample(nodes, 2)
        if cheb(a, b) < 35:
            _line_road(level, a, b)
    for poi in world.pois.values():
        if poi.kind != "breach":
            level.set_tile(poi.x, poi.y, T.PORTAL)


def _reachable_from(level: Level, start: Pos) -> set:
    seen = {start}
    queue = deque([start])
    while queue:
        x, y = queue.popleft()
        for dx, dy in DIRS4:
            n = (x + dx, y + dy)
            if n not in seen and level.walkable(*n):
                seen.add(n)
                queue.append(n)
    return seen


def _ensure_connected(level: Level, world: World) -> None:
    """Guarantee that every doorway and camp can be walked to from the start.

    Roads are laid as simple L-shapes and can be blocked by buildings, so any
    pocket still cut off gets a path cut through trees, water or rubble."""
    targets = [(p.x, p.y + 1) for p in world.pois.values() if p.kind != "breach"]
    targets += [(c[0], c[1] + 1) for c in world.camps]
    reach = _reachable_from(level, world.start)
    solid = (T.WALL, T.PORTAL)
    for target in targets:
        if target in reach:
            continue
        parent = {target: None}
        queue = deque([target])
        hit = None
        while queue and hit is None:
            cur = queue.popleft()
            for dx, dy in DIRS4:
                n = (cur[0] + dx, cur[1] + dy)
                if n in parent or not (1 <= n[0] < level.w - 1 and 1 <= n[1] < level.h - 1):
                    continue
                if level.tile(*n) in solid:
                    continue
                parent[n] = cur
                if n in reach:
                    hit = n
                    break
                queue.append(n)
        if hit is None:
            raise RuntimeError(f"doorway at {target} cannot be connected to the start")
        node = hit
        while node is not None:
            if node not in reach and level.tile(*node) not in (T.CAMPFIRE, T.CRATE):
                level.set_tile(node[0], node[1], T.ROAD)
            node = parent[node]
        reach = _reachable_from(level, world.start)
