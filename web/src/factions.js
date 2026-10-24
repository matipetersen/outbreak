// ---------------------------------------------------------------- the endless world: factions and their outposts (web only)
// Five factions per era (soldiers, civilians, raiders, a cult, the people looking for a cure). Each holds buildings as
// outposts, with a garrison on the ground floor and someone in charge. Once a day they grow or starve, move into empty
// buildings, fight their neighbours, and lose ground to the hordes. You meet it all in person: an outpost is a building
// where a voice behind a barricade tells you to stop, and what happens next depends on what they have heard about you.
const SAGA_FACTIONS = ['military', 'enclave', 'raiders', 'cult', 'science'];
const FACTION_START = { military: [60, 30], enclave: [50, 30], raiders: [45, 25], cult: [25, 20], science: [20, 20] };
const FACTION_GARRISON = { military: 4, enclave: 3, raiders: 4, cult: 3, science: 2 };
const FACTION_PREFS = { military: ['military', 'guard'], science: ['lab', 'medical'], cult: ['faith'], raiders: ['industry', 'transit', 'market'],
                        enclave: ['market', 'medical', 'faith', 'transit', 'guard'] };
const OUTPOST_KINDS = ['medical', 'market', 'guard', 'lab', 'transit', 'military', 'faith', 'industry'];
const OUTPOST_MAX_GARRISON = 6, OUTPOST_SHOWN = 5, OUTPOST_REACH = 55, SKIRMISH_RANGE = 45;
const FACTION_SUP_CAP = 60, FACTION_GROW_AT = 30, FACTION_MAX_OUTPOSTS = 6, SKIRMISHES_PER_DAY = 2;
const GUARD_NAMES = {
  enclave: { medieval: 'Watchman', eighties: 'Sentry', modern: 'Sentry', scifi: 'Deck warden' },
  cult: { medieval: 'Flagellant', eighties: 'Child of the Dawn', modern: 'Reborn', scifi: 'Acolyte' },
  science: { medieval: 'Physician\'s guard', eighties: 'Lab guard', modern: 'Lab guard', scifi: 'Lab security' },
};
const WARDEN_WORD = { military: 'commander', enclave: 'elder', raiders: 'boss', cult: 'prophet', science: 'director' };

const faction_name = (game, f) => game.era.factions[f][0];
function outpost_of(game, poi_id) { return game.saga && game.saga.outposts[poi_id] || null; }
function outpost_of_level(game, lv) {
  if (!game.saga || !lv.poi_id || !lv.id.endsWith(':0')) return null;
  return outpost_of(game, lv.poi_id);
}
const outposts_of = (game, f) => Object.values(game.saga.outposts).filter((o) => o.owner === f);

// Who fights whom. Raiders fight everyone; the rest pick their quarrels as the world gets worse.
function faction_hostile(game, a, b) {
  if (!a || !b || a === b) return false;
  if (a === 'raiders' || b === 'raiders') return true;
  const S = game.saga, pair = [a, b].sort().join('|'), ph = saga_phase_index(game);
  if (S && S.events.some((e) => e.id === 'war' && e.started && [e.data.a, e.data.b].sort().join('|') === pair)) return true;
  if (pair === 'cult|military' || pair === 'cult|science') return true;
  if (pair === 'military|science') return ph >= 2;
  if (pair === 'cult|enclave') return ph >= 3;
  return false;
}

// What a faction thinks of you: ally, friendly, wary or hostile.
function faction_attitude(game, f) {
  const r = game.rep[f] || 0;
  if (f === 'raiders') return r >= 25 ? 'friendly' : r >= 10 ? 'wary' : 'hostile';
  if (r <= -30) return 'hostile';
  if (r >= 30) return 'ally';
  if (r >= 10) return 'friendly';
  return 'wary';
}

