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
4. **Rig hologram: click-a-component-for-live-specs + boot/scan sweep** — drag-orbit + scan sweep
   shipped; click-a-part-for-specs is **partial/unconfirmed** (RigPart/RigViewer exist; the
   specs-on-click interaction needs verification).
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

### C. Lab room establishment — owner supplies the task list (PARKED on him)
Owner (2026-07-07) has a plan for what the Lab room should actually DO (interactive functions/apps).
The whole "Lab-establishment train" is parked awaiting his list. Folds in B above + Two Futures v2
(persist-latest Rust read + trial-sourced split). **Owner-bound.**
Source: `docs/OWNER_ACTION_CHECKLIST.md:38-44`, `docs/BACKLOG.md:152-158`.

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

### H. Onboarding HoloLens Setup & Tour redesign — shipped-status unconfirmed
Owner (2026-06-19) redesigned the hardware-tour to fly the camera across the user's REAL rig in his
specified order (**power → storage → graphics → processor → memory**), re-runnable from Home in a
HoloLens style. SetupTour exists live, but whether the full hardware-tour redesign as specced shipped
is **unconfirmed by any doc** — needs verification.
Source: `docs/superpowers/specs/2026-06-19-onboarding-holo-setup-tour.md:3-7,29-53`.

---

## 🟡 NEEDS VERIFICATION — owner asks whose "done" is claimed-but-code-unchecked

Pulled from spec status lines; verify against `main` before trusting. Move each to ✅ or 🔴 once checked.

- **"Full tidy" — inherent left-to-right usage order** (like reading a book, know the sequence).
  Ground-up rewrite was rejected in favor of the P6 Journey "forward-doors" pass — a substitution.
  `docs/superpowers/specs/2026-07-02-full-tidy-directive.md:1-8`.
- **V2 "four asks"** — flat/blanket sections need real layering; hologram auto-scale to any window;
  "What's this?" in-place hover not a context-yanking link; Optimize nav jank.
  `docs/superpowers/specs/2026-07-03-v2-default-and-polish-sweep.md:7-19`.
- **Restore the hardware grid (CPU/Memory/Graphics/Network) to Home** — owner-caught regression.
  `docs/superpowers/specs/2026-06-08-restore-hardware-grid-home.md` (acceptance line unticked in-doc).
- **Monitor room default = Sessions, not Live** (owner pick). `docs/superpowers/specs/2026-06-21-monitor-restructure-design.md:3`.
- **Elastic/erratic-window adaptive layout** — "adapt structure as the window is dragged/stretched."
  `docs/superpowers/specs/2026-06-06-elastic-window-pass.md` (reads resolved-in-doc, final blessing uncaptured).
- **Intuitiveness sweep** — full-app "weed out even the slightest confusion" mandate.
  `docs/superpowers/specs/2026-06-20-intuitiveness-sweep.md:1-3`.
- **Beta Feedback #3** six-part list (clean-exit ghosts, exact Learn links, flatten Play dropdown,
  Apply-all, Learn progressive-disclosure, Settings wordmark, URL-paste honesty).
  `docs/superpowers/specs/2026-06-06-beta-feedback-3.md`.
- **"Show me" walkthroughs** (VRR etc.), **naming** (Fix→Tune, Learn→Blackbook, Ledger→"Receipts"),
  **icon** heartbeat-inside-the-C + "the C is so plain" redesign, **Hearth "Warm Ember"** hand-tuned hex.
  `2026-06-06-show-me-walkthroughs.md` · `2026-06-12-naming-proposals.md` · `2026-06-06-halfway-home.md:81-87` · `2026-06-05-compy-design-system.md:133-148`.

---

## ⚠️ THE ORIGINAL LIST THAT ISN'T IN THE REPO
`docs/superpowers/plans/2026-06-21-roadmap-sequencing.md:4` sources the whole 150-item plan from the
owner's **"Feature Roadmap Checklist (CC Brief)"** — but that original document is **nowhere in the
repo**; only Claude's derived Phase A/B/C/D re-classification survives. If "the list you made" is this
CC Brief, it is not recoverable from git — **the owner would need to re-share it.** (Mostly backend/
feature scope, not visual, but flagged because it's the one genuinely-missing source document.)

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
