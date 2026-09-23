//! Compy Care — the persisted local incident observer (Tier 1 plan task 9).
//!
//! Black Box answers "what happened?" for a user who already came looking. This module answers the
//! question nobody thought to ask: it remembers, ACROSS LAUNCHES, which incidents this machine has
//! already been told about, so a crash that happened while Compy was closed is still surfaced once
//! — exactly once — the next time Compy is open.
//!
//! **What it is not.** There is no timer, no thread that wakes on a cadence, no Windows service, no
//! scheduled task, no registry autorun and no network. It is a pure consumer of `blackbox.rs`,
//! driven by exactly three events and no fourth:
//!
//!   1. once after application setup,
//!   2. once when the main window returns to the foreground,
//!   3. once after a monitored session finalizes.
//!
//! Each of those is a moment the user is already paying for. A polling cadence would be a new
//! standing cost on every machine Compy runs on, and the standing bar is that Compy is the least
//! resource-hungry app on the PC — so a cadence has to be EARNED by measurement and budgeted, not
//! assumed. `SCAN_MIN_INTERVAL_SECS` throttles even the three legitimate triggers, because
//! alt-tabbing is a thing users do dozens of times an hour and a crash scan spawns PowerShell and
//! queries WMI.
//!
//! **What it stores.** `%APPDATA%\Compy\care\incident-observer.json` — a schema version, the scan
//! watermark, a bounded list of incident identities already observed, and at most one pending Home
//! card. It holds identities and timestamps, never crash contents beyond the one calm card the Home
//! surface renders, and it never touches the Windows evidence itself: dismissing a card clears
//! Compy's pointer, and the Event Log entry, WER report and reliability record are all still there
//! for the user (or a technician) to read afterwards.
//!
//! **Boundary.** Read-only with respect to Windows. `actions.rs` is untouched; nothing here is a
//! mutation, so nothing here has a rollback contract. The only thing written is this module's own
//! state file, atomically.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::blackbox::{BlackBoxReport, Incident, IncidentKind};

/// Bump ONLY on a breaking shape change. A file whose version this build does not recognize is
/// quarantined rather than reinterpreted — see `load_or_quarantine`.
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// Hard cap on remembered identities. 128 is far above any honest crash rate; the cap exists so a
/// machine in a crash loop cannot grow this file without bound.
const MAX_OBSERVATIONS: usize = 128;

/// An observation older than this is forgotten. Re-observing it would announce a month-old crash as
/// news, which is why the retention window and the announce rule are the same list.
const RETENTION_DAYS: i64 = 30;

/// A Home card the user neither opened nor dismissed stops being current after this long. It is not
/// deleted evidence — only Compy's pointer at it expires.
const PENDING_EXPIRY_DAYS: i64 = 7;

/// Two incidents of the same app/family inside this window produce ONE toast. A crash loop is one
/// problem, and a notification per repeat is the behaviour that makes people uninstall.
const TOAST_COOLDOWN_MINS: i64 = 30;

/// Floor between scans, across ALL three triggers.
///
/// A scan spawns `Get-WinEvent`, reads WER report files and queries WMI — seconds of work, not
/// microseconds. The foreground trigger fires every time the user alt-tabs back, so without this
/// floor a user who switches between Compy and a game twenty times an hour pays for twenty crash
/// scans. Five minutes is well inside "you find out about it while you still care" and well outside
/// "Compy is why my PC is busy".
const SCAN_MIN_INTERVAL_SECS: i64 = 300;

// ─── Persisted state ────────────────────────────────────────────────────────────────────────────

/// The observer's whole memory. Serialized as-is to `incident-observer.json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct IncidentObserverState {
    pub(crate) schema_version: u32,
    /// The watermark. `None` means this build has never scanned on this machine — the first scan
    /// SEEDS and announces nothing, so installing Compy the day after a bad week does not open with
    /// a week of crash notifications.
    pub(crate) last_scan_at: Option<String>,
    pub(crate) seen: Vec<ObservedIncident>,
    pub(crate) pending_home_incident_id: Option<String>,
    /// The card payload for `pending_home_incident_id`, stored so Home can render it without paying
    /// for a rescan on mount. Always `None` when there is no pending id, and cleared with it.
    #[serde(default)]
    pub(crate) pending_card: Option<PendingCareIncident>,
}

/// One remembered incident identity. Timestamps and matching traits only — the crash's contents are
/// not stored here.
///
/// `kind_tag`, `app` and `occurred_at` exist because **an incident's id is not stable across scans**
/// and pretending otherwise breaks this module's whole promise. `blackbox::merge_into` folds a
/// corroborating source (a WER report that lands minutes after the Event Log entry) into an existing
/// record, taking the newer instant and filling in fields that were missing — and `when`, the app,
/// the module and the code are all hashed into `incident_id`. So the SAME crash can present as id A
/// on Monday's scan and id B on Tuesday's. Recording the traits at observation time lets
/// `reconcile_identity_shifts` recognize B as A rather than announcing a dismissed crash twice.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct ObservedIncident {
    pub(crate) incident_id: String,
    /// The neutral family tag ("App crash", "Blue screen"), as recorded when first observed.
    #[serde(default)]
    pub(crate) kind_tag: String,
    /// The normalized app name for the app families, `None` for the system families and for a record
    /// that named no app. `None` is a WILDCARD when matching, exactly as in `blackbox::same_incident`.
    #[serde(default)]
    pub(crate) app: Option<String>,
    /// The incident's own recorded instant (RFC3339), NOT when Compy noticed it.
    #[serde(default)]
    pub(crate) occurred_at: String,
    pub(crate) first_seen_at: String,
    pub(crate) notified_at: Option<String>,
    pub(crate) opened_at: Option<String>,
    pub(crate) dismissed_at: Option<String>,
}

impl ObservedIncident {
    fn observing(inc: &Incident, now: DateTime<Utc>) -> Self {
        Self {
            incident_id: inc.incident_id.clone(),
            kind_tag: inc.tag.clone(),
            app: app_token(inc),
            occurred_at: inc.when.clone(),
            first_seen_at: now.to_rfc3339(),
            notified_at: None,
            opened_at: None,
            dismissed_at: None,
        }
    }

    /// The cooldown family, from the traits stored on the row — never from a live lookup.
    fn family(&self) -> String {
        format!("{}|{}", self.kind_tag, self.app.clone().unwrap_or_default())
    }

    /// Re-point this row at an identity the same underlying crash now presents under.
    fn adopt(&mut self, inc: &Incident) {
        self.incident_id = inc.incident_id.clone();
        self.kind_tag = inc.tag.clone();
        self.app = app_token(inc);
        self.occurred_at = inc.when.clone();
    }
}

/// What Home renders. Deliberately small: an identity, when it happened, the neutral family tag, the
/// app Windows named if it named one, and the plain-English headline Black Box already writes.
///
/// No assessment, no cause, no advisory step. A card is an invitation to look at the evidence, and
/// anything more would be Compy making a claim in a surface with no room to show its working.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct PendingCareIncident {
    pub(crate) incident_id: String,
    /// RFC3339, the incident's own recorded instant with its original local offset preserved.
    pub(crate) occurred_at: String,
    /// "Aug 20, 9:42 PM" — already offset-correct, so the webview never re-derives a local time.
    pub(crate) occurred_display: String,
    /// The neutral evidence tag ("App crash", "Blue screen"). Names the recorded signal, claims no
    /// cause.
    pub(crate) kind: String,
    /// The pretty process name when Windows named one, else absent. Never a path.
    pub(crate) app_label: Option<String>,
    /// Black Box's own plain-English headline for this incident.
    pub(crate) summary: String,
}

