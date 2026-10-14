// ---------------------------------------------------------------- building interiors
const HOUSE_SIZE = [9, 7];
const LEVEL_SIZE = [46, 28];
const CRATES_PER_ROOM = { medical: 1.0, market: 1.0, guard: 0.8, lab: 0.8, transit: 0.5, military: 1.0,
                          faith: 0.7, industry: 0.9 };

const _center = (r) => [r[0] + Math.floor(r[2] / 2), r[1] + Math.floor(r[3] / 2)];
const _inside = (r, x, y) => r[0] <= x && x < r[0] + r[2] && r[1] <= y && y < r[1] + r[3];
function _ring(r, x, y) {
  return ((x === r[0] - 1 || x === r[0] + r[2]) && r[1] - 1 <= y && y <= r[1] + r[3]) ||
         ((y === r[1] - 1 || y === r[1] + r[3]) && r[0] - 1 <= x && x <= r[0] + r[2]);
}
function _carve(level, r, tile = T.FLOOR) {
  for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) level.set_tile(x, y, tile);
}
function _overlaps(a, b, margin = 2) {
  return !(a[0] + a[2] + margin <= b[0] || b[0] + b[2] + margin <= a[0] ||
           a[1] + a[3] + margin <= b[1] || b[1] + b[3] + margin <= a[1]);
}
function min_by(arr, fn) { let best = null, bv = Infinity; for (const x of arr) { const v = fn(x); if (v < bv) { bv = v; best = x; } } return best; }
function max_by(arr, fn) { let best = null, bv = -Infinity; for (const x of arr) { const v = fn(x); if (v > bv) { bv = v; best = x; } } return best; }

function _corridor(level, a, b, rng) {
  let [x, y] = a;
  const opened = [];
  const legs = rng.random() < 0.5 ? [[b[0], y], b] : [[x, b[1]], b];
  for (const [tx, ty] of legs) {
    while (x !== tx || y !== ty) {
      x += (tx > x) - (tx < x);
      y += (ty > y) - (ty < y);
      if (level.tile(x, y) === T.WALL) { level.set_tile(x, y, T.FLOOR); opened.push([x, y]); }
    }
  }
  return opened;
}

function _place_rooms(rng, w, h, count) {
  const rooms = [], mine = [];
  for (let n = 0; n < 400; n++) {
    if (mine.length >= count) break;
    const rw = rng.randint(5, 10), rh = rng.randint(4, 7);
    const r = [rng.randint(2, w - rw - 3), rng.randint(2, h - rh - 3), rw, rh];
    if (rooms.some((o) => _overlaps(r, o))) continue;
    rooms.push(r); mine.push(r);
  }
  return mine;
}

function _door_pass(level, rooms, rng, p = 0.55) {
  for (const r of rooms) {
    for (let y = r[1] - 1; y < r[1] + r[3] + 1; y++) {
      for (let x = r[0] - 1; x < r[0] + r[2] + 1; x++) {
        if (!_ring(r, x, y) || level.tile(x, y) !== T.FLOOR) continue;
        const horizontal = level.tile(x - 1, y) === T.WALL && level.tile(x + 1, y) === T.WALL;
        const vertical = level.tile(x, y - 1) === T.WALL && level.tile(x, y + 1) === T.WALL;
        if ((horizontal || vertical) && rng.random() < p) level.set_tile(x, y, T.DOOR);
      }
    }
  }
}

function _near_opening(level, x, y) {
  for (const [dx, dy] of DIRS4) {
    const t = level.tile(x + dx, y + dy);
    if (t === T.DOOR || t === T.LOCKED || t === T.STAIRS_UP || t === T.STAIRS_DOWN || t === T.PORTAL) return true;
  }
  return false;
}

function _crate_spots(level, room) {
  const spots = [];
  for (let y = room[1]; y < room[1] + room[3]; y++) {
    for (let x = room[0]; x < room[0] + room[2]; x++) {
      if (level.tile(x, y) !== T.FLOOR || _near_opening(level, x, y)) continue;
      const walls = DIRS4.filter(([dx, dy]) => level.tile(x + dx, y + dy) === T.WALL).length;
      if (walls >= 1 && DIRS4.every(([dx, dy]) => level.tile(x + dx, y + dy) !== T.FLOOR || _inside(room, x + dx, y + dy))) {
        spots.push([x, y]);
      }
    }
  }
  return spots;
}

