// Guard: a governing doc may cite an HQ document, but not as if a session could open it.
//
// `claude/<NAME>.md` is the Cowork/claude.ai PROJECT namespace, not a path in this repo. Nothing
// under it has ever existed on this filesystem and nothing under it ever will —
// `docs/COWORK_HANDOFF.md` names the project the files actually live in ("Cowork project
// `019ff3cc…`"). A Claude Code session has no way to read one.
//
// Why this is a test and not a sentence: the class has now cost real time twice.
//
//   1. 2026-08-18, commit 94db990b — TOKEN LAW 5 named a "weekly Cowork sweep" that did not exist
//      (no scheduled task in the account, no Windows task) AND forbade building a replacement. The
//      clause was repointed at `CompyUsageAudit`, which does exist.
//   2. 2026-08-25 — CLAUDE.md's TOKEN LAW said "Full policy: `claude/TOKEN_ECONOMY_LAW.md` (HQ)"
//      with no hint that (HQ) meant off-disk. A session doing exactly what the law told it to do
//      searched the repo, then the whole user profile, and found nothing, because there is nothing
//      to find.
//
// The rule is narrow on purpose: cite it freely, say once that it is not on disk. That single fact
// is the whole difference between a pointer and a wild goose chase.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** `claude/Something.md`, not `.claude/…` (that one IS on disk) and not a URL path. */
export const HQ_CITATION = /(?<![.\w/-])claude\/[A-Za-z0-9_.-]+\.md/g;

/**
 * The one fact a hunting session needs. Deliberately a small vocabulary: a guard that accepts any
 * vaguely reassuring phrase accepts "(HQ)" again, which is exactly what failed.
 */
export const SAYS_OFF_DISK =
  /not on disk|not on this (filesystem|machine)|not (a )?(repo|in-repo|local) file|not in (this|the) repo|lives? in the Cowork project|Cowork project `/i;

/** Paragraphs, so the disclaimer may sit in the sentence next to the citation rather than on it. */
export function paragraphs(markdown) {
  return markdown.split(/\r?\n\s*\r?\n/);
}

/**
 * Every HQ doc named in a paragraph that does not say it is unreachable. `matchAll` rather than
 * `.test()` on purpose: HQ_CITATION carries the `g` flag, and a global regex reused across calls
 * carries `lastIndex` with it — a stateful matcher would skip citations depending on what it read
 * last, which is the quietest way for a guard to be green and wrong.
 */
export function undisclosedCitations(markdown) {
  return paragraphs(markdown)
    .filter((p) => !SAYS_OFF_DISK.test(p))
    .flatMap((p) => [...p.matchAll(HQ_CITATION)].map((m) => m[0]))
    .filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Scope: the documents a session is STEERED by. Records are not rewritten to satisfy a scan — the
 * same line `tools/entry/doc-truth.test.mjs` draws for archives, and for the same reason: a plan or
 * a changelog entry is a claim someone made on a date, not a claim this repo is making now.
 */
const isRecord = (rel) =>
  /(^|[\\/])(docs[\\/]archive|docs[\\/]superpowers)[\\/]|_ARCHIVE\.md$|_HISTORY\.md$|CHANGELOG\.md$/i.test(rel);

function governingDocs() {
  const found = [];
  const walk = (dir, depth) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        if (depth > 0 && !/^(node_modules|\.git|worktrees|target)$/.test(name)) walk(abs, depth - 1);
        continue;
      }
      if (name.endsWith(".md")) found.push(relative(ROOT, abs));
    }
  };
  walk(join(ROOT, ".claude"), 2);
  walk(join(ROOT, "docs"), 0); // top level only: docs/*.md are the live ledgers
  found.push("CLAUDE.md", join("src-tauri", "CLAUDE.md"));
  return found.filter((rel) => existsSync(join(ROOT, rel)) && !isRecord(rel)).sort();
}

describe("an HQ citation must say it is off-disk", () => {
  const docs = governingDocs();

  it("scans the live ledgers and not the records that merely quote them", () => {
    // Both halves matter: a green run must never be able to mean "the scan set narrowed to nothing".
    expect(docs).toContain("CLAUDE.md");
    expect(docs).toContain(join("docs", "COWORK_HANDOFF.md"));
    expect(docs).toContain(join(".claude", "USAGE_ECONOMICS.md"));
    expect(docs.filter(isRecord)).toEqual([]);
    expect(isRecord(join("docs", "superpowers", "plans", "x.md"))).toBe(true);
    expect(isRecord(join("docs", "CHANGELOG.md"))).toBe(true);
    expect(isRecord(join("docs", "BACKLOG.md"))).toBe(false);
  });

  it("still catches the citation it was written for", () => {
    expect(undisclosedCitations("Full policy: `claude/TOKEN_ECONOMY_LAW.md` (HQ); it wins.")).toEqual([
      "claude/TOKEN_ECONOMY_LAW.md",
    ]);
    expect(
      undisclosedCitations("Full policy: `claude/TOKEN_ECONOMY_LAW.md` — a Cowork doc, not on disk."),
    ).toEqual([]);
  });

  it("does not fire on `.claude/…`, which IS on disk", () => {
    expect(undisclosedCitations("See `.claude/USAGE_ECONOMICS.md` for the retired sections.")).toEqual([]);
    expect(undisclosedCitations("See [it](../.claude/skills/INDEX.md).")).toEqual([]);
  });

  it("does not fire on a URL that merely contains the segment", () => {
    expect(undisclosedCitations("https://example.test/claude/NOTES.md is a web page.")).toEqual([]);
  });

  it("reads the disclaimer per paragraph, so one sentence covers its neighbours", () => {
    const near = "HQ docs are not on disk.\nFull policy: `claude/TOKEN_ECONOMY_LAW.md`.";
    expect(undisclosedCitations(near)).toEqual([]);
    const far = "HQ docs are not on disk.\n\nFull policy: `claude/TOKEN_ECONOMY_LAW.md`.";
    expect(undisclosedCitations(far)).toEqual(["claude/TOKEN_ECONOMY_LAW.md"]);
  });

  for (const rel of docs) {
    it(`${rel} discloses every HQ doc it cites`, () => {
      const undisclosed = undisclosedCitations(readFileSync(join(ROOT, rel), "utf8"));
      expect(
        undisclosed,
        `${rel} cites an HQ doc as if it were readable from this repo:\n  - ${undisclosed.join("\n  - ")}\n` +
          `Say once, in the same paragraph, that it is not on disk.`,
      ).toEqual([]);
    });
  }
});
