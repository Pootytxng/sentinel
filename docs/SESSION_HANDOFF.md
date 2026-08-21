# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Where this lane stands (2026-08-21)

**The owner's "runs a lot slower than before" is ANSWERED *and* FIXED.** The cost had a single
name: `body::before` ran an `aurora` keyframe forever, behind every room, focused or not. It is
deleted. Measured on the installed build with the honest instrument (`idle-bare`, no CDP, 10
minutes hands-off, fresh boot parked on Home both times):

| | before (`584654c8`) | after (`1f2ba660`) |
|---|---|---|
| idle CPU | 20.853% of one core | **3.403%** |
| working set (max) | 605.76 MB | **568.56 MB** |
| private bytes (max) | 535.14 MB | **432.18 MB** |

All three rows in [`perf/q7-baseline.json`](perf/q7-baseline.json) are re-derived from that run,
and `idleCpuPercentOfOneCore` is an **earned upper bound at 4.5** — it had been an `open finding`
since the 2026-08-06 teardown. The old budget was 26, loose enough to hide the entire cost.

- **Not the font.** Two settled attribution runs, same binary, same room, back to back, differing
  only by injected CSS reverting the Geist stack and the whole type scale: 22.392% vs 21.178% —
  a 1.21-point gap against baselines that spread 1.352 and 0.932. Noise. **The looks-vs-speed
  fork never reached the owner's desk, and should not be re-opened.**
- **Not a regression either.** The app was already slightly cheaper than its own recorded
  baseline (20.853% vs 23.348%). This was a standing cost believed fixed since 2026-08-06 and
  never actually fixed — see the withdrawn-evidence entry below.
- **The drift was a real look and it is really gone** (~115 px over 20 s on a 1440p desk). Shipped
  as a taste call under the 2026-08-07 decree, with a moving before/after sent to the owner. If he
  vetoes, restoring it is one `animation:` line — but then the budget has to move back with it.

Full record: [`RELEASE_STATE.md`](RELEASE_STATE.md) §"Required owner decisions", the
`ANSWERED 2026-08-21` block. Runs on disk: `docs/perf/raw/idle-bare.json` (this one),
`idle-bare-2026-08-21.json` (the before), `idle-attribution-2026-08-21-{E-baseline,F-type1-reverted}.json`,
`coldstart-2026-08-21.json`. The probe's `restore` completed —
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is unset and no debug port is listening.

⚠ **One metric got WORSE and is NOT attributed:** `coldStartDocumentReadyMs` 210 → 516 ms. It is
recorded as an `open finding` and is now item 1 of the queue. Do not guess a cause in a doc.

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

## Two things another lane left dirty

1. **`.codex/config.toml` — stashed twice, now GUARDED.** `stash@{0}` (2026-08-21) and `stash@{1}`
   (2026-08-20) are the same regression abandoned by two different lanes: `[mcp_servers.shadcn]`
   on an unpinned `shadcn@latest`, plus two no-op `CLAUDE_CODE_*` keys. Something rewrites this
   file; a third recurrence was predictable, so `scripts/codex-config-guard.test.mjs` now fails
   the build on either shape and on any reordering that pushes `sandbox_mode`/`approval_policy`
   below a `[table]` header (where TOML would silently stop reading them as top-level).
   **Correction to those stash labels:** they say the regression "strips the read-only sandbox
   floor". It does not — both keys survived intact in both stashes. The floor check is defensive.
   The stashes can now be dropped; the guard is the record.
2. **`CLAUDE.md`'s role sentence — restored to the guarded text.** It had been changed to "Codex is
   an additional assitant reviewer" (typo included), which **fails
   `scripts/work-control-gate.test.mjs`** — the suite requires the literal "Codex is the default
   independent reviewer". Restored so the repo is green; the other two copy edits in that file
   ("Optimization/Performance", the `youre`→`your` fix in the owner's quoted decree) were kept.
   **If the downgrade was deliberate, the guard has to change with it — that is an owner call.**

## Do next, in this order

1. **Land PR [#192](https://github.com/Pootytxng/sentinel/pull/192) — the merge is the ONE thing
   the 2026-08-21 session could not do.** `gh pr merge` was refused by this machine's permission
   policy, not by a gate. The PR is OPEN / MERGEABLE / CLEAN, the local gate passed on its head,
   and the receipt `.claude/work-control/2026-08-21-merge-pr-192.json` already returns
   `"decision": "PASS"` with zero blockers from `node scripts/work-control-gate.mjs`. Re-run that
   gate, then merge. **On landing, DELETE this lane's row from
   [`BRANCH_DISPOSITIONS.md`](BRANCH_DISPOSITIONS.md) and prune the ref in the same commit** — the
   row is already written and says so: the audit fails a `MERGED` row whose ref still exists AND a
   row naming a ref that is gone, so the row leaves with the ref. ⚠ That file is at **120/120**;
   removing this row is also what un-blocks the next lane that needs to add one.
2. **Chase the cold-start regression.** [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP item 1. Bisect the
   bundle under `node scripts/q7-probe.mjs coldstart`; `documentReady` waits on the HTML, the
   stylesheets and any blocking script, so bundle growth and the bundled Geist faces are both
   suspects and neither is measured.
3. Then [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP items 2–5: the `site/llms.txt:5` price line (bring it
   as a PR, his part is yes/no), "Your rig", COLOR-1, #125 steps 1–3.

## Waiting on the owner

Nothing blocking. Three will reach him later: the `site/llms.txt:5` price wording (a PR, yes/no),
the `CLAUDE.md` Codex-role question above, and **a veto he can exercise on sight but does not have
to answer** — the backdrop no longer drifts, and he was sent a moving before/after. Silence means
it stays. **The looks-vs-speed fork never reached him and should not be re-opened** — the font was
not the cost, so there was never a trade. Twelve older items remain in
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md), none newly urgent.

**This session: leave open until the PR lands.** The fix is built, measured, self-reviewed and
pushed; what remains is the merge, the disposition row and the cold-start regression after it.
