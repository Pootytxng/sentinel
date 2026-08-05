//! capture.rs — the capture-backend boundary + the per-session capability model.
//!
//! Two additive, honesty-first concepts introduced by Measurement Platform 2.0. This module
//! measures NOTHING new and mutates NOTHING: it names, versions and honestly bounds the frame
//! capture the elevated ETW-DXGI helper (`fps.rs`) already performs.
//!
//!  * [`CaptureCapabilities`] — an explicit, per-session record of *what a capture backend could
//!    actually measure*. Persisted with each new session so a surface never renders an unsupported
//!    metric as a real `0`, an export never implies a metric that was never captured, and a
//!    cross-session comparison only ever compares metrics BOTH sides actually recorded (see
//!    `comparability` / `intelligence`). Sessions recorded before this field deserialize to `None`
//!    = honestly Unknown, NEVER a fabricated "assume today's backend".
//!
//!  * [`CaptureBackend`] — the boundary the session lifecycle talks to for frame timing, so today's
//!    ETW-DXGI helper is ONE implementation rather than the permanent, implicit definition of "a
//!    session". A future backend (PresentMon 2.x or equivalent) implements the same trait and simply
//!    declares richer `capabilities()`. The evaluation and the (deliberately deferred) spawn/poll/
//!    kill process-control abstraction live in `docs/decisions/2026-07-18-capture-backend.md` —
//!    encoding a speculative process-control signature before a second backend exists would be
//!    abstraction theater, so only the operations with a real present-day consumer (capabilities +
//!    sample parsing) are abstracted today.

use serde::{Deserialize, Serialize};

/// Stable id of the only production capture backend today: the elevated ETW helper that consumes
/// Microsoft-Windows-DXGI present events (`fps.rs`). NOT the app/git version — this identifies the
/// *measurement method*, so a session's declared capabilities stay meaningful across app updates
/// that don't change how frames are captured.
pub(crate) const ETW_DXGI_BACKEND_ID: &str = "etw-dxgi";

/// Frame-timing algorithm version for the ETW-DXGI backend. Bump ONLY when the capture math changes
/// in a way that affects comparability (e.g. the per-swapchain keying change, or adding a new ETW
/// provider). Deliberately independent of the app version.
pub(crate) const ETW_DXGI_BACKEND_VERSION: &str = "1";

/// The published methodology these numbers correspond to (`docs/METHODOLOGY.md`, drafted
/// 2026-07-16). Stamped per session so an export can point a skeptic at the exact methodology in
/// force when the data was captured. Bump alongside a material methodology change.
pub(crate) const METHODOLOGY_VERSION: &str = "2026-07-16";

/// What a capture backend could measure for a given session — the honest answer to "can a surface
/// or a comparison trust this metric from this session?". Every `supports_*` flag being `false` means
/// the metric was **never captured** and must render as unavailable, never as a real `0`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct CaptureCapabilities {
    /// Stable id of the backend that produced the session (e.g. "etw-dxgi").
    pub(crate) backend_id: String,
    /// Capture-method version (see [`ETW_DXGI_BACKEND_VERSION`]) — NOT the app version.
    pub(crate) backend_version: String,
    /// Graphics-API families this backend can OBSERVE — not the specific game's API (that lives on
    /// the game-state fingerprint). ETW-DXGI sees DX11/DX12 only; Vulkan/OpenGL present through
    /// DxgKrnl and are invisible to it.
    pub(crate) graphics_api: Vec<String>,

    // ── Frame-metric axes. `true` only where the backend genuinely produces the metric. ──────────
    /// Frames the game SUBMITS (present calls) — "app" / "submit" FPS.
    pub(crate) supports_app_fps: bool,
    /// Present-completion FPS correlated across providers (PresentMon's "presented").
    pub(crate) supports_presented_fps: bool,
    /// Frames actually scanned out to the display ("displayed" FPS).
    pub(crate) supports_displayed_fps: bool,
    /// Per-frame real-vs-generated classification.
    pub(crate) supports_frame_type: bool,
    /// Frame-generation (interpolated) frame accounting.
    pub(crate) supports_generated_frames: bool,
    /// Per-frame GPU-busy time.
    pub(crate) supports_gpu_busy: bool,
    /// Present→photons display latency.
    pub(crate) supports_display_latency: bool,
    /// Input→present (click-to-photon component) latency.
    pub(crate) supports_input_latency: bool,
    /// Dropped / discarded present accounting.
    pub(crate) supports_dropped_frames: bool,
    /// This backend's OWN GPU power/temp/utilization telemetry stream. (Compy's session GPU peaks
    /// come from a SEPARATE sensor subsystem, not the capture backend, so this stays `false` for the
    /// ETW-DXGI helper — those peaks remain their own honest `Option` fields on the summary.)
    pub(crate) supports_gpu_telemetry: bool,

    /// Human-readable honest caveats a reader should know about this backend's numbers.
    pub(crate) limitations: Vec<String>,
    /// When capture began (RFC3339) — usually the session start. `None` when unknown.
    pub(crate) capture_started_at: Option<String>,
    /// The `docs/METHODOLOGY.md` version these numbers correspond to.
    pub(crate) methodology_version: String,
}

