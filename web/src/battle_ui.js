// ================================================================ OUTBREAK: the battle front-end (WEGO squads, see battle.js)
// Plan: tap a squad (or its card), then tap where it should go or drag a route from it; set its stance, pace and special
// action; EXECUTE. Resolve: the turn plays out on its own (x1, x2, x4 or skip), then the report and the next plan.
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const UI = window.OB_UI;
function el(tag, cls, content) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content !== undefined && content !== null) for (const c of (Array.isArray(content) ? content : [content])) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const btn = (cls, label, onclick) => { const b = el('button', cls, label); b.type = 'button'; if (onclick) b.addEventListener('click', onclick); return b; };
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
const SQUAD_COL = ['#d99a2b', '#55b3c4', '#c79bf2', '#7fd18b', '#e2573f'];
const TILE_COL = { 0: '#16241a', 1: '#262d30', 2: '#1b2225', 3: '#394249', 4: '#0f2016', 5: '#12271a', 6: '#2a2724', 7: '#16241a', 8: '#0d2a40', 9: '#3a2c1a', 10: '#394249', 11: '#2a2724' };
const TILE_SPR = { 0: ['grass_a', 'grass_b'], 1: ['road'], 2: ['floor_a', 'floor_b'], 3: ['wall'], 4: ['tree', 'tree_b'], 5: ['brush'], 6: ['rubble'], 7: ['fence'], 8: ['water'], 9: ['floor_a'], 10: ['wall'], 11: ['floor_a'] };

let b = null, sel = null, mode = null, speed = 2, playing = false, lastT = 0, acc = 0, prev = new Map(), fxs = [], decals = [], vis = null, report = [], sndAt = 0;
let cv = null, ctx = null, view = { ox: 0, oy: 0, ts: 16 }, drag = null, raf = 0, setupCfg = null, ro = null;

// ---------------------------------------------------------------- setup screen
function setup() {
  UI.hideAll();
  const s = $('#newgame'); s.hidden = false;
  setupCfg = setupCfg || Object.assign({ era: 'modern', zombies: 'classic', objective: 'hold', difficulty: 'normal', seed: null }, UI.lsGet('outbreak.battlecfg', {}), { seed: null });
  const render = () => {
    s.innerHTML = '';
    const w = el('div', 'wrap form'), head = el('h2', 'logo', 'Battle'); head.style.fontSize = '40px';
    w.append(el('div', 'fileno', 'Field orders · squads against the dead'), head);
    w.append(el('p', 'note', 'Turn based, and both sides move at once: give every squad its orders, then watch the turn play out. You cannot change anything until it ends.'));
    const group = (title, key, items, blurb, cols) => {
      w.append(el('h3', null, title));
      const box = el('div', 'opts' + (cols ? ' cols' : ''));
      for (const [id, name, sub] of items) {
        const o = el('button', 'opt' + (setupCfg[key] === id ? ' on' : ''), [el('b', null, name), sub ? el('small', null, sub) : null]); o.type = 'button';
        o.addEventListener('click', () => { setupCfg[key] = id; render(); });
        box.append(o);
      }
      w.append(box);
      if (blurb) w.append(el('div', 'blurb', blurb()));
    };
    group('Objective', 'objective', Object.entries(BT_OBJECTIVES).map(([id, o]) => [id, o.name, `${o.turns} turns`]), () => BT_OBJECTIVES[setupCfg.objective].blurb, true);
    if (setupCfg.objective === 'take') {
      setupCfg.rivals = BT_RIVALS[setupCfg.rivals] ? setupCfg.rivals : 'raiders';
      const fs = CONTENT.eras[setupCfg.era].factions;
      group('Who you are up against', 'rivals', Object.keys(BT_RIVALS).map((id) => [id, fs[id][0], null]), () => `${fs[setupCfg.rivals][1]} ${BT_RIVALS[setupCfg.rivals].words}`, true);
    }
    group('When', 'era', Object.values(CONTENT.eras).map((e) => [e.id, `${e.year} · ${(e.name.split(' - ')[1] || e.name)}`, null]), null);
    armyBuilder(w, render);
    const pz = CONTENT.presets[setupCfg.zombies];
    group('The dead', 'zombies', Object.values(CONTENT.presets).map((z) => [z.id, z.name.split(' - ')[0], z.inspired_by]), () => pz.blurb + ' ' + bt_preset_note(pz));
    group('Difficulty', 'difficulty', ['easy', 'normal', 'hard'].map((d) => [d, d[0].toUpperCase() + d.slice(1), null]), null, true);
    w.append(el('h3', null, 'Seed (optional)'));
    const row = el('div', 'seed'), inp = el('input'); inp.type = 'number'; inp.placeholder = 'random'; inp.inputMode = 'numeric'; inp.value = setupCfg.seed === null ? '' : setupCfg.seed;
    inp.addEventListener('input', () => { setupCfg.seed = inp.value === '' ? null : Math.abs(parseInt(inp.value, 10)) % 1073741824; });
    row.append(inp); w.append(row);
    const go = el('div', 'sticky'), forces = companyOf(), err = bt_forces_error(forces);
    const deploy = btn('btn main', err ? err : 'DEPLOY', () => { UI.lsSet('outbreak.battlecfg', Object.assign({}, setupCfg, { seed: null })); start(bt_new(Object.assign({}, setupCfg, { forces }))); });
    deploy.disabled = !!err;
    go.append(deploy);
    w.append(go, btn('btn', 'Back', UI.showTitle));
    s.append(w); s.scrollTop = 0;
  };
  render();
}

