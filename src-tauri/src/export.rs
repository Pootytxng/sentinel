//! Export Snapshot (F5): READ-ONLY. Composes Compy's already-gathered data
//! (hardware, recommendations, Trust Ledger, readiness, sessions) into a local,
//! shareable Markdown (+ JSON) report. It mutates nothing, calls no apply/
//! rollback, performs no detection of its own, and sends nothing off the device
//! — the user picks where the file goes.
//!
//! The report is built from each source's serde-serialized `Value`, so this
//! module is decoupled from internal struct shapes and degrades gracefully to
//! "—" on any missing field. `build_markdown_report` is pure and unit-tested.

use std::collections::HashSet;
use std::fmt::Write as _;

use serde::Serialize;
use serde_json::{json, Value};

use crate::history::APPLIABLE_REC_IDS;
use crate::compy_data_dir;

/// `game_state` keys that say which programs were running (`running_at_start.rs`) and how complete
/// the process-start list is. They stay in the local session row and are NOT part of the report a
/// user may share: a list that can include a torrent client, meeting apps and developer tools says
/// more about the person than this report needs.
const SHARED_EXPORT_OMITS: [&str; 3] = ["running_at_start", "start_ticks_skipped", "start_events_dropped"];

/// What the export builder took out of the shared export, by class. Built while redacting, then written
/// into the export itself ([`ExportRedaction::to_json`], [`ExportRedaction::note`]). Not `Serialize` and
/// not `Debug`: it holds the raw names it replaced (lower-cased) so a repeat gets the same number, and
/// those must never reach a file or a log.
#[derive(Default)]
pub(crate) struct ExportRedaction {
    /// Program names replaced in game sessions (an event label or a stutter sentence).
    session_program_names: u32,
    /// Startup-entry names replaced in the Trust Ledger and everywhere they were repeated.
    startup_entry_names: u32,
    /// Distinct programs replaced, first seen first. The placeholder number is the position here, so it
    /// says only "the Nth program this export met", never anything about the name.
    others: Vec<String>,
    /// Stutter text whose shape this code does not know: replaced whole rather than risk a name.
    other_text_withheld: u32,
    qos_policy_names: u32,
    /// `game_state` keys that are neither exported nor deliberately omitted (a newer build's fields).
    game_state_fields_dropped: u32,
    power_plan_names: u32,
    /// Distinct per-install ids replaced ("custom-plan:<guid>", "interface:<guid>"), first seen first.
    ids: Vec<String>,
    /// Occurrences of this PC's user, profile-folder, computer or domain name replaced anywhere.
    identity_names: u32,
    /// `C:\Users\<name>\` segments rewritten to `C:\Users\<user>\`.
    user_name_segments: u32,
}

/// The only fixed (non-program) signal labels the monitoring loop writes (`monitoring.rs`).
const FIXED_SIGNALS: [&str; 2] = ["RAM filling up (90%+)", "a GPU clock drop under load"];
const WITHHELD: &str = "(withheld from this export)";
const CUSTOM_PLAN: &str = "a custom power plan";
/// Every `game_state` key the export carries: the fingerprint's own fields, minus
/// [`SHARED_EXPORT_OMITS`]. Anything else (a newer build's `unknown_fields`) is dropped, so a new
/// field is private until someone looks at it and adds it here (a test fails until then).
const EXPORTED_GAME_STATE_KEYS: [&str; 28] = [
    "process_name", "executable_version", "executable_hash", "game_build", "launcher_manifest_version",
    "graphics_api", "resolution_width", "resolution_height", "display_mode", "display_refresh_hz",
    "active_display_identity", "fps_cap", "vsync_state", "vrr_state", "upscaler", "frame_generation_state",
    "gpu_driver", "windows_build", "hardware_fingerprint_hash", "active_compy_change_ids",
    "gaming_mode_active", "power_plan_guid", "power_plan_changed", "context_version", "other_cpu",
    "other_gpu_3d", "other_gpu_video", "collected_at",
];
/// Words a user or computer name can equal without being personal: replacing them by substring would
/// shred ordinary text, and a path under `\Users\<name>` is still caught by shape.
const COMMON_NAMES: [&str; 28] = [
    "user", "users", "admin", "administrator", "owner", "guest", "default", "public", "windows", "system",
    "home", "desktop", "laptop", "computer", "max", "game", "gamer", "gaming", "player", "power", "mode", "pc",
    "steam", "intel", "amd", "nvidia", "radeon", "media",
];

/// Long enough to replace inside text: 3+ characters, or 2+ when the name is not plain ASCII (a two-character
/// CJK name cannot shred English words). A shorter name is only replaced when it is the whole string.
fn long_enough(name: &str) -> bool {
    let n = name.chars().count();
    n >= 3 || (n >= 2 && !name.is_ascii())
}

/// The active power plan as the machine reports it, so a stock plan keeps its name and any other does not.
#[derive(Clone)]
pub(crate) struct ActivePlan {
    pub(crate) name: String,
    pub(crate) guid: String,
}

/// What the redaction needs from the machine, injected so tests never read the environment.
#[derive(Clone, Default)]
pub(crate) struct ExportEnv {
    /// (value, mask) pairs: this PC's user/profile name (`<user>`) and computer/domain name (`<host>`).
    pub(crate) literals: Vec<(String, &'static str)>,
    pub(crate) active_plan: Option<ActivePlan>,
}

impl ExportEnv {
    /// This machine: the support-evidence literals (USERNAME, USERDOMAIN, COMPUTERNAME, 3+ characters),
    /// the profile folder's own name, minus ordinary words; and the active power plan.
    pub(crate) fn this_machine() -> Self {
        // data-root-allow: reads only the profile folder's NAME, to scrub it from the exported text;
        // no path is composed from it and nothing is read, written or opened.
        let leaf = std::env::var("USERPROFILE").ok().and_then(|p| std::path::Path::new(&p).file_name()?.to_str().map(str::to_owned));
        let literals = usable_literals(crate::support_evidence::sensitive_literals(), leaf);
        let active_plan = crate::current_power_scheme().map(|p| ActivePlan { name: p.name, guid: p.guid });
        Self { literals, active_plan }
    }
}

/// PURE: the identity literals the export may apply: 3+ characters (the support-evidence rule) and not an
/// ordinary word, plus the profile folder's own name when it is a different name.
fn usable_literals(mut raw: Vec<(String, &'static str)>, profile_leaf: Option<String>) -> Vec<(String, &'static str)> {
    if let Some(leaf) = profile_leaf {
        if !raw.iter().any(|(v, _)| v.eq_ignore_ascii_case(&leaf)) {
            raw.push((leaf, "<user>"));
        }
    }
    raw.retain(|(v, _)| long_enough(v) && !COMMON_NAMES.contains(&v.to_lowercase().as_str()));
    raw
}

/// One of the four plans Windows ships (the one table is [`crate::STOCK_POWER_SCHEMES`]); anything else
/// is per-install.
pub(crate) fn is_stock_plan(guid: &str) -> bool {
    crate::stock_power_scheme(guid).is_some()
}

fn guid_like(s: &str) -> bool {
    let t = s.trim().trim_matches(['{', '}']);
    t.len() == 36 && t.char_indices().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// Replace `name` by `to` in `s`, ignoring case, at word boundaries: a match is skipped when the name's edge
/// character and the neighbouring character are both ASCII letters or digits ("Sam" stays in "Samsung"; a
/// CJK name still matches inside longer text). A name that is not [`long_enough`] is only replaced when it
/// is the whole string, so a 1-2 character name cannot shred text.
fn replace_name(s: &str, name: &str, to: &str, count: &mut u32) -> String {
    if !long_enough(name) {
        if s.eq_ignore_ascii_case(name) {
            *count += 1;
            return to.to_string();
        }
        return s.to_string();
    }
    let (sc, nc): (Vec<char>, Vec<char>) = (s.chars().collect(), name.chars().collect());
    let same = |a: char, b: char| a == b || a.to_lowercase().eq(b.to_lowercase());
    let (head, tail) = (nc[0].is_ascii_alphanumeric(), nc[nc.len() - 1].is_ascii_alphanumeric());
    let (mut out, mut i) = (String::with_capacity(s.len()), 0usize);
    while i < sc.len() {
        let end = i + nc.len();
        if end <= sc.len() && (0..nc.len()).all(|k| same(sc[i + k], nc[k])) {
            let before = !(head && i > 0 && sc[i - 1].is_ascii_alphanumeric());
            let after = !(tail && end < sc.len() && sc[end].is_ascii_alphanumeric());
            if before && after {
                out.push_str(to);
                *count += 1;
                i = end;
                continue;
            }
        }
        out.push(sc[i]);
        i += 1;
    }
    out
}

fn map_strings(v: &mut Value, f: &mut dyn FnMut(&str) -> String) {
    match v {
        Value::String(s) => *s = f(s.as_str()),
        Value::Array(a) => a.iter_mut().for_each(|x| map_strings(x, f)),
        Value::Object(o) => o.values_mut().for_each(|x| map_strings(x, f)),
        _ => {}
    }
}

impl ExportRedaction {
    fn placeholder(&mut self, name: &str) -> String {
        let key = name.trim().to_lowercase();
        let at = self.others.iter().position(|n| *n == key).unwrap_or_else(|| {
            self.others.push(key);
            self.others.len() - 1
        });
        format!("other program {}", at + 1)
    }

    /// "<kind>-N" for a per-install id: the Nth distinct id of that kind this export met.
    fn id_label(&mut self, kind: &str, value: &str) -> String {
        let key = format!("{kind}:{}", value.trim().trim_matches(['{', '}']).to_lowercase());
        let at = self.ids.iter().position(|k| *k == key).unwrap_or_else(|| {
            self.ids.push(key);
            self.ids.len() - 1
        });
        let prefix = format!("{kind}:");
        format!("{kind}-{}", self.ids[..=at].iter().filter(|k| k.starts_with(&prefix)).count())
    }

    /// "<program> starting" with the program replaced unless it is on the known-programs list.
    fn start_label(&mut self, label: &str) -> String {
        let name = label.strip_suffix(" starting").unwrap_or(label);
        if crate::running_at_start::lookup(name.trim()).is_some() {
            return label.to_string();
        }
        self.session_program_names += 1;
        format!("{} starting", self.placeholder(name))
    }

    /// The one-sentence stutter insight ("2 of your worst stutters lined up with X starting.").
    /// Anything that is not exactly that shape is withheld whole.
    fn insight(&mut self, text: &str) -> String {
        const LEAD: &str = " of your worst stutters lined up with ";
        let parsed = text.find(LEAD).filter(|&at| text[..at].bytes().all(|b| b.is_ascii_digit()) && at > 0).map(|at| {
            let (head, tail) = text.split_at(at + LEAD.len());
            (head, tail.strip_suffix('.').unwrap_or(tail))
        });
        match parsed {
            Some((head, tail)) if FIXED_SIGNALS.contains(&tail) => format!("{head}{tail}."),
            Some((head, tail)) if tail.ends_with(" starting") => format!("{head}{}.", self.start_label(tail)),
            _ => {
                self.other_text_withheld += 1;
                WITHHELD.to_string()
            }
        }
    }

    /// The machine-readable record of what was done, written into the JSON export.
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "session_program_names_replaced": self.session_program_names,
            "startup_entry_names_replaced": self.startup_entry_names,
            "other_programs": self.others.len(),
            "other_text_withheld": self.other_text_withheld,
            "qos_policy_names_replaced": self.qos_policy_names,
            "power_plan_names_replaced": self.power_plan_names,
            "custom_ids_replaced": self.ids.len(),
            "game_state_fields_dropped": self.game_state_fields_dropped,
            "identity_names_replaced": self.identity_names,
            "user_name_segments_replaced": self.user_name_segments,
            "running_at_start_omitted": true,
            "summary": self.note(),
        })
    }

    /// The same facts in sentences, for the Markdown export and the JSON `summary`. Zero reads as zero.
    pub(crate) fn note(&self) -> String {
        let s = |n: u32| if n == 1 { "" } else { "s" };
        let (a, b, m) = (self.session_program_names, self.startup_entry_names, self.others.len() as u32);
        let mut out = if a + b == 0 {
            "No program names needed replacing.".to_string()
        } else {
            format!(
                "{a} program name{} in game sessions and {b} startup-entry name{} not on Compy's known-programs list ({m} program{} in all) replaced with \"other program 1\", \"other program 2\" and so on, with counts and timing unchanged.",
                s(a),
                s(b),
                s(m)
            )
        };
        let mut push = |text: String| {
            out.push(' ');
            out.push_str(&text);
        };
        if self.qos_policy_names > 0 {
            push(format!("{} QoS policy name{} replaced.", self.qos_policy_names, s(self.qos_policy_names)));
        }
        if self.power_plan_names > 0 {
            push(format!("A custom power plan name was replaced in {} place{}.", self.power_plan_names, s(self.power_plan_names)));
        }
        if !self.ids.is_empty() {
            let n = self.ids.len() as u32;
            push(format!("{n} custom power-plan or network-interface ID{} replaced with numbered labels.", s(n)));
        }
        if self.game_state_fields_dropped > 0 {
            push(format!("{} unrecognised game-state field{} left out.", self.game_state_fields_dropped, s(self.game_state_fields_dropped)));
        }
        if self.other_text_withheld > 0 {
            let n = self.other_text_withheld;
            push(format!("{n} piece{} of stutter text in an unexpected shape {} withheld.", s(n), if n == 1 { "was" } else { "were" }));
        }
        if self.identity_names > 0 {
            push(format!("Your Windows user name or computer name was replaced in {} place{}, file paths included.", self.identity_names, s(self.identity_names)));
        }
        push(if self.user_name_segments == 0 {
            "No other account's name was found in a file path.".to_string()
        } else {
            format!("Another account's name was removed from {} place{} in file paths.", self.user_name_segments, s(self.user_name_segments))
        });
        push("Kept as they are: game program names, your typed note, hardware and network adapter names.".to_string());
        out
    }
}

/// PURE: the session rows as the shared export carries them: `game_state` cut to the keys in
/// [`EXPORTED_GAME_STATE_KEYS`] (so the running-at-start snapshot, its counters and any unknown field
/// are gone), and every process-start program that is not on the known-programs list replaced by
/// "other program N" (event labels and the stutter sentence). Everything else is unchanged.
pub(crate) fn redact_session_rows(mut sessions: Value, r: &mut ExportRedaction) -> Value {
    if let Some(rows) = sessions.as_array_mut() {
        for row in rows {
            if let Some(gs) = row.get_mut("game_state").and_then(Value::as_object_mut) {
                let drop: Vec<String> = gs.keys().filter(|k| !EXPORTED_GAME_STATE_KEYS.contains(&k.as_str())).cloned().collect();
                for key in drop {
                    gs.remove(&key);
                    if !SHARED_EXPORT_OMITS.contains(&key.as_str()) {
                        r.game_state_fields_dropped += 1;
                    }
                }
            }
            if let Some(events) = row.get_mut("stutter_events").and_then(Value::as_array_mut) {
                for ev in events {
                    let is_start = ev.get("kind").and_then(Value::as_str) == Some("process-start");
                    let Some(label) = ev.get("label").and_then(Value::as_str).map(str::to_owned) else { continue };
                    let new = if is_start {
                        r.start_label(&label)
                    } else if FIXED_SIGNALS.contains(&label.as_str()) {
                        continue;
                    } else {
                        r.other_text_withheld += 1;
                        WITHHELD.to_string()
                    };
                    ev["label"] = Value::String(new);
                }
            }
            if let Some(text) = row.get("stutter_insight").and_then(Value::as_str).map(str::to_owned) {
                row["stutter_insight"] = Value::String(r.insight(&text));
            }
        }
    }
    sessions
}

