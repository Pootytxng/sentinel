# Design — Monitor restructure (rolling the Optimize pattern, tab #2)

**Date:** 2026-06-21 · **Status:** approved design (owner: Sessions-default) · **Next:** plan → build

## Context

Second tab in the app-wide restructure (the Optimize merge was the pattern-setter). Recon finding:
**you open Monitor after gaming to review your last session — but that debrief is buried at the bottom**,
below the live-monitor card and a config-heavy overlay panel (corner picker, density, backdrop) you set
once. The thing you want most is the hardest to reach. Same notion as the merge: simplified meaningful
context up front, rich detail accessible, the buried-but-important thing surfaced.

This is NOT a two-tab merge (Monitor is one surface, `Play.tsx`); it's a reorganization of one surface
into segmented peers + a hero, reusing the proven segmented-control pattern.

## Decisions (owner-approved)

- **Tab stays "Monitor."** A segmented control — **Sessions** (default) / **Live** — reusing the
  Optimize gliding-indicator styling for consistency.
- **Default = Sessions** (owner pick): you open Monitor to review the last game. Live is one tap away.
- **Sessions segment (the face):** the latest session **debrief as the hero** up front (game · verdict
  · avg FPS · 1% low · frametime · peak temp — a summary card), then the session list (rows expand
  in place into the full `SessionDebrief`, unchanged), then `SessionTrends` (Pro gate, unchanged).
- **Live segment:** the live monitor card (FPS/1%low/GPU temp/CPU + start-capture) + the overlay card
  with its **config collapsed to secondary** — only on/off up front; density / background / corner
  appear on an "Overlay settings" expand (or when the overlay is on). Deep monitoring (memory, per-core)
  stays collapsed below.
- **Shared component:** extract the gliding segmented control from `Optimize.tsx`/`.css` into
  `src/design/SegmentedControl.tsx` (+ `.css`) so Optimize AND Monitor (and future tabs) use ONE
  measured-glide control — DRY, now that the pattern repeats (the Executor "don't pre-abstract" caveat
  is satisfied: we have the second consumer). Optimize refactors to it with NO behavior change.
- **Flag-gated** `compy_monitor` (default OFF until verified) — old Play surface fully intact + reachable
  via `compy_monitor="0"`. Reversible + A/B-able, same process as the merge.

## Information architecture — what maps where

`Play.tsx` gains a `view?: "all" | "sessions" | "live"` prop (mirrors Fix's `view`): `"all"` (default,
flag-off) = today's whole surface byte-identical; `"sessions"` = the debrief hero + session list +
trends; `"live"` = live monitor + overlay + deep monitoring. A thin Monitor shell (or Play itself when
merged) owns the SegmentedControl + the Sessions/Live state.

- **Sessions** (default): `LiveCharts` is NOT here (it's live data); the **last-session summary card**
  (new, derived from `sessions[0]` — the same fields the rows already show, promoted up front) → the
  Recent-sessions list (in-place `SessionDebrief`, unchanged) → `SessionTrends`.
- **Live:** `LiveCharts` (dashV2) → live monitor card → overlay card (collapsed config) → deep
  monitoring. The live sensor poll stays gated on the tab being active (unchanged).

## Styling — reuse, don't reinvent

The shared `SegmentedControl` carries the gliding accent indicator (measured glide) + tactile press +
the restrained glow the owner tuned. Token-driven (recolors per theme), motion-gated
(`:root[data-motion="reduced"]`), no shimmer/sheen. The Monitor face inherits the same premium-but-calm
feel; no new V0 spend needed (the pattern is set).

## Build sequence (flag-gated, reversible)

1. **Extract SegmentedControl** from Optimize → `src/design/SegmentedControl.tsx` + `.css`; refactor
   Optimize to consume it (behavior byte-identical, all Optimize tests still green).
2. **Shell (no restyle):** `Play` gains the `view` prop; a Monitor shell renders the SegmentedControl
   (Sessions default / Live) + the last-session hero card + composes `Play view="sessions"` /
   `Play view="live"`. Behind `compy_monitor`. Verify: flag flips it; sessions/live/overlay/capture all
   still work; tests + tsc green.
3. **Flip + integrate:** default `compy_monitor` ON; repoint any copy; tests, guards, /check, /security.

## Reversibility & safety

`compy_monitor` default OFF until verified; old Play intact until flip. **Zero new IPC** (all the same
existing sensor/overlay/capture commands), no mutation/rollback changes (Monitor is read-only/advisory
+ overlay config), locked gates untouched. Revert = flip the flag / drop the branch.

## Out of scope

The other tabs (Home, Blackbook, Lab) — each its own spec when reached. Blackbook + Lab the recon found
already close to clean (polish, not restructure). Any new session metric (the hero uses existing fields).

## Council strip — Monitor restructure · 2026-06-21

- 🟡 Contrarian: Sessions-default hides the LIVE readout a "Monitor" implies → mitigated: Live is one
  tap + could auto-surface when a game presents (future); owner chose Sessions (post-game is the common
  visit). Accepted.
- First-Principles: the buried debrief IS the job-to-be-done → hero-card surfaces it. ✓
- Expansionist: the last-session hero card is where a future "share this session" / receipts card lives
  (accommodated, not built).
- Outsider: "Sessions / Live" read clearly (no jargon); the overlay-config collapse removes first-glance
  clutter. ✓
- Executor: extract SegmentedControl now (second consumer exists) but otherwise reuse — no new styling
  spend; shell-first, flag-gated. ✓
- Chairman: sound + reversible; the one tension (Sessions vs Live default) is the owner's call (made).
  Next → writing-plans.
