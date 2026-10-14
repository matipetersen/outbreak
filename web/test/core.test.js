const assert = require('assert');
const { OB, make, empty_level, teleport, quiet } = require('./helpers');

// ---- a tiny random-ish bot that exercises most actions
function bot_step(g, rng) {
  const p = g.player;
  if (g.over) return;
  if (g.pending_event) { g.resolve_event(rng.randint(0, g.pending_event ? OB.EVENT_BY_ID[g.pending_event.event_id].choices.length - 1 : 0)); g.pending_event = null; return; }
  const hostile = g.visible_hostiles();
  const near = hostile.filter((a) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 1);
  if (near.length) { g.attack(near[0]); return; }
  const r = rng.random();
  if (r < 0.05) { g.pickup(); return; }
  if (r < 0.08) { g.interact(); return; }
  if (r < 0.10 && p.inventory.length) { g.use(rng.randint(0, p.inventory.length - 1)); return; }
  if (r < 0.12) { g.rest(3); return; }
  if (r < 0.13 && p.documents.length) { g.read_document(p.documents[0]); return; }
  const [dx, dy] = rng.choice(OB.DIRS8);
  g.move(dx, dy);
}

// ---- smoke: every era x preset x scenario
let combos = 0;
for (const era of Object.keys(OB.CONTENT.eras)) for (const z of Object.keys(OB.CONTENT.presets)) for (const sc of Object.keys(OB.CONTENT.scenarios)) {
  const g = make({ era, zombies: z, scenario: sc, seed: (era.length * 7 + z.length) % 50 });
  const rng = new OB.RNG(5);
  for (let i = 0; i < 250 && !g.over; i++) bot_step(g, rng);
  combos++;
}
console.log(`smoke: ${combos} combinations ran`);

// ---- origins and difficulties
for (const origin of Object.keys(OB.CONTENT.origins)) for (const diff of ['easy', 'normal', 'hard']) {
  const g = make({ origin, difficulty: diff, needs: true });
  g.wait(5);
  assert(g.player.hp > 0);
}

// ---- determinism and save/load
{
  const run = () => { const g = make({ era: 'scifi', zombies: 'spore', seed: 21 }); const rng = new OB.RNG(4); for (let i = 0; i < 300 && !g.over; i++) bot_step(g, rng); return g; };
  const a = run(), b = run();
  assert.deepStrictEqual([a.clock.turn, a.player.x, a.player.y, a.player.hp], [b.clock.turn, b.player.x, b.player.y, b.player.hp]);
  assert.deepStrictEqual(a.log.slice(-6), b.log.slice(-6));
}
{
  const g = make({ era: 'medieval', zombies: 'rot', seed: 11 });
  const rng1 = new OB.RNG(1);
  for (let i = 0; i < 200 && !g.over; i++) bot_step(g, rng1);
  const json = OB.serialize_game(g);
  const h = OB.deserialize_game(json);
  assert.strictEqual(h.clock.turn, g.clock.turn);
  assert.deepStrictEqual([h.player.x, h.player.y], [g.player.x, g.player.y]);
  const ra = new OB.RNG(2), rb = new OB.RNG(2);
  for (let i = 0; i < 80; i++) { bot_step(g, ra); bot_step(h, rb); }
  assert.strictEqual(h.clock.turn, g.clock.turn);
  assert.deepStrictEqual([h.player.x, h.player.y, h.player.hp], [g.player.x, g.player.y, g.player.hp]);
  assert.deepStrictEqual(h.log.slice(-5), g.log.slice(-5));
  // storage round trip
  const store = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
  OB.save_game(g, store);
  assert(OB.has_save(store));
  assert.strictEqual(OB.load_game(store).clock.turn, g.clock.turn);
  assert.throws(() => OB.deserialize_game('{"v":99}'));
  console.log(`save: ${(json.length / 1024).toFixed(0)} KiB JSON, round trip identical`);
}

