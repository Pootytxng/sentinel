# The Lab as a Proving Ground — architecture, linear pathing + the telemetry gallery

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04.** All product-direction, priority, approval, and work-
> authorization claims in this historical spec are retired, including portions previously described
> below as still standing. Current product direction is
> [`docs/PRODUCT_CONSTITUTION.md`](../../PRODUCT_CONSTITUTION.md), with sequence derived in
> [`docs/product/ROADMAP.md`](../../product/ROADMAP.md). Conforming mutation and evidence constraints
> remain safety provenance under [`docs/ARCHITECTURE_LOCKS.md`](../../ARCHITECTURE_LOCKS.md).

> **STATUS (2026-07-09): UI/layout direction is SUPERSEDED.** §2 ("one linear spine"), §3 (telemetry
> gallery), and §8 (blended-spine build) are REJECTED by the owner — see
> `docs/superpowers/specs/2026-07-09-lab-redesign-COURSE-CORRECTION.md` and the APPROVED replacement
> `docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md` ("The Instrument Bench" — bento
> basis, gallery DELETED entirely). §0 (the measure-loop finding), Directive 1 (catalog policy), §2a
> (aggregate-stack A/B backend), and §5–§7 (mutation scope / doctrine-sync) still stand as written.

**Owner directive (2026-07-08, verbatim intent):** research the full Lab framework I built, decide the
best **linear pathing** to introduce its guided utility, **optimize for fluidity + intuitive access**,
and **incorporate the gallery** into its architecture so the Lab is a **cohesive, sensibly constructed
environment**. He explicitly wants **options to make ACTUAL changes to the user's hardware / tweaks that
coincide with better predicted performance, for users to test and prove themselves — all within the Lab.**

**Status:** SPEC — research done (two read-only Explore maps, 2026-07-08), design decided. Build is
flag-gated `compy_lab_ground` DEFAULT OFF (P-series pattern), owner eyeballs the pilot. Tracked in
`docs/UI_VISION_BACKLOG.md` (item C, the Lab-establishment train the owner just handed over).

---

## ★ PRIMARY BLUEPRINT — owner course-setter (2026-07-09)

> **This is the blueprint the owner named as the one to "set course on for the big overhaul." It amends
> and outranks the original design below where they differ. Verbatim intent:**
>
> *"I'm entirely willing to open the catalog if it's within measurable benefit for any user. Even if the
> individual tweak is negligible, the accumulative measurement of negligible changes theoretically becomes
> considerable. Also I've had thoughts looking into combining the Optimize tab merged into the Lab but
> still allowing the user to have the option to just enable all the tweaks without benchmarking as a
> requirement — but just the utility that can be used in tandem or parallel to the tweaks. This promotes
> the organized and slim easy-to-navigate motto I've been trying to stick to and encourages users to
> explore the utility simply because it's all in the same room with the stuff they really came for
> (assuming most users will want to just enable all the tweaks and never look back)."*

### Directive 1 — OPEN THE CATALOG (owner product decision, lifts the LOCKED-rule-6 freeze)

The frozen-catalog vow is **lifted** by explicit owner decision. New law: **a tweak earns catalog
inclusion by measurable benefit** — even individually-negligible; the **cumulative measured stack** is the
point. The honest vehicle: **aggregate before/after A/B** (measure the whole enabled stack's real delta,
not each tweak in isolation below the noise floor) — this is the loud-but-true Receipts story
("measured X% faster on YOUR rig").

**"Measurable benefit" is an ADD criterion ON TOP OF the permanent safety rails — never instead of them.**
Every catalog tweak MUST still be:
- **Reversible** — captured typed rollback contract + snapshot at apply time (LOCKED rule 3). No rollback → no catalog.
- **No kernel driver / no injection / anti-cheat-safe** (LOCKED rules 1–2).
- **Non-security-weakening** — the UAC/Defender/firewall/`Policies` security-gate stands (the security/system-settings rule).
- **Stability-safe.**

**The old hard blocklist splits in two:**
- **Stays barred regardless of measured fps** (excluded for SAFETY/STABILITY/SECURITY/ANTI-CHEAT, not for
  being unmeasured): timer/HPET hacks, bcdedit boot params, MMCSS abuse, **core-parking writes**, Defender
  disable, MPO disable, fixed pagefile forcing, kernel-level anything, anything that trips EAC/BattlEye.
  Measurement does not make these safe.
