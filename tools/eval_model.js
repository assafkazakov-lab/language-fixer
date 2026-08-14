// Corpus-scale accuracy eval for detect.js — false positives and recall,
// measured on words held out from the shipped dictionary (top 8000 by
// frequency per language), so DICT_BONUS can't inflate the numbers.
//
// Requires the source corpora (see README.md's "Rebuilding the model"):
//   cd tools
//   BASE=https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018
//   curl -O $BASE/he/he_50k.txt -O $BASE/en/en_50k.txt
//   node eval_model.js
'use strict';
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'ngrams.js'));
const D = require(path.join(__dirname, '..', 'detect.js'));

const DICT_SIZE = 8000;
const SAMPLE_SIZE = 3000;
const HE_RE = /^[א-ת]+$/;
const EN_RE = /^[a-z]+$/;

function loadWords(file, re) {
  const words = [];
  for (const line of fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n')) {
    const [w] = line.trim().split(/\s+/);
    if (w && re.test(w)) words.push(w);
  }
  return words;
}

// Deterministic stride sample — reproducible across runs, no Math.random.
function sample(arr, n) {
  const stride = Math.max(1, Math.floor(arr.length / n));
  const out = [];
  for (let i = 0; i < arr.length && out.length < n; i += stride) out.push(arr[i]);
  return out;
}

function falsePositiveRate(words) {
  let fp = 0;
  for (const w of words) if (D.detectConversion(w) !== null) fp++;
  return fp / words.length;
}

// Garble a correctly-typed word as if it had been typed on the other layout;
// check detectConversion recovers the intended direction.
function recallRate(words, garble, wantDir) {
  let hit = 0;
  for (const w of words) if (D.detectConversion(garble(w)) === wantDir) hit++;
  return hit / words.length;
}

function pct(x) { return (100 * x).toFixed(2) + '%'; }

function run() {
  let heAll, enAll;
  try {
    heAll = loadWords('he_50k.txt', HE_RE);
    enAll = loadWords('en_50k.txt', EN_RE);
  } catch (e) {
    console.error('Corpora not found. Fetch them first — see the header comment in this file.');
    process.exit(1);
  }

  const heHeld = sample(heAll.slice(DICT_SIZE), SAMPLE_SIZE);
  const enHeld = sample(enAll.slice(DICT_SIZE), SAMPLE_SIZE);

  const heFP = falsePositiveRate(heHeld);
  const enFP = falsePositiveRate(enHeld);
  const heRecall = recallRate(heHeld, D.toEnglish, 'toHebrew');
  const enRecall = recallRate(enHeld, D.toHebrew, 'toEnglish');

  // Recall restricted to words of at least 4 mapped characters — detectConversion
  // structurally never fires below that (see the `letters < 4` gate), so shorter
  // held-out words are not a model-quality failure, they're out of scope by design.
  const heHeld4 = heHeld.filter((w) => w.length >= 4);
  const enHeld4 = enHeld.filter((w) => w.length >= 4);
  const heRecall4 = recallRate(heHeld4, D.toEnglish, 'toHebrew');
  const enRecall4 = recallRate(enHeld4, D.toHebrew, 'toEnglish');

  console.log(`Held-out sample: ${heHeld.length} Hebrew words, ${enHeld.length} English words`);
  console.log(`(beyond the top ${DICT_SIZE} by frequency, i.e. outside the shipped dictionary)\n`);
  console.log('Single-word evaluation (isolated word, no sentence context):');
  console.log(`  Hebrew  — false positives ${pct(heFP)}, recall ${pct(heRecall)} (${pct(heRecall4)} restricted to words >=4 chars)`);
  console.log(`  English — false positives ${pct(enFP)}, recall ${pct(enRecall)} (${pct(enRecall4)} restricted to words >=4 chars)`);
  console.log('\nRecall on short words (<4 chars) is structurally lower: detectConversion');
  console.log('requires >=4 mapped characters of evidence before it will ever fire, by');
  console.log('design (avoids false positives on short tokens). Real messages are mostly');
  console.log('multi-word, so aggregate evidence across a sentence clears this easily —');
  console.log('this eval is intentionally the harder, isolated-word case.');
}

run();
