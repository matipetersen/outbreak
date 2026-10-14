"""Building a new game: world, player, scenario, documents, population."""
from __future__ import annotations

import math
import random
from typing import List

from outbreak import content
from outbreak.content import story
from outbreak.content.items import ItemDef
from outbreak.engine import cipher, companion, encounters, hordes, military, mutation, pets, raiders, wild
from outbreak.engine import tiles as T
from outbreak.engine.clock import TURNS_PER_HOUR, Clock
from outbreak.engine.model import Container, Item, POI
from outbreak.engine.player import Player
from outbreak.engine.spawn import make_patrol, make_raider, spawn_zombie
from outbreak.engine.worldgen import generate_overworld
from outbreak.engine import loot
from outbreak.util import cheb, compass, dist_words, weighted_choice

BASE_HP = 80
SPECIAL_KINDS = ("breach", "refuge", "pad", "cave")
ZONE_DENSITY = (0.004, 0.015, 0.03)       # zombies per land tile: rural, suburb, city


def initialize(game) -> None:
    cfg = game.cfg
    seed = cfg.seed if cfg.seed is not None else random.SystemRandom().randrange(1 << 30)
    game.seed = seed
    game.rng = random.Random(seed ^ 0x5EED)
    game.era = content.get_era(cfg.era)
    companion.set_era(game.era.id)
    game.profile = content.get_preset(cfg.zombies)
    game.scenario = content.get_scenario(cfg.scenario)
    game.diff = cfg.diff
    game.items = dict(game.era.items)
    game.know = cipher.Knowledge(game.era.vocabulary(), game.era.glyphs)

    game.world = generate_overworld(random.Random(seed), game.era, cfg.map_w, cfg.map_h)
    game.levels = {"world": game.world.level}
    game.level = game.world.level
    game.pois = game.world.pois
    opening = _pick_opening(game)
    game.opening_id = opening.id
    start_hour = opening.hour
    if game.profile.sun_burn:
        start_hour = min(start_hour, 10)                  # sun-shy dead: keep a whole safe day to loot
    game.clock = Clock(start_hour * TURNS_PER_HOUR)

    _make_player(game)
    _apply_opening(game, opening)
    _scenario(game)
    mutation.build(game)
    _documents(game)
    _populate(game)
    raiders.scatter_snares(game)
    companion.spawn_start(game)
    if not game.profile.sun_burn:                           # nothing roams by day, so there is no opening tide
        hordes.start_ring(game)
    _intro(game)


# ------------------------------------------------------------------ player
def _resolve(game, token: str) -> str:
    d = game.era.defaults
    if token == "@ammo":
        return game.era.items[d["ranged"]].ammo
    return d[token[1:]] if token.startswith("@") else token


def _make_player(game) -> None:
    sx, sy = game.world.start
    game.current_origin = game.cfg.origin
    make_player(game, game.cfg.origin, (sx, sy))


def make_player(game, origin_id: str, pos) -> Player:
    """A fresh character with an origin's perks and kit, placed at ``pos`` on the overworld."""
    origin = content.get_origin(origin_id)
    hp = BASE_HP + origin.hp_bonus
    p = Player(uid=game.next_uid(), name="You", glyph="@", x=pos[0], y=pos[1], hp=hp, max_hp=hp, coins=origin.coins)
    p.humanity = 70
    game.player = p
    game.level.occ[p.pos] = p
    for perk_id, ranks in origin.perks.items():
        p.grant_perk(perk_id, ranks)
    game.know.learn_random(game.rng, origin.words)
    for token, qty in origin.kit:
        item_id = _resolve(game, token)
        if not item_id:
            continue
        d = game.item_def(item_id)
        item = Item(item_id, qty if d.stackable else 1, d.durability or None)
        if token == "@ammo":
            item.qty = qty
        slot = {"weapon": "weapon", "armor": "armor", "light": "light"}.get(d.kind)
        if slot and getattr(p, slot) is None and not (slot == "weapon" and token == "@ranged"):
            setattr(p, slot, item)
        else:
            p.add_item(item, d.stackable)
    return p


# ------------------------------------------------------------------ opening
def _pick_opening(game):
    cfg = game.cfg
    if cfg.opening != "random":
        return content.get_opening(cfg.opening)
    # a separate stream, so choosing an opening never shifts the world's randomness
    rng = random.Random(game.seed ^ 0x0BE17)
    pairs = [(o, o.affinity.get(cfg.origin, content.openings.DEFAULT_AFFINITY)) for o in content.OPENINGS.values()]
    return weighted_choice(rng, pairs)


