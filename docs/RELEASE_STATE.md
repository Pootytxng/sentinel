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
| Git HEAD | `2c49ed0` + this docs commit (branch `main`, 2026-07-05) |
| App version | `0.1.0` (`gg.compy.app`, `compy.exe`) |
| Current installer | `Compy_0.1.0_x64-setup.exe` SHA-256 `BF563677942541BE83E727CF9CB0D326553E769A0A2A9FF4A50D677BA64E1A2A` (built from `2c49ed0`, 2026-07-05 — the **Lab linear guided bench train** (spec `docs/superpowers/specs/2026-07-05-lab-linear-guided-bench.md`, owner-approved full scope): `1b6a9de` `compy_lab_guided` flag (**DEFAULT OFF**, Settings → Appearance preview toggle) + flag-off byte-identity guard · `0a4cc04` numbered stations w/ the four-line contract in bench order (Diagnostics→Benchmark→Latency→Tuning→Black Box; line 3 pulls the SAME live value the instrument shows or an honest "No reading yet") · `5e80a41` "Which tool do I need?" symptom→station router (map test-pinned literally) · `815a39a` "Latest readings" strip removed on the flag-on path only · `42bbb15` "Walk the bench" read-only step-through (`compy_lab_walk_seen_v1` self-fold, re-openable) · `2c49ed0` label-wrap fix + self-review shots `docs/ui-sweep/shots/lab-guided/`. **Entirely frontend/docs — `git diff bb4b691..2c49ed0 -- src-tauri/` is empty.** Flag-on is the owner's eyeball-then-default-ON taste call (P-series contract); flag-off Lab is byte-identical (test-pinned). Verify: tsc exit 0 · vitest **985** · self-review 7 native shots. ✅ **Live-verified 2026-07-05 via the build STAMP:** `get_build_stamp` over CDP reads `2c49ed0 · release`; embedded `COMPY_GIT_HASH` grep confirms. **Installed by Claude + LIVE** — Desktop holds exactly one installer. Supersedes the V2 nits + glanceable-fill build (SHA `CF4D289A…`, built from `bb4b691`, 2026-07-05 — the **V2 nits + glanceable-fill pass** (spec `docs/superpowers/specs/2026-07-05-v2-nits-fill-pass.md`): `243cf88` honest no-op receipt copy (`Already <state> — no change needed`, both render paths, bug→guard-pinned) · `882b908` Home drift-watch + drive-health glance cards (measured-only, absent-safe) · `d78b0ec` Lab "Latest readings" foot strip (consolidated newest value per instrument, honest "—") · `bb4b691` self-review shots. **Entirely frontend/docs — `git diff 4e07420..bb4b691 -- src-tauri/` is empty.** Verify: tsc exit 0 · vitest 968 · self-review shots in `docs/ui-sweep/shots/v2-fill/`. ✅ **Live-verified 2026-07-05 via the build STAMP:** `get_build_stamp` over CDP reads `bb4b691 · release`. **Installed by Claude + LIVE** — Desktop holds exactly one installer. Supersedes the V2 product-shell train build (SHA `E1845A8D…`, built from `4e07420`, 2026-07-04 — the **V2 product-shell train**: `4e07420`→`d4419d4` (V2-1→V2-15) make the V2 room shell (`compy_v2`) the default build and drop the classic escape hatch — vendored React Bits kit + Geist + `tokens-v2`, RoomShell/ForwardDoor primitives, all five rooms (Home/Optimize/Monitor/Lab/Blackbook) re-skinned on RoomShell, section layering + hologram scale-to-fit + What's-this hover tooltip, plus the V2-13/14/15 nav-perf sweep (the last being the DecryptedText **decode-once** fix — the headline scramble no longer re-fires on room re-mount). **Entirely frontend/docs — `git diff 706094f..4e07420 -- src-tauri/` is empty**, so zero gate/mutation/IPC surface changed. Verify: tsc exit 0 · vitest 953 · cargo 659. ✅ **Live-verified 2026-07-04 via the build STAMP:** `get_build_stamp` over CDP reads `4e07420 · release`, and the installed exe's embedded `COMPY_GIT_HASH` is `4e07420` (baked via `env!("COMPY_GIT_HASH")`, `lib.rs`). Supersedes the **P4 dedup + named-drift-copy build** (SHA `4C0C69D8…`, built from `706094f`, 2026-07-02; full P4-build detail in `docs/CHANGELOG.md` + git). **Installed by Claude + LIVE** — Desktop holds exactly one installer. |
| Frozen private-beta artifact | ref `16069fa` / `beta/private-beta-001` (the OLD verified unsigned private beta — a DIFFERENT risk profile from current `main`) |
| Last full installed-build QA | 2026-05-31 (frozen private-beta build). Current `main` adds live Gaming Mode + armed Phase-B mutations whose own live QA passed 2026-06-25/26, but `main` has **not** had a fresh full §6/§7 installed-build pass. |

## Gate matrix (re-verified at HEAD `733f132`, 2026-07-02 — every gate function re-read at source; states unchanged since `9463c10`. Still current at `4e07420` (2026-07-04): the V2 product-shell train `706094f..4e07420` (V2-1→V2-15) is **entirely frontend/docs — `git diff 706094f..4e07420 -- src-tauri/` is empty**, so no gate function, mutation/rollback path, or IPC/capability surface changed. Before that, `706094f`'s sole src-tauri change was readiness drift-reason copy + a read-only `drifted_titles` summary field (`readiness.rs` / `history.rs`; diff-verified: no gate moved))

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:500` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **live reboot-while-active QA still owner-pending.** |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:1350` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. UI in `GamingMode.tsx`. |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:1421` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:163`, `lib.rs:679`, `Benchmark.tsx:174` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Leftovers restore** | **DARK** (`false`) | `restore_gate()` — `leftovers.rs:727` | Double-dark; detector is read-only, restore path refused + `#[cfg(test)]` bypass only. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key); FE `pro.ts:14`, `entitlements.ts:14` | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:96`; all-zeros pubkey `remote_rules.rs:84` | Double-gated: `verify_chain` ALSO hard-fails on the placeholder key (`remote_rules.rs:235`). Ed25519 verify is real but never runs in shipped builds. |
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
