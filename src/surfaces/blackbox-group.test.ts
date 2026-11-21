import { describe, it, expect } from "vitest";
import type { ChangedBeforeItem, CrashIncident } from "../types";
import {
  groupIncidents,
  groupKey,
  headlineWording,
  sharedUnknownItems,
  INCIDENT_CAP,
} from "./blackbox-group";

// P2-group: the key decides what may be said once. Any difference must keep incidents apart.
function inc(i: number, over: Partial<CrashIncident> = {}): CrashIncident {
  const day = 10 + Math.floor(i / 3);
  return {
    incident_id: `id${String(i).padStart(14, "0")}`,
    headline: `ROB RUN stopped working and closed — Nov ${day}, 12:0${i % 3} AM`,
    tag: "App crash",
    when: `2026-11-${String(day).padStart(2, "0")}T12:0${i % 3}:00Z`,
    when_display: `Nov ${day}, 12:0${i % 3} AM`,
    vitals: null,
    receipt: { source: "Application log · 1000", event_ids: [1000], faulting_app: "ROB RUN.exe", faulting_module: null, code: null, detail: "" },
    assessment: {
      rule: "app-specific",
      statement: "app-crash",
      subject: "ROB RUN",
      consistent_with: "ROB RUN crashing",
      strength: "weak",
      evidence: ["Windows recorded ROB RUN crashing"],
      next_step: { headline: "Verify the game's files", detail: "In the launcher.", reversible: true, research_only: false },
      beyond_us: false,
    },
    ...over,
  };
}
const withAssess = (c: CrashIncident, patch: Record<string, unknown>): CrashIncident => ({
  ...c,
  assessment: { ...c.assessment!, ...patch } as CrashIncident["assessment"],
});

describe("groupIncidents", () => {
  it("puts incidents with the same program, kind and assessment in one group, newest first", () => {
    const a = [inc(0), inc(7), inc(3), inc(5)]; // not in time order
    const g = groupIncidents(a);
    expect(g).toHaveLength(1);
    expect(g[0].items.map((x) => x.incident_id)).toEqual([inc(7), inc(5), inc(3), inc(0)].map((x) => x.incident_id));
  });

  it("matches the program by file name, ignoring case and a path", () => {
    const b = inc(1, { receipt: { ...inc(1).receipt, faulting_app: "C:\\Games\\rob run.EXE" } });
    expect(groupIncidents([inc(0), b])).toHaveLength(1);
  });

  it.each([
    ["program", (c: CrashIncident) => ({ ...c, receipt: { ...c.receipt, faulting_app: "Other.exe" } })],
    ["kind", (c: CrashIncident) => ({ ...c, tag: "App hang" })],
    ["rule", (c: CrashIncident) => withAssess(c, { rule: "graphics-driver" })],
    ["statement", (c: CrashIncident) => withAssess(c, { statement: "host-process" })],
    ["strength", (c: CrashIncident) => withAssess(c, { strength: "partial" })],
    ["evidence", (c: CrashIncident) => withAssess(c, { evidence: ["Windows recorded ROB RUN crashing", "another line"] })],
    ["next step", (c: CrashIncident) => withAssess(c, { next_step: { headline: "x", detail: "y", reversible: true, research_only: true } })],
    ["having an assessment", (c: CrashIncident) => ({ ...c, assessment: null })],
    ["headline wording", (c: CrashIncident) => ({ ...c, headline: `${c.headline}, while Other was running` })],
  ])("a differing %s splits the group", (_name, change) => {
    const g = groupIncidents([inc(0), change(inc(1)), inc(2)]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.items.length).sort()).toEqual([1, 2]);
  });

  it("leaves a group of one as exactly that incident", () => {
    const only = inc(4);
    const g = groupIncidents([only]);
    expect(g).toHaveLength(1);
    expect(g[0].items).toEqual([only]);
  });

  it("orders groups by their newest member", () => {
    const other = (i: number) => inc(i, { tag: "App hang" });
    const g = groupIncidents([inc(0), other(9), inc(1), other(2)]);
    expect(g.map((x) => x.items[0].tag)).toEqual(["App hang", "App crash"]);
  });

  it("keeps the given order where a time cannot be read", () => {
    const a = inc(0, { when: "not a date" });
    const b = inc(1, { when: "also not" });
    expect(groupIncidents([b, a])[0].items.map((x) => x.incident_id)).toEqual([b.incident_id, a.incident_id]);
  });

  it("does not depend on the date in the headline", () => {
    expect(headlineWording(inc(0))).toBe("ROB RUN stopped working and closed");
    expect(groupKey(inc(0))).toBe(groupKey(inc(8)));
  });
});

describe("the cap", () => {
  it("is the number the backend truncates to (the note says 'at most 25 are listed')", () => {
    const files = import.meta.glob("../../src-tauri/src/blackbox.rs", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const rs = Object.values(files)[0] ?? "";
    const m = rs.match(/const MAX_INCIDENTS: usize = (\d+);/);
    expect(m, "MAX_INCIDENTS not found in blackbox.rs").not.toBeNull();
    expect(INCIDENT_CAP).toBe(Number(m![1]));
  });

  it("a record that differs only in its tail ('while X was running') is a different group", () => {
    const tail = inc(1, { headline: `${inc(1).headline}, while ROB RUN was running` });
    expect(groupIncidents([inc(0), tail])).toHaveLength(2);
    expect(headlineWording(tail)).toBe("ROB RUN stopped working and closed, while ROB RUN was running");
  });
});

describe("sharedUnknownItems", () => {
  const unk = (category: string, last: string | null, reason = "no-reading-after"): ChangedBeforeItem =>
    ({ category, status: "unknown", events: [], unknown_reason: reason, last_reading_at: last, checked_between: null }) as unknown as ChangedBeforeItem;
  const cb = (items: ChangedBeforeItem[]): CrashIncident["changed_before"] => ({
    anchor_kind: "clean",
    anchor: { started_at: "2026-11-09T00:00:00Z", game: "ROB RUN" },
    window_end: "2026-11-10T00:00:00Z",
    items,
  });

  it("returns an unknown row only when it is the same for every incident", () => {
    const a = inc(0, { changed_before: cb([unk("driver", "t1"), unk("hardware", "t1"), unk("drift", null, "drift-not-kept")]) });
    const b = inc(1, { changed_before: cb([unk("driver", "t1"), unk("hardware", "t2"), unk("drift", null, "drift-not-kept")]) });
    expect(sharedUnknownItems([a, b]).map((x) => x.category)).toEqual(["driver", "drift"]);
  });

  it("a differing reason splits it, and a row that is not an unknown is never shared", () => {
    const known = { category: "power-plan", status: "no-change", events: [], unknown_reason: null, last_reading_at: null, checked_between: ["a", "b"] } as unknown as ChangedBeforeItem;
    const a = inc(0, { changed_before: cb([unk("driver", "t1", "cant-place"), known]) });
    const b = inc(1, { changed_before: cb([unk("driver", "t1", "no-reading-after"), known]) });
    expect(sharedUnknownItems([a, b])).toEqual([]);
  });

  it("shares nothing for one incident, or when any incident has no changed-before", () => {
    const a = inc(0, { changed_before: cb([unk("driver", "t1")]) });
    expect(sharedUnknownItems([a])).toEqual([]);
    expect(sharedUnknownItems([a, inc(1)])).toEqual([]);
  });
});
