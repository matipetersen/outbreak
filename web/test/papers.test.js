const assert = require('assert');
const { OB, make } = require('./helpers');

{ // pages scale with the world (the web map is big) and the first ones are close to the start
  for (const seed of [1, 2, 3]) {
    const g = make({ seed }), pois = Object.values(g.pois), diaries = Object.values(g.docs).filter((d) => d.kind === 'diary').length;
    assert(diaries >= Math.round(pois.filter((q) => !['refuge', 'pad', 'breach', 'camp'].includes(q.kind)).length / 5) * 0.8, `seed ${seed}: ${diaries} diaries for ${pois.length} buildings`);
    const [sx, sy] = g.world.start, within = (r) => pois.filter((q) => Math.max(Math.abs(q.x - sx), Math.abs(q.y - sy)) <= r).reduce((s, q) => s + q.docs.length, 0);
    assert(within(60) >= 12, `seed ${seed}: only ${within(60)} pages within 60 tiles`);
    assert(within(30) >= 4, `seed ${seed}: only ${within(30)} pages within 30 tiles`);
  }
}
{ // a building that still holds pages says so; the archivist marks the nearest ones
  const g = make({ seed: 3 }), poi = Object.values(g.pois).find((q) => q.kind === 'house' && q.docs.length);
  const lv = g.ensure_level(poi.id + ':0'); assert(g._unread_in(lv) > 0);
  for (const d of poi.docs) g.player.documents.push(d); assert.strictEqual(g._unread_in(lv), 0);
  const h = make({ seed: 3 }); h.rep.enclave = 50; h.player.coins = 20;
  const text = OB.ask_papers(h); assert(text.includes('Pages were left in'));
  const marked = Object.values(h.pois).filter((q) => q.papers); assert.strictEqual(marked.length, 2); assert(marked.every((q) => q.revealed));
  assert.strictEqual(h.player.coins, 20 - 4);
  const nearer = Object.values(h.pois).filter((q) => q.docs.length && !['breach', 'refuge', 'pad'].includes(q.kind)).sort((a, b) => Math.max(Math.abs(a.x - h.player.x), Math.abs(a.y - h.player.y)) - Math.max(Math.abs(b.x - h.player.x), Math.abs(b.y - h.player.y)))[0];
  assert(nearer.papers);
}
{ // it costs coins and runs out
  const g = make({ seed: 3 }); g.rep.enclave = 50; g.player.coins = 1; assert(OB.ask_papers(g).includes('costs'));
  g.player.coins = 99; for (const q of Object.values(g.pois)) for (const d of q.docs) g.player.documents.push(d); assert(OB.ask_papers(g).includes('no more pages'));
}
console.log('papers: pages scale with the world, start close, and can be asked after');
