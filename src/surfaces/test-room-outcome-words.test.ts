// B6 (view-1122a finding 10, 2026-11-23): the Test room said "reversible" in its hints, fine print and power-features
// lines. "Reversible" is an outcome word (marathon product-text rule: state mechanisms, not outcomes; not "fully
// reversible"). Every Test room string now says what Compy does: it saves the setting first, so it can be undone, and
// it puts the change back unless the result clearly beats the noise. This guard keeps the outcome word out of the
// room's locale file in both languages. The risk dimension's own label ("Reversibility" / 可逆性) is a field name, not a
// promise, and is left out.
//
// OWNER-LOCKED: `labConsole.narrative.safety` is the comp's padlocked sentence (04-test-approved.png, pinned in
// design/comp-fidelity-guard.test.ts). Its rewording waits for the owner's yes in its own commit, so it is the one
// key this guard does not read until then. Break check: put "reversible" back in any other Test room string.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const OWNER_LOCKED = new Set(["labConsole.narrative.safety"]);

const flat = (o: unknown, at = ""): [string, string][] =>
  typeof o === "string" ? [[at, o]] : o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, at ? `${at}.${k}` : k)) : [];

const strings = (loc: string) =>
  flat(JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "lab.json"), "utf8"))).filter(
    ([k]) => !k.endsWith(".reversibility") && !OWNER_LOCKED.has(k),
  );

describe("the Test room states the mechanism, never 'reversible'", () => {
  it("en: no string says reversible", () => {
    const hits = strings("en").filter(([, s]) => /\breversibl[ey]\b/i.test(s)).map(([k]) => k);
    expect(hits).toEqual([]);
  });

  it("zh-CN: no string says 可逆 / 可还原 as a promise", () => {
    const hits = strings("zh-CN").filter(([, s]) => /可逆|可还原/.test(s)).map(([k]) => k);
    expect(hits).toEqual([]);
  });

  it("the guard still reads the room: the rewritten strings say the mechanism", () => {
    const en = strings("en");
    expect(en.length).toBeGreaterThan(100);
    expect(en.some(([, s]) => s.includes("saves the setting, applies one change"))).toBe(true);
  });
});
