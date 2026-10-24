// ---------------------------------------------------------------- the endless world: phases, world events, your people (web only)
// Endless used to be one curve (the dead get stronger every day) and the hero's journey on a loop. Now the world itself moves on:
// it goes through phases that change the rules (what is on the shelves, what grows, what things cost, what the factions do),
// world events are announced and land on real places, and your base becomes somewhere people live and work. It ends three
// ways besides death: a cure made in your own laboratory, an exodus in something you built, or a sanctuary of allied outposts.
const SAGA_PHASES = [
  { id: 'collapse', from: 1, name: 'The Collapse', restock: 0.4, forage: 1.0, price: 1.0, wander: 1.0, gap: [2, 3],
    blurb: 'Everyone is still running. Doors hang open, shelves are full, and people will still follow a stranger.',
    events: ['airdrop', 'broadcast', 'fog', 'migration'] },
  { id: 'scramble', from: 5, name: 'The Scramble', restock: 0.3, forage: 1.0, price: 1.1, wander: 1.1, gap: [2, 3],
    blurb: 'Whoever is left is taking what they can. Buildings are being barricaded, and the roads have tolls on them now.',
    events: ['airdrop', 'broadcast', 'fog', 'migration', 'bombing', 'plague', 'bloodmoon', 'mutation'] },
  { id: 'holdouts', from: 13, name: 'The Holdouts', restock: 0.25, forage: 0.9, price: 1.2, wander: 1.15, gap: [2, 3],
    blurb: 'The lines are drawn. Every building worth having belongs to someone, and they have started wanting each other\'s.',
    events: ['war', 'procession', 'warlord', 'bombing', 'plague', 'bloodmoon', 'mutation', 'migration', 'broadcast', 'airdrop'] },
  { id: 'winter', from: 26, name: 'The Long Winter', restock: 0.12, forage: 0.6, price: 1.5, wander: 1.25, gap: [1, 3],
    blurb: 'Nothing grows and nothing is left on the shelves. What you have is what you made, and what you can take.',
    events: ['cold', 'famine', 'war', 'warlord', 'bloodmoon', 'mutation', 'migration', 'plague', 'procession', 'airdrop'] },
  { id: 'endtimes', from: 41, name: 'The End of Days', restock: 0.08, forage: 0.5, price: 1.8, wander: 1.4, gap: [1, 2],
    blurb: 'The dead outnumber everything. The last strongholds are falling one by one, and the old refuge will not stand forever.',
    events: ['refuge_falls', 'bloodmoon', 'mutation', 'migration', 'war', 'cold', 'famine', 'bombing'] },
];
// where the Director's journey sits in each phase (it walks this window instead of looping the whole story)
const SAGA_DIR_WINDOW = [[0.0, 0.27], [0.2, 0.6], [0.28, 0.8], [0.55, 0.86], [0.7, 0.95]];        // in acts: 1-5, 5-7, 6-8, 7-10, 8-11
const SAGA_UNIQUE = ['warlord', 'refuge_falls'];
const SAGA_CURE_RESEARCH = 100, SAGA_SANCTUARY_ALLIES = 3, SAGA_SANCTUARY_DAY = 20, SAGA_LOG = 40;

Object.assign(CONTENT.scenarios.endless, {
  blurb: 'No way out and no clock, and the world does not stand still: it goes through phases, factions take buildings and lose them, '
    + 'and events land on real places. Hold a base, gather people, and end it your way: a cure from your own laboratory, an exodus, '
    + 'or a sanctuary of allies. Or simply live.',
  goal: 'Hold a base and keep your people alive; end it with a cure, an exodus or a sanctuary, or just survive.',
  premise: 'Nobody is coming. The city is breaking into pieces: soldiers, civilians, raiders, a cult and a handful of people still '
    + 'looking for a cure, each holding what buildings they can. {refuge} still stands, for now. Find somewhere to hold, find people '
    + 'to hold it with, and decide how this ends: with a cure, with a way out you build yourself, or with enough allies that the dead '
    + 'stop mattering. Every day the world is a little different, and a little worse.',
  premise_living: 'Nobody is coming. The factions are carving up the city, and every day the world is a little different and a little '
    + 'worse. Hold a base and the people in it; if you fall, another survivor wakes there and carries on.',
});
CONTENT.story.SCENARIO_TAIL.endless = 'No way out and no clock, but the world keeps moving. Find walls, then find people to stand behind them.';
for (const [kind, texts] of Object.entries({
  exodus: { saint: ['Exodus', 'The gate closes behind you for the last time. Everyone who trusted you is aboard, and nobody was left on the step.'],
            survivor: ['Exodus', 'You leave with the people who stayed. Behind you the base goes dark, and the dead walk in to an empty house.'],
            cold: ['Exodus, half full', 'There was room for more. You did not wait to find out who they would have been.'],
            monster: ['Gone', 'You take the vehicle and the people who were afraid to say no. Nobody waves you off.'] },
  sanctuary: { saint: ['Sanctuary', 'The fires answer from every rooftop you made a friend on. The dead still walk, but here, now, the living have the city back.'],
               survivor: ['Sanctuary', 'Not a cure and not a way out: a line on the map that the dead do not cross any more. It will do.'],
               cold: ['A cold peace', 'The outposts hold together because they are afraid of the alternative. Of you, a little, too.'],
               monster: ['The new order', 'They answer when you call because they know what happens when someone does not.'] },
})) for (const [band, v] of Object.entries(texts)) CONTENT.win_endings[`${kind}|${band}`] = v;

// Where you are on the map: indoors, the door of the building you are in.
function world_pos(game) { if (game.level === game.world.level) return apos(game.player); const poi = game.poi_of_level(game.level); return poi ? poi_pos(poi) : apos(game.player); }
const saga_phase_index = (game) => { const day = game_day(game); let i = 0; SAGA_PHASES.forEach((p, k) => { if (day >= p.from) i = k; }); return i; };
const saga_phase = (game) => SAGA_PHASES[saga_phase_index(game)];
const saga_built = (game, id) => !!(game.saga && game.saga.built.includes(id));
const saga_base_level = (game) => (game.base_id && game.levels[game.base_id]) || null;
const saga_base_poi = (game) => (game.base_id ? game.pois[game.base_id.split(':')[0]] : null);
function saga_capacity(game) { const lv = saga_base_level(game); return lv ? 1 + 2 * Object.values(lv.built).filter((v) => v === 'cot').length : 0; }

function saga_setup(game) {
  if (!game.scenario.escalates || game.cfg.mode === 'shared') return;
  game.saga = { phase: 0, factions: {}, outposts: {}, residents: [], rid: 0, progress: {}, built: [], building: '', events: [], queue: [],
                next_event: 240 + game.rng.randint(60, 200), special_boost: 0, research: 0, warlord: null, refuge_fallen: false, done: [],
                log: [], deserted: false, refugees_at: 240 * 4 };
  factions_setup(game);
}

// The world's mood as a multiplier: the phase, and whatever is happening right now.
function saga_mod(game, key) {
  const S = game.saga;
  if (!S) return 1.0;
  let v = SAGA_PHASES[saga_phase_index(game)][key];
  if (v === undefined) v = 1.0;
  for (const e of S.events) if (e.started && SAGA_EVENTS[e.id].mods && SAGA_EVENTS[e.id].mods[key] !== undefined) v *= SAGA_EVENTS[e.id].mods[key];
  return v;
}
function saga_forced_weather(game) {
  const S = game.saga;
  if (!S) return '';
  const e = S.events.find((ev) => ev.started && SAGA_EVENTS[ev.id].weather);
  return e ? SAGA_EVENTS[e.id].weather : '';
}
const saga_event_on = (game, id) => !!(game.saga && game.saga.events.some((e) => e.id === id && e.started));

function saga_dir_progress(game) {
  const [lo, hi] = SAGA_DIR_WINDOW[saga_phase_index(game)];
  return lo + (hi - lo) * (((game.clock.turn / 240.0) % 3.0) / 3.0);
}

// ---- the clock of the world
function saga_tick(game) {
  const S = game.saga;
  if (!S || game.over) return;
  const t = game.clock.turn;
  if (t % 240 === 0) saga_daily(game);
  if (t % 240 === 60) saga_morning(game);
  if (t % 10 === 0) { saga_events_tick(game); saga_sieges_tick(game); outpost_check_taken(game); saga_warlord_check(game); }
  if (t % 5 === 0) saga_flush_queue(game);
}

function saga_note(game, text, poi_id = null) {
  const S = game.saga;
  S.log.push([game_day(game), text]);
  if (S.log.length > SAGA_LOG) S.log.splice(0, S.log.length - SAGA_LOG);
  if (poi_id && saga_built(game, 'radio')) game.pois[poi_id].revealed = true;
}

