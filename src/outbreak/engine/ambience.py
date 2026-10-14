"""The world makes noise too: weather, loud ground, and things that go off on their own.

Everything here only *emits* noise or scales how far noise and sight carry; the zombies already know how to react to
both.  So a car alarm across town pulls the dead away from you, thunder pulls them toward wherever it struck, and
walking on gravel or through a market full of broken glass makes you far easier to find than walking on grass.
"""
from __future__ import annotations

from typing import Dict, Tuple

from outbreak.engine import tiles as T
from outbreak.engine.model import Zombie
from outbreak.util import cheb, compass

# ------------------------------------------------------------------ weather
WEATHER = ("clear", "rain", "fog", "storm")
HEARING = {"clear": 1.0, "rain": 0.7, "fog": 0.9, "storm": 0.55}      # how far noise carries
SIGHT = {"clear": 1.0, "rain": 0.8, "fog": 0.5, "storm": 0.65}        # how far the dead see (outdoors)
PLAYER_SIGHT = {"clear": 0, "rain": -1, "fog": -3, "storm": -2}       # tiles off your own view (outdoors)
CHANGE_EVERY = 120                                                    # turns between weather rolls
NEXT = {                                                              # transition weights
    "clear": (("clear", 6), ("rain", 2), ("fog", 1)),
    "rain": (("clear", 3), ("rain", 4), ("storm", 2), ("fog", 1)),
    "fog": (("clear", 4), ("fog", 3), ("rain", 2)),
    "storm": (("rain", 4), ("clear", 2), ("storm", 2)),
}
ARRIVES = {"rain": "It starts to rain. Footsteps and voices will not carry far now.",
           "fog": "A thick fog rolls in. You can see little, and so can they.",
           "storm": "The sky goes black. A storm is breaking.",
           "clear": "The weather clears."}


def outdoors(game) -> bool:
    return game.level.kind == "overworld"


def hearing_scale(game) -> float:
    return HEARING.get(game.weather, 1.0) if outdoors(game) else 1.0


def sight_scale(game) -> float:
    return SIGHT.get(game.weather, 1.0) if outdoors(game) else 1.0


def weather_tick(game) -> None:
    t = game.clock.turn
    if t % CHANGE_EVERY == 0 and t > 0:
        options = NEXT[game.weather]
        pick = game.rng.random() * sum(w for _, w in options)
        new = options[-1][0]
        for name, w in options:
            pick -= w
            if pick <= 0:
                new = name
                break
        if new != game.weather:
            game.weather = new
            if outdoors(game):
                game.msg(ARRIVES[new], "info")
    if game.weather in ("rain", "storm") and t % 10 == 0:             # rain washes the trail away
        game.scent = {k: v for k, v in game.scent.items() if t - v < 40}
    if game.weather == "storm" and outdoors(game) and t % 30 == 0 and game.rng.random() < 0.5:
        _thunder(game)


def _thunder(game) -> None:
    p, lv = game.player, game.level
    ang_x, ang_y = game.rng.randint(-26, 26), game.rng.randint(-26, 26)
    pos = (max(2, min(lv.w - 3, p.x + ang_x)), max(2, min(lv.h - 3, p.y + ang_y)))
    game.msg("Thunder cracks overhead.", "info")
    game.flash_turn = game.clock.turn
    emit_on(game, lv, pos, 16, "world")


# ------------------------------------------------------------------ loud (and conspicuous) ground
# extra noise per step by what you walk on, and by the kind of place you are inside
SURFACE = {T.ROAD: 0, T.BRUSH: 0, T.SHALLOW: 0, T.STAIRS_UP: 2, T.STAIRS_DOWN: 2, T.DOOR_OPEN: 1}
PLACE = {"market": 1, "medical": 0, "lab": 1, "industry": 2, "transit": 2, "faith": 1, "house": 1, "guard": 0,
         "military": 0, "camp": 0}
PLACE_WHY = {"market": "Broken glass crunches underfoot.", "lab": "Glass and spilled equipment crunch underfoot.",
             "industry": "Loose metal rings under your boots.", "transit": "Your steps echo off the platforms.",
             "faith": "Your steps echo in the empty hall.", "house": "The old boards creak."}
STEP_NOTICE_GAP = 40                                                 # do not say it every step


def step_extra(game, tile: int) -> int:
    """Noise a step adds on top of the base for the ground (the building you are in counts too)."""
    extra = SURFACE.get(tile, 0)
    lv = game.level
    if lv.kind == "interior":
        extra += PLACE.get(game.poi_kind_of(lv), 0)
    return extra


def explain_step(game, tile: int) -> None:
    lv = game.level
    why = ""
    if lv.kind == "interior":
        why = PLACE_WHY.get(game.poi_kind_of(lv), "")
    elif tile == T.SHALLOW:
        why = "You splash through the shallows."
    if why and game.clock.turn - game.last_step_note >= STEP_NOTICE_GAP and not game.player.sneaking:
        game.last_step_note = game.clock.turn
        game.msg(why, "info")


def exposure_of_ground(game) -> float:
    """How much more (or less) visible you are to the dead because of where you stand."""
    tile = game.level.tile(*game.player.pos)
    return {T.ROAD: 1.2, T.SHALLOW: 1.25}.get(tile, 1.0)


# ------------------------------------------------------------------ noise that comes from the world
def emit_on(game, level, pos, radius: float, source: str = "world") -> None:
    """Make noise on any level (an alarm in a building is heard out in the street)."""
    prev = game.level
    game.level = level
    try:
        game.emit_noise(pos, radius, source)
    finally:
        game.level = prev


