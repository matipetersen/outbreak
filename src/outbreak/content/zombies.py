"""Zombie model: a preset is a bundle of parameters, not a hard-coded class.

A :class:`ZombieProfile` describes *how the dead behave* (speed, senses, how the
infection spreads, how you kill them, how they change over the days).  Special
infected are era-neutral :class:`SpecialDef` records; each preset picks which
ones appear, how often, and what they are called.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple


@dataclass(frozen=True)
class SpecialDef:
    id: str
    name: str
    glyph: str
    hp: int
    dmg: Tuple[int, int]
    acc: int = 55
    speed: float = 1.0        # multiplier on the preset's base speed
    sight: float = 1.0        # multiplier on the preset's sight range
    hearing: float = 1.0
    xp: int = 5
    flags: Tuple[str, ...] = ()


SPECIALS: Dict[str, SpecialDef] = {s.id: s for s in (
    SpecialDef("walker", "Walker", "z", 12, (3, 6), 55, xp=5),
    SpecialDef("crawler", "Crawler", "c", 8, (2, 4), 60, speed=0.6, sight=0.6, xp=6, flags=("crawls", "cripples")),
    SpecialDef("brute", "Brute", "B", 42, (6, 12), 50, speed=0.8, xp=25, flags=("breaker", "tough")),
    SpecialDef("bloater", "Bloater", "b", 22, (3, 6), 50, speed=0.6, xp=16, flags=("explodes",)),
    SpecialDef("screamer", "Screamer", "s", 10, (1, 3), 55, xp=15, flags=("screams",)),
    SpecialDef("leaper", "Leaper", "l", 16, (4, 8), 60, speed=1.1, xp=18, flags=("leaps",)),
    SpecialDef("clicker", "Clicker", "k", 26, (10, 18), 65, speed=0.9, sight=0.0, hearing=1.8, xp=22,
               flags=("blind", "tough")),
    SpecialDef("stalker", "Stalker", "N", 120, (8, 14), 70, speed=1.0, sight=1.2, hearing=1.2, xp=150,
               flags=("relentless", "tough", "breaker", "boss")),
    SpecialDef("alpha", "Alpha", "A", 170, (10, 18), 72, speed=1.0, sight=1.2, hearing=1.2, xp=250,
               flags=("tough", "breaker", "boss", "screams")),
)}


@dataclass(frozen=True)
class Phase:
    """How the outbreak changes as the days pass (applies from ``from_day``)."""
    from_day: int
    name: str
    hp: float = 1.0
    speed: float = 1.0
    spawn: float = 1.0       # multiplier on wandering spawns and horde size
    special: float = 1.0     # multiplier on special-infected weights
    blurb: str = ""


@dataclass(frozen=True)
class ZombieProfile:
    id: str
    name: str
    blurb: str
    inspired_by: str
    speed: float                      # base moves per world tick (player = 1.0)
    sight: int                        # tiles, in daylight
    hearing: float = 1.0              # multiplier on noise radius
    smell: int = 0                    # tiles of scent trail they can follow (0 = none)
    vector: str = "bite"              # bite | spore | parasite | psychic
    infect: float = 0.45              # chance that a hit transmits the infection
    incubation: int = 360             # turns from infection to turning
    intel: int = 0                    # 0 mindless, 1 opens doors and avoids fire, 2 flanks and calls the pack
    decay: float = 0.0                # fraction of hp lost per day of age
    kill_rule: str = "head"           # head: body shots barely hurt | any
    turn_on_death: bool = False       # human corpses rise on their own
    density: float = 1.0
    horde_size: Tuple[int, int] = (6, 12)
    swarm: bool = False               # fences do not stop them; doors fall fast
    night_speed: float = 1.0
    night_sight: float = 1.0
    day_speed: float = 1.0
    sun_burn: bool = False            # take damage outdoors by day and shelter indoors
    weakness: str = ""                # fire | light: extra damage
    dormant_after: int = 0            # turns without stimulus before they go still (0 = never)
    disguise: float = 0.7             # chance a gore smear fools a mindless zombie
    stalker_heat: int = 100           # noise level at which the Stalker arrives
    human_threat: float = 1.0         # multiplier on raider/human events
    hp_mult: float = 1.0
    mutates: float = 0.0              # how readily the strain changes over the days (x the era's lab: see engine/mutation.py)
    specials: Tuple[Tuple[str, float, int], ...] = ()     # (special id, weight, first day)
    phases: Tuple[Phase, ...] = ()
    names: Dict[str, str] = field(default_factory=dict)   # special id -> display name
    lore: str = ""                    # what people believe is happening (shown in the opening briefing)

    def phase(self, day: int) -> Phase:
        current = Phase(1, "Outbreak")
        for ph in self.phases:
            if day >= ph.from_day:
                current = ph
        return current

    def name_of(self, special_id: str) -> str:
        return self.names.get(special_id) or SPECIALS[special_id].name


PRESETS: Dict[str, ZombieProfile] = {p.id: p for p in (
    ZombieProfile(
        id="classic", name="Classic - the slow dead", mutates=0.1,
        blurb="Slow, relentless, drawn to noise. Only a destroyed brain stops them. Whoever dies, rises.",
        inspired_by="Romero's Dead films",
        speed=0.55, sight=6, hearing=1.0, infect=0.28, incubation=360, kill_rule="head",
        turn_on_death=True, density=1.0, horde_size=(8, 16),
        specials=(("crawler", 3, 1), ("brute", 1, 3), ("bloater", 1, 5)),
        phases=(Phase(1, "The Fall", spawn=1.4, blurb="Streets are still full of the newly dead."),
                Phase(3, "The Long Dead", blurb="The hordes thin out, the stragglers do not.")),
        names={"walker": "Shambler"},
        lore="Nobody knows why. The dead simply got up, slowly, hungrily, and they do not stop. Whoever dies rises again, so every body matters. Only a destroyed brain ends one.",
    ),
    ZombieProfile(
        id="rot", name="Slow rot - the long apocalypse", mutates=0.2,
        blurb="Slow, they track your scent, and they rot over the weeks. People are the real danger.",
        inspired_by="The Walking Dead",
        speed=0.6, sight=6, hearing=1.1, smell=4, infect=0.25, incubation=480, kill_rule="head",
        turn_on_death=True, density=1.2, horde_size=(8, 18), decay=0.04, disguise=1.0, human_threat=1.5,
        specials=(("crawler", 4, 1), ("brute", 1, 5)),
        phases=(Phase(1, "Fresh dead"),
                Phase(4, "Rotting", hp=0.8, blurb="Flesh is giving way."),
                Phase(8, "Husks", hp=0.6, speed=0.85, blurb="Barely holding together, but still coming.")),
        names={"walker": "Walker"},
        lore="They walk, and they smell the living from far off. They rot as the weeks pass, but the weeks are long, and the living are the worse danger now: everyone left is hungry and armed.",
    ),
    ZombieProfile(
        id="rage", name="Rage - fast and furious", mutates=0.35,
        blurb="Sprinters. Infection is almost instant. They starve in a few weeks: can you outlast them?",
        inspired_by="28 Days Later",
        speed=1.7, sight=9, hearing=1.3, infect=0.18, incubation=55, kill_rule="any", density=0.8,
        horde_size=(5, 10), hp_mult=0.85,
        specials=(("crawler", 1, 1),),
        phases=(Phase(1, "Outbreak", spawn=1.6),
                Phase(4, "Starvation", hp=0.7, speed=0.9, spawn=0.8, blurb="They are wasting away."),
                Phase(8, "Burnout", hp=0.45, speed=0.7, spawn=0.4, blurb="Most of them have collapsed.")),
        names={"walker": "Infected"},
        lore="It is not the dead. It is the living, infected, and mad with rage. They run, they scream, and within a minute of a bite you are one of them. The rumour is they will starve in a few weeks, if you can last.",
    ),
    ZombieProfile(
        id="spore", name="Spore bloom - the fungal plague", mutates=0.6,
        blurb="Fungus takes the host. Spore clouds in closed places infect you: filters matter. Blind brutes hunt by sound.",
        inspired_by="The Last of Us",
        speed=0.85, sight=5, hearing=1.3, vector="spore", infect=0.2, incubation=300, kill_rule="any",
        density=1.0, horde_size=(5, 10), hp_mult=1.2,
        specials=(("clicker", 4, 1), ("bloater", 2, 2), ("crawler", 2, 1)),
        phases=(Phase(1, "Early bloom"), Phase(5, "Deep bloom", special=1.5, blurb="The fungus matures.")),
        names={"walker": "Runner", "crawler": "Stalker spawn"},
        lore="A fungus has taken the dead. Where it grows in closed rooms the air itself is poison, and the blind ones hunt by sound. Filters matter. Silence matters more.",
    ),
    ZombieProfile(
        id="bio", name="Biohazard - the engineered plague", mutates=1.0,
        blurb="A weaponised pathogen. The longer it spreads the worse the mutations get, and something hunts you.",
        inspired_by="Resident Evil",
        speed=0.7, sight=7, hearing=1.0, infect=0.3, incubation=300, kill_rule="head", density=1.0,
        horde_size=(6, 12), stalker_heat=75,
        specials=(("crawler", 2, 1), ("brute", 2, 2), ("leaper", 3, 2), ("bloater", 1, 3)),
        phases=(Phase(1, "Containment breach"),
                Phase(4, "Mutation", special=1.6, blurb="The strain is changing."),
                Phase(8, "Cascade", special=2.4, hp=1.15, blurb="Everything is mutating.")),
        names={"walker": "Infected", "brute": "Tyrant spawn", "leaper": "Hunter"},
        lore="It was made, not found. A weaponised pathogen escaped containment and it is still changing. The longer it spreads the worse the things it makes, and something has started to hunt survivors by name.",
    ),
    ZombieProfile(
        id="swarm", name="Swarm - the tide", mutates=0.3,
        blurb="Frail but fast, and there are always more. They pile over fences and doors. Go quiet or die.",
        inspired_by="World War Z",
        speed=1.3, sight=8, hearing=1.5, infect=0.22, incubation=60, kill_rule="any", density=1.1,
        horde_size=(18, 34), swarm=True, dormant_after=45, hp_mult=0.7,
        specials=(("brute", 1, 4),),
        phases=(Phase(1, "The tide"),),
        names={"walker": "Swarmer"},
        lore="They come in tides. Frail, fast, and endless, they climb fences and pile over doors. Alone, they are nothing; together, they are the end of cities. Go quiet or die.",
    ),
    ZombieProfile(
        id="night", name="Nightstalkers - the vampiric dead", mutates=0.1,
        blurb="Clever, hunt in packs, burn in sunlight. Safe by day outdoors; deadly by night and inside buildings.",
        inspired_by="I Am Legend",
        speed=0.5, sight=8, hearing=1.0, smell=6, infect=0.3, incubation=200, intel=2, kill_rule="any",
        density=1.0, horde_size=(5, 9), night_speed=3.2, night_sight=1.5, sun_burn=True, weakness="light",
        disguise=0.2, hp_mult=1.1,
        specials=(("leaper", 3, 1), ("brute", 1, 4), ("screamer", 1, 2)),
        phases=(Phase(1, "Dusk of man"),),
        names={"walker": "Nightstalker", "brute": "Elder", "screamer": "Caller"},
        lore="The sun keeps them down. Anything out in the light burns, so the world belongs to the living by day and to something clever and hungry after dark. Be inside, with the door shut, before dusk.",
    ),
)}
