import { describe, expect, it } from "vitest";
import enGaming from "./locales/en/gaming.json";
import zhGaming from "./locales/zh-CN/gaming.json";
import enLab from "./locales/en/lab.json";
import zhLab from "./locales/zh-CN/lab.json";

// The Problems room (Black Box), its case text and the Lab rig line that reads the same crash record
// may say what Windows recorded and what that does not rule out. They may never exclude the PC (or a
// part) because of WHERE a crash was recorded: drivers, memory, heat and unstable overclocks crash
// inside a game's own process too. Product text rule: CLAUDE.md "Honesty rules", Constitution §38.
//
// Allowlist is empty on purpose. A string that needs an entry here is a string that breaks the rule.
const ALLOWLIST: readonly string[] = [];

const EXCLUSION_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["en: 'rather than your PC/hardware'", /rather than your (pc|hardware|machine|rig)/i],
  ["en: 'itself, rather than'", /itself,? rather than/i],
  ["en: 'not your PC/hardware'", /\bnot your (pc|hardware|machine|rig)\b/i],
  ["en: 'problem in the app itself'", /problem (in|inside) [^.]{0,40}itself/i],
  ["en: 'not a part'", /,\s*not a part\b/i],
  ["en: 'your PC is fine'", /your (pc|rig|machine) is (fine|healthy|ok)\b/i],
  ["zh: '而不是…部件/电脑'", /而不是[^。]{0,6}(部件|电脑|硬件|主机)/],
  ["zh: '应用本身'", /应用本身/],
  ["zh: '不是你的电脑'", /不是你的(电脑|硬件|主机)/],
  ["zh: '你的电脑没问题'", /(电脑|主机|硬件)(完全)?没(有)?问题/],
];

const leaves = (value: unknown, path = ""): Array<[string, string]> => {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
};

// gaming.json whole (Black Box, case intelligence, incident text) and the Lab console (it carries the
// rig line that reads the same crash record). lab.json's experiment-bench summaries are left out: a
// "limiter that is a setting, not a part" is true by construction there and is not about a crash.
const SOURCES: Array<[string, unknown]> = [
  ["en/gaming.json", enGaming],
  ["zh-CN/gaming.json", zhGaming],
  ["en/lab.json#labConsole", enLab.labConsole],
  ["zh-CN/lab.json#labConsole", zhLab.labConsole],
];

describe("Problems room / case / rig-care text never excludes the PC on crash-location evidence", () => {
  it("no en or zh-CN string in gaming.json or lab.json carries an exclusion pattern (allowlist empty)", () => {
    expect(ALLOWLIST).toEqual([]);
    const hits: string[] = [];
    for (const [file, json] of SOURCES) {
      for (const [path, text] of leaves(json)) {
        for (const [label, re] of EXCLUSION_PATTERNS) {
          if (re.test(text) && !ALLOWLIST.includes(`${file}:${path}`)) hits.push(`${file}:${path} [${label}] ${text}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("the replacement statements exist in both languages, take the game's name, and say it does not rule out the PC", () => {
    for (const key of ["appCrash", "appHang", "hostProcess"] as const) {
      const en = enGaming.blackBox.assessStatement[key];
      const zh = zhGaming.blackBox.assessStatement[key];
      expect(en).toContain("{{subject}}");
      expect(zh).toContain("{{subject}}");
      expect(en).toContain("doesn't rule out your PC");
      expect(zh).toContain("并不能排除你的电脑");
    }
    expect(enLab.labConsole.rigFocus.away).toContain("doesn't rule out a part");
    expect(zhLab.labConsole.rigFocus.away).toContain("并不能排除某个部件");
  });
});
