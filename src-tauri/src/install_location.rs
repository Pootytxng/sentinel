//! install_location: where this compy.exe runs from, and whether an old per-user copy of Compy is
//! still installed for this account (A3, per-machine install; hardening design slice 5).
//!
//! Why: a per-user install (`%LOCALAPPDATA%\Compy`) is a folder any program the user runs can change,
//! so a replaced compy.exe (or a DLL beside it) would run with administrator rights at the next
//! elevated helper launch. Today's installer is still per-user, so on an installed PC this records
//! `user_folder`. The per-machine installer (hardening slice 5, branch claude/a3-per-machine, parked
//! until the owner schedules the switch) installs to Program Files, and its pre-install hook removes
//! the old per-user copy of the account the ELEVATED installer runs as; when a standard user typed an
//! administrator's password, that is the administrator's account and the user's own old copy is
//! invisible to it. This module runs in the app, UNELEVATED, as the user, so it sees the user's own
//! registry and folders and can tell; until the per-machine installer ships, that second check never
//! fires (it needs a Program Files copy).
//!
//! Read-only: it reads two known folders from the Windows API (never an environment variable) and one
//! registry value under this user's HKCU. It writes nothing but one support-log line per launch, with
//! fixed words and no path.

use std::path::{Path, PathBuf};

/// Where the running exe is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallPlace {
    /// Under Program Files: only administrators can change it.
    ProgramFiles,
    /// Under this user's local app data folder: the old per-user install, changeable by the user.
    UserFolder,
    /// Anywhere else (a developer build, a portable copy) or a folder that could not be read.
    Elsewhere,
}

impl InstallPlace {
    fn code(self) -> &'static str {
        match self {
            InstallPlace::ProgramFiles => "program_files",
            InstallPlace::UserFolder => "user_folder",
            InstallPlace::Elsewhere => "elsewhere",
        }
    }

    fn detail(self) -> &'static str {
        match self {
            InstallPlace::ProgramFiles => "Compy runs from Program Files, which only administrators can change",
            InstallPlace::UserFolder => "Compy runs from this user's own app folder, which programs this user runs can change",
            InstallPlace::Elsewhere => "Compy runs from another folder (a developer or portable copy)",
        }
    }
}

/// PURE: `path` is `dir` or below it (case-insensitive, whole path components only).
fn is_under(path: &Path, dir: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let (p, d) = (norm(path), norm(dir));
    !d.is_empty() && (p == d || p.starts_with(&format!("{d}\\")))
}

/// PURE: where `exe` is, given the Program Files and local app data folders (either may be unknown).
pub(crate) fn classify(exe: &Path, program_files: Option<&Path>, local_app_data: Option<&Path>) -> InstallPlace {
    if program_files.is_some_and(|pf| is_under(exe, pf)) {
        InstallPlace::ProgramFiles
    } else if local_app_data.is_some_and(|la| is_under(exe, la)) {
        InstallPlace::UserFolder
    } else {
        InstallPlace::Elsewhere
    }
}

/// PURE: the `InstallLocation` value the Tauri installer writes, without its surrounding quotes.
fn unquote(value: &str) -> &str {
    let v = value.trim();
    let v = v.strip_prefix('"').unwrap_or(v);
    v.strip_suffix('"').unwrap_or(v)
}

/// PURE: is an old per-user copy left behind? Only when THIS copy runs from Program Files and this
/// user's HKCU still registers a Compy installed under their own local app data folder.
pub(crate) fn leftover_per_user_copy(
    place: InstallPlace,
    hkcu_install_location: Option<&str>,
    local_app_data: Option<&Path>,
) -> bool {
    match (place, hkcu_install_location, local_app_data) {
        (InstallPlace::ProgramFiles, Some(loc), Some(la)) => {
            let loc = unquote(loc);
            !loc.is_empty() && is_under(Path::new(loc), la)
        }
        _ => false,
    }
}

/// A known folder from the Windows API (`SHGetKnownFolderPath`), never from an environment variable.
fn known_folder(id: &windows::core::GUID) -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KNOWN_FOLDER_FLAG};
    // SAFETY: the returned buffer is owned by us and freed with CoTaskMemFree after it is copied.
    unsafe {
        let raw = SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(raw.as_ptr() as *const _));
        path.filter(|p| p.is_absolute())
    }
}

/// This user's registered per-user Compy install location (HKCU), if any. Read-only.
fn hkcu_install_location() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Compy")
        .and_then(|k| k.get_value::<String, _>("InstallLocation"))
        .ok()
}

