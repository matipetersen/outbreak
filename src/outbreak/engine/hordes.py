"""Hordes: abstract moving crowds that only become individual zombies once they
are close enough to matter, plus the opening ring that closes on the breach."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from outbreak.engine.pathing import greedy_step
from outbreak.engine.spawn import spawn_zombie
from outbreak.util import Pos, cheb, compass, dist

MATERIALIZE_RADIUS = 15
MAX_ON_SCREEN = 24
RING_RADIUS = 26
RING_SPEED_CAP = 0.8


@dataclass
class Horde:
    id: int
    x: int
    y: int
    size: int
    target: Optional[Pos] = None
    energy: float = 0.0
    announced: bool = False
    home_turn: int = 0
    wait_until: int = 0               # living world: the rest of a big crowd waits its turn

    @property
    def pos(self) -> Pos:
        return (self.x, self.y)


@dataclass
class Ring:
    center: Pos
    radius: int
    escaped: bool = False
    active: bool = True


def _walkable_near(game, x: int, y: int, radius: int = 6) -> Optional[Pos]:
    return game.world.level.free_spot_near(x, y, radius)


def spawn_horde(game, pos: Pos, size: Optional[int] = None, target: Optional[Pos] = None) -> Optional[Horde]:
    prof = game.profile
    spot = _walkable_near(game, pos[0], pos[1])
    if spot is None:
        return None
    if size is None:
        size = game.rng.randint(*prof.horde_size)
    size = max(2, int(size * prof.phase(game.clock.day).spawn * game.diff.zombies * game.pressure))
    h = Horde(game.next_uid(), spot[0], spot[1], size, target, home_turn=game.clock.turn)
    game.hordes.append(h)
    return h


def start_ring(game, count: int = 7) -> None:
    """Hordes close on the breach from every side but one gap: break through it."""
    lv = game.world.level
    cx, cy = game.world.start
    gap = game.rng.uniform(0, math.tau)
    spawned = 0
    for i in range(count * 2):
        ang = i * math.tau / (count * 2) + game.rng.uniform(-0.1, 0.1)
        if abs(math.atan2(math.sin(ang - gap), math.cos(ang - gap))) < 0.55:
            continue                                          # the gap
        x = int(cx + math.cos(ang) * RING_RADIUS * 1.3)
        y = int(cy + math.sin(ang) * RING_RADIUS * 0.85)
        x, y = max(3, min(lv.w - 4, x)), max(3, min(lv.h - 4, y))
        size = max(3, game.rng.randint(*game.profile.horde_size) // 2)
        if spawn_horde(game, (x, y), size, game.world.start):
            spawned += 1
        if spawned >= count:
            break
    game.ring = Ring(game.world.start, RING_RADIUS)


def _step(game, h: Horde) -> None:
    lv = game.world.level
    goal = h.target
    if goal is None or cheb(h.pos, goal) <= 2:
        if h.target is not None:
            h.target = None
        ang = game.rng.uniform(0, math.tau)
        r = game.rng.randint(12, 30)
        goal = (int(h.x + math.cos(ang) * r), int(h.y + math.sin(ang) * r))
        goal = (max(3, min(lv.w - 4, goal[0])), max(3, min(lv.h - 4, goal[1])))
        h.target = goal
    nxt = greedy_step(lv, h.pos, goal, game.rng)
    if nxt is None:
        h.target = None                                       # boxed in: pick another way next time
        return
    h.x, h.y = nxt


def tick(game) -> None:
    """Move hordes; materialise any that come close to the player on the overworld."""
    prof = game.profile
    p = game.player
    on_world = game.level is game.world.level
    if prof.sun_burn and game.clock.is_day:
        return                                                # they shelter from the sun
    speed = max(0.3, prof.speed * (prof.night_speed if game.clock.is_night else 1.0)
                * prof.phase(game.clock.day).speed)
    if game.ring and game.ring.active:
        speed = min(speed, RING_SPEED_CAP)          # the opening must be escapable by a runner
    for h in list(game.hordes):
        h.energy += speed
        while h.energy >= 1.0:
            h.energy -= 1.0
            _step(game, h)
        if not on_world:
            continue
        d = cheb(h.pos, p.pos)
        if d <= MATERIALIZE_RADIUS and game.clock.turn >= h.wait_until:
            materialize(game, h)
        elif d <= 32 and not h.announced and game.clock.turn - game.last_moan >= 40:
            h.announced = True
            game.last_moan = game.clock.turn          # one warning at a time, not one per horde
            game.msg(f"You hear a distant moaning to the {compass(h.x - p.x, h.y - p.y)}.", "warn")
    ring = game.ring
    if ring and ring.active and on_world:
        d = cheb(p.pos, ring.center)
        if d > ring.radius + 4 and not ring.escaped:
            ring.escaped = True
            ring.active = False
            p.gain_xp(35)
            game.msg("You break through the closing tide. Behind you, the dead are filling the breach.", "good")
            game.on_ring_escaped()


def materialize(game, h: Horde) -> None:
    lv = game.world.level
    if h in game.hordes:
        game.hordes.remove(h)
    n = min(h.size, MAX_ON_SCREEN)

    placed = 0
    for _ in range(n * 3):
        if placed >= n:
            break
        spot = lv.free_spot_near(h.x + game.rng.randint(-3, 3), h.y + game.rng.randint(-3, 3), 3)
        if spot is None or cheb(spot, game.player.pos) < 4:
            continue
        z = spawn_zombie(game, lv, spot, dormant=False)
        z.state, z.target, z.stimulus_turn = "investigate", game.player.pos, game.clock.turn
        z.horde = h.id
        placed += 1
    leftover = h.size - placed
    if game.cfg.mode == "living" and leftover >= 2:        # nobody vanishes: the rest are still coming
        h.size, h.wait_until = leftover, game.clock.turn + 12
        game.hordes.append(h)
    if placed:
        game.msg(f"A horde of {placed} comes into view!", "bad", key=True)
        game.add_panic(8)


def noise_attracts(game, pos: Pos, radius: float) -> None:
    for h in game.hordes:
        if dist(h.pos, pos) <= radius * 1.6 * game.profile.hearing:
            h.target = pos


def wanderers(game) -> None:
    """Trickle of new zombies drifting in, more at night and as heat rises."""
    if game.level is not game.world.level or game.clock.turn % 25:
        return
    prof = game.profile
    if prof.sun_burn and game.clock.is_day:
        return
    from outbreak.engine import director
    chance = 0.22 * prof.phase(game.clock.day).spawn * game.diff.zombies * prof.density * game.pressure * director.scale(game)
    if game.clock.is_night:
        chance *= 1.5
    chance += game.heat / 400.0
    if game.rng.random() >= chance:
        return
    p, lv = game.player, game.world.level
    for _ in range(20):
        ang = game.rng.uniform(0, math.tau)
        r = game.rng.randint(20, 32)
        pos = (int(p.x + math.cos(ang) * r), int(p.y + math.sin(ang) * r))
        if 2 <= pos[0] < lv.w - 2 and 2 <= pos[1] < lv.h - 2 and lv.free(*pos):
            if game.heat > 55 and game.rng.random() < 0.5:
                spawn_horde(game, pos, None, p.pos)
            else:
                for _ in range(game.rng.randint(1, 3)):
                    spot = lv.free_spot_near(*pos, 2)
                    if spot:
                        z = spawn_zombie(game, lv, spot, dormant=False, fresh=True)
                        z.state, z.target, z.stimulus_turn = "investigate", p.pos, game.clock.turn
            return
