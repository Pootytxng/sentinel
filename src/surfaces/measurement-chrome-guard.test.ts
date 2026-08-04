// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { COMPARABILITY_TONE, SIMULATION_TONE, simulationTone } from "./measurement-chrome";

// Guards for the shared measurement chrome — the vocabulary Monitor's "What changed?" debrief and
// the Lab's experiment bench now both wear. It exists because the two rooms grew the SAME two
// pieces of chrome independently (an uppercase eyebrow, a colour-carrying verdict word) and drifted
// on every number that had no reason to differ. Convergence only holds if the drift can't restart,
// so each way it could restart is an assertion here (bug→guard tier 1):
//
//   1. Typography is declared exactly once — in measurement-chrome.css. No room re-forks the size,
//      family or weight; a room may only position the element.
//   2. Type floors (Direction D): mono/eyebrow >= 12px, the verdict word >= 13px. The shipped
//      surfaces were BELOW both (10.5px and 11.5px) — this is what stops a quiet shrink back.
//   3. The --mc-* palette is declared SAME-ELEMENT on each room root and nowhere else — above all
//      never at :root. This mechanizes the CSS law that cost two self-review rounds on the
//      per-room accents train: a var() chain inside a custom property substitutes using the scope
//      at its DECLARING element, so a :root-level --mc-good cannot follow a per-room override.
//   4. Every tone has a colour rule, and every room declares every variable those rules read.
//   5. The retired class names do not come back.
//   6. The tone maps are TOTAL over their domains — every Comparability member and all seven of
//      experiment.rs's simulator verdicts are named, so nothing lands in a bucket by accident.

const SRC = "src";
const CHROME_CSS_PATH = join(SRC, "surfaces", "measurement-chrome.css");

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

const ALL_CSS = cssFiles(SRC);
const chromeCss = stripComments(readFileSync(CHROME_CSS_PATH, "utf8"));

/** Every `selector { body }` pair in a stylesheet. Nested at-rules yield their inner rules. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/** The body of the rule whose selector is EXACTLY `selector` (not `.wcp-no-change` for `.wcp`). */
function exactRule(css: string, selector: string): string | null {
  const hit = rules(css).find((r) => r.selector === selector);
  return hit ? hit.body : null;
}

