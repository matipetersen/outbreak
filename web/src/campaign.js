// ---------------------------------------------------------------- campaign: Zona Norte (web only)
// A campaign over the northern suburbs of Buenos Aires, 2026. You start with a company holding one barrio (Florida, in
// Vicente López) and grow from there. Every day you pick one operation on the map: clear a district of the dead, assault a
// faction's district, rescue survivors, defend a district under threat. Operations are fought as battles (battle.js) with
// your own company, whose losses stay lost. Every night the map moves: your districts produce supplies and recruits, the
// dead spread, the factions expand and come for you, and something happens that asks you to decide. What you decide
// changes the map. The state is plain JSON with its own random stream, like a battle.

const CP = { SAVE_KEY: 'outbreak.campaign.v1', WIN_ZONES: 8, HOSTILE: ['raiders', 'military', 'cult'] };

const CP_FACTIONS = {
  you: { name: 'Your people', color: '#55b3c4' },
  raiders: { name: 'The Reapers', color: '#e2573f', blurb: 'Gangs that took the Panamericana when the police left. They loot, they shoot, they run when it goes badly.', expand: 0.45 },
  military: { name: 'Joint Task Force', color: '#7fa05a', blurb: 'What is left of the army, dug in at Campo de Mayo. Drilled, well armed, and following orders nobody gives any more.', expand: 0.3 },
  cult: { name: 'The Reborn', color: '#b87ad0', blurb: 'They think the infected are ascended, and they hold the cathedral. Badly armed, and they do not break.', expand: 0.35 },
  enclave: { name: 'The Unicenter folk', color: '#d99a2b', blurb: 'Families barricaded in the shopping centre. They trade, and they remember favours.' },
};

// The map: positions are approximate (0-100, north up; the river and the Delta are to the east and north-east),
// the links follow the real neighbours closely enough to play.
const CP_ZONES = {
  olivos: { name: 'Olivos', partido: 'Vicente López', x: 80, y: 80, adj: ['florida', 'martinez'], places: ['the Puerto de Olivos', 'Estación Maipú', 'the Quinta gates', 'the Libertador petrol station'], refuge: 'the yacht club' },
  florida: { name: 'Florida', partido: 'Vicente López', x: 64, y: 84, adj: ['olivos', 'munro', 'martelli', 'martinez'], places: ['Estación Florida', 'the Av. Maipú supermarket', 'the parish hall', 'the school gym'], refuge: 'the school gym' },
  martelli: { name: 'Villa Martelli', partido: 'Vicente López', x: 50, y: 93, adj: ['florida', 'munro'], places: ['Tecnópolis', 'the General Paz overpass', 'the bus depot', 'the clinic'], refuge: 'the bus depot' },
  munro: { name: 'Munro', partido: 'Vicente López', x: 48, y: 79, adj: ['florida', 'martelli', 'boulogne', 'martinez'], places: ['the Panamericana overpass', 'the hardware store', 'the sports club', 'the bakery'], refuge: 'the sports club' },
  martinez: { name: 'Martínez', partido: 'San Isidro', x: 70, y: 68, adj: ['olivos', 'florida', 'munro', 'sanisidro', 'boulogne'], places: ['the Unicenter', 'the cinema', 'the car park', 'the hypermarket'], refuge: 'the Unicenter' },
  sanisidro: { name: 'San Isidro', partido: 'San Isidro', x: 78, y: 56, adj: ['martinez', 'boulogne', 'sanfernando'], places: ['the cathedral', 'the Hipódromo stands', 'Estación San Isidro', 'the old town hall'], refuge: 'the cathedral' },
  boulogne: { name: 'Boulogne', partido: 'San Isidro', x: 54, y: 62, adj: ['munro', 'martinez', 'sanisidro', 'campomayo', 'pacheco'], places: ['the Panamericana toll booth', 'the warehouse', 'the school', 'the service station'], refuge: 'the warehouse' },
  sanfernando: { name: 'San Fernando', partido: 'San Fernando', x: 78, y: 42, adj: ['sanisidro', 'tigre', 'pacheco'], places: ['the airport hangars', 'the boatyard', 'the hospital', 'the canal locks'], refuge: 'the hospital', feature: 'hospital' },
  tigre: { name: 'Tigre', partido: 'Tigre', x: 72, y: 28, adj: ['sanfernando', 'pacheco', 'nordelta'], places: ['Puerto de Frutos', 'Estación Delta', 'the Parque de la Costa gates', 'the rowing club'], refuge: 'the rowing club' },
  pacheco: { name: 'General Pacheco', partido: 'Tigre', x: 54, y: 40, adj: ['boulogne', 'sanfernando', 'tigre', 'nordelta', 'campomayo', 'escobar'], places: ['the Ford plant', 'the loading bays', 'the canteen', 'the parts depot'], refuge: 'the Ford plant', feature: 'depot' },
  campomayo: { name: 'Campo de Mayo', partido: 'San Miguel', x: 34, y: 54, adj: ['boulogne', 'pacheco', 'pilar'], places: ['the barracks', 'the armoury', 'the airfield', 'the motor pool'], refuge: 'the barracks', feature: 'armory' },
  nordelta: { name: 'Nordelta', partido: 'Tigre', x: 60, y: 20, adj: ['tigre', 'pacheco', 'escobar'], places: ['the gatehouse', 'the lake club', 'the shopping street', 'the school'], refuge: 'the gatehouse' },
  escobar: { name: 'Escobar', partido: 'Escobar', x: 42, y: 10, adj: ['nordelta', 'pacheco', 'pilar'], places: ['the flower market', 'the Panamericana interchange', 'the cooperative', 'the church'], refuge: 'the cooperative' },
  pilar: { name: 'Pilar', partido: 'Pilar', x: 18, y: 24, adj: ['campomayo', 'escobar'], places: ['the industrial park', 'the cold store', 'the freight yard', 'the chapel'], refuge: 'the cold store' },
};
const CP_START = {
  florida: ['you', 0], martinez: ['enclave', 0], sanisidro: ['cult', 1], boulogne: ['raiders', 1], pacheco: ['raiders', 1],
  campomayo: ['military', 0], pilar: ['military', 1], olivos: [null, 1], martelli: [null, 2], munro: [null, 1],
  sanfernando: [null, 2], tigre: [null, 3], nordelta: [null, 2], escobar: [null, 2],
};
const CP_FEATURES = {
  hospital: 'Hospital: two more recruits a day while you hold it.',
  depot: 'Depot: three more supplies a day while you hold it.',
  armory: 'Armoury: you can raise machine-gun teams while you hold it.',
};
// Squads are named for the barrios their people come from.
const CP_CALLS = ['Florida', 'Carapachay', 'La Lucila', 'Villa Adelina', 'Olivos', 'Munro', 'Martelli', 'Boulogne', 'Beccar', 'Victoria', 'Don Torcuato', 'Benavídez'];