function saga_daily(game) {
  const S = game.saga, t = game.clock.turn, day = game_day(game), ph = saga_phase_index(game);
  if (ph !== S.phase) {
    S.phase = ph;
    const P = SAGA_PHASES[ph];
    game.msg(`Day ${day}. ${P.name}. ${P.blurb}`, 'dir', true);
    saga_note(game, `${P.name} begins.`);
    if (P.id === 'holdouts' && !S.deserted) saga_desertion(game);
  }
  const report = [];
  factions_daily(game, report);
  saga_sieges_daily(game, report);
  saga_schedule(game);
  saga_night_raid(game);
  if (day > 1 && day % 4 === 0) game._restock(saga_mod(game, 'restock'));
  if (saga_base_level(game) && ph >= 1 && t >= S.refugees_at && S.residents.length < saga_capacity(game) && game.rng.random() < (saga_built(game, 'radio') ? 0.5 : 0.25)) {
    S.refugees_at = t + 240 * 3;
    saga_refugees(game);
  }
  const radio = saga_built(game, 'radio'), here = world_pos(game), heard = report.filter(([, pid]) => radio || !pid || game.pois[pid].revealed || cheb(poi_pos(game.pois[pid]), here) <= 90);
  for (const [text, pid] of report) saga_note(game, text, pid);
  if (heard.length) {
    game.msg(`News from the city: ${heard[0][0]}` + (heard.length > 1 ? ` (and ${heard.length - 1} more: The world, in the menu)` : ''), 'dir', true);
    for (const [text] of heard.slice(1, 4)) game.msg(text, 'lore');
  }
}

// The soldiers break: half their outposts turn raider.
function saga_desertion(game) {
  const S = game.saga, mil = outposts_of(game, 'military');
  S.deserted = true;
  S.factions.military.str = Math.max(0, S.factions.military.str - 25);
  S.factions.raiders.str = Math.min(100, S.factions.raiders.str + 15);
  const lost = mil.slice(0, Math.ceil(mil.length / 2));
  for (const o of lost) { o.owner = 'raiders'; o.admitted = false; o.hostile = false; o.cleared = 'raiders'; }
  const names = lost.map((o) => game.pois[o.id].name).join(', ');
  game.msg(`${faction_name(game, 'military')} are coming apart. Deserters keep their rifles and call themselves something else now` + (names ? `: ${names} belong to raiders.` : '.'), 'bad', true);
  saga_note(game, `Desertion: ${faction_name(game, 'military')} lost ${lost.length} outpost${lost.length === 1 ? '' : 's'} to their own deserters.`);
}

// ---- sieges: the dead at the door of someone else's outpost, and a call for help
function saga_sieges_daily(game, report) {
  const S = game.saga, t = game.clock.turn, rng = game.rng;
  for (const o of Object.values(S.outposts)) {
    if (o.siege_until && t >= o.siege_until) {
      o.siege_until = 0; o.siege_spawned = false;
      o.garrison -= 2;
      if (o.garrison <= 0) outpost_fall(game, o, null, report);
      else report.push([`${game.pois[o.id].name} held off the dead, at a cost. Nobody came.`, o.id]);
    }
  }
  if (saga_phase_index(game) < 1 || rng.random() >= 0.22) return;
  const pool = Object.values(S.outposts).filter((o) => o.owner && o.owner !== 'raiders' && !o.siege_until && o.garrison > 0);
  if (!pool.length) return;
  const o = rng.choice(pool), poi = game.pois[o.id], [px, py] = world_pos(game);
  o.siege_until = t + 480; o.siege_spawned = false;
  if (saga_built(game, 'radio') || cheb(poi_pos(poi), [px, py]) <= 90) {
    poi.revealed = true;
    game.msg(`${cap(game.era.radio)}, a voice you do not know: ${poi.name} is surrounded. ${faction_name(game, o.owner)} are asking anyone who can hear. (${compass(poi.x - px, poi.y - py)}, ${dist_words(game.era.id, cheb(poi_pos(poi), [px, py]))})`, 'obj', true);
  }
}

function saga_sieges_tick(game) {
  const S = game.saga, p = game.player, lv = game.world.level;
  if (game.level !== lv) return;
  for (const o of Object.values(S.outposts)) {
    if (!o.siege_until) continue;
    const poi = game.pois[o.id];
    if (!o.siege_spawned) {
      if (cheb(poi_pos(poi), apos(p)) > 16) continue;
      o.siege_spawned = true;
      const n = 4 + 2 * saga_phase_index(game);
      for (let i = 0; i < n * 3 && lv.actors.filter((a) => a.siege === o.id).length < n; i++) {
        const spot = lv.free_spot_near(poi.x + game.rng.randint(-6, 6), poi.y + game.rng.randint(1, 5), 2);
        if (spot && cheb(spot, apos(p)) >= 4) { const z = spawn_zombie(game, lv, spot, null, false); z.siege = o.id; z.state = 'investigate'; z.target = [poi.x, poi.y + 1]; z.stimulus_turn = game.clock.turn; }
      }
      game.msg(`The dead are packed around the doors of ${poi.name}, clawing at the barricades.`, 'warn', true);
      continue;
    }
    if (lv.actors.some((a) => a.siege === o.id && a.hp > 0)) continue;
    o.siege_until = 0; o.siege_spawned = false;
    o.garrison = Math.min(OUTPOST_MAX_GARRISON, o.garrison + 1);
    game.rep[o.owner] = (game.rep[o.owner] || 0) + 15;
    p.gain_xp(40);
    const gift = game.items.medkit ? 'medkit' : 'bandage';
    game.give_item(make_item(gift, 1));
    game.msg(`The siege of ${poi.name} is broken. ${faction_name(game, o.owner)} come out to shake your hand, and press a ${game.item_def(gift).name.toLowerCase()} on you.`, 'good', true);
    saga_note(game, `You broke the siege of ${poi.name}.`);
  }
}

