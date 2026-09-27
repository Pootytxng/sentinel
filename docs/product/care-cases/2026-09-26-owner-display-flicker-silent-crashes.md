# Care real case 1: display flicker and silent crashes (owner rig, 2026-09-26)

> **Evidence, not authority.** This records one real diagnosis so Care work has a concrete case to be
> measured against. It changes no roadmap, gate or product law; disposition belongs to the next
> roadmap point. Source: issue #590. Status: **open** until the 7-day outcome below is filled in.

## What this case is, and what it is not

On 2026-09-26 the owner ran a full PC-health investigation on his own rig through a Cowork session.
Compy did not run. It is the first end-to-end Care journey
([CARE_ENGINE.md](../CARE_ENGINE.md) §1, questions 1–6) done by hand on real hardware. His words:
*"this is quite literally all stuff that pertains directly to what my project compy is suppose to be
capable of managing for a user."*

- It **is** a real problem case of the kind [VALIDATION.md](../VALIDATION.md) §2 asks for, and a
  benchmark for what Care has to reach.
- It **is not** evidence that Compy works. It does not count toward the VALIDATION §3 threshold
  (Compy materially narrowing roughly 7 of 10 cases), because Compy took no part in it.
- It is one machine. Do not generalize its readings to other hardware.

## Constitutional fit: read before building from this case

The manual session was free to do things Compy may not. A lane that builds from this case keeps
these lines:

- **MPO disable is permanently blocked.** The session turned off multi-plane overlay (MPO) as an
  owner-run experiment. MPO disable is on the permanent tweak blocklist
  (`.claude/rules/tweak-catalog.md`; `CLAUDE.md` locked rule 6), and measurement does not make it
  safe. Compy may read MPO state and explain the tradeoff. It may not apply the change. It can
  restore MPO to the Windows default (`actions.rs`, "MPO: restore default-on").
- **One mutation boundary.** The session shipped standalone undo scripts. In Compy every change goes
  through `src-tauri/src/actions.rs` with snapshot, apply, verify, receipt and rollback. Loose
  scripts are not a Compy pattern.
- **Vendor lookups are outbound.** "Is this BIOS/driver current?" was answered from MSI, AMD and
  Crucial pages. In Compy that knowledge arrives through the Tier 1 signed advisory channel, never by
  uploading machine data.
- **Unknown stays unknown.** Temperatures and SMART detail were unavailable without elevation or a
  sensor driver. They stay unknown, never estimated.
- **Stop points stay owner-bound.** BIOS flash, cable swaps and blocklisted changes are the user's
  hands. See "Where the tool must stop" below.

## The machine (measured, not assumed)

Ryzen 7 9850X3D · MSI MPG X870E Carbon WiFi (MS-7E49) · RX 9070 XT, Adrenalin 26.8.1 · 32 GB DDR5-6000
EXPO · Crucial P510 1 TB Gen5 NVMe · Win11 Home 25H2 26200.8457 · Monitors: Acer XFA253Q Z 1080p at
240 Hz over DP (primary), ASUS VG245 1080p at 75 Hz over HDMI · PSU Montech Century II 1050 W ATX 3.1.
GPU link Gen5 x16, NVMe Gen5 x4. Every Windows read was non-admin except `Get-StorageReliabilityCounter`
(SMART detail), which needs elevation. CPU and GPU temperatures were unobtainable without a sensor
driver.

## Stated symptom vs. what the evidence showed

**Stated:** monitors briefly blank and return (first the secondary, then the primary), and a fast
white-line flicker on the primary. The owner suspected drivers, shader cache or chipset.

**Found** (System, Application and Kernel-PnP logs, 30–90 days):

- 0 GPU driver resets (Event 4101), 0 WHEA/PCIe errors, 0 monitor re-enumerations on the incident
  days. Supported inference, not proven: the blackouts happen below Windows' view (the display link
  layer), because the driver logged nothing.
- 4 unexpected shutdowns the owner had **not** mentioned: 08/10 BSOD 0x7E; 08/29 hard power-off,
  bugcheck 0 (no BSOD); 09/09 and 09/14 BSOD 0x7A KERNEL_DATA_INPAGE_ERROR, with **no dump written**
  either time.
