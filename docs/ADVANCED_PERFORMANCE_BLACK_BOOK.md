# Compy — Advanced Performance Black Book

**Status:** RESEARCH + FEATURE DESIGN (2026-06-02). **Advisory / educational only.** Nothing in this
document is auto-applied by Compy and **none of it changes the frozen recommendation catalog.** This is
the gated "informed-adults" annex: the deeper, riskier tuning the *front of Compy deliberately refuses
to do for you*, written down honestly so the user who insists on going further does it with eyes open —
**at their own discretion, with Compy taking no responsibility for manual changes made at this level.**

> **Why this exists.** Compy's whole identity is *rollback-first, safe, for-YOUR-hardware*. The front
> end swears against sketchy tweaks because the standard outcome is: watch one YouTube video → apply ten
> "ultimate FPS" registry edits at once → turn an optimization venture into a **diagnostic-loop / BSOD
> speedrun.** But some advanced users genuinely want the deeper step. The honest move isn't to pretend the
> deep settings don't exist — it's to (a) tell the truth about which actually help, (b) label real risk,
> (c) gate access behind earned trust + explicit consent, and (d) make clear the user owns the outcome.

---

## Part 0 — How to read this (the risk/gain taxonomy)

Every entry is scored on two axes. **Read the verdict, not the hype.**

**Gain** — honest, real-world, on a *modern* (last ~4 yr) gaming PC:
- 🟢 **Real** — measurable FPS / latency / stutter improvement most people will get.
- 🟡 **Situational** — helps specific hardware / titles / scenarios; null elsewhere.
- ⚪ **Negligible/Placebo** — within run-to-run variance; "feels faster" ≠ "is faster."

**Risk** — chance of breakage, instability, security/anti-cheat exposure, or irreversibility:
- ✅ **Safe** — reversible toggle, no downside.
- ⚠️ **Caution** — reversible but can cause issues on some setups; test it.
- 🛑 **Sketchy** — security/anti-cheat/stability/data risk; the "no-no zone." Advisory only.

**The five golden rules (these are non-negotiable even in the Black Book):**
1. **One change at a time.** Bundling tweaks makes a regression impossible to diagnose — this *is* the diagnostic loop.
2. **Restore point + note first.** `Create a restore point` before any BIOS/registry/driver-profile session; write down what you changed and the date.
3. **Measure, don't vibe.** Use **PresentMon / CapFrameX / NVIDIA FrameView** (avg + **1% and 0.1% lows** + frametime graph), not "feels smoother." Most "huge boosts" vanish under measurement.
4. **Reversible-only by default; irreversible needs a reason.** Prefer toggles you can flip back. Flashing firmware, deleting partitions, etc. are a different category.
5. **Anti-cheat first.** Many "optimizations" (DLL injectors, some driver hacks, kernel tweaks, debug toggles) get you **banned**, not boosted. If a tweak touches game memory, timers, or drivers in a non-standard way, assume anti-cheat risk until proven otherwise.

---

## Part 1 — Windows services, telemetry & process debloat

**Reality check:** debloating reclaims **~0.5–1.5 GB idle RAM** and trims background CPU spikes + boot
time. It does **not** add double-digit FPS. The win is *fewer stutters from background work mid-game* and a
leaner idle, not raw throughput. All of this is **reversible** (services → set back to default start type;
restore point covers the rest). 🟡 **Situational gain · ✅ Safe** *if* you respect the keep-list.

