# Machine Model

**Derived from:** `../PRODUCT_CONSTITUTION.md`

The Machine Model is the shared local brain consumed by both flagship journeys. It prevents Performance and Care from becoming separate products with duplicate, contradictory state.

## 1. Core principle

Compy should know enough about the machine to answer:

- what hardware/software state exists now;
- what Compy changed;
- what changed externally where safely detectable;
- what happened during relevant sessions/incidents;
- what evidence remains valid;
- what candidate interventions are applicable;
- what can be restored with confidence.

## 2. Domains

The model may include, when available and defensible:

- CPU/GPU/memory/storage/display identity and topology;
- motherboard/firmware facts where safely readable;
- Windows edition/build and relevant feature state;
- drivers and version chronology;
- power/configuration state;
- startup/background activity relevant to performance;
- active Compy-applied changes and exact rollback records;
- game/workload identity;
- session metrics and benchmark baselines;
- thermal/power observations;
- crash/freeze/hang incidents;
- known-good state markers;
- relevant external configuration drift;
- evidence provenance and timestamps.

## 3. Evidence classes

Every field should be classifiable as one of:

- directly observed now;
- recorded historically by Compy;
- derived from measured evidence;
- inferred with bounded confidence;
- user-declared;
- unavailable/unknown.

User-declared facts remain distinguishable from machine-observed facts.

## 4. Freshness

Facts carry freshness semantics. A driver version from last month is not “current” until re-read. A benchmark baseline tied to a previous game patch may be stale. A hardware identity can be more durable than a transient process list.

Consumers of the model must be able to ask whether evidence is still comparable.

## 5. Known-good state

Compy should be able to identify one or more useful known-good boundaries:

- before a Compy Trial;
- before a risky advanced action;
- before a material configuration change;
- before a reported performance regression, when sufficient history exists.

Known-good is evidence-backed, not assumed.

## 6. Change chronology

The model should support a timeline of materially relevant changes. This powers the first-class question:

> What changed since it worked?

Timeline entries may include Compy changes, driver/Windows updates, detected startup/config changes, hardware changes, incidents, and benchmark shifts.

Chronology never implies causation by itself.

## 7. Privacy/locality

The model is local by default. Any outbound derivative must cross the explicit consent/capability boundaries in Architecture Locks and must never silently upload the full machine model.

## 8. Single-owner facts

Each material fact should have one canonical producer/owner in code. UI surfaces consume the model rather than re-deriving competing versions of the same truth.

## 9. Anti-goals

Do not turn the Machine Model into:

- an unbounded telemetry lake;
- a duplicate of Windows inventory for its own sake;
- a place to store guessed specs;
- a reason to keep stale evidence forever;
- a generic key/value dump without provenance.
