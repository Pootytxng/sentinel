# CLAUDE.md — Compy project brief & resume point

<!-- SIZE + LAW BUDGET. This file auto-loads on EVERY session boot in this repo, so every byte is
     paid forever. Trimmed 34.5 KB → 23.5 KB on 2026-08-05: the cut material was (a) duplication of
     ~/.claude/CLAUDE.md, which now loads in every session on this machine regardless of root, and
     (b) the expired Fable-5-window sections (that window closed ~2026-07-07).
     `src/claude-md-laws-guard.test.ts` fails the build if a required law marker disappears from this
     file or if it grows past its byte budget. Add project LAWS here; put anything narrative,
     historical, or explanatory in docs/ and link it. -->

> **Auto-loads into every Claude Code session rooted in this repo** — durable, in-git, portable.
> Fresh session: read this, then `docs/RELEASE_STATE.md` (live gate state) + `docs/BACKLOG.md` (next).
> Treat every file/line claim here as point-in-time — verify against current code before asserting.
>
> **Universal behavioral laws live in `~/.claude/CLAUDE.md`** (challenge duty · response shape ·
> autonomy floor · tracking · toolchain-over-prose). They load in every session on this machine and
> are NOT repeated here. This file carries only what is true of *Compy specifically*.

> **📍 LIVE GATE STATE → `docs/RELEASE_STATE.md` is authoritative.** Single current-truth matrix for
> every gate, artifact, and release blocker (each row carries a `file:line`). **Where any older text
> in this file or any other doc disagrees about *current* gate state, RELEASE_STATE.md wins.** Deep
> legacy strata live in `docs/CHANGELOG.md` and are point-in-time records. Gaming Mode is LIVE (field
> QA 10/10, owner signed off 2026-07-14 — GAMING_MODE_QA.md); service-suspend + debloat are ARMED.

> **RENAMED Sentinel → Compy (2026-06-04)** for brand/SEO collision (SentinelOne / MS Sentinel /
> Valorant). Identifier `gg.compy.app`, exe `compy.exe`, crate `compy`/`compy_lib`, data dir
> `%APPDATA%\Compy`, domain `compy.gg`. First launch COPY-migrates `%APPDATA%\Sentinel` → `%APPDATA%\Compy`
> (`migrate_legacy_data_once` in `lib.rs`; **the legacy literal MUST stay "Sentinel"** — it is the
> source). Pre-rename git history, the WSL scaffold path, and the old data dir still say "sentinel":
> expected, not a leftover. The GitHub repo rename is deferred to first-public-exposure.

## What Compy is

An all-in-one PC optimization & **safety** dashboard for the everyday, **non-technical gamer** (not
sysadmins). Positioned as *"a rollback-first Windows configuration safety layer that happens to
optimize."* Core differentiator: **hardware-aware, per-rig** recommendations — it reads the actual PC
and tailors safe settings to it, instead of generic YouTube/Reddit "best tweaks" that break things.
UX promise: plain-English "for YOUR hardware" framing, safe + reversible by default, rollback over
raw control. No jargon, no regkey dumps. **Never invent or assume hardware specs.**

## 💰 Receipts Doctrine — canonical: `docs/RECEIPTS_DOCTRINE.md`

Compy's mission includes generating real income for the owner. **Read the doctrine doc for phases,
gates and KPIs; where older product-direction text conflicts, the doctrine wins.** The parts that
must be in context at all times:

- **Identity:** "the measurement brand that proves everything — and gets paid when the proof says
  'buy a GPU.'" Free app = trust engine + funnel. Money stack build order and KPIs: doctrine doc.
- **Honest-measurement law (REFRAMED):** **never fabricate, never claim unmeasured — and amplify
  measured wins loudly.** "Never promise" was a vow of silence and is retired, as is the "your PC is
  probably fine" defensive copy.
- **Outbound:** no-telemetry absolutism is RETIRED — Receipts telemetry is opt-in, default-OFF, and a
  NEW outbound boundary (own spec + security review + owner sign-off before ship).
  The zero-outbound claim is retired too <!-- outbound-claim-allow -->: the signed update check has
  been live since 2026-07-22 (`tauri.conf.json` `plugins.updater.endpoints`), switchable off in
  Settings → About. **Never write an absolute offline claim:**
  `src/outbound-claim-guard.test.ts` fails the build on one.
