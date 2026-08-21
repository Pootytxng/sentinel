import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Bug → guard (self-review 2026-08-20, History's filter state). A BentoTile header is a flex row:
// title on the left, badge on the right. The badge was the NON-shrinking half (`flex: 0 0 auto`)
// and the title could wrap, so a long badge ("SESSIONS ONLY everything Compy has done on this PC ·
// since Jun 3, 2026") pushed "The record" onto two lines with the badge wedged between them —
// "The / SESSIONS ONLY … / record". The fix is a fixed contract: the title never wraps and never
// yields; the badge shrinks (min-width: 0) so its content ellipsizes or wraps instead. This test
// pins the contract in the CSS text so it cannot drift back one property at a time.

const css = readFileSync(join("src", "design", "bento", "bento.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function rule(selector: string): string {
  const m = css.match(new RegExp(`${selector.replace(/[.[\]"=]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe("BentoTile header — the title is the fixed half, the badge is the shrinking half", () => {
  it(".v2-tile-title never wraps and never shrinks", () => {
    const r = rule(':root[data-v2="on"] .v2-tile-title');
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/flex:\s*0\s+0\s+auto/);
  });

  it(".v2-tile-badge may shrink (min-width: 0) and never declares itself non-shrinking", () => {
    const r = rule(':root[data-v2="on"] .v2-tile-badge');
    expect(r).toMatch(/min-width:\s*0/);
    expect(r).not.toMatch(/flex:\s*0\s+0\s+auto/);
    expect(r).toMatch(/flex:\s*0\s+1\s+auto/);
  });

  it("the head keeps min-width: 0 so the badge's shrink has room to happen inside a grid cell", () => {
    expect(rule(':root[data-v2="on"] .v2-tile-head')).toMatch(/min-width:\s*0/);
  });
});
