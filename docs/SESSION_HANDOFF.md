# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-22, third pass — BACKLOG section caps

The row-cap pattern `0af86044` gave `RELEASE_STATE.md` now covers the other ledger that refills.
`docs/BACKLOG.md` was back at 99KB of a 100KB ceiling **four days** after a 106KB archive pass, for
the same structural reason: its three working queues are append-only, so every train adds a row and
no rule takes one out. The file budget could see the total but never WHICH queue grew, so its
failure text sent whoever hit it hunting.

- **`scripts/doc-budget.ps1`** — new `$sectionByteBudgets` table + check loop: NEXT UP 12544,
  Conformance queue 28160, HQ STEERING LOG 4608. Each is the section's post-archive size plus one
  row of room, measured **LF-normalized** (CRLF on Windows, LF on CI — one file must not measure two
  sizes). File byte budget ratcheted 102400 → 100352, which is the real size plus exactly the 3348
  bytes those caps still permit; a new test pins that arithmetic so neither number moves alone.
- **`scripts/doc-budget-guard.test.mjs`** — the JS mirror, caps PARSED from the `.ps1`, never
  restated. Falsified: one extra ~1.2KB steering-log cycle makes the section cap FAIL and the script
  exit 1 while the FILE budget still passes at 94.4KB/98KB. That gap is the whole point.
- **Archive pass** — 7 closed rows moved byte-for-byte to `BACKLOG_ARCHIVE.md` (`## 2026-08-22b`),
  nine "moved to archive" stubs collapsed into one pointer. 99KB → 93.2KB, 1031 → 984 lines. The
  seven phrases `capability-exception-policy-guard.test.ts` requires all survive the move.
- **The handoff's "next task" was stale.** `src-tauri/src/license.rs` is 380 finished lines of
  offline Ed25519 verify behind an all-zeros key, wired at `lib.rs:1195`, already recorded built-dark
  at `RELEASE_STATE.md:125`. What is left on Pro is the owner's entity + merchant-of-record errands
  and his call on which features sit behind it — not code.

## Cycle note — 2026-08-22, `lane/train-2026-08-22` (persistent train) — CLOSED, second pass

The train reopened on the owner's word: *"just do everything i trust you can make some executive
deceisions here yourself using your own reasoning skills / land 193 dude / i like the 4.99/39yr/89
lifetime / do everything yourself get it all done dont stop."* The three items the first pass had
handed back to him are now **two closed and one correctly left with another lane**.

## What landed

1. **Pricing has evidence behind it for the first time (`55ecb642`, `c796875b`).**
   [`docs/PRICING_RESEARCH.md`](PRICING_RESEARCH.md) is new: comparables, the repair-shop diagnostic
   anchor ($45–95 a visit — Compy is what happens *instead* of that trip), and the category's
   auto-renew reputation problem. **Finding: the repo's own `$3–4/mo · ~$25/yr` figure had no source
   and sat below the floor of every comparable.** The owner ruled the recommended band verbatim:
   **$4.99/mo · $39/yr · $89 one-time lifetime**, now recorded in
   [`RECEIPTS_DOCTRINE.md`](RECEIPTS_DOCTRINE.md) and [`MONETIZATION_PLAN.md`](MONETIZATION_PLAN.md).
   **Priced, not published** — the site stays price-free until Pro exists.