// The company: the standard one for the objective until the player changes it, then theirs (kept between battles).
const ROLE = { line: 'Steady fire at range.', shield: 'Holds a doorway in close combat; builds barricades.', heavy: 'Huge firepower once set up. Loud, and hungry for ammunition.', scout: 'Fast and quiet, sees farther, throws lures. Set up in cover, a hidden sniper.' };
const companyOf = () => (setupCfg.forces ? setupCfg.forces.slice() : BT_OBJECTIVES[setupCfg.objective].forces.slice());
function armyBuilder(w, render) {
  const era = BT_ERAS[setupCfg.era] || BT_ERAS.modern, forces = companyOf(), spent = bt_forces_cost(forces), left = BT_ARMY.budget - spent;
  const edit = (next) => { setupCfg.forces = next; render(); };
  w.append(el('h3', null, `Your company · ${spent}/${BT_ARMY.budget} points · ${forces.length}/${BT_ARMY.max} squads`));
  const list = el('div', 'bt-army');
  forces.forEach((t, i) => {
    const st = bt_type_stats(setupCfg.era, t);
    const row = el('div', 'bt-arow', [el('span', 'bt-dot'), el('div', 'bt-amain', [el('b', null, era.names[t]), el('small', null, `${st.men} men · ${era.weapons[t]}`)]), el('span', 'bt-acost', `${BT_ARMY.cost[t]}`)]);
    row.querySelector('.bt-dot').style.background = SQUAD_COL[i % SQUAD_COL.length];
    const x = btn('bt-ax', '×', () => { const n = forces.slice(); n.splice(i, 1); edit(n); });
    x.setAttribute('aria-label', 'remove ' + era.names[t]); x.disabled = forces.length <= 1;
    row.append(x); list.append(row);
  });
  w.append(list);
  const add = el('div', 'opts cols');
  for (const t of Object.keys(BT_TYPES)) {
    const st = bt_type_stats(setupCfg.era, t), c = BT_ARMY.cost[t];
    const o = el('button', 'opt', [el('b', null, `+ ${era.names[t]} · ${c}`), el('small', null, `${st.men} men${st.range ? `, range ${st.range}` : ', close combat'}. ${ROLE[t]}`)]); o.type = 'button';
    o.disabled = c > left || forces.length >= BT_ARMY.max;
    o.addEventListener('click', () => edit(forces.concat([t])));
    add.append(o);
  }
  w.append(add);
  const std = btn('btn', 'Standard company', () => edit(null)); std.style.marginTop = '8px'; std.disabled = !setupCfg.forces;
  w.append(std);
  w.append(el('div', 'blurb', 'The first squads take the posts nearest the danger. ' + (forces.includes('shield') ? '' : 'Without a shield squad you cannot build barricades. ') + (forces.includes('scout') ? '' : 'Without scouts you have no lures.')));
}

// What the preset changes on a battlefield, in one line.
function bt_preset_note(p) {
  const out = [];
  if (p.kill_rule === 'head') out.push('Only head shots kill: most hits only slow them.');
  if (p.turn_on_death) out.push('Your dead get up again.');
  if (p.incubation < 100) out.push('A bite turns a man within seconds.');
  if (p.swarm) out.push('Fences do not stop them; barricades fall fast.');
  if (p.sun_burn) out.push('They burn in daylight and hide in buildings; at dusk they come out fast.');
  if (p.vector === 'spore') out.push('Closed rooms are full of spores.');
  if (p.smell) out.push('They smell you through walls.');
  if (p.mutates >= 1) out.push('Worse things come out every turn.');
  return out.join(' ');
}

// ---------------------------------------------------------------- the battle screen
function resume() { const saved = bt_load(); if (saved) start(saved); else UI.showTitle(); }

function start(battle) {
  b = battle; sel = (b.squads.find((s) => bt_mine(s) && s.men.length) || {}).id || null; mode = null; playing = false; prev = new Map(); fxs = []; decals = []; report = b.report.slice();
  UI.hideAll();
  const s = $('#battle'); s.hidden = false; s.innerHTML = '';
  s.append(el('div', 'bt-top', [el('div', 'bt-status', ''), btn('bt-menu', 'Menu', openMenu)]));
  const field = el('div', 'bt-field'); cv = el('canvas'); field.append(cv); s.append(field);
  s.append(el('div', 'bt-panel'));
  ctx = cv.getContext('2d');
  bindInput();
  if (b.phase === 'plan') bt_save(b);
  renderPanel();
  if (ro) ro.disconnect();
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(field); } else window.addEventListener('resize', resize);
  resize();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}

function leave() {
  playing = false; cancelAnimationFrame(raf); raf = 0; b = null;
  if (ro) { ro.disconnect(); ro = null; }
  window.removeEventListener('resize', resize);
  UI.showTitle();
}

function resize() {
  if (!cv || !b) return;
  const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  const ts = Math.max(8, Math.min(r.width / b.w, r.height / b.h));
  view = { ts, ox: (r.width - ts * b.w) / 2, oy: (r.height - ts * b.h) / 2, dpr, W: r.width, H: r.height };
  vis = bt_visibility(b);
}

