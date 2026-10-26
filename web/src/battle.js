// ---------------------------------------------------------------- battle: a WEGO squad battle against the dead (web only)
// Every turn has two phases. In the plan phase the player gives each squad its orders (a path, fire at will or hold
// fire, walk or run, one special action); nothing moves. In the resolve phase the orders are locked and the battle is
// simulated for TURN_TICKS fixed ticks while the player watches. The simulation is a pure function of the state and the
// orders: the state is plain JSON (the random stream included), so a saved battle continues exactly as it would have.
// The dead come from the zombie preset (speed, senses, infection, how you kill them, what they do by day), the squads
// and their weapons from the era.

const BT = { W: 24, H: 32, DT: 0.1, TURN_TICKS: 100, MAX_ZEDS: 260, SAVE_KEY: 'outbreak.battle.v1', WALK: 1.2, RUN: 2.0 };
const BTILE = { GRASS: 0, ROAD: 1, FLOOR: 2, WALL: 3, TREE: 4, BRUSH: 5, RUBBLE: 6, FENCE: 7, WATER: 8, DOOR: 9 };

// Squad archetypes; the era renames them and swaps their weapons (BT_ERAS).
const BT_TYPES = {
  line: { men: 6, hp: 20, morale: 60, armor: 1, melee: [2, 5], speed: 1, sight: 0, range: 9, rate: 1.1, acc: 0.55, dmg: [9, 14], noise: 9, ammo: 150, aoe: 0, setup: 0, ability: null },
  shield: { men: 6, hp: 26, morale: 75, armor: 0.5, melee: [5, 9], speed: 1, sight: 0, range: 4.5, rate: 1.6, acc: 0.7, dmg: [10, 16], noise: 9, ammo: 60, aoe: 0, setup: 0, ability: 'barricade' },
  heavy: { men: 4, hp: 20, morale: 55, armor: 1, melee: [2, 4], speed: 0.9, sight: 0, range: 10, rate: 0.22, acc: 0.35, dmg: [8, 12], noise: 14, ammo: 400, aoe: 0, setup: 1.5, ability: null },
  scout: { men: 4, hp: 18, morale: 50, armor: 1, melee: [3, 6], speed: 1.3, sight: 3, range: 8, rate: 1.3, acc: 0.6, dmg: [9, 13], noise: 3, ammo: 60, aoe: 0, setup: 0, ability: 'lure' },
};

const BT_ERAS = {
  medieval: {
    names: { line: 'Longbowmen', shield: 'Men-at-arms', heavy: 'Fire-throwers', scout: 'Outriders' },
    weapons: { line: 'longbows', shield: 'spears and shields', heavy: 'pots of Greek fire', scout: 'hunting bows' },
    over: { line: { noise: 2, rate: 1.6, range: 10, ammo: 120 }, shield: { range: 0, ammo: 0, melee: [6, 11], armor: 0.45 },
            heavy: { range: 7, rate: 2.8, acc: 0.6, dmg: [7, 12], aoe: 1.3, noise: 5, ammo: 30, setup: 1 }, scout: { noise: 2, speed: 1.5, ammo: 50, dmg: [7, 12] } },
    lure: 'a hand bell', barricade: 'a wall of carts and stakes', survivors: 'villagers', refuge: 'the abbey', medieval: true,
  },
  eighties: {
    names: { line: 'Guardsmen', shield: 'Riot police', heavy: 'M60 team', scout: 'Rangers' },
    weapons: { line: 'M16 rifles', shield: 'shields and shotguns', heavy: 'an M60 machine gun', scout: 'suppressed carbines' },
    over: { line: { noise: 10 } },
    lure: 'road flares', barricade: 'a car-and-sandbag barricade', survivors: 'civilians', refuge: 'the fort',
  },
  modern: {
    names: { line: 'Riflemen', shield: 'Riot squad', heavy: 'MG team', scout: 'Recon' },
    weapons: { line: 'carbines', shield: 'shields and shotguns', heavy: 'a belt-fed machine gun', scout: 'suppressed rifles' },
    over: {},
    lure: 'a noisemaker', barricade: 'concrete barriers', survivors: 'civilians', refuge: 'the shelter',
  },
  scifi: {
    names: { line: 'Marines', shield: 'Breach team', heavy: 'Plasma gunners', scout: 'Pathfinders' },
    weapons: { line: 'pulse rifles', shield: 'shock mauls and arc pistols', heavy: 'a plasma cannon', scout: 'needle rifles' },
    over: { line: { dmg: [11, 16], noise: 6 }, shield: { range: 4, noise: 4 }, heavy: { rate: 0.9, acc: 0.5, dmg: [10, 15], aoe: 0.9, noise: 10, ammo: 90, setup: 1 }, scout: { sight: 5, noise: 1 } },
    lure: 'a decoy beacon', barricade: 'a deployable shield wall', survivors: 'colonists', refuge: 'the dome',
  },
};
const BT_CALLSIGNS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
// The company is bought from a budget: what a squad costs is what it is worth on the field.
const BT_ARMY = { budget: 13, max: 5, cost: { line: 3, shield: 3, heavy: 4, scout: 2 } };
const bt_forces_cost = (types) => types.reduce((a, t) => a + (BT_ARMY.cost[t] || 0), 0);
// Why a company cannot take the field, or null when it can.
function bt_forces_error(types) {
  if (!Array.isArray(types) || !types.length) return 'The company needs at least one squad.';
  if (types.length > BT_ARMY.max) return `At most ${BT_ARMY.max} squads.`;
  if (types.some((t) => !BT_TYPES[t])) return 'Unknown squad type.';
  if (bt_forces_cost(types) > BT_ARMY.budget) return `Over budget: ${bt_forces_cost(types)} of ${BT_ARMY.budget} points.`;
  return null;
}
// How many of the dead each preset sends, on top of its horde size: fragile or fast presets need more bodies to threaten a line.
const BT_PRESET_SCALE = { classic: 1.35, rage: 1.7, swarm: 0.8 };

const BT_OBJECTIVES = {
  hold: { name: 'Hold the refuge', turns: 10, hour0: 18, minutes: 15, forces: ['line', 'shield', 'line', 'heavy'],
          blurb: 'People are sheltering inside. Keep the dead out of it until the night is over: ten turns, from dusk into the dark. Squads inside at the end of a turn restock their ammunition.' },
  rescue: { name: 'Bring them out', turns: 10, hour0: 4.5, minutes: 15, forces: ['line', 'shield', 'scout', 'line'],
            blurb: 'Survivors are trapped in a house to the north. Reach them, and they follow the squad that found them. Bring at least half of them to the south edge before ten turns are up.' },
};

function bt_type_stats(era_id, type) {
  const e = BT_ERAS[era_id] || BT_ERAS.modern;
  return Object.assign({}, BT_TYPES[type], e.over[type] || {});
}

// ---------------------------------------------------------------- random stream kept in the state (mulberry32, like RNG)
function bt_rand(b) {
  b.rng = (b.rng + 0x6D2B79F5) >>> 0;
  let t = b.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const bt_int = (b, lo, hi) => lo + Math.floor(bt_rand(b) * (hi - lo + 1));
const bt_pick = (b, arr) => arr[Math.floor(bt_rand(b) * arr.length)];

// Transient caches (flow fields) live off the JSON: a non-enumerable property is never saved.
function bt_cache(b) {
  if (!b._c) Object.defineProperty(b, '_c', { value: { fields: new Map(), hfields: new Map() }, enumerable: false, writable: true });
  return b._c;
}
function bt_invalidate(b) { const c = bt_cache(b); c.fields.clear(); c.hfields.clear(); }

// ---------------------------------------------------------------- terrain
const bt_idx = (b, x, y) => y * b.w + x;
const bt_in = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
function bt_tile(b, x, y) { return bt_in(b, x, y) ? b.tiles[y * b.w + x] : BTILE.WALL; }
const bt_blocks_sight = (t) => t === BTILE.WALL || t === BTILE.TREE;
const bt_indoor = (t) => t === BTILE.FLOOR || t === BTILE.DOOR;
function bt_has_barricade(b, k) { return b.barricades[k] !== undefined; }

// Movement cost of a tile for the living ('h') or the dead ('z'); Infinity = cannot enter.
function bt_cost(b, k, who) {
  const t = b.tiles[k];
  if (t === BTILE.WALL || t === BTILE.TREE || t === BTILE.WATER) return Infinity;
  if (bt_has_barricade(b, k)) return who === 'z' ? 14 : Infinity;
  if (t === BTILE.FENCE) return who === 'h' ? 3 : (b.swarm ? 2.5 : Infinity);
  if (t === BTILE.BRUSH || t === BTILE.RUBBLE) return 1.6;
  return 1;
}
function bt_speed_factor(b, x, y, who) {
  const k = bt_idx(b, Math.floor(x), Math.floor(y));
  if (!bt_in(b, Math.floor(x), Math.floor(y))) return 1;
  const c = bt_cost(b, k, who);
  return c === Infinity ? 1 : c >= 14 ? 1 : 1 / c;
}
function bt_passable(b, x, y, who) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!bt_in(b, tx, ty)) return false;
  const k = bt_idx(b, tx, ty);
  if (bt_has_barricade(b, k)) return false;
  return bt_cost(b, k, who) !== Infinity;
}

