// ================================================================ OUTBREAK: the campaign front-end (Zona Norte, see campaign.js)
// The map of the northern suburbs, the district you tap, what you can do there today, your company and the night's news.
// Battles are fought in the battle screen (battle_ui.js) and come back here when they end.
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
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
const DEAD_WORDS = ['limpio', 'algunos muertos', 'muchos muertos', 'tomado por los muertos'];

let cs = null, sel = 'florida', setupCfg = null;

// ---------------------------------------------------------------- start
function setup() {
  UI.hideAll();
  const s = $('#newgame'); s.hidden = false;
  setupCfg = setupCfg || Object.assign({ zombies: 'classic', difficulty: 'normal', seed: null }, UI.lsGet('outbreak.campaigncfg', {}), { seed: null });
  const render = () => {
    s.innerHTML = '';
    const w = el('div', 'wrap form'), head = el('h2', 'logo', 'Zona Norte'); head.style.fontSize = '40px';
    w.append(el('div', 'fileno', 'Campaña · zona norte del Gran Buenos Aires · 2026'), head);
    w.append(el('p', 'note', 'Tenés Florida, en Vicente López: el gimnasio de la escuela, el súper, la estación. Tomá la zona norte barrio por barrio, del río a la Panamericana. Cada día, una operación; cada noche el mapa se mueve, y pasa algo que te obliga a decidir. Tu compañía es la misma en todas las batallas: los muertos no vuelven.'));
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
    group('Los muertos', 'zombies', Object.values(CONTENT.presets).map((z) => [z.id, z.name.split(' - ')[0], z.inspired_by]), () => CONTENT.presets[setupCfg.zombies].blurb);
    group('Dificultad', 'difficulty', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']].map(([d, n]) => [d, n, null]), () => ({ easy: 'Compañías enemigas más chicas.', normal: 'Como está pensado.', hard: 'Compañías enemigas más grandes, más muertos.' })[setupCfg.difficulty], true);
    w.append(el('h3', null, 'Quién más anda por ahí'), el('div', 'blurb', ['raiders', 'military', 'cult', 'enclave'].map((f) => el('div', null, [el('b', null, CP_FACTIONS[f].name + ': '), CP_FACTIONS[f].blurb]))));
    const go = el('div', 'sticky');
    go.append(btn('btn main', 'EMPEZAR', () => { UI.lsSet('outbreak.campaigncfg', Object.assign({}, setupCfg, { seed: null })); cs = cp_new(Object.assign({}, setupCfg)); sel = 'florida'; bt_delete_save(); cp_save(cs); show(); }));
    w.append(go, btn('btn', 'Volver', UI.showTitle));
    s.append(w); s.scrollTop = 0;
  };
  render();
}

function resume() {
  cs = cp_load();
  if (!cs) { UI.showTitle(); return; }
  if (cs.op) {                                              // a battle was in progress
    const b = bt_load();
    if (b && b.cfg.campaign && !b.over) { window.OB_BATTLE.start(b); return; }
    cp_finish_battle(cs, null);                              // its save is gone: it counts as a retreat
    cp_save(cs);
  }
  show();
}

// A battle of the campaign is over: count the cost, move the map, show the night.
function battleOver(b) {
  cs = cs || cp_load();
  if (!cs) { UI.showTitle(); return; }
  cp_finish_battle(cs, b);
  bt_delete_save();
  if (cs.over) cp_delete_save(); else cp_save(cs);
  show(true);
}

// ---------------------------------------------------------------- the map screen
function show(afterBattle) {
  UI.hideAll();
  const s = $('#campaign'); s.hidden = false; s.innerHTML = '';
  if (cs.over) { showOver(); return; }
  const mine = cp_mine(cs).length;
  s.append(el('div', 'cp-top', [
    el('div', 'cp-stat', [el('b', null, `Día ${cs.day}`), ` · ${mine}/${Object.keys(cs.zones).length} barrios · `, el('b', null, `${cs.supplies}`), ' suministros · ', el('b', null, `${cs.recruits}`), ' reclutas']),
    btn('bt-menu', 'Menú', menu)]));
  if (cs.threat) s.append(el('div', 'cp-threat', `${cs.threat.by === 'dead' ? 'Una horda viene' : `${CP_FACTIONS[cs.threat.by].name} vienen`} por ${CP_ZONES[cs.threat.zone].name}. Defendela hoy, o la perdés esta noche.`));
  const mapBox = el('div', 'cp-map'); mapBox.append(drawMap()); s.append(mapBox);
  const panel = el('div', 'cp-panel'); s.append(panel);
  renderPanel(panel);
  if (cs.event) showEvent();
  else if (afterBattle) showNight();
}

function drawMap() {
  const root = svg('svg', { viewBox: '0 0 100 100', class: 'cp-svg', preserveAspectRatio: 'xMidYMid meet' });
  // the river and the Delta to the east and north-east
  root.append(svg('path', { d: 'M 100 100 L 100 0 L 70 0 C 74 10 82 16 86 26 C 90 36 86 46 88 54 C 90 64 86 72 90 80 C 93 88 92 94 96 100 Z', fill: '#123447', stroke: '#1d4a60', 'stroke-width': 0.4 }));
  const label = svg('text', { x: 94, y: 70, 'font-size': 2.6, fill: '#3f7f9f', transform: 'rotate(-80 94 70)', 'text-anchor': 'middle' }); label.textContent = 'Río de la Plata'; root.append(label);
  const delta = svg('text', { x: 84, y: 8, 'font-size': 2.6, fill: '#3f7f9f', 'text-anchor': 'middle' }); delta.textContent = 'Delta'; root.append(delta);
  // the links
  const drawn = new Set();
  for (const [id, z] of Object.entries(CP_ZONES)) for (const n of z.adj) {
    const k = [id, n].sort().join('-'); if (drawn.has(k)) continue; drawn.add(k);
    const m = CP_ZONES[n];
    root.append(svg('line', { x1: z.x, y1: z.y, x2: m.x, y2: m.y, stroke: '#2b383d', 'stroke-width': 0.6 }));
  }
  const ops = cp_ops(cs), frontier = new Set(cp_frontier(cs));
  for (const [id, z] of Object.entries(CP_ZONES)) {
    const st = cs.zones[id], owner = st.owner, col = owner ? CP_FACTIONS[owner].color : '#5b6468';
    const g = svg('g', { class: 'cp-node', 'data-id': id });
    if (cs.threat && cs.threat.zone === id) g.append(svg('circle', { cx: z.x, cy: z.y, r: 6.4, fill: 'none', stroke: '#e2573f', 'stroke-width': 0.8, class: 'cp-pulse' }));
    if (id === sel) g.append(svg('circle', { cx: z.x, cy: z.y, r: 5.6, fill: 'none', stroke: '#f0e8d0', 'stroke-width': 0.6 }));
    g.append(svg('circle', { cx: z.x, cy: z.y, r: 4.2, fill: owner ? col : '#1c262a', stroke: frontier.has(id) ? '#d99a2b' : col, 'stroke-width': frontier.has(id) ? 0.8 : 0.5, 'fill-opacity': owner ? 0.85 : 1 }));
    for (let i = 0; i < st.dead; i++) g.append(svg('circle', { cx: z.x - 2.2 + i * 2.2, cy: z.y + 2.2, r: 0.75, fill: '#e2573f', stroke: '#0a0e0f', 'stroke-width': 0.2 }));
    const mark = id === 'florida' ? '★' : CP_ZONES[id].feature === 'hospital' ? 'H' : CP_ZONES[id].feature === 'depot' ? 'D' : CP_ZONES[id].feature === 'armory' ? 'A' : '';
    if (mark) { const t = svg('text', { x: z.x, y: z.y + 0.9, 'font-size': 3, 'text-anchor': 'middle', fill: '#0a0e0f', 'font-weight': 700 }); t.textContent = mark; g.append(t); }
    if (st.survivors > 0) { const t = svg('text', { x: z.x + 3.6, y: z.y - 2.6, 'font-size': 3, fill: '#55b3c4', 'font-weight': 700 }); t.textContent = '!'; g.append(t); }
    const name = svg('text', { x: z.x, y: z.y - 5.2, 'font-size': 2.5, 'text-anchor': 'middle', fill: '#dcd6c6', class: 'cp-label' }); name.textContent = z.name; g.append(name);
    g.addEventListener('click', () => { sel = id; show(); });
    root.append(g);
  }
  return root;
}

function renderPanel(p) {
  const z = CP_ZONES[sel], st = cs.zones[sel], owner = st.owner;
  const who = owner ? CP_FACTIONS[owner].name : 'De nadie';
  p.append(el('div', 'cp-zone', [el('b', null, z.name), el('span', 'cp-sub', ` · ${z.partido} · ${who} · ${DEAD_WORDS[st.dead]}`)]));
  const notes = [];
  if (z.feature) notes.push(CP_FEATURES[z.feature]);
  if (owner && owner !== 'you' && CP_FACTIONS[owner].blurb) notes.push(CP_FACTIONS[owner].blurb);
  if (owner === 'enclave') notes.push(`Su buena voluntad: ${cs.rep.enclave}/4. Con cuatro, se suman a vos.`);
  if (CP.HOSTILE.includes(owner) && cs.truce[owner] >= cs.day) notes.push(`En paz con vos hasta el día ${cs.truce[owner] + 1}.`);
  if (st.survivors > 0) notes.push(`Hay sobrevivientes haciendo señas: ${st.survivors === 1 ? 'queda un día' : `quedan ${st.survivors} días`} para llegar.`);
  if (st.cache) notes.push('Por acá hay un arsenal de la policía.');
  if (notes.length) p.append(el('div', 'cp-notes', notes.map((n) => el('div', null, n))));
  // what can be done here today, and what can be done anywhere
  const ops = cp_ops(cs), here = ops.filter((o) => o.zone === sel), always = ops.filter((o) => !o.zone);
  const box = el('div', 'cp-ops');
  for (const op of here.concat(always)) {
    const w = cp_op_words(cs, op);
    const b = el('button', 'choice' + (op.kind === 'defend' ? ' cp-urgent' : ''), [el('b', null, w.title), el('small', null, w.sub)]); b.type = 'button';
    b.addEventListener('click', () => choose(op));
    box.append(b);
  }
  if (!here.length && sel !== 'florida' && !cp_frontier(cs).includes(sel) && owner !== 'you') box.prepend(el('p', 'note', 'Queda lejos: solo podés operar en barrios pegados a los tuyos.'));
  p.append(box);
  // the company
  p.append(el('h3', 'sec', 'Compañía'));
  const comp = el('div', 'cp-company');
  for (const q of cs.company) comp.append(el('div', 'cp-squad', [el('b', null, q.call), el('small', null, `${CP_TYPES[q.type]} · ${q.men}/${cp_squad_max(q)}`)]));
  p.append(comp, btn('btn', 'Reorganizar: reclutas y escuadras nuevas', refit));
  // the latest news
  p.append(el('h3', 'sec', 'Novedades'), el('div', 'bt-feed', cs.log.slice(-6).reverse().map((l) => el('div', null, `Día ${l.day}: ${l.text}`))));
}

function choose(op) {
  const r = cp_choose(cs, op);
  if (r.error) { toast(r.error); return; }
  cp_save(cs);
  if (r.battle) { const b = bt_new(r.battle); window.OB_BATTLE.start(b); return; }
  show(op.kind === 'rest');
}

function toast(text) {
  const t = el('div', 'cp-toast', text); $('#campaign').append(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------------------------------------------------------------- refit, events, the night, the end
function overlay(build) {
  const o = el('div', 'bt-result'), box = el('div', 'bt-rbox');
  build(box, () => o.remove());
  o.append(box); $('#campaign').append(o);
  return o;
}

function refit() {
  overlay((box, close) => {
    const render = () => {
      box.innerHTML = '';
      box.append(el('h2', 'end-title', 'Reorganizar'), el('p', 'note', `${cs.recruits} reclutas, ${cs.supplies} suministros. Cada recluta llena un lugar en una escuadra. Una escuadra nueva necesita un recluta por hombre y suministros para las armas.`));
      for (const q of cs.company) {
        const need = cp_squad_max(q) - q.men;
        const row = el('div', 'row', [el('div', 'main', [el('div', 'name', q.name), el('div', 'sub', `${q.men}/${cp_squad_max(q)} hombres`)])]);
        if (need > 0) row.append(btn('btn', `Completar (${Math.min(need, cs.recruits)})`, () => { const e = cp_refill(cs, q.id); if (e) toast(e); cp_save(cs); render(); }));
        box.append(row);
      }
      box.append(el('h3', 'sec', 'Armar una escuadra'));
      const grid = el('div', 'opts cols');
      for (const t of Object.keys(BT_TYPES)) {
        const c = cp_raise_cost(t);
        const o = el('button', 'opt', [el('b', null, CP_TYPES[t]), el('small', null, `${c.recruits} reclutas, ${c.supplies} suministros${t === 'heavy' ? ' · necesita Campo de Mayo' : ''}`)]); o.type = 'button';
        o.addEventListener('click', () => { const e = cp_raise(cs, t); if (e) toast(e); cp_save(cs); render(); });
        grid.append(o);
      }
      box.append(grid, btn('btn main', 'Listo', () => { close(); show(); }));
    };
    render();
  });
}

function showEvent() {
  const v = cp_event_view(cs);
  overlay((box) => {
    box.append(el('div', 'fileno', `Día ${cs.day}`), el('p', 'event-text story', v.text));
    v.choices.forEach((c, i) => {
      const b = el('button', 'choice', [el('b', null, c.label), el('small', null, c.sub)]); b.type = 'button';
      b.addEventListener('click', () => {
        const what = cp_decide(cs, i);
        if (cs.over) { cp_delete_save(); show(); return; }
        cp_save(cs);
        box.innerHTML = '';
        box.append(el('p', 'event-text story', what), btn('btn main', 'Seguir', () => show()));
      });
      box.append(b);
    });
  });
}

function showNight() {
  const night = cs.log.filter((l) => l.day >= cs.day - 1).slice(-6);
  if (!night.length) return;
  overlay((box, close) => {
    box.append(el('div', 'fileno', `La noche antes del día ${cs.day}`), el('div', 'sum', night.map((l) => el('div', null, l.text))), btn('btn main', 'Seguir', close));
  });
}

function showOver() {
  const s = $('#campaign'), o = cs.over;
  const w = el('div', 'wrap cp-over');
  w.append(el('div', 'fileno', o.victory ? 'Campaña ganada' : 'Campaña perdida'), el('h2', 'end-title ' + (o.victory ? 'win' : 'lose'), o.title), el('p', 'end-text', o.text), el('div', 'sum', o.summary.map((l) => el('div', null, l))));
  const m = el('div', 'menu'); m.style.marginTop = '20px';
  m.append(btn('btn main', 'Nueva campaña', setup), btn('btn', 'Pantalla de inicio', () => { cs = null; UI.showTitle(); }));
  w.append(m); s.append(w);
}

function menu() {
  overlay((box, close) => {
    box.append(el('h2', 'end-title', 'Zona Norte'), el('div', 'sum', [
      el('div', null, 'Cada día: tocá un barrio y elegí una operación. Las batallas gastan el día; abandonar un barrio, comerciar y reorganizar, no.'),
      el('div', null, 'Anillo naranja: pegado a lo tuyo, podés operar ahí. Puntos rojos: cuántos muertos hay. Pulso rojo: amenazado. ! : sobrevivientes haciendo señas.'),
      el('div', null, 'H hospital (+2 reclutas por día), D depósito (+3 suministros por día), A arsenal (equipos de ametralladora). ★ Florida: si la perdés, se terminó.'),
      el('div', null, 'Cada noche tus barrios producen, los muertos se expanden y las facciones se mueven. Una amenaza que nadie atiende es un barrio perdido.'),
      el('div', null, 'Ganás con ocho barrios, o con cinco cuando los Segadores, los Milicos y los Renacidos se queden sin nada.'),
      el('div', null, 'Las batallas se pelean en un plano de cada barrio. La pantalla de batalla está en inglés.'),
    ]));
    const m = el('div', 'menu');
    m.append(btn('btn main', 'Volver al mapa', close), btn('btn', 'Guardar y salir', () => { cp_save(cs); cs = null; UI.showTitle(); }),
      btn('btn danger', 'Abandonar la campaña', () => { cp_delete_save(); cs = null; UI.showTitle(); }));
    box.append(m);
  });
}

window.OB_CAMPAIGN = { setup, resume, battleOver, get state() { return cs; } };
})();
