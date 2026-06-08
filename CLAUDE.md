# CLAUDE.md — Compy project brief & resume point

> **This file auto-loads into every Claude Code session opened in this repo.** It is the
> durable, in-git, portable source of truth — independent of Claude's local `~/.claude`
> memory (which is pinned to one machine + one launch path and may not load). If you are a
> fresh session: read this top-to-bottom, then `docs/RELEASE_QA.md` for the live QA pass.
> Treat file/line claims as point-in-time — verify against current code before asserting.

> **RENAMED Sentinel → Compy (2026-06-04).** The app was renamed for brand/SEO collision reasons
> (SentinelOne / MS Sentinel / Valorant). Identifier `gg.compy.app`, exe `compy.exe`, crate
> `compy`/`compy_lib`, data dir `%APPDATA%\Compy`. **First launch COPY-migrates** the old
> `%APPDATA%\Sentinel` data dir → `%APPDATA%\Compy` (`migrate_legacy_data_once` in `lib.rs`; the
> legacy literal MUST stay "Sentinel" — it's the source). Pre-rename **git history, the WSL scaffold
> path, and the old `%APPDATA%\Sentinel` dir** still use "sentinel" — that's expected, not a leftover.
> Domain: `compy.gg`.

## What Compy is

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

## Working mode — SPORT MODE (default, set by owner 2026-06-02)

**Default to maximum momentum. Stop way less.** For owner-greenlit or clearly-scoped work, do NOT run
the brainstorm → spec → plan → TDD ceremony and do NOT ask permission at reversible checkpoints — just
**build → verify → commit → push → move to the next item**, batching any questions to the end. This
**OVERRIDES** the superpowers skill defaults (brainstorming / writing-plans / TDD gates) and any
"check in first" instinct. Reserve real design dialogue for genuinely fuzzy/unscoped problems.

**The only legitimate stops** ("we still pull over to take a leak — then straight back on the road like
we never slowed down"):
1. **Secrets / signing** — the Ed25519 private key (or any secret) never enters the repo / `.env*` / CI.
2. **Shared or irreversible git** — no force-push; never move the frozen beta refs (`16069fa`).
3. **Ships to OTHER people's machines** — shipping unverified *mutation* code to beta/public, arming
   remote-fetch, enabling the updater, or loosening capabilities/CSP → confirm first (informed).
4. **Genuinely irreversible + outward-facing** real-world actions.

Everything else — refactors, features behind a gate, docs, local builds, reversible git on `main`
(HQ-owned) — just do it and report after. **Verification (cargo/npm tests + build) is NEVER skipped;**
"fewer stops" means fewer *check-ins*, not less rigor. See [[working-state-persistent-mode]] +
[[working-defaults-pure-upside]].

### MINIMAL GATES (owner directive 2026-06-06 — extends SPORT MODE)

**If a task CAN be done by us (you or Cowork), DO IT — never redirect to the owner anything we're
capable of handling.** Owner-bound items are ONLY: **money · distribution/sends to other humans ·
aesthetic taste calls** (e.g. theme hexes) **· the LOCKED gates** (frozen beta refs, `gaming_mode`
flag, remote-fetch/updater, signing keys, force-push, secrets).

**Pause for the owner on ONLY two things:**
1. **Point-of-no-return** — anything irreversible (deletions without backup, history rewrites,
   outward-facing/real-world actions).
2. **Reshaping a core feature/element OUTSIDE the currently-discussed topic** — send a brief
   **WELFARE CHECK** first (one message: *what / why / blast radius*), and only when genuinely
   important. Gauge: *"would this leave the owner upset if he saw it without warning?"* If no → proceed,
   report after.

**Everything reversible: just do it and report after.** The owner is explicitly forgiving of fixable
mistakes — **bias hard toward momentum. Reversibility is the license:** keep changes revertable (flags,
small commits, additive) and the license stays valid. This loosens **nothing** about rigor —
tests/builds/verification never skipped, locked gates unchanged, honesty rules unchanged: fewer
check-ins, not less rigor. `AskUserQuestion` is reserved for genuine forks in **owner territory**
(taste/money/people/irreversible); **engineering forks you resolve yourself and record the reasoning.**

## Stack & where things live

- **Tauri 2** desktop app: Rust core (`src-tauri/`) + React/TypeScript frontend (`src/`).
- **Single source of truth: `C:\Users\Kuya\code\compy\`** (Windows-side). The old
  `\\wsl.localhost\...\var\www\compy` WSL/FastAPI scaffold is **superseded/stale** — do
  not use it. WSL is not needed (and breaks anti-cheat via Hyper-V).
- GitHub remote: `Pootytxng/compy`, branch `main`.
- Dev loop: `npm run tauri dev` (from repo root). Tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
  Fresh shells may need `export PATH="$HOME/.cargo/bin:$PATH"`. Git CRLF warnings are benign.
- Runtime data: Trust Ledger at `%APPDATA%\Compy\history.json` (Roaming); FPS IPC +
  `launch-debug.log` (debug only) at `%LOCALAPPDATA%\Compy\` (Local).

### Rust module map (post-refactor — `lib.rs` carved into safety-boundary modules)

- `lib.rs` (~496 lines) — `run()` wiring + command registration, 13 state probes, `compy_data_dir`, startup-apps, `safety_tests`.
- `actions.rs` — the ONLY Windows-mutation + rollback boundary: typed `AppliedAction`/`RollbackAction`/`Snapshot`, all `apply_*`/`rollback_*_typed`, `dispatch_rollback`, `resolve_rollback`, `synthesize_legacy_rollback`, `run_elevated_powershell`.
- `history.rs` — Trust Ledger: `AppliedChange`, persistence (`load/save_history`), `apply_recommendation`/`rollback_change`/`get_applied_changes`. Rollback resolves from local history alone.
- `recommendations.rs`, `hardware.rs`, `monitoring.rs`, `diagnostics.rs`, `fps.rs`, `remote_rules.rs`.
- `main.rs` — if argv has `--fps-capture`, run the headless ETW helper (`run_fps_capture`) and return BEFORE any window; else `run()`.

## LOCKED safety rules — do not cross without an explicit product-owner decision

1. **No kernel driver.** Consequence: **no CPU temperature** (proven impossible in user-mode on this machine — do not re-investigate). GPU temp is fine (vendor SDK).
2. **No game injection.** Anti-cheat-safe. FPS/frametime via ETW (DXGI present events) in an elevated helper; GPU sensors via vendor libs (AMD ADLX / NVIDIA NVML). Overlay only draws over borderless/windowed, not exclusive fullscreen.
3. **Rollback-first integrity.** Apply captures the full typed rollback contract + snapshot at apply time; rollback resolves from `history.json` ALONE (never the live catalog), so a removed/deprecated rec stays undoable. Never apply a change you can't roll back.
4. **Signed remote rules — triple-gated OFF.** Real Ed25519 verify is wired (`ed25519-compact`), but remote fetch stays disabled (placeholder all-zeros pubkey, `remote_fetch_enabled()==false`, no CDN URL) until production signing + CDN + staged rollout exist. **The Ed25519 private key NEVER lives in the repo** (not commits, .env, CI, or unencrypted home). **Unsigned remote rules must never ship, even in beta.**
5. **GPU vendor honesty:** AMD = **verified**. **NVIDIA (refined 2026-06-06 from the first NVIDIA tester export, RTX 3060 Ti / Win11 25H2):** GPU **detection + NVIDIA-specific recs + their applies (HAGS, Container telemetry) = hardware-verified**; but **NVML sensor + session/FPS monitoring is STILL "implemented, not yet hardware-verified"** (tester had 0 sessions — awaiting one monitored session). So the Monitoring "GPU sensor coverage" line + the NVML tooltip stay "not yet hardware-verified" — do NOT flip those. Intel = planned. Do not silently upgrade NVIDIA *sensor* confidence past what a monitored session proves.
6. **Tweak catalog is frozen (~29 recs)** — no new *risky tweaks*. Hard "optimizer-rot" blocklist (do NOT add): timer/HPET hacks, bcdedit, MMCSS, NIC-offload packs, core parking, Defender disable, MPO disable, fixed pagefile, TCP mega-packs, AI-generated/arbitrary actions. **This is catalog discipline, NOT a feature freeze.** Product value grows *upward* (gaming readiness, monitoring, session summaries, priority ranking, export), not sideways into more switches — see `docs/PRODUCT_DIRECTION.md`. Any new feature must be **read-only / advisory / reversible / session-scoped** until proven safe; the only mutating one planned (Gaming Mode) rides the manual-mutation QA blocker + full rollback contract.

## Dev machine (for hardware-specific work)

Fully **AMD**: **Radeon RX 9070 XT (RDNA4)** GPU, Ryzen X3D-class CPU, 16 logical cores
(~5.1 GHz), ~29.4 GB RAM. **Build & test the AMD path first** — NVIDIA is unverifiable here.
**UAC:** was disabled (`EnableLUA=0`) during early dev; **re-enabled to `1` and rebooted on
2026-05-30** so the `runas` elevation path can be tested. `uac_disabled()` now returns false →
the real `runas` branch is live (not the direct-spawn fallback). To revert: set `EnableLUA=0` + reboot.

## CURRENT STATE — Instrument reskin + Halfway Home + ONE RAIL + WAYFINDING (as of 2026-06-06)

> **🛠️ ELASTIC RE-FIX (BLESSED) + BETA-TRAIN-#3 + EGGS + BUNDLED REBUILD SHIPPED — 2026-06-07 (`main` @ `6b39c31`).**
> All on `main`, all green (npm **188** · cargo **223**, zero warnings; tsc+vite clean). On top of one-rail:
> - **Elastic window §6 RE-FIX** (`22d42fc`) — the prior pass was reopened after a failed owner drag-test
>   ("snapping / hugging one side / doesn't match the window"). Re-fix: **fill-then-center** caps (rooms 1600 /
>   Home 1500) with `margin-inline:auto`; **ONE liquid system** (rail-collapse is the only discrete breakpoint;
>   hero/grids reflow intrinsically via flex-wrap/auto-fit/clamp — chose intrinsic liquidity over container
>   queries, recorded in the commit); left-pinned panes centered; a **6th Network card** makes the hardware
>   glance count-agnostic (reuses detection-train data, zero IPC). **§7 NARROW NAV V2** (`6b39c31`): at <720px
>   BOTH shells become a fixed **BOTTOM ROOM BAR** — six equal NAMED cells (icon over an always-visible name;
>   Settings → floating top-right gear; the room-name strip retires) — fixing the "anonymous dots" doorknob-law
>   miss the first re-drag-test caught. **✅ owner-BLESSED live, narrow nav included.**
> - **Beta Feedback Train #3 §1–§7** (specs `docs/superpowers/specs/2026-06-06-beta-feedback-3.md`): **§1 clean
>   exit + single-instance hardening** (`3c427d7`) — THE "Compy won't open" root cause: the config-declared
>   overlay window kept the process alive as a windowless ghost holding the single-instance lock (confirmed live).
>   Fix: on main-window CloseRequested → `monitoring::shutdown_for_exit()` (drops the fps.alive heartbeat so the
>   elevated helper self-exits ~0.5s) + `app.exit(0)`; AND the single-instance callback now RECREATES the main
>   window when the lock holder has none (never a silent no-op). Regression tests in fps.rs. **§2** exact Learn
>   links (`4263b19`); **§3** Play monitoring inline, no dropdown (`523f267`); **§4** "Apply all safe fixes (N)"
>   (`d280679`) — frontend orchestration of the EXISTING apply (per-item ledger receipts, failure isolation,
>   safe-tier only; **ZERO new IPC/mutation primitive**); **§5** Learn de-overload (`fe7a571`); **§6** wordmark→
>   shared `Wordmark`, PulseC deleted (`713d8aa`); **§7** autopsy URL-paste honest coaching, **no fetch ever**
>   (`326edfb`).
>   - **§4 FLAGS before the gated rebuild ships it to beta:** (1) "one UAC prompt" is **deferred** — currently N
>     prompts for N elevated items (batching needs a backend `actions.rs` change + its own elevation QA); (2) as
>     a new mutating UX it wants a quick **apply-all → per-item-rollback QA** on a UAC-on machine (per the
>     "new mutating feature needs its own QA" rule). Not blocking the build; blocking the beta ship.
> - **Doorknob pass + 5 shadow-realm eggs** — affordance-honesty grammar + CI guard (`d0f3d47`, law mirrored into
>   design-system kernel §0); eggs: Library "cheat code" deep cut, triple-click wordmark heartbeat (`cmp-shadow`
>   = the sanctioned knobless-interaction exception), Hearth December warmth, Konami handshake (`679a03d`),
>   patient-gaze ring breath (`f3725ac`). All reduced-motion-honored; removing any leaves zero trace.
> - **✅ BUNDLED REBUILD SHIPPED (2026-06-07):** unsigned `npm run tauri build` (1m07s, no OOM, `CODEGEN_UNITS=256`)
>   from `6b39c31` → NSIS + MSI. **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
>   `0D6A5C9AFB31495E186D670B402EB98FED3EFE8EE8B86B9152932B322A108DC5`** (2,690,746 B, built 18:48); the
>   gitignored `beta-kit/` copy was refreshed + hash-matched (the stale-copy trap is closed).
> - **PENDING (NOT Claude — owner/Cowork):** (1) **Cowork re-zips** `beta-kit/Compy-Beta-Kit.zip` with THIS
>   installer (the 6/6 zip still holds the old one); (2) **owner runs the §4 apply-all → per-item-rollback QA**
>   on the packaged build BEFORE the kit reaches testers (one-UAC-prompt batching stays deferred); (3) optional
>   §1 close→no-ghost + force-kill→relaunch→window spot-check. **Beta refs still pinned @ `16069fa` (untouched).**

> **🧭 WAYFINDING + SHOW-ME WALKTHROUGHS LANDED (first-live-beta QoL) — 2026-06-06 (`main` @ `ee92773`).**
> From the FIRST live beta feedback, two QoL trains shipped on top of the one-rail app:
> - **Back button** (`4b14b6e`) — a 24/7 location-history back control in every surface header (Alt+Left;
>   mouse XButton1 if the webview surfaces it — needs a dev verify); in-place expansions don't push.
> - **Inline dependencies** (`9aae36b`) — "bring the switch to the need": the Benchmark "Measure on a
>   live game" card starts FPS monitoring inline (no trip to another page). Sweep reported in the commit.
> - **Named-place links + "What's this?"** (`6b9ac67`) — `WhatsThis` opens the exact Learn entry by id via
>   the quick-look overlay (Fix rows; resolves only where an entry exists); bare room-names reworded.
> - **Show-me walkthroughs** (`ee92773`) — data-driven animated SCHEMATIC guides (`walkthroughs.json` +
>   `Walkthrough` component, lint-tested) for out-of-Compy steps. v1 set: VRR (AMD/NVIDIA), XMP/EXPO, Game
>   Mode, Storage Sense (deep-link paired), HDR. Live on Check advisory limiters (the VRR readiness check
>   shows the way), Fix guided rows, + matching Learn entries. Vendor-variant auto-selected from the GPU;
>   deep links open ONLY via the existing allowlist (no new entries). npm **181/181**.
> - **OPEN (owner):** rebuild the installer for wave 2 (these ship before wave-2 invites); live-verify
>   XButton1 + eyeball the VRR loop. Wayfinding §1-forward-button is a recorded trivial follow-up.
>
> **🎨 WHOLE-APP RESKIN → "HALFWAY HOME" → "ONE RAIL" LANDED, AND THE REDESIGN NOW SHIPS BY DEFAULT —
> 2026-06-06 (`main` @ `1c6b6af`).** The app wears the **Instrument** design system end to end, dialed
> back to "halfway home," and the **one-rail pass** unified the navigation so there's a single map
> app-wide. **The redesign is the shipped app now (release-default ON).** A cold session MUST start from
> here — the banners below are pre-reskin history (designs behind).
> - **Theme system:** `data-itheme` on `<html>` (startup in `main.tsx`; managed in Settings → Appearance)
>   is THE theme system — the classic `data-theme` ThemePicker is RETIRED. Slots: **Halfway (default) ·
>   Midnight · Hearth (warm — basic, owner tuning pending)**. Palette = neutral charcoal (ZERO green
>   tint), teal `--ix-accent` on CONTROLS ONLY + `--ix-accent-2` + `--ix-accent-ink` (guard-checked).
> - **ONE RAIL (the shell adopts the six-home IA app-wide):** **Home · Check · Play · Fix · Learn · Lab**
>   + Settings gear (rail bottom) + Export (header action). BOTH the app-shell rail and the CommandCenter
>   rail render from the shared `src/design/homeRail.ts` (+ `NavGlyph`) — identical by construction,
>   **parity-guarded** by `src/design/homeRail.test.ts`. The legacy `SECTION_META` rail is retired;
>   `CommandHero` removed (posture hero is Home-only). **Matched-rails** approach (owner decision); the
>   full structural merge — one rail component, CommandCenter as rail-less Home content, AmbientBackdrop
>   app-wide — is a **recorded POST-BETA follow-up**, not done.
> - **Navigation law — "never teleports":** the rail is the only location change; detail expands in place.
>   Check absorbs Readiness+Priorities; **Play** absorbs Sessions+Monitoring+overlay (rows expand to the
>   full `SessionDebrief` inline; deep charts embed via `MonitoringTab embedded`); **Lab** absorbs
>   Benchmark+Latency+**Diagnostics** (inline collapsibles); **Fix** holds the recs + Startup + guided +
>   the **Trust Ledger** (see below); **Learn** is a rail ROOM (renders the Learn surface via `asPanel`;
>   the Library overlay survives only as the cross-link quick-look).
> - **Trust Ledger (redesigned, lives in Fix):** "Active on this PC" = one deduped card per currently-
>   active change (latest per rec id) + humanized "active since" + a quiet GHOST rollback; "Full history"
>   collapsed below. Rollback BEHAVIOR byte-identical (same audited path).
> - **Guide Autopsy (Learn):** graded rows expand IN PLACE; the autopsy persists for the session
>   (sessionStorage: text + graded flag + mode) so it survives tab switches; sticky context header + Clear.
> - **Flags:** `compy_*_v2` now **DEFAULT ON in dev AND release** (`readDevFlag`/`readOverlayV2` → `true`);
>   each classic stays reachable via Settings → New look (`"0"`). Fix+Play parity gates were closed first.
> - **Identity:** shared `Wordmark` swept app-wide; app icon = heartbeat INSIDE the C (`scripts/build-icon-ico.mjs`).
> - **Smalls:** posture-ring subline wraps within the ring; game names display via `prettyGameName` (strips
>   `.exe`; raw kept for exports); appearance controls live only in Settings (off Home).
> - **Guards:** `theme-contrast.test.ts` (WCAG incl. ink-on-accent) · `sweep-guard.test.ts` (one shimmer) ·
>   `homeRail.test.ts` (rail parity). **Verify:** `tsc` + `vite build` clean · **npm 168/168** · cargo
>   untouched (frontend-only). /check + /security clean on every train.
> - **Installer:** unsigned `Compy_0.1.0` (NSIS `…/bundle/nsis/Compy_0.1.0_x64-setup.exe` + MSI) — rebuild
>   after UI changes (`npm run tauri build`; close Diablo if free RAM < ~8 GB — cold release builds OOM).
> - **OPEN (owner-only):** live smoke of the rebuilt installer; **Hearth + warm final hexes → kernel §4**;
>   the post-beta full rail-merge.
> - Canonical specs: `docs/superpowers/specs/2026-06-0{5,6}-*.md`; governance:
>   `docs/superpowers/plans/2026-06-04-beta-build-order.md`. **Beta refs still pinned @ `16069fa` (untouched).**

> **✅ EXPERIENCE PASS LANDED — 2026-06-02 (`main` @ `60daf3a`).** The former post-freeze experimental
> UI layer (the un-QA'd gamified premium UI, old `main` HEAD `d049d63`) has been **superseded and
> de-gamified**, then merged to `main` as an HQ-verified, fast-forward integration. `main` is now the
> **honest command-center**: `CommandHero` → transparent read-only **`SystemPosture`**; the Stock→Apex
> "Tune Level", Garage tab, level-up flash, theme-unlock grind, and "Surprise" randomizer are all
> **REMOVED** (Decision A); a design-system layer added (`src/design/` primitives + `src/surfaces/`);
> themes curated to Graphite/Frost/Aurora/Ember; ~290 lines of dead gamification CSS purged.
> **QA before merge (frontend-only diff):** `tsc` + `vite build` clean · frontend **34/34** tests ·
> `npm audit` 0 vulns · diff scanned: **zero** `src-tauri` / installer / gate / updater / remote-fetch
> touch, no dangerous patterns, no new IPC. Verified live (Tauri dev) + owner visual sign-off (KEEP the
> Overview hardware grid).
>
> **What REMAINS from the premium layer (legit, kept on purpose):** the **Guided** advisory section —
> fixed, **allowlisted** `ms-settings:` deep links (`display-advanced`, `display-advancedgraphics`,
> `storagesense`), built **never from data**, no fs/shell/http, no new IPC, no mutation; backed by the
> scoped `opener:allow-open-url` allowlist in `src-tauri/capabilities/default.json` (the only backend
> capability beyond the beta snapshot; `actions.rs`/`recommendations.rs`/`remote_rules.rs`/`history.rs`
> untouched). The new `Dashboard` surface (`src/surfaces/Dashboard.tsx`) is built + tested but **not yet
> wired** into a tab — intentionally deferred. **Beta refs remain pinned at `16069fa` (NOT moved).**

> **🛰️ HQ / PARALLEL-OPS UPDATE — 2026-06-01.** Compy is now worked by multiple sessions under an
> **HQ / air-traffic-control model** — see `docs/PARALLEL_WORKTREE_OPS.md` (the rule of the road).
> **Only HQ (the `main` checkout) merges/pushes `main`;** each lane runs in its own git worktree on its
> own branch with a disjoint file domain (HQ=`main`; design=`experience-pass`/`src/`;
> `spike/backend-agent`=`src-tauri/`; `benchmark`=docs). Active state:
> - **`experience-pass` — ✅ MERGED to `main` 2026-06-02 (`60daf3a`); branch + worktree retired.** The
>   honest command-center landed (full detail in the EXPERIENCE PASS LANDED banner above): SystemPosture
>   hero, Tune/Garage/theme-unlock/Surprise removed (Decision A), `src/design/` + `src/surfaces/`,
>   themes curated, dead CSS purged. HQ-verified ff merge. **Design lane is now idle (no live worktree).**
> - **Lanes:** `benchmark` (F6 proof layer) is **PAUSED** — owner is reopening the cosmetic-reward-system
>   direction (reconsidering Decision A for that angle); no design work until the owner's full direction
>   lands. **Intersection now sharper:** de-gamification is **LIVE on `main`**, so a returning reward
>   system would *re-introduce* cosmetic UI onto the de-gamified `main` (a reversal to reconcile, no
>   longer a parked branch) — HQ + owner settle it when the direction lands. `spike/backend-agent` is a
>   **speculative** backend-agent spike that may never merge.
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
to `%APPDATA%\Compy\exports\`; `open_export_folder`) and an "Export report" header button +
preview modal. Composes hardware / recs / Trust Ledger / readiness / sessions + privacy note;
sessions labeled live-estimate. 5 unit tests. Mutates nothing.

**F4 Priority Ranking — SHIPPED** (read-only/advisory): `priorities.rs` (pure `build_priorities`
over serialized signals → 3 buckets — biggest limiters [rank-ordered], already fine, not worth
touching; each row has title/reason/linked/confidence/status; conservative per-session GPU-vs-system
hint) + `get_priorities` + a "Priorities" tab. Reuses readiness/recs/startup/last-session; no magic
score, no mutation. 8 unit tests. (Centralized `APPLIABLE_REC_IDS` into history.rs; export reuses it.)

**Read-only upward-feature track (F2–F5) COMPLETE.** **F1 Gaming Mode — BUILT + merged to `main` DARK
(2026-06-02).** The session-scoped mutation feature is implemented behind a default-off
`gaming_mode_gate()` (returns `false` → the "Gaming" tab never appears + the 5 IPC commands refuse):
pure `gaming_session.rs` (7-state machine + typed restore contract + fail-safe session-file serde) +
`gaming_orchestrator.rs` (write-before-mutate start, idempotent fail-loud restore, startup orphan
detection + user-confirmed recovery) reusing the audited `apply_*`/`dispatch_rollback`. A NEW
**non-elevated** existing-plan switch/restore keeps the CORE bundle (power-plan max + Windows Game Mode
on + Game Bar/DVR off) **UAC-free**; opt-in USB-SS/PCIe-ASPM are the elevated advanced tier. Gated React
surface (`src/surfaces/GamingMode.tsx`: first-use consent modal + always-visible honesty line + recovery
prompt). `cargo test` **81/81**, `npm test` **39/39**, builds clean, **/check + /security passed** (no new
vulns/warnings; only pre-existing clippy lints remain). **STILL GATED — does NOT ship / the flag does NOT
flip until its own mutation QA (spec §7: normal / crash / reboot / UAC-cancel / missing-plan /
external-change, on a UAC-on machine) passes + explicit owner sign-off.** Spec:
`docs/superpowers/specs/2026-06-02-gaming-mode-f1-design.md` · plan:
`docs/superpowers/plans/2026-06-02-gaming-mode-f1.md` · broad contract: `docs/GAMING_MODE_PLAN.md`.
Otherwise: packaging/signing + legal finalization (separate gates).

Recent commits (newest first — this list is the `private-beta-001` line; `main` has since advanced
past the freeze and now carries the de-gamified Experience Pass, see the EXPERIENCE PASS LANDED banner
under CURRENT STATE above):
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
- Restart-persistence PASS; no orphan helpers; Compy correctly withholds already-satisfied
  (SysMain/DiagTrack) and HDD-gated (Windows Search) recs.

**Optional NON-blocking follow-up QA** (nice-to-have, not gating): (1) live elevated-apply UAC
*cancel*-message UX check; (2) external-revert "no longer active" UI observation.

### 🚧 Remaining release gates (NOT mutation-QA — these still gate beta/public release)
- **Packaging/signing:** plan + audit in `docs/PACKAGING_SIGNING_PLAN.md`. Config verified good
  (identity/icons/capabilities/updater-off). **Beta route DECIDED (2026-05-31): unsigned + invite-only
  direct download + fully local-only (no telemetry, no new code).** **Build VERIFIED 2026-05-31:**
  `npm run tauri build` → `Compy_0.1.0_x64_en-US.msi` (3.5 MB) + `Compy_0.1.0_x64-setup.exe`
  (2.3 MB) in `src-tauri/target/release/bundle/`; identity baked in, NotSigned (expected), no updater.
  **INSTALLED-BUILD QA COMPLETE & PASSING (2026-05-31):** §6 + §7 all pass — install/uninstall/reinstall,
  AppData + Trust-Ledger persistence, zero outbound network, Export (valid UTF-8), headless elevated FPS
  helper, and apply+rollback incl. the `070c3c9` stored-plan fidelity — all verified on the packaged
  build. **No private-beta functional blockers remain**; the private beta is functionally shippable on
  the invite terms. CSP is strict in config; pre-public gate = verify the policy under the packaged build, not write it. **PUBLIC release
  still gated on signing route + legal (license model + jurisdiction). Gaming Mode (F1) remains gated —
  NOT covered by the lifted mutation-QA sign-off.**
  **Pre-public polish backlog — ✅ CLEARED (2026-05-31, tests 72/72):** (1) Export `.md` UTF-8 BOM
  `ac9c70d`; (2) storage logical-disk fallback when `MSFT_PhysicalDisk` empty, in Export + readiness
  `514ca0e`; (3) AMD GPU driver-age — **VERIFIED NOT A BUG** via a live `detect_gpus()` run: the RX 9070 XT
  reads `driver_date 2026-05-12`, `driver_age_days Some(20)` (value at check; `2026-05-12` is the stable fact) through the existing DXGI↔WMI name-matched
  merge — no code change, no registry fallback; (4) install dir vs runtime dir separated →
  `%APPDATA%\Compy\runtime` `e87ecdd`+`512dd11`; (5) single-instance lock (2nd launch focuses existing
  window) `75e4681`. (See `docs/PACKAGING_SIGNING_PLAN.md` §7a.)
  **✅ Installer REBUILT (2026-05-31 17:11) — includes #1–#4.** `npm run tauri build` →
  `Compy_0.1.0_x64_en-US.msi` (≈3.4 MB) + `Compy_0.1.0_x64-setup.exe` (≈2.2 MB) in
  `src-tauri/target/release/bundle/`; identity baked in (Compy / 0.1.0 / Pootytxng), NotSigned
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

Packaging metadata DONE (identity, not signing): `productName` "Compy", identifier
`gg.compy.app`, publisher/copyright "Pootytxng", category Utility, homepage,
short/long description in `tauri.conf.json` (schema-validated). Privacy + EULA drafted with
identity filled: `docs/PRIVACY.md`, `docs/EULA.md` (still DRAFTS — owner/legal review needed).
Remaining packaging gaps (NOT done, intentionally): no code-signing config,
EULA license-model + governing-law TBD before public distribution. (CSP is strict in config;
pre-public gate = verify the policy under the packaged build, not write it.)

**Caveat:** all QA so far is in the **dev (debug)** build. The helper-window issue was
debug-only (console subsystem); a packaged **release** build still warrants a final pass.

## How to resume

1. Read `docs/RELEASE_QA.md` — the checklist with per-subtest expected before/after.
2. Resume the BLOCKER: §1 subtests 2–4 (real elevated apply/rollback), then §2a.
3. I (Claude) verify GUI behavior via the backend: live process/IL queries, `history.json`,
   real Windows service/power state, and `%LOCALAPPDATA%\Compy\launch-debug.log`.
4. Commit after each verified unit. Branch is `main`; push only when asked.
