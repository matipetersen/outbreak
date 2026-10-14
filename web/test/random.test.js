const assert = require('assert');
const OB = require('../dist/engine.js');

const allRandom = (extra = {}) => Object.assign({ era: 'random', zombies: 'random', scenario: 'random', origin: 'random', mode: 'random', map_w: 160, map_h: 100 }, extra);
// a game can be built from a fully random config, with concrete values and a log line saying what was drawn
{
  const g = OB.make_game(allRandom({ seed: 4 }));
  for (const f of OB.RANDOMIZABLE) assert.notStrictEqual(g.cfg[f], 'random');
  assert(['normal', 'living'].includes(g.cfg.mode));
  assert(g.log.some((m) => m[1].startsWith('Random draw:')));
}
// with a seed the draw is reproducible; across seeds it varies
{
  const a = OB.resolve_config(Object.assign(OB.default_config(), allRandom({ seed: 9 })))[0], b = OB.resolve_config(Object.assign(OB.default_config(), allRandom({ seed: 9 })))[0];
  assert.deepStrictEqual(a, b);
  const draws = new Set();
  for (let s = 0; s < 40; s++) { const c = OB.resolve_config(Object.assign(OB.default_config(), allRandom({ seed: s })))[0]; draws.add(OB.RANDOMIZABLE.map((f) => c[f]).join('/')); }
  assert(draws.size > 20, `only ${draws.size} distinct draws`);
  const eras = new Set(); for (let i = 0; i < 80; i++) eras.add(OB.resolve_config(Object.assign(OB.default_config(), allRandom()))[0].era);
  assert.strictEqual(eras.size, Object.keys(OB.CONTENT.eras).length);
}
// only the random fields change; shared mode is never drawn
{
  const [c, drawn] = OB.resolve_config(Object.assign(OB.default_config(), { era: 'medieval', zombies: 'random', scenario: 'dash', origin: 'guard', mode: 'shared', seed: 3 }));
  assert.deepStrictEqual([c.era, c.scenario, c.origin, c.mode], ['medieval', 'dash', 'guard', 'shared']);
  assert.deepStrictEqual(drawn, ['zombies']); assert.notStrictEqual(c.zombies, 'random');
}
// unknown values still fail
assert.throws(() => OB.make_game({ era: 'nope', map_w: 160, map_h: 100 }));
// every combination a random draw can produce builds (smoke over many seeds, small map)
for (let s = 0; s < 24; s++) { const g = OB.make_game(allRandom({ seed: s })); g._spend(5); assert(g.player.hp > 0); }
console.log('random: draws are valid, reproducible and varied');
