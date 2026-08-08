# Session Handoff

> Current lane only. Replace rather than append. Keep under 120 lines.

## Lane

Rig Evidence Map product-only replacement for PR #89 under issue #49.

- Writer: Codex desktop, sole active implementation writer
- Checkout: `C:\Users\Kuya\Documents\Codex\2026-08-08\referenced-chatgpt-conversation-this-is-an\work\sentinel-rig-evidence-clean`
- Branch: `agent/rig-evidence-map-clean`
- Base: `origin/main` at `a53d77953b1ab28361d248fbd7a82d31a47ea57f`
- Work Control: issue #49, Status Active, Lane Codex, Gate None

## What this lane is doing

Replace PR #89 with a clean branch that preserves the exact selected rig-part identity through the
evidence panel. A selected second GPU or second drive must never show the first device's readings.
Only Rig Evidence Map product code, i18n, tests, and required lane tracking records belong here.

## Done so far

- Re-derived current main, PR #89, repository rules, worktree state, and claim ownership.
- Preserved the dirty Task #12 checkout and all parked recovery/design branches.
- Created this isolated checkout from current `origin/main`.
- Transplanted 14 product/test files byte-for-byte from reviewed PR #89 head `93c931a3`.
- Excluded every PR #89 CI workflow, CI budget, local verifier, package-script, and lockfile change.
- Ran the focused Rig Evidence Map, rig, raycast/reachability, and idle-motion guards: 12 files,
  103 tests passed.
- Production build passed: TypeScript plus Vite, 7,500 modules transformed.
- Site staging passed under a temporary path-preservation overlay required only by the Codex sandbox;
  the overlay was removed and is not part of the branch.
- Broad non-host-dependent Vitest run passed: 299 files, 3,787 tests passed, 5 skipped.
- Full Vitest inventory ran: 3,812 passed, 88 failed, 5 skipped. All 88 failures are confined to six
  PowerShell-driven adapter/release files because this sandbox disables script execution. Two site
  suites could not collect under the physical path; the same site staging command passed separately.
- Rust inventory ran: 911 passed and 11 host-state tests failed because the sandbox cannot write the
  app ledger/elevation-ticket locations. With only those 11 access-denied cases filtered, 911 passed.
- Clippy passed with warnings denied. `git diff --check` passed. Encoding guard reported 1,237
  tracked text files clean. Branch disposition audit reported internal consistency; remote coverage
  remains partial until the new ref exists locally.

## Left to do

- Commit intentionally, push the branch, and open a draft replacement PR.
- Re-run branch disposition audit with the remote ref visible.
- Move issue #49 to owner review and close PR #89 only after the draft replacement proof exists.
- Before merge, rerun exact unfiltered `npm test` and `cargo test` outside the Codex sandbox.

## Do NOT

- Do not merge, release, deploy, or publish.
- Do not edit `main` directly.
- Do not bring over PR #89's CI infrastructure or verifier changes.
- Do not touch `feat/user-feedback-lab-recovery`, `design/quiet-pit-wall`, or the Task #12 files.

## Resume with

Recheck branch, HEAD, status, issue #49 ownership, and the 16-file scope before writing. Commit the
verified product-only diff, push, open the draft replacement PR, rerun the branch audit with the
remote ref visible, then record the final SHA and the no-ship-until-unsandboxed-gates verdict.
