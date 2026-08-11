//! Opt-in system tray ("minimize to tray") — §1-compatible by design.
//!
//! DEFAULT OFF. With the toggle off, closing the main window does a full clean exit exactly as
//! Train #3 §1 shipped (see lib::run's `on_window_event`). Opt in via Settings → Behavior and
//! closing instead HIDES the window to a VISIBLE tray icon — the opposite of the §1 ghost bug
//! (that was an *invisible* windowless process holding the single-instance lock; a tray icon is
//! the honest visible signal Compy is still running). The tray menu always offers a real Quit
//! that runs the same §1 teardown (`monitoring::shutdown_for_exit` + `app.exit`).
//!
//! The hover tooltip shows live stats while capturing — built entirely backend-side from the
//! existing monitoring tick (no new IPC, no polling): `Compy · 178 fps · 1% low 133 · gpu 65°C`,
//! and `Compy · monitoring off` when idle. CPU TEMP IS NEVER SHOWN (locked rule — no kernel driver).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

// Whether closing the window hides to tray instead of exiting. The frontend syncs this from its
// persisted preference (localStorage) on startup and whenever the toggle changes, via the
// `set_close_to_tray` command. Default OFF means the §1 clean-exit is the behavior until the user
// explicitly opts in — and if the webview never loads, close still safely exits.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);
static TRAY: OnceLock<TrayIcon> = OnceLock::new();
// Tracks the icon's ACTUAL shown state. TrayIconBuilder::build() adds the icon visible, so it starts
// true. We only call set_visible on a real change — calling set_visible(false) on an already-hidden
// icon makes the tray-icon crate log "Error removing system tray icon" (a redundant NIM_DELETE), and
// the frontend's default-OFF startup sync (doubled by React StrictMode in dev) would do exactly that.
static TRAY_SHOWN: AtomicBool = AtomicBool::new(true);

pub(crate) fn close_to_tray_enabled() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Acquire)
}

/// Idempotent show/hide — only toggles the OS tray icon on an actual state change (no redundant
/// NIM_ADD/NIM_DELETE, which the crate logs as an error). No-op when the tray failed to init.
fn set_tray_visible(visible: bool) {
    if let Some(tray) = TRAY.get() {
        if TRAY_SHOWN.swap(visible, Ordering::AcqRel) != visible {
            let _ = tray.set_visible(visible);
        }
    }
}

/// Pure flag store, split from the command so the §1-critical default/mechanics stay unit-testable
/// WITHOUT pulling the GUI tray code (TrayIcon::set_visible → a comctl32-v6 import) into the
/// un-manifested `cargo test` binary, which would fail to load. The codebase tests pure logic, not
/// window/GUI glue (that's manual-QA, like the §1 close handler).
fn store_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Release);
}

/// UI-preference sync from the webview (NOT a data/polling channel — the only thing it carries is
/// the close-to-tray toggle). Adds no capability surface; app commands are callable by the main
/// window by default. The tray icon is shown only while the feature is on, so a user who never
/// opts in never sees a stray icon (and closing keeps the §1 clean exit).
#[tauri::command]
pub(crate) fn set_close_to_tray(enabled: bool) {
    store_close_to_tray(enabled);
    set_tray_visible(enabled);
}

