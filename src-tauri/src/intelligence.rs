// intelligence.rs — Intelligence Phase 1: canonical intelligence types, the local event
// timeline, and the deterministic "What changed?" engine.
//
// Doctrine (owner directive 2026-07-16, decision record
// docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md):
//   - READ-ONLY. This module never mutates Windows state and never talks to the network.
//     Its only write is its own store (`intelligence.json` under compy_data_dir()).
//   - NEVER fabricate. Every EventRecord timestamp is copied verbatim from a persisted
//     source record. Changes Compy only *noticed* (driver/Windows/power-plan deltas between
//     probes) carry explicit `observed_between` bounds — an observation window, never an
//     invented occurrence time. Rollbacks have no recorded timestamp in the Trust Ledger,
//     so the timeline NEVER emits a rollback event (the apply event says "since rolled back").
//   - Confidence is a rule-derived BAND (unknown/low/medium/high). No numeric confidence
//     exists anywhere in this module: Compy has no calibration data, so a percentage would
//     be probability theater.
//   - Correlation is never causation: copy says "changed between these sessions", never
//     "caused by". Multiple simultaneous changes ⇒ attribution is refused (confounded),
//     mirroring comparison.rs semantics.
//   - Metric judgment reuses METHODOLOGY.md rails verbatim: flat 3% cross-session noise
//     floor (benchmark::DEFAULT_NOISE_FLOOR_PCT) judged on the 1%-low delta, boundary
//     inclusive (a delta of exactly 3% is "no meaningful difference"); average FPS is
//     reference-only; "No meaningful difference" is a first-class verdict.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

// ─── Canonical types (§5B) ───────────────────────────────────────────────

/// Rule-derived confidence band. Deliberately NOT numeric — no calibration data exists,
/// so a percentage would be fabricated precision. Variant order matters: it is the ranking
/// order (`Unknown < Low < Medium < High`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Confidence {
    Unknown,
    Low,
    Medium,
    High,
}

/// Who/what an event is attributable to. `Observed` is for changes Compy noticed between
/// probes (driver updates, Windows builds…) — external changes are NEVER presented as
/// Compy-applied (anti-fabrication guard).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EventScope {
    /// Compy did this (Trust-Ledger apply, Gaming Mode session).
    CompyApplied,
    /// Compy measured this (FPS session, benchmark, A/B verdict).
    Measurement,
    /// Compy noticed this changed without witnessing who or what changed it
    /// (driver/Windows/power/hardware change, readiness drift).
    Observed,
}

/// One timeline entry. Every field is derived from a persisted record; `timestamp` is
/// copied from the source, never synthesized.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct EventRecord {
    /// Deterministic id: `<kind-prefix>:<source-key>` — stable across rebuilds.
    pub id: String,
    /// RFC3339. For `Observed` deltas this is the LATER bound of the observation window.
    pub timestamp: String,
    pub event_type: String,
    /// Which store produced it (trust-ledger, sessions, gaming-session, scoreboard,
    /// benchmark, comparison, identity-snapshot, rig-fingerprint).
    pub source: String,
    pub scope: EventScope,
    pub game: Option<String>,
    pub summary: String,
    pub detail: Option<String>,
    /// For observed changes: the two probe timestamps bounding when it happened.
    /// "Observed between X and Y" — the exact moment was not witnessed.
    pub observed_between: Option<(String, String)>,
    /// Apply events only: the ledger says this change was later rolled back. Rollbacks
    /// stamped from Intelligence Phase 2 on (`rolled_back_at`) also appear as their own
    /// dated `change-rolled-back` event; older rollbacks have no recorded time, so this
    /// flag is their only honest trace — never retro-dated into an event.
    pub since_rolled_back: bool,
    /// Trust-Ledger events ONLY: the catalog recommendation id, copied verbatim off the
    /// ledger row. `None` for every other source, which has no rec behind it.
    ///
    /// It exists so a downstream suggestion can name a REAL rec instead of matching prose.
    /// The id is READ, never inferred — nothing here parses `summary`, guesses from a title,
    /// or maps free text onto the catalog. That is the whole point: the alternative
    /// (prose → rec) would be fabrication.
    pub rec_id: Option<String>,
    /// P6-changed-f1: the same facts as `summary`, as data, so the frontend composes the
    /// line in the viewer's language instead of showing this English sentence. Values (driver
    /// versions, plan names, change titles, game names) stay as recorded; only the words around
    /// them are translated. `None` for kinds without structured parts, and for rows built
    /// before the field existed: the frontend then shows `summary`, which stays the fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<EventParts>,
}

/// The structured facts behind an [`EventRecord`]'s `summary`, by event kind. Built at the
/// same place, from the same values, as the sentence; never parsed back out of it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum EventParts {
    /// `change-applied`; the rolled-back state is the record's `since_rolled_back`.
    Applied { title: String },
    /// `change-rolled-back`.
    RolledBack { title: String },
    /// `gpu-driver-change`.
    GpuDriver { from: String, to: String },
    /// `windows-build-change`; `from`/`to` are the build strings as shown today.
    WindowsBuild { from: String, to: String },
    /// `power-plan-change`.
    PowerPlan { from: String, to: String },
    /// `hardware-change`: one entry per part that changed, in the summary's order.
    Hardware { changes: Vec<HardwarePartChange> },
    /// `readiness-drift`: the readiness check's own label.
    Drift { label: String },
    /// `session`: `fps` is (avg, 1% low) already rounded exactly as the summary rounds them
    /// (`{:.0}`), so both languages show the same numbers; `None` when nothing was measured.
    Session { game: String, duration_secs: u64, fps: Option<(String, String)> },
    /// `benchmark-baseline`.
    BenchmarkBaseline,
}

/// One hardware part in a `hardware-change` event.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct HardwarePartChange {
    /// "gpu" | "ram" | "display".
    pub part: &'static str,
    pub from: String,
    pub to: String,
}

// ─── Identity snapshots (decision 3 — honest from-now-on persistence) ────

/// One probe of the machine's software/hardware identity. Appended only when something
/// changed vs the previous snapshot (plus first run) — an append-only log inside
/// intelligence.json. History starts when recording starts; nothing is backfilled.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct IdentitySnapshot {
    pub observed_at: String, // RFC3339 UTC — when Compy looked, not when anything changed
    #[serde(default)]
    pub gpu: String,
    #[serde(default)]
    pub gpu_driver: String,
    #[serde(default)]
    pub gpu_driver_date: String,
    #[serde(default)]
    pub windows_build: String,
    #[serde(default)]
    pub windows_ubr: Option<u32>,
    #[serde(default)]
    pub windows_display_version: String,
    #[serde(default)]
    pub power_plan: String,
    #[serde(default)]
    pub ram_gb: u32,
    #[serde(default)]
    pub display: String,
    #[serde(default)]
    pub hw_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub(crate) struct IntelligenceStore {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub identity_snapshots: Vec<IdentitySnapshot>,
}

const STORE_SCHEMA_VERSION: u32 = 1;
/// Generous bound (identity changes are rare — this is years of history). Oldest entries
/// drop first; the timeline simply starts later, it never invents what fell off.
///
/// Coupled (#456): `machine_model::MAX_OBSERVED_CHRONOLOGY` is written out from this count ×
/// [`OBSERVED_KINDS_PER_READING`]. Move this and that ceiling's test fails until the ceiling is
/// moved on purpose — every `get_machine_model` payload grows with it.
pub(crate) const MAX_IDENTITY_SNAPSHOTS: usize = 500;
/// The most observed-change events ONE identity reading can add to the timeline.
/// `IdentityDeltaScan::feed` folds GPU, RAM and display into a single `hardware-change`, then emits
/// at most one `gpu-driver-change`, one `windows-build-change` and one `power-plan-change`: four
/// kinds, each at most once per reading (`feed` debug-asserts it;
/// `one_identity_reading_adds_at_most_the_declared_observed_kinds` pins it).
/// `machine_model::MAX_OBSERVED_CHRONOLOGY` is written out from this (#456).
pub(crate) const OBSERVED_KINDS_PER_READING: usize = 4;
/// At most one identity probe per this interval (probes run on app start + on intelligence
/// command calls — no mid-run polling; the cadence limit is stated in probe copy).
const IDENTITY_REFRESH_MIN_SECS: u64 = 600;

fn store_path() -> PathBuf {
    crate::compy_data_dir().join("intelligence.json")
}

/// Load, failing SAFE on corruption: the damaged file is set aside as `.corrupt`
/// (preserved for recovery, same idiom as the other stores), and we start fresh —
/// never parse-partially, never overwrite the bytes in place.
pub(crate) fn load_store_from(path: &Path) -> IntelligenceStore {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return IntelligenceStore::default(), // absent = first run
    };
    match serde_json::from_str::<IntelligenceStore>(&raw) {
        Ok(store) => store,
        Err(_) => {
            let corrupt = path.with_extension("json.corrupt");
            let _ = std::fs::remove_file(&corrupt);
            let _ = std::fs::rename(path, &corrupt);
            IntelligenceStore::default()
        }
    }
}

/// Read the persisted store. READ-ONLY: this never refreshes or appends a snapshot (the retired
/// timeline command did, #453), which is why the Machine Model composes from it.
pub(crate) fn load_store() -> IntelligenceStore {
    load_store_from(&store_path())
}

/// Atomic write (tmp + rename) so a crash mid-write can't corrupt the log.
pub(crate) fn save_store_to(path: &Path, store: &IntelligenceStore) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn save_store(store: &IntelligenceStore) -> Result<(), String> {
    save_store_to(&store_path(), store)
}

/// A string field "changed" only when BOTH probes actually read a value — a failed probe
/// (empty string) is missing data, never evidence of a change (anti-fabrication).
fn str_changed(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && a != b
}

/// Append `snap` iff it adds information vs the latest snapshot: a real change in any
/// identity field, or a field going unknown→known (information gain — recorded but never
/// presented as a change event). A field going known→unknown is a probe failure and
/// contributes nothing.
pub(crate) fn append_if_changed(store: &mut IntelligenceStore, snap: IdentitySnapshot) -> bool {
    store.schema_version = STORE_SCHEMA_VERSION;
    let Some(last) = store.identity_snapshots.last() else {
        store.identity_snapshots.push(snap); // first run — establish the baseline
        return true;
    };
    let gained_str = |a: &str, b: &str| a.is_empty() && !b.is_empty();
    let should = str_changed(&last.gpu, &snap.gpu)
        || gained_str(&last.gpu, &snap.gpu)
        || str_changed(&last.gpu_driver, &snap.gpu_driver)
        || gained_str(&last.gpu_driver, &snap.gpu_driver)
        || str_changed(&last.windows_build, &snap.windows_build)
        || gained_str(&last.windows_build, &snap.windows_build)
        || match (last.windows_ubr, snap.windows_ubr) {
            (Some(a), Some(b)) => a != b,
            (None, Some(_)) => true,
            _ => false,
        }
        || str_changed(&last.windows_display_version, &snap.windows_display_version)
        || gained_str(&last.windows_display_version, &snap.windows_display_version)
        || str_changed(&last.power_plan, &snap.power_plan)
        || gained_str(&last.power_plan, &snap.power_plan)
        || (last.ram_gb > 0 && snap.ram_gb > 0 && last.ram_gb != snap.ram_gb)
        || (last.ram_gb == 0 && snap.ram_gb > 0)
        || str_changed(&last.display, &snap.display)
        || gained_str(&last.display, &snap.display);
    if should {
        store.identity_snapshots.push(snap);
        let len = store.identity_snapshots.len();
        if len > MAX_IDENTITY_SNAPSHOTS {
            store.identity_snapshots.drain(0..len - MAX_IDENTITY_SNAPSHOTS);
        }
    }
    should
}

fn capture_identity_snapshot() -> IdentitySnapshot {
    let fp = crate::hardware::current_fingerprint();
    let hw = crate::hardware::get_hardware_info();
    let primary = hw.gpus.iter().max_by_key(|g| g.vram_bytes);
    let win = crate::hardware::detect_windows_version();
    IdentitySnapshot {
        observed_at: Utc::now().to_rfc3339(),
        gpu: fp.gpu.clone(),
        gpu_driver: fp.gpu_driver.clone(),
        gpu_driver_date: primary.map(|g| g.driver_date.clone()).unwrap_or_default(),
        windows_build: win.as_ref().map(|w| w.build.clone()).unwrap_or_default(),
        windows_ubr: win.as_ref().map(|w| w.ubr),
        windows_display_version: win.map(|w| w.display_version).unwrap_or_default(),
        power_plan: crate::current_power_plan_name().unwrap_or_default(),
        ram_gb: fp.ram_gb,
        display: fp.display.clone(),
        hw_hash: fp.hash,
    }
}

fn store_write_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

/// The only way this crate takes the identity-log gate. Records the acquisition, then blocks.
///
/// #398: a process-wide gate around a persisted read-modify-write (`load_store` →
/// `append_if_changed` → `save_store`) is a store lock and belongs in `race_seam::StoreLock`, even
/// though it happens to be a leaf — nothing inside this critical section reaches another store, and
/// `capture_identity_snapshot` runs BEFORE the gate is taken, deliberately, so the probe never runs
/// under the lock. Recording it is what makes that leaf claim falsifiable rather than asserted: if a
/// future edit calls into another store from in here, the recorder panics by name instead of the
/// nesting going unnoticed. Poison policy unchanged: refuse to write, never recover.
pub(crate) fn lock_store() -> Result<crate::race_seam::StoreGuard, ()> {
    crate::race_seam::try_hold_lock(crate::race_seam::StoreLock::Intelligence, || {
        store_write_gate().lock().map_err(|_| ())
    })
}

fn refresh_gate() -> &'static Mutex<Option<Instant>> {
    static GATE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(None))
}

/// Probe + append synchronously (called from a background thread / app start).
pub(crate) fn record_identity_snapshot_now() {
    let snap = capture_identity_snapshot();
    let Ok(_g) = lock_store() else {
        return; // poisoned lock: refuse to write rather than risk a torn read-modify-write
    };
    let mut store = load_store();
    if append_if_changed(&mut store, snap) {
        let _ = save_store(&store);
    }
}

/// Fire-and-forget identity probe, throttled + single-flight. Called on app start and on
/// each intelligence command so the log accrues even for users who never open the panels.
pub(crate) fn refresh_identity_snapshots_async() {
    {
        let Ok(mut last) = refresh_gate().lock() else { return };
        if let Some(t) = *last {
            if t.elapsed() < Duration::from_secs(IDENTITY_REFRESH_MIN_SECS) {
                return;
            }
        }
        *last = Some(Instant::now());
    }
    std::thread::spawn(record_identity_snapshot_now);
}

// ─── Timeline assembly (§5C) ─────────────────────────────────────────────

/// RFC3339 → UTC, offset-aware (blackbox-style local-offset stamps normalize correctly).
/// Ordering is ALWAYS on parsed datetimes, never string comparison.
pub(crate) fn parse_utc(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Everything the assembler reads — plain data in, events out (pure + testable).
pub(crate) struct TimelineInputs<'a> {
    pub applied: &'a [crate::history::AppliedChange],
    pub sessions: &'a [crate::sessions::SessionSummary],
    /// Live Gaming Mode slot, if any: (started_at, human status label).
    pub gaming_slot: Option<(String, &'static str)>,
    pub awards: &'a [crate::benchmark_scoreboard::AwardEntry],
    pub benchmark_baseline_at: Option<String>,
    pub comparison: Option<&'a crate::comparison::ComparisonResult>,
    pub snapshots: &'a [IdentitySnapshot],
    /// Active Drift Watch notices (Intelligence Phase 2) — persisted state, never live probes.
    pub drift_notices: &'a [crate::drift::DriftNotice],
}

pub(crate) struct TimelineAssembly {
    /// Ascending by (timestamp, source priority, id) — a stable total order.
    pub events: Vec<EventRecord>,
    pub dropped_unparseable: usize,
}

/// Tie-break rank at equal timestamps: observed changes sort before the records that
/// revealed them, applies before measurements, sessions last.
fn source_priority(event_type: &str) -> u8 {
    match event_type {
        "gpu-driver-change" => 0,
        "hardware-change" => 1,
        "windows-build-change" => 2,
        "power-plan-change" => 3,
        "readiness-drift" => 4,
        "change-applied" => 5,
        "change-rolled-back" => 6,
        "gaming-mode-active" => 7,
        "benchmark-baseline" => 8,
        "verified-win" => 9,
        "comparison-verdict" => 10,
        "session" => 11,
        _ => 12,
    }
}

fn fmt_minutes(secs: u64) -> String {
    let m = secs / 60;
    if m == 0 {
        format!("{secs}s")
    } else {
        format!("{m} min")
    }
}

fn strip_suffix_ci<'a>(s: &'a str, suffix: &str) -> &'a str {
    let Some(cut) = s.len().checked_sub(suffix.len()) else {
        return s;
    };
    if s.is_char_boundary(cut) && s[cut..].eq_ignore_ascii_case(suffix) {
        &s[..cut]
    } else {
        s
    }
}

/// Prettify a process name for DISPLAY strings only — the Rust mirror of
/// `src/surfaces/game-name.ts` (consumer panel 2026-07-14 flagged "PALWORLD-WIN64-SHIPPING"):
/// strip a trailing ".exe" and an Unreal/GDK shipping-binary suffix, leave casing alone.
/// Session MATCHING always uses the raw `process_name` — never compare pretty names.
pub(crate) fn pretty_game_name(name: &str) -> String {
    let mut n = strip_suffix_ci(name.trim(), ".exe");
    for sep_a in ["-", "_"] {
        for plat in ["win64", "wingdk"] {
            for sep_b in ["-", "_"] {
                n = strip_suffix_ci(n, &format!("{sep_a}{plat}{sep_b}shipping"));
            }
        }
    }
    n.to_string()
}

/// An observed-change candidate before dedup: `to_key` identifies the resulting state so
/// the identity-snapshot stream and the rig-fingerprint stream dedup against each other.
struct ObservedCandidate {
    ev: EventRecord,
    to_key: String,
}

/// Windows identity as one tracked value: (build, UBR, display_version).
type WindowsIdentity = (String, Option<u32>, String);

/// Scan a time-ordered series of identity readings and emit observed-change events.
/// Per-field "last known value" tracking: a failed probe (empty field) never fabricates a
/// change — the comparison window simply widens to the next real reading.
struct IdentityDeltaScan {
    last_gpu: Option<(String, String)>,        // (value, observed_at)
    last_driver: Option<(String, String)>,     // reset when the GPU itself changes
    last_ram: Option<(u32, String)>,
    last_display: Option<(String, String)>,
    last_windows: Option<(WindowsIdentity, String)>,
    last_power: Option<(String, String)>,
}

impl IdentityDeltaScan {
    fn new() -> Self {
        Self {
            last_gpu: None,
            last_driver: None,
            last_ram: None,
            last_display: None,
            last_windows: None,
            last_power: None,
        }
    }

    /// Feed one reading (fields may be empty = not probed). `source` tags where the
    /// reading came from; `id_seed` keeps event ids unique per stream.
    #[allow(clippy::too_many_arguments)]
    fn feed(
        &mut self,
        out: &mut Vec<ObservedCandidate>,
        at: &str,
        source: &str,
        id_seed: &str,
        gpu: &str,
        driver: &str,
        ram_gb: u32,
        display: &str,
        windows: Option<(&str, Option<u32>, &str)>,
        power: &str,
    ) {
        let emitted_before = out.len();
        let mut hw_changes: Vec<String> = Vec::new();
        let mut hw_parts: Vec<HardwarePartChange> = Vec::new();
        let mut hw_from_at: Option<String> = None;
        let mut gpu_swapped = false;

        if !gpu.is_empty() {
            if let Some((prev, prev_at)) = &self.last_gpu {
                if prev != gpu {
                    hw_changes.push(format!("GPU: {prev} → {gpu}"));
                    hw_parts.push(HardwarePartChange { part: "gpu", from: prev.clone(), to: gpu.to_string() });
                    hw_from_at.get_or_insert_with(|| prev_at.clone());
                    gpu_swapped = true;
                }
            }
            self.last_gpu = Some((gpu.to_string(), at.to_string()));
        }
        if ram_gb > 0 {
            if let Some((prev, prev_at)) = &self.last_ram {
                if *prev != ram_gb {
                    hw_changes.push(format!("RAM: {prev} GB → {ram_gb} GB"));
                    hw_parts.push(HardwarePartChange { part: "ram", from: format!("{prev} GB"), to: format!("{ram_gb} GB") });
                    hw_from_at.get_or_insert_with(|| prev_at.clone());
                }
            }
            self.last_ram = Some((ram_gb, at.to_string()));
        }
        if !display.is_empty() {
            if let Some((prev, prev_at)) = &self.last_display {
                if prev != display {
                    hw_changes.push(format!("Display: {prev} → {display}"));
                    hw_parts.push(HardwarePartChange { part: "display", from: prev.clone(), to: display.to_string() });
                    hw_from_at.get_or_insert_with(|| prev_at.clone());
                }
            }
            self.last_display = Some((display.to_string(), at.to_string()));
        }
        if !hw_changes.is_empty() {
            let from_at = hw_from_at.unwrap_or_else(|| at.to_string());
            out.push(ObservedCandidate {
                to_key: format!("hw|{gpu}|{ram_gb}|{display}"),
                ev: EventRecord {
                    id: format!("{id_seed}:{at}:hardware-change"),
                    timestamp: at.to_string(),
                    event_type: "hardware-change".into(),
                    source: source.into(),
                    scope: EventScope::Observed,
                    game: None,
                    summary: format!("Hardware changed — {}", hw_changes.join(" · ")),
                    detail: Some(
                        "Noticed between two Compy readings — the exact time isn't recorded, only the window.".into(),
                    ),
                    observed_between: Some((from_at, at.to_string())),
                    since_rolled_back: false,
                    rec_id: None,
                    parts: Some(EventParts::Hardware { changes: hw_parts }),
                },
            });
        }

        if !driver.is_empty() {
            // A GPU swap trivially changes the driver string — that's the hardware event's
            // story, not a driver update. Reset tracking instead of emitting a false event.
            if gpu_swapped {
                self.last_driver = None;
            }
            if let Some((prev, prev_at)) = &self.last_driver {
                if prev != driver {
                    out.push(ObservedCandidate {
                        to_key: format!("driver|{driver}"),
                        ev: EventRecord {
                            id: format!("{id_seed}:{at}:gpu-driver-change"),
                            timestamp: at.to_string(),
                            event_type: "gpu-driver-change".into(),
                            source: source.into(),
                            scope: EventScope::Observed,
                            game: None,
                            summary: format!("GPU driver changed: {prev} → {driver}"),
                            detail: Some(
                                "Noticed between two Compy readings — the exact install time isn't recorded, only the window.".into(),
                            ),
                            observed_between: Some((prev_at.clone(), at.to_string())),
                            since_rolled_back: false,
                            rec_id: None,
                            parts: Some(EventParts::GpuDriver { from: prev.clone(), to: driver.to_string() }),
                        },
                    });
                }
            }
            self.last_driver = Some((driver.to_string(), at.to_string()));
        }

        if let Some((build, ubr, display_version)) = windows {
            if !build.is_empty() {
                let cur = (build.to_string(), ubr, display_version.to_string());
                if let Some((prev, prev_at)) = &self.last_windows {
                    if *prev != cur {
                        let fmt = |b: &str, u: &Option<u32>, dv: &str| match u {
                            Some(u) => format!("{b}.{u}{}", if dv.is_empty() { String::new() } else { format!(" ({dv})") }),
                            None => format!("{b}{}", if dv.is_empty() { String::new() } else { format!(" ({dv})") }),
                        };
                        out.push(ObservedCandidate {
                            to_key: format!("win|{build}|{ubr:?}"),
                            ev: EventRecord {
                                id: format!("{id_seed}:{at}:windows-build-change"),
                                timestamp: at.to_string(),
                                event_type: "windows-build-change".into(),
                                source: source.into(),
                                scope: EventScope::Observed,
                                game: None,
                                summary: format!(
                                    "Windows updated: {} → {}",
                                    fmt(&prev.0, &prev.1, &prev.2),
                                    fmt(&cur.0, &cur.1, &cur.2)
                                ),
                                detail: Some(
                                    "Noticed between two Compy readings — Windows installed this on its own schedule.".into(),
                                ),
                                observed_between: Some((prev_at.clone(), at.to_string())),
                                since_rolled_back: false,
                                rec_id: None,
                                parts: Some(EventParts::WindowsBuild {
                                    from: fmt(&prev.0, &prev.1, &prev.2),
                                    to: fmt(&cur.0, &cur.1, &cur.2),
                                }),
                            },
                        });
                    }
                }
                self.last_windows = Some((cur, at.to_string()));
            }
        }

        if !power.is_empty() {
            if let Some((prev, prev_at)) = &self.last_power {
                if prev != power {
                    out.push(ObservedCandidate {
                        to_key: format!("power|{power}"),
                        ev: EventRecord {
                            id: format!("{id_seed}:{at}:power-plan-change"),
                            timestamp: at.to_string(),
                            event_type: "power-plan-change".into(),
                            source: source.into(),
                            scope: EventScope::Observed,
                            game: None,
                            summary: format!("Power plan changed: {prev} → {power}"),
                            detail: Some(
                                "Noticed between two Compy readings — changed outside Compy (or restored by Windows).".into(),
                            ),
                            observed_between: Some((prev_at.clone(), at.to_string())),
                            since_rolled_back: false,
                            rec_id: None,
                            parts: Some(EventParts::PowerPlan { from: prev.clone(), to: power.to_string() }),
                        },
                    });
                }
            }
            self.last_power = Some((power.to_string(), at.to_string()));
        }
        debug_assert!(
            out.len() - emitted_before <= OBSERVED_KINDS_PER_READING,
            "one reading emitted {} observed kinds; OBSERVED_KINDS_PER_READING (and the ceiling written from it) allows {}",
            out.len() - emitted_before,
            OBSERVED_KINDS_PER_READING
        );
    }
}

