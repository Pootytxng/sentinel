# Compy — Gaming Mode (F1) Plan

**PLANNING ONLY. No code.** This is the design + QA contract for Gaming Mode, the only planned
feature that introduces **mutation**. It must be built deliberately, behind its own QA gate.

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

- [ ] **Normal start → end:** prior plan restored exactly; summary saved; file cleared.
- [ ] **App crash while Active:** next launch detects the session, prompts, restores on confirm.
- [ ] **PC reboot while Active:** same — survives a full reboot via the on-disk contract.
- [ ] **Game exits unexpectedly:** end triggers, restores, summary saved.
- [ ] **UAC cancel during start:** no partial state left (→ `RestorePending` undo); clear message; no session file lingering as `active` without a contract.
- [ ] **UAC cancel during restore:** → `RestoreFailed`; contract retained; clear retry path; never reports success.
- [ ] **Missing power plan at restore:** fail safe with a clear message (reuse `070c3c9` behavior); never silent fallback.
- [ ] **External power-plan change mid-session:** restore still targets the **stored** GUID; honest "still active?" recompute.
- [ ] **Monitoring start failure:** Gaming Mode still applies/ restores correctly; monitoring failure is non-fatal and surfaced.
- [ ] **Overlay failure:** same — non-fatal, surfaced, doesn't block restore.
- [ ] **Session summary still saved when safe** (game presented frames), and absent cleanly when not.

## 9. Release gate

**Gaming Mode cannot ship until its own mutation QA (§8) passes.** The existing manual-mutation QA
sign-off (2026-05-31) covers the recommendation apply/rollback engine — it does **not** cover
Gaming Mode's session lifecycle or crash-recovery. Gaming Mode stays gated until §8 is green and
the owner signs off on it specifically.

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

Only after all of the above + §8 QA + owner sign-off does Gaming Mode leave its gate.
