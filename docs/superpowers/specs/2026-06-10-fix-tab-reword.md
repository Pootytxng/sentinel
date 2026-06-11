# Spec — Fix-tab reword (honest-but-inviting, no gains promise)

**Date:** 2026-06-10 · **Lane:** Cowork-specced → CC builds · **Class:** frontend copy-only, reversible

## Why

Fix-tab copy is *honest* but reads defensive/clinical — "Worth fixing", "convenience, not
a boost", "Nothing worth fixing right now". It under-sells the actual promise: **per-rig,
tailored, earned, reversible changes** — the differentiator. Reframe toward outcome
("the changes worth making for *your* rig") while keeping the no-snake-oil law we just
enforced on the site: **never imply an FPS/performance gain.** Confidence and tailoring are
the payoff, not numbers.

## Hard lines (do not cross)

- **No gains language.** No "faster", "boost", "FPS", "smoother", "performance" as a promise.
  "convenience, not a boost" stays in spirit — keep an explicit no-boost disclaimer.
- **Frontend copy-only.** `Fix.tsx` strings + `Fix.test.tsx` assertions. ZERO logic, IPC,
  actions.rs, rollback, or bucket-filtering changes. Reversibility framing ("one click to
  undo", snapshot/undo) stays verbatim in meaning.
- **Honest-measurement + doorknob laws intact.** Every switch still shows it's reversible.

## Exact swaps (current → proposed)

| Loc | Current | Proposed |
|---|---|---|
| `fix-section-label` (L460) | `Worth fixing` | `Worth making for your rig` |
| `fix-subtitle` (L446-448) | `{n} worth your attention · …` | `{n} worth a look · {active} active · {dismissed} dismissed · {n} not for this rig. Tailored to your hardware — every change is one click to undo.` |
| `fix-applyall-hint` (L466) | `reversible · one undo each · convenience, not a boost` | `reversible · one undo each · cleaner setup, not a magic boost` |
| `fix-empty` (L480) | `Nothing worth fixing right now — your appliable settings are all set.` | `Your rig's already dialed in — nothing here needs a change right now.` |
| `fix-applyall-note` (L510-513) | `…This is convenience, not a performance boost.` | `…These tidy up how your rig is set up for you — not a performance boost, and every one is reversible.` |
| `fix-applyall-h` (L509) | `Apply these {n} safe fixes?` | `Apply these {n} changes to your rig?` |

Buckets below the fold ("Not worth touching", "Compy points the way", "Startup apps",
"Dismissed") already read well — **leave them.** Scope is the top of Fix only.

## Test deltas (`Fix.test.tsx`)

Assertions on L45/58/62 match `worth your attention` → update to `worth a look`.
L93 `Nothing worth fixing right now` → `Your rig's already dialed in`.

## Verification

`npm test` green (Fix.test.tsx updated) · `tsc` + `vite build` clean · grep `src/` for
`boost|faster|FPS` in Fix.tsx confirms the only "boost" left is negated. Frontend-only —
cargo untouched. /check.
