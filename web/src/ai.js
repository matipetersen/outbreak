// ---------------------------------------------------------------- behaviour of the living and the dead
const ACTIVE_RADIUS = 45, FIELD_RADIUS = 28, DOOR_HP = 8, LOST_AFTER = 14, FOE_SIGHT = 5, HUMAN_SIGHT = 8;
const FIGHTERS = ['raider', 'scout', 'soldier'];
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

function sight_range(game, z) {
  if (z.flags.includes('blind')) return 0.0;
  const prof = game.profile, p = game.player;
  let r = z.sight;
  if (game.is_dark()) {
    r *= Math.min(1.0, 0.6 * game.era.rules.dead_night) * prof.night_sight;      // sensors and heat vision ignore the dark
    if (player_lit(game)) r = Math.max(r, 6.0) * game.era.rules.lit_visibility;   // a torch is a beacon; cold LEDs much less so
  }
  if (p.sneaking) r *= SNEAK_SIGHT;
  if (game.level.tile(p.x, p.y) === T.BRUSH) r *= game.era.rules.cover;
  if (wild_forest_here(game)) r *= WILD_FOREST_SIGHT;                       // deep woods hide you from the dead
  r *= sight_scale(game) * exposure_of_ground(game);          // weather, and an open road or splashing water
  if (p.disguise_turns > 0 && prof.intel < 2 && (z.uid * 37) % 100 < prof.disguise * 100) r = Math.min(r, 1.5);
  return r;
}

const _unaware = (z) => z.state === 'idle' || z.state === 'dormant' || z.state === 'investigate';
// How much of the zombie's attention the player gets: 1 straight ahead of it, 0.8 at its side, 0.6 right behind it.
function exposure(z, p) {
  const f = z.facing; if (!f) return 1;
  const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
  return 0.8 + 0.2 * (dx * f[0] + dy * f[1]) / (d * Math.hypot(f[0], f[1]));
}
const ALERT_AT = 100, SUSPICIOUS = 40, STAB_OK = 70, SNEAK_GAIN = 0.4, NOTICE_BASE = 36, SNEAK_SIGHT = 0.5;
const awareness_of = (z) => (z.state === 'hunt' ? 'hunting you' : (z.alert || 0) >= STAB_OK ? 'about to notice you' : (z.alert || 0) >= SUSPICIOUS ? 'suspicious' : z.state === 'investigate' ? 'listening' : 'unaware');

function sees_player(game, z) {
  const p = game.player;
  let r = sight_range(game, z);
  if (_unaware(z)) r *= exposure(z, p);                      // an unwary zombie sees poorly over its own shoulder
  if (r <= 0 || dist(apos(z), apos(p)) > r) return false;
  return has_los(game.level, apos(z), apos(p));
}

// A zombie that has not noticed you fills an awareness meter while you are in its sight; it hunts at 100. Closer, running
// and in front of it fill it fast; sneaking and being behind it fill it slowly; out of sight it calms down.
function _notice(game, z, in_sight, d) {
  const p = game.player;
  if (!in_sight) { z.alert = Math.max(0, (z.alert || 0) - 8); return false; }
  const e = exposure(z, p), r = Math.max(1, sight_range(game, z) * e);
  let gain = NOTICE_BASE * (1 + Math.max(0, r - d) / r) * e;
  if (p.sneaking) gain *= SNEAK_GAIN;
  if (p.sprinting) gain *= 1.4;
  z.alert = (z.alert || 0) + gain;
  if (z.alert >= SUSPICIOUS) z.facing = [sign(p.x - z.x), sign(p.y - z.y)];     // it turns to look
  return z.alert >= ALERT_AT;
}

function _perceive(game, z) {
  if (!_unaware(z) || z.flags.includes('blind')) return;
  const p = game.player, d = cheb(apos(z), apos(p));
  const close_enough = z.state !== 'dormant' || d <= Math.max(2.0, sight_range(game, z) * 0.5);
  if (_notice(game, z, sees_player(game, z) && close_enough, d)) {
    _spotted(game, z);
    z.state = 'hunt'; z.target = apos(p); z.stimulus_turn = game.clock.turn; z.alert = ALERT_AT;
  }
}

