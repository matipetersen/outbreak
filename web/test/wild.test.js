const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function field(seed = 3) {
  const g = make({ seed }), lv = g.world.level; empty_level(lv); g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 1e6; p.infected = false;
  for (let y = p.y - 12; y <= p.y + 12; y++) for (let x = p.x - 14; x <= p.x + 14; x++) lv.set_tile(x, y, OB.T.GRASS);
  return [g, lv];
}
function animal(g, lv, dx, species = 'deer') { const a = OB.wild_make(g, g.player.x + dx, g.player.y, species); lv.add_actor(a); return a; }

{ // the world has game
  const g = make({ seed: 3 }); OB.generate_all(g);
  const n = g.world.level.actors.filter((a) => a.kind === 'animal'); assert(n.length >= 20, `only ${n.length}`);
  assert(new Set(n.map((a) => a.species)).size >= 2);
}
{ // game bolts when it notices you, and a chase is not free
  const [g, lv] = field(); const a = animal(g, lv, 5), d0 = Math.abs(a.x - g.player.x);
  g.clock.turn = 1; OB.wild_tick(g, a); assert.strictEqual(a.state, 'flee');
  for (let i = 2; i < 8; i++) { g.clock.turn = i; OB.wild_tick(g, a); } assert(Math.abs(a.x - g.player.x) > d0);
}
{ // creeping hides you; a stalked animal takes a triple blow
  const [g, lv] = field(); g.player.sneaking = true; g.rng.random = () => 0.99; const a = animal(g, lv, 3);
  for (let i = 0; i < 6; i++) { g.clock.turn = i + 1; OB.wild_tick(g, a); } assert(!a.alert);
  lv.remove_actor(a); a.x = g.player.x + 1; a.y = g.player.y; lv.add_actor(a); const hp = a.hp;
  g.move(1, 0); assert(a.hp < hp || !lv.actors.includes(a));
}
{ // a kill drops meat; raw can make you ill, cooked cannot; cooking needs a plank
  const [g, lv] = field(); const a = animal(g, lv, 1); OB.wild_kill(g, a);
  const meat = lv.items[lv.idx(g.player.x + 1, g.player.y)][0]; assert.strictEqual(meat.id, 'raw_meat'); assert(meat.qty >= 2);
  const p = g.player; p.hp = 50; p.hunger = 80; g.rng.random = () => 0.0;
  const raw = { id: 'raw_meat', qty: 1, dur: null, key: false }; p.inventory.push(raw); OB.use_item ? OB.use_item(g, p.inventory.indexOf(raw)) : OB.use(g, p.inventory.indexOf(raw));
  assert(p.hp < 50);
  p.hp = 50; p.hunger = 80; const cooked = { id: 'meat', qty: 1, dur: null, key: false }; p.inventory.push(cooked); OB.use_item ? OB.use_item(g, p.inventory.indexOf(cooked)) : OB.use(g, p.inventory.indexOf(cooked));
  assert.strictEqual(p.hp, 50); assert(p.hunger <= 40);
}
{ // a boar fights back
  const [g, lv] = field(); const a = animal(g, lv, 1, 'boar'); a.alert = true; a.state = 'charge'; g.rng.random = () => 0.1; g.clock.turn = 1;
  const hp = g.player.hp; OB.wild_tick(g, a); assert(g.player.hp < hp);
}
{ // foraging takes time, finds food, and a patch stays picked
  const [g] = field(); g.rng.random = () => 0.0; g.clock.turn = 1000; const t0 = g.clock.turn, n0 = g.player.count('forage');
  assert(g.forage()); assert(g.clock.turn - t0 >= 5); assert(g.player.count('forage') > n0);
  const n = g.player.count('forage'); assert(!g.forage()); assert.strictEqual(g.player.count('forage'), n);
  g.clock.turn += 801; assert(g.forage());
}
{ // not on a road, not hunted
  const [g, lv] = field(); lv.set_tile(g.player.x, g.player.y, OB.T.ROAD); assert(!g.forage());
  lv.set_tile(g.player.x, g.player.y, OB.T.GRASS); assert.strictEqual(OB.wild_can_forage(g), '');
  OB.spawn_zombie(g, lv, [g.player.x + 4, g.player.y], 'walker', false); g.update_fov(); assert(OB.wild_can_forage(g) !== '');
}
{ // saves keep the picked patches
  const [g] = field(); g.foraged.push([1, 2, 3]); const g2 = OB.deserialize_game(OB.serialize_game(g)); assert.deepStrictEqual(g2.foraged, [[1, 2, 3]]);
}
const blade = (g) => Object.keys(g.items).find((i) => g.items[i].style === 'blade');
{ // a tree falls to a blade and leaves a clearing; not bare-handed, not the rim
  const [g, lv] = field(), p = g.player; lv.set_tile(p.x + 1, p.y, OB.T.TREE); p.weapon = { id: blade(g), qty: 1, dur: null, key: false };
  const w0 = p.count('wood'), t0 = g.clock.turn; assert.strictEqual(OB.wild_target(g), 'chop'); assert(g.gather());
  assert(p.count('wood') > w0 + 1); assert.strictEqual(lv.tile(p.x + 1, p.y), OB.T.GRASS); assert(g.clock.turn - t0 >= 6);
  const [h, hl] = field(); hl.set_tile(h.player.x + 1, h.player.y, OB.T.TREE); h.player.weapon = null; assert(!OB.wild_chop(h)); assert.strictEqual(hl.tile(h.player.x + 1, h.player.y), OB.T.TREE);
  const [r, rl] = field(); r.player.x = 1; r.player.y = 5; rl.tiles[5 * rl.w] = OB.T.TREE; assert.strictEqual(OB.wild_tree_beside(r), null);
}
{ // fishing needs water and gear, and the net tears
  const [g, lv] = field(), p = g.player; lv.set_tile(p.x + 1, p.y, OB.T.WATER); p.inventory = p.inventory.filter((i) => i.id !== 'rod' && i.id !== 'net'); p.weapon = null;
  assert(!g.gather() || !p.count('fish'));
  p.inventory.push({ id: 'rod', qty: 1, dur: null, key: false }); g.rng.random = () => 0.0; assert.strictEqual(OB.wild_target(g), 'fish'); assert(g.gather()); assert(p.count('fish') >= 1);
  p.inventory = p.inventory.filter((i) => i.id !== 'rod'); p.inventory.push({ id: 'net', qty: 1, dur: null, key: false }); g.gather(); assert.strictEqual(p.count('net'), 0);
  const [h] = field(); h.player.inventory.push({ id: 'rod', qty: 1, dur: null, key: false }); assert.strictEqual(OB.wild_water_beside(h), null); assert.notStrictEqual(OB.wild_target(h), 'fish');
}
{ // recipes exist and a nail bomb blasts a crowd and hurts you if close
  const rec = OB.CONTENT.recipes; for (const k of ['rod', 'net', 'cook_fish', 'nailbomb']) { const r = rec.find((x) => x.id === k); assert(r && r.starter && !r.needs); }
  const [g, lv] = field(), p = g.player; p.inventory.push({ id: 'nailbomb', qty: 2, dur: null, key: false });
  const zs = []; for (const dx of [0, 1]) for (const dy of [0, 1]) zs.push(OB.spawn_zombie(g, lv, [p.x + 6 + dx, p.y + dy], 'walker', false)); g.update_fov();
  const hp = zs.map((z) => z.hp); g.rng.random = () => 0.9; assert(OB.throw_item(g, 'nailbomb', [p.x + 6, p.y]));
  assert(zs.every((z, i) => z.hp < hp[i] || !lv.actors.includes(z))); const hp0 = p.hp; OB.throw_item(g, 'nailbomb', [p.x + 2, p.y]); assert(p.hp < hp0);
}
console.log('wild: game bolts, boars gore, meat cooks, patches get picked clean');
