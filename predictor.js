// Predicts which language the user is about to type in a given context, and how
// confidently to act on that prediction.
//
// The hard part is not guessing the language — it is knowing when to keep quiet.
// Failing to switch costs the user nothing: they press the layout key, as they do
// today. Switching wrongly costs them a garbled sentence *and* a keyboard that
// changed without being asked. So the bar to act is deliberately high, and it is
// expressed as a lower confidence bound rather than a raw ratio: nine
// observations out of ten is "90%" but is almost no evidence, and thresholding
// the raw ratio would auto-switch on it.
(function (root) {
  'use strict';

  // Tier thresholds, on the Wilson lower bound — not the observed ratio.
  var AUTO_BOUND = 0.97;      // switch the layout for the user
  var INDICATE_BOUND = 0.70;  // show which layout is active, but decide nothing
  var AUTO_MIN_OBS = 30;      // never auto-switch on a thinly-observed context
  var AUTO_MIN_ACCURACY = 0.95; // demote a context that predicts badly in practice
  var ACCURACY_MIN_OBS = 10;  // ...but only once it has a track record to judge

  // A context needs this many observations before we prefer it over a coarser one.
  var SPECIFIC_MIN_OBS = 5;

  // Weight given to the language of surrounding conversation text, expressed as
  // pseudo-observations. This is what makes a brand-new thread predictable: an
  // unseen Hebrew conversation has no history under its own key, but its visible
  // messages are strong evidence.
  //
  // Sized so a confident prior alone clears INDICATE_BOUND — 12/(12+z^2) = 0.76 —
  // while staying far below the ~125 observations auto-switching requires. The
  // prior can surface the indicator; it can never move the user's keyboard.
  var CONTENT_PRIOR_WEIGHT = 12;

  var Z = 1.96;               // 95% confidence
  var Z2 = Z * Z;

  // Lower bound of the Wilson score interval for a binomial proportion. Rises
  // toward the observed rate only as evidence accumulates, which gives correct
  // cold-start behaviour for free.
  //
  //   9/10   at 90% observed -> 0.60
  //   90/100 at 90% observed -> 0.83
  //   900/1000 at 90%        -> 0.88
  function wilsonLowerBound(successes, total) {
    if (total <= 0) return 0;
    var p = successes / total;
    var denom = 1 + Z2 / total;
    var centre = p + Z2 / (2 * total);
    var margin = Z * Math.sqrt(p * (1 - p) / total + Z2 / (4 * total * total));
    var lower = (centre - margin) / denom;
    return lower < 0 ? 0 : lower;
  }

  function emptyRecord() {
    return { counts: {}, predCorrect: 0, predTotal: 0 };
  }

  function totalOf(counts) {
    var t = 0;
    for (var k in counts) t += counts[k];
    return t;
  }

  function dominantOf(counts) {
    var best = null, bestN = -1;
    for (var k in counts) {
      if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    }
    return best;
  }

  function Predictor(options) {
    options = options || {};
    this.records = {};
    // Shadow mode observes and scores itself without ever acting. Prediction
    // ships this way: accuracy is measured against the user's real typing before
    // the app is trusted to change their keyboard.
    this.shadowMode = options.shadowMode !== false;
    this.suppressed = {};   // context keys we must not act on this focus session
  }

  Predictor.prototype._record = function (key) {
    if (!this.records[key]) this.records[key] = emptyRecord();
    return this.records[key];
  };

  // Record what the user actually typed in a context. `keys` runs from most
  // specific to coarsest; every level learns, so coarse keys stay useful as the
  // fallback for contexts seen for the first time.
  Predictor.prototype.observe = function (keys, lang) {
    for (var i = 0; i < keys.length; i++) {
      var rec = this._record(keys[i]);
      rec.counts[lang] = (rec.counts[lang] || 0) + 1;
    }
  };

  // Pick the most specific context key that has enough evidence to speak for
  // itself, falling back to coarser keys otherwise.
  Predictor.prototype._resolve = function (keys) {
    for (var i = 0; i < keys.length; i++) {
      var rec = this.records[keys[i]];
      if (rec && totalOf(rec.counts) >= SPECIFIC_MIN_OBS) return keys[i];
    }
    return keys.length ? keys[keys.length - 1] : null;
  };

  // contentPrior: optional { lang, confident } derived from surrounding
  // conversation text — see CONTENT_PRIOR_WEIGHT.
  Predictor.prototype.decide = function (keys, contentPrior) {
    var key = this._resolve(keys);
    if (!key) return { tier: 'silent', lang: null, bound: 0, key: null };

    var rec = this.records[key] || emptyRecord();

    // Blend the content prior in as pseudo-observations.
    var counts = {};
    for (var k in rec.counts) counts[k] = rec.counts[k];
    if (contentPrior && contentPrior.lang && contentPrior.confident) {
      counts[contentPrior.lang] = (counts[contentPrior.lang] || 0) + CONTENT_PRIOR_WEIGHT;
    }

    var total = totalOf(counts);
    var lang = dominantOf(counts);
    if (!lang || total === 0) return { tier: 'silent', lang: null, bound: 0, key: key };

    var bound = wilsonLowerBound(counts[lang], total);

    var result = { tier: 'silent', lang: lang, bound: bound, key: key };
    if (bound >= INDICATE_BOUND) result.tier = 'indicate';

    // Promotion to auto needs three things at once: a high bound, enough real
    // observations, and a context that has actually been predicting well.
    var accurate = rec.predTotal < ACCURACY_MIN_OBS ||
                   (rec.predCorrect / rec.predTotal) >= AUTO_MIN_ACCURACY;
    var observed = totalOf(rec.counts);   // pseudo-counts don't count toward this

    if (bound >= AUTO_BOUND && observed >= AUTO_MIN_OBS && accurate &&
        !this.suppressed[key] && !this.shadowMode) {
      result.tier = 'auto';
    }
    // What we *would* have done, for shadow-mode reporting.
    result.wouldAuto = bound >= AUTO_BOUND && observed >= AUTO_MIN_OBS && accurate;
    return result;
  };

  // Close the loop: was the prediction for this context right? Called with the
  // language the user actually typed. Drives the per-context accuracy that gates
  // (and un-gates) auto-switching.
  Predictor.prototype.scorePrediction = function (key, predictedLang, actualLang) {
    if (!key || !predictedLang) return;
    var rec = this._record(key);
    rec.predTotal++;
    if (predictedLang === actualLang) rec.predCorrect++;
  };

  // The user switched layout by hand right after we switched it for them. That is
  // the strongest negative signal available: count it against the context and
  // stop acting there for the rest of this focus session.
  Predictor.prototype.contradicted = function (key, correctLang) {
    if (!key) return;
    var rec = this._record(key);
    rec.predTotal++;
    this.suppressed[key] = true;
    if (correctLang) rec.counts[correctLang] = (rec.counts[correctLang] || 0) + 1;
  };

  // Call when focus moves to a new field: suppression is per focus session, so a
  // contradiction silences us for that field, not forever.
  Predictor.prototype.endFocusSession = function () {
    this.suppressed = {};
  };

  Predictor.prototype.accuracyFor = function (key) {
    var rec = this.records[key];
    if (!rec || rec.predTotal === 0) return null;
    return rec.predCorrect / rec.predTotal;
  };

  Predictor.prototype.serialize = function () {
    return JSON.stringify({ records: this.records, shadowMode: this.shadowMode });
  };

  Predictor.load = function (json) {
    var p = new Predictor();
    try {
      var data = JSON.parse(json);
      p.records = data.records || {};
      p.shadowMode = data.shadowMode !== false;
    } catch (e) { /* corrupt store: start clean rather than fail */ }
    return p;
  };

  var api = {
    Predictor: Predictor,
    wilsonLowerBound: wilsonLowerBound,
    thresholds: {
      AUTO_BOUND: AUTO_BOUND,
      INDICATE_BOUND: INDICATE_BOUND,
      AUTO_MIN_OBS: AUTO_MIN_OBS,
      AUTO_MIN_ACCURACY: AUTO_MIN_ACCURACY,
      CONTENT_PRIOR_WEIGHT: CONTENT_PRIOR_WEIGHT,
      SPECIFIC_MIN_OBS: SPECIFIC_MIN_OBS,
    },
  };

  root.__langFixerPredictor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
