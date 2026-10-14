// The whole intended progression using real game actions (only walking is skipped).
const assert = require('assert');
const { OB, make, empty_level, teleport, quiet } = require('./helpers');

function fetch_document(g, doc_id) {
  if (g.player.documents.includes(doc_id)) return;
  const poi = Object.values(g.pois).find((p) => p.docs.includes(doc_id));
  const floor = poi.docs.indexOf(doc_id) % Math.max(1, poi.floors);
  const lv = g.ensure_level(`${poi.id}:${floor}`);
  empty_level(lv);
  for (const [k, c] of Object.entries(lv.containers)) {
    if (c.docs.includes(doc_id)) {
      const x = k % lv.w, y = Math.floor(k / lv.w);
      teleport(g, lv.id, lv.free_spot_near(x, y, 1));
      OB.search_container(g, [x, y]);
      return;
    }
  }
  for (const [k, ids] of Object.entries(lv.docs)) {
    if (ids.includes(doc_id)) { teleport(g, lv.id, [k % lv.w, Math.floor(k / lv.w)]); g.pickup(); return; }
  }
  throw new Error(`document ${doc_id} lost in ${poi.name}`);
}

function loot_vault(g, poi) {
  const top = `${poi.id}:${poi.floors - 1}`;
  for (let f = 0; f < poi.floors; f++) g.ensure_level(`${poi.id}:${f}`);
  const lv = g.levels[top];
  empty_level(lv);
  teleport(g, top, lv.free_spot_near(lv.vault_lock[0], lv.vault_lock[1], 2));
  for (let i = 0; i < 4; i++) if (lv.tile(lv.vault_lock[0], lv.vault_lock[1]) === OB.T.LOCKED) g.try_unlock(lv.vault_lock);
  assert.notStrictEqual(lv.tile(lv.vault_lock[0], lv.vault_lock[1]), OB.T.LOCKED);
  const k = Object.keys(lv.containers).find((kk) => lv.containers[kk].note === 'vault');
  const crate = [k % lv.w, Math.floor(k / lv.w)];
  teleport(g, top, lv.free_spot_near(crate[0], crate[1], 1));
  OB.search_container(g, crate);
}

function play_through(era, scenario, seed) {
  const g = make({ era, scenario, seed, origin: 'scholar' });
  quiet(g);
  for (const doc of Object.values(g.docs)) {
    fetch_document(g, doc.id);
    for (let i = 0; i < 4; i++) g.read_document(doc.id);
  }
  for (const req of g.scenario.requirements) {
    const poi = Object.values(g.pois).find((p) => p.component === req.id);
    assert(poi.lead, `${era} ${scenario}: lead never revealed for ${poi.name}`);
    assert(poi.code_known);
    loot_vault(g, poi);
    assert.strictEqual(g.player.count(req.id), 1, `${era} ${scenario} ${req.id}`);
  }
  assert(g.pois[g.final_site_id].revealed);
  if (g.scenario.needs_formula) { assert(g.formula_found); assert(g.know.fluency >= g.scenario.formula_fluency); }
  assert(g.requirements_met());
  const lv = g.ensure_level(g.pois[g.final_site_id].id + ':0');
  teleport(g, lv.id, lv.free_spot_near(lv.bench[0], lv.bench[1], 1));
  g.player.hp = g.player.max_hp = 1e6;
  assert(g.use_bench());
  for (let i = 0; i < 200 && !g.over && !(g.final && g.final.exit); i++) { g.player.infected = false; g.wait(1); }
  assert(g.final && g.final.exit, 'the clock runs out and a way out is given');
  const ex = g.final.exit;                                                  // the break-out: get to the door you were given
  if (g.level.portals[g.level.idx(ex[0], ex[1])]) g._use_portal(ex[0], ex[1]);
  else { teleport(g, g.level.id, ex); g.wait(1); }
  assert(g.over && g.over.victory, `${era} ${scenario}: ${g.over && g.over.title}`);
}

let n = 0;
for (const era of Object.keys(OB.CONTENT.eras)) for (const sc of ['cure', 'extraction', 'dash']) { play_through(era, sc, 3); n++; }
for (let seed = 6; seed < 14; seed++) { play_through('modern', seed % 2 ? 'cure' : 'extraction', seed); n++; }
console.log(`chain: ${n} full playthroughs OK`);