- **Becomes a candidate** once it proves measurable benefit AND clears the rails: anything previously
  excluded merely as unmeasured "optimizer-rot / snake-oil."

**Per-tweak rigor is unchanged:** every new tweak rides the full **mutation-gate** — its own apply/rollback
QA + welfare-check — before it ships. Opening the catalog is a POLICY change, not a license to add tweaks
without the per-tweak proof + safety contract.

### Directive 2 — MERGE OPTIMIZE INTO THE LAB (one slim room)

The **Optimize room merges into the Lab.** The Lab becomes the single destination for both paths, so the
"organized, slim, easy-to-navigate, one room" motto holds:
- **Fast path (the default most users want):** **"enable all the good tweaks" in one action, NO benchmarking
  required.** Apply the safe stack and never look back. Benchmarking is a **tool, not a toll** — never a gate
  in front of applying tweaks.
- **Utility path (parallel/in-tandem, optional):** the measure→test→prove loop + the telemetry gallery sit
  right there in the same room — **discoverable precisely because it's beside the thing users came for.**
  Power users prove the stack; casual users ignore it. Both live in one room.

This **re-weights the spine below:** "apply tweaks (incl. enable-all)" is the PRIMARY surface; the
measurement/proving loop is the powerful adjacent UTILITY, not the required entry. The gallery still crowns
the loop.

---

## 0. The one finding that reframes everything

**The "make a real change, test it, prove it" loop already exists and is already inside the Lab.**
`BenchmarkTab`'s "Measure this tweak" flow (`src/surfaces/Benchmark.tsx:426`, backend
`benchmark_trial.rs:164` `start_tweak_trial`):

1. Measures the rig's **baseline** fps/frametime from the live ETW frame stream (with the change OFF).
2. **Applies a REAL Windows change** via the audited `apply_recommendation` path (`benchmark_trial.rs:208`).
3. Arms a `RollbackGuard` (a Drop guard) the instant apply succeeds — **auto-rolls-back on EVERY exit
   path** (success, cancel, panic) (`benchmark_trial.rs:133,220`).
4. Measures again with the change **ON**, computes a bootstrap-CI **verdict** (Keep / Revert /
   Inconclusive).
5. Banks it to the **scoreboard** as a certified receipt only if the verdict is `Keep`
   (`benchmark_scoreboard.rs:159`).

This is exactly the owner's ask — measured, honest, reversible, catalog-safe — and it needs **no new
mutation machinery**. The Lab redesign's job is **presentation + pathing + a results space**, not new
risk. (Mutation-scope boundary in §5.)

## 1. What's actually wrong with the Lab today (the friction to fix)

From the architecture map (`Lab.tsx`, `LabBento.tsx`, `theme.ts`):
- **Three competing nav idioms for the same 5 instruments**, none reused by the others: the **bento
  grid** (`compy_lab_bento`, DEFAULT ON), the **symptom router** "What are you here to do?"
  (`compy_lab_guided`), and the **classic accordion** — with **two different station orders**.
- **The guided flag is a no-op in the shipped default.** `guided && !bento` gates the router+stations,
  but `bento` defaults ON and subsumes it, so turning on "Guided Lab bench" changes *nothing visible*
  (`Lab.tsx:318,380,104`). Dead UX.
