const assert = require('assert');
const { OB, make } = require('./helpers');
const { FakeStore } = require('./fakedb');
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  const store = new FakeStore();
  let now = 1_000_000_000_000;
  const clock = () => now;
  const cfg0 = { era: 'modern', zombies: 'classic', scenario: 'cure', difficulty: 'normal', needs: false, map_w: 120, map_h: 76 };
  const season = OB.new_season(null, cfg0, now, { seed: 77, dayMs: 3 * 3600e3, seasonMs: 7 * 86400e3 });
  await store.db().doc('season/current').set(season);
  assert.strictEqual(season.n, 1);

  const join = async (uid, origin, opening) => {
    const g = OB.make_game(Object.assign({}, cfg0, { mode: 'shared', seed: season.seed, origin, opening: opening || 'meal', season_n: season.n, clock_turn: OB.season_turn(season, now) }));
    const sw = new OB.SharedWorld(store.db(), uid, season, clock);
    sw.attach(g);
    await tick();
    return [g, sw];
  };

  const [A, swA] = await join('uA', 'medic');
  const [B, swB] = await join('uB', 'soldier');
  // the world is the same for both, whoever they are
  assert.deepStrictEqual(Object.values(A.pois).map((q) => q.name), Object.values(B.pois).map((q) => q.name));
  const ids = (g) => g.world.level.actors.filter((a) => OB.is_world_uid(g, a.uid)).map((a) => `${a.uid}:${a.x},${a.y}:${a.kind}`);
  assert.deepStrictEqual(ids(A), ids(B), 'the seeded population must be identical for every player');
  assert.notStrictEqual(A.current_origin, B.current_origin);
  // survivors arrive at the refuge, real time sets the hour and the calendar
  const refuge = A.pois[A.refuge_id];
  assert(Math.abs(A.player.x - refuge.x) + Math.abs(A.player.y - refuge.y) < 20);
  assert.strictEqual(A.clock.turn, OB.season_turn(season, now));
  assert.strictEqual(OB.game_day(A), 1);

  // ---- enemies level offline: the calendar moves while nobody plays
  const lvlSum = (g) => g.world.level.actors.filter((a) => a.kind !== 'player').reduce((s, a) => s + (a.lvl || 1), 0);
  const before = lvlSum(A);
  now += 6 * 3 * 3600e3;                                   // six game days of real time
  A.clock.turn += 25 - (A.clock.turn % 25);
  swA.tick(A);
  assert(OB.game_day(A) === 7); assert(lvlSum(A) > before, 'enemies did not level while away');
  const sameForB = (() => { B.clock.turn += 25 - (B.clock.turn % 25); swB.tick(B); return lvlSum(B); })();
  assert.strictEqual(sameForB, lvlSum(A), 'catch-up levels must be deterministic per enemy');

  // ---- an ordinary enemy A kills stays dead for B
  const lvA = A.world.level, lvB = B.world.level;
  const victim = lvA.actors.find((a) => a.kind === 'zombie' && OB.is_world_uid(A, a.uid) && !a.sid);
  OB.kill_zombie(A, victim, false, true);
  swA.flush(); await tick();
  assert(!lvB.actors.some((a) => a.uid === victim.uid), 'the kill did not propagate');

  // ---- A dies: tomb with gear for B, killer named and levelled, hall entry
  A.player.gain_xp(300);
  const pos = [A.player.x, A.player.y];
  const killer = OB.spawn_zombie(A, lvA, lvA.free_spot_near(pos[0] + 1, pos[1], 3), 'walker', false);
  A.clock.turn += 600;
  const gear = A.player.inventory.map((i) => i.id);
  A.player.hp = 1; OB.damage_player(A, 9, 'torn apart', killer);
  await tick();
  assert.strictEqual(A.generation, 2);
  const tombs = [...store.docs.entries()].filter(([p]) => p.startsWith('tombs/'));
  assert.strictEqual(tombs.length, 1);
  const k = lvB.idx(pos[0], pos[1]);
  assert(lvB.items[k] && gear.every((g) => lvB.items[k].some((i) => i.id === g)), 'B does not see the tomb gear');
  assert.strictEqual(lvB.corpses[k][1], 2);
  const named = [...store.docs.entries()].filter(([p]) => p.startsWith('named/'));
  assert.strictEqual(named.length, 1);
  assert(named[0][1].title.startsWith('Killer of')); assert(named[0][1].alive);
  const killerForB = lvB.actors.find((a) => a.sid === killer.sid);
  assert(killerForB, 'B does not see the named killer'); assert(killerForB.title.startsWith('Killer of'));
  assert([...store.docs.keys()].some((p) => p.startsWith('hall/')));

  // ---- B loots the tomb: A (and everyone) sees it claimed and the floor emptied
  B.player.x = pos[0]; B.player.y = pos[1];
  const tombId = tombs[0][0].split('/')[1];
  for (const key of Object.keys(lvB.items)) if (+key === k) delete lvB.items[key];
  B.clock.turn += 25 - (B.clock.turn % 25); swB.tick(B); await tick();
  assert.strictEqual(store.docs.get(`tombs/${tombId}`).claimed, true);
  assert(!lvA.items[lvA.idx(pos[0], pos[1])] || A.applied_tombs[tombId] === 'claimed');

  // ---- B kills the named killer: it stays dead everywhere
  OB.kill_zombie(B, killerForB, true, true);
  await tick();
  assert.strictEqual(store.docs.get(`named/${killer.sid}`).alive, false);
  assert(!lvA.actors.some((a) => a.sid === killer.sid), 'the killer is still alive for A');

  // ---- components: once taken from a vault, nobody else gets it
  const vaultPoi = Object.values(B.pois).find((q) => q.component);
  OB.apply_taken(A, vaultPoi.component);
  assert(A.taken_components.includes(vaultPoi.component));
  swB.on_component_taken(vaultPoi.component); await tick();
  assert(B.taken_components.includes(vaultPoi.component) || store.docs.has(`taken/s1_${vaultPoi.component}`));

  // ---- outcome: B wins, A is told the season is closed
  B.end('won'); await tick();
  assert.strictEqual(store.docs.get('play/outcome').kind, 'won');
  assert(A.over && A.over.kind === 'closed' && A.over.text.includes('cure'), 'A was not told the world was saved');

  // ---- the keeper resets: new season, ledger cleaned, everyone told
  const [C, swC] = await join('uC', 'scholar');
  const reset = await OB.reset_world(store.db(), season, cfg0, now, {});
  assert.strictEqual(reset.n, 2); assert(reset.seed !== season.seed);
  await tick();
  assert(C.over && C.over.kind === 'closed' && C.season_reset);
  assert(![...store.docs.keys()].some((p) => p.startsWith('tombs/') || p.startsWith('named/') || p.startsWith('hall/')), 'old ledger not cleaned');

  // ---- season end by the calendar
  const s2 = reset; const [D, swD] = await join('uD', 'guard');
  assert.strictEqual(swD.n, 1);                                // joined with the stale season object on purpose
  now = s2.endsAt + 1; D.clock.turn += 25 - (D.clock.turn % 25); swD.tick(D);
  assert(D.over && D.over.kind === 'closed');

  // ---- saving a shared game keeps its bookkeeping
  const E = OB.make_game(Object.assign({}, cfg0, { mode: 'shared', seed: season.seed, origin: 'medic', opening: 'meal', season_n: 1, clock_turn: 10 }));
  const E2 = OB.deserialize_game(OB.serialize_game(E));
  assert.strictEqual(E2.cfg.mode, 'shared'); assert.strictEqual(E2.world.generated.size, E.world.generated.size); assert.strictEqual(E2.season_n, 1);
  console.log('shared: seasons, tombs, named enemies, kills, calendar levels OK');
})().catch((e) => { console.error(e); process.exit(1); });