function speed_now(game, z) {
  let s = z.speed;
  if (game.is_dark()) s *= game.profile.night_speed;
  else if (game.clock.is_day) s *= game.profile.day_speed;
  if (z.state === 'idle') s *= 0.5;
  return s;
}

function ai_run(game) {
  const level = game.level, p = game.player;
  const humans = level.actors.filter((a) => a.kind === 'human' && a.hp > 0 && (FIGHTERS.includes(a.role) || a.state === 'follow' || a.state === 'wait'));      // a companion can be hurt too
  const pets_ = level.actors.filter((a) => a.kind === 'animal' && a.pet && a.hp > 0);
  for (const a of level.actors.slice()) {
    if (a.hp <= 0 || level.occ.get(level.idx(a.x, a.y)) !== a || cheb(apos(a), apos(p)) > ACTIVE_RADIUS) continue;
    if (a.kind === 'zombie') _zombie(game, a, humans.concat(pets_));
    else if (a.kind === 'human') _human(game, a, humans);
    else if (a.kind === 'animal') wild_tick(game, a);
  }
}

function _zombie(game, z, humans) {
  const prof = game.profile, level = game.level;
  if (z.cooldown > 0) z.cooldown -= 1;
  if (z.stun > 0) { z.stun -= 1; return; }                       // shoved: it staggers and loses its turn
  if (prof.sun_burn && level.kind === 'overworld' && game.clock.is_day) {
    z.hp -= 2;
    if (z.hp <= 0) { kill_zombie(game, z, false, false); return; }
  }
  _perceive(game, z);                                  // awareness is checked every tick, not only when it moves
  z.energy += speed_now(game, z);
  let steps = 0;
  while (z.energy >= 1.0 && steps < 3 && z.hp > 0 && level.occ.get(level.idx(z.x, z.y)) === z) {
    z.energy -= 1.0; steps++;
    _zombie_step(game, z, humans);
  }
}

// The closest living foe of `a` within `limit` that it can see, or null.
function nearest_foe(game, a, foes, limit) {
  const level = game.level;
  let best = null, best_d = limit + 1;
  for (const f of foes) {
    if (f === a || f.hp <= 0) continue;
    const d = cheb(apos(a), apos(f));
    if (f.sneaking && d > 2 && a.kind === 'zombie') continue;           // a creeping companion is only noticed up close
    if (d < best_d && has_los(level, apos(a), apos(f))) { best = f; best_d = d; }
  }
  return best;
}

function _zombie_fight(game, z, foe) {
  z.state = 'hunt'; z.target = apos(foe); z.stimulus_turn = game.clock.turn;
  if (cheb(apos(z), apos(foe)) === 1) { attack_actor(game, z, foe); return; }
  const nxt = greedy_step(game.level, apos(z), apos(foe), game.rng, (n) => _passable(game, z, n));
  if (nxt !== null) _move_or_bash(game, z, nxt);
}

function _zombie_step(game, z, humans) {
  const p = game.player, prof = game.profile, turn = game.clock.turn;
  const d = cheb(apos(z), apos(p));
  const seen = _unaware(z) ? false : sees_player(game, z);     // the unaware only notice through the awareness meter
  if (humans && humans.length && z.state !== 'dormant') {
    let foe = nearest_foe(game, z, humans, FOE_SIGHT);
    if (foe !== null && seen && comp_early_grace(game) && (foe.trait || foe.pet) && cheb(apos(z), apos(foe)) > 1) foe = null;     // in the opening they go for you, not your people
    if (foe !== null && (!seen || cheb(apos(z), apos(foe)) < d)) { _zombie_fight(game, z, foe); return; }
  }
  if (z.state === 'dormant') {
    if (seen) z.state = 'hunt'; else return;
  }
  if (seen) {
    if (z.state !== 'hunt') _spotted(game, z);
    z.state = 'hunt'; z.target = apos(p); z.stimulus_turn = turn; z.alert = ALERT_AT;
  } else if (z.state === 'hunt') _lost_sight(game, z, d);
  if (prof.dormant_after && (z.state === 'hunt' || z.state === 'investigate') && turn - z.stimulus_turn > prof.dormant_after) {
    z.state = 'dormant'; z.target = null; return;
  }
  if ((z.state === 'hunt' || z.state === 'investigate') && z.target !== null) _pursue(game, z, d, seen);
  else if (z.state === 'idle' && game.level.kind === 'overworld' && game.rng.random() < 0.35) _wander(game, z);
}

