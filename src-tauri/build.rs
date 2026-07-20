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
    //
    // MUST use the `top` pathspec magic: cargo runs this build script with CWD = the crate root
    // (src-tauri/), and a bare `:(exclude)docs` resolves `docs` RELATIVE to that CWD — i.e. it
    // would try to exclude the non-existent `src-tauri/docs` and let every repo-root docs/ file
    // leak back in as "dirty". `:(exclude,top)docs` anchors the path to the repo root regardless
    // of CWD, which is the whole point. (Regressing to the bare form re-introduces the exact
    // 2026-07-17 false-positive that stamped a code-identical arming build "+dirty"; the guard
    // `build_dirty_check_is_root_anchored` in lib.rs pins this.)
    let dirty = Command::new("git")
        .args(["status", "--porcelain", "--", ":(exclude,top)docs"])
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
    // Re-run this stamp when an input that can make the binary differ from HEAD changes. Once a
    // build script emits ANY rerun-if-changed, cargo watches ONLY the listed paths (it drops its
    // default whole-package scan) — so the OLD watch set (`.git/HEAD` + `.git/index` alone) went
    // STALE on an unstaged working-tree edit: changing a compiled source without `git add` touches
    // NEITHER .git path, so build.rs never re-ran and `COMPY_GIT_DIRTY` kept its previous value.
    // (The old comment here claimed "a rebuild after any code change refreshes it anyway" — that is
    // FALSE: a source edit recompiles the crate but does NOT by itself re-run the build script.)
    //   ../.git/HEAD   — the checked-out commit moving (new commit ⇒ re-stamp hash + dirty)
    //   ../.git/index  — staging (`git add`) ⇒ re-stamp
    //   src / Cargo.toml / Cargo.lock — UNSTAGED edits to this crate's compiled inputs ⇒ re-stamp dirty
    // EXPLICIT vs EFFECTIVE watch set: the five rerun-if-changed lines below are COMPY's explicit set.
    // `tauri_build::build()` (called at the end of main) emits its OWN watchers on top — notably
    // `tauri.conf.json` AND `capabilities/` — so the EFFECTIVE combined set already covers those two;
    // they are NOT residuals (an earlier version of this comment wrongly listed capabilities/ as an
    // uncovered residual). Genuine residual (documented, not silently ignored): an unstaged change
    // OUTSIDE both sets — e.g. a repo-root config file or the frontend ../src bundle — still won't
    // re-trigger this script on its own until it is staged or committed. The backstop is
    // ship-reinstall.ps1 step 0b, which takes a FRESH `git status` at ship time, so no artifact leaves
    // with an unaccounted-for dirty tree. The predicate's behavior (clean → unstaged dirty → clean) is
    // pinned by `build_dirty_predicate_flips_on_unstaged_change` in lib.rs.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=Cargo.lock");
    tauri_build::build()
}
