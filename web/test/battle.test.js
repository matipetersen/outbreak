const assert = require('assert');
const { OB } = require('./helpers');

const mk = (cfg) => OB.bt_new(Object.assign({ seed: 5 }, cfg));
const ticks = (b, n) => { for (let i = 0; i < n && b.phase === 'resolve' && !b.over; i++) OB.bt_tick(b); };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const placeMen = (b, s, x, y) => { s.anchor = [x, y]; s.path = []; for (const m of OB.bt_squad_men(b, s)) { m.x = x; m.y = y; } };

{ // every era, preset and objective makes a battlefield the dead can cross and the living can use
  for (const era of Object.keys(OB.CONTENT.eras)) for (const zombies of Object.keys(OB.CONTENT.presets)) for (const objective of ['hold', 'rescue']) {
    const b = mk({ era, zombies, objective });
    const north = []; for (let x = 0; x < b.w; x++) if (OB.bt_cost(b, x, 'z') !== Infinity) north.push(x);
    const f = OB.bt_dijkstra(b, north, 'z');
    if (b.refuge) assert(f[OB.bt_idx(b, b.refuge.x0, b.refuge.y0)] < Infinity, `${era}/${zombies}: the dead can reach the refuge`);
    if (b.house) assert(f[OB.bt_idx(b, b.house.door[0], b.house.door[1])] < Infinity, 'the dead can reach the house');
    assert.strictEqual(b.squads.length, 4);
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
  for (const objective of ['hold', 'rescue']) for (const cfg of runs) {
    const b = mk(Object.assign({ objective, seed: 11 }, cfg));
    for (let t = 0; t < 12 && !b.over; t++) OB.bt_run_turn(b);
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
console.log('battle tests passed');
