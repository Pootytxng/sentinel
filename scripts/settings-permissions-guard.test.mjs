// docs/superpowers/specs/2026-10-21-settings-allow-list.patch widens the hosted allow list of
// .claude/settings.json and adds the force-push denies (`--force`, `-f`, `+refspec`). The hosted lane
// cannot write .claude/settings.json (the auto-mode classifier refuses it), so until the desk applies the
// patch this guard proves it in memory: the patch is applied here by a small unified-diff reader (no git
// spawn: the tree-walk tripwire budget), the result must be valid JSON, every force push must hit a deny
// for both tools, and an ordinary `git push -u origin <branch>` must hit exactly the one allow rule and
// no deny. Once the patch is in the tree the in-memory test stands down and the skipped live-settings
// block runs against the file itself.
//
// Rule matching here follows the semantics the repo's own rules already assume (`Bash(npm publish*)`,
// `Bash(gh pr merge*--delete-branch*)`): `*` matches any text, anywhere in the command.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATCH = join(ROOT, "docs/superpowers/specs/2026-10-21-settings-allow-list.patch");
const SETTINGS = join(ROOT, ".claude/settings.json");

export const FORCE_DENIES = [
  "Bash(git push*--force*)",
  "PowerShell(git push*--force*)",
  "Bash(git push*-f *)",
  "PowerShell(git push*-f *)",
  "Bash(git push* +*)",
  "PowerShell(git push* +*)",
];

const FORCE_PUSHES = [
  "git push --force origin main",
  "git push origin main --force",
  "git push --force-with-lease origin claude/x",
  "git push -f origin main",
  "git push origin +main",
  "git push origin +refs/heads/main:refs/heads/main",
];

const ORDINARY_PUSHES = ["git push -u origin claude/cloud-lane-autonomy-20261021", "git push -u origin codex/x"];

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
const APPLIED = FORCE_DENIES.every((rule) => liveDeny.includes(rule));

/** What the hardened settings must hold, live or in memory. */
function expectHardened(settings, where) {
  const allow = settings.permissions?.allow ?? [];
  const deny = settings.permissions?.deny ?? [];
  for (const rule of FORCE_DENIES) expect(deny, `${where}: deny carries ${rule}`).toContain(rule);
  for (const push of FORCE_PUSHES) {
    expect(matching(deny, push, "Bash"), `${where}: Bash deny matches ${JSON.stringify(push)}`).not.toHaveLength(0);
    expect(matching(deny, push, "PowerShell"), `${where}: PowerShell deny matches ${JSON.stringify(push)}`).not.toHaveLength(0);
  }
  for (const push of ORDINARY_PUSHES) {
    expect(matching(allow, push), `${where}: allow matches ${JSON.stringify(push)}`).toEqual(["Bash(git push -u origin *)"]);
    expect(matching(deny, push), `${where}: no deny matches ${JSON.stringify(push)}`).toEqual([]);
  }
  for (const rule of allow) {
    expect(rule, `${where}: a well-formed tool rule`).toMatch(/^(Bash|PowerShell)\(\S.*\)$/);
    expect(rule, `${where}: never a bare wildcard`).not.toMatch(/^(Bash|PowerShell)\(\*+\)$/);
    expect(rule, `${where}: never bare git or git push`).not.toMatch(/^(Bash|PowerShell)\(git( push)?\*?\)$/);
  }
  for (const rule of liveDeny) expect(deny, `${where}: the live deny ${rule} survives`).toContain(rule);
}

describe("2026-10-21-settings-allow-list.patch (T0.d): force pushes are denied, ordinary pushes allowed", () => {
  const patch = readFileSync(PATCH, "utf8");

  it("touches only .claude/settings.json", () => {
    const headers = patch.split("\n").filter((line) => line.startsWith("diff --git"));
    expect(headers).toEqual(["diff --git a/.claude/settings.json b/.claude/settings.json"]);
  });

  it("matches rules the way the repo's own rules assume: * is any text, anywhere", () => {
    expect(matching(["Bash(gh pr merge*--delete-branch*)"], "gh pr merge 679 --delete-branch")).toHaveLength(1);
    expect(matching(["Bash(gh pr merge*--delete-branch*)"], "gh pr merge 679")).toHaveLength(0);
    expect(matching(["Bash(git push -u origin *)"], "git push -u origin claude/x")).toHaveLength(1);
    expect(matching(["Bash(git push -u origin *)"], "git push origin claude/x")).toHaveLength(0);
    expect(matching(["PowerShell(git push*-f *)"], "git push -f origin main", "PowerShell")).toHaveLength(1);
    expect(matching(["PowerShell(git push*-f *)"], "git push -f origin main", "Bash")).toHaveLength(0);
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

  it.skipIf(APPLIED)("applied to the live settings in memory, the result is valid JSON that denies every force push (until the desk applies it)", () => {
    const patched = JSON.parse(applyUnified(readFileSync(SETTINGS, "utf8"), patch));
    expectHardened(patched, "patched settings");
    const allow = patched.permissions.allow;
    for (const rule of liveAllow) expect(allow, `the live allow ${rule} survives`).toContain(rule);
    for (const rule of ["Bash(npm test*)", "Bash(cargo test *)", "Bash(node scripts/scope-drift-gate.mjs *)", "Bash(node scripts/lease-overlap-gate.mjs *)"]) {
      expect(allow, `the patch adds ${rule}`).toContain(rule);
    }
    expect(allow.length).toBeGreaterThan(liveAllow.length);
  });

  describe.skipIf(!APPLIED)("the live settings carry the patch", () => {
    it("deny every force push and allow an ordinary push through one rule", () => {
      expectHardened(liveSettings, ".claude/settings.json");
    });
    it("hold every allow rule the patch names", () => {
      const added = patch
        .split("\n")
        .filter((line) => /^\+\s+"(Bash|PowerShell)\(/.test(line))
        .map((line) => line.trim().replace(/^\+\s*/, "").replace(/,$/, "").replace(/^"|"$/g, ""));
      for (const rule of added) expect([...liveAllow, ...liveDeny], `live settings carry ${rule}`).toContain(rule);
    });
  });
});
