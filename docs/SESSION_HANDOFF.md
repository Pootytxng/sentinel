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

Worktree `.claude/worktrees/compy-discoverability-ux-context-68c484`, branch
**`fix/confirm-stacking-focus-ring`** @ `0f0502f2`, stacked on
`claude/compy-discoverability-ux-context-68c484` @ `af501bf0`, both off `main` @ `a53d7795`.
**Local only — nothing pushed, no PR, no merge.** Reconstructs and executes the work three sessions
were mid-flight on when the weekly cap hit 2026-08-09, plus the Codex PR-90 handoff pasted 2026-08-10.

## What this lane is doing

Blocks 1 and 2 below are done and committed. Blocks 3 and 4 are untouched and are the next work.

## Done so far

- **§1 — both red gates are green** (`af501bf0`). Re-stamped `STATE:source_main_commit` `ce3f4bd`
  → `a53d7795` (it trailed by 12, tolerance 10 — 30/30 citations were already anchored), and wrote
  disposition rows for the three unjudged origin refs: PR #90's and PR #92's branches CLAIMED,
  `feat/lab-49-parity-port` UNLANDED. That last row is the one to read — its PR is closed and its
  rig work was re-cut into #90, but `scripts/verify-like-ci.mjs`, `scripts/lib/ci-steps.mjs` and
  `scripts/verify-like-ci.test.mjs` exist on neither `main` nor #90. Pruning the ref drops the local
  CI runner with it. **Owner decision, named in the row.**
- **§2 — both defects fixed, guards mutation-proven** (`0f0502f2`). Confirm backdrop 200 → 2000.
  Home's intent rows got their own `:focus-visible` rule. Carried onto a clean branch off `main`;
  the closed PR #89 is not their vehicle.
  - Both ported guards were themselves broken. The stacking guard checked a hand-written list of
    four backdrops; it now derives every `position: fixed` full-viewport layer from the CSS and
    found five more, `.modal-backdrop` at 1000 among them. The focus guard's lookahead sat after
    `\s*` instead of after the colon, backtracked to zero width, inspected the space, and read
    `outline: none` as an acceptable focus mark — **exempting every rule it exists to catch.**
    Rewritten it flags them, and the sweep then found no other offender in `src`.
  - **D2 is not currently reachable by users** — `.hc-intake-row` renders only behind
    `compy_home_intake`, DEFAULT OFF. §4 is what turns it on. D1 is live on `main` unconditionally.
  - Gates: `npm test` 3909 passed / 3 skipped / 308 files · tsc clean · `npm run build` ok ·
    verify-release-state 30/30 · disposition audit OK · encoding-guard 1237 · doc-budget ALL PASS ·
    `git diff --check` clean. **Rust untouched, so cargo was not run.**
  - This worktree had **no local `node_modules`** — tests were resolving from the parent repo, so
    two guards that read `node_modules/...` by relative path reported false FAILs. `npm ci` run at
    root and in `site-app/`. A nested worktree will do this again.

## Left to do

### 2b · The one thing §2 still owes

**No visual verdict has been quoted for either fix.** The commit says so in its own message. The
`self-reviewer` subagent has not been run — this session was started under a no-subagent
instruction. **Do not report §2 as done until a PASS block is quoted.** Also still true: the older
copies of both fixes sit dirty in `C:\Users\Kuya\code\sentinel-quietpitwall`, now redundant and
superseded by `0f0502f2` — clear them once the verdict lands, not before.

Declined ports and their reasons: `git show feat/lab-49-parity-port:docs/SESSION_HANDOFF.md`. One
real gap there: no friendly-name layer exists (`RecName.tsx` / `rec-detail.ts` absent), so the
one-name-per-rec invariant is unenforced. Remaining #14→#49 slices: comparison evidence · rollback ·
denial semantics · decision-journey behavior.

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

- Do not push either branch without adding its own disposition row in the same commit — the audit
  is green now and a new origin ref turns it red again.
- Do not merge, release, publish, or touch signing keys. Do not rebase PR #92 before #90 resolves.
- Do not claim PR #90's gates from the `98146456` receipt if the tree moves.
- Do not report §2 done without a quoted self-review PASS. It is committed, not verified.

## Resume with

**§2b first if subagents are permitted** — one `self-reviewer` dispatch closes the block. Otherwise
**§4**, the owner's stated product priority, in a fresh session: it needs a whole context window and
a taste before/after. **§3** is the Codex lane's; take it only on an explicit handoff.