/// PURE: `C:\Users\<name>\...` (either slash, doubled or not, any prefix such as a UNC share) with the
/// name replaced by `<user>`. The rest of the path stays readable. The public profile folders carry no
/// one's name and are left alone. A name with spaces is taken whole when a separator or a closing quote
/// follows it; at the end of a string or before other punctuation it ends at the first space.
fn scrub_user_paths(s: &str, count: &mut u32) -> String {
    const KEEP: [&str; 4] = ["public", "default", "default user", "all users"];
    let b = s.as_bytes();
    let is_sep = |c: u8| c == b'\\' || c == b'/';
    let (mut out, mut last, mut i) = (String::new(), 0usize, 0usize);
    while i + 7 <= b.len() {
        if is_sep(b[i]) && b[i + 1..i + 6].eq_ignore_ascii_case(b"users") && is_sep(b[i + 6]) {
            let mut start = i + 7;
            while start < b.len() && is_sep(b[start]) {
                start += 1;
            }
            let rest = &s[start..];
            let stop = |c: char| matches!(c, '\\' | '/' | '"' | '\'' | '<' | '>' | '|' | '*' | '?' | '\n' | '\r' | ')' | ',' | ';' | ']' | '}');
            let name_len = match rest.find(stop) {
                Some(e) if matches!(rest.as_bytes()[e], b'\\' | b'/' | b'"' | b'\'') => e,
                Some(e) => rest[..e].find(char::is_whitespace).unwrap_or(e),
                None => rest.find(char::is_whitespace).unwrap_or(rest.len()),
            };
            let name = &rest[..name_len];
            if !name.trim().is_empty() && !KEEP.contains(&name.trim().to_lowercase().as_str()) {
                out.push_str(&s[last..start]);
                out.push_str("<user>");
                last = start + name_len;
                i = last;
                *count += 1;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&s[last..]);
    out
}

/// The names of startup entries the user toggled through Compy, read from the Trust Ledger rows
/// (`rec_id` "startup-entry:<name>", the typed action and the typed snapshot).
fn row_startup_names(row: &Value) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut add = |n: Option<&str>| {
        if let Some(n) = n.map(str::trim).filter(|n| !n.is_empty()) {
            if !names.iter().any(|x| x.eq_ignore_ascii_case(n)) {
                names.push(n.to_string());
            }
        }
    };
    add(row.get("rec_id").and_then(Value::as_str).and_then(|id| id.strip_prefix("startup-entry:")));
    for (key, kind) in [("applied_action", "set-startup-entry-enabled"), ("snapshot", "startup-approval")] {
        if let Some(o) = row.get(key).filter(|o| o.get("kind").and_then(Value::as_str) == Some(kind)) {
            add(o.get("name").and_then(Value::as_str));
        }
    }
    names
}

fn startup_entry_names(ledger: &Value) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for n in ledger.as_array().map(Vec::as_slice).unwrap_or(&[]).iter().flat_map(row_startup_names) {
        if !names.iter().any(|x| x.eq_ignore_ascii_case(&n)) {
            names.push(n);
        }
    }
    names
}

/// Per-install ids by key: custom power-plan GUIDs and network-interface GUIDs.
fn collect_ids(v: &Value, out: &mut Vec<(&'static str, String)>) {
    match v {
        Value::Object(o) => {
            for (k, x) in o {
                if let Some(s) = x.as_str() {
                    let plan_key = matches!(k.as_str(), "power_plan_guid" | "prior_guid" | "plan_guid" | "guid");
                    if plan_key && guid_like(s) && !is_stock_plan(s) {
                        out.push(("custom-plan", s.to_string()));
                    } else if k == "interface" && s.trim().starts_with('{') && guid_like(s) {
                        out.push(("interface", s.to_string()));
                    }
                } else {
                    collect_ids(x, out);
                }
            }
        }
        Value::Array(a) => a.iter().for_each(|x| collect_ids(x, out)),
        _ => {}
    }
}

/// Names of power plans that are not stock, from the places a plan name sits next to its identity: the
/// diagnostics "Active power plan" row, the readiness power-profile row and any object that holds both a
/// plan GUID and a name. The active plan keeps its name only when the machine says its GUID is stock.
fn custom_plan_names(sources: &[&Value], active: Option<&ActivePlan>) -> Vec<String> {
    fn walk(v: &Value, keyed: &mut Vec<String>, guided: &mut Vec<(String, bool)>) {
        match v {
            Value::Object(o) => {
                let label = o.get("label").and_then(Value::as_str);
                let id = o.get("id").and_then(Value::as_str);
                if label == Some("Active power plan") || id == Some("power-profile") {
                    if let Some(n) = o.get("value").and_then(Value::as_str) {
                        keyed.push(n.to_string());
                    }
                }
                let guid = ["guid", "plan_guid", "prior_guid"].iter().find_map(|k| o.get(*k).and_then(Value::as_str));
                if let (Some(g), Some(n)) = (guid, o.get("name").and_then(Value::as_str)) {
                    guided.push((n.to_string(), is_stock_plan(g)));
                }
                o.values().for_each(|x| walk(x, keyed, guided));
            }
            Value::Array(a) => a.iter().for_each(|x| walk(x, keyed, guided)),
            _ => {}
        }
    }
    let (mut keyed, mut guided) = (Vec::new(), Vec::new());
    sources.iter().for_each(|v| walk(v, &mut keyed, &mut guided));
    let active_stock = active.filter(|a| is_stock_plan(&a.guid)).map(|a| a.name.to_lowercase());
    let mut out: Vec<String> = keyed.into_iter().filter(|n| Some(n.to_lowercase()) != active_stock && !keeps_plan_name(None, n)).collect();
    out.extend(guided.into_iter().filter(|(n, stock)| !stock && !keeps_plan_name(None, n)).map(|(n, _)| n));
    if let Some(a) = active.filter(|a| !is_stock_plan(&a.guid) && !keeps_plan_name(Some(&a.guid), &a.name)) {
        out.push(a.name.clone());
    }
    out.retain(|n| !n.trim().is_empty() && !n.eq_ignore_ascii_case("unknown"));
    out.sort_by_key(|n| std::cmp::Reverse(n.len()));
    out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    out
}

/// A plan name that stays: one of Windows' own names, or one `power_plan_of` reads as a known class (so
/// Compy's own Ultimate Performance copy, which has a GUID Windows does not ship, keeps its name).
fn keeps_plan_name(guid: Option<&str>, name: &str) -> bool {
    const STOCK_NAMES: [&str; 4] = ["balanced", "high performance", "power saver", "ultimate performance"];
    if STOCK_NAMES.contains(&name.trim().to_lowercase().as_str()) {
        return true;
    }
    let g = guid.unwrap_or("00000000-0000-0000-0000-000000000000");
    crate::power_plan_of(&format!("Power Scheme GUID: {g}  ({name})")).is_some_and(|(class, _)| !matches!(class, crate::PowerPlanClass::Other))
}

/// In place: the custom plan `names` replaced only where a plan name sits: the "Active power plan" row's
/// value, the readiness power-profile row's value and its quoted `"<name>"`, a `name` beside a plan GUID
/// (`changed_outside.observed` included), and any Trust Ledger row that carries a custom plan GUID.
fn replace_plan_names(v: &mut Value, names: &[String], ledger_row: bool, n: &mut u32) {
    let swap = |s: &str, quoted: bool, n: &mut u32| {
        names.iter().fold(s.to_string(), |acc, name| {
            if quoted {
                replace_name(&acc, &format!("\"{name}\""), &format!("\"{CUSTOM_PLAN}\""), n)
            } else {
                replace_name(&acc, name, CUSTOM_PLAN, n)
            }
        })
    };
    match v {
        Value::Object(o) => {
            let plan_row = o.get("label").and_then(Value::as_str) == Some("Active power plan") || o.get("id").and_then(Value::as_str) == Some("power-profile");
            let with_guid = ["guid", "plan_guid", "prior_guid"].iter().any(|k| o.get(*k).and_then(Value::as_str).is_some());
            for (k, x) in o.iter_mut() {
                match x {
                    Value::String(s) if ledger_row => *s = swap(s.as_str(), false, n),
                    Value::String(s) if plan_row && k == "value" => *s = swap(s.as_str(), false, n),
                    Value::String(s) if plan_row && k == "detail" => *s = swap(s.as_str(), true, n),
                    Value::String(s) if with_guid && k == "name" => *s = swap(s.as_str(), false, n),
                    other => replace_plan_names(other, names, ledger_row, n),
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| replace_plan_names(x, names, ledger_row, n)),
        Value::String(s) if ledger_row => *s = swap(s.as_str(), false, n),
        _ => {}
    }
}

/// PURE, in place: everything the shared export redacts, over the six source values. Run once, before
/// any report is built from them, so the Markdown, the Discord block and the JSON all agree. Order:
/// sessions (programs, game_state keys), QoS names, startup-entry names (their own ledger rows, plus the
/// exact `startup-entry:<name>` id elsewhere), custom plan names (plan fields only), per-install ids, this
/// PC's own names (word boundaries), and last the user-name segment of any path.
pub(crate) fn redact_export_sources(sources: [&mut Value; 6], env: &ExportEnv) -> ExportRedaction {
    let mut r = ExportRedaction::default();
    let mut all = sources.into_iter().collect::<Vec<_>>();
    let sessions = &mut *all[4];
    *sessions = redact_session_rows(sessions.take(), &mut r);
    if let Some(q) = all[0].get_mut("qos_policies").and_then(Value::as_array_mut) {
        r.qos_policy_names += q.len() as u32;
        *q = (1..=q.len()).map(|i| json!(format!("QoS policy {i}"))).collect();
    }
    // Startup entries: shared "other program N" numbering; a listed program keeps its name.
    for name in startup_entry_names(&*all[2]) {
        if crate::running_at_start::lookup(&name).is_some() || crate::running_at_start::lookup(&format!("{name}.exe")).is_some() {
            continue;
        }
        let ph = r.placeholder(&name);
        let mut n = 0;
        // Only the Trust Ledger rows that hold this entry carry its name in free text; everywhere else only
        // the exact id "startup-entry:<name>" is replaced, so "Steam" in a game-library note stays.
        if let Some(rows) = all[2].as_array_mut() {
            for row in rows.iter_mut().filter(|row| row_startup_names(row).iter().any(|x| x.eq_ignore_ascii_case(&name))) {
                map_strings(row, &mut |s| replace_name(s, &name, &ph, &mut n));
            }
        }
        let (id, id_ph) = (format!("startup-entry:{name}"), format!("startup-entry:{ph}"));
        all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, &id, &id_ph, &mut n)));
        r.startup_entry_names += n;
    }
    // Custom plan names, before the ids go: a ledger row is recognised by the custom GUID it carries.
    let plans = custom_plan_names(&all.iter().map(|v| &**v).collect::<Vec<_>>(), env.active_plan.as_ref());
    if !plans.is_empty() {
        let mut n = 0;
        for (i, v) in all.iter_mut().enumerate() {
            if i == 2 {
                for row in v.as_array_mut().into_iter().flatten() {
                    let mut found = Vec::new();
                    collect_ids(row, &mut found);
                    replace_plan_names(row, &plans, found.iter().any(|(k, _)| *k == "custom-plan"), &mut n);
                }
            } else {
                replace_plan_names(v, &plans, false, &mut n);
            }
        }
        r.power_plan_names += n;
    }
    let mut ids = Vec::new();
    all.iter().for_each(|v| collect_ids(v, &mut ids));
    for (kind, value) in ids {
        let label = r.id_label(kind, &value);
        let inner = value.trim().trim_matches(['{', '}']).to_string();
        all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, &inner, &label, &mut 0)));
    }
    for (value, mask) in env.literals.iter().filter(|(v, _)| long_enough(v)) {
        let mut n = 0;
        all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, value, mask, &mut n)));
        r.identity_names += n;
    }
    let mut paths = 0;
    all.iter_mut().for_each(|v| map_strings(v, &mut |s| scrub_user_paths(s, &mut paths)));
    r.user_name_segments = paths;
    r
}

#[derive(Serialize)]
pub(crate) struct ExportResult {
    path: String,
    /// `path` in `%APPDATA%\Compy\exports\<file>` form: what is shown on screen and put in a mail, so
    /// the Windows account name never goes with it. `path` stays for opening the folder locally.
    display_path: String,
    json_path: String,
    markdown: String,
    /// Compact, code-fenced text block for pasting into Discord/forums (copy, not a file).
    discord: String,
}

// ── Value helpers (graceful: missing/null → "—") ────────────────────────────

fn vstr(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => "—".to_string(),
    }
}
fn vbool(v: &Value, key: &str) -> Option<bool> {
    v.get(key).and_then(Value::as_bool)
}
fn vu64(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}
fn vi64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_i64)
}
fn vf64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}
fn obj_arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
/// A frame-rate reading when it is one: finite and above zero. The sampler's unknown is 0.
fn measured(v: &Value, key: &str) -> Option<f64> {
    vf64(v, key).filter(|x| x.is_finite() && *x > 0.0)
}

fn as_arr(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn gib(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1024f64.powi(3))
}
fn yn(b: Option<bool>) -> &'static str {
    match b {
        Some(true) => "yes",
        Some(false) => "no",
        None => "—",
    }
}
/// M6-unread: the unmeasured time of a session row in the app's human duration, `None` when there was
/// none (a row an older Compy wrote, or a session that could always look).
fn unreadable_secs_text(row: &Value) -> Option<String> {
    vu64(row, "unreadable_seconds").filter(|n| *n > 0).map(fmt_duration)
}

/// The note that stands beside a session's figures when some of its seconds went unmeasured; empty
/// when none did.
fn unreadable_note(row: &Value) -> String {
    unreadable_secs_text(row)
        .map(|t| format!(" \u{b7} Compy couldn't measure {t} of it (left out of these figures)"))
        .unwrap_or_default()
}

fn fmt_duration(secs: u64) -> String {
    let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
    if h > 0 {
        format!("{h}h {m}m")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
    }
}
fn pretty_provenance(p: &str) -> &str {
    match p {
        "verified" => "Verified",
        "measured-signal" => "Measured signal",
        "expected-impact" => "Expected impact",
        other => other,
    }
}
fn pretty_source(s: &str) -> &str {
    match s {
        "remote" => "Remote (signed)",
        "cached" => "Cached (last-known-good)",
        _ => "Built-in",
    }
}

