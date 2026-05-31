# CLAUDE.md — Sentinel project brief & resume point

> **This file auto-loads into every Claude Code session opened in this repo.** It is the
> durable, in-git, portable source of truth — independent of Claude's local `~/.claude`
> memory (which is pinned to one machine + one launch path and may not load). If you are a
> fresh session: read this top-to-bottom, then `docs/RELEASE_QA.md` for the live QA pass.
> Treat file/line claims as point-in-time — verify against current code before asserting.

## What Sentinel is

An all-in-one PC optimization & **safety** dashboard for the everyday, **non-technical gamer**
(not sysadmins). Positioned as *"a rollback-first Windows configuration safety layer that
happens to optimize."* Core differentiator: **hardware-aware, per-rig** recommendations —
it reads the actual PC and tailors safe settings to it, instead of generic YouTube/Reddit
"best tweaks" that break things. UX promise: plain-English "for YOUR hardware" framing,
safe + reversible by default, rollback over raw control. No jargon, no regkey dumps.

## Who the owner is (collaboration style)

Owner is **Kuya** — product owner / driver, thinks like a *user*, not a deep-systems
engineer. Casual, low-ceremony tone; explain decisions in terms of **user impact**, not
internals. Recommend a default rather than dumping options. Keep momentum. He values
**direct proof over inference** (e.g. demanded a real token-IL query, not parent-process
assumption) and rollback-correctness as non-negotiable. Never invent/assume hardware specs.

## Stack & where things live

