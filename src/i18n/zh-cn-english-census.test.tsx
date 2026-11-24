// D3a step 1: the English-in-zh-CN census (plan: _train/d3-plan.md §D3a).
//
// What it checks, and only that: TWO zh-CN screens, fed copies of what Rust sends today for the few
// items below, and the visible Latin-script runs in their DOM text nodes that are not an allowed token
// (product, vendor and hardware names, units). The items:
//   - Check, the per-check list opened: ONE readiness row, the VRR check in its verified-on variant
//     (readiness.rs, the `vrr` check: label, detail, value, action label copied as sent);
//   - Fix, the "fixes" view: TWO recs, "power-ultimate" (recommendations.rs, build_recommendations:
//     title, description, impact, provenance copied as sent) and "eee-disable" held back for a rig with
//     no wired port (baseline-rules-v1.json fields + the HasWiredEthernetPort reason from
//     recommendations.rs), with the "not for this rig" group opened so its title and reason are read.
// The runs found are pinned below as the CURRENT DEBT. Ratchet-only, like orphan-key-guard's ALLOWED:
//   - a run that is not in DEBT fails (a new English leak into a Chinese screen),
//   - a DEBT entry that no longer appears fails too (it was fixed: delete it, the list only shrinks).
// Never add to DEBT to get green; fix the leak (a stable code + an i18n key, D3a step 2) instead.
//
// NOT COVERED (English this census cannot see; follow-ups, not proof of absence):
//   - attributes: aria-label (TrustSwitch's label embeds rec.title raw), title=, alt=, placeholder=;
//   - collapsed details: each slim row's closed detail (description, "why it matters", what changes);
//     the "not for this rig" group IS opened here, but nothing else collapsed is;
//   - other VRR variants (off / advisory / unknown, readiness.rs) and every other readiness check;
//   - every other rec (about 20; only the two above are fed), and the Tune view;
//   - every screen other than Check and Fix (Home, Lab, the ledger, the export UI, banners, dialogs).
//
// BASELINE NOTE: DEBT is the list printed by the first run after the review-r1 fixes (real Rust copies,
// text-node join, "x" dropped), pinned exactly as printed in the commit whose message says "baseline
// recorded from first run, not edited"; from then on it only ever shrinks.
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
import { readFileSync } from "node:fs";
import baselineRules from "../../src-tauri/resources/baseline-rules-v1.json";

type Provenance = "verified" | "measured-signal" | "expected-impact";
type Severity = "safe" | "moderate" | "advanced";

// recommendations.rs, build_recommendations: the "power-ultimate" rec's text as Rust sends it today.
const POWER_ULTIMATE = {
  id: "power-ultimate",
  title: "Switch to the Ultimate Performance power plan",
  description:
    "Windows ships with a hidden 'Ultimate Performance' power plan that keeps your CPU at peak responsiveness instead of letting it nap between workloads. Better for gaming. The honest tradeoff: this permanently switches your daily power profile, so the higher power draw is in effect even when you're not gaming. A future Compy release will offer a Gaming Mode that automatically switches to high-performance only while a game is running, so your daily profile stays alone — this rec is the manual interim option.",
  impact: "Lower input latency · steadier frame times (when gaming)",
  currently_applied: false,
  provenance: "measured-signal" as Provenance,
  severity: "moderate" as Severity,
  eligible: true,
};

// recommendations.rs, hardware_ineligibility_reason: what a rig with no wired port is told.
const NO_WIRED_PORT_REASON = "Needs a wired Ethernet port — this rig has none (Wi-Fi / other only).";

// baseline-rules-v1.json's "eee-disable" rule (read from the file itself), held back on such a rig.
const eeeRule = baselineRules.rules.find((r) => r.id === "eee-disable")!;
const EEE_HELD_BACK = {
  id: eeeRule.id,
  title: eeeRule.title,
  description: eeeRule.description,
  impact: eeeRule.impact,
  currently_applied: false,
  provenance: eeeRule.provenance as Provenance,
  severity: eeeRule.severity as Severity,
  eligible: false,
  ineligible_reason: NO_WIRED_PORT_REASON,
};

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
  "FPS", "fps", "Hz", "ms", "GB", "MB", "KB", "TB", "MHz", "GHz", "W",
]);

/** Every maximal run of Latin words (letters, inner hyphens/apostrophes, joined by spaces). */
export function latinRuns(text: string): string[] {
  return [...text.matchAll(/[A-Za-z][A-Za-z'’-]*(?:[  ]+[A-Za-z][A-Za-z'’-]*)*/g)].map((m) => m[0].trim());
}

/** The runs in `text` that contain any word outside ALLOWED_TOKENS (the English that leaked). */
export function englishLeaks(text: string): string[] {
  return latinRuns(text).filter((run) => run.split(/[  ]+/).some((w) => !ALLOWED_TOKENS.has(w)));
}

/** The DOM text, node by node, joined with "\n" (latinRuns never joins across it), so neighbouring
 *  elements never fuse into one run the way `textContent` glues them ("...power planVerified"). */
const visible = (el: HTMLElement) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  while (walker.nextNode()) out.push(walker.currentNode.nodeValue ?? "");
  return out.join("\n");
};

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
      recs={[POWER_ULTIMATE, EEE_HELD_BACK]}
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
  // Open the "not for this rig" group (collapsed by default) so the held-back rec's title and reason
  // are in the DOM the census reads.
  const notForRig = i18n.t("optimize.fix.notForThisRig");
  const groupHead = [...fix.container.querySelectorAll<HTMLButtonElement>("button.fix-group-head")].find(
    (b) => b.querySelector(".fix-group-title")?.textContent === notForRig,
  );
  if (!groupHead) throw new Error("the 'not for this rig' group did not render");
  if (groupHead.getAttribute("aria-expanded") !== "true") fireEvent.click(groupHead);
  await waitFor(() => {
    if (!fix.container.querySelector(".fix-refuse-row")) throw new Error("the 'not for this rig' group is not open");
  });
  for (const run of englishLeaks(visible(fix.container))) found.add(`Fix: ${run}`);
  fix.unmount();

  return [...found].sort();
}

// The CURRENT DEBT: English that reaches a zh-CN screen today. Only ever shrinks (see the header).
const DEBT: string[] = [];

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

  it("the fed text is a copy of what Rust sends today", () => {
    // Rust string literals as source text, `\`-continuations and escaped quotes undone.
    const rs = (p: string) => readFileSync(p, "utf8").replace(/\\\r?\n\s*/g, "").replace(/\\"/g, '"');
    const recs = rs("src-tauri/src/recommendations.rs");
    for (const s of [POWER_ULTIMATE.title, POWER_ULTIMATE.description, POWER_ULTIMATE.impact, NO_WIRED_PORT_REASON])
      expect(recs, s).toContain(`"${s}"`);
    expect(recs).toMatch(/id: "power-ultimate"[\s\S]*?provenance: Provenance::MeasuredSignal/);
    const readiness = rs("src-tauri/src/readiness.rs");
    for (const s of [
      "Variable refresh rate (G-SYNC / FreeSync)",
      "FreeSync is ON — your AMD GPU reports adaptive sync enabled on a connected display. Frame pacing is smoothed and tearing removed.",
      "FreeSync: on",
      "Open VRR settings",
    ])
      expect(readiness, s).toContain(s);
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
