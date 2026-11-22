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
//! D4-2 shipped the core and tests. Since C1 the play-history wrappers at the bottom are served to the
//! Settings screen; since C2b the "everything" wrappers, the clear status and the acknowledge are served too,
//! and `setup` calls the start-up roll-forward first (see the note above the wrappers). The core below this
//! file's `live wrappers` marker takes the root as an argument and never resolves a data root itself; every
//! test passes a temp folder it made.

#![allow(dead_code)] // `Scope::Everything` and the report helpers are first used by D4-3 and D4-4.

use crate::data_inventory::{self, Base, Category, InventoryRow, StorageKind};
use serde::{Deserialize, Serialize};
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
/// The "clear everything in progress" record (D7, design 3.3 step 1). Never deleted by a plan: only
/// `acknowledge_clear_at` removes it, once nothing is left to roll forward. Its inventory row is `clear-intent`.
const INTENT_FILE: &str = "clear-intent.json";
const INTENT_ID: &str = "clear-intent";
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

const TRIAL_RUNNING_DETAIL: &str =
    "A Trial is starting, running or was interrupted mid-start, so a change it made may still be on. Let it finish or stop it first.";
const TRIAL_UNKNOWN_DETAIL: &str =
    "Compy can't read its Trial records, so it can't confirm that no Trial change is still on. The file was left exactly as it is.";
const TRIALS_TIED_DETAIL: &str =
    "Trial results stay while changes are applied or the change history cannot be read: they are linked to it.";

/// What the Trial store's gate re-reads, under that store's lock, immediately before the Trial store (or one
/// of its working files) is deleted: a Trial that is pending or running, Trial records that can't be read, or
/// a change history that is no longer clean (a change applied since the plan) each stop the run there.
fn trial_gate_refusals(root: &Path) -> Vec<(&'static str, &'static str)> {
    let mut out = Vec::new();
    match read_trial_store(root) {
        TrialRead::Active => out.push(("trial_running", TRIAL_RUNNING_DETAIL)),
        TrialRead::Unknown(_) => out.push(("trial_state_unknown", TRIAL_UNKNOWN_DETAIL)),
        TrialRead::Idle | TrialRead::NoStore => {}
    }
    if !matches!(check_ledger(root), LedgerCheck::Clean) {
        out.push(("trials_tied_to_changes", TRIALS_TIED_DETAIL));
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
        if row.id == INTENT_ID {
            // The record of a clear in progress is the roll-forward's input: a plan never deletes it, in
            // either scope, however old it is.
            return Verdict::Keep("clear_in_progress", "Kept: the record of a clear that is under way or waiting for the screen to finish.");
        }
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
            return Verdict::Keep("trials_tied_to_changes", TRIALS_TIED_DETAIL);
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
        TrialRead::Active => plan.refuse("trial_running", TRIAL_RUNNING_DETAIL, None),
        TrialRead::Unknown(_) => plan.refuse("trial_state_unknown", TRIAL_UNKNOWN_DETAIL, None),
    }
    let ledger = check_ledger(root);
    if scope == Scope::Everything {
        // A record of an earlier clear that cannot be read is never overwritten or guessed at.
        if let IntentRead::Unreadable(_) = read_intent(root) {
            plan.refuse(
                "clear_intent_unreadable",
                "Compy can't read the record of an earlier \"clear everything\", so it can't tell whether one was left unfinished. The file was left exactly as it is.",
                None,
            );
        }
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
    /// Files the start-up roll-forward left alone because the record did not confirm them (see
    /// `confine_to_confirmed`). Always empty for a clear a screen confirmed.
    pub(crate) skipped: Vec<Skipped>,
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
#[allow(clippy::large_enum_variant)] // returned once per clear, on a cold path; boxing would ripple into every caller
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
    ("clear-intent", "written only by the clear itself, under the Trial gate and the ledger lock or at start-up before any writer runs; a plan keeps it"),
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
    MemoryCopy { reason: "ledger_backup_report_flag", holder: "history.rs SAVE_BACKUP_REPORTED (a backup refresh failure was already recorded this run), reset by history::forget_backup_report with the support record", everything_only: true, reset_by: Some(Gate::SupportEvidence) },
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
        skipped: Vec::new(),
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
            let mut why = live_state_refusals(&gates.live_state());
            if gate == Gate::Experiment {
                // Inside the Trial store's own lock (C1 review B4): `start_experiment` holds the same lock for
                // its record and its apply, so a Trial started since the plan is seen here, and so is any change
                // applied BEFORE this read. A plain apply (Optimize) takes only the ledger lock, not this one, so
                // it can still land just after this read; the Trial results then go while that change is on.
                // Undo of it is unaffected (it resolves from history.json, which play history never touches).
                why.extend(trial_gate_refusals(root));
            }
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
    /// Run from the start-up roll-forward: an unfinished run is never silently dropped, only abandoned.
    rolled_forward: bool,
}

/// "Clear everything", phase 1: the change-history family and the Trial store. The caller must hold the
/// Trial gate and then the ledger lock (the one declared nesting `Experiment -> History`); the ledger
/// lock is taken as `&LedgerGuard`, a value only `history::lock_ledger` makes, so this function cannot be
/// called without it. (A Trial-gate type of its own, `TrialGuard`, is NOT here: it needs the owner to
/// approve an edit to the lock-order guard; see `d7-before-wiring-remaining-r2b.md`.) Re-plans UNDER both
/// locks, so "no change is applied" is the answer at the moment of
/// the delete, and an apply that landed first is seen and refuses. Deletes the ledger family in its fixed
/// order (backup before `history.json`), stopping the family on a failure, then `experiments.json`.
#[allow(clippy::result_large_err)] // the Err is the finished outcome, returned once on a cold path
pub(crate) fn execute_everything_ledger_phase(
    root: &Path,
    plan: &ClearPlan,
    facts: &ClearFacts,
    _experiment_gate: &crate::race_seam::StoreGuard,
    _ledger: &crate::history::LedgerGuard,
    confine: Option<&ClearIntent>,
) -> Result<LedgerPhase, ClearOutcome> {
    ledger_phase_with(root, plan, facts, &delete_one, confine)
}

/// `ledger_phase_with` for a clear a screen confirmed (no record to confine to).
#[allow(clippy::result_large_err)] // as above
fn ledger_phase(
    root: &Path,
    plan: &ClearPlan,
    facts: &ClearFacts,
    del: &dyn Fn(&Path, &str) -> Result<Removed, String>,
) -> Result<LedgerPhase, ClearOutcome> {
    ledger_phase_with(root, plan, facts, del, None)
}

/// The body of phase 1, with the delete as a parameter so a test can look at what is held while a file
/// goes. Production passes `delete_one`. `confine` is the pending record when this is the start-up
/// roll-forward: the list is cut down to what the record confirmed and the record is left as it is.
#[allow(clippy::result_large_err)] // as above
fn ledger_phase_with(
    root: &Path,
    plan: &ClearPlan,
    facts: &ClearFacts,
    del: &dyn Fn(&Path, &str) -> Result<Removed, String>,
    confine: Option<&ClearIntent>,
) -> Result<LedgerPhase, ClearOutcome> {
    if plan.scope != Scope::Everything {
        return Err(ClearOutcome::Refused(vec![ledger_lock_required()]));
    }
    let mut now = replan(root, plan, facts)?;
    let mut skipped = Vec::new();
    if let Some(intent) = confine {
        (now.delete, skipped) = confine_to_confirmed(&now.delete, intent);
    } else if !now.delete.is_empty() {
        // The intent record goes down BEFORE the first delete, and only after the re-plan said yes. If it
        // cannot be written, nothing is deleted. Nothing listed means nothing to roll forward (and a
        // missing root is never created). It outlives the call only if a file was actually deleted:
        // `finish_everything` removes it otherwise.
        if let Err(why) = ensure_intent(root, facts, &now.delete) {
            return Err(ClearOutcome::Refused(vec![Refusal {
                code: "clear_intent_unwritable",
                detail: format!("Compy could not write the record that lets an interrupted clear be finished ({why}), so nothing was deleted."),
                files: Vec::new(),
            }]));
        }
    }
    let mut report = new_report(&now);
    report.skipped = skipped;
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
    Ok(LedgerPhase { report, rest, ledger_failed, rolled_forward: confine.is_some() })
}

/// "Clear everything", phase 2, run AFTER the Trial gate and the ledger lock are released: every other
/// file, each under its own store's lock one at a time, the support record last.
pub(crate) fn finish_everything(root: &Path, phase: LedgerPhase, gates: &dyn ClearGates) -> ClearOutcome {
    let LedgerPhase { mut report, rest, mut ledger_failed, rolled_forward } = phase;
    let stopped = delete_rows(root, &rest, gates, &[], &mut report, &mut ledger_failed);
    // What the record does now. A record may outlive the call only if at least one file was deleted:
    // otherwise the screen is told "refused/nothing changed" and a leftover record would wipe everything at
    // the next start without asking.
    let progress = !report.deleted.is_empty() || !report.already_gone.is_empty();
    let clean = stopped.is_empty() && report.failed.is_empty() && report.not_attempted.is_empty() && report.skipped.is_empty();
    if clean {
        // Every file is gone: the backend's part is finished, only the screen's browser storage is left. If
        // the record cannot be advanced it stays pending, and the next start's roll-forward (confined to
        // the files it lists, all gone now) advances it.
        if let Err(why) = mark_files_done(root) {
            eprintln!("[data_clear] the clear finished but its record could not be advanced ({why}); the next start will advance it");
        }
    } else if !progress && !rolled_forward {
        if let Err(why) = remove_intent(root) {
            eprintln!("[data_clear] nothing was deleted but the clear's record could not be removed ({why})");
        }
    } else if let Err(why) = set_abandoned(root, "needs_reconfirm", NEEDS_RECONFIRM) {
        eprintln!("[data_clear] the clear did not finish and its record could not be marked ({why})");
    }
    settle_run(report, stopped)
}

/// Why an unfinished clear is never finished by itself: what is left is whatever the user has now, so the
/// user confirms again on a screen.
const NEEDS_RECONFIRM: &str = "The clear did not finish. Nothing more is deleted until it is confirmed again.";

/// Removes a record this run wrote and has no use for. Only a readable, pending one.
fn remove_intent(root: &Path) -> Result<(), String> {
    match read_intent(root) {
        IntentRead::Valid(i) if i.stage == IntentStage::FilesPending => delete_one(root, INTENT_FILE).map(|_| ()),
        _ => Ok(()),
    }
}

/// What a "clear everything" is checked against once the locks are held.
#[derive(Debug)]
pub(crate) enum Expected {
    /// The fingerprint of the plan the screen showed. A different list deletes nothing (`PlanChanged`).
    Fingerprint(String),
    /// No screen is involved (start-up): the pending record is the authority, and it narrows the list to
    /// what the record confirmed. The token is made only by `roll_forward_at`, is moved in (used once), and
    /// is checked against the record on disk under the locks.
    RecordedIntent(IntentToken),
}

fn no_clear_in_progress() -> Refusal {
    Refusal {
        code: "no_clear_in_progress",
        detail: "There is no unfinished \"clear everything\" to finish, so nothing was deleted.".to_string(),
        files: Vec::new(),
    }
}

impl From<&str> for Expected {
    fn from(fp: &str) -> Self {
        Expected::Fingerprint(fp.to_string())
    }
}

impl From<&String> for Expected {
    fn from(fp: &String) -> Self {
        Expected::Fingerprint(fp.clone())
    }
}

/// "Clear everything" as one call: takes the Trial gate, then the ledger lock, runs phase 1 under both,
/// releases both, then runs phase 2. `facts` is read AFTER the locks are held. The root is an argument:
/// the live wrapper resolves it, this never does.
///
/// `expected` is the fingerprint of the plan a screen confirmed (a `&str` or `&String` converts), or
/// `Expected::RecordedIntent` for the start-up roll-forward, whose authority is the intent record the
/// confirmed clear left on disk. This is the ONE function that takes the two locks, so both callers share
/// every lock, the re-plan under them, every refusal and the order of deletion.
pub(crate) fn clear_everything_at(
    root: &Path,
    expected: impl Into<Expected>,
    facts: &dyn Fn() -> ClearFacts,
    gates: &dyn ClearGates,
) -> ClearOutcome {
    let expected = expected.into();
    let phase = {
        let experiment_gate = match crate::experiment::lock_store() {
            Ok(g) => g,
            Err(e) => return ClearOutcome::Refused(vec![store_lock_unavailable("the Trial store", &e)]),
        };
        let ledger = match crate::history::lock_ledger() {
            Ok(g) => g,
            Err(e) => return ClearOutcome::Refused(vec![store_lock_unavailable("the change history", &e)]),
        };
        // The start-up path needs a pending record that is still the one its token was made from.
        let confine = match &expected {
            Expected::Fingerprint(_) => None,
            Expected::RecordedIntent(token) => match read_intent(root) {
                IntentRead::Valid(i) if i.stage == IntentStage::FilesPending && i == token.intent => Some(i),
                _ => return ClearOutcome::Refused(vec![no_clear_in_progress()]),
            },
        };
        let facts = facts();
        let plan = plan_clear(root, Scope::Everything, &facts);
        // A refusal is named as one (as `clear_play_history_at` does), not folded into "files changed".
        if !plan.refusals.is_empty() {
            return ClearOutcome::Refused(plan.refusals);
        }
        if matches!(&expected, Expected::Fingerprint(fp) if plan.fingerprint != *fp) {
            return ClearOutcome::PlanChanged;
        }
        match execute_everything_ledger_phase(root, &plan, &facts, &experiment_gate, &ledger, confine.as_ref()) {
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

// ---- the clear-intent record and the start-up roll-forward (D7, design 3.3 step 1 and 3.5) ---------
//
// "Clear everything" is many deletes with a crash possible between any two. The record below is written
// before the first delete (once the re-plan under the locks said yes) and is the ONLY authority the
// start-up roll-forward has to finish a clear nobody is watching. Pure functions over a root path: the
// one function that touches the running app is `finish_interrupted_clear`, at the end of this file.

/// Where a recorded clear stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum IntentStage {
    /// Files may be left. The next start finishes them.
    FilesPending,
    /// Every file is gone; only the screen's browser storage is left (the screen's job, not built here).
    WebviewPending,
    /// The roll-forward stopped on purpose (`abandoned_code` says why). Nothing more is deleted for it.
    Abandoned,
}

/// The stored record (`clear-intent.json`). The design's `webview_pending` flag is `stage` here: one field
/// that cannot say two things at once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ClearIntent {
    /// Always `"all"` today ("clear everything"); a record that says anything else is not understood.
    pub(crate) scope: String,
    pub(crate) remove_licence: bool,
    /// Seconds since the Unix epoch.
    pub(crate) started_at: u64,
    pub(crate) stage: IntentStage,
    #[serde(default)]
    pub(crate) abandoned_code: Option<String>,
    #[serde(default)]
    pub(crate) abandoned_detail: Option<String>,
    /// The files the confirmed plan listed, as they were when the clear started. The roll-forward deletes
    /// nothing that is not here AND still unchanged AND still in the plan the compiled inventory makes:
    /// a record can narrow what is deleted, never add a target. (A record without this field, or an
    /// empty one, deletes nothing.)
    #[serde(default)]
    pub(crate) confirmed: Vec<ConfirmedFile>,
}

/// One entry of the confirmed plan: inventory row id, file name, size and modified time (ms since 1970).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ConfirmedFile {
    pub(crate) row_id: String,
    pub(crate) rel: String,
    pub(crate) size: u64,
    pub(crate) modified_ms: u64,
}

/// A file the roll-forward left alone, and why. Never an error: it is reported so the screen can say so.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Skipped {
    pub(crate) rel: String,
    /// `not_in_confirmed_plan`, `changed_since_confirmed`, `newer_than_clear`, `invalid_record_entry`.
    pub(crate) reason: &'static str,
}

