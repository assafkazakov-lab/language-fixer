# Language Fixer: predictive Hebrew↔English layout switching for macOS

## Context

The shipped Chrome extension fixes wrong-layout typing (Hebrew↔English) inside
Chrome. The goal now is system-wide coverage plus the feature nothing on the
market has: **predicting which language you'll type before you type it**, learned
from behaviour, at a granularity finer than the app (per conversation, per field).

Passwords are out of scope. That removes the main technical objection to going
native — macOS secure input mode blinds keystroke capture in password fields, and
nothing else here touches them.

**Hebrew↔English only.** Arabic is deferred. This is a deliberate simplification
and it removes real work: `detect.js` already implements and tunes exactly this
pair, so the scoring core ports as-is with no N-language argmax generalization, no
Arabic corpus build, and no per-language threshold retuning.

### What the market research established

| Capability | State |
|---|---|
| Reactive fixing (convert after typing wrong) | **Crowded, mostly free.** RuSwitcher, K-Switch, Keyboard Language Fixer, Punto, several Chrome extensions incl. Hebrew |
| Rule-based pre-switching (per app / per site) | **Solved, free, popular.** Input Source Pro: 3.4k stars, no learning, no detection |
| Learned predictive pre-switching | **Essentially unoccupied on desktop** |

Nearest approaches: kAIboard learns per contact but is a **mobile keyboard**;
kertser/KeyboardSwitcher has adaptive confidence but is **Windows-only, 4 stars**;
RuSwitcher and Keyswitcher do per-app layout *memory*. Memory is not prediction —
restoring the last layout used in an app is not inferring the language you want in
*this conversation*.

**The differentiator:** every existing tool is either reactive or rule-based. None
is predictive and learned below app level. The gap persists structurally —
hand-configured rules don't scale below the app, because nobody writes a rule per
WhatsApp contact. The thing that can't be configured by hand is the thing worth
learning.

Going Hebrew-only means leaning harder on prediction as the differentiator, since
Hebrew reactive fixing already exists elsewhere (RuSwitcher calls it experimental;
the browser extensions are adequate). Hebrew RTL *quality* is a secondary edge;
Arabic as an untouched market is deferred, not abandoned.

### Commercial reality to design against

TypeFix ships at **$14.99 one-time, 29 languages, 7-day trial**. Everything else
verified is free. A $10/yr subscription costs more than TypeFix from month 19 with
one language pair — so the subscription must be carried by prediction, not by
fixing. Pricing is the user's call; this plan makes prediction the visible product.

**Paid demand is unvalidated** — one confirmed paid competitor, everything else
free. Worth proving willingness to pay before the full native build.

## Architecture: one loop, not two features

```
predict layout on focus  ->  user types  ->  observe actual language
        ^                                            |
        |                                            v
   update context stats  <-  fix + switch layout (reactive)
```

Prediction cuts the error rate. The fixer catches the residual — and because a
wrong prediction self-heals in one keystroke, the cost of a false positive drops
far enough to justify acting on prediction at all. Every fix is a labelled example
for the context that produced it.

This is why the commodity reactive layer is built first: it is the safety net that
makes the differentiator shippable.

## Milestone 0 — RTL rewrite spike (the gate)

**Do this before anything else.** It is one to two days and it decides whether the
rest is viable. RuSwitcher labels its Hebrew support experimental, and this is why.

What is *not* a problem: Unicode stores text in **logical order** and renders
right-to-left only at display time via the bidi algorithm. Detection and the 1:1
character conversion both operate on the logical string, so neither is affected —
the extension already proves this works.

The problem is confined to **writing text back into a field**. Three hazards, each
with a rule:

1. **Caret navigation is inconsistent in bidi text** — some apps move the caret
   logically on arrow keys, others visually.
   → **Never use arrow keys.** Only backspace from the current caret, which is
   unambiguous everywhere; backspace always deletes the logically-preceding
   character.
2. **Synthetic keystrokes depend on the active layout** — and we are about to
   change the layout, so posting key codes races with ourselves.
   → **Inject Unicode directly** via `CGEventKeyboardSetUnicodeString`. The active
   layout becomes irrelevant.
