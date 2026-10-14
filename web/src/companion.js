// ---------------------------------------------------------------- one companion at a time (mirror of engine/companion.py)
const COMP = CONTENT.companions;
const COMP_BY_ID = Object.fromEntries(COMP.archetypes.map((a) => [a.id, a]));
const COMP_BOND_START_STRANGER = 10, COMP_BOND_START_ALLY = 25, COMP_BOND_LEAVES = 5, COMP_STORY_AT = [35, 60, 85];
const COMP_SAY_EVERY = [110, 230], COMP_WANDER_NOISE = 6;
const COMP_MEDIC_EVERY = 60, COMP_TINKER_EVERY = 60, COMP_HUNGRY_EVERY = 160, COMP_LOUD_EVERY = 25, COMP_CALM_EVERY = 8, COMP_SCOUT_EVERY = 4;

let _COMP_ERA = 'modern';
const _COMP_VARIANTS = {};
// The age the game is set in: the same archetypes are called, and talk, a little differently.
function comp_set_era(id) { _COMP_ERA = id; }
function comp_arch(h) {
  const a = COMP_BY_ID[h.trait];
  if (!a) return null;
  const over = COMP.era_variants[`${a.id}|${_COMP_ERA}`];
  if (!over) return a;
  const key = `${a.id}|${_COMP_ERA}`;
  return _COMP_VARIANTS[key] || (_COMP_VARIANTS[key] = Object.assign({}, a, over));
}
// Their errand, worded for the age the game is set in.
function comp_personal(arch_id) { return Object.assign({}, COMP.personal[arch_id], COMP.personal_variants[`${arch_id}|${_COMP_ERA}`] || {}); }

function comp_ensure_person(game, h, archetype = null) {
  if (h.trait) return;
  const rng = new RNG(`${game.seed}:person:${h.uid}`);
  const role_pick = (['healer', 'trader', 'scholar'].includes(h.role) || h.uid % 3) ? COMP.role_archetype[h.role] : null;
  const pick = archetype || role_pick;
  const arch = pick ? COMP_BY_ID[pick] : rng.choice(COMP.archetypes);
  const taken = new Set((game.fallen_allies || []).map((f) => f[0]));
  for (const a of game.world.level.actors) if (a.kind === 'human' && a.trait) taken.add(a.name);
  const names = COMP.names.filter((n) => !taken.has(n));
  h.name = rng.choice(names.length ? names : COMP.names);
  h.trait = arch.id; h.glyph = h.name[0].toUpperCase();
  h.max_hp = h.hp = Math.trunc(arch.hp * 1.6) + 10; h.dmg = arch.dmg.slice(); h.acc = arch.acc;
  for (const k of ['bond', 'since', 'kills', 'story', 'nextsay', 'nextfx', 'nextfx2', 'nextwarn', 'nextfight', 'nextcall', 'quest']) if (h[k] === undefined) h[k] = 0;
  if (h.tamed === undefined) h.tamed = false;
  if (h.lasttalk === undefined) h.lasttalk = -999;
  if ((game.era.firearms || game.era.tech === 0) && (arch.id === 'veteran' || arch.id === 'hunter')) { h.reach = 6; h.mag = h.ammo = game.era.firearms ? 8 : 0; }
  else if (h.reach > 1) h.reach = 1;
}

function comp_current(game) {
  const uid = game.companion_uid;
  if (!uid) return null;
  for (const lv of [game.level, game.world.level]) {                      // with you in the building, or outside where you left them
    const c = lv.actors.find((a) => a.kind === 'human' && a.uid === uid && a.hp > 0 && (a.state === 'follow' || a.state === 'wait'));
    if (c) return c;
  }
  return null;
}

const COMP_CARRY_RANGE = 20, COMP_WARP_DISTANCE = 30;
// Through a door, up a stair, out into the street: whoever is following you comes too.
function comp_carry(game, old, target, dest, from_pos) {
  const uid = game.companion_uid;
  const c = uid ? old.actors.find((a) => a.kind === 'human' && a.uid === uid && a.hp > 0 && a.state === 'follow') : null;
  if (!c || (old === game.world.level && cheb([c.x, c.y], from_pos) > COMP_CARRY_RANGE)) return;      // too far behind: they wait out here
  const spot = target.free_spot_near(dest[0], dest[1], 3);
  if (!spot) return;
  old.remove_actor(c); c.x = spot[0]; c.y = spot[1]; target.add_actor(c);
}

function comp_say(game, c, text) { game.msg(`${c.name}: ${text}`, 'ally'); }
function comp_note(game, text, key = false) { game.msg(text, 'ally', key); }
function comp_add_bond(c, n) { c.bond = Math.max(0, Math.min(100, (c.bond || 0) + n)); }
function comp_describe(c) {
  const a = comp_arch(c);
  return a ? `${c.name}, ${a.label}. Good at it: ${COMP.strengths[a.strength]}. Trouble: ${COMP.flaws[a.flaw]}${c.tamed ? ' (overcome)' : ''}.` : c.name;
}
function comp_bond_word(c) { return ['a stranger', 'wary of you', 'getting used to you', 'a friend', 'someone who would die for you'][Math.min(4, Math.floor(c.bond / 22))]; }

