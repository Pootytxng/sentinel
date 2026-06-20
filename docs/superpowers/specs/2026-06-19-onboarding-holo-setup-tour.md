# Onboarding revamp — "Compy Setup & Tour" (HoloLens, combined, re-runnable)

**Owner ask (2026-06-19):** the one-time onboarding is a "really cool fluid linear path" but goes
dormant after first use (only re-findable buried in Settings). Make it **prevalent + re-runnable
from Home** as an automated guided setup, **spiced up** in a **HoloLens** visual style, and fold in a
**tab tour** that explains each room's purpose with **visual representations of Compy's inner
framework**.

**Council-resolved + owner-confirmed decisions:**
- **Structure = COMBINED** — one linear journey: Leg 1 guided setup, then Leg 2 tab tour.
- **Visuals = FULL 3D holographic** — reuse the rig-hologram three.js/R3F engine conventions.
- **Prevalence** — a prominent, always-present, re-runnable Home launcher card. Auto-**offered** on
  true first-run only; **never re-nag** after that (Contrarian 🔴 guardrail).

## Dependency / branch / merge order

Full-3D needs the three.js stack (`three`, `@react-three/fiber`, `@react-three/drei`) + the
holographic primitives (`use-rig-colors`, the holographic-material conventions) which live **only on
`feat/rig-hologram`** (unmerged). So this builds on **`feat/onboarding-holo` (branched off
`feat/rig-hologram`)**. **Merge order: rig → main, then onboarding** (or both together). Flag to owner.

## Architecture

New surface dir `src/surfaces/setup/`:
- `SetupTour.tsx` — full-screen overlay flow shell. Linear stepper, HoloLens chrome
  (`AmbientBackdrop` + instrument glass + a scanline veil), progress rail, **Back / Skip / Next**,
  Esc-to-close, focus-trap, **reduced-motion honored**.
- `setup-steps.ts` — pure step model (the ordered legs + per-room tour copy), unit-tested.
- `HardwareTourScene.tsx` — the 3D centerpiece. **Owner redesign (2026-06-19):** the abstract
  "framework of rooms" (diamonds) was replaced with the user's **REAL rig** — it reuses the rig
  hologram's `buildRigParts` + `RigPartGeometry` + `useRigColors`, shown exploded, with the **camera
  flying to whichever component the current lesson is about** (the focused part lights up + rotates;
  the rest stay faint). Same hardware the user sees in the Rig view → never abstract. Lazy-loaded;
  `frameloop="demand"` under reduced-motion / step-aside. (The old `FrameworkScene.tsx` is deleted.)
- `SetupLauncherCard.tsx` — the prominent HoloLens Home card ("Set up & tour Compy").
- `SetupTour.css` — flow + launcher styling, all `--ix-*` tokens (theme-correct, no bare hexes).

### Leg 1 — Guided setup (reuse, don't reinvent)
Reuse the existing first-experience content, presented as tour steps:
1. **Your rig** — real `HardwareInfo` (the existing StepRig content).
2. **The seatbelt** — the rollback/TrustSwitch demo (visual only, no mutation — as today).
3. **House rules** — no kernel driver / no injection / no telemetry.
4. **First check** — live readiness scan + **one-click apply of the #1 limiter** via the EXISTING
   `apply_recommendation` path behind `useConfirm()` (same as `FirstCheck.tsx` today). No new
   mutation primitive; the already-QA'd apply path.

### Leg 2 — Hardware tour (owner redesign 2026-06-19)
A fly-through of the user's **real components**, in the owner's order
(**power → storage → graphics → processor → memory**). For each, the camera focuses that component
and a glass card teaches three things: **what it does**, the **metric it drives**, and the **real
Compy tweaks that touch it** (every tweak named is an actual catalog rec; advisories are labelled as
such). This educates the user on what each part does AND ties every setting to the hardware
responsible for it — the per-rig brand promise, deepened.

- **Power delivery** (PSU ghost) — power plan · Fast Startup · USB/PCIe power-saving → sustained
  clocks. Honesty note: the PSU isn't software-readable, so it stays a ghost; the power *settings* are
  what's real.
- **Storage** — SysMain · reserved-storage/free-space · SSD-upgrade advisory → load times / hitches.
- **Graphics** — HAGS · vendor telemetry off (NVIDIA Container / AMD UXP) · prefer-discrete · driver
  freshness → FPS + frame consistency.
- **Processor** — boost-friendly power plan · startup-app review → 1% lows / frametime smoothness.
- **Memory** — headroom watch + heavy-app flags · capacity advisory → stutter / alt-tab hitches.

Lessons are skipped for any component kind absent from the rig (pure `buildHardwareSteps`, tested).

### Finish
"You're set." → close → land on **Home**.

## Surfacing / first-run / persistence

- **Home launcher card** on `DashboardV2` (default Home) **and** `CommandCenter` — opens `SetupTour`
  anytime. Always present (the re-entry that fixes "buried in Settings").
- **First-run:** auto-open `SetupTour` on true first run **only**. New key
  `compy_setup_tour_v1 = "1"` set on finish **or** skip. After that: card stays, **no auto-open**.
- **Back-compat:** if `compy_onboarded_v1` is already `"1"` (existing users), do **not** auto-open;
  they discover the card. The new tour supersedes the old `Onboarding` + `FirstCheck` auto-modals for
  fresh installs (old components kept as the failsafe until parity is confirmed, then retired —
  tracked with the classic-surface cleanup).
- **Settings:** "Re-run setup" → opens `SetupTour` (full); keep "Re-run check" → jumps to the Leg 1
  first-check step.

## Safety / scope (LOCKED rules honored)

- **Frontend-only + reuse of existing IPC.** No new backend `#[tauri::command]`. The only mutation is
  Leg 1's #1-limiter apply, which reuses the audited `apply_recommendation` + `useConfirm()` — no new
  primitive, no catalog change.
- **No gate flips**, no remote-fetch/updater touch, **capabilities/CSP untouched** (the tour is
  internal; no new external URL).
- **Read-only/advisory** 3D; perf-gated + reduced-motion like the rig canvas.
- Reversible: feature branch, additive components, small commits.

## Verification

`tsc` clean · `vitest` green (+ unit tests for `setup-steps.ts`) · `/check` · `/security` · CDP
visual pass (launcher card + flow legs + 3D focus + no-renag logic).

## KPI (receipts doctrine — one metric, noted not built)

Future (if/when telemetry arms): **% of fresh installs that COMPLETE the tour**. For now: build it;
the metric is the success definition.
