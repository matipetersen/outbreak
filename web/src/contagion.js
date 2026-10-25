// ---------------------------------------------------------------- the bite is for everyone (web only)
// The dead used to only hurt the living around you. Now a bite infects them by the same rule as you: the strain's chance per
// bite, less what their armour guards, a fever on the strain's clock, and at the end they get up as one of the dead. Your
// companion can be saved the way you can (a limb cut off in time, with a blade), slowed with a suppressant, or let go before
// it happens. Soldiers, guards and raiders turn where they stand. People living at your base can be bitten in a raid too.
const NPC_GUARD = { soldier: 0.3, scout: 0.15, raider: 0.1 };         // what the armour they wear stops
const NPC_LIMBS = [['arm', 4], ['leg', 3], ['torso', 3]];

// A zombie's bite landed on someone who is not you.
function npc_bitten(game, z, h) {
  if (h.kind !== 'human' || h.hp <= 0) return;
  if ((h.trait || h.uid === game.companion_uid) && comp_early_grace(game)) return;        // the opening goes easy on your people
  const guard = h.gear_armor ? game.item_def(h.gear_armor.id).bite_guard : (NPC_GUARD[h.role] || 0);
  let chance = game.profile.infect * (1 - guard);
  if (game.profile.vector === 'spore') chance *= 0.5;
  if (game.rng.random() >= chance) return;
  if (h.infected) { h.infection_timer = Math.max(1, h.infection_timer - 40); return; }
  h.infected = true;
  h.infection_timer = Math.max(10, Math.floor(game.profile.incubation * game.diff.timer));
  h.bite_limb = weighted_choice(game.rng, NPC_LIMBS);
  h.bite_window = h.bite_limb === 'torso' ? 0 : Math.max(8, Math.min(30, Math.floor(game.profile.incubation / 3)));
  if (h.uid === game.companion_uid) {
    comp_note(game, `${h.name} has been bitten (${h.bite_limb}).`, true);
    comp_say(game, h, h.bite_limb === 'torso' ? '"It got me. In the side. ... I know what that means."' : `"My ${h.bite_limb}. It bit my ${h.bite_limb}." They are looking at you, not at the wound.`);
    if (h.bite_window) comp_note(game, `  A limb can still be cut off for ${h.bite_window} turns, with a blade (talk to them).`);
  } else if (game.is_visible(h.x, h.y)) game.msg(`The ${h.name.toLowerCase()} has been bitten.`, 'warn');
}

function contagion_tick(game) {
  const levels = game.level === game.world.level ? [game.level] : [game.level, game.world.level];
  for (const lv of levels) {
    for (const h of lv.actors.slice()) {
      if (h.kind !== 'human' || !h.infected || h.hp <= 0) continue;
      h.infection_timer -= 1;
      if (h.bite_window > 0) h.bite_window -= 1;
      const mine = h.uid === game.companion_uid;
      if (mine && h.bite_window === 0 && h.bite_limb !== 'torso' && !h.window_told) { h.window_told = true; comp_note(game, `It is too late to cut it off ${h.name} now. It has spread.`); }
      const total = Math.max(10, Math.floor(game.profile.incubation * game.diff.timer)), left = h.infection_timer;
      if (mine && left > 0 && (left === Math.floor(total / 2) || left === 30)) comp_say(game, h, left === 30 ? '"I am so cold. Stay close. Not too close."' : '"I am fine. It is just a fever." They are not fine.');
      if (left <= 0) npc_turn(game, h, lv);
    }
  }
}

// The fever wins: they get up as one of the dead, where they stand.
function npc_turn(game, h, lv, quiet = false) {
  const pos = apos(h), mine = h.uid === game.companion_uid, name = h.name;
  if (mine) {
    comp_on_death(game, h, null);
    game.fallen_allies[game.fallen_allies.length - 1][1] += ', turned';
  }
  const o = h.outpost && game.saga && game.saga.outposts[h.outpost];
  if (o && o.owner) o.garrison = Math.max(0, o.garrison - 1);
  for (const item of h.loot || []) lv.drop(pos, item);
  lv.remove_actor(h);
  const z = spawn_zombie(game, lv, pos, 'walker', false, true);
  z.name = `Turned ${mine ? name : name.toLowerCase()}`; z.title = mine ? `Once ${name}, who travelled with you` : 'Once one of the living';
  z.state = 'hunt'; z.target = apos(game.player); z.stimulus_turn = game.clock.turn;
  if (quiet) return z;
  if (mine) game.msg(`${name} goes still. Then ${name} gets up, and does not know you.`, 'bad', true);
  else if (game.is_visible(pos[0], pos[1])) game.msg(`The ${name.toLowerCase()} shudders, falls, and gets up wrong.`, 'bad');
  return z;
}

