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

- [ ] **1. Normal start → stop.** Start Gaming Mode → confirm power plan switched to max-perf, Windows
      Game Mode on, Game Bar/DVR off (honesty line lists them). Stop → **confirm your exact prior power
      plan + Game Mode/Bar values are restored.** Session file cleared.
- [ ] **2. Consent gate (first use).** First enable shows the one-time modal (what changes + restore
      guarantee) and requires confirmation; subsequent starts are one-click.
- [ ] **3. App crash while Active.** Start Gaming Mode, then **kill `compy.exe`** (Task Manager) mid-
      session. Relaunch → the toggle should show **Gaming Mode "on"** (live session resumed); click Stop
      → prior state restored. *(An active session resumes rather than false-prompting.)*
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
- [ ] **5. Game exits / you stop normally.** Restore fires, prior state restored, session cleared.
- [ ] **6. UAC cancel during START (advanced tier).** Enable the USB-SS / PCIe-ASPM advanced toggles,
      start, and **cancel the single UAC prompt** (since T6, 2026-07-07, the whole advanced tier —
      USB + PCIe + any service suspends — rides ONE prompt). → no partial state left; whatever core
      items applied are rolled back **with no further prompts**; clear error; no session file
      lingering as `active` without a contract.
- [ ] **7. UAC cancel during RESTORE.** Trigger a restore that needs UAC (advanced tier applied) and
      **cancel it.** → status `RestoreFailed`, the contract is **retained**, a clear retry path is shown,
      and it **never reports success.** Retry → completes.
- [ ] **8. Missing power plan at restore.** Apply Gaming Mode, then delete the prior power plan
      (`powercfg /delete <guid>`) before stopping. Stop → **fails safe with a clear message** (never a
      silent fallback / wrong plan).
- [ ] **9. External power-plan change mid-session.** Switch power plans manually (Windows) while Gaming
      Mode is active. Stop → restore still targets the **stored** prior GUID; honest about state.
- [x] **10. Advanced tier is opt-in + ONE UAC prompt total.** Confirm the core bundle (power plan +
      Game Mode + Game Bar) applies with **no UAC**; selecting any mix of USB-SS / PCIe-ASPM /
      service suspends fires **exactly ONE prompt** at start (T6; stop/restore still prompts per
      elevated change — expected for now).
      ✅ **PASSED 2026-07-07:** owner-confirmed exactly ONE prompt at start with USB+PCIe selected
      (the case-#4 run); core-bundle-no-UAC proven by the T6 harness (`qa10` + the ≤1-dispatch pin)
      and every prior §1 start/stop. Restore side prompted once per elevated change (2 prompts for
      his 2 items) — matches the flagged T6 scope; batching it is T6b.

---

## Sign-off

When all boxes pass: **tell me "Gaming Mode QA signed off"** → I record it here + in `CLAUDE.md` and F1
is field-proven for 1.0. If any case fails, paste what happened — I fix on a branch (and re-hide the
feature via the gate if the bug is user-facing) and you re-test the affected case.

**Case #4 is the one milestone between F1 Gaming Mode and "1.0-confident."**