/// Capability to run the start-up roll-forward. Only `roll_forward_at` builds one (a source test pins that),
/// from the record it just read, and it is moved into `clear_everything_at`, which re-reads the record under
/// the locks and refuses unless it is still the pending record this token was made from.
#[derive(Debug)]
pub(crate) struct IntentToken {
    intent: ClearIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IntentRead {
    Absent,
    Valid(ClearIntent),
    /// Present but not a plain file, not readable, or not a record this build understands. Never deleted,
    /// overwritten or guessed at.
    Unreadable(String),
}

pub(crate) fn read_intent(root: &Path) -> IntentRead {
    let path = root.join(INTENT_FILE);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return IntentRead::Absent,
        Err(e) => return IntentRead::Unreadable(e.to_string()),
        Ok(m) if is_link(&m) || !m.is_file() => return IntentRead::Unreadable("not a plain file".to_string()),
        Ok(_) => {}
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return IntentRead::Unreadable(e.to_string()),
    };
    match serde_json::from_str::<ClearIntent>(&text) {
        Ok(i) if i.scope == "all" => IntentRead::Valid(i),
        Ok(i) => IntentRead::Unreadable(format!("unknown scope `{}`", i.scope)),
        Err(e) => IntentRead::Unreadable(e.to_string()),
    }
}

fn write_intent(root: &Path, intent: &ClearIntent) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(intent).map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic(&root.join(INTENT_FILE), &bytes).map_err(|e| e.to_string())
}

/// Writes the record for a clear about to start: its start time, the licence choice and the confirmed
/// list (`planned`: what the re-plan under the locks says will be deleted). An unreadable record is an
/// error: it is never overwritten. An older record (pending, abandoned or waiting for the screen) is
/// replaced: the clear in hand was just confirmed and supersedes it.
fn ensure_intent(root: &Path, facts: &ClearFacts, planned: &[PlannedDelete]) -> Result<(), String> {
    if let IntentRead::Unreadable(why) = read_intent(root) {
        return Err(format!("the record of an earlier clear can't be read: {why}"));
    }
    write_intent(
        root,
        &ClearIntent {
            scope: "all".to_string(),
            remove_licence: facts.remove_licence,
            started_at: facts.now.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            stage: IntentStage::FilesPending,
            abandoned_code: None,
            abandoned_detail: None,
            confirmed: planned
                .iter()
                .map(|d| ConfirmedFile { row_id: d.row_id.to_string(), rel: d.rel.clone(), size: d.size, modified_ms: u64::try_from(d.modified_ms).unwrap_or(u64::MAX) })
                .collect(),
        },
    )
}

/// Takes `planned` down to what the record confirmed: a file is kept for deletion only if the record lists
/// it with the same inventory row, size and modified time, a path that stays inside the root, and a
/// modified time no later than the record's start. Everything else is left and named. Entries of the record
/// that are not a plain inventory file name are named too (and never acted on).
fn confine_to_confirmed(planned: &[PlannedDelete], intent: &ClearIntent) -> (Vec<PlannedDelete>, Vec<Skipped>) {
    let mut keep = Vec::new();
    let mut skipped = Vec::new();
    for d in planned {
        let entry = intent.confirmed.iter().find(|e| e.rel == d.rel);
        let reason = match entry {
            None => Some("not_in_confirmed_plan"),
            Some(_) if validate_rel(&d.rel).is_err() => Some("invalid_record_entry"),
            Some(_) if d.modified_ms / 1000 > u128::from(intent.started_at) => Some("newer_than_clear"),
            Some(e) if e.row_id != d.row_id || e.size != d.size || u128::from(e.modified_ms) != d.modified_ms => Some("changed_since_confirmed"),
            Some(_) => None,
        };
        match reason {
            None => keep.push(d.clone()),
            Some(reason) => skipped.push(Skipped { rel: d.rel.clone(), reason }),
        }
    }
    for e in &intent.confirmed {
        let known_row = data_inventory::rows().iter().any(|r| r.id == e.row_id);
        if (validate_rel(&e.rel).is_err() || !known_row) && !skipped.iter().any(|s| s.rel == e.rel) {
            skipped.push(Skipped { rel: e.rel.clone(), reason: "invalid_record_entry" });
        }
    }
    (keep, skipped)
}

/// Every file is gone: advance a pending record to "only the screen's storage is left". Anything else on
/// disk (no record, a record at another stage, an unreadable one) is left exactly as it is.
fn mark_files_done(root: &Path) -> Result<(), String> {
    match read_intent(root) {
        IntentRead::Valid(mut i) if i.stage == IntentStage::FilesPending => {
            i.stage = IntentStage::WebviewPending;
            write_intent(root, &i)
        }
        _ => Ok(()),
    }
}

/// The roll-forward stopped on purpose: the record stays, as `Abandoned`, so the next start does not try
/// again and the screen can say why.
fn set_abandoned(root: &Path, code: &str, detail: &str) -> Result<(), String> {
    match read_intent(root) {
        IntentRead::Valid(mut i) => {
            i.stage = IntentStage::Abandoned;
            i.abandoned_code = Some(code.to_string());
            i.abandoned_detail = Some(detail.to_string());
            write_intent(root, &i)
        }
        _ => Ok(()),
    }
}

/// The screen is done (its browser storage is cleared, or it has shown why the clear stopped): removes the
/// record. A record whose files are still pending, or one that can't be read, is refused and kept.
pub(crate) fn acknowledge_clear_at(root: &Path) -> Result<(), Refusal> {
    match read_intent(root) {
        IntentRead::Absent => Ok(()),
        IntentRead::Unreadable(why) => Err(Refusal {
            code: "clear_intent_unreadable",
            detail: format!("Compy can't read the record of a clear ({why}), so it left it as it is."),
            files: Vec::new(),
        }),
        IntentRead::Valid(i) if i.stage == IntentStage::FilesPending => Err(Refusal {
            code: "clear_files_pending",
            detail: "A clear still has files to delete, so its record was kept.".to_string(),
            files: Vec::new(),
        }),
        IntentRead::Valid(_) => delete_one(root, INTENT_FILE).map(|_| ()).map_err(|why| Refusal {
            code: "clear_intent_not_removed",
            detail: format!("Compy could not remove the record of a finished clear: {why}"),
            files: Vec::new(),
        }),
    }
}

/// Refusal codes that mean the ledger no longer matches what the clear was confirmed against (a change is
/// on again, the ledger can't be read, a damaged copy was set aside). The roll-forward abandons on these
/// and keeps every `history.json*` file, and the roll-forward reports that code. Any other refusal (a Trial, a
/// fresh working file, a lock) abandons with `needs_reconfirm`: the roll-forward makes one attempt only.
const LEDGER_ABANDON_CODES: &[&str] = &["changes_applied", "ledger_unreadable", "ledger_set_aside"];

