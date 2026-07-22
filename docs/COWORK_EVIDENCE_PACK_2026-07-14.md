# Compy — Evidence Pack — 2026-07-14

> Objective capture only. Build stamp `3ba79dc+dirty · release` (verified live, matches HEAD at
> capture time). Captured via direct desktop walkthrough (computer-use) + repo source read for the
> marketing site. No commentary, no internal doctrine references — verbatim copy and real observed
> data only, for feeding to consumer-panel persona agents.

## Home

Header: "Home · how your PC is doing". Top strip: "RIG DIAGNOSTIC · JUL 14, 2026" with a
"Re-run check" button.

H1 "Home". Stat row: "CHECKS 16/16 MEASURED" · "ATTENTION 0".

Headline: "You're ready to play" / sub-line "1 worth fixing."

Central hologram-style rig visualization (view toggles: 3D / Cards / Exploded / Orbit) surrounded by
gauges:
- READINESS 100 — tag "MEASURED" — "+ 16 of 16 checks passed"
- AVG FPS 120 — tag "MEASURED"
- 1% LOW 116 — tag "MEASURED"
- GPU TEMP 52 — tag "MEASURED"
- RAM 20.6 / 31.4 GB
- STORAGE C: 46% full
- GPU: RX 9070 XT
- CPU: Ryzen 7 9850X3D — caption next to it: "no temp — Compy won't ship a kernel driver"

Below the visualization: "TOP LIMITER" row — "1 safe tweak not applied" · "medium confidence" —
with a "See in Lab" button.

Bottom of page: three nav buttons — Monitor / Blackbook / Lab.

No recovery/attention banner was showing in this capture (Attention count is 0).

## Monitor

Header: "Monitor · watch it live". Tabs: "Live" (active) / "Sessions". Right side: "Basic" /
"Advanced" toggle (Advanced active), plus an "OVERLAY" button.

At rest (no capture running): "START CAPTURE" button with hint text "start capture, then play".
Stat tiles (MAX FPS / AVG FPS / LOWEST LATENCY / SPIKES) all show "—". Frametime and FPS graph
areas both show "NO SIGNAL" placeholder.

Comparison line (from last session, shown even at rest): "VS YOUR LAST PALWORLD-WIN64-SHIPPING
SESSION   AVG FPS ▲37   1% LOW ▲62   SPIKES ▼10   11 COMPY CHANGES ON".

Live sensor dials (populated even without an active capture): GPU TEMP 52 (MEASURED), GPU LOAD 16%
(MEASURED), CPU 23% (MEASURED), RAM 65-66% (MEASURED).

Small caption: "ETW · external · anti-cheat safe — no injection, no kernel drivers."

Filter tabs: "ALL GAMES" (active) / "PALWORLD-WIN64-SHIPPING ONLY".

Session history rows (real data, newest first), format is game name, recency, duration, a sparkline,
and a "vs previous" delta:
- PALWORLD-WIN64-SHIPPING · yesterday · 6:29 PM — vs previous ▲37 avg
- PALWORLD-WIN64-SHIPPING · 4 days ago · 7:53 PM — vs previous ▼216 avg · "different game" flag
- SAND · 6 days ago · 1m 44s · 12:37 AM — vs previous ▲36 avg
- SAND · 15 days ago · 10h 28m · 7:20 PM — "first 2h 0m recorded" · vs previous ▼115 avg · "different game" flag
- MARVEL-WIN64-SHIPPING · 19 days ago · 3:15 AM

Chart legend text: "ONE AXIS FOR EVERY ROW · 0–274 1% LOW FPS · A TALLER LINE IS A BETTER SESSION".

Collapsed "Tuning presets" row — "by-hand checklists · advisory — Compy never changes these for
you". Footer link: "See what changed → Blackbook".

## Blackbook

Header: "Blackbook · what actually works — measured". Top strip: "FIELD RECORDS · JUL 14, 2026".
Two sub-tabs: "Logbook" and "Field guide".

### Logbook tab