// ---- the world at the start: a handful of buildings already held by someone
function factions_setup(game) {
  const S = game.saga, rng = game.rng, start = game.world.start;
  for (const f of SAGA_FACTIONS) S.factions[f] = { str: FACTION_START[f][0], sup: FACTION_START[f][1] };
  const pool = Object.values(game.pois).filter((q) => OUTPOST_KINDS.includes(q.kind) && !q.component && cheb(poi_pos(q), start) >= 25);
  const want = Math.max(5, Math.min(12, Math.round(pool.length / 5)));
  S.outpost_cap = Math.max(want + 3, Math.min(24, Math.round(pool.length / 6)));
  const take = (f, prefs) => {
    const near = pool.filter((q) => !S.outposts[q.id] && (!prefs || prefs.includes(q.kind)));
    if (!near.length) return false;
    const q = rng.choice(near);
    outpost_found(game, q, f, FACTION_GARRISON[f]);
    return true;
  };
  for (const f of ['science', 'cult', 'military', 'raiders', 'enclave']) if (!take(f, FACTION_PREFS[f])) take(f, null);
  const weights = [['enclave', 3], ['military', 2], ['raiders', 2], ['cult', 1], ['science', 1]];
  while (Object.keys(S.outposts).length < want) {
    const f = weighted_choice(rng, weights);
    if (!take(f, rng.random() < 0.7 ? FACTION_PREFS[f] : null) && !take(f, null)) break;
  }
}

function outpost_found(game, poi, owner, garrison) {
  const S = game.saga;
  const o = S.outposts[poi.id] || { id: poi.id, owner: null, garrison: 0, admitted: false, hostile: false, siege_until: 0, siege_spawned: false,
                                    sick_until: 0, recruit_ready: 0, warlord: false, overrun: false, overrun_done: false, cleared: '', helped: 0 };
  Object.assign(o, { owner, garrison, admitted: false, hostile: false, overrun: false, overrun_done: false });
  S.outposts[poi.id] = o;
  poi.burned = false;
  return o;
}

// ---- a day in the life of the factions
function factions_daily(game, report) {
  const S = game.saga, rng = game.rng, ph = saga_phase_index(game);
  for (const f of SAGA_FACTIONS) {                                       // supplies in, mouths to feed out; the later it gets, the less comes in
    const fs = S.factions[f];
    if (fs.str <= 0) continue;
    const owned = outposts_of(game, f);
    fs.sup += Math.round(owned.length * (f === 'raiders' ? 2 : 3) * (1 - 0.1 * ph)) + (f === 'raiders' ? 1 : 0) - Math.ceil(fs.str / 25) - Math.floor(owned.length / 3);      // raiders take, they do not grow
    fs.str = Math.max(0, fs.str - Math.max(0, ph - 2));                // the winter and the end of days wear everyone down
    if (fs.sup < 0) { fs.sup = 0; fs.str = Math.max(0, fs.str - 6); }
    else if (fs.sup >= FACTION_GROW_AT) {
      fs.sup -= 15; fs.str = Math.min(100, fs.str + 5);
      const weak = owned.filter((o) => o.garrison < OUTPOST_MAX_GARRISON).sort((a, b) => a.garrison - b.garrison)[0];
      if (weak) weak.garrison += 1;
    }
    fs.sup = Math.min(FACTION_SUP_CAP, fs.sup);
    if (!owned.length) fs.str = Math.max(0, fs.str - 5);
    if (fs.str <= 0) report.push([`${faction_name(game, f)} are finished. Nobody has seen one of them in days.`, null]);
  }
  const held = Object.values(S.outposts).filter((o) => o.owner).length, room = held < S.outpost_cap;
  for (const f of SAGA_FACTIONS) {                                       // moving into empty buildings
    const fs = S.factions[f], owned = outposts_of(game, f);
    if (!room || fs.str < 40 || fs.sup < 20 || owned.length >= FACTION_MAX_OUTPOSTS || rng.random() >= (f === 'raiders' ? 0.25 : 0.2)) continue;
    if (!owned.length) continue;
    const free = Object.values(game.pois).filter((q) => OUTPOST_KINDS.includes(q.kind) && !q.component && q.id !== (game.base_id || '').split(':')[0] &&
      (!S.outposts[q.id] || !S.outposts[q.id].owner) && owned.some((o) => cheb(poi_pos(game.pois[o.id]), poi_pos(q)) <= OUTPOST_REACH));
    if (!free.length) continue;
    const q = rng.choice(free);
    fs.sup -= 12;
    outpost_found(game, q, f, 2);
    report.push([`${faction_name(game, f)} have moved into ${q.name}.`, q.id]);
    break;
  }
  const list = Object.values(S.outposts).filter((o) => o.owner && o.garrison > 0), fought = new Set();
  let fights = SKIRMISHES_PER_DAY + (S.events.some((e) => e.id === 'war' && e.started) ? 2 : 0) + (S.warlord && !S.warlord.dead ? 1 : 0);
  rng.shuffle(list);
  for (const a of list) {                                                // neighbours who hate each other
    if (fought.has(a.id) || fights <= 0) continue;
    for (const b of list) {
      if (a === b || fought.has(b.id) || !faction_hostile(game, a.owner, b.owner)) continue;
      if (cheb(poi_pos(game.pois[a.id]), poi_pos(game.pois[b.id])) > SKIRMISH_RANGE) continue;
      let chance = 0.08;
      if (S.events.some((e) => e.id === 'war' && e.started && [e.data.a, e.data.b].includes(a.owner) && [e.data.a, e.data.b].includes(b.owner))) chance += 0.45;
      if (S.warlord && !S.warlord.dead && (a.owner === 'raiders' || b.owner === 'raiders')) chance += 0.15;
      if (rng.random() >= chance) continue;
      fought.add(a.id); fought.add(b.id); fights--;
      skirmish(game, rng.random() < 0.5 ? a : b, rng.random() < 0.5 ? b : a, report);
      break;
    }
  }
  for (const h of game.hordes) {                                         // the hordes do not care whose building it is
    if (h.size < 8) continue;
    for (const o of Object.values(S.outposts)) {
      if (!o.owner || o.garrison <= 0 || cheb([h.x, h.y], poi_pos(game.pois[o.id])) > 7) continue;
      h.hit = h.hit || [];
      if (h.hit.includes(o.id)) continue;                                // a horde batters each place once, then moves on
      h.hit.push(o.id);
      o.garrison -= 1;
      if (o.garrison <= 0) outpost_fall(game, o, null, report);
      else report.push([`A horde battered ${game.pois[o.id].name}; ${faction_name(game, o.owner)} held it, barely.`, o.id]);
    }
  }
}

