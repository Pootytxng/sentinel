# Product Rebirth Supersession Manifest

**Migration branch:** `hq/product-constitution-rebirth`<br>
**Ratified product authority:** `../PRODUCT_CONSTITUTION.md`

This file records which pre-rebirth sources may still contain useful history but no longer define current product direction.

## Authority after rebirth

- Product identity / UX / strategy → `docs/PRODUCT_CONSTITUTION.md`
- Safety / architecture → `docs/ARCHITECTURE_LOCKS.md`
- Current build / gate / release truth → `docs/RELEASE_STATE.md`
- Active ownership / claims → `docs/WORK_CONTROL.md`
- Derived execution sequence → `docs/product/ROADMAP.md`
- Execution status → `docs/BACKLOG.md`

No other document may silently claim supremacy across these domains.

## Global pre-rebirth default

**Ratification cutoff: 2026-09-04.** Any dated plan, spec, review, decision, handoff, council brief, or product-strategy artifact written before this cutoff has **zero product-direction authority by default**, even when its historical body says `ACTIVE`, `IN BUILD`, `GREEN-LIT`, `owner-approved`, `owner GO`, `source of truth`, `canonical`, `priority override`, `begin implementing`, or equivalent.

That default is deliberately asymmetric:

- old product identity, feature priority, roadmap order, launch sequencing, monetization decrees, UI/product direction, and execution-order language are historical unless explicitly re-ratified by current product authority;
- conforming technical, safety, architecture, implementation, benchmark, test, or decision provenance may still be useful inside its bounded domain;
- technical provenance never promotes the surrounding historical product direction back into force;
- before executing a legacy technical statement, re-check it against `docs/ARCHITECTURE_LOCKS.md`, `docs/RELEASE_STATE.md`, and `docs/WORK_CONTROL.md` as applicable;
- only `docs/PRODUCT_CONSTITUTION.md` plus its current derived roadmap can re-ratify old product direction.

A top-of-file retirement/supersession notice is preferred on mixed documents whose historical status language looks executable. The absence of such a notice **never** restores authority: this manifest and the Constitution still govern. High-signal mixed documents are also individually classified below so the drift guard can make that classification non-vacuous and fail on newly discovered unclassified authority-like prose.

## Explicitly superseded product-direction sources

The following are **historical evidence only** unless a bounded factual statement is revalidated and incorporated into current authority:

| Pre-rebirth source | Former role | Rebirth disposition |
|---|---|---|
| `docs/RECEIPTS_DOCTRINE.md` | canonical product/money doctrine | superseded by `PRODUCT_CONSTITUTION.md` + `product/MONETIZATION.md` |
| `docs/PRODUCT_DIRECTION.md` | product scope/anti-goals | superseded by Constitution + derived product docs |
| `docs/PRD.md` | historical product requirements | historical baseline only |
| `docs/MONETIZATION.md` | monetization decision doc | superseded by `product/MONETIZATION.md` |
| `docs/MONETIZATION_PLAN.md` | money build sequence | superseded by `product/ROADMAP.md` + `product/MONETIZATION.md` |
| `docs/PRICING_RESEARCH.md` | historical competitor pricing research | reference evidence only; no price authority |
| `COMPY_OVERVIEW.md` | point-in-time overview | snapshot only; not direction authority |
| `docs/archive/Roadmap.md` and archived roadmaps | previous execution plans | archive only |
| `docs/superpowers/specs/*` product strategy specs predating rebirth | design/strategy decisions | historical unless explicitly re-ratified |
| historical council/monetization proposals | advisory reasoning | historical only |
| issues/comments encoding old product hierarchy | execution history | not constitutional authority |

## Current-looking mixed sources explicitly bounded by this migration

These files retain useful technical or decision provenance, but their original status language can look executable. Existing top-of-file supersession notices are mandatory where already installed; removing one is an authority regression. Files listed here without an inline notice are nevertheless centrally bounded by the global pre-rebirth default above and may not route current product work.

