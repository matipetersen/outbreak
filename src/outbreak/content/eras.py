"""Era packs: *what you have*, as opposed to what hunts you.

An era supplies weapons, armour, light sources, place names, factions, the
vocabulary of the cipher you slowly learn to read, and flavour text.  Gameplay
code never mentions an era by name; it reads flags (``firearms``,
``electricity``) and ids from the pack.  Adding an era means adding data here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple

from outbreak.content.items import BASE_BY_ID, ItemDef, index, renamed

POI_KINDS = ("medical", "market", "guard", "lab", "transit", "military", "faith", "industry")
FACTION_ROLES = ("military", "enclave", "raiders", "cult", "science")
LEXICON_SLOTS = ("sickness", "cure", "dead", "place", "guard", "leader", "sample", "escape", "signal", "warning")


@dataclass(frozen=True)
class EraRules:
    """How the era *plays*, beyond what it is called: how loud the world is, how far light and darkness carry, and how
    much a plague can change in it.  Every number is a multiplier or a small offset; 1.0 / 0 means 'as before'."""
    ambient: Tuple[Tuple[str, float], ...] = (("car_alarm", 3), ("collapse", 1))   # what makes noise by itself, and how often
    ambient_rate: float = 1.0          # how often the world makes noise
    alarm_chance: float = 0.3          # chance that a building's alarm is still live when you walk in
    step_noise: float = 1.0            # your footsteps: soft ground and bare feet vs hard floors
    night_view: int = 0                # tiles added to (or taken from) your own view in the dark
    lit_visibility: float = 1.7        # how much a carried light shows you to the dead
    dead_night: float = 1.0            # how well the dead see in the dark (x the usual 0.6 penalty; 1.7 = no penalty)
    cover: float = 0.5                 # how much brush hides you (the dead's sight range is multiplied by this)
    lab: float = 1.0                   # how far a plague can mutate in a world with this much science
    feel: str = ""                     # one line for the briefing


@dataclass
class EraPack:
    id: str
    name: str
    year: str
    blurb: str
    tech: int                                  # 0 pre-industrial .. 3 future
    firearms: bool
    electricity: bool
    coin: str
    items: Dict[str, ItemDef]                  # complete catalogue for this era
    defaults: Dict[str, str]                   # role -> item id: melee, melee_good, ranged, armor, light
    terrain: Dict[str, str]                    # terrain id -> display name
    pois: Dict[str, Tuple[str, ...]]           # poi kind -> building names
    houses: Tuple[str, ...]
    factions: Dict[str, Tuple[str, str]]       # role -> (name, description)
    cipher_name: str
    glyphs: str                                # characters used for unreadable words
    lexicon: Dict[str, Tuple[str, ...]]        # slot -> learnable words
    origin_names: Dict[str, str]
    refuge: str                                # name of the safe haven
    pad: str                                   # name of the extraction point
    breach: str                                # where the story starts
    intro: str
    radio: str                                 # how rumours travel
    ammo_names: Dict[str, str] = field(default_factory=dict)
    rules: EraRules = field(default_factory=EraRules)

    def item(self, item_id: str) -> ItemDef:
        return self.items[item_id]

    def vocabulary(self) -> Tuple[str, ...]:
        seen = []
        for slot in LEXICON_SLOTS:
            for w in self.lexicon[slot]:
                if w not in seen:
                    seen.append(w)
        return tuple(seen)


def _ammo(id, name, value=1):
    return ItemDef(id, name, "ammo", f"Ammunition: {name.lower()}.", value=value, stackable=True, rarity=2)


def _make_items(overrides: Dict[str, Tuple[str, str]], extra) -> Dict[str, ItemDef]:
    items = []
    for base_id, base in BASE_BY_ID.items():
        name, desc = overrides.get(base_id, (base.name, ""))
        items.append(renamed(base, name, desc))
    items.extend(extra)
    return index(items)


def _wpn(id, name, style, dmg, noise, dur, desc="", **kw):
    return ItemDef(id, name, "weapon", desc, style=style, dmg=dmg, noise=noise, durability=dur,
                   value=kw.pop("value", sum(dmg)), **kw)


def _arm(id, name, defense, bite=0.0, stealth=0, desc="", **kw):
    return ItemDef(id, name, "armor", desc, defense=defense, bite_guard=bite, stealth=stealth,
                   durability=kw.pop("durability", 60), value=kw.pop("value", defense * 6), **kw)


def _lamp(id, name, radius, turns, desc="", **kw):
    return ItemDef(id, name, "light", desc, light=radius, durability=turns, value=kw.pop("value", radius * 2), **kw)


# --------------------------------------------------------------------------- medieval
def _medieval() -> EraPack:
    extra = [
        _wpn("club", "Cudgel", "blunt", (3, 6), 5, 28),
        _wpn("hatchet", "Hatchet", "blade", (4, 8), 4, 32),
        _wpn("dagger", "Dagger", "blade", (2, 5), 2, 42, accuracy=5, head=0.10),
        _wpn("mace", "Flanged mace", "blunt", (6, 10), 6, 55, rarity=3),
        _wpn("spear", "Boar spear", "polearm", (4, 7), 3, 34, reach=2, rarity=2),
        _wpn("sword", "Arming sword", "blade", (7, 11), 4, 75, rarity=3, head=0.05),
        _wpn("bow", "Shortbow", "bow", (4, 8), 4, 60, reach=8, ammo="arrow", rarity=2, head=0.10),
        _wpn("crossbow", "Crossbow", "bow", (8, 13), 5, 70, reach=9, ammo="arrow", accuracy=10, rarity=3, head=0.10),
        _arm("jerkin", "Padded jerkin", 1),
        _arm("leather", "Boiled leather", 2, 0.2, 1, rarity=2),
        _arm("mail", "Chain hauberk", 4, 0.5, 2, rarity=3, durability=90),
        _arm("plate", "Plate harness", 6, 0.8, 4, rarity=4, durability=120),
        _lamp("torch", "Pitch torch", 6, 150),
        _lamp("lantern", "Horn lantern", 7, 420, rarity=2),
        _ammo("arrow", "Arrows"),
    ]
    over = {
        "bandage": ("Linen bandage", ""), "splint": ("Wooden splint", ""),
        "medkit": ("Physician's satchel", "Salves, thread and a sharp needle."),
        "suppressant": ("Wormwood tincture", "Folk lore says it holds the fever back. It does not cure it."),
        "painkiller": ("Poppy draught", ""), "filter": ("Herb-soaked mask", "Plague doctors swear by it."),
        "food": ("Bread and cheese", ""), "scrap": ("Iron scrap", ""), "cloth": ("Linen rags", ""),
        "wood": ("Timber", ""), "chem": ("Alchemical salts", ""), "parts": ("Bells and cord", ""),
        "fuel": ("Pitch and oil", ""), "molotov": ("Fire pot", "A clay pot of burning pitch."),
        "noisemaker": ("Clapper bell", ""), "repair_kit": ("Whetstone and file", ""),
        "barricade_kit": ("Bars and spikes", ""),
    }
    return EraPack(
        id="medieval", name="Medieval - the Great Dying", year="1348",
        blurb="No guns, no radios. Bows, steel and fire; plague doctors and monasteries. Fight in melee or die.",
        tech=0, firearms=False, electricity=False, coin="silver pennies",
        items=_make_items(over, extra),
        defaults={"melee": "club", "melee_good": "hatchet", "ranged": "bow", "armor": "jerkin", "light": "torch"},
        terrain={"urban": "Walled town", "suburb": "Village", "farm": "Fields", "forest": "Greenwood",
                 "water": "River", "road": "King's road", "ruin": "Ruins"},
        pois={"medical": ("Hospice of St. Giles", "Leper house", "Barber-surgeon's"),
              "market": ("Market hall", "Guildhall", "Wool exchange"),
              "guard": ("Garrison tower", "Sheriff's hold", "Gatehouse"),
              "lab": ("Alchemist's tower", "Scriptorium", "Apothecary"),
              "transit": ("Catacombs", "Old mine", "Sewer vaults"),
              "military": ("Baron's keep", "Fortified manor", "Border castle"),
              "faith": ("Abbey", "Chapel of the Holy Cross", "Priory"),
              "industry": ("Smithy", "Mill", "Tannery")},
        houses=("Cottage", "Farmstead", "Hovel", "Inn"),
        factions={"military": ("The Baron's Levy", "Men-at-arms holding what they can."),
                  "enclave": ("The Abbey Folk", "Monks and villagers who took in the living."),
                  "raiders": ("The Wolfsheads", "Outlaws who prey on travellers."),
                  "cult": ("The Flagellants", "Penitents who believe the dead are God's judgement."),
                  "science": ("Order of Physicians", "Learned men searching for a remedy.")},
        cipher_name="Church Latin", glyphs="ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ",
        lexicon={
            "sickness": ("plague", "miasma", "pestilence", "fever"),
            "cure": ("remedy", "elixir", "antidote", "salve"),
            "dead": ("risen", "damned", "wretches", "revenants"),
            "place": ("cellar", "crypt", "vault", "undercroft", "strongroom"),
            "guard": ("sergeants", "men-at-arms", "watchmen", "knights"),
            "leader": ("abbot", "baron", "physician", "bishop"),
            "sample": ("relic", "blood", "tincture", "ichor"),
            "escape": ("ship", "ford", "causeway", "harbour"),
            "signal": ("beacon", "bell", "horn", "smoke"),
            "warning": ("forbidden", "sealed", "accursed", "quarantine"),
        },
        origin_names={"medic": "Barber-surgeon", "soldier": "Man-at-arms", "scholar": "Scribe",
                      "outlaw": "Poacher", "guard": "Town watchman"},
        refuge="St. Alban's Abbey", pad="the harbour at Dunmere", breach="the broken gate",
        intro="The bells have stopped ringing. Dunmere's gate fell at dawn and the dead are in the streets.",
        radio="travelling friars and carrier pigeons",
    )


# --------------------------------------------------------------------------- 1980s
def _eighties() -> EraPack:
    extra = [
        _wpn("bat", "Baseball bat", "blunt", (4, 7), 5, 35),
        _wpn("knife", "Hunting knife", "blade", (2, 5), 2, 45, accuracy=5, head=0.08),
        _wpn("axe", "Fire axe", "blade", (7, 11), 5, 45, rarity=2),
        _wpn("crowbar", "Crowbar", "blunt", (4, 8), 5, 60),
        _wpn("pistol", "Revolver", "firearm", (6, 10), 20, 90, reach=8, ammo="bullet", rarity=2, head=0.10),
        _wpn("shotgun", "Pump shotgun", "firearm", (11, 18), 24, 90, reach=5, ammo="shell", rarity=3),
        _wpn("rifle", "Hunting rifle", "firearm", (12, 18), 26, 100, reach=12, ammo="bullet", rarity=3, head=0.15),
        _wpn("bow", "Hunting bow", "bow", (4, 8), 4, 60, reach=8, ammo="arrow", rarity=3, head=0.10),
        _arm("jacket", "Denim jacket", 1),
        _arm("leather", "Biker leather", 2, 0.2, 1, rarity=2),
        _arm("football", "Football pads", 3, 0.35, 2, rarity=3),
        _arm("riot", "Riot gear", 5, 0.6, 3, rarity=4, durability=100),
        _lamp("torch", "Flashlight", 8, 260),
        _lamp("lantern", "Camp lantern", 9, 480, rarity=2),
        _ammo("bullet", "Rounds", 2), _ammo("shell", "Shotgun shells", 3), _ammo("arrow", "Arrows"),
    ]
    over = {
        "medkit": ("First-aid kit", ""), "suppressant": ("Experimental serum", "Army-issue. Slows the fever."),
        "painkiller": ("Aspirin bottle", ""), "filter": ("Gas mask filter", ""),
        "food": ("Canned food", ""), "parts": ("Radio parts", ""), "chem": ("Household chemicals", ""),
        "noisemaker": ("Alarm clock bomb", "A wind-up alarm clock with the bell wired loud."),
        "molotov": ("Molotov cocktail", ""),
    }
    return EraPack(
        id="eighties", name="1986 - the analogue apocalypse", year="1986",
        blurb="Cassette tapes, CB radios, shopping malls. Guns exist but ammunition is scarce and loud.",
        tech=1, firearms=True, electricity=True, coin="cash",
        items=_make_items(over, extra),
        defaults={"melee": "bat", "melee_good": "axe", "ranged": "pistol", "armor": "jacket", "light": "torch"},
        terrain={"urban": "Downtown", "suburb": "Suburbs", "farm": "Farmland", "forest": "Woods",
                 "water": "Creek", "road": "Highway", "ruin": "Wreckage"},
        pois={"medical": ("County hospital", "Pharmacy", "Clinic"),
              "market": ("Shopping mall", "Supermarket", "Department store"),
              "guard": ("Police station", "Sheriff's office", "Prison"),
              "lab": ("Research institute", "University lab", "Pharma plant"),
              "transit": ("Subway tunnels", "Storm drains", "Bus depot"),
              "military": ("National Guard armory", "Army depot", "Missile silo"),
              "faith": ("Church", "Funeral home", "Cathedral"),
              "industry": ("Auto plant", "Warehouse", "Power station")},
        houses=("Ranch house", "Gas station", "Diner", "Trailer"),
        factions={"military": ("National Guard remnant", "Soldiers following the last orders."),
                  "enclave": ("The Mall Survivors", "Neighbours who barricaded a shopping centre."),
                  "raiders": ("The Road Wolves", "Bikers who took what they wanted."),
                  "cult": ("Children of the Dawn", "A preacher on a short-wave radio."),
                  "science": ("Meridian Labs", "A corporation hiding what it did.")},
        cipher_name="Redacted files", glyphs="█▓▒░",
        lexicon={
            "sickness": ("contagion", "virus", "outbreak", "strain"),
            "cure": ("antidote", "vaccine", "serum", "treatment"),
            "dead": ("infected", "casualties", "subjects", "hostiles"),
            "place": ("basement", "vault", "bunker", "sublevel", "storeroom"),
            "guard": ("troopers", "guardsmen", "marshals", "agents"),
            "leader": ("director", "colonel", "sheriff", "chairman"),
            "sample": ("specimen", "culture", "blood", "isolate"),
            "escape": ("convoy", "helicopter", "airfield", "evacuation"),
            "signal": ("transmitter", "frequency", "flare", "broadcast"),
            "warning": ("classified", "quarantine", "restricted", "terminated"),
        },
        origin_names={"medic": "Paramedic", "soldier": "Guardsman", "scholar": "Grad student",
                      "outlaw": "Drifter", "guard": "Deputy"},
        refuge="Fort Halsey", pad="the Halsey airfield", breach="the collapsed roadblock",
        intro="The roadblock was overrun at first light. The radio says hold position, but there is nobody left to hold it.",
        radio="CB radio and a dying AM station",
    )


# --------------------------------------------------------------------------- modern
def _modern() -> EraPack:
    extra = [
        _wpn("bat", "Aluminium bat", "blunt", (4, 7), 5, 35),
        _wpn("knife", "Kitchen knife", "blade", (2, 5), 2, 40, accuracy=5, head=0.08),
        _wpn("machete", "Machete", "blade", (6, 10), 4, 50, rarity=2),
        _wpn("axe", "Fire axe", "blade", (7, 11), 5, 45, rarity=2),
        _wpn("pistol", "9mm pistol", "firearm", (6, 10), 20, 90, reach=8, ammo="bullet", rarity=2, head=0.12),
        _wpn("shotgun", "Shotgun", "firearm", (11, 18), 24, 90, reach=5, ammo="shell", rarity=3),
        _wpn("rifle", "Hunting rifle", "firearm", (12, 18), 26, 100, reach=12, ammo="bullet", rarity=3, head=0.15),
        _wpn("bow", "Compound bow", "bow", (5, 9), 3, 70, reach=9, ammo="arrow", rarity=3, head=0.12),
        _arm("hoodie", "Hoodie", 1),
        _arm("leather", "Motorbike jacket", 2, 0.25, 1, rarity=2),
        _arm("vest", "Kevlar vest", 3, 0.3, 1, rarity=3, durability=90),
        _arm("riot", "Riot armour", 5, 0.65, 3, rarity=4, durability=110),
        _lamp("torch", "Torch", 8, 280),
        _lamp("lantern", "LED lantern", 9, 520, rarity=2),
        _ammo("bullet", "Rounds", 2), _ammo("shell", "Shells", 3), _ammo("arrow", "Arrows"),
    ]
    over = {
        "medkit": ("First-aid kit", ""), "suppressant": ("Antiviral dose", "Experimental. Buys time, nothing more."),
        "painkiller": ("Ibuprofen", ""), "filter": ("Respirator filter", ""),
        "food": ("Tinned food", ""), "parts": ("Electronics", ""), "chem": ("Cleaning chemicals", ""),
        "noisemaker": ("Phone alarm rig", "A burner phone wired to a speaker."),
        "molotov": ("Molotov cocktail", ""),
    }
    return EraPack(
        id="modern", name="Modern day - the collapse", year="2026",
        blurb="Smartphones die with the grid. Guns are loud and ammo is the real currency. People are the other threat.",
        tech=2, firearms=True, electricity=True, coin="scrip",
        items=_make_items(over, extra),
        defaults={"melee": "bat", "melee_good": "machete", "ranged": "pistol", "armor": "hoodie", "light": "torch"},
        terrain={"urban": "City centre", "suburb": "Suburbs", "farm": "Farmland", "forest": "Woodland",
                 "water": "Canal", "road": "Road", "ruin": "Wreckage"},
        pois={"medical": ("General hospital", "Pharmacy", "Urgent care"),
              "market": ("Shopping centre", "Hypermarket", "Retail park"),
              "guard": ("Police station", "Courthouse", "Prison"),
              "lab": ("Research lab", "Biotech campus", "Pharma plant"),
              "transit": ("Metro tunnels", "Storm drains", "Rail depot"),
              "military": ("Army base", "Reserve barracks", "Naval yard"),
              "faith": ("Church", "Mosque", "Cathedral"),
              "industry": ("Factory", "Logistics hub", "Power plant")},
        houses=("Semi-detached", "Petrol station", "Cafe", "Flat"),
        factions={"military": ("Joint Task Force", "Remnants of the emergency response."),
                  "enclave": ("The Stadium Folk", "Survivors holding a football stadium."),
                  "raiders": ("The Reapers", "Gangs that moved in when the police left."),
                  "cult": ("The Reborn", "Believers who think the infected are ascended."),
                  "science": ("Helix Biotech", "A company with a cure and a lot to hide.")},
        cipher_name="Redacted files", glyphs="█▓▒░",
        lexicon={
            "sickness": ("pathogen", "virus", "outbreak", "strain"),
            "cure": ("antiviral", "vaccine", "serum", "countermeasure"),
            "dead": ("infected", "hosts", "subjects", "hostiles"),
            "place": ("basement", "vault", "bunker", "sublevel", "cold-store"),
            "guard": ("troops", "security", "marshals", "operatives"),
            "leader": ("director", "commander", "chief", "governor"),
            "sample": ("specimen", "culture", "blood", "isolate"),
            "escape": ("convoy", "helicopter", "airstrip", "evacuation"),
            "signal": ("transponder", "frequency", "flare", "broadcast"),
            "warning": ("classified", "quarantine", "restricted", "terminated"),
        },
        origin_names={"medic": "Paramedic", "soldier": "Reservist", "scholar": "Researcher",
                      "outlaw": "Courier", "guard": "Police officer"},
        refuge="Harbour Point", pad="the Millfield airstrip", breach="the failed quarantine line",
        intro="The quarantine line broke an hour ago. The phones are dead and the helicopters have stopped coming.",
        radio="a hand-cranked emergency radio",
    )


# --------------------------------------------------------------------------- sci-fi
def _scifi() -> EraPack:
    extra = [
        _wpn("blade", "Vibro-knife", "blade", (5, 9), 2, 65, accuracy=5, head=0.10, rarity=2),
        _wpn("baton", "Stun baton", "blunt", (4, 8), 3, 60),
        _wpn("cutter", "Plasma cutter", "blade", (8, 13), 3, 55, rarity=3),
        _wpn("wrench", "Mag-wrench", "blunt", (4, 7), 5, 70),
        _wpn("pistol", "Pulse pistol", "energy", (6, 10), 8, 90, reach=8, ammo="cell", rarity=2, head=0.12),
        _wpn("scatter", "Scatter-gun", "firearm", (12, 20), 22, 90, reach=5, ammo="slug", rarity=3),
        _wpn("rifle", "Arc rifle", "energy", (11, 16), 12, 100, reach=12, ammo="cell", rarity=3, head=0.15),
        _wpn("darter", "Dart launcher", "bow", (5, 9), 2, 70, reach=9, ammo="dart", rarity=3, head=0.12),
        _arm("weave", "Weave suit", 2, 0.15, 0, rarity=1),
        _arm("rig", "Plated rig", 4, 0.5, 2, rarity=3, durability=100),
        _arm("exo", "Exo-frame", 6, 0.85, 3, rarity=4, durability=140),
        _lamp("torch", "Glow-lamp", 9, 320),
        _lamp("lantern", "Helmet lamp", 10, 640, rarity=2),
        _ammo("cell", "Power cells", 2), _ammo("slug", "Slug shells", 3), _ammo("dart", "Darts"),
    ]
    over = {
        "bandage": ("Gel patch", ""), "splint": ("Bone knit", ""), "medkit": ("Auto-medic", ""),
        "suppressant": ("Nano-suppressor", "Tailored nanites slow the infection. Temporary."),
        "painkiller": ("Neuro-dampener", ""), "filter": ("Rebreather cell", ""),
        "food": ("Nutrient paste", ""), "scrap": ("Hull scrap", ""), "cloth": ("Weave fabric", ""),
        "wood": ("Structural beams", ""), "chem": ("Reagents", ""), "parts": ("Circuitry", ""),
        "fuel": ("Fuel cell", ""), "noisemaker": ("Decoy beacon", ""), "molotov": ("Thermite charge", ""),
        "repair_kit": ("Repair drone", ""), "barricade_kit": ("Bulkhead seal", ""),
    }
    return EraPack(
        id="scifi", name="Far future - the station", year="2214",
        blurb="A deep-space habitat overrun. Energy weapons, drones, failing life support. Closest to the original games.",
        tech=3, firearms=True, electricity=True, coin="credits",
        items=_make_items(over, extra),
        defaults={"melee": "wrench", "melee_good": "blade", "ranged": "pistol", "armor": "weave", "light": "torch"},
        terrain={"urban": "Hab sprawl", "suburb": "Residential ring", "farm": "Hydroponics", "forest": "Overgrown deck",
                 "water": "Coolant channel", "road": "Gantry", "ruin": "Wreckage"},
        pois={"medical": ("Med-deck", "Clinic module", "Triage bay"),
              "market": ("Commissary", "Trade concourse", "Cargo market"),
              "guard": ("Security hub", "Brig", "Marshal post"),
              "lab": ("Xeno-lab", "Genetics wing", "Research dome"),
              "transit": ("Maintenance tunnels", "Tram depot", "Vent network"),
              "military": ("Fleet garrison", "Armoury deck", "Drone hangar"),
              "faith": ("Memorial chapel", "Meditation dome", "Cryo-vault shrine"),
              "industry": ("Reactor annex", "Refinery", "Foundry deck")},
        houses=("Habitat pod", "Locker bay", "Canteen", "Quarters"),
        factions={"military": ("Fleet remnant", "Marines enforcing the last lockdown orders."),
                  "enclave": ("The Dome Colony", "Crew who sealed a hydroponics dome."),
                  "raiders": ("The Vent Rats", "Scavengers who rule the maintenance shafts."),
                  "cult": ("The Silent Choir", "Mystics who hear the infected sing."),
                  "science": ("Helix Dynamics", "The corporation that built this station and what is on it.")},
        cipher_name="Corporate cipher", glyphs="▒░▓▚▞▙▛▜",
        lexicon={
            "sickness": ("contagion", "xenovirus", "outbreak", "strain"),
            "cure": ("counteragent", "vaccine", "serum", "nanophage"),
            "dead": ("infected", "hosts", "revenants", "hostiles"),
            "place": ("sublevel", "vault", "bulkhead", "cryo-store", "bunker"),
            "guard": ("marines", "security", "drones", "wardens"),
            "leader": ("director", "captain", "admiral", "governor"),
            "sample": ("specimen", "culture", "genome", "isolate"),
            "escape": ("shuttle", "lifepod", "dropship", "evacuation"),
            "signal": ("transponder", "beacon", "broadcast", "uplink"),
            "warning": ("classified", "lockdown", "restricted", "purged"),
        },
        origin_names={"medic": "Station medic", "soldier": "Marine", "scholar": "Xeno-researcher",
                      "outlaw": "Smuggler", "guard": "Security warden"},
        refuge="Dome Eleven", pad="Docking Ring C", breach="the failed lockdown door",
        intro="Lockdown failed on deck nine. The corridors are dark and the intercom keeps repeating a message nobody can finish.",
        radio="the station intercom and short-range comms",
    )


ERA_RULES: Dict[str, EraRules] = {
    "medieval": EraRules(
        ambient=(("bell", 3), ("livestock", 2), ("collapse", 2)), ambient_rate=0.8, alarm_chance=0.0, step_noise=0.8,
        night_view=-1, lit_visibility=2.2, dead_night=1.0, cover=0.45, lab=0.3,
        feel="A quiet world: no engines, no alarms, soft ground. The nights are truly dark, and a torch shows you to everything."),
    "eighties": EraRules(
        ambient=(("car_alarm", 3), ("siren", 2), ("collapse", 1)), ambient_rate=1.0, alarm_chance=0.2, step_noise=1.0,
        night_view=0, lit_visibility=1.8, dead_night=1.0, cover=0.5, lab=0.7,
        feel="Engines, burglar bells and sirens. Dark nights, and a good torch is a beacon."),
    "modern": EraRules(
        ambient=(("car_alarm", 4), ("phone", 2), ("helicopter", 1), ("collapse", 1)), ambient_rate=1.2, alarm_chance=0.3,
        step_noise=1.1, night_view=1, lit_visibility=1.7, dead_night=1.0, cover=0.5, lab=1.0,
        feel="A loud world: alarms, phones, helicopters, hard floors that ring. Streetlights and screens give you a little more night view."),
    "scifi": EraRules(
        ambient=(("klaxon", 3), ("drone", 3), ("surge", 2)), ambient_rate=1.3, alarm_chance=0.45, step_noise=1.15,
        night_view=2, lit_visibility=1.3, dead_night=1.5, cover=0.65, lab=1.4,
        feel="A watched world: klaxons, patrol drones and power surges. Your visor sees in the dark, but the dead sense heat and brush hides you less."),
}
ERAS: Dict[str, EraPack] = {}


def _register() -> None:
    for build in (_medieval, _eighties, _modern, _scifi):
        era = build()
        era.rules = ERA_RULES[era.id]
        _validate(era)
        ERAS[era.id] = era


def _validate(era: EraPack) -> None:
    """Fail loudly at import time if a pack is internally inconsistent."""
    for role, item_id in era.defaults.items():
        if item_id not in era.items:
            raise ValueError(f"{era.id}: default {role} -> unknown item {item_id!r}")
    for it in era.items.values():
        if it.ammo and it.ammo not in era.items:
            raise ValueError(f"{era.id}: {it.id} needs unknown ammo {it.ammo!r}")
    for kind in POI_KINDS:
        if not era.pois.get(kind):
            raise ValueError(f"{era.id}: no building names for POI kind {kind!r}")
    for role in FACTION_ROLES:
        if role not in era.factions:
            raise ValueError(f"{era.id}: missing faction {role!r}")
    for slot in LEXICON_SLOTS:
        if len(era.lexicon.get(slot, ())) < 3:
            raise ValueError(f"{era.id}: lexicon slot {slot!r} too small")


_register()
