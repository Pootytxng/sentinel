# RELEASE_STATE.md — Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md banners, RELEASE_QA.md, PACKAGING_SIGNING_PLAN.md,
> GATE_DECISIONS.md) disagrees with this file about *current state*, **this file wins** — fix the
> other doc. Created 2026-06-26 in response to an external source-level audit that flagged
> state/documentation drift as the project's #1 risk. Keep it current: update it in the SAME commit
> that flips any gate, arms any feature, or rebuilds the installer. Every row carries a `file:line`
> so it can be re-verified in seconds, never asserted from memory.

## CURRENT STATE (authoritative — read this first)

This block intentionally separates source, public artifacts, the owner's installation, and tester
installations. A static hash names one reviewed point; live `HEAD` and `origin/main` must always be
derived with Git rather than copied from this document. Historical trains live in
`archive/RELEASE_STATE_HISTORY.md`.

| Identity | Current truth (verified 2026-07-22) | Evidence |
|---|---|---|
| **Reviewed source baseline** | `aa3c610` was synchronized with `origin/main` at audit time. This is a dated baseline, not a claim about the live pointer after later work. | `git fetch origin main` + `git rev-parse HEAD` + `git rev-parse origin/main` |
| **Owner's installed app** | **0.9.4**, embedded release stamp **`419ec81`**. Installed `compy.exe` SHA-256: `622C2E426DE46A94363BE652D69A56230F3A38E48243634B2CBB3E77C06C2BF6`. Windows Apps incorrectly still reports **0.9.1**; the binary is 0.9.4 but packaging metadata is stale. | Installed file version/hash/stamp + HKCU uninstall `DisplayVersion` (read-only) |
| **Public updater feed** | **v0.9.4** is latest. Installer: 4,925,798 bytes, SHA-256 `50DA57EA73E482C1293067A270DCD3F88064CC916D96964EB67AA33207ECB60F`. Installer + `latest.json` match GitHub's bytes and the updater signature verifies against Compy's pinned key. The installer is still Authenticode **NotSigned**. | GitHub release assets + `tauri.conf.json:73` updater key/endpoint |
| **Delivery route to the owner** | The machine has 0.9.4, but the claim that 0.9.3 self-updated to it is **unverified**. Available timestamps match the local reinstall path and GitHub showed zero v0.9.4 asset downloads at audit time. Do not call this updater-E2E proof. | Local process/file timestamps + GitHub asset counters; no preserved update transcript |
| **Tester installs** | **Unknown.** Six invitees were sent the verified 0.9.0 link. The public updater feed now exists, but no telemetry or owner report proves what any tester installed. | `BETA_DISTRIBUTION_RECORD.md`; no remote install inventory by design |

**Current release direction:** v0.9.4 is cryptographically valid, but do not send it as the new
tester baseline. The release pipeline is being hardened to stage first and publish only after clean
source, full verification, local installation proof, source push, and draft-asset hash verification
(`scripts/release.ps1:1`). The next tester candidate should be a clean **0.9.5 or later** produced by
that pipeline. Staging also refuses a passwordless updater key. Protecting the existing key is an
owner action; publishing/sending remains an owner action.

## Gate matrix

