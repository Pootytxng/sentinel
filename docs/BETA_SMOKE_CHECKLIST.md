# Beta Smoke Checklist — owner eyes-on (run before sending invites)

*One sitting, ~15 min. Everything that can be verified headless was already checked by HQ (below);
this list is the half that needs a human watching the screen on Windows. Tick each box; if anything
fails, stop and report it. **"Beta shippable" is your call after this pass** — HQ doesn't declare it.*

**Build under test:** `Compy_0.9.0_x64-setup.exe` (NSIS, 3,826,464 B / 3.65 MB) —
`src-tauri\target\release\bundle\nsis\`, built from `37a166c`, SHA-256 `6BC2F7DF…F5A2C4` — the exact
artifact now staged for distribution (`docs/BETA_DISTRIBUTION_RECORD.md`). **Updated 2026-07-22b:**
the MSI question from earlier this date is closed — the same-day `970f801` rebuild produced BOTH
bundles (`Compy_0.9.0_x64_en-US.msi`, 5,328,896 B, alongside the NSIS), so 0.9.0 does still emit an
MSI; the NSIS remains the only artifact this beta ships. Note the owner's OWN box now runs the newer
`970f801` build (§6 presenter fix — RELEASE_STATE 22b entry); the distributed artifact the invitees
hold is still this `37a166c` NSIS. NotSigned by design.

> **Scope note (added 2026-07-22):** sections 2 and 8 below (migration, retiring old Sentinel) test
> the OWNER's OWN machine history (pre-rename `%APPDATA%\Sentinel` data). The actual 0.9.0
> invite-only testers are new external people who never ran Sentinel — those two sections don't
> apply to them and can be skipped for THIS round; they only matter if this checklist gets re-run on
> the owner's own box. **BUT some of the six DID run an earlier Compy build (0.1.0-era)** — for them
> the relevant path is section 2b (upgrade-in-place over existing `%APPDATA%\Compy` data), not
> section 2's Sentinel migration.
>
> **Elevation note:** every UAC prompt in this list (sections 2b/4/5/6) is clicked by the OWNER, by
> design — HQ's own verification stays read-only on UAC/service state per the standing
> security-settings rule and routes any elevation click here.

---

## Already verified by HQ (headless / programmatic — no action needed)
- ✅ Installer rebuilt → exactly `Compy_0.9.0_x64-setup.exe`, NotSigned, **no updater artifacts**.
- ✅ Identity strings: only the two intentional legacy literals remain (migration copy-*source* + `serde(alias)`); frontend clean; ETW session `Compy-FPS`; config `Compy` / `gg.compy.app` / `0.9.0` / `compy.gg`.
- ✅ Single-instance plugin wired first; migration is copy-not-move + atomic staging-rename + OnceLock-guarded, with a unit test; rollback resolves purely from local `history.json` (which migration copies verbatim).
- ✅ Export identity (`# Compy Report`, `compy-report-*`, UTF-8 BOM, `compy_version`); no HTTP-client dependency + CSP locks `connect-src` to self/ipc.
- ✅ Suites green — re-derived live 2026-07-22 for this pass: **cargo 858/858 (+24 ignored) ·
  npm 188 files / 1777 tests** (cargo count includes the two `f96347d` presenter-guard tests added
  after the live §6 catch below). The npm-side flakes seen during this pass were root-caused (not
  product defects) and permanently guarded in `878a3a9`: drive-letter-casing dual-instance wrapper
  (`scripts/run-vitest.mjs`), export-library timeout headroom, and an awaited passive-effect assert
  in monitor-console. Final clean run: 188/188 · 1777/1777 · exit 0. If this checklist is re-run in
  a later cycle, re-derive again — counts grow every cycle.

---

## HQ automated pass — 2026-07-22 (headless coverage of the sections below)

*Run end-to-end on the dev box against the exact staged installer (SHA-256 match re-verified).
Everything here is machine-verified; the boxes below stay unticked because they are the OWNER's
eyes-on run. What's left for the human sitting is listed at the end of this block.*

- **§1 (partial):** window title **Compy**, rail Home·Monitor·Blackbook·Lab, version **0.9.0**,
  live stamp **`37a166c · release`**, zero "Sentinel" strings in rendered UI. *Human remainder:
  real installer run + SmartScreen → Run anyway + Start-menu entry.*
- **§2:** unstageable here — no `%APPDATA%\Sentinel` exists on this box (already merged long ago),
  so per this checklist's own fallback HQ relied on the migration unit test + code review and
  confirmed the current ledger renders: **56 entries** timeline verified live
  (`docs/ui-sweep/shots/a2-tooltip.png` — mislabeled filename, it frames the Blackbook ledger).
