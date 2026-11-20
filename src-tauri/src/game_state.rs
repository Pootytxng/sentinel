//! Game-state fingerprint — the honest, additive record of the CONDITIONS a session ran under.
//!
//! Measurement Platform 2.0, Task E. A `GameStateFingerprint` answers "under what conditions was
//! this session measured?" so the comparability gate (Task F, `comparability.rs`) can DECLINE to
//! compare two sessions whose conditions differ, instead of silently mis-attributing a delta.
//!
//! # Honesty contract (the whole point of this module)
//!
//! - **Collect only what we can PROVE.** V1 populates the highest-confidence fields that are already
//!   read from the machine (display resolution, active refresh, GPU driver, Windows build, the rig
//!   fingerprint hash). Everything we cannot prove without inference — graphics API in use, the game's
//!   fullscreen/borderless mode, fps cap, vsync/VRR/upscaler/frame-gen state, the executable version
//!   or a game build id — stays **`None` = honestly unknown**. We NEVER infer a graphics setting from
//!   GPU utilization, and NEVER invent a build id.
//! - **The schema is the full spec shape; V1 fills a subset.** Every future field already exists as an
//!   `Option`, so growing collection later is additive — old sessions keep loading, new fields default
//!   to unknown. `unknown_fields` is a forward-compat catch-all so a session written by a NEWER build
//!   round-trips through an older one without losing data.
//! - **No sensitive paths.** We store the process *name* (e.g. `"cs2.exe"`), never a full executable
//!   path. `executable_hash` (a future stable-identity digest) is deferred precisely because doing it
//!   right without leaking a path or hammering disk is its own task.
//! - **`capture_capabilities` is deliberately NOT embedded here.** It already lives at the
//!   `SessionSummary` top level (Task C). Re-embedding it would create a second source of truth that
//!   could drift; the comparability gate composes `session.capture_capabilities` WITH
//!   `session.game_state` instead.
//!
//! Local-only; never leaves the machine. Exports sanitize (the session serializer only emits the
//! fields present, and no full paths are ever collected in the first place).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The conditions a session ran under. Every field is optional or defaulted so the struct is
/// additive: a pre-2.0 session (no `game_state`) loads as `None`, and a session written by a future
/// build with more fields still round-trips through today's code via `unknown_fields`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub(crate) struct GameStateFingerprint {
    // --- Identity of the thing measured ---------------------------------------------------------
    /// The foreground game's process name only (e.g. `"cs2.exe"`) — never a full path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    /// Executable file version, when we can read it cheaply. Deferred in V1 → unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_version: Option<String>,
    /// Stable-identity digest of the executable (contents documented when implemented). Deferred in
    /// V1 → unknown, so it never leaks a path and never fabricates identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_hash: Option<String>,
    /// Game build / patch id. We do NOT invent one — deferred in V1 → unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_build: Option<String>,
    /// Launcher manifest version (Steam/Epic/etc.). Deferred in V1 → unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launcher_manifest_version: Option<String>,

    // --- Rendering conditions (mostly unprovable in V1 → unknown) --------------------------------
    /// Graphics API in use (DX11/DX12/Vulkan/OpenGL). We can observe present events but NOT reliably
    /// attribute the API from them here → unknown in V1. (The capture backend's `graphics_api`
    /// records which APIs the backend can SEE, a different, capability-level fact.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphics_api: Option<String>,
    /// Display resolution width at capture time. This is the DISPLAY mode resolution, NOT the game's
    /// internal render resolution (which we cannot read without inference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_width: Option<u32>,
    /// Display resolution height at capture time. See `resolution_width` — display, not render.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_height: Option<u32>,
    /// Fullscreen / borderless / windowed. Not provable without inference → unknown in V1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_mode: Option<String>,
    /// Active display refresh (Hz) at capture time. This is the desktop/active mode refresh; an
    /// exclusive-fullscreen title may select a different mode we cannot observe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_refresh_hz: Option<u32>,
    /// Identity of the active display (EDID vendor + model), so comparability can flag "you switched
    /// monitors". Best-effort from the primary monitor's EDID; `None` if unread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_display_identity: Option<String>,
    /// In-game fps cap. Not provable → unknown in V1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps_cap: Option<u32>,
    /// V-Sync state. Not provable → unknown in V1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vsync_state: Option<String>,
    /// Variable-refresh (FreeSync/G-Sync) state in-game. Not provable → unknown in V1. (Compy detects
    /// FreeSync *capability* elsewhere; whether the game engaged VRR this session is not readable.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vrr_state: Option<String>,
    /// Upscaler in use (FSR/DLSS/XeSS/native). Not provable → unknown in V1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upscaler: Option<String>,
    /// Frame-generation state (FSR3-FG/DLSS-FG/AFMF/off). Not provable → unknown in V1, but recorded
    /// as CONTEXT once readable so a comparison DECLINES rather than trusting a blended real+generated
    /// FPS number (see the capture-backend decision doc §2.6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_generation_state: Option<String>,

    // --- System context (provable in V1) --------------------------------------------------------
    /// GPU driver version string, from the rig fingerprint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpu_driver: Option<String>,
    /// Windows build, `"{CurrentBuildNumber}.{UBR}"` (e.g. `"26200.1234"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub windows_build: Option<String>,
    /// The rig fingerprint hash (`HwFingerprint::hash`) — the grouping key that changes when the GPU,
    /// driver, RAM, or display changes. Local-only; never leaves the machine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware_fingerprint_hash: Option<String>,
    /// Compy applied-change ids active for this session. Deferred in V1 (empty): the session already
    /// carries the honest session-start count (`compy_changes_active`); capturing the ID LIST
    /// truthfully requires reading it at session START, not at save time, so it lands with that
    /// plumbing rather than a save-time snapshot that could disagree with the session.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub active_compy_change_ids: Vec<String>,
    /// Whether Gaming Mode was active during the session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gaming_mode_active: Option<bool>,
    /// TG-context: the active power plan's GUID (lower-case, as powercfg prints it) when the capture
    /// STARTED. `None` = unread (powercfg failed or printed no GUID), never a guessed plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_plan_guid: Option<String>,
    /// TG-context: whether the active plan at the session's END differed from the start one.
    /// `Some(false)` only when both ends were read and match; `None` when either end is unread. Two
    /// reads, not a per-tick watch: a switch and back within the session is not seen here (what
    /// Gaming Mode itself did to the plan is on the session's `gaming_mode_plan`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_plan_changed: Option<bool>,
    /// TG-context: which context fields this build collects ([`CONTEXT_VERSION`]); `None` = a session
    /// recorded before the Trial conditions guard, whose missing context fields mean "not collected".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_version: Option<u32>,
    /// TG-context v2: how much of the PC's total CPU capacity everything EXCEPT the game used over
    /// the session's measured ticks (a stream, a browser video, a download). Numbers only. `None` =
    /// unknown (too few readings, too many unread ticks, or a pre-v2 session), never zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_cpu: Option<OtherLoad>,
    /// TG-context v2: the same for 3D-engine GPU work done by processes other than the game (a sum over
    /// engines and adapters, clamped to 100; not a share of one GPU).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_gpu_3d: Option<OtherLoad>,
    /// TG-context v2: the same for video-engine work (decode, encode, codec, processing, JPEG) by
    /// processes other than the game, e.g. a stream or a capture encoder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_gpu_video: Option<OtherLoad>,

    /// When this fingerprint was collected (session start, ISO-8601), for provenance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collected_at: Option<String>,

    /// Forward-compat catch-all: any field written by a NEWER build that this build doesn't know
    /// about is preserved here and re-emitted, so a round-trip through an older Compy never drops it.
    #[serde(flatten, default)]
    pub unknown_fields: HashMap<String, serde_json::Value>,
}