impl CaptureCapabilities {
    /// The honest capability descriptor of the current production backend: the elevated ETW helper
    /// consuming DXGI present events (`fps.rs`). It counts present CALLS (app/submit FPS) on DX11/DX12
    /// titles — so `supports_app_fps` is the ONLY true frame-metric flag. It does not correlate
    /// present completion (no presented/displayed FPS), classify frame type or generated frames, time
    /// GPU-busy, or measure display/input latency; GPU power/temp telemetry comes from a SEPARATE
    /// sensor subsystem, not this capture backend, so it is honestly `false` here. Vulkan/OpenGL
    /// present through DxgKrnl, not DXGI, and are not counted.
    pub(crate) fn etw_dxgi(capture_started_at: Option<String>) -> Self {
        Self {
            backend_id: ETW_DXGI_BACKEND_ID.to_string(),
            backend_version: ETW_DXGI_BACKEND_VERSION.to_string(),
            graphics_api: vec!["DirectX 11".to_string(), "DirectX 12".to_string()],
            supports_app_fps: true,
            supports_presented_fps: false,
            supports_displayed_fps: false,
            supports_frame_type: false,
            supports_generated_frames: false,
            supports_gpu_busy: false,
            supports_display_latency: false,
            supports_input_latency: false,
            supports_dropped_frames: false,
            supports_gpu_telemetry: false,
            limitations: vec![
                "Counts DX11/DX12 present calls (app/submit FPS); Vulkan and OpenGL titles present \
                 through DxgKrnl and are not counted."
                    .to_string(),
                "Measures the frame rate the game submits — not present-completion, displayed \
                 frames, or dropped frames."
                    .to_string(),
                "No per-frame GPU-busy, display latency, input latency, or frame-generation \
                 accounting."
                    .to_string(),
            ],
            capture_started_at,
            methodology_version: METHODOLOGY_VERSION.to_string(),
        }
    }

    /// The metric axes BOTH capability sets support — the only metrics a cross-session comparison may
    /// honestly compare when the two sessions were captured by different backends (or backend
    /// versions). Comparability (Task F) consumes this so a richer future backend never invites a
    /// comparison against a metric the other side never captured. Labels are the stable metric ids.
    pub(crate) fn shared_metrics(&self, other: &Self) -> Vec<&'static str> {
        let mut shared: Vec<&'static str> = Vec::new();
        macro_rules! both {
            ($field:ident, $label:literal) => {
                if self.$field && other.$field {
                    shared.push($label);
                }
            };
        }
        both!(supports_app_fps, "app_fps");
        both!(supports_presented_fps, "presented_fps");
        both!(supports_displayed_fps, "displayed_fps");
        both!(supports_frame_type, "frame_type");
        both!(supports_generated_frames, "generated_frames");
        both!(supports_gpu_busy, "gpu_busy");
        both!(supports_display_latency, "display_latency");
        both!(supports_input_latency, "input_latency");
        both!(supports_dropped_frames, "dropped_frames");
        both!(supports_gpu_telemetry, "gpu_telemetry");
        shared
    }

    /// True when the two sessions were captured by the same backend AND the same capture-method
    /// version — i.e. every metric one side has, the other side captured the same way. When this is
    /// false a comparison must fall back to [`shared_metrics`] (and, if that is empty, decline).
    pub(crate) fn same_method_as(&self, other: &Self) -> bool {
        self.backend_id == other.backend_id && self.backend_version == other.backend_version
    }
}