// Line of sight between two tile centres: walls and tree trunks block it, barricades and fences do not.
function bt_los(b, ax, ay, bx, by) {
  const a = [Math.floor(ax), Math.floor(ay)], c = [Math.floor(bx), Math.floor(by)];
  const pts = line(a, c);
  for (let i = 0; i < pts.length - 1; i++) if (bt_blocks_sight(bt_tile(b, pts[i][0], pts[i][1]))) return false;
  return true;
}

// ---------------------------------------------------------------- flow fields (Dijkstra over tiles, 8 directions, no corner cutting)
function bt_dijkstra(b, goals, who) {
  const n = b.w * b.h, d = new Float32Array(n).fill(Infinity);
  const heap = [];
  const push = (k, v) => { heap.push([v, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  for (const k of goals) { d[k] = 0; push(k, 0); }
  while (heap.length) {
    const [v, k] = pop();
    if (v > d[k]) continue;
    const x = k % b.w, y = (k - x) / b.w;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!bt_in(b, nx, ny)) continue;
      const nk = ny * b.w + nx;
      const c = bt_cost(b, nk, who);
      if (c === Infinity) continue;
      if (dx && dy && (bt_cost(b, y * b.w + nx, who) === Infinity || bt_cost(b, ny * b.w + x, who) === Infinity)) continue;
      const nv = v + c * (dx && dy ? 1.414 : 1);
      if (nv < d[nk]) { d[nk] = nv; push(nk, d[nk]); }            // push the stored float32, or the pop check skips it
    }
  }
  return d;
}
function bt_zfield(b, key, goals) {
  const c = bt_cache(b);
  let f = c.fields.get(key);
  if (!f) { f = bt_dijkstra(b, goals, 'z'); c.fields.set(key, f); }
  return f;
}
function bt_hfield(b, key, goals) {
  const c = bt_cache(b);
  let f = c.hfields.get(key);
  if (!f) { f = bt_dijkstra(b, goals, 'h'); c.hfields.set(key, f); }
  return f;
}
// The next tile to step to from (x, y) down a field; null when already at the bottom or cut off.
function bt_descend(b, f, x, y, who) {
  const tx = Math.floor(x), ty = Math.floor(y), here = f[bt_idx(b, tx, ty)];
  let best = null, bv = here;
  for (const [dx, dy] of DIRS8) {
    const nx = tx + dx, ny = ty + dy;
    if (!bt_in(b, nx, ny)) continue;
    if (dx && dy && (bt_cost(b, bt_idx(b, nx, ty), who) === Infinity || bt_cost(b, bt_idx(b, tx, ny), who) === Infinity)) continue;
    const v = f[bt_idx(b, nx, ny)];
    if (v < bv) { bv = v; best = [nx, ny]; }
  }
  return best;
}

// ---------------------------------------------------------------- the battlefield
function bt_rect(b, x0, y0, x1, y1, t) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (bt_in(b, x, y)) b.tiles[bt_idx(b, x, y)] = t; }
function bt_building(b, x0, y0, x1, y1, doors) {
  bt_rect(b, x0, y0, x1, y1, BTILE.WALL);
  bt_rect(b, x0 + 1, y0 + 1, x1 - 1, y1 - 1, BTILE.FLOOR);
  for (const [x, y] of doors) b.tiles[bt_idx(b, x, y)] = BTILE.DOOR;
}
function bt_free(b, x0, y0, x1, y1) {
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    if (!bt_in(b, x, y)) return false;
    const t = b.tiles[bt_idx(b, x, y)];
    if (t !== BTILE.GRASS && t !== BTILE.BRUSH) return false;
  }
  return true;
}
function bt_reserved(b, x, y) { return b.keep.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1); }

function bt_generate(b) {
  const W = b.w, H = b.h;
  b.tiles = new Array(W * H).fill(BTILE.GRASS);
  b.buildings = [];
  b.keep = [];
  // a north-south road and a cross street
  const rx = bt_int(b, 9, 12);
  bt_rect(b, rx, 0, rx + 1, H - 1, BTILE.ROAD);
  const ry = bt_int(b, 11, 15);
  bt_rect(b, 0, ry, W - 1, ry, BTILE.ROAD);
  if (b.objective === 'hold') {
    const x0 = rx - 3, x1 = rx + 4, y0 = H - 8, y1 = H - 2;
    bt_building(b, x0, y0, x1, y1, [[rx, y0], [rx + 1, y0], [x0, y0 + 3], [x1, y0 + 3]]);
    b.refuge = { x0: x0 + 1, y0: y0 + 1, x1: x1 - 1, y1: y1 - 1, integrity: 100 };
    b.buildings.push([x0, y0, x1, y1]);
    b.keep.push([x0 - 3, y0 - 5, x1 + 3, H - 1]);
  } else {
    b.extract_y = H - 2;
    b.keep.push([0, H - 6, W - 1, H - 1]);
    const hx = bt_int(b, 3, W - 9), hy = bt_int(b, 3, 6), x1 = hx + 5, y1 = hy + 4;
    const door = bt_int(b, hx + 1, x1 - 1);
    bt_building(b, hx, hy, x1, y1, [[door, y1]]);
    b.house = { x0: hx + 1, y0: hy + 1, x1: x1 - 1, y1: y1 - 1, door: [door, y1] };
    b.buildings.push([hx, hy, x1, y1]);
    b.keep.push([hx - 1, hy - 1, x1 + 1, y1 + 2]);
  }
  // other buildings: each with one or two doors
  for (let tries = 0; tries < 140 && b.buildings.length < 7; tries++) {
    const bw = bt_int(b, 4, 7), bh = bt_int(b, 4, 6), x0 = bt_int(b, 0, W - bw), y0 = bt_int(b, 1, H - bh - 2);
    const x1 = x0 + bw - 1, y1 = y0 + bh - 1;
    if (!bt_free(b, x0, y0, x1, y1)) continue;
    let clash = false;
    for (let y = y0 - 1; y <= y1 + 1 && !clash; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (bt_reserved(b, x, y)) { clash = true; break; }
    if (clash) continue;
    const sides = [[bt_int(b, x0 + 1, x1 - 1), y0], [bt_int(b, x0 + 1, x1 - 1), y1], [x0, bt_int(b, y0 + 1, y1 - 1)], [x1, bt_int(b, y0 + 1, y1 - 1)]];
    const doors = [sides.splice(bt_int(b, 0, 3), 1)[0]];
    if (bt_rand(b) < 0.5) doors.push(sides[bt_int(b, 0, 2)]);
    const inner = doors.filter((d) => d[0] > 0 && d[0] < W - 1 && d[1] > 0 && d[1] < H - 1);     // a door on the map edge leads nowhere
    bt_building(b, x0, y0, x1, y1, inner.length ? inner : [[bt_int(b, x0 + 1, x1 - 1), y1]]);
    b.buildings.push([x0, y0, x1, y1]);
  }
  const scatter = (t, n, len) => {
    for (let i = 0; i < n; i++) {
      let x = bt_int(b, 0, W - 1), y = bt_int(b, 0, H - 1);
      for (let j = 0; j < len; j++) {
        if (bt_in(b, x, y) && b.tiles[bt_idx(b, x, y)] === BTILE.GRASS && !bt_reserved(b, x, y)) b.tiles[bt_idx(b, x, y)] = t;
        const d = DIRS4[bt_int(b, 0, 3)]; x += d[0]; y += d[1];
      }
    }
  };
  scatter(BTILE.TREE, 9, 3);
  scatter(BTILE.BRUSH, 10, 5);
  scatter(BTILE.RUBBLE, 8, 2);
  // fence lines: straight runs across fields, never closed pens
  for (let i = 0; i < 4; i++) {
    const horiz = bt_rand(b) < 0.5, len = bt_int(b, 4, 8);
    let x = bt_int(b, 0, W - 1), y = bt_int(b, 2, H - 9);
    for (let j = 0; j < len; j++) {
      if (bt_in(b, x, y) && b.tiles[bt_idx(b, x, y)] === BTILE.GRASS && !bt_reserved(b, x, y)) b.tiles[bt_idx(b, x, y)] = BTILE.FENCE;
      if (horiz) x++; else y++;
    }
  }
  if (bt_rand(b) < 0.6) {                                              // a pond
    const px = bt_int(b, 1, W - 4), py = bt_int(b, 3, H - 12);
    for (let y = py; y < py + 2; y++) for (let x = px; x < px + 3; x++) if (b.tiles[bt_idx(b, x, y)] === BTILE.GRASS && !bt_reserved(b, x, y)) b.tiles[bt_idx(b, x, y)] = BTILE.WATER;
  }
  bt_fix_connectivity(b);
}

// Anything the dead could not reach from the north edge (an island cut off by trees and water) is cleared.
function bt_fix_connectivity(b) {
  for (let pass = 0; pass < 6; pass++) {
    const goals = [];
    for (let x = 0; x < b.w; x++) if (bt_cost(b, x, 'z') !== Infinity) goals.push(x);
    const f = bt_dijkstra(b, goals, 'z');
    let fixed = false;
    for (let k = 0; k < f.length; k++) {
      const t = b.tiles[k];
      if (f[k] !== Infinity || t === BTILE.WALL || t === BTILE.WATER || t === BTILE.TREE || t === BTILE.FENCE) continue;
      // unreachable open ground: open the nearest blocking neighbour toward the north
      const x = k % b.w, y = (k - x) / b.w;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (!bt_in(b, nx, ny)) continue;
        const nt = b.tiles[bt_idx(b, nx, ny)];
        if (nt === BTILE.TREE || nt === BTILE.WATER || nt === BTILE.FENCE) { b.tiles[bt_idx(b, nx, ny)] = BTILE.GRASS; fixed = true; break; }
        if (nt === BTILE.WALL && !(b.refuge && nx >= b.refuge.x0 - 1 && nx <= b.refuge.x1 + 1 && ny >= b.refuge.y0 - 1 && ny <= b.refuge.y1 + 1)) { b.tiles[bt_idx(b, nx, ny)] = BTILE.DOOR; fixed = true; break; }
      }
    }
    if (!fixed) return;
  }
}

