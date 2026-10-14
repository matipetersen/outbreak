"""Field of view by casting Bresenham rays to the edge of a square."""
from __future__ import annotations

from typing import Set

from outbreak.engine.model import Level
from outbreak.util import Pos, line


def visible_tiles(level: Level, origin: Pos, radius: int) -> Set[Pos]:
    ox, oy = origin
    seen: Set[Pos] = {origin}
    r2 = radius * radius + radius
    targets = []
    for i in range(-radius, radius + 1):
        targets += [(ox + i, oy - radius), (ox + i, oy + radius), (ox - radius, oy + i), (ox + radius, oy + i)]
    for t in targets:
        for x, y in line(origin, t):
            if (x - ox) ** 2 + (y - oy) ** 2 > r2 or not level.in_bounds(x, y):
                break
            seen.add((x, y))
            if level.opaque(x, y):
                break
    return seen


def has_los(level: Level, a: Pos, b: Pos) -> bool:
    """True if nothing opaque lies strictly between ``a`` and ``b``."""
    for p in line(a, b):
        if p == b:
            return True
        if level.opaque(*p):
            return False
    return True