Three stat cards:
- "CHANGES TO THIS PC" — 52 — "13 still on · every one undoable"
- "GAMING SESSIONS" — 20 — "measured, not guessed"
- "GUIDES FACT-CHECKED" — 2 — "every claim graded"

"THE RECORD" — "everything Compy has done on this PC · since May 27, 2026" — a reverse-chronological
feed mixing three row types:
- CHANGE rows, e.g. "Compy applied **Enable Windows Game Mode**" with a status tag ("NO LONGER
  ACTIVE" or "STILL ON" or "ROLLED BACK") and a one-line effect description ("Fewer background
  interrupts", "Background CPU & RAM"), plus for STILL ON rows an "undo returns to [prior state]"
  note.
- SESSION rows, e.g. "You played Palworld-Win64-Shipping for 3m" with avg fps / 1% low / delta vs
  last session / count of "changes on" during that session.
- A "GUIDE CHECK" row type also appears ("You fact-checked a guide").

### Field guide tab

Top: "Got a guide to fact-check? Try Autopsy →" with two mode buttons "Look it up" (active) /
"Autopsy a guide". Search box placeholder: `try "xmp"…`. Filter chips: All (active) / Tweaks /
Terms / Tricks / Guides, plus a "More filters" expander and a "HOW WE GRADE" expander.

"START HERE" row — five quick-pick chips: "Set up the VRR sync stack" · "Cap your frame rate the
right way" · "Clean up startup apps" · "Set a generous shader cache" · "Update graphics drivers the
right way".

Four category cards with counts:
- Guides — "Step-by-step setups, fact-checked claim by claim" — 8
- Tweaks — "Single settings, each graded Real, Placebo, or Risky" — 84
- Terms — "The jargon, translated into plain English" — 85
- Scam patterns — "The tricks fake optimizers pull — spot them before they cost you" — 14

(8+84+85+14 = 191 total — matches the marketing site's Blackbook count, see below.)

Footer link: "Open the instruments → Lab".

## Lab

Header: "Lab · benchmarks, latency, diagnostics". Top strip: "PROVING GROUND · JUL 14, 2026".

Central hologram rig visual (green) with the same gauge layout as Home (READINESS 100, AVG FPS 120,
SAFE STACK 1, 1% LOW 116).

Six instrument-station buttons: Optimize / Diagnostics / Benchmark / Latency / Tuning / Black Box.

### Optimize station (expanded)

Intro line: "The only station in this room that changes anything — everything else just reads."

"YOUR SAFE STACK 8/9 — 1 left to enable below — one tap each, reversible."

Banner: "Compy never changes anything without your explicit approval — and every apply captures its
undo first, so anything here rolls back from Applied."

**"READY — ONE CLICK, REVERSIBLE"** (1 item shown this capture):
- "Help Windows focus on your game" — subtitle "Game Mode" — "Measured · Fewer
  background-process stutters · reversible" — "Recommended" tag — toggle.
  Raw target shown inline: `HKCU\Software\Microsoft\GameBar → AutoGameModeEnabled +
  AllowAutoGameMode = 1`. Disclaimer line beneath: "Edits made outside Compy aren't tracked and
  can't be rolled back by Compy."

**"Not for this rig"** (collapsed-by-default drawer, badge "2"): "Compy detected these don't apply
to your hardware — set aside, and left out of your 'all handled' count. If a hardware read is wrong
(a dock, an adapter, a new part), you can override it." Items: "Free up an older hard drive" (Search
indexer · HDD only — "Only for HDD-only systems — this rig has an SSD/NVMe" — override link "My
hardware supports this — show it anyway"); "Decide HDR game by game" (Auto HDR — "Your display
isn't HDR-capable" — same override link).

**"Dismissed"** drawer (badge "1"): "You set these aside. They're out of your active count — restore
any one anytime." Item: "Turn on tear-free gaming" (VRR · G-SYNC / FreeSync) with a "Restore" button.

**"Deliberately refused"** drawer (badge "3"), shown with its items visible in this capture: "Popular
tweaks Compy deliberately refuses — the reason for each, with the full autopsy a click away."
- "Force HPET" — "On modern Windows this almost always raises latency and causes stutter — the OS
  already picks the best timer." — "Read the autopsy →"
- "Disable the pagefile" — "Games that commit more memory than your RAM hard-crash with it off —
  leave it system-managed." — "Read the autopsy →"
- "Disable Windows Defender" — "The FPS gain is a rounding error; the cost is your only always-on
  protection — and some anti-cheats react badly." — "Read the autopsy →"

**"NEEDS YOUR CALL"** section: "Detected, but Compy won't change these for you — they live in a
vendor app or a Windows page with no safe, reversible switch. Here's exactly where each one lives,
with the steps." Cards (each has a "Guided" button and a "Not for me" dismiss link; each with a raw
path shown + the same "edits made outside Compy" disclaimer):
- "Your call: extra security or extra frames" — tag "MEASURED" — subtitle "Memory Integrity / VBS"
  — path `Windows Security → Device security → Core isolation → Memory integrity (VBS)`.
- "Stop antivirus from scanning games mid-play" — tag "EXPECTED" — subtitle "Defender folder
  exclusions" — path `Windows Security → Virus & threat protection → Manage settings → Exclusions`.
- "Clean up your game audio" — tag "EXPECTED" — subtitle "Audio enhancements off" — path
  `Settings → System → Sound → your output device → Audio enhancements`.
- "Check that your most-played games live on your fastest drive" — tag "MEASURED" — "Map and asset
  loads measured in seconds instead of tens of seconds · less texture pop-in mid-match · less
  file-I/O competition between your active game and a background launcher update."
- "Opt out of AMD's data collection" — tag "EXPECTED" — subtitle "AMD User Experience Program" —
  path `AMD Software: Adrenalin Edition → Settings (gear) → Preferences → User Experience Program →
  Off` — extra button "How to → AMD Software: Adrenalin Edition".

**"Startup apps"** drawer (badge "5"): "Apps that launch with Windows. Toggle one off to keep it from
auto-starting — reversible, nothing is deleted." Real entries with real exe paths and live
toggle-state, e.g. AMDNoiseSuppression (off), Discord (on), EpicGamesLauncher (off), Medal (on), plus
one more below the fold.

(Diagnostics / Benchmark / Latency / Tuning / Black Box stations were not expanded in this capture.)

## Settings

Header: "Compy Settings" — "Make it yours. None of this touches what Compy measures."

**APPEARANCE**
- Theme swatches: Midnight / Violet / Crimson (currently selected) / Emerald / Hearth, with a live
  preview panel.
- "Monitor console" toggle (ON) — "Monitor's live face as an instrument cluster: rolling fps and
  frametime traces with honest gauges. Same sensors, same measurements — turn off for the classic
  live tiles."
- "JARVIS motion" toggle (ON) — "The interactive motion layer: glide scrolling, a sweep when you
  change rooms, magnetic rail buttons, and gauges that tick when a measured value changes. Purely
  visual — it never touches what Compy measures, and the Motion setting below still wins."

**BEHAVIOR**
- "When I close, keep Compy running in the tray" toggle (OFF, labeled default) — "Off (default):
  closing fully quits Compy. On: closing tucks it into the system tray — you'll see the Compy icon
  there. Right-click it for Show or Quit; hover for live FPS while you play."
- "Motion" — three-way: Full (selected) / Follow system / Reduced — "Compy's living motion is on by
  default, even if Windows requests reduced motion. Choose Follow system to defer to Windows, or
  Reduced to keep everything calm."
- "Expert view" toggle (ON) — "For tinkerers: shows every tweak's technical name and the exact
  registry key, service, or setting it touches, opens the 'deliberately refused' list with full
  reasoning, and swaps rounded stats for raw measured values. Same tweaks, same safety rails —
  nothing new becomes appliable."
- "In-game overlay density" — Minimal / Standard / Full (selected) — "What the in-game overlay
  shows: just FPS · + 1%/temp/GPU · + a frametime line."
- "In-game overlay background" — On / Off (Off selected) — "Off makes the overlay see-through — the
  numbers float on the game, outlined so they stay readable."

**SETUP**
- "Re-run the guided setup" — "Replay the intro, then run a fresh first check." — button.
- "Re-run the check" — "Re-scan this rig's readiness without the intro." — button.

**LICENSE**
- "You're on the free version. All of Compy's core — including everything safety-critical — is
  free."

**ABOUT**
- "Compy v0.1.0 · 3ba79dc+dirty · release"
- "Fully local. No account, no telemetry, nothing leaves your PC."
- "Rules: Built-in"

## Marketing site (source-read, `dist-site/index.html`, currently dark/unpublished)

Top bar: wordmark "Compy" + chip "Private beta · invite only".

**Hero:**
- Kicker (small text above H1): "Measured, not promised."
- H1: "Know which PC tweaks actually help your rig."
- Sub-copy: "Every optimizer promises speed. Compy proves what's true on your rig: it reads your
  actual hardware, grades the internet's favorite tweaks — real, placebo, or risky — and measures
  what actually changed. When a fix is real, you see the numbers. When it isn't, you see that too.
  Everything it changes, it can undo."
- CTAs: "Join the waitlist" (button) · "Read the debunks →" (link).
- Note directly under the CTAs: "**Compy is free.** No account, no ads, nothing leaves your PC."

**Hero visual — "the proof loop" (real, not decorative):**
- Card title: "The proof loop · a real receipt"
- Row 1: "game-mode" — "applied · 18:28"
- Row 2: "no gain beyond ±0.7% noise" — "measured ✓"
- Row 3: "rolled back" — "exact prior value ✓"
- Caption: "Applied → measured → rolled back. Every change gets this receipt, on your machine."
- Adjacent verdict-key chips (decorative icons, real labels): Real / Placebo / Risky — refused.

Ribbon under hero: "Reads your rig → Grades honestly → Measures the change → Keeps the receipt".

**Three value cards:**
1. "01 · per-rig — Reads *your* hardware" — "Verdicts are tailored to the PC in front of you — GPU,
   CPU, drives, display — never copied off a YouTube 'best settings' list. If a tweak isn't for your
   rig, Compy says so."
2. "02 · measured — Measures what changed" — "Frames, 1% lows, temps — before and after, on your own
   sessions. Real improvements get named loudly. No measurable change gets called exactly that."
3. "03 · reversible — Keeps the receipt" — "Every change is snapshotted first and undoable later —
   exact prior state, kept on your PC. Rollback isn't a feature here; it's the foundation."

**Verdict key (three chips + explanations):** Real ("It actually does something..."), Placebo ("All
hype, no effect..."), Risky — refused ("Not worth the downside...").

**Blackbook showcase section:**
- H2 "The Compy Blackbook"
- Sub-copy: "The internet's favorite PC tweaks, graded honestly — what works, what's placebo, and
  the snake-oil we name and refuse."
- "Start here: three quick reads" — 3 featured cards (Force HPET/useplatformclock — Risky; Forcing
  0.5ms global timer resolution — Risky; Disable/fix the pagefile — Risky).
- "More of the internet's favorites" — 9 more cards spanning Real / Placebo / Risky verdicts
  (Disable Windows Defender, registry FPS hacks, debloat scripts, CPU mitigations, Fullscreen
  Optimizations, Game Mode, SMT/Hyper-Threading, TCP mega-packs, game boosters, RAM cleaners, DNS for
  gaming).
- Footer link: "Open the full Blackbook — all **191** entries →"

**Waitlist section:** "Get the launch email" — "Compy is invite-only today. The waitlist is your
spot in line for public launch — you'll get exactly one email the day it opens. Nothing else." —
email form, button "Notify me" — note: "Your email is stored only to send that one launch message —
nothing else, no third parties, no tracking. The app itself sends nothing off your PC."

**Download section:** "Download" — "The public build will live right here. Until then Compy ships by
invite only — the waitlist above is the door."

**Footer creed:**
- "Measured, not promised."
- "No fabricated numbers — anywhere, ever."
- "No fear UX, no invented problems, no '847 issues found'."
- "Every change reversible, with the receipt to prove it."
- "Local-only by design · no telemetry · no account."
