// B6 (view-1122a finding 2, 2026-11-23): the card's row title read "Compy had a different number of changes on", a
// sentence that ends on a dangling "on" (it meant "turned on"). The title is a fixed phrase with no argument
// (ParamedicCard.tsx findingTitle -> paramedic.finding.compyChange.what); nothing was missing from the call, the
// phrase itself was cut short. No row title may end on a bare preposition.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const finding = (loc: string) =>
  JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "paramedic.json"), "utf8")).finding as Record<string, Record<string, string>>;

describe("the Something's-wrong card's row titles", () => {
  it("no English row title ends on a bare preposition", () => {
    const hits: string[] = [];
    for (const [id, keys] of Object.entries(finding("en")))
      // "On" as a state ("no longer on", "came back on", "turned on") is a finished phrase; any other trailing
      // preposition is not.
      for (const [k, s] of Object.entries(keys))
        if (/\b(in|to|of|for|at|with|from|by)\s*$/i.test(s) || /(?<!\b(?:longer|back|turned|still|left)) on\s*$/i.test(s)) hits.push(`${id}.${k}: ${s}`);
    expect(hits).toEqual([]);
  });

  it("the Compy-change row says what differed, in both languages", () => {
    expect(finding("en").compyChange.what).toBe("The number of changes Compy had turned on was different");
    expect(finding("zh-CN").compyChange.what).toBe("Compy 开启的更改数量不一样");
  });
});