/// What the start-up roll-forward did.
#[derive(Debug, Serialize)]
#[serde(tag = "status", content = "detail", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)] // returned once at start-up; same reason as `ClearOutcome`
pub(crate) enum RollForward {
    /// No record: nothing was interrupted.
    NothingToDo,
    /// The record was finished: every file it listed is gone (the record now waits for the screen).
    Completed(ClearReport),
    /// Some files are still there (a failure, a stop, or files the record did not confirm: `skipped`). The
    /// record is `Abandoned` with `needs_reconfirm`: nothing more is deleted at start-up.
    Incomplete(ClearReport),
    /// The files were already gone; only the screen's browser storage is left. Nothing was deleted.
    WebviewPending,
    /// The clear was given up on, with a typed reason, and nothing more was deleted.
    Abandoned { code: String, detail: String },
    /// The record can't be read. Kept as it is, reported, and nothing was deleted.
    Kept { code: &'static str, detail: String },
    /// No data root, or the record on disk was not the one this attempt read: nothing was deleted and the
    /// record was left as it is.
    Deferred(Vec<Refusal>),
}

/// Finishes a "clear everything" that was interrupted, from its record alone. Same code, same locks and
/// the same re-plan as the confirmed clear (`clear_everything_at`), so the ledger is re-checked under
/// both locks before the first delete: an applied change that appeared since abandons the ledger part and
/// keeps every `history.json*` file. `facts` is the app's live state; the licence choice comes from the record.
pub(crate) fn roll_forward_at(root: &Path, facts: &dyn Fn() -> ClearFacts, gates: &dyn ClearGates) -> RollForward {
    let intent = match read_intent(root) {
        IntentRead::Absent => return RollForward::NothingToDo,
        IntentRead::Unreadable(why) => {
            return RollForward::Kept {
                code: "clear_intent_unreadable",
                detail: format!("Compy can't read the record of an unfinished \"clear everything\" ({why}). It was left exactly as it is and nothing was deleted."),
            }
        }
        IntentRead::Valid(i) => i,
    };
    match intent.stage {
        IntentStage::WebviewPending => return RollForward::WebviewPending,
        IntentStage::Abandoned => {
            return RollForward::Abandoned {
                code: intent.abandoned_code.unwrap_or_default(),
                detail: intent.abandoned_detail.unwrap_or_default(),
            }
        }
        IntentStage::FilesPending => {}
    }
    let remove_licence = intent.remove_licence;
    let facts_of_record = || ClearFacts { remove_licence, ..facts() };
    let abandon = |code: &'static str, detail: String| {
        if let Err(why) = set_abandoned(root, code, &detail) {
            eprintln!("[data_clear] the clear was abandoned ({code}) but its record could not be updated ({why})");
        }
        RollForward::Abandoned { code: code.to_string(), detail }
    };
    // One attempt only. Whatever does not finish now becomes `Abandoned` ("needs_reconfirm"): what is left
    // is whatever the user has now, and only a screen may confirm deleting that.
    match clear_everything_at(root, Expected::RecordedIntent(IntentToken { intent: intent.clone() }), &facts_of_record, gates) {
        ClearOutcome::Refused(refusals) => {
            if refusals.iter().any(|r| r.code == "no_clear_in_progress") {
                return RollForward::Deferred(refusals); // the record is not ours to touch
            }
            match refusals.iter().find(|r| LEDGER_ABANDON_CODES.contains(&r.code)) {
                Some(r) => abandon(r.code, r.detail.clone()),
                None => abandon("needs_reconfirm", NEEDS_RECONFIRM.to_string()),
            }
        }
        // Cannot happen with no expected fingerprint.
        ClearOutcome::PlanChanged => abandon("needs_reconfirm", NEEDS_RECONFIRM.to_string()),
        ClearOutcome::Done(report) if report.complete && report.skipped.is_empty() && report.stopped.is_empty() => RollForward::Completed(report),
        // `finish_everything` has already marked the record `Abandoned`.
        ClearOutcome::Done(report) => RollForward::Incomplete(report),
    }
}

// ---- live wrappers (the only code below that touches the running app) ------------------------------
//
// C1: `plan_clear_play_history` and `clear_play_history` are served to the main window by the async
// commands of the same names in lib.rs `mod off_main` (registered in `generate_handler!`, `build.rs`
// APP_COMMANDS and `capabilities/default.json`; test `w0c`). C2b adds `plan_clear_everything`,
// `clear_everything`, `get_clear_status` and `acknowledge_clear` the same way, and `setup` calls
// `finish_interrupted_clear` as its first statement (test `i9`).
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
        // Same record, same lock: the "backup failure already recorded" flag belongs to it too.
        crate::history::forget_backup_report();
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

