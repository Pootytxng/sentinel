// #337: GitHub CLOSES any open pull request whose BASE branch is deleted -- no warning, no
// question, and the closed PR reads as abandoned. A MERGED or SUPERSEDED record is an instruction
// to prune its ref (branch-disposition-audit.mjs fails while the ref is still on origin), so the
// moment a writer records one is the moment before the prune. This is the only moment the order
// is actionable: RETARGET every open PR based on the ref, THEN delete it. It nearly fired on
// 2026-09-02 (PR #315 made lane/receipt-modified-309 MERGED while PR #316 was based on it) and
// was caught by hand. Now it is caught here, at the push that records the merge.
//
// The check needs one network read (the open-PR list). When gh cannot answer, the live test is
// SKIPPED WITH ITS REASON PRINTED -- never passed -- so it is not the vacuous-pass class of #330.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DISPOSITIONS, readAll } from "./lib/dispositions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Pootytxng/sentinel";

export const bareRef = (ref) => (String(ref).startsWith("origin/") ? String(ref).slice("origin/".length) : String(ref));
export const retargetCommand = (pr) => `gh pr edit ${pr} --repo ${REPO} --base main`;

/**
 * Every record whose word means prunable, with the open PRs a prune would close. A PR whose HEAD
 * is the ref is untouched by a prune (its commits stay on the PR) and is not counted.
 */
export function dependentPullRequests(records, openPrs) {
  const out = [];
  for (const r of records ?? []) {
    if (!DISPOSITIONS[r.disposition]?.prunable) continue;
    const ref = bareRef(r.ref);
    const prs = (openPrs ?? []).filter((p) => p.baseRefName === ref).map((p) => p.number);
    if (prs.length) out.push({ ref: r.ref, disposition: r.disposition, prs });
  }
  return out;
}

/** The open PRs, or null with the reason gh could not answer. */
export function readOpenPullRequests(exec = execFileSync) {
  try {
    const raw = exec(
      "gh",
      ["pr", "list", "--repo", REPO, "--state", "open", "--json", "number,baseRefName,headRefName", "--limit", "200"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 },
    );
    return { prs: JSON.parse(raw), reason: null };
  } catch (e) {
    return { prs: null, reason: `gh could not list open PRs: ${String(e?.message ?? e).split("\n")[0]}` };
  }
}

export function describeHits(hits) {
  return hits
    .map((h) => `${h.ref} is recorded ${h.disposition} (prunable) while open PR${h.prs.length === 1 ? "" : "s"} ${h.prs.map((n) => `#${n}`).join(", ")} ${h.prs.length === 1 ? "is" : "are"} based on it -- retarget first: ${h.prs.map(retargetCommand).join("; ")}`)
    .join("\n");
}

describe("prune order (#337): retarget every open PR based on a prunable ref before it is deleted", () => {
  const records = [
    { ref: "origin/lane/a", disposition: "MERGED" },
    { ref: "origin/lane/b", disposition: "SUPERSEDED" },
    { ref: "origin/lane/c", disposition: "PRESERVE" },
    { ref: "origin/lane/d", disposition: "UNLANDED" },
    { ref: "origin/lane/e", disposition: "LANDED" },
  ];
  const open = [
    { number: 316, baseRefName: "lane/a", headRefName: "lane/docs-310" },
    { number: 9, baseRefName: "lane/c", headRefName: "lane/x" },
    { number: 10, baseRefName: "main", headRefName: "lane/b" },
    { number: 11, baseRefName: "lane/e", headRefName: "lane/y" },
  ];

  it("names the PR a prune would close, for both words that mean prunable, and nothing else", () => {
    expect(dependentPullRequests(records, open)).toEqual([{ ref: "origin/lane/a", disposition: "MERGED", prs: [316] }]);
    const twoWords = [...records, { ref: "origin/lane/f", disposition: "SUPERSEDED" }];
    const withF = [...open, { number: 12, baseRefName: "lane/f", headRefName: "lane/z" }, { number: 13, baseRefName: "lane/f", headRefName: "lane/w" }];
    expect(dependentPullRequests(twoWords, withF)).toEqual([
      { ref: "origin/lane/a", disposition: "MERGED", prs: [316] },
      { ref: "origin/lane/f", disposition: "SUPERSEDED", prs: [12, 13] },
    ]);
  });

  it("a PR whose HEAD is the ref is not a dependent -- a prune leaves its commits on the PR", () => {
    expect(dependentPullRequests([{ ref: "origin/lane/b", disposition: "SUPERSEDED" }], open)).toEqual([]);
  });

  it("the cure names the retarget, never the delete", () => {
    const text = describeHits(dependentPullRequests(records, open));
    expect(text).toContain("gh pr edit 316 --repo Pootytxng/sentinel --base main");
    expect(text).not.toContain("--delete");
  });

  it("reads the open-PR list through gh, and answers null WITH A REASON when it cannot", () => {
    const seen = [];
    const ok = readOpenPullRequests((cmd, args) => {
      seen.push([cmd, args]);
      return JSON.stringify([{ number: 1, baseRefName: "main", headRefName: "lane/q" }]);
    });
    expect(ok).toEqual({ prs: [{ number: 1, baseRefName: "main", headRefName: "lane/q" }], reason: null });
    expect(seen[0][0]).toBe("gh");
    expect(seen[0][1].slice(0, 2)).toEqual(["pr", "list"]);
    expect(seen[0][1]).toContain("--state");
    expect(seen[0][1][seen[0][1].indexOf("--state") + 1]).toBe("open");
    const down = readOpenPullRequests(() => {
      throw new Error("gh: command not found");
    });
    expect(down.prs).toBeNull();
    expect(down.reason).toMatch(/gh could not list open PRs: gh: command not found/);
  });

  it("live: no open PR is based on a ref the live records call prunable", (ctx) => {
    const live = readOpenPullRequests();
    if (live.prs === null) {
      // A skip that says why: the reader can tell "gh was down" from "nothing was checked".
      console.warn(`SKIPPED (#337): ${live.reason}`);
      ctx.skip(live.reason);
      return;
    }
    const { records } = readAll(ROOT);
    const hits = dependentPullRequests(records, live.prs);
    expect(hits, describeHits(hits)).toEqual([]);
  });
});
