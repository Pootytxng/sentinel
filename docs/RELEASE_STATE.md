# RELEASE_STATE.md — Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md banners, RELEASE_QA.md, PACKAGING_SIGNING_PLAN.md,
> GATE_DECISIONS.md) disagrees with this file about *current state*, **this file wins** — fix the
> other doc. Created 2026-06-26 in response to an external source-level audit that flagged
> state/documentation drift as the project's #1 risk. Keep it current: update it in the SAME commit
> that flips any gate, arms any feature, or rebuilds the installer. Every row carries a `file:line`
> so it can be re-verified in seconds, never asserted from memory.

## Snapshot

| Field | Value |
|---|---|
| Git HEAD | `d8a122d` (branch `main`) |
| App version | `0.1.0` (`gg.compy.app`, `compy.exe`) |
| Current installer | `Compy_0.1.0_x64-setup.exe` SHA-256 `9944643C787E639A5673172617172742832BAE98DAB95ED97261E7B51C0A0D16` (built from `d8a122d`, 2026-06-26; everything in `B9814D22…` + a cross-link/disclosure intuitiveness pass: bare concepts across 10 surfaces now carry the existing Term/WhatsThis links — FPS/1%low/frametime/ETW/VRAM/BIOS/EXPO-XMP/MSI/polling/noise-floor/telemetry/SysMain/DiagTrack/Game-Mode + Learn superseded→clickable jump; supersedes `B9814D22…`) — **installed by Claude via the silent-reinstall law** (Desktop holds exactly one installer); live-verified: build stamp `d8a122d · release`, links render legibly + the in-label WhatsThis is click-safe (no toggle) |
| Frozen private-beta artifact | ref `16069fa` / `beta/private-beta-001` (the OLD verified unsigned private beta — a DIFFERENT risk profile from current `main`) |
| Last full installed-build QA | 2026-05-31 (frozen private-beta build). Current `main` adds live Gaming Mode + armed Phase-B mutations whose own live QA passed 2026-06-25/26, but `main` has **not** had a fresh full §6/§7 installed-build pass. |

## Gate matrix (verified at HEAD `2b42d0a`)

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:500` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **live reboot-while-active QA still owner-pending.** |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:1358` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. UI in `GamingMode.tsx`. |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:1424` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:163`, `lib.rs:679`, `Benchmark.tsx:174` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). **Module comment still says "NEXT / not shipped" — stale.** |
| **Leftovers restore** | **DARK** (`false`) | `restore_gate()` — `leftovers.rs:728` | Double-dark; detector is read-only, restore path refused + `#[cfg(test)]` bypass only. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:19` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:41` (all-zeros key `license.rs:31`); FE `pro.ts:14`, `entitlements.ts:14` | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:101`; all-zeros pubkey `remote_rules.rs:84` | Double-gated: `verify_chain` ALSO hard-fails on the placeholder key (`remote_rules.rs:235`). Ed25519 verify is real but never runs in shipped builds. |
| **Auto-updater** | **OFF / absent** | no `plugins`/`updater` block in `tauri.conf.json`; no updater dep in `Cargo.toml` | — |
| **Outbound network** | **NONE** | no `reqwest`/`ureq`/`hyper`/HTTP client in `Cargo.toml`; CSP `connect-src 'self' ipc:` | Verified-zero-outbound property holds while Receipts + remote-fetch stay dark. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`history.rs:620`→`actions::resolve_rollback`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned
  (`save_history_to` `history.rs:240`; test `save_is_an_atomic_swap_leaving_no_tmp` `history.rs:1737`).
- Elevation: relaunch `compy.exe --run-elevated <hex>` (windowless), 4-way honest UAC outcome
  attribution (`elevation_outcome` `actions.rs:701`). PowerShell token validators `ps_safe`/`ps_safe_squoted`.

## Release blockers

| Item | Status |
|---|---|
| Manual-mutation apply/rollback QA | **CLOSED** 2026-05-31 (owner sign-off) — `RELEASE_QA.md:3`. NOT an open blocker. |
| Private-beta functional blockers | **NONE** for the frozen `16069fa` build (`PACKAGING_SIGNING_PLAN.md:131`). Current `main` wants its own fresh installed-build QA if shipped. |
| Gaming Mode live reboot-while-active QA | **OPEN (owner)** — needs a physical reboot test before broad ship. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA license model + jurisdiction, PRIVACY) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Remote-rules semver + production key + CDN + staged rollout | **OPEN** — gates arming remote fetch (currently `version_in_range` is lexicographic, `remote_rules.rs:299`). |

## Required owner decisions (live)

1. **Beta artifact choice:** ship frozen `16069fa` (verified, older, no Gaming Mode / Phase-B) **vs.** current `main` (richer, needs a fresh full installed-build QA incl. Gaming Mode reboot test). No middle ground.
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).
