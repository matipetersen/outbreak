// ---------------------------------------------------------------- saving: the whole game as JSON
const SAVE_VERSION = 1, SAVE_KEY = 'outbreak.save.v1', SHARED_SAVE_KEY = 'outbreak.save.shared.v1';
const save_key = (shared) => (shared ? SHARED_SAVE_KEY : SAVE_KEY);

function bytes_to_b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64_to_bytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// A chunked overworld saves only the chunks that were painted (the rest regenerates from the seed when you get there).
function _chunk_bytes(arr, lv, cx, cy, S) {
  const x0 = cx * S, y0 = cy * S, w = Math.min(S, lv.w - x0), h = Math.min(S, lv.h - y0), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(arr.subarray((y0 + y) * lv.w + x0, (y0 + y) * lv.w + x0 + w), y * w);
  return out;
}
function _put_chunk(arr, lv, cx, cy, S, bytes) {
  const x0 = cx * S, y0 = cy * S, w = Math.min(S, lv.w - x0), h = Math.min(S, lv.h - y0);
  for (let y = 0; y < h; y++) arr.set(bytes.subarray(y * w, (y + 1) * w), (y0 + y) * lv.w + x0);
}
function _serialize_level(lv, chunked = false) {
  return { id: lv.id, name: lv.name, w: lv.w, h: lv.h, kind: lv.kind, tiles: chunked ? '' : bytes_to_b64(lv.tiles), seen: chunked ? '' : bytes_to_b64(lv.seen),
           actors: lv.actors, items: lv.items, containers: lv.containers, portals: lv.portals, corpses: lv.corpses,
           hazards: lv.hazards, door_hp: lv.door_hp, built: lv.built, stash: lv.stash, docs: lv.docs, entry: lv.entry, arrivals: lv.arrivals,
           vault_lock: lv.vault_lock, bench: lv.bench, dark: lv.dark, safe: lv.safe, poi_id: lv.poi_id };
}
function _deserialize_level(d) {
  const lv = new Level(d.id, d.name, d.w, d.h, d.kind, d.tiles === '' ? T.GRASS : T.WALL);
  if (d.tiles !== '') { lv.tiles = b64_to_bytes(d.tiles); lv.seen = b64_to_bytes(d.seen); }
  for (const k of ['actors', 'items', 'containers', 'portals', 'corpses', 'hazards', 'door_hp', 'docs', 'entry', 'arrivals',
                   'vault_lock', 'bench', 'dark', 'safe', 'poi_id']) lv[k] = d[k];
  lv.built = d.built || {}; lv.stash = d.stash || [];
  lv.rebuild_occ();
  return lv;
}

function serialize_game(game) {
  const levels = {};
  const chunked = !!game.world.chunked;
  for (const [id, lv] of Object.entries(game.levels)) levels[id] = _serialize_level(lv, chunked && lv === game.world.level);
  let chunks = null;
  if (chunked) {
    chunks = {};
    const lv = game.world.level;
    for (const key of game.world.generated) { const [cx, cy] = key.split(',').map(Number); chunks[key] = { t: bytes_to_b64(_chunk_bytes(lv.tiles, lv, cx, cy, game.world.S)), s: bytes_to_b64(_chunk_bytes(lv.seen, lv, cx, cy, game.world.S)) }; }
  }
  const data = {
    v: SAVE_VERSION, cfg: game.cfg, seed: game.seed, uid: game._uid, log: game.log.slice(-200), chronicle: game.chronicle, base_id: game.base_id, raid_next: game.raid_next, regions: game.regions, checkpoints: game.checkpoints, foraged: game.foraged, companion_uid: game.companion_uid, pet_uid: game.pet_uid, marks: game.marks, nemeses: game.nemeses, personal: game.personal, director: game.director, fallen_allies: game.fallen_allies, story: game.story, objective_seen: game.objective_seen, region_id: game.region_id, weather: game.weather, sources: game.sources, alarmed: game.alarmed, last_step_note: game.last_step_note, over: game.over,
    pending_event: game.pending_event, recent_events: game.recent_events, hordes: game.hordes, ring: game.ring, heat: game.heat,
    stalker_uid: game.stalker ? game.stalker.uid : 0, stalker_ready: game.stalker_ready, last_moan: game.last_moan,
    followers: game.followers, final: game.final, formula_found: game.formula_found, applied_docs: Array.from(game.applied_docs),
    scent: game.scent, step_parity: game._step_parity, tired_parity: game._tired_parity, force_progress: game._force_progress, clock: game.clock.turn,
    rng: game.rng.state, refuge_id: game.refuge_id, pad_id: game.pad_id, final_site_id: game.final_site_id, rep: game.rep,
    docs: game.docs, know: { known: Array.from(game.know.known), exposure: game.know.exposure },
    player: Object.assign({}, game.player), pois: game.pois,
    world: chunked ? { start: game.world.start, camps: game.world.camps, chunked: true, chunks } : { start: game.world.start, camps: game.world.camps, zone: bytes_to_b64(game.world.zone) },
    dead_uids: Array.from(game.dead_uids),
    levels, current: game.level.id,
    patrol_goals: game.patrol_goals, patrol_nodes: game.patrol_nodes, distress: game.distress, aided: game.aided,
    season_n: game.season_n, world_uid_max: game.world_uid_max, pending_shared: game.pending_shared, applied_tombs: game.applied_tombs, tomb_at: game.tomb_at,
    named_state: game.named_state, taken_components: game.taken_components,
    deadline_days: game.deadline_days, lost_turns: game.lost_turns, incidents: game.incidents,
    generation: game.generation, current_origin: game.current_origin, fallen: game.fallen, fallen_bodies: game.fallen_bodies, death_notice: game.death_notice, opening_id: game.opening_id, intro_pages: game.intro_pages,
  };
  return JSON.stringify(data);
}

