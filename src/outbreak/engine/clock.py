"""World time: ten turns to an hour, 24 hours to a day."""
from __future__ import annotations

TURNS_PER_HOUR = 10
TURNS_PER_DAY = 24 * TURNS_PER_HOUR
START_HOUR = 8


class Clock:
    def __init__(self, turn: int = START_HOUR * TURNS_PER_HOUR):
        self.turn = turn

    @property
    def day(self) -> int:
        return self.turn // TURNS_PER_DAY + 1

    @property
    def hour(self) -> float:
        return (self.turn % TURNS_PER_DAY) / TURNS_PER_HOUR

    @property
    def light(self) -> float:
        """0.0 (night) .. 1.0 (day) with a ramp at dawn and dusk."""
        h = self.hour
        if 7 <= h < 19:
            return 1.0
        if 5 <= h < 7:
            return (h - 5) / 2
        if 19 <= h < 21:
            return 1 - (h - 19) / 2
        return 0.0

    @property
    def is_night(self) -> bool:
        return self.light < 0.35

    @property
    def is_day(self) -> bool:
        return self.light > 0.7

    @property
    def phase(self) -> str:
        h = self.hour
        if 5 <= h < 7:
            return "dawn"
        if 7 <= h < 19:
            return "day"
        if 19 <= h < 21:
            return "dusk"
        return "night"

    def stamp(self) -> str:
        h = int(self.hour)
        m = int((self.hour - h) * 60)
        return f"Day {self.day} {h:02d}:{m:02d}"

    def until_hour(self, hour: float) -> int:
        """Turns until the next time the clock reads ``hour``."""
        target = int(hour * TURNS_PER_HOUR)
        now = self.turn % TURNS_PER_DAY
        return (target - now) % TURNS_PER_DAY or TURNS_PER_DAY
