const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function open_game(cfg) {
  const g = make(Object.assign({ seed: 3 }, cfg)), lv = g.world.level, p = g.player;
  empty_level(lv); g.hordes.length = 0; g.ring = null; p.infected = false; p.hp = p.max_hp = 1e6;
  for (let y = 8; y < lv.h - 8; y++) for (let x = 8; x < lv.w - 8; x++) {
    let ok = true;
    for (let i = -2; i < 4 && ok; i++) ok = lv.free(x + i, y) && [OB.T.GRASS, OB.T.ROAD].includes(lv.tile(x + i, y));
    if (ok) { lv.occ.delete(lv.idx(p.x, p.y)); p.x = x; p.y = y; lv.occ.set(lv.idx(x, y), p); g.update_fov(); return g; }
  }
  throw new Error('no open ground');
}
const pace = (g, n) => { for (let i = 0; i < n; i++) { if (i % 10 === 0) { empty_level(g.world.level); g.hordes.length = 0; g.pending_event = null; } g.move(i % 2 === 0 ? 1 : -1, 0); } };

{ // a long march empties the tank
  const g = open_game(), s0 = g.player.stamina;
  pace(g, 60); assert(g.player.stamina < s0 - 10);
  pace(g, 400); assert(g.player.stamina < 15, `stamina ${g.player.stamina}`);
}
{ // winded walkers are slower, and warned once or twice
  const g = open_game(); g.player.stamina = 12; const t0 = g.clock.turn; pace(g, 20); const winded = g.clock.turn - t0;
  const f = open_game(); f.player.stamina = 90; const t1 = f.clock.turn; pace(f, 20); const fresh = f.clock.turn - t1;
  assert(winded > fresh * 1.3, `winded ${winded} vs fresh ${fresh}`);
  const w = g.log.filter((m) => /winded|exhausted/.test(m[1])).length; assert(w >= 1 && w <= 2);
}
{ // creeping recovers; resting restores
  const g = open_game(); g.player.stamina = 50; g.player.sneaking = true; pace(g, 40); assert(g.player.stamina > 50);
  g.player.sneaking = false; g.player.stamina = 5; empty_level(g.world.level); g.hordes.length = 0; g.pending_event = null; g.rest(30);
  assert(g.player.stamina > 40);
}
{ // running burns out fast and stops
  const g = open_game(); g.toggle_sprint(); assert(g.player.sprinting);
  let steps = 0; while (g.player.sprinting && steps < 100) { g.move(steps % 2 === 0 ? 1 : -1, 0); steps++; }
  assert(!g.player.sprinting); assert(steps < 45, `ran ${steps} steps`);
}
{ // shallow water costs more
  const g = open_game(), a = g.player.stamina; g._tire(OB.T.GRASS, false, false); const grass = a - g.player.stamina;
  g.player.stamina = a; g._tire(OB.T.SHALLOW, false, false); assert(a - g.player.stamina > grass);
}
console.log('stamina: sustained marching tires you, resting and creeping recover');