function skirmish(game, att, def, report) {
  if (att === def) return;
  const S = game.saga, rng = game.rng, A = S.factions[att.owner], D = S.factions[def.owner];
  const a = att.garrison + A.str / 40 + rng.uniform(0, 3), d = def.garrison + D.str / 40 + 1 + rng.uniform(0, 3);
  const [win, lose] = a > d ? [att, def] : [def, att];
  lose.garrison -= rng.randint(1, 2);
  if (rng.random() < 0.35) win.garrison -= 1;
  report.push([`${faction_name(game, att.owner)} and ${faction_name(game, def.owner)} fought over ${game.pois[def.id].name}.`, def.id]);
  for (const o of [lose, win]) if (o.owner && o.garrison <= 0) outpost_fall(game, o, o === lose ? win.owner : null, report);
}

// An outpost changes hands, or the dead take it.
function outpost_fall(game, o, by, report) {
  const S = game.saga, poi = game.pois[o.id], old = o.owner;
  if (old) S.factions[old].str = Math.max(0, S.factions[old].str - 8);
  if (o.warlord && S.warlord && !S.warlord.dead) { S.warlord.fled = true; o.warlord = false; }
  if (by && ['raiders', 'military', 'cult'].includes(by) && S.factions[by].str > 20 && outposts_of(game, by).length < FACTION_MAX_OUTPOSTS + 2) {
    outpost_found(game, poi, by, 2);
    report.push([`${faction_name(game, by)} took ${poi.name}` + (old ? ` from ${faction_name(game, old)}.` : '.'), poi.id]);
  } else if (by && old === 'raiders') {                                  // a den cleared out: empty, for whoever wants it
    o.owner = null; o.garrison = 0; o.siege_until = 0;
    report.push([`${faction_name(game, by)} cleared the raiders out of ${poi.name}. It stands empty.`, poi.id]);
  } else {
    o.owner = null; o.garrison = 0; o.overrun = true; o.overrun_done = false; o.siege_until = 0;
    report.push([`${poi.name} has fallen` + (old ? ` (${faction_name(game, old)})` : '') + '. The dead hold it now.', poi.id]);
  }
}

// ---- the building itself: who stands on the ground floor
function _outpost_spots(lv) {
  const out = [];
  for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) {
    if (lv.tile(x, y) !== T.FLOOR || lv.portals[lv.idx(x, y)]) continue;
    const d = cheb([x, y], lv.entry);
    if (d >= 3 && d <= 14) out.push([d, x, y]);
  }
  out.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  return out.map((e) => [e[1], e[2]]);
}

