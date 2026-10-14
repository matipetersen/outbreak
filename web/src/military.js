// ---------------------------------------------------------------- soldiers at the roadside (mirror of engine/military.py)
const MIL_SIGHT = 7, MIL_SNEAK_SIGHT = 3, MIL_PASS_TURNS = 500, MIL_PATROL_EVERY = 300, MIL_CORRUPT_PCT = 38, MIL_SHOOT_ON_SIGHT = -50;
const MIL_BANNED = { medieval: ['crossbow'] };
const MIL_MEDS = ['medkit', 'suppressant', 'painkiller'];

function military_corrupt_of(uid) { return (uid * 7919) % 100 < MIL_CORRUPT_PCT; }

function military_register(game, cid, x, y) {
  if (!game.checkpoints[cid]) game.checkpoints[cid] = { id: cid, x, y, pass_until: 0, hostile: false };
  return game.checkpoints[cid];
}

function military_post_guards(game, lv, cp, n = 3, rng = null) {
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const spot = lv.free_spot_near(cp.x, cp.y, 3);
    if (!spot) continue;
    const h = make_patrol(game, 'soldier', spot[0], spot[1], 0);
    h.state = 'guard'; h.cp = cp.id; h.post = spot;
    lv.add_actor(h);
    placed++;
  }
  return placed;
}

function military_crew(game, h) {
  return game.level.actors.filter((a) => a.kind === 'human' && a.role === 'soldier' && a.hp > 0 &&
    ((h.cp && a.cp === h.cp) || (!h.cp && h.group && a.group === h.group)));
}

function military_turn_on(game, h) {
  const crew = military_crew(game, h);
  for (const a of (crew.length ? crew : [h])) {
    a.hostile = true; a.state = 'hunt'; a.target = apos(game.player);
    if (a.cp && game.checkpoints[a.cp]) game.checkpoints[a.cp].hostile = true;
  }
}

function military_rally(game, h) {
  if (h.role === 'soldier' && (h.cp || h.group)) military_turn_on(game, h);
}

function military_banned_ids(game) {
  const ids = new Set(MIL_BANNED[game.era.id] || []);
  for (const d of Object.values(game.items)) {
    if (game.era.firearms && (d.style === 'firearm' || (d.kind === 'ammo' && d.id !== 'arrow' && d.id !== 'shaft'))) ids.add(d.id);
    if (MIL_MEDS.includes(d.id) || d.kind === 'throw') ids.add(d.id);
  }
  return ids;
}

function military_contraband(game) {
  const p = game.player, ids = military_banned_ids(game);
  const found = p.inventory.filter((i) => ids.has(i.id) && !i.key);
  if (p.weapon && ids.has(p.weapon.id)) found.push(p.weapon);
  return found;
}

function military_leader(game, h) { const c = military_crew(game, h); return c.length ? c[0] : h; }

const MIL_MAX_TAKEN = 3;                            // a checkpoint takes the most valuable few stacks, not your whole kit

function military_seize(game, h, contra) {
  const p = game.player, lead = military_leader(game, h);
  contra = contra.slice().sort((a, b) => ((a === p.weapon) - (b === p.weapon)) || (game.item_def(b.id).value * b.qty - game.item_def(a.id).value * a.qty)).slice(0, MIL_MAX_TAKEN);
  const names = contra.map((i) => game.item_def(i.id).name.toLowerCase() + (i.qty > 1 ? ` x${i.qty}` : '')).join(', ');
  for (const it of contra) {
    if (p.weapon === it) p.weapon = null; else p.take(it.id, it.qty);
    lead.loot.push({ id: it.id, qty: it.qty, dur: it.dur === undefined ? null : it.dur, key: false });
  }
  return h.corrupt ? `He takes your ${names} and drops it into his own pack, looking past you. It will not be going into any evidence locker.`
                   : `A soldier bags your ${names} and stamps a slip you are not allowed to keep.`;
}

function military_finish(game, active, text) { active.result = text; active.resolved = true; game.msg(text, 'lore'); return text; }

function military_inspect(game, h, cid) {
  const p = game.player, rng = game.rng, cps = game.checkpoints;
  let cp = cps[cid];
  if (!cp) cp = cps[cid] = { id: cid, x: h.x, y: h.y, pass_until: 0, hostile: false };
  const contra = military_contraband(game);
  const sick = !!p.infected && rng.random() < 0.4;
  cp.pass_until = game.clock.turn + MIL_PASS_TURNS;
  const who = game.era.factions.military[0];
  if (!contra.length && !sick) {
    if (h.corrupt && rng.random() < 0.5) {
      const price = 3;
      const data = { kind: 'toll', contra: [], sick: false, price, uid: h.uid, cp: cid };
      const text = `A ${who} soldier steps into the road. 'Papers? Nobody has papers. Road tax, then: ${price} ${game.era.coin}.' He rubs two fingers together.`;
      game.pending_event = start_event(game, EVENT_BY_ID.mil_checkpoint, text, data);
      return;
    }
    game.msg(`A ${who} soldier looks through your pack and waves you on. 'Move along.'`, 'lore');
    return;
  }
  const price = 4 + 2 * contra.length + (sick ? 8 : 0);
  const data = { kind: 'search', contra: contra.map((i) => [i.id, i.qty]), sick, price, uid: h.uid, cp: cid };
  let text = `'Halt! ${cap(who)} checkpoint. Open your pack.' Three rifles cover the road.`;
  if (sick) text = `'Halt! ${cap(who)} checkpoint.' A soldier stares at your arm. 'Show me that. Slowly.'`;
  if (h.corrupt) text += ' The one in charge keeps glancing at your pockets.';
  game.pending_event = start_event(game, EVENT_BY_ID.mil_checkpoint, text, data);
}

