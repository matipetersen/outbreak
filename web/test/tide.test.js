const assert = require('assert');
const { OB, make, empty_level, teleport, quiet } = require('./helpers');

const calm = (g) => { quiet(g); g.player.hp = g.player.max_hp = 1e6; return g; };
const tick = (g, n) => { for (let i = 0; i < n && !g.over; i++) g._tick(); };

{ // a tide instead of a calendar; it waits a little, then rolls, faster on hard
  const g = calm(make({ scenario: 'dash', seed: 3 }));
  assert(g.front && g.front.pos < 0 && g.deadline_days === 0); assert(OB.front_gap(g) > 20);
  assert.strictEqual(g.scenario.final_turns, 0); assert(/tide/i.test(g.scenario.blurb));
  g.clock.turn = g.front.from + 1; const before = g.front.pos; tick(g, 50); assert(g.front.pos > before + 10, 'the tide rolls');
  const h = make({ scenario: 'dash', seed: 3, difficulty: 'hard' }), e = make({ scenario: 'dash', seed: 3, difficulty: 'easy' });
  assert(h.front.speed > g.front.speed && e.front.speed < g.front.speed);
  assert(make({ scenario: 'extraction', seed: 3 }).front === null);
  const t = g.front.pos; OB.front_lose_time(g, 40); assert(Math.abs(g.front.pos - t - 40 * g.front.speed) < 1e-9, 'lost time feeds the tide');
}
{ // caught: the dead come from everywhere; far behind it: swallowed
  const g = calm(make({ scenario: 'dash', seed: 3 }));
  g.clock.turn = 400; empty_level(g.world.level);
  g.front.pos = OB.front_along(g, g.player.x, g.player.y) + 5;
  tick(g, 12);
  const zs = g.world.level.actors.filter((a) => a.kind === 'zombie' && a.state === 'hunt');
  assert(zs.length >= 3, `the tide sends the dead (${zs.length})`); assert(!g.over);
  g.front.pos = OB.front_along(g, g.player.x, g.player.y) + 40; tick(g, 2);
  assert(g.over && g.over.kind === 'left_behind' && /tide/i.test(g.over.title), g.over && g.over.title);
}
{ // near the way out it starts loading; miss it and it leaves; reach the doors and you are out
  const g = calm(make({ scenario: 'dash', seed: 3 })), pad = g.pois[g.pad_id];
  g.clock.turn = 400; OB.gen_near(g, pad.x, pad.y); g.front.pos = -1e6;
  teleport(g, 'world', g.world.level.free_spot_near(pad.x, pad.y + 12, 4)); empty_level(g.world.level); g.hordes.length = 0;
  tick(g, 1); assert(g.front.depart > 0, 'the transport starts loading'); assert(g.front.pos > -1e6, 'the tide closes in for the last stretch');
  g.front.pos = -1e6; for (let i = 0; i < 62 && !g.over; i++) { empty_level(g.world.level); g.hordes.length = 0; g.player.infected = false; g._tick(); }
  assert(g.over && g.over.kind === 'left_behind' && /ramp/i.test(g.over.title), g.over && g.over.title);

  const w = calm(make({ scenario: 'dash', seed: 3 })), wp = w.pois[w.pad_id];
  OB.gen_near(w, wp.x, wp.y); teleport(w, 'world', w.world.level.free_spot_near(wp.x, wp.y + 1, 3));
  w._use_portal(wp.x, wp.y);
  assert(w.over && w.over.victory); assert.strictEqual(w.over.scenes.length, 4); assert(w.over.scenes[0].includes('gate'));
  assert(OB.CONTENT.win_endings['dash|survivor'][0] === w.over.title || w.over.title.startsWith('Outran') || w.over.title === 'First aboard');
}
{ // buildings behind the tide fill with the dead
  const a = calm(make({ scenario: 'dash', seed: 3 })), b = calm(make({ scenario: 'dash', seed: 3 }));
  const poi = Object.values(a.pois).filter((q) => q.kind !== 'house' && !OB.SPECIAL_KINDS.includes(q.kind)).sort((x, y) => OB.front_along(a, x.x, x.y) - OB.front_along(a, y.x, y.y))[0];
  a.front.pos = OB.front_along(a, poi.x, poi.y) + 10; OB.front_overrun(a);
  assert(a.pois[poi.id].overrun && !b.pois[poi.id].overrun);
  const za = a.ensure_level(poi.id + ':0').actors.filter((z) => z.kind === 'zombie').length, zb = b.ensure_level(poi.id + ':0').actors.filter((z) => z.kind === 'zombie').length;
  assert(za > zb, `overrun ${za} vs ${zb}`);
}
{ // the Director follows the road; a Dash saved before the tide gets one on load; the HUD can say where it is
  const g = calm(make({ scenario: 'dash', seed: 3 })), pad = g.pois[g.pad_id];
  const early = OB.dir_progress(g); OB.gen_near(g, pad.x, pad.y); teleport(g, 'world', g.world.level.free_spot_near(pad.x, pad.y + 30, 6));
  assert(OB.dir_progress(g) > early + 0.3);
  const d = JSON.parse(OB.serialize_game(g)); delete d.front; d.deadline_days = 9;
  const h = OB.deserialize_game(JSON.stringify(d)); assert(h.front && h.deadline_days === 0);
  assert(/behind/.test(OB.front_status(g)));
  assert(g.objectives().some((o) => /board the transport/i.test(o[0])));
}
{ // hardcore: the next survivor gets a race of their own, not an instant death
  const g = calm(make({ scenario: 'dash', seed: 3, mode: 'living' }));
  g.clock.turn = 900; g.front.pos = OB.front_along(g, g.player.x, g.player.y) + 20;
  OB.damage_player(g, 2e6, 'killed by the tide');
  assert(!g.over && g.generation === 2); assert(OB.front_gap(g) >= 30, `new survivor starts ahead of the tide (${OB.front_gap(g)})`);
  g.player.hp = g.player.max_hp = 1e6; tick(g, 5); assert(!g.over);
}
console.log('tide: Dash is a race against a moving front, with a boarding instead of a siege');
