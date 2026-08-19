# Session handoff — 2026-08-19 (the fleet moved: v0.9.26 published)

**Lane CLOSED.** `main` is at the release commit `5e64074c`, pushed, tree clean. Nothing is
half-finished and nothing is waiting on the owner.

## What happened

1. **PR [#141](https://github.com/Pootytxng/sentinel/pull/141) reviewed and merged** — real merge
   commit `85ed8065` (not a squash, so the branch stays an ancestor and its disposition row is a
   no-op). `docs/BRANCH_DISPOSITIONS.md` row flipped CLAIMED → MERGED in `da864d0e`.
   **The `origin/perf/idle-127-ambient-raster` ref was NOT pruned** — the `gh api -X DELETE` was
   denied by this session's permission layer, so the ref is still on origin and the row says so.
2. **The owner's fleet-move GO executed end to end.** **v0.9.26 published**, source `5e64074c`,
   release id `372920800`, published `2026-08-19T09:14:02Z`, transaction **9 of 9**, alias attempt 1
   in 3.7s. Installer SHA-256 `4b72d681…94e98`, manifest SHA-256 `c9d33470…48b1`, both byte-matching
   the signed receipt. Runtime-proved `5e64074c · release · shell 0.9.26` on attempt 1; one
   installer on the Desktop. **Desk and fleet are the same bytes again.**
3. **Four latent release-pipeline defects, found by the run and each fixed with a falsified guard.**
   Same class every time — the release `.ps1` files are executed by nothing in the suite, so
   production-only paths fail only in a real run, ~13 minutes at a time:
   - `5d21961a` — a staged receipt bound to an OLDER commit reported FAIL; it now reports PENDING,
     keyed on the receipt's own commit. Guard also pins the ordering (HEAD must resolve before the
     signature gate, or the branch is dead code).
   - `b8e31e67` — `Set-StrictMode -Version Latest` at **file scope** in a **dot-sourced** library
     made release.ps1 and ship-reinstall.ps1 strict for their whole run, and prove died reading an
     optional hook property. Strict mode now lives inside the library's functions; the guard
     dot-sources the library and probes the caller's scope.
   - `0e885823` — a powershell-spawning test must gate with `it.runIf(windows)`.
   - `b3e82e9b` — two guards timed out only at full parallelism (memoized corpus walk + real
     timeouts), reproduced twice before being called a defect, not a flake.
4. **The deferred preflight is delivered** (`ca741e0e` filed it, this train closed it):
   `release.ps1` now resolves the version it is about to cut **before** the expensive gates and
   refuses in seconds on a leftover local/remote tag or a `RELEASE_STATE.md` still naming the
   previous candidate — each message carries the exact command that clears it. The doc rule stays in
   one implementation: `node scripts/verify-release-state.mjs --stage-candidate <version>`.
   Guards: `release-pipeline-guard` (ordering) + `verify-release-state-guard` (detector), **both
   disarm-probed** (4 tests fail when the check is neutered).

## State

- `docs/RELEASE_STATE.md` stamped: published/owner-installed/manifest anchors all v0.9.26 at
  `5e64074c`, owner decision 1 CLOSED, the desk/fleet divergence prose retired.
  `node scripts/verify-release-state.mjs --strict` → 31 citations, 0 drift.
- `docs/BACKLOG.md` cycle **2026-08-19b**; cycle 2026-08-19a moved verbatim to
  `docs/BACKLOG_ARCHIVE.md` for the byte budget. `doc-budget.ps1` ALL PASS.
- This session started **without a launch token** (not started through `compy-entry.ps1`). Branch
  and folder were verified correct and no competing Work Control claim existed, so work proceeded;
  no claim was registered for it.

## Known, not chased here

- `ReticleCursor` writes a transform every frame while the pointer rests inside the window — a live
  idle cost, measured but not filed as an issue.
- #121 (in-process window raise under load) and #140 (CPU temp / PawnIO) are untouched and open.
- The fleet is offered v0.9.26; **what is offered is not what is taken** — no tester is known to
  have updated past 0.9.12, so this is a fourteen-number jump for whoever takes it.

## Next session

Take the next non-gated `[ ]` in `docs/BACKLOG.md`. Nothing from this lane carries forward.