/// The capture-backend boundary. Today's ETW-DXGI helper is the single implementation; the trait
/// exists so a future backend (PresentMon 2.x) is a drop-in that declares its OWN capabilities
/// rather than a rewrite of the session lifecycle. Kept deliberately minimal — only the operations
/// with a real present-day consumer are abstracted: the capability descriptor (stamped onto every
/// saved session) and per-tick sample parsing (routed at the monitoring read site). The elevated
/// spawn/heartbeat/kill lifecycle stays in `monitoring.rs` until a second backend actually needs a
/// different one; encoding a speculative process-control signature now would be abstraction theater
/// (see `docs/decisions/2026-07-18-capture-backend.md`).
pub(crate) trait CaptureBackend {
    /// Stable backend id (matches the persisted `CaptureCapabilities::backend_id`). No present-day
    /// caller — it exists for the future backend selector (a second backend picks by id); allowed
    /// dead until then rather than dropped, so the trait's contract stays whole.
    #[allow(dead_code)]
    fn id(&self) -> &'static str;

    /// The honest capability descriptor for a session this backend captured.
    fn capabilities(&self, capture_started_at: Option<String>) -> CaptureCapabilities;

    /// Parse this backend's raw per-tick output line into the normalized live sample the monitoring
    /// loop records. The default handles the JSON-line format the current helper emits; a backend
    /// with a different wire format overrides it. Byte-identical to the inline `serde_json::from_str`
    /// it replaces — routed through the backend so the output format is the backend's concern.
    fn parse_sample(&self, raw: &str) -> Option<crate::monitoring::FpsSample> {
        serde_json::from_str(raw).ok()
    }
}

/// The only production capture backend today: the elevated ETW helper consuming DXGI present events.
/// Zero-sized — it holds no state; the elevated process lifecycle lives in `monitoring.rs`.
pub(crate) struct EtwDxgiBackend;

impl CaptureBackend for EtwDxgiBackend {
    fn id(&self) -> &'static str {
        ETW_DXGI_BACKEND_ID
    }

    fn capabilities(&self, capture_started_at: Option<String>) -> CaptureCapabilities {
        CaptureCapabilities::etw_dxgi(capture_started_at)
    }
}

#[cfg(test)]
mod capture_tests {
    use super::*;

    #[test]
    fn etw_dxgi_declares_only_app_fps_and_no_richer_metric() {
        // Task H guard: the current helper declares ONLY the metrics it truly captures. If a future
        // edit flips one of these `false` flags to `true` without the backend actually gaining the
        // metric, this fails — no session may claim a capability the ETW-DXGI path doesn't have.
        let c = CaptureCapabilities::etw_dxgi(None);
        assert!(c.supports_app_fps, "present-call counting IS app/submit fps");
        assert!(!c.supports_presented_fps);
        assert!(!c.supports_displayed_fps);
        assert!(!c.supports_frame_type);
        assert!(!c.supports_generated_frames);
        assert!(!c.supports_gpu_busy);
        assert!(!c.supports_display_latency);
        assert!(!c.supports_input_latency);
        assert!(!c.supports_dropped_frames);
        assert!(!c.supports_gpu_telemetry);
        assert_eq!(c.backend_id, ETW_DXGI_BACKEND_ID);
        assert_eq!(c.backend_version, ETW_DXGI_BACKEND_VERSION);
        assert_eq!(c.methodology_version, METHODOLOGY_VERSION);
        assert!(!c.limitations.is_empty(), "an honest backend states its caveats");
    }

