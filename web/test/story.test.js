const assert = require('assert');
const { OB, make } = require('./helpers');

function field(seed = 3, arch = null) {
  const g = make({ seed }), lv = g.world.level, c = OB.comp_current(g);
  for (const a of lv.actors.slice()) if (a !== c) lv.remove_actor(a);
  g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 500; p.infected = false;
  for (let y = p.y - 10; y <= p.y + 10; y++) for (let x = p.x - 12; x <= p.x + 12; x++) lv.set_tile(x, y, OB.T.GRASS);
  if (arch) { c.trait = ''; OB.comp_ensure_person(g, c, arch); }
  g.clock.turn = 1000;
  return [g, lv, c];
}

{ // a stand leaves a battlefield that remembers
  const [g] = field();
  for (let i = 0; i < 6; i++) { g.clock.turn = 1000 + i * 5; g.player.stats.zombies = (g.player.stats.zombies || 0) + 1; OB.memory_tick(g); }
  const marks = g.marks.filter((m) => m.kind === 'fight'); assert.strictEqual(marks.length, 1);
  g.clock.turn = 3000; marks[0].shown = -9999; const n = g.story.length; OB.memory_tick(g); assert(g.story.length > n);
}
{ // a dead ally is buried; someone who runs is named and comes back; settled when killed
  let [g, lv, c] = field(); const name = c.name; OB.kill_human_other(g, c, OB.spawn_zombie(g, lv, [c.x + 1, c.y], 'walker', false));
  assert(OB.memory_graves(g, g.level.id).length); assert(OB.memory_graves(g, g.level.id)[0].text.includes(name));
  [g, lv] = field(); const r = OB.make_raider(g, g.player.x + 5, g.player.y); lv.add_actor(r); OB.memory_on_flee(g, r); assert(r.title); assert.strictEqual(g.nemeses.length, 1);
  const before = Math.max(...lv.actors.map((a) => a.uid)); g.spawn_raiders_near_player(3); assert(OB.memory_revenge(g, before));
  const back = lv.actors.filter((a) => a.kind === 'human' && a.uid > before && a.name === r.name); assert.strictEqual(back.length, 1); assert(back[0].max_hp > 18); assert(!lv.actors.includes(r));
  OB.kill_human(g, back[0]); assert.strictEqual(g.nemeses.length, 0); assert(g.story.some((m) => m[1].includes('settled')));
  [g, lv] = field(); for (let i = 0; i < 6; i++) { const q = OB.make_raider(g, g.player.x + 3 + i, g.player.y + 1); lv.add_actor(q); OB.memory_on_flee(g, q); OB.memory_on_flee(g, q); } assert(g.nemeses.length <= 3);
}
{ // errands: all archetypes have one; the ask, the find, the scene, the three endings
  const P = OB.CONTENT.companions.personal; for (const a of OB.CONTENT.companions.archetypes) for (const k of ['kind', 'ask', 'found', 'scene', 'give', 'keep', 'read', 'boon']) assert(P[a.id][k], `${a.id}.${k}`);
  let [g, lv, c] = field(3, 'mechanic'); c.bond = 59; assert(!OB.comp_offer_personal(g, c)); c.bond = 70; assert(OB.comp_offer_personal(g, c)); assert.strictEqual(c.quest, 1); assert(g.objectives().some((o) => o[0].includes('errand'))); assert(!OB.comp_offer_personal(g, c));
  const poi = g.pois[g.personal.poi], target = g.ensure_level(`${poi.id}:${poi.floors - 1}`); OB.comp_on_enter(g, target);
  const found = Object.values(target.containers).flatMap((cr) => cr.loot).concat(Object.values(target.items).flat()).filter((i) => i.id === 'keepsake'); assert.strictEqual(found.length, 1);
  g.player.inventory.push({ id: 'keepsake', qty: 1, dur: null, key: true }); g.clock.turn = 1500; OB.comp_tick(g); assert.strictEqual(c.quest, 2);
  g.player.x = c.x + 1; g.player.y = c.y; g.clock.turn = 1505; OB.comp_tick(g); assert(g.pending_event); assert.strictEqual(g.pending_event.event_id, 'story_personal');
  assert.strictEqual(OB.comp_flee_below(c), 0.6); g.resolve_event(0); assert(c.tamed); assert.strictEqual(OB.comp_flee_below(c), 0.3); assert.strictEqual(c.quest, 3); assert(c.bond > 80); assert.strictEqual(g.player.count('keepsake'), 0); assert(OB.comp_describe(c).includes('overcome'));
  for (const [index, expect] of [[1, 'down'], [2, 'up']]) {
    const [h, , c2] = field(3, 'veteran'); c2.bond = 70; OB.comp_offer_personal(h, c2); c2.quest = 2; h.player.inventory.push({ id: 'keepsake', qty: 1, dur: null, key: true });
    h.pending_event = OB.start_event(h, OB.CONTENT.events.find((e) => e.id === 'story_personal'), 'x', { uid: c2.uid }); const b = c2.bond, hu = h.player.humanity; h.resolve_event(index);
    if (expect === 'down') { assert(c2.bond < b - 20); assert(h.player.humanity < hu); } else { assert(c2.bond > b); assert(!c2.tamed); }
  }
  const [g3, , c3] = field(3, 'scavenger'); c3.tamed = true; g3.rng.random = () => 0.0; g3.clock.turn = 50 * 25; const pn = g3.pings.length; OB.comp_tick(g3); assert.strictEqual(g3.pings.length, pn);
}
{ // the Director uses your people
  let [g, lv, c] = field(); const d = OB.dir_state(g); g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', false, '']]; OB.dir_tick(g);
  g.rng.random = () => 0.0; const poi = Object.values(g.pois).find((p) => p.kind === 'market'); g.level = g.ensure_level(`${poi.id}:0`); d.stage = 5; d.inside_since = 900; g.clock.turn = 1000;
  const zs = () => lv.actors.filter((a) => a.kind === 'zombie').length, n = zs(); OB.dir_siege(g, d, 1000); assert(zs() > n); assert(g.story.some((m) => m[1].includes('Through the walls')));
  [g, lv, c] = field(); const d2 = OB.dir_state(g); OB.dir_land(g, d2, 'boss', 1); assert(g.story.some((m) => m[1].includes('heading for ' + c.name)));
  [g, lv, c] = field(); const d3 = OB.dir_state(g); g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', false, '']]; OB.dir_tick(g); d3.phase = 'build'; d3.phase_until = g.clock.turn; d3.pending = []; d3.tension = 0; c.hp = 2; g.clock.turn += 5; OB.dir_tick(g); assert.strictEqual(d3.phase, 'release');
  [g, lv, c] = field(); const d4 = OB.dir_state(g); OB.kill_human_other(g, c, OB.spawn_zombie(g, lv, [c.x + 1, c.y], 'walker', false)); assert.strictEqual(d4.phase, 'release'); assert(d4.phase_until >= g.clock.turn + 190);
  [g, lv, c] = field(); const b = c.bond, d5 = OB.dir_state(g); OB.dir_beat(g, d5, OB.CONTENT.director.stages.find((s) => s.id === 'reward'), g.clock.turn); assert(c.bond > b);
  [g, lv, c] = field(); g.marks.push({ kind: 'grave', x: 1, y: 1, level_id: 'world', turn: 1, text: 'x', shown: -9999 }); const h = OB.deserialize_game(OB.serialize_game(g)); assert.strictEqual(h.marks.length, 1);
}
console.log('story: the world remembers, companions ask for one thing, and the Director leans on the people you love');
{ // a briefing about this run, and a four-frame cutscene for a win
  const { OB, make } = require('./helpers');
  const g = make({ scenario: 'dash', seed: 5 });
  const text = g.intro_pages.find((p) => p[0] === 'Your situation')[1];
  assert(text.includes(OB.comp_current(g).name) && text.includes('Close by:'), 'names your company and your surroundings');
  g.escape_via = 'west door'; g.end('won');
  assert.strictEqual(g.over.scenes.length, 4); assert(g.over.scenes[0].includes('west door')); assert(g.over.scenes[1].includes(OB.comp_current(g).name));
  const h = make({ scenario: 'cure', seed: 5 }); h.end('dead', 'you died'); assert.deepStrictEqual(h.over.scenes, []);
}
{ // people have names and voices, the greeting reads your state, the news is about the world
  const { OB, make } = require('./helpers');
  const g = make({ scenario: 'dash', seed: 3 }); g.player.infected = false;
  const mk = (role, uid) => ({ kind: 'human', uid, name: role, role, faction: 'enclave', x: 1, y: 1, hp: 30, max_hp: 30 });
  const a = mk('healer', 1001), b = mk('healer', 1002);
  assert.notStrictEqual(OB.dlg_persona(a).tag, OB.dlg_persona(b).tag); assert(OB.dlg_title(g, a).endsWith(', healer'));
  const p = OB.dlg_persona(a);
  assert.strictEqual(OB.dlg_greeting(g, a), p.first); g.player.hp = 5; assert.strictEqual(OB.dlg_greeting(g, a), p.hurt);
  g.player.hp = g.player.max_hp; g.player.infected = true; assert.strictEqual(OB.dlg_greeting(g, a), p.sick);
  const s = mk('scout', 1003), seen = new Set(); for (let i = 0; i < 7; i++) seen.add(OB.dlg_news(g, s));
  assert(seen.size > 3 && [...seen].some((t) => t.includes('day')), 'varied news, with the deadline in it');
  const t = mk('trader', 1004); const bio = [0, 1, 2, 3].map(() => OB.dlg_about(g, t));
  assert.strictEqual(new Set(bio.slice(0, 3)).size, 3); assert(bio[3].includes('everything worth telling'));
}
{ // distances in the units of the era
  const { OB } = require('./helpers');
  assert(OB.dist_words('medieval', 5).includes('paces')); assert(OB.dist_words('medieval', 30).includes('furlong')); assert(OB.dist_words('medieval', 300).includes('league'));
  assert(OB.dist_words('eighties', 5).includes('yards')); assert(OB.dist_words('eighties', 40).includes('block')); assert(OB.dist_words('eighties', 400).includes('mile'));
  assert.strictEqual(OB.dist_words('modern', 9), '90 m'); assert.strictEqual(OB.dist_words('modern', 140), '1.4 km');
  assert.strictEqual(OB.dist_words('scifi', 140), '1.4 klicks'); assert.strictEqual(OB.dist_words('scifi', 100), '1 klick'); assert.strictEqual(OB.dist_words('modern', 0), 'right here');
}
{ // no rifles, radios or doctorates in the middle ages
  const { OB, make } = require('./helpers');
  const g = make({ era: 'medieval', seed: 3 }); g.player.infected = false;
  const bad = /rifle|radio|doctorate|bullet|ammunition|checkpoint|tuition|corporal|pasta|uniform|army|nurse|linguistics/i;
  for (const role of ['trader', 'healer', 'scholar', 'scout', 'soldier', 'survivor']) for (let uid = 1000; uid < 1004; uid++) {
    const n = { kind: 'human', uid, name: role, role, faction: 'enclave', x: 1, y: 1, hp: 30, max_hp: 30 };
    const out = [OB.dlg_greeting(g, n), OB.dlg_about(g, n), OB.dlg_about(g, n), OB.dlg_about(g, n)]; for (let i = 0; i < 8; i++) out.push(OB.dlg_news(g, n));
    for (const t of out) assert(!bad.test(t), `${role}: ${t}`);
  }
}
