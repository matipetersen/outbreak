// ---------------------------------------------------------------- the strain changes, district by district (see engine/mutation.py)
const MUTATION_MAX = 4, MUTATION_RAMP = 12, DISTRICT_TILES = 56;
const MUTATION_TRAITS = {
  fleet: ['They move faster than they did.', 'faster', { speed: 1.12 }],
  tough: ['They take more killing: the hides are tougher.', 'tougher', { hp: 1.2 }],
  keen: ['They hear and see more than they did.', 'keener senses', { hearing: 1.2, sight: 1.1 }],
  frenzied: ['They hit harder.', 'harder hitting', { dmg: 1.2 }],
  hulking: ['They have swollen: huge and a little slower.', 'hulking', { hp: 1.35, speed: 0.95 }],
  withered: ['They are wasted and brittle, and much quicker for it.', 'brittle but quick', { hp: 0.8, speed: 1.15 }],
  howling: ['They have found their voices: they hear everything.', 'howling', { hearing: 1.4 }],
  swift: ['They close the distance faster still.', 'swifter', { speed: 1.1 }],
};
const DISTRICT_NOUN = { medical: 'Hospital', market: 'Market', guard: 'Barracks', lab: 'Labs', transit: 'Station', military: 'Garrison', faith: 'Chapel', industry: 'Works' };
const DISTRICT_HOT = { lab: 0.6, military: 0.6, medical: 0.25 };            // places that breed it faster
const _title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function mutation_build(game) {                                              // deterministic from the seed; never touches the game's own dice
  const lv = game.world.level, w = lv.w, h = lv.h, rng = new RNG((game.seed ^ 0x5A17) >>> 0);
  const n = Math.max(6, Math.min(30, Math.round(w * h / (DISTRICT_TILES * DISTRICT_TILES))));
  const cols = Math.max(2, Math.round(Math.sqrt(n * w / h))), rows = Math.max(2, Math.round(n / cols));
  game.regions = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    game.regions.push({ id: game.regions.length, name: '', cx: Math.floor((i + 0.5 + rng.uniform(-0.3, 0.3)) * w / cols), cy: Math.floor((j + 0.5 + rng.uniform(-0.3, 0.3)) * h / rows), heat: 1.0, traits: [], known: false });
  }
  const kinds = game.regions.map(() => ({}));
  for (const poi of Object.values(game.pois)) {
    const r = mutation_region_of(game, poi.x, poi.y);
    kinds[r.id][poi.kind] = (kinds[r.id][poi.kind] || 0) + 1;
    r.heat += (DISTRICT_HOT[poi.kind] || 0) * 0.5;
  }
  mutation_region_of(game, game.world.start[0], game.world.start[1]).heat += 0.5;      // ground zero
  const seen = {};
  for (const r of game.regions) {
    r.heat = Math.min(2.5, r.heat);
    const common = Object.entries(kinds[r.id]).filter(([k]) => DISTRICT_NOUN[k]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const where = Math.abs(r.cx - w / 2) + Math.abs(r.cy - h / 2) > Math.min(w, h) * 0.18 ? compass(r.cx - w / 2, r.cy - h / 2) : 'central';
    const base = `${_title(where)} ${common.length ? DISTRICT_NOUN[common[0]] : 'Fields'}`;
    seen[base] = (seen[base] || 0) + 1;
    r.name = seen[base] === 1 ? base : `${base} ${'I'.repeat(seen[base])}`;
  }
  game.region_id = -1;
}

function mutation_region_of(game, x, y) {
  let best = game.regions[0], bd = Infinity;
  for (const r of game.regions) { const d = (r.cx - x) ** 2 + (r.cy - y) ** 2; if (d < bd) { bd = d; best = r; } }
  return best;
}
function mutation_region_at(game, level, pos) {                              // the overworld by position, a building by where it stands
  if (level.kind !== 'overworld') { const poi = game.poi_of_level(level); if (poi) return mutation_region_of(game, poi.x, poi.y); }
  return mutation_region_of(game, pos[0], pos[1]);
}
const mutation_here = (game) => mutation_region_at(game, game.level, [game.player.x, game.player.y]);
const mutation_traits_text = (r) => r.traits.length ? r.traits.map((t) => MUTATION_TRAITS[t][1]).join(', ') : 'unchanged';

function mutation_strength(game) {
  return game.profile.mutates * game.era.rules.lab * Math.min(1.0, Math.max(0, game_day(game) - 1) / MUTATION_RAMP);
}
const mutation_boost_at = (game, level, pos) => 1.0 + 0.6 * mutation_strength(game) * mutation_region_at(game, level, pos).heat / 1.5;

function _mutate(z, trait) {
  for (const [stat, k] of Object.entries(MUTATION_TRAITS[trait][2])) {
    if (stat === 'speed') z.speed *= k;
    else if (stat === 'hp') { z.hp = Math.max(1, Math.floor(z.hp * k)); z.max_hp = Math.max(1, Math.floor(z.max_hp * k)); }
    else if (stat === 'hearing') z.hearing *= k;
    else if (stat === 'sight') z.sight *= k;
    else if (stat === 'dmg') z.dmg = [Math.max(1, Math.floor(z.dmg[0] * k)), Math.max(Math.floor(z.dmg[0] * k), Math.floor(z.dmg[1] * k))];
  }
}
function mutation_apply(game, z, level, pos) { for (const t of mutation_region_at(game, level, pos).traits) _mutate(z, t); }

function mutation_daily(game) {
  const s = mutation_strength(game);
  if (s <= 0) return;
  const mine = mutation_here(game);
  for (const r of game.regions) {
    if (r.traits.length >= MUTATION_MAX || game.rng.random() >= Math.min(0.8, 0.5 * s * r.heat / 1.5)) continue;
    const left = Object.keys(MUTATION_TRAITS).filter((t) => !r.traits.includes(t));
    const trait = left[game.rng.randint(0, left.length - 1)];
    r.traits.push(trait);
    for (const lv of Object.values(game.levels)) for (const a of lv.actors) if (a.kind === 'zombie' && mutation_region_at(game, lv, [a.x, a.y]) === r) _mutate(a, trait);
    if (r === mine) game.msg(`Day ${game_day(game)}: the strain has changed in the ${r.name}. ${MUTATION_TRAITS[trait][0]}`, 'lore');
    else if (r.known && game.rng.random() < 0.5) game.msg(`Word reaches you: the dead of the ${r.name} have changed (${MUTATION_TRAITS[trait][1]}).`, 'info');
  }
}

function mutation_crossing(game) {                                           // what the dead are like in the district you just crossed into
  const r = mutation_here(game);
  if (r.id === game.region_id) return;
  const first = !r.known;
  game.region_id = r.id; r.known = true;
  if (r.traits.length) game.msg(`You enter the ${r.name}. The dead here are ${mutation_traits_text(r)}.`, 'warn');
  else if (first) game.msg(`You enter the ${r.name}.`, 'info');
}

function mutation_matchup(era, profile) {
  const m = profile.mutates * era.rules.lab;
  const how = m < 0.1 ? 'The strain hardly changes here: the dead of the last day are the dead of the first.'
    : m < 0.4 ? 'The strain changes slowly. Expect a new trait now and then, and not everywhere.'
    : m < 0.8 ? 'The strain changes steadily, district by district; after a couple of weeks it is not what it was.'
    : 'The strain mutates fast here, and differently district by district: labs and bases breed it worst. Expect a new trait every few days somewhere, and the strange ones to multiply.';
  return `${era.rules.feel} ${how}`.trim();
}