function _outpost_person(game, o, role, x, y) {
  const era = game.era, f = o.owner;
  let h;
  if (f === 'raiders') { h = make_raider(game, x, y); h.state = 'idle'; }
  else {
    h = make_patrol(game, f === 'military' ? 'soldier' : 'scout', x, y, 0);
    h.faction = f; h.state = 'guard'; h.post = [x, y];
    if (f !== 'military') h.name = GUARD_NAMES[f][era.id];
  }
  h.outpost = o.id;
  if (role === 'warden') {
    h.role = 'warden'; h.glyph = 'W'; h.state = 'idle'; h.post = null; h.hp = h.max_hp = h.max_hp + 10;
    h.name = cap(WARDEN_WORD[f]);
  }
  return h;
}

function outpost_sync(game, lv) {
  const o = outpost_of_level(game, lv);
  if (!o) return;
  if (game.base_id === lv.id) { o.overrun = false; o.owner = null; o.garrison = 0; return; }    // you cleared it and made it yours
  for (const a of lv.actors.slice()) if (a.kind === 'human' && a.outpost === o.id && (a.faction !== o.owner || !o.owner || o.overrun)) lv.remove_actor(a);
  if (o.overrun) {
    if (!o.overrun_done) {
      o.overrun_done = true;
      const spots = _outpost_spots(lv);
      for (let i = 0; i < Math.min(spots.length, 5 + saga_phase_index(game)); i++) if (lv.free(spots[i][0], spots[i][1])) spawn_zombie(game, lv, spots[i], null, true);
    }
    lv.safe = false;
    return;
  }
  if (!o.owner) return;
  if (o.cleared !== o.owner) {                                           // a new owner cleared the ground floor
    o.cleared = o.owner;
    for (const z of lv.actors.filter((a) => a.kind === 'zombie')) lv.remove_actor(z);
  }
  const spots = _outpost_spots(lv).filter((s) => !lv.occ.has(lv.idx(s[0], s[1])));
  const people = lv.actors.filter((a) => a.kind === 'human' && a.outpost === o.id && a.hp > 0);
  const guards = people.filter((a) => a.role !== 'warden' && !a.warlord);
  let warden = people.find((a) => a.role === 'warden');
  const want = Math.min(OUTPOST_SHOWN, Math.max(0, o.garrison));
  while (guards.length > want) lv.remove_actor(guards.pop());
  while (guards.length < want && spots.length) { const s = spots.shift(); const h = _outpost_person(game, o, 'guard', s[0], s[1]); lv.add_actor(h); guards.push(h); }
  if (!warden && o.garrison > 0 && spots.length) { const s = spots.pop(); warden = _outpost_person(game, o, 'warden', s[0], s[1]); lv.add_actor(warden); }
  if (o.warlord && game.saga.warlord && !game.saga.warlord.dead && !people.some((a) => a.warlord) && spots.length) {
    const s = spots.pop(), w = make_raider(game, s[0], s[1]);
    Object.assign(w, { name: game.saga.warlord.name, glyph: 'K', warlord: true, outpost: o.id, hp: 90, max_hp: 90, dmg: [6, 11], acc: 62, morale: 1000, title: 'Warlord' });
    lv.add_actor(w); game.saga.warlord.spawned = true;
  }
  const hostile = o.hostile || faction_attitude(game, o.owner) === 'hostile';
  for (const a of lv.actors) {
    if (a.kind !== 'human' || a.outpost !== o.id) continue;
    a.hostile = hostile;
    if (hostile && a.state === 'guard' && a.faction !== 'raiders') { a.state = 'idle'; a.post = null; }
  }
  lv.safe = !hostile && !hostiles_in(lv).length;
}

