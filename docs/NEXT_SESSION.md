# Next Session — Pick Up Here

**Last touched:** 2026-05-27
**Last commit:** `708b8b4` docs: relocate planning docs into the Windows-side repo
**Status:** baseline functioning; Game Mode apply + rollback confirmed working end-to-end.

---

## Where we are

- Native Tauri 2 app at `C:\Users\Kuya\code\sentinel\` — runs at ~35 MB
- Hardware detection working: CPU, RAM, GPU (via WMI), disks, OS
- 9 conditional recommendations across Windows / Power / GPU / Storage / Network
- Current-state detection wired for Power Plan, Game Mode, NVIDIA telemetry service, SysMain — those recs honestly say "✓ Already set" when applicable
- Apply + rollback machinery wired for `game-mode` only:
  - Snapshot captured to `%APPDATA%\Sentinel\history.json`
  - Reversible via per-change "Roll back" button
  - HISTORY_LOCK Mutex serializes concurrent ops
- Repo is local-only (no GitHub remote)
- WSL no longer required for any Sentinel work

## Open loop

None — Game Mode round-trip confirmed by user. Ready for the next batch.

## Next batch — in priority order

### 1. Wire 2–3 more HKCU-scope recs for one-click apply (highest leverage, low risk)

Same pattern as `apply_game_mode` / `rollback_game_mode` in `src-tauri/src/lib.rs`. No admin needed because these are all HKCU.

- **`visual-effects`** — set `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects\VisualFXSetting = 2` (best performance preset). Snapshot the prior value. Also need to snapshot + write `HKCU\Control Panel\Desktop\UserPreferencesMask` (binary blob — the multi-byte mask that toggles individual effects). Most complex of this batch but still HKCU.
- **`amd-uxp`** — only fires when an AMD GPU is detected. AMD User Experience Program opt-out lives in `HKCU\Software\AMD\CN\...` (exact key needs verification on a real AMD machine — may need to install Adrenalin to find the path).
- **`startup-debloat`** — this one is NOT a single toggle. It's "review and disable noisy startup apps." Reframe as: enumerate enabled startup items from `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` + `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`, present a list, let the user pick which to disable individually. Each disable = one AppliedChange entry. This is a small new UI surface — flag it before building so user agrees the deviation from "single toggle" pattern is worth it.

For each new appliable rec, also add its id to the `APPLIABLE_REC_IDS` set in `src/App.tsx`.

### 2. Tighten state detection for the remaining recs

These still hardcode `currently_applied: false`. Each is a small registry read:

- **`visual-effects`** — read `VisualFXSetting`, set applied if `== 2`
- **`amd-uxp`** — read AMD CN registry value
- **`nagle-disable`** — enumerate `HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{guid}` and check for `TcpAckFrequency = 1`. HKLM means READ may need elevation; on most systems standard users can read these keys without elevation. Verify.
- **`nvidia-low-latency`** — per-game NVIDIA driver setting; not externally introspectable without parsing NVIDIA's binary config. Probably leave as "manual" forever or skip.
- **`gpu-prefer-discrete`** — per-game GraphicsPerformancePreference under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`. Could be detected per-game.

### 3. Admin-elevation pattern (unblocks ~half the remaining recs)

Anything that writes HKLM, changes a service start mode, or modifies power plans needs admin. The clean architectures are:

- **Option A: One-shot UAC at apply time.** Use `runas` verb or a Windows helper to launch a one-shot elevated process that performs the action then exits. User gets a UAC prompt per action.
- **Option B: Persistent elevated helper.** Sentinel launches a small companion process at admin level (UAC once at startup if available), and the main process talks to it over a local IPC channel. Better UX, more architecture.
- **Recommendation:** start with Option A. Migrate to Option B if friction becomes a real complaint.

Recs that unblock with admin: `power-ultimate` (powercfg /setactive), `sysmain-disable` (sc config), `nvidia-telemetry` (sc config), `nagle-disable` (HKLM write).

### 4. After the above is solid: GitHub push

Local repo has 5 commits. User wants this offsite eventually. Needs:
- GitHub account / SSH key configured on Windows (verify before assuming)
- Decision: public or private repo? (Probably private until launch.)
- The `/push` skill should handle most of it once the remote exists.

## Things explicitly NOT to do until the baseline is more complete

Per user direction: *"establish a baseline and get everything functioning and accurate then work out aesthetics or additional widgets after."*

- No new widgets / sections / pages in the UI beyond what already exists
- No aesthetic polish beyond what's already there (the dark theme is good enough)
- No new hardware coverage (installed-games scan, monitor refresh-rate detection, etc.) — Phase 2 expansion is parked
- No fancy modals / animations / icons — keep using `window.confirm()` for now

## Quick verification on session resume

When picking up next session, run:

```powershell
cd C:\Users\Kuya\code\sentinel
git log --oneline
npm run tauri dev    # incremental rebuild ~10s if no Cargo.toml changes
```

App should launch and show: hardware grid, 9-ish recommendations, applied-changes section (if any past changes), Game Mode card showing whatever state it's actually in right now.