### Safe-to-disable on a single-user, non-managed gaming PC
| Service | What it does | Disable verdict | Notes |
|---|---|---|---|
| **DiagTrack** (Connected User Experiences & Telemetry) | Sends usage/diagnostic data to MS | 🟢✅ disable | No effect on Update/apps/stability. The cleanest win. |
| **SysMain** (Superfetch) | Preloads apps into RAM | 🟡✅ disable **on SSD/NVMe** | Frees 0.5–1.5 GB; preload benefit is near-zero on fast storage. **Keep on HDD.** (Compy already gates this on storage type.) |
| **Diagnostic Policy Service / dmwappushservice** | Diagnostics plumbing | 🟢✅ disable | Telemetry-adjacent. |
| **Delivery Optimization** | P2P update sharing | 🟡✅ set Manual | Stops background upload bandwidth; keep Manual so Update still works. |
| **Print Spooler** | Printing | 🟢✅ disable **if no printer** | Also closes a historically CVE-heavy surface. Re-enable to print. |
| **Fax / Remote Registry / Windows Search** | Legacy / indexer | 🟡⚠️ situational | Search-off helps low-RAM/HDD but breaks Start-menu search-as-you-type. Compy gates Search on HDD only. |
| **Xbox services** (when not used) | Game Bar / Live | ⚠️ **leave alone if you use Game Pass / Game Bar / some launchers** | Breaking these breaks Game Pass installs + some overlays. |