/// True when the two observation windows overlap (strictly — touching endpoints are
/// distinct adjacent windows, e.g. driver A→B then B→C).
fn windows_overlap(a: &(String, String), b: &(String, String)) -> bool {
    match (parse_utc(&a.0), parse_utc(&a.1), parse_utc(&b.0), parse_utc(&b.1)) {
        (Some(a0), Some(a1), Some(b0), Some(b1)) => a0 < b1 && b0 < a1,
        _ => false,
    }
}

/// The same real-world change can be seen by both observation streams (identity snapshots
/// at app start; rig fingerprints stamped on sessions/applies). Two candidates with the
/// same result (`to_key`) and overlapping windows are one change — keep the tighter window.
fn dedup_observed(mut candidates: Vec<ObservedCandidate>) -> Vec<EventRecord> {
    let span_secs = |ev: &EventRecord| -> i64 {
        ev.observed_between
            .as_ref()
            .and_then(|(a, b)| Some((parse_utc(b)? - parse_utc(a)?).num_seconds()))
            .unwrap_or(i64::MAX)
    };
    // Tighter windows first; ties broken by id so the pick is deterministic.
    candidates.sort_by(|x, y| {
        span_secs(&x.ev)
            .cmp(&span_secs(&y.ev))
            .then_with(|| x.ev.id.cmp(&y.ev.id))
    });
    let mut kept: Vec<ObservedCandidate> = Vec::new();
    'outer: for cand in candidates {
        for k in &kept {
            if k.ev.event_type == cand.ev.event_type
                && k.to_key == cand.to_key
                && match (&k.ev.observed_between, &cand.ev.observed_between) {
                    (Some(a), Some(b)) => windows_overlap(a, b),
                    _ => false,
                }
            {
                continue 'outer; // same change, wider window — drop
            }
        }
        kept.push(cand);
    }
    kept.into_iter().map(|c| c.ev).collect()
}

/// The Drift Watch summary line, as ONE composer both the timeline and its tests read.
///
/// It exists because the obvious `format!("{label} drifted out of its ready state")` was WRONG and
/// shipped that way (found by self-review 2026-08-23 reading the installed build's History tape).
/// Readiness labels are not all noun phrases -- `readiness.rs` writes several of them as complete
/// clauses, because a check that has already found something says so in its own name: "Compy
/// changes were turned back off", "Memory below its rated speed", "Monitor below max refresh",
/// "Memory running single-channel". Used as the SUBJECT of a verb phrase, each of those produced a
/// run-on -- "Compy changes were turned back off drifted out of its ready state" -- in two rooms
/// at once.
///
/// So the label goes LAST, where nothing can follow it, and the sentence works for either shape:
/// "No longer ready: Monitor refresh rate" and "No longer ready: Compy changes were turned back
/// off" both read. Guard: `drift_summary_never_makes_the_label_a_subject`.
fn drift_summary(label: &str) -> String {
    format!("No longer ready: {label}")
}

/// Assemble the full local timeline from persisted stores. Deterministic: same inputs →
/// same events in the same total order (pinned by guard test).
pub(crate) fn assemble_timeline(inp: &TimelineInputs) -> TimelineAssembly {
    let mut events: Vec<EventRecord> = Vec::new();
    let mut dropped = 0usize;

    // 1) Trust-Ledger applies + dated rollbacks. Rollbacks stamped from Intelligence
    //    Phase 2 on carry `rolled_back_at` and appear as their own dated event; older
    //    rollbacks have no recorded time and stay state on the apply event only
    //    ("since rolled back") — never retro-dated.
    for c in inp.applied {
        if parse_utc(&c.applied_at).is_none() {
            dropped += 1;
            continue;
        }
        let rolled_back = c.status == "rolled_back";
        let adopted = c.provenance.as_deref() == Some("leftover_adopted");
        events.push(EventRecord {
            id: format!("apply:{}", c.id),
            timestamp: c.applied_at.clone(),
            event_type: "change-applied".into(),
            source: "trust-ledger".into(),
            scope: EventScope::CompyApplied,
            game: None,
            summary: if rolled_back {
                format!("{} applied (since rolled back)", c.rec_title)
            } else {
                format!("{} applied", c.rec_title)
            },
            detail: adopted.then(|| "Adopted leftover — restored to stock via Compy.".to_string()),
            observed_between: None,
            since_rolled_back: rolled_back,
            rec_id: Some(c.rec_id.clone()),
            parts: Some(EventParts::Applied { title: c.rec_title.clone() }),
        });
        if let Some(rb) = &c.rolled_back_at {
            if parse_utc(rb).is_none() {
                dropped += 1;
            } else {
                events.push(EventRecord {
                    id: format!("rollback:{}", c.id),
                    timestamp: rb.clone(),
                    event_type: "change-rolled-back".into(),
                    source: "trust-ledger".into(),
                    scope: EventScope::CompyApplied,
                    game: None,
                    summary: format!("{} rolled back", c.rec_title),
                    detail: None,
                    observed_between: None,
                    since_rolled_back: false,
                    rec_id: Some(c.rec_id.clone()),
                    parts: Some(EventParts::RolledBack { title: c.rec_title.clone() }),
                });
            }
        }
    }

    // 1b) Drift Watch notices: readiness checks that were good and have regressed. Dated
    //     by WHEN Compy noticed; when the last-seen-ready stamp exists the event carries
    //     the honest observation window ("was ready at X, noticed regressed at Y").
    //     Honest-copy rule (drift.rs): name WHAT drifted and WHEN noticed — never WHO;
    //     a drift can be self-inflicted via a Trust-Ledger rollback.
    for n in inp.drift_notices {
        if parse_utc(&n.noticed_at).is_none() {
            dropped += 1;
            continue;
        }
        let window = n
            .last_ready_at
            .as_ref()
            .filter(|a| parse_utc(a).is_some())
            .map(|a| (a.clone(), n.noticed_at.clone()));
        events.push(EventRecord {
            id: format!("drift:{}:{}", n.noticed_at, n.id),
            timestamp: n.noticed_at.clone(),
            event_type: "readiness-drift".into(),
            source: "drift-watch".into(),
            scope: EventScope::Observed,
            game: None,
            summary: drift_summary(&n.label),
            detail: Some(
                "Noticed on a readiness scan — the change itself was not witnessed, and who or what changed it is not recorded.".into(),
            ),
            observed_between: window,
            since_rolled_back: false,
            rec_id: None,
            parts: Some(EventParts::Drift { label: n.label.clone() }),
        });
    }

    // 2) Monitored FPS sessions.
    for s in inp.sessions {
        if parse_utc(&s.started_at).is_none() {
            dropped += 1;
            continue;
        }
        events.push(EventRecord {
            id: format!("session:{}", s.started_at),
            timestamp: s.started_at.clone(),
            event_type: "session".into(),
            source: "sessions".into(),
            scope: EventScope::Measurement,
            game: Some(pretty_game_name(&s.process_name)),
            // P4-show-f1: a session with no reading has no FPS to state; its 0s mean "not measured".
            summary: if s.samples == 0 {
                format!(
                    "{} session — {} · nothing measured: another window was in front the whole time",
                    pretty_game_name(&s.process_name),
                    fmt_minutes(s.duration_secs),
                )
            } else {
                format!(
                    "{} session — {} · {:.0} avg FPS · {:.0} 1% low",
                    pretty_game_name(&s.process_name),
                    fmt_minutes(s.duration_secs),
                    s.avg_fps,
                    s.low1_fps_est
                )
            },
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
            parts: Some(EventParts::Session {
                game: pretty_game_name(&s.process_name),
                duration_secs: s.duration_secs,
                fps: (s.samples != 0).then(|| (format!("{:.0}", s.avg_fps), format!("{:.0}", s.low1_fps_est))),
            }),
        });
    }

    // 3) Live Gaming Mode slot (a cleanly-ended session deletes its file — no history
    //    exists, so only the live session can honestly appear).
    if let Some((started_at, label)) = &inp.gaming_slot {
        if parse_utc(started_at).is_some() {
            events.push(EventRecord {
                id: format!("gaming-mode:{started_at}"),
                timestamp: started_at.clone(),
                event_type: "gaming-mode-active".into(),
                source: "gaming-session".into(),
                scope: EventScope::CompyApplied,
                game: None,
                summary: format!("Gaming Mode session {label}"),
                detail: None,
                observed_between: None,
                since_rolled_back: false,
                rec_id: None,
                parts: None,
            });
        } else {
            dropped += 1;
        }
    }

    // 4) Verified wins (Lab Keep verdicts — append-only scoreboard).
    for a in inp.awards {
        if parse_utc(&a.at).is_none() {
            dropped += 1;
            continue;
        }
        events.push(EventRecord {
            id: format!("award:{}:{}", a.at, a.rec_id),
            timestamp: a.at.clone(),
            event_type: "verified-win".into(),
            source: "scoreboard".into(),
            scope: EventScope::Measurement,
            game: None,
            summary: format!(
                "Verified win: {} ({} {:+.1}%)",
                a.rec_title, a.metric, a.effect_pct
            ),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
            parts: None,
        });
    }

    // 5) Current Lab baseline (single slot — overwritten history is gone, honestly).
    if let Some(at) = &inp.benchmark_baseline_at {
        if parse_utc(at).is_some() {
            events.push(EventRecord {
                id: format!("benchmark-baseline:{at}"),
                timestamp: at.clone(),
                event_type: "benchmark-baseline".into(),
                source: "benchmark".into(),
                scope: EventScope::Measurement,
                game: None,
                summary: "Lab baseline recorded".into(),
                detail: None,
                observed_between: None,
                since_rolled_back: false,
                rec_id: None,
                parts: Some(EventParts::BenchmarkBaseline),
            });
        } else {
            dropped += 1;
        }
    }

    // 6) Latest A/B comparison verdict (single slot).
    if let Some(cmp) = inp.comparison {
        if parse_utc(&cmp.at).is_some() {
            events.push(EventRecord {
                id: format!("comparison:{}:{}", cmp.at, cmp.rec_id),
                timestamp: cmp.at.clone(),
                event_type: "comparison-verdict".into(),
                source: "comparison".into(),
                scope: EventScope::Measurement,
                game: (!cmp.game.is_empty()).then(|| pretty_game_name(&cmp.game)),
                summary: format!("A/B verdict for {}: {}", cmp.rec_title, cmp.verdict),
                detail: None,
                observed_between: None,
                since_rolled_back: false,
                rec_id: None,
                parts: None,
            });
        } else {
            dropped += 1;
        }
    }

    // 7) Observed changes — identity-snapshot deltas + rig-fingerprint shifts, deduped.
    let mut candidates: Vec<ObservedCandidate> = Vec::new();
    {
        let mut scan = IdentityDeltaScan::new();
        let mut snaps: Vec<&IdentitySnapshot> = inp.snapshots.iter().collect();
        snaps.sort_by(|a, b| {
            parse_utc(&a.observed_at)
                .cmp(&parse_utc(&b.observed_at))
                .then_with(|| a.observed_at.cmp(&b.observed_at))
        });
        for s in snaps {
            if parse_utc(&s.observed_at).is_none() {
                dropped += 1;
                continue;
            }
            scan.feed(
                &mut candidates,
                &s.observed_at,
                "identity-snapshot",
                "identity",
                &s.gpu,
                &s.gpu_driver,
                s.ram_gb,
                &s.display,
                Some((&s.windows_build, s.windows_ubr, &s.windows_display_version)),
                &s.power_plan,
            );
        }
    }
    {
        // Fingerprinted records: sessions ∪ ledger applies, time-ordered.
        let mut prints: Vec<(DateTime<Utc>, &str, &crate::hardware::HwFingerprint, u8)> = Vec::new();
        for s in inp.sessions {
            if let (Some(t), Some(fp)) = (parse_utc(&s.started_at), s.hw_fingerprint.as_ref()) {
                prints.push((t, &s.started_at, fp, 0));
            }
        }
        for c in inp.applied {
            if let (Some(t), Some(fp)) = (parse_utc(&c.applied_at), c.hw_fingerprint.as_ref()) {
                prints.push((t, &c.applied_at, fp, 1));
            }
        }
        prints.sort_by(|a, b| a.0.cmp(&b.0).then(a.3.cmp(&b.3)).then(a.1.cmp(b.1)));
        let mut scan = IdentityDeltaScan::new();
        for (_, at, fp, _) in prints {
            scan.feed(
                &mut candidates,
                at,
                "rig-fingerprint",
                "fpshift",
                &fp.gpu,
                &fp.gpu_driver,
                fp.ram_gb,
                &fp.display,
                None,
                "",
            );
        }
    }
    events.extend(dedup_observed(candidates));

    // Stable total order: (parsed timestamp, source priority, id).
    events.sort_by(|a, b| {
        parse_utc(&a.timestamp)
            .cmp(&parse_utc(&b.timestamp))
            .then_with(|| source_priority(&a.event_type).cmp(&source_priority(&b.event_type)))
            .then_with(|| a.id.cmp(&b.id))
    });

    TimelineAssembly {
        events,
        dropped_unparseable: dropped,
    }
}

// ─── "What changed?" engine (§5D) ────────────────────────────────────────

/// Expert-view session identity: exactly which sessions were compared.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct SessionRef {
    pub started_at: String,
    pub game: String,
    pub duration_secs: u64,
    pub samples: u32,
    pub avg_fps: f64,
    pub low1_fps: f64,
    pub gaming_mode_active: Option<bool>,
    pub hw_hash: Option<String>,
}

fn session_ref(s: &crate::sessions::SessionSummary) -> SessionRef {
    SessionRef {
        started_at: s.started_at.clone(),
        game: pretty_game_name(&s.process_name),
        duration_secs: s.duration_secs,
        samples: s.samples,
        avg_fps: round1(s.avg_fps),
        low1_fps: round1(s.low1_fps_est),
        gaming_mode_active: s.gaming_mode_active,
        hw_hash: s.hw_fingerprint.as_ref().map(|f| f.hash.clone()),
    }
}

/// One measured metric delta. Only the 1% low drives the verdict (METHODOLOGY.md);
/// average FPS is carried as reference-only.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct Observation {
    pub metric: String,
    pub baseline: f64,
    pub current: f64,
    pub delta_pct: f64,
    pub meaningful: bool,
    pub reference_only: bool,
}

/// One candidate explanation from the fixed catalog, with its evidence for/against and
/// what's missing. Confidence is a band, derived from documented rules — never numeric.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct Hypothesis {
    pub id: String,
    pub title: String,
    pub confidence: Confidence,
    pub supporting_evidence: Vec<String>,
    pub contradicting_evidence: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub next_test: Option<String>,
    /// The catalog rec `next_test` refers to — present ONLY where the engine can point at a
    /// real id it READ (today: a single still-applied Trust-Ledger change). `None` everywhere
    /// else, permanently: matching the prose against the catalog would be fabrication, and a
    /// surface that gets `None` renders the sentence and nothing more. See
    /// `next_test_rec_id_is_read_from_the_ledger_never_matched_from_prose`.
    pub next_test_rec_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct WhatChangedReport {
    pub baseline: SessionRef,
    pub current: SessionRef,
    pub game: String,
    /// "improved" | "regressed" | "no-change" | "inconclusive" — 1%-low judged, shared
    /// vocabulary with comparison.rs.
    pub verdict: String,
    pub headline: String,
    pub observations: Vec<Observation>,
    pub noise_floor_pct: f64,
    /// Non-measurement events strictly inside (baseline start, current start].
    pub events_between: Vec<EventRecord>,
    pub leading_hypotheses: Vec<Hypothesis>,
    pub ruled_out: Vec<Hypothesis>,
    /// Honest gaps: what Compy wasn't recording, so can neither rule in nor out.
    pub unknowns: Vec<String>,
    pub next_action: Option<String>,
    /// The leading hypothesis's `next_test_rec_id`, mirrored so a surface can offer a real
    /// affordance instead of prose alone. `None` unless the leader carries one — and the
    /// confounded path never does, because the honest advice there is "change one thing,"
    /// not "change this thing."
    ///
    /// **Destination is the Trust Ledger, not the experiment bench.** The only next test that
    /// can carry an id today prescribes a ROLLBACK, and the bench applies; feeding it a
    /// still-active rec returns `already-configured` (`experiment.rs`'s `simulate`) — a
    /// dead end. A surface that routes this id anywhere it cannot be rolled back is wrong.
    pub next_action_rec_id: Option<String>,
    /// ≥2 discrete changes landed between the sessions — attribution refused.
    pub confounded: bool,
    pub gap_days: i64,
    pub notes: Vec<String>,
    pub method_note: String,
    /// §4C inspectable evidence graph — a deterministic re-projection of this report for
    /// the Expert view. Adds no new data; the plain-language fields above are the normal
    /// view. Populated by `what_changed`; the `base` builder leaves it empty.
    pub evidence_graph: EvidenceGraph,
    /// Measurement Platform 2.0 (Task F) — how far the two sessions may honestly be compared,
    /// composed from their capture capabilities + game-state conditions + rig fingerprints. A
    /// projection of the two INPUT sessions (not this report), so the `base` builder fills it on
    /// every path — including the inconclusive gates, which is exactly where the reader needs to
    /// see WHY comparison was limited. Bands-only confidence ceiling; never assumes unrecorded
    /// context matched.
    pub comparability: crate::comparability::SessionComparability,
}

/// Outcome wrapper so "no comparison possible" is an honest first-class answer,
/// not an empty report.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum WhatChangedOutcome {
    Unavailable { reason: String },
    Report(Box<WhatChangedReport>),
}

/// Below this many FPS samples a comparison is refused as inconclusive (≈ one minute at
/// 1 Hz — the same floor the session saver applies via MIN_SESSION_SECS). One definition,
/// re-used by the cross-session pattern detector (`intelligence_patterns.rs`) so the two
/// can't silently drift out of agreement about what "comparable" means.
pub(crate) const MIN_COMPARE_SAMPLES: u32 = 60;
/// Baseline older than this is stale — METHODOLOGY's expired-baseline rail. Caps High.
const STALE_GAP_DAYS: i64 = 14;

const METHOD_NOTE: &str = "Verdicts key on the 1% low with a flat 3% cross-session noise floor; average FPS is reference-only. Confidence is a rule-derived band (unknown/low/medium/high) — Compy has no calibrated probabilities, so it never shows a number. Changes listed between sessions are correlations in time, not proven causes.";

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// The fixed hypothesis catalog (§5D). Order = display order for ties.
const CHANGE_FAMILY: &[&str] = &[
    "hardware-change",
    "gpu-driver-change",
    "windows-build-change",
    "compy-config-change",
    "gaming-mode-difference",
    "power-plan-change",
];

fn catalog_index(id: &str) -> usize {
    const ORDER: &[&str] = &[
        "hardware-change",
        "gpu-driver-change",
        "windows-build-change",
        "compy-config-change",
        "gaming-mode-difference",
        "power-plan-change",
        "setting-drift",
        "memory-pressure",
        "thermal",
        "game-variance",
        "insufficient-evidence",
    ];
    ORDER.iter().position(|x| *x == id).unwrap_or(ORDER.len())
}

fn hypothesis_title(id: &str) -> &'static str {
    match id {
        "hardware-change" => "Hardware changed",
        "gpu-driver-change" => "GPU driver changed",
        "windows-build-change" => "Windows build changed",
        "compy-config-change" => "Compy configuration changed",
        "gaming-mode-difference" => "Gaming Mode state differed",
        "power-plan-change" => "Power plan changed",
        "setting-drift" => "A monitored setting drifted",
        "memory-pressure" => "Memory pressure",
        "thermal" => "GPU ran hotter",
        "game-variance" => "Run-to-run variance",
        _ => "No recorded change — cause unknown",
    }
}

/// Working evaluation of one hypothesis before confidence bands are assigned.
struct HypoEval {
    id: &'static str,
    supporting: Vec<String>,
    contradicting: Vec<String>,
    missing: Vec<String>,
    /// Evidence is a per-session recorded fact (fingerprints / stamps on the two compared
    /// sessions themselves), not just a window event — eligible for High.
    direct: bool,
    /// Medium-capped signal: environment pressure (memory/thermal) or a notice-dated
    /// drift — real evidence with an honest ceiling below the change family.
    environment: bool,
    next_test: Option<String>,
    /// Set ONLY alongside a `next_test` whose subject is a rec the engine read an id for.
    next_test_rec_id: Option<String>,
}

impl HypoEval {
    fn new(id: &'static str) -> Self {
        Self {
            id,
            supporting: Vec::new(),
            contradicting: Vec::new(),
            missing: Vec::new(),
            direct: false,
            environment: false,
            next_test: None,
            next_test_rec_id: None,
        }
    }
}

/// Whether the Trust Ledger the engine reasoned over is the WHOLE ledger.
///
/// `compy-config-change` is the only hypothesis allowed to read SILENCE as contradicting evidence,
/// and it earns that with a premise: the ledger is a complete record of what Compy itself did. A
/// ledger that will not load — or one whose damaged predecessor was quarantined, after which every
/// load reads empty forever — breaks that premise while looking exactly like a quiet machine.
/// Supplying it keeps the engine deterministic (same inputs → same report) and makes the difference
/// between "Compy did nothing" and "Compy can't tell you what it did" a fact the caller passes in
/// rather than one the report invents.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum LedgerHealth {
    /// Loaded cleanly and no quarantine marker on disk — silence is real evidence.
    Complete,
    /// Unreadable now, or a damaged ledger was set aside at or after the window began (#618: one set
    /// aside before the window began lost nothing the window needs). Silence proves nothing.
    Incomplete,
}

pub(crate) struct WhatChangedInputs<'a> {
    pub baseline: &'a crate::sessions::SessionSummary,
    pub current: &'a crate::sessions::SessionSummary,
    /// Non-measurement events strictly inside the window (see `split_window_events`).
    pub events_window: Vec<EventRecord>,
    /// Observed events whose window OVERLAPS the session window but isn't contained by
    /// it — Compy can't place them before vs between, so they count as unknowns.
    pub events_ambiguous: Vec<EventRecord>,
    pub snapshots: &'a [IdentitySnapshot],
}

/// Split the assembled timeline around a comparison window (baseline start, current
/// start]. Measurement events and the two sessions themselves are excluded — the window
/// holds candidate CHANGES, not readings.
pub(crate) fn split_window_events(
    all: &[EventRecord],
    win_start: DateTime<Utc>,
    win_end: DateTime<Utc>,
) -> (Vec<EventRecord>, Vec<EventRecord>) {
    let mut inside = Vec::new();
    let mut ambiguous = Vec::new();
    for ev in all {
        if ev.scope == EventScope::Measurement || ev.event_type == "session" {
            continue;
        }
        let Some(t) = parse_utc(&ev.timestamp) else { continue };
        match &ev.observed_between {
            Some((a, b)) => {
                let (Some(pa), Some(pb)) = (parse_utc(a), parse_utc(b)) else { continue };
                let contained = pa >= win_start && pb <= win_end && pb > win_start;
                let overlaps = pa < win_end && pb > win_start;
                if contained {
                    inside.push(ev.clone());
                } else if overlaps {
                    ambiguous.push(ev.clone());
                }
            }
            None => {
                if t > win_start && t <= win_end {
                    inside.push(ev.clone());
                }
            }
        }
    }
    (inside, ambiguous)
}

// ─── §4C evidence graph (Expert view) ────────────────────────────────────
// A deterministic RE-PROJECTION of a finished WhatChangedReport into the inspectable
// node/edge graph the directive's Expert view exposes. It adds NO new data — every node
// cites the report field it came from. The normal view stays plain-language; this is
// strictly extra structure for users who want to see the wiring. The type vocabulary is
// the §4C set this two-session comparison can honestly source; Intelligence Phase 3's
// experiment engine grows it (additive) when it grows the emitter.

/// §4C node vocabulary. Kebab-case serde is the wire contract the Expert-view TS union pins.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EvidenceNodeType {
    Symptom,
    Metric,
    Event,
    Driver,
    OsUpdate,
    CompyChange,
    ExternalChange,
    Hypothesis,
    Experiment,
    Conclusion,
}

