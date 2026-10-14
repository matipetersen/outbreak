// ---------------------------------------------------------------- pets: strays you can win over with food (mirror of engine/pets.py)
const PETS_BY_SPECIES = Object.fromEntries(CONTENT.pets.species.map((s) => [s.species, s]));
const PETS_HUNGRY_AFTER = 500, PETS_STARVING_AFTER = 900, PETS_CURIOUS_RANGE = 9, PETS_GIFT_EVERY = 400, PETS_CALM_EVERY = 6, PETS_WARN_EVERY = 6;
const pets_ok_tile = (t) => t === T.GRASS || t === T.BRUSH || t === T.ROAD || t === T.FLOOR;

const pets_is_species = (a) => !!a && a.kind === 'animal' && !!PETS_BY_SPECIES[a.species];

function pets_make_stray(game, species, x, y) {
  const sp = PETS_BY_SPECIES[species];
  const a = wild_make(game, x, y, 'rabbit');
  Object.assign(a, { name: cap(species), glyph: sp.glyph, hp: sp.hp, max_hp: sp.hp, species, state: 'graze', stray: true, pet: false, dmg: sp.dmg.slice(), acc: sp.acc });
  return a;
}

function pets_current(game) {
  const uid = game.pet_uid;
  if (!uid) return null;
  return game.world.level.actors.find((a) => a.kind === 'animal' && a.uid === uid && a.pet && a.hp > 0) || null;
}

function pets_say(game, a, text) { game.msg(`${a.name} ${text}`, 'ally'); }
function pets_note(game, text, key = false) { game.msg(text, 'ally', key); }
function pets_add_bond(a, n) { a.bond = Math.max(0, Math.min(100, (a.bond || 0) + n)); }
function pets_describe(a) { const sp = PETS_BY_SPECIES[a.species]; return `${a.name}, a ${sp.label}. Good at it: ${sp.strength}. Trouble: ${sp.flaw}.`; }
function pets_hunger(game, a) { const w = game.clock.turn - a.fed; return w > PETS_STARVING_AFTER ? 'starving' : w > PETS_HUNGRY_AFTER ? 'hungry' : 'fed'; }


function pets_stray_beat(game) {
  const lv = game.world.level, p = game.player;
  if (pets_current(game) || game.level !== lv) return;
  const species = game.rng.choice(['dog', 'cat', 'crow', 'fox']);
  for (let k = 0; k < 30; k++) {
    const x = p.x + game.rng.randint(-14, 14), y = p.y + game.rng.randint(-14, 14);
    if (cheb([x, y], apos(p)) >= 8 && lv.in_bounds(x, y) && lv.free(x, y) && pets_ok_tile(lv.tile(x, y))) {
      lv.add_actor(pets_make_stray(game, species, x, y));
      game.msg(`A stray ${species} has been keeping its distance from you for a while. It is watching your pack.`, 'dir');
      return;
    }
  }
}

function pets_can_befriend(game, a) {
  if (!a.stray || !pets_is_species(a)) return 'It is not interested.';
  const cur = pets_current(game);
  if (cur) return `You already have ${cur.name}. One is plenty to feed.`;
  if (!game.player.inventory.some((i) => game.item_def(i.id).kind === 'food')) return `The ${a.species} watches your hands. Bring it something to eat.`;
  return '';
}

function pets_befriend(game, a, sure = false) {
  const why = pets_can_befriend(game, a);
  if (why) return why;
  const p = game.player, rng = game.rng, food = p.inventory.find((i) => game.item_def(i.id).kind === 'food');
  p.take(food.id, 1);
  const chance = PETS_BY_SPECIES[a.species].accept + (p.sneaking ? 0.15 : 0) + (p.humanity >= 60 ? 0.1 : 0);
  if (!sure && rng.random() >= chance) { a.state = 'flee'; a.alert = true; return `The ${a.species} snatches the food and bolts. Maybe next time.`; }
  const r2 = new RNG(`${game.seed}:pet:${a.uid}`);
  a.name = r2.choice(CONTENT.pets.names);
  a.pet = true; a.stray = false; a.state = 'follow';
  a.bond = 20; a.fed = game.clock.turn; a.since = game.clock.turn; a.nextfx = game.clock.turn + PETS_GIFT_EVERY;
  game.pet_uid = a.uid;
  pets_note(game, `${a.name} the ${a.species} is yours now. ${PETS_BY_SPECIES[a.species].intro}`, true);
  return `${a.name} the ${a.species} is yours now.`;
}

function pets_offer(game, chance) {
  if (game.rng.random() >= chance || pets_current(game)) return;
  const lv = game.world.level, p = game.player;
  if (game.level !== lv) return;
  const spot = lv.free_spot_near(p.x, p.y, 3);
  if (!spot) return;
  const a = pets_make_stray(game, game.rng.choice(['dog', 'cat', 'crow', 'fox']), spot[0], spot[1]);
  lv.add_actor(a);
  if (!p.inventory.some((i) => game.item_def(i.id).kind === 'food')) game.give_item(make_item('food', 1));
  pets_befriend(game, a, true);                                   // it is already half yours
}

