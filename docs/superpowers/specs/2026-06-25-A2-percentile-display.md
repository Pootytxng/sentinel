# A2 — percentile display (LOCAL display-only stub)

**Lane:** measurement · **Status:** building · **Date:** 2026-06-25

## Problem

`benchmark_scoreboard::percentile_rank` is fully implemented + unit-tested but **never called**
(dead code; `benchmark_scoreboard.rs:60`, flagged in BACKLOG line 258). The real value it was built
for — "you're in the top X% for setups like yours" — needs a **peer cohort**, which is **Phase C
(cross-user network), gated**. So we cannot ship the peer-percentile honestly yet.

## Goal

Wire `percentile_rank` into a **LOCAL, display-only** standing — ranked against the data we
*actually* have on-device: the user's own **verified wins** (the scoreboard ledger). Each
`AwardEntry` already carries a measured `effect_pct`; that set is a genuine, honest, like-to-like
local cohort. Surface, per win, "Top X% of your verified wins," clearly labeled **"local — your own
results, no peer cohort yet"** so it can never be mistaken for a global/peer ranking.

This un-dead-codes `percentile_rank` and gives the Score drill-down a real standing, while staying
strictly within the honesty rails: no fabricated peer data, no network, no claim we didn't measure.

## Design

### Backend (`src-tauri/src/benchmark_scoreboard.rs` — my domain)
- New `const MIN_COHORT_FOR_PERCENTILE: usize = 4` — below this, ranking 1–3 wins is degenerate
  (a single win is trivially "50th percentile of itself"), so we show **nothing** rather than a
  number that overclaims significance.
- New pure helper `local_win_percentiles(awards: &[AwardEntry]) -> Vec<Option<f64>>`: when the
  cohort is large enough, rank each award's `effect_pct` within the cohort of **all** awards'
  `effect_pct` via the existing `percentile_rank`; else all-`None`. Returns a vec **parallel to and
  the same length as** `awards` (a guard test pins the length invariant).
- `ScoreboardView` gains `local_percentiles: Vec<Option<f64>>` — **display-only, never persisted**
  (`AwardEntry`/`ScoreStore` shapes unchanged → old ledgers deserialize identically). `scoreboard()`
  computes it from the (already newest-first) `awards`, same order.

### Frontend (`src/surfaces/{Benchmark.tsx, benchmark-view.ts}` — my domain)
- `ScoreboardView` TS type (`src/types.ts`, the serde mirror; consumed only by Benchmark.tsx) gains
  `local_percentiles: (number | null)[]`.
- New pure helper `fmtLocalWinTopPct(percentile)` in `benchmark-view.ts` (DOM-free, unit-tested):
  `null`/non-finite → `null` (UI shows nothing); else `Top {100 - percentile, clamped 1..=100}% of
  your verified wins`. "Top %" is the natural complement of the percentile (higher percentile →
  smaller, better top %), matching `percentile_rank`'s own doc framing.
- In the award drill-down "Certified receipt" `<dl>`, add an **"Among your wins"** row when the
  helper returns a label, with a muted qualifier "local — your own results, no peer cohort yet."
  Defensive read `score.local_percentiles?.[i]` so a missing/stale field never throws.

## Honesty / firewall

- One-directional firewall intact: this is read-only display over the scoreboard; nothing flows back
  into verdict math.
- No peer/network data, no fabricated number — the only inputs are the user's own measured `effect_pct`s.
- Explicitly labeled local + gated below a 4-win cohort floor, so it never poses as a global ranking.

## Tests
- Rust: all-`None` below the floor; `Some`+in-range+length-matches at/above the floor; ordering.
- TS: `fmtLocalWinTopPct` null-guards, complement math, and 0/100 clamp boundaries.
