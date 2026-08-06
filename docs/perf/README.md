# `docs/perf/` — recorded performance evidence

**Why the budgets exist at all — owner decree 2026-08-06, on approving the foil-sweep cut:**

> compy isnt suppose to be a resource hog whatsoever matter of fact it should be the most optomized
> thing oin someons pc altoether

That is a **standing product bar, not a target**: an optimizer that costs its user measurable
performance is refuting its own pitch, and this one ships to gamers who will watch it in Task
Manager. It ranks *above* visual ambition — the 14s foil loop was cut on this basis with the look
substituted, not defended. A budget here is the mechanical form of that bar; adding cost without
adding a budget is how the bar gets lost.

Three kinds of file, and the distinction is the whole point:

| | |
|---|---|
| `raw/*.json` | **Recordings.** Written by `scripts/q7-probe.mjs` against the installed build. Never hand-edit one — re-record it. |
| `q7-baseline.json` | **Transcription + budgets.** Every metric names the recording and the exact path inside it that produced its number, plus a `budgetBasis` saying how the budget was chosen. |
| `../superpowers/specs/2026-07-31-q7-native-baseline.md` | **The prose**, including the budget table the rest of the repo reads. |

`scripts/perf-budget-guard.test.mjs` ties the three together: it re-opens every raw trace, re-derives
every baseline value, fails on any drift, and fails a budget in the spec that no recording stands
behind. It never re-runs the probe — these traces come off a live installed build on the owner's
machine, and CI has no such machine.

## Re-recording

Needs the **installed** build (`%LOCALAPPDATA%\Compy\compy.exe`), not `tauri dev` — a debug build with
HMR is not a performance test. Close Compy first; the probe relaunches it with a debug port.

```
node scripts/q7-probe.mjs selftest    # prove the IPC counter still counts (run this first)
node scripts/q7-probe.mjs coldstart   # 3 cold process starts
node scripts/q7-probe.mjs boot        # document-start IPC census + settle window
node scripts/q7-probe.mjs rooms       # per-room IPC / rAF / interval / GL-draw census
node scripts/q7-probe.mjs latency     # click-to-content, first mount measured from a fresh reload
node scripts/q7-probe.mjs idle-bare   # no CDP at all -- the idle-CPU number that owes nothing to the probe
node scripts/q7-probe.mjs idle        # instrumented idle: IPC/rAF/timer census
node scripts/q7-probe.mjs a11y        # AX tree, focus journey, 200% reflow, forced colors
node scripts/q7-probe.mjs restore     # leave the desk as it was found
```

Then update `q7-baseline.json` and the spec table, and run:

```bash
npx vitest run scripts/perf-budget-guard.test.mjs
```

## Two traps worth writing down

**"The instrument must be inflating it" is a hypothesis, not an excuse — measure it.** The
instrumented idle trace reported **50.95% of one core**, and the obvious reading was that the probe's
own frame-counting `requestAnimationFrame` loop was paying for much of it, since a live rAF loop
forces the compositor to keep producing frames. `idle-bare` was built to subtract the observer: no
port, no CDP, no injected script, sampled through Windows' per-process counters. It came back at
**50.71%**. The instrument costs about a quarter of a percentage point, and idle Compy really does
burn half a core doing nothing. The comfortable explanation was wrong, and only the bare run could
say so — which is the whole reason it stays in the suite.

**Memory is only comparable at equal state.** A fresh boot parked on Home holds ~80 MB less than the
same app after the room sweep, because the keepalive rooms stay mounted behind `display:none`.
`idle-bare.json` records a `state` field saying which it was; `idle-visible.json` predates that field
and was taken *after* a full room sweep. Compare like with like or not at all.
