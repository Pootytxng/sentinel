# Stutter Forensics — design note (for owner review)

**Status:** proposal. No code until approved (Wave-2 #4 gate).
**Goal (owner's words):** in the session debrief, surface the session's worst frametime dips and
correlate them — read-only — against signals already plausibly observable (process starts, GPU clock
drops, RAM pressure). Output stays **max-one-insight**, hedged: *"your 3 worst stutters lined up with
OneDrive.exe starting"* — never "caused."

---

## The key finding: we don't yet collect the data this needs

Stutter Forensics can't be built on what sessions store today. Two gaps:

1. **No per-session frametime timeline.** `SessionSummary` keeps only aggregates (avg FPS, a 1%-low
   *estimate*, peaks). To mark "the worst dips" and *when* they happened, we must retain a timeline
   (timestamped frametimes, or per-second worst-frametime) for the session's duration.
2. **No timestamped signal log.** The CPU/GPU/RAM pollers cache the *current* value at 1 Hz; nothing
   records "process X started at t" or "RAM crossed 90% at t" during the session.

So this feature is mostly a **read-only data-collection** task + a pure correlation core, not just a
UI add. That's why it's gated.

## Proposed data model (additive, bounded, read-only)

While a monitoring session is active, accumulate (and persist on finalize, capped):
- **Frametime timeline** — per-second `{ t, worst_frametime_ms }` (1 sample/s; a 1-hour session =
  3600 samples ≈ trivial). The ETW FPS helper already sees per-present frametimes; we keep the worst
  per second.
- **Signal events** — a capped list (≤ ~50) of `{ t, kind, label }`:
  - `process-start` — diff the running-process name set each second; log newly-appeared names.
  - `ram-pressure` — log when used-RAM crosses the tight/critical thresholds (we already compute these).
  - `gpu-clock-drop` — log a sharp graphics-clock drop (throttle signal) from the GPU poller.

Stored as additive `#[serde(default)]` fields on `SessionSummary` (old sessions parse as empty).

## Correlation method (pure, unit-testable core)

1. **Worst dips:** take the top-N seconds (N=3) by worst-frametime, but only those *meaningfully*
   bad — frametime > **2× the session median** — so we never "explain" ordinary variance.
2. **Line-up:** for each worst dip, find signal events within **±W seconds** (propose **W=2**).
3. **Emit one insight** only if **≥2 of the worst-3** dips line up with the *same* signal
   (e.g. the same `process-start`). Otherwise emit nothing (max-one, omittable — never manufactured).
4. Copy is hedged + names the count + the signal: *"2 of your 3 worst stutters lined up with
   OneDrive.exe starting."* Never "caused," never blames a vendor.

## Open decisions for you

1. **Sampling granularity** — per-second worst-frametime (cheap, proposed) vs. finer per-present
   retention (more precise dip localization, more memory). Start at 1 Hz?
2. **Always-on process polling while monitoring** — catching process *starts* needs a per-second
   name-set diff for the whole session (a small constant cost, only while you've opted into
   monitoring). OK, or sample slower (risks missing short-lived starts)?
3. **Thresholds** — correlation window ±2 s, "meaningful dip" = >2× median, min line-up = 2-of-3.
   Tune any of these?
4. **Signal set v1** — start with `process-start` + `ram-pressure` (cheapest, highest-signal), add
   `gpu-clock-drop` if it proves useful? Or all three from the start?
5. **Storage** — cap the timeline (e.g. last 3600 s) + events (last ~50) on `SessionSummary`. Good,
   or a separate side-file per session?

## Honest-language rules (non-negotiable)
- "lined up with" / "coincided with" — **never** "caused."
- Emit only on a clear pattern (≥2-of-3 within window); otherwise stay silent.
- Name the signal + the count; let the user draw the conclusion.
- One insight max — the strongest pattern only.

## Scope guardrails
Read-only; no new mutation surface; no gates touched. The insight slots into the debrief's existing
max-one-insight position. Phase A = collection + correlation core + the single insight; the
collection (monitoring-loop touch) is the heavier half.

---

**Recommendation:** approve thresholds #3 + signal-set #4 (the only real judgment calls), and I'll
build it pure-core-first (testable correlation) behind the data collection.
