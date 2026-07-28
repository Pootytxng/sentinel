# CLAUDE.md — Compy project brief & resume point

> **This file auto-loads into every Claude Code session opened in this repo.** It is the
> durable, in-git, portable source of truth — independent of Claude's local `~/.claude`
> memory (which is pinned to one machine + one launch path and may not load). If you are a
> fresh session: read this top-to-bottom, then `docs/RELEASE_STATE.md` (live gate state) + `docs/BACKLOG.md` (what's next).
> Treat file/line claims as point-in-time — verify against current code before asserting.

> **📍 LIVE GATE STATE → `docs/RELEASE_STATE.md` is authoritative.** That file is the single
> current-truth matrix for every gate, artifact, and release blocker (each row carries a `file:line`).
> **Where any older text in THIS file or other docs disagrees about *current* gate state, RELEASE_STATE.md
> wins** — the deep legacy strata (extracted to `docs/CHANGELOG.md` — the `private-beta-001` history, e.g. "Gaming Mode remains/stays
> gated") are point-in-time records; Gaming Mode is LIVE (field QA 10/10, **owner signed off 2026-07-14** — GAMING_MODE_QA.md), service-suspend + debloat are ARMED. Created
> 2026-06-26 in response to an external audit that named state/doc drift the project's #1 risk.

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
**FACTS OVER TACT (standing, 2026-07-02):** verifiable facts over diplomacy in every response;
never soften to protect his feelings (he calls that counterproductive). Say broken/wrong/my-miss
plainly and first, with evidence. Unverified stays labeled unverified — that IS facts-first.

## Working mode — SPORT MODE (default, set by owner 2026-06-02)

### RELEASE TRAINS — one authorization, autonomous reversible engineering

**Authoritative policy: [`docs/RELEASE_AUTONOMY.md`](docs/RELEASE_AUTONOMY.md).** One owner
authorization covers the complete reversible release-engineering train. Claude autonomously
preserves evidence, repairs pipeline defects, adds regression coverage, commits, fast-forward
pushes, and continues; a failed gate triggers repair, not automatic owner escalation. Private
source commits/branches, preparation tags, builds, local installs, and local runtime proofs are
reversible engineering. Exact receipt/artifact/source provenance remains mandatory and verification
may never be bypassed. Preserve every failed candidate before reset, replacement, or abandonment.
The first fleet-visible publication/distribution step remains owner-gated, as do secrets and key
rotation, security/system settings, destructive Git, spending, and out-of-scope product/taste
decisions. This policy binds Claude Code, Cowork, Codex, and future agents in this repository.

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

**These pauses are CUMULATIVE, not a ceiling.** "ONLY two things" scopes the *reversible-engineering-work*
class — it does NOT override the SPORT MODE legitimate stops above (secrets/signing · shared/irreversible
git · ships-to-other-machines · irreversible+outward) or the SECURITY/SYSTEM-SETTINGS rule + LOCKED gates
below. A stop required by **any** of these lists is a stop; "reversible" never licenses crossing a
security or ship-to-others boundary.

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

### FABLE 5 PROMPTING DEFAULTS (standing rule, 2026-07-01)

Full protocol: `docs/superpowers/specs/2026-07-01-token-routing-protocol.md`. The CC-facing core:
- **Fable turns are for builds.** Specs/docs/audits/research live in the Cowork lane. Fable is
  on-plan only to ~Jul 7 (50% of weekly limits); after that CC runs Opus 4.8 — paid Fable API
  credits are an owner-gated spend (zero-budget law), default no.
- **Effort matching:** default high; x-high only for correctness-critical work at the
  mutation/rollback boundary; medium/low for routine edits.
- **Subagents never run on Fable (enforced 2026-07-05, orchestrator pattern; default revised
  to sonnet later same day):** `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`
  — opus workers bought nothing once CC's main lane falls back to Opus 4.8 post-Jul 7 (opus
  under opus = zero delta; the ~58% cut in the orchestrator doc assumed Sonnet workers). Pin
  `model: opus` per-agent in frontmatter ONLY where adversarial judgment is provably the point.
  Fable = orchestrator (plan/judge/build itself). Don't add per-session routing instructions —
  the setting is the guard.
- **Never ask Fable to show its reasoning** (standing "explain your reasoning" lines can refuse
  or silently route to Opus 4.8). Proof lives in commits/diffs/tests, not narration. The
  auto-switch-as-STOP-signal rule above stands.
- **Prove it, tersely:** point to the result that proves it; only report what you can show;
  unverified = say so plainly. Report stays `hash · what · one verify line · flags`.
- Hard-lines blocks in prompts are deliberate negative prompting — keep them; don't restate
  doctrine per prompt (it's here and in the specs).

### SUBAGENT-MODEL ORCHESTRATION (standing rule, 2026-07-05 — the "Fable-orchestrator" pattern)

Orchestrator keeps the thinking/judgment; grunt work (searches, sweeps, verification, audits) is
delegated to the CHEAPEST capable model. **CC lane:** the in-repo `.claude/settings.json` sets
`CLAUDE_CODE_SUBAGENT_MODEL=sonnet` (project settings override the owner's global `~/.claude`
copy — if the global still says `opus`, that only affects OTHER repos; owner may align it).
**Cowork lane:** ALWAYS set the `Agent` tool's `model` param explicitly — `haiku` (search/read/format),
`sonnet` (research/verify/audit), `opus` (rare, judgment-heavy), never `fable`, never inherit. Full
routing table in `docs/COWORK_HANDOFF.md` → "Subagent-model orchestration." Rigor unchanged — cheaper
workers, not lazier checks; orchestration pays off on multi-step work, skip it for a one-shot lookup.

### SELF-REVIEW + BUG→GUARD — vigilance lives in the toolchain (standing rule, 2026-06-20)

Owner asked to be made "more precise and vigilant" of the laws after I shipped a muted-on-accent button
+ a duplicate banner that green tests + a glance missed. The fix isn't "try harder to remember" — it's
to move each law OUT of memory INTO the toolchain (the chosen enforcement, 2026-06-20):
- **Run the `self-review` skill (project skill, `.claude/skills/self-review`) before claiming ANY UI
  change done** — a forced, evidence-required rubric (capture native/real-res, STATE the computed text
  color on accent fills, duplication, hover/empty states, stale wording, each part of the ask). A
  PostToolUse hook (`.claude/hooks/self-review-reminder.mjs`) nudges it when a `src/**.{tsx,css}` file
  changes. Green tsc/vitest are NOT a visual review. **Execution moved to a subagent (token law,
  2026-07-05):** the skill is now a dispatcher for `.claude/agents/self-reviewer.md` (sonnet) — the
  rubric/captures run in the worker's context and only the SELF-REVIEW verdict block returns. NEVER
  capture/cdp-eval inline in the orchestrator (inline review was 64% of weekly tokens). Rigor
  unchanged: no done-claim without a quoted PASS verdict.
- **`bug → guard`:** every defect the owner catches becomes a permanent guard before the fix is done —
  a vitest/cargo test if mechanizable (e.g. `src/button-legibility-guard.test.ts`,
  `src/theme-contrast.test.ts`), else a `self-review` rubric item. Tiers: automated guard > forced
  rubric item > memory. Memories: [[always-self-review-visual-work]] · [[bug-becomes-guard]].

### PROJECT SKILLS INDEX (2026-07-06 — Fable-window persistence pack)

> Note: "Fable window" here means the Fable-5-on-plan model-availability window (expires, then CC
> falls back to Opus 4.8 — see the FABLE 5 PROMPTING DEFAULTS section above), NOT the LLM context
> window discussed under TOKEN DISCIPLINE / `.claude/USAGE_ECONOMICS.md`. Two unrelated meanings of
> "window" in this file — flagged 2026-07-18 after an audit found the collision confusing.

**`.claude/skills/INDEX.md`** maps every project skill (self-review · impeccable · compy-coverage-sweep
· **mutation-gate · gate-drift-audit · ship · guard-forge · doc-sync** — the last five added 2026-07-06
to persist judgment past the Fable window — · **usage-audit**, added 2026-07-13) to its trigger +
cheapest executor model, plus tier-2 spec'd-not-built skills. Consult it before mutation-boundary
diffs, ships, state assertions, or bug fixes; `scripts/verify-release-state.mjs` mechanizes the
RELEASE_STATE citation audit and `scripts/usage-audit.mjs` mechanizes the session/token audit (weekly
report auto-written Mondays by the `CompyUsageAudit` scheduled task — zero tokens). A `ship-reminder`
PostToolUse hook nudges the reinstall law after any `tauri build`.

### SILENT REINSTALL IS MINE, NOT THE OWNER'S — automatic after every rebuild (standing LAW, 2026-06-26)

The owner must **NEVER** run an installer himself, and must **never** have more than the ONE current
build on his Desktop. After **any** `npm run tauri build`, immediately run **`scripts/ship-reinstall.ps1`**
(stop running compy → delete all Desktop installers, stage ONLY the new NSIS → silent `/S` install →
launch). Then **verify live == build via the build STAMP** (`get_build_stamp` over a CDP port →
`"<commit> · release"`), **not** an exe hash — the installed exe is not byte-identical to
`target/release/compy.exe` (NSIS packaging). Present it as *"your live app is now `<commit>`, one
installer on the Desktop, nothing for you to do."* The owner's ONLY job is the **verification** (does it
feel/look right). This is the operational meaning of "keep the installer on his Desktop + reinstall" —
**I** reinstall. Memory: [[silent-reinstall-is-my-job]].

## Stack & where things live

- **Tauri 2** desktop app: Rust core (`src-tauri/`) + React/TypeScript frontend (`src/`).
- **Single source of truth: `C:\Users\Kuya\code\sentinel\`** (Windows-side; the working dir kept the pre-rename name — see the rename note above, same reason git history still says "sentinel"). The old
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

Complete as of 2026-07-14 (35 `.rs` files; line counts drift, treat as rough). **Mutation/rollback + gate-relevant modules are starred ★ — scope any mutation-gate change against these first.**

**Core wiring & entry**
- `main.rs` — argv router: `--fps-capture` → headless ETW helper (`run_fps_capture`); `--run-elevated <hex>` → elevated-PowerShell child (elevation boundary, owner territory); else `run()`. Runs BEFORE any window.
- `lib.rs` (~1320) — `run()` wiring + command registration, state probes, `compy_data_dir`, startup-apps, `gaming_mode_gate` (`lib.rs:499`), `safety_tests`.

**★ Mutation, rollback & gates (the safety boundary)**
- ★ `actions.rs` (~4700) — the ONLY Windows-mutation + rollback boundary: typed `AppliedAction`/`RollbackAction`/`Snapshot`, all `apply_*`/`rollback_*_typed`, `dispatch_rollback`, `resolve_rollback`, `synthesize_legacy_rollback`, `run_elevated_powershell`.
- ★ `history.rs` (~2080) — Trust Ledger: `AppliedChange`, persistence (`load/save_history`), `apply_recommendation`/`rollback_change`/`get_applied_changes`. Rollback resolves from local history ALONE.
- ★ `gaming_orchestrator.rs` (~1660) — Gaming Mode session lifecycle: start/stop/keeper, orphan detection + recovery, staged-change commit. Mutation-boundary.
- ★ `gaming_session.rs` (~360) — Gaming Mode session model + atomic persistence (`gaming-session.json`, `SESSION_SCHEMA_VERSION`).
- ★ `game_mode_persist.rs` (~190) — Game Mode registry snapshot/persist helpers.
- ★ `services.rs` (~1040) — service-suspend/debloat mutation surface (ARMED).
- ★ `gpu_profile.rs` (~590) — GPU profile handling (apply structurally impossible → advisory; AMD state not user-mode readable).
- ★ `remote_rules.rs` (~590) — signed remote-rules (Ed25519 verify wired, fetch triple-gated OFF).
- ★ `receipts.rs` (~415) — Receipts telemetry gate (built dark, opt-in, default-OFF; new outbound boundary).
- ★ `license.rs` (~355) — Compy Pro license gate (built dark).
- ★ `drift.rs` (~255) — applied-change drift detection vs live machine state.

**Hardware, sensors & detection (read-only probes)**
- `hardware.rs` (~3350) — `HardwareInfo` probe (CPU/GPU/RAM/storage/network); Rust↔TS serde contract.
- `cpu_temp.rs` (~520) — HWiNFO shared-memory CPU-temp/fan read (SEH-crash risk noted in audit). GPU temp via vendor SDK elsewhere.
- `amd_freesync.rs` (~250), `overlay_tools.rs` (~230), `hwchange.rs` (~190) — FreeSync detection, overlay-tool detection, hardware-change tracking.

**Monitoring, FPS & sessions**
- `monitoring.rs` (~1300) — monitor-tool orchestration + sensor coverage.
- `fps.rs` (~625) — FPS/frametime IPC (`fps.json`/`fps.alive`) from the ETW helper.
- `sessions.rs` (~330) — session-summary persistence (`sessions.json`).
- `stutter.rs` (~135) — stutter/1%-low derivation.

**Benchmark & Lab**
- `benchmark.rs` (~1330), `benchmark_trial.rs` (~615), `benchmark_verdict.rs` (~580), `benchmark_scoreboard.rs` (~460), `comparison.rs` (~475) — the Lab proving-ground bench: trials, verdicts, scoreboard, A/B comparison.
- `latency.rs` (~2255) — input/network latency probes.
- `blackbox.rs` (~2150) — diagnostic black-box capture.

**Advisory, ranking & export**
- `recommendations.rs` (~970), `readiness.rs` (~1615), `priorities.rs` (~707), `diagnostics.rs` (~637), `leftovers.rs` (~1200) — recs catalog, gaming-readiness, priority ranking, diagnostics, leftover-cleanup advisory.
- `export.rs` (~814) — evidence-pack / share-card export.
- `tray.rs` (~177) — system-tray integration.

## LOCKED safety rules — do not cross without an explicit product-owner decision

1. **No kernel driver.** Compy ships no driver of its own — the anti-cheat-safe / no-driver fundamental (do not re-investigate a Compy-shipped driver). Consequence: **Compy never reads CPU die temperature *itself*** — real die temp needs ring-0 MSR access, i.e. a driver (every tool that shows it ships one; the common WinRing0 is on Microsoft's vulnerable-driver blocklist and trips anti-cheat), so we will not. It DOES **display** a CPU temp when a monitor the user already runs is publishing one — HWiNFO's shared-memory block or the LibreHardwareMonitor / OpenHardwareMonitor WMI namespaces, read-only interop (`cpu_temp.rs`); when nothing is publishing, temp stays **unavailable/unknown, never fabricated**. (The earlier "no CPU temperature, proven impossible" phrasing overstated this: the *lock* is "no Compy driver," not "temp is unshowable.") GPU temp is fine (vendor SDK).
2. **No game injection.** Anti-cheat-safe. FPS/frametime via ETW (DXGI present events) in an elevated helper; GPU sensors via vendor libs (AMD ADLX / NVIDIA NVML). Overlay only draws over borderless/windowed, not exclusive fullscreen.
3. **Rollback-first integrity.** Apply captures the full typed rollback contract + snapshot at apply time; rollback resolves from `history.json` ALONE (never the live catalog), so a removed/deprecated rec stays undoable. Never apply a change you can't roll back.
4. **Signed remote rules — triple-gated OFF.** Real Ed25519 verify is wired (`ed25519-compact`), but remote fetch stays disabled (placeholder all-zeros pubkey, `remote_fetch_enabled()==false`, no CDN URL) until production signing + CDN + staged rollout exist. **The Ed25519 private key NEVER lives in the repo** (not commits, .env, CI, or unencrypted home). **Unsigned remote rules must never ship, even in beta.**
5. **GPU vendor honesty:** AMD = **verified**. **NVIDIA (refined 2026-06-06 from the first NVIDIA tester export, RTX 3060 Ti / Win11 25H2):** GPU **detection + NVIDIA-specific recs + their applies (HAGS, Container telemetry) = hardware-verified**; but **NVML sensor + session/FPS monitoring is STILL "implemented, not yet hardware-verified"** (tester had 0 sessions — awaiting one monitored session). So the Monitoring "GPU sensor coverage" line + the NVML tooltip stay "not yet hardware-verified" — do NOT flip those. Intel = planned. Do not silently upgrade NVIDIA *sensor* confidence past what a monitored session proves.
6. **Tweak catalog — OPEN under the measurable-benefit-under-rails policy (owner decision 2026-07-09; the pre-2026-07-09 freeze is LIFTED, rule rewritten with the Lab overhaul).** A tweak earns catalog inclusion by **measurable benefit** — even individually-negligible; the **cumulative measured stack** is the point (the honest vehicle is aggregate before/after A/B, not per-tweak claims below the noise floor). "Measurable benefit" is an **ADD criterion ON TOP OF** the permanent safety rails, never instead of them — every catalog tweak MUST still be: **reversible** (captured typed rollback contract + snapshot at apply time — rule 3; no rollback → no catalog) · **no kernel driver / no injection / anti-cheat-safe** (rules 1–2) · **non-security-weakening** (the security/system-settings owner gate stands) · **stability-safe**. Opening the catalog is a POLICY change, not a license to skip proof: every new tweak rides the full **mutation-gate** (its own apply/rollback QA + welfare-check) before it ships. **The old blocklist SPLITS:** (a) **stays barred regardless of measured fps** — timer/HPET hacks, bcdedit boot params, MMCSS abuse, **core-parking writes**, Defender disable, MPO disable, fixed pagefile forcing, kernel-level anything, anything that trips EAC/BattlEye (excluded for SAFETY/STABILITY/SECURITY/ANTI-CHEAT — measurement does NOT make these safe); (b) **becomes a candidate** once it proves measurable benefit AND clears the rails — anything previously excluded merely as unmeasured "optimizer-rot / snake-oil." **Structurally impossible (don't attempt):** GPU-profile apply (AMD profile state isn't user-mode readable → can't satisfy rollback-first). The Lab's proving loop is the pipeline that qualifies additions (candidate → proves benefit on the bench → clears the rails → mutation-gate QA → joins the catalog). Blueprint: `docs/superpowers/specs/2026-07-08-lab-proving-ground.md` (★ PRIMARY BLUEPRINT for **Directive 1's catalog policy only** — its §2/§3/§8 UI/layout direction is SUPERSEDED, rejected by the owner 2026-07-09; the live Lab-UI direction is `docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md` "The Instrument Bench", plan `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`). Product value still also grows *upward* (gaming readiness, monitoring, session summaries, priority ranking, export) — the catalog now grows BOTH by measured additions and upward; see `docs/PRODUCT_DIRECTION.md`. Any new feature that is not a catalog tweak must be **read-only / advisory / reversible / session-scoped** until proven safe.

## Dev machine (for hardware-specific work)

Fully **AMD**: **Radeon RX 9070 XT (RDNA4)** GPU, Ryzen X3D-class CPU, 16 logical cores
(~5.1 GHz), ~29.4 GB RAM. **Build & test the AMD path first** — NVIDIA is unverifiable here.
**UAC:** was disabled (`EnableLUA=0`) during early dev; **re-enabled to `1` and rebooted on
2026-05-30** so the `runas` elevation path can be tested. `uac_disabled()` now returns false →
the real `runas` branch is live (not the direct-spawn fallback). To revert: set `EnableLUA=0` + reboot.

## Current state & history

- **Live gate / build / release state:** `docs/RELEASE_STATE.md` — the single authoritative matrix (every gate, the current installer, the blockers). All other docs defer to it on current state.
- **What's next:** `docs/BACKLOG.md` — the living status ledger; pull the next non-gated `[ ]` item.
- **Owner's open items (things only Kuya can do — surface these, never let them drop):** `docs/OWNER_ACTION_CHECKLIST.md` — the ONE consolidated index of everything waiting on the owner (his hands/eyes, his input, his money/legal calls). Born 2026-07-08 after he flagged that lists he'd made were scattered across six docs and got dropped. When he asks "show my checklist" or you finish a train, read this and tell him what's still on him. Every other task-list doc points back to it.
- **Owner's UI / design vision (the visual work backlog):** `docs/UI_VISION_BACKLOG.md` — the ONE home for every owner-authored UI/design/visual ask, with honest status. Born 2026-07-08 after he caught that a UI task list had been dropped: his direction was scattered across ~20 specs and the redesign lane was marked "COMPLETE" after only the Instrument-HUD *reskin* shipped, while the **motion/interaction layer he was most excited about (the sister-site-style panoramic drag telemetry gallery + the JARVIS stack: magnetic cursor, Lenis, GSAP data-reactivity) was never built.** Its 🔴 OPEN section is the real remaining visual work. **A "COMPLETE" redesign checkbox that leaves 🔴 items here is a false-done — a reskin is not the vision.** When shipping a simpler thing than he asked, log it here as a substitution needing sign-off, never silently close it.
- **Money / product direction:** `docs/RECEIPTS_DOCTRINE.md`.
- **Dated state banners + full change history** (this file's former "CURRENT STATE" pile, 2026-06-01 → 2026-06-26): **`docs/CHANGELOG.md`**. Point-in-time records — verify against code before relying on any specific claim.

## How to resume

1. Read `docs/RELEASE_STATE.md` (the gate matrix) for current state.
2. Read `docs/BACKLOG.md` and take the next non-gated `[ ]` item. Per the false-done protocol, never declare "done" without enumerating remaining + gated items.
3. Skim `docs/OWNER_ACTION_CHECKLIST.md` — the owner-facing open items. Don't silently pass over them; if one is now unblocked or the owner asks, surface it.
4. For anything UI/visual — read `docs/UI_VISION_BACKLOG.md` 🔴 OPEN section. Do NOT report the UI as "done"/"queue empty" off RELEASE_STATE alone; those track the shipped reskin, not the owner's unbuilt motion/interaction vision.
5. Treat any file:line claim as point-in-time — verify against current code before asserting.

## TOKEN LAW (owner decree 2026-07-22 — after a same-week usage cap-out; permanent, both lanes)

1. **Docs carry CURRENT STATE only.** History, dated banners, and logs live in `docs/archive/*`
   (move, never delete, leave a pointer — precedent: `archive/RELEASE_STATE_HISTORY.md`).
   `scripts/doc-budget.ps1` enforces line budgets: run it in every verify pass; a FAIL means
   archive before you commit.
2. **Read big docs by section** (search first, then offset/length) — never whole-file re-reads of
   RELEASE_STATE / BACKLOG / CHANGELOG when a section answers the question.
3. **Edit with minimal anchors** — smallest unique match, ≤3 lines of context. Paragraph-sized
   anchors echo walls of text through the model twice.
4. **Terse reports** (extends the terse-report law): outcome · evidence · what's-next; cite
   `path#section` instead of restating doc content.
5. **Screenshots/images only when the next action depends on seeing one.**
6. A weekly Cowork scheduled sweep ("Sentinel weekly token/doc budget sweep", Mondays 6 AM PT)
   runs the budget check and archives overages. Extend that sweep — never build a parallel monitor.