/// TG-context schema version: 1 = the power plan at start + whether it changed by the end;
/// 2 = v1 plus how busy the rest of the PC was (`other_cpu`, `other_gpu_3d`, `other_gpu_video`).
pub(crate) const CONTEXT_VERSION: u32 = 2;

/// How busy "everything except the game" was across a session's measured ticks, as a share of the
/// whole machine's capacity, in tenths of a percent (0..=1000). Numbers only: no process names, no
/// pids. Built by `other_load::OtherLoadAccumulator`, which returns `None` rather than a figure it
/// cannot stand behind.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct OtherLoad {
    /// Measured ticks that produced a reading.
    pub readings: u32,
    /// Measured ticks whose reading failed (not counted in the figures below).
    pub unread: u32,
    /// Mean of the readings, tenths of a percent.
    pub mean_pct_x10: u16,
    /// 90th percentile (nearest rank) of the readings, tenths of a percent.
    pub p90_pct_x10: u16,
}

impl GameStateFingerprint {
    /// PURE (TG-context v2): attach the other-load figures. `None` stays unknown.
    pub(crate) fn with_other_load(
        mut self,
        cpu: Option<OtherLoad>,
        gpu_3d: Option<OtherLoad>,
        gpu_video: Option<OtherLoad>,
    ) -> Self {
        self.other_cpu = cpu;
        self.other_gpu_3d = gpu_3d;
        self.other_gpu_video = gpu_video;
        self
    }