// ---------------------------------------------------------------- the panel: squads, their orders, the turn button
function stateWord(s) { return !s.men.length ? 'lost' : s.state === 'broken' ? 'broken' : s.state === 'shaken' ? 'shaken' : 'steady'; }
function bar(frac, col) { const t = el('div', 'bt-bar'), f = el('div', 'bt-fill'); f.style.width = Math.round(100 * Math.max(0, Math.min(1, frac))) + '%'; f.style.background = col; t.append(f); return t; }

function renderPanel() {
  if (!b) return;
  const p = $('#battle .bt-panel'); p.innerHTML = '';
  renderStatus();
  if (b.over) return;
  // squad cards (read-only while the turn plays)
  const cards = el('div', 'bt-cards');
  b.squads.filter(bt_mine).forEach((s, i) => {
    const st = bt_type_stats(b.era, s.type);
    const c = el('button', 'bt-card' + (s.id === sel ? ' on' : '') + (s.men.length ? '' : ' lost'));
    c.type = 'button'; c.style.borderColor = s.id === sel ? SQUAD_COL[i % SQUAD_COL.length] : '';
    const pips = '●'.repeat(s.men.length) + '○'.repeat(Math.max(0, st.men - s.men.length));
    c.append(el('div', 'bt-cname', [el('span', 'bt-dot'), s.call || s.name]), el('div', 'bt-ctype', BT_ERAS[b.era].names[s.type]), el('div', 'bt-pips', pips),
      s.ammo_max ? bar(s.ammo / s.ammo_max, '#d99a2b') : el('div', 'bt-bar none'), bar(s.morale / 100, s.state === 'broken' ? '#e2573f' : s.state === 'shaken' ? '#d4a52a' : '#58b878'),
      el('div', 'bt-cstate', `${stateWord(s)}${bt_settled(b, s) ? ' · hidden' : ''}${s.path.length ? ' · moving' : ''}${s.ability ? ' · ' + s.ability.kind : ''}`));
    c.querySelector('.bt-dot').style.background = SQUAD_COL[i % SQUAD_COL.length];
    c.addEventListener('click', () => { if (playing) return; sel = s.id; mode = null; renderPanel(); });
    cards.append(c);
  });
  p.append(cards);
  if (playing) {
    const row = el('div', 'bt-row');
    for (const v of [1, 2, 4]) row.append(btn('bt-seg' + (speed === v ? ' on' : ''), `x${v}`, () => { speed = v; renderPanel(); }));
    row.append(btn('bt-seg', 'Skip', skip));
    p.append(row, el('div', 'bt-feed', report.slice(-4).map((l) => el('div', null, l))));
    return;
  }
  const s = b.squads.find((q) => q.id === sel);
  if (s && s.men.length) {
    const row = el('div', 'bt-row');
    row.append(btn('bt-seg' + (s.stance === 'fire' ? ' on' : ''), 'Fire at will', () => { bt_set(b, s.id, { stance: 'fire' }); renderPanel(); }),
      btn('bt-seg' + (s.stance === 'hold' ? ' on' : ''), 'Hold fire', () => { bt_set(b, s.id, { stance: 'hold' }); renderPanel(); }));
    row.append(el('span', 'bt-gap'));
    row.append(btn('bt-seg' + (s.pace === 'walk' ? ' on' : ''), 'Walk', () => { bt_set(b, s.id, { pace: 'walk' }); renderPanel(); }),
      btn('bt-seg' + (s.pace === 'run' ? ' on' : ''), 'Run', () => { bt_set(b, s.id, { pace: 'run' }); renderPanel(); }));
    p.append(row);
    const row2 = el('div', 'bt-row');
    const kind = BT_TYPES[s.type].ability, era = BT_ERAS[b.era];
    if (kind === 'lure') row2.append(btn('bt-seg' + (mode === 'ability' ? ' on' : ''), `Lure: ${era.lure} (${s.lures_left})`, () => { mode = mode === 'ability' ? null : 'ability'; renderPanel(); }));
    if (kind === 'barricade') row2.append(btn('bt-seg' + (mode === 'ability' ? ' on' : ''), `Barricade (${b.barricades_left} left)`, () => { mode = mode === 'ability' ? null : 'ability'; renderPanel(); }));
    row2.append(btn('bt-seg', 'Stop', () => { bt_clear(b, s.id); mode = null; renderPanel(); }));
    p.append(row2);
    p.append(el('div', 'bt-hint', mode === 'ability' ? (kind === 'lure' ? 'Tap where the lure should go (within 10 tiles). The dead go to the noise for two turns.' : 'Tap a tile within 3 tiles of where the squad stops. They need 4 quiet seconds there to build it.')
      : s.state === 'broken' ? 'Broken: they run for safety and ignore orders until they rally.'
      : `${cap(era.weapons[s.type])}${bt_type_stats(b.era, s.type).range ? '' : ', close combat only'}. ${s.type === 'scout' ? ' Left still in brush or a building, they snipe unseen.' : ''} Tap the map to move them, or drag a route from the squad.`));
  }
  if (report.length) p.append(el('div', 'bt-feed', report.slice(-4).map((l) => el('div', null, l))));
  const go = btn('btn main bt-go', `EXECUTE TURN ${b.turn}`, execute);
  p.append(go);
}

