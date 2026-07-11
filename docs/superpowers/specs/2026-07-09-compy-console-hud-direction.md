# Compy Console — app-wide HUD direction (owner-approved 2026-07-09)

> **Status: DIRECTION LOCKED (owner, 2026-07-09).** This is the summary interpretation the owner
> signed off on after three rejected Lab attempts (drag gallery → linear spine → bento). It
> **SUPERSEDES the Lab's visual/layout direction from** `2026-07-09-lab-redesign-direction-proposal.md`
> ("The Instrument Bench" bento) and the still-open UI parts of `2026-07-08-lab-proving-ground.md`.
> The catalog/§2a-dark/mutation-safety parts of those specs still stand — only the *look* changes here.
> **Bento was rejected AS THE LAB, not banned outright** — a tidy tile grid stays a live option for
> other surfaces where it genuinely fits (owner, 2026-07-09).
>
> **Visual reference (living mockup):** the Ops Console pitch — <https://claude.ai/code/artifact/e2830b73-cfc0-43c6-b263-5b59a1075639>
> (Scene A is the approved direction; the centered rig is a stand-in for the real 3D hologram).

## Why the earlier attempts were slop (root cause, so we don't repeat it)

Every prior Lab attempt was assembled from **trendy template components** — MagicBento glass cards,
glass disclosure boxes, a grid of rounded panels — with "reactivity" bolted on top. That vocabulary
*is* the generic-AI-slop look the owner has been rejecting since the 2026-07-05 de-slop directive.
Adding tilt to a glass card does not make it a HUD. The fix is a different building block, not a
re-skin: a **spatial game-HUD cockpit**, not cards-in-a-grid.

## The locked visual language — the "Console kit" (build once, reuse everywhere)

A shared kit every tab draws from, each tab arranging it for its own features:

- **Ground & register:** dark blue-biased cockpit ground; a **mono instrument register** for
  readouts/labels (tabular nums, tracked uppercase micro-labels); clean sans for body prose only.
- **Instruments, not decorations:** **arc gauges** (ticked rings that sweep to a value), **sparklines**,
  an **oscilloscope trace** where a live signal exists. Every instrument is a real reading.
- **Persistent HUD frame:** thin coordinate brackets at the viewport corners (build id · rig id · a
  running clock · session), a live status ticker in the header.
- **Navigation = a magnify Dock** (reactbits Dock): station nodes that rise on hover; the primary
  action node glows. This replaces the "wide horizontal boxes" the owner rejected.
- **Reticle Target Cursor** (reactbits) that snaps to interactive targets.
- **Animated readouts:** count-up numbers, decrypt-in headlines (mount-guarded per
  [[visual-anomaly-is-a-defect-signal]]).
- **Accent:** always the user's live theme accent (Midnight/Violet/Crimson/Emerald/Hearth).
  **Never gamer-RGB / neon; vendor purple can never paint** (test-pinned, existing law).
- **Honesty rail (LOCKED):** an instrument shows a number ONLY when it is actually measured; no
  fabricated fallback ever animates (see the amber **NOT YET** GPU-temp gauge in the mockup).
- **Reduced-motion:** a flat, static, immediate console — no cursor, no sweeps, no reveals — gated
  via the app's resolved reduced-motion ([[motion-on-by-default-override-os]]).

## The Lab — flagship room: Optimize + Benchmark, merged but each freely its own

One room, the Ops Console layout:

- **Center:** the **real 3D orbitable rig hologram** Compy already ships (the Home/bay model with
  per-part identity colors), dropped into the console frame with corner brackets + a scan sweep. It
  must read instantly as "that's my PC" — recognizable components, not an abstract schematic.
- **Corners:** live **arc-gauge readouts** — FPS + 1% low (measured), safe-stack-ready count, and an
  honest **NOT YET** gauge for anything unmeasured.
- **Bottom:** a **Dock of stations.** **Optimize (the toggle tweaks)** is the glowing primary node;
  **Benchmark** is its own node right beside it; then **Diagnostics · Latency · Tuning · Black Box**.

