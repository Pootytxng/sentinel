import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import type { AppliedChange } from "../types";
import { settingUndo, undoDialog, type SettingUndo } from "./undo-setting";

// C8 (C6 review, plan u4/u5; r1 F3): what the Applied card's Undo dialog says, per case, in en and zh-CN.
//
// WHAT THIS COVERS: for each case, the decision App's `rollback` makes (`settingUndo` on the list it reads) and the
// dialog `undoDialog` builds from it — title, body (with the note that says why only one record is undone) and
// confirm label — as the literal sentences the user reads; plus a source pin that App passes undoDialog's result
// to confirm() in `rollback` and `walkSetting` and builds none of those words itself.
// WHAT IT DOES NOT COVER: the dialog rendered by App (App is not rendered; the pin stands in for that call). The
// card's Undo -> onRollback(row) is pinned by Fix.test.tsx; the fresh re-read and the walk's per-record calls by
// undo-setting.test.ts and changed-before-restore.test.ts.

const row = (id: string, at: string, extra: Partial<AppliedChange> = {}): AppliedChange =>
  ({ id, rec_id: "game", rec_title: "Game Mode", applied_at: at, snapshot: null, status: "applied", is_still_active: true, active_check: "on", ...extra }) as AppliedChange;
const two = [row("g1", "2026-11-01T00:00:00Z"), row("g2", "2026-11-02T00:00:00Z")];
const en = i18n.getFixedT("en");
const zh = i18n.getFixedT("zh-CN");

const BASE = {
  en: "Compy restores the setting to how it was before.",
  zh: "Compy 会把这项设置恢复到之前的状态。",
};
const TITLE = { en: 'Roll back "Game Mode"?', zh: "回滚「Game Mode」？" };
const NOTE = {
  out_of_order: {
    en: "An older record of this setting was undone before this one, so this record's saved value may be one Compy set. Compy undoes one record at a time here.",
    zh: "此设置的一条较早记录在这条记录之前已被撤销，因此这条记录保存的值可能是 Compy 设置的。这里 Compy 一次只撤销一条记录。",
  },
  trial: {
    en: "A Trial is in progress (or Compy can't tell), so Compy undoes one record of this setting at a time here.",
    zh: "试验正在进行（或 Compy 无法判断），因此这里 Compy 一次只撤销此设置的一条记录。",
  },
  list_unread: {
    en: "Compy couldn't read its change list, so it undoes only this record here.",
    zh: "Compy 无法读取更改列表，因此这里只撤销这一条记录。",
  },
  no_saved_undo: {
    en: "One record of this setting has no saved undo, so Compy undoes one record at a time here.",
    zh: "此设置有一条记录没有保存的撤销信息，因此这里 Compy 一次只撤销一条记录。",
  },
} as const;