function comp_refusal(game, npc) {
  if (npc.hostile) return 'They would sooner shoot you.';
  if (game.player.humanity < 20) return 'They will not follow what you have become.';
  if (comp_current(game)) return 'You already travel with someone. Only one can keep up with you.';
  if (npc.role === 'scout' || npc.role === 'soldier') {
    const trusted = (game.rep[npc.faction] || 0) >= 15 || game.aided[npc.group] === true;
    if (!trusted) return 'They do not know you well enough to follow you. Earn their trust: answer a call for help, or do them a favour.';
  } else if (['trader', 'healer', 'scholar'].includes(npc.role)) {
    if ((game.rep.enclave || 0) < 20 && game.player.humanity < 50) return 'They have a place here, and you have not given them a reason to leave it. Be better known, or better liked.';
  }
  return '';
}

function comp_recruit(game, npc, archetype = null, bond = COMP_BOND_START_STRANGER) {
  comp_ensure_person(game, npc, archetype);
  const world = game.world.level;
  if (!world.actors.includes(npc)) {
    for (const lv of Object.values(game.levels)) if (lv.actors.includes(npc)) lv.remove_actor(npc);
    let spot = game.level === world ? world.free_spot_near(game.player.x, game.player.y, 3) : null;
    if (!spot) { const site = Object.values(game.pois).find((p) => p.kind === 'refuge'); spot = site ? world.free_spot_near(site.x, site.y + 1, 4) : world.free_spot_near(game.world.start[0], game.world.start[1], 4); }
    if (!spot) return;
    npc.x = spot[0]; npc.y = spot[1]; world.add_actor(npc);
  }
  npc.state = 'follow'; npc.hostile = false; npc.talked = true;
  npc.bond = Math.max(npc.bond || 0, bond); npc.since = game.clock.turn; npc.nextsay = game.clock.turn + 80;
  game.companion_uid = npc.uid;
  const a = comp_arch(npc);
  comp_note(game, `${npc.name} the ${a.label} joins you.`, true);
  comp_say(game, npc, a.intro);
  comp_note(game, `  Good at it: ${COMP.strengths[a.strength]}. Trouble: ${COMP.flaws[a.flaw]}.`);
}

function comp_release(game, c, why, state = 'patrol') {
  comp_return_gear(game, c);
  c.state = state; game.companion_uid = 0;
  if (c.group && game.patrol_nodes.length) game.patrol_goals[c.group] = game.rng.choice(game.patrol_nodes);
  comp_note(game, why, true);
}
function comp_dismiss(game, c) { comp_release(game, c, `${c.name} goes their own way.`); return `${c.name} nods and goes their own way.`; }
function comp_toggle_wait(game, c) {
  if (c.state === 'follow') { c.state = 'wait'; return `${c.name} stays where they are and keeps watch.`; }
  c.state = 'follow'; return `${c.name} falls in beside you again.`;
}

// ---- the effects, every turn
// ---- orders
const COMP_ORDERS = {          // id: [label, what it does, turns it holds, line when they obey]
  engage: ['Engage nearest', 'go for the nearest enemy and do not stop until it is down', 40, '"On it."'],
  fallback: ['Fall back', 'break off, come back to your side and only defend themselves', 30, '"Falling back!"'],
  escape: ['Escape!', 'drop everything and run with you, at a sprint, no fighting', 40, '"Run! Go go go!"'],
  ranged: ['Fire from a distance', 'keep their distance and shoot (needs a ranged weapon)', 60, '"I have got a clear line. Covering you."'],
  guard: ['Stay close', 'stick to your shoulder and fight only what comes near you', 60, '"Right behind you."'],
};
const COMP_ORDER_SIGHT = 10;
function comp_order_of(h) { return h.order && h.order_until > 0 ? h.order : ''; }
function comp_give_order(game, c, kind) {
  const [, , turns, ack] = COMP_ORDERS[kind], a = comp_arch(c), rng = game.rng;
  let foe = null, best = 99;
  for (const z of game.visible_hostiles()) { const dd = cheb(apos(z), apos(c)); if (dd <= COMP_ORDER_SIGHT && dd < best) { foe = z; best = dd; } }
  const say = (t) => { const line = `${c.name}: ${t}`; game.msg(line, 'ally'); return line; };
  if (c.state === 'wait') c.state = 'follow';
  if (kind === 'ranged' && c.reach <= 1) return say('"I have nothing to shoot with. I would only get in their face."');
  if (kind === 'engage' && !foe) return say('"Nothing in sight to go for."');
  if (a && !c.tamed) {
    if (kind === 'engage' && a.flaw === 'coward' && rng.random() < 0.5) { comp_add_bond(c, -1); return say('"I... no. I cannot. Not that."'); }
    if ((kind === 'fallback' || kind === 'escape') && a.flaw === 'reckless' && rng.random() < 0.4) return say('"Not yet! One more!"');
  }
  c.order = kind; c.order_until = game.clock.turn + turns;
  return say(ack);
}
function comp_end_order(game, c, why = '') { c.order = ''; c.order_until = 0; if (why) comp_note(game, `${c.name}: ${why}`); }

