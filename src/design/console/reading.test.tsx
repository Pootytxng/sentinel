import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
// The REAL i18next instance, not a stub: these guards are about what a person reads, and a
// key echoed back ("common.arcGauge.measured") contains the word "measured" while saying
// nothing. That near-miss is why this import is here.
import "../../i18n";
import { Reading, READING_ROWS } from "./Reading";
import { readFileSync } from "fs";
import { join } from "path";

// The console kit's Reading — one measured fact, promoted out of HomeConsole in slice 3 (issue #49).
// These guards are the ones Health paid eleven self-review rounds for. They travel WITH the
// component, because the next room to place a Reading is the one that would otherwise re-learn them.

describe("Reading", () => {
  it("renders three parts in one order: label, value, attestation", () => {
    const { container } = render(<Reading id="avgFps" label="AVG FPS" value={91} unit="fps" />);
    const cell = container.querySelector<HTMLElement>('[data-read="avgFps"]')!;
    expect(cell, "data-read is the identity the honesty guards anchor to").not.toBeNull();
    // Three children, not four and not two: the cell subgrids onto READING_ROWS parent rows, so a
    // fourth child would silently fall outside the tracks the strip reserved for it.
    expect(
      cell.children.length,
      "a Reading occupies exactly READING_ROWS rows, so it renders exactly that many children",
    ).toBe(READING_ROWS);
    expect(cell.children[0].className).toContain("rd-label");
    expect(cell.children[1].className).toContain("rd-v");
    expect(cell.children[2].className).toContain("rd-tag");
  });

  it("a measured reading prints its number, its unit as a SEPARATE node, and the attestation", () => {
    const { container } = render(<Reading id="gpuTemp" label="GPU TEMP" value={61.4} unit="°C" />);
    const n = container.querySelector(".rd-n")!;
    // Rounded, and the unit never rides along in the number's text: the honesty guards read this
    // node and compare it to the reading they expect, so "61°C" would read as a different number.
    expect(n.textContent).toBe("61");
    expect(container.querySelector(".rd-u")!.textContent).toBe("°C");
    expect(container.querySelector(".rd-tag")!.textContent).toBe("measured");
    expect(container.querySelector(".rd-none"), "a measured cell has no reason-line").toBeNull();
  });

  it("an unmeasured reading is em-dashes and a REASON — never a zero, never the attestation", () => {
    const { container } = render(<Reading id="cpuTemp" label="CPU TEMP" value={null} unit="°C" />);
    // ONE em-dash. Two of them (the original) read as a redaction rather than an absence, and
    // every one of the four approved comps draws a single dash — owner ruling 2026-08-23.
    expect(container.querySelector(".rd-n")!.textContent).toBe("—");
    expect(container.querySelector(".rd-u"), "no unit on a reading that does not exist").toBeNull();
    expect(
      container.querySelector(".rd-tag"),
      "MEASURED is an attestation, so it may never appear over an unmeasured cell",
    ).toBeNull();
    expect(container.querySelector(".rd-none")!.textContent).toMatch(/no reading/i);
    expect(container.textContent, "0 is a value; absent is not").not.toMatch(/\b0\b/);
  });

  it("the caller's own reason replaces the generic one, in the same slot", () => {
    // Health's CPU temp carries "no CPU temp — see below" (the C-19 dead-end fix travelling with the
    // fact). It must land in the reason slot, not beside it, or the strip grows a fourth row.
    const { container } = render(
      <Reading id="cpuTemp" label="CPU TEMP" value={null} note="no CPU temp — see below" />,
    );
    expect(container.querySelector(".rd-none")!.textContent).toBe("no CPU temp — see below");
    expect(container.children[0].children.length).toBe(READING_ROWS);
  });

  it("tone rides the root, so one cell can never restyle its neighbours", () => {
    const { container } = render(<Reading id="low1" label="1% LOW" value={44} tone="warn" />);
    const cell = container.querySelector<HTMLElement>('[data-read="low1"]')!;
    expect(cell.className).toContain("rd-warn");
    expect(cell.className).not.toContain("rd-empty");
  });

  // bug→guard, self-review round 10 (issue #49, 2026-08-23), carried into the kit by slice 3.
  // Every reading is label · value · attestation, and each cell used to size those three rows FOR
  // ITSELF. At 1280x720 a label that wrapped to two lines pushed ONLY its own value down and the row
  // of numbers stopped being a row. Width is not the fix — there is no width to give at 720p and the
  // next translation wraps a different label — so the cell borrows its parent's rows instead.
  it("CSS: the cell borrows its parent's rows and never sizes its own", () => {
    const css = readFileSync(join("src", "design", "console", "reading.css"), "utf8");
    const rule = /:root\[data-v2="on"\]\s*\.reading\s*\{([^}]*)\}/.exec(css);
    expect(rule, ".reading must be styled by the kit, not by whichever room placed it").not.toBeNull();
    const body = rule![1];
    expect(body, "...and it has to be a grid for subgrid to mean anything").toMatch(/display:\s*grid/);
    expect(
      body,
      "a flex column (or any independent grid) is exactly how the staggered row got shipped",
    ).toMatch(/grid-template-rows:\s*subgrid/);
    expect(body, "a subgrid item must cover the tracks it borrows").toMatch(/align-self:\s*stretch/);

    // The span in CSS and READING_ROWS in TS are the same fact stated twice, so check them against
    // each other. A cell that spans 2 of 3 rows silently stops sharing the third.
    const span = /grid-row:\s*span\s*(\d+)/.exec(body);
    expect(span, ".reading must span its parent's rows explicitly").not.toBeNull();
    expect(
      Number(span![1]),
      "reading.css spans " + span![1] + " rows while Reading.tsx says READING_ROWS is " +
        READING_ROWS + ". A consumer strip is guarded against the TS number, so a drift here " +
        "breaks the room, not this file.",
    ).toBe(READING_ROWS);
  });
});
