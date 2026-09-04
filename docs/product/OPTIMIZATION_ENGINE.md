# Optimization Engine

**Derived from:** `../PRODUCT_CONSTITUTION.md`

Compy is not a preset launcher. The Optimization Engine is a constrained search system that translates a user outcome into technically relevant, measurable, reversible experiments on that specific PC.

## 1. Inputs

The engine may use only evidence available through the Machine Model and explicitly supported capability surfaces.

Primary inputs:

- user objective;
- user risk tolerance;
- hardware/topology;
- Windows/build/driver state;
- display target;
- selected game/workload;
- current bottleneck evidence;
- current configuration;
- known Compy-applied state/history;
- benchmark baseline quality;
- thermals/power where available;
- known compatibility/anti-cheat constraints;
- previous Trial results on the same machine/workload.

Missing evidence must remain missing. It is never filled with a guessed value.

## 2. Objectives

Initial objective set:

- `recommended`: maximize overall validated experience while minimizing unnecessary cost/risk;
- `max_fps`: maximize average/low-frame performance subject to stability/safety constraints;
- `smoothness`: minimize damaging frame-time variance/stutter subject to acceptable FPS;
- later: `latency`, `visual_target`, `streaming_balance`, `quiet`, `battery` only when measurement and control fidelity justify them.

A user who does not know what to choose defaults to `recommended`.

## 3. Candidate pipeline

Every candidate passes through:

1. **Applicability filter** — does it apply to this hardware/software/workload?
2. **Already-correct filter** — is the machine already in the candidate's target state?
3. **Safety/capability filter** — is Compy authorized and technically able to execute it safely?
4. **Mechanism relevance** — is there a credible path from the change to the user's objective?
5. **Measurement feasibility** — can any likely effect be distinguished from noise?
6. **Interaction classification** — what other candidates materially confound it?
7. **Expected-value rank** — expected benefit vs risk, time, complexity, and uncertainty.

Candidates failing 1–5 are not shown as “missed optimizations.” They are simply not worth testing unless the user explicitly inspects technical detail.

## 4. Search strategy

Do not brute-force combinations.

Preferred sequence:

- eliminate irrelevant candidates;
- cluster independent low-risk candidates where attribution is not required;
- isolate interacting/high-impact candidates;
- test highest expected-value candidates first;
- carry forward provisional wins only when doing so does not corrupt attribution;
- stop when remaining candidates are unlikely to beat measurement noise or expected user value.

The engine should eventually support adaptive search, but every optimization shortcut must remain auditable.

## 5. Multi-objective result selection

Compy should preserve the useful Pareto frontier: configurations where one meaningful metric cannot improve further without degrading another meaningful metric.

The consumer result should not expose Pareto mathematics. It should expose understandable alternatives such as:

- Safe;
- Recommended;
- Push.

The engine stores exact metric/tradeoff evidence behind those labels.

## 6. Default preference ordering

When two configurations are indistinguishable within noise, prefer in order:

1. Windows/hardware default or current known-good state;
2. fewer modifications;
3. lower privilege/risk;
4. lower thermal/power cost;
5. broader compatibility;
6. stronger rollback certainty;
7. simpler explanation/support burden.

This is the **default wins ties** rule.

## 7. Stop conditions

Stop a search when:

- objective is already satisfied;
- remaining candidate effects are below measurable noise;
- benchmark repeatability is insufficient;
- user ends the experiment;
- thermal/stability/safety limit is crossed;
- a required rollback or evidence boundary fails;
- evidence becomes confounded enough that attribution would be dishonest.

Stopping early is success when additional testing has poor expected value.

## 8. Confidence vocabulary

Engine outputs distinguish:

- known state;
- measured effect;
- supported inference;
- expected mechanism;
- unknown.

Never convert these to fake precision percentages merely for UI appeal.

## 9. Workload specificity

A configuration may be optimal for one workload and irrelevant or harmful for another.

Receipts must retain workload context. The engine must not silently promote a game-specific result into a universal machine claim.

## 10. Prior evidence

Historical Compy Trial results may reduce future search cost when the relevant machine/workload state is still comparable.

A material change such as driver update, Windows update, hardware change, major game update, display target change, or relevant configuration drift may invalidate old baselines.

The engine should prefer revalidation over pretending stale proof still applies.

## 11. Advanced candidate boundary

Advanced/Experimental candidates require the Risk Model and stronger stability validation. They never enter the default candidate pool merely because they can produce larger benchmark deltas.

## 12. Anti-goals

The engine must not:

- optimize tweak count;
- reward process-count reduction by itself;
- treat average FPS as the sole objective;
- treat one reviewer's benchmark as universal evidence;
- hide tradeoffs;
- keep a change merely because it was recommended before testing;
- automatically widen into unsupported low-level hardware control.
