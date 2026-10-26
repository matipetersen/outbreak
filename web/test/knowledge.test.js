const assert = require('assert');
const { OB, make, quiet, teleport, empty_level } = require('./helpers');

const world = () => { const g = quiet(make({ scenario: 'endless', seed: 3 })); g.player.hp = g.player.max_hp = 1e6; return g; };
const since = (g, n) => g.log.slice(n).map((m) => m[1]).join('\n');

{ // people speak of how long it has been by the calendar: no rank lost "on day three" on day one
  const g = make({ seed: 3 }); g.clock.turn = 100;
  for (const role of ['soldier', 'trader', 'healer', 'scout', 'survivor']) {
    for (const p of OB.CONTENT.dialogue.PERSONAS[role]) {
      for (const line of [].concat(p.bio, p.again, [p.first, p.hurt, p.night, p.company, p.sick])) {
        const said = OB.dlg_era(g, line);
        assert(!/day three|weeks ago|first month|every Sunday|every week|a while since|since the first night/.test(said), `${role} on day one: ${said}`);
      }
    }
  }
  for (const a of OB.COMP.archetypes) for (const b of a.backstory) assert(!/for two days when/.test(OB.dlg_when(g, b)), b);
  g.clock.turn = 240 * 30; assert(/weeks ago/.test(OB.dlg_when(g, 'a radio that stopped talking weeks ago')), 'later on, the original line stands');
}
{ // the daily news only carries what you could know: places you have seen, been told of, or can hear
  const g = world(), S = g.saga, n = g.log.length;
  const far = Object.values(S.outposts).find((o) => !g.pois[o.id].revealed && OB.cheb(OB.poi_pos(g.pois[o.id]), [g.player.x, g.player.y]) > 40) ||
              Object.values(S.outposts).find((o) => OB.cheb(OB.poi_pos(g.pois[o.id]), [g.player.x, g.player.y]) > 40);
  g.pois[far.id].revealed = false; g.pois[far.id].visited = false;
  far.siege_until = g.clock.turn; far.garrison = 5;                       // it held off a siege today, unseen
  g.clock.turn = 240; OB.saga_daily(g);
  assert(!since(g, n).includes(g.pois[far.id].name), 'heard about a place you do not know');
  assert(!S.log.some((l) => l[1].includes(g.pois[far.id].name)), 'it went into your log anyway');
  g.pois[far.id].revealed = true; far.siege_until = g.clock.turn + 240; g.clock.turn += 240; OB.saga_daily(g);
  assert(since(g, n).includes(g.pois[far.id].name), 'a place you know is news');
  const r = world(); r.saga.built.push('radio'); const ro = Object.values(r.saga.outposts)[0]; r.pois[ro.id].revealed = false; ro.siege_until = r.clock.turn; ro.garrison = 5;
  const m = r.log.length; r.clock.turn = 240; OB.saga_daily(r); assert(since(r, m).includes(r.pois[ro.id].name), 'with a radio you hear it all');
}
{ // events about people you have never met stay silent; public ones are announced; what an NPC tells you, you know
  const g = world(), S = g.saga, o = Object.values(S.outposts).find((x) => x.owner === 'enclave');
  g.pois[o.id].revealed = false; g.pois[o.id].visited = false; g.player.x = 5; g.player.y = 5;
  const e = { id: 'plague', at: 0, until: 9999, data: { id: o.id }, started: false };
  e.known = OB.SAGA_EVENTS.plague.knows(g, e); S.events = [e]; const n = g.log.length; OB.saga_events_tick(g);
  assert(!e.known && !g.pois[o.id].revealed && !since(g, n).includes(g.pois[o.id].name));
  assert(!OB.saga_markers(g).length);
  const w = { id: 'war', at: 0, until: 9999, data: { a: 'military', b: 'science' }, started: false }; w.known = OB.SAGA_EVENTS.war.knows(g, w);
  S.events = [w]; OB.saga_events_tick(g); assert(!S.queue.length, 'strangers do not send for you');
  OB.saga_meet(g, 'military'); OB.saga_meet(g, 'science'); const w2 = { id: 'war', at: g.clock.turn, until: 99999, data: { a: 'military', b: 'science' }, started: false };
  S.events = [w2]; OB.saga_events_tick(g); assert(w2.known && S.queue.length === 1);
  const scout = { kind: 'human', uid: 1001, name: 'Sentry', role: 'scout', faction: 'enclave', x: 1, y: 1, hp: 30, max_hp: 30 };
  const near = Object.values(S.outposts).find((x) => x.owner && OB.cheb(OB.poi_pos(g.pois[x.id]), [g.player.x, g.player.y]) <= 70);
  if (near) { g.pois[near.id].revealed = false; for (let i = 0; i < 20 && !g.pois[near.id].revealed; i++) OB.dlg_news(g, scout); assert(g.pois[near.id].revealed, 'told about it, now on the map'); }
}
{ // what happens at your base while you are away, you hear when you get back
  const g = world(), poi = Object.values(g.pois).find((q) => q.kind === 'market' && !OB.outpost_of(g, q.id) && !q.component);
  const lv = teleport(g, poi.id + ':0'); empty_level(lv); g.claim_base();
  lv.stash.push(OB.make_item('food', 10)); OB.saga_add_resident(g, null);
  teleport(g, 'world', g.world.start); const n = g.log.length;
  g.clock.turn = 240 * 5 + 60; OB.saga_morning(g);
  assert(!since(g, n).includes('Morning at the base'), 'you are not there to hear it');
  const k = Object.keys(lv.portals).find((kk) => lv.portals[kk].target === 'world');
  OB.gen_near(g, poi.x, poi.y); teleport(g, 'world', g.world.level.free_spot_near(poi.x, poi.y + 1, 2)); g._use_portal(poi.x, poi.y);
  assert(since(g, n).includes('While you were away') && since(g, n).includes('Morning at the base')); assert(k);
}
console.log('knowledge: news needs a source, and people speak of time by the calendar');