3. **Selections can be visually discontiguous across a bidi boundary.**
   → Operate on **logical ranges from the Accessibility API**
   (`kAXSelectedTextRange` uses logical character offsets), or on the
   caret-adjacent word only. Never on a visual selection.

With those rules the AX path is effectively bidi-free, and the fallback becomes:
count characters back from the caret, delete that many, inject the corrected
string. Conversion is length-preserving, so the count is always exact.

**Probe and remember per app.** After a rewrite, read the field back via AX and
diff against the expected string. Match means this strategy works for this app —
record it. Mismatch means fall back to the other path and record that. The app
builds its own compatibility table from real use instead of shipping a hardcoded
list.

**Spike exit criteria:** mixed Hebrew/English fixtures rewritten correctly, with
correct final caret position, in Notes, Slack, Chrome, Terminal and VS Code.

## Milestone 1 — Native shell, reactive fixing, layout switching

**Port the detection core to Swift.** `detect.js` measures 0.1–0.3% false
positives at ~97% recall on held-out corpus text. Port `scoreWord`,
`tokenEvidence`, `convertSpan` and `flip` (~150 lines) unchanged in structure —
Hebrew-only means the existing two-way comparison is exactly right.

**`tools/build_model.js` stays the single source of truth.** Extend it to emit a
second output — a compact binary for the Swift app — alongside the existing
`ngrams.js` for the extension. Same trigram tables, same word lists.

**Native mechanics** — menu-bar app (`LSUIElement`), Swift + AppKit:
- `CGEventTap` to buffer keystrokes per focused field (Accessibility permission)
- Score on word boundaries using the ported model
- Rewrite via the strategy chosen in Milestone 0, per-app
- `TISSelectInputSource` to switch input source after converting
- Global hotkey via `RegisterEventHotKey`, rebindable

Known rough edges to handle: **autocomplete interference** (inject the whole
string as one event, not character-by-character, so Slack @-mentions and browser
address bars don't fire completions), and **nikud** (combining marks pass through
the map correctly, but backspace counts must match what the app counts).

## Milestone 2 — Prediction

### Context identity

- App: bundle ID via `NSWorkspace.frontmostApplication`
- Conversation: `kAXTitleAttribute` on the focused window plus focused-element
  ancestry via AX. WhatsApp and Slack expose the conversation name this way — that
  is what gives sub-app granularity.
- Field: AX role/identifier, so a search box and a message composer in one window
  are distinct.

Key on `(bundleID, conversation, fieldRole)`, falling back to
`(bundleID, conversation)` then `(bundleID)` when the specific key is thin. Coarse
keys are also the cold-start answer.

**Verify early which apps expose conversation identity.** The headline feature
depends on it; apps that don't will degrade to per-app prediction.

### Electron and LLM apps (Claude, ChatGPT, Slack, WhatsApp Desktop)

These are Chromium-based, which affects both paths. Chromium implements macOS
accessibility (it must, for VoiceOver) but populates its AX tree lazily and is
less reliable than native AppKit for *writing* text — so Electron apps will
likely land on the Unicode-injection path. The per-app strategy probe resolves
this automatically rather than by hardcoded list.

**Read the conversation content as a prior.** In a chat or LLM app the visible
conversation text is available through the AX tree, and its language is a far
stronger signal than accumulated statistics — it works on the *first* visit to a
thread, with no learning period. Score the visible messages with the model
already built for detection, and combine that prior with the learned per-context
statistics.

This matters most for exactly the LLM case: a new Claude or ChatGPT conversation
has no history under our context key, but if the thread is visibly in Hebrew the
next input almost certainly is too. It generalizes to Slack and WhatsApp Desktop,
where it is arguably better than the window-title approach.

Privacy note: conversation text is more sensitive than a window title. Score it
transiently into a language guess and **never persist it** — only the resulting
counts.

### Surface split: extension for browsers, native for everything else

The Chrome extension is not legacy, it is the right tool for browser contexts.
Inside a page it reads the DOM directly, so conversation identity and thread
language are trivially and reliably available — much better than AX traversal.
Since ChatGPT and Claude are used in browsers as much as in their desktop apps,
the two surfaces are complementary: the extension owns browser tabs, the native
app owns native and Electron windows. Both share the model and, ideally, the
learned statistics store.

### Confidence policy

