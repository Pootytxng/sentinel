//! Canonical data-root resolver — issue #130.
//!
//! Design: `docs/decisions/2026-08-18-canonical-data-root.md`, with one correction adopted from the
//! #130 live evidence (see "Predicate 1 is evidence, not a verdict" below).
//!
//! ## Why this module exists
//!
//! `compy_data_dir()` used to be three lines: read `APPDATA`, join `Compy`, done. On this desk that
//! silently produced **two** Trust Ledgers. Compy was launched at least once as a child of an
//! MSIX-packaged host (the packaged Claude desktop app). Every child of such a host runs inside a
//! container whose filesystem view is overlaid by the package, so the literal path
//! `C:\Users\Kuya\AppData\Roaming\Compy` *resolves* to
//! `C:\Users\Kuya\AppData\Local\Packages\<family>\LocalCache\Roaming\Compy`.
//!
//! `APPDATA` was never wrong. The **resolution** was redirected. A resolver that validated,
//! canonicalised or hardened the `APPDATA` *string* would have passed every check and still written
//! into the sandbox.
//!
//! The consequence is a LOCKED-rule-3 (rollback-first) breach, not a cosmetic path bug: Compy's
//! mutations land on surfaces MSIX does **not** virtualize — the SCM, the power subsystem, Task
//! Scheduler, `HKLM\SYSTEM` — so the machine really changed while the receipt went into a sandbox
//! no normally-launched Compy can see. Twelve such changes are live on the owner's Windows right
//! now with no reachable rollback contract (#130 inventory).
//!
//! ## The contract
//!
//! One resolver, one decision value, consumed by every persistence and mutation caller. Mutation
//! capability is a **type** (`MutationRoot`), not a runtime check that someone must remember to
//! write — same discipline as the mutation-boundary guard. A redirected or sandbox root cannot
//! reach an apply, a rollback or a ledger write *by construction*.
//!
//! ## Predicate 1 is evidence, not a verdict (correction to the design doc, #130)
//!
//! The design made "process has package identity" decisive: any package family name ⇒ `Redirected`.
//! That was falsified while implementing this: a Store-packaged **PowerShell**
//! (`Microsoft.PowerShell_..._8wekyb3d8bbwe`) has package identity and has **no** filesystem
//! redirection at all — it reads the real Roaming root and a package overlay as two distinct files.
//! Package identity and container redirection are independent properties, and Store terminals are
//! the common case. Shipping the predicate as written would halt Compy on clean machines, which is
//! a worse failure than the bug it guards.
//!
//! So package identity is kept as *evidence* and as a **lookup key**: it names the one overlay
//! directory worth comparing against. The decisive tests are the ones that measure where a path
//! actually lands:
//!
//! * **P2** — `APPDATA` string sanity (catches a parent that rewrites the variable).
//! * **P3** — final-path resolution of the opened root (`GetFinalPathNameByHandle`, reached here
//!   through `std::fs::canonicalize`) must not land under `…\AppData\Local\Packages\`. This is the
//!   substance of the "`Get-Item` reports an empty `LinkType` but a populated `Target`" observation
//!   from the #130 packet, in its documented, Rust-native form.
//! * **P4** — when a package family *is* present, our root must not share a volume + file id with
//!   that package's `LocalCache\Roaming\Compy` overlay. Inside the container those two paths report
//!   the **same NTFS file id** while enumerating different contents (proven in #130); outside it,
//!   the overlay usually does not exist at all. This is how package identity earns its keep without
//!   producing false positives.
//!
//! ## What this module never does
//!
//! No merge, overwrite, dedupe, rollback, copy, rename or quarantine, in either direction, ever.
//! `Redirected` and `Conflict` are **halt** states that show the user both paths and their receipt
//! counts. Recovery is a separate, explicit, owner-gated operation.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The one measurement-sandbox override. Its presence yields `Sandbox`, which cannot produce a
/// `MutationRoot`. There is deliberately no second "…and allow mutations" flag to get wrong, so
/// `launch-focus-guard` and the Q7 probes stay hermetic without touching the real ledger.
pub(crate) const MEASUREMENT_OVERRIDE_ENV: &str = "COMPY_MEASUREMENT_DATA_ROOT";

/// The path segment that marks an MSIX package's per-package writable store. Compared lowercase.
const PACKAGES_SEGMENT: &str = r"\appdata\local\packages\";

/// Returned as the effective root when no root can be resolved at all. It is absolute (so nothing
/// lands in the process CWD) and it cannot be created (`\\?\` demands a real volume path), so every
/// read fails "not found" and every write fails loudly. Deliberately **not** `C:\Temp\Compy`: the
/// old fallback wrote the Trust Ledger to a world-shared path.
const UNAVAILABLE_SENTINEL: &str = r"\\?\COMPY-DATA-ROOT-UNAVAILABLE";

/// Why a root was judged redirected. Always carried with the decision — a halt that cannot say what
/// it saw is a halt nobody can act on.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RedirectEvidence {
    /// `APPDATA` itself points inside a package container — a parent rewrote the variable.
    AppDataUnderPackages { appdata: String },
    /// `APPDATA` disagrees with `%USERPROFILE%\AppData\Roaming`.
    AppDataNotUserRoaming { appdata: String, expected: String },
    /// The opened root's *final* path lands inside a package container. This is the one that fires
    /// on container inheritance, where the `APPDATA` string is innocent.
    FinalPathUnderPackages { requested: String, resolved: String },
    /// A host package's `LocalCache\Roaming\Compy` overlay *is* our root — same volume + file id.
    PackageOverlayIsRoot {
        family: String,
        overlay: String,
        root: String,
    },
}

/// A Compy ledger found under some *other* package's overlay, with its receipt count.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ForeignLedger {
    pub path: String,
    /// `None` when the file exists but could not be parsed — treated as "may hold receipts", which
    /// halts. Conservative in the safe direction: we never assume a ledger we cannot read is empty.
    pub receipts: Option<usize>,
}

impl ForeignLedger {
    fn holds_receipts(&self) -> bool {
        self.receipts.map(|n| n > 0).unwrap_or(true)
    }
}

/// The single decision value every persistence and mutation caller consumes.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "variant", rename_all = "snake_case")]
pub(crate) enum DataRootDecision {
    /// The machine's own root, verified unredirected. The only variant that can mutate Windows.
    Canonical { root: PathBuf },
    /// Explicit measurement sandbox. Mutation is structurally impossible from this variant.
    Sandbox { root: PathBuf },
    /// Resolution is redirected by a host package or a rewritten environment. Halt.
    Redirected {
        effective: PathBuf,
        evidence: RedirectEvidence,
    },
    /// The canonical root and one or more foreign package roots both hold receipts. Halt.
    Conflict {
        canonical: PathBuf,
        canonical_receipts: Option<usize>,
        foreign: Vec<ForeignLedger>,
    },
    /// No root can be resolved at all (e.g. `APPDATA` unset). Halt. Never falls back to `C:\Temp`.
    Unavailable { reason: String },
}

impl DataRootDecision {
    /// The directory Compy would use for reads. Never used to authorize a mutation — that is
    /// `MutationRoot`'s job, and only `Canonical` can produce one.
    pub(crate) fn effective_root(&self) -> PathBuf {
        match self {
            Self::Canonical { root } | Self::Sandbox { root } => root.clone(),
            Self::Redirected { effective, .. } => effective.clone(),
            Self::Conflict { canonical, .. } => canonical.clone(),
            Self::Unavailable { .. } => PathBuf::from(UNAVAILABLE_SENTINEL),
        }
    }

    pub(crate) fn is_canonical(&self) -> bool {
        matches!(self, Self::Canonical { .. })
    }

