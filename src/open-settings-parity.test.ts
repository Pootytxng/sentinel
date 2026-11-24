import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "./i18n";
import { undoTally } from "./data/live-changes";
import { undoTallyWords } from "./data/undo-tally-words";
import type { AppliedChange } from "./types";
import fixture from "./test/fixtures/open-settings-parity.json";

// C7 ONE OPEN COUNT. A consumer panel saw four numbers for one ledger: the footer's "13 changes can be undone ·
// 2 changed outside Compy", Your data's 45 "Still in place" rows, "CHANGES COMPY MADE 18" and "9 of 10 on". Each
// was right and counted something different (settings vs rows; open vs ever; ledger vs catalog). The footer, Home's
// note, Health and Your data now count settings not undone through ONE rule, history.rs `open_settings`, and say
// "records" for rows. This file holds the TS half (undoTally, the footer and Home's note); the Rust tests named
// below read the same fixture for Health and Your data.

type Row = (typeof fixture.rows)[number];
const toChange = (r: Row): AppliedChange =>
  ({
    id: r.id,
    rec_id: r.rec_id,
    rec_title: r.rec_title,
    applied_at: r.applied_at,
    snapshot: null,
    status: r.status as AppliedChange["status"],
    is_still_active: r.status === "applied" && r.active_check !== null && r.active_check !== "off",
    active_check: r.active_check as AppliedChange["active_check"],
    undo_contract: r.undo_contract,
  }) as AppliedChange;
const changes = fixture.rows.map(toChange);
const X = fixture.expected;

describe("C7: the footer and Home's note count the same settings as history.rs open_settings", () => {
  it("the fixture holds re-applies, an undone setting, changed outside, no saved undo, a kept Trial, a row nobody read", () => {
    expect(changes.filter((c) => c.rec_id === "game-mode" && c.status === "applied").length).toBe(3);
    expect(changes.filter((c) => c.rec_id === "hags-enable").every((c) => c.status === "rolled_back")).toBe(true);
    expect(changes.some((c) => c.active_check === "off")).toBe(true);
    expect(changes.some((c) => c.undo_contract === false)).toBe(true);
    expect(changes.some((c) => c.active_check == null && c.status === "applied")).toBe(true);
    expect(fixture.rows.some((r) => /Trial the user kept/.test(r.note))).toBe(true);
  });

  // Break check: restore the pre-C7 undoTally (offOutside and unchecked filled independently) -> pcie-aspm-off
  // counts in both, unchecked 2, fails; count rolled-back rows in `records` -> 14, fails.
  it("undoTally gives every number open_settings gives", () => {
    const tally = undoTally(changes);
    expect(tally.settings).toBe(X.settings);
    expect(tally.records).toBe(X.records);
    expect(tally.undoable).toBe(X.undoable);
    expect(tally.noSavedUndo).toBe(X.no_saved_undo);
    expect(tally.offOutside).toBe(X.changed_outside);
    expect(tally.unchecked).toBe(X.unchecked);
    expect(tally.undoable + tally.noSavedUndo).toBe(X.in_effect + X.cant_confirm);
    expect(tally.undoable + tally.noSavedUndo + tally.offOutside + tally.unchecked).toBe(tally.settings);
    expect(changes.length).toBe(X.ledger_records);
  });

  it("the footer and Home's note say settings for those numbers, never changes", () => {
    const en = i18n.getFixedT("en");
    expect(undoTallyWords(undoTally(changes), en)).toBe(
      "4 settings can be undone · 1 setting has no saved undo · 2 settings changed outside Compy, no undo · 1 setting not checked",
    );
    const zh = i18n.getFixedT("zh-CN");
    expect(undoTallyWords(undoTally(changes), zh)).toBe(
      "4 项设置可撤销 · 1 项设置没有保存的撤销方式 · 2 项设置已在 Compy 之外更改，无法撤销 · 1 项设置未检查",
    );
  });

  it("Health and Your data: the Rust tests read this same fixture", () => {
    const rs = (f: string) => readFileSync(join("src-tauri", "src", f), "utf8");
    const inc = 'include_str!("../../src/test/fixtures/open-settings-parity.json")';
    expect(rs("history.rs")).toContain(inc);
    expect(rs("history.rs")).toMatch(/fn open_settings_counts_settings_and_records_from_the_shared_fixture\(\)/);
    expect(rs("machine_model.rs")).toContain(inc);
    expect(rs("machine_model.rs")).toMatch(/fn health_counts_come_from_open_settings\(\)/);
    expect(rs("machine_model.rs")).toMatch(/crate::history::open_settings_of_views\(inp\.applied_changes\)/);
    expect(rs("data_clear.rs")).toContain(inc);
    expect(rs("data_clear.rs")).toMatch(/fn c7_the_your_data_list_counts_the_same_settings_and_records\(\)/);
  });
});