/// Pure: assemble the Markdown report from each source's serialized JSON.
// Each section of the report is its own source Value — the arg list grows with the report, which is
// fine for a single internal assembler.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_markdown_report(
    hardware: &Value,
    recommendations: &Value,
    trust_ledger: &Value,
    readiness: &Value,
    sessions: &Value,
    diagnostics: &Value,
    rules_source: &str,
    exported_at: &str,
    feedback: Option<&str>,
) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "# Compy Report\n");
    let _ = writeln!(
        o,
        "_Exported {} · Compy v{}_\n",
        exported_at,
        env!("CARGO_PKG_VERSION")
    );
    let _ = writeln!(
        o,
        "> Generated locally. Compy collects no telemetry, has no account, and sends nothing \
         off your device. You choose where to share this file.\n"
    );

    // ── Hardware ──
    let _ = writeln!(o, "## Hardware\n");
    let _ = writeln!(
        o,
        "- **CPU:** {} — {} logical / {} physical cores",
        vstr(hardware, "cpu_brand"),
        vu64(hardware, "cpu_cores_logical").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        vu64(hardware, "cpu_cores_physical").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
    );
    let gpus = obj_arr(hardware, "gpus");
    if gpus.is_empty() {
        let _ = writeln!(o, "- **GPU:** —");
    } else {
        for g in gpus {
            let vram = vu64(g, "vram_bytes").map(gib).unwrap_or_else(|| "—".into());
            let age = vi64(g, "driver_age_days")
                .map(|d| format!("{d} days old"))
                .unwrap_or_else(|| "driver age —".into());
            let _ = writeln!(o, "- **GPU:** {} ({vram} VRAM, {age})", vstr(g, "name"));
        }
    }
    let ram = match (vu64(hardware, "ram_total_bytes"), vu64(hardware, "ram_used_bytes")) {
        (Some(t), Some(u)) => format!("{} ({} used)", gib(t), gib(u)),
        (Some(t), None) => gib(t),
        _ => "—".into(),
    };
    let _ = writeln!(o, "- **RAM:** {ram}");
    let phys = obj_arr(hardware, "physical_disks");
    if !phys.is_empty() {
        for d in phys {
            let size = vu64(d, "size_bytes").map(gib).unwrap_or_else(|| "—".into());
            let _ = writeln!(
                o,
                "- **Storage:** {} — {} / {} ({size})",
                vstr(d, "friendly_name"),
                vstr(d, "media_type"),
                vstr(d, "bus_type"),
            );
        }
    } else {
        // Fallback: MSFT_PhysicalDisk returned nothing — report logical volumes so
        // we don't show "—" when drives clearly exist (drive type unavailable here).
        let logical = obj_arr(hardware, "disks");
        if logical.is_empty() {
            let _ = writeln!(o, "- **Storage:** —");
        } else {
            for d in logical {
                let total = vu64(d, "total_bytes").map(gib).unwrap_or_else(|| "—".into());
                let _ = writeln!(
                    o,
                    "- **Storage:** {} — {} ({total} total, drive type unavailable)",
                    vstr(d, "mount_point"),
                    vstr(d, "file_system"),
                );
            }
        }
    }
    if let Some(disp) = hardware.get("display").filter(|d| !d.is_null()) {
        let hdr = match vbool(disp, "hdr_capable") {
            Some(true) => "HDR-capable",
            _ => "no HDR",
        };
        let _ = writeln!(
            o,
            "- **Display:** {}×{} @ {}/{} Hz · {hdr}",
            vu64(disp, "width").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
            vu64(disp, "height").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
            vu64(disp, "current_refresh_rate_hz").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
            vu64(disp, "max_refresh_rate_hz").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        );
    } else {
        let _ = writeln!(o, "- **Display:** —");
    }
    let os = hardware
        .get("windows_version")
        .filter(|w| !w.is_null())
        .map(|w| vstr(w, "product_name"))
        .filter(|s| s != "—")
        .unwrap_or_else(|| {
            format!("{} {}", vstr(hardware, "os_name"), vstr(hardware, "os_version"))
        });
    let _ = writeln!(o, "- **OS:** {os}");

    // Network adapters — the detection-evidence inventory (detection-accuracy train). A tester's
    // false-positive (e.g. a VPN's TAP adapter reading as Ethernet) self-identifies right here.
    let adapters = obj_arr(hardware, "network_adapters");
    if adapters.is_empty() {
        let _ = writeln!(o, "- **Network adapters:** (details unavailable)\n");
    } else {
        let _ = writeln!(o, "- **Network adapters:**");
        for a in adapters {
            let physical = a.get("physical").and_then(|v| v.as_bool()).unwrap_or(false);
            let kind = if physical {
                match vstr(a, "medium").as_str() {
                    "wired" => "physical · wired",
                    "wifi" => "physical · Wi-Fi",
                    _ => "physical · other",
                }
            } else {
                "virtual"
            };
            let connected = a.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
            let state = if connected { "connected" } else { "not connected" };
            let _ = writeln!(o, "  - {} — {kind} · {state}", vstr(a, "name"));
        }
        let _ = writeln!(o);
    }

    // ── Applied-by-Compy set (from the ledger, status applied) ──
    let applied_ids: HashSet<String> = as_arr(trust_ledger)
        .iter()
        .filter(|c| vstr(c, "status") == "applied")
        .map(|c| vstr(c, "rec_id"))
        .collect();

    // ── Recommendations ──
    let recs = as_arr(recommendations);
    let _ = writeln!(o, "## Recommendations ({})\n", recs.len());
    for r in recs {
        let id = vstr(r, "id");
        let kind = if APPLIABLE_REC_IDS.contains(&id.as_str()) {
            "appliable"
        } else {
            "advisory"
        };
        let applied = if applied_ids.contains(&id) {
            " · applied by Compy"
        } else {
            ""
        };
        let _ = writeln!(
            o,
            "- **{}** — _{kind}_ · {} · {} · {} · currently applied: {}{applied}",
            vstr(r, "title"),
            vstr(r, "category"),
            vstr(r, "severity"),
            pretty_provenance(&vstr(r, "provenance")),
            yn(vbool(r, "currently_applied")),
        );
    }
    let _ = writeln!(o);

    // ── Trust Ledger ──
    let ledger = as_arr(trust_ledger);
    let _ = writeln!(o, "## Trust Ledger ({} changes)\n", ledger.len());
    if ledger.is_empty() {
        let _ = writeln!(o, "- No changes applied yet.");
    }
    for c in ledger {
        let status = vstr(c, "status");
        let reverted = status == "applied" && vbool(c, "is_still_active") == Some(false);
        let note = if reverted {
            " · ⚠ no longer active (changed outside Compy)"
        } else {
            ""
        };
        let _ = writeln!(
            o,
            "- **{}** — {status}{note} · {} · ruleset {} · elevation: {}",
            vstr(c, "rec_title"),
            vstr(c, "applied_at"),
            vstr(c, "ruleset_version_at_apply"),
            yn(vbool(c, "elevation_used")),
        );
    }
    let _ = writeln!(o);

    // ── Game Readiness ──
    let _ = writeln!(
        o,
        "## Game Readiness — Ready {} / Attention {} / Unknown {}\n",
        vu64(readiness, "ready_count").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        vu64(readiness, "attention_count").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        vu64(readiness, "unknown_count").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
    );
    let advisory = vstr(readiness, "advisory");
    if advisory != "—" {
        let _ = writeln!(o, "> {advisory}\n");
    }
    for c in obj_arr(readiness, "checks") {
        let val = vstr(c, "value");
        let val_str = if val == "—" { String::new() } else { format!(" — {val}") };
        let _ = writeln!(
            o,
            "- **[{}]** {}{val_str}: {}",
            vstr(c, "status").to_uppercase(),
            vstr(c, "label"),
            vstr(c, "detail"),
        );
    }
    let _ = writeln!(o);

    // ── Sessions ──
    let sess = as_arr(sessions);
    let _ = writeln!(
        o,
        "## Sessions ({}) — live estimates, not benchmark-grade proof\n",
        sess.len()
    );
    if sess.is_empty() {
        let _ = writeln!(o, "- No game sessions recorded yet.");
    }
    for s in sess {
        let dur = vu64(s, "duration_secs").map(fmt_duration).unwrap_or_else(|| "—".into());
        // P4-show-f1: a session with no reading has no numbers; its 0s mean "not measured".
        if vu64(s, "samples") == Some(0) {
            let _ = writeln!(
                o,
                "- **{}** · {dur} · nothing measured: another window was in front the whole time",
                {
                    let p = vstr(s, "process_name");
                    if p == "—" { "Unknown game".to_string() } else { p }
                },
            );
            continue;
        }
        // M6-unread: seconds Compy could not look at are left out of every figure on the row, and
        // the row says so beside them. More than a fifth unmeasured and the frame-rate figures are
        // not printed at all (the app shows that session as "not graded").
        let unread_note = unreadable_note(s);
        if crate::sessions::row_mostly_unread(s) {
            let _ = writeln!(
                o,
                "- **{}** \u{b7} {dur} \u{b7} not graded: Compy couldn't measure {} of it (more than a fifth), so its frame-rate figures are left out",
                {
                    let p = vstr(s, "process_name");
                    if p == "\u{2014}" { "Unknown game".to_string() } else { p }
                },
                unreadable_secs_text(s).unwrap_or_default(),
            );
            continue;
        }
        let fps = vf64(s, "avg_fps").map(|n| format!("{n:.1}")).unwrap_or_else(|| "—".into());
        let ft = vf64(s, "avg_frametime_ms").map(|n| format!("{n:.1} ms")).unwrap_or_else(|| "—".into());
        let low = vf64(s, "low1_fps_est").map(|n| format!("{n:.1}")).unwrap_or_else(|| "—".into());
        let gtemp = vu64(s, "peak_gpu_temp_c").map(|n| format!("{n}°C")).unwrap_or_else(|| "—".into());
        let gusage = vu64(s, "peak_gpu_usage_pct").map(|n| format!("{n}%")).unwrap_or_else(|| "—".into());
        let ram = vu64(s, "peak_ram_used_bytes").map(gib).unwrap_or_else(|| "—".into());
        let _ = writeln!(
            o,
            "- **{}** · {dur} · avg {fps} fps · {ft} · 1% low ~{low} · peak GPU {gtemp}/{gusage} · peak RAM {ram}{unread_note}",
            {
                let p = vstr(s, "process_name");
                if p == "—" { "Unknown game".to_string() } else { p }
            },
        );
    }
    let _ = writeln!(o);

    // ── How these measurements were made (methodology + capture capability · Measurement 2.0) ──
    o.push_str(&build_methodology_section(sessions));

    // ── Diagnostics (detection evidence — so a tester's report can self-diagnose every claim) ──
    let _ = writeln!(o, "## Diagnostics\n");
    let diag_sections = as_arr(diagnostics);
    if diag_sections.is_empty() {
        let _ = writeln!(o, "- (none)\n");
    }
    for sec in diag_sections {
        let _ = writeln!(o, "**{}**\n", vstr(sec, "name"));
        for e in obj_arr(sec, "entries") {
            let note = vstr(e, "note");
            if note == "—" {
                let _ = writeln!(o, "- {}: {}", vstr(e, "label"), vstr(e, "value"));
            } else {
                let _ = writeln!(o, "- {}: {} — _{}_", vstr(e, "label"), vstr(e, "value"), note);
            }
        }
        let _ = writeln!(o);
    }

    // ── Upgrade path (R3 Lane B — advisory; ONLY when a verdict already names hardware) ──
    // Same pure source as the in-app block (priorities::build_upgrade_path) — one qualifying
    // logic, one link table; the report renders real Markdown anchors (the user's own browser
    // opens them — no opener-allowlist involvement). P9-session-on-this-hardware: a session recorded
    // on another card never decides the GPU row (this PC's card read from the `hardware` source).
    let gpu_now = crate::priorities::primary_gpu_of(hardware);
    if let Some(up) = crate::priorities::build_upgrade_path_for(readiness, sessions, gpu_now.as_deref()) {
        let _ = writeln!(o, "## Upgrade path (advisory)\n");
        for item in &up.items {
            let _ = writeln!(o, "- **{}** — {}", item.title, item.why);
            for l in item.links {
                let _ = writeln!(o, "  - [{} search]({})", l.retailer, l.url);
            }
        }
        let _ = writeln!(o, "\n_{}_\n", up.disclosure);
    }

    // ── Privacy & safety ──
    let _ = writeln!(o, "## Privacy & safety\n");
    let _ = writeln!(o, "- This report was generated **locally**. Compy sends nothing off your device — no telemetry, no account, no tracking.");
    let _ = writeln!(o, "- You choose where (and whether) to share this file.");
    let _ = writeln!(o, "- Recommendation rules source: **{}**.", pretty_source(rules_source));
    let _ = writeln!(o, "\n_{SITE_TAGLINE}_ · {SITE_URL}");

    // ── Tester feedback (optional, user-typed) — only ever what the user wrote; blank appends
    // NOTHING (no empty headers, no pre-fill). Local like the rest: it exists only in this file.
    if let Some(f) = feedback.map(str::trim).filter(|f| !f.is_empty()) {
        let _ = writeln!(o, "\n## Tester feedback\n");
        let _ = writeln!(o, "{f}");
    }

    o
}

