//! sys_exe: the ONE place a Windows system tool is located and a child process is built for it.
//!
//! Why this exists (hardening slice 1). Rust's std on Windows resolves a bare program name
//! (`Command::new("powershell.exe")`) in the directory of the RUNNING EXE first. Compy's install
//! directory is writable by the user, so a `powershell.exe` planted beside `compy.exe` would be run
//! instead of the real one - and inside the elevated helper (`compy.exe --run-elevated`, the elevated
//! FPS helper) that is code execution with administrator rights.
//!
//! The rule here: a system tool is named by the closed [`SysTool`] enum, never by a string; its path is
//! built from the REAL system directory returned by the Win32 API (`GetSystemDirectoryW` /
//! `GetWindowsDirectoryW`) and never from `PATH`, the application directory, the current directory or an
//! environment variable (`SystemRoot`/`windir` are attacker-influenced; the API is not). The child is
//! started with an absolute program path, so std's search order is never used, and it never starts in
//! the install or data folder (its working directory is System32).
//!
//! PowerShell children additionally get a pinned `PSModulePath`, `PATH`, `COMSPEC` and `PATHEXT`, so
//! neither the user's module folders nor the user's `PATH` can substitute a cmdlet or a native tool
//! that a script calls by bare name (`powercfg` inside a script resolves through the child's `PATH`).
//! The pin EXCLUDES the user's module folders (`Documents\WindowsPowerShell\Modules`); it is not
//! "System32 modules only": Windows PowerShell 5.1 re-adds the administrator-only
//! `Program Files\WindowsPowerShell\Modules` folder in front of it (measured by the reviewer).
//! The elevated path ([`elevated_command`]) also clears the inherited environment and restores a short
//! allowlist, because the elevated child would otherwise inherit an environment the user shaped
//! (`HKCU\Environment`).
//!
//! NOT covered here (later slices): the install directory itself is still user-writable (a replaced
//! `compy.exe` or a DLL beside it), the generic `--run-elevated` entry, and the FPS helper's file paths.
//!
//! Guard: `tests::no_bare_command_new_outside_the_resolver` fails on any `Command::new`, aliased
//! `Command`, async process crate or process-creating Win32 call (`CreateProcess*`, `ShellExecute*`,
//! `WinExec`) in `src-tauri/src` outside this file unless the line carries a `// spawn-allow: <reason>`
//! marker. It is a speed bump, not a proof.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// A Windows system tool Compy may start. Closed on purpose: there is no way to ask for an arbitrary
/// program by name or path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SysTool {
    PowerShell,
    Powercfg,
    Sc,
    Netsh,
    Logman,
    Bcdedit,
    Explorer,
    Wevtutil,
    #[cfg(test)]
    Cmd,
    #[cfg(test)]
    Ping,
}

impl SysTool {
    /// Every tool, so the tests cover each one and a new variant cannot be left out.
    #[cfg(test)]
    pub(crate) const ALL: &'static [SysTool] = &[
        SysTool::PowerShell,
        SysTool::Powercfg,
        SysTool::Sc,
        SysTool::Netsh,
        SysTool::Logman,
        SysTool::Bcdedit,
        SysTool::Explorer,
        SysTool::Wevtutil,
        SysTool::Cmd,
        SysTool::Ping,
    ];

    /// The file name inside the tool's fixed directory.
    fn file_name(self) -> &'static str {
        match self {
            SysTool::PowerShell => "powershell.exe",
            SysTool::Powercfg => "powercfg.exe",
            SysTool::Sc => "sc.exe",
            SysTool::Netsh => "netsh.exe",
            SysTool::Logman => "logman.exe",
            SysTool::Bcdedit => "bcdedit.exe",
            SysTool::Explorer => "explorer.exe",
            SysTool::Wevtutil => "wevtutil.exe",
            #[cfg(test)]
            SysTool::Cmd => "cmd.exe",
            #[cfg(test)]
            SysTool::Ping => "ping.exe",
        }
    }
}

