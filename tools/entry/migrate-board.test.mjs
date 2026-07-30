// Guard: migrating the board to the canonical `Worktree / branch` form must be a reviewable diff,
// and must refuse ambiguity rather than resolve it.
//
// The fixture is the ACTUAL board, read 2026-07-30. If a future board value stops migrating cleanly,
// this test is where that shows up — before `--apply` touches Kuya's board.

import { describe, expect, it } from "vitest";
import { planMigration } from "./migrate-board.mjs";

const CODE_ROOT = "C:\\Users\\Kuya\\code";

/** Verbatim board values, 2026-07-30. */
const BOARD = [
  { number: 10, value: "sentinel-work-control-codex \u00B7 codex/work-control" },
  { number: 12, value: "sentinel + sentinel-feedback \u00B7 exact active folder unknown/locked" },
  { number: 13, value: "sentinel-codex-hygiene \u00B7 codex/tool-shed-hygiene (preserve)" },
  { number: 14, value: "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery" },
  { number: 15, value: "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery" },
  { number: 16, value: "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery" },
  { number: 17, value: "C:\\Users\\Kuya\\code\\sentinel-rel / codex/product-quality-blueprint" },
  { number: 18, value: "C:\\Users\\Kuya\\code\\sentinel-workflow @ feat/single-entry-workflow" },
];

const plan = () => planMigration(BOARD, { codeRoot: CODE_ROOT });

describe("planMigration over the real board", () => {
  it("classifies every item as changed, unchanged, or refused — never silently dropped", () => {
    const rows = plan();
    expect(rows).toHaveLength(BOARD.length);
    expect(rows.every((r) => ["change", "same", "refuse"].includes(r.action))).toBe(true);
  });

  it("rewrites the six legacy values and leaves the already-canonical one alone", () => {
    const rows = plan();
    const changed = rows.filter((r) => r.action === "change").map((r) => r.number);
    expect(changed).toEqual([10, 13, 14, 15, 16, 17]);
    expect(rows.find((r) => r.number === 18).action).toBe("same");
  });

  it("refuses item 12 and reports why, instead of picking one of its two folders", () => {
    const row = plan().find((r) => r.number === 12);
    expect(row.action).toBe("refuse");
    expect(row.code).toBe("AMBIGUOUS_MULTI_FOLDER");
    expect(row.reason).toMatch(/unknown means locked/i);
    expect(row.after).toBeNull();
  });

  it("carries item 13's `(preserve)` note out as a note, not into the branch", () => {
    const row = plan().find((r) => r.number === 13);
    expect(row.after).toBe("C:\\Users\\Kuya\\code\\sentinel-codex-hygiene @ codex/tool-shed-hygiene");
    expect(row.notes).toEqual(["preserve"]);
  });

  it("resolves bare leaf names against the code root", () => {
    expect(plan().find((r) => r.number === 10).after).toBe(
      "C:\\Users\\Kuya\\code\\sentinel-work-control-codex @ codex/work-control",
    );
  });

  it("keeps #17's preserved worktree pointing at exactly the same folder and branch", () => {
    // #17 is preserved work under another lane. Migration may reformat the field; it may never
    // change which folder or branch that field designates.
    const row = plan().find((r) => r.number === 17);
    expect(row.after).toBe("C:\\Users\\Kuya\\code\\sentinel-rel @ codex/product-quality-blueprint");
    expect(row.entries).toEqual([
      { path: "C:\\Users\\Kuya\\code\\sentinel-rel", branch: "codex/product-quality-blueprint" },
    ]);
  });

  it("is idempotent — migrating the migrated board changes nothing", () => {
    const once = plan().map((r) => ({ number: r.number, value: r.after ?? r.before }));
    const twice = planMigration(once, { codeRoot: CODE_ROOT });
    expect(twice.filter((r) => r.action === "change")).toEqual([]);
  });
});
