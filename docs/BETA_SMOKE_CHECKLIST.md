# Beta Smoke Checklist — owner eyes-on (run before sending invites)

*One sitting, ~15 min. Everything that can be verified headless was already checked by HQ (below);
this list is the half that needs a human watching the screen on Windows. Tick each box; if anything
fails, stop and report it. **"Beta shippable" is your call after this pass** — HQ doesn't declare it.*

**Build under test:** `Compy_0.1.0_x64_en-US.msi` (3.8 MB) — `src-tauri\target\release\bundle\msi\`
(or the NSIS `Compy_0.1.0_x64-setup.exe`, 2.5 MB, in `…\bundle\nsis\`). NotSigned by design.

---

## Already verified by HQ (headless / programmatic — no action needed)
- ✅ Installer rebuilt → exactly `Compy_0.1.0_x64_en-US.msi` + `Compy_0.1.0_x64-setup.exe`, NotSigned, **no updater artifacts**.
- ✅ Identity strings: only the two intentional legacy literals remain (migration copy-*source* + `serde(alias)`); frontend clean; ETW session `Compy-FPS`; config `Compy` / `gg.compy.app` / `0.1.0` / `compy.gg`.
- ✅ Single-instance plugin wired first; migration is copy-not-move + atomic staging-rename + OnceLock-guarded, with a unit test; rollback resolves purely from local `history.json` (which migration copies verbatim).
- ✅ Export identity (`# Compy Report`, `compy-report-*`, UTF-8 BOM, `compy_version`); no HTTP-client dependency + CSP locks `connect-src` to self/ipc.
- ✅ Suites green: `cargo test` 206/206, `npm test` 114/114, tsc + vite clean.

---

## 1. Install + identity  *(~2 min)*
- [ ] Run the MSI. SmartScreen warns (expected, unsigned) → **More info → Run anyway**. Installs without error.
- [ ] Start menu shows **Compy**; launching opens a window titled **Compy** (not Sentinel).
- [ ] About/footer + window chrome say Compy; no "Sentinel" visible anywhere.

## 2. Migration — THE CRITICAL ONE  *(~3 min; only meaningful if `%APPDATA%\Sentinel` exists from the old app)*
- [ ] Before first launch, confirm `%APPDATA%\Sentinel` exists (the old ledger). If it doesn't, skip this section and note it.
- [ ] First launch of Compy → `%APPDATA%\Compy` is created and **fully populated** (history.json, sessions, exports, scoreboard).
- [ ] Open the Trust Ledger / history → **all pre-rename entries render** (nothing lost).
- [ ] **Roll back a pre-rename applied change** → it executes correctly and the setting reverts.
- [ ] `%APPDATA%\Sentinel` is **still there, untouched** (copy-not-move safety net).

## 3. First-run guided arc, end to end  *(~3 min — the whole reason the beta exists)*
- [ ] First launch shows the new onboarding (3 steps, your real rig snapshot, line icons — **no emoji**), not the old 4-step lecture.
- [ ] First-check landing runs the real checks, shows honest elapsed (~seconds), then the verdict + #1 limiter.
- [ ] "Open the dashboard" lands cleanly. Re-run via the footer link works.

## 4. Tooltips + Library + overlay (visual)  *(~3 min)*
- [ ] Hover/tap a dotted-underline term (e.g. **1% low** on a debrief, or **VRR / driver / power plan** on a readiness row) → tooltip shows the plain-English "what"; **positioning isn't clipped** at screen edges.
- [ ] "More in the library" opens the **Knowledge library**, focused + flashing the right entry.
- [ ] Library: search works; type filter chips work; **Autopsy a guide** → paste a tweak list → honest grade + a green "Safe how-to available" chip where applicable.
- [ ] Enable monitoring (1 UAC prompt — **accept**); overlay draws over a borderless/windowed game and is readable.

## 5. UAC accept / cancel UX  *(~1 min)*
- [ ] Apply an elevated tweak → **accept** the UAC prompt → change applies; ledger records it.
- [ ] Apply another → **cancel** the UAC prompt → Compy reports it stopped cleanly (no crash, no half-applied state, honest message).

## 6. Live FPS helper  *(~1 min, needs a DX11/DX12 game running)*
- [ ] With a game running + monitoring on, the FPS/frametime panel + overlay show live numbers.
- [ ] Turn monitoring off / close the app → the elevated helper exits on its own (no lingering `compy.exe` in Task Manager).

## 7. Single-instance + export + network  *(~1 min)*
- [ ] Launch Compy a second time → it **focuses the existing window**, no second instance.
- [ ] Export a report → file is named **`compy-report-*.md`**, title **"Compy Report"**, opens correctly (BOM intact — no stray characters at the top).
- [ ] (Optional) With a network monitor open, do a normal session → **zero outbound connections** from compy.exe.

## 8. Uninstall / reinstall + retire old app  *(~1 min)*
- [ ] Uninstall Compy → reinstall → your `%APPDATA%\Compy` data (ledger/sessions) **persists**.
- [ ] Once all the above pass, **uninstall the old Sentinel app** from Add/Remove Programs. Leave `%APPDATA%\Sentinel` in place as the safety net (delete it weeks later, not now).

---

**If all boxes pass → it's your call to flip to "beta shippable" and send invites.** Anything that
fails, paste it back and HQ fixes it before invites go out.
