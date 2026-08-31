//! Whole-file byte replacement for Compy's SECONDARY on-disk state.
//!
//! ## What this buys
//!
//! `std::fs::write` truncates the target and then writes into it. A save interrupted between those
//! two steps leaves a **truncated file where a complete one used to be** — and every loader this
//! helper serves treats a parse failure as "no data", so a half-written file reads back as an empty
//! store. Writing the bytes to a fresh temp in the same directory and renaming it over the target
//! means the target only ever holds the old complete bytes or the new complete bytes.
//!
//! ## What this is NOT, and must never be claimed
//!
//! - **Not sudden-power-loss durability.** The rename is ordered by the filesystem, not by the
//!   disk's write cache, and this helper does not fsync the parent directory. What the tests prove
//!   is a *tested interruption boundary* — the process failing at a named point — never a machine
//!   crash.
//! - **Not a lock.** Unique temp names stop two writers from destroying each other's temp file;
//!   they do nothing about the rename. Two processes writing the same target still race, and the
//!   last rename wins whole. Callers that read-modify-write keep every cross-process lost-update
//!   race they already had; closing that needs locking, which is deliberately not in this slice.
//! - **Not a transaction.** Two files written by two calls can still land one-then-the-other.
//!
//! ## Deliberately excluded callers
//!
//! The Trust Ledger / rollback history and the signed remote rules do NOT use this. `history.rs`
//! carries ledger-specific corruption and rollback rules, and its own temp/rename pattern is
//! likewise not proof of power-loss durability. The remote-rules cache stores three related objects
//! that per-file replacement cannot make consistent with each other, so it needs a design decision
//! rather than this helper.
//!
//! The license store is the one caller here that is not JSON: `license.rs` passes the signed token's
//! **exact plain-text bytes**, because re-serializing them would invalidate the signature.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// A named point at which a write can be interrupted, so the "never mixed bytes" claim is proven by
/// injection rather than asserted. Production always passes [`FailPoint::None`]; the other variants
/// exist for the tests in this module and its callers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum FailPoint {
    /// Normal operation.
    None,
    /// Fail immediately after the temp file is exclusively created, before any byte is written.
    AfterTempCreate,
    /// Fail after the bytes are written and flushed, before the rename.
    BeforeRename,
}

/// Per-process counter so two writes from the same process never pick the same temp name.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// A temp name that is unique per process and per call, and that sorts next to its target so a
/// leftover is recognisable as this helper's. It stays in the TARGET's own directory — a temp on
/// another volume would make the rename a copy, which is exactly the non-atomic behaviour being
/// removed here.
fn temp_path_for(path: &Path, seq: u64) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "compy".to_string());
    let tmp = format!(".{name}.{}-{seq}.tmp", std::process::id());
    match path.parent() {
        Some(dir) => dir.join(tmp),
        None => PathBuf::from(tmp),
    }
}

/// Replace `path` with `bytes`, leaving the previous contents intact if anything fails.
///
/// The caller is responsible for creating the parent directory — each of them already does, with
/// its own error wording, and moving that in here would change what the user is told.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_atomic_at(path, bytes, FailPoint::None)
}

// Test-only injection armed on THIS thread for the NEXT write, whoever performs it.
//
// A caller test can only prove that a save *goes through this module* if it can interrupt the save
// without the caller taking a fail-point argument — otherwise reverting that caller to
// `std::fs::write` leaves the test green, and the guard guards nothing. It is thread-local and
// one-shot: libtest gives every test its own thread, so one test's injection can never reach
// another's, and consuming it disarms it even if the write then succeeds for some other reason.
#[cfg(test)]
thread_local! {
    static FORCED: std::cell::Cell<FailPoint> = const { std::cell::Cell::new(FailPoint::None) };
}

/// Arm [`FORCED`] for the next write on this thread. Test-only, and deliberately not `pub`.
#[cfg(test)]
pub(crate) fn force_next_failure(at: FailPoint) {
    FORCED.with(|c| c.set(at));
}

#[cfg(test)]
fn take_forced() -> FailPoint {
    FORCED.with(|c| c.replace(FailPoint::None))
}

#[cfg(not(test))]
fn take_forced() -> FailPoint {
    FailPoint::None
}

