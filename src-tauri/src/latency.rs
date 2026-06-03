//! Latency module (the edge) — **PARKED + DARK**.
//!
//! Design: `docs/superpowers/specs/2026-06-03-latency-module-design.md`.
//!
//! Phase-1 first increment: a **read-only** MSI-mode (Message-Signaled Interrupts) checker.
//! No mutation, no elevation, no network. `mod latency;` only — **not registered** in
//! `lib.rs`'s `invoke_handler`. Any *fix* this surfaces is advisory and would go through the
//! existing typed apply/rollback path, never a new mutation primitive.
#![allow(dead_code)] // parked/dark: wired by HQ when the latency surface lands.

use serde::Serialize;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

/// A PCI device that exposes the MSI setting, and whether MSI is enabled.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct MsiDevice {
    pub name: String,
    /// true = Message-Signaled Interrupts (generally lower latency); false = legacy line IRQ.
    pub msi_on: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct MsiSummary {
    pub total: usize,
    pub msi_on: usize,
    pub msi_off: usize,
}

/// Pure: summarize a set of devices (testable without touching the registry).
pub(crate) fn summarize_msi(devices: &[MsiDevice]) -> MsiSummary {
    let on = devices.iter().filter(|d| d.msi_on).count();
    MsiSummary { total: devices.len(), msi_on: on, msi_off: devices.len() - on }
}

/// Clean a raw registry device description into a friendly name. `DeviceDesc` is often
/// `@oem12.inf,%nvidia_dev%;NVIDIA GeForce RTX 3070` — keep the readable tail.
fn clean_name(raw: &str) -> String {
    raw.rsplit(';').next().unwrap_or(raw).trim().to_string()
}

/// Live: walk `HKLM\…\Enum\PCI` and report each device that exposes the MSI setting.
/// Read-only; degrades to an empty list on any access error — never panics.
pub(crate) fn read_msi_devices() -> Vec<MsiDevice> {
    let mut out = Vec::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(pci) = hklm.open_subkey(r"SYSTEM\CurrentControlSet\Enum\PCI") else {
        return out;
    };
    for vendev in pci.enum_keys().flatten() {
        let Ok(vk) = pci.open_subkey(&vendev) else { continue };
        for inst in vk.enum_keys().flatten() {
            let Ok(ik) = vk.open_subkey(&inst) else { continue };
            let msi = ik
                .open_subkey(r"Device Parameters\Interrupt Management\MessageSignaledInterruptProperties")
                .ok()
                .and_then(|k| k.get_value::<u32, _>("MSISupported").ok());
            let Some(msi) = msi else { continue }; // only devices exposing the setting
            let name = ik
                .get_value::<String, _>("FriendlyName")
                .or_else(|_| ik.get_value::<String, _>("DeviceDesc"))
                .map(|s| clean_name(&s))
                .unwrap_or_else(|_| vendev.clone());
            out.push(MsiDevice { name, msi_on: msi == 1 });
        }
    }
    out
}

/// Convenience the eventual (dark) command would call.
pub(crate) fn msi_report() -> MsiSummary {
    summarize_msi(&read_msi_devices())
}

fn is_latency_sensitive(name: &str) -> bool {
    let n = name.to_lowercase();
    ["geforce", "radeon", "nvidia", "ethernet", "gbe", "network", "wi-fi", "wifi", "nvme", "wireless"]
        .iter()
        .any(|k| n.contains(k))
}

/// Pure: an actionable advisory from the MSI scan — which devices are on legacy line interrupts,
/// prioritizing latency-sensitive ones (GPU/NIC/NVMe). Advisory only; flipping MSI would go through
/// the existing apply/rollback path, never auto-applied.
pub(crate) fn msi_advisory(devices: &[MsiDevice]) -> Option<String> {
    let legacy: Vec<&str> = devices.iter().filter(|d| !d.msi_on).map(|d| d.name.as_str()).collect();
    if legacy.is_empty() {
        return None;
    }
    let sensitive: Vec<&str> = legacy.iter().copied().filter(|n| is_latency_sensitive(n)).collect();
    let highlight = if sensitive.is_empty() { &legacy } else { &sensitive };
    let names = highlight.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    Some(format!(
        "{} device(s) on legacy line interrupts (e.g. {}). MSI usually lowers interrupt latency — advisory, reversible.",
        legacy.len(),
        names
    ))
}

