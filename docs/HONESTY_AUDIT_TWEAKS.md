# 🔬 Honesty audit — the tweak-debunk corpus (`src/data/tweaks.json`, 84 entries)

> **Owner: the `honesty` lane.** The myth-debunk corpus is Compy's core honesty differentiator (the
> snake-oil-buster). Every entry's `what`/`why` text AND its `verdict` (real / placebo / risky) is
> adversarially fact-checked against authoritative web sources (default-skeptical, try to *refute*).
> This file is the **resumable ledger** for the multi-batch pass — each tick appends a batch, so an
> API-halt never loses progress. Method: [[knowledge-corpus-factcheck-audit]]. Discipline: auto-fix
> CLEAR factual errors (esp. fabricated/unmeasured numbers — Compy's cardinal sin); hand
> verdict-calls to `content`/owner (a *verdict* is a factual claim, not taste — voice and tone are
> ours to call). Never edit from memory —
> web-verify.

Corpus: **84 entries** — 28 `real` · 17 `risky` · 39 `placebo`.

---

## Batch 1 — the 28 `real` verdicts (audited 2026-06-25, 3 adversarial sub-agents, web-verified)

**Headline: CLEAN for the brand — zero false-`real` verdicts, zero blocking factual errors.** All 28
"this tweak genuinely helps" calls are sound. One fabricated-number honesty violation fixed; the rest
are minor precision / wording handed to `content`/owner.

### Fixed by honesty (factual — fabricated/unmeasured number, Compy's cardinal sin)
- **`sysmain-superfetch`** — the `why` claimed *"Frees 0.5–1.5 GB on SSD/NVMe systems."* That specific
  GB range is **fabricated/unsourced**, and it mischaracterizes SysMain's RAM as recovered capacity —
  it's *reclaimable standby cache* Windows already releases on demand. Rewritten to drop the invented
  number and state the real effect (less background disk activity / steadier RAM use), verdict kept
  `real` (storage-gated, harmless). Fixed this tick.

### Handed to `content` / owner (verdict-calls + voice — NOT honesty's to unilaterally rewrite)
- **`power-plan`** (verdict `debatable`) — *"Real responsiveness win mid-game on many rigs"* overstates
  a narrow benefit: independent benches show High/Ultimate mostly helps **1% lows in CPU-bound titles**,
  ~zero in GPU-bound/balanced ones. Suggest softening "win on many rigs" → "frame-time consistency in
  CPU-bound titles." (src: xda-developers Ultimate-Performance benchmarks)
- **`shader-cache-size`** (verdict `debatable`) — *"real against shader-comp stutter, especially in UE5"*
  is **misattributed**: a bigger driver cache helps *re*-compiles (post-update), not first-run UE5
  stutter, whose real fix is the engine's PSO precaching (which the entry's own next line names). Also
  the numeric "unlimited / 10 GB" knob is **NVIDIA-specific** (AMD cache has no size limit). Suggest
  re-scoping to recompile-stutter + noting the vendor specificity. (src: Unreal Engine tech-blog; AMD)
- **`fullscreen-optimizations`** (minor) — "compositor you turn off" is a loose model; FSO is really the
  **flip-vs-blt presentation path** (DWM always composites on modern Win10/11). Verdict sound.
- **`low-latency-mode`** (minor) — "Ultra only helps above refresh" → should be **"when GPU-bound /
  GPU-saturated"** (the real condition). Verdict sound.
- **`upscaling-quality`** (minor) — "LOWER latency than native" is broadly true but over-generalized;
  weaker in CPU-bound titles. Verdict sound.
- **`render-scale`** (minor) — "more frames, every time, on every GPU" is absolute; only true when
  GPU-limited (the entry immediately qualifies it). Verdict sound.
