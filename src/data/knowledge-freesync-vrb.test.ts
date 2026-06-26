// Content guard for the FreeSync ↔ VRB (variable-refresh vs blur-reduction) mutual-exclusion
// explainer (A4 Monitor content lane). On most gaming monitors the strobing backlight that powers
// blur reduction (VRB / ULMB / MBR / DyAc) and a variable refresh rate (FreeSync / G-Sync) can NOT
// run at the same time — enabling one greys out the other in the OSD. People hit this live and think
// something is broken. This pins the entry as an honest, read-only display-topic term that explains
// the trade-off and cross-links the two features it sits between. Bug->guard: an edit can't drop,
// mis-topic, or turn it into a fabricated "do this for more FPS" claim.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";
import { TOPIC_BY_ID } from "./knowledge-topics";

const ID = "freesync-vrb-exclusion";

describe("FreeSync ↔ VRB exclusion explainer", () => {
  it("ships as a display-topic term", () => {
    const e = KNOWLEDGE_BY_ID.get(ID);
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("term");
    expect(e!.topic).toBe("display");
    // Explicitly mapped in the central taxonomy (the lint completeness guard requires this).
    expect(TOPIC_BY_ID[ID]).toBe("display");
  });

  it("cross-links the two features it sits between (VRR and blur reduction)", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    expect(e.related).toContain("vrr");
    expect(e.related).toContain("backlight-strobing");
    for (const r of e.related) {
      expect(KNOWLEDGE_BY_ID.has(r), `related "${r}" must resolve`).toBe(true);
    }
  });

  it("is findable by the terms people search when they hit the conflict", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    expect(searchKnowledge("freesync blur reduction", all).map((e) => e.id)).toContain(ID);
    expect(searchKnowledge("vrr greyed out", all).map((e) => e.id)).toContain(ID);
  });

  it("explains it as a mutual exclusion / trade-off, not a fix-it action", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "term") throw new Error("expected term");
    const body = `${e.what} ${e.more}`.toLowerCase();
    // Names the conflict (one disables/greys the other) ...
    expect(body, `${ID}: must explain the two can't run together`).toMatch(
      /can't (?:run|be on)|cannot (?:run|be on)|at the same time|grey|gray|disable/,
    );
    // ... and frames it as an advisory pick-one trade-off (read-only).
    expect(body, `${ID}: must frame it as choosing one`).toMatch(/choose|pick|trade-?off|one or the other/);
  });

  it("stays honest — no fabricated FPS/gain claim", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "term") throw new Error("expected term");
    const body = `${e.what} ${e.more}`.toLowerCase();
    expect(body, `${ID}: must not promise more FPS`).not.toMatch(/more fps|higher fps|boost(?:s)? fps|faster frames/);
  });
});
