# Compy — Project Overview

*A shareable snapshot of where the project is and where it's going. Written for outside eyes:
what's good, what's missing, what's a bad idea. Be blunt — "this part is dumb" is useful data.*

---

## TL;DR (30 seconds)

**Compy finds what's actually slowing your gaming PC down — fixes the fixable, proves whether it
worked, and undoes anything, anytime.** It reads your real hardware and speaks plain English:
what's worth changing on *your* rig, what's already fine, and — the soul of the product — **when a
tweak did nothing, it says so.**

It's a real, working Windows app (Tauri: Rust core, web UI), at private-beta quality, fully local:
no account, no telemetry, nothing leaves your PC. The wedge isn't "boost" — it's being the only
tool in a snake-oil category that **measures instead of promises.**

---

## The loop (what using it feels like)

1. **It reads your machine** — the first onboarding screen names your actual GPU, CPU, and RAM.
2. **First check** — a fast, honest scan ending in a verdict: "Ready to play — 2 things worth
   fixing." The rest: "already perfect — nothing to sell you here." A clean rig is a *win state*,
   not a missed upsell.
3. **You apply a fix** (one click) — it lands in the **Trust Ledger** with its before-state.
   Undoable today, undoable in six months, even if the recommendation is later removed from the
   catalog.
4. **You play.** Afterward, a **session debrief**: a plain-English verdict, real numbers (1% lows
   labeled as the estimates they are), and at most one insight — "your GPU loafed during the dips;
   prime suspect: the power plan."
5. **The verdict.** Next same-game session, Compy compares against a noise floor and answers
   honestly: **Improved / No measurable change / Regressed.** It never claims a win inside the
   noise — a null result is the instrument working, and the UI says exactly that. There's a
   running tally: honest answers vs fake wins sold. The second number stays zero forever.

Detect → diagnose → debrief → prove. That loop is built and running today — it's code, not pitch.

---

## Why it's different (the hard lines)

- **Honesty laws, enforced in code.** Impact claims are tiered — *Verified / Measured / Expected*
  — and never silently upgraded. Credit requires an armed, measured comparison that clears the
  noise floor. "No measurable change" ships as a first-class verdict card, styled as information,
  not failure.
- **Everything reversible.** Snapshot before every change; rollback resolves from local history
  alone, so your undo never depends on the app's current opinion. It will never apply something it
  can't put back.
- **The autopsy, not the buffet.** The catalog is ~29 recommendations *because the popular tweaks
  were audited and most were refused*: HPET/timer hacks, Defender disable, core parking, TCP
  mega-packs, fixed pagefile — permanently blocklisted. The category competes on tweak count;
  Compy competes on what it leaves out, on purpose, with receipts.
- **No risky internals.** No kernel driver (which is why there's no CPU temperature — reading it
  needs one, and we won't ship one). No game injection — FPS is captured externally via Windows'
  own event tracing, so it's anti-cheat safe by design. GPU sensors via official vendor SDKs.
- **Local-first.** No account, no telemetry, no remote config, no updater. The Export report is
  the only thing that ever leaves the machine, and only by the user's hand.

## Honesty about the project itself

The codebase is **days old, built at AI-assisted velocity** (~20k lines, 24 Rust modules, 240+
tests, exactly one TODO). We treat that fact the way Compy treats your PC: small blast radius,
everything reversible, verification never skipped — and the one feature with a real mutation
surface (Gaming Mode) is **built but dark** until it passes its own crash-safety QA. The private
beta exists to *earn* the trust the design claims: twenty real users, real ledgers, real
rollbacks, before a single public promise.

**Hardware truth:** AMD is hardware-verified (developed on an RX 9070 XT rig). NVIDIA is
implemented but **not yet verified on real hardware** — and the app says so instead of guessing.

---

## Who it's for

**"Casual Competitive Caleb"** — mid-20s, Valorant/Apex/Rivals, decent rig, knows how to install a
game but not how to safely edit a registry. Has tried YouTube "fixes" and either broke something
or felt nothing. The emotional target: *"If Compy says I'm good, I don't need to chase sketchy
tweak packs."*

Not for: sysadmins, power users, or one-click-tune-everything seekers. Windows only. The future
angle for story-gamers is **system-level per-game profiles** ("Valorant launched → latency profile
on, restored on exit") — the layer vendor apps won't touch, because no vendor app will ever tell
you to turn off its own telemetry.

---

## Status & what gates what

- **Private beta: functionally complete.** The full loop above, plus readiness checks, priority
  ranking, latency diagnostics, live monitoring + overlay, and local export. Remaining before
  invites: a small hardening queue (session-end toast, comparison guards), a fresh installer +
  smoke test under the new name, and recruiting ~20 testers. Distribution: unsigned, invite-only,
  direct download, fully local.
- **Money: deliberately zero spend** until the beta proves the product can pay for itself —
  domains, code signing, legal are all deferred by owner decision. Signing and legal gate the
  *public* release, not the beta.
- **Still dark on purpose:** Gaming Mode (until its own QA), remote rules (triple-gated off), the
  updater (off), catalog expansion (frozen).
- **Monetization (undecided, leaning):** free diagnosis, one-time paid depth. Safety is never
  paywalled — rollback and the core recommendations stay free. Final shape gets decided by what
  testers actually say, not before.

## Open questions (where outside opinions help most)

1. **The win-drought problem.** An honest tool on a healthy rig accumulates "honest answers: 9 ·
   wins: 0." Is absolution — "you're good, stop tweaking" — enough product on its own, or does
   Compy need more win *sources* that aren't toggles: driver-update detection, naming the exact
   device causing input lag, cleaning up tweak-pack damage?
2. **The flagship bet.** Deepen latency diagnostics until Compy can *name the guilty
   driver/device*, or build "paramedic mode" — undo the YouTube tweak pack that wrecked your
   config? One is daily-use depth; the other is a rescue moment with zero competition.
3. **Does "measures instead of promises" land** with a 20-something gamer, or does it sound like
   homework next to "BOOST FPS NOW"?
4. **Pricing shape.** A one-time unlock feels right for a local, no-account tool. What would *you*
   pay for, and how much?

*Thanks for reading — tear it apart.*
