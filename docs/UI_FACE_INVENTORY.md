# UI face inventory & disposition — NAV-1(c)

> Answers `docs/UI_VISION_BACKLOG.md` Finding 2 ("parallel UI generations coexist behind flags —
> candidate: bless one face per room, delete or archive the rest") and its taste call (c).
> **This doc decides nothing destructively. It is the evidence a deletion would need.** Written
> 2026-08-04 on `claude/harness-context-cleanup-700535`. File:line claims are point-in-time —
> re-verify before acting.
>
> **⚠️ EXECUTED 2026-08-06 — everything below is the PRE-PRUNE tree.** The generation prune acted on
> this evidence and deleted 29 files: `Lab.tsx` · `LabV2.tsx` · `LabBento.tsx` · `Optimize.tsx` ·
> `OptimizeV2.tsx` (+ their CSS, tests and `lab-v2-data.ts`), `CompyHero.tsx`+`.css`,
> `src/data/nav-flags.ts`, the `design/qpw/` component layer, `design/Gallery.tsx`,
> `design/console/Sparkline.tsx` and the vendored `MagicBento`. Files named here as live are gone;
> read this only as the *reasoning*. Still true and still open: **`GpuProfile.tsx` is the owner fork**
> (§d, owner decision B_gpu). The recurrence is now mechanically prevented —
> `src/reachability-guard.test.ts` fails the build on any module unreachable from `src/main.tsx`.

## The premise Finding 2 got wrong

Finding 2 counted surfaces per room and read the count as *rival generations* ("Home has 4+ faces,
Monitor 4, Lab 5"). The importer graph says otherwise: **they are nested chains, not siblings.**
Each newer shell *composes* the older surface as its inner renderer.

```
HomeRoom ──▶ HomeHud ──▶ HomeV2          HomeRoom ──▶ HomeConsole
MonitorV2 ─▶ MonitorConsole | MonitorBasic | Play        MonitorV2 ─▶ Monitor (TuningPresets)
LabV2 ────▶ Lab ─────▶ LabBento          LabGround ─▶ LabConsole
OptimizeV2 ▶ Check + Fix   ← failsafe    lab/OptimizeStation ─▶ Check + Fix   ← LIVE
BlackbookV2 ▶ Learn
```

Consequence: **"delete the old face" is almost never a leaf deletion.** A surface being dark *as a
room panel* does not make it dead — the shipped shell usually imports it. Only three surfaces in
`src/surfaces/` are genuine disposition candidates, and only one of those is free.

## How reachability was established

Two independent layers, both mechanical:

1. **Routing.** `activeTab` is `useState<Tab>("Overview")` (`src/App.tsx:550`) — **not persisted**,
   so no stale route can revive a retired tab. Every writer was enumerated
   (`grep -n "setActiveTab" src/App.tsx`, 8 call sites):
   - `navHome` (`src/App.tsx:1046-1070`) — the rail. With `compy_lab_ground` ON it maps both
     `check` and `fix` → `"Lab"`.
   - the two Gaming-recovery "Review" affordances (`src/App.tsx:1482`, `src/App.tsx:1613`) — both
     literally `setActiveTab(labGround ? "Lab" : "Optimize")`.
   - four fixed literals: `"Overview"` ×3 (`:1031`, `:1337`, `:1667`) and `"Lab"` (`:1670`).
   - `navigateTo` (`src/App.tsx:1138-1144`), whose only callers are `goBack`/`goForward`
     (`:1152`, `:1160`) replaying `currentLocation = \`tab:${activeTab}\`` (`:1094`) — it can only
     restore a tab that was already visited, so it adds no new reachable tab.

   `railFor(merged, ground)` (`src/design/homeRail.ts:41-55`) drops the `check` **and** `fix` rail
   entries when `ground` is true. At default flags the rail is **Health · Live · History · Test**
   (the labels the owner set on 2026-08-12 and 2026-08-19; the four rooms and their ids are
   unchanged) and only `"Overview" | "Play" | "Learn" | "Lab"` are reachable — those are internal
   view keys, never labels — so **`"Optimize"` is written by no code path at all** (see the
   correction below).
2. **The classic-tree gate.** `roomPanels` renders only inside the `v2Shell` branch
   (`src/App.tsx:1547`, i.e. `!settingsActive`), behind
   `src/App.tsx:1719-1723`:
   ```jsx
   {!(activeTab === "Optimize" && optimizeMerged) &&
     !(activeTab === "Play" && v2Monitor) &&
     activeTab !== "Learn" && activeTab !== "Lab" && roomPanels}
   ```
   At default flags this evaluates to nothing: every reachable tab is excluded.

Flag defaults are read from the code, never a header comment — `!== "0"` = graduated/DEFAULT-ON,
`=== "1"` = opt-in/DEFAULT-OFF. `compy_optimize` + `compy_monitor` (`src/data/nav-flags.ts`) and
`compy_lab_ground` (`src/design/theme.ts:272`) are all graduated.

## (a) TRUE ORPHAN — deletable, zero risk

| Item | Evidence |
| --- | --- |
| `src/surfaces/CompyHero.tsx` (102 lines) + `CompyHero.css` | **Zero importers anywhere.** |
| `readCommitted()` / `COMMITTED_KEY` (`src/design/theme.ts:174`) | **Zero callers.** |
| `compy_committed` flag | Its only remaining mention in the codebase is the comment at `src/design/theme.ts:171`. |

That comment already states the disposition: *"Reversible: drop the flag + CompyHero and nothing
changes."* The hero was the owner's 2026-06-15 "take a full swing" brand splash; the taste call
recorded in `docs/UI_VISION_BACKLOG.md` is that it is a **future landing-page asset, not Home**
(`[[premium-redesign-flags-and-direction]]`). Deleting it deletes the only copy of that concept.

**Disposition: ARCHIVE, do not delete.** Move the pair to `docs/archive/ui/` (or leave in place)
rather than dropping them — the code is inert either way, and the owner's landing-page intent is
still open. Retiring `readCommitted`/`COMMITTED_KEY` is free and can happen independently.

## (b) LEAF CANDIDATE — dead, but gated on a flag retirement

**`src/surfaces/Optimize.tsx`** (246 lines, exports `Optimize` only; imported once, as
`OptimizeShell`, at `src/App.tsx:53`).

It is **structurally unreachable as a visible surface in every flag combination**:

- It renders only under `optimizeMountedRef.current && optimizeMerged` (`src/App.tsx:1252-1254`).
- `optimizeMountedRef` is set only when `activeTab === "Optimize" && !v2Optimize`, where
  `v2Optimize = v2Shell && optimizeMerged` (`src/App.tsx:1225-1226`).
- `roomPanels` renders only when `v2Shell` is true. So reaching the `optimizeMerged` branch requires
  the ref to have been set in an *earlier* render with `optimizeMerged` false — i.e. a mid-session
  `compy_optimize` flip in devtools with no reload.
- Even in that contrived state the gate at `src/App.tsx:1719` drops `roomPanels` whenever
  `activeTab === "Optimize" && optimizeMerged`, and on any other tab the wrapper is `display: none`.

With `compy_optimize="0"` the same block renders `<GamingMode/> + <Fix/>` instead — **never
`OptimizeShell`**. So the escape hatch does not revive it either.

**Disposition: delete `Optimize.tsx` + the `src/App.tsx:53` import + the `optimizeMountedRef`
keepalive.** This is the one real prune. It needs a build + full vitest run and a self-review of the
Optimize/Tune room, because removing the ref touches `src/App.tsx:1226`. Not done here — it is a
mutation to the shipped router, and the owner's standing rule is that a face is only pruned once
the evidence is written down first. This doc is that evidence.

## (b′) THE ONE ROOM THAT REALLY DOES HAVE TWO SHELLS — `OptimizeV2` is failsafe-only

Found while verifying a self-review caveat, and it corrects the tidy story above: **`OptimizeV2` is
not a live blessed shell in the default build.** It is dark for exactly the same reason
`Optimize.tsx` is — one tab that nothing can select.

- `OptimizeV2` mounts behind `optimizeV2MountedRef.current && optimizeMerged && hw`
  (`src/App.tsx:1565`).
- `optimizeV2MountedRef` is set only by `if (activeTab === "Optimize" && v2Optimize)`
  (`src/App.tsx:1226`).
- Per the writer enumeration above, **nothing sets `activeTab` to `"Optimize"` while
  `compy_lab_ground` is ON** — the rail maps check/fix → `"Lab"`, both Gaming-recovery buttons are
  `labGround ? "Lab" : "Optimize"`, and back/forward only replay visited tabs.

So the ref never arms and the room never mounts. The **live** Optimize experience at default flags
is `src/surfaces/lab/OptimizeStation.tsx` **inside `LabGround`** — a third composition of the same
`Check` + `Fix` parts. Reaching `OptimizeV2` requires the documented devtools failsafe
(`localStorage.compy_lab_ground = "0"` + reload).

**Disposition: NOT a deletion candidate — this is tier (e) fallout.** `OptimizeV2` is the classic
Optimize room's V2 shell and the thing `compy_lab_ground="0"` falls back to; deleting it would
delete the failsafe the Lab overhaul is still riding on. It stays until the Lab overhaul lands and
the ground flag is retired, at which point the whole `Optimize` tab (`Tab` union member,
`OptimizeV2`, `Optimize.tsx`, both keepalive refs, the `:1719` gate's first clause) retires as one
coherent piece — a far better prune than picking off `Optimize.tsx` alone.

**Consequence for (b):** the `Optimize.tsx` deletion in (b) is still correct and still safe, but it
is no longer the *tidiest* unit of work. Prefer folding it into the tab retirement above rather than
landing it as a standalone prune.

## (c) NOT DELETABLE — dark as room panels, but composed by the shipped shells

Each of these is unreachable via `roomPanels` at default flags **and still live**, because a
modern shell imports it. Naming the importer so the record cannot be misread later:

| Surface | Live importer(s) |
| --- | --- |
| `Check` | `lab/OptimizeStation.tsx:5` (the live one) · `OptimizeV2.tsx:13` · `Optimize.tsx:6` |
| `Fix` | `lab/OptimizeStation.tsx:4` (the live one) · `OptimizeV2.tsx:14` · `Optimize.tsx:7` |
| `Play` | `MonitorV2.tsx:4` · `MonitorBasic.tsx:11` · `Monitor.tsx:4` · `monitor/SessionStack.tsx:7` · `monitor-v2-data.ts:4` |
| `Monitor` | `MonitorV2.tsx:6` (imports `TuningPresets`) |
| `MonitorBasic` | `MonitorV2.tsx:5` · `Monitor.tsx:5` |
| `MonitorConsole` | `MonitorV2.tsx:11` |
| `Learn` | `BlackbookV2.tsx:4` — **plus** the live encyclopedia modal at `src/App.tsx:1389` |
| `Lab` | `LabV2.tsx:4` |
| `LabBento` | `Lab.tsx:33` |
| `LabConsole` | `LabGround.tsx:4` |
| `HomeV2` | `HomeHud.tsx:18` · `HomeRoom.tsx:10` (App never imports it directly) |
| `HomeHud` | `HomeRoom.tsx:11` |
| `HomeConsole` | `HomeRoom.tsx:12` |

The genuinely dead code here is not the files — it is the **`roomPanels` mount sites** for `Learn`
(`src/App.tsx:1332`) and `Lab` (`src/App.tsx:1340`), which the `:1719-1723` gate excludes
unconditionally, with **no escape hatch**. Those two JSX blocks are removable without touching the
surfaces. Low value, non-zero risk; parked, not scheduled.

## (d) NEEDS A DECISION, not a deletion

**`src/surfaces/GpuProfile.tsx`** (346 lines) — a full advisory surface with a full test suite
(`GpuProfile.test.tsx`: scope picker, before/after delta, vendor advisory badges) plus
`src/data/gpu-profile-store.ts` and `src/hooks/use-gpu-profile-scope.ts` — and **no non-test
importer.** It is tested but never mounted.

Context: LOCKED rule 6 says GPU-profile *apply* is structurally impossible (AMD profile state is not
user-mode readable → cannot satisfy rollback-first), so this can only ever be advisory. The fork —
wire it into a room as advisory, or archive it — is a product call, not a cleanup call.
**Owner decision, surfaced not taken.**

## (e) EXCLUDED from this pass

`LabGround` / `compy_lab_ground` — the Lab overhaul is in flight (`docs/BACKLOG.md` Q0 `[~]`).
Nothing in that chain is touched by this inventory.

## Net

One archivable pair (`CompyHero`), one owner fork (`GpuProfile`), two removable JSX mount sites,
and one deletable file (`Optimize.tsx`) that is better landed as part of retiring the whole
`Optimize` tab once the Lab overhaul closes.

Finding 2's framing — "bless one face per room, delete the rest" — is right about **one** room and
wrong about the other four. Health, Live, History and Test each already have exactly one
blessed shell; their "extra faces" are that shell's own parts, and the count Finding 2 read as
rivalry was really composition depth. **Optimize is the real case:** three shells over the same
`Check` + `Fix` parts, of which `lab/OptimizeStation` is live, `OptimizeV2` is the
`compy_lab_ground="0"` failsafe, and `Optimize.tsx` is reachable by nothing. That convergence is a
Lab-overhaul task, not a cleanup sweep — which is why this pass deletes nothing.
