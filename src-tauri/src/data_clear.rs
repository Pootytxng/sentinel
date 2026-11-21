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
//! This slice (D4-2) exposes `Scope::PlayHistory` through two commands. `Scope::Everything` is planned
//! and executed by the same code but has no command yet (D4-3 adds the lock order, the clear-intent
//! file and the start-up roll-forward). The core below this file's `live wrappers` marker takes the root as
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

// ---- the plan ---------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct PlannedDelete {
    /// Relative to the data root, `/` separated.
    pub(crate) rel: String,
    pub(crate) row_id: &'static str,
    pub(crate) category: &'static str,
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
            h.update(format!("{}|{}\n", d.rel, d.row_id));
        }
        self.fingerprint = format!("{:x}", h.finalize());
        self
    }
}

/// Facts the planner cannot read from the folder. The live command reads them from the running app;
/// a test sets them.
#[derive(Debug, Clone)]
pub(crate) struct ClearFacts {
    /// A Trial is starting or running.
    pub(crate) trial_active: bool,
    /// A capture (a game being measured) is running.
    pub(crate) capture_active: bool,
    /// `Everything` only: also delete the licence token.
    pub(crate) remove_licence: bool,
    /// The clock the "working file is older than an hour" rule reads.
    pub(crate) now: SystemTime,
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

fn is_live_contract(rel: &str) -> bool {
    let l = rel.to_lowercase();
    l == "gaming-session.json" || l.ends_with(".tmp")
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
            return if everything {
                Verdict::Refuse(
                    "gaming_orphan",
                    "A Gaming Mode contract file was left behind. It may be the only record of what to restore, so Compy does not delete it.",
                )
            } else {
                Verdict::Keep("undo_data", "Kept: it may be needed to restore changes Gaming Mode made.")
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
    if facts.capture_active {
        plan.refuse("capture_running", "Compy is measuring a game right now. Close the game or stop measuring first.", None);
    }
    if facts.trial_active {
        plan.refuse("trial_running", "A Trial is running. Let it finish or stop it first.", None);
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
        Verdict::Delete => plan.delete.push(PlannedDelete { rel, row_id: hit.row.id, category: cat_name(hit.class.category) }),
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
    /// Not tried because an earlier ledger file could not be deleted.
    pub(crate) not_attempted: Vec<String>,
    pub(crate) kept: Vec<Kept>,
    pub(crate) unknown: Vec<String>,
    /// True only when every file the plan listed is gone.
    pub(crate) complete: bool,
    /// The running app still holds some of this in memory; it needs a restart.
    pub(crate) restart_required: bool,
    pub(crate) webview: Vec<WebviewTarget>,
}

impl ClearReport {
    /// The one sentence a screen may show. It says "Cleared" only when everything listed is gone.
    pub(crate) fn summary(&self) -> String {
        let gone = self.deleted.len() + self.already_gone.len();
        if self.complete {
            format!("Cleared: {gone} file(s) deleted.")
        } else {
            format!(
                "Not finished: {gone} file(s) deleted, {} could not be deleted, {} not tried. Run it again after closing whatever is using them.",
                self.failed.len(),
                self.not_attempted.len()
            )
        }
    }
}

#[derive(Debug)]
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

enum Removed {
    Deleted,
    AlreadyGone,
}

/// Deletes one planned file, re-checking on the spot that it is a plain file whose folders are plain
/// folders inside the root. Never follows a link.
fn delete_one(root: &Path, rel: &str) -> Result<Removed, String> {
    let segs = validate_rel(rel)?;
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
    let file: PathBuf = dir.join(segs[segs.len() - 1]);
    match fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Removed::AlreadyGone),
        Err(e) => return Err(format!("could not be checked ({e})")),
        Ok(m) if is_link(&m) || !m.is_file() => return Err("is not a plain file, so it was left alone".to_string()),
        Ok(_) => {}
    }
    fs::remove_file(&file).map_err(|e| e.to_string())?;
    match fs::symlink_metadata(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Removed::Deleted),
        _ => Err("is still there after the delete".to_string()),
    }
}

/// Deletes what `plan` listed, and only that. Re-plans first: a refusal now, or a list that differs from
/// `plan`, deletes nothing. A file that fails is reported and the rest go on, except that a failure
/// inside the ledger family stops the family (the backup must be gone before `history.json`).
pub(crate) fn execute_clear(root: &Path, plan: &ClearPlan, facts: &ClearFacts) -> ClearOutcome {
    let now = plan_clear(root, plan.scope, facts);
    if !now.refusals.is_empty() {
        return ClearOutcome::Refused(now.refusals);
    }
    if now.fingerprint != plan.fingerprint || now.delete != plan.delete {
        return ClearOutcome::PlanChanged;
    }
    let mut report = ClearReport {
        scope: now.scope,
        deleted: Vec::new(),
        already_gone: Vec::new(),
        failed: Vec::new(),
        not_attempted: Vec::new(),
        kept: now.kept.clone(),
        unknown: now.unknown.clone(),
        complete: false,
        restart_required: true,
        webview: now.webview.clone(),
    };
    let mut ledger_failed = false;
    for d in &now.delete {
        if ledger_failed && d.row_id.starts_with("ledger-") {
            report.not_attempted.push(d.rel.clone());
            continue;
        }
        match delete_one(root, &d.rel) {
            Ok(Removed::Deleted) => report.deleted.push(d.rel.clone()),
            Ok(Removed::AlreadyGone) => report.already_gone.push(d.rel.clone()),
            Err(error) => {
                ledger_failed |= d.row_id.starts_with("ledger-");
                report.failed.push(FailedDelete { rel: d.rel.clone(), error });
            }
        }
    }
    report.complete = report.failed.is_empty() && report.not_attempted.is_empty();
    ClearOutcome::Done(report)
}

