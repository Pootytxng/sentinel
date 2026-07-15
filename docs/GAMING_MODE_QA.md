# Gaming Mode (F1) — Owner QA Checklist

**Purpose:** the hands-on, owner-run confirmation that F1 Gaming Mode's restore contract holds on
real hardware. **Status (2026-06-18 → current):** `gaming_mode_gate()` is **`true` on `main`** — the
"Gaming" surface ships and the 5 commands work. It was flipped on after the `#[cfg(test)] #[ignore]`d
§7 restore-contract harness passed **6/6 on the dev rig** (exact-restore · crash/orphan recovery ·
no-partial-on-cancel-at-start · RestoreFailed-on-cancel-during-restore · fail-loud-missing-plan ·
restore-targets-stored-GUID-on-external-change). **What this checklist is now:** the *live, in-the-field*
proof that the harness can't give — the cases that need **crashing the app, rebooting mid-session, and
cancelling real UAC prompts on your hardware.** Case **#4 (full reboot)** is the headline one. Source:
`docs/superpowers/specs/2026-06-02-gaming-mode-f1-design.md` §7 · contract `docs/GAMING_MODE_PLAN.md` §8.

**Fully reversible:** if any case fails, set `gaming_mode_gate()` → `false` to re-hide the whole feature
while I fix the bug on a branch — nothing else has to change.

---

## How to run it

Just use the **installed build** (the gate is on — a **"Gaming"** entry is live in the app). No special
build needed. Test on a real **UAC-on** machine (this rig qualifies — `EnableLUA=1`).

**Before each test:** create a Windows **Restore Point** (belt-and-suspenders). Have a game ready — or
just exercise start/stop without one (the power-plan/registry changes apply regardless).

---

## The checklist — restore must always reach the exact prior state, or fail loudly

