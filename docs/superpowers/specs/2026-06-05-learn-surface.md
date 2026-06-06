# Learn (Library + Guide Autopsy) — Instrument reskin spec (third live surface)

*2026-06-05, Cowork. RESKIN ONLY: the knowledge layer (Library/TweakEncyclopedia + Guide Autopsy)
is already built, tested, and owner-approved functionally. This pass re-dresses it in the
Instrument language. ZERO dataset, matcher, counting, or behavior changes — if a knowledge-layer
test needs modifying beyond styling/selectors, stop and flag it.*

---

## 0. Scope guard

- Datasets (tweaks/terms/tricks/guides), the search matcher, the autopsy counting rules
  (verdict-wins + "safe how-to available" chips + the unmatched-honesty line), `<Term>` tooltips,
  and the dataset lint are all LOCKED as shipped. Visual layer only.
- Same discipline as CommandCenter/Fix: additive behind `compy_learn_v2` (default ON in dev),
  classic Library reachable by toggle, tokens-only, small revertable commits, no new
  capabilities/network, CSP/Rust untouched (this pass is pure frontend).

## 1. Ambiance (the calm surface)

Learn is dense reading → **static dot-grid** backing (CSS radial-gradient dots, ~24px pitch, very
low alpha), NO hyperspeed, NO canvas animation. This is the kernel's "calm surface" archetype —
the one place Instrument goes quiet on purpose.

## 2. Layout (per the approved Library mock)

- **Header:** "Learn" + one honest line: "Look up any tweak, term, or scam you heard online — we
  only answer what we've verified."
- **Search bar:** prominent glass input, placeholder cycling examples ("try \"xmp\", \"frame gen\",
  \"tiny11\"…"). Existing matcher behavior unchanged (debounce, aliases, diacritic-safe).
- **Type filter chips:** All / Tweaks / Terms / Tricks / Guides — accent-active pill style.
- **Result cards (per-type styling, glass):**
  - *Tweak:* verdict pill — real (accent tint) / placebo (neutral) / risky (danger tint).
  - *Term:* quiet "TERM" pill, definition-first.
  - *Trick:* danger-tinted border + "TRICK" pill — the magician's-secrets read.
  - *Guide:* accent-tinted border + "GUIDE · safe" pill.
  - Related chips navigate as today; honest empty state keeps its shipped copy.
- **Guide Autopsy panel:** glass card with the paste box + "Grade" affordance; the grade line and
  per-hit rows restyled (verdict colors per above; "safe how-to available" chips in accent;
  unmatched items neutral). Counting/copy logic byte-identical to shipped behavior.

## 3. Type + tokens

Tokens only (no hex). Mono for counts/grades. Two weights. Evidence/verdict colors map to the
kernel semantics: accent = real/safe, neutral = placebo/term, danger = risky/trick. Reduced-motion:
no entrance animations beyond opacity.

## 4. Acceptance

- [ ] Learn renders behind `compy_learn_v2`; classic Library reachable by toggle.
- [ ] All knowledge-layer tests pass UNCHANGED (or styling-only selector updates, flagged in the
      report if any).
- [ ] Search, chips, related-nav, tooltips, autopsy grade — behavior identical to shipped.
- [ ] Static dot-grid only; no canvas/animation on this surface; tokens-only verified.
- [ ] `npm run tauri dev` shows it live for owner sign-off.
