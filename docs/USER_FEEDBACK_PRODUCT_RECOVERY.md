# USER FEEDBACK — PRODUCT RECOVERY TRUTH MATRIX

> **Canonical ledger for the product-recovery train** (owner-authorized 2026-07-28).
> Branch `feat/user-feedback-lab-recovery`, worktree `C:\Users\Kuya\code\sentinel-feedback`, base `9caf2c5` (= `origin/main`).
> This file is committed BEFORE major implementation so the requirements cannot disappear during
> context compaction or a session change. **It is the requirements source of truth for this train** —
> where a later doc, spec, or banner disagrees about what the feedback ASKED FOR, this file wins.

**Governing question (the acceptance test for the whole train):**
> *Can a non-technical gamer understand what Compy found, know what to do next, act safely, and
> verify whether it helped — without first learning how Compy is organized?*

If the answer is no, the experience is not complete — regardless of green tests.

**The correction that opened this train:** the `v0.9.11` release pipeline is complete; the **product
experience is not**. The Lab does not meet the intended standard and recent user feedback has not
been addressed deeply or literally enough. This train outranks Intelligence Phase expansion,
speculative features, and further release hardening.

---

## Hard boundaries for this train (do not cross)

Do NOT: merge to `main` · modify `C:\Users\Kuya\code\sentinel-rel` · move or create release tags ·
prepare or publish a release · distribute a development installer to testers · change the
production-default Lab implementation · permanently delete the current canonical Lab · arm gated
remote / telemetry / removal / licensing features · declare the redesign accepted without owner
eyeball review. **Stop at the installed-build owner-review boundary.**

Also: no new mutation path (every change keeps flowing through the existing audited apply/history/
rollback boundary) · no fabricated FPS / latency / temperature / stability numbers · no lockfile
churn · no modification of other worktrees.

**Out of scope (named exclusions):** Intelligence Phase 4 knowledge graph · Phase 5 Upgrade Advisor ·
crowd intelligence · Receipts arming · remote rules / remote fetch · preload-removal arming ·
licensing / paid tiers · legal · code signing · release-pipeline changes · new backend mutation
primitives · unsupported hardware tuning. Existing intelligence may be *surfaced* where it directly
improves the journey; the platform does not expand in this train.

---

## Status legend

| Status | Meaning |
| --- | --- |
| `UNRESOLVED` | Nothing in the shipped product addresses it. |
| `PARTIAL` | Something exists but the complete user journey still fails. |
| `RESOLVED` | Shipped, and the full journey verified end-to-end. |
| `UNVERIFIED` | Believed fixed, but no evidence of the complete journey exists (live-only, or test-debt). |

**Rule 18 applies to every row:** an item is NOT resolved because a related control exists somewhere
else in the app. The complete journey must be verified.

---

## §0 — ESTABLISHED CURRENT TRUTH (verified in code, not inferred from banners)

This section is the factual base the matrix rests on. Every claim below was read out of the working
tree at `9caf2c5`, not taken from a spec or a "shipped" banner.

### 0.1 Which Lab face users really receive

| Link in the chain | Evidence |
| --- | --- |
| `App.tsx:37,565` imports + calls `useLabGroundFlag()` | `src/App.tsx:37`, `src/App.tsx:565` |
| the hook reads `compy_lab_ground` with the graduated-default convention | `src/design/theme.ts:268-270` — `LAB_GROUND_KEY = "compy_lab_ground"`, `readLabGround()` returns `localStorage.getItem(KEY) !== "0"` → **DEFAULT ON** |
| flag ON → `App` renders `<LabGround>` for the Lab tab | `src/App.tsx:1682` |
| `LabGround` is a thin shell: room verdict + `<LabConsole>` + `<ExperimentBench>` | `src/surfaces/LabGround.tsx:102-113` |
| `LabConsole` is the six-station Ops Console with the `Dock` | `src/surfaces/LabConsole.tsx:188,337-364` |

> **CONCLUSION: the runtime-default Lab face is `LabConsole` (reached through `LabGround`).**
> `LabV2` → `Lab.tsx` is the `compy_lab_ground="0"` failsafe only (`src/App.tsx:1710`).
> **`LabBento` is NOT imported by `App.tsx` at all — it is an orphaned generation.**
> This is the "six-station mega-room" named by owner item 13 and the overload of tester item 10.

