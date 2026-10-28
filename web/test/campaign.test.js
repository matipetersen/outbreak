const assert = require('assert');
const { OB } = require('./helpers');

const mk = (cfg) => OB.cp_new(Object.assign({ seed: 3 }, cfg));
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const fakeBattle = (cs, victory, losses = 0) => ({ over: { victory }, kills: 5, saved: 0, squads: cs.op.cfg.company.map((q, i) => ({ side: 'you', cid: q.id, men: { length: Math.max(0, q.men - (i === 0 ? losses : 0)) } })) });

{ // the map of Zona Norte: links both ways, everything reachable, the factions where they belong
  const Z = OB.CP_ZONES;
  for (const [id, z] of Object.entries(Z)) {
    for (const n of z.adj) assert(Z[n] && Z[n].adj.includes(id), `${id} <-> ${n}`);
    assert.strictEqual(z.places.length, 4, `${id} has four places for battles`);
  }
  const seen = new Set(['florida']), todo = ['florida'];
  while (todo.length) for (const n of Z[todo.pop()].adj) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  assert.strictEqual(seen.size, Object.keys(Z).length, 'one connected map');
  const cs = mk({});
  assert.strictEqual(cs.zones.florida.owner, 'you'); assert.strictEqual(cs.zones.campomayo.owner, 'military');
  assert.strictEqual(cs.zones.sanisidro.owner, 'cult'); assert.strictEqual(cs.zones.martinez.owner, 'enclave');
  assert.deepStrictEqual(cs.company.map((q) => q.type), ['line', 'shield', 'line', 'scout']);
  assert(cs.company.every((q) => q.name.includes(q.call)), 'squads named for barrios');
}
{ // day one: clear what is next door, trade with the Unicenter, or rest; no faction borders you yet
  const cs = mk({});
  const kinds = OB.cp_ops(cs).map((o) => o.kind + ':' + (o.zone || ''));
  for (const k of ['clear:olivos', 'clear:munro', 'clear:martelli', 'trade:martinez', 'rest:']) assert(kinds.includes(k), k);
  assert(!kinds.some((k) => k.startsWith('assault')));
  assert(OB.cp_choose(cs, { kind: 'assault', zone: 'pilar' }).error, 'not next door');
}
{ // a battle: your company with its names and its men, the district's places; the outcome changes the map; the night comes
  const cs = mk({});
  cs.company[0].men = 4;
  const r = OB.cp_choose(cs, { kind: 'clear', zone: 'olivos' });
  assert(r.battle && r.battle.objective === 'take' && r.battle.rivals === 'none');
  const b = OB.bt_new(r.battle);
  const mine = b.squads.filter(OB.bt_mine);
  assert.strictEqual(mine.length, 4); assert.strictEqual(mine[0].men.length, 4, 'the men it has left'); assert.strictEqual(mine[0].name, cs.company[0].name);
  assert(b.bases.some((q) => q.name === 'Puerto de Olivos'), 'the places of Olivos');
  assert(OB.cp_ops(cs).length === 0, 'nothing else while the battle is on');
  const day = cs.day, sup = cs.supplies;
  OB.cp_finish_battle(cs, fakeBattle(cs, true, 2));
  assert.strictEqual(cs.zones.olivos.owner, 'you'); assert.strictEqual(cs.zones.olivos.dead, 0);
  assert.strictEqual(cs.company[0].men, 2, 'the dead stay dead');
  assert.strictEqual(cs.day, day + 1); assert(cs.supplies > sup, 'the spoils and the districts pay');
  // a lost clearing draws more of the dead
  const l = mk({}); const d0 = l.zones.munro.dead;
  OB.cp_choose(l, { kind: 'clear', zone: 'munro' }); OB.cp_finish_battle(l, fakeBattle(l, false));
  assert.strictEqual(l.zones.munro.owner, null); assert.strictEqual(l.zones.munro.dead, Math.min(3, d0 + 1));
  // a squad with nobody left is struck off
  const w = mk({}); OB.cp_choose(w, { kind: 'clear', zone: 'munro' }); OB.cp_finish_battle(w, fakeBattle(w, true, 99));
  assert.strictEqual(w.company.length, 3);
}
{ // refitting: recruits fill the gaps; a new squad costs recruits and supplies; machine guns need Campo de Mayo
  const cs = mk({});
  cs.company[0].men = 2; cs.recruits = 3;
  assert.strictEqual(OB.cp_refill(cs, cs.company[0].id), null);
  assert.strictEqual(cs.company[0].men, 5); assert.strictEqual(cs.recruits, 0);
  cs.recruits = 20; cs.supplies = 20;
  assert(/Campo de Mayo/.test(OB.cp_raise(cs, 'heavy')));
  cs.zones.campomayo.owner = 'you';
  assert.strictEqual(OB.cp_raise(cs, 'heavy'), null);
  assert.strictEqual(cs.company.length, 5); assert.strictEqual(cs.supplies, 20 - 8);
  assert(OB.cp_raise(cs, 'scout'), 'five squads at most');
}
{ // a threat: defend it (a battle), abandon it (at once), or leave it and lose it in the night
  const cs = mk({});
  cs.zones.munro.owner = 'you'; cs.threat = { zone: 'munro', by: 'raiders' };
  const kinds = OB.cp_ops(cs).map((o) => o.kind);
  assert(kinds.includes('defend') && kinds.includes('abandon'));
  const r = OB.cp_choose(cs, { kind: 'defend', zone: 'munro' });
  assert(r.battle.defend && r.battle.rivals === 'raiders' && r.battle.rival_squads >= 2);
  const b = OB.bt_new(r.battle);
  assert(b.bases.every((q) => q.owner === 'you'), 'you start holding the district');
  OB.cp_finish_battle(cs, fakeBattle(cs, false));
  assert.strictEqual(cs.zones.munro.owner, 'raiders', 'lost to them');
  assert(cs.truce.raiders >= cs.day, 'and they need a few days before they come again');
  const a = mk({}); a.zones.munro.owner = 'you'; a.threat = { zone: 'munro', by: 'dead' };
  OB.cp_choose(a, { kind: 'abandon', zone: 'munro' });
  assert(a.zones.munro.owner === null && a.zones.munro.dead === 3 && !a.threat && a.day === 1, 'abandoning is immediate and takes no day');
  const n = mk({}); n.zones.munro.owner = 'you'; n.threat = { zone: 'munro', by: 'military' };
  OB.cp_choose(n, { kind: 'rest' });
  assert.strictEqual(n.zones.munro.owner, 'military', 'nobody stood for it');
  const h = mk({}); h.threat = { zone: 'florida', by: 'dead' };
  assert(!OB.cp_ops(h).some((o) => o.kind === 'abandon'), 'Florida cannot be abandoned');
  const r2 = OB.cp_choose(h, { kind: 'defend', zone: 'florida' });
  assert(r2.battle.objective === 'hold' && r2.battle.refuge_name === 'Gimnasio de la escuela');
  h.supplies = 10; h.recruits = 6;
  OB.cp_finish_battle(h, fakeBattle(h, false));
  assert(!h.over && h.zones.florida.owner === 'you', 'losing a defence of Florida does not end it');
  assert(h.supplies <= 5 + 4 && h.zones.florida.dead === 1 && h.log.some((l) => /Florida/.test(l.text) && /mitad/.test(l.text)), 'but it is sacked and scarred');
  const g = mk({}); g.zones.florida.dead = 2; g.threat = { zone: 'florida', by: 'dead' };
  OB.cp_choose(g, { kind: 'defend', zone: 'florida' }); OB.cp_finish_battle(g, fakeBattle(g, false));
  assert(g.over && !g.over.victory && /Florida/.test(g.over.title), 'the third time the dead have it, and it is over');
}
{ // every encounter can be met with every choice, and each changes something
  for (const e of OB.CP_EVENTS) {
    for (let seed = 1; seed <= 6; seed++) {
      const cs = mk({ seed });
      for (const id of ['munro', 'boulogne', 'olivos']) cs.zones[id].owner = 'you';            // a frontier with everybody
      cs.zones.olivos.dead = 0; cs.zones.martelli.dead = 3;
      const d = e.when(cs);
      if (!d) continue;
      cs.event = { id: e.id, data: d };
      const view = OB.cp_event_view(cs);
      assert(view.text.length > 20 && view.choices.length >= 2, e.id);
      for (let i = 0; i < view.choices.length; i++) {
        const c = JSON.parse(JSON.stringify(cs));
        const what = OB.cp_decide(c, i);
        assert(typeof what === 'string' && what.length, `${e.id} choice ${i}`);
        assert(!c.event);
      }
    }
  }
  // the horde can be led into a rival's district, which may lose it
  const cs = mk({});
  cs.zones.munro.owner = 'you'; cs.zones.boulogne.dead = 2; cs.supplies = 5;
  cs.event = { id: 'horde', data: { zone: 'munro', from: 'boulogne', lure: 'pacheco' } };
  const v = OB.cp_event_view(cs), lure = v.choices.findIndex((c) => /Llevarla a/.test(c.label));
  OB.cp_decide(cs, lure);
  assert(cs.zones.pacheco.dead >= 2 && cs.supplies === 3);
}
{ // the night: districts pay, the dead spread, factions move; one of the two ways to win
  const cs = mk({});
  const s0 = cs.supplies, r0 = cs.recruits;
  OB.cp_choose(cs, { kind: 'rest' });
  assert(cs.supplies > s0 && cs.recruits >= r0 + 3);
  const w = mk({});
  for (const id of ['olivos', 'munro', 'martelli', 'martinez', 'boulogne', 'sanisidro', 'tigre']) w.zones[id].owner = 'you';
  OB.cp_choose(w, { kind: 'rest' });
  assert(w.over && w.over.victory && w.over.title === 'Zona Norte', 'eight districts');
}
{ // deterministic, and a save goes on as if it had not been saved
  const run = (cs) => { for (let i = 0; i < 6 && !cs.over; i++) { if (cs.event) OB.cp_decide(cs, 0); else OB.cp_choose(cs, { kind: 'rest' }); } return cs; };
  const a = run(mk({ seed: 9 })), b = run(mk({ seed: 9 }));
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  const st = memStore(); OB.cp_save(a, st); const c = OB.cp_load(st);
  run(a); run(c);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(c));
  assert(OB.cp_has_save(st) || a.over);
}
{ // every kind of operation makes a battle that can be fought to its end
  const cs = mk({});
  cs.zones.munro.owner = 'you'; cs.zones.olivos.survivors = 2;
  const cfgs = [OB.cp_battle_cfg(cs, { kind: 'clear', zone: 'olivos' }), OB.cp_battle_cfg(cs, { kind: 'assault', zone: 'boulogne', by: 'raiders' }),
    OB.cp_battle_cfg(cs, { kind: 'defend', zone: 'munro', by: 'dead' }), OB.cp_battle_cfg(cs, { kind: 'defend', zone: 'munro', by: 'cult' }), OB.cp_battle_cfg(cs, { kind: 'rescue', zone: 'olivos' })];
  for (const cfg of cfgs) { const b = OB.bt_new(cfg); for (let t = 0; t < 14 && !b.over; t++) OB.bt_run_turn(b); assert(b.over, cfg.op); }
}
{ // each district's battles are fought on its own drawn map: the river where it is, its four places as the buildings A to D
  for (const [id, z] of Object.entries(OB.CP_ZONES)) {
    const cs = mk({}); cs.zones[id].owner = null;
    for (const n of z.adj) cs.zones[n].owner = 'you';
    const cfg = OB.cp_battle_cfg(cs, { kind: 'clear', zone: id });
    assert(cfg.layout, `${id} has a map`);
    for (let seed = 1; seed <= 3; seed++) {
      const b = OB.bt_new(Object.assign({}, cfg, { seed }));
      assert.deepStrictEqual(b.bases.map((q) => q.name), z.places, `${id}: the places, in order`);
      for (const q of b.bases) assert(q.x1 >= q.x0 && q.y1 >= q.y0, `${id}: a room inside ${q.name}`);
      const north = []; for (let x = 0; x < b.w; x++) if (OB.bt_cost(b, x, 'z') !== Infinity) north.push(x);
      const fz = OB.bt_dijkstra(b, north, 'z');
      const south = OB.bt_idx(b, Math.floor(b.w / 2), b.h - 2), fh = OB.bt_dijkstra(b, [south], 'h');
      for (const q of b.bases) {
        assert(fz[OB.bt_idx(b, q.x0, q.y0)] < Infinity, `${id}: the dead can reach ${q.name}`);
        assert(fh[OB.bt_idx(b, q.x0, q.y0)] < Infinity, `${id}: your men can walk into ${q.name}`);
      }
      for (const s of b.squads) for (const m of OB.bt_squad_men(b, s)) assert(OB.bt_passable(b, m.x, m.y, 'h'), `${id}: nobody starts in the river`);
      if (z.layout.water) assert(b.tiles.includes(OB.BTILE.WATER), `${id}: the water is there`);
    }
    const ff = OB.bt_new(Object.assign({}, cfg, { objective: 'take', rivals: 'raiders', seed: 2 }));
    for (let t = 0; t < 14 && !ff.over; t++) OB.bt_run_turn(ff);
    assert(ff.over, `${id}: a fight there comes to an end`);
  }
  const cs = mk({}); const b = OB.bt_new(OB.cp_battle_cfg(cs, { kind: 'clear', zone: 'olivos' }));
  assert.strictEqual(b.squads.find(OB.bt_mine).type_name, 'Fusileros', 'the squads keep their campaign names');
}
{ // the pressure from the first night: a horde for Florida, battles cost supplies, the empty districts get worse
  const cs = mk({});
  assert.strictEqual(cs.supplies, 6); assert(cs.zones.martelli.dead === 2 && cs.zones.tigre.dead === 3 && cs.zones.escobar.dead === 3, 'next door as before, the rest worse');
  OB.cp_choose(cs, { kind: 'rest' });
  assert(cs.threat && cs.threat.zone === 'florida' && cs.threat.by === 'dead', 'the first night, a horde comes for Florida');
  if (cs.event) { cs.event = null; cs.threat = { zone: 'florida', by: 'dead' }; }
  const s0 = cs.supplies; assert(OB.cp_choose(cs, { kind: 'defend', zone: 'florida' }).battle);
  assert.strictEqual(cs.supplies, s0 - 2, 'a battle costs two supplies');
  OB.cp_finish_battle(cs, fakeBattle(cs, true));
  const poor = mk({}); poor.supplies = 0;
  const r = OB.cp_choose(poor, { kind: 'clear', zone: 'olivos' });
  assert(r.battle.company.every((q) => q.ammo > 0) && OB.bt_new(r.battle).squads.find(OB.bt_mine).ammo < OB.bt_type_stats('modern', 'line').ammo, 'without supplies, half the ammunition');
  const e = mk({ difficulty: 'easy' });
  assert.strictEqual(e.supplies, 10); assert.strictEqual(OB.CP_DIFF.easy.cost, 0, 'easy is the gentler first version');
  const esc = mk({}); esc.zones.escobar.dead = 1;
  for (let i = 0; i < 4 && !esc.over; i++) { if (esc.event) OB.cp_decide(esc, 0); esc.threat = null; OB.cp_choose(esc, { kind: 'rest' }); }
  assert(esc.log.some((l) => /El brote empeora/.test(l.text)), 'the outbreak gets worse every few days');
}
{ // restocking in a campaign battle: never by itself, your call, one supply, inside a base you hold, once a turn
  const cs = mk({}); cs.supplies = 7;
  const r = OB.cp_choose(cs, { kind: 'clear', zone: 'olivos' });
  assert(r.battle.paid_restock && r.battle.supplies === 5, 'the battle carries what is left after the day\'s cost');
  const b = OB.bt_new(r.battle); b.zeds.length = 0; b.wave.count = 0;
  const s = b.squads.find(OB.bt_mine), q = b.bases[0];
  q.owner = 'you'; s.ammo = 10;
  assert.strictEqual(OB.bt_restock_block(b, s), 'away', 'not out in the street');
  s.anchor = [(q.x0 + q.x1 + 1) / 2, (q.y0 + q.y1 + 1) / 2];
  for (const m of OB.bt_squad_men(b, s)) { m.x = s.anchor[0]; m.y = s.anchor[1]; }
  assert.strictEqual(OB.bt_restock(b, s.id), null);
  assert(s.ammo > 10 && b.spent === 1, 'half the ammunition for one supply');
  assert.strictEqual(OB.bt_restock(b, s.id), 'done', 'once a turn');
  const before = s.ammo; s.path = [];
  OB.bt_run_turn(b);
  assert(s.ammo <= before, 'nothing restocks by itself at the end of the turn');
  b.cfg.supplies = 1; assert.strictEqual(OB.bt_restock_block(b, s), 'poor', 'not with nothing left');
  b.over = { victory: true }; const sup = cs.supplies;
  OB.cp_finish_battle(cs, b);
  assert(cs.log.some((l) => /reabastecer/.test(l.text)) && cs.supplies < sup + 2 + 10, 'the campaign pays for it');
  const free = OB.bt_new({ objective: 'take', seed: 3 });
  assert.strictEqual(OB.bt_restock_block(free, free.squads[0]), 'none', 'outside the campaign it stays automatic');
}
console.log('campaign tests passed');
