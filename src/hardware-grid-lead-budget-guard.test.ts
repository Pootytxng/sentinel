import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import type { HardwareInfo } from "./App";
import type { MachineModel } from "./types";
import wire from "./test/fixtures/machine-model.wire.json";

// HARDWARE GRID LEAD-BUDGET GUARD (#451 — PR #500 self-review re-prove, 2026-09-22).
//
// The defect this pins: at 1280×720 the HomeConsole Cards-mode stage box (`.hc-stage-cards`) is a
// fixed 232px viewport. With the rig-tier line at the top (bottom edge 54px, margin included) and
// the first identity card's label and value ending 84px below the grid's top edge, anything the grid
// renders between them has 94px, margin included — the LEAD of the #503 rule: the first card's label
// AND value sit inside the box before any scroll. The first disagreement note (5663dfc4) was a
// four-line column carrying the model's full interpretation sentence — 141px plus a 12px margin —
// and pushed the first card's value to 291px, 59px below the fold. The unknown reason under a card
// had the same shape in prose form, on the grid the owner moved to "terse values only… zero prose"
// (47c0dd2b, #82).
//
// The repair keeps the always-visible surface terse and puts every sentence behind an opt-in native
// <details> "why" disclosure. jsdom lays nothing out, so this guard pins the budget from the two
// sides it CAN read mechanically, and the self-reviewer measures the pixels:
//   A. structure — the note's always-visible children are the label, the two producer claims and the
//      why control; the interpretation sits inside a CLOSED <details>, and so does every unknown reason;
//   B. arithmetic — App.css's `.hw-disagree` padding, border, row gap, line-height and margin, resolved
//      against the type scale, fit the 94px budget at the wrap allowance below.
//
// The constants are the self-review's measurements on the owner's rig at 1280×720 (PR #500,
// issuecomment-5774753332): the box this grid is laid into, never a design choice made here.

const STAGE_BOX_PX = 232; // .hc-stage-cards clientHeight at 1280×720
const TIER_BOTTOM_PX = 54; // .hw-tier bottom edge, its 12px margin included
const FIRST_VALUE_BELOW_GRID_TOP_PX = 84; // first card's .card-value bottom − grid top (138 − 54)
const NOTE_BUDGET_PX = STAGE_BOX_PX - TIER_BOTTOM_PX - FIRST_VALUE_BELOW_GRID_TOP_PX; // 94
// The note is one wrapping flex ROW of four short items (label, two claims, the why control). At the
// 1280-wide stage they share one or two lines; three is the allowance budgeted here so a narrower box
// still fits. Four lines — the column the defect had — do not, and the arithmetic below says so.
const ROWS_ALLOWED = 3;

const state = vi.hoisted(() => ({ flag: false }));
vi.mock("./design/use-hud", () => ({ useIntelligenceFlag: () => state.flag }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve({ components: [], sessions_considered: 0 })),
}));
// Imported AFTER the mocks so HardwareGrid binds the mocked invoke/flag.
const { HardwareGrid } = await import("./surfaces/HardwareGrid");

afterEach(() => cleanup());

const hw: HardwareInfo = {
  cpu_brand: "Test CPU",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 12 * 1024 ** 3,
  swap_total_bytes: 0,
  os_name: "Windows",
  os_version: "11",
  kernel_version: "10.0.26200",
  hostname: "test-rig",
  disks: [],
  gpus: [],
  physical_disks: [],
  disk_health: [],
  display: null,
  memory_modules: [],
  windows_version: null,
  cpu_arch: null,
  network_adapters: [],
  has_wired_ethernet_port: false,
  bios_info: null,
  virtualization: null,
  usb: null,
};

// The wire fixture is the disagreement state (one ram_gb disagreement) AND the unknown state (the
// windows fact is null with an unknown_reason) in one model — the two states the defect touched.
const model = (mutate?: (m: MachineModel) => void): MachineModel => {
  const m = JSON.parse(JSON.stringify(wire)) as MachineModel;
  mutate?.(m);
  return m;
};
const grid = (m: MachineModel) => render(createElement(HardwareGrid, { hw, model: m })).container;

