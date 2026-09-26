import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// bug→guard, 2026-09-26. `docs/OWNER_ACTION_CHECKLIST.md` §A is the list of things only the owner's
// hands can do, and its "§A holds N things" sentence is the one line he reads to know how many. An
// `A_stale` item was filed under §B instead, so the count never included it and for 25 days nobody
// re-checked it: its precondition had landed, half its ask no longer existed, and its folder count was
// wrong. He keeps no notes, so an owner item the count misses is an item he never sees.
//
// The same pass found `A_spent`'s folder paths with their backslashes stripped
// (`.claudeworktreeslicense-tests`), so the ask named four folders that do not exist.
//
// Pinned here: every `### A_` item lives inside §A, the count word matches the numbered list after it,
// every §A item is named in that list, and no §A path has lost its separators.

const TEXT = readFileSync(join("docs", "OWNER_ACTION_CHECKLIST.md"), "utf8");
const LINES = TEXT.split("\n");
const WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];

const start = LINES.findIndex((l) => l.startsWith("## §A"));
const end = LINES.findIndex((l, i) => i > start && l.startsWith("## "));
const items = LINES.flatMap((l, i) => {
  const m = /^### (A_[A-Za-z0-9]+)\./.exec(l);
  return m ? [{ name: m[1], line: i + 1 }] : [];
});
const COUNT = /\*\*§A holds ([A-Z]+) things?:\*\*([\s\S]*?)\n(?:Archived|\n)/.exec(TEXT);

describe("OWNER_ACTION_CHECKLIST §A: every owner-hands item is filed there and counted", () => {
  it("finds §A, its items and its count sentence (the parse is not silently empty)", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(COUNT, "the '**§A holds N things:**' sentence is gone or reworded").not.toBeNull();
  });

  it("no `### A_` item sits outside §A", () => {
    const outside = items.filter((it) => it.line - 1 <= start || it.line - 1 >= end);
    expect(outside, "an owner-hands item filed under another section is missing from the §A count").toEqual([]);
  });

  it("the count word matches the numbered list, and names every §A item", () => {
    const [, word, list] = COUNT!;
    const numbered = list.match(/[①-⑳]/g) ?? [];
    expect(WORDS.indexOf(word), `"§A holds ${word}" but the list numbers ${numbered.length}`).toBe(numbered.length);
    const unnamed = items.filter((it) => !list.includes(`**${it.name}**`)).map((it) => it.name);
    expect(unnamed, "a §A item the count sentence does not name").toEqual([]);
  });

  it("no §A folder path has lost its separators", () => {
    // A stripped Windows path reads `.claudeworktreesX` or `..sibling`: a dot run glued to a name.
    const stripped = LINES.slice(start, end)
      .flatMap((l) => l.match(/`[^`]*`/g) ?? [])
      .filter((code) => /\.claudeworktrees|`\.\.[A-Za-z]/.test(code));
    expect(stripped, "a path the owner would paste that names no real folder").toEqual([]);
  });
});
