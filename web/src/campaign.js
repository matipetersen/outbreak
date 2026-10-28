// ---------------------------------------------------------------- campaign: Zona Norte (web only)
// A campaign over the northern suburbs of Buenos Aires, 2026, written in Rioplatense Spanish (the rest of the game is in
// English). You start with a company holding one barrio (Florida, in Vicente López) and grow from there. Every day you pick
// one operation on the map: clear a district of the dead, assault a faction's district, rescue survivors, defend a district
// under threat. Operations are fought as battles (battle.js) with your own company, whose losses stay lost; a district's
// battles are fought on a drawn map of it. Every night the map moves: your districts produce supplies and recruits, the
// dead spread, the factions expand and come for you, and something happens that asks you to decide. What you decide
// changes the map. The state is plain JSON with its own random stream, like a battle.

const CP = { SAVE_KEY: 'outbreak.campaign.v1', WIN_ZONES: 8, HOSTILE: ['raiders', 'military', 'cult'] };

// Every faction's name is a plural, so the sentences read the same for all of them.
const CP_FACTIONS = {
  you: { name: 'Los tuyos', color: '#55b3c4' },
  raiders: { name: 'Los Segadores', color: '#e2573f', blurb: 'Bandas que se quedaron con la Panamericana cuando se fue la policía. Saquean, tiran, y se borran cuando la cosa se pone fea.', expand: 0.45 },
  military: { name: 'Los Milicos', color: '#7fa05a', blurb: 'Lo que queda de la Fuerza de Tareas Conjunta, atrincherada en Campo de Mayo. Entrenados, bien armados, y cumpliendo órdenes que ya nadie da.', expand: 0.3 },
  cult: { name: 'Los Renacidos', color: '#b87ad0', blurb: 'Creen que los infectados ascendieron, y tienen la catedral. Mal armados, pero no aflojan nunca.', expand: 0.35 },
  enclave: { name: 'Los del Unicenter', color: '#d99a2b', blurb: 'Familias atrincheradas en el shopping. Comercian, y se acuerdan de los favores.' },
};
// The squad types, as the campaign calls them.
const CP_TYPES = { line: 'Fusileros', shield: 'Escudos', heavy: 'Ametralladora', scout: 'Exploradores' };