> **Restored 2026-07-22c.** The same-day diet (`f21c170`) cut this matrix and the Release-blockers
> section along with the history — the diet's job was history only; the live matrix is required
> content (CURRENT STATE row 3 and the bottom line both reference it). Restored from the pre-diet
> copy (`181be2a`) and **re-verified at source this date: all 10 gate functions re-read, every state
> unchanged** (no gate module was touched by any commit since `181be2a` — the deltas were docs +
> the fps/monitoring/sessions 0.9.1 feature train). `scripts/verify-release-state.mjs` now FAILS
> if this section, CURRENT STATE, or Release blockers is missing, or if the file carries zero
> `file:line` citations — the diet-cut class can't silently recur.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:518` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **GAMING_MODE_QA.md live checklist 10/10 PASSED 2026-07-14**. **Owner SIGNED OFF 2026-07-14** — F1 is field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2029` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. Session-start suspends and restores both ride the ONE batched elevation (T6/T6b). |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2102` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:170` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2251` | Built dark 2026-07-06. Command `remove_known_preload_app` refuses while dark; FE card renders nothing (test-pinned). Arming needs live remove→reinstall QA + Store links verified + owner-curated list + sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs:274` | Built dark 2026-07-09 (reuses audited `apply_recommendations_batch` — no new mutation primitive; multi-change Drop-guard rollback; corrupt-ledger read ABORTS pre-mutation). Commands refuse while dark; no FE surface. Arming needs live apply→rollback QA + owner sign-off. |
| **Experiment engine + simulator (Intelligence P3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:55` | Armed after owner sign-off + live apply→rollback round-trip on this rig. Orchestrates the audited mutation boundary — no new apply/rollback primitive; resolve stays history-only. Simulator reads the catalog READ-ONLY; unknown rec ⇒ honest insufficient-evidence. |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (all 3 loops PASS); receipts ride the Trust Ledger with provenance `leftover_adopted`. No FE caller yet. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key) | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) ALSO hard-fails on the placeholder key. Ed25519 verify is real but never runs in shipped builds. |
| **Auto-updater** | **LIVE** (2026-07-22, owner-directed) | `plugins.updater` — `tauri.conf.json:73` (pubkey `:74`, endpoints `:75`); `tauri-plugin-updater` — `Cargo.toml:37`; capability `capabilities/updater.json` (main window ONLY); fleet anchor `scripts/updater-trust-root.json` | Consent-first: check on launch + every 4h; NOTHING downloads until the user clicks Update now. Minisign-verified against the fleet-pinned pubkey before install; normal releases fail on trust-root drift and rotation requires the explicit bridge protocol in `docs/UPDATER_TRUST_ROOT.md`. An atomic restart barrier refuses updates while any live, pending, unreadable, temp, or quarantined Gaming Mode contract exists and prevents a new session during install. Private key remains outside the repo. The 0.9.2→0.9.3 path is operationally corroborated, but a durable before/click/process-replacement/after E2E receipt is still required for self-contained proof. |
| **Outbound network** | **ONE surface: signed update check/download** (2026-07-22, owner-directed) | `tauri-plugin-updater` (`Cargo.toml:37`) fetches the pinned endpoint (`tauri.conf.json:75`) Rust-side; **production CSP `connect-src` UNCHANGED** (`tauri.conf.json:46` — `'self' ipc: http://ipc.localhost`; no webview-reachable HTTP) | Supersedes the 2026-07-11 zero-outbound audit BY OWNER DECISION (the updater arming). Nothing else talks out: Receipts + remote-fetch stay dark; Export leaves only by the user's hand. The ShellV2 footer says: "Network: signed update checks; downloads only when you click." |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`history.rs:818`?`actions::resolve_rollback`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` — `history.rs:332`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  outcome attribution (`elevation_outcome` — `actions.rs:964`); the helper runs ONLY hex
  byte-matching the one-time dispatch ticket (`mint_elevation_ticket` — `actions.rs:1149` ·
  `consume_elevation_ticket` — `actions.rs:1171` · `run_elevated_helper` — `lib.rs:76`).
- Gaming-session advanced tier batches to ONE elevation per session start and per restore
  (T6/T6b; `apply_elevated_tier` — `gaming_orchestrator.rs:201`). No-partial abort+restore
  contract unchanged; UAC-decline drops only verifiably-never-ran staged entries
  (`elevation_error_nothing_ran` — `actions.rs:988`).

## Release blockers

| Item | Status |
|---|---|
| Private-beta functional blockers | **HOLD replacement send.** The v0.9.4 updater artifacts are valid, but release ordering, stale network/privacy copy, updater lifecycle cleanup, and installed-version metadata must be closed in a new clean candidate before it becomes the tester baseline. Existing tester install state remains unknown. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |

## Required owner decisions (live)

1. **Next updater-enabled tester send** — only after the hardened pipeline produces a clean staged
   0.9.5-or-later receipt and its verification report is reviewed. Publishing/sending is owner-only.
2. **Updater-key custody** — keep the private key out of Git; choose a protected offline backup and
   stronger custody before broader public scale.
3. Code-signing route + legal finalization (broad public-launch gates).
4. When/whether to arm Receipts (its own security review + owner sign-off).

## Snapshot history - MOVED to archive (2026-07-22)

The full reverse-chronological UPDATE-banner log (every dated banner, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). It had grown to 1,300+ lines of
pure history - explicitly superseded by CURRENT STATE above - re-read and re-cached by every session
that touched this file. APPEND new dated banners to the TOP of the archive; keep THIS file to CURRENT
STATE only (budget: 300 lines, enforced by scripts/doc-budget.ps1 - run it in every verify pass).
