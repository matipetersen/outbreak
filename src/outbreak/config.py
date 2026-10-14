"""Game configuration chosen on the new-game screen (or the command line)."""
from __future__ import annotations

import random
from dataclasses import asdict, dataclass, replace
from typing import Optional

from outbreak import content


@dataclass(frozen=True)
class Difficulty:
    name: str
    zombies: float       # population multiplier
    loot: float          # loot multiplier
    damage: float        # damage taken multiplier
    timer: float         # infection timer / deadline multiplier
    noise: float         # how quickly noise builds heat


DIFFICULTIES = {
    "easy": Difficulty("easy", 0.7, 1.3, 0.75, 1.3, 0.8),
    "normal": Difficulty("normal", 1.0, 1.0, 1.0, 1.0, 1.0),
    "hard": Difficulty("hard", 1.3, 0.8, 1.25, 0.8, 1.25),
}


MODES = ("normal", "living")
RANDOMIZABLE = ("era", "zombies", "scenario", "origin", "mode")      # any of these may be "random": drawn when the game starts


@dataclass
class GameConfig:
    era: str = "modern"
    zombies: str = "classic"
    scenario: str = "cure"
    origin: str = "medic"
    opening: str = "random"      # a key of content.OPENINGS, or "random" (picked from your origin)
    difficulty: str = "normal"
    seed: Optional[int] = None
    mode: str = "normal"         # normal: one life | living: the world goes on, infinite lives
    needs: bool = False          # hunger
    permadeath: bool = True      # delete the save when you die
    map_w: int = 120
    map_h: int = 76

    def random_fields(self) -> list:
        return [f for f in RANDOMIZABLE if getattr(self, f) == "random"]

    def resolve(self) -> "GameConfig":
        """A copy with every \"random\" replaced by a concrete choice.  With a seed the draw is reproducible."""
        fields = self.random_fields()
        if not fields:
            return self
        rng = random.Random(self.seed ^ 0xC0FFEE) if self.seed is not None else random.SystemRandom()
        choices = {"era": list(content.ERAS), "zombies": list(content.PRESETS), "scenario": list(content.SCENARIOS),
                   "origin": list(content.ORIGINS), "mode": ["normal", "living"]}
        return replace(self, **{f: rng.choice(choices[f]) for f in fields})

    def validate(self) -> "GameConfig":
        content.get_era(self.era)
        content.get_preset(self.zombies)
        content.get_scenario(self.scenario)
        content.get_origin(self.origin)
        if self.opening != "random":
            content.get_opening(self.opening)
        if self.mode not in MODES:
            raise KeyError(f"unknown mode {self.mode!r}; choose one of: {', '.join(MODES)}")
        if self.difficulty not in DIFFICULTIES:
            raise KeyError(f"unknown difficulty {self.difficulty!r}; choose one of: {', '.join(DIFFICULTIES)}")
        if not (100 <= self.map_w <= 400 and 64 <= self.map_h <= 300):
            raise ValueError("map size out of range (minimum 100x64: smaller maps cannot hold every building type)")
        return self

    @property
    def diff(self) -> Difficulty:
        return DIFFICULTIES[self.difficulty]

    def to_dict(self) -> dict:
        return asdict(self)
