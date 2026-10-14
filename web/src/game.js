// ---------------------------------------------------------------- world time
class Clock {
  constructor(turn) { this.turn = turn; }
  get tpd() { return CONTENT.clock.turns_per_day; }
  get tph() { return CONTENT.clock.turns_per_hour; }
  get day() { return Math.floor(this.turn / this.tpd) + 1; }
  get hour() { return (this.turn % this.tpd) / this.tph; }
  get light() {
    const h = this.hour;
    if (h >= 7 && h < 19) return 1.0;
    if (h >= 5 && h < 7) return (h - 5) / 2;
    if (h >= 19 && h < 21) return 1 - (h - 19) / 2;
    return 0.0;
  }
  get is_night() { return this.light < 0.35; }
  get is_day() { return this.light > 0.7; }
  get phase() { const h = this.hour; return h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 19 ? 'day' : h >= 19 && h < 21 ? 'dusk' : 'night'; }
  stamp() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `Day ${this.day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  until_hour(hour) {
    const target = Math.floor(hour * this.tph), now = this.turn % this.tpd;
    return (((target - now) % this.tpd) + this.tpd) % this.tpd || this.tpd;
  }
}

const LIVE_MAX_CATCHUP = 80;
const WALK_DRAIN = 1.5, SNEAK_DRAIN = 0.7, SPRINT_DRAIN = 3.0, TIRED_BELOW = 20;
const CHRONICLE_LIMIT = 160, CHRONICLE_KEEP = 25;
const LOG_LIMIT = 600, SCENT_KEEP = 60, FORCE_TURNS = 6;

function default_config() {
  return { era: 'modern', zombies: 'classic', scenario: 'cure', origin: 'medic', mode: 'normal', difficulty: 'normal', seed: null,
           needs: false, permadeath: true, map_w: 360, map_h: 240, opening: 'random' };
}

// Any of era, zombies, scenario, origin and mode may be 'random': drawn when the game starts (reproducibly if there is a seed).
const RANDOMIZABLE = ['era', 'zombies', 'scenario', 'origin', 'mode'];
function resolve_config(cfg) {
  const c = Object.assign({}, cfg), drawn = [];
  const rng = new RNG(c.seed !== null && c.seed !== undefined ? ((c.seed ^ 0xC0FFEE) >>> 0) : Math.floor(Math.random() * 4294967296));
  const choices = { era: Object.keys(CONTENT.eras), zombies: Object.keys(CONTENT.presets), scenario: Object.keys(CONTENT.scenarios),
                    origin: Object.keys(CONTENT.origins), mode: ['normal', 'living'] };
  for (const f of RANDOMIZABLE) if (c[f] === 'random') { c[f] = rng.choice(choices[f]); drawn.push(f); }
  return [c, drawn];
}

class Game {
  constructor(cfg, _blank = false) {
    if (_blank) return;                                   // used by deserialize_game
    const [resolved, drawn] = resolve_config(Object.assign(default_config(), cfg));
    this.cfg = resolved;
    const c = this.cfg;
    if (!CONTENT.eras[c.era]) throw new Error('unknown era ' + c.era);
    if (!CONTENT.presets[c.zombies]) throw new Error('unknown zombie preset ' + c.zombies);
    if (!CONTENT.scenarios[c.scenario]) throw new Error('unknown scenario ' + c.scenario);
    if (!CONTENT.origins[c.origin]) throw new Error('unknown origin ' + c.origin);
    if (c.opening !== 'random' && !CONTENT.openings[c.opening]) throw new Error('unknown opening ' + c.opening);
    if (c.mode !== 'normal' && c.mode !== 'living' && c.mode !== 'shared') throw new Error('unknown mode ' + c.mode);
    if (!CONTENT.difficulties[c.difficulty]) throw new Error('unknown difficulty ' + c.difficulty);
    if (c.map_w < 100 || c.map_h < 64) throw new Error('map too small (minimum 100x64)');
    this._init_state();
    setup_game(this);
    if (drawn.length) {
      const names = { era: this.era.name.split(' - ')[0], zombies: this.profile.name.split(' - ')[0], scenario: this.scenario.name.split(' - ')[0],
                      origin: this.era.origin_names[c.origin], mode: c.mode === 'living' ? 'hardcore' : 'normal' };
      this.msg('Random draw: ' + RANDOMIZABLE.filter((f) => drawn.includes(f)).map((f) => names[f]).join(', ') + '.', 'lore');
    }
    this.update_fov();
  }

  _init_state() {
    this._uid = 0; this.log = []; this.chronicle = []; this.over = null; this.pending_event = null; this.recent_events = {};
    this.hordes = []; this.ring = null; this.heat = 0.0; this.stalker = null; this.stalker_ready = 0; this.last_moan = -999;
    this.patrol_goals = {}; this.distress = {}; this.aided = {};
    this.live_started = false; this.paused = false; this.busy = 0; this.rest_left = 0; this.sleep_left = 0; this.live_acc = 0; this.live_last = 0; this.invuln_until = 0;
    this.gen_day = 0; this.dead_uids = new Set(); this.deadline_days = 0; this.lost_turns = 0; this.incidents = [];
    this.shared = null; this.season_n = 0; this.world_uid_max = 0; this.pending_shared = {}; this.applied_tombs = {}; this.tomb_at = {}; this.named_state = {}; this.taken_components = []; this.season_reset = false;
    this.regions = []; this.region_id = -1; this.checkpoints = {}; this.foraged = [];
    this.marks = []; this.nemeses = []; this.pet_uid = 0; this.companion_uid = 0; this.fallen_allies = []; this.story = []; this.objective_seen = {};
    this.weather = 'clear'; this.sources = []; this.alarmed = []; this.last_step_note = -999; this.pings = []; this.flash_turn = -999;
    this.base_id = null; this.raid_next = 0;
    this.generation = 1; this.current_origin = 'medic'; this.fallen = []; this.fallen_bodies = {}; this.killer = null; this.death_notice = ''; this.patrol_nodes = []; this.opening_id = ''; this.intro_pages = [];
    this.followers = []; this.final = null; this.formula_found = false; this.applied_docs = new Set(); this.scent = {};
    this.visible = new Set(); this.on_autosave = null; this._field = null; this._field_key = ''; this._step_parity = 0; this._tired_parity = 0;
    this._force_progress = {};
  }

  // ------------------------------------------------------------- basics
  next_uid() { return ++this._uid; }
  // The focused log, plus whatever just happened to you: a refused shot, a hit, a wound.
  story_log() {
    const story = new Set(this.story.slice(-80).map((m) => m[0] + '|' + m[1])), now = this.clock.turn;
    return this.log.slice(-120).filter((m) => story.has(m[0] + '|' + m[1]) || (m[0] >= now - 2 && (m[2] === 'warn' || m[2] === 'bad' || m[2] === 'combat' || m[2] === 'good')));
  }
  msg(text, tag = 'info', key = false) {
    if (!text) return;
    this.log.push([this.clock.turn, text, tag]);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, 100);
    if (key || tag === 'obj' || tag === 'ally' || tag === 'lore' || tag === 'dir') {         // the log that matters: objectives, companions, key events
      this.story.push([this.clock.turn, text, tag]);
      if (this.story.length > LOG_LIMIT) this.story.splice(0, 100);
    }
    if (key || tag === 'good' || tag === 'lore') this._chronicle(text);
  }
  // the few lines worth retelling at the end; keeps the start and the latest
  _chronicle(text) {
    const c = this.chronicle || (this.chronicle = []);
    if (c.length && c[c.length - 1][2] === text) return;
    c.push([this.clock.turn, game_day(this), text]);
    if (c.length > CHRONICLE_LIMIT) c.splice(CHRONICLE_KEEP, 1);
  }
  item_def(id) { return this.items[id]; }
  is_dark() { return this.level.dark || this.clock.is_night; }
  get turn() { return this.clock.turn; }
  poi_of_level(level) { return this.pois[level.poi_id] || null; }
  poi_kind_of(level) { const p = this.poi_of_level(level); return p ? p.kind : 'camp'; }
  vault_component(level) { const p = this.poi_of_level(level); return p ? p.component : ''; }

  // ------------------------------------------------------------- state changes
  add_panic(amount, raw = false) {
    const p = this.player;
    if (amount > 0 && !raw) {
      amount *= Math.max(0.1, 1.0 - p.mod('panic_resist'));
      if (p.humanity < 25) amount *= 0.6;
    }
    p.panic = Math.max(0, Math.min(p.max_panic, p.panic + amount));
  }
  add_heat(amount, raw = false) { this.heat = Math.max(0, Math.min(100, this.heat + (raw ? amount : amount * this.diff.noise))); }
  adjust_humanity(delta, why) {
    const p = this.player, before = p.humanity;
    p.humanity = Math.max(0, Math.min(100, p.humanity + delta));
    if (why) this.msg(why, delta < 0 ? 'bad' : 'good');
    if (before >= 25 && p.humanity < 25) this.msg('Something in you goes quiet. The fear dulls. So does everything else.', 'warn');
    else if (before >= 75 && p.humanity < 75) this.msg('The people who trusted you would not recognise you now.', 'warn');
  }
  give_item(item) {
    const d = this.item_def(item.id);
    if (d.durability && (item.dur === null || item.dur === undefined)) item.dur = d.durability;
    item.key = d.kind === 'component';
    if (!this.player.add_item(item, d.stackable)) {
      this.level.drop([this.player.x, this.player.y], item);
      this.msg(`Your pack is full; the ${d.name.toLowerCase()} falls at your feet.`, 'warn');
    }
  }
  end(kind, cause = '') {
    if (this.over) return;
    if ((kind === 'dead' || kind === 'turned') && this.cfg.mode !== 'normal') { player_died(this, kind, cause); return; }   // the world goes on
    this.over = build_ending(this, kind, cause);
    if (this.shared && (kind === 'won' || kind === 'left_behind')) this.shared.on_outcome(kind === 'won' ? 'won' : 'lost');
  }
  make_hostile(h) {
    if (h.hostile) return;
    h.hostile = true;
    const f = h.faction || 'enclave';
    this.rep[f] = (this.rep[f] || 0) - 20;
    this.msg(`The ${h.name.toLowerCase()} turns on you!`, 'bad', true);
    military_rally(this, h);
    if (['trader', 'healer', 'scholar'].includes(h.role)) this.rep.enclave = (this.rep.enclave || 0) - 40;
  }

  // ------------------------------------------------------------- perception and noise
  vision_radius() {
    const p = this.player, lv = this.level;
    let r;
    if (lv.kind === 'haven' && !this.final) r = 12;
    else if (lv.dark) r = this.poi_kind_of(lv) === 'cave' ? 3 : 7;                 // a cave is black: you see what your light shows
    else { const light = this.clock.light; r = (light > 0.7 ? 14 : light > 0.35 ? 10 : 5) + (WEATHER_PLAYER_SIGHT[this.weather] || 0); }      // fog and storms shorten your view
    if (this.is_dark()) {
      r += Math.floor(p.mod('night_vision')) + this.era.rules.night_view;       // a visor, or a moonless medieval night
      if (player_lit(this)) r = Math.max(r, this.item_def(p.light.id).light);
    }
    return r;
  }
  update_fov() {
    const lv = this.level, p = this.player;
    if (lv === this.world.level && this.world.chunked) gen_near(this, p.x, p.y);
    this.visible = visible_tiles(lv, [p.x, p.y], this.vision_radius());
    for (const k of this.visible) lv.seen[k] = 1;
    if (lv.kind === 'overworld') {
      const sense = 12 + Math.floor(p.mod('poi_sense'));
      for (const poi of Object.values(this.pois)) {
        if (!poi.revealed && poi.kind !== 'breach' && poi.kind !== 'house' && cheb(poi_pos(poi), [p.x, p.y]) <= sense) {
          poi.revealed = true;
          this.msg(`You notice ${poi.kind === 'cave' ? 'a way underground' : 'a building'} ahead: ${poi.name}.`, 'info');
        }
      }
    }
  }
  is_visible(x, y) { return this.visible.has(this.level.idx(x, y)); }
  visible_actors() { return this.level.actors.filter((a) => this.is_visible(a.x, a.y) && !a.hidden); }
  visible_hostiles() { return this.visible_actors().filter((a) => a.kind === 'zombie' || (a.kind === 'human' && a.hostile)); }
  zombie_sees_player(z) { return sees_player(this, z); }

  emit_noise(pos, radius, source = 'player') {
    radius *= hearing_scale(this);                        // rain muffles, fog carries a little less
    if (radius < 1) return;
    if (radius >= 3) { this.pings.push({ pos: [pos[0], pos[1]], radius, turn: this.clock.turn, kind: source, level: this.level.id }); if (this.pings.length > 12) this.pings.splice(0, this.pings.length - 12); }
    const turn = this.clock.turn;
    for (const a of this.level.actors) {
      if (a.kind !== 'zombie' || a.state === 'hunt') continue;
      const reach = radius * a.hearing;
      if ((a.x - pos[0]) ** 2 + (a.y - pos[1]) ** 2 > reach * reach) continue;
      a.state = 'investigate'; a.target = [pos[0], pos[1]]; a.stimulus_turn = turn;
      a.alert = Math.min(95, (a.alert || 0) + 25 + 30 * (1 - Math.sqrt((a.x - pos[0]) ** 2 + (a.y - pos[1]) ** 2) / reach));     // closer noise rattles it more; only seeing you makes it hunt
    }
    if (this.level === this.world.level) noise_attracts(this, pos, radius);
    if (source === 'player' && radius >= 8) this.add_heat(radius * 0.12);
  }
  scent_near(pos, radius) {
    let best = null, best_t = -1;
    const w = this.level.w;
    for (const [k, t] of Object.entries(this.scent)) {
      const spot = [k % w, Math.floor(k / w)];
      if (t > best_t && cheb(spot, pos) <= radius) { best = spot; best_t = t; }
    }
    return best;
  }
  get_field() {
    const p = this.player, key = `${this.clock.turn}:${p.x},${p.y}:${this.level.id}`;
    if (this._field_key !== key) {
      this._field = distance_field(this.level, [p.x, p.y], FIELD_RADIUS, !!this.profile.swarm);
      this._field_key = key;
    }
    return this._field;
  }

  // ------------------------------------------------------------- real time (hardcore worlds)
  // In a live world the clock runs by itself, one tick every `tick_ms`. An action takes effect at once and keeps you busy
  // for as many ticks as it costs, so the world never waits for you. Until `start_live` the game is turn-based (tests, normal mode).
  get live() { return this.live_started; }
  ready() { return !this.live_started || this.busy <= 0; }
  tick_ms() { return (this.shared && this.shared.season.tickMs) || this.cfg.tick_ms || 700; }
  start_live(now) { this.live_started = true; this.live_last = now; this.live_acc = 0; this.busy = 0; if (this.shared) this.shared.sync_calendar(); }
  // Run the ticks that real time owes the world. Returns how many ran.
  live_update(now) {
    if (!this.live_started || this.over) return 0;
    const tm = this.tick_ms();
    let n;
    if (this.paused) { this.live_last = now; return 0; }
    if (this.shared) {
      const target = Math.floor((now - this.shared.season.startedAt) / tm);
      n = target - this.clock.turn;
      if (n > LIVE_MAX_CATCHUP) {                         // the page was away: the world moved on without playing out every tick
        this.clock.turn = target - 3; n = 3; this.shared.sync_calendar();
      }
    } else {
      this.live_acc += Math.min(Math.max(0, now - this.live_last), 3000); this.live_last = now;
      n = Math.floor(this.live_acc / tm); this.live_acc -= n * tm;
    }
    let ran = 0;
    for (let i = 0; i < n && !this.over; i++) {
      if (this.busy > 0) this.busy--;
      this._tick(); ran++;
      if (this.sleep_left > 0 && --this.sleep_left === 0) this._wake();
      else this._live_rest();
    }
    if (ran && !this.over) this.update_fov();
    return ran;
  }
  _live_rest() {
    if (this.rest_left <= 0 || this.busy > 0) return;
    const p = this.player;
    if (this.visible_hostiles().length || this.pending_event || p.hp < (this._rest_hp || 0)) { this.rest_left = 0; return; }
    this.rest_left--; this._rest_hp = p.hp;
    if (p.hp < p.max_hp && !p.bleeding && this.clock.turn % 3 === 0) p.hp += 1;
    p.stamina = Math.min(p.max_stamina, p.stamina + 1.5);
    if (p.hp >= p.max_hp && p.stamina >= p.max_stamina && p.panic < 5) this.rest_left = 0;
  }
  _wake() {
    const p = this.player;
    p.hp = Math.min(p.max_hp, p.hp + Math.floor(p.max_hp * 0.6));
    p.stamina = p.max_stamina; p.panic = 0;
    this.msg('You wake.', 'info');
    if (p.infected) this.msg('You wake in a sweat. The fever has not broken.', 'warn');
  }

  // ------------------------------------------------------------- the world tick
  _spend(turns) {
    if (this.live_started) { this.busy += Math.max(0, turns); this.rest_left = 0; if (!this.over) this.update_fov(); return; }
    for (let i = 0; i < Math.max(0, turns); i++) { if (this.over) break; this._tick(); }
    if (!this.over) this.update_fov();
  }

  _tick() {
    this.clock.turn += 1;
    const t = this.clock.turn;
    this._player_conditions(); if (this.over) return;
    this._hazards(); if (this.over) return;
    ai_run(this); if (this.over) return;
    abstract_run(this);
    hordes_tick(this);
    wanderers(this);
    this._followers();
    this._rising_dead();
    if (this.shared) this.shared.tick(this);
    this._heat();
    this.pings = this.pings.filter((q) => t - q.turn <= 6);
    if (t % 5 === 0) mutation_crossing(this);
    this._time_events(); weather_tick(this); world_tick(this); this._base_tick(); military_tick(this); comp_tick(this); objective_watch(this); dir_tick(this); pets_tick(this); memory_tick(this);
    if (this.incidents.length && t % 5 === 0) this._check_incidents();
    if (this.final) this._final_tick();
    if (t % 40 === 0) this._maybe_event();
    if (t % 30 === 0) {
      for (const k of Object.keys(this.scent)) if (t - this.scent[k] >= SCENT_KEEP) delete this.scent[k];
    }
    if (t % 100 === 0 && this.on_autosave) { try { this.on_autosave(this); } catch (e) { /* storage unavailable */ } }
  }

  // your base is safe while nothing hostile is in it; at night the dead find it and come in at the entrance
  _base_tick() {
    if (!in_base(this)) return;
    const lv = this.level, p = this.player, hostile = hostiles_in(lv).length > 0;
    lv.safe = !hostile && !this.final;
    if (hostile || this.final || this.clock.turn < this.raid_next || !this.clock.is_night) return;
    if (this.rng.random() >= 0.03) return;
    const n = Math.min(10, Math.floor((3 + Math.floor(p.level / 3) + Math.floor(game_day(this) / 5)) * Math.max(1.0, this.pressure)));
    const spots = [];
    for (let y = lv.entry[1] - 5; y <= lv.entry[1] + 5; y++) for (let x = lv.entry[0] - 5; x <= lv.entry[0] + 5; x++) if (lv.free(x, y) && cheb([x, y], [p.x, p.y]) > 2) spots.push([x, y]);
    for (let i = spots.length - 1; i > 0; i--) { const j = this.rng.randint(0, i); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    let placed = 0;
    for (const spot of spots.slice(0, n)) {
      if (!lv.free(spot[0], spot[1])) continue;
      const z = spawn_zombie(this, lv, spot, null, false, true);
      z.state = 'hunt'; z.target = [p.x, p.y]; z.stimulus_turn = this.clock.turn; placed++;
    }
    if (!placed) return;
    this.raid_next = this.clock.turn + RAID_GAP + this.rng.randint(0, 100);
    lv.safe = false;
    this.msg('The dead have found your base. They are coming in at the entrance!', 'bad', true);
    this.emit_noise(lv.entry, 8, 'zombie');
  }

  claim_base() { if (!this._begin_action()) return false; const t = claim_base(this); this._spend(t); return t > 0; }
  build_structure(sid) { if (!this._begin_action()) return false; const t = build_structure(this, sid); this._spend(t); return t > 0; }

  _infection_total() {
    if (this.scenario.start_infected && this.cfg.mode === 'normal') return Math.max(1, Math.floor(this.scenario.timer_turns * this.diff.timer));
    return Math.max(1, Math.floor(this.profile.incubation * this.diff.timer));
  }

  _player_conditions() {
    const p = this.player, t = this.clock.turn;
    if (p.bleeding) {
      if (t % 4 === 0) {
        p.hp -= p.bleeding; this.add_panic(1.5);
        if (p.hp <= 0) { this.end('dead', 'bled out'); return; }
      }
      if (!p.hemorrhage && this.rng.random() < 0.03) {
        p.bleeding -= 1;
        if (!p.bleeding) this.msg('The bleeding stops on its own.', 'good');
      }
    }
    if (p.infected) {
      p.infection_timer -= 1;
      if (p.bite_window > 0) {
        p.bite_window -= 1;
        if (p.bite_window === 0 && (p.bite_limb === 'arm' || p.bite_limb === 'leg')) this.msg('It is too late to cut it off. The infection has spread.', 'bad', true);
      }
      const left = p.infection_timer, total = this._infection_total();
      if ((left === Math.floor(total / 2) || left === Math.floor(total / 4) || left === 30 || left === 10) && left > 0) {
        this.msg(`Fever. Your hands shake. About ${Math.max(1, Math.floor(left / 10))} hours left.`, 'warn');
        this.add_panic(5);
      }
      if (left <= 0) { this.end('turned', ''); return; }
    }
    if (this.cfg.needs) {
      p.hunger = Math.min(100, p.hunger + 0.12);
      if (p.hunger >= 100 && t % 5 === 0) { p.hp -= 1; if (p.hp <= 0) { this.end('dead', 'starved'); return; } }
    }
    if (p.hp < p.max_hp && !p.bleeding && p.hunger < 75 && t % 12 === 0) p.hp += 1;
    p.stamina = Math.min(p.max_stamina, p.stamina + (p.sprinting ? 0.3 : 0.9));
    const near = this.level.actors.some((a) => a.kind === 'zombie' && a.state === 'hunt' && cheb([a.x, a.y], [p.x, p.y]) < 9);
    if (near) {
      this.add_panic(0.15);
      const adj = this.level.actors.filter((a) => a.kind === 'zombie' && cheb([a.x, a.y], [p.x, p.y]) === 1).length;
      if (adj >= 3) this.add_panic(3.0 * (adj - 2));
    } else p.panic = Math.max(0, p.panic - (this.level.safe ? 2.0 : 0.35));
    if (this.is_dark() && !player_lit(this)) this.add_panic(0.1);
    if (p.filter_turns) p.filter_turns -= 1;
    if (p.disguise_turns) p.disguise_turns -= 1;
    if (p.light && p.light_on && this.is_dark() && p.light.dur) {
      p.light.dur -= 1;
      if (p.light.dur === 0) this.msg(`Your ${this.item_def(p.light.id).name.toLowerCase()} flickers out.`, 'warn');
    }
  }

  _hazards() {
    const lv = this.level, p = this.player;
    for (const k of Object.keys(lv.hazards)) {
      const hz = lv.hazards[k];
      if (hz.ttl < 1e8) { hz.ttl -= 1; if (hz.ttl <= 0) { delete lv.hazards[k]; continue; } }
      const victim = lv.occ.get(+k);
      if (hz.kind === 'snare') {
        if (victim === p) {
          delete lv.hazards[k];
          this.msg('You step into a hidden snare! Something clatters loudly.', 'bad');
          p.bleeding = Math.min(3, p.bleeding + 1);
          this.emit_noise([p.x, p.y], 12, 'world');
          raiders_alert_near(this, [p.x, p.y], 14);
          damage_player(this, hz.power, "caught in a raider's snare");
          if (this.over) return;
        } else if (victim && victim.kind === 'zombie') {
          delete lv.hazards[k]; victim.hp -= hz.power;
          if (victim.hp <= 0) kill_zombie(this, victim, false, false);
        }
        continue;
      }
      if (hz.kind === 'spikes') {
        if (victim && victim.kind === 'zombie') {
          delete lv.hazards[k]; victim.hp -= hz.power;
          if (this.visible.has(+k)) this.msg(`The ${victim.name.toLowerCase()} impales itself on your trap.`, 'good');
          if (victim.hp <= 0) kill_zombie(this, victim, false, true);
        }
        continue;
      }
      if (hz.kind === 'fire') {
        if (victim && victim.kind === 'zombie') { victim.hp -= 4; if (victim.hp <= 0) kill_zombie(this, victim, false, true); }
        else if (victim === p) {
          this.msg('You are burning!', 'bad');
          damage_player(this, 4, 'burned alive');
          if (this.over) return;
        }
      } else if (hz.kind === 'spore' && victim === p && !p.filter_turns) {
        if (this.profile.vector === 'spore') {
          if (this.rng.random() < 0.12 * (1.0 - p.mod('infect_resist'))) infect(this, 'spore');
        } else { damage_player(this, 2, 'choked on the fumes'); if (this.over) return; }
        this.add_panic(1.0);
      }
    }
  }

  _heat() {
    const prof = this.profile;
    if (this.heat >= prof.stalker_heat && !this.stalker && this.clock.turn >= this.stalker_ready &&
        this.level === this.world.level && !this.final) this._spawn_stalker();
    this.heat = Math.max(0, this.heat - (this.level.safe ? 1.5 : 0.4));
  }

  _spawn_stalker() {
    const p = this.player, lv = this.level;
    for (let i = 0; i < 60; i++) {
      const ang = this.rng.uniform(0, Math.PI * 2), r = this.rng.randint(14, 20);
      const pos = [Math.trunc(p.x + Math.cos(ang) * r), Math.trunc(p.y + Math.sin(ang) * r)];
      if (lv.free(pos[0], pos[1]) && !this.is_visible(pos[0], pos[1])) {
        const z = spawn_zombie(this, lv, pos, 'stalker', false, true);
        z.state = 'hunt'; z.target = [p.x, p.y]; z.stimulus_turn = this.clock.turn;
        this.stalker = z; this.heat = 55.0;
        this.msg(`Something is hunting you. A ${z.name.toLowerCase()}, and it does not stop.`, 'bad', true);
        this.add_panic(15);
        return;
      }
    }
  }
  on_stalker_killed() {
    this.stalker = null; this.stalker_ready = this.clock.turn + 500; this.heat = 20.0;
    this.player.gain_xp(60);
    this.msg('The Stalker is dead. For now.', 'good');
  }
  on_ring_escaped() { this.stalker_ready = Math.max(this.stalker_ready, this.clock.turn + 120); }

  _followers() {
    for (const entry of this.followers.slice()) {
      if (this.clock.turn < entry.due) continue;
      this.followers.splice(this.followers.indexOf(entry), 1);
      if (this.level.id !== entry.level_id) continue;
      const p = this.player, z = entry.z;
      const spot = this.level.free_spot_near(p.x, p.y, 5);
      if (spot && cheb(spot, [p.x, p.y]) >= 2) {
        z.x = spot[0]; z.y = spot[1];
        this.level.add_actor(z);
        z.state = 'hunt'; z.target = [p.x, p.y]; z.stimulus_turn = this.clock.turn;
        this.msg(`The ${z.name.toLowerCase()} followed you in!`, 'bad');
      }
    }
  }

  _rising_dead() {
    const lv = this.level, t = this.clock.turn, w = lv.w;
    for (const k of Object.keys(lv.corpses)) {
      const [died, human] = lv.corpses[k];
      const x = k % w, y = Math.floor(k / w);
      if (t - died > 800) delete lv.corpses[k];
      else if (human && (human === 2 || this.profile.turn_on_death) && t - died > 55 && lv.free(x, y) &&
               cheb([x, y], [this.player.x, this.player.y]) > 1 && !lv.safe) {
        delete lv.corpses[k];
        const fk = `${lv.id}|${k}`, fallen = this.fallen_bodies[fk];
        if (fallen) delete this.fallen_bodies[fk];
        if (fallen && fallen.tomb_id && this.shared && this.named_state[`t_${fallen.tomb_id}`]) continue;   // the shared world already decided
        const z = fallen ? make_fallen(this, lv, [x, y], fallen) : spawn_zombie(this, lv, [x, y], 'walker', false, true);
        if (fallen && fallen.tomb_id && this.shared) this.shared.on_fallen_rise(z, fallen.tomb_id);
        z.fresh_human = false; z.state = 'hunt'; z.target = [this.player.x, this.player.y]; z.stimulus_turn = t;
        if (this.is_visible(x, y)) this.msg('A body twitches, and rises.', 'warn');
      }
    }
  }

  // endless worlds only: 1.0 for the first days, then +6% a day up to x3
  get pressure() { return this.scenario.escalates ? Math.min(3.0, 1.0 + 0.06 * Math.max(0, game_day(this) - 3)) : 1.0; }

  // endless worlds: places you picked clean slowly fill up again
  _restock() {
    let n = 0;
    for (const lv of Object.values(this.levels)) {
      if (lv === this.world.level) continue;
      for (const k of Object.keys(lv.containers)) {
        const c = lv.containers[k];
        if (c.opened && this.rng.random() < 0.5) {
          c.opened = false; c.loot = roll_items(this.rng, this.era, this.poi_kind_of(lv), 1.0, this.diff.loot * 0.7); c.coins = this.rng.randint(0, 4);
          const [x, y] = [+k % lv.w, Math.floor(+k / lv.w)]; lv.set_tile(x, y, T.CRATE); n++;
        }
      }
    }
    if (n) this.msg('Somebody has been through the old places; there is something left in them again.', 'info');
  }

  _time_events() {
    const c = this.clock, sc = this.scenario;
    if (this.profile.sun_burn && c.turn % 240 === 200 && this.world.level.kind === 'overworld') this._dusk_wave();
    const day = game_day(this);
    const eff_day = day + Math.floor(this.lost_turns / 240);        // the road's lost time counts against the deadline
    if (this.deadline_days && eff_day > this.deadline_days && !this.final) this.end('left_behind', '');
    else if (this.deadline_days && c.turn % 240 === 0 && eff_day === this.deadline_days) this.msg('The last day. By nightfall the way out will be gone.', 'obj');
    if (sc.escalates && c.turn % 240 === 0 && day > 1) {
      if (day % 4 === 0) this._restock();
      if (day % 5 === 0) this.msg(`Day ${day}. You are still here. The dead are ${Math.round(this.pressure * 100)}% of what they were on day one.`, 'lore');
    }
    if (c.turn % 240 === 0) {
      if (day > 1) mutation_daily(this);
      const ph = profile_phase(this.profile, day), prev = profile_phase(this.profile, day - 1);
      if (ph !== prev && ph.blurb) this.msg(`Day ${day}: ${ph.name}. ${ph.blurb}`, 'lore');
    }
  }

  _dusk_wave() {
    const lv = this.world.level, p = this.player;
    let n = Math.floor(34 * this.profile.density * this.diff.zombies * this.pressure);
    for (let i = 0; i < n * 4; i++) {
      if (n <= 0) break;
      const pos = [this.rng.randint(3, lv.w - 4), this.rng.randint(3, lv.h - 4)];
      const t = lv.tile(pos[0], pos[1]);
      if (lv.free(pos[0], pos[1]) && (t === T.GRASS || t === T.ROAD) && cheb(pos, [p.x, p.y]) > 12) {
        spawn_zombie(this, lv, pos, null, false);
        n--;
      }
    }
    if (this.level === lv) this.msg('The sun is gone. Shapes begin to move in the streets.', 'warn');
  }

  _maybe_event() {
    if (this.pending_event || this.final || this.level !== this.world.level) return;
    if ((this.ring && this.ring.active) || this.clock.turn < 160 || this.rng.random() > 0.3) return;
    const p = this.player;
    if (this.level.actors.some((a) => a.kind === 'zombie' && cheb([a.x, a.y], [p.x, p.y]) < 11)) return;
    const ev = pick_event(this);
    if (ev) this.pending_event = start_event(this, ev);
  }

  // A scripted road incident fires once when you come within a few tiles of it.
  _check_incidents() {
    if (this.pending_event || this.final || this.level !== this.world.level) return;
    for (const inc of this.incidents) {
      if (!inc.done && cheb([inc.x, inc.y], [this.player.x, this.player.y]) <= 5) {
        inc.done = true;
        this.pending_event = start_event(this, EVENT_BY_ID[inc.event]);
        return;
      }
    }
  }

  resolve_event(index) {
    const ev = this.pending_event;
    if (!ev) return '';
    const text = resolve_event(this, ev, index);
    if (text === 'You cannot afford that.') return text;
    this.pending_event = null;
    this.update_fov();
    return text;
  }

  // ------------------------------------------------------------- hostiles from events
  spawn_horde_near_player() {
    const p = this.player, lv = this.world.level;
    for (let i = 0; i < 40; i++) {
      const ang = this.rng.uniform(0, Math.PI * 2), r = this.rng.randint(16, 22);
      const pos = [Math.trunc(p.x + Math.cos(ang) * r), Math.trunc(p.y + Math.sin(ang) * r)];
      if (pos[0] > 2 && pos[0] < lv.w - 2 && pos[1] > 2 && pos[1] < lv.h - 2 && lv.free(pos[0], pos[1])) {
        spawn_horde(this, pos, null, [p.x, p.y]);
        return;
      }
    }
  }
  spawn_raiders_near_player(n) {
    raiders_ambush(this, this.level, n);
  }
  // You killed something near a patrol that had called for help: they will remember.
  note_assist(pos) {
    for (const a of this.level.actors) {
      if (a.kind === 'human' && a.group && (a.role === 'scout' || a.role === 'soldier') && cheb(apos(a), pos) <= 7 &&
          this.clock.turn - (this.distress[a.group] !== undefined ? this.distress[a.group] : -999) < 300) {
        if (this.aided[a.group] === undefined) this.aided[a.group] = false;
      }
    }
  }
  _unread_in(level) {
    const ids = [].concat(...Object.values(level.docs), ...Object.values(level.containers).map((c) => c.docs || []));
    return ids.filter((d) => !this.player.documents.includes(d)).length;
  }
  // the nearest buildings that still hold pages you have not read
  reveal_paper_leads(n = 2) {
    const p = this.player;
    const pool = Object.values(this.pois).filter((q) => !q.papers && !['breach', 'refuge', 'pad'].includes(q.kind) && q.docs.some((d) => !p.documents.includes(d)));
    pool.sort((a, b) => cheb(poi_pos(a), [p.x, p.y]) - cheb(poi_pos(b), [p.x, p.y]));
    const found = pool.slice(0, n);
    for (const q of found) { q.revealed = true; q.papers = true; }
    return found;
  }

  reveal_random_lead() {
    const all = Object.values(this.pois);
    let pois = all.filter((q) => q.component && !q.lead);
    if (!pois.length) {
      const site = this.pois[this.final_site_id];
      pois = !site.revealed ? [site] : all.filter((q) => !q.revealed && q.kind !== 'house' && q.kind !== 'breach');
    }
    if (!pois.length) return false;
    const poi = this.rng.choice(pois);
    poi.revealed = true; poi.lead = true;
    this.msg(`A lead: ${poi.name} is marked on your map.`, 'obj');
    return true;
  }

  // ------------------------------------------------------------- level handling
  ensure_level(level_id) {
    if (this.levels[level_id]) return this.levels[level_id];
    const cut = level_id.lastIndexOf(':');
    const poi = this.pois[level_id.slice(0, cut)], floor = parseInt(level_id.slice(cut + 1), 10);
    const ctx = { era: this.era, profile: this.profile, loot_mult: this.diff.loot, zombie_mult: this.diff.zombies,
                  spawn: (lv, pos, special = null, dormant = true) => spawn_zombie(this, lv, pos, special, dormant), day: game_day(this) };
    const n = Math.max(1, poi.floors);
    const docs = poi.docs.filter((d, i) => i % n === floor % n);
    const lv = generate_interior(poi, floor, this.seed, ctx, docs);
    lv.poi_id = poi.id;
    this.levels[level_id] = lv;
    for (const z of lv.actors) z.birth_day = game_day(this);
    if (poi.kind === 'refuge') this._populate_refuge(lv);
    if (this.shared) this.shared.on_level_created(lv);
    return lv;
  }

  _populate_refuge(lv) {
    if (!lv.bench) return;
    const [bx, by] = lv.bench;
    const defs = [['trader', 'Trader', bx - 6, by + 3, 'T'], ['healer', 'Healer', bx - 10, by + 3, 'H'], ['scholar', 'Archivist', bx - 14, by + 3, 'S']];
    for (const [role, name, x, y, glyph] of defs) {
      const spot = lv.free_spot_near(x, y, 3);
      if (spot) lv.add_actor({ kind: 'human', uid: this.next_uid(), name, glyph, x: spot[0], y: spot[1], hp: 30, max_hp: 30, level_id: lv.id,
                               role, faction: 'enclave', hostile: false, dmg: [3, 7], acc: 55, reach: 1, energy: 0, state: 'idle',
                               target: null, loot: [], talked: false });
    }
  }

  _use_portal(x, y) {
    if (this.final && this.final.exit && this.final.exit[0] === x && this.final.exit[1] === y && this.level.poi_id === this.final_site_id) { this._escape(); return true; }
    const lv = this.level, p = this.player, old = lv;
    const portal = lv.portals[lv.idx(x, y)];
    const target = portal.target === 'world' ? this.world.level : this.ensure_level(portal.target);
    let dest;
    if (!(portal.pos[0] === -1 && portal.pos[1] === -1)) {
      dest = portal.pos.slice();
      if (target.kind === 'overworld') dest = target.free_spot_near(dest[0], dest[1] + 1, 3) || dest;
    } else dest = (target.arrivals[portal.arrive] || target.entry).slice();
    const occ = target.occ.get(target.idx(dest[0], dest[1]));
    if (!target.walkable(dest[0], dest[1]) || (occ && occ !== p)) dest = target.free_spot_near(dest[0], dest[1], 4) || dest;
    const from_pos = [p.x, p.y];
    if (portal.target !== 'world') pets_on_enter(this);
    const st = this.stalker;
    if (st && st.hp > 0 && old.actors.includes(st) && cheb([st.x, st.y], [p.x, p.y]) <= 10 && st.state === 'hunt') {
      old.remove_actor(st);
      this.followers.push({ due: this.clock.turn + 4, level_id: target.id, z: st });
    }
    if (old.occ.get(old.idx(p.x, p.y)) === p) old.occ.delete(old.idx(p.x, p.y));
    this.level = target;
    p.x = dest[0]; p.y = dest[1];
    target.occ.set(target.idx(p.x, p.y), p);
    p.level_id = target.id;
    comp_carry(this, old, target, dest, from_pos);
    if (portal.target !== 'world') comp_on_enter(this, target);
    this.scent = {};
    const poi = this.poi_of_level(target);
    if (portal.target !== 'world' && poi && !poi.visited) {
      poi.visited = true; poi.revealed = true; this._chronicle(`You enter ${target.name} for the first time.`);
      p.gain_xp(poi.kind === 'house' ? 6 : 15);
      building_alarm(this, poi);
      if (this._unread_in(target)) this.msg('You glimpse written pages somewhere in here.', 'lore');
    }
    this.msg(portal.target !== 'world' ? `You enter ${target.name}.` : 'You step back outside.', 'info');
    if (portal.target === 'world') { comp_on_return(this); pets_on_return(this); }
    this._spend(1);
    return true;
  }

  // ------------------------------------------------------------- movement and interaction
  _begin_action() {
    if (this.over) return false;
    if (this.player.panic >= 95 && this.rng.random() < 0.12) {
      this.msg('You freeze, unable to move!', 'bad');
      this._spend(1);
      return false;
    }
    return true;
  }

  move(dx, dy) {
    if (!this._begin_action()) return false;
    const p = this.player, lv = this.level, nx = p.x + dx, ny = p.y + dy;
    if (!lv.in_bounds(nx, ny)) return false;
    const target = lv.occ.get(lv.idx(nx, ny));
    if (target && target !== p) return this._bump_actor(target);
    const tile = lv.tile(nx, ny), k = lv.idx(nx, ny);
    if (tile === T.DOOR) {
      lv.set_tile(nx, ny, T.DOOR_OPEN); delete lv.door_hp[k]; sfx(this, 'door', [nx, ny]);
      this.emit_noise([p.x, p.y], 2);
      this._spend(1);
      return true;
    }
    if (tile === T.LOCKED) return this.try_unlock([nx, ny]);
    if (tile === T.CRATE || tile === T.CRATE_OPEN) {
      const turns = search_container(this, [nx, ny]);
      this._spend(turns);
      return turns > 0;
    }
    if (tile === T.BENCH) return this.use_bench(true);
    if (tile === T.BED) { this.msg('A bed. Use the SLEEP action beside it.', 'info'); return false; }
    if (tile === T.WORKSHOP) { this.msg('Your workshop. Craft while you stand beside it.', 'info'); return false; }
    if (tile === T.LOCKER) { this.msg('Your locker. Use the action beside it.', 'info'); return false; }
    if (lv.portals[k] && (tile === T.PORTAL || tile === T.STAIRS_UP || tile === T.STAIRS_DOWN)) return this._use_portal(nx, ny);
    if (!lv.walkable(nx, ny)) return false;
    const snare = lv.hazards[k];
    if (snare && snare.kind === 'snare' && !snare.hidden) {
      if (!p.sneaking) { this.msg('A snare lies there. Creep (sneak) to disarm it, or go around.', 'warn'); return false; }
      delete lv.hazards[k]; this.give_item({ id: 'scrap', qty: 1, dur: null });
      this.msg('You carefully disarm the snare and keep the scrap.', 'good'); this._spend(2); return true;
    }
    lv.move_actor(p, nx, ny);
    this._after_step(tile);
    raiders_notice_snares(this);
    return true;
  }

  // shove the nearest hostile within reach (or a given one)
  push(target = null) {
    if (!this._begin_action()) return false;
    if (!target) {
      const near = pushable(this);
      if (!near.length) { this.msg('There is nothing within reach to push.', 'info'); return false; }
      target = near[0];
    }
    const t = push(this, target) ? 1 : 0;
    this._spend(t);
    return t > 0;
  }

  forage() { return wild_forage(this); }
  gather() { return wild_gather(this); }
  adjacent_pet() {
    const p = this.player;
    for (const [dx, dy] of DIRS8) { const a = this.level.occ.get(this.level.idx(p.x + dx, p.y + dy)); if (a && a.kind === 'animal' && (a.pet || a.stray)) return a; }
    return null;
  }
  _bump_actor(target) {
    if (target.kind === 'animal' && (target.pet || target.stray)) {
      if (target.pet) {                                                    // a pet in the way: you swap places
        const p = this.player, lv = this.level, a_pos = [p.x, p.y], b_pos = [target.x, target.y];
        lv.occ.delete(lv.idx(a_pos[0], a_pos[1])); lv.occ.delete(lv.idx(b_pos[0], b_pos[1]));
        p.x = b_pos[0]; p.y = b_pos[1]; target.x = a_pos[0]; target.y = a_pos[1];
        lv.occ.set(lv.idx(p.x, p.y), p); lv.occ.set(lv.idx(target.x, target.y), target);
        this._spend(1);
        return true;
      }
      this.msg(`The ${target.species} watches you. Use TALK to offer it food.`, 'info');
      return false;
    }
    if (target.kind === 'human' && !target.hostile) {
      if (target.uid === this.companion_uid && (target.state === 'follow' || target.state === 'wait')) {      // your companion in the way (a forest path, a doorway): swap
        const p = this.player, lv = this.level, a = [p.x, p.y], b = [target.x, target.y];
        lv.occ.delete(lv.idx(a[0], a[1])); lv.occ.delete(lv.idx(b[0], b[1]));
        p.x = b[0]; p.y = b[1]; target.x = a[0]; target.y = a[1];
        lv.occ.set(lv.idx(p.x, p.y), p); lv.occ.set(lv.idx(target.x, target.y), target);
        this._spend(1);
        return true;
      }
      this.msg(`${target.name} is here. Use TALK.`, 'info'); return false;
    }
    if (target.hidden) raiders_spring(this, target, 'You stumble onto a hidden raider!');      // you walked into someone lying in wait
    const turns = player_attack(this, target) ? 1 : 0;
    this._spend(turns);
    return turns > 0;
  }

  // Marching wears you down: a step costs stamina, more at a run and in water, little when creeping. Resting and standing
  // still win it back faster than any of them spend it, so only a sustained march empties it.
  _tire(tile, sneaking, sprinting) {
    const p = this.player;
    let drain = sprinting ? SPRINT_DRAIN : sneaking ? SNEAK_DRAIN : WALK_DRAIN;
    if (tile === T.SHALLOW) drain *= 1.5;
    p.stamina = Math.max(0, p.stamina - drain);
    if (p.stamina <= 0 && (p.fatigue || 0) < 2) { p.fatigue = 2; this.msg('You are exhausted. You can barely put one foot in front of the other: rest.', 'bad'); }
    else if (p.stamina < TIRED_BELOW && (p.fatigue || 0) < 1) { p.fatigue = 1; this.msg('You are getting winded. Slow down, or find somewhere to rest.', 'warn'); }
    else if (p.stamina > 40) p.fatigue = 0;
  }

  _after_step(tile) {
    const p = this.player, lv = this.level, k = lv.idx(p.x, p.y);
    let noise = { [T.ROAD]: 3, [T.BRUSH]: 3, [T.SHALLOW]: 5 }[tile] || 2;
    if (p.sneaking) noise = tile === T.ROAD || tile === T.BRUSH ? 2 : tile === T.SHALLOW ? 3 : 1;      // careful, but never silent
    else if (p.sprinting && p.stamina > 5) noise += 4;
    if (p.armor) noise += this.item_def(p.armor.id).stealth;
    const surface = tile === T.SHALLOW ? 'water' : (tile === T.ROAD || tile === T.FLOOR) ? 'hard' : 'soft';
    sfx(this, 'step', null, { surface, quiet: p.sneaking, loud: p.sprinting && p.stamina > 5 });
    noise = Math.round(noise * this.era.rules.step_noise);          // soft ground vs hard floors
    noise = Math.max(0, noise + Math.trunc(p.mod('move_noise')));
    if (!p.sneaking) { noise += step_extra(this, tile); explain_step(this, tile); startle(this, tile); }     // gravel, glass, metal floors, the building you are in
    this.emit_noise([p.x, p.y], noise);
    wild_forest_note(this);
    if (!TILES[tile].masks_scent) this.scent[k] = this.clock.turn;
    let cost = 1;
    if (p.sneaking) cost = 2;
    else if (p.sprinting && p.stamina > 5) { this._step_parity ^= 1; cost = this._step_parity; }
    else p.sprinting = false;
    this._tire(tile, p.sneaking, p.sprinting);
    if (p.stamina <= 0) cost += 1;                                          // exhausted: you stagger at half speed
    else if (p.stamina < TIRED_BELOW) { this._tired_parity ^= 1; cost += this._tired_parity; }     // winded: every other step is a slog
    if (p.fracture) { this._step_parity ^= 1; cost += this._step_parity; }
    if (p.lost.includes('leg')) cost += p.lost.length >= 2 ? 2 : 1;        // one leg: half speed; no limbs to spare: a crawl
    const stack = lv.items[k];
    if (stack) this.msg(`You see here: ${stack.slice(0, 3).map((i) => this.item_def(i.id).name.toLowerCase()).join(', ')}. (PICK UP)`, 'info');
    if (lv.docs[k]) this.msg('A document lies here. (PICK UP)', 'info');
    if (lv.hazards[k] && lv.hazards[k].kind === 'spore' && !p.filter_turns) this.msg('The air is thick with spores!', 'warn');
    this._spend(cost);
  }

  try_unlock(pos) {
    const lv = this.level, p = this.player, poi = this.poi_of_level(lv);
    if (poi && poi.code_known) {
      lv.set_tile(pos[0], pos[1], T.DOOR_OPEN);
      this.msg('You key in the code you deciphered. The vault door opens.', 'good');
      this._spend(1);
      return true;
    }
    const carried = (p.weapon ? [p.weapon] : []).concat(p.inventory);
    const tools = carried.filter((i) => { const d = this.item_def(i.id); return d.kind === 'weapon' && ['blunt', 'blade', 'polearm'].includes(d.style); });
    if (!tools.length) { this.msg('The door is locked. Find its code, or something to force it with.', 'warn'); return false; }
    const key = `${lv.id}:${lv.idx(pos[0], pos[1])}`;
    const progress = (this._force_progress[key] || 0) + 1;
    this._force_progress[key] = progress;
    this.emit_noise([p.x, p.y], 14);
    this._spend(progress === 1 ? FORCE_TURNS : 2);
    if (this.over) return true;
    if (this.rng.random() < 0.35 + 0.15 * progress) {
      lv.set_tile(pos[0], pos[1], T.DOOR_OPEN);
      this.msg('The lock gives with a crack that carries through the whole building.', 'good');
    } else this.msg('You hammer at the lock. It holds. (try again)', 'info');
    return true;
  }

  wait(turns = 1) { if (this.over) return false; this._spend(turns); return true; }

  rest(max_turns = 20) {
    if (this.over) return 0;
    if (this.visible_hostiles().length) { this.msg('You cannot rest with enemies in sight.', 'warn'); return 0; }
    const p = this.player;
    if (this.live_started) { this.rest_left = max_turns; this._rest_hp = p.hp; return 1; }
    let rested = 0;
    for (let i = 0; i < max_turns; i++) {
      const hp0 = p.hp;
      this._spend(1); rested++;
      if (this.over || p.hp < hp0 || this.visible_hostiles().length || this.pending_event) break;
      if (p.hp < p.max_hp && !p.bleeding && this.clock.turn % 3 === 0) p.hp += 1;
      p.stamina = Math.min(p.max_stamina, p.stamina + 1.5);
      if (p.hp >= p.max_hp && p.stamina >= p.max_stamina && p.panic < 5) break;
    }
    return rested;
  }

  toggle_sneak() {
    const p = this.player;
    p.sneaking = !p.sneaking;
    if (p.sneaking) p.sprinting = false;
    this.msg(p.sneaking ? 'You creep.' : 'You stand up straight.', 'info');
  }
  toggle_sprint() {
    const p = this.player;
    if (p.lost.includes('leg')) { p.sprinting = false; this.msg('You cannot run on one leg.', 'warn'); return; }
    p.sprinting = !p.sprinting && p.stamina > 10;
    if (p.sprinting) p.sneaking = false;
    this.msg(p.sprinting ? 'You break into a run.' : 'You slow down.', 'info');
  }
  toggle_light() {
    const p = this.player;
    if (!p.light) { this.msg('You have no light.', 'warn'); return; }
    p.light_on = !p.light_on;
    this.msg(p.light_on ? 'You switch the light on.' : 'You douse the light.', 'info');
    this.update_fov();
  }

  // ------------------------------------------------------------- items
  pickup() { const t = pickup_here(this); this._spend(t); return t > 0; }
  use(index) { if (!this._begin_action()) return false; const t = use_item(this, index); this._spend(t); return t > 0; }
  equip(index) { const t = equip(this, index); this._spend(t); return t > 0; }
  unequip(slot) { const t = unequip(this, slot); this._spend(t); return t > 0; }
  drop(index) { const t = drop_item(this, index); this._spend(t); return t > 0; }
  craft(recipe_id) { const t = craft_item(this, recipe_id); this._spend(t); return t > 0; }

  targets_in_range() {
    const w = weapon_def(this);
    const reach = Math.max(1, (is_ranged(w) || w.reach > 1) ? w.reach : 1);
    const p = this.player;
    return this.visible_hostiles().filter((a) => cheb([a.x, a.y], [p.x, p.y]) <= reach)
      .sort((a, b) => cheb([a.x, a.y], [p.x, p.y]) - cheb([b.x, b.y], [p.x, p.y]));
  }
  fire(target) { if (!this._begin_action()) return false; const s = player_fire(this, target); this._spend(s ? 1 : 0); return s; }
  attack(target) { if (!this._begin_action()) return false; const s = player_attack(this, target); this._spend(s ? 1 : 0); return s; }
  throw_at(item_id, pos) { if (!this._begin_action()) return false; const s = throw_item(this, item_id, pos); this._spend(s ? 1 : 0); return s; }
  amputate() {
    const reason = can_amputate(this);
    if (reason) { this.msg(reason, 'warn'); return false; }
    amputate(this);
    this._spend(3);
    return true;
  }
  smear() {
    const p = this.player, lv = this.level, w = lv.w;
    const near = Object.keys(lv.corpses).some((k) => cheb([k % w, Math.floor(k / w)], [p.x, p.y]) <= 1);
    if (!near) { this.msg('You need a corpse within reach.', 'warn'); return false; }
    p.disguise_turns = 120;
    this.add_panic(8);
    this.msg('You smear yourself with gore. You reek of the dead.', 'info');
    this._spend(3);
    return true;
  }

  // ------------------------------------------------------------- documents
  collect_document(doc_id) {
    if (this.player.documents.includes(doc_id)) return;
    this.player.documents.push(doc_id);
    this.msg(`You find a document: ${this.docs[doc_id].title}.`, 'lore');
  }
  read_document(doc_id) {
    const doc = this.docs[doc_id];
    const learned = expose(doc, this.know, EXPOSURE_TO_LEARN - (this.player.mod('study_bonus') >= 0.3 ? 1 : 0));
    if (learned.length) this.msg(`The meaning of '${learned.join(', ')}' sinks in.`, 'good');
    this._apply_payload(doc);
    this._spend(2);
    return [render_document(doc, this.know), learned];
  }
  study_document(doc_id) {
    const doc = this.docs[doc_id];
    const words = 1 + (this.know.fluency >= 0.15 ? 1 : 0) + (this.know.fluency >= 0.3 ? 1 : 0);
    const learned = study(this.rng, doc, this.know, this.player.mod('study_bonus'), words);
    if (learned.length) { this.msg(`After long effort you work out: ${learned.join(', ')}.`, 'good'); this.player.gain_xp(3 * learned.length); }
    else if (doc.studies >= STUDY_LIMIT) this.msg('You have wrung everything you can out of this page for now.', 'info');
    else this.msg('The page will not give up its secrets. Try again.', 'info');
    this._apply_payload(doc);
    this._spend(5);
    return [render_document(doc, this.know), learned];
  }
  _apply_payload(doc) {
    if (this.applied_docs.has(doc.id) || !is_decoded(doc, this.know)) return;
    this.applied_docs.add(doc.id);
    this.player.gain_xp(10);
    if (doc.payload.reveal) { const poi = this.pois[doc.payload.reveal]; poi.revealed = true; poi.lead = true; this.msg(`Deciphered: ${poi.name} is now marked on your map.`, 'good'); }
    if (doc.payload.code) { const poi = this.pois[doc.payload.code]; poi.code_known = true; this.msg(`Deciphered: you now know the vault code for ${poi.name}.`, 'good'); }
    if (doc.payload.recipe && !this.player.recipes.includes(doc.payload.recipe)) { this.player.recipes.push(doc.payload.recipe); this.msg(`Deciphered: you now know how to make the ${doc.payload.name.toLowerCase()}.`, 'good'); }
    if (doc.payload.formula) { this.formula_found = true; this.msg('Deciphered: you now hold the formula.', 'good'); }
  }

  // ------------------------------------------------------------- havens
  adjacent_npc() {
    const p = this.player;
    for (const [dx, dy] of DIRS8) {
      const a = this.level.occ.get(this.level.idx(p.x + dx, p.y + dy));
      if (a && a.kind === 'human' && !a.hostile) return a;
    }
    return null;
  }
  adjacent_tile(tile) {
    const p = this.player, lv = this.level;
    for (const [dx, dy] of DIRS8) if (lv.tile(p.x + dx, p.y + dy) === tile) return [p.x + dx, p.y + dy];
    return null;
  }
  // Context action. Returns 'npc' or 'bed' when the UI must open a menu, else ''.
  interact() {
    if (this.adjacent_npc()) return 'npc';
    if (this.adjacent_pet()) return 'pet';
    if (this.adjacent_tile(T.BED)) return 'bed';
    if (this.adjacent_tile(T.LOCKER)) return 'locker';
    if (this.adjacent_tile(T.BENCH)) { this.use_bench(true); return ''; }
    const crate = this.adjacent_tile(T.CRATE);
    if (crate) { this._spend(search_container(this, crate)); return ''; }
    const lock = this.adjacent_tile(T.LOCKED);
    if (lock) { this.try_unlock(lock); return ''; }
    this.msg('Nothing to interact with.', 'info');
    return '';
  }
  sleep() {
    const lv = this.level, p = this.player;
    if (!lv.safe) { this.msg('It is not safe to sleep here.', 'warn'); return 0; }
    const turns = Math.min(80, this.clock.until_hour(6.0));
    if (this.live_started) { this.busy += turns; this.sleep_left = turns; this.rest_left = 0; this.msg('You lie down and sleep.', 'info'); return turns; }
    let slept = turns;
    if (in_base(this)) {                                // a raid or a wound wakes you
      slept = 0;
      for (let i = 0; i < turns; i++) {
        const hp0 = p.hp; this._spend(1); slept++;
        if (this.over || p.hp < hp0 || hostiles_in(lv).length || this.pending_event) break;
      }
      if (!this.over && slept < turns) this.msg('You wake with a start.', 'warn');
    } else this._spend(turns);
    if (!this.over) {
      const share = in_base(this) ? Math.min(1.0, slept / 60) : 1.0;
      p.hp = Math.min(p.max_hp, p.hp + Math.floor(p.max_hp * 0.6 * share));
      p.stamina = p.max_stamina; p.panic = 0;
      this.msg(`You sleep for ${Math.floor(slept / 10)} hours.`, 'info');
      if (p.infected) this.msg('You wake in a sweat. The fever has not broken.', 'warn');
    }
    return slept;
  }

  requirements() {
    const sc = this.scenario, p = this.player, out = [];
    for (const req of sc.requirements) {
      const have = p.count(req.id) > 0;
      const poi = Object.values(this.pois).find((q) => q.component === req.id);
      const hint = have ? 'in your pack' : (poi && poi.lead ? `lead: ${poi.name}` : 'location unknown');
      out.push([this.item_def(req.id).name, have, hint]);
    }
    if (sc.needs_formula) {
      const ok = this.formula_found && this.know.fluency >= sc.formula_fluency;
      let hint;
      if (ok) hint = 'ready';
      else if (this.formula_found) hint = `need ${Math.floor(sc.formula_fluency * 100)}% fluency (you have ${Math.floor(this.know.fluency * 100)}%)`;
      else hint = 'not found';
      out.push(['The formula', ok, hint]);
    }
    return out;
  }
  requirements_met() { return this.requirements().every((r) => r[1]); }

  _siege_doors(lv) {
    const out = [];
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
      const t = lv.tile(x, y);
      if ((t === T.DOOR || t === T.DOOR_OPEN) && (x === 1 || x === lv.w - 2 || y === 1)) out.push([x, y]);
    }
    return out;
  }
  _door_name(lv, d) { return d[0] <= 1 ? 'west' : d[0] >= lv.w - 2 ? 'east' : 'north'; }
  _door_inside(lv, d) { return [d[0] + (d[0] <= 1 ? 1 : d[0] >= lv.w - 2 ? -1 : 0), d[1] + (d[1] <= 1 ? 1 : 0)]; }

  use_bench(ask = false) {
    const lv = this.level, site = this.pois[this.final_site_id];
    if (lv.poi_id !== site.id) { this.msg('It is idle. This is not where you need to be.', 'info'); return false; }
    if (this.final) { this.msg('You are already working. Hold out!', 'warn'); return false; }
    if (!this.requirements_met()) {
      const missing = this.requirements().filter((r) => !r[1]).map((r) => `${r[0]} (${r[2]})`);
      this.msg('You are not ready: ' + missing.join('; ') + '.', 'warn');
      return false;
    }
    const sc = this.scenario, doors = this._siege_doors(lv);
    const weak = doors.filter((d) => lv.tile(d[0], d[1]) !== T.DOOR || (lv.door_hp[lv.idx(d[0], d[1])] === undefined ? DOOR_HP : lv.door_hp[lv.idx(d[0], d[1])]) < 30);
    if (ask && weak.length && !this.siege_warned) {
      this.siege_warned = true;
      this.msg(`Once you start there is no taking it back. The ${weak.map((d) => this._door_name(lv, d)).join(', ')} door${weak.length > 1 ? 's are' : ' is'} not barricaded: each wave will break through there. Barricade them, set traps, stock fire, then use it again to ${sc.final_verb}.`, 'warn');
      return false;
    }
    this.final = { turns_left: sc.final_turns, next_wave: 4, boss_done: false, total: sc.final_turns, doors, pending: {}, exit: null, exit_name: '' };
    lv.safe = false;
    this.msg(`You begin to ${sc.final_verb}. The noise carries. Hold out for ${sc.final_turns} turns!`, 'bad', true);
    this.emit_noise([this.player.x, this.player.y], 30);
    this.add_heat(30, true);
    this._spend(1);
    return true;
  }

  _final_tick() {
    const f = this.final, lv = this.level, p = this.player;
    if (lv.poi_id !== this.final_site_id) return;
    if (f.exit) {                                                         // the break-out: reach the door you were given
      if (p.x === f.exit[0] && p.y === f.exit[1]) { this._escape(); return; }
      if (this.clock.turn % 12 === 0) this._exit_hint();
    } else {
      f.turns_left -= 1;
      if (f.turns_left <= 0) this._start_breakout(f);
    }
    f.next_wave -= 1;
    if (f.next_wave <= 0) {
      const progress = 1.0 - Math.max(0, f.turns_left) / Math.max(1, f.total);
      f.next_wave = Math.max(3, 7 - Math.floor(progress * 4));       // the waves come faster as it goes on
      const n = 2 + Math.floor(p.level / 4) + (this.diff.zombies > 1 ? 1 : 0) + Math.floor(progress * 3);
      const pts = [null].concat(f.doors);
      this._siege_wave(f, pts[this.rng.randint(0, pts.length - 1)], n);
    }
    if (!f.boss_done && f.turns_left <= Math.floor(this.scenario.final_turns / 2)) {
      f.boss_done = true;
      if (p.humanity < 40) {
        this.msg("People step out of the dark with weapons. 'We have heard about you.'", 'bad', true);
        const crew = [];
        for (let i = 0; i < 3; i++) {
          const spot = lv.free_spot_near(lv.entry[0], lv.entry[1], 4);
          if (spot && cheb(spot, [p.x, p.y]) > 2) { const r = make_raider(this, spot[0], spot[1]); r.state = 'hunt'; lv.add_actor(r); crew.push(r); }
        }
        raiders_squad_up(this, crew);
      } else {
        const spot = lv.free_spot_near(lv.entry[0], lv.entry[1], 4);
        if (spot) {
          const z = spawn_zombie(this, lv, spot, 'alpha', false, true);
          z.state = 'hunt'; z.target = [p.x, p.y]; z.stimulus_turn = this.clock.turn;
          this.msg('Something enormous pushes through the dead. The Alpha has come for you.', 'bad', true);
        }
      }
    }
  }

  _breakout_exits(f) {
    const lv = this.level, out = f.doors.map((d) => [d, this._door_name(lv, d) + ' door']);
    for (const k of Object.keys(lv.portals)) if (lv.portals[k].target === 'world') out.push([[Number(k) % lv.w, Math.floor(Number(k) / lv.w)], 'main entrance']);
    return out;
  }
  // The work is done, and now the room has to be left: through one door, picked at random, with the dead in the way.
  _start_breakout(f) {
    const lv = this.level, p = this.player, options = this._breakout_exits(f);
    const far = options.filter((o) => cheb(o[0], [p.x, p.y]) >= 8), pick = this.rng.choice(far.length ? far : options);
    f.exit = pick[0]; f.exit_name = pick[1]; f.turns_left = 0; f.next_wave = 1;
    const inside = f.exit_name === 'main entrance' ? lv.entry : this._door_inside(lv, f.exit);
    this._siege_spawn(inside, 3 + Math.floor(p.level / 4) + (this.diff.zombies > 1 ? 1 : 0), 3);
    this.msg(`It is done. Now get out: the ${f.exit_name} is the only way, and the dead are already crowding it.`, 'bad', true);
    this._exit_hint();
  }
  _exit_hint() {
    const f = this.final, p = this.player;
    if (!f || !f.exit) return;
    this.msg(`Get out through the ${f.exit_name}: ${compass(f.exit[0] - p.x, f.exit[1] - p.y)}, ${dist_words(this.era.id, cheb(f.exit, [p.x, p.y]))}.`, 'obj');
  }
  _escape() { this.escape_via = this.final ? this.final.exit_name : ''; this.final = null; this.msg('You throw yourself through the door and into the open air.', 'good', true); this.end('won'); }

  _siege_spawn(near, n, radius = 2) {
    const lv = this.level, p = this.player;
    for (let i = 0; i < n; i++) {
      const spot = lv.free_spot_near(near[0] + this.rng.randint(-1, 1), near[1], radius + Math.floor(n / 5));
      if (spot && cheb(spot, [p.x, p.y]) > 1) {
        const z = spawn_zombie(this, lv, spot, null, false, true);
        z.state = 'hunt'; z.target = [p.x, p.y]; z.stimulus_turn = this.clock.turn;
      }
    }
  }

  // a wave arrives at the main entrance or a side door; closed doors hold it back until they break
  _siege_wave(f, door, n) {
    const lv = this.level;
    if (!door) { this._siege_spawn(lv.entry, n, 3); this.msg('The dead are pouring in through the entrance!', 'warn'); return; }
    const name = this._door_name(lv, door), k = lv.idx(door[0], door[1]), key = `${door[0]},${door[1]}`;
    if (lv.tile(door[0], door[1]) === T.DOOR_OPEN) { this._siege_spawn(this._door_inside(lv, door), n); this.msg(`More of them come through the broken ${name} door!`, 'warn'); return; }
    f.pending[key] = (f.pending[key] || 0) + n;
    const hp = (lv.door_hp[k] === undefined ? DOOR_HP : lv.door_hp[k]) - 5 * n;
    if (hp > 0) {
      lv.door_hp[k] = hp;
      this.msg(`Something is battering the ${name} door. It will not hold forever (${hp} left).`, 'warn');
      this.emit_noise(door, 6, 'zombie');
      return;
    }
    delete lv.door_hp[k];
    lv.set_tile(door[0], door[1], T.DOOR_OPEN);
    const waiting = f.pending[key] || n; delete f.pending[key];
    this._siege_spawn(this._door_inside(lv, door), waiting);
    this.msg(`The ${name} door gives way!`, 'bad');
  }

  learn_perk(perk_id) { const ok = this.player.learn_perk(perk_id); if (ok) this.msg('You learn a new skill.', 'good'); return ok; }

  objectives() {
    const sc = this.scenario;
    const out = this.requirements().map(([n, done, h]) => [`${n}: ${h}`, done]);
    const site = this.pois[this.final_site_id];
    out.push([`${cap(sc.final_verb)} at ${site.revealed ? site.name : 'location unknown'}`, false]);
    const errand = comp_personal_objective(this);
    if (errand) out.push(errand);
    return out;
  }

  describe_at(x, y) {
    const lv = this.level;
    if (!lv.in_bounds(x, y)) return '';
    if (!this.is_visible(x, y) && !lv.seen[lv.idx(x, y)]) return 'unexplored';
    const parts = [TILES[lv.tile(x, y)].name];
    const a = lv.occ.get(lv.idx(x, y));
    if (a && this.is_visible(x, y)) parts.unshift(a.kind === 'player' ? 'you' : a.name.toLowerCase() + (a.title ? ` - ${a.title}` : '') + (a.kind === 'zombie' ? ` (${awareness_of(a)})` : ''));
    if (this.is_visible(x, y) && lv.items[lv.idx(x, y)]) parts.push('items');
    return parts.join(', ');
  }

  // Path for tap-to-travel: through tiles you have seen, avoiding anything standing in the way.
  travel_path(x, y) {
    const lv = this.level, p = this.player;
    if (!lv.in_bounds(x, y) || (x === p.x && y === p.y)) return null;
    const allow = (nx, ny) => {
      const k = lv.idx(nx, ny);
      if (!lv.seen[k] && !this.visible.has(k)) return false;
      const t = lv.tiles[k];
      if (t === T.LOCKED || t === T.CRATE || t === T.CRATE_OPEN || t === T.BED || t === T.BENCH || t === T.WORKSHOP || t === T.LOCKER) return false;
      const occ = lv.occ.get(k);
      if (occ && occ !== p && !(nx === x && ny === y)) return false;
      const hz = lv.hazards[k];
      if (hz && hz.kind === 'fire') return false;
      return true;
    };
    return player_path(lv, [p.x, p.y], [x, y], allow);
  }
}

function make_game(cfg = {}) { return new Game(cfg); }
