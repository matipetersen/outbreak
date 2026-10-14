"""Creating zombies (and raiders) with stats derived from the preset, the special
type and how far the outbreak has progressed."""
from __future__ import annotations

import random
from typing import Optional

from outbreak.content.zombies import SPECIALS, ZombieProfile
from outbreak.engine import military, mutation
from outbreak.engine.model import Human, Level, Zombie
from outbreak.util import DIRS8, weighted_choice


def pick_special(rng: random.Random, profile: ZombieProfile, day: int, boost: float = 1.0) -> str:
    phase = profile.phase(day)
    pairs = [("walker", 10.0)]
    for sid, weight, first_day in profile.specials:
        if day >= first_day:
            pairs.append((sid, weight * phase.special * boost))      # boost: how far the strain has run ahead (mutation.py)
    return weighted_choice(rng, pairs)


def _stronger(dmg, pressure: float):
    k = 1.0 + (pressure - 1.0) * 0.4
    return (int(dmg[0] * k), max(int(dmg[0] * k), int(dmg[1] * k))) if k > 1.0 else dmg


def make_zombie(game, special_id: str, x: int, y: int, fresh: bool = False) -> Zombie:
    profile: ZombieProfile = game.profile
    sp = SPECIALS[special_id]
    day = game.clock.day
    phase = profile.phase(day)
    age = 0 if fresh else game.rng.randint(0, max(0, day - 1))
    decay = max(0.4, 1.0 - profile.decay * age)
    pressure = game.pressure
    hp = max(1, int(sp.hp * profile.hp_mult * phase.hp * decay * (1.0 + (pressure - 1.0) * 0.6)))
    z = Zombie(
        uid=game.next_uid(), name=profile.name_of(special_id), glyph=sp.glyph, x=x, y=y, hp=hp, max_hp=hp,
        special=special_id, dmg=_stronger(sp.dmg, pressure), acc=sp.acc,
        speed=profile.speed * sp.speed * phase.speed * (0.85 if decay < 1 else 1.0),
        sight=profile.sight * sp.sight, hearing=profile.hearing * sp.hearing, xp=sp.xp, flags=sp.flags,
        birth_day=day - age)
    z.facing = DIRS8[z.uid % 8]                         # which way it looks (from the uid: the same for everyone)
    if "boss" in sp.flags or "relentless" in sp.flags:
        z.speed = max(z.speed, 1.0)
    return z


def spawn_zombie(game, level: Level, pos, special: Optional[str] = None, dormant: bool = True,
                 fresh: bool = False) -> Zombie:
    sid = special or pick_special(game.rng, game.profile, game.clock.day, mutation.boost_at(game, level, pos))
    z = make_zombie(game, sid, pos[0], pos[1], fresh)
    mutation.apply(game, z, level, pos)                   # what its district has become
    z.state = "dormant" if (dormant and level.kind != "overworld") else "idle"
    level.add_actor(z)
    return z


def make_raider(game, x: int, y: int) -> Human:
    era = game.era
    reach = 6 if (era.firearms or era.tech == 0) else 1          # guns, or bows in the old world
    hp = int(18 * (1.0 + 0.04 * game.player.level))
    h = Human(uid=game.next_uid(), name="Raider", glyph="R", x=x, y=y, hp=hp, max_hp=hp, role="raider",
              faction="raiders", hostile=True, dmg=(3, 6), acc=48, reach=reach)
    if reach > 1:
        h.mag = h.ammo = 6 if era.firearms else 5                  # a magazine, or a quiver: then they have to reload
    if game.rng.random() < 0.7:
        from outbreak.engine import loot
        h.loot = loot.roll_items(game.rng, era, "camp", 1.6, game.diff.loot)
    return h


PATROL_NAMES = {
    "scout": {"medieval": "Abbey scout", "eighties": "Fort scout", "modern": "Survivor scout", "scifi": "Dome scout"},
    "soldier": {"medieval": "Man-at-arms", "eighties": "Soldier", "modern": "Soldier", "scifi": "Marine"},
}


def make_patrol(game, role: str, x: int, y: int, group: int) -> Human:
    """A friendly-ish armed walker: an enclave scout or a military soldier."""
    era = game.era
    reach = 6 if (era.firearms or era.tech == 0) else 1
    hp, dmg, acc, faction = (24, (3, 6), 52, "enclave") if role == "scout" else (32, (4, 8), 60, "military")
    h = Human(uid=game.next_uid(), name=PATROL_NAMES[role][era.id], glyph="f", x=x, y=y, hp=hp, max_hp=hp,
              role=role, faction=faction, hostile=False, dmg=dmg, acc=acc, reach=reach, state="patrol",
              group=group)
    if role == "soldier":
        h.corrupt = military.corrupt_of(h.uid)
        if reach > 1:
            h.mag = h.ammo = 8
    return h
