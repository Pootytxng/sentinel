//! "Clear my data", the planner and the executor (D4-2). Reads `data_inventory.rs`; has no list of its own.
//!
//! Two steps, kept apart on purpose:
//!   1. `plan_clear` reads the data root's folder listing (and the ledger, read-only) and returns a
//!      `ClearPlan`: exactly which files WOULD be deleted, which are kept and why, which files Compy
//!      did not create (kept, never deleted), and why a clear is refused. It changes nothing.
//!   2. `execute_clear` re-plans, refuses if anything changed since the plan it was given, then deletes
//!      exactly the files that plan listed, one at a time, and reports each one. A failure is reported
//!      per file and is never a success; running it again finishes the rest.
//!
//! Every name that may be deleted comes from a row of the inventory (`classify`). A file with no row is
//! left alone and reported. Nothing here removes a folder, and nothing removes the data root: with the
//! root gone the first `compy_data_dir()` call would copy the old `%APPDATA%\Sentinel` folder back in
//! (`lib.rs`, `legacy_copy_in_would_run`), bringing an older ledger with it.
//!
//! The rules (design `d4-clear-data-design.md` sections 2.3, 3.1-3.3):
//! * `Scope::PlayHistory` ("Clear play history") never touches the ledger family (`history.json*`).
//! * `Scope::Everything` refuses while ANY ledger row is not rolled back, while the ledger cannot be
//!   read, while a set-aside ledger copy or any Gaming Mode contract file exists, or while a ledger
//!   working file is fresh. Its ledger files go in the order of `LEDGER_DELETE_ORDER`: the backup
//!   before `history.json`, because a missing ledger with a backup beside it is restored from it.
//!   If one ledger-family delete fails, the rest of the family is not attempted.
//! * A working file (`Category::Transient`) newer than an hour may belong to a running operation, so it
//!   is kept and reported.
//!
//! This slice (D4-2) ships the core and tests only. The two live wrappers at the bottom are NOT registered
//! as commands until the UI/relaunch slice (see the note above them). `Scope::Everything` is planned and
//! executed by the same code but has no wrapper yet (D4-3 adds the lock order, the clear-intent file and
//! the start-up roll-forward). The core below this file's `live wrappers` marker takes the root as
//! an argument and never resolves a data root itself; every test passes a temp folder it made.

#![allow(dead_code)] // `Scope::Everything` and the report helpers are first used by D4-3 and D4-4.

use crate::data_inventory::{self, Base, Category, InventoryRow, StorageKind};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Which of the design's two choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Scope {
    /// "Clear play history": measurements and comparisons; the change history stays.
    PlayHistory,
    /// "Clear everything Compy keeps": also the change history, support record, reports, choices.
    Everything,
}

/// A working file (`Transient`) younger than this may belong to a running operation.
const WORKING_FILE_MIN_AGE: Duration = Duration::from_secs(3600);

/// The ledger rows that are damaged copies of `history.json`. `Everything` refuses while one exists:
/// it may hold the only undo record for a change that is still on.
const LEDGER_SET_ASIDE: &[&str] = &["ledger-corrupt", "ledger-corrupt-stamped", "ledger-corrupt-stamped-n"];
/// The rest of the ledger family, in the order `Everything` deletes it. The backup and every working
/// file go BEFORE `history.json`; the main file is last.
const LEDGER_DELETE_ORDER: &[&str] = &[
    "ledger-backup-tmp",
    "ledger-backup",
    "ledger-backup-corrupt",
    "ledger-backup-corrupt-n",
    "ledger-restored-tmp",
    "ledger-restored-note",
    "ledger-restore-tmp",
    "ledger-tmp",
    "ledger-main",
];
/// The ledger file the planner reads (row `ledger-main`).
const LEDGER_FILE: &str = "history.json";
/// Row ids the policy singles out. A test checks each is still an inventory row.
const EXPERIMENTS_ID: &str = "experiments";
const LICENCE_ID: &str = "license";
/// The Trial store. Read (never moved) by `read_trial_store`.
const EXPERIMENTS_FILE: &str = "experiments.json";
/// Files an elevated helper leaves behind. They are not play history: a leftover batch receipt can be
/// the only evidence of which items of an interrupted batch finished. Kept by `PlayHistory`.
const ELEVATED_LEFTOVER_IDS: &[&str] = &[
    "elevation-batch-receipts",
    "gaming-elevation-receipts",
    "gaming-restore-receipts",
    "memcompress-result",
    "elevation-ticket",
];

// ---- the plan ---------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct PlannedDelete {
    /// Relative to the data root, `/` separated.
    pub(crate) rel: String,
    pub(crate) row_id: &'static str,
    /// The inventory id of the store this file belongs to (`sessions` for `sessions.json.corrupt.9`): the
    /// key of that store's clear epoch. Not in the fingerprint; it follows from `row_id`.
    pub(crate) store: &'static str,
    pub(crate) category: &'static str,
    /// Size and modified time (ms since 1970) when planned. They are part of the fingerprint, so a file
    /// rewritten after the list was shown makes the executor refuse: "things changed since you looked".
    pub(crate) size: u64,
    pub(crate) modified_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Kept {
    pub(crate) rel: String,
    pub(crate) code: &'static str,
    pub(crate) detail: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Refusal {
    pub(crate) code: &'static str,
    pub(crate) detail: String,
    /// The files (or change titles) the refusal is about.
    pub(crate) files: Vec<String>,
}

/// One browser-storage key (or key prefix) the page clears for this choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct WebviewTarget {
    pub(crate) key: &'static str,
    /// True when `key` is the part before `<...>`: clear every key that starts with it.
    pub(crate) prefix: bool,
    pub(crate) session_storage: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ClearPlan {
    pub(crate) scope: Scope,
    /// What would be deleted, in the order it will be deleted. Empty when refused.
    pub(crate) delete: Vec<PlannedDelete>,
    pub(crate) kept: Vec<Kept>,
    /// Files and folders Compy did not create: never deleted.
    pub(crate) unknown: Vec<String>,
    /// Why nothing will be deleted. Empty means the clear may go ahead.
    pub(crate) refusals: Vec<Refusal>,
    /// Titles of the ledger rows not rolled back, when that is why `Everything` refuses.
    pub(crate) applied_changes: Vec<String>,
    /// True when the way out of a refusal is "undo them first".
    pub(crate) offer_undo_all: bool,
    /// The older `Sentinel` folder exists beside the data root. It is never deleted.
    pub(crate) legacy_folder_present: bool,
    pub(crate) webview: Vec<WebviewTarget>,
    /// Identifies this exact list. The executor refuses a plan whose files changed since.
    pub(crate) fingerprint: String,
}

impl ClearPlan {
    pub(crate) fn can_proceed(&self) -> bool {
        self.refusals.is_empty()
    }

    /// Nothing is refused and nothing would be deleted. Distinct from "couldn't read": an unreadable
    /// folder, ledger or Trial store is a refusal with its own code, never this.
    pub(crate) fn nothing_to_do(&self) -> bool {
        self.refusals.is_empty() && self.delete.is_empty()
    }

    /// A plan that deletes nothing because the live wrapper could not even start (no usable data root,
    /// a lock that could not be taken). One typed refusal.
    pub(crate) fn refused(scope: Scope, code: &'static str, detail: &str) -> Self {
        let mut plan = ClearPlan::empty(scope);
        plan.refuse(code, detail, None);
        plan.finish()
    }

    fn empty(scope: Scope) -> Self {
        ClearPlan {
            scope,
            delete: Vec::new(),
            kept: Vec::new(),
            unknown: Vec::new(),
            refusals: Vec::new(),
            applied_changes: Vec::new(),
            offer_undo_all: false,
            legacy_folder_present: false,
            webview: webview_targets(scope),
            fingerprint: String::new(),
        }
    }

    fn refuse(&mut self, code: &'static str, detail: &str, file: Option<&str>) {
        let entry = match self.refusals.iter().position(|r| r.code == code) {
            Some(i) => &mut self.refusals[i],
            None => {
                self.refusals.push(Refusal { code, detail: detail.to_string(), files: Vec::new() });
                self.refusals.last_mut().expect("just pushed")
            }
        };
        if let Some(f) = file {
            entry.files.push(f.to_string());
        }
    }

    /// Sort into deletion order, drop the list when refused, and stamp the fingerprint.
    fn finish(mut self) -> Self {
        if !self.refusals.is_empty() {
            self.delete.clear();
        }
        self.delete.sort_by_key(delete_key);
        self.kept.sort_by(|a, b| a.rel.cmp(&b.rel));
        self.unknown.sort();
        let mut h = Sha256::new();
        h.update(format!("{:?}\n", self.scope));
        for d in &self.delete {
            h.update(format!("{}|{}|{}|{}\n", d.rel, d.row_id, d.size, d.modified_ms));
        }
        self.fingerprint = format!("{:x}", h.finalize());
        self
    }
}

/// Facts the planner cannot read from the folder. The live command reads them from the running app;
/// a test sets them.
#[derive(Debug, Clone)]
pub(crate) struct ClearFacts {
    /// A capture (a game being measured) is running.
    pub(crate) capture_active: bool,
    /// The session recorder holds a session it has not finished saving (D6). Distinct from
    /// `capture_active`: Stop clears that flag before the recorder thread has saved its session.
    pub(crate) recorder_busy: bool,
    /// A benchmark trial is running (D6): it applies a change and writes the scoreboard and noise floors
    /// when it ends.
    pub(crate) benchmark_trial_running: bool,
    /// `Everything` only: also delete the licence token.
    pub(crate) remove_licence: bool,
    /// The clock the "working file is older than an hour" rule reads.
    pub(crate) now: SystemTime,
}

/// The three things only the running app knows, that can change at any moment. Read when the plan is
/// made (inside `ClearFacts`) AND again inside each store's gate immediately before a delete (D7): a
/// Trial, a capture or an unsaved session that began after the plan was checked is seen and refused.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct LiveState {
    pub(crate) capture_active: bool,
    pub(crate) recorder_busy: bool,
    pub(crate) benchmark_trial_running: bool,
}

impl ClearFacts {
    pub(crate) fn live_state(&self) -> LiveState {
        LiveState {
            capture_active: self.capture_active,
            recorder_busy: self.recorder_busy,
            benchmark_trial_running: self.benchmark_trial_running,
        }
    }
}

/// The typed reasons `state` forbids a clear, `(code, sentence)`, in a fixed order. The planner and the
/// in-gate re-check read the same list, so a refusal means the same thing in both places.
fn live_state_refusals(state: &LiveState) -> Vec<(&'static str, &'static str)> {
    let mut out = Vec::new();
    if state.capture_active {
        out.push(("capture_running", "Compy is measuring a game right now. Close the game or stop measuring first."));
    }
    if state.recorder_busy {
        out.push(("recording_in_progress", "Compy is still finishing the play session it just measured. Try again in a moment."));
    }
    if state.benchmark_trial_running {
        out.push(("benchmark_trial_running", "A benchmark trial is running. Let it finish or cancel it first."));
    }
    out
}

enum LedgerCheck {
    /// Readable, and every row is rolled back (or there is no ledger).
    Clean,
    /// Titles of the rows that are not rolled back.
    Applied(Vec<String>),
    Unreadable(String),
}

fn delete_key(d: &PlannedDelete) -> (u8, usize, String) {
    if let Some(i) = LEDGER_DELETE_ORDER.iter().position(|id| *id == d.row_id) {
        return (0, i, d.rel.clone());
    }
    if d.row_id.starts_with("support-evidence") {
        // The support record last, its working file just before it.
        return (2, usize::from(d.row_id == "support-evidence"), d.rel.clone());
    }
    (1, 0, d.rel.clone())
}

fn cat_name(c: Category) -> &'static str {
    match c {
        Category::Undo => "undo",
        Category::PlayHistory => "play_history",
        Category::HardwareFacts => "hardware_facts",
        Category::Support => "support",
        Category::Cache => "cache",
        Category::UserText => "user_text",
        Category::WebView => "webview",
        Category::Choices => "choices",
        Category::Transient => "transient",
        Category::SetAside => "set_aside",
        Category::Legacy => "legacy",
    }
}

/// Browser-side keys to clear, taken from the inventory's key list.
fn webview_targets(scope: Scope) -> Vec<WebviewTarget> {
    data_inventory::webview_keys()
        .iter()
        .filter(|k| match scope {
            Scope::Everything => true,
            Scope::PlayHistory => {
                matches!(k.category, Category::PlayHistory | Category::HardwareFacts | Category::Transient)
            }
        })
        .map(|k| match k.key.split_once('<') {
            Some((head, _)) => WebviewTarget { key: head, prefix: true, session_storage: k.kind == StorageKind::Session },
            None => WebviewTarget { key: k.key, prefix: false, session_storage: k.kind == StorageKind::Session },
        })
        .collect()
}

// ---- matching a file name against the inventory --------------------------------------------------

#[derive(Debug, Clone)]
enum Tok {
    Lit(String),
    /// `<secs>`, `<n>`, `<pid>`, `<seq>`, `<ms>`: digits.
    Digits,
    /// Any other placeholder: letters, digits, `_` and `-`.
    Word,
    /// `<store>`: the stem of a store file the inventory lists (`sessions` for `sessions.json`).
    Store,
    /// `<file>`: the whole name of a file the inventory lists.
    File,
}

fn tokenize(pattern: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut lit = String::new();
    let mut rest = pattern;
    while let Some(open) = rest.find('<') {
        let Some(close) = rest[open..].find('>') else { break };
        lit.push_str(&rest[..open]);
        if !lit.is_empty() {
            out.push(Tok::Lit(std::mem::take(&mut lit).to_lowercase()));
        }
        out.push(match &rest[open + 1..open + close] {
            "secs" | "n" | "pid" | "seq" | "ms" => Tok::Digits,
            "store" => Tok::Store,
            "file" => Tok::File,
            _ => Tok::Word,
        });
        rest = &rest[open + close + 1..];
    }
    lit.push_str(rest);
    if !lit.is_empty() {
        out.push(Tok::Lit(lit.to_lowercase()));
    }
    out
}

/// The name up to its first `.`, keeping any folder: `care/incident-observer.json` -> `care/incident-observer`.
fn stem_of(path: &str) -> String {
    let (dir, last) = match path.rsplit_once('/') {
        Some((d, l)) => (format!("{d}/"), l),
        None => (String::new(), path),
    };
    let last = last.trim_start_matches('.');
    let cut = last.find('.').unwrap_or(last.len());
    format!("{dir}{}", &last[..cut]).to_lowercase()
}

struct Ctx {
    stores: Vec<String>,
    files: Vec<String>,
    /// stem -> the row that owns files with that stem (not a set-aside, not a working file, not ledger).
    primary: HashMap<String, &'static InventoryRow>,
    dirs: Vec<String>,
}

fn is_ledger(row: &InventoryRow) -> bool {
    row.id.starts_with("ledger-")
}

/// A row whose files belong to another row's store: its verdict follows the owner's.
fn is_secondary(row: &InventoryRow) -> bool {
    matches!(row.category, Category::SetAside | Category::Transient) && !is_ledger(row)
}

fn data_root_rows() -> impl Iterator<Item = &'static InventoryRow> {
    data_inventory::rows().iter().filter(|r| r.base == Base::DataRoot)
}

fn build_ctx() -> Ctx {
    let mut ctx = Ctx { stores: Vec::new(), files: Vec::new(), primary: HashMap::new(), dirs: Vec::new() };
    for r in data_root_rows() {
        if let Some((d, _)) = r.path.split_once('/') {
            let d = d.to_lowercase();
            if !ctx.dirs.contains(&d) {
                ctx.dirs.push(d);
            }
        }
        if is_secondary(r) || is_ledger(r) {
            continue;
        }
        ctx.primary.insert(stem_of(r.path), r);
        if !r.path.contains('/') && !r.path.contains('<') {
            ctx.files.push(r.path.to_lowercase());
            if let Some(stem) = r.path.strip_suffix(".json") {
                ctx.stores.push(stem.to_lowercase());
            }
        }
    }
    ctx
}

fn matches(toks: &[Tok], text: &str, ctx: &Ctx, bind: &mut Option<String>) -> bool {
    let Some((first, rest)) = toks.split_first() else { return text.is_empty() };
    match first {
        Tok::Lit(s) => text.strip_prefix(s.as_str()).is_some_and(|t| matches(rest, t, ctx, bind)),
        Tok::Digits => {
            let n = text.bytes().take_while(u8::is_ascii_digit).count();
            (1..=n).rev().any(|k| matches(rest, &text[k..], ctx, bind))
        }
        Tok::Word => {
            let n = text.bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-').count();
            (1..=n).rev().any(|k| matches(rest, &text[k..], ctx, bind))
        }
        Tok::Store => ctx.stores.iter().any(|s| match text.strip_prefix(s.as_str()) {
            Some(t) => {
                let saved = bind.replace(s.clone());
                if matches(rest, t, ctx, bind) {
                    true
                } else {
                    *bind = saved;
                    false
                }
            }
            None => false,
        }),
        Tok::File => ctx.files.iter().any(|f| match text.strip_prefix(f.as_str()) {
            Some(t) => {
                let saved = bind.replace(stem_of(f));
                if matches(rest, t, ctx, bind) {
                    true
                } else {
                    *bind = saved;
                    false
                }
            }
            None => false,
        }),
    }
}

