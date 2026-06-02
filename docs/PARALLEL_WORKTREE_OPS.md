# Parallel Worktree Operations — HQ / Air-Traffic-Control model

**Set 2026-06-01.** Sentinel is worked by multiple Claude sessions ("lanes") at once. This is the
rule of the road. **HQ owns this doc.** Any lane: read this before touching the repo.

## Lanes & folders (each lane = one git worktree = one branch)

| Lane | Folder | Branch | Domain it may edit |
|---|---|---|---|
| **HQ (integration)** | `C:\Users\Kuya\code\sentinel` | `main` | merges, QA, this doc, `CLAUDE.md`, beta-ref guard |
| **Design** | (parked — gets its own worktree when staffed) | `experience-pass` | `src/` (frontend) + frontend build config |
| **Backend agent (SPIKE)** | `C:\Users\Kuya\code\sentinel-agent` | `spike/backend-agent` | `src-tauri/` exploration — **speculative, may never merge** |
| **Benchmark** | `C:\Users\Kuya\code\sentinel-benchmark` | `benchmark` | F6 proof/benchmark **design** (docs first) |

## Rules of the road (so it's not a 5-car pileup)

1. **Only HQ writes `main`.** Lanes NEVER commit to or push `main`. They push their *own* branch and hand off; HQ merges.
2. **One branch ↔ one worktree** (git enforces this). Each tab = its own folder + branch.
3. **Disjoint file domains.** Design=`src/`, Backend=`src-tauri/`, Benchmark=docs(then TBD). Two lanes must never edit the same file; if unavoidable, serialize (one merges, the other rebases).
4. **HQ merges one lane at a time, verifying between** — `cargo test` + `npm test` + build green *before* each `main` push. **HQ is the QA gate; nothing unverified reaches `main`.**
5. **Lanes rebase onto fresh `main` often** — small, frequent integrations beat one giant divergent merge.
6. **Push discipline** — push branches frequently so HQ + the owner see them; no long-lived local-only commits.
7. **Beta refs frozen** (`private-beta-001` / `beta/*` @ `16069fa`). **No force-push, ever** (`main` or beta).
8. **`CLAUDE.md` + shared config = single-owner (HQ).** `package.json`/lock owned by the frontend (design) lane only.
9. **Build-ahead, ship-on-schedule.** A feature slotted "later" in `docs/PRODUCT_DIRECTION.md` (e.g. F6 benchmark) may be built **in isolation** but stays **PARKED** (not merged to `main`) and **DARK** (backend unregistered / flag-gated; no UI wired into surfaces the design lane is rewriting) until the owner says the plan reached its slot. `PRODUCT_DIRECTION.md` sequence is authoritative.

## Merge protocol (lane → `main`)
1. Lane finishes a unit, verifies in its own worktree, pushes its branch.
2. Lane tells HQ: "branch `X` ready."
3. HQ rebases `X` onto latest `main` → runs full verification → merges → pushes `main`.
4. HQ never merges unverified work, and never promotes a parked/dark feature ahead of its agreed slot.

## Benchmark lane — PAUSED, direction REOPENED (owner, 2026-06-01)
**The benchmark lane is PAUSED. Do NOT begin any design work — not honest-proof, not anything —
until the owner delivers the full direction.** The owner is **intentionally reopening the
cosmetic-reward-system direction** (the lane's original premise) and is **reconsidering Decision A**
for this angle. Honest-proof-only is **NOT** locked. (An earlier "honest-proof-only LOCKED" note was a
miscommunication and is void.)

**Implication HQ must reconcile when the direction lands:** the design lane already *removed* the
Tune/Garage cosmetic-reward gamification under Decision A (this is in `experience-pass`, parked). If the
reward system comes back, it intersects directly with `experience-pass` — HQ reconciles the two once the
owner's full direction is in hand. Until then: benchmark lane holds.

## Status snapshot (2026-06-01)
- **HQ** = `main` (integration base; backend loose-ends `2b29643` published to origin).
- **`experience-pass`** @ `514b523` — PUSHED, **PARKED**. The de-gamified honest-hero design pass:
  CommandHero→SystemPosture, Tune/Garage removed, themes curated, design-system primitives, ~290 lines
  dead CSS purged. 34 tests, build clean. **Pending before HQ merges it:** owner visual verify + the
  "drop the hardware grid from Overview?" Dashboard-wiring decision.
- **`spike/backend-agent`**, **`benchmark`** — fresh off `main`.
- **Beta** frozen @ `16069fa`.
