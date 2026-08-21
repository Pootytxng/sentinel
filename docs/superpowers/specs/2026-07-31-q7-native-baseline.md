# Q7 — native baseline, first recording

> Q7's acceptance says budgets must be **derived from recorded baselines, not invented**, and that the
> accessibility matrix needs **an evidence record, not a blanket compliance claim**. This is the first
> recording. It sets no budgets yet — it is the measurement those budgets have to come from.

**Measured:** 2026-07-31, `XFA253Q Z` + `VG245`, AMD Ryzen 7 9850X3D 8-core · AMD Radeon RX 9070 XT.
**Raw data:** `q7-idle-baseline.csv`, 89 samples at 2 s, 12:19:43 → 12:22:40 local.

## A finding that outranks the baseline

**The installed app is not the version `RELEASE_STATE.md` says it is.**

| | |
|---|---|
| `RELEASE_STATE.md:44` | `<!-- STATE:owner_installed_stamp=7ba5fb6 -->` |
| The live window's own stamp | **`294db4f · release`** |

`294db4f` is issue #14's LabDeck review candidate. `7ba5fb6` is published v0.9.11. The app reports
version `0.9.11` in its sidebar, so the version string agrees with the document while the build
behind it does not.

This is the exact class of drift `RELEASE_STATE.md` exists to prevent, and **the gate cannot catch
it**: `scripts/verify-release-state.mjs` contains no check for `owner_installed_stamp`. Every other
anchor in that block is enforced against live source; this one is enforced against nothing, because
the thing it describes is a binary on a desk rather than a file in the tree.

Two things follow, and they are separate:

1. the anchor should be corrected to what is actually installed;
2. a check should exist that reads the installed stamp, or the anchor should be marked as
   owner-attested and unverifiable — an unenforced anchor that *looks* enforced is worse than an
   absent one.

Not an incident: the owner installed #14's candidate deliberately, to review it. The defect is that
the state document was never told.

### RESOLVED 2026-08-04 — and it recurred first, which is the point

Item 1 was done at the time; item 2 was not, so the class stayed live and **drifted again**: the
2026-08-03 local ship at `c7c60d3` replaced the installed build while the anchor stayed on the
published `a1be896`, and once more nothing failed. Both are fixed now, in the order the finding
asked for:

- **Item 2 (the real fix):** `scripts/verify-release-state.mjs` check (7) reads `%LOCALAPPDATA%\Compy\compy.exe`,
  extracts every delimited 7-hex token, keeps the ones git resolves to a commit, and fails
  `INSTALLED-STAMP-DRIFT` when the surviving stamp disagrees with the anchor. It *discovers* the
  value rather than testing the claimed one, so the failure names the correct commit. It SKIPs —
  never fails — with no installed exe, no/shallow git history, an unreadable binary, or a scan that
  is empty or ambiguous, so a CI clone cannot manufacture a phantom failure.
  `scripts/verify-release-state-guard.test.mjs` pins the extraction rule (a longer hex run must not
  yield a 7-char candidate out of its middle).
- **Item 1:** the anchor now reads `c7c60d3`, and the owner-installed row states plainly that the
  desk is ahead of the fleet instead of claiming it runs the published artifact.
- Proven behaviourally, not by assertion: with the stale `a1be896` still in the file the gate exited
  1 with `INSTALLED-STAMP-DRIFT … re-stamp it to \`c7c60d3\``; after the correction it exits 0.

## Performance — recorded

