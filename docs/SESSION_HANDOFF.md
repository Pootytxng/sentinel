# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**NOTHING IS MID-FLIGHT. `main` is clean and the last lane landed.** Compy Care **Tier 1** — signed
case intelligence, built dark — merged 2026-08-26 as PR
[#221](https://github.com/Pootytxng/sentinel/pull/221) against issue
[#220](https://github.com/Pootytxng/sentinel/issues/220).

| | |
|---|---|
| `main` | `d83c6f04` — the Tier 1 merge commit |
| Plan | `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md` (11 tasks) |
| Landed | **plan tasks 1–7 of 11**: schema · trust root · cache · matcher · pull path · wire contract · UI |
| Gate | `pwsh scripts/verify-local.ps1` **PASS at `db02b6cb`** — 389/389 files, 5441 passed, Rust 1119 passed, clippy clean |
| Receipts | `.claude/work-control/2026-08-25-merge-pr-221.json` and `…-close-issue-220.json` |

**STILL DARK, three independent locks, none of them touched:** `case_intelligence_gate()` is
hard-false · `CASE_SIGNING_PUBKEY` is all zeros · `CASE_CATALOG_ENDPOINTS` **and**
`CASE_CATALOG_ORIGINS` are both empty. `refresh_case_catalog` is not registered as a command and
nothing calls it. Arming is plan tasks 10–11 and is **owner territory**.

- **Eleven worktrees besides `main`. Seven are spent; four carry commits that are not on main — do
  NOT delete or hard-reset those four before checking them**: `feat/user-feedback-lab-recovery`
  (49) · `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). The Tier 1 worktree
  `C:\Users\Kuya\code\sentinel-q9a` is now spent. Its branch landed on `main` and its remote ref
  is pruned. Re-derive with `git worktree list` and `git rev-list --count origin/main..<branch>`; never
  carry these numbers forward unchecked.

## What the pre-merge review caught, and the guards that now hold it

An independent `rust-tauri-reviewer` pass found three things in Tier 1. All three are fixed in
`bb9bc71a`, and each carries a guard, per the bug→guard law.

1. **The placeholder-key check sat on the wrong path.** It lived only in `verify_catalog_chain`,
   which is a production-binding WRAPPER, not the funnel. `cache_store_verified`,
   `cache_load_verified` and the refresh all call `verify_manifest_with` directly, so the check
   never ran on a real path. Tier 1 still refused everything — but it refused as
   `SignatureInvalid`, because `PublicKey::from_slice` does NOT reject 32 zero bytes; `.verify()`
   rejects them later as a WEAK key. Correct refusal, wrong diagnosis, and the diagnosis is what a
   future reader acts on. Guard:
   `a_dark_build_reports_no_trust_root_on_the_paths_that_actually_run`, falsified (it fails
   `left: SignatureInvalid`).
2. **`parse_manifest` was dead and dangerous-looking** — zero callers anywhere, and unlike
   `parse_catalog` it validated a manifest with no signature check at all. Deleted. Guard: a block
   in `src/case-intelligence-outbound-guard.test.ts` fails on any `pub(crate) fn` in the module
   that nothing in the crate mentions. It counts the test block as a call site ON PURPOSE — the
   four production-binding wrappers are called only by the darkness-proof tests, and that is the
   module's idiom, not rot.
3. **`verify_catalog_chain`'s doc comment claimed to be "THE production entry point".** It is not;
   `advise` is. Rewritten.

Three non-defects are carried into the plan's **task 10**, which is the arming reviewer's checklist:
`block_on` in `ReqwestCaseHttp::get` (safe from a sync command thread, deadlocks from an async one,
uncalled today) · `catalog_version` u64 vs JS `number` · the dead-code guard's non-recursive
`readdirSync`, which can only misfire if `src-tauri/src` is ever split into subdirectories.

## Two gate traps this lane paid for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE that pairs the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts as "merge"** — fixing the first
  offender created the second, and then this very file tripped it twice more. Reword, never loosen
  (precedent PR #166). Run `node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs` **alone**
  before pushing: seconds, versus four minutes inside `.githooks/pre-push`.
  **UNEXPLAINED, so do not lean on a single green:** one such pre-push run reported 39/39 on a file
  that failed the identical assertion in the hook minutes later, with no edit in between. The
  behaviour did not reproduce afterwards — a true offender is caught both alone and batched — so
  treat the hook, not the hand-run, as the verdict.
- **`scripts/process-mutex-guard.test.mjs` flakes under full parallelism.** It failed once at a head
  that then passed unchanged; the same test passes 6/6 standalone. Commit `4a8dae40` already records
  this suite as one that starves the pool it joins. Re-run it alone before believing it — and record
  the re-run, do not waive the failure.

## THE NEXT STEP, exactly

Nothing is blocked and nothing is half-done. Pick one:

1. **Tier 1 plan tasks 8–9** — make crash rescue discoverable, and the persisted local incident
   observer. Cut a fresh lane off `main`; the plan file has both tasks written out.
2. **The three queued Tier 1 nits** in `docs/BACKLOG.md` PHASE C, all small and all real.
3. **Money-stack Phase 2** (`docs/RECEIPTS_DOCTRINE.md` §4, the `compy.gg` one-pager + waitlist) is
   **blocked on the owner registering the domain** — do not start it before that.

**Do NOT touch** plan tasks 10–11 (independent security review + arming). Owner territory, filed in
`docs/OWNER_ACTION_CHECKLIST.md` §C so that arming can never happen quietly.

**Before any UI work:** the owner's design vision lives in `docs/UI_VISION_BACKLOG.md`, whose
still-🔴 OPEN rows today are **DIR-1** (the standing intuitive-UI directive) and **§G** (the site).
Read those two rows there; do not re-queue a row from a paraphrase of them.

## Waiting on the owner — none of it blocks the next lane

- Register **`compy.gg`** (~$50/yr — money call). Blocks money-stack Phase 2, not started.
- Land or retire **`B_shelter`** (#128) — ~1,100 lines unpushed since 2026-08-18.
- The **Ko-fi URL** (B3a).
- Rule on the **Q9a consent screens** (built, reviewed, `receipts_gate()` still false).
- **#219** and **#204** — Compy Pro price shape.
- **#213's B half** — his ChatGPT room mockups. (A1, the `©ompy` wordmark, is already answered.)
- **Tier 1 arming** (§C) — signing-key custody, the catalog domain, and the arming itself, after an
  independent security review.