// ---- world events: announced, then they land on real places
const SAGA_EVENTS = {
  airdrop: {
    name: 'Supply drop', days: 3, warn: 90,
    pick(game) {
      const [px, py] = world_pos(game), lv = game.world.level;
      for (let k = 0; k < 60; k++) {
        const ang = game.rng.uniform(0, TAU), r = game.rng.randint(28, 60);
        const q = [Math.trunc(px + Math.cos(ang) * r), Math.trunc(py + Math.sin(ang) * r)];
        if (q[0] < 6 || q[1] < 6 || q[0] > lv.w - 7 || q[1] > lv.h - 7) continue;
        return { x: q[0], y: q[1], sprung: false };
      }
      return null;
    },
    warn_text: (game, e) => { const [px, py] = world_pos(game); return `${cap(game.era.radio)}: ${({ medieval: 'a supply train has been abandoned on the road', eighties: 'a transport plane is going to drop supplies', modern: 'a drone is going to drop supplies', scifi: 'an orbital cargo pod is coming down' })[game.era.id]}, somewhere to the ${compass(e.data.x - px, e.data.y - py)}. Everyone heard it.`; },
    start(game, e) {
      const lv = game.world.level;
      gen_near(game, e.data.x, e.data.y, 1);
      const spot = lv.free_spot_near(e.data.x, e.data.y, 6) || [e.data.x, e.data.y];
      e.data.x = spot[0]; e.data.y = spot[1];
      lv.set_tile(spot[0], spot[1], T.CRATE);
      lv.containers[lv.idx(spot[0], spot[1])] = { loot: roll_items(game.rng, game.era, 'military', 5, game.diff.loot), docs: [], coins: game.rng.randint(5, 15), opened: false, note: '' };
      const [px, py] = world_pos(game);
      game.msg(`The drop is down, ${compass(spot[0] - px, spot[1] - py)}, ${dist_words(game.era.id, cheb(spot, [px, py]))}. You will not be the only one going for it.`, 'obj', true);
    },
    tick(game, e) {
      const p = game.player;
      if (e.data.sprung || game.level !== game.world.level || cheb([e.data.x, e.data.y], apos(p)) > 12) return;
      e.data.sprung = true;
      if (faction_attitude(game, 'raiders') === 'hostile') { raiders_ambush(game, game.level, 3 + saga_phase_index(game)); game.msg('Somebody else got here first, and they have been waiting for whoever came next.', 'bad', true); }
    },
    end(game, e) {
      const lv = game.world.level, k = lv.idx(e.data.x, e.data.y), c = lv.containers[k];
      if (c && !c.opened) { c.opened = true; c.loot = []; c.coins = 0; lv.set_tile(e.data.x, e.data.y, T.CRATE_OPEN); game.msg('Word is the supply drop has been picked clean by someone else.', 'info'); }
    },
    marker: (game, e) => (e.started ? [e.data.x, e.data.y, '#d4a52a', '!'] : null),
  },
  broadcast: {
    name: 'A voice on the air', days: 3, warn: 40,
    pick(game) {
      const here = world_pos(game), pool = Object.values(game.pois).filter((q) => OUTPOST_KINDS.includes(q.kind) && !outpost_of(game, q.id) && cheb(poi_pos(q), here) >= 25 && cheb(poi_pos(q), here) <= 90);
      if (!pool.length) return null;
      return { poi: game.rng.choice(pool).id, real: game.rng.random() < 0.45, done: false };
    },
    warn_text: (game, e) => `${cap(game.era.radio)} crackles: "...anyone hearing this, there are people at ${game.pois[e.data.poi].name}. Food, a doctor. Come to the front..." It repeats, and repeats.`,
    start(game, e) { game.pois[e.data.poi].revealed = true; },
    tick(game, e) {
      const poi = game.pois[e.data.poi], p = game.player;
      if (e.data.done || game.level !== game.world.level || cheb(poi_pos(poi), apos(p)) > 5) return;
      e.data.done = true;
      if (e.data.real) {
        for (const [iid, n] of [['food', 3], ['medkit', 1], ['bandage', 2]]) if (game.items[iid]) game.give_item(make_item(iid, n));
        game.msg(`The broadcast was true. A handful of people are holed up at ${poi.name}, and they share what they have.`, 'good', true);
        if (saga_base_level(game) && game.saga.residents.length < saga_capacity(game)) { const r = saga_add_resident(game, null, 'enclave'); game.msg(`${r.name} asks if your place has room. It does: they will make their way there.`, 'good'); }
        else comp_offer_stranger(game, 1.0);
      } else {
        raiders_ambush(game, game.level, 4);
        game.msg('There is nobody here but the people who made the broadcast, and they are not doctors.', 'bad', true);
      }
    },
    marker: (game, e) => (e.started && !e.data.done ? [game.pois[e.data.poi].x, game.pois[e.data.poi].y, '#58b878', '?'] : null),
  },
  fog: {
    name: 'The grey', days: 2, warn: 30, weather: 'fog',
    warn_text: (game) => (game.era.id === 'scifi' ? 'The scrubbers are failing. A haze is creeping along the decks.' : 'The air has gone thick and wet. By morning you will not see your own hand.'),
    start(game) { game.weather = 'fog'; game.msg('The grey comes down and stays down. Sound carries strangely; sight does not carry at all.', 'warn', true); },
    end(game) { game.msg('The grey lifts.', 'info'); },
  },
  migration: {
    name: 'The migration', days: 3, warn: 120,
    pick(game) {
      const lv = game.world.level, [px, py] = world_pos(game), rng = game.rng, side = rng.randint(0, 3);
      const edge = [[4, py], [lv.w - 5, py], [px, 4], [px, lv.h - 5]][side], far = [[lv.w - 5, py], [4, py], [px, lv.h - 5], [px, 4]][side];
      const jitter = (q) => [Math.max(4, Math.min(lv.w - 5, q[0] + rng.randint(-20, 20))), Math.max(4, Math.min(lv.h - 5, q[1] + rng.randint(-20, 20)))];
      return { from: jitter(edge), to: jitter(far), horde: 0 };
    },
    warn_text: (game, e) => { const [px, py] = world_pos(game); return `The animals are running ${compass(e.data.to[0] - e.data.from[0], e.data.to[1] - e.data.from[1])}. Something enormous is moving in from the ${compass(e.data.from[0] - px, e.data.from[1] - py)}: not a horde, a migration. Get under a roof, or get out of its way.`; },
    start(game, e) {
      const h = spawn_horde(game, e.data.from, 26 + 4 * saga_phase_index(game), e.data.to.slice());
      if (h) { h.migration = true; e.data.horde = h.id; }
      const [px, py] = world_pos(game);
      game.msg(`The migration has begun, from the ${compass(e.data.from[0] - px, e.data.from[1] - py)}.`, 'bad', true);
    },
    tick(game, e) {
      const h = game.hordes.find((q) => q.id === e.data.horde);
      if (h) { h.target = e.data.to.slice(); if (cheb([h.x, h.y], e.data.to) <= 3) game.hordes.splice(game.hordes.indexOf(h), 1); }
    },
    end(game, e) { const i = game.hordes.findIndex((q) => q.id === e.data.horde); if (i >= 0) game.hordes.splice(i, 1); },
  },
  bombing: {
    name: 'Firebreak', days: 0.25, warn: 200,
    pick(game) {
      const here = world_pos(game), base = saga_base_poi(game);
      const pool = Object.values(game.pois).filter((q) => !SPECIAL_KINDS.includes(q.kind) && q.kind !== 'house' && cheb(poi_pos(q), here) >= 30 && (!base || cheb(poi_pos(q), poi_pos(base)) >= 20));
      if (!pool.length) return null;
      const bad = pool.filter((q) => { const o = outpost_of(game, q.id); return o && (o.owner === 'cult' || o.owner === 'raiders' || o.overrun); });
      const q = game.rng.choice(bad.length ? bad : pool);
      return { x: q.x, y: q.y, r: 12, poi: q.id };
    },
    warn_text: (game, e) => `${({ medieval: 'The Baron\'s heralds', eighties: 'Loudspeakers on a passing jeep', modern: 'An emergency broadcast', scifi: 'Station command' })[game.era.id]}: the district around ${game.pois[e.data.poi].name} will be ${({ medieval: 'put to the torch', eighties: 'firebombed', modern: 'firebombed', scifi: 'vented to space' })[game.era.id]} tomorrow. Anyone still there will not be.`,
    start(game, e) {
      const lv = game.world.level, p = game.player, report = [];
      for (const q of Object.values(game.pois)) {
        if (cheb(poi_pos(q), [e.data.x, e.data.y]) > e.data.r || SPECIAL_KINDS.includes(q.kind)) continue;
        q.burned = true;
        const ilv = game.levels[poi_level_id(q)];
        if (ilv && ilv !== game.level) saga_burn_level(game, ilv);
        const o = outpost_of(game, q.id);
        if (o && o.owner) { o.garrison -= 3; if (o.garrison <= 0) outpost_fall(game, o, null, report); }
      }
      for (const a of lv.actors.slice()) if (a.kind === 'zombie' && cheb(apos(a), [e.data.x, e.data.y]) <= e.data.r && game.rng.random() < 0.8) lv.remove_actor(a);
      for (let i = 0; i < 30; i++) {
        const x = e.data.x + game.rng.randint(-e.data.r, e.data.r), y = e.data.y + game.rng.randint(-e.data.r, e.data.r);
        if (world_ready(game.world, x, y) && lv.walkable(x, y)) lv.hazards[lv.idx(x, y)] = { kind: 'fire', ttl: 40 };
      }
      if (game.level === lv && cheb(apos(p), [e.data.x, e.data.y]) <= e.data.r) { game.msg('The sky turns white. You are inside it.', 'bad', true); damage_player(game, 15, 'burned in the firebreak'); }
      else game.msg(`To the ${compass(e.data.x - world_pos(game)[0], e.data.y - world_pos(game)[1])} the sky turns orange, and the ground shakes. The district around ${game.pois[e.data.poi].name} is burning.`, 'bad', true);
      for (const [text] of report) game.msg(text, 'lore');
    },
  },
  mutation: {
    name: 'The change', days: 0.1, warn: 0,
    start(game) {
      game.saga.special_boost = Math.min(2.0, game.saga.special_boost + 0.4);
      game.msg('Something has changed in the dead overnight. There are more of the strange ones now, and they are not going away.', 'bad', true);
      saga_note(game, 'The dead changed: more of the strange ones, for good.');
    },
  },
  bloodmoon: {
    name: 'Blood moon', days: 0.45, warn: 150, at_hour: 19, mods: { wander: 2.5, raid: 5 },
    warn_text: () => 'Tonight the moon comes up red. Everybody knows what that means now. Be behind walls by dusk.',
    start(game) { game.msg('The moon comes up red, and every one of the dead lifts its head.', 'bad', true); },
    end(game) {
      const report = [];
      for (const o of Object.values(game.saga.outposts)) if (o.owner && o.garrison > 0 && game.rng.random() < 0.5) { o.garrison -= 1; if (o.garrison <= 0) outpost_fall(game, o, null, report); }
      for (const [text, pid] of report) saga_note(game, text, pid);
      game.msg('Dawn, finally. The blood moon is down.' + (report.length ? ' Not everyone made it through the night.' : ''), 'info', true);
    },
  },
  plague: {
    name: 'The fever', days: 3, warn: 60,
    pick(game) {
      const pool = Object.values(game.saga.outposts).filter((o) => ['enclave', 'science', 'cult'].includes(o.owner) && o.garrison >= 2 && !o.sick_until);
      return pool.length ? { id: game.rng.choice(pool).id } : null;
    },
    warn_text: (game, e) => `Word from ${game.pois[e.data.id].name}: a fever, and not the bite. They are asking for medicine.`,
    start(game, e) { const o = game.saga.outposts[e.data.id]; o.sick_until = game.clock.turn + 240 * 3; game.pois[e.data.id].revealed = true; },
    end(game, e) {
      const o = game.saga.outposts[e.data.id];
      if (!o.sick_until) return;
      o.sick_until = 0; o.garrison -= 2;
      const report = [];
      if (o.garrison <= 0) outpost_fall(game, o, null, report);
      game.msg(report.length ? `The fever burned through ${game.pois[o.id].name}, and the sick did not stay dead.` : `The fever at ${game.pois[o.id].name} has run its course. Not everyone is left.`, 'warn', true);
    },
    marker: (game, e) => (e.started && game.saga.outposts[e.data.id].sick_until ? [game.pois[e.data.id].x, game.pois[e.data.id].y, '#6a9a32', '+'] : null),
  },
  war: {
    name: 'War', days: 4, warn: 0,
    pick(game) {
      const S = game.saga, live = SAGA_FACTIONS.filter((f) => f !== 'raiders' && S.factions[f].str > 0 && outposts_of(game, f).length);
      const pairs = [];
      for (const a of live) for (const b of live) if (a < b) pairs.push([a, b]);
      if (!pairs.length) return null;
      const [a, b] = game.rng.choice(pairs);
      return { a, b };
    },
    start(game, e) {
      const a = faction_name(game, e.data.a), b = faction_name(game, e.data.b);
      game.msg(`${a} and ${b} are at war. Bodies in the streets between their buildings, and no one picking them up.`, 'bad', true);
      saga_queue(game, { kind: 'war', title: 'War', a: e.data.a, b: e.data.b,
        text: `${a} and ${b} have gone to war. Both have sent someone to find you: they have heard you can be useful. Whoever you help will remember. So will the other side.`,
        choices: [{ label: `Side with ${a}`, needs: {} }, { label: `Side with ${b}`, needs: {} }, { label: 'Stay out of it', needs: {} }] });
    },
    end(game, e) {
      const S = game.saga, [w, l] = S.factions[e.data.a].str >= S.factions[e.data.b].str ? [e.data.a, e.data.b] : [e.data.b, e.data.a];
      game.msg(`The war is over, for now. ${faction_name(game, w)} came out of it stronger than ${faction_name(game, l)}.`, 'info', true);
      saga_note(game, `The war ended: ${faction_name(game, w)} over ${faction_name(game, l)}.`);
    },
  },
  procession: {
    name: 'The procession', days: 2, warn: 0,
    pick(game) {
      if (game.saga.factions.cult.str <= 10) return null;
      const pool = Object.values(game.saga.outposts).filter((o) => (o.owner === 'enclave' || o.owner === 'science') && o.garrison > 0);
      return pool.length ? { target: game.rng.choice(pool).id, met: false, stopped: false } : null;
    },
    start(game, e) {
      const poi = game.pois[e.data.target], [px, py] = world_pos(game);
      poi.revealed = true;
      game.msg(`${faction_name(game, 'cult')} are walking to ${poi.name}, singing, to open its doors to the dead. (${compass(poi.x - px, poi.y - py)}, ${dist_words(game.era.id, cheb(poi_pos(poi), [px, py]))})`, 'obj', true);
    },
    tick(game, e) {
      const poi = game.pois[e.data.target];
      if (e.data.met || game.level !== game.world.level || cheb(poi_pos(poi), apos(game.player)) > 12) return;
      e.data.met = true;
      saga_queue(game, { kind: 'procession', title: 'The procession', target: e.data.target,
        text: `The ${faction_name(game, 'cult')} come up the road towards ${poi.name} in a long line, singing, carrying the keys. Behind them, at a distance, the dead follow the singing.`,
        choices: [{ label: 'Stand in their way', needs: {} }, { label: 'Let them pass', needs: {} }] });
    },
    end(game, e) {
      const o = game.saga.outposts[e.data.target];
      if (e.data.stopped || !o.owner) return;
      const report = [];
      o.garrison = 0; outpost_fall(game, o, null, report);
      game.msg(`The doors of ${game.pois[o.id].name} were opened from the inside. The singing stopped soon after.`, 'bad', true);
    },
    marker: (game, e) => (e.started && !e.data.stopped ? [game.pois[e.data.target].x, game.pois[e.data.target].y, '#b87ad0', '!'] : null),
  },
  warlord: {
    name: 'The warlord', days: 999, warn: 0,
    pick(game) {
      const dens = outposts_of(game, 'raiders');
      if (!dens.length) return null;
      const seat = dens.sort((a, b) => b.garrison - a.garrison)[0], ns = game.nemeses || [];
      const name = ns.length ? ns[0].name.replace(/ \(Lv\d+\)$/, '') : `${game.rng.choice(CONTENT.dialogue.GIVEN[game.era.id])} the ${game.rng.choice(['Iron', 'Butcher', 'Saint', 'Hound', 'Pale'])}`;
      return { name, seat: seat.id };
    },
    start(game, e) {
      const S = game.saga, o = S.outposts[e.data.seat];
      o.warlord = true; o.garrison = Math.max(o.garrison, 5);
      S.warlord = { name: e.data.name, seat: e.data.seat, spawned: false, dead: false, fled: false };
      S.factions.raiders.str = Math.min(100, S.factions.raiders.str + 30);
      game.pois[o.id].revealed = true;
      game.msg(`The raiders have a warlord now: ${e.data.name}, holding court at ${game.pois[o.id].name}. The camps answer to one voice, and it wants the city.`, 'bad', true);
      saga_note(game, `${e.data.name} united the raiders, from ${game.pois[o.id].name}.`);
    },
    tick(game, e) { const W = game.saga.warlord; if (W && (W.dead || W.fled)) e.until = game.clock.turn; },
    marker: (game, e) => { const W = game.saga.warlord; return e.started && W && !W.dead ? [game.pois[W.seat].x, game.pois[W.seat].y, '#e2573f', 'K'] : null; },
  },
  famine: {
    name: 'Famine', days: 3, warn: 60, mods: { price: 1.6, forage: 0.6, food_need: 2 },
    warn_text: () => 'Food is running out everywhere at once. Prices will double by tomorrow, and people will do anything for a meal.',
    start(game) { game.msg('The famine is here. Every bite costs twice what it did, and your people eat twice as much worry.', 'warn', true); },
    end(game) { game.msg('The worst of the famine has passed.', 'info'); },
  },
  cold: {
    name: 'The cold', days: 3, warn: 90, mods: { forage: 0.4, stamina: 0.7, zombie_speed: 0.85, food_need: 1.5 },
    warn_text: (game) => (game.era.id === 'scifi' ? 'Life support is rationing heat. In a day the decks will be freezing.' : 'The wind has turned north. A killing cold is coming, a few days of it.'),
    start(game) { game.msg(game.era.id === 'scifi' ? 'The heat goes. Frost on the bulkheads. The dead slow; so do you.' : 'The cold comes down like a lid. Nothing grows; the dead stiffen; so do your hands.', 'warn', true); },
    end(game) { game.msg('The cold breaks.', 'info'); },
  },
  refuge_falls: {
    name: 'The fall of the refuge', days: 0.1, warn: 120,
    warn_text: (game) => `${cap(game.era.refuge)} has stopped answering. The last thing anyone heard was the sound of the gates.`,
    start(game) {
      const S = game.saga, refuge = game.pois[game.refuge_id];
      S.refuge_fallen = true; refuge.fallen = true;
      const lv = game.levels[poi_level_id(refuge)];
      if (lv) saga_fall_refuge(game, lv);
      game.msg(`${cap(game.era.refuge)} has fallen. There is nowhere left that was here before you; only what you built.`, 'bad', true);
      saga_note(game, `${cap(game.era.refuge)} fell.`);
    },
  },
};

