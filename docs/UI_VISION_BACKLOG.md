# UI / Design Vision Backlog — the ONE home for the owner's visual asks

> **Why this file exists (2026-07-08).** The owner flagged that a UI task list he'd made had been
> dropped — and he was right. His design/UI direction was scattered across ~20 specs (2026-06-05 →
> 2026-07-07); several asks were mentioned once and never tracked again, and a few were **quietly
> substituted** (a simpler build shipped in place of what he asked, without his sign-off). There was
> no single home for "what the owner wants the interface to be," so a waking session read the
> redesign lane as "COMPLETE" and moved on. **This file is that home.** It is the canonical,
> de-duplicated ledger of every owner-authored UI/design/visual ask, its source, and its HONEST
> status. Sibling of `docs/OWNER_ACTION_CHECKLIST.md` (which tracks owner *actions*); this tracks
> owner *vision*.
>
> **Status honesty:** items marked **VERIFIED** were checked against `main` source. Items marked
> *(per doc — code-unverified)* come from the spec's own status line and have NOT been re-checked
> against code — treat as a lead, not a fact, until verified. Born from an Explore-agent sweep of
> `docs/` + git history; citations are `file:line`, point-in-time.

---

## 🔴 OPEN — the real outstanding visual work (what actually needs doing)

These are owner asks that are **never-built or parked**, not yet reflected as active work anywhere
else. This is the list the owner meant.

### A0. Monitor console v3 — "up the ante" rework (owner, 2026-07-10, post-Phase-3 ship) 🔴 OPEN

**Owner's FULL response, retained verbatim at his explicit request** ("please be sure to retain the
full response ive written here seeing how things seem to get lost in translation in the past"):

> so is the overlay just not in the current build yet for me to view also? and to be honest i sort
> of liked how it looked before but this one also is satisfactory. so i wonder if there is a way to
> up the ante and improve or rework for a 3rd option for how it can look that will surpass the
> satisfactory rating. i think graphs are a muust or some sort of measurable finite detail because
> when measuring frametime latency spikes its important to see the exact moment indicator for the
> "spike" also just a side note for the current frametime graph in the preview it doesnt seem to
> stretch along the whole grid on the graph it just stops short about halfway whereas the fps graph
> is the full length. just something to note when remaking the next one. and as for the self review
> negating any form of 3d or parralax style telemetry. unless there is a specific reason for that i
> think the stuff thats been most appealing and on par with the design direction has been due to
> the enabling of that sort of stuff so it shouldnt be ruled out as an option unless reasonably so.
> also note that for the wording between visual fidelity, smooth or clarity. i think more consumer
> interest targeted terms would be better such as "MAX FPS" "Lowest latency" "HIGH RESOLUTION" ARE
> MORE POPULAR SOUGHT AFTER TERMS IN THIS MARKET. please be sure to retain the full response ive
> written here seeing how things seem to get lost in translation in the past probably due to the
> length of my response or whatever reason.

**Decomposed (each its own tracked item — none may be silently dropped or substituted):**

1. **Overlay controls missing on the console face** — ✅ BUILT in v3 (`215e36d`): on/off toggle +
   corner picker on the console face, same audited commands, not forked. **Explicit residual
   (NOT silently closed): the density/backdrop overlay config still lives only on the classic
   Advanced → Live face** — fold into the console face if the owner wants it there.