// The map: positions are approximate (0-100, north up; the river and the Delta are to the east and north-east), the links
// follow the real neighbours closely enough to play. `layout` is the district drawn for its battles (see bt_paint_layout):
// a 24 x 32 grid, north up, its four `bases` in the order of `places`.
const CP_ZONES = {
  olivos: { name: 'Olivos', partido: 'Vicente López', x: 80, y: 80, adj: ['florida', 'martinez'], refuge: 'Club náutico',
    places: ['Puerto de Olivos', 'Estación Maipú', 'Quinta de Olivos', 'Estación de servicio Libertador'],
    layout: { water: [[20, 0, 23, 31], [17, 5, 19, 9]], roads: [[9, 0, 10, 31], [0, 15, 19, 15]], rails: [[18, 17, 18, 31]], parks: [[0, 22, 8, 26]],
              fences: [[0, 21, 3, 21], [5, 21, 8, 21]], bases: [[11, 4, 16, 9, 'ws'], [13, 19, 17, 23, 'we'], [2, 17, 6, 20, 'ns'], [3, 5, 7, 8, 'e']] } },
  florida: { name: 'Florida', partido: 'Vicente López', x: 64, y: 84, adj: ['olivos', 'munro', 'martelli', 'martinez'], refuge: 'Gimnasio de la escuela',
    places: ['Estación Florida', 'Súper de Av. Maipú', 'Salón parroquial', 'Gimnasio de la escuela'],
    layout: { roads: [[16, 0, 17, 31], [0, 9, 15, 9]], rails: [[0, 16, 23, 16]], parks: [[9, 3, 13, 7]],
              bases: [[7, 17, 12, 20, 'n'], [18, 4, 22, 8, 'w'], [2, 3, 6, 7, 's'], [3, 21, 9, 25, 'n']] } },
  martelli: { name: 'Villa Martelli', partido: 'Vicente López', x: 50, y: 93, adj: ['florida', 'munro'], refuge: 'Terminal de colectivos',
    places: ['Tecnópolis', 'Puente de General Paz', 'Terminal de colectivos', 'Salita'],
    layout: { roads: [[0, 25, 23, 26], [12, 0, 12, 24]], parks: [[2, 11, 10, 14]],
              bases: [[2, 4, 10, 10, 'se'], [14, 20, 18, 23, 's'], [15, 6, 21, 11, 'w'], [3, 16, 7, 20, 'e']] } },
  munro: { name: 'Munro', partido: 'Vicente López', x: 48, y: 79, adj: ['florida', 'martelli', 'boulogne', 'martinez'], refuge: 'Club',
    places: ['Puente de la Panamericana', 'Ferretería', 'Club', 'Panadería'],
    layout: { roads: [[1, 0, 3, 31], [4, 17, 23, 17], [14, 0, 14, 16]], parks: [[16, 10, 22, 13]],
              bases: [[5, 11, 8, 15, 'w'], [16, 19, 20, 22, 'n'], [16, 3, 22, 8, 'ws'], [7, 20, 11, 23, 'n']] } },
  martinez: { name: 'Martínez', partido: 'San Isidro', x: 70, y: 68, adj: ['olivos', 'florida', 'munro', 'sanisidro', 'boulogne'], refuge: 'Unicenter',
    places: ['Unicenter', 'Cine', 'Estacionamiento', 'Hipermercado'],
    layout: { roads: [[0, 0, 1, 31], [2, 16, 23, 16], [13, 0, 13, 15]],
              bases: [[3, 4, 11, 11, 'se'], [15, 4, 20, 8, 'w'], [15, 10, 20, 14, 'ws'], [5, 19, 11, 23, 'n']] } },
  sanisidro: { name: 'San Isidro', partido: 'San Isidro', x: 78, y: 56, adj: ['martinez', 'boulogne', 'sanfernando'], refuge: 'Catedral',
    places: ['Catedral', 'Tribunas del Hipódromo', 'Estación San Isidro', 'Viejo municipio'],
    layout: { water: [[21, 0, 23, 31]], fields: [[18, 0, 20, 31]], rails: [[10, 0, 10, 31]], roads: [[0, 13, 17, 13], [14, 0, 14, 12]], parks: [[11, 4, 13, 9], [1, 8, 8, 11]],
              bases: [[15, 4, 19, 9, 'w'], [2, 3, 8, 7, 's'], [11, 17, 15, 20, 'w'], [2, 18, 7, 22, 'e']] } },
  boulogne: { name: 'Boulogne', partido: 'San Isidro', x: 54, y: 62, adj: ['munro', 'martinez', 'sanisidro', 'campomayo', 'pacheco'], refuge: 'Galpón',
    places: ['Peaje de la Panamericana', 'Galpón', 'Escuela', 'Estación de servicio'],
    layout: { roads: [[10, 0, 12, 31], [0, 18, 9, 18]], fields: [[16, 3, 22, 12]],
              bases: [[13, 8, 16, 11, 'w'], [2, 6, 8, 12, 'e'], [16, 15, 21, 19, 'w'], [13, 21, 17, 24, 'w']] } },
  sanfernando: { name: 'San Fernando', partido: 'San Fernando', x: 78, y: 42, adj: ['sanisidro', 'tigre', 'pacheco'], refuge: 'Hospital', feature: 'hospital',
    places: ['Hangares del aeropuerto', 'Astillero', 'Hospital', 'Esclusas del canal'],
    layout: { water: [[21, 0, 23, 31], [8, 15, 20, 16]], roads: [[1, 9, 10, 10], [6, 0, 6, 31]],
              bases: [[1, 3, 9, 7, 's'], [14, 4, 19, 8, 's'], [9, 21, 15, 25, 'w'], [14, 18, 18, 21, 'w']] } },
  tigre: { name: 'Tigre', partido: 'Tigre', x: 72, y: 28, adj: ['sanfernando', 'pacheco', 'nordelta'], refuge: 'Club de remo',
    places: ['Puerto de Frutos', 'Estación Delta', 'Entrada del Parque de la Costa', 'Club de remo'],
    layout: { water: [[11, 0, 12, 31]], roads: [[0, 14, 23, 14]], rails: [[21, 15, 21, 31]], parks: [[14, 9, 22, 12]],
              bases: [[3, 4, 9, 9, 'e'], [14, 18, 19, 22, 'n'], [15, 4, 20, 8, 's'], [3, 17, 9, 21, 'e']] } },
  pacheco: { name: 'General Pacheco', partido: 'Tigre', x: 54, y: 40, adj: ['boulogne', 'sanfernando', 'tigre', 'nordelta', 'campomayo', 'escobar'], refuge: 'Planta Ford', feature: 'depot',
    places: ['Planta Ford', 'Playa de carga', 'Comedor', 'Depósito de repuestos'],
    layout: { roads: [[0, 15, 23, 15], [12, 16, 12, 31]], fences: [[0, 13, 13, 13]],
              bases: [[1, 3, 12, 11, 'se'], [14, 4, 21, 9, 'w'], [3, 18, 8, 22, 'n'], [15, 19, 21, 23, 'w']] } },
  campomayo: { name: 'Campo de Mayo', partido: 'San Miguel', x: 34, y: 54, adj: ['boulogne', 'pacheco', 'pilar'], refuge: 'Cuadras', feature: 'armory',
    places: ['Cuadras', 'Arsenal', 'Aeródromo', 'Parque automotor'],
    layout: { fields: [[0, 4, 23, 26]], roads: [[2, 14, 21, 15]], fences: [[0, 12, 9, 12], [13, 12, 23, 12]],
              bases: [[2, 4, 8, 9, 's'], [15, 4, 19, 8, 's'], [14, 18, 17, 21, 'n'], [3, 18, 10, 23, 'n']] } },
  nordelta: { name: 'Nordelta', partido: 'Tigre', x: 60, y: 20, adj: ['tigre', 'pacheco', 'escobar'], refuge: 'Garita de entrada',
    places: ['Garita de entrada', 'Club del lago', 'Paseo comercial', 'Colegio'],
    layout: { water: [[8, 10, 15, 18], [17, 20, 21, 24]], roads: [[3, 0, 3, 26], [0, 26, 23, 26]], parks: [[16, 2, 22, 7]],
              bases: [[10, 21, 13, 24, 's'], [16, 11, 20, 15, 'n'], [4, 12, 7, 18, 'w'], [5, 3, 10, 7, 's']] } },
  escobar: { name: 'Escobar', partido: 'Escobar', x: 42, y: 10, adj: ['nordelta', 'pacheco', 'pilar'], refuge: 'Cooperativa',
    places: ['Mercado de flores', 'Cruce de la Panamericana', 'Cooperativa', 'Iglesia'],
    layout: { roads: [[11, 0, 12, 31], [0, 13, 10, 13]], fields: [[14, 3, 22, 8], [1, 15, 9, 16]],
              bases: [[2, 4, 8, 9, 's'], [13, 11, 16, 14, 'w'], [15, 20, 21, 24, 'w'], [3, 18, 7, 22, 'e']] } },
  pilar: { name: 'Pilar', partido: 'Pilar', x: 18, y: 24, adj: ['campomayo', 'escobar'], refuge: 'Frigorífico',
    places: ['Parque industrial', 'Frigorífico', 'Playa ferroviaria', 'Capilla'],
    layout: { roads: [[0, 13, 23, 13], [8, 0, 8, 12]], rails: [[0, 16, 23, 16]],
              bases: [[1, 3, 6, 8, 'e'], [16, 3, 22, 9, 'w'], [11, 18, 17, 22, 'n'], [2, 20, 6, 24, 'e']], extra: [[10, 3, 14, 7, 's']] } },
};
const CP_START = {
  florida: ['you', 0], martinez: ['enclave', 0], sanisidro: ['cult', 1], boulogne: ['raiders', 1], pacheco: ['raiders', 1],
  campomayo: ['military', 0], pilar: ['military', 1], olivos: [null, 1], martelli: [null, 2], munro: [null, 1],
  sanfernando: [null, 2], tigre: [null, 3], nordelta: [null, 2], escobar: [null, 2],
};
const CP_FEATURES = {
  hospital: 'Hospital: dos reclutas más por día mientras lo tengas.',
  depot: 'Depósito: tres suministros más por día mientras lo tengas.',
  armory: 'Arsenal: mientras lo tengas, podés armar equipos de ametralladora.',
};
// How hard the campaign pushes. Normal is meant to be hard from the first night; easy is the gentler first version.
// supplies/recruits: to start with; dead: added to the empty districts at the start; cost: supplies every battle takes
// (without them the company goes in on half ammunition); clear: density and turns of a clearing; rivals: extra squads a
// faction fields; truce: days a faction needs after a clash; threat/horde: nightly chances; horde_at: how infested a
// neighbour must be to send a horde; escalate: every so many days the empty districts get worse; first: a horde comes
// for Florida on the first night.
const CP_DIFF = {
  easy: { supplies: 10, recruits: 4, dead: 0, cost: 0, clear: [0.55, 10], rivals: -1, truce: 2, threat: 0.35, horde: 0.3, horde_at: 3, escalate: 0, first: false },
  normal: { supplies: 6, recruits: 2, dead: 1, cost: 2, clear: [0.6, 8], rivals: 1, truce: 1, threat: 0.5, horde: 0.45, horde_at: 3, escalate: 5, first: true },
  hard: { supplies: 4, recruits: 1, dead: 1, cost: 3, clear: [0.85, 8], rivals: 2, truce: 1, threat: 0.6, horde: 0.55, horde_at: 2, escalate: 3, first: true },
};
const cp_diff = (cs) => CP_DIFF[cs.difficulty] || CP_DIFF.normal;

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
    zones: {}, company: [], next_id: 1, supplies: CP_DIFF[cfg.difficulty].supplies, recruits: CP_DIFF[cfg.difficulty].recruits, rep: { enclave: 0 }, truce: { raiders: 0, military: 0, cult: 0 },
    threat: null, event: null, op: null, traded: false, log: [], over: null, stats: { battles: 0, won: 0, kills: 0, lost: 0, saved: 0 },
  };
  for (const [id, [owner, dead]] of Object.entries(CP_START)) cs.zones[id] = { owner, dead: owner === null && !CP_ZONES.florida.adj.includes(id) ? Math.min(3, dead + CP_DIFF[cfg.difficulty].dead) : dead, survivors: 0, cache: false };   // next door stays as it was: the rest is worse
  for (const type of ['line', 'shield', 'line', 'scout']) cp_add_squad(cs, type);
  cp_log(cs, 'Florida es tuya: el gimnasio de la escuela, el súper, la estación. Pasando Av. Maipú todo es de otro, o de los muertos.');
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
  const call = CP_CALLS.find((c) => !used.has(c)) || `Escuadra ${cs.next_id}`;
  const st = bt_type_stats('modern', type);
  const q = { id: cs.next_id++, type, men: st.men, call, name: `${call} · ${CP_TYPES[type]}` };
  cs.company.push(q);
  return q;
}

