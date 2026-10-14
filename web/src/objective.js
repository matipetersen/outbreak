// ---------------------------------------------------------------- where you are going, said in the log (mirror of engine/objective.py)
const OBJ_WATCH_EVERY = 10;

function objective_snapshot(game) {
  const snap = {};
  for (const [n, done, hint] of game.requirements()) snap[n] = [done, hint];
  const site = game.pois[game.final_site_id];
  snap[cap(game.scenario.final_verb)] = [false, site.revealed ? site.name : 'location unknown'];
  return snap;
}

function objective_watch(game) {
  const t = game.clock.turn;
  if (t % OBJ_WATCH_EVERY) return;
  const now = objective_snapshot(game), before = game.objective_seen || {};
  game.objective_seen = now;
  if (!Object.keys(before).length) {
    const first = Object.entries(now).find(([, v]) => !v[0]);
    if (first) game.msg(`Goal: ${first[0]} (${first[1][1]}).`, 'obj');
    return;
  }
  for (const [name, [done, hint]] of Object.entries(now)) {
    const old = before[name];
    if (!old) continue;
    if (done && !old[0]) game.msg(`Done: ${name}.`, 'obj', true);
    else if (!done && old[0]) game.msg(`Lost: ${name}.`, 'obj');
    else if (hint !== old[1] && !done) game.msg(`${name}: ${hint}.`, 'obj');
  }
  if (t % 240 === 0) {
    const nxt = Object.entries(now).find(([, v]) => !v[0]);
    if (nxt) game.msg(`Day ${game_day(game)}. Still to do: ${nxt[0]} (${nxt[1][1]}).`, 'obj');
  }
}
