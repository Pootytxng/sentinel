---
name: ship
description: >-
  Use immediately after ANY successful `npm run tauri build` — before claiming a build is shipped,
  installed, live, or "on the Desktop". Triggers: a tauri build just completed; owner asks to try/see
  the new build; about to report a UI/feature train as live. The owner NEVER runs an installer and
  never has more than ONE installer on his Desktop — reinstalling is Claude's job (standing LAW
  2026-06-26, memory: silent-reinstall-is-my-job).
---

# Ship — build → silent reinstall → stamp-proof → doc row

"Built" is not "shipped". A build the owner has to install himself, or that silently bundles a stale
exe, violates two standing laws. This skill is the whole path from green build to "live and proven".

## Steps (in order, none optional)

1. **Build green first.** `npm run tauri build` completed without error; tsc/vitest/cargo already
   verified per the train's own gates.
2. **Run the ship script — `pwsh` (PS7), NEVER `powershell` (5.1):** the script is UTF-8 without a
   BOM and 5.1 mis-decodes its em-dashes into hard parse errors (hit live 2026-07-07; same class as
   dev-relaunch.ps1):

   ```
   pwsh -NoProfile -File "C:\Users\Kuya\code\sentinel\scripts\ship-reinstall.ps1"
   ```

   Append ` -NoLaunch` only when the owner shouldn't get a window popped.
   The script enforces, in order: **stale-build gate** (packaged exe must embed HEAD's short hash —
   cargo skips recompile on frontend/docs-only chains and re-bundles the PREVIOUS binary; on throw,
   run `cargo clean -p compy --release --manifest-path src-tauri/Cargo.toml` then rebuild) →
   graceful close of running Compy → Desktop hygiene (delete every Compy installer, stage ONLY the
   new NSIS) → silent `/S` per-user install → launch.
3. **Prove live == build via the STAMP, never an exe hash.** The installed exe is not byte-identical
   to `target/release/compy.exe` (NSIS packaging). Verify `get_build_stamp` over a CDP port returns
   `<HEAD-short> · release`, or at minimum `Select-String <HEAD-short>` on the installed exe. No
   stamp proof = no "live" claim.
4. **RELEASE_STATE.md Snapshot row, SAME commit as the ship's docs:** new installer SHA-256 (the
   script prints it) · built-from commit · verify line · "Installed by Claude + LIVE" + supersedes
   note. This is the doc-sync law; a ship without a row is drift by construction.
5. **Report to the owner in his format:**
   > your live app is now `<commit>`, one installer on the Desktop, nothing for you to do.

   His ONLY job is the eyeball — does it feel/look right. Never hand him an install step.

## Red flags

- Reporting "built successfully" and stopping → the law is reinstall, not build.
- Skipping the stamp check because "the build just ran" → that exact assumption shipped a stale
  `6b2f46f` exe at `b52adb3`; the gate exists because it happened.
- Two installers on the Desktop → hygiene step failed; fix before reporting.
- UI train shipped without a quoted self-review PASS → wrong skill order; that verdict comes first.
