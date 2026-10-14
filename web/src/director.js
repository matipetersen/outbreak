// ---------------------------------------------------------------- the Director: the hero's journey as a pacing chart (mirror of engine/director.py)
const DIR_STAGES = CONTENT.director.stages;
const DIR_SAMPLE_EVERY = 5, DIR_TELEGRAPH = 10, DIR_MERCY_HP = 0.35, DIR_PEAK_MAX = 130;

function dir_state(game) {
  if (!game.director) {
    game.director = { stage: 0, tension: 0, phase: 'build', phase_until: 0, hp_last: game.player.hp, damage: 0, pending: [], done: [], threats: 0, last_threat: -999, mercy: 0, inside_since: -1, last_siege: -999 };
    game.director.phase_until = game.clock.turn + game.rng.randint(DIR_STAGES[0].wait[0], DIR_STAGES[0].wait[1]);
  }
  return game.director;
}

function dir_progress(game) {
  const sc = game.scenario;
  if (sc.escalates) return (((game.clock.turn / 240.0) % 9.0) / 9.0) * 0.95;
  const reqs = game.requirements(), r = reqs.length ? reqs.filter((q) => q[1]).length / reqs.length : 0.0;
  const horizon = 240.0 * (game.deadline_days || 10), c = Math.min(1.0, game.clock.turn / horizon);
  let s = 0.65 * r + 0.35 * c;
  const site = game.pois[game.final_site_id];
  if (site && site.revealed) s += 0.04;
  if (game.final) s = Math.max(s, 0.92);
  return Math.min(1.0, s);
}

function dir_stage_index(s) { let idx = 0; DIR_STAGES.forEach((st, i) => { if (s >= st.start) idx = i; }); return idx; }

function dir_power(game) {
  const p = game.player, w = p.weapon ? game.item_def(p.weapon.id) : null;
  return 1.0 + 0.12 * (p.level - 1) + (p.armor ? 0.3 : 0.0) + (w && (w.dmg[0] + w.dmg[1]) >= 9 ? 0.2 : 0.0) + (comp_current(game) ? 0.35 : 0.0) + (pets_current(game) ? 0.12 : 0.0);
}

function dir_sample(game, d) {
  const p = game.player;
  d.damage = d.damage * 0.9 + Math.max(0, d.hp_last - p.hp) * 2.0;
  d.hp_last = p.hp;
  let raw = 10.0 * Math.min(4, game.visible_hostiles().length) + p.panic * 0.4 + game.heat * 0.25 + d.damage;
  for (const ally of memory_allies(game)) if (ally.hp < ally.max_hp * 0.4) raw += 12.0;          // watching them get hurt is part of the pressure
  d.tension = Math.min(100.0, Math.max(raw, d.tension * 0.95));
}

function dir_mourn(game) {
  const d = game.director;
  if (!d) return;
  d.phase = 'release'; d.phase_until = game.clock.turn + 200;
  if (DIR_STAGES[d.stage].id !== 'ordeal') d.pending = d.pending.filter((item) => item[1] !== 'boss');
  game.msg('Nobody speaks for a long time. The road lets you be.', 'dir');
}

function dir_in_trouble(game) {
  if (memory_allies(game).some((a) => a.hp < a.max_hp * 0.25)) return true;
  const p = game.player, meds = ['medkit', 'bandage'].filter((i) => game.items[i]).reduce((s, i) => s + p.count(i), 0);
  return p.hp < p.max_hp * DIR_MERCY_HP || (p.bleeding && meds === 0 && p.hp < p.max_hp * 0.6);
}

// multiplier on the world's own threat generation (wanderers, random events)
function dir_scale(game) {
  const d = game.director;
  if (!d) return 1.0;
  const st = DIR_STAGES[d.stage];
  let base = { build: 1.0, peak: 1.35, release: 0.2 }[d.phase] * (0.5 + st.peak / 100.0);
  if (d.stage <= 3) base = Math.min(base, 0.6);
  return Math.max(0.1, base);
}

