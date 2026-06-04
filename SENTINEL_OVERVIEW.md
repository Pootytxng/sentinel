# Sentinel — Project Overview

*A shareable snapshot of where the project is and where it's going. Written to get an outside set of eyes on the whole thing — what's good, what's missing, what's a bad idea. Be blunt.*

---

## TL;DR (30 seconds)

**Sentinel is a safety-first PC optimization dashboard for everyday gamers who aren't techies.** It reads your *actual* hardware and tells you, in plain English, what's worth changing for *your* rig — then makes only changes it can undo with one click, and keeps a full history of everything it touched.

The pitch in one line: **"A rollback-first Windows configuration safety layer that happens to optimize"** — not an "FPS booster," not a registry tweak pack, not snake oil.

It's a real, working Windows app (built on Tauri — a Rust core with a web UI). It's at **private-beta quality today** and runs locally with **no account, no telemetry, nothing leaving your PC.**

---

## 1. What Sentinel is

Most "PC optimizer" tools fall into a few buckets, and they're all kind of bad for a normal gamer:

- **Power-user tools** (NTLite, Process Lasso, WinUtil) — assume you already know what you're doing.
- **Vendor apps** (NVIDIA App, AMD Adrenalin, MSI Center) — only touch their own settings, won't tell you to turn their own telemetry off.
- **"Booster" / tweak-pack apps** (and the endless YouTube/Reddit "best tweaks" guides) — one-size-fits-all, often reckless, rarely reversible, no record of what they changed. People break their PCs and don't know how to undo it.

**Sentinel aims at the gap nobody owns:** *hardware-aware, safe-by-default, plain-English, rollback-first, and built for the non-technical gamer.* The wedge is **trust, not "boost."**

The mental model we keep coming back to: **a scientific instrument with an undo button — not a magic potion.** It measures, it changes one thing, it re-measures, and it's honest enough to tell you when a change did *nothing*.

---

## 2. Who it's for

