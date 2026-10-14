// ---------------------------------------------------------------- the world, planned whole and painted by chunks
// Planning is cheap and global: terrain is a pure function of (seed, x, y), so every building, camp and special site can be
// placed up front (the quest needs to know where things are). Painting is lazy: a 48x48 chunk is drawn the first time the
// player comes near, from a random stream derived from (seed, chunk) only, so the result never depends on the order in which
// chunks are visited. Every chunk owns its left column and top row as a highway, which makes the whole world connected.
const SIZES = { faith: [9, 7], industry: [13, 7], refuge: [13, 8], pad: [13, 8] };
const DEFAULT_SIZE = [11, 7];
const POI_ZONE = { medical: 2, market: 2, guard: 2, lab: 1, transit: 2, military: 0, faith: 1, industry: 0 };
const CELL_W = 9, CELL_H = 7;
const CHUNK = 48;
const CHUNK_UID_BASE = 1000000, CHUNK_UID_STRIDE = 600;

// ---- hashing and value noise (no arrays: any tile can be evaluated alone)
function hnoise(seed, a, b, salt) {
  let h = Math.imul((seed >>> 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((a | 0) + 0x7F4A7C15, 0xC2B2AE35) ^
          Math.imul((b | 0) + 0x165667B1, 0x27D4EB2F) ^ Math.imul((salt | 0) + 0x2545F491, 0x9E3779B1);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function chunk_rng(seed, cx, cy, salt) { return new RNG(Math.floor(hnoise(seed, cx, cy, salt) * 4294967296) || 1); }

function vnoise(seed, salt, x, y, scale, octaves = 3) {
  let amp = 1.0, total = 0.0, sum = 0.0;
  for (let o = 0; o < octaves; o++) {
    const s = Math.max(2, scale >> o), gx = Math.floor(x / s), gy = Math.floor(y / s);
    let fx = (x - gx * s) / s, fy = (y - gy * s) / s;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const sl = salt * 8 + o;
    const v00 = hnoise(seed, gx, gy, sl), v10 = hnoise(seed, gx + 1, gy, sl), v01 = hnoise(seed, gx, gy + 1, sl), v11 = hnoise(seed, gx + 1, gy + 1, sl);
    const top = v00 + (v10 - v00) * fx, bot = v01 + (v11 - v01) * fx;
    sum += (top + (bot - top) * fy) * amp;
    total += amp; amp *= 0.5;
  }
  return sum / total;
}

function _percentile(values, p) {
  const v = values.slice().sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}

function make_terrain(seed, w, h) {
  const elev = (x, y) => vnoise(seed, 1, x, y, 28), urb = (x, y) => vnoise(seed, 2, x, y, 34), wood = (x, y) => vnoise(seed, 3, x, y, 14);
  const E = [], U = [], W = [];
  for (let y = 0; y < h; y += 5) for (let x = 0; x < w; x += 5) { E.push(elev(x, y)); U.push(urb(x, y)); W.push(wood(x, y)); }
  const t = { elev, urb, wood, water_thr: _percentile(E, 0.11), shallow_thr: _percentile(E, 0.15), city_thr: _percentile(U, 0.72),
              sub_thr: _percentile(U, 0.46), wood_thr: _percentile(W, 0.55) };
  t.is_wet = (x, y) => elev(x, y) < t.shallow_thr;
  t.zone_at = (x, y) => { if (elev(x, y) < t.shallow_thr) return 0; const u = urb(x, y); return u >= t.city_thr ? 2 : u >= t.sub_thr ? 1 : 0; };
  return t;
}

// ---- planning
const chunk_key = (cx, cy) => `${cx},${cy}`;
function _chunk_of(world, x, y) { return [Math.floor(x / world.S), Math.floor(y / world.S)]; }

// The area (plus margin and the doorstep row) must lie inside one chunk, off its highway, and be dry.
function region_ok(world, x, y, w, h, margin = 1) {
  const lv = world.level, S = world.S, m = Math.max(margin, 1);
  const cx = Math.floor(x / S), cy = Math.floor(y / S);
  if (x - m < cx * S + 1 || x + w + m > cx * S + S || y - m < cy * S + 1 || y + h + m > cy * S + S) return false;
  if (x - margin < 1 || y - margin < 1 || x + w + margin >= lv.w - 1 || y + h + margin >= lv.h - 1) return false;
  for (let yy = y - margin; yy < y + h + margin; yy++) {
    for (let xx = x - margin; xx < x + w + margin; xx++) {
      if (world.claims[yy * lv.w + xx] || world.terrain.is_wet(xx, yy)) return false;
    }
  }
  return true;
}
function _claim(world, x, y, w, h, margin = 1) {
  const lv = world.level;
  for (let yy = y - margin; yy < y + h + margin; yy++) for (let xx = x - margin; xx < x + w + margin; xx++) if (lv.in_bounds(xx, yy)) world.claims[yy * lv.w + xx] = 1;
}
function _index(world, kind, item, x, y) {
  const [cx, cy] = _chunk_of(world, x, y), k = chunk_key(cx, cy);
  if (!world.by_chunk.has(k)) world.by_chunk.set(k, { pois: [], camps: [], breach: null });
  const e = world.by_chunk.get(k);
  if (kind === 'poi') e.pois.push(item); else if (kind === 'camp') e.camps.push(item); else e.breach = item;
}

function _poi(world, kind, name, door, box, danger = 1.0) {
  const pid = kind.slice(0, 3) + Object.keys(world.pois).length;
  const poi = new_poi(pid, kind, name, door[0], door[1], { box, floors: FLOORS[kind] || 1, danger });
  world.pois[pid] = poi;
  world.level.portals[world.level.idx(door[0], door[1])] = { target: poi_level_id(poi), pos: [-1, -1], label: name, arrive: 'entry' };
  _index(world, 'poi', poi, door[0], door[1]);
  return poi;
}

function _place_start(rng, world, era) {
  const lv = world.level, cx = Math.floor(lv.w / 2), cy = Math.floor(lv.h / 2);
  for (let n = 0; n < 2000; n++) {
    const spread = n < 400 ? [14, 9] : [30, 20];
    const x = cx + rng.randint(-spread[0], spread[0]), y = cy + rng.randint(-spread[1], spread[1]);
    if (region_ok(world, x - 4, y - 3, 9, 7, 1)) {
      _claim(world, x - 4, y - 3, 9, 7, 1);
      world.pois.breach = new_poi('breach', 'breach', era.breach, x, y, { box: [x - 4, y - 3, 9, 7], revealed: true, visited: true });
      _index(world, 'breach', { x, y }, x, y);
      return [x, y];
    }
  }
  throw new Error('could not place the start: the middle of the map is under water');
}

function _try_site(rng, world, kind, name, w, h, min_start, avoid, tries = 3000) {
  const lv = world.level;
  for (let attempt = 0; attempt < tries; attempt++) {
    const relax = 1.0 - 0.6 * attempt / tries;
    const x = rng.randint(3, lv.w - w - 3), y = rng.randint(3, lv.h - h - 4);
    const door = [x + Math.floor(w / 2), y + h - 1];
    if (cheb(door, world.start) < min_start * relax) continue;
    if (avoid.some((a) => cheb(door, poi_pos(a)) < 28 * relax)) continue;
    if (!region_ok(world, x, y, w, h, 2)) continue;
    _claim(world, x, y, w, h, 2);
    return _poi(world, kind, name, door, [x, y, w, h], 1.2);
  }
  throw new Error(`could not place ${kind}: map ${lv.w}x${lv.h} is too small or too wet`);
}

function _place_special_sites(rng, world, era) {
  const lv = world.level, far = Math.floor(Math.min(lv.w, lv.h * 1.6) * 0.42);
  const refuge = _try_site(rng, world, 'refuge', era.refuge, SIZES.refuge[0], SIZES.refuge[1], far, []);
  const pad_name = era.pad.startsWith('the ') ? era.pad.slice(4) : era.pad;
  _try_site(rng, world, 'pad', cap(pad_name), SIZES.pad[0], SIZES.pad[1], far, [refuge]);
  refuge.revealed = true;
}

function _try_poi(rng, world, era, kind, spacing, tries = 500, use_zone = true) {
  const [w, h] = SIZES[kind] || DEFAULT_SIZE, lv = world.level;
  for (let n = 0; n < tries; n++) {
    const x = rng.randint(3, lv.w - w - 3), y = rng.randint(3, lv.h - h - 4);
    const door = [x + Math.floor(w / 2), y + h - 1];
    if (use_zone && world.terrain.zone_at(x + Math.floor(w / 2), y + Math.floor(h / 2)) < POI_ZONE[kind] && rng.random() < 0.85) continue;
    if (cheb(door, world.start) < 12 || world.placed.some((p) => cheb(door, poi_pos(p)) < spacing)) continue;
    if (!region_ok(world, x, y, w, h, 1)) continue;
    _claim(world, x, y, w, h, 1);
    const names = era.pois[kind], count = world.placed.filter((p) => p.kind === kind).length;
    const name = names[count % names.length] + (count >= names.length ? ` ${Math.floor(count / names.length) + 1}` : '');
    world.placed.push(_poi(world, kind, name, door, [x, y, w, h], Math.round(rng.uniform(0.9, 1.5) * 100) / 100));
    return true;
  }
  return false;
}

function _place_pois(rng, world, era) {
  const lv = world.level;
  const copies = Math.max(2, Math.round(lv.w * lv.h / 4560));
  let kinds = [];
  for (let i = 0; i < copies; i++) kinds = kinds.concat(POI_KINDS);
  kinds = kinds.concat(rng.sample(POI_KINDS, 4));
  rng.shuffle(kinds);
  for (const kind of kinds) _try_poi(rng, world, era, kind, 14);
  const attempts = [[10, true], [6, true], [6, false], [3, false], [1, false]];
  for (const kind of POI_KINDS) {
    if (world.placed.some((p) => p.kind === kind)) continue;
    if (!attempts.some(([spacing, zone]) => _try_poi(rng, world, era, kind, spacing, 3000, zone))) throw new Error(`could not place a ${kind} building; map too small`);
  }
}

function _place_houses(rng, world, era) {
  const lv = world.level;
  let count = 0;
  for (let by = CELL_H; by < lv.h - CELL_H - 2; by += CELL_H) {
    for (let bx = CELL_W; bx < lv.w - CELL_W - 2; bx += CELL_W) {
      const z = world.terrain.zone_at(bx + 4, by + 3);
      const p_build = z === 2 ? 0.85 : z === 1 ? 0.5 : 0.06;
      if (rng.random() > p_build) continue;
      const w = rng.randint(4, 6), h = rng.randint(3, 4);
      const x = bx + 1 + rng.randint(0, 2), y = by + 1 + rng.randint(0, 1);
      if (!region_ok(world, x, y, w, h, 0)) continue;
      const door = [x + rng.randint(1, w - 2), y + h - 1];
      _claim(world, x, y, w, h, 0);
      _poi(world, 'house', era.houses[count % era.houses.length], door, [x, y, w, h], Math.round(rng.uniform(0.6, 1.1) * 100) / 100);
      count++;
    }
  }
}

// A few cave mouths, out in the woods and far from the start: small rock outcrops with a dark doorway.
const CAVE_NAMES = ['Cave', 'Old mine', 'Sinkhole', 'Quarry tunnel'], CAVE_SIZE = [4, 2];
function _wooded(world, x, y) {
  const T_ = world.terrain; let n = 0;
  for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3], [3, -3], [-3, 3]]) if (T_.wood(x + dx, y + dy) > T_.wood_thr) n++;
  return n;
}
function _place_caves(rng, world) {
  const lv = world.level, [w, h] = CAVE_SIZE, wanted = Math.min(8, Math.max(2, Math.floor(lv.w * lv.h / 5000)));
  const caves = () => Object.values(world.pois).filter((p) => p.kind === 'cave');
  for (let tries = 1; tries < 9000; tries++) {
    if (caves().length >= wanted) return;
    const x = rng.randint(9, lv.w - w - 10), y = rng.randint(9, lv.h - h - 11), door = [x + Math.floor(w / 2), y + h - 1];      // well off the rim: its lane runs to a highway
    const [near, spacing] = tries < 3000 ? [24, 12] : [16, 6];                  // a crowded small map relaxes the distances
    if (cheb(door, world.start) < near || Object.values(world.pois).some((p) => p.kind !== 'breach' && cheb(door, poi_pos(p)) < spacing)) continue;
    if (world.terrain.zone_at(x + 1, y + 1) !== 0 || !region_ok(world, x, y, w, h, 1)) continue;
    if (tries < 5000 && _wooded(world, x, y) < 5) continue;                      // prefer the woods; relax if the map has none left
    const n = caves().length;
    _claim(world, x, y, w, h, 1);
    _poi(world, 'cave', CAVE_NAMES[n % CAVE_NAMES.length] + (n >= CAVE_NAMES.length ? ` ${Math.floor(n / CAVE_NAMES.length) + 1}` : ''), door, [x, y, w, h], Math.round(rng.uniform(1.1, 1.6) * 100) / 100);
  }
}