function dir_event_bias(game, id) {
  const d = game.director;
  if (!d) return 1.0;
  if (CONTENT.director.relief_events.includes(id)) return { release: 2.5, build: 1.0, peak: 0.4 }[d.phase];
  if (CONTENT.director.threat_events.includes(id)) return { release: 0.2, build: 1.0, peak: 1.8 }[d.phase];
  return 1.0;
}

function dir_status(game) {
  const d = game.director;
  if (!d) return '';
  const st = DIR_STAGES[d.stage], n = Math.floor(d.tension / 20);
  return `Act ${d.stage + 1}/${DIR_STAGES.length} ${st.title}  [${'#'.repeat(n)}${'.'.repeat(5 - n)}] ${d.phase}`;
}

function dir_tick(game) {
  const t = game.clock.turn, d = dir_state(game);
  if (t % DIR_SAMPLE_EVERY) return;
  dir_sample(game, d); dir_stage(game, d, t); dir_due(game, d, t);
  const inside = game.level !== game.world.level;
  d.inside_since = inside ? (d.inside_since >= 0 ? d.inside_since : t) : -1;
  if (inside) dir_siege(game, d, t);
  if (game.final || game.pending_event || game.level.kind === 'haven' || game.level.safe) return;      // indoors counts: the story does not stop at the door
  const st = DIR_STAGES[d.stage];
  if (dir_in_trouble(game) && d.phase !== 'release') {
    d.phase = 'release'; d.phase_until = t + Math.floor(st.release / 2); d.mercy += 1;
    game.msg('A lull falls. Whatever was after you has lost the scent.', 'dir');
    return;
  }
  if (d.phase === 'build' && t >= d.phase_until && d.tension < Math.max(12, st.peak * 0.45) && !d.pending.length) dir_threat(game, d, st, t);
  else if (d.phase === 'peak' && !d.pending.length && (t >= d.phase_until || (d.tension < 25 && t - d.last_threat > 50))) {
    d.phase = 'release'; d.phase_until = t + st.release; game.msg('It passes. For now, the road is yours.', 'dir');
  } else if (d.phase === 'release' && t >= d.phase_until) { d.phase = 'build'; d.phase_until = t + game.rng.randint(st.wait[0], st.wait[1]); }
}

// while you are indoors, the people waiting outside for you are not safe: the dead find them
function dir_siege(game, d, t) {
  if (d.stage < 4 || t - d.inside_since < 50 || t - d.last_siege < 400 || game.final) return;
  const allies = memory_allies(game);
  if (!allies.length || game.rng.random() >= 0.35 || dir_in_trouble(game)) return;
  d.last_siege = t;
  const ally = allies[0], lv = game.world.level, n = 2 + Math.floor(d.stage / 4);
  let placed = 0;
  for (let k = 0; k < 40 && placed < n; k++) {
    const spot = lv.free_spot_near(ally.x + game.rng.randint(-5, 5), ally.y + game.rng.randint(-5, 5), 2);
    if (spot && cheb(spot, apos(ally)) >= 3) { const z = spawn_zombie(game, lv, spot, null, false); z.state = 'hunt'; z.target = apos(ally); z.stimulus_turn = game.clock.turn; placed++; }
  }
  if (placed) game.msg(`Through the walls, faint: ${ally.name} - shouting, then barking, then nothing you can make out. Whatever is out there is on them.`, 'dir', true);
}

function dir_stage(game, d, t) {
  let idx = dir_stage_index(dir_progress(game));
  if (game.scenario.escalates) idx = Math.min(idx, DIR_STAGES.length - 2);
  else if (idx < d.stage) idx = d.stage;                      // a story does not run backwards
  if (d.done.length && idx === d.stage) return;
  const first = !d.done.length;
  d.stage = idx;
  const st = DIR_STAGES[idx];
  if (d.done.includes(st.id) && !game.scenario.escalates) return;
  if (!d.done.includes(st.id)) d.done.push(st.id);
  const goal = (game.objectives().find((o) => !o[1]) || ['see it through'])[0];
  if (!first) {
    game.msg(`ACT ${idx + 1}: ${st.title}.`, 'dir', true);
    game.msg(st.cue.replace('{goal}', goal).replace('{refuge}', game.era.refuge), 'dir');
  }
  const c = comp_current(game), lines = CONTENT.director.act_lines[st.id];
  if (c && lines && t > 30) comp_say(game, c, lines[0]);
  d.phase = 'build'; d.phase_until = t + game.rng.randint(st.wait[0], st.wait[1]);
  dir_beat(game, d, st, t);
}

