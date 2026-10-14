"""The hero's journey as a pacing chart.

Twelve stages (after Campbell and Vogler), each with a target intensity and a way of being told.  The Director
(engine/director.py) reads how far you have really got, and shapes how hard and how often the world leans on you.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class Stage:
    id: str
    title: str
    start: float            # journey progress (0-1) at which it begins
    peak: int               # how hard its peaks are, 0-100
    wait: Tuple[int, int]   # quiet turns before the next threat while building
    release: int            # turns of respite after a peak
    cue: str                # what the log says as it begins; {goal} {refuge} are filled in
    beat: str = ""          # a one-time event at the start ("" = none)


STAGES: Tuple[Stage, ...] = (
    Stage("ordinary", "The Ordinary World", 0.00, 12, (140, 260), 160,
          "Before anything else, there is only the ordinary: the street, the quiet, the next hour. Learn the ground."),
    Stage("call", "The Call to Adventure", 0.04, 28, (110, 200), 140,
          "The call is plain and it will not go away: {goal}.", "call"),
    Stage("refusal", "The Refusal of the Call", 0.09, 22, (130, 230), 160,
          "It would be easier to stay, to hole up, to let someone else do it. Nobody else will."),
    Stage("mentor", "Meeting the Mentor", 0.14, 28, (110, 200), 140,
          "Somebody has seen more than you have. Listen to what they know.", "mentor"),
    Stage("threshold", "Crossing the Threshold", 0.20, 50, (80, 150), 110,
          "There is no going back to the way things were. The first real test is coming.", "threshold"),
    Stage("tests", "Tests, Allies and Enemies", 0.28, 58, (70, 140), 110,
          "The road teaches. Learn who can be trusted, and who cannot.", "allies"),
    Stage("approach", "Approach to the Inmost Cave", 0.55, 68, (60, 120), 100,
          "The air changes. Everything you have learned is about to be needed.", "approach"),
    Stage("ordeal", "The Ordeal", 0.70, 92, (50, 100), 90,
          "This is the hardest thing the road has asked. Hold on to whoever is still with you.", "ordeal"),
    Stage("reward", "The Reward", 0.78, 18, (180, 280), 220,
          "You are still standing. Take what you have earned, and breathe.", "reward"),
    Stage("road_back", "The Road Back", 0.82, 74, (50, 100), 80,
          "What you took has woken something. Now it follows you home.", "chase"),
    Stage("resurrection", "The Resurrection", 0.92, 95, (40, 80), 60,
          "One last test, and the cost of the whole road comes due.", "final"),
    Stage("return", "Return with the Elixir", 1.01, 10, (200, 300), 300,
          "Whatever happens next, you carry it back."),
)

BY_ID: Dict[str, Stage] = {s.id: s for s in STAGES}

# What the people with you say as an act begins
ACT_LINES: Dict[str, Tuple[str, ...]] = {
    "call": ("\"So that is what it is. Then that is what we do.\"",),
    "refusal": ("\"We could stop. Just for a day. Just to think.\"",),
    "mentor": ("\"Pay attention to that one. They know things.\"",),
    "threshold": ("\"There is no turning back from here, is there.\"",),
    "tests": ("\"Whatever is out there, it is ours to deal with now.\"",),
    "approach": ("\"I do not like how quiet it is. Stay close.\"",),
    "ordeal": ("\"Whatever happens, I am glad it was you.\"",),
    "reward": ("\"We are alive. Remember that. We are alive.\"",),
    "road_back": ("\"It is coming after us. Keep moving.\"",),
    "resurrection": ("\"This is it. Everything we did led here.\"",),
}

# Events that ease the pressure, and events that raise it
RELIEF_EVENTS: Tuple[str, ...] = ("hungry", "scholar", "cache", "trapped", "radio", "preacher", "stray")
THREAT_EVENTS: Tuple[str, ...] = ("toll", "bait", "prisoner", "bitten")
