# RELEASE_STATE.md — Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md banners, RELEASE_QA.md, PACKAGING_SIGNING_PLAN.md,
> GATE_DECISIONS.md) disagrees with this file about *current state*, **this file wins** — fix the
> other doc. Created 2026-06-26 in response to an external source-level audit that flagged
> state/documentation drift as the project's #1 risk. Keep it current: update it in the SAME commit
> that flips any gate, arms any feature, or rebuilds the installer. Every row carries a `file:line`
> so it can be re-verified in seconds, never asserted from memory.

## Snapshot

> **UPDATE 2026-07-11 (CONSUMER-PANEL OVERHAUL SHIPPED `50b5c03` — installer SHA-256
> `653FFEA0928E3372CA33ECB818EC6BF8A21B01CBB6A3B7250194DB5B3A9BADC2`, live exe stamp-verified
> `50b5c03` via the embedded hash, installed by Claude, supersedes the `3B3A65C4…B19DAD` installer;
> flag `compy_monitor_console` still **DEFAULT OFF**, v5 owner eyeball still ITS open gate):** the
> five-persona panel plan (`docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md` — Q1–Q4
> owner answers + per-item commit citations recorded in-file) built end to end. App: safe-stack
> caption is a state observation ("All N already on for this rig" — Phase 0 verified
> `currently_applied` is a live probe, `recommendations.rs:315`), VBS advisory reframed as a
> decision, Term glosses at first exposure (Home/Lab "1% low" gauges, ETW, frametimes; **Monitor
> jargon bucket deferred until the v5 eyeball settles**), readiness gauges state their formula
> ("= N of M checks passed"), NEW **TrustMoment** one-time watch-it-work loop (audited
> apply→rollback IPC only, ledger-empty gate, HKCU whitelist, consent-first), gaming recovery
> banner + pane card reframed protection-first ("Nothing's lost … kept the full restore receipt",
> calm tone — never-hide mechanism untouched). **Settings flag-debt sweep (Q2=A): 11 graduated /
> UI-inert toggle rows REMOVED** (Living Instrument, Guided Lab bench, Lab checkup bento, Lab
> proving ground, Instrument HUD, Home console, Setup stepper, First-check theater, Monitor summary
> cards, Hologram bay v2, Two futures split) — features unchanged, flags still honor localStorage
> via devtools; **the "Settings → Appearance row is the classic failsafe" lines in the 2026-07-10
> Home-console and Lab-ground banners below are SUPERSEDED — those failsafes are now
> devtools/localStorage-only.** "Monitor console (preview)" is the one remaining preview row. Site
> (dark, owner taste-gates before publish): hook kicker promoted to h1, "Compy is free." above the
> fold, proof-loop receipt = accessible hero visual (example-framed), start-here trio over raw
> counts, per-card one-line "Why:" (the tier now argues). Q3 = **proposal only, awaiting owner GO**
> (`docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`). Zero src-tauri. Self-review
> round 1 **FAIL — 4 real catches** (Term mixed-case in uppercase labels · tooltip shouting caps ·
> Lab tooltip 126px off-window · site h1 3-line wrap), all fixed + guard-pinned
> (`term-style-guard.test.ts`) → round 2 **PASS** (computed-style + line-box proofs). Verify:
> tsc 0 · vitest **1322** (167 files) · site-landing 15/15.
>
> **UPDATE 2026-07-11 (RTSS-style ZERO-ANCHORED frametime scale SHIPPED `915e85b` — installer
> SHA-256 `3B3A65C45C4BF63942373612CA19353EAFAB16CED10EE8A71F83143271B19DAD`, live exe
> stamp-verified `915e85b`, installed by Claude, supersedes the `0AA8E222…F21A55` installer;
> flag `compy_monitor_console` still **DEFAULT OFF**):** the owner REJECTED the envelope look
> on sight ("this is atrocious … research clean and comprehensive frametime graphs or just
> match riva tuners") — **envelope mode is DELETED** (band + median curve + note). Research
> applied (RTSS "graph max" / CapFrameX fixed y-range): the DeckScope frametime hero now draws
> the RAW per-frame line against a **stable zero-anchored ms scale** (`niceCap` frame-budget
> landmarks 8.3/16.7/25/33.3/50/100/250) with labeled quarter-cap gridlines + right-edge ms
> labels; axis states "0–\<cap\> ms scale · budget X ms". Root cause named: window-min/max
> normalization stretched ~3 ms of jitter to full chart height — the envelope had treated the
> symptom. fps + Home traces (default "window" scale) byte-same; `monotone.ts` stays
> (SessionStack rows). Verify: tsc 0 · vitest **1311** (165 files) · self-reviewer **PASS 8/8**
> (live real-density mount: calm line low on the chart, spikes tower, budget ≈14% up at
> 6.9/50, scrub raw-exact, zoom rescales zero-anchored, fps/Home unchanged).
> **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 scope ENVELOPE mode SHIPPED `e02d1ad` — installer SHA-256
> `0AA8E222755F082B7D75AF8EAEB3BA7A14DDFEFF97711C8483A456B319F21A55`, live exe stamp-verified
> `e02d1ad`, installed by Claude, supersedes the `05399D9D…EA7B7459` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner round-2 ask on the v5 eyeball ("make
> the lines not so tightly packed and erratic without … taking away from the accuracy … the
> transient spikes are just a little overbearing and chaotic") — dense frametime windows
> (≥120 samples) now draw a faint **min–max band** (each bucket's TRUE extremes, nothing
> clipped) under a **monotone median line** (the typical frame; the shared Fritsch–Carlson
> math extracted to `src/design/console/monotone.ts`, SessionStack refactored onto it). Spike
> markers, worst-spike callout, and scrub stay RAW per-sample; drag-zoom below 120 samples
> returns the raw polyline; caption states "line = typical · band = every frame". fps scope
> deliberately stays raw. Self-review round 1 **FAIL — real catch:** the median `<path>`
> escaped the non-scaling-stroke selector and rendered fat (the exact `f2acb23` class); fixed
> (`.osc-grid path` covered) + the line-discipline guard strengthened to require selector
> coverage of line/polyline/path → round 2 **PASS** (computed vectorEffect + side-by-side
> stroke-weight proof on a live real-density mount). New guards: `envelopeProfile`
> truth-table · dense⇒band+path+note w/ raw-exact spike x · sparse⇒raw · no-prop⇒raw.
> Verify: tsc 0 · vitest **1311** (165 files). **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 scope-line sharpening SHIPPED `f2acb23` — installer SHA-256
> `05399D9DE7B2601EC2080CADA2036351DC52D3946C4C3372A99F5290EA7B7459`, live exe stamp-verified
> `f2acb23`, installed by Claude, supersedes the `5AE1ED22…C7821236` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner quick-fix on the v5 eyeball ("lines
> need to just be sharpened and sleek no added bloom or saturation/thickness") — the Oscilloscope
> trace glow (drop-shadow of `--ix-accent-dim`, theme violet blooming around graded ink) is
> DELETED; every scope stroke wears `vector-effect: non-scaling-stroke` (the stretched viewBox
> no longer fattens strokes); trace 1.5→1.25px, ink/hue untouched. bug→guard "line discipline"
> test in `oscilloscope.test.tsx` (no drop-shadow declaration in live CSS · non-scaling-stroke
> present · trace ≤1.5px). Verify: tsc 0 · vitest **1307** (165 files) · self-reviewer **PASS
> 8/8** (computed `filter: none` both motion states on a live mount, zoomed crops halo-free).
> **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 trace-line refinement SHIPPED `e900b6a` — installer SHA-256
> `5AE1ED22BD308C4C877EF7D71155A65B77028736B7193C55E9197656C7821236`, live exe stamp-verified
> `e900b6a`, installed by Claude, supersedes the `A4D3BF98…D147E0` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner ask on the v5 eyeball ("clean up and
> refine how the actual line on the graph looks") — stack row traces now stroke a **monotone
> cubic (Fritsch–Carlson)** curve with round joins/caps (passes through EVERY real sample, never
> overshoots — smooths the min-per-bucket sawtooth corners, never the data; pin dot verified on
> the curve minimum) and the scope SVG traces gain round joins/caps, geometry unchanged. Guard:
> bezierCurveTo + round-join pin in `session-stack.test.tsx`. Verify: tsc 0 · vitest **1306**
> (165 files) · self-review **PASS** (zoomed real-data crops — no sawtooth, dips keep true
> depth). **⏳ OWNER eyeball still the open gate.**
>
> **UPDATE 2026-07-11 (Monitor v5 "FLIGHT DECK + SESSION STACK" SHIPPED `960734c` — installer
> SHA-256 `A4D3BF98DCE1CF57740C9163CF4393F5F7499168946630EA485D974706D147E0`, live exe
> stamp-verified `960734c` (embedded-hash proof), installed by Claude, supersedes the
> `C2E0FF70…3E90238` installer; flag `compy_monitor_console` still **DEFAULT OFF**):** the owner's
> round-3 pick **"A's top + B's stack"** built per plan
> `docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md` (T1–T5: `d06a63c` pure data ·
> `69c8f90` SessionStack · `255a400` Flight Deck assembly · `0c68553` polish · `960734c`
> coverage fix). ONE face, two halves, NO mode toggle: **Flight Deck** (consumer readouts ·
> `DeckScope` full-width frametime hero w/ hover scrub + nested drag-zoom + stated ms-span/budget
> · session-scoped plain-number delta row, cross-game labeled "(DIFFERENT GAME)", changes-on tag)
> + **Session Stack** (last ≤5 sessions as flat rows on ONE shared 1%-low axis, ONE worst-dip pin
> w/ exact clock time per row, VS PREVIOUS chips, current-game filter, expand-detail). The v4
> **SessionWaterfall + `waterfall-profile` are DELETED** (Now/Compare toggle gone; surviving
> guards re-anchored in `monitor-stack-profile.test.ts` / `session-stack.test.tsx` /
> `deck-scope.test.tsx`). Self-review round 1 **FAIL — the real-density law caught a real one**:
> the 10.5 h Sand session's timeline (backend-capped at ~2 h) drew as a sliver because row x
> normalized to `duration_secs`; fixed (`960734c`: rows draw the RECORDED span, partial coverage
> STATED — "first 2h 0m recorded" + detail-line note, pins only anchor inside coverage) +
> guard-pinned (coverage<<duration truth-table the old fixtures never exercised) → round 2
> **PASS 8/8 on the real 5-session data**. Flag-off byte-identity re-pinned BOTH
> `compy_editorial` states (`monitor-console-flag.test.tsx`). Verify: tsc 0 · vitest **1305**
> (165 files) · cargo **688**. **⏳ OWNER eyeball is the open gate** — Settings → Appearance →
> "Monitor console (preview)", both modes.
>
> **UPDATE 2026-07-11 (v4 waterfall READABILITY REWORK SHIPPED `915cb96` — installer SHA-256
> `C2E0FF709DDF65256E757E2D3903CCA133207DEB614B2C59A6AE5666C3E90238`, live exe stamp-verified
> `915cb96` (embedded-hash proof), installed by Claude, supersedes the `44610BF6…D370A30`
> installer; flag `compy_monitor_console` still **DEFAULT OFF**):** the owner REJECTED the
> `85eb8c6` waterfall on eyeball ("this looks absolutely terrible … what a mess") — the banner
> below's round-2 "PASS 8/8 against real production data" was WRONG on readability: real
> multi-hour timelines drew as smears, dip pins as a barcode, legend printed over chart ink,
> Live|Sessions duplicated the room's segment labels. Rework (`082414c` + `915cb96`):
> `downsampleTimeline` min-per-bucket ≤160 drawn samples · `MAX_LAYER_PINS=3` worst-dip caps ·
> `layerAlpha` ramp · legend moved OUT of the stage (alpha swatches, middot grammar) · back
> baselines dropped, LIFT 30/SCALE_STEP .08 · modes renamed **Now/Compare** · stage 300px.
> Bug→guard ×2: draw-density discipline pinned in `waterfall-profile.test.ts`
> (`MAX_DRAW_POINTS`/`MAX_LAYER_PINS`) + self-reviewer rubric gained the **real-density law**
> (fixture-scale PASS ≠ PASS). Verify: tsc 0 · vitest **1320** (167 files) · fresh full
> self-review round **PASS** (all items, real 5-session data, own-eyes iterated on the live dev
> instance first). **⏳ OWNER eyeball (round 2) is the open gate** — Settings → Appearance →
> "Monitor console (preview)", both modes.
>
> **UPDATE 2026-07-11 (Monitor v4 "SESSION WATERFALL" SHIPPED `85eb8c6` — installer SHA-256
> `44610BF6F168E83741DD04A9EBD24D14A566EB2828238B1AFB67B0647D370A30`, live exe stamp-verified
> `85eb8c6` (embedded-hash proof; owner queueing for a game, no CDP relaunch), installed by Claude
> on the owner's go while between games, supersedes the `33661b8` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** the owner's concept-round-2 pick (B "Depth
> Waterfall" + A's drag-segment, lean into previous-session comparison — verbatim in the plan) is
> built as the console hero, replacing the REJECTED v3 ribbon (**FrametimeRibbon + ribbon-profile
> DELETED**, r3f chunk gone from this face). `SessionWaterfall` (2D canvas, token inks): LIVE mode
> (ms axis) = flat front scope + dashed budget + exact-moment spike pins + drag-zoom/double-click
> reset + scrub readout, depth layers = receding snapshots of the SAME capture (cleared on stop,
> never frozen-as-live); SESSIONS mode (1%-low fps axis) = the last ≤5 sessions' real
> `stutter_timeline` layers, stacked legend labels, `stutter_events` dip pins with real labels,
> delta strip vs the same-game prior ("VS PREV SAND"; cross-game fallback labeled "DIFFERENT
> GAME"), same-game filter, "N COMPY CHANGES ON" context tag; honest empties throughout; units
> never mix per scene. Zero new IPC, **zero src-tauri** (diff-verified empty; `SessionSummary` TS
> type gained the timeline fields the backend already sent). Self-review round 1 **FAIL** (4 real
> catches: idle stopped polls churned a fresh [] reference → 1 Hz canvas repaints at rest;
> empty-scene hover repainted under reduced motion; legend overlap at the real 5-session history;
> bare cross-game delta read as a −216 fps regression) → all fixed + bug→guard-pinned in `85eb8c6`
> → round 2 **PASS 8/8** against real production data (idle 0 draws/12 s both modes). Verify:
> tsc 0 · vitest **1315** (167 files) · flag-off byte-identity re-pinned BOTH `compy_editorial`
> states (`monitor-console-flag.test.tsx`). **⏳ OWNER eyeball is the next gate** (Settings →
> Appearance → "Monitor console (preview)", ideally mid-capture AND with ≥2 recorded sessions —
> both modes; default-ON only on his verdict).
>
> **UPDATE 2026-07-10 (consumer-terms preset relabel SHIPPED `33661b8` — installer SHA-256
> `7C1EC6891F37BC3515AC05DD27C7E72FD4D3E63C860EF086B7BA7806113BB888`, stamp-verified LIVE `33661b8`,
> installed by Claude, supersedes the `6932fa7` installer):** UI_VISION §A0 item 6 closed — the
> Monitor tuning-preset trio the owner flagged ("Visual Fidelity / Smooth / Clarity") is now
> **"Max Quality" / "More FPS" / "Lower Latency"** (ids stable; labels test-pinned in
> `monitor-view.test.ts`). Chips are goal-register comparatives, deliberately NOT the console
> readouts' verbatim stat terms — self-review round 1 caught literal "Max FPS"/"Low Latency" chips
> rendering on the same screen as the measured "MAX FPS"/"LOWEST LATENCY" readouts; "High
> Resolution" not used (preset bundles HDR+VRR, nothing touches resolution — honesty rail; owner may
> overrule at eyeball). Also: RigViewer chromed hint → "hover or click a part" (§A.4 residual;
> reviewer finding logged — the chromed RigViewer path is currently unreachable dead code, cleanup
> is its own candidate). Verify: tsc 0 · vitest **1253** (166 files) · zero src-tauri ·
> self-reviewer round-2 **PASS 8/8**. **⏳ OWNER eyeball unchanged: Monitor console (preview)** —
> the same Monitor room now also shows the relabeled presets.
>
> **UPDATE 2026-07-10 (Monitor v3 "TELEMETRY RIBBON" SHIPPED `6932fa7` — installer SHA-256
> `E9737D6EE5E05E2CE210DE4000578507F5ACBEC4CDC3A074C4086351D832421E`, stamp-verified LIVE `6932fa7`,
> installed by Claude AFTER the owner's Palworld session ended (reinstall deliberately deferred
> mid-game); code-complete at `4c051e0`, `6932fa7` = docs-only on top; flag `compy_monitor_console`
> still **DEFAULT OFF**):** the owner rated the v2 cluster "satisfactory", gave binding direction
> (retained verbatim: `docs/UI_VISION_BACKLOG.md` §A0) and chose the **3D ribbon** concept. v3 =
> `Oscilloscope` v2 (full-width window — his caught half-width bug — dashed budget line at
> 1000/refreshHz, exact-moment spike markers via pure `spikeIndices`, worst-spike ms callout ONCE
> in the strip caption) + consumer-term readouts (MAX FPS · AVG FPS · LOWEST LATENCY · SPIKES,
> `monitor-console-data.ts`, em-dash never 0) + lazy r3f `FrametimeRibbon` hero (real per-frame
> extrusion, spike cones, budget plane, orbit, `frameloop="demand"`, mounts ONLY on a live window)
> + overlay toggle/corner ported verbatim + uniform stage tilt (depth never warps data ink — the
> direction spec's Monitor row carries the owner's 3D/parallax amendment). Self-review round 1
> **FAIL** (real catch: content-equal 1 Hz polls repainted the demand canvas — GL probe +8
> draws/tick) → fixed `4c051e0` (content-stable `ftWin` ref + reference-identity bug→guard) →
> round 2 **PASS 8/8** (idle flat 15s, repaints on real change, orbit animates). Verify: tsc 0 ·
> vitest **1252** (166 files) · zero src-tauri across the whole v3 train. **⏳ OWNER eyeball is the
> next gate** (Settings → Appearance → "Monitor console (preview)", ideally mid-capture — the
> ribbon needs live frames). Residual (explicit): overlay density/backdrop config stays on the
> classic face.
>
> **UPDATE 2026-07-10 (Phase-3 Monitor console BUILT + SHIPPED `3fbd371` — installer SHA-256
> `7E74216CF47CAE3FA2D09A6E874A0F21A305D4D1925D363A869D61B15C97295D`, stamp-verified LIVE `3fbd371`,
> installed by Claude, supersedes the `bce72d6` installer; flag `compy_monitor_console` **DEFAULT
> OFF**):** the Console HUD's Phase 3 (plan `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md`,
> entry gate cleared by the owner's go on the instrument-cluster concept, 2026-07-10) is on the live
> installer behind a NEW preview flag — **flag off (the shipped default), Monitor is byte-identical
> to the previous build** (`readMonitorConsole` → `=== "1"`, `src/design/theme.ts:566`; pinned in
> `monitor-console-flag.test.tsx` for BOTH `compy_editorial` states). Flag ON (Settings → Appearance
> → "Monitor console (preview)"): the Monitor room's LIVE face becomes the instrument cluster — a NEW
> `Oscilloscope` kit component (`src/design/console/Oscilloscope.tsx`: pure render of the caller's
> real buffered samples, no self-driven rAF, empty buffer ⇒ honest "no signal", never a synthetic
> line) drawing rolling fps + frametime traces (fps = the real polled capture samples, cleared the
> moment the helper stops — never frozen-as-live; frametime = the backend's real per-frame
> `recent_frametimes_ms` window the Overlay already draws) + ArcGauges over GPU temp (vendor-gated
> tone, NVIDIA ungraded per LOCKED rule 5) / CPU (ungraded by design) / RAM (+ GPU load in Advanced).
> Same three 1 Hz read-only polls MonitorBasic/Play live run, ported verbatim — **zero new IPC, zero
> src-tauri** (`git diff 1527d61~1..3fbd371 -- src-tauri/` empty). Capture control = the same audited
> toggle; V2-8 `onFpsActive` door mirror preserved; Sessions face + TuningPresets untouched; Basic
> keeps the last-session door. Motion layer = Phase 2's mechanisms (spotlight · `backwards` reveal ·
> stage reticle), deliberately NO hologram and NO parallax over the traces; reduced ⇒ still page.
> Home console stays DEFAULT ON from `bce72d6`. Verify: tsc 0 · vitest **1236** (164 files) ·
> self-reviewer **PASS** (8/8 at native 1500×980: stopped-state honesty, visual stillness at rest —
> two shots 12s apart differ only in real sensor numbers, accent-ink contrast computed, flag-off
> classic round-trip, Crimson spot-check; the violet capture button under Crimson traced to the
> pre-existing test-pinned per-room accent re-point `src/surfaces/monitor-v2.css:31`, not this
> train). Known preview gap (owner reaction decides): the Advanced console face shows the instrument
> cluster only — overlay controls + deep monitoring stay on the classic face. **⏳ OWNER eyeball is
> the next gate** (taste gate before default-ON and Phase 4 History/Black Box per the direction
> table).
>
> **UPDATE 2026-07-10 (Home console DEFAULT-ON, SHIPPED `bce72d6` — installer SHA-256
> `2DA1340D8BC5AA3337AFACF0C36FAE450684E50ED73E54A517AE98F6ACE6F3E4`, stamp-verified LIVE, installed by
> Claude, supersedes the `80c69f1` installer):** the owner's verdict ("everything looks good", 2026-07-10,
> which also confirmed the T6c gaming-mode Resume worked live) cleared the Phase-2 eyeball gate →
> **`compy_home_console` is DEFAULT ON** (`readHomeConsole` → `!== "0"`, `src/design/theme.ts:536`) per
> ship-approved-work-as-the-build. Home opens as the console cold-open for everyone; **Settings →
> Appearance → "Home console" (row dropped "(preview)") set to OFF is the classic-Home failsafe** —
> byte-identical to the pre-console tree for BOTH `compy_editorial` states, live round-trip verified no
> reload. Pins re-anchored in `home-console-flag.test.tsx` (new default contract) +
> `home-hud-flag.test.tsx` / `hologram-orbit-optin-guard.test.tsx` (the "0" failsafe for the layers they
> guard; NEW console-stage orbit pin — fresh default = no unattended rotation, idle 0 GL draws/16s).
> Zero src-tauri. Verify: tsc 0 · vitest **1210** (161 files) · self-reviewer **PASS** (dev-webview
> evidence; settings round-trip both ways, "(preview)" grep-clean). **Phase 3 (Monitor) is planned:**
> `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md` — new flag `compy_monitor_console`
> DEFAULT OFF, `Oscilloscope` kit component on the real live telemetry, builds in a FRESH session.
>
> **UPDATE 2026-07-10 (T6c one-click Resume + mount-aware banner deferral SHIPPED `80c69f1` — installer SHA-256
> `B7F0148A1F8F50ED76267E2B7580A4636463FB71D9F4E02FD5DA61E895BDCFA0`, stamp-verified LIVE, installed by Claude,
> supersedes the `72d9b6e` installer):** the owner's 2026-07-10 directive built — the GLOBAL gaming-recovery
> banner (`src/App.tsx`, `.gaming-recovery-banner`) now leads with one-click **"Resume Gaming Mode"** (the pane's
> audited `recover_gaming_session(confirm)` → `start_gaming_session` sequence verbatim — rollback-first, restore
> to TRUE priors, then an explicit user-clicked restart; never zero-click on launch), keeps "Restore now" as
> secondary, and "Review" no longer clears the recovery (no dead-end behind a closed disclosure). Resume restarts
> with the interrupted session's OWN tiers via `resumeOptionsFrom` (`src/surfaces/gaming-mode.ts`) — derived from
> its recorded change labels; the pane's checkboxes reset on remount and silently downgraded a resumed
> advanced-tier session (pane's `onResume` fixed too). The 2026-07-10d **carried note is RESOLVED**: banner
> deferral is now MOUNT-AWARE (pane announces via `GAMING_PANE_(UN)MOUNTED_EVENT`) — a pending recovery is no
> longer invisible on the Lab/Optimize tabs outside the gaming door. Round-1 self-review caught a pre-existing
> app-wide cascade bug: bare `.btn-small-on` lost the tie to the later `.btn-small` base rule (accent ink dead on
> all 7 call sites) and the generic hover painted the primary danger-red → `.btn-small.btn-small-on` double-class
> + hover override (`src/App.css`), guard-pinned in `src/button-legibility-guard.test.ts`. Zero src-tauri (no new
> IPC/mutation primitive — audited commands only). Verify: tsc 0 · vitest **1208** (161 files, +5 pins net) ·
> self-reviewer round-2 **PASS** (computed accent proof at rest+hover; one-prompt-at-a-time proven live against a
> REAL orphaned session found on the rig — the owner will be greeted by this exact banner, with Resume, on next
> look). T6b (batched restore-side elevation) remains a separate open candidate.
>
> **UPDATE 2026-07-10 (Phase-2 Home console cold-open BUILT + SHIPPED `72d9b6e`, flag `compy_home_console` DEFAULT OFF):**
> the Console HUD's Phase 2 (plan `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`) is on the live
> installer behind a NEW preview flag — **flag off (the shipped default), Home is byte-identical to the previous
> build** (test-pinned both ways in `home-console-flag.test.tsx`). Flag ON (Settings → Appearance → "Home console
> (preview)"): Home opens as the console cold-open — the real 3D rig hologram center-stage in a bracketed stage,
> four honest corner arc gauges (Readiness ratio · Avg FPS · 1% low · GPU temp — absent ⇒ NOT-YET, never a
> fabricated 0; NVIDIA temp stays ungraded per LOCKED rule 5), HomeHud's proven masthead register, edge
> annotations, the #1-limiter context row with its "See in Lab" jump, and a **Dock of room doors** (the
> `railFor` ground rail minus Home — Monitor · Blackbook · Lab, Lab primary; RoomShell's ForwardDoor suppressed
> while the dock renders so Home keeps exactly ONE forward affordance — the self-reviewer's round-1 duplication
> catch, bug→guard-pinned). Motion layer (spotlight · staggered reveal · stage reticle · annotation parallax)
> fully stilled under reduced motion. **Entirely frontend: `git diff 5b79d58~1..72d9b6e -- src-tauri/` is
> EMPTY.** Verify: tsc 0 · full vitest **1203** (161 files, +21 pins) · cargo **688** · self-reviewer round-2
> **PASS** (fresh full pass at `72d9b6e` incl. the canvas idle probe: 0 GL draws over 16s at rest, orbit
> re-engages). ⏳ OWNER eyeball: flip **Settings → Appearance → "Home console (preview)"**, open Home, react —
> the taste gate before default-ON and before Phase 3 (Monitor).
>
> **UPDATE 2026-07-10 (proving-ground DEFAULT-ON + standalone Optimize tab DROPPED, SHIPPED `59249bb`):** the
> owner's round-4 verdict ("ALL GOOD") cleared the Ops Console eyeball gate, so both decided 2026-07-10 calls
> shipped in one train: **`compy_lab_ground` is DEFAULT ON** (`readLabGround` → `!== "0"`, `src/design/theme.ts:326`)
> and the **standalone Optimize tab is REMOVED** — the rail is Home · Monitor · Blackbook · Lab
> (`railFor(merged, ground)`, `src/design/homeRail.ts:42`); the Lab's Optimize station is the ONE door to the
> safe-tweak toggles. Everything fix-flavored re-routes to the Lab under ground: Home's limiter buttons
> ("See in Lab"), Home's forward door (`doorFor`, `src/design/room-shell.tsx:39`), the gaming-recovery banner's
> "Review", navHome/HOME_FOR_TAB fallbacks, and the Setup & Tour (4-room recap + lesson ties + seatbelt ledger
> room). The self-reviewer's round-1 catch — the decided "undo stays reachable via the Lab panel" had NO ledger
> surface in the station — was fixed before ship: OptimizeStation now carries an "Applied & history — every
> change, undoable" disclosure rendering the classic room's audited `<Fix view="ledger">`
> (`src/surfaces/lab/OptimizeStation.tsx:170`, guard-pinned in `lab-ground.test.tsx`). **`compy_lab_ground="0"`
> (Settings → Appearance → "Lab proving ground") is the full classic failsafe** — rail, tabs, rooms and tour
> restore live, no reload (live-verified round-trip). The "Remaining owner call: drop the standalone Optimize
> tab at default-ON" lines in the dated banners below are RESOLVED-SHIPPED by this train.
>
> **UPDATE 2026-07-10 (console round-3 owner catches SHIPPED, `889de10`):** owner round-3 eyeball caught two
> Ops Console bugs — the resting Optimize dock node read as pre-selected (primary wore the exact active accent
> border; now a 35% color-mix border, active alone gets full accent + tinted fill) and the safe-stack ring's
> "8/9" readout painted over the ring's top stroke (baseline flex anchored it to the box top; now centered via
> an inner `.lab-gauge-txt` baseline group). His requested abnormality sweep also caught + fixed a drift
> contradiction: the ring caption re-framed a drifted rec as "1 left to enable" against the corner gauge's
> "0 ready" — the caption is now drift-aware. All three guarded (`optimize-gauge-dock-guard.test.tsx`, 7 tests).
>
> **UPDATE 2026-07-10 (title-header law SHIPPED, `626b83c`):** owner round-2 feedback on the Ops Console eyeball —
> a room header is a **TITLE** (h1 = the room name, never a status/notification/description sentence). All 5 v2
> rooms' hud-on h1 is now the room title ("Lab" / "Optimize" / "Monitor" / "Blackbook"); every displaced
> verdict/status line relocated into its body context (drift guidance → Fix drift intro · undo promise → Fix
> consent line · Monitor's last-session answer → Play hero · Blackbook record + autopsy hint → Learn). Home's
> masthead verdict KEPT (cold-open answer, flagged for owner taste). Law mechanized as self-reviewer rubric item 6
> (upgraded). Remaining owner call unchanged: drop the standalone Optimize tab at default-ON.
>
> **UPDATE 2026-07-10 (header-slop sweep SHIPPED, `1a9f44f`):** owner round-1 feedback on the Ops Console eyeball —
> **Optimize open-on-click CONFIRMED** ("cleaner") + a new app-wide **header-slop law** (tab header space carries
> header-format text only; small always-on descriptive lines relocate to their context). Shipped same day: the four
> rooms' `.v2-measured` strips removed, the Lab header cut to eyebrow + headline, the console lede deleted (undo promise
> relocated into the Optimize panel), law mechanized as self-reviewer rubric item 6. Remaining owner call: drop the
> standalone Optimize tab at default-ON.
>
> **UPDATE 2026-07-09 (Lab "Ops Console" Phase 1 SHIPPED, `63585e9` — post whole-branch review):** the bento Instrument Bench was owner-rejected
> ("generic slop / wide horizontal boxes"); the owner-picked **"Ops Console"** direction
> (spec `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`, plan
> `docs/superpowers/plans/2026-07-09-console-hud-phase1-lab.md`) Phase 1 is now the live installer below — the real 3D rig
> hologram at center, four honest corner arc gauges, a magnify Dock of stations — still behind `compy_lab_ground`
> **DEFAULT OFF** (app byte-identical until the owner flips the preview). The **Optimize-tab deferral stays OPEN**: with the
> preview on, the standalone Optimize rail tab still coexists with the Lab hero, and the Optimize-panel open-on-click-vs-always
> call is owner-gated before default-ON (OWNER_ACTION_CHECKLIST).

| Field | Value |
|---|---|
| Git HEAD | `915e85b` + this ship-docs commit (branch `main`, 2026-07-11 — the live installer is built from exactly `915e85b`) |
| App version | `0.1.0` (`gg.compy.app`, `compy.exe`) |
| Current installer | `Compy_0.1.0_x64-setup.exe` SHA-256 `3B3A65C45C4BF63942373612CA19353EAFAB16CED10EE8A71F83143271B19DAD` (built from `915e85b`, 2026-07-11 — **Monitor v5 "Flight Deck + Session Stack"** + the trace-line refinement (monotone curves, round joins on stack rows) + the scope-line sharpening (trace glow deleted, non-scaling 1.25px strokes) + the RTSS-style ZERO-ANCHORED frametime scale (raw per-frame line on a stable 0→niceCap ms axis w/ labeled gridlines; the envelope mode that briefly shipped in `e02d1ad` is DELETED — owner-rejected); the v4 SessionWaterfall + `waterfall-profile` are DELETED; `compy_monitor_console` stays **DEFAULT OFF** (`readMonitorConsole` → `=== "1"`, `src/design/theme.ts:566`) — flag off, Monitor is byte-identical (pinned in `monitor-console-flag.test.tsx` for BOTH `compy_editorial` states); flag ON: ONE face, no mode toggle — Flight Deck (consumer readouts · `DeckScope` frametime hero w/ hover scrub + drag-zoom · session-scoped delta row) + Session Stack (last ≤5 sessions on ONE shared 1%-low axis, recorded-span coverage stated, worst-dip pin w/ clock time, VS PREVIOUS chips), all over the SAME 1 Hz read-only polls, zero new IPC. Consumer-terms presets from `33661b8` and Home console DEFAULT ON from `bce72d6` unchanged. Superseded installer: `0AA8E222…F21A55` from `e02d1ad`.) |
| Frozen private-beta artifact | ref `16069fa` / `beta/private-beta-001` (the OLD verified unsigned private beta — a DIFFERENT risk profile from current `main`) |
| Last full installed-build QA | **§6/§7: 2026-07-07 on the `5f765e4` installer (T5)** — §7 swept all items live (3 honesty gaps found → fixed `ff186e6` → focused re-verify PASS on the shipped build); §6 corrupt + missing ledger proven live (fail-loud quarantine / empty load, no crash; real ledger restored hash-identical), cancelled-apply covered by §1's live QA. **§6 helper-crash leg CLOSED 2026-07-08** (owner-run probe on the `48ca9ec` installer: kill elevated helper → `fps.json` froze + `fps.alive` cleaned + no ghost → re-enable spawned a new helper; owner confirmed the Monitor UI showed the sensor STOPPED, not frozen/false-live) — **§6 is now fully passed**; §1/§2a/§5 stand on their own dated passes. Last FULL all-section pass remains 2026-05-31 (frozen private-beta build). |

## Gate matrix (re-verified at HEAD `733f132`, 2026-07-02 — every gate function re-read at source; states unchanged since `9463c10`. Still current at `4e07420` (2026-07-04): the V2 product-shell train `706094f..4e07420` (V2-1→V2-15) is **entirely frontend/docs — `git diff 706094f..4e07420 -- src-tauri/` is empty**, so no gate function, mutation/rollback path, or IPC/capability surface changed. Before that, `706094f`'s sole src-tauri change was readiness drift-reason copy + a read-only `drifted_titles` summary field (`readiness.rs` / `history.rs`; diff-verified: no gate moved))

> **Re-verified 2026-07-06 at HEAD `8c9b711` — audit now mechanized.** Layer 1 (`node
> scripts/verify-release-state.mjs`, new): six citations had drifted 77–253 lines (the preload-dark +
> receipt-metadata trains grew `actions.rs`/`history.rs` above the cited symbols) — all re-anchored in
> this pass; script exits 0. Layer 2 (source re-read of every gate fn body): **every gate VALUE
> unchanged** — the only truth-level fix was quoting the literal CSP `connect-src` instead of a
> simplified one. Standing rule: run the script after any train touching cited files
> (`.claude/skills/gate-drift-audit`).

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:500` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **live reboot-while-active (headline case #4) + one-prompt advanced tier (#10) owner-PASSED 2026-07-07** — see GAMING_MODE_QA.md. Remaining checklist boxes are the non-headline live cases. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:1543` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. UI in `GamingMode.tsx`. Since T6 (2026-07-07) session-start suspends ride the ONE batched elevation; since T6b (2026-07-08, `bdc9daa`) the restore side batches the same way. |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:1614` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:163`, `lib.rs:679`, `Benchmark.tsx:188` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal (Phase-B "bloat removal")** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:1754` | Built dark 2026-07-06 on the owner's nod (spec `2026-07-06-preload-app-removal-dark.md`). Per-user `Remove-AppxPackage` over a curated 4-app starter list (Solitaire · Feedback Hub · News · Office hub — **Spotify cut by owner curation 2026-07-06:** same package id as a real daily-driver install, no honest "stub" framing; may return behind a usage check); two-tier honest undo (silent re-register verified by re-read, else Store-page hand-off returning Err). Scope decisions: `HKCU\Run` DELETION dropped (the reversible disable already ships, `set_startup_entry_enabled`); Clipchamp/To Do excluded as data-adjacent. Command `remove_known_preload_app` refuses while dark; FE card renders nothing (test-pinned). Arming needs: live remove→reinstall QA (`qa_remove_then_reinstall_round_trip`) + every Store ProductId link-verified + owner curates the final list + sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs` | Built dark 2026-07-09 on the owner's nod (marathon §2a, spec `2026-07-08-lab-proving-ground.md`). Applies the whole safe stack in ONE UAC (reuses the audited `apply_recommendations_batch` — **no new mutation primitive**), measures the cumulative fps delta, then rolls back EXACTLY the changes it created via a multi-change Drop-guard (ledger id-diff; corrupt-ledger read ABORTS before any mutation — rust-tauri-reviewer fix). Commands `start_stack_trial` + `stack_trial_armed` refuse/return false while dark; no FE surface yet. Arming needs: live apply→rollback QA on a real rig + owner sign-off. |
| **Leftovers restore** | **DARK** (`false`) | `restore_gate()` — `leftovers.rs:727` | Double-dark; detector is read-only, restore path refused + `#[cfg(test)]` bypass only. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key); FE `pro.ts:14`, `entitlements.ts:14` | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:96`; all-zeros pubkey `remote_rules.rs:84` | Double-gated: `verify_chain` ALSO hard-fails on the placeholder key (`remote_rules.rs:235`). Ed25519 verify is real but never runs in shipped builds. |
| **Auto-updater** | **OFF / absent** | no `plugins`/`updater` block in `tauri.conf.json`; no updater dep in `Cargo.toml` | — |
| **Outbound network** | **NONE** | no `reqwest`/`ureq`/`hyper`/HTTP client anywhere in `src-tauri/src` or `Cargo.toml` (2026-07-11 audit: whole-tree grep, zero hits besides a `// Future:` comment in `remote_rules.rs:368`); **production** CSP `security.csp.connect-src` (`tauri.conf.json:46`) is `'self' ipc: http://ipc.localhost` — the `ws://localhost:1420 http://localhost:1420` tokens belong to the separate dev-only `devCsp` field (`tauri.conf.json:51`, not shipped). Both are local-only; zero external origins either way — the correction only fixes which field the doc was quoting, doesn't change the conclusion. | Verified-zero-outbound property holds while Receipts + remote-fetch stay dark. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`history.rs:745`→`actions::resolve_rollback`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned
  (`save_history_to` `history.rs:320`; test `save_is_an_atomic_swap_leaving_no_tmp` `history.rs:2004`).
- Elevation: relaunch `compy.exe --run-elevated <hex>` (windowless), 4-way honest UAC outcome
  attribution (`elevation_outcome` `actions.rs:826`). PowerShell token validators `ps_safe`/`ps_safe_squoted`.
- Gaming-session advanced tier (USB + PCIe + service suspends) batches to **ONE elevation per
  session start** (T6, 2026-07-07) — and since T6b (`bdc9daa`, 2026-07-08) the restore side
  batches contiguous elevated rollbacks the same way: sink-staged → `compose_batch_script` → single
  `run_elevated_powershell` → per-item receipts (`apply_elevated_tier`,
  `gaming_orchestrator.rs:201`). No-partial abort+restore contract unchanged; UAC-decline drops
  only verifiably-never-ran staged entries (`elevation_error_nothing_ran` `actions.rs:850`);
  dispatch-layer guard `a_full_tier_dispatches_exactly_one_elevation`.

## Release blockers

| Item | Status |
|---|---|
| Manual-mutation apply/rollback QA | **CLOSED** 2026-05-31 (owner sign-off) — `RELEASE_QA.md:3`. NOT an open blocker. |
| Private-beta functional blockers | **NONE** for the frozen `16069fa` build (`PACKAGING_SIGNING_PLAN.md:131`). Current `main` wants its own fresh installed-build QA if shipped. |
| Gaming Mode live reboot-while-active QA | **CLOSED 2026-07-07 (owner-run)** — physical reboot + "Restore now" on the `48ca9ec` build: session contract cleared, every probed value matched his standing ledger state; case #4 PASSED in `GAMING_MODE_QA.md` (`a21f310`). This row had lagged the close by a day — fixed 2026-07-08. |
| Gaming Mode enable fires ~5–6 UAC prompts | **CLOSED 2026-07-07/08** — T6 built the session-start batch (ONE `--run-elevated` invocation: `apply_elevated_tier`, `gaming_orchestrator.rs:201`; ≤1-dispatch cargo pin; no-partial contract + UAC-decline honesty preserved; UAC *policy* settings untouched per standing rule); owner live-confirmed exactly ONE enable UAC 2026-07-07 (case #10 PASSED). T6b (`bdc9daa`, 2026-07-08) batches the restore side the same way; owner's live restore-side eyeball pending (next real session). |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA license model + jurisdiction, PRIVACY) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA (remove→reinstall round trip, Store links) + owner-curated list | **OPEN** — gates arming preload-app removal (feature is built DARK, not a ship blocker). |
| Remote-rules semver + production key + CDN + staged rollout | **OPEN** — gates arming remote fetch (currently `version_in_range` is lexicographic, `remote_rules.rs:299`). |

## Required owner decisions (live)

1. **Beta artifact choice — DECIDED (owner, 2026-07-06): current `main`.** ("I like the current main build, it's more complete in the way I want it.") Frozen `16069fa` stays archival. Consequence armed: fresh full installed-build QA on `main` (2026-07-06 train T5, now REQUIRED) + owner-run GAMING_MODE_QA.md live case #4 (reboot-while-active) before any send.
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).
