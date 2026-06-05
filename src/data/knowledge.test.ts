import { describe, it, expect } from "vitest";
import {
  KNOWLEDGE,
  KNOWLEDGE_BY_ID,
  KNOWLEDGE_VERSION,
  entryBody,
  relatedIds,
  type KnowledgeEntry,
} from "./knowledge";

const e = (id: string, related: string[]): KnowledgeEntry => ({
  type: "term",
  id,
  name: id,
  aliases: [],
  related,
  what: "what",
  more: "more",
});

describe("knowledge model", () => {
  it("has a numeric dataset version for migrations", () => {
    expect(KNOWLEDGE_VERSION).toBe(1);
  });

  it("indexes every entry by id, and tweaks normalize with a type + empty related", () => {
    const xmp = KNOWLEDGE_BY_ID.get("xmp-expo");
    expect(xmp?.type).toBe("tweak");
    expect(Array.isArray(xmp?.related)).toBe(true); // tweaks.json has none -> normalized to []
  });

  it("merges all four types into one index", () => {
    const types = new Set(KNOWLEDGE.map((k) => k.type));
    expect([...types].sort()).toEqual(["guide", "term", "trick", "tweak"]);
  });

  it("entryBody returns the type-appropriate prose", () => {
    const term = KNOWLEDGE_BY_ID.get("xmp")!;
    expect(entryBody(term)).toContain("BIOS");
  });
});

describe("relatedIds (forward + reverse union)", () => {
  const fx = [e("a", ["b"]), e("b", []), e("c", ["zzz-missing"])];

  it("includes forward links", () => {
    expect(relatedIds(fx[0], fx)).toContain("b");
  });

  it("includes reverse links (b is referenced by a)", () => {
    expect(relatedIds(fx[1], fx)).toContain("a");
  });

  it("drops dangling ids and never lists itself", () => {
    expect(relatedIds(fx[2], fx)).not.toContain("zzz-missing");
    expect(relatedIds(fx[0], fx)).not.toContain("a");
  });
});
