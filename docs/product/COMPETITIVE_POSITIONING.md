# Competitive Positioning

**Derived from:** `../PRODUCT_CONSTITUTION.md`

Compy competes by making powerful PC performance and recovery tooling understandable, personalized, measurable, and reversible. It should absorb useful jobs from the ecosystem without recreating competitors' interfaces or marketing assumptions.

## 1. Positioning thesis

Compy should not claim to be universally fastest because one static preset wins a benchmark.

Compy's stronger claim is:

> **The best configuration is the one that survives measurement on your machine.**

And:

> **Compy makes powerful PC tooling feel like one understandable conversation.**

## 2. Competitor jobs to learn from

### Process Lasso

Useful job:
- serious process/scheduling/power control.

Compy improvement:
- translate low-level mechanisms into user outcomes;
- avoid requiring users to understand affinity, priority, CPU sets, processor groups, or scheduler internals before receiving value;
- test whether a scheduling change matters on this machine/workload.

### Hone / Hypertune / similar optimizers

Useful job:
- accessible optimization catalog and automatic tuning.

Compy improvement:
- per-rig applicability instead of universal-preset confidence;
- measured keep/drop decisions;
- stronger tradeoff explanation;
- honest null results;
- recovery history when an optimization later correlates with trouble.

### WhoCrashed / crash-analysis tools

Useful job:
- make crash evidence readable.

Compy improvement:
- broader game/application/system incident context;
- integrate recent system changes and known-good history;
- connect diagnosis to one safe next Trial/recovery action;
- preserve uncertainty instead of overstating cause.

### HWiNFO / sensor tools

Useful job:
- deep reliable sensor visibility.

Compy improvement:
- expose the minimum sensors that improve a decision;
- do not compete on raw sensor count;
- use unavailable as unknown instead of inventing a reading.

### PresentMon / CapFrameX / benchmark tools

Useful job:
- credible frame-performance measurement.

Compy improvement:
- turn methodology into a guided consumer workflow;
- connect measurement directly to reversible experiments and recommendations.

### OEM / Windows utilities

Useful job:
- hardware-aware/native integration.

Compy improvement:
- remain vendor-neutral;
- reason across the whole machine rather than one vendor's support ecosystem.

## 3. Category challenge

The optimizer category often rewards:

- large tweak counts;
- universal presets;
- process-count reductions;
- average-FPS screenshots;
- one-rig benchmark comparisons;
- certainty without applicability proof.

Compy should visibly challenge those incentives without becoming preachy.

## 4. Marketing wedge

Strong candidate language:

- **The optimizer that proves what works on your PC.**
- **Make your PC better. Know exactly why.**
- **Less tweaking. Better evidence.**
- **The goal isn't more tweaks. It's the right tweaks.**
- **When something goes wrong, Compy already knows the machine.**

“Shows its receipts” remains valuable as proof language, but “optimizer” should not imply a universal preset.

## 5. Benchmark-review counter-position

Compy should educate consumers that one-PC comparisons of optimizer products cannot establish universal ranking.

A useful demonstration should show why the same change may differ across:

- CPU architecture;
- GPU bottleneck;
- hybrid/X3D topology;
- laptop power/thermal limits;
- driver/Windows versions;
- game engine/resolution;
- existing machine state.

The point is not to attack creators. The point is to explain why Compy tests the viewer's own machine.

## 6. Differentiation contract

A feature does not differentiate Compy merely because it exists.

Differentiation comes from the combined loop:

> understand machine → choose outcome → select relevant candidates → safely test → measure → explain tradeoff → keep/restore → remember → diagnose later.

Any competitor can copy a toggle. The coherent evidence loop is harder to copy well.

## 7. Competitive anti-goals

Do not chase:

- the largest optimization catalog;
- the most sensors;
- the most obscure controls;
- the most aggressive claims;
- competitor feature parity without user-decision value;
- benchmark marketing without methodology;
- locked-in subscriptions purely because competitors use them.