- 6 Resource-Exhaustion 2004 events (09/02–09/08): firefox.exe at 92–112 GB commit each time, with
  Firefox hardware acceleration disabled (`layers.acceleration.disabled=true`).
- Setting drift: `TdrDelay=10`; SysMain, WSearch and DiagTrack disabled; an MMCSS start error every
  boot. A debloat or tweak script had run at some point.
- The owner had reinstalled the same Adrenalin version 3.5 hours earlier. A change with no effect is
  exactly what a "what changed?" view should surface.
- Versions against vendor truth: Adrenalin 26.8.1 was the current WHQL; chipset 8.08.12.551 current;
  P510 firmware current; **BIOS 1.A95 was four releases behind** (latest 1AA7, AGESA 1.3.0.1d).
  Windows Update was offering an AMD display driver (32.0.31044.16) with no published AMD release
  notes.
- The owner could not recall his own earlier BIOS undervolt (Curve Optimizer). An aggressive Curve
  Optimizer setting is a textbook cause of this crash shape (bugcheck-0 restarts, random BSODs).

## What Care would have had to do (mapped to CARE_ENGINE.md)

| § | Care requirement | What the manual session did |
|---|---|---|
| 1 | What happened? | Decoded Kernel-Power 41 bugcheck codes (decimal to hex) into plain English; correlated events 6008, 41, 1001 and 2004. |
| 3 | What changed? | Driver reinstall the same day; BIOS age against the CPU launch date; Firefox commit spikes 1–7 days before crashes; a prior undervolt that was never recorded, so unknown. |
| 2 | Evidence hierarchy | Observed facts (events, versions), supported inference (display link errors; undervolt as crash cause), external case intelligence (MSI, AMD, Crucial and a PSU review, each attributed), unknown (temperatures, Re-Size BAR state, FCLK). |
| 4 | One next action | A short ordered plan: MPO off first, cable swap second, 7 days at stock CPU, MemTest only if crashes recur. Not a list of ten fixes. The BIOS flash, stock CPU and MPO change still landed on the same day (see Outcome tracking). |
| 5–6 | Recovery / known-good | Every change had its undo. The BIOS flash was framed as owner-only with pre-flight guardrails: photograph the OC pages, expect EXPO to reset, check Device Encryption first (recovery-key trap). |
| 7 | Presentation | The summary led with the finding he did not ask about (silent crashes) and stated calibrated confidence ("BIOS: medium, not certain"). Raw IDs stayed in the written report. |
| 9 | Anti-goals | Not an event-log dump: about 15 targeted queries, with the absence of events used as evidence. Not a causal-claim generator: every cause labeled ranked or unverified. |

## Trust moments worth designing for

1. The owner asked **"are you absolutely sure?" twice** (whether the BIOS update was needed; whether
   the BIOS file was the right one). What worked: state the confidence level, name what is and is not
   verified, and offer the cheaper evidence step (MemTest first) as an alternative. Confidence theater
   would have failed.
2. Trust in the BIOS file came from **three independent confirmations**: the board ID from WMI, MSI's
   own support feed (version, date, URL, size), and the release note inside the zip naming MS-7E49.
   The verification, not the download, was the product.
3. **The owner keeps no notes.** He forgot the undervolt and had to be told his own crash history.
   Nothing recorded the BIOS version history or his tuning, so "what changed?" had no answer. See
   question 1 at the end.
4. He accepted 7 days at stock only because the experiment was explained. The explanation overstated
   it: three changes landed together, so the week cannot attribute a result to one of them.

## Where the tool must stop, and what it owes the user there

BIOS flash, a physical cable swap, and any blocklisted change such as MPO disable. The value at that
boundary is guidance quality: the exact file path, the exact BIOS menu path, what resets, what to
photograph, the encryption pre-check. Compy cannot or may not do these, must not pretend to, and must
not go silent either.

UAC elevation alone is not the line. Compy already makes some elevated registry changes through
`src-tauri/src/actions.rs`, each with a snapshot and rollback (for example Fast Startup and the MPO
default restore above).

## Detection feasibility (user-mode, non-admin)

- **Feasible:** event-log correlation, bugcheck decode, driver/BIOS/firmware versions, PCIe link speed
  and width per device (`DEVPKEY_PciDevice_CurrentLinkSpeed/Width`), monitor identity and connector
  type (WMI `WmiMonitorConnectionParams`), power-plan sub-settings, MPO/HAGS/TdrDelay state (read
  only), Firefox prefs, startup items, services and scheduled tasks, Defender state (read only).
