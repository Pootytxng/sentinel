# Compy Product Constitution

**Status:** SUPREME PRODUCT AUTHORITY  
**Ratified by owner:** 2026-09-04  
**Scope:** product identity, user promise, product behavior, UX doctrine, capability priority, positioning, development direction, and product decision-making.

This document supersedes every prior statement of Compy's product identity or strategic direction, including the Receipts Doctrine, historical PRDs, Product Direction documents, monetization councils, historical roadmaps, strategy specs, feature-ranking decisions, and any statement that defines Compy Care or optimization as subordinate to the other.

Historical documents remain evidence of how Compy arrived here. They are not authority for where Compy goes next.

This Constitution does **not** override `ARCHITECTURE_LOCKS.md` on safety/security/immutability, `RELEASE_STATE.md` on current implementation truth, or `WORK_CONTROL.md` on execution ownership.

If a derived roadmap, issue, spec, implementation plan, marketing document, agent instruction, or old decision conflicts with this Constitution on product direction, **this Constitution wins**.

---

## 1. What Compy is

Compy is a guided PC performance, optimization, health, diagnosis, recovery, experimentation, and education system for Windows users.

It is not an optimizer with diagnostics bolted on.

It is not a diagnostic application with optimization bolted on.

It is one coherent system whose purpose is to help a person get the best reasonable experience their particular PC can deliver, understand the limits and tradeoffs of that machine, safely experiment beyond Compy's recommendation when they choose, and recover intelligently when something goes wrong.

Compy's two flagship journeys are equal expressions of the same system:

**MAKE THIS PC BETTER.**

and

**FIGURE OUT WHAT WENT WRONG.**

Both use the same machine model, evidence, history, safety system, experiments, measurements, rollback contracts, and explanations.

## 2. The core promise

> **The user chooses the destination. Compy handles the technical route, proves the result, explains the tradeoffs, and never hides the way back.**

And:

> **Compy optimizes outcomes, not settings.**

A user should not need to know what processor affinity, CPU Sets, thread scheduling, power policy, process priority, NUMA topology, registry values, services, timer behavior, driver settings, or similar mechanisms mean before Compy can help them.

Those are implementation mechanisms.

Compy's interface begins with human outcomes.

## 3. What the user is expected to know

Compy must never require a normal user to answer a technical question that the product itself can answer more reliably.

The user may reasonably know things such as:

- I want the highest FPS possible.
- I care most about low latency.
- I care about smoothness and stutter.
- I want the best visual quality while staying above a chosen FPS.
- I want the best overall balance.
- Something is crashing.
- Something feels slower.
- Something changed.
- I want to know whether an upgrade would actually help.
- I want to push harder and accept more risk.

The user is **not** expected to know which Windows primitive should accomplish that outcome.

Compy owns that translation.

## 4. The default destination

A person who does not know what objective to choose must not be forced to choose one.

The default is:

**RECOMMENDED / BEST OVERALL EXPERIENCE**

Compy should infer a sensible balanced target from the user's hardware, display, workload, and measured behavior, then explain what it selected.

Advanced outcome choices may include:

- **Maximum FPS**
- **Lowest practical latency**
- **Smoothest frame pacing**
- **Best visual quality above an FPS floor**
- **Balanced / Recommended**
- **Gaming + streaming / multitasking**
- **Quiet / thermally conservative**, where relevant

The outcome is user-facing.

The technical configuration is Compy-facing.

## 5. Optimization is multi-objective

Compy must not reduce gaming performance to one number.

Average FPS alone is insufficient.

Where technically defensible, optimization may consider:

- average FPS;
- 1% lows;
- 0.1% lows when sample quality supports them;
- frame-time distribution and variance;
- visible stutter;
- input-latency measurements or defensible proxies;
- CPU/GPU bottleneck state;
- utilization;
- thermal behavior;
- power behavior;
- stability;
- visual-quality constraints;
- background contention;
- battery/noise constraints when relevant.