function dir_beat(game, d, st, t) {
  if (st.beat === 'call') game.reveal_random_lead();
  else if (st.beat === 'mentor') { if (game.reveal_random_lead()) game.msg('A scrap of knowledge from the road: someone tells you where to look.', 'dir'); }
  else if (st.beat === 'allies') pets_stray_beat(game);
  else if (st.beat === 'threshold') { d.pending.push([t + 15, 'horde', 3]); game.msg('The first test is on its way. Be ready.', 'dir'); }
  else if (st.beat === 'approach') {
    const site = game.pois[game.final_site_id];
    if (site && !site.revealed) { site.revealed = true; game.msg(`You learn where it is: ${site.name} is marked on your map.`, 'dir'); }
  } else if (st.beat === 'ordeal') { d.pending.push([t + DIR_TELEGRAPH + 10, 'boss', 1]); game.msg('Something large is coming. You can feel it before you see it.', 'dir'); }
  else if (st.beat === 'reward') {
    for (const [iid, n] of [['medkit', 1], ['food', 2], ['bandage', 2]]) if (game.items[iid]) game.give_item(make_item(iid, n));
    game.msg('In what it left behind: supplies enough to keep going.', 'dir');
    d.phase = 'release'; d.phase_until = t + st.release;
    for (const ally of memory_allies(game)) ally.bond = Math.min(100, ally.bond + 6);
    if (memory_allies(game).length) game.msg('You sit, finally. Nobody says anything. It is the closest thing to peace you have had.', 'dir');
  } else if (st.beat === 'chase') d.pending.push([t + 20, 'horde', 5]);
}

function dir_threat(game, d, st, t) {
  const rng = game.rng, power = dir_power(game);
  const size = Math.max(2, Math.round((2 + st.peak / 22.0) * (0.6 + 0.4 * power)));
  let kind = d.stage >= 4 ? rng.choice(['horde', 'horde', 'raiders', 'special']) : 'horde';
  if (kind === 'raiders' && game.era.id === 'scifi' && rng.random() < 0.3) kind = 'horde';
  d.pending.push([t + DIR_TELEGRAPH, kind, size]);
  d.phase = 'peak'; d.phase_until = t + DIR_PEAK_MAX; d.threats += 1; d.last_threat = t;
  if (game.level !== game.world.level) game.msg({ horde: 'Something knocks against the walls. More than one thing.', raiders: 'A door, far below. Careful hands. They are not here to talk.', special: 'A sound you have not heard before, somewhere in the building.' }[kind], 'dir');
  else game.msg({ horde: 'A restlessness runs through the dead. Something is coming this way.', raiders: 'Voices, off the road. People who are not friendly.', special: 'A sound you have not heard before, far off.' }[kind], 'dir');
}

function dir_due(game, d, t) {
  for (const item of d.pending.slice()) {
    const [due, kind, size] = item;
    if (t < due || game.level.kind === 'haven' || game.level.safe) continue;
    d.pending.splice(d.pending.indexOf(item), 1);
    dir_land(game, d, kind, size);
  }
}

function dir_strongest(game) {
  let best = 'walker', hp = 0;
  for (const [sid, , first_day] of game.profile.specials) {
    const sp = CONTENT.specials[sid];
    if (first_day <= game_day(game) + 2 && sp.hp > hp && !sp.flags.includes('boss')) { best = sid; hp = sp.hp; }
  }
  return best;
}

