# Compy — Gaming Mode (F1) Plan

> **⚠️ STATUS (current): Gaming Mode is LIVE and signed off, not planned.** `gaming_mode_gate()`
> (`src-tauri/src/lib.rs:520`) returns `true` — flipped 2026-06-18 after the §7 harness passed 6/6, and
> **field QA closed 10/10 with owner sign-off on 2026-07-14** (`docs/GAMING_MODE_QA.md`, incl. the live
> reboot-while-active case). Nothing about this feature is owner-pending. Read the sections below as the
> standing **design + QA contract for the shipped feature**, not as "a feature still to be built."
> `docs/RELEASE_STATE.md` remains authoritative on gate state.

This is the design + QA contract for Gaming Mode, the only feature that introduces **mutation**. It was
built deliberately, behind its own QA gate.

> **Gaming Mode is NOT a new tweak pack.** It is a *temporary, session-scoped wrapper* around
> already-audited settings. It applies safe gaming settings while a game runs and restores the
> **exact** prior state when the session ends — rollback-first, even across a crash or reboot.

It reuses what already exists (no new mutation primitives): the hardened power-plan apply/rollback
(`actions.rs`, the `070c3c9` exact-stored-plan fix), the typed `Snapshot`/`RollbackAction` contract
+ `dispatch_rollback`/`resolve_rollback`, the Trust Ledger's "restore from local state alone" model
(`history.rs`), the FPS-helper **heartbeat lifecycle** as the crash-safe template (`monitoring.rs`/
`fps.rs`), the F3 session aggregator (`sessions.rs`), and `compy_data_dir` for state files.

---

## 1. Product goal

Make Compy useful **during** gameplay without becoming a registry clown car. Gaming Mode:
- temporarily applies a small set of **already-audited** gaming settings while a game is active,
- restores the **exact** prior state when the session ends (or is interrupted),
- preserves the rollback-first safety model: every change is snapshotted *before* it is applied,
  and the restore can be resolved from local state alone — never from the live catalog or network.

The value is the *session lifecycle* (apply on start → restore on end + summary), not new tweaks.

## 2. Initial v1 behavior

**On start (user-initiated):**
1. Detect the selected/running game (v1: user picks / confirms; auto-detect is a later, opt-in step).
2. Capture a **pre-session snapshot** (typed) and write the session state file *before* mutating.
3. Apply the gaming setting(s) — v1 minimal = **power-plan switch only** (see §3).
4. Optionally start FPS monitoring + overlay (only if the user opted in; record that Compy
   started them, so it knows to stop them on end).
5. Record the active session (state = `Active`).

**On end (game exit, or user stops it):**
1. Restore the **exact** prior power plan/settings from the stored snapshot.
2. Stop monitoring/overlay **only if Compy started them** this session.
3. Save a session summary (reuse the F3 aggregator).
4. Mark the session cleanly restored and clear the session lock.

## 3. Allowed v1 mutations (minimal)

Only audited, fully-reversible changes — each reuses an existing verified `apply_*`/`rollback_*`:
- **Power plan switch** to a gaming-suitable plan (user-selected, or an existing High
  Performance / Ultimate Performance), restoring the **prior active plan GUID** on end. This is
  the v1 baseline. *(Note: `powercfg /setactive <guid>` to an existing plan is non-elevated —
  verified during §2a QA — so power-plan-switch-only Gaming Mode can be UAC-free. Creating a new
  plan or changing per-setting AC values needs elevation.)*
- **USB Selective Suspend (AC)** — only the already-audited `usb-selective-suspend-off`, optional, deferred past the minimal build.
- **PCIe ASPM (AC)** — only the already-audited `pcie-aspm-off`, optional, deferred past the minimal build.

Restore always targets the **exact stored plan GUID** (the `070c3c9` contract), never `SCHEME_CURRENT`.

## 4. Explicit non-goals (hard limits)