// Your companion does what you do: creeps when you creep, runs when you run.
function comp_mirror(game, c) {
  const p = game.player, t = game.clock.turn, calm = c.state === 'follow' && t - (c.lastfought === undefined ? -99 : c.lastfought) > 3;
  if (c.order && t >= c.order_until) comp_end_order(game, c, '"Back to normal, then."');
  let sneak = !!(p.sneaking && calm); const sprint = !!((p.sprinting && calm) || c.order === 'escape'), near = cheb(apos(c), apos(p)) <= 8;
  if (['fallback', 'escape', 'engage', 'ranged'].includes(c.order)) sneak = false;
  if (sneak && !c.sneaking && near) comp_note(game, `${c.name} drops low and creeps beside you.`);
  else if (sprint && !c.sprinting && near) comp_note(game, `${c.name} breaks into a run after you.`);
  c.sneaking = sneak; c.sprinting = sprint;
}
// ...and levels up when you do.
// ---- gear: what you hand them to fight and dress with
const COMP_GEAR_AMMO_MAX = 40;
function comp_base(c) { if (!c.bdmg) { c.bdmg = c.dmg.slice(); c.bacc = c.acc; c.breach = c.reach; } }
function comp_refit(game, c) {                                          // their fighting stats from who they are and what they carry
  comp_base(c);
  const w = c.gear_weapon ? game.item_def(c.gear_weapon.id) : null;
  if (!w) { c.dmg = c.bdmg.slice(); c.acc = c.bacc; c.reach = c.breach; return; }
  c.dmg = [w.dmg[0] + Math.floor(c.bdmg[0] / 2), w.dmg[1] + Math.floor(c.bdmg[1] / 2)];
  c.acc = Math.min(92, c.bacc + w.accuracy + 6);
  c.reach = is_ranged(w) && (!w.ammo || (c.gear_ammo || 0) > 0) ? Math.min(8, w.reach) : 1;
}
function comp_hand_back(game, item) { const p = game.player, d = game.item_def(item.id); if (!p.add_item(item, d.stackable)) game.level.drop(apos(p), item); }
function comp_gear_lines(game, c) {
  const out = [];
  if (c.gear_weapon) { const w = game.item_def(c.gear_weapon.id); out.push(`Carries: ${w.name.toLowerCase()}` + (w.ammo ? `, ${c.gear_ammo || 0} ${game.item_def(w.ammo).name.toLowerCase()}` : '')); }
  if (c.gear_armor) out.push(`Wears: ${game.item_def(c.gear_armor.id).name.toLowerCase()}`);
  return out;
}
// Hand them a weapon or armour from your pack, or ammunition for the weapon they carry.
function comp_equip(game, c, index) {
  const p = game.player;
  if (!(index >= 0 && index < p.inventory.length)) return '';
  const it = p.inventory[index], d = game.item_def(it.id), a = comp_arch(c), rng = game.rng, say = COMP.gear_say;
  if (d.kind === 'weapon') {
    if (a && a.flaw === 'pacifist' && !c.tamed) return `${c.name} shakes their head. "I will not carry that."`;
    const old = c.gear_weapon;
    p.inventory.splice(index, 1);
    if (old) { comp_hand_back(game, old); const oa = game.item_def(old.id).ammo; if (c.gear_ammo && oa) comp_hand_back(game, make_item(oa, c.gear_ammo)); c.gear_ammo = 0; }
    c.gear_weapon = it; comp_refit(game, c);
    comp_say(game, c, rng.choice(a && a.flaw === 'reckless' ? say.reckless_weapon : say.weapon)); comp_add_bond(c, 2);
    return `${c.name} takes the ${d.name.toLowerCase()}.` + (d.ammo ? ` It needs ${game.item_def(d.ammo).name.toLowerCase()}: hand some over.` : '');
  }
  if (d.kind === 'armor') {
    const old = c.gear_armor;
    p.inventory.splice(index, 1);
    if (old) comp_hand_back(game, old);
    c.gear_armor = it;
    comp_say(game, c, rng.choice(a && a.flaw === 'coward' ? say.coward_armor : say.armor)); comp_add_bond(c, 2);
    return `${c.name} puts on the ${d.name.toLowerCase()}.`;
  }
  if (d.kind === 'ammo') {
    const w = c.gear_weapon ? game.item_def(c.gear_weapon.id) : null;
    if (!w || w.ammo !== it.id) return `${c.name} has nothing that uses ${d.name.toLowerCase()}.`;
    const n = Math.min(it.qty, COMP_GEAR_AMMO_MAX - (c.gear_ammo || 0));
    if (n <= 0) return `${c.name} is carrying all they can.`;
    p.take(it.id, n); c.gear_ammo = (c.gear_ammo || 0) + n; comp_refit(game, c);
    comp_say(game, c, rng.choice(say.ammo)); comp_add_bond(c, 1);
    return `${c.name} takes ${n} ${d.name.toLowerCase()}.`;
  }
  return `${c.name} has no use for the ${d.name.toLowerCase()}.`;
}
function comp_unequip(game, c, slot) {                                  // take it back
  if (slot === 'weapon' && c.gear_weapon) {
    const w = game.item_def(c.gear_weapon.id);
    comp_hand_back(game, c.gear_weapon);
    if (c.gear_ammo && w.ammo) comp_hand_back(game, make_item(w.ammo, c.gear_ammo));
    c.gear_weapon = null; c.gear_ammo = 0; comp_refit(game, c);
    return `You take the ${w.name.toLowerCase()} back.`;
  }
  if (slot === 'armor' && c.gear_armor) { const d = game.item_def(c.gear_armor.id); comp_hand_back(game, c.gear_armor); c.gear_armor = null; return `You take the ${d.name.toLowerCase()} back.`; }
  return '';
}
function comp_return_gear(game, c) { comp_unequip(game, c, 'weapon'); comp_unequip(game, c, 'armor'); }    // they go their own way: it comes back to you
function comp_drop_gear(game, c) {                                                                          // they fall: it is left where they fell
  const lv = game.level;
  if (c.gear_weapon) { lv.drop(apos(c), c.gear_weapon); const w = game.item_def(c.gear_weapon.id); if (c.gear_ammo && w.ammo) lv.drop(apos(c), make_item(w.ammo, c.gear_ammo)); }
  if (c.gear_armor) lv.drop(apos(c), c.gear_armor);
  c.gear_weapon = c.gear_armor = null; c.gear_ammo = 0;
}
// One shot fired from what you handed them; when it runs out they fall back to melee.
function comp_use_ammo(game, c) {
  if (!c.gear_weapon || !game.item_def(c.gear_weapon.id).ammo) return;
  c.gear_ammo = Math.max(0, (c.gear_ammo || 0) - 1);
  if (c.gear_ammo === 0) { comp_refit(game, c); comp_say(game, c, '"I am out! Hand me more, or I am swinging."'); }
}

