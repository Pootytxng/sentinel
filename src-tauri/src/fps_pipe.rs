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
//! `--parent-pid` it was given (see below for what that is worth). The app checks that the connected
//! client is exactly the process it launched. The helper writes one line per report; the APP writes `fps.json` and the marker with
//! the user's own rights, so every reader is unchanged. The pipe is also the heartbeat: when the app closes
//! it (stop, exit, crash), the helper's next write fails and it exits.
//!
//! Win32 calls are declared by hand (as data_clear.rs and data_root.rs do), so no `windows` crate feature
//! is added. Nothing here opens another process: identities come from the process snapshot (other_load),
//! the pipe's own pid calls and `ProcessIdToSessionId`, none of which takes a process handle.
//!
//! What each end can know about the other (review r1):
//! - The APP knows exactly which process it launched: it holds that process (the `Child`, or the
//!   elevated launch's process handle) for the whole capture, so the pid cannot be reused while it waits.
//!   It accepts a client only if the pipe's client pid IS that pid (`client_is_our_helper`), and, as a
//!   second check, if it runs an image of the app's own name. A same-user program cannot pass the first
//!   check: it can fake its parent and its name, but not be the process the app started.
//! - The HELPER cannot verify the server against a same-user program. That program could start
//!   `compy.exe --fps-capture --pipe <its own pipe> --parent-pid <its own pid>` itself and run under any
//!   name. So the server check (`server_is_the_app`: the server pid is `--parent-pid`, runs an image of the
//!   helper's own name, in the helper's own logon session) is a consistency check against cross-talk, NOT
//!   a security boundary. The helper's safety does not depend on it: it opens only a
//!   `\\.\pipe\compy-fps-<32 hex>` name (never a file), opens it write-only, never reads a byte from it,
//!   and opens it at identification level, so the server can never act with the helper's token. A
//!   hostile server learns FPS lines (game process names and frame rates) and nothing else.

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
    fn WaitNamedPipeW(name: *const u16, timeout_ms: u32) -> i32;
    fn ProcessIdToSessionId(pid: u32, session: *mut u32) -> i32;
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
                _ => {
                    // Not ours: drop it. Then ask again before waiting for the next client (review r2 N6):
                    // a launch that ended while that client held the pipe could not wake this reader, and
                    // without this check the reader would wait in `accept` until the app exits.
                    self.disconnect();
                    if !wanted() {
                        return ServeEnd::NotWanted;
                    }
                }
            }
        }
        // SAFETY: the OwnedHandle is moved into the File, which now owns and closes it.
        let file = unsafe { std::fs::File::from_raw_handle(std::os::windows::io::IntoRawHandle::into_raw_handle(self.handle)) };
        relay_lines(std::io::BufReader::new(file), wanted, relay)
    }
}

/// The longest line the app reads from the pipe, newline excluded. A real report is a few KiB; anything
/// longer ends the read, so a client can never grow the app's memory (review r1 B2).
pub(crate) const MAX_LINE: usize = 64 * 1024;

/// Read lines (at most [`MAX_LINE`] bytes each) and relay them while `wanted()` holds. `wanted()` is
/// checked before each relay: once the capture is stopped, nothing more is written. A line that is not
/// UTF-8 is relayed as junk (which writes nothing); an over-long line ends the read.
pub(crate) fn relay_lines(mut reader: impl BufRead, wanted: &dyn Fn() -> bool, relay: &mut dyn FnMut(Line)) -> ServeEnd {
    use std::io::Read;
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match (&mut reader).take(MAX_LINE as u64 + 1).read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return ServeEnd::HelperGone,
            Ok(_) => {}
        }
        if buf.last() == Some(&b'\n') {
            buf.pop();
        } else if buf.len() > MAX_LINE {
            return ServeEnd::Overlong;
        }
        if !wanted() {
            return ServeEnd::NotWanted;
        }
        match std::str::from_utf8(&buf) {
            Ok(line) => relay(classify_line(line.trim_end_matches('\r'))),
            Err(_) => relay(Line::Junk),
        }
    }
}

