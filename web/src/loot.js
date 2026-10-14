// ---------------------------------------------------------------- loot tables
const CATEGORY_WEIGHTS = {
  medical: { med: 6, food: 1, material: 1, tool: 0.5, throw: 0.3 },
  market: { food: 5, material: 2, med: 1.5, tool: 1, armor: 0.8, weapon: 0.8, light: 1, ammo: 0.8 },
  guard: { weapon: 3, ammo: 3, armor: 2, med: 1.5, tool: 1, throw: 1, food: 1 },
  lab: { med: 3, material: 3, tool: 1, throw: 0.5, food: 0.5 },
  transit: { material: 3, tool: 1.5, light: 1, weapon: 1, food: 1, throw: 1 },
  military: { weapon: 3, ammo: 3.5, armor: 2.5, med: 2, food: 1.5, throw: 1.5, tool: 1 },
  faith: { food: 2, med: 2, material: 2, light: 1, weapon: 1 },
  industry: { material: 4, tool: 2.5, weapon: 1.2, throw: 1, light: 1, food: 0.5 },
  house: { food: 3, med: 1.5, material: 2, weapon: 1.2, light: 1, tool: 1, ammo: 0.8, armor: 0.6 },
  camp: { food: 2, weapon: 2, ammo: 2, med: 2, material: 1, throw: 1.5 },
  refuge: { food: 2, med: 2, material: 2 },
  pad: { material: 2, tool: 2, med: 1, food: 1 },
};
const _pool_cache = {};

function _pool(era, kind) {
  const key = era.id + '/' + kind;
  if (_pool_cache[key]) return _pool_cache[key];
  const table = CATEGORY_WEIGHTS[kind] || CATEGORY_WEIGHTS.house;
  const out = [];
  for (const it of Object.values(era.items)) {
    if (it.tags && it.tags.includes('crafted')) continue;                    // made at a workshop, never lying around
    let weight = table[it.kind] || 0;
    if (weight <= 0) continue;
    weight /= Math.pow(it.rarity, 1.4);
    if (it.poi.includes(kind)) weight *= 2.5;
    out.push([it, weight]);
  }
  return (_pool_cache[key] = out);
}

function loot_make_item(rng, it) {
  if (it.kind === 'ammo') return make_item(it.id, rng.randint(3, 8));
  if (it.stackable) return make_item(it.id, it.rarity <= 1 ? rng.randint(1, 2) : 1);
  if (it.durability) return make_item(it.id, 1, Math.max(1, Math.floor(it.durability * rng.uniform(0.4, 1.0))));
  return make_item(it.id, 1);
}

function roll_items(rng, era, kind, count, loot_mult = 1.0) {
  const pool = _pool(era, kind);
  const n = Math.max(0, Math.round(count * loot_mult + rng.uniform(-0.45, 0.45)));
  const out = [];
  if (!pool.length) return out;
  for (let i = 0; i < n; i++) out.push(loot_make_item(rng, weighted_choice(rng, pool)));
  return out;
}

function roll_coins(rng, loot_mult = 1.0) {
  return Math.floor(rng.choice([0, 0, 1, 2, 3, 5]) * loot_mult);
}