    /// Plain-English halt text for the surface and for every refused mutation. Says what happened,
    /// which paths are involved, and what is safe next — never "an error occurred".
    pub(crate) fn halt_reason(&self) -> Option<String> {
        match self {
            Self::Canonical { .. } => None,
            Self::Sandbox { root } => Some(format!(
                "Compy is running against a measurement sandbox ({}), so it will not change Windows \
                 or record receipts. Unset {} and restart to use your real data.",
                root.display(),
                MEASUREMENT_OVERRIDE_ENV
            )),
            Self::Redirected {
                effective,
                evidence,
            } => Some(format!(
                "Compy's data folder is being redirected, so it cannot safely record or undo \
                 changes. It would write to {} instead of your real Compy folder. {} Close Compy \
                 and start it from your Start menu or desktop shortcut — not from inside another \
                 app — then try again.",
                effective.display(),
                describe_evidence(evidence)
            )),
            Self::Conflict {
                canonical,
                canonical_receipts,
                foreign,
            } => Some(format!(
                "Compy found two change histories and will not guess which one is yours. Your \
                 normal folder {} holds {}; {}. Nothing has been merged, copied or undone. Compy \
                 will not change Windows until this is sorted out — the support export lists both \
                 folders so they can be recovered deliberately.",
                canonical.display(),
                describe_count(*canonical_receipts),
                foreign
                    .iter()
                    .map(|f| format!("{} holds {}", f.path, describe_count(f.receipts)))
                    .collect::<Vec<_>>()
                    .join("; ")
            )),
            Self::Unavailable { reason } => Some(format!(
                "Compy could not work out where to keep your data ({reason}), so it will not \
                 change Windows. It deliberately does not fall back to a shared temporary folder."
            )),
        }
    }
}

fn describe_count(n: Option<usize>) -> String {
    match n {
        Some(1) => "1 recorded change".to_string(),
        Some(n) => format!("{n} recorded changes"),
        None => "a history file Compy could not read".to_string(),
    }
}

fn describe_evidence(e: &RedirectEvidence) -> String {
    match e {
        RedirectEvidence::AppDataUnderPackages { appdata } => {
            format!("Its APPDATA setting points inside an app container ({appdata}).")
        }
        RedirectEvidence::AppDataNotUserRoaming { appdata, expected } => {
            format!("Its APPDATA setting is {appdata}, not the expected {expected}.")
        }
        RedirectEvidence::FinalPathUnderPackages {
            requested,
            resolved,
        } => format!("The folder {requested} actually resolves to {resolved}."),
        RedirectEvidence::PackageOverlayIsRoot {
            family,
            overlay,
            root,
        } => format!(
            "The host app {family} is sharing its own private copy ({overlay}) with Compy in place \
             of {root}."
        ),
    }
}

/// Proof that the resolved root is the machine's own. **Constructible only from
/// `DataRootDecision::Canonical` — there is no other constructor, and the inner path is private.**
///
/// Every function that mutates Windows or writes a receipt takes `&MutationRoot`, so a redirected,
/// conflicted, unavailable or sandbox root cannot reach a mutation path by construction. That is
/// the whole point: not a check somebody has to remember, a type they cannot forge.
#[derive(Debug, Clone)]
pub(crate) struct MutationRoot(PathBuf);

impl MutationRoot {
    pub(crate) fn from_decision(d: &DataRootDecision) -> Option<Self> {
        match d {
            DataRootDecision::Canonical { root } => Some(Self(root.clone())),
            _ => None,
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    /// Test-only forge, so the existing mutation/rollback suites can keep exercising the real
    /// dispatch paths. `#[cfg(test)]` keeps it out of the shipped binary entirely — the guarantee
    /// above is unconditional in release.
    #[cfg(test)]
    pub(crate) fn for_test(root: PathBuf) -> Self {
        Self(root)
    }
}

/// Everything the decision depends on, gathered once so `resolve` stays pure and every guard below
/// can be falsified with a synthetic probe — no container required to test the container case.
#[derive(Debug, Clone, Default)]
pub(crate) struct RootProbe {
    pub appdata: Option<String>,
    pub userprofile: Option<String>,
    pub measurement_override: Option<String>,
    /// P1 — evidence and lookup key only. `Some(family)` does **not** mean redirected.
    pub package_family: Option<String>,
    /// P3 — the final resolved path of the root (or of `APPDATA` when the root does not exist yet).
    /// `None` means neither could be resolved, which is `Unavailable`, never a pass.
    pub resolved_root: Option<String>,
    /// P4 — `Some(true)` when our root and the host package's overlay are the same directory.
    /// `None` when there is no package family, or the overlay does not exist.
    pub overlay_is_root: Option<bool>,
    /// P4 — the overlay path compared, for the evidence string.
    pub overlay_path: Option<String>,
    /// Receipt count of the canonical ledger; `None` = present but unreadable, `Some(0)` = absent
    /// or empty.
    pub canonical_receipts: Option<usize>,
    /// Ledgers found under other packages' overlays.
    pub foreign: Vec<ForeignLedger>,
}

/// The pure decision. Order matters and is deliberate: the sandbox override wins outright (it is an
/// explicit operator choice), then everything that could make the root wrong, and only then the
/// two-nonempty-roots conflict probe — because a conflict verdict is only meaningful once we know
/// we are looking at the real canonical side.
pub(crate) fn resolve(p: &RootProbe) -> DataRootDecision {
    // Guard 5 — the one override. Yields Sandbox, which can never produce a MutationRoot.
    if let Some(o) = p.measurement_override.as_deref().filter(|s| !s.is_empty()) {
        return DataRootDecision::Sandbox {
            root: PathBuf::from(o),
        };
    }

    // Guard 4 — APPDATA unset is Unavailable. NEVER C:\Temp\Compy.
    let appdata = match p.appdata.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(a) => a,
        None => {
            return DataRootDecision::Unavailable {
                reason: "the APPDATA environment variable is not set".into(),
            }
        }
    };
    let root = PathBuf::from(appdata).join("Compy");

    // P2 — APPDATA string sanity. Guard 2: a parent that rewrote APPDATA into a package store.
    if contains_packages_segment(appdata) {
        return DataRootDecision::Redirected {
            effective: root,
            evidence: RedirectEvidence::AppDataUnderPackages {
                appdata: appdata.to_string(),
            },
        };
    }
    // …and it must be the user's own Roaming. Only checked when USERPROFILE is available; an absent
    // USERPROFILE is not treated as a failure, because P3 still measures where the path lands.
    if let Some(up) = p.userprofile.as_deref().filter(|s| !s.trim().is_empty()) {
        let expected = PathBuf::from(up).join("AppData").join("Roaming");
        if !same_path_text(appdata, &expected.to_string_lossy()) {
            return DataRootDecision::Redirected {
                effective: root,
                evidence: RedirectEvidence::AppDataNotUserRoaming {
                    appdata: appdata.to_string(),
                    expected: expected.to_string_lossy().into_owned(),
                },
            };
        }
    }

    // P3 — the decisive one. Where does the path we would actually open *land*? This is what a
    // container redirect changes and an APPDATA string check cannot see.
    let resolved = match p.resolved_root.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(r) => r,
        None => {
            return DataRootDecision::Unavailable {
                reason: format!(
                    "neither {} nor {appdata} could be resolved on disk",
                    root.display()
                ),
            }
        }
    };
    if contains_packages_segment(resolved) {
        return DataRootDecision::Redirected {
            effective: root.clone(),
            evidence: RedirectEvidence::FinalPathUnderPackages {
                requested: root.to_string_lossy().into_owned(),
                resolved: resolved.to_string(),
            },
        };
    }

    // P4 — package identity used correctly: as the key that names the one overlay worth comparing,
    // never as a verdict on its own. Inside the container these two report the same NTFS file id.
    if p.overlay_is_root == Some(true) {
        return DataRootDecision::Redirected {
            effective: root.clone(),
            evidence: RedirectEvidence::PackageOverlayIsRoot {
                family: p.package_family.clone().unwrap_or_else(|| "(unknown)".into()),
                overlay: p.overlay_path.clone().unwrap_or_else(|| "(unknown)".into()),
                root: root.to_string_lossy().into_owned(),
            },
        };
    }

