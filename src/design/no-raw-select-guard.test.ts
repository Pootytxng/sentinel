import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// NO RAW `<select>` — conformance C-10 (design audit §4), mechanized.
//
// THE DEFECT, stated precisely so nobody re-litigates it as a style preference: a native
// `<select>`'s popup list is rendered by the operating system, NOT by the page. It takes no CSS
// from us at all — not the font, not the size, not the background. On Compy's near-black rooms it
// opens as a light-grey Windows menu in a system font, which tells the user in the most literal way
// available that they have left the application. That is the standing tester complaint ("completely
// unfamiliar") arriving through a control we chose.
//
// It is not fixable with CSS on the closed control. `appearance: none` restyles the box the user
// clicks and does nothing whatsoever to the menu that opens — which is the part they read. The only
// fix is to not use the element: `src/design/Picker.tsx` draws its own listbox, from the same
// tokens as everything else, with full keyboard and AT parity.
//
// WHY A GUARD AND NOT A CLEANUP. The audit filed this in the first place because raw `<select>`s
// arrived ONE SURFACE AT A TIME over months — nobody ever decided to use them, each was locally the
// obvious thing to type. A one-off cleanup would be undone the same way. So: the build fails.
//
// NO ESCAPE HATCH, deliberately. Sibling guards in this repo carry a greppable line-level allow
// (`side-stripe-allow`, `mutation-boundary-allow`) because they police idioms with genuine
// exceptions — a CSS triangle really is a thick side border. There is no such exception here: there
// is no case where the OS menu is the right answer inside this app, and a hatch on a guard whose
// whole subject is "this crept back in gradually" is the crack it creeps back through. If a real
// need ever appears, deleting this file is a reviewable commit; adding `// select-allow` to a line
// is not.

const ROOT = "src";

/** Every .tsx under src/, minus tests — a test may legitimately assert about a `<select>` (this
 *  file does, and so does any regression test written the day one comes back). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    if (!p.endsWith(".tsx") && !p.endsWith(".ts")) return [];
    if (/\.test\.tsx?$/.test(p)) return [];
    return [p];
  });
}

/** JSX `<select>` / `<select ...>` and `React.createElement("select", ...)`. Built from RegExp
 *  literals' own `.source` rather than a hand-escaped string: a sibling guard reported green over
 *  nine live violations because a heredoc ate one backslash level on the way in (2026-08-18). */
const JSX_SELECT = new RegExp([/<select(?=[\s/>])/.source].join("|"), "g");
const CREATE_ELEMENT_SELECT = new RegExp(
  [/createElement\(\s*["']select["']/.source].join("|"),
  "g",
);

function violations(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const file of sourceFiles(ROOT)) {
    // Strip comments so a `<select>` NAMED in prose (this file's own header, Picker.tsx's) is not a
    // violation. The law is about what renders, not about what we are allowed to say.
    const raw = readFileSync(file, "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    src.split(String.fromCharCode(10)).forEach((line, i) => {
      JSX_SELECT.lastIndex = 0;
      CREATE_ELEMENT_SELECT.lastIndex = 0;
      if (JSX_SELECT.test(line) || CREATE_ELEMENT_SELECT.test(line)) {
        out.push({ file, line: i + 1, text: line.trim() });
      }
    });
  }
  return out;
}

describe("no raw OS <select> inside the custom UI (C-10)", () => {
  it("finds no `<select>` in any shipped surface", () => {
    const found = violations();
    expect(
      found.map((v) => `${v.file}:${v.line}  ${v.text}`),
      "A native <select> opens an OS-drawn menu that takes none of our tokens — use " +
        "`src/design/Picker.tsx` instead. See this file's header for why there is no escape hatch.",
    ).toEqual([]);
  });

  // A guard that only ever passes is not evidence that it works (the mutation-testing law, applied
  // to the guard itself). These prove the matcher actually fires on the shapes it claims to catch.
  it("its matcher fires on the shapes it claims to catch", () => {
    const cases = [
      `<select className="x">`,
      `<select>`,
      `<select`.concat(String.fromCharCode(10)), // attributes wrapped onto following lines
      `React.createElement("select", null)`,
      `createElement('select', {})`,
    ];
    for (const c of cases) {
      JSX_SELECT.lastIndex = 0;
      CREATE_ELEMENT_SELECT.lastIndex = 0;
      expect(JSX_SELECT.test(c) || CREATE_ELEMENT_SELECT.test(c), c).toBe(true);
    }
  });

  it("does not fire on words that merely contain 'select'", () => {
    const cases = [
      `<selection>`,
      `const selected = options.find(...)`,
      `<SelectableRow />`,
      `aria-selected="true"`,
      `document.querySelectorAll("select")`,
    ];
    for (const c of cases) {
      JSX_SELECT.lastIndex = 0;
      CREATE_ELEMENT_SELECT.lastIndex = 0;
      expect(JSX_SELECT.test(c) || CREATE_ELEMENT_SELECT.test(c), c).toBe(false);
    }
  });

  it("the replacement it points at actually exists", () => {
    const picker = readFileSync(join("src", "design", "Picker.tsx"), "utf8");
    expect(picker).toContain('role="listbox"');
    expect(picker).toContain('role="combobox"');
  });
});
