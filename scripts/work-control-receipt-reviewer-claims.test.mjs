// Guard: a receipt's reviewer field must not claim independence the reviewer did not have (#307).
//
// 2026-09-01. `independentReview.reviewer` in the #277 receipt first said its reviewer was "holding
// its own worktree" and had "no stake in it landing". Both were false: the reviewer measured from
// checkouts it did not own, and every lane on this machine has a stake in `main` moving because each
// must merge it forward. The reviewer objected and #277's copy was corrected. The #290 receipt carried
// the identical wording and was not. The defect was a class, repaired one instance deep.
//
// `work-control-receipt-preservation.test.mjs` cannot see this: the receipt exists and is committed,
// and the overstatement is prose inside a string. This guard reads every receipt's reviewer field.
//
// A QUOTED PHRASE IS A CORRECTION, NOT A CLAIM. Both corrected receipts keep the wrong wording on
// record, in quotes, because a proof record that quietly repairs itself teaches the next reader
// nothing. So quoted spans are removed before matching: any "double-quoted" span, and a 'single-quoted'
// span only when its quotes sit at word boundaries, so a possessive such as "reviewer's" never opens
// one.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RECEIPTS = join(ROOT, ".claude", "work-control");

const OVERSTATEMENTS = [/\bits own worktree\b/i, /\bno stake in it landing\b/i];

export function unquoted(text) {
  return String(text)
    .replace(/"[^"]*"/g, " ")
    .replace(/(^|[\s(])'[^']*'(?=[\s.,;:)]|$)/g, "$1 ");
}

export function overstatementsIn(reviewer) {
  const bare = unquoted(reviewer);
  return OVERSTATEMENTS.filter((pattern) => pattern.test(bare)).map((pattern) => pattern.source);
}

describe("a receipt's reviewer field claims no independence it did not have (#307)", () => {
  it("fires on the original #290 wording and stays quiet on its quoted correction", () => {
    const original =
      "claude-code, session sentinel-21 [933d27] - a separate live Claude Code session on this machine, separate context, holding its own worktree and its own board items (#277/#276, #279/#278, #288, #289), with no write access to this lane and no stake in it landing";
    expect(overstatementsIn(original)).toHaveLength(2);
    expect(overstatementsIn(`corrected: 'holding its own worktree' and 'no stake in it landing'. ORIGINAL: "${original}"`)).toEqual([]);
  });

  it("a possessive apostrophe does not open a quote that hides a claim", () => {
    expect(overstatementsIn("the reviewer's session, holding its own worktree, and #277's copy")).toHaveLength(1);
  });

  it("no receipt's independentReview.reviewer states either overstatement", () => {
    const files = readdirSync(RECEIPTS).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const findings = [];
    for (const name of files) {
      const reviewer = JSON.parse(readFileSync(join(RECEIPTS, name), "utf8"))?.independentReview?.reviewer;
      if (typeof reviewer !== "string") continue;
      const hits = overstatementsIn(reviewer);
      if (hits.length) findings.push(`${name}: ${hits.join(", ")}`);
    }
    expect(findings).toEqual([]);
  });
});
