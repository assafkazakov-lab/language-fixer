# Language Fixer

Fixes text typed with the wrong keyboard layout (Hebrew ↔ English), and — the part
nothing else on the market does — learns to set the right layout *before* you type,
per conversation rather than per app.

Currently a shipped Chrome extension. A native macOS app is planned; see
[docs/PLAN.md](docs/PLAN.md).

## Layout

| File | Purpose |
|---|---|
| `detect.js` | Layout map, conversion, and wrong-layout detection. Scores the text as typed against how it would read on the other layout, under a character-trigram language model. |
| `predictor.js` | Predicts the language for a context and decides how confidently to act. Wilson lower bounds, tiered response, shadow mode. |
| `ngrams.js` | **Generated.** Trigram models and 8k-word frequency lists for Hebrew and English. Rebuild with `tools/build_model.js`. |
| `content.js` | Extension UI: the suggestion chip, field tracking, writing text back. |
| `background.js` | Relays the `chrome.commands` hotkey to the content script. |
| `popup.html` / `popup.js` | Per-site on/off switch and shortcut settings. |
| `tools/build_model.js` | Regenerates `ngrams.js` from public frequency corpora. |
| `docs/PLAN.md` | Approved plan for the native app and prediction. |
| `docs/MARKET.md` | Competitive research, with what was verified and how. |

## Tests

```sh
npm test
```

`test/detect.test.js` (92 assertions) exists to enforce one property: **correctly
typed text must never be offered for conversion.** An earlier heuristic failed
that on ordinary Hebrew prose and on most lowercase English, which is what made
the extension feel noisy.

`test/predictor.test.js` (29 assertions) mostly asserts *silence* — acting wrongly
costs the user far more than not acting, so the tests pin down when the predictor
must keep quiet.

## Detection accuracy

Measured with `node tools/eval_model.js`, on 3,000 words per language held out
from the shipped dictionary (i.e. outside the top 8,000 by frequency), each
scored in isolation with no sentence context:

| | false positives | recall | recall (words ≥4 chars) |
|---|---|---|---|
| Hebrew | 0.67% | 88.8% | 92.9% |
| English | 0.33% | 91.0% | 95.3% |

Recall on short words is structurally lower by design: `detectConversion`
requires at least 4 mapped characters of evidence before it acts at all, to
keep short tokens from false-positiving. Real messages are mostly multi-word,
so evidence usually aggregates well past that floor — this eval intentionally
tests the harder, single-isolated-word case, which is worse than typical
in-the-field accuracy.

Residual false positives are true ambiguities where both readings are real
words — `נשמע` genuinely reads as "bang", `baht` genuinely reads as `נשיא` —
plus some corpus noise (rare proper nouns, foreign loanwords, transcription
errors in the frequency list).

## Rebuilding the model

The corpora are not checked in; only the derived statistics ship.

```sh
cd tools
BASE=https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018
curl -O $BASE/he/he_50k.txt -O $BASE/en/en_50k.txt
node build_model.js
```

Output is reproducible — the same corpora produce a byte-identical `ngrams.js`.

Model data derives from OpenSubtitles word-frequency statistics
([hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords),
CC BY-SA 4.0), attributed in the generated file.

## Known limitations

- **Case is lost when flipping.** A Hebrew layout produces the same letter with or
  without Shift, so a mistyped capital was never recorded. Latin → Hebrew → Latin
  returns lowercase. Inherent, not a shortcut.
- **Prediction is unimplemented in the extension UI.** `predictor.js` is tested
  logic, not yet wired to the chip or to layout switching.
- **The native app is unstarted.** Its gating risk is the RTL rewrite path; see
  Milestone 0 in the plan.
