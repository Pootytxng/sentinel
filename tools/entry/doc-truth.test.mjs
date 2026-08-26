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

/**
 * Archives are records, not claims. TOKEN LAW keeps point-in-time history in `docs/archive/*` and the
 * `*_ARCHIVE.md` / `*_HISTORY.md` files, and this guard's scope has always been the documents a train
 * OWNS — "older records elsewhere in the repo stand as history and are deliberately not rewritten".
 * Moving a finished section INTO an archive touches the file without authoring a word of it, so
 * without this line the first train to archive anything inherits every historical sentence in there
 * as its own claim. That is not hypothetical: on 2026-08-04 a branch whose only archive change was a
 * move failed on three branch-reconciliation notes written in 1c2a0a2 / 4619689, byte-identical to
 * main's copy. Rewriting them to satisfy a scan would have been falsifying the record to pass a test.
 */
const isHistory = (rel) =>
  /(^|[\\/])docs[\\/]archive[\\/]|_ARCHIVE\.md$|_HISTORY\.md$/i.test(rel);

/**
 * Every doc this branch adds or changes — so a NEW doc cannot smuggle the claim back in.
 *
 * TWO sources, and the second was missing until 2026-08-26 (bug→guard). The committed diff against
 * `origin/main` cannot see a doc you have only just written, so on a branch sitting exactly AT
 * `origin/main` the corpus collapsed to SPEC + PLAN and this guard reported a cheerful green over a
 * working tree full of unscanned edits. That is not a theoretical hole: a hand-run passed
 * `docs/SESSION_HANDOFF.md` minutes before `.githooks/pre-push` failed the identical assertion on
 * the same text, because the commit in between is what put the file into the corpus. A guard whose
 * scope depends on whether you have typed `git commit` yet teaches the wrong lesson twice — it is
 * green when you can still cheaply fix things, and red only once the fix costs a rewrite.
 *
 * So the working tree counts too: modified, staged and untracked docs are all scanned.
 */
