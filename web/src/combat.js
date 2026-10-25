// ---------------------------------------------------------------- combat, injuries and infection
const FISTS = { id: 'fists', name: 'Fists', kind: 'weapon', style: 'unarmed', dmg: [1, 3], noise: 2, reach: 1,
                durability: 0, accuracy: 0, head: 0, ammo: '', stealth: 0, defense: 0, bite_guard: 0 };
const LIMBS = [['arm', 41], ['leg', 41], ['torso', 15], ['neck', 3]];
const STAMINA_PER_ATTACK = 4;
const is_zombie = (a) => a && a.kind === 'zombie';
const is_human = (a) => a && a.kind === 'human';
const apos = (a) => [a.x, a.y];

// Bows, polearms and heavy long guns cannot be used with one arm.
const needs_both_arms = (d) => d.style === 'bow' || d.style === 'polearm' || ((d.style === 'firearm' || d.style === 'energy') && d.dmg[1] >= 14);
function weapon_def(game) {
  const w = game.player.weapon;
  if (!w) return FISTS;
  const d = game.item_def(w.id);
  return game.player.lost.includes('arm') && needs_both_arms(d) ? FISTS : d;      // you cannot work it one-handed
}
function player_lit(game) {
  const p = game.player;
  return !!p.light && p.light_on && (p.light.dur || 0) > 0 && game.is_dark();
}

function _accuracy(game, w, evade, distance = 1) {
  const p = game.player;
  let acc = 72 + w.accuracy + 3 * p.style_rank(w.style);
  if (is_ranged(w)) acc += p.mod('ranged_acc') - Math.max(0, distance - 2) * 2.5;
  else if (p.fracture) acc -= 4;
  if (p.panic >= 75) acc -= 16; else if (p.panic >= 50) acc -= 8;
  if (p.stamina < STAMINA_PER_ATTACK + 1) acc -= 12;
  if (p.lost.includes('arm')) acc -= is_ranged(w) ? 20 : 14;
  if (game.is_dark() && !player_lit(game)) acc -= 8;
  return clamp(acc - evade, 12, 96);
}

function _head_chance(game, w) {
  const p = game.player;
  let base = 0.15 + w.head + 0.02 * p.style_rank(w.style);
  base += is_ranged(w) ? p.mod('head_ranged') : p.mod('head_melee');
  if (w.style === 'blunt') base += 0.08;
  return clamp(base, 0.0, 0.85);
}

const SNEAK_HIT = 0.85, SNEAK_HEAD = 0.6, SNEAK_STAB = 1.75;       // a creeping strike: how often it lands, finds the head, and its weight
function _damage(game, w, item, sneak) {
  const p = game.player;
  const raw = game.rng.randint(w.dmg[0], w.dmg[1]);
  let mult = 1.0 + 0.04 * p.style_rank(w.style);
  if (!is_ranged(w)) { mult += p.mod('melee_dmg'); if (p.lost.includes('arm')) mult *= 0.6; }
  if (item && w.durability && (item.dur || 0) < w.durability * 0.25) mult *= 0.8;
  if (p.stamina < STAMINA_PER_ATTACK + 1) mult *= 0.75;
  if (p.hunger >= 75) mult *= 0.85;
  if (sneak && !is_ranged(w)) mult *= SNEAK_STAB;
  return raw * mult;
}

function _wear_weapon(game, item, w) {
  if (!item || !w.durability) return;
  if (game.rng.random() < game.player.mod('dur_save')) return;
  item.dur = (item.dur || 1) - 1;
  if (item.dur <= 0) { game.player.weapon = null; game.msg(`Your ${w.name} breaks!`, 'bad', true); }
}

function _train(game, w, amount = 1) {
  const p = game.player, before = p.style_rank(w.style);
  p.style_xp[w.style] = (p.style_xp[w.style] || 0) + amount;
  if (p.style_rank(w.style) > before) game.msg(`Your skill with ${w.style} weapons improves.`, 'good');
}

function zombie_damage(game, z, raw, head, style = '', fire = false) {
  const profile = game.profile;
  let dmg = raw;
  if (head) dmg *= profile.kill_rule === 'head' ? 3.0 : 2.0;
  else {
    if (profile.kill_rule === 'head') dmg *= 0.5;
    if (z.flags.includes('tough')) dmg *= 0.6;
  }
  if (fire && (profile.weakness === 'fire' || profile.weakness === 'light')) dmg *= 2.0;
  else if (style === 'energy' && profile.weakness === 'light') dmg *= 1.3;
  return Math.max(1, Math.round(dmg));
}