function comp_grow(game, c) {
  const p = game.player;
  if (c.lvl >= p.level) return;
  comp_base(c);
  while (c.lvl < p.level) { c.lvl++; c.max_hp += 3; c.hp = Math.min(c.max_hp, c.hp + 6); c.bdmg = [c.bdmg[0] + (c.lvl % 2), c.bdmg[1] + 1]; c.bacc = Math.min(90, c.bacc + 2); }
  comp_refit(game, c);
  comp_note(game, `${c.name} grows with you: level ${c.lvl}.`, true);
}

// Left far behind (out of sight, nothing hunting them): they catch up, out of breath, rather than being lost.
function comp_catch_up(game, c) {
  const p = game.player;
  if (c.state !== 'follow' || cheb(apos(c), apos(p)) < COMP_WARP_DISTANCE) return;
  if (game.level.actors.some((z) => z !== c && z.hp > 0 && z.state === 'hunt' && cheb(apos(z), apos(c)) <= 12)) return;
  const lv = game.level, spot = lv.free_spot_near(p.x - 3, p.y, 3) || lv.free_spot_near(p.x, p.y, 4);
  if (!spot) return;
  lv.move_actor(c, spot[0], spot[1]);
  comp_note(game, `${c.name} catches up, out of breath. "You walk fast."`);
}

// A companion that cannot find a way through (a dense forest, a rubble field): they work their way round to you.
function comp_unstick(game, c) {
  const p = game.player, lv = game.level;
  let spot = null;
  for (const r of [2, 3, 4]) { const s = lv.free_spot_near(p.x, p.y, r); if (s && cheb(s, [p.x, p.y]) >= 1) { spot = s; break; } }
  if (!spot) return;
  lv.move_actor(c, spot[0], spot[1]);
  comp_note(game, `${c.name} pushes through the undergrowth to reach you.`);
}

function comp_tick(game) {
  const c = comp_current(game);
  if (c && c.level_id === game.level.id) { comp_mirror(game, c); comp_grow(game, c); comp_catch_up(game, c); }
  if (!c || game.level !== game.world.level || !comp_arch(c)) return;
  const t = game.clock.turn, p = game.player, a = comp_arch(c), near = cheb(apos(c), apos(p)) <= 10;
  if (t % 100 === 0) comp_add_bond(c, 1);
  if (t % 15 === 0 && c.hp < c.max_hp && !game.visible_hostiles().some((z) => cheb(apos(z), apos(c)) <= 6)) c.hp += 1;
  if (p.humanity < 20) { comp_release(game, c, `${c.name} looks at what you have become, and walks away.`); return; }
  if (c.bond <= COMP_BOND_LEAVES) { comp_say(game, c, '"I am done. I cannot do this with you."'); comp_release(game, c, `${c.name} leaves you.`); return; }
  if (near) { comp_strength(game, c, a.strength, t); comp_flaw(game, c, a.flaw, t); }
  comp_chatter(game, c, t);
  comp_watch(game, c, t);
  if (t % 5 === 0) {
    if (c.quest === 0 && c.bond >= COMP_QUEST_BOND && !game.pending_event && !game.visible_hostiles().length) comp_offer_personal(game, c);
    comp_personal_tick(game, c);
  }
}

