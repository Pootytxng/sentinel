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

### ⭐ FOUR-ROOM. The approved four-room visual direction (issue [#49](https://github.com/Pootytxng/sentinel/issues/49), owner-approved comps 2026-08-23) 🟢 ALL SEVEN SLICES BUILT · unpushed

Four approved PNGs (Health · Live · History · Test) + `HANDOFF.md` in
`~/.codex/visualizations/2026/08/23/01a02bee.../compy-four-room-handoff/`. Every comp is the SAME
composition — a narrative column beside an evidence column — so the split lives in `RoomShell`
once, not as four bespoke grids. Build order is the handoff's: shell → Health → shared instruments
→ Live → History → Test → convergence.

| Slice | State |
| --- | --- |
| 1. Shell alignment | ✅ `34bd33e7` — `aside`/`below` slots, `--v2-aside`, grid-areas (no wrapper divs) |
| 2. Health | ✅ `40aca1ca` — installed; self-review round **11** PASS, after ten FAILs that left eleven permanent guards |
| 3. Shared instrument kit | ✅ `acdb93c2` — `Reading` → `src/design/console/`; installed; round **12** PASS, re-measured pixel-identical to R11 |
| 4. Live | ✅ `67ce2724` — installed; self-review round **13** PASS, a real Start→Stop capture exercised on the built app |
| 5. History | ✅ `c894e81c` — the record becomes a document; shell re-measured off all four comps (content box, topbar, two aside families, `--type-hero`) |
| 6. Test | ✅ `8c9fb804` — the approved composition; the bench readings ruled apart from the hologram |
| 7. Whole-app convergence | ✅ `0c550138` — round **16** PASS. Two **cascade ties** closed (a later same-specificity rule was beating `shell-v2.css`, so Health's because-line rendered outside its column and three headlines were 26px against comps measuring 52/40), Test's emoji became the comp's six measured line marks, its row subtitles took the comp's wording, and four drifted room eyebrows became one `RoomEyebrow`. Three guards now walk **every** `.css` under `src/` — a single-file source read cannot see a cascade, which is how round 14 passed green while the app was broken |
| 8. Codex findings 1–3 + mainline merge | ✅ `8b1599b3` — **the installed build**; round **17** PASS, a full fresh round on the shipped binary. `main` merged in with zero app-code change, three literal `var()` fallbacks removed from the console layer (proved computed-style no-ops), and the guards that let those findings be caught at all: the tokens/comp-fidelity sweeps now read the console sheets, and `verify-release-state.mjs` gained check **(9)** — the Bottom line is read, not merely counted, so a superseded desk stamp cannot sit in the prose while the anchor says otherwise. Findings **4–8 closed in `dae29252`** — each measured first (zero offenders, so no allow-list) and falsified after by injecting the real defect; the same pass caught a guard of our own that had been silently skipping (`shortcut.test.mjs`, now 0 skipped) |

**⚠️ SUBSTITUTIONS — shipped simpler than the comp, needing the owner's sign-off** (false-done
protocol: a reskin that quietly drops parts of the comp is not the comp):

1. ~~**Primary action is VIOLET, not green.**~~ **RESOLVED `c894e81c`** — the owner overruled the
   violet on sight. Health, History and Test wear the green `--v2-cta` their comps draw; Live keeps
   violet, which is what ITS comp draws. The token lives in `tokens-v2.css` and
   `comp-fidelity-guard.test.ts` pins it, so a later "let's be consistent" pass cannot flatten the
   difference back.
2. **The "What's been happening?" rows carry no icon and no sub-description.** The comp shows both.
   The app has no symptom icon set, and a per-row description would be new copy the interview data
   does not have — and the handoff bars mockup copy from becoming product copy by default. Rows
   are the interview's own verbatim labels + a chevron.
3. **The readiness cell keeps ArcGauge's ring-left / label-right layout;** the comp stacks the
   label above the ring and adds a "GOOD" grade word beside it. Restructuring the shared gauge is
   slice 3's job by the handoff's own sequence, and the grade word is content the strip does not
   currently hold.
4. **A symptom picker is back on Health.** The owner deleted a permanent "What are you here to do?"
   panel on Home on sight (2026-08-12) and the guard keeping it deleted is still green — the
   approved comp's frame ("What's been happening?") and wording are different, and the comp is the
   newer decision. Flagging it anyway, because it is the same slot he once rejected.
5. **The rig keeps its control row (3D / Cards / Exploded / Orbit / All parts);** the static comp
   shows no controls between stage and readout. The handoff's own Health spec requires preserving
   that behaviour, so the comp is the incomplete half here, not the build.
6. **In the attention state the verdict sub-line stands down** in favour of the separate
   "Checked · Fix in Test" band; the comp shows one always-present sub-line. Pre-existing
   2026-08-20 logic, untouched by this train — listed so the difference is not read as drift.

_Slice 4 (Live) adds:_

7. **The evidence column's trace is the LIVE buffer, not a persisted session trace.** The Live comp
   draws a frame-rate line inside the last-session panel. There is no stored per-frame series
   behind a session record — `SessionSummary` carries averages, lows and peaks, nothing per-sample —
   so the picture's line is a design-pass example with no data behind it. The panel shows the real
   1 Hz capture buffer with its own honest empty state instead. Inventing a stored trace to match
   the picture is exactly what the honest-measurement law bars. **Making the comp literally true
   would need a new backend series**, which this train is barred from adding.
8. **A missing CPU temperature reads as Health's quiet "No reading", not Live's amber pill.** The
   two approved comps disagree with each other here: Health shows `—` with a quiet grey line, Live
   shows `—` with an amber outlined NO READING pill. Both rooms now use Health's treatment — the
   one that passed self-review rounds 11 and 12 and is the shared kit's — because amber is
   `--v2-warn` ("something is wrong with your PC") and an absent sensor SOURCE is not that. Slice 7
   is where a single answer has to hold anyway.
9. **Monitor no longer wears the Instrument-HUD masthead — in either flag state.** Live's approved
   header is the narrative one (eyebrow → verdict → sentence → action), and Sessions is one tab
   away, so leaving the HUD masthead on Sessions would have put two header idioms inside one room.
   Both faces now wear the room's header, the same way UX-1 retired the masthead from Home
   (`docs/decisions/2026-08-11-design-foundation.md` decision 1 — "the front door is a verdict").
   The owner title-header law of 2026-07-10 was written against a NOTIFICATION standing in a
   header; what replaces the title here is the room's measured verdict. Re-pinned in
   `hud-rooms-flag.test.tsx`, which now also proves no HUD chrome survives on Monitor either way.
   History followed in slice 5 (`c894e81c`) and the rollout list is now empty — the per-room
   loops in `hud-rooms-flag.test.tsx` are replaced by the assertion that neither room may grow
   a masthead BACK, in either flag state. `HudMasthead` survives only in LabGround.
10. **Live gains ONE primary action where the room had none.** The comp makes Start capture the
   dominant action. The control MOVED out of the console's control row rather than being copied,
   so the screen still carries exactly one capture toggle (`monitor-console.test.tsx` proves the
   count). Sessions still has no primary action.

**⚖️ OWNER RULING 2026-08-23 — THE COMPS ARE THE SPEC, AND THE LADDER STAYS.** He put all four
approved PNGs back on the table beside the installed build and said, verbatim: *"this is exactly how
its supposed to look and it still isnt quite there not sure how you werent able to match this
perfectly but it needs to to suffice. what should remain is the color coded system we have for alert
levels such as green yellow red for optimal metrics and notifications please persist with this train
until youve perfected your work"*. Three things follow.

1. **The bar moved from "defensible deviation, logged" to "match the picture."** A difference is a
   finding, not a taste call to argue for. The fidelity self-review is briefed that way from now on:
   *every* difference is reported, with no allowance for a documented or defended one — the round-13
   brief told the reviewer the deviations were pre-logged substitutions, so it passed a room he then
   said was not there yet. That framing was the miss.
2. **Substitutions 1 and 8 are OVERRULED, and the comps were right both times.**
   • **1 (violet primary)** → Health, History and Test take the comps' GREEN (`--v2-cta`, sampled
   #2ecf86 / #28d582 / #2fcd82 across the three PNGs); Live keeps violet, because 02-live-approved
   draws it violet on purpose — its button starts and stops a MEASUREMENT, which is a mode switch,
   not an affirmation. This also re-supersedes the 2026-08-20 issue #180 §C button-placement pick.
   • **8 (quiet "No reading")** → Health keeps the quiet grey, Live shows the amber `NO READING`
   pill. The two comps disagreeing was the answer, not the problem.
3. **The green/amber/red ladder is a keeper, named by him.** `comp-fidelity-guard.test.ts` pins the
   whole ladder — both ends and the middle — so a later "let's make this consistent" pass has to
   argue with the approved picture instead of quietly flattening one rung to grey.

_Slice 5 (History) adds these deviations:_

11. **The shell keeps its honest outbound footer; the comp's is "Local record · nothing sent."**
   Rejected MECHANICALLY, not by taste: `src/outbound-claim-guard.test.ts` fails the build on an
   absolute offline claim, and the signed updater is live (Capability Exception Gate, 2026-08-09).
   The comp's line would be a false claim in a picture's clothing.
12. **The narrative and evidence columns start flush; the comp offsets the record downward.** The
   split is one grid with shared rows so the two columns cannot drift apart on a long verdict.
   Faking the offset would mean a hard-coded top pad that becomes wrong the moment the headline
   wraps to a third line.
13. **History's "manage N changes" route keeps its counted copy** where the comp shows an uncounted
   label. The count is a real number the room already holds, and dropping it to match a picture
   would trade a fact for a wording.

**🔧 SELF-REVIEW ROUND 1 — FAIL, fixed, guarded.** The reviewer read the installed room against
`01-health-approved.png` and caught the h1: at 40px Health said **"Applied Compy changes"**. The
owner's name-it-and-fix-it-inline law makes the verdict BE the flagged check's label, and
`system-posture.test.ts` pins `headline === label` — but every Attention branch in
`src-tauri/src/readiness.rs` emitted a neutral category noun, so the law produced a filing-cabinet
tab. The guard's own fixture ("Monitor below max refresh") is what its author expected the catalog
to emit; it never did. **All ten Attention labels now name the finding** (calm rows keep their
category label, which is correct for a row that says "fine"), and
`src/surfaces/readiness-attention-label-guard.test.ts` scans the Rust catalog and fails if any check
ever reuses its calm label for its attention state. Proven to fail on the old source before the fix
landed.

