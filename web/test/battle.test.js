const assert = require('assert');
const { OB } = require('./helpers');

const mk = (cfg) => OB.bt_new(Object.assign({ seed: 5 }, cfg));
const ticks = (b, n) => { for (let i = 0; i < n && b.phase === 'resolve' && !b.over; i++) OB.bt_tick(b); };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const placeMen = (b, s, x, y) => { s.anchor = [x, y]; s.path = []; for (const m of OB.bt_squad_men(b, s)) { m.x = x; m.y = y; } };

{ // every era, preset and objective makes a battlefield the dead can cross and the living can use
  for (const era of Object.keys(OB.CONTENT.eras)) for (const zombies of Object.keys(OB.CONTENT.presets)) for (const objective of ['hold', 'rescue', 'take']) {
    const b = mk({ era, zombies, objective });
    const north = []; for (let x = 0; x < b.w; x++) if (OB.bt_cost(b, x, 'z') !== Infinity) north.push(x);
    const f = OB.bt_dijkstra(b, north, 'z');
    if (b.refuge) assert(f[OB.bt_idx(b, b.refuge.x0, b.refuge.y0)] < Infinity, `${era}/${zombies}: the dead can reach the refuge`);
    if (b.house) assert(f[OB.bt_idx(b, b.house.door[0], b.house.door[1])] < Infinity, 'the dead can reach the house');
    assert.strictEqual(b.squads.filter(OB.bt_mine).length, 4);
    for (const s of b.squads) for (const m of OB.bt_squad_men(b, s)) assert(OB.bt_passable(b, m.x, m.y, 'h'), 'nobody starts in a wall');
    assert(b.wave && b.wave.count > 0 && b.phase === 'plan');
  }
}
{ // the same seed and the same orders give the same battle; a saved battle goes on exactly as if it had not been saved
  const play = (b) => { OB.bt_order_move(b, b.squads[0].id, [[b.squads[0].anchor[0] - 3, b.squads[0].anchor[1] - 4]]); OB.bt_set(b, b.squads[2].id, { stance: 'hold' }); OB.bt_run_turn(b); };
  const a = mk({ zombies: 'rage' }), c = mk({ zombies: 'rage' });
  play(a); play(c);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(c), 'deterministic');
  const st = memStore(); OB.bt_save(a, st);
  const r = OB.bt_load(st);
  assert(OB.bt_has_save(st));
  for (let i = 0; i < 2; i++) { OB.bt_run_turn(a); OB.bt_run_turn(r); }
  assert.strictEqual(JSON.stringify(a), JSON.stringify(r), 'save and load change nothing');
  OB.bt_delete_save(st); assert(!OB.bt_has_save(st));
}
{ // orders: no route into a wall, special actions only where they make sense
  const b = mk({});
  const s = b.squads[0], shield = b.squads.find((q) => q.type === 'shield');
  let wall = null; for (let k = 0; k < b.tiles.length && !wall; k++) if (b.tiles[k] === OB.BTILE.WALL) wall = [k % b.w, Math.floor(k / b.w)];
  const beside = OB.bt_order_move(b, s.id, [wall]);
  assert(beside && OB.bt_passable(b, beside[beside.length - 1][0], beside[beside.length - 1][1], 'h'), 'a wall target means the open ground beside it');
  const rb = mk({ objective: 'rescue' });
  assert.strictEqual(OB.bt_order_move(rb, rb.squads[0].id, [[rb.house.x0, rb.house.y0]]), null, 'not into a house barricaded from inside');
  const path = OB.bt_order_move(b, s.id, [[s.anchor[0], s.anchor[1] - 6]]);
  assert(path && path.length && Math.floor(path[path.length - 1][1]) === Math.floor(s.anchor[1] - 6));
  assert(OB.bt_set_ability(b, s.id, 3, 3), 'riflemen have no special action');
  assert(OB.bt_set_ability(b, shield.id, 0, 0), 'too far to build');
  const end = shield.path.length ? shield.path[shield.path.length - 1] : shield.anchor;
  const spot = OB.bt_open_spot(b, end[0], end[1] - 2);
  assert.strictEqual(OB.bt_set_ability(b, shield.id, spot[0], spot[1]), null);
  const reach = OB.bt_reach(b, s); assert(reach[1] < s.anchor[1], 'the plan view shows how far they get');
}
{ // the wave shown while planning is the wave that comes
  const b = mk({});
  const n = b.wave.count;
  OB.bt_begin_turn(b);
  assert.strictEqual(b.pending.length, n);
  const before = b.zeds.length; ticks(b, 40);
  assert(b.zeds.length > before, 'they arrive in the first seconds');
}
{ // holding fire is quiet; firing at will is loud, and it kills
  const b = mk({});
  b.zeds.length = 0; b.wave.count = 0;
  for (const s of b.squads) OB.bt_set(b, s.id, { stance: 'hold' });
  const s = b.squads[0], z = OB.bt_spawn_zed(b, s.anchor[0], s.anchor[1] - 5, 'walker');
  z.hp = z.max_hp = 1000;
  const heard = (n) => { let k = 0; for (let i = 0; i < n; i++) k += OB.bt_tick(b).filter((f) => f.kind === 'noise').length; return k; };
  OB.bt_begin_turn(b);
  assert.strictEqual(heard(20), 0, 'no shots, no noise');
  assert.strictEqual(z.hp, 1000);
  for (const q of b.squads) q.stance = 'fire';
  assert(heard(30) > 0, 'shots are heard'); assert(z.hp < 1000, 'and they hit');
}
{ // a lure pulls the dead away
  const b = mk({});
  b.zeds.length = 0; b.wave.count = 0;
  for (const s of b.squads) OB.bt_set(b, s.id, { stance: 'hold' });
  const z = OB.bt_spawn_zed(b, 4.5, 2.5, 'walker');
  b.lures.push({ x: 19.5, y: 3.5, turns: 2 });
  const d0 = Math.hypot(z.x - 19.5, z.y - 3.5);
  OB.bt_begin_turn(b); ticks(b, 100);
  assert(Math.hypot(z.x - 19.5, z.y - 3.5) < d0 - 3, 'it walks to the noise');
}
{ // barricades: built in four quiet seconds, they hold the dead until they are torn down; the swarm climbs fences
  const b = mk({});
  b.zeds.length = 0; b.wave.count = 0;
  const sh = b.squads.find((q) => q.type === 'shield'), spot = OB.bt_open_spot(b, sh.anchor[0], sh.anchor[1] - 2);
  assert.strictEqual(OB.bt_set_ability(b, sh.id, spot[0], spot[1]), null);
  OB.bt_begin_turn(b); ticks(b, 45);
  const k = OB.bt_idx(b, Math.floor(spot[0]), Math.floor(spot[1]));
  assert(b.barricades[k] > 0 && b.barricades_left === 3, 'it stands');
  assert(!OB.bt_passable(b, spot[0], spot[1], 'h') && OB.bt_cost(b, k, 'z') > 1, 'nobody walks through; the dead can only break it');
  const fenceAt = b.tiles.indexOf(OB.BTILE.FENCE);
  if (fenceAt >= 0) {
    assert.strictEqual(OB.bt_cost(b, fenceAt, 'z'), Infinity, 'a fence stops the slow dead');
    assert(OB.bt_cost(mk({ zombies: 'swarm' }), fenceAt, 'z') === Infinity || OB.bt_cost(Object.assign(mk({}), { swarm: true }), fenceAt, 'z') < Infinity, 'the swarm climbs it');
  }
  // a brute at the barricade with the refuge behind it breaks it
  const r = mk({}); r.zeds.length = 0; r.wave.count = 0;
  const door = [Math.floor((r.refuge.x0 + r.refuge.x1) / 2), r.refuge.y0 - 1];
  for (let x = r.refuge.x0 - 1; x <= r.refuge.x1 + 1; x++) for (let y = r.refuge.y0 - 1; y <= r.refuge.y1 + 1; y++) {
    const kk = OB.bt_idx(r, x, y); if (r.tiles[kk] === OB.BTILE.DOOR) r.barricades[kk] = 70;
  }
  for (const s of r.squads) { placeMen(r, s, 2.5, r.h - 1.5); s.stance = 'hold'; }
  const brute = OB.bt_spawn_zed(r, door[0] + 0.5, door[1] - 1.5, 'brute'); brute.hp = 1e6;
  OB.bt_begin_turn(r); ticks(r, 100);
  assert(Object.keys(r.barricades).length < 4 || Object.values(r.barricades).some((hp) => hp < 70), 'the brute tears at it');
}
{ // the classic dead: your fallen get up. Rage: a bite turns a man in seconds
  const b = mk({ zombies: 'classic' });
  b.zeds.length = 0; b.wave.count = 0;
  OB.bt_begin_turn(b);
  const man = b.men[0], fx = [];
  OB.bt_kill_living(b, man, fx, false);
  assert.strictEqual(b.corpses.length, 1);
  let rose = 0; for (let i = 0; i < 60; i++) rose += OB.bt_tick(b).filter((f) => f.kind === 'rise').length;
  assert.strictEqual(rose, 1, 'the dead man rises (among his own squad)');
  const r = mk({ zombies: 'rage' }); r.zeds.length = 0; r.wave.count = 0;
  OB.bt_begin_turn(r);
  const m2 = r.men[0], s2 = OB.bt_squad(r, m2.squad), n = s2.men.length;
  OB.bt_infect(r, m2, []);
  assert(m2.bitten > 0 && m2.bitten < 10);
  ticks(r, 70);
  assert.strictEqual(s2.men.length, n - 1, 'he turned'); assert(r.turned === 1);
}
{ // the vampiric dead burn in daylight out in the open, and wait inside by day
  const b = mk({ zombies: 'night' });
  assert(!OB.bt_dark(b));
  assert(b.wave.inside, 'by day the next ones wake inside');
  b.zeds.length = 0; b.wave.count = 0;
  let open = null; for (let k = 0; k < b.tiles.length && !open; k++) if (b.tiles[k] === OB.BTILE.GRASS && Math.floor(k / b.w) < 8) open = [k % b.w + 0.5, Math.floor(k / b.w) + 0.5];
  const z = OB.bt_spawn_zed(b, open[0], open[1], 'walker');
  OB.bt_begin_turn(b); ticks(b, 10);
  assert(z.hp < z.max_hp || !b.zeds.includes(z), 'it burns');
}
{ // morale: a squad swarmed by the dead breaks and runs; nobody listens to a broken squad
  const b = mk({});
  b.zeds.length = 0; b.wave.count = 0;
  const s = b.squads[0];
  OB.bt_begin_turn(b);
  for (let i = 0; i < 24; i++) { const z = OB.bt_spawn_zed(b, s.anchor[0] + (i % 6) * 0.3 - 0.8, s.anchor[1] - 1.2 - Math.floor(i / 6) * 0.3, 'walker'); z.hp = z.max_hp = 1e6; }
  ticks(b, 100);
  assert(s.state === 'broken' || s.men.length === 0, `the squad broke (${s.state}, morale ${s.morale.toFixed(0)})`);
}
{ // rescue: survivors come out to a squad at their door, follow it, and count when they reach the south edge
  const b = mk({ objective: 'rescue' });
  b.zeds.length = 0; b.wave.count = 0;
  const s = b.squads[0], door = b.house.door;
  assert(b.barricades[OB.bt_idx(b, door[0], door[1])] > 0, 'they nailed their door shut');
  placeMen(b, s, door[0] + 0.5, door[1] + 1.5);
  OB.bt_begin_turn(b); ticks(b, 5);
  assert(b.civs.every((c) => c.follow === s.id), 'they all come out');
  assert(!(OB.bt_idx(b, door[0], door[1]) in b.barricades), 'their barricade comes down');
  ticks(b, 200);
  assert.strictEqual(b.phase, 'plan');
  assert(OB.bt_order_move(b, s.id, [[door[0], b.h - 1]]), 'a route to the south edge');
  for (let t = 0; t < 4 && !b.over; t++) OB.bt_run_turn(b);
  assert(b.saved >= 3, `brought out ${b.saved}`);
  assert(b.over && b.over.victory, b.over && b.over.title);
}
{ // whole battles run to an end without errors, with no orders at all
  const runs = Object.keys(OB.CONTENT.presets).map((z) => ({ zombies: z })).concat(Object.keys(OB.CONTENT.eras).map((e) => ({ era: e })));
  for (const objective of ['hold', 'rescue', 'take']) for (const cfg of runs) {
    const b = mk(Object.assign({ objective, seed: 11 }, cfg));
    for (let t = 0; t < 14 && !b.over; t++) OB.bt_run_turn(b);
    assert(b.over, `${objective}/${JSON.stringify(cfg)} ends`);
    assert(b.over.summary.length >= 4 && b.over.title);
  }
}
{ // the dead are seen only where your people can see; in the dark not as far
  const b = mk({});
  const v = OB.bt_visibility(b);
  const s = b.squads[0];
  assert(v[OB.bt_idx(b, Math.floor(s.anchor[0]), Math.floor(s.anchor[1]))]);
  assert(!v[OB.bt_idx(b, 0, 0)] || !v[OB.bt_idx(b, b.w - 1, 0)], 'not the whole map');
  const seen = v.reduce((a, x) => a + x, 0);
  b.turn = 8; const dark = OB.bt_visibility(b).reduce((a, x) => a + x, 0);
  assert(OB.bt_dark(b) && dark < seen, 'night shrinks what you see');
}
{ // the player buys the company: within budget, one to five squads, deployed in the order chosen
  const b = mk({ forces: ['heavy', 'scout', 'scout', 'line'] });
  assert.deepStrictEqual(b.squads.map((s) => s.type), ['heavy', 'scout', 'scout', 'line']);
  assert.strictEqual(b.squads.filter((s) => s.lures_left > 0).length, 2);
  const five = mk({ objective: 'rescue', forces: ['scout', 'scout', 'scout', 'line', 'line'] });
  assert.strictEqual(five.squads.length, 5);
  for (const s of five.squads) for (const m of OB.bt_squad_men(five, s)) assert(OB.bt_passable(five, m.x, m.y, 'h'));
  const solo = mk({ forces: ['shield'] }); assert.strictEqual(solo.squads.length, 1);
  assert.strictEqual(mk({}).squads.length, 4, 'the standard company when none is chosen');
  for (const bad of [[], ['heavy', 'heavy', 'heavy', 'heavy'], ['scout', 'scout', 'scout', 'scout', 'scout', 'scout'], ['tank']]) {
    assert(OB.bt_forces_error(bad), JSON.stringify(bad));
    assert.throws(() => mk({ forces: bad }));
  }
  assert.strictEqual(OB.bt_forces_error(['line', 'shield', 'line', 'heavy']), null);
  assert(OB.bt_forces_cost(['line', 'shield', 'line', 'heavy']) <= OB.BT_ARMY.budget, 'the standard companies fit the budget');
  assert(OB.bt_forces_cost(OB.BT_OBJECTIVES.rescue.forces) <= OB.BT_ARMY.budget);
  const st = memStore(), x = mk({ forces: ['line', 'scout'] }); OB.bt_save(x, st);
  assert.deepStrictEqual(OB.bt_load(st).cfg.forces, ['line', 'scout'], 'the company is in the save');
}
{ // Take the town: four infested bases, a rival company from the north that shoots at everyone
  for (let seed = 1; seed <= 30; seed++) {
    const b = mk({ objective: 'take', seed });
    assert.strictEqual(b.bases.length, 4, `four bases (seed ${seed})`);
    const north = []; for (let x = 0; x < b.w; x++) if (OB.bt_cost(b, x, 'z') !== Infinity) north.push(x);
    const f = OB.bt_dijkstra(b, north, 'h');
    for (const q of b.bases) assert(f[OB.bt_idx(b, q.x0, q.y0)] < Infinity, 'every base can be walked into');
  }
  const b = mk({ objective: 'take', rivals: 'military' });
  const rivals = b.squads.filter((s) => !OB.bt_mine(s)), mine = b.squads.filter(OB.bt_mine);
  assert.strictEqual(rivals.length, 3, 'three rival squads on normal'); assert.strictEqual(mine.length, 4);
  assert(rivals[0].name.startsWith('Joint Task Force'), rivals[0].name);
  assert(rivals.every((s) => s.anchor[1] < 5) && mine.every((s) => s.anchor[1] > b.h - 6), 'they start at opposite ends');
  for (const q of b.bases) assert(b.zeds.some((z) => OB.bt_base_at(b, Math.floor(z.x), Math.floor(z.y)) === q), `${q.name} is infested`);
  assert.strictEqual(mk({ objective: 'take', difficulty: 'hard' }).squads.filter((s) => !OB.bt_mine(s)).length, 4);
  assert.throws(() => mk({ objective: 'take', rivals: 'aliens' }));
  // the rivals pick bases on their own
  OB.bt_begin_turn(b);
  assert(rivals.every((s) => s.path.length), 'every rival squad heads for a base');
  // the visibility and the cards ignore them; their men are hidden unless seen
  const v = OB.bt_visibility(b);
  assert(!rivals.some((s) => OB.bt_squad_men(b, s).some((m) => v[OB.bt_idx(b, Math.floor(m.x), Math.floor(m.y))])), 'rivals unseen at the start');
}
{ // a base is taken by being alone in it for four seconds; zombies or enemies inside stop it
  const b = mk({ objective: 'take', zombies: 'spore' });                  // no head-shot rule: the test zombie cannot die
  b.zeds.length = 0; b.wave.count = 0;
  const q = b.bases[0], s = b.squads.find(OB.bt_mine), r = b.squads.find((x) => !OB.bt_mine(x));
  for (const o of b.squads) if (o !== s) placeMen(b, o, o.anchor[0], o.anchor[1]);
  placeMen(b, s, (q.x0 + q.x1 + 1) / 2, (q.y0 + q.y1 + 1) / 2);
  const z = OB.bt_spawn_zed(b, q.x0 + 0.5, q.y0 + 0.5, 'walker'); z.hp = z.max_hp = 1e6;
  OB.bt_begin_turn(b);
  for (const o of b.squads) if (o !== s) o.path = [];                    // only the one squad moves
  ticks(b, 50);
  assert.strictEqual(q.owner, null, 'not while the dead are inside');
  b.zeds.splice(b.zeds.indexOf(z), 1);
  ticks(b, 45);
  assert.strictEqual(q.owner, 'you', 'taken');
  assert(b.report.some((l) => l.includes(q.name)));
  // rivals in it contest it; alone they take it back
  placeMen(b, s, 1.5, b.h - 1.5);
  placeMen(b, r, (q.x0 + q.x1 + 1) / 2, (q.y0 + q.y1 + 1) / 2);
  ticks(b, 5);
  if (b.phase === 'plan') OB.bt_begin_turn(b);
  for (const o of b.squads) o.path = [];
  ticks(b, 50);
  assert.strictEqual(q.owner, 'rival', 'they took it from you');
}
{ // the two companies shoot each other
  const b = mk({ objective: 'take' });
  b.zeds.length = 0; b.wave.count = 0;
  const s = b.squads.find(OB.bt_mine), r = b.squads.find((x) => !OB.bt_mine(x));
  const spot = OB.bt_open_spot(b, 3.5, b.h - 8.5), spot2 = OB.bt_open_spot(b, spot[0], spot[1] - 4);
  placeMen(b, s, spot[0], spot[1]); placeMen(b, r, spot2[0], spot2[1]);
  OB.bt_begin_turn(b);
  for (const o of b.squads) o.path = [];
  const before = OB.bt_squad_men(b, s).reduce((a, m) => a + m.hp, 0) + OB.bt_squad_men(b, r).reduce((a, m) => a + m.hp, 0);
  ticks(b, 60);
  const after = OB.bt_squad_men(b, s).reduce((a, m) => a + m.hp, 0) + OB.bt_squad_men(b, r).reduce((a, m) => a + m.hp, 0);
  assert(after < before, 'blood is drawn on both sides of the line');
}
{ // holding every base wins only once it has been held through a whole turn; the rivals can win the same way
  const b = mk({ objective: 'take' });
  for (const q of b.bases) q.owner = 'you';
  b.zeds.length = 0; b.wave.count = 0;
  for (const s of b.squads.filter((x) => !OB.bt_mine(x))) { for (const m of OB.bt_squad_men(b, s)) b.men.splice(b.men.indexOf(m), 1); s.men = []; }
  OB.bt_run_turn(b);
  assert(!b.over && b.hold_all === 'you', 'one turn is not enough');
  OB.bt_run_turn(b);
  assert(b.over && b.over.victory, b.over && b.over.title);
  const l = mk({ objective: 'take' });
  for (const q of l.bases) q.owner = 'rival';
  l.zeds.length = 0; l.wave.count = 0;
  for (const s of l.squads) { if (OB.bt_mine(s)) placeMen(l, s, 2.5, l.h - 1.5); s.path = []; }
  OB.bt_run_turn(l); OB.bt_run_turn(l);
  assert(l.over && !l.over.victory && /theirs/.test(l.over.title), l.over && l.over.title);
}
{ // windows: sight and shots go through, people do not; the dead smash them, and then anyone can climb through
  let b = null, k = -1;
  for (let seed = 1; seed <= 20 && k < 0; seed++) { b = mk({ seed }); k = b.tiles.indexOf(OB.BTILE.WINDOW); }
  assert(k >= 0, 'buildings have windows');
  const x = k % b.w, y = Math.floor(k / b.w);
  assert(!OB.bt_passable(b, x + 0.5, y + 0.5, 'h') && !OB.bt_passable(b, x + 0.5, y + 0.5, 'z'));
  assert(OB.bt_los(b, x - 1.5, y + 0.5, x + 2.5, y + 0.5) || OB.bt_los(b, x + 0.5, y - 1.5, x + 0.5, y + 2.5), 'you can see through it');
  for (let seed = 1; seed <= 10; seed++) { const r = mk({ objective: 'rescue', seed }); const h = r.house;
    for (let yy = h.y0 - 1; yy <= h.y1 + 1; yy++) for (let xx = h.x0 - 1; xx <= h.x1 + 1; xx++) assert.notStrictEqual(OB.bt_tile(r, xx, yy), OB.BTILE.WINDOW, 'the survivors boarded theirs up'); }
  // a brute outside a window, with the living inside, breaks in
  b.zeds.length = 0; b.wave.count = 0;
  for (const s of b.squads) s.stance = 'hold';
  const out = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => [x + dx, y + dy]).find(([xx, yy]) => !OB.bt_indoor(OB.bt_tile(b, xx, yy)) && OB.bt_cost(b, OB.bt_idx(b, xx, yy), 'z') < Infinity);
  const inn = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => [x + dx, y + dy]).find(([xx, yy]) => OB.bt_tile(b, xx, yy) === OB.BTILE.FLOOR);
  if (out && inn) {
    const bl = b.buildings.find((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]);           // no door: the window is the way in
    for (let yy = bl[1]; yy <= bl[3]; yy++) for (let xx = bl[0]; xx <= bl[2]; xx++) if (OB.bt_tile(b, xx, yy) === OB.BTILE.DOOR) b.tiles[OB.bt_idx(b, xx, yy)] = OB.BTILE.WALL;
    for (let yy = bl[1]; yy <= bl[3]; yy++) for (let xx = bl[0]; xx <= bl[2]; xx++) if (OB.bt_tile(b, xx, yy) === OB.BTILE.WINDOW && (xx !== x || yy !== y)) b.tiles[OB.bt_idx(b, xx, yy)] = OB.BTILE.WALL;
    OB.bt_invalidate(b);
    const z = OB.bt_spawn_zed(b, out[0] + 0.5, out[1] + 0.5, 'brute'); z.hp = 1e6; z.goal = inn;
    OB.bt_begin_turn(b); ticks(b, 60);
    assert.strictEqual(OB.bt_tile(b, x, y), OB.BTILE.BROKEN, 'smashed in');
    assert(OB.bt_passable(b, x + 0.5, y + 0.5, 'h'), 'and now it can be climbed through');
  }
}
{ // scouts set up in cover snipe: farther, unseen until close
  const b = mk({ forces: ['scout', 'line'] });
  b.zeds.length = 0; b.wave.count = 0;
  const sc = b.squads[0];
  let brush = null; for (let k = 0; k < b.tiles.length && !brush; k++) if (b.tiles[k] === OB.BTILE.BRUSH && Math.floor(k / b.w) > 12) brush = [k % b.w + 0.5, Math.floor(k / b.w) + 0.5];
  assert(brush, 'some brush');
  placeMen(b, sc, brush[0], brush[1]);
  for (const m of OB.bt_squad_men(b, sc)) { m.x = brush[0]; m.y = brush[1]; }
  OB.bt_begin_turn(b); ticks(b, 25);
  assert(OB.bt_settled(b, sc), 'set up after two still seconds');
  assert(OB.bt_squad_men(b, sc).some((m) => OB.bt_hidden(b, m)), 'hidden in the brush');
  const z = OB.bt_spawn_zed(b, brush[0], brush[1] - 5, 'walker');
  const p = OB.bt_perceive(b, z, OB.bt_profile(b), false);
  assert(!p || !b.men.some((m) => m.id === p.tgt && m.squad === sc.id), 'the dead do not see a hidden sniper five tiles off');
  sc.path = [[brush[0], brush[1] - 3]]; sc.still = 0; sc.moving = true;
  assert(!OB.bt_settled(b, sc), 'moving gives them away');
}
{ // sneaking: half speed, unseen until close or until it fires
  const b = mk({});
  const s = b.squads[0];
  OB.bt_set(b, s.id, { pace: 'sneak' });
  const walk = OB.bt_reach(b, Object.assign({}, s, { pace: 'walk', path: [[s.anchor[0], 0.5]] }));
  const sneak = OB.bt_reach(b, Object.assign({}, s, { path: [[s.anchor[0], 0.5]] }));
  assert(s.anchor[1] - sneak[1] < (s.anchor[1] - walk[1]) * 0.7, 'slower than walking');
  b.zeds.length = 0; b.wave.count = 0;
  OB.bt_set(b, s.id, { stance: 'hold' });
  const man = OB.bt_squad_men(b, s)[0];
  assert(OB.bt_hidden(b, man), 'unseen while creeping');
  const z = OB.bt_spawn_zed(b, man.x, man.y - 4, 'walker');
  const p = OB.bt_perceive(b, z, OB.bt_profile(b), false);
  assert(!p || !OB.bt_squad_men(b, s).some((m) => m.id === p.tgt), 'the dead do not notice them four tiles off');
  s.fired_at = 0; b.ticks = 5;
  assert(!OB.bt_hidden(b, man), 'opening fire gives them away');
}
{ // caught unaware: a quiet kill in close combat; rivals shot from behind lose heart much faster than from the front
  const b = mk({ zombies: 'spore', objective: 'take' });
  b.zeds.length = 0; b.wave.count = 0;
  const s = b.squads.find(OB.bt_mine), r = b.squads.find((x) => !OB.bt_mine(x));
  placeMen(b, r, 12.5, 16.5); r.facing = [0, -1]; r.moving = false;
  const behind = { x: 12.5, y: 20.5 }, front = { x: 12.5, y: 12.5 };
  const target = OB.bt_squad_men(b, r)[0];
  assert(OB.bt_unaware(b, target, behind), 'from behind');
  assert(!OB.bt_unaware(b, target, front), 'not from the front');
  const m0 = r.morale; OB.bt_shoot_man(b, target, 1, s, [], true);
  assert(r.morale <= m0 - 7 && b.report.some((l) => /from behind/.test(l)));
  assert(r.facing[1] > 0, 'and they turn to face the fire');
  const z = OB.bt_spawn_zed(b, 3.5, 3.5, 'walker');
  const shooter = OB.bt_squad_men(b, s)[0];
  assert(!OB.bt_unaware(b, z, shooter), 'out in the open, no ambush on the dead');
  OB.bt_set(b, s.id, { pace: 'sneak' });
  assert(OB.bt_unaware(b, z, shooter), 'from hiding, at one that has noticed no one');
}
{ // Face: a squad standing still watches the side you choose; one on the move turns that way when it gets there
  const b = mk({});
  const s = b.squads[0];
  assert(OB.bt_face(b, s.id, s.anchor[0] + 5, s.anchor[1]));
  assert(s.facing[0] > 0.99, 'looks east');
  OB.bt_order_move(b, s.id, [[s.anchor[0], s.anchor[1] - 3]]);
  OB.bt_face(b, s.id, s.anchor[0] - 5, s.anchor[1] - 3);
  OB.bt_run_turn(b);
  assert(s.facing[0] < -0.99, 'turned west on arrival');
  assert(!OB.bt_face(b, b.squads[0].id, s.anchor[0], s.anchor[1]), 'needs a direction');
}
{ // the rivals creep round behind your men when they see them holding a base, and only when they see them
  const setup = (hidden) => {
    const b = mk({ objective: 'take', zombies: 'spore', seed: 7 });
    b.zeds.length = 0; b.wave.count = 0;
    const q = b.bases[b.bases.length - 1], c = [(q.x0 + q.x1 + 1) / 2, (q.y0 + q.y1 + 1) / 2];
    q.owner = 'you';
    const me = b.squads.find(OB.bt_mine);
    for (const o of b.squads.filter(OB.bt_mine)) if (o !== me) placeMen(b, o, 1.5, b.h - 1.5);
    placeMen(b, me, c[0], c[1]); me.facing = [0, -1]; me.still = 9;
    if (hidden) { me.pace = 'sneak'; }
    const rv = b.squads.filter((x) => !OB.bt_mine(x));
    rv.forEach((r, i) => placeMen(b, r, OB.bt_open_spot(b, c[0] - 2 + i * 2, q.y0 - 4)[0], OB.bt_open_spot(b, c[0] - 2 + i * 2, q.y0 - 4)[1]));
    for (const r of rv) for (const m of OB.bt_squad_men(b, r)) { m.x = r.anchor[0]; m.y = r.anchor[1]; }
    for (const qq of b.bases) if (qq !== q) qq.owner = 'rival';                // the only base left to want is yours
    OB.bt_rival_orders(b);
    return { b, me, rv, q };
  };
  const { b, me, rv } = setup(false);
  assert(OB.bt_seen_by_rivals(b, me), 'they see your men');
  const flankers = rv.filter((r) => r.pace === 'sneak' && r.type !== 'scout');
  assert(flankers.length >= 1 && flankers.length <= 2, 'one or two squads go round');
  const fl = flankers[0];
  assert(flankers.every((f) => f.path.some((p) => p[1] > me.anchor[1] + 1)), 'their routes pass behind your men (they face north)');
  const hid = setup(true);
  assert(!OB.bt_seen_by_rivals(hid.b, hid.me) || Math.min(...hid.rv.map((r) => Math.hypot(r.anchor[0] - hid.me.anchor[0], r.anchor[1] - hid.me.anchor[1]))) <= 3, 'a sneaking squad is not seen');
  assert(!hid.rv.some((r) => r.pace === 'sneak' && r.type !== 'scout'), 'and nobody goes round what they cannot see');
  assert(b.squads.filter((x) => !OB.bt_mine(x) && x.type === 'scout').every((x) => x.pace === 'sneak' || !x.path.length), 'lookouts creep');
}
{ // exfil: an escort stopping at the very top of the EXIT strip still gets everyone with it out
  const b = mk({ objective: 'rescue', zombies: 'classic', seed: 3 });
  b.zeds.length = 0;
  const s = b.squads[0], door = b.house.door;
  OB.bt_order_move(b, s.id, [[door[0], door[1] + 1]]);
  for (let t = 0; t < 8 && !b.over; t++) {
    if (b.civs.length && b.civs.every((q) => q.follow === s.id)) OB.bt_order_move(b, s.id, [[Math.floor(s.anchor[0]), b.extract_y]]);
    b.wave.count = 0; OB.bt_run_turn(b); b.zeds.length = 0;
  }
  assert.strictEqual(b.saved, b.civ_total, `all of them out (${b.saved}/${b.civ_total})`);
  assert(b.over && b.over.victory);
}
console.log('battle tests passed');
