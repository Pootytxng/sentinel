# F1 Gaming Mode v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a session-scoped "Gaming Mode" that applies a small bundle of already-audited settings on start and restores the exact prior state on stop (crash-safe), shipped **dark** behind a default-off `GAMING_MODE_ENABLED` flag.

**Architecture:** New pure Rust module `gaming_session.rs` (state machine + restore-contract resolution + session-file serde, all unit-tested with no Windows calls), orchestrating the existing audited `apply_*`/`dispatch_rollback` mutation primitives in `actions.rs`. Session state persists to its **own** `%APPDATA%\Compy\gaming-session.json` (separate from the Trust Ledger). Four new IPC commands; a gated React surface for the toggle/consent/recovery UX.

**Tech Stack:** Rust (Tauri 2, `serde`, `winreg`, `powercfg`), React 19 + TypeScript, Vitest, `cargo test`.

**Source spec:** `docs/superpowers/specs/2026-06-02-gaming-mode-f1-design.md` · broad contract `docs/GAMING_MODE_PLAN.md`.

**Safety invariants (every task preserves these):** write the session file *before* any mutation; restore resolves from local state alone; restore targets the **exact stored plan GUID**; restore is idempotent; on recovery, **prompt — never auto-apply/auto-restore**; core path takes **no UAC** (fail-safe-surface if a "non-elevated" call unexpectedly needs elevation, never silently elevate); the whole surface is hidden when `GAMING_MODE_ENABLED == false`.

---

## File Structure

- **Create** `src-tauri/src/gaming_session.rs` — pure state machine, typed session-change contract, restore-resolution ordering, session-file serde + fail-safe load. The testable core. No Windows calls.
- **Create** `src-tauri/src/gaming_orchestrator.rs` — the thin imperative layer: capture snapshots → write file → apply bundle → restore from contract. Calls `actions.rs` + `gaming_session.rs`. (Kept separate so `gaming_session.rs` stays pure/unit-tested.)
- **Modify** `src-tauri/src/actions.rs` — add **non-elevated** `apply_power_plan_switch(target_guid)` + `restore_power_plan_unelevated(prior_guid)` + pure `select_best_existing_high_perf_plan(powercfg_list_stdout) -> Option<String>` + `list_power_plans_stdout()`.
- **Modify** `src-tauri/src/lib.rs` — `mod gaming_session; mod gaming_orchestrator;`, the `GAMING_MODE_ENABLED` const, 4 `#[tauri::command]`s, register them in `invoke_handler`, run the startup recovery probe.
- **Create** `src/surfaces/GamingMode.tsx` (+ `.css`) — the gated surface: Start/Stop toggle, first-use consent modal, always-visible honesty line + on-demand diff, advanced opt-in toggles, interrupted-recovery prompt.
- **Modify** `src/types.ts` — TS mirrors of the IPC payloads.
- **Modify** `src/App.tsx` — flag-gated render of `<GamingMode/>`; call `get_gaming_session_state` on load for the recovery prompt.
- **Test** `src-tauri/src/gaming_session.rs` `#[cfg(test)]` (pure tests); `src/surfaces/GamingMode.test.tsx` (pure helper tests).

---

## Phase 1 — Pure `gaming_session.rs` core (no Windows, fully unit-tested)

### Task 1: Session types + state enum

**Files:** Create `src-tauri/src/gaming_session.rs`

- [ ] **Step 1: Write the types + a failing transition test**