/// Once per launch, from the app's setup: one support-log line saying where Compy runs from, and one
/// more when an old per-user copy is still installed for this account (fixed words, no path).
pub(crate) fn record_at_start() {
    use crate::support_evidence::{record, EventKind, Outcome};
    use windows::Win32::UI::Shell::{FOLDERID_LocalAppData, FOLDERID_ProgramFiles};
    let program_files = known_folder(&FOLDERID_ProgramFiles);
    let local_app_data = known_folder(&FOLDERID_LocalAppData);
    let place = match std::env::current_exe() {
        Ok(exe) => classify(&exe, program_files.as_deref(), local_app_data.as_deref()),
        Err(_) => InstallPlace::Elsewhere,
    };
    record(EventKind::Lifecycle, "install_location", place.code(), Outcome::Ok, place.detail());
    if leftover_per_user_copy(place, hkcu_install_location().as_deref(), local_app_data.as_deref()) {
        record(
            EventKind::Lifecycle,
            "install_location",
            "old_per_user_copy_left",
            Outcome::Failed,
            "an older per-user copy of Compy is still installed for this account; remove it in Windows Settings > Apps",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PF: &str = r"C:\Program Files";
    const LA: &str = r"C:\Users\someone\AppData\Local";

    #[test]
    fn the_place_follows_the_folder_by_whole_components() {
        let (pf, la) = (Some(Path::new(PF)), Some(Path::new(LA)));
        assert_eq!(classify(Path::new(r"C:\Program Files\Compy\compy.exe"), pf, la), InstallPlace::ProgramFiles);
        assert_eq!(classify(Path::new(r"c:\program files\compy\COMPY.EXE"), pf, la), InstallPlace::ProgramFiles);
        assert_eq!(classify(Path::new(r"C:\Users\someone\AppData\Local\Compy\compy.exe"), pf, la), InstallPlace::UserFolder);
        // A look-alike folder name is not Program Files.
        assert_eq!(classify(Path::new(r"C:\Program Files Evil\Compy\compy.exe"), pf, la), InstallPlace::Elsewhere);
        assert_eq!(classify(Path::new(r"D:\dev\target\debug\compy.exe"), pf, la), InstallPlace::Elsewhere);
        // Unknown folders never guess.
        assert_eq!(classify(Path::new(r"C:\Program Files\Compy\compy.exe"), None, None), InstallPlace::Elsewhere);
    }

    #[test]
    fn a_leftover_per_user_copy_is_reported_only_for_a_program_files_copy() {
        let la = Some(Path::new(LA));
        let old = Some(r#""C:\Users\someone\AppData\Local\Compy""#);
        assert!(leftover_per_user_copy(InstallPlace::ProgramFiles, old, la));
        assert!(leftover_per_user_copy(InstallPlace::ProgramFiles, Some(r"C:\Users\someone\AppData\Local\Compy"), la));
        // The per-user copy itself, or a developer build, has nothing "left over".
        assert!(!leftover_per_user_copy(InstallPlace::UserFolder, old, la));
        assert!(!leftover_per_user_copy(InstallPlace::Elsewhere, old, la));
        // No HKCU record, an empty one, a record elsewhere, or an unknown folder: nothing reported.
        assert!(!leftover_per_user_copy(InstallPlace::ProgramFiles, None, la));
        assert!(!leftover_per_user_copy(InstallPlace::ProgramFiles, Some(r#""""#), la));
        assert!(!leftover_per_user_copy(InstallPlace::ProgramFiles, Some(r"C:\Program Files\Compy"), la));
        assert!(!leftover_per_user_copy(InstallPlace::ProgramFiles, old, None));
    }

    #[test]
    fn the_support_lines_carry_fixed_words_and_no_path() {
        for place in [InstallPlace::ProgramFiles, InstallPlace::UserFolder, InstallPlace::Elsewhere] {
            assert!(!place.detail().contains('\\') && !place.detail().contains(':'), "{place:?}");
            assert!(place.code().chars().all(|c| c.is_ascii_lowercase() || c == '_'));
        }
    }

    #[test]
    fn the_known_folders_come_from_the_windows_api_on_this_pc() {
        use windows::Win32::UI::Shell::{FOLDERID_LocalAppData, FOLDERID_ProgramFiles};
        let pf = known_folder(&FOLDERID_ProgramFiles).expect("Program Files from the API");
        let la = known_folder(&FOLDERID_LocalAppData).expect("local app data from the API");
        assert!(pf.is_absolute() && pf.is_dir(), "{pf:?}");
        assert!(la.is_absolute() && la.is_dir(), "{la:?}");
        // This test executable is a developer build: never "Program Files".
        let me = std::env::current_exe().unwrap();
        assert_ne!(classify(&me, Some(&pf), Some(&la)), InstallPlace::ProgramFiles);
    }
}
