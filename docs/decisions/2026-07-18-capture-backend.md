# Decision — Capture backend boundary & the road to richer frame metrics

- **Date:** 2026-07-18
- **Status:** ACCEPTED (foundation shipped this train; production backend UNCHANGED)
- **Scope:** Measurement Platform 2.0, Task D. Establishes `CaptureBackend` as a named boundary so the
  current ETW-DXGI helper is *one* implementation rather than the permanent, implicit definition of
  "a session", and records the honest evaluation of every candidate path forward. **This train does
  NOT switch the shipped backend.** The elevated ETW-DXGI helper (`fps.rs`) remains the sole
  production capture path, byte-identical to before.
- **Related:** `docs/METHODOLOGY.md` (2026-07-16) · `src-tauri/src/capture.rs` · `src-tauri/src/fps.rs`
  · LOCKED rules 1–2 (no kernel driver, no injection) in `CLAUDE.md`.

---

## 0. Context — what "a session" measures today, and why that was implicit

Every Compy session's frame numbers come from ONE thing: an elevated `compy.exe --fps-capture` child
that subscribes to the **Microsoft-Windows-DXGI** ETW provider and counts **PresentStart** events
(event ID 42 — the same present signal Intel PresentMon reads), keyed per `(process, swapchain)`.
That is the entire measurement contract, and until now it lived *only* as procedural code in `fps.rs`
+ the monitoring loop. Nothing in a saved session recorded **what that backend could and could not
measure** — so a surface could render an unsupported metric as a real `0`, and a future backend swap
would have silently changed the meaning of "avg_fps" across the history with no marker.

Measurement Platform 2.0 fixes that with two additive, honesty-first primitives (`capture.rs`):

- **`CaptureCapabilities`** — persisted per session; the explicit, honest answer to "what could this
  session actually measure?" (`supports_app_fps=true`, everything else `false` for ETW-DXGI).
- **`CaptureBackend`** — the trait the session lifecycle talks to, so the helper is swappable and a
  future backend simply declares richer capabilities.

### Honest capabilities of the ETW-DXGI backend (the ONLY production backend)

