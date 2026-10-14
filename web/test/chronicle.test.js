const assert = require('assert');
const { OB, make } = require('./helpers');

{ // a death tells how it went
  const g = make({ seed: 2 }); g.msg('Noise: a door slams.', 'info'); OB.infect(g, 'bite'); g.msg('A trivial line.', 'info');
  g.player.hp = 1; OB.damage_player(g, 5, 'bled out in the dark');
  const e = g.over; assert.strictEqual(e.kind, 'dead');
  assert(e.chronicle.some((c) => /bitten|infect/.test(c))); assert(e.chronicle.every((c) => c.startsWith('Day ')));
  assert(e.last_moments.includes('A trivial line.')); assert(!e.chronicle.some((c) => /trivial/.test(c))); assert(e.last_moments.length <= 10);
}
{ // hits do not flood the record
  const g = make({ seed: 2 }); for (let i = 0; i < 50; i++) g.msg('The walker hits you for 2.', 'bad'); assert(g.chronicle.length <= 2);
}
{ // start and latest survive trimming
  const g = make({ seed: 2 }); for (let i = 0; i < 400; i++) g.msg(`Found thing ${i}.`, 'good');
  assert(g.chronicle.length <= 160); const t = g.chronicle.map((c) => c[2]); assert(t.includes('Found thing 399.') && t.includes('Found thing 0.'));
}
{ // a win has a record
  const g = make({ seed: 2 }); g.msg('Deciphered: you now hold the formula.', 'good'); g.end('won');
  assert(g.over.victory && g.over.chronicle.some((c) => /formula/.test(c)));
}
console.log('chronicle: the end retells how the run went');
