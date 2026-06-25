import { describe, it, expect } from "vitest";
import { searchKnowledge } from "./knowledge-search";
import type { KnowledgeEntry } from "./knowledge";

const term = (id: string, name: string, aliases: string[], what = "", more = ""): KnowledgeEntry => ({
  type: "term",
  id,
  name,
  aliases,
  related: [],
  topic: "general",
  what,
  more,
});

const fx: KnowledgeEntry[] = [
  term("vrr", "VRR", ["variable refresh rate", "adaptive sync"]),
  term("xmp", "XMP", ["expo", "memory profile", "ram speed"]),
  term("cafe", "Cafe latency", ["cafe"]),
  term("passing", "Passing mention", [], "this entry mentions expo only in its body"),
];

describe("searchKnowledge", () => {
  it("empty query returns everything, unchanged order", () => {
    expect(searchKnowledge("", fx).map((e) => e.id)).toEqual(["vrr", "xmp", "cafe", "passing"]);
  });

  it("exact alias hit ranks first", () => {
    expect(searchKnowledge("expo", fx)[0].id).toBe("xmp");
  });

  it("partial / substring match works", () => {
    expect(searchKnowledge("refresh", fx).map((e) => e.id)).toContain("vrr");
  });

  it("multi-word query requires every word to match somewhere in the entry", () => {
    // both words live in different aliases of the same entry
    expect(searchKnowledge("variable adaptive", fx).map((e) => e.id)).toEqual(["vrr"]);
    // one word matches, the other doesn't -> no result
    expect(searchKnowledge("variable zzz", fx)).toEqual([]);
  });

  it("no-hit returns empty", () => {
    expect(searchKnowledge("zzzzz", fx)).toEqual([]);
  });

  it("is case-insensitive and diacritic-safe", () => {
    expect(searchKnowledge("EXPO", fx)[0].id).toBe("xmp");
    expect(searchKnowledge("café", fx)[0].id).toBe("cafe");
  });

  it("name/alias hits outrank body-only hits", () => {
    const ids = searchKnowledge("expo", fx).map((e) => e.id);
    expect(ids[0]).toBe("xmp"); // alias hit
    expect(ids).toContain("passing"); // body hit, but ranked after
    expect(ids.indexOf("xmp")).toBeLessThan(ids.indexOf("passing"));
  });
});
