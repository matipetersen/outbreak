// ---------------------------------------------------------------- mounts: wild horses you can tame and ride (web only)
// Small herds graze on the open ground away from the city. They bolt like deer, so you creep up on one and offer it food;
// if it takes it, it is yours. To ride you need a saddle (craft one). Riding covers two tiles a turn (three at a gallop),
// costs you no stamina, and is loud. You cannot ride into a building or a cave: you tie the horse outside. The dead
// and the living go for the rider, and some of those blows land on the horse; hurt badly enough, it throws you and bolts.
// The station's version is a strider, a walking cargo frame, but it works the same.
const MOUNT_HP = 30, MOUNT_NOTICE = 6, MOUNT_HERD_CHANCE = 0.3, MOUNT_TAKE_HIT = 0.45, MOUNT_BOLT_BELOW = 0.35;
const MOUNT_NOISE = 6, MOUNT_GALLOP_NOISE = 10;
WILD_SPECIES.horse = [MOUNT_HP, 'H', [3, 5], MOUNT_NOTICE, [0, 0], 0];      // herds are placed by the chunk painter, never at random
WILD_NAMES.horse = 'Horse';

const mount_word = (game) => (game.era.id === 'scifi' ? 'strider' : 'horse');

for (const era of Object.values(CONTENT.eras)) {
  era.items.saddle = { id: 'saddle', name: era.id === 'scifi' ? 'Strider harness' : 'Saddle', kind: 'tool', desc: 'Lets you ride a tamed ' + (era.id === 'scifi' ? 'strider' : 'horse') + '. It stays in your pack.',
                       value: 10, stackable: false, tags: ['crafted'], rarity: 1, poi: [], style: '', dmg: [0, 0], reach: 1, noise: 0, durability: 0, ammo: '', accuracy: 0, head: 0,
                       defense: 0, bite_guard: 0, stealth: 0, light: 0, effect: {} };
}
CONTENT.recipes.push({ id: 'saddle', out: 'saddle', qty: 1, inputs: [['cloth', 3], ['wood', 1], ['scrap', 1]], fluency: 0, needs: '', turns: 8, starter: true, workshop: true });

function mount_make(game, x, y) {
  const a = wild_make(game, x, y, 'horse');
  a.name = cap(mount_word(game));
  return a;
}

// A small herd on the open ground of a chunk (its own random stream, like the rest of the wildlife).
function mount_herd(game, lv, cx, cy, x0, y0, x1, y1, keep) {
  const r = chunk_rng(game.world.seed, cx, cy, 47), start = game.world.start;
  if (r.random() >= MOUNT_HERD_CHANCE) return;
  for (let tries = 0; tries < 25; tries++) {
    const hx = r.randint(Math.max(x0 + 3, 4), Math.min(x1 - 4, lv.w - 5)), hy = r.randint(Math.max(y0 + 3, 4), Math.min(y1 - 4, lv.h - 5));
    if (cheb([hx, hy], start) < 25 || game.world.terrain.zone_at(hx, hy) !== 0 || wild_in_forest_at(lv, [hx, hy]) || lv.tile(hx, hy) !== T.GRASS) continue;
    for (let m = r.randint(2, 3); m > 0; m--) {
      const sp = [hx + r.randint(-2, 2), hy + r.randint(-2, 2)];
      if (lv.in_bounds(sp[0], sp[1]) && wild_grazing(lv.tile(sp[0], sp[1])) && !lv.occ.has(lv.idx(sp[0], sp[1]))) { const a = mount_make(game, sp[0], sp[1]); lv.add_actor(a); keep(a); }
    }
    return;
  }
}

function mount_current(game) {
  if (game.riding) return game.riding;
  if (!game.mount_uid) return null;
  return game.world.level.actors.find((a) => a.uid === game.mount_uid && a.hp > 0) || null;
}
const mount_wild = (a) => !!a && a.kind === 'animal' && a.species === 'horse' && !a.mount;

function mount_adjacent(game) {
  const p = game.player, lv = game.level;
  for (const [dx, dy] of DIRS8) { const a = lv.occ.get(lv.idx(p.x + dx, p.y + dy)); if (a && a.kind === 'animal' && a.species === 'horse') return a; }
  return null;
}

