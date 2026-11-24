import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ROW-COUNT WORDS GUARD (C7). A count of ledger ROWS is records, never "changes".
//
// A consumer panel read four different change counts on one PC. Two of them were rows printed under the word
// "changes": Home's Trust ledger "86 changes tracked" and Your data's 45 "Still in place" rows, while the footer's
// "13 changes can be undone" counted settings. A setting Compy applied 27 times is 1 setting and 27 records; a
// sentence that calls the 27 "changes" disagrees with every per-setting count on the same screen.
//
// The law: a t("key", { ... }) call whose options pass a row count (the ledger list's length, the Machine Model's
// `total_recorded`) must resolve, in EVERY locale and every plural form, to words without "change"/"changes" (en)
// or 更改/变更 (zh-CN). Per-setting counts are not graded here (they are settings, and the footer/Home words say so:
// open-settings-parity.test.ts).
//
// Break check: restore home.homeHud.ledger.changesTracked_other to "changes tracked" (or common.shellV2.footerEmph
// to "ledger changes: {{n}}") -> this fails naming the key.

const SRC = "src";
const LOCALES_DIR = join("src", "i18n", "locales");

/** Expressions that count ledger ROWS. ShellV2's `ledgerCount` is `ledger?.length` (ShellV2.tsx). */
const ROW_COUNT = /\b(changes\.length|ledger\.length|ledgerCount|totalRecorded|total_recorded|history\.length)\b/;
const CHANGE_WORD: Record<string, RegExp> = { en: /\bchanges?\b/i, "zh-CN": /更改|变更/ };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function flatten(obj: unknown, prefix: string, out: Map<string, string>): Map<string, string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = `${prefix}.${k}`;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

function locale(name: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(join(LOCALES_DIR, name)).filter((x) => x.endsWith(".json"))) {
    flatten(JSON.parse(readFileSync(join(LOCALES_DIR, name, f), "utf8")), f.replace(/\.json$/, ""), out);
  }
  return out;
}

/** Every t("key", { ... }) call in shipped code whose options pass a row count. */
function rowCountCalls(): { file: string; key: string }[] {
  const calls: { file: string; key: string }[] = [];
  const call = /\bt\(\s*"([^"]+)"\s*,\s*\{([^{}]*)\}/g;
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(call)) if (ROW_COUNT.test(m[2])) calls.push({ file: file.replace(/\\/g, "/"), key: m[1] });
  }
  return calls;
}

/** The key's strings in one locale: the key itself and every plural form of it. */
function forms(strings: Map<string, string>, key: string): string[] {
  return [...strings.entries()].filter(([k]) => k === key || new RegExp(`^${key.replace(/\./g, "\\.")}_(zero|one|two|few|many|other)$`).test(k)).map(([, v]) => v);
}

describe("a count of ledger rows is records, never 'changes' (C7)", () => {
  const calls = rowCountCalls();

  it("finds the row-count call sites (the guard is not vacuous)", () => {
    const keys = new Set(calls.map((c) => c.key));
    for (const k of [
      "common.shellV2.footerEmph",
      "common.shellV2.footerEmphFloor",
      "home.homeHud.ledger.changesTracked",
      "home.homeV2.stats.changesTracked",
      "common.attribution.listTruncated",
    ]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("every one resolves, in every locale and plural form, to words without 'change(s)'", () => {
    const offenders: string[] = [];
    for (const name of Object.keys(CHANGE_WORD)) {
      const strings = locale(name);
      for (const { file, key } of calls) {
        const found = forms(strings, key);
        if (found.length === 0) offenders.push(`${name}: ${key} (${file}) has no string`);
        for (const s of found) if (CHANGE_WORD[name].test(s)) offenders.push(`${name}: ${key} (${file}) says "${s}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects a row count worded as changes (disarm proof, in memory)", () => {
    expect(CHANGE_WORD.en.test("changes tracked")).toBe(true);
    expect(CHANGE_WORD.en.test("records")).toBe(false);
    expect(CHANGE_WORD["zh-CN"].test("项变更已记录")).toBe(true);
    expect(CHANGE_WORD["zh-CN"].test("条记录")).toBe(false);
    expect(ROW_COUNT.test(" count: changes.length ")).toBe(true);
    expect(ROW_COUNT.test(" count: tally.undoable ")).toBe(false);
  });
});