import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// bug -> guard (#501, 2026-09-21). Self-review rubric item 5 fails any scroll-container panel whose
// scrollHeight exceeds clientHeight at 1280x720 / 1500x980 / 1920x1080. `.hc-stage-cards` is pinned
// by src/surfaces/home-console.test.tsx as a DESIGNED scroll viewport inside the approved comp's
// fixed 530px stage (261px floor at 720p), so it can never satisfy zero surplus -- PR #500's review
// failed item 5 on that pre-existing baseline and the rubric and the pin contradicted each other.
// The rubric now measures a designed viewport by its LEAD (what must be visible without scrolling)
// and its REACH, but ONLY for a panel a repo test pins by name. This guard keeps that exception list
// mechanical in both directions -- every selector the rubric names has a pin, every pin is named --
// so the exception grows by a test, never by prose and never per PR. The Codex mirror of the rubric
// must carry the same list, or the two reviewers would hold a panel to different bars.

const RUBRIC = join(".claude", "agents", "self-reviewer.md");
const MIRROR = join(".codex", "agents", "self-reviewer.toml");
const PIN_PHRASE = "scroll viewport";

type Pin = { selector: string; file: string };

/** `Pinned today: \`.sel\` by \`path\`, ...` -> the pairs, in order. */
function pinnedList(text: string, where: string): Pin[] {
  const idx = text.indexOf("Pinned today:");
  expect(idx, `${where} must carry a "Pinned today:" list under rubric item 5`).toBeGreaterThan(-1);
  const slice = text.slice(idx, idx + 400);
  // `by` may be followed by a wrapped line: the rubric is prose at 100 columns.
  const pins = Array.from(slice.matchAll(/`([^`]+)` by\s+`([^`]+)`/g)).map((m) => ({
    selector: m[1],
    file: m[2].replace(/\\/g, "/"),
  }));
  expect(pins.length, `${where}: the "Pinned today:" list parsed to nothing`).toBeGreaterThan(0);
  return pins;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.test\.tsx?$/.test(name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/** Every double-quoted it()/test() title in a file that carries the pin phrase, with the selectors it names. */
function pinTitles(file: string): Array<{ title: string; selectors: string[] }> {
  const src = readFileSync(file, "utf8");
  const out: Array<{ title: string; selectors: string[] }> = [];
  for (const m of src.matchAll(/\b(?:it|test)\(\s*"([^"]*)"/g)) {
    const title = m[1];
    if (!title.toLowerCase().includes(PIN_PHRASE)) continue;
    const selectors = Array.from(title.matchAll(/(?:^|\s)(\.[a-zA-Z][\w-]*)/g)).map((s) => s[1]);
    out.push({ title, selectors });
  }
  return out;
}

const rubric = readFileSync(RUBRIC, "utf8");
const rubricPins = pinnedList(rubric, RUBRIC);

describe("self-review rubric item 5: the designed-scroll-viewport list is mechanical (#501)", () => {
  it("every viewport the rubric names is pinned by name in the test it cites", () => {
    for (const { selector, file } of rubricPins) {
      expect(() => statSync(file), `${RUBRIC} cites ${file} for ${selector}, and that test file does not exist`).not.toThrow();
      const titles = pinTitles(file);
      expect(
        titles.some((t) => t.selectors.includes(selector)),
        `${file} has no it() title that names ${selector} together with "${PIN_PHRASE}" -- the rubric may not exempt a panel no test pins`,
      ).toBe(true);
    }
  });

  it("every pin in the test tree is named by the rubric -- the list grows by a test, never by prose", () => {
    const seen: Pin[] = [];
    for (const file of walk("src")) {
      for (const { title, selectors } of pinTitles(file)) {
        expect(
          selectors.length,
          `${file}: "${title}" pins a scroll viewport without naming its selector (a .class token in the title)`,
        ).toBeGreaterThan(0);
        for (const selector of selectors) seen.push({ selector, file });
      }
    }
    expect(seen.length, "no test in src/ pins a scroll viewport any more -- retire the rule or restore the pin").toBeGreaterThan(0);
    for (const pin of seen) {
      expect(
        rubricPins.some((r) => r.selector === pin.selector && r.file === pin.file),
        `${pin.file} pins ${pin.selector} as a scroll viewport, but ${RUBRIC} item 5 does not list "\`${pin.selector}\` by \`${pin.file}\`" -- add it to "Pinned today:" (and the Codex mirror)`,
      ).toBe(true);
    }
  });

  it("the Codex mirror carries the same list, so both reviewers hold a panel to the same bar", () => {
    const mirror = pinnedList(readFileSync(MIRROR, "utf8"), MIRROR);
    const key = (p: Pin) => `${p.selector} by ${p.file}`;
    expect(mirror.map(key).sort()).toEqual(rubricPins.map(key).sort());
  });

  it("the rule itself still states what a pinned viewport is measured by: its LEAD and its REACH", () => {
    const start = rubric.indexOf("Designed scroll viewports");
    const end = rubric.indexOf("Bento tile hygiene", start);
    expect(start, "item 5 lost its designed-scroll-viewport paragraph").toBeGreaterThan(-1);
    expect(end, "the paragraph must sit inside item 5, before the Bento tile hygiene rule").toBeGreaterThan(start);
    const rule = rubric.slice(start, end);
    for (const word of ["LEAD", "REACH", "scrollTop", ".card-label", ".card-value", "clientHeight"]) {
      expect(rule, `the designed-viewport rule no longer names ${word}; a pin without a measurable bar is a blanket exemption`).toContain(word);
    }
  });
});
