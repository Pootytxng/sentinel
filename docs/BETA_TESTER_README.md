# Sentinel — Private Beta Tester Guide

Thanks for helping test Sentinel. This is a short guide to install it, try it, and report what you find.

---

## 1. What Sentinel is

Sentinel is a **rollback-first Windows configuration safety layer for PC gamers**. It looks at your
machine and helps you understand and safely tune it:

- **Hardware** detection (CPU, GPU, RAM, storage, display, Windows version)
- **Readiness** — advisory checks on whether your setup is gaming-ready
- **Monitoring** — live GPU sensors and FPS/frametime capture
- **Sessions** — summaries after you've played
- **Export** — a local report you can save or share
- **Priorities** — what's worth your attention first
- A small set of **safe, fully reversible recommendations**

**Sentinel is not a magic FPS booster or a tweak-pack.** It doesn't promise more frames. Every change
it can make is audited and undoable — the point is *safety and clarity*, not risky tweaks.

---

## 2. Important beta warning

- This is a **private beta**. Please **do not share the installer publicly.**
- The app is **unsigned**, so **Windows SmartScreen may warn you** ("Windows protected your PC —
  unknown publisher").
- **That warning is expected** for this beta — it just means the app isn't code-signed yet.
- A **public release will require code signing and legal finalization later**; that is not done yet.

---

## 3. Install steps

Installer (NSIS): **`Sentinel_0.1.0_x64-setup.exe`**

1. Download or copy the installer to your PC.
2. Run it.
3. **If SmartScreen appears:**
   - click **More info**
   - click **Run anyway**
4. Launch **Sentinel** from the Start Menu or the installed shortcut.

It installs per-user (no admin needed to install). It may briefly ask for a UAC prompt **only** later if
you choose to use FPS monitoring or apply a recommendation — see below.

---

## 4. Privacy / safety promise

- **No telemetry** — Sentinel does not phone home.
- **No account** — nothing to sign up for or log into.
- **No remote rules** — recommendations are built into the app; nothing is fetched from a server.
- **No updater** — the app does not auto-update.
- **No kernel driver.**
- **No game injection.**
- **No CPU temperature reading** — by design.
- **Export reports are local files only.** You decide whether to share them.

---

## 5. What to test

Please try these and note anything odd:

- **First-launch onboarding** — does it appear and make sense?
- **Hardware detection** — are your CPU / GPU / RAM / storage / display shown correctly?
- **Readiness tab** — do the checks look reasonable for your setup?
- **Monitoring tab** — do GPU sensors show up?
- **FPS monitoring** — *only if you're comfortable accepting a UAC prompt.* Turn it on, play or run
  something that draws frames, then turn it off.
- **Sessions tab** — after a game or an active window has presented frames, do you get a session summary?
- **Export report** — does it create files and open the folder?
- **Priorities tab** — does the ordering make sense?
- **Apply / rollback** — *only if you're comfortable,* and preferably **just one safe recommendation**,
  then roll it back.

---

## 6. What not to test yet

- **Gaming Mode is not included** in this build.
- **Remote rules are disabled.**
- **The updater is disabled.**
- **Public-release signing is not done.**
- **Do not expect CPU temperature** — Sentinel doesn't read it by design.

---

## 7. How to report bugs

When something looks wrong, please send:

- A **screenshot** of the issue.
- **What you clicked.**
- **What you expected** to happen.
- **What actually happened.**
- Whether a **UAC prompt appeared**.
- Whether a **second window appeared** (especially during FPS monitoring).
- The **Export report** (Markdown **and** JSON) if you're comfortable sharing it.
- Your **Windows version** and **GPU/CPU**, if they aren't already in the export.

The feedback template in section 10 covers most of this — copy/paste and fill it in.

---

## 8. Known limitations

- The **unsigned SmartScreen warning is expected** (see section 2).
- **NVIDIA monitoring is implemented but still needs validation on real NVIDIA hardware** — results on
  NVIDIA GPUs may be incomplete for now. (AMD is verified.)
- The **1% low** figure is a **live-session estimate, not benchmark-grade**.
- The **overlay works for borderless / windowed games, not exclusive fullscreen.**
- **Public release still needs code signing and legal finalization.**
- **Export / report data may include hardware names and local app state** — please **review a report
  before sharing it.**

---

## 9. Uninstall steps

1. **Windows Settings → Apps → Sentinel → Uninstall.**
2. Your **AppData / Trust Ledger may remain by design** — Sentinel keeps your history and rollback
   records so they survive an uninstall/reinstall (nothing is silently lost).
3. **Optional manual cleanup** — if you want to remove that leftover data, delete:

   ```
   %APPDATA%\Sentinel
   ```

---

## 10. Feedback template

Copy this, fill it in, and send it back. **Beyond bugs, we especially want the "Experience & feel"
answers** — whether Sentinel feels premium, trustworthy, and like a real command center vs. just a
settings page:

```
Sentinel beta feedback

Tester name:
Windows version:
CPU:
GPU:
Monitor:
Install worked: yes/no
SmartScreen appeared: yes/no
Onboarding appeared: yes/no
Hardware detected correctly: yes/no
Readiness tab worked: yes/no
Monitoring worked: yes/no
FPS helper worked: yes/no/not tested
Second window appeared during FPS monitoring: yes/no
Export report worked: yes/no
Priorities tab made sense: yes/no
Applied a recommendation: yes/no
Rollback worked: yes/no/not tested
Bug/issue:
Steps to reproduce:
Screenshot/export attached: yes/no

--- Experience & feel (we especially want this) ---
Does Sentinel feel useful enough: yes/no
Premium or plain: premium/plain
Does it feel trustworthy: yes/no
Real command center, or just a settings app: command center/settings app
Anything feel too light, empty, or unfinished:
Did it make your system feel more under control: yes/no
Did it reduce the urge to look up random tweak guides: yes/no
What would make it the ONLY place you need for PC gaming readiness:
Other notes:
```

Thanks again — your feedback directly shapes what ships.
