// node web/test/run_all.js  (build first: python3 web/build.py)
const { execFileSync } = require('child_process');
const path = require('path');
for (const t of ['world', 'interiors', 'chain', 'core', 'factions', 'living', 'shared', 'realtime', 'stealth', 'road', 'random', 'stamina', 'chronicle', 'siege', 'recipes', 'endless', 'records', 'base', 'ambience', 'eras', 'papers', 'push', 'raiders', 'military', 'wild', 'caves', 'companion', 'director', 'pets', 'story']) {
  const out = execFileSync(process.execPath, [path.join(__dirname, t + '.test.js')], { encoding: 'utf8' });
  process.stdout.write(out);
}
console.log('all web engine tests passed');