### 0.2 The Check → Optimize seam as it exists today

- `FirstCheck.tsx:279-298` renders a `Take me to the Lab` button **only when the `onGoToLab` prop is
  passed**, i.e. only in the first-run arc.
- `App.tsx:1376` writes `localStorage["compy_lab_open_station"] = "optimize"` then navigates.
- `LabConsole.tsx:201-202` reads that key on mount, clears it, and opens the Optimize station.
- **No recommendation identity travels across the seam.** The destination cannot highlight, order, or
  acknowledge what Check actually found, because nothing was carried.

### 0.3 Root cause of the "N safe tweaks not applied" dead end

- `src-tauri/src/priorities.rs:265-290` (Rule 8) builds one **aggregate** `PriorityItem`:
  `title = "{n} safe {tweak|tweaks} not applied"`, `linked: None`, and the real tweak titles only
  ever appear inside free-prose `reason`, **capped at 4** by `.take(4)` (`priorities.rs:266-270`).
- `PriorityItem` has no field capable of carrying a list of rec IDs
  (`priorities.rs:29-37`; TS mirror `src/types.ts:75`).
- `FirstCheck.tsx:57-62` `recFor()` computes `lim.linked ?? lim.id` → `"pending-safe-recs"` → matches
  no recommendation → returns `null`.
- Consequence at `FirstCheck.tsx:236-240`: the expanded row renders the **factually wrong** chip
  *"Hands-on fix — no switch to flip, but Compy shows you the steps"* for tweaks that are, in fact,
  one-click appliable. The user is told to do it by hand when Compy can do it.

> **Items 2, 4 and 5 are ONE structural defect, not three copy problems.** The data contract cannot
> express what the UI needs to say. Fixing the wording without fixing the contract would be exactly
> the "smaller cosmetic change" owner item 17 forbids.

### 0.4 The shipped "Needs your call" door (preserve, do not rebuild)

`src/surfaces/Fix.tsx:614-712` `GuidedRow` — the whole card head is
`<button className="fix-row-head fix-advisory-door" aria-expanded={open}>` with a chevron; an
always-visible `fix-advisory-quickacts` row carries *What's this* + *Not for me*; `fix-guided-actions`
carries `How to → {guide.where}` and an optional `Open it →` deep link; and an `{open && !guide}`
branch **always answers** with `optimize.fix.noSafeSwitchNote` so a door never opens onto nothing.
This satisfies the doorknob law. **Its regression guard does not exist** — `docs/BACKLOG.md:50-51`
records the test-debt in the owner's own ledger: *"a DOM guard for the door behavior is NOT yet
written (live-verified only) — add to `optimize-v2-ia.test.tsx` next pass."*

### 0.5 Other worktrees (read-only safety check — nothing was modified)

| Worktree | Branch / HEAD | Uncommitted | Collides with this train? |
| --- | --- | --- | --- |
| `C:\Users\Kuya\code\sentinel` | `release/v0.9.9-candidate` @ `d000295` | `M CLAUDE.md`, `?? src-tauri/CLAUDE.md` | No |
| `C:\Users\Kuya\code\sentinel-rel091` | @ `5d396f9` | `M src-tauri/Cargo.lock` | No |
| `C:\Users\Kuya\code\sentinel-codex-hygiene` | clean | — | No |

---

## §1 — THE 18 ITEMS

Source of the literal tester wording: `docs/BACKLOG.md:28-69` (tester reviews 2026-07-22, J +
Matthew, on the **0.9.0** build — note `docs/RELEASE_STATE.md` `tester_distributed_version=0.9.0`,
so testers have NOT seen the v0.9.5–v0.9.11 fixes; some items may be *shipped-but-unconfirmed* by the
people who raised them). Source of the owner direction: `docs/UI_VISION_BACKLOG.md:25-94`.

---

### ITEM 1 — Post-check landing feels directionless

- **Feedback (retained wording):** *"J: post-check routing — landing on the dashboard after a check
  feels directionless; add a second CTA ('take me to the lab') that opens the Lab's Optimize tab
  directly."* (`docs/BACKLOG.md:44-45`)
- **User problem:** the check ends with information and no destination. The user has just been told
  something is wrong and is returned to a general dashboard with no path to the place where it is
  fixed.