// ---- rules
const nz = (g, special = 'walker', dx = 1, dy = 0, state = 'hunt') => {
  const z = OB.make_zombie(g, special, g.player.x + dx, g.player.y + dy);
  g.level.add_actor(z); z.state = state; return z;
};
{
  const g = quiet(make({ zombies: 'classic' }));
  const body = OB.hurt_zombie(g, nz(g), 6, false), head = OB.hurt_zombie(g, nz(g, 'walker', 0, 1), 6, true);
  assert(body < head && head === 18, 'classic: heads matter');
  const r = quiet(make({ zombies: 'rage' }));
  assert.strictEqual(OB.hurt_zombie(r, nz(r), 6, false), 6);
  const n = quiet(make({ zombies: 'night' }));
  const plain = OB.hurt_zombie(n, nz(n), 5, false), fire = OB.hurt_zombie(n, nz(n, 'walker', 0, 1), 5, false, '', true);
  assert.strictEqual(fire, plain * 2);
}
{
  const g = quiet(make({ zombies: 'classic' }));
  g.player.weapon = OB.make_item('knife', 1, 40);
  const z = nz(g, 'walker', 1, 0, 'dormant'); z.hp = 6;
  OB.player_attack(g, z);
  assert(!g.level.actors.includes(z), 'sneak attack kills the unaware before noise wakes it');
}
{
  const g = quiet(make({ zombies: 'classic' }));
  g.player.weapon = OB.make_item('machete', 1, 50);
  OB.infect(g);
  g.player.bite_limb = 'arm'; g.player.bite_window = 20;
  assert.strictEqual(OB.can_amputate(g), null);
  const hp0 = g.player.hp, max0 = g.player.max_hp;
  assert(OB.amputate(g)); assert(!g.player.infected); assert.deepStrictEqual(g.player.lost, ['arm']);
  assert(hp0 - g.player.hp > 18, 'cutting off a limb must hurt a lot'); assert.strictEqual(g.player.max_hp, max0 - 10); assert(g.player.hemorrhage);
  OB.infect(g); g.player.bite_limb = 'arm'; g.player.bite_window = 20;
  assert(/already gone/.test(OB.can_amputate(g)));
  g.player.bite_limb = 'torso'; g.player.bite_window = 0;
  assert(OB.can_amputate(g));
}
// a fresh stump bleeds until bound; the second limb is far worse and can kill
{
  const g = quiet(make({ zombies: 'classic' })), p = g.player;
  p.weapon = OB.make_item('machete', 1, 50);
  OB.infect(g); p.bite_limb = 'leg'; p.bite_window = 20; OB.amputate(g);
  assert.strictEqual(p.bleeding, 3);
  for (let i = 0; i < 300 && p.hp > 5; i++) { g.clock.turn += 1; g._player_conditions(); }
  assert(p.bleeding >= 3, 'a stump must not stop bleeding on its own');
  p.hp = p.max_hp; p.inventory.push(OB.make_item('bandage', 1)); g.use(p.inventory.length - 1);
  assert.strictEqual(p.bleeding, 1); assert(p.hemorrhage);
  p.inventory.push(OB.make_item('bandage', 1)); g.use(p.inventory.length - 1);
  assert.strictEqual(p.bleeding, 0); assert(!p.hemorrhage);
  g.toggle_sprint(); assert(!p.sprinting); assert(p.evade < 0);
}
{
  const g = quiet(make({ zombies: 'classic' })), p = g.player;
  p.weapon = OB.make_item('machete', 1, 50);
  OB.infect(g); p.bite_limb = 'arm'; p.bite_window = 20; OB.amputate(g);
  assert.strictEqual(p.capacity, 18);
  p.hp = 30; OB.infect(g); p.bite_limb = 'leg'; p.bite_window = 20;
  assert(OB.amputation_shock(g) > 40);
  OB.amputate(g); assert(g.over, 'a second amputation at 30 hp must kill');
}
{
  const g = quiet(make({ zombies: 'rage', scenario: 'extraction' }));
  OB.infect(g);
  const fuse = g.player.infection_timer + 2;
  for (let i = 0; i < fuse && !g.over; i++) g.wait(1);
  assert.strictEqual(g.over.kind, 'turned');
}
{
  const g = quiet(make({ scenario: 'cure' })); const p = g.player;
  p.inventory.push(OB.make_item('suppressant', 1)); const t = p.infection_timer;
  g.use(p.inventory.length - 1);
  assert(p.infection_timer >= t + 290);
  assert(make({ scenario: 'cure' }).player.infected && !make({ scenario: 'extraction' }).player.infected);
}
{
  const g = quiet(make({ zombies: 'classic' }));
  const near = nz(g, 'walker', 5, 0, 'dormant'), far = nz(g, 'walker', 30, 0, 'dormant');
  g.emit_noise([g.player.x, g.player.y], 10);
  assert.strictEqual(near.state, 'investigate'); assert.strictEqual(far.state, 'dormant');
  const h = quiet(make()); h.emit_noise([h.player.x, h.player.y], 3); assert.strictEqual(h.heat, 0);
  h.emit_noise([h.player.x, h.player.y], 24); assert(h.heat > 0);
  h.stalker_ready = 0; h.heat = 100; h.wait(1);
  assert(h.stalker && h.stalker.special === 'stalker');
}
{
  const g = quiet(make()); g.player.bleeding = 3; g.player.hp = 5;
  for (let i = 0; i < 20; i++) g.wait(1);
  assert(g.over);
  const b = quiet(make()); b.player.bleeding = 2; b.player.inventory.push(OB.make_item('bandage', 1));
  b.use(b.player.inventory.length - 1); assert.strictEqual(b.player.bleeding, 0);
  const x = quiet(make({ zombies: 'night' })); x.clock.turn = 120;
  const z = nz(x, 'walker', 10, 0, 'idle'); z.hp = z.max_hp = 4; x.wait(4);
  assert(!x.level.actors.includes(z), 'nightstalkers burn');
}
{ // key items never lost to a full pack
  const g = quiet(make({ scenario: 'cure' }));
  for (let i = 0; i < 40; i++) g.player.inventory.push(OB.make_item('scrap', 1, null, false) && { id: 'wood' + i, qty: 1, dur: null, key: false });
  const comp = g.scenario.requirements[0].id;
  g.give_item(OB.make_item(comp, 1));
  assert.strictEqual(g.player.count(comp), 1);
}
{ // endings differ by humanity; deadline
  const titles = new Set();
  for (const h of [90, 55, 25, 3]) { const g = quiet(make({ scenario: 'cure', seed: 2 })); g.player.humanity = h; g.end('won'); titles.add(g.over.title); }
  assert.strictEqual(titles.size, 4);
  const g = quiet(make({ scenario: 'extraction' })); g.clock.turn = g.deadline_days * 240 + 238; g.wait(5);
  assert.strictEqual(g.over.kind, 'left_behind');
}
{ // every event choice resolves
  for (const ev of OB.EVENTS) ev.choices.forEach((c, i) => {
    const g = quiet(make({ seed: 2 })); g.player.inventory.push(OB.make_item('food', 3), OB.make_item('bandage', 3)); g.player.coins = 50;
    g.pending_event = OB.start_event(g, ev); g.resolve_event(i); g.wait(2);
  });
}
{ // haven services
  const g = quiet(make({ seed: 2 }));
  const lv = g.ensure_level(g.pois[g.refuge_id].id + ':0'); teleport(g, lv.id);
  assert.deepStrictEqual(lv.actors.map((a) => a.role).sort(), ['healer', 'scholar', 'trader']);
  g.player.coins = 100; g.player.hp = 5;
  assert(/patches/.test(OB.heal_service(g))); assert.strictEqual(g.player.hp, g.player.max_hp);
  const known = g.know.known.size; OB.teach(g); assert(g.know.known.size > known);
  assert(/Bought/.test(OB.buy(g, OB.stock(g)[0][0])));
  g.player.humanity = 5; assert(/turn their backs/.test(OB.heal_service(g)));
}
{ // travel path
  const g = quiet(make({ seed: 3 }));
  const p = g.player; const path = g.travel_path(p.x + 3, p.y);
  assert(path === null || path.length >= 3);
}
console.log('core: all rule checks OK');
