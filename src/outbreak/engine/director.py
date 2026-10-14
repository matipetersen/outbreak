"""The Director: it reads where you are in the hero's journey and how you are doing, and paces the world to match.

Two things are measured.  *Progress* is how far you really are (objectives met, how much of the clock is gone): it picks the
stage of the journey (content/director.py), and with it how hard the peaks are and how long the calm lasts.  *Tension* is
how hard things are pressing on you right now (enemies in view, damage taken, panic, noise).  Between the two it runs a
cycle - build, peak, release - like a good story does: quiet, then a threat that is announced a few turns before it lands,
then room to breathe.  When you are in trouble (low health, no healing) it eases off instead of piling on.

It never invents anything the engine cannot already do: it schedules hordes, ambushes and one big threat per ordeal, and
it tilts the odds on wandering zombies and random events.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Tuple

from outbreak.content.director import ACT_LINES, BY_ID, RELIEF_EVENTS, STAGES, THREAT_EVENTS
from outbreak.engine import hordes
from outbreak.engine import tiles as T
from outbreak.engine.spawn import spawn_zombie
from outbreak.util import cheb, compass

SAMPLE_EVERY = 5
TELEGRAPH = 10                 # a threat is announced this many turns before it lands
MERCY_HP = 0.35
PEAK_MAX = 130                 # a peak never lasts longer than this


@dataclass
class Director:
    stage: int = 0
    tension: float = 0.0
    phase: str = "build"                 # build | peak | release
    phase_until: int = 0
    hp_last: int = 0
    damage: float = 0.0                  # recent damage, decaying
    pending: List[Tuple[int, str, int]] = field(default_factory=list)       # (turn, kind, size)
    done: List[str] = field(default_factory=list)                           # one-time beats already told
    threats: int = 0
    last_threat: int = -999
    mercy: int = 0                       # times it eased off because you were in trouble
    inside_since: int = -1               # since when you have been indoors (the world outside goes on)
    last_siege: int = -999


def _dir(game) -> Director:
    d = getattr(game, "director", None)
    if d is None:
        d = game.director = Director(hp_last=game.player.hp)
        d.phase_until = game.clock.turn + game.rng.randint(*STAGES[0].wait)
    return d


# ------------------------------------------------------------------ progress and tension
def progress(game) -> float:
    """How far along the journey you really are, 0-1."""
    sc = game.scenario
    if sc.escalates:                                          # the endless run goes round the journey again and again
        return ((game.clock.turn / 240.0) % 9.0) / 9.0 * 0.95
    reqs = game.requirements()
    r = sum(1 for _, done, _ in reqs if done) / len(reqs) if reqs else 0.0
    horizon = 240.0 * (game.deadline_days or 10)
    c = min(1.0, game.clock.turn / horizon)
    s = 0.65 * r + 0.35 * c
    site = game.pois.get(game.final_site_id)
    if site is not None and site.revealed:
        s += 0.04
    if game.final:
        s = max(s, 0.92)
    return min(1.0, s)


def stage_of(game):
    return STAGES[_dir(game).stage]


def _stage_index(s: float) -> int:
    idx = 0
    for i, st in enumerate(STAGES):
        if s >= st.start:
            idx = i
    return idx


def _power(game) -> float:
    """How much the player can take: levels, armour, a weapon, a companion."""
    p = game.player
    w = game.item_def(p.weapon.id) if p.weapon else None
    power = 1.0 + 0.12 * (p.level - 1) + (0.3 if p.armor else 0.0) + (0.2 if w and sum(w.dmg) >= 9 else 0.0)
    from outbreak.engine import companion, pets
    if companion.current(game) is not None:
        power += 0.35
    if pets.current(game) is not None:
        power += 0.12
    return power


def _sample(game, d: Director) -> None:
    p = game.player
    d.damage = d.damage * 0.9 + max(0, d.hp_last - p.hp) * 2.0
    d.hp_last = p.hp
    raw = 10.0 * min(4, len(game.visible_hostiles())) + p.panic * 0.4 + game.heat * 0.25 + d.damage
    for ally in _allies(game):                                  # watching them get hurt is part of the pressure
        if ally.hp < ally.max_hp * 0.4:
            raw += 12.0
    d.tension = min(100.0, max(raw, d.tension * 0.95))


def _allies(game):
    from outbreak.engine import companion, pets
    return [a for a in (companion.current(game), pets.current(game)) if a is not None]


def mourn(game) -> None:
    """Someone who travelled with you is dead: the world holds its breath for a while."""
    d = getattr(game, "director", None)
    if d is None:
        return
    d.phase, d.phase_until = "release", game.clock.turn + 200
    d.pending = [item for item in d.pending if item[1] != "boss"] if STAGES[d.stage].id != "ordeal" else d.pending
    game.msg("Nobody speaks for a long time. The road lets you be.", "dir")


def _in_trouble(game) -> bool:
    p = game.player
    if any(a.hp < a.max_hp * 0.25 for a in _allies(game)):
        return True
    meds = sum(p.count(i) for i in ("medkit", "bandage") if i in game.items)
    return p.hp < p.max_hp * MERCY_HP or (p.bleeding and meds == 0 and p.hp < p.max_hp * 0.6)


# ------------------------------------------------------------------ what it does to the world
def scale(game) -> float:
    """Multiplier on the world's own threat generation (wanderers, random events)."""
    d = getattr(game, "director", None)
    if d is None:
        return 1.0
    st = STAGES[d.stage]
    base = {"build": 1.0, "peak": 1.35, "release": 0.2}[d.phase] * (0.5 + st.peak / 100.0)
    if d.stage <= 3:
        base = min(base, 0.6)                                 # the ordinary world, the call, the refusal: gentle
    return max(0.1, base)