/// The facts only the running app knows, read from `fx` (the app passes [`ProcessEffects`]; the same
/// `live_state` the in-gate re-check reads).
fn facts_from(fx: &dyn ClearEffects, remove_licence: bool) -> ClearFacts {
    let live = fx.live_state();
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

// C2a: each live wrapper below is ONE expression: its `_on` function called with the resolved root, its own
// arguments and the process's effects (test `v1` pins the exact text). Everything else lives in the `_on`
// function, which takes the root (or the reason there is none) and the effects as arguments, so the tests drive
// all of it with a temp root and their own effects. What no test runs: the root resolution itself (`live_root`,
// whose exact text test `v1` pins) and the `ProcessEffects` methods (`deleted`, `with_benchmark_locked`,
// `forget_trial_result`, `forget_incident_failures`, `forget_support_preview`, `forget_identity_throttle`,
// `live_state`), which act on the running app's process-wide state; the tests use their own `ClearEffects`.

/// What "Clear play history" would delete, keep and leave alone, right now. A pure read.
pub(crate) fn plan_clear_play_history() -> ClearPlan {
    plan_play_history_on(live_root(), &ProcessEffects)
}

/// `plan_clear_play_history` on a given root (or the reason there is none) and given effects.
pub(crate) fn plan_play_history_on(root: Result<PathBuf, Refusal>, fx: &dyn ClearEffects) -> ClearPlan {
    match root {
        Ok(root) => plan_clear(&root, Scope::PlayHistory, &facts_from(fx, false)),
        Err(r) => ClearPlan::refused(Scope::PlayHistory, r.code, &r.detail),
    }
}

/// What "Clear everything" would delete, keep and leave alone, right now. A pure read.
pub(crate) fn plan_clear_everything(remove_licence: bool) -> ClearPlan {
    plan_everything_on(live_root(), remove_licence, &ProcessEffects)
}

/// `plan_clear_everything` on a given root (or the reason there is none) and given effects.
pub(crate) fn plan_everything_on(root: Result<PathBuf, Refusal>, remove_licence: bool, fx: &dyn ClearEffects) -> ClearPlan {
    match root {
        Ok(root) => plan_clear(&root, Scope::Everything, &facts_from(fx, remove_licence)),
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
    clear_play_history_on(live_root(), expected_fingerprint, &ProcessEffects)
}

/// `clear_play_history` on a given root (or the reason there is none) and given effects: the real store gates
/// (`LiveGates`) with `fx`'s epoch, resets and live state.
pub(crate) fn clear_play_history_on(root: Result<PathBuf, Refusal>, expected_fingerprint: &str, fx: &dyn ClearEffects) -> ClearOutcome {
    match root {
        Ok(root) => clear_play_history_at(&root, expected_fingerprint, &facts_from(fx, false), &LiveGates(fx)),
        Err(r) => ClearOutcome::Refused(vec![r]),
    }
}

/// Deletes everything the plan with `expected_fingerprint` listed (the licence only when asked). Takes
/// the Trial gate then the ledger lock for the change-history family; see `clear_everything_at`.
/// Blocking, like `clear_play_history`.
pub(crate) fn clear_everything(expected_fingerprint: &str, remove_licence: bool) -> ClearOutcome {
    clear_everything_on(live_root(), expected_fingerprint, remove_licence, &ProcessEffects)
}

/// `clear_everything` on a given root (or the reason there is none) and given effects.
pub(crate) fn clear_everything_on(
    root: Result<PathBuf, Refusal>,
    expected_fingerprint: &str,
    remove_licence: bool,
    fx: &dyn ClearEffects,
) -> ClearOutcome {
    match root {
        Ok(root) => clear_everything_at(&root, expected_fingerprint, &|| facts_from(fx, remove_licence), &LiveGates(fx)),
        Err(r) => ClearOutcome::Refused(vec![r]),
    }
}

/// The start-up roll-forward on the real data root. Called (C2b) as the FIRST statement of `setup` in lib.rs,
/// synchronously, before the `app_start` record is
/// written, before the experiment reconcile and before the ledger backup thread starts (design 3.5: the
/// support record is deleted by the clear, and `backup_missing_ledger_at` would re-create `history.json.bak`
/// from a surviving `history.json`). A sandbox, redirected or conflicted root defers (nothing is touched).
/// Blocking: it takes store locks, so it must not run on the UI thread after start-up.
pub(crate) fn finish_interrupted_clear() -> RollForward {
    finish_interrupted_clear_on(live_root(), &ProcessEffects)
}

/// `finish_interrupted_clear` on a given root (or the reason there is none) and given effects.
pub(crate) fn finish_interrupted_clear_on(root: Result<PathBuf, Refusal>, fx: &dyn ClearEffects) -> RollForward {
    match root {
        Ok(root) => roll_forward_at(&root, &|| facts_from(fx, false), &LiveGates(fx)),
        Err(r) => RollForward::Deferred(vec![r]),
    }
}

// ---- C2b: what the screen reads about a "clear everything" record --------------------------------------

/// What THIS start's roll-forward did (`setup` sets it once, first thing), kept as JSON for the screen for the
/// rest of the run. Not stored on disk: the record itself (`clear-intent.json`) is the stored state.
static STARTUP_ROLL_FORWARD: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();

/// Keeps what the start-up roll-forward did, for the screen and for the support record. Called once.
pub(crate) fn remember_roll_forward(rf: &RollForward) {
    let _ = STARTUP_ROLL_FORWARD.set(serde_json::to_value(rf).unwrap_or(serde_json::Value::Null));
}

/// What the "Your data" screen needs to know about a clear record, read now.
#[derive(Debug, Serialize)]
pub(crate) struct ClearStatus {
    /// What this start's roll-forward did (`RollForward` as JSON), or `None` when it was not run (no record).
    pub(crate) roll_forward: Option<serde_json::Value>,
    /// The record on disk now: `none`, `files_pending`, `webview_pending`, `abandoned`, `unreadable`, or
    /// `no_root` (no canonical data folder; nothing was read).
    pub(crate) record: &'static str,
    /// Why an abandoned record was abandoned (`needs_reconfirm`, `changes_applied`, ...).
    pub(crate) abandoned_code: Option<String>,
    /// The browser keys a finished "clear everything" leaves for the window to remove (the inventory list).
    pub(crate) webview: Vec<WebviewTarget>,
}

/// The status, live. One expression (test `v1`).
pub(crate) fn get_clear_status() -> ClearStatus {
    clear_status_on(live_root(), STARTUP_ROLL_FORWARD.get().cloned())
}

/// `get_clear_status` on a given root (or the reason there is none) and a given roll-forward result.
pub(crate) fn clear_status_on(root: Result<PathBuf, Refusal>, roll_forward: Option<serde_json::Value>) -> ClearStatus {
    let roll_forward = roll_forward.filter(|v| v.get("status").and_then(|s| s.as_str()) != Some("nothing_to_do"));
    let (record, abandoned_code) = match root {
        Err(_) => ("no_root", None),
        Ok(root) => match read_intent(&root) {
            IntentRead::Absent => ("none", None),
            IntentRead::Unreadable(_) => ("unreadable", None),
            IntentRead::Valid(i) => match i.stage {
                IntentStage::FilesPending => ("files_pending", None),
                IntentStage::WebviewPending => ("webview_pending", None),
                IntentStage::Abandoned => ("abandoned", i.abandoned_code),
            },
        },
    };
    ClearStatus { roll_forward, record, abandoned_code, webview: webview_targets(Scope::Everything) }
}

/// The screen is done with a finished or abandoned clear: removes the record (refused while files are still
/// pending or when it can't be read). One expression (test `v1`).
pub(crate) fn acknowledge_clear() -> Result<(), Refusal> {
    acknowledge_clear_on(live_root())
}

/// `acknowledge_clear` on a given root (or the reason there is none).
pub(crate) fn acknowledge_clear_on(root: Result<PathBuf, Refusal>) -> Result<(), Refusal> {
    root.and_then(|r| acknowledge_clear_at(&r))
}

/// The support-record entry for a start-up roll-forward that did not finish (r3 item 6): `(code, failed,
/// detail)`, or `None` when there is nothing to record. Written by `setup` AFTER the `app_start` record, so the
/// clear (which deletes the support record) is over by then.
pub(crate) fn roll_forward_evidence(rf: &serde_json::Value) -> Option<(String, bool, &'static str)> {
    let status = rf.get("status").and_then(|s| s.as_str())?;
    let detail = rf.get("detail");
    match status {
        "abandoned" => Some((
            detail.and_then(|d| d.get("code")).and_then(|c| c.as_str()).unwrap_or("abandoned").to_string(),
            false,
            "an interrupted clear everything was not finished at start-up; it needs the user to confirm it again",
        )),
        "incomplete" => Some((
            "incomplete".to_string(),
            true,
            "an interrupted clear everything was finished only in part at start-up; the rest needs the user to confirm it again",
        )),
        "kept" => Some((
            "clear_intent_unreadable".to_string(),
            true,
            "the record of an interrupted clear everything could not be read at start-up; it was left as it is and nothing was deleted",
        )),
        _ => None,
    }
}

/// Writes `roll_forward_evidence` for this start's roll-forward to the support record, if there is one.
pub(crate) fn record_roll_forward_evidence() {
    if let Some((code, failed, detail)) = STARTUP_ROLL_FORWARD.get().and_then(roll_forward_evidence) {
        let outcome = if failed { crate::support_evidence::Outcome::Failed } else { crate::support_evidence::Outcome::Refused };
        crate::support_evidence::record(crate::support_evidence::EventKind::Operation, "clear_roll_forward", &code, outcome, detail);
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
        let out = crate::sys_exe::sys_command(crate::sys_exe::SysTool::Cmd).args(["/c", "mklink", "/J"]).arg(link).arg(target).output().unwrap();
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
        let gate = crate::experiment::lock_store().unwrap();
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
        let code: String = core.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        assert!(!code.contains(concat!("lock_", "history(")), "the ledger lock comes only through history::lock_ledger");
        assert_eq!(code.matches("history::lock_ledger()").count(), 1, "exactly one place takes it: clear_everything_at");
        let exp = code.find("experiment::lock_store()").expect("the Trial gate");
        let led = code.find("history::lock_ledger()").expect("the ledger lock");
        assert!(exp < led, "Experiment, then History: the declared nesting");
    }

    // ===== the public ledger phase (the Trial gate is the shared `StoreGuard`; see the remaining list) ===

    #[test]
    fn l1_the_public_ledger_phase_takes_the_two_guards_and_phase_two_finishes_the_clear() {
        let t = Tmp::new("y2");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(plan.can_proceed(), "{:?}", plan.refusals);
        let trial = crate::experiment::lock_store().unwrap();
        let ledger = crate::history::lock_ledger().unwrap();
        let phase = execute_everything_ledger_phase(&t.root, &plan, &later(), &trial, &ledger, None).unwrap_or_else(|o| panic!("phase 1: {o:?}"));
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
        // C2a: the facts come from the effects the wrapper passes (`&ProcessEffects` in every live wrapper, test
        // v1), through the same `live_state` the in-gate re-check calls.
        let facts_fn = src.split("fn facts_from(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(facts_fn.contains("fx.live_state()"), "the facts and the in-gate re-check read the same function");
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
        assert_eq!(report.deleted, std::slice::from_ref(&first), "only the file before the flip went");
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

    // ---- the clear-intent record and the start-up roll-forward (D7 item 5) ---------------------------

    fn intent_of(t: &Tmp) -> ClearIntent {
        match read_intent(&t.root) {
            IntentRead::Valid(i) => i,
            other => panic!("expected a readable record, got {other:?}"),
        }
    }

    /// The listing without the record itself (its size changes when it is abandoned or advanced).
    fn listing_but_intent(t: &Tmp) -> Vec<String> {
        t.listing().into_iter().filter(|l| !l.starts_with(INTENT_FILE)).collect()
    }

    /// A pending record for a clear confirmed with `facts`: the plan under those facts, then the record
    /// exactly as the clear writes it before its first delete.
    fn pend(t: &Tmp, facts: &ClearFacts) -> Result<(), String> {
        let plan = plan_clear(&t.root, Scope::Everything, facts);
        ensure_intent(&t.root, facts, &plan.delete)
    }

    fn roll(t: &Tmp) -> RollForward {
        roll_forward_at(&t.root, &later, &NoGates)
    }

    #[test]
    fn i1_a_clear_interrupted_after_n_files_is_finished_by_the_next_start() {
        let probe = Tmp::new("i1p");
        seed(&probe);
        let total = plan_clear(&probe.root, Scope::Everything, &later()).delete.len();
        assert!(total > 6, "the seed must give the interruption somewhere to land");
        for n in [0, 1, 2, 3, total - 1, total] {
            let t = Tmp::new("i1");
            seed(&t);
            let plan = plan_clear(&t.root, Scope::Everything, &later());
            pend(&t, &later()).unwrap(); // what the clear writes before its first delete
            for d in plan.delete.iter().take(n) {
                delete_one(&t.root, &d.rel).unwrap(); // ... then the process dies after n files
            }
            let outcome = roll(&t);
            let RollForward::Completed(report) = &outcome else { panic!("n={n}: expected Completed, got {outcome:?}") };
            assert!(report.complete, "n={n}");
            assert_eq!(report.deleted.len() + report.already_gone.len(), total - n, "n={n}: only what was left");
            assert!(plan_clear(&t.root, Scope::Everything, &later()).nothing_to_do(), "n={n}: nothing is left to clear");
            assert!(t.root.is_dir(), "n={n}: the root folder is never removed");
            assert_eq!(intent_of(&t).stage, IntentStage::WebviewPending, "n={n}: only the screen's part is left");
            // A second start has nothing to do and deletes nothing.
            let after = t.listing();
            assert!(matches!(roll(&t), RollForward::WebviewPending));
            assert_eq!(after, t.listing(), "n={n}");
        }
    }

    #[test]
    fn i1b_after_the_backup_but_before_history_json_the_next_start_deletes_history_json_and_nothing_recreates_it() {
        let t = Tmp::new("i1b");
        seed(&t);
        pend(&t, &later()).unwrap();
        delete_one(&t.root, "history.json.bak").unwrap();
        assert!(t.has("history.json"));
        assert!(matches!(roll(&t), RollForward::Completed(_)));
        assert!(!t.has("history.json") && !t.has("history.json.bak"));
    }

    #[test]
    fn i1c_a_clear_that_stopped_part_way_is_not_finished_by_the_next_start_but_by_a_new_confirmation() {
        let t = Tmp::new("i1c");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        let gates = FlipAfter { fx: TestEffects::new(), after: 2, calls: Default::default() };
        let report = done(clear_everything_at(&t.root, &shown.fingerprint, &later, &gates));
        assert!(!report.complete && !report.stopped.is_empty());
        let i = intent_of(&t);
        assert_eq!((i.stage, i.abandoned_code.as_deref()), (IntentStage::Abandoned, Some("needs_reconfirm")), "the screen saw the stop: not left pending for the next start");
        // The next start deletes nothing, however much is left.
        let before = t.listing();
        assert!(matches!(roll(&t), RollForward::Abandoned { code, .. } if code == "needs_reconfirm"));
        assert_eq!(before, t.listing());
        // A new confirmation (a new plan, a new record) finishes it.
        let again = plan_clear(&t.root, Scope::Everything, &later());
        assert!(done(clear_everything_at(&t.root, &again.fingerprint, &later, &NoGates)).complete);
        assert_eq!(intent_of(&t).stage, IntentStage::WebviewPending);
        assert!(plan_clear(&t.root, Scope::Everything, &later()).nothing_to_do());
    }

    #[test]
    fn i2_an_applied_change_that_appeared_since_abandons_the_clear_with_a_typed_reason_and_deletes_nothing() {
        let t = Tmp::new("i2");
        seed(&t);
        pend(&t, &later()).unwrap();
        t.ledger(&[("Game mode", "applied")]); // a change is on again
        let before = listing_but_intent(&t);
        let ledger_before = t.read("history.json");
        let outcome = roll(&t);
        let RollForward::Abandoned { code, detail } = &outcome else { panic!("expected Abandoned, got {outcome:?}") };
        assert_eq!(code, "changes_applied");
        assert!(!detail.is_empty());
        assert_eq!(before, listing_but_intent(&t), "nothing more was deleted: not even a file outside the ledger family");
        assert_eq!(ledger_before, t.read("history.json"));
        let i = intent_of(&t);
        assert_eq!((i.stage, i.abandoned_code.as_deref()), (IntentStage::Abandoned, Some("changes_applied")));
        // The next start reports the same and still deletes nothing.
        assert!(matches!(roll(&t), RollForward::Abandoned { code, .. } if code == "changes_applied"));
        assert_eq!(before, listing_but_intent(&t));
        // The screen acknowledges it: the record goes, the data stays.
        acknowledge_clear_at(&t.root).unwrap();
        assert!(!t.has(INTENT_FILE) && t.has("history.json"));
    }

    #[test]
    fn i2b_an_unreadable_ledger_also_abandons_and_keeps_every_history_file() {
        let t = Tmp::new("i2b");
        seed(&t);
        t.put("history.json", "{ not a ledger");
        pend(&t, &later()).unwrap();
        let before = listing_but_intent(&t);
        assert!(matches!(roll(&t), RollForward::Abandoned { code, .. } if code == "ledger_unreadable"));
        assert_eq!(before, listing_but_intent(&t));
        assert_eq!(t.read("history.json"), "{ not a ledger");
    }

    #[test]
    fn i3_a_corrupt_intent_file_is_kept_reported_and_nothing_is_deleted() {
        for body in ["{ this is not json", "", r#"{"scope":"all"}"#, r#"{"scope":"half","remove_licence":false,"started_at":1,"stage":"files_pending"}"#] {
            let t = Tmp::new("i3");
            seed(&t);
            t.put(INTENT_FILE, body);
            let before = t.listing();
            let outcome = roll(&t);
            let RollForward::Kept { code, detail } = &outcome else { panic!("`{body}`: expected Kept, got {outcome:?}") };
            assert_eq!(*code, "clear_intent_unreadable");
            assert!(!detail.is_empty());
            assert_eq!(before, t.listing(), "`{body}`: nothing was deleted");
            assert_eq!(t.read(INTENT_FILE), body, "`{body}`: the file is exactly as it was");
            // A new clear does not guess at it either, and the screen cannot clear it away.
            let plan = plan_clear(&t.root, Scope::Everything, &later());
            assert!(plan.refusals.iter().any(|r| r.code == "clear_intent_unreadable"), "`{body}`");
            assert!(matches!(clear_everything_at(&t.root, &plan.fingerprint, &later, &NoGates), ClearOutcome::Refused(_)));
            assert_eq!(acknowledge_clear_at(&t.root).unwrap_err().code, "clear_intent_unreadable");
            assert_eq!(before, t.listing());
            assert_eq!(t.read(INTENT_FILE), body);
        }
    }

    #[test]
    fn i3b_a_link_or_folder_in_the_intent_place_is_unreadable_not_followed() {
        let t = Tmp::new("i3b");
        fs::create_dir_all(t.root.join(INTENT_FILE)).unwrap();
        assert!(matches!(read_intent(&t.root), IntentRead::Unreadable(_)));
        assert!(matches!(roll(&t), RollForward::Kept { .. }));
        assert!(t.root.join(INTENT_FILE).is_dir());
    }

    #[test]
    fn i4_no_plan_ever_lists_the_intent_record_and_no_record_means_nothing_to_do() {
        let t = Tmp::new("i4");
        seed(&t);
        assert!(matches!(roll(&t), RollForward::NothingToDo));
        pend(&t, &later()).unwrap();
        for scope in [Scope::PlayHistory, Scope::Everything] {
            let plan = plan_clear(&t.root, scope, &later());
            assert!(!rels(&plan).contains(&INTENT_FILE), "{scope:?}");
            assert!(plan.kept.iter().any(|k| k.rel == INTENT_FILE && k.code == "clear_in_progress"), "{scope:?}");
        }
        // Not even a very old record is "stale".
        let far = ClearFacts { now: SystemTime::now() + Duration::from_secs(86_400 * 365), ..facts() };
        assert!(!rels(&plan_clear(&t.root, Scope::Everything, &far)).contains(&INTENT_FILE));
    }

    #[test]
    fn i5_the_record_is_written_before_the_first_delete_and_a_refused_clear_leaves_none() {
        let t = Tmp::new("i5");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let seen: std::cell::RefCell<Vec<Option<IntentStage>>> = Default::default();
        let phase = ledger_phase(&t.root, &plan, &later(), &|root, rel| {
            seen.borrow_mut().push(match read_intent(root) {
                IntentRead::Valid(i) => Some(i.stage),
                _ => None,
            });
            delete_one(root, rel)
        });
        assert!(phase.is_ok());
        let seen = seen.into_inner();
        assert!(!seen.is_empty() && seen.iter().all(|s| *s == Some(IntentStage::FilesPending)), "{seen:?}");
        // Refused (a change is applied): nothing is written.
        let t = Tmp::new("i5b");
        seed(&t);
        t.ledger(&[("Game mode", "applied")]);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        assert!(matches!(clear_everything_at(&t.root, &shown.fingerprint, &later, &NoGates), ClearOutcome::Refused(_)));
        assert!(!t.has(INTENT_FILE), "a refused clear leaves no record for the next start to roll forward");
        // PlayHistory never writes one.
        let t = Tmp::new("i5c");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(done(exec(&t.root, &plan, &later())).complete);
        assert!(!t.has(INTENT_FILE));
    }

    #[test]
    fn i6_a_finished_clear_waits_for_the_screen_and_an_unfinished_one_cannot_be_acknowledged() {
        let t = Tmp::new("i6");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(done(exec(&t.root, &plan, &later())).complete);
        let i = intent_of(&t);
        assert_eq!((i.stage, i.scope.as_str(), i.remove_licence), (IntentStage::WebviewPending, "all", false));
        acknowledge_clear_at(&t.root).unwrap();
        assert!(!t.has(INTENT_FILE));
        acknowledge_clear_at(&t.root).unwrap(); // nothing there: fine
        // Pending files: refused, record kept.
        let t = Tmp::new("i6b");
        seed(&t);
        pend(&t, &later()).unwrap();
        assert_eq!(acknowledge_clear_at(&t.root).unwrap_err().code, "clear_files_pending");
        assert!(t.has(INTENT_FILE));
    }

    #[test]
    fn i7_the_licence_choice_comes_from_the_record_not_from_the_start_up_facts() {
        for remove in [false, true] {
            let t = Tmp::new("i7");
            seed(&t);
            pend(&t, &ClearFacts { remove_licence: remove, ..later() }).unwrap();
            // The start-up facts always say `false`; the record decides.
            assert!(matches!(roll_forward_at(&t.root, &later, &NoGates), RollForward::Completed(_)));
            assert_eq!(t.has("license.key"), !remove, "remove_licence={remove}");
        }
    }

    #[test]
    fn i8_after_one_start_up_attempt_the_record_is_abandoned_and_a_later_start_deletes_nothing() {
        let t = Tmp::new("i8");
        seed(&t);
        pend(&t, &later()).unwrap();
        let before = listing_but_intent(&t);
        let busy = || ClearFacts { benchmark_trial_running: true, ..later() };
        let outcome = roll_forward_at(&t.root, &busy, &NoGates);
        assert!(matches!(&outcome, RollForward::Abandoned { code, .. } if code == "needs_reconfirm"), "{outcome:?}");
        assert_eq!(before, listing_but_intent(&t), "refused at start-up: nothing was deleted");
        assert_eq!(intent_of(&t).stage, IntentStage::Abandoned, "one attempt only: the record is not left pending");
        // Every later start, however idle, deletes nothing: only a new confirmation may.
        assert!(matches!(roll(&t), RollForward::Abandoned { code, .. } if code == "needs_reconfirm"));
        assert_eq!(before, listing_but_intent(&t));
    }

    /// A start-up roll-forward that did not finish (a stop part-way) leaves the record abandoned, so data the
    /// user creates afterwards is never swept up by a later start.
    #[test]
    fn w1a_a_roll_forward_that_stops_part_way_abandons_and_the_data_made_since_survives_every_later_start() {
        let t = Tmp::new("w1a");
        seed(&t);
        pend(&t, &later()).unwrap();
        let gates = FlipAfter { fx: TestEffects::new(), after: 2, calls: Default::default() };
        let outcome = roll_forward_at(&t.root, &later, &gates);
        let RollForward::Incomplete(report) = &outcome else { panic!("expected Incomplete, got {outcome:?}") };
        assert!(!report.stopped.is_empty() && !report.deleted.is_empty());
        let i = intent_of(&t);
        assert_eq!((i.stage, i.abandoned_code.as_deref()), (IntentStage::Abandoned, Some("needs_reconfirm")));
        // The user plays on: new data in files the clear had not reached yet.
        t.put("support/evidence.jsonl", "made after the clear");
        t.put("sessions.json", "made after the clear");
        let before = t.listing();
        for _ in 0..2 {
            assert!(matches!(roll(&t), RollForward::Abandoned { code, .. } if code == "needs_reconfirm"));
            assert_eq!(before, t.listing(), "a later start deletes nothing");
        }
        assert_eq!(t.read("sessions.json"), "made after the clear");
    }

    fn edit_record(t: &Tmp, f: impl FnOnce(&mut ClearIntent)) {
        let mut i = intent_of(t);
        f(&mut i);
        write_intent(&t.root, &i).unwrap();
    }

    fn skipped_of(o: &RollForward) -> Vec<(String, &'static str)> {
        match o {
            RollForward::Incomplete(r) => r.skipped.iter().map(|s| (s.rel.clone(), s.reason)).collect(),
            other => panic!("expected Incomplete, got {other:?}"),
        }
    }

    #[test]
    fn w1b_a_hand_edited_record_can_never_add_a_target() {
        let t = Tmp::new("w1b");
        seed(&t);
        pend(&t, &later()).unwrap();
        let entry = |row: &str, rel: &str| ConfirmedFile { row_id: row.to_string(), rel: rel.to_string(), size: 1, modified_ms: 1 };
        edit_record(&t, |i| {
            i.confirmed = vec![
                entry("ledger-main", "history.json"),     // the ledger, with a size and time that are not its own
                entry("sessions", "../evil.json"),        // leaves the root
                entry("sessions", "a/b/c.json"),          // deeper than any store file
                entry("no-such-row", "made-up.json"),     // not in the inventory
            ];
        });
        let before = listing_but_intent(&t);
        let outcome = roll(&t);
        let skipped = skipped_of(&outcome);
        assert_eq!(before, listing_but_intent(&t), "nothing was deleted");
        assert!(t.has("history.json") && t.has("history.json.bak"));
        assert!(skipped.contains(&("history.json".to_string(), "changed_since_confirmed")), "{skipped:?}");
        for bad in ["../evil.json", "a/b/c.json", "made-up.json"] {
            assert!(skipped.contains(&(bad.to_string(), "invalid_record_entry")), "{bad}: {skipped:?}");
        }
        assert!(skipped.contains(&("sessions.json".to_string(), "not_in_confirmed_plan")), "{skipped:?}");
        assert_eq!(intent_of(&t).stage, IntentStage::Abandoned);
        assert!(!t.base.join("evil.json").exists());
    }

    #[test]
    fn w1b_a_file_modified_after_the_clear_started_is_never_deleted() {
        let t = Tmp::new("w1b2");
        seed(&t);
        pend(&t, &later()).unwrap();
        edit_record(&t, |i| i.started_at = 1000); // every file now looks newer than the clear
        let before = listing_but_intent(&t);
        let outcome = roll(&t);
        let skipped = skipped_of(&outcome);
        assert!(!skipped.is_empty() && skipped.iter().all(|(_, why)| *why == "newer_than_clear"), "{skipped:?}");
        assert_eq!(before, listing_but_intent(&t));
    }

    #[test]
    fn w1b_a_changed_file_and_a_file_that_was_not_in_the_confirmed_plan_are_kept_and_the_rest_goes() {
        let t = Tmp::new("w1b3");
        seed(&t);
        pend(&t, &later()).unwrap();
        t.put("sessions.json", "rewritten after the clear began"); // size and time differ from the record
        t.put("sessions.json.corrupt.999", "new"); // a file the confirmed plan never listed
        let outcome = roll(&t);
        let skipped = skipped_of(&outcome);
        assert!(skipped.contains(&("sessions.json".to_string(), "changed_since_confirmed")), "{skipped:?}");
        assert!(skipped.contains(&("sessions.json.corrupt.999".to_string(), "not_in_confirmed_plan")), "{skipped:?}");
        assert!(t.has("sessions.json") && t.has("sessions.json.corrupt.999"));
        assert!(!t.has("drift.json") && !t.has("history.json"), "what the record confirmed and is unchanged still goes");
    }

    #[test]
    fn w1c_a_hand_edited_record_cannot_make_the_licence_go() {
        let t = Tmp::new("w1c");
        seed(&t);
        pend(&t, &later()).unwrap(); // confirmed WITHOUT removing the licence
        edit_record(&t, |i| i.remove_licence = true);
        let outcome = roll(&t);
        let skipped = skipped_of(&outcome);
        assert!(t.has("license.key"), "the licence was not in the confirmed list");
        assert!(skipped.contains(&("license.key".to_string(), "not_in_confirmed_plan")), "{skipped:?}");
        // Confirmed WITH it: it goes (the legitimate case, i7).
        let t = Tmp::new("w1c2");
        seed(&t);
        pend(&t, &ClearFacts { remove_licence: true, ..later() }).unwrap();
        assert!(matches!(roll(&t), RollForward::Completed(_)));
        assert!(!t.has("license.key"));
    }

    #[test]
    fn b1_a_refused_clear_that_deleted_nothing_leaves_no_record_and_one_that_deleted_a_file_keeps_it() {
        // Nothing for phase 1 to delete: no ledger family, no Trial store.
        let t = Tmp::new("b1");
        seed(&t);
        for f in ["history.json", "history.json.bak", "history.json.restored", "history.json.bak.corrupt", "experiments.json"] {
            fs::remove_file(t.root.join(f)).unwrap();
        }
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        assert!(shown.can_proceed(), "{:?}", shown.refusals);
        assert!(!rels(&shown).iter().any(|r| r.starts_with("history.json") || *r == "experiments.json"));
        let fx = TestEffects::new();
        fx.live.set(running(|s| s.capture_active = true)); // seen only inside phase 2's first gate
        let before = t.listing();
        let outcome = clear_everything_at(&t.root, &shown.fingerprint, &later, &LiveGates(&fx));
        assert!(matches!(&outcome, ClearOutcome::Refused(r) if r[0].code == "capture_running"), "{outcome:?}");
        assert_eq!(before, t.listing(), "nothing was deleted");
        assert!(!t.has(INTENT_FILE), "refused with nothing deleted: no record for the next start to act on");
        // Mirror: one file deleted, then stopped: the record stays (abandoned: the screen saw the stop).
        let t = Tmp::new("b1b");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        let gates = FlipAfter { fx: TestEffects::new(), after: 2, calls: Default::default() };
        let report = done(clear_everything_at(&t.root, &shown.fingerprint, &later, &gates));
        assert!(!report.deleted.is_empty() && !report.stopped.is_empty());
        assert!(t.has(INTENT_FILE));
        assert_eq!(intent_of(&t).stage, IntentStage::Abandoned);
    }

    #[test]
    fn m5_the_ledger_backup_report_flag_is_a_listed_memory_copy_reset_with_the_support_record() {
        let c = MEMORY_COPIES.iter().find(|c| c.reason == "ledger_backup_report_flag").expect("listed");
        assert_eq!((c.reset_by, c.everything_only), (Some(Gate::SupportEvidence), true));
        assert!(c.holder.contains("SAVE_BACKUP_REPORTED"));
        // Real reset: the production effect calls it (it lives under the support record's gate arm).
        let core = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        let body = core.split("fn forget_support_preview(&self) {").nth(1).unwrap().split("\n    }\n").next().unwrap();
        assert!(body.contains("crate::history::forget_backup_report();"), "{body}");
        assert!(include_str!("history.rs").contains("static SAVE_BACKUP_REPORTED"), "the flag this row names still exists");
        // And no other once-per-run flag of that kind is left unlisted in history.rs.
        assert_eq!(include_str!("history.rs").matches("static SAVE_BACKUP_REPORTED").count(), 1);
    }

    #[test]
    fn t1_recorded_intent_needs_the_pending_record_it_was_made_from_and_is_used_once() {
        let dummy = |t: &Tmp| IntentToken {
            intent: ClearIntent {
                scope: "all".to_string(),
                remove_licence: false,
                started_at: u64::MAX,
                stage: IntentStage::FilesPending,
                abandoned_code: None,
                abandoned_detail: None,
                confirmed: plan_clear(&t.root, Scope::Everything, &later())
                    .delete
                    .iter()
                    .map(|d| ConfirmedFile { row_id: d.row_id.to_string(), rel: d.rel.clone(), size: d.size, modified_ms: d.modified_ms as u64 })
                    .collect(),
            },
        };
        // No record on disk: refused, nothing deleted.
        let t = Tmp::new("t1");
        seed(&t);
        let before = t.listing();
        let outcome = clear_everything_at(&t.root, Expected::RecordedIntent(dummy(&t)), &later, &NoGates);
        assert!(matches!(&outcome, ClearOutcome::Refused(r) if r[0].code == "no_clear_in_progress"), "{outcome:?}");
        assert_eq!(before, t.listing());
        // A record that is not the one the token was made from: refused.
        pend(&t, &later()).unwrap();
        edit_record(&t, |i| i.remove_licence = true);
        let before = t.listing();
        let outcome = clear_everything_at(&t.root, Expected::RecordedIntent(dummy(&t)), &later, &NoGates);
        assert!(matches!(&outcome, ClearOutcome::Refused(r) if r[0].code == "no_clear_in_progress"), "{outcome:?}");
        assert_eq!(before, t.listing());
        // The matching record: it works, once. A second token made from the same record is refused.
        let token = IntentToken { intent: intent_of(&t) };
        let again = IntentToken { intent: intent_of(&t) };
        assert!(done(clear_everything_at(&t.root, Expected::RecordedIntent(token), &later, &NoGates)).complete);
        let after = t.listing();
        let outcome = clear_everything_at(&t.root, Expected::RecordedIntent(again), &later, &NoGates);
        assert!(matches!(&outcome, ClearOutcome::Refused(r) if r[0].code == "no_clear_in_progress"), "{outcome:?}");
        assert_eq!(after, t.listing());
        // Only the roll-forward builds one.
        let core = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        assert_eq!(core.matches("Expected::RecordedIntent(").count(), 2, "one construction (roll_forward_at), one match (clear_everything_at)");
        assert_eq!(core.matches("IntentToken {").count(), 2, "the struct and its one literal");
    }

    #[test]
    fn i10_an_intent_that_cannot_be_written_refuses_the_clear_before_the_first_delete() {
        use crate::atomic_write::{force_next_failure, FailPoint};
        // The dangerous case is a clear that deletes with no record for the next start to finish. Every
        // way the record can fail to be written must stop the clear first.
        for at in [FailPoint::AfterTempCreate, FailPoint::DuringWrite, FailPoint::AfterWrite] {
            let t = Tmp::new("i10");
            seed(&t);
            let shown = plan_clear(&t.root, Scope::Everything, &later());
            assert!(shown.can_proceed());
            let before = t.listing();
            force_next_failure(at); // the next atomic write on this thread fails: the intent is the first one
            let outcome = clear_everything_at(&t.root, &shown.fingerprint, &later, &NoGates);
            let ClearOutcome::Refused(r) = &outcome else { panic!("{at:?}: expected Refused, got {outcome:?}") };
            assert_eq!(r.iter().map(|x| x.code).collect::<Vec<_>>(), ["clear_intent_unwritable"], "{at:?}");
            assert_eq!(before, t.listing(), "{at:?}: nothing was deleted and no half-written record or temp is left");
            assert!(!t.has(INTENT_FILE), "{at:?}");
            // The failure was one-shot: the same clear, run again, writes the record first and finishes.
            let again = plan_clear(&t.root, Scope::Everything, &later());
            assert!(done(clear_everything_at(&t.root, &again.fingerprint, &later, &NoGates)).complete, "{at:?}");
            assert_eq!(intent_of(&t).stage, IntentStage::WebviewPending, "{at:?}");
        }
    }

    // ---- C1: "Clear play history" is wired to the screen ------------------------------------------

    /// The screen's path, on a temp root: `plan_clear` (what `plan_clear_play_history` returns) then
    /// `clear_play_history_at` with the shown fingerprint (what `clear_play_history` runs). What is deleted
    /// is exactly what was shown; every refusal deletes nothing and writes no record; a stale fingerprint
    /// deletes nothing; the change history and Gaming Mode files are byte-for-byte the same afterwards.
    #[test]
    fn w0_the_screen_path_deletes_exactly_what_it_showed_and_a_refusal_deletes_nothing() {
        let t = Tmp::new("w0");
        seed(&t);
        t.ledger(&[("Core parking", "applied"), ("Game mode", "rolled_back")]);
        t.put("gaming-session.orphaned.json", "{}");
        let family = ["history.json", "history.json.bak", "history.json.restored", "history.json.bak.corrupt", "gaming-session.orphaned.json"];
        let ledger_before: Vec<String> = family.iter().map(|f| t.read(f)).collect();
        let shown = plan_clear(&t.root, Scope::PlayHistory, &later());
        assert!(shown.can_proceed());
        // A stale fingerprint: nothing deleted, no record.
        let before = t.listing();
        assert!(matches!(clear_play_history_at(&t.root, "stale", &later(), &NoGates), ClearOutcome::PlanChanged));
        assert_eq!(before, t.listing());
        let report = done(clear_play_history_at(&t.root, &shown.fingerprint, &later(), &NoGates));
        let mut deleted = report.deleted.clone();
        deleted.sort();
        let mut listed: Vec<String> = shown.delete.iter().map(|d| d.rel.clone()).collect();
        listed.sort();
        assert_eq!(deleted, listed, "deleted == shown");
        assert!(report.complete && report.failed.is_empty() && report.not_attempted.is_empty());
        for d in &shown.delete {
            assert!(!t.has(&d.rel), "{} was shown as deleted but is still there", d.rel);
        }
        assert!(!t.has(INTENT_FILE), "play history never writes a clear record");
        let ledger_after: Vec<String> = family.iter().map(|f| t.read(f)).collect();
        assert_eq!(ledger_before, ledger_after, "play history never touches the change history");
        assert_eq!(report.restart_reasons, ["screen_memory"]);
        assert!(!report.webview.is_empty());

        // Every refusal the screen names: nothing deleted, no record.
        #[allow(clippy::type_complexity)]
        let cases: Vec<(&str, Box<dyn Fn(&Tmp)>, ClearFacts)> = vec![
            ("capture_running", Box::new(|_: &Tmp| {}), ClearFacts { capture_active: true, ..later() }),
            ("recording_in_progress", Box::new(|_: &Tmp| {}), ClearFacts { recorder_busy: true, ..later() }),
            ("benchmark_trial_running", Box::new(|_: &Tmp| {}), ClearFacts { benchmark_trial_running: true, ..later() }),
            ("gaming_mode_active", Box::new(|t: &Tmp| t.put("gaming-session.json", "{}")), later()),
            ("trial_state_unknown", Box::new(|t: &Tmp| t.put("experiments.json", "{ not json")), later()),
        ];
        for (code, setup, f) in cases {
            let t = Tmp::new(code);
            seed(&t);
            setup(&t);
            let ok = plan_clear(&t.root, Scope::PlayHistory, &later());
            let before = t.listing();
            let shown = plan_clear(&t.root, Scope::PlayHistory, &f);
            assert!(shown.refusals.iter().any(|r| r.code == code), "{code}: {:?}", shown.refusals);
            assert!(shown.delete.is_empty(), "{code}: a refused plan lists nothing");
            // Both the refused plan's fingerprint and an earlier good one are refused, never deleted.
            for fp in [&shown.fingerprint, &ok.fingerprint] {
                match clear_play_history_at(&t.root, fp, &f, &NoGates) {
                    ClearOutcome::Refused(r) => assert!(r.iter().any(|x| x.code == code), "{code}"),
                    other => panic!("{code}: expected Refused, got {other:?}"),
                }
            }
            assert_eq!(before, t.listing(), "{code}: nothing deleted");
            assert!(!t.has(INTENT_FILE), "{code}: no record");
        }
    }

    /// A gate double that, when the Trial store's gate is taken, first does what a Trial start or an apply
    /// from another surface would do while the clear waited for that lock.
    struct InterleaveAtTrialGate<'a> {
        root: &'a Path,
        meanwhile: &'a dyn Fn(&Path),
    }

    impl ClearGates for InterleaveAtTrialGate<'_> {
        fn with_gate(&self, gate: Gate, _store: &'static str, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
            if gate == Gate::Experiment {
                (self.meanwhile)(self.root);
            }
            delete()
        }
        fn live_state(&self) -> LiveState {
            LiveState::default()
        }
    }

    /// C1 review B4: a Trial that starts (pending or running), or a change applied, between the plan check and
    /// the Trial store's delete is seen inside that store's gate. The Trial store and every file after it stay,
    /// and the report names why.
    #[test]
    fn w0d_a_trial_start_or_an_apply_between_the_check_and_the_trial_delete_keeps_the_trial_store() {
        #[allow(clippy::type_complexity)]
        let cases: Vec<(&str, Box<dyn Fn(&Path)>)> = vec![
            ("trial_running", Box::new(|r: &Path| fs::write(r.join("experiments.json"), trial_store("pending")).unwrap())),
            ("trial_running", Box::new(|r: &Path| fs::write(r.join("experiments.json"), trial_store("running")).unwrap())),
            ("trial_state_unknown", Box::new(|r: &Path| fs::write(r.join("experiments.json"), "{ half written").unwrap())),
            (
                "trials_tied_to_changes",
                Box::new(|r: &Path| {
                    fs::write(r.join("history.json"), r#"[{"id":"c9","rec_id":"r9","rec_title":"Core parking","applied_at":"2026-11-01T00:00:00Z","snapshot":{},"status":"applied"}]"#).unwrap()
                }),
            ),
        ];
        for (code, meanwhile) in cases {
            let t = Tmp::new("w0d");
            seed(&t);
            let shown = plan_clear(&t.root, Scope::PlayHistory, &later());
            assert!(rels(&shown).contains(&"experiments.json"), "{code}: the plan lists the Trial store");
            let gates = InterleaveAtTrialGate { root: &t.root, meanwhile: &*meanwhile };
            let report = done(clear_play_history_at(&t.root, &shown.fingerprint, &later(), &gates));
            assert!(t.has("experiments.json"), "{code}: the Trial store must survive");
            assert!(!report.deleted.contains(&"experiments.json".to_string()), "{code}");
            assert!(report.not_attempted.contains(&"experiments.json".to_string()), "{code}: {report:?}");
            assert!(!report.complete, "{code}: never reported as complete");
            assert_eq!(report.stopped.iter().map(|r| r.code).collect::<Vec<_>>(), [code], "{code}");
            assert!(!t.has(INTENT_FILE), "{code}");
        }
    }

    /// The JSON the screen reads (`src/surfaces/your-data.ts`). A renamed field would make the screen
    /// show nothing, or show "deleted" from a missing list; this pins the names it relies on.
    #[test]
    fn w0b_the_plan_and_the_outcome_serialize_with_the_names_the_screen_reads() {
        let t = Tmp::new("w0b");
        seed(&t);
        let plan = plan_clear(&t.root, Scope::PlayHistory, &later());
        let v = serde_json::to_value(&plan).unwrap();
        assert_eq!(v["scope"], "play_history");
        for k in ["delete", "kept", "unknown", "refusals", "webview", "fingerprint", "legacy_folder_present"] {
            assert!(v.get(k).is_some(), "plan.{k}");
        }
        for k in ["rel", "row_id", "store", "size"] {
            assert!(v["delete"][0].get(k).is_some(), "plan.delete[].{k}");
        }
        for k in ["rel", "code"] {
            assert!(v["kept"][0].get(k).is_some(), "plan.kept[].{k}");
        }
        for k in ["key", "prefix", "session_storage"] {
            assert!(v["webview"][0].get(k).is_some(), "plan.webview[].{k}");
        }
        let out = serde_json::to_value(clear_play_history_at(&t.root, &plan.fingerprint, &later(), &NoGates)).unwrap();
        assert_eq!(out["status"], "done");
        for k in ["deleted", "already_gone", "failed", "not_attempted", "stopped", "kept", "unknown", "complete", "nothing_to_do", "restart_required", "restart_reasons", "webview"] {
            assert!(out["detail"].get(k).is_some(), "report.{k}");
        }
        assert_eq!(serde_json::to_value(ClearOutcome::PlanChanged).unwrap()["status"], "plan_changed");
        let refused = serde_json::to_value(ClearOutcome::Refused(vec![Refusal { code: "capture_running", detail: String::new(), files: vec![] }])).unwrap();
        assert_eq!(refused["status"], "refused");
        assert_eq!(refused["detail"][0]["code"], "capture_running");
    }

    /// C1 + C2b: the six screen commands are registered from `off_main` and call only the live wrappers. The
    /// root-taking `_on` functions are for tests: lib.rs never calls one.
    #[test]
    fn w0c_the_screen_commands_are_wired_to_the_live_wrappers_only() {
        let lib = include_str!("lib.rs");
        let handler = &lib[lib.find(concat!("generate_handler", "![")).expect("handler")..];
        let handler = &handler[..handler.find("])").expect("handler end")];
        for cmd in ["plan_clear_play_history", "clear_play_history", "plan_clear_everything", "clear_everything", "get_clear_status", "acknowledge_clear"] {
            assert!(handler.contains(&format!("off_main::{cmd},")), "{cmd} is registered from off_main");
        }
        for call in [
            "crate::data_clear::plan_clear_play_history()",
            "crate::data_clear::clear_play_history(&fingerprint)",
            "crate::data_clear::plan_clear_everything(remove_licence)",
            "crate::data_clear::clear_everything(&fingerprint, remove_licence)",
            "crate::data_clear::get_clear_status()",
            "crate::data_clear::acknowledge_clear()",
        ] {
            assert_eq!(lib.matches(call).count(), 1, "{call} once, from its command");
        }
        for test_only in [
            concat!("data_clear::plan_play_", "history_on"),
            concat!("data_clear::clear_play_", "history_on"),
            concat!("data_clear::plan_", "everything_on"),
            concat!("data_clear::clear_", "everything_on"),
            concat!("data_clear::finish_interrupted_", "clear_on"),
            concat!("data_clear::clear_", "status_on"),
            concat!("data_clear::acknowledge_", "clear_on"),
            concat!("data_clear::clear_everything", "_at"),
            concat!("data_clear::roll_forward", "_at"),
        ] {
            assert!(!lib.contains(test_only), "{test_only} is for tests; the app calls the live wrappers");
        }
    }

    /// C2b: `remember_roll_forward(&finish_interrupted_clear())` are the FIRST two statements of `setup`, before
    /// the `app_start` record, the experiment reconcile and the ledger-backup thread; the support-record entry
    /// comes after `app_start`; nothing else calls the roll-forward (main.rs neither: its helpers exit first).
    #[test]
    fn i9b_setup_runs_the_roll_forward_first_and_only_there() {
        let lib = include_str!("lib.rs");
        let setup = lib.split(concat!(".setup(", "|app| {")).nth(1).expect("setup");
        let code: Vec<&str> = setup.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("//")).collect();
        assert_eq!(code[0], "let roll_forward = crate::data_clear::finish_interrupted_clear();", "first statement");
        assert_eq!(code[1], "crate::data_clear::remember_roll_forward(&roll_forward);");
        let pos = |needle: &str| setup.find(needle).unwrap_or_else(|| panic!("{needle} not in setup"));
        let rf = pos("finish_interrupted_clear()");
        assert!(rf < pos("\"app_start\""), "before the app_start record");
        assert!(rf < pos("reconcile_interrupted_starts"), "before the experiment reconcile");
        assert!(rf < pos("ensure_backup_at_start"), "before the ledger-backup thread");
        assert!(pos("\"app_start\"") < pos("record_roll_forward_evidence()"), "the support entry after app_start");
        assert_eq!(lib.matches(concat!("finish_interrupted", "_clear()")).count(), 1, "called once, in setup");
        assert!(!include_str!("main.rs").contains("finish_interrupted_clear"));
    }

    /// C2b: the status the screen reads, for each state of the record; the start-up result is passed through
    /// (a "nothing to do" result is not); no root is its own answer and reads nothing.
    #[test]
    fn z1_clear_status_names_the_record_and_the_start_up_result() {
        let t = Tmp::new("z1");
        let st = clear_status_on(Ok(t.root.clone()), Some(serde_json::json!({"status": "nothing_to_do"})));
        assert_eq!((st.record, st.roll_forward.is_none(), st.abandoned_code.is_none()), ("none", true, true));
        assert!(!st.webview.is_empty() && st.webview == webview_targets(Scope::Everything));
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        assert!(done(clear_everything_at(&t.root, &shown.fingerprint, &later, &NoGates)).complete);
        let rf = serde_json::json!({"status": "completed", "detail": {}});
        let st = clear_status_on(Ok(t.root.clone()), Some(rf.clone()));
        assert_eq!(st.record, "webview_pending");
        assert_eq!(st.roll_forward, Some(rf));
        let mut i = intent_of(&t);
        i.stage = IntentStage::Abandoned;
        i.abandoned_code = Some("needs_reconfirm".into());
        write_intent(&t.root, &i).unwrap();
        let st = clear_status_on(Ok(t.root.clone()), None);
        assert_eq!((st.record, st.abandoned_code.as_deref()), ("abandoned", Some("needs_reconfirm")));
        i.stage = IntentStage::FilesPending;
        write_intent(&t.root, &i).unwrap();
        assert_eq!(clear_status_on(Ok(t.root.clone()), None).record, "files_pending");
        t.put(INTENT_FILE, "{ not a record");
        assert_eq!(clear_status_on(Ok(t.root.clone()), None).record, "unreadable");
        let none = Err(Refusal { code: "data_root_unavailable", detail: String::new(), files: Vec::new() });
        assert_eq!(clear_status_on(none, None).record, "no_root");
    }

    /// C2b: acknowledging removes a finished or abandoned record only; a pending one is refused and kept.
    #[test]
    fn z2_acknowledge_removes_a_finished_record_only() {
        let t = Tmp::new("z2");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        assert!(done(clear_everything_at(&t.root, &shown.fingerprint, &later, &NoGates)).complete);
        let mut i = intent_of(&t);
        i.stage = IntentStage::FilesPending;
        write_intent(&t.root, &i).unwrap();
        assert_eq!(acknowledge_clear_on(Ok(t.root.clone())).unwrap_err().code, "clear_files_pending");
        assert!(t.has(INTENT_FILE));
        i.stage = IntentStage::WebviewPending;
        write_intent(&t.root, &i).unwrap();
        assert!(acknowledge_clear_on(Ok(t.root.clone())).is_ok());
        assert!(!t.has(INTENT_FILE));
        let none = Err(Refusal { code: "data_root_unavailable", detail: String::new(), files: Vec::new() });
        assert_eq!(acknowledge_clear_on(none).unwrap_err().code, "data_root_unavailable");
    }

    /// C2b: which start-up results become a support-record entry, and with which code.
    #[test]
    fn z3_a_start_up_roll_forward_that_did_not_finish_is_named_in_the_support_record() {
        let ab = serde_json::to_value(RollForward::Abandoned { code: "changes_applied".into(), detail: "x".into() }).unwrap();
        assert_eq!(roll_forward_evidence(&ab).map(|e| (e.0, e.1)), Some(("changes_applied".to_string(), false)));
        let kept = serde_json::to_value(RollForward::Kept { code: "clear_intent_unreadable", detail: "x".into() }).unwrap();
        assert_eq!(roll_forward_evidence(&kept).map(|e| (e.0, e.1)), Some(("clear_intent_unreadable".to_string(), true)));
        for quiet in [RollForward::NothingToDo, RollForward::WebviewPending, RollForward::Deferred(Vec::new())] {
            assert!(roll_forward_evidence(&serde_json::to_value(quiet).unwrap()).is_none());
        }
        let t = Tmp::new("z3");
        seed(&t);
        let shown = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(clear_everything_at(&t.root, &shown.fingerprint, &later, &NoGates));
        let done_rf = serde_json::to_value(RollForward::Completed(report.clone())).unwrap();
        assert!(roll_forward_evidence(&done_rf).is_none(), "a finished roll-forward is not a failure");
        let part = serde_json::to_value(RollForward::Incomplete(report)).unwrap();
        assert_eq!(roll_forward_evidence(&part).map(|e| (e.0, e.1)), Some(("incomplete".to_string(), true)));
    }

    // ---- C2a: the live wrappers are one line; everything else runs here on temp roots ----------------------

    /// The core (non-test) source.
    fn core_src() -> &'static str {
        include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap()
    }

    /// The body of `pub(crate) fn <name>(` in the core, between its first `{` and the closing `\n}\n`.
    fn body_of(name: &str) -> &'static str {
        let after = core_src().split(&format!("pub(crate) fn {name}(")).nth(1).unwrap_or_else(|| panic!("{name} not found"));
        let open = after.find("{\n").unwrap_or_else(|| panic!("{name}: no body"));
        after[open + 2..].split("\n}\n").next().unwrap()
    }

    const LIVE_WRAPPERS: &[(&str, &str)] = &[
        ("plan_clear_play_history", "plan_play_history_on(live_root(), &ProcessEffects)"),
        ("plan_clear_everything", "plan_everything_on(live_root(), remove_licence, &ProcessEffects)"),
        ("clear_play_history", "clear_play_history_on(live_root(), expected_fingerprint, &ProcessEffects)"),
        ("clear_everything", "clear_everything_on(live_root(), expected_fingerprint, remove_licence, &ProcessEffects)"),
        ("finish_interrupted_clear", "finish_interrupted_clear_on(live_root(), &ProcessEffects)"),
        ("get_clear_status", "clear_status_on(live_root(), STARTUP_ROLL_FORWARD.get().cloned())"),
        ("acknowledge_clear", "acknowledge_clear_on(live_root())"),
    ];

    /// C2a shape guard: each live wrapper is exactly "resolve the verified root, hand it and the process's effects
    /// to the root-taking function". A wrapper that gains any other statement fails here, and so does a
    /// root-taking function that resolves a root or names the process's effects itself.
    #[test]
    fn v1_each_live_wrapper_is_one_line_and_only_wrappers_resolve_the_root() {
        for (name, expected) in LIVE_WRAPPERS {
            assert_eq!(body_of(name).trim(), *expected, "{name} must be exactly one call");
            let on = expected.split('(').next().unwrap();
            let on_body = body_of(on);
            assert!(!on_body.contains("live_root") && !on_body.contains("ProcessEffects") && !on_body.contains("data_root::"), "{on} must take the root and the effects as arguments");
        }
        // `live_root` itself is exactly the verified-root lookup and the typed refusal (review r1).
        let core = core_src();
        let live_root_fn = core.split("fn live_root() -> Result<PathBuf, Refusal> {\n").nth(1).expect("live_root").split("\n}\n").next().unwrap();
        assert_eq!(
            live_root_fn,
            "    data_root::mutation_root().map(|r| r.path().to_path_buf()).map_err(|why| Refusal {\n        code: \"data_root_unavailable\",\n        detail: why,\n        files: Vec::new(),\n    })",
            "live_root must stay the one verified-root lookup"
        );
        // `live_root()` is called by the five wrappers and nowhere else; `&ProcessEffects` likewise.
        assert_eq!(core.matches("live_root()").count(), LIVE_WRAPPERS.len() + 1, "one call per wrapper + the definition");
        let with_effects = LIVE_WRAPPERS.iter().filter(|(_, e)| e.contains("&ProcessEffects")).count();
        assert_eq!(with_effects, 5);
        assert_eq!(core.matches("&ProcessEffects").count(), with_effects, "only the wrappers pass the process's effects");
    }

    fn unavailable() -> Result<PathBuf, Refusal> {
        Err(Refusal { code: "data_root_unavailable", detail: "test: no canonical root".into(), files: Vec::new() })
    }

    /// Play history through the root-taking functions with the real store gates and the test's own effects:
    /// plan -> fingerprint -> clear -> report equals the plan; no root is a typed refusal that touches
    /// nothing; a capture the effects report refuses.
    #[test]
    fn v2_play_history_through_the_root_taking_functions() {
        let t = Tmp::new("v2");
        seed(&t);
        // The real clock: the freshly seeded working file is kept ("less than an hour old") and not listed.
        let fx = TestEffects::new();
        let shown = plan_play_history_on(Ok(t.root.clone()), &fx);
        assert!(shown.can_proceed(), "{:?}", shown.refusals);
        let report = done(clear_play_history_on(Ok(t.root.clone()), &shown.fingerprint, &fx));
        let mut deleted = report.deleted.clone();
        deleted.sort();
        let mut listed: Vec<String> = shown.delete.iter().map(|d| d.rel.clone()).collect();
        listed.sort();
        assert!(!listed.is_empty(), "non-vacuous: the plan lists files");
        assert_eq!(deleted, listed);
        assert!(report.complete && t.has("history.json") && !t.has(INTENT_FILE));
        // A stale fingerprint deletes nothing.
        let t2 = Tmp::new("v2b");
        seed(&t2);
        let before = t2.listing();
        assert!(matches!(clear_play_history_on(Ok(t2.root.clone()), "stale", &fx), ClearOutcome::PlanChanged));
        assert_eq!(before, t2.listing());
        // No root: typed refusal, nothing read or deleted.
        let plan = plan_play_history_on(unavailable(), &fx);
        assert_eq!(plan.refusals.iter().map(|r| r.code).collect::<Vec<_>>(), ["data_root_unavailable"]);
        assert!(plan.delete.is_empty());
        match clear_play_history_on(unavailable(), &shown.fingerprint, &fx) {
            ClearOutcome::Refused(r) => assert_eq!(r[0].code, "data_root_unavailable"),
            other => panic!("expected Refused, got {other:?}"),
        }
        // The facts come from the effects passed in.
        fx.live.set(LiveState { capture_active: true, ..LiveState::default() });
        let plan = plan_play_history_on(Ok(t2.root.clone()), &fx);
        assert!(plan.refusals.iter().any(|r| r.code == "capture_running"), "{:?}", plan.refusals);
        assert!(matches!(clear_play_history_on(Ok(t2.root.clone()), &plan.fingerprint, &fx), ClearOutcome::Refused(_)));
        assert_eq!(before, t2.listing());
    }

    /// Effects that start a Trial in the root at the first in-gate live read (the first read is the plan's).
    struct TrialStartsMidRun<'a> {
        inner: TestEffects,
        root: &'a Path,
        reads: std::cell::Cell<u32>,
    }

    impl ClearEffects for TrialStartsMidRun<'_> {
        fn deleted(&self, store: &'static str) {
            self.inner.deleted(store)
        }
        fn with_benchmark_locked(&self, delete: &mut dyn FnMut() -> Result<Removed, String>) -> Result<Removed, String> {
            self.inner.with_benchmark_locked(delete)
        }
        fn forget_trial_result(&self) {
            self.inner.forget_trial_result()
        }
        fn forget_incident_failures(&self) {
            self.inner.forget_incident_failures()
        }
        fn forget_support_preview(&self) {
            self.inner.forget_support_preview()
        }
        fn forget_identity_throttle(&self) {
            self.inner.forget_identity_throttle()
        }
        fn live_state(&self) -> LiveState {
            self.reads.set(self.reads.get() + 1);
            if self.reads.get() == 2 {
                fs::write(self.root.join("experiments.json"), trial_store("pending")).unwrap();
            }
            self.inner.live_state()
        }
    }

    /// C1 review B4 through the root-taking function and the real Trial gate: the Trial store stays.
    #[test]
    fn v3_a_trial_started_mid_run_keeps_the_trial_store_through_the_live_path() {
        let t = Tmp::new("v3");
        seed(&t);
        let fx = TrialStartsMidRun { inner: TestEffects::new(), root: &t.root, reads: Default::default() };
        // The plan through the same path with the inner effects (their reads are not counted).
        let shown = plan_play_history_on(Ok(t.root.clone()), &fx.inner);
        assert!(rels(&shown).contains(&"experiments.json"));
        let report = done(clear_play_history_on(Ok(t.root.clone()), &shown.fingerprint, &fx));
        assert!(t.has("experiments.json"), "the Trial store must survive");
        assert!(!report.complete && report.not_attempted.contains(&"experiments.json".to_string()));
        assert_eq!(report.stopped.iter().map(|r| r.code).collect::<Vec<_>>(), ["trial_running"]);
    }

    /// "Clear everything" and the roll-forward through their root-taking functions (still unregistered and
    /// uncalled by the app): no root refuses or defers; a temp-root clear completes and waits for the screen.
    #[test]
    fn v4_everything_and_the_roll_forward_through_the_root_taking_functions() {
        let fx = TestEffects::new();
        let plan = plan_everything_on(unavailable(), false, &fx);
        assert_eq!(plan.refusals.iter().map(|r| r.code).collect::<Vec<_>>(), ["data_root_unavailable"]);
        assert!(matches!(clear_everything_on(unavailable(), "x", false, &fx), ClearOutcome::Refused(r) if r[0].code == "data_root_unavailable"));
        assert!(matches!(finish_interrupted_clear_on(unavailable(), &fx), RollForward::Deferred(r) if r[0].code == "data_root_unavailable"));
        let t = Tmp::new("v4");
        seed(&t);
        assert!(matches!(finish_interrupted_clear_on(Ok(t.root.clone()), &fx), RollForward::NothingToDo));
        let shown = plan_everything_on(Ok(t.root.clone()), false, &fx);
        assert!(shown.can_proceed(), "{:?}", shown.refusals);
        assert!(!rels(&shown).contains(&"license.key"), "the licence goes only when asked");
        let report = done(clear_everything_on(Ok(t.root.clone()), &shown.fingerprint, false, &fx));
        let mut deleted = report.deleted.clone();
        deleted.sort();
        let mut listed: Vec<String> = shown.delete.iter().map(|d| d.rel.clone()).collect();
        listed.sort();
        assert!(!listed.is_empty(), "non-vacuous: the plan lists files");
        assert_eq!(deleted, listed);
        assert!(report.complete && t.has("license.key") && !t.has("history.json"));
        assert_eq!(intent_of(&t).stage, IntentStage::WebviewPending);
        assert!(matches!(finish_interrupted_clear_on(Ok(t.root.clone()), &fx), RollForward::WebviewPending));
    }

    #[test]
    fn i9_the_roll_forward_is_pure_over_a_root_and_the_live_hook_is_not_called_from_anywhere() {
        let core = include_str!("data_clear.rs").split("#[cfg(test)]\nmod tests").next().unwrap();
        let pure = core.split("pub(crate) fn roll_forward_at(").nth(1).unwrap().split("// ---- live wrappers").next().unwrap();
        assert!(!pure.contains("live_root") && !pure.contains("ProcessEffects") && !pure.contains("live_facts"), "the roll-forward never resolves the real root");
        // Where the live hook IS called (C2b) is pinned by `i9b`.
    }
}