function dir_land_indoors(game, d, kind, size) {
  const p = game.player, lv = game.level, rng = game.rng;
  const floor = [];
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (lv.tile(x, y) === T.FLOOR && lv.free(x, y)) floor.push([x, y]);
  let spots = [];
  for (const gap of [9, 6, 4, 3]) { spots = floor.filter((q) => cheb(q, apos(p)) >= gap); if (spots.length) break; }   // a small house has no room to spare
  if (!spots.length) return;
  rng.shuffle(spots);
  const where = compass(spots[0][0] - p.x, spots[0][1] - p.y);
  if (kind === 'raiders') {
    const entry = lv.entry; let placed = 0;
    for (let i = 0; i < Math.max(2, Math.min(4, size)); i++) {
      const spot = lv.free_spot_near(entry[0], entry[1], 3);
      if (spot && cheb(spot, apos(p)) >= 4) { const r = make_raider(game, spot[0], spot[1]); r.state = 'hunt'; lv.add_actor(r); placed++; }
    }
    if (placed) game.msg('Boots on the stairs behind you. People who followed you in.', 'dir', true);
    return;
  }
  const n = kind === 'horde' ? Math.max(2, Math.min(8, size)) : 1;
  for (const spot of spots.slice(0, n)) {
    const sid = (kind === 'special' || kind === 'boss') ? dir_strongest(game) : null;
    const z = spawn_zombie(game, lv, spot, sid, false);
    z.state = 'hunt'; z.target = apos(p); z.stimulus_turn = game.clock.turn;
    if (kind === 'boss') z.hp = z.max_hp = Math.trunc(z.max_hp * 1.3);
  }
  if (kind === 'horde') game.msg(`The dead have found a way in: shuffling, to the ${where}, and more behind.`, 'dir');
  else if (kind === 'special') game.msg(`Something heavy is moving through the building, from the ${where}.`, 'dir');
  else game.msg(`It was in here with you all along: to the ${where}, and it knows exactly where you are.`, 'dir', true);
}

function dir_land(game, d, kind, size) {
  if (game.level !== game.world.level) { dir_land_indoors(game, d, kind, size); return; }
  const p = game.player, lv = game.world.level, rng = game.rng;
  if (kind === 'raiders') {
    const before = game.level.actors.reduce((m, a) => Math.max(m, a.uid), 0);
    game.spawn_raiders_near_player(Math.max(2, Math.min(5, size))); game.msg('Raiders step out of the cover!', 'dir'); memory_revenge(game, before); return;
  }
  let pos = null;
  for (let k = 0; k < 40; k++) {
    const ang = rng.uniform(0, TAU), r = rng.randint(15, 21), q = [Math.trunc(p.x + Math.cos(ang) * r), Math.trunc(p.y + Math.sin(ang) * r)];
    if (q[0] > 2 && q[0] < lv.w - 2 && q[1] > 2 && q[1] < lv.h - 2 && lv.free(q[0], q[1])) { pos = q; break; }
  }
  if (!pos) return;
  const where = compass(pos[0] - p.x, pos[1] - p.y);
  if (kind === 'horde') { spawn_horde(game, pos, size * 2, apos(p)); game.msg(`The dead are coming from the ${where}.`, 'dir'); }
  else if (kind === 'special' || kind === 'boss') {
    const sid = dir_strongest(game), z = spawn_zombie(game, lv, pos, sid, false);
    if (kind === 'boss') { z.hp = z.max_hp = Math.trunc(z.max_hp * 1.3); }
    const aim = kind === 'boss' ? memory_allies(game)[0] : null;
    z.state = 'hunt'; z.target = aim ? apos(aim) : apos(p); z.stimulus_turn = game.clock.turn;
    if (kind === 'boss') { spawn_horde(game, pos, 3, apos(p)); game.msg(`It comes from the ${where}: a ${profile_name_of(game.profile, sid).toLowerCase()}, and it has not come alone.` + (aim ? ` It is heading for ${aim.name} first.` : ''), 'dir', true); }
    else game.msg(`A ${profile_name_of(game.profile, sid).toLowerCase()} is hunting you, from the ${where}.`, 'dir');
  }
}
