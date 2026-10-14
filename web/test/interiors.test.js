const OB = require('../dist/engine.js');
const assert = require('assert');
let n = 0;
function reachable(lv, start) {
  const seen = new Set([lv.idx(start[0], start[1])]), q = [start];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, k = lv.idx(nx, ny);
      if (lv.in_bounds(nx, ny) && lv.walkable(nx, ny) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}
let id = 0;
const spawn = (level, pos) => { const z = { kind: 'zombie', x: pos[0], y: pos[1], hp: 10, flags: [] }; level.add_actor(z); return z; };
for (const era of Object.values(OB.CONTENT.eras)) {
  const ctx = { era, profile: OB.CONTENT.presets.spore, loot_mult: 1, zombie_mult: 1, spawn, day: 1 };
  for (let seed = 0; seed < 12; seed++) {
    for (const kind of OB.POI_KINDS.concat(['house', 'refuge', 'pad'])) {
      const poi = { id: 'p' + seed, kind, name: 'X', x: 5, y: 5, floors: OB.FLOORS[kind], danger: 1, component: OB.POI_KINDS.includes(kind) ? 'sample' : '', docs: [] };
      for (let f = 0; f < poi.floors; f++) {
        const lv = OB.generate_interior(poi, f, seed, ctx, ['d1', 'd2', 'd3']);
        n++;
        const seen = reachable(lv, lv.entry);
        for (const [k, c] of Object.entries(lv.containers)) {
          if (c.note === 'vault') continue;
          const x = k % lv.w, y = Math.floor(k / lv.w);
          assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => seen.has(lv.idx(x + dx, y + dy))), `crate unreachable ${era.id} ${kind} ${seed} ${f}`);
        }
        for (const k of Object.keys(lv.portals)) {
          const x = k % lv.w, y = Math.floor(k / lv.w);
          assert(seen.has(+k) || [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => seen.has(lv.idx(x + dx, y + dy))), 'portal unreachable');
        }
        if (kind === 'house') {
          const placed = Object.values(lv.containers).flatMap((c) => c.docs).concat(Object.values(lv.docs).flat());
          assert.deepStrictEqual(placed.sort(), ['d1', 'd2', 'd3'], 'docs lost');
        }
      }
    }
  }
}
console.log(`interiors: ${n} levels OK`);
