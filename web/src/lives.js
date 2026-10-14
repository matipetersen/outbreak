// ---------------------------------------------------------------- the living world: infinite lives, enemies that level
// In mode 'living' your death is not the end. Your body keeps your gear and rises as a named zombie; whatever killed
// you grows stronger and keeps its name; a new survivor walks out of the refuge into the same world.
const MAX_ENEMY_LEVEL = 15, KEEP_KNOWLEDGE = 0.5;
const living = (game) => game.cfg.mode !== 'normal';
// Enemies cannot outgrow the calendar: day 1 caps at level 3.
const level_cap = (game) => game.scenario.escalates ? Math.min(40, 2 + game_day(game)) : Math.min(MAX_ENEMY_LEVEL, 2 + game_day(game));
const base_name = (a) => a.name.replace(/ \(Lv\d+\)$/, '');

function level_up(game, a, announce = true) {
  a.lvl = (a.lvl || 1) + 1;
  const gain = Math.max(1, Math.floor(a.max_hp * 0.10));
  a.max_hp += gain; a.hp = Math.min(a.max_hp, a.hp + gain * 3);
  a.dmg = [a.dmg[0] + (a.lvl % 2), a.dmg[1] + 1];
  a.acc = Math.min(90, a.acc + 2);
  a.name = `${base_name(a)} (Lv${a.lvl})`;
  if (announce && game.is_visible(a.x, a.y) && a.lvl >= 3) game.msg(`The ${base_name(a).toLowerCase()} grows stronger.`, 'warn');
}

// An enemy that kills something learns from it, up to the calendar's cap.
function grant_xp(game, killer, value) {
  if (!killer || killer.kind === 'player' || killer.hp <= 0 || !living(game)) return;
  killer.lvl = killer.lvl || 1; killer.lvl_xp = (killer.lvl_xp || 0) + value;
  while (killer.lvl < level_cap(game) && killer.lvl_xp >= 8 * killer.lvl) { killer.lvl_xp -= 8 * killer.lvl; level_up(game, killer); if (game.shared) game.shared.on_enemy_level(killer); }
}

const label_of = (game, generation, origin_id) => `${game.era.origin_names[origin_id]} #${generation}`;

// The body of a dead survivor gets up.
function make_fallen(game, level, pos, info) {
  const z = spawn_zombie(game, level, pos, 'walker', false, true);
  for (let i = 0; i < Math.floor(info.level / 2); i++) level_up(game, z, false);
  z.name = `Fallen ${info.label}` + (z.lvl > 1 ? ` (Lv${z.lvl})` : '');
  z.title = `Once ${info.label}`; z.fresh_human = false;
  return z;
}

// Replace the player with a new survivor at the refuge. The world is untouched.
function player_died(game, kind, cause) {
  const p = game.player, lv = game.level, rng = game.rng;
  const label = label_of(game, game.generation, game.current_origin);
  const record = { label, level: p.level, day: game_day(game), kills: p.kills, cause: cause || (kind === 'turned' ? 'turned' : 'died'), kind };
  game.fallen.push(record);
  const gear = [p.weapon, p.armor, p.light].concat(p.inventory).filter((i) => i);
  for (const item of gear) lv.drop([p.x, p.y], item);
  const death_pos = [p.x, p.y], death_level = lv.id, death_key = lv.idx(p.x, p.y);
  if (lv.occ.get(lv.idx(p.x, p.y)) === p) lv.occ.delete(lv.idx(p.x, p.y));
  lv.corpses[lv.idx(p.x, p.y)] = [game.clock.turn, 2];
  game.fallen_bodies[`${lv.id}|${lv.idx(p.x, p.y)}`] = record;
  const killer = game.killer && game.killer.hp > 0 ? game.killer : null;
  game.killer = null;
  let killer_line = '';
  if (killer) {
    grant_xp(game, killer, 40 + 10 * p.level);
    killer.title = `Killer of ${label}`;
    killer_line = ` The ${base_name(killer).toLowerCase()} that did it is now level ${killer.lvl || 1}, and it is still out there.`;
  }
  const origins = Object.keys(CONTENT.origins).filter((o) => o !== game.current_origin);
  const new_origin = rng.choice(origins.length ? origins : Object.keys(CONTENT.origins));
  const refuge = game.pois[game.refuge_id], world = game.world.level;
  gen_near(game, refuge.x, refuge.y);
  const pos = world.free_spot_near(refuge.x, refuge.y + 2, 8) || world.free_spot_near(game.world.start[0], game.world.start[1], 8);
  const known = Array.from(game.know.known).sort();
  const keep = Math.floor(known.length * KEEP_KNOWLEDGE), kept = [];
  for (let i = 0; i < keep; i++) kept.push(known.splice(rng.randint(0, known.length - 1), 1)[0]);
  game.know.known = new Set(kept);
  let home = game.base_id ? game.levels[game.base_id] : null, spawn_pos = pos;       // the next survivor wakes in your base
  if (home && !hostiles_in(home).length) { const spot = home.free_spot_near(home.entry[0], home.entry[1], 4); if (spot) spawn_pos = spot; else home = null; } else home = null;
  game.level = home || world;
  const docs = p.documents.slice();
  game.generation += 1; game.current_origin = new_origin;
  const np = make_player(game, new_origin, spawn_pos);
  np.level_id = game.level.id;
  np.documents = docs; np.recipes = (p.recipes || np.recipes).slice();
  np.level = Math.max(1, Math.floor(p.level / 2));
  np.perk_points = np.level - 1;
  np.max_hp += 3 * (np.level - 1); np.hp = np.max_hp;
  if (game.live_started) game.invuln_until = game.clock.turn + 40;
  game.ring = null; game.final = null; game.pending_event = null; game.followers = [];
  game.heat = Math.min(game.heat, 30.0);
  for (const a of world.actors) if (a.kind === 'human' && (a.state === 'follow' || a.state === 'wait')) a.state = 'patrol';
  game.companion_uid = 0; game.pet_uid = 0;
  const new_label = label_of(game, game.generation, new_origin);
  const why = cause || (kind === 'turned' ? 'The fever won.' : '');
  game.death_notice = `${label} (level ${p.level}, day ${game_day(game)}) is gone: ${why}.${killer_line}\n\n` +
    `Their gear lies where they fell, and the body will not stay down. Nothing else changes. The dead are where they were, ` +
    `the vaults are as they left them, and the clock keeps running.\n\n` +
    `${new_label} ${home ? 'wakes in the base you built' : 'reaches ' + game.era.refuge}. They know part of what the journals say, and they start at level ${np.level}.`;
  game.msg(`${label} has died. ${new_label} takes up the search.`, 'bad', true);
  if (game.shared) {
    game.shared.on_player_died({ label, level: p.level, x: death_pos[0], y: death_pos[1], level_id: death_level, key: death_key, cause: record.cause, record, killer,
      items: gear.map((i) => ({ id: i.id, qty: i.qty, dur: i.dur === undefined ? null : i.dur, key: !!i.key })) });
  }
}