- **Nits** (wording/taste): `fan-curves` ("safest tweak that exists" superlative + unmentioned
  fan-noise trade-off) · `nvidia-reflex` ("click-to-pixel" vs NVIDIA's "click-to-display") · `fps-cap`
  ("~3 below" is a starting heuristic, not a fixed rule) · `mpo-disable` (Win11 24H2 registry-method
  recency caveat) · `laptop-plugged-in-fps` ("a third or more" undersells the real 30–50% swing).

### Verified CLEAN (no issues)
`game-mode` · `msi-mode` · `xmp-expo` · `rebar-sam` · `vrr-sync-stack` · `frame-generation` ·
`game-dvr-off` · `hags` · `diagtrack` · `startup-cleanup` · `driver-updates` ·
`nvidia-prefer-max-performance` · `dual-channel-ram` · `instant-replay-fps` · `set-refresh-rate` ·
`lower-graphics-settings`.

---

## Batch 2 — the 17 `risky` verdicts (audited 2026-06-25, 2 adversarial sub-agents, web-verified)

**Headline: CLEAN for the brand — zero false-`risky` verdicts (every "real danger" call is sound).
Two factual errors in the mechanism text fixed by honesty; the rest minor precision handed to `content`.**

### Fixed by honesty (factual errors — wrong/falsifiable claim, the brand-damage class)
- **`disable-windows-update`** — the `why` read *"modern updates fix game-relevant bugs (fTPM stutter
  was fixed by an update)."* In a sentence about **Windows** Update, that parenthetical **misattributes**
  the AMD Ryzen fTPM-stutter fix, which shipped as a **BIOS / AGESA (V2 PI 1.2.0.7)** update — *not*
  Windows Update (AMD support article; Tom's Hardware; TechPowerUp). Dropped the false example; the true
  general point ("updates regularly fix game-relevant bugs and stability issues") stays. Verdict `risky`
  unchanged. Fixed this tick.
- **`defrag-ssd`** — the `why` claimed Optimize Drives *"gives an SSD a TRIM pass … **not a defrag**."*
  **False as an absolute:** Windows' Storage Optimizer **does** run a real, intentional defrag on an SSD
  ~monthly **when Volume Shadow Copy / System Restore is enabled** (Windows Storage team via Hanselman,
  *"Does Windows defragment your SSD?"* — authoritative, and trivially falsifiable by a knowledgeable
  user). Reworded to: mainly a TRIM pass, *plus an occasional light defrag when System Restore is on*,
  never the heavy write-burning full pass a third-party tool forces. The verdict (skip third-party
  defraggers, leave the built-in schedule alone) survives untouched — only the false premise is fixed.
  Fixed this tick.

### Handed to `content` / owner (verdict-precision + voice — NOT honesty's to unilaterally rewrite)
- **`disable-vbs`** (minor) — *"can cost a few percent CPU"* may understate the measured gaming cost
  (independent benches cite up to ~10–15% on CPUs lacking MBEC/hardware acceleration) and labels a
  gaming/VM-overhead cost as "CPU." NOT auto-fixed: "a few percent" is a conservative hedge, and
  *understating* the gain on a security-loss tweak we discourage is the safe direction — not a
  fabrication. Optional precision tighten only.
- **`disable-defender`** (nit) — *"the measured gain is a rounding error"* is an absolute with a known
  exception (TechPowerUp's Defender × Intel GDS/Downfall-mitigation interaction). Consider "typically
  negligible." Verdict sound.
- **`gpu-overclocking`** (nit) — *"typically buys a few percent"* errs conservative vs the measured
  ~5–15% band — safe direction, no brand risk. Optional only.

### Verified CLEAN (no issues)
`useplatformclock` · `cstates-disable` · `pagefile-disable` · `cpu-mitigations` (the flagged "~0–4%"
gaming figure is honest/well-grounded, not fabricated) · `debloat-scripts` · `anti-lag-plus` (the CS2
VAC-ban story is accurate — Valve/AMD confirmed) · `interrupt-affinity` · `pbo-curve-optimizer` ·
`secure-boot-csm` (Vanguard Secure-Boot/TPM requirement accurate) · `dll-injectors` · `registry-cleaners` ·
`cpu-overclock-fps`.

---

## Batch 3 — the 39 `placebo` verdicts (audited 2026-06-25, 3 adversarial sub-agents, web-verified)

**Headline: CLEAN for the brand — zero fabricated numbers; no factual mechanism errors.** The whole
batch deliberately avoids hard figures (the right instinct). One **verdict-grade** finding (a `placebo`
that the entry's own text describes as measurable) + a handful of "name the real subset" precision
nits — all **verdict/voice calls handed to `content`/owner**, none auto-fixed (honesty fixes facts,
not grades).

### Handed to `content` / owner — VERDICT call (the strongest finding this batch)
- **`timer-resolution`** (verdict `placebo` → likely `risky`) — the entry's OWN `why` describes a
  **measurable, double-edged** effect (*"a minority measure slightly better lows, some measure worse …
  at higher idle power"*) plus a documented Windows-2004 regression where some pre-2020 games hit an
  artificial ~64-FPS cap at the 15.6 ms default tick and **recover** when the timer is raised (Bruce
  Dawson / randomascii — authoritative). `placebo` means "no measurable effect," which contradicts the
  entry's own honest text. Recommend re-grading to `risky` and keeping the `why` near-verbatim (it's
  already framed honestly). **Do NOT adopt the tool-vendor "30%/30–60 FPS" figures** — those sources
  aren't authoritative. This is a verdict change = content/owner territory; flagged, not done by honesty.

### Handed to `content` / owner — precision (name the real subset)
- **`disable-smt-gaming`** (minor) — *"It only ever helped ancient quad-cores"* / *"no measurable win"*
  overshoots: a few CPU-bound titles measurably gain with SMT off on **modern** chips (TechSpot:
  Hitman 2 ~+10%, For Honor ~+3–4%; TPU Zen 5). Net-loss-on-average recommendation is right; soften the
  absolutes to "a per-game test, never a blanket fix."
- **`exclusive-fullscreen-fps`** (minor) — *"near-identical latency"* buries a still-measurable
  competitive-tier input-lag edge for exclusive fullscreen (Reflex-analyzer testing, DX11/CS2). The
  entry's tail already hedges ("where they differ … it's measurable") — pull that into the body.
- **`integrated-graphics-disable-fps`** (minor) — omits the common misassigned-GPU case (a game
  accidentally rendering on the iGPU); the real fix there is forcing the game onto the dGPU, not
  disabling the iGPU. Verdict (placebo) still correct for the normal case.
- **`win32priorityseparation`** (minor) — denies *any* benefit; a contested low-confidence "dirty
  system" 0.1%-low signal exists. Optional carve-out.
- **`game-boosters`** (minor) — the "healthy rig" qualifier mostly rescues it; could add the low-RAM/
  cluttered-rig stutter-reduction subset explicitly.
- **`ram-cleaners`** (minor) — *"the … standby-list stutter bug … was fixed in Windows itself years
  ago"* isn't cleanly documented (no MS changelog; some low-RAM rigs still report it). Soften to
  "modern memory management handles most rigs" rather than asserting a fix. Borderline — not a clear
  falsehood, so not auto-fixed; flagged to content.

### Verified CLEAN (no issues — verdict sound, no fabricated numbers)
`registry-fps-hacks` · `windows-search-off` (gold-standard subset carve-out) · `visual-effects` ·
`mmcss-systemresponsiveness` · `core-unparking` · `tcp-mega-packs` · `aim-tweaks` · `cpu-affinity-games`
(dual-CCD subset correctly credited) · `memory-compression-off` · `app-hw-accel-off` · `dns-for-gaming` ·
`run-as-admin-fps` · `high-priority-games` · `clean-install-windows` · `monitoring-overlay-fps` ·
`monitor-overclock-fps` · `close-background-apps-fps` · `audio-enhancements-fps` · `disable-hdr-fps`
(old GTX-1080-era HDR-cost benchmark is stale; modern native HDR ≈ free — entry accurate) ·
`mouse-acceleration-fps` · `disable-nagle` · `fast-startup-fps` · `wifi-vs-ethernet-fps` ·
`bigger-psu-fps` · `monitor-response-time-fps` · `ram-capacity-fps` (8/16/32/64 GB tiers match 2026
benches) · `pcie-gen-fps` (x8/x4 narrow-lane case correctly carved out) · `motherboard-fps` ·
`bios-update-fps` (the "on its own" qualifier keeps it honest — keep it) · `ssd-fps` (SATA→NVMe ≈ no
FPS still accurate; watch DirectStorage) · `windows-11-vs-10-fps` · `gaming-mouse-dpi-fps` (high-poll-
rate-costs-a-sliver direction is correct).

---

## Corpus audit COMPLETE (all 84 entries, 2026-06-25)

**Brand verdict: CLEAN.** Across 84 entries / 8 adversarial web-verified sub-agents: **zero false `real`
verdicts, zero false `risky` verdicts, zero fabricated numbers surviving.** Three factual fixes landed by
honesty (`sysmain-superfetch` invented GB number · `disable-windows-update` fTPM misattribution ·
`defrag-ssd` "Windows never defrags an SSD" falsehood). One verdict re-grade candidate (`timer-resolution`
placebo→risky) + a set of precision/voice nits handed to `content`/owner (verdict & taste = their
territory). The corpus is honest where it counts.

---

## Rest of the knowledge corpus audited (2026-06-25) — tricks (14) + guides (7) CLEAN

Closing the loop so the WHOLE corpus is on record as honesty-audited (186 entries: 84 tweaks · 81
terms · 14 tricks · 7 guides — the terms count is the 73 from the 2026-06-24 baseline audit + 8
net-new A4-content explainers audited this cycle; see the cross-cutting record below).

- **`tricks.json` (14 snake-oil "tells") — CLEAN.** Every pattern/tell/honest_version is a factually
  accurate characterization of a real deceptive pattern (fake deep scan, invented issue counter, fake
  score, scareware tone, RAM-cleaner, paid driver-updater, tweak-megapack, +X%-no-method, mismatched
  before/after, subscription trap, "secret settings", bundled bloat, testimonial wall, paid one-click
  optimizers). The numbers in them (45-sec scan · "847 issues" · 61→94 score · "+40% FPS") are
  **illustrative characterizations of the SCAMS being called out, not Compy claiming a gain** — so NOT
  the fabricated-number cardinal sin. All category-level (no named product → no defamation risk). The
  honest_versions are sound and self-consistent (e.g. `fps-claim-no-methodology` mirrors Compy's own
  measurement doctrine). No fix.
- **`guides.json` (7 safe appliable guides) — CLEAN, one vendor-precision nit → `content`.** The steps
  for VRR-stack (VRR+V-Sync-On+cap-below-refresh+Reflex = the correct Blur Busters stack), fps-cap,
  startup-cleanup, driver-update, fan-curve, and XMP (concept-not-clicks + CMOS recovery path named
  first) are all procedurally accurate and appropriately cautious. **Nit:** `shader-cache-guide` step 1
  ("find the **Shader Cache Size** setting … set Unlimited / 10 GB") is **NVIDIA-Control-Panel-specific**
  — AMD Adrenalin exposes a shader-cache on/off + Reset, NOT a size knob, so an AMD user (Compy's own
  dev-rig vendor) can't find that setting. Hedged on the "10 GB if fixed sizes" half but not on the
  setting's existence. Vendor-completeness/precision = `content`'s call (guides.json is theirs); not a
  fabrication, so not honesty-auto-fixed.

**Whole-corpus honesty verdict: CLEAN.** 186/186 entries audited; the only factual errors found were
the three tweak fixes above (all landed); everything else is precision/voice/verdict handed to the
owning lane.

---

## Cycle 2026-06-25b — new-entry + new-claim-copy cross-cutting re-audit (honesty standing trigger)

The corpus grew since the 2026-06-24 baseline; the standing trigger re-audited everything net-new.

**8 new term explainers** (terms.json 73→81, verified by an exact `id` set-diff against the
baseline commit `02f9d1b`, NOT by assumption): `human-eye-fps-myth` · `powerline-ethernet` ·
`moca-ethernet` · `keyboard-actuation` · `nkro` · `rapid-trigger` · `amd-undervolting` ·
`effective-sensitivity` — **all audited this cycle.** 7 CLEAN; `rapid-trigger` took one factual fix
(Snap Tap/SOCD is banned in CS2 but **permitted** in Valorant — the "banned in Valorant" claim was
false; reworded, `a4ee40e`). No tweaks/tricks/guides entries were added (84/14/7 unchanged).

**New user-facing CLAIM copy shipped by the other lanes this cycle — independently audited, CLEAN:**
- **network-readiness pills** (backend `network_readiness_pills` + peripheral Latency UI) — every label
  is a read fact (wired=`good`, Wi-Fi=`advisory` never a scare, offline=`unknown`), no fabricated
  number, no FPS-gain promise; the 2.4 GHz "ch 1/6/11 don't overlap" note is the standard-correct
  20 MHz heuristic.
- **wired link-speed pill** (`format_link_rate`) — plain negotiated rate; ≤100 Mbps `advisory` framed
  as "old cable/switch port", never a gaming scare; degrades to "unknown", never prints "0 bps".
- **USB-tier advisory** (peripheral `usb_tier_advisory`) — factually correct (a 1000 Hz mouse isn't
  bandwidth-limited → same polling rate on USB 2.0 as USB4) and names the "which port a device uses
  isn't readable" limit.
- **local percentile display** (measurement) — explicitly "local — your own results, no peer cohort
  yet", a 4-win floor against degenerate small samples, peer/network cohort Phase-C gated.
- **service-drift + recovery guide** (backend `services.rs`) — "no measured FPS" honesty, honest
  origin-uncertainty (only unambiguous drift flagged), by-hand restore steps only (no mutation).
- **OSD/overlay-tools** (backend `overlay_tools.rs`) — "presence is all we honestly know", distinguishes
  "none recognised running" from "the scan didn't run".
- **interrupt-affinity advisory** (peripheral) — verified from the allocated IRQ (not just the
  advertised setting), "usually lowers latency — advisory, reversible", no FPS promise.

**Verdict: CLEAN.** No Rule-5 violation, no fabricated number, no FPS-gain overclaim in any net-new
claim. The one fix (`rapid-trigger` Valorant) had already landed; the rest is honest by construction.

### Surface claim-copy audit (the whole LIVE app, beyond the knowledge corpus) — CLEAN

The app's SURFACES (not just the Learn/Blackbook corpus) have grown a lot since the last full honesty
sweep — hardware grid on the default Home · rig-tier line · confidence chips · the completed readiness
panel · monitor/EDID + network detection · network pills — so this cycle also ran a fresh
**adversarial sweep of the live user-facing claim copy**: 3 parallel skeptic sub-agents over
Readiness/Priorities/rig-tier · Session/Monitoring/Overlay/Benchmark · Home/Setup/Fix/HardwareGrid/
Export, each hunting the 4 cardinal sins (fabricated/unmeasured number · FPS-gain promise · Rule-5
NVIDIA-sensor grading · over-claim in Compy's own voice) and **web-verifying every numeric/factual claim**.

**Verdict: CLEAN — zero BLOCKING, zero MINOR.** Every number traces to a measured fact or a named
static spec; advisories hedge ("may help / if you feel it / not guaranteeing FPS") instead of
promising; **Rule-5 is actively enforced** (every GPU-temp grade routes through
`gradeGpuTempForVendor`, NVIDIA→neutral; raw CPU/GPU utilization stays neutral at all 5 render sites);
the 1%-low is labelled an estimate everywhere; rig-tier and benchmark-tier return `null` rather than
fabricate; Export is literally "Measured, not promised". Web-verified accurate: VRR pacing/tearing ·
2.4 GHz ch 1/6/11 · dual-channel gain · GPU thermal ramp 75/85 °C · Reserved-Storage ~7 GB baseline.

**3 NITs flagged to the owning lanes (voice/precision = their territory, NOT honesty's to rewrite):**
- `src/data/friendly-labels.ts:49` / `src/data/rec-mutations.ts:51` — *"Reclaim **~7–10 GB** on your C:
  drive"* is the one hard-coded numeric range stated as fact (not read from the rig). Microsoft Reserved
  Storage is ~7 GB baseline, typically 3–7 GB reclaimable; the 10 GB high end is plausible-but-optimistic.
  Hedged with "~", not an FPS claim → NIT. Suggest "~7 GB" / "several GB" to be strictly defensible.
- `src/data/metric-grade.ts:67` `gradeGpuTempC` uses a FIXED 75/85 °C ramp while the grading system is
  sold app-wide as "tailored to your hardware" — GPU-temp is the one metric not rig-derived. Thresholds
  are factually sound (web-verified) so it's a framing NIT, not a fabrication. → measurement/owner.
- `src/surfaces/Check.tsx:418` AMD undervolt nudge *"…cooler and quieter, **with frames held**"* states a
  near-certainty before this rig measured it. Advisory + AMD-gated + points to a Learn guide (no one-click
  apply) → defensible NIT, owner eyeball.

Also audited backend's **`32146bc` service-inventory expansion** (Riot Vanguard `vgc` · GOG Galaxy ·
NVIDIA Container) — **CLEAN**: faithful DisplayName-paraphrase facts (Vanguard = Valorant/LoL
anti-cheat that loads at startup · NvContainer hosts GeForce Experience / NVIDIA App tasks · GOG
Galaxy platform service), all web-accurate, inventory-not-advice (no safe-to-suspend judgement, no
FPS claim).

**Bottom line: the live surface is honest where it counts** — the only forward-leaning copy is three
hedged/gated NITs, and the one hard-coded number (the cleanup estimate) is roughly accurate, not a
fabricated performance claim.
