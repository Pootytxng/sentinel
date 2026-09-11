# CPU TEMPERATURE SOURCING — dossier, 2026-08-19

**Question that opened it (owner):** *"is there no other way to detect the cpu temp… i have amd
adrenalin and i can see it in there. is there any other open source or common and safe drivers that
may be better than librehardware or hwinfo? and if not is there anyway we can make the driver plugin
process… more automated or handheld for the users so its just like a one click direct driver download
rather than… takes them to the hwinfo website and just instructs them where to go looking for it?"*

**Answer, up front: yes to both, and it is the same answer.** Bundle **PawnIO** and read the MSRs
from Rust. It removes the scavenger hunt, removes a licensing exposure Compy is currently carrying,
removes a recurring 12-hour failure the current design cannot fix with better copy, and does NOT
require Compy to ship a kernel driver of its own.

---

## 0. Verified on the owner's own desk, 2026-08-19

This is not a literature review. The load-bearing facts were measured on `nexusli-usarho3`:

| Reading | Value |
|---|---|
| **PawnIO driver** | **INSTALLED and RUNNING** — `C:\WINDOWS\system32\DriverStore\FileRepository\pawnio.inf_amd64_a72a2f969b8b7496\PawnIO.sys`, v**2.2.0**, service start=Manual |
| **PawnIO signer** | **`CN=Microsoft Windows Hardware Compatibility Publisher`**, issued by `Microsoft Windows Third Party Component CA 2014`, **`Status: Valid`**, counter-timestamped by Microsoft Time-Stamp Service |
| **Memory Integrity (HVCI)** | **ON and ENFORCED** — `SecurityServicesRunning: 2`, `CodeIntegrityPolicyEnforcementStatus: 2`, `VirtualizationBasedSecurityStatus: 2` |
| User-mode SDK on disk | `C:\Program Files\PawnIO\PawnIOLib.dll` + **`PawnIOLib.h`** (the C ABI header the Rust FFI needs) |
| Ryzen Master driver | `AMDRyzenMasterDriverV32` running (`AMDRyzenMasterDriver.sys`) — this is how Adrenalin shows him a temperature |
| HWiNFO | **not running, no HWiNFO driver present** |
| LHM / OHM | **not running** |
| CPU | **AMD Ryzen 7 9850X3D**, 8 cores |

**Two conclusions fall straight out of that table.**

1. **The single unverified fact in the research is now verified.** A Microsoft-attestation-signed
   driver loading on a machine with HVCI *enforced* is proof, not inference. PawnIO is not a
   WinRing0-style liability; Windows itself vouches for it.
2. **On the owner's own machine, Compy can read no CPU temperature at all today** — HWiNFO absent,
   LHM absent — **while PawnIO, the thing that would give it to him, is already installed and
   running.** He is looking at Compy's empty-state offer while the capability sits on his disk.

---

## 1. What Compy does today (`src-tauri/src/cpu_temp.rs`, 48.6 KB)

Deliberately **driver-free**: it does not install or own anything, it reads whatever the user already
runs, in this order —

1. **HWiNFO** — maps `Global\HWiNFO_SENS_SM2` read-only via `OpenFileMappingW`/`MapViewOfFile`
   (`read_hwinfo`, tried FIRST, "most common with gamers"). The parser validates the header against
   the *actual mapped size* rather than the header's claimed `num_reading` — good, that is a hostile-
   input boundary done properly.
2. **LibreHardwareMonitor / OpenHardwareMonitor** — their WMI namespaces `root\LibreHardwareMonitor`,
   `root\OpenHardwareMonitor` (`read_ohm`).

Same two sources feed `read_fans()`. There is a 900 ms/15 s hit-miss cache (added in the C-19 lane)
because the miss path used to cost two failed WMI connects per call.

The UI (`src/surfaces/CpuTempOffer.tsx`) is genuinely good and should be preserved in spirit: it
distinguishes *not installed* / *installed but not running* / *running but Shared Memory Support off*
/ *publishing but no CPU temp*, and a running app always outranks a download prompt. Downloads point
at `hwinfo.com/download/` and the LHM GitHub releases page.

**The design is sound. Its two dependencies are not.**

---

## 2. Why the current dependencies are dead ends

### 2a. HWiNFO — a licensing exposure, not just a UX wart

HWiNFO's shared-memory specification is not public. The author grants it privately, on four
conditions. **Compy fails the first two:**

> 1. *"made publicly available as unconditional freeware without advertising or other monetization
>    options"*
> 2. *"must not release the shared memory information (specification, source code). The interfacing
>    part must be kept in binary form"*

