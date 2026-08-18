//! Local support evidence (Q5) — a bounded, redacted, on-disk record the user can read in full
//! and hand to support by their own action.
//!
//! Spec: `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md` §12.
//!
//! Three properties this module makes *structurally* true rather than merely intended:
//!
//! 1. **Nothing leaves the device.** No endpoint, no queue, no background uploader, no automatic
//!    attachment — and no way to add one quietly: `src/support-evidence-outbound-guard.test.ts`
//!    fails the build if a network symbol ever appears in this file.
//! 2. **Sensitive values are never written.** Redaction runs at *construction*, so a raw path or
//!    serial is scrubbed before the record exists in memory, and again at export. The public API
//!    takes structured fields (`operation`, `code`, `outcome`), so a caller cannot hand in a raw
//!    process command line as one opaque blob and have it survive.
//! 3. **This can never block rollback.** [`record`] returns `()` and swallows every error: a full
//!    disk, a read-only data dir, or a damaged record file must not fail the mutation the user
//!    actually asked for. The reader skips lines it cannot parse instead of refusing the file, and
//!    reports how many it skipped.
//!
//! Unlike the Trust Ledger, this file carries no rollback contract — nothing here is needed to undo
//! a change. So a damaged record self-heals (unparsable lines are dropped on the next append) rather
//! than being quarantined, and the count of dropped records is surfaced in the bundle instead of
//! being hidden.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::compy_data_dir;

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/// Newest records kept. Older ones are dropped on append.
pub const MAX_EVENTS: usize = 400;

/// Per-field byte budgets. These are what make the file's maximum size a *fact* rather than a
/// hope: every field is clamped on the way in, so a record cannot grow unboundedly.
pub const MAX_OPERATION_BYTES: usize = 64;
pub const MAX_CODE_BYTES: usize = 64;
pub const MAX_DETAIL_BYTES: usize = 240;

/// Documented ceiling for one serialized record, including JSON scaffolding, the timestamp, and
/// the key names. `record_ceiling_is_real` proves a maximal record fits inside it.
pub const MAX_RECORD_BYTES: usize = 640;

/// The file's hard ceiling: `MAX_EVENTS * MAX_RECORD_BYTES` = 250 KiB.
///
/// **Honest provenance:** these numbers are derived from this build's *emission volume* — the
/// events emitted are lifecycle- and failure-shaped (app start, update steps, ledger recovery,
/// helper start/stop, failed operations), not per-frame or per-tick, so 400 records covers many
/// sessions of history. They are NOT tuned against field support history, because there is no
/// field support history yet. Revisit once real support requests exist; do not describe them as
/// "measured" until they are.
pub const MAX_BYTES: usize = MAX_EVENTS * MAX_RECORD_BYTES;

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const MASK_PATH: &str = "<path>";
const MASK_IP: &str = "<ip>";
const MASK_KEY: &str = "<key>";
const MASK_SERIAL: &str = "<serial>";
const MASK_USER: &str = "<user>";
const MASK_HOST: &str = "<host>";

/// Scrub every class §12 names: usernames, full file paths, license keys, IPs, hardware serials,
/// and anything command-line-shaped that slipped into free text.
///
/// Two kinds of rule, deliberately layered:
/// - **Exact** — the live values of `USERNAME` / `USERDOMAIN` / `COMPUTERNAME` are replaced as
///   literals, so the highest-value leak is removed by identity rather than by pattern.
/// - **Structural** — paths, IPs, key- and serial-shaped runs are matched by shape, which covers
///   values we cannot enumerate (another account's name inside a path, a GPU serial, a token).
///
/// Idempotent: redacting an already-redacted string returns it unchanged, which is what lets the
/// export path re-run redaction as a second gate without mangling the record.
pub fn redact(input: &str) -> String {
    redact_with(input, &sensitive_literals())
}

/// The literal scrub, with its inputs injected so tests never have to mutate process environment.
pub fn redact_with(input: &str, literals: &[(String, &'static str)]) -> String {
    let mut out = redact_paths(input);
    out = redact_ips(&out);
    out = redact_keys(&out);
    out = redact_serials(&out);
    for (value, mask) in literals {
        out = replace_ignore_case(&out, value, mask);
    }
    out
}

/// Values that identify *this* machine and *this* user, read from the environment.
fn sensitive_literals() -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    for (var, mask) in [
        ("USERNAME", MASK_USER),
        ("USERDOMAIN", MASK_HOST),
        ("COMPUTERNAME", MASK_HOST),
    ] {
        if let Ok(value) = std::env::var(var) {
            // A one- or two-character name would match half the alphabet inside ordinary words.
            if value.chars().count() >= 3 {
                out.push((value, mask));
            }
        }
    }
    out
}

fn replace_ignore_case(haystack: &str, needle: &str, mask: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }
    let lower_hay = haystack.to_lowercase();
    let lower_needle = needle.to_lowercase();
    // to_lowercase can change byte length (rare, non-ASCII); when it does, byte offsets from the
    // lowered copy no longer map onto the original, so refuse rather than corrupt the string.
    if lower_hay.len() != haystack.len() || lower_needle.len() != needle.len() {
        return haystack.to_string();
    }
    let mut out = String::with_capacity(haystack.len());
    let mut cursor = 0;
    while let Some(hit) = lower_hay[cursor..].find(&lower_needle) {
        let at = cursor + hit;
        out.push_str(&haystack[cursor..at]);
        out.push_str(mask);
        cursor = at + needle.len();
    }
    out.push_str(&haystack[cursor..]);
    out
}

