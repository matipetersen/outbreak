"""Behaviour of the living and the dead.

Only actors within ``ACTIVE_RADIUS`` of the player are simulated.  Zombies run
a small state machine: ``dormant`` (still until disturbed) -> ``idle`` (wanders)
-> ``investigate`` (heard something) -> ``hunt`` (knows where you are).
"""
from __future__ import annotations

import math
from typing import Optional, Tuple

from outbreak.engine import ambience, combat, companion, lives, memory, raiders, wild
from outbreak.engine import tiles as T
from outbreak.engine.fov import has_los
from outbreak.engine.model import Animal, Human, Zombie
from outbreak.engine.pathing import descend, greedy_step
from outbreak.util import DIRS8, cheb, dist

ACTIVE_RADIUS = 45
FOE_SIGHT = 5                 # how far a zombie notices a living person that is not the player
HUMAN_SIGHT = 8
FIGHTERS = ("raider", "scout", "soldier")
FIELD_RADIUS = 28
NO_ENTRY = (T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN)
ALERT_AT, SUSPICIOUS, STAB_OK, SNEAK_GAIN, NOTICE_BASE = 100, 40, 70, 0.4, 36
SNEAK_SIGHT = 0.5             # creeping shortens how far the dead see you, by this much
DOOR_HP = 8
LOST_AFTER = 14               # turns a hunter keeps looking after losing you
TRAIL_LENGTH = 60


# ------------------------------------------------------------------ perception
def sight_range(game, z: Zombie) -> float:
    if "blind" in z.flags:
        return 0.0
    prof, p = game.profile, game.player
    r = z.sight
    if game.is_dark():
        r *= min(1.0, 0.6 * game.era.rules.dead_night) * prof.night_sight         # sensors and heat vision ignore the dark
        if combat.player_lit(game):
            r = max(r, 6.0) * game.era.rules.lit_visibility            # a torch is a beacon; cold LEDs much less so
    if p.sneaking:
        r *= SNEAK_SIGHT
    if game.level.tile(*p.pos) == T.BRUSH:
        r *= game.era.rules.cover
    if wild.forest_here(game):
        r *= wild.FOREST_SIGHT                                       # deep woods hide you from the dead
    r *= ambience.sight_scale(game) * ambience.exposure_of_ground(game)      # weather, and an open road or splashing water
    if p.disguise_turns > 0 and prof.intel < 2 and (z.uid * 37) % 100 < prof.disguise * 100:
        r = min(r, 1.5)
    return r


def unaware(z: Zombie) -> bool:
    return z.state in ("idle", "dormant", "investigate")


def exposure(z: Zombie, p) -> float:
    """How much of the zombie's attention the player gets: 1 straight ahead of it, 0.8 at its side, 0.6 right behind it."""
    fx, fy = z.facing
    dx, dy = p.x - z.x, p.y - z.y
    d = math.hypot(dx, dy) or 1.0
    return 0.8 + 0.2 * (dx * fx + dy * fy) / (d * math.hypot(fx, fy))


def awareness_of(z: Zombie) -> str:
    if z.state == "hunt":
        return "hunting you"
    if z.alert >= STAB_OK:
        return "about to notice you"
    if z.alert >= SUSPICIOUS:
        return "suspicious"
    return "listening" if z.state == "investigate" else "unaware"


def sees_player(game, z: Zombie) -> bool:
    p = game.player
    r = sight_range(game, z)
    if unaware(z):
        r *= exposure(z, p)                            # an unwary zombie sees poorly over its own shoulder
    if r <= 0 or dist(z.pos, p.pos) > r:
        return False
    return has_los(game.level, z.pos, p.pos)


def _notice(game, z: Zombie, in_sight: bool, d: int) -> bool:
    """A zombie that has not noticed you fills an awareness meter while you are in its sight; it hunts at 100.  Closer,
    running and in front of it fill it fast; sneaking and being behind it fill it slowly; out of sight it calms down."""
    p = game.player
    if not in_sight:
        z.alert = max(0.0, z.alert - 8)
        return False
    e = exposure(z, p)
    r = max(1.0, sight_range(game, z) * e)
    gain = NOTICE_BASE * (1 + max(0.0, r - d) / r) * e
    if p.sneaking:
        gain *= SNEAK_GAIN
    if p.sprinting:
        gain *= 1.4
    z.alert += gain
    if z.alert >= SUSPICIOUS:
        z.facing = ((p.x > z.x) - (p.x < z.x), (p.y > z.y) - (p.y < z.y))     # it turns to look
    return z.alert >= ALERT_AT