Compy searches for configurations that improve the requested outcome while minimizing unnecessary sacrifice elsewhere.

When multiple configurations represent meaningful tradeoffs, Compy should expose the useful frontier rather than pretending one configuration is universally "best."

The user chooses between understandable outcomes, not obscure settings.

## 6. The result should look like a decision

When testing produces several worthwhile configurations, Compy may present outcomes analogous to:

**SAFE** — nearly all validated benefit with the smallest risk or system deviation.

**RECOMMENDED** — Compy's preferred balance of measured benefit, stability, compatibility, thermals, power, reversibility, and complexity.

**PUSH** — additional validated or plausible benefit with materially greater cost or uncertainty.

Names may evolve with design testing. The principle does not.

Compy must explain the actual trade.

Example:

> Recommended gains nearly all measured performance. Push gains only 1 additional FPS but increases CPU temperature by 8°C.

That is meaningful user agency.

A warning icon beside an unexplained technical setting is not.

## 7. The Trial is a first-class product primitive

The fundamental unit of optimization is not a tweak.

It is a **Trial**.

A mature Trial should be able to describe:

- **Purpose** — what user outcome this may affect.
- **Eligibility** — when it applies.
- **Mechanism** — what Compy would actually change.
- **Current state** — what this PC currently uses.
- **Risk classification** — what could reasonably go wrong.
- **Rollback contract** — how the exact prior state is restored.
- **Measurement strategy** — what evidence can distinguish benefit from noise.
- **Dependencies/interactions** — what other changes affect interpretation.
- **Result** — better, worse, negligible, inconclusive, or unmeasurable.
- **Decision** — keep, restore, defer, retest, or let the user choose.

This structure should eventually underpin optimization, advanced tuning, troubleshooting experiments, and many Care interventions.

## 8. Compy searches intelligently; it does not brute-force the machine

The number of possible PC configurations is too large for exhaustive testing.

Compy must reduce the candidate space before experimentation.

Candidates should be filtered or ranked by facts such as hardware architecture, Windows version, drivers, game/workload, bottleneck evidence, current state, security state, known incompatibilities, rollback capability, previous results, thermal constraints, interaction groups, expected mechanism, and measurement feasibility.

Irrelevant candidates disappear.

Already-correct settings disappear.

Changes whose plausible effect is smaller than the system's measurable noise should usually disappear.

High-confidence, low-risk candidates should be tested before low-confidence or high-cost candidates.

Strongly interacting settings should not be attributed independently without evidence that permits it.

Compy should optimize the **search process**, not merely accumulate changes.

## 9. No measurable benefit means the default wins

Compy does not need every optimization to succeed.

That is a feature.

If a candidate cannot beat normal run-to-run variation with sufficient evidence, Compy should say so and restore the prior state unless another explicit reason justifies keeping it.

> **No measurable change. Original setting restored.**

is a successful Compy outcome.

The objective is:

> **the smallest validated configuration that best satisfies the user's goal.**

Not:

> the largest tweak count.

## 10. Benchmarking is a guided consumer experience

Compy must never assume ordinary users know how to benchmark correctly.

Compy should guide repeatable comparison where possible: same game or workload; similar scene or route; stable graphics settings; adequate duration/sample count; repeated baseline where needed; noise estimation; consistent capture method; detection of invalid comparisons.

The UI should teach only what is needed at that moment.

Example:

> Play the same training area for about 90 seconds. Compy will tell you when it has enough data.

The user should not need to become a benchmarking expert before getting trustworthy evidence.

## 11. Compy challenges universal optimizer mythology

Compy does not accept the premise that a configuration proven on one reviewer's PC is automatically optimal on another person's PC.

Optimization results may vary because of hardware topology, drivers, Windows build, thermal conditions, existing configuration, bottlenecks, game engine, resolution, refresh rate, background software, and other system facts.

Compy's answer to "which optimizer is best?" should ultimately be:

