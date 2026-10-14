"""Animals that can come to travel with you: a dog, a cat, a crow, a fox."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class PetSpec:
    species: str
    label: str
    glyph: str
    hp: int
    dmg: Tuple[int, int]
    acc: int
    accept: float                 # chance a stray takes to you when you offer food
    strength: str
    flaw: str
    intro: str
    idle: Tuple[str, ...]
    gift: str = ""                # what it sometimes brings back ("" = nothing)


PETS: Tuple[PetSpec, ...] = (
    PetSpec("dog", "dog", "D", 16, (3, 6), 60, 0.85,
            "fights beside you, and growls at what is waiting in the dark",
            "barks at the wrong time, and wants feeding",
            "wags once, slowly, and falls in at your heel.",
            ("pants and looks up at you.", "sniffs at the ground and keeps pace.", "leans against your leg.")),
    PetSpec("cat", "cat", "m", 8, (1, 2), 40, 0.5,
            "steadies your nerves, and finds scraps",
            "runs from a fight, and wanders if you ignore it",
            "considers you for a long moment, then decides you will do.",
            ("purrs against your boot.", "washes a paw, entirely unconcerned.", "watches a doorway that is empty."),
            gift="raw_meat"),
    PetSpec("crow", "crow", "v", 5, (1, 2), 40, 0.45,
            "sees far, and brings you bright things",
            "caws, and the dead are listening",
            "lands on a shoulder as though it had always been there.",
            ("tilts its head at you.", "preens, one eye on the sky.", "taps the ground and looks pleased."),
            gift="coins"),
    PetSpec("fox", "fox", "x", 10, (2, 4), 50, 0.4,
            "hunts for you, and walks without a sound",
            "bolts from trouble, and takes a long time to forgive",
            "takes the food from your hand, ears flat, and does not leave.",
            ("trots a few paces ahead, then waits.", "sniffs the wind with great seriousness.", "watches the treeline."),
            gift="raw_meat"),
)

BY_SPECIES: Dict[str, PetSpec] = {p.species: p for p in PETS}
PET_NAMES: Tuple[str, ...] = ("Biscuit", "Pepper", "Moss", "Ember", "Ash", "Bean", "Juniper", "Rook", "Tuna", "Clover",
                              "Pickle", "Saffron", "Bandit", "Wren", "Smudge", "Maple")
