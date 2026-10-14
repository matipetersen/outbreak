const OB = require('../dist/engine.js');
const assert = require('assert');
const t0 = Date.now();

function reach(g) {
  const lv = g.world.level, seen = new Uint8Array(lv.w * lv.h), q = [g.world.start[0] + g.world.start[1] * lv.w];
  seen[q[0]] = 1;
  for (let i = 0; i < q.length; i++) {
    const x = q[i] % lv.w, y = Math.floor(q[i] / lv.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (lv.walkable(nx, ny) && !seen[ny * lv.w + nx]) { seen[ny * lv.w + nx] = 1; q.push(ny * lv.w + nx); }
    }
  }
  return seen;
}
const mk = (era, seed, w = 200, h = 140) => OB.make_game({ era, seed, map_w: w, map_h: h, zombies: 'classic' });
const sig = (g) => g.world.level.actors.filter((a) => a.kind !== 'player').map((a) => `${a.uid}:${a.x},${a.y}:${a.kind}:${a.special || a.role}:${a.hp}`).sort().join('|');

// ---- 1. everything is reachable once the whole world is painted (every era, many seeds)
let doors = 0, bad = 0;
for (const era of Object.keys(OB.CONTENT.eras)) {
  for (let seed = 0; seed < 12; seed++) {
    const g = mk(era, seed);
    OB.generate_all(g);
    const seen = reach(g), lv = g.world.level;
    const kinds = new Set(Object.values(g.pois).map((p) => p.kind));
    for (const k of OB.POI_KINDS) assert(kinds.has(k), `${era} ${seed} missing ${k}`);
    for (const p of Object.values(g.pois)) {
      if (p.kind === 'breach') continue;
      doors++;
      if (!seen[p.x + p.y * lv.w]) bad++;
    }
    for (const c of g.world.camps) { doors++; if (!seen[c[0] + (c[1] + 1) * lv.w]) bad++; }
  }
}
console.log(`world: ${doors} doors and camps checked, ${bad} unreachable`);
assert.strictEqual(bad, 0);

// ---- 2. buildings never straddle a chunk, nor sit on a highway
{
  const g = mk('modern', 4, 360, 240), S = g.world.S;
  for (const p of Object.values(g.pois)) {
    if (p.kind === 'breach') continue;
    const [x, y, w, h] = p.box, cx = Math.floor(x / S), cy = Math.floor(y / S);
    assert(x > cx * S && x + w <= cx * S + S - 1 && y > cy * S && y + h + 1 <= cy * S + S, `${p.name} crosses a chunk`);
  }
}

// ---- 3. the world does not depend on the order chunks are painted, nor on when
{
  const a = mk('modern', 7), b = mk('modern', 7);
  const w = a.world, keys = [];
  for (let cy = 0; cy < w.ny; cy++) for (let cx = 0; cx < w.nx; cx++) keys.push([cx, cy]);
  OB.generate_all(a);
  for (const [cx, cy] of keys.slice().reverse()) OB.gen_chunk(b, cx, cy);
  assert.deepStrictEqual(Array.from(a.world.level.tiles), Array.from(b.world.level.tiles), 'tiles depend on generation order');
  assert.strictEqual(sig(a), sig(b), 'population depends on generation order');
  const c = mk('modern', 7); c.clock.turn += 5 * 240; c.player.level = 9;
  OB.generate_all(c);
  assert.strictEqual(sig(a), sig(c), 'population depends on when the chunk is painted');
  assert.strictEqual(JSON.stringify(a.pois), JSON.stringify(c.pois));
}

// ---- 4. lazy: only the neighbourhood is painted, more appears as you walk, and the save stays small
{
  const g = OB.make_game({ era: 'modern', seed: 5, map_w: 480, map_h: 320 });
  const total = g.world.nx * g.world.ny;
  assert(g.world.generated.size <= 16 && g.world.generated.size < total / 4, `painted ${g.world.generated.size} of ${total} at the start`);
  const small = OB.serialize_game(g).length;
  const lv = g.world.level, p = g.player;
  const before = g.world.generated.size;
  for (let i = 0; i < 90; i++) { g.player.hp = g.player.max_hp = 1e6; OB.teleport_test || 0; if (!g.move(1, 0)) g.move(0, 1); }
  // teleport far enough to need new chunks
  lv.occ.delete(lv.idx(p.x, p.y)); p.x = Math.min(lv.w - 20, p.x + 150); p.y = Math.min(lv.h - 20, p.y + 80); lv.occ.set(lv.idx(p.x, p.y), p);
  g.update_fov();
  assert(g.world.generated.size > before, 'walking did not paint new chunks');
  assert(lv.walkable(p.x, p.y) || lv.free_spot_near(p.x, p.y, 6), 'arrived in a wall');
  const json = OB.serialize_game(g);
  assert(json.length < 900 * 1024, `save is ${Math.round(json.length / 1024)} KiB`);
  const g2 = OB.deserialize_game(json);
  assert.strictEqual(g2.world.generated.size, g.world.generated.size);
  assert.deepStrictEqual(Array.from(g2.world.level.tiles), Array.from(g.world.level.tiles));
  // an unpainted chunk still paints identically after a load
  const a = OB.make_game({ era: 'modern', seed: 5, map_w: 480, map_h: 320 }); a.player.x = 0;
  const far = [g.world.nx - 1, g.world.ny - 1];
  OB.gen_chunk(g2, far[0], far[1]); OB.gen_chunk(a, far[0], far[1]);
  const S = g.world.S, rows = (gg) => { const out = []; for (let y = far[1] * S; y < Math.min(gg.world.level.h, far[1] * S + S); y++) for (let x = far[0] * S; x < Math.min(gg.world.level.w, far[0] * S + S); x++) out.push(gg.world.level.tiles[y * gg.world.level.w + x]); return out.join(','); };
  assert.strictEqual(rows(g2), rows(a));
  console.log(`world: ${total} chunks, ${before} painted at the start, start save ${Math.round(small / 1024)} KiB`);
}

// ---- 5. start time stays small however big the map
for (const [w, h] of [[360, 240], [600, 400]]) {
  const t = Date.now(); OB.make_game({ era: 'modern', seed: 3, map_w: w, map_h: h });
  const ms = Date.now() - t; console.log(`world: ${w}x${h} starts in ${ms} ms`);
  assert(ms < 1500, `${w}x${h} took ${ms} ms`);
}
console.log(`world: ${Date.now() - t0} ms total`);