    #[test]
    fn etw_dxgi_graphics_api_excludes_vulkan_and_opengl() {
        let c = CaptureCapabilities::etw_dxgi(None);
        assert!(c.graphics_api.iter().any(|a| a.contains("11")));
        assert!(c.graphics_api.iter().any(|a| a.contains("12")));
        assert!(
            !c.graphics_api.iter().any(|a| {
                let a = a.to_lowercase();
                a.contains("vulkan") || a.contains("opengl") || a.contains("gl")
            }),
            "DXGI capture cannot see Vulkan/OpenGL — it must not claim them"
        );
    }

    #[test]
    fn shared_metrics_are_the_honest_intersection() {
        // Task H guard: two backends compare only common metrics. Same backend → its full metric set;
        // a richer future backend vs the ETW-DXGI helper → only the metrics BOTH captured (app_fps).
        let etw = CaptureCapabilities::etw_dxgi(None);
        assert_eq!(etw.shared_metrics(&etw), vec!["app_fps"]);

        let mut richer = CaptureCapabilities::etw_dxgi(None);
        richer.backend_id = "presentmon-2x".to_string();
        richer.supports_presented_fps = true;
        richer.supports_displayed_fps = true;
        richer.supports_gpu_busy = true;
        // Only app_fps is common; the richer backend's extra axes are NOT offered for comparison
        // against the ETW helper that never captured them.
        assert_eq!(etw.shared_metrics(&richer), vec!["app_fps"]);
        assert!(!etw.same_method_as(&richer), "different backend id → not the same method");
        assert!(etw.same_method_as(&etw));
    }

    #[test]
    fn capabilities_roundtrip_through_serde() {
        // Task H guard: new capability fields persist and reload byte-for-byte.
        let c = CaptureCapabilities::etw_dxgi(Some("2026-07-18T00:00:00Z".to_string()));
        let json = serde_json::to_string(&c).unwrap();
        let back: CaptureCapabilities = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn backend_reports_its_stable_id_and_capabilities() {
        let b = EtwDxgiBackend;
        assert_eq!(b.id(), ETW_DXGI_BACKEND_ID);
        assert_eq!(
            b.capabilities(Some("t".to_string())),
            CaptureCapabilities::etw_dxgi(Some("t".to_string()))
        );
    }

    #[test]
    fn shared_metrics_is_empty_when_backends_share_nothing() {
        // Task H guard: a future backend that captures NONE of the same axes must offer nothing for
        // comparison — an empty intersection, never a fabricated shared metric.
        let mut disjoint = CaptureCapabilities::etw_dxgi(None);
        disjoint.backend_id = "hypothetical-disjoint".to_string();
        disjoint.supports_app_fps = false;
        disjoint.supports_gpu_telemetry = true;
        let etw = CaptureCapabilities::etw_dxgi(None);
        assert!(etw.shared_metrics(&disjoint).is_empty());
    }

    #[test]
    fn parse_sample_default_impl_parses_the_wire_format() {
        // The default `parse_sample` on the CaptureBackend trait is what the monitoring read site
        // actually calls for the live ETW helper — untested until now. Valid JSON round-trips.
        let b = EtwDxgiBackend;
        let raw = r#"{"pid":123,"process_name":"cs2.exe","fps":144.0,"avg_frametime_ms":6.9,
            "low1_fps":120.0,"frames_last_sec":144,"recent_frametimes_ms":[6.9,7.1,6.8]}"#;
        let sample = b.parse_sample(raw).expect("valid sample line parses");
        let rt = serde_json::to_value(&sample).unwrap();
        assert_eq!(rt["pid"], 123);
        assert_eq!(rt["process_name"], "cs2.exe");
    }

    #[test]
    fn parse_sample_default_impl_rejects_malformed_input() {
        // A malformed or partial line (e.g. a torn write, a future field-set the helper hasn't
        // caught up to) must yield `None`, never panic the monitoring read loop.
        let b = EtwDxgiBackend;
        assert!(b.parse_sample("not json").is_none());
        assert!(b.parse_sample("{}").is_none(), "missing required fields must not parse");
        assert!(b.parse_sample("").is_none());
    }
}
