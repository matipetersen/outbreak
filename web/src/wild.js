// ---------------------------------------------------------------- game to hunt and plants to gather (mirror of engine/wild.py)
const WILD_SPECIES = {                 // hp, glyph, meat [min, max], notice radius, dmg when cornered, spawn weight
  rabbit: [4, 'r', [1, 1], 5, [0, 0], 50],
  deer: [14, 'd', [2, 3], 7, [0, 0], 35],
  boar: [20, 'b', [2, 3], 4, [3, 7], 15],
  wolf: [12, 'w', [1, 2], 7, [3, 6], 0],             // packs in the deep woods only
};
const WILD_NAMES = { rabbit: 'Rabbit', deer: 'Deer', boar: 'Boar', wolf: 'Wolf' };
const WILD_WOLF_BURST = 4, WILD_FLEE_BURST = 3, WILD_SNEAK_NOTICE = 0.3;           // every third turn a fleeing animal takes two steps: walking one down fails
const WILD_FIGHTERS = ['boar', 'wolf'];                // these turn on you instead of running
const WILD_FOREST_TREES = 7, WILD_FOREST_SIGHT = 0.75;
const WILD_FORAGE_TURNS = 5, WILD_PATCH_TURNS = 800, WILD_SNEAK_BLOW = 3.0;
const wild_grazing = (t) => t === T.GRASS || t === T.BRUSH;

function wild_make(game, x, y, species) {
  const [hp, glyph] = WILD_SPECIES[species];
  return { kind: 'animal', uid: game.next_uid(), name: WILD_NAMES[species], glyph, x, y, hp, max_hp: hp, level_id: 'world', lvl: 1, lvl_xp: 0, title: '', stun: 0,
           species, state: 'graze', alert: false,
           stray: false, pet: false, bond: 0, fed: 0, dmg: [0, 0], acc: 50, kills: 0, nextfx: 0, lasttalk: -999, since: 0 };
}

function wild_pick_species(rng) {
  let r = rng.random() * 100;
  for (const [k, v] of Object.entries(WILD_SPECIES)) { if (!v[5]) continue; r -= v[5]; if (r < 0) return k; }
  return 'rabbit';
}

// ---- the deep woods
function wild_in_forest_at(lv, pos) {
  if (lv.kind !== 'overworld') return false;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (lv.in_bounds(pos[0] + dx, pos[1] + dy) && lv.tile(pos[0] + dx, pos[1] + dy) === T.TREE) n++;
  return n >= WILD_FOREST_TREES;
}
function wild_forest_here(game) {           // cached for the turn: perception asks once per zombie
  const p = game.player, key = `${game.clock.turn}:${p.x}:${p.y}:${game.level.id}`;
  if (!game._forest_cache || game._forest_cache[0] !== key) game._forest_cache = [key, wild_in_forest_at(game.level, [p.x, p.y])];
  return game._forest_cache[1];
}
function wild_forest_note(game) {
  const inside = wild_forest_here(game), was = !!game.in_forest;
  game.in_forest = inside;
  if (inside && !was) game.msg('The canopy closes over you. It is quieter here, and the dead will not see you from far. Wolves hunt in woods like this.', 'info');
}

function wild_step_away(game, a) {          // run from the player, sliding along obstacles and preferring open ground; null if cornered
  const lv = game.level, p = game.player, ok = (x, y) => lv.free(x, y) && (wild_grazing(lv.tile(x, y)) || lv.tile(x, y) === T.ROAD);
  const here = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
  let best = null, best_score = here - 0.5;
  for (const [dx, dy] of DIRS8) {
    const n = [a.x + dx, a.y + dy];
    if (!ok(n[0], n[1])) continue;
    const open = DIRS8.filter(([ex, ey]) => ok(n[0] + ex, n[1] + ey)).length;
    const score = (n[0] - p.x) ** 2 + (n[1] - p.y) ** 2 + 0.6 * open + game.rng.random() * 0.3;
    if (score > best_score) { best = n; best_score = score; }
  }
  return best;
}