/// Used only if the Win32 call fails (it does not on a working Windows): a verbatim path that can
/// never exist, so every spawn built from it fails NotFound. It is deliberately NOT a real-looking
/// `C:\Windows\...` literal: on a machine whose Windows is on another drive, a file planted at
/// `C:\Windows\System32\powershell.exe` would otherwise be run.
const UNAVAILABLE_DIR: &str = r"\\?\compy-system-dir-unavailable";

/// Windows' own default `PATHEXT`, pinned for PowerShell children.
const PINNED_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

/// `CREATE_NO_WINDOW`: no console flashes for a console-subsystem child.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn wide_to_path(buf: &[u16], len: u32) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    let n = len as usize;
    if n == 0 || n >= buf.len() {
        return None;
    }
    let p = PathBuf::from(std::ffi::OsString::from_wide(&buf[..n]));
    // A usable answer is a drive-absolute path.
    if p.is_absolute() && p.has_root() { Some(p) } else { None }
}

fn query_system_dir() -> Option<PathBuf> {
    use windows::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buf = [0u16; 520];
    // SAFETY: `buf` is a valid, writable buffer for the whole call.
    let n = unsafe { GetSystemDirectoryW(Some(&mut buf)) };
    wide_to_path(&buf, n)
}

fn query_windows_dir() -> Option<PathBuf> {
    use windows::Win32::System::SystemInformation::GetWindowsDirectoryW;
    let mut buf = [0u16; 520];
    // SAFETY: `buf` is a valid, writable buffer for the whole call.
    let n = unsafe { GetWindowsDirectoryW(Some(&mut buf)) };
    wide_to_path(&buf, n)
}

/// A directory answer from the API, or the can-never-exist path when the API failed (fail closed).
fn dir_or_unavailable(answer: Option<PathBuf>) -> PathBuf {
    answer.unwrap_or_else(|| PathBuf::from(UNAVAILABLE_DIR))
}

/// The real System32 directory (`GetSystemDirectoryW`).
pub(crate) fn system_dir() -> &'static Path {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| dir_or_unavailable(query_system_dir()))
}

/// The real Windows directory (`GetWindowsDirectoryW`).
pub(crate) fn windows_dir() -> &'static Path {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| dir_or_unavailable(query_windows_dir()))
}

/// `base\name` only when `name` is one plain `*.exe` file name: no separator, no drive, no `..`, no
/// stream. Anything else is refused, so no input can steer the result out of `base`.
fn confined(base: &Path, name: &str) -> Option<PathBuf> {
    let plain = !name.is_empty()
        && name.len() > ".exe".len()
        && name.to_ascii_lowercase().ends_with(".exe")
        && !name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0'])
        && !name.starts_with('.')
        && !name.ends_with(' ');
    if plain { Some(base.join(name)) } else { None }
}

/// Pure resolver over explicit directories (the tests drive it with fake ones).
fn tool_path_in(system: &Path, windows: &Path, t: SysTool) -> PathBuf {
    let base = match t {
        SysTool::PowerShell => system.join(r"WindowsPowerShell\v1.0"),
        SysTool::Explorer => windows.to_path_buf(),
        _ => system.to_path_buf(),
    };
    // The names are compile-time constants, so this only fails if an edit breaks the rule.
    confined(&base, t.file_name()).expect("SysTool file names are plain *.exe names")
}

/// Absolute path of `t` under the real system directory (`explorer.exe` under the Windows directory).
/// Never `PATH`, never the app directory.
pub(crate) fn sys_tool_path(t: SysTool) -> PathBuf {
    tool_path_in(system_dir(), windows_dir(), t)
}

/// The directories of the pinned `PATH`, in order.
fn pinned_path_dirs(system: &Path, windows: &Path) -> [PathBuf; 4] {
    [
        system.to_path_buf(),
        system.join("Wbem"),
        system.join(r"WindowsPowerShell\v1.0"),
        windows.to_path_buf(),
    ]
}

/// Whether `t` starts without a console window (everything but the GUI Explorer).
fn creates_no_window(t: SysTool) -> bool {
    t != SysTool::Explorer
}

/// Whether `t` gets a rewritten (pinned) environment.
fn rewrites_env(t: SysTool) -> bool {
    t == SysTool::PowerShell
}