| Metric axis | Supported? | Why |
|---|---|---|
| App / submit FPS | ✅ | Present-*call* rate — the game's submission cadence. This is what we count. |
| Presented FPS | ❌ | Needs present-*completion* correlation across ETW providers (PresentMon's job). |
| Displayed FPS | ❌ | Needs the DWM/flip-queue scan-out signal. Not derivable from DXGI present alone. |
| Frame type (real vs generated) | ❌ | Needs the driver's frame-generation markers. |
| Generated-frame accounting | ❌ | Same. |
| Per-frame GPU-busy | ❌ | Needs the GPU work-graph provider (PresentMon 2.x / GPUView-class data). |
| Display latency | ❌ | Needs the present→photons chain. |
| Input latency | ❌ | Needs input-event → present correlation (or a hardware LDAT-class tool). |
| Dropped frames | ❌ | Needs present-completion + discard flags. |
| GPU telemetry (this backend) | ❌ | Compy DOES record GPU peaks, but from a **separate** sensor subsystem (ADLX/NVML), not this capture backend — so the capture descriptor honestly says `false`. |
| Graphics APIs observed | DX11 / DX12 only | Vulkan/OpenGL present through DxgKrnl, not DXGL/DXGI — invisible to this provider. |

This table IS `CaptureCapabilities::etw_dxgi()` in code. The Rust guard
`etw_dxgi_declares_only_app_fps_and_no_richer_metric` fails if anyone flips a flag without the backend
actually gaining the metric.

---

## 1. The boundary we shipped (and what we deliberately deferred)

The trait is intentionally **minimal** — it abstracts only the operations with a real present-day
consumer, to avoid abstraction theater (encoding a speculative process-control signature for a second
backend that does not yet exist):

```rust
pub(crate) trait CaptureBackend {
    fn id(&self) -> &'static str;
    fn capabilities(&self, capture_started_at: Option<String>) -> CaptureCapabilities;
    fn parse_sample(&self, raw: &str) -> Option<crate::monitoring::FpsSample> { /* JSON-line default */ }
}
```

Two REAL consumers today, both in the monitoring loop:
- `capabilities()` — stamped onto every saved session at finalize time.
- `parse_sample()` — the per-tick fps.json read now routes through the backend (byte-identical to the
  prior inline `serde_json::from_str`).

**Deferred until a second backend actually exists** (documented here so the deferral is a decision,
not an oversight): `start` / `status` / `stop` process-control. Today the elevated spawn/heartbeat/
kill lifecycle lives in `monitoring.rs` and is tightly coupled to the `--fps-capture` argv path and
the elevation boundary (owner territory). Abstracting it now would mean inventing a lifecycle shape to
fit a single implementation — the textbook definition of abstraction theater. When PresentMon (or any
second backend) is genuinely evaluated for shipping, the lifecycle methods get added to the trait with
two real implementations to shape them honestly.

---

## 2. Evaluation of the ten candidate items

### 2.1 PresentMon integration
Intel PresentMon (github.com/GameTechDev/PresentMon, **MIT**) is the reference implementation for
exactly the metrics we mark `false`: presented/displayed FPS, GPU-busy, dropped frames, and — via its
service — display & input latency and frame-type/frame-gen on supported hardware. **PresentMon 2.x**
restructured into a **service + a consuming API/SDK**, and this is the strongest candidate for Compy's
"richer backend". It reads the same DXGI present events we already read, plus additional providers we
don't. **Verdict: primary candidate, NOT yet integrated.** Documented as a candidate; nothing in this
train claims it is implemented. Integration is its own future train with its own mutation-free QA (it
is a read-only capture path, so it does not touch the LOCKED mutation boundary, but it DOES change the
privilege/redistribution posture — see 2.4/2.9).

### 2.2 Current-helper evolution
We could grow `fps.rs` itself to subscribe to more ETW providers (e.g. the DWM present-completion
path) to earn `presented_fps`/`dropped_frames` without a third-party dependency. **Verdict: viable for
a subset, high effort.** Present-completion correlation is precisely the hard part PresentMon exists to
solve; re-implementing it is a large, error-prone surface. Reasonable for ONE additional axis
(presented FPS) if we want zero new dependencies; not reasonable as a route to the full metric set.
Keeps the current privilege model and zero redistribution burden — its main attraction.

### 2.3 Sidecar replacement (replace our helper with a bundled PresentMon service)
Ship the PresentMon service as a sidecar and consume its stream instead of our own helper. **Verdict:
plausible eventual end-state, biggest blast radius.** It changes: the installed artifact set, the
privilege/install model (the service install), the redistribution/licensing footprint, and the
"verified zero-outbound" review surface (must re-confirm the service makes no network calls). Gated
behind a full security review + owner sign-off, exactly like arming any new boundary. NOT this train.

### 2.4 Licensing / redistribution
PresentMon is **MIT** — redistribution is legally clean with attribution. The real cost is
operational, not legal: bundling a service means signing it, installing it, and owning its update
cadence. Our current helper is *us*, already inside our own signed exe, zero extra redistribution.
**Verdict: no legal blocker; operational cost is the deciding factor**, which favors the
current-helper path until a metric we can't self-produce is genuinely product-critical.

### 2.5 Graphics APIs
Current backend: **DX11/DX12 only**. Vulkan and OpenGL present through DxgKrnl and are invisible to the
DXGI provider — so Vulkan titles (e.g. many modern engines, DXVK/Proton-style layers, id-tech, some
Source2 configs) record **no frames today**, and the capability descriptor honestly says so via
`graphics_api`. PresentMon's lower-level providers DO see Vulkan/OpenGL present. **Verdict: the single
biggest measurement-coverage reason to eventually adopt PresentMon.** Until then, `graphics_api` on the
session is the honest marker that a Vulkan session was un-measurable, never a fabricated `0 fps`.

### 2.6 Frame-generation metrics (frame type / generated frames)
FSR3 / DLSS-FG / AFMF insert generated frames. Counting present calls (what we do) blends real and
generated frames into one number with **no way to separate them** — a correctness landmine for any
"your fps went up" claim on an FG-enabled title. We mark `supports_frame_type` and
`supports_generated_frames` **false**, and `GameStateFingerprint` (Task E) records
`frame_generation_state` as **context** so a comparison can DECLINE rather than mis-attribute. Honest
frame-type separation needs the driver's FG markers — PresentMon-class data. **Verdict: do not claim
FG-aware measurement until the backend genuinely produces frame-type data.**

### 2.7 Latency metrics
Display latency (present→photons) and input latency (input→present) are entirely outside our present
counter. PresentMon's service can estimate them on supported setups; true click-to-photon needs
hardware (LDAT-class). **Verdict: `false` today, honest; a PresentMon adoption would earn the
software-estimated variants, clearly labeled as estimates, never as measured click-to-photon.**

### 2.8 HAGS behavior (hardware-accelerated GPU scheduling)
HAGS changes *how* frames are scheduled/presented and can shift the relationship between submit rate
(what we measure) and displayed rate. It does not break our present-call counting, but it is a
**comparability hazard**: a session with HAGS on vs off is not a clean isolated comparison of a single
tweak. **Verdict:** HAGS is (a) a known Compy applied-change → already tracked in the ledger and via
`active_compy_change_ids` on the fingerprint, and (b) a reason `SessionComparability` (Task F) flags
"some conditions changed" when it differs between two sessions. No backend change needed; it's a
context/comparability concern, handled there.

### 2.9 Privilege model
Current helper runs **elevated** (ETW real-time session consumption requires it) as a short-lived
child over the audited `--fps-capture` argv path — the elevation boundary is owner territory and
unchanged by this train. A bundled PresentMon **service** would run as a persistent elevated service:
a materially larger privilege surface and a new always-present process. **Verdict: the current
short-lived-elevated-child model is the more conservative posture**; any move to a persistent service
is a security-review + owner-sign-off gate, not an engineering default.

### 2.10 Migration / rollback (of the measurement layer itself)
This is a *measurement* layer, not the *mutation* layer — there is no Windows state to roll back. The
only migration concern is **data compatibility**, and it is handled additively: `capture_capabilities`
is `#[serde(default) Option<_>]`, so (a) every pre-2.0 session loads as `None` = honestly Unknown
(never back-filled to a fabricated "assume today's backend"), and (b) if a future backend produces a
different descriptor, old sessions keep their own honest descriptor and comparisons fall back to
`shared_metrics()` (the metric intersection). **Verdict: no rollback surface; forward/backward data
compatibility guaranteed by the additive-schema contract + its load test.**

---

## 3. Decision

1. **Ship the boundary, keep the backend.** `CaptureBackend` + `CaptureCapabilities` land now;
   ETW-DXGI stays the sole production backend, byte-identical.
2. **Record PresentMon 2.x as the primary future candidate** for the metrics we cannot self-produce
   (Vulkan/OpenGL coverage, presented/displayed FPS, GPU-busy, frame-type, latency) — documented as a
   candidate, never represented as implemented.
3. **Defer the spawn/status/stop trait methods** until a second backend exists to shape them honestly.
4. **Any backend swap is a gated train:** security review of the new privilege/redistribution/network
   posture + owner sign-off, exactly like arming any new boundary. Not an engineering default.

## 4. What would trigger revisiting this

- A product-critical Vulkan/OpenGL title where "no frames measured" is unacceptable (→ 2.5, strongest
  pull toward PresentMon).
- A frame-generation-heavy title where blended real+generated FPS actively misleads (→ 2.6).
- A latency-marketing surface that needs software-estimated latency (→ 2.7).

Until one of those is real and owner-prioritized, the honest, low-privilege, zero-redistribution
current helper — now properly *bounded and labeled* — is the right production backend.
