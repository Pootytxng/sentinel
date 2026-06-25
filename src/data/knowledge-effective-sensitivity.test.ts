// Content guard for the effective-sensitivity (eDPI) Learn entry (A4 content lane; handoff from
// peripheral 06-25). Mouse DPI is NOT OS-readable — it lives on the mouse, not in Windows — so it
// can't be hardware-tailored (the Latency surface's whole premise), which is exactly why it belongs
// in Learn as a rule-of-thumb rather than a per-rig card. The existing dpi-ppi term + the
// gaming-mouse-dpi-fps debunk cover DPI itself; nothing explained the COMBINED number (eDPI =
// DPI × in-game sensitivity) that actually decides aim feel, nor the can't-read-your-DPI honesty.
// This entry does. Asserts it ships, routes to the real DPI entries, is findable, and stays honest
// (eDPI = the product; Compy can't read DPI; no FPS promise). bug->guard.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";

const ID = "effective-sensitivity";

describe("effective-sensitivity (eDPI) Learn entry", () => {
  const e = KNOWLEDGE_BY_ID.get(ID);

  it("ships as an input-topic term", () => {
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("term");
    expect(e!.topic).toBe("input");
  });

  it("routes to the DPI explainer, the DPI-for-FPS debunk, and polling rate", () => {
    expect(e!.related).toContain("dpi-ppi"); // what DPI is
    expect(e!.related).toContain("gaming-mouse-dpi-fps"); // the 'DPI raises FPS' myth
    expect(e!.related).toContain("polling-rate");
  });

  it("is findable for eDPI / effective-sensitivity searches", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    for (const q of ["edpi", "effective sensitivity", "effective dpi"]) {
      expect(searchKnowledge(q, all).map((x) => x.id), `query: ${q}`).toContain(ID);
    }
  });

  it("stays honest — eDPI is the product, DPI is not OS-readable, no FPS promise", () => {
    if (e!.type !== "term") throw new Error("expected term");
    const body = `${e!.what} ${e!.more}`.toLowerCase();
    expect(body).toMatch(/edpi|effective/); // names the concept
    expect(body).toMatch(/dpi/); // one factor
    expect(body).toMatch(/sensitivit/); // the other factor
    // The whole reason this is content not a hardware-tailored card: Compy can't read DPI.
    expect(body).toMatch(/can.?t read your dpi|stored on the mouse|not in windows/);
    expect(body).toMatch(/400/); // the rule-of-thumb range is given, not withheld
    // No fabricated performance promise — DPI/eDPI is aim feel, not frames.
    expect(body, "no fabricated FPS promise").not.toMatch(/more fps|higher fps|guaranteed fps|boost.{0,12}fps/);
  });
});
