# CC TASK TRAIN — FirstCheck + Monitor redesign · launch runway (Cowork handoff, 2026-07-06)

> Owner-greenlit, from the owner's live-build audit (4 screenshots) + Cowork repo recon.
> **Lane split per the token-routing protocol (2026-07-01):** T0–T3 are CC BUILD tasks — run them
> as one SPORT-MODE train (build → verify → commit → push per task, batch questions to the end).
> R1/R2 run in the **COWORK lane in parallel** — owner directive 2026-07-06: **saturate the
> remaining Fable window with builds** (on-plan ends ~Jul 7; unused capacity has zero salvage
> value). Research is not routed away to save tokens — it's routed parallel so CC never idles
> waiting on it. CC's window fills as: **T0–T3 now → T4 (owner-picked R1 components, appended
> same-day) → T5 filler if turns remain.**
> Standing laws apply as written in CLAUDE.md (self-review before any UI done-claim ·
> ship-reinstall + stamp-verify after any build · terse reports: hash · what · verify · flags).

**HARD LINES for this train:** frontend-only for T1–T4 — their combined `git diff -- src-tauri/`
must stay EMPTY (**T6 is the ONE sanctioned src-tauri task**, mutation boundary, full
mutation-gate rigor, x-high effort) · no locked-gate crossings · LOCKED aesthetic direction stands (restrained operator-console
Stark-HUD; **never gamer-RGB/neon**) · any new vendored React Bits component follows the vendor
law (theme tokens only, vendor purple can never paint — test-pinned, reduced-motion gated) ·
honest-measurement law: presentation pacing is fine, fabricated work/progress is not.

---

## T0 — Pre-flight: pin what the owner is actually looking at (~2 min)

Screenshots may predate today's `394dd2f` install. Stamp-check live vs HEAD (embedded
`COMPY_GIT_HASH` on the installed exe). If stale → ship-reinstall first, then re-judge T1–T3
symptoms against the live build before building anything.

**Known fact regardless of stamp:** the React Bits Stepper shipped default-ON (`76cfb5e` →
`96febda`) on the **Setup & Tour footer progress row ONLY**. `src/surfaces/FirstCheck.tsx` has
no Stepper import — the first-check/re-run screen was never redesigned. The owner's "did it go
live?" answer: yes, but on a different surface than the one he screenshotted. T2 symptom
survives the stamp check by construction.

## T1 — FirstCheck verdict state: kill the doubled 16-check list (bug, quick)

**Symptom (owner screenshot):** in the completed/verdict state the full check list renders
TWICE back-to-back — the live run-list persists above `VERDICT`, then the collapsible
"`N checks measured perfect — confirmed right on this rig`" (`FirstCheck.tsx:164`) repeats
every row again. Pure redundancy; also cheapens the verdict moment.

**Do:** ONE canonical list in the final state. The run-list should resolve INTO the verdict
(collapse/transform on completion), with the collapsible carrying the detail — not both stacked.
Verify the fix on BOTH entry paths (first run and re-run from Settings/Lab, whatever reaches
this surface).

**Guard (bug→guard):** vitest pin — verdict state renders each check title exactly once.

## T1.5 — Owner-caught LIVE defects (eyeball report 2026-07-06) — bug→guard applies to both

Owner verdict on the live build (`394dd2f`): "everything looks really good" + TWO defects:

1. **Hologram flicker (Home):** intermittent glitchy visual flicker on the hologram bay.
   Diagnose on hardware BEFORE beautifying — do not build T4d's holo-material on top of an
   undiagnosed flicker; fix lands with or before T4d. Leads (unconfirmed — verify, don't
   assume): ElectricBorder animation loop · scanline overlay compositing · drag-orbit/parallax
   rAF interplay · WebView2 GPU/driver fallback. Guard: mechanized if possible (CDP
   frame-capture diff), else a permanent self-review rubric item (observe the bay ≥10s at
   native res, state observed frame behavior).
2. **Tab/room-switch delay:** perceptible lag clicking between rooms. Profile BEFORE T4c —
   the ambient skin adds backdrop-filter layers and unbudgeted it could compound this; T4c
   must not regress switch latency (state the measured before/after in its self-review).
   Find the actual cost (mount-time render? effect re-init? style recalc?), fix, guard with an
   interaction-timing check (automated if mechanizable, else rubric line with measured ms).

## T2 — FirstCheck run screen: stepper-language redesign (owner verdict: "stale and sloppy")

**Current:** flat static row list in a mostly-empty window (`FirstCheck.tsx`, 196 lines),
16 checks flash by in ~0.9s. No progression affordance, no relationship to the Setup & Tour
stepper the owner approved.

