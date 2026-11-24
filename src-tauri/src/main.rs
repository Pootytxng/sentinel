// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let argv: Vec<String> = std::env::args().collect();

    // A9 (plan a5 v4 Slice 2): the ONLY elevated command helper entry is the typed one: `compy.exe
    // --run-elevated-op <hex JSON> [--pipe <name> --parent-pid <pid>]` checks a request of the closed set
    // whole, composes its one script and runs it windowless (compy.exe is windows-subsystem in release, so no
    // console flash), BEFORE any Tauri window. See compy_lib::run_elevated_op_argv.
    if let Some(pos) = argv.iter().position(|a| a == compy_lib::ELEVATED_OP_FLAG) {
        std::process::exit(compy_lib::run_elevated_op_argv(&argv[pos + 1..]));
    }
    // The deleted generic entry (`--run-elevated <hex> <ticket>`, which ran any PowerShell): refused, nothing
    // decoded or run, and never the app's window started elevated.
    if argv.iter().any(|a| a == compy_lib::DELETED_GENERIC_ELEVATED_FLAG) {
        std::process::exit(compy_lib::refused_generic_elevated_entry());
    }

    // Elevated helper mode: when launched with --fps-capture, run the ETW
    // present-event consumer instead of the Tauri app. Compy spawns itself
    // with this flag (elevated) to capture FPS / frametime. See fps.rs.
    let is_helper = argv.iter().any(|a| a == "--fps-capture");

    // Release-gate QA diagnostic (debug builds only): record how each process
    // instance launched, so we can PROVE the elevated helper enters headless
    // mode and never the UI. Production builds don't write this.
    #[cfg(debug_assertions)]
    log_launch(is_helper);

    if is_helper {
        compy_lib::run_fps_capture();
        return;
    }
    compy_lib::run()
}

#[cfg(debug_assertions)]
fn log_launch(is_helper: bool) {
    use std::io::Write;
    // data-root-allow: the NSIS per-user INSTALL dir for launch-debug.log, not the data root.
    // This runs before `run()` and before any resolver exists; it never touches the Trust Ledger.
    let base = match std::env::var("LOCALAPPDATA") {
        Ok(b) => b,
        Err(_) => return,
    };
    let dir = format!("{base}\\Compy");
    let _ = std::fs::create_dir_all(&dir);
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let argv: Vec<String> = std::env::args().collect();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{dir}\\launch-debug.log"))
    {
        let _ = writeln!(
            f,
            "[t={secs}] pid={} helper_mode={is_helper} window={} argv={argv:?}",
            std::process::id(),
            if is_helper {
                "headless (no Tauri window)"
            } else {
                "full app UI"
            },
        );
    }
}