function _place_camps(rng, world) {
  const lv = world.level, wanted = Math.max(3, Math.floor(lv.w * lv.h / 2600));
  for (let n = 0; n < 1500; n++) {
    if (world.camps.length >= wanted) break;
    const x = rng.randint(6, lv.w - 7), y = rng.randint(6, lv.h - 7);
    if (cheb([x, y], world.start) < 26 || world.camps.some((c) => cheb([x, y], c) < 22)) continue;
    if (!region_ok(world, x - 3, y - 2, 7, 5, 1)) continue;
    _claim(world, x - 3, y - 2, 7, 5, 1);
    world.camps.push([x, y]);
    _index(world, 'camp', [x, y], x, y);
  }
}

// Plan the whole world; nothing is painted yet. `seed` fixes everything.
function generate_overworld(seed, era, w, h) {
  seed = seed >>> 0;
  const level = new Level('world', era.terrain.urban, w, h, 'overworld', T.GRASS);
  const world = { level, pois: {}, start: [Math.floor(w / 2), Math.floor(h / 2)], camps: [], chunked: true, S: CHUNK,
                  nx: Math.ceil(w / CHUNK), ny: Math.ceil(h / CHUNK), generated: new Set(), by_chunk: new Map(), claims: new Uint8Array(w * h),
                  terrain: make_terrain(seed, w, h), placed: [], seed };
  const rng = new RNG(seed ^ 0x51ab);
  world.start = _place_start(rng, world, era);
  _place_special_sites(rng, world, era);
  _place_pois(rng, world, era);
  _place_houses(rng, world, era);
  _place_camps(rng, world);
  _place_caves(rng, world);
  delete world.claims; delete world.placed;
  return world;
}

