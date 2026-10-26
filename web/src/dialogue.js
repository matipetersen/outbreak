// ---------------------------------------------------------------- what the people of the havens and the roads say to you
// The same line, worded for the age: no rifles or doctorates in the middle ages.
function dlg_era(game, text) {
  if (game.era.id === 'medieval') for (const [o, n] of CONTENT.dialogue.MEDIEVAL_SWAPS) text = text.split(o).join(n);
  return dlg_when(game, text);
}

// The lines were written for people who have lived through weeks of this. The game starts on the day it starts: until enough
// time has passed, what they say about how long it has been follows the calendar (no rank lost on day three, on day one).
const DLG_NUMBERS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
const DLG_WHEN = [
  [/weeks ago/g, (d) => (d >= 14 ? null : d <= 1 ? 'this morning' : d === 2 ? 'yesterday' : d < 7 ? `${DLG_NUMBERS[d - 1]} days ago` : 'a week ago')],
  [/in the first month/g, (d) => (d >= 30 ? null : d < 3 ? 'when this started' : 'in the first days')],
  [/I lose one a week\. I do the sums every Sunday\. It does not get easier, only more regular\./g, (d) => (d >= 8 ? null : 'I have lost two since this started. I keep count. I do not know what else to do with the number.')],
  [/The list is wrong every week\./g, (d) => (d >= 8 ? null : 'The list is wrong every day.')],
  [/since the first night/g, (d) => (d >= 2 ? null : 'since this started')],
  [/They stripped us of rank on day three\./g, (d) => (d >= 4 ? null : 'Command has gone quiet. Rank is just a word now.')],
  [/It has been a while since anybody was\./g, (d) => (d >= 3 ? null : 'It has been hours since anybody was.')],
  [/got (stuck|shut) in (one|a granary) for two days when (it|the bells|the lockdown) started\./g, (d, m) => (d >= 3 ? null : m.replace(' for two days', '').replace(/started\.$/, 'started, and only just got out.'))],
];
function dlg_when(game, text) {
  const d = game_day(game);
  for (const [re, fn] of DLG_WHEN) text = text.replace(re, (m) => { const r = fn(d, m); return r === null ? m : r; });
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
  if (game.saga && npc.faction) saga_meet(game, npc.faction);            // now you know they exist
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
  out.push(...saga_news(game));
  if (game.front) out.push(`"The tide is ${dist_words(game.era.id, Math.max(0, Math.round(front_gap(game))))} behind you, give or take. Do not sleep tonight if you can help it."`);
  if ((game.rep.military || 0) <= -20) out.push('"The soldiers know your name, and not kindly. Be careful on the roads."');
  if ((game.rep.enclave || 0) >= 30) out.push('"People here speak well of you. Do not let it go to your head, but it is nice to hear."');
  return out;
}

function dlg_news(game, npc) {
  const facts = dlg_facts(game).concat(CONTENT.dialogue.RUMOURS[dlg_key(npc)]);
  const line = facts[(npc.uid + (npc.heard || 0)) % facts.length];
  npc.heard = (npc.heard || 0) + 1;
  const told = game._told && game._told[line];                         // what they tell you, you now know
  if (told) { game.pois[told[0]].revealed = true; saga_meet(game, told[1]); }
  if (game.saga && npc.faction) saga_meet(game, npc.faction);
  return dlg_era(game, line);
}
