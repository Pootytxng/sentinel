# RELEASE_STATE history archive - the Snapshot-history banner log

> MOVED here byte-for-byte from docs/RELEASE_STATE.md on 2026-07-22 (owner token-efficiency decree).
> CURRENT STATE lives in docs/RELEASE_STATE.md; this file is the reverse-chron audit log.
> APPEND new dated UPDATE banners at the TOP, directly below this header.

### 2026-09-02 - how hosted CI's minutes were exhausted (moved out of the Hosted CI row, byte budget)

The Hosted CI row was re-worded 2026-09-02 from "settled OFF by owner decision" to "remote execution
UNAVAILABLE; the local gate is the proof authority; a green workflow status is not evidence its job
ran" (measured by `../../scripts/actions-health.mjs`). Its history moved here verbatim:

**Corrected 2026-08-10 — the old claim "workflows present but never start" was false.** The monthly
included minutes reset on 1 Aug and CI ran **111 real times in six days** (~570/month, against a
budget guard that assumed 122), exhausting them again by ~06:00 UTC on 7 Aug; every job since is
rejected before runner startup. Cause was run VOLUME from the parallel agent lanes, not per-run cost.
**GitHub's rejection annotation mentions failed payments — it is generic and wrong here:** no failed
payment, billed $0, deliberate $0 Actions budget with stop-usage on. The owner declined the spend
under the zero-budget law and directed that it never be re-asked. The full local gate set at the
time: encoding guard · release-state verifier · hook self-tests · doc budget · tsc · vitest · frontend
build · cargo test · clippy `-D warnings` · release-pipeline guards · updater-signature verify.

### 2026-08-28 - the 73b629ed desk row (the Mission 1 Test station workspace), moved verbatim

Superseded by the 090bc58b desk build, the isolated landing of Mission 2 - the Live room giving up
the automatic left margin that pushed its own subtab bar off the content grid. Moved byte-for-byte
out of the Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte cap. Nothing
re-worded, except the row's label cell and the one relative link, which is re-pointed for this
file's own directory level.