/// [`write_atomic`] with an injectable interruption point. See [`FailPoint`].
pub(crate) fn write_atomic_at(
    path: &Path,
    bytes: &[u8],
    fail_at: FailPoint,
) -> std::io::Result<()> {
    // An explicit argument wins; otherwise honour whatever this thread armed. In a release build
    // `take_forced` is a constant `None` and the whole seam folds away.
    let fail_at = if fail_at == FailPoint::None {
        take_forced()
    } else {
        fail_at
    };
    // Try a few names before giving up: `create_new` is the exclusivity guarantee, so a collision
    // (a stale temp from a killed process, or a hostile pre-creation) must be stepped over rather
    // than overwritten. The counter makes a genuine collision vanishingly unlikely; the retry is
    // here so that "unlikely" never means "silently clobbered".
    let mut last_err: Option<std::io::Error> = None;
    for _ in 0..8 {
        let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp = temp_path_for(path, seq);

        let file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
        {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                last_err = Some(e);
                continue;
            }
            // Any other error (missing directory, permissions) is the caller's to see, unchanged.
            Err(e) => return Err(e),
        };

        // From here on, this call owns exactly one temp file and cleans up exactly that one. It
        // never touches another operation's temp, and it never removes the TARGET to make the
        // rename succeed — the whole point is that the old bytes survive a failure.
        let result = write_and_replace(file, &tmp, path, bytes, fail_at);
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        return result;
    }
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "could not create a unique temporary file",
        )
    }))
}