struct Hit {
    row: &'static InventoryRow,
    /// The row that owns this file's store (the row itself unless a set-aside or working file has an owner).
    class: &'static InventoryRow,
}

/// Which inventory row names `rel`, if any. The most specific row (fewest placeholders) wins.
fn classify(rel: &str, ctx: &Ctx) -> Option<Hit> {
    let lower = rel.to_lowercase();
    let mut best: Option<(usize, &'static InventoryRow, Option<String>)> = None;
    for r in data_root_rows() {
        let toks = tokenize(r.path);
        let mut bind = None;
        if matches(&toks, &lower, ctx, &mut bind) {
            let ph = toks.iter().filter(|t| !matches!(t, Tok::Lit(_))).count();
            if best.as_ref().is_none_or(|b| ph < b.0) {
                best = Some((ph, r, bind));
            }
        }
    }
    let (_, row, bind) = best?;
    let class = if is_secondary(row) {
        let stem = bind.unwrap_or_else(|| stem_of(row.path));
        ctx.primary.get(&stem).copied().unwrap_or(row)
    } else {
        row
    };
    Some(Hit { row, class })
}

// ---- the policy --------------------------------------------------------------------------------

enum Verdict {
    Delete,
    Keep(&'static str, &'static str),
    Refuse(&'static str, &'static str),
}

struct Run<'a> {
    scope: Scope,
    facts: &'a ClearFacts,
    ledger: &'a LedgerCheck,
    ctx: &'a Ctx,
}

/// The live Gaming Mode contract file itself.
fn is_live_contract(rel: &str) -> bool {
    rel.eq_ignore_ascii_case("gaming-session.json")
}

/// A working file beside the contract (`gaming-session.json.tmp`, `.gaming-session.json.<pid>-<n>.tmp`):
/// a crash leftover or a save in flight. Named truthfully: it is not "Gaming Mode is running".
fn is_contract_working_file(rel: &str) -> bool {
    rel.to_lowercase().ends_with(".tmp")
}

impl Run<'_> {
    fn stale(&self, mtime: Option<SystemTime>) -> bool {
        mtime
            .and_then(|m| self.facts.now.duration_since(m).ok())
            .is_some_and(|age| age >= WORKING_FILE_MIN_AGE)
    }

    fn decide(&self, hit: &Hit, rel: &str, mtime: Option<SystemTime>) -> Verdict {
        let everything = self.scope == Scope::Everything;
        let (row, class) = (hit.row, hit.class);
        if is_ledger(row) {
            if !everything {
                return Verdict::Keep("change_history", "The change history stays: every change Compy made can still be undone.");
            }
            if LEDGER_SET_ASIDE.contains(&row.id) {
                return Verdict::Refuse(
                    "ledger_set_aside",
                    "A damaged copy of the change history was set aside. It may hold the only record needed to undo a change, so Compy does not delete it.",
                );
            }
            if row.category == Category::Transient && !self.stale(mtime) {
                return Verdict::Refuse(
                    "ledger_busy",
                    "A change-history working file is less than an hour old, so a save may be running.",
                );
            }
            return Verdict::Delete;
        }
        if class.category == Category::Undo {
            if is_live_contract(rel) {
                return Verdict::Refuse("gaming_mode_active", "Gaming Mode is holding changes right now. End it first.");
            }
            if is_contract_working_file(rel) {
                return Verdict::Refuse(
                    "gaming_working_file",
                    "A Gaming Mode working file was left behind. It may belong to a session that did not finish, so Compy does not delete anything until it is dealt with.",
                );
            }
            return if everything {
                Verdict::Refuse(
                    "gaming_orphan",
                    "A Gaming Mode contract file was left behind. It may be the only record of what to restore, so Compy does not delete it.",
                )
            } else {
                Verdict::Keep("undo_data", "Kept: it may be needed to restore changes Gaming Mode made.")
            };
        }
        // A damaged Trial store set aside is kept, never deleted (experiment.rs `set_aside_damaged`): a
        // Pending start whose change landed without a receipt is named nowhere but that store.
        if row.category == Category::SetAside && class.id == EXPERIMENTS_ID {
            return if everything {
                Verdict::Refuse(
                    "trial_record_set_aside",
                    "A damaged copy of the Trial records was set aside. It may be the only record of a change a Trial made, so Compy does not delete it.",
                )
            } else {
                Verdict::Keep("trial_record_set_aside", "Kept: a damaged copy of the Trial records may be the only record of a change a Trial made.")
            };
        }
        let in_scope = match class.category {
            Category::PlayHistory | Category::HardwareFacts | Category::Transient | Category::SetAside => true,
            Category::Support | Category::Cache | Category::Choices | Category::UserText => everything,
            Category::Undo | Category::WebView | Category::Legacy => false,
        };
        if !in_scope {
            return Verdict::Keep("not_in_this_choice", "Not part of this choice.");
        }
        if !everything && ELEVATED_LEFTOVER_IDS.contains(&row.id) {
            return Verdict::Keep("elevated_leftover", "Not play history: a file an elevated helper left behind stays.");
        }
        if class.id == LICENCE_ID && !self.facts.remove_licence {
            return Verdict::Keep("licence_kept", "The Compy Pro licence stays unless you tick the box to remove it.");
        }
        if class.id == EXPERIMENTS_ID && !matches!(self.ledger, LedgerCheck::Clean) {
            return Verdict::Keep(
                "trials_tied_to_changes",
                "Trial results stay while changes are applied or the change history cannot be read: they are linked to it.",
            );
        }
        if row.category == Category::Transient && !self.stale(mtime) {
            return Verdict::Keep("working_file_in_use", "A working file less than an hour old may belong to something running.");
        }
        Verdict::Delete
    }
}

// ---- planning ----------------------------------------------------------------------------------

/// True for a symlink, a junction or any other reparse point: something that may lead outside the root.
fn is_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

enum TrialRead {
    NoStore,
    /// A record is `Pending` or `Running`.
    Active,
    Idle,
    /// Unreadable or damaged. Never read as "no Trial".
    Unknown(String),
}

/// A PURE read of the Trial store: bytes and a parse, nothing moved. (`experiment::load_store_checked_from`
/// renames a damaged file to `.corrupt`, so a plan must not use it.)
fn read_trial_store(root: &Path) -> TrialRead {
    let bytes = match fs::read(root.join(EXPERIMENTS_FILE)) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return TrialRead::NoStore,
        Err(e) => return TrialRead::Unknown(e.to_string()),
    };
    match serde_json::from_slice::<crate::experiment::ExperimentStore>(&bytes) {
        Ok(s) if crate::experiment::active_trial(&s).is_some() => TrialRead::Active,
        Ok(_) => TrialRead::Idle,
        Err(e) => TrialRead::Unknown(e.to_string()),
    }
}

fn check_ledger(root: &Path) -> LedgerCheck {
    match crate::history::not_rolled_back_titles_at(&root.join(LEDGER_FILE)) {
        Ok(t) if t.is_empty() => LedgerCheck::Clean,
        Ok(t) => LedgerCheck::Applied(t),
        Err(e) => LedgerCheck::Unreadable(e),
    }
}

/// What a clear of `scope` would do to the data root `root`. Reads the folder listing and the ledger;
/// changes nothing.
pub(crate) fn plan_clear(root: &Path, scope: Scope, facts: &ClearFacts) -> ClearPlan {
    let mut plan = ClearPlan::empty(scope);
    plan.legacy_folder_present = root.parent().is_some_and(|p| p.join("Sentinel").exists());
    match fs::symlink_metadata(root) {
        // Nothing there: nothing to delete. The root is never created here.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return plan.finish(),
        Err(_) => {
            plan.refuse("root_unreadable", "Compy's data folder could not be read.", None);
            return plan.finish();
        }
        Ok(m) if is_link(&m) || !m.is_dir() => {
            plan.refuse(
                "root_not_a_plain_folder",
                "Compy's data folder is a link or not a folder, so Compy will not delete inside it.",
                None,
            );
            return plan.finish();
        }
        Ok(_) => {}
    }
    for (code, detail) in live_state_refusals(&facts.live_state()) {
        plan.refuse(code, detail, None);
    }
    match read_trial_store(root) {
        TrialRead::Idle | TrialRead::NoStore => {}
        // Pending is a start that may have changed Windows (its receipt can be missing): a change may be on.
        TrialRead::Active => plan.refuse(
            "trial_running",
            "A Trial is starting, running or was interrupted mid-start, so a change it made may still be on. Let it finish or stop it first.",
            None,
        ),
        TrialRead::Unknown(_) => plan.refuse(
            "trial_state_unknown",
            "Compy can't read its Trial records, so it can't confirm that no Trial change is still on. The file was left exactly as it is.",
            None,
        ),
    }
    let ledger = check_ledger(root);
    if scope == Scope::Everything {
        match &ledger {
            LedgerCheck::Clean => {}
            LedgerCheck::Applied(titles) => {
                plan.refuse(
                    "changes_applied",
                    "Changes Compy made are still in place. Compy can't delete its change history while they are, because it is the only way to undo them.",
                    None,
                );
                plan.applied_changes = titles.clone();
                plan.offer_undo_all = true;
            }
            LedgerCheck::Unreadable(_) => {
                plan.refuse(
                    "ledger_unreadable",
                    "Compy can't read its change history, so it can't confirm every change was undone.",
                    None,
                );
            }
        }
    }
    let ctx = build_ctx();
    let run = Run { scope, facts, ledger: &ledger, ctx: &ctx };
    scan(root, &run, &mut plan);
    plan.finish()
}

fn scan(root: &Path, run: &Run, plan: &mut ClearPlan) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => {
            plan.refuse("root_unreadable", "Compy's data folder could not be read.", None);
            return;
        }
    };
    for entry in entries {
        match entry {
            Ok(e) => visit(&e.path(), e.file_name().to_string_lossy().into_owned(), 0, run, plan),
            Err(_) => plan.refuse("root_unreadable", "Compy's data folder could not be read.", None),
        }
    }
}

fn visit(path: &Path, rel: String, depth: u8, run: &Run, plan: &mut ClearPlan) {
    let name_ok = !rel.contains('\u{FFFD}');
    let Ok(meta) = fs::symlink_metadata(path) else {
        plan.unknown.push(rel);
        return;
    };
    if !name_ok {
        plan.unknown.push(rel);
        return;
    }
    let is_inventory_dir = depth == 0 && run.ctx.dirs.contains(&rel.to_lowercase());
    if is_link(&meta) {
        if is_inventory_dir || classify(&rel, run.ctx).is_some() {
            plan.kept.push(Kept { rel, code: "link_left_alone", detail: "A link, not a file Compy wrote. Left alone." });
        } else {
            plan.unknown.push(format!("{rel} (a link)"));
        }
        return;
    }
    if meta.is_dir() {
        if is_inventory_dir {
            if let Ok(children) = fs::read_dir(path) {
                for child in children.flatten() {
                    let name = child.file_name().to_string_lossy().into_owned();
                    visit(&child.path(), format!("{rel}/{name}"), depth + 1, run, plan);
                }
            } else {
                plan.refuse("root_unreadable", "A folder inside Compy's data folder could not be read.", Some(&rel));
            }
        } else {
            plan.unknown.push(format!("{rel}/"));
        }
        return;
    }
    if !meta.is_file() {
        plan.unknown.push(rel);
        return;
    }
    let Some(hit) = classify(&rel, run.ctx) else {
        plan.unknown.push(rel);
        return;
    };
    match run.decide(&hit, &rel, meta.modified().ok()) {
        Verdict::Delete => {
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis());
            plan.delete.push(PlannedDelete {
                rel,
                row_id: hit.row.id,
                store: hit.class.id,
                category: cat_name(hit.class.category),
                size: meta.len(),
                modified_ms,
            });
        }
        Verdict::Keep(code, detail) => plan.kept.push(Kept { rel, code, detail }),
        Verdict::Refuse(code, detail) => {
            plan.refuse(code, detail, Some(&rel));
            plan.kept.push(Kept { rel, code, detail });
        }
    }
}

// ---- executing ---------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct FailedDelete {
    pub(crate) rel: String,
    pub(crate) error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ClearReport {
    pub(crate) scope: Scope,
    pub(crate) deleted: Vec<String>,
    /// Listed by the plan but already gone when its turn came.
    pub(crate) already_gone: Vec<String>,
    pub(crate) failed: Vec<FailedDelete>,
    /// Not tried because an earlier ledger file could not be deleted, or because the run stopped (below).
    pub(crate) not_attempted: Vec<String>,
    /// Set when a Trial, a capture or an unsaved session appeared AFTER the plan was checked and was seen
    /// inside a store's gate immediately before a delete (D7): the run stopped there and the rest is in
    /// `not_attempted`. Empty otherwise. When it fires before anything was deleted the outcome is
    /// `Refused` instead, with these same typed reasons.
    pub(crate) stopped: Vec<Refusal>,
    pub(crate) kept: Vec<Kept>,
    pub(crate) unknown: Vec<String>,
    /// True only when every file the plan listed is gone.
    pub(crate) complete: bool,
    /// True when nothing was listed at all: not a failure, and not "couldn't read".
    pub(crate) nothing_to_do: bool,
    /// The running app still holds some of this in memory and has no safe reset for it; it needs a
    /// restart. False when every in-memory copy was reset (benchmark baseline, benchmark trial result,
    /// the observer's failure flags) or none exists; the browser's own storage is the screen's job.
    pub(crate) restart_required: bool,
    /// Why, one code per thing that could not be reset. Empty when `restart_required` is false.
    pub(crate) restart_reasons: Vec<&'static str>,
    pub(crate) webview: Vec<WebviewTarget>,
}

impl ClearReport {
    /// The one sentence a screen may show. It says "Cleared" only when everything listed is gone.
    pub(crate) fn summary(&self) -> String {
        let gone = self.deleted.len() + self.already_gone.len();
        if self.complete && self.nothing_to_do {
            "Nothing to clear.".to_string()
        } else if self.complete {
            format!("Cleared: {gone} file(s) deleted.")
        } else if let Some(why) = self.stopped.first() {
            format!(
                "Stopped: {gone} file(s) deleted, {} not tried. {} Run it again afterwards.",
                self.not_attempted.len(),
                why.detail
            )
        } else {
            format!(
                "Not finished: {gone} file(s) deleted, {} could not be deleted, {} not tried. Run it again after closing whatever is using them.",
                self.failed.len(),
                self.not_attempted.len()
            )
        }
    }
}

/// What a clear answers with. Serializes as `{"status": ..., "detail": ...}` so the future command can
/// hand it to the screen as it is: the refusal codes stay codes, never one joined sentence.
#[derive(Debug, Serialize)]
#[serde(tag = "status", content = "detail", rename_all = "snake_case")]
pub(crate) enum ClearOutcome {
    Refused(Vec<Refusal>),
    /// The files differ from the plan that was given; nothing was deleted.
    PlanChanged,
    Done(ClearReport),
}

/// Checks `rel` is a plain relative path of one or two names, with nothing that can leave the root.
fn validate_rel(rel: &str) -> Result<Vec<&str>, String> {
    if rel.is_empty() || rel.contains('\\') || rel.contains(':') {
        return Err(format!("`{rel}` is not a relative path inside the data folder"));
    }
    let segs: Vec<&str> = rel.split('/').collect();
    if segs.len() > 2 || segs.iter().any(|s| s.is_empty() || *s == "." || *s == "..") {
        return Err(format!("`{rel}` is not a file name or one folder and a file name"));
    }
    if Path::new(rel).components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("`{rel}` is not a plain relative path"));
    }
    Ok(segs)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Removed {
    Deleted,
    AlreadyGone,
}

// ---- gates: one lock per store, taken one at a time (D6, design 3.3) ------------------------------

/// The writers a file's delete must exclude. One per store; the store's own lock is the gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Gate {
    Sessions,
    Benchmark,
    Scoreboard,
    NoiseFloor,
    Comparison,
    Drift,
    IncidentObserver,
    Intelligence,
    HardwareFingerprint,
    Readiness,
    SupportEvidence,
    /// The Trial store gate. Taken alone for `PlayHistory`; held by the caller for `Everything`.
    Experiment,
    /// `history.json*`: needs the History lock, which only `Everything` holds (as `&LedgerGuard`).
    Ledger,
    /// No writer lock exists for this file (see `UNLOCKED_STEMS` for why none is needed).
    Unlocked,
}

/// Store stems (the file name up to its first `.`, folder kept) whose writers hold a lock, and which.
const GATED_STEMS: &[(&str, Gate)] = &[
    ("sessions", Gate::Sessions),
    ("benchmark", Gate::Benchmark),
    ("scoreboard", Gate::Scoreboard),
    ("noise_floors", Gate::NoiseFloor),
    ("compy_comparison", Gate::Comparison),
    ("compy_comparison_result", Gate::Comparison),
    ("drift", Gate::Drift),
    ("care/incident-observer", Gate::IncidentObserver),
    ("intelligence", Gate::Intelligence),
    ("hardware-fingerprint", Gate::HardwareFingerprint),
    ("readiness_dismissals", Gate::Readiness),
    ("support/evidence", Gate::SupportEvidence),
    ("experiments", Gate::Experiment),
];

