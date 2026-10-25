const assert = require('assert');
const { OB, make, quiet, teleport, empty_level } = require('./helpers');

// a world where every bite infects, past the opening grace, with one companion next to you
function setup(cfg = {}) {
  const g = quiet(make(Object.assign({ seed: 3 }, cfg))); g.ring = null; g.clock.turn = 600;
  g.profile = Object.assign({}, g.profile, { infect: 1.0, incubation: 120 });
  const p = g.player, lv = g.level; p.hp = p.max_hp = 1e6;
  const c = OB.comp_stranger(g, lv.free_spot_near(p.x + 1, p.y, 2)); lv.add_actor(c); OB.comp_recruit(g, c, 'veteran', 40);
  c.hp = c.max_hp = 1e6;
  const z = OB.spawn_zombie(g, lv, lv.free_spot_near(c.x + 1, c.y, 3), 'walker', false); z.acc = 1000;
  return [g, c, z];
}
const bite = (g, z, h) => { for (let i = 0; i < 30 && !h.infected; i++) OB.attack_actor(g, z, h); };

{ // a bite infects your companion; the fever runs out and they get up as one of the dead
  const [g, c, z] = setup(); bite(g, z, c);
  assert(c.infected && c.infection_timer > 0 && ['arm', 'leg', 'torso'].includes(c.bite_limb));
  assert(g.log.some((m) => m[1].includes('has been bitten')));
  g.level.remove_actor(z); const name = c.name;
  for (let i = 0; i < 200 && OB.comp_current(g); i++) OB.contagion_tick(g);
  assert(!OB.comp_current(g), 'they turned'); const turned = g.level.actors.find((a) => a.kind === 'zombie' && a.name.includes(name));
  assert(turned && turned.state === 'hunt'); assert(g.fallen_allies.some((f) => f[0] === name && /turned/.test(f[1])));
}
{ // the opening still goes easy on your people: no infection under the grace
  const [g, c, z] = setup(); g.clock.turn = 10; bite(g, z, c); assert(!c.infected);
}
{ // a limb in time, with a blade; a suppressant buys time; or let them go before it happens
  const [g, c, z] = setup(); bite(g, z, c);
  g.level.remove_actor(z); c.bite_limb = 'arm'; c.bite_window = 10; const hp = c.max_hp;
  assert(/blade/.test(OB.npc_cut(g, c)));
  g.player.weapon = OB.make_item('shiv', 1, 30);
  OB.npc_cut(g, c); assert(!c.infected && c.max_hp < hp && OB.comp_current(g) === c);
  const [h, d, y] = setup(); bite(h, y, d); const t = d.infection_timer;
  h.give_item(OB.make_item('suppressant', 1)); OB.npc_suppress(h, d); assert(d.infection_timer > t + 100);
  const [m, e, w] = setup(); bite(m, w, e); m.level.remove_actor(w); const n = e.name;
  OB.npc_mercy(m, e); assert(!OB.comp_current(m) && !m.level.actors.some((a) => a.kind === 'zombie' && a.name.includes(n)));
  assert(m.fallen_allies.some((f) => f[0] === n && /let go/.test(f[1])));
}
{ // anyone can be bitten: a soldier turns where they stand; an outpost guard who dies is one fewer
  const [g, , z] = setup(); const lv = g.level, p = g.player;
  const s = OB.make_patrol(g, 'soldier', ...lv.free_spot_near(z.x, z.y + 1, 3), 99); lv.add_actor(s); s.hp = s.max_hp = 1e6;
  bite(g, z, s); assert(s.infected); lv.remove_actor(z);
  for (let i = 0; i < 200 && lv.actors.includes(s); i++) OB.contagion_tick(g);
  assert(!lv.actors.includes(s) && lv.actors.some((a) => a.kind === 'zombie' && /Turned soldier/i.test(a.name)));
  assert(p);
  const e = quiet(make({ scenario: 'endless', seed: 3 })), o = Object.values(e.saga.outposts).find((x) => x.owner === 'military');
  const ol = e.ensure_level(o.id + ':0'); teleport(e, ol.id); OB.outpost_sync(e, ol);
  const guard = ol.actors.find((a) => a.outpost === o.id && a.role !== 'warden'), before = o.garrison;
  const zz = OB.spawn_zombie(e, ol, ol.free_spot_near(guard.x, guard.y, 2), 'walker', false); guard.hp = 1; zz.acc = 1000;
  for (let i = 0; i < 20 && ol.actors.includes(guard); i++) OB.attack_actor(e, zz, guard);
  assert(!ol.actors.includes(guard) && o.garrison === before - 1);
}
{ // at the base: bitten in a raid, a fever the next morning, turned the morning after, unless you act in time
  const g = quiet(make({ scenario: 'endless', seed: 3 })), poi = Object.values(g.pois).find((q) => q.kind === 'market' && !OB.outpost_of(g, q.id) && !q.component);
  const lv = teleport(g, poi.id + ':0'); empty_level(lv); g.claim_base();
  for (let k = 0, n = 0; k < lv.w * lv.h && n < 2; k++) if (lv.tiles[k] === OB.T.FLOOR && !lv.occ.has(k)) { lv.tiles[k] = OB.T.BED; lv.built[k] = 'cot'; n++; }
  lv.stash.push(OB.make_item('food', 20));
  const a = OB.saga_add_resident(g, null), b = OB.saga_add_resident(g, null);
  g.clock.turn = 240 * 5 + 60; OB.resident_bitten(g, a); OB.resident_bitten(g, b);
  assert(/You need a blade/.test(OB.resident_cut(g, a))); g.player.weapon = OB.make_item('shiv', 1, 30); OB.resident_cut(g, a); assert(!a.bitten);
  g.clock.turn += 240; OB.saga_morning(g); assert(g.saga.residents.includes(b) && g.log.some((m) => /has a fever/.test(m[1])));
  assert(/Too late/.test(OB.resident_cut(g, b)));
  g.clock.turn += 240; OB.saga_morning(g); assert(!g.saga.residents.includes(b)); assert(g.fallen_allies.some((f) => f[0] === b.name && /turned/.test(f[1])));
}
{ // a bitten companion keeps the bite in a save
  const [g, c, z] = setup(); bite(g, z, c);
  const h = OB.deserialize_game(OB.serialize_game(g)); const c2 = OB.comp_current(h); assert(c2 && c2.infected && c2.infection_timer === c.infection_timer);
}
console.log('contagion: the living around you can be bitten, turn, be saved in time, or be let go');
