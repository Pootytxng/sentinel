// bug→guard for the 2026-10-28 visual self-review (installed build a33ff51c). Each case fails on the
// code that shipped those defects:
//  - P7-confidence: a confidence word carried a native `title` tooltip (rubric 12, #677), and the Test
//    bench printed "confidence: medium" instead of the shared vocabulary;
//  - P7-jargon: engine sentences reached the screen with a bare "1% lows" / "noise floor";
//  - P7-rig-care: the Lab rig note had no backing, so the floor grid cut through its glyphs;
//  - P7-depth: the Care receipt's "Step id" row repeated the whole step.
import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Term } from "./Term";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ConfidenceWord } from "./ConfidenceWord";
import { withTerms } from "./with-terms";

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("self-review 2026-10-28 guards", () => {
  it("a confidence word shows its hint in the in-app tooltip, never a native title", () => {
    const { container } = render(<ConfidenceWord band="high" />);
    expect(container.textContent).toBe("Likely");
    expect(container.querySelector("[title]")).toBeNull();
    expect(container.querySelector("button.kl-term")).not.toBeNull();
    expect(container.querySelector("[data-confidence]")!.getAttribute("data-confidence")).toBe("high");
    const offenders = sources("src").filter((p) => /title=\{t\(confidenceHintKey/.test(readFileSync(p, "utf8")));
    expect(offenders, "a confidence chip is back on a native title tooltip").toEqual([]);
  });

  it("the Test bench speaks the shared confidence vocabulary", () => {
    for (const loc of ["en", "zh-CN"]) {
      const lab = readFileSync(join("src", "i18n", "locales", loc, "lab.json"), "utf8");
      expect(lab, `${loc}: "confidence: …" is back`).not.toMatch(/"confidence: /);
      expect(JSON.parse(lab).experimentBench.confidence, `${loc}: the raw band copy is back`).toBeUndefined();
    }
    const bench = readFileSync(join("src", "surfaces", "ExperimentBench.tsx"), "utf8");
    // r2: BenchWord replaced confidenceCopy (same words, now glossed); see the r2 case below.
    expect(bench).toContain('<BenchWord c={sim.confidence} kind="estimate" />');
    expect(bench).toContain('<BenchWord c={r.confidence ?? "unknown"} kind="measured" />');
  });

  it("engine sentences gloss the terms inside them and keep every other word as given", () => {
    const text = "WardogsClient: 1% lows fell 15.5% against a noise floor of ±3%; the 1% low held.";
    const { container } = render(<p>{withTerms(text)}</p>);
    expect(container.textContent).toBe(text);
    const terms = [...container.querySelectorAll("button.kl-term")].map((b) => b.textContent);
    expect(terms).toEqual(["1% lows", "noise floor", "1% low"]);
    expect(withTerms("Nothing to gloss here.")).toBe("Nothing to gloss here.");
    const home = readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8");
    expect(home).toContain("{withTerms(intelHeadline.text)}");
    expect(home).toContain("{withTerms(topLimiter.title)}");
    const wcp = readFileSync(join("src", "surfaces", "WhatChangedPanel.tsx"), "utf8");
    expect(wcp).toContain('<h3 className="wcp-headline">{withTerms(r.headline)}</h3>');
    expect(wcp).toMatch(/<Term id="noise-floor">\{t\("optimize\.whatChangedPanel\.noiseFloor"/);
  });

  it("the Lab rig note sits under the stage, not on its floor", () => {
    const css = readFileSync(join("src", "surfaces", "lab-console.css"), "utf8");
    const rule = css.slice(css.indexOf('.lc-rig-note {'), css.indexOf("}", css.indexOf('.lc-rig-note {')));
    // r2: the note sits under the stage, in flow, never overlaid on the floor grid or ring.
    expect(rule).not.toMatch(/position:\s*absolute/);
    const lab = readFileSync(join("src", "surfaces", "LabConsole.tsx"), "utf8");
    expect(lab).not.toMatch(/\{careRigNote\}\s*<ReticleCursor/);
    expect(lab.match(/<ReticleCursor scopeRef=\{stageRef\} \/>\s*<\/div>\s*(\{\/\*[^]*?\*\/\}\s*)?\{careRigNote\}/g)?.length).toBe(2);
  });

  it("r2: a tooltip that would spill past the right edge flips to end-anchored", () => {
    // bug→guard r2: the Black Book "Likely" and the noise-floor tooltips were cut off at the right
    // edge and added a horizontal scrollbar.
    const orig = HTMLElement.prototype.getBoundingClientRect;
    const width = window.innerWidth;
    HTMLElement.prototype.getBoundingClientRect = function () {
      const r = this.classList.contains("kl-tip") && !this.classList.contains("kl-tip-end") ? width + 40 : 100;
      return { right: r, left: r - 100, top: 0, bottom: 10, width: 100, height: 10, x: r - 100, y: 0, toJSON() {} } as DOMRect;
    };
    try {
      const { container } = render(<Term tip="A sentence">near the edge</Term>);
      fireEvent.click(container.querySelector("button.kl-term")!);
      expect(container.querySelector(".kl-tip")!.classList.contains("kl-tip-end")).toBe(true);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = orig;
    }
    const fits = render(<Term tip="A sentence">in the middle</Term>);
    fireEvent.click(fits.container.querySelector("button.kl-term")!);
    expect(fits.container.querySelector(".kl-tip")!.classList.contains("kl-tip-end")).toBe(false);
  });

  it("r2: the remaining bare confidence words and engine jargon carry their gloss", () => {
    const read = (...p: string[]) => readFileSync(join("src", ...p), "utf8");
    // the interview's level chip ("MEASURED") is the shared vocabulary → the shared hint
    expect(read("surfaces", "HomeInterview.tsx")).toMatch(
      /<Term tip=\{t\(confidenceHintKey\(wordFromFinding\(finding\.level\)\)\)\}>\{finding\.levelLabel\}<\/Term>/,
    );
    // the bench's "· Unknown" / "· Measured" / "Expected": every confidence word goes through BenchWord
    const bench = read("surfaces", "ExperimentBench.tsx");
    expect(bench).toMatch(/<Term tip=\{t\(confidenceHintKey\(word\)\)\}>\{t\(confidenceWordKey\(word\)\)\}<\/Term>/);
    expect(bench).not.toContain("confidenceCopy");
    expect(bench.match(/<BenchWord /g)?.length).toBe(3);
    // pattern sentences and the bench's noise fine print say "1% low" / "noise floor"
    const patterns = read("surfaces", "blackbook", "PatternsTile.tsx");
    expect(patterns).toContain("{withTerms(p.detail)}");
    expect(patterns).toContain("{withTerms(p.title)}");
    expect(read("surfaces", "ExperimentBench.tsx")).toMatch(/data-testid="exp-summary-noise">\s*\{withTerms\(/);
  });

  it("the Care receipt no longer repeats the step as its id", () => {
    const care = readFileSync(join("src", "surfaces", "CareNextStep.tsx"), "utf8");
    expect(care).not.toContain('rk("stepKey")');
  });
});
