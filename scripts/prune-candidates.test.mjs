// Guard: the delete command docs/OWNER_ACTION_CHECKLIST.md hands the owner must only name refs
// that are safe to delete.
//
// Why this exists — §A_prune said THREE dead refs for weeks while ELEVEN had gone dead (#305). An
// undercount is the cheap half of that defect: it hides work from the owner but breaks nothing. The
// expensive half is the other direction, and it is what this file guards. That section is the only
// place in the repo that tells the owner to run a DESTRUCTIVE git command against origin, on a list
// nobody re-derives before running it. One wrong name and a ref goes that was holding the only copy
// of something.
//
// The section is also the one place that has to carry an EXCLUSION: `beta/private-beta-001` answers
// YES to the same containment query every re-derivation runs, and CLAUDE.md puts the frozen beta
// refs in owner territory. A later session "completing the list" from a fresh measurement would add
// it back without ever seeing the reason it was left out. Prose alone has already failed once in
// this section, so the exclusion gets a checker.
//
// DELIBERATELY ONE-DIRECTIONAL. It proves every ref the command NAMES is safe to name. It does not
// demand the list be COMPLETE. A completeness assertion would go red the moment any PR merges — a
// newly-contained ref appears — and would block the next push in every worktree until someone
// edited a doc. That is the cross-lane treadmill #312 removed, and reintroducing it one lane later
// to catch a defect whose worst outcome is "the owner does less cleanup than he could" is a bad
// trade. The staleness direction is handled where it belongs: the section tells its reader to
// re-derive before running, because the list is point-in-time and went stale once already.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readAll } from "./lib/dispositions.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKLIST = "docs/OWNER_ACTION_CHECKLIST.md";
const DISPOSITIONS = "docs/dispositions/";

