// ---------------------------------------------------------------- item handling (each returns the turns it cost)
const SLOT_OF_KIND = { weapon: 'weapon', armor: 'armor', light: 'light' };

function equip(game, index) {
  const p = game.player;
  if (!(index >= 0 && index < p.inventory.length)) return 0;
  const item = p.inventory[index], d = game.item_def(item.id), slot = SLOT_OF_KIND[d.kind];
  if (!slot) return 0;
  p.inventory.splice(index, 1);
  const old = p[slot];
  p[slot] = item;
  if (old) p.inventory.push(old);
  game.msg(`You equip the ${d.name.toLowerCase()}.`, 'info');
  return 1;
}

function unequip(game, slot) {
  const p = game.player, item = p[slot];
  if (!item) return 0;
  const d = game.item_def(item.id);
  if (!p.can_hold(item, d.stackable)) { game.msg('Your pack is full.', 'warn'); return 0; }
  p[slot] = null;
  p.add_item(item, d.stackable);
  game.msg(`You put away the ${d.name.toLowerCase()}.`, 'info');
  return 1;
}

function drop_item(game, index, qty = 0) {
  const p = game.player;
  if (!(index >= 0 && index < p.inventory.length)) return 0;
  const item = p.inventory[index];
  const n = qty <= 0 ? item.qty : Math.min(qty, item.qty);
  game.level.drop([p.x, p.y], make_item(item.id, n, item.dur));
  item.qty -= n;
  if (item.qty <= 0) p.inventory.splice(index, 1);
  game.msg(`You drop the ${game.item_def(item.id).name.toLowerCase()}.`, 'info');
  return 1;
}

function use_item(game, index) {
  const p = game.player;
  if (!(index >= 0 && index < p.inventory.length)) return 0;
  const item = p.inventory[index], d = game.item_def(item.id), eff = d.effect;
  if (SLOT_OF_KIND[d.kind]) return equip(game, index);
  if (d.kind === 'food') { sfx(game, 'eat'); return _eat(game, item, d); }
  if (d.kind === 'med') { sfx(game, 'heal'); return _medicate(game, item, d); }
  if (d.kind === 'material' && 'refuel' in eff) return _refuel(game, item, d);
  if (d.kind === 'tool' && 'repair' in eff) return _repair(game, item, d);
  if (d.kind === 'tool' && 'barricade' in eff) return _barricade(game, item, d);
  if (d.kind === 'tool' && 'trap' in eff) return _set_trap(game, item, d);
  if (d.kind === 'tool' && 'fish' in eff) { game.msg('Stand beside water and use the gather key to fish.', 'info'); return 0; }
  if (d.kind === 'throw') { game.msg('Use THROW from the actions menu and pick a target.', 'warn'); return 0; }
  game.msg(`You cannot use the ${d.name.toLowerCase()} like that.`, 'warn');
  return 0;
}

function _consume(game, item) {
  item.qty -= 1;
  if (item.qty <= 0) game.player.inventory.splice(game.player.inventory.indexOf(item), 1);
}

function _eat(game, item, d) {
  const p = game.player;
  p.hunger = Math.max(0, p.hunger - (d.effect.food || 30));
  _consume(game, item);
  game.msg(`You eat the ${d.name.toLowerCase()}.`, 'info');
  if (d.effect.sick && game.rng.random() < d.effect.sick) {
    p.hp = Math.max(1, p.hp - 4); p.hunger = Math.min(100, p.hunger + 12); game.add_panic(6, true);
    game.msg('Your stomach cramps and you bring half of it back up. Cook it next time.', 'warn');
  }
  return 2;
}