| **0.9.26 desk build, embedded stamp `73b629ed`** | **0.9.26 desk build, embedded stamp `73b629ed`** — built 2026-08-28 from the ISOLATED Mission 1 worktree `sentinel-mission1-test-workspace` on `claude/mission1-test-workspace`, installed silently via that lane's own `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`3712303522ED8695882FC57BB4EAC4B834D0779DBA6FCE0EF46086216BCD38E5`**. **Live == build proved by the embedded stamp, never an exe hash** — `73b629ed` byte-found in the INSTALLED `%LOCALAPPDATA%\Compy\compy.exe` and `380f98ca` byte-ABSENT from it (re-scanned 2026-08-28 at landing), runtime proof `73b629ed · release · shell 0.9.26`, HKCU `DisplayVersion` 0.9.26. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build's final step errors after both bundles are already written. It carries **Mission 1: the Test station you pick owns the room.** With a station open the bench aside is withheld, which is the whole layout mechanism — `RoomShell` derives its split from `aside != null` — and the overview surfaces stand down with it, leaving one compact header (Back to Test · the station's mark · its name as the room's single `<h1>` · its existing `dockLine`). Measured on the predecessor build at 1500×980 the selected station got 423px of a 1160px room; it now inherits the full room cap. No station was forked and no station's loading, NOT-YET, refusal, provenance or gating behaviour changed. Two defects were found by the installed review and fixed in the same commit: `block: "nearest"` made the landing depend on where the reader stood, at scrollTop 66 painting the only way out under the fixed chrome; and the returned-to dock row drew a focus ring that `.dock-node`'s corner-notch `clip-path` erased, fixed with a Test-scoped negative `outline-offset` (the shared rule and Health untouched). **Codex ACCEPT** at this head, landed as [#231](https://github.com/Pootytxng/sentinel/pull/231) closing [#230](https://github.com/Pootytxng/sentinel/issues/230). **PASS capture-based self-review** on the INSTALLED build at 1280×720 / 1500×980 / 1920×1080 plus `zh-CN`, Back-visibility and focus-ring captures. Its predecessor **`380f98ca`** and the whole desk lineage behind it, back to **`5e64074c`** (THE PUBLISHED BUILD), are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 73b629ed` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-28 - the 380f98ca desk row (the five-hybrid accent freeze), moved verbatim

Superseded by the 73b629ed desk build, the isolated landing of the Mission 1 Test station workspace.
Moved byte-for-byte out of the Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte
cap. Nothing re-worded, except the row's label cell and the one relative link, which is re-pointed for
this file's own directory level.

| **0.9.26 desk build, embedded stamp `380f98ca`** | **0.9.26 desk build, embedded stamp `380f98ca`** — built 2026-08-28 from the ISOLATED landing worktree `sentinel-mission0-accent-landing` on `claude/mission0-accent-landing`, installed silently via that lane's own `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`13A1FB00CB484AC2C531A9D553ED0FF4FC22124C9910AA8C01B0002731F367C7`**. **Live == build proved by the embedded stamp, never an exe hash** — `-ProofOnly -VerifyRuntime -ExpectedCommit` against the ship script, which derives the short stamp from the 40-char commit and throws on mismatch: `380f98ca · release · shell 0.9.26`, **proof attempts 2 (1 expected transient)**. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build's final step errors after both bundles are already written. It carries the owner's 2026-08-27 ruling that the **per-room accent picker offers exactly five two-colour hybrids** (Cyan / Midnight, Lime / Cyan, Violet / Teal, Magenta / Violet, Sky / Emerald); every single hue and both older duos are gone with their ten dead i18n labels in `en` and `zh-CN`. **The default and the palette are now deliberately separate** — plain violet is not a whitelisted swatch, so `readRoomAccents()` drops a stale single like `#46a8ff` and the room repaints on its default, pinned by a parameterised guard over all ten retired keys. One regression fell out of the freeze and was fixed in the same commit: apply-to-all passed the room's RESOLVED accent, which from an unpicked room is the now-unwhitelisted default and would have been silently rejected. **The lane itself is the point**: Codex accepted the change at `72f60387` on a branch 24 commits ahead of `main` carrying unaccepted Test and Health work, so it was cherry-picked ALONE onto `origin/main` `5bf84051`, its diff held to eight source paths, and merged as [#227](https://github.com/Pootytxng/sentinel/pull/227). **PASS self-review (12/12)** on the INSTALLED isolated build at native 1500×980 — one row of five duo chips, aria-checked selection, retired-value fallback to `#a78bfa` with Reset disabled, apply-to-all, reset, and visible keyboard focus driven by trusted CDP input. Its predecessor **`1703be9f`** and the whole desk lineage behind it, back to **`5e64074c`** (THE PUBLISHED BUILD), are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 380f98ca` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-28 - the 1703be9f desk row (the DIR-1 dead-code close), moved verbatim

Superseded by the 380f98ca desk build, the isolated landing of the five-hybrid accent freeze. Moved
byte-for-byte out of the Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte cap.
Nothing re-worded, except the row's label cell and the one relative link, which is re-pointed for this
file's own directory level.

| **0.9.26 desk build, embedded stamp `1703be9f`** | **0.9.26 desk build, embedded stamp `1703be9f`** — built 2026-08-26 from the PRIMARY checkout on `main`, installed silently via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`284DF0731390F506558639BD8119A28A6C5A2FEB8AB8600B661BE4AD6EE8A346`**. **Live == build proved by the embedded stamp, never an exe hash** — `1703be9f` byte-found in the INSTALLED `%LOCALAPPDATA%Compycompy.exe` and `b21bc18b` byte-ABSENT from it (scanned 2026-08-26), runtime `get_build_stamp` = `1703be9f · release`, install attempt 1. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It carries **the close of NEXT UP ② (the DIR-1 walk's dead-code finding), which was four times larger than filed**. LOCKED rule 5's "GPU sensor coverage" sentence — *NVIDIA: implemented, not yet hardware-verified* — **was not readable in any shipped build** and now renders on **MonitorConsole**, under the five-Reading sensor strip, on the segment the Monitor room opens on. The row blamed a `{!embedded && …}` gate; the line was actually OUTSIDE that gate and the whole component was dark, because `MonitorV2` answers `"live"` with `<MonitorConsole>` and only reaches `<Play>` on `"sessions"`, where `showLive` is false — so `deepMonitoring` never rendered. `MonitoringTab`, `monitor-panels.tsx` (606 lines) and `MonitorDomainCards.tsx` (333) are deleted, with a `get_fps_status` call inside the app's heaviest 1 Hz poll and an `overlay_visible` call on mount that fed only dead UI, plus 79 locale keys per language. **The guard is the finding:** `vendor-honesty-line-guard.test.ts` was green throughout because it proved "not wrapped in a condition", which is not reachability; it now walks the render ROUTE. Two further guards had the same blind spot and were re-recorded — the affordance census counted 80 unreachable strings as live affordances, the mono census described CSS in a file nothing rendered. **PASS self-review (12/12)** on the INSTALLED build at native 1500×980: coverage line 6.04:1 body / 10.51:1 on the `AMD — verified` run, `<strong>` computed `rgb(61,220,151)` from `var(--v2-ok)` (not App.css's off-palette `#4ade80`), present exactly once app-wide, Live and Sessions both intact after the deletions, zero new console exceptions. Its predecessor **`b21bc18b`** and the whole desk lineage behind it, back to **`5e64074c`** (THE PUBLISHED BUILD), are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATACompycompy.exe" -Pattern 1703be9f` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-27 - the b4bf26bc desk row (#225 Health parity, round 3), moved verbatim (row cap)

Superseded 2026-08-28 by the `090bc58b` desk build, the isolated landing of Mission 2. Moved
byte-for-byte out of the Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte
cap. Nothing re-worded, except the row's label cell and the one relative link, re-pointed for this
file's own directory level.

**Measured at move time, not assumed:** the installed `%LOCALAPPDATA%\Compy\compy.exe` byte-carries `090bc58b`,
and `b4bf26bc`, `98653732`, `72f60387` and `73b629ed` are all byte-ABSENT from it. So the desk had
already moved off this candidate before the Health lane merged `main`; the lane's own
RELEASE_STATE still named it as installed, which was stale rather than wrong when written. It is
preserved here because taking `main`'s side of that conflict would otherwise have deleted the only
copy of this row in the repository - the resolution-time content loss that an empty
`--diff-filter=D` explicitly does not bound.

| **0.9.26 desk build, embedded stamp `b4bf26bc`** | **0.9.26 desk build, embedded stamp `b4bf26bc`** - built 2026-08-27 from the worktree `compy-health-parity` on branch `claude/compy-health-parity`, installed silently via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`12B0E0333FEC6A39F3A32A3903AD02F2CB640B7425E64BDCAF2DFB91A1BE0978`**. **Live == build proved by the embedded stamp, never an exe hash** - `ship-reinstall.ps1 -VerifyRuntime` read runtime `get_build_stamp` = `b4bf26bc . release`, shell 0.9.26, 1 attempt, 0 transient. **OFF `main`, UNDISTRIBUTED**: no publish, no tag, no updater move, and the branch is not merged. **Unsigned by construction** - `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It is the **visual-parity CANDIDATE for the Health room** (issue #225). It carries round 2's two closed geometry items unchanged - the rig stage is **530 app px tall** against the comp's 530.3 (was 500) and its **top is 159** against 158.7 (was 111) - plus the fix that round 2's own self-review returned FAIL on: `.hc-readout` was clipping the CPU-temp cell, printing its label as "CPU TEM". **The defect was in the GUARD, not the geometry.** `home-console.test.tsx` held `CLIENT = 565` as the strip's width at 1280x720; measured on the installed build it is **547**, so every budget had been checked against 18px that do not exist and stayed green while the five floors (526px) over-subscribed a 515px content box. Confirmed **not** a regression from round 2 - emulating the pre-round-2 constants over CDP leaves the same overflow. The 20px is bought back from padding that carries no reading: each floor is now its own derivation (80/80/83/83, was 88 across), so 150 + 80 + 80 + 83 + 83 + 4x6 = **500 <= 515**. Nothing moves at the owner's 1500x980 or in the approved comp, where every track is above its floor and sized by its fr share; only 720p changes. **Self-review PASS on this build** - 12/12, measured at 1500x980, 1280x720, 1920x1080 and an informational 1264x711, with zero clipped cells and all five readout values on one line. Captures, composites, fingerprints and the complete remaining-differences list are persisted at `GPT HQ/operations/compy-visual-recovery-kit/` (`REVIEW_HEALTH_CANDIDATE_b4bf26bc.md`, `assets/candidate-b4bf26bc/`, `assets/shared-regression/`). **NOT VISUALLY ACCEPTED** - green gates, a self-review PASS and measured parity are evidence, not acceptance; acceptance is the owner's and Codex's. Its predecessor **`98653732`** and the whole desk lineage back to **`5e64074c`** (THE PUBLISHED BUILD) are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) - **from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-27 - the 98653732 desk row (#225 Health parity, round 2), moved verbatim (row cap)

Superseded the same day by `b4bf26bc`, which keeps every geometry number in this row and adds
one fix on top: the readout strip's width budget had been certified against a phantom 18px, so
the CPU-temp cell hung 10.7px off the strip and printed as "CPU TEM". Moved byte-for-byte out
of the Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte cap. Nothing
re-worded, except the row's label cell and the one relative link, re-pointed for this file's
own directory level.

| **0.9.26 desk build, embedded stamp `98653732`** | **0.9.26 desk build, embedded stamp `98653732`** - built 2026-08-27 from the worktree `compy-health-parity` on branch `claude/compy-health-parity`, installed silently via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`33418A2CEE5ADF68A22EB8E0036E3EA9FD836F92819F3558B06EF0014D2D847B`**. **Live == build proved by the embedded stamp, never an exe hash** - `ship-reinstall.ps1 -VerifyRuntime` read runtime `get_build_stamp` = `98653732 . release`, shell 0.9.26, 1 attempt, 0 transient. **OFF `main`, UNDISTRIBUTED**: no publish, no tag, no updater move, and the branch is not merged. **Unsigned by construction** - `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It is the **round-2 visual-parity CANDIDATE for the Health room** (issue #225), answering an independent-review verdict of ROUND 2 REQUIRED that named two approved-comp geometry gaps. Both are closed and measured on this installed build: the rig stage is **530 app px tall** against the comp's 530.3 (was 500) and its **top is 159** against 158.7 (was 111), with the stage bottom at 689 against the comp's 689.0. One new constant `--hc-comp-drop: 48px` is declared ONCE on `.hc-panel` and spent twice - as its `margin-top` and subtracted inside its `max-height` cap - so the NO BREAKPOINT law holds and the card cannot push its own bottom off-screen; at 1280x720 the cap binds at 550px and the stage lands at 334.9, above the 320px floor, with verdict, headline, primary action and stage all fully above the fold. Round 1's own measurement error is corrected too: it compared the comp's DRAWN glyph ink against the app's svg BOX, shipping a 21x22 mark; the comp's mark measures 32.9x31.9 app px, so the glyph is now `size={40}` (draws 30x32) and the row is 76.8px tall before AND after. **Four files changed and every one is Health-only** - Test / Live / History were still captured before and after, two ways: **Live 0 and History 0 differing fingerprint fields**, Test one data-driven field (`.v2-room-below` height, which takes a third value on this same build minutes later). Its pixel diff is reproduced by the same build against itself. Captures, composites, fingerprints and the complete remaining-differences list are persisted at `GPT HQ/operations/compy-visual-recovery-kit/` (`REVIEW_HEALTH_CANDIDATE_98653732.md`, `assets/candidate-98653732/`, `assets/shared-regression/`). **NOT VISUALLY ACCEPTED** - green gates and measured parity are evidence, not acceptance; acceptance is the owner's and Codex's. Its predecessor **`6bf99c8c`** (the round-1 Health candidate) and the whole desk lineage back to **`5e64074c`** (THE PUBLISHED BUILD) are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) - **from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-27 - the 6bf99c8c desk row (#225 Health parity, round 1), moved verbatim (row cap)

Superseded the same day by the round-2 Health candidate `98653732`, after independent review
returned ROUND 2 REQUIRED on this build and named two approved-comp geometry gaps (rig stage
height 500 -> 530 app px, stage top 111 -> 159). Moved byte-for-byte out of the Owner-installed
row in docs/RELEASE_STATE.md, which carries a 3000-byte cap. Nothing re-worded, except the row's
label cell and the one relative link, which is re-pointed for this file's own directory level.

| **0.9.26 desk build, embedded stamp `6bf99c8c`** | **0.9.26 desk build, embedded stamp `6bf99c8c`** - built 2026-08-27 from the worktree `compy-health-parity` on branch `claude/compy-health-parity`, installed silently via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`14EAC3C30FB1408B95DD137AA4F934E74D14033AEA4F3490924DE7B0CB10C669`**. **Live == build proved by the embedded stamp, never an exe hash** - `ship-reinstall.ps1 -VerifyRuntime` read runtime `get_build_stamp` = `6bf99c8c . release`, shell 0.9.26. **OFF `main`, UNDISTRIBUTED**: no publish, no tag, no updater move, and the branch is not merged. **Unsigned by construction** - `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It is the **first visual-parity CANDIDATE for the Health room** (issue #225), built against the approved comp as a literal contract after a measured mismatch report. Three findings answered: the latest-change banner moved out of `App.tsx` into a `latestChange` slot BELOW the fold (room content top 269 -> 110 app px); the symptom rows became flat panel cards so exactly ONE filled accent control is left in the first viewport; and the rig stopped being cropped - Health-only camera constants 10.1 / -0.48, measured 8.6% air above the case AND below the floor ring at 1500x980 and 1920x1080, 9.7%/9.7% at 1280x720, against the comp's ~8.2%. The split is now Health-scoped at `min(880px, 55.26%)` + 50px gutter (narrative 469.0, evidence 641.0, wrap 1160 - the comp's numbers). The four corner brackets and the full-page scanline are deleted. Four touched files are shared, so Test / Live / History were captured from the installed build BEFORE and AFTER and compared two ways: Test is **pixel-identical (0 px)**, History differs by 75 px (the corner clock's digits) and Live by 1 062 px (live telemetry readouts); no rect, grid, gap or aside moved in any of them. Captures, composites, fingerprints and the complete remaining-differences list are persisted at `GPT HQ/operations/compy-visual-recovery-kit/` (`REVIEW_HEALTH_CANDIDATE_6bf99c8c.md`, `assets/candidate-6bf99c8c/`, `assets/shared-regression/`). **Self-review PASS 12/12** on the installed build (separate agent): fold compliance at all three viewports, handlers and rule-5 honesty intact, Live / History / Test smoke clean, canvas idle-rest held, no stealth reversal of a prior decision, debug port torn down (`no-debug-port` CLEAN). **NOT VISUALLY ACCEPTED** - a PASS self-review is evidence, not acceptance; acceptance is the owner's and Codex's. Its predecessor **`bf88150a`** (the round-4 Test-room candidate, ACCEPTED by Codex for #224) and the whole desk lineage back to **`5e64074c`** (THE PUBLISHED BUILD) are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) - **from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-26 - the 456827bb desk row (the first-win journey), moved verbatim

Superseded the same day by the 014a3e8c desk build, which carries the two owner rulings of
2026-08-26 (#213 A1, the `©ompy` mark; #219, the counting headline). Moved byte-for-byte out of the
Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte cap. Nothing re-worded,
except the row's label cell and the one relative link, which is re-pointed for this file's own
directory level.

| **0.9.26 desk build, embedded stamp `456827bb`** | **0.9.26 desk build, embedded stamp `456827bb`** — built 2026-08-26 from the PRIMARY checkout on `main`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`E9CF426BD472244C4312B8E050CF3E0970756CDBCF39BA585C32F8EC0A4F3FB8`**. **Live == build proved by the embedded stamp, never an exe hash** — `-ProofOnly -ExpectedCommit` against the ship script: `456827bb · release · shell 0.9.26`, **proof attempts 1 (0 expected transient)**. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It carries the **first-win journey** (P2 / [#49](https://github.com/Pootytxng/sentinel/issues/49)): `FirstWin` on Home follows the user's OWN first live change from press to proof to undo — it re-reads `get_recommendations` and compares the ledger's `is_still_active` against the machine's `currently_applied`, offers the already-audited `rollback_change`, and states **no speed result**, because no play session has happened. **PASS self-review (12/12)** over six fixture states and their click sequences; verdict contrast measured **held 5.1:1**, **reverted 9.5:1** (amber, never danger), **unreadable 5.6:1**. A race was caught and guarded mid-build: reading `recs` back through a ref after the PARENT's refresh would have confirmed a REVERTED change as held, because that refresh resolves before React re-renders. Its predecessor **`5a3b5e1c`** (#213 B3 — the verdict headline measured against its real 452px column, stepping down one type level past the break), **`0fbabb93`** (#213 B5, every plane boundary drawing the comps' two-row bevel) and the desk lineage behind them — `4d65902e`, `b2b740bf`, `6c054b77`, `f223466a`, `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 456827bb` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |


### 2026-08-26 - the 5a3b5e1c desk row (#213 B3, the verdict-headline fit rule), moved verbatim

Superseded on 2026-08-26 by the 456827bb desk build (the first-win journey). Moved byte-for-byte out
of the Owner-installed row in docs/RELEASE_STATE.md, which carries a 3000-byte cap; the B3
measurement record is a point-in-time account of a finding that closed, not current desk truth.
Nothing re-worded, except the one relative link, which is re-pointed for this file's own directory
level.

| **0.9.26 desk build, embedded stamp `5a3b5e1c`** | **0.9.26 desk build, embedded stamp `5a3b5e1c`** — built 2026-08-25 from the PRIMARY checkout on `main`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`3009D704BE66D4BD19C48D21099A24DE64A61183DD63ACE1A1A23DA05D261D56`**. **Live == build proved by the embedded stamp, never an exe hash** — `-VerifyRuntime` inside the ship script: `5a3b5e1c · release · shell 0.9.26`, **proof attempts 1 (0 expected transient)**. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It carries a **PASS self-review (12/12)** and closes [#213](https://github.com/Pootytxng/sentinel/issues/213) **B3, which was RIGHT and whose rebuttal was wrong twice**: `max-width: 20ch` computes to 716px against a **452px** narrative column and never binds, and `revertedTitle_one` renders at `--type-body` in a spotlight row, not in a headline. Measured over CDP counting real line boxes, the comp's own "You're ready to play" draws **2** lines at `--type-hero`, and so does everything to 31 characters — but "Compy changes were turned back off" (34, **the state his machine was in**) drew **3** and the worst multi-flag headline drew **4**. `--type-hero` is comp-derived and **untouched**; past the measured break the headline steps down one to `--type-verdict`. Live now: `h1` 40px, **2 lines**, rect 88px, a clean 12px gap to `.v2-verdict-sub` at 244. Both branches proved by hand-setting `data-fit` and both leak checks run (long text forced to `hero` still computes 52px/3 lines; short text forced to `tight` computes 40px) — the rule is keyed to the attribute, not to text length. `0fbabb93`'s bevel is **unregressed**: `y32 rgb(7,8,10)` → `y33 rgb(27,29,33)` at rail `x=50` and content `x=800`, rail still flat `(16,19,26)` through `y81–85`. Reviewer's verdict, verbatim: *"the 52px version is visually more dramatic but pushes 'Help me with my PC' and the 'WHAT'S BEEN HAPPENING?' section down far enough that the section's body copy falls out of the 971px-tall frame entirely — the 40px/2-line trade is the correct call, not a weakened one."* Its predecessor **`0fbabb93`** (#213 B5, every plane boundary drawing the comps' two-row bevel) and the desk lineage behind it — `4d65902e`, `b2b740bf`, `6c054b77`, `f223466a`, `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 5a3b5e1c` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) | |

### 2026-08-26 - the three July release-repair rows (v0.9.9 / v0.9.10 / v0.9.11), moved verbatim (byte cap)

Moved out of docs/RELEASE_STATE.md at 41.8KB/42KB. The fleet has been v0.9.26 since 2026-08-19 and
these three rows are the July source-only-abort / abandoned-train / first-clean-publish record - a
point-in-time account of a repair that finished, not current truth about any gate. Byte-for-byte,
nothing re-worded. 3459 bytes recovered, which is what the next desk-build row will cost.

| **v0.9.9 — aborted source-only release** | **Source-tagged and installed on the owner machine, but NEVER published to the fleet because the release-repository existence probe failed closed.** The publish transaction stopped at `scripts/release.ps1` immediately after pushing the source tag: an expected GitHub 404 from the releases-repo tag probe was promoted into a terminating `NativeCommandError` by Windows PowerShell 5.1. Three stages completed (source push, source tag push, releases-main lookup); six never started (releases tag, draft, asset upload, manifest, publish, verify). **Not a public release. Not republishable** — the signed receipt, installer and stamp are bound to `664aa5e`, and the pipeline requires an exact-HEAD match. Full byte-level evidence: `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\EVIDENCE.txt`. | `gh release list --repo Pootytxng/compy-releases` · `git ls-remote --tags https://github.com/Pootytxng/compy-releases.git` |
| **v0.9.10 — abandoned; release debris DELETED 2026-07-28** | The partial train created immutable source tag `v0.9.10` at `92c7608`, pushed source `main` and that tag, created a releases-repository tag and a **private draft**, uploaded installer + `latest.json`, and installed/runtime-proved 0.9.10 locally. It was **never published to the updater fleet**, and v0.9.11 superseded it. Under explicit owner authorization the abandoned **release debris was removed**: private draft release `360948018` deleted (HTTP 204, both assets with it) and releases-repository tag `v0.9.10` deleted (HTTP 204) after confirming no release depended on it — every releases-repo tag points at the same content commit `a628c9b`, so no commit was removed and no other release was affected. **Provenance is preserved and untouched:** the source tag `v0.9.10` → `92c7608` in `Pootytxng/sentinel` still exists, as do the recovery branches and the full local evidence directory `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`. | `gh api repos/Pootytxng/compy-releases/releases --jq '[.[]\|select(.tag_name=="v0.9.10")]\|length'` (→ `0`) · `git rev-parse v0.9.10^{commit}` (→ `92c7608`) |
| **v0.9.11 — PUBLISHED (2026-07-28)** | Cut from `main` after the autonomy, native-process, resumable-transaction, simulation, and static-guard repairs, then published under owner GO. Public release id **`361056355`**, tag `v0.9.11`, `draft: false`, `prerelease: false`, published `2026-07-28T14:44:17Z`. Public installer `Compy_0.9.11_x64-setup.exe` SHA-256 **`bb2b85a43c2bf5119666f7b0709e7cee0409e0eb5ed7c4da2e4998da5438384f`**; public `latest.json` SHA-256 `6bcd6cea96bd610e8be1c44765cfc4e6f3b8c2b4e4594774251fa3cceb76b007`; both byte-match the signed receipt and the updater signature verifies against the pinned key. Releases-repository tag `v0.9.11` → `a628c9b`. The resumable transaction is **complete: 9 of 9 stages**, closing on `public_assets_verified` after the `/releases/latest/download/` aliases converged. | `gh release view v0.9.11 --repo Pootytxng/compy-releases --json id,isDraft,isPrerelease,publishedAt`. **The stage count is NOT re-verifiable — see issue #199.** Its transaction journal lived under `src-tauri/target/`, which is gitignored, so it was never committed and no longer exists on disk. Publication, assets, hashes and release identity remain provable from GitHub; the nine internal stages do not. |

### 2026-08-25 - the 0fbabb93 #213 B5 desk-build Snapshot row, moved verbatim (byte cap)

Moved out of docs/RELEASE_STATE.md when the primary checkout built `5a3b5e1c` on top of it, which
closed #213 B3 by measuring the hero headline against its real 452px column. Byte-for-byte, except
the one relative link, which is re-pointed for this file's own directory level. 0fbabb93 was never
published - a desk candidate, as `5a3b5e1c` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `0fbabb93`** — built 2026-08-25 from the PRIMARY checkout on `main`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`A9BA41250596EE1EAAD64BCE9A748E4E6942D3D8E73D7662A04F58B35DB96CE5`**. **Live == build proved by the embedded stamp, never an exe hash** — this one ran `-VerifyRuntime` inside the ship script itself: `0fbabb93 · release · shell 0.9.26`, **proof attempts 1 (0 expected transient)**. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build wrote both bundles and reported the missing key on the updater-signature step alone. It carries a **PASS self-review (12/12)** and finishes [#213](https://github.com/Pootytxng/sentinel/issues/213) B5: fixing the rail seam in `4d65902e` found the general rule — the approved comps draw **every** plane boundary as two rows, a highlight on the panel's edge and a shadow on the ground just outside it — and the app shipped only the light half. The other two plane seams now match. Measured live: titlebar boundary reads dark-then-bright going down, `y32 rgb(7,8,10)` → `y33 rgb(27,29,33)`, identical at rail `x=50` and content `x=800`, and `(7,8,10)` is the exact arithmetic of 0.35 black over `--v2-bg (10,12,16)`; the top-bar boundary carries its shadow into the **content column only** (`x=1000`: `y83` bright `(33,36,42)` → `y84` dark `(7,8,10)`), with the rail flat at `(16,19,26)` across `y82–85`, matching the comps. **Zero layout pixels added** — `.wc-bar` still `top:0 bottom:34`, `.v2-top` still `top:34 bottom:84`; the drag region and all three window buttons still respond. Honest caveat, in the reviewer's words: at native 100% on the 1484px window the ~17–20/255 delta is **subtle** — "the same subtlety as the already-accepted rail seam, not an over/under-shoot." Its predecessor **`4d65902e`** (#213 B1 titlebar plane + B5 rail seam) and the desk lineage behind it — `b2b740bf`, `6c054b77`, `f223466a`, `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 0fbabb93` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-25 - the 4d65902e #213 B1/B5 desk-build Snapshot row, moved verbatim (byte cap)

Moved out of docs/RELEASE_STATE.md when the primary checkout built `0fbabb93` on top of it, which
finished #213 B5 by carrying the same two-row bevel to the remaining two plane seams. Byte-for-byte,
except the one relative link, which is re-pointed for this file's own directory level. 4d65902e was
never published - a desk candidate, as `0fbabb93` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `4d65902e`** — built 2026-08-25 from the PRIMARY checkout on `main`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`F778D401B3365B02666C814FD47F037597DDD37560526AE6E42C175CBE68B49E`**. **Live == build proved by the embedded stamp, never an exe hash** — the self-review invoked `get_build_stamp` over the debug port and it returned `"4d65902e · release"`. (The ship script ran without `-VerifyRuntime`, so the stamp proof came from the review round rather than the installer step; the proof is the stamp either way.) **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build wrote both bundles and reported the missing key on the updater-signature step alone. **This one DOES change what he sees, unlike its predecessor**, and it carries a PASS self-review (12/12): [#213](https://github.com/Pootytxng/sentinel/issues/213) B1 — the custom titlebar no longer grounds on the violet-tinted `--ix-base` (`rgb(12,10,20)` measured before, `rgb(10,12,16)` after, matching the approved comp's own sampled `#0a0c10`) — and #213 B5 — the rail/content seam gained the dark half of its bevel (x=216 at y=600: `#0a0c10` → `#07080a`, the light hairline at x=215 unchanged). Both were filed as design DIRECTION and both turned out to be measurable deviations from the comps the owner approved 2026-08-23. Its predecessor **`b2b740bf`** (Q9a Tier-2 consent path, `.mcp.json` pin, no-telemetry tripwire — all dark/backend, no visual review claimed) and the desk lineage behind it — `6c054b77`, `f223466a`, `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATACompycompy.exe" -Pattern 4d65902e` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-25 - the 6c054b77 #214 drift-lock desk-build Snapshot row, moved verbatim (row cap)

Moved out of docs/RELEASE_STATE.md when the primary checkout built `b2b740bf` on top of it.
Byte-for-byte, except the one relative link, which is re-pointed for this file's own directory
level. 6c054b77 was never published - a desk candidate, as `b2b740bf` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `6c054b77`** — built 2026-08-24 from worktree `sentinel-home-room` (`lane/train-2026-08-22`), installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`590453966653A3A04B0F8C0924B08F5D5C28F9DA3484623AB07D0A9DD5DD96D4`**. **Live == build proved by the embedded stamp, never an exe hash** — runtime proof `"6c054b77 · release · shell 0.9.26"`, attempt 1, 0 transient. **UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build wrote both bundles and failed only the updater-signature step. **What it puts on the desk is [#214](https://github.com/Pootytxng/sentinel/issues/214), the design drift-lock:** the impeccable detector now runs INSIDE vitest over `src/` (`src/design-detector-guard.test.ts` — zero findings pinned, falsification probe, suppression census, tracked-hook pins, a version floor against npm's 3.6.0 downgrade, and the motion-law absolutes: transition-all / standalone ease-in / scale(0)); the per-edit hook moved to tracked `.claude/settings.json`, so the 2026-08-21 silent unwire cannot recur; and the findings were FIXED, not waived — spring/bounce beziers → the new `--ease-out` quint token (segmented pill, picker), border-hack triangles → clip-path glyphs (walkthrough cursor, Fix advisory chevron), `transition: all` narrowed (`.chip`, vendored Stepper), 7 files' literal beziers → tokens. **Self-review VERDICT: PASS** — full 12-item review on this installed binary at 1484×971: the picker entrance traced frame-by-frame on the live token (scaleY 0.980→1.0, translateY −1.28→0, monotonic, zero overshoot), both redrawn glyphs pixel-clean at 8× zoom, chip hover intact, `no-debug-port` CLEAN on teardown; qualified only in that this commit is one scoped increment of the lock, not the owner's full "entire design system" vision (UI_VISION_BACKLOG 🔴 stands). Its predecessor **`f223466a`** (#211/#213-A4/A5 completion) and the desk lineage behind it — `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 6c054b77` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-24 - the f223466a #211-completion desk-build Snapshot row, moved verbatim (row cap)

Moved out of docs/RELEASE_STATE.md when the same lane built the #214 design drift-lock commit
(`6c054b77`) on top of it. Byte-for-byte, except the one relative link, which is re-pointed for
this file's own directory level. f223466a was never published - a desk candidate, as `6c054b77`
still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `f223466a`** — built 2026-08-24 from the isolated worktree `sentinel-visual-2026-08-24`, installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`B48A8FAA3AFD72588FE5CD11CF91DBA48F5A851318B6A60B95B09D2A259FDF8C`**. **Live == build proved by the embedded stamp, never an exe hash** — runtime proof `"f223466a · release · shell 0.9.26"`, attempt 1, 0 transient. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move — #49 authorized implementation and verification, explicitly **not** release. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build wrote both bundles and failed only the updater-signature step. **What it puts on the desk is [#213](https://github.com/Pootytxng/sentinel/issues/213) A4/A5 and [#211](https://github.com/Pootytxng/sentinel/issues/211)**: the rail no longer summons a raw Windows tooltip repeating its own label, the titlebar no longer prints "Compy" an inch from the wordmark, and a room's one `<h1>` is its verdict alone — **in every room**, which is the part the predecessor desk build got wrong. **A2 and A3 were NOT defects** (symmetric `hud-frame.css` corners; a capture tool passing `GetWindowRect`, which includes the invisible DWM resize border, to `CopyFromScreen`), and **A1 — the wordmark reading `©ompy` — is with the owner**, because the taste decree reserves the logo. **Self-review VERDICT: PASS** — a RE-review, full and fresh on this installed binary at 1500×980, after round 1 FAILED the predecessor build and named three things: the heading was still welded in the one file that mounts when Live opens, the guard’s room list could not see that file, and Sessions measured 10px where the comps want 16. All three re-proven live here with `getBoundingClientRect` — eyebrow→heading **16px** on Live/split, Live/Sessions, Health and Test; 0 of 4 rail items carry a `title`; `no-debug-port` CLEAN on teardown. Its predecessors **`ccc17355`** (FpsTrace), **`8b1599b3`**, **`5e64074c`** (THE PUBLISHED BUILD) and the whole desk lineage behind them are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern f223466a` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-24 - the ccc17355 FpsTrace desk-build Snapshot row, moved verbatim (row cap)

Moved out of docs/RELEASE_STATE.md when the same lane landed #213 A4/A5 and #211 and built
`9c349ce6` on top of it. Byte-for-byte, except the one relative link, which is re-pointed for this
file own directory level. ccc17355 was never published - it was a desk candidate, as `9c349ce6`
still is, and it is the build that carried #49 onto `main`.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `ccc17355`** — built 2026-08-24 from the isolated worktree `sentinel-fourroom` at `feat/four-room-visual-direction`, installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`B3D55577FF6ACC0DDDF131562127527CACD6C53F7582F7BB12C26E0084C2BB4C`**. **Live == build proved by the embedded stamp, never an exe hash** — runtime proof `"ccc17355 · release · shell 0.9.26"`, attempt 1, 0 transient. **ON `main`, UNDISTRIBUTED**: landed on the trunk 2026-08-24 by this change, so `main` finally carries the bytes on his desk. #49 authorized implementation and verification, explicitly **not** release — no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build wrote both bundles and failed only the updater-signature step. **What it puts on the desk is `FpsTrace` (`c725c0a6`), the session-shape trace:** `fps_series` had been persisted for weeks with nothing reading it, and a past session now draws its own curve in Live's debrief on a real elapsed-seconds axis. Three honesty properties, proved ON SCREEN rather than from tests — a missing bucket **ends the run** (the 1229-sample session renders two visibly split runs, no line across minutes nobody watched); the axis is **anchored at 0**, so a steady session reads flat instead of as a fabricated cliff; a gap-isolated sample becomes a **dot**, the one property this desk's three real sessions cannot produce, verified in `geometry.ts` and recorded as a real-data limit rather than claimed. `1916cca0` rides with it: the gap label shipped on `--status-attention`, which would have made **amber mean two things** against COLOR-1; it is `--muted` now and the installed binary computes `rgb(139,147,167)`. **Self-review VERDICT: PASS** — round **18**, full and fresh on this installed binary at the owner's 1500×980: stroke `#A78BFA`, gap/peak text 6.04:1 on panel, axis labels ~1000px clear at real width, `aria-label` resolving real numbers ("peak 288 fps over 13m"), one mount only, `no-debug-port` CLEAN on teardown. **One out-of-scope flag, not a defect of this diff:** the pre-existing Live `<h1>` still concatenates its eyebrow with a dynamic sentence. Its predecessor **`8b1599b3`** (Codex findings 1–3, round 17) and the desk lineage behind it — `0c550138`, `d5a6a630`, `701c2113`, **`5e64074c`** (THE PUBLISHED BUILD) and every build before them — are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern ccc17355` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-24 - the 8b1599b3 Codex-findings desk-build Snapshot row, moved verbatim (row cap)

Moved out of docs/RELEASE_STATE.md when the same lane's `FpsTrace` commit (`ccc17355`) was built,
installed and self-reviewed, becoming the owner-installed build. Byte-for-byte below; its one
relative link was rewritten from `archive/RELEASE_STATE_HISTORY.md` to `RELEASE_STATE_HISTORY.md`
for this file's own directory level, which is the only edit. 8b1599b3 was never published - it was
a desk candidate, as `ccc17355` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `8b1599b3`** — built 2026-08-23 from the isolated worktree `sentinel-fourroom` at `feat/four-room-visual-direction`, installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`32C7A35422420E5E2313227174F92AAEFCFCFF8E1315A943E6AB96425C850065`**. **Live == build proved by the embedded stamp, never an exe hash** — runtime proof `"8b1599b3 · release · shell 0.9.26"`, attempt 1, 0 transient. **UNPUSHED and UNDISTRIBUTED**: issue #49 authorized local implementation and its verification, explicitly not release. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build wrote both bundles and then failed only the updater-signature step; a publish re-cuts from `main` with the key. **What it adds over its predecessor is not visual:** it merges `main` (`b6727dfc`, zero app-code change — `git diff 39c57201 7dc87947 -- src/ src-tauri/` is empty) and lands Codex findings 1–3 — check (9), the Bottom-line desk-stamp guard, plus three literal `var()` fallbacks removed from the console layer. **Self-review VERDICT: PASS** — round **17**, a full fresh round on this installed binary at the owner's 1500×980. Proof: all three removals are computed-style no-ops (`.ag-warn` stroke `rgb(245,197,66)`, `.ag-good` `rgb(70,217,138)`, `.ag-tag-ny` amber on amber, `.hud-frame-readout` still resolving a monospace family), Home's `.v2-verdict` computes `column`/`nowrap` with all three children inside the parent's 721.609px right edge, h1s measure **Home 52 · Live 40 · History 40 · Test 52** (the guard's own comp reading, `comp-fidelity-guard.test.ts:300`; round 16's row recorded those four numbers in the wrong room order), 6/6 Test station subtitles verbatim, zero `HudMasthead` left in `src/`, `no-debug-port` CLEAN on teardown. **Two carry-forwards, neither a defect:** `.ag-warn`/`.ag-good` are unreachable in the app — no caller passes `tone="warn"/"good"` — so that pair is provable only by injection; and WebView2's viewport refused to follow an OS resize, so 1280×720 / 1920×1080 were not re-measured this round. Its predecessor **`0c550138`** (slices 5–7, round 16 PASS) and the whole desk lineage behind it — `d5a6a630` (C-14), `701c2113`, **`5e64074c`** (THE PUBLISHED BUILD) and every build before them — are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 8b1599b3` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-23 - the 0c550138 four-room slice-5–7 desk-build Snapshot row, moved verbatim (row cap)

Moved out of docs/RELEASE_STATE.md when the same lane's guard commit (`8b1599b3`) was built and
installed, becoming the owner-installed build. Byte-for-byte below; its one relative link was
rewritten from `archive/RELEASE_STATE_HISTORY.md` to `RELEASE_STATE_HISTORY.md` for this file's own
directory level, which is the only edit. 0c550138 was never published — it was a desk candidate,
as `8b1599b3` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `0c550138`** — built 2026-08-23 from the isolated worktree `sentinel-fourroom` at `feat/four-room-visual-direction`, installed silently via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`8C8DC1DDC0C6F8A6F4FC35B2622DE706FAE4AEC749EFA596291FF76DB71DB0C8`**. **Live == build proved by the embedded stamp, never an exe hash** — `get_build_stamp()` returned `"0c550138 · release · shell 0.9.26"` on attempt 1. **This commit is UNPUSHED and UNDISTRIBUTED**: issue #49 authorized local implementation and its verification, explicitly not release. **What it puts on the desk is slices 5-7 of the approved four-room direction** — History as a document (`c894e81c`), the Test room's approved composition (`8c9fb804`), and the convergence pass that closed two **cascade ties** — the correct rule sat in `shell-v2.css` while a later same-specificity rule beat it, so Health's because-line rendered outside its own column and three headlines were sized 26px against comps that measure 52 and 40 — replaced Test's platform emoji with the comp's six measured line marks (violet on the primary row alone), took the comp's wording for its row subtitles, and collapsed four drifted room eyebrows into one. **Self-review VERDICT: PASS** — round **16**, measured at the owner's 1500×980, with 1280×720 and 1920×1080 spot-checked, against all four comps. Proof: Health's verdict computes `column`/`nowrap` with every child inside the parent's 721.6px right edge (round 15: 749.6, clipped behind the rig), h1s **52 · 52 · 40 · 40** and all four `.v2-verdict-sub` **15px**, 6/6 station subtitles verbatim, the eyebrow→headline gap 16px in all four rooms, the green/amber/violet ladder intact and pinned by `comp-fidelity-guard.test.ts` (34/34), zero `HudMasthead` references left in `src/`, and `scripts/no-debug-port.mjs` CLEAN on teardown. Its predecessors **`67ce2724`** (slice 4, round 13), **`acdb93c2`** (slice 3, round 12), **`40aca1ca`** (slice 2, round 11 after ten FAILs and eleven permanent guards), **`d5a6a630`** (C-14) and the desk lineage — `701c2113`, `36011078`, `1f2ba660`, `584654c8`, `63db50d2`, `8ba6a6d1`, `0808e33e`, `ab54f1e4`, `1d5b3c4c`, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` — are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 0c550138` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

### 2026-08-23 - the 40aca1ca Health-slice desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the four-room shared-instrument slice (`acdb93c2`) reached
the desk and became the owner-installed build. Byte-for-byte below; its one relative link was
rewritten from `archive/RELEASE_STATE_HISTORY.md` to `RELEASE_STATE_HISTORY.md` for this file's own
directory level, which is the only edit. 40aca1ca was never published — it was a desk candidate,
as `acdb93c2` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `40aca1ca`** — built 2026-08-23 by `npm run tauri build` from the isolated worktree `sentinel-fourroom` at `feat/four-room-visual-direction` (`40aca1ca`), installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`0BF57CD0770791114D2C5444DA14447F78CF6B06F8BAFA3C5A50DCDFA097C79B`**. **Live == build proved by the embedded stamp, never an exe hash** — `get_build_stamp()` returned `"40aca1ca · release"` on attempt 1. **This commit is UNPUSHED and UNDISTRIBUTED**: issue #49 authorized local implementation and its verification, explicitly not release. **What it puts on the desk is slice 2 of the approved four-room direction — the Health room's instrument panel**: the real 3D rig over a five-cell readout (readiness ring · AVG FPS · 1% LOW · GPU TEMP · CPU TEMP), rebuilt as ONE fluid composition with **no breakpoint** — the panel caps itself against the viewport, only the stage shrinks, no readout track is sized by its content, and the five readings subgrid onto one shared set of rows so a label that wraps in any language cannot move its own value. Absent readings still render `— —` plus "no CPU temp — see below", never a zero. **Self-review VERDICT: PASS** on this installed build at 1280×720, the owner's 1500×980 and 1920×1080 — round **11**, after ten consecutive FAILs that left eleven permanent guards. Headline proof: all four `.hc-read-v` rect tops identical at every size (588.875 ×4 / 698.15625 ×4), `gridTemplateRows` reporting live `subgrid`, `.hc-panel` never clipping (`scrollHeight == clientHeight`). Its predecessor **`d5a6a630`** (C-14's Lab GPU advisory panel + the armed entry write-refusal, 2026-08-22, installer SHA-256 `AABCED03…D2417`, its own 11/11 PASS) and the whole desk lineage behind it — `701c2113`, `36011078`, `1f2ba660`, `584654c8`, `63db50d2`, `8ba6a6d1`, `0808e33e`, `ab54f1e4`, `1d5b3c4c`, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` — are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 40aca1ca` · HKCU uninstall `DisplayVersion` |

### 2026-08-23 - the d5a6a630 C-14 desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the four-room Health slice (`40aca1ca`) reached the desk
and became the owner-installed build. Byte-for-byte below; its two relative links were rewritten
from `archive/RELEASE_STATE_HISTORY.md` to `RELEASE_STATE_HISTORY.md` for this file's own
directory level, which is the only edit. d5a6a630 was never published — it was a desk candidate,
as `40aca1ca` still is.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `d5a6a630`** — built 2026-08-22 by `npm run tauri build` from the primary worktree `sentinel-home-room` at `lane/train-2026-08-22` (`d5a6a630`), installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`AABCED03DA5033289732A9D2AD8EA7AB730317362C636948A95BE510380D2417`**. **Live == build proved by the embedded stamp, never an exe hash** — `get_build_stamp()` on the installed binary returned `"d5a6a630 · release"`. **What this build puts on the desk is C-14:** the finished-but-mounted-nowhere `GpuProfile` surface is now a live advisory panel in the Lab room (sibling between the Ops Console and the Experiment Bench), fed by `liveGpuProfileSnapshot()` from real hardware — vendor/model/driver read, and `powerModeLabel`/`peakTempC` **permanently null by design** (AMD profile state is not user-mode readable; peak temp belongs to a monitored session the Lab does not hold), rendering as `—` and never as an invented value. Advisory forever under LOCKED rule 6 — apply is structurally impossible, so rollback-first cannot be satisfied. **Self-review VERDICT: PASS** on this installed build (11/11, stamp confirmed live): scope radiogroup flips both ways, capture-before/after wrote real values to localStorage only (**zero Windows writes across every interaction tested**), delta table showed "No changes between these two snapshots." with Power mode and Peak GPU temperature both `—`, empty state reads "Capture a before snapshot to begin.", contrast measured on real tokens, no duplication of any existing Lab copy, no overlap or clipping against either sibling, debug port torn down clean. Its lineage — `701c2113` (the ambient-idle-CPU fix reaching the desk), `36011078`, `1f2ba660`, `584654c8` and every desk build before them — is byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). byte-preserved with **`63db50d2`**, **`8ba6a6d1`**, **`0808e33e`**, **`ab54f1e4`**, **`1d5b3c4c`**, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 36011078` · HKCU uninstall `DisplayVersion` |

### 2026-08-21 - the v0.9.25 and v0.9.24 GO/NO-GO records, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the ANSWERED 2026-08-21 slowdown record landed and pushed the
file over both its line and byte budgets. Byte-for-byte: the block contained no markdown links, so
nothing needed re-rooting one directory deeper. Both transactions were closed 9 of 9 on 2026-08-13.
The half of the v0.9.25 entry that stayed live is its slowdown report, which RELEASE_STATE.md now
answers with measurement instead of carrying forward as an open warning.

2. **Candidate v0.9.25 publish GO/NO-GO - CLOSED 2026-08-13, published 22:34Z, transaction 9 of 9.**
   (Date-first, no zulu suffix, per #123.) Two defects neither the suite nor a reviewer caught, both
   found by people: the owner reported v0.9.24 "runs a lot slower than before", and tester Jaikaran
   reported on v0.9.12 that written feedback vanishes when he leaves Settings - still reproducible in
   v0.9.24 source. `36d3a0c7` fixes both. The update-pill LED animated `box-shadow` forever in the
   shell topbar, in the update-AVAILABLE branch that is every out-of-date tester's resting state, so
   the main thread repainted every frame on every screen; it now rides an `::after` layer on
   transform+opacity. The feedback draft now persists through safe-storage and survives the Settings
   unmount. Both guards were proven able to FAIL by reintroducing each defect before the fix landed.
   The owner's GO for this lane was "lets get as much of the important stuff done that we can and
   the update sent to the testers", and both look captures went to him before the publish ran.
   Release id `370249321`, alias attempt 1; `published_*` above carries the artifact truth.
   **What this release does NOT close: the owner's own slowdown report.** He is on the newest build,
   so his update pill never enters the AVAILABLE state and never pulsed - the fix cannot be the
   cause of what he felt. That remains open with ranked candidates (the app-wide switch to the
   bundled Geist variable font plus the 14px->15px base bump is the best fit) and a named tool to
   settle it: `node scripts/q7-probe.mjs attribute`. Do not report it as fixed.
2. **Candidate v0.9.24 publish GO/NO-GO - CLOSED 2026-08-13, published 21:29Z, transaction 9 of 9.**
   (Date-first, no zulu suffix, per #123.) The owner's GO was "send out the most current working
   version of the app to the tester"; both look captures, the runtime proof and the note that the
   FIRST look had failed went to him before the publish ran, and the alias verified on attempt 1.
   `published_*` above carries the artifact truth. This also closed **v0.9.22's** GO, which was
   still open when UX-1 superseded it. Kept here for the record — it was
   the cumulative front-door candidate. It carries design-foundation **step ②, UX-1** (the Home h1 is
   now the verdict at 40px, the room title "Home" is deleted, the because-line moved directly
   beneath it, and "What are you here to do?" became the screen's single primary button opening the
   intent panel in place) **on top of everything v0.9.22 already held**: step ① TYPE-1 (six-step
   type scale, 13px floor) + COLOR-1 (rooms give up their hue), the update-pill attention state,
   the in-app What's-new list, and the arc-gauge ring-overflow fix the v0.9.19 desk look caught
   (`64fe3579`). **v0.9.22 was never published** — it was installed, proved and visually reviewed
   PASS on the desk, and its GO was still open when UX-1 landed, so this candidate supersedes it
   and one GO now covers both. **v0.9.23 is desk-only and spent: it shipped UX-1 and the look
   FAILED on the verdict's type step** (a `home-hud.css` selector outranked the console's own h1 —
   see the owner-installed row); the fix plus its static guard ride v0.9.24, and v0.9.23 is never
   published. v0.9.19 is desk-only and spent; **0.9.20 and 0.9.21 were burned by failed
   re-prepares** (each prepare mints configured+1 — a re-prepare after a failure must pre-declare
   the NEXT number, not reuse one; nothing of 0.9.20/21 was installed or published). Desk ship +
   visual review first; publish only on an explicit owner GO given to exactly ONE lane.

### 2026-08-21 - the 584654c8 Test-pass desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the 1f2ba660 build (the ambient-backdrop idle fix) landed
the same day. Byte-for-byte except the two relative links that would break one directory deeper:
the `docs/`-relative path now starts with `../`, and the self-link to this file is a plain span,
the same exception the 835d8868 move below records. Nothing else in the row was touched.

| Gate | State | Proof |
|---|---|---|
| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `584654c8`** — built 2026-08-21 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/rooms-test` (`584654c8`), installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`7CE9812568522D4D52B449C8AA439C1368E59DE1B0991CFE304EAE1D808226D9`**. **Live == build proved by runtime probe, never an exe hash** — runtime proof `584654c8 · release · shell 0.9.26`. **This binary carries the third and last instrument-room intimidation pass — Test** ([UI_VISION_BACKLOG.md](../UI_VISION_BACKLOG.md) ⭐ STANDING DIRECTIVE; Home 2026-08-06, History `8ba6a6d1`, Live `63db50d2`): the station dock says where to start (a sans "Start here" over Optimize and one plain when-line under the row that follows hover / the open station; both opt-in `Dock` props, Home's dock byte-identical, guarded); the safe-stack gauge reads "N on · = all N applied" on a full ring once nothing is left, instead of "0 ready" on an empty one (NOT-YET while recs load, unchanged); the bench opener is "Test one change" plus one 25-word sentence of what Compy does (was "Controlled experiments" plus 44 words, guarded ≤ 30), the retired "never promises" line gone per the reframed honest-measurement law. Left open on purpose: "Your rig" still repeats Health's numbers (needs new data wiring, not a layout move). **Self-review VERDICT: PASS** on this installed build (round 1, 10/10 — native 1484×971 capture; eyebrow 6.8:1, caption 6.1:1, note 4.9:1 on the real tile ground; caption one line 11 px under the node row and 54 px above the bench; hover / open / close cycle follows the station with 0 console errors; Safe stack reads 8 on · = all 8 applied on a full ring (8 of the 12 applied changes are severity safe); Home's dock has no eyebrow / caption, Health / Live / History unmoved; shots `ui-sweep/shots/test-after/`, before in `ui-sweep/shots/rooms-before/`). It supersedes desk build **`63db50d2`** (the Live pass, #189), byte-preserved with **`8ba6a6d1`**, **`0808e33e`**, **`ab54f1e4`**, **`1d5b3c4c`**, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 584654c8` · HKCU uninstall `DisplayVersion` |
### 2026-08-21 - the 63db50d2 Live-pass desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the 584654c8 build (the Test intimidation pass) landed the next morning.
Byte-for-byte except the two relative links that would break one directory deeper: the `docs/`-relative
path now starts with `../`, and the self-link to this file is a code span, the same exception the
835d8868 move below records. Nothing else in the row was touched.

| Gate | State | Proof |
|---|---|---|
| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `63db50d2`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/rooms-live` (`63db50d2`; the product changes are `0345f564` + `63db50d2`), installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`2C000748934FEE4EE883636D5495D5F057B3EB3D90A0D26B447AFEBC7D0B935E`**. **Live == build proved by runtime probe, never an exe hash** — runtime proof `63db50d2 · release · shell 0.9.26` on the first attempt, 0 transient retries. **This binary carries the second instrument-room intimidation pass — Live** ([UI_VISION_BACKLOG.md](../UI_VISION_BACKLOG.md) ⭐ STANDING DIRECTIVE; Home 2026-08-06, History `8ba6a6d1`, Test is next): the deck's debrief under the frametime scope was one all-caps mono string that wrapped mid-thought and is now a template — a plain sentence, three boxed value cells (Avg FPS / 1% low / Spikes), one caveat line — at 19 words against the 21 it replaced (guarded ≤ 21); both empty scopes say "Press Start capture, then play — the line draws here." under the no-signal eyebrow (`Oscilloscope` `emptyHint`, omitted = unchanged for every other caller); the four readouts are a fixed 2×2 instead of an auto-fit that orphaned SPIKES. `63db50d2` on top trims the two caveats the first review measured at +68% words. **Self-review VERDICT: PASS** on this installed build (round 2, 10/10 — native 1500×980 capture; hint 6.04:1 and caveat 6.83:1 on the real tile ground; three cells one row at 1500 and 1100 px; hero hollow 119 px, was ~200; Health / History / Test unchanged; shots `ui-sweep/shots/live-after/`, before in `ui-sweep/shots/rooms-before/`). It supersedes desk build **`8ba6a6d1`** (the History pass, #188), byte-preserved with **`0808e33e`**, **`ab54f1e4`**, **`1d5b3c4c`**, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` in `archive/RELEASE_STATE_HISTORY.md` (this file). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 63db50d2` · HKCU uninstall `DisplayVersion` |

### 2026-08-20 - the 8ba6a6d1 History-pass desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the 63db50d2 build (the Live intimidation pass) landed the same night.
Byte-for-byte except the two relative links that would break one directory deeper: the `docs/`-relative
path now starts with `../`, and the self-link to this file is a code span, the same exception the
835d8868 move below records. Nothing else in the row was touched.

| Gate | State | Proof |
|---|---|---|
| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `8ba6a6d1`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/rooms-intimidation` (`8ba6a6d1`; the product changes are `fcc957b2` + `8ba6a6d1`), installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`19B8171703F6F02BE49DF841C115BD25F3827D9515A8DA5813D6A3F145D880FE`**. **Live == build proved by runtime probe, never an exe hash** — runtime proof `8ba6a6d1 · release · shell 0.9.26` on the first attempt, 0 transient retries. **This binary carries the first instrument-room intimidation pass — History** ([UI_VISION_BACKLOG.md](../UI_VISION_BACKLOG.md) ⭐ STANDING DIRECTIVE; Home had the pass 2026-08-06, Live and Test are next): the record is grouped by calendar month (`groupByMonth` in `src/surfaces/blackbook/logbook.ts`), mounts an 8-row screenful with an honest "show N older records" press (was 30, which stretched the two left tiles into hollow columns three viewports tall — measured 0 px hollow now), the row is two grid tracks with the timestamp on the title's line so it can no longer overrun the title (it did on every row of the previous build), the undo door says "Undo any of the 12 changes in Test", and the shell-wide HUD readout fades the scroll lane out under itself instead of colliding with it. `8ba6a6d1` on top fixes what the first self-review caught: a BentoTile title now never wraps and the badge shrinks (`bento-tile-head-guard.test.ts`). **Self-review VERDICT: PASS** on this installed build (10/10 — native 1484×971 capture; month heads 4.9:1 on the real tile ground; 0 title×timestamp intersections across 19 rows; hero vs left-column hollow 0 px; both filter states one-line headers flush right; Health and Test tile headers unmoved; shots `ui-sweep/shots/history-after/`, before in `ui-sweep/shots/rooms-before/`). It supersedes desk build **`0808e33e`** (design foundation ⑤, the rail door, #187), byte-preserved with **`ab54f1e4`**, **`1d5b3c4c`**, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` in `archive/RELEASE_STATE_HISTORY.md` (this file). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 8ba6a6d1` · HKCU uninstall `DisplayVersion` |

### 2026-08-20 - the 0808e33e rail-door desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the 8ba6a6d1 build (the History intimidation pass) landed the same evening.
Byte-for-byte except the three relative links that would break one directory deeper: the two
`docs/`-relative paths now start with `../`, and the self-link to this file is a code span, the same
exception the 835d8868 move below records. Nothing else in the row was touched.

| Gate | State | Proof |
|---|---|---|
| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `0808e33e`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/rail-door` (`0808e33e`; the product change is `05df064f`), installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`190B0996DA7911B2B739925D9DFFC8C01FA5491F3EA83C6D2F86CD3D8E8CAB67`**. **Live == build proved by runtime probe, never an exe hash** — runtime proof `0808e33e · release · shell 0.9.26` on the first attempt, 0 transient retries. **This binary carries design foundation ⑤ — instruments behind a door** ([UI_VISION_BACKLOG.md](../UI_VISION_BACKLOG.md) FOUNDATION-1; decision 6 of [decisions/2026-08-11-design-foundation.md](../decisions/2026-08-11-design-foundation.md)): the rail is no longer four equal tabs — **Health** stands alone as the front door at full weight and **Live · History · Test** sit under a "Look deeper" sign at the rail's base weight with quieter glyphs, separated by a rule. Grouped, never hidden (the 2026-08-06 no-toggle directive): every room stays rendered and clickable and keeps its global digit. `railGroups()` in `src/design/homeRail.ts`, two tablists in `ShellV2.tsx` (the second labelled by the sign via `aria-labelledby`), `.v2-nav-door` / `.v2-nav-instruments` in `shell-v2.css`; guards `homeRail.test.ts` §railGroups + `ShellV2.test.tsx` §"front door plus a signed group". **Self-review VERDICT: PASS** on this installed build (10/10 — native 1500×980 capture; instrument labels 6.04:1 and the sign 4.88:1 computed against the real rail background; all four rooms rendered, clickable, aria-selected moving, digits 1–4 live; 5-leg rail switch 16.7–22.9 ms; shots `ui-sweep/shots/rail-door/`). It supersedes desk build **`ab54f1e4`** (the comprehensibility sweep, #180), byte-preserved with **`1d5b3c4c`**, `75849be1`, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` in `archive/RELEASE_STATE_HISTORY.md` (this file). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATACompycompy.exe" -Pattern 0808e33e` · HKCU uninstall `DisplayVersion` |

### 2026-08-20 - the ab54f1e4 comprehensibility-sweep desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the 0808e33e build (design foundation ⑤, the rail door) landed.
Byte-for-byte except the three relative links that would break one directory deeper: the two
`docs/`-relative paths now start with `../`, and the self-link to this file is a code span, the same
exception the 835d8868 move below records. Nothing else in the row was touched.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `ab54f1e4`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/sweep-180` (`ab54f1e4`), installed silently by Claude via `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`DAE0CC2FB3AFE566C09D78F0C75AE13E82A8D12235E8509E6CA1CF5EE09F8341`**. **Live == build proved by runtime probe, never an exe hash** — runtime proof `ab54f1e4 · release · shell 0.9.26` on the first attempt, 0 transient retries. **This binary carries the 2026-08-20 comprehensibility sweep** (issue [#180](https://github.com/Pootytxng/sentinel/issues/180), plan [superpowers/plans/2026-08-20-comprehensibility-sweep.md](../superpowers/plans/2026-08-20-comprehensibility-sweep.md)): **§A one Live face** (MonitorBasic deleted — the Live/Sessions segments are the one way over), **§B one switch per real choice** (the "Live console" and "JARVIS motion" rollout switches retired from Settings), **§C the Home header the owner asked for** — the front door rides the RIGHT END of the verdict line and the flagged check's fine-print paragraph leaves the header entirely (the headline still names the check; the band routes "Fix in Test →"), per his "Clean header" pick — and **`compy_home_interview` now DEFAULT ON** per his answer in [decisions/2026-08-20-home-interview-default.md](../decisions/2026-08-20-home-interview-default.md) §OWNER ANSWERED, flipped only AFTER the placement fix passed review (his stated condition), plus **§D guards** (`monitor-one-face-guard`, `settings-no-rollout-switch`, and the attention-fine-print pin in `home-console.test.tsx`). **Self-review VERDICT: PASS** (10/10 — button bottom-aligned to the 40px headline, measured via getBoundingClientRect at 1500×980 and 1100px; attention header carries no paragraph; the "0" opt-out leaves no stray gap). It supersedes desk build **`1d5b3c4c`** (design-foundation step ③ — the interview behind the then-DEFAULT-OFF flag, self-review PASS after the round-1 rubric-10 FAIL whose record its row preserves), byte-preserved with **`75849be1`**, `835d8868`, `aac90cd7`, `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), `75880de1`, `2f79febb` and `7f151d2c` in `archive/RELEASE_STATE_HISTORY.md`. | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern ab54f1e4` · HKCU uninstall `DisplayVersion` |


### 2026-08-20 - the 835d8868 / aac90cd7 desk-build Snapshot row, moved verbatim (byte budget)

Moved out of docs/RELEASE_STATE.md when the 75849be1 build landed and the file sat 670 bytes under
its 48KB ceiling. Byte-for-byte, including the win-shimmer and control-font self-review records and
the #156 lying-silent-install account. Current state keeps only the live desk build. **One
deliberate exception to byte-for-byte, so the claim stays true:** the row ended with a link to
`archive/RELEASE_STATE_HISTORY.md`, correct while it lived in `docs/` and broken the moment it
moved INTO `docs/archive/`. `scripts/markdown-link-guard` caught it in the push gate. It is now a
code span naming this file, and nothing else in the row was touched.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `835d8868`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `main`-equal `835d8868`, where PR [#165](https://github.com/Pootytxng/sentinel/pull/165) landed, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`03DC72E02BF3CAD2EB283F8CA943010A35BEE0BFBB54F1E340BA22429DF36243`**. **Live == build proved by byte-scanning the installed exe for the embedded stamp** — `STAMP FOUND 835d8868`; an exe hash is not proof here, because NSIS packaging leaves the installed binary not byte-identical to `target/release/compy.exe`. It carries **the kernel law's one earned celebration, firing for the first time.** The owner's 2026-06-06 law — a measured FPS win makes the improved bar sweep once, and nothing else in Compy ever sweeps — had exactly one implementation, `@keyframes cmp-winshimmer` on `.cmp-improved.arc-v2 .cmp-bar-after`, behind a prop no screen ever set; it was unreachable from the day it was written and `src/sweep-guard.test.ts` stayed green throughout because it asked whether the keyframe existed, never whether anything could run it. Re-homed to the live selector, and the guard gained the missing tier: **every compound in the sweep's selector must be producible UNCONDITIONALLY by one `className` expression** — falsified before it was trusted. Two self-review FAIL findings were fixed rather than argued: `overflow: hidden` on a **text box** clipped a 3-digit value at the 24px `min-width` floor (`999` → `99`), so the glint now travels by `background-position` inside a stationary overlay; and the guard's `/shimmer|sheen/` name match was blind to `v2-foil-pan` and `v2-hud-sweep`, so it now also catches any keyframe body animating a `background`/`mask` position — which found two more. The resulting five-entry allowlist is an in-lane adjudication with reasoning per entry (the law bans a second *celebration*, not every moving pixel), and the owner holds the veto via `docs/ui-sweep/win-shimmer-before-after.html`. **Self-review VERDICT: PASS** (10/10 at 1500x980) on installed build `ae5ff500`, the immediately-preceding tip of the same work: `git diff ae5ff500 835d8868 -- src/ src-tauri/` is **empty**, so the reviewed binary and this one are the same product tree, and `ae5ff500` is preserved as tag `preserve/win-shimmer-pre-restack-ae5ff500`. It supersedes desk build **`aac90cd7`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/control-font-reset` (`aac90cd7`), installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`9FEDF06EA7BC60F122C3C953802C1EAA2C45D3B83AE8AA44127C7AAFBC40FD92`**. **LIVE-proved by `scripts/ship-reinstall.ps1 -ProofOnly -ExpectedCommit`** — runtime proof `aac90cd7 · release · shell 0.9.26`. **The first silent install lied:** `/S` returned exit 0 and rewrote the Desktop shortcut but never replaced the installed exe; the stamp gate caught it (`INSTALLED-BINARY STALE`, `scripts/ship-reinstall.ps1:213`) and an identical re-run succeeded. Filed as **#156** — the gate must not be loosened to make this quieter. It carries the **control-font reset** (#155): one unscoped `button, input, select, textarea { font-family: inherit }`, because form controls never inherit the page font and fall through to the UA face. Scope was **3x the original finding — 97 of 290 `<button>` sites across 28 files** got a family from no rule at all, not 26 across 11. Guard written FIRST per bug→guard: `src/control-font-guard.test.ts` asserts the reset is present, unscoped, top-level and in a sheet the app loads, and checks the class on its real subject — every button must get a family from something. **Self-review VERDICT: PASS** on THIS installed binary (9/9, captured at 1500x980; stamp confirmed two ways — `get_build_stamp` probe and the Settings/About tile) — Share/`.btn-small` and `.debrief-ctx-head` both compute `Geist Sans` at unchanged size and weight, hover state intact under real CDP mouse events, and a sweep of Health/Live/History/Test/Settings found zero overflowing controls. **Desk HEAD is one commit ahead of this build** — `176d847c` deletes 184 lines of arc-skin CSS whose classes no component can render (`src/arc-v2-reachability-guard.test.ts` is the proof), so it changes nothing on screen and did not earn a rebuild. Older desk builds — **`402b0080`** (the four-merge desk lag: C-17b, C-18, C-18b, C-13; self-review PASS 10/10, two findings recorded rather than engineered around — one of them the `.btn-small` Arial defect the build above then fixed), **`40682344`**, **`5e64074c`** (THE PUBLISHED BUILD), **`75880de1`** (where the #127 idle-CPU fix was proved), `2f79febb` and `7f151d2c` — are byte-preserved in `docs/archive/RELEASE_STATE_HISTORY.md` (this file). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern aac90cd7` · HKCU uninstall `DisplayVersion` |

### 2026-08-20 - the v0.9.18 -> v0.9.11 published-release chain, moved verbatim (byte budget)

Moved out of the "Latest PUBLISHED release + source commit" row on the same ship. Current state
keeps only the latest published release and points here for the chain.

It supersedes **v0.9.18**, source `cfc0c4b7`, release id **`369720195`**, published `2026-08-13T06:57:36Z` under owner GO (chat, 2026-08-12 ~23:45 PT). Installer SHA-256 `61acde41dce19554a93644177435c38ca89f9bf470f513c8fdb833ca32969183`; `latest.json` SHA-256 `a616c050834cbdb55b0b087c2f6df7b565b1fd28951a5f8b22d03b6338fa9924`; transaction 9 of 9. It carried the intake band default OFF (`4d1afa92`), the popout modal-contract guard (`b44ec358`), the three-popouts-onto-one-`Sheet` convergence (#119), and the #121 quiet-launch SW_MAXIMIZE fix — **visually reviewed on the installed binary before publish** (the mid-apply consent panel remains the one unseen surface, see the row below). It supersedes v0.9.17 (`a614744c`, id `369614201` — **marathon Trains 1–3** and the first published build LOOKED at before shipping), which superseded v0.9.15 (`1b437785`, id `369480816`, published the same day), which superseded v0.9.12 (`a1be896`) and v0.9.11 (`7ba5fb6`). No v0.9.8, v0.9.9, v0.9.10, v0.9.13, v0.9.14 or v0.9.16 release exists — those were desk-only or abandoned. **A stale alias read is not drift:** `/releases/latest/download/latest.json` served the previous body from an edge cache for minutes after the v0.9.15 publish; the versioned URL is correct immediately. Re-fetch with a cache-buster before calling the alias wrong. (For v0.9.17 and v0.9.18 the alias converged on the first check.)

### 2026-08-20 - the 75880de1 / #127 idle-CPU desk-build detail, moved verbatim (byte budget)

Moved out of the "Owner-installed version + embedded stamp" row when the C-17b review ship
(`402b0080`) pushed the file back over its 48KB wall. Byte-for-byte; current state stays in
docs/RELEASE_STATE.md, which keeps the headline number and points here.

It supersedes desk build **`75880de1`** (0.9.25, branch `perf/idle-127-ambient-raster`, installer SHA-256 `E4A1301FD9F62FA38507ABD2320B20A1ECD7D4B67B26E538BDA1B078FFBFFC2A`), which is where the **#127 idle-CPU fix** was first proved and which is the first measured answer to the owner's standing "runs a lot slower than before" report. **Whole-app idle on Home: 19.632 -> 10.483 percent of one core**, measured with `scripts/q7-probe.mjs attribute` against the installed binary before and after (`docs/perf/raw/idle-attribution-2026-08-19-{A-rig-on,D-installed-fix}.json`). **#127's own diagnosis did NOT reproduce:** the rAF band is 0.201 points and fired ZERO frames, so the 3D rig was never the cost, and the dependency-bump hypothesis is dead (r3f/drei/three identical in the lockfile at the baseline commit, at `efde8310`, at HEAD and on disk). The real cost was two decorative CSS animations that the ambient-cost guard considered free because they animate `transform`: `aurora` on `body::before` at 13.257 points (a `scale()` animation re-rasters the whole layer every frame -- the 2026-08-06 teardown removed the blur and left the trigger) and the two `.stl-ring` pulses on every Home at 4.156 (measured 4.156 shipped, 4.001 promoted with `will-change`, 4.721 as opacity-only -- **running forever was the cost, not the property**). Both guards are new and both were **falsified on purpose** by re-introducing the defects on disk. **Scope stated:** the update-pill LED got the same bounded treatment but was **NOT separately measured** (no update was available during the runs), and the post-fix baseline is noisy (8s windows swing 4.8-15.2), so the total is quotable and the per-animation splits inside a single post-fix run are not.

### 2026-08-19 - owner-installed desk-build chain, moved verbatim from RELEASE_STATE.md (byte budget)

Moved out of the "Owner-installed version + embedded stamp" row when the C-04 ship (`40682344`) pushed
the file over its 48KB wall. Byte-for-byte, current state stays in docs/RELEASE_STATE.md:

It supersedes desk build **`2f79febb`** (built 2026-08-18 from `main` at the merge of PR [#139](https://github.com/Pootytxng/sentinel/pull/139); installed silently by Claude, installer SHA-256 **`668BB5E4725E1EE613603BA1230629159D6AD90AB5E1E4F9246E44EEC62E6E6D`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit`** — runtime proof `2f79febb · release · shell 0.9.25`, attempt 2 (1 expected transient). **Self-review VERDICT: PASS (10/10)** on the live app, and the code carries **three independent review rounds** (REQUEST CHANGES at `5d572db6` → APPROVE at `f88b25db` → APPROVE at `640fb78e`). It carries **conformance C-10 / C-11 / C-17**: the last five native `<select>`s are gone (their popup was drawn by Windows, so it ignored every token in the room) and the element is banned outright by `no-raw-select-guard`; repeated ledger applies collapse into one row (his history is 64 applies, **37 of them the same tweak** — the 30-row tape was one sentence printed over and over, now 17 rows / 13 change rows); and the mono-is-for-machine-values law became a census with a down-only ratchet. **Reachability was measured, not inferred:** `document.querySelectorAll('select').length === 0` on Home, Live, History and all six Test-room instrument tabs; the SessionInvestigator Picker renders `null` on his machine today (its guard needs two sessions of the SAME game) — recorded unreachable-today rather than claimed verified. **Two guard defects the review caught, both fixed here:** the select guard could not see a `<select` that ended a line (its own mutation test proved a code path the real sweep never ran), and the launch-focus classifier had been split on a false premise — a 5ms timing lead that is the probe's own poll ordering, not evidence the OS fronted the launch; it now needs a full poll of margin and says `unattributable-at-launch` when it cannot tell. **Scope stated, not hidden:** the census recorded 12 mono-on-prose violations and this build restyles NONE of them (C-17b), and the pre-existing ~120ms in-process window raise under load (#121) is NOT closed — see `docs/BACKLOG.md`. Supersedes desk build **`7f151d2c`**.

### 2026-08-06 - local ship at 3ad6eb48: the idle-cost teardown, and the two scroll snaps it caused

Installed by Claude + LIVE. Built from `3ad6eb48` on `claude/idle-cost-teardown-1f6a80` (0.9.13).
Installer `Compy_0.9.13_x64-setup.exe` SHA-256
`8A4BA7AF3E5B473AA76585B714CE6538E088930139C846F721B8CCDB53FA4E97` (5,105,379 bytes), exactly one
installer on the Desktop, runtime-proved over CDP as `3ad6eb48 · release · shell 0.9.13` (1 proof
attempt). Local ship only - nothing published, no tag, no fleet-visible action. Supersedes the
same-day ships at `ff0ce65f` and `dc4d55e` (2026-08-05), neither of which is safe to run: see below.

**What it carries.** The Q7 idle-cost teardown: idle CPU on an unattended visible window fell from
**50.165% to 23.348% of one core**, reproduced across two 10-minute bare runs, with the budget cut
from the *worst* post-fix reading. The single largest item was an infinite `background-clip: text`
foil pan repainting the title every frame at 29.793% of a core; the rest came from standing the
`LenisSpine` rAF loop down when the lane is not moving, and from making the FirstCheck / Optimize
aurora backdrops compositor-cheap. Evidence: `docs/perf/raw/idle-attribution.json` and siblings.

**Why two intermediate ships are dead.** Standing the scroll loop down handed Lenis a multi-second
`deltaTime` on the first frame after a park, saturating its `1-e^(-λ·Δt)` damping to ~1 - so the lane
*teleported* to the scroll target instead of easing to it, on every scroll after the app sat still.
Fixed at `50e5edda` by subtracting the parked interval from the timestamps Lenis sees. The fix then
had the same defect one layer down: `park()` re-stamped `parkedAt` on a *second* park, so an idle
park followed later by a hidden park dropped everything between them. Live-reproduced on `ff0ce65f`
as a zero-frame snap (scrollTop `1000, 1000, 1000…` for all 25 sampled frames). Fixed at `3ad6eb48`
by stamping only on the transition into parked. Both defects were found by the forced self-review,
not by tests, and both are now pinned by `src/design/jarvis/lenis-wake-guard.test.tsx` (5 cases).

Verify: `node scripts/verify-release-state.mjs` (check 7) ·
`Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 3ad6eb48`.

### 2026-08-04 - local ship at 8b7c232: the desk catches up on 25 commits, Q5's UI included

Installed by Claude + LIVE. Built from `8b7c232` on `main`. Installer
`Compy_0.9.12_x64-setup.exe` SHA-256
`CD7DCAE46CDEB927535D49486645082A4DD3DB087A2C6EF851BBAB42957A27F7`. Installed exe embeds `8b7c232`,
Windows Apps reports 0.9.12, exactly one installer on the Desktop, relaunched and runtime-proved over
CDP as `8b7c232 · release · shell 0.9.12` (2 proof attempts, 1 expected transient). Local ship only -
nothing published, no tag, no fleet-visible action. Supersedes the 2026-08-03 ship at `c7c60d3`.

**Why it was due.** The desk had been 25 commits behind since `c7c60d3`, and the gap was not cosmetic:
it contained the entire Q5 support-record surface (`7c8a03f` backend, `08ad3b1` the inspect-before-
export UI), the `owner_installed_stamp` gate that reads the installed binary (`270a622`), the module-map
split and its test-pass wiring (`2d33db2`, `9827728`), the residency guard (`ba609ea`), the branch-
disposition checker (`6882819`), the Q6 product-truth consolidation (`9bf3bde`), and the unloaded-project
hook fix (`a4d13bd`). Q5's pending visual self-review had no surface to review until this ship landed.

Verify: `node scripts/verify-release-state.mjs` (check 7 reads the stamp out of
`%LOCALAPPDATA%\Compy\compy.exe` and now agrees with CURRENT STATE) ·
`Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 8b7c232`.

### 2026-08-03 - local ship at c7c60d3: the phantom prove/publish hang is FIXED and proven end-to-end

Installed by Claude + LIVE. Built from `c7c60d3` on `main`. Installer
`Compy_0.9.12_x64-setup.exe` SHA-256
`307919349D06F941AF7F555F3E4D592D1E57739171BD581EED61D6AD53ADE07C`. Installed exe embeds `c7c60d3`
(Select-String verified), Windows Apps reports 0.9.12, exactly one installer on the Desktop, app
running as PID 23340. Local ship only - nothing published, no tag, no fleet-visible action.

**The proof that matters.** This is the first ship-reinstall run under the issue #60 defect-2 fix.
The SAME command, on the SAME script, earlier this session had to be killed after 600s despite having
completed all of its work (install done, installer staged, launched exe stamp-verified) - the wrapper
was stranded on a pipe the launched app inherited and held for as long as it ran. Under the fix the
run returned in **4 seconds, exit 0**. That is the reported defect reproduced and then closed against
the real failure, not against a probe.

Mechanism and the two guardrails that shaped the fix are in the `c7c60d3` commit body: the launch was
handing the child this process's stdout/stderr (bInheritHandles=TRUE); `Start-Process` is correctly
banned by the process-bypass rule so the capability went INTO `Start-NativeProcess` as `-Detached`;
and because ShellExecute cannot carry a child-only environment, the debug-port guarantee moved from a
silent per-child clear to a LOUD assertion that the variable is absent from this process, with
`-Detached` and `-Environment` mutually exclusive by contract.

Verify: `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern c7c60d3` ·
`scripts/release-powershell-static-guard.mjs` (88/88 across the release guard suites).

### 2026-07-28 — v0.9.10: preserved private-draft checkpoint after partial publish

Live verification found the v0.9.10 train had advanced beyond the prior state document before the
release-autonomy repair began. The immutable checkpoint is preserved, not rewritten:

- Source release commit and annotated source tag `v0.9.10` dereference to
  `92c7608da8541754e7c4bd888009d31d82de3b6a`; both source `main` and the source tag were already on
  origin.
- `Pootytxng/compy-releases` already had tag `v0.9.10`, a private draft, and two uploaded assets.
  The draft installer digest `61fa97cd…0efb` and manifest digest `263daf07…f7e` match the signed
  staged receipt. Nothing was made public to the updater: latest published and public
  `latest.json` remained v0.9.7.
- The owner machine already ran 0.9.10 with embedded stamp `92c7608`. The complete local candidate
  was copied to
  `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`.
- The old publish path could not resume this compatible draft: its initial collision check rejected
  any same-tag draft before reaching its later `-AllowOwnDraft` check. Because the complete
  transaction/journal repair must land after the immutable release commit, v0.9.10 is a preserved
  unpublished checkpoint and the next publishable candidate must be greater than v0.9.10.

### 2026-07-27 — first v0.9.9 candidate `2bd649d`: preserved runtime-proof failure

- Release commit `2bd649d40ead9e396bf40cb462b820aecd7a770c` was installed locally, but the
  first CDP startup probe's expected `ECONNREFUSED` stderr became a terminating
  `NativeCommandError` under Windows PowerShell 5.1. Publication failed closed before any source
  push, tag push, release, asset upload, or manifest change.
- The temporary local v0.9.9 tag was removed only after preservation; the authoritative ref is
  `recovery/failed-v0.9.9-runtime-proof-2bd649d`, present locally and on origin. Exact artifacts,
  hashes, receipt, signature, and failure transcript live at
  `C:\Users\Kuya\code\compy-release-evidence\2026-07-27-v0.9.9-failed-runtime-proof-2bd649d\`.

### 2026-07-24 — v0.9.8 `d9ced24`: owner-installed unpublished provenance

- Release commit `d9ced248d7060ba2926cb8ce69aa55aeb9f67d7f` and local annotated tag `v0.9.8`
  were created and the owner machine ran that build. It was never published to
  `Pootytxng/compy-releases` or sent to another person.
- Provenance remains intact through local tag `v0.9.8` and local/origin branch
  `recovery/local-v0.9.8-d9ced24`. The retained installer is 5,036,267 bytes, SHA-256
  `f5dad67efd074da8e17b0faf3fca56722e6888c8faceed4e5acd41f462d3096f`; its updater signature
  is 416 bytes, SHA-256 `beec50ebf60a91da524a2fc6ba220f561d26db003ae546c7eedc045b7a973537`.
- It was superseded locally by later source-tagged candidates; no tag or recovery ref was moved.

### 2026-07-28 — v0.9.9: source-tagged and owner-installed, but NEVER published (aborted release)

**v0.9.9 is not a public release and must never be described as one.** It is a source-only checkpoint:
source-tagged and installed on the owner machine, but never published to the fleet because the
release-repository existence probe failed closed.

- **Release commit** `664aa5e1ee56ce27be072edd09b05db136e7a758` ("release: v0.9.9"), pushed to
  `origin/main`. **Source tag** `v0.9.9` = annotated tag object `531cf07bf3868c5e07413e33b6e50b01b33ac65b`
  → `664aa5e`, pushed to the source remote. Preserved as-is: not moved, deleted, recreated or forced.
- **Staged artifacts** (byte-hashed, second immutable copy at
  `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\`):
  `Compy_0.9.9_x64-setup.exe` 5,038,558 B SHA-256 `080d5456c5e24ef318d88fe5963b31804222b157a2e94649af5dc42e31361f22` ·
  `.sig` 416 B `6aaf8787ac5301907f8aa566fcd8cb71cef5f0e7309a32760d28f20d51eee83e` ·
  `latest.json` 999 B `0e8257c22b118f5939d3b6ba4db06d1feda95c3e3dd42b779a22d048b0489387` ·
  `release-stage.json` 1,103 B `e32b65fe66bfcea72bfef9c4239275457b191bea6e732a4089d1ee1af745578b` ·
  `release-stage.json.sig` 404 B `64cfc1adc9e7f27e32080df9a39e8e0e77aeb580116cb6f269ae361e751da45b`.
- **Failure location** `scripts/release.ps1:393` (as of `18da464`): the releases-repo tag probe
  `(& gh api "repos/.../git/refs/tags/$tag" --jq ".object.sha" 2>$null)`. GitHub's **expected** 404
  ("this tag does not exist yet") was promoted by Windows PowerShell 5.1 into a terminating
  `NativeCommandError` under `$ErrorActionPreference = "Stop"`, because redirecting a native
  command's stderr is exactly what triggers that promotion. Three stages had completed (source push,
  source tag push, releases-main lookup); six never started (releases tag, draft, asset upload,
  manifest, publish, verify). The pipeline failed **closed** — nothing public was created or altered.
- **Proof no public v0.9.9 exists** (four independent checks): `gh release list --repo
  Pootytxng/compy-releases` newest = "Compy v0.9.7" (2026-07-23) · `git ls-remote --tags` on the
  releases repo returns v0.9.2–v0.9.7 only · the public `latest.json` still advertises `0.9.7` ·
  no draft release exists.
- **Installed owner state**: 0.9.9, registry `DisplayVersion` 0.9.9, embedded stamp `664aa5e`
  present exactly once with no `-dirty` suffix, runtime-proof `"664aa5e - release - shell 0.9.9"`
  (2 attempts, 1 expected startup transient). His box is ahead of every public user, who are on 0.9.7.
- **Recovery refs kept intact**: `recovery/failed-v0.9.9-runtime-proof-2bd649d` (`2bd649d40ead9e396bf40cb462b820aecd7a770c`) ·
  `recovery/failed-v0.9.9-prepare-1fa06a8` (`1fa06a8c1dfe98015cce6e706fc7fe938bb355d8`) ·
  `recovery/local-v0.9.8-d9ced24` (`d9ced248d7060ba2926cb8ce69aa55aeb9f67d7f`).
- **Consequence**: the v0.9.9 receipt, installer and embedded stamp are bound to `664aa5e`, and the
  pipeline requires the release commit to be the exact HEAD — so a later tooling commit cannot publish
  that receipt. v0.9.9 is closed as an aborted source-only checkpoint; the next publishable version is
  **v0.9.10**, which carries the generalized native-process repair (`71bbb1d`).

### 2026-07-23 — updater train v0.9.2–v0.9.7 + tester-review wave (banners retired from the live file)

The live RELEASE_STATE.md was rewritten this date to a single current-truth table (Phase 4 control-plane
repair); the per-train banners it used to stack are retired here. Full text of each is in git history
(`git log ac518f1..1d9bad6`, plus the `23a`–`23d` banners at `f69c98e`/`116ce28`). Summary:
- **v0.9.2 `a6d1508` / v0.9.3 `90fc73e`** — in-app updater armed + first fleet-path proof (0.9.2→0.9.3 self-update, CDP-witnessed). Endpoint `Pootytxng/compy-releases`; minisign key outside repo; footer copy → "Outbound: signed update check only".
- **v0.9.4 `419ec81`** — 1280×720 default window + remember-last-size; owner box self-updated 0.9.3→0.9.4.
- **v0.9.5 `ac518f1`** — "Apply to all rooms" accent action (taste call). Self-update proof #3.
- **v0.9.6 `29e5217` / v0.9.7 `1d9bad6`** — tester-review UX wave (bigger 3D stage, advisory cards as doors, orientation-first intro, calm admin lines, Field-Guide self-intro, Lab door rows) + a same-day honesty patch. Self-update proofs #4/#5.
- Owner-installed build progressed 0.9.4→0.9.7 entirely through the updater; GitHub asset counters later corroborated the downloads. The stale "0.9.1 / 37a166c / 970f801" table rows and the two contradictory "Bottom line" paragraphs were removed as superseded.

## 2026-08-20 — desk-build lineage below `aac90cd7`, moved out of RELEASE_STATE.md

Moved verbatim when the win-card snapshot pushed `docs/RELEASE_STATE.md` past its 48KB byte budget. The law is
archive first, never raise the number. Read it as the continuation of the current owner-installed row.

It supersedes desk build **`402b0080`** — 0.9.26, built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `main`-equal `402b0080`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`8F8D0E8FEEFEC6541304FCA8591D711F5B50297944E69C4663DDBE8BCF1354DC`**. **LIVE-proved by `scripts/ship-reinstall.ps1 -ProofOnly -ExpectedCommit`** — runtime proof `402b0080 · release · shell 0.9.26`, attempt 1 (0 expected transient). It closes a **four-merge desk lag**: the previous desk build predated C-17b, C-18, C-18b and C-13. **Self-review VERDICT: PASS** on THIS installed binary (10/10 rubric, captured at 1484x971) — it reviewed **C-17b**, whose residual is now CLOSED at a corrected **4 of 12** selectors measured (the old row claimed 6 while its own prose named 3); all four measured selectors resolve to `Geist Sans`, the untouched `.ss-pin-label` control is still `Geist Mono` with `tabular-nums`, and the 8 unreached are classified 2 data-shaped / 6 structural rather than left as an open IOU — detail in `docs/BACKLOG.md`. It also swept the C-18/C-18b deletions (`TuningPresets` has exactly one mount, `MonitorV2.tsx:181`; `Onboarding` gone with zero remaining imports) and C-13's `RoomAccentPicker` popover (exactly 2 `role="menuitem"`, the disabled state real in the DOM, not styled). **Two findings recorded, not engineered around:** `.monitor-panel-sub` renders ONLY on the `compy_monitor_console="0"` failsafe face — hand-traced through `MonitorV2.tsx:206-240` → `Play.tsx:264/435`, the default-ON console path never mounts the deep-monitoring slot; and `.btn-small` (`App.css:1388`) declares no `font-family`, so **26 buttons across 11 files render in Arial**, the session-debrief Share button measured live — pre-existing, not caused by C-17b, and filed as its own backlog row because one line there restyles 26 buttons and owes its own review. **Desk is AHEAD of the fleet:** same version number, different commit — published v0.9.26 is source `5e64074c` and contains none of the above. It supersedes desk builds **`40682344`** (C-04 — the front door is **Health** everywhere the user reads it; self-review PASS), **`5e64074c`** (0.9.26, THE PUBLISHED BUILD), **`75880de1`** (where the **#127 idle-CPU fix** was proved, 19.632 → 10.483 percent of one core), `2f79febb` and `7f151d2c` — all byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md).

---

## Snapshot history (reverse-chronological log — superseded by CURRENT STATE above)

> **UPDATE 2026-07-22b (§6 LIVE CATCH → `970f801` SHIPPED TO THE OWNER'S BOX — NO DISTRIBUTION CHANGE).**
> Live smoke §6 (owner playing Marvel Rivals, monitoring on, pre-fix `37a166c` build): capture repeatedly
> attributed to pid 1816 with an EMPTY process name (dwm; OpenProcess fails against the elevated/protected
> process → `""` → bypassed the name-keyed `PRESENTER_DENYLIST`) at 240–435 fps — persistent through the
> session, not a pre-match blip (watchers: 1189 + 666 samples across two runs). Also observed: between
> matches, desktop DXGI presenters (Discord.exe / Code.exe / RadeonSoftware.exe) win attribution — logged as
> a design-before-arm BACKLOG item (`34bd173`), not fixed this pass. **Fix `f96347d`:** `select_game_presenter`
> excludes empty-named candidates + 2 regression tests. **Ship-script fix `970f801`:** per-PID denial-tolerant
> kill + 20s drain — the ELEVATED fps helper can't be `Stop-Process`'d from the non-elevated ship shell and
> the old single-pipeline kill aborted the whole ship on it (caught live); the helper self-exits on the stale
> `fps.alive` heartbeat, so we kill what we can and wait. **Rebuilt at `970f801`:** NSIS 3,825,592 B SHA-256
> `4B59783069EB7C4C878D2D088A62FF9A1FF621FAA1BC62486328FC5AAF4E64DB` + MSI 5,328,896 B SHA-256
> `8139612078246AD74B0CBE31274F3C7F1C9AF448AA01E66EE5D57B537F809E98` (**MSI production re-confirmed for
> 0.9.0** — closes the checklist's "MSI not re-verified" caveat). `ship-reinstall OK`; installed exe byte-embeds
> `970f801`; one installer on the Desktop. **§6 helper exit: PASS** — after the real stop the heartbeat went
> stale and helper PID 8424 self-exited ≤15s (watcher v3 log). version-drift guard 14/14 (vitest — a `node
> --test` invocation of that file fails opaquely because it imports vitest; wrong-runner artifact, not a guard
> failure). Suites: cargo 858/858 (+24 ignored). Distributed artifact unchanged (`37a166c` NSIS, rows 3–4).

> **UPDATE 2026-07-22 (COWORK — PRIVATE BETA STAGED FOR DISTRIBUTION; STILL NO TESTER SEND).**
> Executed the owner's 2026-07-21 GO to stage (not send) the private beta: `Compy_0.9.0_x64-setup.exe`
> uploaded to Google Drive as a **brand-new file** (fileId `1BNuoY-ubKCLTkPUDFdnmFGAUkK4g0J9n`), never
> touching any existing file's slot. SHA-256 independently re-verified at multiple points (staged
> Desktop copy, live Drive round-trip download, byte-for-byte `cmp`) — all `6BC2F7DF…F5A2C4`
> (3,826,464 B), matching row 1 exactly. Sharing set to **Anyone with the link — Viewer**, confirmed
> reachable unauthenticated (HTTP 200; Drive's own can't-scan-for-viruses interstitial appears first,
> separate from and before the later Windows SmartScreen prompt). The old `fc940fe` kit's live share
> link (row 3/4, `Compy-Beta-Kit.zip`) is now **Restricted — link sharing removed** (see row 4).
> **Distribution is STILL ZERO to any tester:** the send itself remains the owner's action (step 12
> still held; nothing DM'd) — full detail, checklist, and the link live in
> `docs/BETA_DISTRIBUTION_RECORD.md`.
> **Addendum 2026-07-22 AM:** the old-kit restriction did **not** hold overnight (Drive Activity:
> re-shared anyone-viewer 9:16 PM Jul 21; measured OPEN again ~8:10 AM PDT Jul 22, and in that
> window the stale link was sent out as the beta link — the wrong-build alert). Re-killed +
> verified 3 ways + file renamed `RETIRED-DO-NOT-SEND_Compy-Beta-Kit_OLD-0.1.0-June.zip` the same
> morning; new 0.9.0 link re-verified unauthenticated (SHA-256 exact). See row 4 + the
> distribution record's incident update; "nothing DM'd" above is superseded — recipient
> reconciliation is now an OWNER item.
> **Addendum 2 (2026-07-22 ~9 AM PDT) — DISTRIBUTION IS NO LONGER ZERO:** the owner sent the
> correction + the recorded, verified 0.9.0 link to **six invitees** (Matcher · Chinaman · J ·
> Zoid · Sultan · Majin — names + send story in `BETA_DISTRIBUTION_RECORD.md`). Post-send
> re-verify passed: the exact sent link, downloaded unauthenticated → SHA-256 `6BC2F7DF…F5A2C4`
> exact, 3,826,464 B; old link re-confirmed dead in the same pass. Recipient reconciliation is
> CLOSED; the open risk item is the **A2 smoke pass (0/24)** while six people hold a working
> install link — several of them previously ran the June 0.1.0 kit, so the pass must cover
> **upgrade-over-0.1.0** (existing `%APPDATA%\Compy` data), not just cold install.

> **UPDATE 2026-07-20c (RUNTIME CLOSURE ON THE INSTALLED `37a166c` BUILD — PRIVATE BETA GO FOR INVITE-ONLY;
> THIS COMMIT IS DOCS-ONLY, NO REBUILD).**
> The two runtime items 2026-07-20b honestly left open are **CLOSED**, exercised on the installed release
> build itself (`%LOCALAPPDATA%\Compy\compy.exe`, runtime stamp `37a166c · release`), not in dev:
>
> - **Orphaned Gaming Mode session RECOVERED through the app's legitimate path:** `gm-1784436112238` (status
>   active, full typed rollback contract intact) was resolved via the in-app **Restore** — clicked by the
>   OWNER (his confirmed click). Restore completed clean: `gaming-session.json` absent afterward, **no
>   quarantine file, no RestoreFailed marker**, Trust Ledger consistent. The orphan-recovery path the
>   architecture promises (detect → surface Resume-vs-Restore → staged restore) is **live-proven end-to-end
>   on this exact build**.
> - **Live rollback → reapply cycle through the installed UI** (Windows Game Mode rec — deliberately benign:
>   pure HKCU `GameBar` keys, `elevation_used: false`, so this closes the *unelevated* mutation lane only):
>   - **Rollback — 2026-07-21T01:48:35Z** (evening of 2026-07-20 local): executed at the machine through the
>     installed UI by a human click (physical-presence evidence; attribution is evidence-based inference,
>     distinct from the owner-testimony line above). Registry read back `AllowAutoGameMode=0` /
>     `AutoGameModeEnabled=0` — equal to the ledger snapshot priors; entry `game-mode-1784419404776` stamped
>     `rolled_back` at that instant; no ledger entry added or removed.
>   - **Reapply — 2026-07-21T01:57:32Z:** a real click on the live Optimize toggle (CDP-driven UI automation
>     against the installed build — the app's own click path end-to-end; no registry shortcut). **Zero UAC**
>     (consent.exe watched throughout — never appeared; expected for HKCU). Registry → `1/1`. New ledger
>     entry `game-mode-1784599052740` **field-perfect**: snapshot priors `0/0` (the true pre-apply state),
>     status `applied`, typed `enable-game-mode` / `restore-game-mode-from-snapshot` contract, app version
>     `0.9.0`, ruleset `1.0.0-baseline`, `elevation_used: false`. Ledger **55 → 56** entries; every
>     pre-existing entry **byte-unchanged** (raw-JSON set-difference); unrelated-state baseline (DVR keys ·
>     SysMain/DiagTrack/WSearch service state · power-plan + USB-suspend + ASPM values) **identical**
>     before/after.
>   - **Final state = original:** machine left in its pre-test Game-Mode-ON state (`1/1`); clean relaunch
>     with the debug port closed; UI shows the applied entry active; footer ledger count 56.
> - **Verdict:** 20b (source/build verify · install · stamp · zero-outbound · smoke) **+** this runtime
>   closure ⇒ **the `37a166c` NSIS artifact (SHA-256 `6BC2F7DF…F5A2C4`) is GO for invite-only private-beta
>   distribution.** The send itself is an owner action (ships-to-others stop) — **nothing has been
>   distributed** (step 12 still held). **Public release stays BLOCKED:** Code signing + Legal (Release
>   blockers below, unchanged).
> - **Docs-only commit distinction (do NOT rebuild off this):** this closure lands as a **documentation-only
>   commit created after validation** — repo HEAD advances one commit past `37a166c` with **zero
>   source/product/version/gate/artifact delta**. The **validated binary source remains `37a166c`**; the
>   installed NSIS remains `Compy_0.9.0_x64-setup.exe` SHA-256
>   `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4`. The reinstall law binds app-code
>   builds, not doc commits — **no rebuild/reinstall is warranted by this HEAD advance.**
> - **Coverage gaps that stay OPEN (named honestly, unchanged by this closure):** **elevated**
>   mutation/rollback not exercised this pass (the cycle was deliberately HKCU/non-elevated; the most recent
>   live elevated proofs remain the 2026-07-16 owner-present leftovers QA and the 2026-07-07/08 batched-tier
>   session QA) · **NVIDIA sensor lane** still "implemented, not hardware-verified" (LOCKED rule 5 — no
>   monitored NVIDIA session yet) · **multi-rec batch apply** not runtime-exercised (single-rec cycle only;
>   the §2a stack-trial gate stays DARK) · **live Codex hook activation** still pending — externally blocked
>   (ChatGPT/Codex usage limit until 2026-07-26), `.codex/*` advisor scaffold only, **unrelated to the Compy
>   binary**.
>
> **UPDATE 2026-07-20b (RELEASE-VALIDATION BUILD — `37a166c` BUILT + INSTALLED ON OWNER MACHINE, NOT DISTRIBUTED).**
> First full **build + install** of the accumulated code-complete-but-unshipped work (`75c38c6..37a166c`, 20
> commits: Measurement Platform 2.0 + Home masthead/intake behind `compy_home_intake` **DEFAULT OFF** + the
> Codex read-only advisor scaffold + identity/version doc reconciliation) onto the **owner's own machine**. This
> is a **release-VALIDATION** pass, **not** a tester or public release — **no artifact was distributed** (directive
> step 12 held: no tester send, no share-link change).
>
> - **Source commit:** `37a166c` (`37a166ca4825c7320477b67af6a258456065ab18`) = HEAD = `origin/main`, code tree
>   clean, `COMPY_GIT_DIRTY=0`.
> - **Artifacts built** (`npm run tauri build` from `37a166c`):
>   - NSIS `Compy_0.9.0_x64-setup.exe` — **3,826,464 B (3.65 MB)**, SHA-256
>     `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4`.
>   - MSI `Compy_0.9.0_x64_en-US.msi` — **5,328,896 B (5.08 MB)**, SHA-256
>     `45819019532D956DA177840920463AC895E1F2A48A34D1174B476297A550F572`.
> - **Installed** via `scripts/ship-reinstall.ps1` (stop → keep ONLY the new NSIS on Desktop → `/S` silent →
>   launch). **Live == build, confirmed two ways:** the installed `%LOCALAPPDATA%\Compy\compy.exe` (14,837,760 B)
>   byte-embeds `37a166c` (no stale `75c38c6`/`408c860`/`05f0ce4`, no contiguous `+dirty`), **and** the live runtime
>   build STAMP over CDP reads `37a166c · release` (clean). One Compy installer on the Desktop; single-instance
>   confirmed; the debug CDP port was closed on relaunch.
> - **Safety envelope UNCHANGED by the delta (verified, not assumed):** all **11 mutation/rollback modules**
>   (`actions` · `history` · `gaming_orchestrator` · `gaming_session` · `game_mode_persist` · `services` ·
>   `gpu_profile` · `remote_rules` · `receipts` · `license` · `drift`) are **byte-identical** across
>   `75c38c6..37a166c`; the `#[tauri::command]` IPC count is **90 → 90** (no new command); **no** capabilities /
>   `tauri.conf.json` / CSP change; **no** new outbound-network code (no added `reqwest`/`http`/`TcpStream`), and
>   live zero-outbound held on this exact build.
> - **Gated systems match declarations:** remote-rules fetch OFF (placeholder pubkey, triple-gated), updater
>   absent, Receipts telemetry built-dark default-OFF, Compy Pro license built-dark — all unchanged by the delta.
> - **Source verification (green):** cargo **856 passed / 0 failed / 24 ignored** · vitest **188 files / 1777
>   passed** · `tsc --noEmit` **clean** · `verify-release-state --strict` **53/53 ok**.
> - **Packaged-app smoke:** launched clean, onboarding already past (app not first-run), hardware detection +
>   navigation + readiness + monitoring surfaces render; **tab-nav / scanning lag evaluated on the RELEASE build**
>   (release binary, not the debug/HMR dev build the earlier lag report came from).
> - **NOT done / honestly open (as written at 20b):** no artifact distributed (step 12) · **no live apply/rollback
>   exercised** (mutation is owner-territory; boundary proven by byte-identity + tests, not by a live mutation
>   that pass) — **CLOSED 2026-07-20c** (live rollback → reapply cycle through the installed UI; entry above) ·
>   onboarding not re-triggered (app past first-run) · uninstall/reinstall-from-clean not exercised (destructive) ·
>   an **orphaned Gaming Mode session** (`gm-1784436112238`, status active, full typed rollback contract intact)
>   was present on disk — surfaced to the owner as a **Resume-vs-Restore** decision (Restore triggers elevation +
>   service/power-plan mutation → owner-territory; NOT clicked at 20b) — **CLOSED 2026-07-20c** (owner clicked
>   **Restore**; recovered clean — entry above).
>
> **UPDATE 2026-07-20 (AUDIT-CORRECTIVE TRAIN PUSHED — `c1071c1..05f0ce4` → `origin/main`; NOT A RELEASE).**
> An independent Codex acceptance audit had returned a **"DO NOT PUSH"** verdict on the `c1071c1..9b89ee0`
> train; the narrow corrective follow-up `05f0ce4` (stacked additively on `9b89ee0`, no rewrite) resolved
> every named blocker. The full 5-commit stack was **pushed via fast-forward** (`408c860..05f0ce4`, no force;
> frozen beta ref `16069fa` untouched) after green mechanical verification — **hooks-selftest 39/39 · tsc
> clean · version-drift-guard 14/14 · release-state verifier 53/53 strict** — and a boundary scan confirming
> **zero product/binary/IPC/network/security delta** (the stack is `.codex/*` advisor scaffold + docs +
> `#[cfg(test)]`/comment-only Rust + one display-only `src/App.tsx` version-string wiring, guard-pinned). This
> is an **audit-corrective closure, NOT a release closure** — no gate flipped, no installer built, no ship to
> another machine. The live installer is UNCHANGED: still `Compy_0.9.0_x64-setup.exe` from `75c38c6`. **Item 1
> of the owner directive (a live in-product Codex hook-activation test) remains OPEN** — externally blocked by
> a ChatGPT/Codex usage limit until 2026-07-26 with no local OSS provider installed; it produced no evidence
> and does NOT gate this push (the commits already self-document in-product hook activation as unproven pending
> a trusted Codex runtime run).
>
> **UPDATE 2026-07-18b (MEASUREMENT PLATFORM 2.0 — FINAL SLICE LANDED ON MAIN `77b5b89`, CODE-COMPLETE,
> NOT SHIPPED).** This train was scoped **code-only** (no rebuild, no reinstall, no ship-to-another-machine)
> — so **the live installer is UNCHANGED**: still `Compy_0.9.0_x64-setup.exe` SHA-256
> `2F13B9F41A8DB4AEDCEC87E90FD4560829F84EE70818BAD102F095C9EFCDC0AF` from `75c38c6` (the 2026-07-18a ship
> below). `77b5b89` is on `main`, verified green, and awaits a future ship cut. What landed:
> - **Regression Detective hardening (Task G) — not-comparable reports now assert NO cause.** The
>   `intelligence.rs` different-rig gate fires BEFORE any FPS delta is computed, so there is no measured
>   effect to attribute; it no longer pushes a `hardware-change` leading hypothesis (that was a causal
>   claim with nothing to explain, and it triple-stated the GPU/RAM/Display facts `comparability::derive()`
>   already carries). The **comparability banner is the SOLE owner** of that framing. The frontend
>   `showLeader` also gates on `verdict !== "not-comparable"` — double-layered backend+frontend, hostile-
>   fixture-proof. No fifth room; comparability surfaced in the shared investigator render
>   (`WhatChangedReportView` used by both `WhatChangedPanel` and `SessionInvestigator`). Bands are words,
>   never numbers. Laws held: no fabricated causation, correlation never becomes cause.
> - **`WhatChangedReport` gains `comparability: SessionComparability`** (additive, backend always
>   populates — old persisted data unaffected; report is computed, not persisted).
> - **`MIN_COMPARE_SAMPLES` de-duplicated** — single `pub(crate) const` in `intelligence.rs`, imported by
>   `intelligence_patterns.rs` (one source, can't drift). Decision: `docs/decisions/2026-07-18-prove-a-
>   change-overlap.md` (ACCEPTED) — two "prove a change" surfaces are complementary layers, not a merge;
>   `next_test`→experiment routing DEFERRED (prose has no machine-readable rec-id → auto-routing would
>   fabricate a mapping). BACKLOG carries the additive follow-ups.
> - **Read-only advisory surface — the mutation/rollback boundary is UNTOUCHED** (`actions.rs` /
>   `history.rs` / `experiment.rs` / `gaming_orchestrator.rs` byte-identical). **No gate flipped**; the
>   `compy_intelligence` flag (already default-ON) governs the surface. **Zero-outbound property holds** —
>   security-surface diff EMPTY (no CSP / capability / telemetry / remote-fetch / updater / signing /
>   network change; Sections 0.6–0.8 satisfied).
> - **Verification (none skipped):** cargo test 849/0, clippy clean, `cargo check` clean, tsc 0, vitest
>   1733/0 (targeted `intelligence::` 47 + `intelligence-flag` 7 green), release-state citation audit 46
>   ok / 0 broken (exit 0), self-reviewer **PASS 9/9** on a hostile not-comparable fixture. Tauri
>   production build intentionally NOT run (train forbids shipping).
>
> **UPDATE 2026-07-18a (INTELLIGENCE PHASE 4 SLICE 1 SHIPPED LIVE `75c38c6` — installer SHA-256
> `2F13B9F41A8DB4AEDCEC87E90FD4560829F84EE70818BAD102F095C9EFCDC0AF`, live exe stamp-verified
> `75c38c6 · release` (CLEAN — no `+dirty`; CDP `get_build_stamp`), ONE installer on the Desktop
> (`Compy_0.9.0_x64-setup.exe`), silent reinstall done — supersedes the `D0D63E48…94575BCB` installer
> from `28648b2`).** Collapses the `28648b2 → 75c38c6` drift (4 commits; app-code delta `+746/−33`
> across 9 files, the rest docs-only). Carries two shipped items plus a ship-integrity catch:
> - **Intelligence Phase 4 slice 1 — component-level evidence highlighting (§4H "hardware twin"):** the
>   Hardware grid lights a component card ONLY when a real Intelligence pattern implicates it, at that
>   pattern's OWN confidence band. Architecture is a **read-only PROJECTION, not a new detector** —
>   `component_evidence.rs` (`attribute()` over `detect_patterns()`, `#[tauri::command]
>   get_component_evidence`) re-keys existing Intelligence Phase 2 findings BY the hardware component
>   each names (memory-trend → Memory; thermal-trend / driver-split → GPU); it invents no evidence, and
>   passive/ambient patterns stay capped at Medium. Flag-gated on the Intelligence flag; a card stays
>   **neutral** when the flag is off OR the projection fetch fails — never a fabricated glow ("no
>   decorative component glow without meaning"). On a rig with no qualifying session pattern yet it is
>   invisible — that IS the design. Mutation/rollback boundary UNTOUCHED (`actions.rs` / `history.rs` /
>   `experiment.rs` byte-identical `28648b2 → 75c38c6`); zero-outbound property holds (no network /
>   telemetry / capability change). bug→guard: `border-hygiene-guard.test.ts` guard 3 pins the compound
>   `.card.card-lit:hover` cascade fix; `HardwareGrid.test.tsx` pins the four honesty invariants
>   (lit-only-implicated · neutral-when-flag-off · no-glow-on-fetch-fail · band-drives-class).
> - **W2 fast-follow (`f558d1d`):** the armed Controlled-experiments bench (`ExperimentBench.tsx`)
>   live-refreshes on window/tab refocus — a pick that became already-applied while you were in Optimize
>   re-derives to the "Already configured" verdict (Start hidden) and STAYS visible in the picker (guard
>   "re-derives the active pick from the live ledger on refocus", 6/6).
> - **Ship-integrity note (the law working):** the FIRST build of `75c38c6` stamped `+dirty` — two stray
>   CDP-probe PNGs sat in the repo ROOT at build time (non-docs, so build.rs's `:(exclude,top)docs`
>   pathspec counted them). The **CDP stamp-verify caught it**; the exe-hash byte-scan CANNOT (`+dirty`
>   is assembled at runtime from `COMPY_GIT_DIRTY`, never stored contiguously — exactly why the law says
>   "verify via the CDP stamp, not an exe hash"). Fix: PNGs → scratchpad, then `cargo clean -p compy
>   --release` and rebuild → clean `75c38c6 · release`.
> - Verify at HEAD `75c38c6`: cargo **819/819** (24 ignored) · clippy clean · tsc clean · vitest **1718
>   passed / 8 skipped / 0 assertion failures** (the lone "failed FILE" was a 60 s setup-hook timeout in
>   `scripts/export-library.test.mjs` under concurrent build load — passes 8/8 in isolation, unrelated to
>   this slice) · citation audit 50 (46 ok · 4 near-drift · 0 broken).

> **UPDATE 2026-07-17f (INTELLIGENCE PHASE 3 SHIPPED LIVE `28648b2` — installer SHA-256
> `D0D63E489105BE7566769A13A2BA801FE76E95314E07A11938A8A49A94575BCB`, live exe stamp-verified
> `28648b2 · release` (CLEAN — no `+dirty`; CDP `get_build_stamp` + embedded-hash byte-scan of the
> installed exe), ONE installer on the Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done —
> supersedes the `E3F8E0CE…7856EBA8` installer from `cd66ce9`).** The ship-stamp closing the
> 2026-07-17e arming (two-commit pattern); resolves every PENDING item there:
> - **Live apply→rollback round-trip on THIS rig (benign reversible rec):** id `game-mode-1784336056558`,
>   snapshot `{prior_allow:1, prior_enabled:1}`, `elevation_used:false`, apply→rollback byte-identical 1/1,
>   `rolled_back_at 2026-07-18T00:54:42Z`, ledger CLEAN after. Proven on the armed engine at `e16b231`; the
>   apply/rollback boundary (`experiment.rs`/`history.rs`/`actions.rs`) is **byte-identical `e16b231`→`28648b2`**
>   (`git diff --stat` empty), so the proof stands unchanged on the live build — no re-mutation of the system needed.
> - **MUTATION-GATE 10/10 PASS** (rollback-first contract). rust-tauri-reviewer PASS on the arming diff
>   (fix-before-merge, W1 picker-lock — see 17e). **Cowork-lane adversarial audit FLAGGED** (mutation-boundary
>   GO-LIVE = high-stakes class #1, `docs/COWORK_HANDOFF.md` routing).
> - **self-reviewer PASS on the LIVE armed Lab surface** (`28648b2`, CDP 9223, real machine): **7/7 rubric
>   PASS** (items 8–9 n/a) — the note renders as ONE line; `.lc-detail-note` muted `--ix-text-2`
>   `rgb(139,147,167)` on the dark-glass card body `rgb(10,12,16)` (NOT an accent fill) = **6.36:1**, clears
>   4.5:1; zero `/undo/` · `/just reads/` · `/only…changes anything/` (both bug→guard regexes closed); no
>   duplication vs Fix's `.fix-consent`; h1 "Lab" title-header intact; absent when the station is closed and on
>   Benchmark (vitest `lab-console.test.tsx` 10/10). The note states the reversibility invariant true across
>   every Lab mutator (Optimize · Benchmark tweak-trial · Controlled experiments), NOT a false per-station
>   census — rounds 1–2 caught two false censuses; bug→guard `lab-console.test.tsx` pins both out.
> - Verify at HEAD: cargo **808/808** · clippy clean · tsc clean · vitest **1720/1720** · citation audit
>   50/50. §0.11: Optimization Cleanup lane untouched. **Owner welfare-check pending:** the Benchmark
>   tweak-trial and the Controlled-experiments bench now overlap (both single-tweak apply→measure→rollback) —
>   surfaced for a feature-shape dedupe call, not resolved unilaterally.

> **UPDATE 2026-07-17e (INTELLIGENCE PHASE 3 ARMED — `experiment_gate()` flipped `false` → `true`,
> owner sign-off "Ship it live now").** The experiment engine + optimization simulator are now LIVE
> (`experiment::experiment_gate() -> bool { true }`, `src-tauri/src/experiment.rs:55`). This is a
> mutation-capability GO-LIVE, done its own reviewable commit under full mutation-gate rigor. Arming is
> safe by construction: the engine invents **no new** apply/rollback primitive and adds **no**
> `AppliedAction`/`RollbackAction`/`Snapshot` variant — start reuses `history::apply_recommendation`,
> restore reuses `history::rollback_change`, rollback still resolves from `history.json` alone (the SAME
> audited boundary LIVE for weeks under the Benchmark tweak A/B trial). Every lifecycle command STILL
> hard-checks the gate (defense-in-depth, now unreachable while armed); the FE renders nothing if it ever
> reads false. **Reviewer fix-set landed in this same arming commit** (rust-tauri-reviewer fix-before-merge):
> the simulator now flags **advisory-only** recs (in the catalog but with no one-click apply — the SSD /
> driver-update advisories) as `not-applicable` instead of inviting a Start that would dead-end at the
> apply boundary — driven by a NEW single source of truth `history::is_appliable` (shares `apply_fn_for`
> with `dispatch_apply`, so simulator and apply boundary can never disagree; read-only, never runs the
> apply). FE `not-applicable` label → "Not testable here". Verify: cargo **808/808** (count UP — +2 new
> guards: `appliable_recs_are_one_click_advisories_are_not` + `advisory_only_rec_is_never_worth_testing`)
> · clippy clean · tsc clean · vitest ExperimentBench **5/5** (dark render-nothing + armed interactive
> pins + the W1 picker-lock guard). **frontend-ipc-contract-auditor PASS** (7-for-7 verdict parity, all 8
> invokes registered); its one pre-ship Warning — W1, a reselect race AT the apply boundary — was FIXED +
> guard-tested in this same commit: the picker locks during `simBusy`, a request-id ref drops superseded
> simulator reads, and the sim card names its exact mutation target so Start is never ambiguous.
> **COMPLETED in 2026-07-17f** (the ship-stamp above, `28648b2`): live apply→rollback round-trip on a
> benign per-user rec on THIS rig (ledger clean before/after) · `npm run tauri build` + silent reinstall ·
> installer SHA-256 `D0D63E48…94575BCB` + live `get_build_stamp` = `28648b2 · release` · self-reviewer PASS
> on the LIVE armed Lab surface · MUTATION-GATE 10/10 + Cowork-lane adversarial audit flagged. The owner's
> first real gaming-session experiment IS the live FPS→verdict QA — real frames from a real game are the
> owner's to produce (anti-fabrication law); the engine cannot manufacture them. Flipping the gate BACK is
> likewise an owner-signed decision, never a refactor side effect. §0.11: Optimization Cleanup lane untouched.

> **UPDATE 2026-07-17c (HOME VERDICT REGRESSION FIX SHIPPED `cd66ce9` — installer SHA-256
> `E3F8E0CE03A2807786196BC52AAF1A21F86A17C8F5C02F0FD5ACC6FE7856EBA8`, live exe stamp-verified
> (embedded `cd66ce9`, CLEAN — no `+dirty`; byte-scan of the installed exe), ONE installer on the
> Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done — supersedes the `3EB0FAE5…C570D838`
> installer. NO gate moved — pure frontend text-derivation + one boolean standdown, zero
> mutation/capability change):** owner-caught regression — Home's verdict strip had crept back to the
> vague "1 thing needs your attention" count headline the owner agreed to retire (name-it-and-fix-it-inline
> + title-header laws). Fixed at the SOURCE so all three Home faces benefit: `system-posture.ts`
> `deriveSystemPosture()` attention branch no longer emits a count — single flagged check ⇒ headline IS
> that check's label, several ⇒ `"<top label> · and N more"`, and `sub` carries the check's own `detail`
> so the fix travels with the name (`src/surfaces/system-posture.ts`). `HomeConsole.tsx` adds a
> one-owner-per-screen standdown at the `topLimiter` derivation: when the named verdict already IS the
> #1 limiter (same title — the live-machine collision, "Applied Compy changes" is both), the "top limiter"
> row stands down so the string renders exactly once (mirrors the existing `dekRedundant`/ForwardDoor
> standdowns; `src/surfaces/HomeConsole.tsx`). bug→guard: `system-posture.test.ts` VAGUE_COUNT regex pin
> (named, never a count) + `home-console.test.tsx` dedup guard (same-title ⇒ 0 top-limiter rows & string
> count = 1; different check ⇒ no false standdown). Verify: tsc clean · vitest **1714/1714** (count UP
> from 1710) · self-reviewer PASS (live, real machine attention state — vague count absent, verdict names
> the check + fix inline, duplicate title count = 1, h1 = "Home"). Frontend-only; cargo/gates untouched.

> **UPDATE 2026-07-17b (INTELLIGENCE PHASE 2 SHIPPED `9c6af4b`+`094d834` — installer SHA-256
> `3EB0FAE5D5AE4D98567B043026656FCE818C2AF28C096EF100789877C570D838`, live exe stamp-verified
> (embedded `094d834`, CLEAN — no `+dirty`; byte-scan of the installed exe), ONE installer on the
> Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done. NO gate moved — read-only + one
> additive `#[serde(default)]` field, zero mutation/capability change):** second train of the owner
> directive (`docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` §6; spec
> `docs/superpowers/specs/2026-07-17-intelligence-phase2-train2.md`). `9c6af4b` (backend) adds
> `intelligence_patterns.rs` (six deterministic cross-session detectors — trend/thermal/memory/driver/
> mode/fade — passive-capped at Medium, §0.12 coverage reasons, command `get_intelligence_patterns`) +
> `what_changed_between` (the §4D "last good vs first bad session" workflow, reusing the Phase 1 engine
> verbatim) + an EvidenceGraph re-projection on `WhatChangedReport` (§4C, adds no data, relations never
> assert causation) + `drift.json` ingestion (external reverts as observed events, always tagged
> external) + `AppliedChange.rolled_back_at` (additive `#[serde(default)]` stamp, set at rollback time,
> NEVER retro-dated; rollback LOGIC unchanged, `resolve_rollback` still history-only). `094d834`
> (frontend) surfaces them Expert-view only (`compy_expert_view`, default OFF): SessionInvestigator +
> evidence graph in Monitor's What-Changed panel, PatternsTile in Blackbook's logbook (§5E, no fifth
> room); the plain-language view is unchanged for the normal user. Confidence bands
> unknown/low/medium/high ONLY (no numerics); deterministic, inspectable, local — zero telemetry/network.
> Verify: cargo **787/787** (count UP from 754) · clippy clean · vitest **1710/1710** (count UP from
> 1708) · rust-tauri-reviewer PASS · self-reviewer PASS. §0.11: Optimization Cleanup lane untouched.
> Phase 3 (experiment engine, §4F) is the next train — fresh session.

> **UPDATE 2026-07-17a (INTELLIGENCE PHASE 1 SHIPPED `8f612d2`+`d45bb1c` — installer SHA-256
> `8063F95744C6AF00C760FD3F77DA63FBD9B68B279773307D6D1AEB5773A52E0D`, live exe stamp-verified
> (embedded `d45bb1c`, CLEAN — no `+dirty`; Select-String), ONE installer on the Desktop
> (`Compy_0.9.0_x64-setup.exe`), silent reinstall done. NO gate moved — read-only vertical slice,
> zero mutation/capability change):** first train of the owner directive
> (`docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` §5): `8f612d2` adds the
> `intelligence.rs` domain layer + three query commands (`get_intelligence_timeline` ·
> `what_changed_for_session` · `get_intelligence_headline`) + the What-Changed engine and surfaces
> behind `compy_intelligence` **default ON**. Confidence bands unknown/low/medium/high ONLY (no
> numerics); deterministic, inspectable, local — zero telemetry/network. Honesty note: the query
> commands are NOT literally pure reads — each calls a throttled, mutex-guarded, atomic own-store
> snapshot refresh (`intelligence.json`); `monitoring.rs` gains a per-tick `load_session()` additive
> read (`SessionSummary.gaming_mode_active`, `#[serde(default)]`). `d45bb1c` = game-name display
> class sweep (bug→guard: every surface strips the `-Win64-Shipping` wrapper via the shared
> prettifier; MATCHING stays raw — `norm_app` deliberately keeps its own `.exe`-strip). Verify:
> cargo **754/754** (count UP) · clippy clean · vitest **1708/1708** (183 files) ·
> verify-release-state 46/46 · rust-tauri-reviewer PASS ×2 · self-reviewer PASS ×2. §0.11:
> Optimization Cleanup Phase 1 (shipped 2026-07-16) left exactly where it was.

> **UPDATE 2026-07-16d (VERSION 0.9.0 SHIPPED `27bc472` — installer SHA-256
> `41613F13A046730A663B29AA144AE7DFF120FFD0C604ADE060B4D2A1D6ABB6F9`, live exe stamp-verified
> (embedded `27bc472`, CLEAN — no `+dirty`: non-docs porcelain empty at build; Select-String), ONE
> installer on the Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done — this is the
> reinstall commit the 2026-07-16c banner promised. NO gate moved):** the human-facing version
> jumps `0.1.0` → **`0.9.0`** across all three manifests + `Cargo.lock` (owner call 2026-07-16:
> **"0.9.0 now, 1.0.0 at your bar"** — `docs/superpowers/specs/2026-07-16-version-policy-proposal.md`
> flipped DECIDED; `1.0.0` fires at the release-hardening bar with owner confirm). Drift killed at
> the class level: `scripts/ship-reinstall.ps1` now DERIVES the installer filename from
> `tauri.conf.json` (the hardcoded `0.1.0` literal it carried was a silent drift site) and
> `scripts/version-drift-guard.test.mjs` pins all four version sites + the no-hardcoded-filename
> invariant. Verify: vitest **1688/1688** (182 files) · cargo 725/725 · clippy clean ·
> verify-release-state 46/46 · release build exit 0.

> **UPDATE 2026-07-16c (OPTIMIZATION CLEANUP PHASE 1 — LEFTOVERS RESTORE ARMED, a MUTATION GATE
> FLIPPED):** `restore_gate()` → `true` (`leftovers.rs:730`) **and** `history::restore_leftover`
> registered as a Tauri command (`lib.rs`) in the same deliberate commit — the double-dark layers
> both opened at once, exactly as designed. **Precondition satisfied first:** the owner-present
> live-UAC QA harness (`history.rs` `manual_restore_qa`) passed ALL THREE full loops on real
> machine state 2026-07-16 — W32PS (0x26→stock 2→rollback 0x26→cleanup 2), MPO (OverlayTestMode
> 5→delete→rollback 5→cleanup absent), memcompress (seed OFF→restore ON, prior banked
> in-elevation→rollback OFF→cleanup stock ON) — owner approving every UAC prompt. Memcompress
> scripts made state-aware first (`if`-guarded Enable/Disable-MMAgent — the cmdlets are
> non-idempotent, live-proven: Disable throws ERROR_SERVICE_DISABLED from already-off). **Owner
> decisions:** restores REUSE the Trust Ledger (provenance `leftover_adopted`) — the BACKLOG's
> "separate recovery-snapshot mechanism" idea is retired; 5 "QA · " receipts deleted from the live
> ledger (56→51, backup kept). Dark-gate tests rewritten armed-world (+1 new tripwire:
> `bcdedit-timer-flags`/`defender-policy-off` stay resolver-less forever). Restore stays
> backend-only — no FE surface calls it yet. Verify: cargo 725/725 (+24 ignored owner-QA; count
> UP from 724) · clippy clean · vitest 1682/1682 · verify-release-state 46/46 ·
> rust-tauri-reviewer PASS. Installer rebuild follows in this train (version bump → 0.9.0); stamp
> line updates at the reinstall commit.

> **UPDATE 2026-07-16b (OPTIMIZATION CLEANUP PHASE 0 SHIPPED `55f68b6` — installer SHA-256
> `7D6C562389CE3944A45A8A5F17E1204D36F0D76392BE4EE209707E778DD17B50`, live exe stamp-verified
> (embedded `55f68b6`, CLEAN — no `+dirty`; Select-String), one installer on the Desktop, silent
> reinstall done. Dirty-stamp guard overridden deliberately (2026-07-16a precedent): tree dirt was
> exclusively parallel-lane files (COWORK_*.md · ui-sweep shots · stray scratchpad png) + this
> banner's own docs edits; app inputs (`git status --porcelain -- src src-tauri …`) empty at build.
> Frontend-only, NO gate moved, zero mutation boundary):** the live `leftovers.rs` read-only audit
> now fronts as **"Optimization Cleanup"** (owner-locked name 2026-07-15) and is UNBURIED from the
> "Nothing else needs attention" side pile to a first-class Check section (title + blurb + "Check
> this PC for old tweaks" run button). **Leftovers restore stays DARK** — the gate row below is
> unchanged (`restore_gate()==false`, no registered command, Phase 1 not scope-gated). terms/tweaks
> data renamed; title-case "Past Tweaks" pinned as a retired label (stale-reference-guard). Verify:
> tsc 0 · vitest **1682/1682** (181 files) · self-reviewer **PASS 9/9** (pre-run/busy/real-result/
> fixture-findings states; contrast 11.3:1 header; no dup mount; dist-site restaged — staleness
> guard green). Spec: `docs/superpowers/specs/2026-07-16-optimization-cleanup-research-spec.md`.

> **UPDATE 2026-07-16a (APP-LANE TASK LIST CLOSED: room-palette 8-duo+7-solo rework · App.css
> gradient-ink de-slop · NAV-MOUNT COST FIXED — installer SHA-256
> `832B7CF3BDBD2603F925EDD18DD9A1669B0AB74CC441A7675769B46F48687A4E`, live exe stamp-verified
> (embedded `b968f0a`, CLEAN — no `+dirty`; Select-String), one installer on the Desktop, silent
> reinstall done. Dirty-stamp guard overridden deliberately (2026-07-15f precedent): tree dirt was
> exclusively parallel-lane files (Cowork `COMPY_OVERVIEW.md` + a stray scratchpad png); app inputs
> (`git status --porcelain -- src src-tauri …`) empty at build. Frontend-only, NO gate moved, zero
> mutation boundary):** four commits — `92596d6` room-accent palette reworked to 8 curated two-color
> shift duos + 7 standard-spectrum solids (owner pick: duos are the favorites; adaptive-ink law kept)
> · `47300d9` App.css gradient-text de-slop + CoreBar transform-based fill · `b2d775d`
> UI_VISION_BACKLOG stale-list fix (Monitor gauges + Blackbook flight-recorder recorded 🟢 already
> shipped) · `d0392c9` **nav-mount cost FIXED** (closes the 2026-07-15f follow-up): MonitorV2's
> duplicate sensor pre-warm deleted; SessionStack's per-row `getComputedStyle` forced recalcs (≤15)
> → ONE hoisted accent listener + shared ink cache (≤4 reads, in-place accent repaint guard
> re-pinned); Blackbook tape capped at 30 first-render rows + "show N older records" disclosure
> (counts/sinceDate still full-set; 2 bug→guard vitest cases). `b968f0a` = the site lane's site-only
> commit atop `d0392c9` (no app diff). Verify: tsc 0 · vitest **1666/1666** (181 files) ·
> self-reviewer **PASS 8/8** on live data (73-record tape: 30+disclosure → unroll; accent pick
> repaints in place; only-new-element check passed).

> **UPDATE 2026-07-15f (APP CONSOLE TRAINS 1–4 SHIPPED DEFAULT-ON + OVERLAY BACKDROP FIX — installer
> SHA-256 `B87B3B3CC78527AF08C2000FDEC740676742E066E0AD13A3D623A0A553B3D20C`, live exe stamp-verified
> (embedded `f160839`, clean — no `+dirty`; Select-String), one installer on the Desktop, silent
> reinstall done. Dirty-stamp guard overridden deliberately: tree dirt was exclusively parallel-lane
> files — Cowork's `COMPY_OVERVIEW.md` WIP + the site lane's untracked `site/*.html` — none of which
> compile into the app (`git status --porcelain -- src src-tauri …` empty at build). Frontend-only,
> NO gate moved, zero mutation boundary):** four commits — `50b505e` Train 1 Monitor console
> density/backdrop fold-in · `f4b4ada` Train 2 Settings quiet chrome · `40bce4e` Trains 3+4: Gaming
> Mode arm/engage console face (`compy_gaming_console` DEFAULT ON) + app-wide viewport HUD frame &
> global reticle (`compy_hud_frame` DEFAULT ON; classic reachable via the "0" failsafe, flag-off
> byte-identity test-pinned) · `f160839` **owner-reported overlay defect FIXED**: main.tsx applies
> skin attributes to documentElement before branching on the overlay window label, so document-level
> ambient pseudo layers (App.css `body::before` aurora, seasonal `::after`) painted a faint
> full-window backdrop over fullscreen games — Overlay.css now blanket-kills all six document-level
> pseudo slots (`content: none !important`), live-verified in the actual overlay window over CDP.
> Bug→guards: `src/overlay-ambient-guard.test.ts` (kill rule present + no `content !important` on
> document-level pseudos + no `:has()` on the nav-hot `.v2-shell`). Nav timing A/B-attributed: this
> train adds no cost (Home/Lab in band flag-on); residual Monitor/Blackbook nav-mount slowness is
> PRE-EXISTING (equally slow flag-off) — follow-up flagged. Verify: tsc 0 · vitest 1656/1656 (181
> files; 8 skipped) · no Rust diff. self-reviewer round-3 **PASS** (7/7 rubric; consent modal
> exercised + cancelled; 52px readout clearance verified at true scrollHeight).

> **UPDATE 2026-07-15e (SITE COMPLETION — SEO/LAUNCH PLUMBING + `/compare` LIVE, DEPLOYED — site-only,
> NO gate moved, zero `src-tauri/`, zero `src/`):** the compy.gg launch-readiness layer landed and is
> LIVE on the Pages host. New: canonical URL scheme across every page (landing `/`; picks canonicalize
> to `https://compy.gg/<id>` from both the top-level and library copies; non-picks → `/library/<id>`;
> legal → `/privacy`, `/eula`; compare → `/compare`), `robots.txt` + `sitemap.xml` (196 URLs, **no
> lastmod/priority/changefreq** — honesty law: never fabricate freshness), favicons (bracket-mark
> `favicon.svg` + hand-built `favicon.ico`), a static `404.html` (noindex, root-absolute links, no JS),
> honest JSON-LD (TechArticle on articles/teasers, SoftwareApplication on landing — **guard bans
> aggregateRating/reviewCount/ratingValue**), and the **new `/compare` page** (Design Director spec,
> council 2026-07-15: five construction-practice axes — rollback · kernel/anti-cheat · catalog
> transparency · telemetry default · cost model — **never names a competitor, never invents a
> performance number, admits the tradeoff on every axis**). Guard: new `scripts/site-seo.test.mjs`
> companion suite; full site pipeline **40/40 green** (site-landing + staleness + seo). Self-review
> **PASS** (agent `adae2dc1b4d75fff8`: computed contrast verified — `#f2ede4` on `#0d0b07` panel,
> `#140a00` on `#ff9a1e` primary; mobile 390px no overflow; single footer; nav Receipts→Blackbook→
> Compare→FAQ→waitlist; skip-links resolve; no retired-brand copy). **DEPLOYED** (owner's deploy GO,
> 2026-07-15): `npx wrangler pages deploy dist-site` → deploy `d8a40fc5.compy-bd6.pages.dev`, apex
> **promoted + verified** (apex HTML md5 `458dc641203451a34e7eb44eeeb47ec1` == deploy hash; `/compare`,
> `/sitemap.xml`, `/robots.txt`, favicons all 200; a real HTTP 404 on unknown routes).
> **Owner's deploy GO supersedes the older "site stays PRE-PUBLISH / deploy owner-gated" language**
> in this file and BACKLOG.md — the site now deploys autonomously. STILL owner-gated for launch:
> the **`compy.gg` domain purchase** (canonicals/sitemap/JSON-LD already point at it; site currently
> lives only on `compy-bd6.pages.dev`). No app gate moved; no mutation boundary touched.

> **UPDATE 2026-07-15 (`--run-elevated` BOUNDARY-SIDE GUARD SHIPPED `4bf2a91` — the Phase B
> defense-in-depth item from BACKLOG closes; MUTATION-BOUNDARY code (elevation), Cowork adversarial
> audit warranted; NO gate moved. Installer re-cut + silently reinstalled same day: SHA-256
> `265275CD1494A7E4AE3D64CDD21CAD8494179CD88E647F957C7313BF8E547BC7`, live exe embeds `4bf2a91`
> [Select-String verified], one installer on the Desktop — dirty-stamp guard overridden
> deliberately: tree dirt was the parallel site lane's `site/generate.mjs` WIP, not app code):**
> the elevated helper entry no
> longer runs whatever hex it is handed. `run_elevated_powershell` — the ONLY dispatch point, where
> every command has already passed typed-dispatch/`ps_safe` validation — now mints a ONE-TIME
> dispatch ticket (`%APPDATA%\Compy\runtime\elev-<pid>-<seq>.ticket`, content = the exact command
> hex) and passes its path as a third argv; the helper refuses any hex that doesn't byte-match its
> ticket (exit 3, runs ZERO PowerShell) and consumes the ticket before running, so a dispatch
> executes at most once (`mint_elevation_ticket` `actions.rs:1149`, `run_elevated_helper` `lib.rs:76`,
> argv `main.rs:12`). Content-agnostic exact-match ⇒ can never
> false-reject a legitimate apply (every builder's output passes by construction). Honest-attribution
> preserved: mint failure = a third pre-launch refusal classified nothing-ran
> (`elevation_error_nothing_ran`); helper exit 3 reads "approved, but the operation failed" — never a
> false success; decline leaves the ticket → parent cleans up. 4 guard tests both directions
> (foreign hex rejected without burning the legit ticket · batch-script + torture-set payloads pass ·
> end-to-end helper refuses no-ticket/replay · minted dispatch runs exactly once). Also this cycle:
> `5752970` shipped the additive downsampled per-session FPS series (`sessions.rs` `fps_series`,
> read-only, no mutation boundary). Verify: cargo 724/0 (up from 720) · clippy clean · tsc 0 ·
> vitest 1632/1632. rust-tauri-reviewer verdict recorded in the commit.

> **UPDATE 2026-07-14d (GAMING TOAST SHIPPED `4e46287` — installer SHA-256
> `EF3A5FC5C930B47C219D17C695FC1B051458A084E445FC8D32BE8341F56D80C5`, live exe stamp-verified
> (embedded `4e46287`, clean tree — Cowork's site lane committed as `b6f8213` before the build),
> supersedes the `08605B25…F791F` installer):** owner ask at QA sign-off — the global Gaming Mode
> crash-recovery banner + success confirmations moved from full-width top bars to a bottom-right
> `.gaming-toast-stack` popup with a this-run-only × dismiss (never clears the recovery; never-hide
> law intact). Frontend-only, no gate/mutation change. tsc clean · vitest 1631/1631 · self-reviewer
> PASS. Gaming Mode QA is **owner-SIGNED-OFF 2026-07-14** (`9cddac7`) — all 10 live cases passed.

> **UPDATE 2026-07-14c (ELEVATION-DECLINE FIX SHIPPED `db5349e` — installer SHA-256
> `08605B25E8C2E8709826D1AA57F7451BD3FB4221D5716FBB1019051CA32F791F`, live exe stamp-verified
> `db5349e+dirty · release` via CDP `get_build_stamp` (+dirty audited benign: the parallel Cowork
> site-lane WIP, none of it compiles into the app; installed with deliberate `-AllowDirty`),
> supersedes the `4B916615…43DCC18` installer. MUTATION-BOUNDARY code — Cowork audit warranted):**
> live GAMING_MODE_QA case #6 exposed that the `runas` crate (1.2.0) never returns `Err` on Windows —
> a UAC **decline** (ERROR_CANCELLED 1223) collapsed to `Ok(exit -1)`, so the app blamed the user
> ("You approved the elevation, but the operation itself failed") and the abort path fired a spurious
> SECOND prompt. Fix: `runas` removed; own `actions::elevate_and_wait` (ShellExecuteExW, launch error
> preserved via `shell_launch_error_to_io`, unreadable exit maps conservatively — never fabricated
> success) at all 3 call sites (`run_elevated_powershell`, test seam, FPS helper); 3 guard tests pin
> 1223→decline. Verify: cargo 715/0 · clippy clean. **GAMING_MODE_QA is now 10/10 PASSED** — #6/#7
> owner-clicked (No·Yes·No·Yes) on this build 2026-07-14; UAC policy + app token verified read-only
> (`EnableLUA=1`/`CPBA=5`/secure-desktop 1, compy token Limited). Awaiting only the owner's
> "Gaming Mode QA signed off".
>
> **UPDATE 2026-07-14b (DIRTY-STAMP AUDIT + GUARD — no ship, no gate moved):** the LIVE PART B build's
> full stamp reads **`2eda4eb+dirty · release`** (caught via CDP `get_build_stamp` during the JARVIS
> deviation-evidence captures). **Audited BENIGN:** tracked tree was clean; the dirty bit came from 89
> untracked `docs/` files (`git status --porcelain` counts `??` lines), which never compile into the
> binary — the live exe is code-identical to `2eda4eb`, so the installer row above stands and NO re-cut
> is needed. Why it slipped: the embedded-HASH verify can't see the dirty bit. Fixes (this commit):
> `src-tauri/build.rs` dirty check now excludes `docs/` (`:(exclude)docs` pathspec — untracked non-docs
> still counts) · **new DIRTY-STAMP GATE** in `scripts/ship-reinstall.ps1` step 0b (throws on non-docs
> tree dirt before install; `-AllowDirty` = deliberate override; red→green proven with a non-docs probe).
> The next build/ship stamps clean. Also this cycle: **owner RATIFIED both JARVIS motion deviations**
> (2026-07-14: Dock keeps lift-only, no magnetic pull; no hologram shader-pulse — gauge data-tick stays
> the vehicle, idle-GPU 0-draws/15s re-proven live) — the A7 "may still overrule" tail is closed.
>
> **UPDATE 2026-07-14 (CONSUMER-PANEL PART B SHIPPED `2eda4eb` — installer SHA-256
> `4B916615DF25A8D4EBEE29E4BAEDAA3C178634209F38D90195A9D5C1643DCC18`, live exe stamp-verified `2eda4eb`
> via the embedded hash, installed by Claude + LIVE, supersedes the `CA408DF4…AA00F795` installer; NO
> gate moved, display-only — zero mutation-boundary code):** the owner-approved PART B pair. **B7 site
> hero "positives first, credibility as the shield":** the stage stacks two provenance-pinned strips —
> TOP `.proof-win` is a real Diablo IV measured-session showcase (237 avg fps / 214 1% low, 3h,
> `site/src/session-receipt.json`) with NO gain claim (the Monitor "▲37 avg" delta was REJECTED for the
> slot: 94% vs 41% GPU load between its two sessions = indefensible attribution; documented in the
> receipt JSON), BOTTOM keeps the game-mode null receipt retitled "The honesty test · we publish the
> misses"; `scripts/site-landing.test.mjs` pins both strips to their JSONs and rejects gain-claim
> phrasing in the win strip. Site stays PRE-PUBLISH — hero copy is owner taste-gated before publish.
> **B6a hologram-as-index:** Home rig callouts (GPU/CPU/RAM/Storage) expand on demand (hover peek /
> click pin, `HomeConsole.tsx` dense builders) into detected-only dense readouts; missing field = no
> row; drag-orbit preserved; 4 new guards in `home-console.test.tsx`. **B6b:** Settings "JARVIS motion"
> sub-description now descriptive (`Settings.tsx:259`). Verify: tsc 0 · vitest 1628/1628 (up from
> 1623) · site 17/17 · self-reviewer PASS (8/8 incl. GL-idle 0 draws with all callouts pinned).
>
> **UPDATE 2026-07-14 (CONSUMER-PANEL PART A HONESTY FIXES SHIPPED `9a29cfe` — installer SHA-256
> `CA408DF49BC747C2E0360135CD3F055F2040F29C64CDA96DE77BC9D0AA00F795`, live exe stamp-verified `9a29cfe`
> via the embedded hash, installed by Claude + LIVE, supersedes the `26D42379…D483979A` installer; NO
> gate moved, display-only — zero mutation-boundary code):** the 2026-07-14 consumer-panel PART A
> items: Expert View's "every tweak" promise now covers the deliberately-refused tier
> (`expert-targets.ts` + `REFUSE_PILE` rows render the gated `ExpertTargetLine`; default-OFF face
> pinned unchanged) · Monitor vs-last-session tag appends "· COMBINED EFFECT" when >1 change is on,
> tooltip routes attribution to the Lab A/B bench · Home rig RAM callout gains measured speed /
> EXPO-XMP note · `prettyGameName` strips UE `-Win64-Shipping` suffixes. Verify: tsc 0 · vitest
> 1623/1623 (up from 1610) · self-reviewer PASS (Expert ON/OFF, live 11-changes session). PART B
> (theater-vs-data merge, hero proof framing) answered directionally by owner — proposals pending,
> nothing built.
>
> **UPDATE 2026-07-14 (FULL-PROJECT REVIEW CLEANUP SHIPPED `4dbfca4`+`3ba79dc` — installer SHA-256
> `26D42379A1A3EED60E95CFC4315B48303362064AA8784C0D6482900D483979A3`, live exe stamp-verified `3ba79dc`
> via the embedded hash, installed by Claude + LIVE, supersedes the `1C1F13DC…FE657E0` installer; NO
> gate moved):** part (b) of the Fable-5 exhaustive review — every finding fixed. FE/site batches
> (App.tsx dead-tab removal, retired-brand sweep + stale-reference guard, LicensePanel `armed` from
> `status.armed`, waitlist atomic rate-limit + CSP + D1 migration, ErrorBoundary/safe-storage) +
> backend non-mutation (license `armed` stamp, PDH `Drop`, fps helper liveness) + mutation boundary
> under the full mutation-gate (10/10): `with_error_action_stop` single-command false-ledger guard ·
> `nic_interface_safe` GUID charset guard · Nagle apply/rollback per-call `-ErrorAction
> SilentlyContinue` (mid-loop interface failure can't orphan earlier live writes) ·
> `gaming_orchestrator::start()` fail-closed when an unreadable session file can't be quarantined ·
> bug→guard `every_nagle_set_itemproperty_write_isolates_its_own_error`. rust-tauri-reviewer:
> "mutation boundary sound, merge-ready". Verify: cargo 712/0 (up from 711) · clippy clean · tsc 0 ·
> vitest green · verify-release-state 38/38 (6 citations re-anchored). `3ba79dc` also logs the
> `--run-elevated` boundary-side guard as a Phase B defense-in-depth backlog item (owner-approved,
> not launch-blocking). Cowork adversarial audit flagged for the mutation diff.
>
> **UPDATE 2026-07-13 (390px LANDING PAGE-EDGE OVERFLOW FIXED — site-only commit, NO gate moved, no
> installer change, zero `src-tauri`, zero `src/`):** the pre-existing mobile defect the hero-receipt
> pass logged is closed. Root cause: `.topbar`/`.hero`/`.article` share their element with `.wrap`
> and their `padding:` shorthands zeroed `.wrap`'s 24px side padding — below ~1128px the hero ran
> edge-to-edge and the verdict ribbon's `-10px` overhang + 7px glow scrolled the page to 407px at a
> 390px viewport; article text sat flush at x=0 on every library/debunk page. Fix: longhand
> `padding-top/-bottom` on all three (`site/src/library.css`, regenerated) + `.hero h1` clamp cap
> 44→42px (self-review catch — the narrowed 569px column wrapped the headline to 3 lines ≥1294px).
> bug→guard in `scripts/site-landing.test.mjs` (red-proven on the pre-fix CSS; scans wrap-combined
> classes from landing + article templates for the shorthand; pins generated==source). Verify:
> self-reviewer PASS (390 visuals + h1 2-line boxes at 1280/1440/1920) · index sw==cw at
> 390/1280/1440/1920 · article 24px inset at 390, desktop unchanged · site-landing 17/17 · vitest
> 1610/1610. Site stays pre-publish; the live installer stays `86ecad1`/`1C1F13DC…`.
>
> **UPDATE 2026-07-13 (SITE HERO RECEIPT NOW REAL — site-only commit, NO gate moved, no installer
> change, zero `src-tauri`, zero `src/`):** the landing hero's proof-strip numbers were a decorative
> mock (`fast-startup-off` "+8 fps · 1% low +11") that a consumer-panel persona flagged as fabricated
> under the "measured, not promised" headline. Replaced with a REAL receipt measured through the
> app's own Lab → Benchmark tweak A/B flow on the dev rig 2026-07-13: `game-mode` → live Palworld
> frames → **within ±0.7% noise** (same-session calibrated floor) → auto-rolled-back (ledger
> `game-mode-1783992509604`). Provenance: `site/src/proof-receipt.json`; guard:
> `scripts/site-landing.test.mjs` pins strip↔provenance + bans the mock trio (site-landing 16/16).
> Site remains pre-publish (hosting owner-gated); the live installer stays `86ecad1`/`1C1F13DC…`.
>
> **UPDATE 2026-07-13 (GLOSSARY-TOOLTIP TRIO FIXED `86ecad1` — installer SHA-256
> `1C1F13DC259A99042918B5F1714B518F3825EFB1B080FC3443316F1CBFE657E0`, live exe stamp-verified
> `86ecad1` via the embedded hash, installed by Claude, supersedes the `A8C341DE…61EC1C10` installer;
> NO gate moved, zero `src-tauri`):** two owner-reported defects on the new Blackbook tape's "1% low"
> gloss + one found by the fix's own self-review. **(1) Tooltip buried under later rows:** the tape
> reveal's `animation-fill-mode: both` made every `.bc-row` a PERMANENT stacking context (a filled
> transform/opacity animation does that) — sibling contexts paint in DOM order, so rows below the
> hovered row painted over the open tooltip; fix `both → backwards` (`blackbook-console.css`), guard
> bans `both`/`forwards` on the row animation. **(2) "More in the Blackbook →" unreachable:** the
> tooltip sits across a 6px hover gap and mouse-leave closed it instantly; fix = 160ms close-grace in
> `Term.tsx` (re-entering the wrapper cancels; focus/Escape unchanged), fake-timer guards in
> `Term.test.tsx`. Benefits every Term site app-wide (Monitor "frametime" hero gloss
> regression-checked). **(3) Deep-link never scrolled (pre-existing, exposed by 2):** Learn's
> scroll-into-view effect ran before the focused entry's category expanded and never re-ran — the
> card sat ~1100px off-screen; fix adds `openCats` to the effect deps (`Learn.tsx`), guard pins a
> focusId mount fires scrollIntoView + flashes the card. Verify: tsc 0 · vitest **1608** (178 files) ·
> self-reviewer **PASS** (live real data: tooltip opaque `rgb(20,24,36)` over sibling rows; real
> CDP pointer crossed the gap, link navigated, card landed `rect.top=108` vs 1023+ off-screen before;
> stagger + reduced-motion intact).
>
> **UPDATE 2026-07-13 (DEFAULT-ON GRADUATION + DUO PALETTE + A+B BLACKBOOK SHIPPED `18272be` — installer
> SHA-256 `A8C341DEB55F32630E59144D6CA33CAF205A16B48A34F8923C27D65861EC1C10`, live exe stamp-verified
> `18272be` via the embedded hash, installed by Claude, supersedes the `21942094…0930FF4F` installer;
> **TWO FLAGS GRADUATED DEFAULT-ON:** `compy_room_identity` + `compy_blackbook_console`, both readers
> now `!== "0"` in `src/design/theme.ts`, boot attr in `main.tsx` — the owner eyeballed both and directed
> "everything was supposed to be default on to avoid the QA toggle section"; both "(preview)" Settings
> rows REMOVED per the graduated-flag convention, devtools localStorage `"0"` stays each failsafe):**
> Three owner directives in one train. **(1) Duo palette** ("double color options rather than the ugly
> earth tones like olive … then leave that finished"): `ROOM_ACCENT_SWATCHES`
> (`src/design/room-identity.ts`) re-curated to **15** — Rust/Olive/Pine pruned; 3 DUO swatches added
> (Cyan/Midnight `#35e0e8+#3b2a7a` · Red/Blue `#ff6b6b+#2f6bff` · Lime/Cyan `#b6f24a+#35e0e8`); a duo's
> bright PRIMARY carries every legibility role (chrome/buttons/text) while the SECONDARY drives only the
> `--v2-accent-dim/-line` washes; persisted as an `a+b` key (`swatchKey`/`splitSwatchKey`, bare-hex
> singles stay backward-compatible), picker dots render a 135° split (`swatchDotCss`). **(2) A+B
> Blackbook intuitiveness** (owner picked "A + B together" from the concept artifact): the Logbook gains
> the **Receipts Strip** — three tappable count tiles ("Changes to this PC" / "Gaming sessions" /
> "Guides fact-checked") replacing the bare "N records" line, filtering the tape (aria-pressed;
> zero-count disabled; counts derived from the same records the tape renders) — plus **sentence-grammar
> rows** ("Compy applied X" / "You played G for T" / "You fact-checked a guide") and a tape section head
> speaking the field-guide eyebrow grammar (`src/surfaces/blackbook/BlackbookConsole.tsx` + css).
> **(3) bug→guard from the ship's own self-review (round-1 FAIL, fixed):** a Home accent pick recolored
> chrome but never the rig hologram — `use-rig-colors.ts` read `.v2-room` while Home's `--ix-accent`
> re-point lives on the NESTED `.home-console`; fix prefers `.home-console ?? .v2-room` + call-order
> guard (`room-identity.test.ts`). **Zero `src-tauri`** (`git diff -- src-tauri` empty). Verify: tsc 0 ·
> vitest **1604** (177 files) · self-reviewer **round-2 PASS** (native 1500×980, the owner's REAL
> 70-record logbook: strip counts 51/19/0 sum to the tape, changes-tile "13 still on" == the Lab jump's
> number, rig recolor pixel-proven for Plum AND a duo with `--ix-accent` read back off `.home-console`,
> Lab emerald no-regression, reduced-motion still, GL idle 0 draws/18s). The owner's A8/A9 checklist
> items are RESOLVED by these directives (OWNER_ACTION_CHECKLIST updated same commit).
>
> **UPDATE 2026-07-13 (DEAD-CODE CLEANUP + READINESS RETIRED-LABEL FIX SHIPPED `2b64c51` — installer
> SHA-256 `219420944926D99318CFB8FFA6D689952D154FF6005756926BF334640930FF4F`, live exe stamp-verified
> `2b64c51` via the embedded hash, installed by Claude, supersedes the `703F078B…9EE40B8` installer;
> NO gate moved):** Cycle 2026-07-13b turbo-window maintenance pass. The live build `2b64c51` is the
> docs persist-commit sitting atop the code change `c80678f`; the exe was **rebuilt at HEAD** so the
> stamp is truthful — the sole `c80678f`→`2b64c51` delta is `docs/BACKLOG.md`, which is not compiled or
> bundled, so the shipped binary is functionally identical to `c80678f`. **Dead-code removal**
> (grep-verified 0 importers, tsc-confirmed no dangling refs): 7 never-adopted vendored React Bits dirs
> deleted (14 files — DotField/GlareHover/GooeyNav/Grainient/Noise/PillNav/Radar, bulk-vendored
> `9d66be9`, never wired; `tokens-v2-guard` "vendor kit present" floor 12→7 adopted set; `THIRD_PARTY.md`
> pruned + `ogl` flagged as a likely-orphaned npm dep for a dedicated prune pass) + `monotonePathD`
> (`console/monotone.ts`, 0 importers; sibling `monotoneSegments` stays). **readiness.rs retired-label
> leak** (drift-audit find; room-labels-vs-nav-ids law): the applied-changes check said "roll it back in
> Optimize", but post the 2026-07-10 ground-flip the default rail has no standalone Optimize tab — the
> undo home is the Lab; both strings → "in the Lab", and the Rust test that had enforced the stale
> "Optimize" text (a false-green) flipped into a **bug→guard** (asserts "the Lab" present AND no "in
> Optimize" dead-end). The ONLY `src-tauri` touch is that read-only copy + its guard — **no gate, no
> mutation/rollback path, no IPC changed.** Verify: tsc 0 (re-proven by this build's `tsc && vite build`)
> · cargo test readiness 35/0 · vitest 1593/1593 · release rebuild exit 0, live exe stamp `2b64c51`.
> **Deferred (flagged, NOT dead-by-oversight):** RigViewer non-chromeless chrome (~140 lines — a live
> test exercises it, needs a product call that LabConsole is its only forever-caller), CompyHero /
> readCommitted (parked future landing hero), 14 orphaned theme.ts `apply*`/`read*` exports (verified
> 0-reference, deferred to a focused theme.ts pass — critical file). Closes Cycle 2026-07-13b.
>
> **UPDATE 2026-07-13 (MONITOR v5 "frametime" JARGON GLOSS SHIPPED `530ef8b` — installer SHA-256
> `703F078BCEA0BBA2BF740F93A7E559A421CB06D82CC5B981C8A6463B99EE40B8`, live exe stamp-verified
> `530ef8b` via the embedded hash, installed by Claude, supersedes the `B7931E4E…5A3E92BC` installer;
> NO gate moved — the Monitor console is already DEFAULT ON, `compy_room_identity` stays DEFAULT OFF):**
> Closes the **deferred Monitor-surface jargon bucket** from the consumer-panel overhaul (`50b5c03`) —
> held per that plan's own sequencing note until the Monitor v5 owner eyeball settled, which it has
> (console flipped DEFAULT-ON `e195f70`). The v5 DeckScope hero exposed the raw term **"frametime"** on
> its scope label with no gloss, while the sibling Play face (`Play.tsx:266`) + the Deep-Monitoring
> section-help (`App.tsx:1800`) already wrap it in an inline `<Term>` — a jargon gap against CLAUDE.md's
> own no-jargon promise for the non-technical gamer. **Fix:** `Oscilloscope`'s `label` prop widened
> `string → ReactNode` (backward-compatible; mirrors the ArcGauge ReactNode-label precedent — every
> other caller passes a plain string), and `DeckScope` (`src/surfaces/monitor/DeckScope.tsx`) now passes
> `label={<Term id="frametime">frametime</Term>}` → the hero renders "FRAMETIME" as a dotted-underline
> gloss trigger with the one-line frametime definition + Blackbook link. **Only "frametime" is glossed:**
> FPS/latency/spikes/budget are consumer relabels, self-explanatory, or have no correct glossary term
> (glossing "LATENCY" with the `input-latency` term would be factually WRONG — the readout is a frametime
> minimum). **Zero `src-tauri`** (`git diff -- src-tauri` empty). bug→guard: `deck-scope.test.tsx` pins
> the hero renders a real glossary Term (`.osc-label .kl-term` == "frametime") + the tooltip reveals the
> definition (a dead id fails soft to plain text → the guard would find nothing). Verify: tsc 0 · vitest
> **1607** (177 files; +2 guards) · self-reviewer **PASS 8/8** (live 1500×980: `.osc-label .kl-term`
> `rgb(139,147,167)` uppercase matching siblings, dotted accent underline ~6.37:1 on the dark panel;
> tooltip opens/closes on hover+click, not clipped; FPS/latency/spikes/budget stay plain; backward-compat
> proven — sibling `label="fps"`/gauge callers unchanged).
>
> **UPDATE 2026-07-13 (DARK-ACCENT-AS-TEXT LEGIBILITY SHIPPED `cc9adb8` — installer SHA-256
> `B7931E4EE26F594A1AE746908EA2CB9F4B18B876831E9F4DD6472E695A3E92BC`, live exe stamp-verified
> `cc9adb8` via the embedded hash, installed by Claude, supersedes the `51B0A754…3862F39A` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner one-flip eyeball still the open gate):**
> **Closes the KNOWN FOLLOW-UP the prior banner logged.** A DARK per-room accent pick rendered ~2.5:1
> wherever chrome used the accent as foreground TEXT on the dark panel (the adaptive INK covered
> accent-as-FILL only — this adds the accent-as-TEXT half). Fix: each of the 6 dark swatches gains a
> paired light, hue-carrying `text` tint (`src/design/room-identity.ts`, `swatchText()`);
> `applyRoomAccents` (`src/design/theme.ts`) emits `--v2-accent-text`/`--ix-accent-text` (the light
> tint) for dark picks only — bright picks emit neither. In-room accent-as-text sites swept
> `var(--ix-accent)` → `var(--ix-accent-text)` (dock, blackbook-console, monitor-console, Lab,
> lab-bento) and `var(--v2-accent)` → `var(--v2-accent-text, var(--v2-accent))` (HUD masthead sep,
> forward-door arrow, optimize chip-count, home-hud); `home-console` gains `--ix-accent-text` via the
> fallback (it is a descendant of the managed-style target). Scoped `.v2-room` overrides fix Check
> ✓-marks / GamingMode marker / Learn superseded-link hover — each ALSO renders OUTSIDE any room
> (escape-hatch / portal / overlay), kept byte-identical there. **Zero `src-tauri`.** Verify: tsc 0 ·
> vitest **1605** (177 files; 5 new guards: legibility ≥4.5:1 vs panel · load-bearing · coverage ·
> swatchText · emit-mechanism) · read-only scope audit (confirmed no other in-room accent-as-text
> site) · fresh-context adversarial review (2 findings fixed: Learn hover, missing emit-test) ·
> self-reviewer **PASS** (live 1500×980: Home dock `#ef8ea8` ~8.1:1, Monitor `#c79cef`, Blackbook
> `#68d2a6`, Lab `#98b4e6` ~8.9:1; flag-off byte-identity confirmed). Flag stays **DEFAULT OFF** — do
> NOT flip room-identity default-ON until the owner eyeballs.
>
> **UPDATE 2026-07-13 (ACCENT PALETTE PRUNED 20→15 SHIPPED `8e6920f` — installer SHA-256
> `51B0A754C2CC2578302771168F45C13850A7ED24DABDEF23E98F7F1B3862F39A`, live exe stamp-verified
> `8e6920f` via the embedded hash, installed by Claude, supersedes the `97C581BB…EEE7698` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner one-flip eyeball on the pruned palette is the
> open gate):** Owner follow-up — *"looks good but i agree to prune and widen variety more
> differentiation."* Re-curates `ROOM_ACCENT_SWATCHES` (`src/design/room-identity.ts`) from 20 → **15**
> (9 bright + 6 dark): pruned the near-dupe clusters (four warm-oranges → Amber; three pinks → one
> Magenta; teal/cyan overlap → Teal), re-spread the survivors, and added a dark **Olive** `#5f5620`
> (paired ink `#f7f3e0`) in the empty dark-gold gap. Differentiation is VERIFIED by CIEDE2000: minimum
> non-preset pairwise distance **18.0** (was 13.4 for the flagged Magenta/Rose); the only closer pair is
> the LOCKED Teal/Emerald presets (14.3, both green). Legibility law + adaptive-ink mechanism unchanged.
> **Zero `src-tauri`.** Verify: tsc 0 · vitest **1600** (177 files) · CIEDE2000 differentiation audit ·
> fresh-context adversarial review (Magenta/Rose fix confirmed) · self-reviewer **PASS** (live CDP:
> Monitor/Plum text `#f4e9ff` on dark fill, Home/Olive room vars confirmed, Blackbook/Magenta text
> `#1a0a2e` on bright fill; 15-swatch grid clean 5×3).
> **KNOWN FOLLOW-UP (pre-existing, tracked — NOT this diff):** where chrome uses the room accent as
> direct TEXT on a dark background (Lab station tabs, Home dock, blackbook tags) a DARK accent renders
> ~2.5:1 — the adaptive ink covers accent-as-FILL only, not accent-as-TEXT. Shipped already with the
> prior 5 dark swatches (`8a9ab76`); a focused accent-as-text legibility train is queued (BACKLOG).
>
> **UPDATE 2026-07-13 (ACCENT PALETTE EXPANDED 10→20 SHIPPED `8a9ab76` — installer SHA-256
> `97C581BB4EF4EA47579939C2D9519F0603D72BF20FDA994BDDCAD7D9FEEE7698`, live exe stamp-verified
> `8a9ab76` via the embedded hash, installed by Claude, supersedes the `457A2D00…F73EBDCE` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner one-flip eyeball on the NEW palette is the
> open gate):** Owner Cycle-12k follow-up — *"more variety of color diversity, more neon or bright/dark
> tone mixed."* `ROOM_ACCENT_SWATCHES` (`src/design/room-identity.ts`) grows from 10 bright swatches to
> **20**: 15 bright/neon (adds Magenta/Azure/Chartreuse/Tangerine/Hot Pink) + **5 true DARK tones**
> (Indigo/Wine/Pine/Plum/Slate). Dark tones ride an **adaptive ink** — each dark swatch carries a paired
> light `ink`; `applyRoomAccents` (`src/design/theme.ts`) emits it as BOTH `--v2-accent-ink` AND
> `--ix-accent-ink` in the managed `<style>` per pick, so a dark accent FILL flips to legible
> light-on-dark; bright swatches emit no ink override (keep the default dark ink `#1a0a2e`). Legibility
> law mechanized BOTH ways (`room-accents.test.tsx`): every bright swatch ≥4.5:1 vs `#1a0a2e`; every dark
> swatch ≥4.5:1 vs ITS ink AND genuinely <4.5:1 vs `#1a0a2e` (adaptive ink is load-bearing, not
> decorative). **Zero `src-tauri`** (`git diff -- src-tauri` empty). Verify: tsc 0 · vitest **1600**
> (177 files) · adversarial fresh-context diff review **SOUND** (min contrast Pine 5.94:1) · self-reviewer
> **PASS** (live CDP 1500×980: Monitor/Indigo text `#ece9ff` on dark fill, Blackbook/Magenta text
> `#1a0a2e` on bright fill — contrast law holds both directions; 20-swatch grid clean 5×4). Supersedes
> the 12j picker's 10-swatch palette; the picker mechanism/wiring is unchanged.
>
> **UPDATE 2026-07-12 (PER-ROOM ACCENT PICKER SHIPPED `20e2b50` — installer SHA-256
> `457A2D00491672BD8F2C2DBF455EE1349975679FEB9206AD3EB7D419F73EBDCE`, live exe stamp-verified
> `20e2b50` via the embedded hash, installed by Claude, supersedes the `D23DE073…9EBA9` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner eyeball is the open gate):** Extends the
> per-room identity accents (Cycle 12i) with a **user-facing picker**. When `compy_room_identity` is ON,
> each room shows a small accent dot in the topbar far-right corner (`.v2-top`, after `.v2-stamp`,
> `src/design/ShellV2.tsx` under `useRoomIdentityFlag()`); click opens a 10-swatch curated popover
> (`src/design/RoomAccentPicker.tsx` + `room-accent-picker.css`) to recolor THAT room, persisted
> per-room, "Reset to default" restores the preset. Answers the owner's Cycle-12i follow-up — "the
> freedom to shift around the colors they want on each page" (the Settings THEME selector only recolored
> Home once room-identity was on). **Curated swatches, not a free hex field:** the palette
> (`ROOM_ACCENT_SWATCHES`, `src/design/room-identity.ts`) is validated ≥4.5:1 vs dark ink `#1a0a2e`, so
> the dark-ink legibility law stays unbreakable; the picker only renders under the flag, so the flag-off
> topbar is byte-identical. `readRoomAccents`/`setRoomAccent`/`applyRoomAccents` (`src/design/theme.ts`)
> drive a managed `<style id="compy-room-accents">` scoped `:root[data-room-identity="on"] .v2-room[data-room=X]`
> with same-element `--v2-accent`+dim+line (whitelist-validated); re-skins that room's chrome + rig +
> sparkline via the same scoped mechanism as the presets. **Zero `src-tauri`** (`git diff -- src-tauri`
> empty). Verify: tsc 0 · vitest **1595** (177 files) · self-reviewer **round-3 PASS 7/7** (agent
> `a1ea4efadff76d2f9`): popover-closes-on-room-nav, in-place sparkline repaint, and the reduced-motion
> compound selector all fixed + bug→guard-pinned (`room-accents.test.tsx`, 21 guards); adjacent behaviors
> intact (Blackbook→Rose `#ff8ac4` persisted across nav).
>
> **UPDATE 2026-07-12 (PER-ROOM IDENTITY ACCENTS SHIPPED `72fa005` — installer SHA-256
> `D23DE0732BAB2E510891482F6E501C728E8DC52AD60E5782A31358E74D19EBA9`, live exe stamp-verified
> `72fa005` via the embedded hash, installed by Claude, supersedes the `43234A53…943D5` installer;
> NEW flag `compy_room_identity` **DEFAULT OFF** — owner eyeball is the open gate):** Each room gains
> its own identity accent — the per-part 3D-rig color philosophy (owner's 2026-07-07 directive) extended
> to room chrome, resolving the Monitor/Blackbook accent-lock owner-taste call (Cycles 2026-07-12g/h;
> owner picked "per-room identity" 2026-07-12). **Palette** (single source `src/design/room-identity.ts`):
> Monitor(play) teal `#3fd9c2` · Blackbook(learn) amber `#f0b878` · Lab/Optimize(fix) emerald `#27e08a` ·
> Home violet `#a78bfa` (unchanged, no override). Behind `compy_room_identity` (`readRoomIdentity` `=== "1"`,
> `src/design/theme.ts`; Settings → Appearance "Room accent colors (preview)"), `src/surfaces/room-identity.css`
> scopes per-room `--v2-accent` + same-element re-declared `--v2-accent-dim/-line` washes to
> `:root[data-room-identity="on"] .v2-room[data-room=X]`; `SessionStack`'s sparkline ink + the rig bay accent
> resolve from the active `.v2-room` scope when on (Lab hologram cage/ring go emerald). Flag-off is
> **byte-identical on every room** (test-pinned). **CSS gotcha fixed (cost 2 self-review rounds):** a
> `var()`-chain inside a custom property substitutes at its DECLARING element, not the using element — so
> `:root`-declared dim/line washes can't retro-follow a per-room `--v2-accent` override; they must be
> re-declared same-element inside each room block. **Zero `src-tauri`** (`git diff -- src-tauri` empty).
> Verify: tsc 0 · vitest **1575** (176 files) · self-reviewer **round-3 PASS** (agent `a9b0cfd1f3c27234f`,
> all 8 rubric items: `.play-armed` border = teal under the flag; per-room `--v2-accent-line` teal/amber/emerald;
> flag-OFF restores `rgba(167,139,250,0.25)` violet byte-identical on every room; dark ink `rgb(26,10,46)`
> legible on all accent fills; rig idle GL probe clean, Home `--ix-accent` correctly unaffected).
> One NON-BLOCKING note: rig orbit-off settle burst measured 8,640 draws vs ~6k historical ref — reviewer
> classified benign (one-time settle → flat 0-growth, not a perpetual-invalidation loop).
>
> **UPDATE 2026-07-12 (BLACKBOOK CONSOLE PHASE 4 "THE LOGBOOK" SHIPPED `617db5b` — installer SHA-256
> `43234A53ED586A00AFBE163487BCDFBD8AE5D08147C15E1F910CE795C28943D5`, live exe stamp-verified
> `617db5b` via the embedded hash, installed by Claude, supersedes the `3B855DD1…FB003` installer;
> NEW flag `compy_blackbook_console` **DEFAULT OFF** — owner eyeball is the open gate):** Console HUD
> Phase 4, direction A "The Logbook" (plan `docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md`,
> UI_VISION_BACKLOG §E Phase 4). Behind `compy_blackbook_console` (`readBlackbookConsole` `=== "1"`,
> `src/design/theme.ts`; Settings → Appearance "Blackbook console (preview)"), the Blackbook room gains
> a flight-recorder **Logbook** face — a single hairline tape of Change/Session/Guide-check records
> (mono timestamps, type tags, body status line, library strip) synthesized by the pure `buildLogbook`
> over EXISTING data (changes/sessions already held); the field guide stays reachable via a
> Logbook|Field-guide SegmentedControl. The `"0"`/absent default renders today's Learn library
> byte-identical (pinned `blackbook-console-flag.test.tsx`). **Logbook is a pure READ view** (self-review
> r1 fix): no in-room undo surface — an active change routes to the Lab via a single `.bc-manage` "roll
> back in the Lab" jump (Lab is the one undo home, owner 2026-07-10); ZERO mutations, **zero `src-tauri`**
> (`git diff -- src-tauri` empty; no new IPC). New files under `src/surfaces/blackbook/`
> (logbook.ts · BlackbookConsole.tsx · blackbook-console.css + 3 test files). Verify: tsc 0 · vitest
> **1560** (175 files) · self-reviewer **round-2 PASS** (agent `a851ea6bd10a9f2d2`: 0 `.bc-undo` nodes,
> click-through to Lab live-confirmed; h1 == "Blackbook" title-header with the count in `.bc-status`
> body; `.bc-manage:hover` dark accent-ink on the fill; reduced-motion still; flag-off round-trip clean).
> **Known follow-up (NOT this diff — pre-existing systemic accent lock, same class as the Monitor
> follow-up below):** the room's `--ix-accent → --v2-accent` re-point locks `.bc-*` chrome to `#a78bfa`
> under Crimson (identical lock present on Monitor/Lab; 0 vendor-purple, internally consistent) — folded
> with the Monitor accent-mismatch into ONE owner-taste call, not fixed in-train.
>
> **UPDATE 2026-07-12 (MONITOR v5 CONSOLE FLIPPED DEFAULT-ON `e195f70` — installer SHA-256
> `3B855DD1454FD7F615F301A6C4808AC0EC1FB8AB409E9DFCCA939927972FB003`, live exe stamp-verified
> `e195f70` via the embedded hash, installed by Claude, supersedes the `DFE827D1…FB59` installer;
> flag `compy_monitor_console` **DEFAULT OFF → DEFAULT ON**, owner "flip it default on and silent
> reinstall"):** Owner approved the Monitor v5 console (Flight Deck + Session Stack, RTSS-style
> zero-anchored frametime scale, live `915e85b`) after learning it lived behind the DEFAULT-OFF
> "Monitor console (preview)" toggle → flipped to the build per ship-approved-work-as-the-build.
> `readMonitorConsole` (`src/design/theme.ts`) now `!== "0"` (default ON, mirrors Home/JARVIS);
> Settings row dropped "(preview)" → "Monitor console" (now the OFF failsafe); stale "DEFAULT OFF"
> code comments corrected (`Settings.tsx` + `use-hud.ts`). **bug→guard:** `monitor-console-flag.test.tsx`
> re-pinned to the DEFAULT-ON polarity (absent === console face byte-identical to "1"; "0" === the
> classic Basic face, both `compy_editorial` states); sibling `monitor-v2.test.tsx` re-pointed the
> same commit (sets the key "0" to keep pinning the classic tree). Zero `src-tauri`. Verify: tsc 0 ·
> vitest **1522** (172 files) · self-reviewer **PASS 8/8** on the installed build (default-ON renders
> the Flight Deck in Basic+Advanced; "0" failsafe restores classic with 0 reload; Settings label bare
> "Monitor console"; h1 bare "Monitor"; scopes honest "NO SIGNAL" at rest over the owner's REAL
> session history; dark accent-ink on every accent fill; 0 vendor-purple under Crimson; 0 idle
> draws/10s). **Pre-existing follow-up exposed by the flip (NOT this diff, logged in BACKLOG):** the
> Monitor room chrome (buttons/chips/mode-pill) is locked to static violet via `monitor-v2.css`'s
> play-room accent re-point while `SessionStack`'s sparkline follows the live theme — an internal
> accent mismatch under non-Violet themes only (invisible on the default Violet); not an
> illegibility/vendor-purple defect.
>
> **UPDATE 2026-07-12 (JARVIS MOTION LAYER FLIPPED DEFAULT-ON `fcc400b` — installer SHA-256
> `DFE827D1CB0F85F23DA383EDD1C215C3CDF6B3BF6FA00AB941FED931AFD8FB59`, live exe stamp-verified
> `fcc400b` via the embedded hash, installed by Claude, supersedes the `8EB6185D…812D10` installer;
> flag `compy_jarvis_motion` **DEFAULT OFF → DEFAULT ON**, owner eyeball "everything looks good"):**
> Owner approved the JARVIS motion layer (Cycle 2026-07-12c gate — he'd been living with it
> pre-enabled) → flipped to the build per ship-approved-work-as-the-build. `readJarvisMotion`
> (`src/design/theme.ts`) now `!=="0"` (default ON) + the `main.tsx` pre-paint boot attr; Settings
> row "JARVIS motion" (dropped "(preview)", now the OFF failsafe); the byte-identity anchor in
> `src/design/jarvis/jarvis-motion.test.tsx` re-pinned to explicit `"0"` (absence = ON) + a positive
> default-ON assertion. **This installer also carries the Cycle 2026-07-12d naming-drift fixes** (4
> user-facing retired-label leaks fixed — tweaks.json "Compy's Check", Term.tsx/blackbook-v2 "library"
> → "Blackbook", TuningInstrument "Play"→"Monitor" debrief; `src/stale-reference-guard.test.ts`
> extended to scan `src/surfaces` + `src/design` rendered copy). Zero `src-tauri`. Verify: tsc 0 ·
> vitest **1522** (172 files) · self-reviewer **PASS 8/8** on the installed build (default-ON from
> first paint with 0 flash `retuneAtRest:0`; retune fires once per room change t=21→314ms then
> self-removes; Settings label bare "JARVIS motion", toggle ON; "0" failsafe fully reverts + restores).
>
> **UPDATE 2026-07-12 (JARVIS MOTION LAYER SHIPPED `1d310e1` — installer SHA-256
> `8EB6185DEDBADE6FE1B6F9B5075F8E4ECF9945949748E102008205D9F9812D10`, live exe stamp-verified
> `1d310e1` via the embedded hash, installed by Claude, supersedes the `4F4DB63A…45B931`
> installer; NEW flag `compy_jarvis_motion` **DEFAULT OFF** — owner eyeball is the open gate):**
> UI_VISION_BACKLOG §A.2/A.3/A.5/A.6 built as ONE layer (rails: de-slop directive `:111-176`) —
> **A.5** Lenis smooth-scroll spine on the shell's content lane (`lenis@1.3.25` new dep, loaded
> only when active; nested scrollers auto-yield; rAF stops on hidden) · **A.6** room-transition
> "retune" wipe (accent hairline, 300ms transform-only, never on first paint/flag flip) · **A.3**
> magnetic rail tabs (GSAP quickTo ≤4px; Dock deliberately excluded — it owns the magnify lift)
> + Home stage chrome tilt ≤2.4° (existing pointer vars; the rig canvas never tilts — picking
> exact) · **A.2** gauge data-tick (GSAP ring flash ONLY on a real→real measured change; hologram
> shader uniforms deliberately excluded — the demand-frameloop idle-GPU law wins, deviation
> disclosed in UI_VISION_BACKLOG §A.2). Reader `readJarvisMotion` (`src/design/theme.ts`, `==="1"`),
> boot attr `main.tsx`, gate hook `useJarvisActive` (`src/design/jarvis/use-jarvis.ts` — flag AND
> resolved motion; reduced wins, mid-session flips live-verified). Flag-off byte-identity +
> honest-tick + reduced-wins pinned in `src/design/jarvis/jarvis-motion.test.tsx`. Zero
> `src-tauri`. Verify: tsc 0 · vitest **1364** (172 files) · self-reviewer **PASS 8/8** (live
> 1500×980; flag-on-at-rest chrome transform = identity; GL idle probe 0 draws/16s; rail-switch
> circuit ≲50ms with the sole 58ms outlier on the flag-OFF baseline).
>
> **UPDATE 2026-07-12 (Home title-header fix SHIPPED `cc1ffce` — installer SHA-256
> `4F4DB63A9955C97B8B54F5A590066E0DC88BBDC051230EF36BDE2068FB45B931`, live exe stamp-verified
> `cc1ffce` via the embedded hash, installed by Claude, supersedes the `63C3B563…D702233`
> installer):** the BACKLOG-flagged pre-existing violation closed — HomeConsole's h1 rendered
> postureLine's status sentence ("N thing(s) need your attention") against the owner's
> title-header law (2026-07-10 ×2). The console h1 is now the room TITLE ("Home", eyebrow
> unchanged); the posture verdict + trimmed dek relocate to a NEW `.hc-verdict` body strip above
> the stage (postureLine's real output, rendered exactly once — one-mention law; attention state
> inks warn, agreeing with the LED). The header keeps NO sub/descriptive line. Scoped like the
> rooms' `626b83c` sweep: live face only (HomeHud/HomeV2 devtools-only classic failsafes
> untouched). Guards re-anchored + extended in `home-console.test.tsx` (title pin · one-mention
> pin · attention tone pin · no-sub pin). Zero `src-tauri`. Verify: tsc 0 · vitest **1351**
> (171 files) · self-reviewer **PASS 8/8** (live 1500×980, real rig data incl. a real attention
> state; line contrast 16.78:1, dek 6.51:1; reduced-motion still page; no stage collision).
> Reviewer follow-up candidate logged in BACKLOG (ShellV2 topbar's static room tagline).
> Same session: Cowork's 2026-07-11 audit self-correction committed as-is (`e1cec74`).
>
> **UPDATE 2026-07-12 (EXPERT VIEW SHIPPED `5850ac0` — installer SHA-256
> `63C3B5639673AF822F2C26C45DF0672D6AEFEC0FAD02720E54ACC4861D702233`, live exe stamp-verified
> `5850ac0` via the embedded hash, installed by Claude, supersedes the `653FFEA0…9BADC2`
> installer):** the Q3 expert-layer train (spec
> `docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`, owner GO 2026-07-12) built as
> its own scoped train. One genuine Settings > Behavior preference — **"Expert view"
> (`compy_expert_view`, DEFAULT OFF, a real preference like Motion, NOT a preview flag; the
> default face is byte-identical, test-pinned).** ON = presentation-only un-hiding of existing
> data: refused drawer renders open with reasoning inline (no barred-tier apply affordance —
> LOCKED rule 6a untouched) · exact target (registry key/value · service · powercfg GUIDs ·
> Settings-page path) inline on safe + needs-your-call rows via the display-only
> `src/data/expert-targets.ts` map, transcribed from `actions.rs`/`services.rs` and
> literal-pinned by `expert-targets.test.ts` · **the GO's ship condition MET + mechanized:** the
> rollback-boundary disclaimer ("Edits made outside Compy aren't tracked and can't be rolled back
> by Compy.") renders beside EVERY inline target (`expert-view.test.tsx` pins disclaimer count ==
> target count) · true `local_percentiles` (1-decimal) replace the "Top N%" bucket on Benchmark
> receipts, session tiles/deltas at 1 decimal · the long-tail sections (Fix collapsibles, Check
> piles, Optimize-station ledger/cleanup disclosures) render open. **Zero `src-tauri` diff — no
> gate moved, no mutation path added.** Verify: tsc 0 · vitest **1350** (171 files, +28 guards) ·
> self-review **PASS** (live 1500×980; noted honestly: expert-ON Optimize is a ~10.6-screen
> scroll — the accepted cost of the full panel).
>
> **UPDATE 2026-07-11 (CONSUMER-PANEL OVERHAUL SHIPPED `50b5c03` — installer SHA-256
> `653FFEA0928E3372CA33ECB818EC6BF8A21B01CBB6A3B7250194DB5B3A9BADC2`, live exe stamp-verified
> `50b5c03` via the embedded hash, installed by Claude, supersedes the `3B3A65C4…B19DAD` installer;
> flag `compy_monitor_console` still **DEFAULT OFF**, v5 owner eyeball still ITS open gate):** the
> five-persona panel plan (`docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md` — Q1–Q4
> owner answers + per-item commit citations recorded in-file) built end to end. App: safe-stack
> caption is a state observation ("All N already on for this rig" — Phase 0 verified
> `currently_applied` is a live probe, `recommendations.rs:315`), VBS advisory reframed as a
> decision, Term glosses at first exposure (Home/Lab "1% low" gauges, ETW, frametimes; **Monitor
> jargon bucket deferred until the v5 eyeball settles**), readiness gauges state their formula
> ("= N of M checks passed"), NEW **TrustMoment** one-time watch-it-work loop (audited
> apply→rollback IPC only, ledger-empty gate, HKCU whitelist, consent-first), gaming recovery
> banner + pane card reframed protection-first ("Nothing's lost … kept the full restore receipt",
> calm tone — never-hide mechanism untouched). **Settings flag-debt sweep (Q2=A): 11 graduated /
> UI-inert toggle rows REMOVED** (Living Instrument, Guided Lab bench, Lab checkup bento, Lab
> proving ground, Instrument HUD, Home console, Setup stepper, First-check theater, Monitor summary
> cards, Hologram bay v2, Two futures split) — features unchanged, flags still honor localStorage
> via devtools; **the "Settings → Appearance row is the classic failsafe" lines in the 2026-07-10
> Home-console and Lab-ground banners below are SUPERSEDED — those failsafes are now
> devtools/localStorage-only.** "Monitor console (preview)" is the one remaining preview row. Site
> (dark, owner taste-gates before publish): hook kicker promoted to h1, "Compy is free." above the
> fold, proof-loop receipt = accessible hero visual (example-framed), start-here trio over raw
> counts, per-card one-line "Why:" (the tier now argues). Q3 = **proposal only, awaiting owner GO**
> (`docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`). Zero src-tauri. Self-review
> round 1 **FAIL — 4 real catches** (Term mixed-case in uppercase labels · tooltip shouting caps ·
> Lab tooltip 126px off-window · site h1 3-line wrap), all fixed + guard-pinned
> (`term-style-guard.test.ts`) → round 2 **PASS** (computed-style + line-box proofs). Verify:
> tsc 0 · vitest **1322** (167 files) · site-landing 15/15.
>
> **UPDATE 2026-07-11 (RTSS-style ZERO-ANCHORED frametime scale SHIPPED `915e85b` — installer
> SHA-256 `3B3A65C45C4BF63942373612CA19353EAFAB16CED10EE8A71F83143271B19DAD`, live exe
> stamp-verified `915e85b`, installed by Claude, supersedes the `0AA8E222…F21A55` installer;
> flag `compy_monitor_console` still **DEFAULT OFF**):** the owner REJECTED the envelope look
> on sight ("this is atrocious … research clean and comprehensive frametime graphs or just
> match riva tuners") — **envelope mode is DELETED** (band + median curve + note). Research
> applied (RTSS "graph max" / CapFrameX fixed y-range): the DeckScope frametime hero now draws
> the RAW per-frame line against a **stable zero-anchored ms scale** (`niceCap` frame-budget
> landmarks 8.3/16.7/25/33.3/50/100/250) with labeled quarter-cap gridlines + right-edge ms
> labels; axis states "0–\<cap\> ms scale · budget X ms". Root cause named: window-min/max
> normalization stretched ~3 ms of jitter to full chart height — the envelope had treated the
> symptom. fps + Home traces (default "window" scale) byte-same; `monotone.ts` stays
> (SessionStack rows). Verify: tsc 0 · vitest **1311** (165 files) · self-reviewer **PASS 8/8**
> (live real-density mount: calm line low on the chart, spikes tower, budget ≈14% up at
> 6.9/50, scrub raw-exact, zoom rescales zero-anchored, fps/Home unchanged).
> **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 scope ENVELOPE mode SHIPPED `e02d1ad` — installer SHA-256
> `0AA8E222755F082B7D75AF8EAEB3BA7A14DDFEFF97711C8483A456B319F21A55`, live exe stamp-verified
> `e02d1ad`, installed by Claude, supersedes the `05399D9D…EA7B7459` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner round-2 ask on the v5 eyeball ("make
> the lines not so tightly packed and erratic without … taking away from the accuracy … the
> transient spikes are just a little overbearing and chaotic") — dense frametime windows
> (≥120 samples) now draw a faint **min–max band** (each bucket's TRUE extremes, nothing
> clipped) under a **monotone median line** (the typical frame; the shared Fritsch–Carlson
> math extracted to `src/design/console/monotone.ts`, SessionStack refactored onto it). Spike
> markers, worst-spike callout, and scrub stay RAW per-sample; drag-zoom below 120 samples
> returns the raw polyline; caption states "line = typical · band = every frame". fps scope
> deliberately stays raw. Self-review round 1 **FAIL — real catch:** the median `<path>`
> escaped the non-scaling-stroke selector and rendered fat (the exact `f2acb23` class); fixed
> (`.osc-grid path` covered) + the line-discipline guard strengthened to require selector
> coverage of line/polyline/path → round 2 **PASS** (computed vectorEffect + side-by-side
> stroke-weight proof on a live real-density mount). New guards: `envelopeProfile`
> truth-table · dense⇒band+path+note w/ raw-exact spike x · sparse⇒raw · no-prop⇒raw.
> Verify: tsc 0 · vitest **1311** (165 files). **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 scope-line sharpening SHIPPED `f2acb23` — installer SHA-256
> `05399D9DE7B2601EC2080CADA2036351DC52D3946C4C3372A99F5290EA7B7459`, live exe stamp-verified
> `f2acb23`, installed by Claude, supersedes the `5AE1ED22…C7821236` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner quick-fix on the v5 eyeball ("lines
> need to just be sharpened and sleek no added bloom or saturation/thickness") — the Oscilloscope
> trace glow (drop-shadow of `--ix-accent-dim`, theme violet blooming around graded ink) is
> DELETED; every scope stroke wears `vector-effect: non-scaling-stroke` (the stretched viewBox
> no longer fattens strokes); trace 1.5→1.25px, ink/hue untouched. bug→guard "line discipline"
> test in `oscilloscope.test.tsx` (no drop-shadow declaration in live CSS · non-scaling-stroke
> present · trace ≤1.5px). Verify: tsc 0 · vitest **1307** (165 files) · self-reviewer **PASS
> 8/8** (computed `filter: none` both motion states on a live mount, zoomed crops halo-free).
> **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 trace-line refinement SHIPPED `e900b6a` — installer SHA-256
> `5AE1ED22BD308C4C877EF7D71155A65B77028736B7193C55E9197656C7821236`, live exe stamp-verified
> `e900b6a`, installed by Claude, supersedes the `A4D3BF98…D147E0` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner ask on the v5 eyeball ("clean up and
> refine how the actual line on the graph looks") — stack row traces now stroke a **monotone
> cubic (Fritsch–Carlson)** curve with round joins/caps (passes through EVERY real sample, never
> overshoots — smooths the min-per-bucket sawtooth corners, never the data; pin dot verified on
> the curve minimum) and the scope SVG traces gain round joins/caps, geometry unchanged. Guard:
> bezierCurveTo + round-join pin in `session-stack.test.tsx`. Verify: tsc 0 · vitest **1306**
> (165 files) · self-review **PASS** (zoomed real-data crops — no sawtooth, dips keep true
> depth). **⏳ OWNER eyeball still the open gate.**
>
> **UPDATE 2026-07-11 (Monitor v5 "FLIGHT DECK + SESSION STACK" SHIPPED `960734c` — installer
> SHA-256 `A4D3BF98DCE1CF57740C9163CF4393F5F7499168946630EA485D974706D147E0`, live exe
> stamp-verified `960734c` (embedded-hash proof), installed by Claude, supersedes the
> `C2E0FF70…3E90238` installer; flag `compy_monitor_console` still **DEFAULT OFF**):** the owner's
> round-3 pick **"A's top + B's stack"** built per plan
> `docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md` (T1–T5: `d06a63c` pure data ·
> `69c8f90` SessionStack · `255a400` Flight Deck assembly · `0c68553` polish · `960734c`
> coverage fix). ONE face, two halves, NO mode toggle: **Flight Deck** (consumer readouts ·
> `DeckScope` full-width frametime hero w/ hover scrub + nested drag-zoom + stated ms-span/budget
> · session-scoped plain-number delta row, cross-game labeled "(DIFFERENT GAME)", changes-on tag)
> + **Session Stack** (last ≤5 sessions as flat rows on ONE shared 1%-low axis, ONE worst-dip pin
> w/ exact clock time per row, VS PREVIOUS chips, current-game filter, expand-detail). The v4
> **SessionWaterfall + `waterfall-profile` are DELETED** (Now/Compare toggle gone; surviving
> guards re-anchored in `monitor-stack-profile.test.ts` / `session-stack.test.tsx` /
> `deck-scope.test.tsx`). Self-review round 1 **FAIL — the real-density law caught a real one**:
> the 10.5 h Sand session's timeline (backend-capped at ~2 h) drew as a sliver because row x
> normalized to `duration_secs`; fixed (`960734c`: rows draw the RECORDED span, partial coverage
> STATED — "first 2h 0m recorded" + detail-line note, pins only anchor inside coverage) +
> guard-pinned (coverage<<duration truth-table the old fixtures never exercised) → round 2
> **PASS 8/8 on the real 5-session data**. Flag-off byte-identity re-pinned BOTH
> `compy_editorial` states (`monitor-console-flag.test.tsx`). Verify: tsc 0 · vitest **1305**
> (165 files) · cargo **688**. **⏳ OWNER eyeball is the open gate** — Settings → Appearance →
> "Monitor console (preview)", both modes.
>
> **UPDATE 2026-07-11 (v4 waterfall READABILITY REWORK SHIPPED `915cb96` — installer SHA-256
> `C2E0FF709DDF65256E757E2D3903CCA133207DEB614B2C59A6AE5666C3E90238`, live exe stamp-verified
> `915cb96` (embedded-hash proof), installed by Claude, supersedes the `44610BF6…D370A30`
> installer; flag `compy_monitor_console` still **DEFAULT OFF**):** the owner REJECTED the
> `85eb8c6` waterfall on eyeball ("this looks absolutely terrible … what a mess") — the banner
> below's round-2 "PASS 8/8 against real production data" was WRONG on readability: real
> multi-hour timelines drew as smears, dip pins as a barcode, legend printed over chart ink,
> Live|Sessions duplicated the room's segment labels. Rework (`082414c` + `915cb96`):
> `downsampleTimeline` min-per-bucket ≤160 drawn samples · `MAX_LAYER_PINS=3` worst-dip caps ·
> `layerAlpha` ramp · legend moved OUT of the stage (alpha swatches, middot grammar) · back
> baselines dropped, LIFT 30/SCALE_STEP .08 · modes renamed **Now/Compare** · stage 300px.
> Bug→guard ×2: draw-density discipline pinned in `waterfall-profile.test.ts`
> (`MAX_DRAW_POINTS`/`MAX_LAYER_PINS`) + self-reviewer rubric gained the **real-density law**
> (fixture-scale PASS ≠ PASS). Verify: tsc 0 · vitest **1320** (167 files) · fresh full
> self-review round **PASS** (all items, real 5-session data, own-eyes iterated on the live dev
> instance first). **⏳ OWNER eyeball (round 2) is the open gate** — Settings → Appearance →
> "Monitor console (preview)", both modes.
>
> **UPDATE 2026-07-11 (Monitor v4 "SESSION WATERFALL" SHIPPED `85eb8c6` — installer SHA-256
> `44610BF6F168E83741DD04A9EBD24D14A566EB2828238B1AFB67B0647D370A30`, live exe stamp-verified
> `85eb8c6` (embedded-hash proof; owner queueing for a game, no CDP relaunch), installed by Claude
> on the owner's go while between games, supersedes the `33661b8` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** the owner's concept-round-2 pick (B "Depth
> Waterfall" + A's drag-segment, lean into previous-session comparison — verbatim in the plan) is
> built as the console hero, replacing the REJECTED v3 ribbon (**FrametimeRibbon + ribbon-profile
> DELETED**, r3f chunk gone from this face). `SessionWaterfall` (2D canvas, token inks): LIVE mode
> (ms axis) = flat front scope + dashed budget + exact-moment spike pins + drag-zoom/double-click
> reset + scrub readout, depth layers = receding snapshots of the SAME capture (cleared on stop,
> never frozen-as-live); SESSIONS mode (1%-low fps axis) = the last ≤5 sessions' real
> `stutter_timeline` layers, stacked legend labels, `stutter_events` dip pins with real labels,
> delta strip vs the same-game prior ("VS PREV SAND"; cross-game fallback labeled "DIFFERENT
> GAME"), same-game filter, "N COMPY CHANGES ON" context tag; honest empties throughout; units
> never mix per scene. Zero new IPC, **zero src-tauri** (diff-verified empty; `SessionSummary` TS
> type gained the timeline fields the backend already sent). Self-review round 1 **FAIL** (4 real
> catches: idle stopped polls churned a fresh [] reference → 1 Hz canvas repaints at rest;
> empty-scene hover repainted under reduced motion; legend overlap at the real 5-session history;
> bare cross-game delta read as a −216 fps regression) → all fixed + bug→guard-pinned in `85eb8c6`
> → round 2 **PASS 8/8** against real production data (idle 0 draws/12 s both modes). Verify:
> tsc 0 · vitest **1315** (167 files) · flag-off byte-identity re-pinned BOTH `compy_editorial`
> states (`monitor-console-flag.test.tsx`). **⏳ OWNER eyeball is the next gate** (Settings →
> Appearance → "Monitor console (preview)", ideally mid-capture AND with ≥2 recorded sessions —
> both modes; default-ON only on his verdict).
>
> **UPDATE 2026-07-10 (consumer-terms preset relabel SHIPPED `33661b8` — installer SHA-256
> `7C1EC6891F37BC3515AC05DD27C7E72FD4D3E63C860EF086B7BA7806113BB888`, stamp-verified LIVE `33661b8`,
> installed by Claude, supersedes the `6932fa7` installer):** UI_VISION §A0 item 6 closed — the
> Monitor tuning-preset trio the owner flagged ("Visual Fidelity / Smooth / Clarity") is now
> **"Max Quality" / "More FPS" / "Lower Latency"** (ids stable; labels test-pinned in
> `monitor-view.test.ts`). Chips are goal-register comparatives, deliberately NOT the console
> readouts' verbatim stat terms — self-review round 1 caught literal "Max FPS"/"Low Latency" chips
> rendering on the same screen as the measured "MAX FPS"/"LOWEST LATENCY" readouts; "High
> Resolution" not used (preset bundles HDR+VRR, nothing touches resolution — honesty rail; owner may
> overrule at eyeball). Also: RigViewer chromed hint → "hover or click a part" (§A.4 residual;
> reviewer finding logged — the chromed RigViewer path is currently unreachable dead code, cleanup
> is its own candidate). Verify: tsc 0 · vitest **1253** (166 files) · zero src-tauri ·
> self-reviewer round-2 **PASS 8/8**. **⏳ OWNER eyeball unchanged: Monitor console (preview)** —
> the same Monitor room now also shows the relabeled presets.
>
> **UPDATE 2026-07-10 (Monitor v3 "TELEMETRY RIBBON" SHIPPED `6932fa7` — installer SHA-256
> `E9737D6EE5E05E2CE210DE4000578507F5ACBEC4CDC3A074C4086351D832421E`, stamp-verified LIVE `6932fa7`,
> installed by Claude AFTER the owner's Palworld session ended (reinstall deliberately deferred
> mid-game); code-complete at `4c051e0`, `6932fa7` = docs-only on top; flag `compy_monitor_console`
> still **DEFAULT OFF**):** the owner rated the v2 cluster "satisfactory", gave binding direction
> (retained verbatim: `docs/UI_VISION_BACKLOG.md` §A0) and chose the **3D ribbon** concept. v3 =
> `Oscilloscope` v2 (full-width window — his caught half-width bug — dashed budget line at
> 1000/refreshHz, exact-moment spike markers via pure `spikeIndices`, worst-spike ms callout ONCE
> in the strip caption) + consumer-term readouts (MAX FPS · AVG FPS · LOWEST LATENCY · SPIKES,
> `monitor-console-data.ts`, em-dash never 0) + lazy r3f `FrametimeRibbon` hero (real per-frame
> extrusion, spike cones, budget plane, orbit, `frameloop="demand"`, mounts ONLY on a live window)
> + overlay toggle/corner ported verbatim + uniform stage tilt (depth never warps data ink — the
> direction spec's Monitor row carries the owner's 3D/parallax amendment). Self-review round 1
> **FAIL** (real catch: content-equal 1 Hz polls repainted the demand canvas — GL probe +8
> draws/tick) → fixed `4c051e0` (content-stable `ftWin` ref + reference-identity bug→guard) →
> round 2 **PASS 8/8** (idle flat 15s, repaints on real change, orbit animates). Verify: tsc 0 ·
> vitest **1252** (166 files) · zero src-tauri across the whole v3 train. **⏳ OWNER eyeball is the
> next gate** (Settings → Appearance → "Monitor console (preview)", ideally mid-capture — the
> ribbon needs live frames). Residual (explicit): overlay density/backdrop config stays on the
> classic face.
>
> **UPDATE 2026-07-10 (Phase-3 Monitor console BUILT + SHIPPED `3fbd371` — installer SHA-256
> `7E74216CF47CAE3FA2D09A6E874A0F21A305D4D1925D363A869D61B15C97295D`, stamp-verified LIVE `3fbd371`,
> installed by Claude, supersedes the `bce72d6` installer; flag `compy_monitor_console` **DEFAULT
> OFF**):** the Console HUD's Phase 3 (plan `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md`,
> entry gate cleared by the owner's go on the instrument-cluster concept, 2026-07-10) is on the live
> installer behind a NEW preview flag — **flag off (the shipped default), Monitor is byte-identical
> to the previous build** (`readMonitorConsole` → `=== "1"`, `src/design/theme.ts:566`; pinned in
> `monitor-console-flag.test.tsx` for BOTH `compy_editorial` states). Flag ON (Settings → Appearance
> → "Monitor console (preview)"): the Monitor room's LIVE face becomes the instrument cluster — a NEW
> `Oscilloscope` kit component (`src/design/console/Oscilloscope.tsx`: pure render of the caller's
> real buffered samples, no self-driven rAF, empty buffer ⇒ honest "no signal", never a synthetic
> line) drawing rolling fps + frametime traces (fps = the real polled capture samples, cleared the
> moment the helper stops — never frozen-as-live; frametime = the backend's real per-frame
> `recent_frametimes_ms` window the Overlay already draws) + ArcGauges over GPU temp (vendor-gated
> tone, NVIDIA ungraded per LOCKED rule 5) / CPU (ungraded by design) / RAM (+ GPU load in Advanced).
> Same three 1 Hz read-only polls MonitorBasic/Play live run, ported verbatim — **zero new IPC, zero
> src-tauri** (`git diff 1527d61~1..3fbd371 -- src-tauri/` empty). Capture control = the same audited
> toggle; V2-8 `onFpsActive` door mirror preserved; Sessions face + TuningPresets untouched; Basic
> keeps the last-session door. Motion layer = Phase 2's mechanisms (spotlight · `backwards` reveal ·
> stage reticle), deliberately NO hologram and NO parallax over the traces; reduced ⇒ still page.
> Home console stays DEFAULT ON from `bce72d6`. Verify: tsc 0 · vitest **1236** (164 files) ·
> self-reviewer **PASS** (8/8 at native 1500×980: stopped-state honesty, visual stillness at rest —
> two shots 12s apart differ only in real sensor numbers, accent-ink contrast computed, flag-off
> classic round-trip, Crimson spot-check; the violet capture button under Crimson traced to the
> pre-existing test-pinned per-room accent re-point `src/surfaces/monitor-v2.css:31`, not this
> train). Known preview gap (owner reaction decides): the Advanced console face shows the instrument
> cluster only — overlay controls + deep monitoring stay on the classic face. **⏳ OWNER eyeball is
> the next gate** (taste gate before default-ON and Phase 4 History/Black Box per the direction
> table).
>
> **UPDATE 2026-07-10 (Home console DEFAULT-ON, SHIPPED `bce72d6` — installer SHA-256
> `2DA1340D8BC5AA3337AFACF0C36FAE450684E50ED73E54A517AE98F6ACE6F3E4`, stamp-verified LIVE, installed by
> Claude, supersedes the `80c69f1` installer):** the owner's verdict ("everything looks good", 2026-07-10,
> which also confirmed the T6c gaming-mode Resume worked live) cleared the Phase-2 eyeball gate →
> **`compy_home_console` is DEFAULT ON** (`readHomeConsole` → `!== "0"`, `src/design/theme.ts:536`) per
> ship-approved-work-as-the-build. Home opens as the console cold-open for everyone; **Settings →
> Appearance → "Home console" (row dropped "(preview)") set to OFF is the classic-Home failsafe** —
> byte-identical to the pre-console tree for BOTH `compy_editorial` states, live round-trip verified no
> reload. Pins re-anchored in `home-console-flag.test.tsx` (new default contract) +
> `home-hud-flag.test.tsx` / `hologram-orbit-optin-guard.test.tsx` (the "0" failsafe for the layers they
> guard; NEW console-stage orbit pin — fresh default = no unattended rotation, idle 0 GL draws/16s).
> Zero src-tauri. Verify: tsc 0 · vitest **1210** (161 files) · self-reviewer **PASS** (dev-webview
> evidence; settings round-trip both ways, "(preview)" grep-clean). **Phase 3 (Monitor) is planned:**
> `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md` — new flag `compy_monitor_console`
> DEFAULT OFF, `Oscilloscope` kit component on the real live telemetry, builds in a FRESH session.
>
> **UPDATE 2026-07-10 (T6c one-click Resume + mount-aware banner deferral SHIPPED `80c69f1` — installer SHA-256
> `B7F0148A1F8F50ED76267E2B7580A4636463FB71D9F4E02FD5DA61E895BDCFA0`, stamp-verified LIVE, installed by Claude,
> supersedes the `72d9b6e` installer):** the owner's 2026-07-10 directive built — the GLOBAL gaming-recovery
> banner (`src/App.tsx`, `.gaming-recovery-banner`) now leads with one-click **"Resume Gaming Mode"** (the pane's
> audited `recover_gaming_session(confirm)` → `start_gaming_session` sequence verbatim — rollback-first, restore
> to TRUE priors, then an explicit user-clicked restart; never zero-click on launch), keeps "Restore now" as
> secondary, and "Review" no longer clears the recovery (no dead-end behind a closed disclosure). Resume restarts
> with the interrupted session's OWN tiers via `resumeOptionsFrom` (`src/surfaces/gaming-mode.ts`) — derived from
> its recorded change labels; the pane's checkboxes reset on remount and silently downgraded a resumed
> advanced-tier session (pane's `onResume` fixed too). The 2026-07-10d **carried note is RESOLVED**: banner
> deferral is now MOUNT-AWARE (pane announces via `GAMING_PANE_(UN)MOUNTED_EVENT`) — a pending recovery is no
> longer invisible on the Lab/Optimize tabs outside the gaming door. Round-1 self-review caught a pre-existing
> app-wide cascade bug: bare `.btn-small-on` lost the tie to the later `.btn-small` base rule (accent ink dead on
> all 7 call sites) and the generic hover painted the primary danger-red → `.btn-small.btn-small-on` double-class
> + hover override (`src/App.css`), guard-pinned in `src/button-legibility-guard.test.ts`. Zero src-tauri (no new
> IPC/mutation primitive — audited commands only). Verify: tsc 0 · vitest **1208** (161 files, +5 pins net) ·
> self-reviewer round-2 **PASS** (computed accent proof at rest+hover; one-prompt-at-a-time proven live against a
> REAL orphaned session found on the rig — the owner will be greeted by this exact banner, with Resume, on next
> look). T6b (batched restore-side elevation) remains a separate open candidate.
>
> **UPDATE 2026-07-10 (Phase-2 Home console cold-open BUILT + SHIPPED `72d9b6e`, flag `compy_home_console` DEFAULT OFF):**
> the Console HUD's Phase 2 (plan `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`) is on the live
> installer behind a NEW preview flag — **flag off (the shipped default), Home is byte-identical to the previous
> build** (test-pinned both ways in `home-console-flag.test.tsx`). Flag ON (Settings → Appearance → "Home console
> (preview)"): Home opens as the console cold-open — the real 3D rig hologram center-stage in a bracketed stage,
> four honest corner arc gauges (Readiness ratio · Avg FPS · 1% low · GPU temp — absent ⇒ NOT-YET, never a
> fabricated 0; NVIDIA temp stays ungraded per LOCKED rule 5), HomeHud's proven masthead register, edge
> annotations, the #1-limiter context row with its "See in Lab" jump, and a **Dock of room doors** (the
> `railFor` ground rail minus Home — Monitor · Blackbook · Lab, Lab primary; RoomShell's ForwardDoor suppressed
> while the dock renders so Home keeps exactly ONE forward affordance — the self-reviewer's round-1 duplication
> catch, bug→guard-pinned). Motion layer (spotlight · staggered reveal · stage reticle · annotation parallax)
> fully stilled under reduced motion. **Entirely frontend: `git diff 5b79d58~1..72d9b6e -- src-tauri/` is
> EMPTY.** Verify: tsc 0 · full vitest **1203** (161 files, +21 pins) · cargo **688** · self-reviewer round-2
> **PASS** (fresh full pass at `72d9b6e` incl. the canvas idle probe: 0 GL draws over 16s at rest, orbit
> re-engages). ⏳ OWNER eyeball: flip **Settings → Appearance → "Home console (preview)"**, open Home, react —
> the taste gate before default-ON and before Phase 3 (Monitor).
>
> **UPDATE 2026-07-10 (proving-ground DEFAULT-ON + standalone Optimize tab DROPPED, SHIPPED `59249bb`):** the
> owner's round-4 verdict ("ALL GOOD") cleared the Ops Console eyeball gate, so both decided 2026-07-10 calls
> shipped in one train: **`compy_lab_ground` is DEFAULT ON** (`readLabGround` → `!== "0"`, `src/design/theme.ts:326`)
> and the **standalone Optimize tab is REMOVED** — the rail is Home · Monitor · Blackbook · Lab
> (`railFor(merged, ground)`, `src/design/homeRail.ts:42`); the Lab's Optimize station is the ONE door to the
> safe-tweak toggles. Everything fix-flavored re-routes to the Lab under ground: Home's limiter buttons
> ("See in Lab"), Home's forward door (`doorFor`, `src/design/room-shell.tsx:39`), the gaming-recovery banner's
> "Review", navHome/HOME_FOR_TAB fallbacks, and the Setup & Tour (4-room recap + lesson ties + seatbelt ledger
> room). The self-reviewer's round-1 catch — the decided "undo stays reachable via the Lab panel" had NO ledger
> surface in the station — was fixed before ship: OptimizeStation now carries an "Applied & history — every
> change, undoable" disclosure rendering the classic room's audited `<Fix view="ledger">`
> (`src/surfaces/lab/OptimizeStation.tsx:170`, guard-pinned in `lab-ground.test.tsx`). **`compy_lab_ground="0"`
> (Settings → Appearance → "Lab proving ground") is the full classic failsafe** — rail, tabs, rooms and tour
> restore live, no reload (live-verified round-trip). The "Remaining owner call: drop the standalone Optimize
> tab at default-ON" lines in the dated banners below are RESOLVED-SHIPPED by this train.
>
> **UPDATE 2026-07-10 (console round-3 owner catches SHIPPED, `889de10`):** owner round-3 eyeball caught two
> Ops Console bugs — the resting Optimize dock node read as pre-selected (primary wore the exact active accent
> border; now a 35% color-mix border, active alone gets full accent + tinted fill) and the safe-stack ring's
> "8/9" readout painted over the ring's top stroke (baseline flex anchored it to the box top; now centered via
> an inner `.lab-gauge-txt` baseline group). His requested abnormality sweep also caught + fixed a drift
> contradiction: the ring caption re-framed a drifted rec as "1 left to enable" against the corner gauge's
> "0 ready" — the caption is now drift-aware. All three guarded (`optimize-gauge-dock-guard.test.tsx`, 7 tests).
>
> **UPDATE 2026-07-10 (title-header law SHIPPED, `626b83c`):** owner round-2 feedback on the Ops Console eyeball —
> a room header is a **TITLE** (h1 = the room name, never a status/notification/description sentence). All 5 v2
> rooms' hud-on h1 is now the room title ("Lab" / "Optimize" / "Monitor" / "Blackbook"); every displaced
> verdict/status line relocated into its body context (drift guidance → Fix drift intro · undo promise → Fix
> consent line · Monitor's last-session answer → Play hero · Blackbook record + autopsy hint → Learn). Home's
> masthead verdict KEPT (cold-open answer, flagged for owner taste). Law mechanized as self-reviewer rubric item 6
> (upgraded). Remaining owner call unchanged: drop the standalone Optimize tab at default-ON.
>
> **UPDATE 2026-07-10 (header-slop sweep SHIPPED, `1a9f44f`):** owner round-1 feedback on the Ops Console eyeball —
> **Optimize open-on-click CONFIRMED** ("cleaner") + a new app-wide **header-slop law** (tab header space carries
> header-format text only; small always-on descriptive lines relocate to their context). Shipped same day: the four
> rooms' `.v2-measured` strips removed, the Lab header cut to eyebrow + headline, the console lede deleted (undo promise
> relocated into the Optimize panel), law mechanized as self-reviewer rubric item 6. Remaining owner call: drop the
> standalone Optimize tab at default-ON.
>
> **UPDATE 2026-07-09 (Lab "Ops Console" Phase 1 SHIPPED, `63585e9` — post whole-branch review):** the bento Instrument Bench was owner-rejected
> ("generic slop / wide horizontal boxes"); the owner-picked **"Ops Console"** direction
> (spec `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`, plan
> `docs/superpowers/plans/2026-07-09-console-hud-phase1-lab.md`) Phase 1 is now the live installer below — the real 3D rig
> hologram at center, four honest corner arc gauges, a magnify Dock of stations — still behind `compy_lab_ground`
> **DEFAULT OFF** (app byte-identical until the owner flips the preview). The **Optimize-tab deferral stays OPEN**: with the
> preview on, the standalone Optimize rail tab still coexists with the Lab hero, and the Optimize-panel open-on-click-vs-always
> call is owner-gated before default-ON (OWNER_ACTION_CHECKLIST).

> **⟢ HISTORICAL ship-snapshot table (2026-07-17, HEAD `28648b2`) — SUPERSEDED, NOT current state.**
> This "Field | Value" table records the 2026-07-17 `28648b2` ship. It is **older than the CURRENT
> STATE block at the top of this file**, and its installed-build facts are STALE: the live installer
> is now `Compy_0.9.0_x64-setup.exe` from **`37a166c`** (SHA-256 `6BC2F7DF…F5A2C4`), per CURRENT
> STATE. Kept for history; do NOT read the row below as the current installed artifact. Where it
> disagrees with CURRENT STATE, CURRENT STATE wins.

| Field | Value |
|---|---|
| Git HEAD | `28648b2` + this ship-docs commit (branch `main`, 2026-07-17 — the live installer is built from exactly `28648b2`; live stamp-verified `28648b2 · release` CLEAN via CDP `get_build_stamp` + embedded-hash byte-scan). **Chain since the previous table refresh (`d45bb1c`, 2026-07-17a):** `9c6af4b`+`094d834` (Intelligence Phase 2 — cross-session patterns · good-vs-bad investigator · evidence graph) → `cd66ce9` (Home verdict regression fix) → `7e00a06` (Intelligence Phase 3 DARK — engine + optimization simulator) → `e16b231` (Phase 3 ARM — `experiment_gate()` `false`→`true` + FE ExperimentBench, mutation-gate GO-LIVE) → `aa570d2` (build.rs `+dirty` root-anchor fix) → `4cc4ed5`/`04684e6` (Lab Optimize note rounds 1–2 — reversibility invariant, bug→guard) → `28648b2` (HUD byte-identity flake fix, HEAD at build); see the top Snapshot banners for each. **Prior refresh chain (`b968f0a`→`d45bb1c`, 2026-07-16→17a):** `3455782` (leftovers restore ARMED — Optimization Cleanup Phase 1 mutation-gate flip) → `27bc472` (version 0.1.0 → 0.9.0, owner call) → `c8c9cdc`/`dca1bc9`/`0078f70` (0.9.0 ship-docs · ship-reinstall BOM guard · auto-deploy-cancel decree) → `8f612d2` (Intelligence Phase 1 foundation + What-Changed slice) → `d45bb1c` (game-name display class sweep, HEAD at build); see the top Snapshot banners for each. **Older chain (`86ecad1`→`b968f0a`):** `4bf2a91` (`--run-elevated` boundary-side guard, 2026-07-15 re-cut) → `50b505e`/`f4b4ada`/`40bce4e`/`f160839` (console trains 1–4 default-ON + overlay backdrop fix, 2026-07-15f ship) → site-lane commits (site-only) → `92596d6`/`47300d9`/`b2d775d`/`d0392c9` (palette 8+7 rework · gradient-ink de-slop · UI-vision doc fix · nav-mount cost fix) → `b968f0a` (site-only, HEAD at build); see the top Snapshot banners for each. Older chain (`72fa005`→`86ecad1`): `8a9ab76` (accent palette 10→20) → `8e6920f` (pruned 20→15) → `cc9adb8` (dark-accent-as-TEXT legibility) → `530ef8b` (Monitor v5 "frametime" gloss) → `c80678f`/`2b64c51` (dead-code cleanup + readiness fix) → `18272be` (`compy_room_identity` + `compy_blackbook_console` **GRADUATED DEFAULT-ON**, 15-swatch duo palette, A+B Blackbook Receipts Strip + sentence rows, Home-rig accent-scope fix) → `86ecad1` (this ship: tooltip overpaint + unreachable tooltip link + dead deep-link scroll); see the top Snapshot banners for each. |
| App version | `0.9.0` (`gg.compy.app`, `compy.exe` — bumped from `0.1.0` at `27bc472`, owner call 2026-07-16; `1.0.0` fires at the release-hardening bar) |
| Current installer | `Compy_0.9.0_x64-setup.exe` SHA-256 `D0D63E489105BE7566769A13A2BA801FE76E95314E07A11938A8A49A94575BCB` (built from `28648b2`, 2026-07-17 — **Intelligence Phase 3 SHIPPED LIVE**: experiment engine + optimization simulator armed (`experiment_gate()` `true`, `e16b231`) orchestrating the audited apply/rollback boundary — no new mutation primitive; Lab Optimize note states the reversibility invariant (`04684e6`); cargo 808 · clippy clean · vitest 1720 · live stamp `28648b2 · release` CLEAN; details in the 2026-07-17f/e Snapshot banners; supersedes `E3F8E0CE03A2807786196BC52AAF1A21F86A17C8F5C02F0FD5ACC6FE7856EBA8` from `cd66ce9` (2026-07-17c — Home verdict regression fix) and `3EB0FAE5…C570D838` from `094d834` (2026-07-17b — Intelligence Phase 2)). Prior current-installer chain: `8063F95744C6AF00C760FD3F77DA63FBD9B68B279773307D6D1AEB5773A52E0D` from `d45bb1c` (2026-07-17 — **Intelligence Phase 1 ship**: `8f612d2` intelligence foundation + What-Changed read-only slice (23 files, +3984/−28, flag `compy_intelligence` default ON) · `d45bb1c` game-name display class sweep (bug→guard); cargo 754 · clippy clean · vitest 1708 · live stamp `d45bb1c` CLEAN; details in the top Snapshot banner. Supersedes `41613F13A046730A663B29AA144AE7DFF120FFD0C604ADE060B4D2A1D6ABB6F9` from `27bc472` (2026-07-16d — version 0.9.0 bump ship), which superseded `832B7CF3BDBD2603F925EDD18DD9A1669B0AB74CC441A7675769B46F48687A4E` from `b968f0a` (2026-07-16 — **app-lane task-list close**: palette 8-duo+7-solo rework (`92596d6`) · App.css gradient-ink de-slop + CoreBar transform fill (`47300d9`) · nav-mount cost fix (`d0392c9`: MonitorV2 duplicate pre-warm deleted, SessionStack hoisted ink cache, Blackbook 30-row tape cap + disclosure); zero `src-tauri`; tsc 0 · vitest 1666 · self-reviewer PASS 8/8 on real data; details in the top Snapshot banner. Supersedes `B87B3B3CC78527AF08C2000FDEC740676742E066E0AD13A3D623A0A553B3D20C` from `f160839` (2026-07-15f — console trains 1–4 default-ON + overlay ambient-backdrop fix), which superseded `265275CD1494A7E4AE3D64CDD21CAD8494179CD88E647F957C7313BF8E547BC7` from `4bf2a91` (2026-07-15 — `--run-elevated` boundary-side guard re-cut), which superseded `1C1F13DC259A99042918B5F1714B518F3825EFB1B080FC3443316F1CBFE657E0` from `86ecad1` (2026-07-13 — **glossary-tooltip trio fix**: Blackbook tape reveal fill-mode `both`→`backwards` (rows no longer permanent stacking contexts overpainting an open Term tooltip) · Term.tsx 160ms hover-grace (the "More in the Blackbook →" link is mouse-reachable, all Term sites app-wide) · Learn.tsx deep-link scroll effect re-runs after the category expands (`openCats` dep — the focused entry lands in view); zero `src-tauri`; tsc 0 · vitest 1608 · self-reviewer PASS on real data; details in the top Snapshot banner. Supersedes `A8C341DE…61EC1C10` from `18272be` (2026-07-13 — **default-ON graduation + duo palette + A+B Blackbook**: `compy_room_identity` + `compy_blackbook_console` readers flip to `!== "0"` (**DEFAULT ON**, owner-directed; "(preview)" Settings rows removed, devtools `"0"` failsafes stay); `ROOM_ACCENT_SWATCHES` re-curated to 15 (earth tones out, 3 duos in — bright primary + wash-only secondary, `a+b` persisted keys); Blackbook Logbook gains the Receipts Strip (3 count tiles, tape filter) + sentence-grammar rows + tape section head; Home-rig accent-scope bug fixed (`use-rig-colors.ts` prefers `.home-console`); zero `src-tauri`; tsc 0 · vitest 1604 · self-reviewer round-2 PASS on real data; details in the top Snapshot banner). Supersedes `21942094…0930FF4F` from `2b64c51` (dead-code cleanup + readiness "in the Lab" fix), which superseded `703F078B…9EE40B8` from `530ef8b` (Monitor v5 "frametime" gloss), whose room-identity + accent-palette chain (`72fa005`→`8a9ab76`→`8e6920f`→`cc9adb8`→`530ef8b`) it carries — see the top Snapshot banners.) Superseded installer chain (pre-`72fa005`): `D23DE073…9EBA9` from `72fa005` (**Per-room identity accents** behind NEW flag `compy_room_identity` **DEFAULT OFF** (`readRoomIdentity` → `=== "1"`, `src/design/theme.ts`; Settings → Appearance "Room accent colors (preview)") — each room gets its own accent (Monitor teal · Blackbook amber · Lab/Optimize emerald · Home violet unchanged), resolving the accent-lock owner-taste call; flag-off byte-identical every room; zero `src-tauri`; self-reviewer round-3 PASS; details in the top Snapshot banner. Superseded installer: `43234A53…943D5` from `617db5b` (2026-07-12), whose chain it carries — **Blackbook console Phase 4 "The Logbook"** behind NEW flag `compy_blackbook_console` **DEFAULT OFF** (`readBlackbookConsole` → `=== "1"`, `src/design/theme.ts`; Settings → Appearance "Blackbook console (preview)") — the Blackbook room's flight-recorder Logbook face over EXISTING data, field guide reachable via the room's mode toggle; `"0"`/absent = today's Learn library byte-identical; pure READ view routing undo to the Lab; zero `src-tauri`; self-reviewer round-2 PASS; details in the top Snapshot banner. Superseded installer: `3B855DD1…FB003` from `e195f70` (Monitor v5 console DEFAULT-ON), whose chain it carries — **Monitor v5 console FLIPPED DEFAULT-ON**: flag `compy_monitor_console` **DEFAULT OFF → DEFAULT ON** (`readMonitorConsole` → `!== "0"`, `src/design/theme.ts`; Settings → Appearance "Monitor console", now the OFF failsafe) — the Flight Deck + Session Stack is Monitor's default live face; the "0" failsafe restores the classic tiles; test-pins re-pointed to the DEFAULT-ON polarity (`monitor-console-flag.test.tsx` + sibling `monitor-v2.test.tsx`); owner "flip it default on"; self-reviewer PASS 8/8; details in the top Snapshot banner. Superseded installer: `DFE827D1…FB59` from `fcc400b` (JARVIS DEFAULT-ON), whose chain it carries — **JARVIS motion** (`compy_jarvis_motion` DEFAULT ON, `readJarvisMotion` → `!== "0"`), **Home title-header fix** (`cc1ffce`), the **Expert-view** train (`5850ac0`: `compy_expert_view` **DEFAULT OFF**, `readExpertView` → `=== "1"`, `src/design/use-expert-view.ts`, zero `src-tauri`), the full 2026-07-11 consumer-panel overhaul (`50b5c03`) and the Monitor v5 stack build itself (`915e85b`, now default-ON).) |
| Frozen private-beta artifact | ref `16069fa` / `beta/private-beta-001` (the OLD verified unsigned private beta — a DIFFERENT risk profile from current `main`) |
| Last full installed-build QA | **§6/§7: 2026-07-07 on the `5f765e4` installer (T5)** — §7 swept all items live (3 honesty gaps found → fixed `ff186e6` → focused re-verify PASS on the shipped build); §6 corrupt + missing ledger proven live (fail-loud quarantine / empty load, no crash; real ledger restored hash-identical), cancelled-apply covered by §1's live QA. **§6 helper-crash leg CLOSED 2026-07-08** (owner-run probe on the `48ca9ec` installer: kill elevated helper → `fps.json` froze + `fps.alive` cleaned + no ghost → re-enable spawned a new helper; owner confirmed the Monitor UI showed the sensor STOPPED, not frozen/false-live) — **§6 is now fully passed**; §1/§2a/§5 stand on their own dated passes. Last FULL all-section pass remains 2026-05-31 (frozen private-beta build). |

## Gate matrix (re-verified at HEAD `733f132`, 2026-07-02 — every gate function re-read at source; states unchanged since `9463c10`. Still current at `4e07420` (2026-07-04): the V2 product-shell train `706094f..4e07420` (V2-1→V2-15) is **entirely frontend/docs — `git diff 706094f..4e07420 -- src-tauri/` is empty**, so no gate function, mutation/rollback path, or IPC/capability surface changed. Before that, `706094f`'s sole src-tauri change was readiness drift-reason copy + a read-only `drifted_titles` summary field (`readiness.rs` / `history.rs`; diff-verified: no gate moved))

> **Re-verified 2026-07-06 at HEAD `8c9b711` — audit now mechanized.** Layer 1 (`node
> scripts/verify-release-state.mjs`, new): six citations had drifted 77–253 lines (the preload-dark +
> receipt-metadata trains grew `actions.rs`/`history.rs` above the cited symbols) — all re-anchored in
> this pass; script exits 0. Layer 2 (source re-read of every gate fn body): **every gate VALUE
> unchanged** — the only truth-level fix was quoting the literal CSP `connect-src` instead of a
> simplified one. Standing rule: run the script after any train touching cited files
> (`.claude/skills/gate-drift-audit`).

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:518` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **GAMING_MODE_QA.md live checklist 10/10 PASSED 2026-07-14** (#4/#10 owner-run 2026-07-07; #6/#7 real-UAC cancel arms owner-clicked on `db5349e` after that run forced the runas-decline fix — see the QA doc's runas note). **Owner SIGNED OFF 2026-07-14** — F1 is field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2029` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. UI in `GamingMode.tsx`. Since T6 (2026-07-07) session-start suspends ride the ONE batched elevation; since T6b (2026-07-08, `bdc9daa`) the restore side batches the same way. |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2102` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:170`, `lib.rs:699`, `Benchmark.tsx:193` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal (Phase-B "bloat removal")** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2251` | Built dark 2026-07-06 on the owner's nod (spec `2026-07-06-preload-app-removal-dark.md`). Per-user `Remove-AppxPackage` over a curated 4-app starter list (Solitaire · Feedback Hub · News · Office hub — **Spotify cut by owner curation 2026-07-06:** same package id as a real daily-driver install, no honest "stub" framing; may return behind a usage check); two-tier honest undo (silent re-register verified by re-read, else Store-page hand-off returning Err). Scope decisions: `HKCU\Run` DELETION dropped (the reversible disable already ships, `set_startup_entry_enabled`); Clipchamp/To Do excluded as data-adjacent. Command `remove_known_preload_app` refuses while dark; FE card renders nothing (test-pinned). Arming needs: live remove→reinstall QA (`qa_remove_then_reinstall_round_trip`) + every Store ProductId link-verified + owner curates the final list + sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs` | Built dark 2026-07-09 on the owner's nod (marathon §2a, spec `2026-07-08-lab-proving-ground.md`). Applies the whole safe stack in ONE UAC (reuses the audited `apply_recommendations_batch` — **no new mutation primitive**), measures the cumulative fps delta, then rolls back EXACTLY the changes it created via a multi-change Drop-guard (ledger id-diff; corrupt-ledger read ABORTS before any mutation — rust-tauri-reviewer fix). Commands `start_stack_trial` + `stack_trial_armed` refuse/return false while dark; no FE surface yet. Arming needs: live apply→rollback QA on a real rig + owner sign-off. |
| **Experiment engine + optimization simulator (Intelligence Phase 3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:55` | Armed after owner sign-off "Ship it live now" + a live apply→rollback round-trip on this rig (benign reversible rec, clean ledger restore). ORCHESTRATES the audited mutation boundary — **no new apply/rollback primitive, no enum variant**: `start_experiment` (`experiment.rs:473`) applies ONE reversible change via `history::apply_recommendation`, auto-restores via `history::rollback_change`, resolve stays history-only. Every command still hard-checks the gate (defense-in-depth, now unreachable). Simulator `build_sim_context` (`experiment.rs:705`) reads the real hardware-tailored catalog READ-ONLY; unknown rec ⇒ honest insufficient-evidence, never a fabricated verdict. FE `ExperimentBench` mounted in `LabGround.tsx` (Lab room). |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (all 3 loops PASS); `history::restore_leftover` registered (`lib.rs`), receipts ride the Trust Ledger with provenance `leftover_adopted`. No FE caller yet — restore UI is a later train. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key); FE `pro.ts:14`, `entitlements.ts:14` | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) ALSO hard-fails on the placeholder key (`remote_rules.rs:236`). Ed25519 verify is real but never runs in shipped builds. |
| **Auto-updater** | **OFF / absent** | no `plugins`/`updater` block in `tauri.conf.json`; no updater dep in `Cargo.toml` | — |
| **Outbound network** | **NONE** | no `reqwest`/`ureq`/`hyper`/HTTP client anywhere in `src-tauri/src` or `Cargo.toml` (2026-07-11 audit: whole-tree grep, zero hits besides a `// Future:` comment at `remote_rules.rs:395` — the comment spans 395–396); **production** CSP `security.csp.connect-src` (`tauri.conf.json:46`) is `'self' ipc: http://ipc.localhost` — the `ws://localhost:1420 http://localhost:1420` tokens belong to the separate dev-only `devCsp` field (`tauri.conf.json:51`, not shipped). Both are local-only; zero external origins either way — the correction only fixes which field the doc was quoting, doesn't change the conclusion. | Verified-zero-outbound property holds while Receipts + remote-fetch stay dark. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`history.rs:818`→`actions::resolve_rollback`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned
  (`save_history_to` `history.rs:332`; test `save_is_an_atomic_swap_leaving_no_tmp` `history.rs:2146`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  outcome attribution (`elevation_outcome` `actions.rs:964`). PowerShell token validators
  `ps_safe`/`ps_safe_squoted`. Boundary-side second lock (2026-07-15): the helper runs ONLY hex
  byte-matching the one-time dispatch ticket minted at `run_elevated_powershell`, consumed before
  execution (`mint_elevation_ticket` `actions.rs:1149` · `consume_elevation_ticket` `actions.rs:1171`
  · `run_elevated_helper` `lib.rs:76`).
- Gaming-session advanced tier (USB + PCIe + service suspends) batches to **ONE elevation per
  session start** (T6, 2026-07-07) — and since T6b (`bdc9daa`, 2026-07-08) the restore side
  batches contiguous elevated rollbacks the same way: sink-staged → `compose_batch_script` → single
  `run_elevated_powershell` → per-item receipts (`apply_elevated_tier`,
  `gaming_orchestrator.rs:201`). No-partial abort+restore contract unchanged; UAC-decline drops
  only verifiably-never-ran staged entries (`elevation_error_nothing_ran` `actions.rs:988`);
  dispatch-layer guard `a_full_tier_dispatches_exactly_one_elevation`.

## Release blockers

| Item | Status |
|---|---|
| Manual-mutation apply/rollback QA | **CLOSED** 2026-05-31 (owner sign-off) — `RELEASE_QA.md:3`. NOT an open blocker. |
| Private-beta functional blockers | **NONE** for the frozen `16069fa` build (`PACKAGING_SIGNING_PLAN.md:131`). Current `main` wants its own fresh installed-build QA if shipped. **For the current installed `37a166c` build that QA is DONE** — 2026-07-20b (build/install/stamp/zero-outbound/smoke) + 2026-07-20c (live rollback → reapply cycle + orphan recovery through the installed UI) ⇒ **GO for invite-only private beta** (the send itself = owner action; Code signing + Legal still gate PUBLIC). |
| Gaming Mode live reboot-while-active QA | **CLOSED 2026-07-07 (owner-run)** — physical reboot + "Restore now" on the `48ca9ec` build: session contract cleared, every probed value matched his standing ledger state; case #4 PASSED in `GAMING_MODE_QA.md` (`a21f310`). This row had lagged the close by a day — fixed 2026-07-08. |
| Gaming Mode enable fires ~5–6 UAC prompts | **CLOSED 2026-07-07/08** — T6 built the session-start batch (ONE `--run-elevated` invocation: `apply_elevated_tier`, `gaming_orchestrator.rs:201`; ≤1-dispatch cargo pin; no-partial contract + UAC-decline honesty preserved; UAC *policy* settings untouched per standing rule); owner live-confirmed exactly ONE enable UAC 2026-07-07 (case #10 PASSED). T6b (`bdc9daa`, 2026-07-08) batches the restore side the same way; owner's live restore-side eyeball pending (next real session). |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA license model + jurisdiction, PRIVACY) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA (remove→reinstall round trip, Store links) + owner-curated list | **OPEN** — gates arming preload-app removal (feature is built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. (The semver compare is NOT a blocker and never was one at ship: `version_in_range` (`remote_rules.rs:300`) compares NUMERICALLY by delegating to `cmp_version` (`remote_rules.rs:311`), pinned by the test `version_compare_is_numeric_not_lexicographic` (`remote_rules.rs:608`). A pre-2026-07-19 note here read "lexicographic"; that was disproven by the code and is corrected.) |

## Required owner decisions (live)

1. **Beta artifact choice — DECIDED (owner, 2026-07-06): current `main`.** ("I like the current main build, it's more complete in the way I want it.") Frozen `16069fa` stays archival. Consequence armed: fresh full installed-build QA on `main` (2026-07-06 train T5, now REQUIRED) + owner-run GAMING_MODE_QA.md live case #4 (reboot-while-active) before any send. **That consequence is now SATISFIED for `37a166c`:** case #4 was owner-run 2026-07-07; the fresh installed-build QA + runtime closure landed 2026-07-20b/c (CURRENT STATE + snapshot entries) — the remaining owner action is the send decision itself.
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).

## Desk builds before v0.9.18 — archived 2026-08-18

> Moved verbatim out of `docs/RELEASE_STATE.md`'s owner-installed row under the TOKEN LAW
> (docs carry current state; history moves to `docs/archive/*`). Nothing deleted. The current
> desk build and its immediate predecessors stay in RELEASE_STATE.

Supersedes the 4th desk swap: **0.9.15**, embedded stamp **`a71b377c`** — registry `DisplayVersion` reads 0.9.15. **Installed + LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime`** 2026-08-12 (runtime proof `a71b377c · release · shell 0.9.15`, attempt 1; installer SHA-256 `BC1F7F6B…68C5D0`, one installer on the Desktop). **Desk-only ship cut from the UNMERGED lane `claude/bento-conversion` (PR #120)** — it adds the Lab rig picker's `data-rig-part` hooks (`a979f123`) and the fixture-preview harness + its parity guard on top of `main`. **Its `npm run tauri build` exited non-zero on the LAST step only:** `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so no updater signature was produced; both bundles were already written, and the stale-build gate confirmed the packaged exe embeds `a71b377c` before install. An unsigned desk bundle is **unpublishable by construction** — a publish re-cuts from `main` with the key. It was installed over the published **0.9.17 (`a614744c`)**, which itself passed a real visual self-review on the second try: 0.9.16 was built purely so the Care entry could be LOOKED at on this machine at this window size (plan Task 8 step 5); that look FAILED — no card treatment among neighbours that all have one, and a because-line stranded ~130px out on a column grid meant for stacked rows. Fixed in `af740b81`; 0.9.17 re-captured and PASSED in both flag states, including `compy_home_intake="0"` where the whole intake band is absent and the Care entry is still there — the exact case the extraction exists for. Captures: `C:\Users\Kuya\code\compy-visual-review\`. **This row now MATCHES the published artifact — v0.9.18 (`cfc0c4b7`) is installed AND published.** **Four desk swaps happened in one day** — published `1b437785`, then the bento lane's own branch build `262ef91b` installed over it with NO doc-sync (caught by check (7), not by anyone noticing), then 0.9.16/0.9.17, then this. The version number stayed 0.9.15 across two of those swaps, which is why check (7) reads the stamp out of the binary rather than trusting a version string.

## Desk builds before `436818c2` — archived 2026-08-18

Moved verbatim out of `docs/RELEASE_STATE.md`'s "Owner-installed version + embedded stamp" row under the TOKEN LAW byte budget (history leaves the living ledger, nothing is deleted). Covers the
`80397326`, `555e2996` and `421657a9` desk builds and the 0.9.25 → 0.9.18 candidate lineage.

Supersedes the same-day desk build **`80397326`** (built from `main` 2026-08-18 after the C-06/C-08 plain-English copy pass and the ship-path repair; installed silently by Claude, installer SHA-256 **`881C63AAB282B58FA819EEC277D26FBDBB464A6C2D1F41E496B4DD07C6DA9C3E`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime`** — runtime proof `80397326 · release · shell 0.9.25`, attempt 1, 0 transient failures. **That proof exists again only because this build repairs it:** `-VerifyRuntime` had been DEAD since #130 — `scripts/lib/canonical-data-root.ps1` shipped BOM-less, PowerShell 5.1 read it as ANSI, and one em-dash mojibaked into a smart quote that unterminated a string and parse-errored the file through the dot-source; then C-09 moved the version out of the rail that `runtime-proof.ps1` read it from. Both are now guarded (version-drift Guard C walks every `scripts/**/*.ps1` for BOM-less non-ASCII; Guard E pins the `__COMPY_UI_VERSION__` seam across App.tsx, the probe and the PowerShell comparison). Five more BOM-less scripts were fixed with it, including `backup-updater-key.ps1` — the owner's own §A0 task, which would have parse-errored in his hands. **No test covered any of this: nothing in the suite executes the ship script.** Carries C-06/C-08 (`4c9e440e`) and C-09 (`6d047c2a`, `00d7020e`). **UI changed and it carries a quoted self-review VERDICT: PASS (10/10)** on THIS installed binary — the ETW honesty line roughly tripled in length and measures `clientWidth=scrollWidth=1120px` unclipped, the Home CPU-temp chip wraps cleanly to two lines at 190×39 with no cut text, and every honesty claim still asserts (LOCKED rule 2 external-capture/no-injection/no-kernel-driver, LOCKED rule 5 NVIDIA "not yet hardware-verified" untouched). **A finding from that review was WRONG and is corrected here:** it reported ~9 of the 24 rewritten English keys as living in unmounted components. They are reachable — `MonitorV2` mounts `Play` for its ADVANCED face, `MonitoringTab` mounts `MonitorDomainCards`, whose CPU card detail renders `monitor-panels.tsx`s `CpuMonitorPanel` (and with it `CpuTempOffer`), and `SessionDebrief` renders inside `Play`. `MonitorConsole` replaced the BASIC face only. Acting on the original claim would have deleted live code; `Monitor.tsx` is the one genuinely unreferenced shell (BACKLOG C-18, corrected). Unsigned by construction, therefore unpublishable — the signing key is owner territory. Supersedes the earlier same-day desk build, embedded stamp **`555e2996`** (built from `main` 2026-08-18 after the Q9c CPU-temp offer and the #133 Task 7 review train, installed silently by Claude; installer SHA-256 **`D9C9EE85F59301641A9733248A2DD9C9F32E8E40F3BADBA972037F0B18315C11`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime`** — runtime proof `555e2996 · release · shell 0.9.25`, attempt 1, registry `DisplayVersion` 0.9.25. **UI DID change here, and it carries a quoted self-review VERDICT: PASS** (round 3 — rounds 1 and 2 FAILED, and round 2 is the one that mattered: the new CPU-temp offer had been added BESIDE the dead-end `cpuTempFallback` sentence instead of replacing it, which tsc and 4900+ green tests could not see). Unsigned by construction, therefore unpublishable — the signing key is owner territory. Supersedes the EARLIER same-day desk build, embedded stamp **`421657a9`** (installer SHA-256 **`0333F411E4146CD564401CD54E8A50FCA7BB64B21FE5170AE9B218369711006D`**). **Stamp-proved:** the installed exe embeds `421657a9` and does NOT embed `dirty` - the tree was clean at build time (the uncommitted `.codex/config.toml` change was stashed for the build and restored after, so the stamp cannot lie about HEAD). **This is the first installed build carrying `src-tauri/src/data_root.rs`** - the canonical data-root resolver is present in the shipped binary (`COMPY_MEASUREMENT_DATA_ROOT`, `the APPDATA environment variable is not set` and the user-facing "Compy cannot verify where your data is stored." string all resolve inside `%LOCALAPPDATA%\Compy\compy.exe`), so the Trust Ledger can no longer split by launch path and the Desktop/Start-menu-only launch restriction is LIFTED. **Unsigned by construction and therefore unpublishable:** `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so `npm run tauri build` produced both bundles and then failed only the updater-signature step; a publish re-cuts from `main` with the key. The fleet remains on published v0.9.25 (`efde8310`) - **this desk build shares that version number but is different bytes**, which is exactly why the stamp, not the version string, is the identity here. That earlier build changed no UI, so no self-review verdict applied to it. Supersedes **0.9.25 CANDIDATE**, embedded stamp **`efde8310`** (release commit, prepare 2026-08-13 PT; installed + LIVE-proved attempt 1, journal `release-transaction-v0.9.25.json` carrying `receipt_verified` + `runtime_proved`, `embedded_count` 1, installer SHA-256 `72a04a15…2203`). Registry `DisplayVersion` reads 0.9.25. **Two defects that people caught and the suite could not.** (a) The update-pill LED animated `box-shadow` forever in the shell topbar — a main-thread repaint per frame on every screen, live only in the update-AVAILABLE branch, which is every out-of-date tester's resting state. It now rides an `::after` layer on transform+opacity. (b) Tester Jaikaran's v0.9.12 report that written feedback vanishes on leaving Settings was **still reproducible in v0.9.24**: `Settings` is a ternary swap in `App.tsx:1362`, so leaving it unmounts `FeedbackExport`, and the note lived only in `useState`. The draft now persists through `safe-storage`'s `lsGet`/`lsSet` and restores in the first paint after remount. **Visually reviewed on THIS installed binary and PASSED, both halves:** the pulse captured at 5x frozen at 0s/0.4s/0.7s of its 1.6s cycle reads as a round, centred ring expanding and fading with no clipping (`v0925-pill-arc.png`), and a seeded draft is present in the feedback box after Settings mounts — J's exact scenario, on the shipped candidate (`v0925-draft-restored.png`). **Both new guards were falsified before being trusted:** reinstating the box-shadow keyframes fails `ambient-animation-cost-guard` by file, selector and property; reverting the lazy initialiser turns 3 of the 4 new `FeedbackExport` cases red. Captures in `C:\Users\Kuya\code\compy-visual-review\`. Supersedes **0.9.24 CANDIDATE**, embedded stamp **`289c658d`** (release commit, prepare 2026-08-13 PT; installed + LIVE-proved attempt 1). Carries design-foundation **step ② UX-1** plus the cascade fix v0.9.23's look caught. **Visually reviewed on THIS installed binary and PASSED:** the verdict "You're ready to play" now renders as the h1 at `--type-verdict` (measured ~1.5× the width of the same string in v0.9.23, consistent with 26px → 40px), the room title "Home" is gone from the header, "What are you here to do?" is the one filled primary button directly beneath it, and clicking it opens "Pick what's closest" in place — the fast-path line plus all four intent rows routing live to Live / History / Test, no dead ends. The Crash & Freeze Rescue entry keeps its own card on the surface, outside the disclosure. Captures `C:\Users\Kuya\code\compy-visual-review\ux1-v0924-home{,-open}.png`. Supersedes **0.9.23 CANDIDATE**, embedded stamp **`14afeb09`** (installed + LIVE-proved attempt 1). It carried UX-1 first and **its look FAILED — for the fourth time in four builds, on something green tests could not see.** The front door reads correctly (the verdict is the h1 and the room title "Home" is gone; "What are you here to do?" is the one filled primary and opens the intent panel in place with all four routes live), but the verdict rendered at `--type-section`, not the `--type-verdict` 40px UX-1 exists to deliver. Cause: `home-hud.css`'s `[data-room="home"] .v2-verdict h1` rule is scoped by `[data-hud="on"]` — and `compy_editorial` defaults ON — so at (0,6,1) it outranked `home-console.css`'s `h1:has(.hc-headline)` at (0,3,1) and quietly held the step down. **jsdom does not load stylesheets, so no rendering test could ever have caught this**; fixed by scope (`:not(:has(.hc-headline))`) and pinned by the new static `src/surfaces/home-verdict-scale-guard.test.ts`. Captures `C:\Users\Kuya\code\compy-visual-review\ux1-v0923-home{,-open}.png`. **v0.9.24 is the corrected candidate.** Supersedes **0.9.22 CANDIDATE**, embedded stamp **`700cd565`** (release commit, prepare 2026-08-13 ~13:05 PT; installed + LIVE-proved attempt 1, journal `release-transaction-v0.9.22.json`, installer SHA-256 `87ad400d…2aadac`). Carries design-foundation step ① — **TYPE-1** six-step scale with the 13px floor + **COLOR-1** rooms give up their hue (`51956ed0`) — the update-pill attention state (`522799e3`), and the arc-gauge ring-overflow fix (`64fe3579`). **Visually reviewed on THIS installed binary and PASSED:** rings clear (100 · 366 · 0 · 246 all inside their stroke, long unit words beside the label), Test/Live/History render the one violet accent instead of emerald/teal/amber, type legible at the floor. Captures `C:\Users\Kuya\code\compy-visual-review\v0922-{home,test}.png`. **The prior stamp `72b8f28b` (v0.9.19) is where that ring overflow was CAUGHT** — 330 green test files did not see it; looking did. **0.9.20 and 0.9.21 were burned by failed re-prepares** (prepare mints configured+1; nothing of them was installed or published — see owner decision 1). NOT published; the fleet remains on v0.9.18. Supersedes **0.9.18**, embedded stamp **`cfc0c4b7`** (release commit, prepare 2026-08-12 PT). **Installed + LIVE-proved by the stage→prove pipeline** (runtime proof `cfc0c4b7 · release · shell 0.9.18`, attempt 1; journal `release-transaction-v0.9.18.json`). Carries the intake band default OFF (`4d1afa92`), the popout modal-contract guard (`b44ec358`), the three-popouts-onto-one-Sheet convergence (#119), the bento lane's #117/#120, and the quiet-launch SW_MAXIMIZE fix (#121). **Visually reviewed on the installed binary before any publish:** Home sans band PASSED (Care entry keeps its card treatment) and the converged Sheet PASSED at the Optimize and Crash & Freeze Rescue stations (open/close/switch). **The mid-apply consent panel remains UNSEEN** — the owner's safe stack reads 9/9 applied so nothing can trigger consent without mutating his real tweaks; look at it on the first real apply. Captures: `C:\Users\Kuya\code\compy-visual-review\v0918-*.png`. Desk builds before **0.9.18** (`cfc0c4b7`) — the 0.9.15 `a71b377c` unsigned bento-lane swap, `262ef91b`, 0.9.16/0.9.17 and the four-desk-swaps-in-one-day record — moved verbatim to `docs/archive/RELEASE_STATE_HISTORY.md` § "Desk builds before v0.9.18" (TOKEN LAW, 2026-08-18). **The lesson that row exists to carry stays here: the version number stayed 0.9.15 across two swaps, which is why check (7) reads the stamp out of the binary rather than trusting a version string.**

## Desk build `f86ed9df` (0.9.25, C-05 + C-19) — archived 2026-08-18

Superseded the same day by desk build `7f151d2c`. Moved verbatim out of the "Owner-installed version + embedded stamp" row.

**0.9.25 DESK BUILD**, embedded stamp **`f86ed9df`** (built from `main` 2026-08-18 at the squash-merge of PR #138; installed silently by Claude, installer SHA-256 **`CBB2D181DF4A8A042292A3157BC7D4007E286C8EB2C331E2540316ED51BE38C7`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime`** — runtime proof `f86ed9df · release · shell 0.9.25`, attempt 1, 0 transient failures. **Self-review VERDICT: PASS (10/10)** on the byte-identical code at `d250f53a` (round 2 — round 1 FAILed item 5, box-in-a-box, and was fixed before this build). It carries **C-05 + C-19**: the 10-step tour no longer seizes the front door on first run, it is offered as a card on all three Home surfaces under ONE name ("Compy tour", not "Guided setup"/"Hardware tour"), and CPU temperature is on the default Live face in both modes plus Home. **Two filed premises were wrong and are corrected in BACKLOG:** the C-05 launcher card was NOT on `HomeConsole`, the default Home (`.stl-card` count was 0 on the shipped build, captured live), and C-19's "three clicks deep" was generous — `CpuTempOffer` had NO default-flag path at all, because `Play`'s `deepMonitoring` slot only renders while `showLive` and `Play` only mounts at advanced+Sessions, where it is false. C-18's own correction ("All reachable: Live → Advanced") was wrong for the same reason. **Nothing was deleted** — the offer was re-mounted, per C-18's warning. Home had also been printing "no CPU temp" with no probe behind it. Guards `first-run-front-door-guard` and `cpu-temp-reachability-guard` were mutation-tested (all six cases confirmed to FAIL on defect return). `cpu_temp.rs` gained a 900ms/15s hit-miss cache first, so the new Home poll is cheaper than the caller that already existed. Unsigned by construction, therefore unpublishable — the signing key is owner territory. Supersedes the same-day desk build, embedded stamp **`436818c2`** (built from `main` 2026-08-18; installed silently by Claude, installer SHA-256 **`81635A7EAC91544081391522CB662ACA979227818F0E8D5CD9CF8D6E13CBC812`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime`** — runtime proof `436818c2 · release · shell 0.9.25`, attempt 1, 0 transient failures. **Self-review VERDICT: PASS (10/10)** on THIS binary. It carries the third of the three Home controls the owner named as clutter: the bordered "Re-run check" button was STILL SHIPPED after #136 was reported as having dealt with all three — a capture caught it, 4,979 green tests could not, because every pin asserted the button was PRESENT. **Demoted, not deleted:** that control is the only entry point to `<FirstCheck>`, so deleting it would have stranded a flow to satisfy a look; it is now an inline text link inside the sentence. Measured on the live build: `.rcb-run` 6.36:1 resting / 16.40:1 hover, the flagged row single-line at 1500px, and all three named items confirmed ABSENT from the live DOM. Guards: structure (`.rcb-btn` absent, `.rcb-run` inside `.rcb-status`), affordance (the control keeps a named reachable role=button and still fires `onRunCheck`), and a static CSS pin that no `.rcb` rule paints a border or panel fill — falsified before being trusted. Desk builds before **`436818c2`** — `80397326`, `555e2996`, `421657a9` and the whole 0.9.25 → 0.9.18 candidate lineage — moved verbatim to `docs/archive/RELEASE_STATE_HISTORY.md` (this file) § "Desk builds before `436818c2`" (TOKEN LAW byte budget, 2026-08-18). **The two lessons those rows exist to carry stay here: `-VerifyRuntime` was DEAD for eight days because a BOM-less script mojibaked under PowerShell 5.1 and nothing in the suite executes the ship scripts; and the version number stayed 0.9.15 across two desk swaps, which is why check (7) reads the stamp out of the binary rather than trusting a version string.**

## Owner-installed desk builds — `40682344`, `5e64074c`, `75880de1` (archived 2026-08-20)

Byte-preserved from the RELEASE_STATE owner-installed row when the `aac90cd7` control-font build
was recorded; carved out for budget, not superseded in meaning.

It supersedes desk build **`40682344`** (0.9.26), built 2026-08-19 by `npm run tauri build` and installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`114B7FFDDC8031F24019152D4FA4B312853702D59F353292C4DB87BB0B93744B`**. **LIVE-proved by `scripts/ship-reinstall.ps1 -ProofOnly -ExpectedCommit`** — runtime proof `40682344 · release · shell 0.9.26`, attempt 1 (0 expected transient). It carries **conformance C-04**: the front door is **Health** everywhere the user reads it (rail label, room breadcrumb, command palette, tour blurb + rail recap, CPU-temp honesty note, RAM lesson tie). **Self-review VERDICT: PASS** on THIS installed binary — all four named surfaces looked at directly at 1484x971, the tour reached live via Settings → "Take the tour" (all 10 steps, recap rendered verbatim), rail labels measured unclipped, and a regression sweep found **zero user-visible "Home"** on Health/Live/History/Test; the palette search for "home" returns Health plus one unrelated powerline-adapter hit, no stale room entry. *Recorded, not engineered around:* the live rail on this build is **Health · Live · History · Test** (four rooms — `compy_lab_ground` defaults ON, which drops the standalone Optimize room), so the five-room recap string is not what this build renders. **Desk is AHEAD of the fleet again:** same version number, different commit — the published v0.9.26 is source `5e64074c` and does NOT contain the rename, which ships with the next cut. It supersedes desk build **`5e64074c`** — **0.9.26, THE PUBLISHED BUILD** (built and installed 2026-08-19 by `scripts/release.ps1 -Mode prove`, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit`** -- runtime proof `5e64074c · release · shell 0.9.26`, attempt 1 (0 expected transient). **Desk and fleet are the same bytes again** — the deliberate divergence recorded below is closed. It supersedes desk build **`75880de1`** (0.9.25, `perf/idle-127-ambient-raster`) — where the **#127 idle-CPU fix** was first proved (whole-app idle on Home **19.632 → 10.483 percent of one core**); its full method, falsified guards and stated scope are byte-preserved earlier in THIS file. Earlier desk builds (`2f79febb` — the C-10/C-11/C-17 conformance build and its three review rounds — and `7f151d2c`) are byte-preserved earlier in THIS file.

---

Byte-preserved from the RELEASE_STATE owner-installed row when the `ab54f1e4` comprehensibility-sweep
build was recorded (2026-08-20); carved out for budget, not superseded in meaning. Two relative links
repointed for archive depth; the pull/issue links are absolute and unchanged.

**0.9.26 desk build, embedded stamp `1d5b3c4c`** — built 2026-08-20 by `npm run tauri build` from worktree `sentinel-home-room` at `lane/interview-foundation-3` (`1d5b3c4c`), installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`A823DF09216C7B656CF8E15257E57ECD5B5F1781AE93DC91C6ACA83C5221C995`**. **Live == build proved by runtime probe, never an exe hash** — `ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit -ExpectedInstallerPath -ExpectedInstallerSha256` returned `1d5b3c4c · release · shell 0.9.26` on the first attempt, 0 transient retries; an exe hash is not proof here, because NSIS packaging leaves the installed binary not byte-identical to `target/release/compy.exe`. **This binary carries design-foundation step ③ — the interview** (PR [#178](https://github.com/Pootytxng/sentinel/pull/178), issue [#177](https://github.com/Pootytxng/sentinel/issues/177)): the intake band is deleted, and Home's primary button opens a one-question-at-a-time interview ending on a finding card. **It ships behind `compy_home_interview`, DEFAULT OFF** — so on first launch **Home is unchanged** and the only visible artifact is the new Settings → Behavior toggle *"Ask me a question on Home"*. That default is the owner's standing answer for this slot, not a house convention; the fork, its measured cost and the recommendation are in [decisions/2026-08-20-home-interview-default.md](../decisions/2026-08-20-home-interview-default.md) and filed for him in `OWNER_ACTION_CHECKLIST.md` §D. **Self-review VERDICT: PASS** (10/10 at 1500×1080-class 1500×980 on this installed binary, after a **round-1 FAIL** on rubric item 10 that this build is the correction of: the first draft defaulted the new flag ON, which reversed his off-switch under a new name). The round-2 reviewer re-confirmed the stamp with its own `get_build_stamp` probe before any capture, drove the keyboard path with REAL CDP input events (recording that `rawKeyDown` does not synthesize a click in WebView2 while `keyDown` does — worth keeping for the next keyboard review), and left the machine on the shipped default with the key removed and the app closed. Earlier desk build **`75849be1`** — the first binary ever to carry `5fab9e79` (PR [#172](https://github.com/Pootytxng/sentinel/pull/172)), which DISCHARGED the C-13(b) self-review debt at PASS 10/10 — and the ones before it are byte-preserved earlier in THIS file. **This is the first binary ever to carry `5fab9e79` (PR [#172](https://github.com/Pootytxng/sentinel/pull/172)), and it DISCHARGES the C-13(b) self-review debt** — `RoomAccentPicker`'s `role="menu"` keyboard contract reached `main` and then no build, so nobody had looked at it. **Self-review VERDICT: PASS** (10/10 at 1500x980 on this installed binary; the reviewer re-confirmed the stamp with its own `get_build_stamp` probe before any capture, rather than trusting the ship report). **What 16 mounted tests could not see and the review had to:** the roving-tabindex focus ring is drawn OUTSIDE the swatch fill (`outline: 2px solid rgb(179,102,255)`, `outline-offset: 2px`), so it stays legible on a near-hue swatch (Violet) as well as a contrasting one (Emerald) instead of vanishing into the colour it marks — an invisible focus ring on a roving tabindex is a keyboard trap the user cannot see. Disabled-skip and wrap were driven with REAL CDP input events in both directions and landed on "Apply to all rooms", never the disabled "Reset to default"; `Escape` put focus visibly back on the trigger. The reviewer also recorded that synthetic DOM dispatch fails Chromium's `:focus-visible` heuristic and would have FALSE-FAILED rubric item 4 — a note worth keeping for the next keyboard review. Earlier desk builds — **`835d8868`** (the kernel law's one earned celebration + the `.arc-v2` cleanup) and **`aac90cd7`** (the #155 control-font reset, where the first silent install lied and the stamp gate caught it → #156), plus `402b0080`, `40682344`, **`5e64074c`** (THE PUBLISHED BUILD), **`75880de1`**, `2f79febb` and `7f151d2c` — are byte-preserved earlier in THIS file.

## Desk build `36011078` — moved out of RELEASE_STATE.md 2026-08-22 (byte budget)

Superseded by `701c2113`, then by `d5a6a630`. Text below is byte-for-byte as it stood in the
owner-installed row.

It supersedes desk build **`36011078`** — built 2026-08-21 by `npm run tauri build` from worktree `sentinel-testrig` at `feat/test-rig-reading-set` (`36011078`), installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`4A25CFF39B10E83854C53BA579794A9B20D2589CA5B4782AB947F27E8A8876CE`**. **Live == build proved by the embedded stamp, never an exe hash** — `36011078` found byte-scanning the installed exe at `%LOCALAPPDATA%\Compy\compy.exe`. **This binary closes the last of the three-room intimidation pass — Test's remaining open item** ([UI_VISION_BACKLOG.md](../UI_VISION_BACKLOG.md), spec `superpowers/specs/2026-08-21-test-rig-reading-set.md`): 3 of Test's 4 corner gauges no longer repeat Health's numbers (Readiness/Avg FPS/1% low). The set is now Proven (get_scoreboard award count) · Noise floor (get_trial_state noise_floor_pct) · Safe stack (unchanged) · Instruments read (stations with a live reading vs total) — bench facts, not machine facts, on two already-registered read-only commands, zero new backend. Stage tile retitled "Your rig" → "Your rig on the bench". **Self-review VERDICT: PASS** on this installed build (10/10 — corner gauges render correctly and are visually consistent with the prior style; Proven/Noise floor honesty-rail states verified via DOM+computed styles, no fabricated 0; no overflow/clipping on any `.lc-corner` node despite longer labels; Health/History/Live spot-checked unmoved). Chronologically later (18:21) than the `lane/aurora-idle-cost` install below (04:33) on the same date, so it is this row, not that one, that describes what is actually on the owner's desk now.

## Desk build `701c2113` — moved out of RELEASE_STATE.md 2026-08-22 (row cap)

Superseded by `d5a6a630`. Text below is byte-for-byte as it stood in the owner-installed row.

It supersedes desk build **`701c2113`** — built 2026-08-22 by `npm run tauri build` from the primary worktree `sentinel-home-room` at `lane/train-2026-08-22` (`701c2113`), installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`2451AA19634FD769AB675F2F9970771B095D88430061405FD4FE14A402640BDB`**. **Live == build proved by the embedded stamp, never an exe hash** — `701c2113` found byte-scanning the installed exe at `%LOCALAPPDATA%\Compy\compy.exe`, and `36011078` is confirmed ABSENT from it. **What this build finally puts on the owner's desk is the ambient-idle-CPU fix** (`1f2ba660`, PR [#192](https://github.com/Pootytxng/sentinel/pull/192)): `body::before` lost `animation: aurora` and `will-change: transform`, idle CPU **20.853% → 3.403% of one core** on the honest `idle-bare` instrument. That fix landed on `main` on 2026-08-21 but the desk build made LATER the same day (`36011078`, from a different worktree) did not contain it, so his live app kept paying the cost for a day. It is a strict superset of what it replaces: `36011078`'s Test-room reading set is an ancestor of this commit, verified by `git merge-base --is-ancestor`. **Self-review VERDICT: PASS** on this installed build (10/10, stamp confirmed live via `get_build_stamp` = `"701c2113 · release"`): the backdrop still paints (gradient intact, `animation-name: none`, `will-change: auto`, layer still `pointer-events: none` at `z-index: -1`), no banding or seam, Health/Live/History/Test unchanged, and the Test room's four corner gauges (Proven · Noise floor · Safe stack · Instruments read) render exactly as shipped. **The updater signing key was NOT needed and was not touched** — `npm run tauri build` produces the NSIS installer and only then fails on the updater artifact, which a desk install does not use; that is now a recorded fact rather than an assumed owner gate.


## Published release `v0.9.24` — moved out of RELEASE_STATE.md 2026-08-22 (row cap)

Superseded by v0.9.25, then v0.9.26. Text below is byte-for-byte as it stood in the published-release row.

It superseded **v0.9.24**, source `289c658d`, published tag `v0.9.24` on `Pootytxng/compy-releases`, release id **`370225167`**, published `2026-08-13T21:29:49Z` under owner GO (chat, 2026-08-13 — "send out the most current working version of the app to the tester"), `draft: false`, `prerelease: false`. Installer `Compy_0.9.24_x64-setup.exe` SHA-256 **`c0d3b7511941c9aefdb5e5caedafcdbb275d6ebb573724fb7fa2708adf5bbbec`**; public `latest.json` SHA-256 `fc23172530abb784d66b3014688009dc1005d8080596e17e4ba1311d6837d224` — both byte-match the signed receipt, updater signature verifies against the pinned key, transaction **complete 9 of 9**, and the `/releases/latest/download/` alias converged on **attempt 1 in 3.5s** (no edge-cache wait this time). **This is the biggest jump the fleet has ever been offered: six candidate numbers in one release.** It carries design-foundation **step ② UX-1** — the Home front door is now a verdict at 40px with one primary action, and the room title is gone — **visually reviewed on the installed binary, twice, because the first review FAILED** (v0.9.23's verdict rendered a step small; see the owner-installed row) — on top of step ① **TYPE-1 + COLOR-1** (six-step type scale, 13px floor, rooms give up their hue), the update-pill attention state, the in-app What's-new list, and the arc-gauge ring-overflow fix. **v0.9.19 through v0.9.23 were never published** (desk-only or burned by failed re-prepares); v0.9.22's open GO was folded into this one.

## Owner decisions that had already closed — moved out of RELEASE_STATE.md 2026-08-22

They were still sitting under the heading *Required owner decisions (live)*. Byte-for-byte below.

**Closed 2026-08-13 (UTC):** candidate v0.9.18's publish GO/NO-GO. The owner said "go" with the
desk-ship evidence in front of him (screenshots of the look, the #121 record, the runtime proof) and
v0.9.18 published at 06:57 UTC on 2026-08-13, transaction closed - `published_*` anchors above carry
the truth. (Written date-first with no ISO zulu suffix on purpose: the checker's decisions-section
regex ends the section at the first zulu letter it meets - issue #123 has the fix-forward.) The one
deferred look (the mid-apply consent panel, unreachable at 9/9-applied) transfers to the first real
apply, not to a decision.

**ANSWERED 2026-08-21 - the owner's "runs a lot slower than before". Measured, not guessed; no
owner decision falls out of it.** (Date-first, no zulu suffix, per #123.) Measured against the
INSTALLED build at `%LOCALAPPDATA%\Compy\compy.exe`, written 2026-08-21 00:32, driven by
`node scripts/q7-probe.mjs` with no instrumented build. Every figure below is from a run whose
baseline SETTLED; the runs are in `docs/perf/raw/`.

| what | recorded baseline | 2026-08-21 | budget then |
|---|---|---|---|
| idle CPU, honest instrument (`idle-bare`, no CDP) | 23.348% of one core | **20.853%** | 26 |
| cold start to usable Home (median of 3) | 3721 ms | **3112 ms** | 4500 |
| working set at idle | 605.76 MB | **579.01 MB** | 660 |

**Compy is not measurably slower than the build its baseline was recorded against - it is the same
or slightly better on every recorded metric.** So there is no regression to roll back and nothing
here for the owner to choose between.

**The Geist font + 14->15px bump from TYPE-1 is NOT the cause.** Two settled attribution runs on the
same binary, same room, back to back, differing only by injected CSS that reverts the font stack and
the whole type scale: `E-baseline` total 22.392% vs `F-type1-reverted` total 21.178%. A 1.21-point
difference against runs whose own baselines spread 1.352 and 0.932 - inside the noise. The type work
he looked at and passed is not what he felt. `docs/perf/raw/idle-attribution-2026-08-21-{E-baseline,F-type1-reverted}.json`.

**What IS the cost, and it is not new: the ambient backdrop.** `body::before`'s `aurora` keyframe -
a gradient sliding 3% sideways over 20s behind every room - is ~88% of everything the app burns
sitting idle. Freezing that one animation and nothing else: 22.392% -> **2.067%** (E), 21.178% ->
**1.681%** (F). Nothing pauses it when the window loses focus. It has been this way the whole time.

**Why it was believed fixed: two of #127's measurements never settled.** The probe records
`"baselineStability": { "settled": false }` when its baseline never converged, and prints "NEVER
SETTLED" - and until 2026-08-21 nothing in the repo ever read that field. Run B produced "-0.105
points, i.e. gone", which became the evidence line in `src/App.css` and the rationale in
`src/ambient-animation-cost-guard.test.ts` for letting a full-window layer drift forever; run D
produced the 10.483% reported as the fix landing, and v0.9.26's GO was given partly on "about half as
much CPU sitting idle". Both figures are withdrawn. `src/perf-evidence-integrity-guard.test.ts` now
fails the build on any live file that cites an unsettled run, with a greppable line-level
`perf-unsettled-allow` hatch for text whose subject IS the unsettledness.

**DONE the same day, and it was mine, not his: the backdrop no longer animates.** Desk build
`1f2ba660` (row above) drops `animation: aurora` and `will-change: transform` from `body::before`
and keeps every gradient, position and token, so the resting frame is the same picture. Measured on
that binary with the honest instrument, 10 minutes hands-off, no CDP: idle CPU **3.403% of one
core**, against 20.853% on `584654c8` and the 23.348% this file used to carry. All three idle rows
in `docs/perf/q7-baseline.json` are re-derived from that run and the CPU row is an **earned upper
bound again at 4.5** - it was an `open finding` from the 2026-08-06 teardown until its residual
was finally named. The look loss is real (~115 px of drift over 20s on a 1440p desk) and it shipped
as a taste call under the 2026-08-07 decree, with a before/after for him to veto on sight, not as a
question. `src/ambient-animation-cost-guard.test.ts` guard 6 now fails the build on any
document-level layer that animates forever, whatever property it animates.


## Data-root integrity (#130) — RESOLVED, moved from RELEASE_STATE.md 2026-08-25

Moved byte-for-byte when RELEASE_STATE.md hit its byte budget; the resolver shipped 2026-08-18 and
nothing about it is a live gate. RELEASE_STATE.md keeps a one-line pointer here.

| Data-root integrity (#130) | **RESOLVER LANDED, OWNER DESK RECOVERED 2026-08-18.** `src-tauri/src/data_root.rs` resolves the persistence root by where it LANDS (final path + NTFS identity), not by the `APPDATA` string, and issues `MutationRoot` - the capability `history.rs`/`actions.rs` now require - only for a verified canonical root. The owner-approved option-B recovery RAN on 2026-08-18: union merge of the split Trust Ledger (3 + 61 -> **64 receipts**, zero id collisions, both inputs hash-verified and backed up to `C:UsersKuyacodecompy-data-root-recovery`), then the packaged-Claude overlay `Compy` folder MOVED (never deleted) to `overlay-Compy` in the same archive. The resolver re-run on the desk now returns **`Canonical`**, so applies and rollbacks are unblocked here. Guards: 17 unit + `scripts/data-root-guard.test.mjs` + PowerShell preflight parity (`scripts/lib/canonical-data-root.ps1`, verified passing on the desk post-merge) + 15 merge-tool guards. Not a publish blocker. **SHIPPED to the desk 2026-08-18** in the `421657a9` build - the resolver is present in the installed `%LOCALAPPDATA%\Compy\compy.exe`, so the interim "launch from Desktop/Start menu only" restriction is LIFTED. |

## Desk build `014a3e8c` — moved out of RELEASE_STATE.md 2026-08-26 (row cap)

Superseded by `72efd7e6`. Preserved byte-for-byte:

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `014a3e8c`** — built 2026-08-26 from the PRIMARY checkout on `main`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`392E11EA57AB4B6BDE304D767E0FBC83849F3F754DECF44ABF2B82D974B780AA`**. **Live == build proved by the embedded stamp, never an exe hash** — `-ProofOnly -ExpectedCommit` against the ship script: `014a3e8c · release · shell 0.9.26`, **proof attempts 1 (0 expected transient)**. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It carries **both owner rulings of 2026-08-26**: [#213](https://github.com/Pootytxng/sentinel/issues/213) **A1**: the wordmark's interior pulse is not DRAWN below `PULSE_MIN_SIZE` **22** — absent, not transparent, because a sub-pixel stroke still fattens the ring that made the mark read `©ompy`. The 22 is MEASURED, not the ~24 proposed: captured at 16/19/20/22/24 with the live token values, the pulse is an enclosed blob at 16 and 19, marginal at 20, legible at 22 — and Settings → About draws the mark at exactly 22, so no legible flourish was retired. The triple-click egg survives by revealing the pulse for the length of its own redraw, closed by a **timer**: under reduced motion `animation: none` means `animationend` never fires and the pulse would strand on screen forever. [#219](https://github.com/Pootytxng/sentinel/issues/219): the attention headline is the flagged check's label and **stops** — the `· and N more` tail is gone from the derivation and from both locales, and nothing is hidden, because the sub still prints the proportion and Check and Fix render every flagged check in full (an independent review corrected an earlier claim that Home lists them itself: it shows one flagged thing plus a door). Guards: `wordmark-small-size-guard.test.tsx` (9 tests, falsified four ways, reading the threshold and every call-site size out of source) plus the rewritten pins in `system-posture.test.ts` and `command-center-data.test.ts`. **PASS self-review (12/12)** — at 22 the pulse reads as a legible zigzag inside a visibly OPEN C under a 30× crop, and the attention headline was reached live on this desk rather than fabricated. Its predecessor **`456827bb`** (the first-win journey) and the desk lineage behind it — `5a3b5e1c`, `0fbabb93`, `4d65902e`, `b2b740bf`, `6c054b77`, `f223466a`, `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [this file](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 014a3e8c` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

## Desk build `72efd7e6` — moved out of RELEASE_STATE.md 2026-08-26 (row cap)

Superseded the same day by `b21bc18b`, which carries the two owner rulings that closed the
very walk this build shipped the first half of. Preserved byte-for-byte, except the row's own
relative links, which are re-pointed for this file's directory level:

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `72efd7e6`** — built 2026-08-26 from the PRIMARY checkout on `main`, installed silently by Claude via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`B9C187CDE464A0ED3929B622930373AC38DF5D4393F39527C33FDD3CBBD8F451`**. **Live == build proved by the embedded stamp, never an exe hash** — `72efd7e6` byte-found in the INSTALLED `%LOCALAPPDATA%\Compy\compy.exe`, install attempt 1. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It carries the **DIR-1 first-timer walk** train: (1) every room now opens at its OWN top — `.v2-content` is ONE scroll lane shared by every room and nothing reset it, so a new room inherited the last one's offset (measured: History at 300px → Health opened 300px down, and Live's only button sits 466px above the fold on a fresh visit); the reset is navigation MECHANICS, so it runs instantly with the motion layer off, on, and under reduced motion, hard-syncing Lenis through a `compy:lane-reset` event. (2) An opened Test station scrolls its panel into view, `block: "nearest"` so a reader who can already see it is not moved. (3) The glossary reaches the labels it had missed: "1% low" and "frametime" were a `<Term>` door in eight surfaces and bare text in six. **PASS self-review (12/12)**, measured not eyeballed — the reset reproduced live at 0px with motion full and reduced and rAF-sampled as instant; the new triggers match their siblings to the pixel (`.rd-label` 17px both, `.debrief-tile-label` 19.5px all four) and the tooltip lands in-bounds. That review also found `FpsPanel` is unreachable dead code — see BACKLOG. Its predecessor **`014a3e8c`** (the #213 A1 + #219 owner rulings) and the desk lineage behind it — `456827bb`, `5a3b5e1c`, `0fbabb93`, `4d65902e`, `b2b740bf`, `6c054b77`, `f223466a`, `ccc17355`, `8b1599b3`, **`5e64074c`** (THE PUBLISHED BUILD) — are byte-preserved in [this file](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 72efd7e6` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |


## Desk row superseded 2026-08-27 - `bf88150a` -> `6bf99c8c`

The round-4 Test-room visual-parity candidate, ACCEPTED by Codex for #224 and then replaced on the
desk by the round-1 Health candidate for #225. Preserved byte-for-byte, except the row's own
relative links, which are re-pointed for this file's directory level:

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `bf88150a`** - built 2026-08-27 from the worktree `compy-visual-recovery-kit-6fd074` on branch `claude/compy-visual-recovery-kit-6fd074`, installed silently via `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`2F2779B0A01C35A55E56CBEAF9F08B6385111CE146B63F7B481842525DF762DF`**. **Live == build proved by the embedded stamp, never an exe hash** - runtime `get_build_stamp` = `bf88150a . release`. **OFF `main`, UNDISTRIBUTED**: no publish, no tag, no updater move, and the branch is not merged. **Unsigned by construction** - `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. It is the **fourth visual-parity CANDIDATE for the Test room** (issue #224), answering the round-3 Codex REJECT of `2358a52d`, whose ONE remaining mismatch was the floor ring's bottom breathing room (0-5 px at 1500x980 vs ~45-50 in the comp). The fix: camera distance stays 10.2; the bench AIMS lower through a new optional `cameraTargetY` prop (default 0.2 in RigHologram - no other caller moves), bench value -0.45. Measured on the installed build (ring-apex row-scan excluding the grid's 1px lines): bottom air **31/371 px at 1280x720, 46/561 at 1500x980, 60/732 at 1920x1080** = 8.2-8.4% of stage height everywhere, vs the comp's ~8-9%; containment kept, top air visible. `lab-bench-framing-guard` grew a fifth pin (aim band, both mounts, no RigViewer default). **CORRECTION of this row's prior claim (per the round-3 verdict):** round 3's "contained with margins at all three viewports" compared SIDE margins and containment only - the BOTTOM margin was never comp-compared. Round 4's captures + composites + Health smoke are persisted at capture time at `GPT HQ/operations/compy-visual-recovery-kit/assets/candidate-bf88150a/`. **NOT VISUALLY ACCEPTED** - acceptance is the owner's and Codex's, not a green suite's. Its predecessors **`2358a52d`** (REJECTED round 3), **`16e28044`** (REJECTED round 2) and **`9bef1cc2`** (REJECTED round 1), and the whole desk lineage back to **`5e64074c`** (THE PUBLISHED BUILD), are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern bf88150a` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

## Desk row superseded 2026-09-03 - `090bc58b` -> `5ee0de97`

Moved out of RELEASE_STATE.md when the Wave 1 Lane B harvest (PR #294's Test + Health parity) was silent-installed. Row preserved verbatim except its one relative link, re-pointed at this file:

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `090bc58b`** — built 2026-08-28 from the ISOLATED Mission 2 worktree `sentinel-mission2-live-alignment` on `claude/mission2-live-alignment`, installed silently via that lane's own `scripts/ship-reinstall.ps1`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`834A22105058CF3B926A1476BA1FA898D9B246F30165A96917762A0F8CE8F205`**. **Live == build proved by the embedded stamp, never an exe hash** — `090bc58b` byte-found in the INSTALLED `%LOCALAPPDATA%\Compy\compy.exe` and `73b629ed` byte-ABSENT from it (re-scanned 2026-08-28 at this reconciliation), runtime proof `090bc58b · release · shell 0.9.26`, HKCU `DisplayVersion` 0.9.26. **ON `main`, UNDISTRIBUTED**: no publish, no tag, no updater move. **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build's final step errors after both bundles are already written. It carries **Mission 2: the Live room stops pushing its own controls out of the column.** The subtab bar had `margin-left: auto`, so it drifted off the content grid's left edge; the overlay controls floated instead of wrapping into it; and `.mc-cap-on` shipped the identical `--ix-accent` FILL as the primary `.mc-start` (measured 3751px² against 7384px²), so a ~312px column carried two identical calls to action and "one dominant action" held on size alone. ON is now an outline — accent border and accent text, the register its own sub-chips already use — and the accent FILL belongs to `.mc-start` in every state. Nothing was deleted or hidden. Three layout guards plus the shared `src/test/css-margin.ts` (real box-model shorthand expansion, so `margin: auto 0` and `margin: 0 auto 0 0` stop reading as left pushes) each landed RED before their fix. **Independent review PASS** at this head, landed as [#238](https://github.com/Pootytxng/sentinel/pull/238) closing [#236](https://github.com/Pootytxng/sentinel/issues/236). **PASS capture-based self-review** on the INSTALLED build at 1280×720 / 1500×980 / 1920×1080 across both Live faces. Its predecessor **`73b629ed`** and the whole desk lineage behind it, back to **`5e64074c`** (THE PUBLISHED BUILD), are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 090bc58b` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

## Desk row superseded 2026-09-03 - `5ee0de97` -> `1dd701b1`

The 5ee0de97 desk build failed its capture-based self-review on one defect (Health readout MEASURED pills overlapping at 1280x720) and was replaced the same session by 1dd701b1, which fixes it; it was never on `main`. Row preserved verbatim except its one relative link, re-pointed at this file:

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `5ee0de97`** — built 2026-09-03 from the worktree `.claude/worktrees/priority-order-parallel-productivity-ae19bb` on `claude/priority-order-parallel-productivity-ae19bb`, installed silently via that copy's `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`DF4CF033F1422A67AF62DB502A8F2289F9D726C014CB69948CE23051A010046B`**. **Live == build proved by the embedded stamp, never an exe hash** — runtime proof `5ee0de97 · release · shell 0.9.26` (proof attempt 1 of 1), HKCU `DisplayVersion` 0.9.26. **UNDISTRIBUTED**: no publish, no tag, no updater move; on `main` through this lane's PR (Part of #224 / #225 — acceptance stays the owner's). **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build's final step errors after both bundles are written. It carries **Wave 1 Lane B: PR #294's content harvested onto `main`** — the Test room to its ACCEPTED comp (bench re-aimed below the case, the 1920 treatment scoped to Test, the titlebar caption on the type scale), the Health room laid to its comp (evidence card at the comp's 530px box, symptom glyph measured to the MARK, readout budget measured against the real strip), the accent picker frozen to five hybrids, the reviewer guard and nine new guards; the D_health call preserved (judged at the DEFAULT accent, owner vetoes on sight, nothing writes his theme or accent). Visual gate: capture-based self-review on THIS installed build at 1280×720 / 1500×980 / 1920×1080 — verdict recorded on #224/#225. Its predecessor **`090bc58b`** and the whole desk lineage back to **`5e64074c`** (THE PUBLISHED BUILD) are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATACompycompy.exe" -Pattern 5ee0de97` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |

## Desk row superseded 2026-09-03 - `1dd701b1` -> `c82440a1`

The 1dd701b1 desk row, byte-preserved (relative link re-pointed at this file). It FAILED its own round-2 self-review (the wrapped readiness label made .hc-panel 41px too tall at 1280x720 and clipped "14 of 16 checks passed") and never landed on main; c82440a1 fixed it the same session.

| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `1dd701b1`** — built 2026-09-03 from the worktree `.claude/worktrees/priority-order-parallel-productivity-ae19bb` on `claude/priority-order-parallel-productivity-ae19bb`, installed silently via that copy's `scripts/ship-reinstall.ps1 -VerifyRuntime`, one installer on the Desktop, installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`D783D067CA3B1A5EE27841143EA6A6A1E9A1C45FD5F36DEEAFD0D98473E9A974`**. **Live == build proved by the embedded stamp, never an exe hash** — runtime proof `1dd701b1 · release · shell 0.9.26` (proof attempt 1 of 1), HKCU `DisplayVersion` 0.9.26. **UNDISTRIBUTED**: no publish, no tag, no updater move; on `main` through this lane's PR (Part of #224 / #225 — acceptance stays the owner's). **Unsigned by construction** — `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent, so the build's final step errors after both bundles are written. It carries **Wave 1 Lane B: PR #294's content harvested onto `main`** — the Test room to its ACCEPTED comp (bench re-aimed below the case, the 1920 treatment scoped to Test, the titlebar caption on the type scale), the Health room laid to its comp (evidence card at the comp's 530px box, symptom glyph measured to the MARK, readout budget measured against the real strip), the accent picker frozen to five hybrids, the reviewer guard and nine new guards; the D_health call preserved (judged at the DEFAULT accent, owner vetoes on sight, nothing writes his theme or accent). Visual gate: capture-based self-review at 1280×720 / 1500×980 / 1920×1080 — round 1 at `5ee0de97` FAILED on one defect (the readout strip's MEASURED pills overlapped at 720p; the floors had been derived from the values, never the pill), fixed here by pill-wide floors and a readiness instrument whose label wraps under the ring below 150px; round 2 at THIS build recorded on #224/#225. Its predecessors **`5ee0de97`** (failed review, same session) and **`090bc58b`** and the whole desk lineage back to **`5e64074c`** (THE PUBLISHED BUILD) are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATACompycompy.exe" -Pattern 1dd701b1` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |
