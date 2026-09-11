# Parallel Worktree Operations — HQ / Air-Traffic-Control model

> **⚠️ SUPERSEDED — HISTORICAL (reclassified 2026-09-04).** This 2026-06-01 model ("only HQ writes
> `main`"; lanes at paths that no longer exist) is not current execution law. Its former replacements,
> `docs/LANE_BUS.md` and `docs/LANE_WORKFLOW.md`, are also dormant historical designs. Current claims,
> worktrees, writers, gates, and transitions are governed only by `docs/WORK_CONTROL.md`; current
> release state lives in `docs/RELEASE_STATE.md`.

**Set 2026-06-01.** Compy is worked by multiple Claude sessions ("lanes") at once. This is the
rule of the road. **HQ owns this doc.** Any lane: read this before touching the repo.

## Lanes & folders (each lane = one git worktree = one branch)

| Lane | Folder | Branch | Domain it may edit |
|---|---|---|---|
| **HQ (integration)** | `C:\Users\Kuya\code\compy` | `main` | integration, QA, this doc, `CLAUDE.md`, beta-ref guard |
| **Design** | (idle — `experience-pass` INTEGRATED 2026-06-02; fresh checkout+branch off `main` when next staffed) | — | `src/` (frontend) + frontend build config |
| **Backend agent (SPIKE)** | `C:\Users\Kuya\code\compy-agent` | `spike/backend-agent` | `src-tauri/` exploration — **speculative, may never land** |
| **Benchmark** | `C:\Users\Kuya\code\compy-benchmark` | `benchmark` | F6 proof/benchmark **design** (docs first) |

## Rules of the road (so it's not a 5-car pileup)

1. **Only HQ writes `main`.** Lanes NEVER commit to or push `main`. They push their *own* branch and hand off; HQ merges.
2. **One branch ↔ one worktree** (git enforces this). Each tab = its own folder + branch.
3. **Disjoint file domains.** Design=`src/`, Backend=`src-tauri/`, Benchmark=docs(then TBD). Two lanes must never edit the same file; if unavoidable, serialize (one merges, the other rebases).
4. **HQ merges one lane at a time, verifying between** — `cargo test` + `npm test` + build green *before* each `main` push. **HQ is the QA gate; nothing unverified reaches `main`.**
5. **Lanes rebase onto fresh `main` often** — small, frequent integrations beat one giant divergent merge.
6. **Push discipline** — push branches frequently so HQ + the owner see them; no long-lived local-only commits.
7. **Beta refs frozen** (`private-beta-001` / `beta/*` @ `16069fa`). **No force-push, ever** (`main` or beta).
8. **`CLAUDE.md` + shared config = single-owner (HQ).** `package.json`/lock owned by the frontend (design) lane only.
9. **Historical rule only — retired.** The former build-ahead rule used the now-superseded
   `docs/PRODUCT_DIRECTION.md` sequence. It is not authoritative and cannot authorize isolated work.
   Current product sequence derives from `docs/PRODUCT_CONSTITUTION.md` through
   `docs/product/ROADMAP.md`; execution requires a current `docs/WORK_CONTROL.md` claim.

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

**Implication HQ must reconcile when the direction lands:** the Tune/Garage cosmetic-reward gamification
was removed under Decision A, and that de-gamification is now **MERGED and LIVE on `main`** (`60daf3a`).
If the reward system comes back, it would *re-introduce* cosmetic UI onto the de-gamified `main` — a
reversal to reconcile, no longer a parked-branch merge. HQ + owner settle it once the owner's full
direction is in hand. Until then: benchmark lane holds.

## Status snapshot (2026-06-02)
- **HQ** = `main` @ `1bd2dfb` (origin synced).
- **F1 Gaming Mode** — ✅ **BUILT + merged to `main` DARK 2026-06-02** behind a default-off
  `gaming_mode_gate()` (the "Gaming" tab is hidden + the 5 IPC commands refuse). `cargo test` 81/81 ·
  `npm test` 39/39 · /check + /security clean. **Gated until the owner's mutation QA (spec §7) + sign-off
  flip the gate.** Built by HQ in a throwaway `compy-gaming` worktree (now removed). Spec +
  plan under `docs/superpowers/`.
- **`experience-pass`** — ✅ **INTEGRATED to `main` 2026-06-02** (ff `fcba42b..60daf3a`); branch + checkout
  **retired**. The de-gamified honest command-center is now live on `main`: SystemPosture hero,
  Tune/Garage/theme-unlock/Surprise removed, themes curated, design-system primitives, ~290 lines dead
  CSS purged. HQ-verified (34 tests, tsc+build clean, npm audit 0, frontend-only diff) + owner sign-off
  (KEEP Overview hardware grid). The new `Dashboard` surface remains built+tested but **not wired**.
- **`benchmark`** (PAUSED — see above) and **`spike/backend-agent`** (speculative) — still off `main`
  in their own worktrees.
- **Beta** frozen @ `16069fa`.
