"""Combat rules: player attacks, zombie and human attacks, injuries, infection.

Every function takes the running ``game`` and mutates it; they return whether a
turn was spent where that matters.  Nothing here knows about eras: weapons are
:class:`ItemDef` records and zombies are parameterised by the preset.
"""
from __future__ import annotations

from typing import Optional

from outbreak.content.items import ItemDef
from outbreak.engine import companion, lives, memory, pets, raiders, wild
from outbreak.engine import tiles as T
from outbreak.engine.fov import has_los
from outbreak.engine.model import Actor, Animal, Hazard, Human, Item, Zombie
from outbreak.util import cheb, clamp, compass

FISTS = ItemDef("fists", "Fists", "weapon", style="unarmed", dmg=(1, 3), noise=2)
LIMBS = (("arm", 41), ("leg", 41), ("torso", 15), ("neck", 3))
STAMINA_PER_ATTACK = 4


# ------------------------------------------------------------------ helpers
SNEAK_HIT, SNEAK_HEAD, SNEAK_STAB = 0.85, 0.6, 1.75       # a creeping strike: how often it lands, how often it finds the head, its weight


def article(noun: str) -> str:
    return "an" if noun[:1].lower() in "aeiou" else "a"


def needs_both_arms(d: ItemDef) -> bool:
    """Bows, polearms and heavy long guns cannot be used with one arm."""
    return d.style in ("bow", "polearm") or (d.style in ("firearm", "energy") and d.dmg[1] >= 14)


def weapon_def(game) -> ItemDef:
    w = game.player.weapon
    if w is None:
        return FISTS
    d = game.item_def(w.id)
    if "arm" in game.player.lost and needs_both_arms(d):
        return FISTS                                   # you cannot work it one-handed
    return d


def player_lit(game) -> bool:
    p = game.player
    return p.light is not None and p.light_on and (p.light.dur or 0) > 0 and game.is_dark()


def _accuracy(game, w: ItemDef, evade: float, distance: int = 1) -> float:
    p = game.player
    acc = 72 + w.accuracy + 3 * p.style_rank(w.style)
    if w.is_ranged:
        acc += p.mod("ranged_acc") - max(0, distance - 2) * 2.5
    elif p.fracture:
        acc -= 4
    if p.panic >= 75:
        acc -= 16
    elif p.panic >= 50:
        acc -= 8
    if p.stamina < STAMINA_PER_ATTACK + 1:
        acc -= 12
    if "arm" in p.lost:
        acc -= 20 if w.is_ranged else 14
    if game.is_dark() and not player_lit(game):
        acc -= 8
    return clamp(acc - evade, 12, 96)


def _head_chance(game, w: ItemDef) -> float:
    p = game.player
    base = 0.15 + w.head + 0.02 * p.style_rank(w.style)
    base += p.mod("head_ranged") if w.is_ranged else p.mod("head_melee")
    if w.style == "blunt":
        base += 0.08
    return clamp(base, 0.0, 0.85)


def _damage(game, w: ItemDef, item: Optional[Item], sneak: bool) -> float:
    p = game.player
    raw = game.rng.randint(*w.dmg)
    mult = 1.0 + 0.04 * p.style_rank(w.style)
    if not w.is_ranged:
        mult += p.mod("melee_dmg")
        if "arm" in p.lost:
            mult *= 0.6
    if item is not None and w.durability and (item.dur or 0) < w.durability * 0.25:
        mult *= 0.8
    if p.stamina < STAMINA_PER_ATTACK + 1:
        mult *= 0.75
    if p.hunger >= 75:
        mult *= 0.85
    if sneak and not w.is_ranged:
        mult *= SNEAK_STAB
    return raw * mult


def _wear_weapon(game, item: Optional[Item], w: ItemDef) -> None:
    if item is None or not w.durability:
        return
    if game.rng.random() < game.player.mod("dur_save"):
        return
    item.dur = (item.dur or 1) - 1
    if item.dur <= 0:
        game.player.weapon = None
        game.msg(f"Your {w.name} breaks!", "bad", key=True)


def _train(game, w: ItemDef, amount: int = 1) -> None:
    p = game.player
    before = p.style_rank(w.style)
    p.style_xp[w.style] = p.style_xp.get(w.style, 0) + amount
    if p.style_rank(w.style) > before:
        game.msg(f"Your skill with {w.style} weapons improves.", "good")


