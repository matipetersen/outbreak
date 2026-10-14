const assert = require('assert');
const { OB, make } = require('./helpers');

// a stub WebAudio: nothing is heard, but every call a real browser would get is made
let starts = 0, nodes = 0;
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
class Node { constructor() { nodes++; this.gain = param(); this.frequency = param(); this.pan = param(); this.playbackRate = { value: 1 }; this.threshold = { value: 0 }; this.ratio = { value: 0 }; }
  connect() {} setPeriodicWave() {} start() { starts++; } stop() {} }
class Ctx { constructor() { this.currentTime = 1; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  createGain() { return new Node(); } createOscillator() { return new Node(); } createBufferSource() { return new Node(); } createBiquadFilter() { return new Node(); }
  createStereoPanner() { return new Node(); } createDynamicsCompressor() { return new Node(); } createPeriodicWave() { return {}; }
  createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; } resume() {} }

// the engine asks for sounds by name, even with no audio at all (node, tests)
const g = make({ seed: 3 });
for (let i = 0; i < 6; i++) g.move(1, 0);
assert(g.sounds && g.sounds.some((s) => s[0] === 'step'), 'walking asks for a step sound');
assert(g.sounds.length <= 24, 'the queue is capped');
const z = OB.spawn_zombie(g, g.world.level, g.world.level.free_spot_near(g.player.x + 3, g.player.y, 2), 'walker', false);
OB.kill_zombie(g, z); assert(g.sounds.some((s) => s[0] === 'kill'), 'a kill asks for its sound');
OB.audio_play('click', g);                                      // no context: silently nothing
assert.strictEqual(OB.AUD.ctx, null);

// with a context every effect plays, panned and attenuated by where it is, without throwing
global.window = { AudioContext: Ctx };
OB.audio_unlock(); assert(OB.AUD.ctx, 'unlocked');
const names = Object.keys(OB.SFX);
assert(names.length >= 25);
for (const n of names) { OB.AUD.last = {}; OB.audio_play(n, g); OB.audio_play(n, g, [g.player.x + 8, g.player.y]); }
assert(starts > names.length, 'voices were started');
const before = starts; OB.AUD.last = {}; OB.audio_play('shoot', g, [g.player.x + 60, g.player.y]); assert.strictEqual(starts, before, 'too far to hear');
OB.audio_settings({ sfx: false }); OB.audio_play('click', g); OB.audio_settings({ sfx: true });

// the music: three intensities, a hundred and twenty steps each, for every era key
for (const era of ['medieval', 'eighties', 'modern', 'scifi']) {
  OB.AUD.era = era;
  for (const I of [0, 0.5, 1]) { OB.AUD.intensity = I; OB.AUD.ctx.currentTime = 1; for (let i = 0; i < 120; i++) OB._musStep(i, 1 + i * 0.1); }
}
OB.audio_set_playing(true, g); assert(OB.AUD.timer, 'the scheduler runs'); OB.audio_set_playing(false); assert(!OB.AUD.timer);

for (const a of g.world.level.actors.slice()) if (a.kind !== 'player') g.world.level.remove_actor(a); g.player.hp = g.player.max_hp;
// intensity follows the Director, the dead that hunt you, and the final stand
g.director.tension = 0; OB.audio_update(g); const calm = OB.AUD.target;
g.director.tension = 90; OB.audio_update(g); assert(OB.AUD.target > calm + 0.4, `tension raises it ${calm} -> ${OB.AUD.target}`);
g.director.tension = 0; g.final = { exit: [1, 1] }; OB.audio_update(g); assert.strictEqual(OB.AUD.target, 1); g.final = null;
g.player.sneaking = true; g.director.tension = 80; OB.audio_update(g); const sneaky = OB.AUD.target; g.player.sneaking = false; OB.audio_update(g); assert(OB.AUD.target > sneaky, 'creeping eases it');
// the log: a directed warning gets a cue, ordinary chatter does not
const n0 = starts; g.msg('The dead are coming from the north.', 'dir'); OB.AUD.last = {}; OB.audio_on_log(g, g.log.length - 1); assert(starts > n0);
const n1 = starts; g.msg('Nothing much.', 'info'); OB.audio_on_log(g, g.log.length - 1); assert.strictEqual(starts, n1);
delete global.window;
console.log('audio: retro chip effects and an adaptive loop, quiet without a speaker');
