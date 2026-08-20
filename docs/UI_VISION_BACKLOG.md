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

### ⭐ FOUNDATION-1. The consumer-app foundation proposal (2026-08-11) 🟡 IN PROGRESS — **three of five are DONE**: ① type + colour (TYPE-1 + COLOR-1, desk 2026-08-13, v0.9.22 `700cd565`, looked at and passed), ② front door (UX-1 — its last clause, the Home → **Health** rename, closed 2026-08-19), ④ wording pass + banned-term guard (C-06, `4c9e440e`, 2026-08-18). **③ interview and ⑤ instruments behind a door remain OPEN**

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

### ⭐ STANDING DIRECTIVE — organization · ease of access · inherently intuitive UI (owner, restated 2026-07-23; "made many times") 🔴 OPEN

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
   `compy_expert_view` changes NOTHING on Home, in both directions. **Home only — the other rooms'
   default faces have not had this pass, and they get the layout treatment, not the switch.**

**Read together with NAV-1 finding 2 below:** parallel UI generations coexist per room (Home 4+,
Monitor 4, Lab 5) and the pruning pass has never run. That is the leading mechanical suspect for
"intimidating" — surfaces authored under different design generations, all reachable, none blessed.
It is also the same work as **P2 "reversible generation pruning"** in `BACKLOG.md`, which is why the
backend runway and this ask meet at the same next train.

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
**Still open from this row:** the mono-for-machine-values-only law is still a comment with no guard.

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

### COLOR-1. Room accents collide with the status palette 🔴 OPEN

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

### NAV-1. Navigation & consolidation audit (2026-07-23) — findings + candidates awaiting owner direction 🔴 OPEN

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
f16d158). **Still OPEN:** Phase 4 (catalog-expansion pipeline — a SEPARATE gated track, per-tweak mutation-gate);
~~the slice-1 Optimize-rail TAB removal + full rail collapse (**deferred, owner call — the standalone Optimize tab
still coexists with Lab station 1 during preview; this is the ONE open eyeball decision**)~~ → ✅ **DECIDED + SHIPPED
2026-07-10 (`59249bb`)** — the owner's round-4 "ALL GOOD" cleared it: the standalone Optimize tab is gone, "the Lab's
Optimize station is the one door", the ground rail is Home · Monitor · Blackbook · Lab (`src/design/homeRail.ts:36`),
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
