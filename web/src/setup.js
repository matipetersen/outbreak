// ---------------------------------------------------------------- building a new game
const BASE_HP = 80;
const SPECIAL_KINDS = ['breach', 'refuge', 'pad', 'cave'];
const ZONE_DENSITY = [0.004, 0.015, 0.03];

function _resolve_token(game, token) {
  const d = game.era.defaults;
  if (token === '@ammo') return game.era.items[d.ranged].ammo;
  return token.startsWith('@') ? d[token.slice(1)] : token;
}

function setup_game(game) {
  const cfg = game.cfg;
  const seed = cfg.seed !== null && cfg.seed !== undefined ? cfg.seed : Math.floor(Math.random() * 1073741824);
  game.seed = seed;
  game.rng = new RNG((seed ^ 0x5EED) >>> 0);
  game.era = CONTENT.eras[cfg.era]; comp_set_era(game.era.id);
  game.profile = CONTENT.presets[cfg.zombies];
  game.scenario = CONTENT.scenarios[cfg.scenario];
  game.diff = CONTENT.difficulties[cfg.difficulty];
  game.items = Object.assign({}, game.era.items);
  game.know = new Knowledge(era_vocabulary(game.era), game.era.glyphs);
  game.world = generate_overworld(seed, game.era, cfg.map_w, cfg.map_h);
  game.levels = { world: game.world.level };
  game.level = game.world.level;
  game.pois = game.world.pois;
  const opening = _pick_opening(game);
  game.opening_id = opening.id;
  let start_hour = opening.hour;
  if (game.profile.sun_burn) start_hour = Math.min(start_hour, 10);   // sun-shy dead: keep a whole safe day to loot
  const shared = cfg.mode === 'shared';
  game.clock = new Clock(shared ? cfg.clock_turn : start_hour * CONTENT.clock.turns_per_hour);
  game.season_n = cfg.season_n || 0;
  _make_player(game);
  if (!shared) _apply_opening(game, opening);          // shared: after the world is built, so the world never depends on who you are
  _setup_scenario(game);
  mutation_build(game);
  _setup_documents(game);
  _populate(game);
  if (!shared) comp_spawn_start(game);
  if (!game.profile.sun_burn && !shared) start_ring(game);
  if (shared) _become_survivor(game, opening);
  _intro(game);
}

function _make_player(game) {
  const origin = game.cfg.mode === 'shared' ? 'medic' : game.cfg.origin;      // shared world: a stand-in until the world exists
  game.current_origin = origin;
  make_player(game, origin, game.world.start);
}

// Shared world: swap the stand-in for the real survivor, who always arrives at the refuge.
function _become_survivor(game, opening) {
  const dummy = game.player, lv = game.world.level;
  game.world_uid_max = game._uid;      // legacy; chunked worlds mark their actors by uid range
  lv.occ.delete(lv.idx(dummy.x, dummy.y));
  const refuge = game.pois[game.refuge_id];
  gen_near(game, refuge.x, refuge.y);
  const pos = lv.free_spot_near(refuge.x, refuge.y + 2, 8) || lv.free_spot_near(game.world.start[0], game.world.start[1], 8);
  game.current_origin = game.cfg.origin;
  make_player(game, game.cfg.origin, pos);
  _apply_opening(game, opening);
}

// A fresh character with an origin's perks and kit, placed at `pos` on the overworld.
function make_player(game, origin_id, pos) {
  const origin = CONTENT.origins[origin_id];
  const hp = BASE_HP + origin.hp_bonus;
  const p = new Player(game.next_uid(), pos[0], pos[1], hp);
  p.coins = origin.coins;
  game.player = p;
  game.level.occ.set(game.level.idx(pos[0], pos[1]), p);
  for (const [perk_id, ranks] of Object.entries(origin.perks)) p.grant_perk(perk_id, ranks);
  game.know.learn_random(game.rng, origin.words);
  for (const [token, qty] of origin.kit) {
    const item_id = _resolve_token(game, token);
    if (!item_id) continue;
    const d = game.item_def(item_id);
    const item = make_item(item_id, d.stackable ? qty : 1, d.durability || null);
    if (token === '@ammo') item.qty = qty;
    const slot = { weapon: 'weapon', armor: 'armor', light: 'light' }[d.kind];
    if (slot && p[slot] === null && !(slot === 'weapon' && token === '@ranged')) p[slot] = item;
    else p.add_item(item, d.stackable);
  }
  return p;
}

