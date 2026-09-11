# Compy Console HUD — Phase 2 (Home: the console cold-open) Implementation Plan

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04.** This is a historical implementation record, not
> current product authority, priority, approval, or work authorization. Current product direction is
> [`docs/PRODUCT_CONSTITUTION.md`](../../PRODUCT_CONSTITUTION.md), with sequence derived in
> [`docs/product/ROADMAP.md`](../../product/ROADMAP.md). Conforming evidence and telemetry-honesty
> provenance remains useful under [`docs/ARCHITECTURE_LOCKS.md`](../../ARCHITECTURE_LOCKS.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Design source of truth:** `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md` (owner-
> approved 2026-07-09; Home row: *"The console 'cold open' — rig hologram + top gauges (readiness,
> biggest limiter) + a dock into the rooms."*) + its 2026-07-10 **header-slop-law addendum** (the
> per-tab exit check).
> **ENTRY GATE (do not start building):** the owner's **round-2 eyeball of the Lab Ops Console**
> (`1a9f44f` live) must come back approving the direction, and his **standalone-Optimize-tab call**
> should be recorded (it shapes the Home dock's room list at default-ON, not the preview build).
> If the eyeball comes back "needs changes," fold those changes into this plan before Task 1.

**Goal:** Home adopts the Console language as the app's cold-open: the real 3D rig hologram at center
inside the bracketed console stage, four honest corner arc gauges, the #1 measured limiter as a
readout with its jump-to-fix, and a **Dock that navigates into the rooms** — behind a NEW preview
flag `compy_home_console` (DEFAULT OFF). Flag off → today's Home (HomeHud default-ON / HomeV2
failsafe) byte-identical.

**Architecture:** `HomeRoom` (`src/surfaces/HomeRoom.tsx`) is the existing Home switch
(`hud ? <HomeHud/> : <HomeV2/>`). This phase adds a third, highest-priority branch: `homeConsole ?
<HomeConsole/> : …` over the SAME props (presentation only). `HomeConsole` reuses the **Phase-1
Console kit as-is** (`src/design/console/`: `ArcGauge`, `Sparkline`, `Dock`, `ReticleCursor` — zero
kit changes expected) and **ports HomeHud's measured derivations verbatim** (they are the honest,
already-guarded logic: `postureLine`/`liveStrip`, metric grades, the GPU-temp/memory poll). New
navigation: App threads `onNavigate` + the visible room list into `HomeRoom` → the Dock. Legacy note:
`CommandCenter.tsx`/`HomeV3` are unreachable from App (comment-only reference, App.tsx:1497) — OUT of
scope, don't touch.

**Tech Stack:** React 19 + TS · Console kit (`src/design/console/`) · lazy `RigHologram`
(`src/surfaces/rig/RigHologram`, the drag-orbit hologram HomeHud already mounts) · `useReducedMotion`
(`src/design/use-motion`) · `readHud`-style flag plumbing (`src/design/theme.ts:500`,
`src/design/use-hud.ts`) · vitest + @testing-library/react + tsc. **Zero new dependencies.**

## Global Constraints

- **Flag:** `compy_home_console`, localStorage, **DEFAULT OFF** the whole phase. OFF ⇒ `HomeRoom`
  renders exactly today's tree — pin byte-identity in a new `home-console-flag.test.tsx` mirroring
  `src/surfaces/home-hud-flag.test.tsx` (both hud-flag states must stay identical with the new flag
  absent/"0").
- **No `src-tauri` changes.** `git diff -- src-tauri` MUST be empty for the whole phase. `HomeConsole`
  reads via the SAME existing commands HomeHud polls (`get_gpu_sensors`, `get_memory_pressure`) —
  zero new IPC.
- **HONESTY RAIL (LOCKED):** every gauge value traces to a real measured source; absent ⇒ `null` ⇒
  ArcGauge's NOT-YET, never a fabricated 0. No invented 0–100 "score": Readiness is the ready/total
  checks ratio (port the `readinessScore` derivation + its comment from `src/surfaces/LabConsole.tsx`
  ~L210). GPU temp obeys LOCKED rule 5: tone via `gradeGpuTempForVendor` (NVIDIA stays ungraded).
- **Header-slop law (exit check, rubric item 6):** Home's opening header carries header-format text
  only — eyebrow · display verdict · the masthead readout strip (formatted instrument data, already
  law-compliant). NO lede, no always-on descriptive/explainer lines anywhere new. The top-limiter
  line is a CONTEXT element (lives with the dock/queue, carries a measured fact + its fix route).