    /// PURE (TG-context): record the plan read at the capture's start and end. A start that can't be
    /// read leaves the plan unknown; "changed" needs both reads (GUIDs compared case-insensitively).
    pub(crate) fn with_power_plan(mut self, at_start: Option<String>, at_end: Option<String>) -> Self {
        let clean = |g: Option<String>| g.map(|g| g.trim().to_ascii_lowercase()).filter(|g| !g.is_empty());
        let (start, end) = (clean(at_start), clean(at_end));
        self.power_plan_changed = match (&start, &end) {
            (Some(s), Some(e)) => Some(s != e),
            _ => None,
        };
        self.power_plan_guid = start;
        self.context_version = Some(CONTEXT_VERSION);
        self
    }

    /// Collect the V1 (highest-confidence, already-available) fields from the cached hardware
    /// snapshot. Everything not provable stays `None`/empty — honestly unknown, never inferred.
    ///
    /// `process_name` is the foreground game's process name (caller supplies; already known at the
    /// monitoring boundary), `collected_at` is the session start timestamp (for provenance +
    /// determinism — no wall-clock read here), `gaming_mode_active` is the session's observed flag.
    pub(crate) fn collect_v1(
        process_name: &str,
        collected_at: &str,
        gaming_mode_active: Option<bool>,
    ) -> Self {
        Self::collect_v1_from(&crate::hardware::get_hardware_info(), process_name, collected_at, gaming_mode_active)
    }