impl IncidentObserverState {
    fn fresh() -> Self {
        Self { schema_version: SCHEMA_VERSION, ..Default::default() }
    }

    fn find(&self, id: &str) -> Option<&ObservedIncident> {
        self.seen.iter().find(|o| o.incident_id == id)
    }

    fn find_mut(&mut self, id: &str) -> Option<&mut ObservedIncident> {
        self.seen.iter_mut().find(|o| o.incident_id == id)
    }

    fn clear_pending(&mut self) {
        self.pending_home_incident_id = None;
        self.pending_card = None;
    }
}

// ─── Qualification ──────────────────────────────────────────────────────────────────────────────

/// Does this incident deserve to interrupt somebody?
///
/// Every `IncidentKind` is by construction a hard Windows-recorded event — an app crash, an app
/// hang, a GPU timeout, a blue screen, a machine-check, an unexpected shutdown. There is no
/// "probably" family, and that is the point of reading `kind` here rather than anything softer.
///
/// The rule this function EXISTS to state is the negative one: `assessment` is not consulted, and
/// must never be. Black Box v2's triage layer writes "consistent with…" text from a rule engine
/// that deliberately fires on partial evidence; promoting that text into a notification would turn
/// a hedge into an alarm. A notification is only ever backed by a record Windows itself wrote.
fn qualifies(inc: &Incident) -> bool {
    matches!(
        inc.kind,
        IncidentKind::AppCrash
            | IncidentKind::AppHang
            | IncidentKind::GpuTimeout
            | IncidentKind::BlueScreen
            | IncidentKind::HardwareError
            | IncidentKind::UnexpectedShutdown
    )
}

/// The app this incident belongs to, normalized for comparison — `None` for the system families and
/// for an app record that named no app.
///
/// Normalization is `blackbox::norm_app` itself rather than a local copy: it is the function that
/// decided these records were the same crash in the first place, and a second, subtly different
/// notion of "same app" in this module would silently disagree with it on exactly the records that
/// matter ("Game.exe" vs "game.exe" arriving from two sources).
fn app_token(inc: &Incident) -> Option<String> {
    match inc.kind {
        IncidentKind::AppCrash | IncidentKind::AppHang => {
            crate::blackbox::norm_app(&inc.receipt.faulting_app).filter(|a| !a.is_empty())
        }
        _ => None,
    }
}

/// The key the toast cooldown groups by: one problem, however many times it repeats.
///
/// For an app crash/hang that is the app; for the system families it is the family alone, because a
/// machine bluescreening twice in ten minutes is one bad afternoon, not two announcements.
fn family_key(inc: &Incident) -> String {
    format!("{}|{}", inc.tag, app_token(inc).unwrap_or_default())
}

/// Is this live incident the same underlying crash as an already-observed row, now wearing a
/// different id?
///
/// Deliberately the same three-part test `blackbox::same_incident` uses to merge two sources in the
/// first place — same family, inside the cross-source window, and the same app when BOTH sides name
/// one (an unnamed side is a wildcard, because that is precisely the record that gets its app filled
/// in by the merge). Reusing `CROSS_SOURCE_WINDOW_SECS` rather than mirroring it means the window
/// cannot drift apart from the one that causes the shift.
fn is_same_underlying(row: &ObservedIncident, inc: &Incident, when: DateTime<Utc>) -> bool {
    if row.kind_tag != inc.tag {
        return false;
    }
    let Some(row_when) = parse_ts(&row.occurred_at) else {
        // A row written before this build recorded traits. It cannot be matched, only re-observed —
        // the honest cost of the upgrade, and it is one extra card, once.
        return false;
    };
    if (row_when - when).num_seconds().abs() > crate::blackbox::CROSS_SOURCE_WINDOW_SECS {
        return false;
    }
    match (row.app.as_deref(), app_token(inc).as_deref()) {
        (Some(a), Some(b)) => a == b,
        _ => true,
    }
}

/// Re-point remembered rows at identities that SHIFTED since the last scan, before anything decides
/// what is "new".
///
/// Without this, the module breaks its own headline promise. Compy notices a crash, shows the card,
/// the user dismisses it. Minutes later Windows finishes writing the WER report for that same crash;
/// the next scan merges it, which moves `when` to the newer instant and fills in the faulting module
/// — both of which are hashed into `incident_id`. The crash the user just dismissed now presents an
/// identity that has never been seen, so it is announced a second time. Dismissing something and
/// being told about it again is the exact behaviour that makes people turn a feature off.
///
/// A row is only re-pointed when its old id is **absent from the current report** — if both ids are
/// live they are two real, separate incidents (a genuine crash loop's repeats), and merging them
/// would hide one. Honest limit: an old id that aged off the report's newest-25 cap looks absent, so
/// a same-app repeat inside 60 seconds could be adopted rather than announced. That needs 25
/// qualifying incidents to sit between them, and the cost is one missing toast on a machine already
/// visibly in a crash loop — the right way round.
fn reconcile_identity_shifts(state: &mut IncidentObserverState, report: &BlackBoxReport) {
    for inc in report.incidents.iter().filter(|i| qualifies(i)) {
        if state.find(&inc.incident_id).is_some() {
            continue;
        }
        let Some(when) = parse_ts(&inc.when) else { continue };
        let live = |id: &str| report.incidents.iter().any(|i| i.incident_id == id);
        let Some(idx) = state
            .seen
            .iter()
            .position(|o| !live(&o.incident_id) && is_same_underlying(o, inc, when))
        else {
            continue;
        };
        let old = state.seen[idx].incident_id.clone();
        state.seen[idx].adopt(inc);
        if state.pending_home_incident_id.as_deref() == Some(old.as_str()) {
            state.pending_home_incident_id = Some(inc.incident_id.clone());
            state.pending_card = Some(card_for(inc));
        }
    }
}

fn card_for(inc: &Incident) -> PendingCareIncident {
    PendingCareIncident {
        incident_id: inc.incident_id.clone(),
        occurred_at: inc.when.clone(),
        occurred_display: inc.when_display.clone(),
        kind: inc.tag.clone(),
        app_label: inc.receipt.faulting_app.as_deref().and_then(crate::blackbox::pretty_proc_opt),
        summary: inc.headline.clone(),
    }
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

// ─── The pure observation pass ──────────────────────────────────────────────────────────────────

/// What one scan decided. Returned rather than acted on, so the whole rule set is testable without a
/// Tauri app, a notification permission or a clock.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct ObservationOutcome {
    /// Identities newly added to `seen` this pass.
    pub(crate) newly_observed: Vec<String>,
    /// The single toast to fire, if any. At most one per scan — a scan that discovers four new
    /// crashes has found one bad session, not four things to say.
    pub(crate) toast: Option<PendingCareIncident>,
    /// True when this pass was the seeding run and therefore announced nothing.
    pub(crate) seeded: bool,
}

