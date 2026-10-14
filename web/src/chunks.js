// ---------------------------------------------------------------- chunks: painting and populating the world as you approach
// A chunk is generated the first time the player gets within GEN_RADIUS of it. Everything in it (tiles, zombies, camps,
// patrols) comes from a stream derived from (seed, chunk) alone, and its actors get uids from a range reserved for that chunk,
// so two players who visit chunks in different orders still find the same world.
const GEN_RADIUS = 56;
const is_world_uid = (game, uid) => (game.world && game.world.chunked ? uid >= CHUNK_UID_BASE : uid <= game.world_uid_max);

function gen_chunk(game, cx, cy) {
  const world = game.world, key = chunk_key(cx, cy);
  if (world.generated.has(key)) return false;
  world.generated.add(key);
  paint_chunk(world, game.era, cx, cy);
  _populate_chunk(game, cx, cy);
  return true;
}

function gen_near(game, x, y, radius = GEN_RADIUS) {
  const w = game.world;
  if (!w.chunked) return 0;
  const S = w.S, cx0 = Math.max(0, Math.floor((x - radius) / S)), cx1 = Math.min(w.nx - 1, Math.floor((x + radius) / S));
  const cy0 = Math.max(0, Math.floor((y - radius) / S)), cy1 = Math.min(w.ny - 1, Math.floor((y + radius) / S));
  let n = 0;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (gen_chunk(game, cx, cy)) n++;
  return n;
}

function generate_all(game) {                       // tests and tools: paint the whole world
  const w = game.world;
  for (let cy = 0; cy < w.ny; cy++) for (let cx = 0; cx < w.nx; cx++) gen_chunk(game, cx, cy);
}

