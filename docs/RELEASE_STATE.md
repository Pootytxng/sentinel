# RELEASE_STATE.md ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md, GATE_DECISIONS.md, OWNER_ACTION_CHECKLIST.md) disagrees
> with this file about *current state*, **this file wins** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â fix the other doc. Created 2026-06-26
> after an external audit named state/doc drift the project's #1 risk. Keep it current: update the
> rows below in the SAME commit that flips a gate, arms a feature, or cuts a release. Every gate row
> carries a `file:line` for re-verification. The CURRENT STATE table carries machine-readable
> `<!-- STATE:ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ -->` anchors that `scripts/verify-release-state.mjs` enforces against live source:
> app-version drift, a stacked banner, an undisclosed public endpoint, a stale owner decision, or a
> second bottom-line section all FAIL the gate.

## CURRENT STATE (authoritative ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â read this first)

> **One table. No banner stack.** The dated per-train banners that used to live here are a LOG, not
> state ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â they live in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). Do NOT
> stack a new banner on this file; update the rows below in place. Static commit hashes name fixed
> points in history; the *live* `main` pointer is whatever `git rev-parse HEAD` returns at read time.

<!-- STATE:source_main_commit=cff77ab -->
<!-- STATE:latest_release_version=0.9.7 -->
<!-- STATE:latest_release_commit=1d9bad6 -->
<!-- STATE:owner_installed_version=0.9.7 -->
<!-- STATE:owner_installed_stamp=1d9bad6 -->
<!-- STATE:manifest_version=0.9.7 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` commit** | `cff77ab` at last write (the hardening-reconciliation train). A dated marker, not the live pointer. | `git rev-parse HEAD` Ãƒâ€šÃ‚Â· `git fetch && git rev-list --left-right --count origin/main...HEAD` |
| **Latest released version + source commit** | **v0.9.7**, source `1d9bad6` (tag `v0.9.7` on `Pootytxng/compy-releases`). | `gh release list --repo Pootytxng/compy-releases`; tag ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ commit |
| **Owner-installed version + embedded stamp** | **0.9.7**, embedded stamp **`1d9bad6`**. Registry `DisplayVersion` 0.9.7; exe `ProductVersion` 0.9.7. Arrived via the in-app updater (0.9.4ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢0.9.5ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢0.9.6ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢0.9.7, CDP-witnessed this session ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the running exe's stamp changed after an in-app "Update now" click with NO reinstall run between). | `Select-String compy.exe <shorthash>` + HKCU uninstall `DisplayVersion` (read-only) |
| **Latest updater manifest version** | **v0.9.7** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `latest.json` at `releases/latest/download/` names the v0.9.7 asset; signature verifies against the pinned minisign key; installer + `latest.json` match GitHub's bytes. | unauthenticated fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Tester-distributed version** | **0.9.0** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the `37a166c` NSIS (SHA-256 `6BC2F7DFÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦F5A2C4`) is what the six invitees were sent (Drive link). **NO updater-enabled build has been sent to any tester** (owner hold). | `BETA_DISTRIBUTION_RECORD.md` |
| **Known tester installation state** | **UNKNOWN.** No telemetry, no remote inventory by design. Six invitees hold the 0.9.0 link; what each actually installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the updater pipeline is live and the owner's box self-updates through it (on 0.9.7 now ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â four consecutive versions witnessed). The releases repo is **public**, so installers are downloadable by anyone with the URL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â "zero public artifact" is retired; what stays private is the **source**. Nothing newer than the 0.9.0 kit has been **sent** to a tester ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the next tester artifact is the hardened **v0.9.8** candidate, single-tester canary first. Public/store release stays blocked on **Code signing + Legal**.

## Gate matrix

> `scripts/verify-release-state.mjs` FAILS if this section, CURRENT STATE, or Release blockers is
> missing, or if the file carries zero `file:line` citations ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the f21c170 diet-cut class (a doc
> trim silently gutting the live matrix) can't recur silently.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `lib.rs:518` | Flipped 2026-06-18 w/ owner sign-off. Ãƒâ€šÃ‚Â§7 QA harness passed; **GAMING_MODE_QA.md 10/10 PASSED 2026-07-14**; **owner SIGNED OFF 2026-07-14** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actions.rs:2029` | Armed 2026-06-25. Live exact-restore + UAC-cancel=no-partial + critical-service block proven. Session start/restore ride the ONE batched elevation (T6/T6b). |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actions.rs:2102` | Armed 2026-06-26. Live exact disableÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢enable restore + off-list/Defender rejected. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `benchmark_trial.rs:170` | REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal** | **DARK** (`false`) | `preload_removal_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actions.rs:2251` | Built dark 2026-07-06. Command refuses while dark; FE renders nothing. Arming needs live removeÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢reinstall QA + owner sign-off. |
| **Aggregate-stack A/B trial (Ãƒâ€šÃ‚Â§2a)** | **DARK** (`false`) | `stack_trial_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `benchmark_trial.rs:274` | Built dark 2026-07-09 (reuses audited batch path; multi-change Drop-guard rollback; corrupt-ledger read ABORTS pre-mutation). No FE surface. |
| **Experiment engine + simulator (Intelligence P3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `experiment.rs:55` | Armed after owner sign-off + live applyÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢rollback round-trip. No new mutation primitive; resolve stays history-only; simulator reads catalog READ-ONLY. |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `leftovers.rs:730` | Armed after owner-present live-UAC QA (3 loops PASS); receipts ride the Trust Ledger (`leftover_adopted`). |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `receipts.rs:18` | No send path/endpoint/queue; preview refuses. Arming = its own security review + owner sign-off. |
| **License / Pro enforcement** | **DISARMED ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â nothing enforced** | `licensing_armed()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `license.rs:40` (all-zeros key) | Plumbing wired but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) hard-fails on the placeholder key. Never runs in shipped builds. |
| **Auto-updater** | **LIVE** (2026-07-22, owner-directed) | `plugins.updater` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `tauri.conf.json:73` (pubkey `:75`, endpoints `:76`); `tauri-plugin-updater` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `Cargo.toml:37`; capability `capabilities/updater.json` (main window ONLY, `updater:allow-check` + `allow-download-and-install`) | Consent-first: check on launch + every 4h; nothing downloads until the user clicks Update now. Minisign-verified against the pinned key before install; private key outside the repo. **E2E-witnessed 0.9.4ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢0.9.7 this session** (CDP stamp transitions, no reinstall between); GitHub asset counters corroborate. |
| **Outbound network** | **ONE surface: signed update check/download** (2026-07-22) | `tauri-plugin-updater` (`Cargo.toml:37`) fetches the pinned endpoint (`tauri.conf.json:76`) Rust-side; **production CSP `connect-src` UNCHANGED** (`tauri.conf.json:47` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `'self' ipc:`; no webview-reachable HTTP) | Supersedes the 2026-07-11 zero-outbound audit BY OWNER DECISION. Receipts + remote-fetch stay dark; Export leaves only by the user's hand. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver Ãƒâ€šÃ‚Â· no game injection Ãƒâ€šÃ‚Â· rollback-first Ãƒâ€šÃ‚Â· typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`actions::resolve_rollback` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `history.rs:818`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `history.rs:332`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  attribution (`elevation_outcome` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actions.rs:964`); helper runs ONLY hex byte-matching the
  one-time ticket (`mint_elevation_ticket` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actions.rs:1149`).
- Gaming-session advanced tier batches to ONE elevation per session start and per restore
  (`apply_elevated_tier` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `gaming_orchestrator.rs:201`); no-partial abort+restore contract;
  UAC-decline drops only verifiably-never-ran staged entries (`elevation_error_nothing_ran` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actions.rs:988`).

## Release blockers

| Item | Status |
|---|---|
| Private-beta functional blockers | **NONE** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Gaming Mode signed off; installed-build QA + runtime closure done; the updater path is live and owner-proven. The next tester artifact is the hardened **v0.9.8** candidate (single-tester canary before any wider send). |
| Code signing | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â gates arming the Ãƒâ€šÃ‚Â§2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â gates arming remote fetch. |

## Required owner decisions (live)

1. **v0.9.8 candidate GO/NO-GO** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â approve the verified, unpublished v0.9.8 candidate for publish
   (publish = owner action, via `scripts/release-publish.ps1`).
2. **Single-tester canary** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â after publish + the owner-box updater proof, choose the ONE tester to
   receive the updater-enabled build first; expand to the rest only after that tester completes the
   core path.
3. Code-signing route + legal finalization (PUBLIC gates).
4. When/whether to arm Receipts (its own security review + owner sign-off).

## Snapshot history ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â in archive

The full reverse-chronological banner log (every dated train, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). APPEND new dated banners to the
TOP of the archive; keep THIS file to CURRENT STATE only (budget: 300 lines, `scripts/doc-budget.ps1`).