fn write_and_replace(
    mut file: std::fs::File,
    tmp: &Path,
    path: &Path,
    bytes: &[u8],
    fail_at: FailPoint,
) -> std::io::Result<()> {
    if fail_at == FailPoint::AfterTempCreate {
        return Err(std::io::Error::other("injected failure after temp create"));
    }

    file.write_all(bytes)?;
    file.flush()?;
    // Push this file's own bytes at the OS before the rename. This orders the data ahead of the
    // name change; it is not, and is not claimed as, a durability barrier for the directory entry.
    file.sync_all()?;
    // Close before renaming: on Windows an open handle can make the replacement fail outright.
    drop(file);

    if fail_at == FailPoint::BeforeRename {
        return Err(std::io::Error::other("injected failure before rename"));
    }

    // Windows: `std::fs::rename` is `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`, so an existing
    // target is replaced rather than erroring — but the call FAILS if the target is held open by a
    // process that did not share delete access. That failure is the good outcome: the old file is
    // still there, whole, and the caller gets an error instead of a hole where its data was.
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Every test writes into its own directory under the OS temp dir. Nothing here reads or
    /// writes the real `%APPDATA%\Compy` data root.
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-atomic-{}-{}-{}",
            tag,
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .expect("read scratch")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn writes_a_new_file_whole() {
        let dir = scratch("new");
        let target = dir.join("store.json");
        write_atomic(&target, b"{\"a\":1}").expect("write");
        assert_eq!(std::fs::read(&target).unwrap(), b"{\"a\":1}");
        assert!(leftovers(&dir).is_empty(), "temp file left behind");
    }

    #[test]
    fn replaces_an_existing_file_whole() {
        let dir = scratch("replace");
        let target = dir.join("store.json");
        std::fs::write(&target, b"OLD-AND-MUCH-LONGER-THAN-THE-NEW-ONE").unwrap();
        write_atomic(&target, b"NEW").expect("write");
        // Not "starts with NEW" — the whole file is the new bytes, with no tail of the old one.
        assert_eq!(std::fs::read(&target).unwrap(), b"NEW");
        assert!(leftovers(&dir).is_empty(), "temp file left behind");
    }

    #[test]
    fn failure_after_temp_create_leaves_the_old_bytes_untouched() {
        let dir = scratch("fail-create");
        let target = dir.join("store.json");
        std::fs::write(&target, b"OLD").unwrap();
        let err = write_atomic_at(&target, b"NEW", FailPoint::AfterTempCreate)
            .expect_err("injected failure should surface");
        assert!(err.to_string().contains("after temp create"));
        assert_eq!(std::fs::read(&target).unwrap(), b"OLD");
        assert!(leftovers(&dir).is_empty(), "temp file not cleaned up");
    }

    #[test]
    fn failure_before_rename_leaves_the_old_bytes_untouched() {
        let dir = scratch("fail-rename");
        let target = dir.join("store.json");
        std::fs::write(&target, b"OLD").unwrap();
        let err = write_atomic_at(&target, b"NEW", FailPoint::BeforeRename)
            .expect_err("injected failure should surface");
        assert!(err.to_string().contains("before rename"));
        // The bytes were fully written to the temp and the temp was then discarded. The target is
        // the OLD file, not a mixture: this is the "either old or complete new, never mixed" claim.
        assert_eq!(std::fs::read(&target).unwrap(), b"OLD");
        assert!(leftovers(&dir).is_empty(), "temp file not cleaned up");
    }

    #[test]
    fn a_failed_write_never_creates_the_target() {
        let dir = scratch("no-create");
        let target = dir.join("store.json");
        assert!(write_atomic_at(&target, b"NEW", FailPoint::BeforeRename).is_err());
        assert!(
            !target.exists(),
            "a failed write invented a target that never existed"
        );
    }

    #[test]
    fn a_missing_directory_is_the_callers_error_not_a_silent_success() {
        let dir = scratch("missing");
        let target = dir.join("nope").join("store.json");
        let err = write_atomic(&target, b"NEW").expect_err("must not succeed");
        assert!(!target.exists());
        // The kind is whatever the OS says for "no such directory" — the point is that it is
        // returned, not swallowed. Callers map it into their own wording.
        assert_ne!(err.kind(), std::io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn the_old_target_is_never_removed_to_make_the_rename_work() {
        // A directory in the target's place cannot be replaced by a rename on Windows. The helper
        // must fail and leave it alone rather than deleting it first.
        let dir = scratch("dir-target");
        let target = dir.join("store.json");
        std::fs::create_dir(&target).unwrap();
        assert!(write_atomic(&target, b"NEW").is_err());
        assert!(target.is_dir(), "the existing target was destroyed");
        assert!(leftovers(&dir).is_empty(), "temp file not cleaned up");
    }

    #[test]
    fn concurrent_writers_do_not_clobber_each_others_temp() {
        let dir = scratch("concurrent");
        let target = dir.join("store.json");
        let a = vec![b'A'; 64 * 1024];
        let b = vec![b'B'; 64 * 1024];

        let (ta, tb) = (target.clone(), target.clone());
        let (aa, bb) = (a.clone(), b.clone());
        let h1 = std::thread::spawn(move || write_atomic(&ta, &aa));
        let h2 = std::thread::spawn(move || write_atomic(&tb, &bb));
        h1.join().unwrap().expect("writer A");
        h2.join().unwrap().expect("writer B");

        // Last rename wins WHOLE. This is the honest claim: not that one of them is ordered first,
        // only that the survivor is one complete payload and never a blend of both.
        let got = std::fs::read(&target).unwrap();
        assert!(got == a || got == b, "the file is a mixture of both writers");
        assert!(leftovers(&dir).is_empty(), "temp files left behind");
    }

    #[test]
    fn a_stale_temp_from_another_run_is_stepped_over_not_overwritten() {
        // `create_new` is the exclusivity guarantee. Pre-create the exact name the next call will
        // try, and it must pick a different one rather than truncating a file it does not own.
        let dir = scratch("stale");
        let target = dir.join("store.json");
        let next = TEMP_SEQ.load(Ordering::Relaxed);
        let squatter = temp_path_for(&target, next);
        std::fs::write(&squatter, b"NOT MINE").unwrap();

        write_atomic(&target, b"NEW").expect("write");
        assert_eq!(std::fs::read(&target).unwrap(), b"NEW");
        assert_eq!(
            std::fs::read(&squatter).unwrap(),
            b"NOT MINE",
            "another operation's temp was clobbered"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_share_lock_on_the_target_preserves_the_old_data() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = scratch("locked");
        let target = dir.join("store.json");
        std::fs::write(&target, b"OLD").unwrap();

        // share_mode(0) = no other handle may read, write, or DELETE. `MoveFileEx` needs delete
        // access on the target to replace it, so the rename must fail.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .expect("hold the target open");

        let err = write_atomic(&target, b"NEW").expect_err("a locked target must not be replaced");
        assert_ne!(err.kind(), std::io::ErrorKind::NotFound);
        drop(held);

        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"OLD",
            "a lock failure cost the user their previous data"
        );
        assert!(leftovers(&dir).is_empty(), "temp file not cleaned up");
    }
}
