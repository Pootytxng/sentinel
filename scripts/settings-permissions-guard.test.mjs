// docs/superpowers/specs/2026-10-21-settings-allow-list.patch hardens the permissions of
// .claude/settings.json for the hosted lane: an allow list of exact commands and lane-namespace globs,
// and a deny list that closes every destructive git form the first draft of this patch let through.
// The hosted lane cannot write .claude/settings.json (the auto-mode classifier refuses it), so until
// the desk applies the patch this guard proves it in memory: the patch is applied by a small
// unified-diff reader (no git spawn: the tree-walk tripwire budget), the result must be valid JSON,
// and the four tables below must hold. Once the patch is in the tree the same tables run against the
// file itself.
//
// Corrected after the PR #679 exact-head review (Standards High / Spec P1): the first draft allowed
// `git push -u origin *`, `git branch *` and `git switch *`, and a glob admits everything the harness
// passes through it -- `git push -u origin main -f`, `git push -u origin HEAD:main`,
// `git push -u origin --delete claude/x`, `git push -u origin --mirror`, `git branch -a -D main` and
// `git switch --discard-changes main` all matched an allow rule and would have run without a prompt.
// The allow rules are now exact (`git diff`, `git branch -a`, `git switch main`) or scoped to the
// lane's own branch namespaces (`git push -u origin claude/*`, `codex/*`), and the deny list carries
// every destructive form under BOTH tools (Bash, PowerShell): force, `+refspec`, delete, mirror, all,
// branches, prune, no-verify, main/HEAD/refs targets, any argument after the branch, the bare push
// forms, discarding or forced switches and checkouts, forced adds, `--output` (git writing an
// arbitrary file) and `--no-verify` commits.
//
// Four tables, each a claim about ONE command under the rule model the repo's own rules already
// assume (`Bash(npm publish*)`, `Bash(gh pr merge*--delete-branch*)`): `*` matches any text, anywhere;
// a rule without `*` is exact; a deny is a hard block; a command no rule matches goes to the prompt
// (the classifier in auto mode). Compound commands and shell operators are the harness's own parsing
// and are not modelled here.
//   ORDINARY        the lane's daily commands: exactly one allow rule, no deny under either tool.
//   DENIED_FOREVER  destructive forms: at least one deny rule for Bash AND for PowerShell.
//   CLASSIFIER      neither allowed nor denied, so the prompt decides: `branch -D`, `reset --hard`,
//                   `clean`, tags, clustered short flags such as `-uf`, `worktree add`, core.hooksPath.
//   RESIDUALS       allowed on purpose, each with its reason, so a later tightening is a decision.
// Known false deny, accepted: `git push* main*` also denies a branch literally named `maintenance`;
// `git push -u origin maintenance` matches no allow rule either, so nothing is lost but a prompt.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATCH = join(ROOT, "docs/superpowers/specs/2026-10-21-settings-allow-list.patch");
const SETTINGS = join(ROOT, ".claude/settings.json");

/** The deny bodies the patch adds; each is carried under both shell tools. */
const DENY_BODIES = [
  "git push*--force*",
  "git push* -f*",
  "git push* +*",
  "git push*--delete*",
  "git push* -d*",
  "git push*--mirror*",
  "git push*--all*",
  "git push*--branches*",
  "git push*--prune*",
  "git push*--no-verify*",
  "git push* main*",
  "git push* HEAD*",
  "git push*:*",
  "git push*refs/*",
  "git push -u origin claude/* *",
  "git push -u origin codex/* *",
  "git push",
  "git push origin",
  "git push -u origin",
  "git switch*--discard-changes*",
  "git switch* -f*",
  "git switch*--force*",
  "git switch* -C*",
  "git checkout*--force*",
  "git checkout* -f*",
  "git checkout* -B*",
  "git add* -f*",
  "git add*--force*",
  "git *--output*",
  "git commit*--no-verify*",
];
export const ADDED_DENIES = DENY_BODIES.flatMap((body) => [`Bash(${body})`, `PowerShell(${body})`]);

/** The only push shapes the lane may run without a prompt: its own branch namespaces, one branch. */
const PUSH_ALLOWS = ["Bash(git push -u origin claude/*)", "Bash(git push -u origin codex/*)"];

