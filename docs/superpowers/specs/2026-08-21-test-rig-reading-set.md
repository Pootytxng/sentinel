# Spec — the Test room's "Your rig" reading set (the last open intimidation-pass item)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04.** This is a historical design record, not current
> product authority, priority, approval, or work authorization. Current product direction is
> [`docs/PRODUCT_CONSTITUTION.md`](../../PRODUCT_CONSTITUTION.md), with sequence derived in
> [`docs/product/ROADMAP.md`](../../product/ROADMAP.md). Its shipped-fact and honesty claims must be
> re-verified against code and [`docs/ARCHITECTURE_LOCKS.md`](../../ARCHITECTURE_LOCKS.md).

**Status:** SPEC, not built. Written before touching `src/surfaces/LabConsole.tsx`, per the
2026-08-21 handoff ("spec it before touching it").
**Owner ask:** `docs/UI_VISION_BACKLOG.md` STANDING DIRECTIVE → the one 🔴 left after TEST
RESTRUCTURED — *"'Your rig' still repeats Health's numbers — folding it needs a Test-specific
reading set (new data wiring), not a layout move."*
**Scope:** the four corner gauges + the tile title on the Test room's stage. Nothing else.

## 1. The duplication, measured

Read off the shipped code, not remembered:

| Corner | Health — `HomeConsole.tsx:799-853` | Test — `LabConsole.tsx:428-482` | Same? |
|---|---|---|---|
| TL | Readiness — `readinessScore`, `= N of M checks passed` | Readiness — **the identical derivation** | **YES** |
| TR | Avg FPS — `latestSession(...).avg_fps` | Avg FPS — **the identical source** | **YES** |
| BL | 1% low — `latestSession(...).low1_fps_est` | Safe stack — `safeReady` / `safeOn` | no |
| BR | GPU temp | 1% low — **the identical source** | **YES** |

**Three of four gauges are the same number from the same call.** Both tiles are also titled
"Your rig" (`home.homeConsole…` / `lab.labConsole.tiles.stage`). Only the Safe-stack gauge — the
one the 2026-08-21 pass rewrote — is Test's own. That is the whole defect: a user who walks Health
→ Test is shown the same instrument twice and reasonably concludes the second room is decoration.

## 2. The rule the two rooms divide on

- **Health answers "is my PC OK right now?"** — a verdict about the machine. Readiness, live FPS,
  1% low and GPU temp are all verdict numbers. They stay there, unchanged.
- **Test answers "what can this bench prove, and what has it proved?"** — a verdict about the
  *evidence*, not the machine. Nothing on Test should be readable on Health.

A gauge earns a Test corner only if Health has no reason to ever show it.

## 3. The reading set