function comp_strength(game, c, s, t) {
  const p = game.player;
  if (s === 'medic' && t >= c.nextfx && cheb(apos(c), apos(p)) <= 6 && (p.hp < p.max_hp * 0.6 || p.bleeding)) {
    c.nextfx = t + COMP_MEDIC_EVERY; p.hp = Math.min(p.max_hp, p.hp + 8); p.bleeding = 0; comp_add_bond(c, 1);
    comp_say(game, c, '"Hold still."'); comp_note(game, `${c.name} dresses your wounds. (+8)`);
  } else if (s === 'calm' && t % COMP_CALM_EVERY === 0 && p.panic > 20) game.add_panic(-3, true);
  else if (s === 'tinker' && t % COMP_TINKER_EVERY === 0 && p.weapon && p.weapon.dur !== null && p.weapon.dur !== undefined) {
    const d = game.item_def(p.weapon.id);
    if (d.durability && p.weapon.dur < d.durability) {
      p.weapon.dur = Math.min(d.durability, p.weapon.dur + 2);
      if (t % (COMP_TINKER_EVERY * 3) === 0) comp_say(game, c, '"Your grip was loose. Better now."');
    }
  } else if (s === 'scout' && t % COMP_SCOUT_EVERY === 0) comp_spot(game, c);
}

function comp_spot(game, c) {
  const lv = game.level;
  for (const h of lv.actors) {
    if (h.kind === 'human' && h.hidden && cheb(apos(h), apos(c)) <= 8) {
      h.hidden = false; h.state = 'idle';
      comp_say(game, c, '"Down! There, in the cover. They are waiting for us."'); comp_note(game, `${c.name} spots an ambush.`); comp_add_bond(c, 2);
      return;
    }
  }
  for (const [k, hz] of Object.entries(lv.hazards)) {
    const x = Number(k) % lv.w, y = Math.floor(Number(k) / lv.w);
    if (hz.kind === 'snare' && hz.hidden && cheb([x, y], apos(c)) <= 6) { hz.hidden = false; comp_say(game, c, '"Wire. Do not step there."'); return; }
  }
}

function comp_flaw(game, c, f, t) {
  if (c.tamed) return;                                          // they have made their peace with it
  const p = game.player;
  if (f === 'loud' && t % COMP_LOUD_EVERY === 0 && game.rng.random() < 0.3) {
    game.emit_noise(apos(c), COMP_WANDER_NOISE, 'player'); comp_note(game, `${c.name} knocks something over. That was loud.`);
  } else if (f === 'hungry' && t >= c.nextfx2 && t - c.since >= COMP_HUNGRY_EVERY) {
    c.nextfx2 = t + COMP_HUNGRY_EVERY;
    const food = p.inventory.find((i) => game.item_def(i.id).kind === 'food');
    if (food) { p.take(food.id, 1); comp_note(game, `${c.name} takes ${game.item_def(food.id).name.toLowerCase()} from your pack without asking.`); }
    else { comp_add_bond(c, -2); comp_say(game, c, '"I have not eaten in a day. Are we going to do something about that?"'); }
  }
}

function comp_chatter(game, c, t) {
  if (t < c.nextsay || game.visible_hostiles().length) return;
  const rng = game.rng, p = game.player, a = comp_arch(c), S = COMP.situation;
  c.nextsay = t + rng.randint(COMP_SAY_EVERY[0], COMP_SAY_EVERY[1]);
  let pool = [];
  if (p.hp < p.max_hp * 0.4) pool = pool.concat(S.hurt);
  if (game.is_dark()) pool = pool.concat(S.night);
  if (game.weather !== 'clear' && S[game.weather]) pool = pool.concat(S[game.weather]);
  if (wild_forest_here(game)) pool = pool.concat(S.forest);
  if (game.cfg.needs && p.hunger > 60) pool = pool.concat(S.hungry);
  pool = pool.concat(a.idle, a.idle);
  comp_say(game, c, rng.choice(pool));
}

function comp_watch(game, c, t) {
  if (t % 6 || t < c.nextwarn) return;
  for (const z of game.level.actors) {
    if (z.hp > 0 && z.special && cheb(apos(z), apos(c)) <= 9 && !game.is_visible(z.x, z.y) && z.state !== 'dormant') {
      c.nextwarn = t + 60;
      const dir = compass(z.x - c.x, z.y - c.y);
      comp_say(game, c, `"${cap(dir)}! Something is moving."`);
      return;
    }
  }
}

// ---- moments
function comp_on_enter(game, target) {
  const c = comp_current(game);
  if (!c || !comp_arch(c)) return;
  const poi = game.poi_of_level(target);
  comp_place_keepsake(game, target);
  comp_say(game, c, poi && poi.kind === 'cave' ? COMP.situation.cave[0] : c.level_id === target.id ? '"Stay close. I have got your back."' : '"I will keep watch out here."');
}

