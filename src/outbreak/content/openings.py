"""Openings: where you are, and what you were doing, when the world ends.

An opening is a short scene per era plus a few small mechanical consequences
(what is in your pockets, what you already know, how frightened you are, what
hour it is).  The scene text never mentions a specific number or item the
engine might not give you; the effects are applied by ``engine.setup``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple

# What raises the alarm in each era (used in the consequence paragraph).
ALARMS: Dict[str, str] = {
    "medieval": "the alarm bells start to ring",
    "eighties": "the air-raid sirens start to wail",
    "modern": "the emergency alert screams from every phone and the sirens follow",
    "scifi": "the lockdown klaxon starts to sound",
}

CONSEQUENCE = "Then {alarm}, and nothing after it is ordinary. Whatever you were doing, it is over."


@dataclass(frozen=True)
class OpeningDef:
    id: str
    name: str
    hour: int                                  # clock hour you start at (6..14)
    scenes: Dict[str, str]                     # era id -> scene text
    perk: str                                  # one-line summary of the consequence for menus
    affinity: Dict[str, float] = field(default_factory=dict)   # origin id -> weight (default 0.4)
    items: Tuple[Tuple[str, int], ...] = ()    # item id or @role, quantity (added to the kit)
    words: int = 0
    coins: int = 0
    panic: int = 0
    humanity: int = 0


OPENINGS: Dict[str, OpeningDef] = {o.id: o for o in (
    OpeningDef(
        "study", "Studying", 6,
        {"medieval": "Dawn in the scriptorium. You are copying a physician's treatise by a thin candle, "
                     "the only soul awake in the abbey, when the first shout comes up from the lane.",
         "eighties": "Six in the morning in the university library. You have been up all night with a "
                     "borrowed stack of journals and a cold coffee, and the radiator is ticking.",
         "modern": "Six in the morning, the lab is empty and your laptop is the only light. You are "
                   "finishing a literature review on a coffee you stopped tasting hours ago.",
         "scifi": "Dead-shift on the archive deck. You are alone with a stack of data slates and a "
                  "half-decrypted log, the ventilation humming overhead."},
        "knows more of the cipher", {"scholar": 1.6, "medic": 0.8}, items=(("cloth", 1),), words=5),
    OpeningDef(
        "meal", "Preparing a meal", 7,
        {"medieval": "You are in the kitchen yard, plucking a hen for the household's breakfast, "
                     "elbow-deep in feathers and steam from the pot.",
         "eighties": "Seven a.m. You are frying eggs in a borrowed kitchen with the morning news burbling "
                     "on a portable television that suddenly turns to static.",
         "modern": "You are making breakfast in a stranger's kitchen with the radio on low, the pan "
                   "spitting, when the radio cuts out in the middle of a sentence.",
         "scifi": "You are in the galley, reheating rations for the shift, when the wall display "
                  "flickers and the cheerful menu freezes."},
        "some food in your pack", {"guard": 0.7}, items=(("food", 2),)),
    OpeningDef(
        "hunt", "Out hunting", 6,
        {"medieval": "A mist hangs on the moor. You have been stalking a deer since before sunrise, "
                     "bow in hand, when you notice the birds have gone silent.",
         "eighties": "Dawn in the pines. You are crouched in a deer stand with a rifle across your knees "
                     "and a thermos, waiting, when you hear something that is not a deer.",
         "modern": "Dawn at the edge of the woods, a hunting blind, a thermos going cold. A deer steps "
                   "out and then bolts the wrong way, toward you, as if it were afraid of something behind.",
         "scifi": "You are on a foraging run in the overgrown deck, tracking a feral drone-hen by its "
                  "chirps, when the chirps stop."},
        "a ranged weapon and food", {"soldier": 1.4, "outlaw": 1.0, "guard": 0.8},
        items=(("@ranged", 1), ("@ammo", 6), ("food", 1))),
    OpeningDef(
        "rounds", "On your rounds", 6,
        {"medieval": "You are changing the bandages on the night's wounded in the infirmary, a "
                     "cold dawn at the window, when one of them stops answering you.",
         "eighties": "End of a double shift on the ward. You are doing the dawn round with a clipboard "
                     "when the patient in bed six sits up the wrong way.",
         "modern": "Dawn at the end of a twelve-hour shift. You are doing a final round, charting vitals, "
                   "when the monitors on the ward all go flat at once.",
         "scifi": "You are on the medbay's dawn cycle, checking patient pods, when one of the pods "
                  "starts to rattle from the inside."},
        "extra medical supplies", {"medic": 1.8, "scholar": 0.6},
        items=(("bandage", 2), ("painkiller", 1))),
    OpeningDef(
        "watch", "Standing watch", 8,
        {"medieval": "You have the morning watch on the wall, spear grounded, a long cold stare over the "
                     "road, when you see people running toward the gate, and some of them are not running.",
         "eighties": "You are on guard duty at a roadblock with a terrible coffee and a radio nobody has "
                     "answered since four, watching headlights that stopped moving.",
         "modern": "You are on a checkpoint at a quarantine line, a second-shift boredom, when the crowd "
                   "behind the barrier turns from a queue into a surge.",
         "scifi": "You are on gate duty at the deck-nine bulkhead, scanning ID chips, when the line "
                  "of evacuees stops being a line."},
        "armed and armoured", {"soldier": 1.6, "guard": 1.6, "outlaw": 0.2},
        items=(("@armor", 1), ("@melee_good", 1)), panic=8),
    OpeningDef(
        "repair", "Fixing things", 9,
        {"medieval": "You are on the roof of the mill, nailing down thatch before the weather turns, "
                     "a hammer in your belt, when you see smoke in three places in town.",
         "eighties": "You are under the bonnet of a stalled station wagon in a quiet street, hands black "
                     "with oil, when the sirens start and the street empties.",
         "modern": "You are on a stepladder in a stranger's hallway, rewiring a ceiling light, when "
                   "your phone buzzes with a text from every number you know at once.",
         "scifi": "You are elbow-deep in a maintenance conduit, re-seating a power coupling, when the "
                  "lights flicker twice and the comms channel fills with screaming."},
        "scrap and parts to build with", {"outlaw": 1.0, "guard": 0.8},
        items=(("repair_kit", 1), ("scrap", 2), ("parts", 1))),
    OpeningDef(
        "market", "At the market", 10,
        {"medieval": "It is market day. You are haggling over the price of salt with a woman who "
                     "has not let go of her cheese, when the crowd on the far side of the square begins to scream.",
         "eighties": "Saturday morning at the shopping centre. You are queued at a register with a "
                     "basket of tinned goods, when the people near the doors stop shopping and start running.",
         "modern": "You are queuing at the corner shop for a cold drink and a sandwich, when the "
                   "crowd on the pavement outside starts to run in the same direction.",
         "scifi": "You are in the concourse at the commissary, queued for rations, when the PA "
                  "announces a 'minor disturbance' and the queue starts to break."},
        "a fatter purse", {"outlaw": 1.2, "scholar": 0.8}, coins=14, panic=5),
    OpeningDef(
        "vigil", "A funeral vigil", 14,
        {"medieval": "You are keeping vigil at your neighbour's body in the chapel, a candle in your "
                     "hands, the mourners gone to eat, when the shrouded body on the bier turns its head.",
         "eighties": "You are at a funeral: a wet afternoon, black umbrellas, a priest reading the last "
                     "words, when the mourners at the back of the crowd begin to shout.",
         "modern": "It is a funeral, a grey afternoon, a hundred people in black on a lawn, when "
                   "somebody screams and people start running from the coffin's direction.",
         "scifi": "You are at a memorial service in the chapel module, lights low, holding a candle-light "
                  "for the dead, when the airlock behind you opens unbidden."},
        "a steadier conscience, bandage cloth", {"medic": 1.0, "guard": 0.8},
        items=(("cloth", 2),), humanity=8, panic=10),
)}

DEFAULT_AFFINITY = 0.4


def get_opening(opening_id: str) -> OpeningDef:
    try:
        return OPENINGS[opening_id]
    except KeyError:
        raise KeyError(f"unknown opening {opening_id!r}; choose one of: random, {', '.join(sorted(OPENINGS))}") from None
