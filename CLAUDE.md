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

> **⚠️ DOCS-vs-`main` DRIFT — noted 2026-06-01.** The "CURRENT STATE" notes below describe the
> repo **as of the `private-beta-001` freeze (`16069fa`)**. **`main` (HEAD `d049d63`) is now 13
> commits PAST the freeze** — a clean linear descendant (the freeze commit's child is `97a29e1`;
> beta refs remain pinned at `16069fa` and were NOT moved). Two of those commits are docs; the
> other **11 are a premium UI/UX layer that is NOT part of `private-beta-001` and has NOT been
> QA'd**: command-center hero + design-system foundation, command rail + consolidated Optimize,
> live theme system + picker ("Surprise" randomizer), "Tune Level" evolution (Stock→Apex),
> app-wide evolution + Garage tab, persisted unlocks, and a **Guided (advisory)** settings section
> with **safe deep-link buttons**. The ONLY backend change in this layer is
> `capabilities/default.json`: a **scoped** `opener:allow-open-url` allowlist of exactly three
> `ms-settings:` URIs (`display-advanced`, `display-advancedgraphics`, `storagesense`) — no
> fs/shell/http, no new IPC command, no mutation, no catalog/remote-fetch/updater change;
> `actions.rs` / `recommendations.rs` / `remote_rules.rs` / `history.rs` are untouched. (The beta
> installer config in `docs/PACKAGING_SIGNING_PLAN.md` predates this allowlist and remains correct
> for the frozen snapshot.) **Status of this entire post-freeze UI layer:**
>
> > **Experimental / not Sentinel-verified. Use at your own discretion.**
>
> Do not imply it is beta-verified until it has had its own QA pass.

> **🛰️ HQ / PARALLEL-OPS UPDATE — 2026-06-01.** Sentinel is now worked by multiple sessions under an
> **HQ / air-traffic-control model** — see `docs/PARALLEL_WORKTREE_OPS.md` (the rule of the road).
> **Only HQ (the `main` checkout) merges/pushes `main`;** each lane runs in its own git worktree on its
> own branch with a disjoint file domain (HQ=`main`; design=`experience-pass`/`src/`;
> `spike/backend-agent`=`src-tauri/`; `benchmark`=docs). Active state:
> - **`experience-pass` (parked, pushed `514b523`):** the experimental UI layer above is being **reworked
>   into an honest premium command-center** — `CommandHero` reframed to a transparent read-only
>   **`SystemPosture`** (the Stock→Apex Tune tier, Garage tab, level-up flash, theme-unlock grind, and
>   "Surprise" randomizer are all **REMOVED** per **Decision A**), a design-system layer added
>   (`src/design/` primitives + `src/surfaces/`), themes curated to Graphite/Frost/Aurora/Ember, and
>   ~290 lines of dead gamification CSS purged. Frontend tests **34/34**, build clean. **NOT merged** —
>   pending owner visual verify + a "drop the hardware-grid from Overview?" call. When merged it
>   **supersedes** the experimental UI layer above with the honest version.
> - **Lanes:** `benchmark` (F6 proof layer) is **PAUSED** — owner is reopening the cosmetic-reward-system
>   direction (reconsidering Decision A for that angle); no design work until the owner's full direction
>   lands. `spike/backend-agent` is a **speculative** backend-agent spike that may never merge.
> - **Unchanged gates:** F1 Gaming Mode still gated; public release still gated on code-signing + legal;
>   beta frozen @ `16069fa`; remote-fetch + updater stay off.

Structural refactor is **complete** — stop module carving; remaining work is feature/QA.
`cargo test` **68/68**, `cargo build` zero warnings, `npm run build` clean. Pushed to GitHub
(`origin/main` in sync). Manual-mutation QA blocker **LIFTED** (see below).

**F2 Per-game Readiness — SHIPPED** (read-only): `readiness.rs` + `get_game_readiness` + a
"Readiness" tab; pure `evaluate_readiness`, 8 advisory checks, 5 unit tests, mutates nothing.

**F3 Session Summary — SHIPPED** (read-only): `sessions.rs` (pure `SessionAccumulator` +
last-20 `sessions.json` store + `get_session_summaries`) and a 1 s aggregator thread wired into
`monitoring::start_fps_capture` that folds the FPS helper output + GPU/CPU/RAM into a per-session
summary (avg FPS/frametime, 1%-low ESTIMATE, peak GPU temp/usage, peak RAM, active-changes
count) and persists it on stop — only if a game actually presented. "Sessions" tab; 6 unit tests.
Mutates nothing.