function comp_on_return(game) {
  const c = comp_current(game);
  if (!c || !comp_arch(c)) return;
  const s = comp_arch(c).strength, rng = game.rng;
  if ((s === 'scavenger' || s === 'lucky') && rng.random() < (s === 'scavenger' ? 0.45 : 0.35)) {
    const item = rng.choice(['scrap', 'cloth', 'wood', 'food', 'bandage'].concat(s === 'lucky' ? ['chem'] : []));
    if (game.items[item]) {
      game.give_item(make_item(item, rng.randint(1, 2)));
      comp_say(game, c, `"Picked this up on the way out. ${game.item_def(item).name}. You are welcome."`);
      comp_add_bond(c, 1);
      if (s === 'lucky' && rng.random() < 0.5) game.player.coins += rng.randint(1, 4);
    }
  } else if (rng.random() < 0.3) comp_say(game, c, '"Nothing out here. Good. Let us keep it that way."');
}

function comp_on_ally_kill(game, c, victim) {
  c.kills = (c.kills || 0) + 1; comp_add_bond(c, 1);
  const a = comp_arch(c);
  if (a && game.rng.random() < 0.35) comp_say(game, c, game.rng.choice(a.kill));
}

function comp_on_player_kills_human(game, victim) {
  const c = comp_current(game);
  if (!c || !comp_arch(c) || victim === c || victim.hostile) return;
  if (comp_arch(c).flaw === 'pacifist') { comp_add_bond(c, -15); comp_say(game, c, '"No. No, no. That was a person."'); }
  else { comp_add_bond(c, -4); comp_say(game, c, '"Did they have to die?"'); }
}

function comp_on_hurt(game, c) { const a = comp_arch(c); if (a && game.rng.random() < 0.3) comp_say(game, c, game.rng.choice(a.hurt)); }

function comp_on_death(game, h, killer) {
  if (h.uid !== game.companion_uid) return;
  comp_drop_gear(game, h);
  const a = comp_arch(h), days = Math.max(0, Math.floor((game.clock.turn - h.since) / 240));
  const by = killer && typeof killer === 'object' ? ` at the hands of ${killer.name.toLowerCase()}` : '';
  comp_note(game, `${h.name} is dead${by}. ${days} day${days !== 1 ? 's' : ''} together, ${h.kills} kill${h.kills !== 1 ? 's' : ''}. Gone for good.`, true);
  if (a) comp_note(game, `You remember what ${h.name} said: ${a.farewell}`);
  game.fallen_allies.push([h.name, `${a ? a.label : 'survivor'}, ${days}d, ${h.kills} kills`]);
  game.companion_uid = 0;
  game.add_panic(12 + h.bond / 5, true);
  if (h.bond >= 50) game.adjust_humanity(-3, '');
  memory_on_ally_death(game, h.name, a ? a.label : 'survivor', a ? a.farewell : '...', apos(h));
  dir_mourn(game);
}

// ---- talking
function comp_talk(game, c) {
  const a = comp_arch(c), t = game.clock.turn;
  if (c.story < 3 && c.bond >= COMP_STORY_AT[c.story]) {
    const line = a.backstory[c.story]; c.story += 1;
    const reward = comp_reward(game, c);
    comp_say(game, c, line);
    return `${c.name}: ${line}\n${reward}`;
  }
  const extra = COMP.situation[game.is_dark() ? 'night' : 'warning'][0];
  const line = game.rng.choice(a.idle.concat([extra]));
  if (t - c.lasttalk > 200) comp_add_bond(c, 1);
  c.lasttalk = t;
  game._spend(1);
  return `${c.name}: ${line}`;
}

function comp_reward(game, c) {
  const n = c.story;
  if (n === 1) { comp_add_bond(c, 2); return game.reveal_random_lead() ? `${c.name} shares something they know: a lead is on your map.` : `${c.name} seems lighter for having said it.`; }
  if (n === 2) { game.give_item(make_item(game.items.medkit ? 'medkit' : 'bandage', 1)); comp_add_bond(c, 2); return `${c.name} hands you a medkit they had been saving.`; }
  c.max_hp += 6; c.hp = c.max_hp; game.player.max_hp += 3; game.player.hp = Math.min(game.player.max_hp, game.player.hp + 3);
  return `You would trust ${c.name} with your life. Something in you steadies. (+3 max health; ${c.name} +6)`;
}

function comp_give(game, c, index) {
  const p = game.player, it = p.inventory[index];
  if (!it) return '';
  const d = game.item_def(it.id);
  if (d.kind === 'food') { p.take(it.id, 1); comp_add_bond(c, 4); c.nextfx2 = game.clock.turn + COMP_HUNGRY_EVERY; comp_say(game, c, '"Thank you. I mean it."'); return `${c.name} eats gratefully.`; }
  if (d.kind === 'med') {
    if (c.hp >= c.max_hp) return `${c.name} is not hurt.`;
    p.take(it.id, 1); c.hp = Math.min(c.max_hp, c.hp + Math.trunc(d.effect.heal || 6)); comp_add_bond(c, 3); comp_say(game, c, '"You did not have to."');
    return `You patch ${c.name} up.`;
  }
  return `${c.name} has no use for the ${d.name.toLowerCase()}.`;
}

