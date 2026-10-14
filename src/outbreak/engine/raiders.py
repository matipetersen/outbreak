"""Raiders are not mobs: they lie in wait, lay snares round their camps, and fight as a squad (see ai._raider_hunt).

This module holds what is not a per-turn decision: building a camp's defences, springing an ambush, spotting and
disarming snares, and the morale that breaks when their friends die.
"""
from __future__ import annotations

from outbreak.engine import tiles as T
from outbreak.engine.fov import has_los
from outbreak.engine.model import Hazard, Human
from outbreak.util import DIRS8, cheb

SNARE_POWER = 8
SPRING_RANGE = 3                       # you walk this close to someone lying in wait and it springs (2 if you creep)


def is_raider(a) -> bool:
    return isinstance(a, Human) and a.role == "raider" and a.hostile and a.hp > 0


def alert_near(game, pos, radius: int) -> None:
    """A clatter, a shout: every raider within earshot knows where you are."""
    p = game.player
    for a in game.level.actors:
        if is_raider(a) and cheb(a.pos, pos) <= radius:
            a.hidden = False
            a.state, a.target = "hunt", p.pos


def spring(game, h: Human, text: str = "") -> None:
    """Someone lying in wait jumps out, and so does the rest of its squad."""
    squad = [a for a in game.level.actors if is_raider(a) and a.hidden and (a is h or (h.squad and a.squad == h.squad))]
    p = game.player
    for a in squad:
        a.hidden = False
        a.state, a.target = "hunt", p.pos
    if squad:
        game.msg(text or "Raiders burst out of cover!", "bad", key=True)


def notice_snares(game) -> None:
    """Walking, you may spot a snare next to you (more likely if you creep).  Spotted ones show, and can be disarmed."""
    p, lv = game.player, game.level
    reach = 2 if p.sneaking else 1
    chance = 0.7 if p.sneaking else 0.35
    for pos, hz in lv.hazards.items():
        if hz.kind == "snare" and hz.hidden and cheb(pos, p.pos) <= reach and game.rng.random() < chance:
            hz.hidden = False
            game.msg("You spot a snare in the ground ahead.", "good")
            return


def shaken(game, dead) -> None:
    """Friends dying shakes the rest of the squad."""
    for a in game.level.actors:
        if is_raider(a) and a is not dead and (cheb(a.pos, dead.pos) <= 8 or (dead.squad and a.squad == dead.squad)):
            a.morale = max(0, a.morale - 25)


def spring_check(game, h: Human, humans, d: int) -> bool:
    """For a raider lying in wait: spring, be spotted by a creeping player, or stay put.  True if it stays hidden."""
    p = game.player
    reach = 2 if p.sneaking else SPRING_RANGE
    if d <= reach and has_los(game.level, h.pos, p.pos):
        spring(game, h)
        return False
    if any(is_raider(o) and o.squad == h.squad and o.state == "hunt" and cheb(o.pos, h.pos) <= 12 for o in humans):
        spring(game, h, "Raiders break cover!")
        return False
    if p.sneaking and d <= 3 and game.rng.random() < 0.25:
        h.hidden = False                                      # you saw it first: it has not seen you
        game.msg("You spot a raider crouched in cover.", "good")
        return False
    return True


def setup_camp(game, lv, camp, raiders) -> None:
    """A camp is not a clearing: half its raiders lie in wait round it, and the approaches are snared."""
    rng = game.rng
    squad = game.next_uid()
    for i, r in enumerate(raiders):
        r.squad = squad
        r.flank = 1 if i % 2 == 0 else -1
    for r in raiders[1::2]:
        for _ in range(30):
            x, y = camp[0] + rng.randint(-9, 9), camp[1] + rng.randint(-9, 9)
            if 4 <= cheb((x, y), camp) <= 9 and lv.free(x, y) and lv.tile(x, y) in (T.GRASS, T.BRUSH, T.ROAD):
                lv.move_actor(r, x, y)
                r.hidden, r.state = True, "idle"
                break
    placed = 0
    for _ in range(60):
        if placed >= 5:
            break
        x, y = camp[0] + rng.randint(-9, 9), camp[1] + rng.randint(-9, 9)
        if 4 <= cheb((x, y), camp) <= 9 and lv.free(x, y) and lv.tile(x, y) in (T.GRASS, T.ROAD, T.BRUSH) \
                and (x, y) not in lv.hazards:
            lv.hazards[(x, y)] = Hazard("snare", 10 ** 9, SNARE_POWER, hidden=True)
            placed += 1


# ------------------------------------------------------------------ raiders anywhere
SPOT_TILES = (T.GRASS, T.BRUSH, T.ROAD, T.FLOOR)


def squad_up(game, group) -> int:
    """Make a bunch of raiders one squad: shared id, alternating flanks."""
    squad = game.next_uid()
    for i, r in enumerate(group):
        r.squad = squad
        r.flank = 1 if i % 2 == 0 else -1
    return squad


def _spot(game, lv, centre, lo: int, hi: int, brush_first: bool = False):
    rng = game.rng
    best = None
    for _ in range(40):
        x, y = centre[0] + rng.randint(-hi, hi), centre[1] + rng.randint(-hi, hi)
        if lo <= cheb((x, y), centre) <= hi and lv.free(x, y) and lv.tile(x, y) in SPOT_TILES:
            if not brush_first or lv.tile(x, y) == T.BRUSH:
                return (x, y)
            best = best or (x, y)
    return best


def ambush(game, lv, n: int) -> int:
    """Raiders waiting for you wherever you are (a road event, a toll gone wrong): half lie hidden close by, the rest stand
    off at range, and a few snares are laid between you and them.  Returns how many raiders were placed."""
    from outbreak.engine.spawn import make_raider
    p = game.player
    group = []
    for i in range(n):
        hide = i % 2 == 1
        spot = _spot(game, lv, p.pos, 4, 8, brush_first=True) if hide else _spot(game, lv, p.pos, 7, 11)
        if spot is None or cheb(spot, p.pos) < 3:
            continue
        r = make_raider(game, *spot)
        r.hidden, r.state = hide, ("idle" if hide else "hunt")
        lv.add_actor(r)
        group.append(r)
    squad_up(game, group)
    for _ in range(3):
        spot = _spot(game, lv, p.pos, 2, 6)
        if spot and spot not in lv.hazards and lv.tile(*spot) != T.FLOOR:
            lv.hazards[spot] = Hazard("snare", 10 ** 9, SNARE_POWER, hidden=True)
    return len(group)


def scatter_snares(game) -> int:
    """Tripwires on the roads, here and there: raiders do not only defend camps."""
    lv = game.world.level
    sx, sy = game.world.start
    roads = [(x, y) for y in range(2, lv.h - 2) for x in range(2, lv.w - 2)
             if lv.tile(x, y) == T.ROAD and cheb((x, y), (sx, sy)) >= 30]
    n = max(2, len(roads) // 250)
    game.rng.shuffle(roads)
    placed = 0
    for pos in roads:
        if placed >= n:
            break
        if pos not in lv.hazards and pos not in lv.occ:
            lv.hazards[pos] = Hazard("snare", 10 ** 9, SNARE_POWER, hidden=True)
            placed += 1
    return placed
