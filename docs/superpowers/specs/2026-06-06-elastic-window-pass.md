# Elastic Window Pass — the app adapts to any window shape

*2026-06-06, Cowork, owner-requested. The owner multitasks with many small windows scattered
across two monitors and loves apps that "adapt structure as the window is dragged and stretched
erratically." Live specimens from his narrow-window screenshot: rail items wrapping two-per-row
(Play+Fix sharing a line), the hardware subtitle breaking mid-token ("16 / threads · 31 / GB"),
the greeting colliding with the Re-run button, ring/cards not re-stacking. This pass makes every
surface fluid from a defined floor to ultrawide. CSS-first; zero new IPC.*

---

## 1. Layout modes (by available width — container queries preferred, media queries acceptable)

- **Wide (≈ ≥1080px):** current layouts as designed.
- **Medium (≈ 720–1080px):** content drops to single column (cards stack full-width); rail keeps
  icon + label; stats rows wrap as a 2-col grid; paddings tighten one step.
- **Narrow (< ≈720px):** the rail collapses to an icon-only strip **with the wayfinding law
  amended, not broken:** the current room's NAME renders persistently in the content header
  (you always know where you are), and collapsed rail items get hover/focus tooltips. NEVER
  the wrap-into-rows failure from the screenshot — the rail either fits or collapses, no
  in-between mangling.
- Transitions between modes must be calm (no layout "pop" storms while dragging) — instant
  reflow is fine; animated reflow is not required and must respect reduced-motion if used.

## 2. Fluid rules (apply everywhere)

- **No horizontal scrollbar at any width ≥ the floor. No clipped/overlapping text, ever** —
  the greeting/button collision class of bug dies.
- **Tokens never break internally:** spec-pairs like "16 threads", "31 GB", "250 Hz", game
  names, and stat+unit pairs wrap BETWEEN tokens (white-space: nowrap per token; the line
  wraps at separators "·").
- Typography + key paddings move to `clamp()` ranges; the posture ring scales (already must
  not clip its subline — that law extends to all widths).
- Grids use `repeat(auto-fit, minmax(...))` so card rows discover their own column count.
- Charts/walkthrough stages/scan visuals: max-width 100%, scale or compress gracefully.
- Overlay window is OUT of scope (own window, own law).

## 3. Window floor (the defined worst case)

Set `minWidth`/`minHeight` in `tauri.conf.json` (window block ONLY — no other config drift):
recommend **≈ 380 × 560** — small enough for a true side-strip companion window, large enough
that every room stays honest. Every surface must be USABLE at the floor: all six rooms
reachable, scan runnable, a rec appliable, a debrief readable.

## 4. Multi-monitor / DPI sanity