Threshold on the **Wilson 95% lower bound** of P(dominant language | context),
never the raw ratio. Raw percentages let a new context hit 90% on nine
observations; the bound rises only with evidence, giving correct cold-start
behaviour for free:

| observations at 90% observed | raw | Wilson lower bound |
|---|---|---|
| 9/10 | 90% | 60% |
| 90/100 | 90% | 83% |
| 900/1000 | 90% | 88% |

Tiered response:

- **Auto-switch** when lower bound ≥ 0.97, n ≥ 30, and the context's realized
  prediction accuracy ≥ 0.95. Only when the field is empty.
- **Passive indicator** when 0.70 ≤ bound < 0.97 — a small layout marker near the
  caret. Deliberately *not* a prompt: before typing, the user's alternative is
  pressing the key they'd have pressed anyway, so a question costs more attention
  than it saves. Show state, don't ask.
- **Silent** below 0.70.

The bar is high because the errors are asymmetric. Failing to switch costs nothing
— the user presses the layout key, as today. Switching wrongly costs a garbled
sentence *plus* a keyboard that changed unasked. At 90% accuracy over ~20 context
entries a day that is two incidents a day, which is an uninstall.

Safety rules: demote a context whose realized accuracy drops below 0.95; never
re-switch within a focus session after a manual switch; treat a manual switch
immediately following an auto-switch as a strong negative label.

### Shadow mode first

Ship prediction **observing but not acting**. Log what it would have done and
score it against what the user actually typed. Auto-switch unlocks per context
only once shadow accuracy clears the bar, and the UI can then show a real number —
"this would have been right 98.4% of the time for you over the last two weeks."
Zero risk, self-calibrating, and it converts the trust problem into a disclosure.

### Storage

On-device only, Application Support (SQLite). No network. This is
keystroke-derived data and must never leave the machine — state that plainly in
the UI, because Accessibility permission plus keystroke observation is the
adoption hurdle.

## Files

New Swift target (`macos/`):
- `LayoutModel.swift` — port of the `detect.js` scoring core
- `EventTap.swift` — keystroke buffer, word-boundary detection
- `TextRewriter.swift` — AX and Unicode-injection paths, per-app strategy probe
- `InputSource.swift` — `TISSelectInputSource` wrapper
- `ContextTracker.swift` — bundle ID, window title, focused-element identity
- `Predictor.swift` — per-context stats, Wilson bounds, tiering, shadow mode

Existing, reused:
- `detect.js`, `test/detect.test.js` — the extension's engine, and the reference
  the Swift port is validated against
- `tools/build_model.js` — extend with a second output format
- `ngrams.js` — unchanged (Hebrew/English already)

## Verification

1. **RTL rewrite (Milestone 0 gate).** Mixed Hebrew/English fixtures rewritten in
   Notes, Slack, Chrome, Terminal, VS Code — verify text *and* final caret
   position in each, via AX read-back.
2. **Model parity.** Same fixtures through `detect.js` and the Swift port;
   identical verdicts required. `test/detect.test.js` is the reference.
3. **Layout switching.** `TISSelectInputSource` lands on the right source with
   several installed, including two Hebrew variants.
4. **Context identity.** Log derived keys across three WhatsApp conversations, two
   Slack channels and a browser tab; confirm stability across focus changes and
   distinctness per conversation.
5. **Predictor safety.** Replay synthetic sessions; assert it never auto-switches
   below the bar and always demotes after contradiction. Then run shadow mode on
   real typing and report realized per-context accuracy before enabling anything.

## Risks

- **RTL rewrite** gates everything. Milestone 0 exists to fail fast if it doesn't
  work.
- **Conversation-level context may not be available** in the apps that matter. Test
  before building the predictor on top of it. Electron apps (Claude, ChatGPT,
  Slack, WhatsApp Desktop) are the uncertain case, and they are also the highest
  value — both the rewrite path and the context read depend on Chromium's AX tree
  being usefully populated. Probe these five apps in Milestone 0, not later.
- **The differentiator is a feature Input Source Pro could ship** — open source,
  3.4k stars, already owns per-app/per-website switching. Hebrew RTL quality is
  more defensible than the prediction feature alone.
- **Paid demand unvalidated**, and Hebrew-only narrows the market further. Consider
  a landing page proving willingness to pay for prediction before the full build.
