// Guards for the one-time data-root recovery merge (#130).
//
// This tool touches the Trust Ledger — the file every rollback resolves from (LOCKED rule 3). The
// merge core is pure so that every way it could lose, reshape or invent a receipt is falsifiable
// here, over fixtures, before it is ever pointed at the owner's real ledger. Each `REFUSES` test
// below asserts an abort, not a best-effort result: with two histories on one machine, guessing is
// the exact failure this lane exists to prevent.

import { describe, it, expect } from "vitest";
import { planMerge, splitLedgerEntries } from "./recover-data-root.mjs";

// Fixtures are written the way `serde_json::to_string_pretty` writes them (2-space, elements at
// depth 1), because that is the only input this tool will ever see.
function ledger(...entries) {
  if (!entries.length) return "[]";
  const body = entries
    .map((e) =>
      JSON.stringify(e, null, 2)
        .split("\n")
        .map((l) => "  " + l)
        .join("\n"),
    )
    .join(",\n");
  return `[\n${body}\n]`;
}

const receipt = (id, appliedAt, extra = {}) => ({
  id,
  rec_id: "rec-" + id,
  rec_title: "Set something",
  applied_at: appliedAt,
  snapshot: { previous: "old" },
  status: "applied",
  ...extra,
});

describe("splitLedgerEntries", () => {
  it("keeps each element's exact source text", () => {
    const text = ledger(receipt("a", "2026-01-01T00:00:00Z"), receipt("b", "2026-01-02T00:00:00Z"));
    const parts = splitLedgerEntries(text);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(text).toContain(p.raw);
    expect(parts.map((p) => p.value.id)).toEqual(["a", "b"]);
  });

  it("is not confused by braces, brackets or escaped quotes inside a string", () => {
    // A rec_title is human copy and a snapshot holds arbitrary registry values; a regex-based
    // splitter would cut in the wrong place here and silently corrupt a rollback contract.
    const nasty = receipt("n", "2026-01-01T00:00:00Z", {
      rec_title: 'Disable "Xbox {Game} Bar" [beta] }] ,',
      snapshot: { path: 'HKCU\\Software\\Weird"Key', nested: [{ a: [1, 2] }, {}] },
    });
    const parts = splitLedgerEntries(ledger(nasty));
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toEqual(nasty);
  });

  it("handles an empty ledger", () => {
    expect(splitLedgerEntries("[]")).toEqual([]);
    expect(splitLedgerEntries("[\n]")).toEqual([]);
  });

  it("REFUSES anything that is not an array of objects", () => {
    expect(() => splitLedgerEntries('{"id":"a"}')).toThrow(/must start with/);
    expect(() => splitLedgerEntries("[1, 2]")).toThrow(/unexpected character/);
    expect(() => splitLedgerEntries("[[1]]")).toThrow(/must be objects/);
    expect(() => splitLedgerEntries('[{"id": "a"')).toThrow(/must end with/);
  });
});