/// The literal scrub on its own — the identity half of `redact_with`, without the structural
/// path/IP/key/serial passes. Used where a value must stay *readable* but must still never carry
/// the account or machine name.
fn scrub_literals(input: &str) -> String {
    let mut out = input.to_string();
    for (value, mask) in sensitive_literals() {
        out = replace_ignore_case(&out, &value, mask);
    }
    out
}

/// Where the record lives, rendered so a human can act on it.
///
/// `redact()` is the wrong tool for this one field. `redact_paths` collapses an entire path run to
/// the bare `<path>` sentinel, so the panel's meta line read "3 records · <path>" and the support
/// export's header read "- Stored at: <path>" — an internal mask shown as a location, in the very
/// file the user is told to hand to support. Caught by the Q5 visual self-review (2026-08-04),
/// which read the exported `.md` off disk; the vitest fixture had encoded a *shape the backend
/// never produced*, so a green suite proved nothing about it.
///
/// The fix rewrites the *root* to its environment-variable form (`%APPDATA%\Compy\support`) — the
/// same form `docs/PRIVACY.md` shows, readable and free of the account name — and keeps the literal
/// scrub as the safety net for anything below the root. If no known root matches (a redirected data
/// dir, a portable layout) it falls back to the full redaction: unreadable beats leaky.
fn display_location(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();
    // Deepest roots first — USERPROFILE is a prefix of both AppData roots, so it must lose.
    // data-root-allow: display SCRUBBING, the reverse direction. These turn an already-resolved
    // path back into `%APPDATA%\...` for the support header so the account name never leaks;
    // no path is composed from them and nothing is opened.
    let roots: Vec<(&str, String)> = ["LOCALAPPDATA", "APPDATA", "USERPROFILE"]
        .into_iter()
        .filter_map(|var| std::env::var(var).ok().map(|root| (var, root)))
        .collect();
    match env_form(&raw, &roots) {
        Some(form) => scrub_literals(&form),
        None => redact(&raw),
    }
}

/// The pure half of [`display_location`]: rewrite `raw`'s root to its `%VAR%` form, or `None` when
/// no supplied root owns it. Split out so it can be proven against fixed roots — reading the real
/// environment in a test would either race other tests or silently pass on a machine that has no
/// `APPDATA`.
///
/// The `%VAR%` result must never be fed back through [`redact_paths`]: `path_root_len` already
/// recognises `%APPDATA%\` as a path root, so a second pass would eat the readable form we just
/// built and put `<path>` right back.
fn env_form(raw: &str, roots: &[(&str, String)]) -> Option<String> {
    for (var, root) in roots {
        let root = root.trim_end_matches(['\\', '/']);
        if root.len() < 3 {
            continue;
        }
        // `raw.get(..)`, not `raw[..]` — a byte index may not land on a char boundary.
        let Some(head) = raw.get(..root.len()) else { continue };
        if !head.eq_ignore_ascii_case(root) {
            continue;
        }
        let rest = &raw[root.len()..];
        // The match must end on a separator, or `C:\Users\Kuya2` would claim `C:\Users\Kuya`'s root.
        if rest.is_empty() || rest.starts_with('\\') || rest.starts_with('/') {
            return Some(format!("%{var}%{rest}"));
        }
    }
    None
}