def _heard(game, pos, radius) -> bool:
    return game.level.kind == "overworld" and cheb(pos, game.player.pos) <= radius * 1.3


def _say_direction(game, pos, text: str) -> None:
    p = game.player
    if _heard(game, pos, 16):
        game.msg(f"{text} ({compass(pos[0] - p.x, pos[1] - p.y)})", "warn")


def _random_spot(game, lo: int, hi: int):
    p, lv = game.player, game.world.level
    for _ in range(30):
        x = p.x + game.rng.randint(-hi, hi)
        y = p.y + game.rng.randint(-hi, hi)
        if lo <= cheb((x, y), p.pos) <= hi and 2 < x < lv.w - 2 and 2 < y < lv.h - 2 and lv.walkable(x, y):
            return (x, y)
    return None


# what the world can do by itself, and how each thing sounds.  Which of them an era has is content/eras.py (EraRules.ambient).
EVENTS = {
    "car_alarm": dict(radius=15, every=3, left=24, text="A car alarm starts to wail somewhere out there."),
    "siren": dict(radius=18, every=4, left=30, text="A siren wails across the rooftops."),
    "klaxon": dict(radius=18, every=3, left=30, text="A klaxon blares from some dead facility."),
    "phone": dict(radius=8, every=6, left=30, text="Somewhere close, a phone is ringing."),
    "helicopter": dict(radius=26, every=2, left=12, text="A helicopter thunders overhead."),
    "bell": dict(radius=20, every=8, left=40, text="A bell tolls in the distance. Someone, or the wind, is ringing it."),
    "livestock": dict(radius=10, text="Animals panic somewhere out there: barking, lowing, hooves."),
    "collapse": dict(radius=14, text="Something heavy collapses in the distance."),
    "surge": dict(radius=16, text="A power surge cracks and sparks in the distance."),
    "drone": dict(radius=10, every=2, left=44, drift=True, text="A patrol drone whines past, sweeping the streets."),
}


def _pulse(game, s) -> None:
    emit_on(game, game.world.level, s["pos"], s["radius"], "world")


def world_tick(game) -> None:
    """Things that happen on their own: the pulses of anything still sounding, and now and then something new."""
    t = game.clock.turn
    p = game.player
    for s in list(game.sources):
        if s.get("drift") and t % 2 == 0:
            lv = game.world.level
            nx, ny = s["pos"][0] + s["drift"][0], s["pos"][1] + s["drift"][1]
            if 2 < nx < lv.w - 2 and 2 < ny < lv.h - 2:
                s["pos"] = (nx, ny)
            else:
                s["left"] = 0
        if t % s["every"] == 0:
            _pulse(game, s)
        if s["kind"] == "drone" and not s.get("scanned") and game.level.kind == "overworld" and cheb(s["pos"], p.pos) <= 7 \
                and not p.sneaking:
            s["scanned"] = True                                  # it noticed you: the scan itself is a call
            game.msg("The drone's scanner pings you!", "bad")
            emit_on(game, game.world.level, p.pos, 14, "world")
        s["left"] -= 1
        if s["left"] <= 0:
            game.sources.remove(s)
    rules = game.era.rules
    if game.level.kind != "overworld" or t % 20 != 0 or t < 100:
        return
    if game.rng.random() >= (0.18 + 0.05 * min(6.0, game.pressure)) * rules.ambient_rate:
        return
    pos = _random_spot(game, 12, 34)
    if pos is None:
        return
    options = rules.ambient
    pick = game.rng.random() * sum(w for _, w in options)
    kind = options[-1][0]
    for name, w in options:
        pick -= w
        if pick <= 0:
            kind = name
            break
    ev = EVENTS[kind]
    if "every" in ev:
        src = {"pos": pos, "radius": ev["radius"], "every": ev["every"], "left": ev["left"], "kind": kind}
        if ev.get("drift"):
            src["drift"] = (game.rng.choice((-1, 1)), game.rng.choice((-1, 0, 1)))
        game.sources.append(src)
    else:
        emit_on(game, game.world.level, pos, ev["radius"], "world")
    _say_direction(game, pos, ev["text"])


def building_alarm(game, poi) -> None:
    """The first time you walk into a building that could still have a working alarm, it may go off."""
    if poi.id in game.alarmed or poi.kind not in ("market", "guard", "military", "lab"):
        return
    game.alarmed.add(poi.id)
    if game.rng.random() >= game.era.rules.alarm_chance:
        return
    game.msg("An alarm shrieks through the building. They will hear that outside!", "bad", key=True)
    game.sources.append({"pos": poi.pos, "radius": 20, "every": 3, "left": 21, "kind": "building alarm"})
    emit_on(game, game.world.level, poi.pos, 20, "world")


def startle(game, tile: int) -> None:
    """Pushing through brush flushes crows (and worse): a burst of noise that is not yours to control."""
    if tile != T.BRUSH or game.player.sneaking or game.clock.is_night:
        return
    if game.rng.random() < 0.06:
        game.msg("A flock of crows bursts out of the brush!", "warn")
        game.emit_noise(game.player.pos, 9, "world")


def heard_sources(game):
    """The sounding alarms you can hear from where you stand (for the map)."""
    if game.level.kind != "overworld":
        return []
    return [s for s in game.sources if cheb(s["pos"], game.player.pos) <= s["radius"] * 1.3]


def status(game) -> str:
    return "" if game.weather == "clear" else game.weather
