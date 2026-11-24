import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { confirmedCount, recordedWithoutResult, unconfirmedTitles } from "./unconfirmed-change";
import en from "../i18n/locales/en/optimize.json";
import zh from "../i18n/locales/zh-CN/optimize.json";

describe("A5 Part A: changes recorded without the admin step's own result", () => {
  it("a ledger row needs checking only while it is applied and marked", () => {
    expect(recordedWithoutResult({ status: "applied", result_unconfirmed: true })).toBe(true);
    expect(recordedWithoutResult({ status: "applied", result_unconfirmed: false })).toBe(false);
    expect(recordedWithoutResult({ status: "applied" })).toBe(false);
    expect(recordedWithoutResult({ status: "rolled_back", result_unconfirmed: true })).toBe(false);
  });

  it("the batch names exactly its applied-but-unconfirmed items, in order", () => {
    const items = [
      { rec_id: "a", rec_title: "A", status: "applied" as const },
      { rec_id: "b", rec_title: "B", status: "applied" as const, reason: "why", unconfirmed: true },
      { rec_id: "c", rec_title: "C", status: "skipped" as const, reason: "why", unconfirmed: true },
      { rec_id: "d", rec_title: "D", status: "applied" as const, reason: "why" },
      { rec_id: "e", rec_title: "E", status: "applied" as const, unconfirmed: true },
    ];
    expect(unconfirmedTitles({ items })).toEqual(["B", "E"]);
  });

  // Review r1 C: "Applied {{count}}" and the Home receipt count only what Compy knows was made.
  it("an unconfirmed item is never counted as applied", () => {
    const items = [
      { rec_id: "a", rec_title: "A", status: "applied" as const },
      { rec_id: "b", rec_title: "B", status: "applied" as const, reason: "why", unconfirmed: true },
      { rec_id: "c", rec_title: "C", status: "skipped" as const, reason: "why" },
    ];
    expect(confirmedCount({ items })).toBe(1);
    expect(confirmedCount({ items: [items[1]] })).toBe(0);
    expect(confirmedCount({ items: [] })).toBe(0);
  });

  // The Home fast path lists the batch result too. It has no render harness, so its wiring is pinned in the
  // source: App fills `unconfirmed` and the confirmed count, HomeConsole keeps them, HomeInterview shows each
  // title with the warning (the variant without "here": the receipt has no undo of its own).
  it("every surface that lists a batch result carries the unconfirmed titles through", () => {
    // Paths from the repository root (vitest's working directory), as the other source-pin tests read them.
    const src = (p: string) => readFileSync(join("src", "data", p), "utf8").replace(/\r\n/g, "\n");
    const app = src("../App.tsx");
    expect(app).toContain("const unconfirmed = unconfirmedTitles(report);");
    expect(app).toContain("applied: confirmedCount(report),");
    expect(app).not.toContain("applied: report.applied,");
    expect(src("../surfaces/HomeConsole.tsx")).toContain("unconfirmedItems: res.unconfirmed ?? [],");
    const interview = src("../surfaces/HomeInterview.tsx");
    expect(interview).toContain("(fastPathReceipt.unconfirmedItems ?? []).map((title) =>");
    expect(interview).toContain(
      't("optimize.fix.resultUnconfirmedItem", { title, note: t("optimize.fix.resultUnconfirmedNoUndoHere") })',
    );
    expect(src("../surfaces/YourData.tsx")).toContain('t("optimize.fix.resultUnconfirmedNoUndoHere")');
  });

  it("the warning has its exact English text and a Chinese text with the same parts", () => {
    expect(en.fix.resultUnconfirmed).toBe(
      "Compy didn't get a result for this change, so it may or may not have been made. It is recorded so it can be undone: check the setting in Windows, and undo it here if you don't want it.",
    );
    expect(en.fix.resultUnconfirmedNoUndoHere).toBe(
      "Compy didn't get a result for this change, so it may or may not have been made. It is recorded so it can be undone: check the setting in Windows, and undo it if you don't want it.",
    );
    // Same meaning: no result received, can't tell whether it was made, recorded so it can be undone, check
    // in Windows, undo (here only where the screen has an undo).
    for (const key of ["resultUnconfirmed", "resultUnconfirmedNoUndoHere"] as const) {
      for (const part of ["没有收到", "结果", "无法确定", "是否已做出", "已记录", "以便可以撤销", "Windows", "检查", "撤销"]) {
        expect(zh.fix[key]).toContain(part);
      }
      // Never "recorded as made": an unconfirmed change is not said to have happened.
      expect(zh.fix[key]).not.toContain("记录为已做出");
    }
    expect(zh.fix.resultUnconfirmed).toContain("在这里撤销");
    expect(zh.fix.resultUnconfirmedNoUndoHere).not.toContain("在这里");
    for (const text of [en.fix.resultUnconfirmed, en.fix.resultUnconfirmedNoUndoHere]) {
      expect(text).not.toMatch(/recorded as made|\bfailed\b|\bsucceeded\b/);
    }
    expect(en.fix.resultUnconfirmedNoUndoHere).not.toContain("here");
    expect(en.fix.resultUnconfirmedItem).toBe("{{title}}: {{note}}");
    expect(zh.fix.resultUnconfirmedItem).toContain("{{title}}");
    expect(zh.fix.resultUnconfirmedItem).toContain("{{note}}");
  });
});