function renderStatus() {
  const st = $('#battle .bt-status'); if (!st || !b) return;
  const h = bt_hour(b) % 24, hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
  const light = bt_dark(b) ? 'dark' : (h >= 18.75 && h < 19.5) || (h >= 6 && h < 6.75) ? 'dim' : 'day';
  let goal = '';
  if (b.refuge) goal = `Refuge ${Math.round(b.refuge.integrity)}%`;
  else if (b.bases.length) goal = `Bases ${b.bases.filter((q) => q.owner === 'you').length}–${b.bases.filter((q) => q.owner === 'rival').length}`;
  else goal = `Saved ${b.saved}/${b.civ_total}${b.civ_lost ? ` · lost ${b.civ_lost}` : ''}`;
  let wave = '';
  if (b.phase === 'plan' && b.wave) wave = b.wave.inside ? `Next: ${b.wave.words} waking in the buildings` : `Next: ${b.wave.words} from the ${b.wave.sides.join(' and ')}`;
  st.innerHTML = '';
  st.append(el('div', 'bt-l1', [el('b', null, `Turn ${Math.min(b.turn, b.turns)}/${b.turns}`), ` · ${hh}:${mm} ${light} · `, el('b', null, goal)]), el('div', 'bt-l2', wave || (playing ? 'Orders locked.' : '')));
}

// ---------------------------------------------------------------- the turn
function execute() {
  if (!b || playing || b.over) return;
  mode = null;
  if (!bt_begin_turn(b)) return;
  report = b.report.slice();
  playing = true; acc = 0; lastT = performance.now();
  renderPanel();
}
function skip() { while (b && b.phase === 'resolve' && !b.over) step(); finishTurn(); }

function step() {
  prev = new Map();
  for (const u of b.men) prev.set(u.id, [u.x, u.y]);
  for (const u of b.zeds) prev.set(u.id, [u.x, u.y]);
  for (const u of b.civs) prev.set(u.id, [u.x, u.y]);
  const out = bt_tick(b), now = performance.now();
  let shot = false, kill = false;
  for (const f of out) {
    f.at = now;
    if (f.kind === 'shot') { shot = true; if (fxs.length < 400) fxs.push(f); }
    else if (f.kind === 'zdie' || f.kind === 'mdie' || f.kind === 'burn') { kill = true; decals.push({ x: f.x, y: f.y, man: f.kind === 'mdie' }); if (decals.length > 300) decals.shift(); fxs.push(f); }
    else fxs.push(f);
    if (f.kind === 'scream') audio_play('scream');
    if (f.kind === 'turn' || f.kind === 'broke') audio_play('stinger');
    if (f.kind === 'break' || f.kind === 'burst' || f.kind === 'glass') audio_play('smash');
    if (f.kind === 'build' || f.kind === 'saved') audio_play('good');
    if (f.kind === 'taken') audio_play('warn');
  }
  if (shot && now - sndAt > 110) { audio_play('shoot'); sndAt = now; }
  if (kill) audio_play('kill');
  if (b.report.length !== report.length) { report = b.report.slice(); if (playing) renderPanel(); }
}

function finishTurn() {
  playing = false; prev = new Map();
  report = b.report.slice();
  vis = bt_visibility(b);
  if (b.over) { bt_delete_save(); audio_play(b.over.victory ? 'win' : 'lose'); showResult(); return; }
  if (!b.squads.some((s) => s.id === sel && s.men.length)) sel = (b.squads.find((s) => bt_mine(s) && s.men.length) || {}).id || null;
  bt_save(b);
  renderPanel();
}

function showResult() {
  renderPanel();
  const s = $('#battle'), o = el('div', 'bt-result');
  const box = el('div', 'bt-rbox');
  box.append(el('div', 'fileno', b.over.victory ? 'Field report · success' : 'Field report · failure'), el('h2', 'end-title ' + (b.over.victory ? 'win' : 'lose'), b.over.title), el('p', 'end-text', b.over.text),
    el('div', 'sum', b.over.summary.map((l) => el('div', null, l))));
  const m = el('div', 'menu');
  const cfg = Object.assign({}, b.cfg);
  m.append(btn('btn main', 'Same battle again', () => start(bt_new(cfg))), btn('btn', 'New battle', setup), btn('btn', 'Title screen', leave));
  box.append(m); o.append(box); s.append(o);
}

function openMenu() {
  if (!b) return;
  const s = $('#battle'), o = el('div', 'bt-result'), box = el('div', 'bt-rbox');
  const close = () => o.remove();
  box.append(el('h2', 'end-title', 'Orders'), el('div', 'sum', [
    el('div', null, 'Each turn: give orders, then EXECUTE. Ten seconds of battle play out and you cannot intervene.'),
    el('div', null, 'Tap a squad, then tap a tile to send it there, or drag a route from it. Orders carry over to the next turn.'),
    el('div', null, 'Fire at will kills, but every shot is noise and noise brings the dead. Hold fire to stay quiet.'),
    el('div', null, 'Running is fast, but nobody shoots while running. Machine guns need a moment to set up.'),
    el('div', null, 'Morale falls when men die or the dead swarm a squad. A broken squad runs for safety until it rallies.'),
    el('div', null, 'Red arrows: where the dead you can see are heading. Red edge marks: where the next wave comes in.'),
    el('div', null, 'In the dark you see, and shoot, only five tiles away.'),
    el('div', null, 'Windows let sight and shots through but not people. Someone behind a window is hard to hit. The dead smash them in; a broken window can be climbed or barricaded.'),
    el('div', null, 'Scouts that stay still for two seconds in brush or inside a building are set up as snipers: longer range, better aim, and nobody sees them until they are close.'),
    el('div', null, 'Take the town: a base (A to D) is yours after four seconds with your men inside and nobody else, living or dead. Blue outline: yours. Red: theirs. Bases you hold restock your ammunition. Hold all of them through a whole turn to win.'),
  ]));
  const m = el('div', 'menu');
  m.append(btn('btn main', 'Back to the battle', close), btn('btn', 'Save and quit', () => { if (b.phase === 'plan') bt_save(b); leave(); }),
    btn('btn danger', 'Abandon the battle', () => { bt_delete_save(); leave(); }));
  box.append(m); o.append(box); s.append(o);
}