// ---- live wrappers (the only code below that touches the running app) ------------------------------

/// Reads the facts only the running app knows. The experiment store gate must already be held.
fn live_facts(root: &Path) -> Result<ClearFacts, String> {
    let trial_active = crate::experiment::load_store_checked_from(&root.join(EXPERIMENTS_FILE))
        .map(|s| crate::experiment::active_trial(&s).is_some())?;
    Ok(ClearFacts {
        trial_active,
        capture_active: crate::monitoring::fps_active().load(std::sync::atomic::Ordering::Acquire),
        remove_licence: false,
        now: SystemTime::now(),
    })
}

const EXPERIMENTS_FILE: &str = "experiments.json";

/// What "Clear play history" would delete, keep and leave alone, right now. Changes nothing.
#[tauri::command]
pub(crate) fn plan_clear_play_history() -> Result<ClearPlan, String> {
    let root = crate::data_root::mutation_root()?;
    let _gate = crate::experiment::lock_store()?;
    let facts = live_facts(root.path())?;
    Ok(plan_clear(root.path(), Scope::PlayHistory, &facts))
}

/// Deletes the play history the plan with `expected_fingerprint` listed. Never touches `history.json*`.
/// Refuses (deleting nothing) when the files changed since that plan or anything blocks the clear.
#[tauri::command]
pub(crate) fn clear_play_history(expected_fingerprint: String) -> Result<ClearReport, String> {
    let root = crate::data_root::mutation_root()?;
    // The experiment store gate is the outermost lock and the only one held: no new lock order.
    let _gate = crate::experiment::lock_store()?;
    let facts = live_facts(root.path())?;
    let plan = plan_clear(root.path(), Scope::PlayHistory, &facts);
    if plan.fingerprint != expected_fingerprint {
        return Err("The files changed since the list was shown, so nothing was deleted. Look at the list again.".to_string());
    }
    match execute_clear(root.path(), &plan, &facts) {
        ClearOutcome::Refused(r) => Err(r.iter().map(|x| x.detail.clone()).collect::<Vec<_>>().join(" ")),
        ClearOutcome::PlanChanged => Err("The files changed while clearing started, so nothing was deleted. Try again.".to_string()),
        ClearOutcome::Done(report) => Ok(report),
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
        ClearFacts { trial_active: false, capture_active: false, remove_licence: false, now: SystemTime::now() }
    }

    /// Two hours on, so every working file counts as old enough.
    fn later() -> ClearFacts {
        ClearFacts { now: SystemTime::now() + Duration::from_secs(7200), ..facts() }
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
        "elevation-batch-1700000000000.receipts",
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
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        tampered.delete.push(PlannedDelete { rel: "notes.txt".into(), row_id: "sessions", category: "play_history" });
        let before = t2.listing();
        assert!(matches!(execute_clear(&t2.root, &tampered, &later()), ClearOutcome::PlanChanged));
        let mut other = plan_clear(&t2.root, Scope::PlayHistory, &later());
        other.fingerprint = "not-the-fingerprint".into();
        assert!(matches!(execute_clear(&t2.root, &other, &later()), ClearOutcome::PlanChanged));
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
        match execute_clear(&t.root, &plan, &later()) {
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
            assert!(matches!(execute_clear(&t.root, &plan, &facts()), ClearOutcome::Refused(_)), "{tag}");
            assert_eq!(before, t.listing(), "{tag}");
        }
        for scope in [Scope::PlayHistory, Scope::Everything] {
            let t = Tmp::new("flags");
            seed(&t);
            let busy = ClearFacts { trial_active: true, ..later() };
            assert!(plan_clear(&t.root, scope, &busy).refusals.iter().any(|r| r.code == "trial_running"));
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
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        assert!(p.delete.is_empty() && done(execute_clear(&gone, &p, &facts())).complete);
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
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        let report = done(execute_clear(&t.root, &plan, &later()));
        assert!(!report.complete);
        assert!(report.failed.iter().any(|f| f.rel == "history.json.bak"));
        assert!(report.not_attempted.contains(&"history.json".to_string()), "history.json must not be tried after the backup failed");
        assert!(t.has("history.json") && t.has("history.json.bak"), "main and backup stay together");
        drop(lock);
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        let report = done(execute_clear(&t.root, &plan, &later()));
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
        done(execute_clear(&t.root, &plan, &later()));
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
        assert!(matches!(execute_clear(&link, &plan, &later()), ClearOutcome::Refused(_)));
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
        let report = done(execute_clear(&t.root, &plan, &later()));
        assert!(report.complete);
        let pos = |f: &str| report.deleted.iter().position(|d| d == f).unwrap();
        assert!(pos("history.json.bak") < pos("history.json"));
        // Backup-only leftovers (main already gone) are removed too, so no ledger can be restored.
        let t = Tmp::new("g1b");
        t.put("history.json.bak", "[]");
        let plan = plan_clear(&t.root, Scope::Everything, &later());
        assert!(rels(&plan).contains(&"history.json.bak"));
        assert!(done(execute_clear(&t.root, &plan, &later())).complete);
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
}