### Telemetry / startup / scheduled tasks (reversible)
- **Startup apps:** Task Manager → Startup → disable vendor bloat (RGB suites, updaters, Cortana-likes). Biggest *felt* boot-time win.
- **Scheduled tasks:** the telemetry tasks under `\Microsoft\Windows\Customer Experience Improvement Program\` and `\Application Experience\` are safe to disable; **don't** touch Defender/Update/maintenance tasks.
- **Tools that do this reversibly:** O&O ShutUp10++ (checkbox toggles), Win11Debloat / Chris Titus WinUtil (scripted, has an undo path). *Educate, don't bundle-run blind.*

### 🛑 The debloat no-no zone
- **Disabling Windows Defender** — hard **NO** (anti-cheat + obvious security). 🛑
- **Removing Microsoft Store / Windows Update entirely** — breaks Game Pass, anti-cheat updates, security patches. Pause/control updates instead. 🛑
- **Nuking WinSxS / "tiny11"-style image stripping** — irreversible, breaks future updates. 🛑
- **"Disable ALL services" lists** — breaks audio, networking, launchers, anti-cheat. The classic diagnostic-loop trigger. 🛑

---

## Part 2 — Windows OS-level performance settings

### Genuinely worth it (safe-ish)
| Setting | Gain | Risk | Verdict |
|---|---|---|---|
| **Power plan → High/Ultimate Performance** (existing plan) | 🟡 | ✅ | Stops idle downclock/parking mid-game. Switching to an *existing* plan is non-elevated. (Compy's Gaming Mode core.) |
| **Game Mode ON** | ⚪–🟡 | ✅ | Modern Game Mode helps low-core CPUs/streaming a little; harmless. |
| **Game Bar / Game DVR / background recording OFF** | 🟡 | ✅ | Removes capture overhead some users never wanted. Real on weaker rigs. |
| **Hardware-Accelerated GPU Scheduling (HAGS)** | 🟡 | ⚠️ | Can lower latency / help frame-gen on modern GPUs; **needs reboot**, occasionally regresses — test with/without. |
| **Visual effects → best performance** (or selective) | ⚪–🟡 | ✅ | Frees a little GPU/compositor work; *visible* UI change (jarring), so not session-toggle material. |
| **MPO (Multi-Plane Overlay) disable** (`OverlayTestMode=5`) | 🟡 | ⚠️ | A *legitimate fix* for a real, widespread flicker/stutter bug on some multi-monitor/G-Sync setups. Only do it **if you have the symptom.** Reversible registry value. |
| **Storage Sense / Reserved Storage off** | ⚪ | ✅ | Frees disk, irrelevant to FPS. |

### 🔬 The debunk shelf (mostly ⚪ placebo — included so you stop chasing them)
- **HPET disable / `bcdedit useplatformclock` / forcing TSC / 0.5 ms timer resolution:** **hardware-dependent and inconsistent.** On a healthy modern system there's usually **no benefit**; a minority of boards see better 0.1% lows, a minority get *worse*. If you must, change **one** value, benchmark with PresentMon, and **revert if it isn't clearly better.** Most "10–20% from disabling HPET" claims don't survive controlled measurement. ⚪/🟡 ⚠️
- **MMCSS `SystemResponsiveness=0` / `Games` GPU Priority=8:** trivial registry edit, ⚪ effect on modern Windows; harmless but pointless for most.
- **`Win32PrioritySeparation` foreground boost:** ⚪ on modern schedulers.
- **Disabling C-States in BIOS for "consistency":** **myth — keep C-States ON.** Modern boost algorithms reuse the freed power budget to clock *active* cores higher; disabling them raises heat and *lowers* boost. 🛑-for-perf (it hurts).
- **Pagefile disable / fixed tiny pagefile:** can hard-crash games that rely on commit; **leave system-managed.** 🛑
- **"Ultimate" all-in-one tweak scripts:** the single biggest cause of instability. The opposite of optimization.

---

## Part 3 — NVIDIA deep driver settings (Control Panel + NVIDIA App)

*Set conservative **Global** defaults, then make **per-game Program Settings / NVIDIA App per-game**
profiles. The NVIDIA App (2024+) now hosts most of these alongside the classic Control Panel; both coexist.*

| Setting | What it actually does | Recommendation |
|---|---|---|
| **Power Management Mode** | Prevents GPU downclocking | **Prefer Maximum Performance** per competitive game (tiny idle power/temp cost). "Optimal Power" fine globally. |
| **Low Latency Mode (LLM)** | Caps the CPU→GPU render queue | **On** = good default. **Ultra** only if you're consistently GPU-bound *above* refresh. **Off when the game has Reflex** (Reflex supersedes it and they conflict). |
| **NVIDIA Reflex** (in-game) | True low-latency, syncs render to input; compensates frame-gen lag | **On / On+Boost** wherever offered. This is the real latency win, not NCP LLM. |
| **Vertical Sync (in NCP)** | Tear control | With a VRR display: **G-SYNC On + V-Sync On (in NCP) + frame cap below refresh** → tear-free *and* low-latency (see Part 5). Without VRR competitively: Off + cap. |
| **Max Frame Rate** | Driver FPS cap | Cap **~3 fps below refresh** on VRR (e.g. 141 on 144 Hz) to stay in G-Sync range and avoid V-Sync backpressure. |
| **DLSS 4 / Multi-Frame-Gen (MFG)** | AI upscaling (+ generated frames) | **Quality/Balanced upscaling = free real FPS + lower latency than native.** **Frame-gen/MFG → single-player only** (it *adds* latency; don't use competitively). |
| **DLDSR** | AI downsample for sharper image | Single-player image quality on headroom-rich rigs. |
| **Image Sharpening** | Post sharpen | 0 native (or ~0.2 subtle); ~0.5 to recover upscaler softness. |
| **Texture Filtering – Quality** | AF quality vs speed | "High Performance" → tiny FPS, near-invisible diff. **Anisotropic 16x** is cheap and worth it for clarity. |
| **Threaded Optimization** | Multi-thread driver | **Auto/On** (a few old engines prefer Off). |
| **Shader Cache Size** | On-disk shader cache | **Unlimited / 10 GB** — reduces shader-comp stutter. |
| **Vulkan/OpenGL present method, "Optimal"** | Fullscreen path | Default Optimal; flip if a specific title misbehaves. |

**NVIDIA per-genre starting profiles** (override Global):
- **Competitive FPS (Valorant/CS2/OW2/Fortnite):** Reflex On+Boost · LLM Off (Reflex owns it) · Power Max Perf · G-Sync+VSync+cap (or Off+cap if chasing absolute frames) · DLSS upscale OK, **MFG/frame-gen OFF** · sharpening to taste.
- **Cinematic / RPG (Cyberpunk, Alan Wake 2, BG3):** DLSS Quality + **Frame Gen ON** · DLDSR if headroom · AF 16x · sharpening ~0.3 · G-Sync+VSync+cap.
- **UE5 open-world (Stalker 2, Wukong, Hellblade 2):** see Part 6 — cap FPS, pre-compile shaders, DirectStorage, expect engine-side stutter.

---

## Part 4 — AMD deep driver settings (Adrenalin)

*Per-game tab in Adrenalin → pick the title → override globals.*

| Setting | What it actually does | Recommendation |
|---|---|---|
| **Radeon Anti-Lag** (driver) / **Anti-Lag 2** (in-game integrated) | Shrinks the render queue for lower input lag | **Use Anti-Lag 2 where the game integrates it.** ⚠️ **Critical:** the *old driver-level* **Anti-Lag+ got players anti-cheat-banned (VAC) in CS2** — never use a driver-injected latency hack in an anti-cheat game; Anti-Lag 2 is the safe, game-integrated successor. |
| **Radeon Chill** | Dynamic FPS based on movement | Power/heat saver for laptops/menus. **Off for competitive** (adds latency) and it **can't run with Anti-Lag.** |
| **Radeon Boost** | Drops resolution during fast motion | Situational FPS in motion; slight clarity cost. |
| **Frame Rate Target Control (FRTC) / cap** | FPS cap | Use this for your VRR cap (a few below refresh). |
| **Enhanced Sync** | Tear-free w/o V-Sync latency when FPS>refresh | AMD's Fast-Sync analog; good when you exceed refresh on a non-VRR panel. |
| **Image Sharpening (RIS)** | Post sharpen | ~10–20% native; ~70–80% to recover FSR/RSR softness. |
| **Radeon Super Resolution (RSR)** | Driver-level upscaling (any game) | Use ≥77% (Quality-ish); auto-pairs with sharpening. **FSR 4 (in-game, RDNA4 ML)** is far better where supported. |
| **AFMF 2** (driver frame-gen) | Driver-level frame generation | 🟡 single-player smoothness; **off competitively** (latency). Improved pacing in v2 but still not Reflex-class. |
| **Smart Access Memory (SAM)** | AMD's Resizable BAR | **Enable** (BIOS + driver) — small real gains in some titles. |
| **Surface Format Optimization / Tessellation / Texture Filtering Quality** | Misc quality-vs-speed | Defaults fine; AMD-optimized tessellation can claw back FPS in over-tessellated titles. |

**AMD per-genre starting profiles:**
- **Competitive:** Anti-Lag 2 (in-game) · Chill **off** · cap below refresh · FreeSync+Enhanced Sync/V-Sync per panel · **no AFMF**.
- **Cinematic:** FSR 4 Quality + (optional AFMF 2) · RIS ~20% · FreeSync on.
- **Latency note:** in testing, **Reflex 2 compensates frame-gen latency better than Anti-Lag 2** (~18% lower latency on average), so on AMD lean harder on "no frame-gen for competitive."

---

## Part 5 — The latency & sync stack (the "feel")

This is where most real *felt* improvement lives — and it's **safe.**

- **The optimal VRR config (Blur Busters consensus):** **VRR on (G-Sync/FreeSync) + V-Sync ON in the driver + an FPS cap ~3 fps below refresh + Reflex/Anti-Lag 2 on.** Result: tear-free **and** low-latency, because the cap keeps you inside the VRR window so V-Sync never engages its backpressure.
- **Competitive, chasing absolute minimum latency on a high-Hz panel:** some pros run **V-Sync off + uncapped/high cap + Reflex** and accept minor tearing. Personal preference; measure it.
- **Frame generation honesty:** frame-gen raises *displayed* FPS but **adds input latency** and can add artifacts. Great for single-player smoothness on a big TV; **bad for click-to-pixel competitive response.** Reflex/Anti-Lag claw *some* of it back, not all.
- **Upscaling honesty:** quality-mode DLSS4/FSR4/XeSS2 usually gives **more real FPS *and* lower latency** than native — it's the rare free lunch. Frame-gen is the part with the latency asterisk.
- **Monitor-side:** correct refresh rate selected, VRR enabled in OSD, overdrive at the vendor-recommended (not "extreme" if it ghosts), and the right cable/port for full bandwidth.

---

## Part 6 — Per-game / per-engine profile matrix

The biggest per-game wins are usually **engine-aware**, not magic driver flags:

- **UE5 titles (Stalker 2, Black Myth Wukong, Hellblade 2, many 2024–26 releases):** the stutter is mostly **engine-side** (shader-compilation + traversal streaming). User-side mitigations: **let the game pre-compile shaders fully** (don't skip the screen); enable **DirectStorage** + use an **NVMe**; **cap FPS** (reduces traversal hitching); drop **Lumen/shadows/VSM** a notch (heavy CPU); DX12. UE 5.6's Fast-Geo Streaming + PSO precaching help where devs adopt them — you can't fix it fully from the driver.
- **Competitive esports (CS2, Valorant, OW2, Apex, Fortnite):** CPU-bound; the wins are **Reflex/Anti-Lag 2 + frame cap + max-perf power + clean background (debloat) + a real high-Hz panel**, *not* upscaling/frame-gen. Keep anti-cheat happy.
- **Sim / strategy / 4X (CPU-bound):** power plan + memory speed (XMP/EXPO) + background hygiene matter more than the GPU panel; frame-gen rarely helps a CPU-bound title.
- **Emulators (RPCS3, modern Switch/▮ emus):** very flag-specific — vendor "Vulkan present", shader-cache size, sometimes specific compatibility toggles; treat per-emulator docs as the source of truth.
- **The principle Compy should encode:** detect the **engine + whether the title is competitive or cinematic + CPU- vs GPU-bound**, then suggest the matching *profile shape* above — never a blind global preset.

---

## Part 7 — 🕳️ THE BLACK BOOK (advanced / risky · advisory only)

> **You are leaving the safe zone.** Everything below is for users who *insist* on the deeper step.
> Compy will **never auto-apply any of this.** Read each verdict. Restore point first. One at a time.
> **You own the outcome.**

### 7a — BIOS / UEFI
| Tweak | Claimed | Real | Risk | Verdict |
|---|---|---|---|---|
| **XMP / EXPO** (RAM profile) | "free speed" | 🟢 real (memory-bound games, 1% lows) | ⚠️ can fail to POST; clear CMOS to recover | **Do it** — the #1 low-risk BIOS win. Test stability (memtest). |
| **Resizable BAR / SAM** (+ Above 4G Decoding) | "+25%!" | 🟡 real in *some* titles (a few %, occasionally big), can regress a few | ⚠️ enable Above-4G first; rare title regressions | **Enable + measure**; disable per-title if a game regresses. |
| **PBO / Curve Optimizer** (AMD) | "more boost" | 🟡 real sustained clocks; CO undervolt = cooler+faster | 🛑 instability if over-pushed; needs hours of stability testing | Advanced only. Small steps, stress-test, expect a few crashes while dialing. |
| **fTPM** | required | n/a | ⚠️ old fTPM firmware caused **stutter** on some AM4 boards | Keep TPM **on** (Win11/anti-cheat need it); update BIOS if you get the fTPM stutter. |
| **C-States** | "disable for consistency" | ⚪ **myth — leave ON** | hurts boost/heat if off | **Leave enabled.** |
| **Fan curves / thermal headroom** | quieter/cooler boost | 🟡 real (thermal-throttled rigs boost higher when cooler) | ✅ | Tune a sane curve; the safest "performance" BIOS change. |
| **Secure Boot / CSM** | anti-cheat needs Secure Boot | n/a | ⚠️ toggling can affect boot/anti-cheat (Valorant Vanguard etc.) | Match your anti-cheat's requirement; know how to recover. |

### 7b — Deep Windows "no-no zone"
| Tweak | Real gain | Risk | Verdict |
|---|---|---|---|
| **Disable CPU mitigations** (Spectre/Meltdown) | ⚪ ~0–4% for *gaming* (the big numbers are GPU-compute/server) | 🛑 **real security downgrade** | **Not worth it.** Advisory: the FPS rounding-error isn't worth opening known side-channels. |
| **Forcing MSI mode / interrupt affinity / IRQ priority** | ⚪ negligible on modern setups | 🛑 registry-deep; can break devices | Skip unless diagnosing a specific DPC-latency problem with tools. |
| **Core unparking / forcing all cores active** | ⚪ (same family as the C-States myth) | ⚠️ worse boost/heat/efficiency | Modern Windows already manages this. Skip. |
| **Forcing 0.5 ms timer resolution globally** | ⚪/🟡 inconsistent | ⚠️ higher idle power, can hurt some titles | Test with PresentMon; revert if not clearly better. |
| **Network tweaks** (disable Nagle / `TcpAckFrequency`, RSS/RSC off) | 🟡 tiny latency in a few titles | ⚠️ can break VoIP/VPN/some apps | Compy already exposes Nagle as *advisory*. Per-NIC, reversible, marginal. |
| **Disabling Defender / pagefile / Windows Update** | "more FPS/RAM" | 🛑🛑 security + crashes + anti-cheat | **Never.** This is the bottom of the no-no zone. |
| **Third-party "debloat/ISO" rebuilds, kernel-mode tweak tools, DLL injectors** | varies | 🛑 **anti-cheat bans + irreversible + malware vector** | Educational warning only — these are how people brick installs and lose accounts. |

**The Black Book's one-sentence thesis:** *past XMP/EXPO, ReBAR, fan curves, and the latency/sync stack,
the curve flattens hard — you trade single-digit (or imaginary) percentages for real risk, and the people
who chase it hardest are the ones who end up reinstalling Windows.*

---

## Part 8 — Trust-gated access design (how Compy surfaces this safely)

The Black Book must be **hard to stumble into and easy to leave**, consistent with Compy's promise. Design:

1. **Hidden by default. Earned, not advertised.** No Black Book entry point on first run. It unlocks only
   after the user has **built a track record with Compy** — a *trust score* derived from real, local,
   already-tracked signals (no new telemetry), e.g.:
   - N successful **apply → verify → (optionally) rollback** cycles from the safe catalog (they understand reversibility),
   - account age / sessions with Compy (sustained use, not a fresh install),
   - completed onboarding + read the safety explainer,
   - no recent "applied 10 things then rage-rolled-back everything" thrash pattern.
   The point isn't gatekeeping for its own sake — it's a **proxy for "this user has demonstrated they
   tweak carefully and know how to undo things."**
2. **Explicit, multi-step opt-in.** When eligible, Compy surfaces an *option* (never a nag): *"You've
   used Compy safely for a while. Want to unlock the Advanced Black Book — deeper, riskier tuning we
   normally refuse to touch?"* → a **knowledge/consent gate**: a short plain-English acknowledgment screen
   (what "advisory only" means, that these are manual, that Compy won't apply or roll them back, that
   the user owns the outcome) requiring an explicit, typed-or-checkbox confirmation. Re-confirmed on each
   major version.
3. **Advisory-only forever — no apply button.** The Black Book **never** gets an "Apply" affordance.
   It **educates and links out** (open the relevant Windows/NVIDIA/AMD/BIOS UI via the existing
   allowlisted deep-link pattern at most) — it does **not** mutate. This keeps it outside the frozen
   mutation catalog and outside the rollback engine entirely. The catalog stays frozen; this is content.
4. **Per-entry honesty UI.** Every entry shows its **Gain/Risk badges + the honest verdict + reversibility
   note** *before* any instructions — the verdict leads, the how-to follows.
5. **Liability framing, visible and persistent.** A standing banner on the Black Book surface (Part 9).
6. **One-click "take me back to safe."** The exit is always one tap; the Black Book is a side-room, not a
   new default mode. Nothing about unlocking it changes how the rest of Compy behaves.

*(Implementation note: this is a future, gated, **read-only/advisory** surface. It needs no new mutation
primitive and no catalog change. If/when built it gets its own small design pass — it does not block or
alter F1 Gaming Mode or anything shipped.)*

---

## Part 9 — Liability / disclaimer (draft copy)

> **Advanced Black Book — read before you continue.**
> These are **advanced, optional, manual** tweaks. Compy does **not** apply them, does **not** monitor
> them, and **cannot roll them back** for you. Some carry real risks: instability, boot failure, data loss,
> reduced security, or **anti-cheat bans**. Gains beyond the basics are often small or hardware-specific,
> and many popular "tweaks" do nothing measurable. **You are choosing to make these changes yourself, at
> your own risk. Compy and its authors accept no responsibility for any outcome of changes you make
> based on this material.** Create a restore point, change one thing at a time, measure with PresentMon /
> CapFrameX, and keep notes so you can undo anything. *If in doubt — don't.*

*(Not legal advice; final disclaimer wording belongs in the EULA pass alongside the public-release legal gate.)*

---

## Sources (verification, June 2026)
- NVIDIA Control Panel / latency: [Switchblade — NVCP best settings 2026](https://www.switchbladegaming.com/game-settings/nvidia-control-panel-best-settings-gaming-2026/) · [NVIDIA — System Latency Optimization](https://www.nvidia.com/en-us/geforce/guides/gfecnt/202010/system-latency-optimization-guide/) · [NVIDIA Reflex](https://www.nvidia.com/en-us/geforce/news/reflex-low-latency-platform/)
- AMD Adrenalin: [Switchblade — Radeon best settings 2026](https://www.switchbladegaming.com/game-settings/amd-radeon-software-best-settings/) · [AMD — Customize Graphics (Adrenalin)](https://www.amd.com/en/resources/support-articles/faqs/DH3-012.html)
- Frame-gen / upscaling / latency: [DropReference — DLSS4 vs FSR4 2026](https://dropreference.com/en/blog/guide/dlss-4-vs-fsr-4-comparison-2026) · [BottleneckPC — DLSS 4.5 MFG](https://bottleneckpc.com/blog/dlss-4-5-multi-frame-gen-explained) · [BottleneckCalc — Frame-gen latency](https://bottleneckcalculator.us.com/knowledge-base/gaming-performance/frame-generation-impact/)
- Services / debloat: [XDA — services with zero downsides](https://www.xda-developers.com/i-disabled-these-5-windows-11-background-services-and-saw-zero-downsides/) · [Win11Debloat (GitHub)](https://github.com/Raphire/Win11Debloat) · [perfgamer — safe debloat for gaming](https://www.perfgamer.com/how-to-safely-debloat-windows-11-for-better-gaming-performance/)
- Tweak myths: [Melody's Tweaks — timer misconceptions](https://sites.google.com/view/melodystweaks/misconceptions-about-timers-hpet-tsc-pmt) · [TweakHound — timer tweaks benchmarked](https://www.tweakhound.com/2014/01/30/timer-tweaks-benchmarked/) · [Blur Busters forums — HPET/latency testing](https://forums.blurbusters.com/viewtopic.php?t=10964)
- BIOS: [XDA — BIOS settings I tweak](https://www.xda-developers.com/x-biosuefi-settings-i-tweak-for-better-performance/) · [Club386 — essential BIOS settings](https://www.club386.com/essential-bios-settings/) · [MakeUseOf — PBO](https://www.makeuseof.com/bios-setting-limiting-your-amd-cpu-performance/)
- Mitigations: [Schneier — Ubuntu disables Spectre/Meltdown](https://www.schneier.com/blog/archives/2025/07/ubuntu-disables-spectre-meltdown-protections.html)
- UE5 stutter: [Unreal — engines & shader stuttering](https://www.unrealengine.com/tech-blog/game-engines-and-shader-stuttering-unreal-engines-solution-to-the-problem) · [80.lv — UE5 shader stutter](https://80.lv/articles/epic-games-devs-on-solutions-to-unreal-engine-5-shader-stuttering-issues)