/// Stems with no writer lock, and why the clear needs none. A test requires every concrete data-root
/// inventory row to be gated or listed here, so a new store forces a decision.
const UNLOCKED_STEMS: &[(&str, &str)] = &[
    ("receipts-consent", "written only with the value the user just chose; it never rewrites older contents"),
    ("license", "activation writes the token being activated, deactivation removes it; no read-modify-write"),
    ("case-intelligence/fetch-disabled", "an empty marker the user creates; Compy only looks for it"),
    ("case-intelligence/last-known-good", "a cache the fetch writes whole (temp + rename) from a fresh download"),
    ("cached-manifest", "signed-rules cache, switched off in every build; written whole by the fetch"),
    ("cached-rules", "signed-rules cache, switched off in every build; written whole by the fetch"),
    ("last-seen-ruleset-version", "signed-rules cache, switched off in every build"),
    ("runtime/fps", "the capture helper's hand-off; the clear refuses while a capture runs or a session is unsaved"),
    ("gaming-session", "never deleted by either choice: the Gaming Mode contract is undo data (refused or kept)"),
];

fn gate_of(d: &PlannedDelete) -> Gate {
    if d.row_id.starts_with("ledger-") {
        return Gate::Ledger;
    }
    let stem = stem_of(&d.rel);
    GATED_STEMS.iter().find(|(s, _)| *s == stem).map_or(Gate::Unlocked, |(_, g)| *g)
}

/// Excludes every writer of a store for the length of one delete.
pub(crate) trait ClearGates {
    /// Takes the lock(s) of `gate`'s store, runs `delete`, resets what the running app holds in memory
    /// for that store when the delete worked, and releases. Nothing else is held meanwhile. An `Err`
    /// means the delete failed or the gate could not be taken (then nothing was deleted). `store` is the
    /// inventory id of the store the file belongs to: the clear epoch that moves is that store's alone.
    fn with_gate(&self, gate: Gate, store: &'static str, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String>;
    /// What the running app is doing right now (a capture, an unsaved session, a benchmark trial). Read by
    /// `delete_rows` INSIDE the gate, immediately before each delete, so a Trial that started after the plan
    /// was checked is seen. No default: an implementation that forgets it would silently skip the check.
    fn live_state(&self) -> LiveState;
}

// ---- deleting one file --------------------------------------------------------------------------

/// Deletes one planned file, re-checking on the spot that it is a plain file whose folders are plain
/// folders inside the root. Never follows a link. On Windows the delete itself goes through a handle
/// (see `remove_by_handle`), which closes the window a path-based check leaves open.
fn delete_one(root: &Path, rel: &str) -> Result<Removed, String> {
    delete_one_with(root, rel, &|| {})
}

/// `delete_one` with a seam: `before_delete` runs after every path check and before the file is opened,
/// which is where a folder swapped for a junction would slip in. Tests use it; production passes a no-op.
fn delete_one_with(root: &Path, rel: &str, before_delete: &dyn Fn()) -> Result<Removed, String> {
    let segs = validate_rel(rel)?;
    // Re-checked immediately before every delete: the root itself is a plain folder, not a link.
    match fs::symlink_metadata(root) {
        Ok(m) if m.is_dir() && !is_link(&m) => {}
        Ok(_) => return Err("the data folder is a link or not a folder, so nothing was touched".to_string()),
        Err(e) => return Err(format!("the data folder could not be checked ({e})")),
    }
    let canon_root = root.canonicalize().map_err(|e| format!("the data folder cannot be resolved ({e})"))?;
    let mut dir = root.to_path_buf();
    for seg in &segs[..segs.len() - 1] {
        dir.push(seg);
        match fs::symlink_metadata(&dir) {
            Ok(m) if m.is_dir() && !is_link(&m) => {}
            Ok(_) => return Err(format!("`{seg}` is a link or not a folder, so nothing inside it was touched")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Removed::AlreadyGone),
            Err(e) => return Err(format!("`{seg}` could not be checked ({e})")),
        }
    }
    let canon_dir = dir.canonicalize().map_err(|e| format!("the folder cannot be resolved ({e})"))?;
    if !canon_dir.starts_with(&canon_root) {
        return Err("the folder leads outside Compy's data folder, so nothing was touched".to_string());
    }
    let leaf = segs[segs.len() - 1];
    let file: PathBuf = dir.join(leaf);
    match fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Removed::AlreadyGone),
        Err(e) => return Err(format!("could not be checked ({e})")),
        Ok(m) if is_link(&m) || !m.is_file() => return Err("is not a plain file, so it was left alone".to_string()),
        Ok(_) => {}
    }
    before_delete();
    if remove_by_handle(&file, &canon_dir.join(leaf))? == Removed::AlreadyGone {
        return Ok(Removed::AlreadyGone);
    }
    match fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Removed::Deleted),
        _ => Err("is still there after the delete".to_string()),
    }
}

#[cfg(not(windows))]
fn remove_by_handle(file: &Path, _expected: &Path) -> Result<Removed, String> {
    match fs::remove_file(file) {
        Ok(()) => Ok(Removed::Deleted),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Removed::AlreadyGone),
        Err(e) => Err(e.to_string()),
    }
}

/// Windows: open the file itself (FILE_FLAG_OPEN_REPARSE_POINT, so a link is opened as the link and
/// never followed) with DELETE access, check through the HANDLE that it is a plain file and that its
/// final path is exactly `expected` (the canonical folder inside the data root plus its name), and delete
/// through that same handle. A folder swapped for a junction after the path checks makes the final path
/// differ, so nothing is deleted. The three kernel32 calls are declared by hand, as `data_root.rs` does,
/// so no `windows` crate feature is added.
#[cfg(windows)]
fn remove_by_handle(file: &Path, expected: &Path) -> Result<Removed, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    const DELETE: u32 = 0x0001_0000;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const SHARE_ALL: u32 = 0x7;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const ATTR_REPARSE_POINT: u32 = 0x400;
    const ATTR_DIRECTORY: u32 = 0x10;
    let opened = fs::OpenOptions::new()
        .access_mode(DELETE | FILE_READ_ATTRIBUTES)
        .share_mode(SHARE_ALL)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(file);
    let handle_file = match opened {
        Ok(f) => f,
        // Gone between the last check and the open: nothing was deleted by this call, so say so.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Removed::AlreadyGone),
        Err(e) => return Err(e.to_string()),
    };
    let attrs = handle_file.metadata().map_err(|e| e.to_string())?.file_attributes();
    if attrs & (ATTR_REPARSE_POINT | ATTR_DIRECTORY) != 0 {
        return Err("is not a plain file, so it was left alone".to_string());
    }
    let final_path = win_handle::final_path(handle_file.as_raw_handle())?;
    if win_handle::normalize(&final_path) != win_handle::normalize(&expected.to_string_lossy()) {
        return Err("is not where it was planned (a folder was swapped for a link), so nothing was deleted".to_string());
    }
    win_handle::delete_on_close(handle_file.as_raw_handle())?;
    Ok(Removed::Deleted)
    // The handle drops here: the file is gone once it closes.
}

