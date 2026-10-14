const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function field(seed = 3) {
  const g = make({ seed }), lv = g.world.level, c = OB.comp_current(g);
  for (const a of lv.actors.slice()) if (a !== c) lv.remove_actor(a);
  g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 500; p.infected = false;
  for (let y = p.y - 10; y <= p.y + 10; y++) for (let x = p.x - 12; x <= p.x + 12; x++) lv.set_tile(x, y, OB.T.GRASS);
  g.clock.turn = 1000;
  return [g, lv];
}
const stray = (g, lv, sp = 'dog', dx = 1) => { const a = OB.pets_make_stray(g, sp, g.player.x + dx, g.player.y + 1); lv.add_actor(a); return a; };
const food = (n = 5) => ({ id: 'food', qty: n, dur: null, key: false });
function adopt(g, lv, sp = 'dog') { const a = stray(g, lv, sp); g.player.inventory.push(food()); g.rng.random = () => 0.0; OB.pets_befriend(g, a); return a; }

{ // strays of every kind in the world
  const g = make({ seed: 3 }); OB.generate_all(g); const kinds = new Set(g.world.level.actors.filter((a) => a.kind === 'animal' && a.stray).map((a) => a.species)); assert(kinds.size >= 3);
}
{ // curious but not attackable by bumping; need food; befriend; refuse; one at a time
  let [g, lv] = field(); const a = OB.pets_make_stray(g, 'dog', g.player.x + 7, g.player.y); lv.add_actor(a);
  for (let i = 0; i < 12; i++) { g.clock.turn = 1000 + i; OB.pets_tick_animal(g, a); } assert(Math.max(Math.abs(a.x - g.player.x), Math.abs(a.y - g.player.y)) <= 3);
  [g, lv] = field(); const c = stray(g, lv, 'cat', -1), hp = c.hp; g.player.x = c.x + 1; g.player.y = c.y; lv.occ.clear(); lv.occ.set(lv.idx(g.player.x, g.player.y), g.player); lv.occ.set(lv.idx(c.x, c.y), c);
  assert(!g._bump_actor(c)); assert.strictEqual(c.hp, hp);
  [g, lv] = field(); const s1 = stray(g, lv); g.player.inventory = g.player.inventory.filter((i) => g.item_def(i.id).kind !== 'food'); assert(OB.pets_befriend(g, s1).includes('something to eat')); assert(!s1.pet);
  [g, lv] = field(); const p1 = adopt(g, lv); assert(p1.pet); assert.strictEqual(g.pet_uid, p1.uid); assert.strictEqual(OB.pets_current(g), p1); assert.notStrictEqual(p1.name, 'Dog');
  const fox = stray(g, lv, 'cat', 2); g.player.inventory.push(food(1)); assert(OB.pets_befriend(g, fox).includes('already'));
  [g, lv] = field(); const f2 = stray(g, lv, 'fox'); g.player.inventory.push(food(2)); g.rng.random = () => 0.99; assert(OB.pets_befriend(g, f2).includes('bolts')); assert(!f2.pet); assert.strictEqual(f2.state, 'flee');
}
{ // what each one does
  let [g, lv] = field(); const dog = adopt(g, lv, 'dog'); const z = OB.spawn_zombie(g, lv, [dog.x + 1, dog.y], 'walker', false); z.hp = z.max_hp = 4;
  for (let i = 0; i < 10 && lv.actors.includes(z); i++) { g.clock.turn = 1100 + i; OB.pets_ai(g, dog, 2); } assert(!lv.actors.includes(z)); assert(dog.kills >= 1);
  [g, lv] = field(); const cat = adopt(g, lv, 'cat'); g.player.panic = 60; g.clock.turn = 1200; OB.pets_tick(g); assert(g.player.panic < 60);
  [g, lv] = field(); const crow = adopt(g, lv, 'crow'); crow.nextfx = 0; g.clock.turn = 1500; const hidden = Object.values(g.pois).filter((p) => !p.revealed).length; OB.pets_tick(g); assert(Object.values(g.pois).filter((p) => !p.revealed).length <= hidden);
  [g, lv] = field(); const d2 = adopt(g, lv, 'dog'); const r = OB.make_raider(g, d2.x + 4, d2.y); r.hidden = true; r.state = 'idle'; lv.add_actor(r); g.clock.turn = 1200; OB.pets_tick(g); assert(!r.hidden);
}
{ // hunger, bond, waiting outside, swapping places
  let [g, lv] = field(); const dog = adopt(g, lv); dog.fed = 0; g.clock.turn = 5000; for (let i = 0; i < 30; i++) { g.clock.turn += 100; OB.pets_tick(g); } assert(!OB.pets_current(g)); assert(dog.stray);
  [g, lv] = field(); const d = adopt(g, lv); let b = d.bond; g.player.inventory.push(food(1)); OB.pets_feed(g, d, g.player.inventory.length - 1); assert(d.bond > b); b = d.bond; OB.pets_pet_it(g, d); assert(d.bond > b);
  [g, lv] = field(); const e = adopt(g, lv); e.x = g.player.x + 1; e.y = g.player.y; lv.occ.clear(); lv.occ.set(lv.idx(g.player.x, g.player.y), g.player); lv.occ.set(lv.idx(e.x, e.y), e); const old = [g.player.x, g.player.y];
  assert(g._bump_actor(e)); assert.deepStrictEqual([e.x, e.y], old);
}
{ // the dead go for a pet; death is permanent; the ending remembers; an event can bring one; the Director sends a stray
  let [g, lv] = field(); const cat = adopt(g, lv, 'cat'); cat.hp = 1; const z = OB.spawn_zombie(g, lv, [cat.x + 1, cat.y], 'walker', false);
  for (let i = 0; i < 20 && lv.actors.includes(cat); i++) OB.attack_actor(g, z, cat);
  assert(!lv.actors.includes(cat)); assert(!OB.pets_current(g)); assert.strictEqual(g.pet_uid, 0); assert(g.story.some((m) => m[1].includes('is dead'))); assert.strictEqual(g.fallen_allies[g.fallen_allies.length - 1][0], cat.name);
  [g, lv] = field(); const dog = adopt(g, lv); assert(OB.build_ending(g, 'dead', 'x').summary.some((l) => l.includes(dog.name)));
  [g, lv] = field(); g.player.inventory.push(food(3)); g.rng.random = () => 0.0; const ev = OB.CONTENT.events.find((e) => e.id === 'stray'); assert(ev);
  const active = { event_id: 'stray', text: ev.text, result: '', resolved: false, data: {} }; OB.resolve_event(g, active, 0); assert(OB.pets_current(g));
  [g, lv] = field(); const n = lv.actors.filter((a) => a.kind === 'animal' && a.stray).length; OB.pets_stray_beat(g); assert.strictEqual(lv.actors.filter((a) => a.kind === 'animal' && a.stray).length, n + 1);
  [g, lv] = field(); const keep = adopt(g, lv); const h = OB.deserialize_game(OB.serialize_game(g)), p2 = OB.pets_current(h); assert(p2); assert.strictEqual(p2.name, keep.name);
}
console.log('pets: strays, befriending with food, strengths and flaws, hunger, permanent death');
