# Monitor v5 — "Flight Deck + Session Stack" (concept round 3 pick, owner 2026-07-11)

> **Entry gate: CLEARED.** Concept round 3 Artifact
> <https://claude.ai/code/artifact/9ebf6305-e488-422d-b699-0c281b15676c> — owner reacted "ooooo ya
> i like the mockups you sent me" and picked **"A's top + B's stack"** via the pick prompt
> (2026-07-11): Flight Deck's live half on top, Session Stack's flat same-axis comparison as the
> sessions half. This replaces the REJECTED v4 Session Waterfall (round-2 verdict, verbatim in
> UI_VISION §A0 item 2: "doesnt seem to be working out like i presumed … maybe just re work the
> whole thing to something else thats more likely to be comprehensive").
>
> **Chain law learned across v3→v4:** no depth/perspective over data ink, ever again on this face.
> Everything is flat 2D with real axes; "3D/parallax un-banned" stays true app-wide but this room
> earns intuition with plain idioms.

## Shape (same flag `compy_monitor_console`, DEFAULT OFF; zero new IPC, zero src-tauri)

**One face, two halves — no Now/Compare mode toggle** (that duplication was a round-1 owner catch;
the halves are both always present, stacked):

1. **FLIGHT DECK (top, live):**
   - The existing full-width `Oscilloscope` frametime scope stays the hero: real ms axis, dashed
     1000/refreshHz budget line, exact-moment spike pins (top spikes print their ms), **hover
     scrub** (frame → ms → fps readout chip) and **drag-zoom** ported from the deleted waterfall's
     front trace (content-stable `ftWin` reference-identity guard carries over).
   - Readout strip unchanged: MAX FPS · AVG FPS · LOWEST LATENCY · SPIKES (`readoutStats`,
     em-dash never 0).
   - **NEW plain-number delta row** "VS YOUR LAST <GAME> SESSION": AVG FPS ▲/▼ · 1% LOW ▲/▼ ·
     SPIKES ▲/▼ · "N Compy changes on" tag. Same-game prior preferred; cross-game fallback labeled
     "DIFFERENT GAME" (reuse the v4 delta logic — it survived review, only its canvas died).
     Renders nothing without a prior (honest empty).
   - Overlay toggle + corner picker stay on the face (ported verbatim, again).
   - Capture stopped ⇒ scope clears (never frozen-as-live), delta row keeps the last COMPLETED
     session's debrief framing (it's session-scoped, not live-scoped).

2. **SESSION STACK (below, comparison):**
   - Each of the last ≤5 sessions = one flat row: meta (game · when · duration) | mini-canvas
     timeline | delta chip vs the PREVIOUS session ("VS PREVIOUS", ▲/▼ AVG, "DIFFERENT GAME" note
     when games differ).
   - **ONE shared 1%-low fps axis across every row** (global max over the set, tick lines
     identical) — a taller line is a better session anywhere in the stack. Axis note printed once
     under the stack.
   - Timeline = the session's real `stutter_timeline` through `downsampleTimeline` (the v4
     draw-density guard `MAX_DRAW_POINTS` applies per row); **one worst-dip pin per row** from
     `stutter_events` with its exact clock time label (`MAX_LAYER_PINS` collapses to 1-per-row
     here — keep the cap constant, value 1).
   - Same-game filter chip (ALL GAMES / <current game> ONLY). Click/Enter a row → inline detail
     line (AVG · 1% LOW · SPIKES · worst dip time · changes-on tag). Newest row inked accent,
     older rows muted.
   - Honest empties: 0 sessions ⇒ the stack renders the existing no-sessions empty state; 1
     session ⇒ row renders, no delta chip.

**DELETE `SessionWaterfall`** + its CSS + waterfall-only guards (re-anchor the ones that pin
still-live logic: delta labeling, downsample, draw-density → they move to the stack/deck modules).
`waterfall-profile.ts` pure helpers that survive (downsample, delta, pin selection) migrate to a
renamed pure module (`monitor-stack-profile.ts` or fold into `monitor-console-data.ts`) — tests
move with them, byte-logic unchanged.

## Tasks (TDD, one commit each)

- **T1 — pure data:** `stackRowsFrom(sessions)` (shared-axis max, per-row downsampled points,
  worst-dip pin + time, vs-previous deltas w/ DIFFERENT-GAME flag, same-game filter) +
  `deckDeltaFrom(sessions, currentGame)` (the Flight-Deck delta row model). Vitest truth-tables:
  empty/1-session/5-session, cross-game labeling, axis-max, density cap ≤ MAX_DRAW_POINTS.
- **T2 — `SessionStack` component:** canvas rows off T1 (token inks only), pin + time label,
  expand/collapse (keyboard too), filter chip, honest empties. Idle discipline: rows repaint only
  on content change (reference-identity guard, the v4 lesson).
- **T3 — Flight Deck assembly:** scope + scrub/zoom port, delta row, shelf REPLACED by the stack
  (the shelf and the stack are one surface — the stack IS the shelf), mode toggle REMOVED,
  SessionWaterfall deleted, flag-off byte-identity re-pinned BOTH `compy_editorial` states.
- **T4 — polish:** reduced-motion stillness, Crimson/Emerald token spot-checks, stage ≤ ~300px
  per half so the face fits 1500×980 without scroll-trap.
- **T5 — self-review (real-density law: REAL 5-session multi-hour data, not fixtures) → fix →
  re-review → ship-reinstall + stamp-verify + RELEASE_STATE/BACKLOG/UI_VISION/OWNER_CHECKLIST
  same-commit. Owner eyeball = the exit gate.

## Carried guards / laws

- Draw-density discipline (`MAX_DRAW_POINTS`, pin caps) — test-pinned, survives the rename.
- Reference-identity idle guard (1 Hz content-equal polls must not repaint).
- Flag-off byte-identity; honest empties; units never mix per scene; consumer terms verbatim on
  readouts, goal-register on chips; NVIDIA sensor honesty (rule 5) untouched.
- Zero new IPC — the same three 1 Hz read-only polls + the sessions the backend already sends.