- **Primary:** "Casual Competitive Caleb" — mid-20s, plays Valorant / Apex / Marvel Rivals, has a decent gaming PC, knows enough to install a game but not to safely edit the registry. Has tried a couple of YouTube "fixes" and either broke something or got nothing. Would pay a one-time ~$20-40 for a tool that makes his PC noticeably better and **doesn't scare him.**
- **Secondary:** "Single-player Sarah" — plays story AAA (Baldur's Gate, Cyberpunk, Elden Ring), wants the prettiest experience without stutter, wants someone to just tell her the right settings for her rig.

**Explicitly NOT for:** IT admins, power users, or anyone wanting a "tune everything in one click" button. It's also not an antivirus and not cross-platform — Windows only.

---

## 3. The core idea — why it's different

This is the part that actually matters, so here it is plainly. Sentinel holds a few hard lines that the rest of the category doesn't:

1. **Everything is reversible.** Before any change, it snapshots the prior state. One-click rollback on anything, anytime. The rollback history survives app updates and even if a recommendation is later removed — your undo never depends on the change still being in the catalog. **It will never apply something it can't undo.**

2. **A visible "Trust Ledger."** A human-readable log of every change applied and every rollback performed. You can always see exactly what it did to your machine.

3. **Hardware-aware, per-rig.** Recommendations only fire when *your* actual hardware benefits. No "universally applicable" tweaks. (Example: it refuses certain CPU tweaks on chips where they'd hurt.)

4. **A deliberately *small* catalog (~29 safe recommendations) — and it's frozen.** The whole category competes on tweak *count* and ships registry mega-packs. Sentinel competes on what it *refuses* to include. There's a hard blocklist of the popular-but-sketchy stuff: HPET/timer hacks, Defender disable, MMCSS edits, forced core parking, TCP "mega-packs," fixed pagefile, etc. **"Sentinel is not a registry clown car."**

5. **No fake performance claims.** It strictly separates "we actually changed this setting" (Verified) from "we ran a probe and measured this" (Measured) from "here's the theory" (Expected impact). No invented "+20% FPS," no fake "optimized score."

6. **Local-first, private by design.** No account, no telemetry, your hardware data never leaves the device unless *you* choose to share it.

7. **No risky internals.** No kernel driver, no game injection (so it's anti-cheat-safe). Performance data comes from safe Windows event tracing and official GPU vendor SDKs.

The honesty boundary is the whole brand: the feeling of "my PC is dialed in" has to come from **clarity, proof, monitoring, and safe recs — never from lying to you.** The emotional target is *"If Sentinel says I'm good, I don't need to chase sketchy Reddit/YouTube tweak packs."*

---

## 4. What's built and working today

This is a real app, not a mockup. Here's what's live right now:

**Foundation**
- **Hardware detection** — CPU, GPU + VRAM + driver age, RAM, storage + free space, monitors + refresh rate, Windows build.
- **~29 safe, reversible recommendations** with per-change approval, plain-English "here's the downside too" descriptions, full snapshot + rollback, and the Trust Ledger.
- **Live monitoring + on-screen overlay** — FPS, frametime, **1%-low**, GPU temp/usage/clocks/fan/power, CPU/RAM. (FPS is captured safely, no game injection.)

**The "command center" surfaces (all read-only / advisory — they don't change anything)**
- **Readiness** — a plain-English "are you ready to play?" check: monitor at max refresh? game on a fast drive? VRR on? power profile? driver age? etc.
- **Sessions** — a post-game performance debrief: avg FPS/frametime, 1%-low estimate, peak temps, what was active. Makes Sentinel useful *every day*, not just at setup.
- **Priorities** — a personal-technician ranking: "your biggest likely limiter is X," what's already fine, and what's not worth touching.
- **Export** — a clean shareable report (Markdown/JSON) of your system, changes, and readiness — for Discord/Reddit/support or before-after comparisons. Stays local; never auto-uploads.
- **Latency diagnostics** — read-only surfacing of the stuff that actually causes input lag (interrupt/timer/USB-topology/mouse polling signals).
- **Benchmark** — a *measured-efficacy* loop: run a baseline, make a change, re-measure, and get an honest verdict — **Improved / No measurable change / Regressed** (with a noise floor so it won't claim a win that's really just noise). This is the "say so when a tweak does nothing" feature.
- **An honest, premium UI** — a transparent system-status read-out (not a fake score or a gamified "tune meter"). Designed to feel like a serious performance cockpit, not RGB clownware.

**Built but intentionally turned OFF for now**
- **Gaming Mode** — the one feature that *changes* settings automatically (switches to a gaming power profile on game launch, restores on exit, crash-safe so nothing is ever left changed with no way back). It's fully built, but it's **disabled until it passes its own dedicated safety QA** — we don't ship something that mutates other people's machines until it's bulletproof.

**Status:** functionally ready for a **private, invite-only beta** (unsigned installer, direct download, fully local). A public release is intentionally **not** out yet — see the open questions below.

---

## 5. What's planned / in progress

Growth is deliberately **upward** (more understanding, proof, and confidence) — **not sideways** into more tweak switches. The catalog stays frozen on purpose.

- **Turn on Gaming Mode** once its crash-safe restore QA is signed off.
- **Deepen the Latency module** — the ambitious goal: actually *name the guilty driver / device* causing your input lag, instead of vague advice. This is seen as a potential signature feature.
- **Deepen the Benchmark engine** — grow the "measure → change → re-measure → keep or revert" loop into the core proof layer, so impact claims graduate from "expected" to "actually measured on your machine."
- **"Undo a bad optimization" / paramedic mode** — help people who already wrecked their config with a YouTube tweak pack get back to sane.
- **NVIDIA parity** — AMD is hardware-verified today; NVIDIA is implemented but not yet verified on real hardware. (We never silently claim NVIDIA confidence we haven't earned.)
- **An "Advanced" research layer** — deep, honest research on which deep tweaks are real vs. placebo vs. risky. Advisory only, never auto-applied. (Honest finding so far: most "deep tweaks" are placebo or risky; the real low-risk wins are XMP/EXPO memory, ReBAR/SAM, fan curves, and the latency/sync stack.)
- **Opt-in, anonymized "what actually worked" sharing** — a long-term flywheel where, *only if you opt in*, anonymized results of which changes measurably helped which hardware feed back into better recommendations. Local-first; off by default.
- **Public-release prerequisites:** code-signing (so Windows SmartScreen doesn't scare buyers), and legal (privacy policy + EULA + license model).

---

## 6. The big open questions (where I especially want your take)

These are genuinely undecided. Outside opinions are most valuable here:

- **Monetization.** Leaning toward **free core + a one-time "Pro" unlock** (never paywall *safety* — rollback and the core recs stay free; charge for depth like the advanced research, multi-rig profiles, benchmark proofs). Subscription feels off-brand for a local, no-account tool. Is a one-time unlock the right call? What would *you* pay for here, if anything?
- **Distribution.** Direct download (best margin, but SmartScreen friction), Microsoft Store (free discovery + auto-update, takes a cut), or Steam (the audience literally lives there). Where would you actually expect to find/trust a tool like this?
- **The pitch itself.** Does "rollback-first safety layer that happens to optimize" *land*, or does it undersell? Is "trust, not boost" compelling, or does a gamer just want to be told "this makes your game faster"?
- **Is the small-catalog discipline a feature or a bug?** We deliberately *won't* add the popular sketchy tweaks. Does "we left those out on purpose" read as trustworthy, or as "this does less than the free YouTube guide"?
- **Does the honesty hurt the sell?** When a change does nothing, Sentinel *says so*. That's the whole soul of it — but is "this tweak did nothing" a feature people want, or a buzzkill?

---

## 7. What I'd love feedback on

1. **Gut reaction** — reading this, would you install it? Would you trust it on your own gaming PC? Why or why not?
2. **The differentiator** — is "safe + reversible + hardware-aware + honest" actually compelling, or does it sound boring next to "BOOST YOUR FPS"?
3. **Missing features** — is there an obvious thing a gamer would expect that isn't here? (Keeping in mind we deliberately avoid risky tweaks.)
4. **Bad ideas** — anything here that's overthought, won't matter to real users, or is a trap?
5. **Money** — would you pay for it? One-time vs. free? What's the most you'd pay, and for which part?
6. **The name + positioning** — does "Sentinel" fit? Does the framing make sense to a normal gamer in 10 seconds?

---

*Thanks for taking a look — no wrong answers, and "this part is dumb" is genuinely useful.*