Owner drags across two monitors (possibly different scaling). Verify: no blurry text, no
layout jump, no stuck sizes after crossing DPI boundaries (WebView2 largely handles this —
verify, don't assume; note any Tauri-side caveat found).

## 5. Acceptance

## 6. REOPENED — owner drag-test FAILED (2026-06-06, post-`ea62670`)

Owner verdict from the live drag-test: **"terrible snapping, all hugging to one side, forcing
itself into a shape that doesn't match the window size — less malleable than before."** The
pass does not ship (installer rebuild POSTPONED) until this is fixed and re-blessed live.

Fix directions (diagnose, don't assume — but check these first):
- **One-side hugging:** capped containers missing centering (`max-width` without
  `margin-inline: auto`) — content pins left in the gap between breakpoints.
- **Shape ≠ window:** competing responsive systems — shell-level viewport media queries AND
  CommandCenter-internal breakpoints firing on different widths (window vs content-area minus
  rail). UNIFY: one source of truth — container queries on the content area preferred;
  whichever is chosen, only ONE system decides layout.
- **Snapping:** too many discrete mode jumps. Breakpoints exist ONLY for the rail collapse;
  everything else must be genuinely liquid (auto-fit/minmax grids, flex-wrap, clamp()) so
  width changes produce smooth reflow, not lurches.
- **Hardware cards (owner insight):** 5 cards can't tile symmetrically at any column count.
  (a) Add a 6th card — **Network**: the named PHYSICAL adapter + state from the detection
  train (data already exists via existing commands; zero new IPC). (b) Make the glance grid
  COUNT-AGNOSTIC regardless: orphan cards span gracefully (designed wide-card, never a ragged
  dangler) — rigs vary, so any count must look intentional.

Re-acceptance: the owner repeats the erratic drag-test live and blesses the FEEL — plus:

- [ ] Resize storm: drag from floor → ultrawide and back, erratically — no horizontal
      scrollbar, no clipped/overlapped text, no rail mangling at ANY width.
- [ ] No one-side hugging at ANY width (content centered in its lane between breakpoints).
- [ ] Layout shape always matches the actual window (one responsive system, verified).
- [ ] Hardware glance: 6 cards incl. Network (named adapter); orphan-graceful at every
      column count.

## 7. Narrow nav v2 — the dots verdict (owner re-drag-test, 2026-06-06)

Re-test verdict: **"feels great"** — except the narrow collapse, where the rooms compact into
"~7 dots" (anonymous icons). That fails the doorknob law (doors without names or knobs) and
leans on tooltips (hover-discovery) — retired.

**Fix: the narrow icon-only rail/strip is REPLACED by a bottom room bar** (phone pattern):

- ≤ narrow breakpoint: six equal-width cells — icon (~18px) ABOVE its room name (≥10.5px,
  always visible). The six names are all ≤5 letters; at the 380px floor that's ~62px per
  cell — fits by design.
- Active room: accent tint + emphasized label. Cells are self-evidently tappable (it's a
  labeled tab bar — the knob is the form itself).
- Settings stays as the gear in the top header (it's not a room); back/export unaffected.
- The persistent room-name header strip RETIRES in this mode (labels make it redundant).
- Reduced-motion: no slide/bounce; instant state.

Re-acceptance: at the 380×560 floor every room name is readable and tappable, the active room
is obvious, zero anonymous dots anywhere, and the owner re-drags and blesses the feel.

## 8. Rail mis-render at medium width — the "stray tile" was nav.rail (owner Inspect, 2026-06-06)

The reported floating "icon tile" on Check is `<nav class="rail">` itself, collapsing to a small
orphaned box at MEDIUM width (the gap between the wide vertical rail and the <720 bottom bar) —
the six nav glyphs squish into a square that reads as a stray mark. DOM: `main.app > div.shell
(flex) > nav.rail + div.content`. The medium-width rail mode (intended: horizontal icon+label
strip across the top of the content) isn't taking — the rail shrinks to content instead of
laying out as the strip.

Fix: close the breakpoint gap so the rail is ALWAYS exactly one of its three intended forms —
wide vertical column · medium horizontal strip · narrow bottom bar — with NO width producing a
shrunk box. Likely: the medium strip needs explicit full-width + horizontal flex direction (the
shell's flex-direction switch and the rail's own layout must agree at the same breakpoint).
Verify by dragging slowly through the wide→medium→narrow boundaries — the rail transforms
cleanly at each, never collapses to a tile at any intermediate width.

- [ ] No width (floor→ultrawide, dragged slowly through every boundary) renders the rail as an
      orphaned box; it's always column / strip / bottom-bar, transitioning cleanly.
- [ ] All six rooms + Settings usable at the 380×560 floor (walk each, act in each).
- [ ] Narrow mode: icon-only rail + persistent current-room name + tooltips (wayfinding law
      amendment honored — no mystery icons without a location indicator).
- [ ] Mid-token breaks: grep/visual sweep confirms spec-pairs wrap only at separators.
- [ ] Cross-monitor drag: crisp text, stable layout on both monitors.
- [ ] CSS-first diff (tauri.conf window block exempt); zero new IPC; guards + tests green;
      reduced-motion clean.