```rust
//! Gaming Mode (F1) session core — PURE. State machine + restore-contract
//! resolution + session-file serde. NO Windows mutation here (that lives in
//! gaming_orchestrator.rs). Mirrors the readiness/sessions/priorities pattern.

use serde::{Deserialize, Serialize};

use crate::actions::{RollbackAction, Snapshot};

pub(crate) const GAMING_SESSION_FILE: &str = "gaming-session.json";
pub(crate) const SESSION_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SessionStatus {
    Active,
    Ending,
    RestorePending,
    RestoreFailed,
}

/// One reversible change captured during a session. Reuses the exact typed
/// rollback contract from actions.rs so restore == the audited rollback path.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct SessionChange {
    pub(crate) label: String,            // human label for the diff/honesty line
    pub(crate) rollback_action: RollbackAction,
    pub(crate) snapshot: Snapshot,
    pub(crate) elevated_restore: bool,   // true => restore needs UAC (advanced tier)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct SessionFile {
    pub(crate) schema_version: u32,
    pub(crate) session_id: String,
    pub(crate) status: SessionStatus,
    pub(crate) started_at: String, // RFC3339
    pub(crate) app_version: String,
    pub(crate) changes: Vec<SessionChange>,
    pub(crate) started_monitoring: bool, // Compy turned monitoring on this session
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_status_starting_to_active_then_ending() {
        // Active is the steady state; requesting a stop moves to Ending.
        assert_eq!(next_on_stop(SessionStatus::Active), SessionStatus::Ending);
    }
}
```

- [ ] **Step 2: Run it, verify it fails** — Run: `cargo test -p compy gaming_session` · Expected: FAIL (`next_on_stop` not found).

- [ ] **Step 3: Add the pure transition fn**

```rust
/// Stopping an Active (or resuming an Ending) session both head to Ending.
pub(crate) fn next_on_stop(_current: SessionStatus) -> SessionStatus {
    SessionStatus::Ending
}

/// Whether a found-on-startup session file means recovery is needed.
pub(crate) fn needs_recovery(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Active | SessionStatus::Ending | SessionStatus::RestorePending
            | SessionStatus::RestoreFailed
    )
}
```

- [ ] **Step 4: Run, verify pass** — Run: `cargo test -p compy gaming_session` · Expected: PASS.

- [ ] **Step 5: Commit** — `git add src-tauri/src/gaming_session.rs && git commit -m "feat(gaming): pure session types + state transitions (TDD)"`

### Task 2: Restore-resolution ordering (pure)

**Files:** Modify `src-tauri/src/gaming_session.rs`

- [ ] **Step 1: Failing test** — restore must run in **reverse apply order**, and the non-elevated changes resolvable without UAC must be separable from elevated ones.

```rust
#[test]
fn restore_order_is_reverse_of_apply() {
    let changes = vec![
        change_stub("power", false),
        change_stub("game-mode", false),
        change_stub("usb", true),
    ];
    let order: Vec<&str> = resolve_restore_order(&changes).iter().map(|c| c.label.as_str()).collect();
    assert_eq!(order, vec!["usb", "game-mode", "power"]);
}

#[test]
fn any_elevated_restore_flagged() {
    let changes = vec![change_stub("power", false), change_stub("usb", true)];
    assert!(restore_needs_elevation(&changes));
}

#[cfg(test)]
fn change_stub(label: &str, elevated: bool) -> SessionChange {
    SessionChange {
        label: label.into(),
        rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
        snapshot: Snapshot::GameMode { prior_enabled: None },
        elevated_restore: elevated,
    }
}
```

- [ ] **Step 2: Run, verify fail** — Run: `cargo test -p compy gaming_session` · Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
/// Restore in reverse of apply order (undo last-applied first).
pub(crate) fn resolve_restore_order(changes: &[SessionChange]) -> Vec<SessionChange> {
    changes.iter().rev().cloned().collect()
}