- **Never gamer-RGB; vendor purple can never paint** — mirror the existing vendor-purple pin from
  `lab-console.test.tsx` into the new test.
- **Reduced-motion:** all motion gated via `useReducedMotion()` ([[motion-on-by-default-override-os]]).
  Reduced ⇒ static console: no reticle, no spotlight, no reveal, no parallax; gauges snap
  (`useCountTo`'s existing reduced contract).
- **All new CSS scoped under `:root[data-v2="on"]`** and registered in
  `src/surfaces/tokens-v2-guard.test.ts` `V2_CSS` (mirror `lab-console.css`'s registration).
- **Every UI task ends with `self-review`** before any done-claim; no done-claim without a quoted
  PASS. Green tsc/vitest is not a visual review.

---

### Task 1: Flag plumbing + the `HomeRoom` branch (byte-identity first)

**Files:**
- Modify: `src/design/theme.ts` (add `readHomeConsole()` beside `readHud`, theme.ts:500 pattern:
  key `compy_home_console`, ON only when `=== "1"` — note this is DEFAULT-OFF semantics, the
  *opposite* polarity of `readHud`'s `!== "0"` default-ON), `src/design/use-hud.ts` or a sibling
  `use-home-console.ts` (hook syncing on a `compy:home-console-changed` window event),
  `src/surfaces/Settings.tsx` (Appearance toggle **"Home console (preview)"**, firing the event —
  mirror the existing hud row, Settings.tsx:148), `src/surfaces/HomeRoom.tsx` (three-way branch).
- Create: `src/surfaces/HomeConsole.tsx` as a STUB (renders `null`-safe minimal frame) so the branch
  compiles; `src/surfaces/home-console-flag.test.tsx`.

**Steps:**
- [ ] Write the failing test `home-console-flag.test.tsx`: (a) flag absent → `HomeRoom` output
  byte-identical to today for BOTH `compy_editorial` states (serialize `container.innerHTML`
  with/without the new key present, assert equal — the home-hud-flag.test.tsx mechanism); (b) flag
  `"1"` → the console root (`.home-console`) renders and HomeHud/HomeV2 roots do not.
- [ ] Implement the flag read + hook + Settings row + `HomeRoom` branch + stub.
- [ ] Run: `npm run build` (tsc 0) + `npx vitest run src/surfaces/home-console-flag.test.tsx src/surfaces/home-hud-flag.test.tsx` — both green, the existing hud pins untouched.
- [ ] Commit: `feat(home): compy_home_console preview flag + HomeRoom branch (DEFAULT OFF, byte-identity pinned)`

---

### Task 2: `HomeConsole` — the console stage (hologram center + honest corner gauges + masthead)

**Files:**
- Modify: `src/surfaces/HomeConsole.tsx` (real implementation), create `src/surfaces/home-console.css`
- Modify: `src/surfaces/tokens-v2-guard.test.ts` (register `home-console.css` in `V2_CSS`)
- Test: `src/surfaces/home-console.test.tsx`

**Interfaces:**
- Props: exactly `HomeRoom`'s existing `Props` (hw/readiness/priorities/sessions/changes/onRunCheck/
  onSeeInFix) **plus** the Task-3 nav props (declare now, wire in Task 3):
  `onNavigate?: (tab: string) => void; rooms?: { key: string; name: string }[]`.
- Consumes: `postureLine`/`liveStrip` (`command-center-data`), `gradeFps`/`gradeLow1`/`gradeColor`
  (`data/metric-grade`), `gradeGpuTempForVendor` (`data/gpu-sensor`), `gpuVendor` (`walkthroughs`),
  `activeChangeCount` (`dashboard-data`), lazy `RigHologram` + `useManualParts` (port HomeHud's
  mount, incl. the memo-stable `onRigSelect` — the T1.5 idle-repaint guard comment), `ArcGauge`,
  `useReducedMotion`, `useV2Accent` (`HomeV2`).

**Steps:**
- [ ] Write the failing test (fixtures: copy the `hw`/`readiness`/`priorities`/`sessions` fixtures
  from `src/surfaces/home-hud-flag.test.tsx` / `home-v2.test.tsx`; stub RigHologram like
  `lab-console.test.tsx` stubs RigViewer): (a) the display verdict renders postureLine's real
  headline; (b) honest NOT-YET: with no sessions + null GPU temp, the FPS/1%-low/GPU gauges show
  NOT-YET and no numeric readout; (c) with a session fixture, Avg FPS + 1% low render the measured
  numbers; (d) **header-slop pin:** the masthead subtree contains no element with a
  descriptive-text class (assert no `.home-console-lede` / explainer node exists at all).
- [ ] Implement. Structure (all under `RoomShell`, masthead in HomeHud's proven register — port the
  masthead JSX: scan/warn/ok LED · eyebrow · display verdict · dek-trim logic · segmented readout
  strip, VERBATIM from HomeHud):
  - **Stage** (`.hc-stage`): corner brackets + the four `.lc-corner`-style gauge slots + the lazy
    `RigHologram` center (drag-orbit, part callouts preserved; port HomeHud's rig state incl.
    `compy_home_rig_3d` fallback to `HardwareGrid` when 3D is off).
  - **Gauges (honesty-pinned):** TL `Readiness` = ready/total ratio (LabConsole's derivation, null
    while `readiness == null`); TR `Avg FPS` = `liveStrip` session avg (null when `strip.kind !==
    "data"`), tone from `gradeFps`; BL `1% low` = `strip.low1Est`, tone from `gradeLow1`; BR
    `GPU temp` = the polled `temperature_c` (null → NOT-YET), tone via `gradeGpuTempForVendor`
    (neutral for NVIDIA — rule 5).
  - **GPU/memory poll:** port HomeHud's 5s `useEffect` poll verbatim (same commands, same
    cancel/cleanup).
- [ ] Write `home-console.css` — model the stage/bracket/corner geometry on `lab-console.css` (same
  tokens: `--ix-glass-*`, `--ix-accent`, `--ix-mono`); every selector scoped `:root[data-v2="on"]`;
  no accent fills behind text.
- [ ] Run: tsc 0 · `npx vitest run src/surfaces/home-console.test.tsx src/surfaces/tokens-v2-guard.test.ts` green.
- [ ] Commit: `feat(home): HomeConsole stage — hologram center + 4 honest corner gauges (flag OFF)`

---

### Task 3: The Dock into the rooms + the #1-limiter readout

**Files:**
- Modify: `src/surfaces/HomeConsole.tsx`, `src/surfaces/home-console.css`, `src/surfaces/HomeRoom.tsx`
  (pass-through), `src/App.tsx` (thread nav), extend `src/surfaces/home-console.test.tsx`

**Interfaces:**
- App already owns `activeTab`/`setActiveTab` (`App.tsx:501`) and the measured `visibleTabs` memo
  (~L850 — rooms only appear when their data exists). Thread into `<HomeRoom>` (App.tsx:1375):
  `onNavigate={(t) => setActiveTab(t as Tab)}` and `rooms={visibleTabs.filter(t => t !== "Overview")
  .map(t => ({ key: t, name: ROOM_NAME[t] }))}` — a small `ROOM_NAME` map using the rail's existing
  user-facing room names (grep the rail/nav labels; do NOT invent new names).
- Dock semantics on Home: **navigation, not panels** — `onOpen(key)` calls `onNavigate(key)`;
  `activeKey` stays `null` (Home never marks a room active); primary node = the merged
  Optimize/"fix" room (the app's one guided-action room — same primary the Lab dock glows).

**Steps:**
- [ ] Extend the test: (a) a dock button renders per passed room and clicking fires `onNavigate`
  with that key; (b) NO dock button for a room not in `rooms` (honest doors — empty rooms get no
  door); (c) the #1-limiter readout renders `priorities.limiters[0].title` with its jump control
  (fires `onSeeInFix`), and renders NOTHING when limiters are empty or `priorities == null` (no
  placeholder text).
- [ ] Implement: `<Dock nodes={roomNodes} activeKey={null} onOpen={onNavigate} />` below the stage;
  the **top-limiter readout** as a context row beside/above the dock — micro-label `top limiter` ·
  the measured title · confidence tag (reuse the quiet-tag register, never the retired uppercase
  alert-badge pattern) · a jump control wired to `onSeeInFix`. Clean state renders nothing (the
  verdict already owns "measured clean" — one-owner-per-screen voice law).
- [ ] Run: tsc 0 · the extended test green · `home-hud-flag` + `home-console-flag` pins still green.
- [ ] Commit: `feat(home): room Dock (navigate, honest doors) + #1-limiter readout with jump-to-fix`

---

### Task 4: Bring it alive — spotlight · staggered reveal · reticle · parallax (reduced ⇒ still page)

**Files:**
- Modify: `src/surfaces/HomeConsole.tsx`, `src/surfaces/home-console.css`, extend
  `src/surfaces/home-console.test.tsx`

**Steps:**
- [ ] Extend the test: (a) console root carries `data-motion="reduced"` under the reduced mock;
  (b) vendor-purple pin (no `132, 0, 255` anywhere in the rendered tree — mirror
  `lab-console.test.tsx`).
- [ ] Implement, ALL under `.home-console[data-motion="full"]`: the cursor-follow accent spotlight on
  `.hc-stage` (port the `--glow-x/--glow-y` mechanism from `lab-console.css`); staggered mount
  reveal (per-element `--i` delay, `animation-fill-mode: backwards` — NEVER `both`, the documented
  hover-blocking bug); `<ReticleCursor scopeRef={stageRef} />` (kit handles reduced/coarse-pointer
  null + rAF cleanup — Phase-1's pointerleave fix); port HomeHud's event-driven annotation-plane
  parallax verbatim (no rAF loop; canvas never moves under the cursor). `[data-motion="reduced"]`
  branch zeroes all of it.
- [ ] Run: tsc 0 · full `npx vitest run` green (note the count).
- [ ] Commit: `feat(home): console alive — spotlight + reveal + reticle + parallax (reduced-motion still)`

---

### Task 5: Self-review + header-slop exit check + ship behind the flag + owner eyeball

**Files:** none (verification + ship only)

- [ ] Run the `self-review` skill (dispatches `self-reviewer`, native 1500×980, `compy_home_console`
  ON + default-flags run for regression). Must prove with computed evidence: hologram recognizable at
  center; four gauges with honest NOT-YET on unmeasured; **rubric item 6 (header-slop)** on the
  masthead; dock navigates (and no door for absent rooms); limiter readout quiet-tag register;
  reduced-motion still page; no vendor purple; flag-off Home unchanged. No done-claim without a
  quoted PASS.
- [ ] Full verify: `npm run build` (tsc 0) · `npx vitest run` (all green, new count) ·
  `cargo test --manifest-path src-tauri/Cargo.toml` (unchanged count) · `git diff -- src-tauri` EMPTY.
- [ ] Build + silent-reinstall via the `ship` skill (`scripts/ship-reinstall.ps1`), stamp-verify live
  == HEAD via the embedded `COMPY_GIT_HASH`, ONE installer on the Desktop
  ([[silent-reinstall-is-my-job]]).
- [ ] Ship-docs commit: `docs/RELEASE_STATE.md` Snapshot row · `docs/BACKLOG.md` steering-log entry ·
  `docs/UI_VISION_BACKLOG.md`.
- [ ] Owner eyeball: flip **Settings → Appearance → "Home console (preview)"**, open Home, react.
  Taste gate before default-ON and before Phase 3 (Monitor — the oscilloscope kit component).

---

## Phases 3…N (unchanged sketch, each gets its own plan after its predecessor's eyeball)

**Monitor** (gauges + a real `Oscilloscope` kit component on live telemetry) · **History/Black Box**
(flight-recorder log) · **Gaming Mode** (arm/engage console) · **Settings/Setup** (quiet console
chrome) · then the app-wide viewport HUD frame + global reticle once every tab has adopted the
language. Every phase exits through the header-slop check.

## Self-Review (plan vs spec) — done
- Spec's Home row covered: rig hologram center (T2) ✓ · top gauges readiness + limiter (T2 gauges +
  T3 readout — limiter is a titled fact, not a fake numeric gauge) ✓ · dock into the rooms (T3,
  honest doors off `visibleTabs`) ✓ · cold-open framing via the existing proven masthead (T2) ✓.
- Rails: flag-off byte-identity (T1 pin) · zero src-tauri (poll reuses existing commands) · honesty
  rail (null ⇒ NOT-YET, no invented score, rule-5 GPU tone) · header-slop exit check (T2 pin + T5
  rubric 6) · reduced-motion + vendor-purple pins (T4) · self-review/ship laws (T5) ✓.
- Known-bug avoidance encoded: `animation-fill-mode: backwards` (bench hover bug) · memo-stable
  rig handler (T1.5 idle-repaint) · ReticleCursor rAF/pointerleave (Phase-1 review fix) · quiet-tag
  register for the limiter (retired alert-badge pattern) ✓.
- Placeholder scan: no TBDs; "grep the rail's existing room names" is an honest-lookup instruction,
  not a gap (inventing names would violate the no-new-copy discipline).