function _medicate(game, item, d) {
  const p = game.player, eff = d.effect;
  if ('suppress' in eff && !p.infected) { game.msg('You are not infected: it would be wasted.', 'warn'); return 0; }
  if ('splint' in eff && !p.fracture) { game.msg('Nothing is broken.', 'warn'); return 0; }
  if ('stop_bleed' in eff && !p.bleeding && p.hp >= p.max_hp && 'heal' in eff && Object.keys(eff).length === 2) {
    game.msg('You are not hurt.', 'warn'); return 0;
  }
  if ('heal' in eff) p.hp = Math.min(p.max_hp, p.hp + Math.floor(eff.heal * (1.0 + p.mod('heal_mult'))));
  if (eff.stop_bleed) {
    if (p.hemorrhage && (eff.heal || 0) < 20) p.bleeding = Math.max(0, p.bleeding - 2);      // a bandage only slows a fresh stump; a medkit closes it
    else p.bleeding = 0;
    if (!p.bleeding) p.hemorrhage = false;
  }
  if (eff.splint) p.fracture = false;
  if ('suppress' in eff) { p.infection_timer += Math.floor(eff.suppress); game.msg('The suppressant steadies your blood. The infection slows.', 'good'); }
  if ('panic' in eff) game.add_panic(eff.panic, true);
  if ('filter' in eff) { p.filter_turns = Math.max(p.filter_turns, Math.floor(eff.filter)); game.msg('You fit the filter. Spores will not reach your lungs for a while.', 'info'); }
  _consume(game, item);
  game.msg(`You use the ${d.name.toLowerCase()}.`, 'info');
  return 2;
}

function _refuel(game, item, d) {
  const p = game.player;
  if (!p.light) { game.msg('You have no light to refuel.', 'warn'); return 0; }
  const ld = game.item_def(p.light.id);
  p.light.dur = Math.min(ld.durability, (p.light.dur || 0) + Math.floor(d.effect.refuel));
  _consume(game, item);
  game.msg(`You top up your ${ld.name.toLowerCase()}.`, 'info');
  return 1;
}

function _repair(game, item, d) {
  const p = game.player;
  const target = (p.weapon && game.item_def(p.weapon.id).durability) ? p.weapon : (p.armor || null);
  if (!target) { game.msg('Nothing equipped needs repairs.', 'warn'); return 0; }
  const td = game.item_def(target.id);
  if ((target.dur || 0) >= td.durability) { game.msg('It is already in good shape.', 'warn'); return 0; }
  target.dur = Math.min(td.durability, (target.dur || 0) + Math.floor(d.effect.repair));
  _consume(game, item);
  game.msg(`You repair your ${td.name.toLowerCase()}.`, 'good');
  return 4;
}

function door_adjacent(game) {
  const p = game.player, lv = game.level;
  for (const [dx, dy] of DIRS4) {
    const t = lv.tile(p.x + dx, p.y + dy);
    if (t === T.DOOR || t === T.DOOR_OPEN) return [p.x + dx, p.y + dy];
  }
  return null;
}

function _set_trap(game, item, d) {
  const lv = game.level, p = game.player, k = lv.idx(p.x, p.y), t = lv.tile(p.x, p.y);
  if (lv.hazards[k] || t === T.DOOR || t === T.DOOR_OPEN || t === T.PORTAL) { game.msg('Not here: you need clear floor.', 'warn'); return 0; }
  lv.hazards[k] = { kind: 'spikes', ttl: 1e9, power: Math.floor(d.effect.trap) };
  _consume(game, item);
  game.msg('You set the trap and step carefully off it. The dead will not see it.', 'good');
  return 2;
}

function _barricade(game, item, d) {
  const pos = door_adjacent(game);
  if (!pos) { game.msg('There is no door next to you.', 'warn'); return 0; }
  const lv = game.level, k = lv.idx(pos[0], pos[1]);
  if (lv.tile(pos[0], pos[1]) === T.DOOR_OPEN) {
    if (lv.occ.get(k)) { game.msg('Something is in the doorway.', 'warn'); return 0; }
    lv.set_tile(pos[0], pos[1], T.DOOR);
  }
  lv.door_hp[k] = Math.floor(d.effect.barricade);
  _consume(game, item);
  game.msg('You wedge the door shut with everything you have.', 'good');
  game.emit_noise([game.player.x, game.player.y], 4, 'player');
  return 3;
}

function recipe_output(game, r) {
  if (r.out === '@ammo') return game.era.items[game.era.defaults.ranged].ammo || null;
  return game.items[r.out] ? r.out : null;
}