> **The best configuration is the one that survives measurement on your machine.**

Compy should be able to incorporate sound ideas found across the performance-tool ecosystem without inheriting another product's assumptions or interface.

## 12. Absorb jobs, not competitor interfaces

Compy may learn from capabilities demonstrated by tools such as Process Lasso, Hone, Hypertune, WhoCrashed, HWiNFO, PresentMon/CapFrameX, Windows/OEM utilities, and future competitors.

It should not recreate their menus merely because those menus exist.

For every candidate feature, ask:

> What user decision does this capability improve?

A low-level primitive is valuable only if Compy can translate it into an understandable decision, experiment, diagnostic, or expert surface.

Compy's advantage should be **orchestration, comprehension, and evidence**, not feature-checkbox parity.

## 13. Simple outside, deep inside

Compy's backend is allowed to become sophisticated.

Its consumer experience is not allowed to become needlessly complicated.

Every important conclusion should support progressive disclosure:

**Answer**

> Leave this setting alone.

**Explanation**

> Your current configuration is already appropriate for this CPU and workload.

**Technical receipt**

Exact state, mechanism, API/setting, evidence, methodology, measurement, and provenance.

The casual user should not be forced through expert depth.

The expert user must not be prevented from reaching it.

One truth, several depths.

Not several contradictory products.

## 14. Contextual education

Compy is allowed to teach users.

It should not become a textbook.

Education happens when knowledge helps the user understand a real decision or result on their own machine.

After an experiment, Compy might explain:

> Average FPS barely changed, but your 1% lows improved. That means the game became more consistent rather than much faster overall.

Or:

> Your GPU was already saturated. A CPU scheduling change had little room to improve this workload.

Knowledge attached to personal evidence is more useful than encyclopedic terminology.

## 15. Notifications must earn interruption

Compy interrupts the user when there is a meaningful decision or material state change.

Useful:

> Your game crashed twice after a GPU-driver change. Compy cannot prove causation yet, but the timing is worth investigating.

Not useful:

> Three recommendations available.

Alerts are not engagement mechanics.

They are decision support.

## 16. The machine model is the shared brain

Compy should evolve toward a coherent local model of the user's PC including relevant hardware, topology, Windows state, drivers, display, active configuration, Compy changes, recent external changes, known-good baselines, session history, workload behavior, incidents, stability, thermals, bottlenecks, and evidence confidence.

Care and Performance consume the same model.

The user should not have to repeatedly re-explain their PC to different parts of Compy.

## 17. "What changed?" is first-class

When something becomes worse, one of the most important questions is:

> What changed since it worked?

Compy should increasingly be able to correlate relevant recent changes without falsely claiming causation.

Examples may include driver updates, Windows updates, Compy-applied settings, externally observed configuration drift, startup software, meaningful process changes, power changes, hardware changes, incident timing, and benchmark regressions.

Compy may say:

> These changed before the problem appeared.

It must not silently upgrade that into:

> This caused the problem.

## 18. Care is the reverse path through the same system

Performance:

> known-good → candidate → experiment → improved configuration.

Care:

> problematic state → evidence/history → investigation → corrected or known-good configuration.

The same ledger and machine history that make optimization safe should make later diagnosis more intelligent.

This is why Care and Performance must not fork into separate architectures.

## 19. Debloating is evidence-based, never process-count theater

A lower process count is not itself proof of improved gaming performance.

Compy should not optimize toward arbitrary numbers such as "only 70 processes."

Instead it should identify actual contention, unnecessary startup behavior, relevant background consumption, or user-requested privacy/cleanup goals.

A component that consumes no meaningful resource and produces no relevant conflict does not become a performance problem because another optimizer disables it.

## 20. Advanced tuning preserves agency without outsourcing responsibility

Compy may eventually support carefully bounded advanced optimization such as supported overclocking, undervolting, or advanced scheduling/configuration where technical and safety requirements are satisfied.