- **Current implementation:** `FirstCheck.tsx:279-298` — a `Take me to the Lab` CTA exists **only in
  the first-run arc** (rendered only when `onGoToLab` is passed). The re-run Check surface has no
  equivalent. `App.tsx:1371-1383` performs the navigation.
- **Status:** `PARTIAL`
- **Intended correction:** the post-check destination CTA must exist on **every** path that produces
  a check verdict (first run AND re-run), must route through the normal room navigation, and must
  carry what was found (see item 4).
- **Affected files/flows:** `src/surfaces/FirstCheck.tsx` · `src/surfaces/Check.tsx` ·
  `src/App.tsx` (nav + handoff write) · `src/surfaces/LabConsole.tsx` (handoff read).
- **Acceptance criteria:** from a settled verdict on both surfaces, one visible primary action leads
  to the Optimize destination; the destination opens on the exact findings; browser/room back
  behavior remains understandable; nothing is applied by navigating.
- **Class:** structural
- **Evidence after implementation:** _(pending)_

---

### ITEM 2 — "1 safe tweak not applied" names a count, not the tweak

- **Feedback (retained wording):** *"J: '1 safe tweak not applied' is a dead end — post-check verdict
  names a count but not the tweak; add a dropdown/expand showing WHICH tweak + apply/ignore inline."*
  (`docs/BACKLOG.md:42-43`)
- **User problem:** a count is not actionable. The user cannot judge relevance, risk, or effort, and
  cannot decide anything from it.
- **Current implementation:** `priorities.rs:265-290` emits the aggregate with `linked: None`; the
  real titles live only in prose `reason`, `.take(4)`-capped. `FirstCheck.tsx:205-247` added an
  expandable row (the earlier partial fix) but `recFor()` (`FirstCheck.tsx:57-62`) returns `null` for
  the aggregate, so the expansion shows the reason prose and the **wrong** "Hands-on fix" chip.
- **Status:** `PARTIAL` — and the partial fix currently states something untrue (see §0.3).
- **Intended correction:** carry stable recommendation IDs in the payload. Each finding renders with
  real data: name · what Compy detected · why it matters on THIS rig · current state · recommended
  state · reversibility/risk · whether Compy can apply it directly · the correct available action.
  **No fabricated FPS/latency/temp/stability numbers. Do not infer recommendation identity from
  display prose.**
- **Affected files/flows:** `src-tauri/src/priorities.rs` (Rule 8 + `PriorityItem`) ·
  `src/types.ts:75` · `src/surfaces/FirstCheck.tsx` · `src/surfaces/Check.tsx` ·
  `src/surfaces/use-scan.ts`.
- **Acceptance criteria:** with exactly one pending safe tweak, the verdict names that tweak and
  offers its correct action; with several, every one is named and identity is preserved; the
  "Hands-on fix" chip appears only when the rec genuinely has no safe switch.
- **Class:** functional + structural (copy is downstream)
- **Evidence after implementation:** _(pending)_

---

### ITEM 3 — The Check result needs a direct path into Lab → Optimize

- **Feedback (retained wording):** covered by the same J note as item 1 — *"…add a second CTA ('take
  me to the lab') that opens the Lab's Optimize tab directly."* (`docs/BACKLOG.md:44-45`); owner
  direction in `docs/UI_VISION_BACKLOG.md` NAV-1: *"the check's output and the fix's door live in
  different rooms with no hallway. The fix class is a routed hand-off (check verdict → deep link into
  Lab→Optimize with the found items highlighted), not more UI."*
- **User problem:** the finding and the fix live in different rooms with no hallway between them.
- **Current implementation:** the `compy_lab_open_station` localStorage deep link
  (`App.tsx:1376` → `LabConsole.tsx:201-202`) opens the Optimize station. It is a **string flag with
  no payload**, only written from the first-run arc.
- **Status:** `PARTIAL`
- **Intended correction:** replace the bare string flag with a **durable typed handoff contract**
  (not DOM querying, not text matching) that carries the exact recommendation IDs and the context of
  the check; consume it in the Optimize destination. Route through normal navigation — the
  navigation-never-teleports law (`DESIGN.md:117`) holds.
- **Affected files/flows:** new handoff module · `src/App.tsx` · `src/surfaces/FirstCheck.tsx` ·
  `src/surfaces/Check.tsx` · `src/surfaces/LabConsole.tsx` · `src/surfaces/lab/OptimizeStation.tsx`.
