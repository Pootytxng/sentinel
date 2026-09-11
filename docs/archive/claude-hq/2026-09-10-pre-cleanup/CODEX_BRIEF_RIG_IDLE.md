# Codex brief — RIG-IDLE (#127) evidence gathering

**Paste everything below the line into Codex.** It is self-contained. Three tasks, all mechanical —
no design judgment required, no code changes. The point is to hand Claude answers it can act on in a
few thousand tokens instead of spending a lane rediscovering them.

**Rules for the operator (you):** Task A flips a flag in Compy's localStorage and MUST restore it.
If Codex stops midway, the fix is to set `compy_home_rig_3d` back to `"1"` (or delete the key —
default is ON) in the app's WebView2 localStorage, or just reinstall. Nothing else it does is
stateful.

---

## CONTEXT (do not re-derive this — it is measured fact)

Repo: `C:\Users\Kuya\code\sentinel`, branch `main`, clean at `8c547ce7`. Windows, PowerShell 5.1.
App: Compy, Tauri + React + react-three-fiber. Installed build **v0.9.25** (`efde8310`).

GitHub issue **#127** ("RIG-IDLE") records this. Read it first: `gh issue view 127 --repo Pootytxng/sentinel`.

Measured with `node scripts/q7-probe.mjs attribute --port 9455 --settle 30 --phase 60`, Home, idle:

| band | % of one core | share |
|---|---|---|
| **rAF frame loops** | **20.137** | **83.8%** |
| runtime floor | 1.681 | 7.0% |
| CSS/WAAPI animations | 1.547 | 6.4% |
| timers | 0.672 | 2.8% |
| **total idle** | **24.037** | |
| **rAF frozen** | **2.353** | |

Baseline 2026-08-06 for comparison: total **11.694**, rAF band **1.813**. Raw files:
`docs/perf/raw/idle-attribution.json` (baseline, do not overwrite) and
`docs/perf/raw/idle-attribution-2026-08-13-v0.9.25.json` (current).

**Hypothesis under test:** drei's `OrbitControls` calls `controls.update()` from inside a `useFrame`
and invalidates on the controls' `change` event; react-three-fiber v9 treats an `invalidate()` raised
*during* a frame as `state.internal.frames = 2`, which decrements to 1 and never reaches 0 — so
`frameloop="demand"` latches free-running. Already eliminated: the Geist font, the
`compy_hologram_v2` flag (it is `null`, so `frameloop` genuinely resolves to `"demand"`),
`use-rig-colors` object churn, `nextFanSensors`, and any rig source change in v0.9.18..v0.9.25.

⚠️ **A page-level `requestAnimationFrame` counter reported "0 calls in 29s" on a fresh launch and is
NOT trustworthy** — r3f captured its own scheduler reference at module init, so a patch installed
after boot is blind to it. Do not use that technique. Use the methods below.

---

## TASK A — the decisive attribution test (highest value)

**Question:** do those 20 rAF points actually belong to the 3D rig?

1. Launch Compy with a debug port. **This must be a wrapper `.ps1` run with `-File`** — inside a
   `powershell -Command "..."` string, `$env:X` is eaten and nested quotes fail to parse:
   ```powershell
   if (Get-Process compy -EA SilentlyContinue) { Stop-Process -Name compy -Force; Start-Sleep 3 }
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
   Start-Process (Join-Path $env:LOCALAPPDATA "Compy\compy.exe")
   Start-Sleep -Seconds 24
   ```
2. Set the flag OFF, then fully restart the app so the flag takes effect on a clean mount:
   `node docs\ui-sweep\cdp-eval-file.mjs 9333 <a file containing>` →
   `localStorage.setItem("compy_home_rig_3d","0")`
   Then stop Compy and relaunch it (port not needed for the probe — it launches its own instance).
3. **Stop Compy entirely**, then run the probe:
   `node scripts/q7-probe.mjs attribute --port 9455 --settle 30 --phase 60`
4. **IMMEDIATELY** copy the result out and restore the baseline file, because the probe overwrites it
   in place:
   ```powershell
   Copy-Item docs\perf\raw\idle-attribution.json docs\perf\raw\idle-attribution-RIGOFF.json -Force
   git checkout -- docs\perf\raw\idle-attribution.json
   ```
5. **RESTORE THE FLAG — do not skip this.** Relaunch with the port and eval
   `localStorage.setItem("compy_home_rig_3d","1")`, then run `node scripts/q7-probe.mjs restore` to
   put the app back without a debug port. Verify by reading the key back.