/// Apply one report to the state. **Pure**: no clock, no filesystem, no Tauri.
///
/// Ordering matters and is deliberate:
///   1. reconcile shifted identities, so "already known" is decided before anything else reads an id,
///   2. expire the pending pointer before anything can read it,
///   3. seed on a virgin watermark and return silently,
///   4. otherwise collect what is genuinely new,
///   5. promote the newest of those to the Home card,
///   6. toast at most one, subject to the family cooldown,
///   7. prune last, so pruning can never drop something this pass just decided to show.
pub(crate) fn observe(
    report: &BlackBoxReport,
    now: DateTime<Utc>,
    state: &mut IncidentObserverState,
) -> ObservationOutcome {
    let mut outcome = ObservationOutcome::default();
    state.schema_version = SCHEMA_VERSION;

    reconcile_identity_shifts(state, report);
    expire_pending(state, now);

    let qualifying: Vec<&Incident> = report.incidents.iter().filter(|i| qualifies(i)).collect();

    // ── The seeding run. A first-ever scan records the current world as already-known and says
    // nothing. Without this, installing Compy is an act that generates notifications about crashes
    // that happened before Compy existed on this machine — the single most obvious way to make a
    // helpful feature feel like adware.
    if state.last_scan_at.is_none() {
        for inc in &qualifying {
            if state.find(&inc.incident_id).is_none() {
                state.seen.push(ObservedIncident::observing(inc, now));
            }
        }
        state.last_scan_at = Some(now.to_rfc3339());
        outcome.seeded = true;
        prune(state, now);
        return outcome;
    }

    // ── Everything past the watermark.
    let fresh: Vec<&Incident> =
        qualifying.iter().copied().filter(|i| state.find(&i.incident_id).is_none()).collect();

    for inc in &fresh {
        state.seen.push(ObservedIncident::observing(inc, now));
        outcome.newly_observed.push(inc.incident_id.clone());
    }

    // The report is already newest-first, so the first fresh entry is the newest one.
    if let Some(newest) = fresh.first().copied() {
        state.pending_home_incident_id = Some(newest.incident_id.clone());
        state.pending_card = Some(card_for(newest));

        // The cooldown reads the family RECORDED ON THE ROW, never a live lookup keyed on the old
        // id. An earlier draft re-resolved each announced id in the current report to recover its
        // family, which quietly failed in the two cases that matter most: an id that had shifted
        // (see `reconcile_identity_shifts`) no longer resolved at all, and neither did one that had
        // aged off the report's newest-25 cap. Both failures pointed the same way — toward toasting
        // again about a machine that is already visibly broken.
        let key = family_key(newest);
        let cooling = state.seen.iter().any(|o| {
            if o.family() != key {
                return false;
            }
            let Some(at) = o.notified_at.as_deref().and_then(parse_ts) else { return false };
            now - at < Duration::minutes(TOAST_COOLDOWN_MINS)
        });

        if !cooling {
            if let Some(o) = state.find_mut(&newest.incident_id) {
                o.notified_at = Some(now.to_rfc3339());
            }
            outcome.toast = state.pending_card.clone();
        }
    }

    state.last_scan_at = Some(now.to_rfc3339());
    prune(state, now);
    outcome
}

/// Drop the Home pointer once it is stale. The observation stays in `seen` — expiring the card must
/// never make the incident announceable again.
fn expire_pending(state: &mut IncidentObserverState, now: DateTime<Utc>) {
    let Some(id) = state.pending_home_incident_id.clone() else {
        state.pending_card = None;
        return;
    };
    let stale = match state.find(&id) {
        None => true,
        Some(o) => {
            o.dismissed_at.is_some()
                || o.opened_at.is_some()
                || parse_ts(&o.first_seen_at)
                    .is_none_or(|t| now - t >= Duration::days(PENDING_EXPIRY_DAYS))
        }
    };
    if stale {
        state.clear_pending();
    }
}

/// Enforce both caps. Retention first (age is the honest reason to forget), then the hard count cap
/// newest-first.
///
/// The pending observation is protected from BOTH caps: dropping the row a visible card points at
/// would let that same incident be rediscovered and re-announced, which is precisely the loop this
/// module exists to prevent.
fn prune(state: &mut IncidentObserverState, now: DateTime<Utc>) {
    let pending = state.pending_home_incident_id.clone();
    let keep = |o: &ObservedIncident| -> bool {
        if Some(&o.incident_id) == pending.as_ref() {
            return true;
        }
        parse_ts(&o.first_seen_at).is_some_and(|t| now - t < Duration::days(RETENTION_DAYS))
    };
    state.seen.retain(keep);
    if state.seen.len() > MAX_OBSERVATIONS {
        // Newest-first by first_seen_at; an unparseable timestamp sorts oldest so it is shed first.
        state.seen.sort_by(|a, b| {
            parse_ts(&b.first_seen_at).cmp(&parse_ts(&a.first_seen_at))
        });
        let protected = pending.and_then(|id| {
            state.seen.iter().position(|o| o.incident_id == id).filter(|i| *i >= MAX_OBSERVATIONS)
        });
        if let Some(i) = protected {
            state.seen.swap(MAX_OBSERVATIONS - 1, i);
        }
        state.seen.truncate(MAX_OBSERVATIONS);
    }
}

// ─── Persistence ────────────────────────────────────────────────────────────────────────────────

pub(crate) fn state_dir() -> PathBuf {
    crate::compy_data_dir().join("care")
}

fn state_path() -> PathBuf {
    state_dir().join("incident-observer.json")
}

/// Read the state at `path`, quarantining anything this build cannot honestly interpret.
///
/// Quarantine, not delete: the bytes are renamed aside so a version-skew bug leaves evidence
/// instead of a mystery. Quarantining returns a FRESH state, whose `last_scan_at` is `None`, so the
/// very next pass seeds silently — a corrupt file must never become a burst of notifications about
/// a month of history.
pub(crate) fn load_or_quarantine(path: &Path) -> IncidentObserverState {
    let raw = match std::fs::read_to_string(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return IncidentObserverState::fresh(),
        Err(_) => return IncidentObserverState::fresh(),
        Ok(s) => s,
    };
    match serde_json::from_str::<IncidentObserverState>(&raw) {
        Ok(mut s) if s.schema_version == SCHEMA_VERSION => {
            repair_powershell_blobs(&mut s);
            s
        }
        _ => {
            quarantine(path);
            IncidentObserverState::fresh()
        }
    }
}

/// Split a leading PowerShell `{"value":[...],"Count":n}` blob off `text` (#540): the app name it
/// wrapped, and the rest of the string. Windows writes the app FIRST in both app families'
/// EventData (Application Error 1000, Application Hang 1002), so element 0 is the name the fixed
/// decoder would have read. The key match ignores case because rows stored it through `norm_app`.
fn split_powershell_blob(text: &str) -> Option<(Option<String>, &str)> {
    if !text.starts_with('{') {
        return None;
    }
    let mut stream = serde_json::Deserializer::from_str(text).into_iter::<serde_json::Value>();
    let serde_json::Value::Object(o) = stream.next()?.ok()? else { return None };
    let values = o.iter().find(|(k, _)| k.eq_ignore_ascii_case("value"))?.1.as_array()?;
    let app = values.first().and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
    Some((app.map(str::to_string), &text[stream.byte_offset()..]))
}

