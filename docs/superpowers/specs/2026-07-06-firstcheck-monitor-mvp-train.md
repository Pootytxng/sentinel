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

**HARD LINES for this train:** frontend-only — `git diff <base>..HEAD -- src-tauri/` must stay
EMPTY · no locked-gate crossings · LOCKED aesthetic direction stands (restrained operator-console
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

## T5 — OPTIONAL Fable-window filler: fresh installed-build QA sweep on `main`

If T0–T4 complete with window remaining: RELEASE_STATE flags that current `main` has never had
a fresh full §6/§7 installed-build pass (last full pass = the frozen 2026-05-31 beta). Run the
CC-runnable parts against the live install — apply/rollback spot-checks through the audited
path, Gaming Mode session cycle, ledger integrity, overlay, FPS capture. **Reboot-while-active
stays owner-run.** Verification work, zero new risk surface, directly burns down a launch
blocker.

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

## Report format (standing)

Per task: `hash · 1–2 line what · one verify line (tsc/vitest/self-review/stamp) · flags`.
Batch all questions to the end of the train.