**The merge (owner's core ask):** Optimize's toggle tweaks and the Benchmark lab **coexist in one
room but stay individually, freely accessible.** Click Optimize → the safe-tweak toggle list opens as
a tidy HUD panel (NOT an always-on form dominating the screen — that dominating form was the rejected
problem). Click Benchmark → the A/B runs. **One detail panel open at a time**, the dock is the menu,
the rig + gauges are always the backdrop. Result: tune your rig and prove-it-with-a-benchmark side by
side, each one tap away, clean and smooth to navigate.

- **Reuse, don't fork:** Optimize's apply path stays the **existing audited
  `apply_recommendations_batch` / per-row-undo** (zero new IPC, zero new mutation primitive). This is
  presentation over the same safe backend.
- Check's deeper cleanup (startup / bloat / preload / leftovers / NIC) folds under a "more cleanup"
  disclosure inside the Optimize panel, not on the main console.

## Rolling the language to every tab — tailored to each tab's job (not copy-pasted)

Exit rule for each: **no generic template slop remains in that tab.**

| Tab | How the console language suits ITS features |
|---|---|
| **Home** | The console "cold open" — rig hologram + top gauges (readiness, biggest limiter) + a dock into the rooms. |
| **Monitor** | The language is *literally native*: the arc gauges + oscilloscope traces are real live telemetry (fps, frametime, sensors), not decoration. |
| **Lab** | The merged Optimize + Benchmark console above (flagship). |
| **History / Black Box** | A flight-recorder log — each applied change a timestamped entry with its rollback; "field records" framing. |
| **Gaming Mode** | An arm/engage console — one clear engage control + status readouts for the armed tier. |
| **Settings / Setup & Tour** | Quieter console chrome — same frame + type + honest register, but calm forms; settings are operated, not performed. |

Every tab keeps its own honesty rails and reduced-motion path.

## Build order — Lab first, then roll out (owner-chosen 2026-07-09)

1. **Phase 1:** build the shared **Console kit** + the **merged Optimize/Benchmark Lab**, behind the
   existing `compy_lab_ground` preview flag (DEFAULT OFF). Owner eyeballs the real built room.
2. **Phases 2…N:** once the owner loves the Lab, roll the same kit to each remaining tab — **one tab
   per phase**, each behind its own preview flag, each ending in a `self-review` PASS and the
   "no-slop-remains" exit check. Each phase gets its own plan.

## Rails & laws honored (non-negotiable)

- **Frontend/presentation only** — the mutation/rollback boundary (`actions.rs`/`history.rs`) is
  never touched by this work; `git diff -- src-tauri` stays empty for the UI phases (Optimize reuses
  the audited batch path). Any exception is its own gated, mutation-gate-reviewed change.
- **Flag-gated + reversible** — every phase ships behind a DEFAULT-OFF preview flag with flag-off
  byte-identity test-pinned; classic look stays the failsafe until the owner flips default-on.
- **Honesty rail · reduced-motion · theme-accent (no vendor purple)** — all test-pinned per existing
  guards.
- **`self-review` before any done-claim; `ship` skill for the silent reinstall** (owner never installs).

## Owner calls (resolved this session)

- Direction: **A · Ops Console.** ✅
- Center: **the real recognizable 3D hologram.** ✅
- Merge: **Optimize toggles + Benchmark coexist in the Lab, individually accessible.** ✅
- Build order: **Lab first, then per-tab rollout.** ✅
- Scope guarantee: **no generic slop remains anywhere in the app** — enforced as each tab's exit rule.

## Open (to confirm at the Phase-1 plan / eyeball) — ALL RESOLVED

- ~~Does the Optimize **toggle panel open-on-click** feel right?~~ ✅ **OWNER CONFIRMED 2026-07-10:
  "open on click is cleaner"** — the open-on-click panel is the locked form.
- ~~The standalone **Optimize rail tab**~~ ✅ **OWNER DECIDED 2026-07-10: DROP it at default-ON** —
  the merge's endpoint. One door (the Lab's Optimize station) to the safe-tweak toggles; undo stays
  reachable via the Lab panel + History. The tab removal ships WITH the `compy_lab_ground`
  default-ON flip (after the round-2 eyeball), not before.

## Addendum — title-header law (owner, 2026-07-10 eyeball feedback, TWO rounds)

App-wide text law folded into the Console rollout, tightened by the round-2 eyeball:

