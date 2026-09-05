# Care Engine

**Derived from:** `../PRODUCT_CONSTITUTION.md`

Care is not a separate product. It is the reverse traversal of the same machine model, history, evidence, Trial system, and rollback machinery used by Performance.

## 1. Core job

When something crashes, freezes, stutters, slows down, regresses, or simply feels wrong, Care should help answer:

1. What happened?
2. What changed around that time?
3. What does the evidence support?
4. What remains unknown?
5. What is the safest useful next test or recovery action?
6. Can Compy restore a known-good state?

## 2. Evidence hierarchy

Care distinguishes:

- directly observed incident/system facts;
- historical Compy state/history;
- measured before/after regressions;
- supported inference;
- external known-issue evidence;
- unknown/unavailable evidence.

External case intelligence must remain visibly attributed and separate from Compy's own inference.

## 3. “What changed?”

A first-class Care operation is comparing a problematic state against a known-good or earlier boundary.

Potentially relevant changes include:

- GPU/CPU/chipset/audio/storage drivers;
- Windows updates;
- Compy-applied configuration;
- external configuration drift safely detectable by Compy;
- startup/background software changes;
- game updates where known;
- hardware changes;
- display/settings changes;
- power-plan changes;
- prior crashes/hangs and performance regressions.

Chronology is evidence for investigation, not proof of cause.

## 4. One next action

Care should prefer one bounded next action over a list of ten speculative fixes.

That action may be:

- collect more evidence;
- restore a Compy-known prior state;
- run a controlled Trial;
- update/revert a known component through a supported path;
- isolate a background conflict;
- consult an external vendor/support source;
- do nothing yet because evidence is insufficient.

## 5. Recovery

Recovery actions must use the same rollback and risk rules as Performance. Care does not gain a weaker mutation boundary because the user is distressed.

## 6. Known-good restoration

Where Compy has a trustworthy prior-state boundary, Care may offer restoration with exact scope:

> Restore the settings Compy changed after this known-good point.

It must not imply that Compy can reconstruct unknown third-party changes it never recorded.

## 7. Incident presentation

The consumer surface should lead with:

- plain-English incident summary;
- time/context;
- what evidence lines up;
- what Compy cannot prove;
- one safe next action.

Raw IDs, modules, event details, stack metadata, or other expert evidence belong behind progressive disclosure.

## 8. Relationship to Performance

A Performance Trial that later causes instability becomes Care evidence.

A Care investigation that discovers a stable beneficial configuration becomes Performance knowledge.

The systems must share receipts and state rather than duplicate them.

## 9. Anti-goals

Care must not become:

- a BSOD-only viewer;
- an event-log dump;
- a causal-claim generator;
- a generic “repair everything” button;
- a support surface disconnected from the user's optimization history;
- a reason to weaken rollback or evidence standards.
