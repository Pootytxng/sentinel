import { describe, it, expect } from "vitest";
import {
  buildLogbook,
  chronologyNote,
  groupByMonth,
  startHereEntries,
  type LogbookRecord,
} from "./logbook";
import type { AppliedChange, ChangeChronology, ChronologyEntry, SessionSummary } from "../../types";
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

// One chronology entry of the shared Machine Model — the tape's observed source since #450. Same
// records as the old timeline fetch, one route (the model assembles them from that very timeline).
const intel = (over: Partial<ChronologyEntry> = {}): ChronologyEntry => ({
  id: "gpu-driver-change:2026-07-07T10:00:00Z",
  observed_at: "2026-07-07T10:00:00Z",
  event_type: "gpu-driver-change",
  source: "rig-fingerprint",
  scope: "observed",
  summary: "GPU driver changed: 24.10.1 → 25.1.1",
  detail: "Noticed between two Compy readings — the exact time isn't recorded, only the window.",
  observed_between: ["2026-07-06T09:00:00Z", "2026-07-07T10:00:00Z"],
  class: "recorded-historically",
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

describe("buildLogbook — repeats collapse into one row (C-11)", () => {
  // The evidence this exists for: the owner's own ledger holds 64 applies, 37 of them `game-mode`.
  // The tape caps at 30 rows, so the record of his PC was one sentence printed over and over.
  const DAY = 86_400_000;
  const START = Date.parse("2026-05-28T10:00:00Z");
  // One apply a day from 28 May, the last one left ON — the real shape of his `game-mode` history.
  const toggled = (n: number, recId = "game-mode") =>
    Array.from({ length: n }, (_, i) =>
      change({
        id: `c${i}`,
        rec_id: recId,
        rec_title: "Enable Windows Game Mode",
        applied_at: new Date(START + i * DAY).toISOString(),
        status: i === n - 1 ? "applied" : "rolled_back",
        is_still_active: i === n - 1,
      }),
    );

  it("folds N applies of one tweak into ONE row that keeps both ends of the story", () => {
    const r = buildLogbook({ changes: toggled(37) });
    expect(r).toHaveLength(1);
    const c = r[0] as Extract<LogbookRecord, { kind: "change" }>;
    expect(c.count).toBe(37);
    expect(c.firstAt).toBe(START);
    // The row sits at the LATEST apply — a fold must not drag recent activity back to 28 May.
    expect(c.at).toBe(START + 36 * DAY);
    expect(c.active).toBe(true);
    expect(c.title).toBe("Enable Windows Game Mode");
  });

  it("does not touch a change applied once — count 1, firstAt === at", () => {
    const r = buildLogbook({ changes: [change()] });
    const c = r[0] as Extract<LogbookRecord, { kind: "change" }>;
    expect(c.count).toBe(1);
    expect(c.firstAt).toBe(c.at);
    expect(c.id).toBe("c1");
  });

  it("groups by rec_id, not by title — two tweaks stay two rows", () => {
    const r = buildLogbook({
      changes: [
        change({ id: "a1", rec_id: "game-mode", applied_at: "2026-06-01T10:00:00Z" }),
        change({ id: "a2", rec_id: "game-mode", applied_at: "2026-06-02T10:00:00Z" }),
        change({ id: "b1", rec_id: "hags", applied_at: "2026-06-03T10:00:00Z" }),
      ],
    });
    expect(r).toHaveLength(2);
    expect(r.map((x) => (x as Extract<LogbookRecord, { kind: "change" }>).count)).toEqual([1, 2]);
  });

  it("the collapsed row carries the LIVE apply's id — the one an undo would target", () => {
    // The dangerous version of this bug: fold to the newest record blindly, and the row offers to
    // undo an apply that was already superseded. Here the live apply is deliberately NOT the newest.
    const r = buildLogbook({
      changes: [
        change({ id: "old", applied_at: "2026-06-01T10:00:00Z", status: "applied", is_still_active: true }),
        change({ id: "new", applied_at: "2026-06-05T10:00:00Z", status: "rolled_back", is_still_active: false }),
      ],
    });
    const c = r[0] as Extract<LogbookRecord, { kind: "change" }>;
    expect(c.id).toBe("old");
    expect(c.active).toBe(true);
    expect(c.rolledBack).toBe(false);
    // …but it still sits on the tape at the most recent thing that happened.
    expect(c.at).toBe(Date.parse("2026-06-05T10:00:00Z"));
  });

  it("two applies BOTH reading live is a real ledger state, and the newest of them wins", () => {
    // Not hypothetical: `is_still_active` is a per-REC live probe, not a per-entry fact, and a
    // re-apply does not supersede the earlier `applied` row. A drift-then-reapply cycle — the exact
    // pattern behind the owner's 37 toggles — leaves two rows both reading active. The row must
    // carry the NEWEST of them: that is the apply whose snapshot an undo restores from, so undoing
    // the older one would roll the machine back to a state two applies ago.
    const r = buildLogbook({
      changes: [
        change({ id: "first", applied_at: "2026-06-01T10:00:00Z", status: "applied", is_still_active: true }),
        change({ id: "second", applied_at: "2026-06-05T10:00:00Z", status: "applied", is_still_active: true }),
      ],
    });
    const c = r[0] as Extract<LogbookRecord, { kind: "change" }>;
    expect(c.id).toBe("second");
    expect(c.count).toBe(2);
    expect(c.active).toBe(true);
    expect(c.firstAt).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });

  it("with nothing live, the newest apply represents the group", () => {
    const r = buildLogbook({
      changes: [
        change({ id: "old", applied_at: "2026-06-01T10:00:00Z", status: "rolled_back", is_still_active: false }),
        change({ id: "new", applied_at: "2026-06-05T10:00:00Z", status: "rolled_back", is_still_active: false }),
      ],
    });
    const c = r[0] as Extract<LogbookRecord, { kind: "change" }>;
    expect(c.id).toBe("new");
    expect(c.active).toBe(false);
    expect(c.rolledBack).toBe(true);
    expect(c.count).toBe(2);
  });

  it("an apply with no honest timestamp is still DROPPED, not folded in as a count", () => {
    // Collapsing must not become a back door for the fabrication the builder exists to prevent:
    // a dropped row must not inflate someone else's count.
    const r = buildLogbook({
      changes: [
        change({ id: "ok", applied_at: "2026-06-01T10:00:00Z" }),
        change({ id: "bad", applied_at: "not-a-date" }),
      ],
    });
    const c = r[0] as Extract<LogbookRecord, { kind: "change" }>;
    expect(c.count).toBe(1);
    expect(c.id).toBe("ok");
  });

  it("collapsing does not disturb the other record kinds or the ordering", () => {
    const r = buildLogbook({
      changes: toggled(3),
      // toggled(3) = 28/29/30 May, so the folded row must land between these two.
      sessions: [session({ started_at: "2026-06-04T10:00:00Z" })],
      autopsy: [autopsy({ at: Date.parse("2026-05-29T09:00:00Z") })],
    });
    expect(r.map((x) => x.kind)).toEqual(["session", "change", "autopsy"]);
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

describe("buildLogbook — observed machine changes (Intelligence Phase 1; Machine Model since #450)", () => {
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
    expect(buildLogbook({ observed: [intel({ observed_at: "not-a-date" })] })).toEqual([]);
    const r = buildLogbook({
      observed: [intel({ id: "bad", observed_at: "" }), intel({ id: "good" })],
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

  it("absent observed_between ⇒ null (no invented window)", () => {
    const r = buildLogbook({ observed: [intel({ observed_between: undefined })] });
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
      observed: [intel({ observed_at: t })],
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

// Intimidation pass 2026-08-20 — the tape's month grouping is pure and order-preserving.
describe("groupByMonth — consecutive calendar months, order kept, nothing invented", () => {
  const rec = (iso: string, id: string): LogbookRecord => ({
    kind: "change",
    at: Date.parse(iso),
    id,
    title: id,
    active: true,
    rolledBack: false,
    payoffLabel: null,
    undoNote: null,
    repeats: 0,
    firstAt: Date.parse(iso),
  } as unknown as LogbookRecord);

  it("an empty tape is an empty list — never a fabricated month", () => {
    expect(groupByMonth([], "en")).toEqual([]);
  });

  it("splits on calendar month (local time), newest first, labels in the given locale", () => {
    const groups = groupByMonth(
      [
        rec("2026-08-20T16:24:00", "a"),
        rec("2026-08-01T00:00:01", "b"),
        rec("2026-07-31T23:59:59", "c"),
        rec("2026-06-03T06:08:00", "d"),
      ],
      "en",
    );
    expect(groups.map((g) => [g.key, g.label, g.records.map((r) => (r as { id: string }).id)])).toEqual([
      ["2026-08", "August 2026", ["a", "b"]],
      ["2026-07", "July 2026", ["c"]],
      ["2026-06", "June 2026", ["d"]],
    ]);
  });

  it("the same month in a different year is a different group", () => {
    const groups = groupByMonth([rec("2026-01-05T12:00:00", "x"), rec("2025-01-05T12:00:00", "y")], "en");
    expect(groups.map((g) => g.key)).toEqual(["2026-01", "2025-01"]);
  });

  it("flattening the groups gives back the input, row for row", () => {
    const input = [
      rec("2026-08-20T16:24:00", "a"),
      rec("2026-08-14T18:15:00", "b"),
      rec("2026-06-15T17:51:00", "c"),
    ];
    expect(groupByMonth(input, "en").flatMap((g) => g.records)).toEqual(input);
  });
});


// The tape's footnote comes from the model VERBATIM (#450). The honesty question here is which of
// the chronology's two sentences wins, because one of them says a record is INCOMPLETE.
describe("chronologyNote — the footnote is the model's sentence, never Compy's", () => {
  const chron = (over: Partial<ChangeChronology> = {}): ChangeChronology => ({
    identity_snapshots: 2,
    total_events: 3,
    coverage_note: "This view includes Compy-applied changes…",
    entries: [],
    dropped_unparseable: 0,
    causation_note: "Chronology never implies causation by itself.",
    ...over,
  });

  it("an unread model prints nothing — Compy does not invent a caveat", () => {
    expect(chronologyNote(null)).toBeNull();
    expect(chronologyNote(undefined)).toBeNull();
  });

  it("with rows on screen, the reason the record is incomplete outranks the causation caveat", () => {
    expect(chronologyNote(chron({ unknown_reason: "The Trust Ledger could not be read." }))).toBe(
      "The Trust Ledger could not be read.",
    );
  });

  it("with nothing recorded at all the reason is NOT the footnote — it belongs to the empty state", () => {
    const note = chronologyNote(
      chron({ total_events: 0, unknown_reason: "The Trust Ledger could not be read." }),
    );
    expect(note).toBe("Chronology never implies causation by itself.");
  });

  // bug → guard (self-review 2026-09-17): the first cut of #450 printed this reason under the rows
  // while `LedgerHealthNotice` was already printing the same failure above them — two voices for one
  // unreadable file, which is exactly what 61e092c2 built that notice to prevent.
  it("while the room already states the failure, the footnote is the caveat — not a second copy", () => {
    const note = chronologyNote(chron({ unknown_reason: "The Trust Ledger could not be read." }), {
      unknownStatedElsewhere: true,
    });
    expect(note).toBe("Chronology never implies causation by itself.");
    expect(note).not.toContain("could not be read");
  });

  it("no reason given ⇒ the causation caveat, and an empty caveat is no footnote at all", () => {
    expect(chronologyNote(chron())).toBe("Chronology never implies causation by itself.");
    expect(chronologyNote(chron({ causation_note: "" }))).toBeNull();
  });
});
