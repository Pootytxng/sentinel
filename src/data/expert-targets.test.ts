import { describe, it, expect } from "vitest";
import { EXPERT_TARGETS, EXPERT_TARGET_DISCLAIMER, expertTarget } from "./expert-targets";

// Expert-target guards (spec 2026-07-11-expert-layer-middle-ground §1 + the GO's added ship
// condition). These strings are TRANSCRIBED ground truth from actions.rs / services.rs / the
// catalog — this suite pins the load-bearing literals so a silent edit (or an apply_* retarget
// without the matching display update) trips a red test instead of shipping a wrong "exact target".

// The Compy-appliable catalog (mirrors APPLIABLE_REC_IDS in App.tsx — kept as a literal here on
// purpose: if a new appliable rec ships without an expert target, this list is where the
// mismatch surfaces at review time).
const APPLIABLE = [
  "game-mode",
  "visual-effects",
  "sysmain-disable",
  "nvidia-telemetry",
  "power-ultimate",
  "nagle-disable",
  "hags-enable",
  "mouse-accel-off",
  "game-bar-disable",
  "diagtrack-disable",
  "windows-search-disable",
  "fast-startup-off",
  "reserved-storage-off",
  "usb-selective-suspend-off",
  "pcie-aspm-off",
  "eee-disable",
];

describe("EXPERT_TARGET_DISCLAIMER (the GO's ship condition)", () => {
  it("carries the exact owner-approved rollback-boundary line", () => {
    expect(EXPERT_TARGET_DISCLAIMER).toBe(
      "Edits made outside Compy aren't tracked and can't be rolled back by Compy.",
    );
  });
});

// The refuse-pile trio (mirrors REFUSE_PILE in Fix.tsx). Settings' Expert View copy promises
// "every tweak's technical name and the exact registry key" — the consumer panel (2026-07-14)
// caught that the deliberately-refused tier had no targets, so the promise now covers it too.
const REFUSED = ["useplatformclock", "pagefile-disable", "disable-defender"];

describe("EXPERT_TARGETS coverage", () => {
  it("every Compy-appliable rec has a mapped exact target", () => {
    for (const id of APPLIABLE) {
      expect(expertTarget(id), `missing expert target for appliable rec "${id}"`).not.toBeNull();
    }
  });

  it("every deliberately-refused tweak has a mapped target (the 'every tweak' promise)", () => {
    for (const id of REFUSED) {
      expect(expertTarget(id), `missing expert target for refused tweak "${id}"`).not.toBeNull();
    }
  });

  it("no entry is empty and every kind is a known flavor", () => {
    const kinds = new Set(["registry", "service", "power", "system", "location"]);
    for (const [id, t] of Object.entries(EXPERT_TARGETS)) {
      expect(t.target.trim().length, `empty target for "${id}"`).toBeGreaterThan(10);
      expect(kinds.has(t.kind), `unknown kind "${t.kind}" for "${id}"`).toBe(true);
    }
  });

  it("unmapped ids return null (the row simply shows no target line)", () => {
    expect(expertTarget("not-a-rec")).toBeNull();
  });
});

describe("EXPERT_TARGETS ground-truth literals (transcribed from actions.rs/services.rs)", () => {
  const pin = (id: string, ...literals: string[]) => {
    const t = EXPERT_TARGETS[id];
    expect(t, `no target for "${id}"`).toBeTruthy();
    for (const lit of literals) {
      expect(t.target, `"${id}" target must name ${lit}`).toContain(lit);
    }
  };

  it("registry targets name the real key + value (actions.rs apply_*)", () => {
    pin("game-mode", "Software\\Microsoft\\GameBar", "AutoGameModeEnabled", "AllowAutoGameMode");
    pin("visual-effects", "Explorer\\VisualEffects", "VisualFXSetting");
    pin("hags-enable", "Control\\GraphicsDrivers", "HwSchMode");
    pin("fast-startup-off", "Session Manager\\Power", "HiberbootEnabled");
    pin("game-bar-disable", "GameDVR", "AppCaptureEnabled", "GameConfigStore", "GameDVR_Enabled");
    pin("mouse-accel-off", "Control Panel\\Mouse", "MouseSpeed", "MouseThreshold1", "MouseThreshold2");
    pin("nagle-disable", "Tcpip\\Parameters\\Interfaces", "TcpAckFrequency", "TCPNoDelay");
  });

  it("service targets name the real service (services.rs / KnownService)", () => {
    pin("sysmain-disable", "SysMain");
    pin("nvidia-telemetry", "NvTelemetryContainer");
    pin("diagtrack-disable", "DiagTrack");
    pin("windows-search-disable", "WSearch");
  });

  it("power-plan targets carry the real powercfg GUIDs (actions.rs PWR_* consts)", () => {
    pin("usb-selective-suspend-off", "2a737441-1930-4402-8d77-b2bebba308a3", "48e6b7a6-50f5-4782-a5d4-53bb8f07e226");
    pin("pcie-aspm-off", "501a4d13-42af-4429-9fd1-a8218c268e20", "ee12f906-d277-404b-b6da-e5fa1a576df5");
    pin("power-ultimate", "powercfg", "e9a42b02-d5df-448d-aa00-03f14749eb61");
  });

  it("refused-tier targets name where the tweak lives (display-only — Compy never touches these)", () => {
    pin("useplatformclock", "bcdedit", "useplatformclock");
    pin("pagefile-disable", "Virtual memory", "Memory Management", "PagingFiles");
    pin("disable-defender", "Policies\\Microsoft\\Windows Defender", "DisableAntiSpyware", "Tamper Protection");
  });
});