function scannedDocs() {
  const files = new Set([SPEC, PLAN]);
  const add = (rel) => {
    if (rel.endsWith(".md")) files.add(rel.replace(/\//g, "\\"));
  };
  const git = (args) => {
    try {
      return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
    } catch {
      /* no origin/main locally is not a reason to skip the documents we know about */
      return "";
    }
  };

  for (const f of git(["diff", "--name-only", "origin/main...HEAD", "--", "docs/"]).split("\n")) {
    const rel = f.trim();
    if (rel) add(rel);
  }
  // Uncommitted work. `--porcelain` prefixes two status columns, and a rename reads `old -> new`;
  // the arrow form is split so the file that EXISTS is the one scanned.
  for (const line of git(["status", "--porcelain", "--", "docs/"]).split("\n")) {
    const entry = line.slice(3).trim();
    if (!entry) continue;
    for (const part of entry.split(" -> ")) {
      const rel = part.trim().replace(/^"|"$/g, "");
      if (rel) add(rel);
    }
  }

  return [...files].filter((f) => existsSync(join(ROOT, f)) && !isHistory(f));
}

/** Fenced blocks are commands and payloads, not prose claims. */
const prose = (text) => text.replace(/```[\s\S]*?```/g, "");

/**
 * Inline code is an identifier, not a claim — and identifiers are named by people, not by this
 * guard. On 2026-08-25 a handoff failed here because a worktree is literally NAMED
 * `merge-prs-tauri-visibility-c5660e`; the sentence said only that the folder is dirty and cannot
 * be removed. It claimed nothing about propagation, and no rewording of it would have made the
 * docs truer.
 *
 * Only the MERGE half is read outside code, and the asymmetry is the whole point. The verb of a
 * false claim is something a person writes in prose; the thing it acts on is routinely a backticked
 * path, so the worktree half still scans the entire sentence. "Merging main updates
 * `worktrees/foo`" is still caught — pinned below, alongside the branch-name case.
 */
const outsideInlineCode = (text) => text.replace(/`[^`]*`/g, " ");

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

const offendersIn = (text) =>
  sentences(text).filter(
    (s) =>
      MENTIONS_MERGE.test(outsideInlineCode(s)) &&
      MENTIONS_WORKTREE.test(s) &&
      !DENIES_PROPAGATION.test(s),
  );

describe("decision 7 — the docs must not imply a merge updates existing worktrees", () => {
  const docs = scannedDocs();

  it("scans the documents this train owns", () => {
    expect(docs).toContain(SPEC);
    expect(docs.length).toBeGreaterThan(0);
  });

  it("scans docs that are only dirty in the working tree, not just committed ones", () => {
    // bug→guard, 2026-08-26. The corpus used to come from `git diff origin/main...HEAD` ALONE, so a
    // branch sitting exactly at origin/main scanned nothing but SPEC and PLAN no matter how many
    // docs were open and edited. The failure was silent and flattering: a hand-run reported a clean
    // pass on docs/SESSION_HANDOFF.md, and the pre-push hook failed the identical assertion on
    // byte-identical text minutes later, because committing is what put the file into the corpus.
    //
    // This asserts against live `git status` rather than a fixture, so it keeps biting as the tree
    // changes and cannot rot into a tautology. On a genuinely clean tree it asserts nothing beyond
    // the corpus still being non-empty — which is the honest reading, not a hole: there is nothing
    // uncommitted to miss.
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "docs/"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter((rel) => rel.endsWith(".md") && !isHistory(rel) && existsSync(join(ROOT, rel)))
      .map((rel) => rel.replace(/\//g, "\\"));

    for (const rel of dirty) {
      expect(docs, `${rel} is edited and unscanned — the exact blind spot this guard was widened to close`).toContain(rel);
    }
    expect(docs.length).toBeGreaterThanOrEqual(dirty.length);
  });

  it("scans live documents and not the archives that merely record history", () => {
    // Both halves matter. Skipping the archives is only defensible while the exclusion stays this
    // narrow — the moment it swallows a document a future session would READ for guidance, the guard
    // has a hole rather than a scope.
    expect(docs.filter(isHistory)).toEqual([]);
    expect(isHistory(join("docs", "BACKLOG_ARCHIVE.md"))).toBe(true);
    expect(isHistory(join("docs", "archive", "RELEASE_STATE_HISTORY.md"))).toBe(true);
    expect(isHistory(SPEC)).toBe(false);
    expect(isHistory(join("docs", "WORK_CONTROL.md"))).toBe(false);
    expect(isHistory(join("docs", "BACKLOG.md"))).toBe(false);
  });

  it("still catches the claim it was written for", () => {
    // The detector is pinned separately from the corpus so that a green run can never mean "the
    // scan set narrowed to nothing" — the failure mode a scope fix invites.
    expect(offendersIn("Merging this makes the tooling readable from every worktree.")).toHaveLength(1);
    expect(offendersIn("A merge updates no existing worktree; each stays on its own commit.")).toEqual([]);
  });

  it("reads the merge half outside inline code, so a branch NAME cannot trip it", () => {
    // Positive control: naming a folder is not claiming anything about it.
    expect(
      offendersIn("The nested `.claude/worktrees/merge-prs-tauri-visibility-c5660e` cannot be removed."),
    ).toEqual([]);
    // Negative controls: the narrowing must not buy that by swallowing a real claim. The first is
    // the case the asymmetry exists for — the claim's TARGET is backticked, its verb is not.
    expect(offendersIn("Merging main updates `worktrees/foo` for you.")).toHaveLength(1);
    expect(
      offendersIn("Merging this makes `docs/WORK_CONTROL.md` readable from every worktree."),
    ).toHaveLength(1);
  });

  for (const rel of docs) {
    it(`${rel} pairs merge and worktrees only while denying propagation`, () => {
      const offenders = offendersIn(readFileSync(join(ROOT, rel), "utf8"));
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
