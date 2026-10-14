// ---------------------------------------------------------------- the shared world (web only)
// One world for everyone who opens the page. This is NOT an authoritative server simulation: every browser runs its own
// copy of the same seeded world, and the facts that matter are shared through the artifact database:
//   season/current  the keeper's season: seed, rules, real-time calendar, reset date (admin writes)
//   tombs           fallen survivors with their gear (anyone can loot them, once)
//   named           enemies that earned a name (killers, risen survivors): level, title, alive or dead
//   dead            uids of ordinary enemies a player destroyed (so they stay dead for everyone)
//   taken           vault components somebody already carries away
//   play/outcome    the season's end: cure made, way out closed
//   hall            who fell, who won
// The calendar is real time: a game day is `dayMs` of real time, so enemy level caps, zombie phases and the extraction
// deadline advance while nobody is playing (enemies "level offline").
const SHARED_DEFAULTS = { dayMs: 3 * 3600 * 1000, seasonMs: 7 * 86400 * 1000 };
const game_day = (g) => g.gen_day || (g.shared ? g.shared.calendar_day() : g.clock.day);

function hash01(a, b) {
  let h = (Math.imul(a | 0, 2654435761) ^ Math.imul(b | 0, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// real time drives the clock: one tick every `tickMs`, the same instant for every player (so the sun is shared)
const season_day = (season, now) => Math.max(1, Math.floor((now - season.startedAt) / season.dayMs) + 1);
// the clock turn that matches the real time of day inside the current game day
const season_turn = (season, now) => Math.floor(Math.max(0, now - season.startedAt) / (season.tickMs || 700));

function new_season(prev, cfg, now, opts = {}) {
  const n = prev ? prev.n + 1 : 1;
  const dayMs = opts.dayMs || (prev && prev.dayMs) || SHARED_DEFAULTS.dayMs;
  const seasonMs = opts.seasonMs || (prev ? prev.endsAt - prev.startedAt : SHARED_DEFAULTS.seasonMs);
  const tickMs = opts.tickMs || (prev && prev.tickMs) || 700;
  return { n, tickMs, seed: opts.seed || Math.floor(Math.random() * 1073741824), startedAt: now, endsAt: now + seasonMs, dayMs, cfg };
}

// ---- applying the world's shared facts to a running game (pure engine side, testable without a database)
function _pending(game, level_id, entry) { (game.pending_shared[level_id] = game.pending_shared[level_id] || []).push(entry); }

function apply_tomb(game, id, d) {
  const state = game.applied_tombs[id];
  if (d.claimed) {
    if (state === 'on') {                                       // somebody else looted it: take it off the floor
      const lv = game.levels[d.level_id];
      if (lv) { delete lv.items[lv.idx(d.x, d.y)]; }
    }
    game.applied_tombs[id] = 'claimed';
    return;
  }
  if (state) return;
  const lv = game.levels[d.level_id];
  if (!lv) { _pending(game, d.level_id, { kind: 'tomb', id, d }); return; }
  game.applied_tombs[id] = 'on';
  for (const it of d.items || []) lv.drop([d.x, d.y], make_item(it.id, it.qty, it.dur === undefined ? null : it.dur, !!it.key));
  game.tomb_at[`${lv.id}|${lv.idx(d.x, d.y)}`] = id;
  if (!d.risen) {
    const k = lv.idx(d.x, d.y);
    lv.corpses[k] = [game.clock.turn, 2];
    game.fallen_bodies[`${lv.id}|${k}`] = { label: d.label, level: d.level, tomb_id: id };
  }
}

function _find_actor(game, d) {
  for (const lv of Object.values(game.levels)) {
    for (const a of lv.actors) if (a.sid === d.sid || (d.uid !== undefined && is_world_uid(game, d.uid) && lv.id === 'world' && a.uid === d.uid)) return [lv, a];
  }
  return [null, null];
}

function apply_named(game, sid, d) {
  game.named_state[sid] = d.alive ? 'alive' : 'dead';
  const [lv0, found] = _find_actor(game, d);
  if (!d.alive) { if (found) lv0.remove_actor(found); return; }
  if (found) {
    found.sid = sid; found.title = d.title;
    while ((found.lvl || 1) < d.lvl) level_up(game, found, false);
    return;
  }
  const lv = game.levels[d.level_id];
  if (!lv) { _pending(game, d.level_id, { kind: 'named', id: sid, d }); return; }
  const spot = lv.free_spot_near(d.x, d.y, 5);
  if (!spot) return;
  let a;
  if (d.kind === 'human') a = d.role === 'raider' ? make_raider(game, spot[0], spot[1]) : make_patrol(game, d.role, spot[0], spot[1], 0);
  else a = spawn_zombie(game, lv, spot, d.special || 'walker', false, true);
  if (d.kind === 'human') { a.state = 'idle'; lv.add_actor(a); }
  while ((a.lvl || 1) < d.lvl) level_up(game, a, false);
  a.sid = sid; a.title = d.title;
  if (d.name) a.name = d.name;
}

function apply_dead(game, uids) {
  const lv = game.world.level, set = new Set(uids);
  for (const u of uids) game.dead_uids.add(u);                 // chunks painted later must not bring them back
  for (const a of lv.actors.slice()) if (set.has(a.uid) && a.kind !== 'player' && !a.sid) lv.remove_actor(a);
}

function apply_taken(game, comp_id) {
  if (!game.taken_components.includes(comp_id)) game.taken_components.push(comp_id);
}

// the deterministic part of "enemies level while you are away": each enemy of the seeded world has its own appetite
function catch_up_actor(game, a) {
  const cap = level_cap(game);
  if (a.kind === 'player' || a.kind === 'animal' || a.hp <= 0 || !is_world_uid(game, a.uid)) return;
  const target = 1 + Math.floor((cap - 1) * (0.2 + 0.7 * hash01(a.uid, game.seed)));
  while ((a.lvl || 1) < target) level_up(game, a, false);
}
function catch_up_levels(game) { for (const a of game.world.level.actors) catch_up_actor(game, a); }

class SharedWorld {
  constructor(db, uid, season, now = () => Date.now()) {
    this.db = db; this.uid = uid; this.season = season; this.now = now; this.game = null; this.unsubs = [];
    this.dead_buf = []; this.dirty_named = new Set(); this.last_flush = 0; this.last_day = 0; this.closed = false;
    this.named = new Map(); this.hall = []; this.outcome = null; this.tombs = new Map(); this.onclose = null; this.onchange = null;
  }
  get n() { return this.season.n; }
  calendar_day() { return season_day(this.season, this.now()); }
  seconds_left() { return Math.max(0, Math.floor((this.season.endsAt - this.now()) / 1000)); }
  _col(name) { return this.db.collection(name).where('season', '==', this.n); }
  _safe(p) { return Promise.resolve(p).catch((e) => { console.warn('shared write failed', e && e.code); }); }

  attach(game) {
    this.game = game; game.shared = this; game.season_n = this.n;
    this.unsubs.push(this._col('tombs').onSnapshot((s) => this._tombs(s), () => {}));
    this.unsubs.push(this._col('named').onSnapshot((s) => this._named(s), () => {}));
    this.unsubs.push(this._col('dead').onSnapshot((s) => this._dead(s), () => {}));
    this.unsubs.push(this._col('taken').onSnapshot((s) => this._taken(s), () => {}));
    this.unsubs.push(this._col('hall').onSnapshot((s) => { this.hall = s.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 30); if (this.onchange) this.onchange(); }, () => {}));
    this.unsubs.push(this.db.doc('play/outcome').onSnapshot((s) => this._outcome(s), () => {}));
    this.unsubs.push(this.db.doc('season/current').onSnapshot((s) => this._season(s), () => {}));
    this.sync_calendar();
  }
  detach() { for (const u of this.unsubs) { try { u(); } catch (e) { /* ignore */ } } this.unsubs = []; if (this.game) this.game.shared = null; }

  // ---- incoming
  _tombs(snap) { const g = this.game; if (!g) return; for (const c of snap.docChanges()) { if (c.type === 'removed') continue; const d = c.doc.data(); this.tombs.set(c.doc.id, d); apply_tomb(g, c.doc.id, d); } if (this.onchange) this.onchange(); }
  _named(snap) { const g = this.game; if (!g) return; for (const c of snap.docChanges()) { const d = c.doc.data(); if (c.type === 'removed') { this.named.delete(c.doc.id); continue; } this.named.set(c.doc.id, d); apply_named(g, c.doc.id, d); } if (this.onchange) this.onchange(); }
  _dead(snap) { const g = this.game; if (!g) return; for (const c of snap.docChanges()) if (c.type !== 'removed') apply_dead(g, c.doc.data().uids || []); }
  _taken(snap) { const g = this.game; if (!g) return; for (const c of snap.docChanges()) if (c.type !== 'removed') apply_taken(g, c.doc.data().id); }
  _outcome(snap) {
    const d = snap.exists ? snap.data() : null;
    if (!d || d.season !== this.n) { this.outcome = null; return; }
    this.outcome = d;
    if (d.by !== this.uid && this.game && !this.game.over) this.close(d.kind === 'won' ? `${d.label || 'Someone'} made the cure on day ${d.day}. The world is saved, for this season. It will be reset by the keeper.`
      : 'The way out closed. Nobody made it. The world is lost, for this season, and will be reset by the keeper.');
  }
  _season(snap) {
    const d = snap.exists ? snap.data() : null;
    if (!d) return;
    if (d.n !== this.n) { this.close('The keeper reset the world. This season is over; a new one is waiting.', true); return; }
    this.season = d;
  }
  close(text, reset = false) {
    if (this.closed) { if (reset && this.game) this.game.season_reset = true; return; }
    this.closed = true; if (this.game && !this.game.over) { this.game.over = build_ending(this.game, 'closed', text); this.game.season_reset = reset; }
    if (this.onclose) this.onclose(text, reset);
  }

  // ---- outgoing (engine hooks)
  on_player_died(info) {
    const id = `t${this.n}_${this.uid ? String(this.uid).slice(-6) : 'x'}_${Date.now().toString(36)}`;
    this.game.applied_tombs[id] = 'on';
    this.game.tomb_at[`${info.level_id}|${info.key}`] = id;
    if (info.record) info.record.tomb_id = id;
    this._safe(this.db.doc(`tombs/${id}`).set({ season: this.n, label: info.label, level: info.level, x: info.x, y: info.y, level_id: info.level_id,
      items: info.items, claimed: false, risen: false, by: this.uid, at: this.now() }));
    this._safe(this.db.collection('hall').add({ season: this.n, kind: 'fallen', label: info.label, level: info.level, day: this.calendar_day(), cause: info.cause, by: this.uid, at: this.now() }));
    if (info.killer) this.register_named(info.killer, info.killer.title);
  }
  register_named(a, title) {
    const g = this.game;
    if (!a.sid) a.sid = `n${this.n}_${a.uid}_${Date.now().toString(36)}`;
    const d = { season: this.n, sid: a.sid, uid: is_world_uid(g, a.uid) ? a.uid : null, kind: a.kind, role: a.role || '', special: a.special || '', name: a.name, title: title || a.title || '',
      lvl: a.lvl || 1, x: a.x, y: a.y, level_id: a.level_id, alive: true, at: this.now() };
    this.named_known = this.named_known || new Set(); this.named_known.add(a.sid);
    g.named_state[a.sid] = 'alive';
    this._safe(this.db.doc(`named/${a.sid}`).set(d));
  }
  on_enemy_death(a) {
    if (a.sid) { g_state(this.game, a.sid, 'dead'); this._safe(this.db.doc(`named/${a.sid}`).update({ alive: false, killed_by: this.uid, at: this.now() })); return; }
    if (is_world_uid(this.game, a.uid) && a.level_id === 'world') { this.dead_buf.push(a.uid); if (this.dead_buf.length >= 25) this.flush(); }
  }
  on_enemy_level(a) { if (a.sid) this.dirty_named.add(a); }
  on_component_taken(id) { this._safe(this.db.doc(`taken/s${this.n}_${id}`).set({ season: this.n, id, by: this.uid, at: this.now() })); }
  on_fallen_rise(z, tomb_id) {
    this._safe(this.db.doc(`tombs/${tomb_id}`).update({ risen: true }));
    z.sid = `t_${tomb_id}`; this.register_named(z, z.title);
  }
  on_outcome(kind) {
    const label = this.game ? label_of(this.game, this.game.generation, this.game.current_origin) : '';
    this._safe(this.db.doc('play/outcome').set({ season: this.n, kind, by: this.uid, label, day: this.calendar_day(), at: this.now() }));
    this._safe(this.db.collection('hall').add({ season: this.n, kind, label, level: this.game.player.level, day: this.calendar_day(), cause: kind === 'won' ? 'cure' : 'lost', by: this.uid, at: this.now() }));
  }
  flush() {
    if (this.dead_buf.length) {
      const uids = this.dead_buf.splice(0);
      this._safe(this.db.doc(`dead/s${this.n}_${this.uid || 'x'}_${Date.now().toString(36)}`).set({ season: this.n, uids, by: this.uid }));
    }
    for (const a of this.dirty_named) this._safe(this.db.doc(`named/${a.sid}`).update({ lvl: a.lvl || 1, x: a.x, y: a.y, level_id: a.level_id }));
    this.dirty_named.clear(); this.last_flush = this.now();
  }
  sync_calendar() {
    const g = this.game, day = this.calendar_day();
    if (day !== this.last_day) { this.last_day = day; catch_up_levels(g); }
  }
  // called every game turn
  tick(game) {
    const t = game.clock.turn;
    if (t % 25 === 0) {
      this.sync_calendar();
      if (this.now() >= this.season.endsAt && !this.closed) this.close('The season has ended. The keeper will reset the world.');
      if (this.now() - this.last_flush > 30000) this.flush();
      for (const [key, id] of Object.entries(game.tomb_at)) {          // someone emptied a tomb: tell the others
        if (game.applied_tombs[id] !== 'on') continue;
        const [lid, k] = key.split('|'), lv = game.levels[lid];
        if (lv && !lv.items[+k]) { game.applied_tombs[id] = 'claimed'; this._safe(this.db.doc(`tombs/${id}`).update({ claimed: true })); }
      }
    }
  }
  on_level_created(lv) {
    const list = this.game.pending_shared[lv.id];
    if (!list) return;
    delete this.game.pending_shared[lv.id];
    for (const e of list) { if (e.kind === 'tomb') apply_tomb(this.game, e.id, e.d); else apply_named(this.game, e.id, e.d); }
  }
  summary() {
    const alive = [...this.named.values()].filter((d) => d.alive).sort((a, b) => b.lvl - a.lvl).slice(0, 6);
    return { n: this.n, day: this.calendar_day(), seconds_left: this.seconds_left(), fallen: this.hall.filter((h) => h.kind === 'fallen').length, hall: this.hall, named: alive, outcome: this.outcome };
  }
}
const g_state = (game, sid, s) => { game.named_state[sid] = s; };

// ---- the keeper (admin): reset and clean up
const reset_world = async (db, prev, cfg, now, opts) => {
  const next = new_season(prev, cfg, now, opts);
  await db.doc('season/current').set(next);
  if (prev) {                                                   // best-effort cleanup of the old season's ledger
    for (const name of ['tombs', 'named', 'dead', 'taken', 'hall']) {
      try { const snap = await db.collection(name).where('season', '==', prev.n).limit(500).get(); for (const d of snap.docs) await db.doc(`${name}/${d.id}`).delete(); } catch (e) { /* ignore */ }
    }
    try { await db.doc('play/outcome').delete(); } catch (e) { /* ignore */ }
  }
  return next;
};
