# Trial Protocol

**Derived from:** `../PRODUCT_CONSTITUTION.md`

A Trial is Compy's canonical unit for proving or disproving a bounded intervention.

## 1. Required Trial contract

Every Trial must define:

- `purpose`: user outcome/problem addressed;
- `eligibility`: machine/workload conditions required;
- `mechanism`: exact supported action being tested;
- `prior_state`: exact state needed for restoration;
- `risk_class`: from `RISK_MODEL.md`;
- `measurement_plan`: workload, metrics, duration/sample rules, repeat count where needed;
- `noise_model`: how normal variation is estimated;
- `interaction_group`: known confounds/dependencies;
- `abort_conditions`: safety/stability/quality stops;
- `result`: better / worse / negligible / inconclusive / unmeasurable;
- `decision`: keep / restore / defer / retest / user choice;
- `receipt`: evidence and provenance sufficient to explain the decision later.

## 2. Baseline

A Trial requires a comparable baseline unless the intervention is diagnostic-only and no before/after claim will be made.

Baseline quality must be classified. If repeatability is too poor, Compy does not manufacture a verdict.

## 3. One causal question at a time

Where attribution matters, isolate the intervention or use a bundle whose combined effect is intentionally the object being tested.

Do not attribute a bundle's effect to one member without evidence.

## 4. Measurement order

Preferred order:

1. verify current state;
2. capture baseline;
3. snapshot exact rollback state;
4. apply through the approved mutation boundary;
5. verify target state;
6. run treatment measurement;
7. compare against baseline/noise;
8. classify result;
9. keep or restore;
10. verify final state;
11. write receipt.

## 5. Noise

A delta smaller than credible run-to-run variation is not a win.

If the likely effect cannot be distinguished from noise within a reasonable test cost, classify it as negligible/unmeasurable and prefer the default/current state.

## 6. Stability

Performance improvement that introduces instability is not an unqualified win.

Depending on risk class, stability validation may include repeated workload, crash/hang observation, thermal boundaries, integrity checks, or stronger component-specific stress tests.

## 7. Abort

Abort immediately if:

- rollback state is incomplete;
- target state cannot be verified;
- safety/thermal boundary is crossed;
- the workload becomes incomparable;
- the app loses required evidence;
- the user stops the Trial;
- another change invalidates attribution.

Abort must preserve enough state to restore safely.

## 8. Result semantics

- **Better** — improvement exceeds the noise/confidence threshold with no disqualifying tradeoff.
- **Worse** — meaningful regression or unacceptable cost.
- **Negligible** — any effect is too small to justify the change.
- **Inconclusive** — evidence conflicts or is insufficient.
- **Unmeasurable** — environment/tooling cannot support a defensible comparison.

## 9. Keep rule

Default behavior:

- Better → eligible to keep.
- Worse → restore.
- Negligible → restore.
- Inconclusive → restore unless the user explicitly chooses otherwise within a supported risk boundary.
- Unmeasurable → restore/default wins.

## 10. User agency

When two validated outcomes have real tradeoffs, present those tradeoffs in human terms and let the user choose.

The user chooses the outcome. They are not asked to adjudicate undocumented Windows primitives.

## 11. Receipt minimum

A receipt must retain enough to answer later:

- what was tested;
- why it was relevant;
- what machine/workload context applied;
- what changed;
- what baseline/treatment evidence existed;
- what uncertainty/noise existed;
- what Compy decided;
- what final state remained.
