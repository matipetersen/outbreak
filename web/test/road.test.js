const assert = require('assert');
const { OB, make, empty_level, teleport } = require('./helpers');

function calm(g) { empty_level(g.world.level); g.hordes.length = 0; g.ring = null; return g; }

// dash: no parts, a road with incidents
for (const era of Object.keys(OB.CONTENT.eras)) {
  const g = make({ era, scenario: 'dash', seed: 3 });
  assert.strictEqual(g.scenario.requirements.length, 0); assert(g.requirements_met());
  assert.strictEqual(g.incidents.length, 5); assert(g.deadline_days >= 8);
}
// the deadline follows the route
{
  const small = make({ scenario: 'extraction', seed: 3, map_w: 120, map_h: 76 }), big = make({ scenario: 'extraction', seed: 3 });
  assert(small.deadline_days >= small.scenario.deadline_days); assert(big.deadline_days > small.deadline_days);
  assert(big.deadline_days > 10, 'ten days is not enough to gather three parts and cross the map');
  assert.strictEqual(make({ scenario: 'cure', seed: 3 }).deadline_days, 0);
}
// incidents fire once when you get close, and are not random events
{
  const g = calm(make({ scenario: 'dash', seed: 3 })), inc = g.incidents[0];
  OB.gen_near(g, inc.x, inc.y);
  teleport(g, 'world', g.world.level.free_spot_near(inc.x, inc.y, 4));
  g._check_incidents();
  assert(g.pending_event); assert.strictEqual(g.pending_event.event_id, inc.event); assert(inc.done);
  g.pending_event = null; g._check_incidents(); assert(!g.pending_event, 'fires once');
  g.clock.turn = 5000;
  for (let i = 0; i < 200; i++) assert(!OB.pick_event(g).id.startsWith('road_'));
}
// every road event choice resolves, and lost time counts against the deadline
{
  const evs = OB.CONTENT.events.filter((e) => e.id.startsWith('road_'));
  assert.strictEqual(evs.length, 6);
  for (const ev of evs) for (let i = 0; i < ev.choices.length; i++) {
    const g = calm(make({ scenario: 'dash', seed: 3 }));
    g.player.coins = 50; for (const [id, q] of [['food', 3], ['noisemaker', 1], ['bandage', 2]]) g.give_item(OB.make_item(id, q));
    g.pending_event = OB.start_event(g, ev);
    const lost = g.lost_turns;
    g.resolve_event(i);
    assert(!(g.over && g.over.kind === 'dead'), `${ev.id}/${i} killed the player outright`);
    const ch = ev.choices[i];
    if (ch.outcomes.length === 1 && 'time' in ch.outcomes[0].fx) assert(g.lost_turns > lost, `${ev.id}/${i}: lost time not counted`);
  }
  const g = calm(make({ scenario: 'dash', seed: 3 }));
  g.clock.turn = (g.deadline_days - 1) * 240 + 100; g.wait(3); assert(!g.over);
  g.lost_turns = 240 * 3; g.clock.turn = (g.deadline_days - 3) * 240 + 238; g.wait(5);
  assert(g.over && g.over.kind === 'left_behind');
}
// the new fields survive a save
{
  const g = make({ scenario: 'dash', seed: 3 }); g.lost_turns = 55; g.incidents[1].done = true;
  const g2 = OB.deserialize_game(OB.serialize_game(g));
  assert.strictEqual(g2.lost_turns, 55); assert.strictEqual(g2.deadline_days, g.deadline_days); assert(g2.incidents[1].done);
}
console.log('road: dash, route-based deadline and road incidents OK');