/** command -> the ONE allow rule it hits; no deny may match it under either tool. */
const ORDINARY = [
  ["git status --porcelain", "Bash(git status*)"],
  ["git log --oneline -20", "Bash(git log*)"],
  ["git diff", "Bash(git diff)"],
  ["git diff --stat", "Bash(git diff *)"],
  ["git show HEAD --stat", "Bash(git show *)"],
  ["git rev-parse --abbrev-ref HEAD", "Bash(git rev-parse*)"],
  ["git branch --show-current", "Bash(git branch --show-current)"],
  ["git branch -a", "Bash(git branch -a)"],
  ["git branch -vv", "Bash(git branch -vv)"],
  ["git worktree list --porcelain", "Bash(git worktree list*)"],
  ["git fetch origin main", "Bash(git fetch origin *)"],
  ["git switch main", "Bash(git switch main)"],
  ["git switch claude/cloud-lane-autonomy-20261021", "Bash(git switch claude/*)"],
  ["git switch -c codex/x", "Bash(git switch -c codex/*)"],
  ["git checkout -b claude/x", "Bash(git checkout -b claude/*)"],
  ["git add -A", "Bash(git add *)"],
  ['git commit -m "docs: x"', "Bash(git commit *)"],
  ["git push -u origin claude/cloud-lane-autonomy-20261021", "Bash(git push -u origin claude/*)"],
  ["git push -u origin codex/x", "Bash(git push -u origin codex/*)"],
  ["git config --local user.name", "Bash(git config --local user.*)"],
  ["npm test -- --run x", "Bash(npm test*)"],
  ["cargo test --manifest-path src-tauri/Cargo.toml", "Bash(cargo test *)"],
  ["node scripts/scope-drift-gate.mjs --issue 678", "Bash(node scripts/scope-drift-gate.mjs *)"],
  ["node scripts/lease-overlap-gate.mjs --issue 678", "Bash(node scripts/lease-overlap-gate.mjs *)"],
  ["node --check .claude/hooks/hookspath-guard.mjs", "Bash(node --check *)"],
  ["pwsh -NoProfile -File scripts/verify-local.ps1", "Bash(pwsh -NoProfile -File scripts/verify-local.ps1*)"],
  ["gh pr view 679 --json state", "Bash(gh pr view *)"],
  ["gh issue comment 678 --body-file x.md", "Bash(gh issue comment *)"],
];

/** Every one of these must hit a deny rule under Bash AND under PowerShell. */
const DENIED_FOREVER = [
  "git push --force origin main",
  "git push origin main --force",
  "git push --force-with-lease origin claude/x",
  "git push -f origin main",
  "git push -u origin main -f",
  "git push -u origin claude/x -f",
  "git push -u origin claude/x -qf",
  "git push origin +main",
  "git push origin +refs/heads/main:refs/heads/main",
  "git push -u origin HEAD:main",
  "git push -u origin claude/x:main",
  "git push -u origin claude/x:refs/heads/main",
  "git push -u origin --delete claude/x",
  "git push origin -d claude/x",
  "git push origin :claude/x",
  "git push -u origin --mirror",
  "git push origin --all",
  "git push origin --branches",
  "git push origin --prune claude/x",
  "git push -u origin main",
  "git push origin main",
  "git push origin HEAD",
  "git push origin refs/heads/main",
  "git push",
  "git push origin",
  "git push -u origin",
  "git push -u origin claude/x --no-verify",
  "git push -u origin claude/x main",
  "git push -u origin codex/x --force-with-lease",
  "git switch --discard-changes main",
  "git switch -f main",
  "git switch claude/x --force",
  "git switch -C claude/x",
  "git checkout -f main",
  "git checkout --force main",
  "git checkout -B claude/x",
  "git add -f .env",
  "git add --force .env",
  "git log --output=/tmp/x",
  "git diff --output /tmp/x",
  "git show --output=/tmp/x HEAD",
  "git commit -m x --no-verify",
];

/** Neither allowed nor denied: the prompt decides. Clustered short flags are not modelled, so
 *  `git push -uf` is not denied, but it is not admitted either: it matches no allow rule. */
const CLASSIFIER = [
  "git branch -D claude/x",
  "git branch -a -D claude/x",
  "git branch -m claude/x claude/y",
  "git reset --hard",
  "git clean -fdx",
  "git stash drop",
  "git push origin --tags",
  "git push -u origin --tags claude/x",
  "git push -uf origin claude/x",
  "git difftool a b",
  "git switch --detach main",
  "git rebase -i main",
  "git worktree add ../x claude/x",
  "git config --local core.hooksPath /x",
];

/** command -> allow rule -> why it stays allowed. */
const RESIDUALS = [
  ["git commit --amend -m x", "Bash(git commit *)", "local only: publishing an amend needs a force push, which is denied"],
  ["git commit -n -m x", "Bash(git commit *)", "this repo has no pre-commit hook to skip; the gates run on push"],
  ["git fetch origin claude/x:refs/heads/main", "Bash(git fetch origin *)", "moves a LOCAL ref only, recoverable from the reflog; the remote is untouched"],
  ["git add -Af .env", "Bash(git add *)", "clustered short flags are not modelled; .gitignore and the push gates backstop a forced add"],
  ["gh pr comment 679 --delete-last", "Bash(gh pr comment *)", "deletes the caller's own last comment only"],
];