- **Round 1 (header-slop):** a tab's opening header space carries header-format text only. Small
  always-on descriptive/explainer lines ("perceptually insignificant format") are a bad habit —
  relocate each to its relative context element, prioritize clean minimal text. First enforcement:
  the `.v2-measured` strips removed from Optimize/Monitor/Blackbook/LabV2 + LabGround, the
  LabConsole lede deleted.
- **Round 2 (title headers):** *"the header just needs to be a title, not a whole description or
  notification statement."* The h1 under the HUD is the room's NAME (Optimize / Monitor / Blackbook
  / Lab) — never a dynamic verdict/status sentence (the caught defect: "1 change you applied was
  turned off outside Compy" standing as the Lab h1). Every such sentence lives in its body context
  instead: drift → Fix's "Applied — turned off outside Compy" group intro (+ "Compy never
  re-applies on its own") · undo promise → Fix's consent line beside the apply controls ·
  Monitor's last-session answer → Play's hero (with the "live estimate" honesty framing) ·
  Blackbook's record/coaching → the in-panel autopsy record + restored browse hint. Header subs are
  gone under the HUD. The classic `compy_editorial="0"` failsafe keeps its pre-rollout verdict
  headers. Home's masthead display verdict stays — Home is the answer-first cold-open; its verdict
  IS the content, not a room description (owner may extend the law there; flag on eyeball).

Enforced ongoing as self-reviewer rubric item 6 + vitest pins (`hud-rooms-flag.test.tsx` title
contract per room, `lab-ground.test.tsx` "Lab" pin); every Phase 2…N tab adoption must pass it.

## Addendum — per-tab signature law (owner, 2026-07-10, after the Home default-ON)

**Owner directive (verbatim):** *"i just want to make sure were not literally copy and pasting the
same 3d parralax model thing every time for every tab id like if we came up with something unique
and more relative to each tabs purpose and spitball ideas to support that so it all makes sense
before we do it."*

**The law:** the shared Console LANGUAGE (frame, type, honest register, HUD micro-labels, motion
grammar) rolls out app-wide — but the **centerpiece of each tab must be a signature instrument
native to THAT tab's function.** The 3D rig hologram + parallax stage is NOT the template; a tab
whose console face could be swapped with another tab's without anyone noticing has failed this law.

**Per-tab signature concepts (spitball sheet — each phase presents its tab's concept for the
owner's go/no-go BEFORE Task 1; these are starting points, not locked designs):**

| Tab | Signature instrument (native to its purpose) | Explicitly NOT |
|---|---|---|
| **Home** (shipped) | The cold-open: rig hologram center + verdict masthead + gauges + dock. The ONE identity/status view — "here's your machine and the answer." | — (this IS the hologram's home) |
| **Lab** (shipped, evolves) | The bench: today it centers the same hologram as Home — DIFFERENTIATE, don't duplicate: the Lab's rig becomes the **instrumented specimen** — part-anchored measured annotations, changed components visibly marked, deltas pinned to parts (the standing Two Futures hologram-information fold-in). Home shows the machine; the Lab shows the machine **under test**. | A second identical status hologram |
| **Monitor** | The **instrument cluster**: rolling `Oscilloscope` traces on live fps/frametime + sensor arc gauges — the motion IS the data (traces sweep when live, go dead-still when stopped). Like a bench scope / EKG. | Hologram, parallax over data, decorative motion |
| **Blackbook / History** | The **flight recorder**: timestamped tape-log of applied changes + sessions, each entry carrying its rollback; scrub/browse like pulling a black-box tape; the autopsy record as the deep-read. | Any 3D scene; dashboard gauges |
| **Gaming Mode** (in the Lab's Power bay) | The **arm/engage panel**: one staged engage control, armed-tier readouts, the session contract as a live checklist, restore guarantee as the standing light. Cockpit arming, not dashboards. | Hologram, traces |
| **Settings / Setup & Tour** | **Quiet console chrome**: same frame + type + honesty, calm forms. Settings are operated, not performed. | Any centerpiece theater |

**Process rule this adds:** each remaining phase (3…N) opens with a short concept check against
this sheet — what the tab's signature is, what it deliberately does NOT reuse — and gets the
owner's go before code. Motion stays reduced-motion-gated and idle-honest everywhere.