/// The methodology + capture-capability section (Measurement Platform 2.0 · Task F / §4). The honest
/// answer to a skeptic's "how were these numbers measured, and what may they be compared to?" — the
/// capture backend that produced the sessions, the metric axes it *genuinely* records, its stated
/// limitations, the methodology version in force, and the comparability rule (only shared metrics,
/// only matching conditions). Pure: it reads the `capture_capabilities` already stamped on each
/// session and fabricates nothing. If no session carries a capability record (all pre-2.0 schema),
/// it says the exact metric set is unknown rather than assuming today's backend — missing stays
/// unknown. No numeric confidence anywhere; language matches `docs/METHODOLOGY.md`.
fn build_methodology_section(sessions: &Value) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "## How these measurements were made\n");

    // The capability record is stamped per session; today every session shares one backend, so the
    // first present record describes the method. A future cross-backend run simply renders per-method
    // instead — but never invents a record for a session that lacks one.
    let caps = as_arr(sessions)
        .iter()
        .find(|s| s.get("capture_capabilities").is_some_and(|c| !c.is_null()))
        .and_then(|s| s.get("capture_capabilities"));

    let Some(c) = caps else {
        let _ = writeln!(
            o,
            "- Frame rate is measured from the frame events Windows reports (ETW), not from inside the game: nothing is injected."
        );
        let _ = writeln!(
            o,
            "- These sessions predate the capture-capability record, so the exact metric set they \
             captured is not known and is treated as unknown — never assumed to match today's method."
        );
        let _ = writeln!(
            o,
            "- Sessions are live estimates, not benchmark-grade proof. Two sessions are only \
             comparable when their conditions match; where they differ, direct comparison is limited."
        );
        let _ = writeln!(o);
        return o;
    };

    // Only the metric axes the backend *genuinely* produces — the honest capability table, straight
    // from the persisted record (never hard-coded here, so a future backend's richer set renders
    // truthfully without touching this code).
    let axes: [(&str, &str); 10] = [
        ("supports_app_fps", "frames the game submits (app / submit FPS)"),
        ("supports_presented_fps", "present-completion FPS"),
        ("supports_displayed_fps", "displayed FPS"),
        ("supports_frame_type", "real-vs-generated frame type"),
        ("supports_generated_frames", "frame-generation accounting"),
        ("supports_gpu_busy", "per-frame GPU-busy time"),
        ("supports_display_latency", "display latency"),
        ("supports_input_latency", "input latency"),
        ("supports_dropped_frames", "dropped-frame accounting"),
        ("supports_gpu_telemetry", "capture-backend GPU telemetry"),
    ];
    let supported: Vec<&str> = axes
        .iter()
        .filter(|(k, _)| vbool(c, k) == Some(true))
        .map(|(_, label)| *label)
        .collect();
    let supported_line = if supported.is_empty() {
        "none recorded".to_string()
    } else {
        supported.join(", ")
    };

    let apis: Vec<&str> = c
        .get("graphics_api")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let api_line = if apis.is_empty() { "—".to_string() } else { apis.join(", ") };

    let _ = writeln!(
        o,
        "- **Capture method:** present-event counting via `{}` (capture-method v{}, methodology {}). \
         Frame timing is read from Windows, not from inside the game; nothing is injected.",
        vstr(c, "backend_id"),
        vstr(c, "backend_version"),
        vstr(c, "methodology_version"),
    );
    let _ = writeln!(o, "- **Graphics APIs observed:** {api_line}.");
    let _ = writeln!(o, "- **Metrics actually captured:** {supported_line}.");

    let limitations: Vec<&str> = c
        .get("limitations")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !limitations.is_empty() {
        let _ = writeln!(o, "- **Known limitations:**");
        for l in limitations {
            let _ = writeln!(o, "  - {l}");
        }
    }

    let _ = writeln!(
        o,
        "- **Comparing sessions:** only metrics both sessions actually captured are compared, and \
         only when their conditions match (same game, resolution, and capture method). When some \
         conditions changed, direct comparison is limited and Compy says so rather than guessing."
    );
    let _ = writeln!(
        o,
        "- Sessions are live estimates, not benchmark-grade proof — see the full methodology at \
         {SITE_URL}."
    );
    let _ = writeln!(o);
    o
}

/// The `.md` file is written with a leading UTF-8 BOM so Windows viewers
/// (Notepad, etc.) decode it as UTF-8 instead of mojibake. The in-app preview
/// stays BOM-free; the JSON export is left BOM-free (JSON parsers may reject a BOM).
fn markdown_with_bom(markdown: &str) -> String {
    format!("\u{FEFF}{markdown}")
}

/// Where shared artifacts point home (R3 Lane A4). PAIRED with `src/data/site.ts` — the two are
/// one logical constant split across the language boundary; swap BOTH when a real URL exists
/// (swap order per the R3 §3 hosting decision: `https://<project>.pages.dev` first, then
/// `https://compy.gg`). Plain printable text only: nothing in the app ever fetches it.
pub(crate) const SITE_URL: &str = "https://compy.gg";
pub(crate) const SITE_TAGLINE: &str = "Measured, not promised — Compy.";

/// `SITE_URL` without its scheme, for compact one-line footers ("compy.gg").
fn site_host() -> &'static str {
    SITE_URL.trim_start_matches("https://").trim_start_matches("http://")
}

/// A compact, Discord-pasteable summary — wrapped in a code fence so it renders monospace. ~8 lines:
/// rig, readiness verdict, top fix, active changes, last session. Read-only.
fn build_discord_block(
    hardware: &Value,
    readiness: &Value,
    sessions: &Value,
    trust_ledger: &Value,
    exported_at: &str,
) -> String {
    // CR-gpu-first-elsewhere: the card games run on (most VRAM), not the first adapter (an iGPU).
    let gpu = crate::priorities::primary_gpu_of(hardware).unwrap_or_else(|| "—".into());
    let cpu = hardware
        .get("cpu_arch")
        .and_then(|a| a.get("family_label"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| vstr(hardware, "cpu_brand"));
    let ram_gb = vu64(hardware, "ram_total_bytes")
        .map(|b| (b as f64 / 1024f64.powi(3)).round() as u64)
        .unwrap_or(0);
    let display = hardware
        .get("display")
        .map(|d| {
            let w = vu64(d, "width").unwrap_or(0);
            let h = vu64(d, "height").unwrap_or(0);
            let hz = vu64(d, "current_refresh_rate_hz").unwrap_or(0);
            if w > 0 { format!("{w}x{h}@{hz}") } else { String::new() }
        })
        .unwrap_or_default();
    let ready = vu64(readiness, "ready_count").unwrap_or(0);
    let total = obj_arr(readiness, "checks").len();
    let attention = vu64(readiness, "attention_count").unwrap_or(0);
    let top_fix = obj_arr(readiness, "checks")
        .iter()
        .find(|c| vstr(c, "status") == "attention")
        .map(|c| vstr(c, "label"))
        .unwrap_or_else(|| "nothing — all clear".into());
    let active_changes = as_arr(trust_ledger)
        .iter()
        .filter(|c| vstr(c, "status") == "applied" && vbool(c, "is_still_active") != Some(false))
        .count();

    let mut o = String::new();
    o.push_str("```\n");
    let _ = writeln!(o, "COMPY · {exported_at}");
    let mut rig = format!("rig     · {gpu} · {cpu} · {ram_gb}GB");
    if !display.is_empty() {
        let _ = write!(rig, " · {display}");
    }
    let _ = writeln!(o, "{rig}");
    let _ = writeln!(o, "ready   · {ready}/{total} checks · {attention} need attention");
    let _ = writeln!(o, "top fix · {top_fix}");
    let _ = writeln!(o, "changes · {active_changes} active");
    // The newest session that measured play, and only readings it measured (codebase review
    // 2026-11-02): a session behind another window the whole time saves 0s that mean "not measured",
    // and printed "0 avg / 0 1% low".
    if let Some(s) = crate::sessions::newest_row_with_reading(sessions) {
        let note = unreadable_note(s);
        if crate::sessions::row_mostly_unread(s) {
            // More than a fifth unmeasured: no grade and no figures, the session still named.
            let _ = writeln!(
                o,
                "session \u{b7} {} \u{b7} not graded: Compy couldn't measure {} of it",
                vstr(s, "process_name"),
                unreadable_secs_text(s).unwrap_or_default(),
            );
        } else {
            match (measured(s, "avg_fps"), measured(s, "low1_fps_est")) {
                (Some(avg), Some(low)) => {
                    let _ = writeln!(o, "session \u{b7} {} \u{b7} {avg:.0} avg / {low:.0} 1% low{note}", vstr(s, "process_name"));
                }
                (Some(avg), None) => {
                    let _ = writeln!(o, "session \u{b7} {} \u{b7} {avg:.0} avg{note}", vstr(s, "process_name"));
                }
                _ => {}
            }
        }
    }
    let _ = writeln!(o, "measured, not promised · {}", site_host());
    o.push_str("```");
    o
}

/// Pure: the Consumer projection — the SAME already-gathered sources as the technical report,
/// re-rendered as plain English for someone who will never read a probe table (evidence-export
/// tiers, P2). Presentation-only by construction: it receives the same serialized Values the
/// technical render receives, invents nothing, and degrades by OMITTING a line whose source field
/// is missing — a "—" placeholder is technical furniture, and a consumer render that prints one
/// is asserting a reading it doesn't have. The "Anything to look at?" section only lists checks
/// the machine actually flagged (earned framing, DIR-1a): zero flagged says so plainly, and a
/// readiness pack with no counts is reported as not-yet-checked, never assumed clean.
pub(crate) fn build_consumer_report(
    hardware: &Value,
    trust_ledger: &Value,
    readiness: &Value,
    sessions: &Value,
    exported_at: &str,
    feedback: Option<&str>,
) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "# Your Compy report\n");
    let _ = writeln!(o, "_Exported {} · Compy v{}_\n", exported_at, env!("CARGO_PKG_VERSION"));
    let _ = writeln!(
        o,
        "> Generated locally. Compy collects no telemetry, has no account, and sends nothing \
         off your device. You choose where to share this file.\n"
    );

    // ── Your PC ── (plain names only; a missing reading is omitted, never dashed)
    let _ = writeln!(o, "## Your PC\n");
    let mut wrote_hw = false;
    let cpu = vstr(hardware, "cpu_brand");
    if cpu != "—" {
        let _ = writeln!(o, "- **Processor:** {cpu}");
        wrote_hw = true;
    }
    for g in obj_arr(hardware, "gpus") {
        let name = vstr(g, "name");
        if name != "—" {
            let _ = writeln!(o, "- **Graphics card:** {name}");
            wrote_hw = true;
        }
    }
    if let Some(t) = vu64(hardware, "ram_total_bytes") {
        let _ = writeln!(o, "- **Memory:** {}", gib(t));
        wrote_hw = true;
    }
    let os = hardware
        .get("windows_version")
        .filter(|w| !w.is_null())
        .map(|w| vstr(w, "product_name"))
        .filter(|s| s != "—");
    if let Some(os) = os {
        let _ = writeln!(o, "- **Windows:** {os}");
        wrote_hw = true;
    }
    if !wrote_hw {
        let _ = writeln!(o, "Compy could not read this PC's hardware details.");
    }
    let _ = writeln!(o);

    // ── What Compy has changed ── (the ledger, in plain words; the undo door named)
    let _ = writeln!(o, "## What Compy has changed\n");
    let ledger = as_arr(trust_ledger);
    let applied: Vec<&Value> = ledger.iter().filter(|c| vstr(c, "status") == "applied").collect();
    if applied.is_empty() {
        let _ = writeln!(o, "Compy has not changed anything on this PC yet.");
    } else {
        let active = applied
            .iter()
            .filter(|c| vbool(c, "is_still_active") != Some(false))
            .count();
        let s = if active == 1 { "change" } else { "changes" };
        let _ = writeln!(
            o,
            "{active} {s} made by Compy {} active right now. Every change Compy makes can be \
             undone from the History room.\n",
            if active == 1 { "is" } else { "are" },
        );
        for c in &applied {
            let title = vstr(c, "rec_title");
            if vbool(c, "is_still_active") == Some(false) {
                let _ = writeln!(
                    o,
                    "- **{title}** — Compy applied this, but something outside Compy has since \
                     changed it."
                );
            } else {
                let when = vstr(c, "applied_at");
                if when == "—" {
                    let _ = writeln!(o, "- **{title}**");
                } else {
                    let _ = writeln!(o, "- **{title}** — applied {when}");
                }
            }
        }
    }
    let _ = writeln!(o);

    // ── What Compy measured ── (live readings, honestly labelled; no reading → no sentence)
    let _ = writeln!(o, "## What Compy measured\n");
    let sess = as_arr(sessions);
    if sess.is_empty() {
        let _ = writeln!(o, "No gaming sessions have been measured yet.");
    } else {
        let n = sess.len();
        let s = if n == 1 { "session" } else { "sessions" };
        let _ = writeln!(
            o,
            "Compy watched {n} gaming {s}. These are live readings from your own play, not lab \
             benchmarks."
        );
        // The newest session that measured play, as the Discord block reads it.
        if let Some(latest) = crate::sessions::newest_row_with_reading(sessions) {
            if crate::sessions::row_mostly_unread(latest) {
                // M6-unread: more than a fifth of it unmeasured: named, but not graded and no figure.
                let game = {
                    let p = vstr(latest, "process_name");
                    if p == "—" { "a game".to_string() } else { p }
                };
                let _ = writeln!(
                    o,
                    "- Most recent: **{game}** \u{2014} not graded: Compy couldn't measure {} of it.",
                    unreadable_secs_text(latest).unwrap_or_default()
                );
            } else if let Some(fps) = measured(latest, "avg_fps") {
                let unread = unreadable_secs_text(latest)
                    .map(|t| format!(" Compy couldn't measure {t} of it, so this covers only the rest."))
                    .unwrap_or_default();
                let game = {
                    let p = vstr(latest, "process_name");
                    if p == "—" { "a game".to_string() } else { p }
                };
                let dur = vu64(latest, "duration_secs")
                    .map(|d| format!(" over {}", fmt_duration(d)))
                    .unwrap_or_default();
                let _ = writeln!(
                    o,
                    "- Most recent: **{game}** — about {fps:.0} frames per second{dur}.{unread}"
                );
            }
        }
    }
    let _ = writeln!(o);

    // ── Anything to look at? ── (only what the machine flagged; unknown stays unknown)
    let _ = writeln!(o, "## Anything to look at?\n");
    match vu64(readiness, "attention_count") {
        None => {
            let _ = writeln!(o, "This PC's readiness has not been checked yet.");
        }
        Some(0) => {
            let _ = writeln!(o, "Nothing on this PC is flagged right now.");
        }
        Some(n) => {
            let s = if n == 1 { "thing" } else { "things" };
            let _ = writeln!(o, "Compy's checks flagged {n} {s}:\n");
            for c in obj_arr(readiness, "checks") {
                if vstr(c, "status") == "attention" {
                    let label = vstr(c, "label");
                    let detail = vstr(c, "detail");
                    if detail == "—" {
                        let _ = writeln!(o, "- **{label}**");
                    } else {
                        let _ = writeln!(o, "- **{label}** — {detail}");
                    }
                }
            }
        }
    }
    let _ = writeln!(o);

    // ── Privacy & safety ── (the same vetted sentences as the technical report — one claim, reused)
    let _ = writeln!(o, "## Privacy & safety\n");
    let _ = writeln!(o, "- This report was generated **locally**. Compy sends nothing off your device — no telemetry, no account, no tracking.");
    let _ = writeln!(o, "- You choose where (and whether) to share this file.");
    let _ = writeln!(o, "\n_{SITE_TAGLINE}_ · {SITE_URL}");

    if let Some(f) = feedback.map(str::trim).filter(|f| !f.is_empty()) {
        let _ = writeln!(o, "\n## Your note\n");
        let _ = writeln!(o, "{f}");
    }

    o
}

/// Webview-boundary cap for the user-typed feedback (defense-in-depth, same posture as the
/// receipt-title cap): three short answers fit comfortably; a compromised webview can't bloat
/// the report/memory with an unbounded string. Char-boundary safe.
const FEEDBACK_MAX_CHARS: usize = 4000;
fn cap_feedback(feedback: Option<String>) -> Option<String> {
    feedback.map(|f| f.chars().take(FEEDBACK_MAX_CHARS).collect())
}

