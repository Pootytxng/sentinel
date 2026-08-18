# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template in git history.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

**NONE OPEN.** `main` is at **`f86ed9df`**, clean. PR #138 merged (squash), issue #137 closed,
branch `feat/front-door-diagnosis-c05-c19` deleted locally. The owner's desk runs `f86ed9df`
(runtime-proved, one installer on the Desktop) — the desk and `main` agree.

Shipped this lane: **C-05 + C-19 as one train** (#138). The tour stopped being the front door, and
CPU temperature came out from behind the Advanced toggle.

**One loose end, and it needs a hand that is not mine:** the remote ref
`origin/feat/front-door-diagnosis-c05-c19` is still there. `gh api -X DELETE` was refused by this
session's permission layer, twice. A MERGED row in `docs/BRANCH_DISPOSITIONS.md` keeps the audit
green in the meantime; delete the ref and drop that row together.

## The two findings that matter more than the feature

Both filed items were **wrong about their own premise**, and in the same direction — a surface was
assumed reachable because a component existed.

1. **C-05 said the launcher card already existed.** True of `HomeHud` and `HomeV2`; false of
   `HomeConsole`, the DEFAULT Home (`compy_home_console` ON unless literally `"0"`). Captured live
   on the shipped build first: `document.querySelectorAll('.stl-card').length === 0`. Removing the
   auto-open alone would have stranded the entire tour behind Settings on the build every user runs.
2. **C-19 said CPU temp was "three clicks deep".** It had **no default-flag path at all.**
   `CpuTempOffer` hung off `Play`'s `deepMonitoring` slot, which renders only while `showLive`
   (`view !== "sessions"`), and `MonitorV2` mounts `Play` only when `!basic && !(segment === "live"
   && monitorConsole)` — with the console flag default ON that is advanced+**Sessions**, where
   `showLive` is false. `.mdc-root` and `.play-monitor` were both absent from the live DOM.

**This also corrected `BACKLOG` C-18, which was itself a correction.** Its "All reachable: Live →
Advanced" was wrong for the same reason. `Play` and `SessionDebrief` ARE live; `MonitorDomainCards`
/ `monitor-panels.tsx` reach the screen only on the `compy_monitor_console="0"` failsafe. **Still do
not delete them — that is the failsafe, not dead code.**

The generalisable lesson, now the third time this class has bitten: **a component existing, and even
being imported by something live, does not make it reachable.** Walk the conditional chain to a
real default-flag route, then confirm the selector in the live DOM. Grep alone will lie to you here.

A third defect nobody had filed: `HomeConsole` hardcoded "no CPU temp — needs a sensor app" with **no
probe behind it**, so it printed that while HWiNFO was publishing a reading. Unmeasured claim =
fabricated claim.

## What the guards caught, which is the part worth keeping

- The first cut made the CPU callout a **button** opening a sheet.
  `src/surfaces/home-console-standard-readout-guard.test.tsx` failed it: the owner's 2026-08-06 call
  is that annotation planes carry live state as **plain text — labels, not controls**. The guard was
  right, the design was wrong, and the fix moved to a boxed `BentoTile`. *Check the owner decision
  behind a surface before assuming a red guard is the guard's problem.*
- `self-review` round 1 (`d76f753f`) FAILed item 5: both new tiles kept their own frame inside
  `.v2-tile-full` — box in a box. Fixed in `d250f53a`, scoped to `.v2-tile-body >` so the HomeV2 /
  HomeHud / monitor-panels mounts keep theirs. Round 2 is a full fresh 10-item re-prove: **PASS**.
- New guards `src/first-run-front-door-guard.test.ts` and `src/cpu-temp-reachability-guard.test.ts`
  were **mutation-tested** — every one of their six cases was confirmed to FAIL when the defect is
  reintroduced, then reverted. A guard that only passes is not evidence that it works.

## Cost note

`read_cpu_temp` had **no memo**: on a machine with no monitor app every call fell through to two
failing WMI namespace connections, and the pre-existing 1 Hz `MonitoringTab` poll was already paying
it. `src-tauri/src/cpu_temp.rs` now has a 900 ms hit / 15 s miss TTL cache, so Home's new 5 s poll
costs one probe per 15 s worst case **and the old caller got cheaper**. Adding a caller to a probe
you have not measured is how the idle-cost class comes back.

## Verified at `d250f53a` (byte-identical code; `f86ed9df` is the squash of it)

`tsc` clean · vitest **5006 passed** / 339 files (`--maxWorkers=4`) · `cargo test` **963 passed** ·
`clippy -D warnings` clean · `doc-budget.ps1` PASS · `verify-release-state.mjs` 0 drift ·
work-control gate **PASS** (receipt for `merge-pr`).

**Review disposition: NOT independently reviewed by Codex.** Codex holds the delegated pass
over #136; this lane was told not to duplicate it. Recorded as a warning in the work-control receipt, not
silently self-approved. If a later session wants that second pass, #138's diff is the target.

## Docs touched

`BACKLOG` (C-05/C-19 ticked, C-18 corrected) · `RELEASE_STATE` (owner-installed row + stamp
`f86ed9df`) · this file. Two TOKEN-LAW archives were forced by the writing: `BACKLOG` steering-log
cycles 2026-07-27a…2026-08-04a and `RELEASE_STATE`'s pre-v0.9.18 desk-build chain, both moved
verbatim to `docs/archive/` with pointers. The `BACKLOG` ratchet then tripped `doc-budget-guard`'s
anti-slack rule correctly and was lowered 142KB → 122KB / 1400 → 1200 lines.

**`RELEASE_STATE` is at 56.7KB of a 57KB budget.** The next session that adds a desk-build row will
have to archive before it can commit. Plan for that rather than discovering it at the gate.

## Next

`docs/BACKLOG.md` § "Conformance queue" — the next non-gated `[ ]` items are **C-10** (raw OS
`<select>` inside the custom UI), **C-11** (group repeated ledger events), **C-17** (mechanize the
mono-for-machine-values-only law). **C-04** (rename Home to "Health"/"Diagnosis") is still owner
territory for the *word* — this train deliberately built around it and did not assume it.

Still delegated elsewhere, do not duplicate: the **#135 rollback audit** and the **Codex pass
over #136**.

**This session is done — archive it.**
