// ---------------------------------------------------------------- what the people of the havens and the roads say to you
// The same line, worded for the age: no rifles or doctorates in the middle ages.
function dlg_era(game, text) {
  if (game.era.id === 'medieval') for (const [o, n] of CONTENT.dialogue.MEDIEVAL_SWAPS) text = text.split(o).join(n);
  return text;
}
const dlg_key = (npc) => (CONTENT.dialogue.PERSONAS[npc.role] ? npc.role : 'survivor');
function dlg_persona(npc) { const g = CONTENT.dialogue.PERSONAS[dlg_key(npc)]; return g[npc.uid % g.length]; }
function dlg_given(game, npc) { const pool = CONTENT.dialogue.GIVEN[game.era.id]; return pool[(npc.uid * 7) % pool.length]; }
function dlg_title(game, npc) { return `${dlg_given(game, npc)}, ${CONTENT.dialogue.ROLE_WORD[npc.role] || 'survivor'}`; }

// The greeting reads your state: bitten, hurt, a first meeting, someone with you, the hour.
function dlg_greeting(game, npc) {
  const p = dlg_persona(npc), pl = game.player, n = npc.chats || 0;
  npc.chats = n + 1;
  let line;
  if (pl.infected) line = p.sick;
  else if (pl.hp < pl.max_hp * 0.5) line = p.hurt;
  else if (n === 0) line = p.first;
  else if (comp_current(game) && n % 3 === 0) line = p.company;
  else if (game.clock.is_night && n % 2 === 1) line = p.night;
  else line = p.again[n % p.again.length];
  if (pl.humanity < 40 && n > 0) line += ' They keep a little distance from you.';
  return dlg_era(game, line);
}

function dlg_about(game, npc) {
  const p = dlg_persona(npc), i = npc.asked || 0;
  npc.asked = i + 1;
  return i < p.bio.length ? dlg_era(game, p.bio[i]) : `${dlg_given(game, npc)} has told you everything worth telling. Which is a kind of answer.`;
}

function dlg_facts(game) {
  const pl = game.player, out = [], P = [pl.x, pl.y];
  const hordes = (game.hordes || []).filter((h) => h.size >= 6);
  if (hordes.length) {
    const h = hordes.reduce((a, b) => (cheb([a.x, a.y], P) <= cheb([b.x, b.y], P) ? a : b));
    if (cheb([h.x, h.y], P) <= 90) out.push(`"A crowd of them is moving, somewhere ${compass(h.x - pl.x, h.y - pl.y)} of here. I would not be on that side tonight."`);
  }
  const cps = Object.values(game.checkpoints || {}).filter((c) => !c.hostile);
  if (cps.length) {
    const c = cps.reduce((a, b) => (cheb([a.x, a.y], P) <= cheb([b.x, b.y], P) ? a : b));
    out.push(`"Soldiers hold the road ${compass(c.x - pl.x, c.y - pl.y)} of here. They search packs. Leave anything you would miss."`);
  }
  const ns = game.nemeses || [];
  if (ns.length) out.push(`"${ns[0].name} is still out there. They say you are the reason they ran. People remember that."`);
  const lost = game.fallen_allies || [];
  if (lost.length) out.push(`"I heard about ${lost[lost.length - 1][0]}. I am sorry. Nobody warns you how often you will say that."`);
  if (game.deadline_days) {
    const left = game.deadline_days - game_day(game);
    out.push(left > 0 ? `"The way out closes after day ${game.deadline_days}. It is day ${game_day(game)}. ${left} to go, if you are counting."` : '"This is the last day. Whatever you mean to do, do it now."');
  }
  if ((game.rep.military || 0) <= -20) out.push('"The soldiers know your name, and not kindly. Be careful on the roads."');
  if ((game.rep.enclave || 0) >= 30) out.push('"People here speak well of you. Do not let it go to your head, but it is nice to hear."');
  return out;
}

function dlg_news(game, npc) {
  const facts = dlg_facts(game).concat(CONTENT.dialogue.RUMOURS[dlg_key(npc)]);
  const line = facts[(npc.uid + (npc.heard || 0)) % facts.length];
  npc.heard = (npc.heard || 0) + 1;
  return dlg_era(game, line);
}