- **§3:** staged fresh-profile run — tour auto-opens (**10 steps** — §3's body copy said "3 steps",
  corrected this pass), real rig read (RX 9070 XT · Ryzen 7 9850X3D · 31.4 GB ·
  Win11 Core 25H2), line icons / **no emoji**, Next×9 → Finish clean; FirstCheck runs real checks
  live (counter to 16, "16 checks · 1.2s"), verdict + #1 limiter named inline, "Open the dashboard"
  lands. Shots: `a2-firstrun-1/tour1/check.png` — personally reviewed, clean.
- **§4 (automated half):** tooltip shows plain-English "what", in-viewport (DOM-assert);
  "More in the Blackbook" opens + flashes the right entry; search filters 85→18 on "vrr" with an
  honest empty state; type chips work (Guides 8 · Tricks 14); Autopsy grades honestly
  ("3 real · 0 placebo · 1 risky · 1 unrecognized", "Risky — refused", won't-guess copy) and the
  "Safe how-to available →" chip appears on guide-matched claims — **theme-accent violet** (§4's
  body copy said "green" chip + "Knowledge library"; both corrected this pass → accent-colored +
  **Blackbook**). *Human remainder: enable monitoring (UAC) + overlay over a real game.*
- **§5 / §6:** not automatable by design — UAC clicks and a live DX11/12 game are the owner's.
- **§7:** second launch focuses the existing window (1 process, foreground=compy); export produced
  `compy-report-*.md` + `.json`, UTF-8 BOM intact, title "# Compy Report", version 0.9.0, zero
  Sentinel strings; **zero outbound connections** from compy.exe during a normal session.
- **§8:** uninstall `/S` → app removed, **`%APPDATA%\Compy` fully intact** (history.json 40503 B,
  sessions, exports, runtime all present; Recycle Bin clean) → reinstall `/S` → live stamp
  `37a166c · release`, **ledger renders all 56 pre-existing entries**. The WebView2 profile
  (`%LOCALAPPDATA%\gg.compy.app`) also survives uninstall, so UI state (dismissed tour) persists
  too. "Retire old Sentinel app" = **N/A on this box** (no Sentinel install exists).

**Owner-sitting status after the 2026-07-22 waiver ("fully take over or skip"):**

- **§2b upgrade-over-0.1.0 — AUTOMATED PASS (Cowork, 2026-07-22):** real cycle on this box — data+app
  backed up (hash-verified) → 0.1.0 re-cut installed → virgin 0.1.0-era data seeded by actually
  running it → the EXACT distributed artifact (downloaded through the live tester link, SHA-256
  re-verified `6BC2F7DF…`) installed over it → first launch alive 18s+, window up, old data
  preserved and extended (`intelligence.json` beside `drift.json`), zero crash events, Start-menu
  entry present → owner's `970f801` build + real data restored byte-exact (history.json hash +
  39/39 files), backups removed. Caveats named: the 0.1.0 artifact was the Jul-16 re-cut
  (`7D6C5623…`), schema-era representative, not byte-identical to the `fc940fe` kit exe; the seed
  was thin (only `drift.json` after ~46s idle), so upgrade-with-RICH old history rides on the
  migration unit tests + §8's 56-entry ledger reinstall proof. Residual risk: LOW.