Users retain agency.

But:

> user freedom does not obligate Compy to automate every operation a user could perform manually.

Compy may classify capability levels such as:

- **Safe** — tested, bounded, reversible.
- **Advanced** — meaningful tradeoffs, still supportable and reversible.
- **Experimental** — greater uncertainty or stability risk; explicit acknowledgement and stronger validation.
- **Unsupported** — explainable or externally researchable, but not automated by Compy.

## 21. Warnings do not substitute for engineering

A disclaimer or checkbox is not the primary safety mechanism.

Where Compy automates risky actions, protection should primarily come from bounded capability, eligibility checks, rollback, prior-state capture, conservative limits, compatibility checks, validation, stability testing, clear risk classification, auditable execution, and recovery paths.

Warnings supplement those controls.

They do not replace them.

## 22. Compy may recommend against performance extremism

If measured evidence shows that chasing a larger number harms the user's actual experience, Compy should say so.

Example:

> You already average over 400 FPS, but frame-time spikes are the larger problem. Compy recommends optimizing consistency rather than another few average FPS.

The user may choose differently where the capability remains supportable.

Compy advises strongly without pretending ownership of the machine.

## 23. Hardware upgrade advice is system-level

Compy must not recommend a component upgrade in isolation when compatibility or system balance materially affects the decision.

A serious upgrade assessment may need to consider measured bottleneck, target games/workloads, display resolution and refresh rate, CPU pairing, power-supply capacity/connectors, motherboard compatibility, physical clearance where knowable, thermals, expected workload benefit, cheaper non-hardware remedies, and whether an upgrade is needed at all.

**No upgrade recommended** is a valid and valuable result.

Retail economics or affiliate compensation must never determine the technical recommendation.

## 24. The 3D rig should communicate reasoning

Compy's visual hardware model is not decoration.

It should increasingly explain what the product is reasoning about.

If GPU limitation is relevant, the GPU should become the visual focus.

If memory configuration matters, memory should become the focus.

If the evidence points away from hardware, the interface should be able to communicate that.

The visual system exists to make complicated PC reasoning easier to comprehend.

## 25. Outcome confidence must be explicit

Compy should distinguish:

- **Known state** — deterministic observation.
- **Measured result** — observed experiment/session result.
- **Supported inference** — evidence points toward an interpretation but does not prove causation.
- **Expected mechanism** — engineering reasoning, not measured outcome.
- **Unknown** — Compy lacks sufficient evidence.

Confidence must never be fabricated into an arbitrary percentage merely because a percentage looks precise.

## 26. Null, uncertainty, and refusal are valid outputs

Compy must be comfortable saying:

> We don't know yet.

> No measurable improvement.

> This cannot be tested reliably on this machine.

> Compy cannot safely restore this because it did not record the original state.

> This operation is outside Compy's supported automation boundary.

A product that never says no cannot credibly claim to know when yes is justified.

## 27. Product navigation follows user intent, not internal architecture

A user should not need to know which "room" contains the solution before Compy can help.

Rooms and instruments may remain part of the visual language, but routing should increasingly understand intent and context.

A person saying:

> Something is stuttering.

should be routed through the relevant evidence and experiment path.

Not instructed to manually hunt through unrelated tools.

## 28. Product features earn existence through flagship journeys

Every significant feature must strengthen at least one of:

**MAKE THIS PC BETTER**

or

**FIGURE OUT WHAT WENT WRONG**

Prefer features that strengthen both.

A feature that merely makes Compy look more comprehensive does not automatically deserve development time.

## 29. Measurement is a competitive weapon, not a reason to become timid

Compy must never fabricate performance claims.

But measured wins should be presented clearly and confidently.

Measured losses and null results are equally valuable evidence.

Compy's marketing advantage comes partly from being willing to publish results competitors have an incentive to hide.

## 30. Blackbook and public methodology are part of the product

Compy's optimization knowledge should not remain hidden entirely inside the executable.