- **Acceptance criteria:** the contract is typed and versioned; a malformed/absent payload degrades
  to today's plain "open Optimize" behavior; back navigation stays sane; nothing auto-applies.
- **Class:** structural
- **Evidence after implementation:** _(pending)_

---

### ITEM 4 — The exact recommendations must stay visible and prioritized after the handoff

- **Feedback (retained wording):** owner/NAV-1 direction — *"deep link into Lab→Optimize **with the
  found items highlighted**"* (`docs/UI_VISION_BACKLOG.md` NAV-1 (1)).
- **User problem:** arriving at a full workspace after a check, the user has to re-find what they
  were just told about. The check's work is discarded at the door.
- **Current implementation:** none — the handoff carries no identity (§0.2). The Optimize station
  renders its standard grouping with no arrival context.
- **Status:** `UNRESOLVED`
- **Intended correction:** the destination prioritizes/highlights the exact carried IDs and
  acknowledges context (e.g. *"Compy found these during your check"*), without silently applying
  anything and without dumping the user at the top of the Lab.
- **Affected files/flows:** `src/surfaces/lab/OptimizeStation.tsx` · `src/surfaces/Fix.tsx` ·
  the handoff module.
- **Acceptance criteria:** defined behavior for **all seven** cases — one found · several found · a
  finding gone stale before arrival · already applied · not automatically appliable · a later
  revisit of the Lab (context must not haunt the room forever) · nothing actionable found.
- **Class:** functional + structural
- **Evidence after implementation:** _(pending)_

---

### ITEM 5 — Every recommendation needs an understandable apply / guided / ignore / not-for-me path

- **Feedback (retained wording):** J's inline ask — *"add a dropdown/expand showing WHICH tweak +
  apply/ignore inline"* (`docs/BACKLOG.md:42-43`) — plus the shipped-door precedent for the
  no-safe-switch case (`docs/BACKLOG.md:48-51`).
- **User problem:** a card the user cannot act on teaches them the section is dead. A card that
  offers the WRONG action (§0.3) is worse — it lies about what Compy can do.
- **Current implementation:** the audited path exists in `Fix.tsx` (one-click `TrustSwitch` rows,
  `GuidedRow` doors at `Fix.tsx:614-712`, `Not for me` dismiss). `FirstCheck.tsx:228-240` picks the
  wrong branch for the aggregate.
- **Status:** `PARTIAL`
- **Intended correction:** expose audited direct action where it exists; where Compy cannot safely
  apply, open the **real** guided steps and say why manual action is required; always retain
  *Ignore* / *Not for me*; never leave a dead-end card. **No new mutation path — everything continues
  through the existing audited apply / history / rollback boundary** (LOCKED rule 3).
- **Affected files/flows:** `src/surfaces/FirstCheck.tsx` · `src/surfaces/Check.tsx` ·
  `src/surfaces/Fix.tsx` · `src/surfaces/lab/OptimizeStation.tsx`.
- **Acceptance criteria:** for each surfaced finding the offered action matches its real capability
  (verified against `isAppliable` / `GUIDED_STEPS`, never guessed from prose); a manual-only finding
  opens its real guide; dismissal remains available everywhere a finding is shown.
- **Class:** functional
- **Evidence after implementation:** _(pending)_

---

### ITEM 6 — "Needs your call" cards: preserve the shipped door, add the missing guard

- **Feedback (retained wording):** *"J: 'Needs your call' cards not interactive — ✅ SHIPPED
  v0.9.6+v0.9.7: whole card head is a door (chevron, hover accent), opens the guided steps or an
  HONEST no-switch answer… **Test-debt:** a DOM guard for the door behavior is NOT yet written
  (live-verified only) — add to `optimize-v2-ia.test.tsx` next pass."* (`docs/BACKLOG.md:48-51`)
- **User problem:** originally — clicked the card, nothing happened, concluded the whole section was
  dead. Now — the fix is real but unprotected; a future refactor can silently re-break it.
- **Current implementation:** `Fix.tsx:614-712` `GuidedRow` (§0.4). No DOM/interaction test covers
  it. `optimize-v2-ia.test.tsx:143,159` only assert the *presence/absence of the section label*.
