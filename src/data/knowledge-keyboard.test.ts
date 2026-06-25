// Content guard for the keyboard-switch explainers (A4 content lane; pairs with peripheral's
// switch detection): actuation point, N-key rollover, and Rapid Trigger. Asserts the trio ships
// as input-topic terms, cross-links, and stays honest — none promise FPS or "more skill," and the
// Rapid Trigger entry is anti-cheat-aware (flags that Snap Tap / SOCD is banned in major titles and
// to check the game's rules, consistent with Compy's anti-cheat-safe stance). Bug->guard.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";

const IDS = ["keyboard-actuation", "nkro", "rapid-trigger"] as const;

describe("keyboard-switch explainers", () => {
  it("all three ship as input-topic terms", () => {
    for (const id of IDS) {
      const e = KNOWLEDGE_BY_ID.get(id);
      expect(e, `entry "${id}" must exist`).toBeTruthy();
      expect(e!.type).toBe("term");
      expect(e!.topic).toBe("input");
    }
  });

  it("cross-link within the keyboard family", () => {
    const ka = KNOWLEDGE_BY_ID.get("keyboard-actuation")!;
    const rt = KNOWLEDGE_BY_ID.get("rapid-trigger")!;
    // Rapid Trigger is an actuation behaviour → must point back at the actuation explainer
    expect(rt.related).toContain("keyboard-actuation");
    expect(ka.related).toContain("rapid-trigger");
  });

  it("are findable by the phrases people search", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    expect(searchKnowledge("n-key rollover", all).map((e) => e.id)).toContain("nkro");
    expect(searchKnowledge("actuation point", all).map((e) => e.id)).toContain("keyboard-actuation");
    expect(searchKnowledge("rapid trigger", all).map((e) => e.id)).toContain("rapid-trigger");
  });

  it("stay honest — no FPS / no 'more skill' claims", () => {
    for (const id of IDS) {
      const e = KNOWLEDGE_BY_ID.get(id)!;
      if (e.type !== "term") throw new Error("expected term");
      const body = `${e.what} ${e.more}`.toLowerCase();
      expect(body, `${id}: must not promise more FPS`).not.toMatch(/more fps|higher fps|boost.* fps|raise.* fps/);
    }
  });

  it("Rapid Trigger entry is anti-cheat-aware (Snap Tap / SOCD ban + check the rules)", () => {
    const rt = KNOWLEDGE_BY_ID.get("rapid-trigger")!;
    if (rt.type !== "term") throw new Error("expected term");
    const body = `${rt.what} ${rt.more}`.toLowerCase();
    expect(body).toMatch(/snap tap|socd/);
    expect(body).toMatch(/ban|restrict|rules/);
  });
});