// ---- winning one over
function mount_tame(game, a) {
  const p = game.player;
  if (!mount_wild(a)) return 'It is not wild.';
  if (mount_current(game)) return `You already have ${mount_current(game).name}.`;
  if (cheb(apos(a), apos(p)) > 1) return `Get next to the ${mount_word(game)} first.`;
  const greens = p.inventory.find((i) => i.id === 'forage'), food = greens || p.inventory.find((i) => game.item_def(i.id).kind === 'food');
  if (!food) return `The ${mount_word(game)} watches your hands. Bring it something to eat: wild greens are best.`;
  p.take(food.id, 1);
  const chance = 0.3 + (p.sneaking ? 0.2 : 0) + (p.humanity >= 60 ? 0.1 : 0) + (greens ? 0.15 : 0);
  game._spend(2);
  if (game.rng.random() >= chance) { a.alert = true; a.state = 'flee'; return `The ${mount_word(game)} takes it from your palm, snorts, and bolts.`; }
  a.mount = true; a.alert = false; a.state = 'follow'; a.bond = 20; a.since = game.clock.turn;
  a.name = new RNG(`${game.seed}:mount:${a.uid}`).choice(CONTENT.pets.names);
  game.mount_uid = a.uid;
  game.msg(`The ${mount_word(game)} lets you put a hand on its neck. You call it ${a.name}. ${game.player.count('saddle') ? 'You have a saddle: you can ride.' : 'Make a saddle (Craft) to ride it.'}`, 'good', true);
  return `${a.name} follows you now.`;
}

function mount_release(game, a) {
  if (game.riding === a) mount_dismount(game, true);
  a.mount = false; a.state = 'flee'; a.alert = true; game.mount_uid = 0;
  return `${a.name} shakes its head and trots away into the long grass.`;
}

function mount_toggle_wait(game, a) { a.state = a.state === 'wait' ? 'follow' : 'wait'; return a.state === 'wait' ? `${a.name} stays where it is.` : `${a.name} follows you.`; }

function mount_feed(game, a) {
  const p = game.player, food = p.inventory.find((i) => i.id === 'forage') || p.inventory.find((i) => game.item_def(i.id).kind === 'food');
  if (!food) return 'You have nothing to feed it.';
  p.take(food.id, 1); a.hp = Math.min(a.max_hp, a.hp + 8); a.bond = Math.min(100, (a.bond || 0) + 5);
  return `${a.name} eats from your hand and leans into you.`;
}

// ---- riding
function mount_can_ride(game, a) {
  if (!a || !a.mount) return 'You have nothing to ride.';
  if (game.riding) return 'You are already riding.';
  if (game.level !== game.world.level) return 'Not indoors.';
  if (cheb(apos(a), apos(game.player)) > 1) return `Get next to ${a.name} first.`;
  if (!game.player.count('saddle')) return 'You need a saddle (Craft).';
  if (game.player.lost.length >= 2) return 'You cannot climb up any more.';
  return '';
}
function mount_ride(game, a) {
  const why = mount_can_ride(game, a);
  if (why) return why;
  const p = game.player;
  game.world.level.remove_actor(a);
  game.riding = a; p.sneaking = false; p.sprinting = false;
  game._spend(1);
  return `You swing up onto ${a.name}.`;
}
// Off the horse: it stays where you get down, waiting. `thrown`: whatever spot is free, you land hard.
function mount_dismount(game, quiet = false) {
  const a = game.riding;
  if (!a) return 'You are not riding.';
  const lv = game.world.level, p = game.player;
  const spot = lv.free_spot_near(p.x, p.y, 3) || lv.free_spot_near(p.x, p.y, 8);
  game.riding = null;
  if (spot) { a.x = spot[0]; a.y = spot[1]; a.level_id = 'world'; lv.add_actor(a); a.state = 'wait'; }
  else game.mount_uid = 0;                                                        // nowhere to stand it: it is gone
  p.sprinting = false;
  if (!quiet) game._spend(1);
  return `You get down. ${a.name} waits.`;
}

// A step on horseback: two tiles a turn, three at a gallop; loud; no stamina.
function mount_step(game, tile) {
  const p = game.player, lv = game.level, k = lv.idx(p.x, p.y);
  const gallop = p.sprinting;
  game.emit_noise([p.x, p.y], gallop ? MOUNT_GALLOP_NOISE : MOUNT_NOISE);
  sfx(game, 'step', null, { surface: 'hard', quiet: false, loud: gallop });
  wild_forest_note(game);
  if (!TILES[tile].masks_scent) game.scent[k] = game.clock.turn;
  game._ride_step = ((game._ride_step || 0) + 1) % (gallop ? 3 : 2);
  const stack = lv.items[k];
  if (stack) game.msg(`You see here: ${stack.slice(0, 3).map((i) => game.item_def(i.id).name.toLowerCase()).join(', ')}. (PICK UP)`, 'info');
  game._spend(game._ride_step === 0 ? 1 : 0);
}

