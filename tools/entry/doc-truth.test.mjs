// Guard for owner decision 7 (Issue #18, 2026-07-30): no document on this branch may imply that
// merging into `main` updates existing worktrees.
//
// It does not. A merge moves `main`; every other checkout stays on the commit it was already on
// until it is itself merged, rebased, or recreated. The spec said merging would "make
// docs/WORK_CONTROL.md and the shared tooling readable from every worktree" — which is exactly the
// belief that produced findings 6 and 7 in the first place, and exactly the belief that would let a
// future session merge, assume the fleet is fixed, and stop.
//
// A comment correcting this once is a comment. A test is the correction, because it is re-checked
// every time the docs change — including by whoever writes the next spec on this branch.
//
// Scope: the documents this train owns. Older records elsewhere in the repo stand as history and are
// deliberately not rewritten (the two prior GitHub comments likewise stand as record).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const SPEC = join("docs", "superpowers", "specs", "2026-07-30-single-entry-workflow.md");
const PLAN = join("docs", "superpowers", "plans", "2026-07-30-single-entry-workflow.md");

/** Every doc this branch adds or changes — so a NEW doc cannot smuggle the claim back in. */
function scannedDocs() {
  const files = new Set([SPEC, PLAN]);
  try {
    const changed = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD", "--", "docs/"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    for (const f of changed.split("\n").map((s) => s.trim()).filter(Boolean)) {
      if (f.endsWith(".md")) files.add(f.replace(/\//g, "\\"));
    }
  } catch {
    /* no origin/main locally is not a reason to skip the two documents we know about */
  }
  return [...files].filter((f) => existsSync(join(ROOT, f)));
}

/** Fenced blocks are commands and payloads, not prose claims. */
const prose = (text) => text.replace(/```[\s\S]*?```/g, "");

const sentences = (text) =>
  prose(text)
    .split(/\n{2,}|\r\n{2,}/)
    .flatMap((para) => para.split(/(?<=[.!?:])\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const MENTIONS_MERGE = /\bmerg(e|es|ed|ing)\b/i;
const MENTIONS_WORKTREE = /\bworktree|\bcheckout|\bevery folder|\ball six\b/i;

/**
 * A sentence may pair the two only while denying the implication. Anything weaker — "merging makes
 * X readable from every worktree" — is the false claim, however it is phrased.
 */
const DENIES_PROPAGATION =
  /\bno existing worktree|does not update|never updates|not automatically|only when it is itself|until (it|each|they) (is|are)|must itself be|stays on the commit/i;

describe("decision 7 — the docs must not imply a merge updates existing worktrees", () => {
  const docs = scannedDocs();

  it("scans the documents this train owns", () => {
    expect(docs).toContain(SPEC);
    expect(docs.length).toBeGreaterThan(0);
  });

  for (const rel of docs) {
    it(`${rel} pairs merge and worktrees only while denying propagation`, () => {
      const offenders = sentences(readFileSync(join(ROOT, rel), "utf8")).filter(
        (s) => MENTIONS_MERGE.test(s) && MENTIONS_WORKTREE.test(s) && !DENIES_PROPAGATION.test(s),
      );
      expect(offenders, `${rel} implies a merge reaches existing worktrees:\n  - ${offenders.join("\n  - ")}`).toEqual(
        [],
      );
    });
  }

  it("the specific false claim is gone from the spec", () => {
    const spec = readFileSync(join(ROOT, SPEC), "utf8");
    expect(spec).not.toContain("readable from every worktree");
  });

  it("the spec states the correction explicitly, not merely by omission", () => {
    const spec = readFileSync(join(ROOT, SPEC), "utf8");
    expect(spec).toMatch(/updates \*\*no existing worktree\*\*|updates no existing worktree/i);
    expect(spec).toMatch(/merged, rebased,? (or|and) recreated/i);
  });
});