- **Status:** `UNVERIFIED` (shipped + live-verified via CDP; no regression guard)
- **Intended correction:** add the DOM/interaction guard. Cover: mouse activation opens · keyboard
  activation opens (Enter/Space on the head) · visible focus · `aria-expanded` chevron/expanded state
  tracks reality · the no-guide case still answers (no door onto nothing) · actions are not hidden
  inside ambiguous card regions.
- **Affected files/flows:** `src/surfaces/optimize-v2-ia.test.tsx` (per the owner's own note) ·
  `src/surfaces/Fix.tsx` (no behavior change intended).
- **Acceptance criteria:** the guard fails if the head stops being a button, if `aria-expanded` stops
  tracking, or if the `{open && !guide}` honest answer is removed.
- **Class:** functional (test coverage)
- **Evidence after implementation:** _(pending)_

---

### ITEM 7 — Cursor behavior is inconsistent across the application

- **Feedback (retained wording):** *"J: cursor consistency — native Windows cursor appears over
  sidebar items + some buttons (Monitor 'Overlay', 'Start Capture') instead of the Compy reticle
  cursor; keep ONE cursor."* (`docs/BACKLOG.md:40-41`)
- **User problem:** the pointer changing identity between regions reads as breakage, not style.
- **Current implementation:** `compy_hud_frame` (DEFAULT ON) mounts a shell-scoped global reticle,
  with stage-level `ReticleCursor` instances self-deferring (`LabConsole.tsx`). Coverage across
  surfaces is under audit (background inventory pending).
- **Status:** `UNRESOLVED`
- **Intended correction:** decide **one** cursor — consistent standard Windows pointer **or** the
  existing Compy reticle applied everywhere. **Do not invent a third cursor.** Apply it consistently
  to navigation, buttons, cards, expandable rows, graph interactions, drag zones, disabled controls,
  text inputs, and resize areas. Document the choice.
- **Affected files/flows:** `src/design/console/ReticleCursor` · `src/design/tokens.css` and surface
  CSS · every surface with a custom `cursor:` rule.
- **Acceptance criteria:** a regression guard proves no surface reintroduces a competing cursor rule;
  disabled controls and text inputs use their correct (distinct, standard) affordance in either
  direction of the decision.
- **Class:** visual + functional
- **Evidence after implementation:** _(pending)_

---

### ITEM 8 — The square Compy reticle feels strange to at least one tester

- **Feedback (retained wording):** *"(Matthew separately finds the square crosshair 'a little weird'
  — treat as one cursor pass.)"* (`docs/BACKLOG.md:40-41`)
- **User problem:** a custom cursor is a constant, unavoidable piece of UI. If it reads as odd, it
  taxes every single interaction.
- **Current implementation:** the reticle is on by default via `compy_hud_frame`.
- **Status:** `UNRESOLVED`
- **Intended correction:** resolved **together with item 7 as one decision**. Because a tester found
  the square crosshair strange, **prefer the least surprising consumer behavior unless the
  established design doctrine provides a strong and current reason otherwise.** Record the reasoning
  either way; this is a taste-adjacent call and the owner reviews it on the installed build.
- **Affected files/flows:** same as item 7.
- **Acceptance criteria:** one documented decision, applied consistently, reviewable by the owner on
  the installed candidate.
- **Class:** visual
- **Evidence after implementation:** _(pending)_

---

### ITEM 9 — Orientation must be inherent in layout and controls, not in explanatory copy

- **Feedback (retained wording):** NAV-1 audit finding — *"Orientation lives in copy, not chrome."*
  (`docs/UI_VISION_BACKLOG.md` NAV-1 (3)); owner standing directive: *"intuitive UI capability should
  be way more inherintly comprehensive this is a very very very important note ive made many times."*
  (`docs/UI_VISION_BACKLOG.md:25-40`)
- **User problem:** users who skip onboarding (most of them) are permanently disoriented, and the
  information that would orient them is buried in a screen they already dismissed.
- **Current implementation:** room identity is carried substantially by masthead/verdict prose; the
  Lab's six peer stations do not encode an order of operations.
- **Status:** `UNRESOLVED`
- **Intended correction:** encode orientation in structure — hierarchy, grouping, one visible
  navigation grammar, an above-the-fold answer to *"what do I do here?"*. **Do not solve orientation
  by adding more introductory paragraphs.**