function _stock_crates(level, rng, ctx, kind, rooms, per_room, taken, docs) {
  const placed = [];
  for (const room of rooms) {
    const spots = _crate_spots(level, room).filter((s) => !taken.has(level.idx(s[0], s[1])));
    rng.shuffle(spots);
    const n = Math.floor(per_room) + (rng.random() < per_room - Math.floor(per_room) ? 1 : 0);
    for (const pos of spots.slice(0, n)) {
      if (placed.some((q) => cheb(pos, q) < 2)) continue;
      level.set_tile(pos[0], pos[1], T.CRATE);
      level.containers[level.idx(pos[0], pos[1])] = {
        loot: roll_items(rng, ctx.era, kind, rng.uniform(1.5, 3.2), ctx.loot_mult), docs: [],
        coins: roll_coins(rng, ctx.loot_mult), opened: false, note: '' };
      placed.push(pos);
    }
  }
  const crates = placed.filter((p) => !level.containers[level.idx(p[0], p[1])].note);
  rng.shuffle(crates);
  for (let i = 0; i < Math.min(docs.length, crates.length); i++) level.containers[level.idx(crates[i][0], crates[i][1])].docs.push(docs[i]);
  return placed;
}

function _place_loose_docs(level, docs) {
  const stocked = new Set();
  for (const c of Object.values(level.containers)) for (const d of c.docs) stocked.add(d);
  for (const doc_id of docs) {
    if (stocked.has(doc_id)) continue;
    const spot = level.free_spot_near(level.entry[0], level.entry[1], 5);
    if (spot) { const k = level.idx(spot[0], spot[1]); (level.docs[k] || (level.docs[k] = [])).push(doc_id); }
  }
}

function _scatter_zombies(level, rng, ctx, rooms, danger, per_room, skip = null) {
  for (const room of rooms) {
    if (skip && room === skip) continue;
    const expected = per_room * danger * ctx.zombie_mult * ctx.profile.density;
    const n = Math.floor(expected) + (rng.random() < expected - Math.floor(expected) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = rng.randint(room[0], room[0] + room[2] - 1), y = rng.randint(room[1], room[1] + room[3] - 1);
      if (level.free(x, y) && level.tile(x, y) === T.FLOOR) ctx.spawn(level, [x, y], null, true);
    }
  }
}

function _spore_patches(level, rng, ctx, rooms, p) {
  if (ctx.profile.vector !== 'spore') return;
  for (const room of rooms) {
    if (rng.random() > p) continue;
    const [cx, cy] = _center(room);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (level.tile(cx + dx, cy + dy) === T.FLOOR && rng.random() < 0.7) {
        level.hazards[level.idx(cx + dx, cy + dy)] = { kind: 'spore', ttl: 1e9 };
      }
    }
  }
}

function generate_house(rng, poi, ctx, docs) {
  const [w, h] = HOUSE_SIZE;
  const level = new Level(poi_level_id(poi), poi.name, w + 4, h + 4, 'interior');
  const room = [2, 2, w, h];
  _carve(level, room);
  if (rng.random() < 0.6) {
    const wx = rng.randint(room[0] + 3, room[0] + w - 4);
    for (let y = room[1]; y < room[1] + h; y++) level.set_tile(wx, y, T.WALL);
    level.set_tile(wx, room[1] + rng.randint(1, h - 2), T.DOOR);
  }
  const ex = 2 + Math.floor(w / 2), ey = 2 + h - 1;
  level.set_tile(ex, ey, T.PORTAL);
  level.portals[level.idx(ex, ey)] = { target: 'world', pos: poi_pos(poi), label: 'outside', arrive: 'entry' };
  level.entry = [ex, ey - 1];
  level.arrivals.entry = level.entry;
  const sub = [room];
  _stock_crates(level, rng, ctx, 'house', sub, rng.uniform(1.5, 2.6), new Set([level.idx(level.entry[0], level.entry[1])]), docs);
  _place_loose_docs(level, docs);
  _scatter_zombies(level, rng, ctx, sub, poi.danger, 1.1);
  const occ = level.occ.get(level.idx(level.entry[0], level.entry[1]));
  if (occ) level.remove_actor(occ);
  return level;
}

