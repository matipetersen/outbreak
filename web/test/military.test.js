const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function field(seed = 3, era = 'modern') {
  const g = make({ seed, era }), lv = g.world.level; empty_level(lv); g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 1e6; p.infected = false;
  for (let y = p.y - 12; y <= p.y + 12; y++) for (let x = p.x - 14; x <= p.x + 14; x++) lv.set_tile(x, y, OB.T.GRASS);
  g.checkpoints = {};
  return [g, lv];
}
function post(g, lv, dx = 5, corrupt = false, n = 3, cid = 77) {
  const cp = OB.military_register(g, cid, g.player.x + dx, g.player.y), guards = [];
  for (let i = 0; i < n; i++) {
    const spot = lv.free_spot_near(cp.x, cp.y, 2), h = OB.make_patrol(g, 'soldier', spot[0], spot[1], 0);
    h.state = 'guard'; h.cp = cid; h.post = spot; h.corrupt = corrupt; lv.add_actor(h); guards.push(h);
  }
  return [cp, guards];
}
function arm(g) { g.player.inventory.push({ id: 'medkit', qty: 2 }, { id: 'molotov', qty: 1 }); }
function clean(g) { const ids = OB.military_banned_ids(g); g.player.inventory = g.player.inventory.filter((i) => !ids.has(i.id)); g.player.weapon = null; }
function stop(g) { g.clock.turn += g.clock.turn % 2; OB.military_tick(g); return g.pending_event; }

{ // the far roads have checkpoints with guards
  const g = make({ seed: 3 }); OB.generate_all(g); const lv = g.world.level;
  const ids = Object.keys(g.checkpoints); assert(ids.length >= 2, `only ${ids.length} checkpoints`);
  for (const id of ids) {
    const guards = lv.actors.filter((a) => a.kind === 'human' && a.cp === Number(id)); assert(guards.length >= 2);
    assert(guards.every((a) => a.state === 'guard' && a.role === 'soldier'));
  }
}
{ const [g, lv] = field(); clean(g); post(g, lv); assert(!stop(g)); }                       // a clean traveller is waved on
{ // contraband opens the event, once
  const [g, lv] = field(); arm(g); post(g, lv); const ev = stop(g);
  assert(ev); assert.strictEqual(ev.event_id, 'mil_checkpoint'); assert(ev.data.contra.some((c) => c[0] === 'medkit'));
  g.pending_event = null; assert(!stop(g));
}
{ const [g, lv] = field(); arm(g); post(g, lv, 6); g.player.sneaking = true; assert(!stop(g)); g.player.sneaking = false; assert(stop(g)); }   // creeping
{ // submitting hands it over; the leader carries it
  const [g, lv] = field(); clean(g); arm(g); const [cp, guards] = post(g, lv); stop(g);
  g.resolve_event(0); assert.strictEqual(g.player.count('medkit'), 0); assert.strictEqual(g.player.count('molotov'), 0);
  assert(guards[0].loot.some((i) => i.id === 'medkit')); assert(!guards.some((a) => a.hostile));
}
for (const [corrupt, keeps] of [[true, true], [false, false]]) { // corrupt soldiers can be bought; honest ones keep the coins and the goods
  const [g, lv] = field(); clean(g); arm(g); g.player.coins = 50; post(g, lv, 5, corrupt); stop(g); g.rng.random = () => 0.5;
  g.resolve_event(1); assert.strictEqual(g.player.count('medkit') > 0, keeps); assert(g.player.coins < 50);
}
{ const [g, lv] = field(); arm(g); g.player.coins = 0; post(g, lv, 5, true); stop(g); assert.strictEqual(g.resolve_event(1), 'You cannot afford that.'); assert(g.pending_event); }
{ // drawing turns the crew; hitting one calls the rest
  const [g, lv] = field(); arm(g); const [cp, guards] = post(g, lv); stop(g); const rep = g.rep.military || 0; g.resolve_event(3);
  assert(guards.every((a) => a.hostile && a.state === 'hunt')); assert(g.rep.military < rep - 30); assert(cp.hostile);
  const [h, hl] = field(); const [, gs] = post(h, hl); h.make_hostile(gs[0]); assert(gs.every((a) => a.hostile));
}
{ // the infected are shot if found
  const [g, lv] = field(); g.player.infected = true; clean(g); const [, guards] = post(g, lv); g.rng.random = () => 0.0;
  assert(stop(g)); g.resolve_event(0); assert(guards.every((a) => a.hostile));
}
{ const [g, lv] = field(); g.rep.military = -80; const [, guards] = post(g, lv, 8); stop(g); assert(guards.every((a) => a.hostile)); }   // a hated runner
{ // a corrupt soldier taxes the clean
  const [g, lv] = field(); clean(g); g.player.coins = 20; const [, guards] = post(g, lv, 5, true); g.rng.random = () => 0.1;
  const ev = stop(g); assert(ev); assert.strictEqual(ev.data.kind, 'toll'); const price = ev.data.price; g.resolve_event(0); assert.strictEqual(g.player.coins, 20 - price);
}
{ // roaming patrols check too
  const [g, lv] = field(); arm(g); const spot = lv.free_spot_near(g.player.x + 3, g.player.y, 1), h = OB.make_patrol(g, 'soldier', spot[0], spot[1], 5); lv.add_actor(h);
  let got = false; for (let i = 0; i < 12 && !got; i++) { g.rng.random = () => 0.9; if (stop(g)) got = true; else g.clock.turn += 2; } assert(got);
}
{ const [g] = field(3, 'medieval'); const ids = OB.military_banned_ids(g); assert(ids.has('crossbow')); assert(!ids.has('sword')); }
{ const [g] = field(); const ids = OB.military_banned_ids(g); assert(ids.has('pistol') && ids.has('bullet')); }
{ // checkpoints survive a save
  const [g, lv] = field(); post(g, lv); g.checkpoints[77].pass_until = 999;
  const g2 = OB.deserialize_game(OB.serialize_game(g));
  assert.strictEqual(g2.checkpoints[77].pass_until, 999);
}
console.log('military: checkpoints search, tax, take bribes, and shoot the sick');
{ // a checkpoint takes only a few stacks, not the whole kit
  const [g, lv] = field(); for (const id of ['medkit', 'painkiller', 'suppressant', 'molotov', 'pistol', 'bullet']) g.player.inventory.push({ id, qty: 1 });
  post(g, lv); stop(g); const before = OB.military_contraband(g).length; g.resolve_event(0);
  assert.strictEqual(before - OB.military_contraband(g).length, 3);
}