- **Affected files/flows:** the Lab candidate IA (Phase 3) · `src/design/room-shell` ·
  `src/design/homeRail.ts`.
- **Acceptance criteria:** a first-time user can state what the room is for from layout alone; no new
  explanatory paragraph is required to make the room legible.
- **Class:** structural + visual
- **Evidence after implementation:** _(pending)_

---

### ITEM 10 — The Lab still feels overloaded and insufficiently clear

- **Feedback (retained wording):** owner correction opening this train — *"The Lab still does not
  feel up to the intended standard"*; tester-side context in `docs/BACKLOG.md:28-31` (J praised the
  0.9.0 build as "more organized, less overwhelming" — that was the *previous* generation, not the
  current six-station console).
- **User problem:** six peer stations presented at equal weight force the user to learn Compy's
  module structure before they can act.
- **Current implementation:** `LabConsole.tsx` — a `Dock` of six equal stations (optimize,
  diagnostics, benchmark, latency, tuning, blackbox) over a 3D stage with four arc gauges; exactly
  one panel open at a time.
- **Status:** `UNRESOLVED`
- **Intended correction:** Phase 3 — rebuild the Lab around the user's decision journey:
  *What did Compy find? → What should I do first? → Why is it relevant to my PC? → Can Compy do it
  safely? → How can I prove whether it helped?*
- **Affected files/flows:** the whole Lab surface tree.
- **Acceptance criteria:** the first viewport answers "is anything worth changing / what is the
  highest-value justified action / why / is it safe and reversible / can Compy do it / what happens
  if I do nothing"; instruments are reachable but not co-equal front doors.
- **Class:** structural + visual
- **Evidence after implementation:** _(pending)_

---

### ITEM 11 — Organization, consolidation, ease of access and intuitive navigation outrank spectacle

- **Direction (retained wording):** *"we need to look way more in depth in how to consolidate and
  neatly compact everything without overcomplicating or sensory overloading anything throughout the
  UI we need to focus way more on organization and ease of access navigational implementations."*
  (`docs/UI_VISION_BACKLOG.md:25-40`, owner 2026-07-23)
- **User problem:** impressive surfaces that are hard to navigate produce admiration, then abandonment.
- **Current implementation:** the Ops Console leads with stage/gauges/3D; the working content sits in
  a single dock-opened panel.
- **Status:** `UNRESOLVED`
- **Intended correction:** function first in the build order — IA and skeleton validated **before**
  the premium visual layer (Phase 3 prototype discipline).
- **Affected files/flows:** Phase 3 candidate.
- **Acceptance criteria:** the skeleton is judged usable at 1280×720 with realistic data density
  before any visual polish is applied.
- **Class:** structural
- **Evidence after implementation:** _(pending)_

---

### ITEM 12 — The Lab must feel premium, futuristic and comprehensive without becoming overwhelming

- **Direction (retained wording):** owner train brief — premium, futuristic, evidence-based,
  responsive, calm, coherent with the approved Compy shell, approachable, **useful before impressive**.
- **User problem:** the two goals are in tension and the current build resolved the tension toward
  spectacle.
- **Current implementation:** hologram stage, arc gauges, pointer glow, reticle.
- **Status:** `UNRESOLVED`
- **Intended correction:** permitted where they serve function — depth, parallax, controlled 3D,
  meaningful motion, interactive graphs, data-driven transitions, strong instrumentation. Avoided —
  decorative telemetry with no decision value, dense sci-fi dashboards, tiny labels, excessive cards,
  repeated headings, unclear custom controls, multiple simultaneous focal points, motion that
  obscures hierarchy, and *"another visual concept that tests well synthetically but fails the
  installed eyeball test."*
- **Affected files/flows:** Phase 3 visual layer.
- **Acceptance criteria:** one focal point per viewport; every animated element carries decision
  value; reduced-motion honored; the owner's installed eyeball review passes.
- **Class:** visual
- **Evidence after implementation:** _(pending)_

---

### ITEM 13 — The six-station mega-room is not the desired final direction

- **Direction (retained wording):** owner train brief, verbatim: *"The current six-station mega-room
  does not represent the desired final product direction."*
- **User problem:** six co-equal doors is a module map, not a journey.
- **Current implementation:** `LabConsole.tsx` `STATION_ICON` / `Dock` — optimize · diagnostics ·
  benchmark · latency · tuning · blackbox, all peers.