// ---------------------------------------------------------------- the company between battles
const cp_squad_max = (q) => bt_type_stats('modern', q.type).men;
// Fill a squad's empty places from the recruits: one recruit a man.
function cp_refill(cs, id) {
  const q = cs.company.find((x) => x.id === id);
  if (!q) return 'Esa escuadra no existe.';
  const need = cp_squad_max(q) - q.men;
  if (need <= 0) return 'Ya están completos.';
  if (cs.recruits <= 0) return 'No hay reclutas para mandarles.';
  const n = Math.min(need, cs.recruits);
  q.men += n; cs.recruits -= n;
  return null;
}
// Raise a new squad: recruits for every man, and supplies for their weapons. Machine guns need the armoury.
function cp_raise_cost(type) { return { recruits: BT_TYPES[type].men, supplies: BT_ARMY.cost[type] * 2 }; }
function cp_raise(cs, type) {
  if (!BT_TYPES[type]) return 'Escuadra desconocida.';
  if (cs.company.length >= BT_ARMY.max) return 'Cinco escuadras es todo lo que puede manejar una compañía.';
  if (type === 'heavy' && cs.zones.campomayo.owner !== 'you') return 'Las ametralladoras salen del arsenal de Campo de Mayo.';
  const c = cp_raise_cost(type);
  if (cs.recruits < c.recruits) return `Hacen falta ${c.recruits} reclutas.`;
  if (cs.supplies < c.supplies) return `Hacen falta ${c.supplies} suministros.`;
  cs.recruits -= c.recruits; cs.supplies -= c.supplies;
  const q = cp_add_squad(cs, type);
  cp_log(cs, `Se arma ${q.name}.`);
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
  const w = cp_op_words_base(cs, op), cost = cp_diff(cs).cost;
  if (['clear', 'assault', 'defend', 'rescue'].includes(op.kind) && cost) w.sub += cs.supplies >= cost ? ` Cuesta ${cost} suministros.` : ` No te alcanzan los ${cost} suministros: salen con media munición.`;
  return w;
}
function cp_op_words_base(cs, op) {
  const z = op.zone ? CP_ZONES[op.zone] : null, f = op.by && CP_FACTIONS[op.by];
  switch (op.kind) {
    case 'clear': return { title: `Limpiar ${z.name}`, sub: `Recuperar cuatro edificios de los muertos (${['casi ninguno', 'unos pocos', 'muchos', 'una marea'][cs.zones[op.zone].dead]}).${cs.zones[op.zone].cache ? ' Ahí adentro hay un arsenal de la policía.' : ''}` };
    case 'assault': return { title: `Atacar ${z.name}`, sub: `Sacársela a ${f.name}. Tienen ${cp_held_by(cs, op.by).length} barrios: cuantos más tienen, más gente mandan.` };
    case 'defend': return { title: `Defender ${z.name}`, sub: op.by === 'dead' ? 'Viene una horda. Aguantá el refugio toda la noche.' : `${f.name} vienen a buscarla. Quedate con más edificios que ellos.` };
    case 'abandon': return { title: `Abandonar ${z.name}`, sub: 'Sacás a todos. Perdés el barrio, salvás a la compañía. No gasta el día.' };
    case 'rescue': return { title: `Rescate en ${z.name}`, sub: 'Hay gente encerrada en tres casas. Cada uno que saques es un recluta.' };
    case 'trade': return { title: `Comerciar con ${CP_FACTIONS.enclave.name}`, sub: 'Tres suministros a cambio de su buena voluntad. No gasta el día.' };
    case 'rest': return { title: 'Descansar', sub: `Hoy no se pelea. Los heridos se recuperan: dos reclutas más.${cs.zones.florida.dead ? ' En Florida limpian un nivel de muertos.' : ''}` };
    default: return { title: op.kind, sub: '' };
  }
}

