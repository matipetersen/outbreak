const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

const caves = (g) => Object.values(g.pois).filter((p) => p.kind === 'cave');
{ // caves exist far from the start, with a doorway on the overworld
  for (const seed of [3, 4, 5]) {
    const g = make({ seed }); const cs = caves(g); assert(cs.length >= 1, `seed ${seed}`);
    OB.generate_all(g);
    for (const c of cs) {
      assert(Math.max(Math.abs(c.x - g.world.start[0]), Math.abs(c.y - g.world.start[1])) >= 16);
      const lv = g.world.level; assert.strictEqual(lv.tile(c.x, c.y), OB.T.PORTAL); assert.strictEqual(lv.portals[lv.idx(c.x, c.y)].target, `${c.id}:0`);
    }
  }
}
{ // a cave is one connected system with a way out, nests of the dormant, crates and mushrooms; not a host
  const g = make({ seed: 3 }); const c = caves(g)[0], lv = g.ensure_level(`${c.id}:0`);
  const floor = new Set(); for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (lv.tile(x, y) === OB.T.FLOOR) floor.add(y * lv.w + x);
  assert(floor.size >= 330);
  const seen = new Set([lv.idx(lv.entry[0], lv.entry[1])]), q = [lv.entry];
  while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (y + dy) * lv.w + x + dx; if (floor.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); } } }
  assert.strictEqual(seen.size, floor.size);
  const exits = Object.entries(lv.portals).filter(([, v]) => v.target === 'world'); assert.strictEqual(exits.length, 1);
  const dead = lv.actors.filter((a) => a.kind === 'zombie'); assert(dead.length >= 4); assert(dead.every((a) => a.state === 'dormant'));
  assert(Object.keys(lv.containers).length >= 2); assert(Object.values(lv.items).some((s) => s.some((i) => i.id === 'mushroom')));
  assert(!c.component && !(c.docs || []).length);
}
{ // black unless you carry light
  const g = make({ seed: 3 }); const c = caves(g)[0], lv = g.ensure_level(`${c.id}:0`);
  g.level = lv; g.player.x = lv.entry[0]; g.player.y = lv.entry[1]; g.player.light = null;
  const dark = g.vision_radius(); assert(dark < 6);
  const light = Object.keys(g.items).find((i) => g.items[i].kind === 'light' && g.items[i].light > 3);
  g.player.light = { id: light, qty: 1, dur: g.items[light].durability, key: false }; g.player.light_on = true; assert(g.vision_radius() > dark);
}
{ // through the mouth and back out
  const g = make({ seed: 3 }), c = caves(g)[0], wl = g.world.level; OB.generate_all(g); empty_level(wl);
  const p = g.player; p.hp = p.max_hp = 1e6; wl.occ.clear(); p.x = c.x; p.y = c.y + 1; wl.occ.set(wl.idx(p.x, p.y), p);
  g.move(0, -1); assert.strictEqual(g.level.id, `${c.id}:0`);
  const [k] = Object.entries(g.level.portals).find(([, v]) => v.target === 'world'); const ex = Number(k) % g.level.w, ey = Math.floor(Number(k) / g.level.w);
  for (const a of g.level.actors.slice()) if (a !== p) g.level.remove_actor(a);
  g.move(ex - p.x, ey - p.y); assert.strictEqual(g.level, g.world.level);
}
// ---- the deep woods
function grove(seed = 3) {
  const g = make({ seed }), lv = g.world.level; empty_level(lv); const p = g.player; p.hp = p.max_hp = 1e6; p.infected = false;
  for (let y = p.y - 8; y <= p.y + 8; y++) for (let x = p.x - 10; x <= p.x + 10; x++) lv.set_tile(x, y, OB.T.GRASS);
  for (let y = p.y - 2; y <= p.y + 2; y++) for (let x = p.x - 2; x <= p.x + 2; x++) if (x !== p.x || y !== p.y) lv.set_tile(x, y, (x + y) % 3 ? OB.T.TREE : OB.T.GRASS);
  return [g, lv];
}
const clearing = (g, lv) => { for (let y = g.player.y - 2; y <= g.player.y + 2; y++) for (let x = g.player.x - 2; x <= g.player.x + 2; x++) if (x !== g.player.x || y !== g.player.y) lv.set_tile(x, y, OB.T.GRASS); };
{ // announced once; the dead see less
  const [g, lv] = grove(); g.clock.turn += 1; assert(OB.wild_forest_here(g));
  const n = g.log.length; OB.wild_forest_note(g); OB.wild_forest_note(g); assert.strictEqual(g.log.length, n + 1); assert(g.log[g.log.length - 1][1].includes('canopy'));
  const z = OB.spawn_zombie(g, lv, [g.player.x + 6, g.player.y], 'walker', false); g.clock.turn += 1; const deep = OB.sight_range(g, z);
  clearing(g, lv); g.clock.turn += 1; assert(deep < OB.sight_range(g, z));
}
{ // wolves hunt as a pack and bite
  const [g, lv] = grove(), p = g.player; p.hp = p.max_hp = 500;
  const a = OB.wild_make(g, p.x + 5, p.y + 6, 'wolf'), b = OB.wild_make(g, p.x + 9, p.y + 6, 'wolf'); lv.add_actor(a); lv.add_actor(b); clearing(g, lv);
  g.clock.turn = 1; OB.wild_tick(g, a); assert.strictEqual(a.state, 'charge'); assert.strictEqual(b.state, 'charge');
  const hp0 = p.hp; a.x = p.x + 1; a.y = p.y; g.rng.random = () => 0.1; g.clock.turn = 5; OB.wild_tick(g, a); assert(p.hp < hp0);
}
{ // forest forage pays and gives herbs
  const [g] = grove(); g.rng.random = () => 0.0; g.clock.turn = 1000; assert(g.forage()); assert(g.player.count('herbs') > 0);
}
{ // wolf packs live in the woods
  const g = make({ seed: 3 }); OB.generate_all(g); const lv = g.world.level, w = lv.actors.filter((a) => a.kind === 'animal' && a.species === 'wolf');
  assert(w.length >= 2, `${w.length} wolves`); assert(w.filter((a) => OB.wild_in_forest_at(lv, [a.x, a.y])).length >= w.length / 2);
}
console.log('caves: dark chambers, nests, crates; deep woods hide you and hold wolf packs');