function saga_schedule(game) {
  const S = game.saga, t = game.clock.turn, rng = game.rng;
  if (t < S.next_event) return;
  const ph = SAGA_PHASES[saga_phase_index(game)];
  const pairs = [];
  for (const id of ph.events) {
    if (S.events.some((e) => e.id === id) || (SAGA_UNIQUE.includes(id) && S.done.includes(id))) continue;
    if (id === 'refuge_falls' && (S.refuge_fallen || !saga_base_level(game))) continue;
    pairs.push([id, id === 'warlord' ? 1.8 : id === 'mutation' || id === 'bloodmoon' ? 0.7 : 1.0]);
  }
  while (pairs.length) {
    const id = weighted_choice(rng, pairs), def = SAGA_EVENTS[id];
    pairs.splice(pairs.findIndex((q) => q[0] === id), 1);
    const data = def.pick ? def.pick(game) : {};
    if (!data) continue;
    const warn = Math.floor((def.warn || 0) * (saga_built(game, 'radio') ? 2 : 1));
    let at = t + warn;
    if (def.at_hour !== undefined) { const day0 = Math.floor(t / 240) * 240; at = day0 + def.at_hour * 10; if (at < t + warn) at += 240; }
    const e = { id, at, until: at + Math.round(def.days * 240), data, started: false };
    S.events.push(e);
    if (SAGA_UNIQUE.includes(id)) S.done.push(id);
    if (def.warn_text && warn) game.msg(def.warn_text(game, e), 'obj', true);
    saga_note(game, `${def.name}` + (warn ? ' (announced)' : ''));
    break;
  }
  S.next_event = t + 240 * rng.randint(ph.gap[0], ph.gap[1]) + rng.randint(-60, 60);
}

