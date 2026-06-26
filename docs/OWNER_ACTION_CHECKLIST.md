# Owner Action Checklist — things only you can do

> Pull this up anytime ("show my checklist"). These are deferred because they need **your hands**
> (a UAC approval, a reboot, eyes on a screen) or a **decision that's yours** (money / legal / taste).
> Nothing here blocks ongoing work — Claude keeps building and only raises one of these if it
> *truly* can't proceed past it. Each item is reversible unless noted.

---

## 1. Wave 0 — confirm the PowerShell flash is gone  ·  (built, shipped to your install)
The elevated console flash you flagged is fixed (elevated work now runs through a windowless
`compy.exe` helper). The plumbing is already verified (exit-code propagation + fail-safe, no UAC
needed). What's left is a 60-second eyeball:

1. **Tune → Gaming Mode → turn on the Advanced toggles** (USB auto-suspend, PCIe ASPM) → **Start**.
2. Approve the **UAC prompt** (it now says **"Compy"** — expected; "unknown publisher" until we sign).
3. 👀 **No black PowerShell window should flash.** (Before Wave 0 it did.)
4. Confirm it **applied** (Gaming Mode shows on), then **Stop** → confirm it **rolled back**.
5. *(optional)* Start again and **Cancel** the UAC → should say you didn't approve / nothing changed.

**Result → tell Claude:** "Wave 0 good" (no flash + applied/rolled back) — or describe any flash/issue.
*If it misbehaves it's a one-line revert; you're not stuck.*

---

## 2. Gaming Mode → "1.0-confident" — the reboot test  ·  (feature is live)
Full checklist: `docs/GAMING_MODE_QA.md`. The headline is **case #4**:

1. **Start Gaming Mode** → **reboot the PC** without stopping.
2. After reboot, open Compy → it should **detect the unfinished session + prompt to restore**.
3. Confirm → your **exact prior state is restored** + the banner clears.

**Result → tell Claude:** "Gaming Mode QA signed off" (run the other cases in that doc too if you like).
*This is the one thing the automated harness can't prove for you.*

---

## 2b. After the reinstall — eyeball the two newly-armed Phase-B features  ·  (ships in this rebuild)
Both passed live QA already (mutate→exact-restore proven, cancel = no-partial); this is just a "looks right
in the running app" glance after you reinstall:
1. **Tune → Gaming Mode → Advanced** → the new **service-selection** checkboxes (SysMain / DiagTrack /
   Windows Search). Pick one → Start → it suspends → Stop → it restores. *(Reversible; Trust Ledger logs it.)*
2. **Fix → "Reduce background telemetry"** → the **debloat task** rows (Disable buttons). Disable one → it
   shows done → undo from the **Trust Ledger** restores it. *(Reversible.)*

**Result → tell Claude:** "Phase B looks good" — or describe anything off.

---

## 3. Release gates — your calls (not reversible-by-Claude)
These gate **public** release (not the local app you use day to day):
- **Legal:** EULA license model + governing-law/jurisdiction (`docs/EULA.md`, `docs/PRIVACY.md` are drafts).
- **Code-signing route:** pick the signing path (Azure Trusted Signing is the noted $0-first option) →
  resolves the "unknown publisher" UAC banner for *all* elevations.

---

## 4. Taste / visual sign-offs (as they come up)
Claude proceeds on tasteful polish autonomously, but flags genuine forks here (default theme, exact
hexes, anything where your eye is the authority). *(None pending right now.)*

---

*Maintained by Claude — items get added as deferred owner-actions arise, and checked off when you
confirm. Ask "show my checklist" to see the current state.*
