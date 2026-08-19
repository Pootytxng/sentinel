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

// WHAT IT DOES NOT SEE (independent review, 2026-08-18): the scan is literal, so a dynamic tag
// (`const El = "select"; <El />`) or a concatenated `createElement("sel" + "ect")` walks past it.
// Neither is a plausible accident - this guard exists to stop the element being TYPED by habit, and
// nobody reaches for a computed tag name by habit - but a deliberate route around a guard should be
// documented rather than discovered, so it is written here instead of assumed absent.

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
const JSX_SELECT = new RegExp([/<select(?=[\s/>]|$)/.source].join("|"), "g");
// `|$` is load-bearing, and it is the bug an independent review caught on 2026-08-18: the scan
// runs line by line, so a Prettier-wrapped opening tag whose line ENDS at `<select` had no next
// character left for the lookahead to see, and walked straight past the guard. The original
// mutation test missed it because it fed the matcher a string that still carried its newline —
// a code path `violations()` never takes. Both are fixed: one scanner, fed the same way by both.
const CREATE_ELEMENT_SELECT = new RegExp(
  [/createElement\(\s*["']select["']/.source].join("|"),
  "g",
);

/** The ONE scanner. Both the repo sweep and the mutation tests below go through this, so a test
 *  can never prove a code path the real sweep does not run. */
function scanSource(raw: string): { line: number; text: string }[] {
  // Strip comments so a `<select>` NAMED in prose (this file's own header, Picker.tsx's) is not a
  // violation. The law is about what renders, not about what we are allowed to say.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: { line: number; text: string }[] = [];
  src.split(String.fromCharCode(10)).forEach((line, i) => {
    JSX_SELECT.lastIndex = 0;
    CREATE_ELEMENT_SELECT.lastIndex = 0;
    if (JSX_SELECT.test(line) || CREATE_ELEMENT_SELECT.test(line)) {
      out.push({ line: i + 1, text: line.trim() });
    }
  });
  return out;
}

function violations(): { file: string; line: number; text: string }[] {
  return sourceFiles(ROOT).flatMap((file) =>
    scanSource(readFileSync(file, "utf8")).map((hit) => ({ file, ...hit })),
  );
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
    const nl = String.fromCharCode(10);
    const cases = [
      `<select className="x">`,
      `<select>`,
      // Prettier's output for a long opening tag: the line ENDS at the tag name. This is the shape
      // that used to escape, so it is fed in exactly as a file would carry it — as source with
      // newlines, scanned by the same function that sweeps the repo.
      [`<select`, `  className="x"`, `>`].join(nl),
      [`  <select`, `    value={v}`, `  >`].join(nl),
      `React.createElement("select", null)`,
      `createElement('select', {})`,
    ];
    for (const c of cases) {
      expect(scanSource(c).length, c).toBeGreaterThan(0);
    }
  });

  it("does not fire on words that merely contain 'select'", () => {
    const cases = [
      `<selection>`,
      `const selected = options.find(...)`,
      `<SelectableRow />`,
      `aria-selected="true"`,
      `document.querySelectorAll("select")`,
      // The near-miss of the `|$` fix: a line that ends mid-word is still not a tag.
      `const kind = pickerSelect`,
    ];
    for (const c of cases) {
      expect(scanSource(c), c).toEqual([]);
    }
  });

  it("the replacement it points at actually exists", () => {
    const picker = readFileSync(join("src", "design", "Picker.tsx"), "utf8");
    expect(picker).toContain('role="listbox"');
    expect(picker).toContain('role="combobox"');
  });
});
