import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same disk-read pattern as border-hygiene-guard:
//  these are CSS-text invariants, not runtime behavior, so we grep the source.)

const cssFiles = (): string[] =>
  (readdirSync("src", { recursive: true }) as string[]).filter((f) => f.endsWith(".css"));

// Comment text mentions selectors by name (that's how the guards are documented) — blank out
// /* … */ bodies before parsing, preserving newlines so offender line numbers stay true.
const readCssStripped = (rel: string): string =>
  readFileSync(join("src", rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );

// Guard 1 — the overlay window must never inherit a document-level ambient wash
// (bug → guard, owner defect 2026-07-15: the App.css body::before aurora painted a faint
// full-window backdrop over fullscreen games; main.tsx applies every skin attribute to
// documentElement BEFORE branching on the overlay window label, so ANY pseudo layer hung on
// html/:root/body/#root paints in the overlay too — `background: transparent` can't stop a
// ::before/::after child).
//
// Two halves keep the class closed:
//  (a) Overlay.css must carry the blanket kill rule — content: none !important on all six
//      document-level pseudo slots (html/body/#root × ::before/::after) under .overlay-mode.
//  (b) no document-level pseudo layer may declare `content … !important`. The kill rule wins
//      today because its `!important` beats the skins' plain `content:` declarations; an
//      !important content on e.g. `:root[data-itheme=…]::after` (specificity 0,2,0) would
//      out-cascade the kill (0,1,1) and paint over the game again. The overlay document only
//      ever contains html/body/#root + .ovl chrome, so these subjects are the whole risk class.
describe("overlay ambient guard: document-level pseudo layers never paint in the overlay window", () => {
  const overlayCss = readFileSync(join("src", "Overlay.css"), "utf8");

  it("Overlay.css blanket-kills all six document-level pseudo slots", () => {
    for (const host of ["html.overlay-mode", "html.overlay-mode body", "html.overlay-mode #root"]) {
      for (const pseudo of ["::before", "::after"]) {
        expect(overlayCss).toContain(`${host}${pseudo}`);
      }
    }
    // The kill itself: content: none, important (skin CSS uses !important washes too).
    const killBlock = overlayCss.slice(overlayCss.indexOf("html.overlay-mode::before"));
    expect(killBlock).toMatch(/content:\s*none\s*!important/);
  });

  it("no document-level pseudo layer declares content !important (would out-cascade the kill)", () => {
    // Is this selector fragment a document-level pseudo layer (subject = html/:root/body/#root
    // with ::before/::after), excluding the kill rule itself?
    const isDocLevelPseudo = (sel: string): boolean => {
      if (!/::(before|after)$/.test(sel)) return false;
      if (sel.includes("overlay-mode")) return false; // the kill rule (class may sit on an ancestor compound)
      const subject = sel.split(/[\s>~+]+/).filter(Boolean).pop() ?? "";
      return /^(html|body|:root|#root)([^a-z0-9-]|$)/i.test(subject);
    };

    const offenders: string[] = [];
    for (const rel of cssFiles()) {
      const lines = readCssStripped(rel).split("\n");
      let selectorBuf = ""; // accumulates a selector list until its `{`
      let inDocLevelBlock = false;
      lines.forEach((line, i) => {
        if (inDocLevelBlock) {
          if (/content\s*:[^;}]*!important/.test(line))
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          if (line.includes("}")) inDocLevelBlock = false;
          return;
        }
        const open = line.indexOf("{");
        const selPart = open >= 0 ? line.slice(0, open) : line;
        selectorBuf += " " + selPart;
        if (open >= 0) {
          const sels = selectorBuf.split(",").map((s) => s.trim()).filter(Boolean);
          inDocLevelBlock = sels.some(isDocLevelPseudo) && !line.includes("}");
          // One-line rule (selector { decls }): check the declarations on this same line.
          if (sels.some(isDocLevelPseudo) && /content\s*:[^;}]*!important/.test(line.slice(open)))
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          selectorBuf = "";
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

// Guard 2 — no `:has()` keyed on the nav-hot shell (bug → guard, self-review round 2
// 2026-07-15: `.v2-shell:has(> .hud-frame)` re-evaluated on every DOM mutation under the
// shell, taxing exactly the biggest room swaps — Blackbook legs hit 87–156ms vs the ≲50ms
// rail-switch bar. ShellV2 already KNOWS the flag; state a plain class (.v2-shell-hud)
// instead of asking the style engine to rediscover it per mutation).
describe("nav-timing guard: no :has() on the nav-hot .v2-shell", () => {
  it("no `.v2-shell:has(` anywhere in src CSS", () => {
    const offenders: string[] = [];
    for (const rel of cssFiles()) {
      readCssStripped(rel)
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(".v2-shell:has(")) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