# ------------------------------------------------------------------ player attacks
def zombie_damage(game, z: Zombie, raw: float, head: bool, style: str = "", fire: bool = False) -> int:
    """Damage a blow does to a zombie, honouring the preset's kill rule."""
    profile = game.profile
    dmg = raw
    if head:
        dmg *= 3.0 if profile.kill_rule == "head" else 2.0
    else:
        if profile.kill_rule == "head":
            dmg *= 0.5
        if "tough" in z.flags:
            dmg *= 0.6
    if fire and profile.weakness in ("fire", "light"):
        dmg *= 2.0
    elif style == "energy" and profile.weakness == "light":
        dmg *= 1.3
    return max(1, int(round(dmg)))


def hurt_zombie(game, z: Zombie, raw: float, head: bool, style: str = "", fire: bool = False) -> int:
    """The player hurts a zombie.  Returns the damage dealt."""
    dealt = zombie_damage(game, z, raw, head, style, fire)
    z.hp -= dealt
    if z.hp <= 0:
        kill_zombie(game, z, head=head)
    else:
        z.state = "hunt"
        z.target = game.player.pos
        z.stimulus_turn = game.clock.turn
    return dealt


def kill_zombie(game, z: Zombie, head: bool = False, by_player: bool = True, killer=None) -> None:
    level = game.level
    lives.grant_xp(game, killer, z.xp)
    level.remove_actor(z)
    level.corpses[z.pos] = (game.clock.turn, z.fresh_human)
    for item in z.carries:
        level.drop(z.pos, item)
    if by_player:
        game.note_assist(z.pos)
        p = game.player
        p.kills += 1
        p.bump("zombies")
        levels = p.gain_xp(z.xp)
        p.panic = max(0.0, p.panic - 1.0)
        if levels:
            game.msg(f"You reach level {p.level}! (+1 perk point)", "good")
        if p.stats.get("zombies", 0) % 25 == 0:
            game._chronicle(f"{p.stats['zombies']} of the dead put down for good.")
        if "boss" in z.flags:
            game._chronicle(f"You brought down the {z.name.lower()}.")
    if "explodes" in z.flags:
        burst(game, z.pos)
    if "boss" in z.flags and z.special == "stalker":
        game.on_stalker_killed()
    if by_player or z.pos in game.visible:
        game.msg(f"The {z.name.lower()} {'collapses' if head else 'goes down'}.", "combat")


def burst(game, pos) -> None:
    """A bloater pops: a cloud of spores that infects the careless."""
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            p = (pos[0] + dx, pos[1] + dy)
            if game.level.walkable(*p) and dx * dx + dy * dy <= 5:
                game.level.hazards[p] = Hazard("spore", 9)
    game.msg("The bloater bursts in a cloud of spores!", "warn")
    game.emit_noise(pos, 6, "zombie")


def attack_noise(game, w: ItemDef, silent: bool) -> int:
    """How far a blow carries.  A fight is loud and bone is louder; a stealth strike on someone who has not noticed you is not."""
    p = game.player
    base = w.noise + (game.item_def(p.armor.id).stealth if p.armor else 0)
    if not w.is_ranged:
        base *= 1.5 * (1.3 if w.style == "blunt" else 1.0)
    if silent:
        base *= 0.5
    return max(1, int(round(base)))


def _drop_cover(game) -> None:
    p = game.player
    if p.sneaking:
        p.sneaking = False
        game.msg("You stand up to fight: you are no longer sneaking.", "info")


def _sneak_ok(game, z: Zombie) -> bool:
    """True when the zombie has not noticed the player."""
    return z.state != "hunt" and z.alert < 70            # it has not noticed you (yet)


