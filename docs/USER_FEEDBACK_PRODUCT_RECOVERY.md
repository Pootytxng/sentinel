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
> This is the "six-station mega-room" named by owner item 13 and the overload of tester item 10.

**Full face map (corrected after the inventory sweep — an earlier read of this file said `LabBento`
was orphaned; it is not, see below):**

| Face | Reachable when | Chain |
| --- | --- | --- |
| `LabConsole` (**runtime default**) | always, by default | `App.tsx:1682` → `LabGround.tsx:102` |
| `Lab.tsx` classic list | `compy_lab_ground="0"` **and** `compy_lab_bento="0"` | `App.tsx:1710` → `LabV2.tsx:90` → `Lab.tsx` |
| `LabBento` grid | `compy_lab_ground="0"` **and** `compy_lab_bento` on (**its own default is ON**) | `LabV2` → `Lab.tsx:335-352` `{bento && !ground && <LabBento …/>}` |
| `Lab.tsx` guided numbered spine | `compy_lab_ground="0"`, `compy_lab_bento="0"`, `compy_lab_guided="1"` (default **OFF**) | `Lab.tsx:462-499` |
| classic `<Lab>` inside `App.tsx`'s `roomPanels` (`App.tsx:1339`) | **never for the Lab tab — dead code** | `roomPanels` is spread once (`App.tsx:1721`) behind `activeTab !== "Lab"` (`App.tsx:1720`) |

Flag defaults (`src/design/theme.ts`): `compy_lab_ground` **ON** (270-277) · `compy_lab_bento`
**ON** (235-244) · `compy_lab_guided` **OFF** (206-213). **None of the three has a Settings UI row** —
they were removed in the 2026-07-11 flag-debt sweep (`src/surfaces/Settings.tsx:242-251`), so they
are devtools/localStorage-only. Consequence: the failsafe path a user could actually reach is
`LabV2 → Lab → LabBento`, not the classic list.

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
  the first-run arc** (rendered only when `onGoToLab` is passed). `App.tsx:1371-1383` performs the
  navigation. *(This bullet originally added "the re-run Check surface has no equivalent" — wrong,
  corrected in the evidence block: on the shipped default the re-run check IS this same arc.)*
- **Status:** `RESOLVED` (default journey) — see the correction in the evidence block; the
  `compy_optimize="0"` failsafe surface stays open by decision, logged in §5.
- **Intended correction:** the post-check destination CTA must exist on **every** path that produces
  a check verdict (first run AND re-run), must route through the normal room navigation, and must
  carry what was found (see item 4).
- **Affected files/flows:** `src/surfaces/FirstCheck.tsx` · `src/surfaces/Check.tsx` ·
  `src/App.tsx` (nav + handoff write) · `src/surfaces/LabConsole.tsx` (handoff read).
- **Acceptance criteria:** from a settled verdict on both surfaces, one visible primary action leads
  to the Optimize destination; the destination opens on the exact findings; browser/room back
  behavior remains understandable; nothing is applied by navigating.
