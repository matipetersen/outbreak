const OB = require('../dist/engine.js');
function make(cfg) { return OB.make_game(Object.assign({ seed: 1 }, cfg)); }
function empty_level(level) { for (const a of level.actors.slice()) level.remove_actor(a); }
function teleport(g, level_id, pos) {
  const lv = level_id === 'world' ? g.world.level : g.ensure_level(level_id);
  const p = g.player;
  const old = g.level;
  if (old.occ.get(old.idx(p.x, p.y)) === p) old.occ.delete(old.idx(p.x, p.y));
  g.level = lv;
  const dest = pos || lv.entry;
  p.x = dest[0]; p.y = dest[1];
  lv.occ.set(lv.idx(p.x, p.y), p);
  g.update_fov();
  return lv;
}
function quiet(g) { empty_level(g.world.level); g.hordes.length = 0; g.ring = null; return g; }
module.exports = { OB, make, empty_level, teleport, quiet };