// Rebuild the unsaved parts of a planned world (terrain functions, chunk index) around saved pois, camps and tiles.
function restore_world(seed, w, h, level, pois, start, camps, generated) {
  const S = CHUNK;
  const world = { level, pois, start, camps, chunked: true, S, nx: Math.ceil(w / S), ny: Math.ceil(h / S), generated: new Set(generated),
                  by_chunk: new Map(), terrain: make_terrain(seed >>> 0, w, h), seed: seed >>> 0 };
  for (const p of Object.values(pois)) { if (p.kind === 'breach') _index(world, 'breach', { x: p.x, y: p.y }, p.x, p.y); else _index(world, 'poi', p, p.x, p.y); }
  for (const c of camps) _index(world, 'camp', c, c[0], c[1]);
  return world;
}
const world_ready = (world, x, y) => !world.chunked || world.generated.has(chunk_key(Math.floor(x / world.S), Math.floor(y / world.S)));

// ---- painting one chunk (tiles only; population lives in chunks.js)
function _stamp_building(lv, poi) {
  const [x, y, w, h] = poi.box, door = [poi.x, poi.y];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) lv.set_tile(xx, yy, T.WALL);
  lv.set_tile(door[0], door[1], T.PORTAL);
  for (let dx = -1; dx <= 1; dx++) lv.set_tile(door[0] + dx, door[1] + 1, T.ROAD);
}

