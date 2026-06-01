# Private Beta Status

Current locked beta: **`private-beta-001`**

This beta is a frozen snapshot represented by:

- **Branch:** `beta/private-beta-001`
- **Tag:** `private-beta-001` (annotated; pins commit `16069fa`)

**The beta tag is immutable — do not modify it after creation.** Future beta snapshots use a new
versioned tag (`private-beta-002`, …). The `main` branch continues normal development; work landed on
`main` after the snapshot is **not** part of `private-beta-001` unless a new beta tag is cut.

## Feature Status Labels

Features may be marked with one of the following statuses:

- **`Sentinel-verified`** — validated for beta use.
- **`Beta-included`** — included in the current private-beta snapshot.
- **`Experimental`** — present in development but not validated.
- **`WIP`** — incomplete or unstable.
- **`Disabled`** — present but intentionally inactive (e.g. remote fetch, updater).
- **`Not beta-verified`** — available only at tester discretion.

## What's in `private-beta-001`

`Sentinel-verified` / `Beta-included` for this snapshot: hardware detection, Readiness, Monitoring,
Sessions, Export, Priorities, and the safe reversible recommendations (apply/rollback). Post-polish
installed-build smoke passed 2026-05-31.

`Disabled` in this snapshot: remote rules fetch, updater. `Gaming Mode (F1)` is **not built** (gated
behind its own design + QA). NVIDIA monitoring is implemented but **not yet hardware-validated**, so it
is `Experimental` on NVIDIA GPUs.

## Tester Warning

Any feature **not** marked `Sentinel-verified` should be treated as experimental and used at the
tester's discretion. The canonical label for such features is:

> **Experimental / not Sentinel-verified. Use at your own discretion.**