- **ONE MUTATION BOUNDARY (mechanical, 2026-08-03):** Compy changes Windows from
  `src-tauri/src/actions.rs` and **nowhere else** — snapshot → apply → verify → receipt → rollback.
  `src/mutation-boundary-guard.test.ts` fails the build on a registry write, service/task change,
  power-plan switch or package removal anywhere else in `src-tauri/src`. Written because
  `set_startup_entry_enabled` sat in `lib.rs` writing `StartupApproved\Run` directly with a
  SYNTHESISED value, destroying the timestamp bytes — the prior state was unrestorable *in
  principle*, and rollback-first lived only in prose, which does not fail a build. Line-level escape
  hatch for copy that merely NAMES a command: `mutation-boundary-allow` (greppable).
- **ZERO-BUDGET LAW:** every phase ships $0-first on free tiers; any spend is owner-gated with named
  payback + KPI trigger. **Paid ads: never before 1.0.** Every money phase defines ONE metric before
  build.
- **UNTOUCHABLE (business-critical):** rollback-first · no fabricated claims · no kernel
  driver/injection · the tweak rails · signed-remote-rules triple gate · every LOCKED rule below.
  One Reddit thread of brand damage kills the funnel — **the gates ARE the moat.**
- **Council oversight:** `docs/COUNCIL_PROTOCOL.md` — five-lens council (Contrarian · First-Principles
  · Expansionist · Outsider · Executor). 6-line COUNCIL STRIP closes every marathon log + Cowork
  audit; full council at money gates and on the owner's "council it." Advises, never overrides.

## Working mode

**Authoritative policy: [`docs/RELEASE_AUTONOMY.md`](docs/RELEASE_AUTONOMY.md)** — one owner
authorization covers the complete reversible release-engineering train, and it binds Claude Code,
Cowork, Codex, and future agents in this repo. It **overrides the superpowers brainstorm → spec →
plan → TDD ceremony** for greenlit or clearly-scoped work: build → verify → commit → push → next,
batching questions to the end. A failed gate triggers repair, not owner escalation. Preserve every
failed candidate before reset or abandonment. `AskUserQuestion` is for genuine forks in **owner
territory** only; engineering forks you resolve yourself and record the reasoning.

**Owner-bound in this repo** (on top of the universal floor in `~/.claude/CLAUDE.md` §3):
1. **Secrets / signing** — the Ed25519 private key or any secret never enters the repo / `.env*` / CI.
2. **Shared or irreversible git** — never move the frozen beta refs (`16069fa`).
3. **Ships to OTHER people's machines** — shipping unverified *mutation* code to beta/public, arming
   remote-fetch, enabling the updater, or loosening capabilities/CSP.
4. **Money.** (Aesthetic taste is NOT on this list — see the decree below.)
5. **Security / system settings** — the standing rule below.
6. **The LOCKED gates** below, and **reshaping a core feature outside the discussed topic** — send a
   one-message **WELFARE CHECK** (*what / why / blast radius*). Gauge: *would this leave the owner
   upset if he saw it without warning?* If no → proceed, report after.

**If a task CAN be done by us, DO IT** — never redirect to the owner anything we can handle. These
stops are **cumulative, not a ceiling**: "reversible" never licenses crossing a security or
ship-to-others boundary. Rigor is unchanged — verification is never skipped.

### TASTE IS MINE TO EXERCISE, HIS TO OVERRULE (owner decree 2026-08-07)

Aesthetic calls are **not** owner-gated and must never be parked on him by default — his words:
*"i do not want taste calls to exclusively fall on me id like to see youre ideas and consider your
taste calls as well."* Make the call, ship it, and hand him a **viewable before/after**
(`SendUserFile`, per `.claude/skills/self-review`) so he can veto on sight — deciding is mine,
seeing is his, and prose describing a look is neither. Ask first only where taste stops being taste:
the **product name, logo, and price presentation** (brand/money), and anything that reaches other
people's machines. A fork genuinely worth his eye ships **with a recommendation attached**, never as
a menu. Guarded by `scripts/taste-autonomy-guard.test.mjs` — this decree cannot silently re-close.

