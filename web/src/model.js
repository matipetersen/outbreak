// ---------------------------------------------------------------- tiles, items, levels
const T = {
  FLOOR: 0, GRASS: 1, ROAD: 2, BRUSH: 3, TREE: 4, WATER: 5, SHALLOW: 6, RUBBLE: 7, WALL: 8, DOOR: 9,
  DOOR_OPEN: 10, LOCKED: 11, STAIRS_UP: 12, STAIRS_DOWN: 13, CRATE: 14, CRATE_OPEN: 15, PORTAL: 16,
  FENCE: 17, BED: 18, BENCH: 19, CAMPFIRE: 20, WORKSHOP: 21, LOCKER: 22,
};
const TILES = [];
function _tile(id, glyph, walk, opaque, name, color, masks_scent) {
  TILES[id] = { glyph, walk, opaque, name, color, masks_scent: !!masks_scent };
}
_tile(T.FLOOR, '.', true, false, 'floor', 'grey');
_tile(T.GRASS, ',', true, false, 'grass', 'green');
_tile(T.ROAD, ':', true, false, 'road', 'grey');
_tile(T.BRUSH, '"', true, true, 'thick brush', 'green');
_tile(T.TREE, 'T', false, true, 'tree', 'green');
_tile(T.WATER, '~', false, false, 'deep water', 'blue');
_tile(T.SHALLOW, '-', true, false, 'shallows', 'cyan', true);
_tile(T.RUBBLE, '%', false, false, 'rubble', 'grey');
_tile(T.WALL, '#', false, true, 'wall', 'white');
_tile(T.DOOR, '+', true, true, 'closed door', 'yellow');
_tile(T.DOOR_OPEN, "'", true, false, 'open door', 'yellow');
_tile(T.LOCKED, '+', false, true, 'locked door', 'red');
_tile(T.STAIRS_UP, '<', true, false, 'stairs up', 'white');
_tile(T.STAIRS_DOWN, '>', true, false, 'stairs down', 'white');
_tile(T.CRATE, '&', false, false, 'crate', 'yellow');
_tile(T.CRATE_OPEN, 'o', false, false, 'empty crate', 'grey');
_tile(T.PORTAL, 'H', true, false, 'entrance', 'white');
_tile(T.FENCE, '=', false, false, 'fence', 'grey');
_tile(T.BED, 'b', false, false, 'bed', 'cyan');
_tile(T.BENCH, 'w', false, false, 'workbench', 'cyan');
_tile(T.CAMPFIRE, '*', false, false, 'campfire', 'red');
_tile(T.WORKSHOP, 'W', false, false, 'workshop', 'cyan');
_tile(T.LOCKER, 'L', false, false, 'locker', 'yellow');
const tile_info = (t) => TILES[t];
const WALK = new Uint8Array(256), OPAQUE = new Uint8Array(256);
TILES.forEach((t, i) => { WALK[i] = t.walk ? 1 : 0; OPAQUE[i] = t.opaque ? 1 : 0; });
const NO_ENTRY = new Set([T.PORTAL, T.STAIRS_UP, T.STAIRS_DOWN]);     // for the dead and for humans
const UNSET = [-1, -1];

// ---------------------------------------------------------------- items and content lookups
const make_item = (id, qty = 1, dur = null, key = false) => ({ id, qty, dur, key });

function era_vocabulary(era) {
  const slots = ['sickness', 'cure', 'dead', 'place', 'guard', 'leader', 'sample', 'escape', 'signal', 'warning'];
  const seen = [];
  for (const s of slots) for (const w of era.lexicon[s]) if (!seen.includes(w)) seen.push(w);
  return seen;
}

const POI_KINDS = ['medical', 'market', 'guard', 'lab', 'transit', 'military', 'faith', 'industry'];
const FLOORS = { medical: 3, market: 2, guard: 2, lab: 3, transit: 3, military: 3, faith: 2, industry: 2,
                 refuge: 1, pad: 1, house: 1 };
const poi_level_id = (poi) => poi.id + ':0';
const poi_pos = (poi) => [poi.x, poi.y];

function new_poi(id, kind, name, x, y, extra) {
  return Object.assign({ id, kind, name, x, y, box: [0, 0, 0, 0], floors: 1, danger: 1.0, revealed: false,
                         lead: false, visited: false, component: '', docs: [], code_known: false, done: false }, extra || {});
}