function recipe_status(game, r) {
  const out = recipe_output(game, r);
  if (!out) return [false, 'not possible in this era'];
  if (r.needs === 'firearms' && !game.era.firearms) return [false, 'needs firearms'];
  if (r.needs === 'electricity' && !game.era.electricity) return [false, 'needs electricity'];
  if (r.needs === 'workshop' && !game.adjacent_tile(T.WORKSHOP)) return [false, 'stand beside a workshop (build one in your base)'];
  if (!(game.player.recipes || []).includes(r.id)) return [false, 'you do not know how: find and decipher a manual'];
  if (game.know.fluency < r.fluency) return [false, `needs ${Math.floor(r.fluency * 100)}% fluency in the ${game.era.cipher_name.toLowerCase()}`];
  const missing = r.inputs.filter(([i, q]) => game.player.count(i) < q).map(([i, q]) => `${q}x ${game.item_def(i).name.toLowerCase()}`);
  if (missing.length) return [false, 'missing ' + missing.join(', ')];
  return [true, ''];
}

function craft_item(game, recipe_id) {
  const r = CONTENT.recipes.find((x) => x.id === recipe_id);
  if (!r) return 0;
  const [ok, reason] = recipe_status(game, r);
  if (!ok) { game.msg(`You cannot craft that: ${reason}.`, 'warn'); return 0; }
  const p = game.player;
  for (const [item_id, qty] of r.inputs) for (let i = 0; i < qty; i++) if (game.rng.random() >= p.mod('craft_save')) p.take(item_id, 1);
  const out = recipe_output(game, r);
  game.give_item(make_item(out, r.qty));
  p.gain_xp(2);
  game.msg(`You craft ${r.qty}x ${game.item_def(out).name.toLowerCase()}.`, 'good');
  return r.turns;
}

function pickup_here(game) {
  const p = game.player, lv = game.level, k = lv.idx(p.x, p.y);
  const stack = lv.items[k];
  const docs = lv.docs[k] || [];
  delete lv.docs[k];
  for (const doc_id of docs) game.collect_document(doc_id);
  if (!stack) return docs.length ? 1 : 0;
  let taken = false;
  for (const item of stack.slice()) {
    const d = game.item_def(item.id);
    if (p.add_item(make_item(item.id, item.qty, item.dur), d.stackable)) {
      stack.splice(stack.indexOf(item), 1);
      taken = true; sfx(game, 'pickup');
      game.msg(d.stackable ? `You pick up ${item.qty}x ${d.name.toLowerCase()}.` : `You pick up the ${d.name.toLowerCase()}.`, 'info');
    } else { game.msg('Your pack is full.', 'warn'); break; }
  }
  if (!stack.length) delete lv.items[k];
  return taken || docs.length ? 1 : 0;
}

function search_container(game, pos) {
  const lv = game.level, p = game.player, k = lv.idx(pos[0], pos[1]), c = lv.containers[k];
  if (!c) return 0;
  if (c.opened) { game.msg('It is empty.', 'info'); return 0; }
  c.opened = true;
  lv.set_tile(pos[0], pos[1], T.CRATE_OPEN);
  game.emit_noise([p.x, p.y], 3, 'player');
  const found = [];
  const bonus = game.rng.random() < p.mod('loot') ? roll_items(game.rng, game.era, game.poi_kind_of(lv), 1.0, 1.0) : [];
  for (const item of c.loot.concat(bonus)) {
    const d = game.item_def(item.id);
    if (p.add_item(make_item(item.id, item.qty, item.dur), d.stackable)) found.push(d.name.toLowerCase());
    else { lv.drop([p.x, p.y], item); found.push(`${d.name.toLowerCase()} (left at your feet)`); }
  }
  if (c.coins) { p.coins += c.coins; found.push(`${c.coins} ${game.era.coin}`); }
  if (c.note === 'vault') {
    const comp = game.vault_component(lv);
    if (comp && game.taken_components.includes(comp)) game.msg('The vault is empty. Somebody got here first.', 'warn');
    else if (comp) {
      game.give_item(make_item(comp, 1)); game.msg(`You found the ${game.item_def(comp).name}!`, 'good'); p.gain_xp(40);
      if (game.shared) { game.taken_components.push(comp); game.shared.on_component_taken(comp); }
    }
  }
  for (const doc_id of c.docs) game.collect_document(doc_id);
  game.msg(found.length ? 'You search the crate: ' + found.join(', ') + '.' : 'You search the crate. Nothing useful.', 'info');
  return 2;
}
