import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { confidenceWordKey, wordFromBand, wordFromBench, wordFromFinding, wordFromProvenance } from "./confidence-word";

/** The value at a dotted path, or undefined. */
const lookup = (tree: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), tree);

// P7-confidence (Constitution §25): ONE vocabulary — Known / Measured / Likely / Expected / Unknown —
// mapped from each producer's own field, never a percentage and never a raw high/medium/low on the
// default face. These pin the mapping and that every word has a string in every locale.
describe("confidence vocabulary", () => {
  it("maps an inference band: high and medium are Possible (never Likely: no two independent supports), low and unknown are not enough", () => {
    expect(wordFromBand("high")).toBe("possible");
    expect(wordFromBand("medium")).toBe("possible");
    expect(wordFromBand("low")).toBe("unknown");
    expect(wordFromBand("unknown")).toBe("unknown");
    expect(wordFromBand(null)).toBe("unknown");
  });

  it("maps a bench result through fromBench: an estimate is Expected; a real-play result and a two-session Trial are Measured once; a weak band is Unknown; never Likely or Measured", () => {
    for (const band of ["high", "medium"] as const) {
      expect(wordFromBench("estimate", band)).toBe("expected");
      expect(wordFromBench("real-play", band)).toBe("measuredOnce");
      expect(wordFromBench("measured", band)).toBe("measuredOnce");
    }
    for (const kind of ["estimate", "real-play", "measured"] as const)
      for (const band of ["low", "unknown", null, undefined] as const) expect(wordFromBench(kind, band)).toBe("unknown");
    for (const kind of ["estimate", "real-play", "measured"] as const)
      for (const band of ["high", "medium", "low", null] as const) expect(wordFromBench(kind, band)).not.toMatch(/^(likely|measured)$/);
  });

  it("maps provenance: a fact Compy read is Known, a third-party measurement is Measured, reasoning is Expected", () => {
    expect(wordFromProvenance("verified")).toBe("known");
    expect(wordFromProvenance("measured-signal")).toBe("measured");
    expect(wordFromProvenance("expected-impact")).toBe("expected");
  });

  it("the interview's finding level is already in the vocabulary", () => {
    expect(wordFromFinding("measured")).toBe("measured");
    expect(wordFromFinding("likely")).toBe("possible");
    expect(wordFromFinding("unknown")).toBe("unknown");
  });

  it("every word has a string in every locale, and no locale still ships a raw '{{level}} confidence' tag", () => {
    const locales = join("src", "i18n", "locales");
    // D3 slice 4 (e5b): every word is spelled by the shared vocabulary; the older common.confidenceWord.*
    // list is deleted. The key builder is total (review r1, F1) and every key it builds exists.
    const KEYS = {
      known: "common.source.read",
      measured: "common.source.measured",
      measuredOnce: "common.source.measuredOnce",
      possible: "common.strength.possible",
      likely: "common.strength.mostLikely",
      expected: "common.source.general",
      unknown: "common.notEnoughYet",
    } as const;
    for (const loc of ["en", "zh-CN"]) {
      const common = JSON.parse(readFileSync(join(locales, loc, "common.json"), "utf8")) as Record<string, unknown>;
      expect(common.confidenceWord, `${loc}: common.confidenceWord is retired`).toBeUndefined();
      for (const [w, key] of Object.entries(KEYS)) {
        expect(confidenceWordKey(w as keyof typeof KEYS)).toBe(key);
        expect(lookup(common, key.replace(/^common\./, "")), `${loc}: ${key}`).toBeTruthy();
      }
      for (const file of ["home.json", "optimize.json", "gaming.json", "blackbook.json"]) {
        const text = readFileSync(join(locales, loc, file), "utf8");
        expect(text, `${loc}/${file}`).not.toMatch(/\{\{level\}\}\s*confidence|confidence\s*[:：]?\s*\{\{level\}\}|"confidenceTag"|"confidenceSuffix"|"confidenceLabel"/);
      }
    }
  });
});

// D3 slice 4 (e5b): the strict retired-word scan (design `_train\d3-vocabulary-design.md` §2 "Words
// retired everywhere" and §5). Every value in every locale file fails on a retired word; the only
// exceptions are named below BY KEY, each with its reason. Do not add a key here to get green:
// reword the string instead, the way the design's §3 mapping says.
// Break check: put "Prime suspect: {{limiter}}. {{reason}}" back as any value in
// src/i18n/locales/en/monitor.json and the first test fails naming that key and the word.
const RETIRED: readonly RegExp[] = [
  /\bsignal\b/i,
  /suspect/i,
  /confidence/i,
  /\bproven\b|unproven/i,
  /probably/i,
  /^(Known|Likely|Expected|Unknown)$/,
  /信号/,
  /嫌疑/,
  /置信/,
  /^已知$/,
  /^较可能$/,
  /^预期$/,
  /^未知$/,
];
const ALLOWED: Readonly<Record<string, string>> = {
  "common.oscilloscope.noSignal": "the oscilloscope's literal 'no input' display, not a strength tag",
  "gaming.hardwareGrid.identityUnknown": "a hardware fact Compy has no value for (unavailable stays unknown), shown with its reason; not a certainty tag",
  "monitor.latency.jitterUnknown": "the value cell for a jitter figure that is not a number (zh 未知, en 'unknown'); not a certainty tag",
};
// e5b review r1 F5: the Welcome tagline and its "Measured" pill (home.compyHero.*) are the owner's
// (design §6 question 3) but hold no retired word, so they get no exception: the scan covers them.

