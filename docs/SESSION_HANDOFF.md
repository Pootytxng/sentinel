# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template below in the same commit.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

Claude Code (Opus 5) · worktree `C:\Users\Kuya\code\sentinel-quietpitwall` · branch
`feat/lab-49-parity-port` · issue [#49](https://github.com/Pootytxng/sentinel/issues/49) ·
PR [#89](https://github.com/Pootytxng/sentinel/pull/89) open, **awaiting the owner's explicit
per-PR merge instruction** (a blanket greenlight does not cover a shared-`main` merge).

## What this lane is doing

Porting #14's REDIRECT list into the live Lab **selectively — behavior and tests, never wholesale**.
Source branch `origin/feat/user-feedback-lab-recovery` is ~140 commits behind and is NOT the base.

## Done so far

- **Task #11 Rig Evidence Map** — committed `50d3a300`, `3dbb7cf1`, `da888447`. Self-review PASSed
  on round 3. Guard: `unreachableDetectedIds` in `src/surfaces/rig/rig-parts.ts` fails the build if
  a detected part has <20% of its silhouette clear of nearer interactive geometry.
- **Local CI runner** — `ea610a10`. `npm run verify` (`scripts/verify-like-ci.mjs` +
  `scripts/lib/ci-steps.mjs`) runs everything both CI workflows run, ~3.5 min.
  `scripts/verify-like-ci.test.mjs` fails the build if runner and workflows drift.
- **CI budget rebuild** — `0295bca6`. The Actions outage was **exhausted free minutes** (1,619
  billed in 7 days vs 2,000/mo), NOT a declined card; it self-heals at the billing reset. Removed
  `push: main` from both workflows (59% of runs were duplicates of their own PR) and moved the 2x
  Windows job to `.github/workflows/ci-rust.yml` behind a paths allow-list (only 58 of 593 commits
  touch `src-tauri/`). `scripts/ci-budget-guard.test.mjs` now reads velocity from git history
  instead of a July constant — it was green through the whole overrun.

## Left to do

**UNCOMMITTED, in the worktree right now — Task #12, the a11y/layout guard slice:**

1. `src/modal-stacking-guard.test.ts` (NEW, ported) — caught a REAL live defect:
   `.cmp-confirm-backdrop` was `z-index: 200`, below FirstCheck 999 / Onboarding·SetupTour·Gaming
   1000 / Term·WhatsThis 1200. The mutation confirmation painted UNDER every full-screen overlay.
   **Fixed:** `src/design/ConfirmDialog.css` → `z-index: 2000` (below WindowChrome 9000/9001, which
   must stay reachable). Mutation-checked: reverting to 200 fails.
2. `src/focus-ring-guard.test.ts` (NEW, ported) — caught a REAL live defect: `home-console.css:679`
   shared ONE rule between `:hover` and `:focus-visible` with `outline: none`, so keyboard focus was
   indistinguishable from hover. **Fixed:** split the rules; `:focus-visible` now adds
   `outline: 2px solid var(--accent); outline-offset: -2px`. Mutation-checked: re-merging fails.
3. **BLOCKING:** a `self-reviewer` subagent was dispatched on both fixes and its verdict had not
   returned. **Do not commit these as done without a quoted PASS block** — green tsc/vitest cannot
   see a z-index or a focus ring (jsdom applies no stylesheets), which is exactly how both defects
   survived. If the verdict is lost to compaction, re-dispatch rather than assume.
4. `npm run verify` was run `--fast` (green); **run the full one incl. cargo before committing.**

**Declined ports, with cause — do not re-attempt without reading this:**

- `one-name-per-rec-guard.test.ts` — enforces "never show the raw catalog title", but this branch
  has **no friendly-name layer at all** (`RecName.tsx` / `rec-detail.ts` are absent; zero matches
  for `RecName|friendlyName`). The raw title is the only name, so the guard flags ~12 legitimate
  sites and could only pass by being registered into vacuity. Building that layer is a product
  change, not a guard port. **Real remaining gap — the invariant is unenforced here.**
- `receipts-copy-guard.test.ts` — superseded by `src/outbound-claim-guard.test.ts`, and its watch
  list pins the RETIRED no-telemetry absolutism. Main's copy deliberately reads "Compy's one
  outbound call is a signed update check, and you can turn it off."
- `lab-comparison-guard.test.tsx` / `lab-copy-contract.test.ts` — render `LabDeck`, absent here.
  The one generalizable invariant (en/zh-CN key parity) is already held by
  `src/i18n/locale-parity-guard.test.ts`.
- **Measured gauges need no port** — `LabConsole.tsx` already renders four `ArcGauge`s with
  `measured` honesty flags.

**Next slices on #14's list after this:** comparison evidence, rollback, denial semantics,
decision-journey behavior.

## Do NOT

- Merge PR #89 without an explicit per-PR instruction from the owner.
- Treat `origin/design/quiet-pit-wall` as the base — Half A already landed on `main` by cherry-pick;
  Half B (flipping `use-motion.ts` from `"full"` to `"system"`) is **owner territory** and reverses
  his 2026-06-19 decision. See `docs/BRANCH_DISPOSITIONS.md`.
- Chase the red X on PR #89. Still `steps: 0` — the billing wall, not the code. It clears on reset.
- Port anything from `feat/user-feedback-lab-recovery` wholesale.

## Resume with

```bash
cd C:\Users\Kuya\code\sentinel-quietpitwall && git status --short && npm run verify
```

Then: confirm the self-review verdict on the two CSS fixes (re-dispatch if lost), commit the guard
slice, push, and update issue #49 with the 2-ported / 4-declined outcome above.
