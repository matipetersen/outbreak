const assert = require('assert');
const { OB, make, empty_level, teleport } = require('./helpers');

function world_game(seed = 3) { const g = make({ seed }); empty_level(g.world.level); g.hordes.length = 0; g.ring = null; g.player.hp = g.player.max_hp = 1e6; return g; }
function far_zombie(g, dist) {
  const lv = g.world.level, p = g.player, spot = lv.free_spot_near(p.x + dist, p.y, 2);
  const z = OB.spawn_zombie(g, lv, spot, 'walker', false); z.state = 'idle'; z.alert = 0; return z;
}

{ // weather changes, stays valid, and is reproducible
  const run = (seed) => { const g = world_game(seed), seen = []; for (let i = 0; i < 240 * 6; i++) { g.clock.turn++; OB.weather_tick(g); seen.push(g.weather); } return seen; };
  const a = run(5), b = run(5); assert.deepStrictEqual(a, b); assert(a.every((w) => OB.WEATHER.includes(w))); assert(new Set(a).size > 1);
}
{ // rain muffles noise, fog hides you
  const g = world_game(), z = far_zombie(g, 12);
  g.weather = 'clear'; g.emit_noise([g.player.x, g.player.y], 12); assert.strictEqual(z.state, 'investigate');
  z.state = 'idle'; z.alert = 0; g.weather = 'storm'; g.emit_noise([g.player.x, g.player.y], 12); assert.strictEqual(z.state, 'idle');
  g.weather = 'clear'; const clear = OB.sight_range(g, z); g.weather = 'fog'; assert(OB.sight_range(g, z) < clear * 0.6);
}
{ // indoors the weather does not matter
  const g = world_game(), poi = Object.values(g.pois).find((q) => q.kind === 'house'); teleport(g, poi.id + ':0'); g.weather = 'storm';
  assert.strictEqual(OB.hearing_scale(g), 1.0); assert.strictEqual(OB.sight_scale(g), 1.0);
}
{ // places and ground make steps louder
  const g = world_game(); assert.strictEqual(OB.step_extra(g, OB.T.GRASS), 0); assert(OB.step_extra(g, OB.T.STAIRS_UP) > 0);
  const poi = Object.values(g.pois).find((q) => q.kind === 'industry'); teleport(g, poi.id + ':0'); assert(OB.step_extra(g, OB.T.FLOOR) >= 2);
}
{ // a sounding alarm pulses, then stops, and the dead come
  const g = world_game(), z = far_zombie(g, 14);
  g.sources.push({ pos: [g.player.x + 14, g.player.y + 1], radius: 15, every: 3, left: 9, kind: 'car alarm' });
  for (let i = 0; i < 9; i++) { g.clock.turn++; OB.world_tick(g); }
  assert.strictEqual(z.state, 'investigate'); assert.strictEqual(g.sources.length, 0);
}
{ // a building alarm is heard in the street, and each building gets one chance
  const g = world_game(), z = far_zombie(g, 6), poi = Object.values(g.pois).find((q) => ['market', 'guard', 'military', 'lab'].includes(q.kind));
  poi.x = g.player.x + 8; poi.y = g.player.y;
  let fired = false;
  for (let i = 0; i < 60 && !fired; i++) { g.alarmed = g.alarmed.filter((x) => x !== poi.id); g.sources.length = 0; OB.building_alarm(g, poi); fired = g.sources.length > 0; }
  assert(fired); teleport(g, poi.id + ':0'); assert.strictEqual(z.state, 'investigate');
  const n = g.sources.length; OB.building_alarm(g, poi); assert.strictEqual(g.sources.length, n);
}
{ // rain washes the trail away
  const g = world_game(); g.scent[5] = 0; g.weather = 'rain'; g.clock.turn = 200; OB.weather_tick(g); assert(!(5 in g.scent));
}
{ // rings for the UI; rain shrinks them; only heard alarms are marked
  const g = world_game(); g.weather = 'clear'; g.emit_noise([g.player.x, g.player.y], 10); const clear = g.pings[g.pings.length - 1].radius;
  g.weather = 'rain'; g.emit_noise([g.player.x, g.player.y], 10); assert(g.pings[g.pings.length - 1].radius < clear);
  g.sources.push({ pos: [g.player.x + 5, g.player.y], radius: 15, every: 3, left: 9, kind: 'car alarm' }, { pos: [g.player.x + 60, g.player.y], radius: 15, every: 3, left: 9, kind: 'car alarm' });
  assert.strictEqual(OB.heard_sources(g).length, 1);
}
console.log('ambience: weather, loud ground, alarms and thunder');
