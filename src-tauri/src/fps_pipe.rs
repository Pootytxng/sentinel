//! fps_pipe: the capture helper's reports travel over a named pipe the APP owns (hardening slice 2,
//! m1-hardening-design.md 3.2 A; finding F3).
//!
//! Before: the (usually ELEVATED) helper wrote and renamed `fps.json` and its marker every half second,
//! and polled `fps.alive`, at paths it took from its command line, inside `%APPDATA%\Compy\runtime`: a
//! folder the user and any program they run can change. A junction there turned the admin write and
//! rename into an admin file write anywhere.
//!
//! Now: the app (unelevated, the user) creates `\\.\pipe\compy-fps-<32 random hex>` (first instance only,
//! local clients only, a DACL for this user and Administrators), and starts the helper with
//! `--pipe <name> --parent-pid <pid>`. The helper opens NO path but that pipe, opens it so the app can
//! identify but never impersonate it (SECURITY_IDENTIFICATION), and checks that the pipe's server is the
//! process that started it and runs Compy's own image. The app checks that the connected client is a
//! Compy it started. The helper writes one line per report; the APP writes `fps.json` and the marker with
//! the user's own rights, so every reader is unchanged. The pipe is also the heartbeat: when the app closes
//! it (stop, exit, crash), the helper's next write fails and it exits.
//!
//! Win32 calls are declared by hand (as data_clear.rs and data_root.rs do), so no `windows` crate feature
//! is added. Nothing here opens another process: identities come from the process snapshot (other_load).

use std::ffi::c_void;
use std::io::{BufRead, Write};
use std::os::windows::io::{FromRawHandle, OwnedHandle};
use std::path::Path;

/// The fixed prefix of every Compy capture pipe.
pub(crate) const PIPE_PREFIX: &str = r"\\.\pipe\compy-fps-";

#[link(name = "kernel32")]
extern "system" {
    fn CreateNamedPipeW(
        name: *const u16,
        open_mode: u32,
        pipe_mode: u32,
        max_instances: u32,
        out_buffer: u32,
        in_buffer: u32,
        default_timeout: u32,
        security: *const SecurityAttributes,
    ) -> *mut c_void;
    fn ConnectNamedPipe(pipe: *mut c_void, overlapped: *mut c_void) -> i32;
    fn DisconnectNamedPipe(pipe: *mut c_void) -> i32;
    fn GetNamedPipeClientProcessId(pipe: *mut c_void, pid: *mut u32) -> i32;
    fn GetNamedPipeServerProcessId(pipe: *mut c_void, pid: *mut u32) -> i32;
    fn LocalFree(mem: *mut c_void) -> *mut c_void;
}

#[link(name = "advapi32")]
extern "system" {
    fn ConvertSidToStringSidW(sid: *mut c_void, out: *mut *mut u16) -> i32;
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl: *const u16,
        revision: u32,
        out: *mut *mut c_void,
        size: *mut u32,
    ) -> i32;
}

#[link(name = "bcrypt")]
extern "system" {
    fn BCryptGenRandom(alg: *mut c_void, buf: *mut u8, len: u32, flags: u32) -> i32;
}

#[repr(C)]
struct SecurityAttributes {
    length: u32,
    descriptor: *mut c_void,
    inherit: i32,
}

const INVALID_HANDLE: isize = -1;
const PIPE_ACCESS_INBOUND: u32 = 0x1;
const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x0008_0000;
const PIPE_REJECT_REMOTE_CLIENTS: u32 = 0x8;
const ERROR_PIPE_CONNECTED: i32 = 535;
/// `SECURITY_IDENTIFICATION` as CreateFileW's SQOS flag (std sets SECURITY_SQOS_PRESENT with it).
pub(crate) const SECURITY_IDENTIFICATION: u32 = 0x0001_0000;