Source: HWiNFO forum, "Shared Memory Support" thread — https://www.hwinfo.com/forum/threads/shared-memory-support.18/

And the licence itself:

> *"Embedding or bundling HWiNFO® in 3rd party software is allowed only with explicit approval of the
> Licensor."*
> *"Tampering with features limited in the unlicensed version (e.g. Shared Memory Limit), or
> automation of actions that would circumvent such limits is strictly prohibited."*

Source: https://www.hwinfo.com/files/license.pdf · https://www.hwinfo.com/licenses/
The Personal licence does not permit commercial use; commercial deployment needs Engineer or
Corporate.

**And the 12-hour trap, which is the product-level killer:**

> *"HWiNFO64 or HWiNFO ARM64 (non-Pro) has a time-limited Shared Memory support to 12 hours. When
> this limit is reached during run-time, this feature will be automatically deactivated."*

`CpuTempOffer` already names `sharedMemoryOff` as *"the single most common cause."* **It is not a
one-time toggle the user forgot — for every free-HWiNFO user it comes back every 12 hours, forever,
by design.** No copy change fixes that. The last lane wrote better words for a state that regenerates
itself.

**Verdict: cut it.** The "go download HWiNFO" link is arguably already outside the grant terms for a
monetized product, and the SHM read is the part the grant explicitly covers.

### 2b. LibreHardwareMonitor via WMI — inherits a driver problem Compy does not control

