const assert = require('assert');
const { OB, make } = require('./helpers');

function clear(g) {
  const lv = g.world.level;
  for (const a of lv.actors.slice()) if (a.kind !== 'player') lv.remove_actor(a);
  g.hordes.length = 0; g.ring = null;
  return lv;
}
function open_spot(g, lv) {
  const p = g.player;
  for (let r = 20; r < 40; r++) for (let dx = -r; dx <= r; dx += 3) {
    const x = p.x + dx, y = p.y + r;
    let ok = lv.in_bounds(x, y);
    for (let i = -3; i <= 3 && ok; i++) ok = lv.free(x + i, y);
    if (ok) return [x, y];
  }
  throw new Error('no open ground');
}
const tick = (g, n) => { for (let i = 0; i < n; i++) g._spend(1); };
function put(g, lv, actor, base, dx = 0) {
  const spot = lv.free_spot_near(base[0] + dx, base[1], 2);
  if (!lv.actors.includes(actor)) lv.add_actor(actor);
  lv.move_actor(actor, spot[0], spot[1]);
  return actor;
}
function fresh(cfg) { const g = make(Object.assign({ era: 'modern', zombies: 'classic', seed: 3 }, cfg)); const lv = clear(g); return [g, lv, open_spot(g, lv)]; }

// zombie attacks a distant human while the player is away
{
  const [g, lv, base] = fresh();
  const z = put(g, lv, OB.spawn_zombie(g, lv, base, 'walker', false), base);
  const h = put(g, lv, OB.make_patrol(g, 'scout', 0, 0, 1), base, 2);
  h.reach = 1; h.hp = h.max_hp = 400; z.state = 'idle';
  tick(g, 30);
  assert(h.hp < 400, 'zombie never touched the patrol');
}
// patrol kills a zombie
{
  const [g, lv, base] = fresh();
  const z = put(g, lv, OB.spawn_zombie(g, lv, base, 'walker', false), base);
  const h = put(g, lv, OB.make_patrol(g, 'soldier', 0, 0, 1), base, 3);
  h.hp = h.max_hp = 500;
  tick(g, 80);
  assert(z.hp <= 0 && !lv.actors.includes(z), 'patrol did not kill the zombie');
}
// raiders and a patrol fight each other
{
  const [g, lv, base] = fresh();
  const r = put(g, lv, OB.make_raider(g, 0, 0), base); r.state = 'idle';
  const h = put(g, lv, OB.make_patrol(g, 'soldier', 0, 0, 1), base, 4);
  tick(g, 80);
  assert(r.hp < r.max_hp || h.hp < h.max_hp || !lv.actors.includes(r) || !lv.actors.includes(h), 'no fight');
}
// bitten dead rise even on a preset whose dead do not turn
{
  const [g, lv, base] = fresh({ zombies: 'rage' });
  assert(!g.profile.turn_on_death);
  const z = OB.spawn_zombie(g, lv, base, 'walker', false);
  const h = OB.make_patrol(g, 'scout', 0, 0, 1);
  const spot = lv.free_spot_near(base[0] + 1, base[1], 2);
  lv.add_actor(h); lv.move_actor(h, spot[0], spot[1]);
  OB.kill_human_other(g, h, z);
  assert.strictEqual(lv.corpses[lv.idx(spot[0], spot[1])][1], 2);
  lv.remove_actor(z);
  g.clock.turn += 60; g._rising_dead();
  assert(lv.actors.some((a) => a.kind === 'zombie' && a.x === spot[0] && a.y === spot[1]), 'victim did not rise');
}
// a human the player kills does not rise on rage
{
  const [g, lv, base] = fresh({ zombies: 'rage' });
  const h = OB.make_raider(g, 0, 0);
  const spot = lv.free_spot_near(base[0], base[1], 2);
  lv.add_actor(h); lv.move_actor(h, spot[0], spot[1]);
  OB.kill_human(g, h);
  assert.strictEqual(lv.corpses[lv.idx(spot[0], spot[1])][1], true);
}
// patrols exist, are friendly, and walk
{
  const seen = new Set();
  for (const seed of [7, 8, 9, 10]) {                         // which patrols sit in the painted chunks depends on the seed: look across a few
    const g = make({ era: 'modern', seed });
    const pats = g.world.level.actors.filter((a) => a.kind === 'human' && (a.role === 'scout' || a.role === 'soldier'));
    assert(pats.length >= 4); assert(pats.every((a) => !a.hostile));
    for (const a of pats) seen.add(a.faction);
  }
  assert.deepStrictEqual(seen, new Set(['enclave', 'military']));
  const [g2, lv, base] = fresh();
  const h = put(g2, lv, OB.make_patrol(g2, 'scout', 0, 0, 9), base);
  const goal = [h.x + 14, h.y]; g2.patrol_goals[9] = goal;
  const d0 = Math.max(Math.abs(h.x - goal[0]), Math.abs(h.y - goal[1]));
  tick(g2, 20);
  assert(Math.max(Math.abs(h.x - goal[0]), Math.abs(h.y - goal[1])) < d0, 'patrol did not walk');
}
// talking gives one lead; the inhuman are refused
{
  const [g, lv, base] = fresh();
  const h = put(g, lv, OB.make_patrol(g, 'scout', 0, 0, 1), base);
  const leads = () => Object.values(g.pois).filter((q) => q.lead).length;
  const before = leads();
  const first = OB.talk_patrol(g, h);
  assert.strictEqual(leads(), before + 1);
  const second = OB.talk_patrol(g, h);
  assert.strictEqual(leads(), before + 1); assert.notStrictEqual(first, second);
  const [g2, lv2, base2] = fresh();
  const h2 = put(g2, lv2, OB.make_patrol(g2, 'soldier', 0, 0, 1), base2);
  g2.player.humanity = 5;
  const b2 = Object.values(g2.pois).filter((q) => q.lead).length;
  OB.talk_patrol(g2, h2);
  assert.strictEqual(Object.values(g2.pois).filter((q) => q.lead).length, b2);
}
// gunfire draws the dead
{
  const [g, lv, base] = fresh();
  const z = OB.spawn_zombie(g, lv, base, 'walker', false); z.state = 'idle';
  const shooter = put(g, lv, OB.make_patrol(g, 'soldier', 0, 0, 1), base, 6);
  const victim = put(g, lv, OB.make_raider(g, 0, 0), base, 8);
  for (let i = 0; i < 5 && victim.hp > 0; i++) OB.attack_actor(g, shooter, victim, true);
  assert.strictEqual(z.state, 'investigate');
}

