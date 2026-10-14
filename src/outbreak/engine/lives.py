"""The living world: infinite lives, a world that remembers, enemies that level.

In ``mode == "living"`` your death is not the end.  Your body keeps your gear and rises
again as a named zombie; whatever killed you grows stronger and keeps its name; a new
survivor walks out of the refuge into the same world, at the same hour of the same day.
"""
from __future__ import annotations

import re
from typing import Optional

from outbreak import content
from outbreak.engine import base
from outbreak.engine.model import Actor, Human, Zombie

LEVEL_RE = re.compile(r" \(Lv\d+\)$")
MAX_ENEMY_LEVEL = 15
KEEP_KNOWLEDGE = 0.5          # fraction of the cipher a new survivor inherits from the journals


def living(game) -> bool:
    return game.cfg.mode == "living"


def level_cap(game) -> int:
    """Enemies cannot outgrow the calendar: day 1 caps at level 3."""
    if game.scenario.escalates:
        return min(40, 2 + game.clock.day)
    return min(MAX_ENEMY_LEVEL, 2 + game.clock.day)


def base_name(a: Actor) -> str:
    return LEVEL_RE.sub("", a.name)


def level_up(game, a: Actor, announce: bool = True) -> None:
    a.lvl += 1
    gain = max(1, int(a.max_hp * 0.10))
    a.max_hp += gain
    a.hp = min(a.max_hp, a.hp + gain * 3)
    lo, hi = a.dmg
    a.dmg = (lo + (a.lvl % 2), hi + 1)
    a.acc = min(90, a.acc + 2)
    a.name = f"{base_name(a)} (Lv{a.lvl})"
    if announce and a.pos in game.visible and a.lvl >= 3:
        game.msg(f"The {base_name(a).lower()} grows stronger.", "warn")


def grant_xp(game, killer: Optional[Actor], value: int) -> None:
    """An enemy that kills something learns from it, up to the calendar's cap."""
    if killer is None or killer.is_player or killer.hp <= 0 or not living(game):
        return
    killer.lvl_xp += value
    while killer.lvl < level_cap(game) and killer.lvl_xp >= 8 * killer.lvl:
        killer.lvl_xp -= 8 * killer.lvl
        level_up(game, killer)


def label_of(game, generation: int, origin_id: str) -> str:
    return f"{game.era.origin_names[origin_id]} #{generation}"


def make_fallen(game, level, pos, info: dict) -> Zombie:
    """The body of a dead survivor gets up."""
    from outbreak.engine.spawn import spawn_zombie
    z = spawn_zombie(game, level, pos, "walker", dormant=False, fresh=True)
    for _ in range(max(0, info["level"] // 2)):
        level_up(game, z, announce=False)
    z.name = f"Fallen {info['label']}" + (f" (Lv{z.lvl})" if z.lvl > 1 else "")
    z.title = f"Once {info['label']}"
    z.fresh_human = False
    return z


def player_died(game, kind: str, cause: str) -> None:
    """Replace the player with a new survivor at the refuge.  The world is untouched."""
    from outbreak.engine import setup
    p, lv, rng = game.player, game.level, game.rng
    label = label_of(game, game.generation, game.current_origin)
    record = {"label": label, "level": p.level, "day": game.clock.day, "kills": p.kills,
              "cause": cause or ("turned" if kind == "turned" else "died"), "kind": kind}
    game.fallen.append(record)
    # the tomb: gear on the floor, a body that will rise
    for item in [p.weapon, p.armor, p.light] + list(p.inventory):
        if item is not None:
            lv.drop(p.pos, item)
    if lv.occ.get(p.pos) is p:
        del lv.occ[p.pos]
    lv.corpses[p.pos] = (game.clock.turn, 2)
    game.fallen_bodies[(lv.id, p.pos)] = record
    # the killer remembers
    killer = game.killer if game.killer is not None and game.killer.hp > 0 else None
    game.killer = None
    killer_line = ""
    if killer is not None:
        grant_xp(game, killer, 40 + 10 * p.level)
        killer.title = f"Killer of {label}"
        killer_line = f" The {base_name(killer).lower()} that did it is now level {killer.lvl}, and it is still out there."
    # the next survivor
    new_origin = rng.choice([o for o in content.ORIGINS if o != game.current_origin] or list(content.ORIGINS))
    refuge = game.pois[game.refuge_id]
    world = game.world.level
    pos = world.free_spot_near(refuge.x, refuge.y + 2, 8) or world.free_spot_near(*game.world.start, 8)
    kept = set(rng.sample(sorted(game.know.known), int(len(game.know.known) * KEEP_KNOWLEDGE)))
    game.know.known = kept
    home = game.levels.get(game.base_id) if game.base_id else None
    if home is not None and not base.hostiles_in(home):             # your base is where the next one wakes
        spot = home.free_spot_near(home.entry[0], home.entry[1], 4)
        if spot:
            game.level, pos = home, spot
        else:
            home = None
    else:
        home = None
    if home is None:
        game.level = world
    docs = list(p.documents)
    game.generation += 1
    game.current_origin = new_origin
    new = setup.make_player(game, new_origin, pos)
    new.level_id = game.level.id
    new.documents = docs
    new.recipes = list(getattr(p, "recipes", new.recipes))
    new.level = max(1, p.level // 2)
    new.perk_points = new.level - 1
    new.max_hp += 3 * (new.level - 1)
    new.hp = new.max_hp
    # the road resets around you
    game.ring = None
    game.final = None
    game.pending_event = None
    game.followers = []
    game.companion_uid = 0
    game.pet_uid = 0
    game.heat = min(game.heat, 30.0)
    game._field_key = (-1, None)
    for a in world.actors:
        if isinstance(a, Human) and a.state == "follow":
            a.state = "patrol"
    new_label = label_of(game, game.generation, new_origin)
    why = cause if cause else ("The fever won." if kind == "turned" else "")
    text = (f"{label} (level {p.level}, day {game.clock.day}) is gone: {why}.{killer_line}\n\n"
            f"Their gear lies where they fell, and the body will not stay down. Nothing else changes. The dead are where "
            f"they were, the vaults are as they left them, and the clock keeps running.\n\n"
            f"{new_label} {'wakes in the base you built' if home is not None else 'reaches ' + game.era.refuge}. They know part of what the journals say, and they start at "
            f"level {new.level}.")
    game.death_notice = text
    game.msg(f"{label} has died. {new_label} takes up the search.", "bad", key=True)
