import { describe, it, expect } from "vitest";
import { lifecycle, supersessionChain, type KnowledgeEntry } from "./knowledge";

// A3 lifecycle mapper — shapes the optional status/supersededBy off a raw entry. The lint
// (knowledge.lint.test.ts) enforces that a superseded id is real + different; this just maps.
describe("knowledge lifecycle mapper (A3)", () => {
  it("absent or unknown status → current (no lifecycle fields)", () => {
    expect(lifecycle({})).toEqual({});
    expect(lifecycle({ status: "active" })).toEqual({});
    expect(lifecycle({ status: "whatever" })).toEqual({});
  });

  it("deprecated → status only", () => {
    expect(lifecycle({ status: "deprecated" })).toEqual({ status: "deprecated" });
  });

  it("superseded → carries the replacement id", () => {
    expect(lifecycle({ status: "superseded", supersededBy: "vrr" })).toEqual({
      status: "superseded",
      supersededBy: "vrr",
    });
  });

  it("superseded with no supersededBy → empty string (the lint then rejects it)", () => {
    expect(lifecycle({ status: "superseded" })).toEqual({ status: "superseded", supersededBy: "" });
  });
});

// A5 supersession chain — the transitive resolver behind Learn's superseded note: the link must
// land on the CURRENT end of the line, never on another stale stop.
describe("supersessionChain (A5)", () => {
  const term = (id: string, extra: Partial<KnowledgeEntry> = {}): KnowledgeEntry =>
    ({
      id,
      name: id.toUpperCase(),
      aliases: [],
      related: [],
      topic: "display",
      type: "term",
      what: "",
      more: "",
      ...extra,
    }) as KnowledgeEntry;
  const mapOf = (...es: KnowledgeEntry[]) => new Map(es.map((e) => [e.id, e]));

  it("resolves a multi-hop chain in order, ending at the current entry", () => {
    const a = term("a", { status: "superseded", supersededBy: "b" });
    const b = term("b", { status: "superseded", supersededBy: "c" });
    const c = term("c");
    const chain = supersessionChain(a, mapOf(a, b, c));
    expect(chain.map((e) => e.id)).toEqual(["b", "c"]);
    expect(chain[chain.length - 1].status).toBeUndefined();
  });

  it("single hop → just the replacement; not superseded → empty", () => {
    const a = term("a", { status: "superseded", supersededBy: "b" });
    const b = term("b");
    expect(supersessionChain(a, mapOf(a, b)).map((e) => e.id)).toEqual(["b"]);
    expect(supersessionChain(b, mapOf(a, b))).toEqual([]);
  });

  it("cycle-safe: a → b → a terminates without looping", () => {
    const a = term("a", { status: "superseded", supersededBy: "b" });
    const b = term("b", { status: "superseded", supersededBy: "a" });
    expect(supersessionChain(a, mapOf(a, b)).map((e) => e.id)).toEqual(["b"]);
  });

  it("missing-target-safe: a broken link stops at the last resolvable entry", () => {
    const a = term("a", { status: "superseded", supersededBy: "gone" });
    expect(supersessionChain(a, mapOf(a))).toEqual([]);
    const b = term("b", { status: "superseded", supersededBy: "gone" });
    const a2 = term("a", { status: "superseded", supersededBy: "b" });
    expect(supersessionChain(a2, mapOf(a2, b)).map((e) => e.id)).toEqual(["b"]);
  });
});
