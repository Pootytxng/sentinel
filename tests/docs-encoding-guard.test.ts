import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// bug→guard (2026-07-04): docs/RELEASE_STATE.md turned up in the working tree with 131 trailing
// NUL bytes appended (git suddenly saw the doc as BINARY; the committed blob was clean). Likely
// culprit: a PowerShell `>` / `Out-File` redirect, which defaults to UTF-16LE and pads with NULs —
// whatever wrote it would recur silently and eventually get committed, corrupting the canonical
// state docs (RELEASE_STATE is the authoritative gate matrix; a binary-flagged doc also kills
// git diffs/reviews for it). This guard fails the suite if any tracked docs/**/*.md contains a
// NUL byte or isn't valid UTF-8, so the corruption is caught at the next test run, not in review.
//
// Lives in tests/ (not src/): it needs Node APIs (fs/child_process), and the app tsconfig is
// deliberately DOM-only with no @types/node — vitest picks up *.test.ts repo-wide regardless.

const repoRoot = process.cwd(); // vitest runs from the repo root

function trackedDocsMd(): string[] {
  const out = execSync("git ls-files -z -- docs", { cwd: repoRoot });
  return out
    .toString("utf8")
    .split("\0")
    .filter((p: string) => p.endsWith(".md"));
}

describe("docs encoding guard — tracked docs/**/*.md are NUL-free valid UTF-8", () => {
  it("finds the docs corpus (sanity: the glob actually matches files)", () => {
    // If this ever reads 0, the guard has gone blind (path/glob drift) — that's a failure too.
    expect(trackedDocsMd().length).toBeGreaterThan(0);
  });

  it("no tracked docs .md contains a NUL byte (UTF-16 redirect / binary corruption)", () => {
    const offenders: string[] = [];
    for (const rel of trackedDocsMd()) {
      const buf = readFileSync(resolve(repoRoot, rel));
      if (buf.includes(0)) offenders.push(rel);
    }
    expect(offenders, `NUL byte(s) found in: ${offenders.join(", ")} — a PowerShell '>' redirect writes UTF-16/NUL padding; rewrite the file as UTF-8 (no BOM)`).toEqual([]);
  });

  it("every tracked docs .md decodes as strict valid UTF-8", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const offenders: string[] = [];
    for (const rel of trackedDocsMd()) {
      try {
        decoder.decode(readFileSync(resolve(repoRoot, rel)));
      } catch {
        offenders.push(rel);
      }
    }
    expect(offenders, `invalid UTF-8 in: ${offenders.join(", ")}`).toEqual([]);
  });
});