/// §4C edge vocabulary — only the relations this derivation actually emits (additive later).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EvidenceRelation {
    Supports,
    CorrelatesWith,
    OccurredBefore,
    RequiresVerification,
    RuledOutBy,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct EvidenceNode {
    pub id: String,
    pub node_type: EvidenceNodeType,
    pub label: String,
    /// Which report field / record this node was derived from — inspectable provenance.
    pub source_reference: String,
    /// How trustworthy this node's own claim is — a band, never numeric. Passive
    /// observation never exceeds Medium; only Compy's own logged action reads High (a fact).
    pub reliability: Confidence,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct EvidenceEdge {
    pub from: String,
    pub to: String,
    pub relation: EvidenceRelation,
    /// Band strength of the relation, never numeric.
    pub weight: Confidence,
    pub explanation: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct EvidenceGraph {
    pub nodes: Vec<EvidenceNode>,
    pub edges: Vec<EvidenceEdge>,
}

fn relation_key(r: EvidenceRelation) -> &'static str {
    match r {
        EvidenceRelation::Supports => "supports",
        EvidenceRelation::CorrelatesWith => "correlates-with",
        EvidenceRelation::OccurredBefore => "occurred-before",
        EvidenceRelation::RequiresVerification => "requires-verification",
        EvidenceRelation::RuledOutBy => "ruled-out-by",
    }
}

/// Type a window event by what Compy actually knows about it — never presenting an
/// externally-observed change as something Compy did (anti-fabrication).
fn event_node_type(e: &EventRecord) -> EvidenceNodeType {
    match e.scope {
        EventScope::CompyApplied => EvidenceNodeType::CompyChange,
        EventScope::Measurement => EvidenceNodeType::Event,
        EventScope::Observed => {
            let t = e.event_type.to_ascii_lowercase();
            if t.contains("driver") {
                EvidenceNodeType::Driver
            } else if t.contains("windows") || t.contains("build") || t.contains("os") {
                EvidenceNodeType::OsUpdate
            } else {
                EvidenceNodeType::ExternalChange
            }
        }
    }
}

/// A change Compy itself logged is a fact (High). A change Compy only *noticed* by diffing
/// two identity snapshots is real but detection-inferred — capped at Medium.
fn event_reliability(e: &EventRecord) -> Confidence {
    match e.scope {
        EventScope::CompyApplied => Confidence::High,
        _ => Confidence::Medium,
    }
}

/// Derive the §4C evidence graph from a finished report. Deterministic: nodes and edges
/// are sorted, so an identical report always yields a byte-identical graph.
pub(crate) fn evidence_graph(r: &WhatChangedReport) -> EvidenceGraph {
    let mut nodes: Vec<EvidenceNode> = Vec::new();
    let mut edges: Vec<EvidenceEdge> = Vec::new();

    // The conclusion — always present. A passive two-session comparison never reads High.
    let conclusion_reliability = if r.verdict == "inconclusive" {
        Confidence::Low
    } else {
        Confidence::Medium
    };
    nodes.push(EvidenceNode {
        id: "conclusion".into(),
        node_type: EvidenceNodeType::Conclusion,
        label: r.headline.clone(),
        source_reference: "what-changed:verdict".into(),
        reliability: conclusion_reliability,
    });

    // Symptom spine — only when there's a measured change to explain.
    let has_symptom = r.verdict == "improved" || r.verdict == "regressed";
    if has_symptom {
        let dir = if r.verdict == "improved" { "rose" } else { "fell" };
        nodes.push(EvidenceNode {
            id: "symptom".into(),
            node_type: EvidenceNodeType::Symptom,
            label: format!("{}'s 1% lows {dir} this session", r.game),
            source_reference: "what-changed:verdict".into(),
            reliability: Confidence::Medium,
        });
        edges.push(EvidenceEdge {
            from: "symptom".into(),
            to: "conclusion".into(),
            relation: EvidenceRelation::Supports,
            weight: Confidence::Medium,
            explanation: "The measured change is what this verdict explains.".into(),
        });
    }
    let hub = if has_symptom { "symptom" } else { "conclusion" };

    // Metric nodes — the 1% low SUPPORTS the verdict; average FPS only CORRELATES.
    for (i, o) in r.observations.iter().enumerate() {
        let id = format!("metric:{i}");
        let reliability = if o.reference_only || !o.meaningful {
            Confidence::Low
        } else {
            Confidence::Medium
        };
        nodes.push(EvidenceNode {
            id: id.clone(),
            node_type: EvidenceNodeType::Metric,
            label: format!("{}: {} → {} ({:+.1}%)", o.metric, o.baseline, o.current, o.delta_pct),
            source_reference: format!(
                "session-metric:{}",
                if o.reference_only { "avg-fps" } else { "low1" }
            ),
            reliability,
        });
        let (relation, explanation) = if o.reference_only {
            (
                EvidenceRelation::CorrelatesWith,
                "Average FPS moves alongside, but the 1% low is the verdict metric.".to_string(),
            )
        } else if o.meaningful {
            (
                EvidenceRelation::Supports,
                format!(
                    "The 1% low moved {:+.1}% — past the {:.0}% noise floor.",
                    o.delta_pct, r.noise_floor_pct
                ),
            )
        } else {
            (
                EvidenceRelation::CorrelatesWith,
                format!(
                    "The 1% low moved only {:+.1}% — inside the {:.0}% noise floor.",
                    o.delta_pct, r.noise_floor_pct
                ),
            )
        };
        edges.push(EvidenceEdge {
            from: id,
            to: hub.into(),
            relation,
            weight: reliability,
            explanation,
        });
    }

    // Events in the window — each OCCURRED BEFORE the result. No causation asserted here;
    // the correlation lives only where a hypothesis names it.
    for e in &r.events_between {
        let reliability = event_reliability(e);
        nodes.push(EvidenceNode {
            id: e.id.clone(),
            node_type: event_node_type(e),
            label: e.summary.clone(),
            source_reference: format!("event:{}", e.source),
            reliability,
        });
        edges.push(EvidenceEdge {
            from: e.id.clone(),
            to: hub.into(),
            relation: EvidenceRelation::OccurredBefore,
            weight: reliability,
            explanation: "Recorded in the window between the two sessions — it occurred before the result.".into(),
        });
    }

    // The single proposed next verification step (a TEST to run, never a fix to apply).
    let experiment_id = "experiment:next-test";
    if let Some(next) = &r.next_action {
        nodes.push(EvidenceNode {
            id: experiment_id.into(),
            node_type: EvidenceNodeType::Experiment,
            label: next.clone(),
            source_reference: "what-changed:next_action".into(),
            reliability: Confidence::Unknown, // outcome not yet known
        });
    }

    // Leading hypotheses SUPPORT the conclusion; each with a test REQUIRES VERIFICATION.
    for h in &r.leading_hypotheses {
        let id = format!("hypothesis:{}", h.id);
        nodes.push(EvidenceNode {
            id: id.clone(),
            node_type: EvidenceNodeType::Hypothesis,
            label: h.title.clone(),
            source_reference: format!("hypothesis:{}", h.id),
            reliability: h.confidence,
        });
        edges.push(EvidenceEdge {
            from: id.clone(),
            to: "conclusion".into(),
            relation: EvidenceRelation::Supports,
            weight: h.confidence,
            explanation: h
                .supporting_evidence
                .first()
                .cloned()
                .unwrap_or_else(|| "A candidate explanation for the measured change.".into()),
        });
        if let (true, Some(test)) = (r.next_action.is_some(), &h.next_test) {
            edges.push(EvidenceEdge {
                from: id,
                to: experiment_id.into(),
                relation: EvidenceRelation::RequiresVerification,
                weight: Confidence::Unknown,
                explanation: test.clone(),
            });
        }
    }

    // Ruled-out hypotheses: named and connected as RULED-OUT-BY, so the graph shows what
    // was considered and discarded — never silently dropped (§0.12 demotion-is-a-flag).
    for h in &r.ruled_out {
        let id = format!("ruled-out:{}", h.id);
        nodes.push(EvidenceNode {
            id: id.clone(),
            node_type: EvidenceNodeType::Hypothesis,
            label: h.title.clone(),
            source_reference: format!("ruled-out:{}", h.id),
            reliability: Confidence::Unknown,
        });
        edges.push(EvidenceEdge {
            from: id,
            to: "conclusion".into(),
            relation: EvidenceRelation::RuledOutBy,
            weight: Confidence::Unknown,
            explanation: h
                .contradicting_evidence
                .first()
                .cloned()
                .unwrap_or_else(|| "Ruled out by the recorded evidence.".into()),
        });
    }

    // If there's a next test but no hypothesis carried one, hang it off the conclusion so
    // the "what to do next" node is never left orphaned.
    if r.next_action.is_some()
        && !edges
            .iter()
            .any(|e| e.relation == EvidenceRelation::RequiresVerification)
    {
        edges.push(EvidenceEdge {
            from: "conclusion".into(),
            to: experiment_id.into(),
            relation: EvidenceRelation::RequiresVerification,
            weight: Confidence::Unknown,
            explanation: "The next test to narrow this down.".into(),
        });
    }

    // Deterministic ordering — identical reports ⇒ identical graphs (diffable, testable).
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    edges.sort_by(|a, b| {
        (a.from.as_str(), a.to.as_str(), relation_key(a.relation)).cmp(&(
            b.from.as_str(),
            b.to.as_str(),
            relation_key(b.relation),
        ))
    });

    EvidenceGraph { nodes, edges }
}

/// "What changed?" between two sessions — the plain-language report PLUS its §4C evidence
/// graph. The graph is a pure re-projection of the finished report (no new data), so it
/// stays perfectly in sync with the words the normal view shows.
pub(crate) fn what_changed(inp: &WhatChangedInputs, ledger: LedgerHealth) -> WhatChangedReport {
    let mut r = what_changed_inner(inp, ledger);
    r.evidence_graph = evidence_graph(&r);
    r
}

/// The deterministic core: same inputs → same report, every time. No randomness, no
/// learned weights, every branch inspectable.
fn what_changed_inner(inp: &WhatChangedInputs, ledger: LedgerHealth) -> WhatChangedReport {
    let floor = crate::benchmark::DEFAULT_NOISE_FLOOR_PCT;
    let b = inp.baseline;
    let c = inp.current;
    // Display-only prettification — every sentence below interpolates {game}. Matching
    // (baseline selection) happened upstream on the RAW process_name.
    let game = pretty_game_name(&c.process_name);

    let base = |verdict: &str, headline: String| WhatChangedReport {
        baseline: session_ref(b),
        current: session_ref(c),
        game: game.clone(),
        verdict: verdict.into(),
        headline,
        observations: Vec::new(),
        noise_floor_pct: floor,
        events_between: inp.events_window.clone(),
        leading_hypotheses: Vec::new(),
        ruled_out: Vec::new(),
        unknowns: Vec::new(),
        next_action: None,
        next_action_rec_id: None,
        confounded: false,
        gap_days: 0,
        notes: Vec::new(),
        method_note: METHOD_NOTE.into(),
        evidence_graph: EvidenceGraph::default(),
        // Honest comparability of the two input sessions, computed once here so every return
        // path (including the inline gates below) carries it. The gates remain hard
        // short-circuits; this field EXPOSES the structured reason for UI/export.
        comparability: crate::comparability::derive(b, c),
    };

    // Comparability gates — each failure is an honest inconclusive, never a guess.
    let (Some(bt), Some(ct)) = (parse_utc(&b.started_at), parse_utc(&c.started_at)) else {
        return base(
            "inconclusive",
            "One of these sessions has an unreadable timestamp — Compy won't guess at the order.".into(),
        );
    };
    let gap_days = (ct - bt).num_days();

    if b.samples < MIN_COMPARE_SAMPLES || c.samples < MIN_COMPARE_SAMPLES {
        let n = b.samples.min(c.samples);
        let mut r = base(
            "inconclusive",
            format!(
                "Not enough data to compare — only {n} FPS samples on one of these sessions (Compy wants at least {MIN_COMPARE_SAMPLES})."
            ),
        );
        r.gap_days = gap_days;
        return r;
    }

    if b.low1_fps_est <= 0.0 {
        let mut r = base(
            "inconclusive",
            "The baseline session recorded a zero 1% low — a percentage delta would be meaningless.".into(),
        );
        r.gap_days = gap_days;
        return r;
    }

    // Different rig ⇒ not apples-to-apples (compares gpu/ram/display, NEVER the hash —
    // the hash includes the driver, and a driver update must not break comparability).
    if let (Some(bf), Some(cf)) = (b.hw_fingerprint.as_ref(), c.hw_fingerprint.as_ref()) {
        let same_rig = bf.gpu == cf.gpu && bf.ram_gb == cf.ram_gb && bf.display == cf.display;
        if !same_rig {
            // Not-comparable ⇒ assert NO cause. This gate fires BEFORE any FPS delta is
            // computed, so there is no measured effect to attribute — a "hardware-change"
            // hypothesis here would be a causal claim with nothing to explain, and it would
            // triple-state the GPU/RAM/Display facts that comparability::derive() already
            // carries honestly in the banner (reasons) + the detail (changed_context). The
            // comparability banner is the SOLE owner of that framing; this gate leaves
            // leading_hypotheses empty like every sibling inconclusive gate above. next_action
            // keeps the one thing derive() doesn't express: the actionable instruction.
            let mut r = base(
                "inconclusive",
                "These sessions ran on different hardware setups — not an apples-to-apples comparison.".into(),
            );
            r.gap_days = gap_days;
            r.next_action = Some("Compare sessions recorded on the same hardware setup.".into());
            return r;
        }
    }

    // Metric observations — 1% low is the verdict metric, avg FPS reference-only. An average the
    // sampler couldn't take is its 0, and it is left out: it printed as "0.0 → 140.2 (+0.0%)" on
    // the panel and in the evidence graph (codebase review 2026-11-03).
    let delta_low1 = round1((c.low1_fps_est - b.low1_fps_est) / b.low1_fps_est * 100.0);
    let meaningful = delta_low1.abs() > floor; // boundary INCLUSIVE = no-change (comparison.rs pin)
    let mut observations = vec![Observation {
        metric: "1% low FPS".into(),
        baseline: round1(b.low1_fps_est),
        current: round1(c.low1_fps_est),
        delta_pct: delta_low1,
        meaningful,
        reference_only: false,
    }];
    let avg_read = |v: f64| v.is_finite() && v > 0.0;
    if avg_read(b.avg_fps) && avg_read(c.avg_fps) {
        observations.push(Observation {
            metric: "average FPS".into(),
            baseline: round1(b.avg_fps),
            current: round1(c.avg_fps),
            delta_pct: round1((c.avg_fps - b.avg_fps) / b.avg_fps * 100.0),
            meaningful: false,
            reference_only: true,
        });
    }

    let mut notes: Vec<String> = Vec::new();
    if gap_days > STALE_GAP_DAYS {
        notes.push(format!(
            "These sessions are {gap_days} days apart — a baseline older than {STALE_GAP_DAYS} days is stale by Compy's own methodology, so treat this comparison with caution."
        ));
    }

    if !meaningful {
        let mut r = base(
            "no-change",
            format!(
                "No meaningful difference vs your previous {game} session ({delta_low1:+.1}% 1% lows — inside the {floor:.0}% noise floor)."
            ),
        );
        r.observations = observations;
        r.gap_days = gap_days;
        r.notes = notes;
        // Identical-enough sessions get NO invented cause (anti-fabrication guard):
        // leading_hypotheses and ruled_out stay empty.
        return r;
    }

    let verdict = if delta_low1 > 0.0 { "improved" } else { "regressed" };
    let direction_word = if delta_low1 > 0.0 { "rose" } else { "fell" };
    // The session whose lows were worse — direction-aware evidence (pressure/heat must sit
    // in the WORSE session to support a hypothesis; the reverse contradicts it).
    let current_is_worse = delta_low1 < 0.0;

    let mut evals: Vec<HypoEval> = Vec::new();

    // hardware-change: same-rig was already enforced above when both fingerprints exist.
    {
        let mut h = HypoEval::new("hardware-change");
        match (b.hw_fingerprint.as_ref(), c.hw_fingerprint.as_ref()) {
            (Some(bf), Some(cf)) => {
                // same_rig == true here (gate above), so this is a recorded contradiction.
                let _ = (bf, cf);
                h.contradicting
                    .push("Both sessions recorded the same hardware setup (GPU, RAM, display).".into());
            }
            _ => {
                let hw_events: Vec<&EventRecord> = inp
                    .events_window
                    .iter()
                    .filter(|e| e.event_type == "hardware-change")
                    .collect();
                if hw_events.is_empty() {
                    h.missing.push(
                        "Rig identity wasn't recorded on one of these sessions — a hardware change can't be ruled in or out.".into(),
                    );
                } else {
                    for e in hw_events {
                        h.supporting.push(e.summary.clone());
                    }
                    h.next_test = Some("Compare sessions recorded on the same hardware setup.".into());
                }
            }
        }
        evals.push(h);
    }

    // gpu-driver-change: per-session fingerprints are direct evidence; window events back
    // them up when a fingerprint is missing.
    {
        let mut h = HypoEval::new("gpu-driver-change");
        match (b.hw_fingerprint.as_ref(), c.hw_fingerprint.as_ref()) {
            (Some(bf), Some(cf)) if !bf.gpu_driver.is_empty() && !cf.gpu_driver.is_empty() => {
                if bf.gpu_driver != cf.gpu_driver {
                    h.direct = true;
                    h.supporting.push(format!(
                        "The baseline ran GPU driver {}; this session ran {}.",
                        bf.gpu_driver, cf.gpu_driver
                    ));
                    h.next_test = Some(format!(
                        "Play one more {game} session on the current driver — if 1% lows stay where they are, the driver change is the likely factor."
                    ));
                } else {
                    h.contradicting.push(format!(
                        "Both sessions recorded the same GPU driver ({}).",
                        bf.gpu_driver
                    ));
                }
            }
            _ => {
                let drv_events: Vec<&EventRecord> = inp
                    .events_window
                    .iter()
                    .filter(|e| e.event_type == "gpu-driver-change")
                    .collect();
                if drv_events.is_empty() {
                    h.missing.push(
                        "GPU driver identity wasn't recorded on one of these sessions — a driver change can't be ruled in or out.".into(),
                    );
                } else {
                    for e in drv_events {
                        h.supporting.push(e.summary.clone());
                    }
                    h.next_test = Some(format!(
                        "Play one more {game} session on the current driver — if 1% lows stay where they are, the driver change is the likely factor."
                    ));
                }
            }
        }
        evals.push(h);
    }

    // windows-build-change: identity snapshots are the only source. Coverage = snapshots
    // bracketing the window; bracketed + no event ⇒ recorded contradiction.
    {
        let mut h = HypoEval::new("windows-build-change");
        let win_events: Vec<&EventRecord> = inp
            .events_window
            .iter()
            .filter(|e| e.event_type == "windows-build-change")
            .collect();
        let ambiguous_win = inp
            .events_ambiguous
            .iter()
            .any(|e| e.event_type == "windows-build-change");
        if !win_events.is_empty() {
            for e in &win_events {
                h.supporting.push(e.summary.clone());
            }
            h.next_test = Some(format!(
                "Play another {game} session — if 1% lows stay where they are after the update, Windows is the likely factor."
            ));
        } else {
            let covered_before = inp.snapshots.iter().any(|s| {
                !s.windows_build.is_empty()
                    && parse_utc(&s.observed_at).is_some_and(|t| t <= bt)
            });
            let covered_after = inp.snapshots.iter().any(|s| {
                !s.windows_build.is_empty()
                    && parse_utc(&s.observed_at).is_some_and(|t| t >= ct)
            });
            if covered_before && covered_after && !ambiguous_win {
                h.contradicting.push(
                    "Compy's identity checks bracket this window and recorded no Windows build change.".into(),
                );
            } else {
                h.missing.push(
                    "Windows build wasn't being recorded across this whole window — an update can't be ruled in or out.".into(),
                );
            }
        }
        evals.push(h);
    }

    // compy-config-change: the Trust Ledger is a complete record of what Compy itself did,
    // so silence here is real contradicting evidence (unlike the observed sources) — but ONLY
    // while `ledger` says the record is whole. See `LedgerHealth`.
    {
        let mut h = HypoEval::new("compy-config-change");
        h.direct = true;
        let ledger_events: Vec<&EventRecord> = inp
            .events_window
            .iter()
            .filter(|e| e.event_type == "change-applied" || e.event_type == "change-rolled-back")
            .collect();
        for e in &ledger_events {
            h.supporting.push(e.summary.clone());
        }
        // #669: a session that recorded no count (its start couldn't read the change history, or
        // couldn't confirm any change) can neither show a delta nor vouch for a match — `counts` is Ok
        // only when both sides did. 453-f1: both counts are made the same way (per change on both, or
        // the older rule on both), and per change the active and can't-confirm counts compare apart.
        let counts = crate::sessions::comparable_change_counts(b, c);
        if let Ok((then, now)) = counts {
            if then != now {
                h.supporting.push(format!(
                    "Active Compy changes: {then} during the baseline vs {now} during this session (older rollbacks carry no date and show up only in this count)."
                ));
            }
        }
        if h.supporting.is_empty() {
            match (ledger, counts) {
                (LedgerHealth::Complete, Ok((_, now))) => h.contradicting.push(format!(
                    "No Compy changes were applied or rolled back between these sessions and the active-change count matches ({now})."
                )),
                // A count never recorded is the ABSENCE of evidence too: the hypothesis stays open.
                (LedgerHealth::Complete, Err(missing)) => h.missing.push(format!(
                    "One of these sessions didn't record how many Compy changes were active ({} when it began) — a Compy change can't be ruled in or out.",
                    missing.unrecorded_changes_reason()
                )),
                // Silence from a ledger we could not read is the ABSENCE of evidence, not
                // evidence of absence. Route it to `missing` so the hypothesis lands in
                // unknowns instead of ruled_out — Compy never clears itself off a record it
                // couldn't read. Same idiom as the Windows-build gap above.
                (LedgerHealth::Incomplete, _) => h.missing.push(
                    "Compy's own change record couldn't be read for this window — a Compy change can't be ruled in or out."
                        .into(),
                ),
            }
        } else {
            h.next_test = Some(
                "Roll back the change in the Trust Ledger, play one more session, and compare — that isolates it.".into(),
            );
            // The one place an id can be named honestly. Three conditions, all read — none
            // inferred:
            //   1. the window's ledger events name exactly ONE distinct rec. The sentence says
            //      "the change", singular; with two candidates, picking one would be
            //      fabrication-by-selection, and with none (support came only from the
            //      active-count delta, which carries no ids) there is nothing to name;
            //   2. that rec has an apply event here — a rollback alone is not a thing to undo;
            //   3. the apply is not `since_rolled_back`. You can only roll back what is still
            //      applied. Deliberately NOT gated on `is_appliable`: LOCKED rule 3 resolves
            //      rollback from history.json alone, so a rec that has since left the apply
            //      allowlist is still undoable and suppressing it would be the wrong answer.
            let mut distinct: Vec<&str> = ledger_events.iter().filter_map(|e| e.rec_id.as_deref()).collect();
            distinct.sort_unstable();
            distinct.dedup();
            if let [only] = distinct[..] {
                let still_applied = ledger_events.iter().any(|e| {
                    e.event_type == "change-applied"
                        && e.rec_id.as_deref() == Some(only)
                        && !e.since_rolled_back
                });
                if still_applied {
                    h.next_test_rec_id = Some(only.to_string());
                }
            }
        }
        evals.push(h);
    }

    // gaming-mode-difference: recorded per session from Intelligence Phase 1 on; old
    // records are honestly Unknown.
    {
        let mut h = HypoEval::new("gaming-mode-difference");
        match (b.gaming_mode_active, c.gaming_mode_active) {
            (Some(x), Some(y)) if x != y => {
                h.direct = true;
                let on_off = |v: bool| if v { "on" } else { "off" };
                h.supporting.push(format!(
                    "Gaming Mode was {} for the baseline and {} for this session.",
                    on_off(x),
                    on_off(y)
                ));
                h.next_test = Some(format!(
                    "Play {game} once with Gaming Mode {} to compare like-for-like.",
                    on_off(x)
                ));
            }
            (Some(x), Some(_)) => {
                h.contradicting.push(format!(
                    "Gaming Mode state matched on both sessions ({}).",
                    if x { "on" } else { "off" }
                ));
            }
            _ => {
                h.missing.push(
                    "Gaming Mode state wasn't recorded for one of these sessions (Compy records it from now on).".into(),
                );
            }
        }
        evals.push(h);
    }

    // power-plan-change: identity snapshots only — same coverage logic as Windows.
    {
        let mut h = HypoEval::new("power-plan-change");
        let plan_events: Vec<&EventRecord> = inp
            .events_window
            .iter()
            .filter(|e| e.event_type == "power-plan-change")
            .collect();
        let ambiguous_plan = inp
            .events_ambiguous
            .iter()
            .any(|e| e.event_type == "power-plan-change");
        if !plan_events.is_empty() {
            for e in &plan_events {
                h.supporting.push(e.summary.clone());
            }
            h.next_test = Some("Set the power plan back and play one more session to compare.".into());
        } else {
            let covered_before = inp.snapshots.iter().any(|s| {
                !s.power_plan.is_empty() && parse_utc(&s.observed_at).is_some_and(|t| t <= bt)
            });
            let covered_after = inp.snapshots.iter().any(|s| {
                !s.power_plan.is_empty() && parse_utc(&s.observed_at).is_some_and(|t| t >= ct)
            });
            if covered_before && covered_after && !ambiguous_plan {
                h.contradicting.push(
                    "Compy's identity checks bracket this window and recorded no power-plan change.".into(),
                );
            } else {
                h.missing.push(
                    "The power plan wasn't being recorded across this whole window — a change can't be ruled in or out.".into(),
                );
            }
        }
        evals.push(h);
    }

    // setting-drift: Drift Watch noticed a monitored readiness check regress inside this
    // window. Dated by NOTICE time (which can lag the change) and silent about who or
    // what changed it — so it is never direct evidence and never joins the change family
    // (a power-plan drift and a power-plan-change snapshot can be the SAME underlying
    // change; family membership would double-count it into a false confound). Capped at
    // Medium via the environment band. A quiet window pushes nothing at all: drift scans
    // are opportunistic, so silence neither supports nor rules out.
    {
        let mut h = HypoEval::new("setting-drift");
        h.environment = true;
        let drift_events: Vec<&EventRecord> = inp
            .events_window
            .iter()
            .filter(|e| e.event_type == "readiness-drift")
            .collect();
        for e in &drift_events {
            h.supporting.push(e.summary.clone());
        }
        if !drift_events.is_empty() {
            h.next_test = Some(
                "Restore the drifted setting from the readiness check that names it, then play one more session to compare.".into(),
            );
        }
        evals.push(h);
    }

    // memory-pressure: direction-aware — pressure must sit in the WORSE session.
    {
        let mut h = HypoEval::new("memory-pressure");
        h.environment = true;
        let pct = |s: &crate::sessions::SessionSummary| -> Option<f64> {
            match (s.peak_ram_used_bytes, s.ram_total_bytes) {
                (Some(u), Some(t)) if t > 0 => Some(u as f64 / t as f64 * 100.0),
                _ => None,
            }
        };
        match (pct(b), pct(c)) {
            (Some(pb), Some(pc)) => {
                let (worse, better) = if current_is_worse { (pc, pb) } else { (pb, pc) };
                if worse - better >= 10.0 && worse >= 90.0 {
                    h.supporting.push(format!(
                        "RAM peaked at {worse:.0}% of capacity during the slower session vs {better:.0}% in the better one."
                    ));
                    h.next_test = Some(
                        "Close background apps next session and watch whether RAM stays lower and the 1% lows recover.".into(),
                    );
                } else if better - worse >= 10.0 && better >= 90.0 {
                    h.contradicting.push(format!(
                        "RAM pressure was higher in the session that ran BETTER ({better:.0}% vs {worse:.0}%) — memory pressure doesn't explain this."
                    ));
                } else if worse >= 90.0 && better >= 90.0 {
                    h.contradicting.push(format!(
                        "RAM was tight in BOTH sessions ({pb:.0}% vs {pc:.0}%) — pressure alone doesn't explain the difference."
                    ));
                } else {
                    h.contradicting.push(format!(
                        "RAM peaks were similar and unremarkable ({pb:.0}% vs {pc:.0}%)."
                    ));
                }
            }
            _ => {
                h.missing
                    .push("RAM peaks weren't recorded on one of these sessions.".into());
            }
        }
        evals.push(h);
    }

    // thermal: direction-aware, GPU peak temps.
    {
        let mut h = HypoEval::new("thermal");
        h.environment = true;
        match (b.peak_gpu_temp_c, c.peak_gpu_temp_c) {
            (Some(tb), Some(tc)) => {
                let (worse, better) = if current_is_worse {
                    (i64::from(tc), i64::from(tb))
                } else {
                    (i64::from(tb), i64::from(tc))
                };
                if worse - better >= 8 && worse >= 85 {
                    h.supporting.push(format!(
                        "The GPU peaked at {worse}°C in the slower session vs {better}°C in the better one."
                    ));
                    h.next_test = Some(
                        "Check airflow and temps next session — if the GPU stays cooler and the 1% lows recover, heat was the factor.".into(),
                    );
                } else if better - worse >= 8 && better >= 85 {
                    h.contradicting.push(format!(
                        "The GPU ran hotter in the session that performed BETTER ({better}°C vs {worse}°C) — heat doesn't explain this."
                    ));
                } else {
                    h.contradicting.push(format!(
                        "GPU peak temps were close ({tb}°C vs {tc}°C)."
                    ));
                }
            }
            _ => {
                h.missing
                    .push("GPU peak temperature wasn't recorded on one of these sessions.".into());
            }
        }
        evals.push(h);
    }

    // game-variance: can never be positively proven from two sessions — it needs
    // repetition, which is exactly the next test.
    {
        let mut h = HypoEval::new("game-variance");
        h.missing.push(format!(
            "Another unchanged {game} session would show whether this repeats or was a one-off."
        ));
        evals.push(h);
    }

    // insufficient-evidence: becomes the leader only when nothing else is supported.
    let any_supported = evals.iter().any(|h| !h.supporting.is_empty());
    {
        let mut h = HypoEval::new("insufficient-evidence");
        if !any_supported {
            h.supporting.push(
                "Nothing Compy recorded (driver, Windows, Compy config, power plan, monitored settings, hardware, RAM, temps) changed between these sessions.".into(),
            );
            h.next_test = Some(format!(
                "Play another {game} session with nothing changed — if the difference repeats, there's a real cause to find."
            ));
        }
        evals.push(h);
    }

    // Ambiguous observed windows: real signal Compy can't place before-vs-between.
    let mut unknowns: Vec<String> = Vec::new();
    for e in &inp.events_ambiguous {
        unknowns.push(format!(
            "{} — observed in a window that overlaps these sessions; Compy can't place it before or between them.",
            e.summary
        ));
    }

    // Confounded check: ≥2 SUPPORTED discrete changes ⇒ attribution refused.
    let supported_family: Vec<&str> = evals
        .iter()
        .filter(|h| !h.supporting.is_empty() && CHANGE_FAMILY.contains(&h.id))
        .map(|h| h.id)
        .collect();
    let confounded = supported_family.len() >= 2;

    // Confidence bands — the documented rules, in order:
    //   no support → (contradicted ⇒ ruled out, else its gaps go to unknowns)
    //   supported + contradicted → Low
    //   supported + confounded (change family) → Low (attribution refused)
    //   Medium-capped signal (memory/thermal pressure, notice-dated drift) → Medium
    //   change family, sole supported, direct per-session evidence, |delta| ≥ 2×floor,
    //     gap ≤ 14 days → High; anything less → Medium
    //   insufficient-evidence → Low (absence of evidence is weak evidence)
    let abs_delta = delta_low1.abs();
    let mut leading: Vec<Hypothesis> = Vec::new();
    let mut ruled_out: Vec<Hypothesis> = Vec::new();
    for h in evals {
        if h.supporting.is_empty() {
            if !h.contradicting.is_empty() {
                ruled_out.push(Hypothesis {
                    id: h.id.into(),
                    title: hypothesis_title(h.id).into(),
                    confidence: Confidence::Unknown,
                    supporting_evidence: h.supporting,
                    contradicting_evidence: h.contradicting,
                    missing_evidence: h.missing,
                    next_test: None,
                    // Ruled out — there is no test to route, so there is no id to carry.
                    next_test_rec_id: None,
                });
            } else {
                unknowns.extend(h.missing);
            }
            continue;
        }
        let is_family = CHANGE_FAMILY.contains(&h.id);
        // Two distinct reasons cap at Low: supported-but-contradicted evidence, and a
        // change-family member inside a confounded window (≥2 simultaneous changes —
        // attribution refused, no single change may outrank the others).
        let confidence = if !h.contradicting.is_empty() || (confounded && is_family) {
            Confidence::Low
        } else if h.environment {
            Confidence::Medium
        } else if is_family {
            if h.direct && supported_family.len() == 1 && abs_delta >= 2.0 * floor && gap_days <= STALE_GAP_DAYS {
                Confidence::High
            } else {
                Confidence::Medium
            }
        } else {
            Confidence::Low
        };
        leading.push(Hypothesis {
            id: h.id.into(),
            title: hypothesis_title(h.id).into(),
            confidence,
            supporting_evidence: h.supporting,
            contradicting_evidence: h.contradicting,
            missing_evidence: h.missing,
            next_test: h.next_test,
            next_test_rec_id: h.next_test_rec_id,
        });
    }

    // Rank: confidence desc → more supporting evidence → catalog order. Deterministic.
    leading.sort_by(|a, b| {
        b.confidence
            .cmp(&a.confidence)
            .then_with(|| b.supporting_evidence.len().cmp(&a.supporting_evidence.len()))
            .then_with(|| catalog_index(&a.id).cmp(&catalog_index(&b.id)))
    });
    ruled_out.sort_by_key(|h| catalog_index(&h.id));
    unknowns.dedup();

    let mut headline = format!(
        "1% lows {direction_word} {abs_delta:.1}% vs your previous {game} session."
    );
    let next_action: Option<String>;
    let mut next_action_rec_id: Option<String> = None;
    if confounded {
        headline.push_str(" Several things changed in between — no single cause can be honestly isolated.");
        next_action = Some(format!(
            "Change one thing at a time: undo or keep one change, then play another {game} session — Compy can attribute cleanly from there."
        ));
        notes.push(format!(
            "Multiple changes landed between these sessions ({}) — Compy won't pretend to isolate one.",
            supported_family
                .iter()
                .map(|id| hypothesis_title(id))
                .collect::<Vec<_>>()
                .join(" + ")
        ));
    } else if let Some(leader) = leading.first() {
        if leader.id == "insufficient-evidence" {
            headline.push_str(" Nothing Compy recorded changed in between — cause unknown.");
        } else {
            // The confidence word lives on the hypothesis itself, where the shared confidence
            // vocabulary renders it with its gloss (self-review 2026-10-28, P7-confidence). The
            // headline is prose and must not carry a raw, unglossed "(medium confidence)".
            headline.push_str(&format!(" Most likely: {}.", leader.title));
        }
        next_action = leader.next_test.clone();
        next_action_rec_id = leader.next_test_rec_id.clone();
    } else {
        next_action = None;
    }

    let mut r = base(verdict, headline);
    r.observations = observations;
    r.leading_hypotheses = leading;
    r.ruled_out = ruled_out;
    r.unknowns = unknowns;
    r.next_action = next_action;
    r.next_action_rec_id = next_action_rec_id;
    r.confounded = confounded;
    r.gap_days = gap_days;
    r.notes = notes;
    r
}

// ─── Commands (read-only) ────────────────────────────────────────────────

pub(crate) fn gaming_status_label(s: crate::gaming_session::SessionStatus) -> &'static str {
    use crate::gaming_session::SessionStatus as S;
    match s {
        S::Active => "active",
        S::Ending => "ending",
        S::RestorePending => "restore pending",
        S::RestoreFailed => "restore FAILED — needs attention",
    }
}