def _apply_opening(game, opening) -> None:
    p = game.player
    p.coins += opening.coins
    p.panic = min(p.max_panic, p.panic + opening.panic)
    p.humanity = min(100, p.humanity + opening.humanity)
    if opening.words:
        game.know.learn_random(game.rng, opening.words)
    for token, qty in opening.items:
        item_id = _resolve(game, token)
        if not item_id:
            continue
        d = game.item_def(item_id)
        owned = [p.weapon, p.armor] + p.inventory
        if d.kind in ("weapon", "armor") and any(i is not None and i.id == item_id for i in owned):
            continue                                         # the origin already carries one
        item = Item(item_id, qty if d.stackable else 1, d.durability or None)
        if d.kind == "armor" and p.armor is None:
            p.armor = item
        elif d.kind == "weapon" and not d.is_ranged and p.weapon is None:
            p.weapon = item
        else:
            p.add_item(item, d.stackable)


def _patrols(game) -> None:
    """Enclave scouts and military soldiers walk the roads between buildings and the raider camps."""
    lv, rng, start = game.world.level, game.rng, game.world.start
    nodes = []
    for poi in game.pois.values():
        if poi.kind in SPECIAL_KINDS:
            continue
        spot = lv.free_spot_near(poi.x, poi.y + 2, 3)
        if spot:
            nodes.append(spot)
    nodes += [c for c in (lv.free_spot_near(cx, cy, 3) for cx, cy in game.world.camps) if c]
    game.patrol_nodes = nodes
    roads = [(x, y) for y in range(2, lv.h - 2) for x in range(2, lv.w - 2)
             if lv.tiles[y][x] == T.ROAD and cheb((x, y), start) >= 30]
    if not roads or not nodes:
        return
    groups = 1 + (lv.w * lv.h) // 7000
    group = 0
    for role in ("scout", "soldier"):
        for _ in range(groups):
            group += 1
            base = rng.choice(roads)
            for _m in range(rng.randint(2, 3)):
                spot = lv.free_spot_near(base[0], base[1], 3)
                if spot:
                    lv.add_actor(make_patrol(game, role, spot[0], spot[1], group))
            game.patrol_goals[group] = rng.choice(nodes)


def intro_pages(game) -> list:
    """The briefing: the world, the scene you start in, and what you have to do."""
    era, sc, prof = game.era, game.scenario, game.profile
    opening = content.get_opening(game.opening_id)
    world = f"{era.name} ({era.year}).\n\n{era.intro}\n\n{prof.lore}\n\n{mutation.matchup(era, prof)}"
    scene = opening.scenes[era.id] + "\n\n" + content.openings.CONSEQUENCE.format(
        alarm=content.openings.ALARMS[era.id])
    premise = (sc.premise_living if game.cfg.mode == "living" else sc.premise).format(refuge=era.refuge, pad=era.pad, radio=era.radio, days=game.deadline_days)
    return [(opening.name, scene), ("Your situation", situation(game)), ("The world", world), ("What you must do", premise)]


def situation(game) -> str:
    """Who you are, what is in your hands, who is beside you and what is nearby: this run, not any run."""
    p, era, sc = game.player, game.era, game.scenario
    c, st = game.clock, story
    voice = st.ORIGIN_VOICE.get(game.current_origin, "")
    light = st.LIGHT_WORDS["day" if c.is_day else "night" if c.is_night else "edge"]
    hands = game.item_def(p.weapon.id).name.lower() if p.weapon is not None else "your bare hands"
    lines = [voice, f"It is {int(c.hour):02d}:{int(c.hour % 1 * 60):02d}, {light}. In your hands: {hands}; {p.coins} {era.coin} in your pocket."]
    near = sorted((q for q in game.pois.values() if q.kind not in SPECIAL_KINDS), key=lambda q: cheb(q.pos, p.pos))[:2]
    if near:
        lines.append("Close by: " + "; ".join(f"{q.name}, {dist_words(game.era.id, cheb(q.pos, p.pos))} {compass(q.x - p.x, q.y - p.y)}" for q in near) + ".")
    ally = companion.current(game)
    if ally is not None:
        a = companion.arch_of(ally)
        lines.append(f"{ally.name}, a {a.label}, is already beside you. {a.intro}")
    lines.append(st.SCENARIO_TAIL[sc.id])
    return "\n\n".join(x for x in lines if x)


