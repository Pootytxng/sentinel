//! Game Mode persistence keeper — option 1(b), **mechanism C** (DARK behind `keep_game_mode_gate()`).
//!
//! Problem (proven 2026-06-16): game-recording software (AMD ReLive / NVIDIA ShadowPlay) resets
//! Windows Game Mode to OFF at every login, so a one-shot apply never survives a reboot. A re-assert
//! AFTER that reset wins (reboot-verified at +103s on the owner rig).
//!
//! Mechanism C (owner-chosen, AV-safe): **Compy itself re-asserts Game Mode while it runs** — there
//! is NO dropped script, NO scheduled task, NO new autorun artifact. It is the signed app writing the
//! value it already writes via the normal apply. Paired with an opt-in "start Compy with Windows"
//! (a later slice), Compy launches at login and the keeper holds Game Mode on across reboots.
//!
//! DARK: `keep_game_mode_gate()` ships `false` → the command refuses and the keeper thread never
//! spawns, so the shipped binary has ZERO new runtime behavior until the owner flips the gate after
//! this feature's own QA (the `gaming_mode_gate` / `blackbox_v2_gate` pattern).
//!
//! Rollback-first (LOCKED 3): the re-assert maintains a user-chosen state and writes NO Trust Ledger
//! entry (it is not an "apply" — it would otherwise spam the ledger every login). The on-state stays
//! rollback-able through the user's ORIGINAL game-mode apply entry. This invariant is enforced
//! BACKEND-side, NOT delegated to the (untrusted) webview: `reassert_if_needed` re-asserts only when
//! `history::rec_is_active("game-mode")` — i.e. the user genuinely applied game-mode via Compy and
//! a snapshot/undo exists. So even a compromised UI calling `set_keep_game_mode(true)` can never make
//! the keeper turn Game Mode on without a resolvable rollback. Disabling the toggle stops
//! re-assertion; the normal game-mode rollback turns it off.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[cfg(test)]
use std::cell::RefCell;

/// The user's opt-in. The frontend syncs this from its persisted preference (localStorage) via
/// `set_keep_game_mode`, mirroring `tray::set_close_to_tray`. Default OFF.
static KEEP_GAME_MODE: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
thread_local! {
    /// Test-only force-ON for `keep_game_mode_gate()` — mirrors `blackbox::V2_GATE_TEST_FORCE`.
    static GATE_TEST_FORCE: RefCell<bool> = const { RefCell::new(false) };
}

/// DARK production gate. Ships `false` everywhere; the feature does not exist for users until its own
/// QA passes and the owner flips this. Tests force it on via the thread-local seam (compiled out of
/// shipped binaries).
pub(crate) fn keep_game_mode_gate() -> bool {
    #[cfg(test)]
    {
        if GATE_TEST_FORCE.with(|f| *f.borrow()) {
            return true;
        }
    }
    false
}

pub(crate) fn keep_game_mode_enabled() -> bool {
    KEEP_GAME_MODE.load(Ordering::Acquire)
}

/// Pure flag store, split from the command so the gating mechanics stay unit-testable without the
/// Tauri command layer (mirrors `tray::store_close_to_tray`).
fn store_keep_game_mode(enabled: bool) {
    KEEP_GAME_MODE.store(enabled, Ordering::Release);
}

/// Pure decision: re-assert iff the gate is open, the user opted in, the ledger shows game-mode
/// genuinely applied (so a rollback exists — rollback-first), AND Game Mode is currently reverted
/// (off). `currently_on` and `ledger_active` are injected so this is testable without touching the
/// registry or the ledger. Re-asserting only when reverted keeps it idempotent (no registry churn).
fn should_reassert_given(currently_on: bool, ledger_active: bool) -> bool {
    keep_game_mode_gate() && keep_game_mode_enabled() && ledger_active && !currently_on
}

/// Re-assert Game Mode ON if needed. Checks the live state + the Trust Ledger (rollback-binding),
/// then writes the GameBar PAIR directly (the audited `actions` constants) — NO ledger entry (see
/// module docs). Returns true iff it wrote.
pub(crate) fn reassert_if_needed() -> bool {
    if !should_reassert_given(crate::game_mode_enabled(), crate::history::rec_is_active("game-mode")) {
        return false;
    }
    write_game_mode_on()
}

fn write_game_mode_on() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok((key, _)) = hkcu.create_subkey(crate::actions::GAMEBAR_KEY) else {
        return false;
    };
    // Mirror the normal apply: the whole pair, so Windows has nothing to reconcile away.
    let a = key.set_value(crate::actions::GAME_MODE_ALLOW_VALUE, &1u32);
    let b = key.set_value(crate::actions::GAME_MODE_ENABLED_VALUE, &1u32);
    a.is_ok() && b.is_ok()
}

/// Sync the user's opt-in from the webview (mirrors `tray::set_close_to_tray`). Gated: refuses while
/// DARK. On enable, re-asserts immediately so the change takes effect now; the keeper holds it after.
#[tauri::command]
pub(crate) fn set_keep_game_mode(enabled: bool) {
    if !keep_game_mode_gate() {
        return; // DARK: no-op until armed
    }
    store_keep_game_mode(enabled);
    if enabled {
        let _ = reassert_if_needed();
    }
}

/// Start the keeper: a lightweight daemon that re-asserts Game Mode every ~30s while Compy runs, so a
/// recording-app reset at login is corrected within ~30s. No-op while DARK — the thread is never
/// spawned, so the shipped binary gains zero runtime behavior. The thread dies with the process
/// (`app.exit(0)`), so it does not affect the §1 clean-exit.
pub(crate) fn start_keeper() {
    if !keep_game_mode_gate() {
        return;
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(30));
        let _ = reassert_if_needed();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn force_gate(on: bool) {
        GATE_TEST_FORCE.with(|f| *f.borrow_mut() = on);
    }

    // Reset shared state so cases never bleed into one another.
    fn reset() {
        force_gate(false);
        store_keep_game_mode(false);
    }

    #[test]
    fn gate_defaults_off() {
        reset();
        assert!(!keep_game_mode_gate(), "the keeper gate must ship DARK (default OFF)");
    }

    #[test]
    fn pref_round_trips() {
        reset();
        assert!(!keep_game_mode_enabled());
        store_keep_game_mode(true);
        assert!(keep_game_mode_enabled());
        reset();
        assert!(!keep_game_mode_enabled());
    }

    #[test]
    fn never_reasserts_while_dark_even_with_pref_on() {
        reset();
        store_keep_game_mode(true);
        // Gate OFF (shipped default): even reverted + opted-in + ledger-applied must NOT write.
        assert!(!should_reassert_given(false, true));
        reset();
    }

    #[test]
    fn reasserts_only_when_armed_opted_in_applied_and_reverted() {
        reset();
        force_gate(true);

        // opted out → never (regardless of ledger/state)
        store_keep_game_mode(false);
        assert!(!should_reassert_given(false, true));

        store_keep_game_mode(true);
        // opted in + currently ON → no churn
        assert!(!should_reassert_given(true, true));
        // opted in + reverted but NOT applied in the ledger → no re-assert (rollback-first:
        // never turn it on without a resolvable undo, even if the UI asked).
        assert!(!should_reassert_given(false, false));
        // opted in + reverted + genuinely applied in the ledger → re-assert
        assert!(should_reassert_given(false, true));

        reset();
    }

    #[test]
    fn set_command_is_a_noop_while_dark() {
        reset();
        set_keep_game_mode(true);
        assert!(!keep_game_mode_enabled(), "DARK: the sync command must not arm the pref");
        reset();
    }
}
