# A4 Services — recovery-guide dependency ordering (read-only correctness fix)

**Lane:** backend · **Domain:** `src-tauri/src/services.rs` only · **Date:** 2026-06-25

## Problem (a real, reproducible bad experience)

The by-hand service **recovery guide** (`build_recovery_guide`) lists the drifted services in catalog
order and tells the user, for each, to set Startup type → Automatic and click **Start**. But within the
curated drift catalog there is one documented **start dependency**: Windows Audio (`Audiosrv`) will not
start unless Windows Audio Endpoint Builder (`AudioEndpointBuilder`) is started first — both are catalog
entries. If a "disable services for FPS" script switched BOTH off, a user following the guide
top-to-bottom hits "Windows Audio" first (it's listed before Endpoint Builder), clicks Start, and Windows
fails with *"a dependency service or group failed to start."* That confuses exactly the non-technical
gamer Compy serves, on a guide that is supposed to rescue them from a bad tweak.

## Fix (read-only, `services.rs` only — no mutation, no new IPC, no serde change)

1. Encode the single documented intra-catalog start dependency on the curated `DriftSpec`
   (`Audiosrv` → `AudioEndpointBuilder`). It is a **closed, curated, well-established fact** (Audiosrv's
   required services include AudioEndpointBuilder on every supported Windows) — NOT a live WMI dependency
   read, consistent with the closed-catalog charter.
2. Carry the prerequisite's friendly label onto `DriftFinding` as `requires: Option<String>` (additive;
   `DriftFinding` is internal `pub(crate)`, not serialized — diagnostics rebuilds its own entries).
3. In `build_recovery_guide`, when a drifted service's prerequisite is **also drifted**:
   - Order the prerequisite **first** in `services` + the "find the first of …" step (so the guide already
     points at the right one).
   - Insert ONE honest ordering step explaining *why* (start the prerequisite first, or Windows reports a
     dependency failure).
4. **Honesty:** the ordering note appears ONLY when BOTH the dependent and its prerequisite are drifted —
   never lecture about a dependency that is already fine. No promise, no alarm, no mutation verb (existing
   law guards extended to cover the new copy).

## Tests (bug → guard)

- `requires` populated: `Audiosrv` → `Some("Windows Audio Endpoint Builder")`; AudioEndpointBuilder / Themes → `None`.
- Both audio services drifted → recovery guide lists **Endpoint Builder first** + an ordering step that names
  both services and says the dependent **depends** on it.
- Only Windows Audio drifted (Endpoint Builder at stock) → **no** ordering step (don't lecture).
- Existing promise/alarm/mutation-verb law guard still passes over the new step copy.
