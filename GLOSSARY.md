# Compy

Compy is a PC paramedic for gamers: when a PC or a game stops running the way it did, it says what changed, what is most likely wrong, and fixes it or gives the exact fix, then checks that it worked.

## Language

### Product

**Compy**:
The product. The repository, crate and history from before 2026-06-04 still say `sentinel`.
_Avoid_: Sentinel (except in history and legacy-data migration)

**Owner**:
The one person who decides product direction, locks, spending, publishing and signing.
_Avoid_: user (the owner is not Compy's end user), maintainer

**User**:
The gamer running Compy on their own PC.
_Avoid_: customer, tester (unless it really is a tester build)

### The three layers

**Layer**:
One of Compy's three capability tiers, built and shipped in order: the Paramedic, Game knowledge, the Tuning Bay.

**Paramedic**:
Layer 1 and Compy's headline: the one flow that goes from "something is wrong" to "did the fix work".
_Avoid_: optimizer, one-click boost

**Game knowledge**:
Layer 2: the known issues of the game being played that apply to this user's hardware and driver.
_Avoid_: game profiles, presets

**Tuning Bay**:
Layer 3: a separate, opt-in space for tinkerers, with low-risk toggles and BIOS and overclock walkthroughs. Compy guides firmware steps; it never changes firmware.
_Avoid_: Lab, advanced mode

**Trial**:
A measured test of one setting against a repeatable workload. Trials belong to the Tuning Bay, not the Paramedic.
_Avoid_: benchmark, experiment

### Diagnosis

**What changed**:
The difference between the PC now and the last time it ran well (a driver or Windows update, a game patch, a memory profile, overlays, background load).
_Avoid_: root cause

**Most likely cause**:
Compy's best-supported explanation for a problem, stated with how sure it is. Compy never says a change "caused" a problem.
_Avoid_: the cause, culprit

**Evidence**:
What Compy observed that supports a finding, shown to the user next to it.

**Nothing is wrong**:
The verdict when it is established that the PC is fine. It is never the default.
_Avoid_: all good, healthy (when not established)

**I can't tell**:
The verdict when Compy lacks the evidence to decide. Unavailable data stays unknown, never guessed.
_Avoid_: probably fine

### Changes and rollback

**Action**:
One reversible change Compy makes to Windows. Compy only applies an action it can roll back.
_Avoid_: tweak (when it is being applied), optimization, hack

**Tweak**:
A candidate change in Compy's catalog, before it is applied.

**Apply**:
Making an action happen: snapshot, change, verify, write a receipt.

**Snapshot**:
The prior state captured before an action, so it can be restored exactly.

**Receipt**:
The record of what an action changed and how to undo it.

**Rollback**:
Restoring the state a snapshot captured, resolved from the recorded history alone.
_Avoid_: undo (in technical text), revert

### Rooms

**Room**:
One top-level place in the app, reached from the rail: Health, Games, Problems, Live, History, Test. User-facing text always uses the room's name, never its internal id.
_Avoid_: tab, page, Home, Monitor, Blackbook, Lab

### Safety and data

**Lock**:
A standing safety, rollback, privilege, privacy or network rule. Crossing one needs the owner.
_Avoid_: guideline, preference

**Capability Exception Gate**:
The owner-controlled path through which a capability outside "local, user-mode, least-privilege" (such as a Compy driver) could ever be admitted. None is admitted today.

**Outbound tier**:
One of three separate kinds of data leaving the PC, never merged: Tier 1 signed advisory download (no machine data upload), Tier 2 scrubbed incident fingerprint (opt-in, default off), Tier 3 explicit per-case evidence upload.
_Avoid_: telemetry, analytics

**Incident fingerprint**:
The scrubbed Tier 2 summary of a problem, sent only when the user has opted in.

**Signed remote rules**:
Advisories Compy may download, accepted only if their signature checks. Off until three gates are armed.

**Gate**:
A switch or check that must pass before something can ship or run; "arming" one turns it on.

## Relationships

- The **Paramedic** turns **What changed** and **Evidence** into a **Most likely cause**, then offers an **Action** or exact steps, then checks the result.
- Every **Action** has one **Snapshot** before it and one **Receipt** after it, and can be **Rolled back**.
- A **Tweak** becomes an **Action** only when applied.
- **Trials** run only in the **Tuning Bay**.