// ---------------------------------------------------------------- a new battle
function bt_new(cfg) {
  cfg = Object.assign({ era: 'modern', zombies: 'classic', objective: 'hold', difficulty: 'normal', seed: null }, cfg || {});
  if (!CONTENT.eras[cfg.era]) throw new Error('unknown era ' + cfg.era);
  if (!CONTENT.presets[cfg.zombies]) throw new Error('unknown zombies ' + cfg.zombies);
  if (!BT_OBJECTIVES[cfg.objective]) throw new Error('unknown objective ' + cfg.objective);
  if (!CONTENT.difficulties[cfg.difficulty]) throw new Error('unknown difficulty ' + cfg.difficulty);
  if (cfg.forces) { const err = bt_forces_error(cfg.forces); if (err) throw new Error(err); cfg.forces = cfg.forces.slice(); }
  const seed = cfg.seed !== null && cfg.seed !== undefined ? cfg.seed >>> 0 : Math.floor(Math.random() * 1073741824);
  const obj = BT_OBJECTIVES[cfg.objective], prof = CONTENT.presets[cfg.zombies];
  const b = {
    v: 1, cfg: Object.assign({}, cfg, { seed }), seed, rng: (seed ^ 0xBA77E) >>> 0 || 1, era: cfg.era, preset: cfg.zombies, objective: cfg.objective,
    w: BT.W, h: BT.H, turn: 1, turns: obj.turns, t: 0, phase: 'plan', uid: 1, swarm: !!prof.swarm,
    squads: [], men: [], zeds: [], civs: [], corpses: [], noises: [], lures: [], barricades: {}, barricades_left: 4,
    pending: [], wave: null, kills: 0, lost: 0, turned: 0, saved: 0, civ_lost: 0, civ_total: 0, report: [], over: null, refuge: null, house: null, extract_y: null,
  };
  bt_generate(b);
  if (b.house) b.barricades[bt_idx(b, b.house.door[0], b.house.door[1])] = 160;     // the survivors have nailed their door shut
  bt_deploy(b);
  bt_seed_dead(b);
  bt_plan_wave(b);
  b.report = [bt_opening_line(b)];
  return b;
}

function bt_opening_line(b) {
  const obj = BT_OBJECTIVES[b.objective], prof = CONTENT.presets[b.preset];
  return `${obj.name}. ${prof.blurb}`;
}

function bt_deploy(b) {
  const types = b.cfg.forces || BT_OBJECTIVES[b.objective].forces, era = BT_ERAS[b.era] || BT_ERAS.modern;
  const names = CONTENT.companions.names.slice();
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(bt_rand(b) * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  let ni = 0;
  const spots = [];
  if (b.objective === 'hold') {
    const r = b.refuge, cx = (r.x0 + r.x1 + 1) / 2;
    spots.push([cx - 4, r.y0 - 3], [cx, r.y0 + 1.5], [cx + 4, r.y0 - 3], [cx, r.y0 - 2], [cx - 1.5, r.y0 + 3.5]);
  } else {
    for (let i = 0; i < types.length; i++) spots.push([types.length > 1 ? 4 + i * (b.w - 8) / (types.length - 1) : b.w / 2, b.h - 3.5]);
  }
  types.forEach((type, i) => {
    const st = bt_type_stats(b.era, type);
    const leader = names[ni++ % names.length];
    const name = era.medieval ? `${leader}'s ${era.names[type]}` : `${BT_CALLSIGNS[i]} · ${era.names[type]}`;
    const s = { id: b.uid++, type, name, call: era.medieval ? leader : BT_CALLSIGNS[i], leader, men: [], path: [], stance: 'fire', pace: 'walk', ability: null, ammo: st.ammo, ammo_max: st.ammo,
                morale: st.morale, morale_max: st.morale, state: 'steady', anchor: bt_open_spot(b, spots[i][0], spots[i][1]), facing: [0, -1], still: 9, build: 0, lures_left: type === 'scout' ? 2 : 0, last_noise: -9, kills: 0, lost: 0 };
    for (let m = 0; m < st.men; m++) {
      const off = bt_slot(m, st.men, s.facing);
      const p = bt_open_spot(b, s.anchor[0] + off[0], s.anchor[1] + off[1]);
      const man = { id: b.uid++, kind: 'man', squad: s.id, x: p[0], y: p[1], hp: st.hp, max_hp: st.hp, cd: bt_rand(b) * st.rate, mcd: 0, bitten: -1, spores: 0, name: m === 0 ? leader : names[ni++ % names.length] };
      b.men.push(man); s.men.push(man.id);
    }
    b.squads.push(s);
  });
  if (b.objective === 'rescue') {
    const hs = b.house, n = 6;
    for (let i = 0; i < n; i++) {
      const x = hs.x0 + 0.5 + (i % 3) * ((hs.x1 - hs.x0) / 2), y = hs.y0 + 0.5 + Math.floor(i / 3) * ((hs.y1 - hs.y0));
      b.civs.push({ id: b.uid++, kind: 'civ', x, y, hp: 12, max_hp: 12, follow: null, bitten: -1, spores: 0 });
    }
    b.civ_total = n;
  }
}

// The nearest open tile centre to (x, y) for the living.
function bt_open_spot(b, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const nx = tx + dx, ny = ty + dy;
    if (bt_in(b, nx, ny) && bt_cost(b, bt_idx(b, nx, ny), 'h') === 1 && b.tiles[bt_idx(b, nx, ny)] !== BTILE.FENCE) return r === 0 ? [x, y] : [nx + 0.5, ny + 0.5];
  }
  return [x, y];
}

// Formation: rows of three across the facing direction, front row first.
function bt_slot(i, n, facing) {
  const per = 3, row = Math.floor(i / per), inrow = Math.min(per, n - row * per), col = i % per;
  const across = (col - (inrow - 1) / 2) * 0.62, back = row * 0.62 - 0.3;
  const fx = facing[0], fy = facing[1];
  return [-fy * across - fx * back, fx * across - fy * back];
}

// ---------------------------------------------------------------- the dead
function bt_profile(b) { return CONTENT.presets[b.preset]; }
const bt_hour = (b) => BT_OBJECTIVES[b.objective].hour0 + ((b.turn - 1) + b.t / BT.TURN_TICKS) * BT_OBJECTIVES[b.objective].minutes / 60;
function bt_dark(b) { const h = bt_hour(b) % 24; return h >= 19.5 || h < 6; }
function bt_mult(b) {
  const prof = bt_profile(b), hs = prof.horde_size;
  return Math.pow((hs[0] + hs[1]) / 2 / 12, 0.55) * prof.density * (BT_PRESET_SCALE[prof.id] || 1) * CONTENT.difficulties[b.cfg.difficulty].zombies;
}

function bt_pick_special(b) {
  const prof = bt_profile(b), boost = prof.mutates >= 1 ? 1 + 0.2 * b.turn : 1;
  const pairs = [['walker', 10]];
  for (const [id, w, first] of prof.specials) if (b.turn >= first && CONTENT.specials[id]) pairs.push([id, w * boost]);
  let total = 0;
  for (const p of pairs) total += p[1];
  let roll = bt_rand(b) * total;
  for (const p of pairs) { roll -= p[1]; if (roll <= 0) return p[0]; }
  return 'walker';
}

function bt_spawn_zed(b, x, y, special) {
  if (b.zeds.length >= BT.MAX_ZEDS) return null;
  const sp = CONTENT.specials[special] || CONTENT.specials.walker, prof = bt_profile(b);
  const hp = Math.max(4, Math.round(sp.hp * (prof.hp_mult || 1)));
  const z = { id: b.uid++, kind: 'zed', special: sp.id, x, y, hp, max_hp: hp, cd: 0, tgt: null, goal: null, mem: 0, scream: 0, leap: 0, dash: 0, burn: 0 };
  b.zeds.push(z);
  return z;
}

