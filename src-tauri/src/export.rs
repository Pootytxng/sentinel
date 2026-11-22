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
    /// Distinct Trust Ledger row ids replaced by "change N". A row id is "<rec id>-<millis>", and the rec id of
    /// a startup entry carries the typed entry name, so every row id is numbered, not only those.
    change_ids: u32,
    /// Occurrences of this PC's user, profile-folder, computer or domain name replaced anywhere.
    identity_names: u32,
    /// Places where this PC's computer or user name, being scoped ([`is_scoped_name`]: short, a common word or an
    /// ordinary word of Compy's own text), was left in free text (it is replaced only in paths and name fields).
    ordinary_word_names_left: u32,
    /// `C:\Users\<name>\` segments rewritten to `C:\Users\<user>\`.
    user_name_segments: u32,
    /// `OneDrive - <company>` folder names rewritten to `OneDrive - <organization>`.
    onedrive_organizations: u32,
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
    /// This machine: the support-evidence literals (USERNAME, USERDOMAIN, COMPUTERNAME), the profile folder's
    /// own name; and the active power plan.
    pub(crate) fn this_machine() -> Self {
        // data-root-allow: reads only the profile folder's NAME, to scrub it from the exported text;
        // no path is composed from it and nothing is read, written or opened.
        let leaf = std::env::var("USERPROFILE").ok().and_then(|p| std::path::Path::new(&p).file_name()?.to_str().map(str::to_owned));
        // Read here, not through `support_evidence::sensitive_literals`, which drops names under three
        // characters: a short name is applied by the paths-only rule ([`is_scoped_name`]), never dropped.
        let raw = [("USERNAME", "<user>"), ("USERDOMAIN", "<host>"), ("COMPUTERNAME", "<host>")]
            .into_iter()
            .filter_map(|(var, mask)| std::env::var(var).ok().map(|v| (v, mask)))
            .collect();
        let literals = usable_literals(raw, leaf);
        let active_plan = crate::current_power_scheme().map(|p| ActivePlan { name: p.name, guid: p.guid });
        Self { literals, active_plan }
    }
}

/// PURE: the identity literals the export applies: every non-empty name, plus the profile folder's own name
/// when it is a different name. None is dropped (a short or common name is no less personal); how each is
/// applied is [`is_scoped_name`]'s decision.
fn usable_literals(mut raw: Vec<(String, &'static str)>, profile_leaf: Option<String>) -> Vec<(String, &'static str)> {
    if let Some(leaf) = profile_leaf {
        if !raw.iter().any(|(v, _)| v.eq_ignore_ascii_case(&leaf)) {
            raw.push((leaf, "<user>"));
        }
    }
    raw.retain(|(v, _)| !v.trim().is_empty());
    raw
}

/// The words of Compy's own static text that can reach an export: every alphabetic word of three or more
/// letters in a string literal of the non-test code of the files that write the report and its sources (the
/// export, readiness, hardware, diagnostics, recommendations, Trust Ledger, Drift Watch, sessions and stutter
/// files) and in the embedded rules file, lower-case, one per line, sorted. The list is the checked-in file
/// `export_words.txt`, GENERATED from those sources: the `export_words_guard` test regenerates it and fails,
/// naming the command to run, when a label changed and the file did not (so a new label joins by itself, and
/// no source text is compiled into the program). Text Windows supplies (a device or adapter name) is not in
/// it; see [`is_scoped_name`].
fn export_text_words() -> &'static HashSet<String> {
    static WORDS: std::sync::OnceLock<HashSet<String>> = std::sync::OnceLock::new();
    WORDS.get_or_init(|| include_str!("export_words.txt").lines().map(str::trim).filter(|w| !w.is_empty()).map(str::to_owned).collect()) // data-root-allow: compiled into the program, not a file Compy writes.
}

/// A name that is a single ordinary word: all letters, and a word of Compy's own static export text
/// ([`export_text_words`]).
fn is_ordinary_word(name: &str) -> bool {
    !name.is_empty() && name.chars().all(char::is_alphabetic) && {
        let w = name.to_lowercase();
        !NOT_ORDINARY_WORDS.contains(&w.as_str()) && export_text_words().contains(&w)
    }
}

/// Words in the generated list that are NOT words of Compy's report prose, so a name spelled that way is
/// replaced everywhere: "sam" is there only as the monitor maker code "SAM" (hardware.rs, mapped to
/// "Samsung"), which never reaches report text on its own (D2 review r1 N5). "max", "will", "may" and
/// "major" are real words of Compy's text ("Max refresh rate"), so they stay ordinary words; the guard
/// `common_first_names_are_not_ordinary_words_so_a_pc_named_after_one_is_replaced_everywhere` pins them.
const NOT_ORDINARY_WORDS: [&str; 1] = ["sam"];

/// THE RULE for how this PC's own user or computer name is applied. A name is SCOPED when it is shorter than
/// three characters ([`long_enough`]), is on the [`COMMON_NAMES`] list, or is a single ordinary word
/// ([`is_ordinary_word`]): replacing it everywhere would corrupt the sentences around it ("Power saving",
/// "Ethernet adapter"), so it is replaced only in Windows file and network paths (next to a `\`, or a `/`
/// inside a path, see [`path_mask`]) and in the name fields ([`IDENTITY_KEYS`]), and left as it is elsewhere (counted).
/// Every other name (a digit, a hyphen, a dot, a space, or letters no Compy text uses: `DESKTOP-4F2K9Q`,
/// `john.smith`, `Zed Canary`) is replaced everywhere, at word boundaries.
fn is_scoped_name(name: &str) -> bool {
    !long_enough(name) || COMMON_NAMES.contains(&name.trim().to_lowercase().as_str()) || is_ordinary_word(name)
}

/// For each character of `sc`, whether it is inside a Windows or file-URL path, so that a `/` beside a scoped
/// name there counts as a path separator. A path starts at a drive (`C:\`, `C:/`; standing alone, so the "s:/"
/// of "https://" is not one), a UNC start (`\\` anywhere, or `//` that does not follow a letter, digit or
/// colon), or `file:`. It always ends at `" < > |` or a line break (a hard break). At a soft break (`,` `;`,
/// or `.` `:` `!` `?` followed by a space) it ends UNLESS a slash of a kind the path has already used comes
/// before the next hard break. So "C:/Games/Hello, big World/Max/save.dat", "C:/Games/Hello, World,
/// Again/Max/x" and "D:/Mr. J. Smith/Max/x" are each one path (D2 reviews r1 N1, r2 B1 and r3: a folder name
/// may hold commas, full stops and spaces), while in "x C:\a.txt; Power/Performance" the `;` ends the path, because no `\`
/// comes after it. The cost of that last case: a backslash path whose folder name holds a comma and whose
/// next separator is a `/` ("C:\Games\Hello, World/Max/x") ends at the comma, and a scoped name after it is
/// left as it is; mixed separators after a comma cannot be told apart from a `/` in the prose after a path.
/// The other way, a forward-slash path followed by prose that has a `/` anywhere before the next line break,
/// quote or `< > |` ("C:/x/a.txt. More words, then Power/Performance") keeps going, which can replace a word
/// of that prose. In "reach //RIG/share" the `/` is a separator (a UNC start in the middle of a sentence), and
/// in "C:/Program Files (x86)/Max/x" it still is (a space or a bracket alone does not end a path). Decided per
/// position, not per string. Linear: the next `/`, `\` and hard break after each position are worked out in
/// one backward pass.
fn path_mask(sc: &[char]) -> Vec<bool> {
    let n = sc.len();
    let alnum = |j: usize| sc[j].is_ascii_alphanumeric();
    let is_hard = |k: usize| matches!(sc[k], '"' | '<' | '>' | '|' | '\n' | '\r');
    let is_soft = |k: usize| matches!(sc[k], ';' | ',') || (matches!(sc[k], '.' | ':' | '!' | '?') && sc.get(k + 1).is_some_and(|c| c.is_whitespace()));
    // next_*[k]: the first position at or after k holding that thing, or n.
    let (mut next_fwd, mut next_back, mut next_hard) = (vec![n; n + 1], vec![n; n + 1], vec![n; n + 1]);
    for k in (0..n).rev() {
        next_fwd[k] = if sc[k] == '/' { k } else { next_fwd[k + 1] };
        next_back[k] = if sc[k] == '\\' { k } else { next_back[k + 1] };
        next_hard[k] = if is_hard(k) { k } else { next_hard[k + 1] };
    }
    let (mut inside, mut uses_fwd, mut uses_back) = (false, false, false);
    let mut mask = Vec::with_capacity(n);
    for j in 0..n {
        let c = sc[j];
        let next = |k: usize| sc.get(j + k).copied();
        let hard = is_hard(j);
        let soft = is_soft(j);
        let drive = c.is_ascii_alphabetic() && next(1) == Some(':') && matches!(next(2), Some('\\' | '/')) && (j == 0 || !alnum(j - 1));
        let unc_back = c == '\\' && next(1) == Some('\\');
        let unc_fwd = c == '/' && next(1) == Some('/') && (j == 0 || !(alnum(j - 1) || sc[j - 1] == ':'));
        let file = j + 5 <= n && sc[j..j + 5].iter().zip("file:".chars()).all(|(a, b)| a.to_ascii_lowercase() == b);
        // A slash of a kind this path has used comes before the next hard break (review r3: not the next soft
        // break, or a folder name with two commas or full stops, "Hello, World, Again", ends the path early).
        let goes_on = || {
            let stop = next_hard[j + 1];
            (uses_fwd && next_fwd[j + 1] < stop) || (uses_back && next_back[j + 1] < stop)
        };
        if hard || (soft && inside && !goes_on()) {
            (inside, uses_fwd, uses_back) = (false, false, false);
        } else if drive || unc_back || unc_fwd || file {
            inside = true;
            uses_fwd |= unc_fwd || file || (drive && next(2) == Some('/'));
            uses_back |= unc_back || (drive && next(2) == Some('\\'));
        } else if inside {
            uses_fwd |= c == '/';
            uses_back |= c == '\\';
        }
        mask.push(inside);
    }
    mask
}

/// Object keys that hold this PC's own computer, domain or account name as the whole value.
const IDENTITY_KEYS: [&str; 6] = ["hostname", "computer_name", "machine_name", "domain", "user_name", "username"];

/// In place: a [`is_scoped_name`] `name` replaced in the name fields (the whole value) and where a path
/// separator touches it; `n` counts what was replaced, `left` the plain matches that were kept.
fn replace_ordinary_name(v: &mut Value, name: &str, to: &str, n: &mut u32, left: &mut u32) {
    match v {
        Value::String(s) => *s = replace_name_scoped(s, name, to, n, Some(left)),
        Value::Array(a) => a.iter_mut().for_each(|x| replace_ordinary_name(x, name, to, n, left)),
        Value::Object(o) => {
            for (k, x) in o.iter_mut() {
                match x {
                    Value::String(s) if IDENTITY_KEYS.contains(&k.as_str()) && s.trim().eq_ignore_ascii_case(name) => {
                        *s = to.to_string();
                        *n += 1;
                    }
                    other => replace_ordinary_name(other, name, to, n, left),
                }
            }
        }
        _ => {}
    }
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
    replace_name_scoped(s, name, to, count, None)
}