def _perceive(game, z: Zombie) -> None:
    if not unaware(z) or "blind" in z.flags:
        return
    p = game.player
    d = cheb(z.pos, p.pos)
    close_enough = z.state != "dormant" or d <= max(2.0, sight_range(game, z) * 0.5)
    if _notice(game, z, sees_player(game, z) and close_enough, d):
        _spotted(game, z)
        z.state, z.target, z.stimulus_turn, z.alert = "hunt", p.pos, game.clock.turn, float(ALERT_AT)


def speed_now(game, z: Zombie) -> float:
    s = z.speed
    if game.is_dark():
        s *= game.profile.night_speed
    elif game.clock.is_day:
        s *= game.profile.day_speed
    if z.state == "idle":
        s *= 0.5
    return s


# ------------------------------------------------------------------ main loop
def run(game) -> None:
    level, p = game.level, game.player
    humans = [a for a in level.actors if isinstance(a, Human) and a.hp > 0
              and (a.role in FIGHTERS or a.state in ("follow", "wait"))]      # a companion can be hurt too
    pets_ = [a for a in level.actors if isinstance(a, Animal) and a.pet and a.hp > 0]
    for a in list(level.actors):
        if a.hp <= 0 or level.occ.get(a.pos) is not a or cheb(a.pos, p.pos) > ACTIVE_RADIUS:
            continue
        if isinstance(a, Zombie):
            _zombie(game, a, humans + pets_)
        elif isinstance(a, Human):
            _human(game, a, humans)
        elif isinstance(a, Animal):
            wild.tick(game, a)


def _zombie(game, z: Zombie, humans) -> None:
    prof, level = game.profile, game.level
    if z.cooldown > 0:
        z.cooldown -= 1
    if z.stun > 0:                                             # shoved: it staggers and loses its turn
        z.stun -= 1
        return
    if prof.sun_burn and level.kind == "overworld" and game.clock.is_day:
        z.hp -= 2
        if z.hp <= 0:
            combat.kill_zombie(game, z, by_player=False)
            return
    _perceive(game, z)                                  # awareness is checked every tick, not only when it moves
    z.energy += speed_now(game, z)
    steps = 0
    while z.energy >= 1.0 and steps < 3 and z.hp > 0 and level.occ.get(z.pos) is z:
        z.energy -= 1.0
        steps += 1
        _zombie_step(game, z, humans)


def nearest_foe(game, a, foes, limit: float):
    """The closest living foe of ``a`` within ``limit`` that it can see, or None."""
    level, best, best_d = game.level, None, limit + 1
    for f in foes:
        if f is a or f.hp <= 0:
            continue
        d = cheb(a.pos, f.pos)
        if getattr(f, "sneaking", False) and d > 2 and isinstance(a, Zombie):
            continue                                              # a creeping companion is only noticed up close
        if d < best_d and has_los(level, a.pos, f.pos):
            best, best_d = f, d
    return best


def _zombie_fight(game, z: Zombie, foe: Human) -> None:
    z.state, z.target, z.stimulus_turn = "hunt", foe.pos, game.clock.turn
    if cheb(z.pos, foe.pos) == 1:
        combat.attack_actor(game, z, foe)
        return
    nxt = greedy_step(game.level, z.pos, foe.pos, game.rng, can_pass=lambda n: _passable(game, z, n))
    if nxt is not None:
        _move_or_bash(game, z, nxt)


