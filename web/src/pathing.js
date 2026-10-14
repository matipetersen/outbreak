// ---------------------------------------------------------------- breadth-first distance fields
const ZWALK = new Uint8Array(256);
for (let t = 0; t < 256; t++) ZWALK[t] = WALK[t] && t !== T.PORTAL && t !== T.STAIRS_UP && t !== T.STAIRS_DOWN ? 1 : 0;

// Int16Array of steps from src (-1 = unreachable within radius).
function distance_field(level, src, radius, swarm = false) {
  const { w, h, tiles } = level;
  const out = new Int16Array(w * h).fill(-1);
  const s = src[1] * w + src[0];
  out[s] = 0;
  const queue = [s];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi], x = cur % w, y = (cur - x) / w, d = out[cur];
    if (d >= radius) continue;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (out[ni] !== -1) continue;
      const t = tiles[ni];
      if (!(ZWALK[t] || (swarm && t === T.FENCE))) continue;
      if (dx && dy && !(ZWALK[tiles[y * w + nx]] && ZWALK[tiles[ny * w + x]])) continue;
      out[ni] = d + 1;
      queue.push(ni);
    }
  }
  return out;
}

// The free neighbouring tile with the smallest distance, if it improves on pos.
function descend(level, field, pos, rng, blocked = null) {
  const w = level.w;
  const here = field[pos[1] * w + pos[0]];
  const limit = here >= 0 ? here : 1e9;
  let best_d = limit, best = [];
  for (const [dx, dy] of DIRS8) {
    const nx = pos[0] + dx, ny = pos[1] + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= level.h) continue;
    const d = field[ny * w + nx];
    if (d < 0 || d >= limit || d > best_d) continue;
    if (dx && dy && !(level.walkable(pos[0] + dx, pos[1]) && level.walkable(pos[0], pos[1] + dy))) continue;
    const occupant = level.occ.get(ny * w + nx);
    if (occupant && occupant.kind !== 'player') continue;
    if (blocked && blocked.has(ny * w + nx)) continue;
    if (d < best_d) { best_d = d; best = [[nx, ny]]; } else best.push([nx, ny]);
  }
  return best.length ? rng.choice(best) : null;
}

function greedy_step(level, pos, goal, rng, can_pass = null) {
  const cands = [];
  for (const [dx, dy] of DIRS8) {
    const n = [pos[0] + dx, pos[1] + dy];
    if (!level.walkable(n[0], n[1])) continue;
    if (can_pass && !can_pass(n)) continue;
    const occupant = level.occ.get(level.idx(n[0], n[1]));
    if (occupant && !(n[0] === goal[0] && n[1] === goal[1])) continue;
    if (dx && dy && !(level.walkable(pos[0] + dx, pos[1]) && level.walkable(pos[0], pos[1] + dy))) continue;
    cands.push([(n[0] - goal[0]) ** 2 + (n[1] - goal[1]) ** 2 + rng.random() * 0.5, n]);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a[0] - b[0]);
  const here = (pos[0] - goal[0]) ** 2 + (pos[1] - goal[1]) ** 2;
  return cands[0][0] < here + 2 ? cands[0][1] : null;
}

// Shortest walkable path for the player (travel mode): BFS over known tiles, doors allowed.
function player_path(level, from, to, allow) {
  const { w } = level;
  const start = from[1] * w + from[0], goal = to[1] * w + to[0];
  const parent = new Map([[start, -1]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const x = cur % w, y = (cur - x) / w;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy, ni = ny * w + nx;
      if (!level.in_bounds(nx, ny) || parent.has(ni)) continue;
      if (ni !== goal && !(level.walkable(nx, ny) && allow(nx, ny))) continue;
      if (ni === goal && !allow(nx, ny)) continue;
      if (dx && dy && !(level.walkable(x + dx, y) && level.walkable(x, y + dy))) continue;
      if (level.tile(nx, ny) === T.PORTAL || level.tile(nx, ny) === T.STAIRS_UP || level.tile(nx, ny) === T.STAIRS_DOWN) {
        if (ni !== goal) continue;
      }
      parent.set(ni, cur);
      queue.push(ni);
    }
  }
  if (!parent.has(goal)) return null;
  const path = [];
  for (let c = goal; c !== start; c = parent.get(c)) path.push([c % w, Math.floor(c / w)]);
  return path.reverse();
}