No HPET / timer / `bcdedit` / MMCSS / core-parking / NIC-offload packs. No Defender disabling. No
**permanent/global** mutation (everything is session-scoped + restored). No game injection. No
kernel driver. No remote-rules dependency. **No automatic hidden changes** — nothing mutates
without explicit user approval (see §6).

## 5. Crash-safe restore model

A session change is an *apply with a guaranteed restore trigger* (game exit **or** next app launch
detecting an orphaned session). The invariant: **modified state is never silently abandoned, and
recovery never applies new changes — only restores.**

- **Pre-session snapshot file** — `%APPDATA%\Compy\gaming-session.json`, written **before** any
  mutation. Holds: `session_id`, `status`, `started_at`, `app_version`, the **typed restore
  contract** (e.g. `Snapshot::PowerPlan { prior_guid }` + any audited setting snapshots), and flags
  for whether Compy started monitoring/overlay. This is the rollback contract — same shape the
  Trust Ledger already persists.
- **Session lock** — the file's existence with `status == "active"` (or `"restore-pending"`) means
  a session is/was live. (Mirrors the FPS helper's heartbeat-file lifecycle.)
- **Startup recovery check** — on every app launch, read the file. If `status` is `active` /
  `ending` / `restore-pending`, the previous session did **not** end cleanly → enter
  `InterruptedRecovery`.
- **Recovery prompt** — *"Gaming Mode was interrupted. Restore your previous settings?"* On
  confirm, run the restore from the stored contract (resolve from local state alone, exactly like
  `rollback_change`). **Never auto-restore without the prompt; never apply anything new.**
- **Fail-safe ordering** — write snapshot → apply → (on end) restore → only then delete the file.
  The contract is retained on disk until restore is **confirmed** complete, so a crash at any point
  leaves a resolvable restore. Restore must be **idempotent** (safe to re-run).

## 6. User consent model

- **First-use explanation:** a one-time modal — what Gaming Mode does, **exactly what it will
  change**, and the **exact rollback plan** — requiring explicit confirmation to enable.
- **Per-session preview:** show the concrete diff (e.g. "Balanced → Ultimate Performance for this
  session; restored on exit") before applying; require confirmation.
- **No mutation from merely launching a game** unless the user explicitly turned on auto-detect
  behavior (off by default; see §10 step 6). Manual start is the v1 default.

## 7. State machine

| State | Meaning | On entry | Transitions |
|---|---|---|---|
| `Idle` | No session | session file absent/cleared | → `Starting` (user starts) · → `InterruptedRecovery` (startup finds a live file) |
| `Starting` | Capturing snapshot + applying | write snapshot file (`active`); apply | → `Active` (ok) · → `RestorePending` (apply failed/UAC cancelled → undo partial) |
| `Active` | Settings applied, game running | monitoring/overlay optional | → `Ending` (game exit / user stop) · (crash → file persists → recovered next launch) |
| `Ending` | Restoring | set `status=ending`; restore from contract | → `Idle` (restore ok; save summary; clear file) · → `RestoreFailed` |
| `RestorePending` | Apply aborted; partial state must be undone | restore from whatever was applied | → `Idle` (ok) · → `RestoreFailed` |
| `RestoreFailed` | Restore couldn't complete (UAC cancel, missing plan) | keep contract; surface clearly; offer retry | → `Idle` (retry ok) · stays (retry/abort with explicit user choice) |
| `InterruptedRecovery` | Startup found an unfinished session | prompt user | → `Ending`/`RestorePending` (confirm) · stays until resolved (never silently cleared) |

## 8. QA plan (Gaming Mode's OWN gate)

Each verified on a UAC-on machine; restore must always reach the exact prior state or fail loudly.

**Execution and results live in `docs/GAMING_MODE_QA.md`** — that doc is the record, this is the
contract. It ran 10 field cases and **owner-signed-off 2026-07-14**. Its case numbering is its own;
the `→ QA #n` pointers below are the mapping. The three items it did **not** cover stay unchecked.

- [x] **Normal start → end:** prior plan restored exactly; summary saved; file cleared. → QA #1 (the *summary saved* sub-clause rides the still-open item below).
- [x] **App crash while Active:** next launch detects the session, prompts, restores on confirm. → QA #3
- [x] **PC reboot while Active:** same — survives a full reboot via the on-disk contract. → QA #4, the headline case
- [x] **Game exits unexpectedly:** end triggers, restores, summary saved. → QA #5
- [x] **UAC cancel during start:** no partial state left (→ `RestorePending` undo); clear message; no session file lingering as `active` without a contract. → QA #6
- [x] **UAC cancel during restore:** → `RestoreFailed`; contract retained; clear retry path; never reports success. → QA #7 (this run exposed the runas-decline misattribution bug; fixed and re-proven before sign-off)
- [x] **Missing power plan at restore:** fail safe with a clear message (reuse `070c3c9` behavior); never silent fallback. → QA #8
- [x] **External power-plan change mid-session:** restore still targets the **stored** GUID; honest "still active?" recompute. → QA #9
- [ ] **Monitoring start failure:** Gaming Mode still applies/ restores correctly; monitoring failure is non-fatal and surfaced.
- [ ] **Overlay failure:** same — non-fatal, surfaced, doesn't block restore.
- [ ] **Session summary still saved when safe** (game presented frames), and absent cleanly when not.

The last three are **unproven, not failing** — no field case and no named automated test covers them.
They sit off the restore contract (monitoring and the overlay are non-fatal side effects; the summary
is written after restore), which is why the gate flipped without them. Do not report them as passed,
and do not report them as blocking: QA #2 and #10 — consent gate, and advanced tier = one UAC prompt —
were field-proven *beyond* this list and have no row here.

## 9. Release gate

**This gate is CLOSED — it was satisfied, not waived.** `gaming_mode_gate()` returns `true`
(`src-tauri/src/lib.rs:520`).

The requirement it imposed: Gaming Mode could not ship on the 2026-05-31 manual-mutation QA sign-off,
because that sign-off covered the recommendation apply/rollback engine and **not** Gaming Mode's
session lifecycle or crash-recovery — so it demanded a green §8 plus an owner sign-off naming Gaming
Mode specifically. Both were produced: the §7 restore-contract harness passed 6/6 (gate flipped
2026-06-18), and the field checklist in `docs/GAMING_MODE_QA.md` closed **10/10 on real hardware with
real UAC prompts and a real reboot — owner sign-off 2026-07-14**, on its own terms rather than by
inheriting the 2026-05-31 one.

Three §8 rows remain unchecked (monitoring-start failure, overlay failure, summary-saved-when-safe).
They are off the restore contract and were never part of what this gate demanded; see §8.

## 10. Implementation sequence

1. **Plan** (this doc).
2. **Tests first** — pure session state-machine + restore-contract resolution (no Windows mutation),
   mirroring the existing pure-function + unit-test pattern (readiness/sessions/priorities/export).
3. **Minimal power-plan-only implementation** — start/stop, snapshot → switch → restore, behind the
   consent model. (Potentially UAC-free if switching to an existing plan.)
4. **Crash recovery** — session file + startup recovery check + interrupted-recovery prompt; the §8
   crash/reboot/cancel cases.
5. **Optional monitoring auto-start** — opt-in; reuse `start_fps_capture` + overlay; record/cleanup.
6. **Optional per-game auto-detection** — opt-in, OFF by default; reuse the ETW presenter detection
   (Compy-safe, no injection). Auto-detect may *prompt*, but does not silently mutate.

Gaming Mode has left that gate (§9): §8's restore-contract rows and the owner sign-off are recorded.
This sequence is kept as the build order that was followed, not as outstanding work — for what is
actually shipped today, read the code and `docs/RELEASE_STATE.md`, not this list.