// ---------------------------------------------------------------- opening: where you are when it starts
function _pick_opening(game) {
  const cfg = game.cfg;
  if (cfg.opening && cfg.opening !== 'random') return CONTENT.openings[cfg.opening];
  const rng = new RNG(((game.seed ^ 0x0BE17) >>> 0));            // a separate stream: never shifts the world
  const pairs = Object.values(CONTENT.openings).map((o) => [o, o.affinity[cfg.origin] !== undefined ? o.affinity[cfg.origin] : CONTENT.opening_default_affinity]);
  return weighted_choice(rng, pairs);
}

function _apply_opening(game, opening) {
  const p = game.player;
  p.coins += opening.coins;
  p.panic = Math.min(p.max_panic, p.panic + opening.panic);
  p.humanity = Math.min(100, p.humanity + opening.humanity);
  if (opening.words) game.know.learn_random(game.rng, opening.words);
  for (const [token, qty] of opening.items) {
    const item_id = _resolve_token(game, token);
    if (!item_id) continue;
    const d = game.item_def(item_id);
    const owned = [p.weapon, p.armor].concat(p.inventory);
    if ((d.kind === 'weapon' || d.kind === 'armor') && owned.some((i) => i && i.id === item_id)) continue;
    const item = make_item(item_id, d.stackable ? qty : 1, d.durability || null);
    if (d.kind === 'armor' && p.armor === null) p.armor = item;
    else if (d.kind === 'weapon' && !is_ranged(d) && p.weapon === null) p.weapon = item;
    else p.add_item(item, d.stackable);
  }
}

// The briefing: the scene you start in, the world, and what you have to do.
function intro_pages(game) {
  const era = game.era, sc = game.scenario, prof = game.profile, opening = CONTENT.openings[game.opening_id];
  const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const world = `${era.name} (${era.year}).\n\n${era.intro}\n\n${prof.lore}\n\n${mutation_matchup(era, prof)}`;
  const scene = opening.scenes[era.id] + '\n\n' + fill(CONTENT.opening_consequence, { alarm: CONTENT.opening_alarms[era.id] });
  const premise = fill(game.cfg.mode !== 'normal' ? sc.premise_living : sc.premise, { refuge: era.refuge, pad: era.pad, radio: era.radio, days: game.deadline_days });
  return [[opening.name, scene], ['Your situation', situation(game)], ['The world', world], ['What you must do', premise]];
}

// Who you are, what is in your hands, who is beside you and what is nearby: this run, not any run.
function situation(game) {
  const p = game.player, era = game.era, sc = game.scenario, c = game.clock, st = CONTENT.story;
  const light = st.LIGHT_WORDS[c.is_day ? 'day' : c.is_night ? 'night' : 'edge'];
  const hands = p.weapon ? game.item_def(p.weapon.id).name.toLowerCase() : 'your bare hands';
  const hh = String(Math.floor(c.hour)).padStart(2, '0'), mm = String(Math.floor((c.hour % 1) * 60)).padStart(2, '0');
  const lines = [st.ORIGIN_VOICE[game.current_origin] || '', `It is ${hh}:${mm}, ${light}. In your hands: ${hands}; ${p.coins} ${era.coin} in your pocket.`];
  const near = Object.values(game.pois).filter((q) => !SPECIAL_KINDS.includes(q.kind)).sort((a, b) => cheb([a.x, a.y], [p.x, p.y]) - cheb([b.x, b.y], [p.x, p.y])).slice(0, 2);
  if (near.length) lines.push('Close by: ' + near.map((q) => `${q.name}, ${dist_words(game.era.id, cheb([q.x, q.y], [p.x, p.y]))} ${compass(q.x - p.x, q.y - p.y)}`).join('; ') + '.');
  const ally = comp_current(game);
  if (ally) { const a = comp_arch(ally); lines.push(`${ally.name}, a ${a.label}, is already beside you. ${a.intro}`); }
  lines.push(st.SCENARIO_TAIL[sc.id]);
  return lines.filter(Boolean).join('\n\n');
}