const WILD_BITE_ACC = { wolf: 65, boar: 70 };
function wild_bite(game, a) {            // armour takes the edge off and wears, and a deep wound can bleed
  const p = game.player;
  if (game.clock.turn < game.invuln_until) return;
  if (game.rng.random() * 100 >= clamp((WILD_BITE_ACC[a.species] || 60) - p.evade, 15, 92)) { game.msg(`The ${a.name.toLowerCase()} snaps and misses.`, 'combat'); return; }
  const [lo, hi] = WILD_SPECIES[a.species][4], armor = p.armor ? game.item_def(p.armor.id) : null;
  const dmg = Math.max(1, Math.round(game.rng.randint(lo, hi) * game.diff.damage - (armor ? armor.defense : 0)));
  if (armor && p.armor.dur !== null) {
    p.armor.dur -= 1;
    if (p.armor.dur <= 0) { game.msg(`Your ${armor.name.toLowerCase()} falls apart!`, 'bad'); p.armor = null; }
  }
  game.msg(`The ${a.name.toLowerCase()} ${a.species === 'wolf' ? 'mauls' : 'gores'} you for ${dmg}.`, 'bad');
  damage_player(game, dmg, a.species === 'wolf' ? 'mauled by wolves' : 'gored by a boar', a);
  if (p.hp > 0 && dmg >= 4 && game.rng.random() < 0.2 * (1.0 - p.mod('bleed_resist'))) { p.bleeding = Math.min(3, p.bleeding + 1); game.msg('You are bleeding.', 'bad'); }
}

function wild_tick(game, a) {
  const p = game.player, lv = game.level, t = game.clock.turn;
  if (!WILD_SPECIES[a.species]) { pets_tick_animal(game, a); return; }          // a dog, a cat, a crow, a fox: strays and pets
  if (lv.kind !== 'overworld') return;
  const d = cheb(apos(a), apos(p));
  let radius = WILD_SPECIES[a.species][3];
  if (a.species === 'wolf' && !game.clock.is_day) radius += 3;
  if (p.sneaking) radius = Math.max(2, radius - 3);
  if (!a.alert && d <= radius && has_los(lv, apos(a), apos(p)) && (!p.sneaking || game.rng.random() < WILD_SNEAK_NOTICE)) {
    a.alert = true; a.state = (a.species === 'wolf' || (a.species === 'boar' && d <= 3)) ? 'charge' : 'flee';
    if (a.species === 'wolf') for (const m of lv.actors) if (m.kind === 'animal' && m.species === 'wolf' && cheb(apos(m), apos(a)) <= 9) { m.alert = true; m.state = 'charge'; }   // the pack hears it
  }
  if (a.alert && d > radius + 6) { a.alert = false; a.state = 'graze'; }
  if (a.state === 'flee') {
    for (let i = 0; i < 1 + (t % WILD_FLEE_BURST === 0 ? 1 : 0); i++) { const nxt = wild_step_away(game, a); if (nxt) lv.move_actor(a, nxt[0], nxt[1]); }
    return;
  }
  if (a.state === 'charge') {
    if (a.species === 'wolf' && d > radius + 8) { a.alert = false; a.state = 'graze'; return; }
    if (d === 1) {
      wild_bite(game, a);
    } else if (d <= (a.species === 'wolf' ? 14 : 8)) {
      for (let i = 0; i < 1 + (a.species === 'wolf' && t % WILD_WOLF_BURST === 0 ? 1 : 0); i++) {      // a wolf cannot be outwalked: a doorway can stop it
        if (cheb(apos(a), apos(p)) <= 1) { wild_bite(game, a); break; }                 // its spare step is a bite at your heels
        const nxt = greedy_step(lv, apos(a), apos(p), game.rng, (n) => wild_grazing(lv.tile(n[0], n[1])) || lv.tile(n[0], n[1]) === T.ROAD);
        if (nxt && lv.free(nxt[0], nxt[1])) lv.move_actor(a, nxt[0], nxt[1]);
      }
    }
    return;
  }
  if (game.rng.random() < 0.18) {
    const [dx, dy] = game.rng.choice(DIRS8), n = [a.x + dx, a.y + dy];
    if (lv.free(n[0], n[1]) && wild_grazing(lv.tile(n[0], n[1]))) lv.move_actor(a, n[0], n[1]);
  }
}

