//! The inventory of everything Compy stores on this PC. DATA ONLY: no command, no deletion, no I/O.
//!
//! Three things need one complete, true list of what Compy keeps: a "Clear my data" feature, the
//! privacy policy, and a first-launch notice. Before this module nothing guaranteed such a list
//! stayed complete; a new store could be added in one file and silently missed everywhere else.
//!
//! This table is the list. It is kept honest by `scripts/data-root-guard.test.mjs`, which reads THIS
//! FILE as text and checks it against the rest of `src-tauri/src` in both directions. First, every
//! file or folder name Compy's production code composes onto the data root, or spells as a Compy
//! file name (`*.json`, `*.receipts`, ...), must be covered by a row here, and a new name with no
//! row fails the test with a message that says what to add. Second, every row must still be written
//! or read by at least one of the modules it names, so a stale row cannot hide behind a deleted
//! feature. Third, every `compy_*` browser-storage key in `src/` must be in `WEBVIEW_KEYS`.
//!
//! The guard parses the rows by their field names, so keep one `InventoryRow { .. }` per entry and do
//! not build rows with macros or helper functions.
//!
//! Path notation (the guard and the Rust tests both rely on it): paths are relative to `base`,
//! written with `/` as the separator; `<name>` marks a part that varies (a timestamp, a process id).
//! The `<store>` placeholder means "any of the stores named in `contains`".
//!
//! What this table does NOT claim: that nothing else exists. It lists what the code writes. Windows'
//! own records that the Black Box reads (event log, error reports, crash dumps) are not Compy's data
//! and have no row. `data_root.rs` also READS the ledger of other packages' overlay folders
//! (`%LOCALAPPDATA%\Packages\...\Compy\history.json`) to detect a split root; Compy never writes
//! there, so there is no row for it.
//!
//! Companion cites (file:line for every row, and every difference from the design, `PRIVACY.md` and
//! the legal list): `C:\Users\Kuya\code\_train\d4i-inventory.md` (the working copy of the slice).

#![allow(dead_code)] // D4-1 ships the table and its guard only; the clear commands (D4-2, D4-3) and the settings screen (D4-4) are the first readers.

/// Where a row's `path` starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Base {
    /// `%APPDATA%\Compy`, the data root (`data_root.rs`, read through `compy_data_dir()`).
    DataRoot,
    /// `%APPDATA%`, beside the data root (the legacy `Sentinel` folder, the migration staging folder,
    /// and the window-state folder `gg.compy.app`).
    AppData,
    /// `%LOCALAPPDATA%` (the WebView2 profile, and the per-user install folder `Compy`).
    LocalAppData,
    /// The Windows temp folder (`%TEMP%`).
    Temp,
    /// A place Compy's own code does not name. Only for rows with a non-empty `unresolved` reason.
    Unresolved,
}

/// What a later slice needs to know about a row. Maps onto the design's purpose codes
/// (`d4-clear-data-design.md` section 1): Undo = U, PlayHistory + HardwareFacts = B/R, Support = R,
/// Choices = S, Cache = C, Transient = T, SetAside = D.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Category {
    /// Needed to undo changes Compy applied to Windows. The ledger family and the live Gaming Mode
    /// session contract. Never deleted while a change is applied.
    Undo,
    /// Measured play history and the comparisons made against it (sessions, Trials, benchmarks,
    /// noise floors, drift, crash observations).
    PlayHistory,
    /// Facts about this PC's hardware and drivers that Compy compares against later.
    HardwareFacts,
    /// Support and diagnostics: the support record and reports the user saved.
    Support,
    /// A cache Compy rebuilds or re-downloads. Safe to delete.
    Cache,
    /// Text the user typed or pasted (a feedback note, text pasted into the autopsy, parts the user
    /// added by hand).
    UserText,
    /// Owned by Microsoft Edge WebView2 (the window's browser storage). Compy cannot delete the
    /// folder while the app runs; it clears what the page owns.
    WebView,
    /// A choice the user made or something the user bought: dismissed items, the sharing consent,
    /// the licence, appearance settings, window position.
    Choices,
    /// A working file that exists only while an operation runs, or a crash leftover.
    Transient,
    /// A damaged copy Compy set aside instead of deleting.
    SetAside,
    /// Written by an older build of Compy (the pre-rename `Sentinel` folder). Compy only copies from it.
    Legacy,
}

/// Kinds of personal data a row can hold. An empty list means none known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Personal {
    /// Names of games or programs (executable names, "X starting" notes, a crash's app name).
    ProgramNames,
    /// File or folder paths (a command line, an install folder).
    Paths,
    /// Text the user typed or pasted.
    UserText,
    /// This PC's hardware: GPU model, driver version, RAM size, display mode.
    HardwareSpecs,
    /// Something tied to a purchase (a one-way hash of the buyer's email, tier and dates).
    PurchaseDetail,
}

/// Whether a sandbox data root (`COMPY_MEASUREMENT_DATA_ROOT`, `data_root.rs`) redirects the row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SandboxEffect {
    /// Written through `compy_data_dir()`, the effective root: a sandbox root receives it instead.
    Follows,
    /// Written only through a `MutationRoot`, which only a verified canonical root can produce: under
    /// a sandbox, a redirected or a conflicted root Compy writes nothing here at all.
    CanonicalOnly,
    /// Not under the data root, so no data-root decision moves it.
    NotRedirected,
}

