import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { AppliedChange } from "../types";
import { openRecordsNewestFirst, settingUndo, undoneOutOfOrder } from "./undo-setting";

// C6: whether "Undo" on a setting walks its open records, and in which order. Pure; nothing here calls a rollback.

const row = (id: string, rec: string, at: string, extra: Partial<AppliedChange> = {}): AppliedChange =>
  ({
    id,
    rec_id: rec,
    rec_title: rec,
    applied_at: at,
    snapshot: null,
    status: "applied",
    is_still_active: true,
    active_check: "on",
    ...extra,
  }) as AppliedChange;
const undone = (id: string, rec: string, at: string, undoneAt: string | null) =>
  row(id, rec, at, { status: "rolled_back", rolled_back_at: undoneAt });

describe("C6 per-setting undo: which records, which order", () => {
  // u1. Break check: drop the rec_id filter -> the other setting's record is walked too, fails.
  it("walks only this setting's open records, newest first", () => {
    const list = [row("g1", "game", "2026-11-01T00:00:00Z"), row("o1", "other", "2026-11-02T00:00:00Z"), row("g2", "game", "2026-11-03T00:00:00Z"), row("g3", "game", "2026-11-04T00:00:00Z")];
    const plan = settingUndo(list, "game", "none");
    expect(plan.kind === "walk" && plan.rows.map((r) => r.id)).toEqual(["g3", "g2", "g1"]);
  });

  // u3. Break check: drop the status filter -> the already undone record is walked, fails.
  it("skips records already undone", () => {
    const list = [row("g1", "game", "2026-11-01T00:00:00Z"), undone("g2", "game", "2026-11-02T00:00:00Z", "2026-11-02T01:00:00Z"), row("g3", "game", "2026-11-03T00:00:00Z")];
    expect(openRecordsNewestFirst(list, "game").map((r) => r.id)).toEqual(["g3", "g1"]);
  });

  // u7. Break check: sort by applied_at -> ["b", "a"] reversed to ["a", "b"], fails.
  it("follows the change history's order when applied_at disagrees with it (a clock set back)", () => {
    const list = [row("a", "game", "2026-11-05T00:00:00Z"), row("b", "game", "2026-11-04T00:00:00Z")];
    expect(openRecordsNewestFirst(list, "game").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("one open record is today's one-record undo, never a walk", () => {
    expect(settingUndo([row("g1", "game", "2026-11-01T00:00:00Z")], "game", "none")).toEqual({ kind: "one", why: "single", open: 1 });
  });

  // MC4: no list, no walk.
  it("an unread change list never walks", () => {
    expect(settingUndo(null, "game", "none")).toEqual({ kind: "one", why: "list_unread", open: 0 });
  });
});

describe("C6 per-setting undo: when the walk is not offered", () => {
  // u10 (MC1). Break check: drop the out-of-order detection -> a walk is offered, fails.
  it("an older record undone after a newer one was applied gives the one-record undo", () => {
    // g1 applied, g2 applied (snapshot: Compy's own value from g1), then g1 undone (by a Trial restore, say).
    const list = [undone("g1", "game", "2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z"), row("g2", "game", "2026-11-02T00:00:00Z"), row("g3", "game", "2026-11-04T00:00:00Z")];
    expect(undoneOutOfOrder(list, "game")).toBe(true);
    expect(settingUndo(list, "game", "none")).toEqual({ kind: "one", why: "out_of_order", open: 2 });
  });

  it("an older record with no undo date counts as out of order (can't tell); one undone in order does not", () => {
    const noDate = [undone("g1", "game", "2026-11-01T00:00:00Z", null), row("g2", "game", "2026-11-02T00:00:00Z"), row("g3", "game", "2026-11-03T00:00:00Z")];
    expect(undoneOutOfOrder(noDate, "game")).toBe(true);
    // In order: g1 undone BEFORE g2 was applied. g2's saved value is the restored one: the walk stays offered.
    const inOrder = [undone("g1", "game", "2026-11-01T00:00:00Z", "2026-11-01T12:00:00Z"), row("g2", "game", "2026-11-02T00:00:00Z"), row("g3", "game", "2026-11-03T00:00:00Z")];
    expect(undoneOutOfOrder(inOrder, "game")).toBe(false);
    expect(settingUndo(inOrder, "game", "none").kind).toBe("walk");
  });

  // u12. Break check: drop the trial check -> a walk is offered during a Trial, fails.
  it("a Trial in progress, or one Compy can't rule out, gives the one-record undo", () => {
    const list = [row("g1", "game", "2026-11-01T00:00:00Z"), row("g2", "game", "2026-11-02T00:00:00Z")];
    expect(settingUndo(list, "game", "running")).toEqual({ kind: "one", why: "trial", open: 2 });
    expect(settingUndo(list, "game", "unknown")).toEqual({ kind: "one", why: "trial", open: 2 });
  });
});

describe("C6 per-setting undo: the audited path only (source pins)", () => {
  const src = (p: string) => readFileSync(join("src", p), "utf8");

  // u6 (rewritten after review r1). The one-row callers stay one-row: FirstWin, TrustMoment and the Trial outcome
  // (rollback_change_citing) undo exactly the record they name. BlackBox is a runRestore caller (its changed-before
  // restore walks records). Break check: route FirstWin through runSettingWalk -> fails.
  it("FirstWin and TrustMoment undo one record; BlackBox's restore stays on runRestore", () => {
    for (const f of ["surfaces/FirstWin.tsx", "surfaces/TrustMoment.tsx"]) {
      const s = src(f);
      expect(s).toMatch(/writeLedger\("rollback_change", \{ changeId: change\.id \}\)/);
      expect(s).not.toMatch(/runSettingWalk|runRestore|settingUndo/);
    }
    expect(src("surfaces/BlackBox.tsx")).toMatch(/runRestore\(plan\.steps/);
  });

  // The walk's ONLY rollback call is `rollback_change` through writeLedger: never the citing variant, never a
  // history:: command. Break check: call "rollback_change_citing" in walkSetting -> fails.
  it("App's walk goes through runSettingWalk and writeLedger('rollback_change') only", () => {
    const app = src("App.tsx");
    const walk = app.split("const walkSetting = async")[1].split("\n  };\n")[0];
    expect(walk).toMatch(/runSettingWalk\(rows, \(changeId\) => writeLedger\("rollback_change", \{ changeId \}\)\)/);
    expect(walk).not.toMatch(/rollback_change_citing|history::/);
    expect(app).toMatch(/settingUndo\(changesReadFailed \? null : changes, change\.rec_id, trial\)/);
  });
});