// The battle an operation is fought as: your company, the district's drawn map and places, the enemy it belongs to.
function cp_battle_cfg(cs, op) {
  const zid = op.zone, z = cs.zones[zid], meta = CP_ZONES[zid];
  const cfg = { era: 'modern', zombies: cs.zombies, difficulty: cs.difficulty, seed: Math.floor(cp_rand(cs) * 1073741824), campaign: true, zone: zid, op: op.kind,
                company: cs.company.filter((q) => q.men > 0).map((q) => ({ id: q.id, type: q.type, men: q.men, name: q.name, call: q.call, type_name: CP_TYPES[q.type] })),
                places: meta.places, refuge_name: meta.refuge, layout: meta.layout };
  const held = (f) => cp_held_by(cs, f).length, left = (f) => Math.max(0, Math.min(2, held(f) - 1));
  const D = cp_diff(cs), diff = D.rivals;
  if (op.kind === 'clear') Object.assign(cfg, { objective: 'take', rivals: 'none', density: D.clear[0] + 0.3 * z.dead, turns: D.clear[1] });
  // the size of a faction's company follows the territory behind it
  else if (op.kind === 'assault') Object.assign(cfg, { objective: 'take', rivals: op.by, rival_name: CP_FACTIONS[op.by].name, rival_squads: Math.max(2, Math.min(5, 2 + held(op.by) + diff)), reinforcements: left(op.by), density: 0.4 + 0.2 * z.dead });
  else if (op.kind === 'defend' && op.by === 'dead') Object.assign(cfg, { objective: 'hold', turns: 8, density: 0.5 + 0.15 * Math.max(...meta.adj.map((n) => cs.zones[n].dead)) });
  else if (op.kind === 'defend') Object.assign(cfg, { objective: 'take', rivals: op.by, rival_name: CP_FACTIONS[op.by].name, defend: true, turns: 8, rival_squads: Math.max(2, Math.min(4, held(op.by) + (diff < 0 ? 0 : 1))), reinforcements: Math.min(1, left(op.by)), density: 0.5 });
  else if (op.kind === 'rescue') Object.assign(cfg, { objective: 'rescue', density: 0.5 + 0.3 * z.dead });
  return cfg;
}

