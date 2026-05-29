// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Elevated helper mode: when launched with --fps-capture, run the ETW
    // present-event consumer instead of the Tauri app. Sentinel spawns itself
    // with this flag (elevated) to capture FPS / frametime. See fps.rs.
    if std::env::args().any(|a| a == "--fps-capture") {
        sentinel_lib::run_fps_capture();
        return;
    }
    sentinel_lib::run()
}
