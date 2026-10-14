// ---------------------------------------------------------------- raiders: ambushes, snares, morale (see engine/raiders.py)
const SNARE_POWER = 8, SPRING_RANGE = 3;
const is_raider = (a) => a.kind === 'human' && a.role === 'raider' && a.hostile && a.hp > 0;

function raiders_alert_near(game, pos, radius) {                             // a clatter, a shout: every raider within earshot knows where you are
  const p = game.player;
  for (const a of game.level.actors) if (is_raider(a) && cheb(apos(a), pos) <= radius) { a.hidden = false; a.state = 'hunt'; a.target = [p.x, p.y]; }
}

function raiders_spring(game, h, text = '') {                                // someone lying in wait jumps out, and so does the rest of its squad
  const p = game.player;
  const squad = game.level.actors.filter((a) => is_raider(a) && a.hidden && (a === h || (h.squad && a.squad === h.squad)));
  for (const a of squad) { a.hidden = false; a.state = 'hunt'; a.target = [p.x, p.y]; }
  if (squad.length) game.msg(text || 'Raiders burst out of cover!', 'bad', true);
}

function raiders_notice_snares(game) {                                       // walking, you may spot a snare next to you (more likely if you creep)
  const p = game.player, lv = game.level, reach = p.sneaking ? 2 : 1, chance = p.sneaking ? 0.7 : 0.35;
  for (const k of Object.keys(lv.hazards)) {
    const hz = lv.hazards[k];
    if (hz.kind !== 'snare' || !hz.hidden) continue;
    if (cheb([+k % lv.w, Math.floor(+k / lv.w)], [p.x, p.y]) <= reach && game.rng.random() < chance) { hz.hidden = false; game.msg('You spot a snare in the ground ahead.', 'good'); return; }
  }
}

function raiders_shaken(game, dead) {                                        // friends dying shakes the rest of the squad
  for (const a of game.level.actors) if (is_raider(a) && a !== dead && (cheb(apos(a), apos(dead)) <= 8 || (dead.squad && a.squad === dead.squad))) a.morale = Math.max(0, (a.morale === undefined ? 100 : a.morale) - 25);
}

// for a raider lying in wait: spring, be spotted by a creeping player, or stay put. True if it stays hidden.
function raiders_spring_check(game, h, humans, d) {
  const p = game.player, reach = p.sneaking ? 2 : SPRING_RANGE;
  if (d <= reach && has_los(game.level, apos(h), apos(p))) { raiders_spring(game, h); return false; }
  if (humans.some((o) => is_raider(o) && o.squad === h.squad && o.state === 'hunt' && cheb(apos(o), apos(h)) <= 12)) { raiders_spring(game, h, 'Raiders break cover!'); return false; }
  if (p.sneaking && d <= 3 && game.rng.random() < 0.25) { h.hidden = false; game.msg('You spot a raider crouched in cover.', 'good'); return false; }
  return true;
}

// a camp is not a clearing: half its raiders lie in wait round it, and the approaches are snared
function raiders_setup_camp(game, lv, camp, crew, rng) {
  const squad = crew.length ? crew[0].uid : 0;
  crew.forEach((r, i) => { r.squad = squad; r.flank = i % 2 === 0 ? 1 : -1; });
  crew.forEach((r, i) => {
    if (i % 2 === 0) return;
    for (let t = 0; t < 30; t++) {
      const x = camp[0] + rng.randint(-9, 9), y = camp[1] + rng.randint(-9, 9), d = cheb([x, y], camp);
      if (d >= 4 && d <= 9 && lv.free(x, y) && [T.GRASS, T.BRUSH, T.ROAD].includes(lv.tile(x, y))) { lv.move_actor(r, x, y); r.hidden = true; r.state = 'idle'; break; }
    }
  });
  let placed = 0;
  for (let t = 0; t < 60 && placed < 5; t++) {
    const x = camp[0] + rng.randint(-9, 9), y = camp[1] + rng.randint(-9, 9), d = cheb([x, y], camp);
    if (d >= 4 && d <= 9 && lv.free(x, y) && [T.GRASS, T.ROAD, T.BRUSH].includes(lv.tile(x, y)) && !lv.hazards[lv.idx(x, y)]) { lv.hazards[lv.idx(x, y)] = { kind: 'snare', ttl: 1e9, power: SNARE_POWER, hidden: true }; placed++; }
  }
}

// ---------------------------------------------------------------- raiders anywhere
const RAIDER_SPOT_TILES = [T.GRASS, T.BRUSH, T.ROAD, T.FLOOR];

function raiders_squad_up(game, group) {                                      // one squad: shared id, alternating flanks
  const squad = game.next_uid();
  group.forEach((r, i) => { r.squad = squad; r.flank = i % 2 === 0 ? 1 : -1; });
  return squad;
}

function _raider_spot(game, lv, centre, lo, hi, brush_first = false) {
  let best = null;
  for (let i = 0; i < 40; i++) {
    const x = centre[0] + game.rng.randint(-hi, hi), y = centre[1] + game.rng.randint(-hi, hi), d = cheb([x, y], centre);
    if (d >= lo && d <= hi && lv.free(x, y) && RAIDER_SPOT_TILES.includes(lv.tile(x, y))) {
      if (!brush_first || lv.tile(x, y) === T.BRUSH) return [x, y];
      best = best || [x, y];
    }
  }
  return best;
}

// raiders waiting for you wherever you are (a road event, a toll gone wrong): half lie hidden close by, the rest stand off
// at range, and a few snares are laid between you and them
function raiders_ambush(game, lv, n) {
  const p = game.player, group = [];
  for (let i = 0; i < n; i++) {
    const hide = i % 2 === 1, spot = hide ? _raider_spot(game, lv, [p.x, p.y], 4, 8, true) : _raider_spot(game, lv, [p.x, p.y], 7, 11);
    if (!spot || cheb(spot, [p.x, p.y]) < 3) continue;
    const r = make_raider(game, spot[0], spot[1]);
    r.hidden = hide; r.state = hide ? 'idle' : 'hunt';
    lv.add_actor(r); group.push(r);
  }
  raiders_squad_up(game, group);
  for (let i = 0; i < 3; i++) {
    const spot = _raider_spot(game, lv, [p.x, p.y], 2, 6);
    if (spot && !lv.hazards[lv.idx(spot[0], spot[1])] && lv.tile(spot[0], spot[1]) !== T.FLOOR) lv.hazards[lv.idx(spot[0], spot[1])] = { kind: 'snare', ttl: 1e9, power: SNARE_POWER, hidden: true };
  }
  return group.length;
}
