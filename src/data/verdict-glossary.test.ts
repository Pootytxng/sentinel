import { describe, it, expect } from "vitest";
import {
  VERDICT_GLOSSARY,
  VERDICT_GLOSSARY_ENTRY_ID,
  verdictChip,
  verdictDefinition,
} from "./verdict-glossary";
import { searchKnowledge } from "./knowledge-search";
import { autopsyScan } from "./knowledge-autopsy";
import { KNOWLEDGE_BY_ID } from "./knowledge";

describe("verdict glossary — the single source for Real/Placebo/Risky", () => {
  it("covers all three verdicts with non-empty, banned-word-free definitions", () => {
    expect(VERDICT_GLOSSARY.map((r) => r.verdict)).toEqual(["real", "placebo", "risky"]);
    for (const r of VERDICT_GLOSSARY) {
      expect(r.chip.trim()).not.toBe("");
      expect(r.definition.trim().length).toBeGreaterThan(20);
      // THE VOICE: no condescending filler (mirrors the knowledge-dataset lint).
      expect(/\b(simply|obviously|basically)\b/i.test(r.definition)).toBe(false);
    }
  });

  it("chip + definition helpers resolve for every verdict", () => {
    for (const r of VERDICT_GLOSSARY) {
      expect(verdictChip(r.verdict)).toBe(r.chip);
      expect(verdictDefinition(r.verdict)).toBe(r.definition);
    }
  });

  it("ships the 'How Compy grades things' entry, findable by the documented search terms", () => {
    expect(KNOWLEDGE_BY_ID.has(VERDICT_GLOSSARY_ENTRY_ID)).toBe(true);
    for (const q of ["grade", "placebo", "real", "risky", "verdict"]) {
      const ids = searchKnowledge(q).map((e) => e.id);
      expect(ids, `search "${q}" should surface the grading entry`).toContain(
        VERDICT_GLOSSARY_ENTRY_ID,
      );
    }
  });

  it("does NOT pollute the Guide Autopsy — common verdict words don't match the meta-entry", () => {
    // A normal guide that happens to say real / placebo / risky must not produce a how-we-grade hit
    // (its aliases are safe multi-word phrases; bare verdict words would have polluted the matcher).
    const res = autopsyScan(
      "Enable XMP for real gains. That myth is a placebo. Disabling Defender is risky.",
    );
    expect(res.hits.map((h) => h.id)).not.toContain(VERDICT_GLOSSARY_ENTRY_ID);
  });
});
