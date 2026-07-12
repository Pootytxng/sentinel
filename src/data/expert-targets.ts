// Expert-view exact targets (spec 2026-07-11-expert-layer-middle-ground §1, owner GO 2026-07-12).
// A FRONTEND-ONLY display map: rec id → the exact registry key / service / setting the tweak
// touches — the Tinkerer's "here's exactly where each one lives". DISPLAY ONLY: nothing here is
// executed, parsed, or fed back into any apply path; the mutation boundary stays actions.rs alone.
//
// GROUND TRUTH: every string below is transcribed from the actual mutation/advisory source —
// actions.rs (apply_*), services.rs (service names), baseline-rules-v1.json (advisory locations).
// If an apply_* changes its target, update the matching line here (guarded by expert-targets.test.ts
// which pins the load-bearing literals).
//
// SHIP CONDITION (spec Status block): wherever one of these renders inline, the UI MUST show the
// one-line disclaimer beside it — see EXPERT_TARGET_DISCLAIMER below. Showing the raw target is new
// information exposure; the honest boundary ships with it.

/** The one-line honesty boundary that must render beside every inline target. */
export const EXPERT_TARGET_DISCLAIMER =
  "Edits made outside Compy aren't tracked and can't be rolled back by Compy.";

// Kind is display flavor only (a small chip/prefix): where the setting lives.
export type ExpertTarget = {
  kind: "registry" | "service" | "power" | "system" | "location";
  /** The exact target, transcribed from the apply/advisory source. */
  target: string;
};

export const EXPERT_TARGETS: Record<string, ExpertTarget> = {
  // ── Compy-appliable (targets = what apply_* in actions.rs actually writes) ──
  "game-mode": {
    kind: "registry",
    // actions.rs GAMEBAR_KEY + GAME_MODE_ENABLED/ALLOW_VALUE — both values, or Windows reverts on login.
    target: "HKCU\\Software\\Microsoft\\GameBar → AutoGameModeEnabled + AllowAutoGameMode = 1",
  },
  "visual-effects": {
    kind: "registry",
    // apply_set_visual_effects_best_performance: VisualFXSetting=2 + the documented UserPreferencesMask.
    target:
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects → VisualFXSetting = 2 (+ Control Panel\\Desktop → UserPreferencesMask)",
  },
  "sysmain-disable": {
    kind: "service",
    target: "Windows service “SysMain” (Superfetch) → startup type Disabled, then stopped",
  },
  "nvidia-telemetry": {
    kind: "service",
    target: "Windows service “NvTelemetryContainer” → startup type Disabled, then stopped",
  },
  "diagtrack-disable": {
    kind: "service",
    target: "Windows service “DiagTrack” (Connected User Experiences) → startup type Disabled, then stopped",
  },
  "windows-search-disable": {
    kind: "service",
    target: "Windows service “WSearch” (Windows Search indexer) → startup type Disabled, then stopped",
  },
  "power-ultimate": {
    kind: "power",
    // apply path: activate existing Ultimate plan or powercfg /duplicatescheme e9a42b02… then /setactive.
    target: "powercfg → activate “Ultimate Performance” plan (duplicated from scheme e9a42b02-d5df-448d-aa00-03f14749eb61 if absent)",
  },
  "nagle-disable": {
    kind: "registry",
    target:
      "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\<your physical NIC> → TcpAckFrequency = 1 + TCPNoDelay = 1",
  },
  "hags-enable": {
    kind: "registry",
    target: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers → HwSchMode = 2",
  },
  "mouse-accel-off": {
    kind: "registry",
    target: "HKCU\\Control Panel\\Mouse → MouseSpeed, MouseThreshold1, MouseThreshold2 = 0",
  },
  "game-bar-disable": {
    kind: "registry",
    target:
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR → AppCaptureEnabled = 0 + HKCU\\System\\GameConfigStore → GameDVR_Enabled = 0",
  },
  "fast-startup-off": {
    kind: "registry",
    target: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power → HiberbootEnabled = 0",
  },
  "reserved-storage-off": {
    kind: "system",
    target: "Set-WindowsReservedStorageState -State Disabled (Windows reserved-storage state)",
  },
  "usb-selective-suspend-off": {
    kind: "power",
    // PWR_SUBGROUP_USB / PWR_SETTING_USB_SELECTIVE_SUSPEND in actions.rs; AC value only.
    target:
      "powercfg → current plan, USB subgroup 2a737441-1930-4402-8d77-b2bebba308a3, setting 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 (USB selective suspend) → AC = 0",
  },
  "pcie-aspm-off": {
    kind: "power",
    // PWR_SUBGROUP_PCIE / PWR_SETTING_PCIE_ASPM in actions.rs; AC value only.
    target:
      "powercfg → current plan, PCIe subgroup 501a4d13-42af-4429-9fd1-a8218c268e20, setting ee12f906-d277-404b-b6da-e5fa1a576df5 (Link State Power Management) → AC = 0",
  },
  "eee-disable": {
    kind: "system",
    target:
      "Your wired adapter's advanced driver property (Energy-Efficient Ethernet / Green Ethernet / Advanced EEE — vendor-named) → Disabled",
  },

  // ── Advisory / needs-your-call (targets = the setting's real location, from the catalog) ──
  "memory-integrity-vbs-advisory": {
    kind: "location",
    target: "Windows Security → Device security → Core isolation → Memory integrity (VBS)",
  },
  "defender-game-folder-exclusions-advisory": {
    kind: "location",
    target: "Windows Security → Virus & threat protection → Manage settings → Exclusions",
  },
  "vrr-advisory": {
    kind: "location",
    target: "Settings → System → Display → Graphics → VRR, plus your monitor's OSD and the GPU vendor control panel",
  },
  "audio-enhancements-advisory": {
    kind: "location",
    target: "Settings → System → Sound → your output device → Audio enhancements",
  },
  "hdr-advisory": {
    kind: "location",
    target: "Settings → System → Display → HDR → “Use HDR” (per game where offered)",
  },
  "nvidia-low-latency": {
    kind: "location",
    target: "NVIDIA Control Panel → Manage 3D settings → Low Latency Mode → Ultra (per game)",
  },
  "amd-uxp": {
    kind: "location",
    target: "AMD Software: Adrenalin Edition → Settings (gear) → Preferences → User Experience Program → Off",
  },
  "gpu-prefer-discrete": {
    kind: "location",
    target: "Settings → System → Display → Graphics → per-game GPU preference → High performance",
  },
};

/** The exact target for a rec, or null (rec has no mapped target — the row shows none). */
export function expertTarget(id: string): ExpertTarget | null {
  return EXPERT_TARGETS[id] ?? null;
}
