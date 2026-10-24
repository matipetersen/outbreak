// ---------------------------------------------------------------- Dash: the tide behind you (web only)
// No calendar: a front of the dead rolls up the road from where you started towards the way out, a little slower than a walk.
// Everything you do costs ground (a building searched, a night slept, a detour on the road). Fall behind it and the dead pour
// in around you; fall far behind and it closes over you. At the end there is no hold-out: the transport is already loading,
// and you have to reach its doors before it goes.
const FRONT_SPEED = 0.42, FRONT_START = -34, FRONT_GRACE = 100, FRONT_DEADLY = 30;
const FRONT_DEPART_RANGE = 22, FRONT_DEPART_TURNS = 60, FRONT_SWARM_EVERY = 3, FRONT_SWARM_CAP = 12;
const FRONT_WARN = [30, 15, 6];

// The scenario itself is data from the Python packs; the web game changes what Dash means.
Object.assign(CONTENT.scenarios.dash, {
  front: true, deadline_days: 0, final_turns: 0, final_verb: 'board the transport',
  name: 'Dash - outrun the tide',
  blurb: 'No parts and no calendar. The dead are a tide rolling up the road behind you, a little slower than a walk. Every building '
    + 'you search, every night you sleep, costs ground. Reach the last transport before it leaves, with the tide at your heels.',
  goal: 'Stay ahead of the tide and reach the transport before it leaves.',
  premise: 'You are not hurt, and the word on {radio} is that the last transport is loading at {pad}. Behind you the city is going '
    + 'under: not a crowd but a tide, every street at once, rolling up the road the way you came. It moves a little slower than '
    + 'you walk. Every time you stop, it gains. Do not let it reach you.',
  premise_living: 'The last transport is loading at {pad}, by way of {radio}. Behind every survivor who tries, a tide of the dead '
    + 'rolls up the road. If you fall, another survivor walks out of {refuge} behind you, and the tide does not wait for them either.',
});
CONTENT.story.SCENARIO_TAIL.dash = 'The tide does not sleep and does not search crates. Everything you stop for, it gains on you.';
for (const band of ['saint', 'survivor', 'cold', 'monster']) {
  CONTENT.win_endings[`dash|${band}`] = {
    saint: ['Outran it - and not alone', 'The ramp is already rising when you reach it. Hands pull you up, and the people you helped on the road are among them. Below, the tide fills the street you ran down.'],
    survivor: ['Outran it', 'You throw yourself onto the ramp as it lifts. Behind you the tide breaks over the place you were standing a moment ago.'],
    cold: ['Outran it, alone', 'You make the ramp. Nobody else from the road does. You do not look back at the tide; there is nothing in it you want to see.'],
    monster: ['First aboard', 'You reach the transport ahead of everyone, and you make sure it stays that way. The crew watch you the whole trip.'],
  }[band];
}

const front_on = (game) => !!game.front;

function front_setup(game) {
  if (!game.scenario.front) return;
  const a = game.world.start, pad = game.pois[game.pad_id], b = [pad.x, pad.y];
  const len = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const speed = FRONT_SPEED * ({ easy: 0.85, normal: 1.0, hard: 1.15 }[game.cfg.difficulty] || 1.0);
  game.front = { ax: a[0], ay: a[1], bx: b[0], by: b[1], len, pos: FRONT_START, speed, warned: 0, depart: 0, overrun: [], swarm: 0, from: game.clock.turn + FRONT_GRACE };
  pad.revealed = true;                                                   // the radio already told you where; the race is getting there
}

// How far along the road (start -> way out) a point is, in tiles.
function front_along(game, x, y) { const f = game.front; return ((x - f.ax) * (f.bx - f.ax) + (y - f.ay) * (f.by - f.ay)) / f.len; }
function front_player_pos(game) {
  const p = game.player;
  if (game.level === game.world.level) return [p.x, p.y];
  const poi = game.poi_of_level(game.level);
  return poi ? [poi.x, poi.y] : [p.x, p.y];
}
function front_gap(game) { const [x, y] = front_player_pos(game); return front_along(game, x, y) - game.front.pos; }
function front_progress(game) { const [x, y] = front_player_pos(game); return Math.max(0, Math.min(1, front_along(game, x, y) / game.front.len)); }

// A new survivor (hardcore) starts their own race: the tide falls back to where it would be for someone just setting out.
function front_reset(game) {
  const f = game.front;
  if (!f) return;
  const [x, y] = front_player_pos(game);
  f.pos = Math.min(f.pos, front_along(game, x, y) + FRONT_START); f.from = game.clock.turn + FRONT_GRACE; f.depart = 0; f.warned = 0; f.swarm = 0;
}

// The road ate some time (an incident): the tide gains what it would have walked meanwhile.
function front_lose_time(game, turns) { if (game.front) game.front.pos += Math.max(0, turns) * game.front.speed; }

function front_status(game) {
  const f = game.front;
  if (!f) return '';
  if (f.depart) return `LEAVING IN ${f.depart}`;
  const gap = Math.round(front_gap(game));
  return gap < 0 ? 'THE TIDE IS ON YOU' : `Tide ${dist_words(game.era.id, gap)} behind`;
}