- **No progression, no completion.** The only linear cue (the checkup's "next" pointer) is buried at the
  *bottom* of the grid. The Lab is the terminal room with **no forward door by design**
  (`room-shell.tsx:29`) — so the room that most needs "what next?" has no completion signal.
- **Dead surface:** the welcome band only renders when `!guided && !bento` (never, under defaults);
  legacy `Diagnostics`/`History` tabs linger with no rail entry.
- A user can open a "station" (Diagnostics) that has **nothing to show** — membership is gated on the
  prop existing, not on it having a reading.

## 2. The design — the Lab is a PROVING GROUND (one linear spine)

Collapse the three idioms into **one guided environment** built around the loop that already works. The
spine is the scientific method a user already intuits — *measure → change → measure → prove → keep*:

```
   INTAKE            MEASURE           TEST                PROVE              COLLECT
 "what are you  →  baseline your  →  apply a tweak    →  see the measured →  your proven wins
  here to do?"     rig (Diag +       predicted to      before/after on      as pieces in a
  (symptom          Benchmark         help; real +      the rig itself       draggable 3D
  router = the      baseline +        auto-reverted     (Two Futures         telemetry GALLERY
  front door)       noise floor)      (the 16 safe      measured split)      (the trophy room +
                                      recs)                                   Lab's completion)
```

Concretely:

**Front door = the symptom router, promoted to lead the room.** "What are you here to do?" (the existing
`LAB_ROUTER`, `lab-guided-data.ts:70`) is the most intuitive access pattern in the codebase — plain
language, routes straight to the right station. It becomes the Lab's *first* thing, not a buried
alternate. A "run the full checkup" option sits beside it for the thorough user.

**The stations become a progression, not a menu.** One canonical order
(Diagnostics → Benchmark → Latency → Tuning → Black Box), each a step with a clear state (unread /
reading / done) and a single "next" that *leads* the room instead of trailing it. The bento grid's
strength (glanceable status + one synthesized checkup report) is kept as the **progress dashboard**; the
router is the intake; the accordion is retired. No more two-orders, no more no-op flag.

**Benchmark is the centerpiece — the "dyno."** The measure→tweak→prove loop is elevated from "one station
among five" to the beating heart of the Lab: pick a tweak the app *predicts* will help (each of the 16
recs carries its measured/expected rationale), run the real A/B trial, watch your own fps move.

**Prove it visually = the Two Futures measured split, finally given its purpose.** The owner's own note
on Two Futures was *"cool split but the hologram has no visible purpose/information."* Here it gets one:
after a trial, the split renders **baseline (ghost) vs after (accent)** on the rig hologram with the
**changed part emphasized by its measured `delta_pct`** (`partGlow` from real `Efficacy`,
`two-futures-view.ts`). The number moved; the rig shows *where*. That closes the Two Futures loop (item
B) inside the Lab.

## 3. The telemetry GALLERY — the Lab's trophy room + completion signal

The gallery is not a bolt-on; it's the **COLLECT** stage — where proven results live and the terminal
room finally gets its "you did something" payoff. The owner's highest-wow item (the sister-site
"drag-to-explore a 3D space") pointed at real data.

**It already has all its assets** (Part-B map): reuse `RigHologram`/`RigPart`/`use-rig-colors`/
`camera-fit`/`buildRigParts` + the `HardwareTourScene` **`TourCamera` fly-to-a-piece primitive**
(`HardwareTourScene.tsx:131`) — the exact "camera glides to the focused piece, click to inspect" motion
the gallery needs. Nothing new in 3D infra; a new **panoramic drag-shell** wraps them.

**The pieces are measured proofs, each honest and clickable-for-detail** — all cross IPC today:
- **Scoreboard awards** (`ScoreboardView`/`AwardEntry`, `types.ts:248`) — certified "Keep" tweaks with
  effect % + CI, anchored to the rig part they improved.
- **Sessions** (`SessionSummary`, `types.ts:63`) — past game sessions with fps/frametime/stutter, tagged
  by rig fingerprint.
- **Ledger receipts** (`AppliedChange`, `types.ts:20`) — what's applied now, with before→after labels.
- **Black Box incidents** (`CrashReceipt`, `types.ts:292`) — the honest failure records.

Drag to explore the space; a piece glides forward on click and opens its measured detail. **THE LAW
(inherited from Two Futures):** every piece traces to a measured struct — no fabricated trophies; an
empty gallery says *"prove a tweak in the bench to earn your first piece,"* which loops the user back to
the front. That circular pathing (gallery → bench → gallery) is the Lab's cohesion.

## 4. Fluidity + intuitive access (the "optimize" ask)

- **One flag, one environment:** `compy_lab_ground` replaces the bento/guided/classic tangle; flag-off is
  byte-identical to today's Lab (P-series guard). Retire the no-op `compy_lab_guided` visible-nothing
  state and the dead welcome band under the new flag.
