# Market research: wrong-keyboard-layout tools

Researched August 2026. Captured here because it was expensive to gather and
would be annoying to redo.

**Read the verification column before trusting a row.** Several products in this
space have polished marketing sites and no shipping product, and at least one
"comparison" page turned out to be a vendor's own SEO site promoting its
unreleased app.

## The space splits into three capabilities

Treating this as one market is the main analytical mistake. It is three:

| Capability | State |
|---|---|
| **Reactive fixing** — convert text after you typed it in the wrong layout | Crowded, mostly free. Hebrew included. |
| **Rule-based pre-switching** — set the layout per app or per website from config | Solved, free, popular. No learning, no detection. |
| **Learned predictive pre-switching** — infer the language before typing, from behaviour, below app level | **Essentially unoccupied on desktop.** |

## Competitors

| Product | Platform | Languages | Price | Verified how |
|---|---|---|---|---|
| [RuSwitcher](https://github.com/rashn/RuSwitcher) | macOS | Any installed layout pair; **Hebrew experimental**, no Arabic | Free, OSS | Fetched repo: 159 stars, real releases, Homebrew cask |
| [Input Source Pro](https://github.com/runjuu/InputSourcePro) | macOS | n/a (switches, doesn't detect) | Free, OSS | Fetched repo: 3.4k stars, per-app + per-website rules, **no learning, no content detection** |
| [Keyswitcher](https://github.com/graninilya/keyswitcher) | macOS | Russian/Latin only | Free, OSS | Fetched repo: 9 stars, real `.dmg`, switches input source, learns word exceptions after 3 reverts |
| [KeyboardSwitcher](https://github.com/kertser/KeyboardSwitcher) | **Windows only** | En/He/Ru | Free, OSS | Fetched repo: 4 stars, LSTM detection, per-window layout memory, adaptive confidence |
| [TypeFix](https://typefix.app/) | macOS (Windows in dev) | 29 languages, 92 layouts | **$14.99 one-time**, 7-day trial | Search snippets only — site blocked by proxy |
| [Rekey](https://trishchuk.com/rekey/alternatives/punto-switcher/) | macOS | Claims 34 languages | Unknown | **Pre-launch waitlist.** Claims are marketing copy for an unreleased product |
| [Keyboard Language Fixer](https://apps.apple.com/us/app/keyboard-language-fixer/id6760297342) | macOS | En/De/El/He/Ko/Ru/Uk | Unknown | App Store listing, blocked by proxy |
| [kAIboard](https://kaiboard.eu/) | **Mobile** | Multi | Unknown | Search snippets. Learns per contact via phone prefix — closest to our idea, wrong platform |
| Punto Switcher (Yandex) | Windows | Russian | Free | Well established; no maintained macOS build |
| [KEset](https://chromewebstore.google.com/detail/keset-fix-gibberish-from/dagpfdeohfadedgdedeclamngoodefio), TypeFlip, Hebrew Keyboard Fix, Keyboard Language Corrector | Chrome | Hebrew, English, Russian, Greek, Arabic | Free | Search snippets; Chrome Web Store blocked by proxy |

## The differentiator

> Every tool that exists is either **reactive** (fixes what you already typed
> wrong) or **rule-based** (you configure which language goes with which app).
> Nothing is **predictive and learned** at a granularity finer than the app.

The gap persists for a structural reason, which is what makes it defensible:
hand-configured rules don't scale below the app level. Nobody writes a rule for
each of 200 WhatsApp contacts. That is exactly the regime where learning is the
only workable mechanism — **the thing that can't be configured by hand is the
thing worth learning.**

Note what "learning" means in existing tools, because it is not this:
- RuSwitcher, Keyswitcher, KeyboardSwitcher: per-app or per-window layout
  **memory** — restore the last layout used here. That is not prediction.
- Keyswitcher, KeyboardSwitcher: word-level **exception lists** — "I reverted this
  three times, stop correcting it."
- Input Source Pro: **manual rules**, no learning at all, despite 3.4k stars.

## Secondary openings

- **Arabic is absent from every desktop tool verified.** Same cross-script
  structure as Hebrew, ~400M speakers. Currently deferred, not abandoned.
- **Hebrew is barely served natively.** RuSwitcher labels it experimental. The
  reason is almost certainly RTL, which is difficulty rather than neglect — and
  difficulty is a better moat than an unnoticed gap.

## Demand: two separate questions

**Demand for the problem: well validated.** A dozen-plus tools exist, Punto has
run 20+ years, Input Source Pro has 3.4k stars purely for automatic switching, and
new free ones are still being posted to Hacker News. Nobody builds a dozen tools
for a problem nobody has.

**Demand for a *paid* product: one data point.** TypeFix at $14.99 one-time is the
only confirmed paid competitor. Everything else verified is free.

Crowded *and* mostly free is the hardest combination to monetize: the problem is
real **and** the price is anchored at zero. Concretely, a $10/yr subscription costs
more than TypeFix from month 19 while offering fewer languages — so a subscription
has to be carried by prediction, not by fixing.

## Risks this research surfaced

1. **The differentiator is a feature Input Source Pro could ship.** It is open
   source with 3.4k stars and already owns the per-app/per-website switching
   surface. Arabic and RTL quality are more defensible than prediction alone.
2. **Rekey is running our validation experiment right now.** A waitlist page for
   this exact category. Watching whether it launches, at what price, and whether
   anyone pays costs nothing and is informative.
3. **Paid demand is unproven.** Worth a landing page testing willingness to pay
   for prediction before committing to the full native build.

## Not verified — worth checking on a real machine

- TypeFix and TypeSwitcher: are they shipping products? What do they actually do?
- Chrome Web Store install counts for the Hebrew extensions (demand signal)
- Whether RuSwitcher's experimental Hebrew is actually usable — this is the single
  most decision-relevant unknown, and an hour of your own typing answers it
- Rekey's eventual launch and price