- [x] **1. Normal start → stop.** Start Gaming Mode → confirm power plan switched to max-perf, Windows
      Game Mode on, Game Bar/DVR off (honesty line lists them). Stop → **confirm your exact prior power
      plan + Game Mode/Bar values are restored.** Session file cleared.
      ✅ **PASSED 2026-07-14 (CC-driven live-app run — CDP over the installed `2eda4eb` build, owner
      present; registry/powercfg ground-truth probe before/after each case):** start applied Game Mode
      0→1 with truthful prior snapshots in `gaming-session.json`; only 2 changes recorded because the
      plan was ALREADY Ultimate Performance (honest no-op — the plan-apply path itself was exercised in
      cases #8/#9 below, Balanced→Ultimate). Stop → probe byte-identical to the pre-start baseline,
      session file cleared.
- [x] **2. Consent gate (first use).** First enable shows the one-time modal (what changes + restore
      guarantee) and requires confirmation; subsequent starts are one-click.
      ✅ **PASSED 2026-07-14 (same run):** consent flag (`compy_gaming_consent_v1`) cleared → Start
      blocked by the modal, NO session started; **Cancel** → nothing applied, flag stays unset; Start →
      **Enable Gaming Mode** → session starts + flag set; next start = one-click (no modal).
- [x] **3. App crash while Active.** Start Gaming Mode, then **kill `compy.exe`** (Task Manager) mid-
      session. Relaunch → the toggle should show **Gaming Mode "on"** (live session resumed); click Stop
      → prior state restored. *(An active session resumes rather than false-prompting.)*
      ✅ **PASSED 2026-07-14 (same run):** killed `compy.exe` mid-session (file stayed `active`) →
      relaunch shows the **recovery banner** ("a Gaming Mode session was interrupted — still applied,
      not yet restored" + Resume / Restore now / Review) — the evolved T6c design supersedes the
      literal "toggle shows on" wording: honest about interrupted state instead of silently resuming.
      **Resume** → rolled back first, then restarted as a NEW session (`gm-1784075442678`) with clean
      prior snapshots (rollback-before-restart proven) → Stop → probe byte-identical to baseline.
- [x] **4. Full reboot while Active. ← the headline case.** Start Gaming Mode → **reboot the PC** without
      stopping. After reboot, launch Compy → it detects the unfinished session (`gaming-session.json`)
      and **prompts to restore**; confirm → **exact prior state restored.** *(This is the one the
      automated harness cannot prove — it's the whole reason this checklist exists.)*
      ✅ **PASSED 2026-07-07 (owner-run on the post-T6 build, `d557e70` installer):** enable (USB+PCIe
      advanced tier) = ONE UAC (owner-confirmed) → reboot → relaunch → restore prompt → "Restore now"
      → CC read-only verification: session contract cleared (only reachable when every restore
      confirms) + every probed value back at the owner's standing-ledger state (Ultimate Perf plan ·
      USB-SS/ASPM at his applied-rec values · services at his applied-rec states). The 2 restore-side
      UACs = per-elevated-change restore, expected (see #10) → T6b batching candidate. Finding: restore
      success shows NO visible confirmation (owner couldn't tell it worked) — UX-gap candidate logged.
      *(Both findings BUILT 2026-07-08: T6b restore-side batching — one UAC for the whole restore,
      `qa10` + the `a_full_elevated_restore_dispatches_exactly_one_elevation` pin — and the visible
      restore confirmation naming every restored change on both surfaces. Next real session run
      doubles as the live eyeball.)*
- [x] **5. Game exits / you stop normally.** Restore fires, prior state restored, session cleared.
      ✅ **PASSED 2026-07-14 (same run):** Stop → probe byte-identical to baseline, session cleared,
      and the T6b **visible restore confirmation** live-eyeballed: green "✓ Your settings are back —
      Restored 2 changes" card naming each change (`docs/ui-sweep/shots/gm-qa-restore-confirmation.png`).
- [x] **6. UAC cancel during START (advanced tier).** Enable the USB-SS / PCIe-ASPM advanced toggles,
      start, and **cancel the single UAC prompt** (since T6, 2026-07-07, the whole advanced tier —
      USB + PCIe + any service suspends — rides ONE prompt). → no partial state left; whatever core
      items applied are rolled back **with no further prompts**; clear error; no session file
      lingering as `active` without a contract.
      ✅ **PASSED 2026-07-14 (CC-driven on the `db5349e` build, owner clicking the real prompts).**
      Start with USB+PCIe → owner clicked **No** → honest decline error ("Advanced options: You didn't
      approve the elevation prompt — nothing was changed."), NO second prompt, ground-truth probe
      byte-identical to baseline, no session file. **This case's FIRST attempts exposed and were blocked
      by a real bug** (see the runas note below) — an earlier "pass" of #6 recorded mid-run on the
      pre-fix `2eda4eb` build was INVALID (the decline was misattributed as an approved-then-failed
      elevation and a spurious SECOND prompt fired) and was never checked off.
- [x] **7. UAC cancel during RESTORE.** Trigger a restore that needs UAC (advanced tier applied) and
      **cancel the single UAC prompt** (since T6b, 2026-07-08, the whole elevated restore tier rides
      ONE prompt, mirroring #6's start side) → status `RestoreFailed`, the contract is **retained**,
      a clear retry path is shown, it **never reports success**, and the decline is **never followed
      by more prompts**. Retry → completes (ONE prompt again).
      ✅ **PASSED 2026-07-14 (same `db5349e` run, click order No·Yes·No·Yes):** start → **Yes** →
      4-change active session (both advanced items `elevated_restore: true`, truthful prior snapshots) →
      stop → **No** → honest decline error, session file retained with status `restore-failed` and all
      4 changes intact, NO false success, no extra prompts → retry stop → **Yes** → full restore,
      session cleared, probe byte-identical to baseline.

> **⚠ The runas bug (found BY this checklist, fixed 2026-07-14, commit `db5349e`):** the `runas` crate
> (1.2.0) never returns `Err` on Windows — a UAC **decline** (ShellExecuteExW → ERROR_CANCELLED 1223)
> was collapsed to `Ok(exit -1)`, so the app told the user *"You approved the elevation, but the
> operation itself failed"* after they clicked No, and the abort path fired a **spurious second
> prompt**. Replaced with our own `actions::elevate_and_wait` (ShellExecuteExW with the launch error
> preserved; a missing/unreadable exit maps conservatively, never to fabricated success) at all 3 call
> sites; 3 guard tests pin the 1223→decline mapping. Cases #6/#7 above ran on the fixed build. A
> mid-diagnosis run with NO visible prompts was traced to a driver-side arg-casing slip (camelCase
> serde contract → all-false opts → core-only session, honestly promptless), not an app defect; UAC
> policy (`EnableLUA=1`/`CPBA=5`/secure desktop) and the app's non-elevated token were verified
> read-only before the passing run.

- [x] **8. Missing power plan at restore.** Apply Gaming Mode, then delete the prior power plan
      (`powercfg /delete <guid>`) before stopping. Stop → **fails safe with a clear message** (never a
      silent fallback / wrong plan).
      ✅ **PASSED 2026-07-14 (same run):** started from a throwaway plan → deleted it mid-session →
      Stop **FAILED LOUD**: "⚠ Couldn't fully restore your settings — they may still be changed. Try
      Stop again…", pill stays "on", NO false-success card, session status `restore-failed` with all
      3 changes **retained**. Resurrected the GUID (`powercfg /duplicatescheme`) → retry Stop → full
      restore to the stored throwaway plan, session cleared. Cleanup verified probe == baseline.
- [x] **9. External power-plan change mid-session.** Switch power plans manually (Windows) while Gaming
      Mode is active. Stop → restore still targets the **stored** prior GUID; honest about state.
      ✅ **PASSED 2026-07-14 (same run):** prior = Balanced (stored `prior_guid` verified in the
      session file) → switched to High performance externally mid-session → Stop → landed on
      **Balanced** (the stored GUID, not the live value), session cleared.
- [x] **10. Advanced tier is opt-in + ONE UAC prompt total.** Confirm the core bundle (power plan +
      Game Mode + Game Bar) applies with **no UAC**; selecting any mix of USB-SS / PCIe-ASPM /
      service suspends fires **exactly ONE prompt** at start (T6) — and, since T6b (2026-07-08),
      **exactly ONE prompt at stop/restore** for the whole elevated tier too.
      ✅ **PASSED 2026-07-07:** owner-confirmed exactly ONE prompt at start with USB+PCIe selected
      (the case-#4 run); core-bundle-no-UAC proven by the T6 harness (`qa10` + the ≤1-dispatch pin)
      and every prior §1 start/stop. Restore side prompted once per elevated change (2 prompts for
      his 2 items) — matched the flagged T6 scope at the time; **T6b closed it 2026-07-08** (restore
      batches through the same audited sink→compose→receipts machinery; `qa10` now pins restore
      dispatches == 1, CI pins the decline/receipts/fallback arms). Owner live re-check rides the
      next real session's stop.

---

## Sign-off

When all boxes pass: **tell me "Gaming Mode QA signed off"** → I record it here + in `CLAUDE.md` and F1
is field-proven for 1.0. If any case fails, paste what happened — I fix on a branch (and re-hide the
feature via the gate if the bug is user-facing) and you re-test the affected case.

**Case #4 is the one milestone between F1 Gaming Mode and "1.0-confident."**

**Status 2026-07-14: ALL 10 cases PASSED.** #4/#10 owner-run 2026-07-07; #1/#2/#3/#5/#8/#9 CC-driven
live-app automation (CDP over the installed `2eda4eb` build, ground-truth registry/powercfg probe,
owner present) 2026-07-14; #6/#7 — the real-UAC cancel arms — owner-clicked (No·Yes·No·Yes) on the
`db5349e` build 2026-07-14, after that checklist run exposed and forced the runas-decline fix above.
**Remaining: nothing but the owner's words — "Gaming Mode QA signed off".**