/// One file, folder or name pattern Compy writes (or, for the user-created and legacy rows, reads).
#[derive(Debug, Clone, Copy)]
pub(crate) struct InventoryRow {
    /// Stable id. Rows of the ledger family start with `ledger-` (the design deletes them in a fixed
    /// order, `.bak` before `history.json`).
    pub(crate) id: &'static str,
    pub(crate) base: Base,
    /// Relative to `base`, `/` separated, `<name>` for a varying part. See the module doc.
    pub(crate) path: &'static str,
    /// The modules (file names under `src-tauri/src`) that write the row. The guard requires the row
    /// to be spelled in at least one of them.
    pub(crate) writers: &'static [&'static str],
    pub(crate) category: Category,
    pub(crate) personal: &'static [Personal],
    /// What the file holds, in plain words.
    pub(crate) contains: &'static str,
    /// How and when it comes to exist.
    pub(crate) created: &'static str,
    pub(crate) sandbox: SandboxEffect,
    /// Extra spellings, exactly as the code writes them (`{}` for a format argument), for names the
    /// row's `path` does not spell the same way (a helper that appends `.tmp` to a caller's path).
    pub(crate) names_in_code: &'static [&'static str],
    /// A token that must appear in a writer's production code when the row has no name literal (a
    /// plugin or the WebView runtime creates the file). Empty when a name literal is enough.
    pub(crate) proof: &'static str,
    /// Non-empty when the location cannot be determined from Compy's code: the reason.
    pub(crate) unresolved: &'static str,
}

/// One browser-storage key the page keeps in the WebView profile. `local` keys survive a restart;
/// `session` keys last only while the window's page session lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StorageKind {
    Local,
    Session,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct WebviewKey {
    pub(crate) key: &'static str,
    pub(crate) kind: StorageKind,
    pub(crate) category: Category,
    pub(crate) personal: &'static [Personal],
    pub(crate) holds: &'static str,
}

pub(crate) fn rows() -> &'static [InventoryRow] {
    INVENTORY
}

pub(crate) fn rows_in(category: Category) -> impl Iterator<Item = &'static InventoryRow> {
    INVENTORY.iter().filter(move |r| r.category == category)
}

/// The ledger family: every `history.json*` name. The design's clear removes these in order, backup
/// first, and refuses while any change is applied.
pub(crate) fn ledger_family() -> impl Iterator<Item = &'static InventoryRow> {
    INVENTORY.iter().filter(|r| r.id.starts_with("ledger-"))
}

pub(crate) fn webview_keys() -> &'static [WebviewKey] {
    WEBVIEW_KEYS
}

use Base::{AppData, DataRoot, LocalAppData, Temp, Unresolved};
use Category::{
    Cache, Choices, HardwareFacts, Legacy, PlayHistory, SetAside, Support, Transient, Undo, WebView,
};
use Personal::{HardwareSpecs, Paths, ProgramNames, PurchaseDetail};
use SandboxEffect::{CanonicalOnly, Follows, NotRedirected};
use StorageKind::{Local, Session};

