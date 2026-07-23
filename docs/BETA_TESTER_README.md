# Compy — Private Beta Tester Guide

Thanks for helping test Compy. This guide gets you installed, walks you through the one scary
dialog, and tells you exactly what we want from you (about 20 minutes of honesty).

---

## 1. What Compy is

**Compy finds what's actually slowing your gaming PC down — and fixes the fixable, with an undo
button on everything.** It reads your real hardware (not a generic checklist), tells you in plain
English what's worth changing for *your* rig, what's already fine, and — this is the part we're
proudest of — **it tells you honestly when a change did nothing.** No fake "+20% FPS," no invented
score, no drama.

It is **not** an FPS booster and it doesn't promise frames. If your PC is already in good shape,
Compy's job is to say so and leave it alone.

---

## 2. The scary dialog (read this BEFORE installing)

When you run the installer, **Windows SmartScreen will probably show a blue warning**:

> **"Windows protected your PC"** — Microsoft Defender SmartScreen prevented an unrecognized app
> from starting. *Unknown publisher.*

**This is expected, and you deserve to know exactly why:** Windows shows it for any app that isn't
code-signed, and code-signing certificates cost money — this beta is free, unsigned, and hasn't
earned its keep yet. Signing happens before any public release.

What the warning does NOT mean: it's not a virus flag, and it doesn't change what the app can do.
For the record, here's what Compy deliberately never does: no kernel driver, no game injection, no
account, no telemetry, and no upload of your hardware or session data. Its only automatic network
feature checks for cryptographically signed updates. Nothing downloads until you approve it.

**To proceed:** click **More info** → **Run anyway.**

---

## 3. Install

Installer: use the **`Compy_<version>_x64-setup.exe`** link sent to you. Do not reuse an older saved
installer or share the private-beta link publicly.

1. Run the installer (installs per-user; no admin needed).
2. SmartScreen → **More info** → **Run anyway** (see section 2).
3. Launch **Compy** from the Start Menu. If it offers a newer signed beta, review the notes and choose
   **Update now** or **Later**; it never downloads silently.

You may see a **UAC prompt later** — only if you turn on FPS monitoring or apply certain
recommendations. That's the elevated helper doing its job; "unknown publisher" there is the same
unsigned-beta reason.

---

## 4. Anti-cheat: the answer to the question you're already asking

Compy **never injects into games**. FPS is captured from *outside* the game via Windows' own event
tracing (the same mechanism Microsoft's tools use), and the overlay is a separate window — it
draws over borderless/windowed games only, never exclusive fullscreen. There is nothing for
Vanguard, EAC, or BattlEye to object to, because Compy never touches the game process. Play
ranked with it running; that's the design.

---

## 5. The guided tour (the main thing to test)

Compy now opens with a guided first-experience. **Please go in blind and note where it loses you
— first impressions are the data we can't get twice:**

1. **Onboarding** (3 quick steps — it should read your actual rig on the first screen).
2. **First check** — a fast scan with a verdict: what's worth fixing, what's already fine.
3. **Apply the #1 fix** if you're comfortable (one click — and note the Trust Ledger entry;
   everything Compy changes is undoable).
4. **Play something** — your normal game, with FPS monitoring on from **Monitor** (accept the UAC
   prompt).
5. **Open Monitor afterward** — your session is in the list, and clicking it unfolds a plain-English
   debrief right there.
6. If you applied the fix in step 3 and chose "compare next session": **play the same game again**
   and the next debrief will show an honest verdict — improved, no measurable change, or
   regressed. **"No measurable change" is not a bug.** It's the product refusing to lie to you.
7. **Roll something back** from the Trust Ledger and confirm your setting came back
   exactly.

The map, if you ever feel lost: **Home** is your rig and next action; **Monitor** records play;
**Blackbook** keeps your changes, sessions, and graded advice; **Lab** applies and proves changes.
Settings is the gear.

---

## 6. Privacy

No telemetry and no account. Compy does not upload your hardware, sessions, settings, or Trust
Ledger. Its one automatic connection is the signed updater check; downloads require your click.
Export reports remain local files until you choose to send one. Review an export before sharing it
because it contains hardware names and app state.

---

## 7. What we want back from you (the actual ask)

1. **An Export report** after you've played a session or two (Export button → it writes Markdown +
   JSON locally → send us both if you're comfortable).
2. **One sentence:** *how would you describe Compy to a friend?* Don't overthink it — your first
   phrasing is the valuable one.
3. **Anything that confused you, scared you, or broke.** Screenshot + what you clicked + what you
   expected. The template below covers it.
4. **On NVIDIA?** You're extra valuable — our NVIDIA monitoring is implemented but not yet
   verified on real hardware (AMD is). Tell us everything that looks wrong.

Send everything back **in the same chat where you got this kit** — screenshots, exports, and
complaints all welcome.

---

## 8. Known limitations (honesty section)

- **CPU temperature may be unavailable.** Compy ships no driver. It can display a read-only CPU
  temperature only when HWiNFO, LibreHardwareMonitor, or OpenHardwareMonitor already publishes one;
  otherwise it honestly shows unknown. GPU temperature uses the vendor SDK where supported.
- **1% low is a live estimate**, not benchmark-grade.
- **Comparison verdicts need two sessions of the same game** — different games don't compare.
- **Overlay**: borderless/windowed only, not exclusive fullscreen.
- **NVIDIA**: implemented, not yet hardware-verified (see section 7).
- **Gaming Mode is live but opt-in.** It records and restores the exact prior state; report any
  failed restore immediately.

---

## 9. Uninstall

Windows Settings → Apps → **Compy** → Uninstall. Your Trust Ledger and history are kept in
`%APPDATA%\Compy` **by design** (so rollback records survive a reinstall — nothing silently lost).
Delete that folder manually if you want everything gone.

---

## 10. Feedback template

```
Compy beta feedback

Tester: 
Windows version:
CPU / GPU / Monitor:
Install worked: yes/no
SmartScreen appeared: yes/no — was section 2 enough warning: yes/no
Onboarding: clear / confusing at step ___
First check verdict made sense: yes/no
Hardware detected correctly: yes/no
Played a session — debrief appeared: yes/no
Debrief verdict felt accurate to how it played: yes/no
Tried apply + compare: yes/no — verdict received: improved / no change / regressed / n.a.
Rollback restored things exactly: yes/no/not tested
FPS helper + UAC behaved: yes/no
Export worked: yes/no
Bug/issue + steps:
Screenshot/export attached: yes/no

--- The part we care about most ---
Describe Compy to a friend in ONE sentence:
Did it feel trustworthy: yes/no — why:
Premium or plain: premium/plain
Did it reduce the urge to look up random tweak guides: yes/no
"No measurable change" verdict — honest or annoying: honest/annoying/didn't see it
Did you find the Library (the Learn tab)? yes/no — what did you search for:
Which theme did you keep (Settings → Appearance): Midnight / Violet / Crimson / Emerald / Hearth:
What would make this the only PC-readiness tool you need:
Other notes:
```

Thanks again — your feedback directly shapes what ships.