// ---- companions, distress, abstract fights
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
function with_patrol(group) {
  const g = make({ era: 'modern', zombies: 'classic', seed: 3 }), lv = clear(g), p = g.player;
  const h = OB.make_patrol(g, 'soldier', 0, 0, group), spot = lv.free_spot_near(p.x + 1, p.y, 2);
  lv.add_actor(h); lv.move_actor(h, spot[0], spot[1]);
  return [g, lv, h];
}
{
  const [g, lv, h] = with_patrol(5);
  assert(OB.ask_join(g, h).includes('know you')); assert.notStrictEqual(h.state, 'follow');
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(h.x + 2, h.y, 2), 'walker', false);
  for (let i = 0; i < 40 && g.distress[5] === undefined; i++) OB.attack_actor(g, z, h);
  assert(g.distress[5] !== undefined, 'no distress call');
  z.hp = 1; OB.kill_zombie(g, z);
  assert.strictEqual(g.aided[5], false);
  assert(OB.talk_patrol(g, h).includes('called')); assert.strictEqual(g.aided[5], true);
  OB.ask_join(g, h); assert.strictEqual(h.state, 'follow'); assert.strictEqual(g.companion_uid, h.uid);
}
{
  const [g, lv, h] = with_patrol(5);
  g.distress[5] = g.clock.turn; g.note_assist([h.x + 40, h.y]);
  assert.strictEqual(g.aided[5], undefined);
}
{
  const [g, lv, h] = with_patrol(5);
  g.rep.military = 20; OB.comp_ensure_person(g, h, 'veteran'); OB.ask_join(g, h);
  assert.strictEqual(OB.companions(g).length, 1);
  const p = g.player;
  for (let i = 0; i < 12; i++) if (!g.move(0, 1)) g.move(1, 0);
  assert(cheb([h.x, h.y], [p.x, p.y]) <= 4, 'companion did not follow');
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 4, p.y, 2), 'walker', false);
  z.hp = z.max_hp = 6; p.hp = p.max_hp = 500;
  tick(g, 60);
  assert(!lv.actors.includes(z), 'companion did not fight');
  OB.dismiss(g, h); assert.strictEqual(h.state, 'patrol');
}
{
  const [g, lv, h] = with_patrol(5);
  g.rep.military = 20;
  const m = OB.make_patrol(g, 'soldier', 0, 0, 20), sp = lv.free_spot_near(g.player.x - 2, g.player.y, 3);
  lv.add_actor(m); lv.move_actor(m, sp[0], sp[1]);
  OB.ask_join(g, m); assert.strictEqual(m.state, 'follow');
  assert(OB.ask_join(g, h).toLowerCase().includes('only one'));
  g.player.humanity = 5; assert(OB.join_refusal(g, h).includes('what you have become'));
}
{
  const g = make({ era: 'modern', zombies: 'classic', seed: 3, map_w: 160, map_h: 100 }); OB.generate_all(g);
  const lv = clear(g), p = g.player;
  let base = null;
  for (let y = 8; y < lv.h - 8 && !base; y++) for (let x = 8; x < lv.w - 8 && !base; x++) {
    if (cheb([x, y], [p.x, p.y]) <= 47) continue;
    if (lv.free(x, y) && lv.free_spot_near(x + 4, y, 3) && lv.free_spot_near(x, y + 12, 3)) base = [x, y];
  }
  const members = [];
  for (let i = 0; i < 3; i++) { const m = OB.make_patrol(g, 'soldier', 0, 0, 7), sp = lv.free_spot_near(base[0] + i, base[1], 3); lv.add_actor(m); lv.move_actor(m, sp[0], sp[1]); members.push(m); }
  const zs = [];
  for (let k = 0; k < 5; k++) { const sp = lv.free_spot_near(base[0] + 2, base[1] + k, 6); if (sp) zs.push(OB.spawn_zombie(g, lv, sp, 'walker', false)); }
  assert(zs.length >= 3);
  assert(OB._abstract_fight(g, members) > 0);
  assert(zs.filter((z) => lv.actors.includes(z)).length < zs.length);
  // movement when nothing is near
  const h = OB.make_patrol(g, 'scout', 0, 0, 8), sp = lv.free_spot_near(base[0], base[1] + 12, 3);
  lv.add_actor(h); lv.move_actor(h, sp[0], sp[1]); g.patrol_goals[8] = [Math.min(lv.w - 5, h.x + 30), h.y];
  for (const z of zs) if (lv.actors.includes(z)) lv.remove_actor(z);
  const before = [h.x, h.y]; g.clock.turn = 1000; OB.abstract_run(g);
  assert(h.x !== before[0] || h.y !== before[1], 'far patrol did not move');
}
{
  const g = make({ era: 'modern', zombies: 'classic', seed: 3 }), lv = clear(g), p = g.player;
  const h = OB.make_patrol(g, 'scout', 0, 0, 8), sp = lv.free_spot_near(p.x + 6, p.y + 6, 4);
  lv.add_actor(h); lv.move_actor(h, sp[0], sp[1]); const b = [h.x, h.y];
  g.clock.turn = 1000; OB.abstract_run(g);
  assert.deepStrictEqual([h.x, h.y], b);
}