- **Class:** structural
- **Evidence after implementation:**
  `FirstCheck.tsx:170` computes the actionable ids, the CTA label degrades to `Take me to the Lab`
  when nothing is actionable (`FirstCheck.tsx:376`), `App.tsx` `onGoToLab` writes the typed intent
  then calls the ordinary `navHome("lab")` — no teleport, no bypass of the rail. Destination proof:
  `check-handoff-journey.test.tsx` "opens Optimize automatically — no hunting for where to act" +
  "arriving applies nothing".

  **Correction — "first run vs re-run" was a false distinction (re-traced 2026-07-28, not
  inferred).** The criterion above assumed a separate re-run Check surface that still needed its own
  CTA. There isn't one on the shipped default. Three verified facts:
  1. **The re-run check IS the first-run arc.** Home's `RerunCheckBand` (`HomeConsole.tsx:561`) calls
     `onRunCheck`, and `App.tsx:1612` binds that to `setShowFirstCheck(true)` — re-running re-opens
     `FirstCheck`, the *same* component, with the *same* `onGoToLab` CTA and the *same*
     `writeHandoff`. The fix that landed for "first run" IS the fix for re-run.
  2. **The standalone `Check` room never renders.** `readLabGround()` (`theme.ts:270-277`) and
     `readOptimizeMerged()` (`nav-flags.ts:8-14`) are both `!== "0"` → default-ON, so
     `App.tsx:1239`'s `activeTab === "Check" && !optimizeMerged` guard is permanently false, and
     `App.tsx:1076` maps the Check tab onto the Lab room regardless.
  3. **The one live `<Check>` is already inside the destination.** `OptimizeStation.tsx:274` mounts
     it under the "More cleanup (optional)" disclosure, in the same scroll as the Fix rows it feeds.
     A "Take me to Optimize" button there would point at the room it is standing in — exactly the
     cosmetic substitution item 17 forbids.

  **Status → `RESOLVED` for the production journey.** Both check entry points (first run, Home
  re-run) end in a destination CTA carrying the exact findings; the third surface is inside the
  destination. Proof: `check-rerun-journey.test.tsx` ("Home's re-run band re-opens the same check arc
  — same CTA, same handoff" · "the hygiene check lives inside Optimize, not a room away").
  **Known non-default gap (documented, not silently closed):** with the `compy_optimize="0"` escape
  hatch the classic standalone Check room returns and still ends without a destination CTA. That
  path is a developer failsafe, is not what any tester received, and Phase 3 retires it — logged in
  §5 rather than patched, because patching a surface the redesign deletes is waste.

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
- **Status:** `RESOLVED` (654bf53) — was `PARTIAL`, and the earlier partial fix stated something
  untrue (§0.3); that false "Hands-on fix" chip is gone from `FirstCheck.tsx` entirely.
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
- **Evidence after implementation:** commit `654bf53`. `priorities.rs` emits `rec_ids` on every
  `PriorityItem` (identity, not prose); `src/data/rec-detail.ts` resolves a row → one `RecDetail`
  per real recommendation and classifies the ONE honest action (`apply` | `applied` | `manual` |
  `ineligible`); `design/RecDetailCard.tsx` renders it on both Check faces. Guards:
  `rec-detail.test.ts` (incl. never re-deriving a rec from prose) · `Check.test.tsx` +
  `FirstCheck.test.tsx` pin that every tweak is named, that Apply dispatches THAT rec's id (not the
  row's, not row-position), and that a single-rec row is byte-identical to before. No fabricated
  fps/latency/temp numbers anywhere in the card.

---

### ITEM 3 — The Check result needs a direct path into Lab → Optimize

- **Feedback (retained wording):** covered by the same J note as item 1 — *"…add a second CTA ('take
  me to the lab') that opens the Lab's Optimize tab directly."* (`docs/BACKLOG.md:44-45`); owner
  direction in `docs/UI_VISION_BACKLOG.md` NAV-1: *"the check's output and the fix's door live in
  different rooms with no hallway. The fix class is a routed hand-off (check verdict → deep link into
  Lab→Optimize with the found items highlighted), not more UI."*
- **User problem:** the finding and the fix live in different rooms with no hallway between them.
- **Current implementation (traced):** the `compy_lab_open_station` localStorage deep link
  (`App.tsx:1376` → `LabConsole.tsx:201-206`, read-once-then-`removeItem`) opens the Optimize
  station. It is a **bare string literal on both ends** — no shared type, no payload, written only
  from the first-run arc. The typed room-navigation mechanism that *does* exist (`DOOR_MAP`,
  `room-shell.tsx:26-33`) has **no `check` edge at all** (`DOOR_MAP.check === null`) and carries no
  payload, so it cannot express "open Lab already on Optimize, holding these findings." Nor is any
  room/tab persisted: `activeTab` is plain `useState`, and no `compy_room`/`compy_last_room`-style
  key exists anywhere in `src/` — the one-shot string is the entire cross-surface handoff.
- **Status:** `RESOLVED`
- **Intended correction:** replace the bare string flag with a **durable typed handoff contract**
  (not DOM querying, not text matching) that carries the exact recommendation IDs and the context of
  the check; consume it in the Optimize destination. Route through normal navigation — the
  navigation-never-teleports law (`DESIGN.md:117`) holds.
- **Affected files/flows:** new handoff module · `src/App.tsx` · `src/surfaces/FirstCheck.tsx` ·
  `src/surfaces/Check.tsx` · `src/surfaces/LabConsole.tsx` · `src/surfaces/lab/OptimizeStation.tsx`.
- **Acceptance criteria:** the contract is typed and versioned; a malformed/absent payload degrades
  to today's plain "open Optimize" behavior; back navigation stays sane; nothing auto-applies.
- **Class:** structural
- **Evidence after implementation:** **contract DONE, source coverage still `PARTIAL`.**
  `src/data/check-handoff.ts` — versioned (`v: 1`), station/source-typed, consume-once (cleared on
  read BEFORE validation, so a rejected payload can't haunt the next visit), 5-minute age cap.
  Writer `App.tsx` `onGoToLab`; reader `LabConsole.tsx` on mount → `setOpenStation("optimize")` +
  `carriedRecIds`. The retired `compy_lab_open_station` bare string has no live reader or writer
  left. Guards: `check-handoff.test.ts` (24 unit tests: unparseable JSON, non-object, foreign
  version, unknown station/source, non-string-array ids, missing/non-finite `at`, age cap, backwards
  clock jump, rejected-payload-is-cleared) + the 13 journey tests.
  **Deliberate deviation from the stated criterion:** a malformed/absent payload degrades to *the
  Lab opening normally*, not to "plain open Optimize" — a payload Compy can't trust shouldn't get to
  move the user either.
  **Status → `RESOLVED`.** The earlier "`Check.tsx` doesn't write an intent" gap was measured
  against a surface that does not render on the shipped default (full reachability proof in ITEM 1's
  correction). Every check that actually crosses rooms — first run AND Home's re-run band, which
  re-opens the same `FirstCheck` arc via `App.tsx:1612` — writes the typed intent. The only other
  live `<Check>` sits *inside* Optimize (`OptimizeStation.tsx:274`); writing a handoff there would
  be a self-hop.

---

### ITEM 4 — The exact recommendations must stay visible and prioritized after the handoff

- **Feedback (retained wording):** owner/NAV-1 direction — *"deep link into Lab→Optimize **with the
  found items highlighted**"* (`docs/UI_VISION_BACKLOG.md` NAV-1 (1)).
- **User problem:** arriving at a full workspace after a check, the user has to re-find what they
  were just told about. The check's work is discarded at the door.
- **Current implementation:** none — the handoff carries no identity (§0.2). The Optimize station
  renders its standard grouping with no arrival context.
- **Status:** `RESOLVED`
- **Intended correction:** the destination prioritizes/highlights the exact carried IDs and
  acknowledges context (e.g. *"Compy found these during your check"*), without silently applying
  anything and without dumping the user at the top of the Lab.
- **Affected files/flows:** `src/surfaces/lab/OptimizeStation.tsx` · `src/surfaces/Fix.tsx` ·
  the handoff module.
- **Acceptance criteria:** defined behavior for **all seven** cases — one found · several found · a
  finding gone stale before arrival · already applied · not automatically appliable · a later
  revisit of the Lab (context must not haunt the room forever) · nothing actionable found.
- **Class:** functional + structural
- **Evidence after implementation:** the destination re-reads the LIVE catalog rather than replaying
  what the check claimed — `resolveCarried()` splits the carried ids into `open` / `done` / `missing`
  in carried order, and `OptimizeStation` renders the `.lab-carried` arrival banner
  ("Compy found these during your check" / "already on" / "no longer applies to this rig").
  `Fix.tsx` sorts carried rows to the front with a **stable** `carriedFirst()` and marks them with
  the shared `design/CarriedTag.tsx` pill — on BOTH row families: `SlimRecRow` (`.slimrow-carried`)
  and the guided "Needs your call" `GuidedRow` (`.fix-row-carried`), which still opens its real
  steps. **Marker + ordering only — no row's control, action, or semantics change, so no new
  mutation path exists.** All seven cases proven in `src/surfaces/check-handoff-journey.test.tsx`
  (13 tests): one found · several found (order preserved) · stale → stated honestly, never invented ·
  applied-since → "already on" and not re-offered · manual-only → marked and opens its guide · later
  revisit → consume-once + age cap · nothing actionable → station opens, no banner, CTA already
  degraded upstream. Arriving applies nothing (`onToggleRec` / `onApplyBatch` never called).

---

### ITEM 5 — Every recommendation needs an understandable apply / guided / ignore / not-for-me path

- **Feedback (retained wording):** J's inline ask — *"add a dropdown/expand showing WHICH tweak +
  apply/ignore inline"* (`docs/BACKLOG.md:42-43`) — plus the shipped-door precedent for the
  no-safe-switch case (`docs/BACKLOG.md:48-51`).
- **User problem:** a card the user cannot act on teaches them the section is dead. A card that
  offers the WRONG action (§0.3) is worse — it lies about what Compy can do.
- **Current implementation (journey traced end-to-end):** the audited path exists and is sound in
  `Fix.tsx` — `TrustSwitch` rows, `GuidedRow` doors (`Fix.tsx:614-712`), `Not for me` dismiss (only
  when not applied), the Dismissed pile's Restore, the REFUSE_PILE's "Read the autopsy" → all resolve
  to a real action or an honest empty state. `Check.tsx:724-757` likewise renders a real
  `Walkthrough` for its non-appliable branch. **`FirstCheck.tsx:180-184` and `:236-240` are the
  confirmed dead end:** both the #1 spotlight and the #2..N expandable rows emit a bare
  `<span className="fc-chip fc-chip-muted">Hands-on fix — no switch to flip, but Compy shows you the
  steps</span>` — **static text, no button, no link, no `onClick`, and no walkthrough lookup exists
  in that file at all.** The copy promises steps the screen cannot open. That same branch is what
  the aggregate wrongly falls into (§0.3), so a one-click-appliable tweak is announced as hands-on
  *and* given nothing to open.
- **Status:** `RESOLVED`
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
- **Evidence after implementation:** **the dead end is gone; dismissal at the Check surface is
  not.** `654bf53` deleted the static `fc-chip-muted` "Hands-on fix" span from `FirstCheck.tsx`
  outright — every finding on both Check faces now mounts `RecDetailCard`, which offers exactly one
  action classified from real capability (`isAppliable` / `GUIDED_STEPS`), never guessed from prose:
  Apply (through the existing audited `apply_recommendation` path), "already on", the rig's real
  ineligibility reason, or the real shipped `Walkthrough`. In the Lab, manual-only rows carried from
  a check keep their door (`check-handoff-journey.test.tsx` "a manual-only finding is marked too,
  and still opens its real steps").
  **Phase 2C closed the third door.** `RecDetailCard` + `Check.tsx` now offer *Not for me* on every
  actionable finding — appliable AND hands-on — through the SAME preference store `Fix.tsx` reads
  (`surfaces/dismissed.ts`, key `compy_dismissed_recs`, localStorage, **zero IPC**), so one decline is
  honored wherever the user next meets the tweak, and **no new mutation path was created**. Declining
  is scoped to `apply` / `manual` only: an already-applied rec is a *rollback*, not a decline (same
  rule as `Fix.tsx`), and an ineligible one has nothing to decline. A set-aside finding **stays where
  it was, labeled, with Restore riding on it** — never hidden, honoring `dismissed.ts`'s own law
  ("Dismissal NEVER hides truth"). Guard: `src/surfaces/check-decline-journey.test.tsx` (6 tests) pins
  the door open, the in-place set-aside, the applied/ineligible exclusion, cross-surface persistence,
  and `expect(invoke).not.toHaveBeenCalled()` on both decline and restore.
  **Deliberate exclusion — the `FirstCheck` arc has no decline, by design.** It is a one-shot
  momentum moment with spec-locked pre-language-picker English copy, and its CTA hands `recIds`
  straight to Optimize; a decline there would carry an id into a banner naming a rec that `Fix` has
  already filtered into the Dismissed pile — self-inflicted drift. The user meets the same rec again
  in Optimize/Check, where the decline is available.

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
- **Status:** `RESOLVED` (guard written; behavior unchanged, now pinned)
- **Intended correction:** add the DOM/interaction guard. Cover: mouse activation opens · keyboard
  activation opens (Enter/Space on the head) · visible focus · `aria-expanded` chevron/expanded state
  tracks reality · the no-guide case still answers (no door onto nothing) · actions are not hidden
  inside ambiguous card regions.
- **Affected files/flows:** `src/surfaces/optimize-v2-ia.test.tsx` (per the owner's own note) ·
  `src/surfaces/Fix.tsx` (no behavior change intended).
- **Acceptance criteria:** the guard fails if the head stops being a button, if `aria-expanded` stops
  tracking, or if the `{open && !guide}` honest answer is removed.
- **Class:** functional (test coverage)
- **Evidence after implementation:** `src/surfaces/optimize-v2-ia.test.tsx` — describe *"Fix — 'Needs
  your call' doors open, and always answer"*, 5 tests, no production code touched.
  - **THE FIXTURE** is the point: two advisory recs that differ in the one way that matters —
    `monitor-max-refresh` (in `GUIDED_STEPS`, 2 steps + an `ms-settings:display-advanced` deep link)
    and `gpu-driver` (deliberately NOT a `GUIDED_STEPS` key), so both branches of the door are
    exercised by real catalog data rather than a mock of it.
  - **head is a real button** — `tagName`/`type="button"`/`tabIndex 0`/focusable. jsdom does not
    synthesize activation from keydown, so the guard pins the *property that makes Enter and Space
    work in a browser* instead of pretending to press them; a `div`+`onClick` fails every line.
    Visible focus is proven at its real source: `doorknob.css`'s `button:focus-visible` outline
    plus App's import of it.
  - **`aria-expanded` tracks both directions** (closed → open → closed), and the `.fix-guided-toggle`
    reports the SAME state as the head (one open state, two doors).
  - **honest answer preserved:** the no-guide rec offers no `.fix-guided-toggle` and no
    `.fix-guided-open` (no promise of steps that don't exist) yet still opens onto
    `.fix-guided-none` — the `{open && !guide}` branch, asserted by its copy.
  - **actions are not buried:** the head contains zero nested interactive elements (a button cannot
    nest a button), `.fix-advisory-quickacts` sits outside it, and *Not for me* both renders and
    dismisses while the card is still CLOSED.
  - **VERIFICATION:** `npx tsc --noEmit` clean · `npx vitest run` **212 files / 2096 passed, 2
    skipped** (2091 → 2096).

---

### ITEM 7 — Cursor behavior is inconsistent across the application

- **Feedback (retained wording):** *"J: cursor consistency — native Windows cursor appears over
  sidebar items + some buttons (Monitor 'Overlay', 'Start Capture') instead of the Compy reticle
  cursor; keep ONE cursor."* (`docs/BACKLOG.md:40-41`)
- **User problem:** the pointer changing identity between regions reads as breakage, not style.
- **Current implementation (audited — 231 `cursor:` declarations across `src/**/*.css`):**
  `compy_hud_frame` (DEFAULT ON, `theme.ts:634-643`, no Settings row) makes `ShellV2.tsx:234` mount
  ONE app-wide `ReticleCursor` scoped to the whole shell — rail, topbar and every room. The three
  stage-scoped mounts (`LabConsole.tsx:333`, `MonitorConsole.tsx:537`, `HomeConsole.tsx:823`) render
  `null` at default settings (`ReticleCursor.tsx:29` `standDown`). Four concrete defects found:
  1. **`reticle.css:11-14` applies `cursor: none !important` to `.lc-has-reticle *`**, and
     `.lc-has-reticle` is toggled on `pointerenter` of the *entire shell* (`ReticleCursor.tsx:62-76`).
     Only two carve-outs exist (text entry → `auto`, `:disabled` → `not-allowed`). So **14
     purpose-built semantic cursors are dead by default**: 7 × `help` (`WhatsThis.css:17`,
     `Term.css:12`, `App.css:220,705,1262,2634,2676`), 6 × `progress` (`TrustSwitch.css:23`,
     `Check.css:94,521`, `Fix.css:429,493`, `Play.css:79`), 1 × `crosshair`
     (`monitor-console.css:35`, the oscilloscope). **This is the mechanical cause of item 7.**
  2. **Double cursor over disabled controls** — the CSS restores the native `not-allowed` glyph,
     but `ReticleCursor.tsx`'s move handler only fades the bracket for text entry, never for
     `:disabled`, so both are drawn at once.
  3. **The app's own stated disabled convention is broken 19 ways to 10** — `not-allowed` in 10
     rules (incl. `App.css:250`, which `home-console.css:178` cites as "the app-wide convention"),
     `default` in 19 (`FirstCheck.css:385`, `Benchmark.css:93`, `Latency.css:114`,
     `gaming-console.css:186,215`, `Settings.css:467,529`, …), and **no cursor at all** on
     `ExperimentBench.css:69-72`.
  4. **Zero test coverage** — the three reticle tests assert mount/unmount only; none reads a
     `cursor` value. The `!important`-vs-specificity bug that `reticle.css:5-10` documents as
     "reported 2026-07-22 on the sidebar nav rail + Monitor's capture/overlay buttons" — i.e.
     *this exact tester complaint* — was fixed with **no regression guard**.
- **Status:** `RESOLVED` — pending owner eyeball on the installed candidate (taste-adjacent, see item 8)
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
- **Evidence after implementation:**
  - **THE DECISION — native cursors, one semantic map.** The reticle is retired as the default and
    becomes opt-in behind its own flag `compy_reticle` (DEFAULT OFF, `theme.ts` `readReticle`);
    `compy_hud_frame` keeps the corner brackets + rig·clock readout unchanged on its own flag.
    **Nothing is deleted** — `ReticleCursor.tsx`, `reticle.css` and their guards stay whole, and
    `compy_reticle="1"` restores the reticle app-wide.
  - **Why this direction and not "reticle everywhere":** the 2026-07-22 fix bought consistency by
    DELETION — `cursor: none !important` on `.lc-has-reticle *` blanks the whole vocabulary at once
    (174 `pointer`, 7 `help`, 6 `progress`, 5 `*-resize`, 1 `crosshair`), with only text-entry and
    `*:disabled` escaping. A cursor that says the same thing everywhere is not a consistent cursor;
    it is a cursor with nothing left to say. Item 9 asks for orientation to live in layout and
    controls, and the cursor is the oldest such control. The train's own rule — *prefer the least
    surprising consumer behavior unless the design doctrine gives a strong and current reason* —
    decides it: the reticle doctrine is dated 2026-07-15, the tester feedback 2026-07-23, and no
    reticle-specific owner sign-off post-dates the feedback.
  - **The map** (`src/design/cursor.css`, new, loaded once from `App.tsx`): a zero-specificity
    `:where()` FLOOR, so a component with a real reason to differ still wins by simply existing —
    `Term`/`WhatsThis` keep `help`, `TrustSwitch` keeps `progress`, the oscilloscope keeps
    `crosshair`, `WindowChrome` keeps its resize handles. No `!important` anywhere in the file.
  - **The third inconsistency, found during the audit and fixed:** the disabled convention was split
    — **22 rules across 17 files said `cursor: default`** (two identical-looking dead buttons, two
    different answers). All 22 rewritten to `not-allowed`. `WhatsThis.css:46` and
    `shell-v2.css:275` were deliberately left alone after verifying neither is a control.
    Six `:disabled` rules that say `progress` were also verified and KEPT: each is disabled
    *because its own action is running* (`TrustSwitch` is literally `disabled={busy}`), which is a
    different fact about the same greyed-out button.
  - **Guard:** `src/design/cursor-consistency.test.tsx` (7 tests) — no disabled control may say
    `default`/`auto`/`pointer`; `cursor: none` may exist ONLY in `reticle.css`; every `none` rule
    must be gated on `.lc-has-reticle` and exactly one component may add that class; the map is
    loaded by `App.tsx`, its activator row is `:where()`-floored and its disabled row deliberately
    is not; and behaviorally the reticle renders nothing and touches no DOM at default flags.
  - **Verification:** `npx tsc --noEmit` clean · `npx vitest run` **212 files / 2091 passed, 2
    skipped**. `hud-frame-flag.test.tsx` updated to arm `compy_reticle="1"` on its four reticle
    claims so each still tests the scoping rule instead of passing trivially.

---

### ITEM 8 — The square Compy reticle feels strange to at least one tester

- **Feedback (retained wording):** *"(Matthew separately finds the square crosshair 'a little weird'
  — treat as one cursor pass.)"* (`docs/BACKLOG.md:40-41`)
- **User problem:** a custom cursor is a constant, unavoidable piece of UI. If it reads as odd, it
  taxes every single interaction.
- **Current implementation (audited):** on by default via `compy_hud_frame`, app-wide. The tester's
  word "square" is literally accurate: `reticle.css:29-79` draws a **26×26px square** box of four
  **7×7px square L-brackets** (`1.5px solid var(--ix-accent)`); the only round element is a 2×2px
  centre pip. It is a target-lock bracket, and per item 7 it *replaces* the help/progress/crosshair
  cursors rather than coexisting with them — so the "weird" reticle is also the thing eating the
  affordance signals the rest of the app is trying to send.
- **Status:** `RESOLVED` — **owner decision required on the installed candidate** (taste call)
- **Intended correction:** resolved **together with item 7 as one decision**. Because a tester found
  the square crosshair strange, **prefer the least surprising consumer behavior unless the
  established design doctrine provides a strong and current reason otherwise.** Record the reasoning
  either way; this is a taste-adjacent call and the owner reviews it on the installed build.
- **Affected files/flows:** same as item 7.
- **Acceptance criteria:** one documented decision, applied consistently, reviewable by the owner on
  the installed candidate.
- **Class:** visual
- **Evidence after implementation:**
  - Same decision and same commit as item 7: the square target-lock bracket no longer ships on.
    Matthew's "a little weird" and J's "native cursor leaks through" had one root cause, and one
    fix answers both — the app now shows the cursor Windows users already know, everywhere.
  - **This is a taste call and it is NOT closed by tests.** Two things go to the owner at the
    installed-build review: (a) does the app feel right without the reticle, and (b) if he wants it
    back, `compy_reticle="1"` restores it in one line and the guard still holds — but then item 7's
    blackout returns and would need a semantic reticle, not a flag flip. Carried to the 12-point
    report, "exact owner decisions required."
  - **Open, NOT closed by this:** the magnetic cursor in `docs/UI_VISION_BACKLOG.md` §JARVIS stack
    is a separate unbuilt item. Retiring the reticle does not deliver it; whatever is built there
    must carry a semantic vocabulary or `cursor-consistency.test.tsx` will fail it.

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
- **Current implementation (verified §0.1 face map):** `LabGround`→`LabConsole` is the runtime
  default; `LabV2`→`Lab` is the `compy_lab_ground="0"` failsafe, and inside that failsafe the face
  actually rendered is **`LabBento`** (its own flag defaults ON) — the classic list needs *two*
  flags flipped, the guided spine three. The one genuinely dead call site is the bare `<Lab>` in
  `App.tsx:1339`'s `roomPanels`, excluded for the Lab tab by `activeTab !== "Lab"` (`App.tsx:1720`).
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
| 1 | Check finds one safe recommendation | ✅ `Check.test.tsx` / `FirstCheck.test.tsx` (654bf53) |
| 2 | The exact recommendation is named | ✅ same + `rec-detail.test.ts` |
| 3 | The result exposes the proper action | ✅ same — action classified from capability, not prose |
| 4 | "Take me to Optimize" enters through normal navigation | ✅ `check-handoff-journey.test.tsx` "opens Optimize automatically" (`App.tsx` writes intent → ordinary `navHome`) |
| 5 | The exact recommendation is highlighted at the destination | ✅ `check-handoff-journey.test.tsx` "leads the list with the carried rec, marked" |
| 6 | Multiple findings retain identity | ✅ `…journey.test.tsx` "several findings keep their identity and the order" |
| 7 | A stale or already-applied recommendation is handled honestly | ✅ `…journey.test.tsx` stale / applied-since / all-done cases |
| 8 | A manual-only recommendation opens its real guide | ✅ `…journey.test.tsx` "a manual-only finding is marked too, and still opens its real steps" |
| 9 | Ignore / Not for me remains available | ✅ `check-decline-journey.test.tsx` (6) — door open on appliable + hands-on, set aside in place with Restore, none on applied/ineligible, shared with `Fix.tsx`, zero IPC |
| 10 | "Needs your call" doors are mouse- and keyboard-operable | ✅ `optimize-v2-ia.test.tsx` (5) — real button/type/tabIndex/focus + doorknob focus ring, `aria-expanded` both ways on head and toggle, no-guide card still answers, actions outside the head |
| 11 | A rig with no justified action receives an honest useful state | ✅ `lab-deck-journey.test.tsx` — three distinct empty states (nothing worth changing / stack already set / rig not read), each with a real onward CTA, none manufacturing urgency |
| 12 | Goal groups render only when supported recommendations exist | ✅ `…journey.test.tsx` — 3 real goals → 3 chips + "All"; one goal → no chip row at all |
| 13 | A relevant recommendation reaches a real proof tool where a structured mapping exists | ✅ `…journey.test.tsx` — "How you'd prove it" appears for latency/fps recs, absent for cleanup, and opens the mapped instrument with focus moved |
| 14 | Diagnostics can be reached through a user-problem route | ✅ `…journey.test.tsx` — "Something changed and I don't know what" opens the real diagnostics slot |
| 15 | Back navigation and room orientation remain understandable | ✅ `…journey.test.tsx` (one `aria-current` pill, nav text === section headings, one `data-here` section) + `lab-deck-flag.test.tsx` (RoomShell + verdict survive the swap) |
| 16 | Critical controls fit at 1280×720 | pending — **not claimed**; jsdom has no layout. Installed candidate + `self-review` |
| 17 | Long copy + realistic density do not collapse the layout | ✅ `…journey.test.tsx` — 13-rec / long-label case still yields exactly 5 sections, 1 nav, 1 move card, 1 chip row, 5 distinct headings |
| 18 | Reduced motion works | ✅ `…journey.test.tsx` — `data-motion` mirrors `compy_motion`; both branches styled in `LabDeck.css` |
| 19 | Keyboard focus is visible | pending — **not claimed**; jsdom does not paint. Installed candidate + `self-review` |
| 20 | Screen-reader naming and hierarchy are sensible | ✅ `…journey.test.tsx` — every section `aria-labelledby`→`H2` and `tabIndex=-1`; every row head a real `BUTTON` with `aria-expanded`+`aria-controls`; chevrons `aria-hidden` |
| 21 | Cursor behavior is consistent | ✅ `design/cursor-consistency.test.tsx` (7) — one disabled answer, `none` quarantined to the opt-in reticle, the map is a `:where()` floor, reticle off by default |
| 22 | Existing mutation / rollback / anti-fabrication / release / encoding / state guards stay green | ✅ `npx vitest run` 223 files / 2209 passed / 2 skipped · `npx tsc --noEmit` clean · `cargo test` 880 passed / 0 failed / 24 ignored (cold build) · `cargo clippy --all-targets` clean |

**"All tests pass" is NOT proof the design is accepted.** The acceptance gate is: functional journey
proof · installed owner eyeball · subsequent validation from the same kind of users who gave the
feedback.

---

## §3 — LAB GENERATION INVENTORY & PRUNING PLAN (Phase 4)

**Nothing is deleted in this train.** This section is the evidence a later train prunes from — every
claim below was read out of the current code, not inferred from filenames or shipped banners.

### The reachability truth (read out of `App.tsx`, not the specs)

```
App.tsx:1022   if (hw) list.push("Lab")            ← the Lab tab exists ONLY when hw !== null
App.tsx:1210   const v2Shell = hw !== null && !settingsActive
App.tsx:1548   ) : v2Shell ? ( <ShellV2> …         ← so hw !== null ALWAYS routes to the V2 shell
App.tsx:1341   <Lab diagnostics vendor />          ← classic branch: needs hw === null … where the
                                                     Lab tab does not exist and the reset effect
                                                     bounces activeTab back to Overview
App.tsx:1677   labGround ? hw && <LabGround/> : <LabV2/>
LabGround:124  deck ? <LabDeck/> : <LabConsole/> + <ExperimentBench/>
```

**What a user actually receives today: `ShellV2 → LabGround → LabConsole` + `ExperimentBench`.**
`compy_lab_ground` defaults ON (`theme.ts:270`), `compy_lab_deck` defaults OFF (`theme.ts:303`).
The classic `<Lab>` mount at `App.tsx:1341` is **unreachable** — its guard and the tab's guard are
mutually exclusive. Classic `Lab.tsx` still runs in production only as the *body* of `LabV2`
(`LabV2.tsx:90 <Lab v2 …>`), which is itself the `compy_lab_ground="0"` failsafe.

### Per-generation inventory

| Generation | Files (lines) | Reachable today via | Unique functionality | Where it lands in the candidate | Tests to migrate | Flag to retire | Deletable when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Classic Lab** | `Lab.tsx` 769 · `Lab.css` 261 | `LabV2` only (ground failsafe). Its own `App.tsx:1341` mount is dead. | welcome band · vendor-honesty copy (NVML "not yet hardware-verified") · station readings strip · `ground`-mode spine (dead: nothing passes `ground` any more) | station readings → `stationReading()`; vendor honesty already lives in the shared station data | `Lab.test.tsx` (vendor honesty, welcome band) · the `<Lab v2 ground>` cases in `lab-ground.test.tsx` | — (composed, not flagged) | `compy_lab_ground` failsafe retires |
| **LabV2** | `LabV2.tsx` 102 · `lab-v2.css` 115 · `lab-v2-data.ts` 184 | `compy_lab_ground="0"` failsafe | `labVerdict()` room headline · HUD masthead wiring | `RoomShell verdict` in `LabGround.tsx` already calls the same `labVerdict()` | `lab-v2.test.tsx` verdict cases | `compy_lab_ground` | ground failsafe retires. **`lab-v2.css` + `lab-v2-data.ts` stay** — `LabGround.tsx:17` and `lab-guided-data.ts` import them. |
| **LabBento** | `LabBento.tsx` 166 · `lab-bento-data.ts` 126 | inside classic Lab, `compy_lab_bento` default ON | per-station bento cards + synthesized checkup report | deck rows carry the same station facts; the checkup report has no deck equivalent yet | `lab-bento.test.tsx` | `compy_lab_bento` | classic Lab retires. **`lab-bento-data.ts` stays** — `LabConsole.tsx:17` and `LabDeck.tsx` both import it. |
| **Guided router** | inside `Lab.tsx` · `lab-guided-data.ts` 235 | `compy_lab_guided` default **OFF** — effectively unreached | plain-language intake router ("just make it fast" → station) | superseded by the deck's goal chips + `problems` rows | `lab-guided.test.tsx` router cases | `compy_lab_guided` | classic Lab retires. **`lab-guided-data.ts` stays** — it is the shared station model `LabConsole` *and* `LabDeck` read. |
| **LabGround** | `LabGround.tsx` 142 | **production room host** (`compy_lab_ground` ON) | the room shell, verdict, and the console/deck swap | keeps its job — the deck is hosted *by* it | `lab-ground.test.tsx` room cases | — | never (it is the host, not a face) |
| **LabConsole** | `LabConsole.tsx` 376 · `design/console/dock.css` | **the face users receive today** | RigViewer hologram · 4× `ArcGauge` · `ReticleCursor` stage · A/B comparison state (`armed`/`latestCmp`) · `latestSession` strip · `readiness` surface | **partially — this is the honest gap, below** | `lab-console.test.tsx` · `lab/optimize-gauge-dock-guard.test.tsx` · the `LabConsole` imports in `check-handoff-journey.test.tsx:21` and `check-rerun-journey.test.tsx:27` must re-point at `LabDeck` | — | owner accepts the deck **and** the gap below is closed or explicitly dropped |
| **LabDeck (candidate)** | `lab/LabDeck.tsx` 646 · `lab/LabDeck.css` 490 · `lab/lab-deck-data.ts` 327 | `compy_lab_deck="1"` (Settings → Appearance, temporary) | the five-section decision journey | — | — | `compy_lab_deck` + its Settings row retire **with** acceptance | n/a |

### The honest gap (do not let this disappear into a "COMPLETE" checkbox)

`LabGround.tsx:124` swaps the deck in **instead of** `LabConsole`, not beside it. With the flag ON the
user therefore loses: the **RigViewer hologram**, the **four ArcGauges**, the **ReticleCursor stage**,
the **A/B comparison state**, the **latest-session strip**, and the **readiness surface**. Station
readings survive as text via `stationReading()`; the 3D/gauge instrumentation layer does not. This is
an owner decision (§ report item 11), not a bug to quietly close: either those elements migrate into
the deck's premium layer, or the owner signs off on dropping them.

### Pruning order for a later train (each step reversible on its own)

1. Owner accepts the deck on the installed candidate → make `LabDeck` unconditional in `LabGround`,
   retire `compy_lab_deck` + its Settings row (the one deliberate exception to the 2026-07-11
   flag-debt sweep).
2. Re-point `check-handoff-journey.test.tsx` / `check-rerun-journey.test.tsx` at `LabDeck`, migrate
   the `lab-console.test.tsx` + `optimize-gauge-dock-guard.test.tsx` assertions that still describe
   real behaviour, **then** delete `LabConsole.tsx`.
3. Retire the `compy_lab_ground` failsafe → `LabV2.tsx`, `Lab.tsx`, `Lab.css`, `LabBento.tsx`, the
   guided router, `compy_lab_bento`, `compy_lab_guided`, and the dead `App.tsx:1341` mount all become
   deletable together, with their tests.
4. **Blocked indefinitely:** `lab-guided-data.ts`, `lab-bento-data.ts`, `lab-v2-data.ts`,
   `lab-v2.css` — shared with the survivors. Prune the *faces*, keep the *data*.

**Blocker on all of the above:** LOCKED — the current production-default Lab and its rollback path are
untouched in this train (owner instruction, verbatim: _"Do not delete the current production-default
Lab or its rollback path during this train."_).

---

## §4 — COMMIT LOG FOR THIS TRAIN

| # | Slice | Commit |
| --- | --- | --- |
| 1 | feedback truth matrix | `5f7e38f` + `3c2ed53` (audit corrections) |
| 2 | Check result identity + handoff contract | `654bf53` (identity) |
| 3 | Optimize destination highlighting + actions | `a4f6b24` (handoff destination) + `0e505fc` (re-run journey correction + the decline door) |
| 4 | cursor + interaction consistency | `b1ecd44` (native cursors, one semantic map, reticle opt-in) + `bf01473` (the "Needs your call" door guard) |
| 5 | Lab candidate information architecture | `0102a14` (five-section decision journey + `compy_lab_deck` flag + flag guard) |
| 6 | Lab candidate visual layer | `ff1a773` (section rail lit by IntersectionObserver, `aria-current` nav, both motion branches, <640px collapse) |
| 7 | journey tests + pruning plan | `3e22a7c` (28 journey tests) + `896f1c2` (§3 inventory — six Lab generations read out of the router) |
| 8 | installed-review fixes | `0937137` (rounds 1–3) + `c783d63` (round 4: one name on the whole action path + class guard) + `c15d1e2` (round 5: the arc is a real modal for the keyboard) + `a079edd` (round 6: the confirm is never buried; one click never opens two rows) + `75ebc91` (round 7: a proof door lands on its instrument wherever it lives) + `d310220` (round 8: one dismissal set, and a ring that counts it) + `ff8de44` (round 9: the decline reaches every surface that claims work, Home and the ranker included) + `63a3538` (round 10: one phrase one owner; keyboard focus is visible) + _(this commit — round 11: an override reaches every surface that counts work, and the row says where it landed)_ |

Round 6 found two **pre-existing** defects neither the tests nor five prior review rounds caught,
both structural, both now guarded:

- **The confirm dialog was buried under every full-screen overlay.** `.cmp-confirm-backdrop` sat at
  `z-index: 200`; `ConfirmProvider` renders it as a DOM sibling of the whole app tree, so from
  inside FirstCheck (999), Onboarding/SetupTour/Gaming Mode (1000) or Term/WhatsThis (1200) the
  confirm painted *underneath* an opaque layer — invisible and un-clickable, while its DOM and
  keyboard trap kept working. A mouse user applying the #1 rec from the arc saw the switch move and
  then nothing: the safety confirmation for a real mutation, swallowed by paint order. Raised to
  `2000` (below the window chrome at 9000, which stays reachable by design).
  Guard: `src/modal-stacking-guard.test.ts`.
- **One click expanded two problem rows.** "The game hitches or stutters" and "My FPS jumps around"
  both route to Benchmark by design, but LabDeck's single open-slot keyed on `(station, section)`,
  so clicking either expanded both and mounted the benchmark twice — the exact invariant the slot
  exists to hold. Now keyed on row identity. The pre-existing "one instrument at a time" test
  compared two rows with *different* stations, which is why it never saw this.
  Guard: the shared-station case in `lab-deck-journey.test.tsx`.

Round 7 then found a third one of the same shape — a control that looks like it works:

- **"How you'd prove it" was a dead end for stability recommendations.** An instrument lives in
  exactly one section, but the jump handler was *told* its destination by the caller, and section 1
  always said `"prove"`. A stability rec's proof is the Black Box, which lives under **Advanced** —
  so the button scrolled to the wrong section and expanded nothing at all. Compounding it, Advanced
  is a native `<details>` that was uncontrolled, so even the right section would have landed the
  user on a collapsed summary. `openAt` now resolves the host from the section arrays themselves
  (callers name the instrument, the deck finds it) and opens the disclosure when it routes there —
  the whole class of dead end is now unrepresentable. Advanced still starts closed and still honours
  a manual toggle; it is the user's disclosure, not a forced one.
  Why no test saw it: the *only* proof-door journey test fixtured a latency goal, whose instrument
  happens to live in `"prove"` — so the hardcoded section was always accidentally right.
  Guard: the outside-section-3 case in `lab-deck-journey.test.tsx`, negative-control-proven against
  both halves of the fix (hardcoded host → fails; unbound `<details>` → fails).

Round 8 found a fourth, and the worst of the four for this train's governing question — the app
contradicting itself about what to do next, on one screen, in one render:

- **Three answers to "what's left?" at once.** The Lab's safe-stack ring read *"1 left to enable
  below"*; three lines under it the list said *"Nothing waiting — no changes to make on this rig
  right now"*; and the "Dismissed (1)" pile under that said the rec was *"out of your active
  count"*. Two independent causes, both structural. (a) `useDismissed` was `useState(read)`, so
  each of its **four** callers (Check, Fix, LabDeck, OptimizeStation) held a private copy of the
  set and they desynced the instant one of them dismissed anything. (b) `OptimizeStation`'s gauge
  math had **never consulted the dismissal set at all** — so even perfectly synced hooks would
  have left the caption wrong. Fixed as a class, not an instance: the hook is now a module-level
  store read through `useSyncExternalStore` (one set per session, all subscribers re-render
  together, plus a `storage` listener for the second webview), and the station splits its pending
  stack by dismissal with **dismissed outranking drift**, exactly as `Fix.tsx` orders it.
  The ring's own numbers deliberately do NOT move: `applied/total` reports the **rig's** state, and
  setting a tweak aside turns nothing on. The caption is the action claim, so the caption is what
  had to stop counting set-aside work as outstanding.
  **This is a pre-existing PRODUCTION defect, not one the candidate introduced** —
  `OptimizeStation` is rendered by `LabConsole` (the production-default Lab) and by `Lab.tsx` as
  well as by the deck candidate. Fixed on this branch only; nothing shipped. See the round-6
  precedent above for the same shape.
  Guards: the concurrent-callers case in `src/surfaces/dismissed.test.ts`, and two **journey**
  assertions in `src/surfaces/lab/optimize-gauge-dock-guard.test.tsx` that open a real row, press
  the real "Not for me", and read the real caption. Negative-control-proven against **both** halves
  (old `useState` hook → all three fail; station ignoring dismissals → both journey tests fail).
  Why no test saw it: the two halves are individually green-able, and every existing gauge test
  fixtured zero dismissals. Only the journey assertion crosses the seam.

Round 9 found the **same class one layer up** — round 8 made the Lab agree with itself, and that
exposed that nothing outside the Lab was listening:

- **"Not for me" was a Lab-local opinion the rest of the app never heard.** Set *Enable Windows Game
  Mode* aside in the Lab, walk to Home, and Home still offered it: the intake band said *"1 tweak
  ready"* with a live **Apply** button, and the console read *"1 worth fixing · TOP LIMITER: Enable
  Windows Game Mode — See in Lab"*. Tap through and the row isn't there. Home was not merely
  miscounting; it was still **offering to apply a change the user had declined**, which is the
  rollback-first promise read backwards. Two independent channels make that claim and both were
  deaf: (a) `safeFixesReadyList` in `optimize-v2-data.ts` filtered `revertedIds` but had no notion of
  dismissals, so the band both counted and *staged* declined recs; (b) the **Rust** limiter ranker
  behind "worth fixing"/"TOP LIMITER" was never told about them at all, and `use-scan.ts` cached its
  scan, so even a corrected ranker would have re-served the stale ranking.
  Fixed at the derivation, not the display: `dismissedIds` is now a **required** parameter of
  `safeFixesReadyList`/`safeFixesReady` (required so a future caller cannot silently opt out —
  `EMPTY_DISMISSED` is the explicit no-op), `optimizeVerdict` gained a set-aside branch, and the
  scan passes `dismissedIds` to `priorities_from` while `onDismissedChange` invalidates the cached
  scan. Rust side: `build_priorities_filtered` drops set-asides from the limiter ranking.
  **The honesty boundary holds:** a set-aside changes what Compy *offers*, never what it *measured*
  — readiness checks, sensor reads and the ring's `applied/total` are untouched, and receipt/history
  surfaces still name the rec.
  **Also a pre-existing PRODUCTION defect** (`HomeConsole` is the default Home), fixed on this
  branch only; nothing shipped.
  Guards: `src/surfaces/home-lab-agreement.test.tsx` — five journey assertions that mount **Home and
  the Lab in one tree** (the live condition: the rail swaps rooms, it does not reload), press the
  real "Not for me", and read the real band, plus the real "Dismissed" door → "Restore" for the way
  back; and four Rust tests in `priorities.rs` pinning that set-asides leave the *measurement* alone.
  Negative-control-proven against all three halves independently (Home passing `EMPTY_DISMISSED` →
  both band tests fail; scan dropping `dismissedIds` → ranker test fails; scan dropping
  `onDismissedChange` → the stale-cache assertion fails).
  Why no test saw it: every prior guard lived *within* one surface. The reviewer's fix list asked
  for exactly this file — "a live-journey guard test spanning Home → Lab (not just within-Lab
  surfaces) so this class of drift trips CI next time."

Round 10 closed the *sentence* half of the same seam (rounds 8–9 closed the *count* half), plus a
plain accessibility defect the whole train had walked past:

- **The empty state contradicted the caption directly above it.** Set your only tweak aside in the
  Lab and the Optimize panel printed the round-8 caption — *"Nothing waiting — the last one is set
  aside. Restore it below anytime."* — and two lines under it `Fix`'s own line: *"Nothing waiting —
  no changes to make on this rig right now."* The second sentence is **false about the rig**: there
  IS a change to make, the user declined it. `Fix` had no knowledge of the caption and no
  set-aside-aware string. Fixed both ways, not by muting one: a new `emptyStatedAbove` prop lets the
  caller own the sentence when it already prints one (extending `Fix.tsx`'s own precedent, where the
  ready label already stands down for the drifted group), **and** the standalone line — the one
  OptimizeV2 and the classic Lab still show, where no caption exists — became set-aside-aware
  (`optimize.fix.nothingWaitingSetAside`). Blanket suppression alone would have left those two
  surfaces with no line at all. The section label now stands down on the same condition, so a bare
  "Ready to enable" can't hang over nothing. **Pre-existing PRODUCTION defect** (`LabConsole`
  renders `OptimizeStation` too), fixed on this branch only.
- **"Set aside" had two owners on one screen.** It named the *user's* decline (Dismissed pile, gauge
  caption) **and** Compy's *hardware* read ("Not for this rig" intro, and the button that undid an
  override, literally "Set aside again") — two unrelated meanings, one phrase, no way for a reader
  to tell which. The hardware copy gave the word back: the intro dropped it, the button became
  "Not for this rig after all", and the side-pile hint now reads *"measured fine · set aside by you ·
  deliberately refused"*. Both locales.
- **Keyboard focus was invisible on Home's intent rows** (ledger item 19). `.hc-intake-row` shared
  one rule for `:hover, :focus-visible` that ended in `outline: none` — so a tabbing user got exactly
  the faint background wash a mouse hover gives, and nothing else, while every other focusable
  control on Home and the Lab drew a real ring (measured live: `outline: none 3px` vs
  `outline: solid 2px`). Split into its own rule with a real `2px` accent ring.
  Guards: `src/focus-ring-guard.test.ts` — sweeps **every** `src/**/*.css` and fails any
  `:focus-visible` rule that kills the outline without leaving another mark (`border-color`,
  `box-shadow`, a different `outline`); `background` deliberately does not count, because hover
  already spends it. Two pre-existing legitimate cases pass on their `border-color` replacement.
  And `src/surfaces/set-aside-truth-guard.test.tsx` — journey assertions that press the real "Not
  for me" in both the Lab panel and standalone `Fix`, plus per-locale string guards that keep the
  decline word out of all eight hardware-read keys while proving the Dismissed pile still owns it.
  Why no test saw either: jsdom applies no stylesheets (the ring is unmeasurable there — hence the
  static CSS sweep), and every prior empty-state test fixtured zero dismissals.

Round 11 found the **third and last instance of the round-8 class** — a per-user judgement held in
one component's head while every counter kept quoting the raw catalog:

- **"My hardware supports this — show it anyway" went nowhere.** `useEligibilityOverrides` was a
  plain `useState(read)` with exactly ONE caller (`Fix`), so the override lived in Fix's head alone.
  Everything else derives eligibility from `eligible !== false` on the RAW catalog, so pressing the
  button moved the row into the ready list while the safe-stack ring three lines above it, Home's
  one-tap band, the room verdicts, the deck's goal groups and its next-best-move all kept counting a
  stack that did not contain the row now sitting under them. Fixed by the same shape round 8 used for
  `dismissed`: `eligibility-override.ts` became a module-level `useSyncExternalStore` store (plus a
  cross-window `storage` listener), and one boundary function — `withOverrides(recs, overridden)` —
  corrects `eligible` for every consumer that counts or lists. **Eight call sites wired**:
  `OptimizeStation` (safe-stack memo), `HomeConsole` (one-tap band), `LabGround` + `OptimizeV2` +
  `Lab` + `LabConsole` (verdict / safe-fixes-ready), and `LabDeck` twice (`nextBestMove`, and
  `liveRecs` → the goal groups). `Fix` deliberately keeps Compy's ORIGINAL read — it owns the control,
  so it still needs the raw answer to render the "Not for this rig" pile, the reason line, and the way
  back. `withOverrides` returns its input array **unchanged** when nothing is overridden, so no memo
  thrashes and no helper signature changed.
- **The row promised a list it wasn't in.** The confirmation under an overridden row said,
  unconditionally, that the rec *"now appears in your list"*. For a rec **already switched on** that
  is false in every direction: `worthFixing` drops `currently_applied`, and there is no ledger receipt
  either because Compy never applied it — it was in NO list while the copy swore it was. Now four
  outcomes, each naming the real destination: already-on · in the ready list · set aside by you ·
  walkthrough-only ("Compy points the way"). Both locales.
- **Deliberately NOT changed, verified rather than assumed:** `describeRec` (`src/data/rec-detail.ts`)
  reads eligibility raw but a completeness grep proved it has **zero production callers** (tests only)
  — no user-visible defect, so no change. `pickTrustDemoRec` (`trust-moment-data.ts`) stays on Compy's
  own confident read on purpose: the first-run trust demo is Compy's confidence pitch, and running it
  on a rec Compy judged ineligible risks a failed apply at the worst possible moment. No counter
  contradicts it — the card either renders or doesn't.
  Guard: `src/surfaces/override-truth-guard.test.tsx` — three journey tests that press the REAL button
  inside the collapsed "Not for this rig" drawer and assert the gauge denominator, caption and row list
  all move together, plus the landed-sentence truth for the already-on and walkthrough-only cases; and
  three unit tests pinning `withOverrides` as a correction rather than a second source of truth
  (identity return on an empty set, catalog never mutated, and a negative control that ignores an
  override for a rec Compy never rejected). **Negative control run:** both fixes neutered in place →
  2 failed / 4 passed, restored → 6/6. **Pre-existing PRODUCTION defect**, fixed on this branch only.

### Self-review findings NOT fixed, and why (owner call, round 5)

**FirstCheck's verdict h1 vs the title-header law.** Round 5 flagged `FirstCheck.tsx`'s
`<h1 className="fc-headline">` ("Ready to play — N things worth fixing") as a dynamic verdict
sentence standing where a title belongs, and `fc-subtitle` ("…measured on this rig, not assumed")
as an always-on explainer line. **Not changed this train.** The law
(`docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`, title-header addendum) governs
*"the h1 under the HUD"* in a **room** — Optimize / Monitor / Blackbook / Lab — and carves out
exactly this case: *"Home's masthead display verdict stays — Home is the answer-first cold-open;
its verdict IS the content, not a room description."* FirstCheck is not a room and has no HUD
masthead; its header space (`.fc-head`) already carries title-format text only (wordmark +
`first check · N checks · Xs`), and the flagged h1 sits inside the verdict body under its own
`VERDICT` tag. It is the answer-first cold-open in its purest form, and this train's governing
question is *"can a non-technical gamer understand what Compy found"* — demoting the finding to
body text answers that worse, and the brief forbids solving orientation with more prose.
The law's own closing line leaves the extension to the owner (*"owner may extend the law there;
flag on eyeball"*), so this is **flagged for the eyeball, not silently changed.** If the owner wants
it extended, the change is a stable title (`First check`) with the verdict relocated into the
spotlight body — a small commit on request.