function _spotted(game, z) {
  sfx(game, 'alert', apos(z));
  if (z.flags.includes('screams') && z.cooldown <= 0) {
    z.cooldown = 40;
    sfx(game, 'scream', apos(z)); game.msg(`The ${z.name.toLowerCase()} screams!`, 'warn');
    game.emit_noise(apos(z), 22, 'zombie');
    game.add_heat(6);
  }
}

function _lost_sight(game, z, d) {
  const p = game.player, prof = game.profile;
  if (z.flags.includes('relentless') && d <= 45) { z.target = apos(p); return; }
  if (prof.smell && game.clock.turn - z.stimulus_turn < 25) {
    const spot = game.scent_near(apos(z), prof.smell);
    if (spot) { z.target = spot; return; }
  }
  if (game.clock.turn - z.stimulus_turn > LOST_AFTER) { z.state = 'idle'; z.target = null; }
}

function _pursue(game, z, d, seen) {
  const p = game.player, level = game.level;
  if (d === 1 && (seen || same(z.target, apos(p)))) { zombie_attack(game, z); return; }
  if (z.flags.includes('leaps') && seen && d >= 2 && d <= 4 && z.cooldown <= 0) {
    const spot = level.free_spot_near(p.x, p.y, 1);
    if (spot && cheb(spot, apos(z)) <= 4) {
      level.move_actor(z, spot[0], spot[1]);
      z.cooldown = 8;
      game.msg(`The ${z.name.toLowerCase()} leaps at you!`, 'bad');
      zombie_attack(game, z);
      return;
    }
  }
  if (z.target !== null && cheb(apos(z), z.target) === 0) {
    if (z.state === 'investigate') { z.state = 'idle'; z.target = null; }
    return;
  }
  let nxt = null;
  if (same(z.target, apos(p))) {
    const field = game.get_field();
    if (field[level.idx(z.x, z.y)] >= 0) nxt = descend(level, field, apos(z), game.rng, _hazard_tiles(game, z));
  }
  if (nxt === null && z.target !== null) nxt = greedy_step(level, apos(z), z.target, game.rng, (n) => _passable(game, z, n));
  if (nxt === null) { if (z.state === 'investigate') { z.state = 'idle'; z.target = null; } return; }
  _move_or_bash(game, z, nxt);
}

function _passable(game, z, pos) {
  const t = game.level.tile(pos[0], pos[1]);
  if (NO_ENTRY.has(t)) return false;
  if (t === T.FENCE) return !!game.profile.swarm;
  const hz = game.level.hazards[game.level.idx(pos[0], pos[1])];
  return !(hz && hz.kind === 'fire' && game.profile.intel >= 1);
}

function _hazard_tiles(game, z) {
  if (game.profile.intel < 1) return null;
  const out = new Set();
  for (const [k, hz] of Object.entries(game.level.hazards)) if (hz.kind === 'fire') out.add(+k);
  return out;
}

function _move_or_bash(game, z, nxt) {
  const level = game.level, t = level.tile(nxt[0], nxt[1]);
  if (NO_ENTRY.has(t)) return;
  if (t === T.DOOR) {
    if (game.profile.intel >= 1) { level.set_tile(nxt[0], nxt[1], T.DOOR_OPEN); return; }
    _bash_door(game, z, nxt);
    return;
  }
  if (level.occ.has(level.idx(nxt[0], nxt[1]))) return;
  level.move_actor(z, nxt[0], nxt[1]);
}

function _bash_door(game, z, pos) {
  const level = game.level, k = level.idx(pos[0], pos[1]);
  let power = z.flags.includes('breaker') ? 6 : 2;
  if (game.profile.swarm) {
    let n = 0;
    for (const [dx, dy] of DIRS8) { const o = level.occ.get(level.idx(pos[0] + dx, pos[1] + dy)); if (o && o.kind === 'zombie') n++; }
    power *= 1 + n;
  }
  const hp = (level.door_hp[k] === undefined ? DOOR_HP : level.door_hp[k]) - power;
  level.door_hp[k] = hp;
  game.emit_noise(pos, 6, 'zombie');
  if (hp <= 0) {
    level.set_tile(pos[0], pos[1], T.FLOOR);
    delete level.door_hp[k];
    if (cheb(pos, apos(game.player)) <= 12) game.msg('A door splinters and gives way.', 'warn');
  }
}

