// Keyboard-layout conversion and wrong-layout detection.
//
// Detection works by scoring two readings of the same keystrokes: the text as it
// stands, and the text as it would read on the other layout. We only suggest a
// conversion when the alternative reading is far more plausible than the original
// under a character-trigram model of each language. That is what keeps ordinary
// text — Hebrew prose, English product names, people's names — from triggering.
(function (root) {
  'use strict';

  // ── Israeli standard keyboard layout ─────────────────────────────────────
  var EN_TO_HE = {
    q:'/', w:"'", e:'ק', r:'ר', t:'א', y:'ט', u:'ו', i:'ן', o:'ם', p:'פ',
    a:'ש', s:'ד', d:'ג', f:'כ', g:'ע', h:'י', j:'ח', k:'ל', l:'ך', ';':'ף', "'":',',
    z:'ז', x:'ס', c:'ב', v:'ה', b:'נ', n:'מ', m:'צ', ',':'ת', '.':'ץ', '/':'.',
  };

  var HE_TO_EN = {};
  for (var k in EN_TO_HE) HE_TO_EN[EN_TO_HE[k]] = k;

  function toHebrew(text) {
    return Array.from(text).map(function (ch) {
      var m = EN_TO_HE[ch.toLowerCase()];
      return m === undefined ? ch : m;
    }).join('');
  }

  function toEnglish(text) {
    return Array.from(text).map(function (ch) {
      var m = HE_TO_EN[ch];
      return m === undefined ? ch : m;
    }).join('');
  }

  // ── Scoring ──────────────────────────────────────────────────────────────
  var UNSEEN = -16;      // log-prob floor for trigrams absent from the model
  var DICT_BONUS = 3.0;  // added to a word's mean log-prob when it's a known word
  var THRESHOLD = 1.2;   // minimum length-weighted evidence to suggest a switch

  var HEB_CHAR = /[א-ת]/;
  var LAT_CHAR = /[a-z]/;

  var model = null;
  var tables = null;
  var wordSets = null;

  // The shipped model is two flat strings per language. Expanding them costs a
  // few milliseconds, so it happens on first detection rather than at page load
  // — most pages never receive a keystroke.
  function expand(lang) {
    var m = new Map();
    var keys = lang.keys, vals = lang.vals;
    for (var i = 0, j = 0; i < keys.length; i += 3, j += 2) {
      m.set(keys.substr(i, 3), parseInt(vals.substr(j, 2), 36));
    }
    return m;
  }

  function ensureModel() {
    if (model || !root.__langFixerModel) return;
    model = root.__langFixerModel;
    tables = { he: expand(model.he), en: expand(model.en) };
    wordSets = {
      he: new Set(model.he.words.split(' ')),
      en: new Set(model.en.words.split(' ')),
    };
  }

  // Mean trigram log-probability of a word, plus a bonus if it's a known word.
  function scoreWord(word, lang) {
    var tri = tables[lang];
    var padded = model.bound + word + model.bound;
    var sum = 0, n = 0;
    for (var i = 0; i + 3 <= padded.length; i++) {
      var q = tri.get(padded.substr(i, 3));
      sum += q === undefined ? UNSEEN : q / model.scale;
      n++;
    }
    var mean = n ? sum / n : UNSEEN;
    return wordSets[lang].has(word) ? mean + DICT_BONUS : mean;
  }

  // Tokens that aren't natural-language words at all. Converting these is never
  // what the user wants, and they're a large share of what the old heuristic
  // false-positived on.
  function isCodeLike(token) {
    return /[0-9_@\\]/.test(token) ||
           /[-./]{1,}/.test(token) && /[-./].*[a-z]/i.test(token);
  }

  // Digits and separators stay *inside* tokens so that isCodeLike can see them.
  // Splitting them out first would turn "Xk9vRm2p" into three innocent-looking
  // letter runs.
  function tokenize(text) {
    return text.split(/[^א-תA-Za-z0-9_'/;,.@\\-]+/).filter(Boolean);
  }

  // How many characters of the token the layout map would actually change.
  // This is the token's evidence weight — and it must count mapped punctuation,
  // not just letters: "week" typed on a Hebrew layout is "'קקל", where the
  // apostrophe stands for the "w".
  function mappedLength(token, map) {
    var n = 0;
    for (var i = 0; i < token.length; i++) if (map[token[i]] !== undefined) n++;
    return n;
  }

  // Evidence that `token` should be flipped. Positive means "convert", and the
  // magnitude is how much more plausible the other reading is per character.
  function tokenEvidence(token) {
    var lower = token.toLowerCase();
    var heCount = 0, latCount = 0;
    for (var i = 0; i < lower.length; i++) {
      if (HEB_CHAR.test(lower[i])) heCount++;
      else if (LAT_CHAR.test(lower[i])) latCount++;
    }
    if (heCount && latCount) return null;          // mixed script: leave alone
    if (heCount >= 2) {
      var asEn = toEnglish(lower).replace(/[^a-z]/g, '');
      if (!asEn) return null;
      return {
        dir: 'toEnglish',
        ev: scoreWord(asEn, 'en') - scoreWord(lower.replace(/[^א-ת]/g, ''), 'he'),
        len: mappedLength(lower, HE_TO_EN),
      };
    }
    if (latCount >= 2) {
      var asHe = toHebrew(lower).replace(/[^א-ת]/g, '');
      if (!asHe) return null;
      return {
        dir: 'toHebrew',
        ev: scoreWord(asHe, 'he') - scoreWord(lower.replace(/[^a-z]/g, ''), 'en'),
        len: mappedLength(lower, EN_TO_HE),
      };
    }
    return null;
  }

  // Returns 'toEnglish' | 'toHebrew' | null
  function detectConversion(text) {
    ensureModel();
    if (!model || !text) return null;
    if (/https?:\/\/|www\.|\S+@\S+/.test(text)) return null;

    var tokens = tokenize(text);
    var totals = { toEnglish: 0, toHebrew: 0 };
    var lengths = { toEnglish: 0, toHebrew: 0 };
    var letters = 0;

    for (var i = 0; i < tokens.length; i++) {
      if (isCodeLike(tokens[i])) return null;
      var r = tokenEvidence(tokens[i]);
      if (!r) continue;
      letters += r.len;
      totals[r.dir] += r.ev * r.len;
      lengths[r.dir] += r.len;
    }
    if (letters < 4) return null;

    var dir = lengths.toEnglish >= lengths.toHebrew ? 'toEnglish' : 'toHebrew';
    if (!lengths[dir]) return null;
    return totals[dir] / lengths[dir] > THRESHOLD ? dir : null;
  }

  // Unconditional flip, used by the hotkey. Direction is inferred from script
  // alone, with no plausibility check — the user asked for it. This is what
  // makes password fields work, since those can never be scored.
  //
  // Flipping is its own inverse except for letter case: Hebrew has no case, so
  // Latin -> Hebrew -> Latin comes back lowercased. That loss is inherent, not a
  // shortcut — a Hebrew layout produces the same letter with or without Shift,
  // so a genuinely mistyped capital was never recorded in the first place.
  function flip(text) {
    var he = 0, lat = 0;
    for (var i = 0; i < text.length; i++) {
      if (HEB_CHAR.test(text[i])) he++;
      else if (LAT_CHAR.test(text[i].toLowerCase())) lat++;
    }
    if (!he && !lat) return text;
    return he > lat ? toEnglish(text) : toHebrew(text);
  }

  var TOKEN_RE = /[א-תA-Za-z0-9_'/;,.@\\-]+/g;

  // Convert only the tokens that are actually in the wrong script, leaving the
  // rest of the field untouched. The layout map is 1:1, so the result is always
  // the same length as the input and caller-held cursor offsets stay valid.
  function convertSpan(text, dir) {
    var fn = dir === 'toEnglish' ? toEnglish : toHebrew;
    var out = Array.from(text);
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      var tok = m[0];
      if (isCodeLike(tok)) continue;
      var r = tokenEvidence(tok);
      // r.dir is which conversion a token of this script *would* need if it
      // were wrong — it says nothing about whether this particular token
      // actually is wrong. A correctly-typed word sharing a script with the
      // garbled majority of the field (e.g. one real Hebrew word inside an
      // otherwise-garbled English sentence) still gets r.dir === dir; only
      // r.ev (this token's own evidence) distinguishes it. Without gating on
      // sign, a whole-field convert destroys same-script words it should
      // leave untouched.
      if (!r || r.dir !== dir || r.ev <= 0) continue;
      var conv = fn(tok);
      for (var i = 0; i < tok.length; i++) out[m.index + i] = conv[i];
    }
    return out.join('');
  }

  var api = {
    toHebrew: toHebrew,
    toEnglish: toEnglish,
    detectConversion: detectConversion,
    convertSpan: convertSpan,
    flip: flip,
    _internals: { scoreWord: scoreWord, tokenEvidence: tokenEvidence, ensureModel: function () { ensureModel(); } },
  };

  root.__langFixerDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