- **The "next" leads, not trails** — the room always shows one obvious next action at the top.
- **In-place motion, GPU-cheap:** section jumps keep the existing scroll+expand (no route churn); the
  gallery rides `frameloop="demand"` (idle GPU ~0) like every other canvas; reduced-motion → a static
  grid of the same pieces (the sister-site's own "prefer the classic grid" fallback).
- **Completion signal:** finishing the loop (a proven Keep) lights the gallery entry — the Lab's answer
  to having no forward door.

## 5. Mutation scope — what I build now vs. the one LOCKED line

**Build now, no new safety decision needed** (all already owner-decided / catalog-safe):
- The **16 appliable recs** (`APPLIABLE_REC_IDS`, `history.rs:35`) via the existing trial loop — this IS
  "make real changes + test + prove," fully reversible.
- Surfacing the **already-ARMED gated features** — `gaming_mode` (LIVE), `service_suspend` (ARMED),
  `bloat_removal` (ARMED) — as testable/provable changes reachable from the Lab is **wiring, not a new
  safety decision** (their gates are already `true`, same `actions.rs`/`history.rs` boundary). This
  widens "actual changes you can make and prove" meaningfully, within the locks.

**Catalog EXPANSION — now GREEN (owner decision 2026-07-09, ★ Directive 1 above).** The freeze is lifted:
new measurable-benefit tweaks may be ADDED, under the permanent safety rails (reversible · no-kernel ·
anti-cheat-safe · non-security-weakening · stability-safe). This is the biggest change from the original
scope — the Lab's proving loop is now also the **pipeline that qualifies new catalog tweaks** (a candidate
tweak proves measurable benefit on the bench → clears the rails → rides the mutation-gate QA → joins the
catalog). Each addition is still per-tweak-gated (rollback contract + QA + welfare-check); the POLICY is
open, the per-tweak RIGOR is not relaxed. **Still barred regardless of measurement:** the safety/stability/
security/anti-cheat blocklist (Directive 1). **Still structurally impossible:** GPU-profile apply
(unreadable AMD prior → can't satisfy rollback-first).

**Structurally impossible (don't attempt):** GPU-profile *apply* — AMD profile state isn't user-mode
readable, so it can't satisfy rollback-first (LOCKED rule 3) regardless of rule 6 (`BACKLOG.md:824`).

## 6. Build phases (flag-gated `compy_lab_ground` DEFAULT OFF; each verifiable, P-series eyeball)

1. **Merge + fast path (★ the primary surface)** — merge the Optimize room into the Lab; **"enable all the
   good tweaks" in one action, no benchmarking required** as the lead affordance; collapse the
   bento/guided/classic nav idioms into one slim linear spine; intake router as front door; flag-off
   byte-identity guard. *(Frontend re-org; the existing apply path is unchanged — no new mutation
   primitive.)*
2. **Prove utility (parallel, optional)** — the measure→tweak→prove loop beside the tweaks, incl.
   **aggregate-stack A/B** (measure the whole enabled stack's real delta, the honest cumulative-benefit
   story); wire the Two Futures measured split as the "prove" visual with real `Efficacy` per-part
   emphasis. *(Frontend; reuses existing IPC; may add an aggregate-trial backend path → mutation-gate.)*
3. **The gallery** — the panoramic drag-shell + `TourCamera` fly-to-piece, populated from scoreboard /
   sessions / ledger / black-box (all existing IPC); anti-fabrication empty-state; reduced-motion grid
   fallback; the completion-signal wiring. *(Frontend; new R3F shell over existing primitives.)*
4. **Catalog-expansion pipeline (★ Directive 1)** — the mechanism to qualify + ADD new measurable-benefit
   tweaks: candidate → proves benefit on the bench → clears the safety rails → rides per-tweak
   mutation-gate QA → joins the catalog. Each addition touches `actions.rs`/`history.rs` → **mutation-gate
   + welfare-check per tweak.** Also updates the frozen-catalog doctrine docs (see §7).
5. **Armed-feature test bays (optional, owner nod)** — surface gaming_mode/service_suspend/bloat as
   provable changes in the Lab. *(Wiring of already-armed gates; no new mutation primitive.)*

**Rails (non-negotiable, inherited):** honest measurement (every number measured or honestly absent, no
fabricated trophies) · frontend-first, GPU-cheap, demand-frameloop, pause on blur/game/battery ·
reduced-motion still version · flag-gated DEFAULT OFF + flag-off byte-identical · rollback/TrustSwitch/
mutation boundary untouched (phases 1–3 are zero-src-tauri) · all-original, plain honest voice.

**Verification per phase:** tsc 0 · full vitest (no regress) · flag-off byte-identity guard ·
`self-reviewer` PASS at native 1500×980 · `git diff -- src-tauri` empty for phases 1–3 · ship via the
`ship` skill (silent reinstall + stamp verify) at each eyeball checkpoint.

## 7. Doctrine docs this overhaul must re-sync (the catalog freeze is lifted)

Opening the catalog (★ Directive 1) contradicts the standing "frozen catalog" language in several places —
drift is the project's #1 named risk, so these get updated as tracked step 0 of the build (with the exact
safety-rail framing above; the security/system-settings + rollback-first + no-kernel/no-injection LOCKED
rules are UNCHANGED — only the *freeze* on additions is lifted):
- **`CLAUDE.md` LOCKED rule 6** ("Tweak catalog is frozen (~29 recs) — no new risky tweaks") → reworded to
  the measurable-benefit-under-rails policy. An amendment pointer was added 2026-07-09; the full rule
  rewrite rides the build so the LOCKED wording is changed deliberately, not in passing.
- **`docs/PRODUCT_DIRECTION.md`** (frozen-catalog / "grows upward not sideways" framing) → the catalog now
  also grows by *measured* additions; "sideways into more switches" is re-permitted **when measured + safe**.
- **`docs/RECEIPTS_DOCTRINE.md`** → the aggregate-stack measured-gain is now a first-class marketing engine
  (cumulative "measured X% faster on YOUR rig"); fits the doctrine, worth an explicit line.
- **`docs/RELEASE_STATE.md`** — the mutation-safety posture note references the frozen allowlist; update
  when the first new tweak actually lands (not before — the allowlist is still literally 16 until then).
- **The blocklist** stays documented as-is but reframed: split into "safety/anti-cheat (permanent)" vs
  "unmeasured-until-proven (candidate)."

---

## 8. ★ PHASE-1 REDO — the blended spine (concrete build design, 2026-07-09)

> **Why this section exists.** The first phase-1 build (`d0e30f5`) was a **verbatim merge** — `LabGround.tsx`
> literally stacked `<Check embedded>` + `<Fix view="fixes">` in a `.lg-fast` box ABOVE a demoted
> `<Lab v2 ground>` in a `.lg-utility` box, joined by a paragraph. **The owner rejected it (2026-07-09):**
> *"do not just copy paste over the merge … recreate a blended and brand new LAB with the migration of the
> optimize tab features incorporated into the lab."* Two surfaces bolted together is not the blend. This
> section is the concrete architecture that makes it ONE cohesive room. **The owner does not want a preview
> ping until the WHOLE marathon (this + §2/§3/§5) is complete** — build straight through, flag stays
> `compy_lab_ground` DEFAULT OFF the entire time (his live look never changes), self-review + ship + eyeball
> only at the very end. Memory: [[lab-no-copypaste-full-marathon]].

### 8.1 The core move — ONE numbered spine, the fast path is station #1

Collapse "fast path above / utility below" into a **single numbered progression** where the tweak-apply IS
the first station, in the Lab's own instrument language. The re-weighted spine (Directive 2 — the stuff
users came for leads; proving is the adjacent utility):