def player_attack(game, target: Actor) -> bool:
    """Melee (or polearm) attack.  Returns True if a turn was spent."""
    p = game.player
    w = weapon_def(game)
    if w.is_ranged:                                         # bashing with a gun
        w = FISTS
        item = None
        game.msg("You club it with the butt of your weapon.", "info")
    else:
        item = p.weapon if w is not FISTS else None
    d = cheb(p.pos, target.pos)
    if d > w.reach or (d > 1 and not has_los(game.level, p.pos, target.pos)):
        return False
    p.stamina = max(0.0, p.stamina - STAMINA_PER_ATTACK)
    # judge surprise *before* making noise: the blow itself must not give you away
    sneak = isinstance(target, Zombie) and _sneak_ok(game, target)
    unaware = isinstance(target, Animal) and p.sneaking and not target.alert      # a stalked animal never saw it coming
    game.emit_noise(p.pos, attack_noise(game, w, sneak), "player")
    if not (sneak or unaware):
        _drop_cover(game)                                   # a fair fight is not a stealth strike
    if isinstance(target, Human):
        return _attack_human(game, target, w, item)
    if isinstance(target, Animal):
        done = wild.attack(game, target, unaware, _accuracy(game, w, 0), _damage(game, w, item, False))
        _wear_weapon(game, item, w)
        _train(game, w)
        return done
    z: Zombie = target
    if sneak:
        hit = game.rng.random() < SNEAK_HIT                  # a blow from behind can still go wrong
    else:
        hit = game.rng.random() * 100 < _accuracy(game, w, 0)
    if not hit:
        game.msg(f"You swing at the {z.name.lower()} and miss.", "combat")
        z.state, z.target, z.stimulus_turn = "hunt", p.pos, game.clock.turn
        return True
    head = game.rng.random() < (SNEAK_HEAD if sneak else _head_chance(game, w))
    dmg = hurt_zombie(game, z, _damage(game, w, item, sneak), head, w.style)
    _wear_weapon(game, item, w)
    _train(game, w)
    if z.hp > 0:
        verb = "stab" if w.style in ("blade", "polearm") else "smash" if w.style == "blunt" else "hit"
        game.msg(f"You {verb} the {z.name.lower()}{' in the head' if head else ''} for {dmg}.", "combat")
    elif sneak:
        game.msg("A silent kill.", "good")
    return True


def _attack_human(game, h: Human, w: ItemDef, item: Optional[Item]) -> bool:
    if not h.hostile:
        game.make_hostile(h)
    if game.rng.random() * 100 >= _accuracy(game, w, 8):
        game.msg("You miss.", "combat")
        return True
    dmg = max(1, int(_damage(game, w, item, False)))
    h.hp -= dmg
    _wear_weapon(game, item, w)
    _train(game, w)
    if h.hp <= 0:
        kill_human(game, h)
    else:
        game.msg(f"You hit the {h.name.lower()} for {dmg}.", "combat")
    return True


def kill_human(game, h: Human) -> None:
    level = game.level
    raiders.shaken(game, h)
    companion.on_death(game, h, "you")
    companion.on_player_kills_human(game, h)
    memory.on_kill_human(game, h)
    level.remove_actor(h)
    level.corpses[h.pos] = (game.clock.turn, True)
    for item in h.loot:
        level.drop(h.pos, item)
    if h.hostile and h.role == "raider":
        game.note_assist(h.pos)
    game.player.gain_xp(12)
    game.player.bump("humans")
    game.msg(f"The {h.name.lower()} falls.", "combat")
    if not h.hostile or h.role != "raider":
        game.adjust_humanity(-12, "You killed someone who was not trying to kill you.")


def player_fire(game, target: Actor) -> bool:
    """Ranged attack with the equipped weapon.  Returns True if a turn was spent."""
    p = game.player
    w = weapon_def(game)
    item = p.weapon
    if not w.is_ranged:
        game.msg("You have no ranged weapon equipped.", "warn")
        return False
    d = cheb(p.pos, target.pos)
    if d > w.reach:
        game.msg("Out of range.", "warn")
        return False
    if not has_los(game.level, p.pos, target.pos):
        game.msg("No clear line of fire.", "warn")
        return False
    if w.ammo and p.count(w.ammo) < 1:
        game.msg(f"Out of {game.item_def(w.ammo).name.lower()}.", "warn")
        return False
    if w.ammo and game.rng.random() >= p.mod("ammo_save"):
        p.take(w.ammo, 1)
    p.stamina = max(0.0, p.stamina - 2)
    noise = max(1, int(w.noise * (1.0 + p.mod("ranged_noise"))))
    game.emit_noise(p.pos, noise, "player")
    if isinstance(target, Human):
        if not target.hostile:
            game.make_hostile(target)
        evade, sneak = 8, False
    else:
        evade, sneak = 0, _sneak_ok(game, target)
    if not sneak:
        _drop_cover(game)
    hit = game.rng.random() * 100 < _accuracy(game, w, evade, d) + (12 if sneak else 0)
    _wear_weapon(game, item, w)
    _train(game, w)
    if not hit:
        game.msg(f"Your shot misses the {target.name.lower()}.", "combat")
        if isinstance(target, Zombie):
            target.state, target.target, target.stimulus_turn = "hunt", p.pos, game.clock.turn
        return True
    if isinstance(target, Human):
        dmg = max(1, int(_damage(game, w, item, False)))
        target.hp -= dmg
        if target.hp <= 0:
            kill_human(game, target)
        else:
            game.msg(f"You hit the {target.name.lower()} for {dmg}.", "combat")
        return True
    head = game.rng.random() < _head_chance(game, w) + (0.2 if sneak else 0.0)
    dmg = hurt_zombie(game, target, _damage(game, w, item, False), head, w.style)
    if target.hp > 0:
        game.msg(f"You shoot the {target.name.lower()}{' in the head' if head else ''} for {dmg}.", "combat")
    return True