def event_bias(game, event_id: str) -> float:
    d = getattr(game, "director", None)
    if d is None:
        return 1.0
    if event_id in RELIEF_EVENTS:
        return {"release": 2.5, "build": 1.0, "peak": 0.4}[d.phase]
    if event_id in THREAT_EVENTS:
        return {"release": 0.2, "build": 1.0, "peak": 1.8}[d.phase]
    return 1.0


def status(game) -> str:
    d = getattr(game, "director", None)
    if d is None:
        return ""
    st = STAGES[d.stage]
    bars = "#" * int(d.tension // 20) + "." * (5 - int(d.tension // 20))
    return f"Act {d.stage + 1}/{len(STAGES)} {st.title}  [{bars}] {d.phase}"


def tick(game) -> None:
    t = game.clock.turn
    d = _dir(game)
    if t % SAMPLE_EVERY:
        return
    _sample(game, d)
    _stage(game, d, t)
    _due(game, d, t)
    inside = game.level is not game.world.level
    d.inside_since = (d.inside_since if d.inside_since >= 0 else t) if inside else -1
    if inside:
        _siege(game, d, t)
    if game.final or game.pending_event or game.level.kind == "haven" or getattr(game.level, "safe", False):
        return                                                   # indoors counts: the story does not stop at the door
    st = STAGES[d.stage]
    if _in_trouble(game) and d.phase != "release":
        d.phase, d.phase_until = "release", t + st.release // 2
        d.mercy += 1
        game.msg("A lull falls. Whatever was after you has lost the scent.", "dir")
        return
    if d.phase == "build" and t >= d.phase_until and d.tension < max(12, st.peak * 0.45) and not d.pending:
        _threat(game, d, st, t)
    elif d.phase == "peak" and not d.pending and (t >= d.phase_until or (d.tension < 25 and t - d.last_threat > 50)):
        d.phase, d.phase_until = "release", t + st.release
        game.msg("It passes. For now, the road is yours.", "dir")
    elif d.phase == "release" and t >= d.phase_until:
        d.phase = "build"
        d.phase_until = t + game.rng.randint(*st.wait)


def _siege(game, d: Director, t: int) -> None:
    """While you are indoors, the people waiting outside for you are not safe: the dead find them."""
    if d.stage < 4 or t - d.inside_since < 50 or t - d.last_siege < 400 or game.final:
        return
    allies = _allies(game)
    if not allies or game.rng.random() >= 0.35 or _in_trouble(game):
        return
    d.last_siege = t
    ally = allies[0]
    lv = game.world.level
    n = 2 + d.stage // 4
    placed = 0
    for _ in range(40):
        if placed >= n:
            break
        spot = lv.free_spot_near(ally.x + game.rng.randint(-5, 5), ally.y + game.rng.randint(-5, 5), 2)
        if spot and cheb(spot, ally.pos) >= 3:
            z = spawn_zombie(game, lv, spot, None, dormant=False)
            z.state, z.target, z.stimulus_turn = "hunt", ally.pos, game.clock.turn
            placed += 1
    if placed:
        who = ally.name
        game.msg(f"Through the walls, faint: {who} - shouting, then barking, then nothing you can make out. "
                 f"Whatever is out there is on them.", "dir", key=True)


def _stage(game, d: Director, t: int) -> None:
    idx = _stage_index(progress(game))
    if game.scenario.escalates:
        idx = min(idx, len(STAGES) - 2)
    elif idx < d.stage:
        idx = d.stage                                         # a story does not run backwards
    if d.done and idx == d.stage:
        return
    first = not d.done
    d.stage = idx
    st = STAGES[idx]
    if st.id in d.done and not game.scenario.escalates:
        return
    if st.id not in d.done:
        d.done.append(st.id)
    goal = next((txt for txt, done in game.objectives() if not done), "see it through")
    if not first:
        game.msg(f"ACT {idx + 1}: {st.title}.", "dir", key=True)
        game.msg(st.cue.format(goal=goal, refuge=game.era.refuge), "dir")
    from outbreak.engine import companion
    c = companion.current(game)
    if c is not None and st.id in ACT_LINES and t > 30:
        companion.say(game, c, ACT_LINES[st.id][0])
    d.phase, d.phase_until = "build", t + game.rng.randint(*st.wait)
    _beat(game, d, st, t)


def _beat(game, d: Director, st, t: int) -> None:
    if st.beat == "call":
        game.reveal_random_lead()
    elif st.beat == "mentor":
        if game.reveal_random_lead():
            game.msg("A scrap of knowledge from the road: someone tells you where to look.", "dir")
    elif st.beat == "allies":
        from outbreak.engine import pets
        pets.stray_beat(game)
    elif st.beat == "threshold":
        d.pending.append((t + 15, "horde", 3))
        game.msg("The first test is on its way. Be ready.", "dir")
    elif st.beat == "approach":
        site = game.pois.get(game.final_site_id)
        if site is not None and not site.revealed:
            site.revealed = True
            game.msg(f"You learn where it is: {site.name} is marked on your map.", "dir")
    elif st.beat == "ordeal":
        d.pending.append((t + TELEGRAPH + 10, "boss", 1))
        game.msg("Something large is coming. You can feel it before you see it.", "dir")
    elif st.beat == "reward":
        for iid, n in (("medkit", 1), ("food", 2), ("bandage", 2)):
            if iid in game.items:
                from outbreak.engine.model import Item
                game.give_item(Item(iid, n))
        game.msg("In what it left behind: supplies enough to keep going.", "dir")
        d.phase, d.phase_until = "release", t + st.release
        for ally in _allies(game):
            ally.bond = min(100, ally.bond + 6)
        if _allies(game):
            game.msg("You sit, finally. Nobody says anything. It is the closest thing to peace you have had.", "dir")
    elif st.beat == "chase":
        d.pending.append((t + 20, "horde", 5))


# ------------------------------------------------------------------ threats, announced before they land
def _threat(game, d: Director, st, t: int) -> None:
    rng, power = game.rng, _power(game)
    size = max(2, int(round((2 + st.peak / 22.0) * (0.6 + 0.4 * power))))
    kind = rng.choice(["horde", "horde", "raiders", "special"]) if d.stage >= 4 else "horde"
    if kind == "raiders" and game.era.id == "scifi" and rng.random() < 0.3:
        kind = "horde"
    d.pending.append((t + TELEGRAPH, kind, size))
    d.phase, d.phase_until = "peak", t + PEAK_MAX
    d.threats += 1
    d.last_threat = t
    if game.level is not game.world.level:
        cue = {"horde": "Something knocks against the walls. More than one thing.",
               "raiders": "A door, far below. Careful hands. They are not here to talk.",
               "special": "A sound you have not heard before, somewhere in the building."}[kind]
    else:
        cue = {"horde": "A restlessness runs through the dead. Something is coming this way.",
               "raiders": "Voices, off the road. People who are not friendly.",
               "special": "A sound you have not heard before, far off."}[kind]
    game.msg(cue, "dir")


def _due(game, d: Director, t: int) -> None:
    for item in list(d.pending):
        due, kind, size = item
        if t < due or game.level.kind == "haven" or getattr(game.level, "safe", False):
            continue
        d.pending.remove(item)
        _land(game, d, kind, size)


def _land_indoors(game, d: Director, kind: str, size: int) -> None:
    """The same cycle, inside a building or a cave: the dead find a way in, or what was waiting inside wakes."""
    p, lv, rng = game.player, game.level, game.rng
    floor = [(x, y) for y in range(lv.h) for x in range(lv.w) if lv.tiles[y][x] == T.FLOOR and lv.free(x, y)]
    spots: list = []
    for gap in (9, 6, 4, 3):                                      # a small house has no room to spare
        spots = [q for q in floor if cheb(q, p.pos) >= gap]
        if spots:
            break
    if not spots:
        return
    rng.shuffle(spots)
    where = compass(spots[0][0] - p.x, spots[0][1] - p.y)
    if kind == "raiders":
        entry = lv.entry
        placed = 0
        from outbreak.engine.spawn import make_raider
        for _ in range(max(2, min(4, size))):
            spot = lv.free_spot_near(entry[0], entry[1], 3)
            if spot and cheb(spot, p.pos) >= 4:
                r = make_raider(game, spot[0], spot[1])
                r.state = "hunt"
                lv.add_actor(r)
                placed += 1
        if placed:
            game.msg("Boots on the stairs behind you. People who followed you in.", "dir", key=True)
        return
    n = max(2, min(8, size)) if kind == "horde" else 1
    made = []
    for spot in spots[:n]:
        sid = (_strongest(game, lv) if kind in ("special", "boss") else None)
        z = spawn_zombie(game, lv, spot, sid, dormant=False)
        z.state, z.target, z.stimulus_turn = "hunt", p.pos, game.clock.turn
        if kind == "boss":
            z.hp = z.max_hp = int(z.max_hp * 1.3)
        made.append(z)
    if kind == "horde":
        game.msg(f"The dead have found a way in: shuffling, to the {where}, and more behind.", "dir")
    elif kind == "special":
        game.msg(f"Something heavy is moving through the building, from the {where}.", "dir")
    else:
        game.msg(f"It was in here with you all along: to the {where}, and it knows exactly where you are.", "dir", key=True)


def _land(game, d: Director, kind: str, size: int) -> None:
    if game.level is not game.world.level:
        _land_indoors(game, d, kind, size)
        return
    p, lv, rng = game.player, game.world.level, game.rng
    if kind == "raiders":
        from outbreak.engine import memory
        before = max((a.uid for a in game.level.actors), default=0)
        game.spawn_raiders_near_player(max(2, min(5, size)))
        game.msg("Raiders step out of the cover!", "dir")
        memory.revenge(game, before)
        return
    for _ in range(40):
        ang = rng.uniform(0, math.tau)
        r = rng.randint(15, 21)
        pos = (int(p.x + math.cos(ang) * r), int(p.y + math.sin(ang) * r))
        if 2 < pos[0] < lv.w - 2 and 2 < pos[1] < lv.h - 2 and lv.free(*pos):
            break
    else:
        return
    where = compass(pos[0] - p.x, pos[1] - p.y)
    if kind == "horde":
        hordes.spawn_horde(game, pos, size * 2, p.pos)
        game.msg(f"The dead are coming from the {where}.", "dir")
    elif kind == "special":
        sid = _strongest(game, lv)
        z = spawn_zombie(game, lv, pos, sid, dormant=False)
        z.state, z.target, z.stimulus_turn = "hunt", p.pos, game.clock.turn
        game.msg(f"A {game.profile.name_of(sid).lower()} is hunting you, from the {where}.", "dir")
    elif kind == "boss":
        sid = _strongest(game, lv)
        z = spawn_zombie(game, lv, pos, sid, dormant=False)
        z.hp = z.max_hp = int(z.max_hp * 1.3)
        allies = _allies(game)
        aim = allies[0] if allies else None
        z.state, z.target, z.stimulus_turn = "hunt", (aim.pos if aim else p.pos), game.clock.turn
        hordes.spawn_horde(game, pos, 3, p.pos)
        game.msg(f"It comes from the {where}: a {game.profile.name_of(sid).lower()}, and it has not come alone."
                 + (f" It is heading for {aim.name} first." if aim else ""), "dir", key=True)


def _strongest(game, lv) -> str:
    best, hp = "walker", 0
    for sid, _w, first_day in game.profile.specials:
        if first_day <= game.clock.day + 2:
            from outbreak.content.zombies import SPECIALS
            if SPECIALS[sid].hp > hp and "boss" not in SPECIALS[sid].flags:
                best, hp = sid, SPECIALS[sid].hp
    return best