    // Guard 3 — two nonempty roots halt. Only meaningful now that P2–P4 have established we are
    // looking at the real canonical side; from inside a container the canonical root is shadowed
    // and this probe would compare the overlay with itself.
    let canonical_holds = p.canonical_receipts.map(|n| n > 0).unwrap_or(true);
    let contending: Vec<ForeignLedger> = p
        .foreign
        .iter()
        .filter(|f| f.holds_receipts())
        .cloned()
        .collect();
    if canonical_holds && !contending.is_empty() {
        return DataRootDecision::Conflict {
            canonical: root,
            canonical_receipts: p.canonical_receipts,
            foreign: contending,
        };
    }

    DataRootDecision::Canonical { root }
}

fn contains_packages_segment(s: &str) -> bool {
    normalize(s).contains(PACKAGES_SEGMENT)
}

/// Lowercase, forward slashes folded to back, verbatim prefix stripped, trailing separator dropped —
/// so `\\?\C:\Users\K\AppData\Roaming` and `C:/Users/K/AppData/Roaming/` compare equal.
fn normalize(s: &str) -> String {
    let s = s.replace('/', "\\");
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
    s.trim_end_matches('\\').to_lowercase()
}

fn same_path_text(a: &str, b: &str) -> bool {
    normalize(a) == normalize(b)
}

// ---------------------------------------------------------------------------------------------
// The IO half. Everything above is pure and unit-tested; everything below touches Windows and is
// deliberately thin, so the untestable surface stays small.
// ---------------------------------------------------------------------------------------------

// Two kernel32 calls, declared by hand rather than pulling new `windows` crate features — two
// signatures, no build-surface change.
//
// * `GetCurrentPackageFamilyName` (appmodel.h) returns `APPMODEL_ERROR_NO_PACKAGE` (15700) when the
//   process has no package identity.
// * `GetFileInformationByHandle` gives the volume serial + file index, i.e. NTFS identity. The std
//   accessors for those two fields (`windows_by_handle`) are still unstable, and this resolver is
//   not a place to depend on nightly.
#[cfg(windows)]
#[repr(C)]
struct ByHandleFileInformation {
    file_attributes: u32,
    creation_time: [u32; 2],
    last_access_time: [u32; 2],
    last_write_time: [u32; 2],
    volume_serial_number: u32,
    file_size_high: u32,
    file_size_low: u32,
    number_of_links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentPackageFamilyName(length: *mut u32, name: *mut u16) -> u32;
    fn GetFileInformationByHandle(
        handle: *mut std::ffi::c_void,
        info: *mut ByHandleFileInformation,
    ) -> i32;
}

const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

/// `None` = no package identity (the normal NSIS-installed case). `Some(family)` = this process is
/// running with somebody's package identity, which is **evidence, not a verdict** — see the module
/// docs. It is used as the lookup key for P4.
#[cfg(windows)]
fn current_package_family() -> Option<String> {
    let mut len: u32 = 0;
    // First call sizes the buffer. No package ⇒ 15700, which is the common, healthy answer.
    let rc = unsafe { GetCurrentPackageFamilyName(&mut len, std::ptr::null_mut()) };
    if rc == APPMODEL_ERROR_NO_PACKAGE {
        return None;
    }
    if rc != ERROR_INSUFFICIENT_BUFFER || len == 0 {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    let rc = unsafe { GetCurrentPackageFamilyName(&mut len, buf.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

#[cfg(not(windows))]
fn current_package_family() -> Option<String> {
    None
}

/// Volume serial + file index, i.e. the NTFS identity of a directory. Two paths that report the
/// same pair are the same directory however differently they enumerate — which is exactly the
/// signature the #130 evidence captured inside the container.
#[cfg(windows)]
fn dir_identity(p: &Path) -> Option<(u32, u64)> {
    use std::os::windows::io::AsRawHandle;
    // Opening a DIRECTORY handle needs FILE_FLAG_BACKUP_SEMANTICS, which `OpenOptions` exposes
    // through the Windows extension. Read-only: the probe never creates or writes anything.
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    let f = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(p)
        .ok()?;
    let mut info: ByHandleFileInformation = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetFileInformationByHandle(f.as_raw_handle(), &mut info) };
    if ok == 0 {
        return None;
    }
    let index = ((info.file_index_high as u64) << 32) | info.file_index_low as u64;
    Some((info.volume_serial_number, index))
}

#[cfg(not(windows))]
fn dir_identity(_p: &Path) -> Option<(u32, u64)> {
    None
}

/// Receipt count of a ledger. `Some(0)` = absent or genuinely empty; `None` = present but
/// unreadable, which every caller must treat as "may hold receipts". Read-only.
fn ledger_receipts(path: &Path) -> Option<usize> {
    if !path.exists() {
        return Some(0);
    }
    let text = std::fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    parsed.as_array().map(|a| a.len())
}

/// Gather every input the decision needs. **Read-only** — this function creates no directory and
/// opens nothing for writing, which is guard 3's second half.
pub(crate) fn gather() -> RootProbe {
    let appdata = std::env::var("APPDATA").ok();
    let family = current_package_family();

    let mut p = RootProbe {
        measurement_override: std::env::var(MEASUREMENT_OVERRIDE_ENV).ok(),
        userprofile: std::env::var("USERPROFILE").ok(),
        package_family: family.clone(),
        appdata: appdata.clone(),
        ..Default::default()
    };

    let Some(appdata) = appdata.filter(|s| !s.trim().is_empty()) else {
        return p;
    };
    let root = PathBuf::from(&appdata).join("Compy");

    // P3 — canonicalize the root if it exists, otherwise its parent. `std::fs::canonicalize` is
    // `GetFinalPathNameByHandle` underneath, which is precisely the resolution a container rewrites.
    p.resolved_root = std::fs::canonicalize(&root)
        .or_else(|_| std::fs::canonicalize(&appdata).map(|d| d.join("Compy")))
        .ok()
        .map(|r| r.to_string_lossy().into_owned());

    // P4 — only when we have a family name to key on.
    if let (Some(family), Ok(local)) = (family.as_deref(), std::env::var("LOCALAPPDATA")) {
        let overlay = PathBuf::from(&local)
            .join("Packages")
            .join(family)
            .join("LocalCache")
            .join("Roaming")
            .join("Compy");
        if overlay.exists() {
            p.overlay_path = Some(overlay.to_string_lossy().into_owned());
            p.overlay_is_root = match (dir_identity(&overlay), dir_identity(&root)) {
                (Some(a), Some(b)) => Some(a == b),
                _ => Some(false),
            };
        }
    }

    p.canonical_receipts = ledger_receipts(&root.join("history.json"));

    // Conflict probe — every *other* package's Compy overlay.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let packages = PathBuf::from(local).join("Packages");
        if let Ok(entries) = std::fs::read_dir(&packages) {
            for e in entries.flatten() {
                let name = e.file_name();
                let name = name.to_string_lossy();
                // Our own host's overlay is not a "foreign" root — P4 already speaks to it, and
                // double-reporting it would turn every redirected launch into a Conflict too.
                if family.as_deref().is_some_and(|f| f == name) {
                    continue;
                }
                let ledger = e
                    .path()
                    .join("LocalCache")
                    .join("Roaming")
                    .join("Compy")
                    .join("history.json");
                if ledger.exists() {
                    p.foreign.push(ForeignLedger {
                        path: ledger.to_string_lossy().into_owned(),
                        receipts: ledger_receipts(&ledger),
                    });
                }
            }
        }
    }

    p
}

/// The capability the pre-existing rollback-contract suites need to keep calling `dispatch_rollback`
/// directly. Those tests assert that a mismatched (action, snapshot) pair is REFUSED, so the root is
/// never consulted — but the type still has to be produced, which is exactly the point. It names the
/// process's own test root (#665), not a fixed path every test process would share.
#[cfg(test)]
pub(crate) fn test_mutation_root() -> MutationRoot {
    MutationRoot::for_test(decision().effective_root())
}

/// The process-wide decision. Resolved once — a decision that could change between two calls in one
/// session would be worse than no decision at all.
#[cfg(not(test))]
pub(crate) fn decision() -> &'static DataRootDecision {
    static DECISION: OnceLock<DataRootDecision> = OnceLock::new();
    DECISION.get_or_init(|| resolve(&gather()))
}

/// Test-build decision (#665). An ordinary test process never resolves the environment: it gets a
/// fresh `Compy` root it created under the temp dir, so every read wrapper (`compy_data_dir`), the
/// gateway token and `test_mutation_root` name that one root, and no test can read or rewrite a user
/// ledger. `resolve` itself is untouched and still proven variant by variant in the guards below.
///
/// The one exception is a process libtest runs with `--ignored`, which runs ONLY the `#[ignore]`d
/// owner-present QA harnesses. Those make real Windows changes, so their receipts keep going to the
/// real ledger, where the installed app can roll them back — exactly as before.
///
/// `--include-ignored` runs both kinds in one process, and no single root serves both: the owned
/// root would strand the harnesses' rollback receipts, the real one would hand the ordinary tests
/// the user's ledger. So that process, and any command line this cannot read the way libtest does,
/// is refused here, before a root is chosen or created. Every data-root read and every gateway call
/// panics with the reason instead.
#[cfg(test)]
pub(crate) fn decision() -> &'static DataRootDecision {
    static DECISION: OnceLock<DataRootDecision> = OnceLock::new();
    DECISION
        .get_or_init(|| decide_test_root(libtest_run(std::env::args_os()), &std::env::temp_dir()))
}

