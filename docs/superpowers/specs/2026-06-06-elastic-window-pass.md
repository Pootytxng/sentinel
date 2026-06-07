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

- [ ] Resize storm: drag from floor → ultrawide and back, erratically — no horizontal
      scrollbar, no clipped/overlapped text, no rail mangling at ANY width.
- [ ] All six rooms + Settings usable at the 380×560 floor (walk each, act in each).
- [ ] Narrow mode: icon-only rail + persistent current-room name + tooltips (wayfinding law
      amendment honored — no mystery icons without a location indicator).
- [ ] Mid-token breaks: grep/visual sweep confirms spec-pairs wrap only at separators.
- [ ] Cross-monitor drag: crisp text, stable layout on both monitors.
- [ ] CSS-first diff (tauri.conf window block exempt); zero new IPC; guards + tests green;
      reduced-motion clean.
