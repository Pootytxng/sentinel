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

### A. The JARVIS interaction / motion layer — his ranked effect plan, NEVER BUILT
Source: `docs/superpowers/specs/2026-07-05-ui-deslop-organic-directive.md:111-176`. The de-slop
directive's redesign lane is marked "COMPLETE," but that only covered the **Instrument-HUD reskin**.
The **motion/interaction effect plan** the owner was most excited about was scoped, given a specific
tech stack, then bypassed — the shipped work used CSS/native React instead. **VERIFIED 0 files in
`src/`** for panoramic / magnetic-cursor / Lenis (2026-07-08). His ranked plan:

1. **Panoramic inertia-drag telemetry gallery** — the "drag to explore a 3D space" feel from the
   site he built for his sister (`sister-site-tau.vercel.app` / Prickly Creations, reviewed
   2026-07-05, `:120-125`), pointed at benchmarks / sessions / receipts as clickable pieces in a
   draggable telemetry space. *His own "highest wow" item.* **NEVER BUILT (VERIFIED).**
2. **GSAP data-reactivity** — gauge sweeps / count-ups / shader uniforms animated FROM live metrics
   (honesty win: motion serves real data). Chosen stack `:135-137`. GSAP was "deferred"; a CSS ring
   gauge + CountUp shipped instead. **NOT BUILT as specified.**
3. **Magnetic cursor + mouse-tilt parallax** — only a small event-parallax on Home's annotation
   plane shipped. Magnetic cursor: **NEVER BUILT (VERIFIED 0 files).**
4. ~~Rig hologram: click-a-component-for-live-specs + boot/scan sweep~~ — **SHIPPED (verified
   2026-07-08).** Clicking a part pins its live spec card (`RigPart.tsx:82` `onClick`→`onSelect`,
   card renders while `active`); drag-orbit + scan sweep shipped. **Only residual: a copy gap** —
   `RigViewer.tsx:81` hint reads "hover a part for its live specs," never mentions click. Fold a
   one-line fix ("hover or click") into the motion train.
5. **Lenis smooth-scroll spine** tying the rooms together. **NEVER BUILT (VERIFIED 0 files).**
6. **Room-transition "instrument retune" wipe** + Monitor meters as living oscilloscope traces
   (Home got one trace; Monitor rollout is partial). **NOT BUILT / partial.**

> This whole block reads as a **quiet substitution** — BACKLOG.md:53 says "use tooling only if a
> room's language demands it," which silently swapped the entire ranked plan for the CSS reskin. If
> the owner wants the motion layer, it needs its own spec'd train (flag-gated, DEFAULT OFF, honest
> data, reduced-motion-safe, GPU-cheap — the directive's HARD RAILS at `:41-46,163-172`).

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
bento/guided/classic into one). Frontend-only (`git diff -- src-tauri` EMPTY), flag-off byte-identity test-pinned;
tsc 0 · vitest 1128 · self-reviewer PASS. **Slice-1 scoping (reversible, awaiting owner confirm):** Optimize's
CONTENT is in the Lab, but the Optimize rail TAB removal + full rail collapse is DEFERRED to a next slice — during
preview both surfaces exist, undo stays reachable. **Phases 2 (prove utility + aggregate-stack A/B) · 3 (telemetry
gallery = §A.1 panoramic lands here) · 4 (catalog-expansion pipeline) · 5 (armed-feature bays) remain OPEN.**
⏳ Owner: flip Settings → Appearance → "Lab proving ground (preview)", open Lab, react + confirm the slice-1 direction.

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

### G. Site / landing glow direction + the dormant "full overhaul" gate
The 2026-06-12 voice-baptism directive queued: **§B0 site glow** (landing "mediocre/bleak" → artistic
aurora/glass/silk-light ambient), **§B app visual-refinement marathon**, and **§C FULL OVERHAUL** —
an owner-empowered trigger (*"only if §B underwhelms the owner"*) that **no later doc ever revisits**.
Site work belongs to the compy.gg web phase, but the trigger is dangling and should be resolved (still
armed? dropped?). Source: `docs/superpowers/specs/2026-06-12-doctrine-voice-baptism-design-refresh.md:31-80`.

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