**Report exactly this and nothing more:**
```
TASK A
  total idle % of one core (rig OFF):  <n>
  rAF band % (rig OFF):                <n>   share <n>%
  CSS/WAAPI band %:                    <n>
  timers band %:                       <n>
  runtime floor %:                     <n>
  rafBandValid:                        <true/false>
  flag restored to "1":                <yes/no>
```

**Interpretation (state which one, one line):** if the rAF band collapses to roughly the 1.8 baseline,
the rig owns it and #127's diagnosis holds. If it stays near 20, the diagnosis is WRONG and the rig is
not the owner — say so plainly, that is the most valuable outcome this task can produce.

## TASK B — did a dependency bump cause it? (cheap, no app state touched)

No rig source changed between v0.9.18 and v0.9.25, yet the rAF band grew ~11×. `@react-three/fiber`,
`@react-three/drei` and `three` are all **caret ranges** in `package.json`, so a lockfile refresh
could have pulled in the `frames = 2` behaviour.

```powershell
cd C:\Users\Kuya\code\sentinel
git log --oneline --all -- package-lock.json
# then for each commit that touches it, in the v0.9.18 (cfc0c4b7) .. HEAD window:
git log -p cfc0c4b7..HEAD -- package-lock.json > $env:TEMP\lockdiff.txt
```
Search that diff for `@react-three/fiber`, `@react-three/drei`, `three`, and report **only version
transitions**.

**Report exactly:**
```
TASK B
  commits touching package-lock.json in cfc0c4b7..HEAD: <list of short SHAs, or NONE>
  @react-three/fiber:  <old> -> <new>   (commit <sha>)   or UNCHANGED
  @react-three/drei:   <old> -> <new>   (commit <sha>)   or UNCHANGED
  three:               <old> -> <new>   (commit <sha>)   or UNCHANGED
  installed now (npm ls, exact): fiber <v>  drei <v>  three <v>
```

## TASK C — observe the latch directly (confirms the mechanism)

Prove or disprove that `state.internal.frames` never reaches 0. Launch with the debug port (Task A
step 1), stay on **Home**, and eval a file that samples r3f's own store rather than the DOM.

The Canvas root store is reachable from the canvas element's react-fiber internals. A robust way:
```js
// find the r3f root store off the canvas element's fiber, then sample internal.frames 20x over ~2s
```
If you cannot reach the store in a few minutes, **do not burn time** — fall back to counting the
controls' change events, which tests the same claim:
```js
// after the scene has mounted, on the OrbitControls instance:
controls.addEventListener('change', () => { window.__oc = (window.__oc||0)+1; });
// wait ~10s with NO mouse input over the window, then read window.__oc
```
Reaching `controls` is the fiddly part (`makeDefault` puts them in the r3f store). If neither is
reachable, say so and stop — Task A is the one that matters.

**Report exactly:**
```
TASK C
  method used:            <internal.frames | oc-change-count | UNREACHABLE>
  observation:            <e.g. "frames stayed at 1 for all 20 samples" | "oc-change fired 612 times in 10s with no input">
  verdict:                <LATCHED | NOT LATCHED | INCONCLUSIVE>
```

---

## HARD RULES

- **Do not change application source. Do not commit. Do not push.** This is evidence gathering only.
  The only file writes allowed are the two probe JSON copies named above, and they stay uncommitted.
- **Do not overwrite `docs/perf/raw/idle-attribution.json`** — it is the 2026-08-06 baseline and the
  probe clobbers it in place. Copy the result out, then `git checkout --` it back. Every time.
- **Leave the repo clean.** Finish with `git status --short` showing nothing but the two new
  `-RIGOFF`/scratch JSONs, and say so.
- **Restore `compy_home_rig_3d` to `"1"`** and confirm it in your report.
- PowerShell 5.1: write wrappers to `$env:TEMP` and run with `-File`. Never put a scratch `.ps1` in
  the repo — the release pipeline refuses a dirty tree. Multi-line or quote-bearing JS cannot ride
  the argv; write it to a file and use `cdp-eval-file.mjs`.
- Probe timing: `attribute` with 60s phases takes ~6 minutes. Let it finish.

## WHAT TO SEND BACK

Just the three fenced report blocks above, plus one short paragraph if anything surprised you or a
rule had to be broken. **Do not paste raw JSON, full diffs, or probe logs** — the whole point is a
compact answer. If Task A's verdict contradicts #127, lead with that.
