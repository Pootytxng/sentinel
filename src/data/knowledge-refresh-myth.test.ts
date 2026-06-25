// Content guard for the refresh-rate debunk (A4 content lane): the "your eye can't see past
// 60 fps" myth. Asserts the entry is present, shaped as a display-topic term, honestly worded
// (no absolute over-claim), findable by the phrases a real gamer would search, and cross-linked
// to the existing refresh-rate explainers. Bug→guard: pins the entry so a future edit can't drop
// or mis-topic it silently.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";

const ID = "human-eye-fps-myth";

describe("refresh-rate eye-limit debunk", () => {
  const entry = KNOWLEDGE_BY_ID.get(ID);

  it("ships as a display-topic term", () => {
    expect(entry, `entry "${ID}" must exist`).toBeTruthy();
    expect(entry!.type).toBe("term");
    expect(entry!.topic).toBe("display");
  });

  it("cross-links the existing refresh-rate explainers", () => {
    // both must resolve (the lint enforces no dangling ids; this pins the intent)
    expect(entry!.related).toContain("hz-vs-fps");
    expect(entry!.related).toContain("set-refresh-rate");
  });

  it("is findable by the phrases people actually search", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    for (const q of ["is 144hz worth it", "human eye fps", "60 fps limit"]) {
      expect(searchKnowledge(q, all).map((e) => e.id), `query: ${q}`).toContain(ID);
    }
  });

  it("does not deny that returns diminish (stays honest, not a hype claim)", () => {
    if (entry!.type !== "term") throw new Error("expected term");
    const body = `${entry!.what} ${entry!.more}`.toLowerCase();
    // The honest debunk acknowledges the benefit tapers — it doesn't sell "more Hz is always huge".
    expect(body).toMatch(/diminish|taper|smaller|preference/);
  });
});