struct Gathered {
    applied: Vec<crate::history::AppliedChange>,
    sessions: Vec<crate::sessions::SessionSummary>,
    gaming_slot: Option<(String, &'static str)>,
    awards: Vec<crate::benchmark_scoreboard::AwardEntry>,
    benchmark_baseline_at: Option<String>,
    comparison: Option<crate::comparison::ComparisonResult>,
    snapshots: Vec<IdentitySnapshot>,
    drift_notices: Vec<crate::drift::DriftNotice>,
    /// Whether `applied` loaded at all. The timeline can honestly show fewer rows; the "What
    /// changed?" engine cannot honestly claim Compy was quiet, so it needs this told to it, together
    /// with `set_aside_through`, per window ([`Gathered::ledger_since`]).
    ledger_loaded: bool,
    /// #618: when an earlier, damaged ledger was set aside (`history::ledger_set_aside_through`), read
    /// AFTER the load so a set-aside the load caused is seen.
    set_aside_through: Result<Option<DateTime<Utc>>, String>,
}

impl Gathered {
    /// #618: whether the Trust Ledger is a whole record of Compy's own moves since `since`, a
    /// window's start (RFC 3339). A set-aside history lost only moves at or before its last write, so
    /// a window that began after it (`history::ledger_coverage`) is still covered and its silence is
    /// real evidence; one that began at or before it, or an unknown either side, is not. The marker
    /// is permanent, so a plain "was it ever set aside?" left Care unable to rule Compy out forever.
    fn ledger_since(&self, since: &str) -> LedgerHealth {
        if !self.ledger_loaded {
            return LedgerHealth::Incomplete;
        }
        match crate::history::ledger_coverage(self.set_aside_through.clone(), Some(since)) {
            crate::history::LedgerCoverage::Whole | crate::history::LedgerCoverage::SinceSetAside(_) => {
                LedgerHealth::Complete
            }
            crate::history::LedgerCoverage::Lost | crate::history::LedgerCoverage::Unknown => LedgerHealth::Incomplete,
        }
    }
}

fn gather() -> Gathered {
    // One load, two readings. `unwrap_or_default` is fine for the timeline VIEW below — an empty
    // view is honest — but the error it swallows is exactly what the engine needs, so capture the
    // health before collapsing it. Transient failure (Err) is incompleteness for every window; a
    // durable loss (a ledger set aside, which loads Ok and empty forever after) only for a window
    // that began at or before it (#618, `Gathered::ledger_since`). The marker is read AFTER the load
    // (#618 review P2), so a set-aside this load caused, or a reader made just before, is seen.
    let loaded = crate::history::load_history();
    let set_aside_through = crate::history::ledger_set_aside_through();
    Gathered {
        ledger_loaded: loaded.is_ok(),
        set_aside_through,
        applied: loaded.unwrap_or_default(),
        sessions: crate::sessions::get_session_summaries(),
        gaming_slot: crate::gaming_session::load_session()
            .map(|f| (f.started_at.clone(), gaming_status_label(f.status))),
        awards: crate::benchmark_scoreboard::scoreboard().awards,
        benchmark_baseline_at: crate::benchmark::benchmark_state().baseline_at,
        comparison: crate::comparison::latest_result(),
        snapshots: load_store().identity_snapshots,
        drift_notices: crate::drift::active_drift_notices(),
    }
}

fn assemble_from(g: &Gathered) -> TimelineAssembly {
    assemble_timeline(&TimelineInputs {
        applied: &g.applied,
        sessions: &g.sessions,
        gaming_slot: g.gaming_slot.clone(),
        awards: &g.awards,
        benchmark_baseline_at: g.benchmark_baseline_at.clone(),
        comparison: g.comparison.as_ref(),
        snapshots: &g.snapshots,
        drift_notices: &g.drift_notices,
    })
}

/// P4-show-f1: why a session with no reading can't be compared.
const NOTHING_MEASURED: &str =
    "That session measured nothing: another window was in front the whole time, so there's nothing to compare.";

fn what_changed_impl(g: &Gathered, started_at: &str) -> WhatChangedOutcome {
    let Some(current) = g.sessions.iter().find(|s| s.started_at == started_at) else {
        return WhatChangedOutcome::Unavailable {
            reason: "Session not found — it may have been pruned from the session history.".into(),
        };
    };
    if current.samples == 0 {
        return WhatChangedOutcome::Unavailable { reason: NOTHING_MEASURED.into() };
    }
    let Some(ct) = parse_utc(&current.started_at) else {
        return WhatChangedOutcome::Unavailable {
            reason: "This session's timestamp is unreadable — Compy won't guess at the order.".into(),
        };
    };
    // Baseline = the most recent EARLIER session of the same game that measured play (adjacent
    // comparison; a session behind another window the whole time has nothing to compare, P4-show-f1).
    let baseline = g
        .sessions
        .iter()
        .filter(|s| {
            s.process_name.eq_ignore_ascii_case(&current.process_name)
                && s.started_at != current.started_at
                && s.samples > 0
        })
        .filter_map(|s| parse_utc(&s.started_at).map(|t| (t, s)))
        .filter(|(t, _)| *t < ct)
        .max_by_key(|(t, _)| *t)
        .map(|(_, s)| s);
    let Some(baseline) = baseline else {
        return WhatChangedOutcome::Unavailable {
            reason: format!(
                "First recorded {} session — nothing earlier to compare against.",
                pretty_game_name(&current.process_name)
            ),
        };
    };
    let bt = parse_utc(&baseline.started_at).unwrap_or(ct);
    let asm = assemble_from(g);
    let (events_window, events_ambiguous) = split_window_events(&asm.events, bt, ct);
    WhatChangedOutcome::Report(Box::new(what_changed(
        &WhatChangedInputs {
            baseline,
            current,
            events_window,
            events_ambiguous,
            snapshots: &g.snapshots,
        },
        g.ledger_since(&baseline.started_at),
    )))
}

/// "What changed?" for one monitored session vs the previous session of the same game.
#[tauri::command]
pub(crate) fn what_changed_for_session(started_at: String) -> WhatChangedOutcome {
    refresh_identity_snapshots_async();
    let g = gather();
    what_changed_impl(&g, &started_at)
}

/// The good-vs-bad investigation core (§4D): compare two sessions the user chose
/// explicitly, rather than the auto-picked adjacent pair. Same deterministic engine —
/// only the baseline/current selection differs. Every failure is an honest, first-class
/// "unavailable," never a guessed or misleading comparison.
fn what_changed_between_impl(
    g: &Gathered,
    baseline_started_at: &str,
    current_started_at: &str,
) -> WhatChangedOutcome {
    let find = |ts: &str| g.sessions.iter().find(|s| s.started_at == ts);
    let (Some(baseline), Some(current)) = (find(baseline_started_at), find(current_started_at))
    else {
        return WhatChangedOutcome::Unavailable {
            reason: "One of the chosen sessions is no longer in the history — it may have been pruned.".into(),
        };
    };
    if baseline.started_at == current.started_at {
        return WhatChangedOutcome::Unavailable {
            reason: "Those are the same session — pick two different sessions to compare.".into(),
        };
    }
    if baseline.samples == 0 || current.samples == 0 {
        return WhatChangedOutcome::Unavailable { reason: NOTHING_MEASURED.into() };
    }
    // Like-for-like only: a game's 1% low is only meaningful against itself. Comparing two
    // different games would look like a verdict but measure nothing honest.
    if !baseline.process_name.eq_ignore_ascii_case(&current.process_name) {
        return WhatChangedOutcome::Unavailable {
            reason: format!(
                "Those are different games ({} vs {}) — Compy compares a game against itself, so their 1% lows aren't comparable.",
                pretty_game_name(&baseline.process_name),
                pretty_game_name(&current.process_name),
            ),
        };
    }
    let (Some(bt), Some(ct)) = (parse_utc(&baseline.started_at), parse_utc(&current.started_at))
    else {
        return WhatChangedOutcome::Unavailable {
            reason: "One of these sessions has an unreadable timestamp — Compy won't guess at the order.".into(),
        };
    };
    // The engine reads time forward (baseline → current), so the baseline must be the
    // earlier session. A reverse pick would open a negative window — refuse it plainly
    // rather than invert the user's choice behind their back.
    if bt >= ct {
        return WhatChangedOutcome::Unavailable {
            reason: "The baseline has to be the earlier session — pick the older one as the baseline and the newer one to investigate.".into(),
        };
    }
    let asm = assemble_from(g);
    let (events_window, events_ambiguous) = split_window_events(&asm.events, bt, ct);
    WhatChangedOutcome::Report(Box::new(what_changed(
        &WhatChangedInputs {
            baseline,
            current,
            events_window,
            events_ambiguous,
            snapshots: &g.snapshots,
        },
        g.ledger_since(&baseline.started_at),
    )))
}

/// "What changed?" between two sessions the user picked (the good-vs-bad workflow, §4D).
#[tauri::command]
pub(crate) fn what_changed_between(
    baseline_started_at: String,
    current_started_at: String,
) -> WhatChangedOutcome {
    refresh_identity_snapshots_async();
    let g = gather();
    what_changed_between_impl(&g, &baseline_started_at, &current_started_at)
}

// ─── P6-changed: "Changed before this" for one Black Box incident ─────────
//
// The same gather and timeline as "What changed?", anchored on an incident's time instead of a
// second session. The window runs from the last clean session before the incident (or, when every
// earlier session had an incident of its own, the last measured one) up to the incident. Each of
// six categories gets an honest status: `changed` (events inside the window), `no-change` (a
// reading at or before the window start AND one at or after the incident, with nothing between),
// or `unknown` with a reason code. Missing or unreadable evidence is never shown as "no change",
// and nothing here names a cause: the surface tags every line "not proven cause" (Constitution
// §17, §25). Read-only: no probe, no write, not even to Compy's own stores.

/// The session the "Changed before this" window starts at.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct ChangedBeforeAnchor {
    pub started_at: String,
    pub game: String,
}

/// One category's honest answer for the window.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct ChangedBeforeItem {
    /// "compy-changes" | "driver" | "windows-build" | "power-plan" | "hardware" | "drift"
    pub category: String,
    /// "changed" | "no-change" | "unknown"
    pub status: String,
    /// `changed`: the events inside the window. `unknown` + "cant-place": the events Compy can't
    /// place before or after the incident. Empty otherwise.
    pub events: Vec<EventRecord>,
    /// Set only when `status` is "unknown": "no-reading-before" | "no-reading-after" |
    /// "cant-place" | "readings-differ" | "unmatched-readings" | "ledger-incomplete" |
    /// "drift-not-kept".
    pub unknown_reason: Option<String>,
    /// "no-reading-after" only: the newest reading Compy has of this, before the incident.
    pub last_reading_at: Option<String>,
    /// "no-change" only, for observed categories: the two readings that bracket the window.
    pub checked_between: Option<(String, String)>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct ChangedBeforeIncident {
    /// "clean" (no incident during that session) | "measured" (every earlier session had one) |
    /// "none" (no earlier measured session at all — `anchor` is None and `items` is empty).
    pub anchor_kind: String,
    pub anchor: Option<ChangedBeforeAnchor>,
    /// The incident time the window ends at (copied from the incident).
    pub window_end: String,
    pub items: Vec<ChangedBeforeItem>,
}

/// One machine reading Compy holds: identity snapshots carry every field, rig fingerprints (on
/// sessions and ledger applies) carry the GPU, its driver, RAM and display. Empty = not read.
struct CbReading {
    /// Which stream produced it. Readings are only ever compared within one stream: two streams
    /// can word the same value differently, and a pair drawn from two streams has no delta scan
    /// (so no timeline event) behind it.
    stream: &'static str,
    at: DateTime<Utc>,
    at_raw: String,
    driver: String,
    windows: String,
    power: String,
    hardware: String,
}

fn cb_readings(g: &Gathered) -> Vec<CbReading> {
    let mut out = Vec::new();
    let hw = |gpu: &str, ram: u32, display: &str| {
        if gpu.is_empty() {
            String::new()
        } else {
            format!("{gpu}|{ram}|{display}")
        }
    };
    for s in &g.snapshots {
        if let Some(at) = parse_utc(&s.observed_at) {
            out.push(CbReading {
                stream: "identity-snapshot",
                at,
                at_raw: s.observed_at.clone(),
                driver: s.gpu_driver.clone(),
                windows: s.windows_build.clone(),
                power: s.power_plan.clone(),
                hardware: hw(&s.gpu, s.ram_gb, &s.display),
            });
        }
    }
    let prints = g
        .sessions
        .iter()
        .filter_map(|s| Some((s.started_at.as_str(), s.hw_fingerprint.as_ref()?)))
        .chain(
            g.applied
                .iter()
                .filter_map(|c| Some((c.applied_at.as_str(), c.hw_fingerprint.as_ref()?))),
        );
    for (raw, fp) in prints {
        if let Some(at) = parse_utc(raw) {
            out.push(CbReading {
                stream: "rig-fingerprint",
                at,
                at_raw: raw.to_string(),
                driver: fp.gpu_driver.clone(),
                windows: String::new(),
                power: String::new(),
                hardware: hw(&fp.gpu, fp.ram_gb, &fp.display),
            });
        }
    }
    out
}

fn cb_item(category: &str, status: &str) -> ChangedBeforeItem {
    ChangedBeforeItem {
        category: category.into(),
        status: status.into(),
        events: Vec::new(),
        unknown_reason: None,
        last_reading_at: None,
        checked_between: None,
    }
}

fn cb_unknown(category: &str, reason: &str) -> ChangedBeforeItem {
    let mut it = cb_item(category, "unknown");
    it.unknown_reason = Some(reason.into());
    it
}

/// The anchor session: the newest measured session that ENDED before the incident (outside the
/// grace window Black Box uses to call a crash "during that session"), preferring one with no
/// other recorded incident during it. `clean_judgeable_from`: when the scan hit its incident cap,
/// incidents older than its oldest row may be missing, so a session that started before then can't
/// be called clean (it can still anchor as "measured").
fn cb_anchor<'a>(
    sessions: &'a [crate::sessions::SessionSummary],
    incident_at: DateTime<Utc>,
    other_incidents: &[DateTime<Utc>],
    clean_judgeable_from: Option<DateTime<Utc>>,
) -> Option<(&'a crate::sessions::SessionSummary, DateTime<Utc>, bool)> {
    let grace = chrono::Duration::seconds(crate::blackbox::VITALS_GRACE_SECS);
    let mut candidates: Vec<(DateTime<Utc>, bool, &crate::sessions::SessionSummary)> = sessions
        .iter()
        .filter(|s| s.samples > 0)
        .filter_map(|s| {
            let start = parse_utc(&s.started_at)?;
            let end = start + chrono::Duration::seconds(i64::try_from(s.duration_secs).ok()?);
            if end + grace >= incident_at {
                return None; // the incident happened during (or right at the end of) this session
            }
            let clean = clean_judgeable_from.is_none_or(|from| start >= from)
                && !other_incidents.iter().any(|t| *t >= start && *t <= end + grace);
            Some((start, clean, s))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.2.started_at.cmp(&b.2.started_at)));
    candidates
        .iter()
        .find(|(_, clean, _)| *clean)
        .or_else(|| candidates.first())
        .map(|(t, clean, s)| (*s, *t, *clean))
}

/// "No change" for an observed category needs proof from ONE stream: its last reading at or
/// before the window start and its first at or after the incident, holding the SAME value. A pair
/// that differs, or readings that only bracket the window across two streams, are unknown.
fn cb_bracket(
    category: &str,
    readings: &[CbReading],
    field: fn(&CbReading) -> &str,
    win_start: DateTime<Utc>,
    incident_at: DateTime<Utc>,
) -> ChangedBeforeItem {
    let read: Vec<&CbReading> = readings.iter().filter(|r| !field(r).is_empty()).collect();
    let mut equal: Option<(&CbReading, &CbReading)> = None;
    let mut differ = false;
    for stream in ["identity-snapshot", "rig-fingerprint"] {
        let mine = read.iter().filter(|r| r.stream == stream);
        let before = mine.clone().filter(|r| r.at <= win_start).max_by_key(|r| r.at);
        let after = mine.filter(|r| r.at >= incident_at).min_by_key(|r| r.at);
        if let (Some(b), Some(a)) = (before, after) {
            if field(b) == field(a) {
                equal = equal.or(Some((*b, *a)));
            } else {
                differ = true;
            }
        }
    }
    if differ {
        return cb_unknown(category, "readings-differ");
    }
    if let Some((b, a)) = equal {
        let mut it = cb_item(category, "no-change");
        it.checked_between = Some((b.at_raw.clone(), a.at_raw.clone()));
        return it;
    }
    let any_before = read.iter().any(|r| r.at <= win_start);
    let any_after = read.iter().any(|r| r.at >= incident_at);
    match (any_before, any_after) {
        (false, _) => cb_unknown(category, "no-reading-before"),
        (true, true) => cb_unknown(category, "unmatched-readings"),
        (true, false) => {
            let mut it = cb_unknown(category, "no-reading-after");
            it.last_reading_at = read
                .iter()
                .filter(|r| r.at < incident_at)
                .max_by_key(|r| r.at)
                .map(|r| r.at_raw.clone());
            it
        }
    }
}