// ---------------------------------------------------------------- state
function cp_rand(cs) {
  cs.rng = (cs.rng + 0x6D2B79F5) >>> 0;
  let t = cs.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const cp_pick = (cs, arr) => arr[Math.floor(cp_rand(cs) * arr.length)];

function cp_new(cfg) {
  cfg = Object.assign({ zombies: 'classic', difficulty: 'normal', seed: null }, cfg || {});
  if (!CONTENT.presets[cfg.zombies]) throw new Error('unknown zombies ' + cfg.zombies);
  if (!CONTENT.difficulties[cfg.difficulty]) throw new Error('unknown difficulty ' + cfg.difficulty);
  const seed = cfg.seed !== null && cfg.seed !== undefined ? cfg.seed >>> 0 : Math.floor(Math.random() * 1073741824);
  const cs = {
    v: 1, seed, rng: (seed ^ 0xC0A57) >>> 0 || 1, day: 1, zombies: cfg.zombies, difficulty: cfg.difficulty,
    zones: {}, company: [], next_id: 1, supplies: 10, recruits: 4, rep: { enclave: 0 }, truce: { raiders: 0, military: 0, cult: 0 },
    threat: null, event: null, op: null, traded: false, log: [], over: null, stats: { battles: 0, won: 0, kills: 0, lost: 0, saved: 0 },
  };
  for (const [id, [owner, dead]] of Object.entries(CP_START)) cs.zones[id] = { owner, dead, survivors: 0, cache: false };
  for (const type of ['line', 'shield', 'line', 'scout']) cp_add_squad(cs, type);
  cp_log(cs, 'Florida is yours: a school gym, a supermarket, the station. Everything past Av. Maipú belongs to somebody else, or to the dead.');
  return cs;
}

function cp_log(cs, text) { cs.log.push({ day: cs.day, text }); if (cs.log.length > 200) cs.log.shift(); }
const cp_zone = (cs, id) => cs.zones[id];
const cp_mine = (cs) => Object.keys(cs.zones).filter((id) => cs.zones[id].owner === 'you');
const cp_held_by = (cs, f) => Object.keys(cs.zones).filter((id) => cs.zones[id].owner === f);
const cp_hostile = (f) => CP.HOSTILE.includes(f);
// Districts next to yours (the frontier), not yours.
function cp_frontier(cs) {
  const out = new Set();
  for (const id of cp_mine(cs)) for (const n of CP_ZONES[id].adj) if (cs.zones[n].owner !== 'you') out.add(n);
  return [...out];
}
function cp_borders(cs, a, owner) { return CP_ZONES[a].adj.some((n) => cs.zones[n].owner === owner); }

function cp_add_squad(cs, type) {
  const used = new Set(cs.company.map((q) => q.call));
  const call = CP_CALLS.find((c) => !used.has(c)) || `Squad ${cs.next_id}`;
  const st = bt_type_stats('modern', type);
  const q = { id: cs.next_id++, type, men: st.men, call, name: `${call} · ${BT_ERAS.modern.names[type]}` };
  cs.company.push(q);
  return q;
}

// ---------------------------------------------------------------- the company between battles
const cp_squad_max = (q) => bt_type_stats('modern', q.type).men;
// Fill a squad's empty places from the recruits: one recruit a man.
function cp_refill(cs, id) {
  const q = cs.company.find((x) => x.id === id);
  if (!q) return 'No such squad.';
  const need = cp_squad_max(q) - q.men;
  if (need <= 0) return 'They are at full strength.';
  if (cs.recruits <= 0) return 'No recruits to send them.';
  const n = Math.min(need, cs.recruits);
  q.men += n; cs.recruits -= n;
  return null;
}
// Raise a new squad: recruits for every man, and supplies for their weapons. Machine guns need the armoury.
function cp_raise_cost(type) { return { recruits: BT_TYPES[type].men, supplies: BT_ARMY.cost[type] * 2 }; }
function cp_raise(cs, type) {
  if (!BT_TYPES[type]) return 'Unknown squad.';
  if (cs.company.length >= BT_ARMY.max) return 'Five squads is all one company can lead.';
  if (type === 'heavy' && cs.zones.campomayo.owner !== 'you') return 'Machine guns come from the armoury at Campo de Mayo.';
  const c = cp_raise_cost(type);
  if (cs.recruits < c.recruits) return `Needs ${c.recruits} recruits.`;
  if (cs.supplies < c.supplies) return `Needs ${c.supplies} supplies.`;
  cs.recruits -= c.recruits; cs.supplies -= c.supplies;
  const q = cp_add_squad(cs, type);
  cp_log(cs, `${q.name} is raised.`);
  return null;
}

// ---------------------------------------------------------------- what you can do today
// Every operation you could choose now. Battles take the day; abandoning, trading and refitting do not.
function cp_ops(cs) {
  if (cs.over || cs.event || cs.op) return [];
  const ops = [];
  if (cs.threat) {
    ops.push({ kind: 'defend', zone: cs.threat.zone, by: cs.threat.by });
    if (cs.threat.zone !== 'florida') ops.push({ kind: 'abandon', zone: cs.threat.zone, by: cs.threat.by });
  }
  for (const id of cp_frontier(cs)) {
    const z = cs.zones[id];
    if (z.owner === null) ops.push({ kind: 'clear', zone: id });
    else if (cp_hostile(z.owner) && cs.truce[z.owner] < cs.day) ops.push({ kind: 'assault', zone: id, by: z.owner });
    else if (z.owner === 'enclave' && !cs.traded) ops.push({ kind: 'trade', zone: id });
  }
  for (const id of Object.keys(cs.zones)) if (cs.zones[id].survivors > 0 && (cs.zones[id].owner === 'you' || cp_frontier(cs).includes(id))) ops.push({ kind: 'rescue', zone: id });
  ops.push({ kind: 'rest' });
  return ops;
}
function cp_op_words(cs, op) {
  const z = op.zone ? CP_ZONES[op.zone] : null, f = op.by && CP_FACTIONS[op.by];
  switch (op.kind) {
    case 'clear': return { title: `Clear ${z.name}`, sub: `Take four buildings back from the dead (${['hardly any', 'a few', 'many', 'swarms of'][cs.zones[op.zone].dead]} of them).${cs.zones[op.zone].cache ? ' A police armoury is in there.' : ''}` };
    case 'assault': return { title: `Assault ${z.name}`, sub: `Take it from ${f.name}. They hold ${cp_held_by(cs, op.by).length} districts: the more they hold, the more they send.` };
    case 'defend': return { title: `Defend ${z.name}`, sub: op.by === 'dead' ? 'A horde is coming. Hold the refuge through the night.' : `${f.name} are coming for it. Keep more of its buildings than they take.` };
    case 'abandon': return { title: `Abandon ${z.name}`, sub: `Pull everyone out. The district is lost, the company is spared. Does not take the day.` };
    case 'rescue': return { title: `Rescue in ${z.name}`, sub: 'People are holed up in three houses. Every one you bring out is a recruit.' };
    case 'trade': return { title: `Trade with ${CP_FACTIONS.enclave.name}`, sub: 'Three supplies for their goodwill. Does not take the day.' };
    case 'rest': return { title: 'Rest', sub: 'No fighting today. The wounded recover: two extra recruits.' };
    default: return { title: op.kind, sub: '' };
  }
}

// The battle an operation is fought as: your company, the district's places, the enemy it belongs to.
function cp_battle_cfg(cs, op) {
  const zid = op.zone, z = cs.zones[zid], meta = CP_ZONES[zid];
  const cfg = { era: 'modern', zombies: cs.zombies, difficulty: cs.difficulty, seed: Math.floor(cp_rand(cs) * 1073741824), campaign: true, zone: zid, op: op.kind,
                company: cs.company.filter((q) => q.men > 0).map((q) => ({ id: q.id, type: q.type, men: q.men, name: q.name, call: q.call })),
                places: meta.places, refuge_name: meta.refuge };
  const held = (f) => cp_held_by(cs, f).length, left = (f) => Math.max(0, Math.min(2, held(f) - 1));
  const diff = { easy: -1, normal: 0, hard: 1 }[cs.difficulty] || 0;
  if (op.kind === 'clear') Object.assign(cfg, { objective: 'take', rivals: 'none', density: 0.55 + 0.3 * z.dead, turns: 10 });
  // the size of a faction's company follows the territory behind it
  else if (op.kind === 'assault') Object.assign(cfg, { objective: 'take', rivals: op.by, rival_name: CP_FACTIONS[op.by].name, rival_squads: Math.max(2, Math.min(5, 2 + held(op.by) + diff)), reinforcements: left(op.by), density: 0.4 + 0.2 * z.dead });
  else if (op.kind === 'defend' && op.by === 'dead') Object.assign(cfg, { objective: 'hold', turns: 8, density: 0.5 + 0.15 * Math.max(...meta.adj.map((n) => cs.zones[n].dead)) });
  else if (op.kind === 'defend') Object.assign(cfg, { objective: 'take', rivals: op.by, rival_name: CP_FACTIONS[op.by].name, defend: true, turns: 8, rival_squads: Math.max(2, Math.min(4, 1 + held(op.by) + diff)), reinforcements: Math.min(1, left(op.by)), density: 0.5 });
  else if (op.kind === 'rescue') Object.assign(cfg, { objective: 'rescue', density: 0.5 + 0.3 * z.dead });
  return cfg;
}

// Choose an operation. Battles return their battle config (and wait for cp_finish_battle); the rest happen at once.
function cp_choose(cs, op) {
  if (cs.over || cs.event || cs.op) return { error: 'Not now.' };
  const real = cp_ops(cs).find((o) => o.kind === op.kind && o.zone === op.zone);
  if (!real) return { error: 'That is not possible today.' };
  op = real;
  const z = op.zone ? cs.zones[op.zone] : null;
  if (op.kind === 'abandon') {
    const by = cs.threat.by;
    z.owner = by === 'dead' ? null : by; if (by === 'dead') z.dead = 3;
    cp_log(cs, `You pull out of ${CP_ZONES[op.zone].name}. ${by === 'dead' ? 'The dead have it now.' : `${CP_FACTIONS[by].name} move in.`}`);
    cs.threat = null;
    return { done: true };
  }
  if (op.kind === 'trade') {
    if (cs.supplies < 3) return { error: 'You need three supplies to trade.' };
    cs.supplies -= 3; cs.rep.enclave += 1; cs.traded = true;
    cp_log(cs, `You trade with ${CP_FACTIONS.enclave.name}. They remember it.`);
    cp_check_alliance(cs);
    return { done: true };
  }
  if (op.kind === 'rest') {
    cs.recruits += 2;
    cp_log(cs, 'A day without fighting. The wounded are on their feet again.');
    cp_end_day(cs);
    return { done: true };
  }
  if (!cs.company.some((q) => q.men > 0)) return { error: 'You have nobody to send. Raise a squad first.' };
  cs.op = Object.assign({}, op);
  const cfg = cp_battle_cfg(cs, op);
  cs.op.cfg = cfg;
  return { battle: cfg };
}

// A battle is over: the company counts its dead, and the map changes with the outcome. Then the night comes.
function cp_finish_battle(cs, b) {
  const op = cs.op;
  if (!op) return;
  const won = !!(b && b.over && b.over.victory);
  const z = cs.zones[op.zone], name = CP_ZONES[op.zone].name;
  cs.stats.battles++; if (won) cs.stats.won++;
  if (b) {
    cs.stats.kills += b.kills; cs.stats.saved += b.saved || 0;
    for (const s of b.squads.filter((x) => x.side !== 'rival')) {
      const q = cs.company.find((x) => x.id === s.cid);
      if (!q) continue;
      cs.stats.lost += q.men - s.men.length;
      q.men = s.men.length;
    }
  }
  for (const q of cs.company.filter((x) => x.men <= 0)) cp_log(cs, `${q.name} is gone. Nobody came back.`);
  cs.company = cs.company.filter((q) => q.men > 0);
  const f = op.by && CP_FACTIONS[op.by];
  if (op.kind === 'clear') {
    if (won) { z.owner = 'you'; z.dead = 0; cp_log(cs, `${name} is yours.${z.cache ? ' The police armoury had ammunition: eight supplies.' : ''}`); if (z.cache) { cs.supplies += 8; z.cache = false; } }
    else { z.dead = Math.min(3, z.dead + 1); cp_log(cs, `You fall back from ${name}. All that noise drew more of them in.`); }
  } else if (op.kind === 'assault') {
    if (won) {
      z.owner = 'you'; z.dead = Math.max(0, z.dead - 1); cs.truce[op.by] = Math.max(cs.truce[op.by], cs.day + 2);
      cp_log(cs, `${name} is yours. ${f.name} fall back to lick their wounds.`);
      if (!cp_held_by(cs, op.by).length) cp_log(cs, `${f.name} are finished: they hold nothing any more.`);
    } else {
      cp_log(cs, `The assault on ${name} failed.`);
      const target = cp_mine(cs).find((id) => CP_ZONES[id].adj.includes(op.zone));
      if (target && !cs.threat && cp_rand(cs) < 0.5) { cs.threat = { zone: target, by: op.by }; cp_log(cs, `${f.name} smell weakness: they are coming for ${CP_ZONES[target].name}.`); }
    }
  } else if (op.kind === 'defend') {
    cs.threat = null;
    if (op.by !== 'dead') cs.truce[op.by] = Math.max(cs.truce[op.by], cs.day + 2);    // win or lose, they need days to come again
    if (won) cp_log(cs, `${name} held.`);
    else {
      z.owner = op.by === 'dead' ? null : op.by; if (op.by === 'dead') z.dead = 3;
      cp_log(cs, `${name} is lost${op.by === 'dead' ? ' to the dead' : ` to ${f.name}`}.`);
    }
  } else if (op.kind === 'rescue') {
    const n = b ? b.saved || 0 : 0;
    cs.recruits += n; z.survivors = 0;
    cp_log(cs, n ? `${n} people brought out of ${name}. They want to fight.` : `Nobody came out of ${name} alive.`);
    if (won) { cs.rep.enclave += 1; cp_check_alliance(cs); }
  }
  if (won) cs.supplies += 2;                                              // what the winners pick up
  cs.op = null;
  cp_end_day(cs);
}

function cp_check_alliance(cs) {
  const home = cp_held_by(cs, 'enclave');
  if (cs.rep.enclave >= 4 && home.length) {
    for (const id of home) cs.zones[id].owner = 'you';
    cp_log(cs, `${CP_FACTIONS.enclave.name} throw in their lot with you. ${home.map((id) => CP_ZONES[id].name).join(', ')} is yours.`);
  }
}

// ---------------------------------------------------------------- the night: the map moves
function cp_end_day(cs) {
  // a threat nobody answered: they take it
  if (cs.threat) {
    const t = cs.threat, z = cs.zones[t.zone];
    z.owner = t.by === 'dead' ? null : t.by; if (t.by === 'dead') z.dead = 3;
    cp_log(cs, `Nobody stood for ${CP_ZONES[t.zone].name}. ${t.by === 'dead' ? 'The dead have it.' : `${CP_FACTIONS[t.by].name} took it.`}`);
    cs.threat = null;
  }
  if (cp_check_over(cs)) return;
  // what your districts give
  const mine = cp_mine(cs);
  const supplies = mine.length + (cs.zones.pacheco.owner === 'you' ? 3 : 0), recruits = 1 + Math.floor(mine.length / 3) + (cs.zones.sanfernando.owner === 'you' ? 2 : 0);
  cs.supplies += supplies; cs.recruits += recruits;
  for (const id of Object.keys(cs.zones)) if (cs.zones[id].survivors > 0) cs.zones[id].survivors--;
  // the dead spread out of the worst districts
  for (const id of Object.keys(cs.zones)) {
    if (cs.zones[id].dead < 3 || cp_rand(cs) > 0.5) continue;
    const next = CP_ZONES[id].adj.filter((n) => cs.zones[n].owner !== 'you' && cs.zones[n].dead < 3);
    if (!next.length) continue;
    const n = cp_pick(cs, next), nz = cs.zones[n];
    nz.dead++;
    if (nz.dead >= 3 && nz.owner && nz.owner !== 'you' && cp_rand(cs) < 0.35) { cp_log(cs, `The dead overran ${CP_ZONES[n].name}. ${CP_FACTIONS[nz.owner].name} lost it.`); nz.owner = null; }
  }
  // the factions keep their own streets clean, more or less
  for (const id of Object.keys(cs.zones)) { const z = cs.zones[id]; if (z.owner && z.owner !== 'you' && z.dead > 0 && cp_rand(cs) < 0.5) z.dead--; }
  // the factions move
  for (const f of CP.HOSTILE) {
    const held = cp_held_by(cs, f);
    if (!held.length || cp_rand(cs) > CP_FACTIONS[f].expand) continue;
    const cand = [...new Set(held.flatMap((id) => CP_ZONES[id].adj))];
    const open = cand.filter((n) => cs.zones[n].owner === null && cs.zones[n].dead <= 1);
    const yours = cand.filter((n) => cs.zones[n].owner === 'you');
    if (yours.length && !cs.threat && cs.truce[f] < cs.day + 1 && (cp_rand(cs) < 0.35 || !open.length)) {
      const t = cp_pick(cs, yours);
      cs.threat = { zone: t, by: f };
      cp_log(cs, `${CP_FACTIONS[f].name} are massing to take ${CP_ZONES[t].name}. Defend it tomorrow, or lose it.${t === 'florida' ? ' Florida is home: if it falls, it is over.' : ''}`);
    } else if (open.length) {
      const t = cp_pick(cs, open);
      cs.zones[t].owner = f;
      cp_log(cs, `${CP_FACTIONS[f].name} moved into ${CP_ZONES[t].name}.`);
    }
  }
  // a horde building up next door
  if (!cs.threat) {
    const exposed = mine.filter((id) => CP_ZONES[id].adj.some((n) => cs.zones[n].dead >= 3));
    if (exposed.length && cp_rand(cs) < 0.3) {
      const t = cp_pick(cs, exposed);
      cs.threat = { zone: t, by: 'dead' };
      cp_log(cs, `A horde is gathering on the edge of ${CP_ZONES[t].name}. It will come tomorrow night.`);
    }
  }
  cs.day++; cs.traded = false;
  if (cp_check_over(cs)) return;
  // and something happens that asks you to decide
  if (cp_rand(cs) < 0.6) cp_roll_event(cs);
}

function cp_check_over(cs) {
  if (cs.over) return true;
  const mine = cp_mine(cs).length, hostiles = CP.HOSTILE.filter((f) => cp_held_by(cs, f).length);
  if (cs.zones.florida.owner !== 'you') cs.over = { victory: false, title: 'Florida has fallen', text: 'The school gym, the station, the people who trusted you. Without Florida there is nothing to come back to.' };
  else if (!cs.company.some((q) => q.men > 0) && cs.recruits < 4) cs.over = { victory: false, title: 'Nobody left', text: 'The company is gone, and there is nobody left to raise another.' };
  else if (mine >= CP.WIN_ZONES) cs.over = { victory: true, title: 'Zona Norte', text: `${mine} districts answer to you, from the river to the Panamericana. It is not the world it was, but it is yours.` };
  else if (!hostiles.length) cs.over = { victory: true, title: 'Nobody left to fight', text: 'The Reapers, the Task Force and the Reborn are gone. What is left is you, the river and the dead.' };
  if (cs.over) cs.over.summary = cp_summary(cs);
  return !!cs.over;
}
function cp_summary(cs) {
  return [`Day ${cs.day}. Districts held: ${cp_mine(cs).length} of ${Object.keys(cs.zones).length}.`,
    `Battles: ${cs.stats.battles}, won ${cs.stats.won}. The dead destroyed: ${cs.stats.kills}.`,
    `Your dead: ${cs.stats.lost}. People brought out: ${cs.stats.saved}.`,
    'Company: ' + (cs.company.length ? cs.company.map((q) => `${q.name} (${q.men})`).join(', ') : 'none') + '.'];
}

// ---------------------------------------------------------------- encounters: decisions that move the map
// Each returns its data when it can happen now (or null), a text, and choices; a choice changes the state and says what happened.
const CP_EVENTS = [
  { id: 'refugees', when: (cs) => ({}),
    text: () => 'A crowd walked up the Mitre tracks from the city in the night. Forty people, children among them, and nobody has checked them for bites.',
    choices: (cs) => [
      { label: 'Take them in', sub: '+4 recruits, -2 supplies. Some of them may be bitten.', go: (cs) => {
        cs.recruits += 4; cs.supplies = Math.max(0, cs.supplies - 2);
        if (cp_rand(cs) < 0.35) {
          const id = cp_pick(cs, cp_mine(cs)); cs.zones[id].dead = Math.min(3, cs.zones[id].dead + 1);
          if (!cs.threat && cs.zones[id].dead >= 2) cs.threat = { zone: id, by: 'dead' };
          return `One of them was bitten, and turned in ${CP_ZONES[id].name}.${cs.threat && cs.threat.zone === id ? ' The dead are loose there: it must be held.' : ''}`;
        }
        return 'They are checked, fed and given work. Nobody turned.';
      } },
      cp_held_by(cs, 'enclave').length ? { label: `Send them on to ${CP_FACTIONS.enclave.name}`, sub: 'Their goodwill rises.', go: (cs) => { cs.rep.enclave++; cp_check_alliance(cs); return `${CP_FACTIONS.enclave.name} take them in, and remember who sent them.`; } } : null,
      { label: 'Turn them away', sub: 'Nothing gained, nothing risked.', go: (cs) => { if (cs.rep.enclave > 0) cs.rep.enclave--; return 'They walk on north. Word of it gets around.'; } },
    ] },
  { id: 'truce', when: (cs) => { const z = cp_mine(cs).filter((id) => id !== 'florida' && cp_borders(cs, id, 'military')); return z.length && cs.truce.military < cs.day ? { zone: z[0] } : null; },
    text: (cs, d) => `A Task Force officer walks up under a white flag. Hand over ${CP_ZONES[d.zone].name} and they leave you alone for a week, with a crate of ammunition thrown in.`,
    choices: (cs, d) => [
      { label: `Give them ${CP_ZONES[d.zone].name}`, sub: '+6 supplies and a week of peace with them. The district is theirs.', go: (cs) => { cs.zones[d.zone].owner = 'military'; cs.supplies += 6; cs.truce.military = cs.day + 7; return `${CP_ZONES[d.zone].name} is theirs now. The crate is real.`; } },
      { label: 'Refuse', sub: 'They will come for it.', go: (cs) => { if (!cs.threat) cs.threat = { zone: d.zone, by: 'military' }; return `The officer salutes and leaves. ${CP_FACTIONS.military.name} are coming for ${CP_ZONES[d.zone].name}.`; } },
    ] },
  { id: 'toll', when: (cs) => { const z = cp_mine(cs).filter((id) => cp_borders(cs, id, 'raiders')); return z.length && cs.truce.raiders < cs.day ? { zone: cp_pick(cs, z) } : null; },
    text: () => 'The Reapers have chained the Panamericana and sent a kid with a note: four supplies a week, or they come and take them.',
    choices: () => [
      { label: 'Pay the toll', sub: '-4 supplies, four quiet days with them.', go: (cs) => { if (cs.supplies < 4) return 'You do not have it. They take that as a no.'; cs.supplies -= 4; cs.truce.raiders = cs.day + 4; return 'You pay. The chain comes down for a while.'; } },
      { label: 'Send the kid back with nothing', sub: 'They will come.', go: (cs, d) => { if (!cs.threat) cs.threat = { zone: d.zone, by: 'raiders' }; return `The Reapers are coming for ${CP_ZONES[d.zone].name}.`; } },
    ] },
  { id: 'preachers', when: (cs) => (cp_held_by(cs, 'cult').length ? { zone: cp_pick(cs, cp_mine(cs)) } : null),
    text: (cs, d) => `Preachers of the Reborn are in ${CP_ZONES[d.zone].name}, telling people the bitten should be welcomed, not shot.`,
    choices: () => [
      { label: 'Run them out', sub: 'The Reborn will not forgive it.', go: (cs, d) => { const t = cp_mine(cs).find((id) => cp_borders(cs, id, 'cult')); if (t && !cs.threat) { cs.threat = { zone: t, by: 'cult' }; return `They go, and the Reborn march on ${CP_ZONES[t].name}.`; } return 'They go, cursing you.'; } },
      { label: 'Let them talk', sub: 'Peace with the Reborn for five days. Some people listen.', go: (cs, d) => { cs.truce.cult = cs.day + 5; cs.zones[d.zone].dead = Math.min(3, cs.zones[d.zone].dead + 1); cs.recruits = Math.max(0, cs.recruits - 1); return `Some listen. A family in ${CP_ZONES[d.zone].name} hides a bitten son. One of your recruits leaves with the preachers.`; } },
    ] },
  { id: 'medicine', when: (cs) => (cp_held_by(cs, 'enclave').length ? {} : null),
    text: () => 'The Unicenter folk have a fever ward and no antibiotics. They ask for three supplies\' worth.',
    choices: () => [
      { label: 'Give it', sub: '-3 supplies; they will not forget.', go: (cs) => { if (cs.supplies < 3) return 'You do not have it to give.'; cs.supplies -= 3; cs.rep.enclave += 2; cp_check_alliance(cs); return 'The fever breaks in the ward.'; } },
      { label: 'Refuse', sub: 'They will remember that too.', go: (cs) => { cs.rep.enclave = Math.max(0, cs.rep.enclave - 1); return 'They bury two people that week.'; } },
    ] },
  { id: 'horde', when: (cs) => {
      if (cs.threat) return null;
      for (const id of cp_mine(cs)) for (const n of CP_ZONES[id].adj) if (cs.zones[n].dead >= 2 && cs.zones[n].owner !== 'you') return { zone: id, from: n, lure: CP_ZONES[n].adj.find((m) => cp_hostile(cs.zones[m].owner)) || null };
      return null; },
    text: (cs, d) => `A horde is moving down Av. del Libertador out of ${CP_ZONES[d.from].name}, toward ${CP_ZONES[d.zone].name}.`,
    choices: (cs, d) => [
      { label: `Meet it in ${CP_ZONES[d.zone].name}`, sub: 'A night defence tomorrow.', go: (cs) => { cs.threat = { zone: d.zone, by: 'dead' }; return `Everyone who can hold a weapon goes to ${CP_ZONES[d.zone].name}.`; } },
      { label: 'Block the avenue', sub: '-4 supplies: cars, wire and a burning bus across Libertador. It breaks there.', go: (cs) => {
        if (cs.supplies < 4) { cs.threat = { zone: d.zone, by: 'dead' }; return 'There is not enough to build with. The horde keeps coming.'; }
        cs.supplies -= 4; cs.zones[d.from].dead = Math.max(1, cs.zones[d.from].dead - 1); return 'The horde breaks against the wreck on Libertador and scatters back north.';
      } },
      d.lure ? { label: `Lead it into ${CP_ZONES[d.lure].name}`, sub: `-2 supplies (flares, a car alarm, a brave driver). ${CP_FACTIONS[cs.zones[d.lure].owner].name} get the horde.`, go: (cs) => {
        if (cs.supplies < 2) { cs.threat = { zone: d.zone, by: 'dead' }; return 'Without supplies there is no lure. The horde keeps coming.'; }
        cs.supplies -= 2; const lz = cs.zones[d.lure], owner = lz.owner; lz.dead = Math.min(3, lz.dead + 2);
        if (lz.dead >= 3) { lz.owner = null; return `The horde turns into ${CP_ZONES[d.lure].name} and stays. ${CP_FACTIONS[owner].name} lost it.`; }
        return `The horde turns into ${CP_ZONES[d.lure].name}. ${CP_FACTIONS[owner].name} are busy for a while.`;
      } } : null,
      d.zone !== 'florida' ? { label: `Evacuate ${CP_ZONES[d.zone].name}`, sub: 'Lose the district; keep everyone.', go: (cs) => { cs.zones[d.zone].owner = null; cs.zones[d.zone].dead = 3; return `${CP_ZONES[d.zone].name} is left to the horde.`; } } : null,
    ] },
  { id: 'signal', when: (cs) => { const z = cp_frontier(cs).filter((id) => cs.zones[id].survivors === 0 && cs.zones[id].dead >= 1); return z.length ? { zone: cp_pick(cs, z) } : null; },
    text: (cs, d) => `A mirror flashes from a rooftop in ${CP_ZONES[d.zone].name}, three times, then three again. Somebody is alive in there.`,
    choices: () => [
      { label: 'Mark it for a rescue', sub: 'A rescue there is possible for three days.', go: (cs, d) => { cs.zones[d.zone].survivors = 3; return `Rescue in ${CP_ZONES[d.zone].name} is on the map.`; } },
      { label: 'There is no one to spare', sub: 'Nothing happens.', go: () => 'The mirror flashes for two more days, then stops.' },
    ] },
  { id: 'deserters', when: (cs) => { const f = CP.HOSTILE.filter((x) => cp_held_by(cs, x).length); return f.length ? { by: cp_pick(cs, f) } : null; },
    text: (cs, d) => `Three deserters from ${CP_FACTIONS[d.by].name} are at your barricade, armed, asking to join.`,
    choices: () => [
      { label: 'Take them', sub: '+3 recruits. Their old friends will want them back.', go: (cs, d) => {
        cs.recruits += 3; const t = cp_mine(cs).find((id) => cp_borders(cs, id, d.by));
        if (t && !cs.threat) { cs.threat = { zone: t, by: d.by }; return `They are in. ${CP_FACTIONS[d.by].name} are coming to ${CP_ZONES[t].name} to collect them.`; }
        return 'They are in.';
      } },
      { label: 'Send them away', sub: 'No trouble.', go: () => 'They go. Maybe somebody else takes them.' },
    ] },
  { id: 'cache', when: (cs) => { const z = cp_frontier(cs).filter((id) => cs.zones[id].owner === null && !cs.zones[id].cache); return z.length ? { zone: cp_pick(cs, z) } : null; },
    text: (cs, d) => `Someone swears there is a police armoury in ${CP_ZONES[d.zone].name}, untouched, under the dead.`,
    choices: () => [
      { label: 'Mark it', sub: 'Clearing the district brings eight supplies.', go: (cs, d) => { cs.zones[d.zone].cache = true; return `The armoury in ${CP_ZONES[d.zone].name} is on the map.`; } },
      { label: 'Rumours', sub: 'Nothing.', go: () => 'You have heard that story before.' },
    ] },
];

function cp_roll_event(cs) {
  const recent = cs.log.slice(-12).map((l) => l.event).filter(Boolean);
  const pool = [];
  for (const e of CP_EVENTS) { if (recent.includes(e.id)) continue; const d = e.when(cs); if (d) pool.push([e, d]); }
  if (!pool.length) return;
  const [e, d] = cp_pick(cs, pool);
  cs.event = { id: e.id, data: d };
}
function cp_event_view(cs) {
  if (!cs.event) return null;
  const e = CP_EVENTS.find((x) => x.id === cs.event.id), d = cs.event.data;
  return { text: e.text(cs, d), choices: e.choices(cs, d).filter(Boolean).map((c) => ({ label: c.label, sub: c.sub })) };
}
function cp_decide(cs, i) {
  if (!cs.event) return null;
  const e = CP_EVENTS.find((x) => x.id === cs.event.id), d = cs.event.data, c = e.choices(cs, d).filter(Boolean)[i];
  if (!c) return null;
  const what = c.go(cs, d);
  cs.event = null;
  cs.log.push({ day: cs.day, text: what, event: e.id });
  cp_check_over(cs);
  return what;
}

// ---------------------------------------------------------------- save
function cp_store(store) { return store || (typeof localStorage !== 'undefined' ? localStorage : null); }
function cp_save(cs, store) { store = cp_store(store); if (store) store.setItem(CP.SAVE_KEY, JSON.stringify(cs)); }
function cp_load(store) { store = cp_store(store); const raw = store && store.getItem(CP.SAVE_KEY); if (!raw) return null; const cs = JSON.parse(raw); return cs && cs.v === 1 ? cs : null; }
function cp_has_save(store) { try { const cs = cp_load(store); return !!(cs && !cs.over); } catch (e) { return false; } }
function cp_delete_save(store) { try { store = cp_store(store); if (store) store.removeItem(CP.SAVE_KEY); } catch (e) { /* ignore */ } }