def _zombie_step(game, z: Zombie, humans=()) -> None:
    p, prof = game.player, game.profile
    turn = game.clock.turn
    d = cheb(z.pos, p.pos)
    seen = False if unaware(z) else sees_player(game, z)    # the unaware only notice through the awareness meter
    if humans and z.state != "dormant":
        foe = nearest_foe(game, z, humans, FOE_SIGHT)
        if foe is not None and seen and companion.early_grace(game) and (getattr(foe, "trait", "") or getattr(foe, "pet", False)) \
                and cheb(z.pos, foe.pos) > 1:
            foe = None                                               # in the opening they go for you, not for your people
        if foe is not None and (not seen or cheb(z.pos, foe.pos) < d):
            _zombie_fight(game, z, foe)
            return
    if z.state == "dormant":
        if seen:
            z.state = "hunt"
        else:
            return
    if seen:
        if z.state != "hunt":
            _spotted(game, z)
        z.state, z.target, z.stimulus_turn, z.alert = "hunt", p.pos, turn, float(ALERT_AT)
    elif z.state == "hunt":
        _lost_sight(game, z, d)
    if prof.dormant_after and z.state in ("hunt", "investigate") and turn - z.stimulus_turn > prof.dormant_after:
        z.state, z.target = "dormant", None
        return
    if z.state in ("hunt", "investigate") and z.target is not None:
        _pursue(game, z, d, seen)
    elif z.state == "idle" and game.level.kind == "overworld" and game.rng.random() < 0.35:
        _wander(game, z)


def _spotted(game, z: Zombie) -> None:
    if "screams" in z.flags and z.cooldown <= 0:
        z.cooldown = 40
        game.msg(f"The {z.name.lower()} screams!", "warn")
        game.emit_noise(z.pos, 22, "zombie")
        game.add_heat(6)


def _lost_sight(game, z: Zombie, d: int) -> None:
    p, prof = game.player, game.profile
    if "relentless" in z.flags and d <= 45:
        z.target = p.pos                                  # nothing shakes a stalker
        return
    if prof.smell and game.clock.turn - z.stimulus_turn < 25:
        spot = game.scent_near(z.pos, prof.smell)
        if spot:
            z.target = spot
            return
    if game.clock.turn - z.stimulus_turn > LOST_AFTER:
        z.state, z.target = "idle", None


def _pursue(game, z: Zombie, d: int, seen: bool) -> None:
    p, level = game.player, game.level
    if d == 1 and (seen or z.target == p.pos):
        combat.zombie_attack(game, z)
        return
    if "leaps" in z.flags and seen and 2 <= d <= 4 and z.cooldown <= 0:
        spot = level.free_spot_near(p.x, p.y, 1)
        if spot and cheb(spot, z.pos) <= 4:
            level.move_actor(z, *spot)
            z.cooldown = 8
            game.msg(f"The {z.name.lower()} leaps at you!", "bad")
            combat.zombie_attack(game, z)
            return
    if z.target is not None and cheb(z.pos, z.target) == 0:
        if z.state == "investigate":
            z.state, z.target = "idle", None
        return
    nxt = None
    if z.target == p.pos:
        field = game.get_field()
        if z.pos in field:
            nxt = descend(level, field, z.pos, game.rng, blocked=_hazard_tiles(game, z))
    if nxt is None and z.target is not None:
        nxt = greedy_step(level, z.pos, z.target, game.rng, can_pass=lambda n: _passable(game, z, n))
    if nxt is None:
        if z.state == "investigate":
            z.state, z.target = "idle", None
        return
    _move_or_bash(game, z, nxt)


def _passable(game, z: Zombie, pos) -> bool:
    t = game.level.tile(*pos)
    if t in NO_ENTRY:
        return False
    if t == T.FENCE:
        return game.profile.swarm
    hz = game.level.hazards.get(pos)
    return not (hz and hz.kind == "fire" and game.profile.intel >= 1)


def _hazard_tiles(game, z: Zombie):
    if game.profile.intel < 1:
        return None
    return {pos for pos, hz in game.level.hazards.items() if hz.kind == "fire"}


def _move_or_bash(game, z: Zombie, nxt) -> None:
    level = game.level
    t = level.tile(*nxt)
    if t in NO_ENTRY:
        return
    if t == T.DOOR:
        if game.profile.intel >= 1:
            level.set_tile(nxt[0], nxt[1], T.DOOR_OPEN)
            return
        _bash_door(game, z, nxt)
        return
    if nxt in level.occ:
        return
    level.move_actor(z, *nxt)