| Source | Retained value | Superseded authority |
|---|---|---|
| `docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md` | bounded implementation/evidence design | `IN BUILD` and priority/execution direction |
| `docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` | owner reasoning and historical requirements | “begin implementing” and backlog priority override |
| `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md` | acceptance and safety provenance | product sequencing, BACKLOG priority, and Receipts Doctrine product-law routing |
| `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md` | capability, consent, rollback, injection, and origin-control provenance | Care-primary / optimization-secondary product hierarchy and implementation-ready product direction |
| `docs/decisions/2026-08-18-outbound-capability-expansion.md` | decision history | `ACTIVE` and Tier 2 default-ON policy, reversed by owner ruling #207 and current `ARCHITECTURE_LOCKS.md` |

### Semantic authority-audit corpus

The final migration audit also found the following pre-rebirth documents carrying status/source-of-truth/owner-GO/build-order language that could be misread as current direction. Their historical bodies are preserved; current product routing is retired by this manifest unless explicitly re-ratified under the Constitution.

- `docs/superpowers/specs/2026-06-01-experience-design-system-pass-design.md`
- `docs/superpowers/specs/2026-06-05-knowledge-layer-chapter.md`
- `docs/superpowers/specs/2026-06-08-tuning-guides-stability-measurement.md`
- `docs/superpowers/specs/2026-06-12-doctrine-voice-baptism-design-refresh.md`
- `docs/superpowers/specs/2026-06-12-monetization-transformation-plan.md`
- `docs/superpowers/specs/2026-06-12-R5-unattended-marathon.md`
- `docs/superpowers/specs/2026-06-12-receipts-marathon-R3.md`
- `docs/superpowers/specs/2026-06-12-waitlist-wiring.md`
- `docs/superpowers/specs/2026-06-15-monetization-model-proposal.md`
- `docs/superpowers/specs/2026-07-02-external-audit-2-council.md`
- `docs/superpowers/specs/2026-07-02-full-tidy-directive.md`
- `docs/superpowers/specs/2026-07-05-lab-bento-checkup.md`
- `docs/superpowers/specs/2026-07-05-lab-linear-guided-bench.md`
- `docs/superpowers/specs/2026-07-05-ui-deslop-organic-directive.md`
- `docs/superpowers/specs/2026-07-06-firstcheck-monitor-mvp-train.md`
- `docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md`
- `docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md`
- `docs/superpowers/plans/2026-08-20-comprehensibility-sweep.md`
- `docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`

This list is not permission for a small allowlist to replace semantic checking. `src/product-constitution-guard.test.ts` must keep a positive control and must fail when it finds a new pre-rebirth current-looking directive that has neither an explicit top-level constitutional boundary nor an explicit classification in this manifest.

## Specifically retired theses

The following ideas must not re-enter active product direction through stale documents:

- “Compy Care is primary; optimization is secondary.”
- “Optimization is the primary product; Care is secondary.”
- a universal static preset is the product goal;
- tweak count is a proxy for product value;
- process count is a performance objective by itself;
- average FPS alone defines optimization success;
- the user should choose low-level Windows mechanisms before Compy can help;
- a subscription is the required consumer business model;
- any fixed historical price band is already ratified current truth;
- null results are product failures;
- more settings exposed means a more advanced/better product.

## Preserved legacy assets

Rebirth does **not** discard good engineering merely because it predates the Constitution.

Preserve when still correct:

- rollback-first architecture;
- exact prior-state capture;
- one mutation boundary;
- signed/fail-closed remote rules;
- anti-cheat / no-injection boundaries;
- explicit outbound consent tiers;
- measurement honesty;
- Black Box evidence-vs-causation discipline;
- release/build provenance;
- Work Control ownership proof;
- existing tests/guards that protect real behavior;
- useful product implementation already aligned with the new journeys.

## Migration acceptance

The constitutional migration is not complete until:

1. all auto-loaded agent entrypoints route product decisions through the Constitution;
2. active docs no longer call a legacy product-direction source canonical;
3. `ARCHITECTURE_LOCKS.md` retains safety law but no longer establishes an obsolete product hierarchy;
4. `BACKLOG.md` is execution-only and points to the reborn roadmap;
5. a mechanical drift guard rejects known legacy-authority regressions;
6. a repo-wide audit classifies remaining references as active, historical, or bounded evidence;
7. an independent review compares the installed Constitution against the owner-ratified discussion and finds no material omission or reinterpretation.

## Amendment rule

Adding an old idea back into the current product is not “restoring context.” It is a constitutional amendment and must follow the Constitution's change process.