function saga_events_tick(game) {
  const S = game.saga, t = game.clock.turn;
  for (const e of S.events.slice()) {
    const def = SAGA_EVENTS[e.id];
    if (!e.started && t >= e.at) { e.started = true; if (def.start) def.start(game, e); }
    if (e.started && def.tick) def.tick(game, e);
    if (e.started && t >= e.until) { S.events.splice(S.events.indexOf(e), 1); if (def.end) def.end(game, e); }
  }
}

function saga_warlord_check(game) {
  const W = game.saga.warlord;
  if (!W || W.dead || !W.spawned) return;
  const lv = game.levels[W.seat + ':0'];
  if (!lv || lv.actors.some((a) => a.warlord && a.hp > 0)) return;
  W.dead = true;
  const S = game.saga;
  S.factions.raiders.str = Math.max(0, S.factions.raiders.str - 40);
  game.rep.enclave = (game.rep.enclave || 0) + 20; game.rep.military = (game.rep.military || 0) + 10;
  game.player.gain_xp(120);
  const o = S.outposts[W.seat];
  if (o) o.warlord = false;
  game.msg(`${W.name} is dead. Without the warlord the camps will be at each other's throats by morning.`, 'good', true);
  saga_note(game, `${W.name}, the warlord, is dead.`);
}

// Burned to the walls: nothing left to find, and few of the dead left to find you.
function saga_burn_level(game, lv) {
  for (const [k, c] of Object.entries(lv.containers)) { c.loot = []; c.coins = 0; c.opened = true; lv.set_tile(Number(k) % lv.w, Math.floor(Number(k) / lv.w), T.CRATE_OPEN); }
  for (const a of lv.actors.slice()) if (a.kind === 'zombie' && game.rng.random() < 0.6) lv.remove_actor(a);
  lv.items = {};
}

function saga_fall_refuge(game, lv) {
  for (const a of lv.actors.slice()) if (a.kind === 'human' && !a.hostile && a.uid !== game.companion_uid) { lv.corpses[lv.idx(a.x, a.y)] = [game.clock.turn - 60, 1]; lv.remove_actor(a); }
  for (let i = 0; i < 8; i++) { const s = lv.free_spot_near(lv.entry[0] + game.rng.randint(-8, 8), lv.entry[1] - game.rng.randint(1, 6), 3); if (s && cheb(s, apos(game.player)) > 3) spawn_zombie(game, lv, s, null, game.level !== lv); }
  lv.safe = false;
}

function saga_on_level_created(game, lv, poi) {
  if (!game.saga || !poi) return;
  if (poi.burned) saga_burn_level(game, lv);
  if (poi.kind === 'refuge' && game.saga.refuge_fallen) saga_fall_refuge(game, lv);
}

function saga_on_enter(game, lv) {
  if (!game.saga) return;
  outpost_on_enter(game, lv);
}

// ---- choices the world puts to you, shown when nothing is hunting you
function saga_choice_event(game, spec) { return { event_id: 'saga', text: spec.text, result: '', resolved: false, data: spec }; }
function saga_queue(game, spec) { game.saga.queue.push(spec); }
function saga_flush_queue(game) {
  const S = game.saga;
  if (!S.queue.length || game.pending_event || game.final || game.over || game.visible_hostiles().length) return;
  game.pending_event = saga_choice_event(game, S.queue.shift());
}

function saga_resolve(game, active, index) {
  const d = active.data, choice = d.choices[index];
  if (!choice || !can_afford(game, choice)) return 'You cannot afford that.';
  let text = '';
  if (d.kind === 'gate') text = outpost_gate(game, d, index);
  else if (d.kind === 'war') {
    const S = game.saga;
    if (index < 2) {
      const [mine, other] = index === 0 ? [d.a, d.b] : [d.b, d.a];
      game.rep[mine] = (game.rep[mine] || 0) + 15; game.rep[other] = (game.rep[other] || 0) - 20;
      S.factions[mine].str = Math.min(100, S.factions[mine].str + 15); S.factions[other].str = Math.max(0, S.factions[other].str - 10);
      text = `You give ${faction_name(game, mine)} what you know: routes, numbers, a way in. It tips the balance. ${faction_name(game, other)} will not forget whose side you took.`;
    } else text = 'You send both messengers away with nothing. Neither side thanks you for it.';
  } else if (d.kind === 'procession') {
    const e = game.saga.events.find((ev) => ev.id === 'procession');
    if (index === 0) {
      if (e) e.data.stopped = true;
      game.rep.cult = (game.rep.cult || 0) - 30;
      const o = game.saga.outposts[d.target];
      if (o.owner) game.rep[o.owner] = (game.rep[o.owner] || 0) + 15;
      const lv = game.level, p = game.player, group = [];
      for (let i = 0; i < 3 + saga_phase_index(game) / 2; i++) {
        const spot = lv.free_spot_near(p.x + game.rng.randint(-6, 6), p.y + game.rng.randint(-6, 6), 3);
        if (!spot || cheb(spot, apos(p)) < 3) continue;
        const h = make_patrol(game, 'scout', spot[0], spot[1], 0);
        Object.assign(h, { faction: 'cult', name: GUARD_NAMES.cult[game.era.id], hostile: true, state: 'hunt', target: apos(p) });
        lv.add_actor(h); group.push(h);
      }
      game.adjust_humanity(3, '');
      text = 'You step into the road. The singing stops. The ones at the front put down the keys and pick up something else.';
    } else { game.adjust_humanity(-4, ''); text = 'You stand aside. They do not even look at you as they pass.'; }
  } else if (d.kind === 'refugees') {
    if (index === 0) {
      const n = Math.min(d.n, saga_capacity(game) - game.saga.residents.length);
      const names = [];
      for (let i = 0; i < n; i++) names.push(saga_add_resident(game, null, 'enclave').name);
      game.adjust_humanity(3, '');
      text = n ? `${names.join(' and ')} come in out of the dark. They have nothing, and they will work.` : 'There is no room left. You have to send them on.';
    } else if (index === 1) text = 'You tell them there is no room. They go, without arguing, which is worse.';
    else {
      for (const [iid, q] of [['food', 2], ['bandage', 1]]) if (game.items[iid]) game.give_item(make_item(iid, q));
      game.adjust_humanity(-8, ''); game.rep.enclave = (game.rep.enclave || 0) - 10;
      text = 'You take what they carry and close the door on them. It is not much. It is more than they have now.';
    }
  }
  active.result = text; active.resolved = true;
  game.msg(text, 'lore');
  return text;
}

function saga_refugees(game) {
  const n = game.rng.randint(1, 2);
  saga_queue(game, { kind: 'refugees', title: 'At your door', n,
    text: `${n === 1 ? 'Someone is' : 'Two people are'} at the door of your base, soaked and shaking. They saw your light. ${n === 1 ? 'They have' : 'They have'} a little food and nowhere to go.`,
    choices: [{ label: 'Take them in', needs: {} }, { label: 'Turn them away', needs: {} }, { label: 'Take what they carry', needs: {} }] });
}

