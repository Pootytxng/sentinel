# Detection-accuracy audit sweep — results (eligibility/dismiss/detection train §4)

*2026-06-06. Owner mandate: "thorough inspection of all tooltips, descriptions, functions, specified
hardware-related elements to guarantee detection accuracy and how it reads." Every hardware-conditional
element inventoried → detection source → verified on the dev rig (AMD RX 9070 XT) + the first NVIDIA
tester export (RTX 3060 Ti / Win11 25H2) → reworded to evidence-stating copy. Honesty floor: if a path
can't be verified on available hardware, the UI says "implemented, not yet verified."*

| Element | Detection source | Verified | Wording / behavior before → after |
|---|---|---|---|
| **Wired-Ethernet (diagnostics)** | was `Win32_NetworkAdapter` (PhysicalAdapter+AdapterType — unreliable; virtual adapters pass) → now `MSFT_NetAdapter` ConnectorPresent + NdisPhysicalMedium(14=802.3/9=WiFi) + root-enum/name virtual-exclusion | ✅ dev rig | "Active wired Ethernet detected: Yes/No" (generic, **false-positive on VPN/Hyper-V**) → **"Connected — Realtek PCIe GbE" / "Port present, cable unplugged — …" / "None — no physical Ethernet port (Wi-Fi/other only)" / "Unknown — no adapter details"** + full named adapter inventory |
| **Adapter inventory (diagnostics + export)** | `MSFT_NetAdapter` | ✅ | *new* — each adapter named with physical?/medium/state, so a false positive (e.g. "TAP-Windows Adapter") self-identifies in the tester's Export |
| **EEE rec eligibility** | was `has_active_wired_ethernet` (connected) → now `has_wired_ethernet_port` (physical 802.3 port exists) | ✅ | silently absent when ungated → **"Not for this rig: needs a wired Ethernet port — this rig has none (Wi-Fi/other)"**, out of the denominator; **never offered to a portless rig** |
| **Nagle apply targeting** | was every Tcpip interface with an IP (incl WiFi **+ VPN/Hyper-V virtual**) → now `physical_nic_guids()` (MSFT_NetAdapter physical) ∩ with-IP, **fallback to all-with-IP if physical set undeterminable (never inert)** | ✅ selector unit-tested | rollback was already exact (per-interface snapshot before write — **verified**); now writes only to physical NIC(s); copy "Active network adapter" → **"Your active PHYSICAL network adapter (Wi-Fi or wired) — virtual/VPN adapters excluded"** |
| **SysMain / WSearch (storage type)** | `physical_disks.media_type` (SSD/NVMe vs HDD) | ✅ dev rig | existing gate; `all-hdd` now reads as **"Not for this rig: only for HDD-only systems — this rig has an SSD/NVMe"** via the eligibility path |
| **HAGS / modern-GPU recs** | GPU name match (RTX/GTX16/RX5-9/ARC) | ✅ AMD dev + NVIDIA tester (HAGS apply verified on RTX 3060 Ti) | ineligible reads "Needs a modern discrete GPU" |
| **Display refresh / HDR** | GDI display modes / `hdr_capable` | ✅ AMD dev | HDR ineligible reads "Your display isn't HDR-capable" |
| **GPU driver age** | `driver_age_days` (direct) | ✅ | unchanged — Provenance::Verified (direct fact) |
| **NVIDIA recs + applies** (telemetry, low-latency) | `gpu_vendor_match` + service/registry state | ✅ **RTX 3060 Ti tester** (detection + Container-telemetry + HAGS applies verified) | confidence recorded in CLAUDE.md §5; recs honest |
| **GPU sensor monitoring (NVML)** | NVML | ⚠️ **NVIDIA NOT yet** (tester had 0 sessions) | **unchanged on purpose** — "GPU sensor coverage: NVIDIA — implemented, not yet hardware-verified" + the NVML tooltip stay; do NOT flip until a monitored session proves it |
| **VRR / FreeSync** | ADLX FreeSync read (AMD) | ✅ RX 9070 XT | AMD on→Ready / supported-off→advisory; NVIDIA NVAPI = future (advisory, no regression) |

**Net:** the one live misdetection (false-Ethernet → false EEE offer) is fixed at the source; every
detection row now names its evidence; per-interface tweaks target physical NICs; NVIDIA confidence is
updated only to what the tester export proves (recs/applies yes, NVML sensors not yet). Catalog count
unchanged (~29). Guards green; cargo 221 / npm 182; clippy clean.