- **Skipped by owner directive, risk named:** §1 SmartScreen click-through (invite text already
  warns; Windows-standard behavior, not app code — trivial) · §4/§6 overlay + FPS over a live game
  (automating the owner's game account risks anticheat — not doing that; mitigations: live
  desktop-app attribution evidence `34bd173`, presenter guards `f96347d`, helper-exit PASS, prior
  Gaming-Mode live QA — LOW-MODERATE, revisit only if a tester reports FPS weirdness) · §5 UAC
  accept/cancel (UAC policy verified stock-healthy read-only 2026-07-22; the runas decline path was
  live-proven in Gaming QA #6/#7 — LOW) · does-it-feel-right (owner runs the app daily — de facto).
- **The sitting is no longer requested of the owner.** Open item on this beta: the ride-`37a166c`
  vs cut-0.9.1 call (§B2 in the owner checklist).

---

## 1. Install + identity  *(~2 min)*
- [ ] Run the installer (`Compy_0.9.0_x64-setup.exe` — NSIS, not an MSI). SmartScreen warns (expected, unsigned) → **More info → Run anyway**. Installs without error.
- [ ] Start menu shows **Compy**; launching opens a window titled **Compy** (not Sentinel).
- [ ] About/footer + window chrome say Compy; no "Sentinel" visible anywhere.

## 2. Migration — THE CRITICAL ONE  *(~3 min)*
> **Heads-up: migration only fires on a profile where `%APPDATA%\Compy` does NOT exist yet AND
> `%APPDATA%\Sentinel` does.** On the dev box `%APPDATA%\Compy` already exists (prior runs + the
> earlier data merge), so it has already migrated and **won't re-run here** — that's correct,
> idempotent behavior, not a failure. To actually *watch* it happen, use one of: (a) a fresh
> Windows profile / VM that has the old Sentinel data, (b) a real tester who ran old Sentinel, or
> (c) temporarily move `%APPDATA%\Compy` aside (rename it) with `%APPDATA%\Sentinel` present, launch
> once, verify, then restore your real `%APPDATA%\Compy`. If you can't stage any of these, rely on
> the HQ unit test + code review for migration and just confirm your current ledger renders.
- [ ] On a stageable profile: confirm `%APPDATA%\Sentinel` exists and `%APPDATA%\Compy` does not, before first launch.
- [ ] First launch of Compy → `%APPDATA%\Compy` is created and **fully populated** (history.json, sessions, exports, scoreboard).
- [ ] Open the Trust Ledger / history → **all pre-rename entries render** (nothing lost).
- [ ] **Roll back a pre-rename applied change** → it executes correctly and the setting reverts.
- [ ] `%APPDATA%\Sentinel` is **still there, untouched** (copy-not-move safety net).

## 2b. Upgrade over an existing 0.1.0-era Compy install  *(~2 min — added 2026-07-22)*
> **Applies to any of the six invitees (or a staged profile) that already has Compy 0.1.0 installed
> with real `%APPDATA%\Compy` data.** This is NOT the section-2 Sentinel migration — migration
> correctly does nothing here because `%APPDATA%\Compy` already exists; the risk is the
> upgrade-in-place path: old data loading under the new build, and installer-over-installer residue.
- [ ] Run `Compy_0.9.0_x64-setup.exe` **without uninstalling 0.1.0 first** → installs without error; app launches and reports **0.9.0**.
- [ ] `%APPDATA%\Compy` data survives untouched: Trust Ledger shows **all entries applied under 0.1.0**; sessions/exports/scoreboard still present.
- [ ] **Roll back a change that was applied under 0.1.0** → executes correctly under 0.9.0 (rollback resolves from `history.json` alone, so old entries must stay undoable across versions).
- [ ] Add/Remove Programs shows **ONE Compy at 0.9.0**. Caveat: if the old install was the 0.1.0 **MSI**, the NSIS upgrade won't remove that entry — uninstall the stale MSI entry afterwards (`%APPDATA%` data persists through it).
- [ ] No stale 0.1.0 process or Start-menu duplicate; single-instance behavior still holds (second launch focuses the window).

## 3. First-run guided arc, end to end  *(~3 min — the whole reason the beta exists)*
- [ ] First launch shows the new guided Setup & Tour (10 steps, your real rig snapshot, line icons — **no emoji**), not the old 4-step lecture.
- [ ] First-check landing runs the real checks, shows honest elapsed (~seconds), then the verdict + #1 limiter.
- [ ] "Open the dashboard" lands cleanly. Re-run via the footer link works.

## 4. Tooltips + Library + overlay (visual)  *(~3 min)*
- [ ] Hover/tap a dotted-underline term (e.g. **1% low** on a debrief, or **VRR / driver / power plan** on a readiness row) → tooltip shows the plain-English "what"; **positioning isn't clipped** at screen edges.
- [ ] "More in the Blackbook" opens the **Blackbook**, focused + flashing the right entry.
- [ ] Blackbook: search works; type filter chips work; **Autopsy a guide** → paste a tweak list → honest grade + an accent-colored "Safe how-to available" chip where applicable.
- [ ] Enable monitoring (1 UAC prompt — **accept**); overlay draws over a borderless/windowed game and is readable.

## 5. UAC accept / cancel UX  *(~1 min)*
- [ ] Apply an elevated tweak → **accept** the UAC prompt → change applies; ledger records it.
- [ ] Apply another → **cancel** the UAC prompt → Compy reports it stopped cleanly (no crash, no half-applied state, honest message).

## 6. Live FPS helper  *(~1 min, needs a DX11/DX12 game running)*
- [ ] With a game running + monitoring on, the FPS/frametime panel + overlay show live numbers.
- [x] Turn monitoring off / close the app → the elevated helper exits on its own (no lingering `compy.exe` in Task Manager). *(Machine-verified live 2026-07-22: after the app closed, the heartbeat went stale and helper PID 8424 self-exited ≤15s — watcher log "section 6 exit box: PASS".)*

> **Live evidence 2026-07-22 (owner's Marvel Rivals sitting, pre-fix `37a166c` build):** capture ran the
> whole session (1189 + 666 samples across two watchers, avg ~265–285 fps) and DID attribute to
> `Marvel-Win64-Shipping.exe` — but ALSO, persistently, to an empty-named dwm presenter at fabricated
> rates (the picker bug), and to desktop apps between matches. The dwm bug is FIXED + regression-guarded
> (`f96347d`, live on the owner's box as `970f801`); the between-matches attribution is a BACKLOG design
> item (`34bd173`). **The first box above should be eyeballed on the FIXED build at the owner's next
> sitting** — the panel should now name the game, never a blank/desktop process while one is fullscreen.

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
