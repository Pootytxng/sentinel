import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import { HomeRoom } from "./HomeRoom";
import type { GameReadiness, Priorities } from "../types";
import type { HardwareInfo } from "../App";

// bug→guard (issue #513, 2026-09-23) — found by the `self-reviewer` seat during PR #500's review and
// left out of that diff on purpose. HomeHud's header text ran together with no separator:
//
//   "…Sep 22, 2026Monitor below max refresh"  — the masthead (LED · label · dateline) was the first
//       child of RoomShell's `verdict`, which renders INSIDE the <h1>. The page's one heading was the
//       room's label, today's date and the live verdict welded into one string: the #211 defect,
//       hand-rolled, so #211's guard (which looks for <RoomEyebrow>) never saw it.
//   "checks 16/16 measuredattention 3"        — the two readout segments were adjacent spans with no
//       text between them. Only CSS (flex gap + a border) kept them apart, so the text itself, which
//       is what a screen reader reads and what a copy or a text probe returns, welded them.
//
// The weld check below is deliberately generic rather than a list of the two strings: it walks the
// header and fails wherever two inline siblings' texts touch letter-to-letter with nothing between
// them. A block element (a heading, a div) is its own line to layout and to assistive tech, so a
// boundary against one is not a weld. zh-CN is run too: "项" + "需关注" welds just as "measured" +
// "attention" does, and a fix that only spaced the English would pass an English-only check.

vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