function front_tick(game) {
  const f = game.front;
  if (!f || game.over || game.clock.turn < (f.from === undefined ? FRONT_GRACE : f.from)) return;
  f.pos += f.speed * (game.clock.is_night ? 1.15 : 1.0);
  const gap = front_gap(game), p = game.player;
  for (let i = 0; i < FRONT_WARN.length; i++) {
    if (f.warned <= i && gap < FRONT_WARN[i]) {
      f.warned = i + 1;
      game.msg(['Behind you, far off, the sound of the tide: thousands of feet, and no voices.', 'The tide is close now. You can see it at the end of the road behind you.',
                'It is right behind you. Move!'][i], i === 2 ? 'bad' : 'warn', true);
      if (i === 2) game.add_panic(10);
    }
  }
  if (gap > FRONT_WARN[0] + 10) f.warned = 0;
  if (gap < 0) front_swarm(game, gap);
  if (gap < -FRONT_DEADLY) { game.end('left_behind', 'tide'); return; }
  if (game.clock.turn % 20 === 0) front_overrun(game);
  if (!f.depart && game.level === game.world.level && cheb([p.x, p.y], [f.bx, f.by]) <= FRONT_DEPART_RANGE) front_depart(game);
  else if (f.depart) {
    f.depart -= 1;
    if (f.depart === 15 || f.depart === 5) game.msg(`The engines change pitch. ${f.depart} more turns and it is gone.`, 'bad', true);
    if (f.depart <= 0) game.end('left_behind', 'departed');
  }
}

// The tide has caught you: the dead come at you from every side, more the further it has rolled past.
function front_swarm(game, gap) {
  const f = game.front, p = game.player, lv = game.level;
  if (++f.swarm % FRONT_SWARM_EVERY) return;
  if (f.swarm === FRONT_SWARM_EVERY) game.msg('The tide reaches you. The dead are everywhere, all at once.', 'bad', true);
  const near = lv.actors.filter((a) => a.kind === 'zombie' && cheb(apos(a), [p.x, p.y]) <= 10).length;
  if (near >= FRONT_SWARM_CAP) return;
  const n = 1 + (gap < -12 ? 1 : 0) + (gap < -22 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    let spot = null;
    for (let k = 0; k < 20 && !spot; k++) {
      const ang = game.rng.uniform(0, TAU), r = game.rng.randint(5, 9);
      const q = [Math.trunc(p.x + Math.cos(ang) * r), Math.trunc(p.y + Math.sin(ang) * r)];
      if (lv.free(q[0], q[1]) && !NO_ENTRY.has(lv.tile(q[0], q[1]))) spot = q;
    }
    if (!spot && lv !== game.world.level) spot = lv.free_spot_near(lv.entry[0], lv.entry[1], 4);
    if (!spot) continue;
    const z = spawn_zombie(game, lv, spot, null, false, true);
    z.state = 'hunt'; z.target = [p.x, p.y]; z.stimulus_turn = game.clock.turn;
  }
  game.add_panic(1.5);
}

// Buildings the tide has rolled over are full of the dead.
function front_overrun(game) {
  const f = game.front;
  for (const poi of Object.values(game.pois)) {
    if (poi.overrun || poi.kind === 'breach' || poi.kind === 'pad' || front_along(game, poi.x, poi.y) > f.pos - 4) continue;
    poi.overrun = true;
    const lv = game.levels[poi_level_id(poi)];
    if (!lv || lv === game.level) continue;
    for (let i = 0; i < 4 + Math.floor(poi.danger * 3); i++) { const s = lv.free_spot_near(lv.entry[0] + game.rng.randint(-6, 6), lv.entry[1] - game.rng.randint(1, 6), 3); if (s) spawn_zombie(game, lv, s, null, true); }
  }
}

// A building generated after the tide passed it.
function front_on_level_created(game, lv, poi) {
  if (!game.front || !poi.overrun) return;
  for (let i = 0; i < 4 + Math.floor(poi.danger * 3); i++) { const s = lv.free_spot_near(lv.entry[0] + game.rng.randint(-6, 6), lv.entry[1] - game.rng.randint(1, 6), 3); if (s) spawn_zombie(game, lv, s, null, true); }
}

// Close to the way out: the transport is loading, and the tide closes in for the last stretch.
function front_depart(game) {
  const f = game.front, p = game.player;
  f.depart = FRONT_DEPART_TURNS;
  const pad = game.pois[game.pad_id];
  pad.revealed = true;
  f.pos = Math.max(f.pos, front_along(game, p.x, p.y) - 14);
  game.msg(`The transport at ${pad.name} is loading, and it is not waiting. Get to its doors: ${compass(pad.x - p.x, pad.y - p.y)}, ${dist_words(game.era.id, cheb([pad.x, pad.y], [p.x, p.y]))}.`, 'obj', true);
  const back = [Math.trunc(p.x - (f.bx - f.ax) / f.len * 16), Math.trunc(p.y - (f.by - f.ay) / f.len * 16)];
  spawn_horde(game, back, 8, [p.x, p.y]);
}

// Reaching the transport's doors is the win: no siege, no bench.
function front_board(game) {
  game.escape_via = 'gate';
  game.msg('You throw yourself up the ramp as it starts to lift.', 'good', true);
  game.end('won');
}