def _bash_door(game, z: Zombie, pos) -> None:
    level = game.level
    power = 6 if "breaker" in z.flags else 2
    if game.profile.swarm:
        power *= 1 + sum(1 for dx, dy in DIRS8 if isinstance(level.occ.get((pos[0] + dx, pos[1] + dy)), Zombie))
    hp = level.door_hp.get(pos, DOOR_HP) - power
    level.door_hp[pos] = hp
    game.emit_noise(pos, 6, "zombie")
    if hp <= 0:
        level.set_tile(pos[0], pos[1], T.FLOOR)
        level.door_hp.pop(pos, None)
        if cheb(pos, game.player.pos) <= 12:
            game.msg("A door splinters and gives way.", "warn")


def _wander(game, z: Zombie) -> None:
    # shamblers keep going the way they face most of the time, which is what makes them stalkable from behind
    dx, dy = z.facing if game.rng.random() < 0.7 else game.rng.choice(DIRS8)
    n = (z.x + dx, z.y + dy)
    if game.level.walkable(*n) and _passable(game, z, n) and n not in game.level.occ \
            and game.level.tile(*n) != T.DOOR:
        game.level.move_actor(z, *n)


# ------------------------------------------------------------------ humans
def _foes_of(h: Human, game, humans):
    """Everything this human will shoot at that is not the player: the dead, and the other side."""
    out = list(z for z in game.level.actors if isinstance(z, Zombie) and z.hp > 0)
    mine = h.faction == "raiders"
    out += [o for o in humans if o is not h and (o.faction == "raiders") != mine]
    return out