/// Pin the environment a PowerShell child resolves modules and bare tool names through. The user's
/// module folders are excluded (PowerShell 5.1 itself re-adds the admin-only Program Files folder).
fn pin_powershell_env(c: &mut Command, system: &Path, windows: &Path) {
    let ps_home = system.join(r"WindowsPowerShell\v1.0");
    c.env("PSModulePath", ps_home.join("Modules"));
    let dirs: Vec<String> = pinned_path_dirs(system, windows).iter().map(|d| d.display().to_string()).collect();
    c.env("PATH", dirs.join(";"));
    c.env("COMSPEC", system.join("cmd.exe"));
    c.env("PATHEXT", PINNED_PATHEXT);
    c.env_remove("PSExecutionPolicyPreference");
}

fn build(t: SysTool, system: &Path, windows: &Path, clear_env: bool) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new(tool_path_in(system, windows, t));
    if clear_env {
        // env_clear first: it also drops anything set before it, so every pin below comes after it.
        c.env_clear();
        for name in ELEVATED_ENV_ALLOWLIST {
            match *name {
                // From the API, not from the (attacker-influenced) inherited value.
                "SystemRoot" | "windir" => {
                    c.env(name, windows);
                }
                "SystemDrive" => {
                    if let Some(drive) = windows.components().next() {
                        c.env(name, drive.as_os_str());
                    }
                }
                _ => {
                    if let Some(v) = std::env::var_os(name) {
                        c.env(name, v);
                    }
                }
            }
        }
    }
    c.current_dir(system);
    if creates_no_window(t) {
        c.creation_flags(CREATE_NO_WINDOW);
    }
    if rewrites_env(t) {
        pin_powershell_env(&mut c, system, windows);
    }
    c
}

/// A `Command` for `t`: absolute program path, System32 working directory, no console window
/// (except Explorer, a GUI), and for PowerShell a pinned `PSModulePath`/`PATH`/`COMSPEC`/`PATHEXT`.
///
/// If the resolved file does not exist the later `spawn`/`output` fails with NotFound exactly like a
/// missing program did before; there is never a fallback to the bare name.
pub(crate) fn sys_command(t: SysTool) -> Command {
    build(t, system_dir(), windows_dir(), false)
}

/// Variables the elevated child gets back after `env_clear()`. `SystemRoot`, `windir` and
/// `SystemDrive` are taken from the Win32 API instead of the inherited value.
pub(crate) const ELEVATED_ENV_ALLOWLIST: &[&str] = &[
    "SystemRoot",
    "windir",
    "SystemDrive",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "CommonProgramW6432",
    "ALLUSERSPROFILE",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "PROCESSOR_LEVEL",
    "PROCESSOR_REVISION",
    "OS",
    "COMPUTERNAME",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE", // data-root-allow: forwarded unchanged to the elevated child, no Compy data path is composed from it
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA", // data-root-allow: forwarded unchanged to the elevated child, no Compy data path is composed from it
    "LOCALAPPDATA", // data-root-allow: forwarded unchanged to the elevated child, no Compy data path is composed from it
    "TEMP",
    "TMP",
];