2. **PR [#193](https://github.com/Pootytxng/sentinel/pull/193) landed (`d5571766`).** It was never a
   pricing decision and should not have been on his list: it deletes the word "free" from
   `site/llms.txt` and names no price, using the vocabulary his own 2026-07-21 decree already
   dictated. Merged, branch deleted.
3. **C-14 — the finished GPU screen nobody could see is in the Lab (`b9ce8354`).** `GpuProfile` is
   mounted as an out-of-grid sibling in `LabGround`, between the Ops Console and the Experiment
   Bench — the idiom `ExperimentBench` already uses, chosen over a sixth `LabStationKey` so nothing
   rippled through `LAB_STATION_ORDER`, the palette, the intake router or the tests pinning the
   five-station spine. New `liveGpuProfileSnapshot()` feeds it real hardware; `powerModeLabel` and
   `peakTempC` stay **permanently null by design** (AMD profile state is not user-mode readable,
   peak temp belongs to a monitored session the Lab does not hold) and render as `—`, never as an
   invented value. Advisory forever under LOCKED rule 6. 8 honesty tests added.
4. **The #125 write refusal is ARMED (`d5a6a630`).** `project-write-assert.mjs` is registered in
   `.claude/settings.json` on `Write|Edit|NotebookEdit`; `Bash` stays deliberately out of the matcher
   as the escape hatch, and `tracked-hooks.test.mjs` now fails the build if it is ever added. Spec is
   ✅ COMPLETE, all five steps.
5. **Two of his "owner decisions" were not decisions at all.** **B_startup** was fixed 2026-08-03 —
   *one day after it was filed* — and sat on his list for twenty days because nobody closed the row,
   while `CLAUDE.md`'s always-loaded module map kept asserting the phantom mutation-boundary
   exception. Both corrected. **B_eu** and **B_gpu** were resolved under the executive mandate
   rather than parked. Five closed §D sign-offs archived to `archive/OWNER_ACTION_HISTORY.md`.
6. **Shipped to the desk.** `0.9.26` / stamp **`d5a6a630`**, installer SHA-256
   `AABCED03…0D2417`, one installer on the Desktop, `get_build_stamp()` = `"d5a6a630 · release"`.
   `self-review` **VERDICT: PASS** (11/11) — zero Windows writes across every interaction tested.

## What is left, and who owns it

**Nothing on the non-gated queue that is an agent's to move.**

- **Codex weekly automation → product-conformance scope** — the Codex lane's. Duplicating it here is
  the failure mode. This is the only open queue item.
- **Compy Pro itself is unbuilt.** The price is set; nothing is published anywhere until Pro exists.

**Recorded as closed but NOT solved** — read the rows before re-litigating: #121's cause stays
unattributable at 100 ms poll resolution (the harm is guarded instead), and #128's **release** mutex
has still never been held during a real publish.

## Live traps for whoever is next

1. **`.codex/config.toml` regresses every few days** — a red `codex-config-guard` in the push gate
   IS that abandoned regression: stash it, do not debug it.
2. **There is no "active but merged" lane state.** `branch-disposition-audit` treats `MERGED` as
   *prunable* and fails until the ref is deleted, while `UNLANDED` fails the moment a fast-forward
   makes the ref a no-op against `main`. A long train therefore cannot keep a lane ref alive: land
   fast-forward straight to `main` and carry no lane branch, which is what this train ended up doing.
3. **`docs/RELEASE_STATE.md`'s two build-identity rows are byte-capped** (`LINEAGE_ROW_CAPS`,
   `verify-release-state.mjs` check 5b). A ship that overflows one must move the OLDEST inline
   predecessor to `archive/RELEASE_STATE_HISTORY.md` — the failure text says so. Do not raise the
   budget to make room; it is derived from those caps. File is 251/270 lines, 40.3KB/42KB.
4. **Python patches with backslashes must be written to a FILE**, never piped through a Bash heredoc
   — the heredoc and the string literal each eat one layer.
5. **A `SESSION_FOREIGN` refusal cannot be adopted away.** `project-write-assert.mjs` routes
   unverified/lapsed sessions to `cli.mjs adopt`, but a lineage record that ACTIVELY disagrees
   falls to a third branch whose own comment says adoption would refuse too. Its first listed cure
   is the cheap one: **reopen the right folder** — a fresh worktree has no record, so it is not
   contended (`writer-contention.test.mjs`: "a Claude session in ANOTHER root is somebody else's
   business"). That is how this cycle got written. Do NOT route the write through Bash to dodge it.
6. **The primary worktree `C:/Users/Kuya/code/sentinel` may be stale.** `git -C ... merge --ff-only
   origin/main` before cutting anything there.

## Waiting on the owner

**Nothing blocking, and nothing newly urgent.** The checklist's remaining items are money/legal calls
that cannot move until Pro exists. The one thing he may want to *look* at: the new GPU panel in the
Lab room — reviewed and PASSed, but his veto on sight always stands.

**This session: done — archive it.** Tree clean, `main` carries every commit, his live app is
`d5a6a630`.