// ---- your people
const SAGA_JOBS = {
  idle: ['Resting', 'Gets their strength and their nerve back.'],
  guard: ['Guard', 'Holds the walls at night, with you or without you.'],
  scavenge: ['Scavenge', 'Goes out to the buildings near the base and brings back what they find. Risky, more so as the world gets worse.'],
  medic: ['Medic', 'Tends the hurt, and makes a bandage when there is cloth.'],
  build: ['Build', 'Works on the project you have started.'],
  farm: ['Grow food', 'Two rations a day. Needs the greenhouse.'],
  research: ['Research', 'Works towards the cure, and teaches you words of the cipher. Needs the laboratory.'],
};
const SAGA_JOB_NEEDS = { farm: 'greenhouse', research: 'lab' };

function saga_add_resident(game, actor, faction) {
  const S = game.saga, rng = game.rng;
  const taken = new Set(S.residents.map((r) => r.name).concat((game.fallen_allies || []).map((f) => f[0])));
  const c = comp_current(game); if (c) taken.add(c.name);
  let name, arch;
  if (actor) { name = actor.name; arch = actor.trait || rng.choice(COMP.archetypes).id; }
  else { const pool = COMP.names.filter((n) => !taken.has(n)); name = rng.choice(pool.length ? pool : COMP.names); arch = rng.choice(COMP.archetypes).id; }
  const r = { id: ++S.rid, name, arch, job: 'idle', morale: 60, hurt: 0, faction: faction || 'enclave', joined: game_day(game), actor: actor || null };
  S.residents.push(r);
  return r;
}
const saga_strength = (r) => (COMP_BY_ID[r.arch] || {}).strength || '';
const saga_label = (r) => (COMP_BY_ID[r.arch] ? COMP_BY_ID[r.arch].label : 'survivor');

function saga_set_job(game, r, job) {
  const need = SAGA_JOB_NEEDS[job];
  if (need && !saga_built(game, need)) return `${r.name} cannot do that without the ${saga_project_name(game, need).toLowerCase()}.`;
  r.job = job;
  return `${r.name}: ${SAGA_JOBS[job][0].toLowerCase()}.`;
}

// Your companion stays behind at the base, or someone from the base comes out with you.
function saga_station(game, c) {
  if (!in_base(game)) return 'Only at your base.';
  if (game.saga.residents.length >= saga_capacity(game)) return 'There is no bed for them. Build another cot.';
  comp_return_gear(game, c);
  game.level.remove_actor(c); game.world.level.remove_actor(c);
  c.state = 'resident';
  game.companion_uid = 0;
  saga_add_resident(game, c, c.faction);
  return `${c.name} puts down their pack. "I will keep the place standing for you."`;
}
function saga_take_along(game, r) {
  if (!in_base(game)) return 'Only at your base.';
  if (comp_current(game)) return 'You already travel with someone.';
  const p = game.player, lv = game.level, spot = lv.free_spot_near(p.x, p.y, 3);
  if (!spot) return 'There is no room to move in here.';
  let h = r.actor;
  if (!h) { h = comp_stranger(game, spot); h.faction = r.faction; comp_ensure_person(game, h, r.arch); h.name = r.name; h.glyph = r.name[0].toUpperCase(); }
  h.x = spot[0]; h.y = spot[1]; h.hp = Math.max(1, h.hp); lv.add_actor(h);
  game.saga.residents.splice(game.saga.residents.indexOf(r), 1);
  saga_recruit_here(game, h, Math.max(20, h.bond || 0));
  return `${r.name} picks up a pack and falls in beside you.`;
}

// comp_recruit puts a new companion outside; indoors (your base, an outpost) they should stand beside you instead.
function saga_recruit_here(game, h, bond) {
  delete h.outpost;
  comp_recruit(game, h, null, bond);
  const lv = game.level, world = game.world.level, p = game.player;
  if (lv === world || !world.actors.includes(h)) return;
  world.remove_actor(h);
  const s = lv.free_spot_near(p.x, p.y, 3);
  if (s) { h.x = s[0]; h.y = s[1]; lv.add_actor(h); } else world.add_actor(h);
}

function _stash_food(game, lv) { return lv.stash.filter((i) => game.item_def(i.id).kind === 'food'); }
function _stash_take(lv, item, n = 1) { item.qty -= n; if (item.qty <= 0) lv.stash.splice(lv.stash.indexOf(item), 1); }
function _stash_add(game, lv, item) {
  const d = game.item_def(item.id), have = d.stackable ? lv.stash.find((h) => h.id === item.id) : null;
  if (have) have.qty += item.qty; else lv.stash.push(item);
}

// Every morning at six: what your people ate, what they did, and who did not come back.
function saga_morning(game) {
  const S = game.saga, lv = saga_base_level(game);
  if (!lv || !S.residents.length) return;
  const rng = game.rng, lines = [], ph = saga_phase_index(game), base = saga_base_poi(game);
  let need = Math.ceil(S.residents.length * saga_mod(game, 'food_need')), fed = 0;
  for (const it of _stash_food(game, lv)) { while (need > 0 && it.qty > 0) { _stash_take(lv, it); need--; fed++; } }
  const hungry = need > 0;
  if (hungry) lines.push(`There was not enough food in the locker: ${need} portion${need === 1 ? '' : 's'} short.`);
  const calm = S.residents.some((r) => saga_strength(r) === 'calm' && !r.hurt);
  const infirmary = saga_built(game, 'infirmary'), medics = S.residents.filter((r) => r.job === 'medic' && !r.hurt);
  for (const r of S.residents.slice()) {
    if (r.hurt > 0) { r.hurt -= 1 + (infirmary ? 1 : 0) + (medics.length ? 1 : 0); if (r.hurt <= 0) { r.hurt = 0; lines.push(`${r.name} is back on their feet.`); } r.morale -= 2; continue; }
    const s = saga_strength(r);
    if (r.job === 'scavenge') {
      const pool = Object.values(game.pois).filter((q) => !SPECIAL_KINDS.includes(q.kind) && q.kind !== 'cave' && cheb(poi_pos(q), poi_pos(base)) <= 45 && !(outpost_of(game, q.id) && outpost_of(game, q.id).owner));
      const q = pool.length ? pool[(game_day(game) + r.id) % pool.length] : null;
      const die = 0.02 + 0.012 * ph - (s === 'scout' ? 0.01 : 0), hurt = 0.08 + 0.03 * ph - (s === 'scout' ? 0.05 : 0), roll = rng.random();
      if (!q) lines.push(`${r.name} found nowhere left to search nearby.`);
      else if (roll < die) { saga_lose_resident(game, r, `did not come back from ${q.name}`); lines.push(`${r.name} went to ${q.name} and did not come back.`); continue; }
      else if (roll < die + hurt) { r.hurt = 2; lines.push(`${r.name} came back from ${q.name} hurt, with nothing.`); }
      else {
        const got = roll_items(rng, game.era, q.burned ? 'house' : q.kind, 1.4 + (s === 'scavenger' || s === 'lucky' ? 1 : 0), game.diff.loot * (0.5 + saga_mod(game, 'restock')));
        for (const it of got) _stash_add(game, lv, it);
        lines.push(got.length ? `${r.name} brought back ${got.map((i) => game.item_def(i.id).name.toLowerCase()).join(', ')} from ${q.name}.` : `${r.name} searched ${q.name} and found nothing.`);
      }
    } else if (r.job === 'medic') {
      if (game_day(game) % 2 === 0) {
        const cloth = lv.stash.find((i) => i.id === 'cloth');
        if (cloth && game.items.bandage) { _stash_take(lv, cloth); _stash_add(game, lv, make_item('bandage', s === 'medic' ? 2 : 1)); lines.push(`${r.name} turned cloth into bandages.`); }
        else if (game.items.herbs && rng.random() < 0.4) { _stash_add(game, lv, make_item('herbs', 1)); lines.push(`${r.name} gathered herbs.`); }
      }
    } else if (r.job === 'build') {
      if (S.building) S.progress[S.building] = (S.progress[S.building] || 0) + (s === 'tinker' ? 2 : 1);
    } else if (r.job === 'farm' && saga_built(game, 'greenhouse')) {
      const n = saga_event_on(game, 'cold') ? 1 : 2;
      _stash_add(game, lv, make_item('food', n));
    } else if (r.job === 'research' && saga_built(game, 'lab')) {
      S.research = Math.min(SAGA_CURE_RESEARCH, S.research + 4 + (r.faction === 'science' || s === 'medic' ? 4 : 0));
      if (game_day(game) % 2 === 0) { const w = game.know.learn_random(rng, 1); if (w.length) lines.push(`${r.name} worked out a word of the cipher: ${w[0]}.`); }
    }
    r.morale += (hungry ? -15 : (r.job === 'idle' ? 4 : 1)) + (calm ? 1 : 0) - (S.residents.length > saga_capacity(game) ? 6 : 0);
  }
  saga_check_project(game);
  for (const r of S.residents.slice()) {
    r.morale = Math.max(0, Math.min(100, r.morale));
    if (r.morale > 0) continue;
    const it = lv.stash.length ? lv.stash[rng.randint(0, lv.stash.length - 1)] : null;
    if (it) _stash_take(lv, it, it.qty);
    S.residents.splice(S.residents.indexOf(r), 1);
    lines.push(`${r.name} left in the night` + (it ? `, and took the ${game.item_def(it.id).name.toLowerCase()} with them.` : '.'));
  }
  game.msg(`Morning at the base. ${S.residents.length} ${S.residents.length === 1 ? 'person' : 'people'}, ${fed} portion${fed === 1 ? '' : 's'} eaten.` + (lines.length ? ' ' + lines[0] : ''), 'dir', true);
  for (const l of lines.slice(1)) game.msg(l, 'lore');
}

