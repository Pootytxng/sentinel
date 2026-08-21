# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Where this lane stands (2026-08-21)

PR [#191](https://github.com/Pootytxng/sentinel/pull/191) is **MERGED** (`6516b646`), the
`lane/rig-then-rails` ref is pruned from origin, and its row is out of
[`BRANCH_DISPOSITIONS.md`](BRANCH_DISPOSITIONS.md) — a MERGED row whose ref still exists fails the
audit, and so does a row whose ref is gone, so the row leaves with the ref. That also drops the file
to **119/120**, which un-blocks the next lane that needs to add one. ⚠ **The worktree
`sentinel-home-room` is now DETACHED at main** — cut a fresh branch before writing anything.

**The owner's "runs a lot slower than before" is ANSWERED — measured, not guessed. Do not re-run it.**
Numbers live in [`RELEASE_STATE.md`](RELEASE_STATE.md) §"Required owner decisions", the
`ANSWERED 2026-08-21` block. Short version:

- **No regression.** Against the installed build, on the honest instrument: idle CPU **20.853%** of
  one core vs 23.348% recorded, cold start **3112 ms** vs 3721 ms, working set **579 MB** vs 606 MB.
  Every metric equal or better than its own baseline, all inside budget.
- **The Geist font + 14→15px bump is NOT the cause.** Two settled attribution runs, same binary, same
  room, back to back, differing only by injected CSS reverting the font stack and the whole type
  scale: 22.392% vs 21.178%. A 1.21-point gap against baselines that spread 1.352 and 0.932 — noise.
- **What the idle cost actually is: the ambient backdrop.** `body::before`'s `aurora` keyframe is
  ~88% of everything the app burns at idle. Freezing that one animation and nothing else:
  22.392% → **2.067%** (run E), 21.178% → **1.681%** (run F). Nothing pauses it on focus loss. It is
  not new and not a regression — it has been this way the whole time.

Runs on disk: `docs/perf/raw/idle-attribution-2026-08-21-{E-baseline,F-type1-reverted}.json`,
`idle-bare-2026-08-21.json`, `coldstart-2026-08-21.json`. The probe's `restore` completed —
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is unset and no debug port is listening.

## What landed this session

- `a4484a6f` — outbound-claim guard skipped a gitignored local mirror; two tests now assert the
  exclusion's own premise, so it cannot rot into a corpus hole.
- **`src/perf-evidence-integrity-guard.test.ts` (new).** `scripts/q7-probe.mjs` records
  `"baselineStability": { "settled": false }` when its baseline never converged, and until now
  **nothing in the repo ever read that field.** Two of #127's load-bearing figures came from such
  runs: run B's "-0.105 points, i.e. gone" (which became the evidence line in `src/App.css` and the
  rationale in `src/ambient-animation-cost-guard.test.ts` for letting a full-window layer drift
  forever) and run D's 10.483% (reported as the fix landing, and part of v0.9.26's owner GO). Both
  are withdrawn. The guard fails the build on any live file citing an unsettled run; the escape hatch
  is a line-level, greppable `perf-unsettled-allow`, for text whose subject IS the unsettledness.
  It understands the repo's three citation idioms — literal, `{a,b}.json`, and `*.json` — because a
  literal-only matcher passed green on its first run while the real offender sat in `App.css`.
- Corrected every live citation it caught: `src/App.css`, `src/ambient-animation-cost-guard.test.ts`,
  `src/surfaces/setup/SetupLauncherCard.css`, `docs/superpowers/specs/2026-07-31-q7-native-baseline.md`.
- `RELEASE_STATE.md` back under budget: the closed v0.9.25 + v0.9.24 GO records moved verbatim to
  [`archive/RELEASE_STATE_HISTORY.md`](archive/RELEASE_STATE_HISTORY.md) with a pointer left behind.

## Two things another lane left dirty — neither is committed

1. **`.codex/config.toml` — stashed, not landed.** `stash@{0}`, labelled ABANDONED. It strips the
   documented read-only sandbox floor and re-adds `shadcn@latest` unpinned plus the no-op
   `CLAUDE_CODE_*` keys. **This is the second recurrence** — `stash@{1}` is the same regression
   abandoned on 2026-08-20 by a different lane. Something keeps rewriting this file; that is worth a
   guard, not a third stash.
2. **`CLAUDE.md`'s role sentence — restored to the guarded text.** It had been changed to "Codex is
   an additional assitant reviewer" (typo included), which **fails
   `scripts/work-control-gate.test.mjs`** — the suite requires the literal "Codex is the default
   independent reviewer". Restored so the repo is green; the other two copy edits in that file
   ("Optimization/Performance", the `youre`→`your` fix in the owner's quoted decree) were kept. **If
   the downgrade was deliberate, the guard has to change with it — that is an owner call, not mine.**

## Do next, in this order

1. **Stop the backdrop animating.** [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP item 1. `aurora` on
   `body::before` in [`../src/App.css`](../src/App.css) is ~20 points of one core, forever, focused
   or not. Kill the animation (or park it on blur), keep the gradients. Then re-measure with
   `node scripts/q7-probe.mjs idle-bare` and **ratchet `idleCpuPercentOfOneCore` in
   [`perf/q7-baseline.json`](perf/q7-baseline.json) down hard** — 26 is loose enough to hide the whole
   cost today. It is a look change: needs a `self-review` PASS on an installed build, and it ships
   with a before/after to the owner as a decision with a veto attached, not as a question.
2. ~~Merge PR #191 and prune the lane ref.~~ **Done** — see above.
3. Then [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP items 2–5: the `site/llms.txt:5` price line (bring it as
   a PR, his part is yes/no), "Your rig", COLOR-1, #125 steps 1–3.

## Waiting on the owner

Nothing blocking. Two will reach him later: the `site/llms.txt:5` price wording (a PR, yes/no), and
the `CLAUDE.md` Codex-role question above. **The looks-vs-speed fork is off his desk** — the font
was not the cost, so there is nothing to trade. Twelve older items remain in
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md), none newly urgent.

**This session: leave open.** The measurement is complete and recorded; the fix it points at is not
built yet.