const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "gaming.json"), "utf8"));
const WHY: string = en.hardwareGrid.whyLabel; // the file IS the "gaming" namespace

// Text a reader sees without opening anything: every text node outside a <details>, plus each
// <summary> (the control itself is visible; its body is not until opened).
function alwaysVisibleText(root: Element): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    const el = node as Element;
    if (el.tagName === "DETAILS") {
      const summary = el.querySelector(":scope > summary");
      if (summary) out += summary.textContent;
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

describe("hardware grid LEAD budget guard (#451) — A. structure: terse on screen, sentences behind why", () => {
  it("the disagreement note shows the field, both producers and both values, and its sentence is behind a closed why", () => {
    const c = grid(model());
    const note = c.querySelector<HTMLElement>(".hw-disagree");
    expect(note, "the disagreement must still be shown — never hidden").not.toBeNull();
    const kids = Array.from(note!.children);
    expect(kids.map((k) => `${k.tagName.toLowerCase()}.${k.className}`)).toEqual([
      "span.hw-disagree-label",
      "span.hw-disagree-claim",
      "span.hw-disagree-claim",
      "details.hw-why",
    ]);
    const why = note!.querySelector<HTMLDetailsElement>("details.hw-why")!;
    expect(why.open, "the why must start closed — the sentence is opt-in").toBe(false);
    expect(why.querySelector(":scope > summary.hw-why-summary")?.textContent).toBe(WHY);
    expect(why.querySelector(".hw-why-body .hw-disagree-why")?.textContent).toBe(
      wire.identity.disagreements[0].interpretation,
    );
    const visible = alwaysVisibleText(note!);
    expect(visible).toBe(`Two readings of Memory disagreeCurrent fingerprint: 32Saved baseline: 16${WHY}`);
    expect(visible, "the interpretation sentence leaked onto the always-visible surface").not.toContain("rounding");
  });

  it("an unknown card value prints Unknown, with its reason reachable behind a closed why", () => {
    const c = grid(model());
    const system = Array.from(c.querySelectorAll<HTMLElement>(".card")).find(
      (card) => card.querySelector(".card-label")?.textContent === "System",
    )!;
    expect(system.querySelector(".card-value")?.textContent).toBe("Unknown");
    const why = system.querySelector<HTMLDetailsElement>("details.hw-why.hw-fact-more");
    expect(why, "the reason must be reachable — a why control under the value").not.toBeNull();
    expect(why!.open).toBe(false);
    expect(why!.querySelector(":scope > summary.hw-why-summary")?.textContent).toBe(WHY);
    expect(why!.querySelector(".hw-why-body > .hw-fact-reason")?.textContent).toBe(
      wire.identity.windows.unknown_reason,
    );
    expect(alwaysVisibleText(system)).not.toContain("returned nothing");
  });

  it("an unknown detail row (driver) gets the same closed why, not an inline sentence", () => {
    const reason = "The adapter reported no driver version.";
    const c = grid(
      model((m) => {
        m.identity.gpu_driver = {
          value: null,
          class: "unavailable",
          source: "hardware::current_fingerprint",
          freshness: "not-applicable",
          unknown_reason: reason,
        };
      }),
    );
    const reasons = Array.from(c.querySelectorAll<HTMLElement>(".hw-fact-reason"));
    const driver = reasons.find((r) => r.textContent === reason);
    expect(driver, "the driver row's reason is rendered").toBeDefined();
    const why = driver!.closest<HTMLDetailsElement>("details.hw-why");
    expect(why, "the reason sits inside a why disclosure").not.toBeNull();
    expect(why!.open).toBe(false);
  });

  it("every reason and interpretation on the grid is inside a why — nothing prose-shaped is always visible", () => {
    const c = grid(model());
    for (const el of Array.from(c.querySelectorAll(".hw-fact-reason, .hw-disagree-why"))) {
      const why = el.closest<HTMLDetailsElement>("details.hw-why");
      expect(why, `${el.className} rendered outside a why disclosure`).not.toBeNull();
      expect(why!.open).toBe(false);
    }
    // The control shows its own label; a title= would summon the OS tooltip to repeat it (#213 A4).
    for (const s of Array.from(c.querySelectorAll("summary.hw-why-summary"))) {
      expect(s.hasAttribute("title")).toBe(false);
    }
  });
});

// ---- B. arithmetic on the stylesheet ----------------------------------------------------------

const css = readFileSync(join("src", "App.css"), "utf8");
const typeScale = readFileSync(join("src", "design", "type-scale.css"), "utf8");

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} block not found in App.css`);
  const end = css.indexOf("\n}", at);
  const props: Record<string, string> = {};
  for (const line of css.slice(at, end).split("\n")) {
    const m = /^\s*([a-z-]+):\s*(.+?);\s*$/.exec(line);
    if (m) props[m[1]] = m[2];
  }
  return props;
}
const px = (v: string): number => {
  const m = /^(-?[\d.]+)px$/.exec(v.trim());
  if (!m) throw new Error(`expected a px length, got "${v}"`);
  return Number(m[1]);
};
// A `var(--x)` length resolves from the type scale; a bare length is itself.
const length = (v: string): number => {
  const m = /^var\((--[a-z-]+)\)$/.exec(v.trim());
  if (!m) return px(v);
  const def = new RegExp(`${m[1]}:\\s*([\\d.]+px)`).exec(typeScale);
  if (!def) throw new Error(`${m[1]} is not defined in src/design/type-scale.css`);
  return px(def[1]);
};
// CSS shorthand sides → vertical total (1–4 values: top [right [bottom [left]]]).
const vertical = (v: string): number => {
  const parts = v.trim().split(/\s+/).map(px);
  const top = parts[0];
  const bottom = parts.length >= 3 ? parts[2] : top;
  return top + bottom;
};
const rowGap = (v: string): number => px(v.trim().split(/\s+/)[0]);

describe("hardware grid LEAD budget guard (#451) — B. arithmetic: the collapsed note fits the 232px stage box", () => {
  const note = block(".hw-disagree");

  it("the note is a wrapping row with an explicit unitless line-height, not the column that overflowed", () => {
    expect(note.display).toBe("flex");
    expect(note["flex-wrap"]).toBe("wrap");
    expect(note["flex-direction"], "a column stacks one item per line — four lines, over budget").toBeUndefined();
    // Without its own line-height the row inherits the page strut (~20.8px at 13px) and the budget
    // below is computed on a number the element does not use.
    expect(note["line-height"]).toMatch(/^\d+(\.\d+)?$/);
  });

  it(`at ${ROWS_ALLOWED} wrapped lines the note, margin included, stays under the ${NOTE_BUDGET_PX}px LEAD budget`, () => {
    expect(note["line-height"], "no line-height on .hw-disagree — the row inherits the page strut").toBeDefined();
    const line = length(note["font-size"]) * Number(note["line-height"]);
    const border = px(note.border.split(/\s+/)[0]);
    const collapsed = (rows: number) =>
      vertical(note.padding) + 2 * border + rows * line + (rows - 1) * rowGap(note.gap) + px(note["margin-bottom"]);
    const at = collapsed(ROWS_ALLOWED);
    expect(
      at,
      `collapsed note at ${ROWS_ALLOWED} lines = ${at}px (padding ${note.padding}, border ${border}px, line ${line}px, ` +
        `gap ${note.gap}, margin ${note["margin-bottom"]}) — the first card's value would leave the 232px box`,
    ).toBeLessThan(NOTE_BUDGET_PX);
  });

  it("the why control adds no vertical frame of its own inside the row", () => {
    const why = block(".hw-why");
    for (const p of ["padding", "margin", "border", "margin-top", "margin-bottom", "padding-top", "padding-bottom"]) {
      expect(why[p], `.hw-why ${p} would grow the collapsed row`).toBeUndefined();
    }
    expect(block(".hw-why[open]")["flex-basis"], "open, the sentence must take its own full row").toBe("100%");
  });
});