// ---------------------------------------------------------------- level
// Position-keyed tables (items, containers, portals ...) are plain objects keyed by y*w+x so a Level
// serialises as JSON.  `occ` (who stands where) is derived and rebuilt on load.
class Level {
  constructor(id, name, w, h, kind = 'interior', fill = T.WALL) {
    this.id = id; this.name = name; this.w = w; this.h = h; this.kind = kind;
    this.tiles = new Uint8Array(w * h).fill(fill);
    this.seen = new Uint8Array(w * h);
    this.actors = [];
    this.occ = new Map();
    this.items = {}; this.containers = {}; this.portals = {}; this.corpses = {}; this.hazards = {};
    this.door_hp = {}; this.docs = {}; this.built = {}; this.stash = [];
    this.entry = [1, 1];
    this.arrivals = {};
    this.vault_lock = null;
    this.bench = null;
    this.dark = kind !== 'overworld';
    this.safe = false;
    this.poi_id = '';
  }
  idx(x, y) { return y * this.w + x; }
  in_bounds(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }
  tile(x, y) { return (x >= 0 && x < this.w && y >= 0 && y < this.h) ? this.tiles[y * this.w + x] : T.WALL; }
  set_tile(x, y, t) { if (this.in_bounds(x, y)) this.tiles[y * this.w + x] = t; }
  walkable(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h && WALK[this.tiles[y * this.w + x]] === 1; }
  opaque(x, y) { return !(x >= 0 && x < this.w && y >= 0 && y < this.h) || OPAQUE[this.tiles[y * this.w + x]] === 1; }
  free(x, y) { return this.walkable(x, y) && !this.occ.has(y * this.w + x); }
  add_actor(a) { a.level_id = this.id; this.actors.push(a); this.occ.set(this.idx(a.x, a.y), a); }
  remove_actor(a) {
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
    const k = this.idx(a.x, a.y);
    if (this.occ.get(k) === a) this.occ.delete(k);
  }
  move_actor(a, x, y) {
    const k = this.idx(a.x, a.y);
    if (this.occ.get(k) === a) this.occ.delete(k);
    const dx = x - a.x, dy = y - a.y;
    if (dx || dy) a.facing = [Math.sign(dx), Math.sign(dy)];
    a.x = x; a.y = y;
    this.occ.set(this.idx(x, y), a);
  }
  actor_at(x, y) { return this.occ.get(this.idx(x, y)) || null; }
  drop(pos, item) {
    const k = this.idx(pos[0], pos[1]);
    const stack = this.items[k] || (this.items[k] = []);
    const proto = stack.find((i) => i.id === item.id && i.dur === item.dur);
    if (proto && item.dur === null) proto.qty += item.qty; else stack.push(item);
  }
  free_spot_near(x, y, radius = 4, avoid = null) {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx, py = y + dy;
          if (this.free(px, py) && !(avoid && avoid.has(this.idx(px, py)))) {
            const t = this.tile(px, py);
            if (t !== T.PORTAL && t !== T.STAIRS_UP && t !== T.STAIRS_DOWN) return [px, py];
          }
        }
      }
    }
    return null;
  }
  rebuild_occ() {
    this.occ = new Map();
    for (const a of this.actors) this.occ.set(this.idx(a.x, a.y), a);
  }
}

// ---------------------------------------------------------------- field of view
function visible_tiles(level, origin, radius) {
  const [ox, oy] = origin;
  const seen = new Set([level.idx(ox, oy)]);
  const r2 = radius * radius + radius;
  const targets = [];
  for (let i = -radius; i <= radius; i++) {
    targets.push([ox + i, oy - radius], [ox + i, oy + radius], [ox - radius, oy + i], [ox + radius, oy + i]);
  }
  for (const t of targets) {
    for (const [x, y] of line(origin, t)) {
      if ((x - ox) ** 2 + (y - oy) ** 2 > r2 || !level.in_bounds(x, y)) break;
      seen.add(level.idx(x, y));
      if (level.opaque(x, y)) break;
    }
  }
  return seen;
}

function has_los(level, a, b) {
  for (const p of line(a, b)) {
    if (p[0] === b[0] && p[1] === b[1]) return true;
    if (level.opaque(p[0], p[1])) return false;
  }
  return true;
}