/// [`replace_name`], or, with `left` given, the paths-only form for a [`is_scoped_name`] name (any length): a
/// match is replaced only when a path separator touches it (`\\HOST\share`, `C:\Games\Name\x`, or a `/` that
/// [`path_mask`] places inside a path); every other word-boundary match is kept and counted in `left`.
fn replace_name_scoped(s: &str, name: &str, to: &str, count: &mut u32, mut left: Option<&mut u32>) -> String {
    if left.is_none() && !long_enough(name) {
        if s.eq_ignore_ascii_case(name) {
            *count += 1;
            return to.to_string();
        }
        return s.to_string();
    }
    let (sc, nc): (Vec<char>, Vec<char>) = (s.chars().collect(), name.chars().collect());
    let same = |a: char, b: char| a == b || a.to_lowercase().eq(b.to_lowercase());
    if nc.is_empty() {
        return s.to_string();
    }
    // A `/` is a separator only inside a path (per position, see path_mask); `\` always is.
    let mask = if left.is_some() && sc.contains(&'/') { path_mask(&sc) } else { Vec::new() };
    let sep = |k: usize| sc[k] == '\\' || (sc[k] == '/' && mask.get(k).copied().unwrap_or(false));
    let (head, tail) = (nc[0].is_ascii_alphanumeric(), nc[nc.len() - 1].is_ascii_alphanumeric());
    let (mut out, mut i) = (String::with_capacity(s.len()), 0usize);
    while i < sc.len() {
        let end = i + nc.len();
        if end <= sc.len() && (0..nc.len()).all(|k| same(sc[i + k], nc[k])) {
            let before = !(head && i > 0 && sc[i - 1].is_ascii_alphanumeric());
            let after = !(tail && end < sc.len() && sc[end].is_ascii_alphanumeric());
            if before && after {
                let in_path = left.is_none() || (i > 0 && sep(i - 1)) || (end < sc.len() && sep(end));
                if in_path {
                    out.push_str(to);
                    *count += 1;
                } else {
                    if let Some(l) = left.as_deref_mut() {
                        *l += 1;
                    }
                    out.extend(&sc[i..end]);
                }
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
            "custom_ids_replaced": self.ids.iter().filter(|k| !k.starts_with("adapter:")).count(),
            "adapter_names_replaced": self.ids.iter().filter(|k| k.starts_with("adapter:")).count(),
            "change_ids_replaced": self.change_ids,
            "game_state_fields_dropped": self.game_state_fields_dropped,
            "identity_names_replaced": self.identity_names,
            "ordinary_word_names_left_in_text": self.ordinary_word_names_left,
            "user_name_segments_replaced": self.user_name_segments,
            "onedrive_organizations_replaced": self.onedrive_organizations,
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
        let adapters = self.ids.iter().filter(|k| k.starts_with("adapter:")).count() as u32;
        let ids = self.ids.len() as u32 - adapters;
        if ids > 0 {
            push(format!("{ids} custom power-plan or network-interface ID{} replaced with numbered labels.", s(ids)));
        }
        if adapters > 0 {
            push(format!("{adapters} network adapter name{} in the Trust Ledger (a name Windows lets you change) replaced with \"adapter-1\", \"adapter-2\" and so on.", s(adapters)));
        }
        if self.change_ids > 0 {
            push(format!("{} Trust Ledger change ID{} replaced with \"change 1\", \"change 2\" and so on.", self.change_ids, s(self.change_ids)));
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
        if self.ordinary_word_names_left > 0 {
            let n = self.ordinary_word_names_left;
            push(format!("Your Windows user name or computer name can also be an ordinary word, so it was replaced only in Windows file and network paths and in name fields, and left as it is in {n} other place{}.", s(n)));
        }
        if self.onedrive_organizations > 0 {
            let n = self.onedrive_organizations;
            push(format!("A company name in a OneDrive folder name was replaced with \"organization\" in {n} place{}.", s(n)));
        }
        push(if self.user_name_segments == 0 {
            "No other account's name was found in a file path.".to_string()
        } else {
            format!("Another account's name was removed from {} place{} in file paths.", self.user_name_segments, s(self.user_name_segments))
        });
        push("Kept as they are: game program names, your typed note, and the hardware and network adapter names in the hardware list.".to_string());
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
/// one's name and are left alone (decided: `C:\Users\Public` and `C:\Users\Default` are shared profiles,
/// not people, so they stay as they are). This PC's own name is already gone by now (matched exactly, spaces
/// and all, by the identity pass), so this reads OTHER accounts' names, whose shape is not known:
/// - the name ends at a path separator, a quote (straight or curly), `< > | * ? CR LF`, or a closing
///   bracket, comma, semicolon, or a period or colon followed by a space or the end;
/// - a spaced name before one of the soft ends (bracket, comma, semicolon, period, colon) is taken whole when
///   it is at most [`NAME_CAP`] characters (a Windows account name has at most 20; a profile folder adds a
///   domain suffix at most), so "C:\Users\Mary Ann Van Der Berg, then" loses all of it; a longer run is cut
///   at the first space (prose, not a name);
/// - when the path begins the value (nothing but the path before it), a name with no end mark runs to the end
///   of the value, if that is within [`VALUE_NAME_CAP`] characters;
/// - otherwise (a path inside a sentence, no end mark) the name ends at the first space;
/// - the period or colon that ended the name is kept; an apostrophe inside a name ("O'Brien") belongs to it.
fn scrub_user_paths(s: &str, count: &mut u32) -> String {
    const KEEP: [&str; 4] = ["public", "default", "default user", "all users"];
    let b = s.as_bytes();
    let is_sep = |c: u8| c == b'\\' || c == b'/';
    let (mut out, mut last, mut i) = (String::new(), 0usize, 0usize);
    let first_space = first_space_after_lead(s);
    while i + 7 <= b.len() {
        if is_sep(b[i]) && b[i + 1..i + 6].eq_ignore_ascii_case(b"users") && is_sep(b[i + 6]) {
            let mut start = i + 7;
            while start < b.len() && is_sep(b[start]) {
                start += 1;
            }
            let rest = &s[start..];
            // The path begins the value: only a path token (no space) stands before it.
            let value_initial = first_space >= i;
            let name_len = name_span(rest, value_initial);
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

/// PURE: the byte offset of the first whitespace after the leading whitespace of `s` (`s.len()` when there is
/// none). Computed once per string, so a match at `i` is "value-initial" when this offset is not before `i`
/// (no rescan of the text before every match: a long space-less string stays linear).
fn first_space_after_lead(s: &str) -> usize {
    let lead = s.len() - s.trim_start().len();
    s[lead..].find(char::is_whitespace).map_or(s.len(), |p| p + lead)
}

/// Longest spaced run taken as one name before a soft end (see [`scrub_user_paths`]).
const NAME_CAP: usize = 32;
/// Longest run taken as one name when it is the end of a value that begins with the path.
const VALUE_NAME_CAP: usize = 48;

/// PURE: the byte length of the account or organization name at the start of `rest` (the text after
/// `\Users\` or `OneDrive - `), by the rules in [`scrub_user_paths`]. Never includes the end mark.
fn name_span(rest: &str, value_initial: bool) -> usize {
    let hard = |c: char| matches!(c, '\\' | '/' | '"' | '<' | '>' | '|' | '*' | '?' | '\n' | '\r' | '\u{201c}' | '\u{201d}' | '\u{2018}');
    let apostrophe = |c: char| c == '\'' || c == '\u{2019}';
    let mut stop: Option<(usize, bool)> = None; // (byte offset, soft)
    for (at, c) in rest.char_indices() {
        let next = rest[at + c.len_utf8()..].chars().next();
        if hard(c) || (apostrophe(c) && !next.is_some_and(char::is_alphanumeric)) {
            stop = Some((at, false));
            break;
        }
        // An apostrophe inside a name ("O'Brien") is part of it.
        let sentence_end = matches!(c, '.' | ':') && !next.is_some_and(|n| !n.is_whitespace());
        if matches!(c, ')' | ',' | ';' | ']' | '}') || sentence_end {
            stop = Some((at, true));
            break;
        }
    }
    let first_space = |span: &str| span.find(char::is_whitespace).unwrap_or(span.len());
    let len = match stop {
        Some((e, false)) => e,
        Some((e, true)) if rest[..e].chars().count() <= NAME_CAP => e,
        Some((e, true)) => first_space(&rest[..e]),
        None if value_initial && rest.trim_end().chars().count() <= VALUE_NAME_CAP => rest.trim_end().len(),
        None => first_space(rest),
    };
    rest[..len].trim_end_matches(|c: char| c.is_whitespace() || c == '.' || c == ':').len()
}

/// PURE: `OneDrive - <company>` folder names (after a `\` or `/`) with the company replaced by
/// `<organization>`; `OneDrive - Personal` names no company and stays. The company ends where
/// [`name_span`] ends a name. `count` is the number replaced.
fn scrub_onedrive_org(s: &str, count: &mut u32) -> String {
    const LEAD: &str = "onedrive - ";
    let lower = s.to_ascii_lowercase();
    let (mut out, mut last, mut from) = (String::new(), 0usize, 0usize);
    let first_space = first_space_after_lead(s);
    while let Some(at) = lower[from..].find(LEAD).map(|p| p + from) {
        from = at + LEAD.len();
        let after_sep = at > 0 && matches!(s.as_bytes()[at - 1], b'\\' | b'/');
        if !after_sep {
            continue;
        }
        let rest = &s[from..];
        let value_initial = first_space >= at;
        let len = name_span(rest, value_initial);
        let org = &rest[..len];
        if org.trim().is_empty() || org.eq_ignore_ascii_case("personal") || org == "<organization>" {
            continue;
        }
        out.push_str(&s[last..from]);
        out.push_str("<organization>");
        last = from + len;
        from = last;
        *count += 1;
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
                    // `prior_plan_guid`: the key of a power-plan undo record written before typed snapshots
                    // (actions::synthesize_legacy_rollback); D2 review r1, found while checking N2.
                    let plan_key = matches!(k.as_str(), "power_plan_guid" | "prior_guid" | "prior_plan_guid" | "plan_guid" | "guid");
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

/// In place: every `adapter_name` string value becomes its numbered label ([`ExportRedaction::id_label`],
/// kind "adapter"); keys and every other value stay.
fn number_adapter_names(v: &mut Value, r: &mut ExportRedaction) {
    match v {
        Value::Object(o) => {
            for (k, x) in o.iter_mut() {
                match x {
                    Value::String(s) if k == "adapter_name" && !s.trim().is_empty() => *s = r.id_label("adapter", s),
                    other => number_adapter_names(other, r),
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| number_adapter_names(x, r)),
        _ => {}
    }
}

/// The fields of a plan row (readiness check, Drift Watch row, diagnostics entry) that hold a plan's name.
const PLAN_VALUE_KEYS: [&str; 3] = ["value", "value_now", "last_ready_value"];

/// Names of power plans that are not stock, from the places a plan name sits next to its identity: the
/// diagnostics "Active power plan" row, the readiness power-profile row and any object that holds both a
/// plan GUID and a name. A name is kept only by [`keeps_plan_name`]; the active plan keeps its name when its
/// GUID is stock or its name is a stock name.
fn custom_plan_names(sources: &[&Value], active: Option<&ActivePlan>) -> Vec<String> {
    fn walk(v: &Value, keyed: &mut Vec<String>, guided: &mut Vec<(String, String)>) {
        match v {
            Value::Object(o) => {
                let label = o.get("label").and_then(Value::as_str);
                let id = o.get("id").and_then(Value::as_str);
                if label == Some("Active power plan") || id == Some("power-profile") {
                    // `value` is the readiness row's; `value_now` and `last_ready_value` are the Drift Watch
                    // row's (what the plan reads now, and what it read when last ready: a plan no longer active).
                    for key in PLAN_VALUE_KEYS {
                        if let Some(n) = o.get(key).and_then(Value::as_str) {
                            keyed.push(n.to_string());
                        }
                    }
                }
                let guid = ["guid", "plan_guid", "prior_guid"].iter().find_map(|k| o.get(*k).and_then(Value::as_str));
                if let (Some(g), Some(n)) = (guid, o.get("name").and_then(Value::as_str)) {
                    guided.push((n.to_string(), g.to_string()));
                }
                o.values().for_each(|x| walk(x, keyed, guided));
            }
            Value::Array(a) => a.iter().for_each(|x| walk(x, keyed, guided)),
            _ => {}
        }
    }
    let (mut keyed, mut guided) = (Vec::new(), Vec::new());
    sources.iter().for_each(|v| walk(v, &mut keyed, &mut guided));
    // The active plan's name is kept when its GUID is one Windows ships (or its name is a stock name).
    let active_kept = active.filter(|a| keeps_plan_name(Some(&a.guid), &a.name)).map(|a| a.name.to_lowercase());
    let mut out: Vec<String> = keyed.into_iter().filter(|n| Some(n.to_lowercase()) != active_kept && !keeps_plan_name(None, n)).collect();
    out.extend(guided.into_iter().filter(|(n, g)| !keeps_plan_name(Some(g), n)).map(|(n, _)| n));
    if let Some(a) = active.filter(|a| !keeps_plan_name(Some(&a.guid), &a.name)) {
        out.push(a.name.clone());
    }
    out.retain(|n| !n.trim().is_empty() && !n.eq_ignore_ascii_case("unknown"));
    out.sort_by_key(|n| std::cmp::Reverse(n.len()));
    out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    out
}

/// THE STRICT RULE for a power-plan name that stays in the export. Exactly one of:
/// (a) its GUID is one of the four Windows ships ([`is_stock_plan`]);
/// (b) the name equals, whole and ignoring case, one of the four stock names.
/// Nothing else: a name that merely contains "Ultimate" or "High performance" ("Canary Ultimate Rig") is a
/// name the user typed and is replaced. This is not `power_plan_of`, which classes by substring for another
/// purpose and is left as it is.
/// D2 (review e2-r2 F1): there used to be a third rule, "the GUID is an Ultimate copy Compy recorded
/// activating", which kept ANY name of that copy, so a copy the user had since renamed ("<name>'s rig") was
/// exported with its typed name. The ledger records the copy's GUID, not its name, so the export cannot tell a
/// renamed copy from a localized one. It errs toward hiding: Compy's copy keeps its name when the name is the
/// English stock name (b), and a localized or renamed copy reads "a custom power plan".
fn keeps_plan_name(guid: Option<&str>, name: &str) -> bool {
    const STOCK_NAMES: [&str; 4] = ["balanced", "high performance", "power saver", "ultimate performance"];
    if guid.map(|g| g.trim().trim_matches(['{', '}'])).is_some_and(is_stock_plan) {
        return true;
    }
    STOCK_NAMES.contains(&name.trim().to_lowercase().as_str())
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
                    Value::String(s) if plan_row && PLAN_VALUE_KEYS.contains(&k.as_str()) => *s = swap(s.as_str(), false, n),
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
/// sessions (programs, game_state keys), QoS names, Trust Ledger row ids ("change N"), startup-entry names (their own ledger rows, plus the
/// exact `startup-entry:<name>` id elsewhere), custom plan names (plan fields only), per-install ids, this
/// PC's own names (longest first; a scoped name only in paths and name fields, see [`is_scoped_name`]), then
/// the user-name segment of any path, and last the company in `OneDrive - <company>`. A QoS policy name is
/// replaced wherever it appears (the hardware list and the readiness `network-qos` row).
pub(crate) fn redact_export_sources(sources: [&mut Value; 6], env: &ExportEnv) -> ExportRedaction {
    let mut r = ExportRedaction::default();
    let mut all = sources.into_iter().collect::<Vec<_>>();
    let sessions = &mut *all[4];
    *sessions = redact_session_rows(sessions.take(), &mut r);
    // QoS policy names are typed by the user (or an admin). Save the originals, number the hardware list, then
    // replace each original wherever else it is repeated (the readiness "network-qos" row's detail prints
    // them): longest first, so a name that contains another is not half-replaced, with the same number
    // everywhere.
    let mut qos_names: Vec<(usize, String)> = Vec::new();
    let mut qos_list: Option<(String, String)> = None; // the whole list as the readiness row prints it, and its labels
    if let Some(q) = all[0].get_mut("qos_policies").and_then(Value::as_array_mut) {
        r.qos_policy_names += q.len() as u32;
        let originals: Vec<(usize, String)> = q.iter().enumerate().filter_map(|(i, v)| v.as_str().map(|n| (i + 1, n.to_string()))).collect();
        if !originals.is_empty() {
            // Unfiltered and untrimmed: the row prints every entry exactly as typed.
            let joined = originals.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>().join(", ");
            let labels = originals.iter().map(|(i, _)| format!("QoS policy {i}")).collect::<Vec<_>>().join(", ");
            qos_list = Some((joined, labels));
        }
        qos_names = originals.into_iter().filter(|(_, n)| !n.trim().is_empty()).collect();
        *q = (1..=q.len()).map(|i| json!(format!("QoS policy {i}"))).collect();
    }
    // The readiness row prints the list as "(a, b)". The whole parenthesised list goes first, so a policy
    // name too short for the free-text rule (one or two letters) is covered inside that row too, and the
    // row reads like the hardware list ("(QoS policy 1, QoS policy 2)").
    if let Some((joined, labels)) = &qos_list {
        let (from, to) = (format!("({joined})"), format!("({labels})"));
        all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, &from, &to, &mut 0)));
    }
    qos_names.sort_by_key(|(_, n)| std::cmp::Reverse(n.chars().count()));
    for (number, name) in &qos_names {
        let label = format!("QoS policy {number}");
        let name = name.trim();
        all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, name, &label, &mut 0)));
    }
    // Trust Ledger row ids ("<rec id>-<millis>") carry the rec id, which for a startup entry is the typed
    // entry name: number every row id ("change 1", in ledger order) and follow it wherever else the id
    // is repeated. Trial ids ("exp:<n>-<millis>") are a counter and a clock, no name: kept as they are.
    let mut change_ids: Vec<String> = Vec::new();
    for id in all[2].as_array().into_iter().flatten().filter_map(|row| row.get("id").and_then(Value::as_str)).filter(|id| !id.is_empty()) {
        if !change_ids.iter().any(|x| x == id) {
            change_ids.push(id.to_string());
        }
    }
    for (i, old) in change_ids.iter().enumerate() {
        let label = format!("change {}", i + 1);
        for row in all[2].as_array_mut().into_iter().flatten().filter(|row| row.get("id").and_then(Value::as_str) == Some(old.as_str())) {
            row["id"] = Value::String(label.clone());
        }
        if long_enough(old) {
            all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, old, &label, &mut 0)));
        }
    }
    r.change_ids = change_ids.len() as u32;
    // Startup entries: shared "other program N" numbering; a listed program keeps its name.
    for name in startup_entry_names(&*all[2]) {
        if crate::running_at_start::lookup(&name).is_some() || crate::running_at_start::lookup(&format!("{name}.exe")).is_some() {
            continue;
        }
        let ph = r.placeholder(&name);
        let mut n = 0;
        // The rows' own titles ("Disable startup entry: <name>") are repeated verbatim outside the ledger: the
        // readiness applied-changes row (`detail`, `drifted_titles`) and the Drift Watch row (`titles`). The
        // title is replaced as a whole wherever it stands, so a name too short for the free-text rule is
        // covered there too (the title is "<verb> startup entry: <name>", a shape this code knows).
        let titles: Vec<(String, String)> = all[2]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|row| row_startup_names(row).iter().any(|x| x.eq_ignore_ascii_case(&name)))
            .filter_map(|row| row.get("rec_title").and_then(Value::as_str))
            .map(|t| {
                let suffix = format!(": {name}");
                let new = match t.len().checked_sub(suffix.len()).filter(|&at| t.is_char_boundary(at) && t[at..].eq_ignore_ascii_case(&suffix)) {
                    Some(at) => format!("{}: {ph}", &t[..at]),
                    None => replace_name(t, &name, &ph, &mut 0),
                };
                (t.to_string(), new)
            })
            .filter(|(old, new)| old != new)
            .collect();
        // Only the Trust Ledger rows that hold this entry carry its name in free text; everywhere else only
        // the exact id "startup-entry:<name>" is replaced, so "Steam" in a game-library note stays.
        if let Some(rows) = all[2].as_array_mut() {
            for row in rows.iter_mut().filter(|row| row_startup_names(row).iter().any(|x| x.eq_ignore_ascii_case(&name))) {
                map_strings(row, &mut |s| replace_name(s, &name, &ph, &mut n));
            }
        }
        for (old, new) in &titles {
            all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, old, new, &mut n)));
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
    // D2 (review e2-r2 F6): a network adapter's Windows name ("Ethernet", or whatever the user renamed it to)
    // sits in a Trust Ledger snapshot as `adapter_name` (the Energy-Efficient Ethernet undo record). The
    // hardware list names an adapter by its model (hardware.rs detect_network_adapters: the interface
    // description, and the Windows name only when no description can be read), so the ledger is where this name
    // reliably reaches the export: the whole value becomes "adapter-1", "adapter-2" (the same name the same
    // number), and the name is not searched for in free text, where a default name like "Ethernet" is an
    // ordinary word.
    all.iter_mut().for_each(|v| number_adapter_names(v, &mut r));
    // Longest first, so a name that contains another ("Mary Ann" and "Mary") is not half-replaced.
    let mut literals: Vec<&(String, &'static str)> = env.literals.iter().filter(|(v, _)| !v.trim().is_empty()).collect();
    literals.sort_by_key(|(v, _)| (std::cmp::Reverse(v.chars().count()), v.to_lowercase()));
    // The user domain is often the computer name: apply (and count) each name once.
    literals.dedup_by(|a, b| a.0.eq_ignore_ascii_case(&b.0));
    for (value, mask) in literals {
        let mut n = 0;
        if is_scoped_name(value) {
            // A short name, a common word or an ordinary word of Compy's own text: only in paths and name
            // fields, never in free text.
            let mut left = 0;
            all.iter_mut().for_each(|v| replace_ordinary_name(v, value, mask, &mut n, &mut left));
            r.ordinary_word_names_left += left;
        } else {
            all.iter_mut().for_each(|v| map_strings(v, &mut |s| replace_name(s, value, mask, &mut n)));
        }
        r.identity_names += n;
    }
    let mut paths = 0;
    all.iter_mut().for_each(|v| map_strings(v, &mut |s| scrub_user_paths(s, &mut paths)));
    r.user_name_segments = paths;
    let mut orgs = 0;
    all.iter_mut().for_each(|v| map_strings(v, &mut |s| scrub_onedrive_org(s, &mut orgs)));
    r.onedrive_organizations = orgs;
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
    crate::sys_exe::sys_command(crate::sys_exe::SysTool::Explorer)
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
    const C_USER: &str = "CanaryZorvakName";
    const C_PROFILE: &str = "CanaryProfileDir";
    const C_HOST: &str = "CANARYHOSTPC";
    const C_SPACED: &str = "Zed Canaryspaced";
    const C_PLAN: &str = "CanaryPlanName";
    const C_PLAN_GUID: &str = "11111111-2222-3333-4444-555555555555";
    const C_IFACE: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const C_FUTURE: &str = "FutureCanaryField";
    // D2 review r1: a user-renamed adapter in the EEE undo record, and a custom plan GUID in a pre-typed
    // power-plan undo record (`prior_plan_guid`).
    const C_ADAPTER: &str = "CanaryRenamedNic";
    const C_LEGACY_GUID: &str = "22222222-3333-4444-5555-666666666666";
    const ALL_CANARIES: [&str; 14] = [
        "taxprep2026canary", "signalcanary", "startupcanaryapp", "qoscanarypolicy", "canaryzorvakname", "canaryprofiledir",
        "canaryhostpc", "canaryspaced", "canaryplanname", "11111111-2222-3333-4444-555555555555",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "futurecanaryfield", "canaryrenamednic", "22222222-3333-4444-5555-666666666666",
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
                { "id": "h4", "rec_id": "q", "rec_title": "Q", "restores_label": format!("run \"C:\\Users\\{C_SPACED}\\x.exe\" then (C:\\Users\\OtherAcct), done") },
                { "id": "h5", "rec_id": "eee-disable", "rec_title": "Turn off Energy Efficient Ethernet",
                  "snapshot": serde_json::to_value(crate::actions::Snapshot::EeeNicProperty { adapters: vec![crate::actions::EeeNicSnapshot {
                      adapter_name: C_ADAPTER.into(), property_display_name: "Energy Efficient Ethernet".into(), prior_value: "Enabled".into() }] }).unwrap() },
                { "id": "h6", "rec_id": "power-ultimate", "rec_title": "Ultimate Performance plan", "snapshot": { "prior_plan_guid": C_LEGACY_GUID } }
            ]),
            json!({ "checks": [
                { "id": "power-profile", "title": "Power profile", "value": C_PLAN, "detail": format!("Active plan \"{C_PLAN}\". A performance plan can reduce latency.") },
                { "id": "c1", "detail": format!(r"\\srv\share\Users\{C_USER}\Games") },
                { "id": "c2", "detail": format!(r"C:\\Users\\{C_USER}\\escaped") },
                // The readiness row prints the typed QoS policy names (readiness.rs): same text as the live row.
                { "id": "network-qos", "label": "Network QoS policy", "status": "advisory", "value": "2 QoS policies",
                  "detail": format!("Windows QoS traffic-priority policies are active ({C_QOS}, {C_QOS} two). These shape which apps get network priority.") }
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
        assert_eq!(n("custom_ids_replaced"), 3, "one custom plan guid (3 places), one interface, one pre-typed prior_plan_guid");
        assert_eq!(n("change_ids_replaced"), 6, "the six Trust Ledger rows");
        assert_eq!(n("game_state_fields_dropped"), 1, "future_field");
        assert_eq!(n("identity_names_replaced"), 7, "user x4 (path, UNC, escaped, note), profile x1, host x2 (hostname field, note)");
        assert_eq!(n("user_name_segments_replaced"), 2, "a quoted spaced name and a parenthesised one");
        assert_eq!(j["running_at_start_omitted"], true);
        let note = j["summary"].as_str().unwrap();
        assert!(note.starts_with("6 program names in game sessions and 5 startup-entry names not on Compy's known-programs list (4 programs in all) replaced"), "{note}");
        for part in ["2 QoS policy names replaced.", "A custom power plan name was replaced in 5 places.", "3 custom power-plan or network-interface IDs replaced", "1 network adapter name in the Trust Ledger (a name Windows lets you change) replaced", "6 Trust Ledger change IDs replaced with \"change 1\", \"change 2\" and so on.", "1 unrecognised game-state field left out.", "replaced in 7 places, file paths included.", "Another account's name was removed from 2 places in file paths.", "Kept as they are: game program names, your typed note, and the hardware and network adapter names in the hardware list."] {
            assert!(note.contains(part), "{part} missing from {note}");
        }
    }

    #[test]
    fn the_note_reads_right_at_zero_and_at_one() {
        assert_eq!(
            ExportRedaction::default().note(),
            "No program names needed replacing. No other account's name was found in a file path. Kept as they are: game program names, your typed note, and the hardware and network adapter names in the hardware list."
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
        let env = ExportEnv { literals: vec![("Zorvakname".into(), "<user>")], active_plan: None };
        let mut hw = json!({ "p": r"C:\Users\Zorvakname\AppData" });
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
        // A 2-character literal (user name) is never applied in free text: only in paths and name fields.
        let env = ExportEnv { literals: vec![("ab".into(), "<user>")], active_plan: None };
        let mut hw = json!({ "cpu_brand": "fabric lab and ab", "hostname": "AB", "p": r"C:\Games\ab\x" });
        let r = redact_export_sources([&mut hw, &mut a, &mut ledger, &mut rd, &mut s, &mut d], &env);
        assert_eq!(hw["cpu_brand"], "fabric lab and ab", "free text is untouched");
        assert_eq!(hw["hostname"], "<user>");
        assert_eq!(hw["p"], r"C:\Games\<user>\x");
        assert_eq!((r.identity_names, r.ordinary_word_names_left), (2, 1), "path and name field replaced; the plain 'ab' counted as left");
    }

    #[test]
    fn usable_literals_keep_every_name_and_add_the_profile_folder_and_the_rule_scopes_them() {
        let raw = vec![("Zorvak".to_string(), "<user>"), ("ab".to_string(), "<user>"), ("Admin".to_string(), "<user>"), ("PCNAME1".to_string(), "<host>"), (" ".to_string(), "<host>")];
        let out = usable_literals(raw, Some("ZorvakProfile".into()));
        let vals: Vec<&str> = out.iter().map(|(v, _)| v.as_str()).collect();
        assert_eq!(vals, ["Zorvak", "ab", "Admin", "PCNAME1", "ZorvakProfile"], "short and common names are no longer dropped; a blank one is");
        assert_eq!(usable_literals(vec![], Some("Zorvak".into())).len(), 1);
        assert!(usable_literals(vec![("zorvak".into(), "<user>")], Some("Zorvak".into())).len() == 1, "no duplicate of the same name");
        assert_eq!(usable_literals(vec![], Some("User".into())).len(), 1, "an ordinary word as the folder name is kept, and scoped");
        // Which names are scoped (paths and name fields only) and which are replaced everywhere.
        for scoped in ["ab", "Admin", "Power", "Ethernet", "Gaming"] {
            assert!(is_scoped_name(scoped), "{scoped} is scoped");
        }
        for everywhere in ["PCNAME1", "DESKTOP-4F2K9Q", "john.smith", "Zed Canaryspaced", "CanaryZorvakName", "Zorvak"] {
            assert!(!is_scoped_name(everywhere), "{everywhere} is replaced everywhere");
        }
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
    fn path_scrub_edge_cases_apostrophe_spaces_short_8_3_unc_slashes_escapes_drives_and_shared_profiles() {
        let cases: [(&str, &str); 19] = [
            // An apostrophe inside the name.
            (r"C:\Users\O'Brien\x", r"C:\Users\<user>\x"),
            (r"C:\Users\D'Angelo Smith\Docs", r"C:\Users\<user>\Docs"),
            (r"open 'C:\Users\O'Brien\x.txt' now", r"open 'C:\Users\<user>\x.txt' now"),
            (r"'C:\Users\john' failed", r"'C:\Users\<user>' failed"),
            (r"C:\Users\O'Brien", r"C:\Users\<user>"),
            // A name with spaces, then a comma, a closing quote or a closing bracket.
            (r"saw C:\Users\John Smith, then left", r"saw C:\Users\<user>, then left"),
            (r"(C:\Users\Mary Ann Smith) failed", r"(C:\Users\<user>) failed"),
            (r"[C:\Users\John Smith];", r"[C:\Users\<user>];"),
            (r#"{"p": "C:\Users\John Smith"}"#, r#"{"p": "C:\Users\<user>"}"#),
            (r"path 'C:\Users\John Smith' x", r"path 'C:\Users\<user>' x"),
            // 8.3 short name, UNC (with an admin share), forward slashes, another drive.
            (r"C:\Users\JOHNDO~1\AppData\Local", r"C:\Users\<user>\AppData\Local"),
            (r"\\server\share\Users\john\x", r"\\server\share\Users\<user>\x"),
            (r"\\server\c$\Users\John Smith\x", r"\\server\c$\Users\<user>\x"),
            ("C:/Users/john/Desktop", "C:/Users/<user>/Desktop"),
            (r"E:\Users\john\Games", r"E:\Users\<user>\Games"),
            ("D:/Users/John Smith/Games", "D:/Users/<user>/Games"),
            // Inside a JSON-escaped string (doubled, then quadrupled backslashes, escaped quotes).
            (r"C:\\Users\\john\\x", r"C:\\Users\\<user>\\x"),
            (r#"{\"p\":\"C:\\\\Users\\\\john\\\\x\"}"#, r#"{\"p\":\"C:\\\\Users\\\\<user>\\\\x\"}"#),
            (r#"\"C:\\Users\\John Smith\""#, r#"\"C:\\Users\\<user>\""#),
        ];
        for (input, want) in cases {
            let mut n = 0;
            assert_eq!(scrub_user_paths(input, &mut n), want, "{input}");
            assert_eq!(n, 1, "{input}");
        }
        // Shared profiles are not people: left as they are, in every spelling, and not counted.
        let mut n = 0;
        for shared in [r"C:\Users\Public\Documents", r"D:\Users\Public", r"c:\users\public\x", r"C:\Users\Default\NTUSER.DAT", r"C:\Users\Default User\x", r"C:\Users\All Users\Microsoft", "C:/Users/Public/x", r"\\srv\share\Users\Public\x"] {
            assert_eq!(scrub_user_paths(shared, &mut n), shared);
        }
        assert_eq!(n, 0);
    }

    #[test]
    fn a_ledger_row_id_that_carries_a_typed_name_becomes_change_n_and_references_follow() {
        // How a row id is built (history.rs build_applied_change_with): "<rec id>-<millis>", and the rec id of
        // a startup entry is "startup-entry:<typed name>". A Trial id is "exp:<count>-<millis>": no name.
        let (a, b, c) = (format!("startup-entry:{C_STARTUP}-1731000000001"), "high-performance-plan-1731000000002", "bloat-task:telemetry-1731000000003");
        let mut v = [
            json!({}),
            json!([]),
            json!([
                { "id": a, "rec_id": format!("startup-entry:{C_STARTUP}"), "rec_title": "t" },
                { "id": b, "rec_id": "high-performance-plan", "justified_by_experiment": { "experiment_id": "exp:3-1731000000009", "outcome": "recommended" } },
                { "id": c, "rec_id": "bloat-task:telemetry" },
                { "id": b, "rec_id": "high-performance-plan" }
            ]),
            json!({ "checks": [{ "id": "k", "detail": format!("Last change {a} and {b}.") }] }),
            json!([]),
            json!([]),
        ];
        let r = redact_export_sources(v.each_mut(), &ExportEnv::default());
        let ids: Vec<&str> = v[2].as_array().unwrap().iter().map(|row| row["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["change 1", "change 2", "change 3", "change 2"], "numbered in ledger order; the same id keeps its number");
        assert_eq!(v[3]["checks"][0]["detail"], "Last change change 1 and change 2.", "a reference follows its row");
        assert_eq!(v[2][1]["justified_by_experiment"]["experiment_id"], "exp:3-1731000000009", "a Trial id holds no name and stays");
        assert_eq!(r.change_ids, 3);
        assert!(!all_text(&v).contains("1731000000001") && !all_text(&v).contains(&C_STARTUP.to_lowercase()), "{}", all_text(&v));
        assert!(r.note().contains("3 Trust Ledger change IDs replaced"), "{}", r.note());
    }

    fn lone(sources: [Value; 6], env: &ExportEnv) -> ([Value; 6], ExportRedaction) {
        let mut s = sources;
        let r = redact_export_sources(s.each_mut(), env);
        (s, r)
    }

    #[test]
    fn a_plan_name_beside_a_guid_outside_a_ledger_row_is_redacted_when_custom_and_kept_when_stock() {
        // changed_outside.observed is { kind, guid, name } inside a Trust Ledger row; the same shape can sit
        // anywhere (a diagnostics entry), so it is tested in both places, with no active plan read.
        let custom = "cccccccc-1111-2222-3333-444444444444";
        let observed = |guid: &str, name: &str| json!({ "kind": "power-plan", "guid": guid, "name": name });
        let (s, r) = lone(
            [
                json!({}),
                json!([]),
                json!([
                    { "id": "row-one", "rec_id": "core-parking", "rec_title": "Core parking", "status": "applied",
                      "changed_outside": { "schema": 1, "recorded_at": "t", "observed": observed(custom, "Canary Rig Plan") } },
                    { "id": "row-two", "rec_id": "core-parking", "rec_title": "Core parking", "status": "applied",
                      "changed_outside": { "schema": 1, "recorded_at": "t", "observed": observed("381b4222-f694-41f0-9685-ff5bb260df2e", "Balanced") } }
                ]),
                json!({}),
                json!([]),
                json!([{ "name": "Power", "entries": [], "observed": observed(custom, "Canary Rig Plan") }]),
            ],
            &ExportEnv::default(),
        );
        let text = all_text(&s);
        assert!(!text.contains("canary rig plan") && !text.contains(custom), "{text}");
        assert_eq!(s[2][0]["changed_outside"]["observed"]["name"], CUSTOM_PLAN);
        assert_eq!(s[2][0]["changed_outside"]["observed"]["guid"], "custom-plan-1");
        assert_eq!(s[5][0]["observed"]["name"], CUSTOM_PLAN);
        assert_eq!(s[2][1]["changed_outside"]["observed"]["name"], "Balanced", "a stock plan keeps its name");
        assert_eq!(r.power_plan_names, 2);
    }

    #[test]
    fn a_name_that_is_an_ordinary_word_of_the_export_text_is_replaced_in_paths_and_name_fields_only() {
        let words = export_text_words();
        assert!(words.contains("hardware") && words.contains("sessions"), "the headings are in the set");
        assert!(!words.contains("canaryhostpc") && !words.contains("futurecanaryfield"), "test-only strings are not export text");
        assert!(is_ordinary_word("Hardware") && is_ordinary_word("SESSIONS"));
        assert!(!is_ordinary_word("Zorbakplex") && !is_ordinary_word("Hardware2") && !is_ordinary_word("Hard ware") && !is_ordinary_word(""));
        // A computer named "Hardware" (a heading of the report), not on the skip list.
        let env = ExportEnv { literals: vec![("Hardware".into(), "<host>")], active_plan: None };
        let (s, r) = lone(
            [
                json!({ "hostname": "HARDWARE", "cpu_brand": "Hardware and software", "unc": r"\\HARDWARE\share\x", "p": r"C:\Games\Hardware\x" }),
                json!([]),
                json!([]),
                json!({}),
                json!([]),
                json!([]),
            ],
            &env,
        );
        assert_eq!(s[0]["hostname"], "<host>", "the name field");
        assert_eq!(s[0]["cpu_brand"], "Hardware and software", "free text is not shredded");
        assert_eq!(s[0]["unc"], r"\\<host>\share\x");
        assert_eq!(s[0]["p"], r"C:\Games\<host>\x");
        assert_eq!((r.identity_names, r.ordinary_word_names_left), (3, 1));
        let note = r.note();
        assert!(note.contains("replaced in 3 places, file paths included."), "{note}");
        assert!(note.contains("can also be an ordinary word, so it was replaced only in Windows file and network paths and in name fields, and left as it is in 1 other place."), "{note}");
        // A name that is not an ordinary word is still replaced everywhere, and says nothing about words.
        let env = ExportEnv { literals: vec![("Zorbakplex".into(), "<host>")], active_plan: None };
        let (s, r) = lone([json!({ "x": "Zorbakplex rig" }), json!([]), json!([]), json!({}), json!([]), json!([])], &env);
        assert_eq!(s[0]["x"], "<host> rig");
        assert!(!r.note().contains("ordinary word"));
    }

    #[test]
    fn an_ordinary_word_computer_name_from_any_export_text_leaves_the_text_whole_and_a_coded_name_goes_everywhere() {
        // "Ethernet" is a word of the readiness and hardware text, not of export.rs alone: the widened set holds it.
        let words = export_text_words();
        for w in ["ethernet", "network", "adapter", "latency", "ultimate"] {
            assert!(words.contains(w), "{w} is static text somewhere in the export's sources");
        }
        let text = "Ethernet adapter is connected; wired Ethernet gives lower latency.";
        let env = ExportEnv { literals: vec![("Ethernet".into(), "<host>"), ("DESKTOP-4F2K9Q".into(), "<host>")], ..Default::default() };
        let (s, r) = lone(
            [
                json!({ "hostname": "Ethernet", "gpus": [], "n": "DESKTOP-4F2K9Q on Ethernet" }),
                json!([]),
                json!([]),
                json!({ "checks": [{ "id": "network-wired", "detail": text, "value": r"\\Ethernet\share" }] }),
                json!([]),
                json!([{ "name": "Network", "entries": [{ "label": "Adapter", "value": "Ethernet" }] }]),
            ],
            &env,
        );
        assert_eq!(s[3]["checks"][0]["detail"], text, "the readiness sentence is not corrupted");
        assert_eq!(s[3]["checks"][0]["value"], r"\\<host>\share", "a network path is replaced");
        assert_eq!(s[0]["hostname"], "<host>", "a name field is replaced");
        assert_eq!(s[0]["n"], "<host> on Ethernet", "the coded name goes everywhere; the plain word stays");
        assert_eq!(s[5][0]["entries"][0]["value"], "Ethernet", "an adapter name is hardware text, kept");
        assert_eq!(r.ordinary_word_names_left, 4, "two in the sentence, one in the n field, one adapter value: counted");
    }

    #[test]
    fn a_scoped_name_beside_a_forward_slash_is_replaced_only_in_a_path_and_a_unc_share_is_covered() {
        let env = ExportEnv { literals: vec![("Power".into(), "<host>"), ("ab".into(), "<user>"), ("Gaming".into(), "<user>")], ..Default::default() };
        let (s, r) = lone(
            [
                json!({
                    "unc": r"\\Power\share\x", "unc2": "//Power/share/x", "drive": "C:/Games/Gaming/save.dat", "two": r"C:\Users\ab\x",
                    "text": "Power/Performance and Gaming/Mode", "url": "https://Power/Gaming/x"
                }),
                json!([]), json!([]), json!({}), json!([]), json!([]),
            ],
            &env,
        );
        assert_eq!(s[0]["unc"], r"\\<host>\share\x", "computer named with a skip-list word, in a UNC path");
        assert_eq!(s[0]["unc2"], "//<host>/share/x");
        assert_eq!(s[0]["drive"], "C:/Games/<user>/save.dat", "a skip-list word beside a forward slash in a drive path");
        assert_eq!(s[0]["two"], r"C:\Users\<user>\x", "a two-letter user name in a path");
        assert_eq!(s[0]["text"], "Power/Performance and Gaming/Mode", "a slash in plain text is not a path");
        assert_eq!(s[0]["url"], "https://Power/Gaming/x", "a URL is not a Windows path");
        assert_eq!(r.identity_names, 4);
        assert_eq!(r.ordinary_word_names_left, 4, "Power and Gaming in the text, Power and Gaming in the URL");
    }

    #[test]
    fn a_computer_or_user_named_with_a_skip_list_word_never_corrupts_the_text() {
        let text = "Gaming Mode: Power saving on a Desktop PC, Guest account, Windows System";
        for name in ["GAMING", "Desktop", "Power", "Guest"] {
            let env = ExportEnv { literals: usable_literals(vec![(name.into(), "<host>")], None), active_plan: None };
            assert_eq!(env.literals.len(), 1, "{name} is on the skip list: kept, and applied by the paths-and-name-fields rule");
            let (s, r) = lone([json!({ "hostname": name, "note": text, "unc": format!(r"\\{name}\share") }), json!([]), json!([]), json!({}), json!([]), json!([])], &env);
            assert_eq!(s[0]["note"], text, "{name}");
            assert!(!s.iter().any(|v| v.to_string().contains("<host> saving")), "{name}");
            assert_eq!(s[0]["hostname"], "<host>", "{name}: the name field");
            assert_eq!(s[0]["unc"], r"\\<host>\share", "{name}: a UNC path");
            assert_eq!((r.identity_names, r.ordinary_word_names_left), (2, 1), "{name}");
        }
        // A user named with one of them: the sentence is intact and the profile path is still scrubbed by shape.
        for name in ["GAMING", "Desktop", "Power", "Guest"] {
            let env = ExportEnv { literals: usable_literals(vec![(name.into(), "<user>")], Some(name.into())), active_plan: None };
            let (s, _) = lone([json!({ "note": text, "p": format!(r"C:\Users\{name}\x") }), json!([]), json!([]), json!({}), json!([]), json!([])], &env);
            assert_eq!(s[0]["note"], text, "{name}");
            assert_eq!(s[0]["p"], r"C:\Users\<user>\x", "{name}: a path is still scrubbed");
        }
    }

    #[test]
    fn the_drift_watch_fields_redact_plan_names_and_startup_titles() {
        let title = format!("Disable startup entry: {C_STARTUP}");
        let short = "Disable startup entry: QQ";
        let drift_plan = json!({ "id": "power-profile", "label": "Power profile", "detail": "Active plan \"Gaming Rig\" is not a performance plan.",
            "noticed_at": "t", "unreadable_now": false, "value_now": "Gaming Rig", "last_ready_at": "t", "last_ready_value": "Old Rig Plan",
            "titles": [], "applied_at": [] });
        let drift_stock = json!({ "id": "power-profile", "label": "Power profile", "detail": "x", "noticed_at": "t", "unreadable_now": true,
            "value_now": null, "last_ready_at": "t", "last_ready_value": "High performance", "titles": [], "applied_at": [] });
        let drift_changes = json!({ "id": "applied-changes", "label": "Applied changes", "detail": format!("2 changes are off: {title}, {short}"),
            "noticed_at": "t", "unreadable_now": false, "value_now": null, "last_ready_at": null, "last_ready_value": null,
            "titles": [title, short], "applied_at": ["t", "t"] });
        let env = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "Gaming Rig".into(), guid: "dddddddd-1111-2222-3333-444444444444".into() }) };
        let (s, r) = lone(
            [
                json!({}),
                json!([]),
                json!([
                    { "id": "a-1", "rec_id": format!("startup-entry:{C_STARTUP}"), "rec_title": title, "snapshot": { "kind": "startup-approval", "name": C_STARTUP } },
                    { "id": "b-2", "rec_id": "startup-entry:QQ", "rec_title": short, "snapshot": { "kind": "startup-approval", "name": "QQ" } }
                ]),
                json!({ "checks": [{ "id": "applied-changes", "label": "Applied changes", "detail": format!("2 changes are off: {title}, {short}"),
                                      "drifted_titles": [title, short] }],
                        "drifts": [drift_plan, drift_stock, drift_changes] }),
                json!([]),
                json!([]),
            ],
            &env,
        );
        let text = all_text(&s);
        let startup_lc = C_STARTUP.to_lowercase();
        for gone in ["gaming rig", "old rig plan", startup_lc.as_str()] {
            assert!(!text.contains(gone), "{gone} survived: {text}");
        }
        assert!(!text.contains("startup entry: qq"), "a two-letter entry in a title: {text}");
        let d = &s[3]["drifts"];
        assert_eq!(d[0]["value_now"], CUSTOM_PLAN);
        assert_eq!(d[0]["last_ready_value"], CUSTOM_PLAN, "a plan no longer active is a plan name too");
        assert_eq!(d[0]["detail"], format!("Active plan \"{CUSTOM_PLAN}\" is not a performance plan."));
        assert_eq!(d[1]["last_ready_value"], "High performance", "a stock plan keeps its name");
        assert_eq!(d[1]["value_now"], Value::Null);
        assert_eq!(d[2]["titles"], json!(["Disable startup entry: other program 1", "Disable startup entry: other program 2"]));
        assert_eq!(s[3]["checks"][0]["drifted_titles"], d[2]["titles"]);
        assert_eq!(d[2]["applied_at"], json!(["t", "t"]), "stamps are untouched");
        assert!(r.power_plan_names >= 3 && r.startup_entry_names >= 2);
    }

    #[test]
    fn every_field_of_a_session_row_and_a_drift_row_is_classified_here_and_a_new_one_breaks_this_build() {
        // Exhaustive patterns (no `..`): adding a field to either struct is a compile error until it is named
        // below, under the class that says how the export treats it. game_state has its own key list
        // (EXPORTED_GAME_STATE_KEYS); these two have none, so this is their classification.
        let row: crate::sessions::SessionSummary = serde_json::from_value(json!({
            "started_at": "t", "duration_secs": 40, "process_name": "game.exe", "samples": 1, "avg_fps": 1.0,
            "avg_frametime_ms": 1.0, "low1_fps_est": 1.0, "unreadable_seconds": 30
        }))
        .unwrap();
        let crate::sessions::SessionSummary {
            // Numbers, booleans and Compy's own fixed words: nothing a person typed.
            started_at: _, duration_secs: _, samples: _, avg_fps: _, avg_frametime_ms: _, low1_fps_est: _, peak_gpu_temp_c: _,
            peak_gpu_usage_pct: _, peak_ram_used_bytes: _, ram_total_bytes: _, compy_changes_active: _, compy_changes_per_change: _,
            compy_changes_cant_confirm: _, compy_changes_legacy_active: _, compy_changes_since_set_aside: _, gaming_mode_active: _,
            gaming_mode_plan: _, stutter_timeline: _, fps_series: _, capture_capabilities: _, peak_cpu_temp_c: _,
            peak_gpu_hotspot_temp_c: _, background_secs_excluded: _, frame_pacing: _, gpu_load: _, frame_cap: _, ended: _,
            // M6-unread: whole seconds, rendered through fmt_duration with a fixed sentence.
            unreadable_seconds,
            // Hardware names only (the rig hash inputs), kept as the export says it keeps hardware names.
            hw_fingerprint: _,
            // The game's own program name: kept by design (the note says so).
            process_name: _,
            // Program names from the machine: redacted by redact_session_rows (labels, sentence).
            stutter_insight: _, stutter_events: _,
            // Cut to EXPORTED_GAME_STATE_KEYS by redact_session_rows.
            game_state: _,
        } = row;
        assert_eq!(unreadable_seconds, 30);
        let drift = crate::drift::Drift {
            id: String::new(), label: String::new(), detail: String::new(), noticed_at: String::new(), unreadable_now: false,
            value_now: None, last_ready_at: None, last_ready_value: None, titles: vec![], applied_at: vec![],
        };
        let crate::drift::Drift {
            // Fixed check id and label, stamps, a flag.
            id: _, label: _, noticed_at: _, unreadable_now: _, last_ready_at: _, applied_at: _,
            // A check's own text: plan names by replace_plan_names (PLAN_VALUE_KEYS, quoted detail), this PC's
            // names by the literal pass.
            detail: _, value_now: _, last_ready_value: _,
            // Applied-change titles: startup-entry titles by the startup loop.
            titles: _,
        } = drift;
        // The unmeasured seconds reach the export as a number and Compy's fixed sentence.
        let mut sources = canary_sources();
        sources[4] = json!([{ "process_name": "game.exe", "duration_secs": 900, "samples": 800, "unreadable_seconds": 90,
            "avg_fps": 141.0, "avg_frametime_ms": 7.1, "low1_fps_est": 98.0 }]);
        let b = build_export(sources, false, None, "embedded", "t", &canary_env());
        assert_eq!(b.bundle["sessions"][0]["unreadable_seconds"], 90);
        assert!(b.markdown.contains("Compy couldn't measure 1m 30s of it (left out of these figures)"), "{}", b.markdown);
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
        // "Max" is an ordinary word on the skip list: kept as a literal, but applied to paths and name fields only.
        assert_eq!(usable_literals(vec![("Max".into(), "<user>")], None).len(), 1);
        assert!(is_scoped_name("Max"));
        let mut hw = json!({ "display": "Max refresh rate", "gpu": "NVIDIA Corporation", "share": r"CORP\zorvak", "pc": "张伟的电脑" });
        let env = ExportEnv { literals: vec![("CORP".into(), "<host>"), ("张伟".into(), "<user>")], active_plan: None };
        let (mut a, mut l, mut rd, mut s, mut d) = (json!([]), json!([]), json!({}), json!([]), json!([]));
        redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &env);
        assert_eq!(hw["display"], "Max refresh rate");
        assert_eq!(hw["gpu"], "NVIDIA Corporation");
        assert_eq!(hw["share"], r"<host>\zorvak");
        assert_eq!(hw["pc"], "<user>的电脑");
    }

    #[test]
    fn an_account_name_on_the_skip_list_is_removed_from_paths_only() {
        // Another account named Admin (no literal): removed by the path shape alone.
        let mut hw = json!({ "p": r"C:\Users\Admin\Documents", "t": "Admin panel" });
        let (mut a, mut l, mut rd, mut s, mut d) = (json!([]), json!([]), json!({}), json!([]), json!([]));
        redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &ExportEnv::default());
        assert_eq!(hw["p"], r"C:\Users\<user>\Documents");
        assert_eq!(hw["t"], "Admin panel");
        // This PC's own account named Admin: a literal now, applied to the path and the name field, not the text.
        let env = ExportEnv { literals: usable_literals(vec![("Admin".into(), "<user>")], None), ..Default::default() };
        assert_eq!(env.literals.len(), 1);
        let mut hw = json!({ "p": r"C:\Users\Admin\Documents", "t": "Admin panel", "username": "ADMIN" });
        let r = redact_export_sources([&mut hw, &mut a, &mut l, &mut rd, &mut s, &mut d], &env);
        assert_eq!((hw["p"].as_str(), hw["t"].as_str(), hw["username"].as_str()), (Some(r"C:\Users\<user>\Documents"), Some("Admin panel"), Some("<user>")));
        assert_eq!((r.identity_names, r.ordinary_word_names_left, r.user_name_segments), (2, 1, 0));
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
    fn a_stock_plan_name_keeps_its_name_even_with_a_guid_windows_does_not_ship() {
        let guid = "aaaaaaaa-1111-2222-3333-444444444444";
        let env = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "Ultimate Performance".into(), guid: guid.into() }) };
        let mut s = plan_sources("Ultimate Performance", guid);
        let r = redact_export_sources(s.each_mut(), &env);
        let text = all_text(&s);
        assert!(text.matches("ultimate performance").count() >= 5, "{text}");
        assert!(!text.contains(guid) && text.contains("custom-plan-1"), "the guid is still labelled: {text}");
        assert!(!text.contains("a custom power plan") && r.power_plan_names == 0);
        // A name that merely CONTAINS a stock class word is a name the user typed: replaced (the strict rule).
        let env = ExportEnv { literals: vec![], active_plan: Some(ActivePlan { name: "My Ultimate Rig".into(), guid: guid.into() }) };
        let mut k = plan_sources("My Ultimate Rig", guid);
        let r = redact_export_sources(k.each_mut(), &env);
        assert!(!all_text(&k).contains("my ultimate rig") && r.power_plan_names == 5, "{}", all_text(&k));
        // D2 (F1): a copy of Compy's Ultimate plan that is localized or that the user renamed has a GUID Windows
        // does not ship and a name that is not one of the four. The ledger records the copy's GUID but not its
        // name, so a renamed copy cannot be told from a localized one: both are replaced, in all five places.
        for typed in ["Höchstleistung Canary", "Zed Canary's rig"] {
            let env = ExportEnv { active_plan: Some(ActivePlan { name: typed.into(), guid: guid.into() }), ..Default::default() };
            let mut copy = plan_sources(typed, guid);
            let r = redact_export_sources(copy.each_mut(), &env);
            assert!(!all_text(&copy).contains(&typed.to_lowercase()) && r.power_plan_names == 5, "{typed}: {}", all_text(&copy));
        }
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
    fn qos_policy_names_in_the_readiness_row_are_numbered_like_the_hardware_list_and_appear_nowhere() {
        // One name inside the other, and a two-letter one: longest first, the same number everywhere.
        let (long, short, tiny) = ("Zorvak Game Traffic", "Zorvak Game", "ab");
        let row = |names: &str| {
            json!({ "id": "network-qos", "label": "Network QoS policy", "status": "advisory", "value": "3 QoS policies",
                    "detail": format!("Windows QoS traffic-priority policies are active ({names}). These shape which apps get network priority.") })
        };
        let sources = || -> [Value; 6] {
            [
                json!({ "qos_policies": [short, long, tiny] }),
                json!([]),
                json!([]),
                json!({ "checks": [row(&format!("{short}, {long}, {tiny}")), { "id": "other", "detail": format!("see {long} and {short} again") }] }),
                json!([]),
                json!([]),
            ]
        };
        let (s, r) = lone(sources(), &ExportEnv::default());
        assert_eq!(s[0]["qos_policies"], json!(["QoS policy 1", "QoS policy 2", "QoS policy 3"]));
        let detail = s[3]["checks"][0]["detail"].as_str().unwrap();
        assert!(detail.contains("(QoS policy 1, QoS policy 2, QoS policy 3)."), "{detail}");
        assert_eq!(s[3]["checks"][1]["detail"], "see QoS policy 2 and QoS policy 1 again", "the longer name is not half-replaced");
        assert_eq!(r.qos_policy_names, 3);
        for consumer in [false, true] {
            let b = build_export(sources(), consumer, None, "embedded", "t", &ExportEnv::default());
            let shapes = [b.markdown.to_lowercase(), b.discord.to_lowercase(), serde_json::to_string(&b.bundle).unwrap().to_lowercase()];
            for text in shapes {
                assert!(!text.contains("zorvak"), "a QoS policy name survived (consumer tier: {consumer}): {text}");
            }
        }
        let tech = build_export(sources(), false, None, "embedded", "t", &ExportEnv::default());
        assert!(tech.markdown.contains("QoS policy 1, QoS policy 2, QoS policy 3"), "the readiness row reaches the Markdown, numbered: {}", tech.markdown);
    }

    #[test]
    fn a_custom_plan_whose_name_contains_ultimate_or_high_performance_is_replaced_wherever_a_plan_name_sits() {
        let guid = "eeeeeeee-1111-2222-3333-444444444444";
        for name in ["Canary Ultimate Rig", "My High performance mix", "Ultimate Performance (copy 2)", "Power Saver Plus"] {
            let mut src = plan_sources(name, guid);
            src[3]["drifts"] = json!([{
                "id": "power-profile", "label": "Power profile", "detail": format!("Active plan \"{name}\" is not a performance plan."),
                "noticed_at": "t", "unreadable_now": false, "value_now": name, "last_ready_at": "t", "last_ready_value": name,
                "titles": [], "applied_at": []
            }]);
            let (s, r) = lone(src, &ExportEnv::default());
            let text = all_text(&s);
            assert!(!text.contains(&name.to_lowercase()), "{name} survived: {text}");
            assert_eq!(s[3]["checks"][0]["value"], CUSTOM_PLAN, "{name}: readiness");
            assert_eq!(s[5][0]["entries"][0]["value"], CUSTOM_PLAN, "{name}: diagnostics");
            assert_eq!(s[3]["drifts"][0]["value_now"], CUSTOM_PLAN, "{name}: drift now");
            assert_eq!(s[3]["drifts"][0]["last_ready_value"], CUSTOM_PLAN, "{name}: drift last ready");
            assert_eq!(s[2][0]["restores_label"], format!("Switches back to {CUSTOM_PLAN}"), "{name}: ledger row");
            assert_eq!(s[2][0]["applied_plan"]["name"], CUSTOM_PLAN, "{name}: ledger plan");
            assert_eq!(r.power_plan_names, 8, "{name}: 5 in the base fixture + the drift row's value_now, last_ready_value and quoted detail");
        }
        // The two ways a name stays: a stock GUID (whatever Windows calls it), an exact stock name. A GUID Windows
        // does not ship keeps no other name, Compy's own copy included (D2, F1).
        assert!(keeps_plan_name(Some("381B4222-F694-41F0-9685-FF5BB260DF2E"), "Ausgeglichen"));
        assert!(keeps_plan_name(None, "  ULTIMATE performance "));
        assert!(keeps_plan_name(Some("{aaaaaaaa-1111-2222-3333-444444444444}"), "Ultimate Performance"));
        assert!(!keeps_plan_name(Some("{aaaaaaaa-1111-2222-3333-444444444444}"), "Höchstleistung"));
        assert!(!keeps_plan_name(None, "Ultimate Performance 2") && !keeps_plan_name(None, "Canary Ultimate Rig"));
    }

    #[test]
    fn a_slash_is_a_path_separator_only_inside_a_path_not_anywhere_in_a_string_that_holds_one() {
        let run = |s: &str| {
            let (mut n, mut left) = (0, 0);
            let out = replace_name_scoped(s, "Power", "<host>", &mut n, Some(&mut left));
            (out, n, left)
        };
        // D2 (review e2-r2 F4a): a path earlier in the string no longer turns a later `/` in prose into a separator.
        assert_eq!(run(r"see C:\a.txt; Power/Performance mode"), (r"see C:\a.txt; Power/Performance mode".to_string(), 0, 1));
        // A path still covers its own `/`, past a space or a bracket in a folder name.
        assert_eq!(run("C:/Program Files (x86)/Power/x").0, "C:/Program Files (x86)/<host>/x");
        assert_eq!(run(r"C:\x\Power and more").0, r"C:\x\<host> and more");
        // F4b: a forward-slash UNC path inside a sentence is a path.
        assert_eq!(run("reach //Power/share now"), ("reach //<host>/share now".to_string(), 1, 0));
        // A web address is not a path, and neither is prose.
        assert_eq!(run("https://site/Power/x and/or Power/Performance"), ("https://site/Power/x and/or Power/Performance".to_string(), 0, 2));
        // A file URL is.
        assert_eq!(run("file:///D:/Power/x").0, "file:///D:/<host>/x");
        // A backslash path ends at a sentence end: the next sentence's `/` is prose again.
        assert_eq!(run(r"Saved to C:\x\Power. Power/Performance next").0, r"Saved to C:\x\<host>. Power/Performance next");
        // D2 review r1 N1: a folder name may hold a comma, a semicolon or a full stop. A path goes on past one
        // when a slash of its kind comes before the next break (this was replaced before F4a and must stay so).
        let max = |s: &str| {
            let (mut n, mut left) = (0, 0);
            let out = replace_name_scoped(s, "Max", "<user>", &mut n, Some(&mut left));
            (out, n, left)
        };
        assert_eq!(max("C:/Games/Hello, World/Max/save.dat"), ("C:/Games/Hello, World/<user>/save.dat".to_string(), 1, 0));
        assert_eq!(max("D:/St. Louis/Max/x").0, "D:/St. Louis/<user>/x");
        assert_eq!(max("C:/Users/x/OneDrive - Contoso; Inc/Max/x").0, "C:/Users/x/OneDrive - Contoso; Inc/<user>/x");
        assert_eq!(max(r"C:\Games\Hello, World\Max\save.dat").0, r"C:\Games\Hello, World\<user>\save.dat");
        // D2 review r2 B1: not only the one word after the break: the next slash of the path's kind, before the
        // next break, carries the path on, so a folder name with a comma or full stop AND spaces is still covered.
        assert_eq!(max("C:/Games/Hello, big World/Max/save.dat"), ("C:/Games/Hello, big World/<user>/save.dat".to_string(), 1, 0));
        assert_eq!(max("D:/Mr. J Smith/Max/x"), ("D:/Mr. J Smith/<user>/x".to_string(), 1, 0));
        // Review r3: two commas or full stops in one folder name do not end the path either.
        assert_eq!(max("C:/Games/Hello, World, Again/Max/x"), ("C:/Games/Hello, World, Again/<user>/x".to_string(), 1, 0));
        assert_eq!(max("D:/Mr. J. Smith/Max/x"), ("D:/Mr. J. Smith/<user>/x".to_string(), 1, 0));
        // The stated limit: a backslash path whose folder name holds a comma and whose next separator is a `/`
        // ends at the comma (it reads exactly like "C:\a.txt; Power/Performance"), so the name is left.
        assert_eq!(max(r"C:\Games\Hello, World/Max/x"), (r"C:\Games\Hello, World/Max/x".to_string(), 0, 1));
        // A profile path with spaces is one path.
        assert_eq!(max("C:/Users/Mary Ann/Documents/Max/x").0, "C:/Users/Mary Ann/Documents/<user>/x");
        // The prose F4a was for: after a backslash path, and with no path at all, "and/or", "I/O", "N/A" and a
        // date are prose, and the name beside a `/` there stays.
        assert_eq!(
            max(r"Saved to C:\Games\a.txt; Max/Min and/or I/O, N/A on 11/21/2026"),
            (r"Saved to C:\Games\a.txt; Max/Min and/or I/O, N/A on 11/21/2026".to_string(), 0, 1)
        );
        assert_eq!(max("and/or I/O N/A 11/21/2026 Max/Min").2, 1);
        // A web address is not a path.
        assert_eq!(max("see https://example.com/Max/page, then Max/Min").2, 2);
        // The stated cost of erring toward the path: a forward-slash path followed by prose whose next word has
        // a `/` keeps going, so a word of that prose is replaced (never a name left).
        assert_eq!(run("Saved to C:/x/Power. Power/Performance next").0, "Saved to C:/x/<host>. <host>/Performance next");
    }

    #[test]
    fn a_network_adapter_name_in_a_ledger_snapshot_is_numbered_and_the_word_stays_in_text() {
        // D2 (review e2-r2 F6): the EEE undo record keeps each adapter's Windows name, which the user can change.
        // Built through serde from the real types (review r1 N4), so a rename of the variant or the field cannot
        // leave the name in the export with this test green.
        let snap = |names: &[&str]| {
            let adapters = names
                .iter()
                .map(|n| crate::actions::EeeNicSnapshot {
                    adapter_name: (*n).to_string(),
                    property_display_name: "Energy Efficient Ethernet".into(),
                    prior_value: "Enabled".into(),
                })
                .collect();
            serde_json::to_value(crate::actions::Snapshot::EeeNicProperty { adapters }).expect("serializes")
        };
        let src = [
            json!({ "network_adapters": [{ "name": "Intel(R) Ethernet Controller I225-V" }] }),
            json!([]),
            json!([{ "id": "eee-1", "rec_id": "disable-eee", "snapshot": snap(&["Zed Canary Wired", "Ethernet"]) }, { "id": "eee-2", "rec_id": "disable-eee", "snapshot": snap(&["ethernet"]) }]),
            json!({ "checks": [{ "id": "eee", "detail": "Ethernet adapter power saving is on." }] }),
            json!([]),
            json!([]),
        ];
        let (s, r) = lone(src, &ExportEnv::default());
        let a = &s[2][0]["snapshot"]["adapters"];
        assert_eq!(a[0]["adapter_name"], "adapter-1");
        assert_eq!(a[1]["adapter_name"], "adapter-2");
        assert_eq!(s[2][1]["snapshot"]["adapters"][0]["adapter_name"], "adapter-2", "the same name (any case), the same number");
        assert_eq!(a[0]["property_display_name"], "Energy Efficient Ethernet", "the driver's text stays");
        assert_eq!(s[3]["checks"][0]["detail"], "Ethernet adapter power saving is on.", "the name is not searched for in free text");
        assert_eq!(s[0]["network_adapters"][0]["name"], "Intel(R) Ethernet Controller I225-V", "the hardware list keeps the model");
        assert!(!all_text(&s).contains("zed canary wired"));
        assert_eq!(r.to_json()["adapter_names_replaced"], 2);
        assert_eq!(r.to_json()["custom_ids_replaced"], 0);
        assert!(r.note().contains("2 network adapter names in the Trust Ledger (a name Windows lets you change) replaced"), "{}", r.note());
        assert!(!r.note().contains("network-interface ID"), "{}", r.note());
    }

    #[test]
    fn common_first_names_are_not_ordinary_words_so_a_pc_named_after_one_is_replaced_everywhere() {
        // D2 (review e2-r2 item 3): the ordinary-word set follows the words of Compy's own report text, so a new
        // message word can silently make a common first name one that stays in running text. These stay OUT. If
        // one goes in, choose it on purpose (reword the message, or say so in PRIVACY.md and EXPORT_REDACTION.md).
        // "Sam" is in the generated list only as the monitor maker code "SAM" and is denied (NOT_ORDINARY_WORDS).
        let inside: Vec<&str> = [
            "Mark", "Grace", "Hunter", "Jordan", "Taylor", "John", "James", "Sam", "Tom", "Alex", "Frank", "Rose", "Bill", "Jack", "Dawn", "Grant",
            "Emma", "Olivia", "Liam", "Noah", "Sophia", "Lucas", "Mia", "Ethan", "Chloe", "Daniel", "Sarah", "David", "Maria", "Kevin",
        ]
        .into_iter()
        .filter(|n| is_ordinary_word(n))
        .collect();
        assert!(inside.is_empty(), "now words of Compy's report text, so a PC or account with one of these names stays in running text: {inside:?}");
        // The stated exceptions (review r1 N5): names that ARE everyday words of Compy's report text ("Max refresh
        // rate", "may", "will", "major"), so a PC or account with that name stays in running text. Pinned, so one
        // that stops being a word, or a deny-list entry that hides one, is seen.
        for name in ["Max", "Will", "May", "Major"] {
            assert!(is_ordinary_word(name), "{name} is no longer an ordinary word of Compy's text: update this pin and the docs");
        }
        assert!(NOT_ORDINARY_WORDS.iter().all(|w| export_text_words().contains(*w)), "a deny-list entry is no longer in the list: remove it");
    }

    #[test]
    fn a_spaced_name_is_taken_whole_at_the_end_of_a_value_and_before_a_period_colon_comma_or_curly_quote() {
        let name = "Mary Ann Van Der Berg"; // five words: past the old three-word limit
        let u = r"C:\Users\<user>";
        let cases: Vec<(String, String)> = vec![
            (format!(r"C:\Users\{name}"), u.into()),
            (format!(r"C:\Users\{name}."), format!("{u}.")),
            (format!(r"C:\Users\{name}: access denied"), format!("{u}: access denied")),
            (format!(r"failed at C:\Users\{name}: denied"), format!(r"failed at {u}: denied")),
            (format!(r"saw C:\Users\{name}, then left"), format!(r"saw {u}, then left")),
            (format!(r"see C:\Users\{name}. Next"), format!(r"see {u}. Next")),
            (format!("open \u{201c}C:\\Users\\{name}\u{201d} now"), format!("open \u{201c}{u}\u{201d} now")),
            ("\u{2018}C:\\Users\\john\u{2019} failed".into(), format!("\u{2018}{u}\u{2019} failed")),
            (r"read C:\Users\john.smith failed".into(), r"read C:\Users\<user> failed".into()),
            (r"\\?\C:\Users\John Smith\x".into(), r"\\?\C:\Users\<user>\x".into()),
            ("file:///C:/Users/John%20Smith/x.txt".into(), "file:///C:/Users/<user>/x.txt".into()),
            ("C:/Users/O\u{2019}Brien/x".into(), "C:/Users/<user>/x".into()),
        ];
        for (input, want) in cases {
            let mut n = 0;
            assert_eq!(scrub_user_paths(&input, &mut n), want, "{input}");
            assert_eq!(n, 1, "{input}");
        }
        // The one limit that is left: a spaced name past 32 characters before a soft end is cut at its first space.
        let mut n = 0;
        assert_eq!(
            scrub_user_paths(r"x C:\Users\Alpha Bravo Charlie Delta Echo Foxtrot, more", &mut n),
            r"x C:\Users\<user> Bravo Charlie Delta Echo Foxtrot, more"
        );
        // This PC's own name is matched exactly by the literal pass, whatever its length or what follows it.
        let own = "Alpha Bravo Charlie Delta Echo Foxtrot";
        let env = ExportEnv { literals: vec![(own.into(), "<user>")], ..Default::default() };
        let (s, _) = lone([json!({ "p": format!(r"x C:\Users\{own}, more") }), json!([]), json!([]), json!({}), json!([]), json!([])], &env);
        assert_eq!(s[0]["p"], r"x C:\Users\<user>, more");
    }

    #[test]
    fn a_onedrive_company_name_becomes_organization_and_personal_stays() {
        let cases = [
            (r"C:\Users\<user>\OneDrive - Acme Corp\Documents\a.txt", r"C:\Users\<user>\OneDrive - <organization>\Documents\a.txt", 1),
            (r"C:\Users\<user>\OneDrive - Acme Corp", r"C:\Users\<user>\OneDrive - <organization>", 1),
            (r"saved to C:\Users\<user>\OneDrive - Acme Corp, then", r"saved to C:\Users\<user>\OneDrive - <organization>, then", 1),
            ("D:/OneDrive - Initech Ltd/Desktop", "D:/OneDrive - <organization>/Desktop", 1),
            (r"C:\Users\<user>\OneDrive - Personal\Pictures", r"C:\Users\<user>\OneDrive - Personal\Pictures", 0),
            ("OneDrive - Acme Corp is a folder name in text", "OneDrive - Acme Corp is a folder name in text", 0),
            (r"C:\Users\<user>\OneDrive - <organization>\x", r"C:\Users\<user>\OneDrive - <organization>\x", 0),
        ];
        for (input, want, count) in cases {
            let mut n = 0;
            assert_eq!(scrub_onedrive_org(input, &mut n), want, "{input}");
            assert_eq!(n, count, "{input}");
        }
        // End to end: the company is gone from every shape, counted, and said in the note.
        let src = [
            json!({ "p": r"C:\Users\Someone Else\OneDrive - Globex Corporation\Desktop" }),
            json!([]), json!([]), json!({}), json!([]), json!([]),
        ];
        let b = build_export(src, false, None, "embedded", "t", &ExportEnv::default());
        let json = serde_json::to_string(&b.bundle).unwrap();
        assert!(!json.contains("Globex") && !json.contains("Someone Else") && json.contains(r"OneDrive - <organization>"), "{json}");
        assert_eq!(b.bundle["redaction"]["onedrive_organizations_replaced"], 1);
        assert!(b.markdown.contains("A company name in a OneDrive folder name was replaced with \"organization\" in 1 place."), "{}", b.markdown);
    }

    #[test]
    fn a_one_or_two_letter_qos_policy_name_leaves_the_readiness_row_as_the_labelled_list() {
        // The row prints the names exactly as typed, spaces and all; a blank entry still takes a number.
        for names in [vec!["ab"], vec!["ab", "cd"], vec![" ab ", "  "], vec!["x"]] {
            let printed = names.join(", ");
            let sources = || -> [Value; 6] {
                [
                    json!({ "qos_policies": names }),
                    json!([]),
                    json!([]),
                    json!({ "checks": [{ "id": "network-qos", "label": "Network QoS policy", "status": "advisory", "value": "labels about",
                        "detail": format!("Windows QoS traffic-priority policies are active ({printed}). They shape which apps get priority, about it.") }] }),
                    json!([]),
                    json!([]),
                ]
            };
            let (s, r) = lone(sources(), &ExportEnv::default());
            let labels = (1..=names.len()).map(|i| format!("QoS policy {i}")).collect::<Vec<_>>().join(", ");
            assert_eq!(
                s[3]["checks"][0]["detail"],
                format!("Windows QoS traffic-priority policies are active ({labels}). They shape which apps get priority, about it."),
                "{names:?}"
            );
            assert_eq!(s[3]["checks"][0]["value"], "labels about", "{names:?}: ordinary words are not shredded");
            assert_eq!(s[0]["qos_policies"].as_array().unwrap().len(), names.len());
            assert_eq!(r.qos_policy_names as usize, names.len());
            let b = build_export(sources(), false, None, "embedded", "t", &ExportEnv::default());
            assert!(b.markdown.contains(&format!("({labels})")), "{names:?}: {}", b.markdown);
        }
    }

    #[test]
    fn a_spaced_name_inside_a_sentence_is_only_partly_replaced() {
        let mut n = 0;
        assert_eq!(scrub_user_paths(r"saw C:\Users\Mary Ann Van Der Berg open it", &mut n), r"saw C:\Users\<user> Ann Van Der Berg open it");
        assert_eq!(n, 1);
    }

    #[test]
    fn a_long_unc_profile_path_loses_the_account_name() {
        for (input, want) in [
            (r"\\?\UNC\fileserver\share\Users\jdoe\Desktop\a.txt", r"\\?\UNC\fileserver\share\Users\<user>\Desktop\a.txt"),
            (r"\\?\UNC\fileserver\share\Users\jdoe", r"\\?\UNC\fileserver\share\Users\<user>"),
            (r"\\fileserver\share$\Users\Jane Doe\x", r"\\fileserver\share$\Users\<user>\x"),
        ] {
            let mut n = 0;
            assert_eq!(scrub_user_paths(input, &mut n), want, "{input}");
            assert_eq!(n, 1, "{input}");
        }
    }

    #[test]
    fn a_non_ascii_account_name_is_replaced_and_never_cut_inside_a_character() {
        for (input, want) in [
            (r"C:\Users\José Müller\x", r"C:\Users\<user>\x"),
            (r"C:\Users\张伟\Desktop", r"C:\Users\<user>\Desktop"),
            ("C:\\Users\\Zo\u{eb}.", "C:\\Users\\<user>."),
            ("C:\\Users\\\u{1F600}smile\\x", "C:\\Users\\<user>\\x"),
            (r"C:\Users\Müller, then", r"C:\Users\<user>, then"),
        ] {
            let mut n = 0;
            assert_eq!(scrub_user_paths(input, &mut n), want, "{input}");
            assert_eq!(n, 1, "{input}");
        }
        // Every prefix of awkward text, cut at every character boundary, goes through both scrubs without a panic.
        for text in ["\\Users\\é\\OneDrive - Ünï\u{301}\u{2019}x, \u{1F600}.", "é/Users/\u{1F600}\u{201c}ö", "\\users\\\u{2019}\\OneDrive - \u{1F600}\u{1F600}"] {
            for (at, _) in text.char_indices().chain(std::iter::once((text.len(), ' '))) {
                let (mut a, mut b) = (0, 0);
                let one = scrub_user_paths(&text[..at], &mut a);
                let _ = scrub_onedrive_org(&one, &mut b);
            }
        }
    }

    #[test]
    fn a_moved_profile_folder_is_matched_by_its_real_leaf_name_scoped_or_not() {
        // `Media` is a common word (replaced only in a path); the other leaf is replaced everywhere.
        for (leaf, prose_stays) in [("Zorvakprofile", false), ("Media", true)] {
            let env = ExportEnv { literals: usable_literals(vec![(C_USER.to_string(), "<user>")], Some(leaf.to_string())), ..Default::default() };
            let src = [
                json!({ "cpu_brand": "x", "paths": [format!(r"D:\Profiles\{leaf}\Documents\a.txt"), format!(r"\\NAS\home\{leaf}\x")],
                        "note": format!("opened the {} player", leaf.to_lowercase()) }),
                json!([]), json!([]), json!({}), json!([]), json!([]),
            ];
            let (s, _) = lone(src, &env);
            assert_eq!(s[0]["paths"][0], r"D:\Profiles\<user>\Documents\a.txt", "{leaf}");
            assert_eq!(s[0]["paths"][1], r"\\NAS\home\<user>\x", "{leaf}");
            let note = s[0]["note"].as_str().unwrap();
            assert_eq!(note.contains(leaf.to_lowercase().as_str()), prose_stays, "{leaf}: {note}");
        }
    }

    #[test]
    fn a_onedrive_company_name_ending_in_a_period_before_a_separator_is_replaced() {
        let mut n = 0;
        let out = scrub_onedrive_org(r"C:\Users\<user>\OneDrive - Contoso Ltd.\Documents\a.txt", &mut n);
        assert!(!out.contains("Contoso") && !out.contains("Ltd"), "{out}");
        assert_eq!(n, 1);
        assert_eq!(out, r"C:\Users\<user>\OneDrive - <organization>.\Documents\a.txt");
    }

    #[test]
    fn a_long_space_free_string_of_paths_is_matched_in_linear_time() {
        let started = std::time::Instant::now();
        let big = r"\Users\".repeat(130_000); // about 1 MB, no space anywhere
        let mut n = 0;
        let out = scrub_user_paths(&big, &mut n);
        assert!(n > 1000 && out.contains("<user>"), "{n}");
        let slashes = r"/users/a,".repeat(115_000);
        let (mut a, mut b) = (0, 0);
        let _ = scrub_user_paths(&slashes, &mut a);
        let _ = scrub_onedrive_org(&r"\OneDrive - Acme,".repeat(60_000), &mut b);
        assert!(a > 1000 && b > 1000, "{a} {b}");
        let (s, _) = lone([json!({ "p": big }), json!([]), json!([]), json!({}), json!([]), json!([])], &ExportEnv::default());
        assert!(s[0]["p"].as_str().unwrap().contains("<user>"));
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "path matching is linear: took {:?}", started.elapsed());
    }

    #[test]
    fn the_export_reads_the_ledger_once_for_support_evidence() {
        // An unreadable ledger is one support event per export: the view read is the only ledger read (D2: the
        // plan-GUID read that kept the name of a recorded Ultimate copy is gone, see keeps_plan_name).
        let this = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("export.rs")).expect("export.rs");
        let prod = &this[..this.find("mod export_tests {").expect("test module")];
        let reads: Vec<&str> = prod.match_indices("crate::history::").map(|(i, _)| &prod[i + 16..]).filter(|rest| !rest.starts_with("APPLIABLE_REC_IDS")).collect();
        assert!(reads.len() == 1 && reads[0].starts_with("get_applied_changes()"), "the export reads the ledger only through get_applied_changes: {reads:?}");
        let at = this.find("pub(crate) fn export_report(").expect("export_report");
        let report = &this[at..at + this[at..].find("pub(crate) fn open_export_folder").expect("end")];
        assert_eq!(report.matches("get_applied_changes()").count(), 1, "the view read is the one that records");
        assert!(!report.contains("load_history"), "export_report reads the ledger only through the view");
    }

    /// The record types the export reads, field by field, each classed ONE of three ways (space-separated names):
    /// safe = a number, flag, stamp, version, fixed Compy word, or a nested record that has its own row here;
    /// hardware text = a device or program name the export keeps on purpose (the note says so);
    /// redacted text = text that can carry a typed name, which the passes in `redact_export_sources` cover.
    /// `every_field_of_the_exported_records_is_classified_here_and_a_new_one_fails_this_test` reads the struct
    /// definitions from the source, so a field added to any of them (or to one nested in them) fails until it is
    /// listed here with a class. The enum-typed fields are classed variant by variant in ENUM_FIELDS (D2); not
    /// covered: `game_state` (its own key list, EXPORTED_GAME_STATE_KEYS).
    const RECORD_FIELDS: [(&str, &str, &str, &str); 38] = [
        // D2: the two records nested in Snapshot variants (see ENUM_FIELDS). `interface` is a GUID ("interface-N",
        // collect_ids); `adapter_name` is the adapter's Windows name, which the user can change ("adapter-N",
        // number_adapter_names); the property name and value are the driver's own text.
        ("NagleInterfaceSnapshot", "prior_ack prior_nodelay", "", "interface"),
        ("EeeNicSnapshot", "", "property_display_name prior_value", "adapter_name"),
        ("AppliedChangeView",
         "applied_at status is_still_active active_check app_version_at_apply ruleset_version_at_apply elevation_used hw_fingerprint on_this_rig changed_outside_holds rolled_back_at justified_by_experiment rollback_justified_by_experiment undo_contract",
         "",
         "id rec_id rec_title snapshot applied_action rollback_action restores_label applied_label payoff_label changed_outside nothing_restored"),
        ("ChangedOutside", "schema recorded_at earlier_recorded_at", "", "observed"),
        ("TrialLink", "experiment_id outcome concluded_at", "", ""),
        ("NothingRestored", "", "", "reason plan_guid"),
        ("HwFingerprint", "hash ram_gb", "gpu gpu_driver display", ""),
        ("GameReadiness", "checks ready_count attention_count unknown_count advisory_count advisory drifts", "", "dismissed_ids"),
        ("ReadinessCheck", "id label status action_uri action_label", "", "detail value drifted_titles"),
        ("Drift", "noticed_at unreadable_now last_ready_at applied_at", "", "id label detail value_now last_ready_value titles"),
        ("DiagnosticSection", "entries", "", "name"),
        ("DiagnosticEntry", "", "", "label value note"),
        ("Recommendation", "id category severity applies_to currently_applied provenance eligible risk_dimensions", "", "title description impact downside ineligible_reason"),
        ("RiskDimensions", "reversibility stability compatibility security", "", ""),
        ("HardwareInfo",
         "cpu_cores_logical cpu_cores_physical cpu_frequency_mhz ram_total_bytes ram_used_bytes swap_total_bytes disks gpus physical_disks disk_health display memory_modules windows_version bios_info virtualization usb cpu_arch has_active_wired_ethernet has_wired_ethernet_port eee_switch_exposed network_adapters wifi_link network_pills game_storage monitors",
         "cpu_brand os_name os_version kernel_version",
         "hostname qos_policies"),
        ("DiskInfo", "total_bytes available_bytes file_system", "", "mount_point"),
        ("GpuInfo", "vram_bytes driver_date driver_age_days current_refresh_rate_hz", "name driver_version video_processor", ""),
        ("PhysicalDiskInfo", "media_type bus_type size_bytes", "friendly_name", ""),
        ("DiskHealth", "health", "friendly_name", ""),
        ("DisplayInfo", "width height current_refresh_rate_hz max_refresh_rate_hz hdr_capable", "", ""),
        ("MemoryModuleInfo", "capacity_bytes speed_mhz rated_speed_mhz type_name xmp_expo_status bank_channel slot_channel", "manufacturer", ""),
        ("WindowsVersionInfo", "display_version build ubr", "edition product_name", ""),
        ("BiosInfo", "release_date release_date_age_days", "manufacturer version", ""),
        ("VirtualizationInfo", "hypervisor_present cpu_virtualization_enabled vbs_state", "", ""),
        ("UsbSummary", "top_spec controller_count", "", ""),
        ("CpuArchInfo", "", "vendor family_label architecture generation", ""),
        ("NetAdapterInfo", "physical medium connected link_speed_bps", "name", ""),
        ("WifiLink", "band signal_pct rx_mbps radio_type channel", "", ""),
        ("NetworkPill", "tone", "", "label"),
        ("GameStorage", "libraries any_fast any_slow", "", ""),
        ("GameLibrary", "drive media_type bus_type", "launcher", ""),
        ("MonitorInfo", "", "model manufacturer", ""),
        ("SessionSummary",
         "started_at duration_secs samples avg_fps avg_frametime_ms low1_fps_est peak_gpu_temp_c peak_gpu_usage_pct peak_ram_used_bytes ram_total_bytes compy_changes_active compy_changes_per_change compy_changes_cant_confirm compy_changes_legacy_active compy_changes_since_set_aside hw_fingerprint gaming_mode_active gaming_mode_plan stutter_timeline stutter_events fps_series capture_capabilities peak_cpu_temp_c peak_gpu_hotspot_temp_c background_secs_excluded frame_pacing gpu_load frame_cap ended unreadable_seconds",
         "process_name",
         "stutter_insight game_state"),
        ("CountsSinceSetAside", "active cant_confirm since", "", ""),
        ("FramePacing", "frames p50_ms p99_ms p999_ms", "", ""),
        ("GpuLoad", "readings busy", "", ""),
        ("StutterEvent", "at_secs kind", "", "label"),
        ("CaptureCapabilities",
         "backend_id backend_version graphics_api supports_app_fps supports_presented_fps supports_displayed_fps supports_frame_type supports_generated_frames supports_gpu_busy supports_display_latency supports_input_latency supports_dropped_frames supports_gpu_telemetry capture_started_at methodology_version",
         "",
         "limitations"),
    ];

    const RECORD_SOURCES: [&str; 10] = [
        include_str!("readiness.rs"), include_str!("drift.rs"), include_str!("history.rs"), include_str!("diagnostics.rs"),
        include_str!("recommendations.rs"), include_str!("hardware.rs"), include_str!("sessions.rs"), include_str!("stutter.rs"),
        include_str!("capture.rs"), include_str!("actions.rs"),
    ];

    /// The `struct <name> {` line's fields as (field, type text), read from the record sources; None if not found.
    fn record_struct(name: &str) -> Option<Vec<(String, String)>> {
        RECORD_SOURCES.iter().find_map(|src| struct_fields_in(src, name))
    }

    /// [`record_struct`] over one source text. PANICS on a field line it cannot read.
    fn struct_fields_in(src: &str, name: &str) -> Option<Vec<(String, String)>> {
        let strip = |t: &str| -> String {
            let t = t.trim_start();
            t.strip_prefix("pub(crate) ").or_else(|| t.strip_prefix("pub(super) ")).or_else(|| t.strip_prefix("pub ")).unwrap_or(t).to_string()
        };
        let head = format!("struct {name} {{");
        {
            let lines: Vec<&str> = src.lines().collect();
            let at = lines.iter().position(|l| strip(l).starts_with(&head))?;
            let mut out = Vec::new();
            for l in &lines[at + 1..] {
                if l.starts_with('}') {
                    break;
                }
                let t = strip(l);
                if t.is_empty() || t.starts_with("//") || t.starts_with('#') {
                    continue;
                }
                // Every other line must be one `field: Type,`; a line this cannot read (a type that runs over
                // several lines, `r#name`, `pub(in path)`) FAILS here instead of being skipped, so a field can
                // never go unclassified because the parser could not see it.
                let (f, ty) = t.split_once(": ").unwrap_or_else(|| panic!("struct {name}: cannot read the field line `{}`: put each field and its type on one line (and no r#name or pub(in ..)), or extend record_struct", l.trim()));
                assert!(
                    !f.is_empty() && f.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                    "struct {name}: cannot read the field name in `{}`: put each field and its type on one line (and no r#name or pub(in ..)), or extend record_struct",
                    l.trim()
                );
                out.push((f.to_string(), ty.to_string()));
            }
            Some(out)
        }
    }

    /// The names of the `struct Name {` records a source defines (any of `pub`, `pub(crate)`, `pub(super)`).
    fn structs_defined_in(src: &str) -> Vec<String> {
        let mut names = Vec::new();
        for l in src.lines() {
            let t = l.trim_start();
            let t = t.strip_prefix("pub(crate) ").or_else(|| t.strip_prefix("pub(super) ")).or_else(|| t.strip_prefix("pub ")).unwrap_or(t);
            if let Some(rest) = t.strip_prefix("struct ").filter(|r| r.trim_end().ends_with('{')) {
                names.push(rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect());
            }
        }
        names
    }

    #[test]
    fn a_struct_field_line_the_parser_cannot_read_fails_instead_of_being_skipped() {
        let ok = "pub(super) struct Rec {\n    pub(super) a: u32,\n    /// doc\n    #[serde(skip)]\n    pub b_c: Option<String>, // note\n\n}\n";
        let fields = struct_fields_in(ok, "Rec").expect("found");
        assert_eq!(fields.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(), ["a", "b_c"]);
        assert!(struct_fields_in(ok, "Missing").is_none());
        assert_eq!(structs_defined_in("pub(super) struct A {\n pub(crate) struct B {\npub struct C {\nstruct D {\nstruct E;\n"), ["A", "B", "C", "D"]);
        for (bad, why) in [
            ("struct Rec {\n    a: HashMap<String,\n        Vec<u8>>,\n}\n", "a type over several lines"),
            ("struct Rec {\n    r#type: String,\n}\n", "a raw identifier"),
            ("struct Rec {\n    pub(in crate::x) a: u8,\n}\n", "pub(in path)"),
            ("struct Rec {\n    A: u8,\n}\n", "an upper-case field name"),
        ] {
            assert!(std::panic::catch_unwind(|| struct_fields_in(bad, "Rec")).is_err(), "{why} must fail, not be skipped");
        }
    }

    #[test]
    fn every_field_of_the_exported_records_is_classified_here_and_a_new_one_fails_this_test() {
        let defined: HashSet<String> = RECORD_SOURCES.iter().flat_map(|src| structs_defined_in(src)).collect();
        let listed: HashSet<&str> = RECORD_FIELDS.iter().map(|(n, ..)| *n).collect();
        let enums: HashSet<String> = RECORD_SOURCES.iter().flat_map(|src| enums_defined_in(src)).collect();
        let enum_listed: HashSet<&str> = ENUM_FIELDS.iter().map(|(n, ..)| *n).collect();
        for (name, safe, hardware, redacted) in RECORD_FIELDS {
            let fields = record_struct(name).unwrap_or_else(|| panic!("struct {name} is not found in the record sources: renamed or moved? update RECORD_FIELDS and RECORD_SOURCES"));
            let all: Vec<&str> = [safe, hardware, redacted].iter().flat_map(|c| c.split_whitespace()).collect();
            for (field, ty) in &fields {
                let classes = all.iter().filter(|f| **f == field).count();
                assert!(classes == 1, "{name}.{field} is {}: classify it exactly once in RECORD_FIELDS (safe, hardware text or redacted text)", if classes == 0 { "NEW and unclassified" } else { "classified twice" });
                // A nested record must have its own row; a nested enum its own ENUM_FIELDS row (D2).
                for ident in ty.split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|i| i.chars().next().is_some_and(char::is_uppercase)) {
                    assert!(!defined.contains(ident) || listed.contains(ident), "{name}.{field} holds the record {ident}, which has no row in RECORD_FIELDS");
                    assert!(!enums.contains(ident) || enum_listed.contains(ident), "{name}.{field} holds the enum {ident}, which has no row in ENUM_FIELDS");
                }
                assert_no_text_keyed_map(name, field, ty);
            }
            for f in all {
                assert!(fields.iter().any(|(n, _)| n == f), "{name}.{f} is classified but the struct no longer has it: remove it from RECORD_FIELDS");
            }
        }
        assert!(listed.len() == RECORD_FIELDS.len(), "a record is listed twice");
    }

    /// D2 (review e2-r2 item 4): the enum-typed fields of the exported records, VARIANT BY VARIANT, classed the
    /// same three ways as RECORD_FIELDS (`Variant.field`, or `Variant.0` for a tuple variant). Before this, a
    /// snapshot or action variant that gained a text field reached the export unclassified. How each class is
    /// handled: StartupApproval.name / SetStartupEntryEnabled.name by the startup-entry pass; the plan GUIDs by
    /// the id pass ("custom-plan-N"); ObservedState::PowerPlan by the plan pass; NagleNics interfaces by the id
    /// pass ("interface-N"); EEE adapter names by number_adapter_names ("adapter-N"). A unit-only enum has an
    /// empty row: it can hold no text.
    const ENUM_FIELDS: [(&str, &str, &str, &str); 13] = [
        ("Snapshot",
         "Service.prior_state Service.prior_start_mode StartupApproval.prior_bytes StartupApproval.prior_vtype GameMode.prior_enabled GameMode.prior_allow MouseAccel.prior_speed MouseAccel.prior_threshold1 MouseAccel.prior_threshold2 GameBar.prior_capture GameBar.prior_enabled VisualEffects.vfx_setting_prior VisualEffects.user_prefs_mask_prior HwSchMode.prior NagleNics.interfaces FastStartup.prior_hiberboot ReservedStorage.prior_enabled PowerPlanSetting.subgroup_guid PowerPlanSetting.setting_guid PowerPlanSetting.prior_ac_value PowerPlanSetting.prior_dc_value EeeNicProperty.adapters MemoryCompression.prior_enabled Mmcss.prior_system_responsiveness Mmcss.prior_network_throttling PrioritySeparation.prior_value Mpo.prior_overlay_test_mode CoreParking.prior_ac_pct CoreParking.prior_dc_pct TcpAutotuning.prior_disabled PagefileManual.prior_drive_letter PagefileManual.prior_initial_mb PagefileManual.prior_maximum_mb ScheduledTask.prior_state",
         "PreloadApp.prior_full_name PreloadApp.prior_family_name PreloadApp.prior_version",
         "StartupApproval.name PowerPlan.prior_guid PowerPlanSetting.plan_guid CoreParking.plan_guid"),
        ("AppliedAction",
         "DisableKnownService.service SetStartupEntryEnabled.enabled SuspendKnownService.service DisableScheduledTask.task RemovePreloadApp.app",
         "",
         "SetStartupEntryEnabled.name"),
        ("RollbackAction", "RestoreServiceFromSnapshot.service ResumeServiceFromSnapshot.service EnableScheduledTask.task ReinstallPreloadApp.app", "", ""),
        ("ObservedState", "", "", "PowerPlan.guid PowerPlan.name"),
        ("ActiveCheck", "", "", ""),
        ("Provenance", "", "", ""),
        ("KnownService", "", "", ""),
        ("KnownBloatTask", "", "", ""),
        ("KnownPreloadApp", "", "", ""),
        ("ReadinessStatus", "", "", ""),
        ("DimensionRisk", "", "", ""),
        ("VbsState", "", "", ""),
        ("GamingModePlan", "", "", ""),
    ];

    /// Object keys are never rewritten by the redaction (`map_strings` rewrites values only), so a record
    /// field that is a map keyed by text, or free JSON (`serde_json::Value`, whose objects can have any keys),
    /// would carry its keys out of the export unredacted. None exists among the exported records except those
    /// named here, each with why its keys hold no typed name. (A type alias for a map is not seen: none of the
    /// exported records uses one.)
    const TEXT_KEYED_MAPS: [(&str, &str, &str); 1] = [(
        "AppliedChangeView",
        "snapshot",
        "the undo record of a Trust Ledger change: for a change recorded by this or any typed build, a serialized \
         Snapshot, whose keys are its serde field names (every variant field is classed in ENUM_FIELDS); for a change \
         recorded before typed snapshots, the older build's fixed setting keys for that kind of change (prior, \
         prior_state, interfaces, prior_plan_guid and the rest that actions::synthesize_legacy_rollback reads). Its \
         keys pass through as written; every value goes through every pass of redact_export_sources.",
    )];

    fn assert_no_text_keyed_map(record: &str, field: &str, ty: &str) {
        let compact: String = ty.chars().filter(|c| !c.is_whitespace()).collect();
        let free_json = ty.split(|c: char| !(c.is_alphanumeric() || c == '_')).any(|ident| ident == "Value");
        let text_keyed = free_json || ["HashMap<String", "BTreeMap<String", "Map<String", "HashMap<&str", "BTreeMap<&str"].iter().any(|m| compact.contains(m));
        assert!(
            !text_keyed || TEXT_KEYED_MAPS.iter().any(|(r, f, _)| *r == record && *f == field),
            "{record}.{field} is a map keyed by text or free JSON ({ty}): its keys reach the export unredacted. Make it a list of records, or add it to TEXT_KEYED_MAPS with why its keys hold no typed name"
        );
    }

    /// The `enum <name> {` body's fields as (`Variant.field` or `Variant.N`, type text); None if not found.
    /// PANICS on a body it cannot read, so a variant field can never go unclassified because the parser
    /// could not see it.
    fn enum_fields_in(src: &str, name: &str) -> Option<Vec<(String, String)>> {
        let head = format!("enum {name} {{");
        let lines: Vec<&str> = src.lines().collect();
        let at = lines.iter().position(|l| {
            let t = l.trim_start();
            let t = t.strip_prefix("pub(crate) ").or_else(|| t.strip_prefix("pub(super) ")).or_else(|| t.strip_prefix("pub ")).unwrap_or(t);
            t.starts_with(&head)
        })?;
        // The body without comments and attribute lines, as one string.
        let mut body = String::new();
        for l in &lines[at + 1..] {
            if l.starts_with('}') {
                break;
            }
            let code = l.split("//").next().unwrap_or("").trim();
            if code.is_empty() || code.starts_with("#[") {
                continue;
            }
            assert!(!code.contains("#["), "enum {name}: an attribute inside a line (`{code}`): put it on its own line, or extend enum_fields_in");
            body.push_str(code);
            body.push(' ');
        }
        // Split at top-level commas, tracking {} () <> depth.
        fn split_top(s: &str) -> Vec<String> {
            let (mut out, mut cur, mut depth) = (Vec::new(), String::new(), 0i32);
            for c in s.chars() {
                match c {
                    '{' | '(' | '<' => depth += 1,
                    '}' | ')' | '>' => depth -= 1,
                    ',' if depth == 0 => {
                        out.push(std::mem::take(&mut cur));
                        continue;
                    }
                    _ => {}
                }
                cur.push(c);
            }
            out.push(cur);
            out.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
        }
        let ident_ok = |s: &str, upper: bool| {
            !s.is_empty()
                && s.chars().next().is_some_and(|c| if upper { c.is_ascii_uppercase() } else { c.is_ascii_lowercase() })
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        };
        let mut out = Vec::new();
        for variant in split_top(&body) {
            let cut = variant.find(['{', '(']).unwrap_or(variant.len());
            let vname = variant[..cut].trim();
            assert!(ident_ok(vname, true), "enum {name}: cannot read the variant `{variant}`, or extend enum_fields_in");
            let rest = variant[cut..].trim();
            if rest.is_empty() {
                continue;
            }
            let inner = &rest[1..rest.len() - 1];
            if rest.starts_with('{') {
                for f in split_top(inner) {
                    let f = f.strip_prefix("pub(crate) ").or_else(|| f.strip_prefix("pub ")).unwrap_or(&f).to_string();
                    let (field, ty) = f.split_once(':').unwrap_or_else(|| panic!("enum {name}: cannot read the field `{f}` of {vname}"));
                    assert!(ident_ok(field.trim(), false), "enum {name}: cannot read the field name `{field}` of {vname} (no r#name), or extend enum_fields_in");
                    out.push((format!("{vname}.{}", field.trim()), ty.trim().to_string()));
                }
            } else {
                for (i, ty) in split_top(inner).into_iter().enumerate() {
                    out.push((format!("{vname}.{i}"), ty));
                }
            }
        }
        Some(out)
    }

    /// The names of the `enum Name {` types a source defines.
    fn enums_defined_in(src: &str) -> Vec<String> {
        let mut names = Vec::new();
        for l in src.lines() {
            let t = l.trim_start();
            let t = t.strip_prefix("pub(crate) ").or_else(|| t.strip_prefix("pub(super) ")).or_else(|| t.strip_prefix("pub ")).unwrap_or(t);
            if let Some(rest) = t.strip_prefix("enum ").filter(|r| r.trim_end().ends_with('{')) {
                names.push(rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect());
            }
        }
        names
    }

    #[test]
    fn the_enum_parser_reads_struct_tuple_and_unit_variants_and_fails_on_what_it_cannot_read() {
        let ok = "pub(crate) enum E {\n    /// doc\n    A { name: String, n: u32 },\n    #[serde(other)]\n    B,\n    C {\n        prior: Option<Vec<u8>>,\n        #[serde(default)]\n        map: HashMap<String, u32>,\n    },\n    D(String, u8), // note\n}\n";
        let got = enum_fields_in(ok, "E").expect("found");
        let names: Vec<&str> = got.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["A.name", "A.n", "C.prior", "C.map", "D.0", "D.1"]);
        assert_eq!(got[3].1, "HashMap<String, u32>");
        assert!(enum_fields_in(ok, "Missing").is_none());
        assert_eq!(enums_defined_in("pub(crate) enum A {\nenum B {\nenum C;\n"), ["A", "B"]);
        for (bad, why) in [("enum E {\n    A { r#type: String },\n}\n", "a raw identifier"), ("enum E {\n    a,\n}\n", "a lower-case variant"), ("enum E {\n    A { #[serde(default)] x: u8 },\n}\n", "an attribute inside a line")] {
            assert!(std::panic::catch_unwind(|| enum_fields_in(bad, "E")).is_err(), "{why} must fail, not be skipped");
        }
        let map_field = std::panic::catch_unwind(|| assert_no_text_keyed_map("R", "f", "BTreeMap<String, Vec<u8>>"));
        assert!(map_field.is_err(), "a text-keyed map must fail");
        assert_no_text_keyed_map("R", "f", "Vec<(String, u32)>");
    }

    #[test]
    fn every_field_of_the_exported_enums_is_classified_and_a_new_variant_field_fails_this_test() {
        let structs: HashSet<String> = RECORD_SOURCES.iter().flat_map(|src| structs_defined_in(src)).collect();
        let listed: HashSet<&str> = RECORD_FIELDS.iter().map(|(n, ..)| *n).collect();
        let enums: HashSet<String> = RECORD_SOURCES.iter().flat_map(|src| enums_defined_in(src)).collect();
        let enum_listed: HashSet<&str> = ENUM_FIELDS.iter().map(|(n, ..)| *n).collect();
        for (name, safe, hardware, redacted) in ENUM_FIELDS {
            let fields = RECORD_SOURCES
                .iter()
                .find_map(|src| enum_fields_in(src, name))
                .unwrap_or_else(|| panic!("enum {name} is not found in the record sources: renamed or moved? update ENUM_FIELDS and RECORD_SOURCES"));
            let all: Vec<&str> = [safe, hardware, redacted].iter().flat_map(|c| c.split_whitespace()).collect();
            for (field, ty) in &fields {
                let classes = all.iter().filter(|f| **f == field).count();
                assert!(classes == 1, "{name}::{field} is {}: classify it exactly once in ENUM_FIELDS (safe, hardware text or redacted text)", if classes == 0 { "NEW and unclassified" } else { "classified twice" });
                for ident in ty.split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|i| i.chars().next().is_some_and(char::is_uppercase)) {
                    assert!(!structs.contains(ident) || listed.contains(ident), "{name}::{field} holds the record {ident}, which has no row in RECORD_FIELDS");
                    assert!(!enums.contains(ident) || enum_listed.contains(ident), "{name}::{field} holds the enum {ident}, which has no row in ENUM_FIELDS");
                }
                assert_no_text_keyed_map(name, field, ty);
            }
            for f in all {
                assert!(fields.iter().any(|(n, _)| n == f), "{name}::{f} is classified but the enum no longer has it: remove it from ENUM_FIELDS");
            }
        }
        assert!(enum_listed.len() == ENUM_FIELDS.len(), "an enum is listed twice");
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

/// The generated word list (`export_words.txt`) and the guard that no program code embeds source text.
///
/// The lexer here reads Rust source the way the repo's other source guards do (comments, strings, raw
/// strings and char literals are told apart, so a brace or a quote inside one is not code), and drops every
/// `#[cfg(test)]` / `#[test]` item by real bracket depth, never by "the next closing line".
#[cfg(test)]
mod export_words_guard {
    use std::collections::{BTreeSet, HashSet};
    use std::path::{Path, PathBuf};

    #[derive(Debug, Clone, PartialEq)]
    enum Tok {
        Str(String),
        Ident(String),
        P(char),
    }

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn src_dir() -> PathBuf {
        manifest_dir().join("src")
    }

    /// Tokens of `src`: string contents (escapes dropped with the escaped character), identifiers, and every other
    /// non-space character. Comments, char literals and lifetimes produce nothing.
    fn lex(src: &str) -> Vec<Tok> {
        let c: Vec<char> = src.chars().collect();
        let ident = |ch: char| ch.is_alphanumeric() || ch == '_';
        let (mut out, mut i) = (Vec::new(), 0usize);
        while i < c.len() {
            let (ch, next) = (c[i], c.get(i + 1).copied());
            if ch == '/' && next == Some('/') {
                while i < c.len() && c[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            if ch == '/' && next == Some('*') {
                let mut depth = 0;
                while i < c.len() {
                    if c[i] == '/' && c.get(i + 1) == Some(&'*') {
                        depth += 1;
                        i += 2;
                    } else if c[i] == '*' && c.get(i + 1) == Some(&'/') {
                        depth -= 1;
                        i += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
                continue;
            }
            // A raw string: r"..", r#".."#, br#".."#.
            if (ch == 'r' || (ch == 'b' && next == Some('r'))) && (i == 0 || !ident(c[i - 1])) {
                let (mut j, mut hashes) = (i + if ch == 'b' { 2 } else { 1 }, 0usize);
                while c.get(j) == Some(&'#') {
                    hashes += 1;
                    j += 1;
                }
                if c.get(j) == Some(&'"') {
                    j += 1;
                    let mut s = String::new();
                    while j < c.len() && !(c[j] == '"' && (1..=hashes).all(|k| c.get(j + k) == Some(&'#'))) {
                        s.push(c[j]);
                        j += 1;
                    }
                    out.push(Tok::Str(s));
                    i = j + 1 + hashes;
                    continue;
                }
            }
            if ch == '"' {
                i += 1;
                let mut s = String::new();
                while i < c.len() && c[i] != '"' {
                    if c[i] == '\\' {
                        i += 1;
                    } else {
                        s.push(c[i]);
                    }
                    i += 1;
                }
                out.push(Tok::Str(s));
                i += 1;
                continue;
            }
            if ch == '\'' {
                // '\n', '\'', '\u{..}' skip to the closing quote; 'x' is three characters; anything else is a lifetime.
                if next == Some('\\') {
                    i += 3;
                    while i < c.len() && c[i] != '\'' {
                        i += 1;
                    }
                    i += 1;
                } else if c.get(i + 2) == Some(&'\'') {
                    i += 3;
                } else {
                    i += 1;
                }
                continue;
            }
            if ident(ch) {
                let start = i;
                while i < c.len() && ident(c[i]) {
                    i += 1;
                }
                out.push(Tok::Ident(c[start..i].iter().collect()));
                continue;
            }
            if !ch.is_whitespace() {
                out.push(Tok::P(ch));
            }
            i += 1;
        }
        out
    }

    /// The length in tokens of a `#[cfg(test)]` or `#[test]` attribute at the start of `t`.
    fn test_attr_len(t: &[Tok]) -> Option<usize> {
        let id = |k: usize, name: &str| matches!(t.get(k), Some(Tok::Ident(x)) if x == name);
        let p = |k: usize, ch: char| t.get(k) == Some(&Tok::P(ch));
        if !(p(0, '#') && p(1, '[')) {
            return None;
        }
        if id(2, "test") && p(3, ']') {
            return Some(4);
        }
        (id(2, "cfg") && p(3, '(') && id(4, "test") && p(5, ')') && p(6, ']')).then_some(7)
    }

    /// Skip the further attributes of an item and then the item itself, by bracket depth: through its `;` at depth
    /// zero, or the `}` that closes its first brace block. Returns the index just past it.
    fn skip_item(t: &[Tok], mut i: usize) -> usize {
        while t.get(i) == Some(&Tok::P('#')) && t.get(i + 1) == Some(&Tok::P('[')) {
            let mut depth = 0;
            while i < t.len() {
                match &t[i] {
                    Tok::P('[') => depth += 1,
                    Tok::P(']') => {
                        depth -= 1;
                        if depth == 0 {
                            i += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
        }
        let mut depth = 0i32;
        while i < t.len() {
            match &t[i] {
                Tok::P('(' | '[' | '{') => depth += 1,
                Tok::P(')' | ']') => depth -= 1,
                Tok::P('}') => {
                    depth -= 1;
                    if depth <= 0 {
                        return i + 1;
                    }
                }
                Tok::P(';') if depth == 0 => return i + 1,
                _ => {}
            }
            i += 1;
        }
        i
    }

    /// The tokens outside every `#[cfg(test)]` / `#[test]` item.
    fn production(t: &[Tok]) -> Vec<Tok> {
        let (mut out, mut i) = (Vec::new(), 0usize);
        while i < t.len() {
            if let Some(n) = test_attr_len(&t[i..]) {
                i = skip_item(t, i + n);
            } else {
                out.push(t[i].clone());
                i += 1;
            }
        }
        out
    }

    /// The files whose words are the export's static text.
    const WORD_SOURCES: [&str; 9] = [
        "export.rs", "readiness.rs", "hardware.rs", "diagnostics.rs", "recommendations.rs", "history.rs", "drift.rs", "sessions.rs", "stutter.rs",
    ];

    fn add_words(text: &str, words: &mut BTreeSet<String>) {
        words.extend(text.split(|ch: char| !ch.is_alphabetic()).filter(|w| w.chars().count() >= 3).map(str::to_lowercase));
    }

    /// The list as the file must hold it: lower-case alphabetic words of 3+ letters from the string literals of the
    /// non-test code of [`WORD_SOURCES`] and from the rules file, sorted, one per line.
    fn generated_list() -> String {
        let mut words = BTreeSet::new();
        for f in WORD_SOURCES {
            let src = std::fs::read_to_string(src_dir().join(f)).unwrap_or_else(|e| panic!("cannot read {f}: {e}"));
            for t in production(&lex(&src)) {
                if let Tok::Str(s) = t {
                    add_words(&s, &mut words);
                }
            }
        }
        let rules = std::fs::read_to_string(manifest_dir().join("resources").join("baseline-rules-v1.json")).expect("rules file");
        add_words(&rules, &mut words);
        let mut text = words.into_iter().collect::<Vec<_>>().join("\n");
        text.push('\n');
        text
    }

    const REFRESH_VAR: &str = "COMPY_REFRESH_EXPORT_WORDS";

    #[test]
    fn export_words_txt_is_the_current_list_from_the_sources() {
        let want = generated_list();
        let path = src_dir().join("export_words.txt");
        if std::env::var_os(REFRESH_VAR).is_some() {
            std::fs::write(&path, &want).expect("write export_words.txt");
            return;
        }
        let have = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
        if have != want {
            let (h, w): (BTreeSet<&str>, BTreeSet<&str>) = (have.lines().collect(), want.lines().collect());
            let added: Vec<&&str> = w.difference(&h).take(8).collect();
            let removed: Vec<&&str> = h.difference(&w).take(8).collect();
            panic!(
                "src-tauri/src/export_words.txt is stale: the export's static text changed and the word list was not regenerated \
                 (new words such as {added:?}, gone words such as {removed:?}). Refresh it and commit the file: \
                 in PowerShell run `$env:{REFRESH_VAR}=1; cargo test --lib export_words_txt_is_the_current_list; Remove-Item Env:{REFRESH_VAR}`."
            );
        }
    }

    #[test]
    fn the_word_list_holds_export_text_and_no_test_text() {
        let list = std::fs::read_to_string(src_dir().join("export_words.txt")).expect("list");
        let words: HashSet<&str> = list.lines().collect();
        assert!(words.len() > 800, "the list is a few thousand words, not {}", words.len());
        assert!(list.len() < 60_000, "a word list, not source text: {} bytes", list.len());
        for w in ["connected", "refresh", "hardware"] {
            assert!(words.contains(w), "{w} is a word of the export's own text");
        }
        for w in ["zorvak", "canary", "zorvakprofile"] {
            assert!(!words.contains(w), "{w} is a test fixture, not export text");
        }
        assert!(list.lines().all(|l| l.chars().all(char::is_alphabetic) && l == l.to_lowercase()), "one lower-case word per line");
    }

    #[test]
    fn the_generator_skips_test_items_by_bracket_depth_and_reads_literals_properly() {
        let src = r##"
const A: &str = "alpha // { ";
const B: char = '{';
const C: &str = r#"bravo "quoted" }"#;
#[cfg(test)]
mod early_tests { fn f() { let _ = "zebra"; if true { let _ = "}"; } let _ = '}'; } }
fn prod(x: &'static str) -> &'static str { "charlie" }
#[cfg(test)]
fn helper(a: [u8; 3]) -> &'static str { "yankee" }
#[test]
fn a_test() { let _ = "xray"; }
#[cfg(test)]
const T: &[&str] = &["whiskey"];
const D: &str = "delta\n";
/* "block comment string" */
#[cfg(test)]
#[allow(dead_code)]
mod late_tests { const S: &str = "victor"; mod inner { const X: &str = "uniform"; } }
const LAST: &str = "foxtrot";
"##;
        let mut words = BTreeSet::new();
        for t in production(&lex(src)) {
            if let Tok::Str(s) = t {
                add_words(&s, &mut words);
            }
        }
        let got: Vec<&str> = words.iter().map(String::as_str).collect();
        assert_eq!(got, ["alpha", "bravo", "charlie", "delta", "foxtrot", "quoted"], "production literals only, nothing from a test item");
    }

    fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).expect("read dir").filter_map(|e| e.ok().map(|e| e.path())).collect();
        entries.sort();
        for p in entries {
            if p.is_dir() {
                rs_files(&p, out);
            } else if p.extension().is_some_and(|e| e == "rs") {
                out.push(p);
            }
        }
    }

    /// Module files that exist only under `#[cfg(test)] mod name;` in their parent (a whole-file test module).
    fn test_only_modules(files: &[(PathBuf, Vec<Tok>)]) -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        for (path, toks) in files {
            let (dir, stem) = (path.parent().unwrap(), path.file_stem().unwrap().to_string_lossy().to_string());
            let module_dir = if matches!(stem.as_str(), "lib" | "main" | "mod") { dir.to_path_buf() } else { dir.join(&stem) };
            let mut i = 0;
            while i < toks.len() {
                if let Some(n) = test_attr_len(&toks[i..]) {
                    let mut j = i + n;
                    while matches!(toks.get(j), Some(Tok::Ident(x)) if x == "pub") {
                        j += 1;
                        if toks.get(j) == Some(&Tok::P('(')) {
                            while j < toks.len() && toks[j] != Tok::P(')') {
                                j += 1;
                            }
                            j += 1;
                        }
                    }
                    if let (Some(Tok::Ident(m)), Some(Tok::Ident(name)), Some(Tok::P(';'))) = (toks.get(j), toks.get(j + 1), toks.get(j + 2)) {
                        if m == "mod" {
                            dirs.push(module_dir.join(name));
                        }
                    }
                }
                i += 1;
            }
        }
        dirs
    }

    const SOURCE_EXTENSIONS: [&str; 6] = [".rs", ".tsx", ".ts", ".jsx", ".js", ".mjs"];

    /// What a production token stream embeds: `include_str!` / `include_bytes!` / `include!` of a source file, or
    /// with an argument that is not one plain string literal (so it cannot be checked).
    fn embeds(toks: &[Tok]) -> Vec<String> {
        let mut found = Vec::new();
        for w in toks.windows(4) {
            let (Tok::Ident(mac), Tok::P('!'), Tok::P('(')) = (&w[0], &w[1], &w[2]) else { continue };
            if !matches!(mac.as_str(), "include_str" | "include_bytes" | "include") {
                continue;
            }
            match &w[3] {
                Tok::Str(p) if SOURCE_EXTENSIONS.iter().any(|e| p.to_lowercase().ends_with(e)) => found.push(format!("{mac}!(\"{p}\") embeds a source file")),
                Tok::Str(_) => {}
                other => found.push(format!("{mac}!({other:?}..) is not one plain string literal")),
            }
        }
        found
    }

    #[test]
    fn no_program_code_embeds_source_text() {
        let mut paths = Vec::new();
        rs_files(&src_dir(), &mut paths);
        let files: Vec<(PathBuf, Vec<Tok>)> = paths.into_iter().map(|p| {
            let toks = lex(&std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("cannot read {}: {e}", p.display())));
            (p, toks)
        }).collect();
        let test_dirs = test_only_modules(&files);
        let is_test_file = |p: &Path| test_dirs.iter().any(|d| p == d.with_extension("rs") || p == d.join("mod.rs") || p.starts_with(d));
        assert!(files.len() > 50, "the source tree was found");
        let mut bad = Vec::new();
        for (path, toks) in &files {
            if is_test_file(path) {
                continue;
            }
            for what in embeds(&production(toks)) {
                bad.push(format!("{}: {what}", path.strip_prefix(manifest_dir()).unwrap_or(path).display()));
            }
        }
        assert!(
            bad.is_empty(),
            "program (non-test) code must never include_str!/include_bytes! source text: it would be compiled into the shipped binary \
             (and could carry names). Read the file at test time instead. Found: {bad:#?}"
        );
    }

    #[test]
    fn the_embed_guard_sees_production_includes_only() {
        let hit = |src: &str| embeds(&production(&lex(src)));
        assert_eq!(hit(r#"fn f() -> &'static str { include_str!("export.rs") }"#).len(), 1);
        assert_eq!(hit(r#"const B: &[u8] = include_bytes!("../x/view.tsx");"#).len(), 1);
        assert_eq!(hit(r#"static S: &str = include_str!("a/b.TS");"#).len(), 1);
        assert_eq!(hit(r#"static S: &str = include_str!(concat!(env!("D"), "/x.rs"));"#).len(), 1, "an unreadable argument fails too");
        assert!(hit(r#"const R: &str = include_str!("../resources/rules.json"); const W: &str = include_str!("export_words.txt");"#).is_empty());
        assert!(hit("#[cfg(test)]\nmod tests { fn f() { let _ = include_str!(\"export.rs\"); } }").is_empty(), "a test module may read its own source");
        assert!(hit("#[test]\nfn t() { let _ = include_str!(\"export.rs\"); }").is_empty());
        assert!(hit("// include_str!(\"export.rs\")\nconst S: &str = \"include_str!(\\\"export.rs\\\")\";").is_empty(), "a comment or a string is not an include");
    }
}
