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

Worktree `.claude/worktrees/local-ci-verification-c41dbc`, branch **`claude/command-palette`** @
`41579adb`, off `main` @ `7e02ecb1`. **PR [#99](https://github.com/Pootytxng/sentinel/pull/99) open,
MERGEABLE/CLEAN, NOT merged** — a merge to `main` needs the owner's per-PR word.

The prior occupant of this file (the discoverability lane, PRs #93/#94/#95/#97) has fully landed and
its branches are pruned; that state is retired here, not lost — it is in git history.

## What this lane is doing

The owner's named priority, in his words: the app is *"just not inherently familiar or intuitive
enough … honestly my biggest gripe."* He watched a tester fail to navigate it. The answer he chose
was a global "jump anywhere" palette, not another room.

## Done and pushed

- **The command palette** — `src/design/CommandPalette.tsx`, `command-palette-data.ts` (pure
  index/ranking), `command-palette.css`; mounted by `ShellV2.tsx`, wired in `App.tsx`. Flag
  `compy_command_palette` in `theme.ts` + `useCommandPaletteFlag()` in `use-hud.ts`, **default ON**
  with a `"0"` failsafe. 45 tests across index, component and flag contract.
  - Indexes the rail it is GIVEN (never `HOME_RAIL` — that still carries retired doors), Lab
    stations, Settings, and `KNOWLEDGE`. Two ranking rules: **navigation outranks reading**, and
    **symptoms are search terms** (`crashed` → blackbox, `laggy` → latency).
  - Every row calls the host's existing writer — `onNavigate` / `openLabStation` / `openLibrary`.
    A group whose callback is absent is not indexed at all, so there are no dead doors.
- **Contrast fix + its guard** (`4a0c6544`). The `kbd` chips rendered `--v2-faint` (~3.45:1 at
  10.5px) because `shell-v2.css`'s `:root[data-v2="on"] .v2-shell kbd` outranks an unprefixed rule —
  and *matching* its specificity still lost, because a tie goes to insertion order and ShellV2
  imports CommandPalette above its own CSS. The rule now carries `.v2-shell` and wins outright.
  The first guard regex-matched selector text and went green while the bug was live; it now
  computes CSS specificity for both stylesheets and demands ours be strictly greater.
- **`footCount` pluralized** — `footCount_one` / `footCount_other` with `{{count}}`; zh-CN carries
  only `_other` (no `one` category). It read "1 results".
- **`fix(tests)` ExperimentBench** (`f35dd535`) — its loaded-runner test simulated backend latency
  with an 80 ms timer, then asserted a state that only holds while that timer is pending. Under a
  loaded suite the awaited query outlasts it and the precondition fails (it did here; passed twice
  in isolation seconds later). Now gated on a promise the test opens itself.

**Verification:** full suite 314/314 through the local pre-push gate (zero Actions minutes).
**Self-review VERDICT: PASS** at round 3 — rounds 1 and 2 both FAILED on the contrast defect above.

## Left to do

### 1 · Merge decision on PR #99 — owner's word

Not blocked on anything technical. Do not merge without an explicit per-PR instruction.

### 2 · The local CI runner on a closed PR's branch

`origin/feat/lab-49-parity-port` (PR #89, closed unmerged) carries three files that exist on neither
`main` nor #90: `scripts/verify-like-ci.mjs`, `scripts/lib/ci-steps.mjs`,
`scripts/verify-like-ci.test.mjs`. `main` now has its own gate — `scripts/verify-local.ps1` +
`.githooks/pre-push` + `scripts/deps-satisfied.ps1` (PR #98). **Converge or kill:** either port what
the older runner does better into `verify-local.ps1`, or write the reason it dies with its PR into
that branch's `docs/BRANCH_DISPOSITIONS.md` row. Right now the row says "needs a decision" and
nobody has made one.

### 3 · PR #90 recovery (Codex handoff, 2026-08-10 — treat its gate list as claims)

PR #90 `agent/rig-evidence-map-clean`, head `98146456`, OPEN / MERGEABLE / no review decision.
Independent review was never completed (expired OAuth), so no gate below is re-proven.

- **P1** `LabConsole.tsx` resolves selected IDs only through detected `buildRigParts()` entries —
  manual parts and fans can select into no panel. Keep exact IDs; never collapse to `gpu`/`storage`.
- **P2** `shadowingGhostIds()` releases only *undetected* ghosts — a detected CPU fan or manual
  cooler can still occlude the CPU. Needs regression coverage.
- **P3** Selection is pointer-only through Three.js. #49's a11y acceptance needs a DOM selector:
  tab, Enter/Space, visible focus, name/role/value, 200% reflow, honest unavailable states.
- **P4** Re-verify `scripts/work-control-gate.mjs` itself resolves the real head, binds gates and
  review to that head, and rejects self-authored SHAs — don't re-apply the old governance diff blind.
- Owner-run verifier: `powershell -NoProfile -File scripts/verify-release.ps1 -EvidencePath src-tauri\target\codex-verification\pr90-final-review-verify-release-evidence.json`

## Do NOT

- Do not push any branch without adding its own disposition row in the same commit — a new origin
  ref turns `scripts/branch-disposition-audit.test.mjs` red. **And a row is perishable both ways:**
  this lane hit the table's conflict twice in one hour because neighbouring lanes merged and pruned
  refs mid-flight. On a conflict there, re-check `git ls-remote --heads origin <ref>` before
  choosing a side — the row that names a dead ref is the wrong one, whichever side it is on.
- Do not merge, release, publish, or touch signing keys. Do not rebase PR #92 before #90 resolves.
- Do not claim PR #90's gates from the `98146456` receipt if the tree moves.
- Do not run `loadLibrary()` without injecting a loader from inside a test — it boots a real Vite
  server inside the worker pool and the deadlock surfaces in unrelated files. It now refuses under
  `VITEST`; see `scripts/nested-vite-server-guard.test.mjs`.

## Resume with

**Item 2 (converge or kill the old CI runner)** unless the owner says otherwise — it is the last
open piece of the Codex local-CI handoff, and its branch row has been "needs a decision" since
2026-08-08. A dev build of this branch may still be running on port 1420; stop all `compy` and free
1420 *before* launching another.
