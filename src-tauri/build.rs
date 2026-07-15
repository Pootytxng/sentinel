use std::process::Command;

// §C build provenance stamp (spec 2026-06-12): the git facts are read HERE, at compile time —
// the shipped binary never invokes git (zero runtime process spawn, zero network). A build
// without git (or outside a repo) degrades to "nogit" rather than failing.
fn git_stamp() -> (String, bool) {
    let hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "nogit".into());
    // Dirty means "the shipped binary can differ from HEAD's code" — docs/ never compiles into
    // the binary, so it is excluded (tracked or untracked); an untracked file anywhere ELSE
    // (a new src module, a config) still counts. Caught 2026-07-14: 89 untracked docs/ui-sweep
    // shots stamped the PART B installer "+dirty" from a code-identical tree.
    let dirty = Command::new("git")
        .args(["status", "--porcelain", "--", ":(exclude)docs"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    (hash, dirty)
}

fn main() {
    let (hash, dirty) = git_stamp();
    println!("cargo:rustc-env=COMPY_GIT_HASH={hash}");
    println!("cargo:rustc-env=COMPY_GIT_DIRTY={}", if dirty { "1" } else { "0" });
    // Re-stamp when the checked-out commit moves. (The dirty flag is best-effort between
    // commits — cargo can't watch the whole tree for it; a rebuild after any code change
    // refreshes it anyway, which is exactly when it matters.)
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    tauri_build::build()
}
