const assert = require('assert');
const { OB, make, empty_level, teleport } = require('./helpers');

function in_house(cfg = {}) {
  const g = make(Object.assign({ seed: 3 }, cfg)), poi = Object.values(g.pois).find((q) => q.kind === 'house');
  teleport(g, poi.id + ':0'); empty_level(g.level); g.player.hp = g.player.max_hp = 1e6; return [g, g.level];
}
const stock = (g, items) => { for (const [k, v] of Object.entries(items)) g.player.inventory.push({ id: k, qty: v, dur: null }); };
const tiles = (lv) => Array.from(lv.tiles);

{ // claim needs a cleared building
  const g = make({ seed: 3 }); assert(/building/.test(OB.can_claim(g)));
  const [h, lv] = in_house();
  const z = OB.spawn_zombie(h, lv, lv.free_spot_near(lv.entry[0], lv.entry[1], 5), 'walker', true);
  assert(/Clear/.test(OB.can_claim(h))); lv.remove_actor(z);
  assert.strictEqual(OB.can_claim(h), ''); assert(OB.claim_base(h)); assert.strictEqual(h.base_id, lv.id); assert(lv.safe);
}
{ // costs, limits, workshop unlocks weapon crafting
  const [g, lv] = in_house(); OB.claim_base(g);
  const ws = OB.STRUCTURE_BY_ID.workshop; let [ok, why] = OB.structure_status(g, ws); assert(!ok && /missing/.test(why));
  stock(g, { wood: 12, scrap: 9, cloth: 3 });
  const r = OB.CONTENT.recipes.find((x) => x.id === 'nailbat');
  assert(/workshop/.test(OB.recipe_status(g, r)[1]));
  const w0 = g.player.count('wood'); assert(OB.build_structure(g, 'workshop')); assert.strictEqual(g.player.count('wood'), w0 - 4);
  assert(tiles(lv).includes(OB.T.WORKSHOP)); assert(!OB.structure_status(g, ws)[0]);
  assert(OB.recipe_status(g, r)[0]); assert(g.craft('nailbat')); assert(g.player.count('nailbat') >= 1);
}
{ // a barricade is a gate with hit points
  const [g, lv] = in_house(); OB.claim_base(g); stock(g, { wood: 4, scrap: 2 }); assert(OB.build_structure(g, 'barricade'));
  const k = Object.keys(lv.built).find((x) => lv.built[x] === 'barricade'); assert.strictEqual(lv.tiles[k], OB.T.DOOR); assert.strictEqual(lv.door_hp[k], OB.BARRICADE_HP);
}
{ // the locker survives you in hardcore, and the next survivor wakes in the base
  const [g, lv] = in_house({ mode: 'living' }); OB.claim_base(g); stock(g, { wood: 4, scrap: 2, food: 3 }); assert(OB.build_structure(g, 'locker'));
  assert(OB.stash_put(g, g.player.inventory.findIndex((i) => i.id === 'food'))); assert.strictEqual(lv.stash[0].id, 'food');
  g.player.hp = 1; OB.damage_player(g, 99, 'killed by a test');
  assert(!g.over); assert.strictEqual(g.level.id, lv.id); assert.strictEqual(lv.stash[0].id, 'food');
  assert(OB.stash_take(g, 0)); assert(g.player.count('food') >= 3);
}
{ // raids at night; a raid cuts sleep short
  const [g, lv] = in_house(); OB.claim_base(g); g.raid_next = 0; g.clock.turn = 240 * 3 + 215; assert(g.clock.is_night);
  for (let i = 0; i < 400 && !lv.actors.some((a) => a.kind === 'zombie'); i++) { g._base_tick(); g.clock.turn++; }
  const zs = lv.actors.filter((a) => a.kind === 'zombie'); assert(zs.length); assert(!lv.safe); assert(zs.every((z) => z.state === 'hunt'));
  const [h, hl] = in_house(); OB.claim_base(h); h.clock.turn = 240 * 2 + 150;
  const z = OB.spawn_zombie(h, hl, hl.free_spot_near(hl.entry[0], hl.entry[1], 3), 'walker', false); z.state = 'hunt'; hl.safe = true;
  const t0 = h.clock.turn; h.sleep(); assert(h.clock.turn - t0 < 80);
}
console.log('base: claim, build, craft weapons, stash, raids');