# ------------------------------------------------------------------ throwables
def throw(game, item_id: str, pos) -> bool:
    p = game.player
    d = game.item_def(item_id)
    reach = 8
    if cheb(p.pos, pos) > reach or not has_los(game.level, p.pos, pos):
        game.msg("You cannot throw it there.", "warn")
        return False
    p.take(item_id, 1)
    eff = d.effect
    if eff.get("fire"):
        game.msg(f"The {d.name.lower()} bursts into flames!", "info")
        radius = int(eff.get("radius", 1))
        lo, hi = eff.get("damage", (8, 14))
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                q = (pos[0] + dx, pos[1] + dy)
                if not game.level.walkable(*q) or game.level.tile(*q) in (T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN):
                    continue
                game.level.hazards[q] = Hazard("fire", 8)
                victim = game.level.actor_at(*q)
                if isinstance(victim, Zombie):
                    hurt_zombie(game, victim, game.rng.randint(lo, hi), False, "fire", fire=True)
                elif isinstance(victim, Human):
                    victim.hp -= game.rng.randint(lo, hi)
                    if victim.hp <= 0:
                        kill_human(game, victim)
        game.emit_noise(pos, 8, "player")
    elif eff.get("blast"):
        game.msg(f"The {d.name.lower()} goes off in a spray of nails!", "info")
        radius = int(eff.get("radius", 2))
        lo, hi = eff.get("damage", (10, 16))
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                q = (pos[0] + dx, pos[1] + dy)
                victim = game.level.actor_at(*q) if game.level.in_bounds(*q) else None
                if isinstance(victim, Zombie) and has_los(game.level, pos, q):
                    hurt_zombie(game, victim, game.rng.randint(lo, hi), game.rng.random() < 0.3, "blade")
                elif isinstance(victim, Human) and has_los(game.level, pos, q):
                    victim.hp -= game.rng.randint(lo, hi)
                    if victim.hp <= 0:
                        kill_human(game, victim)
        if cheb(p.pos, pos) <= radius:
            game.msg("The nails reach you too.", "bad")
            damage_player(game, game.rng.randint(lo, hi) // 2, "caught in your own nail bomb")
        game.emit_noise(pos, int(eff.get("noise", 16)), "player")
    elif eff.get("noise"):
        game.msg(f"The {d.name.lower()} clatters and screams where it lands.", "info")
        game.emit_noise(pos, int(eff["noise"]), "decoy")
    return True


# ------------------------------------------------------------------ enemy attacks
def damage_player(game, amount: int, cause: str, by=None) -> None:
    p = game.player
    game.killer = by
    if p.sneaking and amount > 0:
        p.sneaking = False
        game.msg("You are hit: you cannot stay hidden.", "info")
    p.hp -= amount
    game.add_panic(3 + amount * 0.4)
    if p.hp <= 0:
        game.end("dead", cause)
    else:
        companion.on_player_hurt(game, amount)


def pick_limb(rng) -> str:
    roll = rng.random() * sum(w for _, w in LIMBS)
    for limb, weight in LIMBS:
        roll -= weight
        if roll <= 0:
            return limb
    return "arm"


def infect(game, source: str = "bite") -> None:
    """The infection takes hold (or progresses if you already carry it)."""
    p = game.player
    profile = game.profile
    if p.infected:
        p.infection_timer = max(1, p.infection_timer - 40)
        game.msg("Another wound feeds the infection. The clock runs faster.", "bad", key=True)
        return
    p.infected = True
    p.infection_timer = max(10, int(profile.incubation * game.diff.timer))
    limb = pick_limb(game.rng)
    p.bite_limb = "lungs" if source == "spore" else ("torso" if limb in p.lost else limb)
    window = max(8, min(30, profile.incubation // 3)) + int(p.mod("surgeon"))
    p.bite_window = window if p.bite_limb in ("arm", "leg") else 0
    if source == "spore":
        game.msg("You breathe in the spores. You are infected.", "bad", key=True)
    else:
        game.msg(f"You have been bitten ({p.bite_limb})! You are infected.", "bad", key=True)
        if p.bite_window:
            game.msg(f"Cutting it off might save you - but only for the next {p.bite_window} turns (X).", "warn")
    game.add_panic(25)


def zombie_attack(game, z: Zombie) -> None:
    p = game.player
    profile = game.profile
    if game.rng.random() * 100 >= clamp(z.acc - p.evade, 15, 92):
        game.msg(f"The {z.name.lower()} lunges and misses.", "combat")
        return
    armor = game.item_def(p.armor.id) if p.armor else None
    raw = game.rng.randint(*z.dmg) * game.diff.damage
    dmg = max(1, int(round(raw - (armor.defense if armor else 0))))
    if armor and p.armor.dur is not None:
        p.armor.dur -= 1
        if p.armor.dur <= 0:
            game.msg(f"Your {armor.name.lower()} falls apart!", "bad")
            p.armor = None
    game.msg(f"The {z.name.lower()} hits you for {dmg}.", "bad")
    damage_player(game, dmg, f"torn apart by {article(z.name)} {z.name.lower()}", z)
    if not p.alive:
        return
    guard = armor.bite_guard if armor else 0.0
    chance = profile.infect * (1.0 - guard) * (1.0 - p.mod("infect_resist"))
    if profile.vector == "spore":
        chance *= 0.5
    if game.rng.random() < chance:
        infect(game, "bite")
    if dmg >= 4 and game.rng.random() < 0.2 * (1.0 - p.mod("bleed_resist")):
        p.bleeding = min(3, p.bleeding + 1)
        game.msg("You are bleeding.", "bad")
    if ("breaker" in z.flags or "cripples" in z.flags) and not p.fracture and game.rng.random() < 0.2:
        p.fracture = True
        game.msg("Something snaps. Your leg is broken!", "bad", key=True)


def human_attack(game, h: Human) -> None:
    p = game.player
    d = cheb(h.pos, p.pos)
    if d > 1:
        if game.era.firearms:
            game.emit_noise(h.pos, 18, "zombie")
        else:
            game.emit_noise(h.pos, 4, "zombie")
    if game.rng.random() * 100 >= clamp(h.acc - p.evade - (d - 1) * 2, 12, 90):
        game.msg(f"The {h.name.lower()} {'shoots' if d > 1 else 'swings'} and misses.", "combat")
        return
    armor = game.item_def(p.armor.id) if p.armor else None
    dmg = max(1, int(round(game.rng.randint(*h.dmg) * game.diff.damage - (armor.defense if armor else 0))))
    game.msg(f"The {h.name.lower()} hits you for {dmg}.", "bad")
    damage_player(game, dmg, f"killed by {article(h.name)} {h.name.lower()}", h)


# ------------------------------------------------------------------ everyone else's fights
def _seen(game, *actors) -> bool:
    return any(a.pos in game.visible for a in actors)


def ref(a: Actor) -> str:
    """How the log names someone: a companion by name, anyone else as 'the zombie'."""
    return a.name if (getattr(a, "trait", "") or getattr(a, "pet", False)) else f"the {a.name.lower()}"


def Ref(a: Actor) -> str:
    r = ref(a)
    return r[0].upper() + r[1:]


def attack_actor(game, attacker: Actor, defender: Actor, ranged: bool = False) -> None:
    """One actor (zombie or human) strikes another that is not the player."""
    d = cheb(attacker.pos, defender.pos)
    if ranged and d > 1:
        game.emit_noise(attacker.pos, 18 if game.era.firearms else 4, "fight")
        if getattr(attacker, "gear_weapon", None) is not None:
            companion.use_ammo(game, attacker)
    victim = ref(defender)
    tag = "ally" if (getattr(attacker, "trait", "") or getattr(attacker, "pet", False) or getattr(defender, "trait", "") or getattr(defender, "pet", False)) else "combat"
    if game.rng.random() * 100 >= clamp(attacker.acc - 8 - max(0, d - 1) * 2, 12, 90):
        if _seen(game, attacker, defender):
            game.msg(f"{Ref(attacker)} {'shoots' if ranged and d > 1 else 'strikes'} at {victim} and misses.", tag)
        return
    raw = game.rng.randint(*attacker.dmg)
    if (getattr(defender, "trait", "") or getattr(defender, "pet", False)) and companion.early_grace(game):
        raw = max(1, int(raw * companion.GRACE_DAMAGE))                       # the first days go easy on your people
    if getattr(defender, "gear_armor", None) is not None:
        raw = max(1, raw - game.item_def(defender.gear_armor.id).defense)      # what you handed them to wear
    if isinstance(defender, Zombie):
        head = game.rng.random() < (0.25 if ranged else 0.2)
        dealt = zombie_damage(game, defender, raw, head)
        defender.hp -= dealt
        if defender.hp <= 0:
            kill_zombie(game, defender, head=head, by_player=False, killer=attacker)
            if isinstance(attacker, Human) and attacker.trait:
                companion.on_ally_kill(game, attacker, defender)
            elif isinstance(attacker, Animal) and attacker.pet:
                pets.on_kill(game, attacker, defender)
            return
        defender.state, defender.target, defender.stimulus_turn = "hunt", attacker.pos, game.clock.turn
        if _seen(game, attacker, defender):
            game.msg(f"{Ref(attacker)} hits {victim}.", tag)
        return
    defender.hp -= raw
    if isinstance(defender, Animal):                                         # a pet the dead have caught
        if defender.hp <= 0:
            pets.on_death(game, defender, attacker)
            return
        if defender.pet:
            pets.on_hurt(game, defender)
        if _seen(game, attacker, defender):
            game.msg(f"{Ref(attacker)} bites {victim}.", tag)
        return
    if defender.hp <= 0:
        kill_human_other(game, defender, attacker)
        return
    if isinstance(defender, Human):
        if defender.state not in ("follow", "wait"):
            defender.state, defender.target = "hunt", attacker.pos
        _distress(game, defender)
        if defender.trait:
            companion.on_hurt(game, defender)
    if _seen(game, attacker, defender):
        game.msg(f"{Ref(attacker)} {'bites' if isinstance(attacker, Zombie) else 'hits'} {victim}.", tag)


def _distress(game, h: Human) -> None:
    """A patrol under attack calls for help; if you hear it and answer, they will remember."""
    if h.role not in ("scout", "soldier") or not h.group or game.level is not game.world.level:
        return
    t = game.clock.turn
    last = game.distress.get(h.group)
    if last is not None and t - last < 200:
        return
    game.distress[h.group] = t
    p = game.player
    if h.pos not in game.visible:
        game.msg(f"You hear a call for help to the {compass(h.x - p.x, h.y - p.y)}: a patrol is under attack.", "warn")


def kill_human_other(game, h: Human, killer: Actor) -> None:
    """A human dies to something other than the player.  Zombie victims rise again."""
    level = game.level
    raiders.shaken(game, h)
    companion.on_death(game, h, killer)
    lives.grant_xp(game, killer, 12)
    level.remove_actor(h)
    level.corpses[h.pos] = (game.clock.turn, 2 if isinstance(killer, Zombie) else True)
    for item in h.loot:
        level.drop(h.pos, item)
    if _seen(game, h, killer):
        if isinstance(killer, Zombie):
            game.msg(f"{Ref(killer)} drags {ref(h)} down.", "bad")
        else:
            game.msg(f"{Ref(h)} falls to {ref(killer)}.", "combat")


# ------------------------------------------------------------------ surgery
def can_amputate(game) -> Optional[str]:
    """Reason you cannot amputate, or None if you can."""
    p = game.player
    if not p.infected:
        return "You are not infected."
    if p.bite_limb not in ("arm", "leg"):
        return "The infection is not in a limb you can remove."
    if p.bite_window <= 0:
        return "Too late: it has already spread."
    if p.bite_limb in p.lost:
        return "That limb is already gone."
    carried = ([p.weapon] if p.weapon else []) + p.inventory
    has_blade = any(game.item_def(i.id).kind == "weapon" and game.item_def(i.id).style == "blade" for i in carried)
    if not has_blade:
        return "You need a blade."
    return None


def amputation_shock(game) -> int:
    """Health the cut will cost.  The second limb is far worse than the first."""
    p = game.player
    base = 29 * (1.0 + 0.8 * len(p.lost))
    return max(10, int(base - p.mod("surgeon") * 0.6))


def amputate(game) -> bool:
    reason = can_amputate(game)
    if reason:
        game.msg(reason, "warn")
        return False
    p = game.player
    limb = p.bite_limb
    shock = int(amputation_shock(game) + game.rng.randint(-5, 5))
    p.infected = False
    p.infection_timer = 0
    p.bite_window = 0
    p.lost.append(limb)
    p.bump("amputations")
    game.emit_noise(p.pos, 9, "player")
    game.add_panic(max(10.0, 45.0 - 4.0 * p.mod("surgeon") / 8))
    p.max_hp = max(20, p.max_hp - 10)                 # blood, nerve and strength do not come back
    p.max_stamina = max(40.0, p.max_stamina - 25.0)
    p.sprinting = False
    if p.hp <= shock:
        p.hp = 0
        game.msg(f"You cut off your {limb}. The pain and the blood are too much. Everything goes white.", "bad", key=True)
        game.end("dead", f"went into shock after cutting off your {limb}")
        return True
    p.hp -= shock
    p.hemorrhage = True
    p.bleeding = 3
    p.hp = min(p.hp, p.max_hp)
    game.msg(f"You cut off your {limb}. The infection goes with it, and so does a great deal of blood. "
             "It will not stop by itself: bind it now.", "warn", key=True)
    return True

# ------------------------------------------------------------------ shoving
PUSH_STAMINA = 8
NO_KNOCKBACK = (T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN)


def pushable(game) -> list:
    """Hostiles within arm's reach, nearest first."""
    p = game.player
    out = [a for a in game.level.actors if a.hp > 0 and cheb(a.pos, p.pos) == 1
           and (isinstance(a, Zombie) or (isinstance(a, Human) and a.hostile))]
    return out


def push(game, target) -> bool:
    """Shove something away: it staggers back a tile (two if you are strong and it is light) and loses a turn or two.  Good
    for making room, for steering the dead onto a trap or into a fire, for breaking off.  Returns True if a turn was spent."""
    p, lv = game.player, game.level
    if cheb(p.pos, target.pos) != 1:
        return False
    if p.stamina < PUSH_STAMINA:
        game.msg("You are too winded to shove anything.", "warn")
        return False
    p.stamina -= PUSH_STAMINA
    game.emit_noise(p.pos, 3, "player")
    name = target.name.lower()
    resist = 0.0
    if isinstance(target, Zombie):
        if "boss" in target.flags:
            game.msg(f"The {name} does not budge.", "warn")
            return True
        resist = 0.45 if target.special == "brute" else 0.0
    chance = (0.9 - resist) * (0.7 if "arm" in p.lost else 1.0)
    if game.rng.random() >= chance:
        game.msg(f"You shove the {name}, but it holds its ground.", "info")
        return True
    dx, dy = (target.x > p.x) - (target.x < p.x), (target.y > p.y) - (target.y < p.y)
    reach = 2 if p.level >= 4 and resist == 0.0 else 1
    moved = 0
    for _ in range(reach):
        nx, ny = target.x + dx, target.y + dy
        if lv.free(nx, ny) and lv.tile(nx, ny) not in NO_KNOCKBACK:
            lv.move_actor(target, nx, ny)
            moved += 1
        else:
            break
    target.stun = 2 + (1 if moved < reach else 0)
    if isinstance(target, Zombie) and target.state != "hunt":
        target.state, target.target, target.stimulus_turn = "hunt", p.pos, game.clock.turn
        target.alert = 100.0
    if moved < reach:                                          # something solid behind it
        hurt = game.rng.randint(2, 4)
        target.hp -= hurt
        game.msg(f"You slam the {name} into something solid.", "good")
        if target.hp <= 0:
            if isinstance(target, Zombie):
                kill_zombie(game, target, by_player=True)
            else:
                kill_human(game, target)
        return True
    game.msg(f"You shove the {name} back. It staggers.", "good")
    return True
