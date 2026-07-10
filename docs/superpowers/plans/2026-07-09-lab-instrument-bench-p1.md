# Lab "Instrument Bench" — Phase 1 Implementation Plan

> **⛔ SUPERSEDED 2026-07-09 — this bento "Instrument Bench" plan was built (Phase 1, `403be45`) and
> the owner REJECTED it on eyeball as generic slop. Its Phases 2–4 are DEAD — do NOT build them. The
> live direction is the app-wide Ops Console HUD: spec `../specs/2026-07-09-compy-console-hud-direction.md`;
> the Phase-1 plan for THAT is the one to build. Kept for the record only.**
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Design source of truth:** `docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md` (owner-
> approved 2026-07-09: "The Instrument Bench", bento basis, BOLDER motion, DELETE the drag gallery).

**Goal:** Replace the Lab's linear "ground spine" with **The Instrument Bench** — a bento grid of living
station bays with bold-but-honest cursor reactivity — behind the existing `compy_lab_ground` preview flag
(DEFAULT OFF), and delete the rejected drag telemetry gallery. Ship it for the owner's eyeball; no default-on.

**Architecture:** The Lab tab already swaps `LabV2`→`LabGround` when `compy_lab_ground` is on (App.tsx, grep
`LabGround`). Phase 1 keeps that swap and the `RoomShell` verdict, but **replaces `LabGround`'s body**: instead
of `<Lab v2 ground>` (the linear numbered spine), it renders a new **`LabBench`** bento grid whose bays are the
Lab stations — the hero bay is station 1 "Optimize" (the enable-the-safe-stack fast path), the measure/prove
stations are medium bays. The bento primitive is the already-vendored MagicBento `ParticleCard` (used today in
`LabBento.tsx`) with its cursor spotlight/border-glow **retinted to the theme accent** — Phase 1 turns the
**subtle tilt + magnetism ON** (they ship OFF today under the old restraint rail; "bolder" is the owner's call)
and adds a **staggered mount reveal** + one **data-reactive hero gauge** driven by GSAP from a real measured
number. Everything gates on the app's resolved reduced-motion.

**Tech Stack:** React 19 + TS, existing vendored `MagicBento` (`src/design/vendor/MagicBento/`), `gsap ^3.15`
(already installed), the app's `useReducedMotion()`/`use-motion` + `useHudFlag()`, `RoomShell`, vitest + tsc.
**Zero new dependencies.**

## Global Constraints

- **Flag:** `compy_lab_ground` stays the gate, **DEFAULT OFF** the entire phase. Flag OFF → App renders the
  untouched `LabV2` + `OptimizeV2` rooms → **byte-identical app** (test-pinned, both directions).
- **No `src-tauri` changes.** `git diff -- src-tauri` MUST be empty for this whole phase. No new IPC, no new
  mutation primitive. Station-1 apply reuses the existing audited `apply_recommendations_batch` path via the
  same fast-path handlers `LabGround` already threads (`recs/changes/isAppliable/onApplyBatch/onToggleRec/
  onRollback`, type `LabFastPathProps` in `src/surfaces/lab/OptimizeStation.tsx`).
- **HONESTY RAIL (binding, owner-reframed):** bolder motion is fine, but **every animated value MUST trace to
  a real measured struct.** A gauge/count-up renders ONLY when its measured source exists; NO fabricated
  fallback, NO placeholder number ever animates. This is both the honest-measurement law (LOCKED rule) and
  what makes bold motion read as *instrument* not *screensaver*.
- **Never gamer-RGB.** The vendor's default violet (`132,0,255`) must be unable to paint — accent-retint is
  test-pinned (see `LabBento.tsx` `accentRgb`, and the existing `lab-bento.test.tsx` vendor-purple pin).
- **Reduced-motion:** all motion gated via `useReducedMotion()` (and `gsap.matchMedia()` for GSAP tweens) per
  [[motion-on-by-default-override-os]] — reduced → static bays, no spotlight, no tilt, no gauge sweep, no
  scramble. A reduced-motion render path must exist and be test-pinned.
- **Every UI-touching task ends with the `self-review` skill** (project law) before it may be called done; no
  done-claim without a quoted PASS. Green tsc/vitest is not a visual review.

---

### Task 1: Delete the drag telemetry gallery (owner: "delete it entirely")

**Files:**
- Delete: `src/surfaces/lab/TelemetryGallery.tsx`, `src/surfaces/lab/TelemetryGallery.css`,
  `src/surfaces/lab/TelemetryGallery.test.tsx`, `src/surfaces/lab/gallery-pieces.ts`,
  `src/surfaces/lab/gallery-pieces.test.ts`, `src/surfaces/lab/fly-camera.tsx`
- Modify: `src/surfaces/lab-guided-data.ts` (remove the `"gallery"` `LabStationKey`, its `LAB_STATIONS` entry,
  `LAB_ROUTER` row if present, and its `stationReading`/facts branches), `src/surfaces/lab-bento-data.ts`
  (remove the `gallery` cases in `stationHasReading` + the `LAB_NOTES.gallery` entry), and `src/surfaces/Lab.tsx`
  (remove the gallery station render/import + any `groundStationKeys` gallery inclusion)
- Delete captures: `docs/ui-sweep/shots/lab-gallery-*.png` (6 files, currently untracked)

**Interfaces:**
- Produces: a `LabStationKey` union with NO `gallery` member; `LabStationFacts` with no gallery-only fields
  (`galleryHasHistory` removed). Later tasks rely on the reduced station set.

- [ ] **Step 1: Find every gallery reference.** Run: `grep -rn "gallery\|Gallery\|TelemetryGallery\|fly-camera\|FlyCamera\|buildGalleryPieces\|galleryHasHistory" src/` — enumerate all hits so none is missed (completeness-critic per [[audit-needs-completeness-critic-grep]]).
- [ ] **Step 2: Delete the 6 `lab/` gallery files** listed above.
- [ ] **Step 3: Remove the `gallery` station** from `lab-guided-data.ts` and `lab-bento-data.ts` (union member, `LAB_STATIONS`/`LAB_NOTES`/`LAB_ROUTER` entries, `stationHasReading`/`stationReading` branches, `galleryHasHistory` fact). The `switch` statements must stay exhaustive with the member gone.
- [ ] **Step 4: Remove gallery wiring from `Lab.tsx`** (import, station render, any `groundStationKeys` entry).
- [ ] **Step 5: Run tsc + vitest.** Run: `npm run build` (tsc) then `npx vitest run`. Expected: tsc 0 errors; suite green after the deleted gallery test files drop out. Fix any dangling type refs surfaced by Step 1's grep.
- [ ] **Step 6: Confirm gone + boundary clean.** Run: `grep -rn "Gallery\|gallery-pieces\|fly-camera" src/` → expect no code hits; `git diff -- src-tauri` → empty.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(lab): delete the rejected drag telemetry gallery (owner: delete entirely)"`

---

### Task 2: `LabBench` — the bento grid room face (replaces the linear spine)

**Files:**
- Create: `src/surfaces/LabBench.tsx` (the bento grid of station bays), `src/surfaces/lab-bench.css`
- Modify: `src/surfaces/LabGround.tsx` (render `<LabBench …/>` in place of `<Lab v2 ground …/>`, keeping the
  `RoomShell` verdict + `HudMasthead` exactly as-is), `src/surfaces/tokens-v2-guard.test.ts` (register
  `lab-bench.css` in the `V2_CSS` list per the existing pattern)
- Test: `src/surfaces/lab-bench.test.tsx`

**Interfaces:**
- Consumes: `LabFastPathProps` (from `lab/OptimizeStation`), `readiness/activeCount/diagnostics` (already
  threaded into `LabGround`), `labBentoCards`/`stationHasReading` (`lab-bento-data.ts`), the `OptimizeStation`
  body component for the hero bay, `ParticleCard` (`design/vendor/MagicBento/MagicBento`), `useReducedMotion`.
- Produces: `export function LabBench(props): JSX` — the room body. Renders a bento grid: **hero bay** =
  station 1 "Optimize" (dominant span, contains the enable-all + safe-tweak list via `OptimizeStation`),
  **measure/prove bays** = the remaining stations as medium/compact cards that open their detail (reuse the
  existing router-jump `onOpen` pattern from `LabBento`). Later tasks add motion to this component.

- [ ] **Step 1: Write the failing test** `lab-bench.test.tsx`: (a) renders a bay for every station key with no `gallery` bay; (b) the Optimize/hero bay renders the enable-all control (query its accessible name); (c) reduced-motion render path produces static bays (no tilt/particle side-effects thrown). Use `@testing-library/react` + the existing lab test fixtures (copy the fact fixtures from `lab-bento.test.tsx`).
- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/surfaces/lab-bench.test.tsx` → FAIL (LabBench not defined).
- [ ] **Step 3: Implement `LabBench.tsx`** — grid of `ParticleCard` bays (model after `LabBento.tsx`: accent-retint via `accentRgb`, `glowColor={rgb}`, `disableAnimations={reduced}`); hero bay spans 2×2 and renders `<OptimizeStation {...fast}/>`; measure bays are 1×1 doors. **Phase 1 keeps `enableTilt={false} enableMagnetism={false}`** here — motion turns on in Task 3, so this task's deliverable is a correct static bento first.
- [ ] **Step 4: Write `lab-bench.css`** — bento grid (CSS grid, `grid-template-columns` with the hero spanning; base cell + gutter rhythm per the proposal's bento rules: size encodes importance, one hero, consistent radius/gutter). Register it in `tokens-v2-guard.test.ts` `V2_CSS`.
- [ ] **Step 5: Wire `LabGround.tsx`** to render `<LabBench …/>` instead of `<Lab v2 ground …/>` (leave the `RoomShell`/verdict/`HudMasthead`/`DecryptedText` header untouched).
- [ ] **Step 6: Run tsc + vitest.** Expected: tsc 0; `lab-bench.test.tsx` green; the existing flag-off byte-identity test (`lab-ground.test.tsx`) still green (App renders `LabV2` when the flag is off — unchanged).
- [ ] **Step 7: `git diff -- src-tauri` empty. Commit.** `git commit -m "feat(lab): LabBench bento grid replaces the linear ground spine (flag OFF)"`

---

### Task 3: Turn the bento ALIVE — bolder cursor reactivity + staggered reveal

**Files:**
- Modify: `src/surfaces/LabBench.tsx`, `src/surfaces/lab-bench.css`
- Test: `src/surfaces/lab-bench.test.tsx` (extend)

**Interfaces:**
- Consumes: `ParticleCard` props `enableTilt`, `enableMagnetism`, `clickEffect`; `useReducedMotion`.
- Produces: no new exports — behavior change on `LabBench`.

- [ ] **Step 1: Write the failing test** — reduced-motion ON ⇒ bays render with tilt/magnetism disabled (assert the reduced branch passes `enableTilt={false}`/`enableMagnetism={false}` — e.g. via a `data-motion` attr on the grid you set from `reduced`, asserted in the test). This pins the reduced-motion contract BEFORE enabling motion.
- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/surfaces/lab-bench.test.tsx`.
- [ ] **Step 3: Enable bolder reactivity (motion branch only):** when `!reduced`, set `enableTilt` + `enableMagnetism` ON (small values — this is the JARVIS reactivity the owner missed), keep the accent spotlight/border-glow, add a hover-lift (`transform: translateY(-4px) scale(1.02)`, spring-ish transition) in `lab-bench.css`, and a **staggered mount reveal** (CSS `@keyframes` with per-bay `animation-delay` via an index custom-prop; assemble the grid on entry). Dim non-hovered siblings slightly (the MagicBento move). ALL gated so the reduced branch stays static.
- [ ] **Step 4: Run tsc + vitest.** Expected: tsc 0; reduced-motion pin green; vendor-purple pin still green.
- [ ] **Step 5: Commit.** `git commit -m "feat(lab): bolder bento reactivity — accent spotlight + tilt/magnetism + staggered reveal (reduced-motion static)"`

---

### Task 4: One data-reactive hero gauge (the honesty-bound "living data" proof)

**Files:**
- Create: `src/surfaces/lab/use-count-to.ts` (a tiny GSAP-driven numeric tween hook), `src/surfaces/lab/use-count-to.test.ts`
- Modify: `src/surfaces/lab/OptimizeStation.tsx` (render the gauge in the hero bay), its CSS

**Interfaces:**
- Produces: `export function useCountTo(target: number | null, opts?: {reduced: boolean}): number` — returns
  the current tweened display value; when `target` is `null` (no measured source) it renders NOTHING (caller
  must not show the gauge); when `reduced` it snaps to `target` with no tween. GSAP `gsap.to({v}, …)` on a ref,
  `gsap.matchMedia()` for the reduced gate.
- Consumes: a REAL measured number already present in `LabFastPathProps`/readiness (e.g. the count of
  safe tweaks applicable, or the applied-vs-total — pick one that is genuinely measured, NOT invented).

- [ ] **Step 1: Write the failing test** `use-count-to.test.ts`: `target=null` ⇒ hook signals "no value" (returns `null`); `reduced=true` ⇒ returns `target` immediately (no intermediate); a real `target` is reachable. (Fake timers / assert final value; don't assert every frame.)
- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/surfaces/lab/use-count-to.test.ts`.
- [ ] **Step 3: Implement `use-count-to.ts`** with GSAP, honoring the `null`/`reduced` contracts above.
- [ ] **Step 4: Render the gauge in the hero bay** (`OptimizeStation.tsx`) — a ring/count-up that animates FROM the measured number, shown ONLY when that source exists (honesty rail: `null` ⇒ render nothing, never a placeholder). Monospace value, accent stroke, HUD micro-label.
- [ ] **Step 5: Honesty guard.** Add a test: when the measured source is absent, the gauge is NOT in the DOM (no zero/placeholder animates). Pin it.
- [ ] **Step 6: Run tsc + vitest.** Expected tsc 0; both new tests green; `git diff -- src-tauri` empty.
- [ ] **Step 7: Commit.** `git commit -m "feat(lab): data-reactive hero gauge — GSAP count-up bound to a measured number (null=render nothing)"`

---

### Task 5: Self-review + ship behind the flag + owner eyeball

**Files:** none (verification + ship only)

- [ ] **Step 1: Run the `self-review` skill** on the bench (dispatches `self-reviewer` at native 1500×980). It must prove, with computed evidence: hero bay dominance + all measure bays present; accent spotlight/tilt (never vendor purple); staggered reveal; gauge renders only with a measured source; reduced-motion static path; verdict headline legible; no duplicated/broken bays. Do NOT claim done without a quoted PASS.
- [ ] **Step 2: Full verify.** `npm run build` (tsc 0) · `npx vitest run` (all green, note the new count) · `cargo test --manifest-path src-tauri/Cargo.toml` (unchanged count — no src-tauri diff) · `git diff -- src-tauri` empty.
- [ ] **Step 3: Build + silent-reinstall** via the `ship` skill (`scripts/ship-reinstall.ps1`) — stamp-verify live == HEAD via the embedded `COMPY_GIT_HASH`, one installer on the Desktop. (Standing LAW: reinstall is Claude's job, [[silent-reinstall-is-my-job]].)
- [ ] **Step 4: Update state docs** in the ship-docs commit: `RELEASE_STATE.md` Snapshot row, `docs/BACKLOG.md` steering-log entry, `docs/UI_VISION_BACKLOG.md` §C.
- [ ] **Step 5: Owner eyeball.** Tell the owner: flip **Settings → Appearance → "Lab proving ground (preview)"**, open the **Lab** tab, react to The Instrument Bench. This is the taste gate before any default-on and before Phases 2–4.

---

## Phases 2–4 (sketch — each gets its own plan AFTER the P1 eyeball)
- **P2 — data-reactivity across all bays:** every bay's live reading animates from its measured struct
  (gauge sweeps, count-ups, an oscilloscope trace on a telemetry bay via hand-rolled `<canvas 2d>`). Honesty
  rail throughout.
- **P3 — decode text + magnetic cursor:** scramble reveal on bay headlines (mount-guarded,
  [[visual-anomaly-is-a-defect-signal]]); a hand-rolled magnetic-cursor effect on the primary CTAs.
- **P4 — hologram inertia + room polish:** redirect the "explore a 3D space" feel onto the real rig hologram
  (drei `OrbitControls enableDamping`); room-transition "instrument retune" wipe. PERF-verify any
  glass/shader on the real installed build (WebView2 software-path risk, [[dev-build-not-a-perf-test]]).

## Self-Review (plan vs spec) — done
- Spec coverage: bento basis (T2) ✓ · bolder motion (T3) ✓ · motion-bound-to-real-data (T4 + honesty rail) ✓ ·
  delete gallery (T1) ✓ · flag-OFF/zero-src-tauri/reduced-motion rails (Global Constraints) ✓ · eyeball gate (T5) ✓.
- Placeholder scan: no "TBD"/"handle edge cases" — every task has concrete files, commands, and guard tests.
- Type consistency: `LabFastPathProps`, `LabStationKey` (gallery removed T1), `useCountTo(target,{reduced})`
  used consistently across T2/T4.