// Stepping in: the outpost reacts to you once you are inside the door.
function outpost_on_enter(game, lv) {
  const o = outpost_of_level(game, lv);
  if (!o) return;
  outpost_sync(game, lv);
  const poi = game.pois[o.id];
  if (o.overrun) { if (!o.seen_overrun) { o.seen_overrun = true; game.msg(`${poi.name} is a ruin of barricades and bodies. Whoever held it is gone, and the dead are still here.`, 'warn', true); } return; }
  if (!o.owner) return;
  const att = faction_attitude(game, o.owner), name = faction_name(game, o.owner);
  if (o.hostile || att === 'hostile') {
    game.msg(o.owner === 'raiders' ? `A raider den. Somebody shouts, and every head in the room turns to you.` : `"That's the one. Drop them!" ${name} hold this place, and they know your face.`, 'bad', true);
    return;
  }
  if (o.admitted || att === 'ally' || att === 'friendly') {
    if (!o.admitted) game.msg(`A barricade, rifles, a face you do not know who knows yours. "${name}. You're all right. Come in."`, 'good', true);
    o.admitted = true;
    return;
  }
  game.pending_event = saga_choice_event(game, {
    kind: 'gate', title: poi.name, id: o.id,
    text: `"Not one more step." Behind a wall of desks and wire, ${name} hold the ground floor of ${poi.name}. ${o.garrison} of them that you can see, and none of them lowering anything. "Who are you, and what do you want?"`,
    choices: [
      { label: 'Talk your way in', needs: {} },
      { label: `Pay for the right to enter (${outpost_toll(game, o)} {coin})`, needs: { coins: outpost_toll(game, o) } },
      { label: 'Offer them food', needs: { items: { food: 1 } } },
      { label: 'Back out slowly', needs: {} },
      { label: 'Force your way in', needs: {} },
    ],
  });
}

const outpost_toll = (game, o) => (o.owner === 'raiders' ? 8 : 4) + saga_phase_index(game) * 2;

function outpost_gate(game, data, index) {
  const o = game.saga.outposts[data.id], name = faction_name(game, o.owner), p = game.player, lv = game.level;
  if (index === 0) {
    const chance = 0.25 + p.humanity / 200 + Math.max(0, game.rep[o.owner] || 0) / 60;
    if (game.rng.random() < chance) { o.admitted = true; game.rep[o.owner] = (game.rep[o.owner] || 0) + 2; return `They hear you out. A long look, then the wire is pulled aside. "Mind your manners in here."`; }
    outpost_eject(game);
    return '"No." The barrel tells you the rest. You are back outside before you have finished your sentence.';
  }
  if (index === 1) {
    p.coins -= outpost_toll(game, o); o.admitted = true; game.rep[o.owner] = (game.rep[o.owner] || 0) + 3;
    return `The coins disappear. "Fair's fair. Come in, and keep your hands where we can see them."`;
  }
  if (index === 2) {
    p.take('food', 1); o.admitted = true; game.rep[o.owner] = (game.rep[o.owner] || 0) + 6; game.saga.factions[o.owner].sup += 2;
    game.adjust_humanity(1, '');
    return 'Somebody takes it with both hands. The wire comes aside. "We will remember that."';
  }
  if (index === 3) { outpost_eject(game); return 'You back out the way you came, slowly, and nobody fires.'; }
  o.hostile = true;
  game.rep[o.owner] = (game.rep[o.owner] || 0) - 25;
  for (const a of lv.actors) if (a.kind === 'human' && a.outpost === o.id) { a.hostile = true; if (a.state === 'guard') { a.state = 'idle'; a.post = null; } }
  lv.safe = false;
  return `You go for the barricade. ${name} open fire.`;
}

// Shown the door: back through the entrance you came in by.
function outpost_eject(game) {
  const lv = game.level, k = Object.keys(lv.portals).find((kk) => lv.portals[kk].target === 'world');
  if (k !== undefined) game._use_portal(Number(k) % lv.w, Math.floor(Number(k) / lv.w));
}

// The whole garrison of a building you assaulted is dead: it is empty, and could be yours.
function outpost_check_taken(game) {
  const o = outpost_of_level(game, game.level);
  if (!o || !o.owner || o.garrison <= 0) return;
  const lv = game.level, people = lv.actors.filter((a) => a.kind === 'human' && a.outpost === o.id && a.hp > 0);
  if (people.length) return;
  if (!o.hostile && faction_attitude(game, o.owner) !== 'hostile') return;
  const name = faction_name(game, o.owner);
  game.saga.factions[o.owner].str = Math.max(0, game.saga.factions[o.owner].str - 12);
  o.owner = null; o.garrison = 0; o.hostile = false;
  game.player.gain_xp(40);
  game.msg(`The last of ${name} in here is down. ${game.pois[o.id].name} is empty now. You could make it yours.`, 'good', true);
}