```
  1 OPTIMIZE          2 DIAGNOSTICS   3 BENCHMARK      4 LATENCY    5 TUNING     6 BLACK BOX
  "make my PC     →   know your   →   prove a       →  cut input →  cool+quiet → explain a
   faster, safely"    rig             change moved      lag         (AMD)        crash
  enable the safe     (existing measure→prove instruments, unchanged bodies, renumbered)
  stack in one tap
  (no benchmark)      ← this whole tail is the OPTIONAL "prove it yourself" utility →
```

- **Station 1 "Optimize" is a NEW `LabStationKey`** added to `lab-guided-data.ts` — same four-line station
  contract (`for` / `when` / live `reading` / `connects`) as every other station, so it reads as a native
  member of the spine, not an embedded foreign room:
  - `forLine`: "Enable the safe, vetted tweaks for your rig — in one tap."
  - `whenLine`: "You just want it faster and safe, without fiddling."
  - `connectsLine`: "Prove the stack you just applied → Benchmark (station 3)." *(threads INTO the utility —
    this is the cohesion: the fast path points at the proving loop.)*
  - live `reading` (new `stationReading` branch, one-source from the same `recs`/`changes`/`activeCount`
    the verdict uses): unapplied safe tweaks → "N safe tweak(s) ready to enable."; all applied →
    "Safe stack applied — your rig is set. Prove it below, or you're done."; honest singular/plural, no `(s)`.
