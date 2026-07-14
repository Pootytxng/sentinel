# Compy — Backlog steering-log ARCHIVE

> Older HQ STEERING LOG cycles, moved out of `docs/BACKLOG.md` (2026-07-13 usage-audit boot-tax fix:
> the live ledger keeps only the newest ~12 cycles; every session was paying ~55k tokens to read the
> full history at boot). Same format, newest on top. Grep here for any cycle older than the live board.
> Current truth lives in docs/RELEASE_STATE.md — these are point-in-time records.

### Cycle 2026-07-12f — ✅ RELEASE_STATE table-drift fixed (`6824ab0`) + ✅ PHASE-4 BLACKBOOK CONSOLE CONCEPT OUT → owner PICKED "A · The Logbook"; build queued (fresh session)

**Resume (`/clear`, live `fcc400b`).** Ground truth re-verified: clean `main`, live exe stamps
`fcc400b` (JARVIS default-ON), one Desktop installer re-hashed to `DFE827D1…FB59` (matches the
banner), no parallel Cowork lane. **Drift caught + fixed (`6824ab0`):** `f15e2c5` added the `fcc400b`
default-ON RELEASE_STATE *banner* but left the *table's* Git-HEAD + Current-installer rows citing the
superseded `1d310e1`/`8EB6185D` DEFAULT-OFF installer; `verify-release-state.mjs` passed 36/36 because
it audits only code `path:line` citations, not installer-SHA prose. Both rows re-pointed.

**Next train = Console-HUD Phase 4 (Blackbook).** Per the locked build order it's the next per-tab
rollout (after Home default-ON, Monitor eyeball-pending); per the owner's per-tab signature process
rule ("spitball … before we do it") the concept comes BEFORE code. An Explore map surfaced a real IA
fork: **Blackbook today is the knowledge LIBRARY** (186 verified entries + "autopsy a guide"), NOT a
records room — the spec's "flight-recorder of applied changes + sessions" data lives in three OTHER
rooms (applied changes → Lab · sessions → Monitor) and there's already a shipped feature literally
named **"Black Box"** (crash forensics) in the Lab (naming collision flagged). So the premise is an
owner-territory decision, not a reskin. **Concept round OUT (mockup-first):** Artifact
<https://claude.ai/code/artifact/b00295a5-97d0-4f33-9703-0ae975951e91> — A "The Logbook" (library +
a unified your-changes/sessions/autopsy tape) · B "Flight Recorder" (scrub-tape IS the room) · C
"Field Records" (reskin the library only). **✅ OWNER PICKED same day: "A · The Logbook"** ("blackbook
looks good" + A); naming default accepted (room stays "Blackbook", timeline = "the logbook", Lab
"Black Box" left alone).
- **Build plan written + entry gate cleared:** `docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md`
  (flag `compy_blackbook_console` DEFAULT OFF · pure `buildLogbook` tape builder over EXISTING data —
  zero new IPC, zero `src-tauri` · rollback reuses the audited `rollback_change` path, mutation-gate
  glance · title-header law · honest-empty · reduced-motion still · naming guard).
- ⛳ **RESUME (next train, FRESH session): build Phase 4 "The Logbook" from that plan.** Then eyeball →
  default-ON (Home/Monitor pattern).

### Cycle 2026-07-12e — ✅ JARVIS MOTION LAYER FLIPPED DEFAULT-ON (owner eyeball "everything looks good", 2026-07-12)

**Owner gave the looks-good verdict on the JARVIS motion layer** (Cycle 2026-07-12c's open gate — he'd
been living with it pre-enabled on the live `1d310e1` build). Per [[ship-approved-work-as-the-build]]
the approved preview flips to the build: `compy_jarvis_motion` **DEFAULT OFF → DEFAULT ON** via the
`!=="0"` failsafe pattern (`readJarvisMotion` in `src/design/theme.ts` + the `main.tsx` pre-paint
boot attr), Settings row dropped "(preview)" → "JARVIS motion" (now the OFF failsafe), stale
DEFAULT-OFF comments in `use-jarvis.ts`/`ShellV2.tsx` corrected. **bug→guard:** the byte-identity
anchor in `jarvis-motion.test.tsx` re-pinned from key-absent to explicit `"0"` (absence now = ON) +
a new positive default-ON assertion (key-absent renders the live layer). Zero `src-tauri`. Verify:
tsc 0 · vitest **1522** (172 files). Built + silent-reinstalled + stamp-verified live; installer
SHA-256 + commit in the RELEASE_STATE Snapshot row. This build also carries the Cycle 2026-07-12d
naming-drift fixes (they ride this installer).
- ~~⏳ OPEN GATE (2026-07-12c): owner eyeball~~ → ✅ CLOSED — approved + flipped default-ON.

### Cycle 2026-07-12d — ✅ NAMING-DRIFT MAINTENANCE SWEEP DONE (owner-triggered, "get on track") — 4 user-facing leaks fixed + guard extended; JARVIS eyeball still the open gate

**Trigger:** while handing off the JARVIS build for eyeball, I told the owner to open the
"**Learn**" room. "Learn" is a RETIRED label — I read the internal `HomeRailId` id `learn` and
typed it as a tab name. Owner (rightly) flagged state-drift and ordered a **full maintenance sweep**.

**GROUND TRUTH (verified this session — `src/design/homeRail.ts`):** the shipped rail (ground,
default-ON) is **Home · Monitor · Blackbook · Lab**. Internal ids `learn`/`play`/`fix`/`check` are
KEPT as persisted nav keys (renaming them orphans stored history) — NOT defects. Label renames the
USER must see: **Play→Monitor · Fix→Tune (Optimize in the merge rail) · Learn→Blackbook · Check→folded
into the Lab's Optimize station.** A DEFECT = a retired label in VISIBLE copy (header/button/tooltip/
aria/prose/notification/empty-state). Existing partial guard: `src/stale-reference-guard.test.ts`
(only the Blackbook DATA json — `<X> tab`), `src/data/jargon-guard.test.ts`.

**Already fixed:** my fresh doc drift — `docs/OWNER_ACTION_CHECKLIST.md` §A7 "Blackbook/Learn" → "Blackbook".

**RESULT (workflow `wf_c688d119-49b` completed in background + completeness-critic grep + manual verify).**
Honest count: **4 confirmed user-facing leaks fixed · 3 rejected false positives · 1 live-doc drift.**
The multi-agent sweep alone would have UNDER-reported (harness dropped one confirmed verdict to a
StructuredOutput format error; it missed one leak entirely) — the completeness grep + transcript
recovery closed both gaps ([[audit-needs-completeness-critic-grep]]).

- **Fixed (4):** `src/data/tweaks.json:468` "Compy's Check" → "The Lab's Optimize station" (Blackbook
  prose; the possessive form slipped the old `<Name> tab`-only guard) · `src/design/Term.tsx:63` "More
  in the library →" → "More in the Blackbook →" (glossary tooltip on 12 surfaces; + `Term.test.tsx`
  pin updated) · `src/surfaces/TuningInstrument.tsx:75` "a Play debrief" → "a Monitor debrief" (Lab
  empty state) · `src/surfaces/blackbook-v2-data.ts:20` "search the library" → "search the Blackbook"
  (Blackbook empty state; my grep caught this — the finders missed it; + `blackbook-v2.test.tsx` pin).
- **Rejected (3, correctly left alone):** TrustMoment.tsx:131/146 + SetupTour.tsx:261 "Trust Ledger"
  — that's the CURRENT live brand, not retired (coexists with the narrower "Applied & history" Lab
  disclosure label). Also confirmed NOT-a-leak: `setup-steps.ts:161` "The Check tab" (classic-rail raw
  tie, remapped to "The Lab scans…" under the ground rail — contextually correct).
- **bug→guard:** `src/stale-reference-guard.test.ts` extended — now also scans `src/surfaces/**` +
  `src/design/**` rendered copy (comments stripped) for `(Play|Learn|Fix)`-as-room, the "library"
  brand, and `Compy's <Retired>`. Red-green proven on all 4 leaks; per-file assertions + a floor on
  files-scanned (no false-green on a broken glob).
- **doc-sync:** `DESIGN.md:111` rail line → "Home · Monitor · Blackbook · Lab" + the id-vs-label note.
  **PRODUCT.md and CLAUDE.md were VERIFIED CLEAN** — the resume note's "they still list …" was an
  unverified assumption; only DESIGN.md actually had the stale rail. CHANGELOG/archive/spec hits are
  dated point-in-time records, left as-is.
- **Memory saved:** [[room-labels-vs-nav-ids]] (rail = Home·Monitor·Blackbook·Lab; never speak an id).
- **Verify:** tsc 0 · vitest **1521** (172 files) green, incl. the extended guard. Self-reviewer
  dispatched on the two `.tsx` copy changes (verdict pending at write time).

**JARVIS eyeball still open** (Cycle 2026-07-12c): installed app is live `1d310e1`, JARVIS flag
PRE-ENABLED for the owner (persisted in localStorage, survives restart), clean launch no debug port.

### Cycle 2026-07-12c — ✅ JARVIS MOTION LAYER BUILT + SHIPPED LIVE `1d310e1` (installer SHA-256 `8EB6185D…812D10`, embedded-hash-verified; NEW flag `compy_jarvis_motion` DEFAULT OFF) — owner eyeball = the open gate

**The UI_VISION_BACKLOG §A.2/A.3/A.5/A.6 train** (rails: de-slop directive `:111-176`; the motion
layer the reskin substituted away). Built as ONE flag-gated layer: **A.5** Lenis spine on `.v2-content`
(`lenis@1.3.25`, active-only dynamic import, nested-scroller auto-yield, rAF stops on hidden) ·
**A.6** room-retune wipe (300ms accent hairline, transform-only, never first-paint/flag-flip, native
animationend self-removal — React 19's synthetic onAnimationEnd doesn't fire in this webview) ·
**A.3** magnetic rail tabs (GSAP quickTo ≤4px; Dock excluded — owns the magnify lift) + Home stage
chrome tilt ≤2.4° off the existing `--hc-px/--hc-py` vars (canvas never tilts) · **A.2** gauge
data-tick (GSAP ring flash on real→real measured change ONLY; hologram shader uniforms deliberately
excluded — demand-frameloop idle-GPU law, deviation disclosed in UI_VISION_BACKLOG §A.2). Guards:
`src/design/jarvis/jarvis-motion.test.tsx` (flag-off byte-identity · reduced-wins incl. mid-session ·
honest-tick ×5 · wipe lifecycle). Verify: tsc 0 · vitest **1364** (172 files) · `git diff -- src-tauri`
EMPTY · self-reviewer **PASS 8/8** (flag-on-at-rest chrome = identity matrix; GL idle 0 draws/16s;
rail circuit ≲50ms, sole 58ms outlier on the flag-OFF baseline). Docs: UI_VISION_BACKLOG §A flipped
🟢-behind-flag, RELEASE_STATE banner+installer rows, OWNER_ACTION_CHECKLIST §A7 eyeball row.
- ⏳ **OPEN GATE: owner eyeball** — Settings → Appearance → "JARVIS motion (preview)" (checklist §A7);
  looks-good ⇒ default-ON flip rides its own commit (the Home-console pattern).

### Cycle 2026-07-12b — ✅ Home title-header fix SHIPPED LIVE `cc1ffce` (the last non-gated `[ ]`); Cowork audit correction committed

