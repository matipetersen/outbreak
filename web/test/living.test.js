const assert = require('assert');
const { OB, make } = require('./helpers');

const living = (cfg) => make(Object.assign({ mode: 'living', seed: 3 }, cfg));
function clear(g) { const lv = g.world.level; for (const a of lv.actors.slice()) if (a.kind !== 'player') lv.remove_actor(a); g.hordes.length = 0; return lv; }

// normal mode still ends on death
{ const g = make({ seed: 3 }); g.player.hp = 0; g.end('dead', 'x'); assert(g.over); }

// death replaces the player; the world continues
{
  const g = living(), lv = clear(g), p0 = g.player;
  p0.gain_xp(200);
  const old_level = p0.level, old_pos = [p0.x, p0.y], ids = p0.inventory.map((i) => i.id), turn = g.clock.turn;
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(old_pos[0] + 1, old_pos[1], 3), 'walker', false);
  p0.hp = 1;
  OB.damage_player(g, 5, 'torn apart', z);
  assert(!g.over); assert.strictEqual(g.generation, 2); assert.strictEqual(g.fallen.length, 1); assert.strictEqual(g.clock.turn, turn);
  assert.strictEqual(g.player.level, Math.max(1, Math.floor(old_level / 2))); assert(g.player.hp > 0); assert(g.death_notice);
  const refuge = g.pois[g.refuge_id];
  assert(Math.abs(g.player.x - refuge.x) + Math.abs(g.player.y - refuge.y) < 20);
  const k = lv.idx(old_pos[0], old_pos[1]);
  assert(lv.items[k] && ids.every((id) => lv.items[k].some((i) => i.id === id)));
  assert.strictEqual(lv.corpses[k][1], 2);
  // killer leveled, named, still there
  assert(z.lvl >= 1); assert(z.title.startsWith('Killer of')); assert(lv.actors.includes(z));
}
// killer levels on a late day
{
  const g = living(), lv = clear(g);
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(g.player.x + 1, g.player.y, 3), 'walker', false);
  g.clock.turn = 10 * 240; const hp0 = z.max_hp;
  g.player.hp = 1; OB.damage_player(g, 9, 'x', z);
  assert(z.lvl > 1); assert(z.max_hp > hp0); assert(z.name.includes('Lv'));
}
// fallen body rises named and leveled
{
  const g = living(), lv = clear(g);
  g.player.gain_xp(400);
  const pos = [g.player.x, g.player.y];
  g.player.hp = 0; g.end('dead', 'bled out');
  g.clock.turn += 60; g._rising_dead();
  const f = lv.actors.filter((a) => a.kind === 'zombie' && a.x === pos[0] && a.y === pos[1]);
  assert.strictEqual(f.length, 1); assert(f[0].name.startsWith('Fallen ')); assert(f[0].lvl >= 2);
}
// enemies level by killing, capped by the calendar; not in normal mode
{
  const g = living(), lv = clear(g), r = OB.make_raider(g, 0, 0), sp = lv.free_spot_near(g.player.x + 10, g.player.y + 10, 4);
  lv.add_actor(r); lv.move_actor(r, sp[0], sp[1]);
  for (let i = 0; i < 40; i++) OB.grant_xp(g, r, 30);
  assert.strictEqual(r.lvl, OB.level_cap(g)); assert(r.lvl <= 3);
  g.clock.turn = 6 * 240; OB.grant_xp(g, r, 500); assert(r.lvl > 3);
  const n = make({ seed: 3 }), nl = clear(n), nr = OB.make_raider(n, 0, 0); nl.add_actor(nr); OB.grant_xp(n, nr, 500);
  assert.strictEqual(nr.lvl || 1, 1);
}
// cure is for the world
{
  const g = living({ scenario: 'cure' });
  assert(!g.player.infected); assert(g.intro_pages[3][1].includes('one of many'));
  assert(make({ scenario: 'cure', seed: 3 }).player.infected);
}
// turning is a death too
{
  const g = living(); g.player.infected = true; g.player.infection_timer = 1; g._spend(2);
  assert.strictEqual(g.generation, 2); assert(!g.player.infected);
}
// world state persists, knowledge halves
{
  const g = living(); g.know.learn_random(g.rng, 10); const known = g.know.known.size;
  const poi = Object.values(g.pois)[0]; poi.lead = true;
  g.player.hp = 0; g.end('dead', 'x');
  assert(poi.lead); assert(g.know.known.size <= known + 6 && g.know.known.size >= Math.floor(known / 2));   // a new origin may teach a few words
}
// a big horde keeps its zombies
{
  const g = living({ zombies: 'swarm' }), lv = clear(g), p = g.player;
  const h = OB.spawn_horde(g, lv.free_spot_near(p.x + 8, p.y + 8, 4), 60, [p.x, p.y]);
  for (let i = 0; i < 8; i++) { if (g.hordes.includes(h) && g.clock.turn >= (h.wait_until || 0)) OB.materialize(g, h); g.clock.turn += 13; }
  const zs = lv.actors.filter((a) => a.kind === 'zombie').length, left = g.hordes.reduce((s, x) => s + x.size, 0);
  assert(zs + left >= 55, `lost zombies: ${zs} + ${left}`);
}
// death inside a building respawns outside
{
  const g = living(), poi = Object.values(g.pois).find((q) => !['breach', 'refuge', 'pad', 'house'].includes(q.kind));
  const { teleport } = require('./helpers'); teleport(g, `${poi.id}:0`);
  g.player.hp = 0; g.end('dead', 'x');
  assert.strictEqual(g.level, g.world.level);
  assert.strictEqual(g.level.occ.get(g.level.idx(g.player.x, g.player.y)), g.player);
}
// save round trip in living mode
{
  const g = living(); g.player.hp = 0; g.end('dead', 'x');
  const g2 = OB.deserialize_game(OB.serialize_game(g));
  assert.strictEqual(g2.generation, 2); assert.strictEqual(g2.fallen.length, 1); assert.strictEqual(g2.cfg.mode, 'living');
  assert(Object.keys(g2.fallen_bodies).length === 1);
  g2._spend(30);
}
// long bot run in living mode, many lives, no crash, every era
{
  for (const era of Object.keys(OB.CONTENT.eras)) {
    const g = living({ era, zombies: 'rage', seed: 11 }), rng = new OB.RNG(7);
    for (let i = 0; i < 4000 && !g.over; i++) {
      if (g.pending_event) { g.resolve_event(0); g.pending_event = null; continue; }
      const p = g.player, near = g.visible_hostiles().filter((a) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 1);
      if (near.length) g.attack(near[0]); else g.move(...rng.choice(OB.DIRS8));
      g.death_notice = '';
    }
    assert(g.player.hp > 0 || g.over);
  }
}
console.log('living: lives, levels and persistence OK');