**F5 Export Snapshot — SHIPPED** (read-only): `export.rs` (pure `build_markdown_report` from each
source's serialized JSON → decoupled + graceful-on-missing; `export_report` writes Markdown + JSON
to `%APPDATA%\Sentinel\exports\`; `open_export_folder`) and an "Export report" header button +
preview modal. Composes hardware / recs / Trust Ledger / readiness / sessions + privacy note;
sessions labeled live-estimate. 5 unit tests. Mutates nothing.

**F4 Priority Ranking — SHIPPED** (read-only/advisory): `priorities.rs` (pure `build_priorities`
over serialized signals → 3 buckets — biggest limiters [rank-ordered], already fine, not worth
touching; each row has title/reason/linked/confidence/status; conservative per-session GPU-vs-system
hint) + `get_priorities` + a "Priorities" tab. Reuses readiness/recs/startup/last-session; no magic
score, no mutation. 8 unit tests. (Centralized `APPLIABLE_REC_IDS` into history.rs; export reuses it.)

**Read-only upward-feature track (F2–F5) COMPLETE.** **Next:** F1 Gaming Mode is the only remaining
planned feature and stays gated (session-scoped MUTATION → its own apply/rollback + crash-safe-restore
QA). **Design done (planning only, no code): `docs/GAMING_MODE_PLAN.md`** — v1 = power-plan-switch-only
(reuses the `070c3c9` exact-stored-plan restore + Trust Ledger "restore from local state alone" +
FPS-helper heartbeat lifecycle as the crash-safe template); session file + startup recovery prompt;
consent-gated; 7-state machine; its own QA gate. Otherwise: packaging/signing + legal finalization (separate gates).

Recent commits (newest first — this list is the `private-beta-001` line; `main` has since advanced
13 commits, see the DOCS-vs-`main` DRIFT banner under CURRENT STATE above):
- `(F4)` feat(priorities): Priority Ranking surface (read-only/advisory)
- `60c57ce` feat(export): local Export Snapshot report (read-only)
- `33413a2` feat(sessions): per-session summary surface (read-only/advisory)
- `ac9d505` feat(readiness): per-game Game Readiness surface (read-only/advisory)
- `8dda3de` fix(monitoring): report UAC-cancelled FPS elevation as "declined" (not "stopped")
- `4a94d75` docs: add CLAUDE.md (this file) — portable in-repo failsafe
- `b1f4366` fix(monitoring): launch elevated FPS helper hidden (`.show(false)`/SW_HIDE) under UAC
- `070c3c9` fix(actions): roll back power settings to the exact stored plan GUID (not SCHEME_CURRENT)
- `82bcd8f` test(actions): rollback resolution / legacy-synthesis regression tests
- `85e2710` refactor(history): extract Trust Ledger into its own module

### ✅ Manual-mutation QA — CLOSED (owner sign-off 2026-05-31)

The manual apply/rollback release blocker is **LIFTED.** Verified live on a UAC-on machine:
- **§1 elevation** PASS (FPS helper accept + cancel).
- **§2 apply-accept** mutates correctly — real applies left USB/PCIe AC = 0, HiberbootEnabled = 0;
  ledger entries carry typed `applied_action`+`rollback_action`+snapshot.
- **§3 apply-cancel** accepted as PASS — runas-cancel verified live in §1, and `apply_recommendation`
  returns on the elevation error via `?` BEFORE any history write (no false success entry).
- **§4 rollback** restores exact prior state.
- **§2a power-plan fidelity — PASSED decisively:** rolling back a Balanced-stored `pcie-aspm-off`
  while Ultimate was active restored Balanced AC 0→1, left Ultimate untouched at 0, and didn't
  change the active plan — live proof of `070c3c9` (no SCHEME_CURRENT fallback, no forced switch).
- Restart-persistence PASS; no orphan helpers; Sentinel correctly withholds already-satisfied
  (SysMain/DiagTrack) and HDD-gated (Windows Search) recs.

**Optional NON-blocking follow-up QA** (nice-to-have, not gating): (1) live elevated-apply UAC
*cancel*-message UX check; (2) external-revert "no longer active" UI observation.

### 🚧 Remaining release gates (NOT mutation-QA — these still gate beta/public release)
- **Packaging/signing:** plan + audit in `docs/PACKAGING_SIGNING_PLAN.md`. Config verified good
  (identity/icons/capabilities/updater-off). **Beta route DECIDED (2026-05-31): unsigned + invite-only
  direct download + fully local-only (no telemetry, no new code).** **Build VERIFIED 2026-05-31:**
  `npm run tauri build` → `Sentinel_0.1.0_x64_en-US.msi` (3.5 MB) + `Sentinel_0.1.0_x64-setup.exe`
  (2.3 MB) in `src-tauri/target/release/bundle/`; identity baked in, NotSigned (expected), no updater.
  **INSTALLED-BUILD QA COMPLETE & PASSING (2026-05-31):** §6 + §7 all pass — install/uninstall/reinstall,
  AppData + Trust-Ledger persistence, zero outbound network, Export (valid UTF-8), headless elevated FPS
  helper, and apply+rollback incl. the `070c3c9` stored-plan fidelity — all verified on the packaged
  build. **No private-beta functional blockers remain**; the private beta is functionally shippable on
  the invite terms. CSP stays `null` for the trusted beta; tighten+test before public. **PUBLIC release
  still gated on signing route + legal (license model + jurisdiction). Gaming Mode (F1) remains gated —
  NOT covered by the lifted mutation-QA sign-off.**
  **Pre-public polish backlog — ✅ CLEARED (2026-05-31, tests 72/72):** (1) Export `.md` UTF-8 BOM
  `ac9c70d`; (2) storage logical-disk fallback when `MSFT_PhysicalDisk` empty, in Export + readiness
  `514ca0e`; (3) AMD GPU driver-age — **VERIFIED NOT A BUG** via a live `detect_gpus()` run: the RX 9070 XT
  reads `driver_date 2026-05-12`, `driver_age_days Some(20)` (value at check; `2026-05-12` is the stable fact) through the existing DXGI↔WMI name-matched
  merge — no code change, no registry fallback; (4) install dir vs runtime dir separated →
  `%APPDATA%\Sentinel\runtime` `e87ecdd`+`512dd11`; (5) single-instance lock (2nd launch focuses existing
  window) `75e4681`. (See `docs/PACKAGING_SIGNING_PLAN.md` §7a.)
  **✅ Installer REBUILT (2026-05-31 17:11) — includes #1–#4.** `npm run tauri build` →
  `Sentinel_0.1.0_x64_en-US.msi` (≈3.4 MB) + `Sentinel_0.1.0_x64-setup.exe` (≈2.2 MB) in
  `src-tauri/target/release/bundle/`; identity baked in (Sentinel / 0.1.0 / Pootytxng), NotSigned
  (expected), no updater; single-instance smoke passed on the fresh binary. (First attempt OOM'd
  compiling the `windows` crate at `opt-level=3` with ~5 GB free RAM; cleared with
  `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256` — lower peak memory, negligible runtime cost.)
  **✅ POST-POLISH INSTALLED-BUILD SMOKE = PASS (2026-05-31)** on the 17:11 NSIS build: install/identity,
  single-instance (no respawn), Export BOM (`EF BB BF`), FPS runtime-dir separation + headless + clean
  exit (real ETW data), AMD driver-age, apply/rollback (ledger 12→13, `status: rolled_back`), 0 outbound
  network, and uninstall/reinstall with Trust-Ledger persistence — all green (see PACKAGING §7b). ⇒
  **Private beta is READY for invite-only, unsigned, direct-download / local-share distribution.** PUBLIC
  release stays gated on signing + legal; Gaming Mode (F1) stays gated; remote fetch + updater stay off.
- **Legal:** `docs/PRIVACY.md` / `docs/EULA.md` are DRAFTS — license model + governing-law/jurisdiction
  TBD before public distribution.
- **Remote fetch:** stays disabled (`docs/REMOTE_FETCH_ARMING_PLAN.md`); not a beta gate.
- Any NEW mutating feature needs its own apply/rollback QA (see Gaming Mode).

**Unblocked now:** **F5 Export Snapshot** + **F4 Priority Ranking** (read-only/advisory) per
`docs/PRODUCT_DIRECTION.md`. **Still gated:** **F1 Gaming Mode** introduces session-scoped
MUTATION → rides its own apply/rollback + crash-safe-restore QA, not covered by this sign-off.

**Allowed now:** read-only/advisory features (F5/F4), packaging/legal/signing prep. **Not allowed
without their own gate:** Gaming Mode's mutating parts, remote-fetch enablement, new tweak-catalog
expansion, declaring beta/release-ready before the packaging/legal/signing gates close.

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