// A blow aimed at the rider: some land on the horse. True if the horse took it.
function mount_take_hit(game, raw) {
  const a = game.riding;
  if (!a || game.rng.random() >= MOUNT_TAKE_HIT) return false;
  const dmg = Math.max(1, Math.round(raw));
  a.hp -= dmg;
  if (a.hp <= 0) {
    const p = game.player;
    game.riding = null; game.mount_uid = 0;
    game.level.drop([p.x, p.y], make_item('raw_meat', 3));
    game.fallen_allies.push([a.name, `${mount_word(game)}, killed under you`]);
    game.msg(`${a.name} screams and goes down under you. You are thrown clear.`, 'bad', true);
    damage_player(game, 5, `thrown from a dying ${mount_word(game)}`);
    return true;
  }
  game.msg(`The blow catches ${a.name} instead of you.`, 'warn');
  if (a.hp < a.max_hp * MOUNT_BOLT_BELOW && game.rng.random() < 0.5) mount_bolt(game);
  return true;
}
// Hurt and terrified, it throws you and runs; it comes back to where it was when it calms down.
function mount_bolt(game) {
  const a = game.riding, p = game.player, lv = game.world.level;
  if (!a) return;
  game.riding = null;
  let spot = null;
  for (let k = 0; k < 20 && !spot; k++) { const q = [p.x + game.rng.randint(-7, 7), p.y + game.rng.randint(-7, 7)]; if (cheb(q, apos(p)) >= 4 && lv.free(q[0], q[1])) spot = q; }
  spot = spot || lv.free_spot_near(p.x, p.y, 4);
  if (spot) { a.x = spot[0]; a.y = spot[1]; a.level_id = 'world'; lv.add_actor(a); a.state = 'wait'; a.spooked = game.clock.turn + 30; }
  else game.mount_uid = 0;
  game.add_panic(15);
  game.msg(`${a.name} rears and throws you, and bolts.`, 'bad', true);
  damage_player(game, 4, `thrown by a panicking ${mount_word(game)}`);
}

// What your horse does when you are not on it: follow, or wait and graze; shy away from the dead.
function mount_tick_animal(game, a) {
  const lv = game.level, p = game.player;
  if (lv.kind !== 'overworld') return;
  if (game.clock.turn % 20 === 0 && a.hp < a.max_hp) a.hp += 1;
  const near = lv.actors.find((z) => z.kind === 'zombie' && z.hp > 0 && cheb(apos(z), apos(a)) <= 3);
  if (near) { const nxt = pets_step_away(game, a, apos(near)); return nxt; }
  if (a.state === 'wait' || (a.spooked && game.clock.turn < a.spooked)) {
    if (game.rng.random() < 0.05) { const [dx, dy] = game.rng.choice(DIRS8); if (lv.free(a.x + dx, a.y + dy) && wild_grazing(lv.tile(a.x + dx, a.y + dy))) lv.move_actor(a, a.x + dx, a.y + dy); }
    return;
  }
  const d = cheb(apos(a), apos(p));
  if (d <= 2) return;
  for (let i = 0; i < (d > 6 ? 2 : 1); i++) {
    const nxt = greedy_step(lv, apos(a), apos(p), game.rng, (n) => pets_ok_tile(lv.tile(n[0], n[1])) || lv.tile(n[0], n[1]) === T.SHALLOW);
    if (nxt && lv.free(nxt[0], nxt[1])) lv.move_actor(a, nxt[0], nxt[1]); else break;
  }
}

// Through a door on horseback: you get down and leave it outside.
function mount_leave_outside(game) {
  const a = game.riding;
  if (!a) return;
  mount_dismount(game, true);
  if (a.x !== undefined) game.msg(`You tie ${a.name} up outside.`, 'info');
}

// The rider falls (hardcore): the horse is left standing where it happened.
function mount_on_player_death(game, lv, pos) {
  const a = game.riding;
  if (!a) return;
  game.riding = null;
  const world = game.world.level, spot = lv === world ? world.free_spot_near(pos[0], pos[1], 4) : null;
  if (spot) { a.x = spot[0]; a.y = spot[1]; world.add_actor(a); a.mount = false; a.state = 'flee'; }
  game.mount_uid = 0;
}
