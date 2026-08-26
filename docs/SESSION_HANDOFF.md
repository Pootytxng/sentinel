# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**A LANE IS PUSHED AND OPEN FOR MERGE.** Compy Care **Tier 1**, built dark, issue
[#220](https://github.com/Pootytxng/sentinel/issues/220) → PR
[#221](https://github.com/Pootytxng/sentinel/pull/221).

| | |
|---|---|
| Worktree | `C:\Users\Kuya\code\sentinel-q9a` — **not** the main checkout |
| Branch | `lane/care-tier1-2026-08-25`, head `c327f7f5`, cut off `origin/main` `59d13f29` |
| Plan | `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md` (11 tasks) |
| State | **plan tasks 1–7 of 11 done**, 11 commits, pushed, PR open + MERGEABLE, tree clean |
| Gate | `pwsh scripts/verify-local.ps1` **PASS at `c327f7f5`** (the pre-push hook ran it) |

Issue #220 is scoped to exactly tasks 1–7, so merging PR #221 closes it.

- **Eleven worktrees besides `main`. Six are spent; five carry commits that are not on main — do
  NOT delete or hard-reset those five before checking them**: `lane/care-tier1-2026-08-25`
  (this lane, 6 commits, never pushed) · `feat/user-feedback-lab-recovery` (49) ·
  `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). Re-derive with `git worktree list` and
  `git rev-list --count origin/main..<branch>`; never carry these numbers forward unchecked.

**STILL DARK, three independent locks, none of them touched:** `case_intelligence_gate()` is
hard-false · `CASE_SIGNING_PUBKEY` is all zeros · `CASE_CATALOG_ENDPOINTS` **and**
`CASE_CATALOG_ORIGINS` are both empty. Arming is plan tasks 10–11 and is **owner territory**.

## Task 7 — what is sitting in the working tree

`Incident.case_intelligence` is `skip_serializing_if = "Option::is_none"`, set **only** on
`CaseMatchOutcome::Found`, so "no catalog" / "expired" / "nothing matched" all reach the UI
identically — as nothing, and a dark build serializes byte-for-byte like the pre-Tier-1 station.
`local_facts_from` reads the existing hardware snapshot (once per report, behind the gate) and
leaves every unreadable fact `None`. The UI is `KnownIssueBlock` in `src/surfaces/BlackBox.tsx`:
a dashed neutral card that must NOT look like `.bb-assess` (Compy's own accent-washed reading)
sitting directly above it.

- **Self-review: PASS 12/12**, captured at 1500×980 on the fixture rig, not the app. Screenshots
  were sent to the owner (before = `tier1-none`, after = `tier1-matched`).
- **IPC contract audit: no blockers.** It also settled the load-bearing question — `opener:default`
  grants `https://*` and Tauri unions scopes across granted permissions, so the source button's
  capability is genuinely present, not missing.
- **Fixture rig extended** — `docs/ui-sweep/fixture/{stub-core.ts,main.tsx}` gained three states:
  `tier1-matched`, `tier1-possible`, `tier1-none` (the absent-field CONTROL). Serve with
  `npx vite --config docs/ui-sweep/fixture/vite.config.mts`, then
  `http://localhost:5199/docs/ui-sweep/fixture/index.html?state=tier1-matched` and **click
  `.bb-scan`** — the station renders nothing until scanned.
- **bug→guard, four added, all falsified.** Three in `src/fixture-parity-guard.test.ts`: the stub
  must answer every command `BlackBox.tsx` sends · the opener must stay stubbed (asserted as the
  QUOTED literal — a bare substring check passed against `open_url_GONE` and was tightened) ·
  `tier1-none` must stay absent-field. One in `src/case-intelligence-outbound-guard.test.ts`: every
  `EvidenceRequirement::key()` string must have a locale label in `en` and `zh-CN`, or an evidence
  line renders as an empty `<li>` with no error anywhere.
- Verified: `cargo test` 1118 passed / 0 failed / 24 ignored · `tsc --noEmit` clean · clippy clean ·
  `verify-release-state.mjs` 31/31 citations, 0 drift.

## Doc truth — DONE in this lane, do not redo

`RELEASE_STATE.md:56` marker and the Tier 1 row at `:132` now say built-dark/three-locks.
`PRIVACY.md` no longer says Tier 1 "has no module" (it has one; it has no endpoint, key or
traffic). `src/capability-exception-policy-guard.test.ts` had two markers amended with the reason
recorded inline. `BACKLOG.md`'s Tier 1 row is `[BUILT-DARK]`, three follow-up nits were queued, and
**60 closed PHASE A rows were archived verbatim** to
`docs/archive/BACKLOG_PHASE_A_SHIPPED_2026-08-25.md` for the byte budget.

## THE NEXT STEP, exactly

1. **Merge PR #221** with `gh pr merge 221 --merge`. **Never pass `--delete-branch`**: it sets
   `core.bare=true` repo-wide and corrupts every worktree. Prune the ref afterwards with
   `git push origin --delete lane/care-tier1-2026-08-25`, then drop the lane's row from
   `docs/BRANCH_DISPOSITIONS.md` (the audit fails on a row naming a dead ref).
2. Merging is a **proof-dependent** transition under `docs/WORK_CONTROL.md`: build the receipt and
   run `node scripts/work-control-gate.mjs <receipt.json>` first. It binds every named gate AND the
   independent review to the exact current head — a review of an earlier head does not count.
3. Close #220 (tasks 1–7 is its whole scope) and point its BACKLOG row at the merge.
4. Plan tasks 8–9 are then the next lane. Tasks 10–11 (arming) are owner territory, and
   `docs/OWNER_ACTION_CHECKLIST.md` §C now carries a row saying exactly that.

**OUT of this lane, deliberately:** plan tasks 8–9 (further UI — another writer may be live on UI
surfaces) and 10–11 (independent security review + arming — owner territory).

**Before any UI work:** the owner's design vision lives in `docs/UI_VISION_BACKLOG.md`, whose
still-🔴 OPEN rows today are **DIR-1** (the standing intuitive-UI directive) and **§G** (the site).
Read those two rows there; do not re-queue a row from a paraphrase of them.

## Waiting on the owner — none of it blocks this lane

- Register **`compy.gg`** (~$50/yr — money call). Blocks money-stack Phase 2 (the one-pager +
  waitlist, `docs/RECEIPTS_DOCTRINE.md` §4), which has **not been started**.
- Land or retire **`B_shelter`** (#128) — ~1,100 lines unpushed since 2026-08-18.
- The **Ko-fi URL** (B3a).
- Rule on the **Q9a consent screens** (built, reviewed, `receipts_gate()` still false).
- **#219** and **#204** — Compy Pro price shape.
- **#213's B half** — his ChatGPT room mockups. (A1, the `©ompy` wordmark, is already answered.)