# ------------------------------------------------------------------ scenario
def _scenario(game) -> None:
    sc, era, rng = game.scenario, game.era, game.rng
    start = game.world.start
    p = game.player
    if sc.start_infected and game.cfg.mode == "normal":
        p.infected = True
        p.infection_timer = int(sc.timer_turns * game.diff.timer)
        p.bite_limb = "torso"
    for req in sc.requirements:
        name = req.names[era.id]
        game.items[req.id] = ItemDef(req.id, name, "component", req.desc, value=0)
        pool = [q for q in game.pois.values() if q.kind == req.poi_kind and not q.component]
        near = [q for q in pool if 18 <= cheb(q.pos, start) <= 85] or pool
        host = rng.choice(near)
        host.component = req.id
        host.danger = round(host.danger * 1.15, 2)
    refuge = next(q for q in game.pois.values() if q.kind == "refuge")
    pad = next(q for q in game.pois.values() if q.kind == "pad")
    game.refuge_id, game.pad_id = refuge.id, pad.id
    site = refuge if sc.final_site == "refuge" else pad
    game.final_site_id = site.id
    site.revealed = True if sc.final_site == "refuge" else site.revealed
    game.rep = {"military": 0, "enclave": 10, "raiders": -20, "cult": 0, "science": 0}
    _deadline(game, start, pad)
    _incidents(game, start, pad)


def _deadline(game, start, pad) -> None:
    """The way out closes after the scenario's minimum, or later when the route is long: collecting parts and crossing the
    map must be possible, not a sprint.  About 96 tiles a day of real progress (looting, interiors, rest and trouble included)."""
    sc = game.scenario
    if not sc.deadline_days:
        game.deadline_days = 0
        return
    points, here = [], start
    left = [q.pos for q in game.pois.values() if q.component]
    while left:
        nxt = min(left, key=lambda q: cheb(q, here))
        points.append(nxt)
        left.remove(nxt)
        here = nxt
    tour, here = 0, start
    for q in points + [pad.pos]:
        tour += cheb(here, q)
        here = q
    days = math.ceil(tour * 1.5 / 96) + 3 * len(sc.requirements) + 4
    game.deadline_days = max(sc.deadline_days, min(45, days))


def _incidents(game, start, pad) -> None:
    """Things that happen on the road to the extraction point: fixed spots on the way, each fires once when you get close."""
    sc, rng = game.scenario, game.rng
    game.incidents = []
    if not sc.incidents or sc.final_site != "pad":
        return
    ids = [e.id for e in encounters.ROAD_EVENTS]
    rng.shuffle(ids)
    n = sc.incidents
    for i in range(n):
        t = (i + 1) / (n + 1)
        x = int(start[0] + (pad.x - start[0]) * t + rng.randint(-5, 5))
        y = int(start[1] + (pad.y - start[1]) * t + rng.randint(-5, 5))
        game.incidents.append({"x": x, "y": y, "event": ids[i % len(ids)], "done": False})