function saga_lose_resident(game, r, why) {
  const S = game.saga;
  S.residents.splice(S.residents.indexOf(r), 1);
  game.fallen_allies.push([r.name, why]);
  saga_note(game, `${r.name} ${why}.`);
}

// Midnight, and you are not home: whoever you left there holds the walls without you.
function saga_night_raid(game) {
  const S = game.saga, lv = saga_base_level(game);
  if (!lv || game.level === lv || game_day(game) < 3) return;
  const ph = saga_phase_index(game), rng = game.rng;
  if (rng.random() >= 0.35 * Math.min(3, saga_mod(game, 'raid'))) return;
  const guards = S.residents.filter((r) => r.job === 'guard' && !r.hurt);
  const threat = 2 + ph * 1.5 + game_day(game) / 8 + (saga_event_on(game, 'bloodmoon') ? 4 : 0) + rng.uniform(0, 3);
  const defense = guards.reduce((s, r) => s + (['fighter', 'tough'].includes(saga_strength(r)) ? 3.5 : 2.5), 0) +
    Object.values(lv.built).filter((v) => v === 'barricade').length * 0.5 + (saga_built(game, 'wall') ? 3 : 0) + (saga_built(game, 'watchtower') ? 2 : 0) + (saga_built(game, 'generator') ? 1 : 0);
  if (defense >= threat) {
    if (guards.length) { for (const r of guards) r.morale = Math.min(100, r.morale + 3); game.msg(`The dead came for the base in the night. ${guards.map((r) => r.name).join(' and ')} held the walls.`, 'good', true); }
    return;
  }
  const short = Math.ceil(threat - defense), lost = [];
  for (let i = 0; i < short && lv.stash.length; i++) { const it = lv.stash[rng.randint(0, lv.stash.length - 1)]; lost.push(game.item_def(it.id).name.toLowerCase()); _stash_take(lv, it, it.qty); }
  const victims = S.residents.filter(() => rng.random() < 0.25);
  for (const r of victims) { if (rng.random() < 0.4 + 0.1 * ph) saga_lose_resident(game, r, 'died defending the base'); else r.hurt = 3; }
  for (const r of S.residents) r.morale = Math.max(0, r.morale - 10);
  game.msg('While you were away, the dead broke into the base.' + (lost.length ? ` The ${lost.slice(0, 3).join(', ')} ${lost.length > 3 ? 'and more are' : lost.length > 1 ? 'are' : 'is'} gone.` : '') +
    (victims.length ? ` ${victims.map((r) => r.name).join(' and ')} ${victims.length > 1 ? 'were' : 'was'} caught in it.` : '') + (S.residents.length ? '' : ' There was nobody there to stop them.'), 'bad', true);
}

// ---- projects: what you build together
const SAGA_PROJECTS = [
  { id: 'radio', names: { medieval: 'Signal tower', eighties: 'Radio mast', modern: 'Radio mast', scifi: 'Comms relay' }, cost: [['scrap', 4], ['wood', 3]], work: 4, needs: [],
    desc: 'Hear the whole city: every report names its place, warnings come twice as early, and more people find their way to you. Needed for a sanctuary.' },
  { id: 'watchtower', names: { medieval: 'Watchtower', eighties: 'Lookout', modern: 'Lookout', scifi: 'Sensor mast' }, cost: [['wood', 6], ['scrap', 1]], work: 3, needs: [],
    desc: 'See them coming: night raids are smaller, with you or without you.' },
  { id: 'greenhouse', names: { medieval: 'Kitchen garden', eighties: 'Greenhouse', modern: 'Greenhouse', scifi: 'Hydroponics bay' }, cost: [['wood', 4], ['cloth', 3]], work: 4, needs: [],
    desc: 'Food that does not come off a shelf: a farmer grows two rations a day.' },
  { id: 'infirmary', names: { medieval: 'Infirmary', eighties: 'Infirmary', modern: 'Infirmary', scifi: 'Med bay' }, cost: [['cloth', 4], ['scrap', 2]], work: 3, needs: [],
    desc: 'Sleeping at the base heals you fully, and your people mend twice as fast.' },
  { id: 'wall', names: { medieval: 'Palisade', eighties: 'Outer wall', modern: 'Outer wall', scifi: 'Blast doors' }, cost: [['wood', 8], ['scrap', 5]], work: 6, needs: [],
    desc: 'The dead come at the base in far smaller numbers.' },
  { id: 'generator', names: { medieval: 'Lantern works', eighties: 'Generator', modern: 'Generator', scifi: 'Fusion cell' }, cost: [['scrap', 8], ['wood', 2]], work: 5, needs: [],
    desc: 'Light at night: fewer raids. The laboratory and the vehicle need it.' },
  { id: 'lab', names: { medieval: 'Alchemist\'s cell', eighties: 'Laboratory', modern: 'Laboratory', scifi: 'Gene lab' }, cost: [['scrap', 5], ['cloth', 3]], work: 6, needs: ['generator'],
    desc: 'Where the cure can be made: research, and in the end the synthesis.' },
  { id: 'vehicle', names: { medieval: 'River barge', eighties: 'Armoured bus', modern: 'Armoured truck', scifi: 'Shuttle' }, cost: [['scrap', 12], ['wood', 6], ['cloth', 4]], work: 14, needs: ['generator'],
    desc: 'A way out, for you and everyone who will come. Finishing it opens the exodus.' },
];
const SAGA_PROJECT_BY_ID = Object.fromEntries(SAGA_PROJECTS.map((q) => [q.id, q]));
const saga_project_name = (game, id) => SAGA_PROJECT_BY_ID[id].names[game.era.id];

function saga_project_status(game, q) {
  const S = game.saga;
  if (S.built.includes(q.id)) return [false, 'built'];
  if (S.building === q.id) return [false, 'in progress'];
  if (S.building) return [false, `finish the ${saga_project_name(game, S.building).toLowerCase()} first`];
  const miss = q.needs.filter((n) => !S.built.includes(n));
  if (miss.length) return [false, 'needs the ' + miss.map((n) => saga_project_name(game, n).toLowerCase()).join(', ')];
  const short = q.cost.filter(([i, n]) => base_have(game, i) < n).map(([i, n]) => `${n}x ${game.item_def(i).name.toLowerCase()}`);
  return short.length ? [false, 'missing ' + short.join(', ')] : [true, ''];
}

function saga_start_project(game, id) {
  const S = game.saga, q = SAGA_PROJECT_BY_ID[id];
  if (!in_base(game)) return 'Only at your base.';
  const [ok, why] = saga_project_status(game, q);
  if (!ok) return `You cannot start that: ${why}.`;
  for (const [i, n] of q.cost) base_take(game, i, n);
  S.building = id; S.progress[id] = S.progress[id] || 0;
  game.msg(`You lay out the materials for the ${saga_project_name(game, id).toLowerCase()}. It will take ${q.work} days of work: yours, or your people's.`, 'good', true);
  return '';
}

// Four hours of your own work on whatever is being built.
function saga_work(game) {
  const S = game.saga;
  if (!in_base(game)) { game.msg('Only at your base.', 'warn'); return false; }
  if (!S.building) { game.msg('Nothing is being built. Start a project first.', 'warn'); return false; }
  if (game.visible_hostiles().length) { game.msg('Not with something in here.', 'warn'); return false; }
  S.progress[S.building] = (S.progress[S.building] || 0) + 1;
  game.msg(`You put four hours into the ${saga_project_name(game, S.building).toLowerCase()}.`, 'info');
  game._spend(40);
  saga_check_project(game);
  return true;
}