function pets_pet_it(game, a) {
  const t = game.clock.turn;
  if (t - a.lasttalk > 100) pets_add_bond(a, 1);
  a.lasttalk = t; game._spend(1);
  return `${a.name} ${game.rng.choice(PETS_BY_SPECIES[a.species].idle)}`;
}

function pets_feed(game, a, index) {
  const p = game.player, it = p.inventory[index];
  if (!it) return '';
  if (game.item_def(it.id).kind !== 'food') return `${a.name} sniffs it and turns away.`;
  p.take(it.id, 1); a.fed = game.clock.turn; a.hp = Math.min(a.max_hp, a.hp + 3); pets_add_bond(a, 4);
  return `${a.name} eats, and stays close.`;
}

function pets_toggle_wait(game, a) {
  if (a.state === 'follow') { a.state = 'wait'; return `${a.name} sits and waits.`; }
  a.state = 'follow'; return `${a.name} gets up and follows.`;
}
function pets_release(game, a, why) { a.pet = false; a.stray = true; a.state = 'graze'; a.alert = false; game.pet_uid = 0; pets_note(game, why, true); }
function pets_dismiss(game, a) { pets_release(game, a, `${a.name} trots off, and does not look back.`); return `${a.name} trots off.`; }

// ---- what a pet (or a stray) does each turn
function pets_step_away(game, a, from) {
  const lv = game.level;
  let best = null, best_d = cheb(apos(a), from);
  for (const [dx, dy] of DIRS8) {
    const n = [a.x + dx, a.y + dy];
    if (lv.free(n[0], n[1]) && pets_ok_tile(lv.tile(n[0], n[1])) && cheb(n, from) > best_d) { best = n; best_d = cheb(n, from); }
  }
  if (best) lv.move_actor(a, best[0], best[1]);
}

function pets_tick_animal(game, a) {
  const p = game.player, lv = game.level;
  if (lv.kind !== 'overworld') return;
  const d = cheb(apos(a), apos(p));
  if (a.pet) { pets_ai(game, a, d); return; }
  if (a.state === 'flee') { if (d > 12) { a.state = 'graze'; a.alert = false; return; } pets_step_away(game, a, apos(p)); return; }
  if (d <= PETS_CURIOUS_RANGE && (a.species === 'dog' || a.species === 'cat') && has_los(lv, apos(a), apos(p))) {
    if (d > 3) { const nxt = greedy_step(lv, apos(a), apos(p), game.rng, (n) => pets_ok_tile(lv.tile(n[0], n[1]))); if (nxt && lv.free(nxt[0], nxt[1])) lv.move_actor(a, nxt[0], nxt[1]); }
    return;
  }
  if ((a.species === 'crow' || a.species === 'fox') && d <= 4 && game.rng.random() < 0.5) { pets_step_away(game, a, apos(p)); return; }
  if (game.rng.random() < 0.18) {
    const [dx, dy] = game.rng.choice(DIRS8), n = [a.x + dx, a.y + dy];
    if (lv.free(n[0], n[1]) && pets_ok_tile(lv.tile(n[0], n[1]))) lv.move_actor(a, n[0], n[1]);
  }
}

function pets_nearest_foe(game, a) {
  let best = null, bd = 99;
  for (const z of game.level.actors) if (z.kind === 'zombie' && z.hp > 0 && z.state !== 'dormant') { const d = cheb(apos(a), apos(z)); if (d < bd && d <= 8) { best = z; bd = d; } }
  return best;
}

function pets_ai(game, a, d) {
  const lv = game.level, p = game.player, foe = pets_nearest_foe(game, a);
  if (foe && a.state === 'follow' && d <= 8) {
    const coward = a.species !== 'dog' || a.hp < a.max_hp * 0.3, fd = cheb(apos(a), apos(foe));
    if (coward && fd <= 3) { pets_step_away(game, a, apos(foe)); return; }
    if (a.species === 'dog' && fd === 1) { attack_actor(game, a, foe); return; }
    if (a.species === 'dog' && fd > 1) { const nxt = greedy_step(lv, apos(a), apos(foe), game.rng, (n) => pets_ok_tile(lv.tile(n[0], n[1]))); if (nxt && lv.free(nxt[0], nxt[1])) lv.move_actor(a, nxt[0], nxt[1]); return; }
  }
  if (a.state === 'wait' || d <= 2) return;
  const field = game.get_field();
  let nxt = field && lv.idx(a.x, a.y) in field ? descend(lv, field, apos(a), game.rng) : null;
  if (!nxt) nxt = greedy_step(lv, apos(a), apos(p), game.rng, (n) => pets_ok_tile(lv.tile(n[0], n[1])));
  if (nxt && lv.free(nxt[0], nxt[1])) lv.move_actor(a, nxt[0], nxt[1]);
}