**Do:** redesign the *running* state in the stepper/HUD idiom so Setup & Tour + FirstCheck read
as one system — active check prominent with an in-progress affordance, completed checks compress
into a stack, pending checks queued; use the vendored `Stepper` primitives
(`src/design/vendor/Stepper/`) or the HUD register (micro-labels, mono readout, hairline rules)
— CC's creative call within the locked direction. Fill the frame; the dead space in the owner's
screenshot is part of the "sloppy" verdict.

**Pacing:** a 0.9s run makes any per-check reveal illegible. Min-step pacing for legibility is
presentation, not fabrication — keep the total reveal short (~3–4s ceiling) and let a click skip
to the verdict. Never imply measurement is still running after it finished (the `0.9s` readout
in the header stays honest).

**Rails:** theme tokens only · reduced-motion fallback · follow the established classic-failsafe
pattern if the DOM change is deep (preview flag → owner eyeball → default-ON, same as the last
three trains). Self-review verdict required before done-claim.

## T3 — Monitor room: summary-first re-layout (owner: visual clutter / sensory overload)

**Current:** `src/surfaces/MonitorBasic.tsx` stacks every sensor as a full-width row — CPU block
then a ~9-row GPU block, everything at equal visual weight, long scroll, all detail all the time.

**Do:** summary-first instrument cards — compact card per domain (CPU · GPU · Memory · per-core
grid) showing headline value + spark, expanding or flipping to the full detail view on click.
Owner explicitly pointed at reactbits-style card interactions — the vendor shelf already holds
candidates (`MagicBento`, `SpotlightCard`, `GlareHover`, `CountUp`); vendor anything new per the
law. Keep the layout "cool and fun" but inside the sleek high-class HUD register — restraint
beats gimmick, never neon.

**Must keep:** every current reading reachable in ≤1 click (this is a diagnostics surface —
summary-first, never summary-only) · the kernel-driver CPU-temp explainer (once) · the
ETW/anti-cheat line · HUD masthead. **Perf rail:** the monitor page must stay cheap *while
monitoring* — no continuous GPU-hungry animation; flip/expand transitions are event-driven;
chart cadence unchanged. An optimizer that costs frames while you watch it kills its own pitch.

**Guard:** self-review + pins for the new interactions (expanded state shows all rows; collapsed
state count; reduced-motion path).

## T4 — R1 picks (owner decision 2026-07-06: **ALL FOUR** — parallax deferred)

Full sourcing detail per option: `2026-07-06-design-rnd-options.md`. Fold the surface-riders
into their host tasks where natural instead of double-passing a file. Every T4.x: vendor law +
THIRD_PARTY.md entry + test pins + self-review; classic-failsafe flag where DOM change is deep.

- **T4a (rides T2) — Boot & readout theater, FirstCheck:** split-flap/scramble reveal on check
  rows (Aceternity Text Flipping Board or the vendored DecryptedText), terminal readout idiom,
  HUD-bracket draw-on. **NEW DEP APPROVED by owner: GSAP core + ScrambleText/DrawSVG** (license
  verified free 2026-07-06; pin the version; reduced-motion = static reveal). Build WITH T2.