function generate_floor(rng, poi, floor, ctx, docs) {
  const [w, h] = LEVEL_SIZE;
  const last = floor === poi.floors - 1;
  const level = new Level(`${poi.id}:${floor}`, `${poi.name} - floor ${floor + 1}`, w, h, 'interior');
  const n_rooms = rng.randint(7, 10);
  let rooms = _place_rooms(rng, w, h, n_rooms + (last && poi.component ? 1 : 0));
  if (rooms.length < 4) rooms = _place_rooms(rng, w, h, n_rooms);
  let vault = null;
  if (last && poi.component && rooms.length >= 5) {
    vault = min_by(rooms.slice(1), (r) => r[2] * r[3]);
    rooms = rooms.filter((r) => r !== vault);
  }
  for (const r of rooms) _carve(level, r);
  const connected = [rooms[0]];
  const rest = rooms.slice(1);
  while (rest.length) {
    let best = null, bd = Infinity;
    for (const a of connected) for (const b of rest) {
      const d = cheb(_center(a), _center(b));
      if (d < bd) { bd = d; best = [a, b]; }
    }
    _corridor(level, _center(best[0]), _center(best[1]), rng);
    connected.push(best[1]);
    rest.splice(rest.indexOf(best[1]), 1);
  }
  for (let i = 0; i < 2; i++) {
    const [a, b] = rng.sample(rooms, 2);
    _corridor(level, _center(a), _center(b), rng);
  }
  let vault_pos = null;
  if (vault) {
    _carve(level, vault);
    const nearest = min_by(rooms, (r) => cheb(_center(r), _center(vault)));
    const opened = _corridor(level, _center(nearest), _center(vault), rng);
    for (const p of opened) {
      if (_ring(vault, p[0], p[1])) { level.set_tile(p[0], p[1], T.LOCKED); vault_pos = p; break; }
    }
    if (!vault_pos) {
      for (let y = vault[1] - 1; y < vault[1] + vault[3] + 1; y++) {
        for (let x = vault[0] - 1; x < vault[0] + vault[2] + 1; x++) {
          if (!vault_pos && _ring(vault, x, y) && level.tile(x, y) === T.FLOOR) {
            level.set_tile(x, y, T.LOCKED); vault_pos = [x, y];
          }
        }
      }
    }
  }
  _door_pass(level, rooms, rng);

  const bottom = max_by(rooms, (r) => r[1] + r[3]);
  const far = max_by(rooms, (r) => cheb(_center(r), _center(bottom)));
  let up_room;
  if (floor === 0) {
    const ex = bottom[0] + Math.floor(bottom[2] / 2), ey = bottom[1] + bottom[3] - 1;
    level.set_tile(ex, ey, T.PORTAL);
    level.portals[level.idx(ex, ey)] = { target: 'world', pos: poi_pos(poi), label: 'outside', arrive: 'entry' };
    level.entry = [ex, ey - 1];
    level.arrivals.entry = level.entry;
    up_room = bottom;
  } else {
    const [ux, uy] = _center(bottom);
    level.set_tile(ux, uy, T.STAIRS_UP);
    level.portals[level.idx(ux, uy)] = { target: `${poi.id}:${floor - 1}`, pos: UNSET, label: 'up', arrive: 'from_below' };
    level.arrivals.from_above = level.walkable(ux + 1, uy) ? [ux + 1, uy] : [ux, uy + 1];
    level.entry = level.arrivals.from_above;
    up_room = bottom;
  }
  if (!last) {
    const dr = far !== up_room ? far : rooms[rooms.length - 1];
    const [dx, dy] = _center(dr);
    level.set_tile(dx, dy, T.STAIRS_DOWN);
    level.portals[level.idx(dx, dy)] = { target: `${poi.id}:${floor + 1}`, pos: UNSET, label: 'down', arrive: 'from_above' };
    level.arrivals.from_below = level.walkable(dx + 1, dy) ? [dx + 1, dy] : [dx, dy + 1];
  }
  for (const key of Object.keys(level.arrivals)) {
    const pos = level.arrivals[key];
    if (!level.walkable(pos[0], pos[1])) level.arrivals[key] = level.free_spot_near(pos[0], pos[1], 3) || pos;
  }
  level.entry = level.arrivals.entry || level.arrivals.from_above || level.entry;

  const reserved = new Set(Object.values(level.arrivals).map((p) => level.idx(p[0], p[1])));
  _stock_crates(level, rng, ctx, poi.kind, rooms, CRATES_PER_ROOM[poi.kind] === undefined ? 0.8 : CRATES_PER_ROOM[poi.kind], reserved, docs);
  _place_loose_docs(level, docs);
  const hall = max_by(rooms, (r) => r[2] * r[3]);
  _scatter_zombies(level, rng, ctx, rooms, poi.danger * (1.0 + 0.25 * floor), 1.0, floor === 0 ? up_room : null);
  if (poi.kind === 'faith') {
    const n = rng.randint(3, 6);
    for (let i = 0; i < n; i++) ctx.spawn(level, _center(hall), null, true);
  }
  _spore_patches(level, rng, ctx, rooms, ['lab', 'medical', 'transit', 'industry'].includes(poi.kind) ? 0.4 : 0.1);
  if (vault) _fill_vault(level, rng, ctx, poi, vault, vault_pos);
  for (const z of level.actors.slice()) {
    if (reserved.has(level.idx(z.x, z.y)) || cheb([z.x, z.y], level.entry) < 2) level.remove_actor(z);
  }
  return level;
}

