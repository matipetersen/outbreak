const assert = require('assert');
const { OB, make, quiet, teleport } = require('./helpers');

// an open patch of grass with a wild horse next to you
function field(cfg = {}) {
  const g = quiet(make(Object.assign({ seed: 3 }, cfg))); g.player.hp = g.player.max_hp = 1e6; g.ring = null;
  const lv = g.world.level, p = g.player;
  let spot = null; const [sx, sy] = g.world.start;                         // painted ground only: the rest of the map is not drawn yet
  for (let y = sy - 40; y < sy + 40 && !spot; y++) for (let x = sx - 40; x < sx + 14 && !spot; x++) {
    let ok = true; for (let i = 0; i < 26 && ok; i++) for (let j = -1; j <= 1 && ok; j++) ok = lv.free(x + i, y + j) && lv.tile(x + i, y + j) !== OB.T.PORTAL;
    if (ok) spot = [x, y];
  }
  lv.occ.delete(lv.idx(p.x, p.y)); p.x = spot[0]; p.y = spot[1]; lv.occ.set(lv.idx(p.x, p.y), p); g.update_fov();
  quiet(g);
  const h = OB.mount_make(g, p.x + 1, p.y); lv.add_actor(h);
  return [g, h];
}
const tame = (g, h) => { for (let i = 0; i < 40 && !h.mount; i++) { g.give_item(OB.make_item('forage', 1)); g.player.sneaking = true; h.state = 'graze'; h.alert = false; if (!g.world.level.actors.includes(h)) break; const lv = g.world.level; if (OB.cheb(OB.apos(h), OB.apos(g.player)) > 1) lv.move_actor(h, ...lv.free_spot_near(g.player.x + 1, g.player.y, 2)); OB.mount_tame(g, h); } g.player.sneaking = false; return h.mount; };

{ // herds graze on open ground, away from the start, in every era
  let horses = 0;
  for (const era of Object.keys(OB.CONTENT.eras)) {
    const g = make({ era, seed: 5 }); OB.generate_all(g);
    const hs = g.world.level.actors.filter((a) => a.kind === 'animal' && a.species === 'horse');
    for (const h of hs) assert(OB.cheb(OB.apos(h), g.world.start) >= 23);
    horses += hs.length;
    if (era === 'scifi' && hs.length) assert.strictEqual(hs[0].name, 'Strider');
  }
  assert(horses >= 8, `only ${horses} horses in four worlds`);
}
{ // wild: it bolts if you walk up; food wins it over; bumping into it does not attack it
  const [g, h] = field(); const hp = h.hp;
  assert(!g.move(1, 0) && h.hp === hp, 'walking into a wild horse does not hit it');
  assert(/something to eat/.test(OB.mount_tame(g, h)));
  assert(tame(g, h)); assert.strictEqual(g.mount_uid, h.uid); assert(OB.mount_current(g) === h);
  assert(/You already have/.test(OB.mount_tame(g, OB.mount_make(g, 1, 1))));
}
{ // riding: needs a saddle; two tiles a turn, three at a gallop, no stamina, and loud
  const [g, h] = field(); tame(g, h);
  assert(/saddle/.test(OB.mount_can_ride(g, h)));
  g.give_item(OB.make_item('cloth', 3)); g.give_item(OB.make_item('wood', 1)); g.give_item(OB.make_item('scrap', 1)); assert(g.craft('saddle'));
  assert(g.ride(h)); assert(g.riding === h && !g.world.level.actors.includes(h));
  const p = g.player, sta = p.stamina = 50, t0 = g.clock.turn;
  for (let i = 0; i < 10; i++) assert(g.move(1, 0));
  assert(g.clock.turn - t0 <= 6, `ten steps took ${g.clock.turn - t0} turns`); assert(p.stamina >= sta, 'riding costs no stamina');
  g.toggle_sprint(); const t1 = g.clock.turn; for (let i = 0; i < 9; i++) g.move(-1, 0); assert(g.clock.turn - t1 <= 4, 'a gallop is faster');
  g.toggle_sneak(); assert(!p.sneaking, 'no creeping on horseback');
  g.dismount(); assert(!g.riding && g.world.level.actors.includes(h) && OB.cheb(OB.apos(h), OB.apos(p)) <= 3);
}
{ // a door: you leave it outside
  const g = quiet(make({ seed: 3 })), lv = g.world.level, p = g.player; p.hp = p.max_hp = 1e6;
  const poi = Object.values(g.pois).find((q) => q.kind === 'house'); OB.gen_near(g, poi.x, poi.y);
  teleport(g, 'world', lv.free_spot_near(poi.x, poi.y + 1, 2));
  const h = OB.mount_make(g, ...lv.free_spot_near(p.x, p.y, 2)); lv.add_actor(h); h.mount = true; g.mount_uid = h.uid; g.give_item(OB.make_item('saddle', 1));
  assert(g.ride(h)); g._use_portal(poi.x, poi.y);
  assert(g.level !== lv && !g.riding && lv.actors.includes(h) && h.state === 'wait');
}
{ // blows meant for the rider land on the horse; badly hurt it throws you; killed, it drops you and its meat
  const [g, h] = field(); tame(g, h); g.give_item(OB.make_item('saddle', 1)); g.ride(h);
  const lv = g.level, p = g.player, z = OB.spawn_zombie(g, lv, lv.free_spot_near(p.x + 2, p.y, 2), 'walker', false); z.acc = 1000;
  let took = 0; for (let i = 0; i < 40 && g.riding; i++) { const hp = h.hp; OB.zombie_attack(g, z); if (h.hp < hp) took++; p.infected = false; }
  assert(took > 0);
  const [k, m] = field(); tame(k, m); k.give_item(OB.make_item('saddle', 1)); k.ride(m); m.hp = 1;
  let gone = false; for (let i = 0; i < 40 && !gone; i++) { gone = OB.mount_take_hit(k, 5) && !k.riding; }
  assert(gone && !k.mount_uid && k.fallen_allies.some((f) => f[0] === m.name));
  const [b, n] = field(); tame(b, n); b.give_item(OB.make_item('saddle', 1)); b.ride(n); n.hp = 10; OB.mount_bolt(b);
  assert(!b.riding && b.world.level.actors.includes(n) && b.mount_uid === n.uid, 'it bolts but is still yours');
}
{ // saves keep you in the saddle; in hardcore your death leaves the horse behind
  const [g, h] = field(); tame(g, h); g.give_item(OB.make_item('saddle', 1)); g.ride(h);
  const s = OB.deserialize_game(OB.serialize_game(g)); assert(s.riding && s.riding.name === h.name && s.mount_uid === h.uid);
  const [l, m] = field({ mode: 'living' }); tame(l, m); l.give_item(OB.make_item('saddle', 1)); l.ride(m);
  l.player.hp = 1; OB.damage_player(l, 99, 'killed by a test');
  assert(!l.riding && l.generation === 2);
}
console.log('mounts: wild horses graze, can be tamed with food, ridden with a saddle, and left outside');