function register_components(game) {
  for (const req of game.scenario.requirements) {
    game.items[req.id] = { id: req.id, name: req.names[game.era.id], kind: 'component', desc: req.desc, value: 0, stackable: false,
                           tags: [], rarity: 1, poi: [], style: '', dmg: [0, 0], reach: 1, noise: 0, durability: 0, ammo: '',
                           accuracy: 0, head: 0, defense: 0, bite_guard: 0, stealth: 0, light: 0, effect: {} };
  }
}

function _setup_scenario(game) {
  const sc = game.scenario, era = game.era, rng = game.rng, start = game.world.start, p = game.player;
  if (sc.start_infected && game.cfg.mode === 'normal') {
    p.infected = true;
    p.infection_timer = Math.floor(sc.timer_turns * game.diff.timer);
    p.bite_limb = 'torso';
  }
  register_components(game);
  const pois = Object.values(game.pois);
  for (const req of sc.requirements) {
    const pool = pois.filter((q) => q.kind === req.poi_kind && !q.component);
    const band = Math.max(85, Math.floor(0.3 * Math.max(game.world.level.w, game.world.level.h * 1.6)));
    const near = pool.filter((q) => { const d = cheb(poi_pos(q), start); return d >= 18 && d <= band; });
    const host = rng.choice(near.length ? near : pool);
    host.component = req.id;
    host.danger = Math.round(host.danger * 1.15 * 100) / 100;
  }
  const refuge = pois.find((q) => q.kind === 'refuge'), pad = pois.find((q) => q.kind === 'pad');
  game.refuge_id = refuge.id; game.pad_id = pad.id;
  const site = sc.final_site === 'refuge' ? refuge : pad;
  game.final_site_id = site.id;
  if (sc.final_site === 'refuge') site.revealed = true;
  game.rep = { military: 0, enclave: 10, raiders: -20, cult: 0, science: 0 };
  _setup_deadline(game, start, pad);
  _setup_incidents(game, start, pad);
}

// The way out closes after the scenario's minimum, or later when the route is long: collecting parts and crossing the map must
// be possible, not a sprint. About 96 tiles a day of real progress (looting, interiors, rest and trouble included).
function _setup_deadline(game, start, pad) {
  const sc = game.scenario;
  if (!sc.deadline_days) { game.deadline_days = 0; return; }
  const left = Object.values(game.pois).filter((q) => q.component).map((q) => poi_pos(q));
  let here = start, tour = 0;
  const stops = [];
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (cheb(left[i], here) < cheb(left[bi], here)) bi = i;
    here = left.splice(bi, 1)[0]; stops.push(here);
  }
  here = start;
  for (const q of stops.concat([poi_pos(pad)])) { tour += cheb(here, q); here = q; }
  const days = Math.ceil(tour * 1.5 / 96) + 3 * sc.requirements.length + 4;
  game.deadline_days = Math.max(sc.deadline_days, Math.min(45, days));
}

// Things that happen on the road to the extraction point: fixed spots on the way, each fires once when you get close.
function _setup_incidents(game, start, pad) {
  const sc = game.scenario, rng = game.rng;
  game.incidents = [];
  if (!sc.incidents || sc.final_site !== 'pad') return;
  const ids = rng.shuffle(CONTENT.events.filter((e) => e.id.startsWith('road_')).map((e) => e.id));
  const n = sc.incidents;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    game.incidents.push({ x: Math.floor(start[0] + (pad.x - start[0]) * t + rng.randint(-5, 5)), y: Math.floor(start[1] + (pad.y - start[1]) * t + rng.randint(-5, 5)),
                          event: ids[i % ids.length], done: false });
  }
}

