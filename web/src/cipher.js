// ---------------------------------------------------------------- the cipher: documents you learn to read
const EXPOSURE_TO_LEARN = 4, STUDY_LIMIT = 3, FUNCTION_FLUENCY = 0.25, FULL_FLUENCY = 0.80, DECODE_THRESHOLD = 0.6;
const DOC_NAMES = ['Hale', 'Marsh', 'Okoye', 'Brandt', 'Vega', 'Ashby', 'Kovac', 'Reyes', 'Lindqvist', 'Dara'];
const FUNCTION_WORDS = new Set(('the a an and or but of to in on at by for from with as is are was were be it its that this ' +
  'these those who what where when not only into through their his her your you they them we our one all some every than ' +
  'while can will would have has had which no do does did if so then there here').split(' '));
const TEMPLATES = {
  research: [
    '{leader} {name} sealed the {sample} for the {cure} in the {place} below {poi}. The {guard} hold the {place}. {warning}.',
    'The {sample} is kept in the {place} of {poi}. The {cure} cannot be made without it. {warning}.'],
  code: [
    'The {place} below {poi} opens with the {signal} code {n}. Tell no one. {warning}.',
    '{leader} {name} wrote the {place} code on this page: {n}. It is for {poi} only.'],
  evac: [
    'The {escape} leaves from {pad}. Bring the {signal}. Do not trust the {guard}. {warning}.',
    '{leader} {name}: the last {escape} will wait at {pad} until the {signal} fails.'],
  formula: [
    '{cure} formula, copy {n}. Combine the {sample} with the {sickness} {sample}. Add the catalyst slowly, then stabilise. ' +
    'The {cure} must not touch the {dead}. {warning}.'],
  manual: [
    '{leader} {name} wrote down how to build the {recipe}. Keep this page from the {dead}. {warning}.',
    'How to make the {recipe}, as the {guard} taught it. {name} says it saves lives. {warning}.'],
  diary: [
    'Day {n}. The {sickness} spread faster than the {leader} said. We hear the {dead} at night. I will not leave {name} behind.',
    'The {guard} left at dawn. {name} says the {cure} is a lie. I think the {dead} are listening for the {signal}.',
    '{leader} {name} has the {sample} and will not share it. {warning}. We keep the door shut.',
    'If you find this: do not go near the {place} under {poi}. The {dead} came up through it.',
    'Day {n}. No word on the {escape}. The {signal} is silent. {name} coughs all night.'],
};
const DOC_TITLES = { research: 'Research note', code: 'Access code', evac: 'Evacuation log', formula: 'Formula sheet',
                     diary: 'Diary page', manual: 'Manual' };

class Knowledge {
  constructor(vocab, glyphs) { this.vocab = vocab; this.glyphs = glyphs; this.known = new Set(); this.exposure = {}; }
  get fluency() { return this.vocab.length ? this.known.size / this.vocab.length : 1.0; }
  learn(word) {
    if (this.known.has(word) || !this.vocab.includes(word)) return false;
    this.known.add(word);
    return true;
  }
  learn_random(rng, n) {
    const unknown = this.vocab.filter((w) => !this.known.has(w));
    rng.shuffle(unknown);
    const out = unknown.slice(0, n);
    for (const w of out) this.known.add(w);
    return out;
  }
  glyph_word(word) {
    const r = new RNG(word), g = Array.from(this.glyphs);
    return Array.from(word).map(() => r.choice(g)).join('');
  }
}

function make_document(rng, era, doc_id, kind, poi_name = '', pad_name = '', payload = {}) {
  let text = rng.choice(TEMPLATES[kind]);
  const words = [];
  text = text.replace(/\{(\w+)\}/g, (m, key) => {
    if (era.lexicon[key]) { const w = rng.choice(era.lexicon[key]); words.push(w); return w; }
    if (key === 'recipe') return payload.name || 'thing';
    if (key === 'poi') return poi_name;
    if (key === 'pad') return pad_name;
    if (key === 'name') return rng.choice(DOC_NAMES);
    if (key === 'n') return String(rng.randint(2, 9)) + String(rng.randint(1, 9)) + String(rng.randint(1, 9));
    return key;
  });
  text = text.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return { id: doc_id, kind, title: kind === 'manual' ? 'Manual: ' + (payload.name || 'crafting').toLowerCase() : DOC_TITLES[kind], text, words, payload, studies: 0 };
}

const doc_tokens = (doc) => doc.text.match(/[A-Za-z][A-Za-z'-]*|\d+|[^\sA-Za-z\d]/g) || [];

function decoded_fraction(doc, know) {
  if (!doc.words.length) return 1.0;
  return doc.words.filter((w) => know.known.has(w)).length / doc.words.length;
}
const is_decoded = (doc, know) => decoded_fraction(doc, know) >= DECODE_THRESHOLD;

function render_document(doc, know) {
  const decoded = is_decoded(doc, know), flu = know.fluency, word_set = new Set(doc.words);
  const out = [];
  for (const tok of doc_tokens(doc)) {
    const low = tok.toLowerCase();
    if (!/[A-Za-z]/.test(tok[0])) out.push(tok);
    else if ((know.known.has(low) && word_set.has(low)) || know.known.has(tok)) out.push(tok);
    else if (word_set.has(low)) out.push(know.glyph_word(tok));
    else if (FUNCTION_WORDS.has(low)) out.push(decoded || flu >= FUNCTION_FLUENCY ? tok : know.glyph_word(tok));
    else out.push(decoded || flu >= FULL_FLUENCY ? tok : know.glyph_word(tok));
  }
  let text = '';
  for (const tok of out) text += (!text || '.,:;!?'.includes(tok) || text.endsWith('-')) ? tok : ' ' + tok;
  return text;
}

function expose(doc, know, threshold = EXPOSURE_TO_LEARN) {
  const learned = [];
  for (const w of new Set(doc.words)) {
    if (know.known.has(w)) continue;
    know.exposure[w] = (know.exposure[w] || 0) + 1;
    if (know.exposure[w] >= threshold) { know.learn(w); learned.push(w); }
  }
  return learned;
}

function study(rng, doc, know, bonus = 0.0, words_per_try = 1) {
  if (doc.studies >= STUDY_LIMIT) return [];
  doc.studies += 1;
  const unknown = Array.from(new Set(doc.words)).filter((w) => !know.known.has(w));
  rng.shuffle(unknown);
  const learned = [];
  const chance = Math.min(0.95, 0.5 + bonus + know.fluency * 0.3);
  for (const w of unknown.slice(0, Math.max(1, words_per_try))) {
    if (rng.random() < chance && know.learn(w)) learned.push(w);
  }
  return learned;
}