- **The intake router (`LAB_ROUTER`) gains a LEAD row** routing to `optimize`:
  `symptom` "I just want my PC faster — safely, no fiddling" · `station: "optimize"` · `because` "it enables
  the safe, vetted tweaks for your rig in one tap — undo any time." This makes "just make it fast" the first,
  most prominent intake choice (the assumed-majority path), and every other row still routes into the
  measure spine. The router already filters to stations the rig has, so `optimize` shows whenever recs exist.
- **Numbering is computed** over `stationKeys` (already gate-filtered) exactly as today — station 1 falls out
  of the order array, never hardcoded.

### 8.2 Station-1 body — reuse the audited apply logic, NOT the Optimize look

The body of station 1 renders the tweak-apply UI, but presented as a Lab station (this is the "native, not
pasted" requirement):
- **Logic reused (must NOT be forked — it is the audited rollback-first mutation path):** the same
  `onApplyBatch` → `apply_recommendations_batch` (ONE UAC), per-row `onToggleRec`/`onRollback` undo, the
  pre-ticked safe batch. Threaded down from `App.tsx` (LabGround already receives every one of these props).
- **Presentation unified to the Lab:** the station body is a purpose-built **`OptimizeStation` component**
  (new, `src/surfaces/lab/OptimizeStation.tsx`) that renders the enable-all hero action + the safe-tweak
  review list in the **Lab station's visual language** (station-card rows, hairline log register, mono tags —
  the `hud-rooms.css` instrument skin), NOT the `.ov2-*`/`.slim` Optimize chrome. It composes the existing
  **row/apply primitives** where they are already Lab-neutral (the slim reviewed-list row from `Fix.tsx`
  is a candidate to extract into a shared `TweakRow`; if extraction is too broad for this pass, wrap
  `<Fix view="fixes">` but re-skin its container under `[data-room="lab"]` so it inherits the station look —
  the CSS-only cohesion approach, already used for the fix-room skin, extended so there is NO visual seam).
  **The bar to clear: a screenshot of station 1 must read as the same room as stations 2–6 — same card
  radii, same type register, same accent behavior — with zero "this is the old Optimize panel" tell.**
- Check's broader system-hygiene categories (startup / bloat / preload / leftovers / nic) are **secondary**
  to the enable-all — fold them under a "More cleanup (optional)" disclosure inside station 1, so the hero
  stays the one-tap safe stack (Directive 2: most users enable-all and never look back).

### 8.3 Wiring + files

- `lab-guided-data.ts` — add `"optimize"` to `LabStationKey` + lead of `LAB_STATION_ORDER` (ground mode
  only — see below), `LAB_STATIONS.optimize` contract, `LAB_ROUTER` lead row, `stationReading` branch
  (new `LabStationFacts` fields: `safeReady: number`, `stackApplied: boolean` — pure, derived by the caller
  from `recs`/`isAppliable`/`activeCount`/`reverted`, zero new IPC).
- **The 5-station measure spine must stay byte-identical when NOT in ground mode.** `optimize` is a
  ground-only station: `LAB_STATION_ORDER` stays the 5-station measure order; ground mode prepends
  `"optimize"` via a `groundStationKeys` derivation (`ground ? ["optimize", ...stationKeys] : stationKeys`)
  so classic/guided/bento (all non-ground) are provably untouched — flag-off byte-identity holds by
  construction and the existing `lab-guided`/`lab-bento` guards keep passing.
