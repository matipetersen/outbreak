const assert = require('assert');
const { OB, make } = require('./helpers');
const { FakeStore } = require('./fakedb');

function quiet(g) { const lv = g.world.level; for (const a of lv.actors.slice()) if (a.kind !== 'player') lv.remove_actor(a); g.hordes.length = 0; return lv; }

// turn-based until the live loop starts (normal mode never goes live)
{
  const g = make({ mode: 'living', seed: 3 }), t0 = g.clock.turn;
  assert(g.ready()); g.wait(3); assert.strictEqual(g.clock.turn, t0 + 3);
  const n = make({ seed: 3 }); n.start_live; assert(n.cfg.mode === 'normal');
}

// the world ticks by itself, actions cost busy time and never tick the world
{
  const g = make({ mode: 'living', seed: 3, tick_ms: 500 }); quiet(g);
  const T0 = 1_000_000;
  g.start_live(T0);
  assert.strictEqual(g.live_update(T0 + 100), 0);
  assert.strictEqual(g.live_update(T0 + 500), 1);
  assert.strictEqual(g.live_update(T0 + 2000), 3);
  const turn = g.clock.turn;
  assert(g.move(1, 0) || g.move(0, 1) || g.move(-1, 0) || g.move(0, -1));
  assert.strictEqual(g.clock.turn, turn, 'an action must not advance the world');
  assert(!g.ready(), 'moving should keep you busy for a tick');
  g.live_update(T0 + 2500); assert(g.ready());
  // a long absence is clamped: the world does not run a thousand ticks at once
  const before = g.clock.turn; g.live_update(T0 + 3_000_000);
  assert(g.clock.turn - before <= 6, `ran ${g.clock.turn - before} ticks after a long absence`);
  // pause
  g.paused = true; const t = g.clock.turn; g.live_update(T0 + 3_100_000); assert.strictEqual(g.clock.turn, t);
}

// the world does not wait for you: a zombie next to an idle player hurts them
{
  const g = make({ mode: 'living', seed: 3, tick_ms: 200 }), lv = quiet(g), p = g.player;
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 1, p.y, 2), 'walker', false);
  z.state = 'hunt'; z.target = [p.x, p.y]; p.hp = p.max_hp = 500; g.invuln_until = 0;
  g.start_live(0);
  for (let i = 1; i <= 40; i++) g.live_update(i * 200);
  assert(p.hp < 500, 'the zombie never hurt an idle player');
}

// resting and sleeping are modes that pass in real time and stop when they should
{
  const g = make({ mode: 'living', seed: 3, tick_ms: 100 }), lv = quiet(g), p = g.player;
  p.hp = 10; p.max_hp = 80; g.start_live(0);
  assert.strictEqual(g.rest(30), 1); assert.strictEqual(g.rest_left, 30);
  let t = 0; for (let i = 0; i < 12; i++) g.live_update(t += 100);
  assert(p.hp > 10, 'resting did not heal in real time');
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 5, p.y, 3), 'walker', false);
  for (let i = 0; i < 3; i++) g.live_update(t += 100);
  assert.strictEqual(g.rest_left, 0, 'rest must stop when an enemy is in sight');
  lv.remove_actor(z);
  g.move(1, 0) || g.move(0, 1); assert.strictEqual(g.rest_left, 0);
  // sleep (in a safe place): busy for the whole night, wakes healed
  lv.safe = true; p.hp = 5; const turns = g.sleep(); assert(turns > 0); assert(!g.ready());
  for (let i = 0; i < turns + 2; i++) g.live_update(t += 100);
  assert(g.ready()); assert(p.hp > 5, 'sleep did not heal on waking');
}

// shared world: the clock is anchored to the season, so everyone shares the sun; long absences jump
(async () => {
  const store = new FakeStore(); let now = 5_000_000_000;
  const cfg0 = { era: 'modern', zombies: 'classic', scenario: 'cure', difficulty: 'normal', needs: false, map_w: 120, map_h: 76 };
  const season = OB.new_season(null, cfg0, now, { seed: 5, tickMs: 500, dayMs: 3600e3 });
  assert.strictEqual(season.tickMs, 500);
  await store.db().doc('season/current').set(season);
  const mk = async (uid, origin) => {
    const g = OB.make_game(Object.assign({}, cfg0, { mode: 'shared', seed: season.seed, origin, opening: 'meal', season_n: 1, clock_turn: OB.season_turn(season, now) }));
    const sw = new OB.SharedWorld(store.db(), uid, season, () => now); sw.attach(g); g.start_live(now); return [g, sw];
  };
  now += 60_000;
  const [A] = await mk('uA', 'medic'); now += 7_000; const [B] = await mk('uB', 'soldier');
  assert.strictEqual(A.clock.turn, Math.floor(60_000 / 500)); assert.strictEqual(B.clock.turn, Math.floor(67_000 / 500));
  A.live_update(now); assert.strictEqual(A.clock.turn, B.clock.turn, 'players must share the same instant');
  now += 5_000; A.live_update(now); B.live_update(now);
  assert.strictEqual(A.clock.turn, B.clock.turn); assert.strictEqual(A.clock.hour, B.clock.hour);
  const before = A.clock.turn; now += 6 * 3600e3; A.live_update(now);
  assert(A.clock.turn - before > 1000 && A.clock.turn === Math.floor((now - season.startedAt) / 500) - 0 || A.clock.turn >= Math.floor((now - season.startedAt) / 500) - 3, 'did not jump to the present');
  assert(OB.game_day(A) >= 7);
  // death while live gives a moment of grace, then the world continues in real time
  const gA = A, lv = gA.world.level;
  gA.player.hp = 0; gA.end('dead', 'x');
  assert(gA.invuln_until > gA.clock.turn);
  const hp = gA.player.hp; OB.damage_player(gA, 30, 'x'); assert.strictEqual(gA.player.hp, hp, 'new survivor should be briefly protected');
  console.log('realtime: live ticks, busy time, rest, sleep, shared sun, long absence OK');
})().catch((e) => { console.error(e); process.exit(1); });