function hurt_zombie(game, z, raw, head, style = '', fire = false) {
  const dealt = zombie_damage(game, z, raw, head, style, fire);
  z.hp -= dealt;
  if (z.hp <= 0) kill_zombie(game, z, head);
  else { sfx(game, 'fleshy', apos(z)); z.state = 'hunt'; z.target = apos(game.player); z.stimulus_turn = game.clock.turn; }
  return dealt;
}

function kill_zombie(game, z, head = false, by_player = true, killer = null) {
  const level = game.level;
  sfx(game, 'kill', apos(z));
  grant_xp(game, killer, z.xp);
  level.remove_actor(z);
  level.corpses[level.idx(z.x, z.y)] = [game.clock.turn, z.fresh_human];
  for (const item of z.carries) level.drop(apos(z), item);
  if (by_player) {
    game.note_assist(apos(z));
    const p = game.player;
    p.kills++; p.bump('zombies');
    const levels = p.gain_xp(z.xp);
    p.panic = Math.max(0, p.panic - 1.0);
    if (levels) game.msg(`You reach level ${p.level}! (+1 perk point)`, 'good');
    if ((p.stats.zombies || 0) % 25 === 0) game._chronicle(`${p.stats.zombies} of the dead put down for good.`);
    if (z.flags.includes('boss')) game._chronicle(`You brought down the ${z.name.toLowerCase()}.`);
  }
  if (z.flags.includes('explodes')) burst(game, apos(z));
  if (z.flags.includes('boss') && z.special === 'stalker') game.on_stalker_killed();
  if (by_player || game.is_visible(z.x, z.y)) game.msg(`The ${z.name.toLowerCase()} ${head ? 'collapses' : 'goes down'}.`, 'combat');
}

function burst(game, pos) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = pos[0] + dx, y = pos[1] + dy;
    if (game.level.walkable(x, y) && dx * dx + dy * dy <= 5) game.level.hazards[game.level.idx(x, y)] = { kind: 'spore', ttl: 9 };
  }
  game.msg('The bloater bursts in a cloud of spores!', 'warn');
  game.emit_noise(pos, 6, 'zombie');
}

// How far a blow carries. A fight is loud and bone is louder; a stealth strike on someone who has not noticed you is not.
function attack_noise(game, w, silent) {
  const p = game.player;
  let base = w.noise + (p.armor ? game.item_def(p.armor.id).stealth : 0);
  if (!is_ranged(w)) base *= 1.5 * (w.style === 'blunt' ? 1.3 : 1.0);
  if (silent) base *= 0.5;
  return Math.max(1, Math.round(base));
}
function _drop_cover(game) {
  const p = game.player;
  if (p.sneaking) { p.sneaking = false; game.msg('You stand up to fight: you are no longer sneaking.', 'info'); }
}

function _sneak_ok(game, z) {
  return z.state !== 'hunt' && (z.alert || 0) < STAB_OK;      // it has not noticed you (yet)
}

function player_attack(game, target) {
  const p = game.player;
  let w = weapon_def(game), item;
  if (is_ranged(w)) { w = FISTS; item = null; game.msg('You club it with the butt of your weapon.', 'info'); }
  else item = w !== FISTS ? p.weapon : null;
  const d = cheb(apos(p), apos(target));
  if (d > w.reach || (d > 1 && !has_los(game.level, apos(p), apos(target)))) return false;
  p.stamina = Math.max(0, p.stamina - STAMINA_PER_ATTACK);
  const sneak = is_zombie(target) && _sneak_ok(game, target);
  const unaware = target.kind === 'animal' && p.sneaking && !target.alert;       // a stalked animal never saw it coming
  game.emit_noise(apos(p), attack_noise(game, w, sneak), 'player');
  if (!(sneak || unaware)) _drop_cover(game);                        // a fair fight is not a stealth strike
  if (is_human(target)) return _attack_human(game, target, w, item);
  if (target.kind === 'animal') { const done = wild_attack(game, target, unaware, _accuracy(game, w, 0), _damage(game, w, item, false)); _wear_weapon(game, item, w); _train(game, w); return done; }
  const z = target;
  const hit = sneak ? game.rng.random() < SNEAK_HIT : game.rng.random() * 100 < _accuracy(game, w, 0);
  if (!hit) {
    sfx(game, 'swing'); game.msg(`You swing at the ${z.name.toLowerCase()} and miss.`, 'combat');
    z.state = 'hunt'; z.target = apos(p); z.stimulus_turn = game.clock.turn;
    return true;
  }
  const head = game.rng.random() < (sneak ? SNEAK_HEAD : _head_chance(game, w));
  const dmg = hurt_zombie(game, z, _damage(game, w, item, sneak), head, w.style);
  _wear_weapon(game, item, w);
  _train(game, w);
  if (z.hp > 0) {
    const verb = (w.style === 'blade' || w.style === 'polearm') ? 'stab' : w.style === 'blunt' ? 'smash' : 'hit';
    game.msg(`You ${verb} the ${z.name.toLowerCase()}${head ? ' in the head' : ''} for ${dmg}.`, 'combat');
  } else if (sneak) game.msg('A silent kill.', 'good');
  return true;
}