// ---- what you can do for your companion
function npc_can_cut(game, h) {
  if (!h.infected) return 'They are not infected.';
  if (h.bite_limb === 'torso') return 'The bite is in the body. There is nothing to cut off.';
  if (h.bite_window <= 0) return 'Too late: it has already spread.';
  const p = game.player, carried = (p.weapon ? [p.weapon] : []).concat(p.inventory);
  if (!carried.some((i) => { const d = game.item_def(i.id); return d.kind === 'weapon' && d.style === 'blade'; })) return 'You need a blade.';
  return '';
}
function npc_cut(game, h) {
  const why = npc_can_cut(game, h);
  if (why) return why;
  h.infected = false; h.infection_timer = 0; h.bite_window = 0;
  h.max_hp = Math.max(12, Math.floor(h.max_hp * 0.7)); h.hp = Math.max(1, Math.min(h.max_hp, h.hp - Math.floor(h.max_hp * 0.4)));
  h.lost = (h.lost || []).concat([h.bite_limb]);
  comp_add_bond(h, 15);
  game.emit_noise(apos(game.player), 9, 'player'); game.add_panic(20);
  game._spend(3);
  return `You do it fast, before either of you can think. ${h.name} screams, then holds on to you until it stops. They will live, without the ${h.bite_limb}, and they will not forget who did it.`;
}
function npc_suppress(game, h) {
  const p = game.player, i = p.inventory.findIndex((it) => game.item_def(it.id).effect && game.item_def(it.id).effect.suppress);
  if (!h.infected) return 'They are not infected.';
  if (i < 0) return 'You have nothing that slows it.';
  const d = game.item_def(p.inventory[i].id);
  h.infection_timer += Math.floor(d.effect.suppress); p.take(p.inventory[i].id, 1);
  comp_add_bond(h, 5);
  return `${h.name} takes the ${d.name.toLowerCase()} without a word. It buys time. It does not buy a cure.`;
}
// Before it happens, while they are still themselves.
function npc_mercy(game, h) {
  if (!h.infected) return 'They are not infected.';
  const lv = game.level.actors.includes(h) ? game.level : game.world.level, name = h.name;
  comp_on_death(game, h, null);
  game.fallen_allies[game.fallen_allies.length - 1][1] += ', let go before the fever took them';
  lv.remove_actor(h);
  game.adjust_humanity(2, '');
  game._spend(2);
  return `${name} nods, once. "Thank you." You stay until it is done. They will not get up.`;
}

// ---- the people at your base (endless): a bite in a raid, a fever the next morning, and then
function resident_bitten(game, r) { if (!r.bitten) { r.bitten = game_day(game); r.hurt = Math.max(r.hurt, 2); } }
function resident_fever(game, r, lines) {
  if (!r.bitten) return false;
  const days = game_day(game) - r.bitten;
  if (days < 1) return false;
  if (days === 1) { lines.push(`${r.name} has a fever. It is the bite. You have until tomorrow morning to decide.`); return false; }
  const S = game.saga;
  saga_lose_resident(game, r, 'turned in the night, at the base');
  for (const o of S.residents.filter(() => game.rng.random() < 0.35)) { o.hurt = Math.max(o.hurt, 2); if (game.rng.random() < 0.3) resident_bitten(game, o); }
  for (const o of S.residents) o.morale = Math.max(0, o.morale - 15);
  lines.push(`${r.name} turned in the night. By the time anyone got to them, they had got to someone else.`);
  return true;
}
function resident_cut(game, r) {
  const p = game.player, carried = (p.weapon ? [p.weapon] : []).concat(p.inventory);
  if (!r.bitten) return 'They are not bitten.';
  if (game_day(game) - r.bitten >= 1) return 'Too late: the fever has started.';
  if (!carried.some((i) => { const d = game.item_def(i.id); return d.kind === 'weapon' && d.style === 'blade'; })) return 'You need a blade.';
  r.bitten = 0; r.hurt = Math.max(r.hurt, 4); r.morale = Math.max(0, r.morale - 10);
  return `It is quick and ugly. ${r.name} will live, and will not be the same.`;
}
function resident_mercy(game, r) {
  if (!r.bitten) return 'They are not bitten.';
  saga_lose_resident(game, r, 'let go before the fever took them');
  game.adjust_humanity(1, '');
  for (const o of game.saga.residents) o.morale = Math.max(0, o.morale - 5);
  return `${r.name} asks for a minute alone first. Then it is done, and the base is quieter.`;
}