/// Restore the main window — show it if it exists, recreate it if a prior unclean exit left no
/// window (the same logic the single-instance plugin uses; shared so tray-Show and a second launch
/// behave identically).
///
/// `activate` decides whether the restored window is also RAISED to the foreground. A tray click or
/// an owner-initiated relaunch is a request to look at Compy, so it raises. A tooling-initiated
/// relaunch (`--no-activate`, see `lib::QUIET_LAUNCH_ARG`) restores the window where it stands and
/// leaves the foreground alone — on Windows, activating any window minimises an exclusive-fullscreen
/// game, and a build finishing is not a reason to end the owner's session. Without this parameter
/// the whole foreground-courtesy path is defeated by a single relaunch, because the second process
/// hands its intent here and this function used to focus regardless.
pub(crate) fn show_or_recreate_main(app: &AppHandle, activate: bool) {
    match app.get_webview_window("main") {
        Some(win) => {
            // Unminimize even when staying quiet: a window left minimised is one the owner cannot
            // click on the taskbar to reach. It restores in place; it does not come forward.
            let _ = win.unminimize();
            let _ = win.show();
            if activate {
                let _ = win.set_focus();
            }
        }
        None => {
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Compy")
                .inner_size(800.0, 600.0)
                .min_inner_size(380.0, 560.0)
                // Same contract as the config-driven creation in `lib::run()`: `focused(false)` makes
                // the runtime raise this window with SW_SHOWNOACTIVATE instead of SW_SHOW.
                .focused(activate)
                .build();
        }
    }
}

/// Build the tray icon, menu, and event handlers and stash the handle so the monitoring tick can
/// update its tooltip. Reuses the app's window icon (the pulse-C). Called once from `setup`.
pub(crate) fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Compy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Compy", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("compy-tray")
        .tooltip("Compy · monitoring off")
        .menu(&menu)
        // Left-click restores the window; the menu (with the real Quit) is the right-click action.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            // A menu click is the owner asking to SEE Compy — always raise it.
            "show" => show_or_recreate_main(app, true),
            "quit" => {
                // The real exit — same teardown as the §1 close path (helper self-exits ~0.5s).
                crate::monitoring::shutdown_for_exit();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // Likewise a left-click on the tray icon: he pointed at it, so bring it forward.
                show_or_recreate_main(tray.app_handle(), true);
            }
        });

    // Reuse the app's window icon (the pulse-C) so the tray matches the brand icon set.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let _ = TRAY.set(builder.build(app)?);
    // Reconcile the freshly-built (visible) icon to the opt-in flag — default OFF hides it exactly
    // once (a clean NIM_DELETE of the present icon); the frontend's later sync is then a no-op.
    set_tray_visible(close_to_tray_enabled());
    Ok(())
}

fn set_tooltip(text: &str) {
    if let Some(tray) = TRAY.get() {
        let _ = tray.set_tooltip(Some(text));
    }
}

/// Capture is off — the honest idle signal.
pub(crate) fn set_idle() {
    set_tooltip("Compy · monitoring off");
}

/// Capturing but no game is presenting frames yet.
pub(crate) fn set_monitoring_on() {
    set_tooltip("Compy · monitoring on");
}

/// Live stats while a game presents — reuses the monitoring tick's existing data (zero new IPC).
/// GPU temperature only; CPU temp is never shown (locked rule).
pub(crate) fn update_live(fps: f64, low1_fps: f64, gpu_temp_c: Option<u32>) {
    let mut s = format!("Compy · {fps:.0} fps");
    if low1_fps > 0.0 {
        s.push_str(&format!(" · 1% low {low1_fps:.0}"));
    }
    if let Some(t) = gpu_temp_c {
        s.push_str(&format!(" · gpu {t}°C"));
    }
    set_tooltip(&s);
}

#[cfg(test)]
mod tests {
    // Import ONLY the pure flag fns — referencing any TrayIcon GUI symbol here would pull a
    // comctl32-v6 import into the un-manifested test binary and break its load (see store fn).
    use super::{close_to_tray_enabled, store_close_to_tray};

    // The close-to-tray gate must DEFAULT OFF so an unconfigured / never-synced launch keeps the
    // Train #3 §1 clean exit (close fully quits). Locks that safety-critical default + the mechanics.
    #[test]
    fn close_to_tray_defaults_off_and_round_trips() {
        assert!(!close_to_tray_enabled(), "default must be OFF (§1 clean exit)");
        store_close_to_tray(true);
        assert!(close_to_tray_enabled());
        store_close_to_tray(false); // restore so it never bleeds into another test
        assert!(!close_to_tray_enabled());
    }
}
