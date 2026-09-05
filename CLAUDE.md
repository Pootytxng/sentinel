# CLAUDE.md — Compy project brief & resume point

<!-- Every byte loads on EVERY boot. `src/claude-md-laws-guard.test.ts` enforces law markers,
     the byte budget, and dead pointers. Keep product philosophy in docs/PRODUCT_CONSTITUTION.md. -->

> **Auto-loads into every Claude Code session rooted in this repo.** Fresh session: read
> `docs/PRODUCT_CONSTITUTION.md` first for product truth, then `docs/RELEASE_STATE.md` for current
> build/gate truth, `docs/WORK_CONTROL.md` before any write, and `docs/BACKLOG.md` for execution status.
> Treat every state/file/line claim as point-in-time and re-derive native state before asserting it.
>
> Universal behavioral laws live in `~/.claude/CLAUDE.md`; do not duplicate them here.

> **Authority is domain-specific, not one giant hierarchy.**
> - `docs/PRODUCT_CONSTITUTION.md` — SUPREME PRODUCT AUTHORITY.
> - **`docs/RELEASE_STATE.md` is authoritative** for what is built, armed, installed, verified, or blocked.
> - `docs/ARCHITECTURE_LOCKS.md` — safety/architecture authority.
> - `docs/WORK_CONTROL.md` — mutation-lease, scope, handoff, and proof-transition authority.
> - `docs/product/ROADMAP.md` — derived product execution sequence.
> - `docs/BACKLOG.md` — execution ledger only; never a source of product philosophy.

> **RENAMED Sentinel → Compy (2026-06-04).** `gg.compy.app` · `compy.exe` · crate `compy`/`compy_lib`
> · `%APPDATA%\Compy`. First launch COPY-migrates `%APPDATA%\Sentinel` → `%APPDATA%\Compy`
> (`migrate_legacy_data_once` in `lib.rs`); the **legacy literal MUST stay "Sentinel"** because it is
> the migration source. Historical repo/path references to sentinel are expected.

## What Compy is — constitutional bootstrap

Compy is one guided PC performance, optimization, health, diagnosis, recovery, experimentation, and
education system. Its two equal flagship journeys are **MAKE THIS PC BETTER** and
**FIGURE OUT WHAT WENT WRONG**. Neither is subordinate to the other.

Product laws:

- **The user chooses the destination. Compy handles the technical route, proves the result, explains
  the tradeoffs, and never hides the way back.**
- **Compy optimizes outcomes, not settings.**
- Users choose understandable outcomes and risk tolerance; Compy translates them into relevant
  technical candidates using the shared Machine Model and Trial system.
- Simple outside, deep inside: Answer → Explanation → Technical receipt.
- Average FPS alone is never enough evidence for optimization quality.
- No measurable benefit beyond credible noise means the default/current state wins.
- The target is the smallest validated configuration that best serves the user's goal, not the
  largest tweak count or lowest process count.
- Care and Performance share the same history, evidence, machine model, rollback, confidence, and
  experiment machinery.
- User freedom does not obligate Compy to automate unsupported or indefensible operations.
- Never invent or assume hardware specs.

**Full law:** `docs/PRODUCT_CONSTITUTION.md`. Derived implementation: `docs/product/ROADMAP.md`,
`docs/product/OPTIMIZATION_ENGINE.md`, `docs/product/MACHINE_MODEL.md`,
`docs/product/TRIAL_PROTOCOL.md`, `docs/product/RISK_MODEL.md`, `docs/product/CARE_ENGINE.md`, and
`docs/product/UX_SYSTEM.md`.

`docs/RECEIPTS_DOCTRINE.md`, old PRDs, old Product Direction documents, historical monetization plans,
and pre-rebirth strategy specs are historical evidence only. They cannot restore old product hierarchy
or pricing doctrine without an explicit constitutional amendment.

## Standing product-integrity laws

- **Honest measurement:** **never fabricate, never claim unmeasured**. Measured wins may be amplified
  clearly; measured losses/nulls are equally valid evidence. Unavailable stays unknown, **never fabricated**.