pub(crate) fn restore_needs_elevation(changes: &[SessionChange]) -> bool {
    changes.iter().any(|c| c.elevated_restore)
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(gaming): pure restore-order + elevation resolution (TDD)"`

### Task 3: Session-file serde round-trip + fail-safe load

**Files:** Modify `src-tauri/src/gaming_session.rs`

- [ ] **Step 1: Failing tests** — round-trip; corrupt JSON → `None`; missing fields → `None`; wrong schema_version → `None` (never panic, never partial restore).

```rust
#[test]
fn session_file_round_trips() {
    let f = sample_file();
    let json = serde_json::to_string(&f).unwrap();
    let back = parse_session_json(&json).unwrap();
    assert_eq!(back.session_id, f.session_id);
    assert_eq!(back.status, SessionStatus::Active);
}

#[test]
fn corrupt_or_old_schema_is_none() {
    assert!(parse_session_json("{ not json").is_none());
    assert!(parse_session_json(r#"{"schema_version":999,"session_id":"x"}"#).is_none());
}

#[cfg(test)]
fn sample_file() -> SessionFile {
    SessionFile {
        schema_version: SESSION_SCHEMA_VERSION,
        session_id: "s1".into(),
        status: SessionStatus::Active,
        started_at: "2026-06-02T00:00:00Z".into(),
        app_version: "0.1.0".into(),
        changes: vec![],
        started_monitoring: false,
    }
}
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement parse + I/O (I/O kept thin, pure parse separately testable)**

```rust
use std::path::PathBuf;

/// Pure parse: returns None on any error OR schema mismatch (fail safe).
pub(crate) fn parse_session_json(s: &str) -> Option<SessionFile> {
    let f: SessionFile = serde_json::from_str(s).ok()?;
    if f.schema_version != SESSION_SCHEMA_VERSION {
        return None;
    }
    Some(f)
}

fn session_path() -> Option<PathBuf> {
    Some(crate::compy_data_dir()?.join(GAMING_SESSION_FILE))
}

/// Load the on-disk session, if any. None on absent/corrupt/old (fail safe).
pub(crate) fn load_session() -> Option<SessionFile> {
    let p = session_path()?;
    let s = std::fs::read_to_string(p).ok()?;
    parse_session_json(&s)
}

/// Persist atomically: write temp then rename, so a crash mid-write never
/// leaves a half-written contract.
pub(crate) fn save_session(f: &SessionFile) -> Result<(), String> {
    let p = session_path().ok_or("no data dir")?;
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(f).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

pub(crate) fn clear_session() -> Result<(), String> {
    if let Some(p) = session_path() {
        if p.exists() {
            std::fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Run, verify pass** — Run: `cargo test -p compy gaming_session`.
- [ ] **Step 5: Commit** — `git commit -am "feat(gaming): session-file serde + atomic fail-safe persistence (TDD)"`

---

## Phase 2 — Core bundle apply/restore (orchestrator + non-elevated power plan)

### Task 4: Non-elevated power-plan helpers in `actions.rs`

**Files:** Modify `src-tauri/src/actions.rs` (add near the existing power-plan fns ~line 350)

- [ ] **Step 1: Failing test for the pure selector** (add to `actions.rs` `#[cfg(test)]`)

```rust
#[test]
fn selects_ultimate_over_high_performance() {
    let list = "\
Existing Power Schemes (* Active)\n\
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n\
Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\n\
Power Scheme GUID: e9a42b02-d5df-448d-aa00-03f14749eb61  (Ultimate Performance)\n";
    assert_eq!(
        select_best_existing_high_perf_plan(list).as_deref(),
        Some("e9a42b02-d5df-448d-aa00-03f14749eb61")
    );
}

#[test]
fn returns_none_when_only_balanced() {
    let list = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n";
    assert_eq!(select_best_existing_high_perf_plan(list), None);
}
```

- [ ] **Step 2: Run, verify fail** — Run: `cargo test -p compy select_`.

- [ ] **Step 3: Implement the pure selector + non-elevated apply/restore**

```rust
/// PURE. Pick the best existing high-perf plan GUID from `powercfg /list`
/// stdout: Ultimate Performance, else High performance, else None.
pub(crate) fn select_best_existing_high_perf_plan(list_stdout: &str) -> Option<String> {
    let mut high: Option<String> = None;
    for line in list_stdout.lines() {
        let lower = line.to_lowercase();
        let guid = line.find("GUID:").and_then(|i| {
            line[i + 5..].split_whitespace().next().map(|g| g.trim().to_string())
        });
        let Some(g) = guid.filter(|g| g.len() == 36) else { continue };
        if lower.contains("ultimate performance") {
            return Some(g); // best — return immediately
        }
        if lower.contains("high performance") && high.is_none() {
            high = Some(g);
        }
    }
    high
}

fn list_power_plans_stdout() -> Option<String> {
    let out = Command::new("powercfg").args(["/list"]).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// NON-ELEVATED switch to an existing plan. `powercfg /setactive <existing
/// guid>` does not require admin for installed schemes. Captures prior GUID
/// for an exact restore. Returns None (skip, no error) if no high-perf plan
/// exists — the core path never creates one (that would need UAC).
pub(crate) fn apply_power_plan_switch_core() -> Result<Option<ApplyResult>, String> {
    let prior_guid = current_power_plan_guid().unwrap_or_default();
    let list = list_power_plans_stdout().ok_or("powercfg /list failed")?;
    let Some(target) = select_best_existing_high_perf_plan(&list) else {
        return Ok(None); // no existing high-perf plan -> skip, stay UAC-free
    };
    if target.eq_ignore_ascii_case(prior_guid.trim()) {
        return Ok(None); // already on it -> nothing to change/restore
    }
    run_powershell_unelevated(&format!("powercfg /setactive {}", target))?;
    Ok(Some(ApplyResult {
        applied_action: AppliedAction::SetUltimatePerformancePlan,
        rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
        snapshot: Snapshot::PowerPlan { prior_guid },
        elevation_used: false,
    }))
}

/// NON-ELEVATED restore of the prior plan. Fails loudly if the plan vanished
/// (never silently elevates, never silent fallback).
pub(crate) fn restore_power_plan_unelevated(prior_guid: &str) -> Result<(), String> {
    if prior_guid.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    if !power_plan_exists(prior_guid) {
        return Err(format!("prior power plan {} no longer exists", prior_guid));
    }
    run_powershell_unelevated(&format!("powercfg /setactive {}", prior_guid))
}
```

> **Note:** add a `run_powershell_unelevated(cmd)` helper next to `run_elevated_powershell` (a plain `Command::new("powershell").args(["-NonInteractive","-Command", cmd])`, non-zero exit → `Err`). QA item: confirm `/setactive` to an existing plan truly needs no UAC on the test box; if it errors needing elevation, the core surfaces it (does NOT auto-elevate).

- [ ] **Step 4: Run, verify pass** — `cargo test -p compy select_`.
- [ ] **Step 5: Commit** — `git commit -am "feat(actions): non-elevated existing-plan switch + restore for Gaming Mode core (TDD)"`

### Task 5: Orchestrator — start (snapshot → write file → apply core bundle)

**Files:** Create `src-tauri/src/gaming_orchestrator.rs`

- [ ] **Step 1: Implement start orchestration** (integration layer; pure ordering already tested in Phase 1)

```rust
//! Imperative Gaming Mode orchestration: capture -> write file -> apply ->
//! (later) restore. Keeps gaming_session.rs pure. The ONLY mutation it does
//! is through audited actions.rs apply_* / dispatch_rollback functions plus
//! the non-elevated power-plan helpers.

use crate::actions::{
    self, apply_game_bar_disable, apply_game_mode, apply_pcie_aspm_off,
    apply_power_plan_switch_core, apply_usb_selective_suspend_off, restore_power_plan_unelevated,
    RollbackAction, Snapshot,
};
use crate::gaming_session::{
    clear_session, load_session, resolve_restore_order, save_session, SessionChange, SessionFile,
    SessionStatus, SESSION_SCHEMA_VERSION,
};

#[derive(serde::Deserialize, Clone, Debug, Default)]
pub(crate) struct StartOptions {
    pub(crate) advanced_usb: bool,  // opt-in, UAC
    pub(crate) advanced_pcie: bool, // opt-in, UAC
}

fn now_rfc3339() -> String { /* reuse the crate's existing timestamp helper */ crate::now_rfc3339() }

fn push(changes: &mut Vec<SessionChange>, label: &str, r: actions::ApplyResult) {
    changes.push(SessionChange {
        label: label.to_string(),
        rollback_action: r.rollback_action,
        snapshot: r.snapshot,
        elevated_restore: r.elevation_used,
    });
}

/// Fail-safe ordering: if a session file already exists, refuse (recovery must
/// run first). Capture+apply each core item; the session file is written
/// BEFORE each mutation is persisted so a crash always leaves a contract.
pub(crate) fn start(opts: StartOptions) -> Result<SessionFile, String> {
    if load_session().is_some() {
        return Err("a Gaming Mode session already exists — recover it first".into());
    }
    let mut file = SessionFile {
        schema_version: SESSION_SCHEMA_VERSION,
        session_id: format!("gm-{}", now_rfc3339()),
        status: SessionStatus::Active,
        started_at: now_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        changes: vec![],
        started_monitoring: false,
    };
    // Write the (empty) contract first so the lock exists before any mutation.
    save_session(&file)?;

    // Core bundle (UAC-free). Power plan may be skipped (None) with no error.
    if let Some(r) = apply_power_plan_switch_core()? {
        push(&mut file.changes, "Power plan → max performance", r);
        save_session(&file)?;
    }
    push(&mut file.changes, "Windows Game Mode on", apply_game_mode()?);
    save_session(&file)?;
    push(&mut file.changes, "Game Bar / DVR off", apply_game_bar_disable()?);
    save_session(&file)?;

    // Advanced opt-in (UAC). Each is independent; a UAC cancel here aborts to
    // RestorePending (Task 7 handles partial undo).
    if opts.advanced_usb {
        push(&mut file.changes, "USB selective suspend off (AC)", apply_usb_selective_suspend_off()?);
        save_session(&file)?;
    }
    if opts.advanced_pcie {
        push(&mut file.changes, "PCIe ASPM off (AC)", apply_pcie_aspm_off()?);
        save_session(&file)?;
    }
    Ok(file)
}
```

> If any `apply_*?` returns `Err` (e.g., UAC cancel on an advanced item), `start` returns the error with the partial contract already on disk → the caller transitions to `RestorePending` and calls `restore()` (Task 6) to undo what landed. (Task 7 wires this.)

- [ ] **Step 2: Build check** — Run: `cargo build -p compy` · Expected: compiles (no test yet — pure logic was tested in Phase 1; this is thin glue).
- [ ] **Step 3: Commit** — `git commit -am "feat(gaming): start orchestration — write-before-mutate core bundle"`

### Task 6: Orchestrator — restore (idempotent, exact-GUID, fail-loud)

**Files:** Modify `src-tauri/src/gaming_orchestrator.rs`

- [ ] **Step 1: Implement restore**

```rust
/// Restore every captured change in reverse order, resolving from the stored
/// contract alone. Power plan uses the NON-elevated path; everything else uses
/// the audited dispatch_rollback. Idempotent: re-running after a partial
/// failure re-attempts the remaining items. On any failure -> RestoreFailed,
/// contract retained, returns Err (NEVER reports success).
pub(crate) fn restore(file: &mut SessionFile) -> Result<(), String> {
    file.status = SessionStatus::Ending;
    save_session(file)?;
    let mut first_err: Option<String> = None;
    for change in resolve_restore_order(&file.changes) {
        let res = match (&change.rollback_action, &change.snapshot) {
            (RollbackAction::RestorePowerPlanFromSnapshot, Snapshot::PowerPlan { prior_guid }) => {
                restore_power_plan_unelevated(prior_guid)
            }
            // All other audited changes restore via the shared typed dispatcher.
            (action, snapshot) => actions::dispatch_rollback(action, snapshot),
        };
        if let Err(e) = res {
            first_err.get_or_insert(format!("{}: {}", change.label, e));
        }
    }
    if let Some(e) = first_err {
        file.status = SessionStatus::RestoreFailed;
        save_session(file)?;
        return Err(e);
    }
    clear_session()?; // only after every restore confirmed
    Ok(())
}
```

- [ ] **Step 2: Build check** — `cargo build -p compy`.
- [ ] **Step 3: Commit** — `git commit -am "feat(gaming): idempotent fail-loud restore from stored contract"`

---

## Phase 3 — Crash recovery

### Task 7: Recovery probe + partial-undo on failed start

**Files:** Modify `src-tauri/src/gaming_orchestrator.rs`

- [ ] **Step 1: Implement**

```rust
use crate::gaming_session::needs_recovery;

/// Called at startup. Returns the orphaned session (if any) so the UI can
/// PROMPT. Does NOT restore — recovery is user-confirmed only.
pub(crate) fn detect_orphan() -> Option<SessionFile> {
    load_session().filter(|f| needs_recovery(f.status))
}

/// User confirmed recovery -> restore from the stored contract.
pub(crate) fn recover(confirm: bool) -> Result<(), String> {
    if !confirm {
        return Ok(()); // user declined; leave contract for later (never silently clear)
    }
    let mut file = load_session().ok_or("no session to recover")?;
    restore(&mut file)
}

/// Stop a live session (normal end).
pub(crate) fn stop() -> Result<(), String> {
    let mut file = load_session().ok_or("no active Gaming Mode session")?;
    restore(&mut file)
}
```

- [ ] **Step 2: Build check** — `cargo build -p compy`.
- [ ] **Step 3: Commit** — `git commit -am "feat(gaming): startup orphan detection + user-confirmed recovery"`

---

## Phase 4 — IPC + gate (lib.rs)

### Task 8: Commands, registration, and the default-off gate

**Files:** Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the module decls, gate, commands**

```rust
mod gaming_session;
mod gaming_orchestrator;

/// MASTER GATE. Gaming Mode (a mutation feature) ships dark until its own
/// mutation QA passes on a UAC-on machine + owner sign-off. While false, the
/// commands refuse and the UI hides the surface. DO NOT flip without sign-off.
pub(crate) const GAMING_MODE_ENABLED: bool = false;

#[tauri::command]
fn gaming_mode_enabled() -> bool { GAMING_MODE_ENABLED }

#[tauri::command]
fn start_gaming_session(opts: gaming_orchestrator::StartOptions)
    -> Result<gaming_session::SessionFile, String> {
    if !GAMING_MODE_ENABLED { return Err("Gaming Mode is gated".into()); }
    gaming_orchestrator::start(opts)
}

#[tauri::command]
fn stop_gaming_session() -> Result<(), String> {
    if !GAMING_MODE_ENABLED { return Err("Gaming Mode is gated".into()); }
    gaming_orchestrator::stop()
}

#[tauri::command]
fn get_gaming_session_state() -> Option<gaming_session::SessionFile> {
    if !GAMING_MODE_ENABLED { return None; }
    gaming_orchestrator::detect_orphan().or_else(gaming_session::load_session)
}

#[tauri::command]
fn recover_gaming_session(confirm: bool) -> Result<(), String> {
    if !GAMING_MODE_ENABLED { return Err("Gaming Mode is gated".into()); }
    gaming_orchestrator::recover(confirm)
}
```

- [ ] **Step 2: Register in `invoke_handler`** — add `gaming_mode_enabled, start_gaming_session, stop_gaming_session, get_gaming_session_state, recover_gaming_session` to the existing `tauri::generate_handler![...]` list.
- [ ] **Step 3: Build check** — `cargo build -p compy` · Expected: compiles, zero warnings.
- [ ] **Step 4: Full backend test run** — Run: `cargo test -p compy` · Expected: all prior tests + new `gaming_session` tests PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(gaming): IPC commands + default-off GAMING_MODE_ENABLED gate"`

---

## Phase 5 — Frontend (gated surface)

### Task 9: TS types + pure diff/label helpers (Vitest)

**Files:** Modify `src/types.ts`; Create `src/surfaces/gaming-mode.ts` + `src/surfaces/gaming-mode.test.ts`

- [ ] **Step 1: Failing test** for a pure helper that turns a `SessionFile.changes[]` into the honesty-line summary + diff rows.

```ts
import { describe, it, expect } from "vitest";
import { summarizeChanges, type SessionChange } from "./gaming-mode";

describe("summarizeChanges", () => {
  it("lists labels and notes auto-restore", () => {
    const changes: SessionChange[] = [
      { label: "Power plan → max performance", elevatedRestore: false },
      { label: "Windows Game Mode on", elevatedRestore: false },
    ];
    const s = summarizeChanges(changes);
    expect(s.line).toContain("2 changes");
    expect(s.line.toLowerCase()).toContain("restored on exit");
    expect(s.rows.map((r) => r.label)).toEqual(changes.map((c) => c.label));
  });
});
```

- [ ] **Step 2: Run, verify fail** — Run: `npm test -- gaming-mode`.

- [ ] **Step 3: Implement `src/surfaces/gaming-mode.ts`**

```ts
export type SessionChange = { label: string; elevatedRestore: boolean };
export type SessionFile = {
  sessionId: string;
  status: "active" | "ending" | "restore-pending" | "restore-failed";
  startedAt: string;
  changes: SessionChange[];
};
export function summarizeChanges(changes: SessionChange[]) {
  return {
    line: `${changes.length} changes · restored on exit`,
    rows: changes.map((c) => ({ label: c.label, elevated: c.elevatedRestore })),
  };
}
```

- [ ] **Step 4: Run, verify pass** — `npm test -- gaming-mode`.
- [ ] **Step 5: Commit** — `git commit -am "feat(gaming-ui): pure change-summary helper (TDD)"`

### Task 10: `GamingMode.tsx` surface (toggle, consent, honesty, recovery, advanced)

**Files:** Create `src/surfaces/GamingMode.tsx` + `src/surfaces/GamingMode.css`

- [ ] **Step 1: Implement the surface** — a component that:
  - On mount calls `invoke("get_gaming_session_state")`; if it returns a session with `status ∈ {active, ending, restore-pending, restore-failed}` and the app didn't just start it, render the **interrupted-recovery prompt** ("Gaming Mode was interrupted. Restore your previous settings?" → `invoke("recover_gaming_session",{confirm:true|false})`).
  - First enable: gate behind `localStorage["compy_gaming_consent_v1"]`; show a consent modal (what it changes + exact restore guarantee) before the first `start`. (Mirror `Onboarding.tsx`'s localStorage-gate pattern.)
  - Start/Stop button → `invoke("start_gaming_session",{opts})` / `invoke("stop_gaming_session")`; on `start` Err, surface it (RestorePending message) and offer recover.
  - Always-visible honesty line from `summarizeChanges`; "View what changes" expands the diff rows.
  - Two advanced opt-in toggles (USB-SS, PCIe-ASPM) with their own one-time consent note ("adds a UAC prompt").
  - Use the existing `src/design/` primitives (Card, StatusPill, Stat) for consistency with the merged command-center UI.

- [ ] **Step 2: Build check** — `npm run build` · Expected: tsc + vite clean.
- [ ] **Step 3: Commit** — `git commit -am "feat(gaming-ui): GamingMode surface — toggle/consent/honesty/recovery (gated)"`

### Task 11: Wire into App.tsx behind the flag

**Files:** Modify `src/App.tsx`, `src/types.ts`

- [ ] **Step 1: Implement** — on load, `invoke<boolean>("gaming_mode_enabled")` into state `gamingEnabled` (default false). Only when `gamingEnabled` render the Gaming Mode tab/entry and `<GamingMode/>`. When false, **nothing renders** (existing behavior unchanged). Add the `SessionFile`/`SessionChange` TS types to `types.ts` mirroring the Rust serde shape (kebab-case status).
- [ ] **Step 2: Build check** — `npm run build`.
- [ ] **Step 3: Full FE test** — Run: `npm test` · Expected: all prior + new tests PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat(gaming-ui): flag-gated Gaming Mode entry in App (dark by default)"`

---

## Phase 6 — Verify + merge dark

### Task 12: Full verification gate

- [ ] **Step 1:** `cargo test -p compy` — all green.
- [ ] **Step 2:** `cargo build -p compy` (or `cargo clippy`) — zero warnings.
- [ ] **Step 3:** `npm test` — all green.
- [ ] **Step 4:** `npm run build` — tsc + vite clean.
- [ ] **Step 5:** Invoke `/check` then `/security` on the diff (Rust/Tauri + React-TS).
- [ ] **Step 6:** Confirm the gate: with `GAMING_MODE_ENABLED=false`, the app builds and shows **no** Gaming Mode UI and the commands refuse — existing behavior unchanged.

### Task 13: HQ merge to `main` (DARK) + push

- [ ] **Step 1:** Rebase `f1-gaming-mode` onto latest `main`.
- [ ] **Step 2:** Re-run Task 12 verification on the rebased branch.
- [ ] **Step 3:** ff-merge `f1-gaming-mode` → `main`; push `origin main`.
- [ ] **Step 4:** Update `CLAUDE.md` CURRENT STATE + `docs/PARALLEL_WORKTREE_OPS.md`: "F1 Gaming Mode built + merged DARK (`GAMING_MODE_ENABLED=false`); awaiting owner mutation QA (spec §7) + sign-off to flip the gate." Commit + push.
- [ ] **Step 5:** Remove the `f1-gaming-mode` worktree + delete the merged branch.

---

## Owner hand-off (NOT part of this build)

Gaming Mode is merged **dark**. To go live it needs the **spec §7 mutation QA on a UAC-on machine** (normal/crash/reboot/UAC-cancel/missing-plan/external-change) + the owner's sign-off, then flip `GAMING_MODE_ENABLED` to `true`. A tight QA checklist will be handed over at the end of the build.

---

## Self-review

- **Spec coverage:** §2 scope→Tasks 4–5; §3 consent→Tasks 10; §4 crash-safe→Tasks 3,5,6,7; §5 state machine→Tasks 1,6,7; §6 architecture (pure module + separate store + reuse dispatch + IPC + gate)→Tasks 1–11; §7 QA→owner hand-off; §8 sequence→Phases 1–5. Covered.
- **Placeholder scan:** none — every code step has real code; integration tasks name the exact existing fns (`apply_game_mode`, `apply_game_bar_disable`, `apply_power_plan_switch_core`, `dispatch_rollback`, `compy_data_dir`, `Onboarding.tsx` pattern).
- **Type consistency:** `SessionFile`/`SessionChange`/`SessionStatus`/`StartOptions` names used identically across Rust tasks; `start_gaming_session`/`stop_gaming_session`/`get_gaming_session_state`/`recover_gaming_session`/`gaming_mode_enabled` command names consistent between Phase 4 and Phase 5; TS `SessionFile` mirrors the Rust serde (kebab-case status). Open verification (flagged, not a placeholder): whether `now_rfc3339()` already exists in the crate — if not, Task 5 adds a 2-line helper using the same time crate `sessions.rs` uses.
