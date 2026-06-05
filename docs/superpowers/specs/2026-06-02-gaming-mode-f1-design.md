# Gaming Mode (F1) — v1 Implementation Design

**Date:** 2026-06-02
**Status:** Design **APPROVED by owner** 2026-06-02. Implementation authorized: build + push to repo
**behind a default-off gate**. The feature **stays GATED (dark)** until its own mutation QA (§7) passes
on a UAC-on machine **and** the owner signs off specifically.
**Canonical broad design + QA contract:** [`docs/GAMING_MODE_PLAN.md`](../../GAMING_MODE_PLAN.md). This
doc does NOT restate it — it **locks the v1 owner decisions + the implementation architecture**.

---

## 1. Goal & non-negotiables (unchanged from the plan)

Gaming Mode is a **temporary, session-scoped wrapper around already-audited settings** — not a new tweak
pack. It applies a small bundle of safe settings while a game runs and restores the **exact** prior state
when the session ends, **crash-safe** (survives app crash / game crash / full reboot). Rollback-first:
every change is snapshotted *before* it is applied; restore resolves from **local state alone** (never the
catalog, never the network). It introduces **no new mutation primitives** — it reuses the audited
`apply_*`/`rollback_*` functions behind `APPLIABLE_REC_IDS`.

**Hard limits (from plan §4):** no HPET/timer/`bcdedit`/MMCSS/core-parking/NIC-offload packs; no Defender
disabling; no permanent/global mutation; no game injection; no kernel driver; no remote-rules dependency;
**nothing mutates without explicit user consent.** The genuinely "deep/hidden" tweaks are excluded *because*
they are the instability/BSOD/app-conflict risk — they fail the owner's own safety bar.

## 2. v1 behavior & scope — OWNER DECISIONS (2026-06-02)

**Bundle = "Core (UAC-free) always on + opt-in advanced".** Every item reuses an existing audited
apply/rollback and is fully reversible + auto-restored.

| Tier | Settings | Rec IDs reused | UAC? | Default |
|---|---|---|---|---|
| **Core** | Power plan → max performance · Windows Game Mode ON · Game Bar/DVR OFF | power-plan switch (`actions.rs` `070c3c9` path), `game-mode`, `game-bar-disable` | **No** | **On** |
| **Advanced (opt-in)** | USB-selective-suspend-off (AC) · PCIe-ASPM-off (AC) | `usb-selective-suspend-off`, `pcie-aspm-off` | Yes (1 prompt at apply) | **Off** |

**Power-plan selection (core, UAC-free):** auto-pick the best **existing** high-performance plan
(Ultimate Performance › High Performance). If neither exists, **skip the power-plan switch** (do NOT
silently create a plan — that would need elevation and break the no-UAC promise) and offer a one-time,
explicit *"create Ultimate Performance?"* action the user may accept (the only core path that asks UAC).
Restore always targets the **exact stored prior plan GUID** (never `SCHEME_CURRENT`).

**Trigger:** **manual** start/stop for v1. Auto-detect-on-game-launch is **deferred** (opt-in, OFF by
default, a later step) — and even then it would *prompt*, never silently mutate.

**Monitoring/overlay:** **not bundled** in v1 (opt-in integration deferred to a later step).

## 3. Consent & honesty UX — OWNER DECISION: "deep consent once, then 1-click"

- **First enable (one time):** a modal stating **exactly what it changes** + the **exact auto-restore
  guarantee**; requires explicit confirmation to enable. Persisted (e.g. `localStorage`
  `compy_gaming_consent_v1`), mirroring the onboarding-gate pattern.
- **After that:** single-click **Start / Stop**, no nag. An **always-visible** line — *"what this changes ·
  auto-restores on exit"* — and the **full concrete diff viewable on demand**.
- **Advanced toggles** (USB-SS / PCIe-ASPM) get their **own one-time consent** (they introduce the UAC
  prompt); off until the user opts in.
- **No mutation from merely launching a game** in v1 (manual start only).

## 4. Crash-safe restore contract (the safety core — from plan §5, locked)

- **Fail-safe ordering:** write session snapshot file → apply → (on stop) restore → **only then** delete
  the file. The restore contract is retained on disk until restore is **confirmed** complete.
- **Session file:** `%APPDATA%\Compy\gaming-session.json` (via `compy_data_dir`). Fields:
  `session_id`, `status`, `started_at` (ISO-8601), `app_version`, the **typed restore contract**
  (`Snapshot::PowerPlan { prior_guid }` + any `Snapshot::PowerPlanSetting {…}` for advanced tweaks +
  registry snapshots for Game Mode / Game Bar), and flags for which extras Compy turned on.
- **Startup recovery check:** on every launch, read the file. If `status ∈ {active, ending,
  restore-pending}` → previous session did not end cleanly → enter `InterruptedRecovery`.
- **Recovery prompt:** *"Gaming Mode was interrupted. Restore your previous settings?"* On confirm, run
  the restore from the stored contract (resolve from local state alone, exactly like `rollback_change`).
  **Never auto-restore without the prompt; never apply anything new during recovery.**
