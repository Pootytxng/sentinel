// #484 and #485: two lexer gaps in `.claude/hooks/shell-ownership-assert.mjs` that let a literal
// sibling write through the shell guard, both found in the review of PR #480.
//
//   #484  echo hi `rm -rf <sibling>/src`     main: ALLOW   ($( … ) spelling: DENY)
//   #485  echo hi >| <sibling>/x.txt         main: ALLOW   (>, >>, 1>, &>> spellings: DENY)
//
// A backtick was not a substitution to `lex`: its body folded into ordinary words and no stage ever
// analyzed the `rm`. A `$( … )` or backtick INSIDE double quotes was the same, and quoting is a
// one-keystroke bypass of any fix that stops at the unquoted form, so it is in this slice too.
// `>|` matched as `>` then `|`; the pipe ended the segment, and the target became the next
// segment's verb instead of a redirect operand.
//
// The hook is owner-hands (#368), so the fix ships as a patch that the owner applies:
// docs/superpowers/specs/2026-09-27-shell-lexer-backtick-clobber-484-485.patch. It also flips one
// pinned expectation in `shell-ownership-assert.test.mjs` (the reviewer's backtick repro there was
// pinned as "defers"; once the body is analyzed it denies, like the `$( … )` spelling beside it).
// Until it is applied the block below is skipped and the first test proves the patch still applies.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ZONES, isWithin, resolveAbsolute } from "../../.claude/hooks/target-ownership.mjs";
import { analyze, decideShell, lex } from "../../.claude/hooks/shell-ownership-assert.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PATCH = join(REPO, "docs", "superpowers", "specs", "2026-09-27-shell-lexer-backtick-clobber-484-485.patch");

// The patch adds no export, so "applied" is read from the behaviour it adds: `>|` is one operator.
const applied = lex("echo hi >| x").some((t) => t.type === "op" && t.value === ">|");

const BASE = resolve("/", "home", "compy-fixture");
const ROOT = join(BASE, "lane");
const SIB = join(BASE, "sentinel");
const fwd = (p) => p.replace(/\\/g, "/");
const inRoot = (rel) => fwd(join(ROOT, rel));
const inSib = (rel) => fwd(join(SIB, rel));

const fakeZone = ({ target, cwd }) => {
  const abs = resolveAbsolute(target, cwd);
  if (!abs) return { zone: ZONES.UNKNOWN, abs: null, owner: null, why: "the fixture cannot place it" };
  if (isWithin(abs, SIB)) return { zone: ZONES.SIBLING, abs, owner: SIB, why: "fixture: another checkout of this repository" };
  if (isWithin(abs, ROOT)) return { zone: ZONES.OWN, abs, owner: ROOT, why: "fixture: inside the session root" };
  return { zone: ZONES.UNPROTECTED, abs, owner: null, why: "fixture: outside every fixture root" };
};

const VERIFIED = () => ({ ok: true, root: ROOT, issue: 484, branch: "lane/lexer-484" });
const ask = (command) =>
  decideShell({ toolName: "Bash", toolInput: { command }, sessionRoot: ROOT, cwd: ROOT, verify: VERIFIED, zone: fakeZone, home: join(BASE, "userhome"), env: {} });
const tick = (body) => "`" + body + "`";

describe("#484/#485: backtick substitutions and the >| clobber redirect", () => {
  it("the owner-hand patch still applies to the hook as it is — and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch this block names must exist until it is applied").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  describe.skipIf(applied)("before the patch: the fixture reproduces both defects", () => {
    it("allows the issues' literal repros, which is the defect", () => {
      expect(ask(`echo hi ${tick(`rm -rf ${inSib("src")}`)}`).permission).toBe("allow");
      expect(ask(`echo hi >| ${inSib("x.txt")}`).permission).toBe("allow");
    });
  });

  describe.skipIf(!applied)("once applied", () => {
    it("#484: denies a sibling write hidden in a backtick substitution, as it denies $( … )", () => {
      const tree = inSib("src");
      for (const cmd of [
        `echo hi $(rm -rf ${tree})`, // the spelling that never leaked, pinned beside the fixed ones
        `echo hi ${tick(`rm -rf ${tree}`)}`,
        `echo hi${tick(`rm -rf ${tree}`)}`,
        `x=${tick(`rm -rf ${tree}`)}`,
        `echo "${tick(`rm -rf ${tree}`)}"`,
        `echo "$(rm -rf ${tree})"`,
        `echo "a $(echo b; rm -rf ${tree}) c"`,
        `echo hi ${tick(`echo ok > ${inSib("x.txt")}`)}`,
        `echo "$(printf '%s' ')' > ${inSib("x.txt")})"`, // a quoted `)` does not close it early
      ]) {
        expect(ask(cmd).permission, cmd).toBe("deny");
      }
    });

    it("#485: denies a sibling write through the clobber redirect in every spelling", () => {
      for (const cmd of [
        `echo hi >| ${inSib("x.txt")}`,
        `echo hi >|${inSib("x.txt")}`,
        `echo hi 1>| ${inSib("x.txt")}`,
        `echo hi 2>| ${inSib("x.txt")}`,
        `cd "${fwd(ROOT)}" && echo hi >| ${inSib("x.txt")}`,
      ]) {
        expect(ask(cmd).permission, cmd).toBe("deny");
      }
      expect(analyze(`echo hi >| ${inSib("x.txt")}`, { cwd: ROOT }).ops.map((o) => o.target)).toContain(inSib("x.txt"));
    });

    it("does not deny what never reaches a sibling — the false-deny probes", () => {
      for (const cmd of [
        `echo hi >| ${inRoot("x.txt")}`,
        `echo "today is $(date)"`,
        `echo today is ${tick("date")}`,
        `cd "$(git rev-parse --show-toplevel)" && ls`,
        `echo 'literal ${tick(`rm -rf ${inSib("src")}`)} in single quotes'`,
        'echo "escaped \\` backtick"',
        `git log --oneline -1 "$(git rev-parse HEAD)"`,
        `echo hi ${tick(`echo ok > ${inRoot("x.txt")}`)}`,
      ]) {
        expect(ask(cmd).permission, cmd).toBe("allow");
      }
    });

    it("lexes a substitution as a `(`…`)` group after the word that carries it, and keeps the word dynamic", () => {
      const toks = lex(`echo "a $(rm x) b"`);
      expect(toks.map((t) => (t.type === "op" ? `[${t.value}]` : t.value))).toEqual(["echo", "a $(rm x) b", "[(]", "rm", "x", "[)]"]);
      expect(toks[1].dynamic).toBe(true);
      // Inside backticks `\`` is a nested backtick and `\\` a backslash, as the shell reads them.
      expect(lex("echo `echo \\`x\\``").filter((t) => t.type === "word").map((t) => t.value)).toContain("echo");
      // An unclosed substitution is still analyzed, to the end of the text.
      expect(lex("echo `rm y").map((t) => t.value)).toEqual(["echo", "`rm y", "(", "rm", "y", ")"]);
    });

    it("leaves the PowerShell dialect's backtick as its escape character", () => {
      expect(lex("Write-Host a`$b", "powershell").map((t) => t.value)).toEqual(["Write-Host", "a$b"]);
    });
  });
});