/// Every row. Order: the undo records first, then the measured stores, support, choices, caches,
/// working files, set-aside copies, then everything outside the data root.
pub(crate) static INVENTORY: &[InventoryRow] = &[
    // ---- Undo: the ledger family (history.rs) -------------------------------------------------
    InventoryRow {
        id: "ledger-main",
        base: DataRoot,
        path: "history.json",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "The Trust Ledger: every change Compy applied to Windows, with the value the setting had before, how to undo it, when, and a short label of this PC's hardware. The only record that can undo a change.",
        created: "when the first change is applied",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-backup",
        base: DataRoot,
        path: "history.json.bak",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "One backup copy of the ledger, byte for byte. If the ledger goes missing or damaged Compy restores it from here.",
        created: "after each ledger save, and once at every start",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-restored-note",
        base: DataRoot,
        path: "history.json.restored",
        writers: &["history.rs"],
        category: Undo,
        personal: &[],
        contains: "One line saying when and why the ledger was restored from its backup.",
        created: "when a restore happens",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-corrupt",
        base: DataRoot,
        path: "history.json.corrupt",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "A damaged ledger set aside byte for byte. It may hold the only undo record for a change still on.",
        created: "when the ledger cannot be read",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-corrupt-stamped",
        base: DataRoot,
        path: "history.json.corrupt.<secs>",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "An earlier damaged ledger kept when a newer one is set aside, named by the time it was moved.",
        created: "when a second damaged ledger is set aside",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-corrupt-stamped-n",
        base: DataRoot,
        path: "history.json.corrupt.<secs>-<n>",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "As above, with a counter when two were moved in the same second.",
        created: "when a third or later damaged ledger is set aside",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-backup-corrupt",
        base: DataRoot,
        path: "history.json.bak.corrupt",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "A damaged backup copy of the ledger, set aside.",
        created: "when the backup cannot be read",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-backup-corrupt-n",
        base: DataRoot,
        path: "history.json.bak.corrupt.<n>",
        writers: &["history.rs"],
        category: Undo,
        personal: &[HardwareSpecs],
        contains: "As above, numbered when one already sits there.",
        created: "when a second damaged backup is set aside",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-tmp",
        base: DataRoot,
        path: "history.json.tmp",
        writers: &["history.rs"],
        category: Transient,
        personal: &[HardwareSpecs],
        contains: "The new ledger being written; renamed over the real one when complete. A crash can leave it behind.",
        created: "during every ledger save",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-backup-tmp",
        base: DataRoot,
        path: "history.json.bak.tmp",
        writers: &["history.rs"],
        category: Transient,
        personal: &[HardwareSpecs],
        contains: "The backup copy being written; renamed into place when complete.",
        created: "during every backup refresh",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-restored-tmp",
        base: DataRoot,
        path: "history.json.restored.tmp",
        writers: &["history.rs"],
        category: Transient,
        personal: &[],
        contains: "The restore note being written.",
        created: "during a restore",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "ledger-restore-tmp",
        base: DataRoot,
        path: "history.json.restore.tmp",
        writers: &["history.rs"],
        category: Transient,
        personal: &[HardwareSpecs],
        contains: "The ledger being rebuilt from the backup; renamed into place when complete.",
        created: "during a restore",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Undo: Gaming Mode session contract (gaming_session.rs) -------------------------------
    InventoryRow {
        id: "gaming-session",
        base: DataRoot,
        path: "gaming-session.json",
        writers: &["gaming_session.rs"],
        category: Undo,
        personal: &[],
        contains: "The live Gaming Mode session: which temporary changes were made and exactly how to restore each. Present only while a session is on, or was left unfinished.",
        created: "when Gaming Mode starts",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "gaming-session-orphaned",
        base: DataRoot,
        path: "gaming-session.orphaned.json",
        writers: &["gaming_session.rs"],
        category: SetAside,
        personal: &[],
        contains: "A Gaming Mode session contract that could not be read, set aside.",
        created: "when an unreadable session file is found",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "gaming-session-orphaned-n",
        base: DataRoot,
        path: "gaming-session.orphaned-<n>.json",
        writers: &["gaming_session.rs"],
        category: SetAside,
        personal: &[],
        contains: "As above, numbered when one already sits there.",
        created: "when a second unreadable session file is found",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Measured play history and comparisons ------------------------------------------------
    InventoryRow {
        id: "sessions",
        base: DataRoot,
        path: "sessions.json",
        writers: &["sessions.rs"],
        category: PlayHistory,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "Up to 100 monitoring sessions: the game or app executable name, start time and length, FPS, frametime and 1% lows, peak temperatures and usage, per-second stutter timeline and events (including notes of which programs started during the session), and the hardware label.",
        created: "when the first monitoring session ends",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "experiments",
        base: DataRoot,
        path: "experiments.json",
        writers: &["experiment.rs"],
        category: PlayHistory,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "Trial records: each before/after test of a change, for which game, with the measured results and a link to the ledger row it justified.",
        created: "when the first Trial is started",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "benchmark",
        base: DataRoot,
        path: "benchmark.json",
        writers: &["benchmark.rs"],
        category: PlayHistory,
        personal: &[HardwareSpecs],
        contains: "Benchmark results and the baseline Compy compares a new run against.",
        created: "when the first benchmark finishes",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "scoreboard",
        base: DataRoot,
        path: "scoreboard.json",
        writers: &["benchmark_scoreboard.rs"],
        category: PlayHistory,
        personal: &[ProgramNames],
        contains: "The scoreboard of measured wins: what was measured to improve, and by how much.",
        created: "when the first measured result is recorded",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "noise-floors",
        base: DataRoot,
        path: "noise_floors.json",
        writers: &["noise_floor.rs"],
        category: PlayHistory,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "For each game, how much its results vary from one run to the next on this PC.",
        created: "when a noise-floor calibration finishes",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "comparison-armed",
        base: DataRoot,
        path: "compy_comparison.json",
        writers: &["comparison.rs"],
        category: PlayHistory,
        personal: &[ProgramNames],
        contains: "A before/after comparison that is armed and waiting for the next play session.",
        created: "when a comparison is armed",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "comparison-result",
        base: DataRoot,
        path: "compy_comparison_result.json",
        writers: &["comparison.rs"],
        category: PlayHistory,
        personal: &[ProgramNames],
        contains: "The result of the last before/after comparison.",
        created: "when an armed comparison completes",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "drift",
        base: DataRoot,
        path: "drift.json",
        writers: &["drift.rs"],
        category: PlayHistory,
        personal: &[],
        contains: "Which of Compy's checks were last good and when a drift was first noticed.",
        created: "when the first drift check runs",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "incident-observer",
        base: DataRoot,
        path: "care/incident-observer.json",
        writers: &["incident_observer.rs"],
        category: PlayHistory,
        personal: &[ProgramNames],
        contains: "Crashes and freezes Compy noticed in Windows' records, and the time up to which it has already looked.",
        created: "when the first incident scan runs",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "incident-observer-corrupt",
        base: DataRoot,
        path: "care/incident-observer.corrupt.json",
        writers: &["incident_observer.rs"],
        category: SetAside,
        personal: &[ProgramNames],
        contains: "An incident file this build could not read, set aside. Only the first one is kept.",
        created: "when the incident file cannot be read",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "incident-observer-tmp",
        base: DataRoot,
        path: "care/incident-observer.<pid>.<n>.json.tmp",
        writers: &["incident_observer.rs"],
        category: Transient,
        personal: &[ProgramNames],
        contains: "The incident file being written; renamed into place when complete.",
        created: "during every save of the incident file",
        sandbox: Follows,
        names_in_code: &["{}.{}.json.tmp"],
        proof: "",
        unresolved: "",
    },
    // ---- Hardware facts -----------------------------------------------------------------------
    InventoryRow {
        id: "hardware-fingerprint",
        base: DataRoot,
        path: "hardware-fingerprint.json",
        writers: &["hwchange.rs"],
        category: HardwareFacts,
        personal: &[HardwareSpecs],
        contains: "The hardware Compy last saw (GPU models, RAM size and similar), so it can say \"your hardware changed\".",
        created: "at the first hardware scan",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "intelligence",
        base: DataRoot,
        path: "intelligence.json",
        writers: &["intelligence.rs"],
        category: HardwareFacts,
        personal: &[HardwareSpecs],
        contains: "A timeline of this PC's identity (driver versions, Windows build, power plan) used to answer \"what changed\".",
        created: "when the first identity snapshot is saved",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Support and diagnostics --------------------------------------------------------------
    InventoryRow {
        id: "support-evidence",
        base: DataRoot,
        path: "support/evidence.jsonl",
        writers: &["support_evidence.rs"],
        category: Support,
        personal: &[ProgramNames],
        contains: "The support record: a rolling log of up to 400 entries of what Compy itself did (starts, ledger reads and writes, helper starts, whether each apply or undo worked), with user names, paths, addresses, keys and serials replaced as it is written.",
        created: "at the first recorded event (the app start)",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "support-evidence-tmp",
        base: DataRoot,
        path: "support/evidence.jsonl.tmp",
        writers: &["support_evidence.rs"],
        category: Transient,
        personal: &[ProgramNames],
        contains: "The support record being rewritten; renamed into place when complete.",
        created: "during every support-record rewrite",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "export-report-md",
        base: DataRoot,
        path: "exports/compy-report-<stamp>.md",
        writers: &["export.rs"],
        category: Support,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "A readable report the user saved: hardware, recommendations, ledger, readiness, recent sessions with game executable names, diagnostics. Never pruned.",
        created: "when the user exports a report",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "export-report-plain-md",
        base: DataRoot,
        path: "exports/compy-report-plain-<stamp>.md",
        writers: &["export.rs"],
        category: Support,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "The plain-language version of the saved report.",
        created: "when the user exports the plain report",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "export-report-json",
        base: DataRoot,
        path: "exports/compy-report-<stamp>.json",
        writers: &["export.rs"],
        category: Support,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "The same report as data, with the machine's host name removed.",
        created: "when the user exports a report",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "export-support-md",
        base: DataRoot,
        path: "exports/compy-support-<projection>-<stamp>.md",
        writers: &["support_evidence.rs"],
        category: Support,
        personal: &[ProgramNames],
        contains: "The support record exported as readable text, redacted a second time.",
        created: "when the user exports the support record",
        sandbox: Follows,
        names_in_code: &["{base}.md"],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "export-support-json",
        base: DataRoot,
        path: "exports/compy-support-<projection>-<stamp>.json",
        writers: &["support_evidence.rs"],
        category: Support,
        personal: &[ProgramNames],
        contains: "The support record exported as data, redacted a second time.",
        created: "when the user exports the support record",
        sandbox: Follows,
        names_in_code: &["{base}.json"],
        proof: "",
        unresolved: "",
    },
    // ---- Choices the user made ----------------------------------------------------------------
    InventoryRow {
        id: "readiness-dismissals",
        base: DataRoot,
        path: "readiness_dismissals.json",
        writers: &["readiness.rs"],
        category: Choices,
        personal: &[],
        contains: "The readiness items the user dismissed.",
        created: "when the first item is dismissed",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "receipts-consent",
        base: DataRoot,
        path: "receipts-consent.json",
        writers: &["receipts.rs"],
        category: Choices,
        personal: &[],
        contains: "The user's choice about sharing anonymous results (default off; a missing file means off).",
        created: "when the user first answers the sharing question",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "license",
        base: DataRoot,
        path: "license.key",
        writers: &["license.rs"],
        category: Choices,
        personal: &[PurchaseDetail],
        contains: "The purchased licence: a signed token with a one-way hash of the buyer's email, the tier and the issue and expiry dates.",
        created: "when a licence is saved (only after a purchase)",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "case-fetch-disabled",
        base: DataRoot,
        path: "case-intelligence/fetch-disabled",
        writers: &["case_intelligence.rs"],
        category: Choices,
        personal: &[],
        contains: "An empty marker the user can create to switch the signed catalog download off. Compy only looks for it.",
        created: "never by Compy; only if the user creates it",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Caches Compy rebuilds ----------------------------------------------------------------
    InventoryRow {
        id: "case-catalog",
        base: DataRoot,
        path: "case-intelligence/last-known-good.json",
        writers: &["case_intelligence.rs"],
        category: Cache,
        personal: &[],
        contains: "The last verified copy of the signed advisory catalog (Tier 1 download, no machine data sent).",
        created: "after a verified catalog download",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "case-catalog-tmp",
        base: DataRoot,
        path: "case-intelligence/last-known-good.json.tmp",
        writers: &["case_intelligence.rs"],
        category: Transient,
        personal: &[],
        contains: "The catalog being stored; renamed into place when complete.",
        created: "during a catalog store",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "rules-manifest",
        base: DataRoot,
        path: "cached-manifest.json",
        writers: &["remote_rules.rs"],
        category: Cache,
        personal: &[],
        contains: "The signed rules manifest cache. The signed-rules feature is switched off in every build, so this is not written today.",
        created: "only if signed rules are ever switched on",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "rules-body",
        base: DataRoot,
        path: "cached-rules.json",
        writers: &["remote_rules.rs"],
        category: Cache,
        personal: &[],
        contains: "The signed rules cache (off in every build today).",
        created: "only if signed rules are ever switched on",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "rules-version",
        base: DataRoot,
        path: "last-seen-ruleset-version.txt",
        writers: &["remote_rules.rs"],
        category: Cache,
        personal: &[],
        contains: "The newest rules version seen (off in every build today).",
        created: "only if signed rules are ever switched on",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Working files: the elevated helper and capture ---------------------------------------
    InventoryRow {
        id: "elevation-batch-receipts",
        base: DataRoot,
        path: "elevation-batch-<ms>.receipts",
        writers: &["history.rs"],
        category: Transient,
        personal: &[],
        contains: "What the elevated helper reports for one batch of changes (a line per item). Read once, then deleted.",
        created: "while a batch of changes runs elevated",
        sandbox: CanonicalOnly,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "gaming-elevation-receipts",
        base: DataRoot,
        path: "gaming-elevation-<id>.receipts",
        writers: &["gaming_orchestrator.rs"],
        category: Transient,
        personal: &[],
        contains: "What the elevated helper reports when Gaming Mode starts. Read once, then deleted.",
        created: "while Gaming Mode starts",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "gaming-restore-receipts",
        base: DataRoot,
        path: "gaming-restore-<id>.receipts",
        writers: &["gaming_orchestrator.rs"],
        category: Transient,
        personal: &[],
        contains: "What the elevated helper reports when Gaming Mode restores. Read once, then deleted.",
        created: "while Gaming Mode ends",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "memcompress-result",
        base: DataRoot,
        path: "memcompress-restore-<ms>.result",
        writers: &["actions.rs"],
        category: Transient,
        personal: &[],
        contains: "The elevated helper's result when undoing the memory-compression change. Read once, then deleted.",
        created: "while that one undo runs",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "elevation-ticket",
        base: DataRoot,
        path: "runtime/elev-<pid>-<n>.ticket",
        writers: &["actions.rs"],
        category: Transient,
        personal: &[],
        contains: "A one-time ticket holding the encoded command for one elevated launch. Deleted when the helper has used it.",
        created: "at each elevated launch",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "fps-report",
        base: DataRoot,
        path: "runtime/fps.json",
        writers: &["monitoring.rs", "fps.rs"],
        category: Transient,
        personal: &[ProgramNames],
        contains: "The live FPS report the capture helper hands to the app: the game's process name and id, FPS and frametimes.",
        created: "while FPS capture runs",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "fps-report-tmp",
        base: DataRoot,
        path: "runtime/fps.json.tmp",
        writers: &["fps.rs"],
        category: Transient,
        personal: &[ProgramNames],
        contains: "The FPS report being written by the capture helper; renamed into place.",
        created: "while FPS capture runs",
        sandbox: Follows,
        names_in_code: &["{path}.tmp"],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "fps-alive",
        base: DataRoot,
        path: "runtime/fps.alive",
        writers: &["monitoring.rs"],
        category: Transient,
        personal: &[],
        contains: "A heartbeat file refreshed every second so the capture helper knows the app is still there.",
        created: "while FPS capture runs",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Working files and set-aside copies shared by several stores --------------------------
    InventoryRow {
        id: "store-json-tmp",
        base: DataRoot,
        path: "<store>.json.tmp",
        writers: &[
            "benchmark_scoreboard.rs",
            "experiment.rs",
            "intelligence.rs",
            "receipts.rs",
            "sessions.rs",
            "gaming_session.rs",
        ],
        category: Transient,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "A store being rewritten (scoreboard, experiments, intelligence, receipts-consent, sessions, gaming-session); renamed into place when complete. A crash can leave it behind.",
        created: "during every save of those stores",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "atomic-tmp",
        base: DataRoot,
        path: ".<file>.<pid>-<seq>.tmp",
        writers: &["atomic_write.rs"],
        category: Transient,
        personal: &[ProgramNames, PurchaseDetail],
        contains: "A hidden temporary copy beside a file being replaced safely (benchmark, comparison, drift, noise floors, readiness dismissals, licence). Renamed into place when complete.",
        created: "during every save of those files",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "store-corrupt",
        base: DataRoot,
        path: "<store>.json.corrupt",
        writers: &["atomic_write.rs"],
        category: SetAside,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "A damaged store set aside byte for byte (sessions, scoreboard, experiments, intelligence, noise floors).",
        created: "when that store cannot be read",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "store-corrupt-stamped",
        base: DataRoot,
        path: "<store>.json.corrupt.<secs>",
        writers: &["atomic_write.rs"],
        category: SetAside,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "An earlier damaged copy of the same store, kept when a newer one is set aside.",
        created: "when a second damaged copy is set aside",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "store-corrupt-stamped-n",
        base: DataRoot,
        path: "<store>.json.corrupt.<secs>-<n>",
        writers: &["atomic_write.rs"],
        category: SetAside,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "As above, with a counter when several were moved in the same second.",
        created: "when a third or later damaged copy is set aside",
        sandbox: Follows,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    // ---- Beside the data root ------------------------------------------------------------------
    InventoryRow {
        id: "legacy-sentinel-folder",
        base: AppData,
        path: "Sentinel",
        writers: &["lib.rs"],
        category: Legacy,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "The folder an older build, before the rename to Compy, kept its data in: an older ledger, sessions and exports. Compy never writes or deletes it; it COPIES it into the Compy folder once, only when the Compy folder does not exist.",
        created: "by the pre-rename build, not by this one",
        sandbox: NotRedirected,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "migration-staging",
        base: AppData,
        path: "Compy.migrating",
        writers: &["lib.rs"],
        category: Transient,
        personal: &[ProgramNames, HardwareSpecs],
        contains: "A staging copy made during the one-time move from the Sentinel folder; renamed to Compy when complete, removed if the copy fails.",
        created: "during the one-time migration only",
        sandbox: NotRedirected,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "window-state",
        base: AppData,
        path: "gg.compy.app/.window-state.json",
        writers: &["lib.rs"],
        category: Choices,
        personal: &[],
        contains: "The window's size and position, kept by the window-state plugin.",
        created: "when the window is closed or moved",
        sandbox: NotRedirected,
        names_in_code: &[],
        proof: "tauri_plugin_window_state",
        unresolved: "",
    },
    InventoryRow {
        id: "webview-profile",
        base: LocalAppData,
        path: "gg.compy.app/EBWebView",
        writers: &["lib.rs"],
        category: WebView,
        personal: &[ProgramNames, Personal::UserText],
        contains: "Microsoft Edge WebView2's profile for the app window: the page's local and session storage (the keys listed in WEBVIEW_KEYS), plus the browser cache and the browser's own records. The folder is chosen by Tauri from the app identifier `gg.compy.app` in tauri.conf.json, not named in Compy's code; the design observed it on the owner's PC. Compy cannot delete it while the app runs.",
        created: "at the first window launch",
        sandbox: NotRedirected,
        names_in_code: &[],
        proof: "tauri::Builder",
        unresolved: "",
    },
    InventoryRow {
        id: "launch-debug-log",
        base: LocalAppData,
        path: "Compy/launch-debug.log",
        writers: &["main.rs"],
        category: Support,
        personal: &[Paths],
        contains: "A line per launch with the command-line arguments. Written by DEBUG builds only (never by a release build), into the per-user install folder.",
        created: "at each launch of a debug build",
        sandbox: NotRedirected,
        names_in_code: &["{dir}\\\\launch-debug.log"],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "disk-bench-file",
        base: Temp,
        path: "compy_bench_<pid>_<n>.tmp",
        writers: &["benchmark.rs"],
        category: Transient,
        personal: &[],
        contains: "A scratch file the disk benchmark writes and reads back to time the drive. Deleted when the test ends.",
        created: "while the disk benchmark runs",
        sandbox: NotRedirected,
        names_in_code: &[],
        proof: "",
        unresolved: "",
    },
    InventoryRow {
        id: "updater-download",
        base: Unresolved,
        path: "<chosen by tauri-plugin-updater>",
        writers: &["lib.rs"],
        category: Transient,
        personal: &[],
        contains: "The signed installer an update check downloads before it is run. Only when the user installs an update.",
        created: "when an update is downloaded",
        sandbox: NotRedirected,
        names_in_code: &[],
        proof: "tauri_plugin_updater",
        unresolved: "the plugin picks the download location itself; Compy's code never names it, so it cannot be determined statically",
    },
];

/// Browser-storage keys the page keeps in the WebView profile (row `webview-profile`). The guard
/// checks this list against every `compy_*` / `compy.*` key spelled in `src/`, both ways.
pub(crate) static WEBVIEW_KEYS: &[WebviewKey] = &[
    // ---- Appearance, layout and feature switches (a missing key means the default) ----
    WebviewKey { key: "compy_theme", kind: Local, category: Choices, personal: &[], holds: "colour theme" },
    WebviewKey { key: "compy_surface", kind: Local, category: Choices, personal: &[], holds: "surface style" },
    WebviewKey { key: "compy_backdrop", kind: Local, category: Choices, personal: &[], holds: "backdrop style" },
    WebviewKey { key: "compy_lang", kind: Local, category: Choices, personal: &[], holds: "display language" },
    WebviewKey { key: "compy_motion", kind: Local, category: Choices, personal: &[], holds: "reduced-motion preference" },
    WebviewKey { key: "compy_expert_view", kind: Local, category: Choices, personal: &[], holds: "expert-view switch" },
    WebviewKey { key: "compy_close_to_tray", kind: Local, category: Choices, personal: &[], holds: "close-to-tray switch" },
    WebviewKey { key: "compy_update_autocheck", kind: Local, category: Choices, personal: &[], holds: "automatic update-check switch" },
    WebviewKey { key: "compy_use_profile_v1", kind: Local, category: Choices, personal: &[], holds: "what the user mostly does with the PC (gaming, streaming, creation, idle)" },
    WebviewKey { key: "compy_score_face", kind: Local, category: Choices, personal: &[], holds: "which style the score is shown in" },
    WebviewKey { key: "compy_home_rig_3d", kind: Local, category: Choices, personal: &[], holds: "3D rig view switch" },
    WebviewKey { key: "compy_room_accents", kind: Local, category: Choices, personal: &[], holds: "accent colours chosen per room" },
    WebviewKey { key: "compy_overlay_corner", kind: Local, category: Choices, personal: &[], holds: "which screen corner the overlay sits in" },
    WebviewKey { key: "compy_overlay_density", kind: Local, category: Choices, personal: &[], holds: "overlay density" },
    WebviewKey { key: "compy_overlay_backdrop", kind: Local, category: Choices, personal: &[], holds: "overlay backdrop" },
    WebviewKey { key: "compy_overlay_v2", kind: Local, category: Choices, personal: &[], holds: "old overlay switch; cleared on read when it would lock the user out" },
    WebviewKey { key: "compy_living_instrument", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_dash_v2", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_editorial", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_room_identity", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_setup_stepper", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_firstcheck_theater", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_monitor_cards", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_hologram_v2", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_two_futures", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_hud_frame", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_intelligence", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_home_console", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_home_interview", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_command_palette", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_blackbook_console", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    WebviewKey { key: "compy_gaming_console", kind: Local, category: Choices, personal: &[], holds: "feature switch" },
    // ---- First-run flags and things the user has seen or dismissed ----
    WebviewKey { key: "compy_first_check_v1", kind: Local, category: Choices, personal: &[], holds: "the first check has run" },
    WebviewKey { key: "compy_onboarded_v1", kind: Local, category: Choices, personal: &[], holds: "the intro has been seen" },
    WebviewKey { key: "compy_setup_tour_v1", kind: Local, category: Choices, personal: &[], holds: "the setup tour has been seen" },
    WebviewKey { key: "compy_trust_moment", kind: Local, category: Choices, personal: &[], holds: "the trust screen has been seen" },
    WebviewKey { key: "compy_first_win", kind: Local, category: Choices, personal: &[], holds: "the first-win screen has been seen" },
    WebviewKey { key: "compy_blackbook_gradekey_seen_v1", kind: Local, category: Choices, personal: &[], holds: "the grade key has been seen" },
    WebviewKey { key: "compy_sessions_seen_v1", kind: Local, category: Choices, personal: &[], holds: "start time of the newest session the user has seen" },
    WebviewKey { key: "compy_dismissed_recs", kind: Local, category: Choices, personal: &[], holds: "ids of recommendations the user dismissed" },
    WebviewKey { key: "compy_eligibility_overrides", kind: Local, category: Choices, personal: &[], holds: "ids of capability-gated recommendations the user chose to show anyway" },
    WebviewKey { key: "compy_gaming_consent_v1", kind: Local, category: Choices, personal: &[], holds: "the user's Gaming Mode consent" },
    WebviewKey { key: "compy_gaming_consent_extras_v1", kind: Local, category: Choices, personal: &[], holds: "the user's consent for Gaming Mode's extra steps" },
    WebviewKey { key: "compy_ledger_this_rig", kind: Local, category: Choices, personal: &[], holds: "whether the ledger view is limited to this PC's hardware" },
    WebviewKey { key: "compy.trial.riskChoice", kind: Local, category: Choices, personal: &[], holds: "the user's last Trial outcome choice" },
    // ---- Small local records ----
    WebviewKey { key: "compy_last_check_v1", kind: Local, category: PlayHistory, personal: &[], holds: "when the last check ran and how it came out" },
    WebviewKey { key: "compy_local_stats_v1", kind: Local, category: PlayHistory, personal: &[], holds: "counts of a few of this PC's Compy moments" },
    WebviewKey { key: "compy_autopsy_ledger_v1", kind: Local, category: PlayHistory, personal: &[], holds: "capped statistics of the user's Learn autopsy gradings (never the text)" },
    WebviewKey { key: "compy_care_step_shown", kind: Local, category: PlayHistory, personal: &[ProgramNames], holds: "capped record of which care next steps were shown for which incidents" },
    WebviewKey { key: "compy_bb_feedback", kind: Local, category: PlayHistory, personal: &[ProgramNames], holds: "capped log (100) of the user's helpful votes on Black Box incidents" },
    WebviewKey { key: "compy_bb_helpful_<incident>", kind: Local, category: PlayHistory, personal: &[ProgramNames], holds: "one older-style helpful vote per Black Box incident" },
    WebviewKey { key: "compy.journey.stopped", kind: Local, category: PlayHistory, personal: &[ProgramNames], holds: "per-game time the user pressed Stop here in a guided journey" },
    WebviewKey { key: "compy.journey.running", kind: Local, category: Transient, personal: &[], holds: "id of the Trial a guided journey is running" },
    WebviewKey { key: "compy.journey.recording", kind: Local, category: Transient, personal: &[], holds: "flag that a journey is recording, read by the overlay window" },
    // ---- Hardware facts ----
    WebviewKey { key: "compy_display_refresh_hz", kind: Local, category: HardwareFacts, personal: &[HardwareSpecs], holds: "the monitor's refresh rate, relayed from the main window to the overlay" },
    WebviewKey { key: "compy_gpu_profile_snapshots_v1", kind: Local, category: HardwareFacts, personal: &[HardwareSpecs], holds: "saved GPU settings snapshots" },
    // ---- Text the user typed or pasted ----
    WebviewKey { key: "compy_feedback_draft", kind: Local, category: Category::UserText, personal: &[Personal::UserText], holds: "an unsent feedback note the user is writing" },
    WebviewKey { key: "compy_rig_manual_parts", kind: Local, category: Category::UserText, personal: &[Personal::UserText, HardwareSpecs], holds: "parts the user added to the rig model by hand" },
    WebviewKey { key: "compy_autopsy_text", kind: Session, category: Category::UserText, personal: &[Personal::UserText], holds: "text the user pasted into the Learn autopsy; kept until the window closes" },
    // ---- Short-lived hand-offs and session state ----
    WebviewKey { key: "compy_autopsy_graded", kind: Session, category: Transient, personal: &[], holds: "whether the pasted text was graded" },
    WebviewKey { key: "compy_learn_mode", kind: Session, category: Transient, personal: &[], holds: "which Learn mode is open" },
    WebviewKey { key: "compy_lab_open_station", kind: Local, category: Transient, personal: &[], holds: "one-shot: which Lab station to open; removed when read" },
    WebviewKey { key: "compy_lab_open_incident", kind: Local, category: Transient, personal: &[ProgramNames], holds: "one-shot: which incident to open; removed when read" },
    WebviewKey { key: "compy_bench_arrival", kind: Local, category: Transient, personal: &[], holds: "one-shot arrival hint; removed when read" },
    WebviewKey { key: "compy_since_arrival", kind: Local, category: Transient, personal: &[], holds: "one-shot arrival hint; removed when read" },
    WebviewKey { key: "compy_care_arrival", kind: Local, category: Transient, personal: &[], holds: "one-shot arrival hint; removed when read" },
    WebviewKey { key: "compy_interview_arrival", kind: Local, category: Transient, personal: &[], holds: "one-shot arrival hint with a finding and a time; removed when read" },
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_are_unique_and_every_field_is_filled() {
        let mut seen = HashSet::new();
        for r in rows() {
            assert!(seen.insert(r.id), "duplicate inventory id {}", r.id);
            assert!(!r.id.is_empty() && !r.path.is_empty(), "row {} has an empty id or path", r.id);
            assert!(!r.writers.is_empty(), "row {} names no writer module", r.id);
            for w in r.writers {
                assert!(w.ends_with(".rs") && !w.contains('/') && !w.contains('\\'), "row {}: writer {w} is not a module file name", r.id);
            }
            assert!(r.contains.len() > 12 && r.created.len() > 3, "row {} needs plain words for what it holds and when it appears", r.id);
        }
    }

    #[test]
    fn paths_are_relative_forward_slashed_and_stay_inside_their_base() {
        for r in rows() {
            if r.base == Base::Unresolved {
                continue;
            }
            assert!(!r.path.contains('\\'), "row {}: write paths with `/`", r.id);
            assert!(!r.path.starts_with('/') && !r.path.contains(':'), "row {}: path must be relative", r.id);
            assert!(!r.path.split('/').any(|s| s.is_empty() || s == ".." || s == "."), "row {}: bad path segment", r.id);
        }
    }

    #[test]
    fn unresolved_rows_say_why_and_only_they_do() {
        for r in rows() {
            assert_eq!(r.base == Base::Unresolved, !r.unresolved.is_empty(), "row {}: base Unresolved and a reason go together", r.id);
        }
    }

    #[test]
    fn only_rows_under_the_data_root_can_be_moved_by_a_data_root_decision() {
        for r in rows() {
            let under_root = r.base == Base::DataRoot;
            assert_eq!(under_root, r.sandbox != SandboxEffect::NotRedirected, "row {}: sandbox effect must match its base", r.id);
        }
    }

    #[test]
    fn the_ledger_family_is_every_history_json_name_and_nothing_else() {
        let family: Vec<&str> = ledger_family().map(|r| r.path).collect();
        assert!(family.contains(&"history.json") && family.contains(&"history.json.bak"));
        for r in rows() {
            let is_history_name = r.path.starts_with("history.json");
            assert_eq!(is_history_name, r.id.starts_with("ledger-"), "row {}: `ledger-` ids are exactly the history.json* names", r.id);
        }
        // The undo records can never be classed as a cache or a plain choice.
        for r in ledger_family() {
            assert!(matches!(r.category, Category::Undo | Category::Transient), "ledger row {} has category {:?}", r.id, r.category);
        }
    }

    #[test]
    fn personal_data_claims_follow_the_category() {
        // A row that holds text the user typed must say so.
        for r in rows().iter().filter(|r| r.category == Category::UserText) {
            assert!(r.personal.contains(&Personal::UserText), "row {} is user text", r.id);
        }
        for k in webview_keys().iter().filter(|k| k.category == Category::UserText) {
            assert!(k.personal.contains(&Personal::UserText), "key {} is user text", k.key);
        }
        // The licence and the support exports are the rows a privacy notice must name.
        let licence = rows().iter().find(|r| r.id == "license").expect("licence row");
        assert!(licence.personal.contains(&Personal::PurchaseDetail));
        let sessions = rows().iter().find(|r| r.id == "sessions").expect("sessions row");
        assert!(sessions.personal.contains(&Personal::ProgramNames));
    }

    #[test]
    fn webview_keys_are_unique_and_namespaced() {
        let mut seen = HashSet::new();
        for k in webview_keys() {
            assert!(seen.insert(k.key), "duplicate storage key {}", k.key);
            assert!(k.key.starts_with("compy_") || k.key.starts_with("compy."), "key {} is outside the compy namespace", k.key);
            assert!(!k.holds.is_empty());
        }
        let session: Vec<&str> = webview_keys().iter().filter(|k| k.kind == StorageKind::Session).map(|k| k.key).collect();
        assert_eq!(session.len(), 3, "session-storage keys: {session:?}");
    }

    #[test]
    fn rows_in_filters_by_category() {
        assert!(rows_in(Category::Undo).any(|r| r.id == "gaming-session"));
        assert!(rows_in(Category::Cache).all(|r| r.base == Base::DataRoot));
        assert_eq!(rows_in(Category::Legacy).count(), 1);
    }
}