# 🔒 Gate Decision Brief — the safe path to "opening a gate"

> **HISTORICAL PROCESS BRIEF (2026-06-27).** This records how the original gates were evaluated;
> it is not a current state table or an instruction to re-arm completed work. For live state and
> current owner decisions, use `docs/RELEASE_STATE.md` and `docs/OWNER_ACTION_CHECKLIST.md`.

> **Owner said "open any gates."** HQ will **not blanket-arm** — each LOCKED gate is, by your own law
> (CLAUDE.md), a *deliberate, specific, informed* decision + welfare-check + per-feature QA + sign-off. Arming
> ships **Windows-mutation code or outbound network to real machines** = the "irreversible / outward-facing /
> ships to other machines" line I must confirm before crossing. (Precedent: an auto-flipped security setting once
> tripped the safety classifier — itself a STOP.) This brief turns "open the gates" into **one informed flip per
> gate** so you can say e.g. *"arm service-suspend"* with eyes open. The flip itself stays your sign-off — that line
> is immovable; everything *up to* it I'll do for you.

## Historical gate states (verified 2026-06-27, `main` @ `9463c10`)

> **`docs/RELEASE_STATE.md` is the authoritative gate matrix — if this table and it ever disagree, RELEASE_STATE wins.** This table is a quick reference for the arming PROCESS below; keep it in sync or defer to RELEASE_STATE.

| Gate | State | File |
|---|---|---|
| service-suspend (Phase B) | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:1350` |
| debloat / telemetry-task disable (Phase B) | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:1421` |
| Gaming Mode (F1) | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:499` |
| leftovers restore (Phase B) | **DARK** (`false`) | `leftovers.rs:727` |
| remote-fetch rules | **DARK** (`false`, placeholder pubkey, no CDN) | `remote_rules.rs:96` |
| Receipts telemetry (Phase C) | **BUILT-DARK** (off) | `receipts.rs` |
| License/Pro (Phase D) | **BUILT-DARK** (off) | `license.rs` |
| Gaming Mode (F1) | **ON** — *pre-existing*, owner-signed 2026-06-18 for reboot QA | `lib.rs:499` |
| updater / signing | **OFF at this historical snapshot; now LIVE** | current truth: `docs/RELEASE_STATE.md` |

## Per-gate brief — what each arming actually requires

### 🪪 Phase B · service-suspend  — **recommended FIRST** (most ready, lowest-risk gated feature)
- **State:** fully BUILT-DARK (orchestrator + typed snapshot/rollback in `actions.rs`); a dark-contract test pins the gate false.
- **Arming = ** flip `service_suspend_gate()` → true + surface the session UI.
- **Requires (in order):** (1) **welfare-check** ↓ ; (2) build its **apply/rollback + crash-restore QA harness** (`qa-harness` skill, `#[cfg(test)]` seam — gate stays false in the shipped binary); (3) **owner runs the live QA** on a UAC-on machine (start → suspend → exact restore · crash/orphan recovery · UAC-cancel = no partial · critical-services HARD-blocked) — this is *your* step, like Gaming-Mode §7; (4) **owner signs off on the QA evidence**; (5) flip the gate + rebuild/reinstall.
- **Risk:** writes Windows *service* state on user machines; if restore ever fails → brand/trust damage (the moat). Mitigated by the typed snapshot+rollback + the hard critical-services blocklist (csrss/lsass/services.exe/Defender/WindowsUpdate/audio/USB/network flagged).

### 🪪 Phase B · GPU-profile apply / bloat removal / one-click re-apply
- **State:** NOT built. Each **expands the frozen tweak catalog** = LOCKED-rule-6 product decision, higher effort + risk. **Defer behind service-suspend.**

### 📡 Phase C · Receipts telemetry
- **State:** consent UI + payload preview BUILT-DARK.
- **Arming = ** a **NEW telemetry boundary beyond the signed updater**. **Requires** its own spec +
  **security review** + explicit owner sign-off (stop-rule 3). **Highest brand-risk of any remaining
  gate** — do not arm casually; only after a deliberate spec exists.

### 🔒 Phase D · money / affiliate / funnel / Pro
- Owner-territory business steps (entity, Paddle, domain, waitlist) — not a code flip I perform.

### ⛔ Hard-locked, not in scope to arm now
- remote-fetch arming · signing-key exposure · force-push · frozen beta refs (`16069fa`). The
  updater item in this historical list is superseded: it is now live and consent-first per
  `docs/RELEASE_STATE.md`.

## Phase B service-suspend — WELFARE-CHECK (what / why / blast-radius)
- **What:** let a gaming session temporarily `sc stop` an owner-chosen set of safe services and **restore them exactly** on session end / crash.
- **Why:** free RAM/CPU during play; advertised value of the "session" feature. Reversible by design.
- **Blast radius:** touches live Windows service state on the user's machine *during a session*. Worst case = a service doesn't restart → user confusion / instability until reboot. Contained by: typed snapshot before every stop, idempotent fail-loud restore, startup orphan-recovery, and a hard critical-services blocklist. **Outbound network: none. Kernel: none. Catalog: this is the one new mutation, owner-decided.**

