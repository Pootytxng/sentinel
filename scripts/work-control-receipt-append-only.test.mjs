// Guard: a transition receipt is added once and never edited or deleted (#307).
//
// 2026-09-26. `docs/WORK_CONTROL.md` says receipts "are only ever added under per-transition names",
// and #538's lease carve-out rests on that. Nothing enforced it. The first cut of the #307 fix
// (PR #580 at 829a9f2a) rewrote `independentReview.reviewer` inside the #290 receipt that `main`
// already held. Every existing gate let it through:
// - `work-control-receipt-preservation.test.mjs` accepts a blob committed on any ref;
// - the work-control gate validates only the receipt a transition submits;
// - the release-receipt guard reads `docs/release-receipts`, not this directory.
// Codex's review of that head found it. A proof record that can be rewritten after the fact proves
// only what its last editor wanted it to say.
//
// THE RULE. Every `.claude/work-control/*.json` held by the merge-base of HEAD and `origin/main`
// must still be in the working tree, byte for byte. A wrong receipt is corrected by ADDING a dated
// `<date>-correct-<receipt>.json`; `work-control-receipt-reviewer-claims.test.mjs` defines its shape.
//
// WHY THE MERGE-BASE AND NOT `origin/main`. A receipt that `main` added after this lane branched is
// not this lane's to hold yet. Comparing against `origin/main` itself would redden every lane that
// is behind, which is most of them, most of the time. Edits that `main`'s history already holds are
// part of the base and are not re-litigated: #178's receipt was deleted on 2026-08-20, and the #220
// and #277 receipts were edited in place between 2026-08-25 and 2026-09-01.
//
// TWO GIT PROCESSES. `git diff <base>` compares that commit with the working tree, so a committed,
// a staged and an unstaged edit all count, and git applies its own line-ending rules. `--no-renames`
// makes a rename read as a deletion plus an addition. An unresolvable `origin/main` throws, which
// fails the test rather than counting as zero findings.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });

const RECEIPT = /^\.claude\/work-control\/[^/]+\.json$/i;

// Each receipt that a `git diff --name-status` listing shows as anything but added.
export function rewrittenReceipts(listing) {
  return String(listing)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([status, path]) => status !== "A" && RECEIPT.test(path ?? ""))
    .map(([status, path]) => `${status} ${path}`);
}

describe("a transition receipt is added once and never edited or deleted (#307)", () => {
  it("reads a listing: an added receipt passes; an edit, a deletion or a type change fails", () => {
    const listing = [
      "A\t.claude/work-control/2026-09-26-correct-merge-pr-290.json",
      "M\t.claude/work-control/2026-09-01-merge-pr-290.json",
      "D\t.claude/work-control/2026-08-20-merge-pr-159.json",
      "T\t.claude/work-control/2026-08-21-close-issue-160.json",
      "M\t.claude/work-control/README.md",
      "M\t.claude/work-control/nested/x.json",
      "M\tscripts/fixture.json",
      "",
    ].join("\n");
    expect(rewrittenReceipts(listing)).toEqual([
      "M .claude/work-control/2026-09-01-merge-pr-290.json",
      "D .claude/work-control/2026-08-20-merge-pr-159.json",
      "T .claude/work-control/2026-08-21-close-issue-160.json",
    ]);
  });

  it("every receipt the merge-base with origin/main holds is still here, byte for byte", () => {
    const base = git(["merge-base", "HEAD", "origin/main"]).trim();
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    const listing = git(["diff", "--no-renames", "--name-status", base, "--", ".claude/work-control/"]);
    expect(
      rewrittenReceipts(listing),
      "a receipt is never edited or deleted; correct it by adding a dated <date>-correct-<receipt>.json",
    ).toEqual([]);
  });
});
