# Tuning Guides + Stability Measurement — spec (owner-approved 2026-06-08)

*Hardware-aware **advisory** undervolt guidance that sends the user to the **vendor's own tool**,
paired with Compy **measuring whether the tune actually worked and held up** on their rig — reusing
the session/sensor monitoring that already exists. **Compy never applies a voltage or a clock.** The
measurement is the differentiator: anyone can link a YouTube undervolt video; only Compy proves, on
YOUR silicon, that temps dropped and frames held without new instability.*

**Status: SPEC ONLY. Do NOT build until the owner gives the build GO.**

---

## Why this fits Compy (and the locked rules)

- **No in-house apply** → nothing to roll back, and undervolt/overclock are **never added to the
  appliable catalog** (locked rule #6). The user applies in the vendor tool; Compy stays
  read-only/advisory. This is the *only* honest way to offer UV/OC without crossing the
  no-risky-tweaks + rollback-first lines.
- **No kernel driver, no injection** → measurement reuses the existing ETW FPS capture + vendor GPU
  sensors (locked rules #1–2).
- **Read-only / advisory / reversible / session-scoped** → the "grows upward, not sideways" shape
  `docs/PRODUCT_DIRECTION.md` asks of any new feature.

## v1 scope (owner-resolved)

- **v1 = AMD GPU undervolt ONLY.** The dev rig is AMD-verified, and **AMD sensors/sessions are the
  verified path; NVIDIA NVML sensor + session/FPS monitoring is "implemented, not yet
  hardware-verified" (locked rule #5)** — so a *measurement* feature must not ship on NVIDIA until a
  monitored NVIDIA session proves the sensor path. NVIDIA GPU UV, Intel GPU, and Ryzen CPU (PBO Curve
  Optimizer) are **follow-ups**, each gated on its own verified-sensor path.
- **Undervolt-only in v1.** Overclock guidance is a **gated follow-up** carrying a **heavier
  discretion banner** (OC pushes voltage/clocks UP → real thermal/stability/longevity stakes; UV only
  ever resets when it fails). Do not ship OC in the first cut.

## Placement — one job per room, ONE shared source (placement law)

There is **no new tab.** The guide content lives **once** and is shared; measurement and the nudge
thread into the rooms that already own those jobs.

### Single source: `tuning-guides.json`
The guide (method, typical range, discretion copy, undo, and the vendor-tool walkthrough steps) lives
**once** in `src/data/tuning-guides.json` and is consumed by every surface below — they **cannot
drift** (same single-source pattern as `verdict-glossary.ts` → the injected `how-we-grade` entry).

### 1. Learn — a searchable guide entry (derived from the source)
- A **`guide`-type knowledge entry** ("Undervolt your Radeon") **injected into `KNOWLEDGE` from
  `tuning-guides.json`** (the `how-we-grade` injection pattern), so it's findable by search
  (undervolt / adrenalin / temps / quieter) and browsable in Learn.
- **never-teleport:** it's a Learn entry — the body + the **"Show me the way"** schematic expand
  **in place** (existing `EntryCard` + `<Walkthrough>` `<details>` pattern).
- **foam-pit:** the method, the typical range, and the discretion note are in the **visible** entry
  body — not hidden behind hover.
- **doorknob:** "Show me the way" reads as a schematic reveal; the entry is advisory prose with **no
  apply button** (nothing for Compy to do — honest).

### 2. Lab — the "Tuning" instrument (guide + the measurement)
- A new **inline collapsible `LabSection`** beside Benchmark/Latency/Diagnostics that renders **the
  same guide from `tuning-guides.json`** (one source) **and** the **Stability & thermal readout** that
  measures the result: recent sessions' **peak GPU temp**, **frametime consistency** (the stutter
  timeline), and — once a tuning baseline exists — the **before/after thermal + stability delta**.
- **never-teleport:** inline section (summary header → expand). **foam-pit:** the numbers are visible
  on expand. **doorknob:** a *gauge*, not a control — nothing here changes the system.
- **Zero new IPC:** reuses `get_gpu_sensors` (live) + `get_session_summaries`
  (`peak_gpu_temp_c`, `low1_fps_est`, `stutter_insight`).

### 3. Play — before/after via the existing session comparison + debriefs
- Reuse the **comparison engine** (`arm → play → finalize` against the noise floor, with the
  Trust-Ledger confound watermark) and the **`SessionDebrief`**: the next same-game session after a
  tune shows **FPS held + temp dropped + no new stutters**, judged honestly.
- **never-teleport:** the session row expands **in place** into the debrief/comparison cluster (the
  shipped Play accordion); the temp/stability delta sits **alongside** the existing FPS delta.
- **One backend extension (the only real new code):** generalize the armed comparison to a **"tuning
  baseline"** — a baseline NOT tied to a ledger fix (there's no Compy apply). Same
  `arm`/`finalize`/noise-floor/confound-watermark logic; the "change" is "I undervolted in Adrenalin,"
  recorded session-side, **never as a mutating ledger entry**.

### 4. Check — an advisory nudge, only when temps warrant *(v1-or-follow-up — NOT dropped)*
- A **new advisory limiter row** that appears **only** when recent sessions show the GPU running hot
  (sustained `peak_gpu_temp_c` over the threshold): *"Your GPU's been running warm — an undervolt
  usually drops temps for free."*
- **bathroom law:** signpost **at the moment of need** — absent until temps warrant it; never a
  standing "try undervolting!" banner.
- **named-place link / never-teleport:** the row's action is a **named-place affordance** —
  `Cooler & quieter — undervolt guide →` opening the **Learn** guide as **deliberate travel** (Back
  returns). No surprise relocation, no manual search.
- **doorknob:** an **advisory** row, visibly *not* a one-click fix (there's no apply) — it explains
  and points. **foam-pit:** the reason ("peaked at 84°C across your last 3 sessions") is on the row.
- **Sequencing:** recorded as **v1-or-follow-up** — ship with v1 if the Lab/Learn/Play core lands
  clean; otherwise the immediate fast-follow. It is **not** dropped from the design.

## Advisory + honesty constraints (every piece)

- **Vendor built-in tool first** (AMD Adrenalin in v1) — never a third-party "optimizer" (ties to the
  `paid-one-click-optimizers` debunk).
- **Undervolt-leaning:** undervolt is the default (cooler/quieter, low blast radius); OC is the
  heavier-banner follow-up.
- **Methodology + ranges, NEVER per-chip guarantees:** teach the method (step, stress, watch the
  failure signature, back off one); give a typical range with a loud **"silicon lottery — find YOUR
  number, don't copy a video."**
- **Discretion stated:** advisory; your tool, your call; check warranty terms. No Compy
  "approved-number" stamp. **UV discretion copy is good for beta; a legal pass is required before
  public** (advisory-liability language) — same gate as `PRIVACY.md`/`EULA.md`.
- **NO in-house apply** → nothing enters the appliable catalog (locked rule #6), nothing to roll back,
  no new elevation, no kernel driver/injection.

## Originality — the "all original" law (owner, 2026-06-08 — adamant)

EVERYTHING this feature ships is Compy's own creation. Competitor videos, other people's guides, forum
posts, and articles are **reference / market research ONLY — never copied into the product.** The line:

- **Facts and procedures aren't copyrightable** — the Adrenalin menu path ("Performance → Tuning →
  Custom"), the voltage-stepping method, the typical mV range, what a setting does — so we **state
  them freely, in our own words.**
- **Creative expression IS** — a creator's specific wording, their screenshots, captured UI, diagrams,
  or video frames — so **all guide copy is written in Compy's own voice (THE VOICE)**, and **all
  walkthrough visuals are our own schematics, drawn from scratch.**
- **Schematic, never screenshot:** the "Show me the way" panels are stylized representations of the
  tool's layout (boxes + labels + positions), **never** a captured Adrenalin/NVIDIA screenshot, and
  carry **no vendor logos or trademark dress** — just the plain menu-path words a user needs.

This is already how the knowledge layer + the existing walkthroughs work (THE VOICE + the
schematic-never-screenshot rule); the spec names it so CC builds the tuning content to the same bar.

## The honest-measurement law — VERBATIM, non-negotiable

> Stability is a function of **time**, not one run. Compy **never** flashes a green "STABLE" / "STABLE ✓".
> The verdict is **always time-and-sample-qualified and reversible**:
> - **"Holding up so far"** — over the qualifying window: temps down, frames held, no stutters/crashes
>   flagged. *"Only your continued play proves it."*
> - **"Too aggressive"** — 1% low regressed past the noise floor, new stutters, or a user-reported
>   crash → "step back one increment in your tool."
> - **"No measurable change"** — inside the noise (an honest null; never invented).
>
> Compy can't see a black-screen reset, so the debrief asks once, plainly: *"Did it crash, hang, or
> show artifacts?"* (bathroom law — at the moment of the debrief, never a nag.)

### Verdict thresholds (owner-resolved)
- **FPS:** reuse the **existing comparison noise floor** (`comparison.rs`) — never claim a frame
  win/loss inside the noise.
- **"Holding up so far"** requires **≥ 3 sessions AND ~3 hours of play with no crash reported** in the
  qualifying window. Below that, the readout stays provisional ("too early to call — keep playing").
- **Temps count as a real improvement at a ~3 °C+ drop** in `peak_gpu_temp_c` at comparable load
  (smaller deltas are within sensor/ambient noise → "no measurable change").

## Open items (carried — not blocking the spec)
- **Legal pass on the UV discretion copy before public** (beta copy is approved).
- **Follow-up gates:** NVIDIA UV (needs a verified NVML session per rule #5), Ryzen CPU UV (PBO Curve
  Optimizer, BIOS), and the overclock chapter (heavier banner) each ride their own gate.

## Acceptance (when the owner gives the build GO)
- [ ] **Single source:** `tuning-guides.json` is the one source; the Learn entry is derived/injected
      from it and the Lab instrument renders from it — no duplicated guide copy (they can't drift).
- [ ] **Learn:** rig-matched AMD undervolt guide + vendor-aware "Show me the way" schematic; expands
      in place; method/ranges/discretion visible (foam-pit); no apply button (doorknob); searchable.
- [ ] **Lab:** "Tuning" instrument (inline collapsible) shows the guide + the read-only Stability &
      thermal readout reusing existing sensor/session data; **zero new IPC**.
- [ ] **Play:** tuning before/after via the existing comparison + `SessionDebrief`, expanding in
      place; temp + stability delta beside the FPS delta; FPS judged on the existing noise floor;
      "holding up so far" gated on ≥3 sessions AND ~3h no-crash; temps real at ~3 °C+ drop.
- [ ] **Check:** advisory nudge appears **only** when temps warrant (bathroom law); named-place link
      to the Learn guide (deliberate travel); advisory, not a fix button (doorknob). *(v1-or-fast-follow.)*
- [ ] **Honest-measurement law** honored verbatim — never "STABLE," always time-qualified; the
      crash/artifact self-check is asked once at the debrief.
- [ ] **Originality ("all original" law):** all guide copy in Compy's own voice; all walkthrough
      visuals are our own schematics (never screenshots, no vendor logos/trademark dress); facts
      stated in our own words.
- [ ] **AMD-only in v1;** NVIDIA/Intel/CPU and overclock are gated follow-ups.
- [ ] **Zero apply/mutation/elevation;** nothing in the appliable catalog; locked gates untouched;
      guards green; reduced-motion clean.

---

## Sample — AMD GPU undervolt guide (the shape, the v1 content)

**`tuning-guides.json` entry → rendered identically in the Learn entry and the Lab Tuning instrument:**

> ### Undervolt your Radeon — cooler and quieter, usually for free
> **Goal:** lower temps and fan noise — often with the same or slightly better performance, because a
> cooler card holds its boost longer. An undervolt that goes too far just gets unstable and resets;
> you nudge it back and you're fine. It's the safest knob on the card.
>
> **You'll use AMD's own tool — Adrenalin — nothing to install.** *(Show me the way ▸)*
> 1. Right-click desktop → **AMD Software: Adrenalin Edition**.
> 2. **Performance → Tuning → Custom**; turn on **GPU Tuning**, voltage → **Manual**.
> 3. Lower **max voltage (mV)** by a small step — **25–50 mV** to start. **Apply.**
> 4. Play a demanding game or loop a benchmark **20–30 min**.
> 5. Stable? Drop another 25–50 mV and retest. Crash, artifacts, or a black screen? **Step back up one
>    increment** — that's your limit.
>
> **A "normal" number?** Many recent Radeons settle around **−50 to −120 mV** — but **this is the
> silicon lottery; your chip's stable point is its own.** Find it by stepping, don't paste a number
> from a video.
>
> **Discretion:** advisory. You're making the change in AMD's tool, at your discretion — an undervolt
> won't hurt the hardware, but confirming stability is on you, and you should check your card's
> warranty terms. **Compy never touches your voltage — it just measures whether it worked.**
>
> **Undo:** Adrenalin → Performance → Tuning → **Reset**.

**Walkthrough steps (extends the `walkthroughs.json` shape; carried in the same source):**
```jsonc
{
  "group": "tuning",
  "title": "Undervolt your Radeon (Adrenalin)",
  "pairsWith": ["amd-gpu-undervolt"],     // the Learn guide id + the Check nudge link target
  "deepLink": null,                        // opens a desktop app, not an ms-settings: URI → no allowlist change
  "biosGeneric": false,
  "variants": [
    { "vendor": "amd", "label": "AMD Adrenalin", "steps": [
      { "caption": "Adrenalin → Performance", "x": 12, "y": 20, "label": "Performance" },
      { "caption": "Tuning → Custom", "x": 40, "y": 20, "label": "Tuning · Custom" },
      { "caption": "GPU Tuning on, voltage → Manual", "x": 40, "y": 52, "label": "Manual mV" },
      { "caption": "Lower max voltage 25–50 mV, Apply", "x": 68, "y": 52, "label": "-25-50 mV" },
      { "caption": "Stress 20-30 min, watch for resets", "x": 68, "y": 80, "label": "Stress test" }
    ]}
  ]
}
```

**The Check nudge (only when warm) → Play/Lab payoff:**
> **Check** (appears only when temps warrant):
> `Advisory · Your GPU peaked at 84°C across your last 3 sessions`
> `An undervolt usually drops that for free. → Cooler & quieter — undervolt guide` *(opens Learn)*
>
> **Lab Tuning instrument / Play debrief (after you tune):**
> `Radeon RX 9070 XT · undervolt check — 3 sessions, ~3h`
> • Peak GPU temp **84°C → 71°C** ↓ — real drop (>3 °C), the undervolt is doing its job.
> • 1% low **138 → 141** — frames held (inside the comparison noise floor; no loss).
> • No new stutters; no crash reported.
> → **Holding up so far.** Stability shows over time — keep playing and tell Compy if anything resets.
