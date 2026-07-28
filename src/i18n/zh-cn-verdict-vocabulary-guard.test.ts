import { describe, expect, it } from "vitest";
import { knowledgeByIdForLanguage } from "../data/knowledge";
import { VERDICT_GLOSSARY_ENTRY_ID } from "../data/verdict-glossary";
import zhBlackbook from "./locales/zh-CN/blackbook.json";

const stringLeaves = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
};

describe("zh-CN verdict vocabulary guard", () => {
  it("uses the owner-approved Chinese verdict labels across every zh-CN grading surface", () => {
    expect([
      zhBlackbook.verdictGlossary.real.chip,
      zhBlackbook.verdictGlossary.placebo.chip,
      zhBlackbook.verdictGlossary.risky.chip,
    ]).toEqual(["真有效", "安慰剂", "有风险 — 已拒绝"]);

    const gradingEntry = knowledgeByIdForLanguage("zh-CN").get(VERDICT_GLOSSARY_ENTRY_ID);
    expect(gradingEntry?.type).toBe("term");
    if (!gradingEntry || gradingEntry.type !== "term") {
      throw new Error("zh-CN grading knowledge entry is missing or has the wrong type");
    }

    const userFacingVerdictStrings = [
      ...stringLeaves(zhBlackbook),
      gradingEntry.name,
      gradingEntry.what,
      gradingEntry.more,
    ];
    const englishVerdictStrings = userFacingVerdictStrings.filter((value) => {
      const userVisibleText = value.replace(/\{\{[^}]+\}\}/g, "");
      return /\b(?:real|placebo|risky)\b/i.test(userVisibleText);
    });
    expect(englishVerdictStrings).toEqual([]);
  });
});
