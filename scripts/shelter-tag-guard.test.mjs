// @vitest-environment node
//
// bug->guard, 2026-08-25. `docs/OWNER_ACTION_CHECKLIST.md` carried a row telling the owner that
// 1,100 lines of finished safety code (#128) were "never published" and waiting on one word from
// him. They were not. The commit had been on `main` since 2026-08-21 — merged as `bf8e2e6e`, then
// hardened by `38279f95`. The row was re-derived on 2026-08-25 from the shelter tag
// `preserve/local-collision-guard-707572f1` without anyone checking whether that commit was already
// an ancestor of `origin/main`. It was.
//
// That is the whole failure mode, and it is a nasty one: a shelter tag is a promise that work is
// SAFE, and it reads exactly like a promise that work is PENDING. Nothing distinguishes the two by
// eye, so a stale ask can sit on the owner's list for a week — and the owner keeps no notes, so it
// only gets caught if a session happens to look. This guard makes git answer the question instead.
//
// THE RULE: a `preserve/*` tag exists to protect work that is NOT on `main`. The moment its commit
// is reachable from `origin/main`, the shelter is SPENT — the tag should be deleted, and so should
// any doc row claiming that work is unpublished. This test fails until that cleanup happens.
//
// Deliberately advisory when git cannot answer (a shallow clone, no `origin/main` ref): a guard
// that fails on a missing remote ref would fail in every environment except this machine, and a
// guard people learn to ignore is worse than none.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

const mainRef = ["origin/main", "main"].find((r) => tryGit("rev-parse", "--verify", `${r}^{commit}`) !== null);
const shelterTags = (tryGit("tag", "--list", "preserve/*") ?? "").split("\n").filter(Boolean);

describe("shelter tags (bug->guard 2026-08-25, the stale #128 owner ask)", () => {
  it("can resolve the main branch it measures against", () => {
    // If this is the only failure, the environment is the problem, not the tags. Everything below
    // skips itself rather than reporting a false clean.
    expect(mainRef, "neither origin/main nor main resolves — the shelter checks below are inert").not
      .toBeUndefined();
  });

  it("keeps no shelter tag whose work has already landed on main", () => {
    if (!mainRef || shelterTags.length === 0) return;
    const landed = shelterTags.filter(
      (t) => tryGit("merge-base", "--is-ancestor", `${t}^{commit}`, mainRef) !== null,
    );
    expect(
      landed,
      `these shelter tags point at commits that are already on ${mainRef}: ${landed.join(", ")}. ` +
        `A preserve/* tag is a promise that work is SAFE, and it reads exactly like a promise that ` +
        `work is PENDING — which is how #128 spent a week on the owner's checklist as "never ` +
        `published" while it was live in every gate. Delete the spent tag (\`git tag -d <tag>\`), ` +
        `and delete any doc row that says its work is waiting.`,
    ).toEqual([]);
  });

  it("never lets a live doc call a landed shelter tag unpublished", () => {
    if (!mainRef || shelterTags.length === 0) return;
    // The tag check above is the primary. This is the second half of the same fact: even with the
    // tag correctly retired, the SENTENCE it produced can outlive it, and the sentence is what the
    // owner actually reads.
    const docs = [
      "docs/OWNER_ACTION_CHECKLIST.md",
      "docs/SESSION_HANDOFF.md",
      "docs/BACKLOG.md",
      "docs/BRANCH_DISPOSITIONS.md",
    ];
    const claim = /never (?:been )?(?:pushed|published)|unpushed|stranded local|not on `?main`?|local[- ]only/i;

    const offenders = [];
    for (const tag of shelterTags) {
      if (tryGit("merge-base", "--is-ancestor", `${tag}^{commit}`, mainRef) === null) continue;
      const shortSha = tag.split("-").pop();
      for (const doc of docs) {
        let text;
        try {
          text = readFileSync(join(root, doc), "utf8");
        } catch {
          continue;
        }
        for (const line of text.split("\n")) {
          // A line may NAME the retired tag while explaining that it landed — that is the
          // correction, not the defect. Only a line that names it AND still claims it is unshipped
          // counts, and a line that says it landed is exonerated outright.
          if (!line.includes(tag) && !(shortSha && line.includes(shortSha))) continue;
          if (!claim.test(line)) continue;
          if (/landed|is on `?main`?|already an ancestor|withdrawn|✅/i.test(line)) continue;
          offenders.push(`${doc}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(
      offenders,
      `a live doc still calls landed work unpublished:\n${offenders.join("\n")}\n` +
        `The owner keeps no notes, so a stale ask on his checklist is invisible until a session ` +
        `happens to check git. Correct the sentence, do not just retire the tag.`,
    ).toEqual([]);
  });
});