/// How `serve` ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ServeEnd {
    HelperGone,
    NotWanted,
    /// A line longer than [`MAX_LINE`]: the read stopped there and the pipe was closed.
    Overlong,
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
///
/// Review r2 N6: when another client holds the single instance, the open fails busy. Then the reader is
/// not waiting in `accept` but checking that client, and it asks `wanted()` again after dropping it, so
/// it stops by itself; the wake still retries a busy pipe for up to [`WAKE_PATIENCE`], in case the reader
/// is back in `accept` by then. A pipe that no longer exists (the reader already ended) is not retried.
pub(crate) fn wake(name: &str) {
    if !is_valid_pipe_name(name) {
        return;
    }
    let until = std::time::Instant::now() + WAKE_PATIENCE;
    let name_w = wide(name);
    loop {
        match std::fs::OpenOptions::new().write(true).open(name) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && std::time::Instant::now() < until => {
                // SAFETY: a NUL-terminated name that outlives the call.
                if unsafe { WaitNamedPipeW(name_w.as_ptr(), 250) } == 0 {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
            _ => return,
        }
    }
}

/// How long a wake keeps trying a busy pipe.
pub(crate) const WAKE_PATIENCE: std::time::Duration = std::time::Duration::from_secs(2);

/// One line from the helper.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Line {
    /// A report: exactly the JSON the helper used to write to fps.json.
    Report(String),
    /// The helper could not read the process snapshot this tick; its running count.
    Unreadable(u64),
    /// The helper's running count of REPORT lines it had to drop (its queue was full). The app counts each
    /// as a tick it could not measure, never as a lost one (review r1, non-blocking). Unreadable lines are
    /// never in this count: they are re-sent instead (review r2 N3), so no tick is counted twice.
    Dropped(u64),
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

/// PURE: the helper's line for its running count of dropped lines.
pub(crate) fn dropped_line(total: u64) -> String {
    format!(r#"{{"dropped_lines":{total}}}"#)
}

/// PURE: what a line is. A report must parse as the FpsReport shape the readers expect (a `pid` and a
/// `fps` field); the three control lines are matched exactly.
pub(crate) fn classify_line(line: &str) -> Line {
    let t = line.trim();
    if t == ALIVE_LINE {
        return Line::Alive;
    }
    let count = |prefix: &str| t.strip_prefix(prefix).and_then(|r| r.strip_suffix('}')).and_then(|n| n.parse::<u64>().ok());
    if let Some(n) = count(r#"{"unreadable_ticks":"#) {
        return Line::Unreadable(n);
    }
    if let Some(n) = count(r#"{"dropped_lines":"#) {
        return Line::Dropped(n);
    }
    match serde_json::from_str::<serde_json::Value>(t) {
        Ok(v) if v.get("pid").is_some_and(|p| p.is_u64()) && v.get("fps").is_some_and(|f| f.is_number()) => Line::Report(t.to_string()),
        _ => Line::Junk,
    }
}

/// PURE: the helper side's consistency check of the pipe's server (NOT a security boundary: see the
/// module doc). The server pid is the `--parent-pid` the helper was given, it runs an image of the
/// helper's own name, and in the helper's own logon session. Any unknown is a refusal. (Review r1: the
/// helper no longer also requires its snapshot parent to be `--parent-pid`. That stopped no attacker,
/// who passes its own pid, and made capture depend on how Windows parents an elevated process.)
pub(crate) fn server_is_the_app(
    server_pid: Option<u32>,
    parent_arg: u32,
    server_image: Option<&str>,
    own_image: &str,
    server_session: Option<u32>,
    own_session: Option<u32>,
) -> bool {
    parent_arg != 0
        && server_pid == Some(parent_arg)
        && server_image.is_some_and(|n| n.eq_ignore_ascii_case(own_image))
        && own_session.is_some()
        && server_session == own_session
}

/// PURE: the app side's check of a connected client. The client pid is EXACTLY the process this launch
/// started (`launched`, `None` while the launch has not reported it), and, as a second check, it runs an
/// image of the app's own name.
pub(crate) fn client_is_our_helper(client_pid: u32, launched: Option<u32>, client_image: Option<&str>, own_image: &str) -> bool {
    client_pid != 0 && launched == Some(client_pid) && client_image.is_some_and(|n| n.eq_ignore_ascii_case(own_image))
}

/// The image file name of the running exe (`compy.exe`).
pub(crate) fn own_image_name() -> Option<String> {
    std::env::current_exe().ok()?.file_name().map(|n| n.to_string_lossy().into_owned())
}

/// The pid one launch started, as the launch reports it (0 = not yet). Waits up to `wait` for it: the
/// helper can connect a moment before its launch has handed the pid over.
pub(crate) fn launched_pid(launched: &std::sync::atomic::AtomicU32, wait: std::time::Duration) -> Option<u32> {
    let until = std::time::Instant::now() + wait;
    loop {
        let pid = launched.load(std::sync::atomic::Ordering::Acquire);
        if pid != 0 {
            return Some(pid);
        }
        if std::time::Instant::now() >= until {
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// App side, production: is `client_pid` exactly the process this launch started, running Compy's own
/// image name? The pid from the launch (waited for up to ~2 s), the name from one process snapshot; no
/// process opened.
pub(crate) fn is_our_helper(client_pid: u32, launched: &std::sync::atomic::AtomicU32) -> bool {
    let launched = launched_pid(launched, std::time::Duration::from_secs(2));
    if launched != Some(client_pid) {
        return false;
    }
    let (Some(rows), Some(own)) = (crate::other_load::read_process_rows(), own_image_name()) else {
        return false;
    };
    let image = crate::other_load::find_row(&rows, client_pid).and_then(|r| r.name.as_deref());
    client_is_our_helper(client_pid, launched, image, &own)
}

/// The logon session of `pid`, without opening it.
fn session_of(pid: u32) -> Option<u32> {
    let mut s = 0u32;
    // SAFETY: a plain pid and a u32 out-value; no handle is involved.
    (unsafe { ProcessIdToSessionId(pid, &mut s) } != 0).then_some(s)
}

const ERROR_PIPE_BUSY: i32 = 231;

/// How long the helper keeps trying a busy pipe before it gives up (review r1 B3).
const BUSY_PIPE_PATIENCE: std::time::Duration = std::time::Duration::from_secs(5);

/// Open the pipe write-only at identification level. A busy pipe (another client holds or is leaving
/// the single instance) is waited for with `WaitNamedPipeW` and retried, up to [`BUSY_PIPE_PATIENCE`].
fn open_pipe_for_writing(name: &str) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    let until = std::time::Instant::now() + BUSY_PIPE_PATIENCE;
    let name_w = wide(name);
    loop {
        match std::fs::OpenOptions::new().write(true).security_qos_flags(SECURITY_IDENTIFICATION).open(Path::new(name)) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && std::time::Instant::now() < until => {
                // SAFETY: a NUL-terminated name that outlives the call.
                if unsafe { WaitNamedPipeW(name_w.as_ptr(), 1000) } == 0 {
                    // The wait itself failed (the instance is between clients): a short pause, never a spin.
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
            other => return other,
        }
    }
}

/// Helper side: open the app's pipe, after checking its name, for writing, so the server can identify
/// but never impersonate this (possibly elevated) process, and run the consistency check on the server.
/// `Err` = run nothing, exit.
pub(crate) fn connect_to_parent(name: &str, parent_arg: u32) -> Result<std::fs::File, String> {
    use std::os::windows::io::AsRawHandle;
    if !is_valid_pipe_name(name) {
        return Err("refused: not a Compy capture pipe name".into());
    }
    let file = open_pipe_for_writing(name).map_err(|e| format!("could not open the capture pipe: {e}"))?;
    let mut server = 0u32;
    // SAFETY: a live pipe handle owned by `file`; a u32 out-value.
    let server_pid = (unsafe { GetNamedPipeServerProcessId(file.as_raw_handle(), &mut server) } != 0).then_some(server);
    let rows = crate::other_load::read_process_rows().ok_or("refused: the process snapshot could not be read")?;
    let server_image = server_pid.and_then(|p| crate::other_load::find_row(&rows, p)).and_then(|r| r.name.clone());
    let own = own_image_name().ok_or("refused: own image name unknown")?;
    let sessions = (server_pid.and_then(session_of), session_of(std::process::id()));
    if server_is_the_app(server_pid, parent_arg, server_image.as_deref(), &own, sessions.0, sessions.1) {
        Ok(file)
    } else {
        Err("refused: the capture pipe is not served by the Compy that started this helper".into())
    }
}

/// Helper side: a writer thread over the pipe, so a stalled reader can never stall the capture loop.
/// Nothing here blocks: a full queue drops the line. `broken()` turns true once a write fails (the app
/// closed the pipe: stop, exit or crash), which is the helper's signal to exit.
///
/// Review r2 N3: each kind of line is accounted for exactly once.
/// - A dropped REPORT is counted (`send_report`), and the running count reaches the app (`tell_dropped`),
///   which counts it as a tick it could not measure.
/// - A dropped UNREADABLE line is NOT counted as a drop: its count is cumulative, so it is kept and sent
///   again on the next tick (`send_unreadable` / `retry_unreadable`), and the tick is counted once, as
///   unreadable, a tick late at most.
/// - A dropped keepalive carries nothing and is not counted.
pub(crate) struct PipeWriter {
    tx: std::sync::mpsc::SyncSender<String>,
    broken: std::sync::Arc<std::sync::atomic::AtomicBool>,
    dropped: std::sync::atomic::AtomicU64,
    told: std::sync::atomic::AtomicU64,
    /// The unreadable count whose line did not fit yet (0 = none pending).
    unsent_unreadable: std::sync::atomic::AtomicU64,
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
        PipeWriter {
            tx,
            broken,
            dropped: Default::default(),
            told: Default::default(),
            unsent_unreadable: Default::default(),
        }
    }

    /// Queue one line that carries nothing to account for (a keepalive); false when it did not fit.
    pub(crate) fn send(&self, line: String) -> bool {
        self.tx.try_send(line).is_ok()
    }

    /// Queue one report line; a report that does not fit is dropped and counted.
    pub(crate) fn send_report(&self, line: String) -> bool {
        let sent = self.tx.try_send(line).is_ok();
        if !sent {
            self.dropped.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        sent
    }

    /// Queue the cumulative unreadable count. If it does not fit, it is kept for `retry_unreadable` (a
    /// later, larger count replaces it); it is never counted as a dropped line.
    pub(crate) fn send_unreadable(&self, total: u64) {
        use std::sync::atomic::Ordering;
        if self.tx.try_send(unreadable_line(total)).is_ok() {
            // A count that reached the app covers any smaller one still waiting.
            let _ = self.unsent_unreadable.fetch_update(Ordering::AcqRel, Ordering::Acquire, |p| (p <= total).then_some(0));
        } else {
            self.unsent_unreadable.fetch_max(total, Ordering::AcqRel);
        }
    }

    /// Send the unreadable count that did not fit earlier, if any (called once per tick).
    pub(crate) fn retry_unreadable(&self) {
        use std::sync::atomic::Ordering;
        let pending = self.unsent_unreadable.load(Ordering::Acquire);
        if pending > 0 && self.tx.try_send(unreadable_line(pending)).is_ok() {
            let _ = self.unsent_unreadable.compare_exchange(pending, 0, Ordering::AcqRel, Ordering::Acquire);
        }
    }

    /// If lines were dropped since the app was last told, queue the running count. A count line that
    /// does not fit is not itself counted; it is tried again on the next call.
    pub(crate) fn tell_dropped(&self) {
        use std::sync::atomic::Ordering;
        let total = self.dropped.load(Ordering::Acquire);
        if total > self.told.load(Ordering::Acquire) && self.tx.try_send(dropped_line(total)).is_ok() {
            self.told.store(total, Ordering::Release);
        }
    }

    pub(crate) fn dropped(&self) -> u64 {
        self.dropped.load(std::sync::atomic::Ordering::Acquire)
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
        assert_eq!(classify_line(&dropped_line(3)), Line::Dropped(3));
        for junk in ["", "hello", r#"{"pid":"x","fps":1}"#, r#"{"fps":1}"#, r#"{"unreadable_ticks":-1}"#, r#"{"dropped_lines":x}"#, "[1,2]"] {
            assert_eq!(classify_line(junk), Line::Junk, "{junk}");
        }
    }

    /// Review r1: a consistency check (server pid, image name, logon session), and the helper's own
    /// snapshot parent is no longer asked.
    #[test]
    fn the_helper_checks_server_pid_image_and_session_and_not_its_own_parent() {
        let ok = |pid, arg, img, s_sess, o_sess| server_is_the_app(pid, arg, img, "compy.exe", s_sess, o_sess);
        assert!(ok(Some(100), 100, Some("compy.exe"), Some(1), Some(1)));
        assert!(ok(Some(100), 100, Some("COMPY.EXE"), Some(1), Some(1)));
        assert!(!ok(Some(101), 100, Some("compy.exe"), Some(1), Some(1)), "a server that is not --parent-pid");
        assert!(!ok(Some(100), 100, Some("evil.exe"), Some(1), Some(1)), "another image");
        assert!(!ok(Some(100), 100, Some("compy.exe"), Some(2), Some(1)), "another logon session");
        assert!(!ok(None, 100, Some("compy.exe"), Some(1), Some(1)));
        assert!(!ok(Some(100), 100, None, Some(1), Some(1)));
        assert!(!ok(Some(100), 100, Some("compy.exe"), None, Some(1)));
        assert!(!ok(Some(100), 100, Some("compy.exe"), None, None), "two unknown sessions are not a match");
        assert!(!ok(Some(0), 0, Some("compy.exe"), Some(1), Some(1)));
        // The function no longer takes the helper's own parent at all.
        let src = include_str!("fps_pipe.rs");
        let f = src.find(concat!("pub(crate) fn server_is_", "the_app(")).unwrap();
        let sig = &src[f..f + src[f..].find(") -> bool").unwrap()];
        assert!(!sig.contains("own_parent"), "the helper's snapshot parent is not part of the check");
    }

    /// Review r1 B5: the client must be EXACTLY the process the launch started; the image name is a
    /// second check, never enough alone.
    #[test]
    fn the_app_accepts_only_the_exact_process_it_launched_as_client() {
        assert!(client_is_our_helper(7, Some(7), Some("compy.exe"), "compy.exe"));
        assert!(client_is_our_helper(7, Some(7), Some("Compy.EXE"), "compy.exe"));
        assert!(!client_is_our_helper(8, Some(7), Some("compy.exe"), "compy.exe"), "a process named compy.exe the app did not launch");
        assert!(!client_is_our_helper(7, None, Some("compy.exe"), "compy.exe"), "the launch has not reported its pid");
        assert!(!client_is_our_helper(7, Some(7), Some("evil.exe"), "compy.exe"));
        assert!(!client_is_our_helper(7, Some(7), None, "compy.exe"));
        assert!(!client_is_our_helper(0, Some(0), Some("compy.exe"), "compy.exe"));
    }

    #[test]
    fn the_launched_pid_is_waited_for_briefly_and_never_invented() {
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::sync::Arc;
        let slot = Arc::new(AtomicU32::new(0));
        let t = std::time::Instant::now();
        assert_eq!(launched_pid(&slot, std::time::Duration::from_millis(100)), None);
        assert!(t.elapsed() >= std::time::Duration::from_millis(100), "it waited the whole window");
        let late = slot.clone();
        let setter = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            late.store(4242, Ordering::Release);
        });
        assert_eq!(launched_pid(&slot, std::time::Duration::from_secs(2)), Some(4242), "a pid set a moment late is seen");
        setter.join().unwrap();
        // A client that is not the launched pid is refused before any snapshot is read.
        assert!(!is_our_helper(4243, &slot));
    }

    /// Review r1 B2: a line longer than MAX_LINE ends the read; nothing of it is relayed.
    #[test]
    fn an_over_long_line_ends_the_read_and_grows_nothing() {
        let mut input = Vec::new();
        input.extend_from_slice(ALIVE_LINE.as_bytes());
        input.push(b'\n');
        input.resize(input.len() + MAX_LINE + 10, b'x');
        input.extend_from_slice(b"\n{\"unreadable_ticks\":1}\n");
        let mut got = Vec::new();
        let end = relay_lines(std::io::Cursor::new(input), &|| true, &mut |l| got.push(l));
        assert_eq!(end, ServeEnd::Overlong);
        assert_eq!(got, vec![Line::Alive], "nothing after the over-long line");
        // Exactly MAX_LINE bytes before the newline (a CR included) is still a line; a missing final
        // newline at EOF still counts.
        let mut fit = vec![b'y'; MAX_LINE - 1];
        fit.extend_from_slice(b"\r\n");
        fit.extend_from_slice(unreadable_line(2).as_bytes());
        let mut got = Vec::new();
        assert_eq!(relay_lines(std::io::Cursor::new(fit), &|| true, &mut |l| got.push(l)), ServeEnd::HelperGone);
        assert_eq!(got, vec![Line::Junk, Line::Unreadable(2)]);
        // Not wanted: nothing is relayed at all.
        let mut got = Vec::new();
        let end = relay_lines(std::io::Cursor::new(format!("{ALIVE_LINE}\n")), &|| false, &mut |l| got.push(l));
        assert_eq!((end, got.len()), (ServeEnd::NotWanted, 0));
    }

    /// Review r1 B3: a pipe held by another client is waited for, not given up on at once.
    #[test]
    fn a_busy_pipe_is_retried_until_the_instance_is_free() {
        let server = ServerPipe::create().expect("create pipe");
        let name = server.name.clone();
        let squat_name = name.clone();
        let squatter = std::thread::spawn(move || {
            let f = loop {
                match std::fs::OpenOptions::new().write(true).open(&squat_name) {
                    Ok(f) => break f,
                    Err(_) => std::thread::sleep(std::time::Duration::from_millis(10)),
                }
            };
            std::thread::sleep(std::time::Duration::from_millis(400));
            drop(f);
        });
        // The server lets the squatter go, then listens again, as `serve` does for a client that is not ours.
        let srv = std::thread::spawn(move || {
            server.accept().unwrap();
            squatter.join().unwrap();
            server.disconnect();
            server.accept().unwrap();
            server
        });
        std::thread::sleep(std::time::Duration::from_millis(150));
        let t = std::time::Instant::now();
        let opened = open_pipe_for_writing(&name);
        assert!(opened.is_ok(), "the busy pipe was retried: {opened:?}");
        assert!(t.elapsed() < BUSY_PIPE_PATIENCE, "and within the patience window");
        drop(srv.join().unwrap());
    }

    /// A writer whose thread is held at each flush until the test releases it, once per line.
    struct Gate(std::sync::Arc<std::sync::Mutex<Vec<u8>>>, std::sync::Arc<std::sync::Barrier>);
    impl Write for Gate {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.1.wait();
            Ok(())
        }
    }

    /// Dropped REPORTS are counted and the count reaches the app as its own line.
    #[test]
    fn dropped_lines_are_counted_and_told() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
        let w = PipeWriter::start(Gate(seen.clone(), gate.clone()));
        // One line in the writer (held at flush) + 4 queued; the rest are dropped and counted.
        let sent = (0..10).filter(|_| w.send_report(ALIVE_LINE.into())).count();
        assert!(sent <= 5 && w.dropped() == (10 - sent) as u64, "sent {sent}, dropped {}", w.dropped());
        let dropped = w.dropped();
        assert!(dropped >= 5);
        for _ in 0..sent {
            gate.wait();
        }
        w.tell_dropped();
        gate.wait();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let text = String::from_utf8(seen.lock().unwrap().clone()).unwrap();
        assert_eq!(text.lines().last().map(classify_line), Some(Line::Dropped(dropped)), "{text}");
        assert_eq!(w.dropped(), dropped, "the count line itself was not a drop");
    }

    /// Review r2 N3: an unreadable count that does not fit is NOT a dropped line; it is re-sent once
    /// there is room, as the latest cumulative count, so the app counts each unreadable tick once.
    /// Keepalives that do not fit are not counted either.
    #[test]
    fn a_dropped_unreadable_count_is_resent_not_counted_as_a_drop() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
        let w = PipeWriter::start(Gate(seen.clone(), gate.clone()));
        // One keepalive taken by the writer thread (held at its flush), then the queue of 4 filled; the
        // rest do not fit and are not counted.
        assert!(w.send(ALIVE_LINE.into()));
        std::thread::sleep(std::time::Duration::from_millis(100));
        let sent = 1 + (0..9).filter(|_| w.send(ALIVE_LINE.into())).count();
        assert_eq!(sent, 5, "one in the writer, four queued");
        assert_eq!(w.dropped(), 0, "keepalives are never counted");
        // Two unreadable ticks that do not fit: kept, not counted.
        w.send_unreadable(1);
        w.send_unreadable(2);
        assert_eq!(w.dropped(), 0, "an unreadable count is never a dropped line");
        for _ in 0..sent {
            gate.wait();
        }
        // Room again: the next tick re-sends the latest count, once.
        w.retry_unreadable();
        gate.wait();
        w.retry_unreadable(); // nothing pending any more: sends nothing
        w.tell_dropped(); // nothing dropped: sends nothing
        std::thread::sleep(std::time::Duration::from_millis(50));
        let text = String::from_utf8(seen.lock().unwrap().clone()).unwrap();
        let counts: Vec<Line> = text.lines().map(classify_line).filter(|l| !matches!(l, Line::Alive)).collect();
        assert_eq!(counts, vec![Line::Unreadable(2)], "{text}");
    }

    /// Review r2 N6: the launch ends while a client that is not ours holds the pipe (so the wake cannot
    /// get in). The reader drops that client and must stop there, not wait in `accept` until the app exits.
    #[test]
    fn a_reader_stops_after_dropping_a_foreign_client_once_its_launch_has_ended() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let server = ServerPipe::create().expect("create pipe");
        let name = server.name.clone();
        let done = Arc::new(AtomicBool::new(false));
        let (tx, rx) = std::sync::mpsc::channel();
        let flag = done.clone();
        std::thread::spawn(move || {
            let wanted = || !flag.load(Ordering::Acquire);
            // The check of the foreign client is where the launch ends (it sets `done`), then refuses it.
            let client_ok = |_pid: u32| {
                flag.store(true, Ordering::Release);
                false
            };
            let end = server.serve(&wanted, &client_ok, &mut |_| {});
            let _ = tx.send(end);
        });
        let foreign = loop {
            match std::fs::OpenOptions::new().write(true).open(&name) {
                Ok(f) => break f,
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(10)),
            }
        };
        let end = rx.recv_timeout(std::time::Duration::from_secs(3));
        drop(foreign);
        assert_eq!(end, Ok(ServeEnd::NotWanted), "the reader stopped instead of waiting for another client");
        assert!(done.load(Ordering::Acquire));
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