// Choose an operation. Battles return their battle config (and wait for cp_finish_battle); the rest happen at once.
function cp_choose(cs, op) {
  if (cs.over || cs.event || cs.op) return { error: 'Ahora no.' };
  const real = cp_ops(cs).find((o) => o.kind === op.kind && o.zone === op.zone);
  if (!real) return { error: 'Eso hoy no se puede.' };
  op = real;
  const z = op.zone ? cs.zones[op.zone] : null;
  if (op.kind === 'abandon') {
    const by = cs.threat.by;
    z.owner = by === 'dead' ? null : by; if (by === 'dead') z.dead = 3;
    cp_log(cs, `Sacaste a todos de ${CP_ZONES[op.zone].name}. ${by === 'dead' ? 'Ahora es de los muertos.' : `Entran ${CP_FACTIONS[by].name}.`}`);
    cs.threat = null;
    return { done: true };
  }
  if (op.kind === 'trade') {
    if (cs.supplies < 3) return { error: 'Para comerciar te hacen falta tres suministros.' };
    cs.supplies -= 3; cs.rep.enclave += 1; cs.traded = true;
    cp_log(cs, `Comerciaste con ${CP_FACTIONS.enclave.name}. No se lo olvidan.`);
    cp_check_alliance(cs);
    return { done: true };
  }
  if (op.kind === 'rest') {
    cs.recruits += 2;
    const fl = cs.zones.florida, scar = fl.dead > 0;
    if (scar) fl.dead--;                                               // a quiet day to clean the streets of home
    cp_log(cs, `Un día sin tiros. Los heridos ya están de pie.${scar ? ' En Florida limpiaron las calles.' : ''}`);
    cp_end_day(cs);
    return { done: true };
  }
  if (!cs.company.some((q) => q.men > 0)) return { error: 'No tenés a quién mandar. Armá una escuadra primero.' };
  cs.op = Object.assign({}, op);
  const cfg = cp_battle_cfg(cs, op), cost = cp_diff(cs).cost;
  if (cs.supplies >= cost) cs.supplies -= cost;                        // ammunition and fuel for the day
  else {
    for (const q of cfg.company) q.ammo = Math.floor(bt_type_stats('modern', q.type).ammo / 2);
    cp_log(cs, 'No alcanzan los suministros: la compañía sale con la mitad de la munición.');
  }
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
  for (const q of cs.company.filter((x) => x.men <= 0)) cp_log(cs, `${q.name} ya no existe. No volvió nadie.`);
  cs.company = cs.company.filter((q) => q.men > 0);
  const f = op.by && CP_FACTIONS[op.by];
  if (op.kind === 'clear') {
    if (won) { z.owner = 'you'; z.dead = 0; cp_log(cs, `${name} es tuya.${z.cache ? ' En el arsenal de la policía había munición: ocho suministros.' : ''}`); if (z.cache) { cs.supplies += 8; z.cache = false; } }
    else { z.dead = Math.min(3, z.dead + 1); cp_log(cs, `Te replegaste de ${name}. Con tanto ruido vinieron más.`); }
  } else if (op.kind === 'assault') {
    if (won) {
      z.owner = 'you'; z.dead = Math.max(0, z.dead - 1); cs.truce[op.by] = Math.max(cs.truce[op.by], cs.day + cp_diff(cs).truce);
      cp_log(cs, `${name} es tuya. ${f.name} se repliegan a lamerse las heridas.`);
      if (!cp_held_by(cs, op.by).length) cp_log(cs, `${f.name} están liquidados: ya no tienen nada.`);
    } else {
      cp_log(cs, `El ataque a ${name} fracasó.`);
      const target = cp_mine(cs).find((id) => CP_ZONES[id].adj.includes(op.zone));
      if (target && !cs.threat && cp_rand(cs) < 0.5) { cs.threat = { zone: target, by: op.by }; cp_log(cs, `${f.name} olieron la debilidad: van por ${CP_ZONES[target].name}.`); }
    }
  } else if (op.kind === 'defend') {
    cs.threat = null;
    if (op.by !== 'dead') cs.truce[op.by] = Math.max(cs.truce[op.by], cs.day + cp_diff(cs).truce);
    else cs.calm = cs.day + 2;                                           // a horde spent: two quiet nights before the next    // win or lose, they need days to come again
    if (won) cp_log(cs, `${name} aguantó.`);
    else cp_lose_zone(cs, op.zone, op.by);
  } else if (op.kind === 'rescue') {
    const n = b ? b.saved || 0 : 0;
    cs.recruits += n; z.survivors = 0;
    cp_log(cs, n ? `Sacaste a ${n} de ${name}. Quieren pelear.` : `De ${name} no salió nadie con vida.`);
    if (won) { cs.rep.enclave += 1; cp_check_alliance(cs); }
  }
  if (won) cs.supplies += 2;                                              // what the winners pick up
  cs.op = null;
  cp_end_day(cs);
}

// A district falls. Florida is home: it is sacked and scarred instead (half the supplies and recruits, one more level of
// the dead), and only when the dead overrun it is the campaign over.
function cp_lose_zone(cs, id, by) {
  const z = cs.zones[id], name = CP_ZONES[id].name;
  if (id === 'florida') {
    cs.supplies = Math.floor(cs.supplies / 2); cs.recruits = Math.floor(cs.recruits / 2); z.dead = Math.min(3, z.dead + 1);
    cp_log(cs, by === 'dead' ? `Los muertos entraron a Florida. La recuperaron calle por calle, pero se perdió la mitad de todo.${z.dead >= 3 ? '' : ` Otra así y no queda nada (${z.dead}/3).`}`
      : `${CP_FACTIONS[by].name} saquearon Florida: se llevaron la mitad de todo, y en el desorden entraron muertos (${z.dead}/3).`);
    return;
  }
  z.owner = by === 'dead' ? null : by; if (by === 'dead') z.dead = 3;
  cp_log(cs, `Perdiste ${name}${by === 'dead' ? ': ahora es de los muertos' : ` a manos de ${CP_FACTIONS[by].name}`}.`);
}

function cp_check_alliance(cs) {
  const home = cp_held_by(cs, 'enclave');
  if (cs.rep.enclave >= 4 && home.length) {
    for (const id of home) cs.zones[id].owner = 'you';
    cp_log(cs, `${CP_FACTIONS.enclave.name} se juegan con vos. ${home.map((id) => CP_ZONES[id].name).join(', ')} es tuyo.`);
  }
}