- **Status:** `UNRESOLVED`
- **Intended correction:** the five-section journey IA — (1) Your next best move · (2) Optimize as
  the primary workspace grouped by user goals · (3) Measure and prove · (4) Diagnose a problem, by
  user problem · (5) Advanced instruments behind progressive disclosure.
- **Affected files/flows:** `src/surfaces/LabConsole.tsx` · `src/surfaces/lab/*` · Phase 3 candidate.
- **Acceptance criteria:** no six-peer-station overload; instruments remain reachable and honest
  about vendor-unsupported availability.
- **Class:** structural
- **Evidence after implementation:** _(pending)_

---

### ITEM 14 — Parallel Lab generations and navigation grammars create drift and confusion

- **Direction (retained wording):** NAV-1 — *"Parallel UI generations coexist behind flags — Home has
  4+ faces, Monitor 4, Lab 5 (classic/V2/Bento/Console/Ground)… Candidate: a pruning pass — bless one
  face per room, delete or archive the rest."* (`docs/UI_VISION_BACKLOG.md` NAV-1 (2); owner
  delegated the call 2026-07-23: newest shipped face per room is the bless candidate.)
- **User problem:** indirect but real — every parallel generation splits testing, guards, and design
  attention, and produces surfaces that disagree with each other.
- **Current implementation (verified §0.1):** `LabGround`→`LabConsole` is default; `LabV2`→`Lab` is
  the failsafe; **`LabBento` is imported by nothing.**
- **Status:** `UNRESOLVED`
- **Intended correction:** Phase 4 — full inventory + a deletion/migration plan. **Do not create
  another permanent Lab variation.** A temporary development flag for owner comparison is acceptable;
  the intended end state is **one canonical Lab, not six**. **Do not delete the current
  production-default Lab or its rollback path during this train.**
- **Affected files/flows:** all Lab generations + their tests, flags, and settings entries.
- **Acceptance criteria:** the plan names, per generation: reachability · unique functionality ·
  where that functionality lives in the candidate · tests to migrate · flags/settings to retire ·
  files eligible for later deletion · anything that cannot yet be removed and why.
- **Class:** structural
- **Evidence after implementation:** _(pending — Phase 4 section below)_

---

### ITEM 15 — The redesign must follow the user's decision journey, not the module structure

- **Direction (retained wording):** owner train brief — the required IA flow is
  *What did Compy find? → What should I do first? → Why is it relevant to my PC? → Can Compy do it
  safely? → How can I prove whether it helped?*
- **User problem:** today the user must learn that "latency" and "blackbox" are separate subsystems
  before they can find the thing that answers their question.
- **Current implementation:** stations are named after Compy's internal modules.
- **Status:** `UNRESOLVED`
- **Intended correction:** goal-named groups (More FPS · Lower latency · Stability · Image quality ·
  Cleanup and recovery) and problem-named diagnostics routes (Stutter · Crashes or freezes ·
  Inconsistent FPS · Input delay · Thermal concerns · Something changed unexpectedly). A group renders
  **only** when real supported recommendations exist behind it.
- **Affected files/flows:** Phase 3 candidate · `src/surfaces/lab/*` data modules.
- **Acceptance criteria:** every visible group maps to real catalog content; no empty scaffolding;
  recommendation→proof relationships come from structured data only — **do not parse free prose into
  a fake test mapping.**
- **Class:** structural
- **Evidence after implementation:** _(pending)_

---

### ITEM 16 — Literal user feedback outranks Intelligence Platform expansion during this train

- **Direction (retained wording):** *"This train takes priority over Intelligence Phase expansion,
  speculative features, or additional release hardening."*
- **User problem:** platform depth the user cannot reach does not improve the experience.
- **Current implementation:** N/A — this is a scheduling law for the train.
- **Status:** `RESOLVED` (binding on this train; enforced by the scope-exclusion list above)
- **Intended correction:** items 1–10 close before Phase 3 visual work; no excluded platform surface
  is expanded.
- **Affected files/flows:** train scope.
- **Acceptance criteria:** the final report contains no new Intelligence Phase 4/5, crowd-intel,
  Receipts, remote-rules, or licensing surface.
- **Class:** process
- **Evidence after implementation:** the delivered commit set.

---

### ITEM 17 — Do not substitute a smaller cosmetic change when the feedback reveals a structural problem