**Resume found no open train; the one non-gated `[ ]` was the Cycle 2026-07-11e flagged
title-header violation** — HomeConsole's h1 rendered postureLine's status sentence. Shipped
`cc1ffce`: h1 = eyebrow + "Home" (title only, sub line gone from the header); the posture
verdict + trimmed dek relocate to the new `.hc-verdict` body strip above the stage
(postureLine's real output rendered exactly ONCE — one-mention law; attention state inks warn,
agreeing with the LED; strip joins the mount stagger). Scoped like the rooms' `626b83c` sweep
(live face only; HomeHud/HomeV2 devtools-only failsafes untouched). Guards re-anchored +
extended in `home-console.test.tsx` (title pin · one-mention pin · attention tone pin · no-sub
pin). Verify: tsc 0 · vitest **1351** (171 files) · zero src-tauri · self-reviewer **PASS 8/8**
(live 1500×980, REAL rig data incl. a real attention state; contrast 16.78:1 / 6.51:1;
reduced-motion still; no stage collision). Ship: installer `4F4DB63A…FB45B931`,
silent-reinstalled, **stamp-verified `cc1ffce` live**, one installer on the Desktop.
Also this session: **Cowork's 2026-07-11 audit self-correction committed as-is (`e1cec74`)** —
its uncommitted rewrite disclosing the partly-fabricated round-1 sections + the real re-run;
committed isolated so it can't be swept into an unrelated train.
**Open out of this cycle:**
- [ ] Flagged, pre-existing (self-reviewer finding, NOT this diff): the ShellV2 topbar's static
  per-room tagline (`ROOM_CRUMB`, `src/design/ShellV2.tsx:19` — e.g. "Home · how your PC is
  doing") sits directly above the room header and reads like the standing-descriptive-line
  class the title-header law targets — needs an owner-taste read (topbar chrome vs header
  space) before any sweep; don't silently delete.

### Cycle 2026-07-12a — ✅ dist-site staleness bug→guard + Q3 expert-layer GO filed

**Cowork audit 2026-07-11 relayed two items; both landed.** (1) The gitignored deploy staging tree
`dist-site/` still claimed "174 entries" while the library holds **191** (84 tweaks · 85 terms ·
14 tricks · 8 guides — `loadLibrary()` verified) — root cause: staging was a manual, undocumented
copy. Fix = `scripts/stage-dist-site.mjs` (`npm run stage:site` — regenerates from live data, clean
rm+mirror of site/ minus tooling + functions/; deploy stays owner-gated). bug→guard:
`scripts/dist-site-staleness-guard.test.mjs` (Guard A: every committed site/ page's stated count ==
data count · Guard B: dist-site, when present, is a byte-exact complete mirror — **red proven on
the stale 174 tree, green after staging**). The committed `site/` tree was already correct at 191;
only the staging artifact had drifted. (2) Q3 expert-layer spec **GO** + added ship condition
recorded (spec Status block + the row below).
**Open out of this cycle:**
- [x] ✅ **BUILT 2026-07-12 `5850ac0`: Expert-view scoped train** — `docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`.
  One genuine Settings preference (`compy_expert_view`, Behavior row beside Motion, default OFF —
  the skeptic face is byte-identical). ON = refused drawer open with reasoning inline · exact
  target (registry/service/powercfg/Settings-path) inline on safe + needs-your-call rows via the
  display-only `src/data/expert-targets.ts` map (transcribed from actions.rs, literal-pinned by
  `expert-targets.test.ts`) · true `local_percentiles` + 1-decimal session/benchmark numbers ·
  long-tail sections render open. **Ship condition MET + mechanized:** the rollback-boundary
  disclaimer renders beside every inline target (`expert-view.test.tsx` pins disclaimer count ==
  target count). Zero `src-tauri` diff (presentation-only, no mutation-gate). Verify: tsc clean ·
  vitest 1350/1350 (171 files, +28 new guards) · self-review PASS (live 1500×980; honest note:
  expert-ON Optimize is a ~10.6-screen scroll — the accepted cost of un-de-emphasizing, not a
  defect; percentile/debrief precision verified by unit tests, no live session data on the rig).

### Cycle 2026-07-11e — ✅ CONSUMER-PANEL OVERHAUL BUILT + SHIPPED `50b5c03` — Q3 expert-layer proposal = the open owner gate

**The five-persona panel plan ran end to end** (`docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md`
— owner's Q1–Q4 answers + per-item commit citations recorded in-file; supersedes the marathon
roadmap doc). One commit `50b5c03` (47 files, zero src-tauri): Phase 0 verified (fully-applied IS
reachable with zero user action — live probe), Phase 1 copy honesty + Term glosses (Monitor bucket
DEFERRED until the v5 eyeball settles — inventory in the plan), Phase 2 readiness formula note +
NEW TrustMoment watch-it-work loop (audited IPC only, ledger-empty gate, HKCU whitelist), Phase 3
site rebalance (kicker↔h1, free above the fold, proof-loop hero, start-here trio, per-card "Why:"),
Phase 4 Q2 flag-debt sweep (11 rows out; failsafes now devtools-only — RELEASE_STATE banners
superseded) + Q4 protection-first recovery reframe. Self-review round 1 FAIL (4 real catches) →
fixed + guard-pinned (`term-style-guard.test.ts`) → round 2 **PASS**. Ship: installer
`653FFEA0…9BADC2`, silent-reinstalled, **stamp-verified `50b5c03` live**, one installer on the
Desktop. Verify: tsc 0 · vitest **1322** (167 files) · site-landing 15/15.
**Open gates out of this cycle:**
- [x] ✅ Q3 expert-layer middle ground — **GO (2026-07-12**, source-verified by the Cowork audit;
  verdict + one added ship condition recorded in the spec's Status block). Build row lives in
  Cycle 2026-07-12a.
- [x] ✅ **DONE 2026-07-13 `530ef8b`** (shipped live, installer `703F078B…B99EE40B8`, stamp-verified):
  Monitor-surface jargon glosses (deferred bucket). Sequencing gate cleared — the Monitor v5 console
  flipped DEFAULT-ON (`e195f70`). The one user-facing gap on the default face was the DeckScope hero's
  raw "frametime" label (the sibling Play face + Deep-Monitoring section-help already glossed it);
  fixed via `Oscilloscope.label` `string→ReactNode` + `<Term id="frametime">` on the DeckScope hero.
  Only "frametime" glossed — FPS/latency/spikes/budget are consumer relabels/self-explanatory/have no
  correct term. tsc 0 · vitest 1607 (+2 guards) · self-reviewer PASS 8/8 · zero `src-tauri`. See
  Cycle 2026-07-13a below.
- [ ] ⏳ OWNER eyeball of this train's visible changes (Home/Lab gauge notes + glosses, Settings
  slimmed to one preview row, calm recovery banner, site hero) on the live `50b5c03` build.
- [x] ~~Flagged, pre-existing (NOT this train's diff): Home's h1 renders postureLine's status
  sentence ("N thing(s) need your attention") — reads against the title-header law; separate
  pass.~~ → ✅ **SHIPPED `cc1ffce` 2026-07-12** (Cycle 2026-07-12b).

### Cycle 2026-07-11d — ✅ MONITOR v5 "FLIGHT DECK + SESSION STACK" BUILT + SHIPPED `960734c` (flag OFF) — owner eyeball = the open gate

**The 2026-07-11c resume ran to completion:** v5 built from
`docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md`, T1→T5 TDD, one commit each
(`d06a63c` pure data `monitor-stack-profile.ts` 33-test truth-table · `69c8f90` `SessionStack`
small multiples · `255a400` Flight Deck assembly — `DeckScope` scrub/drag-zoom port onto the
frametime Oscilloscope, session-scoped delta row, stack replaces the shelf, **SessionWaterfall +
`waterfall-profile` deleted**, no mode toggle · `0c68553` height/motion polish · `960734c`
recorded-span coverage fix). Self-review on REAL 5-session data (the law the v4 rejection wrote):
round 1 **FAIL** — the 10.5 h Sand session's backend-capped timeline (~2 h recorded) drew as a
sliver (x normalized to `duration_secs`, a shape no fixture exercised); fix = rows draw the
RECORDED span + "first 2h 0m recorded" stated on the row + detail line, pins anchor only inside
coverage, guard-pinned in the profile + stack suites → round 2 **PASS 8/8**. Ship: installer
`A4D3BF98…D147E0`, silent-reinstalled, **stamp-verified `960734c` live**, one installer on the
Desktop. Verify: tsc 0 · vitest 1305 (165 files) · cargo 688. Flag `compy_monitor_console`
**DEFAULT OFF** (flag-off byte-identity re-pinned both `compy_editorial` states).
- **Owner refinement ask same day ("clean up and refine how the actual line on the graph
  looks") → SHIPPED `e900b6a`** (installer `5AE1ED22…C7821236`, stamp-verified live): monotone
  Fritsch–Carlson curves + round joins on stack rows (every real sample kept, dips keep true
  depth — pin-on-minimum verified), round joins on the scope SVG traces; guard-pinned; vitest
  1306 · self-review PASS. RELEASE_STATE row `204d901`.
- **Owner quick-fix ask on the eyeball ("lines need to just be sharpened and sleek no added
  bloom or saturation/thickness") → SHIPPED `f2acb23`** (installer `05399D9D…EA7B7459`,
  stamp-verified live): scope trace glow DELETED (the drop-shadow bloomed theme violet around
  graded ink), all scope strokes `vector-effect: non-scaling-stroke` (the stretched viewBox no
  longer fattens them), trace 1.25px, ink/hue untouched; bug→guard "line discipline" pin in
  `oscilloscope.test.tsx`. tsc 0 · vitest 1307 · self-reviewer PASS 8/8. Same session,
  `a4c95df`: RELEASE_STATE Snapshot table caught up to the live-installer chain (was two
  installers stale; drift script 36/36).
- **Owner round-2 ask on the eyeball ("make the lines not so tightly packed and erratic
  without … taking away from the accuracy … transient spikes … overbearing and chaotic") →
  scope ENVELOPE mode SHIPPED `e02d1ad`** (installer `0AA8E222…F21A55`, stamp-verified live):
  dense ≥120-sample frametime windows draw a faint min–max band (per-bucket TRUE extremes,
  nothing hidden) + a monotone MEDIAN line (shared Fritsch–Carlson extracted to
  `src/design/console/monotone.ts`, SessionStack refactored onto it); spikes/scrub/worst-
  callout stay raw-exact; zoom <120 samples returns the raw polyline; caption states "line =
  typical · band = every frame"; fps scope deliberately raw. Self-review round 1 **FAIL**
  (real catch: the median `<path>` escaped the non-scaling-stroke selector — rendered fat,
  the exact f2acb23 class) → fixed + the line-discipline guard strengthened to selector
  coverage of line/polyline/path → round 2 **PASS** (computed vectorEffect + side-by-side
  stroke-weight proof, live real-density mount). tsc 0 · vitest **1311** · envelope guards
  (truth-table · dense⇒band+path+note · sparse⇒raw · no-prop⇒raw).
- **❌ Envelope REJECTED on sight (owner: "this is atrocious just go do some reasearch on some
  clean and comprehensive looking frametime graphs or just match riva tuners or something") →
  RTSS-style ZERO-ANCHORED scale SHIPPED `915e85b`** (installer `3B3A65C4…B19DAD`,
  stamp-verified live): envelope mode DELETED; research applied (RTSS "graph max" / CapFrameX
  fixed y-range) — the frametime hero draws the RAW per-frame line on a stable 0→`niceCap` ms
  axis (frame-budget landmarks 8.3/16.7/25/33.3/50/100/250) w/ labeled quarter-cap gridlines;
  axis states "0–\<cap\> ms scale · budget X ms". **Root cause named:** window-min/max
  normalization stretched ~3 ms of ordinary jitter to full chart height — THAT was the
  "erratic"; the envelope had treated the symptom. fps/Home traces byte-same ("window"
  default); `monotone.ts` stays (stack rows). Guards: niceCap truth-table · calm-amplitude
  <10% of plot height while spikes tower · raw polyline pinned · labeled gridlines · window
  default pinned. tsc 0 · vitest 1311 · self-reviewer PASS 8/8.
- **⏳ GATE: owner eyeball of v5** — Settings → Appearance → "Monitor console (preview)", both
  modes; the stack half shines with his real 5-session history on screen. Phase 4 (Blackbook
  console) still queues behind this verdict.

### Cycle 2026-07-11c — ❌ MONITOR v4 ROUND-2 VERDICT: "not working out" → CONCEPT ROUND 3 OUT (mockup-first, owner pick pending)

**Owner round-2 eyeball on the `915cb96` rework (verbatim, retained in UI_VISION §A0 item 2):**
*"the monitor tab doesnt seem to be working out like i presumed, unless yo can really just change
it to where it looks more intuitive then maybe just re work the whole thing to something else thats
more likely to be comprehensive."* Read: after two build-rejections on this face (v3 ribbon, v4
waterfall), the depth-stacked-sessions CONCEPT is the problem — stop polishing, re-concept. Per the
mockup-first pattern (resolved the Lab; produced the v4 pick), **concept round 3 shipped as an
interactive Artifact** <https://claude.ai/code/artifact/9ebf6305-e488-422d-b699-0c281b15676c>:
**A "Flight Deck"** (ONE comprehensive face, no modes — live ms-axis scope w/ exact spike pins +
hover scrub, MAX FPS/AVG/LOWEST LATENCY/SPIKES readouts, plain-number "vs last session" delta row,
session shelf) · **B "Session Stack"** (small multiples — every session a flat mini-graph on ONE
shared 1%-low axis, stacked newest-first, worst-dip pin w/ exact clock time per row, delta chip vs
previous, DIFFERENT-GAME labeling) · **C "Debrief Card"** (measured grade + plain-English headline,
two-session side-by-side bars, verdict sentences). All three carry the §A0 binding musts; natural
combine flagged (A's top + B's stack). Same simulated feed across all three, labeled SIMULATED.
OWNER_ACTION_CHECKLIST §A5 updated to the pick.
- ~~⏳ GATE: owner picks A / B / C / combine~~ → **✅ PICKED same day (owner, 2026-07-11):
  "A's top + B's stack"** (mockups verdict: "ooooo ya i like the mockups you sent me").
  ~~**⛳ RESUME (next train, FRESH session): build Monitor v5 "Flight Deck + Session Stack" from
  `docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md`**~~ → ✅ **RAN — see Cycle
  2026-07-11d** (built + shipped `960734c`, flag OFF, owner eyeball open).

### Cycle 2026-07-11b — ✅ DEAD-SURFACE HYGIENE TRAIN (`eb5e62a`+`4a9a6ed`+`257ab32`) — the 2026-07-10j logged candidate executed; Monitor v4 eyeball still the open gate

**With every plain `[ ]` gated and Phase 4 entry-gated on the Monitor v4 round-2 eyeball, the next
non-gated item was the logged dead-surface cleanup** (Cycle 2026-07-10j reviewer finding / UI_VISION
§A.4 caveat). Verified then deleted: `CommandCenter`/`HomeV3`/`HardwareSection`/`OverviewTab`
(unreachable under EVERY flag combo — `v2Shell` is unconditional once hw loads; CommandCenter was
imported only by its own test) + their CSS/tests + the dead `.cc-*` blocks in shared CSS
(`eb5e62a`). Cascade catch: the **ambient-backdrop subsystem was a lying control** — Settings'
"Ambient backdrop" seg + "Step aside when I play" toggle had NO live consumer (only the deleted
CommandCenter mounted `AmbientBackdrop`), i.e. two do-nothing Settings rows in the shipped app →
both rows + `AmbientBackdrop` + the theme.ts ambiance/step-aside helpers removed (`4a9a6ed`;
LivePreview keeps a fixed 3-streak theme preview; stale `compy_ambiance`/`compy_stepaside_game`
localStorage keys simply go unread). Residue sweep `257ab32` (WindowChrome/dashboard-skin dead
selectors, `cc-nav-ico`→`nav-ico`; live `cc-chip` namespace untouched). Kept deliberately:
`CompyHero`+`readCommitted` (the parked `compy_committed` future-landing hero) · `HardwareGrid` /
`command-center-data` (live in the Home consoles). Verify: tsc 0 · vitest **1306** (164 files; −14
tests = the orphans' own suites + ambiance/step-aside pins) · zero src-tauri · self-reviewer
**PASS 8/8** (Settings renders clean where both rows were, segs/theme cards functional, preview
recolors Violet→Emerald, Home+Monitor zero-delta spot-check, no stale wording; its WindowChrome
catch fixed in `257ab32`). Not rebuilt — rides the next installer (the owner's live build still
shows the two dead rows until then; the open eyeball on `915cb96` is unaffected).
- **⏳ Unchanged gate: owner eyeball round 2 on Monitor v4** (Settings → Appearance → "Monitor
  console (preview)", Now + Compare). Phase 4 (Blackbook console) still queues behind it.

### Cycle 2026-07-11a — ✅ MONITOR v4 "SESSION WATERFALL" BUILT + SHIPPED, ❌ ROUND-1 REJECTED on real data, REWORKED → round-2 eyeball open (backfilled 2026-07-11, Cowork audit — this cycle was missing from the log; full detail already lived in RELEASE_STATE.md + UI_VISION_BACKLOG.md §A0 item 2)

**Resuming Cycle 2026-07-10k's cleared gate:** Monitor v4 "Session Waterfall" (B Depth Waterfall + A's
drag-segment) built and shipped `85eb8c6` — LIVE mode (frametime scope, drag-zoom, receding
same-capture snapshots) + SESSIONS mode (last ≤5 sessions, delta strip, dip pins), replacing the
deleted v3 ribbon. Self-review round 1 FAIL (4 real catches, fixed) → round 2 **PASS 8/8** — but that
PASS ran on fixture-scale data. **Owner rejected on his real 5-session data: "this looks absolutely
terrible … what a mess"** — real multi-hour timelines drew as smears, dip pins as a barcode, legend
printed over chart ink, Live/Sessions duplicated the room's own segment labels. **Reworked**
(`082414c` + `915cb96`): `downsampleTimeline` caps drawn samples, `MAX_LAYER_PINS=3`, legend moved off
the stage, modes renamed Now/Compare. Two bug→guards landed from this: draw-density pinned in
`waterfall-profile.test.ts`, and the self-reviewer rubric gained a **"real-density law"** (a PASS
earned only on fixture-scale data is not a PASS — `.claude/agents/self-reviewer.md`).
**⏳ Owner eyeball round 2 is the open gate** (now tracked in `OWNER_ACTION_CHECKLIST.md` §A5, which
had also been missing this item until this same audit pass).

### Cycle 2026-07-10k — ❌ MONITOR v3 RIBBON REJECTED on eyeball → CONCEPT ROUND 2 OUT (interactive mockups, owner pick pending)

**Owner eyeballed the ribbon (screenshot): "this looks sloppy and doesnt make sense … create
something sensible thats achieves the same goal and still incorporates some sort of 3D or just
simpyl interactive graph"** (full verbatim + failure diagnosis retained in UI_VISION §A0 item 2:
the extruded mound had no y-axis/scale, perspective warped magnitude — zero readable values, so the
3D broke his own exact-spike-moment requirement). Per the pattern that resolved the Lab
(build-reject ×2 → interactive mockups → pick), **v4 goes mockup-first**: Artifact
<https://claude.ai/code/artifact/a8e6acf7-54f6-47c4-a1db-d4e1880d8249> — **A Precision Scope**
(interactive 2D: real ms axis, hover-scrub exact frames, drag-zoom, clickable spike chips) ·
**B Depth Waterfall** (depth = TIME: front trace flat + readable, history recedes, spike pins
persist) · **C Bar Skyline** (per-frame columns vs a labeled ms wall on a gridded floor,
drag-orbit, spikes print exact ms). Same simulated feed, budget line, exact-moment markers,
consumer readouts across all three.
- ~~⏳ GATE: owner picks A/B/C~~ → **✅ PICKED same day (owner, 2026-07-10): B + A's drag-segment,
  "leaning more into the previous session comparison … really refining that as a working
  implementation … more comprehensive visually and systematically"** (verbatim retained in the v4
  plan). **⛳ RESUME (next train, FRESH session): build Monitor v4 "Session Waterfall" from
  `docs/superpowers/plans/2026-07-10-monitor-v4-session-waterfall.md`** — entry gate CLEARED; same
  flag `compy_monitor_console` DEFAULT OFF; 2D-canvas waterfall, LIVE mode (front = real 240-frame
  `recent_frametimes_ms` scope w/ drag-zoom + spike moments; depth = same-capture snapshots) +
  SESSIONS mode (depth layers = the last ≤5 sessions' real `stutter_timeline`, dip pins from
  `stutter_events`, delta strip, same-game filter, compy-changes-active tag); ribbon component
  DELETED in T4. Zero new IPC, zero src-tauri.
  Phase 4 (Blackbook console) stays queued behind the Monitor verdict chain.

### Cycle 2026-07-10j — ✅ A0 item 6 CLOSED: consumer-terms preset relabel + rig-hint fix (next non-gated item; Monitor-v3 eyeball still the pending gate)

**With all plain `[ ]` items gated and Phase 4 (Blackbook console) entry-gated on the Monitor-v3
eyeball, the next non-gated item was the owner's A0 decomposition item 6** (consumer-market terms —
the v3 train had covered only the readouts; the exact "Visual Fidelity / Smooth / Clarity" trio he
flagged still labeled the tuning presets) **+ the §A.4 tracked hint-copy residual.** Shipped: preset
trio → **"Max Quality" / "More FPS" / "Lower Latency"** (ids stable, labels test-pinned in
`monitor-view.test.ts`). Self-review round 1 **FAIL** (2 real catches): literal "Max FPS"/"Low
Latency" chips rendered on the SAME screen as the v3 measured "MAX FPS"/"LOWEST LATENCY" stat
readouts (a chip must never read as a measured value → goal-register comparatives; readouts keep the
owner's verbatim stat terms) + the Lower-Latency goal line orphaned its Storage Sense checklist item
(now "free up drive headroom, prioritize the game, and cut background drag"). "High Resolution"
deliberately not used — that preset bundles HDR+VRR, nothing touches resolution (honesty rail; owner
may overrule at eyeball). Round 2 **PASS 8/8**. RigViewer hint → "hover or click a part" (§A.4
residual closed at source) — reviewer finding logged: the CHROMED RigViewer has **no reachable
surface under any flag combo** (`OverviewTab`/`HardwareSection` + `CommandCenter`/`HomeV3` are
orphaned; `App.tsx:1474` renders HomeRoom for "Overview" unconditionally) — dead-surface cleanup is
its own hygiene candidate, not silently done. Verify: tsc 0 · vitest **1253** (166 files, +1 label
pin) · zero src-tauri.
- **⏳ Unchanged gate: owner eyeball** on Settings → Appearance → "Monitor console (preview)"
  (ideally mid-capture) — now also shows the relabeled presets. Phase 4 waits on it.

### Cycle 2026-07-10i — ✅ MONITOR v3 "TELEMETRY RIBBON" SHIPPED LIVE `6932fa7` (installer SHA-256 `E9737D6E…32421E`, stamp-verified; reinstall ran AFTER Palworld closed)

**Owner picked the 3D-ribbon concept and said "continue" — built same session** (plan
`docs/superpowers/plans/2026-07-10-monitor-v3-ribbon.md`, entry gate cleared): `66966ea` Oscilloscope
v2 (full-width window — his caught bug — budget line, exact-moment spike markers, pure `spikeIndices`)
· `c266898` consumer-term readouts (MAX FPS / AVG FPS / LOWEST LATENCY / SPIKES, `readoutStats`,
em-dash never 0) · `8fe63d7` `FrametimeRibbon` (lazy r3f, real per-frame extrusion, spike cones,
budget plane, orbit, `frameloop="demand"`; pure `ribbon-profile.ts`) · `215e36d` face assembly
(ribbon hero mounts only when live · overlay toggle + corner picker ported verbatim · uniform stage
tilt, data ink never warped) · `4c051e0` **self-review round-1 FAIL fixed** (content-equal 1 Hz polls
repainted the demand canvas — `ftWin` content-stable ref + reference-identity bug→guard).
Verify: tsc 0 · vitest **1252** (166 files) · `git diff -- src-tauri` EMPTY · self-reviewer round-2
**PASS 8/8** (GL probe: idle flat 15s on content-equal pushes, repaints on real change, orbit
animates; full-width trace x=239/240; overlay toggle exercised live). Spec amendment landed: the
direction spec's Monitor row now carries the owner's 2026-07-10 3D/parallax amendment; UI_VISION
§A0 item 1 closed with the density/backdrop residual logged explicitly.
- **✅ SHIPPED:** the game-exit watcher fired, the stale-build gate correctly refused the `4c051e0`
  artifact against the moved HEAD → rebuilt at `6932fa7` (docs-only delta), silent-reinstalled,
  **stamp-verified `6932fa7` live**, ONE installer on the Desktop. (Note kept for the owner: round-2
  review had to stop his live fps capture for the GL probe — partial debrief in Sessions.)
- **⏳ Then: owner eyeball** on Settings → Appearance → "Monitor console (preview)" (ideally mid-capture
  — the ribbon + spike markers need live frames). Taste gate before default-ON.

### Cycle 2026-07-10h — ✅ PHASE-3 MONITOR CONSOLE BUILT + SHIPPED LIVE `3fbd371` (installer SHA-256 `7E74216C…97295D`, stamp-verified; supersedes `bce72d6`; flag `compy_monitor_console` DEFAULT OFF)

**The 2026-07-10g resume pointer executed end-to-end in one fresh session** (plan
`docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md`, 5 tasks TDD; the per-tab
concept-check entry gate cleared by the owner's go on the instrument cluster — live traces +
gauges, NO hologram/parallax): `1527d61` flag plumbing + MonitorV2 Live-face branch (DEFAULT OFF,
absent === "0" byte-identity pinned BOTH `compy_editorial` states; Settings → Appearance "Monitor
console (preview)") · `7bb9508` the `Oscilloscope` kit component (pure render of caller-buffered
REAL samples — no self-driven rAF/interval, cap-windowed, ArcGauge tone contract, token-only ink;
empty buffer ⇒ honest "no signal", never a synthetic line; reduced ⇒ no glow/sweep) · `3f09742`
MonitorConsole — the SAME three 1 Hz read-only polls MonitorBasic/Play live run ported verbatim
(commands, cadence, cancellation, visibility gate — zero new IPC): fps trace = real polled capture
samples, cleared the moment the helper stops (never frozen-as-live); frametime trace = the
backend's real `recent_frametimes_ms` window (the Overlay's stream); ArcGauges GPU temp
(vendor-gated, NVIDIA ungraded per rule 5) / CPU (ungraded by design) / RAM (+ GPU load in
Advanced); capture control = the same audited toggle; V2-8 `onFpsActive` door mirror preserved;
Basic keeps the last-session door; Sessions + TuningPresets untouched · `3fbd371` motion layer —
Phase 2's spotlight (event-driven, no rAF) + `backwards` reveal + stage reticle, deliberately NO
parallax over the traces; reduced ⇒ still page; border-hygiene guard caught + fixed an undefined
`--ix-bg` fallback.
Verify: tsc 0 · full vitest **1236** (164 files, +26 pins) · `git diff -- src-tauri` EMPTY ·
self-reviewer **PASS** 8/8 (native 1500×980: stopped-state honesty, visual stillness at rest — two
shots 12s apart differ only in real sensor numbers, computed accent-ink contrast on the capture
button, flag-off classic round-trip, live Settings toggle no reload, Crimson spot-check — the
violet capture button under Crimson traced to the PRE-EXISTING test-pinned per-room accent
re-point `monitor-v2.css:31`, not this train).
- **✅ OWNER verdict IN (same day):** v2 cluster rated "satisfactory" (classic tiles were "liked");
  he asked for a third option to surpass both + gave binding direction (graphs a MUST with
  exact-moment spike indicators · frametime-trace half-width bug · 3D/parallax un-banned ·
  consumer-market terms · overlay control on the face) — FULL verbatim response retained in
  `docs/UI_VISION_BACKLOG.md` §A0 (`e1abce9`). Concept spitballed per the per-tab law; **owner
  chose "3D ribbon graph"**.
- **⛳ RESUME (next train, FRESH session):** build **Monitor v3 "Telemetry Ribbon"** from
  `docs/superpowers/plans/2026-07-10-monitor-v3-ribbon.md` — same flag `compy_monitor_console`
  DEFAULT OFF · Oscilloscope full-stretch + spike markers · consumer-term readouts · lazy r3f
  `FrametimeRibbon` (demand frameloop, orbit, budget plane) · overlay control ported · direction-
  spec amendment folded in (T5). **Entry gate ALREADY CLEARED** (owner picked the concept
  2026-07-10).
- **📌 Known preview gap (owner reaction decides):** the Advanced console face shows the instrument
  cluster only — overlay controls + deep monitoring stay on the classic face (flag off) for now.
- **📌 Open candidates unchanged:** T6b (batched restore-side elevation) · the gated backlog `[ ]`
  items.

### Cycle 2026-07-10g — ✅ OWNER VERDICT IN ("everything looks good and gaming mode worked") → HOME CONSOLE DEFAULT-ON SHIPPED LIVE `bce72d6` (installer SHA-256 `2DA1340D…E6F3E4`, stamp-verified; supersedes `80c69f1`) + PHASE-3 PLAN WRITTEN

**Both pending gates cleared by one verdict (2026-07-10):** the T6c Resume worked live on his real
orphaned session, and the Home-console eyeball (A4) approved. Shipped per
[[ship-approved-work-as-the-build]]:
- **`compy_home_console` DEFAULT ON** (`readHomeConsole` → `!== "0"`); Settings row drops
  "(preview)" (title/aria "Home console"); **"0" = the classic-Home failsafe**, byte-identical for
  both `compy_editorial` states. Pins re-anchored: `home-console-flag.test.tsx` (new default
  contract: absent === "1" === console root), `home-hud-flag.test.tsx` +
  `hologram-orbit-optin-guard.test.tsx` pin the "0" failsafe for the layers they guard, + NEW
  console-stage orbit pin (T4d contract on the now-default screen). OWNER_ACTION_CHECKLIST **A4 →
  ✅ DONE**. Verify: tsc 0 · vitest **1210** (161 files) · zero src-tauri · self-reviewer **PASS**
  (settings round-trip live both ways no reload, "(preview)" grep-clean, console idle 0 GL
  draws/16s, orbit opt-in holds).
- ~~⛳ RESUME: build Phase 3 (Monitor)~~ → **✅ EXECUTED — see Cycle 2026-07-10h above**
  (`3fbd371` shipped live behind `compy_monitor_console` DEFAULT OFF).
- **📌 Open candidates unchanged:** T6b (batched restore-side elevation) · the gated backlog `[ ]`
  items (owner-curated data / outbound walls).

### Cycle 2026-07-10f — ✅ T6c ONE-CLICK RESUME + MOUNT-AWARE BANNER DEFERRAL SHIPPED LIVE `80c69f1` (installer SHA-256 `B7F0148A…BDCFA0`, stamp-verified; supersedes `72d9b6e`)

**The 2026-07-10c owner directive built as its own train** (no Home-console verdict had landed, all
remaining backlog `[ ]` are gated — this was the next non-gated item): the GLOBAL gaming-recovery
banner leads with one-click **"Resume Gaming Mode"** (primary; the pane's audited
`recover_gaming_session(confirm)` → `start_gaming_session` sequence verbatim — rollback-first, then
an explicit user-clicked restart, never zero-click on launch), "Restore now" secondary, "Review" no
longer clears the recovery (dead-end fixed: the banner persists until the pane's own card takes
over). NEW pure `resumeOptionsFrom`: resume restarts with the interrupted session's OWN tiers
derived from its recorded change labels (backend-pinned constants) — the pane's checkboxes reset to
core-only on remount and silently downgraded a resumed advanced-tier session (pane's `onResume`
fixed too). **The 2026-07-10d carried note is RESOLVED:** deferral is mount-aware
(`GAMING_PANE_(UN)MOUNTED_EVENT` counter in App) — the old tab-name set hid a pending recovery
anywhere on Lab/Optimize outside the gaming door. **Round-1 self-review catch (pre-existing,
app-wide):** bare `.btn-small-on` lost the cascade tie to the later `.btn-small` base rule (accent
ink DEAD on all 7 call sites) + the generic hover painted the primary danger-red →
`.btn-small.btn-small-on` double-class + hover override, bug→guard in
`button-legibility-guard.test.ts`. Guards: resumeOptionsFrom truth-table + anchored-label pins ·
pane mount-announce pin · resume-order + derived-tiers IPC pin · mount-aware defer truth-table.
Verify: tsc 0 · vitest **1208** (161 files, +5 net) · `git diff -- src-tauri` EMPTY (zero new
IPC/mutation primitive) · self-reviewer round-2 **PASS** (computed accent at rest+hover on 3 live
sites; one-prompt-at-a-time proven live).
- **⚠️ NOTE for the owner:** a REAL orphaned Gaming Mode session ("still applied — not yet
  restored") sits on this rig right now — the self-reviewer found it read-only and never touched
  it. Next time he looks at the app, THIS new banner greets him: one click "Resume Gaming Mode" or
  "Restore now". His settings are currently still in the gaming-session state.
- **⏳ Still open from 2026-07-10e:** owner eyeball on the Home console preview (Settings →
  Appearance → "Home console (preview)") — the taste gate before `compy_home_console` default-ON
  and Phase 3 (Monitor oscilloscope).
- **📌 T6b stays a candidate** (batched restore-side elevation — restore still elevates per change).

### Cycle 2026-07-10e — ✅ PHASE-2 HOME CONSOLE COLD-OPEN BUILT + SHIPPED LIVE `72d9b6e` (installer SHA-256 `12B47273…68BAFF`, stamp-verified; flag `compy_home_console` DEFAULT OFF)

**The 2026-07-10d resume pointer executed end-to-end in one fresh session** (plan
`docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`, 5 tasks TDD, entry gate was open):
`5b79d58` flag plumbing + HomeRoom console branch (byte-identity pinned BOTH `compy_editorial`
states) · `917fa99` the console stage — HomeHud's masthead ported to flag-independent `hc-` classes,
lazy hologram center, 4 honesty-pinned corner gauges (Readiness ratio · Avg FPS · 1% low · GPU temp;
absent ⇒ NOT-YET, NVIDIA neutral per rule 5), edge annotations, `--ix→--v2` kit remap ·
`1ae489c` the room Dock (doors = `railFor(optimizeMerged, labGround)` minus Home — the 4-room ground
rail resolution from the resume pointer; Lab primary; navigates via navHome; activeKey null) + the
#1-limiter context row (quiet tag + "See in Lab" jump; clean renders nothing) · `594c7f0` motion
layer (spotlight · staggered reveal `backwards` fill · stage reticle · annotation parallax; reduced ⇒
still page; vendor-purple pin) · `72d9b6e` **self-reviewer round-1 duplication catch fixed** (the
Dock stacked above RoomShell's ForwardDoor — two go-to-Lab controls; now `doorOpen={!dockRenders}`,
ONE forward affordance, bug→guard both branches).
Verify: tsc 0 · full vitest **1203** (161 files, +21 pins) · cargo **688** · `git diff -- src-tauri`
EMPTY (zero new IPC) · self-reviewer round-2 **PASS** (fresh full pass at `72d9b6e` incl. the canvas
idle probe: 0 GL draws/16s at rest, Orbit re-engages; flag left OFF as it ships).
- **⏳ OWNER eyeball (the taste gate before default-ON and before Phase 3 Monitor):** Settings →
  Appearance → **"Home console (preview)"** ON, open Home, react.
- **⛳ RESUME (after the eyeball):** verdict "ALL GOOD" → flip `compy_home_console` default-ON per
  [[ship-approved-work-as-the-build]]; then Phase 3 (Monitor — gauges + the `Oscilloscope` kit
  component on live telemetry) gets its own plan. "Needs changes" → fold into a fix train first.

### Cycle 2026-07-10d — ✅ PROVING GROUND DEFAULT-ON + standalone Optimize tab DROPPED, SHIPPED LIVE `59249bb` (installer SHA-256 `8D5F8938…75D6B5`, stamp-verified)

**Both decided 2026-07-10 calls shipped in one train** (round-4 "ALL GOOD" cleared the gate):
`compy_lab_ground` **DEFAULT ON** (`readLabGround` → `!== "0"`) + the **standalone Optimize tab
REMOVED** — rail = Home · Monitor · Blackbook · Lab (`railFor(merged, ground)`, order preserved, Lab
stays the last chapter); the Lab's Optimize station is the ONE door. Re-routed under ground: Home
limiter buttons ("See in Lab") · Home forward door (`doorFor` → Lab) · gaming-recovery "Review" →
Lab · navHome/HOME_FOR_TAB fallbacks · Setup & Tour (4-room recap, lesson ties, seatbelt names the
Lab's ledger) · Settings row sheds "(preview)". **Self-reviewer round-1 FAIL fixed pre-ship:** the
decided "undo stays reachable via the Lab panel" had no ledger surface in the station →
OptimizeStation gained the "Applied & history — every change, undoable" disclosure rendering the
classic room's audited `<Fix view="ledger">` (bug→guard pin in `lab-ground.test.tsx`).
stale-reference-guard: "Optimize" re-joins the retired-tab regex. `compy_lab_ground="0"` = full
classic failsafe (rail/tabs/rooms/tour restore live, round-trip live-verified, no reload).
Verify: tsc 0 · vitest **1182** (159 files, +14 pins) · `git diff -- src-tauri` EMPTY (zero new
IPC/mutation primitive) · self-reviewer round-2 **PASS** (native 1500×980; noted caveat: the Home
"See in Lab" button proven by source-read + equivalent-path clicks — rig had 0 open limiters).
- **⛳ RESUME (next train, FRESH session — heavy-context handoff per the usage-economics law):
  Phase-2 Home cold-open** per `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`
  (5 tasks, TDD, flag `compy_home_console` **DEFAULT OFF**). Its entry gate is OPEN: the round-2/4
  eyeball approved the direction and the Optimize-tab call is recorded + shipped — the Home dock's
  room list at default-ON is the 4-room ground rail (`railFor(merged, ground)`).
- **📌 Carried note for the T6c global-banner train:** on the Lab tab the global recovery banner
  defers to the embedded Gaming pane (`TABS_EMBEDDING_GAMING_MODE`), but in the console the pane
  only mounts once Optimize station + Power features are opened — a pending recovery is invisible
  while sitting on the Lab (visible on every other tab; pre-existing shape, now live at default-ON).
  Fold the fix into T6c's banner rework.

### Cycle 2026-07-10c — ✅ Console round-3 owner catches SHIPPED `889de10` (dock false-highlight · gauge readout over the ring stroke · drift-aware caption)

**Owner round-3 eyeball caught 2 bugs on the `626b83c` build** ("the optimize box seems to be default
highlighted before actually clicking it" · "the 8/9 safe stack icon is distorted") + asked for a self-run
abnormality sweep, green-lit continuing. Root causes (live CDP rect/computed evidence, systematic-debugging):
(1) `.dock-node-primary` wore the EXACT accent border `.dock-node-active` uses → resting primary now a 35%
color-mix border (accent ink kept); active alone gets full accent border + 14% tinted fill. (2)
`.lab-gauge-center` single-line `align-items: baseline` flex anchored the readout to the TOP of the 76px ring
box — "8/9" painted over the ring stroke (num rect y == box y, proven) → outer box centers, new
`.lab-gauge-txt` inner group owns the baseline. (3) Sweep catch (self-reviewer, the abnormality class the
owner asked for): with a drifted rec the ring caption said "1 left to enable below" while the corner gauge
said "0 ready" — the caption re-framed the drift group's item as a fresh enable → caption now splits
freshPending vs driftedPending ("1 was turned off outside Compy — restore it below." / mixed branch).
bug→guard: `optimize-gauge-dock-guard.test.tsx` (7 tests — structural pin, CSS pins both files, all three
caption branches). Verify: tsc 0 · vitest **1168** (159 files; the one full-suite red was
`export-library.test.mjs` hook-timeout under dev-server contention, green in 21s once dev stopped) ·
`git diff -- src-tauri` EMPTY · self-reviewer **PASS ×2** (native 1500×980: resting primary border
`color(srgb …/0.35)` vs active full accent + tint, active look moves station-to-station; readout center
±1px of ring center; drift caption live-verified against the rig's real drifted Game Mode).
- **✅ SHIPPED 2026-07-10 · installer SHA-256 `945E86B1767362391318E18EBC36EB58AAFA1E909D563DA562DB3B0352E81A5C` ·
  LIVE** — stamp-verified `889de10` in the installed exe, stale-build gate passed, one installer on the Desktop.
- **✅ OWNER VERDICT 2026-07-10 (round 4): "ALL GOOD"** — the Ops Console eyeball gate is CLEARED.
- **⛳ RESUME (next train, FRESH session per the Lab-overhaul law):** (1) flip `compy_lab_ground`
  **default-ON** + **drop the standalone Optimize tab** in the same train (both DECIDED 2026-07-10 —
  the removal ships WITH the flip; classic stays the `"0"` failsafe); (2) then build **Phase 2 Home
  cold-open** (`docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`, flag
  `compy_home_console` DEFAULT OFF) — its entry gate (the owner's console verdict) is now open.
- **🆕 OWNER DIRECTIVE 2026-07-10 — one-click "Resume Gaming Mode" on the GLOBAL recovery banner
  (T6c candidate):** verbatim: *"the resume gaming mode option just auto enabled the gaming mode
  instead of doing the rollback and needing the user to re enable … unless it does do that."*
  **Code-verified state: it HALF does.** The Gaming pane's recovery card already has one-click
  **Resume Gaming Mode** as primary (`GamingMode.tsx` `onResume` — recover(confirm) → immediate
  `start_gaming_session`; the internal rollback is deliberate so the fresh session snapshots TRUE
  priors — rollback-first). **The GAP:** the app-level global banner (`App.tsx`
  `gaming-recovery-banner` — what the owner actually sees after a reboot on any other tab) offers
  only "Restore now" / "Review", no Resume → his lived flow was restore-then-re-enable-by-hand.
  Build: add the same one-click Resume (primary) to the global banner, reusing the pane's audited
  recover+start flow, resuming with the interrupted session's own tiers; keep "Restore now" as the
  secondary. NEVER zero-click auto-apply on launch (elevation + consent laws). Reuses audited
  commands only (no new mutation primitive) but session-boundary behavior → self-review + the
  gaming-mode test pins; its own train, not folded into the Lab flip.

### Cycle 2026-07-10b — ✅ Title-header law SHIPPED `626b83c` (owner round-2: "header = a title, not a description/notification") — built + guarded + self-review PASS + LIVE

**Owner round-2 feedback (verbatim):** header must be a TITLE; "1 change you applied was turned off outside compy"
(the optimizeVerdict drift headline standing as the Lab h1) relocates somewhere sensible; sweep the class app-wide.
**Built (`626b83c`):** hud-on h1 = room title in all 5 v2 rooms (`LabGround`/`OptimizeV2`/
`MonitorV2`/`BlackbookV2`/`LabV2` — "Lab"/"Optimize"/"Monitor"/"Blackbook"); header `sub` dropped under hud; classic
`compy_editorial="0"` failsafe keeps verdict headers. Relocations: drift guidance + "never re-applies" → Fix drift
intro; undo promise → Fix consent line (`lc-detail-note` trimmed to read-only-room fact, no double-say); Monitor's
last-session answer + "· live estimate" → Play hero (`monitor-v2.css` hide rescoped `:not([data-hud="on"])` — the
self-review CATCH: the old one-mention rule swallowed the relocated line); Blackbook record + autopsy hint restored
via new Learn `keepRecord` prop. Guards: hud-rooms-flag title contract ×4 + hint pin + CSS-source pin ·
lab-ground "Lab" pin · lab-console note pin. Law: self-reviewer rubric 6 upgraded + memory + direction-spec addendum
(Home masthead verdict KEPT — cold-open answer, flagged for owner taste). Verify: tsc 0 · vitest **1161** (158
files) · `git diff -- src-tauri` EMPTY. Self-review round 1: FAIL on the hero-hide only → fixed + bug→guard'd →
**re-review PASS** (hero row live-verified "Smooth · 1m 44s · live estimate" w=1074 h=26, ×1 on screen; classic "0"
hide re-applies; guards 14/14; flags left `compy_lab_ground="1"`, `compy_editorial` default).
- **✅ SHIPPED 2026-07-10 · installer SHA-256 `9D5434ED59F0BBD0078A0C146FE79CCE57657EFE15A771250EE2CD34A9626522` ·
  LIVE** — stamp-verified: `626b83c` embedded in the installed exe (`Select-String` true), ship-reinstall
  stale-build gate passed, exactly one installer on the Desktop.
- **⛳ RESUME:** owner eyeball round 3 — the Lab preview toggle should already be ON (the review left
  `compy_lab_ground="1"`); if the Lab tab doesn't show the Ops Console, re-flip Settings → Appearance →
  "Lab proving ground (preview)". Phase-2 Home plan
  (`docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`) stays entry-gated on his verdict.

### Cycle 2026-07-10a — ✅ Header-slop law SHIPPED `1a9f44f` (owner round-1 Ops Console feedback; open-on-click CONFIRMED)

**✅ DONE 2026-07-10 · installer SHA-256 `0B16E904…48AE6` · LIVE (stamp-verified `1a9f44f`, one installer on the Desktop).**
Owner's eyeball feedback did two things: (1) **CONFIRMED Optimize open-on-click** ("cleaner") — recorded in the direction
spec's Open section; (2) decreed the **header-slop law**: tab header space = header-format text only (eyebrow / headline /
a sub that qualifies THIS headline's measured fact); small always-on descriptive lines are banned and relocate to their
context element. Shipped: `.v2-measured` strips removed from Optimize/Monitor/Blackbook/LabV2 (facts already in the
bodies) · Lab (Ops Console) header cut to eyebrow + headline · console lede DELETED, its undo/read-only promise relocated
to `.lc-detail-note` inside the Optimize station panel (panel-only, test-pinned) · Home's masthead readout untouched
(formatted instrument data) · dead `*MeasuredLine` helpers deleted · bug→guard: `.v2-measured`-absence pins ×4 +
lede/note pin · **law mechanized as self-reviewer rubric item 6** + memory `header-slop-law-no-micro-descriptive-text`.
Verify: tsc 0 · vitest **1158** · `git diff 63585e9..1a9f44f -- src-tauri` EMPTY · self-reviewer **PASS** (8/8, native
1500×980). ⚠️ The review reset the `compy_lab_ground` preview toggle to OFF — owner re-flips it to keep eyeballing.
- **⛳ RESUME:** owner eyeball round 2 (re-flip the Lab preview) · ~~the ONE open owner call~~ ✅ **DECIDED 2026-07-10:
  the standalone Optimize tab DROPS at default-ON** (removal ships WITH the default-ON flip, after the eyeball; both spec
  calls now resolved in the direction spec's Open section) · **Phase 2 (Home cold-open) PLANNED** —
  `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md` (`d1e91ce`), entry-gated on the round-2 eyeball; build
  once it approves. Phases 3–4 follow per-tab (each must pass the header-slop exit check).

### Cycle 2026-07-09f — ✅ Lab "Ops Console" Phase 1 COMPLETE + SHIPPED `63585e9` (post whole-branch review; DEFAULT OFF, owner eyeball pending)
**Owner rejected the built bento Instrument Bench (`403be45`) as "generic slop / wide horizontal boxes."** Ran brainstorming
→ 3 interactive HUD mockups (Artifact <https://claude.ai/code/artifact/e2830b73-cfc0-43c6-b263-5b59a1075639>) → owner picked
**A · Ops Console** (spatial game-HUD: real 3D hologram center + corner arc gauges + magnify Dock; reactbits-referenced), center =
the real recognizable hologram. **Direction LOCKED spec: [`docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`](superpowers/specs/2026-07-09-compy-console-hud-direction.md)**
(app-wide language; Lab merges Optimize toggles + Benchmark, each individually accessible; build order = Lab first then per-tab
rollout; bento un-retired as an option for OTHER surfaces, not the Lab). **Phase-1 plan: [`docs/superpowers/plans/2026-07-09-console-hud-phase1-lab.md`](superpowers/plans/2026-07-09-console-hud-phase1-lab.md)** (6 tasks, TDD, subagent-driven; ledger `.superpowers/sdd/progress.md`).
- **BUILT + committed on `main`, all behind `compy_lab_ground` DEFAULT OFF (live app byte-identical):** T1 ArcGauge `9558cfa` ·
  T2 Sparkline `9e2eb64` · T3 Dock `7b85cf9` · kit-fix (ArcGauge centering, CDP-caught) `6bbb1e7` · **T4 LabConsole** (real
  hologram center + 4 honest corner gauges + station Dock; Optimize primary, opens on click; **bento DELETED**) `b18f498` ·
  **T5 reactivity+reticle** (accent spotlight + staggered reveal `@keyframes v2-lc-rise` + stage-scoped ReticleCursor) `e0f5a62` ·
  **self-review-fix** (RigViewer `chromeless` mode — footer form collided with corner gauges; + spotlight reset) `1b8c102`.
  Kit under `src/design/console/`; room `src/surfaces/LabConsole.{tsx,css}`. Verify at `1b8c102`: **tsc 0 · vitest 1157 ·
  `git diff b23a97e..HEAD -- src-tauri` EMPTY** (mutation boundary untouched, zero IPC).
- **✅ SHIPPED 2026-07-09 · installer SHA-256 `62DF3FF1…604DD` · LIVE** (stamp-verified: installed exe embeds `63585e9`,
  ship-reinstall stale-build gate passed, Desktop holds exactly one installer). Task 6 done: self-review #1 FAILed →
  chromeless fix `1b8c102` → **re-review PASSED all items**. **Final whole-branch review (opus, base `b23a97e`) DONE** — caught
  1 CRITICAL honesty-rail bug + 2 Important items, all fixed in `63585e9`: the Safe-stack corner gauge collapsed "recs not
  loaded / `get_recommendations` failed" into a fabricated "0 · measured" → now honest NOT-YET until recs load (bug→guard: 2
  `lab-console.test.tsx` pins) · ReticleCursor cancels its rAF on pointerleave · RigViewer skips the fan poll in `chromeless`.
  Post-fix self-reviewer **PASS** on the shipped build (NOT-YET contract computed-verified consistent with siblings, no
  vendor-purple leak, no regression). Full verify at `63585e9`: **tsc 0 · vitest 1158 (158 files) ·
  `git diff b23a97e..63585e9 -- src-tauri` EMPTY** (cargo unchanged by construction).
- **⛳ RESUME (fresh session):** (1) **OWNER EYEBALL** — flip **Settings → Appearance → "Lab proving ground (preview)"**, open
  the **Lab** tab, react to the Ops Console. Two owner-gated calls in the spec's Open section: Optimize panel open-on-click vs
  always-visible · drop the standalone Optimize tab at default-ON. (2) **Phases 2–4 (per-tab Console rollout)** each get their
  own plan AFTER the eyeball.

### Cycle 2026-07-09e — ✅ Instrument Bench Phase 1 Tasks 2–5 COMPLETE + SHIPPED `403be45` (DEFAULT OFF, owner eyeball pending)
**✅ DONE 2026-07-09 · installer SHA-256 `2EF72796…B9231` · LIVE (stamp-verified: installed exe embeds `403be45`, prior
`77d0233` absent, ship-reinstall stale-build gate passed, Desktop holds exactly one installer).** Built straight through
Tasks 2–5 of `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`, flag `compy_lab_ground` **DEFAULT OFF** the
whole time (owner's live look byte-identical). What landed:
- **T2 `LabBench` bento grid (`02a1129`):** `LabGround` renders a new `LabBench` — a bento grid of living station bays —
  in place of `<Lab v2 ground>`'s linear spine. HERO bay = station 1 "Optimize" (enable-all fast path inline, same
  audited `apply_recommendations_batch`, ZERO new IPC); 5 measure bays (Diagnostics/Benchmark/Latency/Tuning/Black Box)
  as compact doors, one detail at a time, no Gallery. `lab-bench.css` scoped under `[data-v2="on"]` (tokens-v2 guard).
  Engineering note: `LabBench` now owns the measure-station on-mount reads (the same probes Lab did); Lab's `ground` mode
  is now dead code (left inert for Phase 1, a reviewer can prune).
- **T3 bolder reactivity (`3cb01eb`):** accent spotlight + tilt/magnetism (measure doors) + hover-lift + sibling-dim +
  staggered mount reveal (`@keyframes v2-bench-rise`, per-bay delay), ALL reduced-motion-gated (static bench when reduced).
- **T4 data-reactive hero gauge (`77d0233`):** new `useCountTo` GSAP hook drives a ring gauge bound to the measured
  applied/total safe stack — honesty rail: `null` source ⇒ renders nothing (no placeholder number ever animates).
- **T5 self-review + ship (`403be45`):** self-reviewer FAILed on 3 real defects → the 2 in-scope fixed CSS-only + 3
  bug→guard source pins → re-review **PASS** (computed evidence): (i) hero 2×2 span shared grid rows with the measure
  bays → inflated them to 804px → hero is now a full-width banner + compact 128px doors; (ii) `animation-fill-mode:both`
  on the reveal permanently blocked the `:hover` lift/dim → `backwards`; (iii) vendor-purple `.particle-container:hover`
  box-shadow leaked under reduced motion → base `box-shadow:none` on `.lab-bench-card` outranks it.
- **Verify:** tsc 0 · full vitest **1151** (154 files, +18 across T2–T5) · cargo **688** + clippy clean · `git diff
  f16d158..403be45 -- src-tauri/` EMPTY (mutation/rollback boundary untouched).
- **⏳ OWNER (eyeball + ONE deferred decision):** flip **Settings → Appearance → "Lab proving ground (preview)"**, open
  **Lab**, react to The Instrument Bench (bento of bays · living hero gauge · reactive motion). **Open decision (owner-gated
  deferral, self-review re-surfaced):** with the preview on, the standalone **Optimize** rail tab still coexists with the
  Lab hero (same enable-all surface in two places) — confirm whether to drop the tab when the flag's on before default-ON.
  Tracked in `docs/OWNER_ACTION_CHECKLIST.md` + `docs/UI_VISION_BACKLOG.md` §C. Phases 2–4 of the plan remain open.

### Cycle 2026-07-09d — ✅ Lab redesign APPROVED ("Instrument Bench") + P1 Task 1 shipped-to-tree; Tasks 2–5 → fresh session
Owner approved the researched direction (see the direction gate below in 09c). This cycle:
- **Research + council + proposal + plan (all committed):** cited direction proposal
  `docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md` (owner Q1–Q5 answered: **"Instrument
  Bench" bento-of-living-bays APPROVED · BOLDER motion bound to real data · DELETE the gallery · cleanup now**)
  + Phase-1 plan `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md` (5 tasks, flag `compy_lab_ground`
  DEFAULT OFF, zero new deps — gsap/motion/three all already installed).
- **Docs cleanup (`cec32c9`):** killed the stale-spec drift that misled the last train — SUPERSEDED banners
  on `2026-07-08-lab-proving-ground.md` (§2/§3/§8 UI dead; catalog/§2a/mutation parts stand) + CLAUDE.md rule-6
  pointer scoped + 4 stale Lab-status copies (OWNER_ACTION_CHECKLIST A3/B5, UI_VISION A.1, RELEASE_STATE
  amendment) corrected + 6 stale gallery screenshots deleted.
- **✅ P1 Task 1 — gallery DELETED (`2de8d17`, shipped-to-tree, NOT installed):** removed TelemetryGallery +
  gallery-pieces + the "gallery" LabStationKey/facts/wiring across Lab.tsx / lab-guided-data / lab-bento-data;
  KEPT `lab/fly-camera.tsx` (shared with HardwareTourScene — plan was wrong to list it for deletion); tests
  updated. **tsc 0 · vitest 1133 (was 1145, −12 gallery tests) · `git diff -- src-tauri` EMPTY.** Flag still
  DEFAULT OFF → owner's live app byte-identical; nothing installed this cycle.
- **⛳ RESUME (fresh session) — build P1 Tasks 2–5 from the plan** (`2026-07-09-lab-instrument-bench-p1.md`):
  (2) new `LabBench` bento grid replaces `<Lab v2 ground>` in `LabGround.tsx` (hero bay = Optimize station 1,
  measure bays around it; model the bento on the existing `LabBento.tsx` + vendored `MagicBento`); (3) bolder
  reactivity (accent spotlight + tilt/magnetism ON — they ship OFF today — + staggered reveal, reduced-motion
  static); (4) one GSAP data-reactive hero gauge bound to a measured number (`null` ⇒ render nothing); (5)
  self-reviewer PASS + `ship` skill + owner eyeball. Keep flag DEFAULT OFF; `git diff -- src-tauri` must stay
  EMPTY. Note: after Task 2, Lab.tsx's `ground` mode becomes dead code (only LabGround used it) — remove or
  leave inert, reviewer's call.

### Cycle 2026-07-09c — ⛔ Owner REJECTED the blended-Lab marathon — REDESIGN via research+council, approval-gate FIRST
**Owner eyeballed `f16d158` and rejected the direction (not a live regression — flag was DEFAULT OFF).** Verbatim
concerns: the **telemetry gallery "makes 0 sense / looks terrible"** — he had **explicitly said NOT to clone the
scroll/drag gallery from his sister's site**, only to *reference the type/level* of its animation + design language;
I **removed the bento layout he liked and reverted to the linear "spine" we'd already binned**; and **none of it reads
JARVIS / Tony-Stark / high-tech** — the animated reactive feel he's described repeatedly is absent.
- **Root cause:** I executed `2026-07-08-lab-proving-ground.md`'s UI direction ("retire bento → one linear spine →
  build the drag gallery") faithfully — but that spec **contradicted his verbal direction.** Doc drift steered the work.
- **The corrected process (owner's ask): NO more building yet.** Research + **council** (`docs/COUNCIL_PROTOCOL.md`) →
  draw up a direction he's confident fits, **with cited references/examples to show him** → **detailed plain-English
  questions for his go/no-go BEFORE any code.** Full brief + his requirements: **`docs/superpowers/specs/2026-07-09-lab-redesign-COURSE-CORRECTION.md`** (SUPERSEDES the 2026-07-08 spec's UI direction; the catalog/§2a/safety parts stand).
- **PARALLEL ask:** full `docs/` + sentinel-directory **maintenance** — organize/refine/optimize the .md files, kill
  contradictions/stale/superseded direction (the thing that misled me). Slice 0 = the course-correction brief above.
- **Shipped `f16d158` stays inert** (flag OFF, app byte-identical) — do NOT reflexively revert; the redesign decides
  what to keep (§2a DARK backend + mutation-safety = fine; §3 gallery + bento→spine collapse = replace).
- **⛳ RESUME (fresh session):** invoke **brainstorming** + council; research the JARVIS/high-tech animated language +
  confirm the bento basis + clarify the **"exebenus"** reference he named (unknown — ask, don't guess); produce a
  referenced proposal + a short question set for his approval. No code until he passes it.

### Cycle 2026-07-09b — ✅ Lab BLENDED-ROOM marathon COMPLETE + SHIPPED `f16d158` (DEFAULT OFF, owner eyeball pending)

**✅ DONE 2026-07-09 · installer SHA-256 `0B4D15A0…6BD9` · LIVE (stamp-verified: installed exe embeds `f16d158`,
ship-reinstall stale-build gate passed, Desktop holds exactly one installer).** The whole marathon built straight
through on ONE numbered spine, flag `compy_lab_ground` **DEFAULT OFF the entire time** (his live look never changed),
no preview pings between phases — per the owner's cadence directive. What landed:

- **§8 blended spine** (`4410bec`): tweak-apply is now station 1 "Optimize", a NATIVE member of the numbered spine
  (same contract/badge/frame as 2–6, no seam); `LabGround` thin, `LabGround.css` deleted; `OptimizeStation.tsx` new.
- **§2b Two Futures measured split** (`47c57f5`): wired as the Benchmark station's "prove it" payoff (item B closed).
- **§2a aggregate-stack A/B** (`6d49f10`, **DARK** `stack_trial_gate()` OFF): apply whole safe stack in one UAC →
  measure cumulative delta → roll all back; reuses the audited batch path (NO new mutation primitive); mutation-gate
  10/10 + rust-tauri-reviewer CONFIRMED-fix (corrupt-ledger read aborts before mutating). Arming = later gated commit.
- **§3 telemetry GALLERY** (`330cd5c`): panoramic drag-shell + fly-to-piece over scoreboard/sessions/ledger/black-box
  (all existing IPC); `buildGalleryPieces` anti-fabrication law; reduced-motion grid; empty-state loops to the bench.
- **§5 armed-feature Power bay** (`0412e0f`): gaming_mode + service-suspend read-first in station 1 (debloat already
  in the fixes surface). All three armed features now provable from the Lab.
- **Finalize self-review** (`f16d158`): FAILed on 2 real defects I introduced → fixed + bug→guard'd (duplicate Lab
  recovery banner; gallery caption legibility — 24-tile cap + radius cap + closer camera). Re-review **PASS**.
- **Verify:** tsc 0 · full vitest **1145** · cargo **688** + clippy clean · `git diff -- src-tauri` empty for §3/§5/§8
  (§2a is the only src-tauri change, dark-gated).
- **⏳ OWNER (2 things):** (1) eyeball — flip **Settings → Appearance → "Lab proving ground (preview)"**, open Lab,
  react. (2) one deferred slice-1 call: the standalone **Optimize** rail tab still coexists with Lab station 1
  (documented deferral from `d0e30f5`) — confirm whether to complete the merge (drop the tab when the flag's on)
  before default-ON. Both tracked in `docs/OWNER_ACTION_CHECKLIST.md` + `docs/UI_VISION_BACKLOG.md` item C.

<details><summary>Original marathon brief (owner reject of the verbatim phase-1 merge, 2026-07-09) — kept for the record</summary>

**Owner 2026-07-09, verbatim:** *"im not satisfied with this whatsoever do not just copy paste over the merge
… recreate a blended and brand new LAB with the migration of the optimize tab features incorporated into the
lab … i dont want you to ping me for preview of the lab until you have fully completed the whole design marathon
that you should refer to from all the relative MD files."* The shipped `d0e30f5` LabGround **stacked
`<Check>`+`<Fix>` above a demoted `<Lab>`** with a paragraph seam = two surfaces bolted together, not a blend.

- **DESIGN LOCKED** (this commit): `docs/superpowers/specs/2026-07-08-lab-proving-ground.md` **§8 — the
  blended-spine architecture.** Core: **ONE numbered spine, the fast path is station #1** ("Optimize — enable
  the safe stack in one tap") in the Lab's own instrument language, with stations 2–6 the existing
  measure→prove instruments; the intake router gets a LEAD row routing to `optimize`; one verdict, one
  numbering, no seam. Station-1 body REUSES the audited `apply_recommendations_batch`/per-row-undo path (never
  forks the mutation boundary) but is RE-PRESENTED as a Lab station (new `OptimizeStation`, Lab skin — must
  read as the same room as stations 2–6, zero Optimize-panel tell). Full wiring/files/guards in §8.1–8.5.
- **CADENCE (owner directive):** flag `compy_lab_ground` stays **DEFAULT OFF the entire marathon** (his live
  look never changes); **NO preview ping until the WHOLE thing is done** (§8 blended spine → §2 prove-utility
  + aggregate A/B + Two Futures per-part → §3 telemetry gallery → §5 armed bays → finalize/ship/eyeball ONCE).
  Multi-session build; hand off with this ledger, never ping mid-way. Memory: [[lab-no-copypaste-full-marathon]].
- **⛳ RESUME — build §8 first (fresh session, full runway):** (1) `lab-guided-data.ts` — add `"optimize"`
  `LabStationKey` (ground-only, prepended via `groundStationKeys`, so the 5-station measure spine stays
  byte-identical off-ground), its `LAB_STATIONS` contract, the `LAB_ROUTER` lead row, the `stationReading`
  branch (+ `safeReady`/`stackApplied` facts, pure). (2) New `src/surfaces/lab/OptimizeStation.tsx` = enable-all
  hero + safe-tweak review list in Lab skin (reuse `onApplyBatch`/`onToggleRec`/`onRollback`; Check's
  startup/bloat/preload/leftovers/nic fold under a "More cleanup" disclosure). (3) `Lab.tsx` accepts the
  fast-path props as OPTIONAL, used only in `ground` to render `stationBody("optimize")`; `STATION_ICON.optimize`.
  (4) `LabGround.tsx` goes thin (RoomShell + `<Lab v2 ground {...fastPathProps}>`); DELETE `.lg-fast`/`.lg-utility`
  + `LabGround.css`. (5) New CSS → register in `tokens-v2-guard.test.ts` `V2_CSS`. Verify: tsc 0 · vitest
  no-regress · flag-off byte-identity · `git diff -- src-tauri` EMPTY · self-reviewer "same-room" check. NO ship.
- **Then §2 → §3 → §5 → finalize** per spec §8.5. Phase 4 (real new catalog tweaks) is a SEPARATE per-tweak
  owner-gated track, NOT part of this UI marathon.
- **The shipped `d0e30f5` build stays live** (flag OFF → byte-identical to the prior look; harmless). Do NOT
  re-ship until the blended Lab is complete.

### Cycle 2026-07-09a — ✅ SHIPPED `d0e30f5` + ship-docs (Lab overhaul PHASE 1 — Optimize merged into the Lab proving ground, DEFAULT OFF)
**Code `d0e30f5` · installer SHA-256 `B932EDA0…FD8F0` · LIVE (stamp-verified 2026-07-09: installed exe embeds
`d0e30f5`, `f13d10a` absent, ship-reinstall stale-build gate passed, Desktop holds exactly one installer).**
Note: the prior session's `d05871c` resume-breadcrumb commit was folded back (`reset --soft` to `d0e30f5`, both
local-only, 0 behind origin) so the exe stamp == HEAD at ship time and the doc rows land as the ship-docs commit
on top — the established `<commit> + ship-docs` pattern. Flag off → app byte-identical, NO live look change until
the owner flips the preview toggle.
- **What landed (`d0e30f5`, frontend-only, `git diff -- src-tauri` EMPTY):** phase 1 of the Lab overhaul
  (★ PRIMARY BLUEPRINT `docs/superpowers/specs/2026-07-08-lab-proving-ground.md`, Directive 2) behind
  **`compy_lab_ground` DEFAULT OFF**. New `src/surfaces/LabGround.tsx`+`.css` = the merged room: FAST PATH
  (`Check`+`Fix view="fixes"` = safe tweaks + the existing "Apply all safe fixes" enable-all, no benchmark,
  reuses `applyBatch`→`apply_recommendations_batch`, ZERO new IPC) + UTILITY (Lab's new additive `ground`
  mode = intake router + numbered station spine, collapses bento/guided/classic into one). App swaps the Lab
  tab `LabV2`→`LabGround` when the flag is on (`App.tsx` ~L1406); Settings preview toggle added
  (`Settings.tsx`). Cohesion fix: `hud-rooms.css` fix-room HUD skin broadened to `:is(.v2-room[data-room="fix"],
  .v2-room[data-room="lab"] :where(.lg-fast))` (specificity-neutral → fix-room byte-unchanged);
  `tokens-v2-guard.test.ts` comma-split made paren-aware.
- **Verified:** tsc 0 · vitest **1128** (152 files, +6 `lab-ground.test.tsx` guards: flag-off byte-identity,
  ground-spine-only, ground-overrides-bento, empty-state) · tokens-v2-guard 52 green · self-reviewer **PASS**
  (fast-path leads, cohesion seam caught + fixed, re-verified with computed 3px/transparent evidence matching
  the Optimize tab; one idiom below; honest fixes-first verdict). Shots `docs/ui-sweep/shots/lab-ground/`.
- **Step 0 (`6d7397b`):** CLAUDE.md rule 6 + PRODUCT_DIRECTION + RECEIPTS re-synced to the opened-catalog
  (measurable-benefit-under-rails) policy.
- **✅ SHIPPED 2026-07-09 (all resume steps done):** (1) `scripts/ship-reinstall.ps1` ran green — stale-build
  gate passed, graceful close, one installer staged, silent `/S` install, launched; (2) stamp-verified live ==
  `d0e30f5` via the embedded `COMPY_GIT_HASH` (installed exe: `d0e30f5` present, `f13d10a` absent); (3) doc rows
  landed this same ship-docs commit — RELEASE_STATE.md Snapshot row (SHA-256 `B932EDA0…FD8F0`, built-from
  `d0e30f5`, Installed by Claude + LIVE, supersedes `f13d10a`), this entry flipped ✅ SHIPPED, `UI_VISION_BACKLOG.md`
  item C marked phase-1-shipped-behind-flag.
- **⏳ OWNER (eyeball + a scoping welfare-check):** flip **Settings → Appearance → "Lab proving ground
  (preview)"**, open the **Lab** tab, react to the merged room. **Scoping call made (slice 1, reversible):**
  merges Optimize's CONTENT into the Lab behind the preview; the Optimize rail TAB removal + full rail
  collapse is DEFERRED to a next slice (wider App/rail surgery), so during preview BOTH the Optimize tab and
  the merged Lab exist. Undo stays reachable (Optimize/History tabs + per-row toggle-off). Confirm this
  direction before default-ON / before removing the Optimize tab. Remaining: phases 2 (prove utility +
  aggregate-stack A/B) · 3 (telemetry gallery) · 4 (catalog-expansion pipeline) · 5 (armed-feature bays).

### Cycle 2026-07-08c — ✅ SHIPPED `f13d10a` + ship-docs (sibling spotlight-tag de-slop sweep — "sweep the rest")
**Code `f13d10a` · installer SHA-256 `E65D649C…9C7EA` · LIVE (stamp-verified 2026-07-08).** The §D sibling
slop the previous cycle logged: the same "#1 BIGGEST LIMITER" alert-badge pattern the owner caught + retired on
Home still shouted on the first-run **FirstCheck** verdict card and the **Setup & Tour** first-check step. Quieted to
match the approved Home `.hud-pill` fix — text → lowercase "#1 biggest limiter" (`FirstCheck.tsx`, both `SetupTour.tsx`
variants); `SetupTour.css .st-spotlight-tag` de-ambered `--ix-amber` → muted `--ix-text-3` at 0.14em (its own
`.st-tweaks-head` micro-label register); the `.st-spotlight` card keeps its subtle tint to carry attention (esp. the
drift variant); FirstCheck's tag left card-coherent green (only the uppercase literal was the shout). **Advisory/onboarding
surfaces — zero src-tauri** (`git diff a5352cb..f13d10a -- src-tauri/` EMPTY; mutation/rollback boundary untouched).
bug→guard `spotlight-tag-quiet-guard.test.ts` (+4 tests) pins no uppercase "BIGGEST LIMITER", lowercase tag present, no
uppercase text-transform, no `--ix-amber` on the tag. Verify: tsc 0 · vitest **1122** (151 files, +1 file) · self-reviewer
**PASS 8/8** (FirstCheck tag green 10.2:1 · SetupTour tag muted `rgb(130,136,150)` 5.0:1 not amber · `textTransform:none`
both · no overflow · both SetupTour variants render). RELEASE_STATE Snapshot row updated the same ship-docs commit;
OWNER_ACTION_CHECKLIST §D closed. ⏳ OWNER: eyeball only if you re-trigger onboarding (first run / tour) — the live LOOK
of the main app is otherwise unchanged.

### Cycle 2026-07-08b — ✅ SHIPPED `a5352cb` + ship-docs (Home priority-queue de-slop + Game Mode double-listing + task-list consolidation)
**Code `a5352cb` · installer SHA-256 `A1D6EA55…BD7C4` · LIVE (stamp-verified 2026-07-08).** Owner caught THREE
defects in one Home priority-queue screenshot: (1) filled UPPERCASE amber ALERT badges ("BIGGEST LIMITER" /
"MEDIUM CONFIDENCE") = the loud AI-slop pattern the de-slop directive retired everywhere else → now quiet mono
tags, no fill/uppercase/warn-color, #1 keeps a faint accent (`home-hud.css`; guard `home-hud-pill-quiet-guard.test.ts`).
(2) Game Mode listed twice contradictorily — "you applied it and it drifted off" (`readiness.rs` drift row) AND
"you haven't applied it" (`priorities.rs` pending-safe aggregate) → `readiness.rs` now exposes drifted rec titles
structurally; `priorities.rs` excludes them from pending-safe (the drift row owns the setting). (3) "1 safe one-click
tweak(s) not applied" = the exact `N setting(s)` grammar the flags-name-it law bans → real singular/plural. **Advisory
surface — mutation/rollback boundary untouched** (`git diff bdc9daa..a5352cb -- actions.rs history.rs` EMPTY). Verify:
cargo **684** + clippy clean · tsc 0 · vitest **1118** (150 files, +4 tests) · self-reviewer **PASS**. **Also this cycle:
task-list consolidation** — owner flagged that lists he'd made were scattered and dropped. A read-only sweep found 6
genuinely-dropped owner lists (OWNER_ACTION_CHECKLIST sign-off phrases never said · GAMING_MODE_QA 8/10 unrun ·
BETA_SMOKE 0/24 · funnel go-live parked since 06-15 · Lab train awaiting his list · 2 substituted asks). Rewrote
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) as the ONE consolidated index (every scattered list points
back to it) and **wired it into CLAUDE.md's resume path** (root cause: it was never linked, so no session surfaced it).
⏳ OWNER: eyeball the quieted Home tags; the §A–§D checklist is now your single "what's on me" view. Sibling slop
(FirstCheck/SetupTour `#1 BIGGEST LIMITER` uppercase) logged in §D — say "sweep the rest" to quiet them too.

### Cycle 2026-07-08a — ✅ SHIPPED `bdc9daa` + ship-docs (T6b + restore-confirmation train)
**Code `bdc9daa` · installer SHA-256 `4BB38FC3…A7CD5` · LIVE (stamp-verified 2026-07-08). Train COMPLETE — parallel
lanes: do NOT re-dispatch the re-verify or re-ship; the ~11:00 "legs STILL UNVERIFIED" note is superseded below.**
`src-tauri/src/gaming_orchestrator.rs` (T6b: restore side batches contiguous elevated rollbacks → ONE UAC via the
same sink→`compose_batch_script`→receipts machinery as T6; + rust-tauri-reviewer fixes: post-phase-1 fallback
re-dispatches STAGED items only · `SESSION_OP` try-lock serializes start/stop/recover · bounds-safe
`contiguous_run_end`) · `src/surfaces/gaming-mode.ts` (`restoredSummary` + `GAMING_SESSION_RESOLVED_EVENT` +
`showGlobalRecoveryBanner`/`showGlobalRestoredBanner` pure gates) · `src/surfaces/GamingMode.{tsx,css}` +
`src/App.{tsx,css}` (visible restore-success confirmation on BOTH surfaces — the owner-caught UX gap; sibling-prompt
sync; BOTH global banners defer to the pane on Optimize — the restored banner's missing gate was the self-review
ROUND-2 catch, live-reproduced then helper-extracted + pinned) · guards `GamingMode.test.tsx` (5 pins) +
`gaming-mode.test.ts` (+6) + 6 new cargo tests · `docs/GAMING_MODE_QA.md` #4/#10 notes.
**Review chain fully consumed this time:** round 1 FAIL (items 3+4 + tint) → fixed; round 2 (fresh full rubric,
2026-07-08 ~11:05) FAIL item 3 only — hover item 4 PASSED with computed values (`--fg`/`--border-strong` on both
Done buttons vs danger-red control) and tint confirmed; banner-defer fix + pure helpers → **round 3 PASS 8/8**
(live import of the shipped module for all 7 gate combinations · live-witnessed Optimize view: pane card present,
banner absent · hover re-proven post-refactor). **Verify at `bdc9daa`: cargo 681 + clippy clean · tsc 0 · vitest
1115 (149 files) · rust-tauri-reviewer PASS 0 blockers** (noted-only: receipts TOCTOU pre-existing shared arch ·
no in-script order assertion · qa6 GUID nit). RELEASE_STATE row updated in the same ship-docs commit.
⏳ OWNER: next real session's stop/restore = ONE UAC on the restore side + a visible "Your settings are back"
confirmation naming the changes. Cowork adversarial audit WARRANTED (mutation-boundary diff class).

> Maintained by the HQ/steering session. Anchored to live `main`, not banners. Lanes: read your row,
> stay in your file domain, rebase onto `main` before every push.
>
> **🚌 Live per-lane QUEUES + the cross-lane MESSAGE BUS now live in [`docs/LANE_BUS.md`](LANE_BUS.md).**
> Lanes: run your `/loop` (LANE_BUS §②) and **self-continue** through your queue — never stop to "await
> direction." This STEERING LOG keeps the integrate-verify history; LANE_BUS holds the live work distribution.

### Cycle 2026-07-05d — A5/A6 finishables cleared (Fable autonomous, same session as 05c) — `main` @ `c6c00a4`
The queued non-gated finishables, all six shipped after the HUD pilot checkpoint:
- ✅ `2f698e4` **A6 anchor test** (test-only): export-layer anchor integrity for every RetailLink.
- ✅ `2f5b675` **rig-tag train**: `hw_fingerprint` stamped on every new receipt (one funnel, all
  paths) + driver-insensitive `on_this_rig` · History "This rig only" filter (legacy rows never
  hidden) · "last seen working on" tag/receipt-line/active-card heads-up · fuller before/after
  (TrustSnapshotLine " · set to <after>", locked §6 copy intact). Mutation/rollback boundary
  untouched; rollback still resolves from history.json alone.
- ✅ `d060b07` **supersession chain**: transitive resolver + Learn links the CURRENT end + corpus
  lint pins chain termination.
- ✅ `c6c00a4` **applicability override**: reversible "My hardware supports this" on
  capability-gated recs; same audited apply path; decision on record.
- **Verify GREEN:** cargo 662 + clippy clean · vitest **1013** · tsc 0 · fixture-mount self-review
  at native 1500×980 (`docs/ui-sweep/shots/hud/*fixture*.png`; new `cdp-eval-file.mjs` driver).
- The A5/A6 `[~]` tail is now **zero**; remaining non-gated work is the owner-gated-adjacent
  redesign rollout (waits on the HUD eyeball) — see the top lane.

```
COUNCIL STRIP — A5/A6 finishables train, 2026-07-05
Contrarian: the applicability override is the one risk-bearing item — a user can now surface a capability-gated rec Compy's probe rejected; contained because the apply path, snapshot, and rollback are byte-identical and the pile keeps the decision auditable.
First-Principles: rig identity belonged ON the receipt, not inferred later — stamping at the one funnel makes every future rig feature (filter, tag, per-rig analysis) a pure view over honest data.
Expansionist: per-receipt fingerprints are the substrate for per-rig Receipts aggregation later (Phase C) without a schema migration.
Outsider: the ledger now answers "which PC did this happen on?" — the first multi-rig-aware surface in the app.
Executor: nothing here waits on the owner; the only open asks remain the two preview-toggle eyeballs.
Chairman: the marginal tail is cleared with the boundary untouched — the backlog's non-gated lane is empty, honestly.
```

### Cycle 2026-07-05c — DIRECTION CORRECTION: editorial retired → pure Instrument-HUD Home pilot (Fable autonomous) — `main` @ `b60a2b5`
Owner saw the built editorial and REVERSED it — serif/magazine composition fights a live-telemetry
app. Spec CORRECTED (pure operator-console/Stark HUD, restraint rails, never gamer-RGB); this cycle
executed the correction in one train:
- ✅ `b60a2b5` **editorial retired** (Instrument Serif fonts deleted, `editorial-rooms.css` +
  `HomeEditorial` + 4-room masthead branches removed) + **`HomeHud` pure-HUD pilot** behind the SAME
  preview flag (key `compy_editorial` kept for opt-in continuity; `data-hud`; Settings label now
  "Instrument HUD (preview)", DEFAULT OFF). Console masthead w/ scan LED + segmented readout ·
  bracketed/ruled bay + scanline + event-driven parallax · fps-vs-Hz ring gauge (measured ratio
  only) · graded ink carried over · oscilloscope trace · ranked queue.
- **Checkpoint enforced in code:** HUD is HOME-ONLY — the four rooms ignore the flag
  (`hud-rooms-untouched.test.tsx`); rollout waits for the owner's eyeball.
- **Verify GREEN:** tsc 0 · vitest **1000** (137 files) · `git diff -- src-tauri` empty · self-review
  native 1500×980 (`docs/ui-sweep/shots/hud/`, computed inks CDP-probed) · installer rebuilt +
  silent-reinstalled, **stamp-verified `b60a2b5` live**, one installer on the Desktop.
- **⏳ OWNER:** flip "Instrument HUD (preview)" → react to the HUD Home; on approval the language
  rolls to the other four rooms (+ deep internals de-slop + voice pass). "Guided Lab bench" eyeball
  still pending too (unchanged by the correction).

```
COUNCIL STRIP — HUD correction train, 2026-07-05
Contrarian: two aesthetic pivots in one day — the risk is thrash; the mitigation is that the HUD pilot reuses the proven honest core (same data, same probes) so only the skin moved.
First-Principles: the owner's reversal confirms the diagnosis was right (de-slop) but the prescription was wrong (serif); telemetry wants an instrument voice, not a magazine voice.
Expansionist: the ring-gauge + readout-strip grammar is exactly the share-card shape Receipts will want — the HUD language compounds toward the measurement brand.
Outsider: a first-time user now reads Home as "my PC's cockpit" — the strongest differentiation from optimizer-slop yet; the four un-reskinned rooms are the visible seam until rollout.
Executor: one toggle flip is the whole owner ask; everything else is staged behind it.
Chairman: correction executed same-day with rigor intact; the taste verdict is the owner's again.
```

### Cycle 2026-07-05b — Editorial-Instrument marathon (Fable autonomous, owner away) — `main` @ `1deda2c` **[SUPERSEDED by 2026-07-05c: editorial RETIRED on owner sight; its Lab router rework survives under `compy_lab_guided`]**
The full de-slop redesign train, built solo under the spec's CREATIVE AUTHORITY mandate. ALL of it
behind **`compy_editorial` DEFAULT OFF** (Settings → Appearance "Editorial look (preview)"); flag-off
byte-identity test-pinned per room; zero `src-tauri` diff across the whole train.
- ✅ `1aa85d6` **Home pilot**: Instrument Serif masthead (OFL, bundled, 43KB) · instrument bay (real
  hologram + HUD brackets + whisper scanline + callout leaders + event-driven parallax, no rAF loop) ·
  telemetry ledger · ranked docket. 2 voice defects caught+fixed in self-review.
- ✅ `f3e90c1` **rollout 2-5/5**: shared `editorial-rooms.css` (masthead all rooms, eyebrows, flattened
  seg-control keeping the ink-on-accent invariant, hairline chrome) + **Lab walk-the-bench REMOVED,
  router promoted to "What are you here to do?"** (deslop #1; `compy_lab_guided` still DEFAULT OFF).
- ✅ `1deda2c` setup-door polish. State commits `bbc3845` · `9caa56a` · this one.
- **Verify GREEN at every checkpoint:** tsc 0 · vitest 998→**1006** (19 new guards) · `git diff --
  src-tauri` empty · self-review native 1500×980 shots (`docs/ui-sweep/shots/editorial/`, computed
  inks CDP-probed) · 3 installers built+silent-reinstalled, each **stamp-verified** (`1aa85d6` →
  `f3e90c1` → `1deda2c` live now).
- **⏳ OWNER (the only open gates on this lane):** flip "Editorial look (preview)" and react (taste
  gate for default-ON); eyeball the reworked guided Lab; then the deeper body-copy voice pass rides
  the approved direction.
- **📋 NEXT-SESSION QUEUE (non-gated, session ended at the milestone per the owner's usage-economics
  rule — not a false-done):** the A5/A6 `[~]` finishables, marginal-but-buildable: ledger
  "this rig only" filter toggle · "last seen working on" hardware-tag UI card · fuller before/after
  delta display on ledger rows · applicability override for ineligible recs · supersession chain
  UI · (Rust, test-only) markdown-export anchor test. Plus, AFTER the owner approves the editorial
  direction: deep Check/Fix internals de-slop + body-copy voice pass under the same flag.

```
COUNCIL STRIP — Editorial-Instrument marathon, 2026-07-05
Contrarian: serif-in-a-telemetry-app is the one real bet — if it reads "magazine cosplay" to the owner, the whole language re-anchors on it; flag-off reversibility is the containment.
First-Principles: the slop was shape+type sameness, not color — re-pointing type/geometry/hairlines at the token layer attacked the actual cause instead of adding more decoration.
Expansionist: the masthead/eyebrow/folio grammar is share-card-shaped — the same language can render Receipts exports later (measurement brand compounding).
Outsider: five rooms now read as one printed instrument panel; the remaining tell is the deep Check/Fix card internals, which still speak the old dialect under the new masthead.
Executor: owner flips two Settings toggles, reacts to Home first; if it lands, default-ON + deep-internals pass is the next train.
Chairman: direction executed end-to-end behind its flag with rigor intact — ship verdict now belongs to the owner's eyes.
```

### Cycle 2026-07-05 — Lab linear guided bench (owner-approved spec, CC build train) — `main` @ `2c49ed0`
Spec `docs/superpowers/specs/2026-07-05-lab-linear-guided-bench.md` built in full, 6 commits, behind
**`compy_lab_guided` DEFAULT OFF** (Settings → Appearance preview toggle; flag-off Lab byte-identical, test-pinned):
- ✅ `1b6a9de` flag + byte-identity guard · `0a4cc04` numbered stations (four-line contract, bench order, live line 3
  or honest "No reading yet") · `5e80a41` symptom→station router (map pinned literally) · `815a39a` readings strip
  removed flag-on · `42bbb15` "Walk the bench" read-only step-through (`compy_lab_walk_seen_v1`) · `2c49ed0` polish+shots.
- **Verify GREEN:** tsc 0 · vitest **985/985** (24 new lab-guided guards) · `git diff -- src-tauri` **empty** (zero new
  IPC) · self-review 7 native 1500×980 shots (`docs/ui-sweep/shots/lab-guided/`) · installer rebuilt + silent-reinstalled,
  **stamp-verified `2c49ed0 · release`**.
- **⏳ OWNER:** flip the preview toggle on (Settings → Appearance → "Guided Lab bench"), eyeball; default-ON is his
  taste call (P-series contract).

### Cycle 2026-06-25f — SECOND compy-burst (A5 finishables, owner "+300k") — `main` @ `901e1a5`
Burst (maxItems 2 + A5 focus; triage returned 3 disjoint): **3 shipped · 0 skipped · GREEN.**
- ✅ A4 Monitor: FreeSync↔VRB exclusion **warning** (advisory, not strobe-detection — honest angle) (`49b03f3`).
- ✅ A5: **override/restore-all toggle** (`1675995`) — correctly re-scoped to `dismissed.ts` + `Fix.tsx` this time
  (the new `focus` arg fed the right files; the item the last burst honestly skipped is now built).
- ✅ A4 Services: **use-case profile selector** (Gaming/Streaming/Creation/General, localStorage) (`901e1a5`).
- **Verify — HQ clean re-run GREEN:** cargo **636** · vitest **643 files / 3958 tests** · build clean. The burst's
  verify agent FALSE-REDDED ("globals undefined env-wide") — same leftover-worker contention flake as last burst;
  build agents saw vitest 658/665 green mid-build, and my clean re-run passed. **Hardened the workflow verify phase**
  to kill stray workers + re-run clean before reporting red, so the agent's verdict becomes trustworthy (stops the
  recurring HQ re-verify cost).
- **💰 Cost:** ~650k total / ~470k output for 3 items ≈ **~155k output / ~217k total per item** (in line with the
  ~200k calibration). Two bursts this round delivered **5 features** total.

### Cycle 2026-06-25e — FIRST compy-burst run (cost-bounded workflow PROVEN) — `main` @ `a1fd03e`
First real run of `scripts/compy-burst.workflow.js` (maxItems 3): **2 shipped · 1 honestly skipped · GREEN.**
- ✅ 3-mode preset GUIDED checklists (`1daf03b`) · ✅ hardware-applicability tags on knowledge entries (`a1fd03e`).
- ⏭️ override-all toggle SKIPPED by the build agent — its assigned files couldn't support it without orphaned/incoherent
  UI; it refused + flagged the re-scope (needs `dismissed.ts` + `Fix.tsx`). Good discipline, no fabrication.
- **Verify GREEN:** cargo **636** · vitest **1956 / 318 files** · build clean. (HQ note: my first vitest re-check flaked
  "318 failed/no tests" from leftover burst workers — clean re-run passed. Re-confirm flakes in isolation, don't revert.)
- **💰 COST CALIBRATION:** burst cost **~660k total / ~402k output** for ~2 items ≈ **200k output/item** — ~2× the 60k
  estimate. `COST_PER_ITEM`→200k; LANE_WORKFLOW §3 updated. Rule of thumb: ~300k→1 item · ~600k→2 · ~1M→4.
- Structure VALIDATED: bounded, finite, self-skips gated/incoherent work, and HQ's independent re-verify caught the
  flake the agent's self-report missed — the safety net works.

### Cycle 2026-06-25c — API-error AUTO-RECOVERY (owner: "resume isn't recovering from the API error")
**Diagnosis:** the honesty lane resumed correctly (RECOVER-FIRST worked — it read LANE_BUS, found its
assignment) then hit a **rate-limit mid-task and halted with no auto-restart.** Root cause: RECOVER-FIRST (§⑦)
is *what to do on wake* — it can't *make* a dead loop wake. A bare `/loop` does NOT reliably survive an API
error (it can abort before rescheduling); re-sending by hand re-hits the transient throttle.
**Fix — the missing WAKE mechanism:** new **`scripts/lane-runner.ps1`** (LANE_BUS §⑨) runs a lane headlessly
(`claude --print`) in an **exponential-backoff retry loop** (30s→10min) + **`--fallback-model`** (rate-limit →
auto-switch model, not death). Because RECOVER-FIRST + the bus make a lane **stateless** (every tick reconciles
from git + LANE_BUS), each retry is a fresh cold run that resumes exactly where it left off — nothing lost or
duplicated. PowerShell parse-verified. Three resilience tiers documented (wait-and-resume · `--fallback-model`
on interactive tabs · the runner for hands-off; `-BypassPermissions` = owner opt-in for unattended).
**Corrected §②'s earlier over-claim** that `/loop` self-recovers from API errors — it doesn't. `main` green; script + docs only.

### Cycle 2026-06-25d — autonomous fleet STOPPED to conserve tokens; Phase-A non-gated work ~complete
**Owner directive:** complete all work + be self-sufficient, but **minimize tokens** (half the weekly budget already
spent). The 5 bypass-perms runners had each looped ~50 ticks (full Claude sessions) → that was the burn. **Stopped
all 5 runners** (TaskStop + verified no `lane-runner` loop alive; building ceased, main stable). The dashboard
(`lane-dashboard.ps1`) still shows the worktrees (now idle).
**What the fleet delivered (all green, all on main):** cargo **636** (+70 this session) · vitest **643** / 105 files
(+85) · build ✓ @ `0c2d4ce`. Across the run lanes shipped, e.g., service inventory + startup-drift + recovery guide +
network-readiness pills (backend), hardware-tier segmentation + LOCAL percentile (measurement, A2 done), USB-tier +
interrupt-affinity + wired-vs-wireless (peripheral), refresh-rate/powerline-MoCA/AMD-undervolt/eDPI/driver guides
(content), and a full tweak-debunk corpus honesty audit + extra Rule-5 guards (honesty). Cross-lane handoffs +
gate-flagging (DNS probe held as outbound-gated) worked end-to-end.
**Remaining work, tiered (for token-aware prioritization):**
- ⛔ **WALLED (impossible w/o kernel/vendor SDK — do NOT spend):** OSD detection · FreeSync↔VRB strobe detection · (+ the [[detection-feasibility-walls-usermode]] set).
- 🟡 **Buildable but MARGINAL (low ROI — deferred):** 3-mode preset checklists · monitor model-hint cards · use-case profile selector · A5 override toggle.
- 🔒 **GATED = the real remaining VALUE (needs an owner gate decision, not tokens-on-spec):** Phase B mutations (GPU-profile apply, service-suspend arming, bloat removal, one-click re-apply) · Phase C telemetry/Receipts · Phase D money/affiliate/funnel.
**Recommendation:** the high-value work left is GATED — spend remaining budget there *after* you open a gate, not on the marginal Phase-A tail. Phase-A non-gated product completeness is effectively DONE.

### Cycle 2026-06-25b — crash-recovery / resume-after-API-error (owner ask)
**Owner ask:** let sessions re-establish work / resume after API errors that halt the loop.
**Added to `LANE_BUS.md`:** (§① step 0 + §⑦) a **RECOVER-FIRST routine** that makes each lane loop **idempotent**
— on every wake it surveys uncommitted WIP (finish+commit or stash-with-note, never discard), handles a
half-rebase, checks whether the item already landed (merge-tree no-op / BACKLOG tick → skip, no duplication),
re-establishes a green cargo+npm baseline, then resumes. (§⑧) a **WATCHDOG**: steering reads each lane's
last-activity by its **file-domain on origin/main** (branch HEAD false-alarms since lanes merge via ephemeral
branches) and posts a restart instruction + pings owner for any lane quiet >~30m with open queue work. The §②
loop prompt now leads with RECOVER-FIRST and is explicitly idempotent.
**Why it survives API errors:** committed work is on origin, WIP is in the worktree, the checkpoint says where the
lane was → a restarted loop resumes without loss or duplication. `/loop` already rides out *transient* errors
(next tick recovers); a *hard* halt is recovered by RECOVER-FIRST on restart (manual / stop-hook / watchdog-prompted).
**Live watchdog run:** peripheral active (30m) · backend/content/honesty idle 3–4h (no loop running) · **measurement
~13.6h stalled — restart needed.** `main` @ `2f134e6` green; docs-only.

### Cycle 2026-06-25a — LANE BUS established (owner ask: lanes self-sustain + coordinate)
**Owner ask:** a lane ("Tab 2") was stalling "awaiting direction from steering"; make lanes able to communicate +
prompt one another to continue to the next task after completion → sustained autonomous workflow.
**Built `docs/LANE_BUS.md`:** (1) a **self-continuation protocol** every lane runs — after finishing an item it
rebases, pulls the next item from its queue, and continues; the only valid "wait" is a *posted* `queue dry` request,
never a silent stall. (2) A **per-lane queue** (backend · measurement · peripheral · content · honesty) with disjoint
file domains + deep runway from the open A4/A5/A3 items. (3) A **claimable pool** (Monitor/Display, GPU-advisory,
etc.) lanes grab via the message log so two never collide. (4) An append-only **message bus** for cross-lane
hand-offs / dependency signals / refill requests. (5) **Collision rules** (disjoint domains, only backend edits
`lib.rs`/`actions.rs`, honesty claims shared files, rebase-before-push, merge-tree no-op check).
**Mechanism (honest):** separate sessions can't wake each other → the channel is this file via git + each lane's
`/loop`. **OWNER ACTION to activate:** paste the §② `/loop` prompt into each lane tab once (esp. the stalled
`measurement` tab). `main` @ `02f9d1b` green (cargo 582 · vitest 565 · build ✓); docs-only change, no code touched.

### Cycle 2026-06-24f — `main` @ `1648c00`+ · integrated tree GREEN (measured)
**Two pushes integrated + verified** (counts re-RUN, not assumed): `lane/honesty` → LOCKED-rule-5 fix —
vendor-gate NVIDIA GPU temp in **Overlay + LiveCharts** onto the one-source `gradeGpuTempForVendor`, + a
class-wide `gpu-temp-gate-guard.test.ts` that fails if any `.tsx` calls `gradeGpuTempC` bare (`8355c4e`);
backend/ledger → A5 **true before→after delta in the Trust Ledger** (pure `applied_label_from_action()` in
`history.rs`, read-only, exhaustive match so a new catalog action can't silently mislabel) (`1648c00`).
Both read-only, no IPC/capability/mutation. **Verify:** cargo **582** · vitest **565** (94 files) · `npm run build` ✓.
Also this turn: merge-tree no-op guard added to the protocol (§5) + memory [[branch-redundancy-detect-by-mergetree]].

### Cycle 2026-06-24e — branch-redundancy CORRECTION (honesty fix to this ledger)
**Trigger:** owner greenlit landing `qa/locale-drift-hardening`. Setting up the isolated merge, the result tree was
**byte-identical to main** (`git diff main HEAD` = 0 lines) → its rollback-safety fixes are **ALREADY IN MAIN** via
PR #6 `5ab304d` ("fail-safe refuse instead of fabricating rollback snapshots across the mutation boundary, 5 paths").
`git cherry` showed `+` only because the PR landed under different hashes. Same for `gaming/honest-partial-undo` →
**already in main** via PR #7 `47e93e6` (no-op merge). **Both were redundant, not stranded.** My earlier
"🔴 stranded safety work needing owner sign-off" framing (cycles a–d, and the branch-health note) was **WRONG** — lanes
merge via PRs, leaving same-content branches behind by hash. The "always clean-merges" signal I kept citing was clean
*because* it was a no-op.
**Actions:** discarded the no-op merge + its worktree; **pruned `qa/locale-drift-hardening` + `gaming/honest-partial-undo`**
(content proven 100% in main, reflog-recoverable). Completeness sweep — the 3 remaining unmerged branches DO carry real
divergent content, stay archived (do NOT land): `feat/a1-detection` (~666 lines, 4-probe superseded by 7-probe),
`latency-capture` (~196, overlaps `latency.rs`), `tests/coverage-sweep-2026-06-18` (~410, value already folded).
**🔧 Cargo-count CORRECTION:** main is **580** (measured directly this cycle), not the **566** I carried in cycles c–d.
That 566 was assumed from a truncated capture + a commit message and NOT re-run — cycle d's "verified, not assumed" was
itself inaccurate. The real count rose 566→580 at cycle b when `services.rs` landed and never dropped back. (vitest 564, build ✓.)
**New lane:** `lane/honesty` worktree spun up (`C:/Users/Kuya/code/sentinel-honesty`, synced to main, no work yet).
**Net:** the rollback-safety property the owner greenlit is already shipped — nothing to merge; ledger now matches reality.

### Cycle 2026-06-24d — `main` @ `327cc87` · integrated tree GREEN
**Two more frontend/data pushes:** content → A4 **monitor motion-clarity explainers** (strobing/ULMB, overdrive,
GtG-vs-MPRT) in `terms.json` +24 (`6d41137`); agent → A4 Peripheral **plain-English polling-rate class** on the
mouse card (`Latency.tsx`/`latency-view.ts`, `327cc87`). Disjoint, read-only/advisory, zero src-tauri/IPC/capability.
**Integrate-verify:** vitest **564** / `npm run build` ✓; cargo unchanged at **566** (no `src-tauri` diff since the
565d94b run — verified, not assumed). **Lane heartbeat:** content + agent actively shipping; **`work/bench` now 16
behind, still no push — bench's A2 tier-segmentation looks stalled (2 cycles).** Owner items unchanged
(`qa/locale-drift-hardening` clean-merge gated; brand-voice skim now spans 6 new Learn debunks).

### Cycle 2026-06-24c — `main` @ `565d94b` · integrated tree GREEN
**Two more pushes integrated:** content/knowledge → A4 **color-science debunks** (sRGB-clamp, gamma-vs-HDR,
chroma-subsampling) in `terms.json` +24, zero `Learn.tsx` change (`113a2d7`); Phase-B → **service-suspend
dark-contract test** (`gaming_orchestrator.rs` +95, `docs/SERVICE_SUSPEND_QA.md`) proving the gate stays false
(`565d94b`). **Integrate-verify:** cargo **566** (exit 0) / vitest **562** (a transient teardown-race "2 errors"
cleared on rerun, not a failure) / `npm run build` ok.
**Gate re-check:** `service_suspend_gate()` returns `false` in prod (only `#[cfg(test)]` thread-local opens it,
compiled out of shipped binary; pinned by `gate_is_dark_until_qa_and_owner_signoff`) — **Phase B still DARK.**
**Owner items:** (1) `qa/locale-drift-hardening` still review-ready/clean-merge (rollback-safety, gated);
(2) content lane flagged the 3 new debunks for a brand-voice skim (`113a2d7`). Content shipped an A4 item, so
its A3 **entry-metadata** assignment stays open. No new branches to prune; frozen refs (`16069fa`) untouched.

### Cycle 2026-06-24b — `main` @ `2eb336a` · integrated tree GREEN
**Two lanes shipped + verified together:** backend → A4 read-only **service inventory by category** (new
`services.rs` +465, `diagnostics.rs`, `lib.rs` +1 — `b5b16b0`); agent → latency **timer-resolution range** +
fmtMs/severity tests (`234115c`, `7f93f28`). Disjoint (`services.rs`/`diagnostics.rs` ⟂ `Latency.tsx`/`latency-view.ts`;
`lib.rs` touched once). **Integrate-verify:** cargo **580** · vitest **562** · `npm run build` ✓.

**HQ read-only audit of `services.rs`** (mutation-adjacent module, so audited at source, not just by green tests):
WMI `SELECT Name,DisplayName,State,StartMode FROM Win32_Service` only — no `ExecMethod` / `OpenSCManager` / `sc` /
PowerShell / registry-write / process-spawn; `lib.rs` +1 = `mod services;`; surfaced via diagnostics.rs's EXISTING
command (no new IPC); no capability/CSP change. Verdict: **read-only — Phase-B service-suspend boundary NOT crossed.**

**Next assignments (still disjoint; only backend likely edits `lib.rs`):**
- **backend/readiness** → A4 Services **service-drift detection** (extend Leftovers — read-only advisory, builds on the inventory just shipped). *(curated safe-to-suspend list stays owner-gated.)* Domain: `services.rs`/leftovers + `lib.rs` reg.
- **agent/peripheral** → A4 Peripheral **wired-vs-wireless latency model** (STILL OPEN — agent did timer-res this cycle instead). Domain: `latency.rs` + `Latency.tsx` / `latency-view.ts`.
- **bench/measurement** → A2 **hardware-tier segmentation** (unchanged — no push this cycle). Domain: `benchmark_scoreboard.rs` + `Benchmark.tsx`.
- **content/knowledge** → A3 **entry metadata** (unchanged — no push). Fresh branch off `main`. Domain: `knowledge*.ts` + `Learn.tsx`.

**Owner-gated (unchanged):** `qa/locale-drift-hardening` re-verified **still merges CLEAN** onto `2eb336a` (4 ahead / 35 behind) — review-ready, merge owner-gated. No new branches to prune; frozen refs (`16069fa`) untouched.

### Cycle 2026-06-24a — `main` @ `b90bd1d` · integrated tree GREEN
**Integrate-verify (merged agent + bench push):** cargo **566** · vitest **558** · `npm run build` ✓ (only the
pre-existing >500 kB chunk advisory, not a regression). Agent (`Latency.tsx` / `latency-view.ts`) ⟂ bench
(`Benchmark.tsx`) — disjoint files, clean compose.

**Lane assignments (disjoint file domains — only the backend lane edits `lib.rs` this cycle):**

| Lane | Next item (non-gated) | File domain | Keep OUT of |
|---|---|---|---|
| **backend/readiness** | A4 Services → real **read-only service inventory by category** (expand the 4-service stub at `history.rs:118`). *(curated "safe-to-suspend" list = owner-curated/gated — NOT this)* | `src-tauri/{history.rs, new svc module, lib.rs reg}` | `actions.rs`\*, `benchmark_*`, `latency.rs` |
| **bench/measurement** | A2 → **hardware-tier segmentation** (budget/mid/high LOCAL mapping; wire the unwired `percentile_rank`). *(cohort percentile = Phase C gated)* | `src-tauri/benchmark_scoreboard.rs` + `Benchmark.tsx` | `lib.rs`, `history.rs`, `latency.rs` |
| **agent/peripheral** | A4 Peripheral → **wired-vs-wireless latency model** (pure advisory over existing latency + adapter data) | `src-tauri/latency.rs` + `Latency.tsx` / new `Peripheral.tsx` | `lib.rs`\*, `benchmark_*`, knowledge |
| **content/knowledge** | A3 → **category + hardware tags + date-added/last-updated** entry metadata (the named A3 gap, lines 81–82). Start a FRESH branch off `main` (current `feat/blackbook-lifecycle` is fully merged) | `src/data/knowledge*.ts` + `Learn.tsx` | all `src-tauri/`, other surfaces |

\* Prefer pure-logic / reuse existing IPC so only ONE lane touches `lib.rs` / `actions.rs` per cycle.

**🔴 Stranded work to land (surface to owner — needs per-PR sign-off):**
> **❌ SUPERSEDED by Cycle 2026-06-24e:** both branches below were found to be **already in main** (PR #6 `5ab304d`
> and PR #7 `47e93e6`) — redundant, not stranded; both pruned. The "clean-merge" claim was a no-op. Disregard this block.
- `qa/locale-drift-hardening` (4 ahead, 29 behind) — **real mutation-boundary safety fixes**: refuse instead of
  fabricating a rollback snapshot when powercfg / HAGS priors are unreadable (completes the key-open-collapse
  fail-safe tier — this is the fix for the 2026-06-22 completeness-critic finding). Touches `actions.rs` (the
  rollback boundary) → **owner per-PR merge instruction + adversarial review required** ([[merge-to-main-needs-explicit-per-pr-instruction]]).
  ✅ HQ-verified: **merges CLEAN onto current `main`** (no conflicts; diff = `actions.rs` +233/−44, `lib.rs` +85 guard tests).
  No rebase conflicts to resolve — it's review-ready; **the merge itself is owner-gated.**
- `gaming/honest-partial-undo` (1 ahead) — honest-error fix in gated Gaming-Mode code; land when Gaming-Mode QA resumes.

**Hygiene done:** pruned `spike/backend-agent` + `benchmark` (fully merged). Superseded/stale, left in place
(unmerged — kept as archive, do NOT land; all HQ-verified, not inferred):
- `feat/a1-detection` (658 unique lines = the 4-probe A1; superseded by the owner-chosen `reconcile/a1-merge` 7-probe — retained per CLAUDE.md).
- `latency-capture` (195 unique `latency.rs` lines = an **older latency impl** superseded by the active agent lane; **overlaps `latency.rs`** so it would collide — don't land).
- `tests/coverage-sweep-2026-06-18` (its 4 frontend test files + the `guided.ts` ms-settings allowlist enforcement are **confirmed present on `main`**; trivial 1-line `guided.ts` delta remains — coverage value is already shipped).

Frozen beta refs (`16069fa`) untouched.