function pets_tick(game) {
  const a = pets_current(game);
  if (!a || game.level !== game.world.level) return;
  const t = game.clock.turn, p = game.player, sp = PETS_BY_SPECIES[a.species], near = cheb(apos(a), apos(p)) <= 10;
  if (t % 100 === 0) pets_add_bond(a, pets_hunger(game, a) !== 'starving' ? 1 : -3);
  if (t % 15 === 0 && a.hp < a.max_hp && !game.visible_hostiles().some((z) => cheb(apos(z), apos(a)) <= 6)) a.hp += 1;
  if (pets_hunger(game, a) === 'hungry' && t % 150 === 0) pets_note(game, `${a.name} looks at your pack and whines. It is hungry.`);
  if (a.bond <= 0) { pets_release(game, a, `${a.name} drifts away: it has had enough of going hungry.`); return; }
  if (!near) return;
  if (a.species === 'dog') {
    if (t % PETS_WARN_EVERY === 0) pets_growl(game, a);
    if (t % 40 === 0 && game.rng.random() < 0.25) { game.emit_noise(apos(a), 6, 'player'); pets_note(game, `${a.name} barks. Loudly.`); }
  } else if (a.species === 'cat') {
    if (t % PETS_CALM_EVERY === 0 && p.panic > 15) game.add_panic(-2, true);
    if (t - a.lasttalk > 800 && t % 100 === 0) pets_add_bond(a, -3);
  } else if (a.species === 'crow') {
    if (t >= a.nextfx && t % 5 === 0) {
      a.nextfx = t + 300;
      const site = Object.values(game.pois).sort((x, y) => cheb([x.x, x.y], apos(p)) - cheb([y.x, y.y], apos(p))).find((q) => !q.revealed && q.kind !== 'breach' && q.kind !== 'cave');
      if (site && cheb([site.x, site.y], apos(p)) <= 45) { site.revealed = true; pets_note(game, `${a.name} circles over something to the ${compass(site.x - p.x, site.y - p.y)}: ${site.name} is marked on your map.`); }
    }
    if (t % 40 === 0 && game.rng.random() < 0.2) { game.emit_noise(apos(a), 5, 'player'); pets_note(game, `${a.name} caws. The whole street heard it.`); }
  }
  if (sp.gift && t >= a.nextfx && a.species === 'fox' && pets_hunger(game, a) === 'fed') {
    a.nextfx = t + PETS_GIFT_EVERY;
    if (game.rng.random() < 0.6) { game.give_item(make_item('raw_meat', 1)); pets_note(game, `${a.name} drops a rabbit at your feet.`); pets_add_bond(a, 1); }
  }
}

function pets_growl(game, a) {
  const lv = game.level;
  for (const h of lv.actors) if (h.hidden && cheb(apos(h), apos(a)) <= 9) { h.hidden = false; h.state = 'idle'; pets_note(game, `${a.name} growls at the cover ahead. Someone is there.`); pets_add_bond(a, 1); return; }
  for (const z of lv.actors) {
    if (z.kind === 'zombie' && z.hp > 0 && !game.is_visible(z.x, z.y) && cheb(apos(z), apos(a)) <= 9 && z.state !== 'dormant' && game.clock.turn >= a.nextfx - PETS_GIFT_EVERY + 40) {
      pets_note(game, `${a.name} growls, hackles up, toward the ${compass(z.x - a.x, z.y - a.y)}.`); return;
    }
  }
}

// ---- moments
function pets_on_enter(game) { const a = pets_current(game); if (a) pets_note(game, `${a.name} sits outside and waits.`); }
function pets_on_return(game) {
  const a = pets_current(game);
  if (!a) return;
  const sp = PETS_BY_SPECIES[a.species];
  if (sp.gift && (a.species === 'cat' || a.species === 'crow') && game.rng.random() < 0.3) {
    if (sp.gift === 'coins') { const n = game.rng.randint(1, 4); game.player.coins += n; pets_note(game, `${a.name} drops something bright at your feet: ${n} ${game.era.coin}.`); }
    else { game.give_item(make_item(sp.gift, 1)); pets_note(game, `${a.name} has caught something while you were gone.`); }
    pets_add_bond(a, 1);
  }
}
function pets_on_kill(game, a, victim) { a.kills = (a.kills || 0) + 1; pets_add_bond(a, 1); if (game.rng.random() < 0.3) pets_note(game, `${a.name} worries the body. It looks pleased with itself.`); }
function pets_on_hurt(game, a) { if (game.rng.random() < 0.4) pets_note(game, `${a.name} yelps.`); }
function pets_on_death(game, a, killer) {
  const lv = game.level;
  if (lv.actors.includes(a)) lv.remove_actor(a);
  if (!a.pet) return;
  const days = Math.max(0, Math.floor((game.clock.turn - a.since) / 240)), by = killer && killer.name ? ` at the hands of ${killer.name.toLowerCase()}` : '';
  pets_note(game, `${a.name} is dead${by}. ${days} day${days !== 1 ? 's' : ''} together. Gone for good.`, true);
  game.fallen_allies.push([a.name, `${a.species}, ${days}d, ${a.kills || 0} kills`]);
  game.pet_uid = 0;
  game.add_panic(6 + a.bond / 8, true);
  memory_on_ally_death(game, a.name, a.species, `${a.name} was a good ${a.species}.`, apos(a));
  dir_mourn(game);
}

