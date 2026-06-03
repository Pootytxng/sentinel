# Sentinel Benchmark + Score — engine design (local-first, leaderboard-later)

> **Status: PARKED + DARK.** F6 benchmark lane. Designed/built **in isolation**, stays **parked**
> (not merged to `main`) and **dark** (default-off gate, no live UI) until the owner un-parks.
>
> **This spec is the ENGINE design. The merge contract is HQ's `docs/BENCHMARK_INTEGRATION_PLAN.md`
> (on `main`, owner-confirmed).** Where they overlap, that doc wins; this one fills in the benchmark +
> score internals. **Additive, not a reversal:** the score/reward/leaderboard live **only inside a new
> gated "Benchmark" tab** and never touch the de-gamified `CommandHero` / `SystemPosture` hero, so
> Decision A survives untouched (per the integration plan §1/§4).
>
> **Supersedes** the 2026-06-01 "Sync collaborative progress engine" framing — its honest score model,
> intents, peace-of-mind face, level events, and pure-consumer architecture fold in here, now anchored on
> a **real local benchmark**.

## 0. Owner direction (2026-06-02)

The lane is "benchmark" because the score/reward comes from a **real benchmarking tool in the app**,
UserBenchmark-style (run real tests → score each part → compare), with **cosmetic rewards that unlock as
you score** and (later) a **leaderboard of other Sentinel users**. Owner decision via clarifying question:
**"Local first, leaderboard later."**

