# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template in git history.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

**Consolidation only — no write claim taken.** Worktree
`.claude/worktrees/compy-discoverability-ux-context-68c484`, branch
`claude/compy-discoverability-ux-context-68c484`, read-only against `main` @ `a53d7795`.
Reconstructs the work three sessions were mid-flight on when the weekly cap hit 2026-08-09, plus
the Codex PR-90 handoff the owner pasted 2026-08-10. Nothing below is claimed done.

## What this lane is doing

Nothing but reading. It fixed no gate and committed no source, deliberately: two of the four blocks
below are pinned to heads another lane must not have moved under it.

## Done so far

Verified 2026-08-10 against `main` @ `a53d7795` after `git fetch`:

- `node scripts/verify-release-state.mjs` → **FAIL** (30/30 citations OK, 1 STATE-DRIFT).
- `node scripts/branch-disposition-audit.mjs` → **FAIL** (3 refs).
- `git status` in `C:\Users\Kuya\code\sentinel-quietpitwall` → 4 dirty paths, still there.
- Crash-rescue reachability traced in source (block 4). No gate re-run at PR #90's head.

## Left to do

### 1 · Two build-failing gates, red on `main` right now

- **G1** `STATE:source_main_commit=ce3f4bd` (`docs/RELEASE_STATE.md:28`) trails `origin/main` by 12
  commits, max 10 → re-stamp to `a53d7795`. This is the one the Codex handoff flagged.
- **G2** disposition audit: `agent/rig-evidence-map-clean` (PR #90),
  `codex/compy-care-capability-gate` (PR #92) and `feat/lab-49-parity-port` (PR #89, closed) exist
  on `origin` with no row in `docs/BRANCH_DISPOSITIONS.md`. **Not in the Codex handoff — new.**
- Sequencing: both edit files PR #90's final-head proof covers. Fixing them moves the tree and
  voids the `98146456` receipt. Land them in ONE lane, then re-run the exact gates at the new head.

### 2 · Two live user-facing defects whose fixes were written and never committed

Worktree `C:\Users\Kuya\code\sentinel-quietpitwall`, branch `feat/lab-49-parity-port` @ `7e6cd4d7`
(PR #89 closed 2026-08-08 — the fixes did **not** go with it; neither guard exists on `main`):

- **D1** `src/design/ConfirmDialog.css:5` is `z-index: 200` on `main`, below FirstCheck (999),
  Onboarding/SetupTour/Gaming (1000) and Term/WhatsThis (1200) — the "are you sure?" before Compy
  changes the PC paints **underneath** every full-screen surface. Mouse dead, keyboard alive.
  Fix in the worktree: `2000`. Guard `src/modal-stacking-guard.test.ts` (untracked).
- **D2** `src/surfaces/home-console.css` shares one rule between `:hover` and `:focus-visible` with
  `outline: none` — keyboard focus invisible on Home rows. Fix + `src/focus-ring-guard.test.ts`
  (untracked).
- **BLOCKING both:** the `self-reviewer` verdict never returned (the agent died on the cap). jsdom
  applies no stylesheets, which is exactly how both survived green tests. **Re-dispatch and quote a
  PASS block — do not commit these on tsc/vitest alone.** Then full `npm run verify` incl. cargo.
- Declined ports and their reasons: `git show feat/lab-49-parity-port:docs/SESSION_HANDOFF.md`.
  One real gap recorded there: no friendly-name layer exists (`RecName.tsx` / `rec-detail.ts`
  absent), so the one-name-per-rec invariant is unenforced here.
- Remaining #14→#49 slices after this: comparison evidence · rollback · denial semantics ·
  decision-journey behavior.

### 3 · PR #90 recovery (Codex handoff, 2026-08-10 — treat its gate list as claims)

PR #90 `agent/rig-evidence-map-clean`, head `98146456`, OPEN / MERGEABLE / no review decision.
Independent review was never completed (expired OAuth), so no gate below is re-proven here.

- **P1** `LabConsole.tsx` resolves selected IDs only through detected `buildRigParts()` entries —
  manual parts and fans can select into no panel. Keep exact IDs; never collapse to `gpu`/`storage`.
- **P2** `shadowingGhostIds()` releases only *undetected* ghosts — a detected CPU fan or manual
  cooler can still occlude the CPU. Needs regression coverage.
- **P3** Selection is pointer-only through Three.js. #49's a11y acceptance needs a DOM selector:
  tab, Enter/Space, visible focus, name/role/value, 200% reflow, honest unavailable states.
- **P4** Re-verify `scripts/work-control-gate.mjs` itself resolves the real head, binds gates and
  review to that head, and rejects self-authored SHAs — don't re-apply the old governance diff blind.
- Owner-run verifier: `powershell -NoProfile -File scripts/verify-release.ps1 -EvidencePath src-tauri\target\codex-verification\pr90-final-review-verify-release-evidence.json`

### 4 · Crash & Freeze Rescue discoverability — the tester walked to Event Viewer

The 2026-08-09 session was cut off before any work; the whole task is untouched. Root cause is
confirmed in source, not inferred:

- `BlackBox` mounts **only** as a Lab station (`src/surfaces/LabConsole.tsx:234`, `case "blackbox"`).
  There is no top-level route to it. The tester could not find it because it is not findable.
- Its user-facing name is **"Black Box"** (`src/i18n/locales/en/lab.json:303`) — an insider
  metaphor. Nothing in the nav says *crash*.
- Home intake's `crashedFroze` row routes to room `"lab"`, **not** to the Black Box station
  (`src/surfaces/home-intake-data.ts:52`) — even with the band on, it drops you in the room.
- The band is behind `compy_home_intake`, DEFAULT OFF (`src/design/theme.ts:400`).
- Backend is already built and read-only: `src-tauri/src/blackbox.rs`, `src/surfaces/BlackBox.tsx`,
  `src/data/blackbox-resolution.ts` (Event Log + WER + Reliability History).
- Direction: problem-first Home entry → deep-link straight into the crash evidence, not the room.
  No new subsystem, no telemetry, no notification-as-primary-discovery.

**Correction to the pasted handoff:** it says clearing storage "activates a default-on preview and
is not a valid flag-off test." Not true of this flag — `readHomeIntake()` returns false unless the
value is literally `"1"`, so cleared storage *is* off. Don't write tests around that claim.

## Do NOT

- Do not push this branch — `origin` already has 3 undispositioned refs failing G2; a 4th makes it worse.
- Do not merge, release, publish, or touch signing keys. Do not rebase PR #92 before #90 resolves.
- Do not claim PR #90's gates from the `98146456` receipt if the tree moves.
- Do not commit D1/D2 without a quoted self-review PASS.

## Resume with

Pick ONE: **§2** (safety defect, self-contained, no head conflict) · **§1** (unblocks every gate,
but must own the tree) · **§4** (the owner's stated product priority; needs a taste before/after).