describe("the Applied card's Undo dialog, per case (C8, plan u4/u5; r1 F3)", () => {
  // Break check: in undoDialog, append a note for "single" (or drop the `note ? ... : body` branch's plain side)
  // -> the body is no longer the bare sentence, fails.
  it("one open record: today's dialog, no note", () => {
    const plan = settingUndo([row("g1", "2026-11-01T00:00:00Z")], "game", "none");
    expect(plan).toEqual({ kind: "one", why: "single", open: 1 });
    expect(undoDialog(plan, row("g1", "2026-11-01T00:00:00Z"), en)).toEqual({ title: TITLE.en, body: BASE.en, confirmLabel: "Roll back" });
    expect(undoDialog(plan, row("g1", "2026-11-01T00:00:00Z"), zh)).toEqual({ title: TITLE.zh, body: BASE.zh, confirmLabel: "回滚" });
  });

  // Break check: in undoDialog's walk branch, pass a fixed `total` (or rows.length - 1) -> the 3 in the body and
  // the label fails; or use rollbackBody for the walk -> the body fails.
  it("a walk of three: the count it walks, in the body and the confirm label, in both languages", () => {
    const plan = settingUndo([...two, row("g3", "2026-11-03T00:00:00Z")], "game", "none");
    expect(plan.kind === "walk" && plan.rows.length).toBe(3);
    expect(undoDialog(plan, two[0], en)).toEqual({
      title: TITLE.en,
      body: "3 records of this setting are not undone yet. Undoing it undoes each of them, newest first: each puts back what Compy saved just before that record's change, so the oldest record is undone last. If this setting needs administrator rights, Windows asks for permission once for each record. It stops at the first one that does not finish or that you decline.",
      confirmLabel: "Undo all 3 records",
    });
    expect(undoDialog(plan, two[0], zh)).toEqual({
      title: TITLE.zh,
      body: "此设置有 3 条记录尚未撤销。撤销它会从最新的开始逐条撤销这些记录：每条都会恢复 Compy 在该记录的更改之前保存的内容，因此最早的记录最后撤销。如果此设置需要管理员权限，Windows 会为每条记录请求一次许可。遇到第一条未完成或被你拒绝的记录就会停下。",
      confirmLabel: "撤销全部 3 条记录",
    });
  });

  // Break check: in undoDialog, map "trial" to rollbackOneUnread (or drop any one branch of the note chain) -> that
  // case's body fails in both languages.
  it.each([
    ["out_of_order", [row("g0", "2026-10-30T00:00:00Z", { status: "rolled_back", rolled_back_at: "2026-11-03T00:00:00Z" }), ...two], "none"],
    ["trial", two, "running"],
    ["list_unread", null, "none"],
    ["no_saved_undo", [row("g1", "2026-11-01T00:00:00Z", { undo_contract: false }), row("g2", "2026-11-02T00:00:00Z")], "none"],
  ] as const)("%s: a one-record undo whose dialog says why", (why, list, trial) => {
    const plan = settingUndo(list as readonly AppliedChange[] | null, "game", trial);
    expect(plan).toMatchObject({ kind: "one", why });
    expect(undoDialog(plan, two[1], en)).toEqual({ title: TITLE.en, body: `${BASE.en} ${NOTE[why].en}`, confirmLabel: "Roll back" });
    expect(undoDialog(plan, two[1], zh)).toEqual({ title: TITLE.zh, body: `${BASE.zh} ${NOTE[why].zh}`, confirmLabel: "回滚" });
  });

  // The note comes after the destination sentence, as App's dialog had it.
  // Break check: in undoDialog, put the note before `body` -> fails.
  it("a saved destination is named before the note", () => {
    const plan: SettingUndo = { kind: "one", why: "list_unread", open: 0 };
    const change = row("g2", "2026-11-02T00:00:00Z", { restores_label: "On" });
    expect(undoDialog(plan, change, en).body).toBe(`${BASE.en} It'll return to On. ${NOTE.list_unread.en}`);
    expect(undoDialog(plan, change, zh).body).toBe(`${BASE.zh}将恢复为 On。 ${NOTE.list_unread.zh}`);
  });
});

// The source pin: App builds no Undo-dialog words itself; `rollback` and `walkSetting` each pass undoDialog's
// result to confirm() once. Break check: put a `t("app.dialogs.rollbackOneTrial")` back into App's rollback, or
// call confirm({ title: ... }) there -> fails.
describe("App's Undo dialogs come from undoDialog", () => {
  const app = readFileSync(join("src", "App.tsx"), "utf8");
  const rollback = app.split("const rollback = async")[1]?.split("const walkSetting = async")[0] ?? "";
  const walk = app.split("const walkSetting = async")[1]?.split("\n  };\n")[0] ?? "";

  it("rollback calls undoDialog exactly once and builds none of its words", () => {
    expect(rollback.match(/undoDialog\(/g)?.length).toBe(1);
    expect(rollback).toMatch(/confirm\(undoDialog\(plan, change, t\)\)/);
    expect(rollback).not.toMatch(/app\.dialogs\.rollback|keptOutsideUndoBody|plan\.why/);
  });

  it("walkSetting passes the walk it runs to undoDialog and builds none of its words", () => {
    expect(walk.match(/undoDialog\(/g)?.length).toBe(1);
    expect(walk).toMatch(/confirm\(undoDialog\(\{ kind: "walk", rows \}, change, t\)\)/);
    expect(walk).not.toMatch(/app\.dialogs\.rollback/);
  });
});
