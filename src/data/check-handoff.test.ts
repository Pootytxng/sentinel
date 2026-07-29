import { describe, it, expect, beforeEach } from "vitest";
import {
  HANDOFF_KEY,
  HANDOFF_MAX_AGE_MS,
  clearHandoff,
  readHandoff,
  resolveCarried,
  writeHandoff,
} from "./check-handoff";

// The Check → Optimize handoff contract (recovery items 3/4). Every case below is one of the
// destination behaviours the recovery train named: one finding, several, stale before arrival,
// already applied, nothing actionable, a later revisit, and a hostile/foreign payload.
//
// The property that matters most: a handoff carries INTENT ONLY. Nothing in this module can apply,
// dismiss, or change anything — so these tests assert identity, freshness, and honest resolution,
// never a mutation.

const rec = (id: string, currently_applied = false) => ({ id, currently_applied });

describe("check-handoff: write → read", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the exact rec ids, in order", () => {
    writeHandoff({ station: "optimize", rec_ids: ["a", "b", "c"], source: "first-check" });
    expect(readHandoff()?.rec_ids).toEqual(["a", "b", "c"]);
  });

  it("carries the station and source", () => {
    writeHandoff({ station: "optimize", rec_ids: ["a"], source: "check" });
    const h = readHandoff();
    expect(h?.station).toBe("optimize");
    expect(h?.source).toBe("check");
  });

  it("reads null when nothing was written", () => {
    expect(readHandoff()).toBeNull();
  });

  it("is consumed exactly once — a later Lab visit is an ordinary visit", () => {
    writeHandoff({ station: "optimize", rec_ids: ["a"], source: "check" });
    expect(readHandoff()?.rec_ids).toEqual(["a"]);
    expect(readHandoff()).toBeNull();
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it("clearHandoff drops a pending intent (and is safe when there is none)", () => {
    writeHandoff({ station: "optimize", rec_ids: ["a"], source: "check" });
    clearHandoff();
    expect(readHandoff()).toBeNull();
    expect(() => clearHandoff()).not.toThrow();
  });

  it("drops empty-string ids at both ends", () => {
    writeHandoff({ station: "optimize", rec_ids: ["a", "", "b"], source: "check" });
    expect(readHandoff()?.rec_ids).toEqual(["a", "b"]);
  });

  it("an empty findings list is still a valid handoff (open the station, claim nothing)", () => {
    writeHandoff({ station: "optimize", rec_ids: [], source: "first-check" });
    const h = readHandoff();
    expect(h).not.toBeNull();
    expect(h?.rec_ids).toEqual([]);
  });
});

describe("check-handoff: only a valid, fresh payload is trusted", () => {
  beforeEach(() => localStorage.clear());

  const store = (value: unknown) =>
    localStorage.setItem(HANDOFF_KEY, typeof value === "string" ? value : JSON.stringify(value));

  it("ignores unparseable JSON", () => {
    store("{not json");
    expect(readHandoff()).toBeNull();
  });

  it("ignores a non-object payload", () => {
    store(JSON.stringify(["a", "b"]));
    expect(readHandoff()).toBeNull();
  });

  it("ignores a foreign/future version", () => {
    store({ v: 2, station: "optimize", rec_ids: ["a"], source: "check", at: Date.now() });
    expect(readHandoff()).toBeNull();
  });

  it("ignores an unknown station", () => {
    store({ v: 1, station: "benchmark", rec_ids: ["a"], source: "check", at: Date.now() });
    expect(readHandoff()).toBeNull();
  });

  it("ignores an unknown source", () => {
    store({ v: 1, station: "optimize", rec_ids: ["a"], source: "cron", at: Date.now() });
    expect(readHandoff()).toBeNull();
  });

  it("ignores rec_ids that are not a string array", () => {
    store({ v: 1, station: "optimize", rec_ids: [1, 2], source: "check", at: Date.now() });
    expect(readHandoff()).toBeNull();
    store({ v: 1, station: "optimize", rec_ids: "a,b", source: "check", at: Date.now() });
    expect(readHandoff()).toBeNull();
  });

  it("ignores a missing or non-finite timestamp", () => {
    store({ v: 1, station: "optimize", rec_ids: ["a"], source: "check" });
    expect(readHandoff()).toBeNull();
    store({ v: 1, station: "optimize", rec_ids: ["a"], source: "check", at: "now" });
    expect(readHandoff()).toBeNull();
  });

  it("ignores intent older than the age cap", () => {
    const at = 1_000_000_000_000;
    writeHandoff({ station: "optimize", rec_ids: ["a"], source: "check", at });
    expect(readHandoff(at + HANDOFF_MAX_AGE_MS + 1)).toBeNull();
  });

  it("accepts intent inside the age cap", () => {
    const at = 1_000_000_000_000;
    writeHandoff({ station: "optimize", rec_ids: ["a"], source: "check", at });
    expect(readHandoff(at + HANDOFF_MAX_AGE_MS - 1)?.rec_ids).toEqual(["a"]);
  });

  it("a backwards clock jump cannot resurrect old intent", () => {
    const at = 1_000_000_000_000;
    writeHandoff({ station: "optimize", rec_ids: ["a"], source: "check", at });
    expect(readHandoff(at - HANDOFF_MAX_AGE_MS - 1)).toBeNull();
  });

  it("clears the rejected payload too — a bad handoff never sticks around", () => {
    store({ v: 99, station: "optimize", rec_ids: ["a"], source: "check", at: Date.now() });
    readHandoff();
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull();
  });
});

describe("resolveCarried: the destination states what it can see, not what Check said", () => {
  it("one finding, still pending → open", () => {
    const r = resolveCarried(["a"], [rec("a")]);
    expect(r.open.map((x) => x.id)).toEqual(["a"]);
    expect(r.done).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("several findings keep their identity and the order Check named them", () => {
    const r = resolveCarried(["c", "a", "b"], [rec("a"), rec("b"), rec("c")]);
    expect(r.open.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("applied between the check and arrival → done, never re-offered as open", () => {
    const r = resolveCarried(["a", "b"], [rec("a", true), rec("b")]);
    expect(r.done.map((x) => x.id)).toEqual(["a"]);
    expect(r.open.map((x) => x.id)).toEqual(["b"]);
  });

  it("stale before arrival (no longer in the catalog) → missing, never invented", () => {
    const r = resolveCarried(["gone", "a"], [rec("a")]);
    expect(r.missing).toEqual(["gone"]);
    expect(r.open.map((x) => x.id)).toEqual(["a"]);
  });

  it("recs still loading → claims nothing at all", () => {
    const r = resolveCarried(["a"], null);
    expect(r).toEqual({ open: [], done: [], missing: [] });
  });

  it("no carried ids → nothing to lead with", () => {
    const r = resolveCarried([], [rec("a")]);
    expect(r).toEqual({ open: [], done: [], missing: [] });
  });
});