// Some of the dead are already here when the battle starts.
function bt_seed_dead(b) {
  const prof = bt_profile(b), n = Math.round((b.objective === 'rescue' ? 16 : 10) * bt_mult(b));
  const day = !bt_dark(b);
  for (let i = 0; i < n; i++) {
    let spot = null;
    for (let tries = 0; tries < 60 && !spot; tries++) {
      const x = bt_int(b, 0, b.w - 1), y = bt_int(b, 0, Math.floor(b.h * 0.62));
      const k = bt_idx(b, x, y), t = b.tiles[k];
      if (bt_cost(b, k, 'z') === Infinity || bt_reserved(b, x, y) && b.objective === 'hold') continue;
      if (prof.sun_burn && day && !bt_indoor(t)) continue;              // the sun-shy dead wait indoors
      if (bt_in_house(b, x, y, 1)) continue;
      spot = [x + 0.5, y + 0.5];
    }
    if (spot) bt_spawn_zed(b, spot[0], spot[1], bt_pick_special(b));
  }
}

// What comes next turn, and from where: shown to the player while they plan.
function bt_plan_wave(b) {
  if (b.turn > b.turns) { b.wave = null; return; }
  const k = b.turn, base = b.objective === 'hold' ? 6 + 3.6 * k : 3 + 1.8 * k;
  let count = Math.max(1, Math.round(base * bt_mult(b)));
  if (b.objective === 'hold' && k === b.turns - 1) count = Math.round(count * 1.6);       // the last big push before dawn
  const prof = bt_profile(b);
  const hourNext = BT_OBJECTIVES[b.objective].hour0 + (k - 1) * BT_OBJECTIVES[b.objective].minutes / 60;
  const dayNext = !(hourNext % 24 >= 19.5 || hourNext % 24 < 6);
  const inside = !!prof.sun_burn && dayNext;
  if (inside) count = Math.max(1, Math.round(count * 0.4));          // by day only a few find a way in and wait in the dark
  const sides = ['north'];
  if (k >= 3) sides.push(bt_rand(b) < 0.5 ? 'west' : 'east');
  if (k >= 6 && bt_rand(b) < 0.6) sides.push(sides.includes('west') ? 'east' : 'west');
  const entries = sides.map((side) => ({ side, at: side === 'north' ? bt_int(b, 2, b.w - 3) : bt_int(b, 2, Math.floor(b.h * 0.55)) }));
  b.wave = { count, sides: inside ? [] : sides, entries: inside ? [] : entries, inside, words: count < 6 ? 'a few' : count < 15 ? 'a crowd' : count < 35 ? 'a horde' : 'a tide' };
}

function bt_wave_spot(b, side, near) {
  for (let tries = 0; tries < 40; tries++) {
    let x, y;
    const spread = 2 + Math.floor(tries / 8), along = clamp(near + bt_int(b, -spread, spread), 0, side === 'north' ? b.w - 1 : b.h - 1);
    if (side === 'north') { x = along; y = bt_int(b, 0, bt_profile(b).speed < 0.9 ? 7 : 2); }     // the slow dead are already on their way
    else if (side === 'west') { x = bt_int(b, 0, 2); y = along; }
    else if (side === 'east') { x = bt_int(b, b.w - 3, b.w - 1); y = along; }
    else {                                                            // inside a building (not the refuge)
      const bl = bt_pick(b, b.buildings.filter((q) => !b.refuge || q[1] < b.refuge.y0 - 2));
      if (!bl) return null;
      x = bt_int(b, bl[0] + 1, bl[2] - 1); y = bt_int(b, bl[1] + 1, bl[3] - 1);
    }
    const k = bt_idx(b, x, y);
    if (bt_in_house(b, x, y, 1) || bt_in_refuge(b, x, y)) continue;
    if (bt_cost(b, k, 'z') !== Infinity && !bt_has_barricade(b, k)) return [x + 0.2 + bt_rand(b) * 0.6, y + 0.2 + bt_rand(b) * 0.6];
  }
  return null;
}

// ---------------------------------------------------------------- orders (plan phase)
function bt_squad(b, id) { return b.squads.find((s) => s.id === id) || null; }
function bt_squad_men(b, s) { return s.men.map((id) => b.men.find((m) => m.id === id)).filter(Boolean); }
function bt_alive(b, s) { return s.men.length > 0; }

// A path for a squad through the given waypoints (tile coordinates). Returns the path or null when unreachable.
function bt_order_move(b, squad_id, waypoints, append) {
  const s = bt_squad(b, squad_id);
  if (!s || !bt_alive(b, s) || b.phase !== 'plan') return null;
  let from = append && s.path.length ? s.path[s.path.length - 1] : s.anchor;
  const path = append ? s.path.slice() : [];
  for (let i = 0; i < waypoints.length; i++) {
    let wp = waypoints[i];
    if (!bt_in(b, Math.floor(wp[0]), Math.floor(wp[1]))) return null;
    if (bt_cost(b, bt_idx(b, Math.floor(wp[0]), Math.floor(wp[1])), 'h') === Infinity) wp = bt_open_spot(b, wp[0], wp[1]);   // a finger on a wall means beside it
    const tx = Math.floor(wp[0]), ty = Math.floor(wp[1]);
    if (bt_cost(b, bt_idx(b, tx, ty), 'h') === Infinity) return null;
    const f = bt_hfield(b, 'p' + bt_idx(b, tx, ty), [bt_idx(b, tx, ty)]);
    if (f[bt_idx(b, Math.floor(from[0]), Math.floor(from[1]))] === Infinity) { if (i < waypoints.length - 1) continue; return null; }
    let cur = [from[0], from[1]];
    for (let guard = 0; guard < b.w * b.h; guard++) {
      const nx = bt_descend(b, f, cur[0], cur[1], 'h');
      if (!nx) break;
      cur = [nx[0] + 0.5, nx[1] + 0.5];
      path.push(cur);
    }
    if (!path.length || Math.floor(path[path.length - 1][0]) !== tx || Math.floor(path[path.length - 1][1]) !== ty) path.push([tx + 0.5, ty + 0.5]);
    from = path[path.length - 1];
  }
  s.path = bt_smooth(b, path);
  return s.path;
}
// Drop the in-between points of straight runs so men walk in lines, not stairs.
function bt_smooth(b, path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], c = path[i + 1];
    if (!bt_walk_line(b, a, c)) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}
function bt_walk_line(b, a, c) {
  const d = dist(a, c), n = Math.ceil(d / 0.25);
  for (let i = 1; i <= n; i++) {
    const x = a[0] + (c[0] - a[0]) * i / n, y = a[1] + (c[1] - a[1]) * i / n;
    if (!bt_passable(b, x, y, 'h') || bt_cost(b, bt_idx(b, Math.floor(x), Math.floor(y)), 'h') !== 1) return false;
    for (const [ox, oy] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) if (!bt_passable(b, x + ox, y + oy, 'h')) return false;
  }
  return true;
}

function bt_set(b, squad_id, opts) {
  const s = bt_squad(b, squad_id);
  if (!s || b.phase !== 'plan') return false;
  if (opts.stance === 'fire' || opts.stance === 'hold') s.stance = opts.stance;
  if (opts.pace === 'walk' || opts.pace === 'run') s.pace = opts.pace;
  return true;
}
function bt_clear(b, squad_id) { const s = bt_squad(b, squad_id); if (s && b.phase === 'plan') { s.path = []; s.ability = null; } }

// The squad's special action at a tile: a lure (scouts) or a barricade (shield squads). Returns an error text or null.
function bt_set_ability(b, squad_id, x, y) {
  const s = bt_squad(b, squad_id);
  if (!s || b.phase !== 'plan') return 'Not now.';
  const kind = BT_TYPES[s.type].ability, era = BT_ERAS[b.era] || BT_ERAS.modern;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!kind) return 'This squad has no special action.';
  if (!bt_in(b, tx, ty)) return 'Off the map.';
  if (kind === 'lure') {
    if (s.lures_left <= 0) return `No ${era.lure} left.`;
    if (dist([tx + 0.5, ty + 0.5], s.anchor) > 10) return 'Too far: a lure lands within 10 tiles of the squad.';
    if (b.tiles[bt_idx(b, tx, ty)] === BTILE.WALL) return 'Not into a wall.';
  } else {
    if (b.barricades_left <= 0) return 'No materials left for barricades.';
    const k = bt_idx(b, tx, ty), t = b.tiles[k];
    if (bt_cost(b, k, 'h') === Infinity || t === BTILE.FENCE) return 'A barricade needs open ground or a doorway.';
    if (b.refuge && tx >= b.refuge.x0 && tx <= b.refuge.x1 && ty >= b.refuge.y0 && ty <= b.refuge.y1) return 'Not inside the refuge.';
    const end = s.path.length ? s.path[s.path.length - 1] : s.anchor;
    if (dist([tx + 0.5, ty + 0.5], end) > 3) return 'Too far: the squad builds within 3 tiles of where its path ends.';
  }
  s.ability = { kind, x: tx, y: ty };
  return null;
}

