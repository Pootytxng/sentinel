//! Test-only scratch folders under %TEMP% (D1d, 2026-11-22).
//!
//! Why: test modules named their scratch folder or file from the process id alone ("compy-x-<pid>") and
//! did not always empty it first or remove it after. Windows reuses process ids, so a later run could
//! open what an earlier run left (lane C's race fix f8adaf26 caught one: a later run appended to an
//! earlier run's sessions.json), and the folders piled up in %TEMP%.
//!
//! A [`Scratch`] owns a ROOT folder whose name no other run can reuse (label, process id, the clock in
//! nanoseconds and a per-process counter), created empty (checked) and removed with everything in it
//! when the `Scratch` is dropped, so a passing or a failing test leaves nothing behind. [`Scratch::child`]
//! points it at a name inside that root, so a test that used `temp_dir().join("compy-x-<pid>")` keeps
//! the very same leaf name, now inside a fresh root: what did not exist before the test still does not.
//!
//! Keep the `Scratch` alive for the whole test (bind it to a named variable, not `_`). It derefs to the
//! path it points at, so `s.join(..)`, `&s` (as `&Path` or `AsRef<Path>`) and `s.path_buf()` all work.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// A scratch root that is removed (with everything in it) when dropped, and the path inside it a test uses.
#[derive(Debug)]
pub(crate) struct Scratch {
    root: PathBuf,
    path: PathBuf,
}

impl Scratch {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// The path, owned (for code that holds a `PathBuf`).
    pub(crate) fn path_buf(&self) -> PathBuf {
        self.path.clone()
    }

    /// The same root, now pointing at `name` inside it (nothing is created at `name`).
    pub(crate) fn child(mut self, name: impl AsRef<Path>) -> Scratch {
        self.path = self.root.join(name);
        self
    }
}

impl std::ops::Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.path
    }
}

impl AsRef<Path> for Scratch {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // A test may have removed it already, or a file in it may still be open on Windows: neither is
        // a reason to panic inside a drop (that would hide the test's own failure).
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A new, empty scratch root `%TEMP%\compy-<label>-<pid>-<nanos>-<n>`, pointing at itself.
pub(crate) fn scratch(label: &str) -> Scratch {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!("compy-{label}-{}-{nanos}-{n}", std::process::id()));
    assert!(!root.exists(), "a scratch name was reused: {}", root.display());
    std::fs::create_dir_all(&root).unwrap_or_else(|e| panic!("could not create scratch folder {}: {e}", root.display()));
    assert_eq!(std::fs::read_dir(&root).map(|d| d.count()).unwrap_or(1), 0, "scratch folder {} starts empty", root.display());
    Scratch { path: root.clone(), root }
}

/// `scratch(label).child(name)`: the leaf name a test used to build under %TEMP%, inside a fresh root.
pub(crate) fn scratch_child(label: &str, name: impl AsRef<Path>) -> Scratch {
    scratch(label).child(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scratch_folder_is_new_empty_unique_and_gone_after_drop() {
        let a = scratch("selftest");
        let b = scratch("selftest");
        assert_ne!(a.path(), b.path(), "two scratch folders in one run never share a name");
        assert!(a.is_dir() && std::fs::read_dir(&a).unwrap().count() == 0);
        std::fs::write(a.join("f.txt"), "x").unwrap();
        std::fs::create_dir_all(a.join("sub").join("deeper")).unwrap();
        let kept = a.path_buf();
        drop(a);
        assert!(!kept.exists(), "a dropped scratch folder is removed with its contents");
        // A test that removed its own folder first does not make the drop panic.
        let gone = b.path_buf();
        std::fs::remove_dir_all(&gone).unwrap();
        drop(b);
        assert!(!gone.exists());
    }

    #[test]
    fn a_child_keeps_the_leaf_name_inside_a_fresh_root_and_the_root_goes_on_drop() {
        let c = scratch_child("selftest", "compy-x-1234");
        assert_eq!(c.file_name().unwrap(), "compy-x-1234");
        assert!(!c.exists(), "nothing is created at the child path");
        let root = c.parent().unwrap().to_path_buf();
        assert!(root.is_dir() && std::fs::read_dir(&root).unwrap().count() == 0);
        std::fs::create_dir_all(c.join("deep")).unwrap();
        drop(c);
        assert!(!root.exists());
    }
}