- **Tauri 2** desktop app: Rust core (`src-tauri/`) + React/TypeScript frontend (`src/`).
- **Single source of truth: `C:\Users\Kuya\code\sentinel\`** (Windows-side). The old
  `\\wsl.localhost\...\var\www\sentinel` WSL/FastAPI scaffold is **superseded/stale** — do
  not use it. WSL is not needed (and breaks anti-cheat via Hyper-V).
- GitHub remote: `Pootytxng/sentinel`, branch `main`.
- Dev loop: `npm run tauri dev` (from repo root). Tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
  Fresh shells may need `export PATH="$HOME/.cargo/bin:$PATH"`. Git CRLF warnings are benign.
- Runtime data: Trust Ledger at `%APPDATA%\Sentinel\history.json` (Roaming); FPS IPC +
  `launch-debug.log` (debug only) at `%LOCALAPPDATA%\Sentinel\` (Local).

### Rust module map (post-refactor — `lib.rs` carved into safety-boundary modules)

- `lib.rs` (~496 lines) — `run()` wiring + command registration, 13 state probes, `sentinel_data_dir`, startup-apps, `safety_tests`.
- `actions.rs` — the ONLY Windows-mutation + rollback boundary: typed `AppliedAction`/`RollbackAction`/`Snapshot`, all `apply_*`/`rollback_*_typed`, `dispatch_rollback`, `resolve_rollback`, `synthesize_legacy_rollback`, `run_elevated_powershell`.
- `history.rs` — Trust Ledger: `AppliedChange`, persistence (`load/save_history`), `apply_recommendation`/`rollback_change`/`get_applied_changes`. Rollback resolves from local history alone.
- `recommendations.rs`, `hardware.rs`, `monitoring.rs`, `diagnostics.rs`, `fps.rs`, `remote_rules.rs`.
- `main.rs` — if argv has `--fps-capture`, run the headless ETW helper (`run_fps_capture`) and return BEFORE any window; else `run()`.

## LOCKED safety rules — do not cross without an explicit product-owner decision

1. **No kernel driver.** Consequence: **no CPU temperature** (proven impossible in user-mode on this machine — do not re-investigate). GPU temp is fine (vendor SDK).
2. **No game injection.** Anti-cheat-safe. FPS/frametime via ETW (DXGI present events) in an elevated helper; GPU sensors via vendor libs (AMD ADLX / NVIDIA NVML). Overlay only draws over borderless/windowed, not exclusive fullscreen.
3. **Rollback-first integrity.** Apply captures the full typed rollback contract + snapshot at apply time; rollback resolves from `history.json` ALONE (never the live catalog), so a removed/deprecated rec stays undoable. Never apply a change you can't roll back.
4. **Signed remote rules — triple-gated OFF.** Real Ed25519 verify is wired (`ed25519-compact`), but remote fetch stays disabled (placeholder all-zeros pubkey, `remote_fetch_enabled()==false`, no CDN URL) until production signing + CDN + staged rollout exist. **The Ed25519 private key NEVER lives in the repo** (not commits, .env, CI, or unencrypted home). **Unsigned remote rules must never ship, even in beta.**
5. **GPU vendor honesty:** AMD = **verified**; NVIDIA = **"implemented, not yet hardware-verified"**; Intel = planned. Do not silently upgrade NVIDIA confidence.
6. **Catalog is frozen (~29 recs).** No new recommendations without a load-bearing reason (PRD §2.5 ceiling ~25–30). No new monitoring features, no overlay transparency, no design-system pass until QA blockers are cleared.

## Dev machine (for hardware-specific work)

Fully **AMD**: **Radeon RX 9070 XT (RDNA4)** GPU, Ryzen X3D-class CPU, 16 logical cores
(~5.1 GHz), ~29.4 GB RAM. **Build & test the AMD path first** — NVIDIA is unverifiable here.
**UAC:** was disabled (`EnableLUA=0`) during early dev; **re-enabled to `1` and rebooted on
2026-05-30** so the `runas` elevation path can be tested. `uac_disabled()` now returns false →
the real `runas` branch is live (not the direct-spawn fallback). To revert: set `EnableLUA=0` + reboot.

## CURRENT STATE — Release-gate QA (as of 2026-05-30, last commit `b1f4366`)

Structural refactor is **complete** — stop module carving; remaining work is feature/QA.
`cargo test` **44/44**, `cargo build` zero warnings, `npm run build` clean.

Recent commits (newest first):
- `b1f4366` fix(monitoring): launch elevated FPS helper hidden (`.show(false)`/SW_HIDE) under UAC
- `c086f34` docs: release-gate manual QA checklist (`docs/RELEASE_QA.md`)
- `070c3c9` fix(actions): roll back power settings to the exact stored plan GUID (not SCHEME_CURRENT)
- `82bcd8f` test(actions): rollback resolution / legacy-synthesis regression tests
- `85e2710` refactor(history): extract Trust Ledger into its own module

**QA progress (`docs/RELEASE_QA.md` is the live checklist):**
- §1 FPS-helper elevation under UAC: **PASS** (prompt → accept → helper runs headless at
  High IL, main stays Medium, only one window, live capture confirmed). Fixed via `b1f4366`.
- **OPEN — §1 cancel-message finding:** on UAC *cancel*, the `runas` path reports generic
  `"stopped"`, not a distinct `"declined"` — because the `runas` crate always returns `Ok`
  on Windows (the `Err(_) => "declined"` branch is dead). Safe (no orphan, no fake-enabled),
  but doesn't meet the "clear cancellation message" bar. Proposed 3-line fix: match on
  `Ok(s) if s.success()` → "stopped", else "declined". **Decision pending: apply or defer.**
- **TODO §1:** subtest 2 (elevated apply accept — use `sysmain-disable`, baseline Manual→Disabled),
  subtest 3 (elevated apply cancel — use `diagtrack-disable`), subtest 4 (rollback `sysmain-disable`).
- **Next gate after §1:** §2a power-plan rollback fidelity (verify `070c3c9` directly), then the
  rest of the checklist, then packaging — **packaging is blocked until §1 + §2a pass.**
- Packaging-prep findings already logged: placeholder identifier `com.sentinel.app`, lowercase
  `productName`, no publisher/copyright/license, no code-signing config, `csp: null`, no EULA/privacy text.

**Caveat:** all QA so far is in the **dev (debug)** build. The helper-window issue was
debug-only (console subsystem); a packaged **release** build still warrants a final pass.

## How to resume

1. Read `docs/RELEASE_QA.md` — the checklist with per-subtest expected before/after.
2. Continue the §1 cancel-fix decision, then subtests 2–4, then §2a.
3. I (Claude) verify GUI behavior via the backend: live process/IL queries, `history.json`,
   real Windows service/power state, and `%LOCALAPPDATA%\Sentinel\launch-debug.log`.
4. Commit after each verified unit. Branch is `main`; push only when asked.