LHM is MPL-2.0, actively maintained (v0.9.6, 2026-02-14), and embeddable in a commercial product
(file-level copyleft; new files are not Modifications — https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
That is not the problem. The problem is what is underneath it.

**WinRing0.sys — the driver LHM, OpenHardwareMonitor, MSI Afterburner, OpenRGB and FanControl all
historically used — is hash-blocked in Microsoft's enforced Vulnerable Driver Blocklist.** Confirmed
mechanically: the live policy was downloaded from `https://aka.ms/VulnerableDriverBlockList` on
2026-08-19 (policy `VersionEx 10.0.29545.0`) and contains, verbatim:

```xml
<Deny ID="ID_DENY_WINRING0_SHA1"   FriendlyName="WinRing0.sys Hash Sha1"   Hash="12EB825418A932B1E4C6697DC7647E89AE52CF3F" />
<Deny ID="ID_DENY_WINRING0_SHA256" FriendlyName="WinRing0.sys Hash Sha256" Hash="4582ADB2E67EEBAFF755AE740C1F24BC3AF78E0F28E8E8DECB99F86BF155AB23" />
```

Also blocked by filename: `OpenLibSys.sys`, `cpuz.sys`, `NTIOLib.sys`, `gdrv.sys`, `nvoclock.sys`.
Separately, Defender AV flags it as `VulnerableDriver:WinNT/Winring0` and quarantines the file even
with the blocklist disabled — a *different* mechanism. Microsoft's own support page names HWiNFO,
MSI Afterburner, OpenHardwareMonitor, OpenRGB and FanCtrl as affected.
(CVE-2020-14979 · blocklist doc updated 2026-05-04 · support page updated 2026-06-24.)

**LHM migrated off it to PawnIO around September 2025** (0.9.5 "option to disable Ring0 driver
installation"; 0.9.6 "Update PawnIO modules to 2.2"). FanControl followed at V238; OpenRGB and Lian
Li too. An LHM collaborator: *"PawnIO provides the low level hardware layer. If you don't install it,
LibreHardwareMonitor could not read or write any value (including CPU values)."*

**So Compy's LHM path already depends on PawnIO in practice — just indirectly, through a .NET app the
user has to find, install and keep running, and through a WMI namespace.** Cutting out that middleman
is the whole proposal.

### 2c. OpenHardwareMonitor — abandoned. Still on WinRing0. Issue #1665 (2026-01-01) reports it dead under the blocklist with no maintainer response. Drop the namespace or keep it as a zero-cost legacy probe; do not mention it in UI.

---

## 3. The AMD question specifically — Adrenalin is a closed door

**How Adrenalin gets the number:** not documented by AMD. It ships its own signed kernel components
with the chipset/graphics stack and reads the SMU. Evidence that it is a driver-package feature and
not an API: on a Framework Laptop 16 (Ryzen 9 7940HS) the Framework-customized Adrenalin build omits
the CPU-temperature metric entirely while AMD's own build shows it.
**There is no way for a third-party app to ask Adrenalin for this value.**

**AMD Ryzen Master Monitoring SDK — alive, and still not shippable.**
- Maintained: v3.1.1.5478, 2026-07-01, adds Threadripper PRO 9000 and per-core temp/frequency.
  https://www.amd.com/en/developer/ryzen-master-monitoring-sdk.html
- Its own CVE history: AMD-SB-9004 (2024-11-12), CVE-2024-21945 / 21946, privilege escalation.
- **Blocklisted below a version floor.** From the same policy download:
  `FileName="AMDRyzenMasterDriver.sys" MinimumFileVersion="0.0.0.0" MaximumFileVersion="1.5.0.0"`.
  The owner's desk runs `AMDRyzenMasterDriverV32`, above the ceiling, so it loads — but any user with
  a stale install gets a driver-load failure Compy would be blamed for.
- **Redistribution appears prohibited.** The author of the C# bindings: *"I am not able to
  redistribute the header files nor the object files required to build this project completely,"*
  citing *"the restrictiveness of the license."* AIDA64 declined to integrate it for the same class
  of reason. **Caveat: the EULA text itself is behind a click-through and was NOT read.**
- AMD-only. **ADLX is the GPU/display library and has no CPU package temperature.**
- **AMD μProf**: `AMDPowerProfiler.sys` blocklisted ≤ 6.1.0.0. Not a consumer path.

**Intel side, for completeness:** there is no equivalent. Intel Power Gadget is **discontinued** —
INTEL-SA-01037 (2024-05-14) lists 11 CVEs and tells users to uninstall, with no successor named. XTU
has no public SDK.

**Verdict: an AMD-specific path forks the product, takes on a non-redistributable SDK and a
blocklisted-driver support tail, and still leaves Intel unsolved. The MSR path covers both. Drop it.**

---

## 4. What is actually left, once the dead ends are removed

**Nothing Windows offers natively works.** `Win32_TemperatureProbe` is *never* populated — Microsoft:
*"current implementations of WMI do not populate the CurrentReading property… reserved for future
use."* `MSAcpi_ThermalZoneTemperature` reads a motherboard ACPI zone, needs admin, and most desktop
BIOSes expose none. The COM Sensor API is deprecated; `IOCTL_THERMAL_READ_TEMPERATURE` is the same
ACPI zone and is driver-to-driver anyway. **There is no consumer-app API for CPU die temperature in
Windows in 2026.**

**The `sysinfo` crate does not help** — `src/windows/component.rs` runs
`SELECT * FROM MSAcpi_ThermalZoneTemperature` and exposes one component hard-labelled `"Computer"`.
Fine for load/RAM/disk; useless for CPU temperature.

**Everything that works is a ring-0 MSR read**, wrapped:
- **Intel:** `IA32_THERM_STATUS` (0x19C) / `IA32_PACKAGE_THERM_STATUS` (0x1B1) give a delta below
  TjMax; subtract from `IA32_TEMPERATURE_TARGET` (0x1A2).
- **AMD Zen:** SMU/SMN mailbox read for Tctl/Tdie, with per-codename offset tables.

---

## 5. The recommendation — bundle PawnIO, call it from Rust

Compy's installer silently installs PawnIO (a normal driver package; the installer is already
elevated), then Rust talks to `PawnIOLib` and reads the MSRs directly.

**Why this one:**
- **Compy never ships a kernel driver.** No EV certificate, no Partner Center, no attestation queue,
  no ring-0 liability. namazso carries that.
- **Not blocklisted, and proven HVCI-compatible on the owner's own machine** (§0).
- **Legally clean.** PawnIO's licence carries an explicit exception:
  > *"as a special exception, the copyright holders of PawnIO give you permission to combine PawnIO
  > program with free software programs or libraries that are released under the GNU LGPL and with
  > **independent modules that communicate with PawnIO solely through the device IO control
  > interface**."*

  Compy talking to PawnIOLib over IOCTL is an independent module; **Compy's Rust stays proprietary.**
  The modules are `LGPL-2.1-or-later` and ship as separate `.bin` data files loaded at runtime, which
  satisfies LGPL trivially. The official driver binary is "proprietary, redistribution permitted."
- **The modules already do exactly what is needed.** `IntelMSR.p` defines
  `MSR_IA32_PACKAGE_THERM_STATUS 0x1b1`, `MSR_IA32_TEMPERATURE_TARGET 0x1a2`,
  `MSR_IA32_THERM_STATUS 0x19c` and exposes `ioctl_read_msr`. `RyzenSMU.p` carries the Zen codename
  table.
- **Commercial precedent exists at consumer scale.** FanControl, LibreHardwareMonitor, OpenRGB, and
  **Lian Li — who launch the PawnIO installer from inside their own product installer**
  (https://lian-li.com/pawnio_guide/, 2025-09-30). Compy would not be the first.
- **Integration shape in Rust:** read `InstallLocation` from
  `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO`, `LoadLibrary` `PawnIOLib.dll`,
  then `pawnio_open` → `pawnio_load(blob)` → `pawnio_execute("ioctl_read_msr", …)`. That is
  `libloading` plus a few `extern "C"` declarations. **Zero .NET.** The header
  (`PawnIOLib.h`) is already on the owner's disk.

**Honest risks, named:**
- **Single-maintainer dependency** (namazso). Mitigated by keeping the existing HWiNFO/LHM readers as
  a fallback tier rather than deleting the code.
- **FACEIT anti-cheat blocks PawnIO.** Compy targets gamers; this will generate reports. It must fail
  soft and say so plainly, not show a broken gauge.
- **Elevation.** Whether `pawnio_execute` needs admin at *call* time or only at install time is
  undocumented — LHM and FanControl both run elevated, so nobody has tested the unelevated case.
  **This decides the architecture**: if call-time elevation is required, Compy needs an elevated
  helper service with the UI unprivileged over a named pipe (the `lhm-service` pattern,
  https://github.com/jacobtread/lhm-service, MIT — good reference, too immature to depend on).
- **Zen 5 X3D coverage.** The owner's CPU is a **Ryzen 7 9850X3D**. Confirm `RyzenSMU` /
  `AMDFamily1Ah` has its codename entry before promising him a reading on his own desk.
- **Porting the temperature math is on us** — TjMax deltas for Intel, Tctl offsets per Zen codename.
  LHM's MPL-2.0 C# is the reference. **Port the logic, do not copy the files**, and the copyleft
  never attaches.

**Alternative considered and rejected: ship our own signed driver.** ~$300/yr EV certificate, and
Microsoft confirmed 2026-04-22 that Azure Trusted Signing *"does not support EV certificates… does
not support signing Windows drivers"* — so no cheap modern path. Then Partner Center, per-binary
attestation, re-submission per OS revision, **and permanent ownership of a ring-0 MSR-access driver.**
WinRing0's authors are now a Microsoft malware signature. The liability is wildly disproportionate to
displaying one number.

**Alternative considered and rejected: keep degrading gracefully.** Honest, zero-risk, and a bad
product. Keep it only as the tier *behind* PawnIO.

---

## 6. Proposed shape of the change (not yet built)

1. **Tier 0 — PawnIO (new, primary).** Installer bundles PawnIO; Rust reads MSRs via `PawnIOLib`.
   Ships the LGPL module blobs as data files. One click, no website, no 12-hour expiry, no toggle.
2. **Tier 1 — HWiNFO / LHM readers (existing, demoted to fallback).** Keep the code; a user already
   running one still gets a reading. **Remove the download links and the HWiNFO instructions from
   the UI** — that is the licensing exposure and it stops being needed.
3. **Tier 2 — honest empty state.** "Temperature unavailable on this machine" plus the reason, when
   PawnIO is blocked (anti-cheat) or the CPU is unsupported.
4. `CpuTempOffer`'s state machine survives; its *content* changes from "go find an app" to "turn this
   on" — and in most cases it disappears entirely, which is the point.

**Acceptance is a reading on the owner's own desk**, which today shows nothing: a live temperature on
a 9850X3D with HWiNFO absent and Memory Integrity on.

---

## 7. What could not be verified

1. **Whether `pawnio_execute` requires elevation at call time.** Decides the helper-service question.
   Testable on the owner's desk — PawnIO 2.2.0 is already installed.
2. **`RyzenSMU`/`AMDFamily1Ah` support for Zen 5 X3D (9850X3D).** Check the module source before
   promising.
3. **The Ryzen Master SDK EULA text** — click-through gated; the "not redistributable" finding rests
   on the bindings author's account, not the licence.
4. **How Adrenalin actually obtains the value** — inferred from behaviour, no authoritative source.
5. **Whether `LibreHardwareMonitorLib` officially supports NativeAOT** — only relevant if Tier 0 is
   ever built on LHM instead of PawnIO directly.
6. **PawnIO's commercial/custom licensing terms** — the site says only *"contact me for licensing
   options."* The IOCTL exception probably makes this moot, but one email to `admin@namazso.eu`
   confirming the use case in writing is cheap insurance for a shipping product.
7. The signing certificate's `NotAfter` is **2026-07-14**, already past — the signature remains
   `Valid` because it is counter-timestamped, which is correct and expected. Worth re-checking that
   future PawnIO releases stay signed.
