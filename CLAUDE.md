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
6. **Tweak catalog is frozen (~29 recs)** — no new *risky tweaks*. Hard "optimizer-rot" blocklist (do NOT add): timer/HPET hacks, bcdedit, MMCSS, NIC-offload packs, core parking, Defender disable, MPO disable, fixed pagefile, TCP mega-packs, AI-generated/arbitrary actions. **This is catalog discipline, NOT a feature freeze.** Product value grows *upward* (gaming readiness, monitoring, session summaries, priority ranking, export), not sideways into more switches — see `docs/PRODUCT_DIRECTION.md`. Any new feature must be **read-only / advisory / reversible / session-scoped** until proven safe; the only mutating one planned (Gaming Mode) rides the manual-mutation QA blocker + full rollback contract.

## Dev machine (for hardware-specific work)

Fully **AMD**: **Radeon RX 9070 XT (RDNA4)** GPU, Ryzen X3D-class CPU, 16 logical cores
(~5.1 GHz), ~29.4 GB RAM. **Build & test the AMD path first** — NVIDIA is unverifiable here.
**UAC:** was disabled (`EnableLUA=0`) during early dev; **re-enabled to `1` and rebooted on
2026-05-30** so the `runas` elevation path can be tested. `uac_disabled()` now returns false →
the real `runas` branch is live (not the direct-spawn fallback). To revert: set `EnableLUA=0` + reboot.

## CURRENT STATE — Release-gate QA + first upward feature (as of 2026-05-31)

Structural refactor is **complete** — stop module carving; remaining work is feature/QA.
`cargo test` **49/49**, `cargo build` zero warnings, `npm run build` clean. Pushed to GitHub
(`origin/main` in sync).

**F2 Per-game Readiness — SHIPPED** (read-only, no gate, per `docs/PRODUCT_DIRECTION.md`):
new `readiness.rs` module + `get_game_readiness` command + "Readiness" tab. Pure
`evaluate_readiness` (8 checks: monitor refresh, install drive, GPU driver age, VRR-advisory,
HDR-advisory, power profile, FPS-monitoring readiness, applied-changes) composes existing
detection only — mutates nothing. 5 unit tests. Next read-only upward features per the plan:
F3 session summary → F5 export → F4 priority ranking; F1 Gaming Mode (mutating) stays behind
the QA blocker.

Recent commits (newest first):
- `(F2)` feat(readiness): per-game Game Readiness surface (read-only/advisory)
- `8dda3de` fix(monitoring): report UAC-cancelled FPS elevation as "declined" (not "stopped")
- `4a94d75` docs: add CLAUDE.md (this file) — portable in-repo failsafe
- `b1f4366` fix(monitoring): launch elevated FPS helper hidden (`.show(false)`/SW_HIDE) under UAC
- `070c3c9` fix(actions): roll back power settings to the exact stored plan GUID (not SCHEME_CURRENT)
- `82bcd8f` test(actions): rollback resolution / legacy-synthesis regression tests
- `85e2710` refactor(history): extract Trust Ledger into its own module

### 🚧 RELEASE BLOCKERS — do NOT treat the app as beta/release-ready until closed

1. **BLOCKER — manual apply/rollback verification for ALL safe appliable recommendations.**
   Automated tests prove the rollback *contracts* + safety wiring; they do NOT replace real
   Windows mutation verification. For each safe appliable rec, on a UAC-enabled machine:
   apply succeeds · rollback restores the EXACT prior state · Trust Ledger entry correct ·
   persists across app restart · external-revert detection honest · truth strip updates.
   Tracked in `docs/RELEASE_QA.md` §2/§2a/§3/§4. **Status: NOT STARTED for real mutations** —
   §1 elevation *plumbing* passed, but no actual tweak has been apply→rollback verified yet.
2. Packaging readiness is also gated on §2a (power-plan rollback fidelity) verified live.

**§1 QA progress (`docs/RELEASE_QA.md`):**
- FPS-helper elevation under UAC — **PASS** both paths: accept (`b1f4366` — helper runs headless
  at High IL, main Medium, one window, live capture) and cancel (`8dda3de` — shows "declined",
  spawns nothing, no orphan).
- **NOT YET DONE (the BLOCKER):** §1 subtests 2–4 (real elevated apply-accept / apply-cancel /
  rollback) and §2a power-plan fidelity.

**Allowed now (non-mutating release-prep ONLY):** packaging prep / installer metadata,
privacy policy / EULA, docs cleanup, visual/design pass, NVIDIA validation *planning*,
remote-fetch *planning* (NOT enabling). **Not allowed yet:** public beta, declaring packaging
release-ready, signing/distribution, remote-fetch enablement, new tweak-catalog expansion,
major architecture churn.

Packaging metadata DONE (identity, not signing): `productName` "Sentinel", identifier
`io.github.pootytxng.sentinel`, publisher/copyright "Pootytxng", category Utility, homepage,
short/long description in `tauri.conf.json` (schema-validated). Privacy + EULA drafted with
identity filled: `docs/PRIVACY.md`, `docs/EULA.md` (still DRAFTS — owner/legal review needed).
Remaining packaging gaps (NOT done, intentionally): no code-signing config, `csp: null`,
EULA license-model + governing-law TBD before public distribution.

**Caveat:** all QA so far is in the **dev (debug)** build. The helper-window issue was
debug-only (console subsystem); a packaged **release** build still warrants a final pass.

## How to resume

1. Read `docs/RELEASE_QA.md` — the checklist with per-subtest expected before/after.
2. Resume the BLOCKER: §1 subtests 2–4 (real elevated apply/rollback), then §2a.
3. I (Claude) verify GUI behavior via the backend: live process/IL queries, `history.json`,
   real Windows service/power state, and `%LOCALAPPDATA%\Sentinel\launch-debug.log`.
4. Commit after each verified unit. Branch is `main`; push only when asked.