/// PURE: the name is exactly `\\.\pipe\compy-fps-` and 32 lower-case hex digits. The helper refuses any
/// other name, so its command line can never point it at a file or another pipe.
pub(crate) fn is_valid_pipe_name(name: &str) -> bool {
    name.strip_prefix(PIPE_PREFIX)
        .is_some_and(|hex| hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// PURE: a pipe name from 16 random bytes.
pub(crate) fn pipe_name_from(bytes: [u8; 16]) -> String {
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{PIPE_PREFIX}{hex}")
}

/// 16 bytes from the system's random number generator, or an error (never a weak fallback).
fn random_16() -> std::io::Result<[u8; 16]> {
    let mut b = [0u8; 16];
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x2;
    // SAFETY: `b` is a writable 16-byte buffer and its length is passed with it.
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), b.as_mut_ptr(), b.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status == 0 {
        Ok(b)
    } else {
        Err(std::io::Error::other(format!("the system random number generator failed (status {status:#x})")))
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// This process's user SID as a string (`S-1-5-21-...`), from its own token (monitoring.rs
/// `with_own_token`: our own token, read-only, closed after).
fn own_user_sid() -> std::io::Result<String> {
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_USER};
    // SAFETY: the buffer is 8-aligned, outlives the calls and its byte length is passed; the SID pointer
    // inside points into it and is read before it is dropped; the SID string is freed with LocalFree
    // after it is copied.
    crate::monitoring::with_own_token(|token| unsafe {
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        if needed == 0 || needed > (1 << 12) {
            return None;
        }
        let mut words = vec![0u64; (needed as usize).div_ceil(8)];
        GetTokenInformation(token, TokenUser, Some(words.as_mut_ptr().cast()), (words.len() * 8) as u32, &mut needed).ok()?;
        let user = &*(words.as_ptr() as *const TOKEN_USER);
        let mut out: *mut u16 = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid.0, &mut out) == 0 || out.is_null() {
            return None;
        }
        let mut n = 0usize;
        while *out.add(n) != 0 {
            n += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(out, n));
        LocalFree(out.cast());
        Some(sid)
    })
    .ok_or_else(|| std::io::Error::other("this process's user could not be read from its token"))
}

/// PURE: the pipe's security descriptor: protected DACL, full access for this user and Administrators
/// only. `sid` comes from our own token, never from input; anything that is not a plain SID is refused.
pub(crate) fn pipe_sddl(sid: &str) -> Option<String> {
    let plain = sid.starts_with("S-1-") && sid.bytes().all(|b| b.is_ascii_digit() || b == b'-' || b == b'S');
    plain.then(|| format!("D:P(A;;GA;;;{sid})(A;;GA;;;BA)"))
}

/// The app's end of one capture's pipe.
pub(crate) struct ServerPipe {
    pub(crate) name: String,
    handle: OwnedHandle,
}

impl ServerPipe {
    /// Create a fresh pipe. A name already taken (a squatter got there first: FIRST_PIPE_INSTANCE makes
    /// our create fail) is retried with a new random name, three times at most.
    pub(crate) fn create() -> std::io::Result<ServerPipe> {
        let sddl = pipe_sddl(&own_user_sid()?).ok_or_else(|| std::io::Error::other("unexpected user SID"))?;
        let mut last = std::io::Error::other("no attempt");
        for _ in 0..3 {
            let name = pipe_name_from(random_16()?);
            match create_with(&name, &sddl) {
                Ok(handle) => return Ok(ServerPipe { name, handle }),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    fn raw(&self) -> *mut c_void {
        use std::os::windows::io::AsRawHandle;
        self.handle.as_raw_handle()
    }

    /// Block until a client connects (or one already has).
    fn accept(&self) -> std::io::Result<()> {
        // SAFETY: a live pipe handle we own; no OVERLAPPED (blocking connect).
        if unsafe { ConnectNamedPipe(self.raw(), std::ptr::null_mut()) } != 0 {
            return Ok(());
        }
        let e = std::io::Error::last_os_error();
        if e.raw_os_error() == Some(ERROR_PIPE_CONNECTED) {
            Ok(())
        } else {
            Err(e)
        }
    }

    fn client_pid(&self) -> Option<u32> {
        let mut pid = 0u32;
        // SAFETY: a live pipe handle and a u32 out-value.
        (unsafe { GetNamedPipeClientProcessId(self.raw(), &mut pid) } != 0 && pid != 0).then_some(pid)
    }

    fn disconnect(&self) {
        // SAFETY: a live pipe handle.
        unsafe { DisconnectNamedPipe(self.raw()) };
    }

    /// Serve one capture: accept clients until one is a Compy this app started (`client_ok`), then relay
    /// its lines (`relay`) while `wanted()` holds. Returns when the helper closes its end, when `wanted()`
    /// stops holding (the pipe is then closed by drop, which is the helper's signal to exit), or on error.
    pub(crate) fn serve(
        self,
        wanted: &dyn Fn() -> bool,
        client_ok: &dyn Fn(u32) -> bool,
        relay: &mut dyn FnMut(Line),
    ) -> ServeEnd {
        loop {
            if self.accept().is_err() {
                return ServeEnd::Failed;
            }
            if !wanted() {
                return ServeEnd::NotWanted;
            }
            match self.client_pid() {
                Some(pid) if client_ok(pid) => break,
                _ => self.disconnect(), // not ours: drop it and keep waiting for the helper
            }
        }
        // SAFETY: the OwnedHandle is moved into the File, which now owns and closes it.
        let file = unsafe { std::fs::File::from_raw_handle(std::os::windows::io::IntoRawHandle::into_raw_handle(self.handle)) };
        let reader = std::io::BufReader::new(file);
        for line in reader.lines() {
            let Ok(line) = line else { return ServeEnd::HelperGone };
            // Checked before the relay: once the capture is stopped, nothing more is written.
            if !wanted() {
                return ServeEnd::NotWanted;
            }
            relay(classify_line(&line));
        }
        ServeEnd::HelperGone
    }
}

/// How `serve` ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ServeEnd {
    HelperGone,
    NotWanted,
    Failed,
}

fn create_with(name: &str, sddl: &str) -> std::io::Result<OwnedHandle> {
    let mut sd: *mut c_void = std::ptr::null_mut();
    let sddl_w = wide(sddl);
    // SAFETY: valid NUL-terminated SDDL; `sd` receives a LocalAlloc'd descriptor freed below.
    if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl_w.as_ptr(), 1, &mut sd, std::ptr::null_mut()) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let sa = SecurityAttributes { length: std::mem::size_of::<SecurityAttributes>() as u32, descriptor: sd, inherit: 0 };
    let name_w = wide(name);
    // SAFETY: valid NUL-terminated name and SECURITY_ATTRIBUTES that outlive the call.
    let h = unsafe {
        CreateNamedPipeW(
            name_w.as_ptr(),
            PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_REJECT_REMOTE_CLIENTS, // byte type, byte read mode, blocking
            1,
            0,
            64 * 1024,
            0,
            &sa,
        )
    };
    let err = std::io::Error::last_os_error();
    // SAFETY: `sd` came from ConvertStringSecurityDescriptor... and is no longer used.
    unsafe { LocalFree(sd) };
    if h.is_null() || h as isize == INVALID_HANDLE {
        return Err(err);
    }
    // SAFETY: a fresh, valid handle we now own.
    Ok(unsafe { OwnedHandle::from_raw_handle(h) })
}

/// Unblock a `serve` that waits for a client that will never come (stop, a declined prompt): connect to
/// the app's own pipe and let go. The connection fails the client check (it is the app itself), and
/// `serve` then sees `wanted()` no longer holds.
pub(crate) fn wake(name: &str) {
    if is_valid_pipe_name(name) {
        let _ = std::fs::OpenOptions::new().write(true).open(name);
    }
}

/// One line from the helper.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Line {
    /// A report: exactly the JSON the helper used to write to fps.json.
    Report(String),
    /// The helper could not read the process snapshot this tick; its running count.
    Unreadable(u64),
    /// Nothing to report this tick (keeps the pipe busy, so a stop is noticed within a tick).
    Alive,
    /// Anything else: ignored.
    Junk,
}

pub(crate) const ALIVE_LINE: &str = r#"{"alive":true}"#;

/// PURE: the helper's line for an unreadable tick.
pub(crate) fn unreadable_line(total: u64) -> String {
    format!(r#"{{"unreadable_ticks":{total}}}"#)
}

/// PURE: what a line is. A report must parse as the FpsReport shape the readers expect (a `pid` and a
/// `fps` field); the two control lines are matched exactly.
pub(crate) fn classify_line(line: &str) -> Line {
    let t = line.trim();
    if t == ALIVE_LINE {
        return Line::Alive;
    }
    if let Some(n) = t.strip_prefix(r#"{"unreadable_ticks":"#).and_then(|r| r.strip_suffix('}')).and_then(|n| n.parse().ok()) {
        return Line::Unreadable(n);
    }
    match serde_json::from_str::<serde_json::Value>(t) {
        Ok(v) if v.get("pid").is_some_and(|p| p.is_u64()) && v.get("fps").is_some_and(|f| f.is_number()) => Line::Report(t.to_string()),
        _ => Line::Junk,
    }
}

/// PURE: the helper side's check of the pipe's server. The server must be the process that started the
/// helper (`--parent-pid`, which must also be the helper's own parent in the snapshot) and run an image
/// of the helper's own name. Any unknown is a refusal.
pub(crate) fn server_is_our_parent(
    server_pid: Option<u32>,
    parent_arg: u32,
    own_parent: Option<u32>,
    server_image: Option<&str>,
    own_image: &str,
) -> bool {
    server_pid == Some(parent_arg)
        && own_parent == Some(parent_arg)
        && parent_arg != 0
        && server_image.is_some_and(|n| n.eq_ignore_ascii_case(own_image))
}

/// PURE: the app side's check of a connected client: a process the app itself started (its snapshot
/// parent is the app) running an image of the app's own name.
pub(crate) fn client_is_our_helper(client_parent: Option<u32>, client_image: Option<&str>, own_pid: u32, own_image: &str) -> bool {
    client_parent == Some(own_pid) && client_image.is_some_and(|n| n.eq_ignore_ascii_case(own_image))
}

/// The image file name of the running exe (`compy.exe`).
pub(crate) fn own_image_name() -> Option<String> {
    std::env::current_exe().ok()?.file_name().map(|n| n.to_string_lossy().into_owned())
}

/// App side, production: is `pid` a Compy this app started? From one process snapshot; no process opened.
pub(crate) fn is_our_helper(pid: u32) -> bool {
    let (Some(rows), Some(own)) = (crate::other_load::read_process_rows(), own_image_name()) else {
        return false;
    };
    let row = crate::other_load::find_row(&rows, pid);
    client_is_our_helper(row.map(|r| r.parent), row.and_then(|r| r.name.as_deref()), std::process::id(), &own)
}

/// Helper side: open the app's pipe, after checking its name, for writing, so the server can identify
/// but never impersonate this (possibly elevated) process, and check the server is the process that
/// started this helper. `Err` = run nothing, exit.
pub(crate) fn connect_to_parent(name: &str, parent_arg: u32) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    if !is_valid_pipe_name(name) {
        return Err("refused: not a Compy capture pipe name".into());
    }
    let file = std::fs::OpenOptions::new()
        .write(true)
        .security_qos_flags(SECURITY_IDENTIFICATION)
        .open(Path::new(name))
        .map_err(|e| format!("could not open the capture pipe: {e}"))?;
    let mut server = 0u32;
    // SAFETY: a live pipe handle owned by `file`; a u32 out-value.
    let server_pid = (unsafe { GetNamedPipeServerProcessId(file.as_raw_handle(), &mut server) } != 0).then_some(server);
    let rows = crate::other_load::read_process_rows().ok_or("refused: the process snapshot could not be read")?;
    let own_parent = crate::other_load::find_row(&rows, std::process::id()).map(|r| r.parent);
    let server_image = server_pid.and_then(|p| crate::other_load::find_row(&rows, p)).and_then(|r| r.name.clone());
    let own = own_image_name().ok_or("refused: own image name unknown")?;
    if server_is_our_parent(server_pid, parent_arg, own_parent, server_image.as_deref(), &own) {
        Ok(file)
    } else {
        Err("refused: the capture pipe is not served by the Compy that started this helper".into())
    }
}

/// Helper side: a writer thread over the pipe, so a stalled reader can never stall the capture loop.
/// `send` never blocks (a full queue drops that line); `broken()` turns true once a write fails (the app
/// closed the pipe: stop, exit or crash), which is the helper's signal to exit.
pub(crate) struct PipeWriter {
    tx: std::sync::mpsc::SyncSender<String>,
    broken: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl PipeWriter {
    pub(crate) fn start(mut out: impl Write + Send + 'static) -> PipeWriter {
        let (tx, rx) = std::sync::mpsc::sync_channel::<String>(4);
        let broken = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = broken.clone();
        std::thread::spawn(move || {
            for line in rx {
                if writeln!(out, "{line}").and_then(|_| out.flush()).is_err() {
                    flag.store(true, std::sync::atomic::Ordering::Release);
                    return;
                }
            }
        });
        PipeWriter { tx, broken }
    }

    /// Queue one line; false when the queue is full or the writer has stopped (the line is dropped).
    pub(crate) fn send(&self, line: String) -> bool {
        self.tx.try_send(line).is_ok()
    }

    pub(crate) fn broken(&self) -> bool {
        self.broken.load(std::sync::atomic::Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_compy_capture_pipe_name_is_accepted() {
        let good = pipe_name_from([0xab; 16]);
        assert_eq!(good, format!(r"\\.\pipe\compy-fps-{}", "ab".repeat(16)));
        assert!(is_valid_pipe_name(&good));
        for bad in [
            r"\\.\pipe\compy-fps-",
            r"\\.\pipe\compy-fps-ABABABABABABABABABABABABABABABAB",
            r"\\.\pipe\compy-fps-abababababababababababababababab0",
            r"\\.\pipe\other-abababababababababababababababab",
            r"C:\Users\x\AppData\Roaming\Compy\runtime\fps.json",
            r"\\server\pipe\compy-fps-abababababababababababababababab",
            r"\\.\pipe\compy-fps-ababababababababababababababab\..",
        ] {
            assert!(!is_valid_pipe_name(bad), "{bad}");
        }
    }

    #[test]
    fn the_pipe_dacl_names_only_this_user_and_administrators() {
        assert_eq!(pipe_sddl("S-1-5-21-1-2-3-1001").as_deref(), Some("D:P(A;;GA;;;S-1-5-21-1-2-3-1001)(A;;GA;;;BA)"));
        for bad in ["", "WD", "S-1-1-0)(A;;GA;;;WD", "BA"] {
            assert_eq!(pipe_sddl(bad), None, "{bad}");
        }
        assert!(pipe_sddl(&own_user_sid().expect("own SID")).is_some(), "this process's SID is a plain SID");
    }

    #[test]
    fn lines_are_classified_and_only_report_shaped_json_is_a_report() {
        let report = r#"{"pid":42,"process_name":"g.exe","fps":144.0,"avg_frametime_ms":6.9,"low1_fps":120.0,"frames_last_sec":144,"recent_frametimes_ms":[]}"#;
        assert_eq!(classify_line(report), Line::Report(report.to_string()));
        assert_eq!(classify_line(ALIVE_LINE), Line::Alive);
        assert_eq!(classify_line(&unreadable_line(7)), Line::Unreadable(7));
        for junk in ["", "hello", r#"{"pid":"x","fps":1}"#, r#"{"fps":1}"#, r#"{"unreadable_ticks":-1}"#, "[1,2]"] {
            assert_eq!(classify_line(junk), Line::Junk, "{junk}");
        }
    }

    #[test]
    fn the_helper_accepts_only_the_compy_that_started_it_as_server() {
        assert!(server_is_our_parent(Some(100), 100, Some(100), Some("compy.exe"), "compy.exe"));
        assert!(server_is_our_parent(Some(100), 100, Some(100), Some("COMPY.EXE"), "compy.exe"));
        assert!(!server_is_our_parent(Some(101), 100, Some(100), Some("compy.exe"), "compy.exe"), "a squatter's server");
        assert!(!server_is_our_parent(Some(100), 100, Some(55), Some("compy.exe"), "compy.exe"), "--parent-pid is not our parent");
        assert!(!server_is_our_parent(Some(100), 100, Some(100), Some("evil.exe"), "compy.exe"), "another image");
        assert!(!server_is_our_parent(None, 100, Some(100), Some("compy.exe"), "compy.exe"));
        assert!(!server_is_our_parent(Some(100), 100, None, Some("compy.exe"), "compy.exe"));
        assert!(!server_is_our_parent(Some(100), 100, Some(100), None, "compy.exe"));
        assert!(!server_is_our_parent(Some(0), 0, Some(0), Some("compy.exe"), "compy.exe"));
    }

    #[test]
    fn the_app_accepts_only_a_compy_it_started_as_client() {
        assert!(client_is_our_helper(Some(7), Some("compy.exe"), 7, "compy.exe"));
        assert!(!client_is_our_helper(Some(8), Some("compy.exe"), 7, "compy.exe"), "started by someone else");
        assert!(!client_is_our_helper(Some(7), Some("evil.exe"), 7, "compy.exe"));
        assert!(!client_is_our_helper(None, Some("compy.exe"), 7, "compy.exe"));
        assert!(!client_is_our_helper(Some(7), None, 7, "compy.exe"));
    }

    /// A real pipe, in this process: the server relays a client's lines; a client that is not ours is
    /// dropped (the check runs on the real client pid); the server's drop is the client's broken pipe.
    #[test]
    fn a_real_pipe_relays_lines_and_a_closed_server_breaks_the_writer() {
        let server = ServerPipe::create().expect("create pipe");
        let name = server.name.clone();
        assert!(is_valid_pipe_name(&name));
        // A second create of the SAME name fails: first instance only.
        assert!(create_with(&name, &pipe_sddl(&own_user_sid().unwrap()).unwrap()).is_err(), "a squatter cannot share the name");
        let me = std::process::id();
        let client = std::thread::spawn(move || {
            use std::os::windows::fs::OpenOptionsExt;
            let mut f = loop {
                match std::fs::OpenOptions::new().write(true).security_qos_flags(SECURITY_IDENTIFICATION).open(&name) {
                    Ok(f) => break f,
                    Err(_) => std::thread::sleep(std::time::Duration::from_millis(20)),
                }
            };
            writeln!(f, "{ALIVE_LINE}").unwrap();
            writeln!(f, "{}", unreadable_line(3)).unwrap();
            writeln!(f, r#"{{"pid":1,"fps":60.0}}"#).unwrap();
        });
        let mut got = Vec::new();
        // The client is this test process itself: accepted only because the check says so here.
        let end = server.serve(&|| true, &|pid| pid == me, &mut |l| got.push(l));
        client.join().unwrap();
        assert_eq!(end, ServeEnd::HelperGone);
        assert_eq!(got, vec![Line::Alive, Line::Unreadable(3), Line::Report(r#"{"pid":1,"fps":60.0}"#.into())]);

        // The writer thread notices a closed server and reports broken.
        let server = ServerPipe::create().expect("create pipe");
        let name = server.name.clone();
        let opener = std::thread::spawn(move || {
            use std::os::windows::fs::OpenOptionsExt;
            loop {
                if let Ok(f) = std::fs::OpenOptions::new().write(true).security_qos_flags(SECURITY_IDENTIFICATION).open(&name) {
                    return f;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        });
        server.accept().unwrap();
        let f = opener.join().unwrap();
        drop(server); // the app closes its end
        let w = PipeWriter::start(f);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !w.broken() && std::time::Instant::now() < deadline {
            w.send(ALIVE_LINE.into());
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(w.broken(), "a write to a closed pipe must mark the writer broken");
    }

    /// A stalled reader never stalls the sender: a full queue drops the line instead of blocking.
    #[test]
    fn a_full_queue_drops_lines_instead_of_blocking() {
        struct Stuck;
        impl Write for Stuck {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                std::thread::sleep(std::time::Duration::from_secs(3600));
                Ok(0)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let w = PipeWriter::start(Stuck);
        let started = std::time::Instant::now();
        let accepted = (0..20).filter(|_| w.send("x".into())).count();
        assert!(accepted <= 5, "the queue is bounded (4, plus the one being written): {accepted}");
        assert!(started.elapsed() < std::time::Duration::from_secs(1), "send never blocks");
    }

    /// wake() opens a pipe only by a valid Compy capture name.
    #[test]
    fn wake_touches_nothing_but_a_capture_pipe() {
        let s = crate::test_scratch::scratch("fps-wake");
        let f = s.join("fps.json");
        std::fs::write(&f, "x").unwrap();
        wake(&f.to_string_lossy());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "x");
    }
}
