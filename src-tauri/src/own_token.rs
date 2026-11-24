//! This process's own token, read-only. A leaf: it depends on no other Compy module, so a module that
//! needs the token (fps_pipe's SID lookup, monitoring's elevation and group checks) gains no edge into
//! the store modules by calling it. Moved verbatim from monitoring.rs (A5 Part A, store lock order).

/// Run `f` with a read-only handle to THIS process's own token. (Our own token, never another
/// process's: nothing here touches the game.)
pub(crate) fn with_own_token<R>(f: impl FnOnce(windows::Win32::Foundation::HANDLE) -> Option<R>) -> Option<R> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::TOKEN_QUERY;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    // SAFETY: GetCurrentProcess is a pseudo-handle; the token handle is closed before returning.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
        let out = f(token);
        let _ = CloseHandle(token);
        out
    }
}