function _fill_vault(level, rng, ctx, poi, vault, lock) {
  const [cx, cy] = _center(vault);
  level.set_tile(cx, cy, T.CRATE);
  level.containers[level.idx(cx, cy)] = { loot: roll_items(rng, ctx.era, poi.kind, 2.5, ctx.loot_mult), docs: [],
                                          coins: 0, opened: false, note: 'vault' };
  const guards = 2 + (poi.danger > 1.2 ? 1 : 0);
  for (let i = 0; i < guards; i++) {
    const x = rng.randint(vault[0], vault[0] + vault[2] - 1), y = rng.randint(vault[1], vault[1] + vault[3] - 1);
    if (level.free(x, y) && !(x === cx && y === cy)) ctx.spawn(level, [x, y], rng.random() < 0.4 ? 'brute' : null, true);
  }
  level.vault_lock = lock;
}

function generate_haven(rng, poi, ctx) {
  const w = 30, h = 16;
  const level = new Level(poi_level_id(poi), poi.name, w, h, 'haven');
  level.safe = true;
  const hall = [2, 2, w - 4, h - 4];
  _carve(level, hall);
  const ex = Math.floor(w / 2), ey = hall[1] + hall[3];
  level.set_tile(ex, ey, T.PORTAL);
  level.portals[level.idx(ex, ey)] = { target: 'world', pos: poi_pos(poi), label: 'outside', arrive: 'entry' };
  level.entry = [ex, ey - 1];
  level.arrivals.entry = level.entry;
  for (const [x, y] of [[hall[0] - 1, hall[1] + Math.floor(hall[3] / 2)], [hall[0] + hall[2], hall[1] + Math.floor(hall[3] / 2)], [Math.floor(w / 2), hall[1] - 1]]) level.set_tile(x, y, T.DOOR);  // side doors: where a siege breaks in
  for (let i = 0; i < 3; i++) level.set_tile(hall[0] + 1 + 2 * i, hall[1], T.BED);
  level.bench = [hall[0] + hall[2] - 3, hall[1] + 1];
  level.set_tile(level.bench[0], level.bench[1], T.BENCH);
  for (const [x, y] of [[hall[0] + hall[2] - 1, hall[1] + hall[3] - 1], [hall[0], hall[1] + hall[3] - 1]]) {
    level.set_tile(x, y, T.CRATE);
    level.containers[level.idx(x, y)] = { loot: roll_items(rng, ctx.era, 'refuge', 2, ctx.loot_mult), docs: [],
                                          coins: 0, opened: false, note: '' };
  }
  return level;
}

