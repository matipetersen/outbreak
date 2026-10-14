// ---------------------------------------------------------------- hordes: abstract crowds, and the opening ring
const MATERIALIZE_RADIUS = 15, MAX_ON_SCREEN = 24, RING_RADIUS = 26, RING_SPEED_CAP = 0.8, TAU = Math.PI * 2;

function spawn_horde(game, pos, size = null, target = null) {
  const prof = game.profile;
  const spot = game.world.level.free_spot_near(pos[0], pos[1], 6);
  if (!spot) return null;
  if (size === null) size = game.rng.randint(prof.horde_size[0], prof.horde_size[1]);
  size = Math.max(2, Math.floor(size * profile_phase(prof, game_day(game)).spawn * game.diff.zombies * game.pressure));
  const h = { id: game.next_uid(), x: spot[0], y: spot[1], size, target, energy: 0, announced: false, home_turn: game.clock.turn, wait_until: 0 };
  game.hordes.push(h);
  return h;
}

function start_ring(game, count = 7) {
  const lv = game.world.level;
  const [cx, cy] = game.world.start;
  const gap = game.rng.uniform(0, TAU);
  let spawned = 0;
  for (let i = 0; i < count * 2; i++) {
    const ang = i * TAU / (count * 2) + game.rng.uniform(-0.1, 0.1);
    if (Math.abs(Math.atan2(Math.sin(ang - gap), Math.cos(ang - gap))) < 0.55) continue;
    let x = Math.trunc(cx + Math.cos(ang) * RING_RADIUS * 1.3), y = Math.trunc(cy + Math.sin(ang) * RING_RADIUS * 0.85);
    x = Math.max(3, Math.min(lv.w - 4, x)); y = Math.max(3, Math.min(lv.h - 4, y));
    const size = Math.max(3, Math.floor(game.rng.randint(game.profile.horde_size[0], game.profile.horde_size[1]) / 2));
    if (spawn_horde(game, [x, y], size, game.world.start.slice())) spawned++;
    if (spawned >= count) break;
  }
  game.ring = { center: game.world.start.slice(), radius: RING_RADIUS, escaped: false, active: true };
}

function _horde_step(game, h) {
  const lv = game.world.level;
  let goal = h.target;
  if (goal === null || cheb([h.x, h.y], goal) <= 2) {
    if (h.target !== null) h.target = null;
    const ang = game.rng.uniform(0, TAU), r = game.rng.randint(12, 30);
    goal = [Math.trunc(h.x + Math.cos(ang) * r), Math.trunc(h.y + Math.sin(ang) * r)];
    goal = [Math.max(3, Math.min(lv.w - 4, goal[0])), Math.max(3, Math.min(lv.h - 4, goal[1]))];
    h.target = goal;
  }
  const nxt = greedy_step(lv, [h.x, h.y], goal, game.rng);
  if (nxt === null) { h.target = null; return; }
  h.x = nxt[0]; h.y = nxt[1];
}

function hordes_tick(game) {
  const prof = game.profile, p = game.player;
  const on_world = game.level === game.world.level;
  if (prof.sun_burn && game.clock.is_day) return;
  let speed = Math.max(0.3, prof.speed * (game.clock.is_night ? prof.night_speed : 1.0) * profile_phase(prof, game_day(game)).speed);
  if (game.ring && game.ring.active) speed = Math.min(speed, RING_SPEED_CAP);
  for (const h of game.hordes.slice()) {
    h.energy += speed;
    while (h.energy >= 1.0) { h.energy -= 1.0; _horde_step(game, h); }
    if (!on_world) continue;
    const d = cheb([h.x, h.y], [p.x, p.y]);
    if (d <= MATERIALIZE_RADIUS && game.clock.turn >= (h.wait_until || 0)) materialize(game, h);
    else if (d <= 32 && !h.announced && game.clock.turn - game.last_moan >= 40) {
      h.announced = true;
      game.last_moan = game.clock.turn;
      game.msg(`You hear a distant moaning to the ${compass(h.x - p.x, h.y - p.y)}.`, 'warn');
    }
  }
  const ring = game.ring;
  if (ring && ring.active && on_world) {
    if (cheb([p.x, p.y], ring.center) > ring.radius + 4 && !ring.escaped) {
      ring.escaped = true; ring.active = false;
      p.gain_xp(35);
      game.msg('You break through the closing tide. Behind you, the dead are filling the breach.', 'good');
      game.on_ring_escaped();
    }
  }
}

function materialize(game, h) {
  const lv = game.world.level;
  const i = game.hordes.indexOf(h);
  if (i >= 0) game.hordes.splice(i, 1);
  const n = Math.min(h.size, MAX_ON_SCREEN);
  let placed = 0;
  for (let k = 0; k < n * 3; k++) {
    if (placed >= n) break;
    const spot = lv.free_spot_near(h.x + game.rng.randint(-3, 3), h.y + game.rng.randint(-3, 3), 3);
    if (!spot || cheb(spot, [game.player.x, game.player.y]) < 4) continue;
    const z = spawn_zombie(game, lv, spot, null, false);
    z.state = 'investigate'; z.target = [game.player.x, game.player.y]; z.stimulus_turn = game.clock.turn; z.horde = h.id;
    placed++;
  }
  const leftover = h.size - placed;
  if (game.cfg.mode !== 'normal' && leftover >= 2) { h.size = leftover; h.wait_until = game.clock.turn + 12; game.hordes.push(h); }   // nobody vanishes
  if (placed) { game.msg(`A horde of ${placed} comes into view!`, 'bad', true); game.add_panic(8); }
}

function noise_attracts(game, pos, radius) {
  for (const h of game.hordes) if (dist([h.x, h.y], pos) <= radius * 1.6 * game.profile.hearing) h.target = pos.slice();
}

function wanderers(game) {
  if (game.level !== game.world.level || game.clock.turn % 25) return;
  const prof = game.profile;
  if (prof.sun_burn && game.clock.is_day) return;
  let chance = 0.22 * profile_phase(prof, game_day(game)).spawn * game.diff.zombies * prof.density * game.pressure * dir_scale(game);
  if (game.clock.is_night) chance *= 1.5;
  chance += game.heat / 400.0;
  if (game.rng.random() >= chance) return;
  const p = game.player, lv = game.world.level;
  for (let k = 0; k < 20; k++) {
    const ang = game.rng.uniform(0, TAU), r = game.rng.randint(20, 32);
    const pos = [Math.trunc(p.x + Math.cos(ang) * r), Math.trunc(p.y + Math.sin(ang) * r)];
    if (pos[0] >= 2 && pos[0] < lv.w - 2 && pos[1] >= 2 && pos[1] < lv.h - 2 && lv.free(pos[0], pos[1])) {
      if (game.heat > 55 && game.rng.random() < 0.5) spawn_horde(game, pos, null, [p.x, p.y]);
      else {
        const n = game.rng.randint(1, 3);
        for (let i = 0; i < n; i++) {
          const spot = lv.free_spot_near(pos[0], pos[1], 2);
          if (spot) {
            const z = spawn_zombie(game, lv, spot, null, false, true);
            z.state = 'investigate'; z.target = [p.x, p.y]; z.stimulus_turn = game.clock.turn;
          }
        }
      }
      return;
    }
  }
}
