const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function arena(seed = 3) {
  const g = make({ seed }), lv = g.world.level; empty_level(lv); g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 1e6; p.stamina = p.max_stamina = 100;
  for (let y = p.y - 4; y <= p.y + 4; y++) for (let x = p.x - 6; x <= p.x + 6; x++) lv.set_tile(x, y, OB.T.GRASS);
  return [g, lv];
}
const zombie_east = (g, lv, special = 'walker', dist = 1) => { const z = OB.spawn_zombie(g, lv, [g.player.x + dist, g.player.y], special, false); z.state = 'idle'; return z; };

{ // a shove moves it back and stuns it; it knows who did it
  const [g, lv] = arena(); g.rng.random = () => 0.0; const z = zombie_east(g, lv), x0 = z.x;
  assert(g.push()); assert(z.x > x0); assert(z.stun >= 1); assert.strictEqual(z.state, 'hunt'); assert(g.player.stamina < 100);
}
{ // a stunned zombie loses its turns, then recovers
  const [g, lv] = arena(); g.rng.random = () => 0.0; const z = zombie_east(g, lv); g.push(); const pos = [z.x, z.y], n = z.stun;
  for (let i = 0; i < n; i++) g.wait(1);
  assert.strictEqual(z.stun, 0); assert.deepStrictEqual([z.x, z.y], pos);
}
{ // against a wall it is slammed and hurt
  const [g, lv] = arena(); g.rng.random = () => 0.0; const z = zombie_east(g, lv); lv.set_tile(z.x + 1, z.y, OB.T.WALL); const hp = z.hp;
  g.push(); assert.strictEqual(z.x, g.player.x + 1); assert(z.hp < hp);
}
{ // bosses do not budge, brutes resist
  const [g, lv] = arena(); g.rng.random = () => 0.0; const b = zombie_east(g, lv, 'alpha'), x = b.x; g.push(); assert.strictEqual(b.x, x);
  const [h, hl] = arena(); const brute = zombie_east(h, hl, 'brute'); h.rng.random = () => 0.6; const bx = brute.x; h.push(); assert.strictEqual(brute.x, bx);
}
{ // you need the wind and something to push
  const [g, lv] = arena(); assert(!g.push()); const z = zombie_east(g, lv); g.player.stamina = 2; assert(!g.push()); assert.strictEqual(z.stun, 0);
}
{ // shoving the dead onto a trap works
  const [g, lv] = arena(); g.rng.random = () => 0.0; const z = zombie_east(g, lv);
  lv.hazards[lv.idx(z.x + 1, z.y)] = { kind: 'spikes', ttl: 1e9, power: 40 }; const hp = z.hp; g.push(); assert(z.hp < hp || !lv.actors.includes(z));
}
console.log('push: shove, stun, slam, bosses and brutes, stamina, traps');
