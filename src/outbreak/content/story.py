"""Words that make a run feel like yours: who you were, and how it ends when you get out.

The tables are filled in with the facts of the run (who is beside you, how many days, which door you took) by
``engine.setup`` for the briefing and ``engine.ending`` for the closing scenes.
"""
from __future__ import annotations

from typing import Dict, Tuple

ORIGIN_VOICE: Dict[str, str] = {
    "medic": "You have patched people up for a living, and you know exactly how bad a bite is.",
    "soldier": "You were trained for something like this. It does not make it any easier.",
    "scholar": "You read for a living. The world is now a text you can barely parse, and you mean to learn it.",
    "outlaw": "You have lived outside the law long enough to know what a locked door is worth.",
    "guard": "You kept watch for other people. Now there is only your own back to cover.",
}

LIGHT_WORDS = {"day": "full daylight", "night": "dark", "edge": "the grey edge of the day"}

SCENARIO_TAIL: Dict[str, str] = {
    "cure": "Three components and a formula stand between the world and a cure. Read every page you find.",
    "extraction": "Power, a signal, the right papers: that is what opens the way out. Ask the ones who know.",
    "dash": "The road is long, and the daylight is the only thing you cannot stretch. Spend it like it is the last you will get.",
    "endless": "No way out, no clock. The next day, and the one after, each a little worse.",
}

# ------------------------------------------------------------------ the closing scenes (a win)
SCENE_TITLES = ("The way out", "Beside you", "What it cost", "Afterwards")

WAY_OUT: Dict[Tuple[str, str], str] = {                       # (era, "out" | "cure") -> text; {via} {pad} {refuge}
    ("medieval", "out"): "The {via} bursts open on a grey morning, and there is the water: {pad}, a boat riding low at the quay, its sail already loose. A hand reaches down. You take it.",
    ("eighties", "out"): "Through the {via} you hear it before you see it: rotors beating the air flat over {pad}. The floodlight finds you. You run into it.",
    ("modern", "out"): "Through the {via} the night is suddenly full of noise and light. A helicopter is coming down on {pad}, the downwash tearing at your clothes. Someone is shouting for you to hurry.",
    ("scifi", "out"): "Through the {via} the dock lights flare. A shuttle hangs over {pad}, ramp down, engines screaming. The beacon on your wrist finally turns green.",
    ("medieval", "cure"): "You step out through the {via} into the cloister with the vial held against your chest. The bell of {refuge} begins to toll, not in alarm, but slowly, as for a feast.",
    ("eighties", "cure"): "You come through the {via} into the corridor of {refuge} with the case clutched in both hands. People turn. Nobody speaks. Then someone starts to clap.",
    ("modern", "cure"): "You push through the {via} and into the lights of {refuge}. The case in your hands is still cold. Somebody takes it from you as if it might break, and runs.",
    ("scifi", "cure"): "The {via} cycles open onto the main corridor of {refuge}. The sample reads green on every scanner. Somebody laughs, then cries, then runs for the lab.",
}

COMPANY: Dict[str, str] = {                                   # band -> what they say; {name} {label}
    "saint": "{name}, the {label}, is beside you. \"I would not have made it without you.\"",
    "survivor": "{name}, the {label}, is beside you. \"We were lucky. Let us not forget how lucky.\"",
    "cold": "{name}, the {label}, is beside you. \"...I am still here. That is all I will say.\"",
    "monster": "{name}, the {label}, walks a step behind you now, and does not speak.",
}
COMPANY_LOST = "You think of {lost}, who is not here to see it."
COMPANY_PET = "{pet} presses against your leg, alive and entirely uninterested in history."
COMPANY_ALONE = "Nobody is beside you. The quiet is its own kind of sound."

COST: Dict[str, str] = {
    "saint": "Whatever else happened, you stayed someone worth following.",
    "survivor": "You are not sure you are the same person who started. You are not sure that is bad.",
    "cold": "You did what it took. You will be doing the arithmetic for a long time.",
    "monster": "The ones who see you go quiet. You tell yourself it is respect.",
}

SKY: Dict[str, str] = {
    "medieval": "grey light over the water", "eighties": "the first light on the concrete",
    "modern": "the first light on the skyline", "scifi": "the slow turn of the station's dawn",
}
AFTERWARDS: Dict[str, str] = {                                # {sky}
    "saint": "Behind you, {sky}. Ahead, people who are glad you came. It is not over. It is a beginning.",
    "survivor": "Behind you, {sky}. You breathe out for the first time in days, and the breath goes on and on.",
    "cold": "Behind you, {sky}. Ahead, strangers, and the distance you made. You do not look back.",
    "monster": "Behind you, {sky}, and a trail nobody will forget. Ahead, a long road, and no company but yourself.",
}