- **Phase 1 (this spec's core):** real local benchmark + tangible score + local cosmetic-reward unlocks +
  "is my hardware underperforming vs typical?" — **zero telemetry, no backend, no accounts.** Fully inside
  the locked privacy posture (`PRODUCT_DIRECTION.md` *"local-only / zero telemetry"*; `PRIVACY.md`/`EULA.md`;
  the frozen beta's *"zero outbound TCP"*).
- **Phase 2 (designed-for, NOT built now):** **opt-in, anonymous, Rust-isolated** online leaderboard
  (integration plan §2). Default off; non-opted users stay fully local.

**UserBenchmark caution (owner-flagged):** take the *mechanic*, not the *reputation* (UB is banned from
r/hardware/r/AMD/r/Intel for biased weightings + editorializing). Real tests + **transparent, published
methodology** + same-part percentile; no opaque weighting, no vendor bias, don't lean on the UB name.

## 1. Two honest pillars (load-bearing)

The benchmark makes two *different* claims with *different* honesty cost:

1. **Absolute score + measured before/after delta — needs NO external data, fully honest.** Run → number.
   Apply a Sentinel rec (or the user's own tweak) → re-run → report the **measured** change. *"Re-benchmarked
   after the fix: +6% CPU multi-core, measured on your machine."* Primary driver of the score. Provenance =
   **Measured-signal** (`ARCHITECTURE_LOCKS.md §1.7`); **never** an FPS claim.
2. **Same-part percentile ("is my 3070 underperforming?") — needs a reference dataset, caveated.** Compare
   the user's component score to *typical* for that exact part → exposes throttling / power plan / driver /
   cooling → ties into our recommendations. Phase 1 ships **approximate "seed" baselines** (labeled
   approximate); Phase 2 opt-in makes percentiles real.

> **Design rule: the score + rewards never depend on pillar 2's accuracy.** They're anchored on absolute +
> measured-delta (pillar 1), so nothing the user is rewarded on is ever "a fabricated number." Percentile is
> a secondary, clearly-caveated signal in Phase 1.

## 2. Honesty + safety stance

- **Measured-signal, not a performance promise.** Synthetic scores are health/config signals, never "improved
  FPS by X%." (PresentMon/ETW frame capture stays out of v1.)
- **Variance disclosed, not hidden.** Scores move with background load / thermals / power plan → surface a
  confidence note, "close other apps," best-of-N, detect dirty runs.
- **New behavior class (compute/disk load) but still NOT mutation.** The benchmark *runs work*, so it isn't
  read-only like the rest of the app — but it stays inside the locked safety model: **no kernel driver, no
  game injection, no config mutation, no admin.** User-initiated only, **cancellable**, short thermally-safe
  bursts; disk test = modest temp file in `sentinel_data_dir()`, **fsync'd then deleted**, never user files.
- **"Apply best settings, then measure" — only via the existing typed apply/rollback path** (`APPLIABLE_REC_IDS`
  in `history.rs`), **never a new mutation primitive** (integration plan §4). The benchmark itself never mutates.
- **Layered on `SystemPosture`, never replacing it.** SystemPosture (honest hero) says what's true; the
  Benchmark tab *measures* it and rewards real crossings — in its own room.

## 3. Benchmark engine — components & runner

Each test → normalized sub-score + raw metrics + run-quality. Overall = **published** weighting (no hidden formula).

| Component | Measures | Runs in | Honesty notes |
|---|---|---|---|
| **CPU** | single + multi-thread compute | native Rust (rayon) | report **both** — never collapse to one Intel-favoring number |
| **RAM** | bandwidth + latency | native Rust | sensitive to XMP/EXPO off → ties to that rec |
| **Disk** | sequential + random R/W on a temp file | native Rust | temp file fsync'd + deleted; modest size; cancellable |
| **GPU** | compute/render throughput | **OPEN** — WebGPU/WebGL in webview, or `wgpu` in Rust | a *measured* cross-vendor workload (more honest than vendor APIs); cross-driver comparability is fuzzy → flag |

- **Run protocol:** warm-up, best-of-N, discard outliers, median + spread; detect dirty run (heavy background,
  on battery, thermal throttle) and warn.
- **Provenance:** every sub-score tagged Measured-signal; raw metrics inspectable ("tap to see what was measured").

## 4. Score + cosmetic rewards — "you + Sentinel, measured"

Teamwork framing stays (the hook), now anchored on measurements:

- **Baseline** = first clean benchmark.
- **Guided gains** = measured improvement after applying a Sentinel rec that's still active (Trust Ledger
  `history::applied_changes_summary` / `check_change_active`) → "Sentinel suggested, you decided, it stuck,
  **and here's the measured lift**."
- **Self-directed gains** = improvement where the user changed something themselves (rec `state_kind` probe
  satisfied, no matching active apply) → "you did this; we measured it; credit."
- **Standing** = absolute score + tier; **breakdown** = guided vs self-directed vs by-intent, all inspectable.
  Climbs on real wins; **regresses** if a change is reverted (honest).
- **Cosmetic rewards (the arcade hook the owner wants):** crossing a tier **unlocks a cosmetic** — a theme/
  look — **stored locally**, reusing the existing theme mechanism (`THEMES` / `applyTheme` / `localStorage`,
  `src/App.tsx:531-564`). **No reward depends on the network** (integration plan §1/§4). This is the "level-up,
  show your friends" feeling — earned by real measured progress, living only in the Benchmark tab.
- **Intents** (FPS / Latency / Smoothness / Thermals / Quality / **Peace-of-mind**) weight the standing.
  Peace-of-mind is **one face of the same real number**: reassurance users see *"your parts perform as expected
  for their model — checked, healthy"* (pillar-2 "within normal range", no tweaks needed); competitive users see
  *rank + percentile + unlocks*. Same measurement, different surface.

## 5. Levels + event contract (seam to the design lane)

- ~4 tiers; thresholds are **data**; names are the design lane's.
- A typed event fires **only on a tier crossing**, debounced once-per-crossing (structurally enforces "no
  sensory overload"). The design lane subscribes and owns the single tasteful cosmetic shift per crossing.

```
SyncLevelEvent { from_level:u8, to_level:u8, direction:"up"|"down", reason:String, intents_satisfied:Vec<Intent> }
```

## 6. Same-part comparison (pillar 2 detail)

- **Reference baselines** ship as versioned **data** keyed by normalized part id (GPU/CPU model); source = our
  own runs across representative hardware + publicly-correlated medians; **labeled approximate** in Phase 1.
- **Underperformance → recommendation hook:** "your <part> scored bottom-Nth-percentile for that exact model —
  likely <throttling / power plan / driver / XMP off>; here's the fix." The benchmark *finds* problems the catalog
  already solves — the most product-defining tie-in.
- **Phase 2** replaces approximate baselines with real opt-in aggregates.

## 7. Architecture (built later, dark) — conforms to integration plan §1/§4

- **Rust module `src-tauri/src/benchmark.rs`** — the runner + score + (Phase 2) the bounded network commands.
  Sub-areas: `run` (cancellable workloads → `BenchResult`), `score` (pure `compute_standing(history, applied/
  self-directed states, intents, baselines) -> Standing` + `SyncLevelEvent`s — tested like `priorities`/`readiness`),
  `baselines` (shipped data), and **Phase 2 only** `submit_benchmark_score` / `get_leaderboard` (`reqwest`).
- **IPC commands:** `run_benchmark()` (streams progress, cancellable), `get_standing(intents)`,
  `benchmark_enabled()` gate. **Default-off gate, NOT registered live** until un-parked — Gaming Mode precedent
  (`gaming_mode_gate()`).
- **Separate data store:** `benchmark.json` under `sentinel_data_dir()` — **never** `history.json` / `sessions.json`
  (integration plan §4). Holds benchmark history (for deltas/trend), unlocked cosmetics, last-seen tier.
- **Reuses (pure consumers):** `history.rs` (Trust Ledger), `recommendations.rs` (+ `check_state_kind`),
  `readiness.rs`, `diagnostics.rs`/`hardware.rs` (part identity for baselines; thermal/power state for run-quality).
  **No changes to `actions.rs` / mutation paths.**
- **Frontend (design lane / HQ):** new files only — `src/surfaces/BenchmarkSurface.tsx` + `src/surfaces/benchmark.ts`
  (pure helpers + tests); wire via the existing `Tab` / `SECTION_META` / `visibleTabs` seam (`src/App.tsx:167,169,
  810-821,939`). **Do NOT touch** `CommandHero` / `deriveSystemPosture` / `system-posture.ts`.

## 8. Phase 2 — opt-in leaderboard (designed-for, NOT built) — per integration plan §2

- **Strictly opt-in, default OFF, zero network** until an explicit *"Submit to leaderboard"* action.
- **Minimal anonymous payload:** score + hardware *class* + a **user-chosen handle**. No PII, no telemetry, no
  system inventory — documented in plain language at the opt-in.
- **Network isolated to Rust**, one bounded command (`reqwest` in `benchmark.rs`). Webview gets **no** network
  primitive: **no `http:`/`shell:`/`fs:` capability added; production CSP `connect-src 'self' ipc:` unchanged.**
  The single invariant that changes: the Rust core gains its **first outbound HTTPS call** — gated, opt-in, isolated.
- **Score integrity:** sign submissions (reuse repo `ed25519-compact` pattern) and/or server-side sanity bounds,
  or the board fills with spoofed scores.
- **Docs/security delta when it ships:** add an *"optional online leaderboard"* section to `PRIVACY.md` + `EULA.md`;
  re-baseline the `/security` "expect 0 network" rule → *"0 unless leaderboard explicitly opted in,"* documented.

## 9. Failure posture

- Component can't run (no GPU API, locked disk) → "not measured," never panics; score uses what it has, honestly
  noting partial coverage.
- Dirty run → flagged low-confidence, not silently scored.
- Missing baseline for a part → absolute score only, omit percentile ("no reference yet").

## 10. Testing

Pure unit tests for the score fns (fixtures of bench results + ledger states + intents → standing, breakdown
split, tier, crossing events incl. downward-on-revert + peace-of-mind "within normal range"). Runner tests:
determinism of *shape* (not absolute timing) + cancellation + temp-file cleanup. No mutation → nothing to
integration-test against system config.

## 11. Out of scope

- No `src/` edits / final UI / naming from this lane — that's design lane + HQ via the integration plan.
- No mutation, kernel, injection, admin. No live command registration until un-parked.
- No PresentMon/ETW FPS proof (separate out-of-v1 tier).
- **No telemetry / online leaderboard in Phase 1** (opt-in Phase 2 only).

## 12. Open product calls (for the owner)

1. **GPU benchmark approach** — WebGPU/WebGL (webview, variable) vs `wgpu` (Rust, heavier), or ship CPU/RAM/disk
   first + GPU fast-follow. *Recommend:* CPU/RAM/disk first, GPU fast-follow.
2. **Overall weighting** — publish it; CPU vs GPU vs RAM vs disk shares of the "Sentinel score."
3. **Seed baseline coverage** — how many parts at launch + how to honestly label "approximate."
4. **Cosmetic reward set** — which looks/themes unlock at which tiers (reuse existing theme system).
5. **Tier count + names** (~4; names design-lane's) and **confirm the 6 intents**.