#[cfg(windows)]
mod win_handle {
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
    pub(super) fn final_path(handle: *mut c_void) -> Result<String, String> {
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
    pub(super) fn normalize(path: &str) -> String {
        path.trim_start_matches(r"\\?\").to_lowercase()
    }

    /// Marks the open file for deletion; it goes when the handle closes. Tries POSIX semantics that also
    /// ignore the read-only attribute (what `std::fs::remove_file` does), then the classic form.
    pub(super) fn delete_on_close(handle: *mut c_void) -> Result<(), String> {
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
}

// ---- executing -----------------------------------------------------------------------------------

fn ledger_lock_required() -> Refusal {
    Refusal {
        code: "ledger_lock_required",
        detail: "Deleting the change history needs the change-history lock, and this path does not hold it. Nothing was deleted.".to_string(),
        files: Vec::new(),
    }
}

/// Re-plans and checks the plan the caller was shown still stands.
// The `Err` is the finished `ClearOutcome` (a refusal or "plan changed"), returned once, on a cold path.
#[allow(clippy::result_large_err)]
fn replan(root: &Path, plan: &ClearPlan, facts: &ClearFacts) -> Result<ClearPlan, ClearOutcome> {
    let now = plan_clear(root, plan.scope, facts);
    if !now.refusals.is_empty() {
        return Err(ClearOutcome::Refused(now.refusals));
    }
    if now.fingerprint != plan.fingerprint || now.delete != plan.delete {
        return Err(ClearOutcome::PlanChanged);
    }
    Ok(now)
}

/// One in-memory copy of something a clear deletes, and what is done about it. The list is enumerated, not
/// assumed: `restart_required` is true unless every copy that applies to the scope has a reset.
pub(crate) struct MemoryCopy {
    /// Stable code carried in `restart_reasons` when this copy is NOT reset.
    pub(crate) reason: &'static str,
    /// Where it lives.
    pub(crate) holder: &'static str,
    /// `Everything` only, or both scopes.
    pub(crate) everything_only: bool,
    /// The gate that resets it under the store's lock, or `None` when the clear has no safe way to.
    pub(crate) reset_by: Option<Gate>,
}

pub(crate) const MEMORY_COPIES: &[MemoryCopy] = &[
    MemoryCopy { reason: "benchmark_cache", holder: "benchmark.rs state_cache (baseline, latest run, efficacy, error)", everything_only: false, reset_by: Some(Gate::Benchmark) },
    MemoryCopy { reason: "trial_result", holder: "benchmark_trial.rs state (last finished verdict and noise reading)", everything_only: false, reset_by: Some(Gate::Scoreboard) },
    MemoryCopy { reason: "incident_failure_flags", holder: "incident_observer.rs READ_FAILURE_REPORTED, SCAN_STORE_FAILED", everything_only: false, reset_by: Some(Gate::IncidentObserver) },
    MemoryCopy { reason: "support_preview_flag", holder: "support_evidence.rs PREVIEWED (the record was previewed this run), reset by support_evidence::forget_preview", everything_only: true, reset_by: Some(Gate::SupportEvidence) },
    MemoryCopy { reason: "identity_log_throttle", holder: "intelligence.rs refresh_gate (time of the last identity refresh), reset by intelligence::forget_refresh_throttle", everything_only: false, reset_by: Some(Gate::Intelligence) },
    MemoryCopy { reason: "screen_memory", holder: "the window's own state and WebView storage (UI slice: relaunch)", everything_only: false, reset_by: None },
];

/// The reasons a restart is still needed after a clear of `scope`, from `copies`.
fn restart_reasons_in(copies: &[MemoryCopy], scope: Scope) -> Vec<&'static str> {
    copies
        .iter()
        .filter(|c| c.reset_by.is_none() && (!c.everything_only || scope == Scope::Everything))
        .map(|c| c.reason)
        .collect()
}

fn new_report(now: &ClearPlan) -> ClearReport {
    ClearReport {
        scope: now.scope,
        deleted: Vec::new(),
        already_gone: Vec::new(),
        failed: Vec::new(),
        not_attempted: Vec::new(),
        stopped: Vec::new(),
        kept: now.kept.clone(),
        unknown: now.unknown.clone(),
        complete: false,
        nothing_to_do: false,
        restart_required: !restart_reasons_in(MEMORY_COPIES, now.scope).is_empty(),
        restart_reasons: restart_reasons_in(MEMORY_COPIES, now.scope),
        webview: now.webview.clone(),
    }
}

fn settle(mut report: ClearReport) -> ClearOutcome {
    report.nothing_to_do = report.deleted.is_empty()
        && report.already_gone.is_empty()
        && report.failed.is_empty()
        && report.not_attempted.is_empty();
    report.complete = report.failed.is_empty() && report.not_attempted.is_empty();
    ClearOutcome::Done(report)
}

/// Deletes `rows` in order. A file whose gate the caller already holds (`held`) or that has no writer
/// lock is deleted directly; any other goes through `gates`, which takes that store's lock for that one
/// delete. A failure is reported and the rest go on, except inside the ledger family, which stops.
fn delete_rows(
    root: &Path,
    rows: &[PlannedDelete],
    gates: &dyn ClearGates,
    held: &[Gate],
    report: &mut ClearReport,
    ledger_failed: &mut bool,
) -> Vec<Refusal> {
    for (i, d) in rows.iter().enumerate() {
        if *ledger_failed && d.row_id.starts_with("ledger-") {
            report.not_attempted.push(d.rel.clone());
            continue;
        }
        let gate = gate_of(d);
        // The plan was checked some time ago. Read the live state AGAIN here, inside the store's gate
        // (the closure runs with the lock held) and immediately before the delete: a Trial, a capture or an
        // unsaved session that started since is seen, and nothing more is deleted (D7).
        let tripped: std::cell::RefCell<Vec<Refusal>> = std::cell::RefCell::new(Vec::new());
        let mut run = || {
            let why = live_state_refusals(&gates.live_state());
            if !why.is_empty() {
                *tripped.borrow_mut() = why.into_iter().map(|(code, detail)| Refusal { code, detail: detail.to_string(), files: Vec::new() }).collect();
                return Err("the live state changed".to_string());
            }
            delete_one(root, &d.rel)
        };
        let result = if gate == Gate::Unlocked || held.contains(&gate) {
            run()
        } else if gate == Gate::Ledger {
            Err(ledger_lock_required().detail)
        } else {
            gates.with_gate(gate, d.store, &mut run)
        };
        let stopped = tripped.into_inner();
        if !stopped.is_empty() {
            // Not a failed delete: nothing was attempted. This file and every one after it stay.
            report.not_attempted.extend(rows[i..].iter().map(|r| r.rel.clone()));
            return stopped;
        }
        match result {
            Ok(Removed::Deleted) => report.deleted.push(d.rel.clone()),
            Ok(Removed::AlreadyGone) => report.already_gone.push(d.rel.clone()),
            Err(error) => {
                *ledger_failed |= d.row_id.starts_with("ledger-");
                report.failed.push(FailedDelete { rel: d.rel.clone(), error });
            }
        }
    }
    Vec::new()
}

/// `settle`, for a run that may have stopped. Stopped before anything was deleted: a typed `Refused`
/// (nothing changed on disk). Stopped later: `Done`, incomplete, with `stopped` naming why.
fn settle_run(mut report: ClearReport, stopped: Vec<Refusal>) -> ClearOutcome {
    if stopped.is_empty() {
        return settle(report);
    }
    if report.deleted.is_empty() && report.already_gone.is_empty() && report.failed.is_empty() {
        return ClearOutcome::Refused(stopped);
    }
    report.stopped = stopped;
    settle(report)
}

/// "Clear play history": deletes what `plan` listed, and only that, each store under its own lock for the
/// length of its own delete and nothing else held. Re-plans first: a refusal now, or a list that differs
/// from `plan`, deletes nothing. It never touches `history.json*` and takes `Scope::PlayHistory` plans
/// only: a `Scope::Everything` plan is refused (`ledger_lock_required`), because that path must hold the
/// ledger lock and has its own entry point (`clear_everything_at`).
pub(crate) fn execute_clear(root: &Path, plan: &ClearPlan, facts: &ClearFacts, gates: &dyn ClearGates) -> ClearOutcome {
    if plan.scope != Scope::PlayHistory {
        return ClearOutcome::Refused(vec![ledger_lock_required()]);
    }
    let now = match replan(root, plan, facts) {
        Ok(n) => n,
        Err(outcome) => return outcome,
    };
    let mut report = new_report(&now);
    let mut ledger_failed = false;
    let stopped = delete_rows(root, &now.delete, gates, &[], &mut report, &mut ledger_failed);
    settle_run(report, stopped)
}

/// What `execute_everything_ledger_phase` leaves for `finish_everything`.
pub(crate) struct LedgerPhase {
    report: ClearReport,
    rest: Vec<PlannedDelete>,
    ledger_failed: bool,
}

/// "Clear everything", phase 1: the change-history family and the Trial store. The caller must hold the
/// Trial gate and then the ledger lock (the one declared nesting `Experiment -> History`); they are taken
/// as `&TrialGuard` and `&LedgerGuard`, values only `experiment::lock_trial_gate` and `history::lock_ledger`
/// make (no other lock's guard type-checks), so this function cannot be called without both. Re-plans UNDER both locks, so "no change is applied" is the answer at the moment of
/// the delete, and an apply that landed first is seen and refuses. Deletes the ledger family in its fixed
/// order (backup before `history.json`), stopping the family on a failure, then `experiments.json`.
#[allow(clippy::result_large_err)] // the Err is the finished outcome, returned once on a cold path
pub(crate) fn execute_everything_ledger_phase(
    root: &Path,
    plan: &ClearPlan,
    facts: &ClearFacts,
    _experiment_gate: &crate::experiment::TrialGuard,
    _ledger: &crate::history::LedgerGuard,
) -> Result<LedgerPhase, ClearOutcome> {
    ledger_phase(root, plan, facts, &delete_one)
}

/// The body of phase 1, with the delete as a parameter so a test can look at what is held while a file
/// goes. Production passes `delete_one`.
#[allow(clippy::result_large_err)] // as above
fn ledger_phase(
    root: &Path,
    plan: &ClearPlan,
    facts: &ClearFacts,
    del: &dyn Fn(&Path, &str) -> Result<Removed, String>,
) -> Result<LedgerPhase, ClearOutcome> {
    if plan.scope != Scope::Everything {
        return Err(ClearOutcome::Refused(vec![ledger_lock_required()]));
    }
    let now = replan(root, plan, facts)?;
    let mut report = new_report(&now);
    let mut ledger_failed = false;
    let (mine, rest): (Vec<PlannedDelete>, Vec<PlannedDelete>) =
        now.delete.iter().cloned().partition(|d| matches!(gate_of(d), Gate::Ledger | Gate::Experiment));
    for d in &mine {
        if ledger_failed && d.row_id.starts_with("ledger-") {
            report.not_attempted.push(d.rel.clone());
            continue;
        }
        match del(root, &d.rel) {
            Ok(Removed::Deleted) => report.deleted.push(d.rel.clone()),
            Ok(Removed::AlreadyGone) => report.already_gone.push(d.rel.clone()),
            Err(error) => {
                ledger_failed |= d.row_id.starts_with("ledger-");
                report.failed.push(FailedDelete { rel: d.rel.clone(), error });
            }
        }
    }
    Ok(LedgerPhase { report, rest, ledger_failed })
}

/// "Clear everything", phase 2, run AFTER the Trial gate and the ledger lock are released: every other
/// file, each under its own store's lock one at a time, the support record last.
pub(crate) fn finish_everything(root: &Path, phase: LedgerPhase, gates: &dyn ClearGates) -> ClearOutcome {
    let LedgerPhase { mut report, rest, mut ledger_failed } = phase;
    let stopped = delete_rows(root, &rest, gates, &[], &mut report, &mut ledger_failed);
    settle_run(report, stopped)
}

/// "Clear everything" as one call: takes the Trial gate, then the ledger lock, runs phase 1 under both,
/// releases both, then runs phase 2. `facts` is read AFTER the locks are held. The root is an argument:
/// the live wrapper resolves it, this never does.
pub(crate) fn clear_everything_at(
    root: &Path,
    expected_fingerprint: &str,
    facts: &dyn Fn() -> ClearFacts,
    gates: &dyn ClearGates,
) -> ClearOutcome {
    let phase = {
        let experiment_gate = match crate::experiment::lock_trial_gate() {
            Ok(g) => g,
            Err(e) => return ClearOutcome::Refused(vec![store_lock_unavailable("the Trial store", &e)]),
        };
        let ledger = match crate::history::lock_ledger() {
            Ok(g) => g,
            Err(e) => return ClearOutcome::Refused(vec![store_lock_unavailable("the change history", &e)]),
        };
        let facts = facts();
        let plan = plan_clear(root, Scope::Everything, &facts);
        // A refusal is named as one (as `clear_play_history_at` does), not folded into "files changed".
        if !plan.refusals.is_empty() {
            return ClearOutcome::Refused(plan.refusals);
        }
        if plan.fingerprint != expected_fingerprint {
            return ClearOutcome::PlanChanged;
        }
        match execute_everything_ledger_phase(root, &plan, &facts, &experiment_gate, &ledger) {
            Ok(phase) => phase,
            Err(outcome) => return outcome,
        }
        // `ledger`, then `experiment_gate`, drop here.
    };
    finish_everything(root, phase, gates)
}

fn store_lock_unavailable(what: &str, why: &str) -> Refusal {
    Refusal {
        code: "store_lock_unavailable",
        detail: format!("Compy could not take the lock on {what} ({why}), so nothing was deleted. Restart Compy and try again."),
        files: Vec::new(),
    }
}

// ---- live wrappers (the only code below that touches the running app) ------------------------------
//
// STILL NOT REGISTERED as Tauri commands, on purpose: no `#[tauri::command]`, no entry in
// `generate_handler!`, `build.rs` APP_COMMANDS or `capabilities/default.json`. What must still exist
// before they are registered is in `C:\Users\Kuya\code\_train\d6-before-wiring-remaining.md`.
//
// They are plain blocking functions of `String`/`bool` arguments that return owned, `Send` values and
// capture no Tauri handle, so the future command can run them with `spawn_blocking` and never wait on a
// store lock on the UI thread. Each has an `_at` twin that takes the root, the facts and the gates as
// arguments; the tests drive the twins with a temp folder, so no test resolves the real data root.

use crate::data_root;

/// What a delete that worked does besides deleting: the clear epoch and the in-memory resets. A trait so a
/// test supplies its own instances and no process-wide state is touched by any test; the app uses
/// [`ProcessEffects`].
pub(crate) trait ClearEffects {
    /// A file of store `store` (an inventory id) was deleted (called under that store's lock): move THAT
    /// store's clear epoch, and no other.
    fn deleted(&self, store: &'static str);
    /// Runs `delete` with the benchmark cache's lock held, and resets the cache before letting go if the
    /// delete worked. The process's cache hydrates itself from the data root on first use, so a test must
    /// never reach it: it supplies its own lock and its own copy.
    fn with_benchmark_locked(&self, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String>;
    /// The last finished trial's verdict, after the scoreboard is gone.
    fn forget_trial_result(&self);
    /// The incident observer's failure-streak flags, under its lock, after its record is gone.
    fn forget_incident_failures(&self);
    /// The support record's "previewed this run" flag, under the record's lock, after the record is gone.
    fn forget_support_preview(&self);
    /// The identity log's refresh throttle, under the log's lock, after the log is gone.
    fn forget_identity_throttle(&self);
    /// What the running app is doing now, read inside a store's gate immediately before a delete (D7).
    fn live_state(&self) -> LiveState;
}

/// The process-wide instances: the real epoch, the real benchmark cache and trial state, the real flags.
pub(crate) struct ProcessEffects;

impl ClearEffects for ProcessEffects {
    fn deleted(&self, store: &'static str) {
        crate::atomic_write::bump_clear_epoch(store);
    }
    fn with_benchmark_locked(&self, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
        crate::benchmark::with_state_locked(|state| {
            let result = delete();
            if result.is_ok() {
                crate::benchmark::reset_for_clear(state);
            }
            result
        })?
    }
    fn forget_trial_result(&self) {
        let _ = crate::benchmark_trial::forget_finished_result();
    }
    fn forget_incident_failures(&self) {
        crate::incident_observer::forget_failure_streak();
    }
    fn forget_support_preview(&self) {
        crate::support_evidence::forget_preview();
    }
    fn forget_identity_throttle(&self) {
        crate::intelligence::forget_refresh_throttle();
    }
    fn live_state(&self) -> LiveState {
        // Atomics and one short leaf mutex (`benchmark_trial::state`, held for a clone and never across a
        // store lock): safe to read inside any store's gate.
        LiveState {
            capture_active: crate::monitoring::fps_active().load(std::sync::atomic::Ordering::Acquire),
            recorder_busy: crate::sessions::recorder_busy(),
            benchmark_trial_running: crate::benchmark_trial::trial_state().running,
        }
    }
}

/// The real gates: each store's own lock, then (while still holding it) the epoch move and the store's
/// memory reset, from `effects`. One lock per call, nothing else held.
pub(crate) struct LiveGates<'a>(pub(crate) &'a dyn ClearEffects);

impl ClearGates for LiveGates<'_> {
    fn with_gate(&self, gate: Gate, store: &'static str, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
        let fx = self.0;
        let mut run = || {
            let result = delete();
            if matches!(result, Ok(Removed::Deleted)) {
                fx.deleted(store);
            }
            result
        };
        let result = match gate {
            Gate::Sessions => crate::sessions::with_store_locked(run),
            Gate::Benchmark => fx.with_benchmark_locked(&mut run),
            Gate::Scoreboard => crate::benchmark_scoreboard::with_store_locked(run),
            Gate::NoiseFloor => {
                let _lock = crate::noise_floor::lock_gate();
                run()
            }
            Gate::Comparison => crate::comparison::with_store_locked(run),
            Gate::Drift => crate::drift::with_store_locked(run),
            Gate::IncidentObserver => crate::incident_observer::with_store_locked(|| {
                let result = run();
                if result.is_ok() {
                    fx.forget_incident_failures();
                }
                result
            }),
            Gate::Intelligence => {
                let _lock = crate::intelligence::lock_store().map_err(|()| "the identity log lock is poisoned".to_string())?;
                let result = run();
                if result.is_ok() {
                    fx.forget_identity_throttle();
                }
                result
            }
            Gate::HardwareFingerprint => crate::hwchange::with_store_locked(run),
            Gate::Readiness => crate::readiness::with_store_locked(run),
            Gate::SupportEvidence => {
                let _lock = crate::support_evidence::lock_store();
                let result = run();
                if result.is_ok() {
                    fx.forget_support_preview();
                }
                result
            }
            Gate::Experiment => {
                let _lock = crate::experiment::lock_store()?;
                run()
            }
            Gate::Ledger | Gate::Unlocked => return Err("this file has no store gate to take".to_string()),
        };
        // After the scoreboard's lock is released: the last finished benchmark trial's verdict is measured
        // against data that is gone. (A running trial is refused up front, so this is only the quiet case.)
        if gate == Gate::Scoreboard && result.is_ok() {
            fx.forget_trial_result();
        }
        result
    }
    fn live_state(&self) -> LiveState {
        self.0.live_state()
    }
}

/// The facts only the running app knows.
fn live_facts(remove_licence: bool) -> ClearFacts {
    let live = ProcessEffects.live_state();
    ClearFacts {
        capture_active: live.capture_active,
        recorder_busy: live.recorder_busy,
        benchmark_trial_running: live.benchmark_trial_running,
        remove_licence,
        now: SystemTime::now(),
    }
}

/// The root a clear may touch, or the typed reason there is none (a sandbox, redirected, conflicted or
/// unavailable root). Never guesses a folder.
fn live_root() -> Result<PathBuf, Refusal> {
    data_root::mutation_root().map(|r| r.path().to_path_buf()).map_err(|why| Refusal {
        code: "data_root_unavailable",
        detail: why,
        files: Vec::new(),
    })
}

/// What "Clear play history" would delete, keep and leave alone, right now. A pure read.
pub(crate) fn plan_clear_play_history() -> ClearPlan {
    match live_root() {
        Ok(root) => plan_clear(&root, Scope::PlayHistory, &live_facts(false)),
        Err(r) => ClearPlan::refused(Scope::PlayHistory, r.code, &r.detail),
    }
}

/// What "Clear everything" would delete, keep and leave alone, right now. A pure read.
pub(crate) fn plan_clear_everything(remove_licence: bool) -> ClearPlan {
    match live_root() {
        Ok(root) => plan_clear(&root, Scope::Everything, &live_facts(remove_licence)),
        Err(r) => ClearPlan::refused(Scope::Everything, r.code, &r.detail),
    }
}

/// `clear_play_history` on an explicit root. Plans again, refuses on a stale fingerprint
/// (`PlanChanged`), then deletes through `execute_clear`. Typed: refusals keep their codes.
pub(crate) fn clear_play_history_at(root: &Path, expected_fingerprint: &str, facts: &ClearFacts, gates: &dyn ClearGates) -> ClearOutcome {
    let plan = plan_clear(root, Scope::PlayHistory, facts);
    if !plan.refusals.is_empty() {
        return ClearOutcome::Refused(plan.refusals);
    }
    if plan.fingerprint != expected_fingerprint {
        return ClearOutcome::PlanChanged;
    }
    execute_clear(root, &plan, facts, gates)
}

/// Deletes the play history the plan with `expected_fingerprint` listed. Never touches `history.json*`.
/// Blocking: wait on store locks, so call it from `spawn_blocking`, never the UI thread.
pub(crate) fn clear_play_history(expected_fingerprint: &str) -> ClearOutcome {
    match live_root() {
        Ok(root) => clear_play_history_at(&root, expected_fingerprint, &live_facts(false), &LiveGates(&ProcessEffects)),
        Err(r) => ClearOutcome::Refused(vec![r]),
    }
}

/// Deletes everything the plan with `expected_fingerprint` listed (the licence only when asked). Takes
/// the Trial gate then the ledger lock for the change-history family; see `clear_everything_at`.
/// Blocking, like `clear_play_history`.
pub(crate) fn clear_everything(expected_fingerprint: &str, remove_licence: bool) -> ClearOutcome {
    match live_root() {
        Ok(root) => clear_everything_at(&root, expected_fingerprint, &|| live_facts(remove_licence), &LiveGates(&ProcessEffects)),
        Err(r) => ClearOutcome::Refused(vec![r]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    /// A fresh temp folder this test made: `base/Compy` is the data root, `base/Sentinel` the legacy folder
    /// when a test adds one. Nothing here resolves the real data root.
    struct Tmp {
        base: PathBuf,
        root: PathBuf,
    }

    impl Tmp {
        fn new(tag: &str) -> Tmp {
            let base = std::env::temp_dir().join(format!("compy-d5-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
            let _ = fs::remove_dir_all(&base);
            let root = base.join("Compy");
            fs::create_dir_all(&root).unwrap();
            Tmp { base, root }
        }
        fn put(&self, rel: &str, body: &str) {
            let p = self.root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
        fn has(&self, rel: &str) -> bool {
            fs::symlink_metadata(self.root.join(rel)).is_ok()
        }
        fn read(&self, rel: &str) -> String {
            fs::read_to_string(self.root.join(rel)).unwrap()
        }
        fn ledger(&self, rows: &[(&str, &str)]) {
            let items: Vec<String> = rows
                .iter()
                .enumerate()
                .map(|(i, (title, status))| {
                    format!(r#"{{"id":"c{i}","rec_id":"r{i}","rec_title":"{title}","applied_at":"2026-11-01T00:00:00Z","snapshot":{{}},"status":"{status}"}}"#)
                })
                .collect();
            self.put("history.json", &format!("[{}]", items.join(",")));
        }
        fn listing(&self) -> Vec<String> {
            let mut out = Vec::new();
            fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) {
                for e in fs::read_dir(dir).unwrap().flatten() {
                    let p = e.path();
                    let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
                    if e.file_type().unwrap().is_dir() {
                        out.push(format!("{rel}/"));
                        walk(&p, base, out);
                    } else {
                        out.push(format!("{rel}={}", fs::read(&p).unwrap().len()));
                    }
                }
            }
            walk(&self.root, &self.root, &mut out);
            out.sort();
            out
        }
    }

    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn facts() -> ClearFacts {
        ClearFacts { capture_active: false, recorder_busy: false, benchmark_trial_running: false, remove_licence: false, now: SystemTime::now() }
    }

    /// Two hours on, so every working file counts as old enough.
    fn later() -> ClearFacts {
        ClearFacts { now: SystemTime::now() + Duration::from_secs(7200), ..facts() }
    }

    /// No locks: most tests here are about WHAT is deleted and in what order. The gates, the locks and
    /// the ledger lock have tests of their own below.
    struct NoGates;

    impl ClearGates for NoGates {
        fn with_gate(&self, _gate: Gate, _store: &'static str, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
            delete()
        }
        fn live_state(&self) -> LiveState {
            LiveState::default()
        }
    }

    /// Runs a plan of either scope the way production does (Everything takes the Trial gate and the
    /// ledger lock itself), without any store gates.
    fn exec(root: &Path, plan: &ClearPlan, facts: &ClearFacts) -> ClearOutcome {
        match plan.scope {
            Scope::PlayHistory => execute_clear(root, plan, facts, &NoGates),
            Scope::Everything => {
                let facts = facts.clone();
                clear_everything_at(root, &plan.fingerprint, &move || facts.clone(), &NoGates)
            }
        }
    }

    fn rels(plan: &ClearPlan) -> Vec<&str> {
        plan.delete.iter().map(|d| d.rel.as_str()).collect()
    }

    fn done(o: ClearOutcome) -> ClearReport {
        match o {
            ClearOutcome::Done(r) => r,
            other => panic!("expected Done, got {other:?}"),
        }
    }

    /// One file for every kind of row, all with a rolled-back-only ledger.
    fn seed(t: &Tmp) {
        t.ledger(&[("Game mode", "rolled_back")]);
        t.put("history.json.bak", "bak");
        t.put("history.json.restored", "note");
        t.put("history.json.bak.corrupt", "damaged backup");
        for f in [
            "sessions.json",
            "experiments.json",
            "intelligence.json",
            "drift.json",
            "benchmark.json",
            "scoreboard.json",
            "noise_floors.json",
            "compy_comparison.json",
            "hardware-fingerprint.json",
            "readiness_dismissals.json",
            "receipts-consent.json",
            "license.key",
            "cached-manifest.json",
            "sessions.json.corrupt.123",
            ".drift.json.12-3.tmp",
            "elevation-batch-1700000000000.receipts",
        ] {
            t.put(f, "x");
        }
        t.put("experiments.json", r#"{"schema_version":1,"experiments":[]}"#);
        t.put("care/incident-observer.json", "x");
        t.put("support/evidence.jsonl", "x");
        t.put("exports/compy-report-20261120-101010123.md", "x");
        t.put("case-intelligence/last-known-good.json", "x");
        t.put("runtime/fps.json", "x");
    }

    const PLAY_HISTORY_FILES: &[&str] = &[
        ".drift.json.12-3.tmp",
        "benchmark.json",
        "care/incident-observer.json",
        "compy_comparison.json",
        "drift.json",
        "experiments.json",
        "hardware-fingerprint.json",
        "intelligence.json",
        "noise_floors.json",
        "runtime/fps.json",
        "scoreboard.json",
        "sessions.json",
        "sessions.json.corrupt.123",
    ];

    // (a) the plan is exact and changes nothing; the executor deletes only what it listed
    #[test]
    fn a1_plan_lists_exactly_what_would_be_deleted_and_touches_nothing() {
        let t = Tmp::new("a1");
        seed(&t);
        let before = t.listing();
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(plan.can_proceed());
        let mut got: Vec<&str> = rels(&plan);
        got.sort_unstable();
        assert_eq!(got, PLAY_HISTORY_FILES);
        for kept in ["history.json", "history.json.bak", "support/evidence.jsonl", "license.key", "readiness_dismissals.json"] {
            assert!(plan.kept.iter().any(|k| k.rel == kept), "{kept} should be listed as kept");
        }
        assert!(plan.unknown.is_empty());
        assert_eq!(before, t.listing(), "planning must not change anything");
        let every = plan_clear(&t.root, Scope::Everything, &later());
        assert!(every.can_proceed() && every.delete.len() > plan.delete.len());
        assert!(rels(&every).contains(&"support/evidence.jsonl") && !rels(&every).contains(&"license.key"));
        assert_eq!(before, t.listing());
    }

    #[test]
    fn a2_executor_deletes_only_what_the_plan_listed() {
        let t = Tmp::new("a2");
        seed(&t);
        t.put("notes.txt", "mine");
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete);
        let mut deleted = report.deleted.clone();
        deleted.sort();
        let mut listed: Vec<String> = plan.delete.iter().map(|d| d.rel.clone()).collect();
        listed.sort();
        assert_eq!(deleted, listed);
        for f in PLAY_HISTORY_FILES {
            assert!(!t.has(f), "{f} should be gone");
        }
        for f in ["history.json", "history.json.bak", "support/evidence.jsonl", "license.key", "notes.txt"] {
            assert!(t.has(f), "{f} must survive");
        }
        // A hand-edited plan is refused as changed and deletes nothing.
        let t2 = Tmp::new("a2b");
        seed(&t2);
        t2.put("notes.txt", "mine");
        let mut tampered = plan_clear(&t2.root, Scope::PlayHistory, &later());
        tampered.delete.push(PlannedDelete { rel: "notes.txt".into(), row_id: "sessions", store: "sessions", category: "play_history", size: 4, modified_ms: 0 });
        let before = t2.listing();
        assert!(matches!(exec(&t2.root, &tampered, &later()), ClearOutcome::PlanChanged));
        let mut other = plan_clear(&t2.root, Scope::PlayHistory, &later());
        other.fingerprint = "not-the-fingerprint".into();
        assert!(matches!(exec(&t2.root, &other, &later()), ClearOutcome::PlanChanged));
        assert_eq!(before, t2.listing());
    }

    // (f) confinement of a single delete
    #[test]
    fn f0_delete_one_rejects_paths_that_can_leave_the_root() {
        let t = Tmp::new("f0");
        fs::write(t.base.join("outside.json"), "outside").unwrap();
        for bad in ["../outside.json", "..", "a/../outside.json", "/outside.json", "C:/x.json", "C:\\x.json", "", "a//b.json", "./sessions.json", "a/b/c.json", "x\\y.json"] {
            assert!(delete_one(&t.root, bad).is_err(), "`{bad}` must be refused");
        }
        let abs = t.base.join("outside.json").to_string_lossy().into_owned();
        assert!(delete_one(&t.root, &abs).is_err());
        assert!(t.base.join("outside.json").exists());
    }

    // (b) refuse while a change is applied
    #[test]
    fn b1_everything_refuses_while_a_change_is_applied_and_offers_undo_all() {
        let t = Tmp::new("b1");
        seed(&t);
        t.ledger(&[("Core parking", "applied"), ("Game mode", "rolled_back")]);
        let before = t.listing();
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(!plan.can_proceed() && plan.delete.is_empty());
        assert!(plan.refusals.iter().any(|r| r.code == "changes_applied"));
        assert_eq!(plan.applied_changes, vec!["Core parking".to_string()]);
        assert!(plan.offer_undo_all);
        match exec(&t.root, &plan, &later()) {
            ClearOutcome::Refused(r) => assert!(r.iter().any(|x| x.code == "changes_applied")),
            other => panic!("expected Refused, got {other:?}"),
        }
        assert_eq!(before, t.listing(), "a refused clear deletes nothing");
    }

    #[test]
    fn b2_any_row_that_is_not_rolled_back_counts_and_a_backup_alone_counts() {
        let t = Tmp::new("b2");
        t.ledger(&[("Old", "externally_reverted")]);
        assert!(!plan_clear(&t.root, Scope::Everything, &later()).can_proceed());
        // Main missing, backup holds an applied row: still applied.
        let t = Tmp::new("b2b");
        t.put("history.json.bak", r#"[{"id":"c","rec_id":"r","rec_title":"Core parking","applied_at":"2026-11-01T00:00:00Z","snapshot":{},"status":"applied"}]"#);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(plan.refusals.iter().any(|r| r.code == "changes_applied"), "{:?}", plan.refusals);
        // Unreadable ledger refuses too, and is never read as "no changes".
        let t = Tmp::new("b2c");
        t.put("history.json", "{ not json");
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(plan.refusals.iter().any(|r| r.code == "ledger_unreadable"));
        assert!(plan_clear(&t.root, Scope::PlayHistory, &later()).can_proceed());
    }

    #[allow(clippy::type_complexity)]
    #[test]
    fn b3_other_refusals_each_delete_nothing() {
        let cases: Vec<(&str, Box<dyn Fn(&Tmp)>, Scope, &str)> = vec![
            ("set_aside", Box::new(|t: &Tmp| t.put("history.json.corrupt", "damaged")), Scope::Everything, "ledger_set_aside"),
            ("set_aside_n", Box::new(|t: &Tmp| t.put("history.json.corrupt.1700000000-1", "damaged")), Scope::Everything, "ledger_set_aside"),
            ("gaming_live_e", Box::new(|t: &Tmp| t.put("gaming-session.json", "{}")), Scope::Everything, "gaming_mode_active"),
            ("gaming_live_p", Box::new(|t: &Tmp| t.put("gaming-session.json", "{}")), Scope::PlayHistory, "gaming_mode_active"),
            ("gaming_orphan", Box::new(|t: &Tmp| t.put("gaming-session.orphaned.json", "{}")), Scope::Everything, "gaming_orphan"),
            ("ledger_busy", Box::new(|t: &Tmp| t.put("history.json.tmp", "{}")), Scope::Everything, "ledger_busy"),
        ];
        for (tag, setup, scope, code) in cases {
            let t = Tmp::new(tag);
            seed(&t);
            setup(&t);
            let before = t.listing();
            let plan = plan_clear(&t.root, scope, &facts());
            assert!(plan.refusals.iter().any(|r| r.code == code), "{tag}: {:?}", plan.refusals);
            assert!(plan.delete.is_empty(), "{tag}");
            assert!(matches!(exec(&t.root, &plan, &facts()), ClearOutcome::Refused(_)), "{tag}");
            assert_eq!(before, t.listing(), "{tag}");
        }
        for scope in [Scope::PlayHistory, Scope::Everything] {
            let t = Tmp::new("flags");
            seed(&t);
            let capture = ClearFacts { capture_active: true, ..later() };
            assert!(plan_clear(&t.root, scope, &capture).refusals.iter().any(|r| r.code == "capture_running"));
        }
    }

    #[test]
    fn b4_play_history_goes_ahead_while_changes_are_applied_and_keeps_the_ledger_byte_for_byte() {
        let t = Tmp::new("b4");
        seed(&t);
        t.ledger(&[("Core parking", "applied")]);
        t.put("history.json.corrupt", "damaged ledger");
        t.put("gaming-session.orphaned.json", "{}");
        let family = ["history.json", "history.json.bak", "history.json.restored", "history.json.bak.corrupt", "history.json.corrupt", "gaming-session.orphaned.json"];
        let before: Vec<String> = family.iter().map(|f| t.read(f)).collect();
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(plan.can_proceed());
        assert!(plan.kept.iter().any(|k| k.rel == "experiments.json" && k.code == "trials_tied_to_changes"));
        assert!(!rels(&plan).contains(&"experiments.json"));
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete && !t.has("sessions.json") && t.has("experiments.json"));
        let after: Vec<String> = family.iter().map(|f| t.read(f)).collect();
        assert_eq!(before, after, "Clear play history must not change a ledger or Gaming Mode file");
    }

    // (c) the data root survives and the legacy copy-in is not started
    #[test]
    fn c1_the_data_root_folder_survives_and_the_legacy_copy_in_is_not_started() {
        let t = Tmp::new("c1");
        seed(&t);
        let legacy = t.base.join("Sentinel");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("history.json"), "old ledger").unwrap();
        // Control: with the root gone the copy-in WOULD run, so the assertion below can fail.
        assert!(crate::legacy_copy_in_would_run(&t.base, &t.base.join("Compy-not-there")));
        assert!(!crate::legacy_copy_in_would_run(&t.base, &t.root));
        assert!(plan_clear(&t.root, Scope::Everything, &later()).legacy_folder_present);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete, "{report:?}");
        assert!(t.root.is_dir(), "the data root folder must survive");
        assert!(!crate::legacy_copy_in_would_run(&t.base, &t.root), "a clear must not re-arm the legacy copy-in");
        assert_eq!(fs::read_to_string(legacy.join("history.json")).unwrap(), "old ledger");
        assert!(!t.has("history.json") && !t.has("history.json.bak"));
        // Nothing in the executor can remove a folder.
        let core = include_str!("data_clear.rs").split("// ---- live wrappers").next().unwrap();
        assert!(!core.contains("remove_dir"), "the core must never remove a folder");
        // An empty or missing root is never created by a clear.
        let gone = t.base.join("Compy-never-made");
        let p = plan_clear(&gone, Scope::Everything, &facts());
        assert!(p.delete.is_empty() && done(exec(&gone, &p, &facts())).complete);
        assert!(!gone.exists());
    }

    // (d) unknown files are kept and reported
    #[test]
    fn d1_files_compy_did_not_create_are_kept_and_reported() {
        let t = Tmp::new("d1");
        seed(&t);
        for f in [
            "notes.txt",
            "work-control/lease.json",
            "exports/my-own-notes.docx",
            "care/other.json",
            "history.json.old",
            "sessions.json.bak",
            "sessions-2.json",
            "history.json.bak.old",
            "Thumbs.db",
        ] {
            t.put(f, "mine");
        }
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete);
        for u in ["notes.txt", "work-control/", "exports/my-own-notes.docx", "care/other.json", "history.json.old", "sessions.json.bak", "sessions-2.json", "history.json.bak.old", "Thumbs.db"] {
            assert!(report.unknown.contains(&u.to_string()), "{u} must be reported: {:?}", report.unknown);
        }
        for f in ["notes.txt", "work-control/lease.json", "exports/my-own-notes.docx", "care/other.json", "history.json.old", "sessions.json.bak", "sessions-2.json", "history.json.bak.old", "Thumbs.db"] {
            assert!(t.has(f), "{f} must survive");
        }
        assert!(!t.has("sessions.json") && !t.has("exports/compy-report-20261120-101010123.md"));
    }

    // (e) a failure halfway is reported per file, never as success, and a re-run completes
    // (A read-only file is NOT a failure on this toolchain: `remove_file` deletes it. A file another
    // program holds open is, so the test holds two open.)
    #[cfg(windows)]
    #[test]
    fn e1_two_locked_files_are_reported_and_a_rerun_completes() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = Tmp::new("e1");
        seed(&t);
        let hold = |rel: &str| fs::OpenOptions::new().read(true).share_mode(0).open(t.root.join(rel)).unwrap();
        let locks = [hold("sessions.json"), hold("drift.json")];
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let report = done(exec(&t.root, &plan, &later()));
        assert!(!report.complete, "a failure must not be reported as complete");
        for f in ["sessions.json", "drift.json"] {
            assert!(report.failed.iter().any(|x| x.rel == f), "{f} must be reported: {:?}", report.failed);
            assert!(t.has(f), "the failed file is still there");
        }
        assert_eq!(report.failed.len(), 2);
        assert!(!report.summary().starts_with("Cleared") && report.summary().contains("Not finished"));
        assert!(!t.has("benchmark.json"), "files that could be deleted were");
        // Let go and run again: the same call finishes the rest.
        drop(locks);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert_eq!(rels(&plan).iter().filter(|r| **r == "sessions.json" || **r == "drift.json").count(), 2);
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete && report.summary().starts_with("Cleared"));
        for f in PLAY_HISTORY_FILES {
            assert!(!t.has(f), "{f}");
        }
    }
    #[cfg(windows)]
    #[test]
    fn e2_a_ledger_family_failure_stops_the_family_so_the_ledger_cannot_come_back() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = Tmp::new("e2");
        seed(&t);
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(t.root.join("history.json.bak")).unwrap();
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(exec(&t.root, &plan, &later()));
        assert!(!report.complete);
        assert!(report.failed.iter().any(|f| f.rel == "history.json.bak"));
        assert!(report.not_attempted.contains(&"history.json".to_string()), "history.json must not be tried after the backup failed");
        assert!(t.has("history.json") && t.has("history.json.bak"), "main and backup stay together");
        drop(lock);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete, "{report:?}");
        assert!(!t.has("history.json") && !t.has("history.json.bak"));
    }

