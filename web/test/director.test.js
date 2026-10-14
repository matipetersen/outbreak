const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function field(seed = 3, cfg = {}) {
  const g = make(Object.assign({ seed }, cfg)), lv = g.world.level, c = OB.comp_current(g);
  for (const a of lv.actors.slice()) if (a !== c) lv.remove_actor(a);
  g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 500; p.infected = false; p.panic = 0; g.heat = 0;
  for (let y = p.y - 10; y <= p.y + 10; y++) for (let x = p.x - 12; x <= p.x + 12; x++) lv.set_tile(x, y, OB.T.GRASS);
  g.clock.turn = 1000;
  return [g, lv];
}
const run = (g, turns) => { for (let i = 0; i < turns; i += 5) { g.clock.turn += 5; OB.dir_tick(g); } };
const prog = OB.dir_progress;
const setp = (v) => { OB.dir_progress_override = v; };
// dir_progress is a hoisted function declaration inside the bundle; the tests drive stages through the game state instead
function force(g, value) { g.requirements = () => [['a', value >= 0.99, ''], ['b', value >= 0.5, '']]; g.deadline_days = 0; g.clock.turn = Math.floor(240 * 10 * Math.max(0, (value - 0.65 * (value >= 0.99 ? 1 : value >= 0.5 ? 0.5 : 0)) / 0.35)); }

{ // twelve stages in order
  const S = OB.CONTENT.director.stages; assert.strictEqual(S.length, 12);
  assert.deepStrictEqual(S.map((s) => s.start), S.map((s) => s.start).slice().sort((a, b) => a - b)); assert.strictEqual(S[0].id, 'ordinary'); assert.strictEqual(S[7].id, 'ordeal'); assert.strictEqual(S[11].id, 'return');
}
{ // progress rises with the clock; stage follows it and never runs backwards; each act is announced once
  const [g] = field(); const before = OB.dir_progress(g); g.clock.turn += 240 * 4; assert(OB.dir_progress(g) > before);
  const d = OB.dir_state(g); run(g, 5);
  g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', false, '']];
  run(g, 5); const reached = d.stage; assert(reached >= 4);
  g.requirements = () => [['a', false, ''], ['b', false, ''], ['c', false, '']]; run(g, 5); assert(d.stage >= reached, 'a story does not run backwards');
  const acts = g.story.filter((m) => m[1].startsWith('ACT ')).map((m) => m[1]); assert.strictEqual(acts.length, new Set(acts).size);
}
{ // enemies in view and damage raise tension, and it decays
  const [g] = field(); const d = OB.dir_state(g); g.visible_hostiles = () => [{}, {}, {}]; g.player.hp -= 40; run(g, 15); assert(d.tension > 25);
  g.visible_hostiles = () => []; const high = d.tension; run(g, 150); assert(d.tension < high * 0.5);
}
{ // quiet builds into an announced threat, then release
  const [g, lv] = field(); const d = OB.dir_state(g); g.requirements = () => [['a', true, ''], ['b', false, '']]; run(g, 5);
  d.phase = 'build'; d.phase_until = g.clock.turn; d.pending = []; d.tension = 0;
  const z = () => lv.actors.filter((a) => a.kind === 'zombie').length + g.hordes.reduce((s, h) => s + h.size, 0), n = z();
  run(g, 10); assert.strictEqual(d.phase, 'peak'); assert(d.pending.length); assert(g.story.some((m) => m[2] === 'dir')); assert.strictEqual(z(), n);
  run(g, OB.CONTENT.director.stages.length + 20 + 10); run(g, 10);
  assert(!d.pending.length); d.tension = 0; d.last_threat = g.clock.turn - 100; run(g, 15); assert.strictEqual(d.phase, 'release');
}
{ // mercy, the final stand, scale and event bias
  let [g] = field(); let d = OB.dir_state(g); g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', false, '']]; run(g, 5);
  d.phase = 'build'; d.phase_until = g.clock.turn; d.pending = []; g.player.hp = Math.floor(g.player.max_hp * 0.2); run(g, 10); assert.strictEqual(d.phase, 'release'); assert.deepStrictEqual(d.pending, []); assert(d.mercy >= 1);
  [g] = field(); d = OB.dir_state(g); run(g, 5); d.phase = 'build'; d.phase_until = g.clock.turn; d.pending = []; d.tension = 0; g.final = {}; run(g, 30); assert.strictEqual(d.threats, 0); g.final = null;
  [g] = field(); d = OB.dir_state(g); g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', false, '']]; run(g, 5); d.phase = 'release'; const calm = OB.dir_scale(g); d.phase = 'peak'; const hot = OB.dir_scale(g); assert(calm < 0.5); assert(hot > 1.0);
  d.phase = 'release'; assert(OB.dir_event_bias(g, 'cache') > 1); assert(OB.dir_event_bias(g, 'toll') < 1); d.phase = 'peak'; assert(OB.dir_event_bias(g, 'toll') > 1); assert.strictEqual(OB.dir_event_bias(g, 'nonexistent'), 1);
  [g] = field(); d = OB.dir_state(g); run(g, 5); d.stage = 0; d.phase = 'peak'; assert(OB.dir_scale(g) <= 0.6);
}
{ // the ordeal sends one big thing; the reward pays
  const [g, lv] = field(); const d = OB.dir_state(g); g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', true, ''], ['d', true, ''], ['e', false, '']]; g.clock.turn = 240 * 8; run(g, 5);
  g.clock.turn = 240 * 10; run(g, 5);
  assert(d.stage >= 7);
  const total = () => lv.actors.filter((a) => a.kind === 'zombie').length + g.hordes.reduce((s, h) => s + h.size, 0); const n = total();
  g.requirements = () => [['a', true, ''], ['b', true, ''], ['c', true, ''], ['d', true, ''], ['e', false, '']];
  d.pending.push([g.clock.turn + 5, 'boss', 1]); run(g, 40); assert(total() > n);
}
{ // status line; the endless run goes round and never returns; saves keep the director
  const [g] = field(); OB.dir_state(g); assert(OB.dir_status(g).includes('Act'));
  const [e] = field(3, { scenario: 'endless' }); const d = OB.dir_state(e); const seen = new Set();
  for (let turn = 1000; turn < 1000 + 240 * 20; turn += 120) { e.clock.turn = turn; OB.dir_tick(e); if (turn % 5 === 0) seen.add(d.stage); }
  assert(seen.size >= 4); assert(Math.max(...seen) < 11);
  const h = OB.deserialize_game(OB.serialize_game(g)); assert(h.director && h.director.stage === g.director.stage);
}
console.log('director: twelve acts, tension, build-peak-release, mercy, an ordeal and a reward');
{ // it works indoors too, and leaves a haven alone
  let g, lv; [g, lv] = field();
  const poi = Object.values(g.pois).find((q) => q.kind === 'house');
  const inner = g.ensure_level(poi.id + ':0'); g.level = inner; g.player.x = inner.entry[0]; g.player.y = inner.entry[1];
  for (const a of inner.actors.slice()) if (a !== g.player) inner.remove_actor(a);
  const d = OB.dir_state(g); d.pending = [[g.clock.turn, 'horde', 5]];
  const before = inner.actors.length; run(g, 5);
  assert.strictEqual(d.pending.length, 0); assert(inner.actors.length > before, 'the dead found a way in');
  inner.safe = true; d.pending = [[g.clock.turn, 'horde', 5]]; run(g, 5); assert.strictEqual(d.pending.length, 1);
}
