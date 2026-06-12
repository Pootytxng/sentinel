import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — see sweep-guard for why CSS is read from disk.)

// Theme law (instrument.css contract): every color resolves from the token layer so a theme
// switch recolors everything. A BARE accent-teal literal in surface CSS stays teal under the
// owner-locked warm Hearth theme — the exact bug fixed in Settings + the arc backdrops (R5
// Lane 1). This guard makes the rule grep-provable: the brand-teal rgba may appear in a CSS
// line only as a var() fallback, or inside instrument.css where the tokens are DEFINED.
describe("theme law: no bare accent-teal literals outside the token layer", () => {
  it("every rgba(46, 230, 192 …) in src/ CSS is a var() fallback or a token definition", () => {
    const files = (readdirSync("src", { recursive: true }) as string[]).filter((f) =>
      f.endsWith(".css"),
    );
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel.replace(/\\/g, "/") === "design/instrument.css") continue;
      const css = readFileSync(join("src", rel), "utf8");
      css.split("\n").forEach((line, i) => {
        if (line.includes("rgba(46, 230, 192") && !line.includes("var(--")) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