function saga_check_project(game) {
  const S = game.saga;
  if (!S.building || (S.progress[S.building] || 0) < SAGA_PROJECT_BY_ID[S.building].work) return;
  const id = S.building;
  S.built.push(id); S.building = '';
  game.player.gain_xp(30);
  game.msg(`The ${saga_project_name(game, id).toLowerCase()} is finished.`, 'good', true);
  saga_note(game, `Your ${saga_project_name(game, id).toLowerCase()} was finished.`);
}

// ---- how it ends, besides death
function saga_allies(game) { return Object.values(game.saga.outposts).filter((o) => o.owner && !o.overrun && faction_attitude(game, o.owner) === 'ally').length; }
function saga_endings(game) {
  const S = game.saga, p = game.player, reqs = game.requirements(), comps = reqs.filter((r) => r[0] !== 'The formula'), formula = reqs.find((r) => r[0] === 'The formula');
  const lab = saga_built(game, 'lab'), comps_ok = comps.every((r) => r[1]), formula_ok = !formula || formula[1];
  return [
    { id: 'cure', name: 'The cure', turns: 60, ready: lab && S.research >= SAGA_CURE_RESEARCH && comps_ok && formula_ok,
      text: `Laboratory ${lab ? 'built' : 'not built'} · research ${S.research}/${SAGA_CURE_RESEARCH} · components ${comps.filter((r) => r[1]).length}/${comps.length} (carried) · formula ${formula && formula[1] ? 'ready' : formula ? formula[2] : 'n/a'}`,
      start: 'You begin the synthesis. The generator screams, every light in the base is on, and every one of the dead for a mile can hear it. Hold until dawn.' },
    { id: 'exodus', name: 'The exodus', turns: 40, ready: saga_built(game, 'vehicle'),
      text: `${saga_project_name(game, 'vehicle')}: ${saga_built(game, 'vehicle') ? 'ready' : S.building === 'vehicle' ? `${S.progress.vehicle || 0}/${SAGA_PROJECT_BY_ID.vehicle.work} days of work` : 'not started'} · ${S.residents.length} people would come`,
      start: `You start loading the ${saga_project_name(game, 'vehicle').toLowerCase()}. Engines, voices, doors: the noise goes out over the city like a bell. Hold until it is loaded.` },
    { id: 'sanctuary', name: 'The sanctuary', turns: 50, ready: saga_built(game, 'radio') && saga_allies(game) >= SAGA_SANCTUARY_ALLIES && game_day(game) >= SAGA_SANCTUARY_DAY,
      text: `${saga_project_name(game, 'radio')} ${saga_built(game, 'radio') ? 'built' : 'not built'} · allied outposts ${saga_allies(game)}/${SAGA_SANCTUARY_ALLIES} · day ${game_day(game)}/${SAGA_SANCTUARY_DAY}`,
      start: 'You send the call. One by one the fires answer from the rooftops. Then the dead answer too: everything in the city turns towards your walls. Hold the night.' },
  ];
}

function saga_begin_ending(game, id) {
  const S = game.saga, lv = game.level, e = saga_endings(game).find((x) => x.id === id);
  if (!e) return 'Unknown ending.';
  if (!in_base(game)) return 'Only at your base.';
  if (!e.ready) return 'Not yet.';
  if (game.final) return 'It has already begun.';
  if (id === 'cure') for (const r of game.scenario.requirements) game.player.take(r.id, 1);
  game.final_site_id = lv.poi_id;
  game.final = { turns_left: e.turns, next_wave: 4, boss_done: false, total: e.turns, doors: game._siege_doors(lv), pending: {}, exit: null, exit_name: '', no_exit: true, kind: id };
  lv.safe = false;
  game.msg(e.start, 'bad', true);
  game.emit_noise([game.player.x, game.player.y], 30);
  game.add_heat(30, true);
  return '';
}

// Guards at the base thin the waves of a final stand.
function saga_wave_cut(game) { return game.saga ? Math.floor(game.saga.residents.filter((r) => r.job === 'guard' && !r.hurt).length / 2) : 0; }

function saga_way_out(game, band) {
  const S = game.saga, base = saga_base_poi(game), n = S.residents.length, kind = game.win_kind;
  const place = base ? base.name : 'the base';
  if (kind === 'exodus') return `At first light the ${saga_project_name(game, 'vehicle').toLowerCase()} rolls out through the gate of ${place}` + (n ? `, ${n} ${n === 1 ? 'person' : 'people'} aboard who chose to come with you.` : ', with only you aboard.');
  if (kind === 'sanctuary') return `By morning the dead lie in a ring around ${place}. Smoke rises from ${saga_allies(game)} rooftops across the city, each one a fire someone lit because you asked.`;
  return `The last of the night's dead lies across the doorway of ${place}. On the bench, the vial is still warm, and ${n ? `${n} ${n === 1 ? 'person is' : 'people are'} watching you hold it up to the light.` : 'there is nobody to show it to but you.'}`;
}

function saga_objectives(game) {
  const S = game.saga, out = [], cap_ = saga_capacity(game);
  if (!game.base_id) out.push(['Claim a base: clear a building, then Menu > Base', false]);
  else out.push([`Base: ${S.residents.length}/${cap_} people` + (S.building ? `, building the ${saga_project_name(game, S.building).toLowerCase()} (${S.progress[S.building] || 0}/${SAGA_PROJECT_BY_ID[S.building].work})` : ''), false]);
  for (const e of saga_endings(game)) out.push([`${e.name}: ${e.text}`, false]);
  out.push([`Survive: day ${game_day(game)}, ${saga_phase(game).name}`, false]);
  return out;
}

function saga_score(game) {
  const S = game.saga;
  return S ? S.residents.length * 30 + saga_allies(game) * 40 + S.built.length * 15 : 0;
}
function saga_summary(game) {
  const S = game.saga;
  if (!S) return [];
  return [`The world on day ${game_day(game)}: ${saga_phase(game).name}`,
          `Your people: ${S.residents.length}   Built: ${S.built.length ? S.built.map((id) => saga_project_name(game, id).toLowerCase()).join(', ') : 'nothing'}   Allied outposts: ${saga_allies(game)}`];
}

// Places worth an arrow at the edge of the map: besieged outposts and the events that landed somewhere.
function saga_markers(game) {
  const S = game.saga, out = [];
  if (!S) return out;
  for (const o of Object.values(S.outposts)) if (o.siege_until && game.pois[o.id].revealed) out.push([game.pois[o.id].x, game.pois[o.id].y, '#e2573f', 'S']);
  for (const e of S.events) { const m = SAGA_EVENTS[e.id].marker && SAGA_EVENTS[e.id].marker(game, e); if (m) out.push(m); }
  return out;
}

function saga_news(game) {
  const S = game.saga, out = [];
  if (!S) return out;
  const [px, py] = world_pos(game);
  for (const o of Object.values(S.outposts)) {
    if (!o.owner) continue;
    const poi = game.pois[o.id];
    if (cheb(poi_pos(poi), [px, py]) > 70) continue;
    out.push(`"${faction_name(game, o.owner)} hold ${poi.name}, ${compass(poi.x - px, poi.y - py)} of here. ${({ ally: 'They speak well of you there.', friendly: 'They would let you in.', wary: 'They do not know you yet.', hostile: 'They will shoot you on sight.' })[faction_attitude(game, o.owner)]}"`);
  }
  if (S.warlord && !S.warlord.dead) out.push(`"${S.warlord.name} runs the raiders now. Every camp answers to that name."`);
  const e = S.events.find((ev) => ev.started);
  if (e) out.push(`"${SAGA_EVENTS[e.id].name}. You have seen it too. Nobody knows how long it lasts."`);
  return out;
}

// ---- the base under attack while you are in it
function saga_raid_chance(game) { return game.saga ? saga_mod(game, 'raid') * (saga_built(game, 'generator') ? 0.6 : 1.0) : 1.0; }
function saga_raid_size(game, n) {
  if (!game.saga) return n;
  const guards = game.saga.residents.filter((r) => r.job === 'guard' && !r.hurt).length;
  n -= guards + (saga_built(game, 'watchtower') ? 1 : 0);
  if (saga_built(game, 'wall')) n = Math.ceil(n * 0.6);
  if (saga_event_on(game, 'bloodmoon')) n += 4;
  return Math.max(1, n);
}
// More of the strange ones as the world goes on, and for good after the dead change.
const saga_special_boost = (game) => (game.saga ? 1 + game.saga.special_boost + 0.15 * saga_phase_index(game) : 1);

EVENT_BY_ID.saga = { id: 'saga', title: 'The world', text: '', choices: [], min_day: 999, weight: 0 };