// Where the squad's leader point will be when the turn ends, if nothing stops it (for the plan view).
function bt_reach(b, s) {
  const st = bt_type_stats(b.era, s.type);
  let budget = (s.pace === 'run' ? BT.RUN : BT.WALK) * st.speed * BT.TURN_TICKS * BT.DT;
  let cur = s.anchor;
  for (const p of s.path) {
    const d = dist(cur, p) / bt_speed_factor(b, p[0], p[1], 'h');
    if (d >= budget) { const f = budget / d; return [cur[0] + (p[0] - cur[0]) * f, cur[1] + (p[1] - cur[1]) * f]; }
    budget -= d; cur = p;
  }
  return cur;
}

// ---------------------------------------------------------------- resolve phase
function bt_begin_turn(b) {
  if (b.phase !== 'plan' || b.over) return false;
  b.phase = 'resolve'; b.t = 0; b.report = [];
  const era = BT_ERAS[b.era] || BT_ERAS.modern;
  for (const s of b.squads) {
    if (!bt_alive(b, s) || !s.ability) continue;
    if (s.ability.kind === 'lure' && s.lures_left > 0 && s.state !== 'broken') {
      b.lures.push({ x: s.ability.x + 0.5, y: s.ability.y + 0.5, turns: 2 });
      s.lures_left--; s.ability = null;
      b.report.push(`${s.name}: ${era.lure} goes off.`);
    }
  }
  // this turn's wave arrives over its first three seconds
  if (b.wave) {
    for (let i = 0; i < b.wave.count; i++) {
      const e = b.wave.inside ? null : b.wave.entries[i % b.wave.entries.length];
      b.pending.push({ at: Math.floor(bt_rand(b) * 30), side: e ? e.side : 'inside', near: e ? e.at : 0, special: bt_pick_special(b) });
    }
  }
  return true;
}

function bt_noise(b, x, y, r, fx) {
  r *= CONTENT.difficulties[b.cfg.difficulty].noise;
  b.noises.push({ x, y, r, ttl: 1.5 });
  if (fx) fx.push({ kind: 'noise', x, y, r });
}

// One fixed step. Returns the visual events of the step (shots, deaths, noises...) for the front-end.
function bt_tick(b) {
  if (b.phase !== 'resolve' || b.over) return [];
  const fx = [], dt = BT.DT;
  // arrivals
  for (let i = b.pending.length - 1; i >= 0; i--) {
    const p = b.pending[i];
    if (p.at > b.t) continue;
    b.pending.splice(i, 1);
    const spot = bt_wave_spot(b, p.side, p.near);
    if (spot) bt_spawn_zed(b, spot[0], spot[1], p.special);
  }
  // the risen
  for (let i = b.corpses.length - 1; i >= 0; i--) {
    const c = b.corpses[i];
    c.t -= dt;
    if (c.t <= 0) { b.corpses.splice(i, 1); if (bt_spawn_zed(b, c.x, c.y, 'walker')) fx.push({ kind: 'rise', x: c.x, y: c.y }); }
  }
  // lures call every second
  if (b.t % 10 === 0) for (const l of b.lures) bt_noise(b, l.x, l.y, 14, fx);
  for (const n of b.noises) n.ttl -= dt;
  b.noises = b.noises.filter((n) => n.ttl > 0);

  const grid = bt_grid(b);
  bt_squads_step(b, fx);
  bt_men_step(b, grid, fx);
  bt_civs_step(b, fx);
  bt_zeds_step(b, grid, fx);
  bt_infection_step(b, fx);
  bt_objective_step(b, fx);

  b.t++;
  if (!b.over && b.t >= BT.TURN_TICKS) bt_end_turn(b);
  return fx;
}

function bt_run_turn(b) { const all = []; if (b.phase === 'plan') bt_begin_turn(b); while (b.phase === 'resolve' && !b.over) for (const f of bt_tick(b)) all.push(f); return all; }

// Zombies bucketed by tile, for neighbour queries.
function bt_grid(b) {
  const g = new Map();
  for (const z of b.zeds) {
    const k = bt_idx(b, Math.floor(z.x), Math.floor(z.y));
    const a = g.get(k); if (a) a.push(z); else g.set(k, [z]);
  }
  return g;
}
function bt_near_zeds(b, grid, x, y, r) {
  const out = [], tx = Math.floor(x), ty = Math.floor(y), R = Math.ceil(r);
  for (let yy = ty - R; yy <= ty + R; yy++) for (let xx = tx - R; xx <= tx + R; xx++) {
    if (!bt_in(b, xx, yy)) continue;
    const a = grid.get(bt_idx(b, xx, yy));
    if (a) for (const z of a) { const d = Math.hypot(z.x - x, z.y - y); if (d <= r) out.push([d, z]); }
  }
  out.sort((p, q) => p[0] - q[0] || p[1].id - q[1].id);
  return out;
}

// Move a body toward (tx, ty) by at most `step`, sliding along walls. Returns true if it moved.
function bt_move(b, u, tx, ty, step, who) {
  const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
  if (d < 1e-4) return false;
  const s = Math.min(step, d), nx = u.x + dx / d * s, ny = u.y + dy / d * s;
  if (bt_passable(b, nx, ny, who)) { u.x = nx; u.y = ny; return true; }
  if (bt_passable(b, nx, u.y, who)) { u.x = nx; return true; }
  if (bt_passable(b, u.x, ny, who)) { u.y = ny; return true; }
  return false;
}

function bt_safe_goal(b) {
  if (b.refuge) { const r = b.refuge; return [Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2)]; }
  return [Math.floor(b.w / 2), b.h - 1];
}

function bt_squads_step(b, fx) {
  const era = BT_ERAS[b.era] || BT_ERAS.modern;
  for (const s of b.squads) {
    if (!bt_alive(b, s)) continue;
    const st = bt_type_stats(b.era, s.type), men = bt_squad_men(b, s);
    // cohesion: the leader point waits for stragglers
    let spread = 0;
    men.forEach((m, i) => { const o = bt_slot(i, men.length, s.facing); spread += Math.hypot(m.x - (s.anchor[0] + o[0]), m.y - (s.anchor[1] + o[1])); });
    spread /= Math.max(1, men.length);
    let target = null, pace = s.pace;
    if (s.state === 'broken') {
      const g = bt_safe_goal(b), f = bt_hfield(b, 'safe', [bt_idx(b, g[0], g[1])]);
      const nx = bt_descend(b, f, s.anchor[0], s.anchor[1], 'h');
      target = nx ? [nx[0] + 0.5, nx[1] + 0.5] : null; pace = 'run';
    } else if (s.path.length) target = s.path[0];
    const before = [s.anchor[0], s.anchor[1]];
    if (target && spread < 1.6) {
      const speed = (pace === 'run' ? BT.RUN : BT.WALK) * st.speed * bt_speed_factor(b, s.anchor[0], s.anchor[1], 'h');
      const dx = target[0] - s.anchor[0], dy = target[1] - s.anchor[1], d = Math.hypot(dx, dy);
      if (d > 0.05) s.facing = [dx / d, dy / d];
      const stepd = speed * BT.DT;
      if (d <= stepd) { s.anchor = [target[0], target[1]]; if (s.state !== 'broken') s.path.shift(); }
      else s.anchor = [s.anchor[0] + dx / d * stepd, s.anchor[1] + dy / d * stepd];
    }
    const moved = Math.hypot(s.anchor[0] - before[0], s.anchor[1] - before[1]) > 1e-4;
    s.moving = moved; s.still = moved ? 0 : s.still + BT.DT;
    // building a barricade: within reach of the spot, with the spot clear
    if (s.ability && s.ability.kind === 'barricade' && s.state !== 'broken') {
      const k = bt_idx(b, s.ability.x, s.ability.y), cx = s.ability.x + 0.5, cy = s.ability.y + 0.5;
      const blocked = b.zeds.some((z) => Math.floor(z.x) === s.ability.x && Math.floor(z.y) === s.ability.y) || b.men.some((m) => Math.floor(m.x) === s.ability.x && Math.floor(m.y) === s.ability.y) || b.civs.some((c) => Math.floor(c.x) === s.ability.x && Math.floor(c.y) === s.ability.y);
      if (dist(s.anchor, [cx, cy]) <= 3 && !blocked && b.barricades_left > 0 && !bt_has_barricade(b, k)) {
        s.build += BT.DT;
        if (s.build >= 4) {
          b.barricades[k] = 70; b.barricades_left--; s.ability = null; s.build = 0; bt_invalidate(b);
          fx.push({ kind: 'build', x: cx, y: cy }); b.report.push(`${s.name} put up ${era.barricade}.`);
        }
      }
    }
  }
}

