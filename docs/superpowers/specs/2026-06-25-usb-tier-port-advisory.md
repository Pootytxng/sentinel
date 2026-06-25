# USB-tier port advisory (peripheral lane, A4) — 2026-06-25

## Why
The peripheral lane's "USB-port recs" item had two halves:
- **SHARING half** — already ships (`shared_controller_advisory`): "your mouse shares a controller with a
  streaming device, move one off." Done.
- **TIER half** — this spec. Originally framed as "move a high-rate input off a USB 2.0 port." That exact
  framing is **not honestly buildable**: Windows can't tell us which physical port a device sits on, nor a
  device's negotiated speed, in user-mode. So the TIER half is reframed around the one honest signal that
  IS available: the platform's **top USB spec tier** (the backend's `detect_usb_top_spec()` cross-lane signal,
  landed `84a2af1`).

## The honest, hardware-tailored signal
`crate::hardware::detect_usb_top_spec() -> Option<String>` → `"USB4" | "USB 3.2" | "USB 3.1" | "USB 3.0" |
"USB 2.0"` or `None`. This is the platform **capability** (highest tier the host controllers support), **not**
per-device speed or which port a device uses. We surface it as `usb_top_spec` on `LatencyReport` and derive a
tailored note.

## The advisory — `usb_tier_advisory(top_spec, loads)`
Pure, read-only, in `latency.rs`. Returns `None` unless we know the tier AND at least one USB input device was
detected (else there's nothing peripheral-relevant to say — never fabricate).

- **USB 2.0-capped platform:** honest reassurance for input (a 1000 Hz mouse uses a sliver of USB 2.0
  bandwidth → polling rate is the SAME as on a USB 3 port), plus the one genuinely-actionable caveat: a
  bandwidth-hungry neighbour (USB audio / capture / webcam) sharing that lower-ceiling 2.0 bus has less
  headroom — give those their own controller. Names a real streaming neighbour when one is present.
- **USB 3.0/3.1/3.2/USB4 platform:** a **myth-buster** (Compy brand: out-credibles the tweak guides) — a
  faster USB port does NOT raise a mouse's polling rate; the same tiny reports flow on USB 2.0 or USB4, so
  don't hunt for "the fast port" for input. The extra bandwidth helps storage/capture/audio, not input.

Both close with the honest limit: tier is read from controller names; per-port placement/speed isn't readable
in user-mode.

## Boundaries
Read-only / advisory only. No mutation, no elevation, no network. Never claims which port a device is on, never
asserts a per-device speed. Complements (does not duplicate) `shared_controller_advisory` (sharing dimension) —
this adds the spec-tier dimension. Surfaced on `LatencyReport` (`usb_top_spec` + `usb_tier_advisory`) and the
Latency surface UI.