**🔧 SELF-REVIEW ROUND 2 — FAIL, fixed, guarded.** Two findings, both against
`01-health-approved.png` on the installed build.
**(a) The HUD readout was covering real readings at rest** — the READINESS / AVG FPS numbers at
1280×720, and the Detected record's Processor row at 1500×980, the owner's actual viewport. Its
clearance was `padding-bottom`, which only clears the END of a document; the readout is fixed to the
VIEWPORT, so at any scroll offset it painted over whatever sat in its band — and the 2026-08-20
intimidation pass had given it an opaque ground, turning a smudge into a curtain. **A covered reading
reads as an absent one, so this is an honest-measurement failure, not a cosmetic one.**
`.v2-shell-hud .v2-content` now reserves the band with `margin-bottom`, shortening the scroll
viewport itself. **(b) The readout was printing the CPU/GPU model a third time** on Health — the
Detected record names both parts and the 3D rig annotates them — against `HudFrame.tsx`'s own
doctrine that the readout carries only values no other chrome shows. The rig segment now stands down
on Health and the readout collapses to the clock; every other room is unchanged. Guards:
`src/design/console/hud-frame-clearance-guard.test.ts` (parses the stylesheet's declared geometry and
fails if the reserve is a padding or is smaller than the band the readout occupies) and
`src/design/console/hud-readout-no-duplicate-guard.test.tsx` (renders the shell on Health and on a
room that does not show the rig, so it cannot pass by the frame vanishing). Both proven to fail on
the pre-fix source. **Round 3 is required before slice 2 can be called done** — the owner's rule is
that any visual correction earns another complete self-review.

**🔧 SELF-REVIEW ROUND 3 — FAIL, fixed, guarded.** Round 2's margin reserve worked (zero
intersection at 1500×980 and 1920×1080, and the Health readout now carries only the clock while the
Detected record still names both parts). The fresh review found the neighbouring half of the same
problem at **1280×720**: the comfortable-viewport stage box — `min-height: 500px` + 40px padding —
costs 540px of a scroll lane that is only ~595px tall, so `.hc-readout` started at content-offset
~568 and `.v2-content`'s own overflow **sliced the strip in half: five labels on screen, none of
their values.** Five labelled readings showing no numbers do not read as *scroll down*, they read as
five readings that came back empty — honest measurement again, not layout taste. Round 2's reserve
could not have fixed it: it stops scrolled content entering the readout's band, it cannot create
height a 720px window does not have. **The stage floor now compresses below 860px of viewport
height** (320px stage / 280px rig / 280px card ceiling) — the rig is the one genuinely elastic
element on Health, since a shorter box is simply a smaller rendered canvas while every other block
is text at a fixed size. The threshold sits well below the owner's real 980px window, so his
viewport and the comp's proportions are untouched. Guard: the new short-viewport case in
`src/surfaces/home-console.test.tsx` pins the threshold band, re-checks the card-viewport derivation
inside the override, and caps the compressed stage box at the measured 397px that keeps the strip
above the fold. Proven to fail on the pre-fix CSS.

**🔧 SELF-REVIEW ROUND 4 — FAIL, fixed, guarded.** Round 3's fix set the stage FLOOR
(`min-height`) and looked right — `getComputedStyle` really did report 320px — while the box on
screen stayed 500px and the readings stayed sliced. **The rig is an r3f `<Canvas>` that measures its
parent and writes its own inline pixel size, and the parent, having no `height` of its own, is then
sized by that canvas.** That circle has no bottom: lowering a floor under a box already taller than
the floor changes nothing, so nothing re-measures and the canvas keeps the inline height it was
given at the previous window size. Growing the window worked (a floor CAN push a box up), which is
exactly why the bug survived a round — and the launch-then-shrink path that misses it is the one
every human and every capture harness actually takes. The override now states an authoritative
`height` for the stage and the rig, which breaks the circle from the outside. Guard: the same
short-viewport case now REQUIRES an explicit height on both boxes and that it agree with the floor.
Proven to fail on round 3's CSS.

**🔧 SELF-REVIEW ROUND 5 — FAIL, fixed, guarded.** The round-4 fix VERIFIED on the installed
build — canvas back to its stated height, all five readings above the fold at 1280×720, the tall
viewport regrowing correctly — and the round still failed, on the rubric's prior-decisions item.
Rounds 3 and 4 delivered that fix as an `@media (max-height: 860px)` block, and the owner-approved
handoff rules that out in as many words: *"The current desktop shell intentionally has no responsive
media queries. Do not add breakpoints as a shortcut. The finished composition must still be proven at
1280×720, the owner's real 1500×980 viewport, and 1920×1080."* Two commits shipped past a live
decision without naming the conflict — the defect here is the MECHANISM, not the pixels.
Health's geometry is now **one continuous derivation**: the stage absorbs the whole viewport
difference between a floor and the comp's ceiling, `clamp(320px, calc(100vh − named chrome), 500px)`,
with every subtrahend a named variable someone can check. The owner's 980px window and 1080p still
land on exactly the approved 500px stage; 720p lands on 351px and the strip clears. Guard: the same
case now REJECTS any `@media` rule in `home-console.css` and re-runs the arithmetic at all three
proof heights. Proven to fail on round 4's CSS.

**🔧 SELF-REVIEW ROUND 6 — FAIL, fixed, guarded.** The fluid geometry VERIFIED: measured inner
viewports 971 / 711 / 1071 across a resize-up, resize-down and resize-up-again cycle, with the stage
landing on the comp's exact proportions at the owner's window and at 1080p. The round failed on a
DIFFERENT defect at 1280×720, present since the readout strip was built and never caught: the
readiness cell's content ran 25px past its own column, so **READINESS and AVG FPS touched with zero
gap** and the MEASURED pill sat on the neighbouring reading. Cause: an `fr` track's automatic minimum
is min-content, so the wide first track could not shrink below the ArcGauge's intrinsic width — the
other four tracks already carried `minmax(0, …)`, that one never did. Two readings that overlap are
not two readings, so this is an honest-measurement failure, not a spacing nit. The symptom was
Health's and the defect is the KIT's, so both halves are fixed at the source: `minmax(0, 1fr)` on the
gauge's own label column and `min-width: 0` on the item, plus `minmax(0, 1.4fr)` on the readout
track. Guards in `home-console.test.tsx` (no bare `fr` may survive in the readout, so a sixth reading
cannot reintroduce it) and `arc-gauge.test.tsx` (the kit's own rule, for every room that ever puts a
gauge in a flexible cell). Both proven to fail on round 5's CSS.

**🔧 SELF-REVIEW ROUND 7 — FAIL, fixed, guarded.** The fluid geometry passed again, and the
SAME 25px collision came back at 1280×720 by a different mechanism: clamping the readiness track to
`minmax(0, 1.4fr)` never made its contents smaller — it moved the overflow INSIDE the cell, where
"Readiness" (one unbreakable word at the 13px type floor) rendered 85px in a 60px box. An fr share of
1.4/5.4 hands that track 126px while the instrument intrinsically needs 151. So round 6 fixed the
container and left the reading clipped. This round measured every cell instead of guessing a fourth
time: readiness 151 · avg fps 73 · 1% low 73 · gpu temp 76 · cpu temp 76, in a 533px content box —
the strip was **16px over-subscribed**, and the four number cells had under 1px of slack each.
Nothing that carries meaning could give it back (the ring is the comp's, every label is at the type
floor, and the strip may not wrap — `--hc-panel-below` is measured against ONE row), so the width
came out of the separation, which carries no reading: gap and divider padding 12px → 8px, and the
readiness track becomes `auto` so the instrument sizes itself. 517 ≤ 533, 16px of slack. The guard
that replaced round 6's is now the **arithmetic** rather than the syntax — no track declaration is
safe on its own — and it fails on round 6's stylesheet with "each reading gets 83.5px but the widest
needs 89px".

**🔧 SELF-REVIEW ROUND 8 — FAIL, fixed, guarded.** Third time on the same collision, third
mechanism — and this one was my own measurement being wrong. Round 7 sized the readiness track
`auto` on the strength of a measured 85px label. But `auto` IS max-content, and that 85px was a
`scrollWidth` read inside a box round 6 had clamped to 60px, where the gauge's note line ("= 15 of 16
checks passed", a **translated** string) was wrapping. Released to max-content it runs ~187px
unwrapped, so the track took **253px, not 151** — a 102px miss — and starved the four readings
instead: AVG FPS and 1% LOW overflowed their own cells by 6.9–20.1px at ALL THREE sizes, smashing the
green MEASURED pills together. The reviewer caught it at 1920×1080 as well as 1280×720, so the fix
had made the room worse everywhere, not better. **A scrollWidth measured inside a clamped box is not
max-content**, and no hardcoded content width is trustworthy in a translated UI. So round 8 stops
estimating and pins the structure in both directions at once: the four readings are FLOORED at their
own content (`minmax(max-content, 1fr)`) so nothing can ever starve a reading, and the readiness
track is FLEX-sized (`minmax(0, 2fr)`) so no child of the gauge — note, unit or tag, in any language
— can widen it. The note wraps instead of pushing, which costs one line of height, reserved
conservatively in `--hc-panel-below` (238 → 256px) because over-reserving costs rig height while
under-reserving clips a reading. Guard rewritten again, now leftover-based and pinning both track
directions; it fails on round 7's stylesheet.