// ---- openings
for (const era of Object.keys(OB.CONTENT.eras)) for (const oid of Object.keys(OB.CONTENT.openings)) {
  const g = make({ era, opening: oid, seed: 4, zombies: oid === 'vigil' ? 'night' : 'classic' });
  assert.strictEqual(g.opening_id, oid); assert.strictEqual(g.intro_pages.length, 4);
  assert(g.intro_pages.every(([, t]) => t.length > 40));
  assert(g.intro_pages.every(([, t]) => !/\{\w+\}/.test(t)), 'unfilled placeholder');
}
{
  const a = make({ seed: 11 }), b = make({ seed: 11 }), c = make({ seed: 11, opening: 'market' });
  assert.strictEqual(a.opening_id, b.opening_id);
  assert.deepStrictEqual(Object.values(a.pois).map((q) => q.name), Object.values(c.pois).map((q) => q.name));
  const base = make({ seed: 5, opening: 'rounds', origin: 'scholar' }), study = make({ seed: 5, opening: 'study', origin: 'scholar' });
  assert(study.know.known.size > base.know.known.size);
  const market = make({ seed: 5, opening: 'market' }), plain = make({ seed: 5, opening: 'meal' });
  assert.strictEqual(market.player.coins, plain.player.coins + 14);
  const hunt = make({ seed: 5, opening: 'hunt', origin: 'scholar' }), ids = hunt.player.inventory.map((i) => i.id);
  assert(ids.includes(hunt.era.defaults.ranged)); assert(ids.includes(hunt.item_def(hunt.era.defaults.ranged).ammo));
  assert(make({ seed: 5, opening: 'vigil', origin: 'scholar' }).player.humanity > plain.player.humanity);
  assert(make({ seed: 5, opening: 'watch', origin: 'scholar' }).player.armor !== null);
  assert.throws(() => make({ opening: 'nope' }));
}
// save/load keeps patrols, goals and the briefing
{
  const g = make({ seed: 9, opening: 'hunt' });
  tick(g, 10);
  const g2 = OB.deserialize_game(OB.serialize_game(g));
  assert.strictEqual(g2.opening_id, 'hunt'); assert.strictEqual(g2.intro_pages.length, 4);
  assert.deepStrictEqual(g2.patrol_goals, JSON.parse(JSON.stringify(g.patrol_goals)));
  assert.strictEqual(g2.patrol_nodes.length, g.patrol_nodes.length);
  g.distress[3] = 5; g.aided[3] = false;
  const g3 = OB.deserialize_game(OB.serialize_game(g));
  assert.deepStrictEqual(g3.aided, { 3: false }); assert.strictEqual(g3.distress[3], 5);
}
console.log('factions: combat, patrols and openings OK');
