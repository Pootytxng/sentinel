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
// Review of that fix (#587) found two more. The ask put four folders after one `git worktree remove`,
// which takes one. And a reworded heading (`### A-spent`) fell out of the parse while the one-way
// name check still passed.
//
// Pinned here: every `### A_` item lives inside §A; the count word matches the numbered list after it;
// that list and the `### A_` headings name the same items, both ways; no §A path has lost its
// separators; and each remove command names one folder, so every line pastes as written.

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
    const headings = new Set(items.map((it) => it.name));
    const orphaned = [...list.matchAll(/\*\*(A_[A-Za-z0-9]+)\*\*/g)].map((m) => m[1]).filter((n) => !headings.has(n));
    expect(orphaned, "the count sentence names an item with no `### A_x.` heading: the parse lost it").toEqual([]);
  });

  it("no §A folder path has lost its separators", () => {
    // A stripped Windows path reads `.claudeworktreesX` or `..sibling`: a dot run glued to a name,
    // at the start of a code span or after a space inside a whole command.
    const stripped = LINES.slice(start, end)
      .flatMap((l) => l.match(/`[^`]*`/g) ?? [])
      .filter((code) => /\.claudeworktrees|[\s`]\.\.[A-Za-z]/.test(code));
    expect(stripped, "a path the owner would paste that names no real folder").toEqual([]);
  });

  it("each `git worktree remove` names exactly one folder", () => {
    // It takes one path. A command naming several, or none, is not one the owner can paste as written.
    const bad = LINES.slice(start, end)
      .flatMap((l) => l.match(/`git worktree remove[^`]*`/g) ?? [])
      .filter((code) => code.slice(1, -1).trim().split(/\s+/).slice(3).filter((t) => t !== "--force").length !== 1);
    expect(bad, "a remove command that does not name exactly one folder").toEqual([]);
  });
});