def _toward(game, h: Human, goal) -> bool:
    level = game.level
    field = game.get_field() if goal == game.player.pos else None
    nxt = descend(level, field, h.pos, game.rng) if field is not None and h.pos in field else None
    if nxt is None:
        nxt = greedy_step(level, h.pos, goal, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
    return bool(nxt) and _human_move(game, h, nxt)


def _obey(game, h: Human, humans, d: int) -> bool:
    """A standing order from the player.  True if it took the companion's turn."""
    kind, p = companion.order_of(h), game.player
    foes = _foes_of(h, game, humans)
    if kind == "engage":
        foe = nearest_foe(game, h, foes, companion.ORDER_SIGHT)
        if foe is None:
            companion.end_order(game, h, "\"Clear.\"")
            return False
        _human_fight(game, h, foe)
        return True
    if kind == "fallback":
        adjacent = next((z for z in foes if z.hp > 0 and cheb(z.pos, h.pos) == 1), None)
        if d > 2:
            if _toward(game, h, p.pos) and d > 4:
                _toward(game, h, p.pos)                              # hustling back
            return True
        if adjacent is not None:
            _human_fight(game, h, adjacent)                          # cornered: they defend themselves
            return True
        if nearest_foe(game, h, foes, 6) is None:
            companion.end_order(game, h, "\"Back with you. Nothing followed.\"")
            return False
        return True
    if kind == "escape":
        if d > 1:
            _toward(game, h, p.pos)
            if d > 2:
                _toward(game, h, p.pos)                              # a sprint: two steps a turn
        return True
    if kind == "ranged":
        if h.reach <= 1:
            companion.end_order(game, h)
            return False
        foe = nearest_foe(game, h, foes, h.reach)
        if foe is None:
            return False                                             # nothing to shoot: follow as usual
        fd = cheb(h.pos, foe.pos)
        if fd <= 2 and isinstance(foe, Zombie):
            _flee(game, h, foe.pos)                                  # keep the range open
        else:
            combat.attack_actor(game, h, foe, ranged=True)
        return True
    return False                                                     # guard: the short leash does the work


def _human(game, h: Human, humans) -> None:
    if h.role not in FIGHTERS and h.state not in ("follow", "wait"):
        return                                                    # shopkeepers and healers keep out of it
    if h.stun > 0:
        h.stun -= 1
        return
    p, level = game.player, game.level
    d = cheb(h.pos, p.pos)
    if h.hidden:                                                  # lying in wait
        raiders.spring_check(game, h, humans, d)
        return
    if h.state == "follow" and companion.order_of(h) and _obey(game, h, humans, d):
        return
    seen = h.hostile and d <= 11 and has_los(level, h.pos, p.pos)
    if h.hostile and not seen and h.morale < 100:
        h.morale = min(100, h.morale + 2)                         # it pulls itself together out of sight
    foe = nearest_foe(game, h, _foes_of(h, game, humans), HUMAN_SIGHT if h.reach > 1 else FOE_SIGHT)
    if h.state in ("follow", "wait") and companion.refuses_to_fight(h, foe):
        foe = None                                                # a pacifist will not raise a hand to a person
    if h.state == "follow" and foe is not None and companion.should_hold_back(game, h, foe):
        if d <= 14 and game.visible_hostiles():
            companion.on_regroup(game, h)
        foe = None                                                # when you run, they run with you
    if h.state == "wait" and (foe is None or cheb(h.pos, foe.pos) > 1):
        return                                                    # asked to stay put: it only defends itself
    if foe is not None and not (seen and d < cheb(h.pos, foe.pos)):
        _human_fight(game, h, foe)
        return
    if seen:
        h.state, h.target = "hunt", p.pos
    if h.state == "follow":
        _follow_step(game, h)
        return
    if h.state == "patrol":
        _patrol_step(game, h)
        return
    if h.state == "guard":
        if h.post and h.pos != h.post and game.clock.turn % 3 == 0:
            nxt = greedy_step(level, h.pos, h.post, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
            _human_move(game, h, nxt)
        return
    if h.state != "hunt" or not h.hostile:
        return
    if h.role == "raider" or (h.role == "soldier" and h.mag):
        _raider_hunt(game, h, seen, d)
        return
    if h.hp < h.max_hp * 0.3 and seen:
        _flee(game, h, p.pos)
        return
    if h.reach > 1 and seen and 2 <= d <= h.reach:
        combat.human_attack(game, h)
        return
    if d == 1:
        combat.human_attack(game, h)
        return
    field = game.get_field()
    nxt = descend(level, field, h.pos, game.rng) if h.pos in field else None
    if nxt is None:
        nxt = greedy_step(level, h.pos, p.pos, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
    _human_move(game, h, nxt)


def _cover_step(game, h: Human, p) -> Optional[Tuple[int, int]]:
    """A neighbouring tile where the player cannot see it (behind a wall, a corner, a door post)."""
    level = game.level
    for dx, dy in DIRS8:
        n = (h.x + dx, h.y + dy)
        if level.free(*n) and level.tile(*n) not in NO_ENTRY and cheb(n, p.pos) >= 2 and not has_los(level, n, p.pos):
            return n
    return None


def _away_step(game, h: Human, p) -> Optional[Tuple[int, int]]:
    level, best, best_d = game.level, None, cheb(h.pos, p.pos)
    for dx, dy in DIRS8:
        n = (h.x + dx, h.y + dy)
        if level.free(*n) and level.tile(*n) not in NO_ENTRY and cheb(n, p.pos) > best_d:
            best, best_d = n, cheb(n, p.pos)
    return best


def _raider_hunt(game, h: Human, seen: bool, d: int) -> None:
    """A raider fights like a small squad: it shoots in bursts and reloads, backs off when you close in, takes cover between
    bursts, works round to your flank, and runs only when it is hurt or its friends have died, not on contact."""
    p, level = game.player, game.level
    if (h.hp < h.max_hp * 0.3 or h.morale < 30) and seen:
        memory.on_flee(game, h)
        _flee(game, h, p.pos)
        return
    if h.reload > 0:                                              # reloading, from cover if it can
        h.reload -= 1
        if h.reload == 0:
            h.ammo = h.mag
        cover = _cover_step(game, h, p) if seen else None
        if cover:
            _human_move(game, h, cover)
        return
    if h.mag and seen and 2 <= d <= h.reach:
        if h.ammo <= 0:
            h.reload = 3
            if h.pos in game.visible:
                game.msg(f"The {h.name.lower()} ducks to reload.", "info")
            return
        if d <= 2:                                                # too close for comfort: back off and shoot from range
            away = _away_step(game, h, p)
            if away:
                _human_move(game, h, away)
                return
        if game.rng.random() < 0.35:                              # not every turn: take cover between bursts
            cover = _cover_step(game, h, p)
            if cover:
                _human_move(game, h, cover)
                return
        h.ammo -= 1
        combat.human_attack(game, h)
        return
    if d == 1:
        combat.human_attack(game, h)
        return
    goal = p.pos
    if h.flank and d > 4:                                         # work round to the side instead of walking into the barrel
        vx, vy = p.x - h.x, p.y - h.y
        wx, wy = -vy, vx
        norm = max(1, abs(wx) + abs(wy))
        gx, gy = p.x + int(round(h.flank * wx * 4 / norm)), p.y + int(round(h.flank * wy * 4 / norm))
        if level.in_bounds(gx, gy) and level.walkable(gx, gy):
            goal = (gx, gy)
    nxt = None
    if goal == p.pos:
        field = game.get_field()
        nxt = descend(level, field, h.pos, game.rng) if h.pos in field else None
    if nxt is None:
        nxt = greedy_step(level, h.pos, goal, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
    _human_move(game, h, nxt)


def _human_move(game, h: Human, nxt) -> bool:
    level = game.level
    if nxt and nxt not in level.occ and level.tile(*nxt) not in NO_ENTRY:
        if level.tile(*nxt) == T.DOOR:
            level.set_tile(nxt[0], nxt[1], T.DOOR_OPEN)
        else:
            level.move_actor(h, *nxt)
        return True
    return False


def _human_fight(game, h: Human, foe) -> None:
    level = game.level
    d = cheb(h.pos, foe.pos)
    h.sneaking, h.sprinting, h.lastfought = False, False, game.clock.turn
    if h.trait:
        companion.on_fight(game, h, foe)
    if h.hp < h.max_hp * companion.flee_below(h) and isinstance(foe, Zombie) and d <= 2:
        companion.on_flee(game, h)
        if h.state in ("follow", "wait"):                         # they run to you, not away into the dark
            nxt = greedy_step(level, h.pos, game.player.pos, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
            if nxt and _human_move(game, h, nxt):
                return
        _flee(game, h, foe.pos)
        return
    ranged = h.reach > 1
    if ranged and 2 <= d <= h.reach:
        combat.attack_actor(game, h, foe, ranged=True)
    elif d == 1:
        combat.attack_actor(game, h, foe)
    else:                                                         # close the distance
        nxt = greedy_step(level, h.pos, foe.pos, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
        _human_move(game, h, nxt)


def _patrol_step(game, h: Human) -> None:
    """Walk to the group's current waypoint, every other tick; pick a new one on arrival."""
    if game.clock.turn % 2:
        return
    goals = game.patrol_goals
    goal = goals.get(h.group)
    if goal is None or cheb(h.pos, goal) <= 2 or h.stuck > 8:
        nodes = game.patrol_nodes
        if not nodes:
            return
        goal = game.rng.choice(nodes)
        goals[h.group] = goal
        h.stuck = 0
    nxt = greedy_step(game.level, h.pos, goal, game.rng, can_pass=lambda n: game.level.tile(*n) not in NO_ENTRY)
    if nxt is None or not _human_move(game, h, nxt):
        h.stuck += 1


def _follow_step(game, h: Human) -> None:
    """A companion stays close to the player."""
    p, level = game.player, game.level
    if p.humanity < 20:
        h.state = "patrol"
        game.msg(f"The {h.name.lower()} looks at what you have become, and walks away.", "warn")
        return
    d = cheb(h.pos, p.pos)
    if d <= 2:
        return
    steps = 1 + (d > 4) + (d > 10)                              # fall behind and they hustle: you never have to slow down for them
    field = game.get_field()
    moved = False
    for _ in range(steps):
        if cheb(h.pos, p.pos) <= 2:
            break
        nxt = descend(level, field, h.pos, game.rng) if h.pos in field else None
        if nxt is None:
            nxt = greedy_step(level, h.pos, p.pos, game.rng, can_pass=lambda n: level.tile(*n) not in NO_ENTRY)
        if not _human_move(game, h, nxt):
            break
        moved = True
    if moved or d <= 3:
        h.stuck = 0
    else:
        h.stuck += 1
        if h.stuck >= 5:                                         # boxed in by trees or rubble: they find their way to you
            h.stuck = 0
            companion.unstick(game, h)


# ------------------------------------------------------------------ far away, in the abstract
ABSTRACT_EVERY = 20
ABSTRACT_STEPS = 5
ABSTRACT_RANGE = 10


def abstract_run(game) -> None:
    """Patrols beyond the simulated radius still walk and still fight, in coarse strokes."""
    if game.level is not game.world.level or game.clock.turn % ABSTRACT_EVERY:
        return
    lv, p = game.world.level, game.player
    groups = {}
    for a in lv.actors:
        if isinstance(a, Human) and a.role in ("scout", "soldier") and a.state == "patrol" and a.hp > 0 \
                and cheb(a.pos, p.pos) > ACTIVE_RADIUS:
            groups.setdefault(a.group, []).append(a)
    for gid, members in groups.items():
        _abstract_fight(game, members)
        members = [m for m in members if m.hp > 0]
        if members:
            _abstract_move(game, gid, members)


def _abstract_move(game, gid: int, members) -> None:
    lv = game.world.level
    goal = game.patrol_goals.get(gid)
    if goal is None or any(cheb(m.pos, goal) <= 2 for m in members):
        if not game.patrol_nodes:
            return
        goal = game.rng.choice(game.patrol_nodes)
        game.patrol_goals[gid] = goal
    for m in members:
        for _ in range(ABSTRACT_STEPS):
            nxt = greedy_step(lv, m.pos, goal, game.rng, can_pass=lambda n: lv.tile(*n) not in NO_ENTRY)
            if nxt is None or not _human_move(game, m, nxt):
                break


def _abstract_fight(game, members) -> int:
    """Resolve a skirmish between a far-off patrol and whatever is near it.  Returns foes killed."""
    lv, p, rng = game.world.level, game.player, game.rng
    lead = members[0]
    foes = [a for a in lv.actors if a.hp > 0 and cheb(a.pos, lead.pos) <= ABSTRACT_RANGE and cheb(a.pos, p.pos) > ACTIVE_RADIUS
            and (isinstance(a, Zombie) or (isinstance(a, Human) and a.faction == "raiders"))]
    hordes = [h for h in game.hordes if cheb(h.pos, lead.pos) <= ABSTRACT_RANGE]
    if not foes and not hordes:
        return 0
    foe_power = sum(1.8 if isinstance(a, Human) else 0.8 for a in foes) + sum(0.7 * h.size for h in hordes)
    power = sum(1.6 if m.role == "soldier" else 1.2 for m in members) * (0.6 + rng.random() * 0.8)
    killed = 0
    foes.sort(key=lambda a: cheb(a.pos, lead.pos))
    for a in foes:
        cost = 1.8 if isinstance(a, Human) else 0.9
        if power < cost:
            break
        power -= cost
        killed += 1
        if isinstance(a, Zombie):
            combat.kill_zombie(game, a, by_player=False, killer=lead)
        else:
            lv.remove_actor(a)
            lv.corpses[a.pos] = (game.clock.turn, True)
            lives.grant_xp(game, lead, 12)
    for h in hordes:
        n = min(h.size, int(power / 0.9))
        power -= n * 0.9
        h.size -= n
        killed += n
        if h.size <= 1 and h in game.hordes:
            game.hordes.remove(h)
    damage = foe_power * (0.5 + rng.random()) * 3.0
    killer = foes[0] if foes else lead
    for m in sorted(members, key=lambda _m: rng.random()):
        if damage <= 0:
            break
        hit = min(damage, rng.randint(6, 14))
        damage -= hit
        m.hp -= int(hit)
        if m.hp <= 0:
            combat.kill_human_other(game, m, killer)
    return killed


def _flee(game, h: Human, away_from) -> None:
    level = game.level
    best, best_d = None, cheb(h.pos, away_from)
    for dx, dy in DIRS8:
        n = (h.x + dx, h.y + dy)
        if level.free(*n) and level.tile(*n) not in NO_ENTRY and cheb(n, away_from) > best_d:
            best, best_d = n, cheb(n, away_from)
    if best:
        level.move_actor(h, *best)
