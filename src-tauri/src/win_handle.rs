//! Handle-bound file checks and deletes (moved out of data_clear.rs in hardening slice 2, so the elevated
//! command helper's ticket can use them without the crate graph reaching data_clear from actions.rs:
//! scripts/store-lock-order-guard.test.mjs). Open a file once, ask the HANDLE where it really is, and delete
//! through that same handle. The two kernel32 calls are declared by hand, as `data_root.rs` does, so no
//! `windows` crate feature is added. Used by data_clear.rs `remove_by_handle` and actions.rs
//! `consume_ticket_by_handle`.

use std::ffi::c_void;

#[repr(C)]
struct FileDispositionInfo {
    delete_file: u8,
}

#[repr(C)]
struct FileDispositionInfoEx {
    flags: u32,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetFinalPathNameByHandleW(handle: *mut c_void, path: *mut u16, len: u32, flags: u32) -> u32;
    fn SetFileInformationByHandle(handle: *mut c_void, class: i32, info: *const c_void, size: u32) -> i32;
}

/// The handle's final, resolved path (`\\?\C:\...`), with every junction on the way followed.
pub(crate) fn final_path(handle: *mut c_void) -> Result<String, String> {
    let mut buf = vec![0u16; 512];
    loop {
        // SAFETY: `handle` is a live file handle owned by the caller's `File`; `buf` is a writable
        // buffer of exactly `buf.len()` UTF-16 units, which is what is passed.
        let n = unsafe { GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), buf.len() as u32, 0) } as usize;
        if n == 0 {
            return Err(format!("its location could not be checked ({})", std::io::Error::last_os_error()));
        }
        if n < buf.len() {
            return Ok(String::from_utf16_lossy(&buf[..n]));
        }
        buf.resize(n + 1, 0);
    }
}

/// Case-insensitive, without the `\\?\` prefix, so two spellings of one path compare equal.
pub(crate) fn normalize(path: &str) -> String {
    path.trim_start_matches(r"\\?\").to_lowercase()
}

/// Marks the open file for deletion; it goes when the handle closes. Tries POSIX semantics that also
/// ignore the read-only attribute (what `std::fs::remove_file` does), then the classic form.
pub(crate) fn delete_on_close(handle: *mut c_void) -> Result<(), String> {
    const FILE_DISPOSITION_INFO_CLASS: i32 = 4;
    const FILE_DISPOSITION_INFO_EX_CLASS: i32 = 21;
    const DELETE: u32 = 0x1;
    const POSIX_SEMANTICS: u32 = 0x2;
    const IGNORE_READONLY: u32 = 0x10;
    let ex = FileDispositionInfoEx { flags: DELETE | POSIX_SEMANTICS | IGNORE_READONLY };
    // SAFETY: a live handle opened with DELETE access; `ex` is a repr(C) struct of the size passed.
    let ok = unsafe {
        SetFileInformationByHandle(
            handle,
            FILE_DISPOSITION_INFO_EX_CLASS,
            (&ex as *const FileDispositionInfoEx).cast(),
            std::mem::size_of::<FileDispositionInfoEx>() as u32,
        )
    };
    if ok != 0 {
        return Ok(());
    }
    let classic = FileDispositionInfo { delete_file: 1 };
    // SAFETY: as above, with the classic one-byte BOOLEAN structure.
    let ok = unsafe {
        SetFileInformationByHandle(
            handle,
            FILE_DISPOSITION_INFO_CLASS,
            (&classic as *const FileDispositionInfo).cast(),
            std::mem::size_of::<FileDispositionInfo>() as u32,
        )
    };
    if ok != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}
