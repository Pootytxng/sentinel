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
  ["en: 'isn't / is not / not the PC'", /\b(isn'?t|is not|not) (your|the) (pc|computer|hardware|machine|rig)\b/i],
  ["en: affirmative 'rules out your PC'", /(?<!(doesn't|does not|can't|cannot|not|never) )\brules? out (your|the) (pc|hardware|machine)/i],
  ["en: 'points at {x} itself'", /\b(points?|pointing) at [^.]{0,40}\bitself\b/i],
  ["en: 'rather than a game/title/app'", /rather than (a|the|any one|one) (game|title|app)/i],
  ["en: 'points at the game' (the record never looked)", /points? at the game\b/i],
  ["en: 'nothing wrong with your PC'", /nothing (is )?wrong with your/i],
  ["en: 'PC is not the problem'", /(pc|hardware|machine) is not the problem/i],
  ["en: 'overheating' as a finding", /\boverheating\b/i],
  ["en: 'commonly heat'", /commonly heat/i],
  ["en/zh: 'running hot' / 温度过高 as a finding", /running hot|温度过高/i],
  ["en: 'not from a game or a driver'", /not from a game/i],
  ["zh: '与…无关'", /与(你的)?(电脑|硬件)无关/],
  ["zh: affirmative '排除了…'", /(?<!不能|无法|并不能)排除(了)?(你的)?(电脑|硬件|部件)/],
  ["zh: '指向游戏'", /指向游戏/],
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
    for (const key of ["appCrash", "appHang", "hostProcess", "gpuTimeoutPeak", "shutdownPeak", "hardwareError", "hardwareErrorPeak"] as const) {
      const en = enGaming.blackBox.assessStatement[key];
      const zh = zhGaming.blackBox.assessStatement[key];
      if (["appCrash", "appHang", "hostProcess"].includes(key)) {
        expect(en).toContain("{{subject}}");
        expect(zh).toContain("{{subject}}");
      }
      // every statement says what the record alone can't tell, and none names a cause
      expect(en).toMatch(/can't tell|doesn't say which/);
      expect(zh).toMatch(/无法判断/);
    }
    for (const key of ["appCrash", "appHang"] as const) {
      expect(enGaming.blackBox.assessStatement[key]).toContain("in your PC");
      expect(zhGaming.blackBox.assessStatement[key]).toContain("还是你的电脑");
    }
    for (const key of ["gpuTimeoutPeak", "shutdownPeak", "hardwareErrorPeak"] as const) {
      expect(enGaming.blackBox.assessStatement[key]).toContain("{{temp}}");
      expect(zhGaming.blackBox.assessStatement[key]).toContain("{{temp}}");
      expect(enGaming.blackBox.assessStatement[key]).toContain("can't tell whether heat played a part");
    }
    expect(enLab.labConsole.rigFocus.away).toContain("can't say whether a part was involved");
    expect(zhLab.labConsole.rigFocus.away).toContain("无法判断是否与某个部件有关");
  });
});
