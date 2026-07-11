# Monitor v4 — "Session Waterfall" (concept B refined into the working hero)

> **✅ RESUME NOTE RESOLVED 2026-07-11:** the readability rework below is COMMITTED (`082414c` +
> `915cb96` middot legend fix), full vitest 1320/167 green, own-eyes iterated on the live dev
> instance (Compare + Now both read clean), fresh full self-review round **PASS**, rebuilt +
> ship-reinstalled (installer `C2E0FF70…3E90238`, stamp-verified `915cb96`), RELEASE_STATE +
> UI_VISION §A0 item 2 corrected (the round-2 "PASS 8/8" claim amended — owner eyeball FAILED
> `85eb8c6`), bug→guard done (draw-density tests + self-reviewer real-density rubric law).
> **Open gate: owner eyeball round 2.** Historical note kept below.

> **RESUME NOTE 2026-07-11 (mid-train, working tree UNCOMMITTED — historical):** v4 shipped `85eb8c6`
> (installer `44610BF6…D370A30`, live) but the **owner REJECTED the eyeball — "this looks
> absolutely terrible … what a mess"**. Verified with my own eyes (real 5-session data): raw
> multi-hour timelines drew as smears, dip pins as a barcode, legend printed over chart ink,
> "Live|Sessions" duplicated the room's segment labels. The round-2 self-review PASS was WRONG
> on readability — treat "PASS on fixture-scale data" as insufficient. **Fixes ARE CODED in the
> working tree (uncommitted):** `waterfall-profile.ts` (+`downsampleTimeline` min-per-bucket
> ≤160 real samples · `MAX_LAYER_PINS=3` worst-pin caps · `layerAlpha`), `SessionWaterfall.tsx`
> (LIFT 30/SCALE_STEP .08, back baselines dropped, legend moved OUT of the stage with alpha
> swatches, modes renamed **Now/Compare**), `monitor-console.css` (legend flow row, stage 300px),
> tests updated+green (tsc 0; touched suites 131 pass; full vitest NOT yet re-run). **Next:**
> (1) full `npx vitest run`, commit; (2) OWN-EYES check via dev instance (dev-relaunch was
> launching with CDP 9333; capture Monitor→Compare with real data via `docs/ui-sweep/cdp-shot.mjs`,
> ACTUALLY LOOK, iterate until it genuinely reads clean); (3) re-dispatch self-reviewer (full
> fresh round); (4) rebuild + `pwsh scripts/ship-reinstall.ps1` + stamp verify; (5) docs:
> RELEASE_STATE new banner + UI_VISION §A0 item 2 correction (the "PASS 8/8" claim must be
> amended — owner eyeball FAILED it); (6) guard-forge note: fixture-blind visual QA is the
> defect class — density guards now automated (`MAX_DRAW_POINTS`/`MAX_LAYER_PINS` pins in
> `waterfall-profile.test.ts` "draw-density discipline" block).

**Entry gate: CLEARED 2026-07-10.** Owner verdict on concept round 2 (Artifact `a8e6acf7…`),
verbatim:

> i really like the concept for B and how the previous sessions or added in visual context i also
> like how you can drag and segment a specific area on the scanline in A. id like to see a more
> refined version focusing towards the B concept and leaning more into the previous session
> comparison which could have many ways of being beneficial for users trying to do exactly that. i
> want you to spend time really refining that as a working implementation and making it more
> comprehensive nisually and systematicaly

Decomposed (none may be dropped): **(1)** B "Depth Waterfall" is the direction — depth axis = time,
front trace flat + readable; **(2)** A's drag-to-segment (zoom a region of the scanline) folds INTO
the front trace; **(3)** LEAN INTO previous-session comparison — this is the feature, not garnish;
**(4)** refined + comprehensive, visually and systematically — this train takes the time.

The v3 ribbon is REJECTED (owner 2026-07-10, verbatim + failure diagnosis in UI_VISION §A0 item 2):
an extruded mound with no axis — unreadable. Root lesson for v4: **3D may only ever be
presentational depth BEHIND a flat, axis-anchored readable layer. Nothing readable is ever warped.**

## Honest data inventory (verified at source, 2026-07-10)

| Data | Where | Shape | Verified |
|---|---|---|---|
| Live per-frame frametimes | `fps.rs` `recent_frametimes_ms` | last **240** frames (ms), oldest→newest, per report tick | `fps.rs:176,191-194` |
| Per-session per-second timeline | `sessions.rs` `stutter_timeline` | `Vec<(elapsed_secs, 1%-low fps)>`, kept for the **most-recent 5** sessions, stripped older (`sessions.rs:194-196`) | `sessions.rs:60-63` |
| Per-session dip signals | `sessions.rs` `stutter_events` | `{at_secs, kind, label}` (`stutter.rs:12-15`) | same |
| Session aggregates | `SessionSummary` | avg_fps · avg_frametime_ms · low1_fps_est · duration · process_name · started_at · **compy_changes_active** | `sessions.rs:36-66` |
| FE availability | sessions already cross IPC with the timeline fields (fixture `src/data/sessionTrends.test.ts:21-22`) | — | ✓ |

**Zero new IPC. Zero src-tauri.** Everything above already reaches the frontend via the same
audited read-only polls/commands MonitorConsole uses today.