function _setup_documents(game) {
  const rng = game.rng, era = game.era, sc = game.scenario, start = game.world.start;
  const hosts = Object.values(game.pois).filter((q) => !SPECIAL_KINDS.includes(q.kind));
  const ranked = hosts.map((q) => [cheb(poi_pos(q), start) + rng.random() * 10, q]).sort((a, b) => a[0] - b[0]).map((t) => t[1]);
  const near = ranked.slice(0, Math.max(12, Math.floor(ranked.length / 3)));
  game.docs = {};
  const add = (kind, payload, host, poi_name = '', pad_name = '') => {
    const doc_id = `doc${Object.keys(game.docs).length}`;
    game.docs[doc_id] = make_document(rng, era, doc_id, kind, poi_name, pad_name, payload);
    host.docs.push(doc_id);
  };
  const host_for = (pool, avoid = null) => { const opts = pool.filter((q) => q !== avoid); return rng.choice(opts.length ? opts : pool); };
  for (const req of sc.requirements) {
    const target = Object.values(game.pois).find((q) => q.component === req.id);
    add('research', { reveal: target.id }, host_for(near, target), target.name);
    add('code', { code: target.id }, host_for(hosts, target), target.name);
  }
  if (sc.needs_formula) {
    const labs = near.filter((q) => q.kind === 'lab');
    add('formula', { formula: '1' }, host_for(labs.length ? labs : near));
  }
  const pad = game.pois[game.pad_id];
  if (sc.final_site === 'pad') {
    add('evac', { reveal: pad.id }, host_for(near), '', pad.name);
    add('evac', { reveal: pad.id }, host_for(hosts), '', pad.name);
  }
  for (const r of CONTENT.recipes) {                       // one manual per recipe you are not born knowing
    const out = recipe_output(game, r);
    if (r.starter || !out || (r.needs === 'firearms' && !era.firearms) || (r.needs === 'electricity' && !era.electricity)) continue;
    add('manual', { recipe: r.id, name: game.item_def(out).name }, host_for(rng.random() < 0.6 ? near : hosts));
  }
  // pages to read: they scale with the size of the world, and the first ones are close to where you start
  const n_diary = Math.max(9, Math.round(hosts.length / 5));
  for (let i = 0; i < n_diary; i++) {
    const pool = i < Math.max(3, Math.floor(n_diary / 4)) ? ranked.slice(0, Math.max(6, Math.floor(ranked.length / 12)))
      : i < Math.floor(n_diary / 2) ? ranked.slice(0, Math.max(12, Math.floor(ranked.length / 3))) : hosts;
    add('diary', {}, host_for(pool), rng.choice(hosts).name);
  }
}

// The world is planned already; paint the start, scatter the roaming hordes and list the places patrols walk between.
function _populate(game) {
  const lv = game.world.level, rng = game.rng, start = game.world.start;
  const nodes = [];
  for (const poi of Object.values(game.pois)) if (!SPECIAL_KINDS.includes(poi.kind)) nodes.push([poi.x, poi.y + 1]);
  for (const [cx, cy] of game.world.camps) nodes.push([cx, cy + 1]);
  game.patrol_nodes = nodes;
  gen_near(game, start[0], start[1]);
  const n_hordes = 3 + Math.floor(lv.w * lv.h / 3500);
  for (let i = 0; i < n_hordes; i++) {
    for (let t = 0; t < 30; t++) {
      const pos = [rng.randint(4, lv.w - 5), rng.randint(4, lv.h - 5)];
      if (cheb(pos, start) > 34 && lv.free(pos[0], pos[1])) { spawn_horde(game, pos); break; }
    }
  }
}

function _intro(game) {
  game.intro_pages = intro_pages(game);
  const era = game.era, sc = game.scenario, p = game.player;
  const refuge = game.pois[game.refuge_id];
  if (sc.final_site === 'refuge') {
    const d = compass(refuge.x - p.x, refuge.y - p.y);
    game.msg(`Rumour on ${era.radio}: ${era.refuge} still stands, ${d} of here, about ${dist_words(era.id, cheb(poi_pos(refuge), [p.x, p.y]))} away. They may have a way to make a cure.`, 'lore');
    if (game.cfg.mode !== 'normal') game.msg('The cure is for the world. If you fall, someone else will carry on.', 'warn');
    else if (!sc.start_infected) game.msg('There is no way out. Live as long as you can, or find the cure.', 'warn');
    else game.msg('You are bitten. The infection is slow, but it is in you. Find the three components and the formula before it takes you.', 'warn');
  } else {
    const pad = game.pois[game.pad_id];
    const d = compass(pad.x - p.x, pad.y - p.y);
    game.msg(`Rumour on ${era.radio}: the last way out is ${d} of here, roughly ${dist_words(era.id, cheb(poi_pos(pad), [p.x, p.y]))}. It closes after day ${game.deadline_days}.`, 'lore');
  }
  if (game.profile.sun_burn) game.msg('The sun keeps them in the dark places. You have until dusk to find shelter and answers.', 'warn');
  else game.msg('The dead are closing in from every side but one. Move!', 'warn');
}
