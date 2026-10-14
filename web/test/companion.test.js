const assert = require('assert');
const { OB, make, empty_level } = require('./helpers');

function field(seed = 3, arch = null) {
  const g = make({ seed }), lv = g.world.level, c = OB.comp_current(g);
  for (const a of lv.actors.slice()) if (a !== c) lv.remove_actor(a);
  g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 1e6; p.infected = false;
  for (let y = p.y - 10; y <= p.y + 10; y++) for (let x = p.x - 12; x <= p.x + 12; x++) lv.set_tile(x, y, OB.T.GRASS);
  if (arch) { c.trait = ''; OB.comp_ensure_person(g, c, arch); }
  return [g, lv, c];
}
const first = (s) => s.split(' ')[0];

{ // you start with one companion from a varied pool
  const seen = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const g = make({ seed }), c = OB.comp_current(g);
    assert(c); assert.strictEqual(c.state, 'follow'); assert(OB.CONTENT.companions.archetypes.some((a) => a.id === c.trait)); assert(c.name !== 'Survivor'); seen.add(c.trait);
  }
  assert(seen.size >= 5);
  for (const a of OB.CONTENT.companions.archetypes) { assert(a.strength && a.flaw && a.intro && a.farewell); assert.strictEqual(a.backstory.length, 3); }
}
{ // anyone can take the place; only one at a time; a healer is a medic
  const [g, lv, c] = field(); g.companion_uid = 0; c.state = 'patrol';
  const healer = { ...c, uid: 999001, name: 'Healer', role: 'healer', faction: 'enclave', trait: '', state: 'idle', x: c.x + 2, y: c.y };
  lv.add_actor(healer); g.rep.enclave = 40;
  assert.strictEqual(first(OB.ask_join(g, healer)), healer.name); assert.strictEqual(healer.trait, 'medic'); assert.strictEqual(g.companion_uid, healer.uid); assert.strictEqual(healer.state, 'follow');
  const other = { ...healer, uid: 999002, name: 'Trader', role: 'trader', trait: '', state: 'idle', x: healer.x + 1 }; lv.add_actor(other);
  assert(OB.ask_join(g, other).toLowerCase().includes('only one'));
}
{ // strengths
  let [g, lv, c] = field(3, 'medic'); const p = g.player; p.max_hp = 100; p.hp = 30; g.clock.turn = 1000; OB.comp_tick(g); assert(p.hp > 30); assert(g.log.some((m) => m[2] === 'ally'));
  [g, lv, c] = field(3, 'hunter'); const r = OB.make_raider(g, c.x + 4, c.y); r.hidden = true; r.state = 'idle'; lv.add_actor(r); g.clock.turn = 1000; OB.comp_tick(g); assert(!r.hidden);
  [g, lv, c] = field(3, 'scavenger'); g.rng.random = () => 0.0; const n = g.player.inventory.reduce((s, i) => s + i.qty, 0); OB.comp_on_return(g); assert(g.player.inventory.reduce((s, i) => s + i.qty, 0) > n);
  g.rng.random = () => 0.0; g.clock.turn = 50 * 25; const pn = g.pings.length; OB.comp_tick(g); assert(g.pings.length > pn);          // the loud one
  [g, lv, c] = field(3, 'hunter'); g.player.inventory.push({ id: 'food', qty: 3, dur: null, key: false }); c.since = 0; g.clock.turn = 1000; OB.comp_tick(g); assert.strictEqual(g.player.count('food'), 2);
  [g, lv, c] = field(3, 'mechanic'); assert.strictEqual(OB.comp_flee_below(c), 0.6);
  let c2; [g, lv, c2] = field(3, 'preacher'); assert(OB.comp_refuses_to_fight(c2, { kind: 'human' })); assert(!OB.comp_refuses_to_fight(c2, { kind: 'zombie' }));
}
{ // bond: time and gifts up, killing innocents down, a broken bond leaves
  let [g, lv, c] = field(3, 'preacher'); let b = c.bond; g.clock.turn = 100; OB.comp_tick(g); assert(c.bond > b);
  g.player.inventory.push({ id: 'food', qty: 1, dur: null, key: false }); b = c.bond; OB.comp_give(g, c, g.player.inventory.length - 1); assert(c.bond > b);
  b = c.bond; OB.comp_on_player_kills_human(g, { hostile: false }); assert(c.bond < b - 10);
  [g, lv, c] = field(); c.bond = 3; g.clock.turn = 7; OB.comp_tick(g); assert(!OB.comp_current(g)); assert.strictEqual(c.state, 'patrol');
  [g, lv, c] = field(); g.player.humanity = 10; OB.comp_tick(g); assert(!OB.comp_current(g));
}
{ // their story comes out as the bond grows; advice names the next objective
  const [g, lv, c] = field(3, 'veteran'); c.bond = 40; OB.comp_talk(g, c); assert.strictEqual(c.story, 1); c.bond = 90; OB.comp_talk(g, c); OB.comp_talk(g, c); assert.strictEqual(c.story, 3);
  assert(OB.comp_advice(g).includes(c.name));
}
{ // death is permanent and loud; anyone else can follow; the ending remembers
  const [g, lv, c] = field(); const z = OB.spawn_zombie(g, lv, [c.x + 2, c.y], 'walker', false); const name = c.name;
  OB.kill_human_other(g, c, z);
  assert(!OB.comp_current(g)); assert.strictEqual(g.companion_uid, 0); assert.strictEqual(g.fallen_allies[g.fallen_allies.length - 1][0], name);
  assert(g.story.some((m) => m[1].includes('is dead') && m[2] === 'ally')); assert(!lv.actors.includes(c));
  const other = { ...c, uid: 999003, name: 'Soldier', role: 'soldier', faction: 'military', trait: '', state: 'idle', hp: 20, x: g.player.x + 2, y: g.player.y, group: 0 }; lv.add_actor(other); g.rep.military = 30;
  OB.ask_join(g, other); assert.strictEqual(g.companion_uid, other.uid);
  const e = OB.build_ending(g, 'dead', 'test'); assert(e.summary.some((l) => l.includes(name)));
}
{ // the default log is objectives and companion, not noise
  const [g] = field(); g.msg('You swing at the thing and miss.', 'combat'); g.msg('Mina: "hi"', 'ally'); g.msg('Done: x.', 'obj'); g.msg('A horde appears!', 'bad', true);
  const tags = new Set(g.story.map((m) => m[2])); assert(tags.has('ally')); assert(tags.has('obj')); assert(!tags.has('combat')); assert(g.log.some((m) => m[1].includes('swing')));
  g.clock.turn = 10; OB.objective_watch(g); const n = g.story.length; for (const p of Object.values(g.pois)) if (p.component) { p.lead = true; p.revealed = true; } g.clock.turn = 20; OB.objective_watch(g);
  assert(g.story.length >= n);
}
{ // saves keep the companion, the dead and the story
  const [g, lv, c] = field(); g.fallen_allies.push(['Old', 'veteran, 3d, 5 kills']);
  const h = OB.deserialize_game(OB.serialize_game(g)), c2 = OB.comp_current(h);
  assert(c2); assert.strictEqual(c2.name, c.name); assert.strictEqual(c2.trait, c.trait); assert.strictEqual(h.fallen_allies[0][0], 'Old'); assert(h.story.length === g.story.length);
}
{ // a companion is not invincible: the dead go for every role, and they do not leave you to chase a fight
  let [g, lv, c] = field(3, 'medic'); g.clock.turn = 1000; c.hp = 6; const z = OB.spawn_zombie(g, lv, [c.x + 1, c.y], 'walker', false); z.hp = z.max_hp = 500; z.speed = 2.0; z.dmg = [30, 40]; z.acc = 95;
  lv.occ.delete(lv.idx(g.player.x, g.player.y)); g.player.x = c.x - 7; g.player.y = c.y; lv.occ.set(lv.idx(g.player.x, g.player.y), g.player);
  for (let i = 0; i < 80 && OB.comp_current(g); i++) { g.clock.turn += 1; OB.ai_run(g); }
  assert(!OB.comp_current(g), 'invincible'); assert(g.story.some((m) => m[1].includes('is dead')));
  [g, lv, c] = field(3, 'brute'); c.role = 'survivor'; const z2 = OB.spawn_zombie(g, lv, [c.x + 5, c.y + 3], 'walker', false); z2.state = 'idle';
  lv.occ.delete(lv.idx(g.player.x, g.player.y)); g.player.x = c.x - 9; g.player.y = c.y; lv.occ.set(lv.idx(g.player.x, g.player.y), g.player);
  const before = Math.max(Math.abs(c.x - g.player.x), Math.abs(c.y - g.player.y)); for (let i = 0; i < 6; i++) { g.clock.turn += 1; OB.ai_run(g); }
  assert(Math.max(Math.abs(c.x - g.player.x), Math.abs(c.y - g.player.y)) < before, 'they come back to you');
  let c3; [g, lv, c3] = field(3, 'veteran'); assert.strictEqual(OB.comp_leash(c3), 12); [g, lv, c3] = field(3, 'medic'); assert.strictEqual(OB.comp_leash(c3), 6);
}
{ // combat dialogue and the story log
  const [g, lv, c] = field(3, 'veteran'); const z = OB.spawn_zombie(g, lv, [c.x + 1, c.y], 'walker', false);
  g.clock.turn = 2000; OB._human_fight(g, c, z); assert(g.story.slice(-4).some((m) => m[2] === 'ally'));
  const n = g.story.length; g.clock.turn = 3000; OB.damage_player(g, 6, 'test'); assert(g.story.length > n);
  g.clock.turn = 4000; OB.comp_on_regroup(g, c); assert(g.story.slice(-2).some((m) => m[2] === 'ally'));
  z.hp = z.max_hp = 100; for (let i = 0; i < 8; i++) OB.attack_actor(g, c, z); assert(g.story.some((m) => m[2] === 'ally' && (m[1].includes('hits') || m[1].includes('misses'))));
}
console.log('companion: a pool of people, strengths and flaws, bonds, permanent death, and a log that follows the story');
{ // the opening tide spares your people
  const [g, lv, c] = field(3, 'brute');
  g.clock.turn = 10; assert(OB.comp_early_grace(g)); g.clock.turn = 2000; g.ring = null; assert(!OB.comp_early_grace(g));
  g.ring = { active: true }; assert.strictEqual(OB.comp_leash(c, g), 3);
}
{ // they creep and run when you do, and level up with you
  const [g, lv, c] = field(3, 'brute'); g.clock.turn = 1000;
  g.player.sneaking = true; OB.comp_tick(g); assert(c.sneaking && !c.sprinting);
  g.player.sneaking = false; g.player.sprinting = true; OB.comp_tick(g); assert(c.sprinting && !c.sneaking);
  g.player.sprinting = false; OB.comp_tick(g); assert(!c.sneaking && !c.sprinting);
  const z = OB.spawn_zombie(g, lv, [c.x + 4, c.y], 'walker', false);
  assert.strictEqual(OB.nearest_foe(g, z, [c], 5), c); c.sneaking = true; assert.strictEqual(OB.nearest_foe(g, z, [c], 5), null);
  const hp = c.max_hp; g.player.gain_xp(100000); OB.comp_tick(g);
  assert.strictEqual(c.lvl, g.player.level); assert(c.max_hp > hp); assert(g.log.some((m) => m[1].includes('grows with you')));
}
{ // they follow you in and out, and a refused shot still shows in the focused log
  const [g, lv, c] = field(3, 'brute'); const p = g.player;
  OB.gen_near(g, p.x, p.y);
  const k = Object.keys(lv.portals).find((kk) => lv.portals[kk].target !== 'world' && lv.portals[kk].target.endsWith(':0'));
  assert(k !== undefined, 'a building near the start');
  const door = [Number(k) % lv.w, Math.floor(Number(k) / lv.w)];
  const spot = lv.free_spot_near(door[0], door[1] + 1, 2);
  lv.occ.delete(lv.idx(p.x, p.y)); p.x = spot[0]; p.y = spot[1]; lv.occ.set(lv.idx(p.x, p.y), p);
  lv.remove_actor(c); const cs = lv.free_spot_near(spot[0] + 1, spot[1], 2); c.x = cs[0]; c.y = cs[1]; lv.add_actor(c);
  assert(g._use_portal(door[0], door[1])); assert(g.level !== lv); assert(g.level.actors.includes(c)); assert.strictEqual(OB.comp_current(g), c);
  const back = Object.keys(g.level.portals).find((kk) => g.level.portals[kk].target === 'world');
  assert(g._use_portal(Number(back) % g.level.w, Math.floor(Number(back) / g.level.w)));
  assert(g.level === g.world.level && g.world.level.actors.includes(c)); assert.strictEqual(OB.comp_current(g), c);
  g.clock.turn = 500; g.msg('Out of bullets.', 'warn'); g.msg('Noise from a drain.', 'info');
  const shown = g.story_log().map((m) => m[1]); assert(shown.includes('Out of bullets.')); assert(!shown.includes('Noise from a drain.'));
}
{ // orders: engage reaches past the leash, fall back / escape disengage, ranged needs a ranged weapon, orders expire
  let [g, lv, c] = field(3, 'brute'); g.clock.turn = 1000; c.tamed = true;
  const z = OB.spawn_zombie(g, lv, [c.x + 9, c.y], 'walker', false); z.hp = z.max_hp = 400; z.dmg = [1, 1]; z.state = 'idle';
  lv.occ.delete(lv.idx(g.player.x, g.player.y)); g.player.x = c.x - 12; g.player.y = c.y; lv.occ.set(lv.idx(g.player.x, g.player.y), g.player);
  g.visible_hostiles = () => [z];
  OB.comp_give_order(g, c, 'engage'); assert.strictEqual(OB.comp_order_of(c), 'engage');
  const d0 = Math.max(Math.abs(c.x - z.x), Math.abs(c.y - z.y));
  for (let i = 0; i < 8; i++) { g.clock.turn += 1; OB.ai_run(g); }
  assert(Math.max(Math.abs(c.x - z.x), Math.abs(c.y - z.y)) < d0, 'went for it');
  OB.comp_give_order(g, c, 'ranged'); assert.strictEqual(OB.comp_order_of(c), 'engage', 'a brute has nothing to shoot with: the old order stands');
  c.reach = 6; OB.comp_give_order(g, c, 'ranged'); assert.strictEqual(OB.comp_order_of(c), 'ranged');
  OB.comp_give_order(g, c, 'guard'); assert.strictEqual(OB.comp_leash(c, g), 2);
  g.clock.turn += 100; OB.comp_tick(g); assert.strictEqual(OB.comp_order_of(c), '');
  g.visible_hostiles = () => []; OB.comp_give_order(g, c, 'engage'); assert.strictEqual(OB.comp_order_of(c), '', 'nothing in sight');
  OB.comp_give_order(g, c, 'escape'); const hp = z.hp; for (let i = 0; i < 6; i++) { g.clock.turn += 1; OB.ai_run(g); }
  assert(Math.max(Math.abs(c.x - g.player.x), Math.abs(c.y - g.player.y)) <= 6 && z.hp === hp, 'escaped without fighting');
}
{ // they hustle when they fall behind, and a lost companion catches up
  const [g, lv, c] = field(3, 'brute'); g.clock.turn = 1000; const p = g.player;
  lv.remove_actor(c); const s = lv.free_spot_near(p.x - 11, p.y, 2); c.x = s[0]; c.y = s[1]; lv.add_actor(c);
  const d0 = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
  for (let i = 0; i < 4; i++) { g.clock.turn += 1; OB.ai_run(g); }
  assert(Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= d0 - 6, 'more than a step a turn');
  lv.remove_actor(c); c.x = p.x + 34; c.y = p.y; lv.add_actor(c); OB.comp_tick(g);
  assert(Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) < 8 && g.log.some((m) => m[1].includes('catches up')));
}
{ // you swap places with your companion in a narrow path, and one boxed in by trees finds its way to you
  let [g, lv, c] = field(3, 'mechanic'); const p = g.player;
  lv.remove_actor(c); c.x = p.x + 1; c.y = p.y; lv.add_actor(c);
  const before = [[p.x, p.y], [c.x, c.y]]; assert(g.move(1, 0));
  assert.deepStrictEqual([[p.x, p.y], [c.x, c.y]], [before[1], before[0]], 'swapped');
  [g, lv, c] = field(3, 'mechanic'); g.clock.turn = 1000; const q = g.player;
  lv.remove_actor(c); c.x = q.x - 8; c.y = q.y; lv.add_actor(c);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) lv.set_tile(c.x + dx, c.y + dy, OB.T.TREE);
  for (let i = 0; i < 12; i++) { g.clock.turn += 1; OB.ai_run(g); }
  assert(Math.max(Math.abs(c.x - q.x), Math.abs(c.y - q.y)) <= 5, 'found its way'); assert(g.log.some((m) => m[1].includes('undergrowth')));
}
{ // the same people in another age: a medieval mechanic is a smith, and talks about hinges and a forge
  for (const [era, label] of [['medieval', 'smith'], ['scifi', 'engineer'], ['modern', 'mechanic']]) {
    const [g, lv, c] = field(3, 'mechanic'); OB.comp_set_era(era);
    assert.strictEqual(OB.comp_arch(c).label, label, era);
  }
  OB.comp_set_era('medieval'); const [g2, , c2] = field(3, 'mechanic'); OB.comp_set_era('medieval');
  const a = OB.comp_arch(c2); assert(a.intro.includes('hinge') && !/moving parts|toolbox|elevator/.test(JSON.stringify(a)), 'no machines in the middle ages');
  assert(OB.comp_personal('mechanic').ask.includes('hammer') && OB.comp_personal('medic').ask.includes('infirmary'));
  OB.comp_set_era('modern');
}
{ // gear: a weapon changes what they hit with, armour turns blows, a bow needs arrows, a pacifist refuses, it comes back or drops
  const give = (g, id, qty = 1) => { g.player.inventory.push(OB.make_item(id, qty, g.item_def(id).durability || null)); return g.player.inventory.length - 1; };
  let [g, lv, c] = field(3, 'medic'); c.tamed = true; const base = c.dmg.slice(); const sword = g.items.mace ? 'mace' : 'bat';
  OB.comp_equip(g, c, give(g, sword)); assert(c.gear_weapon && c.dmg[1] > base[1]); OB.comp_unequip(g, c, 'weapon'); assert.deepStrictEqual(c.dmg, base);
  [g, lv, c] = field(3, 'medic'); g.clock.turn = 2000; c.hp = c.max_hp = 1000; const z = OB.spawn_zombie(g, lv, [c.x + 1, c.y], 'walker', false); z.dmg = [6, 6]; z.acc = 100;
  const hits = {}; for (const armour of [false, true]) { if (armour) OB.comp_equip(g, c, give(g, g.items.vest ? 'vest' : 'jerkin')); const hp = c.hp; for (let i = 0; i < 10; i++) OB.attack_actor(g, z, c); hits[armour] = hp - c.hp; }
  assert(hits[true] < hits[false], 'armour turns blows');
  [g, lv, c] = field(3, 'brute'); c.tamed = true; const bow = g.items.bow ? 'bow' : 'pistol', ammo = g.item_def(bow).ammo;
  OB.comp_equip(g, c, give(g, bow)); assert.strictEqual(c.reach, 1); OB.comp_equip(g, c, give(g, ammo, 5)); assert(c.reach > 1 && c.gear_ammo === 5);
  for (let i = 0; i < 5; i++) OB.comp_use_ammo(g, c); assert.strictEqual(c.reach, 1, 'out of ammunition');
  const [g2, , p] = field(3, 'preacher'); const msg = OB.comp_equip(g2, p, give(g2, g2.items.mace ? 'mace' : 'bat')); assert(!p.gear_weapon && msg.includes('will not carry'));
  [g, lv, c] = field(3, 'brute'); c.tamed = true; OB.comp_equip(g, c, give(g, sword)); OB.comp_dismiss(g, c); assert(!c.gear_weapon && g.player.inventory.some((i) => i.id === sword));
  [g, lv, c] = field(3, 'brute'); c.tamed = true; OB.comp_equip(g, c, give(g, sword)); OB.comp_on_death(g, c, 'a test'); assert(Object.values(lv.items).some((st) => st.some((i) => i.id === sword)));
}