- **Not feasible without elevation or a driver:** SMART reliability counters, temperatures, Re-Size
  BAR (resource-range math through WMI is unreliable), BIOS overclock settings.

## Compy today against this case (code read 2026-09-27)

What the current build could have done with this machine. Read from source, not from a run.

| Case need | Compy today | Where |
|---|---|---|
| See the crashes (Kernel-Power 41, 6008, bugcheck 1001) | **Has.** Reads them, merges copies of one crash | `src-tauri/src/blackbox.rs` |
| Say what 0x7A / 0x7E mean in plain words | **Missing.** Generic "blue-screened" headline; raw code only in the receipt | `blackbox.rs` |
| Firefox memory blowouts (Resource-Exhaustion 2004) | **Missing.** Not in the event list; no commit telemetry | `blackbox.rs` |
| GPU driver resets (4101) | **Has**, with a repeat-driver rule | `blackbox.rs` |
| WHEA / PCIe errors | **Partial.** Counted, but no device or severity | `blackbox.rs` |
| BIOS, GPU driver version and age | **Partial.** Version and age shown; chipset and SSD firmware not read | `src-tauri/src/hardware.rs`, `src/surfaces/HardwareGrid.tsx` |
| "Is it current?" against the vendor | **Missing.** Deliberately never claims out-of-date; the signed advisory path is built but dark | `hardware.rs`, `src-tauri/src/case_intelligence.rs` |
| Remember BIOS flashes and undervolts | **Missing.** Identity snapshots omit BIOS; no tuning log | `src-tauri/src/intelligence.rs`, `src-tauri/src/hwchange.rs` |
| PCIe link speed/width, DP vs HDMI | **Missing** | `hardware.rs` |
| MPO / HAGS / TdrDelay state | **Partial.** HAGS and one MPO key read; TdrDelay not read | `src-tauri/src/diagnostics.rs`, `src-tauri/src/leftovers.rs` |
| "What changed before the crash?" | **Partial.** The what-changed engine compares FPS sessions only; it never sees crash incidents | `intelligence.rs` |
| Observed / inferred / unknown on each finding | **Partial.** Incidents carry rule strength, not per-fact evidence class | `blackbox.rs`, `src-tauri/src/machine_model.rs` |
| A guided incident flow | **Partial.** Crash & Freeze Rescue lists incidents with one next step; no multi-step diagnosis | `src/surfaces/BlackBox.tsx` |

The three gaps that matter most for this case:

1. **Crashes are seen but not explained.** Stop codes are not decoded, WHEA is not broken down, and
   memory exhaustion is not collected.
2. **No memory of firmware and tuning changes.** Nothing could have told the owner "you flashed or
   undervolted, then crashes began," and nothing could have reminded him of the undervolt.
3. **The timeline and the crash view are not joined.** "What changed?" never looks at crashes, so the
   question this case turned on cannot be asked in the product today.

## Outcome tracking (append here)

- 2026-09-26 17:18 local: BIOS 1.AA7 flashed by the owner; EXPO re-applied; stock CPU (no Curve
  Optimizer); MPO disabled. Baseline window: 7 days, ending 2026-10-03.
- [ ] Flicker outcome with MPO off, cable unchanged.
- [ ] Crash-free for the week? The BIOS flash, stock CPU and MPO change landed together, so a clean
  week is consistent with the combination helping; it does not prove it, or show which change did.
  The four earlier shutdowns were spread unevenly over about 35 days. Attribution stays unresolved.

## Artifacts (owner machine, outside the repo)

`C:\Users\Kuya\pc-health\report-2026-09-26.md` (full findings and plan), `disable-mpo.ps1`,
`enable-mpo.ps1`, `BIOS\7E49v1AA7\` (the verified BIOS package).

## Questions for the next roadmap point

No roadmap edit here. These go to the next roadmap decision:

1. Should the "what changed?" model record BIOS/firmware transitions and user-applied tuning, and
   take crash incidents as input?
2. Should incident presentation carry per-fact evidence labels (observed, inferred, unknown)?
3. Should Crash & Freeze Rescue decode common stop codes and collect memory-exhaustion events?
