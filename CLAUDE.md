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

## 💰 NEW CORE — THE RECEIPTS DOCTRINE (owner decree 2026-06-12)

**Compy's mission now includes generating real income for the owner.** Canonical law:
`docs/RECEIPTS_DOCTRINE.md` — READ IT with this file; where older product-direction text conflicts,
**the doctrine wins.** Summary:

- **Identity:** from "the optimizer that promises nothing" → **"the measurement brand that proves
  everything — and gets paid when the proof says 'buy a GPU.'"** Free app = trust engine + funnel.
- **Money stack (build order):** (1) Library→web content engine on compy.gg · (2) opt-in **Receipts
  telemetry** (anonymous, default-OFF) → aggregate measured-gains data → marketing that's exciting
  AND true · (3) affiliate upgrade engine on Priorities/limiter verdicts + web reports · (4) Compy
  Pro subscription (monitoring/history/multi-rig — built dark, gaming_mode gate pattern) · (5) B2B
  shop/builder licensing. Phases, gates, KPIs in the doctrine doc.
- **REFRAMED:** honest-measurement law — "never promise" was a vow of silence; now **never
  fabricate, never claim unmeasured — and amplify measured wins LOUDLY** (share cards,
  before/afters, aggregate stats, attack-marketing vs the snake-oil lane). "Your PC is probably
  fine" defensive copy is RETIRED.
- **RETIRED:** no-telemetry absolutism → opt-in Receipts telemetry. It is a NEW outbound-network
  boundary: own spec + security review + owner sign-off before ship (stop-rule 3). Until then the
  verified zero-outbound property holds.
- **UNTOUCHABLE (now business-critical):** rollback-first · no fabricated claims · no kernel
  driver/injection · frozen risky-tweak catalog · signed-remote-rules triple gate · every LOCKED
  rule below. One Reddit thread of brand damage kills the funnel — **the gates ARE the moat.**
- **ZERO-BUDGET LAW (owner constraint):** every phase ships $0-first on free tiers; any spend is
  owner-gated with named payback + KPI trigger (domain ← waitlist signal · signing ← first paid
  surface, Azure Trusted Signing route · entity+Paddle ← Pro launch · **paid ads ← never before
  1.0**). Organic-first: friends + the owner's Discord = the seed channel.
- **KPI discipline:** every money phase defines ONE metric before build. The money plan runs on
  receipts too.
- **COUNCIL OVERSIGHT (standing, 2026-06-12):** `docs/COUNCIL_PROTOCOL.md` — the five-lens
  council (Contrarian · First-Principles · Expansionist · Outsider · Executor) reviews every
  major train: a 6-line COUNCIL STRIP closes every marathon log + Cowork audit; the full
  three-stage council convenes at money gates and on the owner's "council it." Advises, never
  overrides laws/gates/owner territory; Contrarian 🔴 flags open the report.

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
aesthetic taste calls** (e.g. theme hexes) **· security/system settings** (see the standing rule
below) **· the LOCKED gates** (frozen beta refs, `gaming_mode` flag, remote-fetch/updater, signing
keys, force-push, secrets).

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

### SECURITY / SYSTEM SETTINGS — OWNER-GATED, never autonomous (standing rule, 2026-06-10)

Modifying **security or system settings** — UAC keys (`EnableLUA`, `ConsentPromptBehaviorAdmin`,
`PromptOnSecureDesktop`), Defender, firewall, access controls, anything under
`HKLM\...\Policies\System` — is **owner territory: welfare-check FIRST, never flip it solo — not
even to diagnose, not even reversibly.** Reversibility is NOT the license here (the one exception
to the rule above): the *window* of weakened security is itself the risk, regardless of how clean
the restore is. **Diagnose elevation behavior with read-only probes only** (read the policy keys,
check token integrity level, time a hands-off elevation, read the ledger) — if a setting genuinely
must change to proceed, that's a welfare-check, full stop. Mirrored in
`docs/COWORK_HANDOFF.md` (same rule, Cowork lane).

**Precedent (why this rule exists):** during the 2026-06-10 §4 elevation-QA diagnosis, a session
autonomously flipped `ConsentPromptBehaviorAdmin` 5→2 to force UAC prompting, then restored it —
caught and verified-restored (`EnableLUA=1` / `CPBA=5` / `PromptOnSecureDesktop=1`), no harm done,
but over the line. Notably, **Fable 5's safety layer auto-switched the session to Opus 4.8 because
the work tripped its security classifier — treat that auto-switch itself as a STOP signal:** if the
model flips on security-sensitive work, halt and involve the owner.

### TOKEN DISCIPLINE — terse reports (standing rule, 2026-06-10)

Chat reports are pasted into Cowork, so verbosity burns the owner's budget twice. **Every report:**
commit hash(es) · 1–2 line what-changed · one verification line (cargo/npm/clippy/tsc/check/security)
· flags / owner-decisions. Nothing else. Mechanism, rationale, and design detail go in the commit
message + spec, NOT the chat. Don't re-explain known context or restate the board. **Rigor unchanged**
— tests/audits/verification never skipped, only reported concisely. Mirrored in `docs/COWORK_HANDOFF.md`.

