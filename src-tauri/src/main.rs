// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let argv: Vec<String> = std::env::args().collect();

    // Elevated command helper (Wave 0): `compy.exe --run-elevated <hex>` runs ONE validated
    // PowerShell command windowless (compy.exe is windows-subsystem in release → no console flash)
    // and exits with its code, BEFORE any Tauri window. See actions::run_elevated_powershell.
    if let Some(pos) = argv.iter().position(|a| a == "--run-elevated") {
        let code = argv
            .get(pos + 1)
            .map_or(2, |hex| compy_lib::run_elevated_helper(hex));
        std::process::exit(code);
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