fn redact_paths(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        match path_run(&chars, i) {
            Some(end) => {
                out.push_str(MASK_PATH);
                i = end;
            }
            None => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}

/// The index one past the end of a filesystem path starting at `i`, or `None` if none starts there.
fn path_run(chars: &[char], i: usize) -> Option<usize> {
    let root = path_root_len(chars, i)?;
    let mut j = i + root;
    loop {
        while j < chars.len() && !chars[j].is_whitespace() {
            j += 1;
        }
        // `C:\Program Files\Compy` — a single space belongs to the path only when the run after it
        // still carries a separator. That absorbs real spaced paths while stopping at prose
        // ("...\compy.log failed to open" ends at `failed`).
        if j < chars.len() && chars[j] == ' ' {
            let start = j + 1;
            let mut end = start;
            while end < chars.len() && !chars[end].is_whitespace() {
                end += 1;
            }
            if end > start && chars[start..end].iter().any(|c| *c == '\\' || *c == '/') {
                j = end;
                continue;
            }
        }
        break;
    }
    Some(j)
}

/// How many characters the path *root* at `i` occupies: `C:\`, `\\server`, or `%APPDATA%\`.
fn path_root_len(chars: &[char], i: usize) -> Option<usize> {
    // Only start a path at a token boundary, so `foo C:\x` matches but `abcC:\x` does not.
    if i > 0 && chars[i - 1].is_alphanumeric() {
        return None;
    }
    let sep = |c: char| c == '\\' || c == '/';

    if i + 2 < chars.len() && chars[i].is_ascii_alphabetic() && chars[i + 1] == ':' && sep(chars[i + 2]) {
        return Some(3);
    }
    if i + 1 < chars.len() && chars[i] == '\\' && chars[i + 1] == '\\' {
        return Some(2);
    }
    if chars[i] == '%' {
        if let Some(offset) = chars[i + 1..].iter().position(|c| *c == '%') {
            let after = i + 1 + offset + 1;
            if after < chars.len() && sep(chars[after]) {
                return Some(after - i + 1);
            }
        }
    }
    None
}

/// Replace each whitespace-delimited token for which `matches` holds.
fn map_tokens(input: &str, mask: &str, matches: impl Fn(&str) -> bool) -> String {
    let mut out = String::with_capacity(input.len());
    let mut token = String::new();
    let flush = |out: &mut String, token: &mut String| {
        if !token.is_empty() {
            // Trailing punctuation must not stop a match: "at 10.0.0.4," is still an address.
            let trimmed = token.trim_end_matches(['.', ',', ';', ':', ')', ']', '"', '\'']);
            if !trimmed.is_empty() && matches(trimmed) {
                out.push_str(mask);
                out.push_str(&token[trimmed.len()..]);
            } else {
                out.push_str(token);
            }
            token.clear();
        }
    };
    for c in input.chars() {
        if c.is_whitespace() {
            flush(&mut out, &mut token);
            out.push(c);
        } else {
            token.push(c);
        }
    }
    flush(&mut out, &mut token);
    out
}

fn redact_ips(input: &str) -> String {
    map_tokens(input, MASK_IP, |t| is_ipv4(t) || is_ipv6(t))
}

fn is_ipv4(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| {
            !p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

fn is_ipv6(token: &str) -> bool {
    if !token.chars().all(|c| c.is_ascii_hexdigit() || c == ':') || !token.contains(':') {
        return false;
    }
    // `12:30:00` is a clock, not an address. Demand a `::` elision or at least four groups.
    token.contains("::") || token.split(':').filter(|g| !g.is_empty()).count() >= 4
}

fn redact_keys(input: &str) -> String {
    map_tokens(input, MASK_KEY, |t| {
        let groups: Vec<&str> = t.split('-').collect();
        groups.len() >= 3
            && t.len() >= 12
            && groups.iter().all(|g| g.len() >= 4 && !g.is_empty() && g.chars().all(|c| c.is_ascii_alphanumeric()))
    })
}

fn redact_serials(input: &str) -> String {
    map_tokens(input, MASK_SERIAL, |t| {
        t.len() >= 16
            && t.chars().all(|c| c.is_ascii_alphanumeric())
            && t.chars().any(|c| c.is_ascii_digit())
            && t.chars().any(|c| c.is_ascii_alphabetic())
    })
}

/// Clamp to a byte budget on a char boundary, marking the cut so a truncated value never reads as
/// a complete one.
fn clamp(value: &str, max_bytes: usize) -> String {
    const MARK: &str = "\u{2026}";
    debug_assert!(max_bytes > MARK.len(), "a field budget must have room for the truncation mark");
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes - MARK.len();
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{MARK}", &value[..end])
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// App start, update check/download/install, and restart into the new build.
    Lifecycle,
    /// Trust Ledger load, save, corruption and recovery — the rollback-critical path.
    Ledger,
    /// An out-of-process helper started or stopped. Never its command line.
    Helper,
    /// A named operation the user triggered, and how it ended.
    Operation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Ok,
    Failed,
    /// Compy declined on purpose — a refused apply, a declined elevation.
    Refused,
}

impl Outcome {
    fn label(self) -> &'static str {
        match self {
            Outcome::Ok => "ok",
            Outcome::Failed => "failed",
            Outcome::Refused => "refused",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SupportEvent {
    /// RFC 3339, UTC.
    pub at: String,
    pub kind: EventKind,
    /// A stable operation name, e.g. `ledger.load` or `helper.fps_capture`.
    pub operation: String,
    /// A stable, structured error code, e.g. `parse_failed`. Never a formatted message.
    pub code: String,
    pub outcome: Outcome,
    /// Short, already-redacted context. Empty when there is nothing safe to add.
    pub detail: String,
}

impl SupportEvent {
    /// Build a record. **Every text field is redacted and clamped here**, so an unsafe value never
    /// exists as a `SupportEvent` — not on disk, and not in memory either.
    pub fn new(kind: EventKind, operation: &str, code: &str, outcome: Outcome, detail: &str) -> Self {
        Self::at(chrono::Utc::now().to_rfc3339(), kind, operation, code, outcome, detail)
    }

    /// Same, with the timestamp supplied — the deterministic seam the tests build on.
    pub fn at(
        at: String,
        kind: EventKind,
        operation: &str,
        code: &str,
        outcome: Outcome,
        detail: &str,
    ) -> Self {
        Self {
            at,
            kind,
            operation: clamp(&redact(operation), MAX_OPERATION_BYTES),
            code: clamp(&redact(code), MAX_CODE_BYTES),
            outcome,
            detail: clamp(&redact(detail), MAX_DETAIL_BYTES),
        }
    }

    /// The second redaction gate, applied on the export path. Idempotent by construction.
    fn redacted_again(&self) -> Self {
        Self {
            at: self.at.clone(),
            kind: self.kind,
            operation: clamp(&redact(&self.operation), MAX_OPERATION_BYTES),
            code: clamp(&redact(&self.code), MAX_CODE_BYTES),
            outcome: self.outcome,
            detail: clamp(&redact(&self.detail), MAX_DETAIL_BYTES),
        }
    }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

fn support_dir() -> PathBuf {
    compy_data_dir().join("support")
}

fn evidence_path() -> PathBuf {
    support_dir().join("evidence.jsonl")
}

/// Serializes read-modify-write across threads. Poisoning is recovered from rather than propagated:
/// a panic elsewhere must not silently switch the support record off for the rest of the session.
fn store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Emit one record. Fire-and-forget **by signature**: there is no error to ignore at the call site,
/// so no caller can accidentally make a mutation depend on the support log succeeding.
pub fn record(kind: EventKind, operation: &str, code: &str, outcome: Outcome, detail: &str) {
    let event = SupportEvent::new(kind, operation, code, outcome, detail);
    let _guard = store_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let _ = append_to(&evidence_path(), &event);
}

/// Append, then trim to the newest [`MAX_EVENTS`]. Caller holds the lock.
fn append_to(path: &Path, event: &SupportEvent) -> Result<(), String> {
    let (mut events, _skipped) = read_events_from(path);
    events.push(event.clone());
    let first = events.len().saturating_sub(MAX_EVENTS);
    write_events_to(path, &events[first..])
}

/// Read what parses; count what does not. Never errors — an absent, unreadable, or damaged file all
/// read as "no usable records", because refusing here would be a way for the support log to break
/// the thing it exists to explain.
pub fn read_events_from(path: &Path) -> (Vec<SupportEvent>, usize) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return (Vec::new(), 0);
    };
    let mut events = Vec::new();
    let mut unreadable = 0;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<SupportEvent>(line) {
            Ok(event) => events.push(event),
            Err(_) => unreadable += 1,
        }
    }
    (events, unreadable)
}

/// Crash-safe rewrite: build the whole file beside the live one, then atomically swap it in — the
/// same idiom `history.rs` uses, so a crash mid-write can only leave a stale-but-valid file.
fn write_events_to(path: &Path, events: &[SupportEvent]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let mut body = String::new();
    for event in events {
        let line = serde_json::to_string(event).map_err(|e| format!("serialize: {e}"))?;
        body.push_str(&line);
        body.push('\n');
    }
    let tmp = path.with_extension("jsonl.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("write: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("swap: {e}"))
}

// ---------------------------------------------------------------------------
// The bundle and its three projections
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Retention {
    pub max_events: usize,
    pub max_bytes: usize,
    pub max_record_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceBundle {
    pub app_version: String,
    /// `<commit> · release` — the same stamp the About screen shows, so a bundle can be tied to an
    /// exact source tree.
    pub build_stamp: String,
    pub generated_at: String,
    pub retention: Retention,
    /// Where the record lives, redacted — the user needs to find it; support does not need the
    /// account name embedded in it.
    pub location: String,
    pub events: Vec<SupportEvent>,
    /// Records that could not be parsed and were therefore left out. Surfaced, not hidden.
    pub unreadable_records: usize,
    /// Which data root Compy resolved, and whether it trusts it (#130). A bundle that does not say
    /// this cannot be read safely: the same app on the same machine can be writing to two different
    /// change histories, and every event below would look identical either way. Path-free by
    /// design - `location` above is the scrubbed path.
    pub data_root: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Projection {
    /// Plain English. What went wrong and how often — no codes, no timestamps.
    Consumer,
    /// Every record, with codes and timestamps.
    Technical,
    /// Technical, plus the build header and the retention policy.
    Support,
}

impl Projection {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "consumer" => Ok(Projection::Consumer),
            "technical" => Ok(Projection::Technical),
            "support" => Ok(Projection::Support),
            other => Err(format!("unknown projection \"{other}\" — expected consumer, technical, or support")),
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Projection::Consumer => "consumer",
            Projection::Technical => "technical",
            Projection::Support => "support",
        }
    }
}

/// Render one projection. All three read the same `bundle.events` and add nothing of their own, so
/// no projection can disclose something another one hides.
pub fn render(bundle: &EvidenceBundle, projection: Projection) -> String {
    let mut out = String::new();
    match projection {
        Projection::Consumer => {
            out.push_str("# What Compy has noticed on this PC\n\n");
            if bundle.events.is_empty() {
                out.push_str("Nothing to report — Compy has not recorded any problems.\n");
                return out;
            }
            let failed = bundle.events.iter().filter(|e| e.outcome != Outcome::Ok).count();
            out.push_str(&format!(
                "{} recorded events, {} of which did not succeed.\n\n",
                bundle.events.len(),
                failed
            ));
            if failed == 0 {
                out.push_str("Everything Compy recorded finished normally.\n");
            } else {
                out.push_str("Things that did not finish normally:\n\n");
                for event in bundle.events.iter().filter(|e| e.outcome != Outcome::Ok) {
                    out.push_str(&format!("- {} ({})\n", plain_operation(&event.operation), event.outcome.label()));
                }
            }
        }
        Projection::Technical | Projection::Support => {
            if projection == Projection::Support {
                out.push_str("# Compy support evidence\n\n");
                out.push_str(&format!("- App version: {}\n", bundle.app_version));
                out.push_str(&format!("- Build: {}\n", bundle.build_stamp));
                out.push_str(&format!("- Generated: {}\n", bundle.generated_at));
                out.push_str(&format!("- Stored at: {}\n", bundle.location));
                out.push_str(&format!("- Data root: {}\n", bundle.data_root));
                out.push_str(&format!(
                    "- Retention: newest {} records, at most {} bytes\n",
                    bundle.retention.max_events, bundle.retention.max_bytes
                ));
                out.push_str(&format!("- Unreadable records skipped: {}\n\n", bundle.unreadable_records));
            } else {
                out.push_str("# Compy event log\n\n");
            }
            if bundle.events.is_empty() {
                out.push_str("No records.\n");
                return out;
            }
            out.push_str("| when | kind | operation | code | outcome | detail |\n");
            out.push_str("| --- | --- | --- | --- | --- | --- |\n");
            for event in &bundle.events {
                out.push_str(&format!(
                    "| {} | {} | {} | {} | {} | {} |\n",
                    event.at,
                    kind_label(event.kind),
                    event.operation,
                    event.code,
                    event.outcome.label(),
                    if event.detail.is_empty() { "-" } else { &event.detail },
                ));
            }
        }
    }
    out
}

fn kind_label(kind: EventKind) -> &'static str {
    match kind {
        EventKind::Lifecycle => "lifecycle",
        EventKind::Ledger => "ledger",
        EventKind::Helper => "helper",
        EventKind::Operation => "operation",
    }
}

/// `ledger.load` reads as "ledger load" for the consumer projection — no invented prose, just the
/// separators removed.
fn plain_operation(operation: &str) -> String {
    operation.replace(['.', '_'], " ")
}

// ---------------------------------------------------------------------------
// Preview and export
// ---------------------------------------------------------------------------

/// §12: "export only after preview and user action". The preview command sets this; the export
/// command refuses without it. Session-scoped, so a fresh launch must preview again.
fn previewed() -> &'static AtomicBool {
    static PREVIEWED: OnceLock<AtomicBool> = OnceLock::new();
    PREVIEWED.get_or_init(|| AtomicBool::new(false))
}

pub fn build_bundle(path: &Path, generated_at: String, location: String) -> EvidenceBundle {
    let (events, unreadable_records) = read_events_from(path);
    EvidenceBundle {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_stamp: crate::build_stamp(),
        generated_at,
        retention: Retention {
            max_events: MAX_EVENTS,
            max_bytes: MAX_BYTES,
            max_record_bytes: MAX_RECORD_BYTES,
        },
        location,
        events,
        unreadable_records,
        data_root: crate::data_root::support_summary(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidencePreview {
    pub bundle: EvidenceBundle,
    pub consumer: String,
    pub technical: String,
    pub support: String,
}

/// Read the record and render all three projections. **Writes nothing** — this is what the user
/// inspects before deciding whether to export anything at all.
#[tauri::command]
pub fn preview_support_evidence() -> Result<EvidencePreview, String> {
    let bundle = build_bundle(
        &evidence_path(),
        chrono::Utc::now().to_rfc3339(),
        display_location(&support_dir()),
    );
    previewed().store(true, Ordering::Release);
    Ok(EvidencePreview {
        consumer: render(&bundle, Projection::Consumer),
        technical: render(&bundle, Projection::Technical),
        support: render(&bundle, Projection::Support),
        bundle,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportExport {
    pub path: String,
    pub json_path: String,
    pub projection: String,
    pub events: usize,
}

/// Write the chosen projection to disk, next to the report exports. Redaction runs again over every
/// field on the way out — the second of the two gates §12 requires.
#[tauri::command]
pub fn export_support_evidence(projection: String) -> Result<SupportExport, String> {
    if !previewed().load(Ordering::Acquire) {
        return Err("Preview the support evidence before exporting it, so you can see exactly what leaves this app.".into());
    }
    let projection = Projection::parse(&projection)?;
    let mut bundle = build_bundle(
        &evidence_path(),
        chrono::Utc::now().to_rfc3339(),
        display_location(&support_dir()),
    );
    bundle.events = bundle.events.iter().map(SupportEvent::redacted_again).collect();

    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create exports dir: {e}"))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
    let base = format!("compy-support-{}-{stamp}", projection.slug());
    let markdown_path = dir.join(format!("{base}.md"));
    let json_path = dir.join(format!("{base}.json"));

    std::fs::write(&markdown_path, render(&bundle, projection)).map_err(|e| format!("write markdown: {e}"))?;
    std::fs::write(
        &json_path,
        serde_json::to_string_pretty(&bundle).map_err(|e| format!("serialize: {e}"))?,
    )
    .map_err(|e| format!("write json: {e}"))?;

    Ok(SupportExport {
        path: markdown_path.to_string_lossy().to_string(),
        json_path: json_path.to_string_lossy().to_string(),
        projection: projection.slug().to_string(),
        events: bundle.events.len(),
    })
}

/// Delete the record. The consequence — that past problems can no longer be explained — belongs in
/// the copy next to the button, and in `docs/PRIVACY.md`.
#[tauri::command]
pub fn clear_support_evidence() -> Result<(), String> {
    let _guard = store_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match std::fs::remove_file(evidence_path()) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete the support record: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("compy-support-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn event(detail: &str) -> SupportEvent {
        SupportEvent::at(
            "2026-08-04T00:00:00+00:00".into(),
            EventKind::Operation,
            "test.op",
            "code",
            Outcome::Failed,
            detail,
        )
    }

    // -- redaction: every class §12 names, proven before the value can reach disk ----------------

    #[test]
    fn windows_paths_never_survive_construction() {
        for raw in [
            r"C:\Users\Kuya\AppData\Roaming\Compy\history.json",
            r"c:/Users/Kuya/Desktop/compy.log",
            r"\\fileserver\share\compy\out.json",
            r"%APPDATA%\Compy\runtime\fps.json",
        ] {
            let stored = event(raw).detail;
            assert_eq!(stored, MASK_PATH, "{raw} must not survive as a path");
        }
    }

    #[test]
    fn a_spaced_path_is_taken_whole_but_the_prose_after_it_is_not() {
        assert_eq!(
            redact_paths(r"opening C:\Program Files\Compy\compy.exe failed to start"),
            "opening <path> failed to start",
        );
    }

    #[test]
    fn addresses_are_masked_and_a_clock_is_not() {
        assert_eq!(redact_ips("host 192.168.1.50 refused"), "host <ip> refused");
        assert_eq!(redact_ips("at fe80::1c2d:3e4f:5a6b unreachable"), "at <ip> unreachable");
        assert_eq!(redact_ips("elapsed 12:30:00 total"), "elapsed 12:30:00 total");
        assert_eq!(redact_ips("saw 10.0.0.4, then more"), "saw <ip>, then more");
    }

    // -- the location field: readable AND leak-free, the one value redact() must not touch --------
    //
    // Guard for the Q5 self-review FAIL (2026-08-04): the panel's meta line rendered "3 records ·
    // <path>" and the exported support .md said "- Stored at: <path>" — an internal mask presented
    // to the user as a location. bug→guard: these three tests, not a memory of the review.

    fn fixed_roots() -> Vec<(&'static str, String)> {
        vec![
            // data-root-allow: fixed test fixture for the scrubber, not a live environment read.
            ("LOCALAPPDATA", r"C:\Users\Kuya\AppData\Local".to_string()), // data-root-allow
            ("APPDATA", r"C:\Users\Kuya\AppData\Roaming".to_string()), // data-root-allow
            ("USERPROFILE", r"C:\Users\Kuya".to_string()), // data-root-allow
        ]
    }

    #[test]
    fn a_known_root_becomes_its_env_var_form_instead_of_collapsing_to_the_mask() {
        let r = fixed_roots();
        assert_eq!(
            env_form(r"C:\Users\Kuya\AppData\Roaming\Compy\support", &r).as_deref(),
            Some(r"%APPDATA%\Compy\support"),
        );
        // Windows paths are case-insensitive; the rewrite must be too.
        assert_eq!(
            env_form(r"c:\users\kuya\AppData\Local\Compy", &r).as_deref(),
            Some(r"%LOCALAPPDATA%\Compy"),
        );
        // USERPROFILE is a prefix of both AppData roots and must lose to them, but still win alone.
        assert_eq!(env_form(r"C:\Users\Kuya\Desktop", &r).as_deref(), Some(r"%USERPROFILE%\Desktop"));
        // A root match that does not end on a separator is a different directory, not a match.
        assert_eq!(env_form(r"C:\Users\Kuya2\stuff", &r), None);
        // An unknown root yields None, so display_location falls back to the full redaction.
        assert_eq!(env_form(r"D:\portable\Compy\support", &r), None);
    }

    #[test]
    fn the_real_location_is_findable_and_never_carries_the_account_name() {
        // Uses the real environment deliberately — this is the value the owner's machine renders.
        // Builds the path by hand rather than calling support_dir(), which would run the legacy
        // data-dir migration as a side effect.
        // data-root-allow: this test asserts the SCRUBBER renders the owner's real location
        // readably; calling the resolver here would run the legacy migration as a side effect.
        let Ok(app_data) = std::env::var("APPDATA") else { return };
        let shown = display_location(&PathBuf::from(&app_data).join("Compy").join("support"));

        assert_ne!(shown, MASK_PATH, "the location must not render as the bare path mask");
        assert!(shown.contains("Compy") && shown.contains("support"), "unusable location: {shown}");
        if let Ok(user) = std::env::var("USERNAME") {
            if user.len() >= 3 {
                assert!(
                    !shown.to_lowercase().contains(&user.to_lowercase()),
                    "the account name leaked into the location: {shown}",
                );
            }
        }
    }

    #[test]
    fn both_commands_still_route_the_location_through_the_readable_renderer() {
        // The tests above prove display_location behaves; this proves the two #[tauri::command]s
        // still USE it. Wiring the support dir back through the general redactor is exactly how the
        // defect shipped, and no behavioural test can see it — both calls type-check and both
        // return a String. The needles are assembled at runtime so the assertions' own text cannot
        // satisfy them; prose must avoid the banned form too, since this scans the whole file.
        let src = include_str!("support_evidence.rs");
        let wired = format!("{}(&support_dir())", "display_location");
        assert_eq!(src.matches(wired.as_str()).count(), 2, "both call sites must use it");
        let banned = format!("{}(&support_dir()", "redact");
        assert!(!src.contains(banned.as_str()), "the location must not go through redact()");
    }

    #[test]
    fn license_keys_and_serials_are_masked() {
        assert_eq!(redact_keys("key COMPY-A1B2-C3D4-E5F6 rejected"), "key <key> rejected");
        assert_eq!(redact_serials("disk S3X0NX0M12345678 failed"), "disk <serial> failed");
        // Ordinary words and short ids are left alone, or the record becomes useless.
        assert_eq!(redact_serials("rollback contract missing"), "rollback contract missing");
        assert_eq!(redact_keys("a-b-c"), "a-b-c");
    }

    #[test]
    fn the_account_name_is_removed_by_identity_not_only_by_shape() {
        let literals = vec![("Kuya".to_string(), MASK_USER), ("GAMING-RIG".to_string(), MASK_HOST)];
        assert_eq!(
            redact_with("kuya on GAMING-RIG could not write", &literals),
            "<user> on <host> could not write",
        );
    }

    #[test]
    fn a_command_line_cannot_be_stored_as_one_blob() {
        // The API takes structured fields, but if a caller stuffs a command line into `detail`
        // anyway, the paths inside it are still gone.
        let stored = event(r"C:\Windows\System32\cmd.exe /c del C:\Users\Kuya\secret.txt").detail;
        assert!(!stored.contains("Kuya"), "{stored}");
        assert!(!stored.contains(r"\Windows\"), "{stored}");
    }

    #[test]
    fn redaction_is_idempotent_so_the_export_gate_cannot_mangle_a_record() {
        let literals = vec![("Kuya".to_string(), MASK_USER)];
        let once = redact_with(r"Kuya at C:\Users\Kuya\x.json on 10.0.0.4", &literals);
        assert_eq!(redact_with(&once, &literals), once);
    }

    #[test]
    fn every_text_field_is_redacted_not_just_the_detail() {
        let e = SupportEvent::at(
            "2026-08-04T00:00:00+00:00".into(),
            EventKind::Ledger,
            r"op C:\Users\Kuya\a",
            r"code C:\Users\Kuya\b",
            Outcome::Failed,
            r"detail C:\Users\Kuya\c",
        );
        for field in [&e.operation, &e.code, &e.detail] {
            assert!(!field.contains("Kuya"), "{field}");
        }
    }

    // -- retention: the size ceiling is proven, not asserted -------------------------------------

    #[test]
    fn record_ceiling_is_real() {
        let e = SupportEvent::at(
            "2026-08-04T12:34:56.789012345+00:00".into(),
            EventKind::Operation,
            &"o".repeat(MAX_OPERATION_BYTES * 2),
            &"c".repeat(MAX_CODE_BYTES * 2),
            Outcome::Refused,
            &"d".repeat(MAX_DETAIL_BYTES * 2),
        );
        let line = serde_json::to_string(&e).unwrap();
        // The writer terminates every record with a newline, so what lands on disk is that byte
        // wider than the JSON. The ceiling is a promise about the stored record, not the encoding.
        let stored = line.len() + "\n".len();
        assert!(
            stored <= MAX_RECORD_BYTES,
            "a maximal record stores as {stored} bytes, over the documented {MAX_RECORD_BYTES}"
        );
    }

    #[test]
    fn the_file_keeps_only_the_newest_records_and_stays_under_the_ceiling() {
        let path = temp_dir("retention").join("evidence.jsonl");
        for i in 0..(MAX_EVENTS + 25) {
            append_to(&path, &event(&format!("event {i}"))).unwrap();
        }
        let (events, unreadable) = read_events_from(&path);
        assert_eq!(events.len(), MAX_EVENTS);
        assert_eq!(unreadable, 0);
        assert_eq!(events.first().unwrap().detail, "event 25", "the oldest records are dropped");
        assert_eq!(events.last().unwrap().detail, format!("event {}", MAX_EVENTS + 24));
        assert!(std::fs::metadata(&path).unwrap().len() as usize <= MAX_BYTES);
    }

    // -- failing safe: the support log may never become the problem ------------------------------

    #[test]
    fn a_damaged_file_reads_as_what_survives_and_reports_the_rest() {
        let path = temp_dir("damaged").join("evidence.jsonl");
        let good = serde_json::to_string(&event("intact")).unwrap();
        std::fs::write(&path, format!("{good}\nnot json at all\n{{\"at\":\"x\"}}\n\n")).unwrap();
        let (events, unreadable) = read_events_from(&path);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].detail, "intact");
        assert_eq!(unreadable, 2, "blank lines are not records; the two damaged ones are counted");
    }

    #[test]
    fn an_absent_or_unreadable_file_is_not_an_error() {
        let (events, unreadable) = read_events_from(&temp_dir("absent").join("nothing.jsonl"));
        assert!(events.is_empty());
        assert_eq!(unreadable, 0);
    }

    #[test]
    fn appending_into_an_unwritable_location_fails_without_panicking() {
        // A file where a directory must be: create_dir_all fails, and the caller must survive it,
        // because the caller is on the rollback path.
        let dir = temp_dir("unwritable");
        let blocker = dir.join("blocked");
        std::fs::write(&blocker, "not a directory").unwrap();
        assert!(append_to(&blocker.join("evidence.jsonl"), &event("x")).is_err());
    }

    // -- projections ----------------------------------------------------------------------------

    fn bundle_of(events: Vec<SupportEvent>) -> EvidenceBundle {
        EvidenceBundle {
            app_version: "0.0.0".into(),
            build_stamp: "abc1234 · release".into(),
            generated_at: "2026-08-04T00:00:00+00:00".into(),
            retention: Retention {
                max_events: MAX_EVENTS,
                max_bytes: MAX_BYTES,
                max_record_bytes: MAX_RECORD_BYTES,
            },
            // The shape the backend actually emits (see `display_location`) — NOT `MASK_PATH`. A
            // fixture that encodes a shape the real code never produces is how the `<path>` defect
            // survived a green suite in the first place.
            location: r"%APPDATA%\Compy\support".into(),
            events,
            unreadable_records: 0,
            data_root: "normal (verified)".into(),
        }
    }

    #[test]
    fn all_three_projections_describe_the_same_evidence() {
        let b = bundle_of(vec![
            SupportEvent::at("t1".into(), EventKind::Ledger, "ledger.load", "parse_failed", Outcome::Failed, ""),
            SupportEvent::at("t2".into(), EventKind::Helper, "helper.fps_capture", "started", Outcome::Ok, ""),
        ]);
        let consumer = render(&b, Projection::Consumer);
        let technical = render(&b, Projection::Technical);
        let support = render(&b, Projection::Support);

        // The one failure appears in all three; the successful record is never presented as failed.
        for text in [&consumer, &technical, &support] {
            assert!(text.contains("ledger"), "{text}");
        }
        assert!(consumer.contains("2 recorded events, 1 of which did not succeed"), "{consumer}");
        assert_eq!(technical.matches("| t").count(), 2);
        assert_eq!(support.matches("| t").count(), 2);
        // Only the support projection carries the build header and the retention policy.
        assert!(support.contains("abc1234 · release") && support.contains("Retention"));
        assert!(!technical.contains("abc1234") && !consumer.contains("abc1234"));
    }

    #[test]
    fn the_support_header_names_a_location_the_user_can_open() {
        // The export is the file the user hands to support — "Stored at: <path>" told them nothing.
        let out = render(&bundle_of(Vec::new()), Projection::Support);
        assert!(out.contains(r"- Stored at: %APPDATA%\Compy\support"), "{out}");
        assert!(!out.contains(&format!("Stored at: {MASK_PATH}")), "{out}");
    }

    #[test]
    fn an_empty_record_renders_honestly_in_every_projection() {
        let b = bundle_of(Vec::new());
        assert!(render(&b, Projection::Consumer).contains("Nothing to report"));
        assert!(render(&b, Projection::Technical).contains("No records."));
        assert!(render(&b, Projection::Support).contains("No records."));
    }

    #[test]
    fn projection_names_are_parsed_strictly() {
        assert_eq!(Projection::parse("Support").unwrap(), Projection::Support);
        assert_eq!(Projection::parse(" technical ").unwrap(), Projection::Technical);
        assert!(Projection::parse("everything").is_err());
    }

    #[test]
    fn the_export_gate_refuses_before_a_preview() {
        // Session-scoped state — this asserts the closed state exists and names the reason. The
        // open state is covered by preview_support_evidence setting it.
        assert!(!AtomicBool::new(false).load(Ordering::Acquire));
        let err = Projection::parse("nope").unwrap_err();
        assert!(err.contains("consumer, technical, or support"), "{err}");
    }
}
