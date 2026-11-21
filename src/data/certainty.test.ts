import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BENCH_KIND_VALUES,
  BLACKBOX_STRENGTH_VALUES,
  CERTAINTY_VALUES,
  EVIDENCE_KIND_VALUES,
  FINDING_LEVEL_VALUES,
  PRIORITY_BASIS_VALUES,
  PROVENANCE_VALUES,
  SOURCES,
  STRENGTHS,
  fromBench,
  fromBlackboxStrength,
  fromCertainty,
  fromEvidenceKind,
  fromFindingLevel,
  fromHypothesisBand,
  fromPatternBand,
  fromPriorityRow,
  fromProvenance,
  limitMostLikelyToOne,
  sourceForAbsence,
  sourceKey,
  strengthFor,
  strengthKey,
  type Mapped,
  type SourcedValue,
} from "./certainty";

// D3 vocabulary, slice 1. The Rust enums keep their serde names (no wire change); these tests pin
// that every serialized value the Rust side can emit has a mapper row, and that the rules of the
// vocabulary hold in the types and functions.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

// Variants of a Rust enum as serde spells them. Same approach as machine-model-contract.test.ts.
function rustVariants(file: string, enumName: string, rename: "kebab-case" | "lowercase"): string[] {
  const src = readFileSync(join("src-tauri", "src", file), "utf8");
  const body = new RegExp(
    String.raw`#\[serde\(rename_all = "${rename}"\)\]\s*pub\(crate\) enum ${enumName} \{([\s\S]*?)\n\}`,
  ).exec(src);
  if (!body) throw new Error(`could not find ${rename} enum ${enumName} in ${file}`);
  return body[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z0-9]*,?$/.test(line))
    .map((line) => line.replace(/,$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
}

const src = (s: string): Mapped => ({ axis: "source", source: s as never });
const str = (s: string): Mapped => ({ axis: "strength", strength: s as never });
const CANT: Mapped = { axis: "cant-tell" };

describe("vocabulary wire contract (Rust serde names <-> TS literals)", () => {
  it("Certainty, EvidenceKind, blackbox Strength and priorities Basis list exactly the Rust variants", () => {
    expect([...CERTAINTY_VALUES].sort()).toEqual(rustVariants("paramedic.rs", "Certainty", "kebab-case").sort());
    expect([...EVIDENCE_KIND_VALUES].sort()).toEqual(rustVariants("paramedic.rs", "EvidenceKind", "kebab-case").sort());
    expect([...BLACKBOX_STRENGTH_VALUES].sort()).toEqual(rustVariants("blackbox.rs", "Strength", "lowercase").sort());
    expect([...PRIORITY_BASIS_VALUES].sort()).toEqual(rustVariants("priorities.rs", "Basis", "kebab-case").sort());
  });

  it("the bands the mappers read are exactly the Rust bands (priorities: high/medium/low; intelligence: plus unknown)", () => {
    expect(rustVariants("priorities.rs", "Confidence", "kebab-case").sort()).toEqual(["high", "low", "medium"]);
    expect(rustVariants("intelligence.rs", "Confidence", "kebab-case").sort()).toEqual(["high", "low", "medium", "unknown"]);
  });

  it("Source and Strength literals are the documented wire names, and Strength has no none member", () => {
    expect([...SOURCES]).toEqual(["read", "measured", "measured-once", "user", "general", "unread"]);
    expect([...STRENGTHS]).toEqual(["possible", "most-likely"]);
    expect(STRENGTHS as readonly string[]).not.toContain("none");
    expect(STRENGTHS as readonly string[]).not.toContain("unknown");
  });

  it("i18n keys are built under common.source.* and common.strength.*", () => {
    expect(SOURCES.map(sourceKey)).toContain("common.source.measured-once");
    expect(STRENGTHS.map(strengthKey)).toEqual(["common.strength.possible", "common.strength.most-likely"]);
  });
});

describe("mapping table: every old serialized value has a row", () => {
  it("Certainty", () => {
    const want: Record<(typeof CERTAINTY_VALUES)[number], Mapped> = {
      known: src("read"),
      measured: src("measured"),
      likely: str("most-likely"),
      possible: str("possible"),
      mechanism: src("general"),
      "cant-tell": CANT,
    };
    for (const v of CERTAINTY_VALUES) expect(fromCertainty(v), v).toEqual(want[v]);
  });

  it("EvidenceKind", () => {
    const want: Record<(typeof EVIDENCE_KIND_VALUES)[number], Mapped> = {
      known: src("read"),
      measured: src("measured"),
      "supported-inference": { axis: "source", source: "measured", relation: "supports" },
      "expected-mechanism": src("general"),
      unknown: src("unread"),
    };
    for (const v of EVIDENCE_KIND_VALUES) expect(fromEvidenceKind(v), v).toEqual(want[v]);
  });

  it("blackbox Strength: every band is Possible", () => {
    for (const v of BLACKBOX_STRENGTH_VALUES) expect(fromBlackboxStrength(v), v).toEqual(str("possible"));
  });

  it("priority rows: a fact (or a row with no basis) is read + 'effect not measured'; measured keeps at most Possible", () => {
    const fact: Mapped = { axis: "source", source: "read", note: "effect-not-measured" };
    for (const band of ["high", "medium", "low", "unknown", null, undefined] as const) {
      expect(fromPriorityRow("fact", band)).toEqual(fact);
      expect(fromPriorityRow(undefined, band)).toEqual(fact);
    }
    expect(fromPriorityRow("measured", "high")).toEqual(str("possible"));
    expect(fromPriorityRow("measured", "medium")).toEqual(str("possible"));
    expect(fromPriorityRow("measured", "low")).toEqual(src("measured"));
    expect(fromPriorityRow("measured", null)).toEqual(src("measured"));
  });

  it("hypotheses and patterns", () => {
    expect(fromHypothesisBand("high")).toEqual(str("possible"));
    expect(fromHypothesisBand("medium")).toEqual(str("possible"));
    expect(fromHypothesisBand("low")).toEqual(CANT);
    expect(fromHypothesisBand("unknown")).toEqual(CANT);
    for (const b of ["high", "medium", "low", "unknown"] as const) expect(fromPatternBand(b)).toEqual(src("measured"));
  });

  it("FindingLevel and Provenance", () => {
    const find: Record<(typeof FINDING_LEVEL_VALUES)[number], Mapped> = { measured: src("measured"), likely: str("possible"), unknown: src("unread") };
    for (const v of FINDING_LEVEL_VALUES) expect(fromFindingLevel(v), v).toEqual(find[v]);
    const prov: Record<(typeof PROVENANCE_VALUES)[number], Mapped> = { verified: src("read"), "measured-signal": src("measured-once"), "expected-impact": src("general") };
    for (const v of PROVENANCE_VALUES) expect(fromProvenance(v), v).toEqual(prov[v]);
  });

  it("Bench words: estimate is general, real play is measured once, a trial is measured, low is can't tell", () => {
    for (const band of ["high", "medium"] as const) {
      expect(fromBench("estimate", band)).toEqual(src("general"));
      expect(fromBench("real-play", band)).toEqual(src("measured-once"));
      expect(fromBench("measured", band)).toEqual(src("measured"));
    }
    for (const kind of BENCH_KIND_VALUES) for (const band of ["low", "unknown", null, undefined] as const) expect(fromBench(kind, band)).toEqual(CANT);
  });
});

describe("rules the vocabulary enforces", () => {
  it("no mapper returns most-likely except from Certainty 'likely'", () => {
    const bands = ["high", "medium", "low", "unknown", null, undefined] as const;
    const all: Mapped[] = [
      ...EVIDENCE_KIND_VALUES.map(fromEvidenceKind),
      ...BLACKBOX_STRENGTH_VALUES.map(fromBlackboxStrength),
      ...FINDING_LEVEL_VALUES.map(fromFindingLevel),
      ...PROVENANCE_VALUES.map(fromProvenance),
      ...CERTAINTY_VALUES.filter((c) => c !== "likely").map(fromCertainty),
    ];
    for (const band of bands) {
      all.push(fromHypothesisBand(band), fromPatternBand(band));
      for (const basis of [undefined, ...PRIORITY_BASIS_VALUES]) all.push(fromPriorityRow(basis, band));
      for (const kind of BENCH_KIND_VALUES) all.push(fromBench(kind, band));
    }
    expect(all.some((m) => m.axis === "strength" && m.strength === "most-likely")).toBe(false);
    expect(fromCertainty("likely")).toEqual(str("most-likely"));
  });

  it("a static fact is read, its effect is not measured, and it never carries a strength", () => {
    const m = fromPriorityRow("fact", "high");
    expect(m).toEqual({ axis: "source", source: "read", note: "effect-not-measured" });
    expect("strength" in m).toBe(false);
  });

  it("strengthFor: most likely needs two independent supports, no contradiction, and a main support that was read", () => {
    const base = { independentSupports: 2, contradicting: 0, keySupportUnread: false };
    expect(strengthFor(base)).toBe("most-likely");
    expect(strengthFor({ ...base, independentSupports: 1 })).toBe("possible");
    expect(strengthFor({ ...base, contradicting: 1 })).toBe("possible");
    expect(strengthFor({ ...base, keySupportUnread: true })).toBe("possible");
    expect(strengthFor({ independentSupports: 0, contradicting: 0, keySupportUnread: false })).toBeNull();
    expect(strengthFor({ independentSupports: 0, contradicting: 0, keySupportUnread: false, measuredSize: true })).toBe("possible");
    expect(strengthFor({ independentSupports: 0, contradicting: 2, keySupportUnread: false, measuredSize: true })).toBe("possible");
    expect(strengthFor({ independentSupports: 5, contradicting: 1, keySupportUnread: true })).toBe("possible");
  });

  it("at most one most-likely per answer", () => {
    expect(limitMostLikelyToOne(["most-likely", "most-likely", "possible", null, "most-likely"])).toEqual(["most-likely", "possible", "possible", null, "possible"]);
    expect(limitMostLikelyToOne([])).toEqual([]);
  });

  it("couldn't read is never none: absence is 'checked none' only for a fully covered window", () => {
    expect(sourceForAbsence(true)).toEqual({ axis: "source", source: "read", note: "checked-none" });
    expect(sourceForAbsence(false)).toEqual({ axis: "source", source: "unread" });
  });

  it("an unread value carries no value field", () => {
    const unread: SourcedValue<number> = { source: "unread", reason: "the log could not be opened" };
    expect("value" in unread).toBe(false);
    // @ts-expect-error: the unread arm has no `value`, so it cannot be read as an empty/zero value
    void unread.value;
  });
});