function _attack_human(game, h, w, item) {
  if (!h.hostile) game.make_hostile(h);
  if (game.rng.random() * 100 >= _accuracy(game, w, 8)) { game.msg('You miss.', 'combat'); return true; }
  const dmg = Math.max(1, Math.floor(_damage(game, w, item, false)));
  h.hp -= dmg;
  _wear_weapon(game, item, w);
  _train(game, w);
  if (h.hp <= 0) kill_human(game, h); else game.msg(`You hit the ${h.name.toLowerCase()} for ${dmg}.`, 'combat');
  return true;
}

function kill_human(game, h) {
  raiders_shaken(game, h);
  comp_on_death(game, h, 'you');
  comp_on_player_kills_human(game, h);
  memory_on_kill_human(game, h);
  const level = game.level;
  level.remove_actor(h);
  level.corpses[level.idx(h.x, h.y)] = [game.clock.turn, true];
  for (const item of h.loot) level.drop(apos(h), item);
  if (h.hostile && h.role === 'raider') game.note_assist(apos(h));
  game.player.gain_xp(12);
  game.player.bump('humans');
  game.msg(`The ${h.name.toLowerCase()} falls.`, 'combat');
  if (!h.hostile || h.role !== 'raider') game.adjust_humanity(-12, 'You killed someone who was not trying to kill you.');
}

function player_fire(game, target) {
  const p = game.player, w = weapon_def(game), item = p.weapon;
  if (!is_ranged(w)) { game.msg('You have no ranged weapon equipped.', 'warn'); return false; }
  const d = cheb(apos(p), apos(target));
  if (d > w.reach) { game.msg('Out of range.', 'warn'); return false; }
  if (!has_los(game.level, apos(p), apos(target))) { game.msg('No clear line of fire.', 'warn'); return false; }
  if (w.ammo && p.count(w.ammo) < 1) { game.msg(`Out of ${game.item_def(w.ammo).name.toLowerCase()}.`, 'warn'); return false; }
  if (w.ammo && game.rng.random() >= p.mod('ammo_save')) p.take(w.ammo, 1);
  p.stamina = Math.max(0, p.stamina - 2); sfx(game, 'shoot');
  const noise = Math.max(1, Math.floor(w.noise * (1.0 + p.mod('ranged_noise'))));
  game.emit_noise(apos(p), noise, 'player');
  let evade, sneak;
  if (is_human(target)) { if (!target.hostile) game.make_hostile(target); evade = 8; sneak = false; }
  else { evade = 0; sneak = _sneak_ok(game, target); }
  if (!sneak) _drop_cover(game);
  const hit = game.rng.random() * 100 < _accuracy(game, w, evade, d) + (sneak ? 12 : 0);
  _wear_weapon(game, item, w);
  _train(game, w);
  if (!hit) {
    game.msg(`Your shot misses the ${target.name.toLowerCase()}.`, 'combat');
    if (is_zombie(target)) { target.state = 'hunt'; target.target = apos(p); target.stimulus_turn = game.clock.turn; }
    return true;
  }
  if (is_human(target)) {
    const dmg = Math.max(1, Math.floor(_damage(game, w, item, false)));
    target.hp -= dmg;
    if (target.hp <= 0) kill_human(game, target); else game.msg(`You hit the ${target.name.toLowerCase()} for ${dmg}.`, 'combat');
    return true;
  }
  const head = game.rng.random() < _head_chance(game, w) + (sneak ? 0.2 : 0.0);
  const dmg = hurt_zombie(game, target, _damage(game, w, item, false), head, w.style);
  if (target.hp > 0) game.msg(`You shoot the ${target.name.toLowerCase()}${head ? ' in the head' : ''} for ${dmg}.`, 'combat');
  return true;
}