# ------------------------------------------------------------------ documents
def _documents(game) -> None:
    rng, era, sc = game.rng, game.era, game.scenario
    start = game.world.start
    hosts: List[POI] = [q for q in game.pois.values() if q.kind not in SPECIAL_KINDS]
    ranked = sorted(hosts, key=lambda q: cheb(q.pos, start) + rng.random() * 10)
    near = ranked[:max(12, len(ranked) // 3)]
    game.docs = {}

    def add(kind, payload, host: POI, poi_name="", pad_name=""):
        doc_id = f"doc{len(game.docs)}"
        game.docs[doc_id] = cipher.make_document(rng, era, doc_id, kind, poi_name, pad_name, payload)
        host.docs.append(doc_id)

    def host_for(pool, avoid: POI = None) -> POI:
        options = [q for q in pool if q is not avoid] or pool
        return rng.choice(options)

    for req in sc.requirements:
        target = next(q for q in game.pois.values() if q.component == req.id)
        add("research", {"reveal": target.id}, host_for(near, target), target.name)
        add("code", {"code": target.id}, host_for(hosts, target), target.name)
    if sc.needs_formula:
        labs = [q for q in near if q.kind == "lab"] or near
        add("formula", {"formula": "1"}, host_for(labs))
    pad = game.pois[game.pad_id]
    if sc.final_site == "pad":
        add("evac", {"reveal": pad.id}, host_for(near), pad_name=pad.name)
        add("evac", {"reveal": pad.id}, host_for(hosts), pad_name=pad.name)
    from outbreak.content.recipes import RECIPES
    from outbreak.engine import inventory_ops
    for r in RECIPES:                                       # one manual per recipe you are not born knowing
        out = inventory_ops.recipe_output(game, r)
        if r.starter or out is None or (r.needs == "firearms" and not era.firearms) or \
                (r.needs == "electricity" and not era.electricity):
            continue
        add("manual", {"recipe": r.id, "name": game.item_def(out).name}, host_for(near if rng.random() < 0.6 else hosts))
    # pages to read: they scale with the size of the world (a big map with 26 papers would be a desert), and the first
    # ones are close to where you start, so the language can be picked up from the first day
    n = max(9, round(len(hosts) / 5))
    for i in range(n):
        if i < max(3, n // 4):
            pool = ranked[:max(6, len(ranked) // 12)]
        elif i < n // 2:
            pool = ranked[:max(12, len(ranked) // 3)]
        else:
            pool = hosts
        add("diary", {}, host_for(pool), rng.choice(hosts).name)


# ------------------------------------------------------------------ population
def _populate(game) -> None:
    lv, rng, prof = game.world.level, game.rng, game.profile
    zone, start = game.world.zone, game.world.start
    scale = prof.density * game.diff.zombies
    if not prof.sun_burn:                                  # nightstalkers only come out at dusk
        for y in range(2, lv.h - 2):
            for x in range(2, lv.w - 2):
                if lv.tiles[y][x] not in (T.GRASS, T.ROAD, T.BRUSH) or cheb((x, y), start) < 14:
                    continue
                if rng.random() < ZONE_DENSITY[zone[y][x]] * scale and (x, y) not in lv.occ:
                    spawn_zombie(game, lv, (x, y), dormant=False)
        for poi in game.pois.values():
            if poi.kind in SPECIAL_KINDS or poi.kind == "house":
                continue
            for _ in range(rng.randint(0, 2)):
                spot = lv.free_spot_near(poi.x + rng.randint(-3, 3), poi.y + 2, 3)
                if spot and cheb(spot, start) > 12:
                    spawn_zombie(game, lv, spot, dormant=False)
    for cx, cy in game.world.camps:
        crew = []
        for _ in range(rng.randint(2, 4)):
            spot = lv.free_spot_near(cx + rng.randint(-2, 2), cy + rng.randint(-1, 1), 3)
            if spot:
                r = make_raider(game, *spot)
                r.state = "idle"
                lv.add_actor(r)
                crew.append(r)
        raiders.setup_camp(game, lv, (cx, cy), crew)
        crate = (cx + 2, cy - 1)
        lv.containers[crate] = Container(loot=loot.roll_items(rng, game.era, "camp", 3.0, game.diff.loot),
                                         coins=rng.randint(2, 8))
    _patrols(game)
    military.build(game)
    wild.populate(game)
    pets.populate(game)
    for _ in range(3 + (lv.w * lv.h) // 3500):
        for _try in range(30):
            pos = (rng.randint(4, lv.w - 5), rng.randint(4, lv.h - 5))
            if cheb(pos, start) > 34 and lv.free(*pos):
                hordes.spawn_horde(game, pos)
                break


def _intro(game) -> None:
    game.intro_pages = intro_pages(game)
    era, sc, p = game.era, game.scenario, game.player
    refuge = game.pois[game.refuge_id]
    if sc.final_site == "refuge":
        d = compass(refuge.x - p.x, refuge.y - p.y)
        game.msg(f"Rumour on {era.radio}: {era.refuge} still stands, {d} of here, about {dist_words(era.id, cheb(refuge.pos, p.pos))} "
                 f"away. They may have a way to make a cure.", "lore")
        if game.cfg.mode == "living":
            game.msg("The cure is for the world. If you fall, someone else will carry on.", "warn")
        elif not sc.start_infected:
            game.msg("There is no way out. Live as long as you can, or find the cure.", "warn")
        else:
            game.msg("You are bitten. The infection is slow, but it is in you. Find the three components "
                     "and the formula before it takes you.", "warn")
    else:
        pad = game.pois[game.pad_id]
        d = compass(pad.x - p.x, pad.y - p.y)
        game.msg(f"Rumour on {era.radio}: the last way out is {d} of here, roughly {dist_words(era.id, cheb(pad.pos, p.pos))}. "
                 f"It closes after day {game.deadline_days}.", "lore")
    if game.profile.sun_burn:
        game.msg("The sun keeps them in the dark places. You have until dusk to find shelter and answers.", "warn")
    else:
        game.msg("The dead are closing in from every side but one. Move!", "warn")