/// Rewrite text the pre-#540 decoder persisted, so a card observed before the fix renders the way
/// the fixed pipeline would have written it. Unrecoverable → unknown ("An application"), never JSON.
fn repair_powershell_blobs(state: &mut IncidentObserverState) {
    for row in &mut state.seen {
        if let Some((app, _)) = row.app.as_deref().and_then(split_powershell_blob) {
            row.app = crate::blackbox::norm_app(&app).filter(|a| !a.is_empty());
        }
    }
    if let Some(card) = state.pending_card.as_mut() {
        if let Some((app, _)) = card.app_label.as_deref().and_then(split_powershell_blob) {
            card.app_label = app.as_deref().and_then(crate::blackbox::pretty_proc_opt);
        }
        if let Some((app, rest)) = split_powershell_blob(&card.summary) {
            let name = app.as_deref().and_then(crate::blackbox::pretty_proc_opt);
            card.summary = format!("{}{rest}", name.as_deref().unwrap_or("An application"));
        }
    }
}

fn quarantine(path: &Path) {
    let mut dest = path.to_path_buf();
    dest.set_extension("corrupt.json");
    // If a quarantine already sits there, keep the OLDEST one — the first failure is the
    // informative one, and overwriting it loses the original symptom.
    if dest.exists() {
        let _ = std::fs::remove_file(path);
        return;
    }
    let _ = std::fs::rename(path, &dest);
}

/// Serializes the whole read-modify-write of the state file, process-wide.
///
/// Every path here is read → change → save, and there are three of them (a scan, `opened`, and
/// `dismiss`) that can genuinely overlap: the scan runs on its own thread while the user is clicking
/// the card it just produced. Without this, a dismiss that lands mid-scan is read by the scan before
/// the click and overwritten after it — the card comes back, which is exactly the promise this
/// module makes and the one it must not break. Same pattern as `history.rs`'s ledger lock.
static STATE_LOCK: Mutex<()> = Mutex::new(());

/// Distinguishes concurrent temp files. Wraps harmlessly.
static SAVE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Take the state lock, ignoring poisoning. A previous panic mid-mutation is not a reason to stop
/// noticing crashes — the state is re-read from disk on every entry, so a poisoned lock guards
/// nothing that a fresh read does not already fix.
fn lock_state() -> crate::race_seam::StoreGuard {
    // #398 — see `comparison::lock_comparison`. Two paths take this lock (`with_state` writes,
    // `read_state` reads); the recorder is what makes "one of them never runs inside the other"
    // an observation rather than an assumption. No-op in a release build.
    crate::race_seam::hold_lock(crate::race_seam::StoreLock::IncidentObserver, || {
        STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    })
}

/// Read → apply → save, under the lock. The single writer path.
fn with_state<T>(f: impl FnOnce(&mut IncidentObserverState) -> T) -> T {
    let _guard = lock_state();
    let path = state_path();
    let mut state = load_or_quarantine(&path);
    let out = f(&mut state);
    let _ = save_to(&path, &state);
    out
}

/// Read without writing, under the same lock. The single reader path.
fn read_state() -> IncidentObserverState {
    let _guard = lock_state();
    load_or_quarantine(&state_path())
}

/// A temp path no other save can be holding.
///
/// A fixed `.json.tmp` is ONE shared filename: two writers racing on it can interleave into a single
/// half-written file and then atomically rename THAT into place, which is the one outcome the atomic
/// rename exists to prevent. The process id keeps two Compy processes (the dev build and the
/// installed one — a race this machine has hit before) off each other's temp; the counter keeps
/// threads inside one process off each other's.
fn temp_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}.{}.json.tmp",
        std::process::id(),
        SAVE_SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Temp write + flush + atomic replace. An interrupted save leaves the previous state intact rather
/// than a half-written file, which would quarantine on next load and re-seed the watermark.
pub(crate) fn save_to(path: &Path, state: &IncidentObserverState) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = temp_path(path);
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// ─── Triggers ───────────────────────────────────────────────────────────────────────────────────

/// Why a scan was asked for. Recorded for the throttle's benefit and for anyone reading a log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScanTrigger {
    /// Once, after application setup.
    Launch,
    /// The main window came back to the foreground.
    Foreground,
    /// A monitored session just finalized.
    SessionFinalized,
}

/// Should this trigger actually spend a scan?
///
/// `Launch` always runs — it is once per process, and it is the trigger that catches "it crashed
/// while Compy was closed". The other two are throttled: they can fire many times in an hour and
/// nothing about them implies new evidence exists.
pub(crate) fn should_scan(
    trigger: ScanTrigger,
    last_scan_at: Option<&str>,
    now: DateTime<Utc>,
) -> bool {
    if trigger == ScanTrigger::Launch {
        return true;
    }
    match last_scan_at.and_then(parse_ts) {
        None => true,
        Some(last) => now - last >= Duration::seconds(SCAN_MIN_INTERVAL_SECS),
    }
}

/// Run one scan end to end, off the caller's thread.
///
/// Best-effort by contract: every failure path here is a silent no-op. A crash observer that can
/// itself fail loudly, or block a window from showing, is a worse product than one that occasionally
/// notices a crash a few minutes late.
pub(crate) fn scan_async(trigger: ScanTrigger) {
    std::thread::spawn(move || scan_now(trigger));
}

/// One scan at a time, process-wide. Launch and the window taking focus land within milliseconds of
/// each other, and Launch is exempt from the interval throttle, so without this claim both would
/// spawn PowerShell before either had written a watermark.
static SCANNING: AtomicBool = AtomicBool::new(false);

struct ScanClaim;

impl Drop for ScanClaim {
    fn drop(&mut self) {
        SCANNING.store(false, Ordering::Release);
    }
}

fn claim_scan() -> Option<ScanClaim> {
    SCANNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .ok()
        .map(|_| ScanClaim)
}

fn scan_now(trigger: ScanTrigger) {
    let Some(_claim) = claim_scan() else { return };

    if !should_scan(trigger, read_state().last_scan_at.as_deref(), Utc::now()) {
        return;
    }

    // Gathering evidence happens with NO lock held. It spawns PowerShell and queries WMI — seconds —
    // and the user may well be clicking dismiss on the card throughout. The lock is taken only for
    // the read-modify-write below, which is microseconds.
    let report = crate::blackbox::get_crash_blackbox();
    let now = Utc::now();
    let toast = with_state(|state| observe(&report, now, state).toast);

    if let Some(card) = toast {
        notify(&card);
    }
}

/// The toast.
///
/// It promises NOTHING about what clicking it does. The registered notification path offers
/// `show()` and no supported action/click callback that could carry an incident payload, so the copy
/// says "Open Compy to review the evidence" — which is true of a click that merely foregrounds the
/// app, and true of the user opening Compy themselves an hour later. The persisted pending card is
/// the authority; the toast is only a nudge toward it, and turning notifications off suppresses the
/// nudge without ever suppressing the card.
fn notify(card: &PendingCareIncident) {
    crate::notify_care_incident(&card.summary);
}

// ─── Commands ───────────────────────────────────────────────────────────────────────────────────

/// The Home card, or nothing. Cheap by construction — it reads the state file and never scans, so
/// mounting Home costs one small JSON read.
#[tauri::command]
pub(crate) fn get_pending_care_incident() -> Option<PendingCareIncident> {
    let mut state = read_state();
    expire_pending(&mut state, Utc::now());
    state.pending_card
}