- **Direction (retained wording):** owner train brief, verbatim.
- **User problem:** cosmetic substitutions close the ticket and leave the user's actual problem
  intact — and the ledger then lies about it.
- **Current implementation:** precedent — item 2's earlier fix added an expandable row (cosmetic
  reach) without fixing the payload contract, so the expansion still cannot name the tweak and shows
  a false chip (§0.3). This is the exact failure mode named.
- **Status:** `RESOLVED` (binding rule for this train)
- **Intended correction:** where the data contract is the defect, the contract changes.
  `docs/UI_VISION_BACKLOG.md` law applies: when a simpler thing ships than what was asked, it is
  logged as a **substitution needing sign-off**, never silently closed.
- **Affected files/flows:** all.
- **Acceptance criteria:** every `RESOLVED` row in this matrix cites journey evidence, not a
  component-level change.
- **Class:** process
- **Evidence after implementation:** this matrix at train end.

---

### ITEM 18 — Do not declare an item resolved because a related control exists elsewhere

- **Direction (retained wording):** owner train brief, verbatim: *"Do not declare an item resolved
  because a related control exists somewhere else; verify the complete user journey."*
- **User problem:** "the button exists in Optimize" is not an answer to "I didn't know what to do
  after the check."
- **Current implementation:** N/A — verification law for this matrix.
- **Status:** `RESOLVED` (binding rule for this train)
- **Intended correction:** an item flips to `RESOLVED` only with end-to-end journey evidence (a
  journey-level test and/or an installed-build walkthrough), never on component existence.
- **Affected files/flows:** all.
- **Acceptance criteria:** the 22 required journey-level validation tests, plus the installed owner
  review.
- **Class:** process
- **Evidence after implementation:** the journey test suite + the owner review report.

---

## §2 — REQUIRED VALIDATION (22 journey-level tests)

| # | Journey assertion | Status |
| --- | --- | --- |
| 1 | Check finds one safe recommendation | pending |
| 2 | The exact recommendation is named | pending |
| 3 | The result exposes the proper action | pending |
| 4 | "Take me to Optimize" enters through normal navigation | pending |
| 5 | The exact recommendation is highlighted at the destination | pending |
| 6 | Multiple findings retain identity | pending |
| 7 | A stale or already-applied recommendation is handled honestly | pending |
| 8 | A manual-only recommendation opens its real guide | pending |
| 9 | Ignore / Not for me remains available | pending |
| 10 | "Needs your call" doors are mouse- and keyboard-operable | pending |
| 11 | A rig with no justified action receives an honest useful state | pending |
| 12 | Goal groups render only when supported recommendations exist | pending |
| 13 | A relevant recommendation reaches a real proof tool where a structured mapping exists | pending |
| 14 | Diagnostics can be reached through a user-problem route | pending |
| 15 | Back navigation and room orientation remain understandable | pending |
| 16 | Critical controls fit at 1280×720 | pending |
| 17 | Long copy + realistic density do not collapse the layout | pending |
| 18 | Reduced motion works | pending |
| 19 | Keyboard focus is visible | pending |
| 20 | Screen-reader naming and hierarchy are sensible | pending |
| 21 | Cursor behavior is consistent | pending |
| 22 | Existing mutation / rollback / anti-fabrication / release / encoding / state guards stay green | pending |

**"All tests pass" is NOT proof the design is accepted.** The acceptance gate is: functional journey
proof · installed owner eyeball · subsequent validation from the same kind of users who gave the
feedback.

---

## §3 — LAB GENERATION INVENTORY & PRUNING PLAN (Phase 4)

_(populated during Phase 4 — reachability, unique functionality, migration target, tests to migrate,
flags to retire, deletion eligibility, and blockers, per generation. Nothing is deleted in this
train.)_

---

## §4 — COMMIT LOG FOR THIS TRAIN

| # | Slice | Commit |
| --- | --- | --- |
| 1 | feedback truth matrix | _(this commit)_ |
| 2 | Check result identity + handoff contract | pending |
| 3 | Optimize destination highlighting + actions | pending |
| 4 | cursor + interaction consistency | pending |
| 5 | Lab candidate information architecture | pending |
| 6 | Lab candidate visual layer | pending |
| 7 | journey tests + pruning plan | pending |
| 8 | installed-review fixes | pending |
