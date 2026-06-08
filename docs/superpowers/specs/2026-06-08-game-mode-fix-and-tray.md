# Game Mode persistence fix + opt-in System Tray — owner, 2026-06-08

*Two owner items. (A) Game Mode "never stays on through reboot / keeps needing re-apply" — the
export showed it applied 5× across days, the classic detect/apply-mismatch tell; fix first,
it's a live correctness bug on the honesty-critical path. (B) An opt-in "minimize to tray" with
live stats on hover — designed to RESPECT the just-shipped §1 clean-exit fix, not undo it.*

---

## A. Game Mode persistence — investigate, root-cause, fix (correctness-class)

Evidence: apply writes `HKCU\Software\Microsoft\GameBar\AutoGameModeEnabled = 1`
(`actions.rs:256`); the rec's `currently_applied` reads `game_mode_enabled()`
(`recommendations.rs:250`). The ledger carrying 5 "Enable Windows Game Mode" applies means the
state-check kept reading it as OFF after the apply persisted — so Compy re-offered it and the
user re-applied (ledger bloat) — OR the value genuinely isn't surviving reboot.

- **Step 1, trace the read:** open `game_mode_enabled()` (the state probe). Confirm it reads the
  SAME key the apply writes (`AutoGameModeEnabled`, HKCU, DWORD). Windows Game Mode has two
  historically-related values (`AutoGameModeEnabled` and the older `AllowAutoGameMode`) plus the
  Game Bar UI — a read/write key mismatch is the prime suspect.
- **Step 2, root-cause the non-persistence:** if keys match, determine what resets it — value
  type (REG_DWORD vs string), hive/redirection, or Windows rewriting it. Verify with a real
  apply → read-back → (owner) reboot → read-back.
- **Fix:** make detect and apply agree on one key + type, so a persisted Game Mode reads as
  applied and is NEVER re-offered. Reuse the audited apply/rollback contract — rollback behavior
  unchanged. Add a regression test asserting read-after-write returns applied.
- **Ledger hygiene (if confirmed):** the duplicate historical entries are real receipts — leave
  them (history is honest); just stop generating new duplicates by fixing the detection.

## B. Opt-in System Tray ("minimize to tray" + hover stats)

**§1-COMPATIBLE BY DESIGN — does not reopen the close-exits fix:**
- **Default OFF.** Closing the window = full process-tree exit, exactly as §1 shipped. Tray mode
  is a deliberate opt-in toggle in Settings → Behavior ("When I close, keep Compy running in the
  tray").
- **Visible, never a ghost.** When ON, closing HIDES the window to a VISIBLE tray icon (the
  pulse-C). The §1 ghost bug was an *invisible* windowless process holding the lock; a tray icon
  is the honest visible signal that Compy is still running — opposite of a ghost.
- **Always a Quit.** Tray right-click menu: "Show Compy" (restore window) + "Quit Compy" (the
  real full exit, same teardown as §1 — stops capture, drops the helper, app.exit). Left/
  double-click the icon = restore.
- **Single-instance dovetail:** launching again while tray-only restores the window (the §1
  single-instance hardening already recreates the window when the lock-holder has none — reuse).

### Hover stats (v1 = text tooltip; rich flyout = v2 follow-up)
- **v1 (this pass):** the tray icon's tooltip shows live text while capturing —
  `Compy · 178 fps · 1% low 133 · gpu 65°C` (reuse the overlay's existing data; CPU% works
  unelevated, FPS once capture is on). Idle (not capturing): `Compy · monitoring off`. Update on
  the existing tick; no new IPC/polling.
- **v2 (recorded, NOT now):** a rich visual flyout (mini overlay panel positioned by the tray on
  hover) — needs a small borderless positioned window; more involved. Owner-gated later.

### Constraints
Tauri tray API (`tauri-plugin`-level, in `lib.rs` run-wiring); the close-to-tray branch is gated
on the Settings flag; no new mutation; the overlay/capture lifecycle is unchanged (tray is just
window visibility + an icon). CPU temp never shown (no kernel driver). Tray icon art = the
existing pulse-C icon set.

## Acceptance
- [ ] A: apply Game Mode → state reads "applied" immediately AND after an owner reboot; rec is
      not re-offered; regression test for read-after-write; rollback unchanged.
- [ ] B: tray OFF by default (close still fully exits — §1 intact); ON → close hides to a
      visible tray icon; right-click Show/Quit work; Quit does the full §1 teardown (no ghost);
      relaunch-while-trayed restores the window.
- [ ] B: tooltip shows live FPS/temp while capturing, "monitoring off" when idle; zero new IPC.
- [ ] Tests/guards green; §1 clean-exit regression still passes; locked gates untouched.