const TOOL_RULE = /^(Bash|PowerShell)\((.+)\)$/;

/** A rule's glob as an anchored regex: literal text escaped, `*` as any text. */
export function ruleMatcher(rule) {
  const m = TOOL_RULE.exec(rule);
  if (!m) throw new Error(`not a tool rule: ${rule}`);
  const body = m[2]
    .split("*")
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(`^${body}$`);
  return { tool: m[1], test: (command) => re.test(command) };
}

/** The rules of `tool` that match `command`. */
export function matching(rules, command, tool = "Bash") {
  return rules.filter((rule) => {
    const m = ruleMatcher(rule);
    return m.tool === tool && m.test(command);
  });
}

/** Apply a one-file unified diff to `text` in memory. Throws when a hunk's old lines are not found in order. */
export function applyUnified(text, patch) {
  const hunks = [];
  let hunk = null;
  const patchLines = patch.split("\n");
  if (patchLines[patchLines.length - 1] === "") patchLines.pop();
  for (const raw of patchLines) {
    if (raw.startsWith("@@")) {
      hunk = { old: [], neu: [] };
      hunks.push(hunk);
      continue;
    }
    if (/^(diff --git|index |--- |\+\+\+ )/.test(raw)) {
      hunk = null;
      continue;
    }
    if (!hunk || raw.startsWith("\\")) continue;
    const tag = raw[0];
    const body = raw.slice(1);
    if (raw === "" || tag === " ") {
      hunk.old.push(body);
      hunk.neu.push(body);
    } else if (tag === "-") hunk.old.push(body);
    else if (tag === "+") hunk.neu.push(body);
    else throw new Error(`unreadable patch line: ${JSON.stringify(raw)}`);
  }
  if (hunks.length === 0) throw new Error("the patch has no hunks");
  const lines = text.split("\n");
  const out = [];
  let cursor = 0;
  for (const h of hunks) {
    let at = -1;
    for (let i = cursor; i + h.old.length <= lines.length && at < 0; i++) {
      let ok = true;
      for (let j = 0; j < h.old.length; j++) {
        if (lines[i + j] !== h.old[j]) {
          ok = false;
          break;
        }
      }
      if (ok) at = i;
    }
    if (at < 0) throw new Error(`hunk does not match the file from line ${cursor + 1}: ${JSON.stringify(h.old[0])}`);
    out.push(...lines.slice(cursor, at), ...h.neu);
    cursor = at + h.old.length;
  }
  out.push(...lines.slice(cursor));
  return out.join("\n");
}

const liveSettings = JSON.parse(readFileSync(SETTINGS, "utf8"));
const liveDeny = liveSettings.permissions?.deny ?? [];
const liveAllow = liveSettings.permissions?.allow ?? [];
const APPLIED = ADDED_DENIES.every((rule) => liveDeny.includes(rule));
const patch = readFileSync(PATCH, "utf8");

/** The settings under test: the live file once the patch is in the tree, else the patch applied in memory. */
const settings = APPLIED ? liveSettings : JSON.parse(applyUnified(readFileSync(SETTINGS, "utf8"), patch));
const where = APPLIED ? ".claude/settings.json" : "patched settings (in memory)";
const allow = settings.permissions?.allow ?? [];
const deny = settings.permissions?.deny ?? [];

