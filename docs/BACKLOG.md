# Compy — Living Backlog Ledger

> **Why this file exists.** Persistent workflows (`/loop`, `/schedule`) kept declaring "genuinely
> finished, standing by for verification" while real product work remained. Root cause: there was no
> *machine-readable* checklist — completed work lived in CLAUDE.md victory-lap banners and scattered
> `*.REPORT.md` prose, so a waking session read "X landed, all green," found no open thread, and
> stopped. **This file is the canonical open/closed ledger.** Source of *priority* = the roadmap
> (`docs/superpowers/plans/2026-06-21-roadmap-sequencing.md`, Cowork's strategy lane). This file only
> tracks *status*, verified against code on `main` — not against banners.
>
> **Status anchored to `main` @ `47e93e6` (2026-06-23 audit).** Verified by a 5-agent read-only sweep of
> the actual source tree, not commit messages.

---

## 🎯 CURRENT PROGRAM CUTLINE — PRODUCT QUALITY STABILIZATION (owner request 2026-07-29)

> **This section wins on current product priority.** Full sequencing, dependencies, acceptance,
> conflict resolutions, and defer/reject rules:
> `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md`.
> Live execution and claims remain in [Kuya Work Control](WORK_CONTROL.md); gate/release truth remains
> in [RELEASE_STATE.md](RELEASE_STATE.md). Historical priority sections below remain evidence, not the
> current pull order.

### ▶ NEXT UP — the ONE linear queue (RE-RANKED 2026-08-21 from a full-project overview)

> **Re-ranked, not re-listed.** The previous queue had nine numbered items of which **five were
> finished records** — C-13(b) discharged, #171 fixed and landed via PR #184, #126's proof half,
> #156's gates, #128's merge. Closed work reads as a full queue and hides how thin the live one is;
> the five moved verbatim to [`BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md). What was left was six items
> of **repo hygiene and not one thing a user of the app ever sees** — while the owner's own bug
> report sat in no queue at all. Ranked below by **who is waiting**, not by what is nearest to hand.
> **Take the top unblocked item.** Owner items are named once, with a pointer —
> [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) stays their home.

#### ① A PERSON REPORTED IT AND WE HAVE NOT ANSWERED — these outrank everything

1. **STOP THE AMBIENT BACKDROP ANIMATING — it is ~88% of Compy's idle CPU.** *Why it matters:* the
   app burns about a fifth of a CPU core doing nothing, forever, to slide a background gradient 3%
   sideways behind a window nobody is looking at; that is the single biggest cheap win in the app and
   it never stops, focused or not. `body::before`'s `aurora` keyframe in [`../src/App.css`](../src/App.css):
   freezing that one animation and nothing else took idle 22.392% → **2.067%** of a core on the
   installed build. Do it, re-measure with `node scripts/q7-probe.mjs idle-bare`, then **ratchet
   `idleCpuPercentOfOneCore` in [`perf/q7-baseline.json`](perf/q7-baseline.json) down hard** — 26 is
   loose enough to hide the entire cost. It is a look change, so it needs a `self-review` PASS on an
   installed build and a before/after to the owner; under the 2026-08-07 taste decree it ships as a
   decision with a veto attached, not as a question.
   **The owner's "runs a lot slower than before" is ANSWERED as of 2026-08-21 — do not re-run it.**
   [`RELEASE_STATE.md`](RELEASE_STATE.md) §"Required owner decisions" carries the numbers. Short
   version: there is **no regression** — idle CPU 20.853% of a core vs 23.348% recorded, cold start
   3112 ms vs 3721 ms, working set 579 MB vs 606 MB, all better than baseline and inside budget. The
   **Geist font + 14→15px bump is NOT the cause** (two settled runs, same binary, same room, 1.21
   points apart against baselines that spread 1.352 and 0.932 — noise). The aurora cost above is real
   but is not new; it was believed fixed by #127 on two runs whose baselines never settled, which is
   why [`../src/perf-evidence-integrity-guard.test.ts`](../src/perf-evidence-integrity-guard.test.ts)
   now exists.
2. **`compy.gg` tells the world Compy is free, and that is live right now.** *Why it matters:* the
   site contradicts the owner's own 2026-07-21 monetization decree on the public internet, and every
   day it stands is a pricing expectation being set that money later has to fight. `site/llms.txt:5`
   reads *"Compy is a free desktop app"*; the corrected line already exists, unlanded, on
   `claude/review-consolidation-structure-9d13f2`. **Owner-gated twice** (price *wording* is brand +
   money; `site/**` auto-deploys to other people's machines) →
   [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) §B6. **What is mine:** land the per-file
   fix as a PR with the wording drafted, so his part is one word, yes or no.

#### ② SPECCED OR DECIDED, READY TO BUILD — cheap, visible, no owner dependency

3. **Merge PR [#191](https://github.com/Pootytxng/sentinel/pull/191)** (MERGEABLE), then flip the
   `lane/rig-then-rails` row in [`BRANCH_DISPOSITIONS.md`](BRANCH_DISPOSITIONS.md) `UNLANDED` →
   `MERGED` and prune the ref **in the same commit** — that row commits to it.
4. **Build the Test room's "Your rig" reading set** →
   [`superpowers/specs/2026-08-21-test-rig-reading-set.md`](superpowers/specs/2026-08-21-test-rig-reading-set.md).
   *Why it matters:* the last open item from the three-room intimidation pass — "Your rig" currently
   repeats Health's numbers, so the Test room's own panel tells the user nothing new. Data wiring,
   not a layout move. Needs a `self-review` PASS on an installed build before it counts.
5. **COLOR-1 · room accents collide with the status palette** —
   [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md) 🔴 OPEN. *Why it matters:* the Lab glows the
   same green as "this is good", so green stops meaning good in the one room built to prove things;
   Blackbook glows warning-amber while existing to reassure. **Decision already recorded — rooms
   stop owning hue** (identity moves to glyph, eyebrow, one hairline). This is a taste call, which the
   2026-08-07 decree makes **mine to ship and his to veto on sight** — build it, hand him a
   before/after, do not park it on him.

#### ③ REPO HYGIENE — real, but nobody is waiting on it

6. **#125 steps 1–3** (split the code set as data · build `compy-entry adopt` · build the
   write hook and test it as a module) →
   [`superpowers/specs/2026-08-21-unverified-session-write-refusal.md`](superpowers/specs/2026-08-21-unverified-session-write-refusal.md).
   None of the three needs an owner decision; **step 4, arming it, is his one line** and is
   deliberately NOT in his checklist until 1–3 exist, because a non-ask there buries the real ones.
7. **#121 · `launch-focus-guard` RUNTIME tier is intermittent, NOT root-caused** — the same
   class as #171 was, and #171 proves the class is solvable. Detail on the open row further down.
8. **#156's unnamed lock holder and #128's unheld locks both discharge on the NEXT REAL SHIP, not on
   their own.** #156's gates close the suspected path but the flake was never reproduced, so the
   *holder* is still unnamed; #128's two mutexes have never been held during an actual release or
   ship. Neither is a task to schedule — both are **evidence to collect the next time a ship runs**,
   so whoever runs that ship owes both issues a comment. Records archived; residuals live here.
9. **C-14 · `GpuProfile.tsx` — wire in as advisory, or archive it** (row below; owner fork B_gpu).
10. **Extend the Codex weekly automation to product-conformance scope, writing INTO the repo** (row
   below). Delegated to the Codex lane — do not duplicate it here.

**BLOCKED — another lane owns these; `WORK_CONTROL.md` says hands off, not adjudicate:**
PR [#160](https://github.com/Pootytxng/sentinel/pull/160) (`lane/usage-audit-disk-bloat`) is
**MERGEABLE/CLEAN** and simply unmerged; PR [#163](https://github.com/Pootytxng/sentinel/pull/163)
(`lane/cleanup-train-2026-08-20`) is **CONFLICTING/DIRTY** and needs its own lane to rebase. Neither
has moved since 2026-08-20. An idle claim is an alarm, not a takeover — **but those two are also
the reason #126 cannot finish**, so if they are still idle at the next check this becomes one
question for the owner ("may I adopt these two?"), not an indefinite wait.

**#126's remaining nine refs are a DECISION queue, not a cleanup queue** — two are the PRs above,
one is a Codex claim, and the rest need an owner product-scope call (bklit design system ·
user-feedback Lab recovery · quiet-pit-wall half B) or a per-file landing (review-consolidation —
which is where item 2's price fix lives — tool-shed-hygiene, lab-49-parity-port). Evidence:
[`BRANCH_DISPOSITIONS.md`](BRANCH_DISPOSITIONS.md), now at **120/120** against its doc-budget ceiling,
so the next branch pushed to origin must archive that file's current sweep before it can add its row.

**NOT A LANE, but a trap for the next one:** the PRIMARY worktree `C:/Users/Kuya/code/sentinel` has
local `main` at `ffe85271`, **22 commits behind `origin/main`**, and holds an untracked receipt that a
fast-forward would collide with. A branch cut there starts stale. Left untouched on purpose — another
session left work in it — so whoever owns it next should `git -C ... merge --ff-only origin/main` first.

**ALSO OPEN, not yet queued** (so none of it drops silently): #133 CARE capability rails tasks 4–7 ·
#140 CPU temp (PawnIO/MSR — needs a Capability Exception record first) · #64 Q2b main-window caller
checks · #54/#55 Project Doctor (Codex-claimed) · #49 Quiet Pit Wall (needs a visual self-review) ·
#158 disk-bloat flag (that IS PR #160) · NAV-1 (awaiting owner direction) · TYPE-1's residual
(mono-for-machine-values-only is still a comment with no guard) · the PHASE A–D rows below.

**THE MONEY STACK IS STALLED AT PHASE 2 AND NOTHING ABOVE MOVES IT.**
[`RECEIPTS_DOCTRINE.md`](RECEIPTS_DOCTRINE.md) §4 puts the compy.gg one-pager + waitlist there,
with **"waitlist signups in 14 days"** as the first real market signal, and every phase after it is
funded by that one. Item 2 above is the only row in this queue that touches the site at all, and it
is a correction, not a step forward. Named here so the gap is visible rather than implied: **the
whole live queue is quality and hygiene, and the mission includes income.**

**OWNER-GATED — visible, never blocking:** 12 open items across `OWNER_ACTION_CHECKLIST.md` §A/§B/§C —
the Desktop key copy, the two Claude-settings edits (A_settings), distribution widening (B2), the
funnel + monetization inputs (B3/B6, now including the live `llms.txt` price line), the two
substituted asks (B4), his UI-vision pick (B5), the startup-mutation and GPU-screen forks
(B_startup/B_gpu), the analytics region question (B_eu), and the §C money/legal gates.

- [x] **Cutline rows SHIPPED 2026-08-18 → 2026-08-19, moved verbatim to
  [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md)** (2026-08-20, byte budget, to pay for the NEXT UP
  queue above): the product-conformance drift class + Cowork's 469-line audit, the Home front-door
  restructure (UX-1 ②), and C-12's command-palette doc drift. All three were closed records, not work.
- [ ] **Extend the Codex weekly automation with product-conformance scope, and make it write INTO the
  repo.** Today it is coordination-only (branches/claims/worktrees) and writes to `$CODEX_HOME`,
  outside the repo, where no lane ever reads it — which is why six days of drift went unseen. The
  audit above is the template for what the weekly run should re-check. Still delegated; do not
  duplicate.

### Conformance queue — the audit's unbuilt decisions, in owner-value order

- [x] **C-04 · SHIPPED 2026-08-19** (issue [#143](https://github.com/Pootytxng/sentinel/issues/143)).
  The front door is **Health** — owner's pick from Health / Checkup / Diagnosis, recommended because
  it answers "is my PC OK?" without the fear frame that retired "Fix" in 2026-06. Id stays `home`
  (persisted nav key, same rule as every prior rename). Renamed everywhere the user reads it: the
  rail/topbar/palette label, the tour's two rail-recap sentences, the CPU-temp honesty note and the
  memory lesson's tie line; the tour blurb stopped saying "Your dashboard" (a shape, not an answer)
  and now states the question the room answers. **The rename found a real hole with the fix half
  applied:** `HOME_RAIL[0].label` is NOT what the app prints — `ShellV2.tsx:94` renders
  `common.rail.<id>`, so renaming only `homeRail.ts` would have shipped "Home" with `homeRail.test.ts`
  green. New guard `src/design/rail-label-locale-guard.test.ts` pins literal ↔ locale (falsified
  against the half-applied rename), and `Home` joined the RETIRED map in `room-name-copy-guard.test.ts`
  so the old word cannot return to copy. **The self-review debt is DISCHARGED**: built, silently
  installed and stamp-proved at `40682344 · release · shell 0.9.26`, then reviewed on that binary —
  **VERDICT PASS**, all four surfaces (rail · breadcrumb · palette · tour recap) looked at, zero
  user-visible "Home" left. **Still not in any published build** — it ships with the next cut.
- [x] **SHIPPED conformance rows, moved verbatim to
  [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md)** (2026-08-19, byte budget): **C-05 + C-19**
  (`d76f753f` — first run lands on the diagnosis, the tour is one named card, CPU temp reachable on
  the default Live face and on the front door) · **C-06 + C-08 + C-09** (`4c9e440e`, `6d047c2a`,
  `00d7020e` — plain-English copy pass + its guard, build identifiers out of consumer chrome) ·
  **C-10** (`3eca4a9f` — no raw `<select>`, `src/design/Picker.tsx`) · **C-11** (`3eca4a9f` — the
  ledger folds 37 repeats of one tweak into one row) · **C-17** (`3eca4a9f` — the mono census with a
  ratchet). Read them there before re-litigating any of it. The C-18 correction below still
  applies; C-19 moved to the archive with its row, and C-17b is paid off below.

- [x] **C-18 · C-18 guard · C-18b — ALL SHIPPED 2026-08-19, moved verbatim to [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md)** (2026-08-20, byte budget). The classic `Monitor` room deleted after `TuningPresets` moved out of it verbatim (issue [#146](https://github.com/Pootytxng/sentinel/issues/146)) · `reachability-guard.test.ts`'s second tier, which catches a DEAD default export inside a LIVE file · both dead rooms decided, `Onboarding` deleted and vendored `Stepper` exempted by rule (issue [#148](https://github.com/Pootytxng/sentinel/issues/148)). **Read them there before re-litigating any of it** — the C-18 row is this repo's record of a subagent grep that was wrong three times, and the C-17b RESIDUAL row below leans on it.
- [x] **C-17b + C-17b RESIDUAL — the mono-on-prose ratchet is PAID (12 → 0), rows moved verbatim to
  [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md)** (2026-08-20, byte budget). Twelve selectors that
  wore a mono face on prose: eleven restyled, one re-classified (`.ss-pin-label` renders a clock and
  keeps `tabular-nums`). The residual visual review closed PASS on installed `402b0080`, and
  corrected its own header — **4 of 12 measured, not 6** — then classified the remaining 8 by the
  SHAPE of their wall: 2 data-shaped (close organically), 6 structural, of which four were the
  `.arc-v2` variants that turned out never to render at all and went out with the row below.
  `src/design/mono-law-guard.test.ts` holds the ratchet at 0 and carries the per-selector reasoning.
- [x] **Buttons rendered in Arial — FIXED, shipped and reviewed on installed `aac90cd7` (2026-08-20,
  #155). The finding was right and 3x too small.** `.btn-small` (`App.css:1388`) and
  `.debrief-ctx-head` (`App.css:3053`) declare `font-size`/`font-weight` and no `font-family`, so
  they fell through to the UA face — Windows Arial — beside `Geist Sans` siblings; the session-debrief
  **Share** button measured live as bare `"Arial"` on `402b0080`. **Measured before fixing: 97 of 290
  `<button>` call sites across 28 files** got a family from no rule at all (the row said 26 across 11),
  and **no stylesheet had a single `button` element rule** — the repo's only defence was a per-rule
  `font: inherit`, 88 of them, applied ad hoc. Ad hoc is the defect: forgettable by construction.
  **Fix — one line, not 28:** an unscoped `button, input, select, textarea { font-family: inherit }`
  next to the `html, body, #root` base in `App.css`. Family only; nothing else moved. A per-rule
  family still wins (element selector is 0-0-1), and the 88 existing `font: inherit` declarations were
  deliberately LEFT — some are the `font:` shorthand, which also resets size and weight, so deleting
  them would change rendering.
  **Guard first, and it covers the class:** `src/control-font-guard.test.ts` (4 tests) asserts the
  reset exists, is **unscoped** (a `.v2-shell button` scope is the same bug one level up), is
  **top-level** (parked in a `@media` it is conditional), lives in a sheet the app **actually loads**
  (import closure from `main.tsx`), and that `inherit` has an app face to land on. Then the class-level
  check is written on the real subject: **every `<button>` in the tree must get a family from
  something** — delete the reset and it fails naming all 97 sites. Proved both ways (fails without the
  fix, passes with it). Two ways it nearly lied, both fixed in-file: a combined import regex swallowed
  `import "./App.css"` so the closure came back without the app's own stylesheet, and a flat CSS parser
  cannot see `@media` nesting so the reset's depth is measured explicitly.
  **Shipped:** built, silent-installed, stamp-proved `aac90cd7 · release · shell 0.9.26`.
  **Self-review VERDICT: PASS** (9/9 at 1500x980) — both named selectors compute `Geist Sans` at
  unchanged size/weight, hover state intact under real CDP mouse events, zero overflowing controls
  across Health/Live/History/Test/Settings. *Recorded:* the first `/S` install returned exit 0 and
  never replaced the exe — the stamp gate caught it, a re-run fixed it, filed as **#156**.
- [x] **`.arc-v2` — CLOSED 2026-08-20. All three dead strata deleted, and the fourth (dormant M3/M4)
  went with its prop chain. `src/arc-instrument.css` 458 → 127 lines; nothing that renders changed.**
  Row had been corrected once already (2026-08-19, C-18b lane); both earlier findings were greps
  standing in for a trace, so this pass was hand-traced AND mechanized:
  `src/arc-v2-reachability-guard.test.ts`.
  **M1 Onboarding (was 6–123) — DELETED.** C-18b deleted the component (issue #148); no `onb-` token
  survives anywhere in `src/**`, so those 118 lines could not match on any input.
  **M2 First-check — LIVE, and it was carrying 66 lines of dead radar.** `4b5e8b49` ("retire the
  radar → light sweep") removed the component and left `.fc-radar*`, `.fc-scanzone`,
  `@keyframes fc-sweep`, their `@media` and the reduced-motion rule behind. This row never saw that
  stratum — the guard's class-by-class orphan check found it on its first run. **Deleted too.**
  **M3 Session debrief + M4/4b comparison cards — DELETED, with the `arcV2` prop chain.** Traced
  shorthand-aware: `arc-v2` reached the DOM from 6 emitters, all gated on an `arcV2` prop, and the
  only caller that ever set it is `App.tsx:1228` (`<FirstCheck arcV2 />` — the JSX shorthand the
  first grep could not see). `FirstCheck` imports neither surface, so no `.debrief`/`.cmp`/`.wcp`
  element could sit under an `.arc-v2` ancestor. **This was first filed as an owner fork; that was
  over-escalation** — it is dead engineering, not a product call, and the owner said so plainly
  ("I have no idea what that arc-v2 thing even is"). Deleting the CSS alone would have left a prop
  that lies, so both went: 156 lines of skin and the prop threaded through `SessionDebrief` +
  `WhatChangedPanel`. Three skin generations have shipped since it was written; a re-dress should
  start from a decision, not from leftovers.
  **No visual review dispatched, and the reason is mechanical, not a shortcut:** every removed rule
  needed an `.arc-v2` ancestor no mount produced, and the removed JSX was `${arcV2 ? " arc-v2" : ""}`
  where `arcV2` was `false` at every call site — proved by the caller census in the guard, which was
  green before the deletion. The diff cannot change a pixel.
  **Guard, rewritten with the deletion:** the orphan test still fails on any arc-skin class with no
  subject in the tree, and the caller census now pins the DECLARATION as well — `arcV2` may exist
  only in `App.tsx` and `FirstCheck.tsx`. Threading it into a third component fails the build, which
  is exactly the debt this row was.
  Verified: `tsc --noEmit` clean; mono census re-seeded (`MONO_CENSUS_UPDATE=1`) and the delta is
  exactly the 5 deleted mono rules, nothing else.
- [x] **The kernel law's ONE earned celebration is BUILT — it had never fired for a single user.
  Found 2026-08-20 by the arc-v2 cleanup, not by anyone looking for it; closed the same day in its
  own train.** The owner's 2026-06-06 kernel law says the win card's shimmer is the only celebratory
  sweep in the app: when a measured fix actually improves FPS, the improved after-bar sweeps once,
  and nothing else in Compy ever does. It had exactly one implementation — `@keyframes
  cmp-winshimmer` on `.cmp-improved.arc-v2 .cmp-bar-after` in `src/arc-instrument.css` — **behind the
  `arcV2` prop no screen ever set.** The law's single celebration was unreachable from the day it was
  written, and `src/sweep-guard.test.ts` was green the whole time because it watched the KEYFRAME,
  not its reachability.
  **Fixed:** re-homed verbatim into `src/App.css` on the live selector `.cmp-improved
  .cmp-bar-after` (both after-bars, same 3.4s cycle, same 0.35s delay), `pointer-events: none` added
  so the glint cannot eat a click, and the explicit reduced-motion opt-out kept on top of the global
  clamp — a celebration should be ABSENT under reduced motion, not merely instant.
  **bug→guard, and the guard is the real deliverable.** `src/sweep-guard.test.ts` gained a third
  tier that asks the question the old one could not: every compound in the sweep's selector must be
  producible UNCONDITIONALLY by one `className` expression. A class that only ever arrives through a
  ternary is a SECOND gate, and the only thing allowed to gate an earned celebration is the earning.
  Falsified against the exact original defect — re-scope the rule to `.cmp-improved.arc-v2` and tier
  three goes red naming the compound. Tier one (no second sweep anywhere in `src/`) is unchanged and
  still absolute.
- [ ] **C-14 · `GpuProfile.tsx` — wire in as advisory, or archive it.** Owner fork, never resolved,
  still parked by exemption.
- [ ] **C-13 · Foundation tooling gap — axe-core (rank 3, MINE) LANDED; Figma MCP (rank 2, OWNER)
  still not wired.** The half that was ever mine to do is done and the row stays open only for the
  owner's half. `axe-core` now runs in vitest: `src/test/axe.ts` is the harness,
  `src/design/a11y-axe-guard.test.tsx` mounts 49 cases across the design system, console/bento and
  the vendored primitives, `src/design/a11y-axe-shell.test.tsx` mounts the 6 Tauri-mocked chrome
  cases (rail, room frame, palette, window chrome, update offer), and
  `src/design/a11y-census-guard.test.ts` + `a11y-census.baseline.json` classify **all 46**
  `src/design/**/*.tsx` so a NEW component fails the suite until it is rostered or given a named
  reason — `unrosteredCeiling: 0`. **What it caught on day one:** `RoomAccentPicker`'s popover is
  `role="menu"`, and its two action buttons were bare `<button>` children — an `aria-required-children`
  violation, now `role="menuitem"`. **What it deliberately does NOT check, and must never be said to:**
  colour contrast. jsdom has no canvas and `vitest.config.ts` sets `css: false`; measured against a
  1.06:1 failure the rule returns *0 violations, 0 passes, 1 incomplete*, so leaving it enabled would
  read as contrast coverage that does not exist. It is disabled by name, and contrast stays where it
  is really measured (`src/theme-contrast.test.ts`, `src/design/type-scale-guard.test.ts`).
  **Still open under this row:** (a) rank 2, the owner's Figma account + MCP server — his hands, see
  `docs/OWNER_ACTION_CHECKLIST.md`. That is now the ONLY thing holding C-13 open.
  **(b) CLOSED 2026-08-20 — the `role="menu"` keyboard contract is honoured.** `RoomAccentPicker`
  declared the role from the day it shipped and carried none of its behaviour: **all 17 items sat in
  the tab order**, so crossing the topbar by keyboard cost 17 stops instead of one; no arrow keys, so
  the role's navigation contract was a claim the component did not honour; and no focus restoration,
  so closing dropped focus onto `<body>` and lost the user's place. Now: roving tabindex (exactly one
  tabbable item), one linear ring over all 17 items with Up/Left · Down/Right · Home/End and wrap,
  disabled items skipped, and every close path — Escape, Tab, pick, apply-to-all — returning focus to
  the trigger. An outside click deliberately does NOT restore focus, so it cannot fight whatever was
  just clicked. **Kept as a menu rather than ported to `Picker`** (the select-only combobox from
  C-10): the popover mixes 15 `menuitemradio` swatches with two COMMANDS, and a `listbox` may not
  contain commands — so this completes the correct contract instead of re-architecting a shipped
  surface. Picker's recorded warning about focus-on-close is paid explicitly rather than dodged.
  **Why axe never saw it, and why that generalises:** axe reads the accessibility TREE — roles, names,
  required children — and every one of those was already correct here, so the 49-case C-13 sweep
  passed the day the defect was filed. **A role is a promise about behaviour, and behaviour has to be
  driven to be measured.** Guard: `src/design/room-accent-menu-keyboard.test.tsx` (16 tests) drives
  real key events against a real mount and asserts real `document.activeElement`, and its last block
  is a CLASS ratchet — any NEW `role="menu"` under `src/` fails until it carries arrow handling, a
  roving tabindex and a `.focus()` restore. Falsified FIVE ways (18 tests), each control failing
  exactly the tests it should and no others: the true pre-fix component (14/18 red), tabindex alone
  removed (3), the arrow handler alone unwired (6), focus-restore alone dropped from Escape (1), and
  disabled-skip-on-open alone removed (2). That last one is a hole found in THIS lane's own change
  during diff review, not in the original: `End`/`ArrowUp` from the trigger opened onto the last
  INDEX — "reset to default", disabled whenever the room has no pick — so focus landed nowhere and
  the tab stop parked on an unfocusable item. Refs do not exist at open time, so the skip lives in
  the focus effect, stepping backward.
  **Shipped `5fab9e79` (PR [#172](https://github.com/Pootytxng/sentinel/pull/172)); the self-review it
  owed is PAID 2026-08-20** on installed desk build `75849be1` — the first binary ever to carry it.
  **Self-review VERDICT: PASS** (10/10 at 1500x980; the reviewer re-confirmed the stamp with its own
  `get_build_stamp` probe before capturing anything). **What 16 mounted tests could not see:** the
  roving-tabindex focus ring draws OUTSIDE the swatch fill (`outline: 2px solid rgb(179,102,255)`,
  `outline-offset: 2px`), so it stays legible on a near-hue swatch (Violet) as well as a contrasting
  one (Emerald) instead of vanishing into the very colour it marks — an invisible focus ring on a
  roving tabindex is a keyboard trap the user cannot see. Disabled-skip and wrap were driven with REAL
  CDP input events in both directions and landed on "Apply to all rooms", never the disabled "Reset to
  default"; `Escape` put focus visibly back on the trigger. **Recorded for the next keyboard review:**
  synthetic DOM dispatch fails Chromium's `:focus-visible` heuristic and would have FALSE-FAILED the
  states item — real input events are required, not `dispatchEvent`.
- [x] **PR #90 recovery + the quiet launch, rebuilt** — PR [#102](https://github.com/Pootytxng/sentinel/pull/102),
  #90 MERGED (its four unverified Codex claims re-proven + repaired), #100 closed measured-inert and
  rebuilt via `WebviewWindowBuilder` + `SW_SHOWNOACTIVATE`. Detail: `docs/CHANGELOG.md`.
- [ ] **`launch-focus-guard` RUNTIME tier is intermittent under the pre-push gate — NOT root-caused.**
  2026-08-18: the quiet-launch case rejected three consecutive pushes of the same tree
  (`Compy held the foreground for 33/55 samples (first at 2430ms)`), then PASSED the fourth with that
  identical tree. Ruled out by measurement, not guesswork: worker count (green at `--maxWorkers=4`
  AND full parallelism), the gate's own `npm test` (exit 0), the file alone (17/17 ×3), and the
  Windows foreground-lock timeout (`ForegroundLockTimeout` is INT_MAX on this desk, so it never
  expires). **Do not "fix" this with a skip.** First foreground at ~2.4s is a window being RAISED
  well after creation, and if that is real under load it is real while the owner games — the exact
  thing this guard exists to catch. Next step is instrumenting the probe to record WHAT raised the
  window, not silencing the reading.
  **2026-08-18 (later, this lane): a DIFFERENT signature, and it is now split from the one above.**
  Reproduced 3/3 against the 0.9.25 desk build with VS Code holding the foreground: `55/55 samples,
  first foreground 7ms, first window 12ms`, and it had never been measured before because every
  earlier run SKIPPED — a compy was running each time. **The first reading of this was wrong and an
  independent review caught it the same day:** it was written up as proof that Windows fronted the
  launch before Compy had a window, i.e. not ours. It proves no such thing. The probe polls at
  100ms and, inside one iteration, reads the foreground FIRST and the window SECOND with a
  `Process.Refresh()` in between, so a 5ms "foreground first" lead is the loop's own ordering. An
  in-process raise that beat the first sample produces an identical reading. `classifyForegroundReading`
  now compares the two with a margin of one poll: more than one interval past the window is an
  in-process raise and a hard failure (the 2430ms and 132ms readings), anything inside one poll is
  reported `unattributable-at-launch` — UNMEASURABLE by name, claiming nothing about cause. Nine
  tests pin it, including a drift pin against the probe's declared interval.
  `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF=1` refuses that skip; **nothing in the repo sets it today**
  (an earlier comment claimed "the release gate does" — it does not exist), so it is a by-hand
  switch until a release gate is built. **Still not root-caused, and now honestly bounded:** telling
  the two causes apart at launch needs a finer instrument — an `EVENT_SYSTEM_FOREGROUND` hook that
  records each foreground change with its source — not a finer reading of a 100ms poll.
  **And the split immediately earned itself: under the FULL suite the same binary reads
  `50/54 samples, first foreground 132ms, window at 13ms` — a raise 119ms AFTER the window existed,
  which is the in-process class and fails.** So there really are two failures wearing one message:
  idle → the OS fronts the launch before Compy has a window (not ours); under load → something
  raises the window ~120ms after creation (ours, intermittent, reproduces only under full
  parallelism — 3/3 green standalone). The next step is unchanged and now better aimed: instrument
  WHAT raises the window at ~120ms, with the suite running.
  **2026-08-20 (lane/focus-121): the instrument exists; the policy is unchanged until it has read a
  real failure.** `scripts/lib/foreground-events.cs` is a WinEvent hook (`EVENT_SYSTEM_FOREGROUND`,
  `EVENT_OBJECT_FOCUS`, window `CREATE/SHOW/DESTROY` for the launched process tree,
  `MINIMIZESTART/END`) that the probe now runs around every launch, pumping instead of sleeping so
  each event is stamped on arrival; every runtime message (fail, unmeasurable, and clean) carries
  the trace plus `summarizeTrace`'s attribution — focus taker's window class + owning process
  (`webview2-runtime` / `in-process` / `outside-family`), and `inherited-after-another-window-left`
  when a non-family window minimised or died ≤500ms before Compy got the foreground. **Unverified
  lead, recorded not guessed:** the hook's own smoke test launched a *hidden* powershell.exe
  (`Start-Process -WindowStyle Hidden`) from a background shell and recorded Windows Terminal — the
  default console host on this desk — FRONTED at +59ms, MINIMISED at +307ms, foreground falling to
  the next window in Z-order. Sibling suites do exactly that launch during the full gate
  (`runtime-proof-guard.test.mjs:122-125`, `detached-window-guard`'s Minimized control child), a
  fresh never-activated window sits at the top of the Z-order, and the terminal can only be fronted
  while the foreground lock is open — i.e. on an input-idle desk. That would explain every recorded
  property at once (full-suite only, idle-desk only, ~120ms+ after the window, "not ours"), and it
  is exactly what the `inherited-…` category is shaped to show. **It is not confirmed:** the
  deciding run is the full suite with the trace, on a desk with no compy open and no game in front,
  which the lane that built this did not have (owner in-game the whole session). If confirmed, the
  fix lives in how the siblings launch their console children (CreateNoWindow, never a ShellExecute
  Hidden console) plus a guard that no suite opens a console host — not in Compy.
  **2026-08-20 (later, same lane): the issue's "decision 2" is taken.** `runtimeVerdict` combines the
  poll with the trace: a reading the trace shows was HANDED to Compy (`inherited-after-another-
  window-left`) is reported UNMEASURABLE by name instead of failing the push; everything else keeps
  the poll's verdict (an in-process raise with no hand-off, or a foreground with no focus event near
  it, is still the hard zero; inside-one-poll stays unmeasurable on the poll's terms because a focus
  taker at launch proves nothing). Five pure tests pin it, two mutants caught. *Why:* the flake
  blocked unattended pushes — the marathons' landing step — and the trace now names the sibling that
  opened the console, so the fix has an address. Still open: the deciding measured run, then the
  sibling console-launch fix + guard. `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF=1` still refuses every
  unmeasurable.
  Shipped: installed build `3155c7a0`, self-review **PASS** on round 3 (round 2 caught that P2 was
  only half-fixed — a hand-added cooler still occluded the CPU — and that is now fixed and guarded).
- [x] **The "add a part" form is mounted nowhere** — CLOSED by Train 1 (2026-08-12): the form was
  extracted verbatim into `RigManualParts` and mounted in the Lab's own chrome
  (`LabConsole.tsx:480`), while the chromeless hologram keeps rendering; a guard block fails the
  build if it ever unmounts again (`lab-console.test.tsx:339`). Shipped desk v0.9.14, published
  v0.9.15 → v0.9.17. This row had sat un-ticked through the fix — closed on code evidence 2026-08-12.
- [ ] **Q8 / issue #91 — COMPY CARE: primary PC-doctor directive + Capability Exception Gate
  (OWNER-APPROVED 2026-08-09).** PR #102 merged 2026-08-12; #91 closed as a directive.
  **Policy rails are LANDED (issue #133, 2026-08-18):** tier-aware outbound guard, support-evidence
  tier separation, and the copy audit that caught the beta guide still promising "no updater" a month
  after it armed. **Next is the Tier 1 dark implementation**
  (`docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`); runtime stays hard-false.
  Do not compete with issue #49's Lab shell, revive draft PR #50, or adopt #55's
  stale Project Doctor claim. Rust-side Tier 1 keeps production CSP unchanged, so it does not trigger
  #64 Q2b; any proposal for webview fetch/remote content/CSP widening does.
  - **Primary product:** "Compy Care" umbrella; user-facing rescue entry is **Crash & Freeze Rescue**
    (retire "Black Box" from primary navigation). Diagnosis/recovery first; measured optimization is
    the second specialty.
  - **Care loop:** intake → triage → local case chart → bounded differential → one next plan →
    follow-up → prevention. The app must remember whether the symptom returned and whether the plan
    helped; it must not end at a one-time log explanation.
  - **Coverage ladder:** Train 1 crashes/hangs/restarts/BSOD; then measured performance regressions
    and slowdowns; thermals/noise; storage/startup/update trouble; network/peripheral/device trouble.
    Each later train needs its own evidence contract and must preserve honest unknown states.
  - **Discovery contract:** a compact Care entry is always visible on Home independent of whatever
    else Home gates. (Written when that meant the default-OFF `compy_home_intake` band; the band was
    deleted 2026-08-20 and the word that carries the contract — *independent* — now binds against the
    interview's `compy_home_interview` instead.) A new local incident observer may persist one pending
    Home card, but the first version uses launch/foreground and monitored-session-end scans only—no
    background service and no assumed notification-click callback.
  - **Tier 1 — approved to build DARK:** separately signed public known-issue catalog, Rust-side
    pull only, local matching against existing crash incidents, zero machine-derived upload, separate
    key/schema/domain/cache from privileged remote rules. Runtime stays hard-false until exact
    endpoint, signing custody, disclosures, security review and canary evidence are approved.
  - **Tier 2 — NOT authorized by Tier 1:** scrubbed incident fingerprint — on by default once armed,
    disclosed at first run, real off switch, payload preview, no raw log/dump/path/serial (2026-08-18 §2).
  - **Tier 3 — NOT authorized by Tier 1:** explicit one-case evidence upload after preview/redaction,
    named recipient + retention/deletion receipt, no background queue or inherited consent.
  - **Driver posture:** no driver is needed for Tier 1. A Compy driver is policy-possible only through
    its own proven-need/security/anti-cheat/signing/rollback record. Borrowed vulnerable drivers,
    generic physical-memory/MSR/PCI/device-register access, and game/process injection remain barred.
  - Canonical spec: `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md`.
    Plans: `docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md` then
    `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`.

- [ ] **Q9 — OUTBOUND CAPABILITY EXPANSION (OWNER DECISION 2026-08-18).** Record:
  `docs/decisions/2026-08-18-outbound-capability-expansion.md`. The owner judged that building
  *around* the outbound restrictions cost more than the restrictions were worth. **Runs BEFORE Q8's
  Tier 1 build** — Q9a tells us what users actually do, which is the input Tier 1's catalog is
  guessing at today. Ordering is a lane decision, not an owner gate; say so if it should flip.
  - [ ] **Q9a — arm Tier 2 usage analytics, default-ON + disclosed.** *Bigger than a switch:*
    `receipts.rs` has the payload builder, the scrub, the preview command and a mounted consent
    surface, but **no send path exists at all** — no HTTP call, no endpoint, no queue, and the
    webview capability/CSP does not permit one. So the work is: a receiving endpoint ($0 tier), the
    Rust send path, the capability/CSP widening, the first-run disclosure, and the privacy/EULA text
    — one coherent change. `receipts_gate()` at `src-tauri/src/receipts.rs:18` is the last line of
    it, not the first. Payload preview, scrubbed allowlist and a real off switch stay mandatory —
    they are what makes the disclosure true. Amend
    `src/capability-exception-policy-guard.test.ts` (it currently asserts Tier 2 default-OFF) citing
    the decision record, never by weakening the invariant. **Destination decided (B_land, 2026-08-18):** the
    same-origin Pages-Function → D1 pattern `functions/api/waitlist.ts` already proves, writing to
    D1 `compy_reports` (`73f5e8a3-1827-42e3-8543-9fedc3750532`). Separate endpoint and separate
    table from Tier 3 — storage may be shared, consent and transport never. 🪪 **owner-gated
    sub-item:** EU/UK distribution needs a region check before default-ON ships there.
  - [ ] **Q9b — build Tier 3 in-app feedback + crash reports.** Own module
    (`src-tauri/src/case_evidence_upload.rs`), never inside `support_evidence.rs`. Tier 3's gate is
    unchanged and applies in full: per-case consent, preview/redaction, named recipient, retention,
    deletion receipt, no background queue, no inherited consent. **Destination decided (B_land, 2026-08-18):** D1 `compy_reports` on the
    owner's Cloudflare account, reached through its own `functions/api/` endpoint — no email inbox
    anywhere in the design. The consent screen names it: *"Compy's own store on compy.gg"*. Define
    the schema in this change (retention column + a ticket id the deletion receipt can quote); the
    database is empty on purpose. Residual: one `wrangler pages deploy` at ship time (B7).
  - [x] **Q9c — CPU temperature that feels native, with no driver.** *Shipped 2026-08-18 (PR pending):*
    `src/surfaces/CpuTempOffer.tsx` replaces the dead-end sentence with an offer that detects what is
    installed, starts it or links the download, and names HWiNFO's Shared Memory Support switch.
    Self-review PASS round 3 (6 fixture states). *Background:*
    `src-tauri/src/cpu_temp.rs` reads HWiNFO's `Global\HWiNFO_SENS_SM2` shared memory and the
    LibreHardware/OpenHardware WMI namespaces, driver-free, and Monitor shows the value attributed to
    its source. **The gap was purely UX** — with no sensor app running the user got one sentence telling
    them to go run one, a dead end under the name-it-AND-fix-it-inline law. The third-party-driver route is
    closed by Windows, not by us: every free option reads through WinRing0, which is on Microsoft's
    vulnerable-driver blocklist (default-enforced since Win11 22H2) and flagged by Defender as
    `VulnerableDriver:WinNT/Winring0` — our installer would trip Windows Security itself. A Compy-signed driver stays
    policy-possible but costs an EV certificate, so ZERO-BUDGET LAW parks it until revenue exists.

- [x] **Q0 — LabDeck glance-first presentation pilot: CLOSED, redirected 2026-08-02.** Issue
  [#14](https://github.com/Pootytxng/sentinel/issues/14) is not canonical and was never merged
  wholesale — closing verdict redirects into issue [#49](https://github.com/Pootytxng/sentinel/issues/49)'s
  Quiet Pit Wall Lab step (production order step 6). `feat/user-feedback-lab-recovery` @ `0599013`
  is preserved as selectively-portable source only: the real rig evidence map, measured gauges,
  comparison evidence, honest unavailable states, rollback, denial semantics, decision-journey
  behavior, and a11y/layout guards + tests port into #49's Lab surface only "when they earn parity,"
  never wholesale.
- [x] **P0 before the next release or wider beta — ALL THREE LANDED 2026-08-03** (Q1 privacy/
  storage/trust-copy truth as v0.9.12 · the other two with it). Full record archived:
  `docs/archive/BACKLOG_SHIPPED_P0_2026-08-03.md`.
- [ ] **P1 stabilization:** ~~reproducible local supply-chain/release gate~~ **Q4 DELIVERED** (issue
  [#35](https://github.com/Pootytxng/sentinel/issues/35)) — one command `powershell -NoProfile -File
  scripts/verify-release.ps1`, 14 checks, PASS/FAIL/BLOCKED/PENDING, reachability-classified npm +
  cargo audits with expiring acknowledgements, evidence pack JSON; see RELEASE_AUTONOMY.md → "The one
  local command". §11 property/fuzz coverage for persistence parsing + bounded IPC inputs also DELIVERED
  (issue [#37](https://github.com/Pootytxng/sentinel/issues/37)) — dependency-free fixed-seed generator,
  9 properties over the ledger, session file, elevated-command guards, mutation allowlists, batch
  receipts, and rollback-contract resolution. **Q5 BACKEND + POLICY DELIVERED 2026-08-04** — local-only
  redacted support evidence: `src-tauri/src/support_evidence.rs` (bounded rotating JSONL at
  `%APPDATA%\Compy\support\`, 400 records / ~250 KB, redaction at write *and* again at export, three
  projections, preview-gated export), 17 cargo tests, `src/support-evidence-outbound-guard.test.ts`
  turning the spec's "zero new outbound surface" acceptance line into a build-failing fact (proven
  load-bearing by injecting a real `reqwest` call and watching it fail), and the `docs/PRIVACY.md`
  disclosure + deletion consequences. **Q5 COMPLETE 2026-08-04** — the in-app preview/export UI
  (`08ad3b1`, `src/surfaces/SupportEvidence.tsx`, 9 tests, en/zh-CN parity) took its visual
  self-review on the installed `5ff6963` release build and PASSed 9/9; the first pass FAILed on a
  real user-facing defect and its fix is now guarded both sides (see the cycle entry below). **Q7 DELIVERED 2026-08-05** (issue
  [#73](https://github.com/Pootytxng/sentinel/issues/73)) — the accessibility sweep and the measured
  baselines, both recorded against the installed `dc4d55e · release` build on the owner's desk.
  A11y: the three `<Canvas>` mounts were checked in the live DOM, two were silent to a screen
  reader, and `src/canvas-a11y-guard.test.ts` now forces every canvas to answer *named picture* or
  *explicitly decorative* at its own call site. Perf: `scripts/q7-probe.mjs` wrote raw traces to
  `docs/perf/raw/`, `docs/perf/q7-baseline.json` transcribes 14 metrics, and
  `scripts/perf-budget-guard.test.mjs` re-derives every published number from those traces on each
  `npm test` — so a hand-edited baseline fails even though CI can never re-run the probe. One bad
  finding was on the record as an `open finding`, not a spec: **idle Compy cost ~50% of one core**
  with nothing moving and nobody present, reproduced on two bare runs. **CLOSED 2026-08-06** by the
  idle-cost teardown below — 50.165% → 23.348% of a core, re-measured on the shipped 0.9.13 build;
  `src/shell-idle-guard.test.ts` carries the third idle axis (*is anyone interacting?*) and its
  always-on record is now empty. *Still owner-blocked:* the lower-spec rig leg — every budget is proven on one fast
  machine and none is a claim about a slow one. **Q6 DELIVERED 2026-08-04**
  (issue [#65](https://github.com/Pootytxng/sentinel/issues/65), `9bf3bde`) — three stale live claims
  retired: `GAMING_MODE_PLAN.md` reconciled against the QA record (8 rows mapped, 3 left unchecked as
  *unproven, not failing*), the 2026-07-06 launch runway archived verbatim with its "no real UI gaps"
  sweep claim, and "every branch has a verified disposition" made true rather than retired — all 20
  origin branches dispositioned in `docs/BRANCH_DISPOSITIONS.md`, enforced by
  `scripts/branch-disposition-audit.mjs`.
- [ ] **P2 product completion:** owner-accepted canonical Lab + reversible generation pruning →
  first-win action/rollback/proof journey → Consumer/Technical/Support evidence exports.
  **Generation pruning DONE 2026-08-06** — 29 unreachable files / ~2,578 lines deleted (two Lab faces,
  three Optimize faces, `CompyHero`, `nav-flags.ts`, the `design/qpw` components, `Gallery`, a second
  `Sparkline`, vendored `MagicBento`); recurrence mechanised by `src/reachability-guard.test.ts`.
  Remaining under P2: the first-win journey and the evidence exports — the first-win journey is
  issue #49's Lab production-order step (see Q0 above for the #14-verdict porting checklist).
- [x] **Ledger-completeness honesty class — last known open instance CLOSED (found 2026-08-05 during
  the Home train's completeness-critic sweep, fixed the same day, issue #70).** The Lab Optimize
  station's "Applied & history — **every change, undoable**" summary vouched for a set Compy may
  never have enumerated: `get_applied_changes` degrades an unreadable `history.json` to `[]`.
  **One correction to how this was first written up:** the disclosure was *not* ungated — `Fix`
  already mounts `LedgerHealthNotice` for `view="ledger"` and already withholds its `.fix-empty`
  claim when the ledger is known-incomplete. The residual defect was narrower and worse: the vouch
  sat on the `<summary>`, *outside* the `<details>` holding its own caveat, and that `<details>` is
  collapsed unless expert view is on — so the caveat was sealed **behind** the claim it qualifies,
  one step past the "printed under it" failure `ledger-health-disclosure-guard.test.tsx` pins. Fix:
  under KNOWN-INCOMPLETE the summary swaps to `appliedHistorySummaryUnvouched` **and** the section
  opens itself; UNKNOWN (`null`) stays byte-identical to healthy. Guarded by
  `src/surfaces/lab/ledger-health-optimize-station-guard.test.tsx` (11 pins, falsified by reverting
  the fix: exactly the 6 defect pins go red, the 5 controls stay green).
- [ ] **LATER:** Intelligence Phase 4/5, vendor-awareness expansion, Receipts/crowd intelligence,
  remote rules, Pro/affiliate/B2B, and model-assisted explanation remain behind the blueprint's gates.

---

> **🧰 TOOLCHAIN — Fable-window persistence pack** (2026-07-06) — COMPLETE 2026-07-07: all 4 items shipped; living pointer = CLAUDE.md → PROJECT SKILLS INDEX. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22 tier-1 board diet).

## 🚚 LIVE UPDATER — SHIPPED (owner directive 2026-07-22) + FIRST FIELD-QA WAVE (reviews 2026-07-22)

> **ARCHIVED 2026-08-19 for the byte budget — moved verbatim to**
> [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md). All 12 rows were closed and none was open: the
> updater shipped and self-updated on the owner's rig (`RELEASE_STATE.md` 23a), and the 2026-07-22
> J + Matthew field-QA wave was triaged to completion. Read it there before re-litigating any of it.
> Live updater state is `docs/RELEASE_STATE.md`; the owner's remaining updater items are
> `docs/OWNER_ACTION_CHECKLIST.md` §A0.

## 🧠 INTELLIGENCE PLATFORM LANE (owner directive 2026-07-16 — supersedes priority ordering per its §0.12)

Owner-approved direction: evolve Compy into **evidence-based PC performance intelligence** — the
measurement layer that can say *what changed, what is consistent with the evidence, and what to
test next*. Machine evidence remains local by default; approved Tier 1 may download signed public
case knowledge and match it locally, with no incident upload. In-git anchor: `docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md`
(the Intelligence Phase 1 spec; the directive itself is a Cowork-lane review artifact, not committed).
**Namespace rule: phases in this lane are always written "Intelligence Phase N"** — never bare
"Phase N" (Optimization Cleanup owns a separate Phase 0–3 sequence; the two numbering schemes must
never be conflatable in any doc, commit message, or report).

- [x] **Intelligence Phase 1 — foundation + "What changed?" (read-only vertical slice)** — ✅ BUILT
  this cycle (hashes in Cycle 2026-07-17a): `intelligence.rs` canonical domain layer + local event
  timeline (from existing persisted data ONLY — never fabricates historical events) + deterministic
  two-session "What changed?" engine (fixed hypothesis catalog; enum confidence bands
  unknown/low/medium/high, never numerics; never causation-from-precedence) + first surfaces
  (Monitor SessionDebrief WhatChangedPanel · Blackbook logbook observed rows · Home last-session
  line) + expert view + anti-fabrication guards. Flag `compy_intelligence` DEFAULT ON ("0" failsafe
  test-pinned). Zero mutation, zero network, zero capability change.
- [x] **Intelligence Phase 2 — patterns, good-vs-bad, evidence graph** — ✅ BUILT + SHIPPED this
  cycle (`9c6af4b` backend · `094d834` frontend; installer SHA-256 `3EB0FAE5…C570D838`, live exe
  stamp-verified `094d834` clean). Spec `docs/superpowers/specs/2026-07-17-intelligence-phase2-train2.md`.
  Delivered: `intelligence_patterns.rs` six cross-session detectors (trend/thermal/memory/driver/mode/
  fade, passive-capped at Medium, §0.12 coverage reasons) · `what_changed_between` (§4D last-good-vs-
  first-bad) · EvidenceGraph re-projection (§4C, no new data, no causation language) · `drift.json`
  ingestion (external reverts as observed events) · `AppliedChange.rolled_back_at` (additive
  `#[serde(default)]` stamp, rollback logic unchanged). Surfaced Expert-view only (`compy_expert_view`
  default OFF): SessionInvestigator + evidence graph (Monitor), PatternsTile (Blackbook §5E, no fifth
  room); plain view unchanged. Read-only + one additive field — zero mutation/network/capability change.
  cargo 787/787 · clippy clean · vitest 1710/1710 · rust-tauri-reviewer PASS · self-reviewer PASS.
- [x] **Intelligence Phase 3 — experiment engine + optimization simulator** — ✅ **ARMED + SHIPPED**
  2026-07-17 (owner-signed "Ship it live now"). Groundwork built dark `7e00a06`; arming flips
  `experiment_gate() -> bool { true }` (`experiment.rs:55`) + wires `build_sim_context` to the REAL
  hardware-tailored catalog + converts the two dark tests to armed reality + interactive `ExperimentBench`
  FE (Lab room). Spec `docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md` §7.
  The engine ORCHESTRATES the existing mutation boundary (**no new apply/rollback primitive, no enum
  variant**; applies via `history::apply_recommendation`, restores via `history::rollback_change`, resolve
  stays history-only) · delta judged on the SAME 3% floor (`comparison::classify_with_guards`) · simulator
  reads the catalog READ-ONLY (unknown rec ⇒ honest insufficient-evidence, never a fabricated verdict).
  Mutation-gate 10/10 + rust-tauri-reviewer PASS + live apply→rollback round-trip on the rig + Cowork
  audit flagged. **The owner's first real gaming-session experiment IS the live FPS→verdict QA** (real
  frames are the owner's to produce — anti-fabrication law). Installer + stamp in RELEASE_STATE Snapshot.
- [x] **Intelligence Phase 3 fast-follow (W2 — UX staleness):** ✅ FIXED `f558d1d`. `ExperimentBench`
  now re-runs its simulator read on window/tab refocus, so a pick that became already-applied during the
  same Lab visit re-derives to the honest `already-configured` verdict card (Start withdrawn) and STAYS
  VISIBLE in the picker via the new `options` list rather than vanishing. Never a correctness bug —
  server-side `build_sim_context` already re-derived `already_active` from the ledger at start, so a stale
  pick could never double-apply; this closes the staleness window. Guard: `ExperimentBench.test.tsx`
  "re-derives the active pick from the live ledger on refocus" (6/6). (W1, the reselect race AT the apply
  boundary, was FIXED + guard-tested pre-ship: the picker locks during `simBusy` + request-id sequencing
  drops superseded reads + the sim card names its exact mutation target — `ExperimentBench.test.tsx`
  "locks the change picker while a simulation is in flight".)
- [x] **Measurement Platform 2.0 follow-up — treatment-side game-match check (additive, V1 limitation) — SHIPPED 2026-07-18.**
  The controlled experiment (`ExperimentBench`) captured a `GameStateFingerprint` at **baseline** but did
  NOT re-check the game/process on the **treatment** side, so a game-swap mid-run (quit the game, launch a
  different one between baseline and treatment) was **not provably excluded from stored data**. **Shipped
  fix (additive, safe-default, read-only advisory):** `conclude_experiment` now takes an optional
  `treatment_game: Option<String>` (the treatment session's `process_name`, which the FE already has via
  `treatmentFor`'s same-game filter — the game identity is the ONE axis that can realistically swap within a
  single sitting; rig/driver/res are held constant by construction, §1 of the decision doc). `conclude_outcome`
  runs a pure `game_match(baseline, treatment) → GameMatch` check at **top precedence, before crash + sample
  gates**: `Mismatch` ⇒ `not-comparable` verdict, restore (`keep=false`), **Unknown** confidence, plain-English
  "measured a different game … not enough comparable evidence"; `Unverified` (either side blank/absent) proceeds
  but drops the same-game claim; `Match` earns the "same rig and game" note. **Defense-in-depth** — the FE
  same-game filter stays, but the backend no longer trusts it (mirrors the `MAX_TEXT_LEN` webview-trust-boundary
  posture). No apply/rollback mutation, no network, no gate change. Guards: 5 new cargo tests +
  `not-comparable` added to `no_verdict_note_ever_carries_a_numeric_confidence` + an `ExperimentBench.test.tsx`
  render guard (the `not-comparable` verdict is unreachable in the live UI by design, so its label is vitest-proven).
  Decision doc `docs/decisions/2026-07-18-experiment-comparability.md` §3/§4 updated to CLOSED.
- [x] **Measurement Platform 2.0 follow-up — comparability vocabulary chrome convergence (cosmetic).** ✅ LANDED
  `921f49e`. `src/surfaces/measurement-chrome.tsx` + `.css` are now the ONE vocabulary both rooms wear —
  `<VerdictBand>` / `<SectionLabel>` / `<ComparabilityNote>`, fed per-room by a `--mc-*` palette block declared
  same-element on each room root (never `:root` — [[css-var-declaring-element-substitution]]). Pinned by
  `measurement-chrome-guard.test.ts` (11 tests, 3 positive controls). **Still open, deliberately:** the
  **surface-level reshape** (merging/renaming the "prove a change" rooms themselves) remains **owner territory**,
  not autonomous — this train unified chrome only, it did not touch room structure. Decision doc
  `2026-07-18-prove-a-change-overlap.md` §1/§5.
- [~] **Intelligence Phase 4 — hardware-twin intelligence integration (IN PROGRESS):**
  - [x] **Component-level evidence highlighting (slice 1)** — ✅ BUILT this cycle. `component_evidence.rs`
    is a READ-ONLY projection: it re-keys the existing Intelligence Phase 2 pattern findings
    (`intelligence_patterns::detect_patterns`) BY the hardware component each names (memory-trend → Memory;
    thermal-trend / driver-split → GPU), inventing no evidence and reaching no conclusion the Patterns tile
    doesn't. `HardwareGrid` lights a component card ONLY when a real pattern implicates it — accent border +
    label dot + an expandable evidence disclosure (band · non-causal headline · reasons · suggested next
    test) at that pattern's own confidence band (passive-capped at Medium, never High). Flag off or a fetch
    failure ⇒ fully neutral, never a fabricated glow. Command `get_component_evidence`; zero mutation /
    network / capability change. Guards: `HardwareGrid.test.tsx` (lit / neutral / fetch-fail / band-class) +
    `component_evidence.rs` 10 tests + the `.card.card-lit:hover` cascade guard in `border-hygiene-guard.test.ts`.
    cargo / clippy / vitest / tsc green · self-reviewer PASS (§4H, 9/9). Invisible on a rig with no qualifying
    session pattern yet (correctly neutral until evidence accrues) — that IS the design.
  - [x] **CPU thermal-peak tracking (hardware-health trends, slice 2)** — ✅ BUILT this cycle.
    `SessionAccumulator::record_thermals` (`sessions.rs`) tracks per-session `peak_cpu_temp_c` /
    `peak_gpu_hotspot_temp_c` as a running max-so-far — a tick with no reading holds the prior peak,
    never fabricates one — threaded through `SessionSummary` and `types.ts`. New `cpu-thermal-trend`
    cross-session detector (`intelligence_patterns.rs`, alongside the existing GPU thermal-trend)
    fires only once ≥`MIN_TREND_SESSIONS` sessions carry a real peak reading, silent otherwise;
    Medium confidence only on a sustained multi-session move, Low on a small/short one. cargo
    869/869 · tsc clean · vitest 1777/1777.
  - [ ] long-term personal knowledge graph (remaining Phase 4 slice).
- [ ] **Intelligence Phase 5:** evidence-based Upgrade Advisor 2.0 · "buy nothing" verdict ·
  technical prescription contract · consumer report and shop-report exports. (Subsumes the
  evidence-export-tiers item in PHASE A below and UI_VISION_BACKLOG §F upgrade-path engine —
  one lane, not two; both entries annotated at source.)
- [ ] **Intelligence Phase 6:** optional crowd intelligence · only after explicit security/privacy/
  owner gates · no work in the current train.
- [x] **Home HUD: rig-tier / corner-gauge text overlap (pre-existing defect, unrelated to the intelligence
  lane).** ✅ FIXED 2026-07-18. The self-reviewer (Intelligence Phase 4 §4H re-review) found `.hc-corner`
  ArcGauges overlapping `.hc-stage-cards` content on the Home HUD stage — intermittent because it only
  reproduces in 2D card view (`compy_home_rig_3d="0"`; the default 3D hologram leaves the corners clear)
  AND only when the HardwareGrid is tall enough to scroll rows into the gauge bands, so it was proven
  independent of the §4H diff (NOT a regression). Root cause: the four corner gauges are always-present
  (z-index:2, pinned 22px from each stage edge, ~56px tall) while `.hc-stage-cards` was a full-height
  (max-height:420px) scroll viewport, so a tall grid scrolled its rows UNDER the top/bottom gauges. Fix:
  confine `.hc-stage-cards` to the gauge-free MIDDLE band (max-height 420→240px) — `home-console.css`.
  bug→guard: two mechanized guards in `home-console.test.tsx` (a 2D-mode DOM coexistence check + a
  CSS-contract bound proving the viewport can never span the full stage again). Self-reviewer PASS:
  5.9–11px clear gaps measured top and bottom at both scroll extremes; 3D path unaffected.

**§0.12 demotion flags (owner reviews; nothing dropped without a trace):** open items below that
neither feed nor serve the intelligence platform are flagged 🔻 at their entries — five as of
2026-07-17 (curated safe-to-suspend data · debounce/Rapid-Trigger detection · sensor-ID DB · ISP
speed snapshot · DNS probe), each already blocked on its own gate, so demotion changes nothing
today. **NOT demoted:** Optimization Cleanup (separate lane per directive §0.11 AND a data source
for this platform — external drift + tweak-pack residue become timeline events) · pre-room intent
router + basic-mode simplification (complementary consumer-clarity work per directive §9 — stays
queued).

> **🔥 TOP PRIORITY LANE** (de-slop directive 2026-07-05) — CLOSED 2026-07-06: every item [x], Instrument-HUD reskin shipped (`394dd2f`/`96febda` live). Live UI truth = `UI_VISION_BACKLOG.md` + `RELEASE_STATE.md`. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).

