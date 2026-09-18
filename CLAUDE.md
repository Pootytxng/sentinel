# CLAUDE.md — Compy project brief & resume point

> **Auto-loads into every Claude Code session rooted in this repo** (`src/claude-md-laws-guard.test.ts`
> pins its laws, budgets and pointers). Treat every state/file/line claim as point-in-time and re-derive
> native state before asserting it. Universal behavioral laws live in `~/.claude/CLAUDE.md`; do not
> duplicate them here.

> **Authority is domain-specific, not one giant hierarchy.** Fresh session: read
> `docs/PRODUCT_CONSTITUTION.md` first, then `docs/RELEASE_STATE.md`, `docs/WORK_CONTROL.md`, `docs/BACKLOG.md`.
> - `docs/PRODUCT_CONSTITUTION.md` — SUPREME PRODUCT AUTHORITY.
> - **`docs/RELEASE_STATE.md` is authoritative** for what is built, armed, installed, verified, or blocked;
>   update it in the same commit that changes the state.
> - `docs/ARCHITECTURE_LOCKS.md` — safety/architecture authority.
> - `docs/WORK_CONTROL.md` — mutation-lease, scope, handoff, and proof-transition authority; before any
>   write, derive lease, worktree, scope, expiry and process truth from it.
> - `docs/product/ROADMAP.md` — derived product execution sequence.
> - `docs/BACKLOG.md` — execution ledger only; never a source of product philosophy.

> **RENAMED Sentinel → Compy (2026-06-04).** `gg.compy.app` · `compy.exe` · crate `compy`/`compy_lib` ·
> `%APPDATA%\Compy`. First launch COPY-migrates `%APPDATA%\Sentinel` (`migrate_legacy_data_once` in `lib.rs`);
> the **legacy literal MUST stay "Sentinel"** as the migration source. Old sentinel paths are expected.

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

**Full law:** `docs/PRODUCT_CONSTITUTION.md`. Derived implementation in `docs/product/`: ROADMAP,
OPTIMIZATION_ENGINE, MACHINE_MODEL, TRIAL_PROTOCOL, RISK_MODEL, CARE_ENGINE and UX_SYSTEM.

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
- **ZERO-BUDGET LAW:** $0-first paths where practical; spend stays owner-gated with a named
  reason/payback. Paid ads: **never before 1.0** unless the owner explicitly amends that decision.
- No scareware, fabricated issue counts, fake certainty, dark-pattern monetization, or affiliate-biased
  technical recommendations.

## Working mode

**Authoritative release policy:** `docs/RELEASE_AUTONOMY.md`. For greenlit/reversible engineering,
build → verify → commit → push → next; failed gates trigger repair, not wishful pass. Preserve failed
candidates before reset/abandonment. Questions are for genuine owner forks, not routine engineering.

**Dynamic executor routing + proof order** (full law: `docs/WORK_CONTROL.md`): Claude Code, Codex and
ChatGPT HQ are all eligible executors; per bounded slice, pick the one best placed to reach the next
proof boundary. The hard invariant is **one active mutation lease per overlapping scope**; non-holders
keep reading, coordinating and reviewing. Handoffs transfer mutation authority only. Exact required
gates cannot be substituted; environment inability is a blocker, not a pass. Run
`scripts/work-control-gate.mjs` before proof-dependent GitHub transitions; independent review covers the
exact head, by a reviewer who did not author the mutation being approved. One worktree per writer
(mutexes enforce exclusion, never ownership), committing under `docs/WORK_CONTROL.md` "Executor identity".

**Owner-bound in this repo** (in addition to `~/.claude/CLAUDE.md`; reversibility never licenses crossing one):
1. Secrets/signing: the Ed25519 private key or any secret never enters repo / `.env*` / CI.
2. Shared/irreversible Git: never move frozen beta refs (`16069fa`).
3. Shipping mutation code to other people's machines, arming remote-fetch/updater/capabilities/CSP.
4. Money/spend and material price/publication decisions.
5. Security/system settings: standing rule below.
6. LOCKED architecture gates or an undisclosed core-feature reshaping: send one **WELFARE CHECK**
   (what / why / blast radius) first.

### TASTE IS MINE TO EXERCISE, HIS TO OVERRULE (owner decree 2026-08-07)

Aesthetic calls are **not** owner-gated and must never be parked on him by default — his words:
*"i do not want taste calls to exclusively fall on me id like to see your ideas and consider your
taste calls as well."* Make the call, verify visually, and hand him a **viewable before/after**
(`SendUserFile`, per `.claude/skills/self-review`). Ask first only where taste becomes
brand/money/publication (product name, logo, price presentation, fleet-visible distribution). A genuine
fork ships **with a recommendation attached**, never as a menu (`scripts/taste-autonomy-guard.test.mjs`).

### SECURITY / SYSTEM SETTINGS — OWNER-GATED, never autonomous

