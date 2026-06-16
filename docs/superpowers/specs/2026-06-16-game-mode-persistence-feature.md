# SPEC — Game Mode persistence (in-app "keep it on") — option 1(b)

> Status: DESIGN — owner mechanism decision pending, then build DARK behind a default-OFF gate.
> Context: `CLAUDE.md` Game Mode banner (2026-06-16). 1(a) honest caveat already SHIPPED (`c6a1881`).
> The owner's machine is already fixed by a local Startup helper (`CompyKeepGameModeOn.vbs`) — this
> spec is the *product* version for other affected users (AMD ReLive / NVIDIA ShadowPlay rigs).

## Problem
Game-recording software resets Windows Game Mode to OFF at every login (proven on the owner rig:
AMD Radeon/ReLive's `RSServCmd` logon service rewrites `HKCU\...\GameBar` ~46s post-boot). So a
one-shot apply never persists. A login-delayed RE-ASSERT wins (reboot-verified, +103s). 1(b) brings
that fix in-app, opt-in.

## Hard constraints (LOCKED / doctrine)
- **Rollback-first (LOCKED 3):** apply must capture a rollback that fully removes whatever persistence
  mechanism it installs. Never install something we can't cleanly remove.
- **AV-reputation is moat-critical (doctrine):** the mechanism must NOT look like malware to antivirus.
  A dropped script autorun that writes the registry at logon is a classic AV heuristic → REJECTED.
- **New mutation primitive → its own QA** (apply / rollback / reboot-persist / AV-scan) before the gate
  flips or any installer is cut. Ships DARK behind a default-OFF gate (the `gaming_mode_gate` /
  `blackbox_v2_gate` / `receipts_gate` pattern). No installer cut, no send until QA + owner GO.
- Non-elevated preferred (HKCU only, like the existing game-mode apply).

## Mechanism options + AV analysis
- **A. Drop a `.vbs`/`.cmd` autorun in the Startup folder** (what the owner's manual fix uses).
  Works without Compy running, but **REJECTED for shipping**: a script autorun writing the registry at
  every login is a textbook AV false-positive trigger. Fine as a *manual* local fix, unacceptable as a
  shipped Compy behavior.
- **B. Create a Scheduled Task** (logon trigger + delay → `reg` write). Registering a task generally
  needs elevation (admin) and AV still flags logon tasks that write registry. Medium risk + UAC friction.
- **C. App self-reassert (RECOMMENDED).** Compy itself re-asserts Game Mode — on its own startup AND on
  its existing monitoring tick while running — behind a default-OFF "keep Game Mode on" pref. **AV-safe
  by construction:** it's the signed app writing a value it already writes via the normal apply, with NO
  new autorun artifact. Pair with an opt-in **"start Compy with Windows"** (HKCU `...\Run` → `compy.exe`,
  which Compy already *reads* for startup-apps detection) so coverage matches the manual fix. Rollback =
  toggle off (and remove the Run entry) — trivial and complete.

## Recommendation
**Mechanism C**, surfaced honestly: *"Keep Game Mode on — needs Compy running, so we'll offer to start
Compy with Windows."* Trade-off vs. the manual VBS: C only holds while Compy runs (hence the
start-with-Windows pairing). That's a small coverage cost in exchange for zero AV risk — the right trade
for the brand. If the owner wants always-on coverage independent of Compy, that's mechanism B with its
elevation + AV cost, decided explicitly.

## Build plan (on owner mechanism GO)
1. `keep_game_mode_gate()` → false (dark), + a persisted `keep_game_mode_on` pref (mirror
   `tray::set_close_to_tray`).
2. Behind gate+pref: re-assert the GameBar pair on app startup and on the monitoring tick (reuse the
   audited `actions` write path; non-elevated).
3. Optional opt-in "start with Windows" (HKCU Run add/remove) with its rollback.
4. Frontend: a toggle on the Game Mode rec / Settings, honest copy, consent.
5. Tests: pref store, gated no-op when off, reassert writes both keys. **QA before any flip/ship:**
   enable → reboot → Game Mode holds; disable → no reassert + Run entry removed; AV-scan the build.

## The ONE decision for the owner
Confirm **mechanism C** (AV-safe, while-Compy-runs + start-with-Windows) — or say you want B
(always-on via scheduled task, accepting elevation + AV risk). Build starts the moment you pick.