> **🚀 LAUNCH RUNWAY** (Cowork consolidation, 2026-07-06) — ARCHIVED 2026-08-04 (Q6): a point-in-time consolidation whose sweep claims ("zero open code stubs", "no real UI gaps") and gate line numbers had drifted. Its still-live content is owner-gated and tracked where it belongs — RUNG 3 (private-beta send) and RUNG 4 (signing · legal · repo rename + `compy.gg`) in `OWNER_ACTION_CHECKLIST.md`; gate truth in `RELEASE_STATE.md`; UI truth in `UI_VISION_BACKLOG.md`. RUNG 2 closed 2026-07-08. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-08-04).

## 🛰️ HQ STEERING LOG — live lane board (newest on top)

> **Retention rule (2026-07-13):** this board keeps only the newest ~12 cycles. Older cycles live in
> `docs/BACKLOG_ARCHIVE.md` (same format — grep there for history). When appending a new cycle, move
> the oldest one(s) out if the board exceeds ~12 entries.

> ### 🛑 OWNER DECREE 2026-07-16 (via Cowork, owner at the console): AUTO-DEPLOY LANE DROPPED — do not resurface
>
> The GitHub-Actions auto-deploy errand (Cloudflare token + GitHub billing unblock, Cycle
> 2026-07-16e, archived 2026-08-06 to `docs/BACKLOG_ARCHIVE.md`) is **dead, permanently, by owner
> decision.** Facts established live in the
> owner's GitHub dashboard before the call: no failed payment, billed $0; Actions blocked since
> Jul 9 by the account's $0 Actions budget (stop-usage on); **$12 of ~$16 included free minutes
> already burned this month** — so "costs nothing" was not guaranteed, making this a zero-budget-law
> spend gate, and the owner declined. **Standing consequences:** ① the workflow file may stay in the
> repo (it fails politely) but do NOT ask the owner for the Cloudflare token, a billing change, or
> any budget raise again — the OWNER_ACTION_CHECKLIST item for the token paste is CANCELLED, remove
> it on next touch; ② manual `wrangler pages deploy` under the standing B3 deploy GO remains THE
> publishing path; ③ revisit ONLY if the owner raises it himself (the named trigger he accepted:
> multi-day absence where the site must update unattended).