// ---------------------------------------------------------------- the night: the map moves
function cp_end_day(cs) {
  // a threat nobody answered: they take it
  if (cs.threat) {
    const t = cs.threat;
    cp_log(cs, `Nadie salió a defender ${CP_ZONES[t.zone].name}.`);
    cp_lose_zone(cs, t.zone, t.by);
    cs.threat = null;
  }
  if (cp_check_over(cs)) return;
  // what your districts give
  const mine = cp_mine(cs);
  const supplies = mine.length + (cs.zones.pacheco.owner === 'you' ? 3 : 0), recruits = 1 + Math.floor(mine.length / 2) + (cs.zones.sanfernando.owner === 'you' ? 2 : 0);     // the more barrios, the more people to draw on
  cs.supplies += supplies; cs.recruits += recruits;
  for (const id of Object.keys(cs.zones)) if (cs.zones[id].survivors > 0) cs.zones[id].survivors--;
  // the dead spread out of the worst districts
  for (const id of Object.keys(cs.zones)) {
    if (cs.zones[id].dead < 3 || cp_rand(cs) > 0.5) continue;
    const next = CP_ZONES[id].adj.filter((n) => cs.zones[n].owner !== 'you' && cs.zones[n].dead < 3);
    if (!next.length) continue;
    const n = cp_pick(cs, next), nz = cs.zones[n];
    nz.dead++;
    if (nz.dead >= 3 && nz.owner && nz.owner !== 'you' && cp_rand(cs) < 0.25) { cp_log(cs, `Los muertos arrasaron ${CP_ZONES[n].name}. ${CP_FACTIONS[nz.owner].name} la perdieron.`); nz.owner = null; }
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
    if (yours.length && !cs.threat && cs.truce[f] < cs.day + 1 && (cp_rand(cs) < cp_diff(cs).threat || !open.length)) {
      const t = cp_pick(cs, yours);
      cs.threat = { zone: t, by: f };
      cp_log(cs, `${CP_FACTIONS[f].name} se están juntando para quedarse con ${CP_ZONES[t].name}. Defendela mañana, o la perdés.${t === 'florida' ? ' Si entran a Florida, la saquean.' : ''}`);
    } else if (open.length) {
      const t = cp_pick(cs, open);
      cs.zones[t].owner = f;
      cp_log(cs, `${CP_FACTIONS[f].name} se metieron en ${CP_ZONES[t].name}.`);
    }
  }
  // a horde building up next door
  if (!cs.threat && !(cs.calm > cs.day)) {
    const exposed = mine.filter((id) => CP_ZONES[id].adj.some((n) => cs.zones[n].dead >= cp_diff(cs).horde_at));
    if (exposed.length && cp_rand(cs) < cp_diff(cs).horde) {
      const t = cp_pick(cs, exposed);
      cs.threat = { zone: t, by: 'dead' };
      cp_log(cs, `Se está juntando una horda en el borde de ${CP_ZONES[t].name}. Mañana a la noche viene.`);
    }
  }
  cs.day++; cs.traded = false;
  // the first night: a horde comes up from the General Paz for Florida
  if (cs.day === 2 && cp_diff(cs).first && !cs.threat) {
    cs.threat = { zone: 'florida', by: 'dead' };
    cp_log(cs, 'Una horda sube desde la General Paz, derecho a Florida. Hoy a la noche llega.');
  }
  // the outbreak gets worse: every few days the empty districts fill up
  const esc = cp_diff(cs).escalate;
  if (esc && cs.day % esc === 0) {
    for (const z of Object.values(cs.zones)) if (z.owner === null && z.dead < 2) z.dead++;        // the worst only comes from next door
    cp_log(cs, 'El brote empeora: en los barrios de nadie hay cada vez más muertos.');
  }
  if (cp_check_over(cs)) return;
  // and something happens that asks you to decide
  if (cp_rand(cs) < 0.6) cp_roll_event(cs);
}

function cp_check_over(cs) {
  if (cs.over) return true;
  const mine = cp_mine(cs).length, hostiles = CP.HOSTILE.filter((f) => cp_held_by(cs, f).length);
  if (cs.zones.florida.owner !== 'you' || cs.zones.florida.dead >= 3) cs.over = { victory: false, title: 'Cayó Florida', text: 'El gimnasio, la estación, la gente que confió en vos. Sin Florida no hay adónde volver.' };
  else if (!cs.company.some((q) => q.men > 0) && cs.recruits < 4) cs.over = { victory: false, title: 'No queda nadie', text: 'La compañía ya no existe, y no hay gente para armar otra.' };
  else if (mine >= CP.WIN_ZONES) cs.over = { victory: true, title: 'Zona Norte', text: `${mine} barrios te responden, del río a la Panamericana. No es el mundo que era, pero es tuyo.` };
  else if (!hostiles.length && mine >= 5) cs.over = { victory: true, title: 'No queda contra quién pelear', text: 'Los Segadores, los Milicos y los Renacidos ya no están. Quedan vos, el río y los muertos.' };
  if (cs.over) cs.over.summary = cp_summary(cs);
  return !!cs.over;
}
function cp_summary(cs) {
  return [`Día ${cs.day}. Barrios propios: ${cp_mine(cs).length} de ${Object.keys(cs.zones).length}.`,
    `Batallas: ${cs.stats.battles}, ganadas ${cs.stats.won}. Muertos que volviste a matar: ${cs.stats.kills}.`,
    `Tus caídos: ${cs.stats.lost}. Gente rescatada: ${cs.stats.saved}.`,
    'Compañía: ' + (cs.company.length ? cs.company.map((q) => `${q.name} (${q.men})`).join(', ') : 'ninguna') + '.'];
}

