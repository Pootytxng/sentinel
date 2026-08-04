import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// doc-budget.ps1 is a REPO-DRIFT detector: its answer changes on any commit that adds lines to a
// hot doc. Until 2026-08-04 its only automatic runner was verify-release.ps1 — the full release
// gate, which nobody runs between releases — so an overage could sit on `main` for weeks and only
// surface at ship time, which is the same rot that had verify-module-map.mjs and
// verify-release-state.mjs sitting unrun (9827728, c7c5a8d). This makes it resident in `npm test`.
//
// It re-implements the CHECK in JS rather than spawning powershell, but it does NOT re-declare the
// BUDGETS: the table is parsed out of doc-budget.ps1 itself, so the release gate and this test can
// never disagree about a number. Tightening a budget in the .ps1 tightens it here on the next test
// run; a second hard-coded copy would have been a third source of truth to keep in sync.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_SCRIPT = join(ROOT, "scripts", "doc-budget.ps1");

// A `"path" = 300` row inside the $budgets hashtable. Comments live in that block too (the CLAUDE.md
// rows carry their rationale inline), so anything not shaped like a row is skipped rather than
// guessed at.
export function parseBudgets(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\$budgets\s*=\s*@\{/.test(l));
  if (start === -1) return {};
  const budgets = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\}/.test(line)) break;
    const row = /^\s*"([^"]+)"\s*=\s*(\d+)\s*$/.exec(line);
    if (row) budgets[row[1]] = Number(row[2]);
  }
  return budgets;
}

// PowerShell's `(Get-Content $p).Count`, which is what the gate counts: split on either line ending,
// and a trailing newline does NOT contribute a final empty line.
export function countLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

describe("budget-table parsing (the gate's own table, not a copy of it)", () => {
  it("reads every row and ignores the comments interleaved with them", () => {
    const text = [
      "$budgets = @{",
      '  "docs/RELEASE_STATE.md" = 300',
      "  # Tightened 400 -> 380 because the read-only half moved out.",
      '  "CLAUDE.md" = 380',
      "}",
      "$root = Split-Path $PSScriptRoot -Parent",
      '  "docs/NOT_A_BUDGET.md" = 999',
    ].join("\n");

    expect(parseBudgets(text)).toEqual({ "docs/RELEASE_STATE.md": 300, "CLAUDE.md": 380 });
  });

  it("returns nothing when the hashtable is gone, instead of inventing an empty pass", () => {
    // Paired with the >= 8 assertion in the live check below: a parser that silently answers {} would
    // otherwise turn this whole file green forever.
    expect(parseBudgets("# no budgets here\n")).toEqual({});
  });
});

describe("line counting matches Get-Content", () => {
  it("does not count the newline that ends the last line", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\r\nb\r\nc\r\n")).toBe(3);
  });

  it("counts a file with no trailing newline, and an empty file as zero", () => {
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("")).toBe(0);
  });
});

describe("the hot docs as they stand", () => {
  const budgets = parseBudgets(readFileSync(BUDGET_SCRIPT, "utf8"));

  it("still declares a budget table with the docs the token law names", () => {
    expect(Object.keys(budgets).length).toBeGreaterThanOrEqual(8);
    expect(budgets["docs/BACKLOG.md"]).toBeGreaterThan(0);
    expect(budgets["CLAUDE.md"]).toBeGreaterThan(0);
  });

  it("are every one of them inside budget", () => {
    const over = [];
    for (const [rel, budget] of Object.entries(budgets)) {
      const path = join(ROOT, ...rel.split("/"));
      if (!existsSync(path)) continue; // the gate SKIPs a missing file; so do we.
      const n = countLines(readFileSync(path, "utf8"));
      if (n > budget) over.push(`${rel} ${n}/${budget}`);
    }
    // FAIL = MOVE history/log sections to docs/archive/ (append at top, leave a pointer). Never
    // delete, and never raise the number to make this green — the budget IS the decree.
    expect(over).toEqual([]);
  });
});