### Cycle 2026-08-19d — ARCHIVED

Moved verbatim to [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md) (2026-08-20, byte budget) when the
C-13 (b) keyboard-contract row was written and this file reached 113.3KB of its 114KB ceiling. The
front door became **Health** (C-04, issue [#143](https://github.com/Pootytxng/sentinel/issues/143)),
and the rename found a live drift hole with the fix half applied: `HOME_RAIL[0].label` is NOT what
the app prints, so renaming only `homeRail.ts` ships the old word with its own test green. The
shipped C-04 row near the top of this file remains the current-state record.

### Cycle 2026-08-19c — ARCHIVED

Moved verbatim to [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md) (2026-08-19, byte budget) when
Cycle 2026-08-19d was written. The reticle's idle rAF loop: 250 calls/s with the pointer merely
resting inside the window, parked and guarded (issue #142).

### Cycle 2026-08-19b — ARCHIVED

Moved verbatim to [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md) (2026-08-19, byte budget — the
ledger was 0.5KB from its wall). The v0.9.26 fleet move and the four release-pipeline defects it
surfaced.

### Cycle 2026-08-19a — ARCHIVED

Moved verbatim to [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md) (2026-08-19, byte budget) when
Cycle 2026-08-19b shipped it to the fleet. The #127 idle-CPU teardown: 19.632 → 10.483 percent of
one core, `aurora`'s `scale()` was the trigger and the 3D rig was never the cost.

### Cycle 2026-08-06a — ARCHIVED

Moved verbatim to [`docs/BACKLOG_ARCHIVE.md`](BACKLOG_ARCHIVE.md) (2026-08-19, byte budget). The
idle-cost teardown that halved decorative CPU — and, per Cycle 2026-08-19a above, took out
`aurora`'s blur while leaving its `scale()`, the part that was actually costing 13.257 points.


### Cycles 2026-08-04b … 2026-08-04g — ARCHIVED

Moved verbatim to [`docs/archive/BACKLOG_STEERING_LOG_2026-08-04b_TO_2026-08-04g.md`](archive/BACKLOG_STEERING_LOG_2026-08-04b_TO_2026-08-04g.md). Covers the
unreadable-ledger honesty run (Q7/Q9 acceptance, the sibling room, the rec-id read), all on
`claude/harness-context-cleanup-700535` and all awaiting the owner's merge decision.

### Cycles 2026-07-27a … 2026-08-04a — ARCHIVED

Moved verbatim to [`docs/archive/BACKLOG_STEERING_LOG_2026-07-27_TO_2026-08-04.md`](archive/BACKLOG_STEERING_LOG_2026-07-27_TO_2026-08-04.md) (TOKEN LAW: history leaves the
living ledger, nothing is deleted). Covers Q5/Q6 completion, the standing autonomy grant,
release autonomy → v0.9.11, and the forensic reconciliation.

## ⛔ Persistent-workflow protocol (read before declaring "done")

When running a `/loop` or scheduled session against "the checklist":

1. **Open THIS file. Pick the highest-priority `[ ]` item that is not owner-gated.** Do it (spec → TDD →
   build in an isolated worktree off `main` → `/check` + `/security` → `self-review` if visual →
   cargo/npm green → commit after branch+status check). Tick it `[x]` with the commit hash. Repeat.
2. **Never declare "done" without enumerating.** A valid stop is one of:
   - *"All `[ ]` items remaining are owner-gated — here they are: …"* (list them), OR
   - *"Phase A `[ ]` count is now 0; remaining work is Phase B/C/D which is gated — confirm before I cross a gate."*
   - A bare "I'm finished, standing by" with un-ticked `[ ]` items above is a **false finish** — keep going.
3. **A green test suite is NOT the stop signal.** The stop signal is "no un-ticked, non-gated item remains."
4. Owner-gated items (🔒 money/distribution, 🪪 mutation catalog-expansion, 📡 telemetry/outbound)
   are *blockers to surface*, never silently skipped or marked done. **Aesthetics are not on that
   list** (2026-08-07 decree) — decide it, ship it, hand him a before/after to veto on sight.
5. **Branch redundancy: judge by the TREE, not ahead/behind.** Lanes merge via PR (new hashes), so a branch can
   read "N ahead / `git cherry` all `+`" while its content is **already in main**. Before flagging a branch as
   "stranded/unmerged work," run `git merge-tree --write-tree main <branch>` — if it equals `git rev-parse main^{tree}`,
   the merge is a no-op → already shipped → prune, don't surface. Only a tree-changing merge is real unmerged work.
   And re-RUN cargo/vitest for counts each cycle — never carry an assumed number forward. ([[branch-redundancy-detect-by-mergetree]])

> **🌿 Branch-integration health** — the 2026-06-24e sweep (every branch dispositioned, `main` the single product truth) is a **point-in-time record**, moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22). **Its standing claim was false when written and is now enforced instead of asserted (2026-08-04, Q6):** every one of the **20** origin branches carries a row in **`docs/BRANCH_DISPOSITIONS.md`**, and `scripts/branch-disposition-audit.mjs` fails the build when a ref has no row, a row names a dead ref, or a `MERGED` row stops being a no-op. Result: 6 MERGED · 6 SUPERSEDED (content reached `main` by another path) · 3 PRESERVE (the frozen beta ref + two failed v0.9.9 candidates `RELEASE_AUTONOMY.md` requires kept) · 1 CLAIMED by the Codex lane (`feat/console-project-doctor`, no automatic takeover) · **4 UNLANDED** carrying real work — `codex/tool-shed-hygiene` (partial), `feat/bklit-anime-design-system` (owner product-scope), `feat/user-feedback-lab-recovery` (owner review), `design/quiet-pit-wall` (deferred, needs a visual self-review). `main` remains the **release** truth — every shipped build is built from it — but that is not a claim that no work lives elsewhere; live lane ownership is governed by `docs/WORK_CONTROL.md`. The durable merge-tree law stays in protocol rule 5 above; re-run it before asserting a branch is stranded.

---

## PHASE A — Allowed-now (the 1.0 product-completeness lane)

Legend: `[x]` shipped on main · `[~]` partial/thin · `[ ]` not built · `[⛔]` excluded by feasibility/design.

### A0 · Repo hygiene
- [x] Reconcile + prune the stranded branches; confirm `main` is the single product truth — done 2026-06-24e: pruned `spike/backend-agent`, `benchmark`, and the two no-op-redundant safety branches (`qa/locale-drift-hardening`=#6, `gaming/honest-partial-undo`=#7, both already in main); the 3 remaining unmerged branches are deliberately-superseded archives. `main` IS the single product truth.
- [x] Adopt this ledger as the persistent-workflow target — the HQ STEERING LOG (top) is the live per-cycle target; `/loop` + scheduled HQ sessions drive off it.

### A1 · DETECTION layer — **effectively complete** (feasibility-bounded)
- [x] core-parking state (policy/registry + powercfg) — `hardware.rs`, `lib.rs:288`
- [x] XMP/EXPO active — ✅ DONE + GUARDED (audit 2026-08-03): honest "running below rated", never
  claims "profile active" — `mem_speed_status` `hardware.rs:511`, surfaced via `xmp_expo_status`;
  guards `hardware.rs:3176` `mem_speed_status_is_honest` + `HardwareGrid.test.tsx:92`.
- [⛔] Intel Speedshift/EPB — user-mode feasibility wall ([[detection-feasibility-walls-usermode]])
- [⛔] AMD PBO — feasibility wall (detect-only impossible without vendor SDK)
- [⛔] thermal-throttle (ACPI) — feasibility wall; only post-hoc noisy-run flag exists
- [~] power-draw — GPU via NVML/ADLX built; CPU package power not (no kernel/vendor path) — `monitoring.rs:365`
- [x] Hyper-V / VBS / SVM virtualization — `hardware.rs:1078`, `diagnostics.rs:126`
- [x] S.M.A.R.T. drive health — `hardware.rs:329`
- [x] USB device/lane tier — `hardware.rs:1148`
- [~] BIOS-tweak *availability* annotation — BIOS age detected; "which tweaks available" not probed
- [x] firmware/BIOS date check — `hardware.rs:1027`
- [x] driver-freshness all vendors + copyable URLs — `hardware.rs:1321`, `Check.tsx:49`
- [x] NIC driver freshness — `get_nic_driver_info`, `Check.tsx:262`

### A2 · MEASUREMENT spine — **mostly built**
- [x] benchmark before/after comparison (armed) — `comparison.rs:120`, `benchmark_trial.rs:238`
- [x] baseline set/clear — `benchmark.rs:940`
- [x] cross-session comparison — `comparison.rs`, `sessions.rs:212`
- [x] session history with hardware snapshot — `sessions.rs:35` (`hw_fingerprint`)
- [x] drift-regression advisory — `drift.rs`
- [x] local award/score ledger — drill-down UI: each award expands to its full certified receipt (rec_id handle + metric + 95% CI + points + timestamp) from the existing get_scoreboard data — `260f943`
- [x] persist a real DOWNSAMPLED fps-over-time series per session — `fps_series: Vec<(u32, f64)>` additive `#[serde(default)]` on `SessionSummary`: per-10s-bucket MEAN of the real ~1 Hz samples, real elapsed-secs x-axis (gaps in play stay gaps, never interpolated), capped 2160 points (6 h), kept for the most-recent 20 sessions and stripped on save for older; TS contract mirrored (`types.ts` `fps_series?: [number, number][]`). 5 guard tests pin bucketing math, gap honesty, the cap, pre-series serde-default parse, and the strip window. Unblocks the site ReplayHUD real trace + an honest in-app session chart (neither wired yet — no UI renders it in this train). Read-only/additive, no mutation boundary — `sessions.rs`, `monitoring.rs:984`
- [x] hardware-tier segmentation — LOCAL Entry/Mid/High band on the Benchmark surface from measured VRAM·cores·RAM (inputs named); reuses the canonical rig-tier bands via pure `benchRigTier`; like-to-like framing, no cohort/network — `372bde1`
- [x] percentile display — wired `percentile_rank` as a LOCAL display-only stub: each verified win ranked within the cohort of ALL the user's own wins (the scoreboard ledger), shown as "Top X% of your verified wins" in the award drill-down, labeled "local — no peer cohort yet"; gated below a 4-win floor; never persisted. Peer/cohort percentile stays Phase C gated — `0de96f0` (`benchmark_scoreboard.rs:63`)
- [x] CPU-runner flake fix (backend lane flagged) — `cpu_kernel` now guarantees ≥1 work chunk (do-while) so a starved tiny-run scheduled past its short deadline still measures real throughput instead of reading 0 and false-failing the shared green baseline; strong `> 0.0` shape assertion kept + a regression guard (`cpu_kernel_runs_at_least_one_chunk_past_deadline`) pins the contract; `benchmark.rs`, cargo 612
- [x] `normalize()` honesty fail-safe — a non-finite raw score now fails SAFE to 0 (no credit) instead of `Inf`→`.clamp(0,100)`→**100** (a fabricated "perfect" component score, the worst honesty failure). Currently unreachable (producers guard divisors via `.max(1e-6)`/`is_finite`) but guarded at the point-of-use so a future producer-guard regression can't invent a maxed score; invalid reference (non-finite/≤0) also → 0. Regression test pins Inf/NaN/-Inf + bad refs (was untested); real-path byte-identical — `2ee51aa` (`benchmark.rs:461`)
- [x] `completeness_pct()` honesty fail-safe (completeness-critic close-out of the above — the grep'd sibling) — its `ceiling <= 0.0` gate did NOT catch a non-finite input (`NaN <= 0.0` is false), so `+Inf current`→**100** (fabricated "fully optimized") and `NaN`→leaked through `.clamp()`. Now `is_finite` guards both inputs at the point of use, mirroring `normalize()`, so the boundary is uniform + safe-by-construction whenever this still-unwired primitive is wired. comparison::pct (guarded `base>0`, measured-FPS inputs, NaN-delta failure mode) + percentile_rank (u32-derived inputs) assessed safe — class now closed. Regression test pins Inf/NaN; finite-input behavior byte-identical — `dbc8358` (`benchmark_scoreboard.rs:75`)

- [x] **FPS presenter picker: desktop apps winning between matches — FIXED this cycle (0.9.1).**
  Live §6 evidence 2026-07-22 (40-min Marvel Rivals watch) showed the dominant-presenter pick
  wandering to Discord/RadeonSoftware/Code/claude while the game sat closed/loading. Fix is
  positive window evidence + sticky attachment (`fps.rs`): acquisition now requires the candidate
  to own a visible top-level window, be foreground, AND cover its monitor's full bounds (excludes
  the whole windowless-Electron-GPU-process class structurally, no per-app denylist entry needed)
  for `ATTACH_STREAK_TICKS` consecutive ticks; once attached, only that pid is ever reported and a
  silent tick (menu/loading) emits nothing rather than re-picking — never abandoned for a chattier
  presenter, released only when the process actually dies/recycles. `monitoring.rs`'s FPS recorder
  gets a matching freshness gate (<3s mtime) since `fps.json` can now legitimately sit frozen.
  9 new attachment-state-machine tests. cargo 869/869.
- [x] **fps.rs pid-recycle re-check on the "still presenting" path — ✅ FIXED (Q3 of the stabilization
  program).** 0.9.1 review Warning (rust-tauri reviewer, 2026-07-22): `Attachment::Attached`'s
  frames-present arm never re-verified that the pid still mapped to the attached image; only the
  silent-tick arm called `alive(pid, name)`. So the one case that produces a wrong measurement — a
  recycled pid that is actively PRESENTING — was the one case that never reached the check, and real
  frametimes were reported under the dead game's name into `sessions.json`, comparisons, the
  scoreboard and every export. The audit under-stated it: the arm also filtered candidates by pid
  ALONE and reported the STORED name, so a recycled pid arriving under its new ETW-resolved image
  name was still attributed to the old game. Fix: candidates must match pid AND name; `alive` is
  consulted on the frame path as well as the silent one; and a pid presenting under a foreign name is
  treated as a recycle (release) rather than a loading screen (stay attached). Three red-first guards
  in `fps::attachment_tests` — recycle-while-presenting, foreign-image-name, and replacement must
  re-earn the full streak — plus one pinning the ordinary live case. Mutation-proven in both
  directions: dropping the liveness clause fails 1, dropping name matching fails 2. `cargo test
  --lib` 874 passed · clippy `-D warnings` clean.
- [ ] vitest 4th flake class (low): under full-suite worker contention, a file can error at
  collection with "Vitest failed to find the current suite" (seen once 2026-07-22 on the two
  `src/surfaces/setup/` files; both pass isolated AND on full-suite re-run). Not one of the three
  878a3a9 classes. If it recurs, investigate pool/maxWorkers; a single re-run is the current answer.
- [ ] evidence-export tiers — audience-shaped renders of the SAME measured evidence pack (`export.rs`
  today: `export_report` markdown/JSON + Discord block = the technical-ish default): add **Consumer**
  ("what changed, in plain English"), **Technical** (full probe/CI detail), and **Support** ("help me,
  here's my rig + ledger") render tiers over the one data source — presentation-only, no new probes, no
  new claims, honesty invariants shared. The **Shop** tier is NOT this item — it belongs to the parked
  Shop Report Mode (Phase D), don't build ahead of it. Provenance: panel-review brief 2026-07-15 §4.4.
  **Audit confirmed, 2026-07-16 (Cowork):** `export.rs` (824 lines) has exactly ONE render path —
  `build_markdown_report` + `build_discord_block`, no struct/enum tiering at all. **Correction to the
  brief's assumption:** no share-card export exists either (grepped repo-wide) — `docs/BACKLOG.md`'s
  own "Real-wins strip" section already notes the share-card component is a forward-looking idea, "not
  queued as a train." So Consumer/Technical/Support are ALL genuinely new, not a light tiering pass
  over existing variants — size this task accordingly before scoping it as small.
  **→ 🧠 SUBSUMED by Intelligence Phase 5 (2026-07-17, intelligence directive §9):** consumer/
  technical/shop report exports ship as part of the evidence-based Upgrade Advisor 2.0 lane — do not
  build this separately; the audit finding above (one render path, no share-card exists) carries
  forward as Intelligence Phase 5 input.

### A3 · CONTENT reorg (Blackbook/Autopsy) — **half built; missing entry metadata**
- [x] entry dedup lint — `knowledge.lint.test.ts:78`
- [x] category + **hardware tags** on entries — **DONE**. Category: `knowledge-topics.ts` central id→topic map, 10 topics, required `BaseEntry.topic` + lint + Learn "Topic:" filter (`cf77e0b`). **Hardware tags DONE**: `Applicability` enum (AMD/NVIDIA/Intel/laptop/desktop) + central optional `APPLIES_BY_ID` map in `knowledge.ts` (absent = universal), `applies?` on entries, lint validity/completeness guards, Learn "Fits:" filter + per-card tag pills (read-only/advisory; self-reviewed). Topic + applicability labels flagged for owner taxonomy skim.
- [x] date-added / last-updated metadata — **DONE**. Optional central `DATES_BY_ID` map in `knowledge.ts` (id→`{added, updated?}`, ISO YYYY-MM-DD; absent = no date shown, never fabricated), `added?`/`updated?` on `BaseEntry` via a `withDates` pass, `formatEntryDate` TZ-safe "Mon YYYY", lint guards (real ids, well-formed dates, updated≥added), quiet Learn card footer line (read-only/advisory; self-reviewed).
- [x] filter-by-category + verdict UI — `Learn.tsx:578`
- [x] alias-collision lint + CI guard — `knowledge.lint.test.ts:98`
- [x] deprecated/superseded status field — `status` + `supersededBy` on BaseEntry + `lifecycle()` mapper + lint guard (real/different target) + honest Learn surfacing (`aedb3ab`)
- [x] orphaned-`related[]` lint — `knowledge.lint.test.ts:84`
- [x] Autopsy structured schema — versioning/migration added to the PERSISTED store: `autopsy-ledger.ts` now writes a versioned envelope `{ v, entries }` + `migrateLedger()` (forward-only, idempotent, lossless) carries the legacy bare-array form forward and seams in per-version upgrades for future field changes; +10 tests. The transient `AutopsyResult` (`knowledge-autopsy.ts:15`) is recomputed from re-graded text each session (never persisted) → nothing to migrate there (`3e16618`)
- [x] Autopsy "what did we learn?" rollup — `autopsy-ledger.ts`, `Learn.tsx:453`
- [x] local autopsy stats — `autopsy-ledger.ts`, `local-stats.ts`

### A4 · ADVISORY surfaces — **42 of 48 shipped; nothing here is ungated work** (recount 2026-08-05)

> The old "~24 of 33 not built" heading survived the whole lane being built out and read as the
> project's biggest hole. Actual state: **42 `[x]` · 1 `[~]` honesty-capped (NVIDIA/Intel vendor
> badges, withheld under LOCKED Rule 5 — not a to-do) · 5 `[ ]`, and every one of the five is gated**
> — three on owner-curated data that must not be LLM-generated (safe-to-suspend reference, keyboard
> debounce/Snap-Tap detection, sensor-ID known-issue DB) and two behind the outbound wall (ISP speed
> snapshot, DNS resolution-time probe). **Do not pick these up as "next" — none is unblocked.**

> **Shipped entries archived 2026-08-20** — the 42 `[x]` lines (with their file:line receipts) moved verbatim to [`docs/archive/BACKLOG_A4_SHIPPED_2026-08-20.md`](archive/BACKLOG_A4_SHIPPED_2026-08-20.md) to keep this file under its byte budget. What stays below is everything still open or honesty-capped.

**GPU**
- [~] vendor profile detection + advisory badges — **AMD half DONE + guarded** (`vendorProfileInsights`,
  GpuProfile — Adrenalin-named HAGS/power-mode/thermal insights, no perf promise; guard
  `src/data/gpu-sensor.test.ts`). **NVIDIA/Intel deliberately WITHHELD under LOCKED Rule 5**, not
  unfinished — this `[~]` means "as complete as the honesty rule permits", never a to-do.

**Services**
- [ ] curated "safe-to-suspend" reference data (must be owner-curated, never LLM-generated) —
  🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence
  platform; already blocked on owner curation, so nothing changes until he supplies the list.

**Peripheral** (no Peripheral surface exists in the rail — whole section missing)
- [ ] debounce / Snap-Tap / Null-Bind / Rapid-Trigger detection — 🪪 **owner-curated-data-gated**
  (assessed 2026-07-05): whether the feature is *enabled* is firmware/vendor-software state — not
  user-mode readable (no standard HID report; same wall class as [[detection-feasibility-walls-usermode]]).
  The only honest buildable form is capability *inference*: match the connected keyboard's product name
  (already read — `latency.rs` PnP enumeration, real names + VID&PID) against a device→capability list —
  and that list is per-SKU claims about users' hardware, the owner-curated-never-LLM-generated class
  (same rule as safe-to-suspend above). Content half already shipped (`rapid-trigger`/`keyboard-actuation`
  Learn terms). Unblocks when the owner curates the device list. 🔻 **demotion-flagged 2026-07-17
  (intelligence directive §0.12):** doesn't feed the intelligence platform; already curation-gated.
- [ ] sensor ID + known-issue DB (bundled JSON) — 🪪 **owner-curated-data-gated** (assessed 2026-07-05):
  the sensor silicon inside a mouse is not exposed over USB/HID (only the mouse's own product name is —
  already read, `latency.rs`); model→sensor mapping + "known issues" are third-party teardown claims =
  the owner-curated-never-LLM-generated class. Unblocks when the owner curates the DB.
  🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence
  platform; already curation-gated.

**Network (detection only)**
- [ ] ISP speed snapshot (local) — 📡 outbound-gated (a real throughput test must download from a server = first outbound call, same wall as the DNS probe); only the zero-outbound NIC link-rate above is feasible without owner sign-off. 🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence platform; already outbound-gated.
- [ ] DNS resolution-time probe — 📡 outbound-gated (a resolution-time measurement IS a live DNS query = outbound call; held at the same wall as the ISP snapshot above — Cycle 2026-06-25d flagged it as gated). 🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence platform; already outbound-gated.

### A5 · GUIDED SETUP & VERIFICATION + PARAMEDIC — **half built; clean finishable gaps**
- [x] Setup-Complete state machine — `FirstCheck.tsx`, `Onboarding.tsx`
- [x] post-apply verification gate (re-run probes) — `use-scan.ts`, `Check.tsx:293`
- [x] green/yellow/red confidence chips (color-coded) — `Check.tsx:298`
- [x] exportable setup summary — dedicated "Setup summary" card in Check (`buildSetupSummary` in `use-scan.ts`, copy-to-clipboard, read-only/advisory, zero IPC)
- [x] Re-Run Setup / re-baseline flow + overflow handling — `useHardwareChange` hook owns detect→acknowledge ("this is my rig now"); `summarizeHardwareChanges` caps change lines to "and N more" so a big multi-part swap never floods the card (`use-hardware-change.ts`, `Check.tsx`)
- [x] **hardware-change detection** — wired into Check (Optimize→Fixes): advisory card names what changed + inline acknowledge/re-baseline (`acknowledge_hardware_changes`) so it never nags; live-verified 2026-06-24
- [x] override toggle — "Restore all (N)" bulk control in the Dismissed strip (Fix.tsx, ≥2 dismissed, reversible, zero IPC)
- [x] drift-watch integration — `drift.rs`, `Check.tsx:325`
- [x] historical-ledger surfacing — `Fix.tsx:712`
- [x] applicability check + override — eligibility filter + A5 override: "My hardware supports this" on capability-gated recs in the Not-for-this-rig pile; rec rejoins the normal flow through the SAME audited apply path; reversible, decision kept on record ("overridden by you" + Compy's original read + "Set aside again"); localStorage pref (`eligibility-override.ts`), zero IPC — `c6c00a4`
- [x] obsolescence/superseded flags + supersession CHAIN — pure `supersessionChain()` (cycle-safe, missing-target-safe) resolves transitively; Learn's superseded note links the CURRENT end of the line + names multi-hop paths; corpus lint pins chain termination — `d060b07`
- [x] before/after delta display — full pair everywhere: TrustSnapshotLine appends " · set to <after>" ADDITIVELY (locked kernel-§6 sentence verbatim, test-pinned); Fix + CommandCenter pass the typed applied_label — `2f5b675`
- [x] "last seen working on" hardware tag — AppliedChange stamps `hw_fingerprint` at apply time (ONE receipt funnel covers all paths); `on_this_rig` computed driver-INsensitively (gpu·ram·display); history receipts + active cards show "Last seen working on <gpu · ram> — before your hardware changed"; legacy entries stay honest "rig unknown" — `2f5b675`
- [x] per-tweak audit trail — `Fix.tsx:423`
- [x] ledger filter "this rig only" — History checkbox, rendered only when some entry is KNOWN to be from other hardware; hides exactly those (legacy unstamped rows never hidden); hidden count named — `2f5b675`
- [x] measured-payoff linkage — per-tweak honest payoff meter: `payoff_label_from_action` (history.rs) names the KIND of gain (input latency / background CPU&RAM / network / power&thermal / …), never a fabricated number; rendered as a quiet advisory chip on active + history ledger rows (Fix.tsx)
- [x] pre-room intent router (BACKLOG:916) — **DONE, then SUPERSEDED.** Built 2026-07-18 as the Home
  intake band behind `compy_home_intake`; the owner removed it on sight 2026-08-12, and it was
  **deleted** 2026-08-20 when the **interview** (issue #177, design foundation ③) took over the same
  intent gap: one question per screen in a Sheet behind Home's single primary button
  (`src/surfaces/HomeInterview.tsx` ← `home-interview-data.ts`, flag `compy_home_interview`, default
  ON, `"0"` failsafe, Settings → Behavior toggle). Full band history — option A/C greenlight, the
  declined door-level hints, the one-owner stand-down, the self-reviewer PASS — moved to
  [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md#2026-08-20--pre-room-intent-router-the-intake-band-superseded-by-the-interview).

- [x] basic-mode simplification — SCOPE-CHECK FIRST, build only what's missing: FirstCheck's one-verdict
  flow + verdict cards + the answer-first Home already cover most of "one screen, one verdict, one
  action"; audit that flow against the panel's basic-mode ask and close only genuine gaps (no parallel
  "simple mode" build). Provenance: panel-review brief 2026-07-15 §4.8. *(2026-07-17, intelligence
  directive §9: complementary consumer-clarity work — stays queued, NOT demoted.)*
  **Scope-check done, 2026-07-16 (Cowork), against `FirstCheck.tsx`, the persona's 5-point ask:**
  (1) one verdict — **covered** (`fc-verdict` headline). (2) one recommended action — **covered**
  (#1-limiter spotlight, single Apply button). (3) one visible explanation of *what changes* —
  **partial**: the spotlight shows `top.reason` (why it's a limiter) but nothing on this screen
  states the actual before→after value. (4) one visible explanation of *how it's restored* — **real
  gap**: "Compy snapshots the prior state so you can roll this back anytime" only appears inside the
  confirm-dialog you see AFTER clicking Apply, not as a standing line on the verdict card itself — a
  user who doesn't click Apply never sees it. (5) one next-step-after-playing — **covered** (footer:
  "Play something tonight; the session debrief will tell you..."). Net: this is a small, well-scoped
  copy/layout addition (surface the restore-guarantee line + a plain what-changes line on the
  existing verdict card), not a new flow.
  ✅ CLOSED 2026-07-18. Gap (4) FIXED: the restore-guarantee now renders as a **standing line**
  on the #1-limiter spotlight card (`.fc-spotlight-reversible`, `FirstCheck.tsx`), gated on
  `recFor(top)` (only when there's an applyable fix — a hands-on fix has nothing for Compy to roll
  back), with the ↺ mark in `--ready`. Same true promise as the confirm-dialog body (LOCKED rule 3
  makes it honest); appears before any Apply click. Gap (3) before→after value **intentionally NOT
  built** — `PriorityItem`/`ScanRecLite` carry no such value on this surface, so a stated value would
  be fabrication (no-fabrication law); the existing `top.reason` + "Expected impact · not yet measured
  on this rig" chip already give the honest what/why. bug→guard: `FirstCheck.test.tsx` "surfaces the
  restore-guarantee as a standing line" (4/4 green). Self-reviewer PASS (contrast 6.16:1 muted /
  10.22:1 mark, 12px gap no overlap, no duplication). tsc clean.

### A6 · UPGRADE-PATH advisory — **complete** (affiliate tags = Phase D)
- [x] hardware-limited verdict detection (GPU≥95% / HDD install drive) — `priorities.rs:95`
- [x] `build_upgrade_path` single source — `priorities.rs:106`
- [x] session-qualified copy — `priorities.rs:109`
- [x] copy-only buttons (no URL opener) — `Check.tsx:207`
- [x] plain retailer links (no tags) + disclosure — `priorities.rs:81`
- [x] markdown-export anchors — independently tested: anchor-format integrity for EVERY RetailLink (count parity, well-formed Markdown, https-only, export-layer tracking-marker ban mirroring the priorities guard) — `2f698e4`
- [x] test "no tags + disclosure always paired" — comprehensive affiliate/tracking guard over ALL retail links (const tables, 12 markers, https-only) + single-item disclosure pairing locked (`priorities.rs` tests)

---

> **UI SLIM-DOWN TRAIN** (council-approved 2026-07-01) — SHIPPED: P1–P3 + deep-cleans landed, all four flags default-ON since `733f132`; its P2 taste notes are point-in-time (pre-HUD Monitor, pre-rail-relabel). Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).

---

## PHASE B — Gated mutations 🪪 (LOCKED rule 6: owner product decision + per-feature QA + welfare-check)
- [ARMED 2026-06-25] session service-suspend — `service_suspend_gate()`==**true** (QA passed: running-service
  exact-restore + UAC-cancel=no-partial + critical-blocked; owner sign-off) + selection UI in `GamingMode.tsx`.
  Boundary re-verified clean (no new IPC/capability; production elevation untouched). ✅ shipped in the 2026-06-26 rebuild
  (NSIS `512DAFF3…`) — NOTE (2026-06-27): installer superseded since; reinstall is Claude's job (silent-reinstall law), not an owner action. Current installer + live state → `docs/RELEASE_STATE.md`.
- [ARMED 2026-06-26] telemetry scheduled-task disable (debloat) — `bloat_removal_gate()`==**true** (QA passed:
  exact disable→enable restore + UAC-cancel=no-partial + off-list/Defender rejected; owner curated list = all 3 +
  sign-off "run all 3") + Fix-surface UI (`DebloatTasks`, reversible via Trust Ledger). ✅ shipped in the 2026-06-26 rebuild
  (NSIS `512DAFF3…`) — NOTE (2026-06-27): installer superseded since; reinstall is Claude's job (silent-reinstall law), not an owner action. Current installer + live state → `docs/RELEASE_STATE.md`.
- [⛔ WALLED 2026-07-01] GPU profile apply (AMD) — **blocked by rollback-first (LOCKED rule 3).** AMD GPU
  profile state (Anti-Lag/Enhanced-Sync/Tessellation/Sharpening) is NOT user-mode readable (lives in
  Adrenalin's private store; registry exposes only `*_component_na` capability flags — see
  [[detection-feasibility-walls-usermode]]). `amd_freesync.rs` ADLX FFI is read-only (FreeSync), no write path.
  Can't snapshot the true prior → must REFUSE per [[mutation-snapshot-failsafe-idiom]], not apply. Only `KMD_Chill*`
  is readable (low-value, driver-fragile). Excluded unless a full vendor-SDK write+read path is built (big project).
- [BUILT-DARK 2026-07-06] bloat removal → **preload-app removal** — owner nod given 2026-07-06 after a scope
  discussion (spec `docs/superpowers/specs/2026-07-06-preload-app-removal-dark.md`): the `HKCU\Run` DELETION half
  was **dropped** (the reversible startup disable already ships — `set_startup_entry_enabled`, same flag Task
  Manager flips; deleting the leftover line buys tidiness at real rollback cost) and the buildable half is
  **per-user UWP preload-app removal**, now built dark: `KnownPreloadApp` typed allowlist (4-app starter set,
  Store-published + no-user-data rules; Clipchamp/To Do excluded as data-adjacent; **Spotify cut by owner
  curation 2026-07-06** — same package id as a real install, no honest "stub" framing), `preload_removal_gate()`==false,
  snapshot-or-refuse apply (live PackageFullName/FamilyName/Version read, verified-gone re-read), two-tier honest
  undo (silent re-register verified by re-read, else Store-page hand-off returns Err so the ledger entry stays
  active), gated `remove_known_preload_app` + read-only `get_preload_apps`, dark-safe `PreloadApps` Fix card
  (renders nothing while dark, test-pinned). **Arming rides its own gate:** live QA harness
  (`qa_remove_then_reinstall_round_trip`, #[ignore]) + Store ProductId link-verification + owner curates the final
  list + explicit sign-off.
- [~] one-click re-apply — **SPLIT (audit 2026-08-03), because the single `[~]` read as one
  half-built thing and it is two separate states.** ① **batch-apply primitive: DONE + guarded** —
  `apply_recommendations_batch`, IPC-registered, invoked from App; parity guard
  `src/appliable-parity.test.ts` pins the FE/BE `APPLIABLE_REC_IDS` lists against drift.
  ② **a dedicated "re-apply everything that drifted" button: NOT BUILT** — only per-item re-apply
  exists. Original note: `apply_recommendations_batch` (`history.rs:528`,
  validates `APPLIABLE_REC_IDS`, single-consent + ONE UAC) wired at `App.tsx:772` on the QA-closed apply path.
  A dedicated "re-apply everything that drifted off in one click" button would be a small UI add on top if wanted.
- Gaming Mode (F1) — built, **gate still false**; needs physical-reboot QA + owner sign-off.
- [x] `--run-elevated` boundary-side guard (defense-in-depth, owner-approved 2026-07-14) — **SHIPPED
  2026-07-15.** Chosen lock: a ONE-TIME dispatch ticket over the HMAC option (no crypto dep, nothing
  secret to steal, stronger one-shot semantics). `run_elevated_powershell` mints a ticket file
  (`%APPDATA%\Compy\runtime\elev-<pid>-<seq>.ticket`, content = the exact command hex) and passes its
  path as a third argv (`mint_elevation_ticket` `actions.rs:1149`); the helper refuses any hex that
  doesn't byte-match the ticket (exit 3, runs ZERO PowerShell) and consumes it before running
  (`consume_elevation_ticket` `actions.rs:1171`, `run_elevated_helper` `lib.rs:69`, argv `main.rs:12`)
  — so a dispatch executes at most once and replay is dead. Exact-match against what the parent just
  minted ⇒ can never false-reject a legitimate apply (every builder passes by construction — the hard
  requirement). Honest attribution kept: mint failure = third pre-launch nothing-ran refusal
  (`elevation_error_nothing_ran`); exit 3 reads approved-but-failed; decline path cleans the ticket up.
  Guard tests both directions incl. end-to-end helper refuse/replay (cargo 724/0, clippy clean).
- [ ] **"Optimization Cleanup"** (name locked by the owner) — find + classify the residue OTHER tools/guides
  left behind (registry keys, services, scheduled tasks, orphaned tweak-pack artifacts) as
  useful / placebo / risky / outdated / unknown, and offer restore ONLY where the prior/default is
  unambiguous. **Own spec'd train: research → spec → scope-gate — never a same-session build.**
  Mutation-adjacent ⇒ full mutation-gate before any apply path exists. ~~restores ride a SEPARATE
  recovery-snapshot mechanism~~ — **fork RESOLVED by the owner 2026-07-16: restores REUSE the
  Trust Ledger** (provenance `leftover_adopted`, already built) — one rollback story, one audited
  persistence path; a second snapshot store would duplicate the H1/atomic-save machinery and
  fragment "undo everything" across two ledgers.
  Distinct from UI_VISION_BACKLOG §F (upgrade-path engine) — different feature, don't conflate.
  Provenance: panel-review brief 2026-07-15 §4.1 (`docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`)
  + archived review (`docs/reviews/2026-07-15-consumer-panel-review.md`).
  **Research stage DONE, 2026-07-16 (Cowork):** spec at
  `docs/superpowers/specs/2026-07-16-optimization-cleanup-research-spec.md`. **Headline finding: this
  is mostly already built.** `leftovers.rs` (9 detectors) ships live read-only today; 7 of 9 already
  have typed rollback resolvers built + fixture-tested in `actions.rs`, dark only behind
  `restore_gate()==false` + no Tauri command registration (Leftovers v2, `docs/superpowers/specs/
  2026-06-11-leftovers-v2-dark-wave2.md`). Genuinely new: broader detection (registry/service/
  scheduled-task residue beyond the 9 curated settings), a formal 5-bucket taxonomy, and — the one
  real architectural fork — this BACKLOG entry said restores need a "SEPARATE recovery-snapshot
  mechanism," but the already-built dark path reuses the Trust Ledger with a `provenance` tag
  instead (fork RESOLVED to reuse — owner 2026-07-16, see above). Phasing per the spec:
  **Phase 0 SHIPPED 2026-07-16 (`55f68b6`)** — read-only audit live as a first-class Check section
  under the locked name. **Phase 1 SHIPPED 2026-07-16** — full mutation-gate run: owner-present
  live-UAC QA (W32PS/MPO/memcompress loops ALL PASS, memcompress scripts made state-aware),
  `restore_gate()` armed + `restore_leftover` registered, armed-world tests, QA receipts cleaned
  (owner call). Backend-only — no FE restore button yet; that UI is its own later train.
  **Remaining (still not scope-gated — not authorized to build):** Phase 2 (5-bucket taxonomy) →
  Phase 3 (net-new detection surface: registry/service/scheduled-task residue beyond the 9 curated
  settings; candidate detectors from Phase 1 QA: prefetch-sibling flags off, SysMain disabled).
  **Intelligence-platform relationship (2026-07-17, directive §0.11/§9):** Cleanup stays its OWN
  lane on its own mutation-gate discipline — never folded into intelligence trains — AND is a data
  source for the platform (external drift in Compy-managed settings + tweak-pack residue surface as
  timeline events); its Phase 2 taxonomy reuses the shipped real/placebo/risky vocabulary, which is
  the same grading language the intelligence layer must use. (These are Cleanup Phase numbers, not
  Intelligence Phase numbers — see the 🧠 lane's namespace rule.)

## PHASE C — Outbound capabilities 📡 (separate gates; each ships DARK before arming)
- [ ] **Tier 1 signed case knowledge** — owner-approved direction under #91; new Rust-side advisory
  module, separate trust domain, signed download only, local match, no machine-data upload.
- [BUILT-DARK] **Tier 2 precursor: Receipts** opt-in consent UI + payload preview —
  `receipts.rs`, `ReceiptsConsent.tsx` (gate off; no transport).
- [ ] **Tier 2 scrubbed incident fingerprint** — separate spec/consent/schema/retention gate; not
  authorized by Tier 1.
- [ ] **Tier 3 explicit case evidence upload** — separate per-case preview/redaction/recipient/
  retention/deletion gate; never background or inherited consent.
- [ ] bufferbloat/speed-test send · jitter/packet-loss · session network telemetry · A/B preset
  efficacy · ISP/ZIP lookup — each still needs its own exception record; no blanket Phase C unlock.

## PHASE D — Money / distribution 🔒 (owner territory — DEFERRED per current 1.0 focus)
- [BUILT-DARK] License / Pro gate scaffolding — `license.rs`, `ProGate.tsx`, `pro.ts`
- [ ] affiliate tag-swap · compy.gg waitlist funnel · Receipts arming · leaderboard · Pro multi-rig · B2B
- [PARKED] **Shop Report Mode** — B2B evidence workflow for repair/optimization shops (pilot scope when
  unparked: job name → before scan → approved changes → after scan → rollback availability → signed
  export). Logged for traceability ONLY — do NOT build ahead of B2B traction (MONETIZATION_PLAN Layer 4
  posture: "no page until you ask"); the Shop render tier of the A2 evidence-export item defers here.
  Provenance: panel-review brief 2026-07-15 §4.7.
- Funnel go-live mechanical steps parked in `docs/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md` (owner-initiated).

---

> **✅ Phase-A closure (verified 2026-07-01):** no unchecked, non-gated, cleanly-buildable Phase-A `[ ]` item remains — the 5 open rows are all gated/walled: safe-to-suspend data (owner-curated) · peripheral debounce/Snap-Tap/Rapid-Trigger *detection* + sensor-ID DB (user-mode firmware-read wall, same class as DPI/line 355) · ISP-speed + DNS probes (📡 outbound-gated). Remaining VALUE is Phase B/C/D (gated). Supersedes the stale "Bottom line" below.

> **Bottom line (2026-06-23)** — superseded by the Phase-A closure note above; moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).
