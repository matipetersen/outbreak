// ---------------------------------------------------------------- the world remembers (mirror of engine/memory.py)
const MEM_MAX_MARKS = 18, MEM_FIGHT_KILLS = 4, MEM_FIGHT_WINDOW = 40, MEM_FIGHT_RADIUS = 8, MEM_REVISIT_RANGE = 4, MEM_REVISIT_AFTER = 300, MEM_MAX_NEMESES = 3;
const MEM_NAMES = ['Vask', 'Grell', 'Dutch', 'Harrow', 'Pike', 'Sloan', 'Crane', 'Moss', 'Rourke', 'Teague', 'Brandt', 'Skeet'];
const MEM_EPITHETS = ['the Scarred', 'One-Ear', 'the Limp', 'Redhand', 'the Hollow', 'Gutter', 'the Grin'];

function memory_add(game, kind, pos, text) {
  const marks = game.marks;
  for (const m of marks) if (m.kind === 'fight' && kind === 'fight' && m.level_id === game.level.id && cheb([m.x, m.y], pos) <= MEM_FIGHT_RADIUS) { m.turn = game.clock.turn; m.text = text; return m; }
  const mark = { kind, x: pos[0], y: pos[1], level_id: game.level.id, turn: game.clock.turn, text, shown: -9999 };
  marks.push(mark);
  if (marks.length > MEM_MAX_MARKS) { const i = marks.findIndex((m) => m.kind === 'fight'); marks.splice(i >= 0 ? i : 0, 1); }
  return mark;
}

const memory_graves = (game, level_id) => game.marks.filter((m) => m.kind === 'grave' && m.level_id === level_id);

function memory_allies(game) { return [comp_current(game), pets_current(game)].filter(Boolean); }

function memory_tick(game) {
  const t = game.clock.turn, p = game.player;
  if (t % 10) return;
  const kills = (p.stats.zombies || 0) + (p.stats.humans || 0) + memory_allies(game).reduce((s, a) => s + (a.kills || 0), 0);
  const last = game._kills_seen === undefined ? kills : game._kills_seen;
  game._kills_seen = kills;
  game._kill_log = game._kill_log || [];
  if (kills > last) game._kill_log.push([t, apos(p), kills - last]);
  game._kill_log = game._kill_log.filter((w) => t - w[0] <= MEM_FIGHT_WINDOW);
  const near = game._kill_log.filter((w) => cheb(w[1], apos(p)) <= MEM_FIGHT_RADIUS);
  if (near.reduce((s, w) => s + w[2], 0) >= MEM_FIGHT_KILLS && !game.marks.some((m) => m.kind === 'fight' && cheb([m.x, m.y], apos(p)) <= MEM_FIGHT_RADIUS && t - m.turn < 120))
    memory_add(game, 'fight', apos(p), `Day ${game_day(game)}: you made a stand here. Old stains, and bones nobody buried.`);
  memory_revisit(game, t);
  memory_prune_nemeses(game);
}

function memory_revisit(game, t) {
  const p = game.player, lid = game.level.id;
  for (const m of game.marks) {
    if (m.level_id === lid && cheb([m.x, m.y], apos(p)) <= MEM_REVISIT_RANGE && t - m.turn > 200 && t - m.shown > MEM_REVISIT_AFTER) {
      m.shown = t; game.msg(m.text, 'lore', m.kind === 'grave');
      if (m.kind === 'grave') game.add_panic(4, true);
      return;
    }
  }
}

function memory_on_ally_death(game, name, kind, farewell, pos) {
  memory_add(game, 'grave', pos, `${name}'s grave. A cairn you made out of whatever was close. You remember what they said: ${farewell}`);
}

function memory_on_flee(game, h) {
  if (h.kind !== 'human' || !['raider', 'soldier'].includes(h.role) || h.title) return;
  const ns = game.nemeses;
  if (ns.length >= MEM_MAX_NEMESES || ns.some((n) => n.uid === h.uid)) return;
  const taken = new Set(ns.map((x) => x.name)), free = MEM_NAMES.filter((n) => !taken.has(n));
  const name = game.rng.choice(free.length ? free : MEM_NAMES);
  h.title = game.rng.choice(MEM_EPITHETS); h.name = `${name} ${h.title}`;
  ns.push({ uid: h.uid, name: h.name, role: h.role, day: game_day(game) });
  game.msg(`${h.name} runs. You will see that face again.`, 'lore');
}

function memory_prune_nemeses(game) {
  if (!game.nemeses.length) return;
  const alive = new Set(game.world.level.actors.filter((a) => a.hp > 0).map((a) => a.uid));
  game.nemeses = game.nemeses.filter((n) => alive.has(n.uid));
}

function memory_on_kill_human(game, h) {
  for (const n of game.nemeses.slice()) {
    if (n.uid === h.uid) { game.nemeses.splice(game.nemeses.indexOf(n), 1); game.msg(`${n.name} is dead. Whatever they were owed, it is settled.`, 'lore', true); game.player.gain_xp(40); }
  }
}

function memory_revenge(game, before_uid) {
  const pending = game.nemeses.filter((n) => !n.back);
  if (!pending.length) return false;
  const lv = game.level, fresh = lv.actors.filter((a) => a.role === 'raider' && a.uid > before_uid && a.hp > 0);
  if (!fresh.length) return false;
  const n = pending[0], old = game.world.level.actors.find((a) => a.uid === n.uid);
  if (old) game.world.level.remove_actor(old);
  const h = fresh[0];
  n.uid = h.uid; n.back = true;
  h.name = n.name; h.title = n.name.split(' ').slice(1).join(' ') || n.name;
  h.max_hp = h.hp = Math.trunc(h.max_hp * 1.4); h.dmg = [h.dmg[0] + 1, h.dmg[1] + 2]; h.morale = 100;
  game.msg(`${h.name} is among them, with a grudge and a limp. "I told you I would find you."`, 'dir', true);
  return true;
}
