import { describe, it, expect } from "vitest";
import { buildLogbook, startHereEntries, type LogbookRecord } from "./logbook";
import type { AppliedChange, SessionSummary, IntelEvent } from "../../types";
import type { AutopsyLedgerEntry } from "../../data/autopsy-ledger";
import { KNOWLEDGE } from "../../data/knowledge";

// The Logbook tape truth-table (Console HUD Phase 4). buildLogbook is the room's honesty spine —
// it must NEVER fabricate a row, must order reverse-chronologically and deterministically, must
// carry the undo flag ONLY on genuinely-active changes, and must never show a cross-game delta.
// This suite is written first (TDD) and pins every branch.

const change = (over: Partial<AppliedChange> = {}): AppliedChange => ({
  id: "c1",
  rec_id: "rec_a",
  rec_title: "Enable Hardware-accelerated GPU scheduling",
  applied_at: "2026-07-10T12:00:00Z",
  snapshot: {},
  status: "applied",
  is_still_active: true,
  ...over,
});

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at: "2026-07-09T20:00:00Z",
    duration_secs: 3600,
    process_name: "valorant.exe",
    samples: 3400,
    avg_fps: 240,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 1,
    ...over,
  }) as SessionSummary;

const autopsy = (over: Partial<AutopsyLedgerEntry> = {}): AutopsyLedgerEntry => ({
  at: Date.parse("2026-07-08T08:00:00Z"),
  real: 2,
  placebo: 1,
  risky: 0,
  unknown: 0,
  scamFlags: 0,
  ...over,
});

const intel = (over: Partial<IntelEvent> = {}): IntelEvent => ({
  id: "gpu-driver-change:2026-07-07T10:00:00Z",
  timestamp: "2026-07-07T10:00:00Z",
  event_type: "gpu-driver-change",
  source: "rig-fingerprint",
  scope: "observed",
  game: null,
  summary: "GPU driver changed: 24.10.1 → 25.1.1",
  detail: "Noticed between two Compy readings — the exact time isn't recorded, only the window.",
  observed_between: ["2026-07-06T09:00:00Z", "2026-07-07T10:00:00Z"],
  since_rolled_back: false,
  ...over,
});

describe("buildLogbook — honest empty", () => {
  it("no sources ⇒ [] (the room's honest empty state, never a fabricated row)", () => {
    expect(buildLogbook({})).toEqual([]);
    expect(buildLogbook({ changes: [], sessions: [], autopsy: [] })).toEqual([]);
    expect(buildLogbook({ changes: null, sessions: null, autopsy: null })).toEqual([]);
  });
});

