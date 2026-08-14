// Run with: node test/predictor.test.js
//
// These tests exist to pin down *when the predictor stays quiet*. Acting wrongly
// is far more costly than not acting, so most of what follows asserts silence.
const path = require('path');

global.window = global;
const P = require(path.join(__dirname, '..', 'predictor.js'));
const { Predictor, wilsonLowerBound } = P;

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(detail ? `${name}\n      ${detail}` : name);
}

function near(a, b, tol) {
  return Math.abs(a - b) <= (tol === undefined ? 0.005 : tol);
}

// ── 1. Wilson bound behaves as documented ────────────────────────────────────
{
  // Same 90% observed rate, wildly different evidence.
  check('wilson 9/10 -> 0.60', near(wilsonLowerBound(9, 10), 0.596),
    `got ${wilsonLowerBound(9, 10).toFixed(4)}`);
  check('wilson 90/100 -> 0.83', near(wilsonLowerBound(90, 100), 0.826),
    `got ${wilsonLowerBound(90, 100).toFixed(4)}`);
  check('wilson 900/1000 -> 0.88', near(wilsonLowerBound(900, 1000), 0.880),
    `got ${wilsonLowerBound(900, 1000).toFixed(4)}`);
  check('wilson is monotonic in evidence',
    wilsonLowerBound(9, 10) < wilsonLowerBound(90, 100) &&
    wilsonLowerBound(90, 100) < wilsonLowerBound(900, 1000));
  check('wilson of no data is zero', wilsonLowerBound(0, 0) === 0);
}

// ── 2. Cold start is silent ──────────────────────────────────────────────────
{
  const p = new Predictor({ shadowMode: false });
  const d = p.decide(['app:whatsapp|chat:Dad|field:composer', 'app:whatsapp']);
  check('unseen context is silent', d.tier === 'silent', `got ${d.tier}`);
}

// ── 3. A little consistent evidence indicates but never switches ─────────────
{
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:whatsapp|chat:Dad', 'app:whatsapp'];
  for (let i = 0; i < 10; i++) p.observe(keys, 'he');
  const d = p.decide(keys);
  check('10 consistent observations -> indicate', d.tier === 'indicate',
    `got ${d.tier} at bound ${d.bound.toFixed(3)}`);
  check('10 consistent observations do NOT auto-switch', d.tier !== 'auto',
    'this is the property that stops it feeling erratic');
}

// ── 4. Sustained evidence eventually earns auto-switch ───────────────────────
{
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:terminal'];
  for (let i = 0; i < 130; i++) p.observe(keys, 'en');
  const d = p.decide(keys);
  check('130 consistent observations -> auto', d.tier === 'auto',
    `got ${d.tier} at bound ${d.bound.toFixed(3)}`);
  check('auto picks the right language', d.lang === 'en');
}

// ── 5. Shadow mode never acts, but does report what it would have done ───────
{
  const p = new Predictor({ shadowMode: true });
  const keys = ['app:terminal'];
  for (let i = 0; i < 130; i++) p.observe(keys, 'en');
  const d = p.decide(keys);
  check('shadow mode never returns auto', d.tier !== 'auto', `got ${d.tier}`);
  check('shadow mode still reports wouldAuto', d.wouldAuto === true);
}

// ── 6. Genuinely mixed contexts stay quiet forever ───────────────────────────
{
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:whatsapp|chat:BilingualFriend'];
  for (let i = 0; i < 120; i++) p.observe(keys, 'he');
  for (let i = 0; i < 80; i++) p.observe(keys, 'en');
  const d = p.decide(keys);
  check('60/40 context never auto-switches', d.tier !== 'auto',
    `got ${d.tier} at bound ${d.bound.toFixed(3)} after 200 observations`);
}

// ── 7. Conversation content makes a brand-new thread predictable ─────────────
{
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:claude|chat:NewThread', 'app:claude'];
  const cold = p.decide(keys);
  check('new thread with no prior is silent', cold.tier === 'silent');

  const warm = p.decide(keys, { lang: 'he', confident: true });
  check('new thread + Hebrew content prior -> indicate', warm.tier === 'indicate',
    `got ${warm.tier} at bound ${warm.bound.toFixed(3)}`);
  check('content prior picks the content language', warm.lang === 'he');
  // The prior informs; it must not be able to trigger a layout change by itself.
  check('content prior alone cannot auto-switch', warm.tier !== 'auto',
    'pseudo-counts are excluded from the observation requirement');
}

