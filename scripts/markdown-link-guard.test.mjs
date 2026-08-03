import { describe, it, expect } from "vitest";
import { markdownDestinations, withoutFencedCode, findBrokenMarkdownLinks } from "./markdown-link-guard.mjs";

// MARKDOWN-LINK GUARD tests. Salvaged 2026-08-03 from `codex/tool-shed-hygiene` (issue #13), the
// only two files on that 121-commit-stale branch still worth carrying: everything else there was
// superseded by guards main has grown since. Converted from `node:test` to vitest, because
// scripts/run-vitest.mjs is this repo's one runner and a suite the runner cannot collect is a suite
// that never runs — the original failed collection silently while its own node run said 4/4 green.
//
// The fence/inline-code cases are the whole point: a guard that reads links out of CODE EXAMPLES
// reports links that were never meant to resolve, and a guard with false positives gets switched
// off. Every case below is one way that goes wrong.

describe("markdown-link guard: code examples are not links", () => {
  it("does not let a shorter backtick fence close a longer one", () => {
    const stripped = withoutFencedCode(
      [
        "````markdown",
        "[ignored](missing-backtick-target.md)",
        "```",
        "[still-ignored](also-missing.md)",
        "````",
        "[checked](README.md)",
      ].join("\n"),
    );
    expect(stripped).not.toMatch(/missing-backtick-target|also-missing/);
    expect(stripped).toMatch(/\[checked]\(README\.md\)/);
  });

  it("does not let a shorter tilde fence close a longer one", () => {
    const stripped = withoutFencedCode(
      [
        "~~~~markdown",
        "[ignored](missing-tilde-target.md)",
        "~~~",
        "[still-ignored](also-missing.md)",
        "~~~~",
        "[checked](README.md)",
      ].join("\n"),
    );
    expect(stripped).not.toMatch(/missing-tilde-target|also-missing/);
    expect(stripped).toMatch(/\[checked]\(README\.md\)/);
  });

  it("masks single-backtick inline code but keeps an adjacent real link", () => {
    expect(markdownDestinations("`[ignored](missing-single.md)` [checked](README.md)")).toEqual([
      "README.md",
    ]);
  });

  it("masks multi-backtick inline code but keeps an adjacent real link", () => {
    expect(
      markdownDestinations("``[ignored](missing-multi.md) with `literal` tick`` [checked](README.md)"),
    ).toEqual(["README.md"]);
  });
});

describe("markdown-link guard: the repository has no broken local links", () => {
  it("finds a real corpus and no broken destination", () => {
    const { broken, checked } = findBrokenMarkdownLinks();
    // A silently empty walk would pass forever. Pin that it is actually reading the repo.
    expect(checked).toBeGreaterThan(50);
    expect(
      broken.map((b) => `${b.source} -> ${b.destination}`),
      "a markdown link points at a file that does not exist — fix the link or the path",
    ).toEqual([]);
  });
});
