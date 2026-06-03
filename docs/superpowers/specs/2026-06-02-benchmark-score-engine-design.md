# Sentinel Benchmark + Efficacy — engine design (measured-instrument soul)

> **Status: PARKED + DARK.** F6 benchmark lane. Built **in isolation**, stays **parked** (not merged to
> `main`) and **dark** (default-off gate, no live UI) until the owner un-parks.
>
> ### ⚠️ REALIGNED 2026-06-03 — soul changed from "vanity score" to "measured instrument."
> Owner adopted the *scientific-instrument* roadmap: **"be a scientific instrument with an undo button,
> not a magic potion."** The spine is **Measure → Change → Re-measure → Keep / Revert**, with **real
> per-tweak measured deltas** and an honest **"this did nothing measurable"** verdict. This **demotes** the
> earlier UserBenchmark-style **vanity composite score / tiers / cosmetic-reward / competitive leaderboard**
> direction. Real measurement (the runners) is kept; the *framing* is now efficacy, not a "/100" ranking.
>
> **HQ reconciliation REQUIRED:** HQ's `docs/BENCHMARK_INTEGRATION_PLAN.md` (on `main`) still frames this
> lane as *"scoring / cosmetic-reward + UserBenchmark-style leaderboard."* **That framing is superseded by
> this realignment** — HQ must update the integration plan. The *mechanics* HQ specified (gated tab, own
> `benchmark.json` store, network-in-Rust-only, no-mutation) all still hold; only the *purpose* changes
> (efficacy proof, not cosmetic rewards). Decision A (de-gamified hero) is still preserved — efficacy lives
> in its own Benchmark tab.

## 0. The spine (this is the whole moat)

Every mainstream "optimizer" is snake oil because it's *all scalpel, no x-ray* — it flips switches and never
checks the pulse before or after. Sentinel's differentiator is the loop no one does honestly:

**Measure → Change → Re-measure → Keep or Revert.**

- **Measure** — a real local benchmark (the runners below) records a baseline.
- **Change** — exactly one tweak, via the **existing typed apply/rollback path** (`APPLIABLE_REC_IDS`). The
  benchmark never mutates anything itself.
- **Re-measure** — run the same benchmark again.
- **Verdict** — show the **measured delta**, and if it's **within the noise floor, say "no measurable
  change" out loud.** That honesty is the product.
- **Keep or Revert** — one-click, per-tweak (the locked rollback-first Trust Ledger already does this).

This lane owns **Measure + Verdict**. The Change/Revert half is the existing mutation/rollback system (HQ /
the live app); the loop is wired at integration.

## 1. Two honest pillars

1. **Measured per-tweak efficacy (THE SOUL).** Baseline → apply one tweak → re-measure → **delta with a
   significance test**. Provenance = **Measured-signal**. Three honest verdicts: **Improved / No measurable
   change / Regressed**, each with the number *and* whether it cleared the noise floor. Never an
   unmeasured FPS claim.
2. **Same-part health ("is my 3070 underperforming?").** Compare a component's measured score to *typical*
   for that exact part → exposes throttling / power plan / driver / cooling → feeds the recommendations
   ("you're 20% low for this card → here's the misconfig"). Phase 1 ships **approximate seed baselines**
   (labeled approximate); the opt-in efficacy network (§8) makes it real later.

> **Demoted (was the old soul):** a composite "Sentinel score /100", tiers, cosmetic-reward unlocks, and a
> competitive vanity leaderboard. The roadmap's own line — *"real benchmarks, not a made-up score /100"* —
> is the rejection of exactly that. An honest **aggregate health summary** may still exist as a secondary
> glance ("your rig is performing to spec"), but it is **not** the centerpiece and is **never** a ranked
> vanity number.

## 2. Honesty + safety stance

- **Honest nulls are mandatory.** If a tweak's delta doesn't clear the run-to-run noise floor (the
  best-of-N variance we already compute), the verdict is **"no measurable change"** — full stop. This is
  what makes Sentinel the only non-charlatan in the room.
- **Significance from real variance.** The noise floor = the spread across best-of-N repeats (already built,
  `high_variance`). A delta inside that band is noise, not a win.