    /// PURE: [`Self::collect_v1`] from one hardware read (TG-preflight NIT: the hardware is read
    /// once, so the driver and fingerprint hash come from the same snapshot as the display fields).
    pub(crate) fn collect_v1_from(
        hw: &crate::hardware::HardwareInfo,
        process_name: &str,
        collected_at: &str,
        gaming_mode_active: Option<bool>,
    ) -> Self {
        let fp = crate::hardware::fingerprint_from_info(hw);

        let (resolution_width, resolution_height, display_refresh_hz) = hw
            .display
            .as_ref()
            .map(|d| {
                (
                    Some(d.width),
                    Some(d.height),
                    // Active mode refresh; 0 means "unread" → keep it unknown rather than record a 0.
                    (d.current_refresh_rate_hz > 0).then_some(d.current_refresh_rate_hz),
                )
            })
            .unwrap_or((None, None, None));

        let active_display_identity = hw.monitors.first().and_then(|m| {
            let id = format!("{} {}", m.manufacturer, m.model);
            let id = id.trim().to_string();
            (!id.is_empty()).then_some(id)
        });

        let windows_build = hw
            .windows_version
            .as_ref()
            .map(|w| format!("{}.{}", w.build, w.ubr));

        GameStateFingerprint {
            process_name: (!process_name.trim().is_empty()).then(|| process_name.to_string()),
            resolution_width,
            resolution_height,
            display_refresh_hz,
            active_display_identity,
            gpu_driver: (!fp.gpu_driver.is_empty()).then(|| fp.gpu_driver.clone()),
            windows_build,
            hardware_fingerprint_hash: (!fp.hash.is_empty()).then(|| fp.hash.clone()),
            gaming_mode_active,
            // TG-context fields are filled by `with_power_plan` at the capture boundary (it holds
            // the start read); a fingerprint built without it says "not collected".
            power_plan_guid: None,
            power_plan_changed: None,
            context_version: None,
            other_cpu: None,
            other_gpu_3d: None,
            other_gpu_video: None,
            collected_at: (!collected_at.trim().is_empty()).then(|| collected_at.to_string()),
            // --- Not provable in V1 → honestly unknown (documented on each field above) ---
            executable_version: None,
            executable_hash: None,
            game_build: None,
            launcher_manifest_version: None,
            graphics_api: None,
            display_mode: None,
            fps_cap: None,
            vsync_state: None,
            vrr_state: None,
            upscaler: None,
            frame_generation_state: None,
            active_compy_change_ids: Vec::new(),
            unknown_fields: HashMap::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_all_unknown() {
        let g = GameStateFingerprint::default();
        assert!(g.process_name.is_none());
        assert!(g.graphics_api.is_none());
        assert!(g.resolution_width.is_none());
        assert!(g.active_compy_change_ids.is_empty());
        assert!(g.unknown_fields.is_empty());
    }

    #[test]
    fn unprovable_fields_stay_none_after_collect() {
        // collect_v1 reads real cached hardware, so we don't assert the provable fields' values
        // (they depend on the machine) — we assert the HONESTY CONTRACT: everything we cannot prove
        // in V1 is left unknown, never fabricated.
        let g = GameStateFingerprint::collect_v1("cs2.exe", "2026-07-18T00:00:00Z", Some(true));
        assert_eq!(g.process_name.as_deref(), Some("cs2.exe"));
        assert_eq!(g.gaming_mode_active, Some(true));
        assert_eq!(g.collected_at.as_deref(), Some("2026-07-18T00:00:00Z"));
        // The unprovable set — all must remain unknown.
        assert!(g.executable_version.is_none());
        assert!(g.executable_hash.is_none());
        assert!(g.game_build.is_none());
        assert!(g.launcher_manifest_version.is_none());
        assert!(g.graphics_api.is_none());
        assert!(g.display_mode.is_none());
        assert!(g.fps_cap.is_none());
        assert!(g.vsync_state.is_none());
        assert!(g.vrr_state.is_none());
        assert!(g.upscaler.is_none());
        assert!(g.frame_generation_state.is_none());
        assert!(g.active_compy_change_ids.is_empty());
    }

    // TG-preflight NIT (s35): one hardware read gives the display fields, the driver and the rig hash.
    #[test]
    fn collect_from_one_read_takes_the_driver_and_hash_from_that_same_read() {
        use crate::hardware::{DisplayInfo, GpuInfo, HardwareInfo};
        let gpu = |name: &str, vram: u64, drv: &str| GpuInfo {
            name: name.into(),
            vram_bytes: vram,
            driver_version: drv.into(),
            ..GpuInfo::default()
        };
        let hw = HardwareInfo {
            gpus: vec![gpu("iGPU", 1, "1.0"), gpu("RX 7800 XT", 16 << 30, "32.0.21025")],
            display: Some(DisplayInfo { width: 2560, height: 1440, current_refresh_rate_hz: 165, max_refresh_rate_hz: 165, hdr_capable: false }),
            ram_total_bytes: 32 << 30,
            ..HardwareInfo::default()
        };
        let g = GameStateFingerprint::collect_v1_from(&hw, "ROB RUN.exe", "2026-11-17T10:00:00Z", None);
        let fp = crate::hardware::fingerprint_from_info(&hw);
        assert_eq!(g.gpu_driver.as_deref(), Some("32.0.21025"), "the primary (most-VRAM) card's driver");
        assert_eq!(g.hardware_fingerprint_hash.as_deref(), Some(fp.hash.as_str()));
        assert_eq!((g.resolution_width, g.resolution_height, g.display_refresh_hz), (Some(2560), Some(1440), Some(165)));
        // A read with no card and no display records nothing it didn't read.
        let bare = GameStateFingerprint::collect_v1_from(&HardwareInfo::default(), "x.exe", "t", None);
        assert!(bare.gpu_driver.is_none() && bare.resolution_width.is_none() && bare.display_refresh_hz.is_none());
    }

    const BAL: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
    const SYNEZ: &str = "6c1e3f42-0d2b-4a77-9e1f-3b7a7f6e1c10";

    #[test]
    fn power_plan_same_at_both_ends_reads_unchanged() {
        let g = GameStateFingerprint::default().with_power_plan(Some(BAL.into()), Some(BAL.to_uppercase()));
        assert_eq!(g.power_plan_guid.as_deref(), Some(BAL));
        assert_eq!(g.power_plan_changed, Some(false));
        assert_eq!(g.context_version, Some(CONTEXT_VERSION));
    }

    #[test]
    fn power_plan_switched_by_the_end_reads_changed_and_keeps_the_start_plan() {
        let g = GameStateFingerprint::default().with_power_plan(Some(SYNEZ.into()), Some(BAL.into()));
        assert_eq!(g.power_plan_guid.as_deref(), Some(SYNEZ));
        assert_eq!(g.power_plan_changed, Some(true));
    }

    #[test]
    fn an_unread_end_leaves_changed_unknown_never_false() {
        let start_only = GameStateFingerprint::default().with_power_plan(Some(BAL.into()), None);
        assert_eq!((start_only.power_plan_guid.as_deref(), start_only.power_plan_changed), (Some(BAL), None));
        // An unread start is unknown, even when the end was read: never borrow the end plan.
        let end_only = GameStateFingerprint::default().with_power_plan(Some("  ".into()), Some(BAL.into()));
        assert_eq!((end_only.power_plan_guid, end_only.power_plan_changed), (None, None));
        // Collected-but-unread still says which context version tried (unknown, not "not collected").
        assert_eq!(end_only.context_version, Some(CONTEXT_VERSION));
    }

    #[test]
    fn a_session_from_before_tg_context_loads_with_its_context_not_collected() {
        let old = r#"{"process_name":"RobRun.exe","gpu_driver":"32.0.1","gaming_mode_active":false}"#;
        let g: GameStateFingerprint = serde_json::from_str(old).unwrap();
        assert_eq!((&g.power_plan_guid, g.power_plan_changed, g.context_version), (&None, None, None));
        assert!(g.unknown_fields.is_empty(), "the new keys are known fields, not catch-all: {:?}", g.unknown_fields);
        let v = serde_json::to_value(&g).unwrap();
        assert!(v.get("context_version").is_none() && v.get("power_plan_guid").is_none(), "{v}");
        // And a new row round-trips its context.
        let new = GameStateFingerprint::default().with_power_plan(Some(BAL.into()), Some(SYNEZ.into()));
        let back: GameStateFingerprint = serde_json::from_value(serde_json::to_value(&new).unwrap()).unwrap();
        assert_eq!(back, new);
    }

    #[test]
    fn empty_process_name_stays_unknown() {
        let g = GameStateFingerprint::collect_v1("   ", "", None);
        assert!(g.process_name.is_none());
        assert!(g.collected_at.is_none());
        assert!(g.gaming_mode_active.is_none());
    }

    #[test]
    fn forward_compat_unknown_fields_round_trip() {
        // A session written by a FUTURE build carries a field we don't know. It must survive a
        // deserialize→serialize round-trip through today's code (never silently dropped).
        let json = r#"{
            "process_name": "cs2.exe",
            "resolution_width": 2560,
            "some_future_field": {"nested": 7},
            "another_future_scalar": "hi"
        }"#;
        let g: GameStateFingerprint = serde_json::from_str(json).unwrap();
        assert_eq!(g.process_name.as_deref(), Some("cs2.exe"));
        assert_eq!(g.resolution_width, Some(2560));
        assert!(g.unknown_fields.contains_key("some_future_field"));
        assert!(g.unknown_fields.contains_key("another_future_scalar"));

        let reserialized = serde_json::to_value(&g).unwrap();
        assert_eq!(reserialized["some_future_field"]["nested"], 7);
        assert_eq!(reserialized["another_future_scalar"], "hi");
        // Unknown (None) fields are skipped, so we don't emit a wall of nulls.
        assert!(reserialized.get("executable_version").is_none());
    }

    // TG-context v2: a session stored by the v1 build keeps its version and its bytes.
    #[test]
    fn a_stored_v1_session_loads_with_no_other_load_and_reserialises_identically() {
        let v1 = r#"{"process_name":"ROB RUN.exe","gpu_driver":"32.0.1","gaming_mode_active":false,"power_plan_guid":"381b4222-f694-41f0-9685-ff5bb260df2e","power_plan_changed":false,"context_version":1,"collected_at":"2026-11-10T10:00:00Z"}"#;
        let g: GameStateFingerprint = serde_json::from_str(v1).unwrap();
        assert_eq!((g.other_cpu, g.other_gpu_3d, g.other_gpu_video, g.context_version), (None, None, None, Some(1)));
        assert!(g.unknown_fields.is_empty(), "{:?}", g.unknown_fields);
        let out = serde_json::to_string(&g).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&out).unwrap(), serde_json::from_str::<serde_json::Value>(v1).unwrap());
        assert!(!out.contains("other_"), "{out}");
        assert_eq!(out, serde_json::to_string(&serde_json::from_str::<GameStateFingerprint>(&out).unwrap()).unwrap());
    }

    #[test]
    fn a_v2_session_round_trips_its_other_load_and_unknown_fields_survive() {
        let load = |r, u, m, p| OtherLoad { readings: r, unread: u, mean_pct_x10: m, p90_pct_x10: p };
        let g = GameStateFingerprint::default()
            .with_power_plan(Some(BAL.into()), Some(BAL.into()))
            .with_other_load(Some(load(300, 4, 123, 456)), None, Some(load(90, 0, 5, 40)));
        assert_eq!(g.context_version, Some(2));
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["other_cpu"]["p90_pct_x10"], 456);
        assert!(v.get("other_gpu_3d").is_none() && v.get("other_gpu").is_none(), "unknown GPU load is omitted, never a zero: {v}");
        assert_eq!(v["other_gpu_video"]["p90_pct_x10"], 40);
        let back: GameStateFingerprint = serde_json::from_value(v).unwrap();
        assert_eq!(back, g);
        let mut future = serde_json::to_value(&g).unwrap();
        future["next_build_field"] = serde_json::json!({"k": 1});
        let kept = serde_json::to_value(serde_json::from_value::<GameStateFingerprint>(future).unwrap()).unwrap();
        assert_eq!(kept["next_build_field"]["k"], 1);
        assert_eq!(kept["other_cpu"]["readings"], 300);
    }

    #[test]
    fn known_none_fields_are_omitted_from_json() {
        // skip_serializing_if keeps exports lean AND honest: an absent field reads as "unknown",
        // never as a fabricated default. A defaulted fingerprint serializes to (almost) nothing.
        let g = GameStateFingerprint::default();
        let v = serde_json::to_value(&g).unwrap();
        assert!(v.as_object().unwrap().is_empty(), "default → no fabricated fields, got {v}");
    }
}
