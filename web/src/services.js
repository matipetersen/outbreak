// ---------------------------------------------------------------- safe-haven services
const HEAL_COST = 6, TEACH_COST = 5, TEACH_WORDS = 3, LEAD_COST = 15, PAPERS_COST = 4;
const STOCK = ['bandage', 'painkiller', 'food', 'medkit', 'filter', 'repair_kit', 'molotov', 'suppressant'];

function refuses(game) {
  if (game.player.humanity < 20) return 'They see what you have become and turn their backs.';
  if ((game.rep.enclave || 0) < -30) return 'Word of what you did has reached them. They will not serve you.';
  return '';
}
function price_mult(game) {
  return Math.max(0.7, 1.5 - (game.rep.enclave || 0) / 200 - (game.player.humanity >= 75 ? 0.15 : 0.0));
}
function stock(game) {
  const out = [];
  const ammo = game.item_def(game.era.defaults.ranged).ammo;
  const ids = STOCK.concat(ammo ? [ammo] : []);
  for (const id of ids) if (game.items[id]) out.push([id, Math.max(1, Math.round(game.item_def(id).value * price_mult(game)))]);
  return out;
}
function buy(game, item_id) {
  const r = refuses(game);
  if (r) return r;
  const entry = stock(game).find((s) => s[0] === item_id), d = game.item_def(item_id);
  if (!entry) return 'Not for sale.';
  const price = entry[1];
  if (game.player.coins < price) return `You need ${price} ${game.era.coin}.`;
  if (!game.player.can_hold(make_item(item_id), d.stackable)) return 'Your pack is full.';
  game.player.coins -= price;
  game.player.add_item(make_item(item_id, 1), d.stackable);
  return `Bought ${d.name.toLowerCase()} for ${price}.`;
}
function sell_price(game, item) {
  const d = game.item_def(item.id);
  return Math.max(0, Math.floor((d.kind !== 'component' ? d.value : 0) * 0.5 * item.qty));
}
function sell(game, index) {
  const r = refuses(game);
  if (r) return r;
  const p = game.player;
  if (!(index >= 0 && index < p.inventory.length)) return 'Nothing there.';
  const item = p.inventory[index], d = game.item_def(item.id);
  if (d.kind === 'component') return 'You are not selling that.';
  const price = sell_price(game, item);
  if (price <= 0) return 'They are not interested.';
  p.coins += price;
  p.inventory.splice(index, 1);
  return `Sold ${d.name.toLowerCase()} for ${price}.`;
}
function heal_service(game) {
  const r = refuses(game);
  if (r) return r;
  const p = game.player;
  if (p.coins < HEAL_COST) return `The healer wants ${HEAL_COST} ${game.era.coin}.`;
  p.coins -= HEAL_COST; p.hp = p.max_hp; p.bleeding = 0; p.fracture = false;
  return 'The healer patches you up.';
}
function teach(game) {
  const r = refuses(game);
  if (r) return r;
  const p = game.player;
  if (p.coins < TEACH_COST) return `The ${game.era.cipher_name.toLowerCase()} lessons cost ${TEACH_COST} ${game.era.coin}.`;
  const learned = game.know.learn_random(game.rng, TEACH_WORDS);
  if (!learned.length) return 'There is nothing left they can teach you.';
  p.coins -= TEACH_COST;
  return `You learn: ${learned.join(', ')}.`;
}
function buy_lead(game) {
  const r = refuses(game);
  if (r) return r;
  if (game.player.coins < LEAD_COST) return `A lead costs ${LEAD_COST} ${game.era.coin}.`;
  if (!game.reveal_random_lead()) return 'They have nothing new to tell you.';
  game.player.coins -= LEAD_COST;
  return 'They tell you where to look.';
}

// the archivist knows where written pages were left: the nearest buildings that still hold some
function ask_papers(game) {
  const r = refuses(game);
  if (r) return r;
  const p = game.player;
  if (p.coins < PAPERS_COST) return `That costs ${PAPERS_COST} ${game.era.coin}.`;
  const found = game.reveal_paper_leads(2);
  if (!found.length) return 'They know of no more pages that you have not read.';
  p.coins -= PAPERS_COST;
  return 'Pages were left in ' + found.map((q) => `the ${q.name}, ${compass(q.x - p.x, q.y - p.y)}, about ${dist_words(game.era.id, cheb(poi_pos(q), [p.x, p.y]))}`).join(' and in ') + '. They are marked on your map.';
}

const PATROL_LINES = {
  scout: ['"Keep to the roads and off the high ground. They see you up there."',
          '"We bring the stragglers in when we can. Not every day we can."',
          '"Camps to the east are not friendly. Do not go knocking."'],
  soldier: ['"Move along, civilian. This sector is not clear."',
            '"We hold the roads. Beyond that you are on your own."',
            '"Noise draws them. Noise draws the other kind too."'],
};

const MAX_COMPANIONS = 1, JOIN_TRUST = 15;

function companions(game) { const c = comp_current(game); return c ? [c] : []; }

// A passing patrol: wary, but willing to share one tip with someone who still looks human.
function talk_patrol(game, npc) {
  const name = npc.name.toLowerCase();
  if (game.player.humanity < 20) return `The ${name} looks at what you have become, and does not lower their weapon.`;
  if (game.aided[npc.group] === false) {
    game.aided[npc.group] = true;
    game.rep[npc.faction] = (game.rep[npc.faction] || 0) + 10;
    game.adjust_humanity(4, '');
    npc.talked = true;
    const gift = game.items.medkit ? 'medkit' : 'bandage';
    game.give_item(make_item(gift, 1));
    game.reveal_random_lead();
    return `The ${name} grips your arm. "You came when we called. We do not forget that." They press a ${game.item_def(gift).name.toLowerCase()} into your hand and tell you what they know.`;
  }
  if (!npc.talked) {
    npc.talked = true;
    game.rep[npc.faction] = (game.rep[npc.faction] || 0) + 2;
    const hello = dlg_greeting(game, npc);
    if (game.reveal_random_lead()) return `${hello}\n\nThen the ${name} lowers their weapon and tells you where they have seen something worth finding.`;
    return `${hello}\n\nThe ${name} has no leads for you, but nods and wishes you luck.`;
  }
  return dlg_greeting(game, npc);
}

// Why this person will not travel with you, or an empty string.
function join_refusal(game, npc) { return comp_refusal(game, npc); }

function ask_join(game, npc) {
  const why = join_refusal(game, npc);
  if (why) return why;
  comp_recruit(game, npc);
  return `${npc.name} falls in beside you. They will fight what you fight, and come in with you when you go through a door.`;
}

function dismiss(game, npc) { return comp_dismiss(game, npc); }