## GO / NO-GO to arm service-suspend (say "arm service-suspend" to start)
1. [x] Welfare-check acknowledged (above).
2. [~] QA harness (DARK; gate stays false) — **partially built + verified by HQ:**
   - [x] **UAC-cancel = no partial mutation** — `qa_uac_cancel_leaves_service_untouched` (actions.rs): forced
     elevation-failure → suspend errors, service EXACTLY unchanged. **HQ ran it, PASSED** (before==after, honest
     decline message). Safe to run (no real mutation).
   - [x] exact apply→resume restore — `qa_suspend_then_resume_restores_exact_state` (pre-existing, live #[ignore]).
   - [x] critical/off-list services HARD-blocked + flood-bounded + gate-dark + session-file round-trip (existing tests).
   - [ ] **live exact-restore of a RUNNING service** — ⛔ BLOCKED on this rig (see below).
3. [⛔] Live exact-restore QA — **ATTEMPTED 2026-06-25, two blockers found (neither is a feature bug):**
   - **(a) No running allowlisted service on this rig:** WSearch / SysMain / DiagTrack / NvTelemetryContainer are ALL
     stopped (DPS runs but is correctly off-allowlist). So "suspend a *running* service → restore to running" can't be
     exercised here — only a trivial stopped→stopped round-trip.
   - **(b) cargo-test elevation harness broken since Wave 0 — ✅ FIXED 2026-06-25:** `run_elevated_powershell`
     elevated `current_exe() --run-elevated` = the test binary → exit 101. Added a `#[cfg(test)]`-only
     direct-elevation seam (`ForceDirectElevation`) so QA elevations actually run under `cargo test` (production
     self-helper path BYTE-IDENTICAL, verified). The elevated path now runs live (you approved it). This un-breaks
     every elevated QA harness, `gaming_mode_qa` included.
   - **(c) NEW wall — every allowlisted service is DISABLED on this rig** (WSearch/SysMain/DiagTrack `start_type=4`).
     A disabled service can't be started, so proving "suspend a RUNNING service → restore to running" requires
     temporarily flipping its startup type Disabled→Manual→Disabled — a deeper change to your *tuned* config than
     "briefly mutate a service" implied. Not done without your explicit OK.
   - **What IS proven:** cancel=no-partial (HQ-verified) · typed-contract round-trip · critical/off-list blocked ·
     gate-dark · UAC-approval path reaches the elevated child. **NOT proven live:** elevated suspend+restore of a running service.
   - **Fix options (owner to direct — touches the elevation boundary, so not hot-patched autonomously):**
     (i) add a `#[cfg(test)]` elevation seam so cargo-test QA elevates powershell directly (pre-Wave-0 path; reviewed change), OR
     (ii) exercise the live QA through the real `compy.exe` (where `current_exe()` IS compy.exe) on a moment when an allowlisted service is running.
4. [x] **LIVE QA PASSED 2026-06-25** (owner-approved UAC, option A). Running-service exact-restore PROVEN:
   SysMain Stopped(disabled) → enabled+started=Running → suspend=Stopped → **resume=Running (exact prior)** →
   cleanup restored to Disabled+Stopped (rig config untouched). With cancel=no-partial + typed round-trip +
   critical-blocked + gate-dark, **the §7 matrix is satisfied.** ⇒ **awaits OWNER SIGN-OFF on this evidence.**
5. [x] **ARMED 2026-06-25** (owner sign-off: "flip service-suspend"). `service_suspend_gate()` → `true`; built the
   session **service-selection UI** (3 allowlisted services — SysMain/DiagTrack/WSearch — in `GamingMode.tsx`, wired
   into `start_gaming_session` + shown in the consent modal); dark-contract tests → armed. cargo 636 / vitest 3958 /
   build clean. NvTelemetryContainer stays allowlisted-but-unoffered (NVIDIA-only).
6. [x] **REBUILT + STAGED 2026-06-26** — release build (`CODEGEN_UNITS=256`, 10.7 GB free, 41.6s) from `main` @ `f9b6840`
   carries BOTH armed Phase-B features (service-suspend + debloat). **NSIS `Compy_0.1.0_x64-setup.exe` SHA-256
   `512DAFF324545D2E726AA70AA4F5B2365699E16CD96B9004849863838824A836`** (3,266,584 B) + MSI
   `305B2143E69959E4BC713D89B6C473FFD4CFD85513806684CE5F5B40669F3DBD` (4,726,784 B) — staged to Desktop, source==copy
   hash-verified. Frozen beta refs (`16069fa`) untouched. NOTE (2026-06-27): this `512DAFF3…` installer has since been
   superseded several times; reinstall is **Claude's job** per the silent-reinstall law, NOT an owner action. Current
   installer + live state: see `docs/RELEASE_STATE.md`.

**HQ recommendation:** open exactly ONE gate — **Phase B service-suspend** — via this sequence. Say *"arm service-suspend"* and I'll do step 2 (the careful QA-harness build) and hand you a one-decision flip; I will not flip the gate without your sign-off on the QA. Phase C/D stay shut until you deliberately choose them.