Four corners. Every value traces to a real measured source; absent → `ArcGauge`'s NOT-YET, never a
fabricated 0 (the room's standing honesty rail, `LabConsole.tsx:300`).

### TL — **Proven** · unit `kept`

- **Source:** `invoke<ScoreboardView>("get_scoreboard")` → `awards.length`. The awards ledger only
  records Keep verdicts (`src/types.ts:414`), so this is literally "changes this bench verified".
- **States:** unread/failed → `null` (NOT-YET). `0` → value 0, note `= nothing proved yet`.
  `N > 0` → value N, `max = N` (full ring), note `= verified before and after`.
- **Why it belongs here:** it is the room's entire payoff, and Health must never show it — a win
  count on the front door would read as a claim about the machine's health.

### TR — **Noise floor** · unit `±%`

- **Source, in order, and *only* these two:** `get_trial_state().noise_floor_pct` when a calibration
  has produced one, else `get_latest_comparison().noise_floor_pct` (already fetched at
  `LabConsole.tsx:150`).
- **Explicitly NOT `bench.efficacy.noise_floor_pct`.** That is the *synthetic* bench's run-to-run
  spread; the other two are *game frametime* spread. Same field name, different measurement —
  folding them under one label would be a fabricated equivalence. Absent → NOT-YET, note pointing at
  calibration.
- **Note line:** `= a change must beat this to count`.
- **Why it belongs here:** it is the bench's own instrument constant — the single number that says
  how big an effect this rig can even resolve. It is the honest answer to "why did my tweak say
  no-change", and it is meaningless on Health.

### BL — **Safe stack** · unit `ready` / `on` — **UNCHANGED**

Keep exactly as shipped 2026-08-21 (`LabConsole.tsx:450-470`), including `safeStackAllOn` /
`safeStackNone`. It already passes the rule, it already had its intimidation pass, and the owner has
seen it. Do not touch it in this train.

### BR — **Instruments read** · unit `read`

- **Source:** `measureKeys.filter((k) => stationHasReading(k, facts)).length` over
  `measureKeys.length`. Both already exist in the component (`LabConsole.tsx:173`, `:190`). **Zero
  new IPC.**
- **States:** value = read count, `max` = station count, note `= {{read}} of {{total}} stations`
  (deliberately the same shape as the retired `readinessNote`, so the room keeps its idiom).
- **Why it belongs here:** it is the "how far through the bench are you" number, derived from the
  same `stationHasReading` the dock already uses to mark nodes measured — so the gauge and the dock
  can never disagree.

### Tile title

`lab.labConsole.tiles.stage`: **"Your rig" → "Your rig on the bench"**. The hologram is still the
rig, but the gauges around it now read the bench's work, and two rooms with a byte-identical tile
title is the literal half of the duplication.

## 4. What leaves Test, and where it still lives

| Removed from Test | Still lives at |
|---|---|
| Readiness gauge + `readinessNote` | Health's TL corner (the front-door verdict) |
| Avg FPS gauge | Health's TR corner; per-run detail inside the Benchmark station |
| 1% low gauge | Health's BL corner; the before/after split inside Benchmark / Two Futures |

Follow-through: with the Readiness gauge gone, `readiness` is dead in `LabConsole` (its only
consumer — verified by grep, `LabConsole.tsx:303-307,431-440`). Drop the prop **and** its pass-site
at `LabGround.tsx:108`; `LabGround` keeps its own `readiness` for `RoomShell`. Leaving an unused
prop behind is exactly the parallel-generation rot NAV-1 names.

**The 3D hologram stays on both rooms — decided, not an oversight.** The ask names the *numbers*.
Test's hologram carries the click-to-read evidence map (`lab-evidence-map.ts`) that Health's does
not, so it is a different instrument wearing the same model.

## 5. Rails

- **No new backend.** `get_scoreboard` and `get_trial_state` are already registered
  (`src-tauri/src/lib.rs:1255,1264`) and already invoked by `Benchmark.tsx:114-115`. Read-only, no
  mutation-boundary surface, no capability change.
- **Two new invokes** join the room's existing probe effect, each `.catch(() => null)` → NOT-YET.
- **Never a fabricated 0.** A count of 0 renders only when its source loaded and genuinely holds
  zero; an unloaded source renders NOT-YET. This is the 2026-07-09 bug→guard, unchanged.
- **Layout is untouched.** Same `BentoTile span="hero"`, same four `.lc-corner` slots, same
  `ArcGauge`. This is a data + copy change inside the existing frame.

## 6. Guards (bug→guard — written before the fix counts)

1. **`lab-console.test.tsx` — no-Health-numbers.** Assert the Test stage renders none of
   `lab.labConsole.readinessLabel` / `avgFpsLabel` / `oneLowLabel`, and that its four corners are
   exactly Proven · Noise floor · Safe stack · Instruments read. This is the guard that makes the
   defect unable to return.
2. **Cross-room duplication guard (new).** Assert the Test corner-label set and the Health corner-
   label set are disjoint, read from the i18n bundles — so a future gauge added to either room
   cannot silently re-collide.
3. **Noise-floor source guard.** Assert `efficacy.noise_floor_pct` alone does **not** populate the
   gauge (pins §3 TR's honesty call against a future "helpful" fallback).
4. **NOT-YET guard.** Scoreboard/trial invoke rejects → both gauges render NOT-YET, not 0.
5. Existing `bl.textContent).toContain("Safe stack")` (`lab-console.test.tsx:277`) must still pass
   untouched — the regression pin on §3 BL.

## 7. Out of scope

The dock, the reading tile, manual parts, the station bodies, Health, and any backend change. The
NAV-1 parallel-generation pruning is the same neighbourhood but a separate, larger train.

## 8. Verification before it can be claimed done

`self-review` skill → `self-reviewer` subagent, full rubric, on an **installed** build, quoted PASS.
Green tsc/vitest is not a visual review (standing law 2026-06-20). Health, History and Live get
regression shots — this train must not move them.
