"""The running game: state, the world tick, and every action the player can take.

The UI never touches the engine's internals; it calls the public methods here
(``move``, ``fire``, ``use`` ...) and reads state back.  Everything is driven by
a seeded ``random.Random`` so a run is reproducible from its seed and inputs.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from outbreak.config import GameConfig
from outbreak.content.items import ItemDef
from outbreak.engine import (ai, ambience, base, companion, director, memory, pets, military, objective, wild, mutation, raiders, cipher, combat, encounters, ending, hordes, interiors, inventory_ops, lives, loot, services,
                             setup)
from outbreak.engine import tiles as T
from outbreak.engine.fov import visible_tiles
from outbreak.engine.model import POI, Animal, Human, Item, Level, Zombie
from outbreak.engine.pathing import distance_field
from outbreak.engine.spawn import make_raider, spawn_zombie
from outbreak.engine.worldgen import UNSET
from outbreak.util import DIRS8, Pos, cheb, compass, dist_words

WALK_DRAIN, SNEAK_DRAIN, SPRINT_DRAIN, TIRED_BELOW = 1.5, 0.7, 3.0, 20
LOG_LIMIT = 600
CHRONICLE_TAGS = ("good", "lore")
STORY_TAGS = ("obj", "ally", "lore", "dir")          # what the default log shows: where you are going and who is with you
CHRONICLE_LIMIT, CHRONICLE_KEEP = 160, 25   # when full, drop the entry at index KEEP (head and tail survive)
SCENT_KEEP = 60
FORCE_TURNS = 6


@dataclass
class FinalStand:
    turns_left: int
    next_wave: int = 4
    boss_done: bool = False
    total: int = 0
    doors: List[Pos] = field(default_factory=list)          # the side doors a wave can batter down
    pending: Dict[Pos, int] = field(default_factory=dict)   # zombies waiting behind a door that still stands
    exit: Optional[Pos] = None                              # once the clock runs out: the one way out, drawn at random
    exit_name: str = ""


class Game:
    def __init__(self, cfg: GameConfig):
        drawn = cfg.random_fields()
        self.cfg = cfg.resolve().validate()
        self._uid = 0
        self.log: List[Tuple[int, str, str]] = []
        self.chronicle: List[Tuple[int, int, str]] = []      # (turn, day, text): what the end screen retells
        self.over: Optional[ending.Ending] = None
        self.pending_event: Optional[encounters.ActiveEvent] = None
        self.recent_events: Dict[str, int] = {}
        self.hordes: List[hordes.Horde] = []
        self.ring: Optional[hordes.Ring] = None
        self.heat = 0.0
        self.stalker: Optional[Zombie] = None
        self.stalker_ready = 0
        self.last_moan = -999
        self.patrol_goals: Dict[int, Pos] = {}
        self.deadline_days = 0                   # the way out closes after this day (set from the route)
        self.lost_turns = 0                      # time the road incidents cost: counts against the deadline
        self.incidents: List[dict] = []          # scripted road incidents: {x, y, event, done}
        self.regions: List = []                  # districts, each with its own run of mutations (mutation.py)
        self.region_id = -1
        self.weather = "clear"                    # clear | rain | fog | storm (ambience.py)
        self.sources: List[dict] = []            # noises that keep sounding: car alarms, building alarms
        self.alarmed: Set[str] = set()           # buildings whose alarm has already had its chance
        self.last_step_note = -999
        self.marks: List = []                    # places that remember what happened there (engine/memory.py)
        self.nemeses: List = []
        self.pet_uid = 0                         # the animal that travels with you (engine/pets.py)
        self.companion_uid = 0                   # the one person who travels with you (engine/companion.py)
        self.fallen_allies: List[Tuple[str, str]] = []
        self.story: List[Tuple[int, str, str]] = []          # the log that matters: objectives, companions, key events
        self.objective_seen: Dict[str, bool] = {}
        self.foraged: Dict[Pos, int] = {}        # where you gathered wild food, and when
        self.pings: List[dict] = []              # recent noises the UI draws as rings: {pos, radius, turn, kind, level}
        self.flash_turn = -999                   # lightning
        self.base_id: Optional[str] = None       # the level you claimed as your base
        self.raid_next = 0                       # earliest turn of the next raid on it
        self.generation = 1                      # which survivor you are (living-world mode)
        self.current_origin = cfg.origin
        self.fallen: List[dict] = []             # records of the survivors who died
        self.fallen_bodies: Dict[Tuple[str, Pos], dict] = {}
        self.killer = None                       # whatever dealt the last damage to the player
        self.death_notice = ""                   # text the UI shows once after a death
        self.distress: Dict[int, int] = {}       # patrol group -> turn it last called for help
        self.aided: Dict[int, bool] = {}         # patrol group -> thanked yet?
        self.patrol_nodes: List[Pos] = []
        self.followers: List[Tuple[int, str, Zombie]] = []
        self.final: Optional[FinalStand] = None
        self.formula_found = False
        self.applied_docs: Set[str] = set()
        self.scent: Dict[Pos, int] = {}
        self.visible: Set[Pos] = set()
        self.autosave_path = None
        self._field: Dict[Pos, int] = {}
        self._field_key = (-1, None)
        self._step_parity = 0
        self._tired_parity = 0
        self._force_progress: Dict[Pos, int] = {}
        setup.initialize(self)
        if drawn:
            self.msg(self._draw_text(drawn), "lore")
        self.update_fov()

    def _draw_text(self, drawn) -> str:
        c = self.cfg
        names = {"era": self.era.name.split(" - ")[0], "zombies": self.profile.name.split(" - ")[0],
                 "scenario": self.scenario.name.split(" - ")[0], "origin": self.era.origin_names[c.origin],
                 "mode": "hardcore" if c.mode == "living" else "normal"}
        return "Random draw: " + ", ".join(names[f] for f in ("era", "zombies", "scenario", "origin", "mode") if f in drawn) + "."

    # ================================================================= basics
    def next_uid(self) -> int:
        self._uid += 1
        return self._uid

    FEEDBACK_TAGS = ("warn", "bad", "combat", "good")     # what you just did or suffered shows up even in the story log
    FEEDBACK_TURNS = 2

    def story_log(self) -> list:
        """The focused log, plus whatever just happened to you: a refused shot, a hit, a wound."""
        story = set(self.story[-80:])
        now = self.clock.turn
        return [m for m in self.log[-120:] if m in story or (m[0] >= now - self.FEEDBACK_TURNS and m[2] in self.FEEDBACK_TAGS)]

    def msg(self, text: str, tag: str = "info", key: bool = False) -> None:
        if not text:
            return
        self.log.append((self.clock.turn, text, tag))
        if len(self.log) > LOG_LIMIT:
            del self.log[:100]
        if key or tag in STORY_TAGS:
            story = getattr(self, "story", None)
            if story is None:
                story = self.story = []
            story.append((self.clock.turn, text, tag))
            if len(story) > LOG_LIMIT:
                del story[:100]
        if key or tag in CHRONICLE_TAGS:
            self._chronicle(text)

    def _chronicle(self, text: str) -> None:
        """The few lines worth retelling at the end: wounds, finds, deaths, choices.  Keeps the start and the latest."""
        c = getattr(self, "chronicle", None)
        if c is None:
            c = self.chronicle = []
        if c and c[-1][2] == text:
            return
        c.append((self.clock.turn, self.clock.day, text))
        if len(c) > CHRONICLE_LIMIT:
            del c[CHRONICLE_KEEP]

    def item_def(self, item_id: str) -> ItemDef:
        return self.items[item_id]

    def is_dark(self) -> bool:
        return self.level.dark or self.clock.is_night

    @property
    def turn(self) -> int:
        return self.clock.turn

    def poi_of_level(self, level: Level) -> Optional[POI]:
        return self.pois.get(level.poi_id)

    def poi_kind_of(self, level: Level) -> str:
        poi = self.poi_of_level(level)
        return poi.kind if poi else "camp"

    def vault_component(self, level: Level) -> str:
        poi = self.poi_of_level(level)
        return poi.component if poi else ""

    # ================================================================= state changes
    def add_panic(self, amount: float, raw: bool = False) -> None:
        p = self.player
        if amount > 0 and not raw:
            amount *= max(0.1, 1.0 - p.mod("panic_resist"))
            if p.humanity < 25:
                amount *= 0.6
        p.panic = max(0.0, min(p.max_panic, p.panic + amount))

    def add_heat(self, amount: float, raw: bool = False) -> None:
        self.heat = max(0.0, min(100.0, self.heat + (amount if raw else amount * self.diff.noise)))

    def adjust_humanity(self, delta: int, why: str) -> None:
        p = self.player
        before = p.humanity
        p.humanity = max(0, min(100, p.humanity + delta))
        if why:
            self.msg(why, "bad" if delta < 0 else "good")
        if before >= 25 > p.humanity:
            self.msg("Something in you goes quiet. The fear dulls. So does everything else.", "warn")
        elif before >= 75 > p.humanity:
            self.msg("The people who trusted you would not recognise you now.", "warn")

    def give_item(self, item: Item) -> None:
        d = self.item_def(item.id)
        if d.durability and item.dur is None:
            item.dur = d.durability
        item.key = d.kind == "component"
        if not self.player.add_item(item, d.stackable):
            self.level.drop(self.player.pos, item)
            self.msg(f"Your pack is full; the {d.name.lower()} falls at your feet.", "warn")

    def end(self, kind: str, cause: str = "") -> None:
        if self.over is not None:
            return
        if kind in ("dead", "turned") and self.cfg.mode == "living":
            lives.player_died(self, kind, cause)           # the world goes on
            return
        self.over = ending.build(self, kind, cause)

    def make_hostile(self, h: Human) -> None:
        if not h.hostile:
            h.hostile = True
            self.rep[h.faction or "enclave"] = self.rep.get(h.faction or "enclave", 0) - 20
            self.msg(f"The {h.name.lower()} turns on you!", "bad", key=True)
            military.rally(self, h)
            if h.role in ("trader", "healer", "scholar"):
                self.rep["enclave"] = self.rep.get("enclave", 0) - 40

    # ================================================================= perception & noise
    def vision_radius(self) -> int:
        p, lv = self.player, self.level
        if lv.kind == "haven" and not self.final:
            r = 12
        elif lv.dark:
            r = 3 if self.poi_kind_of(lv) == "cave" else 7              # a cave is black: you see what your light shows
        else:
            light = self.clock.light
            r = 14 if light > 0.7 else 10 if light > 0.35 else 5
            r += ambience.PLAYER_SIGHT.get(self.weather, 0)         # fog and storms shorten your own view too
        if self.is_dark():
            r += int(p.mod("night_vision")) + self.era.rules.night_view      # a visor, or a moonless medieval night
            if combat.player_lit(self):
                r = max(r, self.item_def(p.light.id).light)
        return r

    def update_fov(self) -> None:
        lv, p = self.level, self.player
        self.visible = visible_tiles(lv, p.pos, self.vision_radius())
        for x, y in self.visible:
            lv.seen[y][x] = 1
        if lv.kind == "overworld":
            sense = 12 + int(p.mod("poi_sense"))
            for poi in self.pois.values():
                if not poi.revealed and poi.kind != "breach" and cheb(poi.pos, p.pos) <= sense \
                        and poi.kind != "house":
                    poi.revealed = True
                    self.msg(f"You notice {'a way underground' if poi.kind == 'cave' else 'a building'} ahead: {poi.name}.", "info")

    def visible_actors(self) -> List:
        return [a for a in self.level.actors if a.pos in self.visible and not getattr(a, "hidden", False)]

    def visible_hostiles(self) -> List:
        return [a for a in self.visible_actors()
                if isinstance(a, Zombie) or (isinstance(a, Human) and a.hostile)]

    def zombie_sees_player(self, z: Zombie) -> bool:
        return ai.sees_player(self, z)

    def emit_noise(self, pos: Pos, radius: float, source: str = "player") -> None:
        if radius < 1:
            return
        turn = self.clock.turn
        radius *= ambience.hearing_scale(self)                 # rain muffles, fog carries a little less
        if radius < 1:
            return
        if radius >= 3:
            self.pings.append({"pos": pos, "radius": radius, "turn": turn, "kind": source, "level": self.level.id})
            del self.pings[:-12]
        for a in self.level.actors:
            if not isinstance(a, Zombie) or a.state == "hunt":
                continue
            reach = radius * a.hearing
            if (a.x - pos[0]) ** 2 + (a.y - pos[1]) ** 2 > reach * reach:
                continue
            a.state, a.target, a.stimulus_turn = "investigate", pos, turn
            d = ((a.x - pos[0]) ** 2 + (a.y - pos[1]) ** 2) ** 0.5
            a.alert = min(95.0, a.alert + 25 + 30 * (1 - d / reach))     # closer noise rattles it more; only seeing you makes it hunt
        if self.level is self.world.level:
            hordes.noise_attracts(self, pos, radius)
        if source == "player" and radius >= 8:
            self.add_heat(radius * 0.12)

    def scent_near(self, pos: Pos, radius: int) -> Optional[Pos]:
        best, best_t = None, -1
        for spot, t in self.scent.items():
            if t > best_t and cheb(spot, pos) <= radius:
                best, best_t = spot, t
        return best

    def get_field(self) -> Dict[Pos, int]:
        key = (self.clock.turn, self.player.pos, self.level.id)
        if self._field_key != key:
            self._field = distance_field(self.level, self.player.pos, ai.FIELD_RADIUS, self.profile.swarm)
            self._field_key = key
        return self._field

    # ================================================================= the world tick
    def _spend(self, turns: int) -> None:
        for _ in range(max(0, turns)):
            if self.over:
                break
            self._tick()
        if not self.over:
            self.update_fov()

    def _tick(self) -> None:
        self.clock.turn += 1
        t = self.clock.turn
        self._player_conditions()
        if self.over:
            return
        self._hazards()
        if self.over:
            return
        ai.run(self)
        if self.over:
            return
        ai.abstract_run(self)
        hordes.tick(self)
        hordes.wanderers(self)
        self._followers()
        self._rising_dead()
        self._heat()
        self._time_events()
        self.pings = [q for q in self.pings if t - q["turn"] <= 6]
        if t % 5 == 0:
            mutation.crossing(self)
        ambience.weather_tick(self)
        ambience.world_tick(self)
        self._base_tick()
        military.tick(self)
        companion.tick(self)
        objective.watch(self)
        director.tick(self)
        pets.tick(self)
        memory.tick(self)
        if self.incidents and t % 5 == 0:
            self._check_incidents()
        if self.final:
            self._final_tick()
        if t % 40 == 0:
            self._maybe_event()
        if t % 30 == 0:
            self.scent = {k: v for k, v in self.scent.items() if t - v < SCENT_KEEP}
        if t % 100 == 0 and self.autosave_path:
            from outbreak.engine import save
            try:
                save.save(self, self.autosave_path)
            except OSError:
                pass

    def _base_tick(self) -> None:
        """Your base is safe while nothing hostile is in it; at night the dead find it and come in at the entrance."""
        if not base.in_base(self):
            return
        lv, p = self.level, self.player
        hostile = bool(base.hostiles_in(lv))
        lv.safe = not hostile and not self.final
        if hostile or self.final or self.clock.turn < self.raid_next or not self.clock.is_night:
            return
        if self.rng.random() >= 0.03:
            return
        n = min(10, int((3 + p.level // 3 + self.clock.day // 5) * max(1.0, self.pressure)))
        placed = 0
        spots = [(x, y) for y in range(lv.entry[1] - 5, lv.entry[1] + 6) for x in range(lv.entry[0] - 5, lv.entry[0] + 6)
                 if lv.free(x, y) and cheb((x, y), p.pos) > 2]
        self.rng.shuffle(spots)
        for spot in spots[:n]:
            if lv.free(*spot):
                z = spawn_zombie(self, lv, spot, dormant=False, fresh=True)
                z.state, z.target, z.stimulus_turn = "hunt", p.pos, self.clock.turn
                placed += 1
        if not placed:
            return
        self.raid_next = self.clock.turn + base.RAID_GAP + self.rng.randint(0, 100)
        lv.safe = False
        self.msg("The dead have found your base. They are coming in at the entrance!", "bad", key=True)
        self.emit_noise(lv.entry, 8, "zombie")

    def _player_conditions(self) -> None:
        p = self.player
        t = self.clock.turn
        if p.bleeding:
            if t % 4 == 0:
                p.hp -= p.bleeding
                self.add_panic(1.5)
                if p.hp <= 0:
                    self.end("dead", "bled out")
                    return
            if not p.hemorrhage and self.rng.random() < 0.03:
                p.bleeding -= 1
                if not p.bleeding:
                    self.msg("The bleeding stops on its own.", "good")
        if p.infected:
            p.infection_timer -= 1
            if p.bite_window > 0:
                p.bite_window -= 1
                if p.bite_window == 0 and p.bite_limb in ("arm", "leg"):
                    self.msg("It is too late to cut it off. The infection has spread.", "bad", key=True)
            left, total = p.infection_timer, self._infection_total()
            if left in (total // 2, total // 4, 30, 10) and left > 0:
                self.msg(f"Fever. Your hands shake. About {max(1, left // 10)} hours left.", "warn")
                self.add_panic(5)
            if left <= 0:
                self.end("turned", "")
                return
        if self.cfg.needs:
            p.hunger = min(100.0, p.hunger + 0.12)
            if p.hunger >= 100 and t % 5 == 0:
                p.hp -= 1
                if p.hp <= 0:
                    self.end("dead", "starved")
                    return
        if p.hp < p.max_hp and not p.bleeding and p.hunger < 75 and t % 12 == 0:
            p.hp += 1
        p.stamina = min(p.max_stamina, p.stamina + (0.3 if p.sprinting else 0.9))
        near = any(isinstance(a, Zombie) and a.state == "hunt" and cheb(a.pos, p.pos) < 9
                   for a in self.level.actors)
        if near:
            self.add_panic(0.15)
            adj = sum(1 for a in self.level.actors if isinstance(a, Zombie) and cheb(a.pos, p.pos) == 1)
            if adj >= 3:
                self.add_panic(3.0 * (adj - 2))
        else:
            p.panic = max(0.0, p.panic - (2.0 if self.level.safe else 0.35))
        if self.is_dark() and not combat.player_lit(self):
            self.add_panic(0.1)
        if p.filter_turns:
            p.filter_turns -= 1
        if p.disguise_turns:
            p.disguise_turns -= 1
        if p.light is not None and p.light_on and self.is_dark() and p.light.dur:
            p.light.dur -= 1
            if p.light.dur == 0:
                self.msg(f"Your {self.item_def(p.light.id).name.lower()} flickers out.", "warn")

    def _infection_total(self) -> int:
        """The length of the infection clock the run started with (for warnings)."""
        if self.scenario.start_infected and self.cfg.mode == "normal":
            return max(1, int(self.scenario.timer_turns * self.diff.timer))
        return max(1, int(self.profile.incubation * self.diff.timer))

    def _hazards(self) -> None:
        lv, p = self.level, self.player
        for pos, hz in list(lv.hazards.items()):
            if hz.ttl < 10 ** 8:
                hz.ttl -= 1
                if hz.ttl <= 0:
                    del lv.hazards[pos]
                    continue
            victim = lv.occ.get(pos)
            if hz.kind == "snare":
                if victim is p:
                    del lv.hazards[pos]
                    self.msg("You step into a hidden snare! Something clatters loudly.", "bad")
                    p.bleeding = min(3, p.bleeding + 1)
                    self.emit_noise(pos, 12, "world")
                    raiders.alert_near(self, pos, 14)
                    combat.damage_player(self, hz.power, "caught in a raider's snare")
                    if self.over:
                        return
                elif isinstance(victim, Zombie):
                    del lv.hazards[pos]
                    victim.hp -= hz.power
                    if victim.hp <= 0:
                        combat.kill_zombie(self, victim, by_player=False)
                continue
            if hz.kind == "spikes":
                if isinstance(victim, Zombie):
                    del lv.hazards[pos]
                    victim.hp -= hz.power
                    if pos in self.visible:
                        self.msg(f"The {victim.name.lower()} impales itself on your trap.", "good")
                    if victim.hp <= 0:
                        combat.kill_zombie(self, victim, by_player=True)
                continue
            if hz.kind == "fire":
                if isinstance(victim, Zombie):
                    victim.hp -= 4
                    if victim.hp <= 0:
                        combat.kill_zombie(self, victim, by_player=True)
                elif victim is p:
                    self.msg("You are burning!", "bad")
                    combat.damage_player(self, 4, "burned alive")
                    if self.over:
                        return
            elif hz.kind == "spore" and victim is p and not p.filter_turns:
                if self.profile.vector == "spore":
                    if self.rng.random() < 0.12 * (1.0 - p.mod("infect_resist")):
                        combat.infect(self, "spore")
                else:
                    combat.damage_player(self, 2, "choked on the fumes")
                    if self.over:
                        return
                self.add_panic(1.0)

    def _heat(self) -> None:
        prof = self.profile
        if self.heat >= prof.stalker_heat and self.stalker is None and self.clock.turn >= self.stalker_ready \
                and self.level is self.world.level and not self.final:
            self._spawn_stalker()
        self.heat = max(0.0, self.heat - (1.5 if self.level.safe else 0.4))

    def _spawn_stalker(self) -> None:
        p, lv = self.player, self.level
        for _ in range(60):
            ang = self.rng.uniform(0, math.tau)
            r = self.rng.randint(14, 20)
            pos = (int(p.x + math.cos(ang) * r), int(p.y + math.sin(ang) * r))
            if lv.free(*pos) and pos not in self.visible:
                z = spawn_zombie(self, lv, pos, "stalker", dormant=False, fresh=True)
                z.state, z.target, z.stimulus_turn = "hunt", p.pos, self.clock.turn
                self.stalker = z
                self.heat = 55.0
                self.msg(f"Something is hunting you. A {z.name.lower()}, and it does not stop.", "bad", key=True)
                self.add_panic(15)
                return

    def on_stalker_killed(self) -> None:
        self.stalker = None
        self.stalker_ready = self.clock.turn + 500
        self.heat = 20.0
        self.player.gain_xp(60)
        self.msg("The Stalker is dead. For now.", "good")

    def on_ring_escaped(self) -> None:
        self.stalker_ready = max(self.stalker_ready, self.clock.turn + 120)

    def _followers(self) -> None:
        for entry in list(self.followers):
            due, level_id, z = entry
            if self.clock.turn < due:
                continue
            self.followers.remove(entry)
            if self.level.id != level_id:
                continue
            spot = self.level.free_spot_near(self.player.x, self.player.y, 5)
            if spot and cheb(spot, self.player.pos) >= 2:
                z.x, z.y = spot
                self.level.add_actor(z)
                z.state, z.target, z.stimulus_turn = "hunt", self.player.pos, self.clock.turn
                self.msg(f"The {z.name.lower()} followed you in!", "bad")

    def _rising_dead(self) -> None:
        lv, t = self.level, self.clock.turn
        for pos, (died, human) in list(lv.corpses.items()):
            if t - died > 800:
                del lv.corpses[pos]
            elif human and (human == 2 or self.profile.turn_on_death) and t - died > 55 and lv.free(*pos) \
                    and cheb(pos, self.player.pos) > 1 and not lv.safe:
                del lv.corpses[pos]
                fallen = self.fallen_bodies.pop((lv.id, pos), None)
                z = lives.make_fallen(self, lv, pos, fallen) if fallen else \
                    spawn_zombie(self, lv, pos, "walker", dormant=False, fresh=True)
                z.fresh_human = False
                z.state, z.target, z.stimulus_turn = "hunt", self.player.pos, t
                if pos in self.visible:
                    self.msg("A body twitches, and rises.", "warn")

    @property
    def pressure(self) -> float:
        """Endless worlds only: 1.0 for the first days, then +6% a day up to x3."""
        if not self.scenario.escalates:
            return 1.0
        return min(3.0, 1.0 + 0.06 * max(0, self.clock.day - 3))

    def _restock(self) -> None:
        """Endless worlds: places you picked clean slowly fill up again, or nobody could live there for long."""
        n = 0
        for lv in self.levels.values():
            if lv is self.world.level:
                continue
            for pos, c in lv.containers.items():
                if c.opened and self.rng.random() < 0.5:
                    c.opened = False
                    c.loot = loot.roll_items(self.rng, self.era, self.poi_kind_of(lv), 1.0, self.diff.loot * 0.7)
                    c.coins = self.rng.randint(0, 4)
                    lv.set_tile(pos[0], pos[1], T.CRATE)
                    n += 1
        if n:
            self.msg("Somebody has been through the old places; there is something left in them again.", "info")

    def _time_events(self) -> None:
        c, sc = self.clock, self.scenario
        if self.profile.sun_burn and c.turn % 240 == 200 and self.world.level.kind == "overworld":
            self._dusk_wave()
        day = c.day + self.lost_turns // 240
        if self.deadline_days and day > self.deadline_days and not self.final:
            self.end("left_behind", "")
        elif self.deadline_days and c.turn % 240 == 0 and day == self.deadline_days:
            self.msg("The last day. By nightfall the way out will be gone.", "obj")
        if sc.escalates and c.turn % 240 == 0 and c.day > 1:
            if c.day % 4 == 0:
                self._restock()
            if c.day % 5 == 0:
                self.msg(f"Day {c.day}. You are still here. The dead are {int(round(self.pressure * 100))}% of what they were on day one.", "lore")
        if c.turn % 240 == 0:
            if c.day > 1:
                mutation.daily(self)
            ph = self.profile.phase(c.day)
            prev = self.profile.phase(c.day - 1)
            if ph is not prev and ph.blurb:
                self.msg(f"Day {c.day}: {ph.name}. {ph.blurb}", "lore")

    def _dusk_wave(self) -> None:
        lv, p = self.world.level, self.player
        n = int(34 * self.profile.density * self.diff.zombies * self.pressure)
        for _ in range(n * 4):
            if n <= 0:
                break
            pos = (self.rng.randint(3, lv.w - 4), self.rng.randint(3, lv.h - 4))
            if lv.free(*pos) and lv.tile(*pos) in (T.GRASS, T.ROAD) and cheb(pos, p.pos) > 12:
                spawn_zombie(self, lv, pos, dormant=False)
                n -= 1
        if self.level is lv:
            self.msg("The sun is gone. Shapes begin to move in the streets.", "warn")

    def _maybe_event(self) -> None:
        if self.pending_event or self.final or self.level is not self.world.level:
            return
        if (self.ring and self.ring.active) or self.clock.turn < 160 or self.rng.random() > 0.3 * director.scale(self):
            return
        if any(cheb(a.pos, self.player.pos) < 11 for a in self.level.actors if isinstance(a, Zombie)):
            return
        ev = encounters.pick(self)
        if ev:
            self.pending_event = encounters.start(self, ev)

    def _check_incidents(self) -> None:
        """A scripted road incident fires once when you come within a few tiles of it."""
        if self.pending_event or self.final or self.level is not self.world.level:
            return
        for inc in self.incidents:
            if not inc["done"] and cheb((inc["x"], inc["y"]), self.player.pos) <= 5:
                inc["done"] = True
                self.pending_event = encounters.start(self, encounters.BY_ID[inc["event"]])
                return

    def resolve_event(self, index: int) -> str:
        ev = self.pending_event
        if ev is None:
            return ""
        text = encounters.resolve(self, ev, index)
        if text == "You cannot afford that.":
            return text
        self.pending_event = None
        self.update_fov()
        return text

    # ================================================================= hostiles from events
    def spawn_horde_near_player(self) -> None:
        p, lv = self.player, self.world.level
        for _ in range(40):
            ang = self.rng.uniform(0, math.tau)
            r = self.rng.randint(16, 22)
            pos = (int(p.x + math.cos(ang) * r), int(p.y + math.sin(ang) * r))
            if 2 < pos[0] < lv.w - 2 and 2 < pos[1] < lv.h - 2 and lv.free(*pos):
                hordes.spawn_horde(self, pos, None, p.pos)
                return

    def spawn_raiders_near_player(self, n: int) -> None:
        raiders.ambush(self, self.level, n)

    def note_assist(self, pos: Pos) -> None:
        """You killed something near a patrol that had called for help: they will remember."""
        for a in self.level.actors:
            if isinstance(a, Human) and a.group and a.role in ("scout", "soldier") and cheb(a.pos, pos) <= 7 \
                    and self.clock.turn - self.distress.get(a.group, -999) < 300:
                self.aided.setdefault(a.group, False)

    def _unread_in(self, level) -> int:
        ids = [d for lst in level.docs.values() for d in lst] + [d for c in level.containers.values() for d in c.docs]
        return sum(1 for d in ids if d not in self.player.documents)

    def reveal_paper_leads(self, n: int = 2) -> List:
        """The nearest buildings that still hold pages you have not read."""
        p = self.player
        pool = [q for q in self.pois.values() if not q.papers and q.kind not in ("breach", "refuge", "pad")
                and any(d not in p.documents for d in q.docs)]
        pool.sort(key=lambda q: cheb(q.pos, p.pos))
        for q in pool[:n]:
            q.revealed = q.papers = True
        return pool[:n]

    def reveal_random_lead(self) -> bool:
        pois = [q for q in self.pois.values() if q.component and not q.lead]
        if not pois:
            site = self.pois[self.final_site_id]
            pois = [site] if not site.revealed else [
                q for q in self.pois.values() if not q.revealed and q.kind not in ("house", "breach")]
        if not pois:
            return False
        poi = self.rng.choice(pois)
        poi.revealed = poi.lead = True
        self.msg(f"A lead: {poi.name} is marked on your map.", "obj")
        return True

    # ================================================================= level handling
    def ensure_level(self, level_id: str) -> Level:
        if level_id in self.levels:
            return self.levels[level_id]
        poi_id, floor = level_id.rsplit(":", 1)
        poi = self.pois[poi_id]
        floor = int(floor)
        ctx = interiors.GenContext(
            self.era, self.profile, self.diff.loot, self.diff.zombies,
            lambda lv, pos, special=None, dormant=True: spawn_zombie(self, lv, pos, special, dormant),
            self.clock.day)
        docs = [d for i, d in enumerate(poi.docs) if i % max(1, poi.floors) == floor % max(1, poi.floors)]
        lv = interiors.generate(poi, floor, self.seed, ctx, docs)
        lv.poi_id = poi.id
        self.levels[level_id] = lv
        for z in lv.actors:
            z.birth_day = self.clock.day
        if poi.kind == "refuge":
            self._populate_refuge(lv)
        return lv

    def _populate_refuge(self, lv: Level) -> None:
        if lv.bench is None:
            return
        bx, by = lv.bench
        names = (("trader", "Trader", bx - 6, by + 3), ("healer", "Healer", bx - 10, by + 3),
                 ("scholar", "Archivist", bx - 14, by + 3))
        for role, name, x, y in names:
            spot = lv.free_spot_near(x, y, 3)
            if spot:
                h = Human(self.next_uid(), name, {"trader": "T", "healer": "H", "scholar": "S"}[role], spot[0], spot[1],
                          30, 30, role=role, faction="enclave", hostile=False)
                lv.add_actor(h)

    def _use_portal(self, pos: Pos) -> bool:
        lv, p = self.level, self.player
        if self.final is not None and self.final.exit == pos and lv.poi_id == self.final_site_id:
            self._escape()                                   # the main entrance was the way out
            return True
        portal = lv.portals[pos]
        old = lv
        target = self.world.level if portal.target == "world" else self.ensure_level(portal.target)
        if portal.pos != UNSET:
            dest = portal.pos
            if target.kind == "overworld":
                dest = target.free_spot_near(dest[0], dest[1] + 1, 3) or dest
        else:
            dest = target.arrivals.get(portal.arrive) or target.entry
        if not target.walkable(*dest) or (dest in target.occ and target.occ[dest] is not p):
            dest = target.free_spot_near(dest[0], dest[1], 4) or dest
        from_pos = p.pos
        if portal.target != "world":
            pets.on_enter(self, target)
        if self.stalker and self.stalker.hp > 0 and self.stalker in old.actors \
                and cheb(self.stalker.pos, p.pos) <= 10 and self.stalker.state == "hunt":
            old.remove_actor(self.stalker)
            self.followers.append((self.clock.turn + 4, target.id, self.stalker))
        if old.occ.get(p.pos) is p:
            del old.occ[p.pos]
        self.level = target
        p.x, p.y = dest
        target.occ[dest] = p
        p.level_id = target.id
        companion.carry(self, old, target, dest, from_pos)
        if portal.target != "world":
            companion.on_enter(self, target)
        self.scent.clear()
        poi = self.poi_of_level(target)
        if portal.target != "world" and poi and not poi.visited:
            poi.visited = True
            poi.revealed = True
            p.gain_xp(6 if poi.kind == "house" else 15)
            ambience.building_alarm(self, poi)
            if self._unread_in(target):
                self.msg("You glimpse written pages somewhere in here.", "lore")
            self._chronicle(f"You enter {target.name} for the first time.")
        self.msg(f"You enter {target.name}." if portal.target != "world" else "You step back outside.", "info")
        if portal.target == "world":
            companion.on_return(self)
            pets.on_return(self)
        self._spend(1)
        return True

    # ================================================================= movement & interaction
    def _begin_action(self) -> bool:
        """False if panic freezes the player this turn."""
        if self.over:
            return False
        p = self.player
        if p.panic >= 95 and self.rng.random() < 0.12:
            self.msg("You freeze, unable to move!", "bad")
            self._spend(1)
            return False
        return True

    def move(self, dx: int, dy: int) -> bool:
        if not self._begin_action():
            return False
        p, lv = self.player, self.level
        nx, ny = p.x + dx, p.y + dy
        if not lv.in_bounds(nx, ny):
            return False
        target = lv.occ.get((nx, ny))
        if target is not None and target is not p:
            return self._bump_actor(target)
        tile = lv.tile(nx, ny)
        if tile == T.DOOR:
            lv.set_tile(nx, ny, T.DOOR_OPEN)
            lv.door_hp.pop((nx, ny), None)
            self.emit_noise(p.pos, 2)
            self._spend(1)
            return True
        if tile == T.LOCKED:
            return self.try_unlock((nx, ny))
        if tile in (T.CRATE, T.CRATE_OPEN):
            turns = inventory_ops.search(self, (nx, ny))
            self._spend(turns)
            return bool(turns)
        if tile == T.BENCH:
            return self.use_bench(True)
        if tile == T.BED:
            self.msg("A bed. Press 'z' to sleep.", "info")
            return False
        if tile == T.WORKSHOP:
            self.msg("Your workshop. Craft (c) while you stand beside it.", "info")
            return False
        if tile == T.LOCKER:
            self.msg("Your locker. Use the interact key beside it.", "info")
            return False
        if (nx, ny) in lv.portals and tile in (T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN):
            return self._use_portal((nx, ny))
        if not lv.walkable(nx, ny):
            return False
        snare = lv.hazards.get((nx, ny))
        if snare is not None and snare.kind == "snare" and not snare.hidden:
            if not p.sneaking:
                self.msg("A snare lies there. Creep (sneak) to disarm it, or go around.", "warn")
                return False
            del lv.hazards[(nx, ny)]
            self.give_item(Item("scrap", 1))
            self.msg("You carefully disarm the snare and keep the scrap.", "good")
            self._spend(2)
            return True
        lv.move_actor(p, nx, ny)
        self._after_step(tile)
        raiders.notice_snares(self)
        return True

    def forage(self) -> bool:
        return wild.forage(self)

    def gather(self) -> bool:
        return wild.gather(self)

    def push(self, target=None) -> bool:
        """Shove the nearest hostile within reach (or a given one)."""
        if not self._begin_action():
            return False
        near = combat.pushable(self)
        if target is None:
            if not near:
                self.msg("There is nothing within reach to push.", "info")
                return False
            target = near[0]
        turns = 1 if combat.push(self, target) else 0
        self._spend(turns)
        return bool(turns)

    def _bump_actor(self, target) -> bool:
        if isinstance(target, Animal) and (target.pet or target.stray):
            if target.pet:                                    # a pet in the way: you swap places
                p, lv = self.player, self.level
                a_pos, b_pos = p.pos, target.pos
                del lv.occ[a_pos]
                del lv.occ[b_pos]
                p.x, p.y = b_pos
                target.x, target.y = a_pos
                lv.occ[p.pos], lv.occ[target.pos] = p, target
                self._spend(1)
                return True
            self.msg(f"The {target.species} watches you. Press 'e' to offer it food.", "info")
            return False
        if isinstance(target, Human) and not target.hostile:
            if target.uid == getattr(self, "companion_uid", 0) and target.state in ("follow", "wait"):
                p, lv = self.player, self.level                      # your companion in the way (a forest path, a doorway): swap
                a_pos, b_pos = p.pos, target.pos
                del lv.occ[a_pos]
                del lv.occ[b_pos]
                p.x, p.y = b_pos
                target.x, target.y = a_pos
                lv.occ[p.pos], lv.occ[target.pos] = p, target
                self._spend(1)
                return True
            self.msg(f"{target.name} is here. Press 'e' to talk.", "info")
            return False
        if getattr(target, "hidden", False):                  # you walked into someone lying in wait
            raiders.spring(self, target, "You stumble onto a hidden raider!")
        turns = 1 if combat.player_attack(self, target) else 0
        self._spend(turns)
        return bool(turns)

    def _tire(self, tile: int, sneaking: bool, sprinting: bool) -> None:
        """Marching wears you down: a step costs stamina, more at a run and in water, little when creeping.  Resting and
        standing still win it back faster than any of them spend it, so only a sustained march empties it."""
        p = self.player
        drain = SPRINT_DRAIN if sprinting else SNEAK_DRAIN if sneaking else WALK_DRAIN
        if tile == T.SHALLOW:
            drain *= 1.5
        p.stamina = max(0.0, p.stamina - drain)
        if p.stamina <= 0 and p.fatigue < 2:
            p.fatigue = 2
            self.msg("You are exhausted. You can barely put one foot in front of the other: rest.", "bad")
        elif p.stamina < TIRED_BELOW and p.fatigue < 1:
            p.fatigue = 1
            self.msg("You are getting winded. Slow down, or find somewhere to rest.", "warn")
        elif p.stamina > 40:
            p.fatigue = 0

    def _after_step(self, tile: int) -> None:
        p, lv = self.player, self.level
        noise = {T.ROAD: 3, T.BRUSH: 3, T.SHALLOW: 5}.get(tile, 2)
        if p.sneaking:
            noise = 2 if tile in (T.ROAD, T.BRUSH) else 3 if tile == T.SHALLOW else 1     # careful, but never silent
        elif p.sprinting and p.stamina > 5:
            noise += 4
        if p.armor:
            noise += self.item_def(p.armor.id).stealth
        noise = int(round(noise * self.era.rules.step_noise))       # soft ground vs hard floors
        noise = max(0, noise + int(p.mod("move_noise")))
        if not p.sneaking:
            noise += ambience.step_extra(self, tile)           # gravel, glass, metal floors, the building you are in
            ambience.explain_step(self, tile)
            ambience.startle(self, tile)
        self.emit_noise(p.pos, noise)
        wild.forest_note(self)
        if not T.TILES[tile].masks_scent:
            self.scent[p.pos] = self.clock.turn
        cost = 1
        if p.sneaking:
            cost = 2
        elif p.sprinting and p.stamina > 5:
            self._step_parity ^= 1
            cost = self._step_parity               # a free step every other move
        else:
            p.sprinting = False
        self._tire(tile, p.sneaking, p.sprinting)
        if p.stamina <= 0:
            cost += 1                              # exhausted: you stagger at half speed
        elif p.stamina < TIRED_BELOW:
            self._tired_parity ^= 1
            cost += self._tired_parity             # winded: every other step is a slog
        if p.fracture:
            self._step_parity ^= 1
            cost += self._step_parity
        if "leg" in p.lost:
            cost += 2 if len(p.lost) >= 2 else 1           # one leg: half speed; no limbs to spare: a crawl
        stack = lv.items.get(p.pos)
        if stack:
            names = ", ".join(self.item_def(i.id).name.lower() for i in stack[:3])
            self.msg(f"You see here: {names}. (g to pick up)", "info")
        if p.pos in lv.docs:
            self.msg("A document lies here. (g to pick up)", "info")
        if lv.hazards.get(p.pos) and lv.hazards[p.pos].kind == "spore" and not p.filter_turns:
            self.msg("The air is thick with spores!", "warn")
        self._spend(cost)

    def try_unlock(self, pos: Pos) -> bool:
        lv, p = self.level, self.player
        poi = self.poi_of_level(lv)
        if poi and poi.code_known:
            lv.set_tile(pos[0], pos[1], T.DOOR_OPEN)
            self.msg("You key in the code you deciphered. The vault door opens.", "good")
            self._spend(1)
            return True
        carried = ([p.weapon] if p.weapon else []) + p.inventory
        tools = [i for i in carried if self.item_def(i.id).kind == "weapon" and
                 self.item_def(i.id).style in ("blunt", "blade", "polearm")]
        if not tools:
            self.msg("The door is locked. Find its code, or something to force it with.", "warn")
            return False
        progress = self._force_progress.get(pos, 0) + 1
        self._force_progress[pos] = progress
        self.emit_noise(p.pos, 14)
        self._spend(FORCE_TURNS if progress == 1 else 2)
        if self.over:
            return True
        if self.rng.random() < 0.35 + 0.15 * progress:
            lv.set_tile(pos[0], pos[1], T.DOOR_OPEN)
            self.msg("The lock gives with a crack that carries through the whole building.", "good")
        else:
            self.msg("You hammer at the lock. It holds. (try again)", "info")
        return True

    def wait(self, turns: int = 1) -> bool:
        if self.over:
            return False
        self._spend(turns)
        return True

    def rest(self, max_turns: int = 20) -> int:
        """Rest until hurt no more, disturbed, or ``max_turns`` pass.  Returns turns rested."""
        if self.over or self.visible_hostiles():
            if self.visible_hostiles():
                self.msg("You cannot rest with enemies in sight.", "warn")
            return 0
        p = self.player
        rested = 0
        for _ in range(max_turns):
            hp0 = p.hp
            self._spend(1)
            rested += 1
            if self.over or p.hp < hp0 or self.visible_hostiles() or self.pending_event:
                break
            if p.hp < p.max_hp and not p.bleeding and self.clock.turn % 3 == 0:
                p.hp += 1
            p.stamina = min(p.max_stamina, p.stamina + 1.5)
            if p.hp >= p.max_hp and p.stamina >= p.max_stamina and p.panic < 5:
                break
        return rested

    def toggle_sneak(self) -> None:
        self.player.sneaking = not self.player.sneaking
        if self.player.sneaking:
            self.player.sprinting = False
        self.msg("You creep." if self.player.sneaking else "You stand up straight.", "info")

    def toggle_sprint(self) -> None:
        p = self.player
        if "leg" in p.lost:
            p.sprinting = False
            self.msg("You cannot run on one leg.", "warn")
            return
        p.sprinting = not p.sprinting and p.stamina > 10
        if p.sprinting:
            p.sneaking = False
        self.msg("You break into a run." if p.sprinting else "You slow down.", "info")

    def toggle_light(self) -> None:
        p = self.player
        if p.light is None:
            self.msg("You have no light.", "warn")
            return
        p.light_on = not p.light_on
        self.msg("You switch the light on." if p.light_on else "You douse the light.", "info")
        self.update_fov()

    # ----------------------------------------------------------------- items
    def pickup(self) -> bool:
        turns = inventory_ops.pickup(self)
        self._spend(turns)
        return bool(turns)

    def use(self, index: int) -> bool:
        if not self._begin_action():
            return False
        turns = inventory_ops.use(self, index)
        self._spend(turns)
        return bool(turns)

    def equip(self, index: int) -> bool:
        turns = inventory_ops.equip(self, index)
        self._spend(turns)
        return bool(turns)

    def unequip(self, slot: str) -> bool:
        turns = inventory_ops.unequip(self, slot)
        self._spend(turns)
        return bool(turns)

    def drop(self, index: int) -> bool:
        turns = inventory_ops.drop(self, index)
        self._spend(turns)
        return bool(turns)

    def craft(self, recipe_id: str) -> bool:
        turns = inventory_ops.craft(self, recipe_id)
        self._spend(turns)
        return bool(turns)

    def targets(self, ranged: bool = False) -> List:
        """Hostile things you can see, nearest first."""
        w = combat.weapon_def(self)
        reach = w.reach if (ranged or w.is_ranged or w.reach > 1) else 1
        out = [a for a in self.visible_hostiles() if cheb(a.pos, self.player.pos) <= max(reach, 1)]
        out.sort(key=lambda a: cheb(a.pos, self.player.pos))
        return out

    def fire(self, target) -> bool:
        if not self._begin_action():
            return False
        spent = combat.player_fire(self, target)
        self._spend(1 if spent else 0)
        return spent

    def attack(self, target) -> bool:
        if not self._begin_action():
            return False
        spent = combat.player_attack(self, target)
        self._spend(1 if spent else 0)
        return spent

    def throw(self, item_id: str, pos: Pos) -> bool:
        if not self._begin_action():
            return False
        spent = combat.throw(self, item_id, pos)
        self._spend(1 if spent else 0)
        return spent

    def claim_base(self) -> bool:
        if not self._begin_action():
            return False
        turns = base.claim(self)
        self._spend(turns)
        return turns > 0

    def build_structure(self, sid: str) -> bool:
        if not self._begin_action():
            return False
        turns = base.build(self, sid)
        self._spend(turns)
        return turns > 0

    def amputate(self) -> bool:
        if combat.can_amputate(self):
            self.msg(combat.can_amputate(self), "warn")
            return False
        combat.amputate(self)
        self._spend(3)
        return True

    def smear(self) -> bool:
        p, lv = self.player, self.level
        near = any(cheb(pos, p.pos) <= 1 for pos in lv.corpses)
        if not near:
            self.msg("You need a corpse within reach.", "warn")
            return False
        p.disguise_turns = 120
        self.add_panic(8)
        self.msg("You smear yourself with gore. You reek of the dead.", "info")
        self._spend(3)
        return True

    # ----------------------------------------------------------------- documents
    def collect_document(self, doc_id: str) -> None:
        if doc_id in self.player.documents:
            return
        self.player.documents.append(doc_id)
        doc = self.docs[doc_id]
        self.msg(f"You find a document: {doc.title}.", "lore")

    def read_document(self, doc_id: str) -> Tuple[str, List[str]]:
        """Reading exposes you to unknown words; returns (text, words learned)."""
        doc = self.docs[doc_id]
        learned = cipher.expose(doc, self.know, cipher.EXPOSURE_TO_LEARN - (1 if self.player.mod("study_bonus") >= 0.3 else 0))
        if learned:
            self.msg(f"The meaning of '{', '.join(learned)}' sinks in.", "good")
        self._apply_payload(doc)
        self._spend(2)
        return cipher.render(doc, self.know), learned

    def study_document(self, doc_id: str) -> Tuple[str, List[str]]:
        doc = self.docs[doc_id]
        words = 1 + (1 if self.know.fluency >= 0.15 else 0) + (1 if self.know.fluency >= 0.3 else 0)
        learned = cipher.study(self.rng, doc, self.know, self.player.mod("study_bonus"), words)
        if learned:
            self.msg(f"After long effort you work out: {', '.join(learned)}.", "good")
            self.player.gain_xp(3 * len(learned))
        elif doc.studies >= cipher.STUDY_LIMIT:
            self.msg("You have wrung everything you can out of this page for now.", "info")
        else:
            self.msg("The page will not give up its secrets. Try again.", "info")
        self._apply_payload(doc)
        self._spend(5)
        return cipher.render(doc, self.know), learned

    def _apply_payload(self, doc: cipher.Document) -> None:
        if doc.id in self.applied_docs or not cipher.is_decoded(doc, self.know):
            return
        self.applied_docs.add(doc.id)
        self.player.gain_xp(10)
        if "reveal" in doc.payload:
            poi = self.pois[doc.payload["reveal"]]
            poi.revealed = poi.lead = True
            self.msg(f"Deciphered: {poi.name} is now marked on your map.", "good")
        if "code" in doc.payload:
            poi = self.pois[doc.payload["code"]]
            poi.code_known = True
            self.msg(f"Deciphered: you now know the vault code for {poi.name}.", "good")
        if "recipe" in doc.payload and doc.payload["recipe"] not in self.player.recipes:
            self.player.recipes.append(doc.payload["recipe"])
            self.msg(f"Deciphered: you now know how to make the {doc.payload['name'].lower()}.", "good")
        if "formula" in doc.payload:
            self.formula_found = True
            self.msg("Deciphered: you now hold the formula.", "good")

    # ----------------------------------------------------------------- havens
    def adjacent_pet(self) -> Optional[Animal]:
        p = self.player
        for dx, dy in DIRS8:
            a = self.level.occ.get((p.x + dx, p.y + dy))
            if isinstance(a, Animal) and (a.pet or a.stray):
                return a
        return None

    def adjacent_npc(self) -> Optional[Human]:
        p = self.player
        for dx, dy in DIRS8:
            a = self.level.occ.get((p.x + dx, p.y + dy))
            if isinstance(a, Human) and not a.hostile:
                return a
        return None

    def adjacent_tile(self, tile: int) -> Optional[Pos]:
        p, lv = self.player, self.level
        for dx, dy in DIRS8:
            if lv.tile(p.x + dx, p.y + dy) == tile:
                return (p.x + dx, p.y + dy)
        return None

    def interact(self) -> str:
        """Context action. Returns 'npc', 'pet' or 'bed' when the UI must open a menu, else ''."""
        if self.adjacent_npc():
            return "npc"
        if self.adjacent_pet():
            return "pet"
        if self.adjacent_tile(T.BED):
            return "bed"
        if self.adjacent_tile(T.LOCKER):
            return "locker"
        if self.adjacent_tile(T.BENCH):
            self.use_bench(True)
            return ""
        crate = self.adjacent_tile(T.CRATE)
        if crate:
            self._spend(inventory_ops.search(self, crate))
            return ""
        lock = self.adjacent_tile(T.LOCKED)
        if lock:
            self.try_unlock(lock)
            return ""
        self.msg("Nothing to interact with.", "info")
        return ""

    def sleep(self) -> int:
        """Sleep until morning (or 80 turns).  The infection clock keeps running."""
        lv, p = self.level, self.player
        if not lv.safe:
            self.msg("It is not safe to sleep here.", "warn")
            return 0
        turns = services.sleep(self)
        if base.in_base(self):                           # a raid or a wound wakes you
            slept = 0
            for _ in range(turns):
                hp0 = p.hp
                self._spend(1)
                slept += 1
                if self.over or p.hp < hp0 or base.hostiles_in(lv) or self.pending_event:
                    break
            if not self.over and slept < turns:
                self.msg("You wake with a start.", "warn")
            turns = slept
        else:
            self._spend(turns)
        if not self.over:
            share = min(1.0, turns / 60) if base.in_base(self) else 1.0       # woken early, you heal less
            p.hp = min(p.max_hp, p.hp + int(p.max_hp * 0.6 * share))
            p.stamina = p.max_stamina
            p.panic = 0.0
            self.msg(f"You sleep for {turns // 10} hours.", "info")
            if p.infected:
                self.msg("You wake in a sweat. The fever has not broken.", "warn")
        return turns

    def requirements(self) -> List[Tuple[str, bool, str]]:
        """(label, done, hint) for each thing the scenario still needs."""
        sc, p = self.scenario, self.player
        out = []
        for req in sc.requirements:
            have = p.count(req.id) > 0
            poi = next((q for q in self.pois.values() if q.component == req.id), None)
            hint = "in your pack" if have else (f"lead: {poi.name}" if poi and poi.lead else "location unknown")
            out.append((self.item_def(req.id).name, have, hint))
        if sc.needs_formula:
            ok = self.formula_found and self.know.fluency >= sc.formula_fluency
            if ok:
                hint = "ready"
            elif self.formula_found:
                hint = f"need {int(sc.formula_fluency * 100)}% fluency (you have {int(self.know.fluency * 100)}%)"
            else:
                hint = "not found"
            out.append(("The formula", ok, hint))
        return out

    def requirements_met(self) -> bool:
        return all(done for _, done, _ in self.requirements())

    SIEGE_SECURE_HP = 30                                       # a door this strong counts as barricaded

    def _siege_doors(self, lv: Level) -> List[Pos]:
        return [(x, y) for y in range(lv.h) for x in range(lv.w)
                if lv.tile(x, y) in (T.DOOR, T.DOOR_OPEN) and (x in (1, lv.w - 2) or y == 1)]

    def _door_name(self, lv: Level, pos: Pos) -> str:
        return "west" if pos[0] <= 1 else "east" if pos[0] >= lv.w - 2 else "north"

    def _door_inside(self, lv: Level, pos: Pos) -> Pos:
        return (pos[0] + (1 if pos[0] <= 1 else -1 if pos[0] >= lv.w - 2 else 0), pos[1] + (1 if pos[1] <= 1 else 0))

    def use_bench(self, ask: bool = False) -> bool:
        lv = self.level
        site = self.pois[self.final_site_id]
        if lv.poi_id != site.id:
            self.msg("It is idle. This is not where you need to be.", "info")
            return False
        if self.final:
            self.msg("You are already working. Hold out!", "warn")
            return False
        if not self.requirements_met():
            missing = [f"{n} ({h})" for n, done, h in self.requirements() if not done]
            self.msg("You are not ready: " + "; ".join(missing) + ".", "warn")
            return False
        sc = self.scenario
        doors = self._siege_doors(lv)
        weak = [d for d in doors if lv.tile(*d) != T.DOOR or lv.door_hp.get(d, ai.DOOR_HP) < self.SIEGE_SECURE_HP]
        if ask and weak and not getattr(self, "siege_warned", False):
            self.siege_warned = True
            names = ", ".join(self._door_name(lv, d) for d in weak)
            self.msg(f"Once you start there is no taking it back. The {names} door{'s are' if len(weak) > 1 else ' is'} "
                     "not barricaded: each wave will break through there. Barricade them, set traps, "
                     f"stock fire, then use it again to {sc.final_verb}.", "warn")
            return False
        self.final = FinalStand(sc.final_turns, total=sc.final_turns, doors=doors)
        lv.safe = False
        self.msg(f"You begin to {sc.final_verb}. The noise carries. Hold out for {sc.final_turns} turns!", "bad", key=True)
        self.emit_noise(self.player.pos, 30)
        self.add_heat(30, raw=True)
        self._spend(1)
        return True

    def _final_tick(self) -> None:
        f, lv, p = self.final, self.level, self.player
        if lv.poi_id != self.final_site_id:
            return                                           # you left: the work pauses
        if f.exit is not None:                                 # the break-out: reach the door you were given
            if p.pos == f.exit:
                self._escape()
                return
            if self.clock.turn % 12 == 0:
                self._exit_hint()
        else:
            f.turns_left -= 1
            if f.turns_left <= 0:
                self._start_breakout(f)
        f.next_wave -= 1
        if f.next_wave <= 0:
            progress = 1.0 - max(0, f.turns_left) / max(1, f.total)
            f.next_wave = max(3, 7 - int(progress * 4))             # the waves come faster as it goes on
            n = 2 + self.player.level // 4 + (1 if self.diff.zombies > 1 else 0) + int(progress * 3)
            self._siege_wave(f, self.rng.choice([None] + f.doors), n)
        if not f.boss_done and f.turns_left <= self.scenario.final_turns // 2:
            f.boss_done = True
            if p.humanity < 40:
                self.msg("People step out of the dark with weapons. 'We have heard about you.'", "bad", key=True)
                crew = []
                for _ in range(3):
                    spot = lv.free_spot_near(lv.entry[0], lv.entry[1], 4)
                    if spot and cheb(spot, p.pos) > 2:
                        r = make_raider(self, *spot)
                        r.state = "hunt"
                        lv.add_actor(r)
                        crew.append(r)
                raiders.squad_up(self, crew)
            else:
                spot = lv.free_spot_near(lv.entry[0], lv.entry[1], 4)
                if spot:
                    z = spawn_zombie(self, lv, spot, "alpha", dormant=False, fresh=True)
                    z.state, z.target, z.stimulus_turn = "hunt", p.pos, self.clock.turn
                    self.msg("Something enormous pushes through the dead. The Alpha has come for you.", "bad", key=True)

    def _breakout_exits(self, f: FinalStand) -> List[Tuple[Pos, str]]:
        lv = self.level
        out = [(d, self._door_name(lv, d) + " door") for d in f.doors]
        out += [(pos, "main entrance") for pos, pt in lv.portals.items() if pt.target == "world"]
        return out

    def _start_breakout(self, f: FinalStand) -> None:
        """The work is done, and now the room has to be left: through one door, picked at random, with the dead in the way."""
        lv, p = self.level, self.player
        options = self._breakout_exits(f)
        far = [o for o in options if cheb(o[0], p.pos) >= 8] or options
        f.exit, f.exit_name = self.rng.choice(far)
        f.turns_left = 0
        f.next_wave = 1
        inside = lv.entry if f.exit_name == "main entrance" else self._door_inside(lv, f.exit)
        self._siege_spawn(inside, 3 + p.level // 4 + (1 if self.diff.zombies > 1 else 0), radius=3)
        self.msg(f"It is done. Now get out: the {f.exit_name} is the only way, and the dead are already crowding it.", "bad", key=True)
        self._exit_hint()

    def _exit_hint(self) -> None:
        f, p = self.final, self.player
        if f is None or f.exit is None:
            return
        self.msg(f"Get out through the {f.exit_name}: {compass(f.exit[0] - p.x, f.exit[1] - p.y)}, {dist_words(self.era.id, cheb(f.exit, p.pos))}.", "obj")

    def _escape(self) -> None:
        self.escape_via = self.final.exit_name if self.final is not None else ""
        self.final = None
        self.msg("You throw yourself through the door and into the open air.", "good", key=True)
        self.end("won")

    def _siege_spawn(self, spot_near: Pos, n: int, radius: int = 2) -> None:
        lv, p = self.level, self.player
        for _ in range(n):
            spot = lv.free_spot_near(spot_near[0] + self.rng.randint(-1, 1), spot_near[1], radius + n // 5)
            if spot and cheb(spot, p.pos) > 1:
                z = spawn_zombie(self, lv, spot, dormant=False, fresh=True)
                z.state, z.target, z.stimulus_turn = "hunt", p.pos, self.clock.turn

    def _siege_wave(self, f: FinalStand, door: Optional[Pos], n: int) -> None:
        """A wave arrives at the main entrance, or at a side door: closed doors hold it back until they break."""
        lv = self.level
        if door is None:
            self._siege_spawn(lv.entry, n, 3)
            self.msg("The dead are pouring in through the entrance!", "warn")
            return
        name = self._door_name(lv, door)
        if lv.tile(*door) == T.DOOR_OPEN:                    # already broken: nothing holds them
            self._siege_spawn(self._door_inside(lv, door), n)
            self.msg(f"More of them come through the broken {name} door!", "warn")
            return
        f.pending[door] = f.pending.get(door, 0) + n
        hp = lv.door_hp.get(door, ai.DOOR_HP) - 5 * n
        if hp > 0:
            lv.door_hp[door] = hp
            self.msg(f"Something is battering the {name} door. It will not hold forever ({hp} left).", "warn")
            self.emit_noise(door, 6, "zombie")
            return
        lv.door_hp.pop(door, None)
        lv.set_tile(door[0], door[1], T.DOOR_OPEN)
        self._siege_spawn(self._door_inside(lv, door), f.pending.pop(door, n))
        self.msg(f"The {name} door gives way!", "bad")

    # ----------------------------------------------------------------- perks
    def learn_perk(self, perk_id: str) -> bool:
        ok = self.player.learn_perk(perk_id)
        if ok:
            self.msg("You learn a new skill.", "good")
        return ok

    # ----------------------------------------------------------------- misc info
    def objectives(self) -> List[Tuple[str, bool]]:
        sc = self.scenario
        out = [(f"{n}: {h}", done) for n, done, h in self.requirements()]
        site = self.pois[self.final_site_id]
        where = site.name if site.revealed else "location unknown"
        out.append((f"{sc.final_verb.capitalize()} at {where}", False))
        errand = companion.personal_objective(self)
        if errand is not None:
            out.append(errand)
        return out

    def describe_at(self, pos: Pos) -> str:
        lv = self.level
        if not lv.in_bounds(*pos):
            return ""
        parts = [T.TILES[lv.tile(*pos)].name]
        a = lv.occ.get(pos)
        if a is not None and pos in self.visible:
            label = (a.name.lower() + (f" - {a.title}" if a.title else "")) if not a.is_player else "you"
            if isinstance(a, Zombie):
                label += f" ({ai.awareness_of(a)})"
            parts.insert(0, label)
        if pos in lv.items:
            parts.append("items")
        return ", ".join(parts)