function throw_item(game, item_id, pos) {
  const p = game.player, d = game.item_def(item_id);
  if (cheb(apos(p), pos) > 8 || !has_los(game.level, apos(p), pos)) { game.msg('You cannot throw it there.', 'warn'); return false; }
  p.take(item_id, 1); sfx(game, 'blast', pos);
  const eff = d.effect, lv = game.level;
  if (eff.fire) {
    game.msg(`The ${d.name.toLowerCase()} bursts into flames!`, 'info');
    const radius = eff.radius === undefined ? 1 : eff.radius;
    const [lo, hi] = eff.damage || [8, 14];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = pos[0] + dx, y = pos[1] + dy, t = lv.tile(x, y);
      if (!lv.walkable(x, y) || t === T.PORTAL || t === T.STAIRS_UP || t === T.STAIRS_DOWN) continue;
      lv.hazards[lv.idx(x, y)] = { kind: 'fire', ttl: 8 };
      const victim = lv.actor_at(x, y);
      if (is_zombie(victim)) hurt_zombie(game, victim, game.rng.randint(lo, hi), false, 'fire', true);
      else if (is_human(victim)) { victim.hp -= game.rng.randint(lo, hi); if (victim.hp <= 0) kill_human(game, victim); }
    }
    game.emit_noise(pos, 8, 'player');
  } else if (eff.blast) {
    game.msg(`The ${d.name.toLowerCase()} goes off in a spray of nails!`, 'info');
    const radius = eff.radius === undefined ? 2 : eff.radius;
    const [lo, hi] = eff.damage || [10, 16];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = pos[0] + dx, y = pos[1] + dy;
      const victim = lv.in_bounds(x, y) ? lv.actor_at(x, y) : null;
      if (!victim || !has_los(lv, pos, [x, y])) continue;
      if (is_zombie(victim)) hurt_zombie(game, victim, game.rng.randint(lo, hi), game.rng.random() < 0.3, 'blade');
      else if (is_human(victim)) { victim.hp -= game.rng.randint(lo, hi); if (victim.hp <= 0) kill_human(game, victim); }
    }
    if (cheb(apos(p), pos) <= radius) { game.msg('The nails reach you too.', 'bad'); damage_player(game, Math.floor(game.rng.randint(lo, hi) / 2), 'caught in your own nail bomb'); }
    game.emit_noise(pos, Math.floor(eff.noise || 16), 'player');
  } else if (eff.noise) {
    game.msg(`The ${d.name.toLowerCase()} clatters and screams where it lands.`, 'info');
    game.emit_noise(pos, Math.floor(eff.noise), 'decoy');
  }
  return true;
}

function damage_player(game, amount, cause, by = null) {
  const p = game.player;
  if (game.clock.turn < game.invuln_until) return;               // a new survivor gets a moment to look around
  game.killer = by;
  if (p.sneaking && amount > 0) { p.sneaking = false; game.msg('You are hit: you cannot stay hidden.', 'info'); }
  p.hp -= amount; if (amount > 0) sfx(game, 'hurt');
  game.add_panic(3 + amount * 0.4);
  if (p.hp <= 0) game.end('dead', cause);
  else comp_on_player_hurt(game, amount);
}

function pick_limb(rng) {
  let roll = rng.random() * LIMBS.reduce((s, l) => s + l[1], 0);
  for (const [limb, weight] of LIMBS) { roll -= weight; if (roll <= 0) return limb; }
  return 'arm';
}

function infect(game, source = 'bite') {
  const p = game.player, profile = game.profile;
  if (p.infected) {
    p.infection_timer = Math.max(1, p.infection_timer - 40);
    game.msg('Another wound feeds the infection. The clock runs faster.', 'bad', true);
    return;
  }
  p.infected = true;
  p.infection_timer = Math.max(10, Math.floor(profile.incubation * game.diff.timer));
  const limb = pick_limb(game.rng);
  p.bite_limb = source === 'spore' ? 'lungs' : (p.lost.includes(limb) ? 'torso' : limb);
  const window = Math.max(8, Math.min(30, Math.floor(profile.incubation / 3))) + Math.floor(p.mod('surgeon'));
  p.bite_window = (p.bite_limb === 'arm' || p.bite_limb === 'leg') ? window : 0;
  if (source === 'spore') game.msg('You breathe in the spores. You are infected.', 'bad', true);
  else {
    game.msg(`You have been bitten (${p.bite_limb})! You are infected.`, 'bad', true);
    if (p.bite_window) game.msg(`Cutting it off might save you - but only for the next ${p.bite_window} turns (CUT OFF).`, 'warn');
  }
  game.add_panic(25);
}

