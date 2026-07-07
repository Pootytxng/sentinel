# Two Futures — measured split view (Exebenus-inspired, receipts-honest)

**Date:** 2026-07-07 · **Lane:** spec'd in Cowork, build owner = CC
**Status:** ✅ **BUILT v1 (2026-07-07, CC): `4df5448` + fixes `eb5df81`** — owner explicitly pulled
it ahead of RUNG 2 same day (RUNG 2 = T6/T5/reboot#4 remains REQUIRED and open; this train is
frontend-only/flag-OFF and moves no gate). Self-reviewer **PASS** at eb5df81 (fresh full rubric
after a first FAIL fixed: efficacy-card subsume + orbit azimuth clamp, both guard-pinned).
**Flag:** `compy_two_futures` — **default OFF** until owner eyeball (self-review PASS ✓).

**v1 scope decision (recorded at build):** the trial `MetricWindow` pair is `pub(crate)`-only —
it never crosses IPC, so a trial-sourced split cannot render in v1 without fabricating absolutes
from a bare effect%. **v1 pair source = benchmark `baseline`+`latest`+`efficacy` alone** (the
delta rail shows per-component before → after scores, not the avg-FPS/p1/stutter% trial shape);
the trial-sourced split ships with the v2 persist-latest Rust read. Also in the same train:
the bay shell gained the `clearSpot` viewer-facing translucency window (`209e4dc`, owner ask) —
reused on the split's "Now" shell.

## Origin & what we are (and are not) stealing

Owner reviewed https://www.exebenus.com/ (2026-07-07, Cowork walkthrough). Their core device: one
dataset split into two side-by-side outcomes — "Without Spotter" (grey, falls behind) vs "With
Spotter" (accent, warned early) — with diverging counters and quantified delta cards ("41 Hrs
Behind / +$854K" vs "0 Hrs / $0"). The persuasion is the quantified comparison, not the graphics
(theirs is a baked AVIF frame-scrub, no runtime 3D; ours is a live r3f scene — strictly stronger).

**Steal:** the dual-outcome split composition · delta stat cards with verdict chips · restrained
accent-vs-desaturated color language.
**Reject:** fabricated counterfactuals ("you *would have* lost X") — Exebenus's numbers are
invented scenario figures; ours must come from measured structs or the surface does not render.
Also reject: the depth/descent metaphor (no natural axis on a PC) and any duplicate of the
existing Setup & Tour fly-through (`src/surfaces/setup/HardwareTourScene.tsx` — already shipped,
do NOT rebuild).

## The one law of this feature

> **No measured pair → no split view. Ever.**
> Every number on this surface traces to a persisted or in-session measured struct. No estimates,
> no projections, no "typical rigs," no placeholder demo data (not even labeled). The empty state
> sells the feature honestly: "Run a benchmark before and after a fix to earn this view."

This is the Exebenus trap inverted: everyone in the optimizer lane fakes this visual; ours is the
only one that's true, and that's the point (RECEIPTS_DOCTRINE — amplify measured wins loudly).

## Data sources (all exist today — no new measurement infra)

1. **Benchmark baseline vs latest** — `BenchmarkState { latest, latest_at, baseline, baseline_at,
   efficacy }` (`src-tauri/src/benchmark.rs` ~852, mirrored `src/types.ts` ~218). Baseline persists
   (`benchmark.json`); `latest`/`efficacy` are in-memory per session, with per-component
   `delta_pct` + `Verdict`.
2. **Tweak A/B trial** — `benchmark_trial.rs`: real frametime `MetricWindow` pairs
   (avg fps, p1/p0.1 lows, stutter%) with bootstrap-CI verdicts; "Keep" results persisted to
   `scoreboard.json` as `AwardEntry`.

**v1 scope decision (keeps it frontend-only):** render only from what's readable this session —
benchmark baseline+latest when both exist, or a completed trial's window pair. Persisting `latest`
to disk is a small Rust change with no gate implications (local file, zero outbound) but is
explicitly **out of v1**; note it as v2 if the empty state proves too common in practice.

## Design

**Placement:** the Lab / benchmark room, adjacent to where efficacy already reads out — that's
where the data lives and where the user just did the work. The Home bay stays a single hologram
(don't crowd the room that just got its v2 look). If the owner wants it reachable from Home later,
that's a link, not a second canvas.

**Composition:** one canvas, two viewports (r3f scissor or two offset groups — builder's call),
same procedural rig from live `HardwareInfo`:
- **Left — "Baseline · <date>":** desaturated/faint variant of the hologram materials (reuse
  `use-rig-colors.ts` values at reduced opacity/greyed accent; do not invent a new palette).
- **Right — "Now" / "After <tweak name>":** full theme accent, v2 holographic treatment when
  `compy_hologram_v2` is on.
- **Delta rail between/below:** avg FPS, p1 low, stutter% as `before → after (±delta%)` with the
  existing `Verdict` chip language. Reuse verdict/copy idiom from the benchmark surface — no new
  promise-flavored copy; the numbers speak.
- **Part-level emphasis:** scale emissive/glow on GPU/CPU parts by measured per-component
  `delta_pct` from `efficacy` where present. No measured component delta → neutral glow (never
  imply a part improved without data).

**States:** (a) no pair → honest empty state, no 3D; (b) pair exists → split renders;
(c) reduced-motion → static two-pose, no orbit/glitch (matches v2 conventions); (d) game capture
step-aside + `frameloop="demand"` idle-rest carry over unchanged from `RigHologram.tsx`.

**Perf budget:** second viewport ≈ ≤2× current bay draw cost, only while the surface is visible;
stays inside the existing lazy 3D chunk; zero idle GPU via demand frameloop (v2 pattern).

## Hard lines (restated as negatives, deliberately)

- No number on this surface that does not trace to `BenchmarkState`/`Trial`/`scoreboard` structs.
- No rendering of the split with partial data (one side measured, other side inferred).
- No new risky tweaks, no catalog changes, no `src-tauri/` mutation-boundary edits (v1 touches
  zero Rust).
- No copy that promises gains ("could," "up to," "typically") — before/after/delta only.
- No second guided tour; no depth metaphor; no baked frame sequences.

## Verification (bug→guard tier: automated first)

- **New guard test (the anti-fabrication guard):** vitest asserting the split component renders
  nothing / empty-state when no measured pair is present, and renders only struct-sourced values
  when it does (no literal fallback numbers in the component — grep-guard acceptable as a first
  tier).
- Reuse `theme-contrast.test.ts` pattern for the desaturated-left palette against both themes.
- Orbit/opt-in convention guard parity with `hologram-orbit-optin-guard.test.tsx`.
- tsc + full vitest (currently 1071 passing — count must not regress) + `self-reviewer` agent PASS
  with capture before any done-claim; ship via the `ship` skill (silent reinstall + stamp verify).

## Receipts-doctrine follow-ups (not v1)

- The split composition is the natural **share card** (money stack: content engine → aggregate
  receipts marketing). A "save as image" export of the split with rig specs + measured deltas is
  the obvious phase-2 — outbound-nothing, local PNG only. Spec separately when pulled.
- compy.gg scroll-narrative version (full Exebenus treatment) belongs to the web content engine
  phase, driven by aggregate opt-in Receipts data once that exists — never by scenario numbers.

## Effort & routing

~One focused train (M): scene work is additive around `RigHologram`/`RigPartGeometry` reuse;
data plumbing is read-only against existing types. CC lane (post-Jul-7 = Opus 4.8 — fine, this is
a normal build train, x-high effort not required). Subagents per standing rule: sonnet
verification/audit, self-review via `self-reviewer`.
