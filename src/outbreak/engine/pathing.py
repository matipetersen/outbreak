"""Breadth-first distance fields and cheap greedy stepping."""
from __future__ import annotations

import random
from collections import deque
from typing import Dict, Iterable, List, Optional

from outbreak.engine import tiles as T
from outbreak.engine.model import Level
from outbreak.util import DIRS8, Pos


# Portals and stairs are for the living: nothing else may stand on them.
_WALK = [w and t not in (T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN) for t, w in enumerate(T.WALK)]


def distance_field(level: Level, src: Pos, radius: int, swarm: bool = False) -> Dict[Pos, int]:
    """Steps from ``src`` to every tile a zombie could walk to, up to ``radius``."""
    out: Dict[Pos, int] = {src: 0}
    queue = deque([src])
    tiles = level.tiles
    w, h = level.w, level.h
    walk = _WALK
    while queue:
        x, y = queue.popleft()
        d = out[(x, y)]
        if d >= radius:
            continue
        for dx, dy in DIRS8:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in out:
                continue
            t = tiles[ny][nx]
            if not (walk[t] or (swarm and t == T.FENCE)):
                continue
            if dx and dy and not (walk[tiles[y][nx]] and walk[tiles[ny][x]]):
                continue                                  # no cutting wall corners
            out[(nx, ny)] = d + 1
            queue.append((nx, ny))
    return out


def descend(level: Level, field: Dict[Pos, int], pos: Pos, rng: random.Random,
            blocked: Optional[Iterable[Pos]] = None) -> Optional[Pos]:
    """The free neighbouring tile with the smallest distance, if it improves on ``pos``."""
    here = field.get(pos)
    limit = here if here is not None else 10 ** 9
    best_d = limit
    best: List[Pos] = []
    for dx, dy in DIRS8:
        n = (pos[0] + dx, pos[1] + dy)
        d = field.get(n)
        if d is None or d >= limit or d > best_d:
            continue
        if dx and dy and not (level.walkable(pos[0] + dx, pos[1]) and level.walkable(pos[0], pos[1] + dy)):
            continue
        occupant = level.occ.get(n)
        if occupant is not None and not occupant.is_player:
            continue
        if blocked and n in blocked:
            continue
        if d < best_d:
            best_d, best = d, [n]
        else:
            best.append(n)
    return rng.choice(best) if best else None


def greedy_step(level: Level, pos: Pos, goal: Pos, rng: random.Random, can_pass=None) -> Optional[Pos]:
    """Step toward ``goal`` sidestepping obstacles; may return None if boxed in."""
    cands = []
    for dx, dy in DIRS8:
        n = (pos[0] + dx, pos[1] + dy)
        if not level.walkable(*n):
            continue
        if can_pass is not None and not can_pass(n):
            continue
        occupant = level.occ.get(n)
        if occupant is not None and n != goal:
            continue
        if dx and dy and not (level.walkable(pos[0] + dx, pos[1]) and level.walkable(pos[0], pos[1] + dy)):
            continue
        cands.append(((n[0] - goal[0]) ** 2 + (n[1] - goal[1]) ** 2 + rng.random() * 0.5, n))
    if not cands:
        return None
    cands.sort()
    here = (pos[0] - goal[0]) ** 2 + (pos[1] - goal[1]) ** 2
    best = cands[0]
    return best[1] if best[0] < here + 2 else None
