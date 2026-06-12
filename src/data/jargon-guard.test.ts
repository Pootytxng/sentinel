// The Sarah & Caleb jargon guard (spec 2026-06-12-blackbook §B3) — named for two real
// non-technical testers. LAW: a Blackbook entry may use a technical term ONLY if the reader can
// resolve it without leaving the entry: either the entry IS that term's explainer, or it
// cross-links the explainer (`related` → the chip renders right on the card), or it glosses it
// inline. This test makes the cross-link form grep-provable over the four hand-curated datasets
// (derived entries — tuning guides, how-we-grade — are hand-swept; their sources live elsewhere).
// Plain ≠ vague: this guard never asks copy to drop a number or weaken a claim (receipts law).
import { describe, it, expect } from "vitest";
import rawTweaks from "./tweaks.json";
import rawTerms from "./terms.json";
import rawTricks from "./tricks.json";
import rawGuides from "./guides.json";

type Raw = Record<string, unknown>;
const DATASETS: [string, Raw[]][] = [
  ["tweak", rawTweaks as Raw[]],
  ["term", rawTerms as Raw[]],
  ["trick", rawTricks as Raw[]],
  ["guide", rawGuides as Raw[]],
];

// Curated list: jargon (matched on word boundaries, case-sensitive where the term is an acronym)
// → the entry id that explains it in plain words. Extend BOTH when new jargon enters the corpus.
const JARGON: [RegExp, string][] = [
  [/\bHPET\b/, "hpet"],
  [/\bMPO\b/, "mpo"],
  [/\bETW\b/, "etw"],
  [/\bXMP\b/, "xmp"],
  [/\bEXPO\b/, "xmp"],
  [/\bVRR\b/, "vrr"],
  [/\bVRAM\b/, "vram"],
  [/\bframetimes?\b/i, "frametime"],
  [/\b1% lows?\b/i, "one-percent-lows"],
  [/\bC-states?\b/i, "c-states"],
  [/\bPBO\b/, "pbo"],
  [/\bDPC\b/, "dpc-latency"],
  [/\bNVMe\b/, "nvme-ssd-hdd"],
  [/\bTPM\b/, "tpm"],
  [/\bUEFI\b/, "uefi-bios"],
  [/\bCSM\b/, "csm"],
  [/\bDDU\b/, "ddu"],
  [/\bSMT\b/, "disable-smt-gaming"],
  [/\bVBS\b/, "disable-vbs"],
  [/\bmV\b/, "undervolting"],
  [/\bswapchain\b/i, "frametime"], // no dedicated entry; frametime explains the present pipeline
];

// The searchable prose of a raw entry, type-aware (mirrors knowledge.ts entryBody + name).
function proseOf(type: string, e: Raw): string {
  const s = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : "");
  const steps = Array.isArray(e.steps) ? (e.steps as string[]).join(" ") : "";
  switch (type) {
    case "tweak":
      return `${s("name")} ${s("what")} ${s("why")}`;
    case "term":
      return `${s("name")} ${s("what")} ${s("more")}`;
    case "trick":
      return `${s("name")} ${s("pattern")} ${s("tell")} ${s("honest_version")}`;
    default:
      return `${s("name")} ${s("goal")} ${steps} ${s("undo")}`;
  }
}

describe("Sarah & Caleb jargon guard (Blackbook §B3)", () => {
  it("every jargon term maps to a real explainer entry", () => {
    const ids = new Set(DATASETS.flatMap(([, list]) => list.map((e) => String(e.id))));
    for (const [, glossId] of JARGON) {
      expect(ids.has(glossId), `gloss target '${glossId}' must exist`).toBe(true);
    }
  });

  it("no entry uses listed jargon without BEING or CROSS-LINKING its explainer", () => {
    const offenders: string[] = [];
    for (const [type, list] of DATASETS) {
      for (const e of list) {
        const id = String(e.id);
        const related = Array.isArray(e.related) ? (e.related as string[]) : [];
        const aliases = Array.isArray(e.aliases) ? (e.aliases as string[]).join(" ") : "";
        const text = proseOf(type, e);
        for (const [re, glossId] of JARGON) {
          if (!re.test(text)) continue;
          const isSelf = id === glossId;
          // An entry whose ALIASES carry the term is about that thing (e.g. "hpet" aliases on
          // the useplatformclock tweak) — it explains itself. Aliases are lowercase by
          // convention, so ownership matching ignores the acronym's case.
          const aliasOwns = new RegExp(re.source, "i").test(aliases);
          if (!isSelf && !aliasOwns && !related.includes(glossId)) {
            offenders.push(`${type} '${id}' uses ${re} without linking '${glossId}'`);
          }
        }
      }
    }
    expect(offenders, `Sarah & Caleb violations:\n${offenders.join("\n")}`).toEqual([]);
  });
});
