const assert = require('assert');
const { OB, make, empty_level, teleport, quiet } = require('./helpers');

const world = (seed = 3, cfg = {}) => { const g = quiet(make(Object.assign({ scenario: 'endless', seed }, cfg))); g.player.hp = g.player.max_hp = 1e6; return g; };
const day = (g, d) => { g.clock.turn = (d - 1) * 240; };
const outpost = (g, owner) => Object.values(g.saga.outposts).find((o) => o.owner === owner);
// Stand in a building nobody holds, cleared, and make it the base.
function base(g, cots = 2) {
  const poi = Object.values(g.pois).find((q) => q.kind === 'market' && !OB.outpost_of(g, q.id) && !q.component);
  const lv = teleport(g, poi.id + ':0'); empty_level(lv);
  assert.strictEqual(OB.can_claim(g), ''); assert(g.claim_base());
  let n = 0;
  for (let k = 0; k < lv.w * lv.h && n < cots; k++) if (lv.tiles[k] === OB.T.FLOOR && !lv.occ.has(k)) { lv.tiles[k] = OB.T.BED; lv.built[k] = 'cot'; n++; }
  return lv;
}
const stash = (g, lv, id, qty) => lv.stash.push(OB.make_item(id, qty));

{ // only in endless, never in the shared world; a handful of outposts, every faction somewhere
  const g = world();
  assert(g.saga && !make({ scenario: 'cure', seed: 3 }).saga && !make({ scenario: 'dash', seed: 3 }).saga);
  const os = Object.values(g.saga.outposts);
  assert(os.length >= 5 && os.length <= 12, `${os.length} outposts`);
  for (const f of OB.SAGA_FACTIONS) assert(os.some((o) => o.owner === f), `${f} holds nothing`);
  for (const o of os) assert(!g.pois[o.id].component && OB.cheb(OB.poi_pos(g.pois[o.id]), g.world.start) >= 25);
  assert(/Claim a base/.test(g.objectives()[0][0])); assert(g.objectives().some((o) => /The cure/.test(o[0])));
  assert(/phases/.test(g.scenario.blurb));
}
{ // phases change the rules; the soldiers come apart when the holdouts begin
  const g = world();
  assert.strictEqual(OB.saga_phase(g).id, 'collapse'); assert.strictEqual(OB.saga_mod(g, 'forage'), 1.0);
  day(g, 30); assert.strictEqual(OB.saga_phase(g).id, 'winter'); assert(OB.saga_mod(g, 'forage') < 1 && OB.saga_mod(g, 'price') > 1);
  const w = world(); const mil = OB.outposts_of(w, 'military').length, raid = OB.outposts_of(w, 'raiders').length;
  day(w, 13); OB.saga_daily(w);
  assert(w.saga.deserted); assert(OB.outposts_of(w, 'military').length < mil || mil === 0); assert(OB.outposts_of(w, 'raiders').length >= raid);
  assert(w.log.some((m) => /The Holdouts/.test(m[1])));
  assert(OB.saga_special_boost(w) > OB.saga_special_boost(world()), 'more of the strange ones later on');
}
{ // a month of the city on its own: factions move, fight and fall, and it gets written down
  const g = world(5);
  for (let d = 2; d <= 32; d++) { day(g, d); OB.saga_daily(g); OB.saga_events_tick(g); }
  assert(g.saga.log.length > 10);
  assert(g.saga.log.some((l) => /moved into|fought|took|fallen/.test(l[1])), 'nothing happened in a month');
  for (const fs of Object.values(g.saga.factions)) assert(fs.str >= 0 && fs.str <= 100 && fs.sup <= OB.FACTION_SUP_CAP);
}
{ // inside an outpost: a garrison on the ground floor, someone in charge, none of the dead
  const g = world(), o = outpost(g, 'military');
  const lv = g.ensure_level(o.id + ':0'); OB.outpost_sync(g, lv);
  const people = lv.actors.filter((a) => a.outpost === o.id);
  assert.strictEqual(people.filter((a) => a.role !== 'warden').length, Math.min(5, o.garrison)); assert(people.some((a) => a.role === 'warden'));
  assert(!lv.actors.some((a) => a.kind === 'zombie')); assert(people.every((a) => !a.hostile && a.faction === 'military')); assert(lv.safe);
  const r = outpost(g, 'raiders'), rl = g.ensure_level(r.id + ':0'); OB.outpost_sync(g, rl);
  assert(rl.actors.filter((a) => a.outpost === r.id).every((a) => a.hostile), 'a raider den is hostile'); assert(!rl.safe);
  o.garrison = 1; OB.outpost_sync(g, lv); assert.strictEqual(lv.actors.filter((a) => a.outpost === o.id && a.role !== 'warden').length, 1);
  teleport(g, lv.id); assert(/hold this place/.test(OB.can_claim(g)), 'you cannot claim somebody else\'s building');
}
{ // the gate: a voice behind a barricade, and what you do about it
  const enter = (g, o) => { const q = g.pois[o.id]; OB.gen_near(g, q.x, q.y); teleport(g, 'world', g.world.level.free_spot_near(q.x, q.y + 1, 2)); g._use_portal(q.x, q.y); return g.pending_event; };
  let g = world(), o = outpost(g, 'science');
  let ev = enter(g, o);
  assert(ev && ev.event_id === 'saga' && ev.data.kind === 'gate' && ev.data.choices.length === 5);
  g.player.coins = 50; g.resolve_event(1); assert(o.admitted && g.player.coins < 50 && !g.pending_event);
  g = world(); o = outpost(g, 'science'); enter(g, o); g.resolve_event(3);
  assert.strictEqual(g.level, g.world.level, 'backed out'); assert(!o.admitted);
  g = world(); o = outpost(g, 'science'); enter(g, o); const rep = g.rep.science; g.resolve_event(4);
  assert(o.hostile && g.rep.science < rep && g.level.actors.filter((a) => a.outpost === o.id).every((a) => a.hostile));
  g = world(); o = outpost(g, 'enclave'); assert(!enter(g, o), 'friends walk straight in'); assert(o.admitted);
}
{ // turn on one of them and they all turn; kill them all and the building is empty, and yours to claim
  const g = world(), o = outpost(g, 'cult'), lv = g.ensure_level(o.id + ':0');
  teleport(g, lv.id); OB.outpost_sync(g, lv);
  const guard = lv.actors.find((a) => a.outpost === o.id && a.role !== 'warden');
  g.make_hostile(guard);
  assert(o.hostile && lv.actors.filter((a) => a.outpost === o.id).every((a) => a.hostile));
  for (const a of lv.actors.filter((x) => x.outpost === o.id)) lv.remove_actor(a);
  OB.outpost_check_taken(g); assert(!o.owner && o.garrison === 0); assert.strictEqual(OB.can_claim(g), '');
}
{ // the one in charge: what they need, who they can spare
  const g = world(), o = outpost(g, 'military'), lv = g.ensure_level(o.id + ':0');
  teleport(g, lv.id); OB.outpost_sync(g, lv);
  const boss = lv.actors.find((a) => a.role === 'warden');
  assert(/Earn it/.test(OB.outpost_recruit(g, boss)));
  g.give_item(OB.make_item('food', 2)); const rep = g.rep.military; OB.outpost_help(g, boss); assert(g.rep.military > rep && g.player.count('food') === 0);
  g.rep.military = 20; o.garrison = 4; g.companion_uid = 0;
  for (const a of g.world.level.actors.filter((x) => x.kind === 'human' && x.state === 'follow')) g.world.level.remove_actor(a);
  OB.outpost_recruit(g, boss); assert(OB.comp_current(g), 'someone comes along'); assert.strictEqual(o.garrison, 3);
  assert(/Not again/.test(OB.outpost_recruit(g, boss)));
  o.sick_until = g.clock.turn + 100; g.give_item(OB.make_item('bandage', 2)); OB.outpost_help(g, boss); assert(!o.sick_until, 'medicine breaks the fever');
}
{ // your people: a companion stays behind, someone comes out with you, beds limit how many
  const g = world(), lv = base(g, 2);
  assert.strictEqual(OB.saga_capacity(g), 5);
  const c = OB.comp_stranger(g, lv.free_spot_near(g.player.x, g.player.y, 3)); c.level_id = lv.id; lv.add_actor(c); OB.saga_recruit_here(g, c, 30);
  assert(OB.comp_current(g) === c && lv.actors.includes(c), 'recruited indoors, they stay beside you');
  assert(/keep the place/.test(OB.saga_station(g, c))); assert(!OB.comp_current(g)); assert.strictEqual(g.saga.residents.length, 1);
  const r = g.saga.residents[0]; assert.strictEqual(r.name, c.name);
  OB.saga_take_along(g, r); assert(OB.comp_current(g) && OB.comp_current(g).name === c.name && g.level.actors.includes(OB.comp_current(g)));
  assert.strictEqual(g.saga.residents.length, 0);
  for (let i = 0; i < 5; i++) OB.saga_add_resident(g, null, 'enclave');
  assert(/no bed/.test(OB.saga_station(g, OB.comp_current(g))));
  assert(/greenhouse/i.test(OB.saga_set_job(g, g.saga.residents[0], 'farm')));
}
{ // every morning: they eat from the locker, work, and come back with things (or do not)
  const g = world(), lv = base(g, 2);
  const a = OB.saga_add_resident(g, null), b = OB.saga_add_resident(g, null);
  a.job = 'scavenge'; b.job = 'build'; a.arch = 'scavenger'; b.arch = 'veteran';
  stash(g, lv, 'food', 3); g.saga.building = 'radio'; g.saga.progress.radio = 0;
  g.clock.turn = 240 + 60; OB.saga_morning(g);
  assert.strictEqual(lv.stash.filter((i) => i.id === 'food').reduce((s, i) => s + i.qty, 0) <= 1, true);
  assert.strictEqual(g.saga.progress.radio, 1);
  assert(g.log.some((m) => /Morning at the base/.test(m[1])));
  const hungry = world(), hl = base(hungry, 1), h = OB.saga_add_resident(hungry, null); h.morale = 10;
  hungry.clock.turn = 300; OB.saga_morning(hungry); assert.strictEqual(hungry.saga.residents.length, 0, 'unfed and unhappy, they leave');
  let got = 0;
  for (let s = 1; s < 30; s++) { const w = world(s % 5 + 3), wl = base(w, 2), r = OB.saga_add_resident(w, null); r.job = 'scavenge'; stash(w, wl, 'food', 2); w.clock.turn = 300 + 240 * s; OB.saga_morning(w); got += wl.stash.filter((i) => i.id !== 'food').length; }
  assert(got > 5, `scavengers brought back ${got} things`);
}
{ // projects: materials from pack and locker, days of work, prerequisites
  const g = world(), lv = base(g, 2);
  assert(/missing/.test(OB.saga_project_status(g, OB.SAGA_PROJECT_BY_ID.radio)[1]));
  g.give_item(OB.make_item('scrap', 2)); stash(g, lv, 'scrap', 2); stash(g, lv, 'wood', 3);
  assert.strictEqual(OB.saga_start_project(g, 'radio'), ''); assert.strictEqual(g.saga.building, 'radio');
  assert.strictEqual(g.player.count('scrap'), 0); assert(!lv.stash.some((i) => i.id === 'wood'));
  assert(/finish/.test(OB.saga_project_status(g, OB.SAGA_PROJECT_BY_ID.watchtower)[1]));
  for (let i = 0; i < 4; i++) OB.saga_work(g);
  assert(OB.saga_built(g, 'radio') && !g.saga.building);
  assert(/needs the generator/.test(OB.saga_project_status(g, OB.SAGA_PROJECT_BY_ID.lab)[1]));
}
{ // away from home at midnight: the guards hold, or the dead get in
  const g = world(), lv = base(g, 2); teleport(g, 'world', g.world.start);
  for (let i = 0; i < 6; i++) stash(g, lv, 'scrap', 1);
  let broke = 0;
  for (let i = 0; i < 40; i++) { day(g, 20 + i); OB.saga_night_raid(g); }
  broke = 6 - lv.stash.length; assert(broke > 0, 'nobody home: the dead took things');
  const h = world(), hl = base(h, 2); teleport(h, 'world', h.world.start);
  for (let i = 0; i < 4; i++) OB.saga_add_resident(h, null).job = 'guard';
  h.saga.built.push('wall', 'watchtower'); stash(h, hl, 'scrap', 6);
  day(h, 5); for (let i = 0; i < 20; i++) OB.saga_night_raid(h);
  assert.strictEqual(hl.stash[0].qty, 6, 'four guards behind a wall hold an early night');
}
{ // every world event can be scheduled, start, run and end
  for (const id of Object.keys(OB.SAGA_EVENTS)) {
    const g = world(7); day(g, 20); OB.saga_daily(g);
    if (id === 'refuge_falls') base(g, 1);
    const def = OB.SAGA_EVENTS[id], data = def.pick ? def.pick(g) : {};
    if (!data) continue;
    const e = { id, at: g.clock.turn, until: g.clock.turn + 30, data, started: false };
    g.saga.events = [e];
    OB.saga_events_tick(g); assert(e.started, id);
    for (let i = 0; i < 4; i++) { g.clock.turn += 10; OB.saga_events_tick(g); }
    assert(!g.saga.events.includes(e), `${id} never ended`);
  }
}
{ // what they do: a drop on the map, the grey, the cold, a firebreak, the refuge falling
  const g = world(); const e = { id: 'airdrop', at: 0, until: 9999, data: OB.SAGA_EVENTS.airdrop.pick(g), started: false };
  g.saga.events = [e]; OB.saga_events_tick(g);
  const k = g.world.level.idx(e.data.x, e.data.y); assert(g.world.level.containers[k] && g.world.level.tiles[k] === OB.T.CRATE);
  assert(OB.saga_markers(g).some((m) => m[0] === e.data.x && m[1] === e.data.y));
  const f = world(); f.saga.events = [{ id: 'fog', at: 0, until: 9999, data: {}, started: false }]; OB.saga_events_tick(f); f.weather = 'clear'; OB.weather_tick(f); assert.strictEqual(f.weather, 'fog');
  const c = world(); const forage = OB.saga_mod(c, 'forage'); c.saga.events = [{ id: 'cold', at: 0, until: 9999, data: {}, started: false }]; OB.saga_events_tick(c);
  assert(OB.saga_mod(c, 'forage') < forage && OB.saga_mod(c, 'zombie_speed') < 1);
  const b = world(); const bd = OB.SAGA_EVENTS.bombing.pick(b); const hit = b.pois[bd.poi]; b.saga.events = [{ id: 'bombing', at: 0, until: 9999, data: bd, started: false }]; OB.saga_events_tick(b);
  assert(hit.burned); const blv = b.ensure_level(hit.id + ':0'); assert(Object.values(blv.containers).every((x) => x.opened && !x.loot.length));
  const r = world(); const home = base(r, 1); r.saga.events = [{ id: 'refuge_falls', at: 0, until: 9999, data: {}, started: false }]; OB.saga_events_tick(r);
  const rl = r.ensure_level(r.refuge_id + ':0'); assert(r.saga.refuge_fallen && !rl.actors.some((a) => a.role === 'trader') && !rl.safe);
  assert(home);
}
{ // the warlord sits in a den; killing them breaks the raiders
  const g = world(); day(g, 15);
  const data = OB.SAGA_EVENTS.warlord.pick(g); g.saga.events = [{ id: 'warlord', at: 0, until: 1e9, data, started: false }]; OB.saga_events_tick(g);
  const W = g.saga.warlord, lv = g.ensure_level(W.seat + ':0'); OB.outpost_sync(g, lv);
  const boss = lv.actors.find((a) => a.warlord); assert(boss && boss.hostile && boss.name === W.name);
  const str = g.saga.factions.raiders.str; lv.remove_actor(boss); OB.saga_warlord_check(g);
  assert(W.dead && g.saga.factions.raiders.str < str);
}
{ // sieges: a call for help, the dead at someone else's door, and the thanks for breaking it
  const g = world(); day(g, 8);
  const o = outpost(g, 'enclave'), q = g.pois[o.id]; o.siege_until = g.clock.turn + 480;
  OB.gen_near(g, q.x, q.y); teleport(g, 'world', g.world.level.free_spot_near(q.x, q.y + 10, 3));
  OB.saga_sieges_tick(g); const zs = g.world.level.actors.filter((a) => a.siege === o.id);
  assert(zs.length >= 4 && o.siege_spawned);
  const rep = g.rep.enclave; for (const z of zs) g.world.level.remove_actor(z); OB.saga_sieges_tick(g);
  assert(!o.siege_until && g.rep.enclave > rep);
  const h = world(); day(h, 8); const ho = outpost(h, 'enclave'); ho.siege_until = h.clock.turn; ho.garrison = 2; OB.saga_sieges_daily(h, []); assert(ho.garrison === 0 && ho.overrun, 'nobody came');
}
{ // choices the world puts to you: a war, the procession, refugees at the door
  const g = world(); g.saga.queue.push({ kind: 'war', title: 'War', a: 'military', b: 'science', text: 'x', choices: [{ label: 'a', needs: {} }, { label: 'b', needs: {} }, { label: 'c', needs: {} }] });
  OB.saga_flush_queue(g); assert(g.pending_event && g.pending_event.data.kind === 'war');
  g.resolve_event(0); assert(g.rep.military >= 15 && g.rep.science <= -20);
  const p = world(); const po = outpost(p, 'enclave'); p.saga.events = [{ id: 'procession', at: 0, until: 1e9, data: { target: po.id, met: false, stopped: false }, started: true }];
  p.saga.queue.push({ kind: 'procession', title: 'x', target: po.id, text: 'x', choices: [{ label: 'a', needs: {} }, { label: 'b', needs: {} }] });
  OB.saga_flush_queue(p); p.resolve_event(0);
  assert(p.saga.events[0].data.stopped && p.level.actors.some((a) => a.faction === 'cult' && a.hostile));
  const r = world(); base(r, 2); OB.saga_refugees(r); OB.saga_flush_queue(r); r.resolve_event(0); assert(r.saga.residents.length >= 1);
}
{ // the endings: a final stand at your base, with no door to run for
  const g = world(), lv = base(g, 2);
  g.saga.built.push('generator', 'lab'); g.saga.research = 100; g.formula_found = true; g.know.known = new Set(g.know.vocab);
  for (const r of g.scenario.requirements) g.give_item(OB.make_item(r.id, 1));
  const cure = OB.saga_endings(g).find((e) => e.id === 'cure'); assert(cure.ready);
  assert.strictEqual(OB.saga_begin_ending(g, 'cure'), ''); assert(g.final && g.final.no_exit);
  for (let i = 0; i < 70 && !g.over; i++) { empty_level(lv); g.wait(1); }
  assert(g.over && g.over.victory, g.over && g.over.title); assert.strictEqual(g.win_kind, 'cure');
  assert(g.over.scenes[0].includes(lv.name.split(' - ')[0]) || g.over.scenes[0].includes('vial'));
  const x = world(), xl = base(x, 2); OB.saga_add_resident(x, null); x.saga.built.push('vehicle');
  OB.saga_begin_ending(x, 'exodus'); for (let i = 0; i < 50 && !x.over; i++) { empty_level(xl); x.wait(1); }
  assert(x.over && x.over.victory && /Exodus|Gone/.test(x.over.title), x.over && x.over.title);
  assert(x.over.summary.some((l) => /Your people: 1/.test(l)));
  const s = world(); base(s, 1); s.saga.built.push('radio'); day(s, 21);
  s.rep.enclave = 40; s.rep.military = 40; s.rep.science = 40; s.rep.cult = 40;
  assert.strictEqual(OB.saga_endings(s).find((e) => e.id === 'sanctuary').ready, OB.saga_allies(s) >= 3);
  const old = world(); const bench = old.ensure_level(old.refuge_id + ':0'); teleport(old, bench.id); assert(!old.use_bench(true), 'the refuge bench is cold in endless');
}
{ // it all survives a save; an endless world saved before all this gets a city on load
  const g = world(), lv = base(g, 2); OB.saga_add_resident(g, null).job = 'guard'; g.saga.built.push('radio');
  g.saga.events.push({ id: 'cold', at: 0, until: 9999, data: {}, started: true });
  const h = OB.deserialize_game(OB.serialize_game(g));
  assert.deepStrictEqual(h.saga.residents.map((r) => r.job), ['guard']); assert(OB.saga_built(h, 'radio') && OB.saga_event_on(h, 'cold'));
  assert.strictEqual(Object.keys(h.saga.outposts).length, Object.keys(g.saga.outposts).length);
  const d = JSON.parse(OB.serialize_game(world())); delete d.saga; assert(OB.deserialize_game(JSON.stringify(d)).saga);
  assert(lv);
}
{ // forty days of the whole thing running, quietly
  const g = world(9), p = g.player, t0 = Date.now();
  for (let i = 0; i < 240 * 40; i++) {
    if (i % 25 === 0) { for (const a of g.level.actors.slice()) if (a.kind === 'zombie' || (a.kind === 'human' && a.hostile)) g.level.remove_actor(a); g.hordes.length = Math.min(g.hordes.length, 4); }
    g.pending_event = null; p.hp = p.max_hp; p.infected = false; p.bleeding = 0;
    g.wait(1);
    assert(!g.over, g.over && g.over.title);
  }
  assert(g.saga.log.length > 10 && OB.saga_phase_index(g) >= 3);
  assert(Date.now() - t0 < 60000, 'too slow');
}
console.log('saga: the endless world has phases, factions, outposts, people, projects, events and three ways to end');