- **T4b (rides T3) — Instrument gauges, Monitor:** Animata Gauge/Donut/Battery (MIT) ported to
  token CSS on the summary cards · sliding-number live values (reimplement if the Motion
  Primitives license can't be verified) · Magic UI Flickering Grid card-face backdrop at whisper
  opacity. Build WITH T3.
- **T4c — Ambient HUD skin, app-wide:** CSS-only pass — scanlines · `feTurbulence` grain ·
  `backdrop-filter` glass · holo-foil verdict headlines (OKLCH, accent-driven). Zero deps;
  systematizes the existing HUD-room scanline DNA; reduced-motion static by construction.
- **T4d — Hologram bay v2, Home:** vendor `threejs-holographic-material` (MIT) as source;
  `hologramColor` wired to theme accent; `@react-three/postprocessing` Bloom + event-triggered
  Glitch; **`frameloop="demand"`** so idle GPU ~0; check the three.js `<0.185` peer pin.
- **T-LATER (queued, NOT this train):** pointer-parallax/3D-tilt depth layer on cards/bento —
  owner deferred until T0–T3 have landed.

## T5 — REQUIRED (was optional; owner decided 2026-07-06: beta ships from `main`): fresh installed-build QA sweep

The owner resolved RUNG 1 — the beta artifact is **current `main`**, not the frozen `16069fa`.
That makes this QA mandatory before any send: current `main` has never had a fresh full §6/§7
installed-build pass (last full pass = the frozen 2026-05-31 beta). Run the CC-runnable parts
against the live install — apply/rollback spot-checks through the audited path, Gaming Mode
session cycle (harness cases), ledger integrity, overlay, FPS capture. **Dependency: run the
Gaming Mode cases only AFTER T6 lands** (single-prompt elevation) — QA the shipping UX, not the
retiring one. **GAMING_MODE_QA.md live checklist case #4 (full reboot while Active) stays
owner-run** — prompt the owner for his 5-minute reboot test when everything else incl. T6 is
green, then check the box in that doc.

## T6 — Gaming Mode enable: collapse 5–6 UAC prompts to ONE (owner-caught 2026-07-06, BLOCKS T5's Gaming Mode cases + the owner reboot test)

**Symptom (owner, live build):** enabling Gaming Mode fires ~5–6 separate UAC/PowerShell
prompts. Owner verdict: "unacceptable and tedious... huge red flag." He's right — one intent,
one consent.

**Execution order: T6 runs BEFORE T5's Gaming Mode session-cycle cases and before asking the
owner for the reboot test** — QA must validate the final UX, not the one being replaced.

**Do:** diagnose first — enumerate exactly which actions in session-start elevate and why each
spawns its own `run_elevated_powershell`/`--run-elevated` relaunch. Then batch: ONE elevated
invocation carrying the session's full elevated payload, ONE UAC prompt. Semantics that MUST
survive (this is why it's x-high at the mutation boundary):
- **Cancel at the single prompt = no-partial** (today's proven contract, now trivially true —
  nothing ran).
- **Per-item honest outcomes inside the batch** — partial failure mid-batch still writes honest
  per-action ledger records; `elevation_outcome` 4-way attribution preserved.
- **Rollback contracts captured per action at apply time, unchanged** — each item individually
  undoable from `history.json` alone; exact-restore re-proven (the service-suspend QA class).
- Advanced-tier toggles (USB-SS / PCIe-ASPM): fold into the same single prompt if enabled at
  start; a second prompt is acceptable ONLY for a genuinely separate later user action.

**ABSOLUTE LINE (standing rule, precedent 2026-06-10):** the fix is batching OUR elevated work.
NEVER touch UAC policy/system security settings (`EnableLUA`, `ConsentPromptBehaviorAdmin`,
`PromptOnSecureDesktop`, anything under Policies\System) — not even to diagnose, not even
reversibly. That's owner-territory welfare-check, full stop.

**Guard (bug→guard):** cargo test pinning session-start requests elevation AT MOST ONCE
(count elevated invocations per start at the dispatch layer) + the existing no-partial and
exact-restore suites re-run green.

---

## R1 — [COWORK LANE] Broad component/library R&D → **DONE 2026-07-06**: options menu at
`docs/superpowers/specs/2026-07-06-design-rnd-options.md` — owner picking; picks become T4.x.

**Scope is deliberately WIDE (owner directive: React Bits' 13 vendored components are an
inventory, not a ceiling).** Cowork sweeps the current landscape — reactbits full catalog,
21st.dev, Aceternity, Magic UI, shadcn ecosystem, motion.dev/framer showcases, GSAP, arwes and
sci-fi/HUD frameworks, R3F/drei 3D + hologram/parallax patterns, shader/particle backgrounds,
and whatever is genuinely trending 2025–26 — and returns **3–5 concrete direction options**
with, per candidate: specific components, license, vendorability ($0 in-repo per the vendor
law vs npm dep vs owner-gated v0/Figma credits), WebView2/Tauri-2 perf feasibility,
reduced-motion story. Owner picks; picks become T4 the same day so builds ride the Fable
window. Direction itself is **already LOCKED** (operator-console Stark-HUD, hologram/JARVIS
layer, never neon) — this extends it, it does not reopen it.

## R2 — [COWORK LANE] MVP launch runway → **DONE 2026-07-06**: LAUNCH RUNWAY section is live in
`docs/BACKLOG.md` (above the HQ STEERING LOG). **NOTE FOR CC: the working tree carries
uncommitted Cowork docs** (this spec · `2026-07-06-design-rnd-options.md` · the BACKLOG runway
section) — fold them into the train's docs commit. Original scope, for the record:

Sweep for unfinished surface (TODO/`todo!`/`unimplemented!`/stub UI/dark gates) and reconcile
`RELEASE_STATE.md` blockers + `BACKLOG.md` + roadmap-sequencing into **one ordered LAUNCH RUNWAY
section in BACKLOG.md** (item · lane · gate/owner-decision · size), from current state to the
first public-launch build. A new PRD doc is a NO — doc drift was the external audit's #1 risk,
and `docs/PRD.md` already exists as a marked historical baseline. Open owner decisions the
runway must surface, per RELEASE_STATE: beta artifact choice (`16069fa` vs `main` + fresh
installed-build QA) · Gaming Mode reboot-while-active QA · code signing route · legal drafts.

---

## TRAIN STATE (CC session handoff, 2026-07-07 ~09:15 — T0–T4 + T1.5 SHIPPED + LIVE)

All code ON MAIN, pushed, **shipped + stamp-verified live**. T0 ✓ · T1 `8c9b711` ✓ · T2+T4a
`8f37161` ✓ · docs `b64f046` ✓ · T3+T4b `d170c66` ✓ · **T4c+T4d `bf76a07` ✓ self-review PASS**
(theme-accent tracking, explode/Glitch settle, reduced-motion pixel-identity, grain/glass/foil
legibility) with ONE FAIL fixed: orbit-opt-in was hardcoded ON in HomeHud's copy of the control
→ `3a078d1` + `hologram-orbit-optin-guard.test.tsx` (4 pins, red→green) · **T1.5 BOTH RESOLVED
`b6687b3`**: #1 flicker = the idle-repaint class, GL-draw-probe diagnosed — old installed build
~25.5k draws/sec at rest (fan-poll reference churn + unmemoized RigHologram re-commits) → **0
draws/15s at rest on the NEW installed build**, orbit-on still animates (~30k/s); guards:
`fan-sensors.test.ts` (5 pins) + self-reviewer **rubric item 8 "Canvas idle rest"** (+ the
5-leg switch circuit for room-shell/overlay diffs) · #2 switch-lag: content-swap fast on BOTH
builds (before 16–22ms / after 16.6–23.7ms, 5-leg circuit ×2) — T4c regresses nothing; the
perceived lag's plausible mechanism was #1's churn; **owner eyeball = the final word on both**
· Cowork docs folded `ce060ed`. **SHIPPED: installer SHA-256 `B29AB4…F4A186` built from
`ce060ed`, live stamp `ce060ed · release` EXACT, one installer on the Desktop.** (First attempt
from `e01db2d` stamped `+dirty` — docs WIP in tree at compile time; the measure-worker refused
it, resolved by the fold + clean rebuild. GSAP approved but unused; `@react-three/
postprocessing@3.0.4` vendored-in per THIRD_PARTY.md.)

**2026-07-07 (later, CC session): Two Futures + bay clear-spot landed BETWEEN the handoff and
T6** — owner explicitly pulled the post-runway Two Futures spec forward the same day (his order
asserted "RUNG 2 done"; verified NOT true — T6/T5/reboot#4 remain open, but the train is
frontend-only/flag-OFF and moves no gate, so built per the explicit order). `209e4dc` bay-shell
`clearSpot` (owner image ask, live default) · `4df5448` Two Futures v1 (`compy_two_futures`
DEFAULT OFF) · `eb5df81` self-review fixes (efficacy-card subsume + azimuth clamp, guard-pinned).
tsc 0 · vitest 1099/1099 · self-reviewer PASS (fresh full pass at eb5df81). Details:
`2026-07-07-two-futures-measured-split.md` (status + v1 scope decision recorded there).
**Next steps below are UNCHANGED — T6 still first, still a fresh session.**

**Next steps, in order:**

1. **T6 — START A FRESH SESSION** (mutation boundary, x-high, `mutation-gate` skill FIRST;
   Cowork-audit-worthy diff). Diagnosis already DONE (this session): the ~5–6 prompts =
   per-service `apply_service_suspend` (one elevation each, ≤4) + USB + PCIe (one each), fired
   sequentially by `gaming_orchestrator::start` (`gaming_orchestrator.rs:108`). The audited
   batching machinery ALREADY EXISTS: `ElevationDeferral` sink + `compose_batch_script` +
   `parse_batch_receipts` (`actions.rs:613`→`:780`); mirror the production two-phase pattern of
   `apply_recommendations_batch` (`history.rs:588-726`): phase-1 sink-armed applies with
   cursor-range attribution → persist unelevated receipts → phase-2 ONE elevation, per-item
   file receipts → confirm-then-record; UAC-decline = honest per-item skip. Session-semantics
   decision at build time: today ANY apply error (incl. UAC-cancel) aborts + restores the WHOLE
   session — preserve that exact no-partial contract under the batch. Guard: cargo pin ≤1
   elevated invocation per session start (count at the dispatch layer) + no-partial +
   exact-restore suites green.
2. **T5 — REQUIRED** (beta ships from `main`, owner decision 2026-07-06): fresh installed-build
   QA sweep, CC-runnable parts, AFTER T6 so it QAs the shipping UX; then prompt the owner for
   GAMING_MODE_QA.md live case #4 (reboot-while-active, ~5 min, owner-run).

## Report format (standing)

Per task: `hash · 1–2 line what · one verify line (tsc/vitest/self-review/stamp) · flags`.
Batch all questions to the end of the train.
