const assert = require('assert');
const { OB, make, quiet } = require('./helpers');

const give = (g, items) => { for (const [id, q] of Object.entries(items)) g.give_item(OB.make_item(id, q)); };
const calm = (cfg) => { const g = quiet(make(Object.assign({ seed: 3 }, cfg))); g.player.hp = g.player.max_hp = 1e6; return g; };

{ // weapons, arrows and shields: known from the start in every era, made anywhere, rougher away from a workshop
  for (const era of Object.keys(OB.CONTENT.eras)) {
    const g = calm({ era });
    for (const id of ['nailbat', 'shiv', 'pike', 'scrapbow', 'shaft', 'shield', 'shield_good']) assert(g.player.recipes.includes(id), `${era}: ${id}`);
    assert(g.item_def('shield').kind === 'shield' && g.item_def('shield_good').block > g.item_def('shield').block);
    const ammo = era === 'scifi' ? ['darts', 'dart'] : ['arrows', 'arrow'];
    give(g, { wood: 20, scrap: 20, cloth: 10, chem: 5 });
    const n = g.player.count(ammo[1]); assert(g.craft(ammo[0])); assert.strictEqual(g.player.count(ammo[1]), n + 3, `${era}: one arrow fewer away from a workshop`);
    assert(g.craft('shield')); const s = g.player.inventory.find((i) => i.id === 'shield');
    assert.strictEqual(s.dur, Math.ceil(g.item_def('shield').durability * 0.6));
    assert(g.craft('pike') && g.player.count('pike') === 1);
    if (era !== 'scifi') { assert(g.craft('bow') && g.player.count('bow') >= 1); }
    assert(!g.item_def('shield').tags.includes('loot') && g.item_def('shield').tags.includes('crafted'));
  }
}
{ // a shield in the off hand turns blows; not with a weapon that needs both hands; it wears out
  const g = calm({}); const p = g.player, lv = g.level;
  give(g, { wood: 5, scrap: 2 }); g.craft('shield'); assert(g.equip(p.inventory.findIndex((i) => i.id === 'shield'))); assert(p.shield && p.shield.id === 'shield');
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 1, p.y, 2), 'walker', false); z.acc = 1000;
  p.weapon = OB.make_item('shiv', 1, 30);
  let hits = 0, blocked = 0, start = p.shield.dur;
  for (let i = 0; i < 400 && p.shield; i++) { const hp = p.hp; OB.zombie_attack(g, z); if (p.hp < hp) hits++; else blocked++; p.infected = false; p.bleeding = 0; }
  assert(blocked > 0 && hits > blocked, `${blocked} blocked, ${hits} hits`); assert(!p.shield || p.shield.dur < start, 'blocking wears it');
  const h = calm({}); const q = h.player; give(h, { wood: 5, scrap: 2 }); h.craft('shield'); h.equip(q.inventory.findIndex((i) => i.id === 'shield'));
  q.weapon = OB.make_item('pike', 1, 40); assert(OB.two_handed(h));
  const z2 = OB.spawn_zombie(h, h.level, h.level.free_spot_near(q.x + 1, q.y, 2), 'walker', false);
  for (let i = 0; i < 100; i++) assert(!OB.shield_block(h, z2), 'a pike leaves no hand for the shield');
  q.weapon = OB.make_item('pistol', 1, 40); if (h.items.pistol) assert(!OB.two_handed(h));
}
{ // saves keep the shield; an old save learns the new recipes
  const g = calm({}); give(g, { wood: 5, scrap: 2 }); g.craft('shield'); g.equip(g.player.inventory.findIndex((i) => i.id === 'shield'));
  const d = JSON.parse(OB.serialize_game(g)); d.player.recipes = ['bandage']; const h = OB.deserialize_game(JSON.stringify(d));
  assert(h.player.shield && h.player.recipes.includes('shield') && h.player.recipes.includes('pike'));
  delete d.player.shield; assert.strictEqual(OB.deserialize_game(JSON.stringify(d)).player.shield, null);
}
console.log('crafting: weapons, arrows and shields anywhere, better at a workshop; shields block in the off hand');