function military_resolve(game, active, index) {
  const p = game.player, rng = game.rng, d = active.data;
  const h = game.level.actors.find((a) => a.kind === 'human' && a.uid === d.uid);
  if (!h) { active.result = 'The soldiers are gone.'; active.resolved = true; return active.result; }
  const { kind, sick, price } = d;
  const contra = military_contraband(game), mil = game.rep.military || 0;
  const done = (txt) => military_finish(game, active, txt);
  if (index === 3) {
    game.rep.military = Math.max(-100, mil - 40);
    military_turn_on(game, h);
    return done("You go for your weapon. 'Contact!' Every rifle on the road turns toward you.");
  }
  if (kind === 'toll') {
    if (index === 0) {
      if (p.coins < price) return 'You cannot afford that.';
      p.coins -= price;
      return done("He pockets the coins and nods, almost kindly. 'Safe travels.'");
    }
    const chance = index === 1 ? 0.5 : 0.3 + Math.max(0, p.humanity) / 250;
    if (rng.random() < chance) {
      if (index === 1 && p.coins >= Math.floor(price / 2)) { p.coins -= Math.floor(price / 2); return done('You haggle. He sighs and takes half.'); }
      return done("He looks at your face for a long moment. 'Go on.'");
    }
    p.coins = Math.max(0, p.coins - price);
    return done('He does not like the haggling. You pay full, and a little more besides.');
  }
  if (index === 0) {
    if (sick) { military_turn_on(game, h); return done("They find the bite. 'INFECTED!' The soldiers do not wait for you to explain."); }
    return done(military_seize(game, h, contra));
  }
  if (index === 1) {
    const cost = price * (sick ? 2 : 1);
    if (p.coins < cost) return 'You cannot afford that.';
    const accept = h.corrupt ? (sick ? 0.75 : 0.9) : (sick ? 0.0 : 0.15);
    p.coins -= cost;
    if (rng.random() < accept) {
      game.rep.military = Math.max(-100, mil - 2);
      return done("The coins vanish. 'Nothing in there I need to see.' He waves you through, eyes elsewhere.");
    }
    game.rep.military = Math.max(-100, mil - 10);
    if (sick) { military_turn_on(game, h); return done("'You think you can BUY your way past the sick?' The rifles come up."); }
    return done("'Bribing a soldier.' He keeps the coins and takes the rest too. " + military_seize(game, h, contra));
  }
  const chance = 0.22 + Math.max(0, p.humanity) / 220 + mil / 250 - (sick ? 0.15 : 0.0);
  if (rng.random() < chance) {
    p.gain_xp(5);
    return done('You keep your voice level and your hands open. After a long moment they let you go.');
  }
  if (sick) { military_turn_on(game, h); return done("'Sure you are fine.' The safety clicks off. They have seen this before."); }
  return done('It does not work. ' + military_seize(game, h, contra));
}

function military_tick(game) {
  if (game.pending_event || game.final || game.level !== game.world.level) return;
  const t = game.clock.turn, p = game.player;
  if (t % 2) return;
  const sight = p.sneaking ? MIL_SNEAK_SIGHT : MIL_SIGHT, mil = game.rep.military || 0, cps = game.checkpoints;
  for (const h of game.level.actors) {
    if (h.kind !== 'human' || h.role !== 'soldier' || h.hostile || h.hp <= 0 || h.stun > 0) continue;
    if (!(h.cp || (h.group && h.state === 'patrol'))) continue;
    const d = cheb(apos(h), apos(p));
    if (d > Math.max(sight, mil <= MIL_SHOOT_ON_SIGHT ? 9 : 0) || !has_los(game.level, apos(h), apos(p))) continue;
    if (mil <= MIL_SHOOT_ON_SIGHT) {
      game.msg(`The ${h.name.toLowerCase()} knows your face. 'That's the one!'`, 'bad', true);
      military_turn_on(game, h);
      return;
    }
    if (d > sight) continue;
    const cid = h.cp || -h.group;
    let cp = cps[cid];
    if (cp && (cp.hostile || t < cp.pass_until)) continue;
    if (!h.cp) {                                     // a roaming patrol: it does not stop everyone
      if (!cp) cp = cps[cid] = { id: cid, x: h.x, y: h.y, pass_until: 0, hostile: false };
      if (game.rng.random() < 0.5) { cp.pass_until = t + MIL_PATROL_EVERY; continue; }
    }
    military_inspect(game, h, cid);
    return;
  }
}
