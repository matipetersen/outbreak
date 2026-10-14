// ---------------------------------------------------------------- sound: retro chip synthesis with WebAudio, no files
// Square/pulse/triangle voices and crunchy noise, a few KB of code.  Nothing here touches the game's RNG or its state:
// the engine only asks for a sound by name (sfx), the UI decides whether it is heard.
const AUD = {
  ctx: null, master: null, sfxbus: null, musbus: null, noise: null, crunch: null, pulses: {},
  vol: 0.7, sfx_on: true, mus_on: true, playing: false, last: {},
  intensity: 0, target: 0, step: 0, next: 0, timer: 0, era: 'modern', inside: false, heart: 0,
  queue: [],                               // sound events the engine asked for while nobody was listening (tests, server-side runs)
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x, lo, hi) => { const t = clamp01((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

function audio_supported() { return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext); }

function audio_unlock() {
  if (AUD.ctx || !audio_supported()) { if (AUD.ctx && AUD.ctx.state === 'suspended') AUD.ctx.resume(); return; }
  try {
    const C = window.AudioContext || window.webkitAudioContext, ctx = new C();
    AUD.ctx = ctx;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    AUD.master = ctx.createGain(); AUD.master.connect(comp); comp.connect(ctx.destination);
    AUD.sfxbus = ctx.createGain(); AUD.sfxbus.connect(AUD.master);
    AUD.musbus = ctx.createGain(); AUD.musbus.connect(AUD.master);
    // white noise, and a crunchy 8-bit version (sample-and-hold, 4 bits) for the retro hiss
    const n = ctx.sampleRate, white = ctx.createBuffer(1, n, ctx.sampleRate), w = white.getChannelData(0);
    for (let i = 0; i < n; i++) w[i] = Math.random() * 2 - 1;
    AUD.noise = white;
    const cr = ctx.createBuffer(1, n, ctx.sampleRate), c = cr.getChannelData(0); let held = 0;
    for (let i = 0; i < n; i++) { if (i % 3 === 0) held = Math.round((Math.random() * 2 - 1) * 8) / 8; c[i] = held; }
    AUD.crunch = cr;
    for (const d of [0.125, 0.25, 0.5]) {                                 // pulse waves of different widths
      const N = 32, re = new Float32Array(N), im = new Float32Array(N);
      for (let k = 1; k < N; k++) { re[k] = Math.sin(2 * Math.PI * k * d) / (k * Math.PI); im[k] = (1 - Math.cos(2 * Math.PI * k * d)) / (k * Math.PI); }
      AUD.pulses[d] = ctx.createPeriodicWave(re, im);
    }
    audio_apply();
    if (ctx.state === 'suspended') ctx.resume();
    if (AUD.playing) audio_music_start();
  } catch (e) { AUD.ctx = null; }
}

function audio_apply() {
  if (!AUD.ctx) return;
  const t = AUD.ctx.currentTime;
  AUD.master.gain.setTargetAtTime(AUD.vol * 0.7, t, 0.02);
  AUD.sfxbus.gain.setTargetAtTime(AUD.sfx_on ? 1 : 0, t, 0.02);
  AUD.musbus.gain.setTargetAtTime(AUD.mus_on ? 0.5 : 0, t, 0.05);
}
function audio_settings(s) {
  if (s) { if (s.vol !== undefined) AUD.vol = clamp01(s.vol); if (s.sfx !== undefined) AUD.sfx_on = !!s.sfx; if (s.mus !== undefined) AUD.mus_on = !!s.mus; audio_apply(); }
  return { vol: AUD.vol, sfx: AUD.sfx_on, mus: AUD.mus_on };
}

// ---- voices
function _env(g, t, vol, dur, attack = 0.004) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
}
function _out(bus, pan) {
  const ctx = AUD.ctx;
  if (!pan || !ctx.createStereoPanner) return bus;
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(bus); return p;
}
// shape: 'square' | 'triangle' | 'sawtooth' | 'sine' | a pulse width (0.125 / 0.25 / 0.5)
function _tone(shape, f0, f1, dur, vol, at = 0, pan = 0, bus = null) {
  const ctx = AUD.ctx; if (!ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  if (typeof shape === 'number') o.setPeriodicWave(AUD.pulses[shape]); else o.type = shape;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  _env(g, t, vol, dur); o.connect(g); g.connect(_out(bus || AUD.sfxbus, pan));
  o.start(t); o.stop(t + dur + 0.05);
}
function _noise(dur, vol, f0, f1, at = 0, pan = 0, kind = 'lowpass', bus = null, crunchy = true) {
  const ctx = AUD.ctx; if (!ctx) return;
  const t = ctx.currentTime + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = crunchy ? AUD.crunch : AUD.noise; s.loop = true; s.playbackRate.value = 1;
  f.type = kind; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  _env(g, t, vol, dur, 0.002); s.connect(f); f.connect(g); g.connect(_out(bus || AUD.sfxbus, pan));
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function _arp(notes, step, shape, vol, pan = 0, at = 0) { notes.forEach((m, i) => _tone(shape, mtof(m), mtof(m), step * 1.4, vol, at + i * step, pan)); }

// ---- the sound effects: name -> how to play it (pan -1..1, v 0..1 volume multiplier, o options)
const SFX = {
  step: (p, v, o) => {
    const k = o && o.surface, q = (o && o.quiet) ? 0.35 : (o && o.loud) ? 1.6 : 1;
    if (k === 'hard') _noise(0.035, 0.16 * q * v, 2400, 900, 0, p, 'bandpass');
    else if (k === 'water') _noise(0.09, 0.14 * q * v, 1400, 500, 0, p, 'bandpass');
    else _noise(0.04, 0.10 * q * v, 700, 300, 0, p, 'lowpass');
  },
  swing: (p, v) => _noise(0.08, 0.14 * v, 600, 2400, 0, p, 'bandpass'),
  hit: (p, v) => { _tone(0.25, 240, 70, 0.10, 0.22 * v, 0, p); _noise(0.07, 0.2 * v, 1800, 400, 0, p); },
  fleshy: (p, v) => { _noise(0.09, 0.26 * v, 500, 140, 0, p); _tone('triangle', 120, 50, 0.12, 0.25 * v, 0, p); },
  kill: (p, v) => { _tone(0.25, 320, 40, 0.22, 0.24 * v, 0, p); _noise(0.14, 0.24 * v, 1200, 120, 0, p); },
  shoot: (p, v) => { _noise(0.28, 0.5 * v, 5200, 220, 0, p, 'lowpass'); _tone(0.5, 700, 55, 0.14, 0.26 * v, 0, p); },
  blast: (p, v) => { _noise(0.8, 0.7 * v, 2600, 70, 0, p); _tone('triangle', 95, 28, 0.7, 0.5 * v, 0, p); },
  hurt: (p, v) => { _tone(0.5, 460, 110, 0.24, 0.32 * v, 0, p); _noise(0.1, 0.25 * v, 2000, 600, 0, p); },
  alert: (p, v) => { _tone(0.125, 95, 150, 0.4, 0.26 * v, 0, p); _tone(0.125, 98, 70, 0.4, 0.2 * v, 0.02, p); },
  scream: (p, v) => { _tone(0.25, 300, 900, 0.5, 0.26 * v, 0, p); _tone(0.25, 310, 880, 0.5, 0.2 * v, 0.03, p); },
  groan: (p, v) => _tone('triangle', 75, 52, 0.55, 0.22 * v, 0, p),
  door: (p, v) => { _noise(0.12, 0.18 * v, 400, 200, 0, p, 'bandpass'); _tone(0.5, 130, 80, 0.1, 0.14 * v, 0, p); },
  smash: (p, v) => { _noise(0.25, 0.4 * v, 3000, 200, 0, p); _tone(0.25, 180, 50, 0.18, 0.2 * v, 0, p); },
  pickup: (p, v) => _arp([81, 88], 0.06, 0.5, 0.18 * v, p),
  heal: (p, v) => _arp([72, 76, 79, 84], 0.06, 0.25, 0.17 * v, p),
  eat: (p, v) => { _noise(0.05, 0.14 * v, 900, 500); _noise(0.05, 0.14 * v, 900, 500, 0.09); },
  click: (p, v) => _tone(0.5, 1100, 900, 0.03, 0.12 * v),
  open: (p, v) => _arp([72, 79], 0.05, 0.5, 0.13 * v),
  level: (p, v) => _arp([67, 72, 76, 79, 84, 88], 0.07, 0.25, 0.2 * v),
  good: (p, v) => _arp([76, 83], 0.07, 0.5, 0.15 * v),
  warn: (p, v) => _arp([69, 62], 0.1, 0.5, 0.15 * v),
  note: (p, v) => _tone(0.5, 880, 880, 0.08, 0.08 * v),
  ally: (p, v) => _arp([72, 76], 0.05, 0.25, 0.1 * v, p),
  order: (p, v) => _arp([79, 84, 79], 0.04, 0.5, 0.12 * v, p),
  trap: (p, v) => { _noise(0.2, 0.3 * v, 3500, 400, 0, p, 'bandpass'); _tone(0.25, 900, 120, 0.2, 0.2 * v, 0, p); },
  stinger: (p, v) => { _tone(0.25, 110, 108, 0.7, 0.28 * v); _tone(0.25, 117, 115, 0.7, 0.24 * v); _noise(0.3, 0.12 * v, 800, 200); },
  siren: (p, v) => { for (let i = 0; i < 4; i++) _tone(0.5, i % 2 ? 520 : 780, i % 2 ? 520 : 780, 0.22, 0.2 * v, i * 0.2); },
  heart: (p, v) => { _tone('sine', 62, 40, 0.12, 0.5 * v); _tone('sine', 58, 38, 0.12, 0.4 * v, 0.17); },
  win: (p, v) => _arp([60, 64, 67, 72, 67, 72, 76, 79, 84], 0.16, 0.25, 0.22 * v),
  lose: (p, v) => { _arp([67, 63, 60, 55, 48], 0.28, 0.5, 0.2 * v); _noise(0.9, 0.12 * v, 700, 80, 0.3); },
};
const SFX_GAP = { open: 0.15, step: 0.06, swing: 0.1, hit: 0.05, fleshy: 0.05, alert: 0.25, groan: 0.8, click: 0.04, note: 0.12, good: 0.15, warn: 0.15, ally: 0.15 };

// Play a sound.  `pos` (optional, [x, y]) places it: quieter and panned by where it is relative to the player.
function audio_play(name, game, pos, o) {
  if (!AUD.ctx || !AUD.sfx_on || !SFX[name]) return;
  const t = AUD.ctx.currentTime;
  if (AUD.last[name] !== undefined && t - AUD.last[name] < (SFX_GAP[name] || 0.02)) return;
  let v = 1, pan = 0;
  if (pos && game) {
    const p = game.player, dx = pos[0] - p.x, dy = pos[1] - p.y, d = Math.max(Math.abs(dx), Math.abs(dy));
    v = Math.pow(clamp01(1 - d / 24), 1.3); pan = Math.max(-0.8, Math.min(0.8, dx / 12));
    if (v < 0.04) return;
  }
  AUD.last[name] = t;
  try { SFX[name](pan, v, o); } catch (e) { /* a sound must never break the game */ }
}
// The engine's side: ask for a sound by name.  Safe anywhere (tests, node): it only queues, the UI drains and plays.
function sfx(game, name, pos, o) {
  if (!game) return;
  const q = game.sounds || (game.sounds = []);
  q.push([name, pos || null, o || null]);
  if (q.length > 24) q.shift();
}
function audio_drain(game) {
  const q = game && game.sounds; if (!q || !q.length) return;
  const items = q.splice(0, q.length);
  for (const [name, pos, o] of items) audio_play(name, game, pos, o);
}

// ---- the log: messages that matter get a short cue by tag (the engine does not have to ask for each one)
function audio_on_log(game, since) {
  const seen = {};
  for (let i = since; i < game.log.length; i++) {
    const [, text, tag] = game.log[i];
    const cue = tag === 'dir' ? (/coming|restless|knocks|crowd/i.test(text) ? 'siren' : 'stinger') : tag === 'good' ? 'good' : tag === 'warn' ? 'warn' : tag === 'ally' ? 'ally' : tag === 'obj' ? 'note' : null;
    if (cue && !seen[cue]) { seen[cue] = 1; audio_play(cue, game); }
  }
}

// ---- the music: three layers over a minor-ish scale, tempo and layers driven by the Director's tension
const KEYS = {                                // root MIDI note, scale
  medieval: [50, [0, 2, 3, 5, 7, 9, 10]],     // D dorian
  eighties: [52, [0, 2, 3, 5, 7, 8, 10]],     // E minor
  modern: [45, [0, 2, 3, 5, 7, 8, 10]],       // A minor
  scifi: [49, [0, 1, 3, 5, 7, 8, 10]],        // C# phrygian
};
const PROG = [0, 0, 5, 4];                     // scale degrees of the bass, one per bar
function _note(deg, oct = 0) {
  const [root, scale] = KEYS[AUD.era] || KEYS.modern, n = scale.length, o = Math.floor(deg / n);
  return root + scale[((deg % n) + n) % n] + 12 * (o + oct);
}
function _musStep(i, t0) {
  const ctx = AUD.ctx, I = AUD.intensity, s = i & 15, bar = (i >> 4) & 3, at = t0 - ctx.currentTime;
  if (at < -0.05) return;
  const dur = 60 / (78 + I * 58) / 4;
  const bass = _note(PROG[bar], -2);
  const bassOn = I < 0.35 ? (s === 0 || s === 8) : I < 0.65 ? s % 4 === 0 : s % 2 === 0;
  if (bassOn) _tone('triangle', mtof(bass), mtof(bass), dur * (I < 0.35 ? 5 : 1.8), 0.34, at, 0, AUD.musbus);
  const arp = smooth(I, 0.28, 0.5);
  if (arp > 0.02 && (I > 0.55 || s % 2 === 0)) {
    const tones = [0, 2, 4, 7, 4, 2][(s >> (I > 0.55 ? 0 : 1)) % 6];
    _tone(0.25, mtof(_note(PROG[bar] + tones, 0)), mtof(_note(PROG[bar] + tones, 0)), dur * 1.5, 0.11 * arp, at, 0, AUD.musbus);
  }
  if (I < 0.55 && [0, 6, 10].includes(s) && Math.random() < 0.35 * (1 - I)) {              // sparse, eerie melody when it is quiet
    const m = _note(PROG[bar] + [0, 2, 4, 6][Math.floor(Math.random() * 4)], 1);
    _tone(0.5, mtof(m), mtof(m * 1) * 0.995, dur * 5, 0.07, at, 0, AUD.musbus);
  }
  const hat = smooth(I, 0.5, 0.7), snare = smooth(I, 0.68, 0.85);
  if (hat > 0.02 && s % 2 === 1) _noise(0.03, 0.07 * hat, 7000, 7000, at, 0, 'highpass', AUD.musbus);
  if (snare > 0.02 && (s === 4 || s === 12)) _noise(0.12, 0.16 * snare, 2500, 700, at, 0, 'bandpass', AUD.musbus);
  if (snare > 0.02 && s === 0) _tone('sine', 110, 40, 0.14, 0.4 * snare, at, 0, AUD.musbus);
  if (I > 0.8 && s === 0 && bar % 2 === 1) _tone(0.125, mtof(bass + 18), mtof(bass + 18), dur * 3, 0.1, at, 0, AUD.musbus);   // a tritone stab
}
function _musTick() {
  if (!AUD.ctx || !AUD.playing) return;
  AUD.intensity += (AUD.target - AUD.intensity) * 0.12;
  const now = AUD.ctx.currentTime;
  if (AUD.next < now) AUD.next = now + 0.05;
  const dur = 60 / ((78 + AUD.intensity * 58) * (AUD.inside ? 0.9 : 1)) / 4;
  while (AUD.next < now + 0.2) { _musStep(AUD.step, AUD.next); AUD.next += dur; AUD.step++; }
}
function audio_music_start() { if (!AUD.ctx || AUD.timer) return; AUD.next = AUD.ctx.currentTime + 0.1; AUD.timer = setInterval(_musTick, 60); }
function audio_music_stop() { if (AUD.timer) { clearInterval(AUD.timer); AUD.timer = 0; } }
function audio_set_playing(on, game) {
  AUD.playing = !!on;
  if (game) AUD.era = game.era.id;
  if (on) audio_music_start(); else audio_music_stop();
}

// How tense is it?  The Director's tension, the dead hunting you, a low body, the final stand; creeping eases it off.
function audio_update(game) {
  if (!game || game.over) { AUD.target = 0; return; }
  const p = game.player, d = game.director;
  AUD.era = game.era.id; AUD.inside = game.level !== game.world.level;
  let I = d ? d.tension / 100 * 0.75 : 0.1;
  let hunters = 0;
  for (const a of game.level.actors) if (a.kind === 'zombie' && a.state === 'hunt' && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 14) hunters++;
  if (hunters) I = Math.max(I, Math.min(0.95, 0.4 + hunters * 0.12));
  if (p.hp < p.max_hp * 0.3) I += 0.15;
  if (game.final) I = game.final.exit ? 1 : Math.max(I, 0.8);
  if (p.sneaking) I *= 0.75;
  AUD.target = clamp01(I);
  // a heartbeat when you are badly hurt or terrified
  if (AUD.ctx && (p.hp < p.max_hp * 0.25 || (p.panic || 0) > 70) && game.clock.turn !== AUD.heart && game.clock.turn % 3 === 0) { AUD.heart = game.clock.turn; audio_play('heart', game); }
}
