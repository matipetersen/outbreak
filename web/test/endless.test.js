const assert = require('assert');
const { OB, make } = require('./helpers');

{ // no deadline, no infection, the cure is optional
  const g = make({ scenario: 'endless', seed: 3 });
  assert.strictEqual(g.deadline_days, 0); assert(!g.player.infected); assert.strictEqual(g.scenario.final_site, 'refuge');
  assert.strictEqual(Object.values(g.pois).filter((q) => q.component).length, 3);
  for (let i = 0; i < 240 * 14; i++) { g.clock.turn++; g._time_events(); }
  assert(!g.over);
}
{ // pressure grows with the days, only in endless
  const e = make({ scenario: 'endless', seed: 3 }), c = make({ scenario: 'cure', seed: 3 });
  assert.strictEqual(e.pressure, 1.0); e.clock.turn = 240 * 20; c.clock.turn = 240 * 20;
  assert(e.pressure > 1.8); assert.strictEqual(c.pressure, 1.0); e.clock.turn = 240 * 400; assert.strictEqual(e.pressure, 3.0);
}
{ // tougher dead, lifted level cap
  const g = make({ scenario: 'endless', seed: 3 });
  const early = OB.make_zombie(g, 'walker', 5, 5, true).max_hp; g.clock.turn = 240 * 30;
  const late = OB.make_zombie(g, 'walker', 5, 5, true).max_hp; assert(late > early * 1.25);
  assert(OB.level_cap(g) > 15);
}
{ // looted places refill
  const g = make({ scenario: 'endless', seed: 3 }), poi = Object.values(g.pois).find((q) => q.kind === 'market' || q.kind === 'house');
  const lv = g.ensure_level(poi.id + ':0'), ks = Object.keys(lv.containers);
  if (ks.length) {
    for (const k of ks) { lv.containers[k].opened = true; lv.containers[k].loot = []; }
    for (let i = 0; i < 60; i++) g._restock();
    assert(ks.some((k) => !lv.containers[k].opened));
  }
}
{ // dying is a survival result; the cure ends it
  const g = make({ scenario: 'endless', seed: 3 }); g.clock.turn = 240 * 9; g.player.hp = 1; OB.damage_player(g, 99, 'killed by a walker');
  assert(g.over.title.startsWith('Survived 10 days'), g.over.title); assert(/killed by a walker/i.test(g.over.text));
  const w = make({ scenario: 'endless', seed: 3 }); w.end('won'); assert(w.over.victory && /ure/.test(w.over.title));
}
console.log('endless: no exit, the dead keep growing, places refill, the cure ends it');