// ── 8. A context that predicts badly loses auto-switch ───────────────────────
{
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:notes'];
  for (let i = 0; i < 130; i++) p.observe(keys, 'he');
  check('qualifies for auto before scoring', p.decide(keys).tier === 'auto');

  // Realized accuracy collapses: predicted Hebrew, user kept typing English.
  for (let i = 0; i < 12; i++) p.scorePrediction('app:notes', 'he', 'en');
  const after = p.decide(keys);
  check('poor realized accuracy demotes out of auto', after.tier !== 'auto',
    `got ${after.tier}, accuracy ${p.accuracyFor('app:notes')}`);
}

// ── 9. Contradiction silences the context for that focus session ─────────────
{
  // Deep history, so the suppression mechanism is isolated from the (separate)
  // confidence hit that a contradiction also causes.
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:slack'];
  for (let i = 0; i < 400; i++) p.observe(keys, 'he');
  check('auto before contradiction', p.decide(keys).tier === 'auto');

  p.contradicted('app:slack', 'en');
  check('silenced after the user overrides us', p.decide(keys).tier !== 'auto',
    `got ${p.decide(keys).tier}`);

  p.endFocusSession();
  check('suppression is per focus session, not permanent',
    p.decide(keys).tier === 'auto', `got ${p.decide(keys).tier}`);
}

// ── 9b. A contradiction also costs confidence, on its own merits ─────────────
{
  // On a context that only just cleared the bar, being overridden once should
  // drop it back to indicate until the evidence is rebuilt.
  const p = new Predictor({ shadowMode: false });
  const keys = ['app:mail'];
  for (let i = 0; i < 130; i++) p.observe(keys, 'he');
  check('marginal context qualifies for auto', p.decide(keys).tier === 'auto');

  p.contradicted('app:mail', 'en');
  p.endFocusSession();
  const d = p.decide(keys);
  check('one override demotes a marginal context even after the session ends',
    d.tier === 'indicate', `got ${d.tier} at bound ${d.bound.toFixed(3)}`);
}

// ── 10. Key resolution prefers specific, falls back to coarse ────────────────
{
  const p = new Predictor({ shadowMode: false });
  const specific = 'app:whatsapp|chat:Mum';
  const coarse = 'app:whatsapp';
  // Plenty of app-level history, almost none for this particular chat.
  for (let i = 0; i < 50; i++) p.observe([coarse], 'he');
  p.observe([specific, coarse], 'en');

  const d = p.decide([specific, coarse]);
  check('thin specific key falls back to coarse', d.key === coarse,
    `resolved to ${d.key}`);

  for (let i = 0; i < 6; i++) p.observe([specific, coarse], 'en');
  const d2 = p.decide([specific, coarse]);
  check('specific key wins once it has evidence', d2.key === specific,
    `resolved to ${d2.key}`);
  check('specific key can disagree with the app default', d2.lang === 'en',
    `got ${d2.lang}`);
}

// ── 11. Persistence round-trips ──────────────────────────────────────────────
{
  const p = new Predictor({ shadowMode: false });
  for (let i = 0; i < 130; i++) p.observe(['app:terminal'], 'en');
  const restored = Predictor.load(p.serialize());
  restored.shadowMode = false;
  check('restored predictor keeps its evidence',
    restored.decide(['app:terminal']).tier === 'auto');
  check('corrupt store degrades to empty rather than throwing',
    Predictor.load('{{not json').decide(['app:x']).tier === 'silent');
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}

// Surface the practical cost of the chosen bar: with perfect consistency the
// Wilson bound is n/(n+z^2), so the auto threshold implies a minimum sample size.
const need = (bound) => Math.ceil(3.8416 * bound / (1 - bound));
console.log('');
console.log('Observations needed to auto-switch, at perfect consistency:');
for (const b of [0.90, 0.95, 0.97, 0.98]) {
  console.log(`  bound >= ${b.toFixed(2)}  ->  ${need(b)} observations`);
}
