# HQ hand-off — benchmark lane realigned to measured-efficacy

**From:** benchmark lane (worktree `compy-benchmark`, branch `benchmark`).
**Date:** 2026-06-03. **No `main` edits from this lane** — this note is the heads-up; HQ owns the merge
and the cross-cutting reconciliation below.

## TL;DR
The owner changed the benchmark lane's **soul** (2026-06-03): from a vanity *"score /100 + tiers +
cosmetic-reward + UserBenchmark-style leaderboard"* → a **scientific instrument with an undo button**:
**Measure → Change → Re-measure → honest verdict**, with real per-tweak measured deltas and an explicit
**"no measurable change"** when a delta doesn't clear the noise floor. Done in-lane (spec + engine +
mockup), still **PARKED + DARK**.

## What HQ must reconcile (not done by this lane)

1. **`docs/BENCHMARK_INTEGRATION_PLAN.md` is SUPERSEDED on *purpose*.** It still frames the lane as
   "scoring / cosmetic-reward + UserBenchmark-style leaderboard." That framing is dead. **The mechanics
   you specified all still hold** — gated `benchmark_enabled()` tab (Gaming-Mode precedent), own
   `benchmark.json` store, network-in-Rust-only, **no mutation**, and it stays **additive in its own tab**
   so **Decision A (de-gamified hero) is preserved**. Only the *purpose* line changes: efficacy proof, not
   cosmetic rewards; leaderboard → **opt-in anonymized measured-efficacy data** ("on rigs like yours this
   tweak improved X%"). Please update the plan's purpose section.

2. **PresentMon / `ARCHITECTURE_LOCKS §1.7` — ✅ OWNER APPROVED (2026-06-03); HQ to action the reversal.**
   The roadmap wants real game frame-time deltas (frame times, 1%/0.1% lows, GPU-busy) as the *ultimate*
   "Measure". The machinery already exists (`ferrisetw` + the elevated `fps.rs --fps-capture` helper), but
   §1.7 puts frame capture **out of v1**. **The owner has approved promoting it to the core proof — a
   conscious lock reversal.** The lane is designing the PresentMon→`compute_efficacy` seam but **will not
   build it until HQ actions the §1.7 change** (the lock + the elevated path are HQ's domain). The synthetic
   runners (this lane) stay as the "is-my-hardware-to-spec" instrument; PresentMon becomes the
   "did-this-help-my-game" instrument — **complementary**.

3. **Whole-product menu — beyond this lane (HQ/product sequencing).** DPC/ISR latency analyzer, MSI/USB/
   timer-resolution honesty, network bufferbloat, **WHEA crash correlation**, per-app auto-switching
   profiles, and the **"undo bad optimization / PC paramedic" repair mode.** Strong ideas; lane rec for
   first growth = **latency module + PC-paramedic** (highest differentiation, lowest mutation risk;
   overlaps the existing `ADVANCED_PERFORMANCE_BLACK_BOOK.md`).

## What's done in-lane (all dark, parked, green)
- Spec re-souled: `docs/superpowers/specs/2026-06-02-benchmark-score-engine-design.md` (REALIGNED banner).
- Engine: native CPU/RAM/GPU/disk runners (GPU = D3D11 via existing `windows` crate, verified ~6.8 TFLOPS)
  + best-of-N/variance + **new `compute_efficacy` / `measure_efficacy`** (Improved / NoMeasurableChange /
  Regressed; noise floor widens on low-confidence runs; default `DEFAULT_NOISE_FLOOR_PCT = 3.0`).
- Mockup v12 reframed to the measured-instrument soul.
- Commits: `3bdc59a` → `b28115e` → `bd285d5` → `72d2cc3` → `4ab7e29` → `fb59ebc` → `6a634a4` (+ this note).
- Tests green, clippy-clean for the module. `compute_standing` (old composite/tiers) kept in code but
  **demoted** to an optional honest "health summary"; tier-crossing cosmetic celebration dropped.

## Owner decisions (2026-06-03) — all lane recs approved
- **Significance threshold** → conservative **3%** default locked (`DEFAULT_NOISE_FLOOR_PCT`); retune later.
- **Health summary** → **KEEP** as a quiet "performing-to-spec / underperforming" glance (strip the ranking).
- **Leaderboard** → **CONFIRMED = opt-in measured-efficacy data** (not a vanity ranking).
- **PresentMon §1.7 reversal** → **APPROVED** (see §2 above — HQ to action).
- **Build next** → **latency module + "PC paramedic" repair mode** (latency module starting in-lane as the
  measurement/diagnostics family; safe read-only diagnostics first; see the latency design spec).