const LOCALES = join("src", "i18n", "locales");
function localeValues(): { loc: string; key: string; value: string }[] {
  const out: { loc: string; key: string; value: string }[] = [];
  const walk = (node: unknown, path: string, loc: string) => {
    if (typeof node === "string") out.push({ loc, key: path, value: node });
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, loc);
  };
  for (const loc of readdirSync(LOCALES))
    for (const file of readdirSync(join(LOCALES, loc)).filter((f) => f.endsWith(".json")))
      walk(JSON.parse(readFileSync(join(LOCALES, loc, file), "utf8")), file.replace(/\.json$/, ""), loc);
  return out;
}

function tsxSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxSources(p));
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("retired-word scan (D3 slice 4, strict)", () => {
  it("no locale value uses a retired word, except the keys allowed by name", () => {
    const hits = localeValues()
      .filter(({ key }) => !(key in ALLOWED))
      .flatMap(({ loc, key, value }) => RETIRED.filter((r) => r.test(value)).map((r) => `${loc} ${key} ${String(r)}: ${value}`));
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("every allowed key exists and would fail without its exception, so the list cannot hold a stale one", () => {
    const values = localeValues();
    for (const [key, reason] of Object.entries(ALLOWED)) {
      const mine = values.filter((v) => v.key === key);
      expect(mine.length, `${key} is allowed but no locale has it`).toBeGreaterThan(0);
      // e5b review r1 F5: an exception for a value with no retired word only hides a later edit.
      expect(mine.some((v) => RETIRED.some((r) => r.test(v.value))), `${key} is allowed but holds no retired word`).toBe(true);
      expect(reason.length, key).toBeGreaterThan(0);
    }
  });

  // e5b review r1: three rewordings pinned in both locales, so a revert or a stronger word fails here.
  it("the benchmark's interval says it is for the median change, not a spread of results (F2)", () => {
    const g = (loc: string) => JSON.parse(readFileSync(join(LOCALES, loc, "gaming.json"), "utf8")) as Record<string, unknown>;
    expect(lookup(g("en"), "benchmark.ciLabel")).toBe("95% interval for the median change");
    expect(lookup(g("zh-CN"), "benchmark.ciLabel")).toBe("中位数变化的 95% 区间");
    expect(lookup(g("en"), "benchmark.pointsTraceNote")).toMatch(/95% interval for its median change/);
    expect(lookup(g("zh-CN"), "benchmark.pointsTraceNote")).toMatch(/中位数变化的 95% 区间/);
    for (const loc of ["en", "zh-CN"]) expect(String(lookup(g(loc), "benchmark.ciLabel")), loc).not.toMatch(/range|范围/i);
  });

  it("the Test room's win tile never says a change was kept: every counted win was put back (F1)", () => {
    const l = (loc: string) => JSON.parse(readFileSync(join(LOCALES, loc, "lab.json"), "utf8")) as Record<string, unknown>;
    expect([lookup(l("en"), "labConsole.provenLabel"), lookup(l("en"), "labConsole.provenNoteSome"), lookup(l("en"), "labConsole.provenNoteNone")]).toEqual([
      "Measured wins",
      "measured before and after, then put back",
      "no measured wins yet",
    ]);
    expect([lookup(l("zh-CN"), "labConsole.provenLabel"), lookup(l("zh-CN"), "labConsole.provenNoteSome"), lookup(l("zh-CN"), "labConsole.provenNoteNone")]).toEqual([
      "实测提升",
      "前后都实测过，随后已还原",
      "还没有实测提升",
    ]);
  });

  it("the simulator's low-impact verdict says only what it knows: weak support, not a test history (F4)", () => {
    const l = (loc: string) => JSON.parse(readFileSync(join(LOCALES, loc, "lab.json"), "utf8")) as Record<string, unknown>;
    expect(lookup(l("en"), "experimentBench.simVerdict.plausibleUnproven")).toBe("Might help — weak support");
    expect(lookup(l("zh-CN"), "experimentBench.simVerdict.plausibleUnproven")).toBe("可能有帮助——依据较弱");
    for (const loc of ["en", "zh-CN"])
      expect(String(lookup(l(loc), "experimentBench.simVerdict.plausibleUnproven")), loc).not.toMatch(/tested|测试/);
  });

  it("the scan itself fails on a retired word (e.g. a put-back 'Prime suspect')", () => {
    for (const v of ["Prime suspect: {{limiter}}", "Weak signal", "High confidence", "Proven", "Known", "嫌疑", "置信度", "未知"])
      expect(RETIRED.some((r) => r.test(v)), v).toBe(true);
    for (const v of ["Possible", "Most likely", "Read from your PC", "Unknown game", "Not shown to be the cause"])
      expect(RETIRED.some((r) => r.test(v)), v).toBe(false);
  });

  it("no hard-coded 'confidence' in JSX text in src/**/*.tsx (catches FirstCheck-style English bands)", () => {
    const hits: string[] = [];
    for (const file of tsxSources("src")) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      for (const m of code.matchAll(/>([^<>{}]*)</g)) if (/\bconfidence\b/i.test(m[1])) hits.push(`${file}: ${m[1].trim()}`);
      // A string literal placed straight into JSX ({"High confidence"}); `${…}` holes are code, not text.
      for (const m of code.matchAll(/\{\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1\s*\}/g))
        if (/\bconfidence\b/i.test(m[2].replace(/\$\{[^}]*\}/g, ""))) hits.push(`${file}: ${m[2]}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