2. **v3 rework — surpass "satisfactory":** classic tiles = liked; Phase-3 instrument cluster =
   satisfactory; he wants a third option that beats both. Spitballed same day per the per-tab law;
   **owner CHOSE the "3D ribbon graph" concept (2026-07-10)** — plan written:
   `docs/superpowers/plans/2026-07-10-monitor-v3-ribbon.md` (entry gate cleared).
   **→ BUILT + SHIPPED `6932fa7`, then ❌ REJECTED on eyeball (owner, 2026-07-10, verbatim):**
   > ok this is not what i expected (view image) this looks sloppy and doesnt make sense. can you
   > try to create something sensible thats achieves the same goal and still incorporates some
   > sort of 3D or just simpyl interactive graph. this is just weird looking
   Failure diagnosis (recorded so v4 can't repeat it): the ribbon extruded the trace into a solid
   mound with **no y-axis, no per-frame reference, perspective warping magnitude** — zero readable
   values, so the 3D destroyed the "exact spike moment" requirement (item 3). Lesson = the concept-
   words→visual translation gap; v4 goes through **interactive mockups first** (the pattern that
   resolved the Lab). **CONCEPT ROUND 2 OUT (2026-07-10):** Artifact
   <https://claude.ai/code/artifact/a8e6acf7-54f6-47c4-a1db-d4e1880d8249> — A "Precision Scope"
   (interactive 2D: ms axis, scrub, drag-zoom, spike chips) · B "Depth Waterfall" (3D where depth =
   time; front trace flat/readable, history recedes, spike pins persist) · C "Bar Skyline"
   (per-frame columns on a gridded floor vs a labeled ms wall, drag-orbit, spike columns print
   their exact ms). All three: same feed, budget line, exact-moment markers, consumer readouts.
   ✅ **Owner PICKED same day: B + A's drag-segment, lean into previous-session comparison**
   ("really refining that as a working implementation … more comprehensive visually and
   systematically" — full verbatim in the plan). **v4 plan written + entry gate cleared:**
   `docs/superpowers/plans/2026-07-10-monitor-v4-session-waterfall.md` (LIVE mode: real 240-frame
   scope + drag-zoom + receding same-capture snapshots · SESSIONS mode: the last ≤5 sessions' real
   `stutter_timeline` as depth layers, `stutter_events` dip pins, delta strip, same-game filter —
   zero new IPC). Builds in a FRESH session; ribbon deleted in its T4.
   **→ v4 BUILT + SHIPPED 2026-07-11 (`85eb8c6`, installer `44610BF6…D370A30`, stamp-verified
   live; flag `compy_monitor_console` still DEFAULT OFF):** all four decomposed asks present —
   B depth waterfall (flat axis-anchored front, depth = presentational offset only), A drag-zoom
   folded into the front trace, previous-session comparison leaned in (stacked legend labels ·
   same-game-preferring delta strip with cross-game "DIFFERENT GAME" labeling · dip pins with
   real labels · "N COMPY CHANGES ON" tag), 2D canvas replacing r3f. Ribbon DELETED. Self-review
   round 1 FAIL (idle repaint churn · empty-scene repaint · legend overlap at the real 5-session
   history · bare cross-game delta) → fixed + guard-pinned → round 2 PASS 8/8. **⚠️ That round-2
   "PASS on real production data" claim was WRONG on readability — the owner eyeball FAILED the
   `85eb8c6` build 2026-07-11 ("this looks absolutely terrible … what a mess"): raw multi-hour
   timelines drew as smears, dip pins as a barcode, legend printed over chart ink, Live|Sessions
   duplicated the room's segment labels.** Readability rework `082414c`+`915cb96`:
   `downsampleTimeline` (min-per-bucket, ≤160 drawn samples) · `MAX_LAYER_PINS=3` worst-dip caps ·
   `layerAlpha` ramp · legend moved OUT of the stage · modes renamed **Now/Compare** · draw-density
   guards automated (`waterfall-profile.test.ts` "draw-density discipline") · self-reviewer rubric
   gained the real-density law (fixture-scale PASS ≠ PASS). Fresh full self-review round: PASS
   (all items, real 5-session data). ~~⏳ OWNER eyeball (round 2) is the open gate~~ →
   **❌ ROUND-2 VERDICT IN (owner, 2026-07-11, verbatim — retained per item 7):**
   > the monitor tab doesnt seem to be working out like i presumed, unless yo can really just
   > change it to where it looks more intuitive then maybe just re work the whole thing to
   > something else thats more likely to be comprehensive
   Read: the waterfall CONCEPT (depth-stacked session layers) is the problem, not the polish —
   two build-rejections on this face (v3 ribbon, v4 waterfall) say stop tweaking and re-concept.
   Per the mockup-first pattern (the one that resolved the Lab and produced the v4 pick),
   **CONCEPT ROUND 3 is OUT (2026-07-11):** Artifact
   <https://claude.ai/code/artifact/9ebf6305-e488-422d-b699-0c281b15676c> — **A "Flight Deck"**
   (one comprehensive face, no modes: live scope w/ spike pins + consumer readouts + plain-number
   "vs last session" deltas + session shelf) · **B "Session Stack"** (small multiples: each
   session a flat mini-graph on ONE shared axis, stacked newest-first, worst-dip pin w/ exact
   time per row, delta chip vs previous) · **C "Debrief Card"** (report card: measured grade +
   plain-English headline, two-session side-by-side bars, verdict sentences). All three keep the
   binding musts (real graphs · exact spike moments · consumer terms · session comparison ·
   overlay control · honest empties · zero new IPC). Natural combine flagged on the page:
   A's top half + B's stack. ~~⏳ GATE: owner picks A/B/C (or a combine)~~ → ✅ **PICKED same day
   (owner, 2026-07-11): "A's top + B's stack"** ("ooooo ya i like the mockups you sent me").
   Build plan: `docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md` (v5 "Flight Deck +
   Session Stack" — one face, two halves, no mode toggle, waterfall deleted; builds in a FRESH
   session).
   **→ v5 BUILT + SHIPPED 2026-07-11 (`960734c`, installer `A4D3BF98…D147E0`, stamp-verified
   live; flag `compy_monitor_console` still DEFAULT OFF):** the picked combine as specified —
   Flight Deck top (readout strip · full-width frametime scope hero with hover scrub + drag-zoom
   ported from the waterfall's front trace · session-scoped plain-number delta row w/ cross-game
   "(DIFFERENT GAME)" labeling + changes-on tag) + Session Stack below (≤5 flat rows on ONE
   shared 1%-low axis, ONE worst-dip pin w/ exact clock time per row, VS PREVIOUS chips,
   current-game filter, click-to-expand detail; the stack IS the session shelf, both modes).
   SessionWaterfall + Now/Compare toggle DELETED; chain law held (flat 2D, no depth over data
   ink). Self-review on the REAL 5-session history: round 1 FAIL — the real-density law caught
   the 10.5 h Sand session's backend-capped timeline (~2 h recorded) drawing as a sliver; fixed
   (rows draw the RECORDED span; partial coverage stated on-row: "first 2h 0m recorded") +
   guard-pinned → round 2 PASS 8/8. ~~⏳ OWNER eyeball of v5 is the open gate~~ → ✅ **OWNER
   APPROVED 2026-07-12 ("flip it default on and silent reinstall") → FLIPPED DEFAULT-ON `e195f70`**
   (installer `3B855DD1…FB003`, stamp-verified live; `readMonitorConsole` → `!== "0"`, Settings row
   now "Monitor console", "0" = the classic failsafe; test-pins re-pointed to DEFAULT-ON polarity;
   self-reviewer PASS 8/8). Monitor now opens on the Flight Deck for everyone. **Follow-up logged
   (pre-existing, exposed by the flip): the Monitor room chrome is locked to static violet
   (`monitor-v2.css` play-room re-point) while the SessionStack sparkline follows the live theme —
   an internal accent mismatch under non-Violet themes; owner-taste call, BACKLOG Cycle 2026-07-12g.**
   → ✅ **RESOLVED direction: owner picked "per-room identity" (2026-07-12)** — each room gets its OWN
   accent (Monitor = teal), so the SessionStack sparkline now matches the room chrome instead of clashing.
   Built behind `compy_room_identity` **DEFAULT OFF** (`72fa005`, installer `D23DE073…9EBA9`, stamp-verified).
   **Extended 2026-07-12 with a per-room color PICKER** (owner Cycle-12i follow-up "the freedom to shift
   around the colors they want on each page"): an accent dot in each room's top-right corner opens a curated
   swatch popover to recolor THAT room, persisted per-room (`20e2b50`). **Palette expanded to 20 then PRUNED
   to a differentiated 15 2026-07-13** (owner "more neon or bright/dark tone mixed" → "prune and widen
   variety more differentiation"): 9 bright + 6 dark tones with adaptive light ink so dark FILLS stay
   legible; CIEDE2000-verified differentiation (`8e6920f`, installer `51B0A754…3862F39A`, stamp-verified).
   Owner one-flip eyeball on the pruned palette pending. 🔴 **Follow-up:** accent-as-TEXT (Lab station
   tabs, Home dock) renders dark picks ~2.5:1 — the adaptive ink covers FILLS only; legibility train
   queued (BACKLOG Cycle 2026-07-12l, OWNER_ACTION_CHECKLIST §A9).
3. **Graphs are a MUST + spike-moment indicators:** measurable finite detail required — the
   frametime graph must mark the EXACT moment of a latency spike (per-sample indicator, not just
   an average). This is a hard requirement for v3, not a nice-to-have.
4. **Bug (fold into v3): frametime trace stops ~halfway across the grid** while the fps trace runs
   full length. Cause: `Oscilloscope` scales x to the fixed `cap` (240), but the backend window
   carries fewer samples at sub-240 fps → partial width. v3: scale to the drawn window so the
   trace always spans the grid.
5. **3D / parallax telemetry is BACK ON THE TABLE (direction amendment):** the "NO hologram / NO
   parallax" line in the Monitor concept (direction spec 2026-07-09, Monitor row + Phase-3 plan)
   is NOT a standing ban. Owner: the 3D/parallax layer is what's felt most appealing and on-par
   with the direction — don't rule it out "unless reasonably so" (a stated, specific reason).
   Fold this amendment into the direction spec with the v3 train.
6. **Copy direction (app-wide, not just Monitor): consumer-market terms** — prefer "MAX FPS",
   "Lowest latency", "HIGH RESOLUTION" over abstract wording like "visual fidelity / smooth /
   clarity". These are the sought-after terms in this market. Honesty laws unchanged — the terms
   label MEASURED values, never fabricate claims. ✅ **BUILT 2026-07-10 (post-v3 train):** the v3
   readouts already carried the verbatim stat terms (MAX FPS · AVG FPS · LOWEST LATENCY · SPIKES);
   the tuning-preset trio he named is now **"Max Quality" / "More FPS" / "Lower Latency"**
   (label-pinned in `monitor-view.test.ts`; ids stable). Two disclosed deviations, both honesty/
   self-review-driven: (a) "High Resolution" NOT used — that preset bundles HDR+VRR walkthroughs,
   nothing touches resolution; "Max Quality" is the nearest honest term; (b) chips are goal-register
   comparatives, not the readouts' exact stat terms — the self-reviewer caught literal "Max FPS"/
   "Low Latency" chips rendering on the SAME screen as the measured "MAX FPS"/"LOWEST LATENCY"
   readouts (a chip must never read as a measured value). Owner may overrule either at eyeball.
7. **Process note (standing):** long owner responses have lost parts in translation before —
   retain them verbatim here and decompose every part ([[decompose-owner-lists-atomic-todos]]).

### A. The JARVIS interaction / motion layer — ✅ SHIPPED DEFAULT-ON (2026-07-12, owner-approved "everything looks good")
Source: `docs/superpowers/specs/2026-07-05-ui-deslop-organic-directive.md:111-176`. The de-slop
directive's redesign lane is marked "COMPLETE," but that only covered the **Instrument-HUD reskin**.
The **motion/interaction effect plan** the owner was most excited about was scoped, given a specific
tech stack, then bypassed — the shipped work used CSS/native React instead. **VERIFIED 0 files in
`src/`** for panoramic / magnetic-cursor / Lenis (2026-07-08).
**→ TRAIN SHIPPED `1d310e1` (2026-07-12): A.2 + A.3 + A.5 + A.6 built as one layer behind NEW flag
`compy_jarvis_motion` (flag-off byte-identity + honest-tick + reduced-wins all test-pinned in
`src/design/jarvis/jarvis-motion.test.tsx`; self-reviewer PASS 8/8 incl. a 0-draws/16s GL idle
probe). ✅ OWNER EYEBALLED + APPROVED 2026-07-12 ("everything looks good") → FLIPPED DEFAULT-ON
(`readJarvisMotion` `!=="0"`, Settings row now "JARVIS motion"; the static shell stays reachable via
the "0" failsafe, byte-identity re-pinned to explicit "0").** His ranked plan, per-item status below:

1. **Panoramic inertia-drag telemetry gallery** — BUILT then REJECTED. The marathon shipped a literal
   clone of the sister-site effect (`330cd5c`, flag `compy_lab_ground` OFF); owner rejected it 2026-07-09
   (he wanted the *type/level* of effect referenced, not the feature cloned) and ordered it **deleted
   entirely** (direction-proposal Q3). The redirect: drag/inertia lands on the real rig hologram
   (`drei OrbitControls` damping) instead — see the approved **Instrument Bench** proposal, principle 6
   (`docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md`).
2. **GSAP data-reactivity** — gauge sweeps / count-ups / shader uniforms animated FROM live metrics
   (honesty win: motion serves real data). Chosen stack `:135-137`. GSAP was "deferred"; a CSS ring
   gauge + CountUp shipped instead. ~~NOT BUILT as specified~~ → **🟢 BUILT `1d310e1`:** the console
   gauges were ALREADY GSAP (useCountTo drives ArcGauge's count-up + ring sweep — landed with the
   console phases); the train adds the **data-tick** — a GSAP ring flash ONLY when a real measured
   value CHANGES to a different real value (arrival = the count-up's moment, loss = NOT-YET, no
   data = no tick node ever; all five cases test-pinned). **Disclosed deviation (a stated, specific
   reason per the owner's own "unless reasonably so" bar):** "shader uniforms from live metrics" is
   NOT pointed at the rig hologram — the bay rests on a demand frameloop (the idle-GPU ~0 law) and a
   continuously-animated uniform would violate the directive's own performance rail `:163-166`. The
   gauge tick is the honest A.2 vehicle; owner may overrule at eyeball.
3. **Magnetic cursor + mouse-tilt parallax** — only a small event-parallax on Home's annotation
   plane shipped. Magnetic cursor: ~~NEVER BUILT~~ → **🟢 BUILT `1d310e1`:** delegated MagneticLayer
   (GSAP quickTo, ≤4px pull, expo-out release, coarse-pointer skip) on the rail room tabs; the Dock
   is deliberately NOT magnetic (it owns the magnify lift — one motion idea per element). Plus the
   **chrome-plane tilt** on Home's console stage: brackets + corner gauges rotate ≤2.4° off the same
   pointer vars the annotation parallax already writes — the rig canvas never tilts, so drag-orbit
   and part picking stay pixel-exact (the HUD chrome floats over a stable subject).
4. ~~Rig hologram: click-a-component-for-live-specs + boot/scan sweep~~ — **SHIPPED (verified
   2026-07-08).** Clicking a part pins its live spec card (`RigPart.tsx:82` `onClick`→`onSelect`,
   card renders while `active`); drag-orbit + scan sweep shipped. ~~Only residual: a copy gap~~ —
   ✅ hint fixed 2026-07-10 ("Drag to orbit · hover or click a part for its live specs"). ~~Caveat
   found by the self-reviewer while verifying it: the CHROMED RigViewer's only surfaces
   (`OverviewTab`/`HardwareSection` + `CommandCenter`/`HomeV3`) were orphaned code~~ — ✅
   **dead-surface cleanup DONE 2026-07-11 (`eb5e62a`+`4a9a6ed`+`257ab32`, BACKLOG Cycle
   2026-07-11b):** the four orphaned surfaces deleted (with the dead ambient-backdrop subsystem
   they alone consumed — the do-nothing Ambiance + Step-aside Settings rows removed too).
   RigViewer itself stays (LabConsole mounts it `chromeless`; the orbit-contract guards pin the
   bare mount); note the chromed hint/controls bar now has no product mount at all — if a future
   surface wants the chrome, it's still there.
5. **Lenis smooth-scroll spine** tying the rooms together. ~~NEVER BUILT~~ → **🟢 BUILT `1d310e1`:**
   `lenis@1.3.25` (new dep, loaded only when the flag is on) on the shell's one content lane;
   nested scrollers (Learn list, drawers…) auto-yield to native scroll via an ancestor walk (no
   per-surface bookkeeping); the rAF loop stops whenever the window is hidden (never competes with
   the game being optimized); constructor failure ⇒ inert spine, native scroll.
6. **Room-transition "instrument retune" wipe** + Monitor meters as living oscilloscope traces
   (Home got one trace; Monitor rollout is partial). **Wipe 🟢 BUILT `1d310e1`:** one accent
   hairline band sweeps down the main pane once per room change — never on first paint, never on a
   bare flag flip; 300ms, transform-only, self-removing. **The Monitor-oscilloscope half is NOT this
   train's:** it lives in the Monitor console lane (§A0 — the v5 Flight Deck scope IS the live
   trace; `compy_monitor_console`, its own eyeball gate).

> ~~This whole block reads as a **quiet substitution** … it needs its own spec'd train~~ → **that
> train shipped 2026-07-12 (`1d310e1`)** exactly on the prescribed rails: flag-gated DEFAULT OFF
> (`compy_jarvis_motion`), honest data (tick = real change only), reduced-motion-safe (Compy's own
> Motion pref wins, mid-session flips live-verified), GPU-cheap (transform/opacity only; GL idle
> probe 0 draws/16s; hologram uniforms deliberately untouched — the directive's HARD RAILS at
> `:41-46,163-172`). ✅ **Owner-approved 2026-07-12 ("everything looks good") → SHIPPED DEFAULT-ON**
> (own commit, the Home-console pattern); the static shell stays reachable via the Settings "0" failsafe.

### B. Two Futures split — hologram must carry real per-part information
Built v1 (`compy_two_futures`, flag OFF). Owner eyeball 2026-07-07: *"looks really good BUT the
hologram itself has no visible purpose or information integrated — just a cool split with no apparent
changes before/after."* Must show part-anchored MEASURED deltas (changed components visibly marked)
before it graduates from preview. Folded into the Lab-establishment train (below).
Source: `docs/BACKLOG.md:115-129`, `docs/superpowers/specs/2026-07-07-two-futures-measured-split.md`.

### C. Lab room = the PROVING GROUND — 🟢 PHASE 1 SHIPPED behind flag (2026-07-09); phases 2–5 open
Owner (2026-07-08) handed over the Lab train with a full directive: research the framework, decide the
best linear guided pathing, optimize fluidity/intuitive access, incorporate the gallery, and let users
**make actual measured+reversible changes and prove them, all in the Lab.** Researched (two Explore
maps) + designed: **the Lab becomes a proving ground** — one linear spine (Intake router → Measure →
Test-a-tweak → Prove via the Two Futures measured split → COLLECT in the telemetry gallery), collapsing
the three competing nav idioms into one. **Key finding: the measure→change→prove loop already exists +
is safe** (Benchmark tweak trial, 16 catalog recs, auto-rollback). Gallery = the trophy/results space +
the terminal room's missing completion signal, built on existing R3F primitives + cross-IPC measured
data. Subsumes B (Two Futures hologram gets its purpose) + the panoramic gallery (§A.1) lands HERE.
Full spec: `docs/superpowers/specs/2026-07-08-lab-proving-ground.md`. Mutation scope: builds on the safe
16 recs + already-armed gates; NEW tweaks beyond the frozen catalog stay a LOCKED-rule-6 owner decision.
Build: flag `compy_lab_ground` DEFAULT OFF, 4 phases, P-series eyeball. **No longer owner-bound — mine to
build.**
**🟢 PHASE 1 SHIPPED behind flag (`d0e30f5`, LIVE 2026-07-09, DEFAULT OFF):** Optimize merged INTO the Lab as
ONE slim room — FAST PATH (Check + Fix "Apply all safe fixes" enable-all, no benchmark, zero new IPC, rollback-first
intact) beside the UTILITY PATH (the measure→prove `ground` spine: intake router + numbered stations, collapsing
bento/guided/classic into one). Frontend-only (`git diff -- src-tauri` EMPTY), flag-off byte-identity test-pinned.

**🟢 BLENDED-SPINE MARATHON COMPLETE + SHIPPED behind flag (`d0e30f5`→`f16d158`, installer `0B4D15A0…6BD9`, DEFAULT
OFF, 2026-07-09):** the owner rejected the phase-1 "verbatim merge" seam (`.lg-fast` box stacked over `.lg-utility`)
and asked for a *blended* room. Rebuilt on ONE numbered spine + the marathon phases landed:

- **§8 blended spine (`4410bec`):** the tweak-apply is now **station 1 "Optimize"** — a NATIVE member of the Lab's
  numbered spine (same four-line contract/badge/frame as stations 2–6, no seam); `LabGround` is thin, `LabGround.css`
  deleted.
- **§2b Two Futures measured split (`47c57f5`):** wired as the Benchmark station's "prove it" payoff (per-part
  measured `Efficacy` emphasis) — this is item **B** above, resolved inside the Lab.
- **§2a aggregate-stack A/B (`6d49f10`, DARK, `stack_trial_gate` OFF):** the honest cumulative-benefit engine — apply
  the whole safe stack in one UAC → measure the cumulative delta → roll it ALL back (multi-change Drop-guard; reuses
  the audited batch path, NO new mutation primitive; mutation-gate 10/10 + rust-tauri-reviewer CONFIRMED-fix). Arming
  is a separate reviewed commit after live QA + owner sign-off.
- **§3 telemetry GALLERY (`330cd5c`) — this realizes item §A.1:** a panoramic drag-shell (OrbitControls) + fly-to-piece
  (the `TourCamera` primitive lifted into a shared `FlyCamera`), populated from scoreboard / sessions / ledger /
  black-box (all existing IPC). THE LAW held: every piece traces to a real measured struct (`buildGalleryPieces`,
  hard-tested), empty→empty, incidents never glow, reduced-motion static grid. **Honest realization note:** pieces are
  anchored to their rig part by **part-identity colour** (a ring of tiles), NOT by literal 3D placement at the rig
  mesh — the "drag to explore a measured space + click a piece to inspect" feel is delivered; a rig-geometry-anchored
  variant would be a follow-up if the owner wants it.
- **§5 armed-feature Power bay (`0412e0f`, FE-only):** gaming_mode + service-suspend surfaced as a read-first,
  apply-behind-confirm "Power features" bay in station 1 (debloat/telemetry-task disable already lives in the fixes
  surface) — the same audited reversible controls, gathered to be proven at the Benchmark station.

- **Finalize self-review (`f16d158`):** the finalize self-reviewer FAILed on 2 real defects I introduced → both
  fixed + bug→guard'd, re-review PASS: (i) duplicate Gaming-Mode recovery banner on the Lab tab (§5 embed) — the
  suppression now covers a `TABS_EMBEDDING_GAMING_MODE` set; (ii) gallery captions unreadable on a big history (§3) —
  3D scene capped to the 24 most-recent tiles + ring radius ≤10.5 + closer rest camera + bigger caption font (the
  full set stays in the reduced-motion grid, honest "showing N most recent" footer).

tsc 0 · full vitest **1145/1145** · cargo **688** + clippy clean · flag-off byte-identity test-pinned · `git diff --
src-tauri` empty for §3/§5/§8 (the only src-tauri change is §2a's DARK-gated trial) · self-reviewer **PASS** (re-review
f16d158). **Still OPEN:** Phase 4 (catalog-expansion pipeline — a SEPARATE gated track, per-tweak mutation-gate); the
slice-1 Optimize-rail TAB removal + full rail collapse (**deferred, owner call — the standalone Optimize tab still
coexists with Lab station 1 during preview; this is the ONE open eyeball decision**). **Still NOT built from §A (this
marathon only realized A.1's gallery):** ~~the rest of the JARVIS motion stack — GSAP data-reactivity (A.2), magnetic
cursor (A.3), Lenis smooth-scroll spine (A.5), room-transition wipe (A.6) — remain 🔴 OPEN~~ → **built 2026-07-12
(`1d310e1`, flag `compy_jarvis_motion` DEFAULT OFF — see §A above).**
⏳ Owner eyeball: flip Settings → Appearance → "Lab proving ground (preview)", open Lab — station 1 leads with the
enable-all + Power features, the measure stations follow, the Gallery closes the room. React + confirm the deferred
Optimize-tab call before it flips default-ON.

**🟢 REDIRECTED AGAIN → "OPS CONSOLE" Phase 1 SHIPPED behind flag (`403be45`→`63585e9`, installer `62DF3FF1…604DD`,
DEFAULT OFF, 2026-07-09):** the owner eyeballed the Instrument-Bench bento and **rejected it too** ("generic slop / wide
horizontal boxes"). Brainstorming → 3 interactive HUD mockups (Artifact `e2830b73…`) → owner picked **A · Ops Console**:
a spatial game-HUD — the real 3D rig hologram at center, corner arc gauges, a magnify Dock of stations. Direction LOCKED
spec `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`, plan `…/plans/2026-07-09-console-hud-phase1-lab.md`.
Phase 1 (Tasks 1–6) built + shipped behind the SAME `compy_lab_ground` flag:
- **`LabConsole` — the Ops Console (`b18f498`):** replaces the rejected `LabBench` bento (**DELETED**). Real `RigViewer`
  hologram (chromeless) at center in a bracketed stage · four honest corner **ArcGauge**s (Readiness · Avg FPS · Safe stack ·
  1% low — `null` source ⇒ honest NOT-YET, never a fabricated number) · a magnify **Dock** (Optimize the glowing theme-accent
  primary, **opens on click** not always-on; measure bays Diagnostics/Benchmark/Latency/Tuning/Black Box, one detail at a time,
  no Gallery). Reusable Console kit `src/design/console/` (ArcGauge/Sparkline/Dock/ReticleCursor).
- **Reactivity + reticle (`e0f5a62`):** cursor-follow accent spotlight + staggered mount reveal (`@keyframes v2-lc-rise`) +
  a stage-scoped **reticle Target Cursor** (a real slice of the JARVIS motion the §A stack was missing) — all
  reduced-motion-gated, vendor purple `132,0,255` can never paint (test-pinned).
- **Self-review + ship + whole-branch review (`1b8c102`→`63585e9`):** self-review pass #1 FAILed (RigViewer footer form
  collided with the corner gauges) → chromeless RigViewer mode + spotlight reset → re-review **PASS**. Final whole-branch review
  (opus, base `b23a97e`) then caught a CRITICAL honesty-rail bug — the Safe-stack gauge showed a fabricated "0 · measured" while
  recs were unloaded — fixed to honest NOT-YET in `63585e9` (+ reticle rAF stop-on-leave + chromeless fan-poll skip; 2 bug→guard
  pins); post-fix self-reviewer **PASS**. tsc 0 · vitest **1158** (158 files) · `git diff b23a97e..63585e9 -- src-tauri` EMPTY.
  Stamp-verified `63585e9` LIVE, one installer on the Desktop.

<details><summary>Superseded interim: "The Instrument Bench" bento Phase 1 (`403be45`) — owner-rejected on eyeball</summary>

The prior redirect after the blended-spine marathon: a **bento grid of living station bays**
(`docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md`). Shipped `403be45` (installer `2EF72796…B9231`),
then owner-rejected as generic slop — replaced by the Ops Console above. Phase 1 (Tasks 2–5) as built:
- **Task 1 — gallery DELETED (`2de8d17`):** the rejected drag telemetry gallery removed entirely (this UNBUILDS the §A.1
  realization above — the panoramic-gallery ask is retired, not shipped; the JARVIS motion is redirected onto the real
  bench + hologram per the approved proposal, not a sister-site scroll clone).
- **Task 2 — `LabBench` bento grid (`02a1129`):** replaces `<Lab v2 ground>`'s linear spine. HERO bay = station 1
  "Optimize" (enable-all fast path, inline, same audited `apply_recommendations_batch`, zero new IPC); 5 measure bays
  (Diagnostics/Benchmark/Latency/Tuning/Black Box) as compact doors, one detail at a time. Vendor purple can never paint.
- **Task 3 — bolder reactivity (`3cb01eb`):** accent spotlight + tilt/magnetism + hover-lift + staggered mount reveal
  (this DELIVERS a first slice of the JARVIS motion the §A stack was missing — GSAP-driven, reduced-motion-gated).
- **Task 4 — data-reactive hero gauge (`77d0233`):** a GSAP count-up ring (A.2 realized, honestly) bound to the measured
  applied/total safe stack — `null` source ⇒ renders nothing (honesty rail: no fabricated number ever animates).
- **Task 5 — self-review + ship (`403be45`):** self-reviewer caught 3 real defects (hero row-stretch, dead hover-lift,
  vendor-purple hover leak) → fixed CSS-only + 3 bug→guard pins → re-review **PASS**. tsc 0 · vitest **1151** · cargo
  **688** · `git diff f16d158..403be45 -- src-tauri` EMPTY. Stamp-verified `403be45` LIVE, one installer on the Desktop.

</details>

**🟢 Owner round-1 feedback landed (2026-07-10) → shipped same day (`1a9f44f`):** **Optimize open-on-click CONFIRMED**
("cleaner") + the new **header-slop law** — tab header space carries header-format text only; small always-on
descriptive lines relocate to their context element. Shipped: the four rooms' `.v2-measured` strips removed, the Lab
header cut to eyebrow + headline, the console lede deleted (undo promise → the Optimize panel), law mechanized as
self-reviewer rubric item 6. Every Phase 2…N tab adoption must pass this as an exit check.

**Still 🔴 OPEN after Ops Console Phase 1:** Phases 2–4 = the per-tab Console rollout (Home cold-open · Monitor gauges + a
real `Oscilloscope` kit bound to live telemetry · History/Black Box flight-recorder log · Gaming Mode arm/engage console ·
Settings quiet chrome · then the app-wide viewport HUD frame + global reticle). Still folds in the remaining §A JARVIS stack
(decode-text A.3 · hologram inertia A.4 / room-transition wipe A.6 · Lenis spine A.5) — **the
A.2/A.3/A.5/A.6 core shipped 2026-07-12 (`1d310e1`, `compy_jarvis_motion` DEFAULT OFF, §A above);
per-tab Console rollout can now assume the layer exists behind its flag.** **Both owner-gated calls RESOLVED
2026-07-10:** Optimize panel **open-on-click confirmed** ("cleaner") · the standalone **Optimize rail tab DROPS at
default-ON** (owner call; the removal ships with the default-ON flip, after the eyeball). Phase-2 (Home cold-open) plan
committed: `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md` (entry-gated on the round-2 eyeball).
✅ **Eyeball gate CLEARED (owner round-4 "ALL GOOD", 2026-07-10) → default-ON + tab drop SHIPPED LIVE `59249bb`:**
the Ops Console Lab is the default, the rail is Home · Monitor · Blackbook · Lab, and the Lab's Optimize station is
the one door (with the "Applied & history" ledger disclosure inside — the self-reviewer's reachability catch, fixed
pre-ship). `compy_lab_ground="0"` = the classic failsafe. Phases 2–4 are UNBLOCKED; Phase-2 Home cold-open is next.
🟢 **Phase-2 Home cold-open BUILT + SHIPPED `72d9b6e` (2026-07-10)** — hologram center-stage in the bracketed
console stage, 4 honest corner gauges, HomeHud's masthead register, #1-limiter readout with the Lab jump, and
the room Dock (Monitor · Blackbook · Lab doors, Lab primary; ONE forward affordance — the ForwardDoor
suppression was the self-reviewer's duplication catch, guard-pinned). Motion: spotlight · reveal · reticle ·
parallax, reduced ⇒ still. ✅ **OWNER APPROVED 2026-07-10 ("everything looks good") → DEFAULT ON shipped
`bce72d6`** (Settings row now "Home console"; "0" = the classic failsafe). **Phase 3 (Monitor) is next — plan
written:** `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md` (flag `compy_monitor_console`
DEFAULT OFF · NEW `Oscilloscope` kit component on the real live telemetry · builds in a fresh session).

**🟢 PHASE 4 (Blackbook console) — BUILT + SHIPPED behind flag `617db5b` (2026-07-12, installer `43234A53…943D5`, stamp-verified); owner eyeball is the open gate.**
Committed `617db5b` (`feat(blackbook): Console Phase 4 Logbook behind compy_blackbook_console DEFAULT OFF`),
silent-reinstalled + stamp-verified live. The Logbook face renders behind `compy_blackbook_console` (DEFAULT
OFF; Settings → Appearance → "Blackbook console (preview)"): a hairline flight-recorder tape of your
changes/sessions/guide-checks synthesized by the pure `buildLogbook` over EXISTING data (zero new IPC/`src-tauri`),
field guide reachable via a Logbook|Field-guide toggle, `"0"`/absent = today's Learn library byte-identical. Pure
READ view — an active change routes to the Lab (the one undo home), zero mutations. tsc 0 · vitest 1560/175 ·
self-reviewer round-2 PASS. **Open:** owner one-flip eyeball → default-ON or iterate (same pattern as Home/Monitor/JARVIS).
One known follow-up folded into the shared accent-lock owner-taste call (room `.bc-*` chrome locks to `#a78bfa`
under Crimson via the systemic `--ix-accent → --v2-accent` re-point; identical on Monitor/Lab, 0 vendor-purple).
→ ✅ **RESOLVED direction (owner 2026-07-12): "per-room identity"** — Blackbook = amber, built behind
`compy_room_identity` **DEFAULT OFF** (`72fa005`); owner one-flip eyeball pending (BACKLOG Cycle 2026-07-12i,
OWNER_ACTION_CHECKLIST §A9).

**Superseded (history):** ~~CONCEPT OUT + owner PICKED "A · The Logbook" (2026-07-12); build queued.~~
Per the per-tab signature process rule (concept before code), the Blackbook rollout opened with a spitball.
Explore-map finding: **Blackbook is the knowledge LIBRARY today** (186 verified entries + guide-autopsy), NOT a
records room; the spec's "flight-recorder of applied changes + sessions" data lives in the Lab (applied-changes
ledger) + Monitor (sessions), and a DIFFERENT shipped feature already owns the name **"Black Box"** (crash
forensics, `BlackBox.tsx`, in the Lab). So this was a real IA fork, owner-gated. Three grounded directions in one
Artifact <https://claude.ai/code/artifact/b00295a5-97d0-4f33-9703-0ae975951e91>: **A "The Logbook"** (library +
a unified your-record tape) · **B "Flight Recorder"** (scrub-tape hero, library → Reference tab) · **C "Field
Records"** (reskin the library only). ✅ **Owner picked A** ("blackbook looks good" + A); naming default accepted
(room stays "Blackbook", timeline = "the logbook", Lab "Black Box" left alone). Plan written:
`docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md` (flag `compy_blackbook_console` DEFAULT OFF ·
pure `buildLogbook` tape over EXISTING data — zero new IPC/`src-tauri` · rollback reuses the audited path ·
title-header law · honest-empty · reduced-motion still). **Builds in a FRESH session**, then eyeball → default-ON.

### D. CommandPalette / keyboard-first command flow — parked, then dropped
From the product-UI-system brief (Linear/Raycast discipline). Explicitly parked as "new feature,
backlog candidate post-P6, owner call" — and then never mentioned again anywhere.
Source: `docs/superpowers/specs/2026-07-02-design-direction-product-ui-system.md:36,54,83`.

### E. Trending design tooling (Figma / v0-Vercel MCPs) — substituted, awaiting owner's call
De-slop directive point #6 asked for these applied wherever the UI reads as AI-slop-default. They
spend owner-gated credits, so pilots were built in-repo instead. Partially honored via the reactbits/
shadcn registry (Stepper + Lab bento). **Owner decision:** want the real tooling used, or leave it a
deliberate no? Source: `docs/OWNER_ACTION_CHECKLIST.md:59-61`, `docs/BACKLOG.md:53`.

### F. Upgrade-path engine — real feature, still a stub
Owner (2026-07-03): *"just slapping an Amazon + Newegg link for GPUs isn't the feature."* The advisory
upgrade path is underdeveloped. Flagged as never fully built.
Source: `docs/superpowers/specs/2026-07-03-owner-optimize-feedback.md`, `docs/OWNER_ACTION_CHECKLIST.md` §B4.

### G. 🔴 SITE FULL MAKEOVER — owner-commissioned 2026-07-14 (the dormant trigger FIRED, for the site)
History: the 2026-06-12 voice-baptism directive queued **§B0 site glow** + a dormant **§C FULL
OVERHAUL** trigger (*"only if §B underwhelms the owner"*) that no later doc revisited
(`docs/superpowers/specs/2026-06-12-doctrine-voice-baptism-design-refresh.md:31-80`).
**2026-07-14: the owner saw the shipped two-strip hero (`2eda4eb`) and rejected it outright** —
*"i do not like the hero site at all and i think it needs a complete makeover"*. The site-side
trigger is now FIRED and owner-directed. His verbatim requirements:
- **Research-first, decide together** — deep research on trending web design styles for this space,
  "spitball what you come up with to me and we can decide together." NOT build-first.
- **Awwwards-level, state-of-the-art** — *"like our website was made with the funding that fuels
  SpaceX itself"* — while retaining *"modest credibility and integrity pertaining to what we really
  are selling."* Use **React Bits** and other web-design tools.
- **Dark mode default** — *"everyone hates getting flashbanged."*
- **Sell/show off the app hard, without exhausting navigation** — a visitor who just wants to buy a
  subscription and move on gets a fast path.
- **FAQ page/section** · **comparison page vs competitors** ("that obviously make us look good") ·
  **maybe a mini playable demo of ONE real Compy tool in a simulated environment.**
- **LATER** (owner: "maybe later once weve completed the important stuff"): walkthrough videos + an
  app-tour preview video on the home page.
Constraints that survive the redesign: honest-measurement law (real-provenance receipts, no gain
claims — `scripts/site-landing.test.mjs` guards stay in spirit), zero-budget law ($0/free-tier,
Cloudflare Pages), site PRE-PUBLISH until the owner's deploy GO. The APP-side §C overhaul trigger
stays dormant (app visual work continues under §A–§F).

### H. ~~Onboarding HoloLens Setup & Tour redesign~~ — ✅ SHIPPED (verified 2026-07-08)
The hardware-tour flies the camera across the user's REAL rig in the owner's order — `HARDWARE_LESSONS`
literally ordered psu→storage→gpu→cpu→ram (`setup-steps.ts:103`), parts from `buildRigParts(hw)` real
hardware, `TourCamera` lerps per `focusId` (`HardwareTourScene.tsx:131`), re-runnable from both Home
surfaces via `compy:start-tour` (`SetupLauncherCard.tsx`, `App.tsx:558`). Not open work.

---

## ✅ VERIFIED SHIPPED (2026-07-08 code check — were "claimed-done," now confirmed)

- **V2 "four asks"** — ALL shipped: two-tier elevation layering (`tokens-v2.css:15` `--v2-panel`/`-2`
  used across every room CSS) · hologram auto-scales (`RigHologram.tsx:45` `FitCamera` reads window
  size) · "What's this?" in-place hover popover, nav only on explicit "More →" (`WhatsThis.tsx:37`) ·
  Optimize nav-jank fixed via keepalive mount (`App.tsx:1325`). Plus V2 shipped as default + failsafe
  removed (`main.tsx:67`).
- **Hardware grid on Home** — built + wired (`HardwareGrid.tsx` in HomeV2/HomeHud), reachable via the
  Cards↔3D toggle; **3D hologram is the default stage** (`compy_home_rig_3d !== "0"`). Not a regression;
  it's the alternate segment. (If you want the grid visible by default, that's a one-line default flip —
  say so.)
- **"What's this?" / HoloLens tour / click-for-specs** — see ✅ items above and §A.4.

## 🟡 STILL UNVERIFIED — older asks not yet code-checked (lower priority)

- **"Full tidy" left-to-right usage order** — ground-up rewrite rejected for the P6 Journey
  "forward-doors" pass (a substitution; P6 shipped). `2026-07-02-full-tidy-directive.md:1-8`.
- **Elastic/erratic-window adaptive layout** — reads resolved-in-doc, final blessing uncaptured.
  `2026-06-06-elastic-window-pass.md`.
- **Intuitiveness sweep** (full-app confusion weed-out) · **Beta Feedback #3** six-part list ·
  **"Show me" walkthroughs** · **naming** (Fix→Tune / Learn→Blackbook / Ledger→"Receipts") · **icon**
  heartbeat-in-the-C · **Hearth "Warm Ember"** hex. Older, likely shipped — spot-check when touched.
- **Monitor room default** — spec said Sessions-default, but owner REVERSED to **Live-default**
  2026-06-26 (`Monitor.tsx:14` comment). Code matches the newer ruling. **Not open — resolved.**

---

## ✅ THE "CC BRIEF" IS RECOVERED (correction, 2026-07-08)
The owner's **"Feature Roadmap Checklist (CC Brief)"** is NOT missing — its full content lives in
`docs/superpowers/plans/2026-06-21-roadmap-sequencing.md` (a 17-agent classification of every item
into Phase A/B/C/D). It is **mostly backend/feature scope, not visual** — Phase A's ~137 allowed-now
items (detection, measurement, content, advisory surfaces) were largely shipped in the 2026-06-25
lane bursts; Phases B/C/D are the gated-mutation / telemetry / money tracks tracked in
`docs/RELEASE_STATE.md` + `docs/BACKLOG.md`. So the CC Brief is a **separate, largely-delivered
backend roadmap** — the owner's *visual/UI* vision (this file's 🔴 OPEN section) is the part that was
actually dropped. Residual Phase-A items with a UI surface are folded into the 🟡 verification list
above where relevant. (An earlier version of this file wrongly said the brief was unrecoverable — it
isn't; do not ask the owner to re-share it.)

---

## ✅ SHIPPED (design history — traceability, not action)
Instrument-HUD reskin across all 5 rooms (default-ON) · graded Home session numbers · hologram cutoff
fix · walk-the-bench → symptom router · Lab bento · Setup stepper · hologram bay v2 (clear-spot,
per-part identity colors, shell-blink fix) · Two Futures split v1 (flag OFF) · P6 Journey forward-doors
· V2 shell + nits/fill pass · Halfway-Home theme dial-back · Blackbook/Tune renames. Full per-build
detail: `docs/RELEASE_STATE.md` + `docs/CHANGELOG.md`.

---

## How to use this file
- **Resume / "what's left on the UI?":** read the 🔴 OPEN section — that's the actionable vision work.
- **Before claiming any redesign lane "complete":** check that its OPEN items here are closed, not just
  the reskin. A "COMPLETE" checkbox that leaves 🔴 items is how this dropped the first time.
- **When the owner gives a new UI ask:** add it here with a citation the same session, and (if it needs
  his hands/eyes/taste) cross-link it in `docs/OWNER_ACTION_CHECKLIST.md`.
- **Substitutions:** if you ship a simpler thing than the owner asked, it is NOT done — log it here as a
  substitution needing his sign-off, never silently close it.
