# Compy — Private Beta Tester Guide

About 20 minutes. One install, one first screen, one change (or Gaming Mode),
one game, one undo. Honesty over a tour of every room.

This guide matches **published Compy 0.9.26**. If a room name here does not
appear in the app, you have an older build — see §2.

---

## 1. What Compy is

Compy reads *your* hardware and tells you what is worth changing on this PC.
Every change it applies can be undone. It will also tell you when a change did
nothing. That is not a bug.

It is not an FPS booster and it does not promise frames. If the PC is already
fine, its job is to say so and leave it alone.

---

## 2. Install (do this first if you still have 0.9.0 / 0.1.0)

Those old builds **cannot update themselves**. One install puts you on the
updater path for good.

**Download:** [github.com/Pootytxng/compy-releases/releases/latest](https://github.com/Pootytxng/compy-releases/releases/latest)

Grab `Compy_0.9.26_x64-setup.exe`. Installing over an older copy keeps your
history and settings.

Optional hash check:

```powershell
Get-FileHash .\Compy_0.9.26_x64-setup.exe -Algorithm SHA256
```

`v0.9.26` should return
`4B72D68120F2A2601D87B814ACCDB25C0E18B20AA79ADB63C9040BF9A9294E98`.

### The scary dialog (read before you click)

Windows SmartScreen will probably show a blue **"Windows protected your PC"**
box — *Unknown publisher.*

That is expected. This beta is unsigned. A code-signing certificate is a paid
step that has not happened yet. The warning is not Defender saying it found
malware.

**More info → Run anyway.**

Install is per-user. No admin prompt at install time. You may see UAC later,
only if you turn on FPS monitoring or apply a change that needs elevation.
Same unsigned-publisher reason there.

---

## 3. Anti-cheat

Compy never injects into games. FPS is captured from outside the game via
Windows event tracing. The overlay is a separate window — it draws over
borderless/windowed games, not exclusive fullscreen. Play ranked with it
running; that is the design. We still do not promise a given anti-cheat will
never complain about an overlay or ETW.

---

## 4. The 20-minute path

Go in blind. Note where it loses you. Do **not** hunt old room names
(Check / Play / Fix / Learn / Lab). The rail is:

**Health · Live · History · Test**

Stay on Health until the first verdict makes sense.

### Minutes 0–7 — Health (the front door)

1. Launch Compy from the Start menu.
2. Stay on **Health**. It should name your actual CPU and GPU.
3. Read the verdict in one sentence: fine / one thing to do / unsure.
4. If the first screen is a catalog of rooms instead of a verdict, stop and
   screenshot. That is the bug.

### Minutes 7–12 — one change, not a stack

Pick **one**:

- **Gaming Mode** (preferred if offered): session-scoped — applies while you
  play, restores when you stop. Note the UAC text. Play anything for about
  five minutes. Quit. Confirm Discord / overlays / startup stuff feel normal
  again.
- **The #1 recommended fix**, only if the copy says it can be undone. Apply
  that one. Do not apply a stack. Skip Test's experiment bench unless you are
  an enthusiast who already knows what it is.

If you cancel UAC, **nothing should have changed**. If something changed
anyway, stop and tell us — that is a P0.

### Minutes 12–18 — play, then Live

Normal game, **borderless or windowed** (overlay will not sit on exclusive
fullscreen).

- Overlay should be a tiny HUD, not a second control panel.
- After you quit, open **Live**. There should be a debrief in plain English.
- "No measurable change" is a pass, not a fail.

### Minutes 18–20 — undo + export

- Roll the one change back from **History** (or confirm Gaming Mode already
  restored).
- Export (header). It writes Markdown + JSON locally. Read it before sending —
  it contains hardware names.

Settings → Appearance has multiple themes. Tell us which one you kept.

---

## 5. Privacy

No account. Nothing about your system leaves the PC unless you choose to send
it. Export reports are local files.

Compy makes **one** automatic network call: it asks GitHub whether a newer
signed-update package exists
(`https://github.com/Pootytxng/compy-releases/releases/latest/download/latest.json`).
That check sends no hardware inventory. GitHub still sees ordinary connection
metadata (your IP) under GitHub's terms. You can switch the check off in
**Settings → About**. Nothing downloads until you click Update now.

"Signed" here means Compy's own update signature, not a Windows Authenticode
publisher name. SmartScreen will still warn until the installer is
code-signed.

---

## 6. What we want back

Five lines is enough. Send it in the same chat that gave you this kit.

```
Hardware shown: correct / wrong / missing
Front door: clear / confusing
What I did: Gaming Mode / one apply / neither
Undo: worked / failed / didn't try
One sentence to a friend:
Scared me / lost me at:
```

On NVIDIA? Extra useful — NVIDIA monitoring is implemented but not yet
verified on real hardware (AMD is). Tell us everything that looks wrong.

Optional longer template is at the bottom if you want it.

---

## 7. Known limits (honesty)

- **No CPU temperature** — that needs a kernel driver. This build ships none.
  GPU temperature works.
- **1% low is a live estimate**, not benchmark-grade.
- **Comparison verdicts need two sessions of the same game.**
- **Overlay:** borderless/windowed only.
- **NVIDIA:** implemented, not hardware-verified.
- **Gaming Mode is in this build** and is the preferred 20-minute path.
- **Test** (benchmark / experiments) is optional. Skip it unless you want it.

---

## 8. Uninstall

Windows Settings → Apps → **Compy** → Uninstall.

Your Trust Ledger and history stay in `%APPDATA%\Compy` **by design** so
rollback records survive a reinstall. Delete that folder yourself if you want
everything gone. Roll back applied changes *inside* Compy before uninstalling
if you want the machine returned to how it was.

---

## 9. Optional longer feedback

```
Compy beta feedback

Tester:
Windows version:
CPU / GPU / Monitor:
Install worked: yes/no
SmartScreen appeared: yes/no — was §2 enough warning: yes/no
Onboarding: clear / confusing at step ___
Health verdict made sense: yes/no
Hardware detected correctly: yes/no
Played a session — Live debrief appeared: yes/no
Debrief felt accurate: yes/no
Tried apply + compare: yes/no — verdict: improved / no change / regressed / n.a.
Rollback restored things exactly: yes/no/not tested
Gaming Mode restored after quit: yes/no/not tested
FPS helper + UAC behaved: yes/no
Export worked: yes/no
Bug + steps:
Screenshot/export attached: yes/no

Describe Compy to a friend in ONE sentence:
Did it feel trustworthy: yes/no — why:
Which theme you kept (Settings → Appearance):
Did "no measurable change" feel honest or annoying:
What would make this the only PC-readiness tool you need:
```