- **Measured-signal, never a promise.** Synthetic scores are health/efficacy signals, never "improved FPS by
  X%" out of thin air.
- **New behavior class (compute/disk load) but still NOT mutation.** The benchmark *runs work*, so it isn't
  read-only — but it stays in the locked safety model: **no kernel, no injection, no config mutation, no
  admin.** User-initiated, **cancellable**, short bursts; disk test = temp file, fsync'd then **deleted**,
  never user files.
- **"Apply then measure" only via the existing apply/rollback path** (`APPLIABLE_REC_IDS`), never a new
  mutation primitive. **Layered on `SystemPosture`, never replacing it.**

## 3. Benchmark engine — runners (BUILT, kept) ✅

Native, real, verified. Each test → normalized 0–100 sub-score + raw metric + run-quality.

| Component | Measures | Runs in | Status |
|---|---|---|---|
| **CPU** | multi-thread integer compute | native Rust | ✅ built |
| **RAM** | bandwidth sweep | native Rust | ✅ built |
| **GPU** | D3D11 compute (FMA kernel) | `windows` crate (no new deps) | ✅ built — verified ~6.8 TFLOPS on real HW |
| **Disk** | seq write/read, temp file, auto-cleaned | native Rust | ✅ built |

- **Run protocol:** warm-up, **best-of-N** (keep best), variance → **Clean / Low** confidence. ✅ built.
- **Normalization:** PLACEHOLDER reference constants (clearly labeled) — only meaningful once tuned, but the
  **efficacy delta does NOT depend on absolute normalization** (a delta of the same measure cancels the
  reference out), so the soul works *today*.

## 4. Efficacy model — the centerpiece (to build, dark)

The new heart. Pure + testable, like the runners.

- `Measurement` = a snapshot of component raw metrics + run-confidence + timestamp.
- `compute_efficacy(before, after, noise_floor) -> Efficacy` where
  `Efficacy { per_component: [{component, before, after, delta_pct, verdict}], overall_verdict }`
  and `verdict ∈ { Improved, NoMeasurableChange, Regressed }` — `NoMeasurableChange` when `|delta| ≤
  noise_floor` (from best-of-N variance).
- **Keep/Revert support:** the loop surfaces the verdict; the actual keep = leave the applied change,
  revert = the existing rollback path. The efficacy module only *informs*, never mutates.
- **Honest framing in copy:** "We measured before and after. CPU multi-core: **+0.4% — within noise, no
  measurable change.** Want to keep it anyway, or revert?"

## 5. Aggregate health summary (demoted, optional)

A secondary, honestly-framed "is my rig performing to spec" glance — **not** a ranked vanity score. The old
`compute_standing` (composite + tiers + crossing events) is **kept in code** (tested) but **re-cast** as
this optional health summary; the tier-crossing **cosmetic-reward celebration is dropped** (that was the
gamification the roadmap rejects). No "level up, show your friends." If a glanceable number exists, it reads
*"healthy / underperforming"*, sourced from §1 pillar 2.

## 6. Same-part comparison (pillar 2 detail) — kept

- **Reference baselines** ship as versioned data keyed by normalized part id; **approximate** in Phase 1.
- **Underperformance → recommendation hook:** the benchmark *finds* problems the catalog already solves —
  the most product-defining tie-in, and pure scientific-instrument behavior.

## 7. Architecture (dark) — conforms to integration plan mechanics

- **`src-tauri/src/benchmark.rs`** — runners ✅ + `compute_standing` (now health summary) ✅ + **new efficacy
  module** (`Measurement`, `compute_efficacy`, verdicts) + Phase-2 bounded network commands.
- **IPC (dark, not registered):** `run_benchmark()`, `measure_efficacy(before,after)`, `benchmark_enabled()`
  gate. Default-off gate — Gaming Mode precedent.
- **Separate store:** `benchmark.json` under `sentinel_data_dir()` — never `history.json`/`sessions.json`.
- **Reuses (pure consumers):** `history.rs`, `recommendations.rs`, `readiness.rs`, `diagnostics.rs`/
  `hardware.rs`. **No changes to `actions.rs` / mutation paths.**