function bt_men_step(b, grid, fx) {
  const dark = bt_dark(b), prof = bt_profile(b);
  for (const s of b.squads) {
    if (!bt_alive(b, s)) continue;
    const st = bt_type_stats(b.era, s.type), men = bt_squad_men(b, s);
    const shaken = s.state === 'shaken', broken = s.state === 'broken';
    const runningNow = s.moving && (s.pace === 'run' || broken);
    men.forEach((m, i) => {
      const o = bt_slot(i, men.length, s.facing);
      let tx = s.anchor[0] + o[0], ty = s.anchor[1] + o[1];
      if (!bt_passable(b, tx, ty, 'h')) { tx = s.anchor[0]; ty = s.anchor[1]; }
      const speed = (s.pace === 'run' || broken ? BT.RUN : BT.WALK) * st.speed * 1.3 * bt_speed_factor(b, m.x, m.y, 'h');
      bt_move(b, m, tx, ty, speed * BT.DT, 'h');
      m.cd -= BT.DT; m.mcd -= BT.DT;
      // close combat first: whatever has its hands on you
      const close = bt_near_zeds(b, grid, m.x, m.y, 0.75);
      if (close.length && m.mcd <= 0) {
        const z = close[0][1];
        const dmg = bt_int(b, st.melee[0], st.melee[1]) * (z.special && CONTENT.specials[z.special].flags.includes('tough') ? 0.7 : 1);
        bt_hurt_zed(b, z, dmg, s, fx);
        m.mcd = 0.9;
        return;
      }
      if (broken || s.stance !== 'fire' || st.range <= 0 || s.ammo <= 0 || m.cd > 0 || runningNow) return;
      if (st.setup && s.still < st.setup) return;
      const cand = bt_near_zeds(b, grid, m.x, m.y, Math.min(st.range, (dark ? 5 : 8) + st.sight));       // nobody shoots what they cannot see
      let target = null;
      for (let c = 0; c < cand.length && c < 5; c++) if (bt_los(b, m.x, m.y, cand[c][1].x, cand[c][1].y)) { target = cand[c][1]; break; }
      if (!target) return;
      s.ammo--;
      m.cd = st.rate * (0.85 + bt_rand(b) * 0.3);
      let acc = st.acc * (s.moving ? 0.6 : 1) * (shaken ? 0.8 : 1) * (dark ? 0.85 : 1) * (1 - 0.45 * Math.hypot(target.x - m.x, target.y - m.y) / st.range);
      const tt = bt_tile(b, Math.floor(target.x), Math.floor(target.y));
      if (tt === BTILE.BRUSH || tt === BTILE.RUBBLE) acc *= 0.75;
      const hit = bt_rand(b) < acc;
      let ix = target.x, iy = target.y;
      if (!hit) { ix += (bt_rand(b) - 0.5) * 1.6; iy += (bt_rand(b) - 0.5) * 1.6; }
      fx.push({ kind: 'shot', x0: m.x, y0: m.y, x1: ix, y1: iy, hit, heavy: s.type === 'heavy', aoe: st.aoe });
      if (st.aoe) {
        fx.push({ kind: 'aoe', x: ix, y: iy, r: st.aoe });
        for (const [, z] of bt_near_zeds(b, grid, ix, iy, st.aoe)) bt_hurt_zed(b, z, bt_int(b, st.dmg[0], st.dmg[1]) * (prof.weakness === 'fire' || b.era === 'medieval' ? 1.2 : 1), s, fx, true);
      } else if (hit) {
        const sp = CONTENT.specials[target.special], tough = sp.flags.includes('tough');
        let dmg = bt_int(b, st.dmg[0], st.dmg[1]);
        if (prof.kill_rule === 'head') dmg = bt_rand(b) < 0.35 ? Math.max(dmg, tough ? dmg * 1.5 : target.hp) : dmg * 0.3;
        else if (tough) dmg *= 0.6;
        bt_hurt_zed(b, target, dmg, s, fx);
      }
      if (b.t - s.last_noise >= 4 || b.t < s.last_noise) { bt_noise(b, m.x, m.y, st.noise, fx); s.last_noise = b.t; }
    });
  }
}

function bt_hurt_zed(b, z, dmg, s, fx, fire) {
  if (z.hp <= 0) return;
  z.hp -= dmg;
  if (z.hp > 0) return;
  b.kills++; if (s) s.kills++;
  fx.push({ kind: 'zdie', x: z.x, y: z.y, special: z.special });
  b.zeds.splice(b.zeds.indexOf(z), 1);
  const sp = CONTENT.specials[z.special];
  if (sp.flags.includes('explodes')) bt_burst(b, z.x, z.y, fx);
}

// A bloater bursts: everyone close is hurt, and with the spore strain the cloud can infect.
function bt_burst(b, x, y, fx) {
  fx.push({ kind: 'burst', x, y, r: 1.6 });
  const prof = bt_profile(b);
  for (const u of b.men.concat(b.civs)) {
    if (Math.hypot(u.x - x, u.y - y) > 1.6) continue;
    bt_hurt_living(b, u, bt_int(b, 4, 9), fx, null);
    if (prof.vector === 'spore' && bt_rand(b) < 0.5) bt_infect(b, u, fx);
  }
}

function bt_infect(b, u, fx) {
  if (u.bitten >= 0) return;
  const prof = bt_profile(b);
  u.bitten = Math.max(3, prof.incubation / 10);                        // a main-game turn is about a tenth of a battle second
  fx.push({ kind: 'bitten', x: u.x, y: u.y });
  if (u.kind === 'man') { const s = bt_squad(b, u.squad); if (s) { s.morale -= 5; b.report.push(`${u.name} (${s.name}) is infected.`); } }
}

function bt_hurt_living(b, u, dmg, fx, z) {
  if (u.hp <= 0) return;
  u.hp -= dmg;
  fx.push({ kind: 'hurt', x: u.x, y: u.y });
  if (u.hp > 0) return;
  bt_kill_living(b, u, fx, false);
}

function bt_kill_living(b, u, fx, turned) {
  const prof = bt_profile(b);
  u.hp = 0;
  fx.push({ kind: turned ? 'turn' : 'mdie', x: u.x, y: u.y });
  if (u.kind === 'man') {
    b.men.splice(b.men.indexOf(u), 1);
    const s = bt_squad(b, u.squad);
    if (s) {
      s.men = s.men.filter((id) => id !== u.id); s.lost++;
      s.morale -= turned ? 18 : 14;
      b.report.push(turned ? `${u.name} (${s.name}) turned.` : `${u.name} (${s.name}) is down.`);
      if (!s.men.length) b.report.push(`${s.name} is gone.`);
    }
    if (turned) b.turned++; else b.lost++;
  } else {
    b.civs.splice(b.civs.indexOf(u), 1);
    b.civ_lost++;
    b.report.push(turned ? 'One of the survivors turned.' : 'A survivor was killed.');
  }
  if (turned) bt_spawn_zed(b, u.x, u.y, 'walker');
  else if (prof.turn_on_death || u.bitten >= 0) b.corpses.push({ x: u.x, y: u.y, t: u.bitten >= 0 ? 2 : 5 });
}

function bt_civs_step(b, fx) {
  for (const c of b.civs.slice()) {
    if (c.follow !== null) {
      const s = bt_squad(b, c.follow);
      if (!s || !bt_alive(b, s) || s.state === 'broken') c.follow = null;
    }
    if (c.follow === null) {
      const hs = b.house, door = [hs.door[0] + 0.5, hs.door[1] + 0.5];
      const hiding = bt_in_house(b, Math.floor(c.x), Math.floor(c.y), 0);
      for (const s of b.squads) {
        if (!bt_alive(b, s) || s.state === 'broken') continue;
        if (dist(s.anchor, [c.x, c.y]) <= 2.5 || (hiding && dist(s.anchor, door) <= 2.5)) {
          c.follow = s.id;
          const dk = bt_idx(b, hs.door[0], hs.door[1]);
          if (bt_has_barricade(b, dk)) { delete b.barricades[dk]; bt_invalidate(b); b.report.push(`The ${(BT_ERAS[b.era] || BT_ERAS.modern).survivors} pull their barricade down and come out to ${s.name}.`); }
          break;
        }
      }
    }
    if (c.follow !== null) {
      const s = bt_squad(b, c.follow), i = b.civs.filter((q) => q.follow === s.id).indexOf(c);
      const back = 1.1 + Math.floor(i / 3) * 0.55, across = ((i % 3) - 1) * 0.55;
      let tx = s.anchor[0] - s.facing[0] * back - s.facing[1] * across, ty = s.anchor[1] - s.facing[1] * back + s.facing[0] * across;
      if (!bt_passable(b, tx, ty, 'h')) { tx = s.anchor[0]; ty = s.anchor[1]; }
      const speed = (s.pace === 'run' ? 1.8 : 1.35) * bt_speed_factor(b, c.x, c.y, 'h');
      if (!bt_move(b, c, tx, ty, speed * BT.DT, 'h') && Math.hypot(tx - c.x, ty - c.y) > 0.8) {
        const f = bt_hfield(b, 'p' + bt_idx(b, Math.floor(s.anchor[0]), Math.floor(s.anchor[1])), [bt_idx(b, Math.floor(s.anchor[0]), Math.floor(s.anchor[1]))]);
        const nx = bt_descend(b, f, c.x, c.y, 'h');
        if (nx) bt_move(b, c, nx[0] + 0.5, nx[1] + 0.5, speed * BT.DT, 'h');
      }
    }
    if (b.extract_y !== null && c.y >= b.extract_y) {
      b.civs.splice(b.civs.indexOf(c), 1); b.saved++;
      fx.push({ kind: 'saved', x: c.x, y: c.y });
      b.report.push(`A survivor reached safety (${b.saved}/${b.civ_total}).`);
    }
  }
}