function zombie_attack(game, z) {
  const p = game.player, profile = game.profile;
  if (game.clock.turn < game.invuln_until) return;
  if (game.rng.random() * 100 >= clamp(z.acc - p.evade, 15, 92)) { game.msg(`The ${z.name.toLowerCase()} lunges and misses.`, 'combat'); return; }
  if (shield_block(game, z)) return;
  const armor = p.armor ? game.item_def(p.armor.id) : null;
  const raw = game.rng.randint(z.dmg[0], z.dmg[1]) * game.diff.damage;
  const dmg = Math.max(1, Math.round(raw - (armor ? armor.defense : 0)));
  if (armor && p.armor.dur !== null) {
    p.armor.dur -= 1;
    if (p.armor.dur <= 0) { game.msg(`Your ${armor.name.toLowerCase()} falls apart!`, 'bad'); p.armor = null; }
  }
  game.msg(`The ${z.name.toLowerCase()} hits you for ${dmg}.`, 'bad');
  damage_player(game, dmg, `torn apart by ${article(z.name)} ${z.name.toLowerCase()}`, z);
  if (!p.alive) return;
  const guard = armor ? armor.bite_guard : 0.0;
  let chance = profile.infect * (1.0 - guard) * (1.0 - p.mod('infect_resist'));
  if (profile.vector === 'spore') chance *= 0.5;
  if (game.rng.random() < chance) infect(game, 'bite');
  if (dmg >= 4 && game.rng.random() < 0.2 * (1.0 - p.mod('bleed_resist'))) { p.bleeding = Math.min(3, p.bleeding + 1); game.msg('You are bleeding.', 'bad'); }
  if ((z.flags.includes('breaker') || z.flags.includes('cripples')) && !p.fracture && game.rng.random() < 0.2) {
    p.fracture = true; game.msg('Something snaps. Your leg is broken!', 'bad', true);
  }
}

function human_attack(game, h) {
  const p = game.player, d = cheb(apos(h), apos(p));
  if (game.clock.turn < game.invuln_until) return;
  if (d > 1) game.emit_noise(apos(h), game.era.firearms ? 18 : 4, 'zombie');
  if (game.rng.random() * 100 >= clamp(h.acc - p.evade - (d - 1) * 2, 12, 90)) {
    game.msg(`The ${h.name.toLowerCase()} ${d > 1 ? 'shoots' : 'swings'} and misses.`, 'combat'); return;
  }
  if (shield_block(game, h)) return;
  const armor = p.armor ? game.item_def(p.armor.id) : null;
  const dmg = Math.max(1, Math.round(game.rng.randint(h.dmg[0], h.dmg[1]) * game.diff.damage - (armor ? armor.defense : 0)));
  game.msg(`The ${h.name.toLowerCase()} hits you for ${dmg}.`, 'bad');
  damage_player(game, dmg, `killed by ${article(h.name)} ${h.name.toLowerCase()}`, h);
}

// ---------------------------------------------------------------- everyone else's fights
function _seen(game, ...actors) { return actors.some((a) => game.is_visible(a.x, a.y)); }

// One actor (zombie or human) strikes another that is not the player.
// how the log names someone: a companion by name, anyone else as 'the zombie'
const ref = (a) => (a.trait || a.pet ? a.name : `the ${a.name.toLowerCase()}`);
const Ref = (a) => { const r = ref(a); return r[0].toUpperCase() + r.slice(1); };

