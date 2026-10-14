"""Plain data model: items, actors, levels.  No game rules live here."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from outbreak.engine import tiles as T
from outbreak.util import Pos


@dataclass
class Item:
    id: str
    qty: int = 1
    dur: Optional[int] = None        # remaining durability / fuel / charge
    key: bool = False                # quest item: takes no pack space and is never lost to a full pack


@dataclass
class Container:
    loot: List[Item] = field(default_factory=list)
    docs: List[str] = field(default_factory=list)     # document ids inside
    coins: int = 0
    opened: bool = False
    note: str = ""                   # "vault" marks the container holding a quest component


@dataclass
class Portal:
    target: str                      # level id
    pos: Pos                         # arrival position; (-1, -1) = use the target's named arrival
    label: str = ""
    arrive: str = "entry"            # entry | from_above | from_below


@dataclass
class Hazard:
    kind: str                        # fire | spore | spikes
    ttl: int
    power: int = 0                   # spikes / snare: the damage the first victim takes
    hidden: bool = False             # a snare nobody has spotted yet


@dataclass
class POI:
    id: str
    kind: str                        # one of eras.POI_KINDS, or camp/refuge/pad/breach/house
    name: str
    x: int
    y: int
    box: Tuple[int, int, int, int] = (0, 0, 0, 0)    # footprint on the overworld: x, y, w, h
    floors: int = 1
    danger: float = 1.0
    revealed: bool = False           # you know the building exists (seen, or marked on the map)
    lead: bool = False               # you know it holds something you need (document, tip-off)
    visited: bool = False
    component: str = ""              # requirement item id hidden in the vault
    docs: List[str] = field(default_factory=list)     # document ids placed inside
    code_known: bool = False         # the vault code has been deciphered
    done: bool = False
    papers: bool = False             # an archivist told you written pages were left here

    @property
    def pos(self) -> Pos:
        return (self.x, self.y)

    @property
    def level_id(self) -> str:
        return f"{self.id}:0"


@dataclass(eq=False)
class Actor:
    is_player = False                # class attribute, not a dataclass field
    uid: int
    name: str
    glyph: str
    x: int
    y: int
    hp: int
    max_hp: int
    level_id: str = "world"
    lvl: int = 1                     # enemy level (living-world mode); the player uses ``Player.level``
    lvl_xp: int = 0
    title: str = ""                  # earned name, e.g. "Killer of Paramedic #1"
    stun: int = 0                    # turns it loses to a shove or a blow

    @property
    def pos(self) -> Pos:
        return (self.x, self.y)

    @property
    def alive(self) -> bool:
        return self.hp > 0


@dataclass(eq=False)
class Animal(Actor):
    """Game: it grazes, bolts when it notices you, and is worth hunting for its meat.  A boar fights back."""
    species: str = "rabbit"
    state: str = "graze"             # graze | flee | charge
    alert: bool = False              # has noticed you (a creeping hunter can still stab it unaware)
    # a stray that might take to you, or a pet that has (engine/pets.py)
    stray: bool = False
    pet: bool = False
    bond: int = 0
    fed: int = 0                     # the turn it last ate
    dmg: Tuple[int, int] = (0, 0)
    acc: int = 50
    kills: int = 0
    nextfx: int = 0
    lasttalk: int = -999
    since: int = 0


@dataclass(eq=False)
class Zombie(Actor):
    special: str = "walker"
    dmg: Tuple[int, int] = (3, 6)
    acc: int = 55
    speed: float = 1.0
    sight: float = 6.0
    hearing: float = 1.0
    xp: int = 5
    flags: Tuple[str, ...] = ()
    energy: float = 0.0
    state: str = "idle"              # idle | investigate | hunt | dormant
    target: Optional[Pos] = None
    stimulus_turn: int = 0
    birth_day: int = 1
    cooldown: int = 0
    horde: int = 0                   # horde id (0 = none)
    carries: List[Item] = field(default_factory=list)
    fresh_human: bool = False        # was a person: reanimated corpse
    alert: float = 0.0               # awareness of the player while it has not noticed them: it hunts at 100
    facing: Tuple[int, int] = (1, 0) # the way it looks


@dataclass(eq=False)
class Human(Actor):
    role: str = "survivor"           # raider | scout | soldier | trader | healer | scholar | survivor
    faction: str = ""
    hostile: bool = False
    dmg: Tuple[int, int] = (3, 7)
    acc: int = 55
    reach: int = 1
    energy: float = 0.0
    state: str = "idle"
    target: Optional[Pos] = None
    loot: List[Item] = field(default_factory=list)
    talked: bool = False
    group: int = 0                   # patrol group id (0 = none)
    stuck: int = 0
    # raider tactics
    squad: int = 0                   # camp the raider belongs to (0 = none): they act together
    flank: int = 0                   # -1 / +1: which side it works round to; 0: comes straight on
    mag: int = 0                     # shots per magazine (0 = melee only)
    ammo: int = 0
    reload: int = 0                  # turns left reloading
    morale: int = 100                # falls as its friends die; it runs when it breaks
    hidden: bool = False             # lying in wait: not seen, not targeted, until it springs
    # soldiers
    corrupt: bool = False            # can be bought, and pockets what it confiscates
    cp: int = 0                      # checkpoint it guards (0 = none)
    post: Optional[Pos] = None
    # a companion's profile (engine/companion.py); empty for everyone who is not, or never was, someone you travel with
    trait: str = ""                  # archetype id
    bond: int = 0
    since: int = 0
    kills: int = 0
    story: int = 0                   # parts of their story they have told you
    nextsay: int = 0
    nextfx: int = 0
    nextfx2: int = 0
    nextwarn: int = 0
    lasttalk: int = -999
    nextfight: int = 0
    nextcall: int = 0
    sneaking: bool = False           # a companion creeps when you creep, runs when you run
    sprinting: bool = False
    lastfought: int = -99
    order: str = ""                  # a standing command from the player (engage, fallback, escape, ranged, guard)
    order_until: int = 0
    gear_weapon: Optional[Item] = None   # what you have handed them to fight with...
    gear_armor: Optional[Item] = None    # ...to wear...
    gear_ammo: int = 0                   # ...and to shoot (a ranged weapon needs it)
    bdmg: Tuple[int, int] = (0, 0)       # their own stats before gear (captured the first time they are fitted)
    bacc: int = 0
    breach: int = 0
    chats: int = 0                    # how many times you have spoken (to anyone who is not your companion)
    asked: int = 0                    # bio lines you have heard
    heard: int = 0                    # news items you have heard
    quest: int = 0                   # their personal errand: 0 none, 1 asked, 2 found, 3 done
    tamed: bool = False              # they have overcome their flaw


class Level:
    """A rectangular map with everything standing on it."""

    def __init__(self, level_id: str, name: str, w: int, h: int, kind: str = "interior", fill: int = T.WALL):
        self.id = level_id
        self.name = name
        self.w, self.h = w, h
        self.kind = kind                         # overworld | interior | haven
        self.tiles: List[bytearray] = [bytearray([fill]) * w for _ in range(h)]
        self.seen: List[bytearray] = [bytearray(w) for _ in range(h)]
        self.actors: List[Actor] = []
        self.occ: Dict[Pos, Actor] = {}
        self.items: Dict[Pos, List[Item]] = {}
        self.containers: Dict[Pos, Container] = {}
        self.portals: Dict[Pos, Portal] = {}
        self.corpses: Dict[Pos, Tuple[int, int]] = {}      # pos -> (turn of death, 0/False | True human | 2 killed by the dead: always rises)
        self.hazards: Dict[Pos, Hazard] = {}
        self.door_hp: Dict[Pos, int] = {}
        self.built: Dict[Pos, str] = {}                     # things the player built here: pos -> structure id
        self.stash: List[Item] = []                         # what is in the player's locker
        self.docs: Dict[Pos, List[str]] = {}                # document ids lying on the floor
        self.entry: Pos = (1, 1)
        self.arrivals: Dict[str, Pos] = {}
        self.vault_lock: Optional[Pos] = None     # the locked door guarding the vault, if any
        self.bench: Optional[Pos] = None          # the synthesis bench / beacon console in a haven
        self.dark = kind != "overworld"
        self.safe = False
        self.poi_id = ""

    # ----------------------------------------------------------------- terrain
    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def tile(self, x: int, y: int) -> int:
        return self.tiles[y][x] if 0 <= x < self.w and 0 <= y < self.h else T.WALL

    def set_tile(self, x: int, y: int, t: int) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.tiles[y][x] = t

    def walkable(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h and T.WALK[self.tiles[y][x]]

    def opaque(self, x: int, y: int) -> bool:
        return not (0 <= x < self.w and 0 <= y < self.h) or T.OPAQUE[self.tiles[y][x]]

    def free(self, x: int, y: int) -> bool:
        """Walkable and nobody standing there."""
        return self.walkable(x, y) and (x, y) not in self.occ

    # ----------------------------------------------------------------- actors
    def add_actor(self, a: Actor) -> None:
        a.level_id = self.id
        self.actors.append(a)
        self.occ[a.pos] = a

    def remove_actor(self, a: Actor) -> None:
        if a in self.actors:
            self.actors.remove(a)
        if self.occ.get(a.pos) is a:
            del self.occ[a.pos]

    def move_actor(self, a: Actor, x: int, y: int) -> None:
        if self.occ.get(a.pos) is a:
            del self.occ[a.pos]
        dx, dy = x - a.x, y - a.y
        if (dx or dy) and hasattr(a, "facing"):
            a.facing = ((dx > 0) - (dx < 0), (dy > 0) - (dy < 0))
        a.x, a.y = x, y
        self.occ[a.pos] = a

    def actor_at(self, x: int, y: int) -> Optional[Actor]:
        return self.occ.get((x, y))

    # ----------------------------------------------------------------- items
    def drop(self, pos: Pos, item: Item) -> None:
        stack = self.items.setdefault(pos, [])
        proto = next((i for i in stack if i.id == item.id and i.dur == item.dur), None)
        if proto is not None and item.dur is None:
            proto.qty += item.qty
        else:
            stack.append(item)

    def free_spot_near(self, x: int, y: int, radius: int = 4, avoid: Optional[Set[Pos]] = None) -> Optional[Pos]:
        for r in range(0, radius + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    p = (x + dx, y + dy)
                    if self.free(*p) and (not avoid or p not in avoid) and self.tile(*p) not in (
                            T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN):
                        return p
        return None
