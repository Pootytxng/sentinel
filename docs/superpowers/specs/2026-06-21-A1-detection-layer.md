# Compy A1 Detection-Layer Build Spec (Feasible Probes)

## Honesty Doctrine (RECEIPTS_DOCTRINE)

**Core Rule:** Never claim a value unless measurable in user-mode. If a probe cannot read reliably (kernel access required, vendor SDK absent, or data simply unavailable), the UI displays **nothing** — or an honest label like \"unavailable\", \"N/A\", or \"(kernel access required)\". Fabrication is forbidden.

**Hard Constraints (CLAUDE.md LOCKED):**
- **NO kernel driver.** CPU temperature, instantaneous core parking, real-time P-state, microcode version, MSR reads — all blocked.
- **User-mode only:** WMI, registry reads, SetupAPI/CfgMgr, public Win32 APIs, vendor SDKs (ADLX/NVML) allowed.
- **GPU rule (Rule #5):** AMD (Radeon RX 9070 XT) = hardware-verified. NVIDIA = implemented, not yet hardware-verified (no NVIDIA GPU on dev rig). Intel = planned. Sensor reads are labeled per this hierarchy.

---

## Probe #1: BIOS Version + Release Date (Firmware Staleness Detection)

**Verdict:** `feasible-usermode`

### Source
- **WMI class:** `Win32_BIOS` (namespace `root\cimv2`), properties: `Manufacturer`, `Name` (version string), `Version` (human label), `ReleaseDate` (CIM_DATETIME, e.g., `\"20260315000000.000000-000\"`)
- **Parsing:** Existing helpers `cim_date_iso()` (hardware.rs:896–900) + `cim_date_age_days()` (hardware.rs:884–894)
- **Fallback:** Registry `HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\SystemBiosVersion` (fallback only, ReleaseDate usually empty there)

### Honest Claim
- **Display:** BIOS manufacturer, version string (e.g., \"1.A95\"), release date in ISO 8601 (YYYY-MM-DD), age in days (today - date).
- **Staleness heuristic:** <30 days = \"Very Fresh\", <180 days = \"Recent\", <730 days = \"Acceptable\", ≥730 days = \"Stale (consider updating)\".
- **Caveat:** Age is publication date, not firmware last-applied-to-hardware date. Does NOT mean the BIOS is actually out of date for the user's workload; only that time has passed.

### Cannot Claim
- BIOS update availability (would require OEM API queries; outside scope).
- Security patches applied or CVE status (requires external database).
- BIOS runtime settings or boot options (kernel/UEFI access required).

### Surface
**Check tab (new \"System Health & Maintenance\" card):**
- Row: \"BIOS Version\" → \"1.A95 (released 2026-03-15, 98 days old — Recent)\"
- Optional: Clickable link to motherboard vendor support page (MSI/ASUS/Gigabyte based on detected Manufacturer).

**Diagnostics (\"Power & Boot\" section):**
- Add: \"BIOS / Firmware\" → version + release date + staleness label.

### New Serde Field
```rust
// In HardwareInfo struct (hardware.rs, after windows_version):
pub(crate) bios_info: Option<BiosInfo>,

#[derive(Serialize, Clone, Default)]
pub(crate) struct BiosInfo {
    pub(crate) manufacturer: String,      // "American Megatrends International", "Phoenix", "Award", etc.
    pub(crate) version: String,           // "1.A95"
    pub(crate) release_date: String,      // "2026-03-15" (ISO) or "" if unparseable
    pub(crate) release_date_age_days: Option<i64>,  // computed delta from today
}
```

### TypeScript Type
```typescript
type BiosInfo = {
  manufacturer: string;
  version: string;
  release_date: string;
  release_date_age_days?: number | null;
};
type HardwareInfo = {
  // ... existing fields ...
  bios_info?: BiosInfo | null;
};
```

### IPC Wiring
- Probe runs inside `collect_hardware_inner()` (hardware.rs:1237–1300, after `detect_gpus()`).
- No new command; piggybacks on existing `get_hardware_info()` IPC (hardware.rs:1437–1438).
- Frontend reads `hw.bios_info` (type: `HardwareInfo`) via existing `invoke<HardwareInfo>(\"get_hardware_info\")` call.

### TDD Test Plan
**Unit test (pure parser, CI-safe, no hardware required):**
```rust
#[cfg(test)]
mod bios_detection_tests {
    use super::{cim_date_iso, cim_date_age_days};

    #[test]
    fn bios_cim_date_parses_correctly() {
        // Fixture: WMI output from a real Windows 11 system
        let cim = "20260315000000.000000-000";
        assert_eq!(cim_date_iso(cim), "2026-03-15");
        let age = cim_date_age_days(cim);
        assert!(age.is_some());
        assert!(age.unwrap() <= 100); // Relative to today, if test runs after 2026-03-15
    }

    #[test]
    fn bios_unparseable_date_stays_unknown() {
        // Never fabricate an age.
        assert_eq!(cim_date_iso(""), "");
        assert_eq!(cim_date_age_days(""), None);
        assert_eq!(cim_date_iso("malformed"), "");
    }

    #[test]
    fn bios_staleness_threshold() {
        // Pure heuristic: age in days → threshold label
        let fresh = staleness_label(20);
        assert_eq!(fresh, "Very Fresh");
        let recent = staleness_label(150);
        assert_eq!(recent, "Recent");
        let stale = staleness_label(800);
        assert_eq!(stale, "Stale (consider updating)");
    }

    #[test]
    fn bios_wmi_fixture_deserialize() {
        // Capture real WMI Win32_BIOS output, serialize to JSON fixture.
        let json = r#"{"Manufacturer":"American Megatrends International","Version":"1.A95","ReleaseDate":"20260315000000.000000-000"}"#;
        let parsed: Win32Bios = serde_json::from_str(json).expect("fixture parse");
        assert_eq!(parsed.manufacturer.as_deref(), Some("American Megatrends International"));
        assert_eq!(parsed.version.as_deref(), Some("1.A95"));
    }
}
```

**Effort:** S (small) — Reuses existing CIM_DATETIME parsing; WMI query is one class; display logic is threshold-based string matching.

---

## Probe #2: XMP/EXPO Active Confirmation (Memory Overclocking Detection)

**Verdict:** `already-live-extend`

### Source
- **Existing:** SMBIOS Type 17 (Memory Device) parsed in hardware.rs:350–558, `parse_smbios_memory_devices()`.
- **Bytes:** 0x15–0x16 = peak/JEDEC speed (MT/s), 0x20–0x21 = configured speed (XMP/EXPO-applied, SMBIOS 2.7+).
- **Already read:** Both speeds fetched; code currently stores configured_speed OR peak in `MemoryModuleInfo.speed_mhz` (line 511).
- **Fallback WMI:** `Win32_PhysicalMemory.Speed` (peak) + `ConfiguredClockSpeed` (XMP/EXPO, if available).

### Honest Claim
- **Detect:** If `configured_speed > peak_speed` (in SMBIOS Type 17 fields 0x20 vs 0x15), XMP/EXPO is active.
- **Display:** Per-module boolean or enum: \"Active (6000 MT/s vs 5600 JEDEC)\", \"Inactive (JEDEC only)\", or \"Unknown\" if fields unpopulated.
- **Caveat:** Does NOT distinguish which profile (XMP1 vs XMP2 vs EXPO OC/DC) — SMBIOS doesn't encode profile index. Does NOT confirm CPU is *actually* running at this speed (would need live MSR read, kernel-only).

### Cannot Claim
- Which XMP profile is active (1, 2, or EXPO variant).
- Voltage/timing settings (tCAS, tCL, tRAS).
- Whether profile was user-selected or auto-enabled.
- Real-time memory frequency (requires CPU MSR, kernel-only).

### Surface
**Check tab (\"Hardware\" card, \"Memory\" section):**
- Extend existing memory module list: show per-module XMP status as a badge or radio-button label.
- Example: \"Corsair Vengeance DDR5-6000 ● 32 GB — **Active (6000 MT/s vs 5600 JEDEC)**\" (green badge).
- Example: \"SK Hynix DDR5 32 GB — **Inactive (JEDEC 5600 MT/s)** — [?] Hint: Check BIOS to enable XMP\" (yellow note, if platform is Ryzen 7000+ or Intel 13th+).

**Diagnostics (\"Memory\" section):**
- Add row: \"Memory Overclocking\" → \"XMP/EXPO Active\" or \"JEDEC Speed Only\".

### New Serde Field
```rust
// Extend MemoryModuleInfo struct (hardware.rs:57–62):
pub(crate) struct MemoryModuleInfo {
    pub(crate) capacity_bytes: u64,
    pub(crate) speed_mhz: u32,
    pub(crate) type_name: String,
    pub(crate) manufacturer: String,
    pub(crate) xmp_expo_status: Option<String>,  // NEW: "active", "inactive", "unknown"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) peak_speed_mhz: Option<u32>,      // NEW: JEDEC reference for comparison
}
```

### TypeScript Type
```typescript
type MemoryModuleInfo = {
  capacity_bytes: number;
  speed_mhz: number;
  type_name: string;
  manufacturer: string;
  xmp_expo_status?: string | null;  // "active", "inactive", "unknown"
  peak_speed_mhz?: number | null;
};
```

### IPC Wiring
- Probe extends existing `collect_hardware_inner()` call in SMBIOS parsing (hardware.rs:~500–520).
- No new IPC command; data flows through existing `get_hardware_info()`.
- Frontend reads `hw.memory_modules[i].xmp_expo_status` and `peak_speed_mhz` for display.

### TDD Test Plan
**Unit test (pure parser over captured SMBIOS binary fixtures):**
```rust
#[cfg(test)]
mod xmp_detection_tests {
    use super::parse_smbios_memory_devices;

    #[test]
    fn smbios_type17_xmp_active_ddr5() {
        // Fixture: SMBIOS Type 17 with configured_speed > peak_speed
        let binary = b"..."; // Capture real bytes: peak_speed at 0x15-16, configured at 0x20-21
        // Example: peak=5600, configured=6000 → XMP active
        let modules = parse_smbios_memory_devices(binary);
        assert_eq!(modules[0].speed_mhz, 6000); // Configured
        assert_eq!(modules[0].peak_speed_mhz, Some(5600));
        assert_eq!(modules[0].xmp_expo_status, Some("active".to_string()));
    }

    #[test]
    fn smbios_type17_xmp_inactive_jedec() {
        // Fixture: configured_speed == peak_speed (or not set)
        let binary = b"..."; // peak=5600, configured=0 (field absent or zero)
        let modules = parse_smbios_memory_devices(binary);
        assert_eq!(modules[0].speed_mhz, 5600);
        assert_eq!(modules[0].xmp_expo_status, Some("inactive".to_string()));
    }

    #[test]
    fn smbios_type17_unknown_if_struct_too_short() {
        // Fixture: SMBIOS struct doesn't have 0x20-21 (SMBIOS < 2.7)
        let binary = b"..."; // struct_len < 0x22
        let modules = parse_smbios_memory_devices(binary);
        assert_eq!(modules[0].xmp_expo_status, Some("unknown".to_string()));
    }
}
```

**Effort:** S (small) — Pure comparison logic on already-fetched fields. No new Windows calls.

---

## Probe #3: GPU Driver Freshness + NIC Driver Surface (Already Live, Extend UI)

**Verdict:** `already-live-extend`

### Source
- **GPU drivers:** Already live via `Win32_VideoController` WMI (hardware.rs:956–987), CIM_DATETIME parsing (hardware.rs:896–900).
- **NIC drivers:** Already live via `Win32_PnPSignedDriver` lazy IPC (hardware.rs:880–882, `get_nic_driver_info()`).
- **Both:** Use identical CIM_DATETIME → ISO + age_days parsing.

### Honest Claim
- **GPU path:** Version string, driver publication date (ISO 8601), age in days, vendor classification (AMD/NVIDIA/Intel).
- **NIC path:** Device name, driver publication date, age in days, vendor key (intel/realtek/qualcomm/broadcom/mediatek/unknown) for support URL lookup.
- **Caveat:** Age is publication date; does NOT claim update availability (no remote version fetch) or urgency.

### Cannot Claim
- Driver update availability (no network check).
- Security patches or CVE status.
- Driver version number for NICs (WMI field not exposed by default).

### Surface
**Check tab (already wired for GPU, extend for NIC):**
- GPU row already shows driver freshness badge (green/yellow/skip based on ≤90-day threshold).
- **NEW:** Add NIC driver freshness rows (same threshold-based badges), hyperlinked to vendor support per `nic_vendor()` heuristic mapping.
- If any driver is stale, show optional \"Tip: Check vendor for updates.\"

**Diagnostics (\"Network\" and \"GPU\" sections):**
- Existing: \"GPU Driver\" row displays version + age (already live).
- **NEW:** \"NIC Driver (device name)\" → version + age (one row per NIC, behind `get_nic_driver_info()` lazy call).

### Serde (No New Fields)
- `GpuInfo` already has `driver_version`, `driver_date`, `driver_age_days` (hardware.rs:28–30).
- `NicDriverInfo` already has `name`, `driver_date`, `driver_age_days`, `vendor` (hardware.rs:808–814).
- Both are serialized and transmitted via existing IPC.

### TypeScript Type (No New Types)
- `GpuInfo` and `NicDriverInfo` types already defined in frontend type stubs.

### IPC Wiring
- GPU: Existing `get_hardware_info()` returns `hw.gpus[i].driver_age_days`.
- NIC: Existing `get_nic_driver_info()` returns `Vec<NicDriverInfo>` (lazy, behind Check surface).
- Frontend: Extend Check.tsx to call both and display driver freshness for GPUs + NICs.

### TDD Test Plan
**Pure parser test (no hardware required):**
```rust
#[cfg(test)]
mod driver_freshness_tests {
    use super::{cim_date_age_days, cim_date_iso};

    #[test]
    fn gpu_driver_date_parsing() {
        let cim = "20260529000000.000000-000"; // AMD RX 9070 XT driver
        assert_eq!(cim_date_iso(cim), "2026-05-29");
        let age = cim_date_age_days(cim);
        assert!(age.is_some() && age.unwrap() <= 30, "driver is recent on dev rig");
    }

    #[test]
    fn nic_driver_realtek_stale() {
        let cim = "20220301000000.000000-000"; // 2022 Realtek driver
        assert_eq!(cim_date_iso(cim), "2022-03-01");
        let age = cim_date_age_days(cim);
        assert!(age.unwrap_or(0) > 1000, "a 2022 driver is years old");
    }

    #[test]
    fn driver_age_threshold_logic() {
        // Existing helper (used in Check.tsx driverFreshness())
        let tone = |age: i64| -> &'static str {
            match age {
                0..=90 => "pass",
                91..=180 => "advisory",
                _ => "skip",
            }
        };
        assert_eq!(tone(30), "pass");
        assert_eq!(tone(120), "advisory");
        assert_eq!(tone(365), "skip");
    }
}
```

**Effort:** S (small) — Reuses existing parsing + caching; UI wiring (Check.tsx extension).

---

## Probe #4: Thermal Throttling State (CPU)

**Verdict:** `feasible-usermode`

### Source
- **WMI class:** `Win32_PerfFormattedData_Counters_ProcessorInformation` (namespace `root\cimv2\performance`), property `PerformanceLimitFlags` (bitmask u32).
- **Interpretation:** Bit 0 (0x01) = thermal limit active; other bits for power, license, platform constraints.
- **Availability:** Desktop and laptop CPUs; OEM firmware must populate the flag (not guaranteed on all boards, but reliable on modern Win11).

### Honest Claim
- **Display:** Boolean: \"Thermal Throttling: Yes\" (red flag) or \"No\" (green pass) if PerformanceLimitFlags bit 0 set/unset.
- **Caveat:** This is a kernel-set policy flag, not a temperature sensor read. Does NOT report actual die temperature (forbidden by constraint #1).

### Cannot Claim
- Actual CPU die temperature (MSR read, kernel-only).
- Throttling threshold temperature.
- Which specific cores are throttled.
- Distinguish thermal throttling from other constraint types (power, license, platform) without careful bitmask parsing.

### Surface
**Diagnostics (\"Power & Boot\" section):**
- Add row: \"CPU Thermal Throttling\" → \"Yes\" (warning) or \"No\" (pass) or \"Not detected\" (WMI unavailable).
- Optional note: \"Set by kernel based on thermals. No user-mode temperature sensor available.\"

**Check tab (optional, informational only):**
- If thermal throttling detected, advisory badge under CPU section.

### New Serde Field
```rust
// In HardwareInfo struct:
pub(crate) cpu_thermal_throttling_active: Option<bool>,  // None = unreadable, Some(true/false) = readable
```

### TypeScript Type
```typescript
type HardwareInfo = {
  // ... existing ...
  cpu_thermal_throttling_active?: boolean | null;
};
```

### IPC Wiring
- New helper function: `detect_cpu_thermal_throttling()` in hardware.rs, called in `collect_hardware_inner()`.
- No new IPC command; data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (over captured WMI XML fixture):**
```rust
#[cfg(test)]
mod thermal_throttling_tests {
    use super::parse_performance_limit_flags;

    #[test]
    fn thermal_throttle_bit_set() {
        // Fixture: PerformanceLimitFlags = 0x01 (bit 0 set)
        let flags: u32 = 0x01;
        assert!(parse_performance_limit_flags(flags).is_some());
        assert!(parse_performance_limit_flags(flags).unwrap()); // true
    }

    #[test]
    fn no_thermal_throttle() {
        let flags: u32 = 0x00;
        assert!(parse_performance_limit_flags(flags).is_some());
        assert!(!parse_performance_limit_flags(flags).unwrap()); // false
    }

    #[test]
    fn other_constraint_bits_ignored() {
        // Bits 1-31 are other constraints; only bit 0 matters for thermal.
        let flags: u32 = 0xFFFFFFFE; // All bits except 0
        assert!(!parse_performance_limit_flags(flags).unwrap()); // No thermal throttle
    }

    #[test]
    fn wmi_query_missing_returns_none() {
        // If WMI returns empty result set or exception, return None
        // (tested via mock WMI fixture returning zero rows)
        assert!(parse_performance_limit_flags_from_wmi_fixture(&[]).is_none());
    }
}
```

**Effort:** M (medium) — WMI query + bitflag parse + CIM_DATETIME handling. Integrate into existing diagnostics.rs.

---

## Probe #5: Hyper-V / VBS / AMD-V Virtualization Detection

**Verdict:** `feasible-usermode`

### Source
- **Primary:** WMI class `Win32_DeviceGuard` (namespace `root\Microsoft\Windows\DeviceGuard`), properties:
  - `AvailableSecurityProperties` (bitmask u32): bit 1 = hardware hypervisor support.
  - `VirtualizationBasedSecurityStatus` (u32): 0=disabled, 1=enabled-not-running, 2=enabled-and-running.
  - `SecurityServicesRunning` / `SecurityServicesConfigured` (bitmask): bit 0=Credential Guard, bit 2=Memory Integrity (HVCI).
- **Fallback 1:** Registry `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity` (DWORD \"Enabled\").
- **Fallback 2:** `systeminfo.exe` output parsing (\"A hypervisor has been detected\").
- **CPU vendor cross-check:** HardwareInfo.cpu_arch.vendor (from existing sysinfo parse) to assert \"AMD-V capable\" (if AMD + AvailableSecurityProperties bit 1 set).

### Honest Claim
- **Hyper-V hypervisor present:** WMI Win32_DeviceGuard.AvailableSecurityProperties bit 1 set.
- **VBS enabled state:** Win32_DeviceGuard.VirtualizationBasedSecurityStatus enum (disabled/enabled-not-running/enabled-and-running).
- **VBS running:** Status == 2 (enabled-and-running).
- **Memory Integrity (HVCI) enabled:** Registry HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity → Enabled == 1.
- **Security prerequisites:** Hypervisor capability, Secure Boot, DMA protection, NX bit, SMM support, MBEC/GMET (all readable via AvailableSecurityProperties bitmask).
- **AMD-V vs Intel VT-X:** AMD-V if (cpu_brand contains \"AMD\"/\"Ryzen\" AND AvailableSecurityProperties bit 1). Intel VT-X if (cpu_brand contains \"Intel\" AND bit 1).

### Cannot Claim
- CPU temperature via VBS (no thermal sensor in VBS partition).
- Active running VMs (Hyper-V admin WMI restricted, not user-mode accessible).
- Nested virtualization active state.
- VBS performance overhead (quantified).
- Hyper-V hypervisor version/build (kernel-only).
- Credential Guard runtime protection validation (config only, not proof).

### Surface
**Check tab (\"System Health\" or \"Advanced\" section, new card):**
- Title: \"Virtualization & Security\"
- Rows:
  - \"Hypervisor\" → \"Present\" / \"Not detected\"
  - \"VBS (Virtualization-Based Security)\" → \"Enabled & Running\" / \"Enabled, Not Running\" / \"Disabled\" / \"Not available\"
  - \"Memory Integrity (HVCI)\" → \"Enforced\" / \"Audit Mode\" / \"Off\"
  - \"Secure Boot\" → \"Enabled\" / \"Disabled\" / \"Unavailable in user-mode\"
  - \"IOMMU / VT-d / AMD-Vi\" → \"Enabled\" / \"Disabled\"
  - \"Virtualization Extension (AMD-V / Intel VT-X)\" → \"Present (AMD-V)\" / \"Present (Intel VT-X)\" / \"Not detected\"

**Diagnostics (new \"Virtualization & Security\" section):**
- Add rows for hypervisor, VBS, HVCI, Secure Boot status.

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct VirtSecurityInfo {
    pub(crate) hypervisor_present: bool,
    pub(crate) vbs_status: String,  // "disabled", "enabled-not-running", "enabled-running", "unknown"
    pub(crate) memory_integrity_enabled: Option<bool>,
    pub(crate) secure_boot_available: Option<bool>,
    pub(crate) virtualization_extension: String,  // "amd-v", "intel-vt-x", "none", "unknown"
    pub(crate) is_virtual_machine: bool,  // Detected via Win32_ComputerSystem.Model containing VM keywords
}

// In HardwareInfo:
pub(crate) virt_security: Option<VirtSecurityInfo>,
```

### TypeScript Type
```typescript
type VirtSecurityInfo = {
  hypervisor_present: boolean;
  vbs_status: string;
  memory_integrity_enabled?: boolean | null;
  secure_boot_available?: boolean | null;
  virtualization_extension: string;
  is_virtual_machine: boolean;
};
type HardwareInfo = {
  // ...
  virt_security?: VirtSecurityInfo | null;
};
```

### IPC Wiring
- New helper: `detect_vbs_and_virtualization()` in hardware.rs, called in `collect_hardware_inner()`.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (captured WMI fixtures, no hardware required):**
```rust
#[cfg(test)]
mod vbs_detection_tests {
    use super::{parse_device_guard_fixture, parse_vbs_status, parse_virtualization_extension};

    #[test]
    fn win32_device_guard_vbs_enabled_running() {
        // Fixture: Win32_DeviceGuard with VirtualizationBasedSecurityStatus = 2
        let json = r#"{
          "AvailableSecurityProperties": [0, 1, 2],
          "VirtualizationBasedSecurityStatus": 2,
          "SecurityServicesRunning": [0, 2]
        }"#;
        let guard = parse_device_guard_fixture(json).unwrap();
        assert_eq!(parse_vbs_status(guard.vbs_status), "enabled-running");
        assert!(guard.hypervisor_present); // bit 1 in AvailableSecurityProperties
        assert!(guard.memory_integrity_enabled); // bit 2 in SecurityServicesRunning
    }

    #[test]
    fn vbs_disabled() {
        let json = r#"{"VirtualizationBasedSecurityStatus": 0}"#;
        let guard = parse_device_guard_fixture(json).unwrap();
        assert_eq!(parse_vbs_status(guard.vbs_status), "disabled");
    }

    #[test]
    fn hypervisor_absent() {
        // AvailableSecurityProperties does not include bit 1
        let json = r#"{"AvailableSecurityProperties": [0, 2, 3]}"#;
        let guard = parse_device_guard_fixture(json).unwrap();
        assert!(!guard.hypervisor_present);
    }

    #[test]
    fn virtualization_extension_amd_v() {
        let cpu_brand = "AMD Ryzen 7 7800X3D";
        let has_bit1 = true;
        let ext = parse_virtualization_extension(cpu_brand, has_bit1);
        assert_eq!(ext, "amd-v");
    }

    #[test]
    fn virtualization_extension_intel_vt_x() {
        let cpu_brand = "Intel(R) Core(TM) i7-13700K";
        let has_bit1 = true;
        let ext = parse_virtualization_extension(cpu_brand, has_bit1);
        assert_eq!(ext, "intel-vt-x");
    }

    #[test]
    fn vm_detection_qemu() {
        let model = "QEMU";
        let is_vm = model.contains("QEMU") || model.contains("VirtualBox") || model.contains("VMware");
        assert!(is_vm);
    }
}
```

**Effort:** M (medium) — Multiple WMI classes, registry fallback, CPU brand correlation. Compound logic.

---

## Probe #6: S.M.A.R.T. Disk Health Status

**Verdict:** `partial`

### Source
- **Primary:** WMI `Win32_DiskDrive` (namespace `root\cimv2`), property `Status` (string: \"OK\", \"Degraded\", \"Pred Fail\", \"Error\", etc.).
- **Capability check:** `Win32_DiskDrive.Capabilities` array, index 10 = \"SMART Notification\" presence.
- **Optional advanced (admin-only):** `DeviceIoControl(IOCTL_STORAGE_PREDICT_FAILURE)` on physical drive handle — returns `PredictFailure` ULONG (nonzero = failure predicted) + 512 bytes vendor-specific SMART data (vendor-proprietary format, unreliable user-mode parse).

### Honest Claim
- **Display:** Disk model, serial, capacity, current Status string (\"OK\", \"Pred Fail\", etc.).
- **SMART capable:** Whether Capabilities[10] == \"SMART Notification\" (can hint at feature presence).
- **Failure prediction flag:** If Status == \"Pred Fail\", display red warning (binary, not a percentage).

### Cannot Claim
- Individual SMART attributes (temperature, power-on hours, reallocated sectors, etc.). Parsing 512-byte vendor-specific payload in user-mode is unreliable without knowing drive model/firmware encoding.
- SSD wear-out % or TBW consumed. Would require vendor SDK per manufacturer (Samsung MZ, WD Dashboard, Crucial, etc.).
- Root cause of degraded status (thermal, mechanical, electrical).
- Disk failure timeline prediction (would need Bayesian model or vendor telemetry).

### Surface
**Check tab (new \"Storage Health\" card, passive advisory):**
- Per-disk row: model, capacity, Status badge (green \"OK\", yellow \"Degraded\", red \"Pred Fail\", gray \"Unknown\").
- If Status == \"Pred Fail\": Show red icon + \"⚠ Failure Predicted — Back up your data and consider replacement.\"
- SMART capable: Optional [?] icon noting \"S.M.A.R.T. monitoring active\" if Capabilities[10] present.

**Diagnostics (\"Storage\" section):**
- Per-disk: \"Status\" → Status string (or skip if unavailable).

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct DiskHealthInfo {
    pub(crate) friendly_name: String,
    pub(crate) status: String,  // "OK", "Degraded", "Pred Fail", "Error", "Unknown"
    pub(crate) smart_capable: bool,  // Capabilities[10] present
}

// In HardwareInfo:
pub(crate) disk_health: Vec<DiskHealthInfo>,
```

### TypeScript Type
```typescript
type DiskHealthInfo = {
  friendly_name: string;
  status: string;
  smart_capable: boolean;
};
type HardwareInfo = {
  // ...
  disk_health: DiskHealthInfo[];
};
```

### IPC Wiring
- New helper: `detect_disk_health()` in hardware.rs, called in `collect_hardware_inner()`.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (captured WMI fixtures):**
```rust
#[cfg(test)]
mod disk_health_tests {
    use super::{parse_disk_status, has_smart_capability};

    #[test]
    fn disk_status_ok() {
        let disk_json = r#"{"Status": "OK", "Capabilities": [3, 4, 7, 10]}"#;
        let disk = parse_disk_fixture(disk_json).unwrap();
        assert_eq!(disk.status, "OK");
        assert!(has_smart_capability(&disk.capabilities));
    }

    #[test]
    fn disk_status_pred_fail() {
        let disk_json = r#"{"Status": "Pred Fail", "Capabilities": [3, 4, 10]}"#;
        let disk = parse_disk_fixture(disk_json).unwrap();
        assert_eq!(disk.status, "Pred Fail");
        assert!(has_smart_capability(&disk.capabilities));
    }

    #[test]
    fn disk_no_smart_capability() {
        // Capabilities array missing index 10
        let disk_json = r#"{"Status": "OK", "Capabilities": [3, 4, 7]}"#;
        let disk = parse_disk_fixture(disk_json).unwrap();
        assert!(!has_smart_capability(&disk.capabilities));
    }

    #[test]
    fn disk_status_unknown_if_missing() {
        let disk_json = r#"{"Status": null}"#;
        let disk = parse_disk_fixture(disk_json).unwrap();
        assert_eq!(disk.status, "Unknown");
    }
}
```

**Effort:** M (medium) — WMI query + string matching on Status enum. Simple, no complex parsing.

---

## Probe #7: BIOS-Level Tweak Capability Annotation

**Verdict:** `partial`

### Source
- **Compound:** Win32_BIOS (manufacturer, version), Win32_ComputerSystem (model), registry SecureBoot state, SMBIOS Type 17 (memory type/speed), Win32_SystemEnclosure (chassis type).
- **Dependencies:** Probe #1 (BIOS info), existing hardware detection (memory, CPU).

### Honest Claim
- **Aggregate display:** \"Your motherboard supports: XMP/EXPO (see BIOS menu), Secure Boot (capability present), TPM 2.0 (present), Form Factor (Desktop/Laptop)\".
- **Memory profile:** If configured_speed > peak_speed (from Probe #2), annotate \"XMP/EXPO is currently active\".
- **Recommend checking BIOS if:** Ryzen 7000+ or Intel 13th+ CPU + DDR5 at JEDEC speeds (potential unclaimed performance).

### Cannot Claim
- Will enable these tweaks for you (user must enter BIOS; Compy does not apply BIOS settings per policy #6).
- BIOS toggle states (e.g., \"Secure Boot is enabled\" requires admin registry read).
- Predicted performance gain from enabling XMP (varies by workload).
- Which tweaks are beneficial for gaming vs. productivity (design decision, not detection).

### Surface
**Check tab (informational card, \"BIOS Capabilities\"):**
- Motherboard model + BIOS version (link to manual).
- Checklist of detected capabilities:
  - ✓ XMP/EXPO profiles (always true on DDR4+ modern boards).
  - ✓ Secure Boot (UEFI-capable).
  - ✓ TPM 2.0 (if Win32_Tpm present).
  - ✓ Form Factor: Desktop/Laptop (from Win32_SystemEnclosure).
  - ✓ Advanced Power (if CPU Boost / HWP support detected from Probe #8).
- Optional hint: \"Running in VM — BIOS tweaks do not apply.\" (if is_virtual_machine detected).

**No Lab/Recommendations surface:** Compy does not prescribe BIOS entry or tweak actions (policy #6, LOCKED).

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct BiosTweakCapabilities {
    pub(crate) motherboard_model: String,
    pub(crate) bios_version: String,  // Reuse from Probe #1
    pub(crate) xmp_expo_capable: bool,  // Heuristic: DDR4+ assume true
    pub(crate) secure_boot_capable: bool,  // UEFI present
    pub(crate) tpm2_present: bool,  // Win32_Tpm exists
    pub(crate) form_factor: String,  // "Desktop", "Laptop", "SFF", "Unknown"
    pub(crate) is_virtual_machine: bool,  // QEMU/VirtualBox/VMware detected
}

// In HardwareInfo:
pub(crate) bios_capabilities: Option<BiosTweakCapabilities>,
```

### TypeScript Type
```typescript
type BiosTweakCapabilities = {
  motherboard_model: string;
  bios_version: string;
  xmp_expo_capable: boolean;
  secure_boot_capable: boolean;
  tpm2_present: boolean;
  form_factor: string;
  is_virtual_machine: boolean;
};
type HardwareInfo = {
  // ...
  bios_capabilities?: BiosTweakCapabilities | null;
};
```

### IPC Wiring
- Depends on Probe #1 output (BiosInfo).
- New helper: `detect_bios_capabilities()` in hardware.rs, calls Probe #1 + aggregates WMI queries.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (fixtures from existing WMI probes):**
```rust
#[cfg(test)]
mod bios_tweak_capabilities_tests {
    use super::{detect_bios_capabilities_from_fixtures, is_virtual_machine, form_factor_from_chassis};

    #[test]
    fn bios_capabilities_desktop_xmp_capable() {
        let bios_json = r#"{"Manufacturer": "MSI", "Version": "1.A95"}"#;
        let cs_json = r#"{"Model": "MS-7E49"}"#;
        let chassis_json = r#"{"ChassisTypes": [3]}"#;  // 3 = Desktop
        let caps = detect_bios_capabilities_from_fixtures(bios_json, cs_json, chassis_json).unwrap();
        assert_eq!(caps.form_factor, "Desktop");
        assert!(caps.xmp_expo_capable); // DDR4+ is default
        assert!(!caps.is_virtual_machine);
    }

    #[test]
    fn bios_capabilities_vm_detected() {
        let cs_json = r#"{"Model": "VirtualBox"}"#;
        let caps_partial = detect_bios_capabilities_from_fixtures("", cs_json, "").unwrap();
        assert!(caps_partial.is_virtual_machine);
    }

    #[test]
    fn form_factor_laptop() {
        let chassis_types = [10];  // 10 = Laptop
        assert_eq!(form_factor_from_chassis(&chassis_types), "Laptop");
    }
}
```

**Effort:** M (medium) — Aggregation of multiple WMI queries, but each is simple. Depends on Probe #1.

---

## Probe #8: Intel SpeedShift (HWP) Status Detection

**Verdict:** `partial`

### Source
- **CPUID instruction:** EAX=0x06 (Thermal and Power Management), return EAX bit 7 = HWP (Hardware P-State) support.
- **Registry (Windows power policy):** `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Power\PowerSettings\54533251-82be-4824-96c1-47b60b740d00` (CPU boost policy), subkey `be337238-0d82-4146-a960-4f3749d470c7` (PERFBOOSTMODE DWORD, values 0-3).
- **Availability:** Intel Skylake+ (6th Gen Core i5+), some AMD Ryzen with compatible firmware.

### Honest Claim
- **HWP capability:** CPUID.06H:EAX[7] == 1 = CPU supports autonomous frequency management.
- **Boost mode:** PERFBOOSTMODE registry (0=disabled, 1-3=enabled at different aggressiveness).
- **CPU brand:** From existing `HardwareInfo.cpu_brand` (sysinfo parse).
- **Vendor:** If Intel brand, claim HWP. If AMD/ARM, skip (different architecture, CPPC2 instead).

### Cannot Claim
- EPB (Energy Performance Bias) setting (IA32_ENERGY_PERF_BIAS MSR, ring-0 only).
- Current boost activation state (is CPU boosting *right now*?). Would require live MSR/frequency poll (kernel-only; PDH already captures frequency trend).
- Whether BIOS has \"Enable/Disable HWP\" toggle and its state (BIOS setup only, not exposed).
- Actual frequency boost behavior in games (runtime-dependent, varies per workload).

### Surface
**Check tab (new \"Processor Power Management\" card, Intel-only):**
- Row: \"HWP (Hardware P-State)\" → \"Supported\" (if CPUID bit 7 = 1) or \"Not supported\".
- Row: \"Boost Mode\" → \"Enabled (Aggressive)\" / \"Enabled (Moderate)\" / \"Enabled (Conservative)\" / \"Disabled\" (from PERFBOOSTMODE).
- Note: \"HWP allows the CPU to autonomously scale frequency for efficiency. Boost mode is configurable in Windows power settings.\"

**Diagnostics (\"Power & Boot\" section):**
- Add: \"Intel HWP\" → \"Supported\" / \"Not supported\".
- Add: \"Processor Boost Mode\" → mode string.

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct IntelHwpInfo {
    pub(crate) hwp_supported: bool,
    pub(crate) boost_mode: String,  // "disabled", "conservative", "moderate", "aggressive", "unknown"
    pub(crate) cpuid_leaf6_eax: Option<u32>,  // Raw bits for Lab/advanced view
}

// In HardwareInfo:
pub(crate) intel_hwp: Option<IntelHwpInfo>,
```

### TypeScript Type
```typescript
type IntelHwpInfo = {
  hwp_supported: boolean;
  boost_mode: string;
  cpuid_leaf6_eax?: number | null;
};
type HardwareInfo = {
  // ...
  intel_hwp?: IntelHwpInfo | null;
};
```

### IPC Wiring
- New helper: `detect_intel_hwp()` in hardware.rs (returns None if not Intel).
- Called in `collect_hardware_inner()`.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (captured CPUID + registry fixtures):**
```rust
#[cfg(test)]
mod intel_hwp_tests {
    use super::{parse_hwp_from_cpuid_and_registry, boost_mode_from_perfboostmode};

    #[test]
    fn hwp_supported_intel_skylake() {
        // Fixture: CPUID.06H EAX with bit 7 set (real Intel Skylake example)
        let eax: u32 = 0x00040016; // Bit 7 is set
        let hwp = parse_hwp_from_cpuid_and_registry("Intel(R) Core(TM) i7-13700K", Some(eax), Some(1)).unwrap();
        assert!(hwp.hwp_supported);
        assert_eq!(hwp.boost_mode, "moderate");
    }

    #[test]
    fn hwp_not_supported_amd() {
        // AMD: skip HWP detection (CPPC2 instead)
        let eax: u32 = 0x00000000;
        let hwp = parse_hwp_from_cpuid_and_registry("AMD Ryzen 7 7800X3D", Some(eax), None);
        assert!(hwp.is_none(), "AMD: no HWP probe");
    }

    #[test]
    fn boost_mode_disabled() {
        let mode = boost_mode_from_perfboostmode(0);
        assert_eq!(mode, "disabled");
    }

    #[test]
    fn boost_mode_aggressive() {
        let mode = boost_mode_from_perfboostmode(3);
        assert_eq!(mode, "aggressive");
    }

    #[test]
    fn registry_perfboostmode_read_fails_defaults_to_unknown() {
        let hwp = parse_hwp_from_cpuid_and_registry("Intel(R) Core(TM) i5-8400", Some(0x00040016), None);
        assert!(hwp.is_some());
        assert_eq!(hwp.unwrap().boost_mode, "unknown");
    }
}
```

**Effort:** M (medium) — CPUID instruction execution + registry read + threshold logic.

---

## Probe #9: AMD Precision Boost Overdrive (PBO) State

**Verdict:** `partial`

### Source
- **ACPI device:** `AMDI0010` SMU (System Management Unit) enumerable via `WMIConnection` + `SetupAPI`.
- **Registry (if RyzenMaster installed):** `HKEY_LOCAL_MACHINE\SOFTWARE\AMD\RyzenMaster` (may contain PBO settings snapshot, stale).
- **ADLX SDK:** CPU-side interfaces not yet exposed in Rust binding (only GPU sensors current).

### Honest Claim
- **PBO presence:** ACPI AMDI0010 device exists on Ryzen platform = SMU available (prerequisite for PBO).
- **PBO enabled/disabled state (OEM-dependent):** Some BIOS implementations expose state via ACPI properties; many do not (firmware-only).
- **Best-effort:** Try ACPI device enum + optional RyzenMaster registry fallback; if both unavailable, report \"Unsupported on this system\".

### Cannot Claim
- PBO numeric limits (PPT watts, TDC amps, EDC amps). Not exposed via user-mode API.
- Current boost frequency or live boost activation.
- PBO limits set by user (BIOS-only; would need SMU communication or driver).
- Whether PBO is active *right now* (requires real-time SMU polling, not exposed in user-mode).

### Surface
**Check tab (\"AMD Ryzen Power\" card, AMD-only):**
- Row: \"Precision Boost Overdrive (PBO)\" → \"Enabled\" / \"Disabled\" / \"Unsupported on this system\" / \"Unknown (RyzenMaster app shows actual state)\".
- Note: \"PBO allows dynamic frequency scaling within user-set limits. Check RyzenMaster or BIOS to adjust PBO settings.\"

**Diagnostics (\"Power & Boot\" section, AMD-only):**
- Add: \"PBO State\" → state string.

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct AmdPboInfo {
    pub(crate) pbo_readable: bool,  // Can we read PBO state at all?
    pub(crate) pbo_state: String,  // "enabled", "disabled", "unsupported", "unknown"
    pub(crate) source: String,     // "acpi", "registry", "unavailable"
}

// In HardwareInfo:
pub(crate) amd_pbo: Option<AmdPboInfo>,
```

### TypeScript Type
```typescript
type AmdPboInfo = {
  pbo_readable: boolean;
  pbo_state: string;
  source: string;
};
type HardwareInfo = {
  // ...
  amd_pbo?: AmdPboInfo | null;
};
```

### IPC Wiring
- New helper: `detect_amd_pbo()` in hardware.rs (returns None if not AMD).
- Called in `collect_hardware_inner()`.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (captured ACPI + registry fixtures):**
```rust
#[cfg(test)]
mod amd_pbo_tests {
    use super::{detect_amd_pbo_from_fixtures, is_amd_cpu, parse_acpi_smu_property};

    #[test]
    fn amd_ryzen_pbo_readable_from_acpi() {
        // Fixture: ACPI AMDI0010 device with PBO property
        let acpi_fixture = r#"{"DeviceID": "AMDI0010", "DeviceName": "AMD SMU", "Properties": {"PBOState": 1}}"#;
        let pbo = detect_amd_pbo_from_fixtures("AMD Ryzen 9 7950X", Some(acpi_fixture), None).unwrap();
        assert!(pbo.pbo_readable);
        assert_eq!(pbo.pbo_state, "enabled");
        assert_eq!(pbo.source, "acpi");
    }

    #[test]
    fn amd_pbo_unsupported_on_intel() {
        // Intel: no PBO probe
        let pbo = detect_amd_pbo_from_fixtures("Intel(R) Core(TM) i7-13700K", None, None);
        assert!(pbo.is_none(), "Intel: no PBO detection");
    }

    #[test]
    fn amd_pbo_fallback_ryzenmaster_registry() {
        // Fixture: ACPI not available, but RyzenMaster registry exists
        let registry_fixture = r#"{"PBOEnabled": 1}"#;
        let pbo = detect_amd_pbo_from_fixtures("AMD Ryzen 5 5600X", None, Some(registry_fixture)).unwrap();
        assert_eq!(pbo.source, "registry");
        assert_eq!(pbo.pbo_state, "enabled");
    }

    #[test]
    fn amd_pbo_unknown_if_both_unavailable() {
        let pbo = detect_amd_pbo_from_fixtures("AMD Ryzen 7 3700X", None, None).unwrap();
        assert!(!pbo.pbo_readable);
        assert_eq!(pbo.pbo_state, "unknown");
        assert_eq!(pbo.source, "unavailable");
    }

    #[test]
    fn is_amd_cpu() {
        assert!(is_amd_cpu("AMD Ryzen 7 7800X3D"));
        assert!(!is_amd_cpu("Intel(R) Core(TM) i7-13700K"));
    }
}
```

**Effort:** M (medium) — ACPI device enum + optional registry fallback. OEM-dependent results, honest caveat required.

---

## Probe #10: Core-Parking Policy Configuration (Not Instantaneous State)

**Verdict:** `partial`

### Source
- **Registry:** `HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\Power\PowerSettings\54533251-82be-4824-96c1-47b60b740d00` (CPU Policy), sub-GUIDs:
  - `0cc5b647-c1df-4637-891a-dec35c318583`: CPMinCores (% minimum unparked).
  - `3b9d966f-b7d6-4d47-b74f-3e0f3335c6be`: CPMaxCores (% maximum parked).
  - `36687f9e-e3a5-4dbf-b1dc-4b966f5f6a54`: CpLatencyHintUnpark (latency-aware parking).
- **Fallback:** `powercfg /query` shell output parsing (human-readable, stable format).
- **Limitation:** These are **policy config only** — the instantaneous state (which cores are actually parked *right now*) is kernel-managed, not exposed to user-mode (Power Policy Engine, PEP).

### Honest Claim
- **Policy display:** \"Core Parking Policy: [Enabled | Disabled]\\nMin unparked: X%\\nMax unparked: Y%\\nLatency hint: Z\\nNote: Real-time parking state requires kernel access.\".
- **Configuration:** What Windows *allows* in the parked range; does NOT claim actual cores parked.

### Cannot Claim
- Current parked core count (instantaneous state, kernel-only).
- Per-core parking state (which specific core IDs are parked).
- Performance impact of parking policy.

### Surface
**Diagnostics (\"Power & Boot\" section):**
- Add: \"Core Parking Policy\" → \"Enabled (Min X%, Max Y%)\" or \"Disabled\" or \"Not configured\" or \"Unavailable\".
- Note: \"Kernel manages actual core parking state; this shows the configured policy. Enable parking to save power, disable for consistent latency.\"

**Check tab (optional, informational):**
- Passive display if core parking is disabled (rare on modern Win11; default is enabled).

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct CoreParkingPolicy {
    pub(crate) parking_enabled: Option<bool>,
    pub(crate) min_unparked_pct: Option<u32>,
    pub(crate) max_unparked_pct: Option<u32>,
    pub(crate) latency_hint_pct: Option<u32>,
}

// In HardwareInfo:
pub(crate) core_parking_policy: Option<CoreParkingPolicy>,
```

### TypeScript Type
```typescript
type CoreParkingPolicy = {
  parking_enabled?: boolean | null;
  min_unparked_pct?: number | null;
  max_unparked_pct?: number | null;
  latency_hint_pct?: number | null;
};
type HardwareInfo = {
  // ...
  core_parking_policy?: CoreParkingPolicy | null;
};
```

### IPC Wiring
- New helper: `detect_core_parking_policy()` in hardware.rs.
- Called in `collect_hardware_inner()`.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (captured registry + powercfg fixtures):**
```rust
#[cfg(test)]
mod core_parking_tests {
    use super::{parse_core_parking_registry, parse_powercfg_output};

    #[test]
    fn core_parking_registry_read() {
        // Fixture: Registry DWORD values
        let reg_fixture = r#"{"CPMinCores": 25, "CPMaxCores": 100, "CpLatencyHintUnpark": 50}"#;
        let policy = parse_core_parking_registry(reg_fixture).unwrap();
        assert_eq!(policy.min_unparked_pct, Some(25));
        assert_eq!(policy.max_unparked_pct, Some(100));
        assert_eq!(policy.latency_hint_pct, Some(50));
    }

    #[test]
    fn powercfg_output_parsing() {
        // Fixture: Real powercfg /query output (truncated)
        let powercfg_output = r#"
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  Power Settings
    Subgroup GUID: 54533251-82be-4824-96c1-47b60b740d00  (CPU)
      Setting GUID: 0cc5b647-c1df-4637-891a-dec35c318583  (Min parked cores)
        Current AC Power Setting Index: 0x00000019
      Setting GUID: 3b9d966f-b7d6-4d47-b74f-3e0f3335c6be  (Max parked cores)
        Current AC Power Setting Index: 0x00000064
        "#;
        let policy = parse_powercfg_output(powercfg_output).unwrap();
        assert_eq!(policy.min_unparked_pct, Some(25)); // 0x19 = 25 in decimal
        assert_eq!(policy.max_unparked_pct, Some(100)); // 0x64 = 100
    }

    #[test]
    fn core_parking_missing_keys_graceful() {
        let reg_fixture = r#"{"CPMinCores": 25}"#;  // Max missing
        let policy = parse_core_parking_registry(reg_fixture).unwrap();
        assert_eq!(policy.min_unparked_pct, Some(25));
        assert_eq!(policy.max_unparked_pct, None);
    }
}
```

**Effort:** M (medium) — Registry read + powercfg parsing + policy config display. No kernel calls.

---

## Probe #11: System Power Draw (Platform / AC-DC State)

**Verdict:** `partial`

### Source
- **Power state (AC/DC):** Win32 API `GetSystemPowerStatus()` (always available, no WMI).
- **Battery info (laptops/UPS):** WMI `Win32_Battery` (namespace `root\cimv2`), properties: `BatteryStatus`, `EstimatedChargeRemaining`, `EstimatedRunTime`.
- **Platform power draw (rare):** WMI `Win32_PowerMeter` (namespace `root\cimv2\power`), properties: `CurrentReading`, `BaseUnits`, `UnitModifier` (calculates watts). OEM-dependent; most consumer desktops return zero instances.
- **CPU package power:** RAPL MSRs (kernel-only, forbidden).

### Honest Claim
- **AC/DC state:** \"On AC power\" / \"On battery\" (from `GetSystemPowerStatus()`).
- **Battery % (laptops):** `EstimatedChargeRemaining` percent.
- **Time to full charge:** Computed from `EstimatedRunTime` if charging.
- **Platform watts (rare):** If Win32_PowerMeter instances exist, display \"System consuming X watts\"; otherwise, omit entirely (fail-soft, never fabricate).

### Cannot Claim
- CPU package power in watts (RAPL MSRs, kernel-only).
- PSU efficiency or wattage rating.
- Per-component power breakdown (GPU power yes via ADLX/NVML, CPU power no).
- Predicted battery life (EstimatedRunTime is manufacturer estimate, varies by load).

### Surface
**Check tab (new \"Power State\" row, optional):**
- \"Power Source\" → \"AC\" / \"Battery (87%)\".
- \"Time to full charge\" (if charging on laptop).
- \"System Power Draw\" → \"X watts\" (if Win32_PowerMeter available, else \"Unavailable\").

**Diagnostics (\"Power & Boot\" section):**
- Add: \"Power Source\" → AC / Battery + percent.
- Add: \"Platform Power Draw\" → watts or skip.

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct PowerStateInfo {
    pub(crate) on_battery: bool,  // false = AC power
    pub(crate) battery_percent: Option<u32>,  // None = not a laptop/UPS
    pub(crate) battery_health: Option<String>,  // "Good", "Degraded", "Failed" (from Win32_Battery.Status)
    pub(crate) time_to_full_charge_minutes: Option<u32>,
    pub(crate) platform_power_draw_watts: Option<f64>,  // If Win32_PowerMeter populated
}

// In HardwareInfo:
pub(crate) power_state: Option<PowerStateInfo>,
```

### TypeScript Type
```typescript
type PowerStateInfo = {
  on_battery: boolean;
  battery_percent?: number | null;
  battery_health?: string | null;
  time_to_full_charge_minutes?: number | null;
  platform_power_draw_watts?: number | null;
};
type HardwareInfo = {
  // ...
  power_state?: PowerStateInfo | null;
};
```

### IPC Wiring
- New helper: `detect_power_state()` in hardware.rs.
- Called in `collect_hardware_inner()`.
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (OS API mock fixtures):**
```rust
#[cfg(test)]
mod power_state_tests {
    use super::{parse_getsystempowerstatus, parse_win32_battery, parse_power_meter};

    #[test]
    fn system_power_status_ac() {
        // Fixture: GetSystemPowerStatus result on AC power
        let fixture = (1, 255, 0, 0);  // ACLineStatus=1 (AC), BatteryFlag=255, BatteryLife=0, reserved=0
        let state = parse_getsystempowerstatus(fixture).unwrap();
        assert!(!state.on_battery);
        assert_eq!(state.battery_percent, None);
    }

    #[test]
    fn system_power_status_battery_85_percent() {
        // Fixture: On battery, 85% remaining, estimated ~2 hours
        let fixture = (0, 2, 85, 0);  // ACLineStatus=0 (battery), BatteryFlag=2 (discharging)
        let state = parse_getsystempowerstatus(fixture).unwrap();
        assert!(state.on_battery);
        assert_eq!(state.battery_percent, Some(85));
    }

    #[test]
    fn win32_battery_charging() {
        let battery_json = r#"{"BatteryStatus": 2, "EstimatedChargeRemaining": 75, "EstimatedRunTime": 180}"#;
        let battery = parse_win32_battery(battery_json).unwrap();
        assert_eq!(battery.battery_percent, Some(75));
        assert_eq!(battery.time_to_full_charge_minutes, Some(180));
    }

    #[test]
    fn win32_power_meter_rare_on_consumer() {
        // Fixture: No Win32_PowerMeter instances on most desktops
        let result: Vec<String> = vec![];  // Empty
        let watts = parse_power_meter(&result);
        assert_eq!(watts, None, "No power meter on consumer rig");
    }

    #[test]
    fn win32_power_meter_enterprise() {
        // Fixture: Enterprise server/workstation with PowerMeter
        let pm_json = r#"{"CurrentReading": 150000000, "BaseUnits": 0, "UnitModifier": -7}"#;
        let watts = parse_power_meter(&[pm_json]).unwrap();
        assert!(watts > 100.0 && watts < 200.0, "~150W on enterprise rig");
    }
}
```

**Effort:** M (medium) — Multiple sources (GetSystemPowerStatus API, WMI, optional PowerMeter). Graceful desktop degrade.

---

## Probe #12: USB Device Hierarchy + Specification Version

**Verdict:** `partial`

### Source
- **Hierarchy:** CfgMgr32 API (`CM_Get_Parent`, `CM_Get_Child`); SetupAPI `SetupDiEnumDeviceInfo`; WMI `Win32_USBController`, `Win32_USBHub`.
- **Specification version:** Device Instance ID strings (e.g., `USB\ROOT_HUB30`, `USB\ROOT_HUB`, `USB4\ROOT_DEVICE_ROUTER`) encode version (2.0, 3.0, 3.1, 4.0).
- **Negotiated link speed:** NOT exposed in user-mode (driver state, not firmware/registry).

### Honest Claim
- **Device tree:** Root hubs, external hubs, devices enumerated with parent-child relationships.
- **USB version:** Classified from DeviceID string (\"USB 2.0\", \"USB 3.0\", \"USB 3.1\", \"USB4\").
- **Device name:** Friendly name from WMI or SetupAPI.

### Cannot Claim
- Actual negotiated link speed (5 Gbps, 10 Gbps, 20 Gbps per USB 3.x spec). Only the *version* is detectable.
- Real-time connection state per port.
- Device hot-swap history.
- USB Power Delivery negotiated voltage/amperage.

### Surface
**Lab surface (optional \"USB Device Tree\"):**
- Hierarchical tree view with indentation.
- Example:
  ```
  USB 3.1 Root Hub (8 ports)
    ├─ USB 3.0 Hub (external)
    │  ├─ USB 3.0 SSD (Samsung)
    │  └─ USB 3.0 Flash Drive
    └─ USB 2.0 Keyboard
  USB 2.0 Root Hub (4 ports)
  ```
- Caveat: \"Version is from spec; actual negotiated speed unknown in user-mode.\"

**Check tab (optional, informational):**
- \"USB devices: N total, X on root hubs, Y on external hubs.\"

### New Serde Field
```rust
#[derive(Serialize, Clone, Default)]
pub(crate) struct UsbDevice {
    pub(crate) name: String,
    pub(crate) usb_version: String,  // "2.0", "3.0", "3.1", "4.0", "unknown"
    pub(crate) parent_index: Option<usize>,  // Parent device array index (for tree reconstruction)
    pub(crate) is_hub: bool,
    pub(crate) port_count: Option<u32>,
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct UsbDeviceTree {
    pub(crate) devices: Vec<UsbDevice>,
    pub(crate) total_devices: usize,
    pub(crate) root_hub_count: usize,
}

// In HardwareInfo:
pub(crate) usb_tree: Option<UsbDeviceTree>,
```

### TypeScript Type
```typescript
type UsbDevice = {
  name: string;
  usb_version: string;
  parent_index?: number | null;
  is_hub: boolean;
  port_count?: number | null;
};
type UsbDeviceTree = {
  devices: UsbDevice[];
  total_devices: number;
  root_hub_count: number;
};
type HardwareInfo = {
  // ...
  usb_tree?: UsbDeviceTree | null;
};
```

### IPC Wiring
- New helper: `detect_usb_device_tree()` in hardware.rs.
- Called in `collect_hardware_inner()` (optional, may be gated behind a feature flag if expensive).
- Data flows through existing `get_hardware_info()`.

### TDD Test Plan
**Pure parser test (captured WMI + registry fixtures):**
```rust
#[cfg(test)]
mod usb_tree_tests {
    use super::{parse_usb_hierarchy_from_fixtures, classify_usb_version};

    #[test]
    fn usb_version_from_device_id() {
        assert_eq!(classify_usb_version("USB\\ROOT_HUB30"), "3.0");
        assert_eq!(classify_usb_version("USB\\ROOT_HUB"), "2.0");
        assert_eq!(classify_usb_version("USB4\\ROOT_DEVICE_ROUTER"), "4.0");
        assert_eq!(classify_usb_version("USB\\VID_0951&PID_1666\\08606E6B"), "unknown"); // Generic device, no hub marker
    }

    #[test]
    fn usb_hierarchy_tree() {
        // Fixture: WMI + registry representing a simple tree
        let fixture = r#"
        [
          {"DeviceName": "USB 3.1 Root Hub", "DeviceID": "USB\\ROOT_HUB31", "ParentDeviceID": null},
          {"DeviceName": "Samsung 990 PRO", "DeviceID": "USB\\VID_0955&PID_1234\\S/N123", "ParentDeviceID": "USB\\ROOT_HUB31"},
          {"DeviceName": "USB 3.0 External Hub", "DeviceID": "USB\\ROOT_HUB30\\1", "ParentDeviceID": "USB\\ROOT_HUB31"}
        ]
        "#;
        let tree = parse_usb_hierarchy_from_fixtures(fixture).unwrap();
        assert_eq!(tree.devices.len(), 3);
        assert_eq!(tree.root_hub_count, 1); // Only the first, parentless device
        assert_eq!(tree.devices[1].parent_index, Some(0)); // Samsung under Root Hub 31
    }

    #[test]
    fn usb_device_no_hub_indicators() {
        // Generic device without hub marker
        let dev = classify_device_from_fixture(r#"{"DeviceName": "Keyboard", "DeviceID": "USB\\VID_1234&PID_5678"}"#).unwrap();
        assert!(!dev.is_hub);
        assert_eq!(dev.port_count, None);
    }
}
```

**Effort:** M (medium) — CfgMgr32 / SetupAPI enumeration + hierarchy reconstruction. Complex tree logic, low priority.

---

## Probe #13: Fan-Curve Profile / Fan-Control Mode (Informational Only)

**Verdict:** `vendor-sdk-only`

### Source
- **ADLX (AMD GPU):** `gpu_fan_speed_range()` returns min/max RPM (capability hint).
- **NVML (NVIDIA GPU):** `fan_speed()` returns current fan %, no curve or mode API.
- **CPU fans:** No Win32_Fan/CIM_Fan instances on Windows 11 Home/Pro.

### Honest Claim
- **Fan speed (live):** Instantaneous reading (already exposed in `get_gpu_sensors()` per Probe #5, GPU path).
- **Fan speed range (capability hint):** \"GPU fans can run 500–5000 RPM\" (from ADLX/NVML range query, if available).
- **Cannot read mode:** \"Control mode (auto/performance/quiet/custom) unavailable in user-mode.\".

### Cannot Claim
- Fan curve profile (setpoint data, vendor-proprietary format).
- Active control mode (auto vs. manual, performance level).
- CPU fan state/speed.

### Surface
**Monitoring/Overlay tab (GPU section, extend existing):**
- Extend the current \"GPU Fan\" row to show range: \"Fan: 2100 RPM (range 500–5000)\".
- Optional icon with note: \"Active fan curve unavailable; NVIDIA Control Panel or AMD Adrenalin can show detailed settings.\"

**Check tab (GPU sub-section, informational):**
- \"GPU Fan Control\" → \"Capable. Actual mode unavailable in user-mode.\".

### Serde (No New Fields)
- Reuse existing `GpuSensorSnapshot.fan_speed_rpm` (ADLX) and `.fan_speed_pct` (NVML).
- Extend with optional `fan_speed_range_min` / `fan_speed_range_max` (new fields).

### TypeScript Type (Extend Existing)
```typescript
type GpuSensorSnapshot = {
  // ... existing ...
  fan_speed_rpm?: number | null;
  fan_speed_pct?: number | null;
  fan_speed_range_min?: number | null;  // NEW
  fan_speed_range_max?: number | null;  // NEW
};
```

### IPC Wiring
- Extend `get_gpu_sensors()` (monitoring.rs:642–652) to query ADLX/NVML for fan range.
- No new command; data flows through existing `get_gpu_sensors()`.

### TDD Test Plan
**Pure parser test (ADLX/NVML fixture mock):**
```rust
#[cfg(test)]
mod fan_curve_tests {
    use super::{parse_fan_speed_range};

    #[test]
    fn adlx_fan_range_amd() {
        let fixture = r#"{"min_rpm": 500, "max_rpm": 5000}"#;
        let range = parse_fan_speed_range(fixture).unwrap();
        assert_eq!(range.min_rpm, Some(500));
        assert_eq!(range.max_rpm, Some(5000));
    }

    #[test]
    fn nvml_fan_range_percentage_nvidia() {
        // NVML returns % not RPM
        let range = parse_fan_speed_range_nvml().unwrap();
        assert_eq!(range.min_pct, Some(0));
        assert_eq!(range.max_pct, Some(100));
    }

    #[test]
    fn fan_range_unavailable_if_sdk_absent() {
        let range = parse_fan_speed_range("{}");  // Empty mock
        assert_eq!(range.min_rpm, None);
    }
}
```

**Effort:** S (small) — Reuse existing GPU sensor infrastructure; add range query only.

---

## Honesty Drops (What Compy Will NOT Detect)

### Blocked by Kernel Access (Hard Constraint, No Workaround)
1. **CPU die temperature.** MSR reads (IA32_THERM_STATUS, 0x19C) require ring-0. No public Win32 API. SMBIOS Type 28 (Temperature Sensor) is rarely populated on consumer boards. **Verdict:** Infeasible in user-mode. Period.
2. **Instantaneous core-parking state** (which cores are parked *right now*). Kernel Power Policy Engine (PEP) controls this; no user-mode API. ETW/debugger require admin + special tools. **Verdict:** Config readable, state not.
3. **MSR reads** (P-state frequency, boost state, EPB setting, thermal limits, etc.). Require ring-0 or WinRing0 kernel driver (forbidden by policy). **Verdict:** Blocked.
4. **BIOS password status.** Firmware-only, no Windows API. **Verdict:** Infeasible.
5. **BIOS boot order / UEFI variables.** Firmware-only (except EFI system partition, which is not boot order). **Verdict:** Infeasible.
6. **CPU microcode version.** CPUID instruction executed but microcode metadata is kernel-interpreted. **Verdict:** Infeasible.

### Blocked by Data Unavailability (No Standard Mechanism)
7. **XMP profile index/name** (which of XMP1, XMP2, EXPO OC, EXPO DC is active). SMBIOS Type 17 exposes only configured speed, not profile. **Verdict:** Only speed comparison available.
8. **SSD wear-out % / TBW consumed.** Vendor-proprietary SMART attributes, unparseable in user-mode. Win32_DiskDrive.Status is binary flag only. **Verdict:** Vendor SDK per manufacturer required (Samsung MZ, WD Dashboard, etc.). Compy does not integrate these.
9. **CPU fan speed / control mode.** Win32_Fan/CIM_Fan WMI classes return zero instances on Windows 11 Home/Pro. No registry path. Requires EC/SMM access. **Verdict:** GPU fans yes (ADLX/NVML), CPU fans no.
10. **Network adapter WoL (Wake-on-LAN) state.** WMI Win32_NetworkAdapter.Wake* properties require admin. User-mode access denied. **Verdict:** Admin-only.
11. **TPM firmware version / endorsement key status.** Win32_Tpm presence readable in user-mode; internal state requires admin/TPM driver. **Verdict:** Config readable, state not.
12. **Active running VMs on Hyper-V host.** Hyper-V admin WMI namespaces (root/virtualization) require admin or hyper-v-admin group. User-mode query fails. **Verdict:** Infeasible.
13. **Nested virtualization capability / VM Gen status.** Hyper-V admin API only. **Verdict:** Infeasible.
14. **VBS runtime protection validation** (is Memory Integrity *actually* blocking injections?). VBS reports config/state, not proof of protection. **Verdict:** No user-mode telemetry available.
15. **Actual negotiated USB link speed** (5 Gbps, 10 Gbps, 20 Gbps). Only version spec detectable. Driver state, not firmware/registry. **Verdict:** Version yes, speed no.
16. **GPU memory utilization (VRAM consumed).** AMD ADLX exposes this (verified on dev rig). NVIDIA NVML can report it (unverified, no NVIDIA GPU on dev rig). Intel = not yet integrated. Compy does not yet include this in monitoring.rs. **Verdict:** Future R3 feature.
17. **Disk I/O throughput** (current read/write Mbps per disk). WMI perf counter class exists but often blocked by policy or unavailable on consumer systems. Complex sampling, not instantaneous. **Verdict:** Out of scope (requires real-time poller).
18. **Intel MEBx (BIOS HWP toggle) state.** BIOS firmware setup only, not exposed to Windows. **Verdict:** Capability yes (CPUID bit 7), toggle state no.
19. **PBO numeric limits** (PPT watts, TDC amps, EDC amps). No user-mode API or registry key exposes these. ADLX CPU performance monitoring not yet exposed in Rust binding. **Verdict:** Best-effort on enabled/disabled state only.
20. **Fan curve profile** (actual setpoint data, frequency/temperature mapping). Vendor-proprietary format, no standard WMI/registry. ADLX/NVML expose speed only, no curve. **Verdict:** Speed yes, curve no.

### Infeasible on This Hardware / Unverified
21. **NVIDIA GPU sensors (temperature, utilization, power, fan).** Implementation exists via NVML (windows-nvidia-smi crate). **NOT hardware-verified** — dev rig is AMD-only. Labeled \"implemented, not yet hardware-verified\" in UI until a production NVIDIA session proves NVML queries succeed and values are meaningful. **Verdict:** AMD verified, NVIDIA unverified, Intel planned.
22. **Intel XMP vs AMD EXPO distinction.** Both use SMBIOS Type 17 configured speed. Heuristic: CPU brand + speed match known Intel/AMD profiles (out of scope for A1, would require profile database). **Verdict:** Combined XMP/EXPO detection only.

---

## Build Order Summary

**Batches (sequential dependency within, parallel across):**

**Batch 1 (Foundation, no deps):**
- Probe #1 (BIOS version + date) — WMI single-class read.
- Probe #14 (GPU driver freshness + NIC driver surface) — Reuse existing parsing, extend UI.

**Batch 2 (Extend existing, depends on Batch 1):**
- Probe #2 (XMP/EXPO active) — Extend MemoryModuleInfo, existing SMBIOS.
- Probe #7 (BIOS tweak capabilities) — Aggregate Batch 1 + existing WMI.

**Batch 3 (WMI + registry, independent):**
- Probe #4 (Thermal throttling) — WMI perf counter + bitflag.
- Probe #5 (Hyper-V/VBS) — Win32_DeviceGuard + registry.
- Probe #6 (S.M.A.R.T. health) — Win32_DiskDrive.Status string match.
- Probe #8 (Intel HWP) — CPUID + registry.
- Probe #9 (AMD PBO) — ACPI device enum + registry fallback.
- Probe #10 (Core parking policy) — Registry + powercfg parse.
- Probe #11 (Power state) — Win32 API + WMI Battery + optional PowerMeter.

**Batch 4 (Complex enumeration, optional):**
- Probe #12 (USB device tree) — CfgMgr32 + SetupAPI + WMI.
- Probe #13 (Fan-curve info) — Extend existing GPU sensors.

---

## Testing Strategy

**All tests are pure Rust unit tests or fixtures (no live hardware required in CI):**

1. **CIM_DATETIME parsing:** Reuse existing test vectors (hardware.rs:~1540+).
2. **WMI deserialization:** Mock JSON fixtures (serde test vectors).
3. **Bitflag / threshold logic:** Pure logic, no I/O.
4. **Registry parsing:** Captured .reg files or JSON mock fixtures.
5. **Binary SMBIOS parsing:** Captured Type 17/Type 0 binary buffer fixtures.
6. **Hierarchy reconstruction (USB tree):** Mock parent-child arrays.

**Zero network calls. Zero hardware requirement. All CI-safe.**

---

## Integration Timeline

1. **Week 1:** Probes #1, #2, #14 (foundation + immediate surface).
2. **Week 2:** Probe #7 (aggregate, depends on #1).
3. **Week 3:** Probes #4, #5, #6 (independent WMI/registry reads).
4. **Week 4:** Probes #8, #9, #10 (CPU-specific, Intel/AMD paths).
5. **Week 5:** Probe #11 (power state, optional gating).
6. **Week 6:** Probes #12, #13 (optional/low-priority).
7. **Week 7–8:** Integration test + surface polish (Check, Diagnostics, Lab).

---

## Appendix: AMD Rule #5 (Hardware Verification Status)

- **AMD GPU (Radeon RX 9070 XT, dev rig):** ADLX sensors (temp, utilization, power, fan RPM, VRR state) are **hardware-verified**. Marked as \"verified\" in all UI.
- **NVIDIA GPU (no dev rig hardware):** NVML implementation exists (windows-nvidia-smi crate). NVIDIA bindings in monitoring.rs:596–639. Sensors (clock, utilization, power, fan, temperature) are **implemented, not yet hardware-verified**. Labeled \"implemented, unverified (requires NVIDIA GPU for validation)\" in all UI until a production session confirms NVML queries work and values are meaningful.
- **Intel GPU:** Planned. Not yet implemented. Skip for this A1 spec.

---

## Closing Note: Receipts Doctrine

**Every claim in Compy is backed by user-mode measurement or honest silence.**

If a probe cannot read (kernel access required, OEM firmware missing, vendor SDK absent), the UI displays nothing — or an explicit caveat: \"unavailable in user-mode\", \"(kernel access required)\", \"(RyzenMaster app shows actual state)\".

Never fabricate. Never guess. Never threshold a missing value. Compy speaks only what it can measure.

"

