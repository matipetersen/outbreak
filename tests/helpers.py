import os
import sys
from collections import deque

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from outbreak.config import GameConfig  # noqa: E402
from outbreak.engine.game import Game  # noqa: E402


def make_game(**kw) -> Game:
    kw.setdefault("seed", 1)
    return Game(GameConfig(**kw))


def reachable(level, start, extra_walk=()):
    """Tiles reachable on foot (closed doors and portals count, locked doors do not)."""
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p = (x + dx, y + dy)
            if p in seen or not level.in_bounds(*p):
                continue
            if level.walkable(*p) or level.tile(*p) in extra_walk:
                seen.add(p)
                q.append(p)
    return seen


def teleport(game, level_id, pos=None):
    lv = game.world.level if level_id == "world" else game.ensure_level(level_id)
    p = game.player
    if game.level.occ.get(p.pos) is p:
        del game.level.occ[p.pos]
    game.level = lv
    dest = pos or lv.entry
    p.x, p.y = dest
    lv.occ[dest] = p
    game.update_fov()
    return lv


def empty_level_of_enemies(level):
    for a in list(level.actors):
        level.remove_actor(a)


def break_out(g, limit=300):
    """Hold out until the clock runs out, then walk onto the door you were given."""
    for _ in range(limit):
        if g.over or (g.final and g.final.exit):
            break
        g.player.infected = False            # these tests are about the flow, not about dodging
        g.wait(1)
    if g.final and g.final.exit:
        e = g.final.exit
        if e in g.level.portals:
            g._use_portal(e)
        else:
            teleport(g, g.level.id, e)
            g.wait(1)
