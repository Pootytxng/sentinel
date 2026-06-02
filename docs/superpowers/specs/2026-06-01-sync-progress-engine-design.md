# Sync — collaborative progress engine (design)

> **Status: PARKED + DARK.** Captured in the `benchmark` lane per the owner's go-ahead
> (2026-06-01) to "continue as discussed." Per `docs/PARALLEL_WORKTREE_OPS.md`, this lane is
> F6 (slotted *later*): the design may be built **in isolation** but stays **parked** (not merged
> to `main`) and **dark** (backend unregistered / flag-gated, no UI) until the owner says the plan
> reached its slot. **HQ must reconcile this with `experience-pass`** (which removed the Tune/Garage
> cosmetic gamification under Decision A) before any merge. This design is written to *complement*
> that decision, not reverse it. Working name "Sync" is a placeholder; final naming is the design
> lane's call.

## 1. Purpose

A read-only backend engine that computes an **honest, explainable standing** for how aligned a
user's system is with good practice **for the goals they care about** — crediting *both* changes
Sentinel guided and changes the user made themselves — and emits **rare level-crossing events** that
a separate (design-lane) cosmetic system can celebrate. The point: make Sentinel feel *alive* and
*shareable* without a fabricated arcade score, by rewarding real, earned progress.

It is the F6 "proof/benchmark layer" reframed around **collaboration + progress** rather than raw
performance.

## 2. Honesty stance (load-bearing)

- Every point traces to a **real, verifiable signal** — a Trust Ledger entry or a live system-state
  probe Sentinel already runs. No fabricated number used purely as a stat.
- Never presented as a performance claim ("improved your FPS by X%"). Consistent with
  `ARCHITECTURE_LOCKS.md §1.7`: this is a *configuration-alignment + engagement* measure, not a
  benchmarked gain.
- **Layered on `SystemPosture`** (the honest truth-teller): SystemPosture says *what is true*; Sync
  *celebrates crossing real thresholds* on top of it. This is the reconciliation with Decision A —
  Sync does not bring back opaque Tune-tier scoring; it credits real, inspectable achievements.

## 3. Score model — "you + Sentinel, together"

Two credit sources, surfaced as a visible split (the emotional hook is the teamwork):

1. **Guided wins** — recommendations Sentinel surfaced (applicable to this rig) that are **applied
   AND still active**, read from the Trust Ledger (`history::applied_changes_summary` /
   `check_change_active`). "Sentinel suggested, you decided, it stuck."
2. **Self-directed wins** — good states Sentinel **detects the user achieved themselves**: a rec's
   `state_kind` probe reads *satisfied* while there is **no** corresponding active Sentinel apply in
   the ledger. "You tuned this yourself; Sentinel sees it and credits you."

Each contributing signal is tagged with the **intent(s)** it serves (see §4); the user's selected
intents weight the standing so it reflects *their* goals.

**Output (`SyncStanding`):**
- a normalized progress value + a discrete **level** (tier index),
- a **breakdown**: `{ guided, self_directed, by_intent }` — so every bit of the standing is
  inspectable ("3 with Sentinel, 4 on your own; toward Peace-of-mind: 5/6 confirmed"),
- **level-crossing events** (see §5).

**De-emphasize the raw number.** Primary presentation is *standing + breakdown*, not a big "9,200."
A raw score that can't be explained is the generic-optimizer smell we're avoiding.

## 4. Intents ("your goals")

A user selects what they care about; the engine takes selected intents as input and weights signals.
Categories:

- **FPS**, **Latency**, **Smoothness**, **Thermals**, **Quality** — performance/quality flavors.
- **Peace of mind / health-assurance** — first-class, and special: it climbs by **confirming** safe,
  healthy states rather than by changing anything (e.g. rollback-safety intact, drivers current,
  thermals readable and in range, storage not critically full, no detected risky misconfig). A user
  whose whole reason for Sentinel is *reassurance* can reach a high standing **without applying a
  single tweak** — an honest "we checked; you're good" insurance dashboard.

Intent selection UX is the **design lane's**; this engine only consumes the selected set. The
standing is fully functional with a default/all-intents set, so it is **universal** (zero-setup
works; selecting intents makes it personal).

## 5. Levels + event contract (the seam to the design lane)

