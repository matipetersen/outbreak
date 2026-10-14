const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function world(era, zombies = 'classic', seed = 3) { const g = make({ era, zombies, seed }); empty_level(g.world.level); g.hordes.length = 0; g.ring = null; g.player.hp = g.player.max_hp = 1e6; return g; }
const days = (g, n) => { g.clock.turn = 240 * (n - 1); };
const zombie_near = (g, d) => { const z = OB.spawn_zombie(g, g.world.level, g.world.level.free_spot_near(g.player.x + d, g.player.y, 2), 'walker', false); z.state = 'idle'; return z; };

{ // every era has its own rules
  const rules = Object.values(OB.CONTENT.eras).map((e) => e.rules);
  assert.strictEqual(new Set(rules.map((r) => r.feel)).size, 4);
  assert.strictEqual(OB.CONTENT.eras.medieval.rules.alarm_chance, 0);
  assert(OB.CONTENT.eras.scifi.rules.lab > OB.CONTENT.eras.modern.rules.lab);
  for (const r of rules) for (const [k] of r.ambient) assert(OB.AMBIENT_EVENTS[k], k);
}
{ // darker medieval night, visor in the future
  const med = world('medieval'), sci = world('scifi'), mod = world('modern');
  for (const g of [med, sci, mod]) g.clock.turn = 240 * 3 + 215;
  assert(med.vision_radius() < mod.vision_radius()); assert(sci.vision_radius() > mod.vision_radius());
}
{ // a torch shows you further in the medieval night than cold light in the future
  const out = {};
  for (const era of ['medieval', 'modern', 'scifi']) {
    const g = world(era); g.clock.turn = 240 * 3 + 215; const z = zombie_near(g, 9);
    g.player.light = { id: 'torch', qty: 1, dur: 100 }; g.player.light_on = true; out[era] = OB.player_lit(g) ? OB.sight_range(g, z) : 0;
  }
  assert(out.medieval > out.modern); assert(out.modern > out.scifi);
}
{ // the dead of the future see in the dark and through brush
  const sci = world('scifi'), mod = world('modern');
  for (const g of [sci, mod]) { g.clock.turn = 240 * 3 + 215; g.player.light = null; }
  const zs = zombie_near(sci, 9), zm = zombie_near(mod, 9);
  assert(OB.sight_range(sci, zs) > OB.sight_range(mod, zm) * 1.3);
  for (const g of [sci, mod]) g.world.level.set_tile(g.player.x, g.player.y, OB.T.BRUSH);
  assert(OB.sight_range(sci, zs) / OB.sight_range(mod, zm) > 1.3);
}
{ // the world makes the noises of its era
  for (const [era, banned] of [['medieval', ['car_alarm', 'siren', 'klaxon', 'phone', 'helicopter', 'drone', 'surge']], ['modern', ['bell', 'klaxon', 'drone']], ['scifi', ['bell', 'car_alarm', 'phone']]]) {
    const g = world(era, 'classic', 5), kinds = new Set();
    for (let i = 1; i < 3000; i++) { g.clock.turn = 100 + i * 20; OB.world_tick(g); for (const s of g.sources) kinds.add(s.kind); g.sources.length = 0; }
    assert(!banned.some((k) => kinds.has(k)), era + ' ' + [...kinds]); assert(kinds.size, era);
  }
}
{ // no alarms in medieval buildings
  const g = world('medieval'); for (const poi of Object.values(g.pois).filter((q) => ['market', 'guard', 'military', 'lab'].includes(q.kind))) OB.building_alarm(g, poi);
  assert.strictEqual(g.sources.length, 0);
}
{ // a drone drifts and scans you unless you creep
  const g = world('scifi'), pos = [g.player.x + 6, g.player.y];
  g.sources.push({ pos: pos.slice(), radius: 10, every: 2, left: 40, kind: 'drone', drift: [-1, 0] });
  for (let i = 0; i < 8; i++) { g.clock.turn++; OB.world_tick(g); }
  assert.notDeepStrictEqual(g.sources[0].pos, pos); assert(g.sources[0].scanned);
  const h = world('scifi'); h.player.sneaking = true;
  h.sources.push({ pos: [h.player.x + 4, h.player.y], radius: 10, every: 2, left: 40, kind: 'drone', drift: [-1, 0] });
  for (let i = 0; i < 8; i++) { h.clock.turn++; OB.world_tick(h); }
  assert(!h.sources[0].scanned);
}
{ // mutation: plague x science, ramping up
  const a = world('scifi', 'bio'), b = world('medieval', 'classic'), c = world('modern', 'bio');
  for (const g of [a, b, c]) days(g, 30);
  assert(OB.mutation_strength(a) > OB.mutation_strength(c)); assert(OB.mutation_strength(c) > OB.mutation_strength(b) * 10);
  days(a, 1); assert.strictEqual(OB.mutation_strength(a), 0);
}
{ // the map is cut into named districts, deterministically
  const g = world('modern', 'bio', 7), h = world('modern', 'bio', 7);
  assert(g.regions.length >= 6);
  assert.deepStrictEqual(g.regions.map((r) => [r.name, r.cx, r.cy, r.heat]), h.regions.map((r) => [r.name, r.cx, r.cy, r.heat]));
  assert.strictEqual(new Set(g.regions.map((r) => r.name)).size, g.regions.length);
  assert(g.regions.some((r) => r.heat > 1.4));
  assert.strictEqual(OB.mutation_here(g), OB.mutation_region_of(g, g.world.start[0], g.world.start[1]));
}
{ // districts change differently, hot ones faster; a quiet plague in an old world hardly changes anywhere
  const g = world('scifi', 'bio', 7);
  for (let d = 2; d < 40; d++) { days(g, d); OB.mutation_daily(g); }
  assert(new Set(g.regions.map((r) => r.traits.slice().sort().join())).size > 2);
  const hot = g.regions.filter((r) => r.heat >= 1.8).map((r) => r.traits.length), cold = g.regions.filter((r) => r.heat <= 1.1).map((r) => r.traits.length);
  const avg = (v) => v.reduce((x, y) => x + y, 0) / v.length;
  if (hot.length && cold.length) assert(avg(hot) >= avg(cold));
  assert(Math.max(...g.regions.map((r) => r.traits.length)) >= 4);
  const q = world('medieval', 'classic', 7);
  for (let d = 2; d < 40; d++) { days(q, d); OB.mutation_daily(q); }
  assert(q.regions.reduce((x, r) => x + r.traits.length, 0) / q.regions.length <= 1.25); assert(Math.max(...q.regions.map((r) => r.traits.length)) <= 3);
}
{ // zombies get their district's traits, new and old
  const g = world('scifi', 'bio'), lv = g.world.level, r = OB.mutation_here(g), old = zombie_near(g, 8);
  const before = [old.max_hp, old.speed, old.hearing, old.dmg.join()].join('|');
  days(g, 20); r.heat = 2.5; for (let i = 0; i < 60; i++) OB.mutation_daily(g);
  assert(r.traits.length); assert([old.max_hp, old.speed, old.hearing, old.dmg.join()].join('|') !== before);
  const other = g.regions.find((x) => x !== r); other.traits = [];
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(other.cx, other.cy, 8), 'walker', false, true);
  assert.strictEqual(z.max_hp, OB.make_zombie(g, 'walker', 5, 5, true).max_hp);
}
{ // crossing into a changed district tells you, once
  const g = world('scifi', 'bio'), r = OB.mutation_here(g); r.traits = ['fleet', 'tough']; g.region_id = -1;
  OB.mutation_crossing(g); assert(g.log.slice(-3).some((m) => m[1].includes(r.name) && m[1].includes('faster')));
  const n = g.log.length; OB.mutation_crossing(g); assert.strictEqual(g.log.length, n); assert(r.known);
}
{ // the briefing says how it plays
  const g = world('modern', 'bio'), text = g.intro_pages.map((p) => p[1]).join('\n');
  assert(text.includes(g.era.rules.feel)); assert(text.includes('mutates fast'));
  assert(world('medieval', 'classic').intro_pages.map((p) => p[1]).join('\n').includes('hardly changes'));
}
console.log('eras: sound, sight and mutation differ by era and plague');
