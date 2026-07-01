# UI Slim-Down — session handoff / re-run brief

> Created 2026-07-01 (Cowork). Paste the **Kickoff prompt** below into a new Cowork session
> (Fable 5 or any model) to continue this work. The brief is model-agnostic. The Space carries
> your memory across sessions, but **file access does not** — the new session must attach the
> repo folder before it can read anything.

---

## ▶ Kickoff prompt (copy everything in this block)

```
Continue Compy's UI slim-down work.

FIRST: attach my repo folder  C:\Users\Kuya\code\sentinel  so you have file access. (Adding
this chat to the Space only gives you memory/context, not files.) Then READ before doing
anything: docs/mockups/UI_SLIMDOWN_HANDOFF.md (this brief), docs/UI_SLIMDOWN_PLAN.md (the plan +
council review), docs/mockups/ui-slimdown-preview.html (the v1 mockup), DESIGN.md, ui-spec.md,
and the src/surfaces/rig/ directory (RigHologram.tsx / RigViewer.tsx — the 3D rig).

CONTEXT: last session you researched competitors + audited the app + wrote a slim-down plan. The
thesis is right and approved — "one question per room, one primary action, answer first, detail
on tap" — killing multi-affordance rows (~8 controls per rec row), triple flag-path render
duplication (classic + merged + dashV2 all in the tree), and screens that stack ~10 card types.
BUT the v1 mockup over-corrected into flat minimalism and DROPPED the 3D rig hologram and the
liveliness. That is the #1 thing to fix.

NON-NEGOTIABLE: retain the 3D "holo lens" rig hologram as the Home centerpiece and keep the
app's cool 3D effects / liveliness. Minimalism applies to CLUTTER (rows, duplication, text),
NOT to the signature 3D/lively character. Reconcile "clean IA" WITH "alive," not against it.

DO THIS:
1. Build mockup v2 that puts the 3D rig hologram back as the Home hero, while keeping the slim
   master-detail rows and the Basic/Advanced split from v1.
2. Then scope P1 — the master-detail row component on Optimize behind a `slimRows` flag.
Keep the honesty guardrail: one visible measured proof line per rec — never a black-box
"Make it better" button.

COORDINATE: a CC "Wave" build may be running on `main` — do NOT run git commands that could
collide; just create/edit files and report. Every move flag-gated + reversible; no LOCKED gate
touched (no kernel driver, no injection, rollback-first intact, catalog frozen).

MINE TO DECIDE (ask me — plan §8): (a) keep Blackbook as a top-level room or demote it;
(b) ambient-backdrop intensity; (c) pre-select "Recommended" fixes vs. opt-in.
```

---

## What we did this session

- **Researched the category** — optimizer utilities (CCleaner, Razer Cortex, IObit, iolo, AVG
  TuneUp, Outbyte) and gaming/vendor apps (NVIDIA App, AMD Adrenalin, NZXT CAM, Armoury Crate,
  MSI Afterburner). Two lanes: the snake-oil lane (fake urgency, inflated counts, upsell — CCleaner
  is now a Microsoft-flagged PUA; Outbyte is Malwarebytes-flagged scareware) vs. the clean lane
  (AVG's goal buckets + deselect-before-apply; NVIDIA App's opt-in overlay; NZXT CAM's glanceable
  tiles + Basic/Advanced).
- **Audited the current front-end** (read-only). Finding: the visual language is good; the bulk
  comes from (1) triple render-path duplication, (2) multi-affordance rows, (3) screens stacking
  ~10 card types. Density ranking + design-token inventory are in the plan.
- **Formed the plan + ran the five-lens council** — see `docs/UI_SLIMDOWN_PLAN.md`.
- **Built the v1 mockup** — `docs/mockups/ui-slimdown-preview.html` (reuses real tokens;
  before/after toggle on Optimize; Basic/Advanced on Monitor).
- **Owner feedback that redirects v2:** keep the 3D rig hologram + liveliness. Captured as the
  CORRECTION block in the plan (§6) and in memory (`retain-3d-rig-hologram-liveliness`).

## Deliverables (in this repo)

- `docs/UI_SLIMDOWN_PLAN.md` — research synthesis, the re-architecture, council strip, open decisions.
- `docs/mockups/ui-slimdown-preview.html` — v1 interactive mockup (needs the v2 hologram fix).
- `docs/mockups/UI_SLIMDOWN_HANDOFF.md` — this brief.

## The thesis (unchanged) + the correction

**Thesis:** one question per room · one primary action · answer first · detail on tap. Enabling
mechanisms: master-detail rows (8→3 visible controls), a global Basic/Advanced switch, delete the
dead render paths, calm the chrome.

**Correction:** the 3D rig hologram (`src/surfaces/rig/`, WebGL, Home centerpiece) and the ambient
liveliness (`AmbientBackdrop`, the "HoloLens" Setup & Tour) STAY. Slim the clutter, keep the alive.

## Council — Chairman line

Approved as **consolidation, not redesign.** 🔴 Contrarian's flag: don't over-hide the *proof*
(visible evidence is the moat) — keep one measured proof line per collapsed row. Executor's next
move: master-detail row on Optimize behind `slimRows`, after v2 restores the hologram.

## Coordination / status

- A CC "Wave 1" build was running on `main` (isolated worktrees) — I did **not** run git this
  session to avoid collision. The new files are untracked; commit when the wave settles.
- Nothing shipped to the app yet — this is plan + mockup only.

## Session 2 (2026-07-01, later) — v2 built, §8 decided, P1 specced

- **Mockup v2 shipped:** `docs/mockups/ui-slimdown-preview-v2.html` — the 3D rig hologram is
  back as the Home hero (self-contained canvas wireframe engine, real coordinates from
  `rig-parts.ts`, orbit/drag/exploded/hover-specs, honest ghosts, fan spin, accent ring + floor
  grid, reduced-motion + hidden-screen pauses) with the slim master-detail rows, Basic/Advanced
  split, and pre-selected Recommended kept from v1. Barely-there ambient drift on Home, off in
  Advanced. Verified: HTML well-formed, JS `node --check` clean, 5-frame stubbed runtime render
  no-exception. v1 left untouched for comparison.
- **§8 owner decisions (all landed in plan §8):** (a) Blackbook stays top-level, visually
  demoted · (b) backdrop barely-there, auto-off in Advanced · (c) pre-select Recommended,
  selection ≠ application.
- **P1 spec written:** `docs/superpowers/specs/2026-07-01-p1-slimrows-optimize.md` —
  `SlimRecRow` primitive behind `compy_slim_rows` (theme.ts flag pattern, default OFF), Fix.tsx
  fixes-view only, proof-line vitest guard, hard lines + verify line inside. Ready for CC once
  the owner approves v2's look.
- Still no git run from Cowork; all four files (plan edit, v2 mockup, spec, this note) are
  working-tree changes for CC to commit when the wave settles.
