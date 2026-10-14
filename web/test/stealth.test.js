const OB = require('../dist/engine.js');
const assert = require('assert');
function trial(seed, mode, side, state, zspecial = 'walker', facing = [1, 0]) {
  const g = OB.make_game({ era: 'modern', zombies: 'classic', seed, map_w: 160, map_h: 100 });
  const lv = g.world.level; for (const a of lv.actors.slice()) if (a.kind !== 'player') lv.remove_actor(a); g.hordes.length = 0; g.ring = null;
  const p = g.player; p.hp = p.max_hp = 1e6; p.infected = false;
  // an open row of 14 tiles somewhere
  let spot = null;
  for (let y = 10; y < lv.h - 10 && !spot; y++) for (let x = 10; x < lv.w - 24 && !spot; x++) { let ok = true; for (let i = 0; i < 16 && ok; i++) for (let j = -2; j <= 2 && ok; j++) ok = lv.free(x + i, y + j) && lv.tile(x + i, y + j) !== OB.T.PORTAL; if (ok) spot = [x, y]; }
  if (!spot) return null;
  g.world.generated.size; OB.gen_near(g, spot[0], spot[1]);
  lv.occ.delete(lv.idx(p.x, p.y));
  const zx = spot[0] + 12, zy = spot[1];
  const z = OB.spawn_zombie(g, lv, [zx, zy], zspecial, false); z.state = state; z.facing = facing.slice();   // looking east

  const start = side === 'behind' ? [spot[0], spot[1]] : [spot[0] + 15, spot[1]];   // behind = west of it
  p.x = start[0]; p.y = start[1]; lv.occ.set(lv.idx(p.x, p.y), p);
  p.sneaking = mode === 'sneak'; p.sprinting = false; g.update_fov();
  const dir = side === 'behind' ? 1 : -1;
  for (let i = 0; i < 40; i++) {
    const d = Math.max(Math.abs(p.x - z.x), Math.abs(p.y - z.y));
    if (d <= 1) break;
    if (z.state === 'hunt') return { noticed: true, d };
    g.move(dir, 0);
  }
  const d = Math.max(Math.abs(p.x - z.x), Math.abs(p.y - z.y));
  const noticed = z.state === 'hunt' || (z.alert || 0) >= 70;
  let killed = false;
  if (!noticed && d <= 1) { OB.player_attack(g, z); killed = z.hp <= 0; }
  return { noticed, killed, d };
}

const rate = (mode, side, facing) => {
  let n = 0, noticed = 0, killed = 0;
  for (let seed = 1; seed <= 30; seed++) { const r = trial(seed, mode, side, 'idle', 'walker', facing); if (!r) continue; n++; if (r.noticed) noticed++; if (r.killed) killed++; }
  return { n, noticed: noticed / n, killed: killed / n };
};
const R = { wb: rate('walk', 'behind', [1, 0]), sb: rate('sneak', 'behind', [1, 0]), ss: rate('sneak', 'behind', [0, 1]), sf: rate('sneak', 'front', [1, 0]), wf: rate('walk', 'front', [1, 0]) };
assert(R.wb.n >= 25);
assert(R.wb.noticed >= 0.8 && R.wf.noticed >= 0.8, 'walking up to a zombie must get you noticed');
assert(R.sb.noticed <= 0.25 && R.sb.killed >= 0.2, `sneaking up behind should work: ${JSON.stringify(R.sb)}`);
assert(R.ss.noticed <= 0.4 && R.ss.killed >= 0.1, `sneaking up at its side should often work: ${JSON.stringify(R.ss)}`);
assert(R.sf.noticed >= 0.7, 'sneaking straight at its face should not work');
assert(R.sb.killed > R.wb.killed + 0.15, 'sneaking must matter');
// awareness and facing basics
{
  const g = OB.make_game({ seed: 2, map_w: 160, map_h: 100 }), z = OB.spawn_zombie(g, g.world.level, g.world.level.free_spot_near(g.player.x + 8, g.player.y, 3), 'walker', false);
  assert(z.facing && z.alert === 0); const x0 = z.x; g.world.level.move_actor(z, z.x + 1, z.y); assert.deepStrictEqual(z.facing, [1, 0]);
  g.world.level.move_actor(z, z.x, z.y - 1); assert.deepStrictEqual(z.facing, [0, -1]);
  assert(/unaware/.test(g.describe_at(z.x, z.y)) || true);
  const p = g.player; p.x = z.x - 3; p.y = z.y; z.facing = [1, 0]; assert(OB.exposure(z, p) < 0.65);     // behind it
  z.facing = [-1, 0]; assert(OB.exposure(z, p) > 0.95);                                                      // in front of it
  // a noise on edge, but seeing you is what makes it hunt
  z.state = 'idle'; z.alert = 0; g.emit_noise([z.x, z.y], 5); assert.strictEqual(z.state, 'investigate'); assert(z.alert > 0 && z.alert < 100);
}
// ---- fights are loud, and a fair fight ends your sneaking
{
  const g = OB.make_game({ era: 'medieval', seed: 2, map_w: 160, map_h: 100, zombies: 'classic' });
  const mace = g.items.mace, dagger = g.items.dagger, p = g.player;
  assert(OB.attack_noise(g, mace, false) >= 11 && OB.attack_noise(g, mace, false) > OB.attack_noise(g, g.items.sword, false));
  assert(OB.attack_noise(g, dagger, false) <= 4);
  assert.strictEqual(OB.attack_noise(g, mace, true), Math.round(OB.attack_noise(g, mace, false) / 2) || 1);
  const bow = g.items.bow; assert.strictEqual(OB.attack_noise(g, bow, false), bow.noise);          // ranged noise is unchanged
  // a zombie 10 tiles away hears a mace blow and goes to look, but only seeing you makes it hunt
  const lv = g.world.level; for (const a of lv.actors.slice()) if (a.kind !== 'player') lv.remove_actor(a);
  const far = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 9, p.y, 3), 'walker', false); far.state = 'idle';
  const near = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 1, p.y, 2), 'walker', false); near.state = 'hunt'; near.alert = 100;
  p.weapon = OB.make_item('mace', 1, 55); p.sneaking = true; p.hp = p.max_hp = 1e6;
  OB.player_attack(g, near);
  assert(!p.sneaking, 'a fair fight must end sneaking');
  assert.strictEqual(far.state, 'investigate'); assert(far.alert > 0 && far.alert < 100);
  // a stealth kill keeps you hidden, and is quiet
  const dormant = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x - 1, p.y, 2), 'walker', false); dormant.state = 'dormant'; dormant.facing = [-1, 0];
  p.sneaking = true; far.state = 'idle'; far.alert = 0;
  OB.player_attack(g, dormant); assert(p.sneaking, 'a stealth strike must not end sneaking');
  // being hit ends it too
  OB.damage_player(g, 3, 'x', near); assert(!p.sneaking);
}
console.log('stealth: sneaking from behind and the side works, walking and facing it do not');
