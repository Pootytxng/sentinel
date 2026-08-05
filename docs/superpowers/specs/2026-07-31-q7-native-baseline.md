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

Compy `294db4f`, single process, pid 13208, up since 2026-07-30. The window was opened and navigated
(Home → Lab → Optimize → Measure & prove → Home) **during** the sample window, so this covers tray
idle and visible idle and a full room-navigation pass.

| Measure | Min | Median | Max |
|---|---:|---:|---:|
| CPU (% of whole machine) | 0.00 | **0.00** | 0.10 |
| Working set (MB) | 26.45 | **26.50** | 27.06 |
| Private bytes (MB) | 19.08 | **19.11** | 20.55 |
| Threads | 51 | 51 | 52 |
| Handles | 832 | 832 | 839 |

**What that supports.** Navigating four rooms — including Home, which renders the 3D rig hologram —
cost roughly **0.6 MB** of working set and no measurable CPU. Idle CPU never left 0.00 except a single
0.10 sample. That is consistent with the RAF being idle-parked rather than free-running, which is
what the `d557e70` holo-flicker fix claimed ("idle rest 0 draws/16s") and this independently supports
at process level.

**What it does not establish.** Q7 asks for more than this, and the gaps are named rather than
glossed:

| Q7 item | Status |
|---|---|
| idle CPU / working set | ✅ recorded above |
| active-room vs hidden-room behaviour | ⚠️ **partial** — no per-room polling delta is visible at process level; needs IPC counting |
| cold start to usable Home | ⬜ not measured — requires restarting the owner's running app |
| continuous animation / RAF owners | ⬜ not measurable on this build — the production runtime ships with **no debug port**, by design |
| 3D render cadence | ⬜ same |
| tab-return latency | ⬜ same |
| 10-minute idle + monitored-session traces | ⬜ this is a 3-minute idle sample; the monitored-session leg needs FPS capture, which needs Administrator |
| lower-spec target rig | ⬜ owner — there is one rig here |

The RAF, cadence and latency items are not laziness: they need a debug port the shipped build
deliberately does not open. Measuring them means a purpose-built instrumented build, and that is a
task, not an oversight.

## Accessibility — what was and was not checked

Recorded honestly, because a partial matrix presented as a pass is the thing Q7 forbids:

| Matrix item | Status |
|---|---|
| window at 1280×720 | ⚠️ the live window is **1100 × 613** — *below* the 1280×720 first-run default v0.9.4 shipped, because `tauri-plugin-window-state` restored a size the owner set. The 1280×720 case is therefore **untested on this desk** and needs a state reset to check. |
| visible focus / keyboard-only journey | ⬜ not run |
| Narrator / NVDA names, roles, states | ⬜ not run — needs a screen reader driving the app |
| 200% scaling | ⬜ not run |
| forced colors / High Contrast | ⬜ not run |
| reduced motion / step-aside | ⚠️ partial — **mechanized, not swept.** `src/idle-motion-guard.test.ts` (2026-08-04) now fails the build if the `:root[data-motion="reduced"]` reset leaves tokens.css, or if any `<Canvas>` frameloop stops naming the stand-down axes. One real violation was found and fixed by it (`HardwareTourScene` painted at full rate unconditionally) and **measured**: 0 GL draw calls over ~21 s hands-off under reduced motion, 24,690 within ~2 s of flipping back. What is still **not run** is the human sweep — the app driven end-to-end with the pref on, looking for an element that reads as broken rather than merely still. |
| hologram semantic equivalent | ⬜ not run |

**Nothing above should be read as a pass.** Two rows carry real facts, and both are recorded because
they contradict an assumption rather than confirm one: the window size (the 1280×720 acceptance case
cannot be observed on a machine whose window state says otherwise) and reduced motion (a scene that
checked `reduced` in every animation still paid full GPU cost, because nothing checked the render
loop). A guard proves a rule holds in code; it does not prove the result looks right to a person.

## Next

Budgets are deliberately **not** set from a single 3-minute idle sample on one rig. The next
recording needs: a cold start, an instrumented build for RAF/cadence, a monitored session, and a
second rig. This file is the anchor those runs extend.
