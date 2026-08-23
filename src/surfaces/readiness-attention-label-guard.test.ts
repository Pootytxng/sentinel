import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * bug→guard (self-review FAIL, issue #49 slice 2, 2026-08-23).
 *
 * Health's verdict h1 is rendered at --type-verdict (40px/650) and, in the attention state, it IS
 * the flagged check's `label`, verbatim — that is the owner's name-it-and-fix-it-inline law, pinned
 * in `system-posture.test.ts` (`expect(p.headline).toBe(label)`). The frontend half of that law
 * shipped and was guarded with a SYNTHETIC fixture ("Monitor below max refresh"), so nobody noticed
 * that the real catalog emitted a neutral category noun for every attention branch. The app's
 * largest text read **"Applied Compy changes"** — a filing-cabinet tab where a finding belongs.
 *
 * The rule this pins: an Attention row must name WHAT WAS FOUND, so its label may never be the same
 * string that same check uses when it is fine. A label that describes both a good and a bad state
 * is, by construction, a category and not a finding.
 *
 * Ready/Advisory/Unknown rows keep their category label on purpose — a passing row is a category.
 */

// Repo-root-relative, like every sibling source-scanning guard: this project is ESM, so there is
// no __dirname, and `npm run build` typechecks test files too (that is how the first draft of this
// guard broke the release build rather than the test run).
const SRC = join("src-tauri", "src", "readiness.rs");

type Row = { id: string; label: string; status: string };

function catalogRows(src: string): Row[] {
  const rows: Row[] = [];

  // Form 1 — the `check(id, label, status, ...)` helper, which most branches use.
  const call = /check\(\s*"([^"]+)",\s*"((?:[^"\\]|\\.)+)",\s*ReadinessStatus::(\w+)/g;
  for (let m = call.exec(src); m != null; m = call.exec(src)) {
    rows.push({ id: m[1], label: m[2], status: m[3] });
  }

  // Form 2 — the `ReadinessCheck { .. }` struct literal (vrr builds its rows this way). Fields are
  // in declaration order with prose comments between them, so the window is deliberately generous.
  const lit = /id:\s*"([^"]+)",[\s\S]{0,400}?label:\s*"((?:[^"\\]|\\.)+)",[\s\S]{0,900}?status:\s*ReadinessStatus::(\w+)/g;
  for (let m = lit.exec(src); m != null; m = lit.exec(src)) {
    rows.push({ id: m[1], label: m[2], status: m[3] });
  }

  return rows;
}

describe("readiness attention labels name the finding, not the category", () => {
  const src = readFileSync(SRC, "utf8");
  const rows = catalogRows(src);

  it("parses a catalog worth guarding (the regexes have not rotted)", () => {
    // If a refactor changes how checks are constructed this count collapses and the guard below
    // starts passing vacuously — which is the failure mode a source-scanning guard actually has.
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => r.status === "Attention")).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBeGreaterThan(8);
  });

  it("no check reuses its calm label for its attention state", () => {
    const byId = new Map<string, { attention: Set<string>; calm: Set<string> }>();
    for (const r of rows) {
      const e = byId.get(r.id) ?? { attention: new Set<string>(), calm: new Set<string>() };
      (r.status === "Attention" ? e.attention : e.calm).add(r.label);
      byId.set(r.id, e);
    }

    const offenders: string[] = [];
    for (const [id, e] of byId) {
      for (const label of e.attention) {
        if (e.calm.has(label)) {
          offenders.push(
            `${id}: "${label}" is used for BOTH its attention and its calm state — ` +
              `an attention label must say what was found (it becomes Health's 40px verdict).`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