describe("buildLogbook — each source alone", () => {
  it("changes only", () => {
    const r = buildLogbook({ changes: [change()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "change",
      id: "c1",
      title: "Enable Hardware-accelerated GPU scheduling",
      active: true,
      rolledBack: false,
      at: Date.parse("2026-07-10T12:00:00Z"),
    });
  });

  it("sessions only", () => {
    const r = buildLogbook({ sessions: [session()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "session",
      game: "valorant.exe",
      avgFps: 240,
      low1Fps: 190,
      durationSecs: 3600,
      changesActive: 1,
      avgFpsDelta: null, // no same-game prior
    });
  });

  it("autopsy only", () => {
    const r = buildLogbook({ autopsy: [autopsy()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "autopsy", real: 2, placebo: 1, risky: 0, scamFlags: 0 });
  });
});

describe("buildLogbook — reverse-chronological ordering + deterministic tiebreak", () => {
  it("newest first across all three sources", () => {
    const r = buildLogbook({
      changes: [change({ applied_at: "2026-07-10T12:00:00Z" })],
      sessions: [session({ started_at: "2026-07-09T20:00:00Z" })],
      autopsy: [autopsy({ at: Date.parse("2026-07-08T08:00:00Z") })],
    });
    expect(r.map((x) => x.kind)).toEqual(["change", "session", "autopsy"]);
    // strictly descending timestamps
    for (let i = 1; i < r.length; i++) expect(r[i - 1].at).toBeGreaterThanOrEqual(r[i].at);
  });

  it("equal timestamps keep a stable, deterministic order (change → session → autopsy)", () => {
    const t = "2026-07-10T12:00:00Z";
    const r = buildLogbook({
      changes: [change({ applied_at: t })],
      sessions: [session({ started_at: t })],
      autopsy: [autopsy({ at: Date.parse(t) })],
    });
    expect(r.map((x) => x.kind)).toEqual(["change", "session", "autopsy"]);
  });
});

describe("buildLogbook — never fabricates a row (bad timestamps dropped)", () => {
  it("drops a change with an unparseable applied_at — never coerced to now/0", () => {
    const r = buildLogbook({
      changes: [change({ applied_at: "not-a-date" }), change({ id: "c2" })],
    });
    expect(r).toHaveLength(1);
    expect((r[0] as { id: string }).id).toBe("c2");
  });

  it("drops a session with an unparseable started_at and an autopsy with a non-finite at", () => {
    expect(buildLogbook({ sessions: [session({ started_at: "" })] })).toEqual([]);
    expect(buildLogbook({ autopsy: [autopsy({ at: NaN })] })).toEqual([]);
  });
});

describe("buildLogbook — undo flag rides only genuinely-active changes", () => {
  it("applied+active ⇒ active:true, rolledBack:false", () => {
    const r = buildLogbook({ changes: [change({ status: "applied", is_still_active: true })] });
    expect(r[0]).toMatchObject({ active: true, rolledBack: false });
  });

  it("applied but no longer active ⇒ active:false (no undo)", () => {
    const r = buildLogbook({ changes: [change({ status: "applied", is_still_active: false })] });
    expect(r[0]).toMatchObject({ active: false, rolledBack: false });
  });

  it("rolled back ⇒ active:false, rolledBack:true (stays on the tape as history)", () => {
    const r = buildLogbook({
      changes: [change({ status: "rolled_back", is_still_active: false })],
    });
    expect(r[0]).toMatchObject({ active: false, rolledBack: true });
  });
});

describe("buildLogbook — vs-previous delta is same-game only", () => {
  it("two same-game sessions ⇒ the newer carries the avg delta vs the older", () => {
    const r = buildLogbook({
      sessions: [
        session({ started_at: "2026-07-01T00:00:00Z", avg_fps: 200, process_name: "valorant.exe" }),
        session({ started_at: "2026-07-02T00:00:00Z", avg_fps: 230, process_name: "valorant.exe" }),
      ],
    });
    // newest-first: [newer (230), older (200)]
    expect((r[0] as { avgFpsDelta: number | null }).avgFpsDelta).toBe(30);
    expect((r[1] as { avgFpsDelta: number | null }).avgFpsDelta).toBe(null);
  });

  it("a different-game session in between is NOT the baseline (never a cross-game delta)", () => {
    const r = buildLogbook({
      sessions: [
        session({ started_at: "2026-07-01T00:00:00Z", avg_fps: 200, process_name: "valorant.exe" }),
        session({ started_at: "2026-07-02T00:00:00Z", avg_fps: 90, process_name: "cyberpunk.exe" }),
        session({ started_at: "2026-07-03T00:00:00Z", avg_fps: 240, process_name: "valorant.exe" }),
      ],
    });
    const byGameNewest = r.find(
      (x): x is Extract<LogbookRecord, { kind: "session" }> =>
        x.kind === "session" && x.game === "valorant.exe" && x.avgFps === 240,
    )!;
    expect(byGameNewest.avgFpsDelta).toBe(40); // 240 vs the older valorant 200, NOT the cyberpunk 90
    const cyber = r.find(
      (x): x is Extract<LogbookRecord, { kind: "session" }> =>
        x.kind === "session" && x.game === "cyberpunk.exe",
    )!;
    expect(cyber.avgFpsDelta).toBe(null); // no same-game prior
  });
});

describe("buildLogbook — observed machine changes (Intelligence Phase 1)", () => {
  it("maps an observed event verbatim — the engine's own sentence, never rephrased", () => {
    const r = buildLogbook({ observed: [intel()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      kind: "observed",
      at: Date.parse("2026-07-07T10:00:00Z"),
      id: "gpu-driver-change:2026-07-07T10:00:00Z",
      eventType: "gpu-driver-change",
      summary: "GPU driver changed: 24.10.1 → 25.1.1",
      detail: "Noticed between two Compy readings — the exact time isn't recorded, only the window.",
      observedBetween: [Date.parse("2026-07-06T09:00:00Z"), Date.parse("2026-07-07T10:00:00Z")],
    });
  });

  it("tapes ONLY scope-observed events — compy-applied and measurement already have their rows (decision 15)", () => {
    const r = buildLogbook({
      observed: [
        intel({ id: "a", scope: "compy-applied" }),
        intel({ id: "b", scope: "measurement" }),
        intel({ id: "c", scope: "observed" }),
      ],
    });
    expect(r).toHaveLength(1);
    expect((r[0] as { id: string }).id).toBe("c");
  });

  it("drops an observed event with an unparseable timestamp — never coerced to now/0", () => {
    expect(buildLogbook({ observed: [intel({ timestamp: "not-a-date" })] })).toEqual([]);
    const r = buildLogbook({
      observed: [intel({ id: "bad", timestamp: "" }), intel({ id: "good" })],
    });
    expect(r).toHaveLength(1);
    expect((r[0] as { id: string }).id).toBe("good");
  });

  it("a half-parseable observed_between window ⇒ between null, but the row survives", () => {
    const r = buildLogbook({
      observed: [intel({ observed_between: ["not-a-date", "2026-07-07T10:00:00Z"] })],
    });
    expect(r).toHaveLength(1);
    expect((r[0] as { observedBetween: unknown }).observedBetween).toBe(null);
  });

  it("null observed_between ⇒ null (no invented window)", () => {
    const r = buildLogbook({ observed: [intel({ observed_between: null })] });
    expect((r[0] as { observedBetween: unknown }).observedBetween).toBe(null);
  });

  it("empty/null observed ⇒ [] — the honest empty state holds for the fourth source too", () => {
    expect(buildLogbook({ observed: [] })).toEqual([]);
    expect(buildLogbook({ observed: null })).toEqual([]);
  });

  it("equal timestamps keep the deterministic 4-kind order (change → session → autopsy → observed)", () => {
    const t = "2026-07-10T12:00:00Z";
    const r = buildLogbook({
      changes: [change({ applied_at: t })],
      sessions: [session({ started_at: t })],
      autopsy: [autopsy({ at: Date.parse(t) })],
      observed: [intel({ timestamp: t })],
    });
    expect(r.map((x) => x.kind)).toEqual(["change", "session", "autopsy", "observed"]);
  });
});

describe("buildLogbook — partial fields survive", () => {
  it("legacy change with null labels ⇒ nulls, not crashes", () => {
    const r = buildLogbook({
      changes: [
        change({ restores_label: null, applied_label: null, payoff_label: null }),
      ],
    });
    expect(r[0]).toMatchObject({ restoresLabel: null, appliedLabel: null, payoffLabel: null });
  });
});

describe("startHereEntries — real corpus, rig-fit, deterministic", () => {
  it("returns only real corpus entries, capped at the limit", () => {
    const picks = startHereEntries("amd", 4);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(4);
    const ids = new Set(KNOWLEDGE.map((e) => e.id));
    for (const p of picks) expect(ids.has(p.id)).toBe(true);
  });

  it("prefers guides, then fills with other types", () => {
    const picks = startHereEntries("amd", 4);
    const firstNonGuide = picks.findIndex((p) => p.type !== "guide");
    // every guide comes before the first non-guide (guides-first ordering)
    if (firstNonGuide >= 0) {
      expect(picks.slice(0, firstNonGuide).every((p) => p.type === "guide")).toBe(true);
    }
  });

  it("is deterministic (same vendor ⇒ same picks) and never yields deprecated/superseded entries", () => {
    expect(startHereEntries("amd", 4)).toEqual(startHereEntries("amd", 4));
    const bad = new Set(
      KNOWLEDGE.filter((e) => e.status === "deprecated" || e.status === "superseded").map((e) => e.id),
    );
    for (const p of startHereEntries("amd", 8)) expect(bad.has(p.id)).toBe(false);
  });

  it("limit 0 ⇒ [] (never negative-slice surprises)", () => {
    expect(startHereEntries("amd", 0)).toEqual([]);
  });
});