function _populate_chunk(game, cx, cy) {
  const world = game.world, lv = world.level, S = world.S, prof = game.profile, T_ = world.terrain, start = world.start;
  const saved = { rng: game.rng, uid: game._uid, day: game.gen_day };
  const rng = chunk_rng(world.seed, cx, cy, 23);
  game.rng = rng;
  game._uid = CHUNK_UID_BASE + (cy * world.nx + cx) * CHUNK_UID_STRIDE;
  game.gen_day = 1;                                  // stats do not depend on when the chunk is first seen
  const x0 = cx * S, y0 = cy * S, x1 = Math.min(lv.w, x0 + S), y1 = Math.min(lv.h, y0 + S);
  const dead = game.dead_uids;
  const keep = (a) => { if (dead.has(a.uid)) lv.remove_actor(a); else if (game.shared) catch_up_actor(game, a); return a; };
  try {
    const scale = prof.density * game.diff.zombies;
    const entry = world.by_chunk.get(chunk_key(cx, cy)) || { pois: [], camps: [] };
    if (!prof.sun_burn) {
      for (let y = Math.max(2, y0); y < Math.min(lv.h - 2, y1); y++) {
        for (let x = Math.max(2, x0); x < Math.min(lv.w - 2, x1); x++) {
          const t = lv.tiles[y * lv.w + x];
          if ((t !== T.GRASS && t !== T.ROAD && t !== T.BRUSH) || cheb([x, y], start) < 14) continue;
          if (rng.random() < ZONE_DENSITY[T_.zone_at(x, y)] * scale && !lv.occ.has(y * lv.w + x)) keep(spawn_zombie(game, lv, [x, y], null, false));
        }
      }
      for (const poi of entry.pois) {
        if (SPECIAL_KINDS.includes(poi.kind) || poi.kind === 'house') continue;
        const n = rng.randint(0, 2);
        for (let i = 0; i < n; i++) {
          const spot = lv.free_spot_near(poi.x + rng.randint(-3, 3), poi.y + 2, 3);
          if (spot && cheb(spot, start) > 12) keep(spawn_zombie(game, lv, spot, null, false));
        }
      }
    }
    for (const [cx2, cy2] of entry.camps) {
      const n = rng.randint(2, 4), crew = [];
      for (let i = 0; i < n; i++) {
        const spot = lv.free_spot_near(cx2 + rng.randint(-2, 2), cy2 + rng.randint(-1, 1), 3);
        if (spot) { const r = make_raider(game, spot[0], spot[1]); r.state = 'idle'; lv.add_actor(r); keep(r); crew.push(r); }
      }
      raiders_setup_camp(game, lv, [cx2, cy2], crew.filter((r) => lv.actors.includes(r)), rng);
      lv.containers[lv.idx(cx2 + 2, cy2 - 1)] = { loot: roll_items(rng, game.era, 'camp', 3.0, game.diff.loot), docs: [],
                                                   coins: rng.randint(2, 8), opened: false, note: '' };
    }
    // tripwires on the highway, here and there: raiders do not only defend camps
    const wr = chunk_rng(world.seed, cx, cy, 29);
    if (wr.random() < 0.4 && cheb([x0 + S / 2, y0 + S / 2], start) >= 30) {
      const wires = wr.randint(1, 2);
      for (let i = 0; i < wires; i++) {
        const sx = wr.random() < 0.5 ? x0 : x0 + wr.randint(2, S - 2), sy = sx === x0 ? y0 + wr.randint(2, S - 2) : y0;
        const k = lv.idx(sx, sy);
        if (lv.in_bounds(sx, sy) && lv.tile(sx, sy) === T.ROAD && !lv.hazards[k]) lv.hazards[k] = { kind: 'snare', ttl: 1e9, power: SNARE_POWER, hidden: true };
      }
    }
    // a military checkpoint on the highway now and then: three soldiers who stop travellers and search them
    const mr = chunk_rng(world.seed, cx, cy, 31);
    if (mr.random() < 0.22 && cheb([x0 + S / 2, y0 + S / 2], start) >= 35) {
      const bx = x0 + mr.randint(8, S - 8), by = y0;
      if (lv.in_bounds(bx, by) && lv.tile(bx, by) === T.ROAD) {
        const cp = military_register(game, cx + cy * world.nx + 1, bx, by);
        const before = lv.actors.length;
        military_post_guards(game, lv, cp);
        for (const a of lv.actors.slice(before)) keep(a);
      }
    }
    // game on the open ground: rabbits, deer, boar (own rng, own spots: they never depend on who was painted first)
    const gr = chunk_rng(world.seed, cx, cy, 37);
    for (let i = gr.randint(2, 4); i > 0; i--) {
      const gx = gr.randint(Math.max(x0 + 1, 3), Math.min(x1 - 2, lv.w - 4)), gy = gr.randint(Math.max(y0 + 1, 3), Math.min(y1 - 2, lv.h - 4)), sp = wild_pick_species(gr);
      if (wild_grazing(lv.tile(gx, gy)) && cheb([gx, gy], start) >= 14 && !lv.occ.has(lv.idx(gx, gy))) { const an = wild_make(game, gx, gy, sp); lv.add_actor(an); keep(an); }
    }
    // a wolf pack in the deep woods (own rng again)
    const wr2 = chunk_rng(world.seed, cx, cy, 41);
    if (wr2.random() < 0.55) {
      for (let tries = 0; tries < 30; tries++) {
        const wx = wr2.randint(Math.max(x0 + 3, 4), Math.min(x1 - 4, lv.w - 5)), wy = wr2.randint(Math.max(y0 + 3, 4), Math.min(y1 - 4, lv.h - 5));
        if (cheb([wx, wy], start) < 20 || !wild_in_forest_at(lv, [wx, wy]) || lv.tile(wx, wy) === T.TREE) continue;
        for (let m = wr2.randint(2, 3); m > 0; m--) {
          const sp = [wx + wr2.randint(-2, 2), wy + wr2.randint(-2, 2)];
          if (lv.in_bounds(sp[0], sp[1]) && wild_grazing(lv.tile(sp[0], sp[1])) && !lv.occ.has(lv.idx(sp[0], sp[1]))) { const an = wild_make(game, sp[0], sp[1], 'wolf'); lv.add_actor(an); keep(an); }
        }
        break;
      }
    }
    // strays: dogs and cats by the buildings, crows and foxes out on the open ground (own rng)
    const sr = chunk_rng(world.seed, cx, cy, 43);
    if (sr.random() < 0.4) {
      const species = sr.choice(['dog', 'cat', 'crow', 'fox']), anchors = entry.pois.filter((q) => q.kind !== 'house' && q.kind !== 'cave');
      for (let tries = 0; tries < 20; tries++) {
        let sx, sy;
        if ((species === 'dog' || species === 'cat') && anchors.length) { const q = sr.choice(anchors); sx = q.x + sr.randint(-3, 3); sy = q.y + 2 + sr.randint(0, 3); }
        else { sx = sr.randint(Math.max(x0 + 2, 4), Math.min(x1 - 3, lv.w - 5)); sy = sr.randint(Math.max(y0 + 2, 4), Math.min(y1 - 3, lv.h - 5)); }
        if (lv.in_bounds(sx, sy) && cheb([sx, sy], start) >= 10 && pets_ok_tile(lv.tile(sx, sy)) && !lv.occ.has(lv.idx(sx, sy))) { const an = pets_make_stray(game, species, sx, sy); lv.add_actor(an); keep(an); break; }
      }
    }
    // a patrol group now and then, standing on the chunk's highway
    if (rng.random() < 0.5 && cheb([x0 + S / 2, y0 + S / 2], start) >= 30) {
      const base = rng.random() < 0.5 ? [x0 + rng.randint(2, S - 2), y0] : [x0, y0 + rng.randint(2, S - 2)];
      if (lv.in_bounds(base[0], base[1]) && lv.walkable(base[0], base[1])) {
        const role = rng.random() < 0.5 ? 'scout' : 'soldier', members = rng.randint(2, 3);
        let group = 0;
        for (let m = 0; m < members; m++) {
          const spot = lv.free_spot_near(base[0], base[1], 3);
          if (!spot) continue;
          const a = make_patrol(game, role, spot[0], spot[1], group || game._uid + 1);
          group = a.group; lv.add_actor(a); keep(a);
        }
        if (group) game.patrol_goals[group] = pick_patrol_goal(game, base);
      }
    }
  } finally {
    game.rng = saved.rng; game._uid = saved.uid; game.gen_day = saved.day;
  }
  for (const a of lv.actors.slice()) {               // anything that wandered into this chunk before it was painted
    if (a.x < x0 || a.x >= x1 || a.y < y0 || a.y >= y1 || a.kind === 'player') continue;
    if (!lv.walkable(a.x, a.y)) { const spot = lv.free_spot_near(a.x, a.y, 6); if (spot) lv.move_actor(a, spot[0], spot[1]); else lv.remove_actor(a); }
  }
}

// patrols walk between buildings that are not too far from where they are
function pick_patrol_goal(game, from) {
  const nodes = game.patrol_nodes;
  if (!nodes.length) return from;
  const near = nodes.filter((n) => cheb(n, from) <= 80);
  return game.rng.choice(near.length ? near : nodes);
}