const git = (args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * The refs named in §A_prune's `git push origin --delete ...` command.
 *
 * The command is one inline-code span that WRAPS across several source lines, because eleven ref
 * names do not fit on one. So the span is read to its closing backtick and then split on
 * whitespace: a line-based parser would silently return only the first two or three names, and a
 * guard that checks three of eleven names looks exactly like a guard that checks all of them.
 *
 * Scoped to the §A_prune section rather than the whole file. Another section quoting a delete
 * command as an EXAMPLE is not an instruction to the owner, and judging it as one would make this
 * guard fail on prose it has no business reading.
 */
export function refsInPruneCommand(markdown) {
  const start = markdown.indexOf("### A_prune");
  if (start === -1) return [];
  const rest = markdown.slice(start + "### A_prune".length);
  const end = rest.indexOf("\n### ");
  const section = end === -1 ? rest : rest.slice(0, end);

  const marker = "`git push origin --delete";
  const at = section.indexOf(marker);
  if (at === -1) return [];
  const body = section.slice(at + marker.length);
  const close = body.indexOf("`");
  if (close === -1) return []; // an unterminated span is not a command; say nothing rather than guess
  return body
    .slice(0, close)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

describe("parsing", () => {
  const section = (command) =>
    ["# doc", "", "### A_prune. heading", "", command, "", "### B. next", ""].join("\n");

  it("reads a command that wraps across lines, not just its first line", () => {
    const doc = section("**The ask:** `git push origin --delete lane/a\nlane/b lane/c`. Because.");
    expect(refsInPruneCommand(doc)).toEqual(["lane/a", "lane/b", "lane/c"]);
  });

  it("says nothing when there is no section, no command, or no closing backtick", () => {
    expect(refsInPruneCommand("# doc\n\nno section here\n")).toEqual([]);
    expect(refsInPruneCommand(section("**The ask:** ask the owner nicely."))).toEqual([]);
    expect(refsInPruneCommand(section("**The ask:** `git push origin --delete lane/a"))).toEqual([]);
  });

  it("stops at the section boundary, so a later section's example is not read as an instruction", () => {
    const doc = [
      "### A_prune. heading",
      "",
      "`git push origin --delete lane/a`",
      "",
      "### B. other",
      "",
      "`git push origin --delete lane/DANGER`",
      "",
    ].join("\n");
    expect(refsInPruneCommand(doc)).toEqual(["lane/a"]);
  });
});

describe("the live checklist", () => {
  const checklist = readFileSync(join(ROOT, CHECKLIST), "utf8");
  const named = refsInPruneCommand(checklist);

  it("names refs at all — an empty list must not read as safety", () => {
    // Non-vacuity first. Every assertion below is trivially true of an empty list, so a parser that
    // broke would turn this whole file green while the command it guards went unchecked.
    expect(
      named.length,
      `${CHECKLIST} §A_prune: no refs parsed out of the delete command. Either the section stopped ` +
        `carrying one, or its shape changed and this parser is now reading nothing.`,
    ).toBeGreaterThan(0);
    const malformed = named.filter((n) => !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(n));
    expect(
      malformed,
      `§A_prune's command contains ${malformed.length} token(s) that are not ref names: ${malformed.join(" ")}`,
    ).toEqual([]);
  });

  it("never names a ref the disposition record says to PRESERVE", () => {
    // The frozen beta ref is pinned BY NAME as well as by rule. The rule is the general guard; the
    // name is here because CLAUDE.md puts `beta/private-beta-001` (16069fa) in owner territory
    // explicitly, and a reader hitting this failure should not have to derive which ref it means.
    expect(named, "§A_prune must never tell the owner to delete the frozen beta ref.").not.toContain(
      "beta/private-beta-001",
    );

    // One file per ref since #291, so this reads a directory rather than a table — and a record
    // the store itself refuses is not a PRESERVE argument anyone can rely on.
    const { records, problems } = readAll(ROOT);
    expect(problems, `${DISPOSITIONS} holds records the store refuses`).toEqual([]);
    const preserve = records
      .filter((r) => r.disposition === "PRESERVE")
      .map((r) => r.ref.replace(/^origin\//, ""));
    expect(
      preserve.length,
      `${DISPOSITIONS} holds no PRESERVE record, so this check would pass vacuously.`,
    ).toBeGreaterThan(0);
    const wrong = named.filter((n) => preserve.includes(n));
    expect(
      wrong,
      `§A_prune names ${wrong.length} ref(s) that ${DISPOSITIONS} marks PRESERVE: ${wrong.join(", ")}.\n` +
        `PRESERVE means a record has already argued that ref must survive. The checklist and the record ` +
        `cannot both be right — fix whichever is wrong BEFORE the owner runs the command.`,
    ).toEqual([]);
  });

  it("names nothing whose commits exist only at origin — the checklist's own premise, checked", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    // §A_prune's justification for naming refs that are NOT ancestors of main is that "the local
    // refs and their clean worktrees still hold every commit, so any of them can be pushed back in
    // one command". That is a factual claim about this machine, it is the entire reason the ask is
    // safe to hand over, and until now nothing checked it. Here it is checked.
    //
    // Measured against LOCAL refs only — refs/heads (every worktree's branches), refs/backup and
    // tags. That is deliberately narrower than "some other origin ref covers it": the question is
    // what survives on this disk once origin drops the name, which is what the sentence promises.
    const local = git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/backup", "refs/tags"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(
      local.length,
      "no local refs at all — this checkout cannot answer the question, so it must not answer it green.",
    ).toBeGreaterThan(0);

    const unmeasured = [];
    const stranded = [];
    for (const ref of named) {
      // A name with no cached origin ref is UNMEASURED, not safe. Counting it as fine is how this
      // guard would quietly stop guarding after a fetch that never happened.
      try {
        git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${ref}^{commit}`]);
      } catch {
        unmeasured.push(ref);
        continue;
      }
      const count = Number(git(["rev-list", "--count", `refs/remotes/origin/${ref}`, "--not", ...local]));
      if (count > 0) stranded.push(`${ref} (+${count})`);
    }

    expect(
      unmeasured,
      `§A_prune names ${unmeasured.length} ref(s) this checkout holds no cached origin ref for: ` +
        `${unmeasured.join(", ")}.\nThat is an unanswered question, not a safe name. Run ` +
        `\`git fetch origin --prune\` and re-run; a name that survives the prune is already gone from ` +
        `origin and the command will error on it.`,
    ).toEqual([]);
    expect(
      stranded,
      `§A_prune names ${stranded.length} ref(s) holding commits that NO local ref reaches: ` +
        `${stranded.join(", ")}.\nDeleting those at origin destroys the only copy, which is exactly ` +
        `what the section promises cannot happen. Either the name does not belong in that command, or ` +
        `those commits need a local ref before it is run.`,
    ).toEqual([]);
  });
});
