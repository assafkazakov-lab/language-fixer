// Run with: node test/detect.test.js
//
// The gate this suite exists to enforce: correctly-typed text must never be
// offered for conversion. The previous heuristic failed that on ordinary
// Hebrew prose and on most lowercase English, which is what made the extension
// feel noisy in real use.
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'ngrams.js'));
const D = require(path.join(__dirname, '..', 'detect.js'));

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(detail ? `${name}\n      ${detail}` : name);
}

// ── 1. Layout map round-trips ────────────────────────────────────────────────
{
  const keys = "abcdefghijklmnopqrstuvwxyz;,./'";
  for (const ch of keys) {
    const there = D.toHebrew(ch);
    check(`round-trip ${JSON.stringify(ch)}`, D.toEnglish(there) === ch,
      `${JSON.stringify(ch)} -> ${JSON.stringify(there)} -> ${JSON.stringify(D.toEnglish(there))}`);
  }
  // q, w and / were missing from the original map, leaving stray Latin letters
  // inside converted Hebrew.
  check('q maps to /', D.toHebrew('q') === '/');
  check('w maps to apostrophe', D.toHebrew('w') === "'");
  check('world converts cleanly', D.toHebrew('world') === "'םרךג",
    `got ${JSON.stringify(D.toHebrew('world'))}`);
}

// ── 2. Correct text is never flagged ─────────────────────────────────────────
{
  const hebrew = [
    'מה שלומך', 'תודה רבה', 'בוקר טוב', 'סבבה', 'מתי נפגשים', 'אני צריך עזרה',
    'שלום', 'להתראות', 'בבקשה', 'אני הולך הביתה', 'זה נראה טוב', 'כמה זה עולה',
    'איפה אתה גר', 'יום הולדת שמח', 'אין בעיה', 'רגע אחד בבקשה',
  ];
  const english = [
    'docker compose up', 'github', 'npm install react', 'kubectl apply', 'assaf',
    'brainstorm', 'language fixer', 'hello', 'hey', 'claude', 'anthropic',
    'postgres', 'nginx', 'tel aviv', 'good morning everyone', 'see you tomorrow',
    'what time is the meeting', 'please review this pull request',
  ];
  for (const s of hebrew) {
    check(`no false positive (he): ${s}`, D.detectConversion(s) === null,
      `flagged as ${D.detectConversion(s)} -> ${JSON.stringify(D.toEnglish(s))}`);
  }
  for (const s of english) {
    check(`no false positive (en): ${s}`, D.detectConversion(s) === null,
      `flagged as ${D.detectConversion(s)} -> ${JSON.stringify(D.toHebrew(s))}`);
  }
}

// ── 3. Non-language strings are never flagged ────────────────────────────────
{
  const skip = [
    'Xk9vRm2p', 'hunter2', 'a1b2c3d4', 'user@example.com', 'https://example.com/x',
    'src/main.js', 'my-branch-name', 'C:\\Users\\test', '2024-01-15',
  ];
  for (const s of skip) {
    check(`skips non-language: ${s}`, D.detectConversion(s) === null,
      `flagged as ${D.detectConversion(s)}`);
  }
}

// ── 4. Genuinely mistyped text is caught ─────────────────────────────────────
{
  const enWords = ['hello', 'thanks', 'docker', 'meeting', 'tomorrow', 'please',
    'password', 'morning', 'question', 'water', 'window', 'where'];
  let hit = 0;
  for (const w of enWords) {
    if (D.detectConversion(D.toHebrew(w)) === 'toEnglish') hit++;
  }
  check(`catches English typed on Hebrew layout (${hit}/${enWords.length})`,
    hit >= enWords.length - 1, `only ${hit} of ${enWords.length}`);

  const heWords = ['שלום', 'תודה', 'בבקשה', 'להתראות', 'מחשב', 'עבודה',
    'בוקר', 'ילדים', 'משפחה', 'אנשים'];
  let hit2 = 0;
  for (const w of heWords) {
    if (D.detectConversion(D.toEnglish(w)) === 'toHebrew') hit2++;
  }
  check(`catches Hebrew typed on English layout (${hit2}/${heWords.length})`,
    hit2 >= heWords.length - 1, `only ${hit2} of ${heWords.length}`);
}

// ── 5. Conversion touches only the wrong-script words ────────────────────────
{
  const mixed = 'I told him יקךךם yesterday';
  const out = D.convertSpan(mixed, 'toEnglish');
  check('converts only the mistyped word', out === 'I told him hello yesterday',
    `got ${JSON.stringify(out)}`);
  // The layout map is 1:1, which is what lets the caller restore the caret.
  check('conversion preserves length', out.length === mixed.length);

  const withCode = 'run npm install then יקךךם';
  const out2 = D.convertSpan(withCode, 'toEnglish');
  check('leaves correct English untouched', out2 === 'run npm install then hello',
    `got ${JSON.stringify(out2)}`);

  // A correctly-typed word sharing a script with the garbled majority of the
  // field must survive. r.dir is script-determined (any Hebrew-scripted token
  // is a 'toEnglish' candidate), so without gating on the token's own evidence
  // sign, converting the whole field for one garbled sentence would also
  // mangle an unrelated, correctly-typed Hebrew word sitting right next to it.
  const codeSwitch = D.toHebrew('hello world how are you doing today') + ' שלום';
  const out3 = D.convertSpan(codeSwitch, 'toEnglish');
  check('leaves a correct same-script word untouched', out3.endsWith(' שלום'),
    `got ${JSON.stringify(out3)}`);
  check('still fixes the actually-garbled part',
    out3 === 'hello world how are you doing today שלום',
    `got ${JSON.stringify(out3)}`);
}

// ── 6. The hotkey flip is unconditional and reversible ───────────────────────
{
  // Detection deliberately ignores these; the hotkey must still work, which is
  // what makes password fields usable.
  for (const s of ['xk9vrm2p', 'hunter2', 'github', 'שלום']) {
    check(`flip is its own inverse: ${s}`, D.flip(D.flip(s)) === s,
      `${JSON.stringify(s)} -> ${JSON.stringify(D.flip(s))} -> ${JSON.stringify(D.flip(D.flip(s)))}`);
  }
  // Hebrew is caseless, so a round trip through it lowercases Latin text. The
  // information is genuinely gone — a Hebrew layout ignores Shift — so the
  // guarantee we can offer is inversion up to case.
  check('flip round-trips mixed case up to case',
    D.flip(D.flip('Xk9vRm2p')) === 'xk9vrm2p',
    `got ${JSON.stringify(D.flip(D.flip('Xk9vRm2p')))}`);
  check('flip acts even when detection declines', D.flip('github') !== 'github');
}

// ── 7. No flicker: once a prefix is flagged, longer prefixes stay flagged ────
{
  for (const word of ['hello', 'thanks', 'tomorrow', 'meeting']) {
    const mistyped = D.toHebrew(word);
    let fired = false, flapped = false;
    for (let i = 1; i <= mistyped.length; i++) {
      const hit = D.detectConversion(mistyped.slice(0, i)) === 'toEnglish';
      if (hit) fired = true;
      else if (fired) flapped = true;
    }
    check(`no flicker while typing "${word}"`, !flapped,
      'suggestion appeared then vanished on a longer prefix');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