## Design — one waterfall, two modes (units NEVER mix in one scene)

Hero replaces the deleted ribbon on the console face (same flag `compy_monitor_console`, DEFAULT
OFF). A small segmented control picks the mode:

### Mode LIVE — "this session, receding" (axis: frametime ms)
- **Front layer** = the real `recent_frametimes_ms` window: flat 2D scope, real ms axis, dashed
  budget line at `1000/refreshHz`, **exact-moment spike markers** (existing `spikeIndices`), area
  fill. This layer IS the Precision-Scope treatment.
- **A's segment interaction**: drag horizontally on the front trace → zoom that region (window
  narrows), double-click → reset; hover scrubs a crosshair with `ms · fps · SPIKE` readout.
- **Depth layers** = earlier snapshots of the SAME capture, buffered client-side: every N seconds
  (N ≈ window span) the current front window pushes back one step; keep ≤6 layers. Spike pins
  persist on receding layers. Honest: same measured stream, no synthesis; buffer clears when
  capture stops (never frozen-as-live — the v2 contract).
- Mouse-move tilts the stack (presentational parallax ONLY on depth offsets, never on the front
  layer's y values). `reduced` ⇒ no tilt, layers static, no sweep.

### Mode SESSIONS — "compare your last games" (axis: 1%-low FPS)
The lean-in. Depth layers = the last ≤5 sessions' real `stutter_timeline` series, most recent in
front, each normalized to elapsed-time on x (label carries true duration).
- **Layer labels** (mono micro-label at each layer's left edge): `process_name · started_at
  (relative: "yesterday") · avg fps`. Hover a layer → it lifts to full opacity + its readout row
  shows avg FPS / 1% low / duration / spikes-equivalent (dips).
- **Dip pins**: `stutter_events` at their exact `at_secs` on their own layer, with the real label
  ("OneDrive.exe starting") in the hover readout — measured forensics, already computed.
- **Delta strip** (front vs the previous comparable session): `AVG FPS +7 · 1% LOW +4 ·` — computed
  from the two structs, em-dash when either side is absent. If ≥2 layers share `process_name`, a
  "same game only" toggle filters to them (THE comparison a user actually wants).
- **Compy-context tag**: a layer whose session ran with `compy_changes_active > 0` gets a quiet
  `N COMPY CHANGES ON` tag — honest before/after context (receipts-adjacent, no claims, just the
  recorded fact).
- Empty states: 0 sessions ⇒ honest "no sessions on record yet — play with capture on"; sessions
  whose timeline was stripped (>5 back) simply don't appear as layers (the Sessions face still
  lists them); 1 session ⇒ single layer + "one more session unlocks comparison".

### Rendering: 2D canvas, NOT r3f
The mock proved the look needs only a perspective projection. 2D canvas: dodges the demand-canvas
repaint class outright (the v3 bug), drops the lazy 890 kB r3f chunk from this face, and redraws
only on data/pointer change. DPR-scaled, token inks only (trace/spike/budget from CSS vars), vendor
purple can never paint.

## Tasks (TDD, subagent-driven where the law routes)

1. **T1 `waterfall-profile.ts`** — pure module: layer projection math, zoom windowing
   (`zoomWindow(buf, sel)`), dip/spike index derivation for both modes, delta computation,
   same-game grouping, relative-date label. Full vitest truth-tables (empty/1-session/stripped/
   mixed-game/absent-aggregates).
2. **T2 `SessionWaterfall.tsx` + CSS — LIVE mode**: canvas render (front scope + receding
   snapshots), scrub/drag-zoom/dblclick/tilt pointer layer, spike pins, honest empties,
   reduced-motion still. Content-stable redraw guard (reference-identity on equal polls — the v3
   bug→guard class, pinned).
3. **T3 SESSIONS mode**: timeline layers + labels + dip pins + delta strip + same-game toggle +
   compy-context tag. Guards: never-mix-units pin (mode ⇒ single axis), fabricated-zero
   truth-table (absent ⇒ em-dash/NOT-YET), stripped-timeline exclusion.
4. **T4 assembly**: MonitorConsole hero = SessionWaterfall; **DELETE `FrametimeRibbon.tsx` +
   `ribbon-profile.ts` + their tests** (rejected UI dies, per the Lab precedent); readouts strip +
   overlay control + capture toggle untouched; flag-off byte-identity re-pinned BOTH
   `compy_editorial` states; `holo-shell-blink-guard` unaffected (no HolographicMaterial here).
5. **T5 finalize**: full tsc/vitest · `git diff -- src-tauri` EMPTY · self-review (dispatch
   self-reviewer; GL/repaint probe replaced by a canvas-redraw-count probe: idle flat on
   content-equal polls, redraw on real change, tilt only on pointer) · ship-reinstall + stamp
   verify + RELEASE_STATE row + UI_VISION §A0 item 2 status.

## Exit checks
- Owner's four decomposed asks each demonstrably present (map them in the report).
- Header-slop/title laws untouched; consumer readouts stay (MAX FPS · AVG FPS · LOWEST LATENCY ·
  SPIKES).
- Flag stays DEFAULT OFF — owner eyeball (ideally mid-capture AND with ≥2 recorded sessions) is
  the next gate; default-ON only on his verdict.