function comp_advice(game) {
  const c = comp_current(game), p = game.player, bits = [];
  const todo = game.objectives().find((o) => !o[1]);
  if (p.hp < p.max_hp * 0.5) bits.push('You are hurt: patch yourself up first.');
  if (game.cfg.needs && p.hunger > 60) bits.push('You need to eat.');
  if (todo) bits.push(`What we came for: ${todo[0]}.`);
  const site = game.pois[game.final_site_id];
  if (site && site.revealed) bits.push(`${site.name} is ${compass(site.x - p.x, site.y - p.y)}, ${dist_words(game.era.id, cheb([site.x, site.y], [p.x, p.y]))}.`);
  const lead = Object.values(game.pois).find((q) => q.lead && !q.done && q.component);
  if (lead) bits.push(`A lead: ${lead.name}, ${compass(lead.x - p.x, lead.y - p.y)}, ${dist_words(game.era.id, cheb([lead.x, lead.y], [p.x, p.y]))}.`);
  return `${c.name}: ` + (bits.length ? bits.join(' ') : 'Keep moving and keep quiet.');
}

// ---- in a fight
const COMP_LEASH = 6, COMP_LEASH_RECKLESS = 12, COMP_FIGHT_SAY_EVERY = 40;
const COMP_LEASH_TIDE = 3, COMP_GRACE_TURNS = 480, COMP_GRACE_DAMAGE = 0.4;
function comp_early_grace(game) { return game.clock.turn < COMP_GRACE_TURNS || !!(game.ring && game.ring.active); }
function comp_leash(h, game = null) { if (comp_order_of(h) === 'guard') return 2; if (['engage', 'ranged'].includes(comp_order_of(h))) return 30; if (game && game.ring && game.ring.active) return COMP_LEASH_TIDE; return comp_is_reckless(h) ? COMP_LEASH_RECKLESS : COMP_LEASH; }
// when you run, they run with you: a foe that is not on top of them is no reason to leave you
function comp_should_hold_back(game, h, foe) { return cheb(apos(h), apos(game.player)) > comp_leash(h, game) && cheb(apos(h), apos(foe)) > 1; }
function comp_shout(game, h, kind, field, every) {
  const t = game.clock.turn;
  if (t < h[field]) return;
  h[field] = t + every;
  comp_say(game, h, game.rng.choice(COMP.combat[kind]));
}
function comp_on_fight(game, h, foe) { if (comp_arch(h) && (h.state === 'follow' || h.state === 'wait')) comp_shout(game, h, 'engage', 'nextfight', COMP_FIGHT_SAY_EVERY); }
function comp_on_regroup(game, h) { if (comp_arch(h)) comp_shout(game, h, 'regroup', 'nextcall', COMP_FIGHT_SAY_EVERY); }
function comp_on_flee(game, h) { if (comp_arch(h)) comp_shout(game, h, 'flee', 'nextcall', COMP_FIGHT_SAY_EVERY); }
function comp_on_player_hurt(game, amount) {
  const c = comp_current(game);
  if (c && comp_arch(c) && amount >= 3 && cheb(apos(c), apos(game.player)) <= 8) comp_shout(game, c, 'player_hurt', 'nextfight', 25);
}

// ---- the AI's questions
function comp_flee_below(h) { const a = comp_arch(h); return a && a.flaw === 'coward' && !h.tamed ? 0.6 : 0.3; }
function comp_refuses_to_fight(h, foe) { const a = comp_arch(h); return !!(a && a.flaw === 'pacifist' && !h.tamed && foe && foe.kind === 'human'); }
function comp_is_reckless(h) { const a = comp_arch(h); return !!(a && a.flaw === 'reckless' && !h.tamed); }

// ---- the start, and strangers who ask to come along
function comp_spawn_start(game) {
  const rng = new RNG(`${game.seed}:companion`), arch = rng.choice(COMP.archetypes), lv = game.world.level, p = game.player;
  const spot = lv.free_spot_near(p.x, p.y, 3);
  if (!spot) return;
  const h = comp_stranger(game, spot);
  comp_ensure_person(game, h, arch.id);
  lv.add_actor(h);
  h.bond = COMP_BOND_START_ALLY; h.since = 0; h.nextsay = 90;
  game.companion_uid = h.uid;
  comp_note(game, `${h.name} the ${arch.label} is with you.`, true);
  comp_say(game, h, arch.intro);
  comp_note(game, `  Good at it: ${COMP.strengths[arch.strength]}. Trouble: ${COMP.flaws[arch.flaw]}.`);
}

function comp_stranger(game, spot) {
  return { kind: 'human', uid: game.next_uid(), name: 'Survivor', glyph: 'S', x: spot[0], y: spot[1], hp: 30, max_hp: 30, level_id: 'world', lvl: 1, lvl_xp: 0, title: '', stun: 0,
           role: 'survivor', faction: 'enclave', hostile: false, dmg: [3, 7], acc: 55, reach: 1, energy: 0, state: 'follow', target: null, loot: [], talked: false, group: 0, stuck: 0,
           squad: 0, flank: 0, mag: 0, ammo: 0, reload: 0, morale: 100, hidden: false, corrupt: false, cp: 0, post: null,
           trait: '', bond: 0, since: 0, kills: 0, story: 0, nextsay: 0, nextfx: 0, nextfx2: 0, nextwarn: 0, lasttalk: -999, nextfight: 0, nextcall: 0, quest: 0, tamed: false, sneaking: false, sprinting: false, lastfought: -99, order: '', order_until: 0 };
}

