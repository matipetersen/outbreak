// ---------------------------------------------------------------- the hall of records (the UI supplies the storage)
const RECORDS_KEEP = 200;
const _rec_key = (r) => r.days * 1e7 + r.score;

function record_entry(game) {
  const e = game.over, c = game.cfg, p = game.player;
  return { scenario: c.scenario, mode: c.mode, era: c.era, zombies: c.zombies, kind: e.kind, title: e.title, days: game_day(game), score: e.score, kills: p.kills, level: p.level, when: Date.now() };
}

// store: { get(): runs[], set(runs) }.  Returns the lines the end screen shows.
function submit_record(game, store) {
  const run = record_entry(game);
  const runs = store.get();
  const same = runs.filter((r) => r.scenario === run.scenario && r.mode === run.mode);
  const best = same.reduce((b, r) => (!b || _rec_key(r) > _rec_key(b) ? r : b), null);
  const rank = 1 + same.filter((r) => _rec_key(r) > _rec_key(run)).length;
  runs.push(run); store.set(runs.slice(-RECORDS_KEEP));
  const name = `${run.scenario} / ${run.mode === 'living' ? 'hardcore' : run.mode}`;
  if (!best) return [`First recorded run of ${name}.`];
  if (_rec_key(run) > _rec_key(best)) return [`NEW RECORD for ${name}: ${run.days} days, ${run.score} points (before: ${best.days} days, ${best.score}).`];
  return [`Record for ${name}: ${best.days} days, ${best.score} points. This run ranks #${rank} of ${same.length + 1}.`];
}

function record_summary(runs) {
  if (!runs.length) return { best: [], latest: [] };
  const groups = {};
  for (const r of runs) { const k = r.scenario + '|' + r.mode; if (!groups[k] || _rec_key(r) > _rec_key(groups[k])) groups[k] = r; }
  return { best: Object.keys(groups).sort().map((k) => groups[k]), latest: runs.slice(-10).reverse() };
}