function _road_clipped(lv, a, b, rect) {
  let [x, y] = a;
  const horizontal_first = Math.abs(a[0] - b[0]) > Math.abs(a[1] - b[1]);
  const legs = horizontal_first ? [[b[0], y], [b[0], b[1]]] : [[x, b[1]], [b[0], b[1]]];
  for (const [tx, ty] of legs) {
    while (x !== tx || y !== ty) {
      x += (tx > x) - (tx < x); y += (ty > y) - (ty < y);
      if (x < rect[0] || x >= rect[2] || y < rect[1] || y >= rect[3]) continue;
      const t = lv.tile(x, y);
      if (t !== T.WALL && t !== T.PORTAL && t !== T.FENCE && t !== T.CAMPFIRE && t !== T.CRATE) lv.set_tile(x, y, T.ROAD);
    }
  }
}

function paint_chunk(world, era, cx, cy) {
  const lv = world.level, S = world.S, T_ = world.terrain, seed = world.seed;
  const x0 = cx * S, y0 = cy * S, x1 = Math.min(lv.w, x0 + S), y1 = Math.min(lv.h, y0 + S), rect = [x0, y0, x1, y1];
  const rng = chunk_rng(seed, cx, cy, 11);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * lv.w + x, e = T_.elev(x, y);
      let t = T.GRASS, z = 0;
      if (e < T_.water_thr) t = T.WATER;
      else if (e < T_.shallow_thr) t = T.SHALLOW;
      else {
        const u = T_.urb(x, y);
        z = u >= T_.city_thr ? 2 : u >= T_.sub_thr ? 1 : 0;
        if (z === 0 && T_.wood(x, y) > T_.wood_thr) { const roll = rng.random(); t = roll < 0.55 ? T.TREE : roll < 0.85 ? T.BRUSH : T.GRASS; }
        else if (z === 0 && rng.random() < 0.02) t = T.BRUSH;
      }
      if (z > 0 && t !== T.WATER && t !== T.SHALLOW) {              // city streets: an absolute grid, so it never depends on chunks
        const row_street = y % CELL_H === 0 && (z === 2 || Math.floor(y / CELL_H) % 2 === 0);
        const col_street = x % CELL_W === 0 && (z === 2 || Math.floor(x / CELL_W) % 2 === 0);
        if (row_street || col_street) t = T.ROAD;
      }
      if (x % S === 0 || y % S === 0) t = T.ROAD;                   // the chunk's own highway (a bridge over water)
      lv.tiles[i] = t;
    }
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (x === 0 || y === 0 || x === lv.w - 1 || y === lv.h - 1) lv.tiles[y * lv.w + x] = T.TREE;
  const entry = world.by_chunk.get(chunk_key(cx, cy)) || { pois: [], camps: [], breach: null };
  if (entry.breach) {
    const { x, y } = entry.breach;
    for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
      let t = (yy === y || xx === x) ? T.ROAD : T.GRASS;
      if (rng.random() < 0.08 && t === T.GRASS) t = T.RUBBLE;
      lv.set_tile(xx, yy, t);
    }
  }
  for (const [cx2, cy2] of entry.camps) {
    for (let yy = cy2 - 2; yy <= cy2 + 2; yy++) for (let xx = cx2 - 3; xx <= cx2 + 3; xx++) lv.set_tile(xx, yy, T.GRASS);
    lv.set_tile(cx2, cy2, T.CAMPFIRE); lv.set_tile(cx2 + 2, cy2 - 1, T.CRATE);
  }
  for (const poi of entry.pois) _stamp_building(lv, poi);
  // a lane from every real building and camp to the nearest highway, then carve what is still cut off
  const fronts = [];
  for (const poi of entry.pois) if (poi.kind !== 'house') fronts.push([poi.x, poi.y + 1]);
  for (const c of entry.camps) fronts.push([c[0], c[1] + 1]);
  for (const f of fronts) {
    const to_left = f[0] - x0, to_right = x0 + S - f[0], to_top = f[1] - y0, to_bottom = y0 + S - f[1];
    const m = Math.min(to_left, to_right, to_top, to_bottom);
    const target = m === to_left ? [x0, f[1]] : m === to_right ? [x0 + S, f[1]] : m === to_top ? [f[0], y0] : [f[0], y0 + S];
    _road_clipped(lv, f, target, rect);
  }
  for (const poi of entry.pois) lv.set_tile(poi.x, poi.y, T.PORTAL);
  _connect_chunk(world, cx, cy, entry, rect);
}