Modifying security/system settings — UAC keys (`EnableLUA`, `ConsentPromptBehaviorAdmin`,
`PromptOnSecureDesktop`), Defender, firewall, access controls, `HKLM\...\Policies\System` — is owner
territory: **welfare-check FIRST, never flip it solo**, not even reversibly. **Reversibility is NOT the
license here** because the weakened-security window is itself the risk. Diagnose with **read-only probes
only**. Treat a model **auto-switch on security-sensitive work as a STOP signal** and involve the owner.

### Reports, subagents, self-review

- **Handoffs launch, never paste** (#466): end by running `node scripts/successor-route.mjs`, then write a
  tab verdict and `Successor: launched|chip|none — …`.
- **Subagent routing:** `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` — **the
  setting is the guard, do not add per-session routing instructions**; `.claude/hooks/subagent-model-guard.mjs`
  allows one stronger pin, `web-design-director`. Effort: default high; x-high at the mutation/rollback boundary.
- **SELF-REVIEW before claiming ANY UI change done.** Run the `self-review` project skill through the
  self-reviewer agent; green unit tests are not visual proof. **never capture or cdp-eval inline** in
  the orchestrator. No done-claim without a **quoted PASS verdict**.
- **`bug → guard`**: every owner-caught defect earns a permanent test or forced rubric item **before the
  fix counts**.
- **SILENT REINSTALL IS MINE, NOT THE OWNER'S:** after any `npm run tauri build`, run
  `scripts/ship-reinstall.ps1` and verify live == build via the embedded **build STAMP**, **not an exe
  hash**. The owner never runs the installer; the `ship` skill carries the procedure.
- `.claude/skills/INDEX.md` maps project skills; `scripts/verify-release-state.mjs` checks release-state citations.

## Stack & where things live

- Tauri 2 desktop app: Rust core `src-tauri/` + React/TypeScript `src/`.
- Repo is typically `C:\Users\Kuya\code\sentinel\`; resolve the active root, never trust a hardcoded worktree path.
- Remote `Pootytxng/sentinel`, default branch `main`.
- Dev: `npm run tauri dev`; Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
- Trust Ledger: `%APPDATA%\Compy\history.json`; runtime FPS IPC under `%APPDATA%\Compy\runtime\`.
- `%LOCALAPPDATA%\Compy\` is the installed app directory, never the IPC directory.
- `.claude/rules/*.md` load only when matching files are touched: `rust-safety-boundary.md`,
  `tweak-catalog.md`, `dev-machine.md` (the owner's AMD test rig; never generalize its results).

### Rust module map (`lib.rs` carved into safety-boundary modules)

Complete 2026-08-29 (53 `.rs` files; the count lives only here). **★ = the safety boundary
(mutation, rollback & gates) — scope any mutation-gate change against these first:** `lib.rs`
(command surface) · `actions.rs` · `history.rs` · `gaming_orchestrator.rs` · `gaming_session.rs` ·
`game_mode_persist.rs` · `services.rs` · `gpu_profile.rs` · `remote_rules.rs` · `receipts.rs` ·
`license.rs` · `drift.rs` · `data_root.rs` · `race_seam.rs`. Entries: ★ half in
`.claude/rules/rust-safety-boundary.md`, read-only half in `src-tauri/CLAUDE.md`; both load only for
`src-tauri/` work. **Mechanically verified — run `node scripts/verify-module-map.mjs` before trusting the map.**

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
6. **Tweak catalog — OPEN under measurable-benefit-under-rails**, on top of permanent
   safety/stability/security/anti-cheat/rollback rails. Permanent blocklist: **timer/HPET** hacks ·
   **bcdedit** boot params · **MMCSS** abuse · **core-parking writes** · **Defender disable** · **MPO
   disable** · **fixed pagefile** forcing · **ungated kernel-level capability** · anything that trips
   **EAC/BattlEye** — **measurement does NOT make these safe**. **GPU-profile apply** stays
   structurally impossible. Admission rails in full: `.claude/rules/tweak-catalog.md`.

## Current state, history, and how to resume

1. `docs/BACKLOG.md` — living execution ledger. Per **false-done** protocol, never claim completion
   without naming remaining/gated work.
2. `docs/OWNER_ACTION_CHECKLIST.md` — consolidated owner-only actions. Never let an owner item drop.
3. `docs/UI_VISION_BACKLOG.md` — historical owner-request and shipped-state evidence, not product
   authority, priority, approval, or a work queue. For UI/visual work, start with the Constitution and
   roadmap; reconcile relevant 🔴 OPEN rows (currently DIR-1 and §G) as evidence without inheriting their
   priority or authorization (`src/ui-vision-status-guard.test.ts`). **a reskin is not the vision** by
   itself; scope and completion still require current constitutional and execution evidence.
4. `docs/CHANGELOG.md` — historical dated record only.

## TOKEN LAW

Keep always-loaded context compact: **current state only** here, history/rationale in linked docs, subsystem
detail in path-scoped `.claude/rules/`. `scripts/doc-budget.ps1` enforces document budgets;
`scripts/usage-audit.mjs` is the usage authority — extend it, **never build a parallel monitor**.