/// The test-build decision for one kind of run. A refused run panics before `owned_test_root`
/// creates anything and before `gather` reads anything.
#[cfg(test)]
fn decide_test_root(run: LibtestRun, temp: &Path) -> DataRootDecision {
    match run {
        LibtestRun::Ordinary => DataRootDecision::Canonical {
            root: owned_test_root(temp),
        },
        LibtestRun::IgnoredOnly => resolve(&gather()),
        refused => panic!("{}", refused_run(refused)),
    }
}

#[cfg(test)]
fn refused_run(run: LibtestRun) -> String {
    format!(
        "this test process has no data root ({run:?}): `--include-ignored` would run the \
         owner-present live-Windows QA harnesses beside ordinary tests, and no one root serves \
         both. Run the ordinary tests without it, or only the harnesses with `--ignored`."
    )
}

/// The first statement of every `#[ignore]`d harness that files receipts (#665). Unless libtest is
/// running the ignored harnesses alone, it panics before the harness reads or changes anything, so
/// a refused run can never seed a Windows change it has no ledger to undo from.
#[cfg(test)]
pub(crate) fn require_ignored_only_run() {
    let run = libtest_run(std::env::args_os());
    assert!(run == LibtestRun::IgnoredOnly, "{}", refused_run(run));
}

/// What a test process's command line asks libtest for.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LibtestRun {
    /// No ignore flag: the ordinary tests only.
    Ordinary,
    /// `--ignored`: only the `#[ignore]`d harnesses.
    IgnoredOnly,
    /// `--include-ignored`: both at once.
    Mixed,
    /// A line libtest itself refuses (an unknown option, a missing value, a repeat, both ignore
    /// flags) or one with an argument that is not Unicode.
    Unreadable,
}

/// Reads `args` (argv[0] first) the way this toolchain's libtest does: getopts 0.2.24 over the
/// option table in `library/test/src/cli.rs`. Free arguments are name filters wherever they
/// appear. `--` ends the options, unless an option takes it as its value. An option that takes a
/// value consumes the next argument whatever it looks like, so `--skip --ignored` only skips tests
/// named like "--ignored", and `--skip -- --ignored` still asks for the ignored harnesses. Option
/// names match exactly and case-sensitively, and a one-character long name (`--q`) is the short
/// option. Values libtest rejects later, such as a bad `--color` or an unstable option on stable,
/// stop the runner before any test runs, so they are not modelled here.
#[cfg(test)]
fn libtest_run<S: AsRef<std::ffi::OsStr>>(args: impl IntoIterator<Item = S>) -> LibtestRun {
    const FLAGS: [&str; 17] = [
        "include-ignored",
        "ignored",
        "force-run-in-process",
        "exclude-should-panic",
        "test",
        "bench",
        "list",
        "fail-fast",
        "help",
        "no-capture",
        "quiet",
        "exact",
        "show-output",
        "report-time",
        "ensure-time",
        "shuffle",
        "nocapture",
    ];
    const VALUED: [&str; 6] = [
        "logfile",
        "test-threads",
        "skip",
        "color",
        "format",
        "shuffle-seed",
    ];
    // (canonical name, takes a value)
    fn short(c: char) -> Option<(&'static str, bool)> {
        match c {
            'h' => Some(("help", false)),
            'q' => Some(("quiet", false)),
            'Z' => Some(("Z", true)),
            _ => None,
        }
    }
    fn long(name: &str) -> Option<(&'static str, bool)> {
        if name.len() == 1 {
            return short(name.as_bytes()[0] as char);
        }
        let flag = FLAGS.iter().find(|f| **f == name).map(|f| (*f, false));
        flag.or_else(|| VALUED.iter().find(|v| **v == name).map(|v| (*v, true)))
    }

    let Some(args) = args
        .into_iter()
        .skip(1)
        .map(|a| a.as_ref().to_str().map(str::to_owned))
        .collect::<Option<Vec<String>>>()
    else {
        return LibtestRun::Unreadable;
    };
    let mut given: Vec<&'static str> = Vec::new();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if arg == "--" {
            break;
        }
        if arg.len() < 2 || !arg.starts_with('-') {
            continue;
        }
        // The one option this argument names, and whether its value is already attached.
        let (name, takes_value, attached) = if let Some(tail) = arg.strip_prefix("--") {
            let (name, value) = match tail.split_once('=') {
                Some((name, value)) => (name, Some(value)),
                None => (tail, None),
            };
            let Some((name, takes_value)) = long(name) else {
                return LibtestRun::Unreadable;
            };
            if value.is_some() && !takes_value {
                return LibtestRun::Unreadable;
            }
            (name, takes_value, value.is_some())
        } else {
            // A short cluster: flags until the first option that takes a value, which takes the
            // rest of the cluster or else the next argument.
            let mut valued = None;
            for (i, c) in arg.char_indices().skip(1) {
                let Some((name, takes_value)) = short(c) else {
                    return LibtestRun::Unreadable;
                };
                if takes_value {
                    valued = Some((name, i + c.len_utf8() < arg.len()));
                    break;
                }
                given.push(name);
            }
            match valued {
                Some((name, attached)) => (name, true, attached),
                None => continue,
            }
        };
        if takes_value && !attached && rest.next().is_none() {
            return LibtestRun::Unreadable;
        }
        given.push(name);
    }
    if given.iter().any(|n| *n != "skip" && given.iter().filter(|m| *m == n).count() > 1) {
        return LibtestRun::Unreadable;
    }
    match (given.contains(&"ignored"), given.contains(&"include-ignored")) {
        (false, false) => LibtestRun::Ordinary,
        (true, false) => LibtestRun::IgnoredOnly,
        (false, true) => LibtestRun::Mixed,
        (true, true) => LibtestRun::Unreadable,
    }
}

