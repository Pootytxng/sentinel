//! sys_exe: the ONE place a Windows system tool is located and a child process is built for it.
//!
//! Why this exists (hardening slice 1). Rust's std on Windows resolves a bare program name
//! (`Command::new("powershell.exe")`) in the directory of the RUNNING EXE first. Compy's install
//! directory is writable by the user, so a `powershell.exe` planted beside `compy.exe` would be run
//! instead of the real one - and inside the elevated helper (`compy.exe --run-elevated-op`, the elevated
//! FPS helper) that is code execution with administrator rights.
//!
//! The rule here: a system tool is named by the closed [`SysTool`] enum, never by a string; its path is
//! built from the REAL system directory returned by the Win32 API (`GetSystemDirectoryW` /
//! `GetSystemWindowsDirectoryW`) and never from `PATH`, the application directory, the current directory or an
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
//! `compy.exe` or a DLL beside it) and the FPS helper's file paths. (A9 deleted the generic `--run-elevated` entry.)
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

/// The SYSTEM Windows directory. `GetSystemWindowsDirectoryW`, not `GetWindowsDirectoryW`: on a
/// Terminal Server the latter can return a per-user private Windows directory (hardening 1b).
fn query_windows_dir() -> Option<PathBuf> {
    use windows::Win32::System::SystemInformation::GetSystemWindowsDirectoryW;
    let mut buf = [0u16; 520];
    // SAFETY: `buf` is a valid, writable buffer for the whole call.
    let n = unsafe { GetSystemWindowsDirectoryW(Some(&mut buf)) };
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

/// The real Windows directory (`GetSystemWindowsDirectoryW`).
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

    /// The pure resolver follows only the directories it is given: nothing about the current exe or the
    /// working directory enters. (a1b: this test used to plant fakes in a temp folder the resolver
    /// never reads, which proved nothing about planting. The real planting tests put a decoy beside
    /// the RUNNING executable: change_sources::tests::a_powershell_planted_beside_the_executable_is_never_run
    /// and a_wevtutil_planted_beside_the_executable_is_never_run.)
    #[test]
    fn the_pure_resolver_follows_only_its_own_directories() {
        let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
        for &t in SysTool::ALL {
            let p = sys_tool_path(t);
            assert!(p.is_absolute(), "an absolute path is never searched for");
            assert!(!under(&p, &exe_dir), "{t:?} resolved into the executable's folder: {p:?}");
        }
        let fake_sys = Path::new(r"X:\fake\System32");
        let fake_win = Path::new(r"X:\fake\Windows");
        assert_eq!(tool_path_in(fake_sys, fake_win, SysTool::Powercfg), fake_sys.join("powercfg.exe"));
        assert_eq!(tool_path_in(fake_sys, fake_win, SysTool::Explorer), fake_win.join("explorer.exe"));
        assert_eq!(
            tool_path_in(fake_sys, fake_win, SysTool::PowerShell),
            fake_sys.join(r"WindowsPowerShell\v1.0").join("powershell.exe")
        );
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

    /// One source line as the spawn guard sees it, after [`mask_source`] took the WHOLE file apart.
    struct MaskedLine {
        /// The code with comments removed and string/char literal CONTENTS blanked (quotes kept), so
        /// neither a comment nor text inside a string can hide or fake a spawn.
        blank: String,
        /// The code with comments removed but string literals intact (for `OsStr::new("tool")`).
        with_strings: String,
        /// The text of every comment on the line (where the `spawn-allow:` marker must be).
        comment: String,
    }

    fn is_ident(c: char) -> bool {
        c.is_ascii_alphanumeric() || c == '_'
    }

    /// Split a Rust source file into masked lines. A small lexer over the whole text, so a string or a
    /// block comment that spans lines is masked on every line it covers, and a `" // "` inside a string
    /// does not end the code (a1b: the line-based split at ` // ` let a spawn hide after such a string).
    /// Handles `//` and nested `/* */` comments, `"..."` with escapes, raw strings `r#"..."#` (also
    /// `br`), char literals (`'"'`, `'\''`) vs lifetimes (`'a`).
    fn mask_source(text: &str) -> Vec<MaskedLine> {
        #[derive(PartialEq)]
        enum St {
            Code,
            Line,
            Block(usize),
            Str,
            Raw(usize),
        }
        let chars: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        let (mut blank, mut with_strings, mut comment) = (String::new(), String::new(), String::new());
        let mut st = St::Code;
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let next = chars.get(i + 1).copied();
            if c == '\n' {
                out.push(MaskedLine {
                    blank: std::mem::take(&mut blank),
                    with_strings: std::mem::take(&mut with_strings),
                    comment: std::mem::take(&mut comment),
                });
                if st == St::Line {
                    st = St::Code;
                }
                i += 1;
                continue;
            }
            match st {
                St::Code => {
                    if c == '/' && next == Some('/') {
                        st = St::Line;
                        comment.push_str("//");
                        i += 2;
                        continue;
                    }
                    if c == '/' && next == Some('*') {
                        st = St::Block(1);
                        i += 2;
                        continue;
                    }
                    if c == '"' {
                        st = St::Str;
                        blank.push('"');
                        with_strings.push('"');
                        i += 1;
                        continue;
                    }
                    // Raw string: r"..", r#".."#, br#".."# (an `r` that starts a token).
                    let prev = if i > 0 { Some(chars[i - 1]) } else { None };
                    let token_start = match prev {
                        None => true,
                        Some(p) if !is_ident(p) => true,
                        // `br".."` and `cr".."` (raw byte and raw C strings).
                        Some('b' | 'c') => i < 2 || !is_ident(chars[i - 2]),
                        _ => false,
                    };
                    if c == 'r' && token_start {
                        let mut j = i + 1;
                        while chars.get(j) == Some(&'#') {
                            j += 1;
                        }
                        if chars.get(j) == Some(&'"') {
                            let hashes = j - i - 1;
                            st = St::Raw(hashes);
                            blank.push('"');
                            with_strings.extend(&chars[i..=j]);
                            i = j + 1;
                            continue;
                        }
                    }
                    if c == '\'' {
                        // Char literal or lifetime.
                        if next == Some('\\') {
                            // Skip the escaped character itself (a1b review B2: starting ON it made
                            // `'\''` end at the escaped quote and desync everything after it).
                            let mut j = i + 3;
                            while j < chars.len() && chars[j] != '\'' && chars[j] != '\n' {
                                j += 1;
                            }
                            blank.push_str("' '");
                            with_strings.extend(&chars[i..=j.min(chars.len() - 1)]);
                            i = j + 1;
                            continue;
                        }
                        if chars.get(i + 2) == Some(&'\'') {
                            blank.push_str("' '");
                            with_strings.extend(&chars[i..i + 3]);
                            i += 3;
                            continue;
                        }
                    }
                    blank.push(c);
                    with_strings.push(c);
                    i += 1;
                }
                St::Line => {
                    comment.push(c);
                    i += 1;
                }
                St::Block(depth) => {
                    if c == '*' && next == Some('/') {
                        st = if depth == 1 { St::Code } else { St::Block(depth - 1) };
                        i += 2;
                    } else if c == '/' && next == Some('*') {
                        st = St::Block(depth + 1);
                        i += 2;
                    } else {
                        comment.push(c);
                        i += 1;
                    }
                }
                St::Str => {
                    if c == '\\' {
                        blank.push_str("  ");
                        with_strings.push(c);
                        if let Some(n) = next.filter(|n| *n != '\n') {
                            with_strings.push(n);
                            i += 2;
                        } else {
                            i += 1;
                        }
                        continue;
                    }
                    if c == '"' {
                        st = St::Code;
                        blank.push('"');
                    } else {
                        blank.push(' ');
                    }
                    with_strings.push(c);
                    i += 1;
                }
                St::Raw(hashes) => {
                    if c == '"' && (1..=hashes).all(|k| chars.get(i + k) == Some(&'#')) {
                        st = St::Code;
                        blank.push('"');
                        with_strings.extend(&chars[i..=i + hashes]);
                        i += hashes + 1;
                        continue;
                    }
                    blank.push(' ');
                    with_strings.push(c);
                    i += 1;
                }
            }
        }
        out.push(MaskedLine { blank, with_strings, comment });
        out
    }

    /// The name declared by `fn NAME` on this masked line, if any.
    fn declared_fn(blank: &str) -> Option<String> {
        let mut from = 0;
        while let Some(i) = blank[from..].find("fn ") {
            let at = from + i;
            let before_ok = at == 0 || !is_ident(blank[..at].chars().next_back().unwrap());
            let name: String = blank[at + 3..].trim_start().chars().take_while(|c| is_ident(*c)).collect();
            if before_ok && !name.is_empty() {
                return Some(name);
            }
            from = at + 3;
        }
        None
    }

    /// Process-creating Win32 names, case-sensitive on purpose (the SHELLEXECUTEINFOW struct does not
    /// match). `CreateProcess` covers the W/A/AsUser/WithLogon/WithToken variants and Nt/Zw-CreateProcess;
    /// `CreateUserProcess` covers Nt/Zw/Rtl-CreateUserProcess; `ShellExecute` covers W/A/Ex.
    const WIN32_SPAWNS: &[&str] = &["CreateProcess", "ShellExecute", "WinExec", "CreateUserProcess"];

    /// What process-creating thing a masked line contains, if any, whether its comment carries the
    /// `spawn-allow:` marker, and HOW MANY spawn sites the line holds (the pin counts spawns, not lines).
    fn classify(line: &MaskedLine) -> (Option<&'static str>, bool, usize) {
        let marked = line.comment.contains("spawn-allow:");
        let code = line.blank.as_str();
        // Whitespace removed, so `Command :: new` and `Command ::new` are the same as `Command::new`.
        let tight: String = code.chars().filter(|c| !c.is_whitespace()).collect();
        let news = tight.matches("Command::new").count() + tight.matches("Command>::new").count();
        if news > 0 {
            return (Some("Command::new"), marked, news);
        }
        if code.contains("Command as ") {
            return (Some("aliased Command import"), marked, 1);
        }
        // `type C = std::process::Command;` (a1b): a type alias hides the name `Command::new`.
        if let Some(t) = code.find("type ") {
            let word_start = t == 0 || !is_ident(code[..t].chars().next_back().unwrap());
            if word_start && code[t..].split_once('=').is_some_and(|(_, rhs)| rhs.contains("Command")) {
                return (Some("type alias of Command"), marked, 1);
            }
        }
        if ["tokio::process", "async_process", "smol::process", "async_std::process"].iter().any(|p| code.contains(p)) {
            return (Some("async process crate"), marked, 1);
        }
        let win32: usize = WIN32_SPAWNS.iter().map(|f| code.matches(f).count()).sum();
        if win32 > 0 {
            return (Some("process-creating Win32 call"), marked, win32);
        }
        let s = line.with_strings.as_str();
        let names_tool = SPAWN_TOOLS.iter().any(|tool| {
            s.contains(&format!("OsStr::new(\"{tool}\"")) || s.contains(&format!("OsStr::new(\"{tool}.exe\""))
        });
        if names_tool {
            return (Some("system tool named by string"), marked, 1);
        }
        (None, marked, 0)
    }

    /// One guard hit: (1-based line, enclosing fn or "<top level>", what, marked, spawn sites on the line).
    type Hit = (usize, String, Option<&'static str>, bool, usize);

    /// Every hit in `src`. A `Command::new` split over lines (which rustfmt would never write, but which
    /// compiles) is a hit on the line where it completes. A Win32 name inside a `use` import is not a site.
    fn scan(src: &str) -> Vec<Hit> {
        let mut current_fn = String::from("<top level>");
        let mut hits = Vec::new();
        // The tail of the code seen so far (whitespace removed), so a `Command::new` split over two or
        // three lines (`Command\n::new`, `Command::\nnew`, `Command\n::\nnew`) is still seen.
        let mut carry = String::new();
        let mut in_use = false;
        for (i, line) in mask_source(src).iter().enumerate() {
            if let Some(f) = declared_fn(&line.blank) {
                current_fn = f;
            }
            let (mut hit, marked, mut count) = classify(line);
            let tight: String = line.blank.chars().filter(|c| !c.is_whitespace()).collect();
            let joined = format!("{carry}{tight}");
            let spans = |pat: &str| joined.contains(pat) && !tight.contains(pat) && !carry.contains(pat);
            if hit.is_none() && (spans("Command::new") || spans("Command>::new")) {
                (hit, count) = (Some("Command::new split across lines"), 1);
            }
            let keep = joined.chars().count().saturating_sub(16);
            carry = joined.chars().skip(keep).collect();
            // An import is not a spawn site (a1b review r2): a Win32 name inside a `use` statement
            // (one or more lines, up to its `;`) does not count, unless it is renamed with `as`.
            let trimmed = line.blank.trim_start();
            if trimmed.starts_with("use ") || trimmed.starts_with("pub use ") || trimmed.starts_with("pub(crate) use ") {
                in_use = true;
            }
            if in_use && hit == Some("process-creating Win32 call") && !line.blank.contains(" as ") {
                (hit, count) = (None, 0);
            }
            if line.blank.contains(';') {
                in_use = false;
            }
            if hit.is_some() || marked {
                hits.push((i + 1, current_fn.clone(), hit, marked, count));
            }
        }
        hits
    }

    fn hit_of(src: &str) -> Option<&'static str> {
        scan(src).into_iter().find_map(|h| h.2)
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
            "CreateProcessA(None, cmd)",
            "windows::Win32::System::Threading::CreateProcessAsUserW(token)",
            "ShellExecuteExW(&mut sei)",
            "ShellExecuteW(None, verb, file, None, None, SW_HIDE);",
            "ShellExecuteA(None, verb, file, None, None, SW_HIDE);",
            "WinExec(cmdline, 0);",
            "RtlCreateUserProcess(&path, 0, params)",
            "NtCreateUserProcess(&mut h, &mut t)",
            "ZwCreateUserProcess(&mut h, &mut t)",
            "NtCreateProcessEx(&mut h)",
            r#"elevate_and_wait(std::ffi::OsStr::new("powershell"), &args)"#,
            r#"elevate_and_wait(OsStr::new("cmd.exe"), &args)"#,
            // a1b review r1 evasions:
            r#"let c = <std::process::Command>::new("x");"#,
            "type C = std::process::Command;",
            "pub(crate) type Runner = Command;",
            r#"let s = " // "; let c = Command::new("x");"#,
            r#"let s = "a // b"; CreateProcessW(None, cmd);"#,
            r#"let q = '"'; let c = Command::new("x");"#,
            r#"let q = '\''; let c = Command::new("x");"#,
            "let a = 1; /* note */ let c = Command::new(\"x\");",
            r##"let s = r#"text " // "#; let c = Command::new("x");"##,
            // a1b review r1, round 2: escaped char literals (B2), raw C strings, spacing, a split line.
            r#"let q = ['\'','"']; let c = Command::new("x");"#,
            r#"let q = '\\'; let s = "x"; let c = Command::new("x");"#,
            r#"let q = b'\''; let s = "x"; let c = Command::new("x");"#,
            r##"let s = cr#"text " // "#; let c = Command::new("x");"##,
            r#"let c = Command :: new("x");"#,
            r#"let c = std::process::Command ::new("x");"#,
            "let c = std::process::Command\n    ::new(\"x\");",
            "let c = <std::process::Command>\n    ::new(\"x\");",
            // a1b review r2: splits after `::` and over three lines; a renamed Win32 import.
            "let c = std::process::Command::\n    new(\"x\");",
            "let c = Command\n::\nnew(\"x\");",
            "use windows::Win32::UI::Shell::ShellExecuteExW as Run;",
            "use w::{\n    ShellExecuteExW,\n};\nfn f() { ShellExecuteExW(&mut sei); }",
        ] {
            assert!(hit_of(bad).is_some(), "the guard must flag: {bad}");
            assert!(!scan(bad).iter().any(|h| h.3), "{bad} carries no marker");
        }
        // B2 exactly: the escaped quote must not open a string that blanks the NEXT line's spawn.
        let two_lines = "let q = ['\\'','\"'];\nlet c = Command::new(\"powershell\");\nlet z = \"end\";";
        assert_eq!(scan(two_lines).iter().map(|h| h.0).collect::<Vec<_>>(), vec![2], "{two_lines}");
        // Marked lines are still hits (pinned in ALLOWED), but are marked.
        let marked = scan("ShellExecuteExW(&mut sei) // spawn-allow: reason");
        assert!(marked.len() == 1 && marked[0].2.is_some() && marked[0].3);
        // A marker INSIDE a string is not a marker.
        let fake = scan(r#"let s = "// spawn-allow: x"; ShellExecuteExW(&mut sei)"#);
        assert!(fake.len() == 1 && !fake[0].3, "{fake:?}");
        // The pin counts SPAWNS: two on one marked line count two.
        let two = scan(r#"let (a, b) = (Command::new("x"), Command::new("y")); // spawn-allow: x"#);
        assert_eq!(two[0].4, 2, "{two:?}");
        for fine in [
            "// Command::new(\"x\") in a comment",
            "/// ShellExecuteExW in a doc comment",
            r#"for banned in ["std::fs", "Command::new", "write("] {"#,
            "cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,",
            "let c = crate::sys_exe::sys_command(crate::sys_exe::SysTool::Powercfg);",
            r#"let name = OsStr::new("--run-elevated");"#,
            "let s = \"first line\nCommand::new(x) inside a string\nlast\";",
            "/* a block\n Command::new(x) \n*/ let a = 1;",
            r##"let s = r#"CreateProcessW " still raw"#;"##,
            r##"let s = cr#"CreateProcessW " still raw"#;"##,
            r#"let q = '\\'; let s = "Command::new(x)";"#,
            r#"let q = b'\''; let s = "ShellExecuteW";"#,
            "fn f<'a>(x: &'a str) -> &'a str { x }",
            "type Count = u32;",
            "use std::process::Command;\nlet a = 1;",
            // a1b review r2: an import is not a spawn site, one line or several.
            "use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW};",
            "use windows::Win32::UI::Shell::{\n    ShellExecuteExW, SEE_MASK_NOASYNC,\n    SHELLEXECUTEINFOW,\n};",
        ] {
            assert_eq!(hit_of(fine), None, "must not flag: {fine}");
        }
        // A whole `Command::new` on one line is one hit; the carried tail does not make the next line
        // a second (split) hit.
        let once = scan("let c = Command::new(\"x\");\nlet d = new(1);\nlet e = 2;");
        assert_eq!(once.iter().map(|h| h.0).collect::<Vec<_>>(), vec![1], "{once:?}");
        // The enclosing fn is tracked, for the per-function pin.
        let src = "fn a() {}\nfn spawner() {\n    ShellExecuteExW(&mut sei) // spawn-allow: x\n}\n";
        assert_eq!(scan(src), vec![(3, "spawner".to_string(), Some("process-creating Win32 call"), true, 1)]);
    }

    /// The spawn guard over `src-tauri/src/**`, `build.rs` and `examples/**`. Every process spawn goes
    /// through this module. A line that must create a process another way says why with
    /// `// spawn-allow: <reason>`, and the spawns on such lines are pinned by FILE AND FUNCTION with an
    /// exact count of SPAWN SITES (a1b: a per-file count let a marker move to another line or function
    /// unnoticed; a per-line count let a second spawn ride on an existing marked line).
    ///
    /// It is a speed bump, not a proof. It cannot see: a spawn built by a macro (`mk!(Command)`),
    /// C runtime calls (`libc::system`, `_wsystem`, `_wspawn*`, `_wexec*`), process creation through COM
    /// (WMI `Win32_Process.Create`, Task Scheduler `ITaskService`, `Shell.Application`), the Tauri opener
    /// plugin (shell-association opens of URLs and paths), or any dependency's code. `declared_fn` has no
    /// scope end, so code after a fn (a const initializer, an impl item) counts toward the fn above it,
    /// and two fns with one name in a file share a count.
    #[test]
    fn no_bare_command_new_outside_the_resolver() {
        // (file relative to src-tauri, enclosing fn, number of spawn sites). Keep this explicit and short.
        const ALLOWED: &[(&str, &str, usize)] = &[
            ("src/actions.rs", "shell_runas_and_wait", 1), // the ShellExecuteExW call: the one UAC runas launch (its import is not a site)
            ("src/actions.rs", "a_command_that_doesnt_answer_in_time_is_unread_and_ended", 1), // QA test: an absolute path that does not exist
            ("src/lib.rs", "build_dirty_predicate_flips_on_unstaged_change", 1), // test-only git, never shipped
            ("src/monitoring.rs", "start_fps_capture_locked", 1), // the FPS self-spawn of current_exe() (absolute path)
            ("build.rs", "git_stamp", 2), // build time only, on the developer's machine: git for the embedded stamp; never shipped
            ("src/monitoring.rs", "spawn_plain_helper", 1), // D1-S1: the same self-spawn, unelevated (absolute, checked)
        ];
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let resolver = root.join("src").join("sys_exe.rs");
        let mut files = vec![root.join("build.rs")];
        rust_files(&root.join("src"), &mut files);
        if root.join("examples").is_dir() {
            rust_files(&root.join("examples"), &mut files);
        }
        assert!(files.len() > 20, "the scan must find the sources ({} files)", files.len());
        assert!(files.contains(&resolver), "the resolver itself must be where the guard expects it");
        let mut violations = Vec::new();
        let mut pinned: HashMap<(String, String), usize> = HashMap::new();
        for f in &files {
            // Only THE resolver is skipped, by exact path: not any other file of that name.
            if *f == resolver {
                continue;
            }
            let name = f.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            let text = std::fs::read_to_string(f).expect("read source");
            for (line, func, hit, is_marked, sites) in scan(&text) {
                match (hit, is_marked) {
                    (Some(_), true) => *pinned.entry((name.clone(), func)).or_default() += sites,
                    (Some(why), false) => violations.push(format!("{name}:{line} (fn {func}): {why}")),
                    (None, true) => violations.push(format!("{name}:{line} (fn {func}): spawn-allow marker on a line that creates nothing")),
                    (None, false) => {}
                }
            }
        }
        assert!(
            violations.is_empty(),
            "spawn through crate::sys_exe::sys_command(SysTool::..) (or add `// spawn-allow: <reason>` and update ALLOWED):\n{}",
            violations.join("\n")
        );
        let mut got: Vec<(String, String, usize)> = pinned.into_iter().map(|((f, func), n)| (f, func, n)).collect();
        got.sort();
        let mut want: Vec<(String, String, usize)> =
            ALLOWED.iter().map(|(f, func, n)| (f.to_string(), func.to_string(), *n)).collect();
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
