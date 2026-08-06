// Builds ../ngrams.js: character-trigram language models + high-frequency word
// sets for Hebrew and English, used to decide whether text was typed on the
// wrong layout.
//
// Fetch the source corpora into this directory first, then run the script:
//
//   cd tools
//   BASE=https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018
//   curl -O $BASE/he/he_50k.txt -O $BASE/en/en_50k.txt
//   node build_model.js
//
// The corpora are OpenSubtitles word-frequency lists (CC BY-SA 4.0) and are not
// checked in; only the derived statistics ship.
const fs = require('fs');
const path = require('path');

const DATA = __dirname;
const OUT = path.join(__dirname, '..', 'ngrams.js');

const HE_RE = /^[א-ת]+$/;
const EN_RE = /^[a-z]+$/;

const DICT_SIZE = 8000;   // words kept per language
const BOUND = '^';        // word-boundary marker

function loadFreq(file, re) {
  const out = [];
  for (const line of fs.readFileSync(path.join(DATA, file), 'utf8').split('\n')) {
    const [w, c] = line.trim().split(/\s+/);
    if (!w || !c) continue;
    const word = w.toLowerCase();
    if (!re.test(word)) continue;
    out.push([word, Number(c)]);
  }
  return out;
}

// Trigram counts over ^word^, weighted by dampened frequency so that a handful
// of ultra-common words don't dominate the distribution.
function buildTrigrams(freq) {
  const counts = new Map();
  let total = 0;
  for (const [word, c] of freq) {
    const weight = Math.log1p(c);
    const padded = BOUND + word + BOUND;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const g = padded.slice(i, i + 3);
      counts.set(g, (counts.get(g) || 0) + weight);
      total += weight;
    }
  }
  return { counts, total };
}

// Quantize log-probabilities to integers to keep the shipped file small.
// Stored value = round(logProb * -10); reader divides by -10.
const SCALE = -10;

// The table ships as two flat strings — trigrams concatenated at 3 chars each,
// quantized values at 2 base-36 chars each — rather than a JSON object. That
// drops the braces, quotes and commas (roughly 60% of the bytes) and lets the
// content script defer parsing until the user actually types.
function quantize({ counts, total }, floorProb) {
  let keys = '', vals = '';
  for (const [g, c] of counts) {
    const p = c / total;
    if (p < floorProb) continue;
    const q = Math.round(Math.log(p) * SCALE);
    if (q < 0 || q > 1295) continue;          // outside 2-char base36 range
    keys += g;
    vals += q.toString(36).padStart(2, '0');
  }
  return { keys, vals, count: keys.length / 3 };
}

function build(file, re, label) {
  const freq = loadFreq(file, re);
  const tri = buildTrigrams(freq);
  // Drop the long tail of near-zero trigrams; they cost bytes and the
  // unseen-trigram floor covers them at scoring time anyway.
  const table = quantize(tri, 5e-7);
  const dict = freq.slice(0, DICT_SIZE).map(([w]) => w);
  console.log(`${label}: ${freq.length} words -> ${table.count} trigrams, dict ${dict.length}`);
  return { table, dict };
}

const he = build('he_50k.txt', HE_RE, 'hebrew');
const en = build('en_50k.txt', EN_RE, 'english');

const lang = (m) =>
  `{ keys: ${JSON.stringify(m.table.keys)},\n        vals: ${JSON.stringify(m.table.vals)},\n        words: ${JSON.stringify(m.dict.join(' '))} }`;

const src = `// GENERATED FILE - do not edit by hand. See tools/build_model.js
// Character-trigram language models and high-frequency word lists used to decide
// whether a piece of text was typed on the wrong keyboard layout.
//
// Trigrams are stored as two flat strings: 'keys' holds each trigram at a fixed
// 3 characters, 'vals' holds its quantized log-probability at 2 base-36
// characters. detect.js expands them into a lookup on first use.
//
// Derived from word-frequency statistics of the OpenSubtitles corpus
// (hermitdave/FrequencyWords, CC BY-SA 4.0).
(function (root) {
  'use strict';
  root.__langFixerModel = {
    scale: ${SCALE},
    bound: ${JSON.stringify(BOUND)},
    he: ${lang(he)},
    en: ${lang(en)}
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(OUT, src);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\nwrote ngrams.js (${kb} KB)`);
