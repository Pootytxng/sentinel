// D3a step 1: the English-in-zh-CN census (plan: _train/d3-plan.md §D3a).
//
// Renders surfaces that show BACKEND text (Rust labels, details, values, reasons) in a zh-CN UI, fed
// the exact English the backend sends today, and lists every visible Latin-script run that is not an
// allowed token (product and hardware names, units). The list is pinned below as the CURRENT DEBT.
// Ratchet-only, like orphan-key-guard's ALLOWED:
//   - a run that is not in DEBT fails (a new English leak into a Chinese screen),
//   - a DEBT entry that no longer appears fails too (it was fixed: delete it, the list only shrinks).
// Never add to DEBT to get green; fix the leak (a stable code + an i18n key, D3a step 2) instead.
//
// BASELINE NOTE (2026-11-23): this file was written while builds were paused. The first DEBT below is
// what reading the source predicts; the first run prints the exact list it found, and that run's list
// is the baseline (pinned once, then only ever shrunk).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    // Exactly what readiness.rs sends for a verified-on VRR row (readiness.rs, the `vrr` check).
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [
          {
            id: "vrr",
            label: "Variable refresh rate (G-SYNC / FreeSync)",
            status: "ready",
            detail:
              "FreeSync is ON — your AMD GPU reports adaptive sync enabled on a connected display. Frame pacing is smoothed and tearing removed.",
            value: "FreeSync: on",
            action_uri: "ms-settings:display-advancedgraphics",
            action_label: "Open VRR settings",
            drifted_titles: [],
          },
        ],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "priorities_from")
      return Promise.resolve({
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: null,
      });
    if (cmd === "get_recommendations") return Promise.resolve([]);
    if (cmd === "get_applied_changes") return Promise.resolve([]);
    if (cmd === "get_nic_driver_info") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import i18n from "./index";
import Check from "../surfaces/Check";
import Fix from "../surfaces/Fix";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { invalidateProbe } from "../data/probe-cache";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  invalidateProbe();
  await i18n.changeLanguage("en");
});

/** Words that may stay Latin in a Chinese screen: product, vendor and hardware names, and units. */
export const ALLOWED_TOKENS = new Set([
  "Compy", "Windows", "Microsoft", "Xbox", "Steam", "Discord",
  "AMD", "NVIDIA", "Intel", "Radeon", "GeForce", "Ryzen",
  "FreeSync", "G-SYNC", "GSYNC", "VRR", "HDR", "DirectX", "Vulkan",
  "GPU", "CPU", "RAM", "SSD", "HDD", "NVMe", "SATA", "USB", "PCIe", "BIOS", "UEFI", "XMP", "EXPO",
  "Wi-Fi", "Ethernet", "LAN", "DNS", "IP", "UAC",
  "FPS", "fps", "Hz", "ms", "GB", "MB", "KB", "TB", "MHz", "GHz", "W", "x",
]);

/** Every maximal run of Latin words (letters, inner hyphens/apostrophes, joined by spaces). */
export function latinRuns(text: string): string[] {
  return [...text.matchAll(/[A-Za-z][A-Za-z'’-]*(?:[  ]+[A-Za-z][A-Za-z'’-]*)*/g)].map((m) => m[0].trim());
}

/** The runs in `text` that contain any word outside ALLOWED_TOKENS (the English that leaked). */
export function englishLeaks(text: string): string[] {
  return latinRuns(text).filter((run) => run.split(/[  ]+/).some((w) => !ALLOWED_TOKENS.has(w)));
}

const visible = (el: HTMLElement) => el.textContent ?? "";

/** Every leak found on the surfaces below, deduplicated and sorted, as `<surface>: <run>`. */
async function census(): Promise<string[]> {
  await i18n.changeLanguage("zh-CN");
  const found = new Set<string>();

  // Check: the expanded per-check list shows the Rust label and its measured detail as sent.
  const check = render(
    <ConfirmProvider>
      <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" />
    </ConfirmProvider>,
  );
  const toggle = await waitFor(() => {
    const b = check.container.querySelector<HTMLButtonElement>(".check-allchecks button");
    if (!b) throw new Error("the all-checks toggle has not rendered yet");
    return b;
  });
  fireEvent.click(toggle);
  await waitFor(() => {
    if (!check.container.querySelector(".check-all-list")) throw new Error("the check list is not open");
  });
  for (const run of englishLeaks(visible(check.container))) found.add(`Check: ${run}`);
  check.unmount();

  // Fix: rec titles, impact lines and "not for this rig" reasons come from Rust as English.
  const fix = render(
    <Fix
      recs={[
        {
          id: "power-ultimate",
          title: "Switch to the Ultimate Performance power plan",
          description: "",
          impact: "Keeps the CPU at full clock under load.",
          currently_applied: false,
          provenance: "verified",
          severity: "moderate",
        },
        {
          id: "nagle-disable",
          title: "Disable Nagle's algorithm",
          description: "",
          impact: "",
          currently_applied: false,
          provenance: "expected-impact",
          severity: "moderate",
          eligible: false,
          ineligible_reason: "Needs a wired Ethernet port — this rig has none (Wi-Fi / other only).",
        },
      ]}
      startup={[]}
      changes={[]}
      busyId={null}
      isAppliable={(id) => id === "power-ultimate"}
      activeChangeFor={() => undefined}
      onToggleRec={vi.fn()}
      onToggleStartup={vi.fn()}
      onRollback={vi.fn()}
      onApplyBatch={vi.fn().mockResolvedValue({ applied: 0, skipped: [] })}
      onOpenLibrary={vi.fn()}
      vendor="amd"
      view="fixes"
    />,
  );
  for (const run of englishLeaks(visible(fix.container))) found.add(`Fix: ${run}`);
  fix.unmount();

  return [...found].sort();
}

// The CURRENT DEBT: English that reaches a zh-CN screen today. Only ever shrinks (see the header).
const DEBT: string[] = [
  "Check: Frame pacing is smoothed and tearing removed",
  "Check: FreeSync is ON",
  "Check: Variable refresh rate",
  "Check: your AMD GPU reports adaptive sync enabled on a connected display",
  "Fix: Disable Nagle's algorithm",
  "Fix: Keeps the CPU at full clock under load",
  "Fix: Needs a wired Ethernet port",
  "Fix: Switch to the Ultimate Performance power plan",
  "Fix: this rig has none",
  "Fix: other only",
];

describe("English in zh-CN screens: the census (ratchet-only)", () => {
  it("the run splitter and the allowed tokens behave", () => {
    expect(latinRuns("Compy 读取了 FreeSync: on，显示器 Variable refresh rate")).toEqual([
      "Compy",
      "FreeSync",
      "on",
      "Variable refresh rate",
    ]);
    expect(englishLeaks("你的 AMD GPU 支持 FreeSync，刷新率 144 Hz")).toEqual([]);
    expect(englishLeaks("FreeSync: on")).toEqual(["on"]);
    expect(englishLeaks("Nagle's algorithm")).toEqual(["Nagle's algorithm"]);
  });

  it("no new English reaches a zh-CN screen, and fixed debt is removed from the list", async () => {
    const found = await census();
    const added = found.filter((r) => !DEBT.includes(r));
    const fixed = DEBT.filter((r) => !found.includes(r));
    expect(
      { added, fixed },
      `English in zh-CN screens changed.\n- "added" is a NEW leak: give it a stable code + an i18n key; never add it to DEBT.\n- "fixed" no longer appears: delete it from DEBT.\nFull list found now:\n${JSON.stringify(found, null, 2)}`,
    ).toEqual({ added: [], fixed: [] });
  });
});