    // (f) a junction or link is never followed
    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        let out = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(link).arg(target).output().unwrap();
        assert!(out.status.success(), "mklink failed: {}", String::from_utf8_lossy(&out.stdout));
    }

    #[cfg(windows)]
    #[test]
    fn f1_a_junction_leading_outside_is_not_followed() {
        let t = Tmp::new("f1");
        seed(&t);
        let other = t.base.join("other");
        fs::create_dir_all(&other).unwrap();
        for f in ["compy-report-1.md", "fps.json", "incident-observer.json", "last-known-good.json", "evidence.jsonl"] {
            fs::write(other.join(f), "must survive").unwrap();
        }
        for d in ["exports", "runtime", "care", "case-intelligence", "support"] {
            fs::remove_dir_all(t.root.join(d)).unwrap();
            junction(&t.root.join(d), &other);
        }
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        for d in ["exports", "runtime", "care", "case-intelligence", "support"] {
            assert!(plan.kept.iter().any(|k| k.rel == d && k.code == "link_left_alone"), "{d}: {:?}", plan.kept);
        }
        assert!(plan.delete.iter().all(|d| !d.rel.contains('/')), "nothing behind a link is listed");
        done(exec(&t.root, &plan, &later()));
        assert_eq!(fs::read_dir(&other).unwrap().count(), 5, "files behind the junctions must survive");
        // Swapped in after the plan was made: the single-file delete re-checks the folder itself.
        assert!(delete_one(&t.root, "exports/compy-report-1.md").is_err());
        assert!(other.join("compy-report-1.md").exists());
        for d in ["exports", "runtime", "care", "case-intelligence", "support"] {
            fs::remove_dir(t.root.join(d)).unwrap(); // removes the junction only
        }
        assert_eq!(fs::read_dir(&other).unwrap().count(), 5);
    }

    #[cfg(windows)]
    #[test]
    fn f2_a_data_root_that_is_a_junction_is_refused() {
        let t = Tmp::new("f2");
        let real = t.base.join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("sessions.json"), "must survive").unwrap();
        let link = t.base.join("Compy-link");
        junction(&link, &real);
        let plan = plan_clear(&link, Scope::PlayHistory, &later());
        assert!(plan.refusals.iter().any(|r| r.code == "root_not_a_plain_folder") && plan.delete.is_empty());
        assert!(matches!(exec(&link, &plan, &later()), ClearOutcome::Refused(_)));
        assert!(real.join("sessions.json").exists());
        fs::remove_dir(&link).unwrap();
    }

    // B1 (review r1): the Trial store is read, never moved, and its set-aside copies are never deleted
    fn trial_store(status: &str) -> String {
        format!(
            r#"{{"schema_version":1,"experiments":[{{"id":"e1","rec_id":"game-mode","rec_title":"Game mode","game":"g.exe","hypothesis":"h","created_at":"2026-11-01T00:00:00Z","status":"{status}","baseline_avg_fps":100.0,"baseline_low1_fps":60.0,"ledger_watermark":0,"applied_change_id":"","noise_floor_pct":3.0}}]}}"#
        )
    }

    #[test]
    fn t1_a_damaged_trial_store_refuses_both_choices_and_is_not_moved() {
        for scope in [Scope::PlayHistory, Scope::Everything] {
            let t = Tmp::new("t1");
            seed(&t);
            t.put("experiments.json", "{ damaged");
            let before = t.listing();
            let plan = plan_clear(&t.root, scope, &later());
            assert!(plan.refusals.iter().any(|r| r.code == "trial_state_unknown"), "{scope:?}: {:?}", plan.refusals);
            assert!(plan.delete.is_empty());
            assert_eq!(before, t.listing(), "planning must not rename the damaged store");
            assert_eq!(t.read("experiments.json"), "{ damaged");
            assert!(!t.has("experiments.json.corrupt"));
            assert!(matches!(exec(&t.root, &plan, &later()), ClearOutcome::Refused(_)));
            assert_eq!(before, t.listing());
        }
    }

    #[test]
    fn t2_trial_store_set_asides_are_kept_by_play_history_and_refuse_everything() {
        let t = Tmp::new("t2");
        seed(&t);
        t.put("experiments.json.corrupt", "damaged trial records");
        t.put("experiments.json.corrupt.1700000000", "older damaged trial records");
        t.put("experiments.json.corrupt.1700000000-1", "older still");
        let play = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(play.can_proceed(), "{:?}", play.refusals);
        for f in ["experiments.json.corrupt", "experiments.json.corrupt.1700000000", "experiments.json.corrupt.1700000000-1"] {
            assert!(play.kept.iter().any(|k| k.rel == f && k.code == "trial_record_set_aside"), "{f}: {:?}", play.kept);
            assert!(!rels(&play).contains(&f));
        }
        let report = done(exec(&t.root, &play, &later()));
        assert!(report.complete);
        assert_eq!(t.read("experiments.json.corrupt"), "damaged trial records");
        assert_eq!(t.read("experiments.json.corrupt.1700000000-1"), "older still");
        let before = t.listing();
        let every = plan_clear(&t.root, Scope::Everything, &later());
        assert!(every.refusals.iter().any(|r| r.code == "trial_record_set_aside"), "{:?}", every.refusals);
        assert!(every.delete.is_empty());
        assert!(matches!(exec(&t.root, &every, &later()), ClearOutcome::Refused(_)));
        assert_eq!(before, t.listing());
    }

    #[test]
    fn t3_a_pending_or_running_trial_means_a_change_may_be_on_and_refuses_both_choices() {
        for status in ["pending", "running"] {
            for scope in [Scope::PlayHistory, Scope::Everything] {
                let t = Tmp::new("t3");
                seed(&t);
                t.put("experiments.json", &trial_store(status));
                let before = t.listing();
                let plan = plan_clear(&t.root, scope, &later());
                assert!(plan.refusals.iter().any(|r| r.code == "trial_running"), "{status} {scope:?}: {:?}", plan.refusals);
                assert!(matches!(exec(&t.root, &plan, &later()), ClearOutcome::Refused(_)));
                assert_eq!(before, t.listing());
            }
        }
        // A finished Trial does not block.
        let t = Tmp::new("t3b");
        seed(&t);
        t.put("experiments.json", &trial_store("kept"));
        assert!(plan_clear(&t.root, Scope::PlayHistory, &later()).can_proceed());
    }

    // review r1 small items
    #[test]
    fn t4_elevated_helper_leftovers_are_not_play_history() {
        let names = [
            "elevation-batch-1700000000000.receipts",
            "gaming-elevation-ab12.receipts",
            "gaming-restore-ab12.receipts",
            "memcompress-restore-1700000000000.result",
            "runtime/elev-12-3.ticket",
        ];
        let t = Tmp::new("t4");
        seed(&t);
        for n in names {
            t.put(n, "x");
        }
        let play = plan_clear(&t.root, Scope::PlayHistory, &later());
        for n in names {
            assert!(play.kept.iter().any(|k| k.rel == n && k.code == "elevated_leftover"), "{n}: {:?}", play.kept);
            assert!(!rels(&play).contains(&n));
        }
        let every = plan_clear(&t.root, Scope::Everything, &later());
        for n in names {
            assert!(rels(&every).contains(&n), "{n} goes with Everything");
        }
        for id in ELEVATED_LEFTOVER_IDS {
            assert!(data_inventory::rows().iter().any(|r| r.id == *id), "{id} is not an inventory row");
        }
    }

    #[test]
    fn t5_a_gaming_working_file_is_named_truthfully_and_the_live_contract_still_says_running() {
        for leftover in ["gaming-session.json.tmp", ".gaming-session.json.12-3.tmp"] {
            for scope in [Scope::PlayHistory, Scope::Everything] {
                let t = Tmp::new("t5");
                seed(&t);
                t.put(leftover, "{}");
                let plan = plan_clear(&t.root, scope, &later());
                assert!(plan.refusals.iter().any(|r| r.code == "gaming_working_file"), "{leftover} {scope:?}: {:?}", plan.refusals);
                assert!(plan.refusals.iter().all(|r| r.code != "gaming_mode_active"), "{leftover}: must not claim Gaming Mode is running");
                assert!(plan.delete.is_empty());
            }
        }
        let t = Tmp::new("t5b");
        t.put("gaming-session.json", "{}");
        assert!(plan_clear(&t.root, Scope::PlayHistory, &facts()).refusals.iter().any(|r| r.code == "gaming_mode_active"));
    }

    #[test]
    fn t6_the_fingerprint_covers_size_and_modified_time() {
        let t = Tmp::new("t6");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let before = t.listing();
        // Same name, new bytes: the count the user was shown is stale.
        t.put("sessions.json", "a much longer body than before");
        assert!(matches!(exec(&t.root, &plan, &later()), ClearOutcome::PlanChanged));
        assert!(t.has("sessions.json") && t.has("drift.json"), "nothing is deleted on a mismatch");
        let _ = before;
        // Same name, same size, only the modified time moved.
        let t = Tmp::new("t6b");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let f = fs::OpenOptions::new().write(true).open(t.root.join("drift.json")).unwrap();
        f.set_modified(SystemTime::now() + Duration::from_secs(60)).unwrap();
        drop(f);
        assert!(matches!(exec(&t.root, &plan, &later()), ClearOutcome::PlanChanged));
        assert!(t.has("drift.json") && t.has("sessions.json"));
    }

    #[cfg(windows)]
    #[test]
    fn t7_delete_one_refuses_a_root_that_became_a_junction() {
        let t = Tmp::new("t7");
        let real = t.base.join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("sessions.json"), "must survive").unwrap();
        let link = t.base.join("Compy-link");
        junction(&link, &real);
        assert!(delete_one(&link, "sessions.json").is_err());
        assert!(real.join("sessions.json").exists());
        fs::remove_dir(&link).unwrap();
    }

    // (g) the ledger rule
    #[test]
    fn g1_the_ledger_family_is_split_into_refused_and_ordered_and_the_backup_goes_before_the_main_file() {
        let family: Vec<&str> = data_inventory::ledger_family().map(|r| r.id).collect();
        let mut named: Vec<&str> = LEDGER_SET_ASIDE.iter().chain(LEDGER_DELETE_ORDER).copied().collect();
        named.sort_unstable();
        let mut all = family.clone();
        all.sort_unstable();
        assert_eq!(named, all, "every ledger row is either refused-while-present or in the delete order");
        assert_eq!(LEDGER_DELETE_ORDER.last(), Some(&"ledger-main"));
        for id in [EXPERIMENTS_ID, LICENCE_ID] {
            assert!(data_inventory::rows().iter().any(|r| r.id == id), "{id} is not an inventory row");
        }
        let t = Tmp::new("g1");
        seed(&t);
        t.put("history.json.bak.tmp", "x");
        t.put("history.json.restored.tmp", "x");
        t.put("history.json.restore.tmp", "x");
        t.put("history.json.tmp", "x");
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let order = rels(&plan);
        let at = |f: &str| order.iter().position(|r| *r == f).unwrap_or_else(|| panic!("{f} not planned: {order:?}"));
        for f in ["history.json.bak", "history.json.bak.tmp", "history.json.restored", "history.json.restore.tmp", "history.json.tmp", "history.json.bak.corrupt"] {
            assert!(at(f) < at("history.json"), "{f} must be deleted before history.json");
        }
        assert!(at("history.json") < at("experiments.json") && at("sessions.json") < at("support/evidence.jsonl"));
        assert_eq!(at("support/evidence.jsonl"), order.len() - 1, "the support record goes last");
        let report = done(exec(&t.root, &plan, &later()));
        assert!(report.complete);
        let pos = |f: &str| report.deleted.iter().position(|d| d == f).unwrap();
        assert!(pos("history.json.bak") < pos("history.json"));
        // Backup-only leftovers (main already gone) are removed too, so no ledger can be restored.
        let t = Tmp::new("g1b");
        t.put("history.json.bak", "[]");
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(rels(&plan).contains(&"history.json.bak"));
        assert!(done(exec(&t.root, &plan, &later())).complete);
        assert_eq!(crate::history::not_rolled_back_titles_at(&t.root.join("history.json")).unwrap(), Vec::<String>::new());
        assert!(!t.has("history.json.bak"));
    }

    #[test]
    fn g2_play_history_never_lists_a_history_json_name_or_a_set_aside() {
        let t = Tmp::new("g2");
        seed(&t);
        for f in ["history.json.corrupt", "history.json.tmp", "history.json.bak.tmp", "gaming-session.orphaned-2.json"] {
            t.put(f, "x");
        }
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(plan.can_proceed());
        assert!(plan.delete.iter().all(|d| !d.rel.starts_with("history.json") && !d.rel.starts_with("gaming-session")), "{:?}", rels(&plan));
        assert!(plan.kept.iter().any(|k| k.rel == "gaming-session.orphaned-2.json" && k.code == "undo_data"));
    }

    // working files and licence
    #[test]
    fn w1_a_fresh_working_file_is_kept_and_the_licence_goes_only_when_asked() {
        let t = Tmp::new("w1");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &facts());
        assert!(plan.kept.iter().any(|k| k.rel == ".drift.json.12-3.tmp" && k.code == "working_file_in_use"));
        assert!(!rels(&plan).contains(&".drift.json.12-3.tmp") && rels(&plan).contains(&"sessions.json"));
        let keep = plan_clear(&t.root, Scope::Everything, &later());
        assert!(keep.kept.iter().any(|k| k.rel == "license.key" && k.code == "licence_kept") && !rels(&keep).contains(&"license.key"));
        let drop_it = plan_clear(&t.root, Scope::Everything, &ClearFacts { remove_licence: true, ..later() });
        assert!(rels(&drop_it).contains(&"license.key"));
    }

    // (h) the browser-side keys come from the inventory's key list
    #[test]
    fn h1_browser_keys_come_from_the_inventory_list() {
        let t = Tmp::new("h1");
        let play = plan_clear(&t.root, Scope::PlayHistory, &facts());
        let all = plan_clear(&t.root, Scope::Everything, &facts());
        assert_eq!(all.webview.len(), data_inventory::webview_keys().len());
        assert!(play.webview.iter().any(|w| w.key == "compy_last_check_v1" && !w.prefix));
        assert!(play.webview.iter().any(|w| w.key == "compy_bb_helpful_" && w.prefix));
        for kept in ["compy_theme", "compy_lang", "compy_onboarded_v1", "compy_dismissed_recs", "compy_feedback_draft"] {
            assert!(play.webview.iter().all(|w| w.key != kept), "{kept} is a choice and stays");
            assert!(all.webview.iter().any(|w| w.key == kept), "{kept} is cleared by Everything");
        }
        assert!(all.webview.iter().any(|w| w.key == "compy_autopsy_text" && w.session_storage));
    }

    // the safety rule for this slice: the core cannot reach the real data root
    #[test]
    fn s1_the_core_never_resolves_a_data_root() {
        let core = include_str!("data_clear.rs").split("// ---- live wrappers").next().unwrap();
        for forbidden in ["compy_data_dir", "mutation_root", "session_data_dir", "effective_root", "decision()"] {
            let code: String = core.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
            assert!(!code.contains(forbidden), "the core must take its root as an argument, found {forbidden}");
        }
    }

    #[test]
    fn s2_every_row_the_planner_can_delete_is_an_inventory_row() {
        // classify() is the only path to a delete: a name with no row has no verdict.
        let ctx = build_ctx();
        for name in ["notes.txt", "history.json.old", "sessions.json.bak", "work-control", "compy_comparison.json.zip"] {
            assert!(classify(name, &ctx).is_none(), "{name}");
        }
        for name in ["sessions.json", "history.json.bak.corrupt.2", "exports/compy-support-full-20261120-1.json", "gaming-restore-ab12-cd.receipts", "runtime/elev-12-3.ticket", "memcompress-restore-1700000000000.result"] {
            assert!(classify(name, &ctx).is_some(), "{name}");
        }
    }

    // ===== D6: locks, memory, typed outcomes, ledger lock, handle delete, recorder, blocking =========

    use crate::race_seam::{held_now, StoreLock};
    use std::cell::RefCell;
    use std::sync::Mutex;

    fn lock_for(gate: Gate) -> StoreLock {
        match gate {
            Gate::Sessions => StoreLock::Sessions,
            Gate::Benchmark => StoreLock::Benchmark,
            Gate::Scoreboard => StoreLock::BenchmarkScoreboard,
            Gate::NoiseFloor => StoreLock::NoiseFloor,
            Gate::Comparison => StoreLock::Comparison,
            Gate::Drift => StoreLock::Drift,
            Gate::IncidentObserver => StoreLock::IncidentObserver,
            Gate::Intelligence => StoreLock::Intelligence,
            Gate::HardwareFingerprint => StoreLock::HardwareFingerprint,
            Gate::Readiness => StoreLock::Readiness,
            Gate::SupportEvidence => StoreLock::SupportEvidence,
            Gate::Experiment => StoreLock::Experiment,
            Gate::Ledger | Gate::Unlocked => panic!("{gate:?} has no store lock of its own"),
        }
    }

    /// Effects with instances of the test's own: nothing process-wide (epoch, benchmark cache, trial state,
    /// incident flags) is read or written by any test.
    struct TestEffects {
        epoch: crate::atomic_write::ClearEpochs,
        bench: RefCell<crate::benchmark::BenchmarkState>,
        bench_lock: &'static Mutex<u8>, // leaked: the recorded guard must be static
        bench_resets: std::cell::Cell<u32>,
        trial_forgets: std::cell::Cell<u32>,
        incident_forgets: std::cell::Cell<u32>,
        support_forgets: std::cell::Cell<u32>,
        identity_forgets: std::cell::Cell<u32>,
        /// What the "running app" is doing now; a test flips it between the plan and the delete.
        live: std::cell::Cell<LiveState>,
    }

    impl TestEffects {
        fn new() -> Self {
            let bench = crate::benchmark::BenchmarkState {
                baseline_at: Some("2026-11-01T00:00:00Z".into()),
                error: Some("old".into()),
                ..Default::default()
            };
            Self {
                epoch: crate::atomic_write::ClearEpochs::new(),
                bench: RefCell::new(bench),
                bench_lock: Box::leak(Box::new(std::sync::Mutex::new(0u8))),
                bench_resets: Default::default(),
                trial_forgets: Default::default(),
                incident_forgets: Default::default(),
                support_forgets: Default::default(),
                identity_forgets: Default::default(),
                live: Default::default(),
            }
        }
    }

    impl ClearEffects for TestEffects {
        fn deleted(&self, store: &'static str) {
            self.epoch.bump(store);
        }
        fn with_benchmark_locked(&self, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
            // The same shape as the process's: a recorded Benchmark lock held across the delete, then the
            // reset of a copy the test owns. The real cache is never touched.
            let _lock = crate::race_seam::hold_lock(StoreLock::Benchmark, || self.bench_lock.lock().unwrap());
            let result = delete();
            if result.is_ok() {
                crate::benchmark::reset_for_clear(&mut self.bench.borrow_mut());
                self.bench_resets.set(self.bench_resets.get() + 1);
            }
            result
        }
        fn forget_trial_result(&self) {
            self.trial_forgets.set(self.trial_forgets.get() + 1);
        }
        fn forget_incident_failures(&self) {
            self.incident_forgets.set(self.incident_forgets.get() + 1);
        }
        fn forget_support_preview(&self) {
            self.support_forgets.set(self.support_forgets.get() + 1);
        }
        fn forget_identity_throttle(&self) {
            self.identity_forgets.set(self.identity_forgets.get() + 1);
        }
        fn live_state(&self) -> LiveState {
            self.live.get()
        }
    }

    /// The real gates, with a look at what this thread holds while each file goes.
    struct Probe {
        seen: RefCell<Vec<(Gate, Vec<StoreLock>)>>,
        fx: TestEffects,
    }

    impl Probe {
        fn new() -> Self {
            Probe { seen: RefCell::new(Vec::new()), fx: TestEffects::new() }
        }
    }

    impl ClearGates for Probe {
        fn with_gate(&self, gate: Gate, store: &'static str, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
            LiveGates(&self.fx).with_gate(gate, store, &mut || {
                self.seen.borrow_mut().push((gate, held_now()));
                delete()
            })
        }
        fn live_state(&self) -> LiveState {
            self.fx.live_state()
        }
    }

    // (1) every writer of a deleted store is excluded: one lock per store, one at a time
    #[test]
    fn x1_every_store_is_deleted_under_its_own_lock_and_nothing_else_is_held() {
        let t = Tmp::new("x1");
        seed(&t);
        t.put("support/evidence.jsonl.tmp", "x");
        let probe = Probe::new();
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let report = done(execute_clear(&t.root, &plan, &later(), &probe));
        assert!(report.complete, "{report:?}");
        let seen = probe.seen.borrow();
        let gates: Vec<Gate> = seen.iter().map(|(g, _)| *g).collect();
        for g in [Gate::Sessions, Gate::Benchmark, Gate::Scoreboard, Gate::NoiseFloor, Gate::Comparison, Gate::Drift, Gate::IncidentObserver, Gate::Intelligence, Gate::HardwareFingerprint, Gate::Experiment] {
            assert!(gates.contains(&g), "{g:?} was not taken: {gates:?}");
        }
        for (gate, held) in seen.iter() {
            assert_eq!(held, &vec![lock_for(*gate)], "{gate:?}: exactly its own lock, nothing else held");
        }
        assert!(held_now().is_empty(), "nothing is held afterwards");
        // The same through `Everything`: the ledger family and Trial store under [Experiment, History],
        // every other store alone, the support record last.
        let t = Tmp::new("x1b");
        seed(&t);
        let probe = Probe::new();
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let outcome = clear_everything_at(&t.root, &plan.fingerprint, &later, &probe);
        let report = done(outcome);
        assert!(report.complete, "{report:?}");
        let seen = probe.seen.borrow();
        for (gate, held) in seen.iter() {
            assert_eq!(held, &vec![lock_for(*gate)], "{gate:?}");
            assert!(!matches!(gate, Gate::Experiment | Gate::Ledger), "phase 1 owns those, not a per-file gate");
        }
        assert_eq!(seen.last().map(|(g, _)| *g), Some(Gate::SupportEvidence), "the support record goes last");
        assert!(held_now().is_empty());
    }

    // (1) every concrete inventory row is gated or has a written reason it needs no gate
    #[test]
    fn x2_every_concrete_inventory_row_is_gated_or_explained() {
        for row in data_root_rows() {
            if row.path.contains('<') || row.id.starts_with("ledger-") {
                continue;
            }
            let stem = stem_of(row.path);
            let gated = GATED_STEMS.iter().any(|(s, _)| *s == stem);
            let unlocked = UNLOCKED_STEMS.iter().any(|(s, why)| *s == stem && why.len() > 20);
            assert!(gated ^ unlocked, "{} (stem {stem}) must be in exactly one of GATED_STEMS / UNLOCKED_STEMS", row.id);
        }
        for (stem, _) in GATED_STEMS {
            assert!(data_root_rows().any(|r| stem_of(r.path) == *stem), "GATED_STEMS names `{stem}`, which no inventory row has");
        }
    }

    // (1) the secondary files of a store (set-asides, temp files) take the owner's gate
    #[test]
    fn x3_secondary_files_take_their_stores_gate() {
        let t = Tmp::new("x3");
        seed(&t);
        t.put("care/incident-observer.12.3.json.tmp", "x");
        t.put("sessions.json.tmp", "x");
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let gate_for = |rel: &str| gate_of(plan.delete.iter().find(|d| d.rel == rel).unwrap_or_else(|| panic!("{rel} not planned")));
        assert_eq!(gate_for("sessions.json.corrupt.123"), Gate::Sessions);
        assert_eq!(gate_for("sessions.json.tmp"), Gate::Sessions);
        assert_eq!(gate_for(".drift.json.12-3.tmp"), Gate::Drift);
        assert_eq!(gate_for("care/incident-observer.12.3.json.tmp"), Gate::IncidentObserver);
        assert_eq!(gate_for("runtime/fps.json"), Gate::Unlocked);
    }

    // (2) a save racing a clear never resurrects old rows: the real gate bumps the epoch under the lock
    #[test]
    fn x4_a_real_delete_moves_the_clear_epoch_so_an_earlier_save_is_dropped() {
        let t = Tmp::new("x4");
        seed(&t);
        let fx = TestEffects::new();
        let before = fx.epoch.now("sessions");
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(done(execute_clear(&t.root, &plan, &later(), &LiveGates(&fx))).complete);
        assert!(fx.epoch.now("sessions") > before, "a delete under the store lock must move that store's epoch");
        // Each memory reset ran once, for its own store, after a delete that worked.
        assert_eq!(fx.bench_resets.get(), 1, "the benchmark cache is reset once");
        assert!(fx.bench.borrow().baseline_at.is_none() && fx.bench.borrow().error.is_none(), "and the copy it was handed is empty");
        assert_eq!(fx.trial_forgets.get(), 1, "the finished trial result is forgotten once");
        assert_eq!(fx.incident_forgets.get(), 1, "the incident failure flags are forgotten once");
        // Nothing to delete (second run): no delete happened, so nothing needs dropping.
        let mid = fx.epoch.now("sessions");
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(plan.nothing_to_do());
        assert_eq!(fx.epoch.now("sessions"), mid, "planning is a pure read");
    }

    // (3) typed outcome: codes, never one joined string; "couldn't read" is not "nothing to do"
    #[test]
    fn x5_refusals_come_back_as_a_typed_list_and_serialize_with_their_codes() {
        let t = Tmp::new("x5");
        seed(&t);
        let busy = ClearFacts { capture_active: true, recorder_busy: true, benchmark_trial_running: true, ..later() };
        let plan = plan_clear(&t.root, Scope::PlayHistory, &busy);
        let before = t.listing();
        let outcome = clear_play_history_at(&t.root, &plan.fingerprint, &busy, &NoGates);
        let ClearOutcome::Refused(reasons) = &outcome else { panic!("expected Refused, got {outcome:?}") };
        let codes: Vec<&str> = reasons.iter().map(|r| r.code).collect();
        assert_eq!(codes, ["capture_running", "recording_in_progress", "benchmark_trial_running"], "one typed entry each");
        assert_eq!(before, t.listing(), "a refusal deletes nothing");
        let json = serde_json::to_value(&outcome).unwrap();
        assert_eq!(json["status"], "refused");
        assert_eq!(json["detail"][1]["code"], "recording_in_progress");
        let stale = clear_play_history_at(&t.root, "not-the-fingerprint", &later(), &NoGates);
        assert_eq!(serde_json::to_value(&stale).unwrap()["status"], "plan_changed");
    }

    #[test]
    fn x6_couldnt_read_and_nothing_to_do_are_different_answers() {
        // Nothing there: a clean, empty answer.
        let t = Tmp::new("x6");
        let empty = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(empty.nothing_to_do() && empty.can_proceed());
        let report = done(exec(&t.root, &empty, &later()));
        assert!(report.nothing_to_do && report.complete && report.summary() == "Nothing to clear.");
        // A Trial store that cannot be read: a refusal with its own code, not "nothing to do".
        t.put("sessions.json", "x");
        t.put("experiments.json", "{ damaged");
        let unreadable = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(!unreadable.nothing_to_do());
        assert!(unreadable.refusals.iter().any(|r| r.code == "trial_state_unknown"));
        // A ledger that cannot be read refuses Everything with its own code.
        let t = Tmp::new("x6b");
        t.put("history.json", "{ not a ledger");
        let every = plan_clear(&t.root, Scope::Everything, &later());
        assert!(!every.nothing_to_do() && every.refusals.iter().any(|r| r.code == "ledger_unreadable"));
        // A wrapper that cannot even start answers with a typed plan, not a string.
        let none = ClearPlan::refused(Scope::PlayHistory, "data_root_unavailable", "why");
        assert!(!none.nothing_to_do() && none.refusals[0].code == "data_root_unavailable" && none.delete.is_empty());
    }

    // (4) the change-history family cannot be deleted without the ledger lock
    #[test]
    fn x7_play_history_entry_refuses_an_everything_plan_and_deletes_nothing() {
        let t = Tmp::new("x7");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let before = t.listing();
        let ClearOutcome::Refused(r) = execute_clear(&t.root, &plan, &later(), &NoGates) else { panic!("must refuse") };
        assert_eq!(r[0].code, "ledger_lock_required");
        assert_eq!(before, t.listing());
        // And the ledger phase, handed an Everything-less plan, refuses too.
        let play = plan_clear(&t.root, Scope::PlayHistory, &later());
        let _gate = crate::experiment::lock_store().unwrap();
        let _ledger = crate::history::lock_ledger().unwrap();
        assert!(matches!(ledger_phase(&t.root, &play, &later(), &delete_one), Err(ClearOutcome::Refused(_))));
    }

    #[test]
    fn x8_the_ledger_family_goes_while_the_trial_gate_and_the_ledger_lock_are_both_held() {
        let t = Tmp::new("x8");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let gate = crate::experiment::lock_trial_gate().unwrap();
        let ledger = crate::history::lock_ledger().unwrap();
        let seen = RefCell::new(Vec::new());
        let phase = ledger_phase(&t.root, &plan, &later(), &|root, rel| {
            seen.borrow_mut().push((rel.to_string(), held_now()));
            delete_one(root, rel)
        });
        let phase = phase.expect("phase 1 runs");
        drop(ledger);
        drop(gate);
        let seen = seen.borrow();
        assert!(seen.iter().any(|(rel, _)| rel == "history.json") && seen.iter().any(|(rel, _)| rel == "history.json.bak"));
        for (rel, held) in seen.iter() {
            assert_eq!(held, &vec![StoreLock::Experiment, StoreLock::History], "{rel}: Experiment then History, the declared order");
        }
        let pos = |f: &str| seen.iter().position(|(r, _)| r == f).unwrap();
        assert!(pos("history.json.bak") < pos("history.json"), "backup before main");
        assert!(held_now().is_empty());
        // Phase 2 then takes nothing from phase 1's locks.
        assert!(done(finish_everything(&t.root, phase, &NoGates)).complete);
        assert!(!t.has("history.json") && !t.has("sessions.json") && !t.has("support/evidence.jsonl"));
    }

    #[test]
    fn x9_a_change_applied_before_the_locks_were_taken_is_seen_under_them() {
        let t = Tmp::new("x9");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        assert!(shown.can_proceed());
        // An apply lands after the screen read its plan: the re-plan under the locks sees it.
        t.ledger(&[("Game mode", "applied")]);
        let before = t.listing();
        let outcome = clear_everything_at(&t.root, &shown.fingerprint, &later, &NoGates);
        assert!(!matches!(outcome, ClearOutcome::Done(_)), "must not delete: {outcome:?}");
        assert_eq!(before, t.listing());
        assert!(t.has("history.json") && t.has("history.json.bak"));
    }

    #[test]
    fn x10_the_signature_of_the_ledger_phase_takes_the_ledger_guard_and_nothing_else_locks_history() {
        let core = include_str!("data_clear.rs").split("// ---- live wrappers").next().unwrap();
        let sig = core.split("pub(crate) fn execute_everything_ledger_phase(").nth(1).and_then(|r| r.split(") ->").next()).unwrap();
        assert!(sig.contains("&crate::history::LedgerGuard"), "the ledger lock must be a parameter: {sig}");
        assert!(sig.contains("&crate::experiment::TrialGuard"), "the Trial gate must be a parameter of its own type: {sig}");
        assert!(!sig.contains("StoreGuard"), "no bare StoreGuard stands in for either gate: {sig}");
        let code: String = core.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        assert!(!code.contains(concat!("lock_", "history(")), "the ledger lock comes only through history::lock_ledger");
        assert_eq!(code.matches("history::lock_ledger()").count(), 1, "exactly one place takes it: clear_everything_at");
        let exp = code.find("experiment::lock_trial_gate()").expect("the Trial gate");
        let led = code.find("history::lock_ledger()").expect("the ledger lock");
        assert!(exp < led, "Experiment, then History: the declared nesting");
    }

    // ===== D7 item 3: the Trial gate has a type of its own ===========================================

    #[test]
    fn y1_the_trial_gate_is_a_type_only_the_trial_stores_lock_function_makes() {
        use std::any::TypeId;
        // Not a StoreGuard: a sessions, history or any other store guard cannot be passed for it.
        assert_ne!(TypeId::of::<crate::experiment::TrialGuard>(), TypeId::of::<crate::race_seam::StoreGuard>());
        assert_ne!(TypeId::of::<crate::experiment::TrialGuard>(), TypeId::of::<crate::history::LedgerGuard>());
        // Constructible in exactly one place: its struct and the one literal in `lock_trial_gate`.
        let exp = include_str!("experiment.rs");
        assert_eq!(exp.matches("TrialGuard {").count(), 2, "the struct and its single constructor");
        assert!(exp.contains("lock_store().map(|_guard| TrialGuard { _guard })"), "built only from the Trial store's own lock");
        let core = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        assert!(!core.contains("TrialGuard {"), "the clear never builds one");
        // The private field means no struct literal outside experiment.rs compiles either; and the one
        // function taking it is the ledger phase.
        assert_eq!(core.matches("&crate::experiment::TrialGuard").count(), 1);
    }

    #[test]
    fn y2_the_public_ledger_phase_runs_with_the_two_guards_and_the_clear_goes_on_to_the_rest() {
        let t = Tmp::new("y2");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(plan.can_proceed(), "{:?}", plan.refusals);
        let trial = crate::experiment::lock_trial_gate().unwrap();
        let ledger = crate::history::lock_ledger().unwrap();
        let phase = execute_everything_ledger_phase(&t.root, &plan, &later(), &trial, &ledger).ok().expect("phase 1");
        drop(ledger);
        drop(trial);
        assert!(!t.has("history.json") && !t.has("history.json.bak") && !t.has("experiments.json"));
        assert!(done(finish_everything(&t.root, phase, &NoGates)).complete);
    }

    // (5) handle-based delete
    #[cfg(windows)]
    #[test]
    fn x11_a_folder_swapped_for_a_junction_between_the_check_and_the_delete_is_not_followed() {
        let t = Tmp::new("x11");
        let other = t.base.join("other");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("incident-observer.json"), "must survive").unwrap();
        t.put("care/incident-observer.json", "mine");
        let swap = || {
            fs::remove_dir_all(t.root.join("care")).unwrap();
            junction(&t.root.join("care"), &other);
        };
        let r = delete_one_with(&t.root, "care/incident-observer.json", &swap);
        assert!(r.is_err(), "a swapped folder must stop the delete: {r:?}");
        assert!(r.unwrap_err().contains("swapped"), "and say why");
        assert_eq!(fs::read_to_string(other.join("incident-observer.json")).unwrap(), "must survive");
        fs::remove_dir(t.root.join("care")).unwrap(); // the junction only
        assert!(other.join("incident-observer.json").exists());
    }

    #[cfg(windows)]
    #[test]
    fn x12_a_file_deletes_by_handle_including_a_read_only_one() {
        let t = Tmp::new("x12");
        t.put("sessions.json", "x");
        t.put("drift.json", "x");
        let mut perms = fs::metadata(t.root.join("drift.json")).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(t.root.join("drift.json"), perms).unwrap();
        assert!(matches!(delete_one(&t.root, "sessions.json"), Ok(Removed::Deleted)));
        assert!(matches!(delete_one(&t.root, "drift.json"), Ok(Removed::Deleted)), "read-only is not a reason to keep it");
        assert!(!t.has("sessions.json") && !t.has("drift.json"));
        assert!(matches!(delete_one(&t.root, "sessions.json"), Ok(Removed::AlreadyGone)));
    }

    #[cfg(windows)]
    #[test]
    fn x13_a_file_held_open_by_someone_else_is_reported_not_deleted_through_the_handle_path() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = Tmp::new("x13");
        t.put("sessions.json", "x");
        let _hold = fs::OpenOptions::new().read(true).share_mode(0).open(t.root.join("sessions.json")).unwrap();
        assert!(delete_one(&t.root, "sessions.json").is_err());
        assert!(t.has("sessions.json"));
    }

    // (6) the recorder's own state, not a sleep
    #[test]
    fn x14_an_unsaved_session_refuses_the_clear_and_the_recorder_state_is_read_from_the_recorder() {
        let t = Tmp::new("x14");
        seed(&t);
        let unsaved = ClearFacts { recorder_busy: true, ..later() };
        let plan = plan_clear(&t.root, Scope::PlayHistory, &unsaved);
        assert!(plan.refusals.iter().any(|r| r.code == "recording_in_progress") && plan.delete.is_empty());
        assert!(matches!(exec(&t.root, &plan, &unsaved), ClearOutcome::Refused(_)));
        assert!(t.has("sessions.json"));
        // Everything refuses for the same reason.
        let every = plan_clear(&t.root, Scope::Everything, &unsaved);
        assert!(every.refusals.iter().any(|r| r.code == "recording_in_progress"));
        // The live fact comes from the recorder (a gauge the accumulator and `save_session` move), and a
        // capture flag alone is not read as "done".
        let src = include_str!("data_clear.rs");
        let facts_fn = src.split("fn live_facts(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(facts_fn.contains("ProcessEffects.live_state()"), "the facts and the in-gate re-check read the same function");
        let live = src.split("impl ClearEffects for ProcessEffects").nth(1).unwrap().split("fn live_state(&self) -> LiveState {").nth(1).unwrap().split("\n    }\n").next().unwrap();
        assert!(live.contains("sessions::recorder_busy()"), "{live}");
        assert!(live.contains("fps_active()"), "the capture flag is still read too");
    }

    // (7) blocking, off the UI thread: plain Send functions that capture no Tauri handle
    // Type-level only: the wrappers themselves are deliberately NOT referenced here. Calling or even naming
    // them links the live app (monitoring, data root) into the test binary, which then needs the app's
    // Windows manifest to start (STATUS_ENTRYPOINT_NOT_FOUND), and a test must never reach the real root.
    fn assert_blockable<R: Send + 'static>() {}

    #[test]
    fn x15_the_wrappers_can_be_handed_to_spawn_blocking() {
        // What a `spawn_blocking` closure returns must be owned and `Send`; its arguments are `String`/`bool`.
        assert_blockable::<ClearOutcome>();
        assert_blockable::<ClearPlan>();
        let src = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        for sig in [
            "pub(crate) fn clear_play_history(expected_fingerprint: &str) -> ClearOutcome",
            "pub(crate) fn clear_everything(expected_fingerprint: &str, remove_licence: bool) -> ClearOutcome",
            "pub(crate) fn plan_clear_play_history() -> ClearPlan",
            "pub(crate) fn plan_clear_everything(remove_licence: bool) -> ClearPlan",
        ] {
            assert!(src.contains(sig), "the wrapper signature changed: {sig}");
        }
        // Not Tauri-aware: no handle type anywhere outside the test module.
        let all = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        let code: String = all.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        for forbidden in [concat!("App", "Handle"), concat!("tauri", "::"), "tauri::command", "#[tauri"] {
            assert!(!code.contains(forbidden), "found {forbidden}: the core and wrappers must not know Tauri");
        }
    }

    // (2) restart_required is honest: true while any copy has no reset, with each reason named
    #[test]
    fn x16_restart_is_required_with_the_specific_reasons_until_every_copy_is_reset() {
        let t = Tmp::new("x16");
        seed(&t);
        let play = plan_clear(&t.root, Scope::PlayHistory, &later());
        let report = done(exec(&t.root, &play, &later()));
        assert!(report.restart_required, "the screen's own memory is not reset by the backend");
        assert_eq!(report.restart_reasons, ["screen_memory"], "play history: only the window's memory");
        let every = restart_reasons_in(MEMORY_COPIES, Scope::Everything);
        assert_eq!(every, ["screen_memory"], "everything: only the WebView copy has no reset (UI slice)");
        // Every copy that HAS a reset names a gate the executor really takes; none is listed as a reason.
        for c in MEMORY_COPIES.iter().filter(|c| c.reset_by.is_some()) {
            assert!(!every.contains(&c.reason), "{} is reset, so it is not a reason", c.reason);
        }
        // False only when every applicable copy is reset (a table where all of them are).
        let all_reset = [
            MemoryCopy { reason: "a", holder: "x", everything_only: false, reset_by: Some(Gate::Benchmark) },
            MemoryCopy { reason: "b", holder: "y", everything_only: true, reset_by: Some(Gate::Scoreboard) },
        ];
        assert!(restart_reasons_in(&all_reset, Scope::Everything).is_empty());
        // An unreset copy that only applies to Everything does not force a restart after play history.
        let only_everything = [MemoryCopy { reason: "c", holder: "z", everything_only: true, reset_by: None }];
        assert!(restart_reasons_in(&only_everything, Scope::PlayHistory).is_empty());
        assert_eq!(restart_reasons_in(&only_everything, Scope::Everything), ["c"]);
    }

    // (5) a file that vanished between the checks and the open is AlreadyGone, never Deleted
    #[test]
    fn x17_a_file_gone_before_the_open_is_reported_as_already_gone() {
        let t = Tmp::new("x17");
        t.put("sessions.json", "[]");
        let p = t.root.join("sessions.json");
        let out = delete_one_with(&t.root, "sessions.json", &|| std::fs::remove_file(&p).unwrap()).unwrap();
        assert_eq!(out, Removed::AlreadyGone);
        t.put("sessions.json", "[]");
        assert_eq!(delete_one(&t.root, "sessions.json").unwrap(), Removed::Deleted);
    }

    // ===== D7 item 1: one epoch per store =============================================================

    #[test]
    fn p1_clearing_other_stores_does_not_move_the_sessions_or_observer_epoch() {
        // Only drift and the hardware fingerprint exist: a clear deletes them and nothing of sessions.
        let t = Tmp::new("p1");
        t.put("drift.json", "x");
        t.put("hardware-fingerprint.json", "x");
        let fx = TestEffects::new();
        let (sessions0, observer0) = (fx.epoch.now("sessions"), fx.epoch.now("incident-observer"));
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(done(execute_clear(&t.root, &plan, &later(), &LiveGates(&fx))).complete);
        assert!(fx.epoch.now("drift") > 0 && fx.epoch.now("hardware-fingerprint") > 0, "the stores it deleted moved");
        assert_eq!(fx.epoch.now("sessions"), sessions0, "an in-flight session save is not dropped by a drift clear");
        assert_eq!(fx.epoch.now("incident-observer"), observer0, "nor is an incident scan");
        assert_eq!(fx.epoch.now("support-evidence"), 0, "a store play history never touches stays at 0");
    }

    #[test]
    fn p2_clearing_sessions_moves_the_sessions_epoch_and_only_that_one() {
        let t = Tmp::new("p2");
        t.put("sessions.json", "x");
        t.put("sessions.json.corrupt.123", "x"); // a set-aside belongs to the same store
        let fx = TestEffects::new();
        let started = fx.epoch.now("sessions"); // a save begins
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(plan.delete.iter().all(|d| d.store == "sessions"), "{:?}", plan.delete);
        assert!(done(execute_clear(&t.root, &plan, &later(), &LiveGates(&fx))).complete);
        assert_ne!(fx.epoch.now("sessions"), started, "the stale sessions save is dropped");
        for other in ["drift", "incident-observer", "benchmark", "scoreboard", "intelligence", "support-evidence"] {
            assert_eq!(fx.epoch.now(other), 0, "{other} was not cleared, so its epoch did not move");
        }
    }

    #[test]
    fn p3_every_planned_delete_names_a_real_store_and_the_epoch_keys_the_savers_use_are_inventory_ids() {
        let t = Tmp::new("p3");
        seed(&t);
        t.put("care/incident-observer.12.3.json.tmp", "x");
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(!plan.delete.is_empty());
        for d in &plan.delete {
            assert!(data_root_rows().any(|r| r.id == d.store), "{} names store `{}`, which is no inventory row", d.rel, d.store);
        }
        let store_of = |rel: &str| plan.delete.iter().find(|d| d.rel == rel).unwrap_or_else(|| panic!("{rel}")).store;
        assert_eq!(store_of("sessions.json.corrupt.123"), "sessions");
        assert_eq!(store_of(".drift.json.12-3.tmp"), "drift");
        assert_eq!(store_of("care/incident-observer.12.3.json.tmp"), "incident-observer");
        // The two savers that read an epoch use these ids, and they are inventory rows (D7 item 1).
        for (file, id) in [("sessions.rs", "sessions"), ("incident_observer.rs", "incident-observer")] {
            assert!(data_root_rows().any(|r| r.id == id), "{id}");
            let src = match file {
                "sessions.rs" => include_str!("sessions.rs"),
                _ => include_str!("incident_observer.rs"),
            };
            assert!(src.contains(&format!("const CLEAR_STORE: &str = \"{id}\";")), "{file} must key its epoch by `{id}`");
        }
    }

    // ===== D7 item 6: every memory copy that has a safe reset gets one, through ClearEffects ===========

    #[test]
    fn m1_everything_resets_the_support_preview_and_the_identity_throttle_with_the_rest() {
        let t = Tmp::new("m1");
        seed(&t);
        let fx = TestEffects::new();
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(clear_everything_at(&t.root, &plan.fingerprint, &later, &LiveGates(&fx)));
        assert!(report.complete, "{report:?}");
        assert_eq!(
            (fx.bench_resets.get(), fx.trial_forgets.get(), fx.incident_forgets.get(), fx.support_forgets.get(), fx.identity_forgets.get()),
            (1, 1, 1, 1, 1),
            "each copy is reset exactly once, after a delete of its own store that worked"
        );
        assert_eq!(report.restart_reasons, ["screen_memory"], "only the WebView's own copy is left, and the screen owns it");
        assert!(report.restart_required);
    }

    #[test]
    fn m2_play_history_resets_the_identity_throttle_but_not_the_support_preview() {
        let t = Tmp::new("m2");
        seed(&t);
        let fx = TestEffects::new();
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(done(execute_clear(&t.root, &plan, &later(), &LiveGates(&fx))).complete);
        assert!(t.has("support/evidence.jsonl"), "play history keeps the support record");
        assert_eq!(fx.support_forgets.get(), 0, "so the preview of it is still true");
        assert_eq!(fx.identity_forgets.get(), 1, "the identity log was deleted, so its throttle goes");
    }

    #[cfg(windows)]
    #[test]
    fn m3_a_reset_runs_only_after_a_delete_that_worked_and_a_failed_delete_resets_nothing() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = Tmp::new("m3");
        t.put("intelligence.json", "x");
        t.put("support/evidence.jsonl", "x");
        let fx = TestEffects::new();
        let _hold = fs::OpenOptions::new().read(true).share_mode(0).open(t.root.join("intelligence.json")).unwrap();
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(clear_everything_at(&t.root, &plan.fingerprint, &later, &LiveGates(&fx)));
        assert!(!report.complete && report.failed.iter().any(|f| f.rel == "intelligence.json"), "{report:?}");
        assert_eq!(fx.identity_forgets.get(), 0, "the identity log is still there: its throttle is not reset");
        assert_eq!(fx.support_forgets.get(), 1, "the support record went, so its preview flag did");
    }

    #[test]
    fn m4_every_copy_in_the_list_with_a_reset_names_a_gate_and_the_only_one_without_is_the_webview() {
        for c in MEMORY_COPIES {
            match c.reset_by {
                Some(g) => assert!(GATED_STEMS.iter().any(|(_, gate)| *gate == g), "{}: reset gate {g:?} is a real store gate", c.reason),
                None => assert_eq!(c.reason, "screen_memory", "{} has no reset and is not the window's own copy", c.reason),
            }
        }
        // Each owner API exists where the list says it does (the effect calls it).
        let core = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        for api in ["support_evidence::forget_preview()", "intelligence::forget_refresh_throttle()", "benchmark::reset_for_clear(", "incident_observer::forget_failure_streak()", "benchmark_trial::forget_finished_result()"] {
            assert!(core.contains(api), "ProcessEffects must call {api}");
        }
    }

    // ===== D7 item 4: the state is read again INSIDE the gate, right before the delete =================

    fn running(f: impl FnOnce(&mut LiveState)) -> LiveState {
        let mut s = LiveState::default();
        f(&mut s);
        s
    }

    /// The real gates over a `TestEffects`; after `after` gated deletes it flips the "app" into a benchmark
    /// trial, the way a Trial started by the user while a clear was already running would.
    struct FlipAfter {
        fx: TestEffects,
        after: usize,
        calls: std::cell::Cell<usize>,
    }

    impl ClearGates for FlipAfter {
        fn with_gate(&self, gate: Gate, store: &'static str, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
            let result = LiveGates(&self.fx).with_gate(gate, store, delete);
            self.calls.set(self.calls.get() + 1);
            if self.calls.get() == self.after {
                self.fx.live.set(running(|s| s.benchmark_trial_running = true));
            }
            result
        }
        fn live_state(&self) -> LiveState {
            self.fx.live_state()
        }
    }

    #[test]
    fn r1_a_capture_recording_or_trial_that_starts_after_the_plan_is_seen_in_the_gate_and_nothing_is_deleted() {
        for (flip, code) in [
            (running(|s| s.capture_active = true), "capture_running"),
            (running(|s| s.recorder_busy = true), "recording_in_progress"),
            (running(|s| s.benchmark_trial_running = true), "benchmark_trial_running"),
        ] {
            let t = Tmp::new("r1");
            seed(&t);
            let fx = TestEffects::new();
            let plan = plan_clear(&t.root, Scope::PlayHistory, &later()); // checked while everything was idle
            assert!(plan.can_proceed() && !plan.delete.is_empty());
            fx.live.set(flip); // it starts after the check, before the first delete
            let before = t.listing();
            // The facts handed to the executor are still the idle ones: only the in-gate read can see it.
            let outcome = execute_clear(&t.root, &plan, &later(), &LiveGates(&fx));
            let ClearOutcome::Refused(why) = &outcome else { panic!("{code}: expected Refused, got {outcome:?}") };
            assert_eq!(why.iter().map(|r| r.code).collect::<Vec<_>>(), [code]);
            assert_eq!(before, t.listing(), "{code}: nothing was deleted");
            assert_eq!(fx.epoch.now("sessions"), 0, "{code}: and no epoch moved");
        }
    }

    #[test]
    fn r2_a_file_with_no_store_lock_is_checked_too() {
        let t = Tmp::new("r2");
        t.put("runtime/fps.json", "x"); // `Gate::Unlocked`: protected only by this check
        let fx = TestEffects::new();
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert_eq!(rels(&plan), ["runtime/fps.json"]);
        assert_eq!(gate_of(&plan.delete[0]), Gate::Unlocked);
        fx.live.set(running(|s| s.capture_active = true));
        let outcome = execute_clear(&t.root, &plan, &later(), &LiveGates(&fx));
        assert!(matches!(&outcome, ClearOutcome::Refused(r) if r[0].code == "capture_running"), "{outcome:?}");
        assert!(t.has("runtime/fps.json"));
        // Idle again: it goes.
        fx.live.set(LiveState::default());
        assert!(done(execute_clear(&t.root, &plan, &later(), &LiveGates(&fx))).complete);
        assert!(!t.has("runtime/fps.json"));
    }

    #[test]
    fn r3_a_trial_that_starts_mid_run_stops_the_rest_and_the_report_says_so() {
        let t = Tmp::new("r3");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let first = plan.delete[0].rel.clone();
        let gates = FlipAfter { fx: TestEffects::new(), after: 1, calls: Default::default() };
        let report = done(execute_clear(&t.root, &plan, &later(), &gates));
        assert_eq!(report.deleted, [first.clone()], "only the file before the flip went");
        assert!(!t.has(&first));
        assert_eq!(report.not_attempted.len(), plan.delete.len() - 1, "every later file is named as not tried");
        assert!(report.failed.is_empty(), "not a failed delete: it was never attempted");
        assert_eq!(report.stopped.iter().map(|r| r.code).collect::<Vec<_>>(), ["benchmark_trial_running"]);
        assert!(!report.complete);
        assert!(report.summary().starts_with("Stopped:"), "{}", report.summary());
        for rel in &report.not_attempted {
            assert!(t.has(rel), "{rel} must still be there");
        }
        // A re-run once the trial is over finishes the rest.
        gates.fx.live.set(LiveState::default());
        let plan2 = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(done(execute_clear(&t.root, &plan2, &later(), &gates)).complete);
        assert!(plan_clear(&t.root, Scope::PlayHistory, &later()).nothing_to_do());
    }

    #[test]
    fn r4_everything_sees_it_too_in_both_phases() {
        // Before phase 1 (the facts are read under the locks): refused, the ledger family untouched.
        let t = Tmp::new("r4a");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        assert!(shown.can_proceed());
        let before = t.listing();
        let busy = ClearFacts { capture_active: true, ..later() };
        let outcome = clear_everything_at(&t.root, &shown.fingerprint, &move || busy.clone(), &NoGates);
        assert!(matches!(&outcome, ClearOutcome::Refused(r) if r[0].code == "capture_running"), "{outcome:?}");
        assert_eq!(before, t.listing());
        // During phase 2: phase 1 already took the ledger family, so the answer is Done-and-stopped.
        let t = Tmp::new("r4b");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        let gates = FlipAfter { fx: TestEffects::new(), after: 2, calls: Default::default() };
        let report = done(clear_everything_at(&t.root, &shown.fingerprint, &later, &gates));
        assert!(!t.has("history.json") && !t.has("history.json.bak"), "phase 1 had finished before the trial began");
        assert_eq!(report.stopped.iter().map(|r| r.code).collect::<Vec<_>>(), ["benchmark_trial_running"]);
        assert!(!report.complete && !report.not_attempted.is_empty());
        assert!(t.has("support/evidence.jsonl"), "the support record goes last, so it is still there");
    }

    #[test]
    fn r5_the_planner_and_the_gate_read_the_same_list_and_every_delete_goes_through_the_check() {
        // The same refusal codes, in one place.
        let all = live_state_refusals(&LiveState { capture_active: true, recorder_busy: true, benchmark_trial_running: true });
        assert_eq!(all.iter().map(|(c, _)| *c).collect::<Vec<_>>(), ["capture_running", "recording_in_progress", "benchmark_trial_running"]);
        assert!(live_state_refusals(&LiveState::default()).is_empty());
        // The check is inside the closure every delete path runs: gated, held and unlocked alike.
        let core = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        let body = core.split("fn delete_rows(").nth(1).unwrap().split("\n/// `settle`, for a run").next().unwrap();
        let check = body.find("gates.live_state()").expect("the re-check");
        let delete = body.find("delete_one(root, &d.rel)").expect("the delete");
        let gated = body.find("gates.with_gate(gate, d.store, &mut run)").expect("the gate call");
        assert!(check < delete && delete < gated, "one closure: check, then delete; the gate runs that closure");
        assert_eq!(body.matches("delete_one(").count(), 1, "no second delete path that skips the check");
    }
}
