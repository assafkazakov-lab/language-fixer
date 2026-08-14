# Language Fixer — project handoff

Self-contained summary of the product, the research behind it, and the plan.
Written to be pasted into a fresh session with no prior context.

## What it is

A tool that fixes text typed with the wrong keyboard layout (Hebrew ↔ English),
and — the differentiating part — **learns to set the right layout before you
type**, per conversation rather than per app.

Currently a working Chrome extension. A native macOS app is planned but unstarted.

## Where the code stands

Repo `kazakov100/language-fixer`, branch
`claude/multilingual-keyboard-switching-gcmdp1`.

| File | What it is |
|---|---|
| `detect.js` | Layout map, conversion, wrong-layout detection. Scores text as-typed against how it would read on the other layout, under a character-trigram model. |
| `predictor.js` | Context → language prediction with tiered confidence. Wilson bounds, shadow mode. Tested logic, **not yet wired to any UI**. |
| `ngrams.js` | Generated trigram models + 8k word lists (Hebrew, English). |
| `content.js`, `background.js`, `popup.*` | Extension UI, hotkey relay, per-site toggle. |
| `tools/build_model.js` | Regenerates the model reproducibly from public corpora. |

`npm test` → 94 + 29 assertions, all green.

**Detection accuracy** — measured via `tools/eval_model.js` (new: this didn't
exist before, the earlier number wasn't reproducible from anything in the repo),
on 3,000 held-out words per language, scored in isolation: Hebrew 0.67% false
positives / 88.8% recall (92.9% for words ≥4 chars); English 0.33% / 91.0%
(95.3% for words ≥4 chars). Lower than the number originally quoted here, most
of the gap explained by `detectConversion`'s 4-character evidence floor
excluding short words by design — real messages are multi-word, so this eval
is intentionally the harder isolated-word case. Residual failures are true
ambiguities — `נשמע` genuinely reads as "bang", `baht` as `נשיא` — plus some
corpus noise.

An earlier heuristic fired on *correctly typed* text in both languages (`github`,
`docker compose up`, `מה שלומך` all triggered it). That was replaced, along with
seven interaction bugs — including a hotkey that never worked on macOS because it
tested `e.key === 'F'` while Option rewrites the character.

## The differentiator

> Every existing tool is either **reactive** (fixes what you already typed wrong)
> or **rule-based** (you configure which language goes with which app). Nothing is
> **predictive and learned** below app level.

The gap persists structurally: hand-configured rules don't scale below the app,
because nobody writes a rule per WhatsApp contact. The thing that can't be
configured by hand is the thing worth learning.

## Market findings (verified August 2026)

Full detail, with a column recording how each claim was verified, in
[MARKET.md](MARKET.md).

- **Reactive fixing is a commodity** — RuSwitcher (159★, Hebrew *experimental*),
  K-Switch, Punto, several Hebrew Chrome extensions. Mostly free.
- **Rule-based pre-switching is solved** — Input Source Pro, 3.4k★, per-app *and*
  per-website. **No learning, no language detection.**
- **Learned prediction is essentially unoccupied on desktop.** Closest: kAIboard
  (per-contact learning, but *mobile*); kertser/KeyboardSwitcher (adaptive, but
  *Windows-only, 4★*).
- **Pricing:** TypeFix at **$14.99 one-time, 29 languages** is the only confirmed
  paid competitor. Everything else free. A $10/yr subscription costs more than
  TypeFix from month 19 with fewer languages — so prediction must carry the price,
  not fixing.
- **Rekey is a pre-launch waitlist**, not a shipping product. Its "34 languages"
  is marketing copy.
- **Arabic is absent from every desktop tool verified.** Deferred, not abandoned.

## Decisions made

- **Passwords: out of scope.** This removed the main objection to going native —
  macOS secure input mode blinds keystroke capture in password fields.
- **Hebrew ↔ English only** for v1. Arabic deferred. **Spanish and German
  dropped**: same-script Latin layouts, where a mismatch swaps a few characters
  rather than producing gibberish, so "flip the string" is the wrong fix and the
  pain is too mild to pay for.
- **macOS first.**
- **The Chrome extension stays.** It is the right surface for browser tabs, where
  the DOM gives reliable per-conversation identity — better than AX traversal.
  Extension owns browsers, native app owns native and Electron windows.

## Architecture: one loop, not two features

```
predict layout on focus -> user types -> observe actual language
       ^                                        |
       |                                        v
  update context stats  <-  fix + switch layout (reactive)
```

Prediction cuts errors; the reactive fixer catches the residual. Because a wrong
prediction self-heals in one keystroke, the cost of a false positive drops enough
to justify acting on prediction at all. Every fix is a labelled example. **The
commodity layer is the safety net that makes the differentiator shippable.**

## Confidence policy

Threshold the **Wilson 95% lower bound**, never the raw ratio — 9/10 reads as
"90%" but is almost no evidence:

| observations at 90% observed | raw | Wilson lower bound |
|---|---|---|
| 9/10 | 90% | 60% |
| 90/100 | 90% | 83% |
| 900/1000 | 90% | 88% |

- **Auto-switch** at bound ≥ 0.97, n ≥ 30, realized accuracy ≥ 0.95, field empty
- **Passive indicator** at 0.70–0.97 — shows which layout is active, and
  deliberately **does not prompt**: before typing, the alternative is pressing the
  key you would press anyway, so a question costs more attention than it saves
- **Silent** below 0.70

Errors are asymmetric. Failing to switch costs nothing — the user presses the
layout key, as today. Switching wrongly costs a garbled sentence *plus* a keyboard
that changed unasked. At 90% accuracy over ~20 context entries a day that is two
incidents daily, which is an uninstall.

**Ships in shadow mode**: observes and scores itself without acting, so accuracy
is proven against real typing before the app is trusted to change anything.

**Conversation content as a prior** — in a chat or LLM app, score the visible
messages and fold them in as pseudo-observations. This makes a brand-new thread
predictable with no learning period, which matters most for Claude and ChatGPT
where there are many threads in different languages.

## Milestones

Full detail in [PLAN.md](PLAN.md).

**Milestone 0 — RTL rewrite spike. THE GATE. Needs a Mac; not done.** Budget
closer to a week than a couple of days — see exit criteria below — and it
decides viability. RuSwitcher labels its Hebrew experimental for this reason.

Detection and conversion are unaffected by RTL — Unicode is stored in logical
order. The problem is confined to writing text back, and three rules solve it:

1. **Never use arrow keys** — caret movement in bidi text is app-dependent. Only
   backspace from the caret, which is unambiguous everywhere.
2. **Inject Unicode via `CGEventKeyboardSetUnicodeString`**, not key codes —
   otherwise you race your own layout change.
3. **Operate on logical AX ranges**, never visual selections.

Plus **probe and remember per app**: after a rewrite, read the field back via AX
and diff against what was expected. Match means that strategy works here — record
it. The app builds its own compatibility table instead of shipping a hardcoded list.

Exit criteria: mixed Hebrew/English fixtures rewritten correctly, with correct
caret position, in Notes, Chrome, Terminal, VS Code, Slack, WhatsApp Desktop,
Claude desktop and ChatGPT desktop. The last four are Electron/Chromium apps and
**simultaneously highest-value and least certain** — they belong in the gate
itself, sized into the estimate above, not a follow-up check after the gate
already passed on the easier apps. (Discord dropped from this list: it doesn't
recur as a target anywhere else in this doc or in PLAN.md.)

While these apps are open under AX inspection for the rewrite test, also check
`kAXTitleAttribute` and focused-element ancestry for conversation identity —
this is the cheapest point to answer open question 2 below, and there's no
reason to defer it to Milestone 2 and re-discover the same answer later.

**Milestone 1** — Port the `detect.js` scoring core to Swift (~150 lines; ports
as-is now that scope is Hebrew-only). Menu-bar app with `CGEventTap`,
`TISSelectInputSource`, `RegisterEventHotKey`.

**Milestone 2** — Context identity via bundle ID + `kAXTitleAttribute` + AX field
role, keyed `(app, conversation, field)` with fallback to coarser keys. Then the
predictor.

## Open questions

1. **The 0.97 bar needs ~125 consistent observations** before a context earns
   auto-switching, against ~35 at 0.90. Possibly too slow — worth revisiting.
   `test/predictor.test.js` prints this table.
2. **Does conversation-level context actually exist** in the Electron apps? The
   headline feature depends on it. Untested.
3. **Paid demand is unvalidated** — one data point. Crowded *and* mostly free is
   the hardest combination: the problem is real and the price is anchored at zero.
4. **The differentiator is a feature Input Source Pro could ship** — open source,
   3.4k★, already owns the switching surface. Arabic and RTL quality are more
   defensible than prediction alone.

## Recommended next step

**Go straight at Milestone 0 — the RTL rewrite spike.** An earlier version of
this recommendation said to ship prediction in the Chrome extension first,
reasoning that it validates the differentiator cheaply, with no Mac or
Accessibility prompt needed. That doesn't hold up: the extension only reaches
Chrome tabs, not Slack, Notes, Terminal, VS Code, or WhatsApp Desktop — the
places the actual papercut lives — so it would validate a different, easier
problem, not the native app. It also tests neither of the two things that
could actually kill this project (RTL rewrite reliability, Electron AX
access), which this document itself calls the make-or-break gate. Running the
extension experiment first would spend time without touching either real
risk.

Milestone 0, re-scoped to include the Electron apps (see exit criteria above),
answers both open questions in one pass — RTL viability and whether Electron
apps expose usable conversation context — since the apps are instrumented for
the rewrite test anyway.

Also worth an hour, in parallel: install RuSwitcher and judge whether its
experimental Hebrew is actually usable. That is the single most
decision-relevant unknown answerable without building anything, and only
first-hand use answers it.