/// Like [`sys_command`] for the ELEVATED helper: the inherited environment is cleared and only
/// [`ELEVATED_ENV_ALLOWLIST`] is restored, then the PowerShell pins are applied.
pub(crate) fn elevated_command(t: SysTool) -> Command {
    build(t, system_dir(), windows_dir(), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsString;

    fn norm(p: &Path) -> String {
        p.to_string_lossy().to_ascii_lowercase().replace('/', "\\")
    }

    fn under(p: &Path, dir: &Path) -> bool {
        let (p, d) = (norm(p), norm(dir));
        p.starts_with(&format!("{}\\", d.trim_end_matches('\\')))
    }

    fn envs(c: &Command) -> HashMap<String, Option<OsString>> {
        c.get_envs()
            .map(|(k, v)| (k.to_string_lossy().to_ascii_uppercase(), v.map(|v| v.to_os_string())))
            .collect()
    }

    #[test]
    fn every_tool_resolves_absolute_under_system_dir() {
        for &t in SysTool::ALL {
            let p = sys_tool_path(t);
            assert!(p.is_absolute(), "{t:?}: {p:?} is not absolute");
            let dir = if t == SysTool::Explorer { windows_dir() } else { system_dir() };
            assert!(under(&p, dir), "{t:?}: {p:?} is not inside {dir:?}");
            assert!(p.exists(), "{t:?}: {p:?} does not exist on this machine");
            let c = sys_command(t);
            assert_eq!(Path::new(c.get_program()), p, "{t:?}: the Command must carry the absolute path");
            assert_eq!(c.get_current_dir(), Some(system_dir()), "{t:?}: working directory must be System32");
        }
    }

    #[test]
    fn directories_come_from_the_api_and_match_the_system() {
        // Cross-check only (the API is the source of truth, not the environment): on a normal machine
        // the two agree, which also proves the API result is a real Windows directory.
        let root = std::env::var("SystemRoot").expect("SystemRoot is set on Windows");
        assert_eq!(norm(windows_dir()), norm(Path::new(&root)));
        assert_eq!(norm(system_dir()), norm(&Path::new(&root).join("System32")));
        assert!(system_dir().is_dir() && windows_dir().is_dir());
    }

    #[test]
    fn resolver_refuses_anything_that_is_not_a_plain_exe_name() {
        let base = Path::new(r"C:\Windows\System32");
        for bad in [
            "", ".exe", "powershell", "powershell.exe ", r"..\evil.exe", r"sub\evil.exe", "sub/evil.exe",
            r"C:\evil\powershell.exe", "evil.exe:stream", "evil.exe\0", "*.exe", ".hidden.exe", "evil.dll",
        ] {
            assert!(confined(base, bad).is_none(), "{bad:?} must be refused");
        }
        assert_eq!(confined(base, "powercfg.exe"), Some(base.join("powercfg.exe")));
    }

    #[test]
    fn a_fake_tool_in_the_app_directory_is_not_what_gets_resolved() {
        // Plant fakes in a temp "app directory" (never the real install directory).
        let app = std::env::temp_dir().join(format!("compy-h1-app-{}", std::process::id()));
        std::fs::create_dir_all(&app).expect("temp app dir");
        for &t in SysTool::ALL {
            std::fs::write(app.join(t.file_name()), b"not a real exe").expect("plant fake");
        }
        for &t in SysTool::ALL {
            let p = sys_tool_path(t);
            assert!(!under(&p, &app), "{t:?} resolved into the app directory: {p:?}");
            assert_ne!(p.file_name(), None);
            assert!(p.is_absolute(), "an absolute path is never searched for, so the fake cannot win");
            let prog = PathBuf::from(sys_command(t).get_program());
            assert!(!under(&prog, &app), "{t:?}: the Command would run {prog:?}");
        }
        // Even with explicit fake directories handed to the pure resolver, the answer follows ITS
        // directories only; nothing about the current exe or cwd enters.
        let fake_sys = Path::new(r"X:\fake\System32");
        let fake_win = Path::new(r"X:\fake\Windows");
        assert_eq!(tool_path_in(fake_sys, fake_win, SysTool::Powercfg), fake_sys.join("powercfg.exe"));
        assert_eq!(tool_path_in(fake_sys, fake_win, SysTool::Explorer), fake_win.join("explorer.exe"));
        assert_eq!(
            tool_path_in(fake_sys, fake_win, SysTool::PowerShell),
            fake_sys.join(r"WindowsPowerShell\v1.0").join("powershell.exe")
        );
        let _ = std::fs::remove_dir_all(&app);
    }

    #[test]
    fn a_missing_tool_is_an_error_never_a_bare_name_fallback() {
        let ghost = Path::new(r"C:\__compy_h1_missing__");
        let c = build(SysTool::Powercfg, ghost, ghost, false);
        let prog = PathBuf::from(c.get_program());
        assert!(prog.is_absolute() && under(&prog, ghost), "got {prog:?}");
        let mut c = c;
        assert!(c.output().is_err(), "a missing absolute path must fail to spawn");
    }

    #[test]
    fn powershell_env_is_pinned() {
        let c = sys_command(SysTool::PowerShell);
        let e = envs(&c);
        let sys = system_dir();
        let ps_home = sys.join(r"WindowsPowerShell\v1.0");
        let psmp = e.get("PSMODULEPATH").cloned().flatten().expect("PSModulePath pinned").to_string_lossy().into_owned();
        assert_no_user_module_folder(&psmp);
        assert!(
            psmp.split(';').any(|d| norm(Path::new(d)) == norm(&ps_home.join("Modules"))),
            "the system module folder is in the pin"
        );
        let path = e.get("PATH").cloned().flatten().expect("PATH pinned").to_string_lossy().into_owned();
        for dir in path.split(';') {
            let d = Path::new(dir);
            assert!(
                under(&d.join("x"), system_dir()) || under(&d.join("x"), windows_dir()) || norm(d) == norm(windows_dir()),
                "PATH entry {dir:?} is outside the system directories"
            );
        }
        assert!(path.split(';').any(|d| norm(Path::new(d)) == norm(sys)));
        let comspec = e.get("COMSPEC").cloned().flatten().expect("COMSPEC pinned");
        assert_eq!(norm(Path::new(&comspec)), norm(&sys.join("cmd.exe")));
        assert_eq!(e.get("PSEXECUTIONPOLICYPREFERENCE"), Some(&None), "must be removed from the child");
        assert!(e.contains_key("PATHEXT"));
        assert_eq!(c.get_current_dir(), Some(sys));
        // Non-PowerShell tools are not given a rewritten environment.
        assert!(envs(&sys_command(SysTool::Powercfg)).is_empty());
    }

    #[test]
    fn elevated_environment_allowlist_is_exact() {
        let c = elevated_command(SysTool::PowerShell);
        let e = envs(&c);
        let pins = ["PSMODULEPATH", "PATH", "COMSPEC", "PATHEXT", "PSEXECUTIONPOLICYPREFERENCE"];
        let allowed: Vec<String> = ELEVATED_ENV_ALLOWLIST.iter().map(|s| s.to_ascii_uppercase()).collect();
        for k in e.keys() {
            assert!(
                allowed.contains(k) || pins.contains(&k.as_str()),
                "{k} is neither on the allowlist nor a pin"
            );
        }
        // The three the API supplies, regardless of what was inherited.
        for k in ["SYSTEMROOT", "WINDIR"] {
            assert_eq!(
                e.get(k).cloned().flatten().map(|v| norm(Path::new(&v))),
                Some(norm(windows_dir())),
                "{k}"
            );
        }
        assert!(e.contains_key("SYSTEMDRIVE"));
        // Pins still apply after the clear.
        assert!(e.get("PSMODULEPATH").cloned().flatten().is_some() && e.get("PATH").cloned().flatten().is_some());
        // The inherited PSModulePath (the user's, first entry in their Documents folder) is not passed on.
        let pinned = e.get("PSMODULEPATH").cloned().flatten().unwrap();
        assert_no_user_module_folder(&pinned.to_string_lossy());
    }

    #[test]
    fn elevated_command_really_clears_the_inherited_environment() {
        // Harmless read-only proof with `cmd /c set`: no elevation, nothing is changed.
        const SENTINEL: &str = "COMPY_H1_SENTINEL_NOT_ALLOWLISTED";
        std::env::set_var(SENTINEL, "leak");
        let mut c = elevated_command(SysTool::Cmd);
        c.args(["/c", "set"]);
        let out = c.output().expect("cmd.exe runs");
        let text = String::from_utf8_lossy(&out.stdout).to_ascii_uppercase();
        std::env::remove_var(SENTINEL);
        assert!(out.status.success());
        assert!(!text.contains(SENTINEL), "an inherited, non-allowlisted variable reached the child");
        assert!(text.contains("SYSTEMROOT="), "the allowlist must be restored");
        // A plain sys_command keeps the inherited environment (control).
        std::env::set_var(SENTINEL, "kept");
        let mut c = sys_command(SysTool::Cmd);
        c.args(["/c", "set"]);
        let out = c.output().expect("cmd.exe runs");
        let text = String::from_utf8_lossy(&out.stdout).to_ascii_uppercase();
        std::env::remove_var(SENTINEL);
        assert!(text.contains(SENTINEL));
    }

    #[test]
    fn a_resolved_read_only_tool_actually_runs() {
        let mut c = sys_command(SysTool::Cmd);
        c.args(["/c", "exit", "0"]);
        assert!(c.status().expect("cmd.exe starts").success());
    }

    #[test]
    fn when_the_api_fails_every_spawn_fails_closed() {
        let (s, w) = (dir_or_unavailable(None), dir_or_unavailable(None));
        assert_eq!(s, PathBuf::from(UNAVAILABLE_DIR));
        assert!(!s.exists(), "the unavailable path must never exist");
        assert!(
            !UNAVAILABLE_DIR.to_ascii_lowercase().contains(r"c:\windows"),
            "the fallback must not look like a real system directory"
        );
        for &t in SysTool::ALL {
            for clear in [false, true] {
                let mut c = build(t, &s, &w, clear);
                let prog = PathBuf::from(c.get_program());
                assert!(under(&prog, &s) && !prog.exists(), "{t:?}: {prog:?}");
                assert!(c.output().is_err(), "{t:?} (clear_env={clear}) must fail to spawn");
            }
        }
    }

    #[test]
    fn golden_table_per_tool() {
        // (tool, path relative to the Windows directory, lower case; no console window; environment rewritten)
        const GOLDEN: &[(SysTool, &str, bool, bool)] = &[
            (SysTool::PowerShell, r"system32\windowspowershell\v1.0\powershell.exe", true, true),
            (SysTool::Powercfg, r"system32\powercfg.exe", true, false),
            (SysTool::Sc, r"system32\sc.exe", true, false),
            (SysTool::Netsh, r"system32\netsh.exe", true, false),
            (SysTool::Logman, r"system32\logman.exe", true, false),
            (SysTool::Bcdedit, r"system32\bcdedit.exe", true, false),
            (SysTool::Explorer, "explorer.exe", false, false),
            (SysTool::Wevtutil, r"system32\wevtutil.exe", true, false),
            (SysTool::Cmd, r"system32\cmd.exe", true, false),
            (SysTool::Ping, r"system32\ping.exe", true, false),
        ];
        assert_eq!(GOLDEN.len(), SysTool::ALL.len(), "every SysTool needs a golden row");
        let win = norm(windows_dir());
        for &(t, rel, no_window, rewrites) in GOLDEN {
            let p = norm(&sys_tool_path(t));
            assert_eq!(p.strip_prefix(&format!("{win}\\")), Some(rel), "{t:?}");
            assert_eq!(creates_no_window(t), no_window, "{t:?} window flag");
            assert_eq!(rewrites_env(t), rewrites, "{t:?} environment rewrite");
            assert_eq!(!envs(&sys_command(t)).is_empty(), rewrites, "{t:?} environment actually rewritten");
        }
    }

    fn assert_no_user_module_folder(psmp: &str) {
        let user = std::env::var("USERPROFILE").map(|u| u.to_ascii_lowercase()).unwrap_or_default(); // data-root-allow: a test comparing against the profile folder; no data path is composed
        for entry in psmp.split(';').filter(|e| !e.is_empty()) {
            let e = entry.to_ascii_lowercase();
            assert!(!e.contains(r"\documents\"), "user module folder in PSModulePath: {entry}");
            assert!(user.is_empty() || !e.starts_with(&user), "user profile folder in PSModulePath: {entry}");
        }
    }

    /// Windows PowerShell 5.1 re-adds the administrator-only Program Files module folder, so the
    /// effective path is not "System32 only"; the assertion is that no USER folder is in it.
    #[test]
    fn the_effective_psmodulepath_of_a_pinned_child_excludes_user_folders() {
        let mut c = sys_command(SysTool::PowerShell);
        c.args(["-NoProfile", "-NonInteractive", "-Command", "$env:PSModulePath"]);
        let out = c.output().expect("powershell starts");
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert!(!text.is_empty(), "{:?}", out);
        assert_no_user_module_folder(&text);
        assert!(text.to_ascii_lowercase().contains(&norm(system_dir())), "{text}");
    }

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read src dir") {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    const SPAWN_TOOLS: &[&str] = &[
        "powershell", "pwsh", "cmd", "powercfg", "netsh", "sc", "logman", "bcdedit", "explorer", "reg", "wevtutil",
        "schtasks", "wmic", "dism", "taskkill", "ping",
    ];

    /// One source line as the spawn guard sees it: (what process-creating thing it contains, whether
    /// it carries the `// spawn-allow:` marker). Whole-line comments are never code.
    fn classify(line: &str) -> (Option<&'static str>, bool) {
        if line.trim_start().starts_with("//") {
            return (None, false);
        }
        let has_marker = line.contains("// spawn-allow:");
        let code = line.split("// spawn-allow:").next().unwrap_or(line);
        // A trailing prose comment is not code either.
        let code = code.split(" // ").next().unwrap_or(code);
        // `Command::new` in any form (call, path, split before the paren), unless it is only the
        // text of a string literal (a list of banned words).
        let mut rest = code;
        while let Some(i) = rest.find("Command::new") {
            let after = &rest[i + "Command::new".len()..];
            if !after.starts_with('"') {
                return (Some("Command::new"), has_marker);
            }
            rest = after;
        }
        if code.contains("Command as ") {
            return (Some("aliased Command import"), has_marker);
        }
        if ["tokio::process", "async_process", "smol::process", "async_std::process"].iter().any(|p| code.contains(p)) {
            return (Some("async process crate"), has_marker);
        }
        // Case-sensitive on purpose: the SHELLEXECUTEINFOW struct and prose do not match.
        if ["CreateProcess", "ShellExecute", "WinExec", "NtCreateUserProcess"].iter().any(|f| code.contains(f)) {
            return (Some("process-creating Win32 call"), has_marker);
        }
        let names_tool = SPAWN_TOOLS.iter().any(|tool| {
            code.contains(&format!("OsStr::new(\"{tool}\"")) || code.contains(&format!("OsStr::new(\"{tool}.exe\""))
        });
        if names_tool {
            return (Some("system tool named by string"), has_marker);
        }
        (None, has_marker)
    }

    #[test]
    fn the_guard_flags_the_known_bypass_forms() {
        for bad in [
            r#"let c = std::process::Command::new("x");"#,
            "use std::process::{Command as C};",
            "use std::process::Command as Cmd;",
            "let f = Command::new; f(\"x\");",
            "    Command::new",
            "use tokio::process::Command;",
            "CreateProcessW(None, cmd, None, None, false, flags, None, None, &si, &mut pi)?;",
            "windows::Win32::System::Threading::CreateProcessAsUserW(token)",
            "ShellExecuteExW(&mut sei)",
            "ShellExecuteW(None, verb, file, None, None, SW_HIDE);",
            "WinExec(cmdline, 0);",
            r#"elevate_and_wait(std::ffi::OsStr::new("powershell"), &args)"#,
            r#"elevate_and_wait(OsStr::new("cmd.exe"), &args)"#,
        ] {
            let (hit, marked) = classify(bad);
            assert!(hit.is_some(), "the guard must flag: {bad}");
            assert!(!marked);
        }
        // Marked lines are still hits (they are counted against ALLOWED), but are marked.
        let (hit, marked) = classify("ShellExecuteExW(&mut sei) // spawn-allow: reason");
        assert!(hit.is_some() && marked);
        for fine in [
            "// Command::new(\"x\") in a comment",
            "/// ShellExecuteExW in a doc comment",
            r#"for banned in ["std::fs", "Command::new", "write("] {"#,
            "cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,",
            "let c = crate::sys_exe::sys_command(crate::sys_exe::SysTool::Powercfg);",
            r#"let name = OsStr::new("--run-elevated");"#,
        ] {
            assert_eq!(classify(fine).0, None, "must not flag: {fine}");
        }
    }

    /// The spawn guard. Every process spawn goes through this module. A line that must create a
    /// process another way says why with `// spawn-allow: <reason>`; the explicit list below keeps that
    /// short, and each count is exact.
    #[test]
    fn no_bare_command_new_outside_the_resolver() {
        // (file, number of marked lines). Keep this list explicit and short.
        const ALLOWED: &[(&str, usize)] = &[
            ("actions.rs", 3),        // QA missing-program test; ShellExecuteExW import + call (the UAC runas launch)
            ("lib.rs", 1),            // test-only git, never shipped
            ("monitoring.rs", 1),     // the FPS self-spawn of current_exe() (absolute path)
        ];
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        assert!(files.len() > 20, "the scan must find the sources ({} files)", files.len());
        let mut violations = Vec::new();
        let mut marked: HashMap<String, usize> = HashMap::new();
        for f in &files {
            let name = f.file_name().unwrap().to_string_lossy().into_owned();
            if name == "sys_exe.rs" {
                continue;
            }
            let text = std::fs::read_to_string(f).expect("read source");
            for (i, line) in text.lines().enumerate() {
                match classify(line) {
                    (Some(_), true) => *marked.entry(name.clone()).or_default() += 1,
                    (Some(why), false) => violations.push(format!("{}:{}: {why}: {}", name, i + 1, line.trim())),
                    (None, true) => {
                        violations.push(format!("{}:{}: spawn-allow marker on a line that creates nothing", name, i + 1))
                    }
                    (None, false) => {}
                }
            }
        }
        assert!(
            violations.is_empty(),
            "spawn through crate::sys_exe::sys_command(SysTool::..) (or add `// spawn-allow: <reason>` and update ALLOWED):\n{}",
            violations.join("\n")
        );
        let mut got: Vec<(String, usize)> = marked.into_iter().collect();
        got.sort();
        let mut want: Vec<(String, usize)> = ALLOWED.iter().map(|(f, n)| (f.to_string(), *n)).collect();
        want.sort();
        assert_eq!(got, want, "the spawn-allow list changed; review it and update ALLOWED deliberately");
    }

    /// Every native tool a shipped script calls by bare name resolves through the pinned PATH, so it
    /// must exist in one of the pinned directories. The scan looks for common native tool names at a
    /// command position inside the sources (a name in prose only adds a harmless extra check); a tool
    /// that is not in the candidate list is not seen, so extend the list when a script adds one.
    #[test]
    fn every_bare_tool_named_inside_shipped_scripts_exists_in_the_pinned_path() {
        const CANDIDATES: &[&str] = &[
            "powercfg", "netsh", "bcdedit", "sc", "reg", "fsutil", "wevtutil", "dism", "schtasks", "taskkill",
            "logman", "pnputil", "bcdboot", "mountvol", "vssadmin", "ipconfig", "ping", "cmd", "net", "findstr",
            "where", "whoami", "sfc", "chkdsk", "diskpart", "cipher", "icacls", "takeown", "attrib", "robocopy",
            "xcopy", "msiexec", "certutil", "tracerpt", "typeperf", "w32tm", "gpupdate", "nvidia-smi",
        ];
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        let mut found: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
        for f in &files {
            if f.file_name().is_some_and(|n| n == "sys_exe.rs") {
                continue;
            }
            let text = std::fs::read_to_string(f).expect("read source");
            for line in text.lines().filter(|l| !l.trim_start().starts_with("//")) {
                for &name in CANDIDATES {
                    let mut from = 0;
                    while let Some(i) = line[from..].find(name) {
                        let at = from + i;
                        let before = line[..at].chars().next_back();
                        let after = &line[at + name.len()..];
                        let before_ok = matches!(before, None | Some('"' | ' ' | ';' | '{' | '|' | '(' | '\'' | '\t'));
                        let after_ok = after.starts_with(' ') || after.starts_with(".exe ") || after.starts_with(".exe\"");
                        if before_ok && after_ok {
                            found.insert(name);
                        }
                        from = at + name.len();
                    }
                }
            }
        }
        assert!(found.contains("powercfg") && found.contains("netsh"), "the scan must see the known tools: {found:?}");
        let dirs = pinned_path_dirs(system_dir(), windows_dir());
        for name in &found {
            assert!(
                dirs.iter().any(|d| d.join(format!("{name}.exe")).is_file()),
                "{name} is called by a script but is not in any pinned PATH directory {dirs:?}"
            );
        }
    }
}