/// System timer resolution, as Windows reports it (100-ns units).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TimerResolution {
    pub coarsest_100ns: u32,
    pub finest_100ns: u32,
    pub current_100ns: u32,
}

impl TimerResolution {
    pub fn current_ms(&self) -> f64 {
        self.current_100ns as f64 / 10_000.0
    }
}

#[allow(non_snake_case)]
extern "system" {
    fn NtQueryTimerResolution(min: *mut u32, max: *mut u32, current: *mut u32) -> i32;
}

/// Read the system timer resolution (read-only). Note: recent Windows applies requested timer
/// resolution **per-process**, so the old global "force 0.5ms" registry hack no longer behaves the
/// way the forums insist — surfacing this honestly out-credibles the tweak guides. None on failure.
pub(crate) fn read_timer_resolution() -> Option<TimerResolution> {
    let (mut min, mut max, mut cur) = (0u32, 0u32, 0u32);
    // SAFETY: ntdll is always present; the call only writes the three out-params.
    let status = unsafe { NtQueryTimerResolution(&mut min, &mut max, &mut cur) };
    if status != 0 {
        return None;
    }
    Some(TimerResolution { coarsest_100ns: min, finest_100ns: max, current_100ns: cur })
}

#[cfg(test)]
mod latency_tests {
    use super::*;

    fn dev(name: &str, on: bool) -> MsiDevice {
        MsiDevice { name: name.into(), msi_on: on }
    }

    #[test]
    fn summarize_counts_on_and_off() {
        let s = summarize_msi(&[dev("GPU", true), dev("NIC", false), dev("NVMe", true)]);
        assert_eq!(s.total, 3);
        assert_eq!(s.msi_on, 2);
        assert_eq!(s.msi_off, 1);
    }

    #[test]
    fn summarize_empty_is_zero() {
        assert_eq!(summarize_msi(&[]), MsiSummary::default());
    }

    #[test]
    fn clean_name_keeps_readable_tail() {
        assert_eq!(clean_name("@oem12.inf,%dev%;NVIDIA GeForce RTX 3070"), "NVIDIA GeForce RTX 3070");
        assert_eq!(clean_name("Realtek PCIe GbE Family Controller"), "Realtek PCIe GbE Family Controller");
    }

    #[test]
    fn reader_never_panics() {
        // Real machine → devices; any sandbox → empty. Must never panic.
        let _ = read_msi_devices();
    }

    #[test]
    fn advisory_none_when_all_msi_on() {
        assert!(msi_advisory(&[dev("GPU", true), dev("NIC", true)]).is_none());
    }

    #[test]
    fn advisory_flags_legacy_and_prioritizes_sensitive() {
        let devs = [
            dev("High Definition Audio Bus", false),
            dev("Realtek Gaming GbE Family", false),
            dev("AMD Radeon RX 9070 XT", false),
        ];
        let a = msi_advisory(&devs).expect("advisory present");
        assert!(a.contains("3 device"));
        // a latency-sensitive device (NIC/GPU) is named ahead of the audio bus
        assert!(a.contains("Radeon") || a.contains("GbE"));
        assert!(!a.contains("Audio"));
    }

    #[test]
    fn timer_resolution_reads_or_degrades() {
        // Real machine → Some (finest ≤ current ≤ coarsest); sandbox → None. Never panics.
        if let Some(t) = read_timer_resolution() {
            assert!(t.finest_100ns <= t.coarsest_100ns);
            assert!(t.current_ms() > 0.0);
        }
    }
}