// ---- caves: a dark system of chambers, nests of the dormant dead, rich crates, mushrooms, spore beds
const CAVE_LEVEL_SIZE = [44, 30];
function _cave_floor(rng, w, h) {
  for (let attempt = 0; attempt < 12; attempt++) {
    let floor = new Set();
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (rng.random() < 0.47) floor.add(y * w + x);
    for (let it = 0; it < 4; it++) {
      const nxt = new Set();
      for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && floor.has((y + dy) * w + x + dx)) n++;
        if (n >= 4) nxt.add(y * w + x);
      }
      floor = nxt;
    }
    let best = [];
    const seen = new Set();
    for (const s of floor) {
      if (seen.has(s)) continue;
      const comp = [s], stack = [s]; seen.add(s);
      while (stack.length) {
        const c = stack.pop(), cx = c % w, cy = Math.floor(c / w);
        for (const [dx, dy] of DIRS4) { const q = (cy + dy) * w + cx + dx; if (floor.has(q) && !seen.has(q)) { seen.add(q); comp.push(q); stack.push(q); } }
      }
      if (comp.length > best.length) best = comp;
    }
    if (best.length >= 330) return best.map((i) => [i % w, Math.floor(i / w)]);
  }
  const plain = []; for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) plain.push([x, y]);
  return plain;
}

function generate_cave(rng, poi, ctx) {
  const [w, h] = CAVE_LEVEL_SIZE, level = new Level(poi_level_id(poi), poi.name, w, h, 'interior');
  const cells = _cave_floor(rng, w, h), floor = new Set(cells.map(([x, y]) => y * w + x));
  for (const [x, y] of cells) level.set_tile(x, y, T.FLOOR);
  const [ex, ey] = max_by(cells, ([x, y]) => y * 1000 - Math.abs(x - w / 2));
  const door = [ex, ey + 1];
  level.set_tile(door[0], door[1], T.PORTAL);
  level.portals[level.idx(door[0], door[1])] = { target: 'world', pos: poi_pos(poi), label: 'outside', arrive: 'entry' };
  level.entry = [ex, ey]; level.arrivals.entry = level.entry;
  const far = rng.shuffle(cells.filter((c) => cheb(c, level.entry) >= 9));
  const nests = Math.max(2, Math.round(3 * poi.danger * ctx.zombie_mult * ctx.profile.density));
  for (let i = 0; i < nests && far.length; i++) {
    const [cx, cy] = far.pop();
    for (let m = rng.randint(2, 4); m > 0; m--) {
      const spot = level.free_spot_near(cx, cy, 2);
      if (spot && floor.has(spot[1] * w + spot[0])) ctx.spawn(level, spot, null, true);
    }
  }
  let crates = 0;
  const placed = [];
  for (const pos of far.slice().sort((a, b) => cheb(b, level.entry) - cheb(a, level.entry)).slice(0, 90)) {
    if (crates >= 7) break;
    const walls = DIRS4.filter(([dx, dy]) => !floor.has((pos[1] + dy) * w + pos[0] + dx)).length;
    if (walls >= 2 && level.free(pos[0], pos[1]) && placed.every((c) => cheb(pos, c) >= 5)) {
      level.set_tile(pos[0], pos[1], T.CRATE);
      level.containers[level.idx(pos[0], pos[1])] = { loot: roll_items(rng, ctx.era, 'cave', rng.uniform(3.0, 4.6), ctx.loot_mult), docs: [], coins: roll_coins(rng, ctx.loot_mult), opened: false, note: '' };
      placed.push(pos); crates++;
    }
  }
  for (const pos of rng.sample(cells, Math.min(cells.length, 7))) {
    if (!(pos[0] === level.entry[0] && pos[1] === level.entry[1]) && !level.containers[level.idx(pos[0], pos[1])]) level.drop(pos, make_item('mushroom', rng.randint(1, 2)));
  }
  if (ctx.profile.vector === 'spore') {
    for (let i = 0; i < 3; i++) {
      const [cx, cy] = rng.choice(cells);
      if (cheb([cx, cy], level.entry) < 8) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (floor.has((cy + dy) * w + cx + dx) && rng.random() < 0.7) level.hazards[level.idx(cx + dx, cy + dy)] = { kind: 'spore', ttl: 1e9 };
    }
  }
  const occ = level.occ.get(level.idx(level.entry[0], level.entry[1]));
  if (occ) level.remove_actor(occ);
  return level;
}

function generate_interior(poi, floor, seed, ctx, docs) {
  const rng = new RNG(`${seed}:${poi.id}:${floor}`);
  if (poi.kind === 'cave') return generate_cave(rng, poi, ctx);
  if (poi.kind === 'refuge' || poi.kind === 'pad') return generate_haven(rng, poi, ctx);
  if (poi.kind === 'house') return generate_house(rng, poi, ctx, docs);
  return generate_floor(rng, poi, floor, ctx, docs);
}