function wild_attack(game, a, unaware, acc, dmg) {
  if (!unaware && game.rng.random() * 100 >= acc) {
    game.msg(`You swing at the ${a.name.toLowerCase()} and miss.`, 'combat');
    a.alert = true; a.state = WILD_FIGHTERS.includes(a.species) ? 'charge' : 'flee';
    return true;
  }
  const hurt = Math.max(1, Math.trunc(dmg * (unaware ? WILD_SNEAK_BLOW : 1.0)));
  a.hp -= hurt;
  if (a.hp <= 0) { wild_kill(game, a); return true; }
  a.alert = true; a.state = WILD_FIGHTERS.includes(a.species) ? 'charge' : 'flee';
  game.msg(`You hit the ${a.name.toLowerCase()} for ${hurt}.`, 'combat');
  return true;
}

function wild_kill(game, a) {
  const lv = game.level;
  lv.remove_actor(a);
  const [lo, hi] = WILD_SPECIES[a.species][2], n = game.rng.randint(lo, hi);
  lv.drop(apos(a), make_item('raw_meat', n));
  game.player.gain_xp(3);
  game.player.bump('game');
  game.msg(`The ${a.name.toLowerCase()} drops. ${n} cut${n !== 1 ? 's' : ''} of meat lie there: pick it up, and cook it.`, 'good');
}

function wild_can_forage(game) {
  const p = game.player, lv = game.level;
  if (lv.kind !== 'overworld') return 'There is nothing to gather indoors.';
  if (!wild_grazing(lv.tile(p.x, p.y))) return 'Nothing edible grows on this. Try grass or brush.';
  if (game.visible_hostiles().length) return 'Not with something hunting you.';
  return '';
}

function wild_forage(game) {
  if (!game._begin_action()) return false;
  const why = wild_can_forage(game);
  if (why) { game.msg(why, 'info'); return false; }
  const p = game.player, lv = game.level, t = game.clock.turn;
  const patches = game.foraged;
  if (patches.some(([x, y, when]) => cheb([x, y], apos(p)) <= 2 && t - when < WILD_PATCH_TURNS)) { game.msg('This patch is already picked over. Move on.', 'info'); return false; }
  for (let i = 0; i < WILD_FORAGE_TURNS; i++) {
    game._spend(1);
    if (game.over) return true;
    if (game.visible_hostiles().length) { game.msg('You stop gathering: something is coming.', 'warn'); return true; }
  }
  game.emit_noise(apos(p), 2, 'player');
  patches.push([p.x, p.y, t]);
  const deep = wild_forest_here(game);
  let chance = (lv.tile(p.x, p.y) === T.BRUSH ? 0.65 : 0.4) + (deep ? 0.2 : 0);
  if (game.weather === 'rain' || game.weather === 'fog') chance += 0.1;
  if (!game.clock.is_day) chance -= 0.25;
  if (game.rng.random() < chance) {
    const n = game.rng.randint(1, 2);
    if (deep && game.rng.random() < 0.25) { game.give_item(make_item('herbs', n)); game.msg(`You find wild herbs growing in the shade (${n}).`, 'good'); }
    else { game.give_item(make_item('forage', n)); game.msg(`You gather wild greens and berries (${n}).`, 'good'); }
  } else game.msg('You find nothing worth eating here.', 'info');
  return true;
}

// ---------------------------------------------------------------- trees and water
const WILD_CHOP_TURNS = { blade: 6, blunt: 9, polearm: 9 }, WILD_CHOP_NOISE = 8;

function wild_tree_beside(game) {
  const p = game.player, lv = game.level;
  if (lv.kind !== 'overworld') return null;
  for (const [dx, dy] of DIRS8) {
    const x = p.x + dx, y = p.y + dy;
    if (lv.in_bounds(x, y) && lv.tile(x, y) === T.TREE && x > 0 && y > 0 && x < lv.w - 1 && y < lv.h - 1) return [x, y];      // the rim of the world is not for felling
  }
  return null;
}

