const assert = require('assert');
const { OB, make } = require('./helpers');

const mem = () => { let runs = []; return { get: () => runs.slice(), set: (r) => { runs = r; } }; };
function finished(days, scenario = 'endless', mode = 'normal') {
  const g = make({ scenario, mode, seed: 2 }); g.clock.turn = 240 * (days - 1); g.end(mode === 'living' ? 'won' : 'dead', 'killed by a test'); return g;
}
{ // first run, then a new record, then a worse run
  const s = mem();
  assert(/First recorded/.test(OB.submit_record(finished(5), s)[0]));
  assert(/NEW RECORD/.test(OB.submit_record(finished(9), s)[0]));
  const c = OB.submit_record(finished(3), s)[0]; assert(/ranks #3 of 3/.test(c), c);
  assert.strictEqual(s.get().length, 3);
}
{ // objectives are compared separately
  const s = mem(); OB.submit_record(finished(20), s);
  assert(/First recorded/.test(OB.submit_record(finished(2, 'dash'), s)[0]));
}
{ // summary
  const s = mem(); OB.submit_record(finished(5), s); OB.submit_record(finished(7), s);
  const r = OB.record_summary(s.get()); assert.strictEqual(r.best.length, 1); assert.strictEqual(r.best[0].days, 7); assert.strictEqual(r.latest.length, 2);
  assert.strictEqual(OB.record_summary([]).best.length, 0);
}
console.log('records: bests are kept per objective and mode');