- **Outbound + Capability Exception Gate:** new capabilities remain local/user-mode by default and
  cross a boundary only through a named reviewed exception. Keep the three distinct outbound tiers:
  **Tier 1 signed advisory download / no machine-data upload** · **Tier 2 scrubbed incident fingerprint**
  · **Tier 3 explicit per-case evidence upload**. Never merge their consent/transport. Tier 2 is
  opt-in, default OFF and it stays OFF after arming, disclosed at first run, with a real off switch
  (owner ruling 2026-08-24, #207); only a later explicit owner architecture decision changes that.
- **ONE MUTATION BOUNDARY:** Compy changes Windows from `src-tauri/src/actions.rs` and **nowhere else**.
  Snapshot → apply → verify → receipt → rollback. `src/mutation-boundary-guard.test.ts` protects this.
  `mutation-boundary-allow` is only the greppable line-level escape for prose that names a command.
- **ZERO-BUDGET LAW:** product/research phases use $0-first paths where practical; spend remains
  owner-gated with a named reason/payback. Paid ads: **never before 1.0** unless the owner explicitly
  amends that decision.
- No scareware, fabricated issue counts, fake certainty, dark-pattern monetization, or affiliate-biased
  technical recommendations.

## Working mode

**Authoritative release policy:** `docs/RELEASE_AUTONOMY.md`. For greenlit/reversible engineering,
build → verify → commit → push → next; failed gates trigger repair, not wishful pass. Preserve failed
candidates before reset/abandonment. Questions are for genuine owner forks, not routine engineering.

**Dynamic executor routing + proof order:** Claude Code, Codex, and ChatGPT HQ are all eligible
executors. There is no permanent implementation department. For each bounded slice, choose the model
with the best current context, remaining capacity, local/tool access, and ability to reach the next
proof boundary. The hard invariant is **one active mutation lease per overlapping scope**, recorded
under `docs/WORK_CONTROL.md`; non-holders may keep reading, coordinating, and reviewing in parallel.
Handoffs transfer mutation authority only and should be cheap when another executor is the better fit.
Exact required gates cannot be substituted; environment inability is a blocker, not a pass. Run
`scripts/work-control-gate.mjs` before proof-dependent GitHub transitions. Independent review is a
transition gate and must cover the exact head by a reviewer who did not author the mutation being
approved. One worktree per writer; mutexes enforce exclusion but never grant ownership.

**Owner-bound in this repo** (in addition to `~/.claude/CLAUDE.md`):
1. Secrets/signing: the Ed25519 private key or any secret never enters repo / `.env*` / CI.
2. Shared/irreversible Git: never move frozen beta refs (`16069fa`).
3. Shipping mutation code to other people's machines, arming remote-fetch/updater/capabilities/CSP.
4. Money/spend and material price/publication decisions.
5. Security/system settings: standing rule below.
6. LOCKED architecture gates or an undisclosed core-feature reshaping: send one **WELFARE CHECK**
   (what / why / blast radius) first.

If a task can be safely done by us within authority, do it. Reversibility never licenses crossing a
security, secrets, ship-to-others, or ownership boundary. Verification is never skipped.

### TASTE IS MINE TO EXERCISE, HIS TO OVERRULE (owner decree 2026-08-07)

Aesthetic calls are **not** owner-gated and must never be parked on him by default — his words:
*"i do not want taste calls to exclusively fall on me id like to see your ideas and consider your
taste calls as well."* Make the call, verify visually, and hand him a **viewable before/after**
(`SendUserFile`, per `.claude/skills/self-review`) so he can veto on sight. Ask first only where
taste becomes brand/money/publication (product name, logo, price presentation, fleet-visible
distribution). A genuine fork ships **with a recommendation attached**, never as a menu.
`scripts/taste-autonomy-guard.test.mjs` protects this decree.

### SECURITY / SYSTEM SETTINGS — OWNER-GATED, never autonomous

Modifying security/system settings — UAC keys (`EnableLUA`, `ConsentPromptBehaviorAdmin`,
`PromptOnSecureDesktop`), Defender, firewall, access controls, or `HKLM\...\Policies\System` — is
owner territory: **welfare-check FIRST, never flip it solo**, not even reversibly. **Reversibility is NOT
the license here** because the weakened-security window is itself the risk. Diagnose with **read-only
probes only**. Treat a model **auto-switch on security-sensitive work as a STOP signal** and involve the
owner.

### Reports, subagents, self-review

- Owner replies: plain, short, outcome first; implementation detail belongs in commit/PR/spec.
- End implementation sessions with a HANDOFF BLOCK: paste-ready next action, lane, tab-close verdict.
- **Subagent routing:** `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` — **the
  setting is the guard, do not add per-session routing instructions.** Pin a stronger `model:` in
  agent frontmatter only where adversarial judgment is provably the point (`web-design-director` is
  the one documented exception). Effort: default high; x-high at the mutation/rollback boundary.
- **SELF-REVIEW before claiming ANY UI change done.** Run the `self-review` project skill through the
  self-reviewer agent; green unit tests are not visual proof. **never capture or cdp-eval inline** in
  the orchestrator. No done-claim without a **quoted PASS verdict**.
- **`bug → guard`**: every owner-caught defect earns a permanent test or forced rubric item **before the
  fix counts**.
- `.claude/skills/INDEX.md` maps project skills. `scripts/verify-release-state.mjs` checks release-state
  citations; `scripts/usage-audit.mjs` checks usage economics.

### SILENT REINSTALL IS MINE, NOT THE OWNER'S

After any `npm run tauri build`, run `scripts/ship-reinstall.ps1` (stop Compy → remove stale Desktop
installers → stage only the new NSIS → silent install → launch). Verify live == build via the embedded
**build STAMP**, **not an exe hash**. The owner should not need to run the installer himself.

## Stack & where things live

- Tauri 2 desktop app: Rust core `src-tauri/` + React/TypeScript `src/`.
- Canonical Windows repo is typically `C:\Users\Kuya\code\sentinel\`; always resolve active repo root
  rather than trusting a hardcoded worktree path.
- Remote `Pootytxng/sentinel`, default branch `main`.
- Dev: `npm run tauri dev`; Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
- Trust Ledger: `%APPDATA%\Compy\history.json`; runtime FPS IPC under `%APPDATA%\Compy\runtime\`.
- `%LOCALAPPDATA%\Compy\` is the installed app directory, never the IPC directory.

### Rust module map (`lib.rs` carved into safety-boundary modules)

Complete 2026-08-29 (51 `.rs` files; line counts rough). **Mutation/rollback +
gate-relevant modules are starred ★ — scope any mutation-gate change against these first.** The
read-only remainder (hardware/sensors, monitoring/FPS, benchmark/Lab, advisory/ranking/export,
intelligence/measurement) lives in **`src-tauri/CLAUDE.md`**, which auto-loads only when work touches
`src-tauri/`. **Mechanically verified — run `node scripts/verify-module-map.mjs` before trusting either half.**

**Core wiring & entry**
- `main.rs` — argv router: `--fps-capture` → headless ETW helper (`run_fps_capture`); `--run-elevated <hex>` → elevated-PowerShell child (elevation boundary, owner territory); else `run()`. Runs BEFORE any window.
- ★ `lib.rs` (~1870) — `run()` wiring + command registration, state probes, `compy_data_dir`, startup-apps, `gaming_mode_gate` (`lib.rs:558`), `safety_tests`. ★ for the command surface only — the `set_startup_entry_enabled` exception closed 2026-08-03; it lives in `history.rs` and mutates through `actions::apply_startup_entry_enabled` like every other apply.

**★ Mutation, rollback & gates (the safety boundary)**
- ★ `actions.rs` (~5404) — THE Windows-mutation + rollback boundary, no exceptions: typed `AppliedAction`/`RollbackAction`/`Snapshot`, all `apply_*`/`rollback_*_typed`, `dispatch_rollback`, `resolve_rollback`, `synthesize_legacy_rollback`, `run_elevated_powershell`.
- ★ `history.rs` (~2416) — Trust Ledger: `AppliedChange`, persistence (`load/save_history`), `apply_recommendation`/`rollback_change`/`get_applied_changes`. Rollback resolves from local history ALONE.
- ★ `gaming_orchestrator.rs` (~1660) — Gaming Mode session lifecycle: start/stop/keeper, orphan detection + recovery, staged-change commit. Mutation-boundary.
- ★ `gaming_session.rs` (~513) — Gaming Mode session model + atomic persistence (`gaming-session.json`, `SESSION_SCHEMA_VERSION`).
- ★ `game_mode_persist.rs` (~190) — Game Mode registry snapshot/persist helpers.
- ★ `services.rs` (~1040) — service-suspend/debloat mutation surface (ARMED).
- ★ `gpu_profile.rs` (~590) — GPU profile handling (apply structurally impossible → advisory; AMD state not user-mode readable).
- ★ `remote_rules.rs` (~590) — signed remote-rules (Ed25519 verify wired, fetch triple-gated OFF).
- ★ `receipts.rs` (~633) — Receipts gate + Tier 2 send path (Q9a): `send_decision` refuses gate → disclosure → opt-in. Built dark, hard-false, **default-OFF even armed** (#207).
- ★ `license.rs` (~519) — Compy Pro license gate (built dark).
- ★ `drift.rs` (~477) — applied-change drift detection vs live machine state.
- ★ `data_root.rs` (~1050) — canonical data-root resolver (#130): measures where the root LANDS, not the `APPDATA` string; halts on a split; issues `MutationRoot`, the capability `history.rs`/`actions.rs` now require. Guard: `scripts/data-root-guard.test.mjs`.

## LOCKED safety rules — do not cross without explicit product-owner decision

1. **Capability Exception Gate (owner decision 2026-08-09).** Default local, user-mode,
   least-privilege, non-invasive. Any exception must be named/capability-specific and prove a lower-risk
   route cannot achieve the outcome; define privilege/data surface, consent, rollback/uninstall,
   signing/update, kill switch, staged proof, independent security/anti-cheat review, abort metrics,
   and owner sign-off. Full process: `docs/ARCHITECTURE_LOCKS.md` §1.8. A Compy driver is no longer categorically
   forbidden, but **the current build ships no driver** and none may be built before its own record.
   **No vulnerable third-party driver** and no generic physical-memory/MSR/PCI/device-register surface.
   CPU temperature stays **external-monitor-only** unless a separately approved supported capability
   ships; unavailable remains unknown, never fabricated.

2. **No third-party game/process injection.** This remains absolute: **no DLL injection**, **game-memory access**,
   runtime hooks, or code inside game/anti-cheat processes. FPS/frametime remains external ETW; overlays
   are limited to **borderless/windowed**, never exclusive-fullscreen injection.

3. **Rollback-first integrity.** Capture complete typed rollback contract + snapshot **at apply time**.
   Rollback resolves from `history.json` ALONE, never from the live catalog. **Never apply a change you
   can't roll back.**

4. **Signed remote rules — triple-gated OFF.** Privileged remote mutation policy remains disabled by
   placeholder key / `remote_fetch_enabled()==false` / no production URL unless explicitly armed.
   **Unsigned remote rules must never ship, even in beta.** **The Ed25519 private key NEVER lives in the
   repo**. Case intelligence is a separate signed advisory capability and must not be conflated with
   remote mutation rules.

5. **GPU vendor honesty.** AMD path is verified on owner hardware. NVIDIA detection/specific recs have
   partial hardware proof, but NVML sensor/session monitoring remains **not yet hardware-verified**;
   **do NOT flip those** claims without real monitored-session evidence. Intel remains planned where
   unsupported. Missing sensor values stay unknown.

6. **Tweak catalog — OPEN under measurable-benefit-under-rails.** Measurement is an ADD criterion on
   top of permanent safety/stability/security/anti-cheat/rollback rails. Every new automated candidate
   must fit the constitutional Trial/Optimization Engine and the existing mutation gate. The old rule
   that individually-negligible tweaks may accumulate into a stack does not authorize keeping a change
   when a per-rig Trial says it has no measurable value for that user/workload.

   Permanent blocklist: **timer/HPET** hacks · **bcdedit** boot params · **MMCSS** abuse ·
   **core-parking writes** · **Defender disable** · **MPO disable** · **fixed pagefile** forcing ·
   **ungated kernel-level capability** · anything that trips **EAC/BattlEye**. These remain barred for
   safety/stability/security/anti-cheat reasons; **measurement does NOT make these safe**.

   **GPU-profile apply** remains structurally impossible while prior AMD profile state is not reliably
   readable enough to satisfy rollback-first.

## Dev machine notes

Owner's primary known test machine is AMD (Radeon RX 9070 XT and Ryzen X3D-class CPU). Never generalize
that machine's benchmark result into universal product evidence. Re-read actual detected hardware when
hardware-specific work begins.

## Current state, history, and how to resume

1. `docs/PRODUCT_CONSTITUTION.md` — product truth; read before product/design/prioritization work.
2. `docs/WORK_CONTROL.md` — before any write, derive current mutation lease/worktree/scope/expiry/process truth.
3. `docs/RELEASE_STATE.md` — current build/gate/release truth; same-commit updates when state changes.
4. `docs/product/ROADMAP.md` — derived product sequence.
5. `docs/BACKLOG.md` — living execution ledger. Per **false-done** protocol, never claim completion
   without naming remaining/gated work.
6. `docs/OWNER_ACTION_CHECKLIST.md` — consolidated owner-only actions. Never let an owner item drop.
7. `docs/UI_VISION_BACKLOG.md` — historical owner-request and shipped-state evidence, not product
   authority, priority, approval, or a work queue. For UI/visual work, start with the Constitution and
   roadmap; reconcile relevant 🔴 OPEN rows (currently DIR-1 and §G) as evidence without inheriting
   their priority or treating them as authorization. `src/ui-vision-status-guard.test.ts` prevents stale row paraphrases from
   becoming work again. **a reskin is not the vision** by itself; scope and completion still require
   current constitutional and execution evidence.
8. `docs/CHANGELOG.md` — historical dated record only.

Legacy `docs/RECEIPTS_DOCTRINE.md`, `docs/PRODUCT_DIRECTION.md`, `docs/PRD.md`, and old monetization
files are tombstones/history. Do not derive current product law from them.

## TOKEN LAW

Keep always-loaded context compact. **Current state only** here; move history/rationale to docs and
link it. `scripts/doc-budget.ps1` enforces document budgets. `scripts/usage-audit.mjs` remains the
usage authority; extend it, **never build a parallel monitor**.