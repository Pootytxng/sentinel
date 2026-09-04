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

These files retain useful technical or decision provenance, but their original status language can
look executable. Their top-of-file supersession notices are mandatory; removing one is an authority
regression.

| Source | Retained value | Superseded authority |
|---|---|---|
| `docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md` | bounded implementation/evidence design | `IN BUILD` and priority/execution direction |
| `docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` | owner reasoning and historical requirements | “begin implementing” and backlog priority override |
| `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md` | acceptance and safety provenance | product sequencing, BACKLOG priority, and Receipts Doctrine product-law routing |
| `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md` | capability, consent, rollback, injection, and origin-control provenance | Care-primary / optimization-secondary product hierarchy and implementation-ready product direction |
| `docs/decisions/2026-08-18-outbound-capability-expansion.md` | decision history | `ACTIVE` and Tier 2 default-ON policy, reversed by owner ruling #207 and current `ARCHITECTURE_LOCKS.md` |

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
