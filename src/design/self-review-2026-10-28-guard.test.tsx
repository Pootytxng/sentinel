// bug→guard for the 2026-10-28 visual self-review (installed build a33ff51c). Each case fails on the
// code that shipped those defects:
//  - P7-confidence: a confidence word carried a native `title` tooltip (rubric 12, #677), and the Test
//    bench printed "confidence: medium" instead of the shared vocabulary;
//  - P7-jargon: engine sentences reached the screen with a bare "1% lows" / "noise floor";
//  - P7-rig-care: the Lab rig note had no backing, so the floor grid cut through its glyphs;
//  - P7-depth: the Care receipt's "Step id" row repeated the whole step.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
    expect(bench).toContain('confidenceCopy(t, "estimate")[sim.confidence]');
    expect(bench).toContain('const conf = confidenceCopy(t, "measured");');
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

  it("the Lab rig note sits on a solid backing", () => {
    const css = readFileSync(join("src", "surfaces", "lab-console.css"), "utf8");
    const rule = css.slice(css.indexOf('.lc-rig-note {'), css.indexOf("}", css.indexOf('.lc-rig-note {')));
    expect(rule).toMatch(/background:\s*var\(--v2-bg\)/);
  });

  it("the Care receipt no longer repeats the step as its id", () => {
    const care = readFileSync(join("src", "surfaces", "CareNextStep.tsx"), "utf8");
    expect(care).not.toContain('rk("stepKey")');
  });
});
