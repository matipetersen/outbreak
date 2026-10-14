"""Scenarios: what you are trying to achieve and what presses on you."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class Requirement:
    id: str                        # item id (registered per game)
    poi_kind: str                  # kind of building that hides it
    names: Dict[str, str]          # era id -> item name
    desc: str


@dataclass(frozen=True)
class ScenarioDef:
    id: str
    name: str
    blurb: str
    start_infected: bool           # you begin the game bitten
    timer_turns: int               # infection timer when start_infected (normal difficulty)
    deadline_days: int             # the way out closes after this day at the earliest (0 = never); long routes get longer
    requirements: Tuple[Requirement, ...]
    final_site: str                # 'refuge' or 'pad'
    final_turns: int               # how long you must hold out at the final site
    needs_formula: bool            # a deciphered formula is required to finish
    formula_fluency: float
    goal: str                      # one-line objective shown in the HUD
    final_verb: str                # what you do at the final site
    premise_living: str = ""       # the same, when the world goes on after you
    premise: str = ""              # story page shown after the opening scene (may use {refuge}/{pad}/{radio}/{days})
    incidents: int = 0             # scripted road incidents between the start and the final site
    escalates: bool = False        # the world gets worse every day, without limit (stronger dead, bigger hordes)


CURE = ScenarioDef(
    id="cure", name="Cure - a race against your own blood",
    blurb="You are bitten but the strain in you is slow. Find three components, decipher the formula, and "
          "synthesise a cure at the refuge before you turn.",
    start_infected=True, timer_turns=1900, deadline_days=0,
    requirements=(
        Requirement("sample", "medical", {
            "medieval": "Vial of survivor's blood", "eighties": "Immune donor sample",
            "modern": "Immune donor sample", "scifi": "Immune donor genome"},
            "Blood from someone who did not turn."),
        Requirement("catalyst", "lab", {
            "medieval": "Alchemist's catalyst", "eighties": "Viral catalyst",
            "modern": "Viral catalyst", "scifi": "Phage catalyst"},
            "The compound that makes the formula work."),
        Requirement("stabilizer", "military", {
            "medieval": "Sealed holy oil", "eighties": "Cold-chain stabiliser",
            "modern": "Cold-chain stabiliser", "scifi": "Cryo-stabiliser"},
            "Keeps the finished cure from breaking down."),
    ),
    final_site="refuge", final_turns=40, needs_formula=True, formula_fluency=0.30,
    goal="Gather the components and the formula, then synthesise the cure at the refuge.",
    final_verb="synthesise",
    premise_living="Nobody is bitten yet, but everyone will be. {refuge} still stands, and someone there once made a cure. "
                   "It needs three things and a formula nobody can read. You are one of many who will try. If you fall, "
                   "another survivor walks out of the refuge behind you, and whatever put you down will remember it. "
                   "The world does not wait.",
    premise="In the crush at the gate something got you. The wound is clean and shallow, but you can feel it: "
            "the strain in you is slow, not gentle. A few days, no more. They say {refuge} still stands, and that "
            "someone there once made a cure. They need three things, and a formula that nobody has been able to read. "
            "You have what you are carrying, and the rest of the world to search.",
)

EXTRACTION = ScenarioDef(
    id="extraction", name="Extraction - get out before the way closes",
    blurb="A single evacuation point remains. Collect what it needs, reach it, and hold out until the pickup. "
          "The window closes on day 10.",
    start_infected=False, timer_turns=0, deadline_days=10,
    requirements=(
        Requirement("core", "industry", {
            "medieval": "Bolts of sailcloth", "eighties": "Aviation fuel canister",
            "modern": "Aviation fuel canister", "scifi": "Fusion core"},
            "Power for the way out."),
        Requirement("radio", "military", {
            "medieval": "Signal horn", "eighties": "Field transmitter",
            "modern": "Satellite radio", "scifi": "Comms array"},
            "Needed to call the pickup."),
        Requirement("pass", "guard", {
            "medieval": "Harbourmaster's seal", "eighties": "Clearance papers",
            "modern": "Evacuation clearance codes", "scifi": "Dock clearance chip"},
            "Without it they will not let you board."),
    ),
    final_site="pad", final_turns=45, needs_formula=False, formula_fluency=0.0,
    goal="Gather the three parts and reach the extraction point before the deadline.",
    final_verb="call the pickup",
    incidents=3,
    premise_living="One way out is left: {pad}, by way of {radio}. A pickup comes once, for anyone who can bring it power, "
                   "a signal and the right papers, and not after day {days}. You are one of many who will try. If you fall, "
                   "another survivor walks out of {refuge} behind you, and the world goes on without you.",
    premise="You are not hurt, and that is the only luck you have. The word on {radio} is that one way out is left: "
            "{pad}. A pickup will come once, for anyone who can bring it power, a signal and the right papers, "
            "and it will not come after day {days}. You have to find all three, and you have to get there.",
)

DASH = ScenarioDef(
    id="dash", name="Dash - run for the way out",
    blurb="No parts to find. The last evacuation leaves from one place, a long way off, and the road to it is not empty. "
          "Get there before it closes and hold out until the pickup.",
    start_infected=False, timer_turns=0, deadline_days=8,
    requirements=(),
    final_site="pad", final_turns=60, needs_formula=False, formula_fluency=0.0,
    goal="Reach the extraction point before the way closes, and hold out.",
    final_verb="call the pickup",
    incidents=5,
    premise_living="One way out is left: {pad}, by way of {radio}. The pickup comes once, and not after day {days}. "
                   "Nothing to collect, only the road: it is long, and it is not empty. You are one of many who will try. "
                   "If you fall, another survivor walks out of {refuge} behind you.",
    premise="You are not hurt, and the word on {radio} is that one way out is left: {pad}. The pickup comes once and "
            "will not wait past day {days}. There is nothing to gather and nobody to ask. There is only the road, and "
            "whatever is on it.",
)

ENDLESS = ScenarioDef(
    id="endless", name="Endless - survive, or end it",
    blurb="No way out and no clock. Live as long as you can while the dead grow bolder every day. Somewhere out "
          "there are still three components and a formula: make the cure and it ends. Or never do.",
    start_infected=False, timer_turns=0, deadline_days=0,
    requirements=CURE.requirements,
    final_site="refuge", final_turns=40, needs_formula=True, formula_fluency=0.30,
    goal="Survive as long as you can, or gather the components and the formula and make the cure.",
    final_verb="synthesise", escalates=True,
    premise_living="There is no way out and nobody coming. {refuge} still stands, and someone there once made a cure: "
                   "three components and a formula nobody can read. Until then there is only the next day, and it will be "
                   "worse than this one. If you fall, another survivor walks out of the refuge behind you.",
    premise="Nobody is coming, and nowhere is safe for long. {refuge} still stands, and someone there once made a cure: "
            "three components and a formula nobody can read. You can chase it, or you can simply live, one more day, "
            "and then one more. Every day the dead are a little bolder and the world a little emptier.",
)

SCENARIOS: Dict[str, ScenarioDef] = {s.id: s for s in (CURE, EXTRACTION, DASH, ENDLESS)}