// ---------------------------------------------------------------- input
function toTile(e) {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left - view.ox) / view.ts, (e.clientY - r.top - view.oy) / view.ts];
}
function squadAt(x, y) {
  let best = null, bd = 0.9;
  for (const s of b.squads.filter(bt_mine)) for (const m of bt_squad_men(b, s)) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = s; } }
  return best;
}
function bindInput() {
  cv.addEventListener('pointerdown', (e) => {
    if (!b || playing || b.over) return;
    const [x, y] = toTile(e);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    drag = { id: e.pointerId, sx: x, sy: y, pts: [], squad: null, moved: false };
    const s = squadAt(x, y);
    if (s && mode !== 'ability') { drag.squad = s.id; if (sel !== s.id) { sel = s.id; renderPanel(); } }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const [x, y] = toTile(e);
    if (Math.hypot(x - drag.sx, y - drag.sy) > 0.8) drag.moved = true;
    if (drag.squad && drag.moved) {
      const last = drag.pts[drag.pts.length - 1];
      if (!last || Math.hypot(last[0] - x, last[1] - y) >= 1.5) drag.pts.push([x, y]);
    }
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null;
    if (!b || playing || b.over || e.type === 'pointercancel') return;
    const [x, y] = toTile(e);
    const s = b.squads.find((q) => q.id === sel);
    if (mode === 'ability' && s) {
      const err = bt_set_ability(b, s.id, x, y);
      if (err) flash(err); else { mode = null; audio_play('order'); }
      renderPanel(); return;
    }
    if (d.squad && d.moved && d.pts.length) {                                  // a drawn route
      d.pts.push([x, y]);
      if (!bt_order_move(b, d.squad, d.pts)) flash('They cannot get there.'); else audio_play('order');
      renderPanel(); return;
    }
    if (d.squad) return;                                                        // a tap on a squad selects it
    if (s && s.men.length) {
      if (s.state === 'broken') { flash(`${s.name} is broken and will not listen.`); return; }
      if (!bt_order_move(b, s.id, [[x, y]])) flash('They cannot get there.'); else audio_play('order');
      renderPanel();
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}
let flashTimer = 0;
function flash(text) {
  const p = $('#battle .bt-panel .bt-hint');
  if (p) { p.textContent = text; p.classList.add('warn'); clearTimeout(flashTimer); flashTimer = setTimeout(() => p && p.classList.remove('warn'), 1600); }
  audio_play('warn');
}

// ---------------------------------------------------------------- drawing
function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!b) return;
  let alpha = 1;
  if (playing) {
    const tickMs = 100 / speed;
    acc += Math.min(250, now - lastT); lastT = now;
    let n = 0;
    while (acc >= tickMs && b.phase === 'resolve' && !b.over && n < 8) { step(); acc -= tickMs; n++; }
    if (n) { vis = bt_visibility(b); if (b.t % 5 === 0) renderPanel(); }
    alpha = Math.min(1, acc / tickMs);
    if (b.phase !== 'resolve' || b.over) finishTurn();
    renderStatus();
  }
  draw(now, alpha);
}

const pos = (u, alpha) => { const p = prev.get(u.id); return p ? [p[0] + (u.x - p[0]) * alpha, p[1] + (u.y - p[1]) * alpha] : [u.x, u.y]; };

function draw(now, alpha) {
  const { ts, ox, oy, dpr } = view, c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0a0e0f'; c.fillRect(0, 0, view.W, view.H);
  const P = (x) => ox + x * ts, Q = (y) => oy + y * ts;
  // terrain
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const t = b.tiles[y * b.w + x], px = P(x), py = Q(y);
    const names = TILE_SPR[t], name = names[(x * 7 + y * 13) % names.length];
    if (!UI.sprite(c, b.era, name, px, py, ts)) { c.fillStyle = TILE_COL[t]; c.fillRect(px, py, ts + 0.5, ts + 0.5); }
    if (t === BTILE.DOOR) { c.fillStyle = 'rgba(122,85,40,.85)'; c.fillRect(px + ts * .15, py + ts * .15, ts * .7, ts * .7); }
    else if (t === BTILE.WINDOW) {
      const hp = b.windows[y * b.w + x];
      c.fillStyle = 'rgba(140,200,225,.85)'; c.fillRect(px + ts * .18, py + ts * .18, ts * .64, ts * .64);
      c.strokeStyle = '#2b383d'; c.lineWidth = 1; c.beginPath(); c.moveTo(px + ts / 2, py + ts * .18); c.lineTo(px + ts / 2, py + ts * .82); c.moveTo(px + ts * .18, py + ts / 2); c.lineTo(px + ts * .82, py + ts / 2); c.stroke();
      if (hp !== undefined && hp < 20) { c.strokeStyle = '#e2573f'; c.beginPath(); c.moveTo(px + ts * .25, py + ts * .3); c.lineTo(px + ts * .7, py + ts * .75); c.stroke(); }
    } else if (t === BTILE.BROKEN) {
      c.fillStyle = 'rgba(140,200,225,.6)';
      for (const [a, d] of [[.2, .3], [.6, .25], [.45, .65], [.75, .7]]) c.fillRect(px + a * ts, py + d * ts, ts * .1, ts * .1);
    }
  }
  if (b.extract_y !== null) { c.fillStyle = 'rgba(88,184,120,.16)'; c.fillRect(P(0), Q(b.extract_y), b.w * ts, (b.h - b.extract_y) * ts); }
  // blood
  for (const d of decals) { c.fillStyle = d.man ? 'rgba(170,30,30,.55)' : 'rgba(90,20,20,.45)'; c.beginPath(); c.arc(P(d.x), Q(d.y), ts * .22, 0, 7); c.fill(); }
  // barricades
  for (const [k, hp] of Object.entries(b.barricades)) {
    const x = +k % b.w, y = Math.floor(+k / b.w), px = P(x), py = Q(y);
    c.fillStyle = '#6b4a22'; c.fillRect(px + 1, py + ts * .2, ts - 2, ts * .6);
    c.strokeStyle = '#c9a060'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px + 2, py + ts * .25); c.lineTo(px + ts - 2, py + ts * .75); c.moveTo(px + ts - 2, py + ts * .25); c.lineTo(px + 2, py + ts * .75); c.stroke();
    c.fillStyle = '#000'; c.fillRect(px + 2, py + ts - 4, ts - 4, 3); c.fillStyle = '#d99a2b'; c.fillRect(px + 2, py + ts - 4, (ts - 4) * Math.min(1, hp / 160), 3);
  }
  // fog: the map is known, the dead are only seen where your people can see
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (!vis[y * b.w + x]) { c.fillStyle = 'rgba(4,6,8,.55)'; c.fillRect(P(x), Q(y), ts + 0.5, ts + 0.5); }
  if (bt_dark(b)) { c.fillStyle = 'rgba(10,14,40,.22)'; c.fillRect(P(0), Q(0), b.w * ts, b.h * ts); }
  // places that matter, over the fog so they are never lost: what to defend, whom to fetch, what to take
  if (b.refuge) place(b.refuge, `REFUGE ${Math.round(b.refuge.integrity)}%`, '#55b3c4', b.refuge.integrity < 50 && Math.sin(now / 160) > 0);
  if (b.house && b.civs.some((q) => q.follow === null)) place(b.house, 'SURVIVORS', '#55b3c4', false);
  if (b.extract_y !== null) label('EXIT', P(b.w / 2), Q(b.extract_y + 1), '#58b878');
  for (const q of b.bases) {
    const col = q.owner === 'you' ? '#55b3c4' : q.owner === 'rival' ? '#e2573f' : '#c9c2ae';
    place(q, q.letter, col, false);
    if (q.by) { const w = (q.x1 - q.x0 + 1) * ts; c.fillStyle = '#000'; c.fillRect(P(q.x0), Q(q.y1 + 1) - 5, w, 4); c.fillStyle = q.by === 'you' ? '#55b3c4' : '#e2573f'; c.fillRect(P(q.x0), Q(q.y1 + 1) - 5, w * Math.min(1, q.prog / 4), 4); }
  }
  // lures
  for (const l of b.lures) { const r = ts * (0.6 + 0.4 * Math.sin(now / 200)); c.strokeStyle = 'rgba(240,196,122,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(P(l.x), Q(l.y), r, 0, 7); c.stroke(); }
  // plan overlays: the next wave, orders, threat arrows
  if (!playing && b.phase === 'plan') {
    drawWave(now);
    b.squads.filter(bt_mine).forEach((s, i) => drawOrders(s, SQUAD_COL[i % SQUAD_COL.length], s.id === sel));
  }
  // people and the dead
  for (const z of b.zeds) {
    if (!vis[Math.floor(z.y) * b.w + Math.floor(z.x)]) continue;
    const [x, y] = pos(z, alpha), sz = ts * (z.special === 'brute' ? 1.05 : 0.85);
    if (!UI.sprite(c, b.era, 'z_' + z.special, P(x) - sz / 2, Q(y) - sz / 2, sz) && !UI.sprite(c, b.era, 'z_walker', P(x) - sz / 2, Q(y) - sz / 2, sz)) {
      c.fillStyle = '#b94a3c'; c.beginPath(); c.arc(P(x), Q(y), ts * .3, 0, 7); c.fill();
    }
    if (z.hp < z.max_hp) { c.fillStyle = '#000'; c.fillRect(P(x) - ts * .35, Q(y) + ts * .38, ts * .7, 2); c.fillStyle = '#e2573f'; c.fillRect(P(x) - ts * .35, Q(y) + ts * .38, ts * .7 * Math.max(0, z.hp / z.max_hp), 2); }
    if (!playing) {
      const to = bt_intent(b, z);
      if (to) arrow(P(z.x), Q(z.y), P(to[0]), Q(to[1]), 'rgba(226,87,63,.75)', ts);
    }
  }
  for (const cv2 of b.civs) {
    const [x, y] = pos(cv2, alpha), sz = ts * .8;
    c.fillStyle = 'rgba(85,179,196,.55)'; c.beginPath(); c.ellipse(P(x), Q(y) + ts * .3, ts * .3, ts * .1, 0, 0, 7); c.fill();
    if (!UI.sprite(c, b.era, 'human', P(x) - sz / 2, Q(y) - sz / 2, sz)) { c.fillStyle = '#55b3c4'; c.beginPath(); c.arc(P(x), Q(y), ts * .28, 0, 7); c.fill(); }
    if (cv2.bitten >= 0) { c.fillStyle = '#6a9a32'; c.beginPath(); c.arc(P(x) + ts * .3, Q(y) - ts * .3, ts * .1, 0, 7); c.fill(); }
  }
  for (const s of b.squads.filter((q) => !bt_mine(q))) for (const m of bt_squad_men(b, s)) {
    if (!vis[Math.floor(m.y) * b.w + Math.floor(m.x)]) continue;
    const [x, y] = pos(m, alpha), sz = ts * .82;
    c.fillStyle = 'rgba(226,87,63,.55)'; c.beginPath(); c.ellipse(P(x), Q(y) + ts * .3, ts * .32, ts * .12, 0, 0, 7); c.fill();
    if (!UI.sprite(c, b.era, 'raider', P(x) - sz / 2, Q(y) - sz / 2, sz)) { c.fillStyle = '#c9992a'; c.beginPath(); c.arc(P(x), Q(y), ts * .28, 0, 7); c.fill(); }
    if (m.hp < m.max_hp) { c.fillStyle = '#000'; c.fillRect(P(x) - ts * .35, Q(y) - ts * .5, ts * .7, 2); c.fillStyle = '#e2573f'; c.fillRect(P(x) - ts * .35, Q(y) - ts * .5, ts * .7 * Math.max(0, m.hp / m.max_hp), 2); }
  }
  b.squads.filter(bt_mine).forEach((s, i) => {
    const col = SQUAD_COL[i % SQUAD_COL.length];
    for (const m of bt_squad_men(b, s)) {
      const [x, y] = pos(m, alpha), sz = ts * .82;
      c.globalAlpha = bt_hidden(b, m) ? 0.55 : 1;
      c.strokeStyle = col; c.lineWidth = s.id === sel && !playing ? 2.2 : 1.4; c.beginPath(); c.ellipse(P(x), Q(y) + ts * .3, ts * .32, ts * .12, 0, 0, 7); c.stroke();
      if (!UI.sprite(c, b.era, 'soldier', P(x) - sz / 2, Q(y) - sz / 2, sz)) { c.fillStyle = col; c.beginPath(); c.arc(P(x), Q(y), ts * .28, 0, 7); c.fill(); }
      if (m.hp < m.max_hp) { c.fillStyle = '#000'; c.fillRect(P(x) - ts * .35, Q(y) - ts * .5, ts * .7, 2); c.fillStyle = '#58b878'; c.fillRect(P(x) - ts * .35, Q(y) - ts * .5, ts * .7 * Math.max(0, m.hp / m.max_hp), 2); }
      if (m.bitten >= 0) { c.fillStyle = '#6a9a32'; c.beginPath(); c.arc(P(x) + ts * .3, Q(y) - ts * .3, ts * .11, 0, 7); c.fill(); }
      c.globalAlpha = 1;
    }
    if (s.men.length && s.state !== 'steady') {
      c.font = `bold ${Math.max(9, Math.floor(ts * .55))}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = s.state === 'broken' ? '#e2573f' : '#d4a52a'; c.fillText(s.state === 'broken' ? '!!' : '!', P(s.anchor[0]), Q(s.anchor[1]) - ts * .9);
    }
  });
  // effects
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], age = Math.max(0, (now - f.at) / 1000);
    const life = f.kind === 'shot' ? 0.14 : f.kind === 'noise' ? 0.6 : 0.45;
    if (age > life) { fxs.splice(i, 1); continue; }
    const a = 1 - age / life;
    if (f.kind === 'shot') {
      c.strokeStyle = f.heavy ? `rgba(255,200,90,${a})` : `rgba(255,236,170,${a * .9})`; c.lineWidth = f.heavy ? 1.6 : 1;
      c.beginPath(); c.moveTo(P(f.x0), Q(f.y0)); c.lineTo(P(f.x1), Q(f.y1)); c.stroke();
    } else if (f.kind === 'noise') {
      c.strokeStyle = `rgba(240,196,122,${a * .12})`; c.lineWidth = 1; c.beginPath(); c.arc(P(f.x), Q(f.y), ts * f.r * (age / life), 0, 7); c.stroke();
    } else if (f.kind === 'aoe' || f.kind === 'burst') {
      c.fillStyle = f.kind === 'aoe' ? `rgba(255,140,40,${a * .55})` : `rgba(120,170,60,${a * .5})`; c.beginPath(); c.arc(P(f.x), Q(f.y), ts * f.r, 0, 7); c.fill();
    } else if (f.kind === 'scream') {
      c.strokeStyle = `rgba(212,165,42,${a})`; c.lineWidth = 2; c.beginPath(); c.arc(P(f.x), Q(f.y), ts * (1 + 3 * (1 - a)), 0, 7); c.stroke();
    } else if (f.kind === 'turn' || f.kind === 'rise' || f.kind === 'bitten') {
      c.fillStyle = `rgba(106,154,50,${a * .7})`; c.beginPath(); c.arc(P(f.x), Q(f.y), ts * .6, 0, 7); c.fill();
    } else if (f.kind === 'taken') {
      c.strokeStyle = `rgba(226,87,63,${a})`; c.lineWidth = 2; c.strokeRect(P(f.x) - ts, Q(f.y) - ts, ts * 2, ts * 2);
    } else if (f.kind === 'build' || f.kind === 'saved') {
      c.strokeStyle = `rgba(88,184,120,${a})`; c.lineWidth = 2; c.strokeRect(P(f.x) - ts / 2, Q(f.y) - ts / 2, ts, ts);
    } else if (f.kind === 'break' || f.kind === 'hurt') {
      c.fillStyle = `rgba(226,87,63,${a * (f.kind === 'hurt' ? .35 : .7)})`; c.beginPath(); c.arc(P(f.x), Q(f.y), ts * (f.kind === 'hurt' ? .35 : .7), 0, 7); c.fill();
    }
  }
  // the route being drawn
  if (drag && drag.squad && drag.pts.length) {
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 2; c.setLineDash([3, 4]); c.beginPath();
    c.moveTo(P(drag.sx), Q(drag.sy)); for (const p of drag.pts) c.lineTo(P(p[0]), Q(p[1])); c.stroke(); c.setLineDash([]);
  }
}

// A place on the map: a solid outline and a name tag above it.
function place(r, text, col, blink) {
  const c = ctx, { ts, ox, oy } = view, x = ox + r.x0 * ts, y = oy + r.y0 * ts, w = (r.x1 - r.x0 + 1) * ts, h = (r.y1 - r.y0 + 1) * ts;
  c.strokeStyle = blink ? '#e2573f' : col; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
  c.fillStyle = col; c.globalAlpha = 0.1; c.fillRect(x, y, w, h); c.globalAlpha = 1;
  label(text, x + w / 2, y - 1, col);
}
function label(text, x, y, col) {
  const c = ctx, fs = Math.max(9, Math.floor(view.ts * .6));
  c.font = `600 ${fs}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
  const w = c.measureText(text).width + 8;
  c.fillStyle = 'rgba(10,14,15,.85)'; c.fillRect(x - w / 2, y - fs - 3, w, fs + 4);
  c.fillStyle = col; c.fillText(text, x, y);
}

function arrow(x0, y0, x1, y1, col, ts) {
  const c = ctx, dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  if (d < 2) return;
  const L = Math.min(d, ts * 1.1), ux = dx / d, uy = dy / d, ex = x0 + ux * L, ey = y0 + uy * L;
  c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x0 + ux * ts * .3, y0 + uy * ts * .3); c.lineTo(ex, ey);
  c.moveTo(ex, ey); c.lineTo(ex - ux * 5 - uy * 3.5, ey - uy * 5 + ux * 3.5); c.moveTo(ex, ey); c.lineTo(ex - ux * 5 + uy * 3.5, ey - uy * 5 - ux * 3.5); c.stroke();
}

function drawOrders(s, col, on) {
  if (!s.men.length) return;
  const c = ctx, { ts, ox, oy } = view, P = (x) => ox + x * ts, Q = (y) => oy + y * ts;
  if (s.path.length) {
    c.strokeStyle = col; c.globalAlpha = on ? 0.95 : 0.45; c.lineWidth = on ? 2.2 : 1.5; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(P(s.anchor[0]), Q(s.anchor[1])); for (const p of s.path) c.lineTo(P(p[0]), Q(p[1])); c.stroke(); c.setLineDash([]);
    const end = s.path[s.path.length - 1];
    c.beginPath(); c.arc(P(end[0]), Q(end[1]), ts * .25, 0, 7); c.stroke();
    const r = bt_reach(b, s);                                          // where they will be when the turn ends
    c.fillStyle = col; c.beginPath(); c.arc(P(r[0]), Q(r[1]), ts * .2, 0, 7); c.fill();
    c.globalAlpha = 1;
  }
  if (s.ability) {
    const x = P(s.ability.x), y = Q(s.ability.y);
    c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([2, 2]);
    if (s.ability.kind === 'barricade') c.strokeRect(x + 1, y + 1, ts - 2, ts - 2); else { c.beginPath(); c.arc(x + ts / 2, y + ts / 2, ts * .45, 0, 7); c.stroke(); }
    c.setLineDash([]);
  }
  if (on && s.stance === 'hold') {
    c.font = `${Math.max(9, Math.floor(ts * .5))}px ${MONO}`; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('quiet', P(s.anchor[0]), Q(s.anchor[1]) - ts * .9);
  }
}

function drawWave(now) {
  const w = b.wave; if (!w || !w.entries) return;
  const c = ctx, { ts, ox, oy } = view, pulse = 0.45 + 0.35 * Math.sin(now / 260);
  c.fillStyle = `rgba(226,87,63,${pulse})`;
  for (const e of w.entries) {
    if (e.side === 'north') c.fillRect(ox + (e.at - 2.5) * ts, oy, ts * 6, ts * .35);
    else if (e.side === 'west') c.fillRect(ox, oy + (e.at - 2.5) * ts, ts * .35, ts * 6);
    else c.fillRect(ox + b.w * ts - ts * .35, oy + (e.at - 2.5) * ts, ts * .35, ts * 6);
  }
}

window.OB_BATTLE = { setup, resume, start, get battle() { return b; } };
})();