/// Pure: "Changed before this" for one incident at `incident_at`, over an already-gathered store
/// and its assembled timeline. `other_incidents` are the times of every OTHER incident on record,
/// used only to tell a clean session from one that had its own incident.
fn changed_before_incident_impl(
    g: &Gathered,
    asm: &TimelineAssembly,
    incident_raw: &str,
    incident_at: DateTime<Utc>,
    other_incidents: &[DateTime<Utc>],
    clean_judgeable_from: Option<DateTime<Utc>>,
) -> ChangedBeforeIncident {
    let Some((anchor, win_start, clean)) =
        cb_anchor(&g.sessions, incident_at, other_incidents, clean_judgeable_from)
    else {
        return ChangedBeforeIncident {
            anchor_kind: "none".into(),
            anchor: None,
            window_end: incident_raw.to_string(),
            items: Vec::new(),
        };
    };
    let (inside, ambiguous) = split_window_events(&asm.events, win_start, incident_at);
    let readings = cb_readings(g);
    let mut items = Vec::new();

    // Compy's own changes: the Trust Ledger is a complete record of what Compy did, so silence is
    // real evidence — unless the ledger is incomplete, when it proves nothing.
    let compy: Vec<EventRecord> =
        inside.iter().filter(|e| e.scope == EventScope::CompyApplied).cloned().collect();
    items.push(if !compy.is_empty() {
        let mut it = cb_item("compy-changes", "changed");
        it.events = compy;
        it
    } else if g.ledger_since(&win_start.to_rfc3339()) == LedgerHealth::Complete {
        cb_item("compy-changes", "no-change")
    } else {
        cb_unknown("compy-changes", "ledger-incomplete")
    });

    // Observed categories: changed / can't place / bracketed by readings / unknown.
    type Field = fn(&CbReading) -> &str;
    let observed: [(&str, &str, Field); 4] = [
        ("driver", "gpu-driver-change", |r| &r.driver),
        ("windows-build", "windows-build-change", |r| &r.windows),
        ("power-plan", "power-plan-change", |r| &r.power),
        ("hardware", "hardware-change", |r| &r.hardware),
    ];
    for (category, event_type, field) in observed {
        let hits: Vec<EventRecord> =
            inside.iter().filter(|e| e.event_type == event_type).cloned().collect();
        if !hits.is_empty() {
            let mut it = cb_item(category, "changed");
            it.events = hits;
            items.push(it);
            continue;
        }
        let unplaced: Vec<EventRecord> =
            ambiguous.iter().filter(|e| e.event_type == event_type).cloned().collect();
        if !unplaced.is_empty() {
            let mut it = cb_unknown(category, "cant-place");
            it.events = unplaced;
            items.push(it);
            continue;
        }
        items.push(cb_bracket(category, &readings, field, win_start, incident_at));
    }

    // Drift: Drift Watch keeps only drift that is still open, so a drift that already cleared is
    // gone. No notice in the window is therefore unknown, never "no drift".
    let drift: Vec<EventRecord> =
        inside.iter().filter(|e| e.event_type == "readiness-drift").cloned().collect();
    let drift_unplaced: Vec<EventRecord> =
        ambiguous.iter().filter(|e| e.event_type == "readiness-drift").cloned().collect();
    items.push(if !drift.is_empty() {
        let mut it = cb_item("drift", "changed");
        it.events = drift;
        it
    } else if !drift_unplaced.is_empty() {
        let mut it = cb_unknown("drift", "cant-place");
        it.events = drift_unplaced;
        it
    } else {
        cb_unknown("drift", "drift-not-kept")
    });

    ChangedBeforeIncident {
        anchor_kind: if clean { "clean" } else { "measured" }.into(),
        anchor: Some(ChangedBeforeAnchor {
            started_at: anchor.started_at.clone(),
            game: pretty_game_name(&anchor.process_name),
        }),
        window_end: incident_raw.to_string(),
        items,
    }
}

fn attach_changed_before_from(g: &Gathered, report: &mut crate::blackbox::BlackBoxReport) {
    let asm = assemble_from(g);
    // The scan is complete only back to its truncation point (any capped read that came back full,
    // or the incident cut); before that, "clean" can't be judged.
    let clean_judgeable_from = report.clean_judgeable_from;
    let incidents = &mut report.incidents;
    let times: Vec<Option<DateTime<Utc>>> = incidents.iter().map(|i| parse_utc(&i.when)).collect();
    for (idx, inc) in incidents.iter_mut().enumerate() {
        let Some(at) = times[idx] else { continue };
        let others: Vec<DateTime<Utc>> = times
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != idx)
            .filter_map(|(_, t)| *t)
            .collect();
        inc.changed_before = Some(changed_before_incident_impl(
            g,
            &asm,
            &inc.when,
            at,
            &others,
            clean_judgeable_from,
        ));
    }
}

/// Edge: one read-only gather for the whole scan, then "Changed before this" on every incident.
/// No identity probe is started — the answer is what Compy already holds.
pub(crate) fn attach_changed_before(report: &mut crate::blackbox::BlackBoxReport) {
    let g = gather();
    if !report.incidents.is_empty() {
        attach_changed_before_from(&g, report);
    }
    // P6-timeline: the Care view's one "Since it last worked" list, from the same gather.
    attach_since_last_worked_from(&g, report, Utc::now());
}

// ─── P6-timeline: "Since it last worked" ─────────────────────────────────
//
// One list on the Care view: what happened after the last session that worked. "Worked" means
// exactly what "Changed before this" calls clean (`cb_anchor` with the incident time set to now):
// a measured session that has ended, with no incident on record during it, inside the span the
// crash scan read in full (`clean_judgeable_from`). No such session → no list, and the view says
// so; it never falls back to a session it can't call clean. The list itself is the assembled
// timeline after that session started: Compy's changes, observed changes (driver, Windows build,
// power plan, hardware), drift, and sessions. Incidents come from the scan the report already
// holds. Read-only, like the rest of this file's Care path.

/// The Care view's "Since it last worked" answer.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct SinceLastWorked {
    /// The last clean session. `None` exactly when `none_reason` is set.
    pub anchor: Option<ChangedBeforeAnchor>,
    /// Why there's no anchor: "no-session" (nothing measured has ended yet) or "none-clean"
    /// (every ended session had an incident, or is older than the crash records Compy read).
    pub none_reason: Option<String>,
    /// Newest first: Compy changes, observed changes, drift and sessions after the anchor started.
    pub events: Vec<EventRecord>,
    /// Observed changes whose reading window straddles the anchor's start: they may be older.
    pub unplaced: Vec<EventRecord>,
    /// Newest first: every drift that is still open and isn't already in `events` or `unplaced`
    /// (it was noticed before the anchor, or there is no anchor). Drift Watch keeps only open
    /// drift, so this is "still drifted now", whatever its age — the one place Check's and Home's
    /// drift pointers lead, even when no session can be called clean.
    pub open_drift: Vec<EventRecord>,
}

fn since_last_worked_impl(
    g: &Gathered,
    asm: &TimelineAssembly,
    incidents: &[DateTime<Utc>],
    clean_judgeable_from: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> SinceLastWorked {
    // Stable: equal timestamps keep the assembler's tie-break order.
    let newest_first = |v: &mut Vec<EventRecord>| {
        v.sort_by_key(|e| std::cmp::Reverse(parse_utc(&e.timestamp)));
    };
    let open_drift_except = |listed: &[&EventRecord]| {
        let mut v: Vec<EventRecord> = asm
            .events
            .iter()
            .filter(|e| e.event_type == "readiness-drift" && !listed.iter().any(|l| l.id == e.id))
            .cloned()
            .collect();
        newest_first(&mut v);
        v
    };
    let none = |reason: &str| SinceLastWorked {
        anchor: None,
        none_reason: Some(reason.into()),
        events: Vec::new(),
        unplaced: Vec::new(),
        open_drift: open_drift_except(&[]),
    };
    let (anchor, start) = match cb_anchor(&g.sessions, now, incidents, clean_judgeable_from) {
        None => return none("no-session"),
        Some((_, _, false)) => return none("none-clean"),
        Some((s, start, true)) => (s, start),
    };
    let (mut events, mut unplaced) = split_window_events(&asm.events, start, now);
    events.extend(asm.events.iter().filter(|e| {
        e.event_type == "session" && parse_utc(&e.timestamp).is_some_and(|t| t > start && t <= now)
    }).cloned());
    newest_first(&mut events);
    newest_first(&mut unplaced);
    let listed: Vec<&EventRecord> = events.iter().chain(unplaced.iter()).collect();
    let open_drift = open_drift_except(&listed);
    SinceLastWorked {
        anchor: Some(ChangedBeforeAnchor {
            started_at: anchor.started_at.clone(),
            game: pretty_game_name(&anchor.process_name),
        }),
        none_reason: None,
        events,
        unplaced,
        open_drift,
    }
}

fn attach_since_last_worked_from(
    g: &Gathered,
    report: &mut crate::blackbox::BlackBoxReport,
    now: DateTime<Utc>,
) {
    let asm = assemble_from(g);
    let incidents: Vec<DateTime<Utc>> =
        report.incidents.iter().filter_map(|i| parse_utc(&i.when)).collect();
    report.since_last_worked =
        Some(since_last_worked_impl(g, &asm, &incidents, report.clean_judgeable_from, now));
}

/// Home's single concise line — only when the latest session shows a meaningful delta.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct IntelligenceHeadline {
    pub text: String,
    pub verdict: String,
    pub game: String,
    pub session_started_at: String,
}

#[tauri::command]
pub(crate) fn get_intelligence_headline() -> Option<IntelligenceHeadline> {
    refresh_identity_snapshots_async();
    let g = gather();
    let latest = g
        .sessions
        .iter()
        .filter(|s| s.samples > 0) // the newest session that measured play (P4-show-f1)
        .filter_map(|s| parse_utc(&s.started_at).map(|t| (t, s)))
        .max_by_key(|(t, _)| *t)
        .map(|(_, s)| s)?;
    match what_changed_impl(&g, &latest.started_at) {
        WhatChangedOutcome::Report(r) if r.verdict == "improved" || r.verdict == "regressed" => {
            Some(IntelligenceHeadline {
                text: r.headline.clone(),
                verdict: r.verdict.clone(),
                game: r.game.clone(),
                session_started_at: r.current.started_at.clone(),
            })
        }
        _ => None,
    }
}

