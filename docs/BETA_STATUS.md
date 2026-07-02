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

- **`Compy-verified`** — validated for beta use.
- **`Beta-included`** — included in the current private-beta snapshot.
- **`Experimental`** — present in development but not validated.
- **`WIP`** — incomplete or unstable.
- **`Disabled`** — present but intentionally inactive (e.g. remote fetch, updater).
- **`Not beta-verified`** — available only at tester discretion.

## What's in `private-beta-001`

`Compy-verified` / `Beta-included` for this snapshot: hardware detection, Readiness, Monitoring,
Sessions, Export, Priorities, and the safe reversible recommendations (apply/rollback). Post-polish
installed-build smoke passed 2026-05-31.

`Disabled` in this snapshot: remote rules fetch, updater. `Gaming Mode (F1)` is **not built** (gated
behind its own design + QA). NVIDIA monitoring is implemented but **not yet hardware-validated**, so it
is `Experimental` on NVIDIA GPUs.

## On `main` but NOT in `private-beta-001` (candidate for a future `private-beta-002`)

Since the `16069fa` snapshot the picture **changed from the earlier note**: the old gamified premium UI
(Tune Level / Garage / theme-unlock) was **superseded and de-gamified**. Current `main` carries:
- the **honest command-center UI** (Experience Pass merged) — SystemPosture hero, design-system, curated
  themes, Guided advisory deep-links (scoped `ms-settings:` opener allowlist) — **no gamification**;
- a **hardened production CSP** (runtime-verified, `a9619ec`);
- **F1 Gaming Mode** — was built DARK; **now LIVE on `main`** (`gaming_mode_gate()` returns `true`, flipped
  2026-06-18 w/ owner sign-off; only the live reboot-while-active QA remains owner-pending). Service-suspend +
  debloat are also ARMED on `main`. See `docs/RELEASE_STATE.md`;
- zero clippy warnings; EULA Black-Book advisory clause.

None of this is in `private-beta-001`. **A `private-beta-002` cut from current `main` would showcase the
new command-center UI** (which the tester feedback template already targets) but must first pass its own
installed-build smoke (re-run §6/§7 of `PACKAGING_SIGNING_PLAN.md`). (NOTE 2026-06-27: Gaming Mode is now
LIVE on `main` — the "stays gated" line below reflected the pre-2026-06-18 state.)

**CHECKPOINT (owner) — closed beta:** (1) ship the frozen **beta-001** (known-good, older UI) **or** cut
**beta-002** from current `main` (new UI + CSP; needs a re-smoke I can run); (2) host / share the
installer; (3) invite your ~10–20 testers. The kit (`BETA_TESTER_README.md` + `archive/BETA_INVITE_MESSAGE.md`)
is ready for either.

## Tester Warning

Any feature **not** marked `Compy-verified` should be treated as experimental and used at the
tester's discretion. The canonical label for such features is:

> **Experimental / not Compy-verified. Use at your own discretion.**
