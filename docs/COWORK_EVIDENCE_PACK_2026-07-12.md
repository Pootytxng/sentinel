# Compy — Evidence Pack — 2026-07-12

> Objective capture only — no internal doctrine, no roadmap references, no Cowork opinion.
> Verbatim copy in quotes, real data, layout described plainly. Captured live via computer-use
> against the running Compy app (build stamp `50b5c03+dirty · release`, working tree has
> in-progress uncommitted changes on top of that commit) and by reading the marketing site source
> directly. This is a partial capture (Home, Monitor, Blackbook, Lab → Optimize, Settings — not
> every Lab station) done as part of building the consumer-panel skill; treat gaps as "not
> re-checked this round," not "changed."

## Home

- Header: "Home · how your PC is doing", build stamp `50b6c83+dirty · release` visible top right,
  a "Re-run check" button.
- Advisory line: "Readiness checks are advisory. Compy is checking configuration signals, not
  guaranteeing FPS."
- Status row: "CHECKS 16/16 MEASURED" and "ATTENTION 1" (amber).
- Center hologram card: READINESS 94 (MEASURED) with "+ 15 of 16 checks passed" sub-line; AVG FPS
  83 (MEASURED); RAM "16.7 / 31.4 GB"; STORAGE "C: 67% full"; GPU "RX 9070 XT"; CPU "Ryzen 7
  9850X3D"; a line under CPU reading "no temp — Compy won't ship a kernel driver"; 1% LOW 54
  (MEASURED); GPU TEMP 48 (MEASURED).
- The center visual is a 3D rendered PC hologram on a grid platform, with view-mode buttons "3D /
  Cards / Exploded / Orbit" (3D selected).
- Below the card: "TOP LIMITER — Applied Compy changes (high confidence)" with a "See in Lab"
  button, and three quick-nav buttons: Monitor / Blackbook / Lab.
- Sidebar footer: green dot "Zero outbound connections", "Every change reversible · ledger: 51".
- No Gaming Mode recovery banner was visible on this screen at capture time.

## Monitor

- Header: "Monitor · watch it live", same build stamp.
- "STOP CAPTURE" button (capture in progress), live reading "264 · 1% low · est", an "OVERLAY"
  button.
- Four stat tiles: MAX FPS 300, AVG FPS 300, LOWEST LATENCY 2.8 ms, SPIKES 0.
- A "FRAMETIME" line chart, y-axis labeled up to "6.3" down to "0.1", annotation "drag to zoom ·
  double-click to reset", a right-side label "0-8.3 MS SCALE · BUDGET 4.0 MS".
- Comparison line: "VS YOUR LAST SAND SESSION (DIFFERENT GAME) — AVG FPS ▼216 · 1% LOW ▼205 ·
  SPIKES ▲11 · 12 COMPY CHANGES ON" above a second chart ("FPS", topping at "300 FPS").
- Four gauges: GPU TEMP 47 (MEASURED), GPU LOAD 64 (MEASURED), CPU 27 (MEASURED), RAM 54
  (MEASURED).
- Footer disclosure line: "ETW · external · anti-cheat safe — no injection, no kernel driver."
- Game filter tabs: "ALL GAMES" and "PALWORLD-WIN64-SHIPPING ONLY".

## Blackbook

- Header: "Blackbook · what actually works — measured".
- Search box placeholder: `try "xmp"...`.
- Filter chips: All / Tweaks / Terms / Tricks / Guides, plus a "More filters" dropdown and a "HOW
  WE GRADE" link.
- "START HERE" row, five chips: "Set up the VRR sync stack", "Cap your frame rate the right way",
  "Clean up startup apps", "Set a generous shader cache", "Update graphics drivers the right way".