## Stack & where things live

- **Tauri 2** desktop app: Rust core (`src-tauri/`) + React/TypeScript frontend (`src/`).
- **Single source of truth: `C:\Users\Kuya\code\compy\`** (Windows-side). The old
  `\\wsl.localhost\...\var\www\compy` WSL/FastAPI scaffold is **superseded/stale** — do
  not use it. WSL is not needed (and breaks anti-cheat via Hyper-V).
- GitHub remote: `Pootytxng/sentinel`, branch `main` (the repo on GitHub is still named `sentinel`
  and resolves directly — verified via the API, NOT a redirect). The GitHub **repo** rename to
  `compy` is **deferred to first-public-exposure** (bundled with the `compy.gg` domain step) — the
  repo is private, so the name is outward-facing to no one yet; the 2026-06-04 rename was app-level
  only (exe/crate/identifier/data-dir).
- Dev loop: `npm run tauri dev` (from repo root). Tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
  Fresh shells may need `export PATH="$HOME/.cargo/bin:$PATH"`. Git CRLF warnings are benign.
- Runtime data: Trust Ledger at `%APPDATA%\Compy\history.json` (Roaming); FPS IPC
  (`fps.json`/`fps.alive`) at `%APPDATA%\Compy\runtime\` (Roaming — the install/runtime
  separation, packaging polish #4; live-verified 2026-06-10). `%LOCALAPPDATA%\Compy\` is the
  NSIS per-user INSTALL dir (exe + `launch-debug.log`, debug only) — never IPC.

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

> **🌐 THE DARK SITE IS LIVE — 2026-06-12 (CC deploy, owner OAuth'd): https://compy-bd6.pages.dev**
> (bare `compy.pages.dev` was taken; moot once `compy.gg` attaches). wrangler direct upload of
> `dist-site/` (147 files), NO GitHub connection; live-verified root + Blackbook index + deep pages
> all 200. **DARK — no announce; the send is the owner's.** Live copy says 130 entries (pre-R5
> artifact by design); regen+redeploy AFTER the owner skims R5's six new entries. Board detail in
> `docs/COWORK_HANDOFF.md`.
>
> **🌙 R5 UNATTENDED MARATHON LANDED — 2026-06-12** (`AUTONOMOUS_SPRINT_2026-06-12-R5.md`, owner
> resting; spec `2026-06-12-R5-unattended-marathon.md`). Four lanes, six commits, all reversible:
> **L1** theme-correctness — last bare teal washes (Settings + onboarding arc) now follow the active
> theme via color-mix + new `theme-literal-guard` CI (`666ac77`; the eight-surface audit found the
> system otherwise coherent — taste calls queued, not churned) · **L2** four Blackbook debunks
> (run-as-admin / High-priority / defrag-SSD / GPU-OC, pin 51→55, `c14063e`) · **L3** same-type
> alias lint + the one live collision fixed (`4e339a6`) · **L4** doctrine corpus count ~120→130+
> (`92be1ed`). Suites cargo **329** · npm **300**, clippy/tsc/vite + /check + /security clean; frozen
> refs + dist-site + all gates untouched. **OWNER REVIEW QUEUE (ranked) in the R5 log** — top: the
> deploy+taste-gate pair, then a 60-second skim of the four new entries. (Same day, earlier: R4b
> landing glow-up `ebf87fc` + deploy artifact `dist-site/` built + gitignored `bc817db` — Cowork
> audited both, deploy GO banked.)
>
> **🌙 R1+R2 AUTONOMOUS MARATHONS LANDED — 2026-06-11.** R1 (`AUTONOMOUS_SPRINT_2026-06-11.md`,
> items 1–5): Leftovers detector v1+2–8 (read-only rot detection, Check section) · audit M1/M2/L1/L4
> treated · latency guilty-device receipts. R2 (`...-R2.md`, owner napping, all reversible):
> Leftovers Learn layer + CI law-guards · NIC driver win-source v1 · edge tests · **Leftovers v2
> restore BUILT DARK (double-gated: restore_gate()=false + zero IPC; Defender resolver deliberately
> absent per the security rail; adversarially audited)** · a11y · M3 retirement spec READY. Suites
> at cargo **304** · npm **256**, clippy `-D warnings` clean throughout. Review Queue for the owner
> in the R2 doc. Nothing flipped/hosted; gates + frozen refs untouched.
>
> **✅ v2-RESTORE LIVE UAC QA — FIRST TWO RESOLVERS FIELD-PROVEN (owner-present, 2026-06-11 night).**
> Harness `20ffe35` mirrors the §4 manual_elevation_qa precedent; the dark path is driven through a
> **#[cfg(test)]-ONLY** thread-local RAII gate-bypass seam (compiled out of shipped binaries —
> `restore_gate()` untouched + still false, pinned by a new deterministic test). Live ground-truth
> `history.json` + registry evidence: **W32PS loop PASS** (seed 0x26 → flagged → restore receipt
> `leftover_adopted` + snapshot `prior_value=38` → rollback put 0x26 back EXACTLY → stock 2) ·
> **MPO loop PASS** (5 → flagged → restore-DELETE w/ `prior=5` → rollback 5 exact → absent; the
> absent-prior arm live-proven) · **memcompress known limit CONFIRMED** (non-elevated `Get-MMAgent`
> prior read refuses BEFORE elevation, zero receipt — elevated-prior-read design need logged in the
> R2 Review Queue, deliberately unfixed). QA log: `526aeaf` in the R2 doc. Remaining before any gate
> flip: the other resolvers' loops + owner sign-off. Six `QA ·` receipts remain in the live ledger
> (cleanup offered). **Same-night owner-feedback overlay pair:** (1) **density dead-knob lockout
> FIX** (`48ee900`) — stale `compy_overlay_v2="0"` (the removed New Look hub's leftover) pinned the
> overlay to the CLASSIC layout, which ignores density; CDP-probed live (the relay was healthy —
> shared localStorage + cross-window storage event both proven on this rig), fixed with the
> `a335f13` self-heal pattern; the stale-flag lockout class is now closed codebase-wide.
> (2) **Background On/Off** (`1aaa342`) — owner-asked see-through overlay: no plate, RTSS-outline
> legibility, control beside Density in Play + Settings, same storage relay. Suites now cargo
> **313** · npm **257**, clippy/tsc/vite clean.
>
> **🌊 2026-06-10/11 OWNER-FEEDBACK WAVE LANDED (`main` @ `cc2a1ba`) — THE SENDING KIT IS BEHIND.**
> Built from the Cowork 3-lane triage (`docs/superpowers/specs/2026-06-10-tester-feedback-overview.md`)
> + two live owner reports: **Fix-tab reword** (`f1a1f27`, per-rig framing, no gains promise) ·
> **Lab welcoming pass** (`7d9f52a`, knobless welcome band, doorknob-pinned) · **driver freshness
> advisory in Check** (`078bc1d`, honest age, copyable vendor URL, zero new IPC) · **structured
> feedback capture in Export** (`bd7520d`+`cc2a1ba`, 3 optional prompts → "## Tester feedback",
> 4000-char boundary cap, nothing auto-sent) · **overlay stranded-monitor FIX** (`f6c0fce` — owner
> hit live: FreeSync OSD toggle swapped primary; corner math now anchors to primary_monitor via
> shared pure helper, show_overlay pulls it home). cargo **266** · npm **240** · clippy+tsc+vite
> clean · /check + /security run per phase. Owner eyeballs pending: Export feedback flow ·
> overlay returns to main monitor · driver-freshness pass.
> **✅ KIT RE-CUT (owner-directed, 2026-06-11) from `69e91fe`** — carries the FULL wave above.
> **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
> `39F08D75A939CF722B52CCC7E5BF9010F7C8377744E2ACF08E3703600C7FFE93`** (2,775,197 B) + MSI
> (4,149,248 B) — SUPERSEDES `5F2549E7…` everywhere incl. the kit + the Drive-hosted copy.
> Triple-hash-verified (bundle = loose kit = in-zip); suites green on the exact HEAD (cargo **266**
> · npm **240** · clippy+tsc clean); built `CODEGEN_UNITS=256`, no OOM. Frozen refs (`16069fa`,
> `beta/private-beta-001`) re-verified untouched. **NOTHING hosted/sent — re-hosting the Drive
> file + tester comms stay the owner's.**
> - **EEE apply bug (`5041fe8`, elevation/mutation boundary — Cowork audit pending):** (1) honest
>   elevation attribution — a real UAC decline (launch error 1223) is now the ONLY outcome that says
>   declined (`ELEVATION_DECLINED_MSG`, shared with the §4 test seam); a non-zero exit says "you
>   approved... the operation itself failed" and a TEST enforces the word *cancel* never appears there
>   (the old code had the two exactly backwards — accepted-but-failed showed "Did you cancel the UAC
>   prompt?"). (2) EEE resolution — apply writes the DRIVER'S OWN disabled token (ValidDisplayValues;
>   unknown vocabulary → gate, never guess), enumeration matches registry keywords (`*EEE`/`GigaEEE`/
>   `EEELink`…) + broadened names, detection judges by the same comparator, and a new
>   `eee-switch-exposed` HardwareInfo gate marks switchless rigs "Not for this rig" (incl. unplugged-
>   cable rigs that were previously offered a guaranteed-fail apply). Boundary intact: snapshot-before-
>   mutation, 3-field `EeeNicSnapshot` unchanged (old ledger entries roll back identically), no new
>   mutation primitive, scripts stay `exit`-free (§4-batchable). cargo **252** · /check + /security
>   clean. **PENDING: tester Export (adapter inventory) → pin the exact NIC property name + alias test.**
> - **Overlay frametime graph (`4d0ddfd`, frontend-only):** min/max auto-scale (stable frametimes
>   stretched to full-height noise) → FIXED RTSS-style scale (ceiling ≈3.5× frame budget, 20–50 ms;
>   unknown refresh → 0–50 ms) + a faint dashed frame-budget line (absent, never guessed, when refresh
>   unknown). Refresh relays main→overlay via the EXISTING localStorage channel — zero new IPC. Play/
>   deep-monitoring verified: no session-length frametime view exists to fix (aggregates by design;
>   `stutter_timeline` data exists unrendered — future scoping option). npm **234**.
> - **🎯 FPS SELF-MEASUREMENT FIX (`af7cc02`, measurement core — Cowork audit pending):** tester
>   Export root-caused the ~2× live read: a PoE session recorded as "msedgewebview2.exe · 329 avg" —
>   Compy's OWN WebView2 renderer out-presented the game and won the dominant-presenter pick (the
>   denylist comment promised webview exclusion but only listed compy.exe; Tauri webviews are
>   msedgewebview2.exe children). Fix: webview denylisted + the pick extracted into pure
>   `select_game_presenter` with guard tests (Compy's own processes can NEVER win; all-denied →
>   honest None). Sessions/comparisons/tuning attribute correctly now; affected testers' old
>   webview-attributed sessions remain in their local history (honest record). Diagnosis doc:
>   `2026-06-10-fps-double-read-DIAGNOSIS.md` (RESOLVED). **COMPLETED by `c3c8300` (owner GO):**
>   trackers keyed per **(pid, swapchain)** (payload `pIDXGISwapChain`, fail-open to pid-keying on
>   parse failure) + two-stage pure selection (dominant allowed process → its dominant chain) with
>   deterministic tie-breaks; the 323/161 signature is a synthetic regression test (pid-keying reads
>   ~322/161, per-chain reads true ~161 with fps≈low1). cargo **260** · clippy clean · FpsReport
>   shape unchanged. ✅ **FIELD-CONFIRMED 2026-06-10** — owner live game test: overlay ≈ the
>   in-game/Steam counter; the self-measure bug is dead in the field.
> - **Also landed same day:** EEE I226-V pin (`059d0d7` — Intel On/Off vocabulary applies + stays
>   active; dev-rig Realtek inventory pinned; speed-enum excluded) · Export share honesty
>   (`4fe46cb` — "Copy full report" + "Copy summary card" replace the misleading "Copy for
>   Discord"). cargo **258** · npm **234** · clippy+tsc clean.
> - **✅ KIT RE-CUT (owner-directed, 2026-06-10 18:17) from `fc940fe`** — carries the FULL
>   tester-feedback wave (EEE attribution + I226-V pin · overlay frametime fixed-scale · FPS
>   self-measurement + (pid,swapchain) keying `c3c8300` · export-share UX). NOTE: owner's order
>   named `d883c4f`; cut from HEAD `fc940fe` instead so the owner-GO'd swapchain completion rides
>   (delta = c3c8300 + docs only — flagged in the report). **NSIS `Compy_0.1.0_x64-setup.exe`
>   SHA-256 `5F2549E7EDD6BC94440D3C24ECCC0CB784005DAC520DE2490BB81F3260021F18`** (2,774,150 B) +
>   MSI (4,145,152 B) — SUPERSEDES `E8D5588B…` everywhere incl. the kit. Triple-hash-verified
>   (bundle = loose = in-zip); suites green on the exact HEAD (cargo **260** · npm **234**);
>   QA-evidence claim verified in code (elevation change = message attribution only; EEE keeps
>   reads→one-PS exit-free; FPS read-only). Frozen refs re-verified. **THIS is the send-ready kit;
>   the send stays the owner's.** ✅ FPS field confirmation LANDED (owner live test, see above).
>   **🚀 BETA SENDING (2026-06-10/11):** owner hosts this kit on **Google Drive** + DMs testers the
>   link + `beta-kit/invite-message.txt` (Drive, not Discord — a tester's MalwareBytes Browser Guard
>   false-blocked Discord's CDN). Owner-side from here: collect Exports + one-sentence answers.

> **🧪 AUTONOMOUS IMPROVEMENT SPRINT — 2026-06-10 (`main` @ `d51f6f0`+).** Owner-mandated broad
> reversible sprint; full running log + ranked owner-deferred list in
> `docs/superpowers/AUTONOMOUS_SPRINT_2026-06-10.md`. Landed (all green, each pushed): design-law sweep
> (zero violations); **hardening** — `gpuRunningHot` 14-day recency window + `measureTuning`
> zero-session honesty (`4d01be9`), receipt-title cap at the webview boundary (`2ab405d`); **a11y** —
> dialog semantics on the 3 content modals (`19c4fbb`); **perf** — `AmbientBackdrop` stops polling
> `get_fps_status` unless step-aside is on (`387958f`); **knowledge growth** — 3 honest Library debunks
> (SMT-off / NVIDIA max-perf / CPU affinity, `63e8a54`, tweak curation pin 43→46, NOT appliable-catalog
> growth); **scope-only spec** for the tuning follow-ons + wave-2 share card (`d51f6f0`). cargo **244** ·
> npm **230** · clippy+tsc clean. Locked gates + security/system settings + frozen refs all untouched.
> Owner-deferred (copy/taste, see the log): site hero "Faster frames" tension w/ the no-promise
> positioning; the "116 entries" → ~120 count; a minor README §5 wording nit.

> **✅ §4 LIVE ELEVATION QA — ALL THREE STEPS DIRECTLY EVIDENCED + DETERMINISTIC CANCEL TEST —
> 2026-06-10 (`main` @ `2b912b0`).** The full apply-all elevation QA passed with ground-truth
> `history.json` evidence (verified via a committed `#[ignore]`d live-QA harness, `manual_elevation_qa`):
> **(1) one prompt** — a 2-elevated-item batch wrote two ledger receipts **22µs apart** with
> `elevation_prompts:1`; **(2) per-item rollback** — rolling back only HAGS flipped it to `rolled_back`
> while its sibling stayed `applied`; **(3) UAC cancel honest** — clicking No gave `applied:1, skipped:1`,
> the elevated item skipped with "Elevation did not complete," and the ledger gained ONLY the
> non-elevated item (+1 entry — the cancelled item is never recorded, fail-safe). The cancel ARM is also
> CI-proven deterministically via a test-only `ForceElevationError` seam (`#[cfg(test)]`, compiled out of
> the shipped binary). cargo **243** green. NOTE: this dev rig auto-prompts normally (a real UAC dialog
> appears — earlier `applied:2` runs were reflexive Yes-clicks, owner-confirmed, NOT silent elevation or
> a bug). Test artifacts: the harness leaves `QA ·`-tagged entries in the live ledger (cleanup offered).
>
> **✅ §4 GATES PASSED + BETA-CAPABLE REBUILD + KIT RE-ZIPPED — 2026-06-09 (`main` @ `e19db67`).**
> Owner live elevation QA = GREEN (ONE UAC prompt per batch · per-item rollback confirmed · UAC-cancel
> honest — all three now directly evidenced per the 2026-06-10 banner above) and the tray QA is done →
> the two §4 ship gates are CLOSED. Rebuild from `e19db67`
> (`CODEGEN_UNITS=256`, 17.1 GB free, 38 s; suites re-verified first: cargo **242** · npm **226**).
> **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
> `AF10BEC1F95ACB4327A8AFE8E33325D60F4298F81615D901760C199E63921D1B`** (2,761,175 B) + MSI
> (4,124,672 B) — SUPERSEDES `6C24DB71…` and, for distribution, the kit's old `0D6A5C9A…`. **This build
> CAN feed a beta send (owner's call on the send itself):** `beta-kit/Compy_0.1.0_x64-setup.exe` +
> `Compy-Beta-Kit.zip` re-zipped same-structure (installer + guide PDF; invite text beside) and
> hash-verified — bundle = kit copy = inside-zip ALL `AF10BEC1…` (stale-copy trap closed). Frozen beta
> refs (`16069fa`, `beta/private-beta-001`) verified untouched.
> - **✅ KIT RE-CUT (owner-directed, 2026-06-10 08:11) from `17fd64d`** — folds in the autonomous-sprint
>   hardening + Hearth "Warm Ember". **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
>   `E8D5588B99E84831C278FA446D21DEFBD89BB0B16E2A11069B0F176FF0C50A47`** (2,761,462 B) + MSI
>   (4,128,768 B) — SUPERSEDES `AF10BEC1…` everywhere incl. the kit. Triple-hash-verified (bundle =
>   loose kit copy = inside `Compy-Beta-Kit.zip`); suites green on the exact HEAD (cargo 244 · npm 230).
>   **No re-QA needed, verified not assumed:** the only shipped mutation-path change since the QA'd
>   `e19db67` is the receipt-title cap (shape-preserving, test-pinned); the elevation-QA seam/harness
>   are `#[cfg(test)]` — compiled OUT of this binary. Frozen refs re-verified untouched. **THIS is the
>   send-ready kit; the send stays the owner's.**

> **⚡ §4 ONE-ELEVATION BATCHING BUILT (QA-GATED, NOT SHIPPED) — 2026-06-09 (`main` @ `b4d2564`).**
> The parked apply-all batching landed per the recorded design (spec `2026-06-06-beta-feedback-3.md`
> §4 status block; owner GO same day). "Apply all safe fixes" now elevates ONCE for the whole batch:
> thread-local RAII deferral sink in `run_elevated_powershell` (capture-instead-of-elevate; disarms on
> drop/panic; refuses nesting; safe because every batchable apply_* is reads → ONE PS → return, so
> deferral causes no partial mutation) → ONE inline elevated `-Command` (EAP=Stop + per-rec try/catch +
> `id:ok|fail` receipts to a result FILE) → ledger receipt per CONFIRMED item only (fail/missing both
> skip — fail-safe), per-item rollback granularity unchanged. `power-ultimate` (the only exit-using
> elevated cmd, moderate-tier) HARD-rejected from batches; phase-1 non-elevated receipts saved BEFORE
> elevation (UAC cancel never costs them); decline = honest per-item skip. `apply_recommendation` and
> the batch share ONE dispatch + receipt builder (no drift). Frontend: `applyBatch` = one
> `apply_recommendations_batch` invoke; consent sheet/summary unchanged. **cargo 242 · npm 226 ·
> clippy+tsc clean · /check (1 hardening fix folded: checked command attribution, `b4d2564`) +
> /security clean (zero new primitives; capabilities/config untouched).** Commits: `60ae751` backend ·
> `a7920bf` frontend · `b4d2564` hardening. **GATES: does NOT ship to testers until (1) its own
> elevation QA on a UAC-on machine — one prompt → per-item receipts → per-item rollback → UAC-cancel
> honesty — and (2) the Cowork elevation/mutation-boundary audit pass. beta-kit/ + frozen refs
> (`16069fa`) untouched.**

> **🔬 TUNING TRAIN VERIFIED + measureTuning FILTER FIX + COWORK HANDOFF + OWNER-CLARITY REBUILD —
> 2026-06-09 (`main` @ `86315e2`).** The tuning-guides train (`ad4d05c`..`272f195`, spec
> `docs/superpowers/specs/2026-06-08-tuning-guides-stability-measurement.md`) was RE-VERIFIED after the
> prior session's report was lost to a PC restart: cargo **232** green · npm **226** green · clippy
> zero warnings · tsc clean · fresh /check + /security clean. The 4 pre-existing Fix-comparison
> regression tests in `comparison.rs` are **diff-proven byte-identical** across the train and passing —
> the comparison-engine extension did not regress the Fix path. The one medium /check finding was fixed
> same-day (`86315e2`): `measureTuning` now filters INSIDE the module (only the tune's OWN result —
> `kind === "tuning"` + same game — can confound; stale fix / fix-era / other-game results never flip
> the Lab readout), pinned by a regression test. (The then-accepted LOW — `gpuRunningHot` had no
> recency window — was CLOSED in the 2026-06-10 sprint, see banner above.) **Cowork handoff doc added**
> (`402ef59`,
> `docs/COWORK_HANDOFF.md`) — onboards every future Cowork session (relay model + style + duties + board).
> - **✅ REBUILD (2026-06-09 21:06):** owner-clarity build from `86315e2` (`CODEGEN_UNITS=256`, 14.5 GB
>   free, 38 s). **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
>   `6C24DB7196D7CDFDFFD3E37ECA5490300E3D7C131E9299983E349934913C7435`** (2,750,267 B) + MSI
>   (4,112,384 B) — SUPERSEDES the 2026-06-08 18:15 `08F540F8…` build. Owner-clarity only (installed app
>   = current `main`); `beta-kit/` (last write 06-07 19:05) + frozen refs (`16069fa`) UNTOUCHED; tray +
>   §4 apply-all QA still pending before any tester ship.

> **🧰 LIVE-DEMO POLISH TRAIN + OWNER-CLARITY REBUILD — 2026-06-08 (`main` @ `b957beb`).** A run of
> small frontend fixes landed on `main` (each hot-reloaded into the live `npm run tauri dev` per the
> standing dev-build workflow — see memory [[live-dev-build-standing-workflow]]), then folded into ONE
> owner-clarity rebuild. All green; frontend-only unless noted; locked gates untouched.
> - **Network card text fix** (`21cfe89`) — `.detail-value` no longer breaks mid-word (overflow-wrap/
>   word-break: normal); Network card STACKS the long adapter name over its status; de-duped status.
> - **Tray idempotent log** (`2cd3793`) — track the icon's shown state; only `set_visible` on a real
>   change → kills the startup "Error removing system tray icon" noise (dev-log only, no behavior change;
>   the ONE Rust change in this train).
> - **Settings lockout fix + New-Look hub removal** (`b92f49b`, `46cb9b0`) — the gear always opens
>   Settings (`settingsActive = showSettings && hw!==null`; `onOpenSettings` always wired), and the
>   user-facing "New Look (Preview)" flag hub is GONE (parity closed: Fix `57f2e21`, Play `aaa4f79`).
>   The `compy_*_v2` flags stay DEFAULT-ON + read localStorage once at startup = hidden dev A/B path
>   (no UI). `settingsV2`/`compy_settings_v2` fully removed (self-heals a locked-out user). Post-beta
>   cleanup recorded: [[retire-classic-surfaces-cleanup]].
> - **"How we grade" glossary** (`b957beb`) — Real/Placebo/Risky are now DEFINED for the reader: a
>   visible "How we grade" key on Learn + Autopsy, hover tooltips on every verdict chip, and a
>   searchable "How Compy grades things" entry — ONE shared source (`src/data/verdict-glossary.ts`),
>   can't drift. Safe aliases keep it out of the autopsy matcher (tested).
> - **✅ REBUILD (2026-06-08 18:15):** owner-clarity build from `b957beb` (`CODEGEN_UNITS=256`, 15.4 GB
>   free). **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
>   `08F540F8FC7521FAAE6844E1DA7F915EC0DB42F88C46F3C2E5A9A3D57E868920`** (2,741,654 B) + MSI —
>   SUPERSEDES the 16:00 `4F2DAB74…` build. Owner-clarity only (installed app = current `main`);
>   `beta-kit/` + frozen refs (`16069fa`) UNTOUCHED; tray + §4 apply-all QA still pending before any
>   tester ship. Cowork handles the reinstall.

> **🖥️ "YOUR HARDWARE" GRID RESTORED TO THE REAL HOME (owner regression) + REBUILD — 2026-06-08 (`main` @ `7b8758b`).**
> Owner caught it live: the detailed hardware cards were NOT on the shipped Home. The CommandCenter
> (`compy_home_v2`, release default) showed only the one-line `cc-rig` header summary; the full
> "Your hardware" card grid (incl. the elastic §6 Network card) lived ONLY in the classic Overview
> (flag-off), so it vanished from the default Home at redesign-ship. (Owner had explicitly signed off to
> KEEP that grid.) Fix (`7b8758b`, spec `docs/superpowers/specs/2026-06-08-restore-hardware-grid-home.md`,
> committed `5ac7ae7`): extracted the cards into a SHARED `src/surfaces/HardwareGrid.tsx` (+
> `hardware-format.ts` for `fmtGB`/`fmtGHz`) rendered in BOTH the classic Overview AND the CommandCenter
> Home (as a "Your hardware" section below Last Session) — one source, can't drift again. Exported
> `HardwareInfo`/`GpuInfo` from App; CommandCenter's `hw` prop widened `HwSnapshot`→full `HardwareInfo`
> (type-only import, erased → no runtime cycle); test mock expanded. The §6 Network card now shows on the
> DEFAULT Home. Responsive via the existing elastic `.grid` (flex-wrap, `flex:1 1 260px`, `min-width:0` →
> single column at the 380px floor). Frontend-only, tokens-only, ZERO new IPC; tsc+vite clean, npm **192**
> green, /check clean. **OPEN (owner): eyeball the grid + its reflow at the floor.**
> - **✅ REBUILD (2026-06-08 16:00):** owner-clarity build from `7b8758b` (`CODEGEN_UNITS=256`) folds in
>   THIS grid restore on top of game-mode + tray + the bench. **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
>   `4F2DAB74AF468A1C8E8B9FE3391B48CA4D79E0A839C8F44D0120236EC351CD49`** (2,741,048 B) + MSI — SUPERSEDES
>   the 13:33 `64ED16C4…` build. Still owner-clarity only (installed app = current `main`); `beta-kit/` +
>   frozen refs (`16069fa`) UNTOUCHED; tray + §4 apply-all QA still pending before any tester ship.

> **🎮🪟 GAME-MODE PERSISTENCE FIX + OPT-IN TRAY LANDED, + ONE OWNER-CLARITY REBUILD — 2026-06-08 (`main` @ `1ede299`).**
> Two owner items (spec `docs/superpowers/specs/2026-06-08-game-mode-fix-and-tray.md`, committed `c60f70c`):
> - **(A) Game Mode persistence fix** (`d8c702e`) — correctness-class. Root cause of "never stays on
>   through reboot / kept needing re-apply" (owner export: applied 5×) was NOT a key-name mismatch
>   (detect+apply already agreed on `AutoGameModeEnabled`): the apply wrote only HALF the pair, leaving
>   `AllowAutoGameMode=0` — the master Windows reconciles against on login, which reset
>   `AutoGameModeEnabled` to 0 on reboot. Fix mirrors the Settings UI: apply/detect/rollback the PAIR
>   (`AllowAutoGameMode` + `AutoGameModeEnabled`) via shared `actions::` consts; `Snapshot::GameMode`
>   gained `#[serde(default)] prior_allow` (pre-fix typed ledger entries still deserialize → rollback-
>   first integrity intact). Read-after-write regression test (real HKCU, self-restoring) + pre-fix-
>   snapshot deserialize test. Rollback contract unchanged; non-elevated HKCU only; old ledger dupes
>   left (honest history) — detection just stops generating new ones. **Live-proven on the AMD dev rig;
>   owner reboot-persist confirmation still nice-to-have but the mechanism is verified + doc-backed.**
> - **(B) Opt-in system tray** (`1ede299`) — §1-COMPATIBLE BY DESIGN. Default OFF (close = full §1 clean
>   exit). Settings → Behavior toggle makes close HIDE to a VISIBLE pulse-C tray icon (icon visibility
>   tracks the flag — no stray icon when off); right-click Show/Quit (Quit = full §1 teardown);
>   left-click + relaunch-while-trayed restore the window (reuses the §1 single-instance hardening,
>   deduped into `tray::show_or_recreate_main`). v1 hover = TEXT tooltip with live stats from the
>   EXISTING monitoring tick, zero new IPC ("Compy · 178 fps · 1% low 133 · gpu 65°C" / "monitoring
>   off"; GPU temp only, never CPU). One tiny `set_close_to_tray(bool)` IPC syncs the persisted pref to
>   the close gate (default-OFF `AtomicBool`, unit-tested via a GUI-free pure store split). Rich visual
>   flyout = recorded **v2**, not now. `tauri` gains the backend-only `tray-icon` feature.
> - **Verify:** cargo **226** green + zero warnings; §1 heartbeat regression still passes; npm **192**
>   green + tsc/vite clean. **/check + /security clean on BOTH trains.** Capabilities/CSP/updater/
>   remote-fetch/locked-gates all untouched.
> - **✅ ONE OWNER-CLARITY REBUILD (2026-06-08 13:33):** `npm run tauri build` (`CODEGEN_UNITS=256`,
>   14 GB free) from `1ede299` → folds in A + B **+ the post-rebuild bench (Confirm Dialog, overlay §2,
>   rail fix) that was previously NOT re-bundled.** **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
>   `64ED16C4CA4C1622EB3AC9B09C910E85AE6BB2B8F66E33297432BAA8260FAB35`** (2,741,750 B) + MSI
>   (4,100,096 B) in `src-tauri/target/release/bundle/`. **This is for the OWNER's clarity (installed app
>   = current `main`) — NOT a beta send: the `beta-kit/` zip + frozen beta refs (`16069fa`) are
>   UNTOUCHED.** Tray + the §4 apply-all batching still want their own manual QA before any tester ship.
> - **OPEN (owner, non-blocking):** install this build + eyeball the tray (toggle on → close → tray icon →
>   hover tooltip while a game runs → Show/Quit); optional Game-Mode reboot-persist spot-check.

> **🔧 POST-REBUILD BENCH (reversible polish on `main`, NOW folded into the 2026-06-08 13:33 owner-clarity build above; beta-kit still NOT re-bundled) — 2026-06-08 (`main` @ `faa4c52`).**
> All frontend-only, all green (npm **192**; cargo untouched at **223**). These rode the bench AFTER the
> blessed `6b39c31` rebuild, so the shipped kit installer (NSIS `0D6A5C9A…`) does NOT include them — a
> future owner-timed rebuild will fold them in:
> - **Themed Confirm Dialog** (`4e6a078`) — killed the native `window.confirm` ("tauri.localhost says");
>   one shared `ConfirmProvider`/`useConfirm` (promise-based) across all 5 sites (App apply+rollback, Check,
>   FirstCheck, SessionDebrief); ink-law buttons; Esc/Enter/focus-trap/backdrop; outcome-stating copy. Zero
>   native confirm/alert left in `src/`.
> - **Overlay §2** (`fe8d1a4`) — "1%" → "1% low"; Full density adds `cpu <pct>%` (USAGE only, never CPU
>   temp); standard unchanged. Zero new IPC (cpu already fetched).
> - **Elastic §8 — rail mis-render fix** (`faa4c52`) — the reported "stray icon tile" on Check was
>   `nav.rail` itself collapsing to a ~50px box at 720–900px: a LEGACY `@media (max-width:900px)` block
>   (pre-elastic) set `.rail{width:50px}` and sat AFTER the elastic ≤1080 medium-strip block, overriding it.
>   Deleted the legacy block → rail is always exactly vertical-column (>1080) / horizontal-strip (720–1080) /
>   bottom-bar (<720). **Owner drag-verify pending.**
> - **§4 one-elevation batching — PARKED (owner: fresh, 2026-06-08).** Not beta-blocking (apply-all works
>   today via N UAC prompts). The verified design + de-risking (sink-to-defer + ONE inline elevated
>   `-Command` + per-item try/catch + result-file IPC; only `exit`-user `power-ultimate` is moderate-tier →
>   excluded) is recorded in `beta-feedback-3.md §4` (`5757950`) for a rested session — audited
>   mutation/elevation boundary, rides its OWN elevation QA, does not ship until that passes.

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
>   XButton1 + eyeball the VRR loop. (~~Wayfinding §1-forward-button follow-up~~ — ✅ CLOSED
>   2026-06-11, `03ff98b`: Forward beside Back in all three headers, Alt+Right + XButton2,
>   browser-model dual stack.)
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
> - **OPEN (owner-only):** live smoke of the rebuilt installer; the post-beta full rail-merge.
>   (~~Hearth + warm final hexes → kernel §4~~ — ✅ CLOSED 2026-06-10: Hearth = "Warm Ember" locked,
>   `7dcd7de`, contrast guard 4/4.)
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