beforeEach(() => {
  // HomeConsole is the default Home; "0" is the failsafe that reaches the HUD composition.
  localStorage.setItem("compy_home_console", "0");
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

// The reported state: 16 checks, all measured, three flagged.
const readiness: GameReadiness = {
  checks: Array.from({ length: 16 }, (_, i) => ({
    id: `c${i}`,
    label: `Check ${i}`,
    status: i < 3 ? "attention" : "ready",
    detail: "",
    value: null,
  })),
  ready_count: 13,
  attention_count: 3,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
} as unknown as GameReadiness;

const priorities: Priorities = {
  limiters: [
    {
      id: "refresh",
      title: "Monitor below max refresh",
      reason: "The display runs under its rated refresh.",
      linked: null,
      confidence: "high",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const props = {
  hw,
  readiness,
  priorities,
  sessions: [],
  changes: [],
  onRunCheck: () => {},
  onSeeInFix: () => {},
};

const BLOCK = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "DIV", "HEADER", "SECTION", "ASIDE", "UL", "OL", "LI"]);
const WORD_END = /[\p{L}\p{N}]$/u;
const WORD_START = /^[\p{L}\p{N}]/u;

/** Every place two inline siblings' texts touch letter-to-letter with no text between them, as
 *  "left|right". Empty nodes (an LED, a hairline) are skipped, so a weld across one still counts. */
function welds(root: Element): string[] {
  const out: string[] = [];
  const visit = (el: Element) => {
    const kids = Array.from(el.childNodes).filter((n) => (n.textContent ?? "") !== "");
    for (let i = 1; i < kids.length; i += 1) {
      const a = kids[i - 1];
      const b = kids[i];
      // Two adjacent text nodes are one run the author wrote ("{count}" + " items"), not a weld.
      if (a.nodeType !== Node.ELEMENT_NODE && b.nodeType !== Node.ELEMENT_NODE) continue;
      if (BLOCK.has((a as Element).tagName) || BLOCK.has((b as Element).tagName)) continue;
      const left = a.textContent ?? "";
      const right = b.textContent ?? "";
      if (WORD_END.test(left) && WORD_START.test(right)) {
        out.push(`${left.slice(-14)}|${right.slice(0, 14)}`);
      }
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
  return out;
}

function mountHud() {
  const c = render(<HomeRoom {...props} />).container;
  expect(c.querySelector("[data-hud-home]"), "HomeHud did not render — this file tests nothing").not.toBeNull();
  return c;
}

describe("HomeHud header text never runs together (#513)", () => {
  it("the h1 holds the verdict and nothing else", () => {
    const c = mountHud();
    const h1 = c.querySelector(".v2-verdict h1");
    const headline = c.querySelector(".hud-headline")?.textContent ?? "";
    expect(headline, "no headline rendered — the check below would compare nothing").not.toBe("");
    expect(
      h1?.querySelector(".hud-masthead-eyebrow"),
      "the masthead is inside the <h1> again: the heading reads label + date + verdict as one string",
    ).toBeNull();
    expect(h1?.textContent).toBe(headline);
    // What assistive tech announces, computed the way testing-library's role query computes it.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(headline);
    expect(screen.getByRole("heading", { level: 1, name: headline })).toBe(h1);
  });

  it("keeps the masthead on screen, in the header, with its label, dateline and LED", () => {
    // Anti-vacuous: moving the masthead out of the h1 must not be a deletion.
    const c = mountHud();
    const eyebrow = c.querySelector(".v2-verdict > .hud-masthead-eyebrow");
    expect(eyebrow, "the masthead left the header entirely").not.toBeNull();
    expect(eyebrow?.textContent).toContain(i18n.t("home.homeHud.masthead.eyebrow"));
    expect(eyebrow?.querySelector(".hud-mono")?.textContent).toMatch(/\d{4}/);
    expect(eyebrow?.querySelector(".hud-led-warn")).not.toBeNull();
  });

  for (const lang of ["en", "zh-CN"] as const) {
    it(`no two header runs weld together (${lang})`, async () => {
      await act(async () => {
        await i18n.changeLanguage(lang);
      });
      const c = mountHud();
      const header = c.querySelector(".v2-verdict");
      const measured = c.querySelector(".v2-measured");
      expect(header, "no RoomShell header").not.toBeNull();
      expect(measured, "no readout strip").not.toBeNull();
      // Anti-vacuous: the readout really has the two segments the weld sat between.
      expect(measured!.querySelectorAll(".hud-readout-seg")).toHaveLength(2);
      expect([...welds(header!), ...welds(measured!)]).toEqual([]);
    });
  }

  // A TEXT guard on the stylesheet, because jsdom never loads it. The self-reviewer measured the
  // first cut of this fix on a dev build: with the masthead out of the h1, the headline alone was
  // shorter than a two-line dek sharing its row, and the row's bottom alignment sank it — 10px under
  // the masthead at 1280 wide, 15px at 1500 and 1920. Pinning the h1 to the row's top is the fix.
  it("the HUD headline is pinned under the masthead, not bottom-aligned with its row", () => {
    const css = readFileSync(join("src", "surfaces", "home-hud.css"), "utf8");
    const rule = css
      .split("}")
      .find((block) => /\[data-room="home"\][^{]*\.v2-verdict\s+h1:not\(:has\(\.hc-headline\)\)\s*\{/.test(block));
    expect(rule, "home-hud.css lost its HUD home h1 rule").toBeTruthy();
    expect(rule).toMatch(/align-self:\s*flex-start/);
  });

  it("the weld check fires on the shape it guards (falsification)", () => {
    // The two defects as they shipped, rebuilt by hand, must both be reported.
    const shipped = document.createElement("div");
    shipped.innerHTML =
      '<h1><span class="e">Rig diagnostic · <span>Sep 22, 2026</span></span><span>Monitor below max refresh</span></h1>' +
      '<div><span>checks <span>16/16</span> measured</span><span>attention <span>3</span></span></div>';
    expect(welds(shipped)).toEqual(["· Sep 22, 2026|Monitor below ", "16/16 measured|attention 3"]);
    // A block boundary or a space between the runs is not a weld.
    const fixed = document.createElement("div");
    fixed.innerHTML =
      '<span>Sep 22, 2026</span><h1>Monitor below max refresh</h1>' +
      "<div><span>checks 16/16 measured</span> <span>attention 3</span></div>";
    expect(welds(fixed)).toEqual([]);
  });
});

describe("HomeHud drift module points to the Care view (P6-timeline)", () => {
  const drifted = {
    ...readiness,
    drifts: [{ id: "game-mode", label: "Game Mode", detail: "Off.", noticed_at: "2026-10-20T10:00:00Z" }],
  } as unknown as GameReadiness;

  it("counts the drift and opens Crash & Freeze Rescue instead of restating its name", () => {
    const open = vi.fn();
    const c = render(<HomeRoom {...props} readiness={drifted} onOpenLabStation={open} />).container;
    expect(c.querySelector("[data-hud-home]")).not.toBeNull();
    expect(screen.getByText(/1 setting changed since it was last good/)).toBeTruthy();
    expect(screen.queryByText(/Game Mode/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "see what changed" }));
    expect(open).toHaveBeenCalledWith("blackbox");
  });

  it("without the deep-link, still names where the list is", () => {
    render(<HomeRoom {...props} readiness={drifted} />);
    expect(screen.getByText(/1 setting changed since it was last good · listed on Crash & Freeze Rescue/)).toBeTruthy();
  });
});
