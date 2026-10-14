// ---------------------------------------------------------------- the player character
const INVENTORY_SLOTS = 26, MAX_LEVEL = 14, STYLE_RANKS = 5;
const xp_for = (level) => 40 + 35 * (level - 1) + 6 * (level - 1) ** 2;
const is_ranged = (d) => d.style === 'bow' || d.style === 'firearm' || d.style === 'energy';

class Player {
  constructor(uid, x, y, hp) {
    this.kind = 'player'; this.uid = uid; this.name = 'You'; this.glyph = '@'; this.x = x; this.y = y;
    this.hp = hp; this.max_hp = hp; this.level_id = 'world';
    this.stamina = 100; this.max_stamina = 100; this.fatigue = 0; this.panic = 0; this.max_panic = 100; this.humanity = 70; this.hunger = 0;
    this.xp = 0; this.level = 1; this.perk_points = 0; this.perks = {}; this.coins = 0;
    this.inventory = []; this.weapon = null; this.armor = null; this.light = null; this.style_xp = {};
    this.infected = false; this.infection_timer = 0; this.bite_limb = ''; this.bite_window = 0; this.lost = [];
    this.bleeding = 0; this.hemorrhage = false; this.fracture = false; this.filter_turns = 0; this.disguise_turns = 0;
    this.sneaking = false; this.sprinting = false; this.light_on = true;
    this.kills = 0; this.documents = []; this.stats = {};
    this.recipes = CONTENT.recipes.filter((r) => r.starter).map((r) => r.id);   // what you know how to make
  }
  get alive() { return this.hp > 0; }
  mod(key) {
    let total = 0;
    for (const [pid, rank] of Object.entries(this.perks)) {
      const perk = CONTENT.perks[pid];
      if (perk && perk.mods[key] !== undefined) total += perk.mods[key] * rank;
    }
    return total;
  }
  bump(stat, n = 1) { this.stats[stat] = (this.stats[stat] || 0) + n; }
  get evade() { return 5 + this.mod('evade') - (this.fracture ? 6 : 0) - (this.lost.includes('leg') ? 8 : 0) - (this.lost.length >= 2 ? 4 : 0); }
  get capacity() { return INVENTORY_SLOTS - (this.lost.includes('arm') ? 8 : 0); }      // one arm carries less
  style_rank(style) {
    const xp = this.style_xp[style] || 0;
    let rank = 0;
    while (rank < STYLE_RANKS && xp >= Math.floor(8 * (rank + 1) * (rank + 2) / 2)) rank++;
    return rank;
  }
  gain_xp(amount) {
    let gained = 0;
    this.xp += amount;
    while (this.level < MAX_LEVEL && this.xp >= xp_for(this.level)) {
      this.xp -= xp_for(this.level);
      this.level++; this.perk_points++; this.max_hp += 3; this.hp = Math.min(this.max_hp, this.hp + 8);
      this.max_stamina += 2; gained++;
    }
    return gained;
  }
  learn_perk(perk_id) {
    const perk = CONTENT.perks[perk_id], rank = this.perks[perk_id] || 0;
    if (this.perk_points < 1 || rank >= perk.max_rank) return false;
    this.perks[perk_id] = rank + 1;
    this.perk_points--;
    if (perk.mods.max_hp) { this.max_hp += Math.floor(perk.mods.max_hp); this.hp += Math.floor(perk.mods.max_hp); }
    return true;
  }
  grant_perk(perk_id, ranks = 1) {
    const perk = CONTENT.perks[perk_id], have = this.perks[perk_id] || 0, nw = Math.min(perk.max_rank, have + ranks);
    this.perks[perk_id] = nw;
    if (perk.mods.max_hp) { this.max_hp += Math.floor(perk.mods.max_hp) * (nw - have); this.hp = this.max_hp; }
  }
  count(item_id) { return this.inventory.filter((i) => i.id === item_id).reduce((s, i) => s + i.qty, 0); }
  slots_used() { return this.inventory.filter((i) => !i.key).length; }
  can_hold(item, stackable) {
    if (item.key || (stackable && this.inventory.some((i) => i.id === item.id))) return true;
    return this.slots_used() < this.capacity;
  }
  add_item(item, stackable) {
    if (!this.can_hold(item, stackable)) return false;
    if (stackable || item.key) {
      const have = this.inventory.find((i) => i.id === item.id);
      if (have) { have.qty += item.qty; return true; }
    }
    this.inventory.push(item);
    return true;
  }
  take(item_id, qty = 1) {
    if (this.count(item_id) < qty) return false;
    for (const have of this.inventory.slice()) {
      if (have.id !== item_id) continue;
      const used = Math.min(qty, have.qty);
      have.qty -= used; qty -= used;
      if (have.qty <= 0) this.inventory.splice(this.inventory.indexOf(have), 1);
      if (qty <= 0) break;
    }
    return true;
  }
}
