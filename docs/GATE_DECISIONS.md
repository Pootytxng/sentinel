# 🔒 Gate Decision Brief — the safe path to "opening a gate"

> **Owner said "open any gates."** HQ will **not blanket-arm** — each LOCKED gate is, by your own law
> (CLAUDE.md), a *deliberate, specific, informed* decision + welfare-check + per-feature QA + sign-off. Arming
> ships **Windows-mutation code or outbound network to real machines** = the "irreversible / outward-facing /
> ships to other machines" line I must confirm before crossing. (Precedent: an auto-flipped security setting once
> tripped the safety classifier — itself a STOP.) This brief turns "open the gates" into **one informed flip per
> gate** so you can say e.g. *"arm service-suspend"* with eyes open. The flip itself stays your sign-off — that line
> is immovable; everything *up to* it I'll do for you.

## Current gate states (verified 2026-06-25, `main` @ cc04d0f)
| Gate | State | File |
|---|---|---|
| service-suspend (Phase B) | **DARK** (`false`; `#[cfg(test)]` seam only) | `actions.rs:1302` |
| leftovers restore (Phase B) | **DARK** (`false`) | `leftovers.rs:727` |
| remote-fetch rules | **DARK** (`false`, placeholder pubkey, no CDN) | `remote_rules.rs:96` |
| Receipts telemetry (Phase C) | **BUILT-DARK** (off) | `receipts.rs` |
| License/Pro (Phase D) | **BUILT-DARK** (off) | `license.rs` |
| Gaming Mode (F1) | **ON** — *pre-existing*, owner-signed 2026-06-18 for reboot QA | `lib.rs:499` |
| updater / signing | off / none | `tauri.conf.json` |

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
- **Arming = ** a **NEW outbound-network boundary** — it breaks the *verified zero-outbound* property that the whole "measurement brand" trust rests on. **Requires** its own spec + **security review** + explicit owner sign-off (stop-rule 3). **Highest brand-risk of any gate** — do not arm casually; only after Phase B is proven and a deliberate spec exists.

### 🔒 Phase D · money / affiliate / funnel / Pro
- Owner-territory business steps (entity, Paddle, domain, waitlist) — not a code flip I perform.

### ⛔ Hard-locked, not in scope to arm now
- remote-fetch arming · updater enable · signing keys · force-push · frozen beta refs (`16069fa`). These stay shut.

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
   - [ ] **owner-run live scenarios** (real service mutation — your step): orchestrator full-cycle restore + crash/orphan recovery.
3. [ ] Owner runs the live #[ignore] scenarios (UAC-on machine): `cargo test ... -- --ignored --nocapture --test-threads=1`.
4. [ ] Owner signs off on the QA evidence.
5. [ ] HQ flips `service_suspend_gate()` → true, rebuilds, owner reinstalls.

**HQ recommendation:** open exactly ONE gate — **Phase B service-suspend** — via this sequence. Say *"arm service-suspend"* and I'll do step 2 (the careful QA-harness build) and hand you a one-decision flip; I will not flip the gate without your sign-off on the QA. Phase C/D stay shut until you deliberately choose them.
