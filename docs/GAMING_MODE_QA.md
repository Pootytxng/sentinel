# Gaming Mode (F1) — Owner QA Checklist

**Purpose:** the hands-on, owner-run gate test for F1 Gaming Mode. Gaming Mode is **built + merged to
`main` but DARK** behind `gaming_mode_gate()` (returns `false` → tab hidden, commands refuse). It **does
not ship** until this checklist passes on a real UAC-on machine **and you sign off** → only then is the
gate flipped to `true`. Source design: `docs/superpowers/specs/2026-06-02-gaming-mode-f1-design.md` §7 ·
broad contract `docs/GAMING_MODE_PLAN.md` §8. **Why you, not Claude:** these cases require crashing the
app, rebooting mid-session, and cancelling UAC prompts on your hardware — I can't do that for you.

---

## How to run it (test build with the gate temporarily ON)

Two options:
- **A. I build it for you (recommended):** say the word and I'll temporarily set `gaming_mode_gate()` →
  `true` on a throwaway branch, produce a build, and hand you the exe to test. The gate stays `false`
  on `main` until you sign off; I never flip the shipping gate myself.
- **B. You build locally:** in `src-tauri/src/lib.rs`, change `fn gaming_mode_gate() -> bool { false }`
  to `true`, run `npm run tauri dev` (or `npm run tauri build -- --no-bundle`), test, then **revert the
  edit** (don't commit it). A "Gaming" tab appears when the gate is on.

**Before each test:** create a Windows **Restore Point** (belt-and-suspenders). Have a game ready (or
just exercise start/stop without a game — the power-plan/registry changes apply regardless).

---

## The checklist — restore must always reach the exact prior state, or fail loudly

- [ ] **1. Normal start → stop.** Start Gaming Mode → confirm power plan switched to max-perf, Windows
      Game Mode on, Game Bar/DVR off (honesty line lists them). Stop → **confirm your exact prior power
      plan + Game Mode/Bar values are restored.** Session file cleared.
- [ ] **2. Consent gate (first use).** First enable shows the one-time modal (what changes + restore
      guarantee) and requires confirmation; subsequent starts are one-click.
- [ ] **3. App crash while Active.** Start Gaming Mode, then **kill `compy.exe`** (Task Manager) mid-
      session. Relaunch → the toggle should show **Gaming Mode "on"** (live session resumed); click Stop
      → prior state restored. *(Per the /check fix, an active session resumes rather than false-prompting.)*
- [ ] **4. Full reboot while Active.** Start Gaming Mode → **reboot the PC** without stopping. After
      reboot, launch Compy → it detects the unfinished session (`gaming-session.json`) and **prompts
      to restore**; confirm → exact prior state restored.
- [ ] **5. Game exits / you stop normally.** Restore fires, prior state restored, session cleared.
- [ ] **6. UAC cancel during START (advanced tier).** Enable the USB-SS / PCIe-ASPM advanced toggles
      (these prompt UAC), start, and **cancel the UAC prompt.** → no partial state left; whatever core
      items applied are rolled back; clear error; no session file lingering as `active` without a contract.
- [ ] **7. UAC cancel during RESTORE.** Trigger a restore that needs UAC (advanced tier applied) and
      **cancel it.** → status `RestoreFailed`, the contract is **retained**, a clear retry path is shown,
      and it **never reports success.** Retry → completes.
- [ ] **8. Missing power plan at restore.** Apply Gaming Mode, then delete the prior power plan
      (`powercfg /delete <guid>`) before stopping. Stop → **fails safe with a clear message** (never a
      silent fallback / wrong plan).
- [ ] **9. External power-plan change mid-session.** Switch power plans manually (Windows) while Gaming
      Mode is active. Stop → restore still targets the **stored** prior GUID; honest about state.
- [ ] **10. Advanced tier is opt-in + UAC-only.** Confirm the core bundle (power plan + Game Mode +
      Game Bar) applies with **no UAC**; only USB-SS / PCIe-ASPM prompt.
- [ ] **11. Gate-off sanity.** With `gaming_mode_gate()` = `false` (shipping default), the "Gaming" tab
      does **not** appear and the commands refuse — existing app behavior unchanged.

---

## Sign-off

When all boxes pass: **tell me "Gaming Mode QA signed off"** → I flip `gaming_mode_gate()` → `true`,
verify build, and it ships in the next build. If any case fails, paste what happened and I fix on a
branch + you re-test the affected case.

**This is the only thing between F1 Gaming Mode and live.**