// ---- what the one in charge can do for you
function outpost_recruit(game, npc) {
  const o = game.saga.outposts[npc.outpost], att = faction_attitude(game, o.owner), S = game.saga;
  if (att !== 'friendly' && att !== 'ally') return '"You want our people? Earn it first."';
  if (o.garrison < 3) return '"We are barely holding this place as it is. Nobody can go."';
  if (game.clock.turn < o.recruit_ready) return '"Not again so soon. Ask me in a few days."';
  const base = saga_base_level(game);
  if (base && S.residents.length < saga_capacity(game)) {
    o.garrison -= 1; o.recruit_ready = game.clock.turn + 240 * 3;
    const r = saga_add_resident(game, null, o.owner);
    return `${r.name} steps forward, already packing. "I hear you have walls and a roof. I can pull my weight." They will make their own way to your base.`;
  }
  if (!comp_current(game)) {
    o.garrison -= 1; o.recruit_ready = game.clock.turn + 240 * 3;
    const spot = game.level.free_spot_near(game.player.x, game.player.y, 3);
    if (!spot) return '"There is no room to move in here. Ask me outside."';
    const h = comp_stranger(game, spot); h.faction = o.owner === 'raiders' ? 'enclave' : o.owner; h.level_id = game.level.id;
    game.level.add_actor(h);
    saga_recruit_here(game, h, 20);
    return `${h.name} shoulders a pack. "Better out there with you than waiting in here for it."`;
  }
  return base ? '"Your place is full. Make room, then ask."' : '"Go where? You do not even have a roof. Find somewhere to hold, or travel light."';
}

function outpost_help(game, npc) {
  const o = game.saga.outposts[npc.outpost], p = game.player, S = game.saga;
  if (o.sick_until > game.clock.turn) {
    const meds = ['medkit', 'bandage', 'painkiller', 'herbs'].filter((i) => game.items[i] && p.count(i) > 0);
    const have = meds.reduce((s, i) => s + p.count(i), 0);
    if (have < 2) return '"Fever, and it is not the bite. We need medicine: anything, two of anything. Please."';
    let left = 2;
    for (const i of meds) { const n = Math.min(left, p.count(i)); p.take(i, n); left -= n; if (!left) break; }
    o.sick_until = 0; o.garrison = Math.min(OUTPOST_MAX_GARRISON, o.garrison + 1);
    game.rep[o.owner] = (game.rep[o.owner] || 0) + 20; game.adjust_humanity(4, ''); p.gain_xp(30);
    return '"You came back." They take it like it is gold. By morning the fever has broken in half of them.';
  }
  if (p.count('food') < 2) return `"Food. Always food. Bring two rations and ${faction_name(game, o.owner)} will not forget it."`;
  p.take('food', 2);
  o.helped += 1; o.garrison = Math.min(OUTPOST_MAX_GARRISON, o.garrison + 1); S.factions[o.owner].sup += 6;
  game.rep[o.owner] = (game.rep[o.owner] || 0) + 6;
  return '"That feeds us for a day." They mean it. Word of it will get around.';
}

function outpost_lines(game, o) {
  const poi = game.pois[o.id], bits = [];
  if (o.overrun) return `${poi.name}: overrun, the dead hold it`;
  if (!o.owner) return `${poi.name}: empty`;
  bits.push(`${poi.name}: ${faction_name(game, o.owner)}, ${o.garrison} strong, ${faction_attitude(game, o.owner)}`);
  if (o.siege_until > game.clock.turn) bits.push('under siege');
  if (o.sick_until > game.clock.turn) bits.push('fever inside');
  if (o.warlord) bits.push('the warlord\'s seat');
  return bits.join(' · ');
}

// You turned on one of them: the whole building turns on you.
function outpost_turn(game, poi_id) {
  const o = game.saga.outposts[poi_id];
  if (!o || o.hostile) return;
  o.hostile = true; o.admitted = false;
  const lv = game.levels[poi_id + ':0'];
  if (!lv) return;
  for (const a of lv.actors) if (a.kind === 'human' && a.outpost === poi_id && !a.hostile) { a.hostile = true; if (a.state === 'guard') { a.state = 'idle'; a.post = null; } }
  lv.safe = false;
}