const px = (body: string, prop: string): number | null => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)px`));
  return m ? Number(m[1]) : null;
};

const MC_VARS = [
  "--mc-mono",
  "--mc-ink",
  "--mc-eyebrow-ink",
  "--mc-good",
  "--mc-caution",
  "--mc-bad",
  "--mc-neutral",
] as const;

// The two rooms that report a verdict, and the file each declares its palette in.
const ROOMS: { selector: string; file: string }[] = [
  { selector: ".wcp", file: join(SRC, "App.css") },
  { selector: ".exp-bench", file: join(SRC, "surfaces", "ExperimentBench.css") },
];

describe("measurement chrome — typography lives exactly once", () => {
  it("declares the eyebrow and the verdict word only in measurement-chrome.css", () => {
    const offenders: string[] = [];
    let hostRules = 0;
    for (const file of ALL_CSS) {
      if (file === CHROME_CSS_PATH) continue;
      for (const { selector, body } of rules(stripComments(readFileSync(file, "utf8")))) {
        if (!/\.mc-eyebrow|\.mc-verdict/.test(selector)) continue;
        hostRules++;
        // A host may POSITION the shared element (display/margin). It may not re-type it.
        const typed = body.match(/(?:^|;)\s*(font-size|font-family|font-weight|letter-spacing|text-transform)\s*:/g);
        if (typed) offenders.push(`${file} — ${selector} sets ${typed.join(" ").trim()}`);
      }
    }
    // Positive control — both rooms position the shared eyebrow (.wcp-next inline, .exp-history
    // spacing). If this drops to 0 the scan has gone blind and the emptiness above means nothing.
    expect(hostRules, "the host-override scan matched nothing — this guard has gone vacuous").toBeGreaterThanOrEqual(2);
    expect(offenders).toEqual([]);
  });

  it("holds Direction D's type floors — eyebrow >= 12px, verdict >= 13px", () => {
    const eyebrow = exactRule(chromeCss, ".mc-eyebrow");
    const verdict = exactRule(chromeCss, ".mc-verdict");
    expect(eyebrow, ".mc-eyebrow rule missing").not.toBeNull();
    expect(verdict, ".mc-verdict rule missing").not.toBeNull();
    // The pre-convergence sizes were 10.5px (Monitor) and 11.5px (Lab) — both below the floor.
    expect(px(eyebrow!, "font-size")).toBeGreaterThanOrEqual(12);
    expect(px(verdict!, "font-size")).toBeGreaterThanOrEqual(13);
  });

  it("gives every tone its own colour rule", () => {
    for (const tone of ["good", "caution", "bad", "neutral"]) {
      expect(chromeCss, `no colour rule for tone "${tone}"`).toContain(
        `.mc-verdict[data-tone="${tone}"]`,
      );
    }
  });

  it("names no palette token of its own — colour comes only from --mc-*", () => {
    // The whole reason one vocabulary can live in two token families (--* and --ix-*).
    const foreignTokens = chromeCss.match(/var\(\s*--(?!mc-)[a-z0-9-]+/g) ?? [];
    expect(foreignTokens).toEqual([]);
  });
});

describe("measurement chrome — the palette is scope-local, never hoisted", () => {
  it("declares every --mc-* variable same-element on each room root", () => {
    for (const { selector, file } of ROOMS) {
      const body = exactRule(stripComments(readFileSync(file, "utf8")), selector);
      expect(body, `${file} has no exact "${selector}" rule to declare the palette on`).not.toBeNull();
      for (const v of MC_VARS) {
        expect(body, `${selector} in ${file} is missing ${v}`).toMatch(
          new RegExp(`(?:^|;)\\s*${v}\\s*:`),
        );
      }
    }
  });

  it("declares --mc-* on the room roots and NOWHERE else — above all not at :root", () => {
    // The law that cost two self-review rounds on the per-room accents train: a var() chain inside
    // a custom property substitutes using the scope at its DECLARING element. A :root-level
    // --mc-good would freeze on :root's tokens and could never follow a room's override.
    const allowed = new Set(ROOMS.map((r) => r.selector));
    const offenders: string[] = [];
    const declaring = new Set<string>();
    for (const file of ALL_CSS) {
      for (const { selector, body } of rules(stripComments(readFileSync(file, "utf8")))) {
        if (!/(?:^|;)\s*--mc-[a-z-]+\s*:/.test(body)) continue;
        declaring.add(selector);
        if (!allowed.has(selector)) offenders.push(`${file} — ${selector}`);
      }
    }
    // Positive control: the scan must have FOUND both room blocks. Without this the assertion
    // below would pass just as happily on a tree where nobody declares the palette at all.
    expect([...declaring].sort()).toEqual([...allowed].sort());
    expect(offenders).toEqual([]);
  });
});

describe("measurement chrome — the forked chrome does not come back", () => {
  it("keeps the retired per-room class names out of the tree", () => {
    const retired = ["wcp-section-label", "wcp-compare-band", "exp-sim-verdict", "exp-history-label"];
    const offenders: string[] = [];
    const scanned: string[] = [];
    for (const file of [...ALL_CSS, ...tsFiles(SRC)]) {
      // This guard names them itself; only OTHER files count.
      if (file.endsWith("measurement-chrome-guard.test.ts")) continue;
      scanned.push(file);
      const text = readFileSync(file, "utf8");
      for (const name of retired) {
        if (text.includes(name)) offenders.push(`${file} — ${name}`);
      }
    }
    // Positive control — the two rewired surfaces must be IN the swept set, or "no offenders"
    // is just a statement about an empty scan.
    expect(scanned).toContain(join(SRC, "App.css"));
    expect(scanned).toContain(join(SRC, "surfaces", "ExperimentBench.tsx"));
    expect(offenders).toEqual([]);
  });
});

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("measurement chrome — the tone maps are total", () => {
  it("maps every Comparability member", () => {
    const types = readFileSync(join(SRC, "types.ts"), "utf8");
    const decl = types.match(/export type Comparability\s*=([^;]+);/);
    expect(decl, "Comparability union not found in src/types.ts").not.toBeNull();
    const members = [...decl![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(members.length).toBeGreaterThan(0);
    expect(Object.keys(COMPARABILITY_TONE).sort()).toEqual([...members].sort());
  });

  it("maps all seven simulator verdicts from experiment.rs", () => {
    // Read the source of truth rather than restating it: the doc comment on SimulatorReport::verdict
    // enumerates them, so a verdict added there without a tone fails here instead of silently
    // falling back to neutral in the UI.
    const rs = readFileSync(join("src-tauri", "src", "experiment.rs"), "utf8");
    const doc = rs.match(/\/\/\/ One of:([\s\S]*?)\n\s*pub verdict: String,/);
    expect(doc, "the verdict enumeration comment moved — re-anchor this guard").not.toBeNull();
    const verdicts = [...doc![1].matchAll(/([a-z]+(?:-[a-z]+)+)/g)].map((m) => m[1]);
    expect(verdicts.length).toBe(7);
    for (const v of verdicts) {
      expect(SIMULATION_TONE[v], `simulator verdict "${v}" has no tone`).toBeDefined();
    }
  });

  it("keeps the semantic correspondence the two rooms never wrote down", () => {
    // comparable ≡ worth-testing (go) · partial ≡ plausible-unproven (limits) ·
    // not-comparable ≡ risk-exceeds-value (don't). This IS the deliverable — the pixel numbers
    // were only the symptom.
    expect(COMPARABILITY_TONE.comparable).toBe(simulationTone("worth-testing"));
    expect(COMPARABILITY_TONE.partial).toBe(simulationTone("plausible-unproven"));
    expect(COMPARABILITY_TONE["not-comparable"]).toBe(simulationTone("risk-exceeds-value"));
    expect(COMPARABILITY_TONE.unknown).toBe("neutral");
  });

  it("falls back to neutral rather than borrowing a colour", () => {
    expect(simulationTone("a-verdict-invented-tomorrow")).toBe("neutral");
  });
});
