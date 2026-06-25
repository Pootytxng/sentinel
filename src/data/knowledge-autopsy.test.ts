import { describe, it, expect } from "vitest";
import { autopsyScan, AUTOPSY_MAX_CHARS } from "./knowledge-autopsy";
import type { KnowledgeEntry, TweakVerdict } from "./knowledge";

const tweak = (id: string, name: string, aliases: string[], verdict: TweakVerdict): KnowledgeEntry => ({
  type: "tweak",
  id,
  name,
  aliases,
  related: [],
  topic: "general",
  verdict,
  what: "",
  why: "",
});
const term = (id: string, name: string, aliases: string[]): KnowledgeEntry => ({
  type: "term",
  id,
  name,
  aliases,
  related: [],
  topic: "general",
  what: "",
  more: "",
});
const trick = (id: string, name: string, aliases: string[]): KnowledgeEntry => ({
  type: "trick",
  id,
  name,
  aliases,
  related: [],
  topic: "general",
  pattern: "",
  tell: "",
  honest_version: "",
});
const guide = (id: string, name: string, aliases: string[]): KnowledgeEntry => ({
  type: "guide",
  id,
  name,
  aliases,
  related: [],
  topic: "general",
  tier: "safe",
  goal: "",
  steps: [],
  undo: "",
});

const fx: KnowledgeEntry[] = [
  tweak("game-mode", "Game Mode", ["game mode"], "real"),
  term("mode", "Mode", ["mode"]), // shorter alias that overlaps "game mode"
  tweak("xmp-expo", "XMP", ["xmp", "expo"], "real"),
  tweak("hpet", "HPET", ["hpet"], "placebo"),
  tweak("defender", "Disable Defender", ["disable defender"], "risky"),
  term("ram", "RAM", ["ram"]), // boundary test: must not match inside "program"
  trick("deep-scan", "Fake deep scan", ["deep scan"]),
];

describe("autopsyScan", () => {
  it("empty paste yields nothing", () => {
    const r = autopsyScan("", fx);
    expect(r.hits).toEqual([]);
    expect(r.grade).toEqual({ real: 0, placebo: 0, risky: 0, unknown: 0 });
    expect(r.truncated).toBe(false);
    expect(r.scamFlags).toBe(0);
  });

  it("longest alias wins — 'game mode' credits the tweak, not the shorter 'mode' term", () => {
    const r = autopsyScan("enable game mode now", fx);
    const ids = r.hits.map((h) => h.id);
    expect(ids).toContain("game-mode");
    expect(ids).not.toContain("mode");
    expect(r.grade.real).toBe(1);
  });

  it("repeated and multi-alias mentions count occurrences but a verdict only once", () => {
    const r = autopsyScan("first xmp, then xmp again, also expo", fx);
    const hit = r.hits.find((h) => h.id === "xmp-expo");
    expect(hit?.occurrences).toBe(3); // xmp, xmp, expo
    expect(r.grade.real).toBe(1); // counted once as a distinct real tweak
  });

  it("is case-insensitive (case soup)", () => {
    const r = autopsyScan("GaMe MoDe", fx);
    expect(r.hits.map((h) => h.id)).toContain("game-mode");
  });

  it("respects word boundaries — 'program' does not match the alias 'ram'", () => {
    const r = autopsyScan("the programmer wrote a program", fx);
    expect(r.hits.map((h) => h.id)).not.toContain("ram");
  });

  it("buckets verdicts and flags scam patterns separately", () => {
    const r = autopsyScan("disable defender, force hpet, run a deep scan", fx);
    expect(r.grade.risky).toBe(1); // disable defender
    expect(r.grade.placebo).toBe(1); // hpet
    expect(r.scamFlags).toBe(1); // deep scan trick
  });

  it("counts content lines with no recognized term as 'unknown', never guessed", () => {
    const r = autopsyScan("enable xmp\nfoobar nonsense filler line\nturn on game mode", fx);
    expect(r.grade.real).toBe(2); // xmp + game mode
    expect(r.grade.unknown).toBe(1); // the nonsense line
  });

  it("caps oversized input gracefully and still matches within the cap", () => {
    const big = "force hpet\n" + "x".repeat(AUTOPSY_MAX_CHARS + 50);
    const r = autopsyScan(big, fx);
    expect(r.truncated).toBe(true);
    expect(r.hits.map((h) => h.id)).toContain("hpet");
  });

  it("a guide overlapping a verdict tweak attaches as a how-to, not a separate count", () => {
    const fx2: KnowledgeEntry[] = [
      tweak("xmp-expo", "XMP", ["xmp"], "real"),
      guide("xmp-guide", "Turn on XMP", ["enable xmp"]),
    ];
    const r = autopsyScan("please enable xmp now", fx2);
    expect(r.grade.real).toBe(1); // the verdict-bearing tweak wins the count
    const hit = r.hits.find((h) => h.id === "xmp-expo");
    expect(hit?.howTos).toContain("xmp-guide"); // guide attaches as a safe how-to
    expect(r.hits.map((h) => h.id)).not.toContain("xmp-guide"); // not a duplicate standalone row
  });

  it("a guide with no overlapping verdict still stands on its own", () => {
    const fx2: KnowledgeEntry[] = [
      guide("startup-cleanup-guide", "Clean up startup apps", ["startup cleanup"]),
    ];
    const r = autopsyScan("do a startup cleanup tonight", fx2);
    expect(r.hits.map((h) => h.id)).toContain("startup-cleanup-guide");
  });

  // Legit aim advice must NOT grade as placebo. The "Registry aim tweaks" placebo entry uses
  // scam-specific aliases only — the generic "better aim"/"improve aim" were dropped for exactly
  // this reason. Runs against the REAL dataset (default KNOWLEDGE), not a fixture.
  it("does not grade benign aim advice as placebo (aim-tweaks aliases are scam-specific)", () => {
    const r = autopsyScan("How to improve aim: mouse accel off.");
    expect(r.hits.map((h) => h.id)).not.toContain("aim-tweaks");
    expect(r.grade.placebo).toBe(0);
  });
});
