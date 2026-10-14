// ---------------------------------------------------------------- a base of your own (see engine/base.py)
const BARRICADE_HP = 40, RAID_GAP = 150;
const STRUCTURES = [
  { id: 'workshop', name: 'Workshop', tile: T.WORKSHOP, cost: [['wood', 4], ['scrap', 3]], desc: 'Weapons are made beside it.', limit: 1 },
  { id: 'cot', name: 'Cot', tile: T.BED, cost: [['wood', 2], ['cloth', 3]], desc: 'Somewhere safe to sleep and heal.', limit: 2 },
  { id: 'locker', name: 'Locker', tile: T.LOCKER, cost: [['wood', 3], ['scrap', 2]], desc: 'A stash that survives you.', limit: 1 },
  { id: 'barricade', name: 'Barricade', tile: T.DOOR, cost: [['wood', 2], ['scrap', 1]], desc: 'A braced gate. The dead have to batter it down.', limit: 6 },
];
const STRUCTURE_BY_ID = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));

const in_base = (game) => !!game.base_id && game.level.id === game.base_id;
const hostiles_in = (lv) => lv.actors.filter((a) => a.hp > 0 && (a.kind === 'zombie' || (a.kind === 'human' && a.hostile)));

function can_claim(game) {
  const lv = game.level;
  if (lv.kind !== 'interior') return 'A base has to be a building with walls: step inside one.';
  if (game.base_id === lv.id) return 'This is already your base.';
  if (hostiles_in(lv).length) return 'Something is still in here. Clear it first.';
  return '';
}

function claim_base(game) {
  const reason = can_claim(game);
  if (reason) { game.msg(reason, 'warn'); return 0; }
  const old = game.base_id, lv = game.level;
  if (old && game.levels[old]) game.levels[old].safe = false;
  game.base_id = lv.id; lv.safe = true; game.raid_next = game.clock.turn + RAID_GAP;
  game.msg(`You claim ${lv.name} as your base.` + (old ? ' The old one is left to the dead.' : ''), 'good', true);
  return 2;
}

const _built_count = (lv, sid) => Object.values(lv.built).filter((v) => v === sid).length;

function _connected(lv, start, goal) {
  const seen = new Set([lv.idx(start[0], start[1])]), q = [start];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal[0] && y === goal[1]) return true;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy, k = lv.idx(nx, ny);
      if (lv.in_bounds(nx, ny) && !seen.has(k) && lv.walkable(nx, ny)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return false;
}

function structure_status(game, s) {
  if (!in_base(game)) return [false, 'only in your base'];
  if (_built_count(game.level, s.id) >= s.limit) return [false, 'you have all you need'];
  const missing = s.cost.filter(([i, q]) => game.player.count(i) < q).map(([i, q]) => `${q}x ${game.item_def(i).name.toLowerCase()}`);
  return missing.length ? [false, 'missing ' + missing.join(', ')] : [true, ''];
}

function _build_site(game) {
  const lv = game.level, p = game.player;
  for (const [dx, dy] of DIRS8) {
    const x = p.x + dx, y = p.y + dy, k = lv.idx(x, y);
    if (lv.tile(x, y) === T.FLOOR && !lv.occ.has(k) && !lv.items[k] && !lv.portals[k] && !lv.containers[k] && !lv.hazards[k]) return [x, y];
  }
  return null;
}

function build_structure(game, sid) {
  const s = STRUCTURE_BY_ID[sid];
  if (!s) return 0;
  const [ok, why] = structure_status(game, s);
  if (!ok) { game.msg(`You cannot build that: ${why}.`, 'warn'); return 0; }
  const lv = game.level, p = game.player, pos = _build_site(game);
  if (!pos) { game.msg('There is no clear floor next to you to build on.', 'warn'); return 0; }
  lv.set_tile(pos[0], pos[1], s.tile);
  if (!_connected(lv, [p.x, p.y], lv.entry)) {                // never wall yourself in
    lv.set_tile(pos[0], pos[1], T.FLOOR);
    game.msg('That would block the way through. Build somewhere else.', 'warn');
    return 0;
  }
  for (const [i, q] of s.cost) p.take(i, q);
  const k = lv.idx(pos[0], pos[1]);
  lv.built[k] = s.id;
  if (s.id === 'barricade') lv.door_hp[k] = BARRICADE_HP;
  p.gain_xp(4);
  game.msg(`You build a ${s.name.toLowerCase()}.`, 'good', s.id !== 'barricade');
  return 4;
}

function stash_put(game, index) {
  const lv = game.level, p = game.player;
  if (!(index >= 0 && index < p.inventory.length)) return false;
  const item = p.inventory.splice(index, 1)[0], d = game.item_def(item.id);
  const have = d.stackable ? lv.stash.find((h) => h.id === item.id) : null;
  if (have) have.qty += item.qty; else lv.stash.push(item);
  game.msg(`You put the ${d.name.toLowerCase()} in the locker.`, 'info');
  return true;
}

function stash_take(game, index) {
  const lv = game.level, p = game.player;
  if (!(index >= 0 && index < lv.stash.length)) return false;
  const item = lv.stash[index], d = game.item_def(item.id);
  if (!p.add_item(item, d.stackable)) { game.msg('Your pack is full.', 'warn'); return false; }
  lv.stash.splice(index, 1);
  game.msg(`You take the ${d.name.toLowerCase()} from the locker.`, 'info');
  return true;
}