function comp_offer_stranger(game, chance) {
  if (game.rng.random() >= chance) return;
  const lv = game.world.level, p = game.player;
  if (game.level !== lv || comp_current(game)) return;
  const spot = lv.free_spot_near(p.x, p.y, 3);
  if (!spot) return;
  const h = comp_stranger(game, spot);
  lv.add_actor(h);
  comp_recruit(game, h, null, 15);
}


// ---- their one personal errand
const COMP_QUEST_BOND = 60, COMP_QUEST_RANGE = 70, COMP_SCENE_RANGE = 3;

function comp_offer_personal(game, c) {
  const a = comp_arch(c);
  if (!a || c.quest || c.bond < COMP_QUEST_BOND || game.personal) return false;
  const spec = comp_personal(a.id), p = game.player;
  let pool = Object.values(game.pois).filter((q) => q.kind === spec.kind && !q.visited && cheb([q.x, q.y], apos(p)) <= COMP_QUEST_RANGE);
  if (!pool.length) pool = Object.values(game.pois).filter((q) => !['breach', 'refuge', 'pad', 'cave'].includes(q.kind) && !q.visited && cheb([q.x, q.y], apos(p)) <= COMP_QUEST_RANGE);
  if (!pool.length) { c.quest = 3; return false; }
  const poi = pool.reduce((b, q) => (cheb([q.x, q.y], apos(p)) < cheb([b.x, b.y], apos(p)) ? q : b));
  poi.revealed = true; c.quest = 1;
  game.personal = { uid: c.uid, poi: poi.id, stage: 1 };
  comp_say(game, c, spec.ask);
  game.msg(`${c.name} asks you for one thing: ${poi.name}, ${compass(poi.x - p.x, poi.y - p.y)}, ${dist_words(game.era.id, cheb([poi.x, poi.y], apos(p)))}. It is marked on your map.`, 'obj', true);
  return true;
}

function comp_personal_objective(game) {
  const q = game.personal, c = comp_current(game);
  if (!q || !c || c.uid !== q.uid || c.quest === 0 || c.quest === 3) return null;
  const poi = game.pois[q.poi];
  return [`${c.name}'s errand: ${c.quest === 2 ? 'bring it back to them' : 'find what is left at ' + poi.name}`, false];
}

function comp_place_keepsake(game, target) {
  const q = game.personal, poi = game.poi_of_level(target);
  if (!q || !poi || poi.id !== q.poi || q.stage !== 1) return;
  if (poi.floors > 1 && !target.id.endsWith(`:${poi.floors - 1}`)) return;
  const item = make_item('keepsake', 1); item.key = true;
  const crates = Object.values(target.containers);
  if (crates.length) game.rng.choice(crates).loot.push(item);
  else { const spot = target.free_spot_near(target.entry[0], target.entry[1], 4); if (spot) target.drop(spot, item); }
  q.stage = 1.5;
  game.msg('Somewhere in here is what they asked you for.', 'obj');
}

function comp_personal_tick(game, c) {
  const q = game.personal;
  if (!q || q.uid !== c.uid) return;
  const p = game.player;
  if (c.quest === 1 && p.count('keepsake') > 0) { c.quest = 2; q.stage = 2; game.msg(`You have it. Take it back to ${c.name}.`, 'obj', true); }
  if (c.quest === 2 && game.level === game.world.level && cheb(apos(c), apos(p)) <= COMP_SCENE_RANGE && !game.pending_event && !game.visible_hostiles().length) {
    const spec = comp_personal(comp_arch(c).id);
    game.pending_event = start_event(game, EVENT_BY_ID.story_personal, `${c.name} sees what you are carrying. ${spec.found} ${spec.scene}`, { uid: c.uid });
  }
}

function comp_resolve_personal(game, active, index) {
  const c = game.world.level.actors.find((a) => a.kind === 'human' && a.uid === active.data.uid);
  if (!c || !comp_arch(c)) { active.result = 'They are gone.'; active.resolved = true; return active.result; }
  const spec = comp_personal(comp_arch(c).id), p = game.player;
  p.take('keepsake', 1); c.quest = 3; game.personal = null;
  let text;
  if (index === 0) {
    comp_add_bond(c, 20); c.tamed = true; comp_boon(game, c); game.adjust_humanity(4, '');
    text = `${spec.give}\n${c.name} has overcome something: ${spec.boon}`;
  } else if (index === 1) { comp_add_bond(c, -25); game.adjust_humanity(-6, ''); p.coins += 6; text = spec.keep; }
  else { comp_add_bond(c, 10); game.adjust_humanity(2, ''); game.add_panic(-15, true); c.story = 3; text = spec.read; }
  active.result = text; active.resolved = true;
  game.msg(text, 'ally', true);
  return text;
}

function comp_boon(game, c) {
  const a = comp_arch(c);
  if (a.flaw === 'frail') { c.max_hp += 12; c.hp = c.max_hp; }
  else if (a.flaw === 'reckless') { c.max_hp += 8; c.hp = c.max_hp; }
}