/// Everything one export is made of, already redacted. `markdown` is the final file text (note
/// included); `bundle` is the JSON file's value.
pub(crate) struct BuiltExport {
    pub(crate) markdown: String,
    pub(crate) discord: String,
    pub(crate) bundle: Value,
    #[allow(dead_code)] // read by the tests; the note and JSON already carry it
    pub(crate) redaction: ExportRedaction,
}

/// PURE: the one place an export is composed. Redacts the six sources once (see
/// [`redact_export_sources`]), then builds the Markdown (technical or consumer tier), the Discord block
/// and the JSON from those same redacted values, so no shape can differ from another. `export_report`
/// calls this and writes what it returns; nothing is added to a file after it.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_export(
    mut sources: [Value; 6],
    consumer: bool,
    feedback: Option<&str>,
    rules_source: &str,
    exported_at: &str,
    env: &ExportEnv,
) -> BuiltExport {
    let [hardware, recommendations, trust_ledger, readiness, sessions, diagnostics] = &mut sources;
    let redaction = redact_export_sources([hardware, recommendations, trust_ledger, readiness, sessions, diagnostics], env);
    let [hardware, recommendations, trust_ledger, readiness, sessions, diagnostics] = &mut sources;
    let markdown = if consumer {
        build_consumer_report(hardware, trust_ledger, readiness, sessions, exported_at, feedback)
    } else {
        build_markdown_report(hardware, recommendations, trust_ledger, readiness, sessions, diagnostics, rules_source, exported_at, feedback)
    };
    // The export says what it removed, in words, at the end of the file.
    let markdown = format!("{markdown}\n---\n_Removed from this export: {}_\n", redaction.note());
    let discord = build_discord_block(hardware, readiness, sessions, trust_ledger, exported_at);
    // Remove the machine hostname from the shareable JSON. It's identity-adjacent (a hostname is very
    // often the owner's real name) and an export exists to be pasted in public. The builders above
    // already ran against the full value.
    if let Some(obj) = hardware.as_object_mut() {
        obj.remove("hostname");
    }
    let [hardware, recommendations, trust_ledger, readiness, sessions, diagnostics] = sources;
    let bundle = json!({
        "exported_at": exported_at,
        "compy_version": env!("CARGO_PKG_VERSION"),
        "rules_source": rules_source,
        "hardware": hardware,
        "recommendations": recommendations,
        "trust_ledger": trust_ledger,
        "readiness": readiness,
        "sessions": sessions,
        "diagnostics": diagnostics,
        "redaction": redaction.to_json(),
        "privacy": "Local export only. Compy collects no telemetry and has no account.",
    });
    BuiltExport { markdown, discord, bundle, redaction }
}

// The window reaches this through `off_main::export_report` (lib.rs), off the main thread.
pub(crate) fn export_report(
    feedback: Option<String>,
    tier: Option<String>,
) -> Result<ExportResult, String> {
    // Evidence-export tiers (P2): one data source, audience-shaped renders. Absent/technical →
    // the full report (back-compat: every pre-tier caller keeps its exact behaviour); consumer →
    // the plain-English projection. Anything else is a caller bug, refused not guessed.
    let consumer = match tier.as_deref() {
        None | Some("technical") => false,
        Some("consumer") => true,
        Some(other) => {
            return Err(format!(
                "unknown report tier \"{other}\" — expected consumer or technical"
            ))
        }
    };
    let feedback = cap_feedback(feedback);
    let exported_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let rules_source = crate::recommendations::get_rules_source().to_string();
    let built = build_export(
        [
            serde_json::to_value(crate::hardware::get_hardware_info()).unwrap_or(Value::Null),
            serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null),
            serde_json::to_value(crate::history::get_applied_changes()).unwrap_or(Value::Null),
            serde_json::to_value(crate::readiness::get_game_readiness()).unwrap_or(Value::Null),
            serde_json::to_value(crate::sessions::get_session_summaries()).unwrap_or(Value::Null),
            serde_json::to_value(crate::diagnostics::get_diagnostics()).unwrap_or(Value::Null),
        ],
        consumer,
        feedback.as_deref(),
        &rules_source,
        &exported_at,
        &ExportEnv::this_machine(),
    );

    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create export folder: {e}"))?;
    // Millisecond granularity (%3f, no leading dot) so two exports within the same second don't
    // collide on the filename and silently overwrite the earlier report.
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
    // Distinct names so a support conversation can tell at a glance which projection it was sent.
    let md_name = if consumer {
        format!("compy-report-plain-{stamp}.md")
    } else {
        format!("compy-report-{stamp}.md")
    };
    let md_path = dir.join(md_name);
    std::fs::write(&md_path, markdown_with_bom(&built.markdown))
        .map_err(|e| format!("could not write report: {e}"))?;

    // JSON export comes for free — the assembled source Values + metadata.
    let json_path = dir.join(format!("compy-report-{stamp}.json"));
    let json_body = serde_json::to_string_pretty(&built.bundle).map_err(|e| format!("could not build JSON report: {e}"))?;
    std::fs::write(&json_path, json_body)
        .map_err(|e| format!("could not write JSON report: {e}"))?;

    Ok(ExportResult {
        path: md_path.to_string_lossy().to_string(),
        display_path: crate::support_evidence::display_location(&md_path),
        json_path: json_path.to_string_lossy().to_string(),
        markdown: built.markdown,
        discord: built.discord,
    })
}