function attack_actor(game, attacker, defender, ranged = false) {
  const d = cheb(apos(attacker), apos(defender));
  if (ranged && d > 1) { game.emit_noise(apos(attacker), game.era.firearms ? 18 : 4, 'fight'); sfx(game, game.era.firearms ? 'shoot' : 'swing', apos(attacker)); if (attacker.gear_weapon) comp_use_ammo(game, attacker); }
  const victim = ref(defender), tag = (attacker.trait || attacker.pet || defender.trait || defender.pet) ? 'ally' : 'combat';
  if (game.rng.random() * 100 >= clamp(attacker.acc - 8 - Math.max(0, d - 1) * 2, 12, 90)) {
    if (_seen(game, attacker, defender)) game.msg(`${Ref(attacker)} ${ranged && d > 1 ? 'shoots' : 'strikes'} at ${victim} and misses.`, tag);
    return;
  }
  let raw = game.rng.randint(attacker.dmg[0], attacker.dmg[1]);
  if ((defender.trait || defender.pet) && comp_early_grace(game)) raw = Math.max(1, Math.trunc(raw * COMP_GRACE_DAMAGE));      // the first days go easy on your people
  if (defender.gear_armor) raw = Math.max(1, raw - game.item_def(defender.gear_armor.id).defense);      // what you handed them to wear
  if (defender.kind === 'zombie') {
    const head = game.rng.random() < (ranged ? 0.25 : 0.2);
    defender.hp -= zombie_damage(game, defender, raw, head);
    if (defender.hp <= 0) { kill_zombie(game, defender, head, false, attacker); if (attacker.kind === 'human' && attacker.trait) comp_on_ally_kill(game, attacker, defender); else if (attacker.kind === 'animal' && attacker.pet) pets_on_kill(game, attacker, defender); return; }
    defender.state = 'hunt'; defender.target = apos(attacker); defender.stimulus_turn = game.clock.turn;
    if (_seen(game, attacker, defender)) game.msg(`${Ref(attacker)} hits ${victim}.`, tag);
    return;
  }
  defender.hp -= raw;
  if (defender.kind === 'animal') {                                       // a pet the dead have caught
    if (defender.hp <= 0) { pets_on_death(game, defender, attacker); return; }
    if (defender.pet) pets_on_hurt(game, defender);
    if (_seen(game, attacker, defender)) game.msg(`${Ref(attacker)} bites ${victim}.`, tag);
    return;
  }
  if (defender.hp <= 0) { kill_human_other(game, defender, attacker); return; }
  if (defender.kind === 'human' && attacker.kind === 'zombie') npc_bitten(game, attacker, defender);
  if (defender.kind === 'human') {
    if (defender.state !== 'follow' && defender.state !== 'wait') { defender.state = 'hunt'; defender.target = apos(attacker); }
    _distress(game, defender);
    if (defender.trait) comp_on_hurt(game, defender);
  }
  if (_seen(game, attacker, defender)) game.msg(`${Ref(attacker)} ${attacker.kind === 'zombie' ? 'bites' : 'hits'} ${victim}.`, tag);
}

// A patrol under attack calls for help; if you hear it and answer, they will remember.
function _distress(game, h) {
  if ((h.role !== 'scout' && h.role !== 'soldier') || !h.group || game.level !== game.world.level) return;
  const t = game.clock.turn, last = game.distress[h.group];
  if (last !== undefined && t - last < 200) return;
  game.distress[h.group] = t;
  const p = game.player;
  if (!game.is_visible(h.x, h.y)) game.msg(`You hear a call for help to the ${compass(h.x - p.x, h.y - p.y)}: a patrol is under attack.`, 'warn');
}

// A human dies to something other than the player. Victims of the dead rise again (corpse flag 2).
function kill_human_other(game, h, killer) {
  raiders_shaken(game, h);
  { const o = h.outpost && game.saga && game.saga.outposts[h.outpost]; if (o && o.owner === h.faction) o.garrison = Math.max(0, o.garrison - 1); }      // a dead guard is one fewer
  comp_on_death(game, h, killer);
  const level = game.level;
  grant_xp(game, killer, 12);
  level.remove_actor(h);
  level.corpses[level.idx(h.x, h.y)] = [game.clock.turn, killer.kind === 'zombie' ? 2 : 1];
  for (const item of h.loot) level.drop(apos(h), item);
  if (_seen(game, h, killer)) {
    if (killer.kind === 'zombie') game.msg(`${Ref(killer)} drags ${ref(h)} down.`, 'bad');
    else game.msg(`${Ref(h)} falls to ${ref(killer)}.`, 'combat');
  }
}