> **SUPERSEDED 2026-08-05 by the section below.** The first recording — 89 samples of Compy `294db4f`,
> "single process, pid 13208" — is kept because it is a real observation, but two of its conclusions
> were wrong and both are corrected below:
>
> - **the 26.50 MB working set counted one process out of eight.** Compy is one `compy.exe` plus seven
>   WebView2 hosts, which hold ~90% of the memory. The real number is **~580 MB across the tree.** A
>   memory budget written from 26.50 MB would have been off by a factor of 22.
> - **"needs a purpose-built instrumented build" was false.** The shipped binary opens a debug port on
>   demand: launch it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` in
>   the *launching* process's environment. Every RAF/cadence/latency row marked "not measurable on this
>   build" was measurable on this build all along, against the real installed artifact — which is
>   strictly better evidence than an instrumented build would have been.

### 2026-08-05 — the recording budgets are derived from

Build `dc4d55e · release`, the installed `%LOCALAPPDATA%\Compy\compy.exe`, read back over CDP from the
app's own `get_build_stamp` rather than trusted from a filename. Probe: `scripts/q7-probe.mjs`.
Traces: everything under `docs/perf/raw/`. Transcription + budget derivations: `docs/perf/q7-baseline.json`.

**The budget table is mechanical.** `scripts/perf-budget-guard.test.mjs` re-opens each raw trace,
re-derives every value, and fails the build if this table, the baseline file, and the recordings ever
disagree — including a budget row here with no recording behind it. Q7's acceptance rule ("derived
from recorded baselines, not invented") is therefore enforced rather than promised.

| metric | recorded | budget | what it is |
|---|---:|---:|---|
| `coldStartToUsableHomeMs` | 3721 | 4500 | process spawn → Home usable, worst of 3 cold starts |
| `coldStartDocumentReadyMs` | 516 | 560 | ⚠️ **a ceiling on an open regression, not an accepted cost** — was 210 on `dc4d55e`; the shell alone, so it separates a bundle regression from a data one |
| `coldStartWorkingSetMB` | 580.06 | 660 | **whole process tree**, not the parent |
| `coldStartProcessCount` | 8 | 8 | 1 `compy.exe` + 7 WebView2 hosts; exact, not padded |
| `bootIpcCallsToFirstPaint` | 29 | 34 | complete document-start census, nothing missed |
| `idleIpcCallsPerSecond` | 1.55 | 2 | what the app costs while the user reads the screen |
| `busiestRoomIpcCallsPerSecond` | 3 | 4 | Monitor — three 1 Hz sensor polls |
| `busiestRoomRafLoops` | 1.94 | 2.5 | rAF callbacks ÷ real frames, probe's own tick excluded |
| `keepaliveRoomsIdleIpcPerSecond` | 1.47 | 1.6 | Home *after* every room is mounted behind `display:none` |
| `idleHologramDrawsPerSecond` | 0 | 0 | the `frameloop="demand"` contract, measured |
| `idleCpuPercentOfOneCore` | 3.403 | 4.5 | 10 min hands-off, no instrument attached — the ambient-backdrop cost is out of it as of `1f2ba660` |
| `idleWorkingSetMB` | 568.56 | 605 | whole tree over the same window, fresh boot parked on Home |
| `idlePrivateMB` | 432.18 | 455 | what Compy alone holds and cannot hand back |
| `roomSwitchLatencyWorstMs` | 19 | 60 | click → content, first mount measured from a fresh reload |

Each row's derivation — why *that* budget and not a rounder one — is in `q7-baseline.json`'s
`budgetBasis`, which the guard requires to be present and non-trivial. The short version of the rule
applied throughout: **budgets come off the WORST sample, never the median.** A median budget is one
the app fails half the time by construction.

Each row also carries a **`budgetKind`**, enforced by the same guard, because `budget ≥ recorded` is
the only arithmetic an earned bound and a defect ceiling have in common — and a defect that reads like
a spec is a defect nobody fixes. `upper bound` = the app earned it. `exact` = the recording *is* the
contract, any drift fails (`coldStartProcessCount`, `idleHologramDrawsPerSecond`). `open finding` = a
ceiling on a **known defect**, held so it cannot grow while the fix is queued; the guard requires such
a row to say "not an accepted cost" in words and to name both the offending file and the guard pinning
it. Exactly one row is an `open finding` today: `coldStartDocumentReadyMs`. `idleCpuPercentOfOneCore` held that status from the 2026-08-06 teardown until 2026-08-21, when its residual was finally named -- a full-window ambient layer that animated forever -- and stopped; it is an earned bound again.

**Four findings the numbers carry that no single number states:**

1. **Keepalive rooms genuinely stand down.** Home idles at 1.47 IPC/s before any other room has ever
   been mounted, and at 1.47 IPC/s after all four have been mounted and left mounted. The rooms hidden
   behind `display:none` are not polling. `keepaliveRoomsIdleIpcPerSecond` is budgeted at 1.6 —
   deliberately tight — so the first drift toward background polling fails a build.
2. **Boot's 29 IPC calls contain 7 duplicate pairs**, and `get_ledger_health` alone fires 4×. The
   budget of 34 is tight on purpose: this number should be going *down*, and a budget with room to
   grow into is a budget that licenses the duplication.
3. **The hologram's idle contract holds under measurement.** 240 GL draw calls while the scene
   settles, then 0/s — not "low", zero. That is `d557e70`'s claim, independently confirmed at the
   WebGL call level rather than inferred from process CPU.
4. **Idle Compy costs half a core, and the instrument is not why.** ⚠️ **The worst number this sweep
   produced.** 10 minutes hands-off, nothing on screen moving, no user present: **50.165% of one core**
   (3.14% of a 16-core machine). It reproduces — 50.95% with the probe attached, then **50.71% and
   50.165% on two independent *bare* runs** with no debug port, no CDP and no injected script, sampled
   through Windows' own per-process processor-time counters. The instrument costs about a quarter of a
   percentage point; the rest is the app's own. Recorded here as a **finding with a ceiling**, never as
   a baseline to design around.
   - **How far the attribution honestly goes:** the shell owns exactly **two** rAF loops
     (`src/shell-idle-guard.test.ts` asserts the set). `ReticleCursor` starts on pointer-enter and
     cancels on pointer-leave, so an unattended window costs it nothing. **`src/design/jarvis/LenisSpine.tsx`
     re-arms unconditionally** and pauses only for `document.hidden` — the only always-mounted loop
     with no stand-down at all, mounted app-wide, in every room, for the whole session. Corroborated
     by `rooms.json`: Blackbook sitting idle logs 0 IPC calls, 0 canvas draws, and **3751 rAF callbacks
     in 15 s** — a room with nothing in it, running at ~250 fps. That is not a profiler attribution of
     the whole 50%, and nothing here claims one.
   - **Why it is a guard and not a fix in this lane:** the fix changes scroll feel on a surface the
     owner has explicit UI-vision investment in, so it needs its own self-review pass rather than being
     smuggled into an accessibility sweep. What must not wait is the *class* growing —
     `src/shell-idle-guard.test.ts` freezes the population at one and fails deliberately when the
     finding is fixed, so the budget gets re-derived instead of quietly outliving the defect.
   - **Memory, and why it is only comparable at equal state:** 575.16 MB working set / 441.09 MB
     private, max over the window. This is a **fresh boot that never left Home**; the instrumented idle
     trace ran after the room sweep with every keepalive room still mounted behind `display:none` —
     roughly 80 MB more of the same app alive. Working set drifted 555.75 → 575.16 MB across the ten
     minutes; that is **observed and deliberately not called a leak**, because one run cannot separate
     it from allocator behaviour. Settling it needs max-at-10/30/60-minutes from one continuous run,
     with `idlePrivateMB` as the row that decides it: a working set that grows while private bytes hold
     flat is the OS, not the app.

## Accessibility — what was and was not checked

Recorded honestly, because a partial matrix presented as a pass is the thing Q7 forbids. Recording:
`docs/perf/raw/a11y.json`, taken against the installed build at viewport **1264 × 711, dpr 1**.

| Matrix item | Status |
|---|---|
| window at 1280×720 | ⚠️ the swept window is **1264 × 711** — close to, but not, the 1280×720 first-run default, because `tauri-plugin-window-state` restores a size the owner set. Every result below therefore holds at 1264×711; the exact 1280×720 acceptance case still needs a window-state reset to observe. |
| visible focus | ✅ **measured, no gaps.** All four rail tabs draw `2px solid rgb(46, 230, 192)` with `:focus-visible` matching, and 12 of 12 keyboard tab stops drew a visible indicator (`focusRingsMissing: []`, `tabStopsWithoutIndicator: 0`). The ring is the app-wide floor at `src/design/doorknob.css:58`; the rail defines no focus rule of its own, so this also proves the floor reaches an element that never opts in. |
| keyboard-only journey | ⚠️ partial — **12 stops, none of which was the rail.** Tabbing from `document.body` walked Home's content ("Home accent color" → "Re-run check" → "1% low" → "More in the Blackbook →" → the four hardware detail cards → the 3D/Cards tabs → Exploded/Orbit) and never arrived at navigation. Focus *visibility* is proven; focus **order** — whether a keyboard user can reach the rail at all without tabbing the whole room first, and whether a skip link exists — is not. |
| Narrator / NVDA names, roles, states | ⚠️ partial — **the tree a screen reader walks is recorded; no screen reader drove the app.** `Accessibility.getFullAXTree` per room: **0 unnamed interactive nodes in all four rooms** (23 / 26 / 27 / 17 controls, 289 / 381 / 989 / 261 total AX nodes), and the DOM control count matches the AX interactive count exactly in every room — nothing is being named by sighted guesswork alone. Rail tabs expose `role=tab` with correct `selected` state tracking the active room, as do the per-room tab pairs (3D/Cards, Live/Sessions, Basic/Advanced, Logbook/Field guide). What is still not run is a real Narrator/NVDA pass: a correct tree does not prove a *usable* announcement order. |
| 200% scaling | ✅ **measured, no gaps.** Modelled as a real OS window resize to the CSS-pixel budget 200% zoom leaves (640 × 356): **0 px horizontal overflow in all four rooms**, and 0 px at full size too. This measures reflow and clipping, which is what breaks; it does not measure raster sharpness. |
| forced colors / High Contrast | ⚠️ partial — **emulated, not the real OS mode.** Under `Emulation.setEmulatedMedia forced-colors: active`: 0 px overflow, the rail still visible, and body text still present in every room (724 / 1409 / 4376 / 1194 characters in Home / Monitor / Blackbook / Lab) — nothing vanishes. Emulation drives the media query; it does not drive Windows' system palette substitution at the compositor, so a real High Contrast pass is still owed. Natively, `forced-colors` and `prefers-contrast: more` both read false on this desk. |
| reduced motion / step-aside | ⚠️ partial — **mechanized, not swept.** `src/idle-motion-guard.test.ts` (2026-08-04) now fails the build if the `:root[data-motion="reduced"]` reset leaves tokens.css, or if any `<Canvas>` frameloop stops naming the stand-down axes. One real violation was found and fixed by it (`HardwareTourScene` painted at full rate unconditionally) and **measured**: 0 GL draw calls over ~21 s hands-off under reduced motion, 24,690 within ~2 s of flipping back. What is still **not run** is the human sweep — the app driven end-to-end with the pref on, looking for an element that reads as broken rather than merely still. **New native fact:** the shipped WebView2 reports `prefers-reduced-motion: reduce` **true** with no OS preference set, confirming under measurement why the app gates on `useReducedMotion()` rather than the raw media query — reading the query directly would ship a motionless app to every user. |
| hologram semantic equivalent | ❌ **FAIL — a real gap, found here.** Home and Lab each render a WebGL `<canvas>` with `aria-label`, `aria-labelledby`, `role`, `aria-hidden` and fallback content **all null**, and no adjacent text. A screen reader meets an unlabeled, un-ignored canvas and has nothing to say about the primary "your rig" visual. Monitor's canvas is correct — `aria-hidden="true"`, decorative, with the reading ("▼ 6:29 PM") next to it. Blackbook has no canvas. So the pattern exists in the codebase and two rooms simply do not use it. |

**Only three rows above are a pass**, and the rest are the point of recording. The two ✅ rows —
visible focus and 200% reflow — are measured across all four rooms with zero exceptions. The ❌ row is
a defect this sweep exists to find. The ⚠️ rows are each partial for a *stated* reason, and the reason
is always the same shape: the mechanism was verified, the human experience was not. A correct AX tree
is not a usable Narrator pass, an emulated media query is not Windows High Contrast, a visible ring is
not a sane tab order, and a guard proves a rule holds in code without proving the result looks right
to a person.

**The focus-ring reading came within one commit of being recorded backwards**, and that is worth
keeping. The first version of the probe called `element.focus()` from a cold eval and reported all
four rail tabs ring-less — while the same run's keyboard journey found 12 of 12 stops *with* a ring.
The app was fine; the method was not. Chromium matches `:focus-visible` on programmatic focus only
when the previously focused element already matched it, i.e. when the last real input was a keypress,
so an eval out of nowhere carries no keyboard modality and the ring correctly stays off. The probe now
dispatches a real `Tab` first and records `focusVisible` outright so the two cases stay tellable
apart (`scripts/q7-probe.mjs`, `CONTRAST_SAMPLE`). Same error class as the finding at the top of this
file: **a measurement artifact read as an app defect.**

## Next

Budgets are deliberately **not** set from a single 3-minute idle sample on one rig. The next
recording needs: a cold start, an instrumented build for RAF/cadence, a monitored session, and a
second rig. This file is the anchor those runs extend.