- Four category rows with counts: Guides — 8 ("Step-by-step setups, fact-checked claim by
  claim"); Tweaks — 84 ("Single settings, each graded Real, Placebo, or Risky"); Terms — 85 ("The
  jargon, translated into plain English"); Scam patterns — 14 ("The tricks fake optimizers pull —
  spot them before they cost you").
- Footer: "Open the instruments → Lab".

## Lab → Optimize (expanded)

- Lab header stats match Home (READINESS 94, AVG FPS 83, 1% LOW 54); "SAFE STACK" gauge reads 0
  READY before the station is opened.
- Station tabs: Optimize / Diagnostics / Benchmark / Latency / Tuning / Black Box (each with a
  small green status dot).
- Opening Optimize: "The only station in this room that changes anything — everything else just
  reads."
- "YOUR SAFE STACK — 8/9 — 1 was turned off outside Compy — restore it below."
- "Compy never changes anything without your explicit approval — and every apply captures its
  undo first, so anything here rolls back from Applied."
- One active card: "Help Windows focus on your game" (Game Mode) — "Measured · Fewer
  background-process stutters · reversible", a green "Recommended" badge, an off toggle, and:
  "You turned this on with Compy; something outside Compy switched it back off. Flip it back on —
  or leave it, your call. Compy never re-applies on its own."
- Three collapsed rows: "Not for this rig (2)", "Dismissed (1)", "Deliberately refused (3)".
- Expanding "Deliberately refused" shows an intro line — "Popular tweaks Compy deliberately
  refuses — the reason for each, with the full autopsy a click away" — then three cards, each
  with a one-line reason and a "Read the autopsy →" link:
  - **Force HPET** — "On modern Windows this almost always raises latency and causes stutter —
    the OS already picks the best timer."
  - **Disable the pagefile** — "Games that commit more memory than your RAM hard-crash with it
    off — leave it system-managed."
  - **Disable Windows Defender** — "The FPS gain is a rounding error; the cost is your only
    always-on protection — and some anti-cheats react badly."
- Below that, a "NEEDS YOUR CALL" section: "Detected, but Compy won't change these for you — they
  live in a vendor app or a Windows page with no safe, reversible switch. Here's exactly where
  each one lives, with the steps." Cards seen (each has a "Guided" link and a "Not for me"
  dismiss):
  - "Your call: extra security or extra frames" (Memory Integrity / VBS) — MEASURED
  - "Stop antivirus from scanning games mid-play" (Defender folder exclusions) — EXPECTED
  - "Clean up your game audio" (Audio enhancements off) — EXPECTED
  - "Check that your most-played games live on your fastest drive" — MEASURED, with detail: "Map
    and asset loads measured in seconds instead of tens of seconds — less texture pop-in
    mid-match, less file-I/O competition between your active game and a background launcher
    update."
  - "Opt out of AMD's data collection" (AMD User Experience Program) — EXPECTED

*(Diagnostics/Benchmark/Latency/Tuning/Black Box stations not re-opened this capture.)*

## Settings

- Intro line: "Make it yours. None of this touches what Compy measures."
- **Appearance:** theme picker (Midnight / Violet / Crimson / Emerald [selected] / Hearth) with a
  live gauge preview; one preview toggle — "Monitor console (preview)" (ON) — "Monitor's live
  face as an instrument cluster: rolling fps and frametime traces with honest gauges. Same
  sensors, same measurements — turn off for the classic live tiles."
- **Behavior:** "When I close, keep Compy running in the tray" (ON) — "Off (default): closing
  fully quits Compy. On: closing tucks into the system tray — you'll see the Compy icon there.
  Right-click it for Show or Quit; hover for live FPS while you play." · "Motion" (Full / Follow
  system / Reduced — Full selected) — "Compy's living motion is on by default, even if Windows
  requests reduced motion." · "In-game overlay density" (Minimal / Standard / Full — Full
  selected) — "What the in-game overlay shows: just FPS · + 1%/temp/GPU · + a frametime line." ·
  "In-game overlay background" (On / Off — Off selected) — "Off makes the overlay see-through —
  the numbers float on the game, outlined so they stay readable."
- **Setup:** "Re-run the guided setup" button, "Re-run the check" button.
- **License:** "You're on the free version. All of Compy's core — including everything
  safety-critical — is free."
- **About:** "Compy v0.1.0 · 50b5c03+dirty · release" — "Fully local. No account, no telemetry,
  nothing leaves your PC." — "Rules: Built-in".
- Total "(preview)" toggles found: **one** (Monitor console).

## Marketing site (`dist-site/index.html`, read from source — page not publicly live)

- `<title>`: "Compy — Measured, not promised."
- Top bar: wordmark "Compy", chip "Private beta · invite only".
- Kicker: "Know which PC tweaks actually help your rig."
- H1: "Measured, not promised."
- Hero sub: "Every optimizer promises speed. Compy proves what's true on your rig: it reads your
  actual hardware, grades the internet's favorite tweaks — real, placebo, or risky — and measures
  what actually changed. When a fix is real, you see the numbers. When it isn't, you see that
  too. Everything it changes, it can undo."
- CTAs: "Join the waitlist" / "Read the debunks →".
- Hero visual: an embedded video framed as "the living Blackbook" with a decorative proof strip
  overlay reading: `fast-startup-off` "applied · 21:42" / "+8 fps · 1% low +11" "measured ✓" /
  "rolled back" "exact prior value ✓" / caption "Judge → measure → receipt → undo. The whole
  loop, on your machine." Decorative verdict chips labeled Real / Placebo / Risky — refused.
- Blackbook section headline "The Compy Blackbook": "174 tweaks, terms, and guides, graded
  honestly — what works, what's placebo, and the snake-oil we name and refuse." Closing link:
  "Open the full Blackbook — all 174 entries →".

**Note:** the site's "174" figure does not match the live app's current Blackbook category sum
(84 tweaks + 85 terms + 8 guides + 14 scam patterns = 191; even excluding scam patterns, 177).
Flagging as a fact for whoever reads this, not a request — not this document's job to interpret.