/** The rules the patch's `+` lines add, as the settings would hold them. */
function rulesAddedByPatch() {
  return patch
    .split("\n")
    .filter((line) => /^\+\s+"(Bash|PowerShell)\(/.test(line))
    .map((line) => line.trim().replace(/^\+\s*/, "").replace(/,$/, "").replace(/^"|"$/g, ""));
}

describe("2026-10-21-settings-allow-list.patch (T0.d): exact allows for the lane, destructive forms denied", () => {
  it("touches only .claude/settings.json", () => {
    const headers = patch.split("\n").filter((line) => line.startsWith("diff --git"));
    expect(headers).toEqual(["diff --git a/.claude/settings.json b/.claude/settings.json"]);
  });

  it("matches rules the way the repo's own rules assume: * is any text anywhere, no * is exact", () => {
    expect(matching(["Bash(gh pr merge*--delete-branch*)"], "gh pr merge 679 --delete-branch")).toHaveLength(1);
    expect(matching(["Bash(gh pr merge*--delete-branch*)"], "gh pr merge 679")).toHaveLength(0);
    expect(matching(["Bash(git push -u origin claude/*)"], "git push -u origin claude/x")).toHaveLength(1);
    expect(matching(["Bash(git push -u origin claude/*)"], "git push -u origin main")).toHaveLength(0);
    expect(matching(["Bash(git push)"], "git push")).toHaveLength(1);
    expect(matching(["Bash(git push)"], "git push origin")).toHaveLength(0);
    expect(matching(["PowerShell(git push* -f*)"], "git push -f origin main", "PowerShell")).toHaveLength(1);
    expect(matching(["PowerShell(git push* -f*)"], "git push -f origin main", "Bash")).toHaveLength(0);
    expect(matching(["Bash(npm test*)"], "npm test -- --run")).toHaveLength(1);
    expect(matching(["Bash(npm test*)"], "npm run test")).toHaveLength(0);
    expect(() => ruleMatcher("git push")).toThrow(/not a tool rule/);
  });

  it("applies in memory with a small unified-diff reader", () => {
    const text = ["a", "b", "c", "d"].join("\n");
    const diff = ["--- a/x", "+++ b/x", "@@ -1,2 +1,3 @@", " a", "-b", "+B", "+b2", "@@ -4 +5 @@", " d", "+e", ""].join("\n");
    expect(applyUnified(text, diff)).toBe(["a", "B", "b2", "c", "d", "e"].join("\n"));
    expect(() => applyUnified("a\nz", diff)).toThrow(/hunk does not match the file/);
    expect(() => applyUnified(text, "--- a/x\n+++ b/x\n")).toThrow(/no hunks/);
  });

  it.skipIf(APPLIED)("applied in memory, every live allow and deny survives and the allow list grows (until the desk applies it)", () => {
    for (const rule of liveAllow) expect(allow, `the live allow ${rule} survives`).toContain(rule);
    for (const rule of liveDeny) expect(deny, `the live deny ${rule} survives`).toContain(rule);
    expect(allow.length).toBeGreaterThan(liveAllow.length);
  });

  it(`${where}: carries every rule the patch adds, and every added deny under both tools`, () => {
    const added = rulesAddedByPatch();
    expect(added.length).toBeGreaterThan(0);
    for (const rule of added) expect([...allow, ...deny], `${where} carries ${rule}`).toContain(rule);
    for (const rule of ADDED_DENIES) expect(deny, `${where}: deny carries ${rule}`).toContain(rule);
  });

  it.each(ORDINARY)(`${where}: %j hits exactly one allow rule and no deny`, (command, rule) => {
    expect(matching(allow, command)).toEqual([rule]);
    expect(matching(deny, command, "Bash")).toEqual([]);
    expect(matching(deny, command, "PowerShell")).toEqual([]);
  });

  it.each(DENIED_FOREVER)(`${where}: %j is denied under Bash and under PowerShell`, (command) => {
    expect(matching(deny, command, "Bash")).not.toHaveLength(0);
    expect(matching(deny, command, "PowerShell")).not.toHaveLength(0);
  });

  it.each(CLASSIFIER)(`${where}: %j is neither allowed nor denied, so the prompt decides`, (command) => {
    expect(matching(allow, command)).toEqual([]);
    expect(matching(deny, command, "Bash")).toEqual([]);
  });

  it.each(RESIDUALS)(`${where}: %j stays allowed on purpose`, (command, rule, reason) => {
    expect(matching(allow, command), reason).toEqual([rule]);
    expect(matching(deny, command, "Bash"), reason).toEqual([]);
  });

  it(`${where}: the only push allows are the lane namespaces, and main is never a push target`, () => {
    expect(allow.filter((rule) => /^(Bash|PowerShell)\(git push/.test(rule)).sort()).toEqual(PUSH_ALLOWS);
    for (const target of ["main", "release/x", "maintenance", "HEAD", "origin/main", "--mirror"]) {
      expect(matching(allow, `git push -u origin ${target}`), `no allow for a push to ${target}`).toEqual([]);
    }
  });

  it(`${where}: every rule is well formed and unique, and no allow is bare git or git push`, () => {
    for (const rule of [...allow, ...deny]) {
      expect(rule, `${where}: a well-formed tool rule`).toMatch(/^(Bash|PowerShell)\(\S.*\)$/);
      expect(rule, `${where}: never a bare wildcard`).not.toMatch(/^(Bash|PowerShell)\(\*+\)$/);
    }
    for (const rule of allow) expect(rule, `${where}: never bare git or git push`).not.toMatch(/^(Bash|PowerShell)\(git( push)?\*?\)$/);
    expect(new Set(allow).size, `${where}: no duplicate allow`).toBe(allow.length);
    expect(new Set(deny).size, `${where}: no duplicate deny`).toBe(deny.length);
    for (const rule of liveDeny) expect(deny, `${where}: the live deny ${rule} survives`).toContain(rule);
  });
});
