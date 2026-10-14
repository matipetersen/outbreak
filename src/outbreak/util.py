"""Small, dependency-free helpers shared by the engine."""
from __future__ import annotations

import math
import random
from typing import Iterable, Iterator, Sequence, Tuple, TypeVar

T = TypeVar("T")
Pos = Tuple[int, int]

DIRS4: Tuple[Pos, ...] = ((0, -1), (1, 0), (0, 1), (-1, 0))
DIRS8: Tuple[Pos, ...] = DIRS4 + ((1, -1), (1, 1), (-1, 1), (-1, -1))


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def cheb(a: Pos, b: Pos) -> int:
    """Chebyshev distance: the number of 8-way steps between two tiles."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def dist(a: Pos, b: Pos) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def sign(v) -> int:
    return (v > 0) - (v < 0)


def line(a: Pos, b: Pos) -> Iterator[Pos]:
    """Bresenham line from ``a`` (excluded) to ``b`` (included)."""
    x0, y0 = a
    x1, y1 = b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while (x0, y0) != (x1, y1):
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
        yield x0, y0


def weighted_choice(rng: random.Random, pairs: Sequence[Tuple[T, float]]) -> T:
    """Pick a value from ``(value, weight)`` pairs; weights may be floats."""
    total = sum(w for _, w in pairs if w > 0)
    if total <= 0:
        raise ValueError("weighted_choice needs at least one positive weight")
    roll = rng.random() * total
    for value, weight in pairs:
        if weight <= 0:
            continue
        roll -= weight
        if roll <= 0:
            return value
    return pairs[-1][0]


def chance(rng: random.Random, p: float) -> bool:
    return rng.random() < p


def _half(x: float) -> str:
    """0.5 steps in words: 'half a', 'a', '1 and a half', '3'."""
    q = round(x * 2) / 2
    if q <= 0.5:
        return "half a"
    if q == 1:
        return "a"
    whole = int(q)
    return f"{whole} and a half" if q != whole else str(whole)


def dist_words(era_id: str, tiles: int) -> str:
    """A distance in the units people of that era would use (a tile is about 10 m; 30 m in the middle ages)."""
    n = max(0, int(tiles))
    if n == 0:
        return "right here"
    if era_id == "medieval":                                  # a tile is about 30 m: paces, furlongs, leagues
        if n < 10:
            return f"{int(round(n * 40 / 10)) * 10} paces"
        if n < 60:
            f = max(1, round(n * 30 / 201))
            return "a furlong" if f == 1 else f"{f} furlongs"
        lg = _half(n / 160)
        return f"{lg} league" if lg in ("half a", "a") else f"{lg} leagues"
    if era_id == "eighties":                                  # a tile is about 10 yards: yards, blocks, miles
        if n < 10:
            return f"{n * 10} yards"
        if n < 100:
            b = round(n / 10)
            return "a block" if b == 1 else f"{b} blocks"
        mi = _half(n / 176)
        return f"{mi} mile" if mi in ("half a", "a") else f"{mi} miles"
    metres = n * 10                                           # modern and sci-fi: metres, then kilometres (klicks in space)
    if metres < 1000:
        return f"{int(round(metres / 10.0)) * 10} m"
    km = f"{metres / 1000:.1f}".rstrip("0").rstrip(".")
    return f"{km} klick{'s' if km != '1' else ''}" if era_id == "scifi" else f"{km} km"


def compass(dx: float, dy: float) -> str:
    """Eight-way compass word for a vector (y grows southwards)."""
    if dx == 0 and dy == 0:
        return "here"
    ang = (math.degrees(math.atan2(dx, -dy)) + 360) % 360
    names = ("north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west")
    return names[int((ang + 22.5) // 45) % 8]


def pluralize(n: int, one: str, many: str = "") -> str:
    return one if n == 1 else (many or one + "s")


def first(iterable: Iterable[T], default=None):
    for v in iterable:
        return v
    return default