describe("planMerge", () => {
  const canonical = ledger(
    receipt("c1", "2026-07-24T00:00:00Z"),
    receipt("c2", "2026-07-29T00:00:00Z", { status: "rolled_back" }),
  );
  const foreign = ledger(
    receipt("f1", "2026-05-28T00:00:00Z"),
    receipt("f2", "2026-07-22T00:00:00Z", { status: "rolled_back" }),
  );

  it("unions both ledgers in applied_at order and loses nothing", () => {
    const { text, stats } = planMerge(canonical, foreign);
    const merged = JSON.parse(text);
    expect(merged.map((e) => e.id)).toEqual(["f1", "f2", "c1", "c2"]);
    expect(stats).toMatchObject({ canonical: 2, foreign: 2, merged: 4, applied: 2, rolledBack: 2 });
    expect(stats.firstAt).toBe("2026-05-28T00:00:00Z");
    expect(stats.lastAt).toBe("2026-07-29T00:00:00Z");
  });

  it("splices every receipt as its EXACT source bytes", () => {
    // The point of the whole design. A JSON.parse/stringify round-trip would rewrite `1.0` to `1`
    // and round an integer past 2^53 — inside a snapshot, i.e. inside the value a rollback writes
    // back onto Windows.
    const exact =
      '{\n    "id": "x",\n    "applied_at": "2026-06-01T00:00:00Z",\n    "status": "applied",\n' +
      '    "snapshot": {\n      "float": 1.0,\n      "big": 12345678901234567890,\n' +
      '      "unicode": "café — ok",\n      "trailing_zeros": 2.50\n    }\n  }';
    const src = `[\n  ${exact}\n]`;
    const { text } = planMerge("[]", src);
    expect(text).toContain(exact);
    expect(text).toContain("1.0");
    expect(text).toContain("12345678901234567890");
    expect(text).toContain("2.50");
  });

  it("produces output the app can read back, and is idempotent in ordering", () => {
    const { text } = planMerge(canonical, foreign);
    expect(() => JSON.parse(text)).not.toThrow();
    // Re-merging the result against an empty ledger must reproduce it exactly — a deterministic
    // sort means a re-run after an interrupted recovery cannot silently reshuffle the ledger.
    expect(planMerge("[]", text).text).toBe(text);
  });

  it("breaks applied_at ties by source order, foreign first", () => {
    const t = "2026-06-06T06:06:06Z";
    const { text } = planMerge(ledger(receipt("c", t)), ledger(receipt("f", t)));
    expect(JSON.parse(text).map((e) => e.id)).toEqual(["f", "c"]);
  });

  it("REFUSES when a receipt id appears in BOTH ledgers", () => {
    const dup = ledger(receipt("c1", "2026-01-01T00:00:00Z"));
    expect(() => planMerge(canonical, dup)).toThrow(/appear in BOTH ledgers/);
  });

  it("REFUSES when one ledger repeats an id internally", () => {
    const dup = ledger(receipt("d", "2026-01-01T00:00:00Z"), receipt("d", "2026-01-02T00:00:00Z"));
    expect(() => planMerge(dup, foreign)).toThrow(/repeats receipt id d/);
    expect(() => planMerge(canonical, dup)).toThrow(/repeats receipt id d/);
  });

  it("REFUSES a receipt with no usable id", () => {
    for (const bad of [{ applied_at: "2026-01-01T00:00:00Z" }, { id: 7, applied_at: "x" }, { id: "", applied_at: "x" }]) {
      expect(() => planMerge(ledger(bad), foreign)).toThrow(/no string `id`/);
    }
  });

  it("REFUSES a receipt with no usable applied_at", () => {
    for (const bad of [{ id: "a" }, { id: "a", applied_at: 12345 }, { id: "a", applied_at: "" }]) {
      expect(() => planMerge(ledger(bad), foreign)).toThrow(/no string `applied_at`/);
    }
  });

  it("names which ledger is at fault", () => {
    const bad = ledger({ applied_at: "2026-01-01T00:00:00Z" });
    expect(() => planMerge(bad, foreign)).toThrow(/canonical ledger/);
    expect(() => planMerge(canonical, bad)).toThrow(/redirected ledger/);
  });

  it("renders an empty result the way to_string_pretty does", () => {
    expect(planMerge("[]", "[]").text).toBe("[]");
  });

  it("carries a legacy receipt with no rollback contract across untouched", () => {
    // Finding F on #130: one old receipt predates typed rollback contracts. Recovery restores
    // visibility, it does not synthesize the missing contract — that would be fabrication.
    const legacy = { id: "legacy", applied_at: "2026-05-28T00:00:00Z", status: "applied", snapshot: null };
    const { text } = planMerge(canonical, ledger(legacy));
    const got = JSON.parse(text).find((e) => e.id === "legacy");
    expect(got).toEqual(legacy);
    expect(got.rollback_action).toBeUndefined();
  });
});
