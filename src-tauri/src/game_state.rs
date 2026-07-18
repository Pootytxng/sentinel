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

    /// When this fingerprint was collected (session start, ISO-8601), for provenance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collected_at: Option<String>,

    /// Forward-compat catch-all: any field written by a NEWER build that this build doesn't know
    /// about is preserved here and re-emitted, so a round-trip through an older Compy never drops it.
    #[serde(flatten, default)]
    pub unknown_fields: HashMap<String, serde_json::Value>,
}

impl GameStateFingerprint {
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
        let hw = crate::hardware::get_hardware_info();
        let fp = crate::hardware::current_fingerprint();

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

    #[test]
    fn known_none_fields_are_omitted_from_json() {
        // skip_serializing_if keeps exports lean AND honest: an absent field reads as "unknown",
        // never as a fabricated default. A defaulted fingerprint serializes to (almost) nothing.
        let g = GameStateFingerprint::default();
        let v = serde_json::to_value(&g).unwrap();
        assert!(v.as_object().unwrap().is_empty(), "default → no fabricated fields, got {v}");
    }
}
