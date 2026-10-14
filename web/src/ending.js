// ---------------------------------------------------------------- how a run ends
function _band(h) { return h >= 75 ? 'saint' : h >= 40 ? 'survivor' : h >= 15 ? 'cold' : 'monster'; }

// Four short frames for a win, made of the facts of this run: the door you took, who is beside you, what it cost.
function build_cutscene(game, band) {
  const p = game.player, era = game.era, sc = game.scenario, st = CONTENT.story;
  const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const kind = sc.final_site === 'refuge' ? 'cure' : 'out';
  const way = fill(st.WAY_OUT[`${era.id}|${kind}`], { via: game.escape_via || 'door', pad: era.pad, refuge: era.refuge });
  const ally = comp_current(game), pet = pets_current(game), lost = game.fallen_allies || [], parts = [];
  if (ally) parts.push(fill(st.COMPANY[band], { name: ally.name, label: comp_arch(ally) ? comp_arch(ally).label : 'survivor' }));
  if (lost.length) parts.push(fill(st.COMPANY_LOST, { lost: lost[lost.length - 1][0] }));
  if (pet) parts.push(fill(st.COMPANY_PET, { pet: pet.name }));
  if (!parts.length) parts.push(st.COMPANY_ALONE);
  const days = game_day(game), dead = p.stats.zombies || 0, living = p.stats.humans || 0;
  let cost = `${days} day${days !== 1 ? 's' : ''}. ` + (dead ? `${dead} of the dead behind you` : 'You fought as little as you could');
  cost += living ? `, and ${living} living ${living === 1 ? 'person' : 'people'}.` : '.';
  if (p.lost.length) cost += ' Your ' + p.lost.join(' and your ') + ' stayed behind.';
  cost += ' ' + st.COST[band];
  return [way, parts.join(' '), cost, fill(st.AFTERWARDS[band], { sky: st.SKY[era.id] })];
}

function build_ending(game, kind, cause = '') {
  const p = game.player, sc = game.scenario, days = game_day(game);
  const decoded = Object.values(game.docs).filter((d) => p.documents.includes(d.id) && is_decoded(d, game.know)).length;
  const score = p.kills * 2 + days * (sc.escalates ? 40 : 25) + p.humanity + decoded * 8 + p.level * 12 + (kind === 'won' ? 500 : 0);
  const summary = [
    `Survived ${days} day${days !== 1 ? 's' : ''} (${game.clock.turn} turns)`,
    `Zombies destroyed: ${p.stats.zombies || 0}   People killed: ${p.stats.humans || 0}`,
    `Level ${p.level}   Humanity ${p.humanity}   Fluency ${Math.floor(game.know.fluency * 100)}%`,
    `Documents read: ${p.documents.length}   Words known: ${game.know.known.size}/${game.know.vocab.length}`,
  ];
  const pet = pets_current(game);
  if (pet) summary.push(`Travelling with ${pet.name} the ${pet.species}, ${pet.kills || 0} kills together`);
  const ally = comp_current(game);
  if (ally) summary.push(`Travelling with ${ally.name} (${comp_bond_word(ally)}), ${ally.kills} kills together`);
  for (const [name, what] of game.fallen_allies || []) summary.push(`You lost ${name} (${what})`);
  if (game.fallen.length) summary.push(`Survivors lost: ${game.fallen.length}   You were survivor #${game.generation}`);
  if (p.lost.length) summary.push('You lost your ' + p.lost.join(' and your ') + ' to survive.');
  let title, text;
  if (kind === 'won') [title, text] = CONTENT.win_endings[`${sc.id}|${_band(p.humanity)}`];
  else if (sc.escalates && (kind === 'dead' || kind === 'turned')) {
    title = `Survived ${days} day${days !== 1 ? 's' : ''}`;
    text = kind === 'dead' ? (cause ? cap(cause) + '.' : 'You did not make it.') : 'The fever peaks and the world goes quiet. When you open your eyes again, you are hungry.';
    summary.push(`The dead were ${Math.round(game.pressure * 100)}% as strong as on day one when you fell.`);
  } else if (kind === 'turned') {
    title = 'You turned';
    text = 'The fever peaks and the world goes quiet. When you open your eyes again, you are hungry, and the sounds of the living are very loud.';
  } else if (kind === 'left_behind') {
    title = 'Left behind';
    text = `Day ${game.deadline_days + 1} dawns. Somewhere far away, the last way out leaves without you. The dead are patient. You are not.`;
  } else if (kind === 'closed') { title = 'The world is closed'; text = cause; }
  else { title = 'You died'; text = cause ? cap(cause) + '.' : 'You did not make it.'; }
  const chronicle = (game.chronicle || []).map(([, day, t]) => `Day ${day}: ${t}`);
  const last_moments = game.log.slice(-10).map((l) => l[1]);
  const scenes = kind === 'won' ? build_cutscene(game, _band(p.humanity)) : [];
  return { kind, title, text, summary, score, victory: kind === 'won', chronicle, last_moments, scenes };
}