// What a zombie wants: someone it sees or smells, else the loudest thing it hears, else the place the living are.
function bt_perceive(b, z, prof, dark) {
  const sp = CONTENT.specials[z.special];
  const sight = sp.flags.includes('blind') ? 0 : prof.sight * sp.sight * (dark ? prof.night_sight : 1) * (dark ? 0.8 : 1);
  const smell = prof.smell || 0;
  let best = null, bd = Infinity;
  for (const u of b.men.concat(b.civs)) {
    const d = Math.hypot(u.x - z.x, u.y - z.y);
    if (d >= bd) continue;
    if (d <= smell || (d <= sight && bt_los(b, z.x, z.y, u.x, u.y))) { best = u; bd = d; }
  }
  if (best) {
    if (z.tgt !== best.id && sp.flags.includes('screams') && z.scream <= 0) { z.scream = 8; return { tgt: best.id, scream: true }; }
    return { tgt: best.id };
  }
  let loud = null, ls = 0;
  for (const n of b.noises) {
    const d = Math.hypot(n.x - z.x, n.y - z.y), reach = n.r * prof.hearing * sp.hearing;
    if (d <= reach && reach - d > ls) { ls = reach - d; loud = n; }
  }
  if (loud) return { goal: [Math.floor(loud.x), Math.floor(loud.y)] };
  return null;
}

function bt_default_goal(b, z, prof, dark) {
  if (prof.sun_burn && !dark) return 'shelter';
  if (b.refuge) return 'refuge';
  if (b.civs.length) return z.id % 3 === 0 ? 'civs' : 'idle';      // a third of them have the scent of the survivors; the rest stand
  return 'living';
}

function bt_zeds_step(b, grid, fx) {
  const prof = bt_profile(b), dark = bt_dark(b), diff = CONTENT.difficulties[b.cfg.difficulty];
  const byId = new Map();
  for (const u of b.men) byId.set(u.id, u);
  for (const u of b.civs) byId.set(u.id, u);
  const living = b.men.concat(b.civs);
  for (const z of b.zeds.slice()) {
    if (z.hp <= 0) continue;
    const sp = CONTENT.specials[z.special];
    z.cd -= BT.DT; z.scream -= BT.DT; z.leap -= BT.DT; z.dash -= BT.DT; z.mem -= BT.DT;
    // the sun burns the vampiric dead out in the open
    const here = bt_tile(b, Math.floor(z.x), Math.floor(z.y));
    if (prof.sun_burn && !dark && !bt_indoor(here)) {
      z.hp -= 2.5 * BT.DT;
      if (z.hp <= 0) { fx.push({ kind: 'burn', x: z.x, y: z.y }); b.zeds.splice(b.zeds.indexOf(z), 1); b.kills++; continue; }
    }
    if ((z.id + b.t) % 5 === 0) {
      const p = bt_perceive(b, z, prof, dark);
      if (p && p.tgt) { z.tgt = p.tgt; z.goal = null; z.mem = 3; if (p.scream) { bt_noise(b, z.x, z.y, 16, fx); fx.push({ kind: 'scream', x: z.x, y: z.y }); } }
      else if (p && p.goal) { if (!z.tgt || z.mem <= 0) { z.goal = p.goal; z.tgt = null; } }
      else if (z.mem <= 0) z.tgt = null;
    }
    let target = z.tgt !== null ? byId.get(z.tgt) : null;
    if (!target) z.tgt = null;
    // bite whoever is in reach
    let reach = null, rd = 0.62;
    for (const u of living) { if (u.hp <= 0) continue; const d = Math.hypot(u.x - z.x, u.y - z.y); if (d < rd) { rd = d; reach = u; } }
    if (reach) {
      if (z.cd <= 0) {
        z.cd = prof.speed >= 1.2 ? 0.7 : 1.0;
        const s = reach.kind === 'man' ? bt_squad(b, reach.squad) : null;
        const armor = s ? bt_type_stats(b.era, s.type).armor : 1;
        if (bt_rand(b) < (sp.acc / 100) * armor) {
          bt_hurt_living(b, reach, bt_int(b, sp.dmg[0], sp.dmg[1]) * diff.damage * 0.8, fx, z);
          if (reach.hp > 0 && bt_rand(b) < prof.infect) bt_infect(b, reach, fx);
        }
      }
      continue;
    }
    // move
    let speed = BT.WALK * prof.speed * sp.speed * (dark ? prof.night_speed : prof.day_speed || 1);
    if (sp.flags.includes('leaps') && target && z.leap <= 0 && Math.hypot(target.x - z.x, target.y - z.y) < 4) { z.leap = 5; z.dash = 0.5; }
    if (z.dash > 0) speed *= 4;
    speed *= bt_speed_factor(b, z.x, z.y, 'z');
    let dest = null;
    if (target && Math.hypot(target.x - z.x, target.y - z.y) < 3 && bt_los(b, z.x, z.y, target.x, target.y)) dest = [target.x, target.y];
    else {
      let key, goals;
      if (target) { const k = bt_idx(b, Math.floor(target.x), Math.floor(target.y)); key = 't' + k; goals = [k]; }
      else if (z.goal) {
        const k = bt_idx(b, z.goal[0], z.goal[1]); key = 't' + k; goals = [k];
        if (Math.floor(z.x) === z.goal[0] && Math.floor(z.y) === z.goal[1]) z.goal = null;
      } else {
        const g = bt_default_goal(b, z, prof, dark);
        if (g === 'shelter') { key = 'shelter'; goals = null; }
        else if (g === 'refuge') { key = 'refuge'; goals = null; }
        else if (g === 'idle') continue;
        else if (g === 'civs') { const c = b.civs[0]; const k = bt_idx(b, Math.floor(c.x), Math.floor(c.y)); key = 't' + k; goals = [k]; }
        else {
          let near = null, nd = Infinity;
          for (const u of living) { const d = Math.hypot(u.x - z.x, u.y - z.y); if (d < nd) { nd = d; near = u; } }
          if (!near) continue;
          const k = bt_idx(b, Math.floor(near.x), Math.floor(near.y)); key = 't' + k; goals = [k];
        }
      }
      if (!goals) goals = bt_goal_set(b, key);
      if (goals.length) {
        const f = bt_zfield(b, key, goals);
        const nx = bt_descend(b, f, z.x, z.y, 'z');
        if (nx) {
          const nk = bt_idx(b, nx[0], nx[1]);
          if (bt_has_barricade(b, nk)) {                                // pile on the barricade
            if (z.cd <= 0) {
              z.cd = 1;
              const dmg = (sp.flags.includes('breaker') ? 16 : 4) * (prof.swarm ? 2 : 1);
              b.barricades[nk] -= dmg;
              fx.push({ kind: 'thump', x: nx[0] + 0.5, y: nx[1] + 0.5 });
              if (b.barricades[nk] <= 0) { delete b.barricades[nk]; bt_invalidate(b); fx.push({ kind: 'break', x: nx[0] + 0.5, y: nx[1] + 0.5 }); b.report.push('A barricade gave way.'); }
            }
            continue;
          }
          dest = [nx[0] + 0.5, nx[1] + 0.5];
        } else if (target) dest = [target.x, target.y];
      }
    }
    if (dest) bt_move(b, z, dest[0], dest[1], speed * BT.DT, 'z');
  }
  // crowding: the dead push each other apart, so a horde is a mass and not a single point
  const g2 = bt_grid(b);
  for (const z of b.zeds) {
    for (const [d, o] of bt_near_zeds(b, g2, z.x, z.y, 0.45)) {
      if (o === z || d < 1e-6) continue;
      const push = (0.45 - d) * 0.25, ux = (z.x - o.x) / d, uy = (z.y - o.y) / d;
      if (bt_passable(b, z.x + ux * push, z.y + uy * push, 'z')) { z.x += ux * push; z.y += uy * push; }
    }
  }
}

function bt_goal_set(b, key) {
  const out = [];
  if (key === 'refuge') { const r = b.refuge; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push(bt_idx(b, x, y)); }
  else if (key === 'shelter') { for (let k = 0; k < b.tiles.length; k++) if (bt_indoor(b.tiles[k]) && !(b.refuge && bt_in_refuge(b, k % b.w, Math.floor(k / b.w)))) out.push(k); }
  return out;
}
function bt_in_house(b, x, y, margin) { const h = b.house; return !!h && x >= h.x0 - margin && x <= h.x1 + margin && y >= h.y0 - margin && y <= h.y1 + margin; }
function bt_in_refuge(b, x, y) { const r = b.refuge; return !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }

