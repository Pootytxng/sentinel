# Risk Model

**Derived from:** `../PRODUCT_CONSTITUTION.md`<br>
**Constrained by:** `../ARCHITECTURE_LOCKS.md`

Risk is not a marketing badge. It determines what Compy may automate, what validation is required, what consent is needed, and when Compy must refuse.

## 1. Capability classes

### Safe

Requirements:

- bounded and well-understood mechanism;
- exact prior state readable;
- deterministic rollback path;
- compatibility conditions understood;
- failure modes low-severity and recoverable;
- validation can prove target/final state.

Compy may recommend, automate, test, and restore Safe actions within normal workflow.

### Advanced

Requirements:

- meaningful tradeoff or elevated complexity;
- still supportable and reversible;
- stronger explanation and verification;
- explicit user acknowledgement when the cost is not obvious.

Examples may eventually include deeper scheduling/power choices where mechanisms and rollback are well-bounded.

### Experimental

Requirements:

- materially greater uncertainty, stability risk, thermal/power cost, or hardware sensitivity;
- supported interface only;
- exact bounds;
- explicit consent;
- stronger stability validation;
- automatic abort/restore when limits fail.

Experimental never means “anything goes.”

### Unsupported

Compy may explain or point to research, but does not automate.

Reasons may include:

- no reliable rollback;
- insufficient prior-state visibility;
- destructive/irreversible operation;
- vulnerable-driver technique;
- unbounded kernel/physical-memory access;
- unsafe firmware operation;
- unsupported hardware control;
- inability to verify outcome;
- security policy disallowance.

## 2. Risk tolerance is user-facing; mechanisms are not

Users may choose a posture such as Conservative / Recommended / Aggressive or equivalent language validated by UX testing.

That choice controls which candidate classes Compy may consider. It does not expose raw undocumented controls by default.

## 3. Risk dimensions

A candidate may be graded across:

- reversibility certainty;
- stability risk;
- thermal cost;
- power cost;
- compatibility uncertainty;
- security impact;
- data-loss potential;
- measurement uncertainty;
- support/recovery complexity.

Do not collapse these into one arbitrary score when the trade matters.

## 4. Warnings

Warnings explain the remaining risk after engineering controls.

A checkbox does not authorize a capability prohibited by Architecture Locks.

## 5. Security boundary

Security/system policy changes remain owner-gated as defined by Architecture Locks and project control law. A future consumer “Push” mode does not override that boundary.

## 6. Hardware tuning

Overclocking/undervolting may be considered only through supported, bounded interfaces with:

- hardware eligibility;
- conservative default range;
- stability testing;
- thermal/power limits;
- stepwise change;
- rollback/recovery plan;
- clear distinction between Compy's recommended envelope and experimental envelope.

## 7. User liberty

Compy preserves the user's right to choose among supported outcomes and supported higher-risk configurations.

Compy is equally free to say:

> This operation is outside Compy's supported automation boundary.

That is product integrity, not paternalism.