function wild_water_beside(game) {
  const p = game.player, lv = game.level;
  if (lv.kind !== 'overworld') return null;
  if (lv.tile(p.x, p.y) === T.SHALLOW) return [p.x, p.y];
  for (const [dx, dy] of DIRS8) {
    const x = p.x + dx, y = p.y + dy;
    if (lv.in_bounds(x, y) && (lv.tile(x, y) === T.WATER || lv.tile(x, y) === T.SHALLOW)) return [x, y];
  }
  return null;
}

function wild_chop(game) {
  if (!game._begin_action()) return false;
  const tree = wild_tree_beside(game), p = game.player, lv = game.level;
  if (!tree) { game.msg('There is no tree within reach.', 'info'); return false; }
  const w = p.weapon ? game.item_def(p.weapon.id) : null, turns = w ? WILD_CHOP_TURNS[w.style] : undefined;
  if (turns === undefined) { game.msg('You need something with an edge or some weight to cut with.', 'info'); return false; }
  if (game.visible_hostiles().length) { game.msg('Not with something hunting you.', 'info'); return false; }
  for (let i = 0; i < turns; i++) {
    game._spend(1);
    if (game.over) return true;
    if (i % 3 === 0) game.emit_noise(apos(p), WILD_CHOP_NOISE, 'player');
    if (game.visible_hostiles().length) { game.msg('You stop chopping: something is coming.', 'warn'); return true; }
  }
  lv.set_tile(tree[0], tree[1], T.GRASS);
  const n = game.rng.randint(2, 4);
  game.give_item(make_item('wood', n));
  game.msg(`The tree comes down. ${n} planks, and a clearing where it stood.`, 'good');
  return true;
}

function wild_fish(game) {
  if (!game._begin_action()) return false;
  const p = game.player;
  const gear = p.inventory.find((i) => game.item_def(i.id).effect.fish);
  if (!gear) { game.msg('You have nothing to fish with. Craft a rod or a net.', 'info'); return false; }
  if (game.visible_hostiles().length) { game.msg('Not with something hunting you.', 'info'); return false; }
  const eff = game.item_def(gear.id).effect, most = eff.fish === 1 ? 1 : eff.fish, turns = most === 1 ? 8 : 12;
  for (let i = 0; i < turns; i++) {
    game._spend(1);
    if (game.over) return true;
    if (game.visible_hostiles().length) { game.msg('You stop fishing: something is coming.', 'warn'); return true; }
  }
  let chance = most === 1 ? 0.5 : 0.65;
  if (game.weather === 'rain' || game.weather === 'fog') chance += 0.1;
  if (!game.clock.is_day) chance -= 0.2;
  if (game.rng.random() < chance) {
    const n = game.rng.randint(1, most);
    game.give_item(make_item('fish', n));
    game.msg(n > 1 ? `You land ${n} fish.` : 'You land a fish.', 'good');
  } else game.msg('Nothing bites.', 'info');
  if (game.rng.random() < (eff.tear || 0)) {
    p.take(gear.id, 1);
    game.msg(`Your ${game.item_def(gear.id).name.toLowerCase()} ${most > 1 ? 'tears apart' : 'snaps'}.`, 'warn');
  }
  return true;
}

function wild_target(game) {
  if (wild_tree_beside(game) && game.player.weapon) return 'chop';
  if (wild_water_beside(game) && game.player.inventory.some((i) => game.item_def(i.id).effect.fish)) return 'fish';
  return wild_can_forage(game) ? '' : 'forage';
}

function wild_gather(game) {
  const what = wild_target(game);
  if (what === 'chop') return wild_chop(game);
  if (what === 'fish') return wild_fish(game);
  if (what === 'forage') return wild_forage(game);
  if (wild_tree_beside(game)) game.msg('You need a weapon with an edge or some weight to fell a tree.', 'info');
  else if (wild_water_beside(game)) game.msg('You have nothing to fish with. Craft a rod or a net.', 'info');
  else game.msg(wild_can_forage(game) || 'Nothing to gather here.', 'info');
  return false;
}