- **Idempotent restore** (safe to re-run). Targets the **exact stored plan GUID**; if the plan is missing
  or UAC is cancelled → `RestoreFailed` (contract retained, clear retry path, **never** a false success).

## 5. State machine (from plan §7, locked)

`Idle` → `Starting` (write snapshot `active`; apply) → `Active` (game running) → `Ending` (set
`status=ending`; restore) → `Idle` (restore ok; save summary; clear file). Failure branches:
`Starting`→`RestorePending` (apply failed/UAC-cancel → undo partial), `Ending`/`RestorePending`→
`RestoreFailed` (restore couldn't complete → keep contract, surface, offer retry), and `Idle`→
`InterruptedRecovery` (startup finds a live file → prompt; never silently cleared).

## 6. Architecture

- **New pure module `src-tauri/src/gaming_session.rs`:** the **state machine + restore-contract
  resolution as pure, unit-tested functions** — no Windows calls in the testable core (mirrors the
  `readiness.rs`/`sessions.rs`/`priorities.rs`/`export.rs` pattern). Pure pieces: next-state transitions;
  building the typed restore contract from a requested bundle + captured snapshots; resolving a contract
  into the ordered restore actions; serialize/deserialize the session file (round-trip + corrupt/missing
  fail-safe).
- **Separate session store (DECISION):** session changes live in **their own `gaming-session.json`**,
  **separate from the permanent Trust Ledger (`history.json`)** — so temporary gaming-mode changes don't
  clutter the user's "active changes" list and auto-clear on restore. (Rejected alternative: routing
  through the Trust Ledger, which conflates temporary session state with permanent applied changes.) The
  actual apply/restore still **reuses the same typed `Snapshot`/`RollbackAction` + `dispatch_rollback`**
  in `actions.rs` — the session module orchestrates, it does not reimplement mutation.
- **IPC commands (in `lib.rs`):** `start_gaming_session(opts)` · `stop_gaming_session()` ·
  `get_gaming_session_state()` · `recover_gaming_session(confirm: bool)`. Registered but **flag-gated**.
- **Frontend (`src/`):** a Gaming Mode surface — the Start/Stop toggle, the first-use consent modal, the
  always-visible honesty line + on-demand diff, the advanced opt-in toggles, and the interrupted-recovery
  prompt. Wired into the de-gamified command-center UI.
- **THE GATE:** a single feature flag (`GAMING_MODE_ENABLED`, **default false**) hides the entire Gaming
  Mode UI surface and short-circuits the IPC so existing app behavior is **unchanged** when off. Built +
  merged to `main` **dark**; the flag flips to `true` only after §7 QA passes + owner sign-off (the
  "build-ahead, ship-on-schedule, keep DARK" rule).

## 7. QA gate (Gaming Mode's OWN — from plan §8; gating)

Verified on a **UAC-on machine**; restore must always reach the exact prior state or fail loudly:
normal start→end · app crash while Active · PC reboot while Active · game exits unexpectedly · UAC cancel
during start (no partial state) · UAC cancel during restore (`RestoreFailed`, retained, never false
success) · missing power plan at restore (fail safe, clear message) · external power-plan change
mid-session (restore still targets stored GUID) · monitoring/overlay failure non-fatal · session summary
saved only when a game presented frames. **Gaming Mode does not ship / the flag does not flip until this
is green + the owner signs off.** The 2026-05-31 mutation-QA sign-off covers the recommendation engine,
**not** this session lifecycle.

## 8. Implementation sequence (TDD; from plan §10)

1. **Tests first** — pure state-machine transitions + restore-contract build/resolve + session-file
   round-trip / corrupt-missing fail-safe (no Windows mutation).
2. **Minimal core** — start/stop: capture snapshots → write session file → apply core bundle (power-plan
   switch to existing plan + `game-mode` + `game-bar-disable`) → restore from contract → clear file.
   Behind the consent model + the `GAMING_MODE_ENABLED` flag.
3. **Crash recovery** — session file + startup recovery check + interrupted-recovery prompt; the §7
   crash/reboot/cancel cases.
4. **Advanced opt-in toggles** — USB-SS / PCIe-ASPM (the UAC tier), off by default.
5. *(Deferred, later)* optional monitoring auto-start; optional per-game auto-detect (opt-in, off by
   default, prompts — never silent).

## 9. Out of scope / explicitly deferred

Auto-detect-on-launch; monitoring/overlay bundling; any of the hard-limit deep tweaks (§1); creating power
plans silently; un-gating (requires §7 + owner sign-off). Nothing here adds a new catalog rec.

## 10. Definition of done for THIS build (what "get it all done" means here)

Code complete (§8 steps 1–4), `cargo test` + `npm test` + build green, `/check` + `/security` clean,
feature **merged to `main` behind the default-off `GAMING_MODE_ENABLED` flag (dark)**, pushed to origin.
**NOT done by me:** the §7 mutation QA on a UAC-on machine + the owner sign-off that flips the flag —
those are handed back to the owner with a checklist.
