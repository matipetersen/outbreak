const assert = require('assert');
const { OB, make } = require('./helpers');

{ // you start with the basics only
  const g = make({ seed: 2 }); assert(g.player.recipes.includes('bandage')); assert(!g.player.recipes.includes('medkit'));
}
{ // locked until learned
  const g = make({ seed: 2 }); for (const w of g.know.vocab) g.know.known.add(w);
  g.player.inventory.push({ id: 'bandage', qty: 4, dur: null }, { id: 'chem', qty: 4, dur: null });
  const r = OB.CONTENT.recipes.find((x) => x.id === 'medkit');
  let [ok, why] = OB.recipe_status(g, r); assert(!ok && /manual/.test(why));
  g.player.recipes.push('medkit'); assert(OB.recipe_status(g, r)[0]);
}
{ // every learnable recipe has a manual, and reading it teaches
  for (const era of ['medieval', 'eighties', 'modern', 'scifi']) {
    const g = make({ era, seed: 4 }), learn = new Set(Object.values(g.docs).filter((d) => d.kind === 'manual').map((d) => d.payload.recipe));
    for (const r of OB.CONTENT.recipes) {
      if (r.starter || !OB.recipe_output(g, r)) continue;
      if ((r.needs === 'firearms' && !g.era.firearms) || (r.needs === 'electricity' && !g.era.electricity)) continue;
      assert(learn.has(r.id), era + ' ' + r.id);
    }
  }
  const g = make({ seed: 4 }), doc = Object.values(g.docs).find((d) => d.kind === 'manual'), rid = doc.payload.recipe;
  assert(!g.player.recipes.includes(rid));
  for (const w of doc.words) g.know.known.add(w);
  g.collect_document(doc.id); g.read_document(doc.id); assert(g.player.recipes.includes(rid));
}
console.log('recipes: the basics are known, the rest are learned from manuals');