function deserialize_game(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (d.v !== SAVE_VERSION) throw new Error(`save version ${d.v} is not supported`);
  const g = new Game(null, true);
  g._init_state();
  g.cfg = d.cfg; g.seed = d.seed; g._uid = d.uid; g.log = d.log; g.chronicle = d.chronicle || []; g.base_id = d.base_id || null; g.raid_next = d.raid_next || 0; g.regions = d.regions || g.regions; g.checkpoints = d.checkpoints || {}; g.foraged = d.foraged || []; g.companion_uid = d.companion_uid || 0; g.pet_uid = d.pet_uid || 0; g.marks = d.marks || []; g.nemeses = d.nemeses || []; g.personal = d.personal || null; g.director = d.director || null; g.fallen_allies = d.fallen_allies || []; g.story = d.story || []; g.objective_seen = d.objective_seen || {}; g.region_id = d.region_id === undefined ? -1 : d.region_id; g.weather = d.weather || 'clear'; g.sources = d.sources || []; g.alarmed = d.alarmed || []; g.last_step_note = d.last_step_note === undefined ? -999 : d.last_step_note; g.over = d.over; g.pending_event = d.pending_event;
  g.recent_events = d.recent_events; g.hordes = d.hordes; g.ring = d.ring; g.heat = d.heat; g.stalker_ready = d.stalker_ready;
  g.last_moan = d.last_moan; g.followers = d.followers; g.final = d.final; g.formula_found = d.formula_found;
  g.applied_docs = new Set(d.applied_docs); g.scent = d.scent; g._step_parity = d.step_parity; g._tired_parity = d.tired_parity || 0; g._force_progress = d.force_progress;
  g.clock = new Clock(d.clock);
  g.rng = new RNG(1); g.rng.state = d.rng;
  g.patrol_goals = d.patrol_goals || {}; g.patrol_nodes = d.patrol_nodes || []; g.distress = d.distress || {}; g.aided = d.aided || {};
  g.season_n = d.season_n || 0; g.world_uid_max = d.world_uid_max || 0; g.pending_shared = d.pending_shared || {}; g.applied_tombs = d.applied_tombs || {};
  g.tomb_at = d.tomb_at || {}; g.named_state = d.named_state || {}; g.taken_components = d.taken_components || [];
  g.deadline_days = d.deadline_days !== undefined ? d.deadline_days : (g.scenario.deadline_days || 0); g.lost_turns = d.lost_turns || 0; g.incidents = d.incidents || [];
  g.generation = d.generation || 1; g.current_origin = d.current_origin || g.cfg.origin; g.fallen = d.fallen || []; g.fallen_bodies = d.fallen_bodies || {}; g.death_notice = d.death_notice || ''; g.opening_id = d.opening_id || ''; g.intro_pages = d.intro_pages || [];
  g.refuge_id = d.refuge_id; g.pad_id = d.pad_id; g.final_site_id = d.final_site_id; g.rep = d.rep; g.docs = d.docs;
  g.era = CONTENT.eras[g.cfg.era]; comp_set_era(g.era.id); g.profile = CONTENT.presets[g.cfg.zombies]; g.scenario = CONTENT.scenarios[g.cfg.scenario];
  g.diff = CONTENT.difficulties[g.cfg.difficulty];
  g.items = Object.assign({}, g.era.items);
  register_components(g);
  g.know = new Knowledge(era_vocabulary(g.era), g.era.glyphs);
  g.know.known = new Set(d.know.known); g.know.exposure = d.know.exposure;
  g.player = Object.assign(Object.create(Player.prototype), d.player);
  g.pois = d.pois;
  g.levels = {};
  for (const [id, ld] of Object.entries(d.levels)) g.levels[id] = _deserialize_level(ld);
  g.dead_uids = new Set(d.dead_uids || []);
  if (d.world.chunked) {
    const lv = g.levels.world;
    g.world = restore_world(g.seed, lv.w, lv.h, lv, g.pois, d.world.start, d.world.camps, Object.keys(d.world.chunks));
    for (const [key, c] of Object.entries(d.world.chunks)) { const [cx, cy] = key.split(',').map(Number); _put_chunk(lv.tiles, lv, cx, cy, g.world.S, b64_to_bytes(c.t)); _put_chunk(lv.seen, lv, cx, cy, g.world.S, b64_to_bytes(c.s)); }
  } else g.world = { level: g.levels.world, pois: g.pois, start: d.world.start, camps: d.world.camps, zone: b64_to_bytes(d.world.zone), chunked: false };
  g.level = g.levels[d.current];
  g.level.occ.set(g.level.idx(g.player.x, g.player.y), g.player);
  if (d.stalker_uid) {
    for (const lv of Object.values(g.levels)) for (const a of lv.actors) if (a.uid === d.stalker_uid) g.stalker = a;
    for (const f of g.followers) if (f.z.uid === d.stalker_uid) g.stalker = f.z;
  }
  g.update_fov();
  return g;
}

function save_game(game, store) {
  store = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) throw new Error('no storage available');
  store.setItem(save_key(game.cfg.mode === 'shared'), serialize_game(game));
}
function load_game(store, shared = false) {
  store = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  const raw = store && store.getItem(save_key(shared));
  if (!raw) throw new Error('no save found');
  return deserialize_game(raw);
}
function has_save(store, shared = false) {
  try { store = store || (typeof localStorage !== 'undefined' ? localStorage : null); return !!(store && store.getItem(save_key(shared))); } catch (e) { return false; }
}
function delete_save(store, shared = false) {
  try { store = store || (typeof localStorage !== 'undefined' ? localStorage : null); if (store) store.removeItem(save_key(shared)); } catch (e) { /* ignore */ }
}