High-quality explanations, methodology, null results, debunking, compatibility guidance, and measured case studies can become education, acquisition, search content, trust evidence, and eventually a knowledge moat.

Compy should compete on the quality of reasoning behind recommendations, not secrecy about the recommendation list.

## 31. The long-term moat is accumulated trustworthy evidence

Individual features can be copied.

A growing corpus of methodologically comparable, consented evidence connecting:

> hardware + software state + workload + intervention + measurement + outcome

can become much harder to reproduce.

Any aggregated intelligence derived from users must preserve the privacy, consent, security, and outbound boundaries defined elsewhere.

Evidence quality outranks sample-count theater.

## 32. Monetization follows durable value

Product direction must not be warped merely to justify a predetermined subscription.

Compy may monetize convenience, depth, history, advanced experimentation, multi-rig capability, advanced reports, richer intelligence, and other demonstrated recurring or durable value.

Safety fundamentals and the ability to undo Compy's own changes must not become hostage features.

Exact price and payment structure remain evidence-driven business decisions until real willingness-to-pay data exists.

No historical pricing decree outranks this rule.

## 33. Compy does not optimize for engagement

The goal is not time-in-app.

A successful session may end with:

> Your machine is already configured well. Nothing worth changing.

That is success.

Trust is more valuable than unnecessary interaction.

## 34. Legal and ethical integrity align with product quality

Compy should avoid scareware behavior not merely because it is distasteful but because it destroys technical credibility.

No inflated issue counts.

No invented danger.

No artificial urgency.

No "your PC is broken" framing merely because optional checks differ from Compy's preference.

No dark patterns around Pro, telemetry, affiliate links, or advanced risk.

## 35. Product success condition

Compy succeeds when a normal user can truthfully say:

> I told Compy what I wanted.
>
> It understood my PC.
>
> It tested what actually mattered.
>
> It explained what changed.
>
> It kept what helped.
>
> It put back what didn't.
>
> When something later went wrong, it helped me understand why.

That experience is the north star.

---

## Constitutional anti-goals

Compy must not become:

- a giant exposed registry editor;
- a Process Lasso clone with friendlier colors;
- a tweak-count competition;
- a fake one-click universal preset;
- a generic system cleaner;
- a driver-updater scareware product;
- an overclocking application whose primary value is exposing unsafe controls;
- a hardware monitor competing on raw sensor count;
- a benchmark application that requires expert methodology knowledge;
- a support product disconnected from optimization history;
- an optimizer disconnected from recovery;
- an AI that autonomously invents Windows modifications;
- a collection of competitor features without a coherent user journey.

---

## Authority map

Four domains of truth coexist and must not be collapsed into one:

1. **Product truth — `docs/PRODUCT_CONSTITUTION.md`**
   - what Compy is;
   - what user outcomes it serves;
   - UX/product doctrine;
   - product strategy and anti-goals.

2. **Safety/architecture truth — `docs/ARCHITECTURE_LOCKS.md`**
   - mutation and rollback boundaries;
   - privilege/security rules;
   - immutable formats and operating constraints;
   - network/capability boundaries.

3. **Current implementation/release truth — `docs/RELEASE_STATE.md`**
   - what is built;
   - what is armed;
   - what is installed;
   - what is verified or blocked.

4. **Execution ownership truth — `docs/WORK_CONTROL.md`**
   - who may write;
   - current claims/scopes;
   - proof-bound transitions.

No derived document may declare itself supreme across these four domains.

## Constitutional change process

This Constitution is deliberately hard to change by accident.

A material change requires:

1. an explicit owner decision;
2. a written reason and expected product effect;
3. review for conflict with `ARCHITECTURE_LOCKS.md`;
4. reconciliation of affected roadmap/UX/monetization/validation documents;
5. passage of the product-constitution drift guard once that guard exists.

Historical discussion may inform an amendment, but may never silently amend this document.