// In-chunk reachability from the highways (own left/top, and the neighbours' just past our right/bottom edge).
function _connect_chunk(world, cx, cy, entry, rect) {
  const lv = world.level, S = world.S, [x0, y0, x1, y1] = rect;
  const W = S + 1, idx = (x, y) => (y - y0) * W + (x - x0);
  const inside = (x, y) => x >= x0 && x <= x0 + S && y >= y0 && y <= y0 + S && x < lv.w - 0 && y < lv.h - 0;
  const walk = (x, y) => {
    if (x === x0 + S || y === y0 + S) return x < lv.w - 1 && y < lv.h - 1;       // the neighbour's highway
    return lv.walkable(x, y);
  };
  const sources = () => {
    const out = [];
    for (let i = 0; i <= S; i++) {
      for (const [x, y] of [[x0 + i, y0], [x0, y0 + i], [x0 + i, y0 + S], [x0 + S, y0 + i]]) if (inside(x, y) && walk(x, y) && (x >= x0 && y >= y0)) out.push([x, y]);
    }
    return out;
  };
  const reach_from = () => {
    const seen = new Uint8Array(W * W), q = [];
    for (const [x, y] of sources()) { const k = idx(x, y); if (!seen[k]) { seen[k] = 1; q.push([x, y]); } }
    for (let qi = 0; qi < q.length; qi++) {
      const [x, y] = q[qi];
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny) || seen[idx(nx, ny)] || !walk(nx, ny)) continue;
        seen[idx(nx, ny)] = 1; q.push([nx, ny]);
      }
    }
    return seen;
  };
  const targets = [];
  for (const p of entry.pois) targets.push([p.x, p.y + 1]);
  for (const c of entry.camps) targets.push([c[0], c[1] + 1]);
  if (entry.breach) targets.push([entry.breach.x, entry.breach.y]);
  let reach = reach_from();
  for (const t of targets) {
    if (!inside(t[0], t[1]) || reach[idx(t[0], t[1])]) continue;
    const parent = new Map([[idx(t[0], t[1]), null]]), q = [t];
    let hit = null;
    for (let qi = 0; qi < q.length && hit === null; qi++) {
      const [x, y] = q[qi];
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy, k = inside(nx, ny) ? idx(nx, ny) : -1;
        if (k < 0 || parent.has(k)) continue;
        const tt = (nx === x0 + S || ny === y0 + S) ? T.ROAD : lv.tile(nx, ny);
        if (tt === T.WALL || tt === T.PORTAL) continue;
        parent.set(k, idx(x, y));
        if (reach[k]) { hit = k; break; }
        q.push([nx, ny]);
      }
    }
    if (hit === null) continue;
    for (let node = hit; node !== null && node !== undefined; node = parent.get(node)) {
      const nx = x0 + (node % W), ny = y0 + Math.floor(node / W);
      if (nx < x1 && ny < y1 && !reach[node]) { const tt = lv.tile(nx, ny); if (tt !== T.CAMPFIRE && tt !== T.CRATE) lv.set_tile(nx, ny, T.ROAD); }
    }
    reach = reach_from();
  }
}