### SECURITY / SYSTEM SETTINGS — OWNER-GATED, never autonomous (standing, 2026-06-10)

Modifying **security or system settings** — UAC keys (`EnableLUA`, `ConsentPromptBehaviorAdmin`,
`PromptOnSecureDesktop`), Defender, firewall, access controls, anything under
`HKLM\...\Policies\System` — is **owner territory: welfare-check FIRST, never flip it solo — not even
to diagnose, not even reversibly.** Reversibility is NOT the license here (the one exception to the
rule above): the *window* of weakened security is itself the risk, regardless of how clean the
restore is. **Diagnose elevation behavior with read-only probes only** (read the policy keys, check
token integrity level, time a hands-off elevation, read the ledger); if a setting genuinely must
change to proceed, that is a welfare-check, full stop. Mirrored in `docs/COWORK_HANDOFF.md`.

**Precedent:** during the 2026-06-10 elevation-QA diagnosis a session autonomously flipped
`ConsentPromptBehaviorAdmin` 5→2, then restored it — caught and verified-restored, no harm, but over
the line. The model's own safety layer auto-switched that session because the work tripped a security
classifier: **treat a model auto-switch on security-sensitive work as a STOP signal** — halt and
involve the owner.

### Reports, subagents, self-review

- **Terse reports** (chat is pasted into Cowork, so verbosity bills twice): commit hash(es) · 1–2 line
  what-changed · **one** verification line (cargo/npm/clippy/tsc/security) · flags / owner-decisions.
  Mechanism and design detail go in the commit message + spec. Cite `path#section`, don't restate docs.
- **Subagent routing:** `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` — **the
  setting is the guard, do not add per-session routing instructions.** Pin a stronger `model:` in
  agent frontmatter only where adversarial judgment is provably the point. Cowork lane: always set
  the `Agent` `model` param explicitly, never inherit (table in `docs/COWORK_HANDOFF.md`). Effort:
  default high; x-high only at the mutation/rollback boundary. Cheaper workers, never lazier checks.
- **SELF-REVIEW before claiming ANY UI change done (standing LAW, 2026-06-20).** Run the `self-review`
  project skill — a forced, evidence-required rubric. Green tsc/vitest are NOT a visual review.
  Execution belongs in the `.claude/agents/self-reviewer.md` subagent; **never capture or cdp-eval
  inline in the orchestrator** (inline review was once 64% of weekly tokens). No done-claim without a
  quoted PASS verdict. Memory: [[always-self-review-visual-work]].
- **`bug → guard` (LAW):** every defect the owner catches becomes a permanent guard *before the fix
  counts* — a vitest/cargo test if mechanizable, else a `self-review` rubric item. Tiers: automated
  guard > forced rubric item > memory > prose. Memory: [[bug-becomes-guard]].
- **Skills:** `.claude/skills/INDEX.md` maps every project skill to its trigger + cheapest executor.
  Consult it before mutation-boundary diffs, ships, state assertions, or bug fixes.
  `scripts/verify-release-state.mjs` mechanizes the RELEASE_STATE citation audit;
  `scripts/usage-audit.mjs` mechanizes the session/token audit (weekly report auto-written Mondays by
  the `CompyUsageAudit` scheduled task, zero tokens).

### SILENT REINSTALL IS MINE, NOT THE OWNER'S (standing LAW, 2026-06-26)

The owner must **NEVER** run an installer himself and must never have more than the ONE current build
on his Desktop. After **any** `npm run tauri build`, immediately run **`scripts/ship-reinstall.ps1`**
(stop running compy → delete all Desktop installers → stage ONLY the new NSIS → silent `/S` install →
launch). Then **verify live == build via the build STAMP** (`get_build_stamp` over a CDP port →
`"<commit> · release"`), **not an exe hash** — the installed exe is not byte-identical to
`target/release/compy.exe` (NSIS packaging). Report as *"your live app is now `<commit>`, one
installer on the Desktop, nothing for you to do."* His ONLY job is verification (does it feel right).
A `ship-reminder` PostToolUse hook nudges this after any `tauri build`. Memory:
[[silent-reinstall-is-my-job]].

## Stack & where things live