// ─── Guard tests (§5G) ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::HwFingerprint;
    use crate::sessions::SessionSummary;

    fn mk_session(started_at: &str, game: &str, low1: f64, avg: f64) -> SessionSummary {
        SessionSummary {
            started_at: started_at.into(),
            duration_secs: 600,
            process_name: game.into(),
            samples: 600,
            avg_fps: avg,
            avg_frametime_ms: if avg > 0.0 { 1000.0 / avg } else { 0.0 },
            low1_fps_est: low1,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: Some(0),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            compy_changes_since_set_aside: None,
            hw_fingerprint: None,
            gaming_mode_active: None,
            stutter_insight: None,
            stutter_timeline: vec![],
            stutter_events: vec![],
            fps_series: vec![],
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
            background_secs_excluded: None,
            frame_pacing: None,
        }
    }

    fn mk_fp(driver: &str) -> HwFingerprint {
        HwFingerprint {
            hash: format!("hash-{driver}"),
            gpu: "Radeon RX 9070 XT".into(),
            gpu_driver: driver.into(),
            ram_gb: 32,
            display: "2560x1440@165".into(),
        }
    }

    fn mk_change(id: &str, title: &str, applied_at: &str, status: &str) -> crate::history::AppliedChange {
        crate::history::AppliedChange {
            id: id.into(),
            rec_id: id.into(),
            rec_title: title.into(),
            applied_at: applied_at.into(),
            snapshot: serde_json::Value::Null,
            status: status.into(),
            applied_action: None,
            rollback_action: None,
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
        }
    }

    fn mk_snap(observed_at: &str, driver: &str, build: &str, plan: &str) -> IdentitySnapshot {
        IdentitySnapshot {
            observed_at: observed_at.into(),
            gpu: "Radeon RX 9070 XT".into(),
            gpu_driver: driver.into(),
            gpu_driver_date: String::new(),
            windows_build: build.into(),
            windows_ubr: Some(4061),
            windows_display_version: "24H2".into(),
            power_plan: plan.into(),
            ram_gb: 32,
            display: "2560x1440@165".into(),
            hw_hash: "h".into(),
        }
    }

    fn empty_inputs<'a>(
        applied: &'a [crate::history::AppliedChange],
        sessions: &'a [SessionSummary],
        snapshots: &'a [IdentitySnapshot],
    ) -> TimelineInputs<'a> {
        TimelineInputs {
            applied,
            sessions,
            gaming_slot: None,
            awards: &[],
            benchmark_baseline_at: None,
            comparison: None,
            snapshots,
            drift_notices: &[],
        }
    }

    fn apply_event(ts: &str, title: &str) -> EventRecord {
        EventRecord {
            id: format!("apply:{ts}"),
            timestamp: ts.into(),
            event_type: "change-applied".into(),
            source: "trust-ledger".into(),
            scope: EventScope::CompyApplied,
            game: None,
            summary: format!("{title} applied"),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
            parts: None,
        }
    }

    /// The engine under a ledger that is known-good — the case every hypothesis test below is
    /// about. The incomplete-ledger case has its own guard (see
    /// `an_unreadable_ledger_never_clears_compy_of_a_regression`) and must be spelled out
    /// explicitly, so it can never be reached by accident from a default.
    fn report(inp: &WhatChangedInputs) -> WhatChangedReport {
        what_changed(inp, LedgerHealth::Complete)
    }

    // ── Timeline guards ──

    #[test]
    fn timeline_order_is_deterministic_and_total() {
        let applied = vec![
            mk_change("c1", "HAGS on", "2026-07-10T10:00:00Z", "applied"),
            mk_change("c0", "Game Mode on", "2026-07-10T10:00:00Z", "applied"),
        ];
        let sessions = vec![
            mk_session("2026-07-10T10:00:00Z", "cp2077.exe", 80.0, 120.0),
            mk_session("2026-07-09T10:00:00Z", "cp2077.exe", 82.0, 121.0),
        ];
        let a = assemble_timeline(&empty_inputs(&applied, &sessions, &[]));
        // Reversed input order must produce the identical event sequence.
        let applied_rev: Vec<_> = applied.iter().rev().cloned().collect();
        let sessions_rev: Vec<_> = sessions.iter().rev().cloned().collect();
        let b = assemble_timeline(&empty_inputs(&applied_rev, &sessions_rev, &[]));
        let ids_a: Vec<&str> = a.events.iter().map(|e| e.id.as_str()).collect();
        let ids_b: Vec<&str> = b.events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids_a, ids_b, "assembly must be input-order independent");
        // Ascending by time; same-timestamp events: applies (priority 5) before the
        // session (priority 11), and equal-priority ties break on id.
        assert_eq!(
            ids_a,
            vec![
                "session:2026-07-09T10:00:00Z",
                "apply:c0",
                "apply:c1",
                "session:2026-07-10T10:00:00Z",
            ]
        );
    }

    #[test]
    fn every_event_timestamp_is_copied_from_a_source_record() {
        let applied = vec![mk_change("c1", "HAGS on", "2026-07-10T10:00:00Z", "applied")];
        let mut s0 = mk_session("2026-07-09T10:00:00Z", "cp2077.exe", 82.0, 121.0);
        s0.hw_fingerprint = Some(mk_fp("25.5.1"));
        let mut s1 = mk_session("2026-07-11T10:00:00Z", "cp2077.exe", 80.0, 120.0);
        s1.hw_fingerprint = Some(mk_fp("25.6.0"));
        let sessions = vec![s0, s1];
        let snaps = vec![
            mk_snap("2026-07-08T09:00:00Z", "25.5.1", "26100", "Balanced"),
            mk_snap("2026-07-12T09:00:00Z", "25.6.0", "26100", "Balanced"),
        ];
        let source_ts: std::collections::HashSet<&str> = [
            "2026-07-10T10:00:00Z",
            "2026-07-09T10:00:00Z",
            "2026-07-11T10:00:00Z",
            "2026-07-08T09:00:00Z",
            "2026-07-12T09:00:00Z",
        ]
        .into_iter()
        .collect();
        let asm = assemble_timeline(&empty_inputs(&applied, &sessions, &snaps));
        assert!(asm.dropped_unparseable == 0);
        for ev in &asm.events {
            assert!(
                source_ts.contains(ev.timestamp.as_str()),
                "event {} carries timestamp {} that exists in no source record (fabrication)",
                ev.id,
                ev.timestamp
            );
            if let Some((a, b)) = &ev.observed_between {
                assert!(source_ts.contains(a.as_str()) && source_ts.contains(b.as_str()));
            }
        }
    }

    #[test]
    fn unstamped_rollback_never_becomes_a_dated_event() {
        // Pre-Phase-2 ledger entries have no `rolled_back_at`: the rollback stays state
        // on the apply event ("since rolled back"), never retro-dated into an event.
        let applied = vec![mk_change("c1", "HAGS on", "2026-07-10T10:00:00Z", "rolled_back")];
        let asm = assemble_timeline(&empty_inputs(&applied, &[], &[]));
        assert_eq!(asm.events.len(), 1, "exactly the apply event — no rollback event");
        let ev = &asm.events[0];
        assert_eq!(ev.event_type, "change-applied");
        assert!(ev.since_rolled_back);
        assert!(ev.summary.contains("since rolled back"));
    }

    #[test]
    fn stamped_rollback_becomes_its_own_dated_event() {
        let mut c1 = mk_change("c1", "HAGS on", "2026-07-10T10:00:00Z", "rolled_back");
        c1.rolled_back_at = Some("2026-07-11T09:00:00Z".into());
        let applied = vec![c1];
        let asm = assemble_timeline(&empty_inputs(&applied, &[], &[]));
        assert_eq!(asm.dropped_unparseable, 0);
        assert_eq!(asm.events.len(), 2, "apply event + dated rollback event");
        let apply = asm.events.iter().find(|e| e.id == "apply:c1").expect("apply event");
        assert!(apply.since_rolled_back, "apply still carries the rolled-back state");
        let rb = asm.events.iter().find(|e| e.id == "rollback:c1").expect("rollback event");
        assert_eq!(rb.event_type, "change-rolled-back");
        assert_eq!(rb.scope, EventScope::CompyApplied);
        // Timestamp is COPIED from the ledger stamp, never synthesized.
        assert_eq!(rb.timestamp, "2026-07-11T09:00:00Z");
        assert!(rb.summary.contains("rolled back"));
        assert!(!rb.since_rolled_back);
    }

    #[test]
    fn unparseable_rollback_stamp_is_dropped_never_guessed() {
        let mut c1 = mk_change("c1", "HAGS on", "2026-07-10T10:00:00Z", "rolled_back");
        c1.rolled_back_at = Some("yesterday-ish".into());
        let applied = vec![c1];
        let asm = assemble_timeline(&empty_inputs(&applied, &[], &[]));
        assert_eq!(asm.events.len(), 1, "only the apply event survives");
        assert_eq!(asm.events[0].event_type, "change-applied");
        assert_eq!(asm.dropped_unparseable, 1, "the bad stamp is counted, not invented");
    }

    fn mk_notice(
        id: &str,
        label: &str,
        last_ready_at: Option<&str>,
        noticed_at: &str,
    ) -> crate::drift::DriftNotice {
        crate::drift::DriftNotice {
            id: id.into(),
            label: label.into(),
            last_ready_at: last_ready_at.map(Into::into),
            noticed_at: noticed_at.into(),
        }
    }

    /// #456: `machine_model::MAX_OBSERVED_CHRONOLOGY` is written out as snapshot retention × the
    /// kinds one reading can emit. This pins the second factor against the scanner itself, so a
    /// fifth observed kind cannot be added to `feed` without the ceiling's arithmetic failing.
    #[test]
    fn one_identity_reading_adds_at_most_the_declared_observed_kinds() {
        let reading = |at: &str, driver: &str, ram_gb: u32, display: &str, build: &str, plan: &str| {
            IdentitySnapshot {
                observed_at: at.into(),
                gpu: "Radeon RX 9070 XT".into(),
                gpu_driver: driver.into(),
                gpu_driver_date: String::new(),
                windows_build: build.into(),
                windows_ubr: Some(1),
                windows_display_version: "24H2".into(),
                power_plan: plan.into(),
                ram_gb,
                display: display.into(),
                hw_hash: "h".into(),
            }
        };
        // Every field the scanner watches changes between the two readings, GPU held so the
        // driver delta is not reset as a swap artefact — the widest single reading there is.
        let snaps = vec![
            reading("2026-07-01T08:00:00Z", "25.5.1", 32, "2560x1440@165", "26100", "Balanced"),
            reading("2026-07-02T08:00:00Z", "25.6.1", 64, "3840x2160@144", "26200", "High performance"),
        ];
        let asm = assemble_timeline(&empty_inputs(&[], &[], &snaps));
        let mut kinds: Vec<&str> = asm
            .events
            .iter()
            .filter(|e| e.scope == EventScope::Observed)
            .map(|e| e.event_type.as_str())
            .collect();
        kinds.sort_unstable();
        assert_eq!(
            kinds,
            vec!["gpu-driver-change", "hardware-change", "power-plan-change", "windows-build-change"],
            "one reading emits each observed kind at most once, GPU/RAM/display folded into one row"
        );
        assert_eq!(kinds.len(), OBSERVED_KINDS_PER_READING, "the declared per-reading maximum IS the scanner's");

        // A GPU swap on top of all that emits no MORE rows: the driver delta is the swap's story.
        let swapped = vec![
            snaps[0].clone(),
            IdentitySnapshot { gpu: "Radeon RX 9090 XT".into(), ..snaps[1].clone() },
        ];
        let asm = assemble_timeline(&empty_inputs(&[], &[], &swapped));
        let observed = asm.events.iter().filter(|e| e.scope == EventScope::Observed).count();
        assert!(
            observed < OBSERVED_KINDS_PER_READING,
            "a swap resets driver tracking instead of adding a row: {observed} observed"
        );
    }

    fn drift_inputs(notices: &[crate::drift::DriftNotice]) -> TimelineInputs<'_> {
        TimelineInputs {
            applied: &[],
            sessions: &[],
            gaming_slot: None,
            awards: &[],
            benchmark_baseline_at: None,
            comparison: None,
            snapshots: &[],
            drift_notices: notices,
        }
    }

    #[test]
    fn drift_notice_with_ready_bound_carries_the_observation_window() {
        let notices = vec![mk_notice(
            "power-profile",
            "Power profile",
            Some("2026-07-09T08:00:00Z"),
            "2026-07-11T08:00:00Z",
        )];
        let asm = assemble_timeline(&drift_inputs(&notices));
        assert_eq!(asm.events.len(), 1);
        let ev = &asm.events[0];
        assert_eq!(ev.event_type, "readiness-drift");
        assert_eq!(ev.scope, EventScope::Observed);
        // Dated by WHEN Compy noticed (the later bound), window from the last-ready stamp.
        assert_eq!(ev.timestamp, "2026-07-11T08:00:00Z");
        assert_eq!(
            ev.observed_between,
            Some(("2026-07-09T08:00:00Z".to_string(), "2026-07-11T08:00:00Z".to_string()))
        );
        assert!(ev.summary.contains("Power profile"));
        // Honest-copy rule: names WHAT and WHEN, never WHO.
        let d = ev.detail.as_deref().unwrap_or("");
        assert!(d.contains("not witnessed") || d.contains("not recorded"));
    }

    #[test]
    fn pre_phase2_drift_notice_is_point_dated_never_guessed() {
        // No last-ready stamp (state persisted before the field existed) → no window;
        // an unparseable stamp is treated the same, never passed through.
        for bound in [None, Some("last week")] {
            let notices = vec![mk_notice("vrr", "VRR", bound, "2026-07-11T08:00:00Z")];
            let asm = assemble_timeline(&drift_inputs(&notices));
            assert_eq!(asm.events.len(), 1);
            assert_eq!(asm.events[0].observed_between, None);
            assert_eq!(asm.events[0].timestamp, "2026-07-11T08:00:00Z");
        }
    }

    #[test]
    fn unparseable_drift_notice_is_dropped_never_guessed() {
        let notices = vec![mk_notice("vrr", "VRR", None, "sometime")];
        let asm = assemble_timeline(&drift_inputs(&notices));
        assert!(asm.events.is_empty());
        assert_eq!(asm.dropped_unparseable, 1);
    }

    #[test]
    fn observed_changes_carry_bounds_never_an_invented_time() {
        let snaps = vec![
            mk_snap("2026-07-08T09:00:00Z", "25.5.1", "26100", "Balanced"),
            mk_snap("2026-07-12T09:00:00Z", "25.6.0", "26100", "Balanced"),
        ];
        let asm = assemble_timeline(&empty_inputs(&[], &[], &snaps));
        let drv: Vec<&EventRecord> = asm
            .events
            .iter()
            .filter(|e| e.event_type == "gpu-driver-change")
            .collect();
        assert_eq!(drv.len(), 1);
        assert_eq!(drv[0].scope, EventScope::Observed);
        assert_eq!(
            drv[0].observed_between,
            Some((
                "2026-07-08T09:00:00Z".to_string(),
                "2026-07-12T09:00:00Z".to_string()
            ))
        );
        // Stamped at the LATER bound (when Compy found out), never in between.
        assert_eq!(drv[0].timestamp, "2026-07-12T09:00:00Z");
    }

    #[test]
    fn probe_failure_never_fabricates_a_change_event() {
        // Power plan reads "", then recovers — that is missing data, not two changes.
        let snaps = vec![
            mk_snap("2026-07-08T09:00:00Z", "25.5.1", "26100", "Balanced"),
            mk_snap("2026-07-09T09:00:00Z", "25.5.1", "26100", ""),
            mk_snap("2026-07-10T09:00:00Z", "25.5.1", "26100", "Balanced"),
        ];
        let mut store = IntelligenceStore::default();
        // The middle snapshot adds no information → not even appended.
        assert!(append_if_changed(&mut store, snaps[0].clone()));
        assert!(!append_if_changed(&mut store, snaps[1].clone()));
        // And even if such snapshots exist on disk, the scan emits no power-plan event.
        let asm = assemble_timeline(&empty_inputs(&[], &[], &snaps));
        assert!(
            asm.events.iter().all(|e| e.event_type != "power-plan-change"),
            "a failed probe must never read as a change"
        );
    }

    #[test]
    fn same_change_seen_by_both_streams_dedups_to_the_tighter_window() {
        // Identity snapshots saw the driver change across 4 days; session fingerprints
        // saw the same 25.5.1→25.6.0 change across 2 days — one event, tighter bounds.
        let snaps = vec![
            mk_snap("2026-07-08T09:00:00Z", "25.5.1", "26100", "Balanced"),
            mk_snap("2026-07-12T09:00:00Z", "25.6.0", "26100", "Balanced"),
        ];
        let mut s0 = mk_session("2026-07-09T10:00:00Z", "cp2077.exe", 82.0, 121.0);
        s0.hw_fingerprint = Some(mk_fp("25.5.1"));
        let mut s1 = mk_session("2026-07-11T10:00:00Z", "cp2077.exe", 80.0, 120.0);
        s1.hw_fingerprint = Some(mk_fp("25.6.0"));
        let sessions = vec![s0, s1];
        let asm = assemble_timeline(&empty_inputs(&[], &sessions, &snaps));
        let drv: Vec<&EventRecord> = asm
            .events
            .iter()
            .filter(|e| e.event_type == "gpu-driver-change")
            .collect();
        assert_eq!(drv.len(), 1, "one real change → one event");
        assert_eq!(drv[0].source, "rig-fingerprint");
        assert_eq!(
            drv[0].observed_between,
            Some((
                "2026-07-09T10:00:00Z".to_string(),
                "2026-07-11T10:00:00Z".to_string()
            ))
        );
    }

    #[test]
    fn unparseable_timestamps_are_dropped_and_counted_never_guessed() {
        let applied = vec![mk_change("c1", "HAGS on", "not-a-timestamp", "applied")];
        let asm = assemble_timeline(&empty_inputs(&applied, &[], &[]));
        assert!(asm.events.is_empty());
        assert_eq!(asm.dropped_unparseable, 1);
    }

    #[test]
    fn external_changes_are_never_presented_as_compy_applied() {
        let snaps = vec![
            mk_snap("2026-07-08T09:00:00Z", "25.5.1", "26100", "Balanced"),
            mk_snap("2026-07-12T09:00:00Z", "25.6.0", "26200", "High performance"),
        ];
        let applied = vec![mk_change("c1", "HAGS on", "2026-07-10T10:00:00Z", "applied")];
        let asm = assemble_timeline(&empty_inputs(&applied, &[], &snaps));
        for ev in &asm.events {
            match ev.event_type.as_str() {
                "gpu-driver-change" | "windows-build-change" | "power-plan-change"
                | "hardware-change" => {
                    assert_eq!(ev.scope, EventScope::Observed, "{}", ev.id);
                }
                "change-applied" => assert_eq!(ev.scope, EventScope::CompyApplied),
                _ => {}
            }
        }
    }

    // ── Store guards ──

    #[test]
    fn corrupt_store_fails_safe_and_preserves_the_bytes() {
        let dir = std::env::temp_dir().join(format!("compy-intel-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("intelligence.json");
        std::fs::write(&path, "{ this is not json").unwrap();
        let store = load_store_from(&path);
        assert!(store.identity_snapshots.is_empty(), "corrupt → fresh default");
        let corrupt = path.with_extension("json.corrupt");
        assert!(corrupt.exists(), "damaged bytes must be preserved, never destroyed");
        assert_eq!(std::fs::read_to_string(&corrupt).unwrap(), "{ this is not json");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_roundtrip_and_append_only_on_change() {
        let dir = std::env::temp_dir().join(format!("compy-intel-rt-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("intelligence.json");
        let mut store = IntelligenceStore::default();
        let s0 = mk_snap("2026-07-08T09:00:00Z", "25.5.1", "26100", "Balanced");
        assert!(append_if_changed(&mut store, s0.clone()), "first run establishes baseline");
        // Same identity, later observed_at → NOT appended (observed_at alone is not a change).
        let mut s1 = s0.clone();
        s1.observed_at = "2026-07-09T09:00:00Z".into();
        assert!(!append_if_changed(&mut store, s1));
        // A real change appends.
        let mut s2 = s0.clone();
        s2.observed_at = "2026-07-10T09:00:00Z".into();
        s2.gpu_driver = "25.6.0".into();
        assert!(append_if_changed(&mut store, s2));
        assert_eq!(store.identity_snapshots.len(), 2);
        save_store_to(&path, &store).unwrap();
        let loaded = load_store_from(&path);
        assert_eq!(loaded.identity_snapshots, store.identity_snapshots);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── Engine guards ──

    fn two_sessions(low_b: f64, low_c: f64) -> (SessionSummary, SessionSummary) {
        (
            mk_session("2026-07-10T10:00:00Z", "cp2077.exe", low_b, low_b * 1.4),
            mk_session("2026-07-12T10:00:00Z", "cp2077.exe", low_c, low_c * 1.4),
        )
    }

    #[test]
    fn an_average_the_sampler_could_not_take_is_never_an_observation() {
        let (mut b, c) = two_sessions(100.0, 100.0);
        b.avg_fps = 0.0; // the sampler's unknown
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.observations.len(), 1, "only the 1% low was measured on both sides");
        assert_eq!(r.observations[0].metric, "1% low FPS");
        assert!(
            r.evidence_graph.nodes.iter().all(|n| !n.label.starts_with("average FPS")),
            "no '0 → 140 (+0.0%)' evidence node"
        );
        // Both averages read: the reference row is back, with its real delta.
        let (b2, c2) = two_sessions(100.0, 110.0);
        let r2 = report(&WhatChangedInputs {
            baseline: &b2,
            current: &c2,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let avg = r2.observations.iter().find(|o| o.metric == "average FPS").expect("avg row");
        assert!(avg.reference_only);
        assert!((avg.delta_pct - 10.0).abs() < 0.05);
    }

    #[test]
    fn identical_sessions_get_no_invented_cause() {
        let (b, c) = two_sessions(100.0, 100.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "no-change");
        assert!(r.headline.contains("No meaningful difference"));
        assert!(r.leading_hypotheses.is_empty(), "no fake cause for no delta");
        assert!(r.ruled_out.is_empty());
    }

    #[test]
    fn noise_floor_boundary_is_inclusive_no_change() {
        // Exactly -3.0% on the 3% floor → no-change (mirrors comparison.rs's pin).
        let (b, c) = two_sessions(100.0, 97.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "no-change");
        // And just past it is meaningful.
        let (b2, c2) = two_sessions(100.0, 96.9);
        let r2 = report(&WhatChangedInputs {
            baseline: &b2,
            current: &c2,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r2.verdict, "regressed");
    }

    #[test]
    fn driver_change_with_sole_direct_evidence_ranks_high() {
        let (mut b, mut c) = two_sessions(100.0, 88.0); // -12% ≥ 2×floor
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "regressed");
        assert!(!r.confounded);
        let leader = r.leading_hypotheses.first().expect("has a leader");
        assert_eq!(leader.id, "gpu-driver-change");
        assert_eq!(leader.confidence, Confidence::High);
        // self-review 2026-10-28 (P7-confidence): the headline names the likely cause in prose and
        // leaves the confidence word to the hypothesis, where the UI glosses it.
        assert!(r.headline.contains(&format!("Most likely: {}.", leader.title)), "{}", r.headline);
        assert!(!r.headline.contains("confidence"), "raw confidence word in headline: {}", r.headline);
        assert!(leader.supporting_evidence[0].contains("25.5.1"));
        // Recorded facts rule OUT what matched: gaming mode + hardware + compy config.
        let ruled: Vec<&str> = r.ruled_out.iter().map(|h| h.id.as_str()).collect();
        assert!(ruled.contains(&"gaming-mode-difference"));
        assert!(ruled.contains(&"hardware-change"));
        assert!(ruled.contains(&"compy-config-change"));
        // Correlation, never causation.
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.to_lowercase().contains("caused by"));
        assert!(r.next_action.is_some());
    }

    #[test]
    fn multiple_simultaneous_changes_refuse_attribution() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        c.compy_changes_active = Some(1);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![apply_event("2026-07-11T10:00:00Z", "HAGS on")],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(r.confounded, "driver change + Compy apply = confounded");
        assert!(r.headline.contains("no single cause"));
        for h in &r.leading_hypotheses {
            if CHANGE_FAMILY.contains(&h.id.as_str()) {
                assert_eq!(
                    h.confidence,
                    Confidence::Low,
                    "{} must be capped Low under confounding",
                    h.id
                );
            }
        }
        assert!(r.next_action.as_deref().unwrap_or("").contains("one thing at a time"));
    }

    fn rollback_event(ts: &str, title: &str) -> EventRecord {
        EventRecord {
            id: format!("rollback:{ts}"),
            timestamp: ts.into(),
            event_type: "change-rolled-back".into(),
            source: "trust-ledger".into(),
            scope: EventScope::CompyApplied,
            game: None,
            summary: format!("{title} rolled back"),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
            parts: None,
        }
    }

    fn applied_event(ts: &str, title: &str, rec_id: &str, rolled_back: bool) -> EventRecord {
        EventRecord {
            id: format!("applied:{ts}"),
            timestamp: ts.into(),
            event_type: "change-applied".into(),
            source: "trust-ledger".into(),
            scope: EventScope::CompyApplied,
            game: None,
            summary: format!("{title} applied"),
            detail: None,
            observed_between: None,
            since_rolled_back: rolled_back,
            rec_id: Some(rec_id.into()),
            parts: None,
        }
    }

    /// The whole contract of `next_test_rec_id`: it is COPIED off a Trust-Ledger row or it is
    /// `None`. Nothing anywhere parses `summary`, matches a title, or maps the prose sentence
    /// onto the catalog — that would be fabrication, and it is the reason this feature sat
    /// deferred. Every `None` case below is a case where naming an id would require a guess.
    #[test]
    fn next_test_rec_id_is_read_from_the_ledger_never_matched_from_prose() {
        let base = || {
            let (mut b, mut c) = two_sessions(100.0, 88.0);
            b.hw_fingerprint = Some(mk_fp("25.5.1"));
            c.hw_fingerprint = Some(mk_fp("25.5.1"));
            b.gaming_mode_active = Some(false);
            c.gaming_mode_active = Some(false);
            (b, c)
        };
        let run = |b: &SessionSummary, c: &SessionSummary, ev: Vec<EventRecord>| {
            report(&WhatChangedInputs {
                baseline: b,
                current: c,
                events_window: ev,
                events_ambiguous: vec![],
                snapshots: &[],
            })
        };

        // 1. ONE rec, still applied → the id is named, and it is verbatim the ledger's.
        let (b, c) = base();
        let r = run(
            &b,
            &c,
            vec![applied_event("2026-07-11T10:00:00Z", "HAGS on", "gpu-hags", false)],
        );
        let leader = r.leading_hypotheses.first().expect("has a leader");
        assert_eq!(leader.id, "compy-config-change");
        assert_eq!(leader.next_test_rec_id.as_deref(), Some("gpu-hags"));
        assert_eq!(r.next_action_rec_id.as_deref(), Some("gpu-hags"));
        assert!(leader.next_test.is_some(), "the id rides WITH the sentence, never alone");

        // 2. TWO distinct recs → `None`. The sentence says "the change", singular; choosing
        //    one of two would be fabrication-by-selection.
        let (b, c) = base();
        let r = run(
            &b,
            &c,
            vec![
                applied_event("2026-07-11T10:00:00Z", "HAGS on", "gpu-hags", false),
                applied_event("2026-07-11T11:00:00Z", "Power plan", "power-plan", false),
            ],
        );
        assert_eq!(r.next_action_rec_id, None);

        // 3. The one rec has since been rolled back → `None`. You cannot undo what is
        //    already undone; offering the affordance would be a dead button.
        let (b, c) = base();
        let r = run(
            &b,
            &c,
            vec![applied_event("2026-07-11T10:00:00Z", "HAGS on", "gpu-hags", true)],
        );
        assert_eq!(r.next_action_rec_id, None);

        // 4. A rollback event alone → `None`. A rollback is not a thing to roll back.
        let (b, c) = base();
        let mut only_rollback = rollback_event("2026-07-11T10:00:00Z", "HAGS on");
        only_rollback.rec_id = Some("gpu-hags".into());
        let r = run(&b, &c, vec![only_rollback]);
        assert!(r.next_action.is_some(), "the prose still stands");
        assert_eq!(r.next_action_rec_id, None);

        // 5. Support came only from the active-change COUNT delta, which carries no ids at
        //    all (that is exactly why it exists — undated legacy rollbacks). Sentence yes,
        //    id no.
        let (mut b, mut c) = base();
        b.compy_changes_active = Some(3);
        c.compy_changes_active = Some(1);
        let r = run(&b, &c, vec![]);
        let leader = r.leading_hypotheses.first().expect("has a leader");
        assert_eq!(leader.id, "compy-config-change");
        assert!(leader.next_test.is_some());
        assert_eq!(r.next_action_rec_id, None);

        // 6. No OTHER hypothesis may ever emit an id — none of them has a rec behind it.
        //    Sweep every hypothesis this engine can produce across the fixtures above.
        let (drift_b, drift_c) = base();
        let (mut drv_b, mut drv_c) = base();
        drv_b.hw_fingerprint = Some(mk_fp("25.5.1"));
        drv_c.hw_fingerprint = Some(mk_fp("25.6.2"));
        let (gm_b, mut gm_c) = base();
        gm_c.gaming_mode_active = Some(true);
        let (plain_b, plain_c) = base();
        for (b, c, ev) in [
            (&drift_b, &drift_c, vec![drift_event("2026-07-11T10:00:00Z", "Game Mode")]),
            (&drv_b, &drv_c, vec![]),
            (&gm_b, &gm_c, vec![]),
            (&plain_b, &plain_c, vec![]),
        ] {
            let r = run(b, c, ev);
            for h in r.leading_hypotheses.iter().chain(r.ruled_out.iter()) {
                assert!(
                    h.id == "compy-config-change" || h.next_test_rec_id.is_none(),
                    "{} must never name a rec — it has none to read",
                    h.id
                );
            }
            assert_eq!(r.next_action_rec_id, None, "no ledger apply in this window");
        }
    }

    fn drift_event(ts: &str, label: &str) -> EventRecord {
        EventRecord {
            id: format!("drift:{ts}"),
            timestamp: ts.into(),
            event_type: "readiness-drift".into(),
            source: "drift-watch".into(),
            scope: EventScope::Observed,
            game: None,
            // THE SAME COMPOSER production uses -- a test helper with its own copy of the
            // sentence is how a copy bug passes its own suite.
            summary: drift_summary(label),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
            parts: None,
        }
    }

    #[test]
    fn drift_summary_never_makes_the_label_a_subject() {
        // bug -> guard (self-review 2026-08-23). The defect was not one bad label; it was a
        // TEMPLATE that assumed every readiness label is a noun phrase. Several are complete
        // clauses on purpose -- a check that has already found something says so in its own name
        // -- and each of those turned into a run-on the moment a predicate was appended.
        //
        // The invariant is structural, not a spelling: the label must TERMINATE the sentence, so
        // there is no position for a predicate to be appended in. That holds for any label anyone
        // writes later, which a pinned string would not.
        for label in [
            "Monitor refresh rate",                 // noun phrase
            "Compy changes were turned back off",   // readiness.rs:856 -- the one that shipped broken
            "Memory below its rated speed",         // ...and it was never alone
            "Monitor below max refresh",
            "Memory running single-channel",
        ] {
            let summary = drift_event("2026-08-23T00:00:00Z", label).summary;
            assert!(
                summary.ends_with(label),
                "the label must end the sentence, or a predicate can follow it: {summary:?}"
            );
            assert!(
                !summary.contains(&format!("{label} ")),
                "nothing may follow the label: {summary:?}"
            );
        }
    }

    #[test]
    fn stamped_rollback_in_window_supports_compy_config_change() {
        let (mut b, mut c) = two_sessions(100.0, 88.0); // -12% ≥ 2×floor
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.5.1"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![rollback_event("2026-07-11T10:00:00Z", "HAGS on")],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(!r.confounded);
        let leader = r.leading_hypotheses.first().expect("has a leader");
        assert_eq!(leader.id, "compy-config-change");
        assert_eq!(leader.confidence, Confidence::High);
        assert!(leader.supporting_evidence[0].contains("rolled back"));
    }

    #[test]
    fn drift_in_window_raises_setting_drift_capped_at_medium() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.5.1"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![drift_event("2026-07-11T10:00:00Z", "Power profile")],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(!r.confounded);
        let leader = r.leading_hypotheses.first().expect("has a leader");
        assert_eq!(leader.id, "setting-drift");
        // Notice-dated and silent about who changed it — never eligible for High.
        assert_eq!(leader.confidence, Confidence::Medium);
        assert!(leader.supporting_evidence[0].contains("Power profile"));
        assert!(leader
            .next_test
            .as_deref()
            .unwrap_or("")
            .contains("Restore the drifted setting"));
    }

    #[test]
    fn drift_never_joins_the_change_family_confound() {
        // A drift notice and a ledger event can describe the SAME underlying change —
        // drift must not double-count into a false "no single cause" refusal.
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.5.1"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        c.compy_changes_active = Some(1);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![
                apply_event("2026-07-11T10:00:00Z", "HAGS on"),
                drift_event("2026-07-11T11:00:00Z", "Power profile"),
            ],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(!r.confounded, "one family member + a drift is NOT a confound");
        let ids: Vec<(&str, &Confidence)> = r
            .leading_hypotheses
            .iter()
            .map(|h| (h.id.as_str(), &h.confidence))
            .collect();
        assert!(ids.contains(&("compy-config-change", &Confidence::High)));
        assert!(ids.contains(&("setting-drift", &Confidence::Medium)));
    }

    #[test]
    fn quiet_drift_lane_contributes_nothing() {
        // Drift scans are opportunistic: a window with no notice neither supports nor
        // rules out — the hypothesis must not appear at all.
        let (b, c) = two_sessions(100.0, 88.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(r.leading_hypotheses.iter().all(|h| h.id != "setting-drift"));
        assert!(r.ruled_out.iter().all(|h| h.id != "setting-drift"));
    }

    #[test]
    fn contradicted_hypotheses_are_ruled_out_with_the_evidence() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.5.1")); // same driver
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let drv = r
            .ruled_out
            .iter()
            .find(|h| h.id == "gpu-driver-change")
            .expect("same driver on both sessions rules the driver out");
        assert!(drv.contradicting_evidence[0].contains("same GPU driver"));
        assert!(drv.supporting_evidence.is_empty());
    }

    #[test]
    fn an_unreadable_ledger_never_clears_compy_of_a_regression() {
        // The whole reason `LedgerHealth` exists. `compy-config-change` is the ONE hypothesis
        // allowed to read SILENCE as contradicting evidence, and it earns that from a premise:
        // the Trust Ledger is a complete record of what Compy itself did. A ledger that won't
        // load — or one whose damaged predecessor was quarantined, after which every load reads
        // empty forever — looks exactly like a quiet machine. Compy must never clear ITSELF of a
        // regression using a record it could not read.
        let (b, c) = two_sessions(100.0, 82.0); // a real regression, needing a cause
        let inp = WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        };

        // Known-good ledger: silence IS evidence, and eliminating the hypothesis is correct.
        // Pinned so the fix below can only narrow the claim, never delete it.
        let whole = what_changed(&inp, LedgerHealth::Complete);
        assert!(
            whole
                .ruled_out
                .iter()
                .any(|h| h.id == "compy-config-change"),
            "a whole, quiet ledger still rules Compy out — that behaviour must survive"
        );

        // Identical inputs, unreadable ledger: the hypothesis has to stay open.
        let r = what_changed(&inp, LedgerHealth::Incomplete);
        assert!(
            !r.ruled_out.iter().any(|h| h.id == "compy-config-change"),
            "an unreadable ledger cleared Compy of the regression; ruled out: {:?}",
            r.ruled_out.iter().map(|h| h.id.as_str()).collect::<Vec<_>>()
        );
        assert!(
            !format!("{r:?}").contains("No Compy changes were applied"),
            "the report asserts as fact something the ledger could not tell it"
        );
        // Staying open is not enough — a silently dropped hypothesis reads as "nothing to see".
        // The gap itself has to reach the reader.
        assert!(
            r.unknowns.iter().any(|u| u.contains("couldn't be read")),
            "the unreadable ledger was never disclosed; unknowns: {:?}",
            r.unknowns
        );
    }

    // #669: a session that recorded no active-change count (its start couldn't read the change
    // history) can't vouch for a match — the hypothesis stays open as an unknown, never ruled out, and
    // no count delta is invented against it, whichever side is unrecorded.
    #[test]
    fn an_unrecorded_change_count_never_clears_or_blames_compy() {
        let (b, c) = two_sessions(100.0, 82.0);
        for (b, c) in [
            (b.clone(), SessionSummary { compy_changes_active: None, ..c.clone() }),
            (SessionSummary { compy_changes_active: None, ..b }, c),
        ] {
            let inp = WhatChangedInputs {
                baseline: &b,
                current: &c,
                events_window: vec![],
                events_ambiguous: vec![],
                snapshots: &[],
            };
            let r = what_changed(&inp, LedgerHealth::Complete);
            assert!(
                !r.ruled_out.iter().any(|h| h.id == "compy-config-change"),
                "an unrecorded count cleared Compy; ruled out: {:?}",
                r.ruled_out.iter().map(|h| h.id.as_str()).collect::<Vec<_>>()
            );
            let dump = format!("{r:?}");
            assert!(!dump.contains("count matches"), "a match was asserted from a count never recorded");
            assert!(!dump.contains("Active Compy changes:"), "a count delta was invented");
            assert!(
                r.unknowns.iter().any(|u| u.contains("didn't record how many Compy changes were active")),
                "the gap never reached the reader; unknowns: {:?}",
                r.unknowns
            );
        }
    }

    // 453-f1 review: counts are compared made the same way. Per change, a can't-confirm count that
    // moved is a delta even with the active count equal; a session an older Compy recorded is
    // compared on the older rule's count, which this build records too.
    #[test]
    fn change_counts_are_compared_like_with_like() {
        let (b, c) = two_sessions(100.0, 82.0);
        let run = |b: &SessionSummary, c: &SessionSummary| {
            let inp = WhatChangedInputs {
                baseline: b,
                current: c,
                events_window: vec![],
                events_ambiguous: vec![],
                snapshots: &[],
            };
            format!("{:?}", what_changed(&inp, LedgerHealth::Complete))
        };
        let moved_cant = SessionSummary { compy_changes_cant_confirm: Some(1), ..c.clone() };
        let dump = run(&b, &moved_cant);
        assert!(dump.contains("Active Compy changes: 0 during the baseline vs 0 (and 1 it can't confirm)"), "{dump}");
        assert!(!dump.contains("count matches"), "{dump}");

        let old_b = SessionSummary { compy_changes_per_change: false, compy_changes_cant_confirm: None, ..b.clone() };
        let dump = run(&old_b, &SessionSummary { compy_changes_legacy_active: Some(0), ..c.clone() });
        assert!(dump.contains("count matches (0)"), "{dump}");
        let dump = run(&old_b, &SessionSummary { compy_changes_legacy_active: Some(2), ..c.clone() });
        assert!(dump.contains("Active Compy changes: 0 during the baseline vs 2"), "{dump}");
        // No older-rule count on the newer session: nothing to compare, the gap is named.
        let dump = run(&old_b, &c);
        assert!(!dump.contains("count matches") && dump.contains("didn't record how many Compy changes"), "{dump}");
    }

    #[test]
    fn unknown_stays_unknown_and_insufficient_evidence_leads() {
        // No fingerprints, no gaming-mode stamps, no snapshots: everything unknowable
        // stays in `unknowns`; the only leader is honest insufficient-evidence at Low.
        let (b, c) = two_sessions(100.0, 88.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.leading_hypotheses.len(), 1);
        assert_eq!(r.leading_hypotheses[0].id, "insufficient-evidence");
        assert_eq!(r.leading_hypotheses[0].confidence, Confidence::Low);
        assert!(r.headline.contains("cause unknown"));
        assert!(
            r.unknowns.iter().any(|u| u.contains("driver")),
            "driver unknowability is stated"
        );
        assert!(r.unknowns.iter().any(|u| u.contains("Gaming Mode")));
        assert!(r.unknowns.iter().any(|u| u.contains("Windows build")));
    }

    #[test]
    fn insufficient_samples_is_honestly_inconclusive() {
        let (mut b, c) = two_sessions(100.0, 80.0);
        b.samples = 30;
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "inconclusive");
        assert!(r.headline.contains("Not enough data"));
        assert!(r.leading_hypotheses.is_empty());
    }

    #[test]
    fn zero_baseline_low_is_inconclusive_not_a_divide() {
        let (mut b, c) = two_sessions(0.0, 80.0);
        b.low1_fps_est = 0.0;
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "inconclusive");
    }

    #[test]
    fn different_rig_is_inconclusive_not_compared() {
        let (mut b, mut c) = two_sessions(100.0, 80.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        let mut other = mk_fp("25.5.1");
        other.gpu = "GeForce RTX 4070".into();
        c.hw_fingerprint = Some(other);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "inconclusive");
        assert!(r.headline.contains("different hardware"));
        // Not-comparable ⇒ NO asserted cause. The comparability banner owns the "why" (its
        // reasons + changed_context carry the GPU change honestly); this report must not push a
        // "hardware-change" hypothesis, which would triple-state the same fact and assert a cause
        // for a delta it never measured (this gate fires before any FPS delta is computed).
        assert!(
            r.leading_hypotheses.is_empty(),
            "a not-comparable (different-rig) report must not assert a most-likely cause",
        );
        // ...and the honest comparability verdict is what carries the hardware break.
        assert_eq!(
            r.comparability.verdict,
            crate::comparability::Comparability::NotComparable,
        );
    }

    #[test]
    fn stale_gap_caps_high_at_medium_with_a_note() {
        let mut b = mk_session("2026-06-10T10:00:00Z", "cp2077.exe", 100.0, 140.0);
        let mut c = mk_session("2026-07-12T10:00:00Z", "cp2077.exe", 88.0, 123.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let leader = r.leading_hypotheses.first().unwrap();
        assert_eq!(leader.id, "gpu-driver-change");
        assert_eq!(leader.confidence, Confidence::Medium, "32-day gap: High is off the table");
        assert!(r.notes.iter().any(|n| n.contains("stale")));
    }

    #[test]
    fn environment_pressure_is_direction_aware() {
        // RAM pressure in the WORSE session supports; in the BETTER session it contradicts.
        let (mut b, mut c) = two_sessions(100.0, 88.0); // current worse
        b.peak_ram_used_bytes = Some(20_000_000_000);
        b.ram_total_bytes = Some(32_000_000_000); // 62%
        c.peak_ram_used_bytes = Some(30_500_000_000);
        c.ram_total_bytes = Some(32_000_000_000); // 95%
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let mem = r
            .leading_hypotheses
            .iter()
            .find(|h| h.id == "memory-pressure")
            .expect("pressure in the worse session supports the hypothesis");
        assert_eq!(mem.confidence, Confidence::Medium);
        // Flip: pressure in the BETTER session → ruled out.
        let (mut b2, mut c2) = two_sessions(100.0, 88.0);
        b2.peak_ram_used_bytes = Some(30_500_000_000);
        b2.ram_total_bytes = Some(32_000_000_000); // better session, 95%
        c2.peak_ram_used_bytes = Some(20_000_000_000);
        c2.ram_total_bytes = Some(32_000_000_000);
        let r2 = report(&WhatChangedInputs {
            baseline: &b2,
            current: &c2,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(r2.ruled_out.iter().any(|h| h.id == "memory-pressure"));
    }

    #[test]
    fn thermal_evidence_supports_only_when_the_hotter_session_is_the_worse_one() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.peak_gpu_temp_c = Some(70);
        c.peak_gpu_temp_c = Some(91); // hotter AND worse
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(r.leading_hypotheses.iter().any(|h| h.id == "thermal"));
    }

    #[test]
    fn confidence_is_bands_only_no_numeric_anywhere() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![apply_event("2026-07-11T10:00:00Z", "HAGS on")],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let v = serde_json::to_value(&r).unwrap();
        fn walk(v: &serde_json::Value, check: &mut impl FnMut(&str, &serde_json::Value)) {
            match v {
                serde_json::Value::Object(m) => {
                    for (k, vv) in m {
                        check(k, vv);
                        walk(vv, check);
                    }
                }
                serde_json::Value::Array(a) => {
                    for vv in a {
                        walk(vv, check);
                    }
                }
                _ => {}
            }
        }
        let bands = ["unknown", "low", "medium", "high"];
        walk(&v, &mut |k, vv| {
            if k == "confidence" {
                let s = vv.as_str().expect("confidence must be a band string, never a number");
                assert!(bands.contains(&s), "unexpected band {s}");
            }
            assert!(
                !k.contains("probability") && !k.contains("score"),
                "probability theater key: {k}"
            );
        });
    }

    #[test]
    fn ambiguous_observation_windows_surface_as_unknowns_not_evidence() {
        let (b, c) = two_sessions(100.0, 88.0);
        let ambiguous = EventRecord {
            id: "identity:x:windows-build-change".into(),
            timestamp: "2026-07-13T09:00:00Z".into(),
            event_type: "windows-build-change".into(),
            source: "identity-snapshot".into(),
            scope: EventScope::Observed,
            game: None,
            summary: "Windows updated: 26100.4061 → 26100.4202".into(),
            detail: None,
            observed_between: Some((
                "2026-07-09T09:00:00Z".into(), // before the baseline session
                "2026-07-13T09:00:00Z".into(), // after the current session
            )),
            since_rolled_back: false,
            rec_id: None,
            parts: None,
        };
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![ambiguous],
            snapshots: &[],
        });
        assert!(
            r.unknowns.iter().any(|u| u.contains("can't place it")),
            "ambiguous window is an unknown, not supporting evidence"
        );
        assert!(
            !r.leading_hypotheses.iter().any(|h| h.id == "windows-build-change"),
            "an un-placeable event must not support the hypothesis"
        );
    }

    #[test]
    fn window_split_excludes_measurements_and_respects_bounds() {
        let mk_ev = |id: &str, ts: &str, event_type: &str, scope: EventScope| EventRecord {
            id: id.into(),
            timestamp: ts.into(),
            event_type: event_type.into(),
            source: "test".into(),
            scope,
            game: None,
            summary: id.into(),
            detail: None,
            observed_between: None,
            since_rolled_back: false,
            rec_id: None,
            parts: None,
        };
        let all = vec![
            mk_ev("before", "2026-07-09T09:59:00Z", "change-applied", EventScope::CompyApplied),
            mk_ev("at-start", "2026-07-10T10:00:00Z", "change-applied", EventScope::CompyApplied),
            mk_ev("inside", "2026-07-11T10:00:00Z", "change-applied", EventScope::CompyApplied),
            mk_ev("at-end", "2026-07-12T10:00:00Z", "change-applied", EventScope::CompyApplied),
            mk_ev("after", "2026-07-12T10:01:00Z", "change-applied", EventScope::CompyApplied),
            mk_ev("measurement", "2026-07-11T11:00:00Z", "verified-win", EventScope::Measurement),
            mk_ev("session-ev", "2026-07-11T12:00:00Z", "session", EventScope::Measurement),
        ];
        let (inside, ambiguous) = split_window_events(
            &all,
            parse_utc("2026-07-10T10:00:00Z").unwrap(),
            parse_utc("2026-07-12T10:00:00Z").unwrap(),
        );
        let ids: Vec<&str> = inside.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["inside", "at-end"], "(start, end] — start excluded, end included");
        assert!(ambiguous.is_empty());
    }

    #[test]
    fn report_language_never_claims_causation_and_shows_no_ai_theater() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let json = serde_json::to_string(&r).unwrap().to_lowercase();
        for banned in ["caused by", "ai-powered", "optimization score"] {
            assert!(!json.contains(banned), "banned phrase in report: {banned}");
        }
        assert!(r.method_note.contains("1% low"));
    }

    #[test]
    fn what_changed_outcome_serializes_to_the_kind_tagged_shape_the_ts_union_pins() {
        // types.ts models WhatChangedOutcome as a discriminated union on `kind`:
        // {kind:"unavailable", reason} | ({kind:"report"} & WhatChangedReport) — the report's
        // fields sit BESIDE the tag, never nested under a key. Nothing else in-repo exercises
        // this wrapper's serialized shape, so pin it here (2026-07-17 review nit → guard).
        let u = WhatChangedOutcome::Unavailable { reason: "why".into() };
        let uj = serde_json::to_value(&u).unwrap();
        assert_eq!(uj["kind"], "unavailable");
        assert_eq!(uj["reason"], "why");

        let (b, c) = two_sessions(100.0, 101.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let rj = serde_json::to_value(WhatChangedOutcome::Report(Box::new(r))).unwrap();
        assert_eq!(rj["kind"], "report");
        for flattened in ["verdict", "headline", "baseline", "current", "leading_hypotheses"] {
            assert!(rj.get(flattened).is_some(), "`{flattened}` must sit beside `kind`, not nested");
        }
    }

    #[test]
    fn display_strings_carry_the_pretty_game_name_never_the_raw_shipping_binary() {
        // Bug→guard (self-review 2026-07-17): a live debrief showed "Palworld-Win64-Shipping.exe"
        // baked into every Rust-generated sentence while the surrounding UI showed "Palworld"
        // via src/surfaces/game-name.ts. Display strings prettify server-side (pretty_game_name
        // mirrors that file); session MATCHING stays on the raw process_name.
        assert_eq!(pretty_game_name("Palworld-Win64-Shipping.exe"), "Palworld");
        assert_eq!(pretty_game_name("Game_WinGDK_Shipping.exe"), "Game");
        assert_eq!(pretty_game_name("Diablo IV.exe"), "Diablo IV");
        assert_eq!(pretty_game_name("csgo"), "csgo"); // casing + suffix-free names untouched

        let b = mk_session("2026-07-08T20:00:00Z", "Palworld-Win64-Shipping.exe", 90.0, 126.0);
        let c = mk_session("2026-07-10T20:00:00Z", "Palworld-Win64-Shipping.exe", 101.0, 141.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.game, "Palworld");
        assert_eq!(r.baseline.game, "Palworld");
        assert!(r.headline.contains("previous Palworld session"), "{}", r.headline);
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("Win64"), "raw shipping binary leaked: {json}");

        // Timeline session rows prettify the same way (field AND summary sentence).
        let sessions = vec![b];
        let a = assemble_timeline(&empty_inputs(&[], &sessions, &[]));
        let row = a.events.iter().find(|e| e.event_type == "session").unwrap();
        assert_eq!(row.game.as_deref(), Some("Palworld"));
        assert!(row.summary.starts_with("Palworld session —"), "{}", row.summary);
    }

    // ── good-vs-bad investigation (§4D — what_changed_between) ──

    /// A `Gathered` carrying only recorded sessions; every other source empty. The
    /// good-vs-bad picker reads sessions + snapshots alone, so this is enough to exercise
    /// `what_changed_between_impl`'s selection logic honestly.
    fn gathered_with(sessions: Vec<SessionSummary>) -> Gathered {
        Gathered {
            applied: vec![],
            sessions,
            gaming_slot: None,
            awards: vec![],
            benchmark_baseline_at: None,
            comparison: None,
            snapshots: vec![],
            drift_notices: vec![],
            ledger_loaded: true,
            set_aside_through: Ok(None),
        }
    }

    fn unavailable_reason(out: &WhatChangedOutcome) -> &str {
        match out {
            WhatChangedOutcome::Unavailable { reason } => reason,
            WhatChangedOutcome::Report(_) => panic!("expected Unavailable, got a report"),
        }
    }

    #[test]
    fn explicit_pick_compares_the_two_chosen_sessions_not_the_adjacent_pair() {
        // Three same-game sessions; the user picks the first (good) and third (bad),
        // deliberately skipping the middle one the auto-picker (what_changed_for_session)
        // would have used. The explicit selection must be honored verbatim.
        let g = gathered_with(vec![
            mk_session("2026-07-01T10:00:00Z", "cp2077.exe", 100.0, 140.0),
            mk_session("2026-07-02T10:00:00Z", "cp2077.exe", 96.0, 138.0),
            mk_session("2026-07-03T10:00:00Z", "cp2077.exe", 80.0, 120.0),
        ]);
        let out =
            what_changed_between_impl(&g, "2026-07-01T10:00:00Z", "2026-07-03T10:00:00Z");
        let WhatChangedOutcome::Report(r) = out else {
            panic!("expected a report, got {out:?}");
        };
        assert_eq!(r.baseline.started_at, "2026-07-01T10:00:00Z");
        assert_eq!(r.current.started_at, "2026-07-03T10:00:00Z");
        // 100 → 80 in the 1% low is a clear regression, well past the 3% noise floor.
        assert_eq!(r.verdict, "regressed", "{}", r.headline);
    }

    /// P4-show-f1: a session behind another window the whole time is never a "what changed" side:
    /// the auto-pick skips it as the earlier session, it can't be investigated itself, the explicit
    /// pick refuses it, the headline reads past it, and the timeline row says nothing was measured.
    #[test]
    fn a_session_with_no_reading_is_never_compared() {
        let mut behind = mk_session("2026-07-02T10:00:00Z", "cp2077.exe", 0.0, 0.0);
        (behind.samples, behind.background_secs_excluded) = (0, Some(600));
        let g = gathered_with(vec![
            mk_session("2026-07-01T10:00:00Z", "cp2077.exe", 100.0, 140.0),
            behind.clone(),
            mk_session("2026-07-03T10:00:00Z", "cp2077.exe", 80.0, 120.0),
        ]);
        let WhatChangedOutcome::Report(r) = what_changed_impl(&g, "2026-07-03T10:00:00Z") else {
            panic!("expected a report against the last measured session");
        };
        assert_eq!(r.baseline.started_at, "2026-07-01T10:00:00Z", "skips the session with no reading");
        assert_eq!(r.verdict, "regressed", "{}", r.headline);
        let out = what_changed_impl(&g, "2026-07-02T10:00:00Z");
        assert!(unavailable_reason(&out).contains("another window was in front"), "{out:?}");
        let out = what_changed_between_impl(&g, "2026-07-01T10:00:00Z", "2026-07-02T10:00:00Z");
        assert!(unavailable_reason(&out).contains("another window was in front"), "{out:?}");
        let sessions = vec![behind];
        let a = assemble_timeline(&empty_inputs(&[], &sessions, &[]));
        let row = a.events.iter().find(|e| e.event_type == "session").unwrap();
        assert!(row.summary.contains("nothing measured") && !row.summary.contains("FPS"), "{}", row.summary);
    }

    #[test]
    fn same_session_picked_twice_is_refused() {
        let g = gathered_with(vec![
            mk_session("2026-07-01T10:00:00Z", "cp2077.exe", 100.0, 140.0),
            mk_session("2026-07-02T10:00:00Z", "cp2077.exe", 90.0, 130.0),
        ]);
        let out =
            what_changed_between_impl(&g, "2026-07-01T10:00:00Z", "2026-07-01T10:00:00Z");
        assert!(
            unavailable_reason(&out).contains("same session"),
            "{out:?}"
        );
    }

    #[test]
    fn different_games_are_refused_as_not_comparable() {
        let g = gathered_with(vec![
            mk_session("2026-07-01T10:00:00Z", "cp2077.exe", 100.0, 140.0),
            mk_session("2026-07-02T10:00:00Z", "valorant.exe", 240.0, 300.0),
        ]);
        let out =
            what_changed_between_impl(&g, "2026-07-01T10:00:00Z", "2026-07-02T10:00:00Z");
        assert!(
            unavailable_reason(&out).contains("different games"),
            "{out:?}"
        );
    }

    #[test]
    fn reverse_order_pick_is_refused_not_silently_flipped() {
        // Baseline picked as the LATER session — the engine reads time forward, so this
        // must be refused honestly rather than inverted behind the user's back.
        let g = gathered_with(vec![
            mk_session("2026-07-01T10:00:00Z", "cp2077.exe", 100.0, 140.0),
            mk_session("2026-07-03T10:00:00Z", "cp2077.exe", 80.0, 120.0),
        ]);
        let out =
            what_changed_between_impl(&g, "2026-07-03T10:00:00Z", "2026-07-01T10:00:00Z");
        assert!(
            unavailable_reason(&out).contains("baseline has to be the earlier session"),
            "{out:?}"
        );
    }

    #[test]
    fn a_pruned_session_pick_is_unavailable_not_a_guess() {
        let g = gathered_with(vec![mk_session(
            "2026-07-01T10:00:00Z",
            "cp2077.exe",
            100.0,
            140.0,
        )]);
        let out =
            what_changed_between_impl(&g, "2026-07-01T10:00:00Z", "2026-07-09T10:00:00Z");
        assert!(
            unavailable_reason(&out).contains("no longer in the history"),
            "{out:?}"
        );
    }

    #[test]
    fn an_unreadable_timestamp_pick_is_refused() {
        // Both sessions are found (exact string match) and same-game, but the baseline's
        // timestamp won't parse — refuse rather than guess at the order.
        let g = gathered_with(vec![
            mk_session("not-a-timestamp", "cp2077.exe", 100.0, 140.0),
            mk_session("2026-07-02T10:00:00Z", "cp2077.exe", 90.0, 130.0),
        ]);
        let out = what_changed_between_impl(&g, "not-a-timestamp", "2026-07-02T10:00:00Z");
        assert!(
            unavailable_reason(&out).contains("unreadable timestamp"),
            "{out:?}"
        );
    }

    // ── §4C evidence graph (Expert view) ──

    /// Same scenario twice ⇒ byte-identical graph, and nodes/edges come back in a stable
    /// sorted order (the Expert view is diffable and snapshot-testable). Every node cites
    /// the report field it came from — the graph invents no data, and asserts no causation.
    #[test]
    fn evidence_graph_is_deterministic_sorted_and_sourced() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let mk = || {
            report(&WhatChangedInputs {
                baseline: &b,
                current: &c,
                events_window: vec![apply_event("2026-07-11T12:00:00Z", "HAGS on")],
                events_ambiguous: vec![],
                snapshots: &[],
            })
            .evidence_graph
        };
        let g1 = mk();
        assert_eq!(
            serde_json::to_string(&g1).unwrap(),
            serde_json::to_string(&mk()).unwrap(),
            "same report must yield an identical graph"
        );
        let ids: Vec<&str> = g1.nodes.iter().map(|n| n.id.as_str()).collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        assert_eq!(ids, sorted, "nodes must be id-sorted");
        let keys: Vec<(String, String, &str)> = g1
            .edges
            .iter()
            .map(|e| (e.from.clone(), e.to.clone(), relation_key(e.relation)))
            .collect();
        let mut ksorted = keys.clone();
        ksorted.sort();
        assert_eq!(keys, ksorted, "edges must be (from,to,relation)-sorted");
        assert!(
            g1.nodes.iter().all(|n| !n.source_reference.is_empty()),
            "every node cites its origin"
        );
        let json = serde_json::to_string(&g1).unwrap().to_lowercase();
        assert!(!json.contains("caused by"), "correlation, never causation");
    }

    /// A measured change grows a symptom spine feeding the conclusion; a flat result keeps
    /// the conclusion but grows no symptom (nothing to explain).
    #[test]
    fn a_measured_change_emits_a_symptom_node_a_flat_one_does_not() {
        let (b, c) = two_sessions(100.0, 80.0);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(r.verdict, "regressed");
        let g = &r.evidence_graph;
        assert!(g
            .nodes
            .iter()
            .any(|n| n.id == "symptom" && n.node_type == EvidenceNodeType::Symptom));
        assert!(g.edges.iter().any(|e| e.from == "symptom"
            && e.to == "conclusion"
            && e.relation == EvidenceRelation::Supports));

        let (b2, c2) = two_sessions(100.0, 100.0);
        let flat = report(&WhatChangedInputs {
            baseline: &b2,
            current: &c2,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert_eq!(flat.verdict, "no-change");
        assert!(!flat.evidence_graph.nodes.iter().any(|n| n.id == "symptom"));
        assert!(flat
            .evidence_graph
            .nodes
            .iter()
            .any(|n| n.id == "conclusion" && n.node_type == EvidenceNodeType::Conclusion));
    }

    /// Discarded explanations are shown, not silently dropped (§0.12): each ruled-out
    /// hypothesis becomes a node linked ruled-out-by → conclusion, and a proposed test
    /// becomes an experiment node something requires-verification against.
    #[test]
    fn ruled_out_hypotheses_render_as_ruled_out_by_edges() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        assert!(!r.ruled_out.is_empty(), "this scenario rules some out");
        let g = &r.evidence_graph;
        for h in &r.ruled_out {
            let id = format!("ruled-out:{}", h.id);
            assert!(g.nodes.iter().any(|n| n.id == id), "missing node {id}");
            assert!(
                g.edges.iter().any(|e| e.from == id
                    && e.to == "conclusion"
                    && e.relation == EvidenceRelation::RuledOutBy),
                "missing ruled-out-by edge for {id}"
            );
        }
        assert!(r.next_action.is_some());
        assert!(g
            .nodes
            .iter()
            .any(|n| n.id == "experiment:next-test" && n.node_type == EvidenceNodeType::Experiment));
        assert!(g
            .edges
            .iter()
            .any(|e| e.relation == EvidenceRelation::RequiresVerification));
    }

    /// The node/edge vocabulary serializes to the kebab strings the Expert-view TS union
    /// pins, and reliability/weight are bands (strings), never numbers.
    #[test]
    fn graph_enums_serialize_to_the_kebab_strings_the_ts_union_pins() {
        let (mut b, mut c) = two_sessions(100.0, 88.0);
        b.hw_fingerprint = Some(mk_fp("25.5.1"));
        c.hw_fingerprint = Some(mk_fp("25.6.0"));
        b.gaming_mode_active = Some(false);
        c.gaming_mode_active = Some(false);
        let r = report(&WhatChangedInputs {
            baseline: &b,
            current: &c,
            events_window: vec![apply_event("2026-07-11T12:00:00Z", "HAGS on")],
            events_ambiguous: vec![],
            snapshots: &[],
        });
        let j = serde_json::to_value(&r.evidence_graph).unwrap();
        let node_types: std::collections::HashSet<String> = j["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["node_type"].as_str().unwrap().to_string())
            .collect();
        assert!(node_types.contains("conclusion"));
        assert!(node_types.contains("symptom"));
        assert!(node_types.contains("metric"));
        assert!(
            node_types.iter().all(|t| t == &t.to_lowercase()),
            "node types must be kebab/lowercase, never TitleCase: {node_types:?}"
        );
        let relations: std::collections::HashSet<String> = j["edges"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["relation"].as_str().unwrap().to_string())
            .collect();
        assert!(relations.contains("supports"));
        assert!(
            relations.iter().any(|rel| rel.contains('-')),
            "expected a kebab-case relation like occurred-before: {relations:?}"
        );
        for n in j["nodes"].as_array().unwrap() {
            assert!(n["reliability"].is_string(), "reliability is a band, not a number");
        }
        for e in j["edges"].as_array().unwrap() {
            assert!(e["weight"].is_string(), "weight is a band, not a number");
        }
    }

    // ── P6-changed: "Changed before this" anchored at an incident ──

    fn at(s: &str) -> DateTime<Utc> {
        parse_utc(s).expect("test timestamp parses")
    }

    fn cb(g: &Gathered, incident: &str, others: &[&str]) -> ChangedBeforeIncident {
        let asm = assemble_from(g);
        let others: Vec<DateTime<Utc>> = others.iter().map(|t| at(t)).collect();
        changed_before_incident_impl(g, &asm, incident, at(incident), &others, None)
    }

    fn cb_cat<'a>(r: &'a ChangedBeforeIncident, category: &str) -> &'a ChangedBeforeItem {
        r.items.iter().find(|i| i.category == category).unwrap_or_else(|| panic!("no {category} item"))
    }

    #[test]
    fn changed_before_the_owners_sidump_crash_reads_the_real_stores() {
        // Owner's real data (lane 453): the Care card "sidump stopped working and closed — Oct 24,
        // 4:18 AM". Fixture = read-only copies of sessions/history/intelligence/incident-observer.
        let fx: serde_json::Value =
            serde_json::from_str(include_str!("../../src/test/fixtures/incident-changed-before-453.json"))
                .expect("fixture parses");
        let incident = fx["incident"]["occurred_at"].as_str().unwrap().to_string();
        assert_eq!(fx["incident"]["summary"], "sidump stopped working and closed — Oct 24, 4:18 AM");
        let mut g = gathered_with(serde_json::from_value(fx["sessions"].clone()).expect("sessions"));
        g.applied = serde_json::from_value(fx["history"].clone()).expect("history");
        g.snapshots = serde_json::from_value(fx["identity_snapshots"].clone()).expect("snapshots");
        let others: Vec<String> = serde_json::from_value(fx["other_incident_times"].clone()).unwrap();
        let others: Vec<&str> = others.iter().map(String::as_str).collect();
        let r = cb(&g, &incident, &others);

        // Window: the last clean session before 4:18 AM PDT Oct 24 — the short WARDOGS run on Oct 23.
        assert_eq!(r.anchor_kind, "clean");
        let a = r.anchor.as_ref().expect("an anchor session");
        assert_eq!(a.started_at, "2026-10-23T16:06:22.472457100+00:00");
        assert_eq!(a.game, "WardogsClient");
        assert_eq!(r.window_end, incident);
        let cats: Vec<&str> = r.items.iter().map(|i| i.category.as_str()).collect();
        assert_eq!(cats, ["compy-changes", "driver", "windows-build", "power-plan", "hardware", "drift"]);

        // Compy: the visual-effects trim applied and rolled back at 16:08 sits inside the window.
        let compy = cb_cat(&r, "compy-changes");
        assert_eq!(compy.status, "changed");
        let kinds: Vec<&str> = compy.events.iter().map(|e| e.event_type.as_str()).collect();
        assert_eq!(kinds, ["change-applied", "change-rolled-back"]);
        assert!(compy.events.iter().all(|e| e.summary.contains("Trim Windows visual effects")));

        // Driver + hardware: read on the anchor session and again on the Oct 24 ledger apply — same.
        for c in ["driver", "hardware"] {
            let it = cb_cat(&r, c);
            assert_eq!(it.status, "no-change", "{c}");
            assert_eq!(
                it.checked_between,
                Some((
                    "2026-10-23T16:06:22.472457100+00:00".to_string(),
                    "2026-10-24T19:24:22.256501300+00:00".to_string()
                )),
                "{c}"
            );
        }
        // Windows build + power plan: only identity snapshots carry them, and none since Oct 23 07:03.
        for c in ["windows-build", "power-plan"] {
            let it = cb_cat(&r, c);
            assert_eq!(it.status, "unknown", "{c} must never read as no change");
            assert_eq!(it.unknown_reason.as_deref(), Some("no-reading-after"));
            assert_eq!(it.last_reading_at.as_deref(), Some("2026-10-23T14:03:14.523573500+00:00"));
        }
        let drift = cb_cat(&r, "drift");
        assert_eq!(drift.status, "unknown");
        assert_eq!(drift.unknown_reason.as_deref(), Some("drift-not-kept"));
    }

    #[test]
    fn changed_before_with_no_earlier_session_says_so_and_lists_nothing() {
        let g = gathered_with(vec![mk_session("2026-10-24T12:00:00Z", "Game.exe", 100.0, 120.0)]);
        let r = cb(&g, "2026-10-24T11:00:00Z", &[]);
        assert_eq!(r.anchor_kind, "none");
        assert!(r.anchor.is_none());
        assert!(r.items.is_empty(), "no window ⇒ no invented items");
        // A session with no reading is no anchor either (P4-show-f1).
        let mut s = mk_session("2026-10-24T09:00:00Z", "Game.exe", 0.0, 0.0);
        s.samples = 0;
        let r = cb(&gathered_with(vec![s]), "2026-10-24T11:00:00Z", &[]);
        assert_eq!(r.anchor_kind, "none");
    }

    #[test]
    fn changed_before_never_anchors_on_the_session_the_incident_happened_in() {
        // mk_session runs 600 s. The crash lands 60 s after the second one ends — inside Black
        // Box's 90 s grace, so that is the crash session, and the window starts at the first.
        let g = gathered_with(vec![
            mk_session("2026-10-24T08:00:00Z", "Game.exe", 100.0, 120.0),
            mk_session("2026-10-24T10:00:00Z", "Game.exe", 100.0, 120.0),
        ]);
        let r = cb(&g, "2026-10-24T10:11:00Z", &[]);
        assert_eq!(r.anchor.unwrap().started_at, "2026-10-24T08:00:00Z");
    }

    #[test]
    fn changed_before_prefers_a_clean_session_and_falls_back_to_the_last_measured() {
        let g = gathered_with(vec![
            mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0),
            mk_session("2026-10-22T10:00:00Z", "Game.exe", 100.0, 120.0),
        ]);
        // Another incident during the Oct 22 session: it isn't clean, so Oct 20 anchors.
        let r = cb(&g, "2026-10-24T10:00:00Z", &["2026-10-22T10:05:00Z"]);
        assert_eq!(r.anchor_kind, "clean");
        assert_eq!(r.anchor.as_ref().unwrap().started_at, "2026-10-20T10:00:00Z");
        // Every earlier session had one: the last measured session anchors, and says it isn't clean.
        let r = cb(&g, "2026-10-24T10:00:00Z", &["2026-10-22T10:05:00Z", "2026-10-20T10:05:00Z"]);
        assert_eq!(r.anchor_kind, "measured");
        assert_eq!(r.anchor.as_ref().unwrap().started_at, "2026-10-22T10:00:00Z");
    }

    // #618: Care's "since it last worked" and "What changed?" are bounded by when an earlier history
    // was set aside, against the window's own start: before it, silence is still evidence; at or after
    // it (or unknown), Compy can't rule itself out. The marker is permanent, so the old yes/no check
    // left every later incident on that PC unable to rule Compy out.
    #[test]
    fn a_history_set_aside_before_the_window_still_rules_compy_out() {
        let at = |s: &str| DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc);
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        assert_eq!(g.ledger_since("2026-10-20T10:00:00Z"), LedgerHealth::Complete, "nothing set aside");
        g.set_aside_through = Ok(Some(at("2026-10-19T08:00:00Z")));
        assert_eq!(g.ledger_since("2026-10-20T10:00:00Z"), LedgerHealth::Complete, "set aside before the window");
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(cb_cat(&r, "compy-changes").status, "no-change");
        g.set_aside_through = Ok(Some(at("2026-10-21T08:00:00Z")));
        assert_eq!(g.ledger_since("2026-10-20T10:00:00Z"), LedgerHealth::Incomplete, "set aside inside the window");
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(cb_cat(&r, "compy-changes").unknown_reason.as_deref(), Some("ledger-incomplete"));
        g.set_aside_through = Err("denied".into());
        assert_eq!(g.ledger_since("2026-10-20T10:00:00Z"), LedgerHealth::Incomplete, "unknown stays unknown");
        // A window start that can't be read is unknown too, once anything was set aside.
        g.set_aside_through = Ok(Some(at("2026-10-19T08:00:00Z")));
        for bad in ["", "not a time"] {
            assert_eq!(g.ledger_since(bad), LedgerHealth::Incomplete, "{bad:?}");
        }
        g.set_aside_through = Ok(None);
        g.ledger_loaded = false;
        assert_eq!(g.ledger_since("2026-10-20T10:00:00Z"), LedgerHealth::Incomplete, "a failed load covers nothing");
        // The window is the investigation's own: the marker is read once, after the load.
        let src = include_str!("intelligence.rs");
        let gather = &src[src.find("fn gather() -> Gathered {").unwrap()..];
        let gather = &gather[..gather.find("\n}\n").unwrap()];
        let load = gather.find("let loaded = crate::history::load_history();").unwrap();
        let marker = gather.find("let set_aside_through = crate::history::ledger_set_aside_through();").unwrap();
        assert!(load < marker, "the marker is read after the load");
        assert!(!src.contains(&["ledger_was", "_quarantined()"].concat()), "the unbounded marker is back");
    }

    #[test]
    fn changed_before_unknown_and_unreadable_evidence_is_never_no_change() {
        // No identity reading at all, an unreadable ledger, nothing in the window: every category
        // is unknown with a reason — not one of them may claim "no change".
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.ledger_loaded = false;
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(r.items.len(), 6);
        for it in &r.items {
            assert_eq!(it.status, "unknown", "{} claimed {}", it.category, it.status);
            assert!(it.unknown_reason.is_some(), "{} has no reason", it.category);
        }
        assert_eq!(cb_cat(&r, "compy-changes").unknown_reason.as_deref(), Some("ledger-incomplete"));
        assert_eq!(cb_cat(&r, "driver").unknown_reason.as_deref(), Some("no-reading-before"));

        // A blank probe field is not a reading: a snapshot that read no power plan leaves it unknown.
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.snapshots = vec![mk_snap("2026-10-19T10:00:00Z", "1", "26100", ""), mk_snap("2026-10-25T10:00:00Z", "1", "26100", "")];
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(cb_cat(&r, "power-plan").status, "unknown");
        assert_eq!(cb_cat(&r, "windows-build").status, "no-change");
        assert_eq!(cb_cat(&r, "compy-changes").status, "no-change", "a complete, quiet ledger is evidence");
    }

    #[test]
    fn changed_before_lists_observed_changes_and_refuses_to_place_a_straddling_one() {
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.snapshots = vec![
            // Read as the anchor session started, and again inside the window: a placed change.
            mk_snap("2026-10-20T10:00:00Z", "drv-1", "26100", "Balanced"),
            mk_snap("2026-10-22T10:00:00Z", "drv-2", "26100", "Balanced"),
            // Read again only after the incident, and the plan differs: when it changed is unknown.
            mk_snap("2026-10-26T10:00:00Z", "drv-2", "26100", "Ultimate Performance"),
        ];
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        let drv = cb_cat(&r, "driver");
        assert_eq!(drv.status, "changed");
        assert_eq!(drv.events[0].summary, "GPU driver changed: drv-1 → drv-2");
        let plan = cb_cat(&r, "power-plan");
        assert_eq!(plan.status, "unknown");
        assert_eq!(plan.unknown_reason.as_deref(), Some("cant-place"));
        assert_eq!(plan.events.len(), 1);
        assert_eq!(cb_cat(&r, "windows-build").status, "no-change");

        // A change whose window opens BEFORE the anchor session may predate it: never listed as
        // "changed before this", only as can't-place.
        g.snapshots[0].observed_at = "2026-10-19T10:00:00Z".into();
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(cb_cat(&r, "driver").status, "unknown");
        assert_eq!(cb_cat(&r, "driver").unknown_reason.as_deref(), Some("cant-place"));
    }

    #[test]
    fn changed_before_events_carry_their_facts_as_data_for_the_frontend_to_word() {
        // P6-changed-f1: zh-CN read Rust's English `summary` inside translated blocks. Each kind
        // the Care view lists now also carries its values as data, built beside the sentence.
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.applied = vec![mk_change("visual-effects", "Trim Windows visual effects", "2026-10-21T10:00:00Z", "applied")];
        g.snapshots = vec![
            mk_snap("2026-10-20T10:00:00Z", "drv-1", "26100", "Balanced"),
            mk_snap("2026-10-22T10:00:00Z", "drv-2", "26100", "Ultimate Performance"),
        ];
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        let wire = |cat: &str| serde_json::to_value(&cb_cat(&r, cat).events[0]).unwrap()["parts"].clone();
        assert_eq!(wire("driver"), serde_json::json!({ "kind": "gpu-driver", "from": "drv-1", "to": "drv-2" }));
        assert_eq!(
            wire("power-plan"),
            serde_json::json!({ "kind": "power-plan", "from": "Balanced", "to": "Ultimate Performance" })
        );
        assert_eq!(
            wire("compy-changes"),
            serde_json::json!({ "kind": "applied", "title": "Trim Windows visual effects" })
        );
        // The English sentence stays as the fallback for old data and unknown kinds.
        assert_eq!(cb_cat(&r, "driver").events[0].summary, "GPU driver changed: drv-1 → drv-2");

        // Sessions and hardware too (the "Since it last worked" list shows both).
        let asm = assemble_from(&g);
        let sess = asm.events.iter().find(|e| e.event_type == "session").unwrap();
        assert_eq!(
            serde_json::to_value(sess).unwrap()["parts"],
            serde_json::json!({ "kind": "session", "game": sess.game.clone().unwrap(), "duration_secs": 600, "fps": ["120", "100"] })
        );
    }

    // ── Golden fixture: summary ↔ parts (P6-changed-f1) ───────────────────
    //
    // `src/surfaces/event-text.test.tsx` loads this fixture and asserts the English `eventText`
    // equals `summary` for every entry, so the frontend's templates are checked against what the
    // REAL builders emit, not against strings a test author typed. This half pins that the fixture
    // is exactly what `assemble_timeline` produces today. To regenerate deliberately, run
    // `COMPY_PRINT_EVENT_PARTS_FIXTURE=1 cargo test --lib event_parts_fixture -- --nocapture` and
    // save the JSON printed between the markers.

    const EVENT_PARTS_FIXTURE: &str =
        concat!(env!("CARGO_MANIFEST_DIR"), "/../src/test/fixtures/timeline-event-parts.json");

    #[test]
    fn event_parts_fixture_matches_what_the_builders_emit() {
        let mut kept = mk_change("visual-effects", "Trim Windows visual effects", "2026-10-21T10:00:00Z", "applied");
        kept.rec_id = "visual-effects".into();
        let mut undone = mk_change("game-mode", "Turn on Game Mode", "2026-10-21T11:00:00Z", "rolled_back");
        undone.rolled_back_at = Some("2026-10-21T12:00:00Z".into());
        let applied = vec![kept, undone];
        // An avg and 1% low ending in .5: the rounding must be Rust's, on both sides.
        let measured = mk_session("2026-10-20T10:00:00Z", "EldenRing.exe", 99.5, 120.5);
        let mut unmeasured = mk_session("2026-10-22T10:00:00Z", "Palworld-Win64-Shipping.exe", 0.0, 0.0);
        unmeasured.samples = 0;
        unmeasured.duration_secs = 45;
        let sessions = vec![measured, unmeasured];
        let mut a = mk_snap("2026-10-19T10:00:00Z", "32.0.15.6094", "26100", "Balanced");
        let mut b = mk_snap("2026-10-23T10:00:00Z", "32.0.15.6614", "26100", "Ultimate Performance");
        b.windows_ubr = Some(4202);
        // Hardware: GPU unchanged (a GPU swap suppresses the driver event), RAM and display changed.
        a.ram_gb = 16;
        b.display = "3440x1440@144".into();
        let snapshots = vec![a, b];
        let drift = vec![crate::drift::DriftNotice {
            id: "game-mode".into(),
            label: "Game Mode".into(),
            last_ready_at: Some("2026-10-20T10:00:00Z".into()),
            noticed_at: "2026-10-22T12:00:00Z".into(),
        }];
        let mut inp = empty_inputs(&applied, &sessions, &snapshots);
        inp.drift_notices = &drift;
        inp.benchmark_baseline_at = Some("2026-10-24T10:00:00Z".into());
        let asm = assemble_timeline(&inp);

        let rows: Vec<serde_json::Value> = asm
            .events
            .iter()
            .filter(|e| e.parts.is_some())
            .map(|e| {
                serde_json::json!({
                    "event_type": e.event_type,
                    "summary": e.summary,
                    "since_rolled_back": e.since_rolled_back,
                    "parts": e.parts,
                })
            })
            .collect();
        let kinds: std::collections::BTreeSet<&str> =
            rows.iter().map(|r| r["parts"]["kind"].as_str().unwrap()).collect();
        assert_eq!(
            kinds.into_iter().collect::<Vec<_>>(),
            [
                "applied", "benchmark-baseline", "drift", "gpu-driver", "hardware", "power-plan",
                "rolled-back", "session", "windows-build"
            ],
            "every kind with parts is in the fixture"
        );
        assert!(rows.iter().any(|r| r["parts"]["kind"] == "applied" && r["since_rolled_back"] == true));
        assert!(rows.iter().any(|r| r["parts"]["kind"] == "applied" && r["since_rolled_back"] == false));
        assert!(rows.iter().any(|r| r["parts"]["kind"] == "session" && r["parts"]["fps"].is_null()));
        assert!(rows.iter().any(|r| r["summary"].as_str().unwrap().contains("120 avg FPS · 100 1% low")));

        let emitted = serde_json::to_string_pretty(&rows).expect("rows serialize") + "\n";
        if std::env::var_os("COMPY_PRINT_EVENT_PARTS_FIXTURE").is_some() {
            println!("----- BEGIN timeline-event-parts.json -----\n{emitted}----- END -----");
        }
        let on_disk = std::fs::read_to_string(EVENT_PARTS_FIXTURE)
            .expect("src/test/fixtures/timeline-event-parts.json is missing")
            .replace("\r\n", "\n");
        assert!(
            on_disk == emitted,
            "the timeline event summaries or parts changed. Update src/surfaces/event-text.ts and the \
             locale templates, then regenerate the fixture with COMPY_PRINT_EVENT_PARTS_FIXTURE=1"
        );
    }

    #[test]
    fn hardware_change_parts_name_each_part_in_summary_order() {
        let mut scan = IdentityDeltaScan::new();
        let mut out = Vec::new();
        scan.feed(&mut out, "2026-10-20T10:00:00Z", "t", "t", "GPU A", "d", 16, "1080p", None, "");
        scan.feed(&mut out, "2026-10-21T10:00:00Z", "t", "t", "GPU B", "d", 32, "1080p", None, "");
        let hw = out.iter().find(|c| c.ev.event_type == "hardware-change").unwrap();
        assert_eq!(
            serde_json::to_value(&hw.ev).unwrap()["parts"],
            serde_json::json!({ "kind": "hardware", "changes": [
                { "part": "gpu", "from": "GPU A", "to": "GPU B" },
                { "part": "ram", "from": "16 GB", "to": "32 GB" },
            ] })
        );
    }

    #[test]
    fn changed_before_report_never_claims_a_cause() {
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.applied = vec![mk_change("visual-effects", "Trim Windows visual effects", "2026-10-21T10:00:00Z", "applied")];
        g.snapshots = vec![
            mk_snap("2026-10-19T10:00:00Z", "drv-1", "26100", "Balanced"),
            mk_snap("2026-10-25T10:00:00Z", "drv-2", "26100", "Balanced"),
        ];
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        let wire = serde_json::to_string(&r).unwrap().to_lowercase();
        for banned in ["caused", "because", "the cause", "root cause", "%"] {
            assert!(!wire.contains(banned), "changed-before wire contains {banned:?}");
        }
    }

    #[test]
    fn changed_before_never_says_no_change_from_readings_of_two_streams() {
        // Review r1: a snapshot reads driver A before the window, the first rig fingerprint reads
        // driver B after the incident. No stream saw both, so no delta scan emitted an event — the
        // old bracket mixed the streams and said "no change". It is unknown.
        let mut anchor = mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0);
        anchor.hw_fingerprint = None;
        let mut after = mk_session("2026-10-25T10:00:00Z", "Game.exe", 100.0, 120.0);
        after.hw_fingerprint = Some(mk_fp("drv-B"));
        let mut g = gathered_with(vec![anchor, after]);
        g.snapshots = vec![mk_snap("2026-10-19T10:00:00Z", "drv-A", "26100", "Balanced")];
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        let drv = cb_cat(&r, "driver");
        assert_eq!(drv.status, "unknown", "cross-stream readings claimed {}", drv.status);
        assert_eq!(drv.unknown_reason.as_deref(), Some("unmatched-readings"));
        assert!(drv.checked_between.is_none());

        // Same stream, both ends, same value: that is the one honest "no change".
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.snapshots = vec![
            mk_snap("2026-10-19T10:00:00Z", "drv-A", "26100", "Balanced"),
            mk_snap("2026-10-26T10:00:00Z", "drv-A", "26100", "Balanced"),
        ];
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(cb_cat(&r, "driver").status, "no-change");
        assert_eq!(
            cb_cat(&r, "driver").checked_between,
            Some(("2026-10-19T10:00:00Z".to_string(), "2026-10-26T10:00:00Z".to_string()))
        );
        // A same-stream pair that differs is never "no change".
        g.snapshots[1].gpu_driver = "drv-B".into();
        let r = cb(&g, "2026-10-24T10:00:00Z", &[]);
        assert_eq!(cb_cat(&r, "driver").status, "unknown");
    }

    #[test]
    fn changed_before_a_capped_scan_cannot_call_an_older_session_clean() {
        let g = gathered_with(vec![
            mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0),
            mk_session("2026-10-22T10:00:00Z", "Game.exe", 100.0, 120.0),
        ]);
        let asm = assemble_from(&g);
        let inc = "2026-10-24T10:00:00Z";
        // The scan reaches back only to Oct 21: Oct 22 can be judged clean, Oct 20 cannot.
        let r = changed_before_incident_impl(&g, &asm, inc, at(inc), &[at("2026-10-22T10:05:00Z")], Some(at("2026-10-21T00:00:00Z")));
        assert_eq!(r.anchor_kind, "measured", "a session older than the scan was called clean");
        assert_eq!(r.anchor.unwrap().started_at, "2026-10-22T10:00:00Z");
        let r = changed_before_incident_impl(&g, &asm, inc, at(inc), &[], Some(at("2026-10-21T00:00:00Z")));
        assert_eq!(r.anchor_kind, "clean");
        assert_eq!(r.anchor.unwrap().started_at, "2026-10-22T10:00:00Z");
    }

    // ── P6-timeline: "Since it last worked" ──

    fn slw(g: &Gathered, incidents: &[&str], cjf: Option<&str>, now: &str) -> SinceLastWorked {
        let asm = assemble_from(g);
        let incidents: Vec<DateTime<Utc>> = incidents.iter().map(|t| at(t)).collect();
        since_last_worked_impl(g, &asm, &incidents, cjf.map(at), at(now))
    }

    #[test]
    fn since_last_worked_lists_what_happened_after_the_last_clean_session_newest_first() {
        let mut g = gathered_with(vec![
            mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0),
            mk_session("2026-10-22T10:00:00Z", "Game.exe", 100.0, 120.0),
        ]);
        g.applied = vec![mk_change("visual-effects", "Trim Windows visual effects", "2026-10-21T10:00:00Z", "applied")];
        g.snapshots = vec![
            mk_snap("2026-10-20T10:00:00Z", "drv-1", "26100", "Balanced"),
            mk_snap("2026-10-23T10:00:00Z", "drv-2", "26100", "Balanced"),
        ];
        // The Oct 22 session had a crash, so the last one that worked is Oct 20.
        let r = slw(&g, &["2026-10-22T10:05:00Z"], None, "2026-10-25T10:00:00Z");
        assert_eq!(r.none_reason, None);
        let anchor = r.anchor.as_ref().expect("a clean session");
        assert_eq!(anchor.started_at, "2026-10-20T10:00:00Z");
        let types: Vec<&str> = r.events.iter().map(|e| e.event_type.as_str()).collect();
        assert_eq!(types, ["gpu-driver-change", "session", "change-applied"], "newest first: {types:?}");
        assert!(
            !r.events.iter().any(|e| e.id == "session:2026-10-20T10:00:00Z"),
            "the session that worked is the anchor, not a row"
        );
        assert!(r.unplaced.is_empty());

        // A reading window that opens before the anchor may predate it: unplaced, never listed.
        g.snapshots[0].observed_at = "2026-10-19T10:00:00Z".into();
        let r = slw(&g, &["2026-10-22T10:05:00Z"], None, "2026-10-25T10:00:00Z");
        assert!(!r.events.iter().any(|e| e.event_type == "gpu-driver-change"));
        assert_eq!(r.unplaced.len(), 1);
        assert_eq!(r.unplaced[0].event_type, "gpu-driver-change");
    }

    #[test]
    fn since_last_worked_says_so_when_no_session_can_be_called_clean() {
        // Nothing measured yet.
        assert_eq!(slw(&gathered_with(vec![]), &[], None, "2026-10-25T10:00:00Z").none_reason.as_deref(), Some("no-session"));
        // A session still running (or just ended, inside the 90 s grace) hasn't "worked" yet.
        let g = gathered_with(vec![mk_session("2026-10-25T09:55:00Z", "Game.exe", 100.0, 120.0)]);
        assert_eq!(slw(&g, &[], None, "2026-10-25T10:05:30Z").none_reason.as_deref(), Some("no-session"));
        // Every ended session had an incident: none of them worked, and there's no fallback.
        let g = gathered_with(vec![
            mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0),
            mk_session("2026-10-22T10:00:00Z", "Game.exe", 100.0, 120.0),
        ]);
        let r = slw(&g, &["2026-10-20T10:05:00Z", "2026-10-22T10:05:00Z"], None, "2026-10-25T10:00:00Z");
        assert_eq!(r.none_reason.as_deref(), Some("none-clean"));
        assert!(r.anchor.is_none() && r.events.is_empty() && r.unplaced.is_empty());
        // The crash scan only reaches back to Oct 23: an older session can't be called clean.
        let r = slw(&g, &[], Some("2026-10-23T00:00:00Z"), "2026-10-25T10:00:00Z");
        assert_eq!(r.none_reason.as_deref(), Some("none-clean"));
        let r = slw(&g, &[], Some("2026-10-21T00:00:00Z"), "2026-10-25T10:00:00Z");
        assert_eq!(r.anchor.unwrap().started_at, "2026-10-22T10:00:00Z");
    }

    fn mk_drift(id: &str, label: &str, last_ready_at: Option<&str>, noticed_at: &str) -> crate::drift::DriftNotice {
        crate::drift::DriftNotice {
            id: id.into(),
            label: label.into(),
            last_ready_at: last_ready_at.map(str::to_string),
            noticed_at: noticed_at.into(),
        }
    }

    #[test]
    fn since_last_worked_always_carries_every_open_drift_whatever_its_age() {
        let mut g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        g.drift_notices = vec![
            // Open since before the session that worked: not "since", but still drifted now.
            mk_drift("game-mode", "Game Mode", Some("2026-10-10T10:00:00Z"), "2026-10-12T10:00:00Z"),
            // Noticed inside the window: a dated row of the list, not repeated below it.
            mk_drift("power-profile", "Power profile", Some("2026-10-21T10:00:00Z"), "2026-10-22T10:00:00Z"),
        ];
        let r = slw(&g, &[], None, "2026-10-25T10:00:00Z");
        assert_eq!(r.anchor.as_ref().unwrap().started_at, "2026-10-20T10:00:00Z");
        let open: Vec<&str> = r.open_drift.iter().map(|e| e.summary.as_str()).collect();
        assert_eq!(open, [drift_summary("Game Mode").as_str()], "only the drift not already listed");
        assert!(r.events.iter().any(|e| e.summary == drift_summary("Power profile")));
        assert!(!r.events.iter().any(|e| e.summary == drift_summary("Game Mode")));

        // No session that worked: the list is empty, the open drift is still there.
        let r = slw(&g, &["2026-10-20T10:05:00Z"], None, "2026-10-25T10:00:00Z");
        assert_eq!(r.none_reason.as_deref(), Some("none-clean"));
        assert_eq!(r.open_drift.len(), 2);
        assert_eq!(r.open_drift[0].summary, drift_summary("Power profile"), "newest first");
        let mut g = gathered_with(vec![]);
        g.drift_notices = vec![mk_drift("game-mode", "Game Mode", None, "2026-10-12T10:00:00Z")];
        let r = slw(&g, &[], None, "2026-10-25T10:00:00Z");
        assert_eq!(r.none_reason.as_deref(), Some("no-session"));
        assert_eq!(r.open_drift.len(), 1);
    }

    #[test]
    fn since_last_worked_rides_the_report_even_with_no_incident() {
        let g = gathered_with(vec![mk_session("2026-10-20T10:00:00Z", "Game.exe", 100.0, 120.0)]);
        let mut report = crate::blackbox::BlackBoxReport::default();
        attach_since_last_worked_from(&g, &mut report, at("2026-10-25T10:00:00Z"));
        let wire = serde_json::to_value(&report).unwrap();
        assert_eq!(wire["since_last_worked"]["anchor"]["started_at"], "2026-10-20T10:00:00Z");
        assert!(wire["since_last_worked"]["none_reason"].is_null());
        // The background observer's scan never carries it.
        let bare = serde_json::to_value(crate::blackbox::BlackBoxReport::default()).unwrap();
        assert!(bare.get("since_last_worked").is_none());
    }

    #[test]
    fn changed_before_a_full_event_log_channel_under_the_incident_cap_cannot_call_an_older_session_clean() {
        // Review r2: the System channel returns its newest 40 rows, and one shutdown can be several
        // rows (Kernel-Power 41 + EventLog 6008 here). 40 rows → 20 incidents, under the 25 cap — yet
        // anything older than the oldest row may have been pushed out, so the Sep 20 session can't
        // be called clean. Through the real scan pipeline: JSON → report → attach.
        let mut rows = Vec::new();
        for h in 0..20 {
            let t = format!("2026-10-01T{h:02}:00:00.0000000-07:00");
            rows.push(serde_json::json!({"time": t, "id": 41, "provider": "Microsoft-Windows-Kernel-Power",
                "message": "The system has rebooted without cleanly shutting down first.", "props": []}));
            rows.push(serde_json::json!({"time": t, "id": 6008, "provider": "EventLog",
                "message": "The previous system shutdown was unexpected.", "props": []}));
        }
        let json = serde_json::to_string(&rows).unwrap();
        let sessions = vec![mk_session("2026-09-20T10:00:00Z", "Game.exe", 100.0, 120.0)];
        let mut report = crate::blackbox::report_from_event_json(&json, &sessions);
        assert!(report.incidents.len() < 25, "the scan must stay under its incident cap: {}", report.incidents.len());
        assert_eq!(report.clean_judgeable_from, Some(at("2026-10-01T07:00:00Z")), "the full channel's oldest kept row");
        let g = gathered_with(sessions);
        attach_changed_before_from(&g, &mut report);
        let cb = report.incidents[0].changed_before.as_ref().expect("attached");
        assert_eq!(cb.anchor.as_ref().unwrap().started_at, "2026-09-20T10:00:00Z");
        assert_eq!(cb.anchor_kind, "measured", "a session older than a truncated channel was called clean");
    }
}
