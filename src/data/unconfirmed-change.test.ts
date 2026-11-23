import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordedWithoutResult, unconfirmedTitles } from "./unconfirmed-change";
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

  // The Home fast path lists the batch result too. It has no render harness, so its wiring is pinned in the
  // source: App fills `unconfirmed`, HomeConsole keeps it, HomeInterview shows each title with the warning.
  it("every surface that lists a batch result carries the unconfirmed titles through", () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src("../App.tsx")).toContain("unconfirmed: unconfirmedTitles(report),");
    expect(src("../surfaces/HomeConsole.tsx")).toContain("unconfirmedItems: res.unconfirmed ?? [],");
    const interview = src("../surfaces/HomeInterview.tsx");
    expect(interview).toContain("(fastPathReceipt.unconfirmedItems ?? []).map((title) =>");
    expect(interview).toContain('t("optimize.fix.resultUnconfirmedItem", { title, note: t("optimize.fix.resultUnconfirmed") })');
  });

  it("the warning has its exact English text and a Chinese text with the same parts", () => {
    expect(en.fix.resultUnconfirmed).toBe(
      "Compy didn't get a result for this change, so it is recorded as made. Check the setting in Windows, and undo it here if you don't want it.",
    );
    // Same meaning: no result received, recorded as made, check in Windows, undo here.
    for (const part of ["没有收到", "结果", "记录为", "Windows", "检查", "撤销"]) {
      expect(zh.fix.resultUnconfirmed).toContain(part);
    }
    expect(en.fix.resultUnconfirmedItem).toBe("{{title}}: {{note}}");
    expect(zh.fix.resultUnconfirmedItem).toContain("{{title}}");
    expect(zh.fix.resultUnconfirmedItem).toContain("{{note}}");
  });
});