/// Create a fresh `<base>\compy-test-roots\<pid>-<nanos>-<n>\Compy` and return it. `create_dir`
/// fails on an existing directory, so two processes (or two calls) can never be handed the same
/// root. Panics rather than fall back: a test with no root of its own must not run at all. The
/// empty parent also means `migrate_legacy_data_once` finds no `Sentinel` beside it to copy.
#[cfg(test)]
fn owned_test_root(base: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let roots = base.join("compy-test-roots");
    std::fs::create_dir_all(&roots).unwrap_or_else(|e| panic!("cannot create {roots:?}: {e}"));
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    loop {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let owned = roots.join(format!("{}-{nanos}-{n}", std::process::id()));
        match std::fs::create_dir(&owned) {
            Ok(()) => {
                let root = owned.join("Compy");
                std::fs::create_dir(&root).unwrap_or_else(|e| panic!("cannot create {root:?}: {e}"));
                return root;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => panic!("cannot create {owned:?}: {e}"),
        }
    }
}

/// The capability token, or the plain-English reason there isn't one. Pure, so every variant's
/// refusal is falsifiable without a container, a rewritten environment or a second data root.
pub(crate) fn mutation_root_from(d: &DataRootDecision) -> Result<MutationRoot, String> {
    MutationRoot::from_decision(d).ok_or_else(|| {
        d.halt_reason()
            .unwrap_or_else(|| "Compy cannot verify where your data is stored.".into())
    })
}

/// The capability token for THIS process. Every mutation gateway calls this; nothing else can
/// produce a `MutationRoot` in a shipped build.
#[cfg(not(test))]
pub(crate) fn mutation_root() -> Result<MutationRoot, String> {
    mutation_root_from(decision())
}

/// Test-build escape, and the reasoning for it.
///
/// The pre-existing mutation/rollback suites drive the real gateways. Ordinary tests now do so
/// against this process's own test root (#665, see the test-build `decision`). The `--ignored`
/// owner-present QA harnesses still use the real `%APPDATA%\Compy` ledger, and this dev machine was
/// *in the `Conflict` state this module was written to detect* — 3 receipts canonically, 61 in the
/// packaged-Claude overlay (#130). With the shipped rule they would all refuse, which would replace
/// a real assertion with a tautology.
///
/// So in `#[cfg(test)]` only, the token is issued for the effective root, preserving exactly the
/// behavior those suites had before this module existed. **Release builds have no such path**, and
/// nothing here weakens what is proven: the refusal itself is falsified variant-by-variant by
/// `mutation_root_from` against synthetic decisions in the guards below, and `begin_mutation` in
/// `history.rs` is the single place every gateway obtains the token.
#[cfg(test)]
pub(crate) fn mutation_root() -> Result<MutationRoot, String> {
    Ok(MutationRoot::for_test(decision().effective_root()))
}

/// What the Settings surface and the support export show, so "which ledger am I looking at" is
/// answerable without a debugger.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct DataRootReport {
    pub decision: DataRootDecision,
    pub effective_root: String,
    pub can_mutate: bool,
    pub halt_reason: Option<String>,
    /// P1 — recorded as evidence. A family name here is NOT by itself a problem; see module docs.
    pub package_family: Option<String>,
    pub appdata: Option<String>,
    pub resolved_root: Option<String>,
    pub overlay_path: Option<String>,
    pub overlay_is_root: Option<bool>,
    pub canonical_receipts: Option<usize>,
    pub foreign_ledgers: Vec<ForeignLedger>,
}

/// One line for the support export and any "where is my data" surface: which root the app resolved
/// and whether it trusts it.
///
/// **Carries no absolute path on purpose.** A support bundle is a file the user hands to a stranger,
/// and every Windows data path embeds the account name; `support_evidence` renders the location
/// separately through its own scrubber. Receipt counts are safe and are the number that matters —
/// "3 here, 61 somewhere else" is the whole story of #130 in one line.
pub(crate) fn support_summary() -> String {
    match decision() {
        DataRootDecision::Canonical { .. } => "normal (verified)".to_string(),
        DataRootDecision::Sandbox { .. } => "measurement sandbox (override set)".to_string(),
        DataRootDecision::Redirected { evidence, .. } => {
            format!("REDIRECTED - Compy is running inside another app's container ({evidence:?}); changes are blocked")
        }
        DataRootDecision::Conflict { canonical_receipts, foreign, .. } => {
            let here = canonical_receipts.map(|n| n.to_string()).unwrap_or_else(|| "unreadable".into());
            let there: Vec<String> = foreign
                .iter()
                .map(|f| f.receipts.map(|n| n.to_string()).unwrap_or_else(|| "unreadable".into()))
                .collect();
            format!(
                "CONFLICT - two change histories: {here} recorded changes in the normal folder, {} in {} other root(s) [{}]; changes are blocked",
                there.join(" + "),
                foreign.len(),
                "nothing merged, copied or undone"
            )
        }
        DataRootDecision::Unavailable { reason } => format!("UNAVAILABLE - {reason}"),
    }
}

#[tauri::command]
pub(crate) fn get_data_root_report() -> DataRootReport {
    let probe = gather();
    let d = decision().clone();
    DataRootReport {
        effective_root: d.effective_root().to_string_lossy().into_owned(),
        can_mutate: d.is_canonical(),
        halt_reason: d.halt_reason(),
        decision: d,
        package_family: probe.package_family,
        appdata: probe.appdata,
        resolved_root: probe.resolved_root,
        overlay_path: probe.overlay_path,
        overlay_is_root: probe.overlay_is_root,
        canonical_receipts: probe.canonical_receipts,
        foreign_ledgers: probe.foreign,
    }
}