// ---------------------------------------------------------------- encounters: decisions that move the map
// Each returns its data when it can happen now (or null), a text, and choices; a choice changes the state and says what happened.
const CP_EVENTS = [
  { id: 'refugees', when: (cs) => ({}),
    text: () => 'A la noche llegó caminando por las vías del Mitre un grupo desde Capital. Cuarenta personas, con chicos, y nadie les revisó si tienen mordidas.',
    choices: (cs) => [
      { label: 'Recibirlos', sub: '+4 reclutas, -2 suministros. Alguno puede venir mordido.', go: (cs) => {
        cs.recruits += 4; cs.supplies = Math.max(0, cs.supplies - 2);
        if (cp_rand(cs) < 0.35) {
          const id = cp_pick(cs, cp_mine(cs)); cs.zones[id].dead = Math.min(3, cs.zones[id].dead + 1);
          if (!cs.threat && cs.zones[id].dead >= 2) cs.threat = { zone: id, by: 'dead' };
          return `Uno venía mordido, y se dio vuelta en ${CP_ZONES[id].name}.${cs.threat && cs.threat.zone === id ? ' Hay muertos sueltos ahí: hay que aguantarla.' : ''}`;
        }
        return 'Los revisan, les dan de comer y les dan laburo. No se dio vuelta nadie.';
      } },
      cp_held_by(cs, 'enclave').length ? { label: `Mandarlos con ${CP_FACTIONS.enclave.name}`, sub: 'Sube su buena voluntad.', go: (cs) => { cs.rep.enclave++; cp_check_alliance(cs); return `${CP_FACTIONS.enclave.name} los reciben, y se acuerdan de quién se los mandó.`; } } : null,
      { label: 'Rechazarlos', sub: 'No ganás nada, no arriesgás nada.', go: (cs) => { if (cs.rep.enclave > 0) cs.rep.enclave--; return 'Siguen caminando para el norte. Se corre la voz.'; } },
    ] },
  { id: 'truce', when: (cs) => { const z = cp_mine(cs).filter((id) => id !== 'florida' && cp_borders(cs, id, 'military')); return z.length && cs.truce.military < cs.day ? { zone: z[0] } : null; },
    text: (cs, d) => `Se acerca un oficial con bandera blanca. Si les entregás ${CP_ZONES[d.zone].name}, te dejan tranquilo una semana, y encima te tiran un cajón de munición.`,
    choices: (cs, d) => [
      { label: `Entregarles ${CP_ZONES[d.zone].name}`, sub: '+6 suministros y una semana de paz con ellos. El barrio pasa a ser de ellos.', go: (cs) => { cs.zones[d.zone].owner = 'military'; cs.supplies += 6; cs.truce.military = cs.day + 7; return `${CP_ZONES[d.zone].name} ahora es de ellos. El cajón es de verdad.`; } },
      { label: 'Negarte', sub: 'Van a ir a buscarla.', go: (cs) => { if (!cs.threat) cs.threat = { zone: d.zone, by: 'military' }; return `El oficial hace la venia y se va. ${CP_FACTIONS.military.name} van por ${CP_ZONES[d.zone].name}.`; } },
    ] },
  { id: 'toll', when: (cs) => { const z = cp_mine(cs).filter((id) => cp_borders(cs, id, 'raiders')); return z.length && cs.truce.raiders < cs.day ? { zone: cp_pick(cs, z) } : null; },
    text: () => 'Los Segadores pusieron una cadena en la Panamericana y mandaron a un pibe con una nota: cuatro suministros por semana, o vienen a buscarlos.',
    choices: () => [
      { label: 'Pagar el peaje', sub: '-4 suministros, cuatro días tranquilos con ellos.', go: (cs) => { if (cs.supplies < 4) return 'No te alcanza. Lo toman como un no.'; cs.supplies -= 4; cs.truce.raiders = cs.day + 4; return 'Pagás. La cadena baja por un tiempo.'; } },
      { label: 'Mandar al pibe de vuelta con las manos vacías', sub: 'Van a venir.', go: (cs, d) => { if (!cs.threat) cs.threat = { zone: d.zone, by: 'raiders' }; return `Los Segadores van por ${CP_ZONES[d.zone].name}.`; } },
    ] },
  { id: 'preachers', when: (cs) => (cp_held_by(cs, 'cult').length ? { zone: cp_pick(cs, cp_mine(cs)) } : null),
    text: (cs, d) => `Hay predicadores de los Renacidos en ${CP_ZONES[d.zone].name}, diciendo que a los mordidos hay que recibirlos, no matarlos.`,
    choices: () => [
      { label: 'Echarlos', sub: 'Los Renacidos no lo van a perdonar.', go: (cs, d) => { const t = cp_mine(cs).find((id) => cp_borders(cs, id, 'cult')); if (t && !cs.threat) { cs.threat = { zone: t, by: 'cult' }; return `Se van, y los Renacidos marchan sobre ${CP_ZONES[t].name}.`; } return 'Se van, maldiciéndote.'; } },
      { label: 'Dejarlos hablar', sub: 'Cinco días de paz con los Renacidos. Algunos los escuchan.', go: (cs, d) => { cs.truce.cult = cs.day + 5; cs.zones[d.zone].dead = Math.min(3, cs.zones[d.zone].dead + 1); cs.recruits = Math.max(0, cs.recruits - 1); return `Algunos escuchan. Una familia de ${CP_ZONES[d.zone].name} esconde a un hijo mordido. Uno de tus reclutas se va con los predicadores.`; } },
    ] },
  { id: 'medicine', when: (cs) => (cp_held_by(cs, 'enclave').length ? {} : null),
    text: () => 'Los del Unicenter tienen una sala con fiebre y no les quedan antibióticos. Te piden el equivalente a tres suministros.',
    choices: () => [
      { label: 'Dárselos', sub: '-3 suministros; no se lo van a olvidar.', go: (cs) => { if (cs.supplies < 3) return 'No tenés para dar.'; cs.supplies -= 3; cs.rep.enclave += 2; cp_check_alliance(cs); return 'La fiebre baja en la sala.'; } },
      { label: 'Negárselos', sub: 'De eso también se van a acordar.', go: (cs) => { cs.rep.enclave = Math.max(0, cs.rep.enclave - 1); return 'Esa semana entierran a dos.'; } },
    ] },
  { id: 'horde', when: (cs) => {
      if (cs.threat) return null;
      for (const id of cp_mine(cs)) for (const n of CP_ZONES[id].adj) if (cs.zones[n].dead >= 2 && cs.zones[n].owner !== 'you') return { zone: id, from: n, lure: CP_ZONES[n].adj.find((m) => cp_hostile(cs.zones[m].owner)) || null };
      return null; },
    text: (cs, d) => `Una horda baja por Av. del Libertador desde ${CP_ZONES[d.from].name}, para el lado de ${CP_ZONES[d.zone].name}.`,
    choices: (cs, d) => [
      { label: `Esperarla en ${CP_ZONES[d.zone].name}`, sub: 'Una defensa nocturna mañana.', go: (cs) => { cs.threat = { zone: d.zone, by: 'dead' }; return `Todo el que puede agarrar un arma va para ${CP_ZONES[d.zone].name}.`; } },
      { label: 'Cortar la avenida', sub: '-4 suministros: autos, alambre y un bondi prendido fuego atravesado en Libertador. Ahí se frena.', go: (cs) => {
        if (cs.supplies < 4) { cs.threat = { zone: d.zone, by: 'dead' }; return 'No hay con qué armarla. La horda sigue viniendo.'; }
        cs.supplies -= 4; cs.zones[d.from].dead = Math.max(1, cs.zones[d.from].dead - 1); return 'La horda se estrella contra los fierros en Libertador y se desparrama para el norte.';
      } },
      d.lure ? { label: `Llevarla a ${CP_ZONES[d.lure].name}`, sub: `-2 suministros (bengalas, una alarma de auto y un loco al volante). La horda les cae a ${CP_FACTIONS[cs.zones[d.lure].owner].name}.`, go: (cs) => {
        if (cs.supplies < 2) { cs.threat = { zone: d.zone, by: 'dead' }; return 'Sin suministros no hay señuelo. La horda sigue viniendo.'; }
        cs.supplies -= 2; const lz = cs.zones[d.lure], owner = lz.owner; lz.dead = Math.min(3, lz.dead + 2);
        if (lz.dead >= 3) { lz.owner = null; return `La horda dobla para ${CP_ZONES[d.lure].name} y se queda. ${CP_FACTIONS[owner].name} la perdieron.`; }
        return `La horda dobla para ${CP_ZONES[d.lure].name}. ${CP_FACTIONS[owner].name} van a estar ocupados un rato.`;
      } } : null,
      d.zone !== 'florida' ? { label: `Evacuar ${CP_ZONES[d.zone].name}`, sub: 'Perdés el barrio; no perdés a nadie.', go: (cs) => { cs.zones[d.zone].owner = null; cs.zones[d.zone].dead = 3; return `${CP_ZONES[d.zone].name} queda para la horda.`; } } : null,
    ] },
  { id: 'signal', when: (cs) => { const z = cp_frontier(cs).filter((id) => cs.zones[id].survivors === 0 && cs.zones[id].dead >= 1); return z.length ? { zone: cp_pick(cs, z) } : null; },
    text: (cs, d) => `Desde una terraza de ${CP_ZONES[d.zone].name} brilla un espejo, tres veces, y después tres más. Hay alguien vivo ahí.`,
    choices: () => [
      { label: 'Marcarlo para un rescate', sub: 'Durante tres días se puede rescatar ahí.', go: (cs, d) => { cs.zones[d.zone].survivors = 3; return `El rescate en ${CP_ZONES[d.zone].name} está en el mapa.`; } },
      { label: 'No hay a quién mandar', sub: 'No pasa nada.', go: () => 'El espejo brilla dos días más, y después para.' },
    ] },
  { id: 'deserters', when: (cs) => { const f = CP.HOSTILE.filter((x) => cp_held_by(cs, x).length); return f.length ? { by: cp_pick(cs, f) } : null; },
    text: (cs, d) => `Tres desertores de ${CP_FACTIONS[d.by].name} están en tu barricada, armados, pidiendo sumarse.`,
    choices: () => [
      { label: 'Sumarlos', sub: '+3 reclutas. Sus viejos amigos van a querer recuperarlos.', go: (cs, d) => {
        cs.recruits += 3; const t = cp_mine(cs).find((id) => cp_borders(cs, id, d.by));
        if (t && !cs.threat) { cs.threat = { zone: t, by: d.by }; return `Ya están adentro. ${CP_FACTIONS[d.by].name} vienen a ${CP_ZONES[t].name} a buscarlos.`; }
        return 'Ya están adentro.';
      } },
      { label: 'Mandarlos a otro lado', sub: 'Sin problemas.', go: () => 'Se van. Capaz que los agarra otro.' },
    ] },
  { id: 'cache', when: (cs) => { const z = cp_frontier(cs).filter((id) => cs.zones[id].owner === null && !cs.zones[id].cache); return z.length ? { zone: cp_pick(cs, z) } : null; },
    text: (cs, d) => `Uno jura que en ${CP_ZONES[d.zone].name} hay un arsenal de la policía, intacto, debajo de los muertos.`,
    choices: () => [
      { label: 'Marcarlo', sub: 'Limpiar el barrio te da ocho suministros.', go: (cs, d) => { cs.zones[d.zone].cache = true; return `El arsenal de ${CP_ZONES[d.zone].name} está en el mapa.`; } },
      { label: 'Son versiones', sub: 'Nada.', go: () => 'Esa historia ya la escuchaste.' },
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