- **Tauri 2** desktop app: Rust core (`src-tauri/`) + React/TypeScript frontend (`src/`).
- **Single source of truth: `C:\Users\Kuya\code\sentinel\`.** The `\\wsl.localhost\...\var\www\compy`
  WSL/FastAPI scaffold is **superseded/stale** — do not use it (WSL also breaks anti-cheat via Hyper-V).
- Remote `Pootytxng/sentinel`, branch `main` (resolves directly, not a redirect).
- Dev loop: `npm run tauri dev` from repo root. Tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
  Fresh shells may need `export PATH="$HOME/.cargo/bin:$PATH"`. Git CRLF warnings are benign.
- **`npm run verify` is the pre-push gate** — it runs everything `.github/workflows/ci.yml` runs, in
  order, on this machine (~3.5 min; `--fast` skips the Rust half). Hosted Actions is a metered
  private-repo budget that dies with `steps: 0` and no log when it lapses, so the green tick that
  matters is this one. `scripts/verify-like-ci.test.mjs` fails the build if the two drift apart.
- Runtime data: Trust Ledger `%APPDATA%\Compy\history.json`; FPS IPC (`fps.json`/`fps.alive`) at
  `%APPDATA%\Compy\runtime\`. `%LOCALAPPDATA%\Compy\` is the NSIS per-user INSTALL dir (exe +
  `launch-debug.log`, debug only) — **never IPC**.

### Rust module map (`lib.rs` carved into safety-boundary modules)

Complete as of 2026-08-04 (45 `.rs` files; line counts drift, treat as rough). **Mutation/rollback +
gate-relevant modules are starred ★ — scope any mutation-gate change against these first**, which is
why they live in the always-loaded half. The **read-only remainder** (hardware/sensors,
monitoring/FPS, benchmark/Lab, advisory/ranking/export, intelligence/measurement) is in
**`src-tauri/CLAUDE.md`**, which auto-loads only when work touches `src-tauri/`. **Mechanically
verified — run `node scripts/verify-module-map.mjs` before trusting either half;** it reads both
together and fails on a missing module, a ghost, a wrong file count, a module declared in both
halves, an unstarred module that writes Windows state, or a delegated half that has gone missing.

**Core wiring & entry**
- `main.rs` — argv router: `--fps-capture` → headless ETW helper (`run_fps_capture`); `--run-elevated <hex>` → elevated-PowerShell child (elevation boundary, owner territory); else `run()`. Runs BEFORE any window.
- ★ `lib.rs` (~1585) — `run()` wiring + command registration, state probes, `compy_data_dir`, startup-apps, `gaming_mode_gate` (`lib.rs:520`), `safety_tests`. **★ because `set_startup_entry_enabled` writes `HKCU\...\StartupApproved\Run` directly — a Windows mutation OUTSIDE `actions.rs`, with no typed rollback contract and no Trust Ledger entry. Open owner decision, see `docs/OWNER_ACTION_CHECKLIST.md` §B.**

**★ Mutation, rollback & gates (the safety boundary)**
- ★ `actions.rs` (~5404) — the Windows-mutation + rollback boundary (one exception today: `lib.rs`'s `set_startup_entry_enabled`, above): typed `AppliedAction`/`RollbackAction`/`Snapshot`, all `apply_*`/`rollback_*_typed`, `dispatch_rollback`, `resolve_rollback`, `synthesize_legacy_rollback`, `run_elevated_powershell`.
- ★ `history.rs` (~2416) — Trust Ledger: `AppliedChange`, persistence (`load/save_history`), `apply_recommendation`/`rollback_change`/`get_applied_changes`. Rollback resolves from local history ALONE.
- ★ `gaming_orchestrator.rs` (~1660) — Gaming Mode session lifecycle: start/stop/keeper, orphan detection + recovery, staged-change commit. Mutation-boundary.
- ★ `gaming_session.rs` (~513) — Gaming Mode session model + atomic persistence (`gaming-session.json`, `SESSION_SCHEMA_VERSION`).
- ★ `game_mode_persist.rs` (~190) — Game Mode registry snapshot/persist helpers.
- ★ `services.rs` (~1040) — service-suspend/debloat mutation surface (ARMED).
- ★ `gpu_profile.rs` (~590) — GPU profile handling (apply structurally impossible → advisory; AMD state not user-mode readable).
- ★ `remote_rules.rs` (~590) — signed remote-rules (Ed25519 verify wired, fetch triple-gated OFF).
- ★ `receipts.rs` (~415) — Receipts telemetry gate (built dark, opt-in, default-OFF; new outbound boundary).
- ★ `license.rs` (~355) — Compy Pro license gate (built dark).
- ★ `drift.rs` (~351) — applied-change drift detection vs live machine state.

## LOCKED safety rules — do not cross without an explicit product-owner decision

1. **No kernel driver.** Compy ships no driver of its own — the anti-cheat-safe / no-driver fundamental (do not re-investigate a Compy-shipped driver). Consequence: **Compy never reads CPU die temperature *itself*** — real die temp needs ring-0 MSR access, i.e. a driver (every tool that shows it ships one; the common WinRing0 is on Microsoft's vulnerable-driver blocklist and trips anti-cheat), so we will not. It DOES **display** a CPU temp when a monitor the user already runs is publishing one — HWiNFO's shared-memory block or the LibreHardwareMonitor / OpenHardwareMonitor WMI namespaces, read-only interop (`cpu_temp.rs`); when nothing is publishing, temp stays **unavailable/unknown, never fabricated**. The *lock* is "no Compy driver," not "temp is unshowable." GPU temp is fine (vendor SDK).
2. **No game injection.** Anti-cheat-safe. FPS/frametime via ETW (DXGI present events) in an elevated helper; GPU sensors via vendor libs (AMD ADLX / NVIDIA NVML). Overlay only draws over borderless/windowed, never exclusive fullscreen.
3. **Rollback-first integrity.** Apply captures the full typed rollback contract + snapshot **at apply time**; rollback resolves from `history.json` ALONE (never the live catalog), so a removed/deprecated rec stays undoable. **Never apply a change you can't roll back.**
4. **Signed remote rules — triple-gated OFF.** Real Ed25519 verify is wired (`ed25519-compact`), but remote fetch stays disabled (placeholder all-zeros pubkey, `remote_fetch_enabled()==false`, no CDN URL) until production signing + CDN + staged rollout exist. **The Ed25519 private key NEVER lives in the repo** (not commits, `.env*`, CI, or unencrypted home). **Unsigned remote rules must never ship, even in beta.**
5. **GPU vendor honesty.** AMD = **verified**. NVIDIA (refined 2026-06-06 from the first NVIDIA tester export, RTX 3060 Ti / Win11 25H2): GPU **detection + NVIDIA-specific recs + their applies (HAGS, Container telemetry) = hardware-verified**, but **NVML sensor + session/FPS monitoring is STILL "implemented, not yet hardware-verified"** (tester had 0 sessions). The Monitoring "GPU sensor coverage" line and the NVML tooltip stay "not yet hardware-verified" — **do NOT flip those.** Intel = planned. Never silently upgrade NVIDIA *sensor* confidence past what a monitored session proves.
6. **Tweak catalog — OPEN under measurable-benefit-under-rails** (owner decision 2026-07-09; the pre-2026-07-09 freeze is LIFTED). A tweak earns inclusion by **measurable benefit**, even individually-negligible — the **cumulative measured stack** is the point, and the honest vehicle is aggregate before/after A/B, not per-tweak claims below the noise floor. "Measurable benefit" is an **ADD criterion ON TOP OF** the permanent rails, never instead of them: every catalog tweak MUST still be **reversible** (typed rollback contract + snapshot captured at apply time, rule 3 — no rollback, no catalog) · **no kernel driver / no injection / anti-cheat-safe** (rules 1–2) · **non-security-weakening** (the owner gate above stands) · **stability-safe**. Opening the catalog is a POLICY change, not a license to skip proof: every new tweak rides the full **mutation-gate** (its own apply/rollback QA + welfare-check) before it ships.
   - **(a) Stays barred regardless of measured fps** — timer/HPET hacks · bcdedit boot params · MMCSS abuse · **core-parking writes** · Defender disable · MPO disable · fixed pagefile forcing · kernel-level anything · anything that trips EAC/BattlEye. Excluded for SAFETY / STABILITY / SECURITY / ANTI-CHEAT; **measurement does NOT make these safe.**
   - **(b) Becomes a candidate** once it proves measurable benefit AND clears the rails — anything previously excluded merely as unmeasured "optimizer-rot / snake-oil."
   - **Structurally impossible (don't attempt):** GPU-profile apply — AMD profile state isn't user-mode readable, so rollback-first cannot be satisfied.
   - The Lab's proving loop is the qualifying pipeline (candidate → proves benefit on the bench → clears the rails → mutation-gate QA → joins the catalog). Catalog policy blueprint: `docs/superpowers/specs/2026-07-08-lab-proving-ground.md` (**its §2/§3/§8 UI direction is SUPERSEDED** — owner-rejected 2026-07-09; live Lab UI = `docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md` "The Instrument Bench", plan `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`).
   - Product value also grows *upward* (gaming readiness, monitoring, session summaries, priority ranking, export) — see `docs/PRODUCT_DIRECTION.md`. **Any new feature that is not a catalog tweak must be read-only / advisory / reversible / session-scoped until proven safe.**

## Dev machine (for hardware-specific work)

Fully **AMD**: **Radeon RX 9070 XT (RDNA4)**, Ryzen X3D-class CPU, 16 logical cores (~5.1 GHz),
~29.4 GB RAM. **Build & test the AMD path first** — NVIDIA is unverifiable here. **UAC:** re-enabled
to `EnableLUA=1` and rebooted 2026-05-30 so the `runas` elevation path is testable; `uac_disabled()`
returns false, so the real `runas` branch is live (not the direct-spawn fallback).

## Current state, history, and how to resume

1. **`docs/WORK_CONTROL.md`** — before any write, claim the linked issue with the exact worktree,
   branch, scope, expiry, and next action. An overlapping or unknown live claim means stay read-only
   or use a truly separate worktree. It coordinates execution; it never overrides product truth.
2. **`docs/RELEASE_STATE.md`** — the authoritative gate/build/release matrix. All other docs defer to
   it on current state; update it in the same commit a gate flips.
3. **`docs/BACKLOG.md`** — the living status ledger; take the next non-gated `[ ]` item. **Per the
   false-done protocol, never declare "done" without enumerating remaining + gated items.**
4. **`docs/OWNER_ACTION_CHECKLIST.md`** — the ONE consolidated index of everything waiting on the
   owner (his hands, eyes, input, money/legal calls). Surface it when he asks "show my checklist" and
   at the end of every train; never let an item silently drop.
5. **`docs/UI_VISION_BACKLOG.md`** — the ONE home for every owner-authored UI/design ask. For anything
   UI/visual, read its 🔴 OPEN section. **Do NOT report UI as "done"/"queue empty" off RELEASE_STATE
   alone** — that tracks the shipped Instrument-HUD reskin, not his unbuilt motion/interaction vision
   (panoramic drag telemetry gallery, magnetic cursor, Lenis, GSAP data-reactivity). **A "COMPLETE"
   redesign checkbox that leaves 🔴 items here is a false-done — a reskin is not the vision.** When
   shipping something simpler than he asked, log it as a substitution needing sign-off.
6. **`docs/RECEIPTS_DOCTRINE.md`** (money/product direction) · **`docs/CHANGELOG.md`** (dated banners +
   full change history, point-in-time). Treat any file:line claim as point-in-time.

## TOKEN LAW (owner decree 2026-07-22, after a same-week cap-out; permanent, both lanes)

1. **Docs carry CURRENT STATE only.** History and dated banners move to `docs/archive/*` — move, never
   delete, leave a pointer. **`scripts/doc-budget.ps1` enforces line budgets: run it in every verify
   pass; a FAIL means archive before you commit.**
2. **Read big docs by section** (search first, then offset/length) — never whole-file re-reads of
   RELEASE_STATE / BACKLOG / CHANGELOG.
3. **Edit with minimal anchors** — smallest unique match, ≤3 lines of context.
4. **Screenshots/images only when the next action depends on seeing one.**
5. A weekly Cowork sweep ("Sentinel weekly token/doc budget sweep", Mondays 6 AM PT) runs the budget
   check and archives overages. **Extend that sweep — never build a parallel monitor.**