/// The user followed the card into Crash & Freeze Rescue. Records that, and retires the card.
///
/// The observation is KEPT — retiring the card must not make this incident announceable again.
#[tauri::command]
pub(crate) fn mark_care_incident_opened(incident_id: String) {
    mutate(|state, now| {
        if let Some(o) = state.find_mut(&incident_id) {
            o.opened_at = Some(now.to_rfc3339());
        }
        if state.pending_home_incident_id.as_deref() == Some(incident_id.as_str()) {
            state.clear_pending();
        }
    });
}

/// The user dismissed the card.
///
/// This clears Compy's pointer and nothing else. The Event Log entry, the WER report and the
/// reliability record are all untouched and still readable from Crash & Freeze Rescue — dismissing
/// a card is the user saying "I know", never "delete the evidence".
#[tauri::command]
pub(crate) fn dismiss_care_incident(incident_id: String) {
    mutate(|state, now| {
        if let Some(o) = state.find_mut(&incident_id) {
            o.dismissed_at = Some(now.to_rfc3339());
        }
        if state.pending_home_incident_id.as_deref() == Some(incident_id.as_str()) {
            state.clear_pending();
        }
    });
}

/// Read → apply → save. Best-effort: a save failure leaves the previous state, which at worst shows
/// the card once more.
fn mutate(f: impl FnOnce(&mut IncidentObserverState, DateTime<Utc>)) {
    with_state(|state| f(state, Utc::now()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blackbox::Receipt;

    fn at(s: &str) -> DateTime<Utc> {
        parse_ts(s).expect("test timestamp")
    }

    /// A remembered row carrying NO matching traits — deliberately the shape a row written by the
    /// pre-traits build has after `#[serde(default)]` fills it in. The cap and pending-lifecycle
    /// tests below care about ids and ages, not identity matching, and this keeps them honest about
    /// what an upgraded state file actually looks like.
    fn row(id: &str, first_seen: &str) -> ObservedIncident {
        ObservedIncident {
            incident_id: id.into(),
            kind_tag: String::new(),
            app: None,
            occurred_at: String::new(),
            first_seen_at: first_seen.into(),
            notified_at: None,
            opened_at: None,
            dismissed_at: None,
        }
    }

    fn inc(id: &str, kind: IncidentKind, when: &str, app: Option<&str>) -> Incident {
        Incident {
            incident_id: id.into(),
            headline: format!("headline for {id}"),
            tag: kind.tag().into(),
            when: when.into(),
            when_display: "Aug 20, 9:42 PM".into(),
            vitals: None,
            receipt: Receipt {
                source: "System log".into(),
                event_ids: vec![1000],
                faulting_app: app.map(Into::into),
                faulting_module: None,
                code: None,
                detail: "d".into(),
            },
            assessment: None,
            case_intelligence: None,
            kind,
        }
    }

    fn report(incidents: Vec<Incident>) -> BlackBoxReport {
        BlackBoxReport { incidents, skipped_sources: Vec::new() }
    }

    // ── Seeding ─────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn the_first_ever_run_seeds_the_watermark_and_announces_nothing() {
        let mut s = IncidentObserverState::fresh();
        let r = report(vec![
            inc("a", IncidentKind::AppCrash, "2026-08-20T21:42:00Z", Some("game.exe")),
            inc("b", IncidentKind::BlueScreen, "2026-08-19T10:00:00Z", None),
        ]);
        let out = observe(&r, at("2026-08-21T09:00:00Z"), &mut s);

        assert!(out.seeded, "a virgin watermark must seed");
        assert!(out.toast.is_none(), "installing Compy must not announce pre-Compy history");
        assert!(out.newly_observed.is_empty());
        assert_eq!(s.seen.len(), 2, "both are remembered so neither is ever announced later");
        assert!(s.pending_home_incident_id.is_none());
        assert!(s.last_scan_at.is_some(), "the watermark is now set");
    }

    #[test]
    fn a_seeded_incident_is_never_announced_on_a_later_scan() {
        let mut s = IncidentObserverState::fresh();
        let r = report(vec![inc("a", IncidentKind::AppCrash, "2026-08-20T21:42:00Z", Some("g.exe"))]);
        observe(&r, at("2026-08-21T09:00:00Z"), &mut s);
        let out = observe(&r, at("2026-08-21T10:00:00Z"), &mut s);
        assert!(out.toast.is_none());
        assert!(out.newly_observed.is_empty());
    }

    // ── The watermark across a closed app ───────────────────────────────────────────────────────

    #[test]
    fn an_incident_that_happened_while_compy_was_closed_is_found_on_next_launch() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);
        // Compy is closed. The crash happens. Compy launches again and re-reads its persisted state.
        let persisted = serde_json::to_string(&s).unwrap();
        let mut reloaded: IncidentObserverState = serde_json::from_str(&persisted).unwrap();

        let r = report(vec![inc("crash", IncidentKind::AppCrash, "2026-08-20T22:10:00Z", Some("g.exe"))]);
        let out = observe(&r, at("2026-08-21T08:00:00Z"), &mut reloaded);

        assert_eq!(out.newly_observed, vec!["crash"]);
        assert_eq!(out.toast.as_ref().map(|c| c.incident_id.as_str()), Some("crash"));
        assert_eq!(reloaded.pending_home_incident_id.as_deref(), Some("crash"));
    }

    // ── Announce-once ───────────────────────────────────────────────────────────────────────────

    #[test]
    fn an_exact_incident_id_notifies_at_most_once() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);
        let r = report(vec![inc("x", IncidentKind::GpuTimeout, "2026-08-20T19:00:00Z", None)]);

        assert!(observe(&r, at("2026-08-20T19:05:00Z"), &mut s).toast.is_some());
        assert!(observe(&r, at("2026-08-20T20:05:00Z"), &mut s).toast.is_none());
        assert!(observe(&r, at("2026-08-25T20:05:00Z"), &mut s).toast.is_none());
    }

    // ── Cooldown ────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn the_same_app_inside_the_cooldown_updates_the_card_without_a_second_toast() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);

        let first = inc("c1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("game.exe"));
        assert!(observe(&report(vec![first.clone()]), at("2026-08-20T19:01:00Z"), &mut s).toast.is_some());

        let second = inc("c2", IncidentKind::AppCrash, "2026-08-20T19:20:00Z", Some("game.exe"));
        let out = observe(&report(vec![second, first]), at("2026-08-20T19:21:00Z"), &mut s);

        assert!(out.toast.is_none(), "20 minutes is inside the 30-minute cooldown");
        assert_eq!(
            s.pending_home_incident_id.as_deref(),
            Some("c2"),
            "the NEWEST exact incident still becomes pending — the cooldown silences the toast only"
        );
    }

    #[test]
    fn a_different_app_is_not_covered_by_another_apps_cooldown() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);
        let a = inc("a1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("gameA.exe"));
        observe(&report(vec![a.clone()]), at("2026-08-20T19:01:00Z"), &mut s);

        let b = inc("b1", IncidentKind::AppCrash, "2026-08-20T19:10:00Z", Some("gameB.exe"));
        let out = observe(&report(vec![b, a]), at("2026-08-20T19:11:00Z"), &mut s);
        assert_eq!(out.toast.as_ref().map(|c| c.incident_id.as_str()), Some("b1"));
    }

    #[test]
    fn the_cooldown_lifts_after_thirty_minutes() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);
        let a = inc("a1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("g.exe"));
        observe(&report(vec![a.clone()]), at("2026-08-20T19:00:30Z"), &mut s);

        let b = inc("a2", IncidentKind::AppCrash, "2026-08-20T19:35:00Z", Some("g.exe"));
        let out = observe(&report(vec![b, a]), at("2026-08-20T19:35:30Z"), &mut s);
        assert!(out.toast.is_some(), "35 minutes is past the 30-minute cooldown");
    }

    #[test]
    fn one_scan_that_finds_four_new_crashes_fires_one_toast() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);
        let r = report(vec![
            inc("n1", IncidentKind::AppCrash, "2026-08-20T19:40:00Z", Some("g.exe")),
            inc("n2", IncidentKind::AppCrash, "2026-08-20T19:30:00Z", Some("g.exe")),
            inc("n3", IncidentKind::BlueScreen, "2026-08-20T19:20:00Z", None),
            inc("n4", IncidentKind::GpuTimeout, "2026-08-20T19:10:00Z", None),
        ]);
        let out = observe(&r, at("2026-08-20T19:45:00Z"), &mut s);
        assert_eq!(out.newly_observed.len(), 4, "all four are remembered");
        assert_eq!(out.toast.as_ref().map(|c| c.incident_id.as_str()), Some("n1"), "exactly one toast, the newest");
    }

    // ── Qualification ───────────────────────────────────────────────────────────────────────────

    #[test]
    fn assessment_text_alone_never_qualifies_an_incident() {
        // Every kind qualifies; the guarantee is that `assessment` is not consulted at all. Two
        // incidents identical but for their assessment must qualify identically.
        let mut with = inc("q", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("g.exe"));
        let without = with.clone();
        with.assessment = None; // the field the rule must ignore; `assess` output is not reachable here
        assert_eq!(qualifies(&with), qualifies(&without));
        assert!(qualifies(&without));
    }

    // ── Caps ────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn observations_older_than_the_retention_window_are_forgotten() {
        let mut s = IncidentObserverState::fresh();
        s.last_scan_at = Some("2026-06-01T00:00:00Z".into());
        s.seen.push(row("ancient", "2026-06-01T00:00:00Z"));
        observe(&report(vec![]), at("2026-08-20T00:00:00Z"), &mut s);
        assert!(s.seen.is_empty(), "80 days is past the 30-day retention window");
    }

    #[test]
    fn the_observation_list_is_capped_and_keeps_the_newest() {
        let mut s = IncidentObserverState::fresh();
        s.last_scan_at = Some("2026-08-01T00:00:00Z".into());
        for i in 0..200 {
            // i=0 oldest … i=199 newest, all inside the retention window.
            s.seen.push(row(
                &format!("i{i}"),
                &format!("2026-08-{:02}T{:02}:00:00Z", 10 + i / 24, i % 24),
            ));
        }
        observe(&report(vec![]), at("2026-08-20T00:00:00Z"), &mut s);
        assert_eq!(s.seen.len(), MAX_OBSERVATIONS);
        assert!(s.seen.iter().any(|o| o.incident_id == "i199"), "the newest survives");
        assert!(!s.seen.iter().any(|o| o.incident_id == "i0"), "the oldest is shed");
    }

    #[test]
    fn the_pending_observation_survives_the_count_cap() {
        let mut s = IncidentObserverState::fresh();
        s.last_scan_at = Some("2026-08-01T00:00:00Z".into());
        s.pending_home_incident_id = Some("old-but-pending".into());
        // Inside the 7-day card expiry (so it is still pending) but OLDER than every filler below
        // (so the count cap is what would shed it).
        s.seen.push(row("old-but-pending", "2026-08-16T00:00:00Z"));
        for i in 0..200 {
            s.seen.push(row(
                &format!("i{i}"),
                &format!(
                    "2026-08-{:02}T{:02}:{:02}:00Z",
                    16 + i / 96,
                    (i % 96) / 4 + 1,
                    (i % 4) * 15
                ),
            ));
        }
        observe(&report(vec![]), at("2026-08-20T00:00:00Z"), &mut s);
        assert_eq!(s.seen.len(), MAX_OBSERVATIONS);
        assert!(
            s.seen.iter().any(|o| o.incident_id == "old-but-pending"),
            "dropping the row a visible card points at would let it be re-announced"
        );
    }

    // ── Pending lifecycle ───────────────────────────────────────────────────────────────────────

    #[test]
    fn a_pending_card_expires_after_seven_days_without_deleting_the_observation() {
        let mut s = IncidentObserverState::fresh();
        s.last_scan_at = Some("2026-08-01T00:00:00Z".into());
        s.pending_home_incident_id = Some("p".into());
        s.pending_card = Some(card_for(&inc("p", IncidentKind::AppCrash, "2026-08-10T00:00:00Z", None)));
        s.seen.push(row("p", "2026-08-10T00:00:00Z"));
        observe(&report(vec![]), at("2026-08-18T00:00:00Z"), &mut s);
        assert!(s.pending_home_incident_id.is_none(), "8 days is past the 7-day expiry");
        assert!(s.pending_card.is_none());
        assert!(s.find("p").is_some(), "expiring the card must not make the incident announceable again");
    }

    #[test]
    fn a_dismissed_incident_clears_the_card_and_stays_unannounceable() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);
        let r = report(vec![inc("d", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("g.exe"))]);
        observe(&r, at("2026-08-20T19:01:00Z"), &mut s);

        s.find_mut("d").unwrap().dismissed_at = Some("2026-08-20T19:02:00Z".into());
        let out = observe(&r, at("2026-08-20T19:03:00Z"), &mut s);

        assert!(s.pending_home_incident_id.is_none());
        assert!(out.toast.is_none());
    }

    // ── Identity shifts ─────────────────────────────────────────────────────────────────────────
    //
    // Regression cover for the defect the #222 backend review caught: `incident_id` is a hash over
    // the crash's traits INCLUDING its instant, and `blackbox::merge_into` moves that instant (and
    // fills in the faulting module) the moment a corroborating source lands. So one crash can wear
    // two ids across two scans, and the naive reading of "an id I have never seen" is "news".

    /// The same crash as `first`, as it looks after a WER report lands seconds later and merges in:
    /// a newer instant, a faulting module Windows only knew from the second source, and therefore a
    /// different id.
    fn merged(first: &Incident, id: &str, when: &str, module: &str) -> Incident {
        let mut m = first.clone();
        m.incident_id = id.into();
        m.when = when.into();
        m.receipt.faulting_module = Some(module.into());
        m.receipt.source = "System log + WER".into();
        m
    }

    #[test]
    fn a_dismissed_crash_is_not_reannounced_when_its_identity_shifts() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);

        let a1 = inc("a1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("game.exe"));
        let out = observe(&report(vec![a1.clone()]), at("2026-08-20T19:01:00Z"), &mut s);
        assert!(out.toast.is_some(), "the first sighting is the announcement");

        // The user dismisses it — exactly what `dismiss_care_incident` does to the state.
        s.find_mut("a1").unwrap().dismissed_at = Some("2026-08-20T19:02:00Z".into());
        s.clear_pending();

        // Windows finishes the WER report 40 seconds after the Event Log entry; the next scan sees
        // one merged incident wearing a brand-new id.
        let a2 = merged(&a1, "a2", "2026-08-20T19:00:40Z", "nvwgf2umx.dll");
        let out = observe(&report(vec![a2]), at("2026-08-20T19:30:00Z"), &mut s);

        assert!(out.toast.is_none(), "a dismissed crash was announced a second time under a new id");
        assert!(out.newly_observed.is_empty(), "the shifted id is the same crash, not a new one");
        assert!(s.pending_home_incident_id.is_none(), "the dismissed card came back");
        assert_eq!(s.seen.len(), 1, "one crash must leave one remembered row, not two");
        assert_eq!(s.seen[0].incident_id, "a2", "the row follows the crash to its current identity");
        assert!(s.seen[0].dismissed_at.is_some(), "the dismissal survives the identity shift");
    }

    #[test]
    fn a_pending_card_follows_its_crash_through_an_identity_shift() {
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);

        let a1 = inc("a1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("game.exe"));
        observe(&report(vec![a1.clone()]), at("2026-08-20T19:01:00Z"), &mut s);

        let a2 = merged(&a1, "a2", "2026-08-20T19:00:40Z", "nvwgf2umx.dll");
        let out = observe(&report(vec![a2]), at("2026-08-20T19:40:00Z"), &mut s);

        assert!(out.toast.is_none(), "the same crash must not toast twice");
        assert_eq!(
            s.pending_home_incident_id.as_deref(),
            Some("a2"),
            "a dangling pointer would silently expire the card the user can still see"
        );
        assert_eq!(s.pending_card.as_ref().unwrap().incident_id, "a2");
        assert_eq!(s.seen.len(), 1);
    }

    /// #540 bug→guard at the exact text Health renders. The webview prints `summary` and
    /// `app_label` verbatim, so the card built from the collector's real Windows PowerShell 5.1
    /// wire shape must read as a sentence and a program name — never `{"Count":10,"value":[...]}`.
    #[test]
    fn the_home_card_from_a_powershell_wrapped_row_carries_no_raw_json() {
        let incidents = crate::blackbox::incidents_from_event_json(crate::blackbox::PS51_WRAPPED_HANG_JSON);
        let card = card_for(incidents.first().expect("the hang row assembles"));
        crate::blackbox::assert_no_raw_json("summary", &card.summary);
        crate::blackbox::assert_no_raw_json("kind", &card.kind);
        assert_eq!(card.app_label.as_deref(), Some("dllhost"));
        assert!(card.summary.starts_with("dllhost stopped responding"), "summary: {}", card.summary);
    }

    /// #540: the owner's `incident-observer.json` (2026-09-23) persisted the pre-fix blob as the
    /// card's summary and app label and as the app of 14 remembered rows. The card lives up to seven
    /// days and its hang may never be re-read, so the fix must repair what is on disk: the loaded card
    /// reads as a sentence, and the corrected scan adopts the row instead of announcing it twice.
    #[test]
    fn a_persisted_powershell_blob_loads_as_plain_english_and_is_not_reannounced() {
        let blob = r#"{"Count":10,"value":["dllhost.exe","10.0.26100.8328","8420","134343869975195777","4294967295","C:\\Windows\\System32\\dllhost.exe","5a159009-d190-4e7f-9925-bd18ddb1599d","","App","Quiesce"]}"#;
        let when = "2026-09-23T10:15:00-07:00";
        let mut s = IncidentObserverState::fresh();
        s.last_scan_at = Some("2026-09-23T17:16:00Z".into());
        let mut hang = row("old", "2026-09-23T17:16:00Z");
        hang.kind_tag = IncidentKind::AppHang.tag().into();
        hang.app = crate::blackbox::norm_app(&Some(blob.to_string()));
        hang.occurred_at = when.into();
        hang.notified_at = Some("2026-09-23T17:16:00Z".into());
        let mut empty = row("empty", "2026-09-23T17:16:00Z");
        empty.app = Some(r#"{"count":0,"value":[]}"#.into());
        s.seen = vec![hang, empty];
        s.pending_home_incident_id = Some("old".into());
        s.pending_card = Some(PendingCareIncident {
            incident_id: "old".into(),
            occurred_at: when.into(),
            occurred_display: "Sep 23, 10:15 AM".into(),
            kind: "App hang".into(),
            app_label: Some(blob.into()),
            summary: format!("{blob} stopped responding (froze) — Sep 23, 10:15 AM"),
        });
        let dir = tmpdir("ps-blob");
        let p = dir.join("incident-observer.json");
        save_to(&p, &s).unwrap();

        let mut s = load_or_quarantine(&p);
        let _ = std::fs::remove_dir_all(&dir);
        let card = s.pending_card.clone().expect("the card survives the repair");
        assert_eq!(card.summary, "dllhost stopped responding (froze) — Sep 23, 10:15 AM");
        assert_eq!(card.app_label.as_deref(), Some("dllhost"));
        assert_eq!(s.seen[0].app.as_deref(), Some("dllhost"));
        assert_eq!(s.seen[1].app, None, "an unrecoverable blob is unknown, not JSON");

        let fixed = crate::blackbox::incidents_from_event_json(crate::blackbox::PS51_WRAPPED_HANG_JSON);
        let out = observe(&report(fixed.clone()), at("2026-09-23T17:40:00Z"), &mut s);
        assert!(out.toast.is_none(), "the same hang was announced again under its corrected identity");
        assert!(out.newly_observed.is_empty());
        assert_eq!(s.pending_home_incident_id.as_deref(), Some(fixed[0].incident_id.as_str()));
        crate::blackbox::assert_no_raw_json("summary", &s.pending_card.as_ref().unwrap().summary);
    }

    #[test]
    fn an_unrecoverable_blob_summary_names_no_app_rather_than_printing_json() {
        let mut s = IncidentObserverState::fresh();
        s.pending_card = Some(PendingCareIncident {
            incident_id: "x".into(),
            occurred_at: String::new(),
            occurred_display: String::new(),
            kind: "App crash".into(),
            app_label: Some(r#"{"Count":0,"value":[]}"#.into()),
            summary: r#"{"Count":0,"value":[]} stopped working and closed — Sep 1, 9:00 PM"#.into(),
        });
        repair_powershell_blobs(&mut s);
        let card = s.pending_card.unwrap();
        assert_eq!(card.summary, "An application stopped working and closed — Sep 1, 9:00 PM");
        assert_eq!(card.app_label, None);
    }

    #[test]
    fn two_ids_that_are_both_live_stay_two_incidents() {
        // The counterweight to reconciliation: if BOTH ids are in the current report they are two
        // real records, not one record renamed, and folding them would hide a repeat crash.
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);

        let a1 = inc("a1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("game.exe"));
        observe(&report(vec![a1.clone()]), at("2026-08-20T19:01:00Z"), &mut s);

        let mut a2 = a1.clone();
        a2.incident_id = "a2".into();
        a2.when = "2026-08-20T19:00:40Z".into();
        let out = observe(&report(vec![a2, a1]), at("2026-08-20T19:02:00Z"), &mut s);

        assert_eq!(out.newly_observed, vec!["a2".to_string()], "a live repeat is its own incident");
        assert_eq!(s.seen.len(), 2);
        assert!(out.toast.is_none(), "…but the cooldown still makes one crash loop one toast");
    }

    #[test]
    fn the_cooldown_holds_when_the_announced_incident_falls_off_the_report() {
        // The 25-cap gap, closed by storing the family on the row instead of re-resolving the old id
        // in the current report.
        let mut s = IncidentObserverState::fresh();
        observe(&report(vec![]), at("2026-08-20T18:00:00Z"), &mut s);

        let first = inc("a1", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("Game.exe"));
        let out = observe(&report(vec![first]), at("2026-08-20T19:01:00Z"), &mut s);
        assert!(out.toast.is_some());

        // Ten minutes later the same app crashes again — and the earlier record is no longer in the
        // report at all (it aged off the newest-N cap on a machine that is crashing hard).
        let again = inc("b1", IncidentKind::AppCrash, "2026-08-20T19:10:00Z", Some("game.exe"));
        let out = observe(&report(vec![again]), at("2026-08-20T19:11:00Z"), &mut s);

        assert!(out.toast.is_none(), "the same app inside 30 minutes is one problem, one toast");
        assert_eq!(out.newly_observed, vec!["b1".to_string()], "it is still remembered and shown");
    }

    // ── Persistence ─────────────────────────────────────────────────────────────────────────────

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("compy-observer-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_saved_state_round_trips() {
        let dir = tmpdir("roundtrip");
        let p = dir.join("incident-observer.json");
        let mut s = IncidentObserverState::fresh();
        observe(
            &report(vec![inc("a", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("g.exe"))]),
            at("2026-08-20T19:01:00Z"),
            &mut s,
        );
        save_to(&p, &s).unwrap();
        assert_eq!(load_or_quarantine(&p), s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_state_file_from_before_traits_existed_loads_rather_than_quarantining() {
        // The upgrade path. A row without traits cannot be identity-matched (documented in
        // `is_same_underlying`), but losing the whole file would reset the watermark and re-seed —
        // silently forgetting every incident the user had already been shown.
        let dir = tmpdir("pre-traits");
        let p = dir.join("incident-observer.json");
        let legacy = concat!(
            r#"{"schema_version":1,"last_scan_at":"2026-08-20T19:00:00Z","seen":["#,
            r#"{"incident_id":"old","first_seen_at":"2026-08-20T18:00:00Z","notified_at":null,"#,
            r#""opened_at":null,"dismissed_at":null}],"pending_home_incident_id":null}"#
        );
        std::fs::write(&p, legacy).unwrap();

        let s = load_or_quarantine(&p);
        assert_eq!(
            s.last_scan_at.as_deref(),
            Some("2026-08-20T19:00:00Z"),
            "quarantining here would reset the watermark and re-seed, forgetting what was shown"
        );
        assert_eq!(s.seen.len(), 1);
        assert_eq!(s.seen[0].kind_tag, "");
        assert!(s.seen[0].app.is_none());
        assert_eq!(s.seen[0].occurred_at, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_save_claims_its_own_temp_file() {
        // The other half of the review's lost-update finding: a fixed `.json.tmp` is ONE shared
        // filename, so two writers can interleave into it and then atomically rename that
        // half-written file into place — defeating the very thing the atomic rename buys.
        let dir = tmpdir("temps");
        let p = dir.join("incident-observer.json");
        assert_ne!(temp_path(&p), temp_path(&p), "two saves must never share one temp path");
        assert_ne!(
            temp_path(&p),
            p.with_extension("json.tmp"),
            "the fixed shared name is what this guard exists to keep out"
        );
        for _ in 0..4 {
            save_to(&p, &IncidentObserverState::fresh()).unwrap();
        }
        assert!(p.exists(), "and the atomic rename still lands the real file");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "a completed save must leave no temp behind: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_absent_file_loads_as_a_fresh_state_that_will_seed() {
        let dir = tmpdir("absent");
        let s = load_or_quarantine(&dir.join("nothing-here.json"));
        assert_eq!(s.schema_version, SCHEMA_VERSION);
        assert!(s.last_scan_at.is_none(), "no watermark ⇒ the next pass seeds silently");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_state_is_quarantined_and_fails_safe_with_no_spam() {
        let dir = tmpdir("corrupt");
        let p = dir.join("incident-observer.json");
        std::fs::write(&p, "{ this is not json").unwrap();

        let mut s = load_or_quarantine(&p);
        assert!(dir.join("incident-observer.corrupt.json").exists(), "the bytes are kept, not deleted");
        assert!(!p.exists());

        // The very next pass SEEDS — a corrupt file must never become a burst of notifications.
        let out = observe(
            &report(vec![inc("a", IncidentKind::AppCrash, "2026-08-20T19:00:00Z", Some("g.exe"))]),
            at("2026-08-20T19:01:00Z"),
            &mut s,
        );
        assert!(out.seeded);
        assert!(out.toast.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unknown_schema_version_is_quarantined_rather_than_reinterpreted() {
        let dir = tmpdir("schema");
        let p = dir.join("incident-observer.json");
        std::fs::write(&p, r#"{"schema_version":99,"last_scan_at":null,"seen":[],"pending_home_incident_id":null}"#).unwrap();
        let s = load_or_quarantine(&p);
        assert_eq!(s.schema_version, SCHEMA_VERSION);
        assert!(dir.join("incident-observer.corrupt.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_interrupted_write_leaves_the_previous_state_intact() {
        let dir = tmpdir("interrupt");
        let p = dir.join("incident-observer.json");
        let mut good = IncidentObserverState::fresh();
        good.last_scan_at = Some("2026-08-20T19:00:00Z".into());
        save_to(&p, &good).unwrap();

        // A crash mid-write leaves the TEMP file behind; the real file is only ever replaced by an
        // atomic rename of a fully written temp.
        std::fs::write(p.with_extension("json.tmp"), "{ half writ").unwrap();
        assert_eq!(load_or_quarantine(&p), good);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_state_file_lives_in_its_own_care_namespace() {
        assert!(state_dir().ends_with("care"));
        assert!(state_path().ends_with("incident-observer.json"));
    }

    // ── Triggers ────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn launch_always_scans_and_the_other_two_triggers_are_throttled() {
        let now = at("2026-08-20T19:00:00Z");
        let recent = "2026-08-20T18:58:00Z"; // two minutes ago
        assert!(should_scan(ScanTrigger::Launch, Some(recent), now), "once per process");
        assert!(!should_scan(ScanTrigger::Foreground, Some(recent), now));
        assert!(!should_scan(ScanTrigger::SessionFinalized, Some(recent), now));

        let old = "2026-08-20T18:50:00Z"; // ten minutes ago
        assert!(should_scan(ScanTrigger::Foreground, Some(old), now));
        assert!(should_scan(ScanTrigger::SessionFinalized, Some(old), now));
        assert!(should_scan(ScanTrigger::Foreground, None, now), "no watermark ⇒ scan");
    }

    // ── The card's contents ─────────────────────────────────────────────────────────────────────

    #[test]
    fn the_card_carries_a_pretty_app_name_and_never_a_path() {
        let c = card_for(&inc(
            "p",
            IncidentKind::AppCrash,
            "2026-08-20T19:00:00Z",
            Some("FallGuys_client_game.exe"),
        ));
        let app = c.app_label.expect("Windows named an app");
        assert!(!app.contains('\\') && !app.contains('/'), "never a path");
        assert!(!app.to_ascii_lowercase().ends_with(".exe"), "prettied, not raw");
    }

    #[test]
    fn the_card_makes_no_causal_or_advisory_claim() {
        let c = card_for(&inc("p", IncidentKind::BlueScreen, "2026-08-20T19:00:00Z", None));
        let json = serde_json::to_string(&c).unwrap().to_ascii_lowercase();
        for banned in ["caused", "because of", "definitely", "fixed", "%"] {
            assert!(!json.contains(banned), "a card must not claim `{banned}`");
        }
    }
}