function can_amputate(game) {
  const p = game.player;
  if (!p.infected) return 'You are not infected.';
  if (p.bite_limb !== 'arm' && p.bite_limb !== 'leg') return 'The infection is not in a limb you can remove.';
  if (p.bite_window <= 0) return 'Too late: it has already spread.';
  if (p.lost.includes(p.bite_limb)) return 'That limb is already gone.';
  const carried = (p.weapon ? [p.weapon] : []).concat(p.inventory);
  if (!carried.some((i) => { const d = game.item_def(i.id); return d.kind === 'weapon' && d.style === 'blade'; })) return 'You need a blade.';
  return null;
}

// Health the cut will cost. The second limb is far worse than the first.
function amputation_shock(game) {
  const p = game.player;
  return Math.max(10, Math.floor(29 * (1.0 + 0.8 * p.lost.length) - p.mod('surgeon') * 0.6));
}

function amputate(game) {
  const reason = can_amputate(game);
  if (reason) { game.msg(reason, 'warn'); return false; }
  const p = game.player, limb = p.bite_limb;
  const shock = Math.floor(amputation_shock(game) + game.rng.randint(-5, 5));
  p.infected = false; p.infection_timer = 0; p.bite_window = 0; p.lost.push(limb);
  p.bump('amputations');
  game.emit_noise(apos(p), 9, 'player');
  game.add_panic(Math.max(10.0, 45.0 - 4.0 * p.mod('surgeon') / 8));
  p.max_hp = Math.max(20, p.max_hp - 10);                // blood, nerve and strength do not come back
  p.max_stamina = Math.max(40, p.max_stamina - 25);
  p.sprinting = false;
  if (p.hp <= shock) {
    p.hp = 0;
    game.msg(`You cut off your ${limb}. The pain and the blood are too much. Everything goes white.`, 'bad', true);
    game.end('dead', `went into shock after cutting off your ${limb}`);
    return true;
  }
  p.hp -= shock; p.hemorrhage = true; p.bleeding = 3; p.hp = Math.min(p.hp, p.max_hp);
  game.msg(`You cut off your ${limb}. The infection goes with it, and so does a great deal of blood. It will not stop by itself: bind it now.`, 'warn', true);
  return true;
}


// ---------------------------------------------------------------- shoving (see engine/combat.py)
const PUSH_STAMINA = 8;
const NO_KNOCKBACK = [T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN];

// hostiles within arm's reach
function pushable(game) {
  const p = game.player;
  return game.level.actors.filter((a) => a.hp > 0 && cheb(apos(a), [p.x, p.y]) === 1 && (a.kind === 'zombie' || (a.kind === 'human' && a.hostile)));
}

function push(game, target) {
  const p = game.player, lv = game.level;
  if (cheb(apos(target), [p.x, p.y]) !== 1) return false;
  if (p.stamina < PUSH_STAMINA) { game.msg('You are too winded to shove anything.', 'warn'); return false; }
  p.stamina -= PUSH_STAMINA;
  game.emit_noise([p.x, p.y], 3, 'player');
  const name = target.name.toLowerCase();
  let resist = 0.0;
  if (target.kind === 'zombie') {
    if (target.flags.includes('boss')) { game.msg(`The ${name} does not budge.`, 'warn'); return true; }
    resist = target.special === 'brute' ? 0.45 : 0.0;
  }
  const chance = (0.9 - resist) * (p.lost.includes('arm') ? 0.7 : 1.0);
  if (game.rng.random() >= chance) { game.msg(`You shove the ${name}, but it holds its ground.`, 'info'); return true; }
  const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y), reach = p.level >= 4 && resist === 0.0 ? 2 : 1;
  let moved = 0;
  for (let i = 0; i < reach; i++) {
    const nx = target.x + dx, ny = target.y + dy;
    if (lv.free(nx, ny) && !NO_KNOCKBACK.includes(lv.tile(nx, ny))) { lv.move_actor(target, nx, ny); moved++; } else break;
  }
  target.stun = 2 + (moved < reach ? 1 : 0);
  if (target.kind === 'zombie' && target.state !== 'hunt') { target.state = 'hunt'; target.target = [p.x, p.y]; target.stimulus_turn = game.clock.turn; target.alert = 100; }
  if (moved < reach) {                                          // something solid behind it
    target.hp -= game.rng.randint(2, 4);
    game.msg(`You slam the ${name} into something solid.`, 'good');
    if (target.hp <= 0) { if (target.kind === 'zombie') kill_zombie(game, target, false, true); else kill_human(game, target); }
    return true;
  }
  game.msg(`You shove the ${name} back. It staggers.`, 'good');
  return true;
}
