# Tuning Follow-ons + Wave-2 Share Card — SCOPE ONLY (not built)

> **STATUS: SCOPE / DESIGN ONLY.** Written during the 2026-06-10 autonomous sprint per seed item #6
> ("SCOPE-don't-ship the tuning follow-ons + the wave-2 share-card idea"). **Nothing here is built.**
> Each item is gated on a real verification milestone below; none ships until its gate clears AND the
> owner greenlights. Recorded so a future session/owner can execute cleanly against the existing
> tuning-guides machinery (`src/data/tuning-guides.json` + `TuningInstrument` + `TuningDebrief` +
> `comparison.rs`), which all three reuse — no new mutation primitive, no catalog expansion.

## Why these three, and why now only as scope

The AMD GPU undervolt guide (`amd-gpu-undervolt`) shipped the *whole pattern*: a single-source guide
(`tuning-guides.ts`) rendered in Learn + Lab, a "Show me the way" schematic, a read-only stability/
thermal instrument in Lab, and a before/after arming flow in the Play debrief — all advisory, all
honest-measurement-gated, Compy never touches a voltage. Adding a *vendor* is now mostly **one JSON
entry** following that pattern. The gating question is never "can we build it" — it's "can we honestly
MEASURE it on that hardware yet." That honesty gate is the whole content of this doc.

---

## 1. NVIDIA GPU undervolt guide (`nvidia-gpu-undervolt`)

**Home room + affordance (placement law):** identical to AMD — a *guide* in **Learn** (+ walkthrough),
its *measurement* in **Lab** (the Tuning instrument) and **Play** (the debrief before/after), an
*advisory nudge* in **Check** when the GPU runs sustained-warm. `tuningGuideForVendor("nvidia")` already
returns null by design; this flips it on for NVIDIA rigs.

**The method is all-original + facts-only (all-original law):** NVIDIA undervolting is done through the
MSI Afterburner curve editor (Ctrl+drag a V/F point, flatten the curve above it) OR the newer NVIDIA
app's built-in tuning. State the procedure in our own words and draw our own schematic — never capture
Afterburner's or NVIDIA's UI. The voltage-stepping method and "stress, watch for a driver reset" loop
are facts, stated freely.

**THE GATE (honest-measurement law + locked rule #5):** NVIDIA's **NVML sensor + session/FPS monitoring
is "implemented, not yet hardware-verified"** (per CLAUDE.md — the RTX 3060 Ti tester had 0 monitored
sessions). So:
- The **guide body** (Learn entry + walkthrough + Lab guide text) can ship as soon as the owner wants —
  it's advisory prose, measures nothing.
- The **measurement readout** (the Lab Tuning instrument's stability/thermal verdict + the Play
  before/after) must **NOT** activate for NVIDIA until one real monitored NVIDIA session proves NVML
  peak-temp + FPS land in a `SessionSummary`. Until then the instrument shows the guide + an honest
  "measurement on NVIDIA is awaiting hardware verification — the guide works, the readout is coming"
  line (mirrors the existing NVML-tooltip honesty). Do not silently reuse the AMD-verified readout.
- **Split-ship is allowed and recommended:** guide-only first (helps NVIDIA testers immediately),
  measurement second (when a session proves the sensor). This is the honest version of "ship value now."

**Verification milestone to clear before the readout flips:** one NVIDIA tester's Export shows a
monitored session with a non-null `peak_gpu_temp_c` and FPS samples → then enable
`tuningGuideForVendor` measurement for NVIDIA + drop the awaiting-verification line.

---

## 2. CPU tuning guide — PBO / Curve Optimizer (`amd-cpu-pbo` / Intel later)

**Home room + affordance:** same shape — guide in Learn, measurement in Lab/Play, nudge in Check (when
a CPU-bound limiter shows). But CPU tuning is a **different measurement axis** than GPU undervolt:

**The honesty nuance (why this is harder than GPU UV):** an undervolt's payoff is a *temp drop you can
read from a GPU sensor*. PBO/Curve-Optimizer's payoff is *more sustained boost clock / better 1% lows
under CPU-bound load* — and Compy has **no CPU temperature** (locked rule #1, no kernel driver) and CPU
clock sensing is coarser. So the measurable signal is **1% low + frametime stability on a CPU-bound
session**, NOT temperature. The instrument must be honest that it's measuring frames, not CPU heat.

**THE GATE:** the comparison engine already measures 1% low against a noise floor (`comparison.rs`), so
the *measurement* exists. The risk is **attribution** — a Curve-Optimizer change that's too aggressive
fails as instability (WHEA errors, random reboots, a failed boot) that Compy can't see directly. So the
CPU guide leans even harder on the **crash/instability self-check** the tuning flow already asks ("did
it crash, hang, reboot?"), worded for CPU: "a Curve-Optimizer that's too aggressive shows up as random
reboots or app crashes hours later — tell Compy and it flips to 'too aggressive.'" The verdict copy must
make clear that CPU stability proves out over DAYS, not one session (honest-measurement law, harder
form).

**Verification milestone:** the AMD dev rig (X3D-class) can self-verify the guide + the 1%-low
measurement path on a CPU-bound title. Intel (different tool: XTU / BIOS) is a separate later entry on
its own gate.

---

## 3. Wave-2 share card (`session-share-card`) — opt-in, local-only

**The idea:** after a session debrief, a "Make a share card" affordance renders the session's honest
numbers (avg FPS, 1% low, peak GPU temp, stutter verdict, game name) as a clean image the tester can
save/post — the honest counter to the fake "+40% FPS!!" screenshots. It IS the marketing: real numbers,
Compy's voice, "measured, not vibes."

**Home room + affordance:** **Play**, on the session debrief (where the numbers already live) — a quiet
"Share this session" door next to Export. NOT a new room.

**THE GATES (this one is mostly honesty + privacy, not measurement):**
- **All-original law:** the card is our own schematic/layout — our wordmark, our type, our palette.
- **Honest-measurement law:** the card shows ONLY what was measured, with the same qualifiers the
  debrief uses (1% low = live estimate; "no stutter events" not "buttery smooth"). NEVER a fabricated
  delta or a green "STABLE." If a comparison verdict exists, it carries verbatim ("no measurable
  change" included — that's the point).
- **Privacy / outward (locked):** rendering the card is **fully local** (canvas → PNG to disk, the
  Export precedent — zero network). Compy NEVER auto-posts. The card may include the game name +
  hardware (like Export); show a one-line "this is yours to share — nothing is sent" note. Any
  auto-upload/social integration is a SEPARATE gated arming plan (remote-egress precedent), owner
  decision, explicitly out of scope here.
- **Reversibility:** purely additive, behind a flag until owner sign-off; generates a file, mutates
  nothing.

**Why wave-2, not now:** it's a growth/marketing feature; it rides behind the beta loop + honesty
mechanics that are the current imperatives. Tester signal ("would you share this?") validates it before
build, per the standing "candidates ride behind tester-validated need" rule.

---

## What this doc is NOT

Not a build order, not a gate, not a schedule. It records three placement-law-compliant, honesty-gated
follow-ons so they thread cleanly into the existing tuning machinery when the owner sequences them.
Each names its home room + affordance + the exact verification milestone that unlocks it. Build none
until its gate clears and the owner greenlights.