- **Frontend (design lane / HQ):** new files only; existing `Tab`/`SECTION_META`/`visibleTabs` seam; **do
  NOT touch** `CommandHero`/`SystemPosture`.

## 8. The real long-game moat — opt-in measured-efficacy data (reframed leaderboard)

The leaderboard is **no longer a vanity ranking**. It becomes the roadmap's moat: **opt-in, anonymized,
aggregated measured deltas** — *"on rigs like yours (9800X3D-class), this tweak improved 1% lows by an
average of X%."* This is the honest, unique, compounding flywheel a CCleaner can never retrofit, and it's
**far more defensible** than another UserBenchmark clone.

- Same privacy model as before: **strictly opt-in, default OFF, zero network** until an explicit submit;
  **minimal anonymous payload** (tweak id, hardware class, measured delta — no PII, no inventory); **network
  isolated to Rust**, one bounded command (no webview network primitive, CSP unchanged); **signed
  submissions + server-side sanity bounds** for integrity.
- **Free to host at launch scale** (Cloudflare Workers + D1 / Supabase free tiers); cost only at real scale.
- **Docs/security delta when it ships:** `PRIVACY.md` + `EULA.md` "optional online efficacy data" section;
  re-baseline `/security` "expect 0 network" → "0 unless opted in."

## 9. Failure posture

- Component can't run → "not measured", never panics; honest partial coverage. ✅
- Dirty/noisy run → Low confidence, widens the noise floor (so marginal deltas correctly read as "no change").
- Missing baseline → omit percentile ("no reference yet"); efficacy delta still works (it's self-relative).

## 10. Testing

Pure unit tests: efficacy verdicts (improve/regress/within-noise → correct verdict using the noise floor),
runner shape + cancellation + cleanup ✅. No mutation → nothing to integration-test against system config.

## 11. Cross-lane / locked decisions — FLAGGED for HQ + owner (NOT acted on from this lane)

The realignment touches things outside this lane's authority. **This lane does not change them** — it flags:

1. **`BENCHMARK_INTEGRATION_PLAN.md` is superseded** (cosmetic-reward/vanity-leaderboard → measured-efficacy).
   HQ updates it; mechanics unchanged.
2. **PresentMon / `ARCHITECTURE_LOCKS §1.7` (the big one).** The roadmap wants **real game frame-time deltas**
   (PresentMon: frame times, 1%/0.1% lows, GPU-busy) as the *ultimate* proof — the most honest possible
   "Measure". Sentinel **already has the ETW capture machinery** (`ferrisetw`, the elevated `fps.rs`
   `--fps-capture` helper). But §1.7 currently puts frame capture **out of v1**. Promoting it to the
   centerpiece is a **conscious lock reversal = HQ + owner decision.** *Recommendation: pursue it — it's the
   roadmap's strongest measurement and the machinery exists — but consciously, with HQ.* The synthetic
   runners (this lane) remain the "is-my-hardware-to-spec" instrument; PresentMon becomes the "did-this-help-
   my-game" instrument. Complementary, not a replacement.
3. **The whole-product menu** (DPC/ISR latency analyzer, MSI/USB/timer-resolution honesty, network
   bufferbloat, crash correlation via WHEA, per-app auto-switching profiles, **"undo bad optimization / PC
   paramedic" repair mode**) is **whole-product + HQ/locks territory, beyond this benchmark lane.** Strong
   ideas; sequence them; the latency module + "PC paramedic" positioning are the highest-differentiation,
   lowest-mutation-risk places to grow.

## 12. Open calls (for the owner)

1. **Significance threshold** — what delta counts as "real" vs noise (default: must exceed best-of-N
   variance; tune later).
2. **PresentMon decision** (§11.2) — promote frame-capture to the core proof? *(Rec: yes, with HQ.)*
3. **Confirm the leaderboard is now measured-efficacy data** (§8), not a vanity ranking. *(Rec: yes.)*
4. **Aggregate health summary** — keep the demoted glance at all, or drop it entirely for pure per-tweak
   efficacy?