function _wander(game, z) {
  // shamblers keep going the way they face most of the time, which is what makes them stalkable from behind
  const [dx, dy] = z.facing && game.rng.random() < 0.7 ? z.facing : game.rng.choice(DIRS8);
  const n = [z.x + dx, z.y + dy], level = game.level;
  if (level.walkable(n[0], n[1]) && _passable(game, z, n) && !level.occ.has(level.idx(n[0], n[1])) && level.tile(n[0], n[1]) !== T.DOOR) {
    level.move_actor(z, n[0], n[1]);
  }
}

// Everything this human will shoot at that is not the player: the dead, and the other side.
function _foes_of(h, game, humans) {
  const out = game.level.actors.filter((z) => z.kind === 'zombie' && z.hp > 0);
  const mine = h.faction === 'raiders';
  for (const o of humans) if (o !== h && (o.faction === 'raiders') !== mine) out.push(o);
  return out;
}

function _toward(game, h, goal) {
  const level = game.level, p = game.player;
  let nxt = null;
  if (goal[0] === p.x && goal[1] === p.y) { const field = game.get_field(); if (field[level.idx(h.x, h.y)] >= 0) nxt = descend(level, field, apos(h), game.rng); }
  if (nxt === null) nxt = greedy_step(level, apos(h), goal, game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
  return !!nxt && _human_move(game, h, nxt);
}

// A standing order from the player. True if it took the companion's turn.
function _obey(game, h, humans, d) {
  const kind = comp_order_of(h), p = game.player, foes = _foes_of(h, game, humans);
  if (kind === 'engage') {
    const foe = nearest_foe(game, h, foes, COMP_ORDER_SIGHT);
    if (!foe) { comp_end_order(game, h, '"Clear."'); return false; }
    _human_fight(game, h, foe); return true;
  }
  if (kind === 'fallback') {
    const adjacent = foes.find((z) => z.hp > 0 && cheb(apos(z), apos(h)) === 1);
    if (d > 2) { if (_toward(game, h, apos(p)) && d > 4) _toward(game, h, apos(p)); return true; }
    if (adjacent) { _human_fight(game, h, adjacent); return true; }
    if (!nearest_foe(game, h, foes, 6)) { comp_end_order(game, h, '"Back with you. Nothing followed."'); return false; }
    return true;
  }
  if (kind === 'escape') { if (d > 1) { _toward(game, h, apos(p)); if (d > 2) _toward(game, h, apos(p)); } return true; }
  if (kind === 'ranged') {
    if (h.reach <= 1) { comp_end_order(game, h); return false; }
    const foe = nearest_foe(game, h, foes, h.reach);
    if (!foe) return false;
    if (cheb(apos(h), apos(foe)) <= 2 && foe.kind === 'zombie') _flee(game, h, apos(foe)); else attack_actor(game, h, foe, true);
    return true;
  }
  return false;                                                         // guard: the short leash does the work
}

function _human(game, h, humans) {
  if (!FIGHTERS.includes(h.role) && h.state !== 'follow' && h.state !== 'wait') return;     // shopkeepers and healers keep out of it
  if (h.stun > 0) { h.stun -= 1; return; }
  const p = game.player, level = game.level;
  const d = cheb(apos(h), apos(p));
  if (h.hidden) { raiders_spring_check(game, h, humans, d); return; }          // lying in wait
  if (h.state === 'follow' && comp_order_of(h) && _obey(game, h, humans, d)) return;
  const seen = h.hostile && d <= 11 && has_los(level, apos(h), apos(p));
  if (h.hostile && !seen && h.morale < 100) h.morale = Math.min(100, h.morale + 2);   // it pulls itself together out of sight
  let foe = nearest_foe(game, h, _foes_of(h, game, humans), h.reach > 1 ? HUMAN_SIGHT : FOE_SIGHT);
  if ((h.state === 'follow' || h.state === 'wait') && comp_refuses_to_fight(h, foe)) foe = null;     // a pacifist will not raise a hand to a person
  let target_foe = foe;
  if (h.state === 'follow' && foe && comp_should_hold_back(game, h, foe)) {
    if (d <= 14 && game.visible_hostiles().length) comp_on_regroup(game, h);
    target_foe = null;                                                  // when you run, they run with you
  }
  if (h.state === 'wait' && (target_foe === null || cheb(apos(h), apos(target_foe)) > 1)) return;     // asked to stay put: it only defends itself
  if (target_foe !== null && !(seen && d < cheb(apos(h), apos(target_foe)))) { _human_fight(game, h, target_foe); return; }
  if (seen) { h.state = 'hunt'; h.target = apos(p); }
  if (h.state === 'follow') { _follow_step(game, h); return; }
  if (h.state === 'patrol') { _patrol_step(game, h); return; }
  if (h.state === 'guard') {
    if (h.post && (h.x !== h.post[0] || h.y !== h.post[1]) && game.clock.turn % 3 === 0) {
      const nxt = greedy_step(level, apos(h), h.post, game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
      _human_move(game, h, nxt);
    }
    return;
  }
  if (h.state !== 'hunt' || !h.hostile) return;
  if (h.role === 'raider' || (h.role === 'soldier' && h.mag)) { _raider_hunt(game, h, seen, d); return; }
  if (h.hp < h.max_hp * 0.3 && seen) { _flee(game, h, apos(p)); return; }
  if (h.reach > 1 && seen && d >= 2 && d <= h.reach) { human_attack(game, h); return; }
  if (d === 1) { human_attack(game, h); return; }
  const field = game.get_field();
  let nxt = field[level.idx(h.x, h.y)] >= 0 ? descend(level, field, apos(h), game.rng) : null;
  if (nxt === null) nxt = greedy_step(level, apos(h), apos(p), game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
  _human_move(game, h, nxt);
}

function _human_move(game, h, nxt) {
  const level = game.level;
  if (nxt && !level.occ.has(level.idx(nxt[0], nxt[1])) && !NO_ENTRY.has(level.tile(nxt[0], nxt[1]))) {
    if (level.tile(nxt[0], nxt[1]) === T.DOOR) level.set_tile(nxt[0], nxt[1], T.DOOR_OPEN);
    else level.move_actor(h, nxt[0], nxt[1]);
    return true;
  }
  return false;
}

function _human_fight(game, h, foe) {
  const level = game.level, d = cheb(apos(h), apos(foe));
  h.sneaking = false; h.sprinting = false; h.lastfought = game.clock.turn;
  if (h.trait) comp_on_fight(game, h, foe);
  if (h.hp < h.max_hp * comp_flee_below(h) && foe.kind === 'zombie' && d <= 2) {
    comp_on_flee(game, h);
    if (h.state === 'follow' || h.state === 'wait') {                    // they run to you, not away into the dark
      const nxt = greedy_step(level, apos(h), apos(game.player), game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
      if (nxt && _human_move(game, h, nxt)) return;
    }
    _flee(game, h, apos(foe)); return;
  }
  if (h.reach > 1 && d >= 2 && d <= h.reach) attack_actor(game, h, foe, true);
  else if (d === 1) attack_actor(game, h, foe, false);
  else _human_move(game, h, greedy_step(level, apos(h), apos(foe), game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1]))));
}

// Walk to the group's current waypoint, every other tick; pick a new one on arrival.
function _patrol_step(game, h) {
  if (game.clock.turn % 2) return;
  const goals = game.patrol_goals;
  let goal = goals[h.group];
  if (!goal || cheb(apos(h), goal) <= 2 || h.stuck > 8) {
    if (!game.patrol_nodes.length) return;
    goal = pick_patrol_goal(game, apos(h)); goals[h.group] = goal; h.stuck = 0;
  }
  const level = game.level;
  const nxt = greedy_step(level, apos(h), goal, game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
  if (nxt === null || !_human_move(game, h, nxt)) h.stuck += 1;
}

// A companion stays close to the player.
function _follow_step(game, h) {
  const p = game.player, level = game.level;
  if (p.humanity < 20) { h.state = 'patrol'; game.msg(`The ${h.name.toLowerCase()} looks at what you have become, and walks away.`, 'warn'); return; }
  const d = cheb(apos(h), apos(p));
  if (d <= 2) return;
  const steps = 1 + (d > 4 ? 1 : 0) + (d > 10 ? 1 : 0);                 // fall behind and they hustle: you never have to slow down for them
  const field = game.get_field();
  let moved = false;
  for (let k = 0; k < steps; k++) {
    if (cheb(apos(h), apos(p)) <= 2) break;
    let nxt = field[level.idx(h.x, h.y)] >= 0 ? descend(level, field, apos(h), game.rng) : null;
    if (nxt === null) nxt = greedy_step(level, apos(h), apos(p), game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
    if (!_human_move(game, h, nxt)) break;
    moved = true;
  }
  if (moved || d <= 3) h.stuck = 0;
  else if (++h.stuck >= 5) { h.stuck = 0; comp_unstick(game, h); }                  // boxed in by trees or rubble: they find their way to you
}

// ---------------------------------------------------------------- far away, in the abstract
const ABSTRACT_EVERY = 20, ABSTRACT_STEPS = 5, ABSTRACT_RANGE = 10;

// Patrols beyond the simulated radius still walk and still fight, in coarse strokes.
function abstract_run(game) {
  if (game.level !== game.world.level || game.clock.turn % ABSTRACT_EVERY) return;
  const lv = game.world.level, p = game.player, groups = new Map();
  for (const a of lv.actors) {
    if (a.kind === 'human' && (a.role === 'scout' || a.role === 'soldier') && a.state === 'patrol' && a.hp > 0 && cheb(apos(a), apos(p)) > ACTIVE_RADIUS) {
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push(a);
    }
  }
  for (const [gid, all] of groups) {
    _abstract_fight(game, all);
    const members = all.filter((m) => m.hp > 0);
    if (members.length) _abstract_move(game, gid, members);
  }
}

function _abstract_move(game, gid, members) {
  const lv = game.world.level;
  let goal = game.patrol_goals[gid];
  if (!goal || members.some((m) => cheb(apos(m), goal) <= 2)) {
    if (!game.patrol_nodes.length) return;
    goal = pick_patrol_goal(game, apos(members[0])); game.patrol_goals[gid] = goal;
  }
  for (const m of members) {
    for (let i = 0; i < ABSTRACT_STEPS; i++) {
      const nxt = greedy_step(lv, apos(m), goal, game.rng, (n) => !NO_ENTRY.has(lv.tile(n[0], n[1])) && world_ready(game.world, n[0], n[1]));
      if (nxt === null || !_human_move(game, m, nxt)) break;
    }
  }
}

// Resolve a skirmish between a far-off patrol and whatever is near it. Returns foes killed.
function _abstract_fight(game, members) {
  const lv = game.world.level, p = game.player, rng = game.rng, lead = members[0];
  const foes = lv.actors.filter((a) => a.hp > 0 && cheb(apos(a), apos(lead)) <= ABSTRACT_RANGE && cheb(apos(a), apos(p)) > ACTIVE_RADIUS &&
    (a.kind === 'zombie' || (a.kind === 'human' && a.faction === 'raiders')));
  const hordes = game.hordes.filter((h) => cheb([h.x, h.y], apos(lead)) <= ABSTRACT_RANGE);
  if (!foes.length && !hordes.length) return 0;
  const foe_power = foes.reduce((s, a) => s + (a.kind === 'human' ? 1.8 : 0.8), 0) + hordes.reduce((s, h) => s + 0.7 * h.size, 0);
  let power = members.reduce((s, m) => s + (m.role === 'soldier' ? 1.6 : 1.2), 0) * (0.6 + rng.random() * 0.8);
  let killed = 0;
  foes.sort((a, b) => cheb(apos(a), apos(lead)) - cheb(apos(b), apos(lead)));
  for (const a of foes) {
    const cost = a.kind === 'human' ? 1.8 : 0.9;
    if (power < cost) break;
    power -= cost; killed++;
    if (a.kind === 'zombie') kill_zombie(game, a, false, false, lead);
    else { if (game.shared) game.shared.on_enemy_death(a); lv.remove_actor(a); lv.corpses[lv.idx(a.x, a.y)] = [game.clock.turn, true]; grant_xp(game, lead, 12); }
  }
  for (const h of hordes.slice()) {
    const n = Math.min(h.size, Math.floor(power / 0.9));
    power -= n * 0.9; h.size -= n; killed += n;
    if (h.size <= 1) { const i = game.hordes.indexOf(h); if (i >= 0) game.hordes.splice(i, 1); }
  }
  let damage = foe_power * (0.5 + rng.random()) * 3.0;
  const killer = foes.length ? foes[0] : lead;
  const order = members.map((m) => [rng.random(), m]).sort((a, b) => a[0] - b[0]).map((t) => t[1]);
  for (const m of order) {
    if (damage <= 0) break;
    const hit = Math.min(damage, rng.randint(6, 14));
    damage -= hit; m.hp -= Math.floor(hit);
    if (m.hp <= 0) kill_human_other(game, m, killer);
  }
  return killed;
}

// a neighbouring tile where the player cannot see it (behind a wall, a corner, a door post)
function _cover_step(game, h, p) {
  const level = game.level;
  for (const [dx, dy] of DIRS8) {
    const n = [h.x + dx, h.y + dy];
    if (level.free(n[0], n[1]) && !NO_ENTRY.has(level.tile(n[0], n[1])) && cheb(n, apos(p)) >= 2 && !has_los(level, n, apos(p))) return n;
  }
  return null;
}
function _away_step(game, h, p) {
  const level = game.level;
  let best = null, best_d = cheb(apos(h), apos(p));
  for (const [dx, dy] of DIRS8) {
    const n = [h.x + dx, h.y + dy];
    if (level.free(n[0], n[1]) && !NO_ENTRY.has(level.tile(n[0], n[1])) && cheb(n, apos(p)) > best_d) { best = n; best_d = cheb(n, apos(p)); }
  }
  return best;
}

// a raider fights like a small squad: it shoots in bursts and reloads, backs off when you close in, takes cover between
// bursts, works round to your flank, and runs only when it is hurt or its friends have died, not on contact
function _raider_hunt(game, h, seen, d) {
  const p = game.player, level = game.level;
  if ((h.hp < h.max_hp * 0.3 || h.morale < 30) && seen) { memory_on_flee(game, h); _flee(game, h, apos(p)); return; }
  if (h.reload > 0) {                                                  // reloading, from cover if it can
    h.reload -= 1; if (h.reload === 0) h.ammo = h.mag;
    const cover = seen ? _cover_step(game, h, p) : null;
    if (cover) _human_move(game, h, cover);
    return;
  }
  if (h.mag && seen && d >= 2 && d <= h.reach) {
    if (h.ammo <= 0) { h.reload = 3; if (game.is_visible(h.x, h.y)) game.msg(`The ${h.name.toLowerCase()} ducks to reload.`, 'info'); return; }
    if (d <= 2) { const away = _away_step(game, h, p); if (away) { _human_move(game, h, away); return; } }     // too close for comfort: back off and shoot from range
    if (game.rng.random() < 0.35) { const cover = _cover_step(game, h, p); if (cover) { _human_move(game, h, cover); return; } }     // not every turn: take cover between bursts
    h.ammo -= 1; human_attack(game, h); return;
  }
  if (d === 1) { human_attack(game, h); return; }
  let goal = apos(p), nxt = null;
  if (h.flank && d > 4) {                                              // work round to the side instead of walking into the barrel
    const vx = p.x - h.x, vy = p.y - h.y, wx = -vy, wy = vx, norm = Math.max(1, Math.abs(wx) + Math.abs(wy));
    const gx = p.x + Math.round(h.flank * wx * 4 / norm), gy = p.y + Math.round(h.flank * wy * 4 / norm);
    if (level.in_bounds(gx, gy) && level.walkable(gx, gy)) goal = [gx, gy];
  }
  if (goal[0] === p.x && goal[1] === p.y) { const field = game.get_field(); nxt = field[level.idx(h.x, h.y)] >= 0 ? descend(level, field, apos(h), game.rng) : null; }
  if (nxt === null) nxt = greedy_step(level, apos(h), goal, game.rng, (n) => !NO_ENTRY.has(level.tile(n[0], n[1])));
  _human_move(game, h, nxt);
}

function _flee(game, h, away_from) {
  const level = game.level;
  let best = null, best_d = cheb(apos(h), away_from);
  for (const [dx, dy] of DIRS8) {
    const n = [h.x + dx, h.y + dy];
    if (level.free(n[0], n[1]) && !NO_ENTRY.has(level.tile(n[0], n[1])) && cheb(n, away_from) > best_d) { best = n; best_d = cheb(n, away_from); }
  }
  if (best) level.move_actor(h, best[0], best[1]);
}
