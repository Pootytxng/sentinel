//! Gaming Mode (F1) session core — PURE. State machine + restore-contract
//! resolution + session-file serde. NO Windows mutation here (that lives in
//! `gaming_orchestrator.rs`). Mirrors the readiness/sessions/priorities pattern:
//! the testable logic is pure; the imperative layer stays thin.
//!
//! Safety invariants this module enforces by construction:
//! - the session file is the on-disk rollback contract; load is fail-safe
//!   (absent / corrupt / wrong-schema -> None, never a panic, never a partial);
//! - restore runs in reverse apply order;
//! - any change can declare it needs elevation to restore, so the orchestrator
//!   knows when a UAC prompt is unavoidable.

use std::path::PathBuf;

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
/// rollback contract from `actions.rs` so restore == the audited rollback path.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct SessionChange {
    /// Human label for the diff / honesty line (e.g. "Windows Game Mode on").
    pub(crate) label: String,
    pub(crate) rollback_action: RollbackAction,
    pub(crate) snapshot: Snapshot,
    /// true => restoring this change needs UAC (the advanced power-setting tier).
    pub(crate) elevated_restore: bool,
}

/// The on-disk session contract. Same shape the Trust Ledger persists, but in
/// its OWN file so temporary session changes never pollute the permanent ledger.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct SessionFile {
    pub(crate) schema_version: u32,
    pub(crate) session_id: String,
    pub(crate) status: SessionStatus,
    pub(crate) started_at: String, // RFC3339
    pub(crate) app_version: String,
    pub(crate) changes: Vec<SessionChange>,
    /// Whether Compy started monitoring/overlay this session (so it knows to
    /// stop only what it started). Reserved for the deferred monitoring step.
    pub(crate) started_monitoring: bool,
}

// ─── Pure state logic ────────────────────────────────────────────────────

/// Stopping an `Active` (or resuming an `Ending`) session both head to `Ending`.
pub(crate) fn next_on_stop(_current: SessionStatus) -> SessionStatus {
    SessionStatus::Ending
}

/// Whether a session file found on startup means the previous run did not end
/// cleanly and recovery is needed. ANY non-cleared status qualifies (a cleanly
/// ended session deletes its file, so its mere presence is already suspicious).
pub(crate) fn needs_recovery(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Active
            | SessionStatus::Ending
            | SessionStatus::RestorePending
            | SessionStatus::RestoreFailed
    )
}

/// Restore in reverse of apply order (undo the last-applied change first).
pub(crate) fn resolve_restore_order(changes: &[SessionChange]) -> Vec<SessionChange> {
    changes.iter().rev().cloned().collect()
}

// ─── Pure serde + fail-safe persistence ──────────────────────────────────

/// PURE parse: returns None on any error OR schema mismatch (fail safe — a
/// contract we cannot fully trust is treated as absent, never partially
/// applied).
pub(crate) fn parse_session_json(s: &str) -> Option<SessionFile> {
    let f: SessionFile = serde_json::from_str(s).ok()?;
    if f.schema_version != SESSION_SCHEMA_VERSION {
        return None;
    }
    Some(f)
}

// Test-only: redirects THIS thread's session file (and the orchestrator's session-scoped batch
// receipts, which live beside it) into a private temp dir, so CI-safe tests can exercise the REAL
// save/load/clear path without ever touching a live session on the rig. Same RAII idiom as the
// actions.rs seams (ForceElevationError etc.); never compiled into the shipped binary.
#[cfg(test)]
thread_local! {
    static SESSION_DIR_OVERRIDE: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

/// RAII guard installing the session-dir redirect on this thread for its lifetime (test-only).
#[cfg(test)]
pub(crate) struct SessionDirOverride;

#[cfg(test)]
impl SessionDirOverride {
    pub(crate) fn begin(dir: &std::path::Path) -> Self {
        SESSION_DIR_OVERRIDE.with(|s| *s.borrow_mut() = Some(dir.to_path_buf()));
        SessionDirOverride
    }
}

#[cfg(test)]
impl Drop for SessionDirOverride {
    fn drop(&mut self) {
        SESSION_DIR_OVERRIDE.with(|s| *s.borrow_mut() = None);
    }
}

/// The directory the session contract lives in — the app data dir in production; the thread's
/// override under test. The orchestrator also parks its session-scoped elevation receipts here,
/// keeping every session-lifetime artifact on the same redirect.
pub(crate) fn session_data_dir() -> PathBuf {
    #[cfg(test)]
    if let Some(d) = SESSION_DIR_OVERRIDE.with(|s| s.borrow().clone()) {
        return d;
    }
    crate::compy_data_dir()
}

fn session_path() -> PathBuf {
    session_data_dir().join(GAMING_SESSION_FILE)
}

/// Load the on-disk session, if any. None on absent / corrupt / old-schema.
pub(crate) fn load_session() -> Option<SessionFile> {
    let s = std::fs::read_to_string(session_path()).ok()?;
    parse_session_json(&s)
}

/// Persist atomically: write a temp file then rename, so a crash mid-write
/// never leaves a half-written contract on disk.
pub(crate) fn save_session(f: &SessionFile) -> Result<(), String> {
    let p = session_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(f).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Delete the contract. Called ONLY after a restore is fully confirmed.
pub(crate) fn clear_session() -> Result<(), String> {
    let p = session_path();
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change_stub(label: &str, elevated: bool) -> SessionChange {
        SessionChange {
            label: label.into(),
            rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
            snapshot: Snapshot::GameMode { prior_enabled: None, prior_allow: None },
            elevated_restore: elevated,
        }
    }

    fn sample_file() -> SessionFile {
        SessionFile {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: "s1".into(),
            status: SessionStatus::Active,
            started_at: "2026-06-02T00:00:00Z".into(),
            app_version: "0.1.0".into(),
            changes: vec![change_stub("game-mode", false)],
            started_monitoring: false,
        }
    }

    #[test]
    fn next_status_on_stop_is_ending() {
        assert_eq!(next_on_stop(SessionStatus::Active), SessionStatus::Ending);
        assert_eq!(next_on_stop(SessionStatus::Ending), SessionStatus::Ending);
    }

    #[test]
    fn every_uncleared_status_needs_recovery() {
        for s in [
            SessionStatus::Active,
            SessionStatus::Ending,
            SessionStatus::RestorePending,
            SessionStatus::RestoreFailed,
        ] {
            assert!(needs_recovery(s));
        }
    }

    #[test]
    fn restore_order_is_reverse_of_apply() {
        let changes = vec![
            change_stub("power", false),
            change_stub("game-mode", false),
            change_stub("usb", true),
        ];
        let order: Vec<String> = resolve_restore_order(&changes)
            .iter()
            .map(|c| c.label.clone())
            .collect();
        assert_eq!(order, vec!["usb", "game-mode", "power"]);
    }

    #[test]
    fn session_file_round_trips() {
        let f = sample_file();
        let json = serde_json::to_string(&f).unwrap();
        let back = parse_session_json(&json).unwrap();
        assert_eq!(back.session_id, f.session_id);
        assert_eq!(back.status, SessionStatus::Active);
        assert_eq!(back.changes.len(), 1);
    }

    #[test]
    fn corrupt_or_old_schema_parses_to_none() {
        assert!(parse_session_json("{ not json").is_none());
        assert!(parse_session_json(r#"{"schema_version":999,"session_id":"x"}"#).is_none());
    }

    #[test]
    fn status_serializes_kebab_case() {
        let json = serde_json::to_string(&SessionStatus::RestorePending).unwrap();
        assert_eq!(json, "\"restore-pending\"");
    }
}