// ---------------------------------------------------------------------------------------------
// Guards. Every one of the design's six is falsified here before the resolver is trusted, plus the
// false-positive case that forced predicate 1 to be demoted.
// ---------------------------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = r"C:\Users\Kuya";
    const ROAMING: &str = r"C:\Users\Kuya\AppData\Roaming";
    const OVERLAY: &str =
        r"C:\Users\Kuya\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming";

    /// A probe that resolves clean. Each guard below breaks exactly one field of it, so a passing
    /// guard proves that field is what moved the decision.
    fn healthy() -> RootProbe {
        RootProbe {
            appdata: Some(ROAMING.into()),
            userprofile: Some(HOME.into()),
            measurement_override: None,
            package_family: None,
            resolved_root: Some(format!(r"{ROAMING}\Compy")),
            overlay_is_root: None,
            overlay_path: None,
            canonical_receipts: Some(3),
            foreign: vec![],
        }
    }

    #[test]
    fn healthy_probe_is_canonical() {
        // The control. If this ever fails, every guard below is meaningless.
        let d = resolve(&healthy());
        assert_eq!(
            d,
            DataRootDecision::Canonical {
                root: PathBuf::from(format!(r"{ROAMING}\Compy"))
            }
        );
        assert!(MutationRoot::from_decision(&d).is_some());
        assert!(d.halt_reason().is_none());
    }

    /// GUARD 1 (as corrected). Container inheritance: `APPDATA` is innocent, the *resolution* is
    /// redirected. This is the exact failure that fired on the owner's desk, and the string-only
    /// check that #129 proposed would have passed it.
    #[test]
    fn guard1_container_inheritance_is_redirected_even_though_appdata_is_correct() {
        let mut p = healthy();
        p.package_family = Some("Claude_pzs8sxrjxfjjc".into());
        p.resolved_root = Some(format!(r"{OVERLAY}\Compy"));
        let d = resolve(&p);
        assert!(
            matches!(
                d,
                DataRootDecision::Redirected {
                    evidence: RedirectEvidence::FinalPathUnderPackages { .. },
                    ..
                }
            ),
            "got {d:?}"
        );
        assert!(MutationRoot::from_decision(&d).is_none());
        // APPDATA itself was never wrong — proving the string check is not what caught it.
        assert_eq!(p.appdata.as_deref(), Some(ROAMING));
    }

    /// GUARD 1, second half — P4. Even if final-path resolution were to lie, sharing an NTFS
    /// identity with the host package's overlay is decisive.
    #[test]
    fn guard1b_overlay_sharing_our_file_id_is_redirected() {
        let mut p = healthy();
        p.package_family = Some("Claude_pzs8sxrjxfjjc".into());
        p.overlay_path = Some(format!(r"{OVERLAY}\Compy"));
        p.overlay_is_root = Some(true);
        let d = resolve(&p);
        assert!(
            matches!(
                d,
                DataRootDecision::Redirected {
                    evidence: RedirectEvidence::PackageOverlayIsRoot { .. },
                    ..
                }
            ),
            "got {d:?}"
        );
        assert!(MutationRoot::from_decision(&d).is_none());
    }

    /// The falsification that demoted predicate 1 from verdict to evidence. A Store-packaged host
    /// (Windows Terminal, Store PowerShell) hands the child package identity **without** redirecting
    /// anything. Halting here would break clean machines — a worse failure than the bug.
    #[test]
    fn package_identity_alone_does_not_halt_a_clean_machine() {
        let mut p = healthy();
        p.package_family = Some("Microsoft.PowerShell_8wekyb3d8bbwe".into());
        p.overlay_is_root = Some(false); // overlay exists but is a different directory
        p.overlay_path = Some(
            r"C:\Users\Kuya\AppData\Local\Packages\Microsoft.PowerShell_8wekyb3d8bbwe\LocalCache\Roaming\Compy"
                .into(),
        );
        let d = resolve(&p);
        assert!(d.is_canonical(), "package identity must not halt on its own: {d:?}");
        assert!(MutationRoot::from_decision(&d).is_some());
    }

    /// GUARD 2. A parent that really did rewrite `APPDATA` into a package store.
    #[test]
    fn guard2_appdata_rewritten_into_a_package_path_is_redirected() {
        let mut p = healthy();
        p.appdata = Some(OVERLAY.into());
        p.resolved_root = Some(format!(r"{OVERLAY}\Compy"));
        let d = resolve(&p);
        assert!(
            matches!(
                d,
                DataRootDecision::Redirected {
                    evidence: RedirectEvidence::AppDataUnderPackages { .. },
                    ..
                }
            ),
            "got {d:?}"
        );
        assert!(MutationRoot::from_decision(&d).is_none());
    }

    /// GUARD 2, second half. `APPDATA` pointing somewhere that is not the user's own Roaming — the
    /// generic env-tampering case, caught even when it is nowhere near a package path.
    #[test]
    fn guard2b_appdata_that_is_not_user_roaming_is_redirected() {
        let mut p = healthy();
        p.appdata = Some(r"D:\Decoy\Roaming".into());
        p.resolved_root = Some(r"D:\Decoy\Roaming\Compy".into());
        let d = resolve(&p);
        assert!(
            matches!(
                d,
                DataRootDecision::Redirected {
                    evidence: RedirectEvidence::AppDataNotUserRoaming { .. },
                    ..
                }
            ),
            "got {d:?}"
        );
    }

    /// GUARD 3. Two nonempty roots halt — the state this desk is in right now (3 canonical receipts
    /// vs 61 in the package overlay). Nothing is merged, chosen or opened for writing.
    #[test]
    fn guard3_two_nonempty_roots_conflict() {
        let mut p = healthy();
        p.canonical_receipts = Some(3);
        p.foreign = vec![ForeignLedger {
            path: format!(r"{OVERLAY}\Compy\history.json"),
            receipts: Some(61),
        }];
        let d = resolve(&p);
        match &d {
            DataRootDecision::Conflict {
                canonical_receipts,
                foreign,
                ..
            } => {
                assert_eq!(*canonical_receipts, Some(3));
                assert_eq!(foreign.len(), 1);
                assert_eq!(foreign[0].receipts, Some(61));
            }
            other => panic!("expected Conflict, got {other:?}"),
        }
        assert!(MutationRoot::from_decision(&d).is_none());
        // The halt must name both paths and both counts — a halt nobody can act on is not a halt.
        let why = d.halt_reason().expect("conflict must explain itself");
        assert!(why.contains("3 recorded changes"), "{why}");
        assert!(why.contains("61 recorded changes"), "{why}");
    }

    /// GUARD 3, corollary. An *empty* foreign root is not a conflict — otherwise a stray overlay
    /// folder with no receipts would permanently brick a healthy install.
    #[test]
    fn guard3b_empty_foreign_root_is_not_a_conflict() {
        let mut p = healthy();
        p.foreign = vec![ForeignLedger {
            path: format!(r"{OVERLAY}\Compy\history.json"),
            receipts: Some(0),
        }];
        assert!(resolve(&p).is_canonical());
    }

    /// GUARD 3, safe direction. A foreign ledger we cannot parse counts as "may hold receipts" and
    /// halts. We never assume an unreadable ledger is empty — that assumption is how history dies.
    #[test]
    fn guard3c_unreadable_foreign_root_halts() {
        let mut p = healthy();
        p.foreign = vec![ForeignLedger {
            path: format!(r"{OVERLAY}\Compy\history.json"),
            receipts: None,
        }];
        assert!(matches!(resolve(&p), DataRootDecision::Conflict { .. }));
    }

    /// GUARD 4. `APPDATA` unset is `Unavailable` — never the old silent `C:\Temp\Compy` fallback,
    /// which put the Trust Ledger on a world-shared path.
    #[test]
    fn guard4_appdata_unset_is_unavailable_never_c_temp() {
        let mut p = healthy();
        p.appdata = None;
        let d = resolve(&p);
        assert!(matches!(d, DataRootDecision::Unavailable { .. }), "got {d:?}");
        assert!(MutationRoot::from_decision(&d).is_none());
        let eff = d.effective_root().to_string_lossy().to_lowercase();
        assert!(!eff.contains(r"c:\temp"), "must never fall back to C:\\Temp: {eff}");
        assert!(
            Path::new(&d.effective_root()).is_absolute(),
            "the sentinel must be absolute so nothing lands in the process CWD"
        );
    }

    /// GUARD 4, second half. A root that exists in neither form cannot be resolved, and that is
    /// `Unavailable` — not a silent pass on the strength of the string check alone.
    #[test]
    fn guard4b_unresolvable_root_is_unavailable() {
        let mut p = healthy();
        p.resolved_root = None;
        assert!(matches!(resolve(&p), DataRootDecision::Unavailable { .. }));
    }

    /// GUARD 5. The measurement override yields `Sandbox`, and `Sandbox` cannot mutate. There is
    /// deliberately no second "and allow mutations" flag to get wrong.
    #[test]
    fn guard5_measurement_override_is_sandbox_and_cannot_mutate() {
        let mut p = healthy();
        p.measurement_override = Some(r"C:\qa\compy-sandbox".into());
        let d = resolve(&p);
        assert_eq!(
            d,
            DataRootDecision::Sandbox {
                root: PathBuf::from(r"C:\qa\compy-sandbox")
            }
        );
        assert!(MutationRoot::from_decision(&d).is_none());
        assert!(d.halt_reason().is_some());
    }

    /// GUARD 5, precedence. The override wins even over a conflicted machine — a hermetic probe
    /// must never be dragged into the real machine's recovery state. It still cannot mutate.
    #[test]
    fn guard5b_override_wins_over_conflict_and_still_cannot_mutate() {
        let mut p = healthy();
        p.measurement_override = Some(r"C:\qa\compy-sandbox".into());
        p.foreign = vec![ForeignLedger {
            path: format!(r"{OVERLAY}\Compy\history.json"),
            receipts: Some(61),
        }];
        let d = resolve(&p);
        assert!(matches!(d, DataRootDecision::Sandbox { .. }));
        assert!(MutationRoot::from_decision(&d).is_none());
    }

    #[test]
    fn path_text_comparison_is_case_and_separator_insensitive() {
        assert!(same_path_text(
            r"C:\Users\Kuya\AppData\Roaming",
            r"c:/users/kuya/appdata/roaming/"
        ));
        assert!(same_path_text(
            r"\\?\C:\Users\Kuya\AppData\Roaming",
            r"C:\Users\Kuya\AppData\Roaming"
        ));
        assert!(!same_path_text(r"C:\Users\Kuya\AppData\Roaming", r"D:\Roaming"));
    }

    #[test]
    fn packages_segment_detection_survives_verbatim_and_case() {
        assert!(contains_packages_segment(
            r"\\?\C:\Users\Kuya\AppData\Local\Packages\X\LocalCache\Roaming\Compy"
        ));
        assert!(contains_packages_segment(
            r"c:/users/kuya/APPDATA/local/PACKAGES/x/LocalCache/Roaming/Compy"
        ));
        assert!(!contains_packages_segment(
            r"C:\Users\Kuya\AppData\Roaming\Compy"
        ));
        // A folder that merely has "Packages" in its name is not a package store.
        assert!(!contains_packages_segment(
            r"C:\Users\Kuya\AppData\Roaming\Compy\Packages"
        ));
    }

    /// Every non-canonical variant must explain itself in plain English. A halt the owner cannot
    /// read is a halt he will work around.
    #[test]
    fn every_halt_variant_explains_itself() {
        let halts = [
            DataRootDecision::Sandbox {
                root: PathBuf::from(r"C:\qa"),
            },
            DataRootDecision::Redirected {
                effective: PathBuf::from(r"C:\x"),
                evidence: RedirectEvidence::FinalPathUnderPackages {
                    requested: "a".into(),
                    resolved: "b".into(),
                },
            },
            DataRootDecision::Conflict {
                canonical: PathBuf::from(r"C:\x"),
                canonical_receipts: Some(3),
                foreign: vec![ForeignLedger {
                    path: "y".into(),
                    receipts: Some(61),
                }],
            },
            DataRootDecision::Unavailable {
                reason: "APPDATA unset".into(),
            },
        ];
        for h in halts {
            let why = h.halt_reason().unwrap_or_else(|| panic!("{h:?} must explain itself"));
            assert!(why.len() > 40, "too terse to act on: {why}");
            assert!(
                !why.to_lowercase().contains("error"),
                "halt text must be plain English, not an error code: {why}"
            );
        }
    }
    /// GUARD 6 — the capability itself, variant by variant.
    ///
    /// `mutation_root()` is `#[cfg(test)]`-overridden so the pre-existing mutation suites can still
    /// drive the real gateways (the QA harnesses on a desk that was in `Conflict`, #130). That escape
    /// would be a hole if nothing else proved the refusal, so this is the proof: the pure
    /// `mutation_root_from` is the same function the shipped build calls, exercised against every
    /// decision variant without needing a container, a rewritten environment, or a second root.
    #[test]
    fn only_a_canonical_decision_yields_the_mutation_capability() {
        let canonical = DataRootDecision::Canonical {
            root: PathBuf::from(r"C:\Compy"),
        };
        let token = mutation_root_from(&canonical).expect("a verified canonical root must mutate");
        assert_eq!(token.path(), Path::new(r"C:\Compy"));

        let refused = [
            DataRootDecision::Sandbox {
                root: PathBuf::from(r"C:\qa"),
            },
            DataRootDecision::Redirected {
                effective: PathBuf::from(r"C:\x"),
                evidence: RedirectEvidence::AppDataUnderPackages {
                    appdata: "a".into(),
                },
            },
            DataRootDecision::Conflict {
                canonical: PathBuf::from(r"C:\x"),
                canonical_receipts: Some(3),
                foreign: vec![ForeignLedger {
                    path: "y".into(),
                    receipts: Some(61),
                }],
            },
            DataRootDecision::Unavailable {
                reason: "APPDATA unset".into(),
            },
        ];
        for d in refused {
            let why = mutation_root_from(&d).expect_err(&format!("{d:?} must never mutate"));
            // The refusal is what the user reads at the point their apply or rollback stops, so it
            // has to carry the reason with it - not a bare "denied".
            assert_eq!(
                Some(why.clone()),
                d.halt_reason(),
                "the refusal must be the decision's own explanation: {d:?}"
            );
        }
    }

    /// GUARD 7 (#665) — an ordinary test process never resolves the environment's data root.
    ///
    /// Before #665 this process resolved the real `%APPDATA%\Compy`, so every refused gateway call
    /// still re-saved the user's ledger through `begin_mutation`'s write-ahead canary. Reads, the
    /// gateway token and the rollback-suite token must all land on ONE fresh root that this process
    /// created under the temp dir, so no test can read or rewrite a user ledger and no two test
    /// processes can share a root.
    #[test]
    fn an_ordinary_test_process_never_resolves_the_environment_data_root() {
        let root = decision().effective_root();
        let text = normalize(&root.to_string_lossy());
        let under = |base: &str| {
            let base = normalize(base);
            text == base || text.starts_with(&format!(r"{base}\"))
        };

        // Where the environment says the user's ledger and the installed app live.
        let mut forbidden = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            forbidden.push(appdata);
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            forbidden.push(format!(r"{home}\AppData\Roaming"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            forbidden.push(format!(r"{local}\Compy"));
        }
        for base in &forbidden {
            assert!(!under(base), "a test resolved the environment's data root {base}: {root:?}");
        }

        let temp = std::env::temp_dir();
        assert!(under(&temp.to_string_lossy()), "the test root is not under the temp dir: {root:?}");
        let owner = root
            .parent()
            .and_then(Path::file_name)
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        assert!(
            owner.starts_with(&format!("{}-", std::process::id())),
            "the test root is not a directory this process created: {root:?}"
        );

        assert_eq!(crate::compy_data_dir(), root, "reads must use the gateways' root");
        let token = mutation_root().expect("the test gateway token");
        assert_eq!(token.path(), root, "the gateway token must name the test root");
        assert_eq!(test_mutation_root().path(), root, "the rollback-suite token must too");
    }

    /// GUARD 7b (#665) — every allocation is a new, empty directory under its own owner directory.
    /// Across processes the same holds because `create_dir` refuses a directory that already exists.
    #[test]
    fn every_owned_test_root_is_fresh_and_distinct() {
        let base = owned_test_root(&std::env::temp_dir());
        let a = owned_test_root(&base);
        let b = owned_test_root(&base);
        assert_ne!(a, b, "two allocations must never share a root");
        assert_ne!(a.parent(), b.parent(), "nor the directory that owns it");
        for r in [&a, &b] {
            assert!(r.ends_with("Compy") && r.starts_with(&base), "unexpected layout: {r:?}");
            assert_eq!(std::fs::read_dir(r).expect("created").count(), 0, "not fresh: {r:?}");
        }
    }

    /// GUARD 7c (#665) — the command line is read the way libtest reads it, so only a real
    /// `--ignored` run keeps the environment's root and `--include-ignored` is refused.
    ///
    /// Before R1 this was a token search: `--skip --ignored` (an ordinary run that skips one name)
    /// resolved the user's root, `-- --ignored` (a name filter) did too, and `--include-ignored`
    /// got the owned root, stranding the live harnesses' rollback receipts. Every earlier row is
    /// kept; only `--include-ignored` changes verdict, from the owned root to refused. Each row's
    /// verdict was observed on the built runner with `--list` first, which lists and never runs a
    /// test (the #665 R1 probe); `Unreadable` rows are lines that runner refused.
    #[test]
    fn the_command_line_is_read_the_way_libtest_reads_it() {
        use LibtestRun::*;
        let rows: &[(&[&str], LibtestRun)] = &[
            (&[], Ordinary),
            (&["--ignored"], IgnoredOnly),
            (&["--include-ignored"], Mixed),
            (&["--skip", "--ignored"], Ordinary),
            (&["--skip=--ignored"], Ordinary),
            (&["--skip", "--include-ignored"], Ordinary),
            (&["--skip=--include-ignored"], Ordinary),
            (&["--", "--ignored"], Ordinary),
            (&["--", "--include-ignored"], Ordinary),
            (&["--skip", "--", "--ignored"], IgnoredOnly),
            (&["--skip", "--", "--include-ignored"], Mixed),
            (&["--ignored", "--"], IgnoredOnly),
            (&["x", "--ignored"], IgnoredOnly),
            (&["--ignored", "--skip", "x"], IgnoredOnly),
            (&["--skip", "--skip", "--ignored"], IgnoredOnly),
            (&["--skip=x", "--skip", "--ignored"], Ordinary),
            (&["--logfile", "--ignored"], Ordinary),
            (&["--logfile=--include-ignored"], Ordinary),
            (&["--test-threads", "1", "--ignored"], IgnoredOnly),
            (&["--test-threads=1", "--include-ignored"], Mixed),
            (&["--nocapture", "--include-ignored"], Mixed),
            (&["--no-capture", "--ignored"], IgnoredOnly),
            (&["-q", "--ignored"], IgnoredOnly),
            (&["--q", "--ignored"], IgnoredOnly),
            (&["-", "--ignored"], IgnoredOnly),
            (&["--exact", "--ignored"], IgnoredOnly),
            (&["manual_restore_qa", "--ignored", "--nocapture"], IgnoredOnly),
            (&["manual_restore_qa", "--ignored", "--nocapture", "--test-threads=1"], IgnoredOnly),
            (&["data_root::tests::x", "--exact"], Ordinary),
            (&["--test-threads", "4"], Ordinary),
            (&["--ignored", "--ignored"], Unreadable),
            (&["--include-ignored", "--include-ignored"], Unreadable),
            (&["--ignored", "--include-ignored"], Unreadable),
            (&["--ignored=1"], Unreadable),
            (&["--include-ignored="], Unreadable),
            (&["--ign"], Unreadable),
            (&["--IGNORED"], Unreadable),
            (&["--skip"], Unreadable),
            (&["-x"], Unreadable),
            (&["---ignored"], Unreadable),
            (&["-qq", "--ignored"], Unreadable),
            (&["-q", "--quiet"], Unreadable),
        ];
        let wrong: Vec<String> = rows
            .iter()
            .filter_map(|(args, want)| {
                let got = libtest_run(std::iter::once("compy_lib.exe").chain(args.iter().copied()));
                (got != *want).then(|| format!("{args:?}: want {want:?}, got {got:?}"))
            })
            .collect();
        assert!(wrong.is_empty(), "misread command lines:\n{}", wrong.join("\n"));

        // argv[0] is the program, never an option; an empty argv is an ordinary run.
        assert_eq!(libtest_run(["--ignored"]), Ordinary);
        assert_eq!(libtest_run(["--include-ignored", "--ignored"]), IgnoredOnly);
        assert_eq!(libtest_run(std::iter::empty::<&str>()), Ordinary);
        // getopts refuses an argument that is not Unicode, wherever it sits.
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            let bad = std::ffi::OsString::from_wide(&[0xD800]);
            let argv = |a: &[std::ffi::OsString]| {
                let program = std::ffi::OsString::from("compy_lib.exe");
                libtest_run(std::iter::once(program).chain(a.iter().cloned()))
            };
            assert_eq!(argv(std::slice::from_ref(&bad)), Unreadable);
            assert_eq!(argv(&["--skip".into(), bad]), Unreadable);
        }
    }

    /// GUARD 7d (#665) — a mixed or unreadable run is refused before any root exists: nothing is
    /// created under the temp dir it was handed. (The environment branch is not exercised here; it
    /// is the untouched `resolve(&gather())` that guards 1–6 prove.)
    #[test]
    fn a_mixed_or_unreadable_run_is_refused_before_any_root_exists() {
        for run in [LibtestRun::Mixed, LibtestRun::Unreadable] {
            let temp = owned_test_root(&std::env::temp_dir());
            let refused = std::panic::catch_unwind(|| decide_test_root(run, &temp));
            let why = refused.expect_err(&format!("{run:?} must be refused"));
            let why = why
                .downcast_ref::<String>()
                .cloned()
                .unwrap_or_default();
            assert!(why.contains("--include-ignored"), "the refusal must say why: {why:?}");
            assert_eq!(
                std::fs::read_dir(&temp).expect("temp").count(),
                0,
                "{run:?} created a root before refusing"
            );
        }
        let temp = owned_test_root(&std::env::temp_dir());
        let ordinary = decide_test_root(LibtestRun::Ordinary, &temp);
        assert!(ordinary.effective_root().starts_with(&temp), "ordinary runs get an owned root");
    }

    /// GUARD 7e (#665) — the live-harness precondition refuses a process that is not running the
    /// ignored harnesses alone. This ordinary test process is one.
    #[test]
    #[should_panic(expected = "--include-ignored")]
    fn the_live_harness_precondition_refuses_an_ordinary_process() {
        require_ignored_only_run();
    }

    /// GUARD 7f (#665) — a refused run stops before any receipt-filing harness changes Windows.
    ///
    /// `decision()` refuses, so a harness is safe if the first thing it does reaches the data root
    /// or checks the run itself. The `history.rs` harnesses file ledger receipts and open with
    /// `require_ignored_only_run()`. The `gaming_orchestrator.rs` harnesses keep their session
    /// contract under the data root and open with `require_clean()`, which reads it through
    /// `compy_data_dir()`. This pins both, so a new harness that seeds before either fails here.
    /// The `actions.rs` harnesses file no receipt or contract, so the root cannot strand one.
    #[test]
    fn every_receipt_filing_harness_checks_the_run_before_changing_windows() {
        let history = include_str!("history.rs");
        let go = include_str!("gaming_orchestrator.rs");
        for (file, source, opening) in [
            ("history.rs", history, "crate::data_root::require_ignored_only_run();"),
            ("gaming_orchestrator.rs", go, "require_clean();"),
        ] {
            let harnesses = ignored_harness_openings(source);
            assert!(!harnesses.is_empty(), "no #[ignore] harness found in {file}");
            for (name, first) in harnesses {
                assert_eq!(first, opening, "{file}: `{name}` must open with `{opening}`");
            }
        }
        let require_clean = &go[go.find("fn require_clean()").expect("require_clean")..];
        let body = &require_clean[..require_clean.find("\n    }").expect("its body")];
        assert!(body.contains("load_session()"), "require_clean must read the session file");
        let gs = include_str!("gaming_session.rs");
        assert!(
            gs.contains("std::fs::read_to_string(session_path())"),
            "load_session must read the session path"
        );
        let qa = &go[go.find("mod gaming_mode_qa {").expect("the live QA module")..];
        assert!(
            !qa.contains("SessionDirOverride"),
            "a harness that moved the session dir off the data root would skip the refusal"
        );
    }

    /// Each `#[ignore]`d test's name and first statement, skipping `use` statements and comments.
    fn ignored_harness_openings(source: &str) -> Vec<(String, String)> {
        let lines: Vec<&str> = source.lines().collect();
        let mut found = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            if !line.trim_start().starts_with("#[ignore") {
                continue;
            }
            let is_fn = |l: &&str| l.trim_start().starts_with("fn ");
            let Some(sig) = lines[i + 1..].iter().position(is_fn) else {
                continue;
            };
            let sig = i + 1 + sig;
            let signature = &lines[sig].trim_start()[3..];
            let name = signature.split('(').next().unwrap_or_default().to_string();
            // A `use` may span lines; its last line ends the statement with `;`.
            let mut in_use = false;
            let first = lines[sig + 1..]
                .iter()
                .map(|l| l.trim())
                .find(|l| {
                    if in_use || l.starts_with("use ") {
                        in_use = !l.ends_with(';');
                        return false;
                    }
                    !l.is_empty() && !l.starts_with("//")
                })
                .unwrap_or_default()
                .to_string();
            found.push((name, first));
        }
        found
    }
}