- **~4 tiers** (count is an open product call; names are the design lane's — placeholder only).
- Thresholds are **data**, not magic numbers scattered in code.
- The engine emits a typed event **only on a tier crossing**, debounced to **once per crossing**
  (never per-point) — this is where the "no sensory overload" tenet is enforced structurally.

```
SyncLevelEvent {
  from_level: u8,
  to_level: u8,
  direction: "up" | "down",      // standing can regress if an active change is reverted externally
  reason: String,                 // human-explainable ("kept 2 more guided optimizations active")
  intents_satisfied: Vec<Intent>, // which goals drove the crossing
}
```

The design lane subscribes to these events and owns the single tasteful cosmetic shift per crossing.
The engine never touches UI.

## 6. Architecture (what this lane will build — later, dark)

Mirrors the existing pure-consumer modules (`priorities.rs`, `readiness.rs`, `export.rs`): reads
already-computed signals, owns no detection, no mutation, no persistence of its own.

- **New module `src-tauri/src/sync.rs`** — pure functions:
  - `compute_sync(inputs: SyncInputs, intents: &[Intent]) -> SyncStanding`
  - `SyncInputs` = serialized snapshots of existing signals: Trust Ledger summary + per-rec
    `{applicable, applied_active, self_satisfied}`, readiness checks, hardware/diagnostics health
    signals. (Decoupled + testable, like `export::build_markdown_report`.)
  - level/threshold table as data; `SyncStanding` + `SyncLevelEvent` as typed serde structs.
- **One IPC command `get_sync_standing(intents)`** — **NOT registered** in `lib.rs`'s
  `invoke_handler` (dark), or gated behind a build flag. Tests exercise the pure fns directly, the
  way `priorities`/`readiness` are tested without invoking the command.
- **Reuses (pure consumers, no new detection):** `history.rs` (Trust Ledger), `recommendations.rs`
  (catalog + `check_state_kind` probes), `readiness.rs`, `diagnostics.rs`/`hardware.rs` (health
  signals). No changes to `actions.rs` / mutation paths.

## 7. Data flow

`get_sync_standing(intents)` → gather snapshots (Trust Ledger summary; for each catalog rec:
applicable? applied-active? self-satisfied-but-not-applied?; readiness + health signals) → build
`SyncInputs` → `compute_sync` (pure) → `SyncStanding` (+ any `SyncLevelEvent`s vs the last-seen
level) → return to caller. **Last-seen level** persistence (to detect crossings) is the only
stateful piece; reuse the app-data dir pattern (`sentinel_data_dir`), read-only otherwise. Open
call: persist last level, or have the design lane pass in the previously-shown level.

## 8. Error handling / failure posture

- Missing/empty signals degrade gracefully to a lower standing, never panic (every source is
  `unwrap_or_default`-safe, matching the rest of the codebase).
- No source available → standing 0 / level 0, empty breakdown — honest "nothing to show yet."
- Score can **regress** (e.g. a guided change reverted outside Sentinel): emit a `direction: "down"`
  event so the experience can react honestly rather than freezing on a stale high.

## 9. Testing

Pure unit tests only (no mutation, nothing to integration-test), mirroring `rec_tests` /
readiness tests: fixtures of `(HardwareInfo, Trust-Ledger states, readiness, intents)` → assert
expected standing, breakdown split (guided vs self-directed), level, and crossing events
(incl. the peace-of-mind-only path reaching a high standing with zero applies, and a downward
crossing on external revert).

## 10. Out of scope (explicitly)

- No UI, no `src/` edits — cosmetics + intent-selection UX + final naming are the **design lane**,
  reconciled with `experience-pass` by HQ.
- No mutation, no new tweaks, no registration into the live command set until the owner un-parks.
- No PresentMon/ETW before/after FPS proof (that's the separate "out of v1" tier).
- No telemetry / "compare to other rigs" (conflicts with zero-telemetry).

## 11. Open product calls (for the owner)

1. **Tier count + names** (proposed ~4; names design-lane's).
2. **Show a raw number at all?** (lean: standing + breakdown, de-emphasize the number).
3. **Last-level persistence** owner here vs passed in by the design lane (§7).
4. Final **intent list** — confirm the 6 (FPS, Latency, Smoothness, Thermals, Quality, Peace-of-mind).
```