function bt_infection_step(b, fx) {
  const prof = bt_profile(b);
  for (const u of b.men.concat(b.civs)) {
    if (u.hp <= 0) continue;
    // spores hang in closed rooms (not in the sealed refuge)
    if (prof.vector === 'spore' && bt_indoor(bt_tile(b, Math.floor(u.x), Math.floor(u.y))) && !bt_in_refuge(b, Math.floor(u.x), Math.floor(u.y))) {
      u.spores += BT.DT;
      if (u.spores >= 1) { u.spores = 0; if (bt_rand(b) < 0.03) bt_infect(b, u, fx); }
    }
    if (u.bitten >= 0) {
      u.bitten -= BT.DT;
      if (u.bitten <= 0) bt_kill_living(b, u, fx, true);
    }
  }
}

function bt_objective_step(b, fx) {
  // morale
  const grid = bt_grid(b);
  for (const s of b.squads) {
    if (!bt_alive(b, s)) continue;
    const men = bt_squad_men(b, s);
    const near = bt_near_zeds(b, grid, s.anchor[0], s.anchor[1], 3).length;
    let contacts = 0;
    for (const m of men) if (bt_near_zeds(b, grid, m.x, m.y, 0.75).length) contacts++;
    const pressure = Math.max(0, near - men.length) * 1.2 + contacts;
    const k = s.type === 'shield' ? 0.6 : 1;
    if (pressure > 0) s.morale -= pressure * k * BT.DT * 1.5;
    else s.morale += (near === 0 ? 4 : 1) * BT.DT;
    if (bt_in_refuge(b, Math.floor(s.anchor[0]), Math.floor(s.anchor[1]))) s.morale += 2 * BT.DT;
    s.morale = clamp(s.morale, 0, s.morale_max);
    const was = s.state;
    if (s.state === 'broken') { if (s.morale >= 45) s.state = 'steady'; }
    else s.state = s.morale < 20 ? 'broken' : s.morale < 40 ? 'shaken' : 'steady';
    if (s.state === 'broken' && was !== 'broken') { s.path = []; b.report.push(`${s.name} broke and is running.`); fx.push({ kind: 'broke', x: s.anchor[0], y: s.anchor[1] }); }
    if (was === 'broken' && s.state !== 'broken') b.report.push(`${s.name} rallied.`);
  }
  if (b.refuge) {
    let inside = 0;
    for (const z of b.zeds) if (bt_in_refuge(b, Math.floor(z.x), Math.floor(z.y))) inside++;
    if (inside) b.refuge.integrity = Math.max(0, b.refuge.integrity - inside * 0.6 * BT.DT);
  }
  bt_check_over(b, false);
}

function bt_end_turn(b) {
  // squads inside the refuge restock; lures burn out
  for (const s of b.squads) {
    if (!bt_alive(b, s)) continue;
    if (bt_in_refuge(b, Math.floor(s.anchor[0]), Math.floor(s.anchor[1])) && s.ammo < s.ammo_max) {
      s.ammo = Math.min(s.ammo_max, s.ammo + Math.ceil(s.ammo_max * 0.4));
      b.report.push(`${s.name} restocked.`);
    }
    if (s.ammo_max && s.ammo === 0) b.report.push(`${s.name} is out of ammunition.`);
  }
  for (const l of b.lures) l.turns--;
  b.lures = b.lures.filter((l) => l.turns > 0);
  bt_check_over(b, true);
  if (b.over) return;
  b.turn++; b.t = 0; b.phase = 'plan';
  bt_plan_wave(b);
}

function bt_check_over(b, endOfTurn) {
  if (b.over) return;
  const era = BT_ERAS[b.era] || BT_ERAS.modern;
  const lose = (title, text) => { b.over = { victory: false, title, text, summary: bt_summary(b) }; b.phase = 'over'; };
  const win = (title, text) => { b.over = { victory: true, title, text, summary: bt_summary(b) }; b.phase = 'over'; };
  if (!b.men.length) return lose('Wiped out', 'Nobody in the company is left standing. The dead have the field.');
  if (b.refuge && b.refuge.integrity <= 0) return lose('Overrun', `The dead got into ${era.refuge} and stayed there. The people inside had nowhere to go.`);
  if (b.objective === 'rescue') {
    const need = Math.ceil(b.civ_total / 2);
    if (b.civ_lost > b.civ_total - need) return lose('Too many lost', `Not enough of the ${era.survivors} are left alive to call this a rescue.`);
    if (!b.civs.length && b.saved >= need) return win('Brought them out', `${b.saved} of ${b.civ_total} ${era.survivors} made it out.`);
    if (endOfTurn && b.turn >= b.turns) return b.saved >= need ? win('Brought them out', `${b.saved} of ${b.civ_total} ${era.survivors} made it out before the way closed.`)
      : lose('Out of time', `The way out closed with ${b.saved} of ${b.civ_total} ${era.survivors} safe.`);
  } else if (endOfTurn && b.turn >= b.turns) {
    return win('The night held', `${cap(era.refuge)} stood until morning, ${Math.round(b.refuge.integrity)}% intact.`);
  }
}

function bt_summary(b) {
  const lines = [`Turn ${Math.min(b.turn, b.turns)} of ${b.turns}. The dead destroyed: ${b.kills}.`];
  for (const s of b.squads) {
    const st = bt_type_stats(b.era, s.type);
    lines.push(`${s.name}: ${s.men.length}/${st.men} standing, ${s.kills} kills${s.men.length ? '' : ' (lost)'}`);
  }
  if (b.turned) lines.push(`${b.turned} of your own turned.`);
  if (b.refuge) lines.push(`Refuge: ${Math.round(b.refuge.integrity)}% intact.`);
  if (b.civ_total) lines.push(`Survivors brought out: ${b.saved} of ${b.civ_total}.`);
  return lines;
}

// ---------------------------------------------------------------- what the player can see
function bt_visibility(b) {
  const vis = new Uint8Array(b.w * b.h), dark = bt_dark(b);
  const look = (x, y, r) => {
    const tx = Math.floor(x), ty = Math.floor(y), R = Math.ceil(r);
    for (let yy = ty - R; yy <= ty + R; yy++) for (let xx = tx - R; xx <= tx + R; xx++) {
      if (!bt_in(b, xx, yy) || vis[bt_idx(b, xx, yy)]) continue;
      if (Math.hypot(xx - tx, yy - ty) > r) continue;
      if (bt_los(b, tx + 0.5, ty + 0.5, xx + 0.5, yy + 0.5)) vis[bt_idx(b, xx, yy)] = 1;
    }
  };
  for (const s of b.squads) {
    if (!bt_alive(b, s)) continue;
    const st = bt_type_stats(b.era, s.type), r = (dark ? 5 : 8) + st.sight;
    for (const m of bt_squad_men(b, s)) look(m.x, m.y, r);
  }
  for (const c of b.civs) if (c.follow !== null) look(c.x, c.y, 3);
  if (b.refuge) for (let y = b.refuge.y0; y <= b.refuge.y1; y++) for (let x = b.refuge.x0; x <= b.refuge.x1; x++) vis[bt_idx(b, x, y)] = 1;
  return vis;
}

// ---------------------------------------------------------------- save
function bt_store(store) { return store || (typeof localStorage !== 'undefined' ? localStorage : null); }
function bt_save(b, store) { store = bt_store(store); if (store) store.setItem(BT.SAVE_KEY, JSON.stringify(b)); }
function bt_load(store) {
  store = bt_store(store);
  const raw = store && store.getItem(BT.SAVE_KEY);
  if (!raw) return null;
  const b = JSON.parse(raw);
  if (!b || b.v !== 1) return null;
  return b;
}
function bt_has_save(store) { try { const b = bt_load(store); return !!(b && !b.over); } catch (e) { return false; } }
function bt_delete_save(store) { try { store = bt_store(store); if (store) store.removeItem(BT.SAVE_KEY); } catch (e) { /* ignore */ } }

// Where a zombie is heading next (for the plan view's threat arrows). No side effects beyond the field cache.
function bt_intent(b, z) {
  const prof = bt_profile(b), dark = bt_dark(b);
  const target = z.tgt !== null ? (b.men.find((u) => u.id === z.tgt) || b.civs.find((u) => u.id === z.tgt)) : null;
  if (target) return [target.x, target.y];
  let key, goals;
  if (z.goal) { const k = bt_idx(b, z.goal[0], z.goal[1]); key = 't' + k; goals = [k]; }
  else {
    const g = bt_default_goal(b, z, prof, dark);
    if (g === 'idle') return null;
    if (g === 'shelter' || g === 'refuge') { key = g; goals = bt_goal_set(b, g); }
    else {
      const u = g === 'civs' ? b.civs[0] : b.men[0];
      if (!u) return null;
      const k = bt_idx(b, Math.floor(u.x), Math.floor(u.y)); key = 't' + k; goals = [k];
    }
  }
  if (!goals.length) return null;
  const f = bt_zfield(b, key, goals);
  let cur = [z.x, z.y];
  for (let i = 0; i < 2; i++) { const nx = bt_descend(b, f, cur[0], cur[1], 'z'); if (!nx) break; cur = [nx[0] + 0.5, nx[1] + 0.5]; }
  return cur[0] === z.x && cur[1] === z.y ? null : cur;
}