**🔧 SELF-REVIEW ROUND 9 — FAIL, fixed, guarded.** Fourth round on the same strip, and round
8's fix caused it: flooring the four readings at `max-content` released THEIR content, and the CPU
cell carries `.hc-read-none` — *"no CPU temp — see below"*, 161px, the owner-decided offer line
(#134/Q9c). That starved the readiness instrument to **26.4px at 1280×720** and 79.2px at the two
larger sizes, printing its label on top of AVG FPS at all three. The same round also measured the
strip below the stage at **264.78px against a 256px reserve** — `--hc-panel-below` wrong for the
fourth time (rounds 3, 5, 8, 9). **So round 9 stops patching the constant and deletes the class of
bug.** Two structural changes, no new number to keep in step: ① **the panel measures itself** —
`--hc-panel-below`, `--hc-stage-h` and `--hc-rig-h` are gone, `.hc-panel` is capped at
`calc(100vh − chrome − HUD band − slack)` (three FIXED-chrome terms, none of them text), the control
row and readout are `flex: none`, and the stage is the ONE shrinkable child, asking for the comp's
500px and giving ground to its 320px floor. A wrapped translation now just makes the strip taller and
the rig slightly shorter, which is the correct trade and needs no measurement. ② **no readout track
is content-sized in either direction** — every track is `minmax(<px floor>, <n>fr)` with the floor
derived from what CANNOT break (ring + gap + the one word "Readiness" = 150px; the mono value + its
hairline + pad = 85px); sentence-length strings wrap, which is now free. A never-clip net
(`overflow-y: auto` on the panel) turns the worst case into a scrollbar rather than round 3's silent
clip. Three guards rewritten and each proven to FAIL on round 8's stylesheet — *"expected
'minmax(0,2fr)repeat(4,minmax(max-cont…' not to contain 'max-content'"*.

**🔧 SELF-REVIEW ROUND 10 — FAIL, fixed, guarded.** Round 9's two structural bets came back
**clean**: the panel is not scrolling at any size (`scrollHeight == clientHeight`, 694/694), the rig
canvas is correctly sized at 578×460 by grid stretch alone, no readout cell overflows, and the strip
sits inside the lane's clip at all three sizes. 1500×980 and 1920×1080 match the comp. **1280×720
does not**: at an 85px column "GPU TEMP" and "CPU TEMP" wrap to two lines where "AVG FPS" and "1%
LOW" stay on one, so those two values sat **17px lower** than their neighbours' and the row of
numbers stopped being a row. Width cannot fix it — there is no width to give at 720p, and the next
translation wraps a different label — so this is the same "a number nobody re-measured" failure class
as rounds 3/5/8/9, one axis over. **The fix removes the dependency: the five cells now subgrid onto
ONE set of three rows** (label · value · attestation) owned by `.hc-readout`, so row 1 is as tall as
the tallest label and every value starts on the same line in any language, however many lines any one
label takes. A cosmetic 4px was also found for the two long labels (separator 8 → 6px, floor
85 → 88px); it is explicitly *not* what keeps the strip correct. Two guards — one deriving each
cell's row span from the strip's own track count so they cannot drift, one pinning the width budget
to `column-gap` — both proven to FAIL on round 9's stylesheet.

**✅ SELF-REVIEW ROUND 11 — PASS. Health (slice 2) is done.** Verbatim: *"round 10's subgrid fix
holds at all three sizes; item 1's headline check (all four `.hc-read-v` rects.top identical) is
proven native, not jsdom, and the diff introduces no regression elsewhere on Health."* The proof the
last ten rounds were reaching for: **all four value cells share one rect top at every size** —
588.875 ×4 at 1280×720, 698.15625 ×4 at 1500×980 and 1920×1080 — with
`getComputedStyle(.hc-read).gridTemplateRows` reporting live `subgrid` (no fallback), all four labels
on one line, `.hc-panel` never clipping (`scrollHeight == clientHeight` at all three), the canvas
sized 534×344 / 578×460 by grid stretch alone, no `@media`, and the honest `— —` +
"no CPU temp — see below" state intact. **One residual, accepted and documented, not fixed:** at
1280×720 the panel's bottom *padding* lands ~18px below the lane's clip while its last painted text
ends 12px above it — the lane scrolls, so that is a short border, not a lost reading. Growing
`--hc-chrome-top` to the verdict headline's height would "fix" it by re-introducing the exact
translated-content constant rounds 3/5/8/9 were spent removing, so it stays. The round-9 guard that
asserted the panel starts at 72px was asserting something untrue and has been corrected to say what
the cap really is: a ceiling against the lane's visible height, not a promise of fit.

**✅ SELF-REVIEW ROUND 12 — PASS. The shared instrument kit (slice 3) is done.** Health's readout
cell moved to `src/design/console/Reading.tsx` + `reading.css` so Live/History/Test can PLACE the
instrument instead of re-deriving it — and the claim under review was that nothing a user sees
changed. The reviewer was briefed to **disprove** that, not confirm it, and re-measured Health from
scratch at all three sizes: every number lands on round 11's baseline to the sub-pixel — four
`.rd-v` rect tops identical (588.875 ×4 / 698.15625 ×4), `gridTemplateRows` reporting live
`subgrid`, `.hc-panel` 596/596 and 694/694, rig canvas 534×344 / 578×460, `.hc-read-arc` 166.52 /
187.33px — with the honest `— —` + "no CPU temp — see below" state still carrying no MEASURED
pill. **The round is also a lesson in its own methodology:** its first pass reported a 9px shrink
everywhere — a naive `Get-Process` pick had resized the WebView2 host child while the real window
stayed minimized. The reviewer caught it, re-measured through the true `Tauri Window` HWND with
`GetClientRect == innerWidth/innerHeight`, and the "regression" evaporated. **A capture whose
target window was never verified is not evidence** — that check is now part of how this room gets
reviewed, not a one-off.

**✅ SELF-REVIEW ROUND 13 — PASS. The Live room (slice 4) is done.** Measured on the installed
build `67ce2724` at 1280×720, 1500×980 and 1920×1080 against `02-live-approved.png`, with the
build stamp re-confirmed live before every capture. The round did what no static check can: it
**started and stopped a real capture** — LED lit, headline switched to "Recording your session",
the door closed, Stop reverted cleanly — and then walked the overlay toggle, all four corner
positions, MIN/STD/FULL/BACKDROP, the tuning-presets disclosure and both directions of the segment
bar. Nothing that was in this room before is missing. Headline geometry: exactly ONE capture toggle
page-wide (the old control-row button MOVED, it was not copied), no horizontal overflow at
1280×720 (`scrollWidth == clientWidth == 1264`), the five-up sensor strip baseline-identical
across all five cells (label y=591, values y=615–641), Sessions' header computing
`flex-direction: column` at all three widths — the cascade defect caught by reading CSS rather
than the screen, confirmed fixed on the screen — and the missing CPU temperature holding
`rgb(122,131,151)` grey, never amber, never zero. **Both deviations from the comp were already
logged** (items 7–10 above) and the reviewer found no unlogged third — which is the check that
makes a substitution list worth keeping.

### ⭐ FOUNDATION-1. The consumer-app foundation proposal (2026-08-11) ✅ ALL FIVE BUILT (⑤ shipped to the desk 2026-08-20, awaiting the owner's eye): ① type + colour (TYPE-1 + COLOR-1, desk 2026-08-13, v0.9.22 `700cd565`, looked at and passed), ② front door (UX-1 — its last clause, the Home → **Health** rename, closed 2026-08-19), ③ **interview (2026-08-20, issue #177 — BUILT AND INSTALLED; owner tried it and said *"i like it"* 2026-08-20, so the default flips ON inside the comprehensibility sweep, which first fixes the button placement he objected to — see below)**, ④ wording pass + banned-term guard (C-06, `4c9e440e`, 2026-08-18). **⑤ instruments behind a door — SHIPPED 2026-08-20 (desk build `0808e33e`, self-review PASS 10/10); owner veto-on-sight still open**

> **③ BUILT, TESTED AND INSTALLED 2026-08-20 — and it is OFF until he says otherwise.** Turn it on
> at **Settings → Behavior → "Ask me a question on Home"**. With it on, Home's primary button reads
> *"Help me with my PC"* and opens a one-question-at-a-time interview in a Sheet
> (`src/surfaces/HomeInterview.tsx` + `home-interview-data.ts` + `home-interview.css`), ending on a
> finding card: level chip · one sentence · the measured evidence it is speaking from · one action ·
> the undo promise when that action changes Windows. The intake band is **deleted**, not disabled —
> rows, panel, flag, CSS and orphaned locale keys all removed, so his 2026-08-12 removal-on-sight
> stands.
>
> **Why OFF and not ON.** The first draft shipped it default ON and the self-review failed it on
> rubric item 10: `compy_home_intake` was his off-switch for that slot and he set it off twice —
> on sight (`4d1afa92`), then again when he caught UX-1 bypassing it (`8db70795`, *"off means the
> question is not asked"*). Retiring his key and defaulting the successor ON is the same bypass
> under a new name. New flag `compy_home_interview`, **default OFF, `"1"` opts in**, with the real
> Settings toggle the old key never had — undiscoverable was the defect, not off.
>
> **The cost of off, measured:** UX-1's "verdict + ONE action" front door has no action while the
> interview is off. Not new damage (the old flag was off too, and unreachable), but it is the
> argument for turning it on. Full fork + recommendation:
> [`docs/decisions/2026-08-20-home-interview-default.md`](decisions/2026-08-20-home-interview-default.md).
> Honesty is mechanised in `home-interview-data.test.ts` (four laws: no dead end · never claim
> unmeasured · evidence quoted never synthesised · a mutating action states its undo); the default
> is pinned by `home-interview-default-guard.test.ts`. **One word from him flips it.**

Owner escalated 2026-08-11: non-technical testers, incl. close friends, "do not enjoy using the app
— overwhelming, hard to navigate, completely unfamiliar." Asked for tooling + deep research on
intuitive layouts, shown to him, "so we can rebuild a foundation compy can atleast stand on."

Deliverable: `docs/decisions/2026-08-11-design-foundation.md` (research + rendered proposal;
artifact `claude.ai/code/artifact/4eeeac30-4b1a-4de8-bd8c-59260bd46155`). Thesis: the front door
must be a **verdict + one action**, not a dashboard; the intake band ("what are you here to do?")
is promoted to a TurboTax-style interview; instruments move behind a door. Build order: ① type +
colour app-wide (= TYPE-1 + COLOR-1) ② front door (= UX-1) ③ interview ④ wording pass with a banned-
term guard ⑤ instruments behind a door. **Room renames APPROVED by owner 2026-08-12** (Blackbook →
History, Lab → Test, Monitor → Live — all three; shipped as user-facing strings, Train 2 slice 1).
**⑤ SHIPPED 2026-08-20 (`lane/rail-door` → desk build `0808e33e`, self-review PASS 10/10 on the installed build — contrast 6.04:1 / 4.88:1 computed, all four rooms clickable with digits live, rail switch 17–23 ms):** the rail is no
longer four equal tabs — Health stands alone as the front door (full weight) and Live · History ·
Test sit under a "Look deeper" sign at a quieter weight (`railGroups` in `homeRail.ts`, rendered by
`ShellV2.tsx`, `.v2-nav-door` / `.v2-nav-instruments` in `shell-v2.css`). **Grouped, never hidden**
— the 2026-08-06 directive bars a hide-behind-a-toggle, so nothing collapses; every room keeps its
digit and its click. Guards: `homeRail.test.ts` §railGroups (door + instruments IS the rail, no
room dropped or reordered) and `ShellV2.test.tsx` §"front door plus a signed group". Taste call
mine per the 2026-08-07 decree; before/after handed over for veto on sight.

### FOUNDATION-1a. Bento grid + in-app popout, app-wide — ✅ SHIPPED (PR #117, 2026-08-12)

Owner ask 2026-08-11, verbatim: *"this is to be applied throughout every single possible location in
the app ... be sure you havent lost any current functionality or important features or finished items
behind in the process."* Answered by `src/design/bento/` (12-column grid + in-app `Sheet` popout) with
**all five console rooms converted and self-reviewed PASS** — Home, Monitor, History/Blackbook, Lab
(console + experiment bench), Settings. Conversion was **wrap-don't-rename**: every `.hc-*`/`.mc-*`/
`.bc-*`/`.lc-*`/`.set-*`/`.exp-*` class survives inside a tile, so each room's test file — and the
owner decisions and past bug→guard catches it encodes — stays intact.

**Deliberately excluded by form factor, not left undone:** Onboarding, FirstCheck and the Overlay are
single-column reading/reveal surfaces, not dashboards. Four flag-off failsafes (`HomeV2`, `HomeHud`,
`MonitorBasic`, classic `Play`) stay on old chrome on purpose. Guarded by `one-hero-guard.test.ts`
(four rules; the last two written from defects this conversion itself caused).

### ⭐ DIR-1. STANDING DIRECTIVE — organization · ease of access · inherently intuitive UI (owner, restated 2026-07-23; "made many times") 🔴 OPEN

**Owner verbatim (2026-07-23, updater-ship session):**

> we need to look way more in depth in how to consolidate and neatly compact everything without
> overcomplicating or sensory overloading anything throughout the UI we need to focus way more on
> organization and ease of access navigational implementations. intuitive UI capability should be
> way more inherintly comprehensive this is a very very very important note ive made many times.

**Standing meaning:** every UI train is judged FIRST on "can a non-technical gamer find it,
understand it, and act on it without being taught." Density and spectacle never outrank
orientation. This is the lens over every 🔴 item in this file, not a one-off ask. A train that
ships visuals but worsens wayfinding is a regression under this directive.

**Quick win shipped same-day:** default window 1280×720 centered + remember-last-size (v0.9.4,
through the live updater) — the 800×600 default crammed the whole HUD into a postage stamp and was
called out by testers.

**RESTATED 2026-08-06 — and it names the failure mode for the first time. Owner verbatim:**

> im still not satisfied with the layout of compy it just looks to intimidating rather than this
> intuitive easy to use and understand portal for everyone with a techy enthusiast catering flip side.

Two things here are new and must not be flattened back into the 2026-07-23 wording:
1. **The symptom is INTIMIDATION, not clutter.** "Neatly compact everything" could be read as
   density work; this cannot. The default face is reading as a control panel for someone who already
   knows what the controls do. Consolidation that leaves the first screen looking expert-operated
   does not satisfy this.
2. **He wants a two-audience shape** — a calm mainstream default with a *flip side* for the
   enthusiast. That flip side exists: expert view (`compy_expert_view`, 9 surfaces,
   presentation-only, gates zero mutation paths, spec
   `superpowers/specs/2026-07-11-expert-layer-middle-ground.md`, default OFF).
   ⛔ **BUT HIDING IS NOT THE TOOL — owner reversal, 2026-08-06.** Home was wired to the flip side
   that morning (1% low gauge, GPU temp gauge, the dense detected-hardware records, explode/orbit
   knobs) and the owner rejected it the same day, verbatim:
   > the expert view doesnt seemingly even need to be an option the information it displayed should
   > be standard my only worry with that was only if it was overbearing or caused to much congestion
   > aesthetically the better option is to integrate and structure the layout in a neat style that
   > avoided too m,uch text or paragrapgh style descriptions with better grouping and boxed templates

   **The standing rule this sets:** intimidation is a STRUCTURE defect, and the fix is grouping,
   boxed templates and fewer words — **never a switch.** Gating information is not calming a face,
   it is deleting the enthusiast half of the product from the default view. Expert view stays where
   it already earned its place (the nine surfaces above), but it is not a tool for answering "this
   looks congested."
   ✅ **HOME RESTRUCTURED 2026-08-06** — un-gated in full, then rebuilt as layout: live state on the
   rig's annotation planes (plain labels, no hover-to-expand callouts), the static detected record in
   four boxed templates below the stage (Graphics · Processor · Memory · Storage, label+value rows,
   zero prose). No number is owned twice; a record the machine did not report drops its whole box.
   Guarded by `home-console-standard-readout-guard.test.tsx` — which pins that flipping
   `compy_expert_view` changes NOTHING on Home, in both directions.
   ✅ **HISTORY RESTRUCTURED 2026-08-20** (desk build `8ba6a6d1`, self-review PASS 10/10) — screenshots of the
   installed build first: History measured worst of the four rooms (652 words, 34 boxes, 3.1 viewports deep, a
   15-row wall beside an 80%-hollow column, the timestamp under the title on every row). Layout, not a switch:
   the record is grouped by month, shows an 8-row screenful with an honest "show N older" press, the row
   cannot overlap, the undo door says what it does.
   ✅ **LIVE RESTRUCTURED 2026-08-20** (desk build `63db50d2`, self-review PASS 10/10 in round 2) — the deck's
   all-caps debrief string became a template (sentence · three boxed cells · one caveat) at 19 words against
   the 21 it replaced, guarded ≤ 21; both empty scopes name the next press under "no signal"; the readouts
   are a fixed 2×2. Layout, not a switch.
   ✅ **TEST RESTRUCTURED 2026-08-21** (desk build `584654c8`, self-review PASS) — the station dock says where to
   start ("Start here" over Optimize, one plain when-line under the row; opt-in `Dock` props, Home untouched);
   the safe-stack gauge reads "N on · = all N applied" on a full ring instead of "0 ready" on an empty one; the
   bench opener is "Test one change" + one sentence (25 words, was 44, guarded ≤ 30). Layout, not a switch.
   **All three rooms have had the pass.**
   ✅ **TEST READING SET BUILT 2026-08-21** (desk build `36011078`, self-review PASS) — the corner-gauge
   duplication is closed per [`superpowers/specs/2026-08-21-test-rig-reading-set.md`](superpowers/specs/2026-08-21-test-rig-reading-set.md):
   3 of Test's 4 corner gauges no longer repeat Health's (Readiness · Avg FPS · 1% low). The set is now
   Proven (get_scoreboard award count) · Noise floor (get_trial_state's noise_floor_pct) · Safe stack
   (unchanged) · Instruments read (stations with a live reading vs total) — bench facts, not machine
   facts, on two already-registered read-only commands, zero new backend. Stage tile retitled "Your rig"
   → "Your rig on the bench". PR pending against `main`.

**Read together with NAV-1 finding 2 below — but that suspect is now CLEARED.** The reading was that
parallel UI generations coexisting per room (Home 4+, Monitor 4, Lab 5) were the leading mechanical
cause of "intimidating". **That pruning pass RAN on 2026-08-06**: 29 unreachable files / ~2,578 lines
deleted (two Lab faces, three Optimize faces, `CompyHero`, `nav-flags.ts`, the `design/qpw`
components, `Gallery`, a second `Sparkline`, vendored `MagicBento`), recurrence mechanised by
`src/reachability-guard.test.ts` — see **P2** in `BACKLOG.md`. All four rooms have since had their
restructure pass (Home 2026-08-06 · History + Live 2026-08-20 · Test 2026-08-21), so the structural
suspects this row named are spent.

**What is actually left under DIR-1 is the JOURNEY, not the furniture** — and half of it shipped.
**The first-win action → rollback → proof journey landed 2026-08-26** as `FirstWin` on Home: a user
who has just made their first real change is shown the change by its plain-English name, presses
*Check my PC again* (Compy re-reads the machine and says whether it held), and presses *Put it back*
if they want it gone. Press to proof to undo, without being taught. It claims no speed result and
says so — the only honest proof at that moment is that the setting is really there.

**The first-timer walk ran 2026-08-26** — walk all four rooms as someone who has never seen Compy
and whose PC just froze — and produced six findings. Three shipped (`c7d9049e` room-scroll reset ·
Test station scroll-into-view · `31007819` the glossary on six bare "1% low"/"frametime" labels).
One (#4) was **partly wrong** and is the reason an audit is not a work order: two of the four Test
gauges already carried plain-English notes. Two were put to the owner because they collided with
decisions he had already made, and **he ruled on both the same day** — recorded below.

#### ⭐ DIR-1a. THE FRONT DOOR MAY NOT ASSUME SOMETHING IS WRONG (owner direction 2026-08-26) ✅ SHIPPED `b21bc18b`

His words, verbatim: *"i feel like offering help should only be an option if there an indicator that
something was detected from your pc that it would even inquire that ... also we have to remember
that compy also does performance optimization and there should perhaps be an option that doesnt
indicate there is an issue whaatsoever and just says something more relaxed like 'i want more fps'
because the home page options all seem to only point towards some sort of 'issue' which shouldnt be
the only rerason people are here in the first place also things like i want to monitor my fps or i
want to see my benchmark results or hardware capabilitiues stuff like that"*.

He was answering a narrower question (Health had two doors to one question) and **rejected both
options to say something larger**: the problem was not the duplication, it was that every door on
the screen was symptom-framed. Recorded here in full because a paraphrase of this would lose the
half that matters — *offering help is conditional on evidence*.

Shipped: the interview gained four goal answers (more FPS · watch my FPS · see my scores · what is
in my PC) and now groups its start screen into two labelled halves; Health chooses between the
halves on `somethingDetected` — a flagged readiness check or an incident the observer read out of
Windows. Guard `src/surfaces/home-console-front-door-gate.test.tsx`, falsified three ways.
**This directive is a STANDING lens, not a closed row:** any new Health affordance has to answer
"is this framing earned?" before it ships.

#### DIR-1b. A named problem must show a next step (owner ruling 2026-08-26) ✅ SHIPPED `b21bc18b`

#180 §C bars the flagged check's DETAIL PARAGRAPH from Health's header, which left the attention
state naming a problem with no way to act on it on screen. Offered the paragraph, the status quo, or
one short route line, **he chose the route line**. It fires the same `onSeeInFix` the Re-run band's
button fires and names that button's room from the same prop, so it cannot name a door the app does
not have. §C is untouched: the paragraph still does not render here.

**Still open under DIR-1:** the Consumer/Technical/Support evidence exports (P2's remaining item).

### PAL-1. The caption colour is too dim to read — ✅ SHIPPED 2026-08-11

Recommendation (a) landed as decided. `--v2-faint` `#626a80` → **`#7a8397`**: 4.65:1 on the lightest
v2 surface (`--v2-panel-2`), 4.94:1 on `--v2-bg`. Measured on the live installed build before and
after the token swap: **32 failing text nodes → 0**. The palette floor for `faint` was raised 3.0 →
4.5 in `tokens-v2-guard.test.ts`, and the 29-site ratchet was deleted — it existed only to freeze a
failing class that no longer exists, exactly the self-retirement its own comment described.

**The compression is real and is now the documented cost:** on a near-black ground three text tiers
cannot all clear AA at 9px, so `faint` sits close to `muted`. The tier below `muted` is carried by
SIZE and WEIGHT from here on, not by dimming further — which is what makes TYPE-1 below the
follow-on rather than a separate idea.

### TYPE-1. ✅ SHIPPED to the desk 2026-08-13 (v0.9.22 `700cd565`, on main `51956ed0`)

**What landed:** the six-step scale is `src/design/type-scale.css` — verdict 40/650 · section 26/650 ·
card 17/600 · body 15/400 · label 13/500 · data 13 mono — and **888 font-size declarations across 77
CSS files plus 29 inline `fontSize` props** now resolve to `var(--type-*)`. Floor is **13px**, above
the 11px this row originally proposed (superseded by the design-foundation decision); 8/9/10/10.5/11/
11.5/12/12.5px are gone. The five-families-on-one-screen drift collapsed to one UI face (Geist Sans
via `--font-ui`), which kills the **Arial fallthrough** that mis-drew the tour's ✓.
**Mechanized, not documented:** `src/design/type-scale-guard.test.ts` fails the build on any literal
font size, any `font:` shorthand smuggling one, any numeric inline `fontSize`, any token below the
floor, and on Arial's return. **The look caught what the tests could not:** at 13px a long unit word
overflowed the 56px arc-gauge ring ("100 SCORE", "246 FRAMES") — fixed in `64fe3579` with its own
guard in `arc-gauge.test.tsx`. Evidence: `compy-visual-review/v0922-{home,test}.png`.
**Nothing open from this row.** The mono-for-machine-values-only law stopped being a comment on
2026-08-18 (`3eca4a9f`, conformance C-17): [`../src/design/mono-law-guard.test.ts`](../src/design/mono-law-guard.test.ts)
resolves the whole `var()` alias graph to a fixed point, so `--font-mono` / `--ix-mono` / `--mc-mono`
cannot dodge it, and censuses every mono rule into `mono-census.baseline.json` with a **down-only**
violation ratchet. The debt was paid the next day (`be4c81ec`, C-17b): **203 rules, 140 machine
values, 63 accepted HUD chrome-tags, 0 violations, ceiling 0.** A new mono rule now fails the build
until someone classifies it. What it still cannot see is written in that file's own header, not
implied: it walks `.css` only, so an inline `style={{ fontFamily }}` is invisible to it.

<details><summary>Original measurement (2026-08-11) — kept for the record</summary>

### TYPE-1. A 12-size type scale is not a scale — and 57% of the app is ≤11px

**Measured 2026-08-11** on one live room: distinct font sizes in use = **8, 9, 10, 10.5, 11, 12,
12.5, 13, 13.5, 16, 19, 32px**. 47 of 83 text nodes are **11px or smaller**; exactly one element is
above 19px. There is no scale — there are twelve ad-hoc values.

**Plain English:** almost the whole app is set in fine print. The target user is a non-technical
gamer who is often further from the screen than a designer is from a laptop.

**Decision (mine, per the taste decree): collapse to a 6-step token scale and raise the floor to
11px — delete 8px and 9px outright.** Ships with a before/after. Also in scope: **five font families
render on one screen** (Geist Sans, Geist Mono, Segoe UI Variable Display, Cascadia Mono, **Arial**).
The Arial fallthrough is why the tour’s `✓` draws like a square-root sign.

**Related law with no guard:** `tokens-v2.css` states *"--v2-font-mono is for MACHINE VALUES ONLY —
never labels or prose"*. Live measurement found it on section labels throughout ("Patterns across
your sessions", "Changes to this PC", "The record", "Guides fact-checked" — all 9px mono uppercase).
The law is a comment; nothing enforces it. Mechanize it in the same train.

</details>

### COLOR-1. ✅ SHIPPED to the desk 2026-08-13 (v0.9.22 `700cd565`, on main `51956ed0`)

**What landed:** a **deletion**, as specified. `src/surfaces/room-identity.css` now carries zero live
rules and `ROOM_IDENTITY` maps every room to the one accent `#a78bfa`; Monitor teal `#3fd9c2`,
Blackbook amber `#f0b878` and Lab/Optimize emerald `#27e08a` are gone, so `ok`/`warn`/`info` are the
only elements allowed green, amber and blue. **The user's per-room accent picker survives untouched**
(owner freedom directive 2026-07-12b) — a deliberate pick is not a shipped default, and theme.ts's
injected pick rules still use the same same-element mechanism. `room-identity.test.ts` was rewritten
to pin the deletion (it used to pin the presets' existence). Confirmed by eye: Test renders violet,
not the emerald that read as "this is good" — `compy-visual-review/v0922-test.png`.

<details><summary>Original measurement (2026-08-11) — kept for the record</summary>

### COLOR-1. Room accents collide with the status palette

**Measured 2026-08-11.** `tokens-v2.css` states *"Status — color is information, never decoration"*,
and `src/surfaces/room-identity.css` breaks it: Lab `#27e08a` vs `--v2-ok: #3ddc97` (near-identical
green); Blackbook `#f0b878` vs `--v2-warn: #f5c542` (both amber).

**Plain English:** the whole Lab glows the same colour as "this is good", so green stops meaning
good in the one room built to prove things. The whole Blackbook glows the same colour as "warning" —
a room that exists to reassure reads as an alert, active tab pill included.

**Decision: rooms stop owning hue.** Identity moves to the glyph, the masthead eyebrow and one
hairline; `ok / warn / info` become the only elements allowed green, amber and blue. If tint must
stay, move room accents off the status hues entirely (violet · indigo · slate · rose).

</details>

### UX-1. The verdict is smaller than the word "Home", and the front door is a 10-step lecture ✅ CLOSED 2026-08-19 (all three decisions shipped; the room is now "Health")

**Measured 2026-08-11.** On the diagnostic screen `Home` renders at **32px** — the largest text in
the app — while the actual verdict *"You're ready to play"* sits beneath it at **24px**.

**Plain English:** the least informative word on the page is the biggest thing on it.

**Decisions:** ① the verdict becomes the H1; the room name shrinks into the eyebrow it already has
("RIG DIAGNOSTIC"), and the room is renamed to something that answers a question (Health /
Diagnosis). ② Drop the topbar taglines (`Blackbook · what actually works — measured` etc.) — that is
the project's own title-header law, and each room already repeats its name as an H1 90px below.
③ **First run lands on the diagnosis, not on the 10-step hardware tour** — Compy is where you go
after a crash, and the tour is also mislabelled (`GUIDED SETUP` on step 1, `HARDWARE TOUR` on
step 5). The tour becomes a card the user can choose.

**⚠️ SHIPPED, THEN PARTLY REGRESSED — owner caught it on his own desk 2026-08-18.** UX-1 shipped in
v0.9.24 (`f1766e86`) and was self-reviewed PASS. What it also did: it took the intake question the
owner had removed on sight six days earlier (2026-08-12, `4d1afa92` — *"the what are you here to do
text box was ugly looks cleaner without it"*) and made it the screen's single largest button, by
narrowing `compy_home_intake` to mean "pins the panel open" instead of "asks the question". His
off-switch read off the whole time. Repaired + guarded in `8db70795`; the self-review rubric grew
item 10 (prior owner decisions) because the rubric that passed UX-1 had no question that could have
caught this, and the `affordance-census` guard actively certified it — the census rewards KEEPING
affordances, and his decision was to remove one.

**✅ FRONT-DOOR RESTRUCTURE SHIPPED 2026-08-18** (same train, second commit). Decision ② is live: the
topbar prints the room name and nothing else, and a `ShellV2.test.tsx` case fails if a tagline grows
back. The check strip stopped being a bordered card with an uppercase `CHECKS` tag — it is one plain
sentence now ("All 16 checks look good" / "1 of 16 checks needs a look · Fix in Test →"), which also
closes audit §3's own jargon finding on `16/16 clean`. Home's Crash & Freeze row lost its 2px accent
side stripe, and `src/side-stripe-guard.test.ts` now fails the build on any new one.

**Bonus honesty fix found while rewriting that line:** the old `measured/total` ratio rendered
identically for "two checks FAILED" and "two checks could not be read at all". A user acts
differently on each. The sentence now says which — `2 of 4 checks look good · 2 couldn't be measured`
— and that is test-pinned in `RerunCheckBand.test.tsx`.

**✅ UX-1 IS NOW COMPLETE — decision ① third clause shipped 2026-08-19** (C-04, issue #143): the
front door is **Health**, the owner's pick over Checkup and Diagnosis. Id stays `home`; the label the
user reads lives in `common.rail.home` and is now pinned to the rail literal by
`src/design/rail-label-locale-guard.test.ts` — the rename proved that renaming `homeRail.ts` alone
ships the OLD word with the whole suite green. **Decision ③ shipped earlier, 2026-08-18** (C-05 +
C-19, `d76f753f`): first run lands on the diagnosis and the tour is a card with one name. The line
that used to sit here calling both "NEVER BUILT" was true when the conformance audit was written and
was already stale for ③ — corrected in place rather than left to be re-read as current. The intake question
stays OFF the Health room until the step-③ interview behind it exists; note the navigation audit §5 rates that
band the best navigation idea in the product, so it is a *deferral*, not a retirement, and it is
still reachable from Settings.

**Known side stripes left standing**, baselined in `src/side-stripe-guard.test.ts` rather than fixed
blind, because each needs a visual review of a surface this train did not open: `.detail-flag`
(`src/App.css`), `.cpu-temp-offer-how` (`src/surfaces/CpuTempOffer.css`), `.ss-detail`
(`src/surfaces/monitor-console.css`). Each is a one-line CSS deletion plus a self-review of that
room. Do not add to that baseline — fix the rule.

Full evidence, screenshots and the remaining copy/layout findings:
[`docs/decisions/2026-08-11-design-navigation-audit.md`](decisions/2026-08-11-design-navigation-audit.md).

### NAV-1. Navigation & consolidation audit (2026-07-23) — ✅ CLOSED 2026-08-24: findings 1–4 and forks (a)–(c) below all shipped; the lens lives on as DIR-1

**What real testers hit (2026-07-22 reviews, 0.9.0 build — the receipts for this audit):**
J: after a check you're dropped on the dashboard "feeling lost — where do I go to apply these?";
the "1 safe tweak not applied" verdict names a count but not the tweak; "Needs your call" cards
aren't clickable; per-room accents read as broken theming ("do I have to change every page?").
Matthew: the clearest orientation moment of the entire app is a COPY LINE ("the rail reads top to
bottom…") buried at the end of guided setup; Field Guide is explained in the wrong room; the
bottom expandable rows read like footer legalese.

**Structural findings (verified against src on `main` 2026-07-23):**

1. **The rail is clean (4 rooms: Home · Monitor · Blackbook · Lab) but the Lab is a mega-room** —
   six stations (Optimize · Diagnostics · Benchmark · Latency · Tuning · Blackbox), and it is the
   ONLY door to applying tweaks (ground merge, owner 2026-07-10). Post-check the app returns you
   to Home, one room AWAY from where the found tweaks live. Both J complaints (lost-after-check,
   invisible safe tweak) are this one seam: **the check's output and the fix's door live in
   different rooms with no hallway.** The fix class is a routed hand-off (check verdict → deep
   link into Lab→Optimize with the found items highlighted), not more UI.
   ✅ **SHIPPED 2026-08-06** (`f84ae7b5`, PR #79): every "see the fixes" route now goes through one
   writer, `openFixesInLab` in `App.tsx`, which persists the station intent BEFORE navigating, so a
   click lands on the Optimize station OPEN rather than the bare Lab dock. `RerunCheckBand` grew a
   quiet text link ("Fix them in Lab") that appears only when the check actually found something.
   Guarded by `src/surfaces/post-check-lab-route-guard.test.ts` (ordering + single-writer) and
   behaviourally in `home-console.test.tsx`. Self-review PASS.
2. **Parallel UI generations coexist behind flags** — Home has 4+ faces (HomeRoom/V2/Console/HUD),
   Monitor 4 (classic/V2/Basic/Console), Lab 5 (classic/V2/Bento/Console/Ground), plus legacy
   Check/Fix/Play/Learn surfaces still in-tree. One blessed face per room exists at runtime, but
   the generations cost: every new feature must pick a face (some land on one and not another),
   copy/affordances drift between faces, and "which app am I in" inconsistencies (J's theming
   complaint is partly this). **Candidate: a pruning pass — bless one face per room, delete or
   archive the rest** (mechanical once the owner blesses faces; big token/complexity payoff).
   Partial mitigation shipped 2026-08-04: `flag-default-drift-guard.test.ts` fails the build when a
   comment claims a default the flag's reader contradicts — nine had drifted, incl. MonitorV2 and
   BlackbookV2 still calling their LIVE console faces "DEFAULT OFF". Faces still multiply; they can
   no longer lie about which one ships.
   ✅ **PRUNE SHIPPED 2026-08-06** (`1ab831fb`, PR #78): one blessed face per room, 29 unreachable
   files / ~2,578 lines deleted. Remaining tail: the `compy_editorial="0"` intra-file classic
   branches in MonitorV2/BlackbookV2 (not separate faces — dead branches inside a live one).
3. **Orientation lives in copy, not chrome.** The room's purpose is a one-line crumb in the
   topbar; the strongest wayfinding line ships at the END of onboarding. **Candidates:**
   ~~surface the rail-reads-top-to-bottom framing at guided-setup START~~ ✅ **SHIPPED 2026-07-23**
   (`buildSetupSteps` injects the mode's rail line into `steps[0]`/`setup-rig` — `setup-steps.ts`;
   three guards in `setup-steps.test.ts`, incl. a byte-identical pin for the classic six-room
   escape hatch); ~~make each room's first screen answer "what do I do here" above the fold~~
   ✅ **ALREADY SATISFIED at live default flags (audited 2026-08-04)** — every room that CAN be
   empty answers in its own body rather than a header lede: Monitor's `SessionStack.tsx:251` renders
   "no sessions on record yet — play with capture on", Blackbook's `BlackbookConsole.tsx:339` renders
   "No record yet" + what Compy will log there. **Excluded, with reasons (no silent caps):** Home
   (`HomeConsole` always carries a verdict + primaryAction — never empty) · Lab (`LabGround`'s
   stations always render and it passes no `sub`; a lede would be invented copy) · Optimize
   (recommendations are always present on a fresh install) · `MonitorBasic` (dark failsafe face,
   reachable only at `compy_monitor_console=0`; `{latest && (` renders nothing when empty).
   **One sliver held as an owner copy call:** Blackbook's empty sub is *descriptive* where a
   *directive* line would be stronger. Recommendation — LEAVE IT: the owner iterated that room's
   copy twice (Phase 4 direction A + tester feedback), and the only directive available points at
   a sibling face, which edges into the "go to another tab" dead-end he banned;
   ~~give the quiet bottom rows real affordance weight~~ ✅ **SHIPPED 2026-08-04** (`7e55830`) —
   `.v2-quiet` was set in `--v2-faint`, the ink reserved for machine metadata, so the expander read
   fainter than the forward door the P6 law calls "a doorknob, not a CTA"; now door-parity
   `--v2-muted` ink + a NEUTRAL hover lift (never the door's accent) + one rotating caret.
   `quiet-affordance-guard.test.ts` pins the parity and the non-accent hover.
4. ~~**Already in flight elsewhere (do NOT duplicate):** an uncommitted CC-lane train (observed
   2026-07-22, `FirstCheck.tsx` + `guided.ts`)…~~ ✅ **LANDED 2026-07-23 (`46c4cd7`)** — that lane
   committed, so nothing is in flight and no reconciliation is owed. It shipped J's "show me the
   tweak + let me act" class: `FirstCheck.tsx:204` reveals the named tweak behind the "1 safe tweak
   not applied" verdict, and `guided.ts` carries per-item deep links (VBS/Defender →
   `ms-settings:windowsdefender`, VRR, HAGS → `ms-settings:display-advancedgraphics`) behind an
   explicit `startsWith("ms-settings:")` allowlist — Settings pages only, never an arbitrary URL.

**Taste forks the owner picked himself, pre-decree — status 2026-07-23b:**
(a) ✅ **RESOLVED + SHIPPED (v0.9.5, `67541e4`/`ac518f1`)** — owner picked "apply to all": per-room
accents stay (his 2026-07-12b feature), plus a one-shot "Apply to all rooms" action in the picker
popover (accent-tinted primary action above the muted reset; no mode, no hidden state; per-room
picking untouched). Live-proven on the owner's rig: all five rooms stamped in one tap, owner's own
duo picks restored after the test. Delivered to his box through the updater.
(b) Post-check landing — **✅ RESOLVED + SHIPPED 2026-07-23 (`46c4cd7`)**, owner having delegated
the call ("you decide whats seems most tasteful"). Built as his taste record pointed: J's own ask,
a "Take me to the Lab" CTA on the check verdict routing into Lab→Optimize **through the front door**
(navigation-never-teleports law) — `FirstCheck` fires `onGoToLab` → `App.tsx:1373` persists the
intent and `navHome('lab')` → `LabConsole` reads it on mount and auto-opens the Optimize station,
race-free and one-shot. Pinned by `src/surfaces/post-check-lab-route-guard.test.ts`. (The earlier
"BUILD HELD pending reconciliation with the CC-lane WIP" note is stale — that lane landed in the
same commit; see finding 4.)
(c) Blessed-face pruning — **delegated same message.** Direction: the newest shipped face per room
(the ones the owner has eyeballed and testers now use) is the bless candidate; the pass itself is
a CC-lane refactor train with full-suite verification, queued behind (b). **Blocker cleared
2026-08-04** — (b) shipped, so (c) is unblocked. First step was an inventory + disposition doc, NOT
an unattended deletion sweep: a face is only safe to delete once its flag is *graduated* (DEFAULT-ON,
nothing routes to the old branch). `LabGround`/`compy_lab_ground` is explicitly EXCLUDED — the Lab
overhaul is still in flight (BACKLOG Q0 `[~]`), and deleting a face mid-build is not pruning.
**✅ Inventory delivered 2026-08-04 → `docs/UI_FACE_INVENTORY.md`** — it deletes nothing; it is the
evidence a deletion would need. Headline correction to finding 2: the "parallel generations" are
mostly *nested chains*, not rivals (each newer shell imports the older surface as its renderer), so
Home, Monitor, Blackbook and the Lab each already have exactly one blessed shell. Only **Optimize**
has real rivals — three shells over the same `Check` + `Fix` parts — and its convergence belongs to
the Lab overhaul, not a cleanup sweep. Net actionable: one archivable pair (`CompyHero`), one
deletable file (`Optimize.tsx`, better folded into retiring the whole `Optimize` tab), two dead JSX
mount sites, and **one owner fork: `GpuProfile.tsx`** (346 lines, fully tested, zero non-test
importers — wire it in as advisory, or archive it).
**✅ (c) EXECUTED 2026-08-06 — 29 files deleted, ~2,578 lines.** Beyond the inventory's shortlist, a
reachability walk from `src/main.tsx` (static *and* `React.lazy` edges) found the whole retired stack
unreachable: `Lab.tsx` · `LabV2.tsx` · `LabBento.tsx` · `Optimize.tsx` · `OptimizeV2.tsx` + their CSS
and tests, `CompyHero`, `src/data/nav-flags.ts`, the `design/qpw` component layer (its *token* layer
stays — `ExperimentBench.css` cites it), `design/Gallery.tsx`, `design/console/Sparkline.tsx` and the
vendored `MagicBento`. `LabGround` untouched as directed. **The recurrence is now mechanised:**
`src/reachability-guard.test.ts` fails the build on any unreachable module, so a losing face dies with
its flag instead of lingering two redesigns. `GpuProfile.tsx` remains the owner fork (B_gpu), exempted
with a written reason rather than deleted. This is invisible in the UI by design — it is the
prerequisite that makes "change the Lab" an unambiguous instruction before the calm-default pass.

**Execution lane:** direction + audit = this file; the redesign build itself = CC/Fable lane per
the owner's standing preference (Cowork steers + audits, doesn't blueprint final creative).

### A0. Monitor console v3 — "up the ante" rework (owner, 2026-07-10, post-Phase-3 ship) — ✅ ALL 7 ITEMS BUILT (v5 owner-approved 2026-07-12; items 3–5 verified shipped 2026-08-04)

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
   corner picker on the console face, same audited commands, not forked. ✅ **Residual CLOSED
   2026-07-15:** density (Min/Std/Full) + backdrop chips folded into the console face's overlay
   row — same persist helpers Settings → Behavior already exposes (the config was never truly
   dead-ended; Settings has hosted both since the halfway-home re-home), overlay reacts via the
   cross-window `storage` event, zero new IPC.
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
   an internal accent mismatch under non-Violet themes; BACKLOG Cycle 2026-07-12g.**
   → ✅ **RESOLVED direction: owner picked "per-room identity" (2026-07-12)** — each room gets its OWN
   accent (Monitor = teal), so the SessionStack sparkline now matches the room chrome instead of clashing.
   Built behind `compy_room_identity` **DEFAULT OFF** (`72fa005`, installer `D23DE073…9EBA9`, stamp-verified)
   — **later flipped DEFAULT-ON 2026-07-13 (`18272be`, the default-ON graduation)** with the "(preview)"
   Settings row removed (owner: "everything was supposed to be default on to avoid the QA toggle
   section"); live check is `src/main.tsx:111` (`!== "0"`) + the flag comment at `src/design/room-identity.ts:7`.
   **Extended 2026-07-12 with a per-room color PICKER** (owner Cycle-12i follow-up "the freedom to shift
   around the colors they want on each page"): an accent dot in each room's top-right corner opens a curated
   swatch popover to recolor THAT room, persisted per-room (`20e2b50`). **Palette expanded to 20 then PRUNED
   to a differentiated 15 2026-07-13** (owner "more neon or bright/dark tone mixed" → "prune and widen
   variety more differentiation"): 9 bright + 6 dark tones *(then-state — superseded, see below)* with adaptive light ink so dark FILLS stay
   legible; CIEDE2000-verified differentiation (`8e6920f`, installer `51B0A754…3862F39A`, stamp-verified).
   **Palette reworked again 2026-07-16** (owner's favourites, duos grown to half the palette): the live
   `ROOM_ACCENT_SWATCHES` is now **8 bright singles + 7 duos, zero dark singles** — the dark-ink and
   dark-accent-as-TEXT legibility guards stay in `src/design/room-accents.test.tsx` and disclose in-test
   that the dark set is currently empty, so any future dark swatch is still held to the law.
   Owner one-flip eyeball ✅ **RESOLVED** — he called the palette finished 2026-07-13; §A9 archived to
   `docs/archive/OWNER_ACTION_HISTORY.md`, nothing left on him. ✅ **Follow-up SHIPPED:** the dark-accent-as-TEXT
   legibility train landed `cc9adb8` (dark-tone chrome ≥4.5:1 via legibility-adaptive accent-TEXT; live per
   `72ded53` doc-sync, installer `B7931E4E…`) — the FILLS-only gap is closed (BACKLOG Cycle 2026-07-12l).
3. **Graphs are a MUST + spike-moment indicators:** measurable finite detail required — the
   frametime graph must mark the EXACT moment of a latency spike (per-sample indicator, not just
   an average). This is a hard requirement for v3, not a nice-to-have.
   ✅ **BUILT** (verified 2026-08-04): `spikeIndices(win, budget)` in `src/design/console/Oscilloscope.tsx`
   flags every sample that is ≥2× the window median AND ≥ the frame budget; each draws an `.osc-spike`
   line at that sample's OWN x, the worst carrying an `.osc-spike-worst` class + a ms callout. Wired to
   the frametime scope via the `spikes` + `budget` props (`src/surfaces/monitor/DeckScope.tsx:121`), on a
   zero-anchored ms scale so smooth reads flat and spikes tower. Guard-pinned in
   `src/design/console/oscilloscope.test.tsx` — including "flat real data ⇒ zero markers, no callout
   (never a fabricated spike)", so the indicator can't invent a moment the data doesn't contain.
4. **Bug (fold into v3): frametime trace stops ~halfway across the grid** while the fps trace runs
   full length. Cause: `Oscilloscope` scales x to the fixed `cap` (240), but the backend window
   carries fewer samples at sub-240 fps → partial width. v3: scale to the drawn window so the
   trace always spans the grid.
   ✅ **FIXED** (verified 2026-08-04): the full-width law is live at `src/design/console/Oscilloscope.tsx:123`
   — x divides by `win.length - 1`, never `cap`, so a sub-cap window still reaches the right edge.
   Guard-pinned at `src/design/console/oscilloscope.test.tsx:67` ("a window smaller than cap still spans
   the full grid width"), a test that names this bug by date so the regression can't come back quietly.
5. **3D / parallax telemetry is BACK ON THE TABLE (direction amendment):** the "NO hologram / NO
   parallax" line in the Monitor concept (direction spec 2026-07-09, Monitor row + Phase-3 plan)
   is NOT a standing ban. Owner: the 3D/parallax layer is what's felt most appealing and on-par
   with the direction — don't rule it out "unless reasonably so" (a stated, specific reason).
   Fold this amendment into the direction spec with the v3 train.
   ✅ **FOLDED IN** (verified 2026-08-04): the amendment is carried verbatim at
   `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md:163`, with the one retained rail —
   depth may move the panel/chrome UNIFORMLY, never warp the data ink; a spike's plotted position stays
   truthful. The spec's anti-pattern column was updated to match (differential parallax BETWEEN plot
   layers is still barred; uniform stage depth + honest 3D data geometry are IN).
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
   (`drei OrbitControls` damping) instead — principle 6 of the **Instrument Bench** proposal
   (`docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md`, which the owner then
   REJECTED as the Lab that same day — the live Lab is the Ops Console, and that doc now survives
   only as the record of this redirect).
   **ASKED AND ANSWERED — the owner said "no" on 2026-08-25.** The one question this row still held
   open was whether he wanted a panoramic drag surface back in the *type/level of effect* sense he
   meant in July (not the sister-site clone). He answered no, against a recommendation of no. This
   is settled, not parked: nothing here is to be re-queued, re-proposed or revived from a paraphrase.
   The drag/inertia feel keeps living on the rig hologram. Recorded from
   `docs/OWNER_ACTION_CHECKLIST.md` B5.1.
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
   gauge tick is the honest A.2 vehicle; ~~owner may overrule at eyeball~~ → **owner RATIFIED
   2026-07-14** after evidence review (0 GL draws in 15s idle re-proven live,
   `docs/ui-sweep/shots/deviation-hologram-idle.png`). Deviation STANDS; future option if he ever
   wants shader energy: change-triggered pulse (flash on real value change, then sleep).
3. **Magnetic cursor + mouse-tilt parallax** — only a small event-parallax on Home's annotation
   plane shipped. Magnetic cursor: ~~NEVER BUILT~~ → **🟢 BUILT `1d310e1`:** delegated MagneticLayer
   (GSAP quickTo, ≤4px pull, expo-out release, coarse-pointer skip) on the rail room tabs; the Dock
   is deliberately NOT magnetic (it owns the magnify lift — one motion idea per element) — **owner
   RATIFIED 2026-07-14** after evidence review (8px lift + 4px clamp both captured live,
   `docs/ui-sweep/shots/deviation-dock-hover.png` / `deviation-rail-magnetic.png`). Plus the
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
Full spec: `docs/superpowers/specs/2026-07-08-lab-proving-ground.md` — **its §2/§3/§8 UI direction was
SUPERSEDED on 2026-07-09** (the Lab shipped as the Ops Console instead); §0, Directive 1, §2a and §5–§7
still stand as written. Mutation scope: builds on the safe
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
f16d158). **Still OPEN:** Phase 4 (catalog-expansion pipeline — a SEPARATE gated track, per-tweak mutation-gate);
~~the slice-1 Optimize-rail TAB removal + full rail collapse (**deferred, owner call — the standalone Optimize tab
still coexists with Lab station 1 during preview; this is the ONE open eyeball decision**)~~ → ✅ **DECIDED + SHIPPED
2026-07-10 (`59249bb`)** — the owner's round-4 "ALL GOOD" cleared it: the standalone Optimize tab is gone, "the Lab's
Optimize station is the one door", the ground rail is Home · Monitor · Blackbook · Lab (`src/design/homeRail.ts:36`)
— **those four rooms are labeled Health · Live · History · Test since the owner's 2026-08-12 and 2026-08-19 renames;
the ids, the structure and every decision in this section are unchanged, only the words on the buttons** —
and `compy_lab_ground="0"` still restores the classic rail/tabs/rooms live. **Still NOT built from §A (this
marathon only realized A.1's gallery):** ~~the rest of the JARVIS motion stack — GSAP data-reactivity (A.2), magnetic
cursor (A.3), Lenis smooth-scroll spine (A.5), room-transition wipe (A.6) — remain 🔴 OPEN~~ → **built 2026-07-12
(`1d310e1`, flag `compy_jarvis_motion` DEFAULT OFF — see §A above).**
~~⏳ Owner eyeball: flip Settings → Appearance → "Lab proving ground (preview)", open Lab … React + confirm the
deferred Optimize-tab call before it flips default-ON.~~ → ✅ **DONE — nothing to flip any more** (verified
2026-08-04): `compy_lab_ground` is DEFAULT ON (`src/design/theme.ts:273`, `!== "0"`) and the Settings row was
retired with the flag — `setLabGround` has zero callers left, so that instruction pointed at a toggle that no
longer exists. The Lab opens on station 1 (enable-all + Power features) by default; devtools `"0"` is the failsafe.

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

**~~Still 🔴 OPEN after Ops Console Phase 1~~ → ✅ CLOSED — this block resolves itself below ("the per-tab Console
rollout list is CLOSED — every phase is live"); the 🔴 is kept struck, not deleted, so the history reads straight:**
Phases 2–4 = the per-tab Console rollout (Home cold-open · Monitor gauges + a
real `Oscilloscope` kit bound to live telemetry · History/Black Box flight-recorder log · Gaming Mode arm/engage console ·
Settings quiet chrome · then the app-wide viewport HUD frame + global reticle). **→ 2026-07-15 batch closes three of
these:** Gaming Mode arm/engage console (`compy_gaming_console` DEFAULT ON, `"0"` classic failsafe — status strip + armed
contract + ONE staged engage control, presentation-only over the same audited session commands) · Settings quiet chrome
(CSS-only console register) · the app-wide viewport HUD frame + global reticle (`compy_hud_frame` DEFAULT ON — corner
brackets, honest rig·clock readout, shell-scoped reticle with stage instances self-deferring). Self-reviewer round 1
caught 3 real defects (readout duplicating ledger/stamp · readout vs bottom content collision · explainer lede breaking
the title-header law) — fixed + guard-pinned. ~~Remaining 🔴 from this list: Monitor gauges + `Oscilloscope` kit ·
History/Black Box flight-recorder log.~~ → **🟢 both were ALREADY SHIPPED when this line was written (stale-list fix
2026-07-16):** Monitor gauges + the real `Oscilloscope` kit on live telemetry = MonitorConsole v5 Flight Deck
(`compy_monitor_console` DEFAULT ON since 2026-07-12 — DeckScope frametime hero + fps trace + 4 honest ArcGauges over
the same audited 1 Hz polls) · the flight-recorder log = the Blackbook Logbook (`compy_blackbook_console` DEFAULT ON
since 2026-07-13). **The per-tab Console rollout list is CLOSED — every phase is live.** Still folds in the remaining §A JARVIS stack
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

**🟢 PHASE 4 (Blackbook console) — BUILT + SHIPPED behind flag `617db5b` (2026-07-12, installer `43234A53…943D5`, stamp-verified); ~~owner eyeball is the open gate~~ → ✅ CLEARED — flipped DEFAULT-ON 2026-07-13 (`18272be`).**
Committed `617db5b` (`feat(blackbook): Console Phase 4 Logbook behind compy_blackbook_console DEFAULT OFF`),
silent-reinstalled + stamp-verified live. The Logbook face renders behind `compy_blackbook_console` (DEFAULT
OFF; Settings → Appearance → "Blackbook console (preview)"): a hairline flight-recorder tape of your
changes/sessions/guide-checks synthesized by the pure `buildLogbook` over EXISTING data (zero new IPC/`src-tauri`),
field guide reachable via a Logbook|Field-guide toggle, `"0"`/absent = today's Learn library byte-identical. Pure
READ view — an active change routes to the Lab (the one undo home), zero mutations. tsc 0 · vitest 1560/175 ·
self-reviewer round-2 PASS. ~~**Open:** owner one-flip eyeball → default-ON or iterate (same pattern as
Home/Monitor/JARVIS).~~ → ✅ **FLIPPED DEFAULT-ON 2026-07-13 (`18272be`)** in the graduation batch (owner:
"everything was supposed to be default on to avoid the QA toggle section") — the "(preview)" Settings row
is gone, `src/design/theme.ts:578` reads `!== "0"`, devtools `"0"` remains the classic failsafe.
One known follow-up folded into the shared accent-lock decision (room `.bc-*` chrome locks to `#a78bfa`
under Crimson via the systemic `--ix-accent → --v2-accent` re-point; identical on Monitor/Lab, 0 vendor-purple).
→ ✅ **RESOLVED direction (owner 2026-07-12): "per-room identity"** — Blackbook = amber, built behind
`compy_room_identity` **DEFAULT OFF** (`72fa005`) → **DEFAULT-ON 2026-07-13 (`18272be`)**; the owner
one-flip eyeball is ✅ **RESOLVED** — he called the palette finished, and OWNER_ACTION_CHECKLIST §A9 is
archived to `docs/archive/OWNER_ACTION_HISTORY.md` (nothing left on him).

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

### D. CommandPalette / keyboard-first command flow — ✅ SHIPPED DEFAULT ON (2026-08-11, `22fb15b2`, PR [#99](https://github.com/Pootytxng/sentinel/pull/99))
From the product-UI-system brief (Linear/Raycast discipline). **The owner unparked it 2026-08-11** —
a tester could not navigate the app and he named that *"honestly my biggest gripe"* — and it shipped:
`src/design/CommandPalette.tsx`, the topbar *"Search or jump anywhere · Ctrl K"* box plus a
Ctrl+K / Cmd+K overlay that searches every destination at once (rooms, Lab instruments, Settings, and
the whole Blackbook corpus). Mounted at `src/design/ShellV2.tsx:334` behind `compy_command_palette`,
**DEFAULT ON** — a discoverability surface that is off by default fixes nothing for the only people it
exists for. `"0"` is the devtools failsafe: no topbar box, no Ctrl+K, shell byte-identical to the
pre-palette tree. **Navigation never teleports** (P6 law): every action calls the same writer the rest
of the app already uses, so the palette adds a door, never a second hallway.
Guards: `src/design/command-palette.test.tsx` · `command-palette-flag.test.tsx` ·
`command-palette-data.test.ts` · `shipped-feature-doc-truth.test.ts` (which keeps this row honest).

<!-- shipped-status-history -->
**Why this row read the opposite for six weeks (closed 2026-08-19 as backlog C-12).** It was parked in
2026-07 as *"new feature, backlog candidate post-P6, owner call"*
(`docs/superpowers/specs/2026-07-02-design-direction-product-ui-system.md:36,54,83`) and this section
said *"parked, then dropped — never mentioned again anywhere."* That was true when written and false
from 2026-08-11 on, and nothing checked it; `docs/CONFORMANCE_AUDIT_2026-08-18.md` §C-12 caught it by
hand. This is the inverse of the usual rot — a **shipped** feature recorded as **dropped**, which
costs more than a stale TODO: the next reader re-proposes something that already exists.

### E. Trending design tooling (Figma / v0-Vercel MCPs) — substituted, awaiting owner's call
De-slop directive point #6 asked for these applied wherever the UI reads as AI-slop-default. They
spend owner-gated credits, so pilots were built in-repo instead. Partially honored via the reactbits/
shadcn registry (Stepper + Lab bento). **Owner decision:** want the real tooling used, or leave it a
deliberate no? Source: `docs/OWNER_ACTION_CHECKLIST.md:59-61`, `docs/BACKLOG.md:53`.

### F. Upgrade-path engine — real feature, still a stub
Owner (2026-07-03): *"just slapping an Amazon + Newegg link for GPUs isn't the feature."* The advisory
upgrade path is underdeveloped. Flagged as never fully built.
Source: `docs/superpowers/specs/2026-07-03-owner-optimize-feedback.md`, `docs/OWNER_ACTION_CHECKLIST.md` §B4.
Not to be conflated with **"Optimization Cleanup"** (BACKLOG Phase B, panel-review brief 2026-07-15
§4.1) — that one finds/classifies residue OTHER tools left behind; this one advises hardware upgrades.
Different features, different lanes.
**→ 🧠 SUBSUMED by Intelligence Phase 5 (2026-07-17, intelligence directive §9):** the upgrade-path
engine ships as evidence-based **Upgrade Advisor 2.0** ("buy nothing" verdict · technical
prescription contract · consumer/shop report exports) in the intelligence lane — see BACKLOG's
🧠 INTELLIGENCE PLATFORM LANE. One lane, not two; don't build a separate advisory here.

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

**G.1 🟢 BUILT (2026-07-15, its own train per the queue note) — scroll-scrubbed telemetry
throughline (Design Director change #5, council 2026-07-15).** Owner green-lit ("proceed with the
conclusions"); built as its own storyboard → build → self-review train, exactly as queued. What
shipped: the `.record` replay deck's ▶ button replay is retired — with JS + motion allowed the
section becomes a 240vh runway, the deck sticky-pins, and page scroll scrubs the REAL 3:00:05
Diablo IV session bidirectionally (new event-timeline canvas: 51 real events at true timestamps +
hour graticule + playhead; session clock; ~1Hz sample counter 0→10,776; events-passed n/51; event
feed; progress track), landing on the measured results as the deck unpins. Director seat-6 sat on
the built result: **SHIP-WITH-CHANGES**, both named fixes applied same train — (1) density-weighted
transport (all 51 events live in the session's first ~38%, so the linear map idled for ~60% of the
runway; `timeOf()` now spends 85% of scroll on the event-dense span and fast-forwards the quiet
tail — transport speed only, every reading stays true to the record) and (2) the three new scrub
strings + canvas hour labels bumped `--fg-faint` → `--fg-dim`. Honesty boundary held:
that record has NO per-second fps series (guard-enforced), so nothing per-frame is animated and the
hero's Marvel Rivals series was NOT reused. Reduced-motion/no-JS keep the finished static summary
with zero dead runway (guard pins added to `scripts/site-landing.test.mjs`). Restraint call: the
deck scrub is the ONLY new scrolled motion — no page-wide scatter. Self-review ran 4 rounds to
PASS (rounds 2–3 caught a live→results swap-height jump at desktop then mobile; `.rhud-swap`
min-height now 276px base / 364px ≤720px, verified flat through the swap at 1500×980 AND 390×844).
(PRE-PUBLISH at the time of writing — superseded by
G.2 below, which records the deploy GO. The scroll feel was called in-lane and shipped; under the
2026-08-07 taste decree it was never an owner gate.)

**G.2 🟢 SHIPPED + DEPLOYED (2026-07-15) — site completion: SEO/launch plumbing + `/compare`.**
The owner granted the **deploy GO** ("deploy go looks good for now… go about doing the full completion
of the site… so we can prepare to launch compy") — **so the site is no longer PRE-PUBLISH; it deploys
autonomously now.** Completed + live on `compy-bd6.pages.dev`: canonical URL scheme app-wide,
`robots.txt` + `sitemap.xml` (196 URLs, no fabricated freshness), favicons, static `404`, honest
JSON-LD (no fabricated ratings), and the **new `/compare` page** (Design Director spec, six-seat
council — five construction-practice axes, never names a competitor, never invents a number, admits
every tradeoff). Guards 40/40, self-review PASS (`adae2dc1b4d75fff8`), deploy `d8a40fc5` apex-verified.
**Remaining OPEN visual/site work** (owner's calls): the **mini playable demo** of one real Compy tool
(§G original requirements) is still unbuilt; `/pricing` + `llms.txt` are open P2 candidates; P3
walkthrough/tour videos stay owner-flagged LATER. **Launch gate now owner-only:** the `compy.gg`
domain purchase (every canonical/sitemap/JSON-LD URL already points at it).

### H. ~~Onboarding HoloLens Setup & Tour redesign~~ — ✅ SHIPPED (verified 2026-07-08)
The hardware-tour flies the camera across the user's REAL rig in the owner's order — `HARDWARE_LESSONS`
literally ordered psu→storage→gpu→cpu→ram (`setup-steps.ts:103`), parts from `buildRigParts(hw)` real
hardware, `TourCamera` lerps per `focusId` (`HardwareTourScene.tsx:131`), re-runnable from both Home
surfaces via `compy:start-tour` (`SetupLauncherCard.tsx`, `App.tsx:558`). Not open work.

### I. Gaming recovery banner → bottom-right toast — ✅ SHIPPED (2026-07-14, same-day as the ask)

Owner (2026-07-14, at Gaming Mode QA sign-off): *"im not a fan of the pop up alert bar at the top of
compy … id rather it was like a little popup window down at the bottom right similar to like a clippy
speech bubble alert or just something out of the way that you can easily restore or dismiss."* Built
verbatim: the global crash-recovery prompt + both success confirmations moved from full-width top bars
into a fixed bottom-right `.gaming-toast-stack` (App.tsx/App.css) with a × dismiss (this-run-only —
never clears the recovery; never-hide law intact), Resume primary, slide-in gated on
`data-motion="reduced"`. Self-reviewer PASS (sr-gaming-toast-*.png). Design call made in-lane: the
literal speech-bubble *tail* was read as an analogy and deliberately not built — a tail pins the toast
to a source element it does not have. One-word revert if the owner wants the point.

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
  his hands or his eyes) cross-link it in `docs/OWNER_ACTION_CHECKLIST.md`. **An aesthetic call alone is
  not a reason to cross-link** — decide it, ship it, show a before/after.
- **Substitutions:** if you ship a simpler thing than the owner asked, it is NOT done — log it here as a
  substitution needing his sign-off, never silently close it.