#[tauri::command]
pub(crate) fn open_export_folder() -> Result<(), String> {
    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not open the export folder: {e}"))?;
    // Reveal the folder in Explorer — read-only, no elevation, no UAC.
    std::process::Command::new("explorer")
        .arg(dir.as_os_str())
        .spawn()
        .map_err(|e| format!("could not open folder: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod export_tests {
    use super::*;
    use serde_json::json;

    // ── Consumer projection (evidence-export tiers, P2) ─────────────────────────────────────────

    #[test]
    fn consumer_report_renders_the_same_sources_in_plain_english() {
        let hw = json!({
            "cpu_brand": "AMD Ryzen 7 7800X3D",
            "gpus": [{ "name": "Radeon RX 9070 XT" }],
            "ram_total_bytes": 32u64 * 1024 * 1024 * 1024,
            "windows_version": { "product_name": "Windows 11 Home" }
        });
        let ledger = json!([
            { "rec_id": "a", "rec_title": "Turn off Xbox Game DVR", "status": "applied",
              "applied_at": "2026-08-01", "is_still_active": true },
            { "rec_id": "b", "rec_title": "High performance power plan", "status": "applied",
              "applied_at": "2026-08-02", "is_still_active": false }
        ]);
        let readiness = json!({ "attention_count": 1, "checks": [
            { "status": "attention", "label": "Game install drive", "detail": "HDD detected" },
            { "status": "ready", "label": "GPU driver", "detail": "up to date" }
        ]});
        let sessions = json!([{ "process_name": "diablo4.exe", "avg_fps": 143.7,
                                "duration_secs": 3600u64 }]);
        let md = build_consumer_report(&hw, &ledger, &readiness, &sessions, "t", None);
        assert!(md.contains("## Your PC"));
        assert!(md.contains("Radeon RX 9070 XT"));
        assert!(md.contains("1 change made by Compy is active right now"), "{md}");
        assert!(md.contains("undone from the History room"));
        assert!(md.contains("something outside Compy has since changed it"), "inactive row stays honest");
        assert!(md.contains("about 144 frames per second over 1h 0m"), "{md}");
        assert!(md.contains("not lab benchmarks"), "measurement honesty line always rides along");
        assert!(md.contains("**Game install drive** — HDD detected"));
        assert!(!md.contains("GPU driver"), "only flagged checks render — ready ones are not 'to look at'");
        assert!(md.contains(SITE_TAGLINE) && md.contains(SITE_URL), "shared footer");
    }

    #[test]
    fn consumer_report_degrades_by_omission_never_by_dash() {
        // Empty everything: every section states its true empty case, and the technical "—"
        // placeholder never appears — a consumer render must not assert readings it doesn't have.
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &json!([]), "t", None);
        assert!(md.contains("could not read this PC's hardware details"));
        assert!(md.contains("Compy has not changed anything on this PC yet."));
        assert!(md.contains("No gaming sessions have been measured yet."));
        assert!(md.contains("readiness has not been checked yet"), "no counts → unknown, never assumed clean");
        // The em-dash is legal as a separator with words on both sides; a BARE "—" standing in
        // for a missing value is the technical placeholder this render bans.
        for line in md.lines() {
            let l = line.trim_end();
            assert!(!l.ends_with('—') && !l.contains(": —") && !l.contains("** — ·"),
                "dash placeholder leaked into consumer render: {line}");
        }
    }

    #[test]
    fn consumer_report_flagging_is_earned() {
        // DIR-1a for exports: zero flagged says so plainly; a flag renders only when the machine
        // actually raised one.
        let clean = json!({ "attention_count": 0, "checks": [] });
        let md = build_consumer_report(&Value::Null, &json!([]), &clean, &json!([]), "t", None);
        assert!(md.contains("Nothing on this PC is flagged right now."));
        assert!(!md.contains("flagged 0"), "never a scary zero-count sentence");
    }

    #[test]
    fn consumer_report_omits_fps_sentence_without_a_measurement() {
        // A session row with no avg_fps must not produce a frames-per-second claim.
        let sessions = json!([{ "process_name": "game.exe" }]);
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &sessions, "t", None);
        assert!(md.contains("Compy watched 1 gaming session"));
        assert!(!md.contains("frames per second"), "no measurement, no number");
    }

    // Codebase review 2026-11-02: a session behind another window the whole time saves 0s that mean
    // "not measured", and both blocks printed them as readings ("0 avg / 0 1% low", "about 0 frames
    // per second"). They read the newest session that measured play instead, and print nothing when
    // none did.
    #[test]
    fn an_unmeasured_session_never_prints_as_a_reading() {
        let behind = json!({ "process_name": "new.exe", "samples": 0, "avg_fps": 0.0, "low1_fps_est": 0.0 });
        let played = json!({ "process_name": "old.exe", "samples": 900, "avg_fps": 141.0, "low1_fps_est": 98.0 });
        let both = json!([behind.clone(), played]);
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &both, "t", None);
        assert!(md.contains("about 141 frames per second"), "{md}");
        assert!(!md.contains("about 0 frames"), "{md}");
        let card = build_discord_block(&Value::Null, &json!({}), &both, &json!([]), "t");
        assert!(card.contains("session · old.exe · 141 avg / 98 1% low"), "{card}");
        let only = json!([behind]);
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &only, "t", None);
        assert!(!md.contains("frames per second"), "{md}");
        let card = build_discord_block(&Value::Null, &json!({}), &only, &json!([]), "t");
        assert!(!card.contains("session ·"), "{card}");
    }

    #[test]
    fn consumer_report_carries_the_users_note_and_blank_appends_nothing() {
        let with = build_consumer_report(&Value::Null, &json!([]), &json!({}), &json!([]), "t", Some("coil whine"));
        assert!(with.contains("## Your note") && with.contains("coil whine"));
        let blank = build_consumer_report(&Value::Null, &json!([]), &json!({}), &json!([]), "t", Some("   "));
        assert!(!blank.contains("## Your note"), "blank note appends no empty header");
    }

    #[test]
    fn markdown_file_is_written_with_utf8_bom() {
        let s = markdown_with_bom("# Compy Report\n");
        assert!(s.starts_with('\u{FEFF}'));
        assert_eq!(&s.as_bytes()[0..3], &[0xEF, 0xBB, 0xBF]); // UTF-8 BOM bytes
        assert!(s.trim_start_matches('\u{FEFF}').starts_with("# Compy Report"));
    }

    #[test]
    fn storage_falls_back_to_logical_disks_when_physical_empty() {
        // physical_disks empty but a logical C: volume present → report it, not "—".
        let hw = json!({
            "physical_disks": [],
            "disks": [{ "mount_point": "C:\\", "total_bytes": 999000000000u64,
                        "available_bytes": 200000000000u64, "file_system": "NTFS" }]
        });
        let md = build_markdown_report(&hw, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("C:\\"), "should list the logical volume");
        assert!(md.contains("NTFS"));
        assert!(md.contains("drive type unavailable"));
        assert!(!md.contains("- **Storage:** —"), "must not show the dash when a drive exists");
    }

    #[test]
    fn upgrade_path_renders_as_anchors_only_when_hardware_is_named() {
        // R3 Lane B: a GPU-limited session puts the advisory block + disclosure + real Markdown
        // anchors in the report; without a qualifying verdict the section is entirely absent.
        let sessions = json!([{ "peak_gpu_usage_pct": 98, "gpu_load": { "readings": 900, "busy": 800 }, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);
        assert!(md.contains("## Upgrade path (advisory)"));
        assert!(md.contains("never affects verdicts"), "disclosure always renders with the links");
        assert!(md.contains("](https://www.amazon.com/s?k=graphics+card)"), "real anchor");
        let none = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(!none.contains("Upgrade path"), "no hardware verdict → no links, no section");
    }

    #[test]
    fn upgrade_path_anchor_format_holds_for_every_link_in_the_table() {
        // A6 close-out: the anchors themselves, independently tested. With BOTH qualifying
        // verdicts present (GPU-limited session + install-drive HDD attention), every RetailLink
        // build_upgrade_path returns must render as a well-formed `- [<retailer> search](<url>)`
        // Markdown anchor — same count (none dropped or duplicated), https-only, and free of
        // affiliate/tracking markers at the EXPORT layer (mirrors the priorities-side guard so a
        // rendering regression can't reintroduce what the table-side guard already bans).
        let sessions = json!([{ "peak_gpu_usage_pct": 97, "gpu_load": { "readings": 900, "busy": 700 }, "avg_fps": 90.0, "low1_fps_est": 70.0 }]);
        let readiness = json!({ "checks": [
            { "id": "install-drive", "status": "attention", "label": "Game install drive",
              "detail": "HDD detected" }
        ]});
        let up = crate::priorities::build_upgrade_path(&readiness, &sessions)
            .expect("both qualifying verdicts must produce an upgrade path");
        let expected: Vec<(&str, &str)> = up
            .items
            .iter()
            .flat_map(|i| i.links.iter().map(|l| (l.retailer, l.url)))
            .collect();
        assert!(expected.len() >= 4, "test premise: both link tables in play");

        let md = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &readiness, &sessions, &json!([]),
            "embedded", "t", None,
        );
        let anchors: Vec<&str> = md
            .lines()
            .map(str::trim_start)
            .filter(|l| l.starts_with("- [") && l.contains(" search]("))
            .collect();
        assert_eq!(
            anchors.len(),
            expected.len(),
            "every table link renders exactly once as an anchor"
        );
        for (retailer, url) in expected {
            let anchor = format!("- [{retailer} search]({url})");
            assert!(md.contains(&anchor), "missing/malformed anchor: {anchor}");
            assert!(url.starts_with("https://"), "https-only: {url}");
            for marker in ["tag=", "ref=", "affid", "affiliate", "utm_", "clickid", "irclick"] {
                assert!(
                    !url.to_ascii_lowercase().contains(marker),
                    "tracking marker `{marker}` in exported URL: {url}"
                );
            }
        }
        // Well-formed anchors only: no stray `](` outside a closed `[...](...)` pair on the line.
        for a in anchors {
            let open = a.matches('[').count();
            let close = a.matches(']').count();
            let parens = a.matches("](").count();
            assert!(
                open == 1 && close == 1 && parens == 1 && a.ends_with(')'),
                "anchor line not well-formed Markdown: {a}"
            );
        }
    }

    #[test]
    fn shared_artifacts_carry_the_site_footer() {
        // R3 Lane A4: the full report and the summary card both point home via the paired
        // SITE_URL/SITE_TAGLINE constants (one logical constant with src/data/site.ts).
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains(SITE_TAGLINE), "report footer carries the tagline");
        assert!(md.contains(SITE_URL), "report footer carries the site URL");
        let card = build_discord_block(&Value::Null, &json!({}), &json!([]), &json!([]), "t");
        assert!(card.contains("measured, not promised"), "card carries the tagline line");
        assert!(card.contains(site_host()), "card carries the bare host");
        assert!(card.trim_end().ends_with("```"), "card stays a closed code fence");
    }

    // CR-gpu-first-elsewhere: the Discord card's rig line names the card games run on (most VRAM),
    // not the first adapter (the iGPU on a hybrid rig).
    #[test]
    fn the_discord_card_names_the_most_vram_card() {
        let hybrid = json!({ "gpus": [
            { "name": "AMD Radeon(TM) Graphics", "vram_bytes": 536870912u64 },
            { "name": "NVIDIA GeForce RTX 4070", "vram_bytes": 12884901888u64 },
        ] });
        let card = build_discord_block(&hybrid, &json!({}), &json!([]), &json!([]), "t");
        assert!(card.contains("NVIDIA GeForce RTX 4070"), "{card}");
        assert!(!card.contains("AMD Radeon(TM) Graphics"), "{card}");
    }

    #[test]
    fn report_is_graceful_with_empty_data() {
        let md = build_markdown_report(
            &Value::Null,
            &json!([]),
            &json!([]),
            &json!({}),
            &json!([]),
            &json!([]),
            "embedded",
            "2026-05-31 12:00",
            None,
        );
        assert!(md.contains("# Compy Report"));
        assert!(md.contains("## Privacy & safety"));
        assert!(md.contains("no telemetry"));
        assert!(md.contains("—")); // missing values degrade gracefully
        assert!(md.contains("No changes applied yet."));
        assert!(md.contains("No game sessions recorded yet."));
    }

    /// M6-unread: every export names the seconds Compy could not measure beside the figures, and a
    /// session of which more than a fifth went unmeasured prints no grade or frame-rate figure at all.
    #[test]
    fn unmeasured_seconds_are_named_beside_the_figures_and_a_mostly_unread_session_is_not_graded() {
        let some = json!([{ "process_name": "game.exe", "duration_secs": 900, "samples": 800, "unreadable_seconds": 90,
            "avg_fps": 141.0, "avg_frametime_ms": 7.1, "low1_fps_est": 98.0 }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &some, &json!([]), "embedded", "t", None);
        let line = md.lines().find(|l| l.starts_with("- **game.exe**")).expect("listed");
        assert!(line.contains("avg 141.0 fps") && line.contains("Compy couldn't measure 1m 30s of it"), "{line}");
        let card = build_discord_block(&Value::Null, &json!({}), &some, &json!([]), "t");
        assert!(card.contains("141 avg / 98 1% low \u{b7} Compy couldn't measure 1m 30s of it"), "{card}");
        let consumer = build_consumer_report(&Value::Null, &json!([]), &json!({}), &some, "t", None);
        assert!(consumer.contains("about 141 frames per second over 15m 0s. Compy couldn't measure 1m 30s of it"), "{consumer}");

        let none = json!([{ "process_name": "game.exe", "duration_secs": 900, "samples": 800,
            "avg_fps": 141.0, "avg_frametime_ms": 7.1, "low1_fps_est": 98.0 }]);
        for out in [
            build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &none, &json!([]), "embedded", "t", None),
            build_discord_block(&Value::Null, &json!({}), &none, &json!([]), "t"),
            build_consumer_report(&Value::Null, &json!([]), &json!({}), &none, "t", None),
        ] {
            assert!(!out.contains("couldn't measure"), "nothing unmeasured, nothing said: {out}");
        }

        let most = json!([{ "process_name": "game.exe", "duration_secs": 900, "samples": 500, "unreadable_seconds": 400,
            "avg_fps": 141.0, "avg_frametime_ms": 7.1, "low1_fps_est": 98.0 }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &most, &json!([]), "embedded", "t", None);
        let line = md.lines().find(|l| l.starts_with("- **game.exe**")).expect("listed");
        assert!(line.contains("not graded") && line.contains("6m 40s") && !line.contains("141") && !line.contains("98"), "{line}");
        let card = build_discord_block(&Value::Null, &json!({}), &most, &json!([]), "t");
        assert!(card.contains("session \u{b7} game.exe \u{b7} not graded") && !card.contains("141"), "{card}");
        let consumer = build_consumer_report(&Value::Null, &json!([]), &json!({}), &most, "t", None);
        assert!(consumer.contains("Most recent: **game.exe**") && consumer.contains("not graded") && !consumer.contains("141"), "{consumer}");
    }

    #[test]
    fn a_session_with_no_reading_is_listed_without_numbers() {
        let sessions = json!([{ "process_name": "game.exe", "duration_secs": 900, "samples": 0,
            "avg_fps": 0.0, "avg_frametime_ms": 0.0, "low1_fps_est": 0.0, "background_secs_excluded": 880 }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "2026-10-25 12:00", None);
        let line = md.lines().find(|l| l.starts_with("- **game.exe**")).expect("listed");
        assert!(line.contains("another window was in front the whole time") && !line.contains("fps"), "{line}");
    }

    #[test]
    fn report_includes_session_metrics_labeled_as_estimates() {
        let sessions = json!([{
            "process_name": "game.exe", "duration_secs": 3661, "avg_fps": 120.5,
            "avg_frametime_ms": 8.3, "low1_fps_est": 90.0, "peak_gpu_temp_c": 64,
            "peak_gpu_usage_pct": 99, "peak_ram_used_bytes": 9_000_000_000u64,
            "ram_total_bytes": 32_000_000_000u64, "samples": 100, "started_at": "x",
            "compy_changes_active": 2
        }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);
        assert!(md.contains("game.exe"));
        assert!(md.contains("120.5 fps"));
        assert!(md.contains("64°C"));
        assert!(md.to_lowercase().contains("estimate")); // explicitly labeled
    }

    #[test]
    fn report_includes_applied_changes() {
        let ledger = json!([{
            "rec_id": "game-mode", "rec_title": "Enable Game Mode", "status": "applied",
            "is_still_active": true, "applied_at": "2026-01-01T00:00:00Z",
            "ruleset_version_at_apply": "1.0.0-baseline", "elevation_used": false
        }]);
        let recs = json!([{
            "id": "game-mode", "title": "Enable Game Mode", "category": "Windows",
            "severity": "safe", "currently_applied": true, "provenance": "verified"
        }]);
        let md = build_markdown_report(&Value::Null, &recs, &ledger, &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("Enable Game Mode"));
        assert!(md.contains("Trust Ledger (1 changes)"));
        assert!(md.contains("applied by Compy")); // cross-referenced from ledger
        assert!(md.contains("_appliable_")); // game-mode is in the appliable set
    }

    #[test]
    fn report_includes_readiness_counts_and_rows() {
        let readiness = json!({
            "ready_count": 5, "attention_count": 2, "unknown_count": 1,
            "advisory": "Readiness checks are advisory.",
            "checks": [{ "id": "monitor-refresh", "label": "Monitor refresh rate",
                         "status": "attention", "detail": "Below max.", "value": "60 / 144 Hz" }]
        });
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &readiness, &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("Ready 5 / Attention 2 / Unknown 1"));
        assert!(md.contains("Monitor refresh rate"));
        assert!(md.contains("[ATTENTION]"));
    }

    #[test]
    fn methodology_section_renders_the_real_capture_capabilities() {
        // Task F / §4: a session stamped with the production capability record produces an honest
        // "How these measurements were made" section — the real backend id/version/methodology, the
        // graphics APIs it can observe, ONLY the metric axes it truly captures, its stated
        // limitations, and the comparability rule. No fabricated capability, no numeric confidence.
        let caps = serde_json::to_value(crate::capture::CaptureCapabilities::etw_dxgi(Some(
            "2026-07-18T00:00:00Z".to_string(),
        )))
        .unwrap();
        let sessions = json!([{
            "process_name": "game.exe", "avg_fps": 120.0, "low1_fps_est": 90.0,
            "started_at": "2026-07-18T00:00:00Z", "capture_capabilities": caps
        }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);

        assert!(md.contains("## How these measurements were made"));
        assert!(md.contains("etw-dxgi"), "the real backend id, straight from the record");
        assert!(md.contains("methodology 2026-07-16"), "the methodology version in force");
        // ONLY app/submit FPS is captured by the ETW-DXGI helper — the richer axes must NOT appear
        // as captured metrics.
        let cap_line = md
            .lines()
            .find(|l| l.contains("Metrics actually captured:"))
            .expect("captured-metrics line present");
        assert!(cap_line.contains("app / submit FPS"));
        assert!(!cap_line.contains("display latency"), "must not claim an axis it never captures");
        assert!(!cap_line.contains("GPU-busy"));
        // Honest limitations surfaced; comparability rule stated in product language.
        assert!(md.contains("Vulkan and OpenGL"), "the DXGI blind-spot caveat is carried through");
        assert!(md.contains("only when their conditions match"));
        assert!(md.to_lowercase().contains("direct comparison is limited"));
        // Anti-fabrication: no numeric confidence / score anywhere in the section.
        let section = &md[md.find("## How these measurements").unwrap()..];
        let section = &section[..section.find("## Diagnostics").unwrap_or(section.len())];
        for banned in ["% confidence", "confidence:", "score", "%bottleneck", "% bottleneck"] {
            assert!(
                !section.to_lowercase().contains(banned),
                "methodology section must carry no numeric confidence/score: found `{banned}`"
            );
        }
    }

    #[test]
    fn methodology_section_is_honest_when_sessions_predate_the_capability_record() {
        // Old-schema guard: a session with NO capture_capabilities (pre-2.0) must not be assumed to
        // match today's backend — the section says the metric set is unknown, and still states the
        // comparability limit. Missing stays unknown.
        let sessions = json!([{ "process_name": "old.exe", "avg_fps": 100.0, "started_at": "x" }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);
        assert!(md.contains("## How these measurements were made"));
        assert!(
            md.contains("predate the capture-capability record"),
            "old sessions are flagged as unknown, not backfilled with today's method"
        );
        assert!(!md.contains("etw-dxgi"), "must not invent a backend id the session never had");
        assert!(md.to_lowercase().contains("direct comparison is limited"));
    }

    #[test]
    fn unicode_titles_and_feedback_round_trip_unmangled() {
        // Edge (R2-4): real tester data is multi-byte (accents, CJK, emoji) — the report and the
        // BOM-prefixed file form must carry it unmangled, alongside the feedback section.
        let recs = json!([{ "id": "x", "title": "Émoji ✨ tweak — テスト", "category": "c",
                            "severity": "safe", "currently_applied": false, "provenance": "verified" }]);
        let md = build_markdown_report(
            &Value::Null, &recs, &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", Some("multi-byte answer: déjà vu ✓"),
        );
        assert!(md.contains("Émoji ✨ tweak — テスト"));
        assert!(md.contains("déjà vu ✓"));
        let bom = markdown_with_bom(&md);
        assert!(
            bom.trim_start_matches('\u{FEFF}').contains("## Tester feedback"),
            "BOM and the feedback section coexist"
        );
    }

    #[test]
    fn tester_feedback_section_appears_when_provided() {
        let md = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", Some("**In one sentence:** my rig's safety net"),
        );
        assert!(md.contains("## Tester feedback"));
        assert!(md.contains("my rig's safety net"));
        // The section lands at the END — after Privacy & safety.
        let fb = md.rfind("## Tester feedback").unwrap();
        let privacy = md.rfind("## Privacy & safety").unwrap();
        assert!(fb > privacy, "feedback must follow the privacy section");
    }

    #[test]
    fn feedback_is_capped_at_the_webview_boundary() {
        let huge = "x".repeat(FEEDBACK_MAX_CHARS * 3);
        let capped = cap_feedback(Some(huge)).unwrap();
        assert_eq!(capped.chars().count(), FEEDBACK_MAX_CHARS);
        assert_eq!(cap_feedback(None), None);
        // Multi-byte input truncates on a char boundary (no panic, no broken UTF-8).
        let multi = "é".repeat(FEEDBACK_MAX_CHARS + 5);
        assert_eq!(cap_feedback(Some(multi)).unwrap().chars().count(), FEEDBACK_MAX_CHARS);
    }

    #[test]
    fn no_feedback_section_when_none_or_blank() {
        let none = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", None,
        );
        assert!(!none.contains("Tester feedback"), "None must add no header");
        let blank = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", Some("   \n\t  "),
        );
        assert!(!blank.contains("Tester feedback"), "whitespace-only must add no empty section");
    }

    #[test]
    fn report_handles_missing_hardware_fields_gracefully() {
        let hw = json!({ "cpu_brand": "Test CPU", "gpus": [ { "name": "Test GPU" } ] });
        let md = build_markdown_report(&hw, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("Test CPU"));
        assert!(md.contains("Test GPU"));
        assert!(md.contains("VRAM, driver age —")); // missing vram/driver age -> dash, no panic
        assert!(md.contains("Built-in")); // rules source prettified
    }

    // ── Redaction of personal strings in the shared export (x2) ────────────────────────────────

    const C_PROG: &str = "TaxPrep2026Canary.exe";
    const C_PROG2: &str = "SignalCanary.exe";
    const C_STARTUP: &str = "StartupCanaryApp";
    const C_QOS: &str = "QosCanaryPolicy";
    const C_USER: &str = "CanaryKuyaName";
    const C_PROFILE: &str = "CanaryProfileDir";
    const C_HOST: &str = "CANARYHOSTPC";
    const C_SPACED: &str = "Zed Canaryspaced";
    const C_PLAN: &str = "CanaryPlanName";
    const C_PLAN_GUID: &str = "11111111-2222-3333-4444-555555555555";
    const C_IFACE: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const C_FUTURE: &str = "FutureCanaryField";
    const ALL_CANARIES: [&str; 12] = [
        "taxprep2026canary", "signalcanary", "startupcanaryapp", "qoscanarypolicy", "canarykuyaname", "canaryprofiledir",
        "canaryhostpc", "canaryspaced", "canaryplanname", "11111111-2222-3333-4444-555555555555",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "futurecanaryfield",
    ];

    fn ev(at: u64, label: &str) -> Value {
        json!({ "at_secs": at, "kind": "process-start", "label": label })
    }

    fn rows_with_canaries() -> Value {
        json!([
            { "process_name": "game.exe", "avg_fps": 144.0,
              "game_state": { "process_name": "game.exe", "running_at_start": { "known": [] }, "start_ticks_skipped": 1,
                              "start_events_dropped": 2, "power_plan_guid": C_PLAN_GUID, "future_field": C_FUTURE },
              "stutter_events": [
                ev(3, "Medal.exe starting"),
                ev(5, &format!("{C_PROG} starting")),
                ev(9, &format!("{C_PROG2} starting")),
                ev(12, &format!("{} starting", C_PROG.to_lowercase())),
                { "at_secs": 14, "kind": "ram", "label": "RAM filling up (90%+)" }
              ],
              "stutter_insight": format!("2 of your worst stutters lined up with {C_PROG} starting.") },
            { "process_name": "game.exe",
              "stutter_events": [ev(1, &format!("{C_PROG2} starting")), ev(2, "OBS64.EXE starting"), ev(4, "OneDrive.exe starting")],
              "stutter_insight": "2 of your worst stutters lined up with OBS64.EXE starting." }
        ])
    }

    fn canary_env() -> ExportEnv {
        ExportEnv {
            literals: vec![(C_USER.into(), "<user>"), (C_PROFILE.into(), "<user>"), (C_HOST.into(), "<host>")],
            active_plan: Some(ActivePlan { name: C_PLAN.into(), guid: C_PLAN_GUID.into() }),
        }
    }

    fn canary_sources() -> [Value; 6] {
        let p = format!(r"C:\Users\{C_USER}\AppData\Roaming\Compy\history.json");
        [
            json!({ "cpu_brand": "Test CPU", "hostname": C_HOST, "gpus": [{ "name": "Test GPU" }],
                    "qos_policies": [C_QOS, format!("{C_QOS} two")] }),
            json!([{ "id": "x", "title": "T", "category": "c", "detail": format!(r"see {p}") }]),
            json!([
                { "id": "h1", "rec_id": format!("startup-entry:{C_STARTUP}"), "rec_title": format!("Disable startup entry: {C_STARTUP}"),
                  "snapshot": { "kind": "startup-approval", "name": C_STARTUP, "prior_bytes": [1, 2] },
                  "applied_action": { "kind": "set-startup-entry-enabled", "name": C_STARTUP, "enabled": false },
                  "restores_label": format!("Turns {C_STARTUP} back on at sign-in"), "status": "applied" },
                { "id": "h2", "rec_id": "high-performance-plan", "rec_title": "Use a performance power plan",
                  "snapshot": { "kind": "power-plan", "prior_guid": C_PLAN_GUID },
                  "applied_plan": { "guid": C_PLAN_GUID, "name": C_PLAN },
                  "restores_label": format!("Switches back to {C_PLAN}") },
                { "id": "h3", "rec_id": "nagle", "rec_title": "Lower network latency",
                  "snapshot": { "kind": "nagle", "interfaces": [{ "interface": format!("{{{C_IFACE}}}"), "value": 1 }] } },
                { "id": "h4", "rec_id": "q", "rec_title": "Q", "restores_label": format!("run \"C:\\Users\\{C_SPACED}\\x.exe\" then (C:\\Users\\OtherAcct), done") }
            ]),
            json!({ "checks": [
                { "id": "power-profile", "title": "Power profile", "value": C_PLAN, "detail": format!("Active plan \"{C_PLAN}\". A performance plan can reduce latency.") },
                { "id": "c1", "detail": format!(r"\\srv\share\Users\{C_USER}\Games") },
                { "id": "c2", "detail": format!(r"C:\\Users\\{C_USER}\\escaped") }
            ] }),
            rows_with_canaries(),
            json!([{ "name": "Power", "entries": [
                { "label": "Active power plan", "value": C_PLAN },
                { "label": "Note", "value": format!("{C_USER}'s PC {C_HOST} profile {C_PROFILE}") },
                { "label": "Adapter", "value": "Realtek PCIe GbE Family Controller" }
            ] }]),
        ]
    }

    fn all_text(v: &[Value; 6]) -> String {
        v.iter().map(Value::to_string).collect::<String>().to_lowercase()
    }

    fn built(consumer: bool) -> BuiltExport {
        build_export(canary_sources(), consumer, Some("my note"), "embedded", "t", &canary_env())
    }

    #[test]
    fn no_canary_survives_in_any_shape_of_either_tier() {
        let input = all_text(&canary_sources());
        for c in ALL_CANARIES {
            assert!(input.contains(c), "the fixture must plant {c}");
        }
        for consumer in [false, true] {
            let b = built(consumer);
            let shapes = [
                ("final markdown", b.markdown.to_lowercase()),
                ("discord block", b.discord.to_lowercase()),
                ("json", serde_json::to_string_pretty(&b.bundle).unwrap().to_lowercase()),
            ];
            for (what, text) in shapes {
                for c in ALL_CANARIES {
                    assert!(!text.contains(c), "{c} survived in the {what} (consumer tier: {consumer})");
                }
            }
            assert!(b.markdown.contains("my note"), "the user's own note is kept as typed");
            assert!(b.markdown.contains("_Removed from this export:"));
            assert!(b.bundle["hardware"].get("hostname").is_none(), "the hostname field stays out of the JSON");
        }
        // The technical Markdown carries the replaced startup title, proving that field reaches this shape.
        assert!(built(false).markdown.contains("Disable startup entry: other program 4"), "{}", built(false).markdown);
    }

    #[test]
    fn counts_are_given_by_class_and_are_right() {
        let j = &built(false).bundle["redaction"];
        let n = |k: &str| j[k].as_u64().unwrap_or_else(|| panic!("missing {k}"));
        assert_eq!(n("session_program_names_replaced"), 6, "3 labels + 1 sentence + signal + OneDrive");
        assert_eq!(n("startup_entry_names_replaced"), 5, "rec_id, rec_title, snapshot, action, restores_label");
        assert_eq!(n("other_programs"), 4, "tax, signal, OneDrive, startup entry");
        assert_eq!(n("qos_policy_names_replaced"), 2);
        assert_eq!(n("power_plan_names_replaced"), 5, "diagnostics, readiness value + detail, applied_plan, restores_label");
        assert_eq!(n("custom_ids_replaced"), 2, "one custom plan guid (3 places), one interface");
        assert_eq!(n("game_state_fields_dropped"), 1, "future_field");
        assert_eq!(n("identity_names_replaced"), 7, "user x4 (path, UNC, escaped, note), profile x1, host x2 (hostname field, note)");
        assert_eq!(n("user_name_segments_replaced"), 2, "a quoted spaced name and a parenthesised one");
        assert_eq!(j["running_at_start_omitted"], true);
        let note = j["summary"].as_str().unwrap();
        assert!(note.starts_with("6 program names in game sessions and 5 startup-entry names not on Compy's known-programs list (4 programs in all) replaced"), "{note}");
        for part in ["2 QoS policy names replaced.", "A custom power plan name was replaced in 5 places.", "2 custom power-plan or network-interface IDs replaced", "1 unrecognised game-state field left out.", "replaced in 7 places, file paths included.", "Another account's name was removed from 2 places in file paths.", "Kept as they are: game program names, your typed note, hardware and network adapter names."] {
            assert!(note.contains(part), "{part} missing from {note}");
        }
    }

    #[test]
    fn the_note_reads_right_at_zero_and_at_one() {
        assert_eq!(
            ExportRedaction::default().note(),
            "No program names needed replacing. No other account's name was found in a file path. Kept as they are: game program names, your typed note, hardware and network adapter names."
        );
        let mut one = ExportRedaction::default();
        one.start_label("x-canary.exe starting");
        one.user_name_segments = 1;
        one.qos_policy_names = 1;
        let note = one.note();
        assert!(note.starts_with("1 program name in game sessions and 0 startup-entry names not on Compy's known-programs list (1 program in all) replaced"), "{note}");
        assert!(note.contains("1 QoS policy name replaced.") && note.contains("Another account's name was removed from 1 place in file paths."), "{note}");
    }

    #[test]
    fn the_note_never_says_no_path_held_the_current_users_name_when_it_was_replaced() {
        let b = built(false);
        let note = b.bundle["redaction"]["summary"].as_str().unwrap().to_string();
        assert!(note.contains("replaced in 7 places, file paths included."), "{note}");
        assert!(!note.contains("No file path in this export held a Windows user name"), "{note}");
        // Only the current user's name, in a path: it is counted as an identity replacement, not as another account.
        let env = ExportEnv { literals: vec![("Kuyaname".into(), "<user>")], active_plan: None };
        let mut hw = json!({ "p": r"C:\Users\Kuyaname\AppData" });
        let (mut a, mut l, mut rd, mut s, mut d) = (json!([]), json!([]), json!({}), json!([]), json!([]));
        let r = redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &env);
        assert_eq!(hw["p"], r"C:\Users\<user>\AppData");
        let note = r.note();
        assert!(note.contains("replaced in 1 place, file paths included.") && note.contains("No other account's name was found in a file path."), "{note}");
        assert!(!note.contains("No file path"), "{note}");
    }

    #[test]
    fn programs_off_the_list_become_numbered_placeholders_and_listed_ones_stay() {
        let mut r = ExportRedaction::default();
        let out = redact_session_rows(rows_with_canaries(), &mut r);
        let labels = |i: usize| -> Vec<String> {
            out[i]["stutter_events"].as_array().unwrap().iter().map(|e| e["label"].as_str().unwrap().to_string()).collect()
        };
        assert_eq!(
            labels(0),
            ["Medal.exe starting", "other program 1 starting", "other program 2 starting", "other program 1 starting", "RAM filling up (90%+)"]
        );
        // The same program is the same placeholder in another session; OneDrive is not on the list.
        assert_eq!(labels(1), ["other program 2 starting", "OBS64.EXE starting", "other program 3 starting"]);
        let at: Vec<u64> = out[0]["stutter_events"].as_array().unwrap().iter().map(|e| e["at_secs"].as_u64().unwrap()).collect();
        assert_eq!(at, [3, 5, 9, 12, 14]);
        assert_eq!(out[0]["stutter_events"][1]["kind"], "process-start");
        assert_eq!(out[0]["stutter_insight"], "2 of your worst stutters lined up with other program 1 starting.");
        assert_eq!(out[1]["stutter_insight"], "2 of your worst stutters lined up with OBS64.EXE starting.");
        assert_eq!(r.session_program_names, 6);
        let text = out.to_string().to_lowercase();
        assert!(!text.contains("taxprep") && !text.contains("signalcanary") && !text.contains("onedrive"), "{text}");
        assert!(rows_with_canaries().to_string().contains(C_PROG), "the recorded rows are untouched");
    }

    #[test]
    fn the_placeholder_number_does_not_depend_on_the_name() {
        let rows = json!([{ "stutter_events": [ev(1, "b-secret.exe starting"), ev(2, "a-secret.exe starting")] }]);
        let out = redact_session_rows(rows, &mut ExportRedaction::default());
        assert_eq!(out[0]["stutter_events"][0]["label"], "other program 1 starting");
        assert_eq!(out[0]["stutter_events"][1]["label"], "other program 2 starting");
    }

    #[test]
    fn a_stutter_sentence_of_an_unknown_shape_is_withheld_whole() {
        for odd in [
            format!("some of your worst stutters lined up with {C_PROG} starting."),
            format!("{C_PROG} lined up with your worst stutters."),
            format!("2 of your worst stutters lined up with {C_PROG}."),
            format!("{C_PROG} 2 of your worst stutters lined up with RAM filling up (90%+)."),
        ] {
            let mut r = ExportRedaction::default();
            let out = redact_session_rows(json!([{ "stutter_insight": odd }]), &mut r);
            assert_eq!(out[0]["stutter_insight"], WITHHELD, "{odd}");
            assert_eq!(r.other_text_withheld, 1);
            assert!(!out.to_string().contains(C_PROG));
        }
        let mut r = ExportRedaction::default();
        let out = redact_session_rows(
            json!([{ "stutter_events": [{ "at_secs": 1, "kind": "mystery", "label": C_PROG }],
                     "stutter_insight": "3 of your worst stutters lined up with a GPU clock drop under load." }]),
            &mut r,
        );
        assert!(!out.to_string().contains(C_PROG));
        assert_eq!(out[0]["stutter_insight"], "3 of your worst stutters lined up with a GPU clock drop under load.");
        assert_eq!(r.other_text_withheld, 1);
    }

    #[test]
    fn a_listed_startup_entry_keeps_its_name_and_a_short_name_never_shreds_text() {
        let mut ledger = json!([{ "rec_id": "startup-entry:Discord", "rec_title": "Disable startup entry: Discord" }]);
        let mut h = json!({}); let mut a = json!([]); let mut rd = json!({}); let mut s = json!([]); let mut d = json!([]);
        let r = redact_export_sources([&mut h, &mut a, &mut ledger, &mut rd, &mut s, &mut d], &ExportEnv::default());
        assert_eq!(ledger[0]["rec_title"], "Disable startup entry: Discord");
        assert_eq!(r.startup_entry_names, 0);
        let mut n = 0;
        assert_eq!(replace_name("fabric ab", "ab", "X", &mut n), "fabric ab", "a 2-character name is only replaced when it is the whole string");
        assert_eq!(replace_name("AB", "ab", "X", &mut n), "X");
        assert_eq!(replace_name("see Abc here", "abc", "X", &mut n), "see X here");
        assert_eq!(n, 2);
        // A 2-character literal (user name) is never applied.
        let env = ExportEnv { literals: vec![("ab".into(), "<user>")], active_plan: None };
        let mut hw = json!({ "cpu_brand": "fabric lab" });
        redact_export_sources([&mut hw, &mut a, &mut ledger, &mut rd, &mut s, &mut d], &env);
        assert_eq!(hw["cpu_brand"], "fabric lab");
    }

    #[test]
    fn usable_literals_drop_short_and_ordinary_names_and_add_the_profile_folder() {
        let raw = vec![("Kuya".to_string(), "<user>"), ("ab".to_string(), "<user>"), ("Admin".to_string(), "<user>"), ("PCNAME1".to_string(), "<host>")];
        let out = usable_literals(raw, Some("KuyaProfile".into()));
        let vals: Vec<&str> = out.iter().map(|(v, _)| v.as_str()).collect();
        assert_eq!(vals, ["Kuya", "PCNAME1", "KuyaProfile"]);
        assert_eq!(usable_literals(vec![], Some("Kuya".into())).len(), 1);
        assert!(usable_literals(vec![("kuya".into(), "<user>")], Some("Kuya".into())).len() == 1, "no duplicate of the same name");
        assert!(usable_literals(vec![], Some("User".into())).is_empty(), "an ordinary word as the folder name is left to the path rule");
    }

    #[test]
    fn a_stock_plan_keeps_its_name_and_a_custom_one_does_not() {
        let mk = |name: &str| -> [Value; 6] {
            [json!({}), json!([]), json!([]), json!({ "checks": [{ "id": "power-profile", "value": name, "detail": format!("Active plan \"{name}\".") }] }), json!([]),
             json!([{ "name": "Power", "entries": [{ "label": "Active power plan", "value": name }] }])]
        };
        let stock = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "Balanced".into(), guid: "381B4222-F694-41F0-9685-FF5BB260DF2E".into() }) };
        let mut s = mk("Balanced");
        let r = redact_export_sources(s.each_mut(), &stock);
        assert!(all_text(&s).contains("balanced") && r.power_plan_names == 0);
        let custom = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: C_PLAN.into(), guid: C_PLAN_GUID.into() }) };
        let mut c = mk(C_PLAN);
        let r = redact_export_sources(c.each_mut(), &custom);
        assert!(!all_text(&c).contains("canaryplanname") && all_text(&c).contains("a custom power plan") && r.power_plan_names == 3);
        // The machine could not say which plan is active: a name at the plan rows is treated as custom.
        let mut u = mk(C_PLAN);
        redact_export_sources(u.each_mut(), &ExportEnv::default());
        assert!(!all_text(&u).contains("canaryplanname"));
    }

    #[test]
    fn game_state_exports_only_listed_keys_and_a_new_field_must_be_classified() {
        use crate::game_state::{GameStateFingerprint as G, OtherLoad};
        let load = OtherLoad { readings: 1, unread: 0, mean_pct_x10: 1, p90_pct_x10: 2 };
        let s = || Some("x".to_string());
        // Every field named, no `..Default`: adding a field to GameStateFingerprint breaks this build
        // until it is set here, and then the key check below fails until it is classified.
        let g = G {
            process_name: s(), executable_version: s(), executable_hash: s(), game_build: s(), launcher_manifest_version: s(),
            graphics_api: s(), resolution_width: Some(1), resolution_height: Some(1), display_mode: s(), display_refresh_hz: Some(1),
            active_display_identity: s(), fps_cap: Some(1), vsync_state: s(), vrr_state: s(), upscaler: s(), frame_generation_state: s(),
            gpu_driver: s(), windows_build: s(), hardware_fingerprint_hash: s(), active_compy_change_ids: vec!["a".into()],
            gaming_mode_active: Some(true), power_plan_guid: s(), power_plan_changed: Some(true), context_version: Some(2),
            other_cpu: Some(load), other_gpu_3d: Some(load), other_gpu_video: Some(load), running_at_start: None,
            start_ticks_skipped: Some(1), start_events_dropped: Some(1), collected_at: s(),
            unknown_fields: [("future".to_string(), json!(C_FUTURE))].into_iter().collect(),
        };
        let v = serde_json::to_value(&g).unwrap();
        for key in v.as_object().unwrap().keys() {
            assert!(
                EXPORTED_GAME_STATE_KEYS.contains(&key.as_str()) || SHARED_EXPORT_OMITS.contains(&key.as_str()) || key == "future",
                "game_state key {key} is neither exported nor deliberately omitted: classify it in export.rs"
            );
        }
        for key in EXPORTED_GAME_STATE_KEYS {
            assert!(v.get(key).is_some(), "{key} is listed as exported but GameStateFingerprint no longer writes it");
        }
        let mut r = ExportRedaction::default();
        let out = redact_session_rows(json!([{ "game_state": v }]), &mut r);
        let keys: Vec<&String> = out[0]["game_state"].as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), EXPORTED_GAME_STATE_KEYS.len());
        assert!(!out.to_string().contains(C_FUTURE));
        assert_eq!(r.game_state_fields_dropped, 1, "only the unknown field is counted; the omitted ones were already stripped");
    }

    #[test]
    fn the_user_name_segment_of_a_path_is_replaced_in_every_form_and_the_rest_kept() {
        let u = r"C:\Users\<user>";
        let cases: [(String, String); 12] = [
            (format!(r"C:\Users\{C_USER}\AppData\Roaming\Compy"), format!(r"{u}\AppData\Roaming\Compy")),
            (format!("c:/users/{C_USER}/Desktop/x.log"), "c:/users/<user>/Desktop/x.log".into()),
            (format!(r"saved C:\Users\John {C_USER}\Documents\a.txt ok"), format!(r"saved {u}\Documents\a.txt ok")),
            (r#"run "C:\Users\John Smith" now"#.into(), format!(r#"run "{u}" now"#)),
            (r#"run "C:\Users\John Smith\a b.exe" now"#.into(), format!(r#"run "{u}\a b.exe" now"#)),
            (r"C:\\Users\\john\\a".into(), r"C:\\Users\\<user>\\a".into()),
            (r"(C:\Users\john)".into(), format!("({u})")),
            (r"C:\Users\john, D:\x".into(), format!(r"{u}, D:\x")),
            (r"[C:\Users\john];".into(), format!("[{u}];")),
            (r"\\srv\share\Users\john\x".into(), r"\\srv\share\Users\<user>\x".into()),
            ("C:/Users/John Smith/Docs".into(), "C:/Users/<user>/Docs".into()),
            (r"read C:\Users\john failed".into(), format!("read {u} failed")),
        ];
        for (input, want) in cases {
            let mut n = 0;
            assert_eq!(scrub_user_paths(&input, &mut n), want, "{input}");
            assert_eq!(n, 1, "{input}");
        }
        let mut m = 0;
        for same in [r"C:\Users\Public\Desktop", r"C:\Users\Default\NTUSER.DAT", r"C:\Users\<user>\x", r"D:\Games\Users", "no path here"] {
            assert_eq!(scrub_user_paths(same, &mut m), same);
        }
        assert_eq!(m, 0, "nothing to remove: nothing counted");
        let once = scrub_user_paths(&format!(r"C:\Users\{C_USER}\a"), &mut m);
        assert_eq!(scrub_user_paths(&once, &mut m), once, "idempotent");
        assert_eq!(scrub_user_paths(&format!("é C:\\Users\\{C_USER}\\é"), &mut 0), "é C:\\Users\\<user>\\é");
    }

    #[test]
    fn this_pcs_own_spaced_name_at_the_end_of_a_string_is_caught_by_the_literal_pass() {
        let env = ExportEnv { literals: vec![(C_SPACED.into(), "<user>")], active_plan: None };
        let mut hw = json!({ "a": format!(r"C:\Users\{C_SPACED}"), "b": format!("owner {C_SPACED}") });
        let (mut a, mut l, mut rd, mut s, mut d) = (json!([]), json!([]), json!({}), json!([]), json!([]));
        redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &env);
        assert_eq!(hw["a"], r"C:\Users\<user>");
        assert_eq!(hw["b"], "owner <user>");
    }

    #[test]
    fn a_startup_entry_name_is_replaced_in_its_own_ledger_row_and_not_in_other_text() {
        let mut v = [
            json!({ "game_storage": { "libraries": [{ "launcher": "Steam", "path": r"D:\Games" }] } }),
            json!([{ "id": "g", "title": "No Steam/Epic game library", "detail": "Steam is not needed here" }]),
            json!([
                { "id": "h1", "rec_id": "startup-entry:Steam", "rec_title": "Disable startup entry: Steam",
                  "snapshot": { "kind": "startup-approval", "name": "Steam" }, "restores_label": "Turns Steam back on",
                  "active_compy_change_ids": ["startup-entry:Steam", "startup-entry:Steamer"] },
                { "id": "h2", "rec_id": "other", "rec_title": "Mentions Steam in passing" }
            ]),
            json!({ "checks": [{ "id": "c", "detail": "Active change startup-entry:Steam, done" }] }),
            json!([]),
            json!([]),
        ];
        let r = redact_export_sources(v.each_mut(), &ExportEnv::default());
        assert_eq!(v[0]["game_storage"]["libraries"][0]["launcher"], "Steam");
        assert_eq!(v[1][0]["title"], "No Steam/Epic game library");
        assert_eq!(v[1][0]["detail"], "Steam is not needed here");
        let row = &v[2][0];
        assert_eq!(row["rec_id"], "startup-entry:other program 1");
        assert_eq!(row["rec_title"], "Disable startup entry: other program 1");
        assert_eq!(row["snapshot"]["name"], "other program 1");
        assert_eq!(row["restores_label"], "Turns other program 1 back on");
        assert_eq!(row["active_compy_change_ids"], json!(["startup-entry:other program 1", "startup-entry:Steamer"]));
        assert_eq!(v[2][1]["rec_title"], "Mentions Steam in passing", "a row that is not the entry's own is not touched");
        assert_eq!(v[3]["checks"][0]["detail"], "Active change startup-entry:other program 1, done", "the exact id is replaced anywhere");
        assert_eq!(r.startup_entry_names, 6);
    }

    #[test]
    fn an_identity_name_is_replaced_at_word_boundaries_only() {
        let rep = |s: &str, name: &str| replace_name(s, name, "<user>", &mut 0);
        assert_eq!(rep("Maximum", "Max"), "Maximum");
        assert_eq!(rep("Max's PC", "Max"), "<user>'s PC");
        assert_eq!(rep(r"\\srv\Max", "max"), r"\\srv\<user>");
        assert_eq!(rep("Samsung SSD 990 PRO", "Sam"), "Samsung SSD 990 PRO");
        assert_eq!(rep("GrandSam", "Sam"), "GrandSam", "a name inside a longer word is left alone from the front too");
        assert_eq!(rep("Sam's laptop", "SAM"), "<user>'s laptop");
        assert_eq!(rep("张伟的电脑", "张伟"), "<user>的电脑", "a CJK name matches inside longer text");
        // "Max" is an ordinary word on the skip list, so it is never applied to free text.
        assert!(usable_literals(vec![("Max".into(), "<user>")], None).is_empty());
        let mut hw = json!({ "display": "Max refresh rate", "gpu": "NVIDIA Corporation", "share": r"CORP\kuya", "pc": "张伟的电脑" });
        let env = ExportEnv { literals: vec![("CORP".into(), "<host>"), ("张伟".into(), "<user>")], active_plan: None };
        let (mut a, mut l, mut rd, mut s, mut d) = (json!([]), json!([]), json!({}), json!([]), json!([]));
        redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &env);
        assert_eq!(hw["display"], "Max refresh rate");
        assert_eq!(hw["gpu"], "NVIDIA Corporation");
        assert_eq!(hw["share"], r"<host>\kuya");
        assert_eq!(hw["pc"], "<user>的电脑");
    }

    #[test]
    fn an_account_name_on_the_skip_list_is_removed_from_paths_only() {
        assert!(usable_literals(vec![("Admin".into(), "<user>")], None).is_empty());
        let mut hw = json!({ "p": r"C:\Users\Admin\Documents", "t": "Admin panel" });
        let (mut a, mut l, mut rd, mut s, mut d) = (json!([]), json!([]), json!({}), json!([]), json!([]));
        redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &ExportEnv::default());
        assert_eq!(hw["p"], r"C:\Users\<user>\Documents");
        assert_eq!(hw["t"], "Admin panel");
    }

    fn plan_sources(name: &str, guid: &str) -> [Value; 6] {
        [
            json!({}),
            json!([{ "id": "r", "title": "Gaming Mode", "detail": "Gaming Mode tweaks" }]),
            json!([{ "id": "h", "rec_id": "high-performance-plan", "applied_plan": { "guid": guid, "name": name },
                    "restores_label": format!("Switches back to {name}") }]),
            json!({ "checks": [{ "id": "power-profile", "value": name, "detail": format!("Active plan \"{name}\". Ok.") }] }),
            json!([]),
            json!([{ "name": "Power", "entries": [{ "label": "Active power plan", "value": name }] }]),
        ]
    }

    #[test]
    fn a_plan_name_windows_or_compy_gave_keeps_its_name_even_with_a_guid_windows_does_not_ship() {
        let guid = "aaaaaaaa-1111-2222-3333-444444444444";
        let env = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "Ultimate Performance".into(), guid: guid.into() }) };
        let mut s = plan_sources("Ultimate Performance", guid);
        let r = redact_export_sources(s.each_mut(), &env);
        let text = all_text(&s);
        assert!(text.matches("ultimate performance").count() >= 5, "{text}");
        assert!(!text.contains(guid) && text.contains("custom-plan-1"), "the guid is still labelled: {text}");
        assert!(!text.contains("a custom power plan") && r.power_plan_names == 0);
        // A name that is not Windows' own but reads as a known class (by `power_plan_of`) is kept too.
        let env = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "My Ultimate Rig".into(), guid: guid.into() }) };
        let mut k = plan_sources("My Ultimate Rig", guid);
        let r = redact_export_sources(k.each_mut(), &env);
        assert!(all_text(&k).matches("my ultimate rig").count() >= 5 && r.power_plan_names == 0);
        // No plan read: a name that is stock is kept.
        let mut b = plan_sources("Balanced", "381b4222-f694-41f0-9685-ff5bb260df2e");
        let r = redact_export_sources(b.each_mut(), &ExportEnv::default());
        assert!(all_text(&b).matches("balanced").count() >= 5 && r.power_plan_names == 0);
    }

    #[test]
    fn a_custom_plan_name_is_replaced_in_plan_fields_only() {
        let guid = "bbbbbbbb-1111-2222-3333-444444444444";
        let env = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "Gaming".into(), guid: guid.into() }) };
        let mut s = plan_sources("Gaming", guid);
        let r = redact_export_sources(s.each_mut(), &env);
        assert_eq!(s[1][0]["title"], "Gaming Mode");
        assert_eq!(s[1][0]["detail"], "Gaming Mode tweaks");
        assert_eq!(s[2][0]["applied_plan"]["name"], CUSTOM_PLAN);
        assert_eq!(s[2][0]["restores_label"], format!("Switches back to {CUSTOM_PLAN}"));
        assert_eq!(s[3]["checks"][0]["value"], CUSTOM_PLAN);
        assert_eq!(s[3]["checks"][0]["detail"], format!("Active plan \"{CUSTOM_PLAN}\". Ok."));
        assert_eq!(s[5][0]["entries"][0]["value"], CUSTOM_PLAN);
        assert_eq!(r.power_plan_names, 5);
    }

    #[test]
    fn export_report_is_one_call_to_build_export_and_build_export_redacts_first() {
        let src = include_str!("export.rs").replace("\r\n", "\n");
        let report = &src[src.find("pub(crate) fn export_report(").unwrap()..src.find("pub(crate) fn open_export_folder").unwrap()];
        for direct in ["build_markdown_report(", "build_consumer_report(", "build_discord_block(", "redact_export_sources("] {
            assert!(!report.contains(direct), "export_report must not compose a shape itself ({direct}); use build_export");
        }
        assert!(report.contains("build_export(") && report.contains("display_location(&md_path)"));
        let build = &src[src.find("pub(crate) fn build_export(").unwrap()..src.find("pub(crate) fn export_report(").unwrap()];
        let at = |needle: &str| build.find(needle).unwrap_or_else(|| panic!("build_export must contain {needle}"));
        let redact = at("redact_export_sources(");
        for later in ["build_consumer_report(", "build_markdown_report(", "build_discord_block(", "redaction.note()", "\"redaction\": redaction.to_json()"] {
            assert!(redact < at(later), "redact before {later}");
        }
    }
}