- `Lab.tsx` — accept the fast-path props (`recs`, `startup`, `changes`, `busyId`, `isAppliable`,
  `activeChangeFor`, `onToggleRec`, `onToggleStartup`, `onRollback`, `onApplyBatch`, `onOpenLibrary`,
  `sessions`, `gpus`, `readiness`, `activeCount`) as **optional** props used ONLY in `ground` mode to render
  station 1's `<OptimizeStation>` body via `stationBody("optimize")`; `STATION_ICON.optimize` (a "bolt"/
  "spark" glyph). Non-ground paths never read them → untouched.
- `LabGround.tsx` — becomes thin: it no longer stacks Check/Fix/Lab; it renders `RoomShell(room="lab")` with
  the unified verdict + `<Lab v2 ground {...fastPathProps} diagnostics=… />`. The `.lg-fast`/`.lg-utility`
  seam sections and `LabGround.css` are DELETED (the seam is the defect). The verdict stays fixes-first
  (`optimizeVerdict`) — correct under Directive 2.
- CSS — retire `LabGround.css`; the station-1 skin lives in `lab-v2.css`/`hud-rooms.css` (existing guarded
  files) or a new `lab-optimize-station.css` **added to `tokens-v2-guard.test.ts`'s `V2_CSS` array** (§8 of
  the inventory — any new V2 stylesheet must be in the guard or scoping goes unchecked).

### 8.4 Guards + verification (this phase)

- Flag-off byte-identity: `compy_lab_ground` OFF → App mounts `LabV2`, the 5-station measure spine and the
  Optimize room are provably unchanged (extend `lab-ground.test.tsx`).
- Ground-mode spine: station order is `["optimize", ...gatedMeasureStations]`; router lead row present +
  routes to `optimize`; `stationReading("optimize", …)` singular/plural + honest "applied" state; the
  apply batch still calls `apply_recommendations_batch` (one UAC) unchanged.
- `stationBody("optimize")` renders `OptimizeStation` and NONE of the other nav idioms leak the station.
- tsc 0 · full vitest no-regress · `tokens-v2-guard` green (new CSS registered) · **`git diff -- src-tauri`
  EMPTY** (phase 1 is pure frontend re-org; the apply path is untouched) · `self-reviewer` PASS at native
  1500×980 with the explicit **"station 1 reads as the same room as 2–6, no Optimize-panel tell"** check.
- **No ship / no owner ping at this phase** — the marathon continues into §2 (prove-utility + aggregate A/B +
  Two Futures per-part), §3 (gallery), §5 (armed bays). Ship + stamp + doc rows + eyeball happen ONCE at the
  end, when the whole blended environment is cohesive.

### 8.5 Build order for the marathon (no preview pings between)

1. **§8 blended spine** (this section) — the cohesive room + native station 1.
2. **§2 prove-utility** — aggregate-stack A/B (the honest cumulative-benefit story) + wire the Two Futures
   measured split as the "prove" visual (`RigPart glow` ← `partGlow(efficacy, partId)`, per-part emphasis).
3. **§3 telemetry gallery** — panoramic drag-shell over the existing rig primitives + the `TourCamera`
   fly-to-piece (lift `HardwareTourScene`'s `TourCamera` into a shared helper); populate from scoreboard /
   sessions / ledger / black-box (all existing IPC, `src/types.ts`); anti-fabrication empty state
   ("prove a tweak to earn your first piece" → loops to station 1); reduced-motion static grid; the
   completion-signal wiring (a proven Keep lights the gallery — the terminal room's missing payoff).
4. **§5 armed-feature bays** — surface `gaming_mode`/`service_suspend`/`bloat` as provable changes (wiring
   of already-armed gates; no new mutation primitive).
5. **Finalize** — full self-review, all guards green, `git diff -- src-tauri` empty (phases 1–3) / mutation-
   gate for anything in 5 that touches the boundary, ship via the `ship` skill (reinstall + stamp), doc rows
   (RELEASE_STATE / BACKLOG / UI_VISION), THEN the single owner eyeball of the finished Lab.

**Phase 4 (catalog EXPANSION — real new tweaks) is a SEPARATE gated track, not part of this UI marathon:**
every new tweak crosses the mutation boundary and needs its own welfare-check + apply/rollback QA + mutation-
gate (Directive 1 + LOCKED rule 6). The proving-ground UI built here is the *pipeline* that qualifies
candidates; adding actual tweaks still comes to the owner per-tweak.
