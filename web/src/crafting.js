// ---------------------------------------------------------------- making weapons, arrows and shields (web only)
// Every weapon, arrow and shield recipe is known from the start and can be made anywhere. A workshop still matters: beside one
// the work is faster and the result sturdier (away from it a weapon or shield comes out at 60% condition, arrows one fewer).
// Shields are a new kind of item, worn in the off hand: they block a share of the blows that land, until they break. They need
// the other hand free, so not with a bow, a polearm or a long gun.
const AWAY_FROM_WORKSHOP_DUR = 0.6, AWAY_FROM_WORKSHOP_TURNS = 1.5;
const TWO_HANDED_STYLES = ['bow', 'polearm'];

const SHIELDS = [
  { id: 'shield', block: 0.22, durability: 30, value: 6, desc: 'Boards and straps. It will turn a few blows before it splits.',
    names: { medieval: 'Wooden buckler', eighties: 'Plank shield', modern: 'Plank shield', scifi: 'Hull-plate shield' } },
  { id: 'shield_good', block: 0.34, durability: 55, value: 12, desc: 'Rimmed and faced with metal. It holds.',
    names: { medieval: 'Iron-rimmed shield', eighties: 'Scrap riot shield', modern: 'Scrap riot shield', scifi: 'Reinforced hull shield' } },
];
for (const era of Object.values(CONTENT.eras)) {
  for (const s of SHIELDS) {
    era.items[s.id] = { id: s.id, name: s.names[era.id], kind: 'shield', desc: s.desc, value: s.value, stackable: false, tags: ['crafted'], rarity: 1,
                        poi: [], style: '', dmg: [0, 0], reach: 1, noise: 0, durability: s.durability, ammo: '', accuracy: 0, head: 0, defense: 0,
                        bite_guard: 0, stealth: 0, light: 0, effect: {}, block: s.block };
  }
}

// What the Python packs call 'workshop' recipes become 'better at a workshop'; weapons and arrows are known by everyone.
const ARMS = ['nailbat', 'shiv', 'pike', 'scrapbow', 'shaft'];
for (const r of CONTENT.recipes) {
  if (r.needs === 'workshop') { r.needs = ''; r.workshop = true; }
  if (ARMS.includes(r.id)) r.starter = true;
}
CONTENT.recipes.push(
  { id: 'bow', out: 'bow', qty: 1, inputs: [['wood', 4], ['cloth', 2]], fluency: 0, needs: '', turns: 10, starter: true, workshop: true },
  { id: 'spear', out: 'spear', qty: 1, inputs: [['wood', 2], ['scrap', 1]], fluency: 0, needs: '', turns: 6, starter: true, workshop: true },
  { id: 'arrows', out: 'arrow', qty: 4, inputs: [['wood', 1], ['scrap', 1]], fluency: 0, needs: '', turns: 4, starter: true, workshop: true },
  { id: 'darts', out: 'dart', qty: 4, inputs: [['scrap', 1], ['chem', 1]], fluency: 0, needs: '', turns: 4, starter: true, workshop: true },
  { id: 'shield', out: 'shield', qty: 1, inputs: [['wood', 3], ['scrap', 1]], fluency: 0, needs: '', turns: 6, starter: true, workshop: true },
  { id: 'shield_good', out: 'shield_good', qty: 1, inputs: [['wood', 2], ['scrap', 4], ['cloth', 1]], fluency: 0, needs: '', turns: 10, starter: true, workshop: true },
);

const at_workshop = (game) => !!game.adjacent_tile(T.WORKSHOP);
const recipe_turns = (game, r) => (r.workshop && !at_workshop(game) ? Math.ceil(r.turns * AWAY_FROM_WORKSHOP_TURNS) : r.turns);

// The item you get: away from a workshop a weapon or shield is rougher, and you get one arrow fewer.
function crafted_item(game, r, out) {
  const d = game.item_def(out), rough = r.workshop && !at_workshop(game);
  if (d.kind === 'ammo') return make_item(out, Math.max(1, r.qty - (rough ? 1 : 0)));
  const dur = d.durability ? Math.max(1, Math.ceil(d.durability * (rough ? AWAY_FROM_WORKSHOP_DUR : 1))) : null;
  return make_item(out, r.qty, dur);
}

function two_handed(game) {
  const w = game.player.weapon ? game.item_def(game.player.weapon.id) : null;
  if (!w) return false;
  if (TWO_HANDED_STYLES.includes(w.style)) return true;
  return (w.style === 'firearm' || w.style === 'energy') && w.id !== 'pistol';
}

// A blow that would land: the shield may take it instead. True if it was blocked.
function shield_block(game, attacker) {
  const p = game.player, s = p.shield;
  if (!s || two_handed(game)) return false;
  const d = game.item_def(s.id);
  if (game.rng.random() >= d.block) return false;
  s.dur = (s.dur === null || s.dur === undefined ? d.durability : s.dur) - (attacker.dmg && attacker.dmg[1] >= 9 ? 2 : 1);
  game.msg(`You catch the ${attacker.name.toLowerCase()}'s blow on your ${d.name.toLowerCase()}.`, 'combat');
  game.emit_noise([p.x, p.y], 3);
  if (s.dur <= 0) { game.msg(`Your ${d.name.toLowerCase()} splits apart!`, 'bad'); p.shield = null; }
  return true;
}
