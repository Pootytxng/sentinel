import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import type { AppliedChange } from "../types";
import { settingUndo } from "./undo-setting";

// C8 (C6 review, plan u4/u5): what the Applied card's Undo dialog says, per case.
//
// WHAT THIS COVERS: for each case the decision App's `rollback` makes (`settingUndo` on the list it reads), the
// note App puts in the dialog for that decision (read from App.tsx's own why -> key chain, so a re-mapped or dropped
// note fails here), and the dialog's words in en and zh-CN with the count the walk dialog shows.
// WHAT IT DOES NOT COVER: the dialog rendered by App itself. <App> mounts 20+ effects and the Lab room behind a
// hardware read (with its 3D hologram), and App's `rollback` is a closure inside App, so no test can reach it
// without rendering App or extracting it (not done here). The card's Undo -> onRollback(row) is pinned by
// Fix.test.tsx; the fresh re-read and the walk's per-record calls by undo-setting.test.ts and
// changed-before-restore.test.ts. Break check: map "trial" to rollbackOneUnread in App.tsx -> the Trial case fails.

const row = (id: string, at: string, extra: Partial<AppliedChange> = {}): AppliedChange =>
  ({ id, rec_id: "game", rec_title: "Game Mode", applied_at: at, snapshot: null, status: "applied", is_still_active: true, active_check: "on", ...extra }) as AppliedChange;
const two = [row("g1", "2026-11-01T00:00:00Z"), row("g2", "2026-11-02T00:00:00Z")];

/** App.tsx's `plan.why === "x" ? t("key")` chain in `rollback`, as {why: key}. */
function appNotes(): Record<string, string> {
  const app = readFileSync(join("src", "App.tsx"), "utf8");
  const body = app.split("const rollback = async")[1].split("const walkSetting = async")[0];
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/plan\.why === "([a-z_]+)"\s*\?\s*t\("([^"]+)"\)/g)) out[m[1]] = m[2];
  return out;
}

describe("the Applied card's Undo dialog, per case (C8, plan u4/u5)", () => {
  const notes = appNotes();
  const en = i18n.getFixedT("en");
  const zh = i18n.getFixedT("zh-CN");

  it("one open record: today's dialog, no note", () => {
    const plan = settingUndo([row("g1", "2026-11-01T00:00:00Z")], "game", "none");
    expect(plan).toEqual({ kind: "one", why: "single", open: 1 });
    expect(notes.single).toBeUndefined();
    expect(en("app.dialogs.rollbackBody", { dest: "" })).toBe("Compy restores the setting to how it was before.");
  });

  it("several open records: the walk dialog names the count it walks, in both languages", () => {
    const plan = settingUndo([...two, row("g3", "2026-11-03T00:00:00Z")], "game", "none");
    expect(plan.kind === "walk" && plan.rows.length).toBe(3);
    expect(en("app.dialogs.rollbackMany", { total: 3 })).toBe("Undo all 3 records");
    expect(en("app.dialogs.rollbackManyBody", { total: 3 })).toMatch(/^3 records of this setting are not undone yet\./);
    expect(zh("app.dialogs.rollbackMany", { total: 3 })).toBe("撤销全部 3 条记录");
  });

  it.each([
    ["out_of_order", [row("g0", "2026-10-30T00:00:00Z", { status: "rolled_back", rolled_back_at: "2026-11-03T00:00:00Z" }), ...two], "none", "app.dialogs.rollbackOneOutOfOrder"],
    ["trial", two, "running", "app.dialogs.rollbackOneTrial"],
    ["list_unread", null, "none", "app.dialogs.rollbackOneUnread"],
    ["no_saved_undo", [row("g1", "2026-11-01T00:00:00Z", { undo_contract: false }), row("g2", "2026-11-02T00:00:00Z")], "none", "app.dialogs.rollbackOneNoSavedUndo"],
  ] as const)("%s: a one-record undo whose dialog says why", (why, list, trial, key) => {
    expect(settingUndo(list as readonly AppliedChange[] | null, "game", trial)).toMatchObject({ kind: "one", why });
    expect(notes[why], `App.tsx maps ${why}`).toBe(key);
    for (const t of [en, zh]) {
      const note = t(key);
      expect(note, `${key}`).not.toBe(key);
      expect(note.length).toBeGreaterThan(10);
    }
    // Every note says one record is undone, never a walk.
    expect(en(key)).toMatch(/one record|only this record/);
  });
});