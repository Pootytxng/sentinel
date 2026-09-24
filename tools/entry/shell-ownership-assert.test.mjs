// Guard for the shell-side one-writer rule (#278) — spec
// docs/superpowers/specs/2026-08-31-target-ownership-across-tools.md §4–§6.
//
// The claim under test is narrow and worth stating exactly: choosing a different TOOL does not
// change who may write. `Edit` refused into another checkout and `sed -i` reaching the same file was
// the whole defect, so the matrix below runs the same target through the shell and expects the same
// answer — plus the two failure modes that would make this guard worse than none: a false DENY on
// ordinary work, and a silent ALLOW on something it merely failed to parse.
//
// ZONES ARE FAKED ON PURPOSE. Where a path lives is proved against real repositories in
// `target-ownership.test.mjs`. Here the question is what the checker DECIDES once a zone is known, so
// the resolver is injected and the fixtures are strings. Nothing in this file touches a live
// checkout, the real `~/.claude`, the Work Control board, or the verification store.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ZONES, isWithin, resolveAbsolute, toComparable } from "../../.claude/hooks/target-ownership.mjs";
import {
  OFF_SWITCH,
  PREFIX_VERBS,
  SHELL_TOOLS,
  analyze,
  decideShell,
  emit,
  embeddedPaths,
  gitIsReadOnly,
  lex,
  run,
  segments,
  stripHeredocs,
} from "../../.claude/hooks/shell-ownership-assert.mjs";
// Namespace import as well: `expandKnownVars` (#373) is owner-hands until he applies the patch, and a
// named import of an export that is not there yet would refuse to load the whole file.
import * as hook from "../../.claude/hooks/shell-ownership-assert.mjs";

// `/home/...` so the fixture paths match the embedded-path scan on BOTH platforms: on Windows
// `resolve` gives `C:\home\…` (drive-letter form) and on Linux the literal `/home/…` form.
const BASE = resolve("/", "home", "compy-fixture");
const ROOT = join(BASE, "lane"); // this session's claim
const SIB = join(BASE, "sentinel"); // another checkout of the same repository
const HOME = join(BASE, "userhome");
const HOME_CLAUDE = join(HOME, ".claude");
const SCRATCH = join(BASE, "scratch");

/** Forward slashes: a spelling both dialects lex without escape rules, and both OSes resolve. */
const fwd = (p) => p.replace(/\\/g, "/");
const inRoot = (rel) => fwd(join(ROOT, rel));
const inSib = (rel) => fwd(join(SIB, rel));

const ZONE_TABLE = [
  [HOME_CLAUDE, ZONES.GLOBAL],
  [ROOT, ZONES.OWN],
  [SIB, ZONES.SIBLING],
  [SCRATCH, ZONES.UNPROTECTED],
];

const fakeZone = ({ target, cwd }) => {
  const abs = resolveAbsolute(target, cwd);
  if (!abs) return { zone: ZONES.UNKNOWN, abs: null, owner: null, why: "the fixture cannot place it" };
  for (const [prefix, zone] of ZONE_TABLE) {
    if (isWithin(abs, prefix)) return { zone, abs, owner: prefix, why: `fixture: inside ${prefix}` };
  }
  return { zone: ZONES.UNPROTECTED, abs, owner: null, why: "fixture: outside every fixture root" };
};

const VERIFIED = () => ({ ok: true, root: ROOT, issue: 278, branch: "lane/shell-ownership-278" });
const UNCLAIMED = () => ({ ok: false, code: "FOLDER_UNCLAIMED", reason: "no issue claims this folder" });
const MISMATCH = () => ({ ok: false, code: "BRANCH_MISMATCH", reason: "the claim names another branch" });

const ask = (command, over = {}) =>
  decideShell({
    toolName: "Bash",
    toolInput: { command },
    sessionRoot: ROOT,
    cwd: ROOT,
    verify: VERIFIED,
    zone: fakeZone,
    home: HOME,
    env: {},
    ...over,
  });

describe("the proof matrix — the same target gets the same answer through the shell", () => {
  it("lets a write inside its own UNCLAIMED folder proceed, with the cure as context (#368)", () => {
    // Spec 2026-08-21 §8/§9: the owner ruled "never again" to writes refused in an unclaimed
    // desktop-app session. Not `ask` — a hook ask is a real prompt in every mode, and this fires on
    // every write — so it is allow plus one line naming what the push gate will require.
    const d = ask(`printf 'x' > ${inRoot("src/App.css")}`, { verify: UNCLAIMED });
    expect(d.permission).toBe("allow");
    expect(d.zone).toBe(ZONES.OWN);
    expect(d.code).toBe("FOLDER_UNCLAIMED");
    expect(d.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(d.additionalContext).toContain("Ownership claim");
    expect(d.additionalContext).toContain("push gate");
    expect(d.additionalContext).not.toContain("\n");
  });

  it("proceeds the same way when the board could not be read - the lapsed code (#368)", () => {
    const UNREACHABLE = () => ({ ok: false, code: "BOARD_UNREACHABLE", reason: "board read failed", issue: 278 });
    const d = ask(`printf 'x' > ${inRoot("src/App.css")}`, { verify: UNREACHABLE });
    expect(d.permission).toBe("allow");
    expect(d.code).toBe("BOARD_UNREACHABLE");
    expect(d.additionalContext).toContain("BOARD_UNREACHABLE");
    // The issue number a previous read left behind is named, so the cure is concrete.
    expect(d.additionalContext).toContain("#278");
  });

  it("still DENIES its own folder when a live record contradicts the session (#368 keeps deny)", () => {
    for (const code of ["WRITER_LIVE", "BRANCH_NOT_THE_BOARDS", "REPO_MISMATCH"]) {
      const verify = () => ({ ok: false, code, reason: `fixture: ${code} disagrees` });
      const d = ask(`printf 'x' > ${inRoot("src/App.css")}`, { verify });
      expect(d.permission, code).toBe("deny");
      expect(d.code, code).toBe(code);
      expect(d.reason, code).toContain(`fixture: ${code} disagrees`);
      expect(d.reason, code).toContain("the shell is not a way around it");
      expect(d.additionalContext, code).toBeUndefined();
    }
  });

  it("still DENIES a sibling checkout from an unclaimed session - the advisory code excuses nothing there", () => {
    const d = ask(`rm -rf ${inSib("src")}`, { verify: UNCLAIMED });
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.SIBLING);
  });

  // FOUND BY INDEPENDENT REVIEW (2026-09-04). The advisory branch RETURNED before the global,
  // unknown-zone and unresolved-operand checks, so a compound command that touched its own folder
  // AND something stricter rode the unclaimed folder past them: `cp ./x.json ~/.claude/settings.json`
  // was allow from an unclaimed session and deny from a verified one. The advisory is carried, not
  // decided on; every stricter check runs exactly as it would for a verified session.
  it("a compound command that also reaches the owner's global config is DENIED from an unclaimed session, as from a verified one", () => {
    const cmd = `cp ${inRoot("x.json")} ${fwd(join(HOME_CLAUDE, "settings.json"))}`;
    const verified = ask(cmd);
    expect(verified.permission).toBe("deny");
    expect(verified.zone).toBe(ZONES.GLOBAL);
    const unclaimed = ask(cmd, { verify: UNCLAIMED });
    expect(unclaimed.permission).toBe("deny");
    expect(unclaimed.zone).toBe(ZONES.GLOBAL);
    expect(unclaimed.reason).toBe(verified.reason);
    // The advisory line rides beside the refusal; it never replaces it.
    expect(unclaimed.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(verified.additionalContext).toBeUndefined();
  });

  it("a compound command that also names an unresolvable operand DEFERS from an unclaimed session, as from a verified one", () => {
    const cmd = `printf x > ${inRoot("own.txt")}; rm -rf $TARGET`;
    const verified = ask(cmd);
    expect(verified.permission).toBe("allow");
    expect(verified.zone).toBe(ZONES.UNKNOWN);
    const unclaimed = ask(cmd, { verify: UNCLAIMED });
    expect(unclaimed.permission).toBe("allow");
    // This command ALSO writes inside the session's own claim (own.txt), so once the unresolved
    // operand stops being a decision of its own, the advisory carry folds the "no objection" outcome
    // into the own-claim hit it is actually about — same as any other advisory allow (line ~1272).
    expect(unclaimed.zone).toBe(ZONES.OWN);
    expect(unclaimed.why).toContain(verified.why);
    expect(unclaimed.additionalContext).toContain("FOLDER_UNCLAIMED");
    // The same for a target the checker cannot place, and for an opaque verb standing in a sibling.
    expect(ask(`printf x > ${inRoot("own.txt")}; cd $D && rm x.txt`, { verify: UNCLAIMED }).permission).toBe("allow");
    const opaque = `printf x > ${inRoot("own.txt")}; cd ${fwd(SIB)} && node build.mjs`;
    expect(ask(opaque).permission).toBe("allow");
    expect(ask(opaque, { verify: UNCLAIMED }).permission).toBe("allow");
  });

  it("the advisory is the whole answer ONLY when nothing stricter objects", () => {
    const d = ask(`printf x > ${inRoot("own.txt")}; mkdir -p ${inRoot("notes")}`, { verify: UNCLAIMED });
    expect(d.permission).toBe("allow");
    expect(d.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(d.reason).toBeUndefined();
  });

  it("denies a write into a SIBLING checkout even when the session IS verified", () => {
    const d = ask(`sed -i 's/a/b/' ${inSib("src/App.css")}`);
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.SIBLING);
    expect(toComparable(d.target)).toBe(toComparable(join(SIB, "src/App.css")));
    expect(d.reason).toContain("Switching tools does not change who may write");
  });

  it("allows a verified session writing inside its own claim", () => {
    expect(ask(`printf 'x' > ${inRoot("src/App.css")}`).permission).toBe("allow");
    expect(ask(`git commit -am 'fix: src/App.css'`).permission).toBe("allow");
  });

  it("does not read a commit message as a pathspec", () => {
    // `-m`'s value looks exactly like a path into the sibling. It is not one.
    const d = ask(`git commit -m 'docs: mirror ../sentinel/README.md'`);
    expect(d.permission).toBe("allow");
  });

  it("treats an unknown path SHAPE as unknown, never as outside protection", () => {
    const d = ask(`rm 'C:notapath'`);
    expect(d.permission).toBe("allow");
    expect(d.zone).toBe(ZONES.UNKNOWN);
    expect(d.why).toContain("not evidence that it is outside");
  });

  it("denies the literal restore / move / write forms without ownership", () => {
    expect(ask(`cp ${fwd(join(SCRATCH, "settings.json"))} ${inSib(".claude/settings.json")}`).permission).toBe("deny");
    expect(ask(`mv ${inSib("a.txt")} ${inSib("b.txt")}`).permission).toBe("deny");
    expect(ask(`echo '{}' > ${inSib("package.json")}`).permission).toBe("deny");
    expect(ask(`rm -rf ${inSib("src")}`).permission).toBe("deny");
  });

  it("checks BOTH endpoints of a move, not just the destination", () => {
    const out = ask(`mv ${inSib("notes.md")} ${fwd(join(SCRATCH, "notes.md"))}`);
    expect(out.permission).toBe("deny"); // the SOURCE is the sibling's file
    const into = ask(`mv ${inRoot("notes.md")} ${inSib("notes.md")}`);
    expect(into.permission).toBe("deny"); // the DESTINATION is the sibling's folder
  });

  it("refuses a SHELL write into the owner's global configuration outright", () => {
    // `project-write-assert` asks for the same zone and that is not a contradiction: the memory
    // store under `~/.claude/projects/**` is written with `Write` on purpose, so the tool path has a
    // legitimate case and routes. A shell has none. (A hook `ask` is a real prompt in every mode,
    // `defaultMode: "auto"` included — it does not degrade to allow, as this comment once claimed —
    // so the distinction is not about safety but about whether there is anything to put in front of
    // the owner. For a shell write into the folder that holds the rules about what agents may do,
    // there is not, so positive knowledge of the zone is enough to refuse.)
    const d = ask(`cp ${fwd(join(SCRATCH, "settings.json"))} ${fwd(join(HOME_CLAUDE, "settings.json"))}`);
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.GLOBAL);
    expect(d.reason).toContain("decide what agents may do");
  });

  it("expands `~` before deciding, so the global config cannot be reached by another spelling", () => {
    expect(ask(`rm ~/.claude/settings.json`).permission).toBe("deny");
    expect(ask(`rm '~/.claude/settings.json'`).permission).toBe("deny");
  });

  it("gives variable, interpreter and subcommand forms no false safety approval", () => {
    // A variable operand from an UNVERIFIED session: the cwd cannot vouch for it.
    expect(ask(`rm -rf $TARGET`, { verify: UNCLAIMED }).permission).toBe("allow");
    // An interpreter body standing in someone else's checkout.
    expect(ask(`node -e 'require("fs").writeFileSync("x","")'`, { cwd: SIB }).permission).toBe("allow");
    // A subcommand that moves the repository out from under the guard.
    expect(ask(`git -C ${fwd(SIB)} checkout -- .`).permission).toBe("deny");
    expect(ask(`git --git-dir=${fwd(join(SIB, ".git"))} gc`).permission).toBe("deny");
    // An absolute path spelled inside an interpreter body is still a fact about the target.
    expect(ask(`bash -lc "rm ${inSib("x.txt")}"`).permission).toBe("deny");
  });

  it("leaves read-only work, scratch and the adoption cure usable", () => {
    for (const cmd of [
      "git status",
      "git log --oneline -5",
      "git diff HEAD",
      "git config --get user.name",
      "git worktree list",
      "git branch -a",
      "ls -la src",
      "cat package.json",
      "npm test",
      "rg needle src",
      "node scripts/verify-release-state.mjs",
    ]) {
      expect(ask(cmd, { verify: UNCLAIMED }), cmd).toMatchObject({ permission: "allow" });
    }
    // The refusal prints this; a guard that then blocks its own cure is a dead end.
    expect(ask("node tools/entry/cli.mjs adopt --issue 278 --session abc", { verify: UNCLAIMED }).permission).toBe("allow");
    // Scratch is outside every checkout and outside the claim; it stays writable.
    expect(ask(`printf 'x' > ${fwd(join(SCRATCH, "notes.txt"))}`, { verify: UNCLAIMED }).permission).toBe("allow");
  });

  it("does not ask about an ordinary wildcard, which cannot leave the directory it runs in", () => {
    expect(ask("rm -f *.log").permission).toBe("allow");
    expect(ask("rm -f build/*.map").permission).toBe("allow");
    // …but a wildcard with an escape in it is not bounded by anything.
    expect(ask("rm -f ../*/dist/*.map").permission).toBe("allow");
  });


  it("preserves the original wildcard and sends its static prefix to ownership (#428)", () => {
    const zone = vi.fn((q) => q.wildcard && q.target === ".claude/worktrees/"
      ? { zone: ZONES.UNKNOWN, abs: inRoot(".claude/worktrees"), owner: null, why: "contains a registered lane" }
      : fakeZone(q));
    const result = ask("rm -rf .claude/worktrees/*", { zone });
    expect(result.permission).toBe("allow");
    expect(result.why).toContain(".claude/worktrees/*");
    expect(zone).toHaveBeenCalledWith(expect.objectContaining({ target: ".claude/worktrees/", descendants: true, wildcard: true }));
  });

  it("keeps braces and unsupported tildes from becoming literal deletion targets (#428 review)", () => {
    const zone = vi.fn((q) => q.wildcard && q.target === ".claude/"
      ? { zone: ZONES.UNKNOWN, abs: inRoot(".claude"), owner: null, why: "contains a registered lane" }
      : fakeZone(q));
    expect(ask("rm -rf .claude/work{trees,}", { zone }).permission).toBe("allow");
    expect(ask("rm -rf ~+/x").permission).toBe("allow");
    expect(lex("find -exec rm {} \\;").find((w) => w.value === "{}").dynamic).toBe(false);
  });

  it("never consults the board when nothing protected is in play", () => {
    const verify = vi.fn(VERIFIED);
    expect(ask("ls -la", { verify }).permission).toBe("allow");
    expect(verify).not.toHaveBeenCalled();
    // …nor when the answer is already a fact: a sibling is denied before verification is asked for.
    const verify2 = vi.fn(VERIFIED);
    expect(ask(`rm ${inSib("x")}`, { verify: verify2 }).permission).toBe("deny");
    expect(verify2).not.toHaveBeenCalled();
  });

  it("reports a real disagreement instead of offering adoption for it", () => {
    const d = ask(`printf 'x' > ${inRoot("src/App.css")}`, { verify: MISMATCH });
    expect(d.permission).toBe("deny");
    expect(d.reason).toContain("the claim names another branch");
    expect(d.reason).not.toContain("cli.mjs adopt");
  });
});

describe("the #240 shape — refused on Edit, then reaching the same file through the shell", () => {
  // The observed sequence, as fixtures. The point is that every step below is refused for the same
  // reason `Edit` refused it, so the tool switch buys nothing.
  it("refuses a git restore of a file in another checkout", () => {
    expect(ask(`git -C ${fwd(SIB)} checkout -- .claude/settings.json`).permission).toBe("deny");
    expect(ask(`git checkout -- ${inSib(".claude/settings.json")}`).permission).toBe("deny");
  });

  it("refuses the copy-back and the redirect forms of the same restore", () => {
    expect(ask(`cp ${inSib(".claude/settings.json.bak")} ${inSib(".claude/settings.json")}`).permission).toBe("deny");
    expect(ask(`cat ${fwd(join(SCRATCH, "settings.json"))} > ${inSib(".claude/settings.json")}`).permission).toBe("deny");
  });

  it("refuses the same restore aimed at the owner's global config", () => {
    const d = ask(`cp ${fwd(join(SCRATCH, "settings.json"))} ${fwd(join(HOME_CLAUDE, "settings.json"))}`);
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.GLOBAL);
  });
});

// REGRESSION (found 2026-08-31 by running the SHIPPED hook, after this file was green). Two lexing
// defects, both of which made a real target unreadable — and an unreadable target is decided on the
// wrong evidence, whichever way it then falls.
describe("a path survives the quoting and the `cd` that lead to it", () => {
  it("keeps backslashes inside DOUBLE quotes, where they are not escapes", () => {
    // POSIX: inside `"…"` the backslash is special before `$`, a backtick, `"`, `\` and a newline,
    // and literal before anything else. Consuming it unconditionally turned
    // `"C:\Users\Kuya\code\sentinel\README.md"` into `C:UsersKuyacodesentinelREADME.md`, which this
    // checker could not place, so a sibling write took the `ask` path instead of `deny`.
    expect(lex(String.raw`"C:\Users\Kuya\x.md"`)[0].value).toBe(String.raw`C:\Users\Kuya\x.md`);
    expect(lex(String.raw`"a\"b"`)[0].value).toBe(`a"b`);
    expect(lex(String.raw`"a\\b"`)[0].value).toBe(String.raw`a\b`);
    expect(lex(String.raw`"a\$b"`)[0].value).toBe("a$b");
    expect(lex(String.raw`"a\$b"`)[0].dynamic).toBe(false);
    // OUTSIDE quotes the unconditional form is CORRECT and must stay: bash really does turn a bare
    // `C:\Users\x` into `C:Usersx`, and "fixing" that would deny a command that never touched the
    // path it appears to name.
    expect(lex(String.raw`C:\Users\x`)[0].value).toBe("C:Usersx");
    // PowerShell's escape is the backtick, so a backslash there is only ever a separator.
    expect(lex(`"C:\\Users\\x"`, "powershell")[0].value).toBe(String.raw`C:\Users\x`);
    expect(lex('"a`"b"', "powershell")[0].value).toBe(`a"b`);
  });

  it("follows a `cd` spelled the way the shell that runs it spells paths", () => {
    // `cd /c/…/sibling && rm -f package.json` was ALLOWED: the destination was resolved with plain
    // `resolve`, so it landed in a folder that does not exist and every relative target after it
    // came back `unprotected`. The `cd` destination IS the write target, one operand later.
    const a = analyze("cd /c/Users/Kuya/code/sentinel && rm -f package.json", { cwd: ROOT });
    expect(a.ops.map((o) => o.verb)).toContain("rm");
    const op = a.ops.find((o) => o.verb === "rm");
    expect(op.cwdUnknown).toBe(false);
    expect(toComparable(op.cwd)).toBe(process.platform === "win32" ? "c:/users/kuya/code/sentinel" : "/c/users/kuya/code/sentinel");
  });

  it("says it does not know where it is standing when the `cd` target is unresolvable", () => {
    // Silence about the cwd is the fail-open shape: a relative target then resolves against the
    // session root and reads as the session's own.
    const a = analyze("cd $D && rm x.txt", { cwd: ROOT });
    expect(a.unresolved.length + a.ops.filter((o) => o.cwdUnknown).length).toBeGreaterThan(0);
  });
});

describe("the escape hatches, which must not depend on this file being right", () => {
  it("is disabled by the off switch in THIS PROCESS's environment", () => {
    const d = ask(`rm -rf ${inSib("src")}`, { env: { [OFF_SWITCH]: "1" } });
    expect(d.permission).toBe("allow");
  });

  it("cannot be disabled by writing the off switch INTO a command", () => {
    // That string is the command being inspected, not this process's env — the lever belongs to
    // whoever launches the session.
    const d = ask(`${OFF_SWITCH}=1 rm -rf ${inSib("src")}`);
    expect(d.permission).toBe("deny");
  });

  it("stays out of the way of every tool it does not guard", () => {
    expect(SHELL_TOOLS.has("Bash")).toBe(true);
    expect(SHELL_TOOLS.has("PowerShell")).toBe(true);
    expect(ask(`rm ${inSib("x")}`, { toolName: "Write" }).permission).toBe("allow");
    expect(ask("", {}).permission).toBe("allow");
    expect(decideShell({ toolName: "Bash", toolInput: {}, sessionRoot: ROOT }).permission).toBe("allow");
  });

  it("fails open when its own resolver throws", () => {
    const boom = () => {
      throw new Error("resolver is broken");
    };
    expect(() => ask(`rm ${inSib("x")}`, { zone: boom })).toThrow();
    // …and the wire shell catches it, which is what actually ships.
    let wrote = "";
    const out = emit(
      (() => {
        try {
          return ask(`rm ${inSib("x")}`, { zone: boom });
        } catch {
          return null;
        }
      })(),
      { write: (s) => (wrote += s) },
    );
    expect(out).toBe(0);
    expect(wrote).toBe("");
  });
});

describe("the PowerShell dialect, because guarding one shell is a hole at the other", () => {
  const ps = (command, over = {}) => ask(command, { toolName: "PowerShell", ...over });

  it("recognizes the PowerShell mutation verbs", () => {
    expect(ps(`Remove-Item ${inSib("src/App.css")}`).permission).toBe("deny");
    expect(ps(`Set-Content ${inSib("notes.md")} 'x'`).permission).toBe("deny");
    expect(ps(`Copy-Item ${fwd(join(SCRATCH, "a"))} ${inSib("a")}`).permission).toBe("deny");
    expect(ps(`Move-Item ${inSib("a")} ${fwd(join(SCRATCH, "a"))}`).permission).toBe("deny");
    expect(ps("Get-ChildItem -Recurse").permission).toBe("allow");
  });

  it("uses the backtick as the escape character, not the backslash", () => {
    const tokens = lex("Remove-Item C:\\a\\b.txt", "powershell");
    expect(tokens.at(-1).value).toBe("C:\\a\\b.txt");
    expect(lex("echo `$x", "powershell").at(-1).dynamic).toBe(false);
  });
});

// REGRESSION. Independent review executed a matrix against the SHIPPED hook and got these four
// answers back. Two were writes into a sibling reported as `allow`; two were read-only commands
// reported as refusals. Both directions are defects — the first lets the write through, the second
// is the false-deny load that gets a guard deleted instead of fixed.
describe("a target the verb hides, and a read the verb does not", () => {
  const ps = (command, over = {}) => ask(command, { toolName: "PowerShell", ...over });

  it("does not read a PowerShell SPLAT as a filename", () => {
    // `@p` carries no `$`, so it is not `dynamic`, and it was resolved as a path: a file named `@p`
    // in this session's own root, hence "nothing protected is reached" — while the real target sat
    // in the hashtable. Splatting is ordinary PowerShell, so this is the accident case.
    expect(ps(`$p = @{ Path = '${inSib("README.md")}' }; Remove-Item @p`).permission).not.toBe("allow");
    // A splat naming nothing protected still does not get waved through as a known-safe write: the
    // hashtable is just as unreadable when its contents are harmless, and every operand this checker
    // cannot resolve defers to the normal permission flow instead of being decided here.
    expect(ps(`$p = @{ Path = '${inRoot("README.md")}' }; Remove-Item @p`).permission).toBe("allow");
  });

  it("does not call a verb it cannot read `no recognized mutation`", () => {
    // `& $cmd '…'` reached the fall-through and was filed as "names no recognized mutation", which
    // is the one thing an unreadable verb is not evidence of. Unknown is not unprotected.
    expect(ps(`$cmd = 'Remove-Item'; & $cmd '${inSib("README.md")}'`).permission).not.toBe("allow");
    expect(ask(`c=rm; $c ${inSib("README.md")}`).permission).not.toBe("allow");
  });

  it("lets a LISTING read the refs, claim or no claim", () => {
    // `git tag -l 'v*'` and `git show-ref --heads` were refused as mutations in an unverified
    // session. Requiring every word after the verb to be a flag made the listing PATTERN look like
    // a tag being created; `show-ref` was simply missing from the read-only set.
    for (const cmd of ["git tag -l 'v*'", "git branch --list 'lane/*'", "git show-ref --heads", "git branch"]) {
      const d = ask(cmd, { verify: UNCLAIMED });
      expect(d.permission, cmd).toBe("allow");
      // A listing never reaches verification, so it carries no advisory either.
      expect(d.additionalContext, cmd).toBeUndefined();
    }

    // Without a listing flag the positional is a name being CREATED, and `-d` deletes: still writes.
    // A write in an unclaimed folder proceeds with the advisory (#368), so "still a write" is
    // proved by the advisory being there - and by the same command being DENIED when a live record
    // contradicts the session.
    for (const cmd of ["git tag v1.0", "git branch -d old"]) {
      const d = ask(cmd, { verify: UNCLAIMED });
      expect(d.code, cmd).toBe("FOLDER_UNCLAIMED");
      expect(d.additionalContext, cmd).toContain("FOLDER_UNCLAIMED");
      expect(ask(cmd, { verify: MISMATCH }).permission, cmd).toBe("deny");
    }
  });
});

describe("the pieces, so a failure names itself", () => {
  it("removes a here-document BODY before anything reads it as a command", () => {
    const cmd = `cat > notes.md <<'EOF'\nrm -rf ${inSib("src")}\nEOF`;
    const stripped = stripHeredocs(cmd);
    expect(stripped).not.toContain("rm -rf");
    const { ops } = analyze(cmd, { cwd: ROOT, home: HOME });
    expect(ops.map((o) => o.verb)).toEqual(["redirection"]);
    expect(ask(cmd).permission).toBe("allow");
  });

  it("keeps quoting straight", () => {
    expect(lex("rm 'a b.txt'").map((t) => t.value)).toEqual(["rm", "a b.txt"]);
    expect(lex('rm "$X"').at(-1).dynamic).toBe(true);
    expect(lex("rm '$X'").at(-1).dynamic).toBe(false);
    expect(lex("rm a # b").map((t) => t.value)).toEqual(["rm", "a"]);
    expect(lex("echo ${#x}").at(-1).value).toContain("#");
  });

  it("does not read a file descriptor as a path", () => {
    const [seg] = segments(lex("node x.mjs > out.log 2>&1"));
    expect(seg.redirects.map((r) => r.value)).toEqual(["out.log"]);
  });

  it("splits a chain and judges each half on its own", () => {
    expect(segments(lex("cd x && rm y | tee z")).length).toBe(3);
    // The adoption allowance is per SEGMENT: the second half is still judged.
    expect(ask(`node tools/entry/cli.mjs adopt --issue 278 && rm -rf ${inSib("src")}`).permission).toBe("deny");
  });

  it("follows `cd` across a chain, and stops guessing when it cannot", () => {
    expect(ask(`cd ${fwd(SIB)} && rm x.txt`).permission).toBe("deny");
    expect(ask("cd $D && rm x.txt").permission).toBe("allow");
    expect(ask("cd ../sentinel && rm x.txt").permission).toBe("deny");
  });

  it("answers which git verbs only read", () => {
    for (const ro of ["status", "log", "diff", "show HEAD", "rev-parse --git-dir", "worktree list", "stash list", "branch", "branch -a", "tag -l", "config --get x", "remote -v"]) {
      expect(gitIsReadOnly(ro.split(" ")), ro).toBe(true);
    }
    for (const rw of ["commit", "checkout main", "push", "worktree add x", "stash pop", "branch -d x", "tag v1", "config user.name x", "clean -fd", "reset --hard"]) {
      expect(gitIsReadOnly(rw.split(" ")), rw).toBe(false);
    }
  });

  it("finds absolute paths embedded in a larger string, and claims nothing from their absence", () => {
    expect(embeddedPaths(`writeFileSync("${inSib("x.txt")}")`)).toContain(inSib("x.txt"));
    expect(embeddedPaths("writeFileSync(target)")).toEqual([]);
  });

  it("marks a target it cannot resolve as unresolved rather than dropping it", () => {
    const { unresolved } = analyze("rm -rf $TARGET", { cwd: ROOT, home: HOME });
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].verb).toBe("rm");
  });
});

describe("what it must never do: persist, log, or leak the session", () => {
  const hookInput = {
    tool_name: "Bash",
    tool_input: { command: `rm ${inSib("x.txt")}` },
    cwd: ROOT,
    session_id: "sess-secret-01",
    transcript_path: "/private/transcript.jsonl",
  };

  it("verifies without persisting anything", () => {
    const verify = vi.fn(UNCLAIMED);
    run({ hookInput, env: { CLAUDE_PROJECT_DIR: ROOT }, verify, zone: fakeZone, home: HOME });
    // A sibling is decided before verification is even asked for; when it IS asked, it is read-only.
    for (const call of verify.mock.calls) expect(call[0].persist).toBe(false);
  });

  it("emits the decision and nothing else — no session id, no transcript path", () => {
    let wrote = "";
    const decision = run({ hookInput, env: { CLAUDE_PROJECT_DIR: ROOT }, verify: UNCLAIMED, zone: fakeZone, home: HOME });
    emit(decision, { write: (s) => (wrote += s) });
    expect(wrote).not.toContain("sess-secret-01");
    expect(wrote).not.toContain("transcript");
    const payload = JSON.parse(wrote);
    expect(Object.keys(payload)).toEqual(["hookSpecificOutput"]);
    expect(Object.keys(payload.hookSpecificOutput).sort()).toEqual([
      "hookEventName",
      "permissionDecision",
      "permissionDecisionReason",
    ]);
    expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("says nothing at all on a plain allow", () => {
    let wrote = "";
    expect(emit({ permission: "allow" }, { write: (s) => (wrote += s) })).toBe(0);
    expect(wrote).toBe("");
  });

  it("puts an advisory on the wire as additionalContext ALONE - no permissionDecision - and still leaks nothing (#368)", () => {
    // hooks-guide: exit 0 with hookSpecificOutput carrying only additionalContext is "no decision;
    // the normal permission flow still applies", and the context reaches the model. Writing
    // `permissionDecision: "allow"` instead would skip the interactive prompt and the auto-mode
    // classifier for the call - broader than an advisory means (review 2026-09-04).
    let wrote = "";
    const own = { ...hookInput, tool_input: { command: `printf 'x' > ${inRoot("x.txt")}` } };
    const decision = run({ hookInput: own, env: { CLAUDE_PROJECT_DIR: ROOT }, verify: UNCLAIMED, zone: fakeZone, home: HOME });
    expect(emit(decision, { write: (s) => (wrote += s) })).toBe(0);
    const payload = JSON.parse(wrote);
    expect(Object.keys(payload)).toEqual(["hookSpecificOutput"]);
    expect(Object.keys(payload.hookSpecificOutput).sort()).toEqual(["additionalContext", "hookEventName"]);
    expect("permissionDecision" in payload.hookSpecificOutput).toBe(false);
    expect(payload.hookSpecificOutput.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(wrote).not.toContain("sess-secret-01");
    expect(wrote).not.toContain("transcript");
  });

  it("keeps a deny that carries the advisory line as a deny on the wire, with the line beside it", () => {
    let wrote = "";
    const compound = { ...hookInput, tool_input: { command: `cp ${inRoot("x.json")} ${fwd(join(HOME_CLAUDE, "settings.json"))}` } };
    const decision = run({ hookInput: compound, env: { CLAUDE_PROJECT_DIR: ROOT }, verify: UNCLAIMED, zone: fakeZone, home: HOME });
    expect(emit(decision, { write: (s) => (wrote += s) })).toBe(0);
    const out = JSON.parse(wrote).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("global configuration");
    expect(out.additionalContext).toContain("FOLDER_UNCLAIMED");
  });
});

describe("a wrapper that runs another command is not a command of its own (#279 review)", () => {
  // Measured by the reviewing session against this file's own head: four spellings of ONE literal
  // write into a sibling, same verb and same target as text, and only the bare one was refused.
  // `env`/`xargs` sat in OPAQUE, so they reached the class-3 tail and passed on an owned CWD, while
  // the operand that mattered was `../sentinel`, spelled out and not in that CWD at all.
  // `sudo`/`command` sat in no table, so a segment whose SECOND word is `rm` came back "names no
  // recognized mutation". Stepping over a wrapper is the same move as stepping over `VAR=1`: the
  // verb and the target are both literal text either way.
  const SIB_FILE = "../sentinel/package.json";

  it("refuses the write through every wrapper in the family", () => {
    const wrappers = [
      "env", "xargs", "sudo", "doas", "command", "nohup", "setsid",
      "nice", "ionice", "time", "stdbuf -oL", "timeout 5", "timeout 1.5m",
      // chrt was named in the spec's closed list and appeared in NO test, which is exactly how its
      // positional bug survived the first round: an untested member of a list called complete.
      "chrt -f 10", "chrt -r 99", "chrt -b 0", "chrt",
    ];
    for (const w of wrappers) {
      expect(ask(`${w} rm -f ${SIB_FILE}`).permission, w).toBe("deny");
    }
  });

  it("steps over the flags a wrapper takes, both attached and separated", () => {
    const flagged = [
      "env -i", "env -u PATH", "env --unset=PATH", "env -C /tmp", "env FOO=1 BAR=2",
      "sudo -u root", "sudo -n -E", "sudo --user=root", "sudo -g wheel",
      "xargs -0 -I {}", "xargs -n 1", "xargs --max-args=1",
      "nice -n 10", "nice -5", "timeout -s KILL 5", "timeout --kill-after=2 5",
      "stdbuf -i0 -oL -eL", "command -p", "doas -u root",
    ];
    for (const w of flagged) {
      expect(ask(`${w} rm -f ${SIB_FILE}`).permission, w).toBe("deny");
    }
  });

  it("keeps stepping when wrappers stack, and picks assignments up again after one", () => {
    expect(ask(`sudo env FOO=1 rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`nohup timeout 5 xargs rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`FOO=1 sudo BAR=2 rm -f ${SIB_FILE}`).permission).toBe("deny");
  });

  it("does not wave a wrapper through on a flag it cannot parse", () => {
    // An unknown flag may or may not swallow the next word, so which word is the command is not
    // knowable from the text. That is the spec's class 2 — a possible write with an unreadable
    // target — and it defers to the normal permission flow rather than the class-3 tail's owned-CWD
    // pass, which is what distinguishes the two below: the same `why` text every genuinely unresolved
    // operand gets, not the "bounded by a directory" text the owned-CWD pass carries.
    for (const cmd of [`sudo --made-up-flag rm -f ${SIB_FILE}`, "sudo --made-up-flag rm -f ./local.txt"]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("allow");
      expect(d.why, cmd).toContain("defers to the normal permission flow");
    }
  });

  it("stays honest about xargs, whose real targets can arrive on stdin", () => {
    // The step-over reaches the argv TEMPLATE only. With no operand spelled there, the targets come
    // from a pipe this checker never evaluates, so it is unresolved rather than clean — it defers to
    // the normal permission flow rather than the class-3 tail's owned-CWD pass.
    const d = ask("find . -name '*.tmp' | xargs rm -f");
    expect(d.permission).toBe("allow");
    expect(d.why).toContain("defers to the normal permission flow");
  });

  it("writes nothing when the wrapper runs nothing", () => {
    expect(ask("sudo -v").permission).toBe("allow");
    expect(ask("command -v rm").permission).toBe("allow");
    expect(ask("env").permission).toBe("allow");
  });

  it("still refuses a wrapper whose command comes out of a variable", () => {
    // The step-over must not swallow the dynamic-verb handling behind it: after `sudo` comes off,
    // `$cmd` is still a command this checker cannot read, and the absolute path spelled beside it is
    // still a fact. A RELATIVE target under a dynamic verb stays class 3 by spec section 6 - the
    // embedded scan is what catches the literal version, and nothing here widens that.
    expect(ask(`sudo $cmd -f ${inSib("package.json")}`).permission).not.toBe("allow");
    expect(ask(`env $cmd -f ${inSib("package.json")}`).permission).not.toBe("allow");
  });
});

describe("the entry-CLI exemption covers the cure, not anything that names it (#279 review)", () => {
  // The exemption matched any OPERAND, so a write into a sibling was excused because the file it
  // happened to mention was the printed cure. It has to be the thing that RUNS, not a word present.
  const CLI = "tools/entry/cli.mjs";

  it("still lets the printed cure run in an unverified session", () => {
    expect(ask(`node ${CLI} adopt --issue 278 --session abc`, { verify: UNCLAIMED }).permission).toBe("allow");
    expect(ask(`node --no-warnings ${CLI} claim --issue 278`, { verify: UNCLAIMED }).permission).toBe("allow");
  });

  it("does not excuse a write into a sibling that merely mentions the cure", () => {
    expect(ask(`cp ${CLI} ../sentinel/${CLI}`).permission).toBe("deny");
    expect(ask(`rm -f ../sentinel/package.json ${CLI}`).permission).toBe("deny");
  });
});

// REGRESSION, round 2. Independent review ran the fixed checker against the OTHER shell and found
// the same hole standing: every wrapper in the table above is POSIX, while PowerShell puts the verb
// and the target in literal word positions too — the exact condition §6 uses to justify stepping
// over `sudo`. So one spelling of a write was refused and another was waved through, on the machine
// whose primary shell is the one being waved through.
describe("a PowerShell scriptblock body is a command list, not an argument (#279 review round 2)", () => {
  const ps = (command) => ask(command, { toolName: "PowerShell" });
  const SIB_FILE = inSib("package.json");

  // The finding in one assertion: same write, same machine, two shells, and before this fix the
  // PowerShell spelling was the ALLOWED one. Parity is the claim, so parity is what is pinned.
  it("answers the same as bash for the same write through a scriptblock", () => {
    const posix = ask(`bash -c "rm -f ${SIB_FILE}"`).permission;
    const shell = ps(`Invoke-Command -ScriptBlock { Remove-Item ${SIB_FILE} }`).permission;
    expect(posix).toBe("deny");
    expect(shell, "the PowerShell spelling must not be the cheap way in").toBe(posix);
  });

  it("refuses the write through every scriptblock carrier, with no cmdlet allowlist", () => {
    const carriers = [
      `Invoke-Command -ScriptBlock { Remove-Item ${SIB_FILE} }`,
      `Start-Job -ScriptBlock { Remove-Item ${SIB_FILE} }`,
      `Get-ChildItem | ForEach-Object { Remove-Item ${SIB_FILE} }`,
      `1..3 | % { Remove-Item ${SIB_FILE} }`,
      `if ($true) { Remove-Item ${SIB_FILE} }`,
      `foreach ($f in $list) { Remove-Item ${SIB_FILE} }`,
      `Invoke-Command -ComputerName x -ScriptBlock { Set-Content ${SIB_FILE} 'x' }`,
    ];
    for (const c of carriers) expect(ps(c).permission, c).toBe("deny");
  });

  // The boundary is a BARE brace. If a quoted one split a segment, any command could be cut in half
  // by putting a brace in a string — a hole opened by the fix for a hole.
  it("does not treat a quoted brace as a boundary", () => {
    const tokens = lex('Write-Host "{"', "powershell");
    expect(tokens.at(-1).value).toBe("{");
    expect(tokens.at(-1).raw).toBe('"{"');
    expect(ps('Write-Host "{"').permission).toBe("allow");
    expect(ps('Write-Host "}" ; Get-ChildItem').permission).toBe("allow");
  });

  // A guard that denies ordinary pipeline work gets deleted rather than fixed, so the false-deny
  // side is pinned as hard as the deny side.
  it("leaves ordinary scriptblock bodies alone", () => {
    const benign = [
      'Get-ChildItem | Where-Object { $_.Name -eq "rm" }',
      'Get-ChildItem | Where-Object { $_.FullName -like "*.tmp" }',
      "Get-ChildItem | ForEach-Object { Write-Host $_.Name }",
      '$h = @{ Name = "rm" }',
      "Get-Process | % { $_.Id }",
    ];
    for (const c of benign) expect(ps(c).permission, c).toBe("allow");
  });

  // POSIX braces are grouping, not a scriptblock, and splitting there would change what a segment
  // means in the dialect this guard was built against. The boundary is powershell-only on purpose.
  it("keeps braces inert in the posix dialect", () => {
    expect(segments(lex("{ rm -f x; }", "posix"), "posix").length).toBe(
      segments(lex("{ rm -f x; }", "posix")).length,
    );
  });

  // chrt's priority sits where timeout's duration sits, and the step read it as the command.
  it("does not let chrt's priority positional stand in for the command", () => {
    expect(ask(`chrt -f 10 rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`chrt -r 99 rm -f ${SIB_FILE}`).permission).toBe("deny");
    // A query names no command at all and must stay quiet.
    expect(ask("chrt -p 10 1234").permission).toBe("allow");
    expect(ask("chrt -p 1234").permission).toBe("allow");
  });
});

// §6 of the spec carries a machine-readable marker of the wrapper holes still open. It is read
// once here because both describes below depend on it: one proves the table does not overlap it,
// the other proves every name in it is a REAL hole and not a stale claim.
const SPEC = readFileSync(
  join(import.meta.dirname, "../../docs/superpowers/specs/2026-08-31-target-ownership-across-tools.md"),
  "utf8",
);
const OPEN = (SPEC.match(/<!-- open-wrappers:([^>]*)-->/) ?? [null, ""])[1].trim().split(/\s+/).filter(Boolean);

// #308. The wrapper table is an ALLOWLIST, and §6 named five members it did not carry — each one
// walking a literal sibling write straight past the checker. They close one at a time, in the order
// the issue sets, and each owes BOTH directions in the commit that closes it: the refused write, and
// a false-deny probe showing ordinary use of that wrapper still passes. A table that starts denying
// normal commands is how a guard gets deleted instead of fixed.
describe("wrappers whose own arguments hid the command (#308)", () => {
  const SIB_FILE = inSib("package.json");

  // Measured before the fix, through `stepPrefixes`: the step landed on `busybox` itself, and
  // `analyze` returned no ops AND no unresolved — the write was not ambiguous, it was invisible.
  it("does not let a busybox applet hide behind the multi-call binary", () => {
    expect(ask(`busybox rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`busybox mv ${SIB_FILE} /tmp/x`).permission).toBe("deny");
    // The interpreter applet inherits nothing: it is judged exactly as a bare `sh` is judged.
    expect(ask(`busybox sh -c "rm -f ${SIB_FILE}"`).permission).toBe(
      ask(`sh -c "rm -f ${SIB_FILE}"`).permission,
    );
  });

  it("still allows ordinary busybox use — the false-deny direction", () => {
    for (const c of [
      "busybox ls -la",
      "busybox du -sh .",
      "busybox --list",
      "busybox --help",
      `busybox cat ${SIB_FILE}`,
      "busybox grep -r todo src",
    ]) {
      expect(ask(c).permission, c).toBe("allow");
    }
  });

  // The third wrapper in this file to carry a bare leading positional, after `timeout`'s duration
  // and `chrt`'s priority. Same shape, same hole: the mask read as the command.
  it("does not let taskset's CPU mask stand in for the command", () => {
    expect(ask(`taskset 0x3 rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`taskset 3 mv ${SIB_FILE} /tmp/x`).permission).toBe("deny");
    expect(ask(`taskset -c 0,1 rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`taskset --cpu-list 0-3 rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`taskset -a -c 0-3 rm -f ${SIB_FILE}`).permission).toBe("deny");
    // MASK has to stay TIGHT. Loosened to match any word, it eats `rm` and the head lands on a
    // flag — measured, and every other assertion here stayed green while it did.
    expect(ask(`taskset rm -f ${SIB_FILE}`).permission).toBe("deny");
    // ...and greedy. Made one-shot, the walk stops on the second mask-shaped word and treats it as
    // the command, so the `rm` behind it reads as an argument and the write is allowed — measured,
    // this exact line is the one that caught it.
    expect(ask(`taskset 0x3 0-1 rm -f ${SIB_FILE}`).permission).toBe("deny");
  });

  it("still allows ordinary taskset use — the false-deny direction", () => {
    for (const c of [
      "taskset -p 1234",
      "taskset -p 0x3 1234",
      "taskset 0x3 ls -la",
      "taskset -c 0,1 npm run build",
      "taskset -a -c 0-3 cargo test",
    ]) {
      expect(ask(c).permission, c).toBe("allow");
    }
  });

  // The lock file is the first leading positional here that no pattern can screen: it is a path,
  // and a path looks like a command. The cap is what makes it safe, so both halves are pinned.
  it("does not let flock's lock file stand in for the command", () => {
    expect(ask(`flock /tmp/lock rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`flock -n /tmp/lock rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`flock -x -w 5 /tmp/lock mv ${SIB_FILE} /tmp/x`).permission).toBe("deny");
    expect(ask(`flock --timeout 5 /tmp/lock rm -f ${SIB_FILE}`).permission).toBe("deny");
    // `-c` takes the command as a STRING this lexer does not evaluate, so the target is found by
    // the embedded-path scan instead of the argv walk. Same answer, different route — pinned
    // because a route nothing tests is a route that can be removed by accident.
    expect(ask(`flock /tmp/lock -c "rm -f ${SIB_FILE}"`).permission).toBe("deny");
    // ...and the cap. Uncapped, the walk eats `rm` as a second positional and lands on a flag.
    expect(ask(`flock /tmp/lock rm ${SIB_FILE}`).permission).toBe("deny");
  });

  it("still allows ordinary flock use — the false-deny direction", () => {
    for (const c of [
      "flock /tmp/lock ls -la",
      "flock -n /tmp/lock npm run build",
      "flock -w 5 /tmp/lock echo hi",
      "flock -x /tmp/lock cargo test",
      'flock /tmp/lock -c "ls -la"',
      // Each of these is a flag whose absence from the row is invisible to every deny test above:
      // an unrecognised flag is refused anyway. The false-deny direction is the only place a
      // missing value flag or a missed short bundle can be seen at all.
      "flock --timeout 5 /tmp/lock ls -la",
      "flock -E 9 /tmp/lock ls -la",
      "flock -no /tmp/lock ls -la",
      "flock -u /tmp/lock ls -la",
      "flock --no-fork /tmp/lock ls -la",
    ]) {
      expect(ask(c).permission, c).toBe("allow");
    }
  });

  // The second `positional` wrapper, and the one where the cap is easiest to get wrong: uncapped,
  // the walk eats the username AND the command AND the target, runs out of words, and finds no
  // command at all — which reads as nothing to check rather than as a failure to parse.
  it("does not let su's username stand in for the command", () => {
    expect(ask(`su root rm -f ${SIB_FILE}`).permission).toBe("deny");
    expect(ask(`su - root -c "rm -f ${SIB_FILE}"`).permission).toBe("deny");
    expect(ask(`su -c "rm -f ${SIB_FILE}"`).permission).toBe("deny");
    expect(ask(`su -s /bin/sh root -c "rm -f ${SIB_FILE}"`).permission).toBe("deny");
    expect(ask(`su root --session-command "rm -f ${SIB_FILE}"`).permission).toBe("deny");
    // The cap, with no flag left to fail closed on: uncapped this walks off the end of the argv.
    expect(ask(`su root rm ${SIB_FILE}`).permission).toBe("deny");
  });

  it("still allows ordinary su use — the false-deny direction", () => {
    for (const c of [
      'su root -c "ls -la"',
      'su - deploy -c "npm run build"',
      'su -m root -c "echo hi"',
      'su -s /bin/bash root -c "cargo test"',
      'su --login deploy -c "ls"',
      // One per LONG spelling in the row. Every deny case above fails closed on an unrecognised
      // flag, so none of them can tell a known long form from an unknown one; only these can.
      'su --shell /bin/bash root -c "ls"',
      'su --group wheel root -c "ls"',
      'su --supp-group docker root -c "ls"',
      'su --whitelist-environment PATH root -c "ls"',
      'su --preserve-environment root -c "ls"',
      'su --pty --fast root -c "ls"',
      'su root --session-command "ls -la"',
      "su root ls -la",
    ]) {
      expect(ask(c).permission, c).toBe("allow");
    }
  });

  // `find` is the last §6 hole and the only one that was never a wrapper. Its command sits mid-argv
  // and `-delete` names no command at all, so it gets its own extraction rather than a table row —
  // which is why it is NOT in WRAPPER_PROBES below: PREFIX_VERBS does not carry it, and the
  // enumeration there would fail if it did. Measured before the branch existed: all eight of these
  // were ALLOWED, `find . -name x -exec rm -f <sibling>/y ;` included, whose target is a plain
  // literal with no `{}` anywhere in it.
  it("does not let find's mid-argv command carry the write past", () => {
    for (const c of [
      `find . -name x -exec rm -f ${SIB_FILE} ;`,
      `find . -name x -ok rm -f ${SIB_FILE} ;`,
      `find . -name x -exec sudo rm -f ${SIB_FILE} ;`,
      // `{}` is not a path — the target is what find SEARCHED, which is why the path operands are
      // separated from the expression before either is read.
      `find ${inSib(".")} -name x -exec rm -f {} ;`,
      `find ${inSib(".")} -exec rm -rf {} +`,
      // ...and the two primaries that write with no command named anywhere.
      `find ${inSib(".")} -delete`,
      `find -L ${inSib(".")} -delete`,
      `find . -type f -fprintf ${SIB_FILE} %p`,
    ]) {
      expect(ask(c).permission, c).toBe("deny");
    }
  });

  // ALL THREE FOUND BY FALSIFICATION, not by reading the branch. Injections that deleted the
  // terminator walk and the recursion left every other test in this file green.
  it("reads the rest of the find expression after the -exec terminator", () => {
    // Without the `;`/`+` walk the whole tail becomes arguments of `echo`, and the `-delete`
    // riding behind it is never seen at all.
    expect(ask(`find ${inSib(".")} -exec echo {} + -delete`).permission).toBe("deny");
  });

  it("follows a find nested inside another find's -exec", () => {
    expect(ask(`find . -exec find ${inSib(".")} -delete ;`).permission).toBe("deny");
    expect(ask(`find . -exec find . -exec find ${inSib(".")} -delete ; ;`).permission).toBe("deny");
  });

  // `-execdir` runs in the directory HOLDING each match, so a relative target under it lands
  // somewhere this checker cannot name. That is the spec's class 2: it defers to the normal
  // permission flow rather than being decided here, and it is still not `deny`. An ABSOLUTE target
  // is unaffected by which directory it ran in, and still denies.
  it("reports find -execdir's relative target unknown rather than resolving it here", () => {
    expect(ask("find . -name x -execdir rm -f {} ;").permission).toBe("allow");
    expect(ask(`find . -name x -execdir rm -f ${SIB_FILE} ;`).permission).toBe("deny");
  });

  // THE FALSE-DENY DIRECTION, which is what makes the branch above shippable. `find` is one of the
  // most common commands there is, and a guard that asks about every one of these gets removed.
  it("still allows ordinary find use", () => {
    for (const c of [
      "find . -type f -name *.tmp",
      "find . -name *.orig -exec rm -f {} +",
      "find . -type f -exec chmod 644 {} ;",
      "find . -exec ls -la {} ;",
      "find . -exec grep -rn foo {} +",
      // A glob inside the -exec command. Gated on `w.dynamic` this asked, and nothing noticed.
      "find . -exec rm -f *.log ;",
      "find src -name *.tsx -newer package.json",
      "find . -maxdepth 2 -type d",
    ]) {
      expect(ask(c).permission, c).toBe("allow");
    }
  });

  // Re-entry goes back through the TEXT, so a word carrying shell punctuation would come back as a
  // different command than the one that ran. Those defer rather than guess — including the one
  // shape that matters most, an `-exec` whose command is itself a shell.
  it("does not guess at a find -exec command it cannot spell back", () => {
    for (const c of [
      `find . -exec sh -c "rm -f ${SIB_FILE}" ;`,
      "find . -exec $CMD -f x ;",
      "find . -name x -exec",
      // RELEX itself, pinned in the one direction it is observable. Emptied, this rejoins into
      // two segments — `sometool -x a` and `b` — and every test above still passes, which is the
      // shape of a line that could be deleted without anything noticing.
      `find . -exec sometool -x "a;b" ;`,
    ]) {
      const d = ask(c);
      expect(d.permission, c).toBe("allow");
      expect(d.why, c).toContain("defers to the normal permission flow");
    }
  });

  // THE chrt BUG, MECHANIZED. `chrt` shipped inside a table the spec called complete, carrying no
  // probe of its own, and its positional read as the command. A list of NAMES cannot catch that —
  // it is satisfied by the name being mentioned anywhere. So the table is enumerated instead: every
  // wrapper in it owes a minimal invocation here, and that invocation has to surface the write.
  // Adding a row without adding a probe fails on the equality, before any behaviour is asserted.
  //
  // AND THE LIMIT OF THAT, measured rather than assumed, so nobody spends the afternoon I spent
  // rebuilding it. The obvious next step is to generate a probe per FLAG SPELLING by walking
  // PREFIX_VERBS. It was written, run against six injections, and deleted: a probe generated from
  // the table cannot see a spelling the table never had, cannot see one removed from it, and
  // cannot see a typo either — it dutifully probes the typo and the walk consumes it. Every
  // injection it caught was already caught by a hand-written probe below, and the ones nothing
  // else caught, it missed too. A guard generated from the list it guards is the same vacuity as
  // a list of names, one level down. The realistic per-wrapper probes below are what catch an
  // omission, which is why they are not redundant with each other and must not be thinned.
  const WRAPPER_PROBES = {
    env: "env",
    sudo: "sudo",
    doas: "doas",
    command: "command",
    nohup: "nohup",
    setsid: "setsid",
    nice: "nice -n 10",
    ionice: "ionice -c 2",
    chrt: "chrt -f 10",
    time: "time",
    timeout: "timeout 5",
    stdbuf: "stdbuf -oL",
    xargs: "xargs",
    busybox: "busybox",
    taskset: "taskset 0x3",
    flock: "flock /tmp/lock",
    su: "su root",
  };

  // THE OTHER DIRECTION, and the one that makes the marker cost something. Every name §6 marks
  // open must be a hole that is measurably still there. These assertions expect `allow` on a
  // sibling write, which is the bug — deliberately, and only for as long as the spec claims it.
  // Closing one of these means this file fails until the name leaves the marker and joins
  // WRAPPER_PROBES, which is exactly the three-place update the issue asks for. Nothing here
  // endorses the hole; it pins the claim so the claim cannot go stale in either direction.
  const OPEN_PROBES = {};

  it("proves every wrapper §6 marks open really is still open", () => {
    expect(Object.keys(OPEN_PROBES).sort()).toEqual([...OPEN].sort());
    for (const [name, command] of Object.entries(OPEN_PROBES)) {
      expect(ask(command).permission, `${name} is marked open but no longer walks the write past`).toBe(
        "allow",
      );
    }
  });

  it("probes every wrapper in the table, so an untested row cannot ship", () => {
    expect(Object.keys(WRAPPER_PROBES).sort()).toEqual([...PREFIX_VERBS.keys()].sort());
    for (const [name, prefix] of Object.entries(WRAPPER_PROBES)) {
      expect(ask(`${prefix} rm -f ${SIB_FILE}`).permission, `${name} must not hide the write`).toBe(
        "deny",
      );
    }
  });
});

// The table is an ALLOWLIST, and §6 has to keep saying which members it still does not carry. This
// narrows as each hole closes, and the second assertion is what makes the narrowing mandatory: a
// name the table now carries must have left the spec's open list in the same commit.
describe("the wrapper table is an allowlist, and the spec says which ones are still open (#279)", () => {
  // The marker is read at module scope, not sliced out of the prose. The first version of this
  // test did slice the prose, between two phrases, and failed on its own first run: the sentence
  // cites `chrt` as the precedent for closing these one at a time, and a scan cannot tell a
  // citation from a listing. The assertions below pin the marker and the prose to each other in
  // both directions, so the marker cannot quietly become the only true copy.

  it("names every known-open wrapper, so the gap is documented where the claim is made", () => {
    // PRESENT, not non-empty. With the last hole closed the list is legitimately empty, and the
    // marker still has to exist: deleting it would make every assertion below vacuously true.
    expect(SPEC, "§6 must carry an open-wrappers marker").toMatch(/<!-- open-wrappers:[^>]*-->/);
    for (const w of OPEN) {
      expect(SPEC, `${w} is marked open and the prose of §6 must say so too`).toContain(w);
    }
    expect(SPEC).toMatch(/allowlist/i);
  });

  // FOUND BY BEING WRONG, so it is guarded rather than written down. The marker was narrowed as
  // `flock` and `su` closed, and the sentence beside it still said all three were open — true only
  // of `find`, and nothing checked it, because the old assertion ran one way: names IN the marker
  // must appear in the prose. A closed wrapper still named as open is the same stale claim the
  // marker exists to prevent, so the two are now pinned as sets in both directions.
  it("keeps the prose's own open list identical to the marker", () => {
    const claim = SPEC.match(/Still open and measured: ([^.]*)\./);
    expect(claim, "§6 must state its open list in prose as well as in the marker").toBeTruthy();
    const named = [...claim[1].matchAll(/`([a-z-]+)[^`]*`/g)].map((m) => m[1]);
    expect(named.sort(), "the prose and the marker must name the same set").toEqual([...OPEN].sort());
  });


  it("does not call a wrapper open once the table carries it", () => {
    for (const name of PREFIX_VERBS.keys()) {
      expect(OPEN, `${name} is carried by the table now, so §6 must not mark it open`).not.toContain(name);
    }
  });
});

describe("operands whose value the text or the environment already states are literals (#373)", () => {
  // Measured 2026-09-04: 33 of the 40 approval prompts in one day were `"$S/…"`, `"$TEMP/…"` and
  // `"$LOCALAPPDATA/…"` operands — values stated on the same line or in the process environment,
  // refused as "not knowable" because the lexer reads `$` and stops. The hook change shipped as a
  // patch beside its spec (a session may not edit a hook that gates its own authority without the
  // owner's say), and the assertions below stayed visibly SKIPPED, never vacuously green (memory:
  // green-that-is-not-evidence), until it was applied. APPLIED 2026-09-04 by Cowork HQ under the
  // owner's explicit in-session authorization; the gate below now demands the patch's absence.
  const REPO = join(import.meta.dirname, "../..");
  const PATCH = join(REPO, "docs/superpowers/specs/2026-09-04-shell-guard-knowable-vars-373.patch");
  const applied = typeof hook.expandKnownVars === "function";

  it("the owner-hand patch still applies to the hook as it is — and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch the spec points at must exist").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  describe.skipIf(!applied)("once applied", () => {
    const scratch = fwd(SCRATCH);

    it("a same-command assignment makes a redirect target knowable", () => {
      expect(ask(`S="${scratch}"; cat > "$S/a.md" <<'EOF'\nhi\nEOF`).permission).toBe("allow");
      const { ops, unresolved } = analyze(`S="${scratch}"; cat > "$S/a.md"`, { cwd: ROOT, env: {} });
      expect(unresolved).toEqual([]);
      expect(toComparable(ops[0].target)).toBe(toComparable(join(SCRATCH, "a.md")));
    });

    it("a well-known environment directory is knowable", () => {
      const d = ask(`mkdir -p "$TEMP/p" && cp a.txt "\${TEMP}/p/b.txt"`, { env: { TEMP: scratch } });
      expect(d.permission).toBe("allow");
      expect(d.why).toBe("nothing protected is reached");
    });

    it("a name the text does not bind still defers — the one case that matters", () => {
      const d = ask("rm -rf $TARGET");
      expect(d.permission).toBe("allow");
      expect(d.why).toContain("not knowable from the text");
    });

// FOUND BY INDEPENDENT REVIEW, so it is guarded rather than written down. The first version of
    // this pass treated `(` as an ordinary statement break, so a subshell taught its parent a name:
    // `(S=/scratch); rm $S/x` was judged as `rm /scratch/x` when the shell really runs `rm /x`.
    // Reasoning about a path the command never touches is a FALSE ALLOW, and `X=$(S=…; …)` makes it
    // easy to hit by accident — so a binding is learned only in the outermost scope.
    it("a subshell does not teach its parent a name", () => {
      expect(ask(`(S="${fwd(SIB)}"); rm "$S/package.json"`).permission).toBe("allow");
      expect(ask(`X=$(S="${fwd(SIB)}"; echo hi); rm "$S/package.json"`).permission).toBe("allow");
      expect(ask(`S=\`D="${fwd(SIB)}"; echo x\`; rm "$D/package.json"`).permission).toBe("allow");
      // A value still flows INTO a subshell — inheritance runs one way.
      const inner = analyze(`S="${scratch}"; (cd /tmp; printf x > "$S/a")`, { cwd: ROOT, env: {} });
      expect(toComparable(inner.ops.at(-1).target)).toBe(toComparable(join(SCRATCH, "a")));
    });

    // Same review: the expanded text is RE-LEXED, so a value carrying shell punctuation could invent
    // a statement that never runs. A value is spliced only when it re-lexes as one plain word.
    it("an expansion cannot fabricate shell structure", () => {
      const { ops } = analyze('S="/a;rm -rf /b"; echo $S', { cwd: ROOT, env: {} });
      expect(ops.some((o) => String(o.target).includes("/b"))).toBe(false);
      expect(ask('S="/a b"; rm $S/x').permission).toBe("allow");
      expect(hook.expandKnownVars("S='<<EOF'; echo $S", { env: {} })).toBe("S='<<EOF'; echo $S");
    });

    it("the environment teaches directories only, never an arbitrary name", () => {
      expect(ask("rm -rf $TARGET", { env: { TARGET: scratch, PATH: scratch } }).permission).toBe("allow");
    });

    it("a bound name pointing into a sibling checkout is denied, exactly as the literal is", () => {
      const d = ask(`WT="${fwd(SIB)}"; rm "$WT/package.json"`);
      expect(d.permission).toBe("deny");
      expect(d.zone).toBe(ZONES.SIBLING);
    });

    it("a value the text does not fully state does not teach a name", () => {
      expect(ask('S=$(pwd); rm "$S/x"').permission).toBe("allow");
      expect(ask('S=$OTHER/sub; rm "$S/x"').permission).toBe("allow");
    });

    // FOUND BY INDEPENDENT REVIEW (2026-09-04, second round). `S=/x rm -rf $S/y` has no `;` after
    // the assignment: it is a PREFIX assignment, scoped to rm's environment, and POSIX expands `$S`
    // in that same command with S's PRIOR value. Learning it judged a path the command never
    // touches. Only a command that is nothing but assignments teaches a name.
    it("a prefix assignment teaches nothing - the judged path must be the touched path", () => {
      const d = ask(`S=${scratch} rm -rf $S/y`);
      expect(d.permission).toBe("allow");
      expect(d.why).toContain("not knowable from the text");
      expect(ask(`S=${scratch} T=${scratch} rm -rf $T/y`).permission).toBe("allow");
      // The prior value is what `$S` expands to, and it stands after the prefixed command.
      const { ops } = analyze(`S="${scratch}"; S="${fwd(SIB)}" printf x > "$S/a"; printf y > "$S/b"`, { cwd: ROOT, env: {} });
      expect(ops.map((o) => toComparable(o.target))).toEqual([toComparable(join(SCRATCH, "a")), toComparable(join(SCRATCH, "b"))]);
      // ...while a command that is NOTHING BUT assignments still teaches every one of them.
      const two = analyze(`S="${scratch}" T="${scratch}/t"; printf x > "$T/a"`, { cwd: ROOT, env: {} });
      expect(toComparable(two.ops[0].target)).toBe(toComparable(join(SCRATCH, "t", "a")));
      expect(ask(`S="${scratch}" && printf x > "$S/a"`).permission).toBe("allow");
    });

    it("single quotes are honoured — '$S' is the text, not the value", () => {
      const { ops } = analyze(`S="${scratch}"; printf x > '$S/a'`, { cwd: ROOT, env: {} });
      expect(ops[0].target.endsWith("$S/a")).toBe(true);
    });

    it("a heredoc body cannot teach a name", () => {
      expect(ask(`cat > note.txt <<'EOF'\nS=${fwd(SIB)}\nEOF\nrm "$S/package.json"`).permission).toBe("allow");
    });

    // PowerShell reads the well-known directories only through #553's owner-hand pass
    // (`expandPowerShellEnv`, tested in `lease-store-guard.test.mjs`); its `$s = …` bindings stay
    // unknowable in both states.
    it("expands PowerShell's well-known `$env:` directories only through the #553 pass", () => {
      const want = typeof hook.expandPowerShellEnv === "function" ? scratch : "$env:TEMP";
      expect(hook.expandKnownVars("$env:TEMP", { env: { TEMP: scratch }, dialect: "powershell" })).toBe(want);
      const bound = '$s = "C:/x"; Remove-Item $s';
      expect(hook.expandKnownVars(bound, { env: {}, dialect: "powershell" })).toBe(bound);
    });
  });
});

// A repository-location operand spelled the way the Bash tool spells paths on Windows (#420).
//
// Measured at 8dbb6473 against the shipped hook, with nothing executed: `git -C /c/…/r413 checkout
// -- scripts/land-pr.test.mjs` and `git -C /c/Users/Kuya/code/sentinel-release-truth-256 checkout
// -- package.json` were both ALLOWED, "nothing protected is reached", while the same two writes
// spelled `C:\…` or reached through `cd` were DENIED. Both folders are registered worktrees of this
// repository, so those were writes into a checkout the session does not own. `--git-dir` and
// `--work-tree` escaped the same way, in their joined AND separate forms.
//
// The `cd` branch had already been taught this spelling — `resolveAbsolute`, which calls
// `fromPosixDrive`. The git branch resolved with plain `resolve`, which reads `/c/Users/…` as
// `C:\c\Users\…`: a folder under no checkout, which zones as unprotected. One resolver knew, the
// other did not, and a guard that answers differently per spelling is off.
//
// The repair is "the same resolver, not a second one". These tests do NOT prove that structurally.
// The agreement assertion compares the operand's landing against `resolveAbsolute` ITSELF rather
// than a hard-coded string, which is worth more than a string — the expected value tracks the shared
// resolver instead of freezing today's answer — but it is still a SAMPLE of inputs. An independent
// translator that agreed on those inputs would pass. What the sample actually catches is the
// realistic regression: a hand-rolled path branch that DIVERGES on one of these spellings. Nothing
// here reads the implementation, and nothing here should be cited as forbidding a second one.
//
// The decision assertions go through `posix()`, which is the drive spelling on Windows and an
// ordinary absolute path elsewhere: the defect exists only where a drive letter does, and
// `fromPosixDrive` says so by returning null off Windows.
describe("a git repository-location operand goes through the shared resolver (#420)", () => {
  /** `C:\home\compy-fixture\sentinel` → `/c/home/compy-fixture/sentinel`; unchanged off Windows. */
  const posix = (p) => {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
    return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}` : fwd(p);
  };
  const repoOp = (command, over = {}) => {
    const { ops } = analyze(command, { cwd: ROOT, env: {}, ...over });
    return ops.find((o) => o.kind === "git-repo") ?? null;
  };

  it("denies the two writes #420 measured as allowed, in the spelling that allowed them", () => {
    // The issue's two rows, re-spelled onto the fixture sibling: same operand shape, same verb,
    // same pathspecs, and the fixture stands in for the two registered worktrees it named.
    for (const pathspec of ["scripts/land-pr.test.mjs", "package.json"]) {
      const d = ask(`git -C ${posix(SIB)} checkout -- ${pathspec}`);
      expect(d.permission, pathspec).toBe("deny");
      expect(d.zone, pathspec).toBe(ZONES.SIBLING);
    }
  });

  it("closes the same escape through --git-dir and --work-tree, joined and separate", () => {
    const gitDir = posix(join(SIB, ".git"));
    const workTree = posix(SIB);
    for (const cmd of [
      `git --git-dir=${gitDir} gc`,
      `git --git-dir ${gitDir} gc`,
      `git --work-tree=${workTree} checkout -- package.json`,
      `git --work-tree ${workTree} checkout -- package.json`,
    ]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("deny");
      expect(d.zone, cmd).toBe(ZONES.SIBLING);
    }
  });

  it("survives the quoting, and a space inside the folder name", () => {
    const spaced = posix(join(SIB, "a b"));
    for (const cmd of [
      `git -C "${posix(SIB)}" checkout -- package.json`,
      `git -C "${spaced}" checkout -- package.json`,
      `git -C '${spaced}' checkout -- package.json`,
      `git --git-dir="${posix(join(SIB, "a b", ".git"))}" gc`,
    ]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("deny");
      expect(d.zone, cmd).toBe(ZONES.SIBLING);
    }
  });

  it("leaves the Windows and `C:/` spellings denied, exactly as they already were", () => {
    // These are the rows #420 recorded as correct. The repair must not buy the new spelling by
    // losing an old one.
    for (const [tool, cmd] of [
      ["Bash", `git -C ${fwd(SIB)} checkout -- package.json`],
      ["Bash", `git -C "${fwd(SIB)}" checkout -- package.json`],
      ["Bash", `git -C "${SIB}" checkout -- package.json`],
      ["PowerShell", `git -C "${SIB}" checkout -- package.json`],
      ["PowerShell", `git --git-dir="${join(SIB, ".git")}" gc`],
    ]) {
      const d = ask(cmd, { toolName: tool });
      expect(d.permission, `${tool}: ${cmd}`).toBe("deny");
      expect(d.zone, `${tool}: ${cmd}`).toBe(ZONES.SIBLING);
    }
  });

  it("agrees with `resolveAbsolute` on every spelling sampled here, so a divergent resolver shows up", () => {
    // Sampled agreement, not a structural proof of reuse. The expected value is `resolveAbsolute`
    // itself, so it moves when the shared resolver moves rather than freezing a string; but an
    // independent implementation that happened to agree on these six inputs would pass. This
    // detects divergence, not duplication.
    for (const spelled of [posix(SIB), fwd(SIB), fwd(join(SIB, "a b")), fwd(join(SIB, ".git")), "sub", "../sentinel"]) {
      const op = repoOp(`git -C "${spelled}" checkout -- x.txt`);
      expect(op, spelled).not.toBeNull();
      expect(toComparable(op.target), spelled).toBe(toComparable(resolveAbsolute(spelled, ROOT)));
    }
  });

  it("keeps a relative operand resolving against the directory the command is actually in", () => {
    // Standing in its own claim, `sub` is its own — a false deny here would be the failure mode
    // that gets a guard removed.
    expect(ask("git -C sub checkout -- x.txt").permission).toBe("allow");
    // After a `cd` this checker CAN follow, the same relative operand is a sibling write.
    const d = ask(`cd ${posix(SIB)} && git -C sub checkout -- x.txt`);
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.SIBLING);
  });

  it("defers when the repository operand is not knowable, and never confidently allows", () => {
    for (const cmd of [
      'git -C "$TARGET" checkout -- x.txt',
      "git --git-dir=$D gc",
      "git --work-tree $W checkout -- x.txt",
      // A bare drive-relative form names a per-drive cwd this process does not have. It is
      // unresolvable, not relative-to-here, and saying so is the difference between an honest
      // defer and a confident wrong answer.
      "git -C C:notadrivepath checkout -- x.txt",
    ]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("allow");
      expect(d.why, cmd).toContain("not knowable from the text");
    }
  });

  it("keeps a literal empty `-C` on the directory the command is already in, as git defines it", () => {
    // git documents an empty `-C ""` as leaving the working directory unchanged. The shared resolver
    // rightly calls "" unplaceable, so routing an empty `-C` through it turned a command whose
    // repository IS the effective directory into an `ask` (#420 review).
    for (const empty of ['""', "''"]) {
      // Own checkout: standing in the claim, the repository is the claim's own and the write allowed.
      const own = `git -C ${empty} checkout -- x.txt`;
      expect(ask(own).permission, own).toBe("allow");
      const ownOp = repoOp(own);
      expect(ownOp, own).not.toBeNull();
      expect(toComparable(ownOp.target), own).toBe(toComparable(ROOT));
      // Sibling checkout: after a `cd` this checker can follow, the same no-op stays in the sibling.
      // Unchanged means unchanged; resetting to the session root would name the wrong checkout.
      const sibling = `cd ${posix(SIB)} && git -C ${empty} checkout -- x.txt`;
      const d = ask(sibling);
      expect(d.permission, sibling).toBe("deny");
      expect(d.zone, sibling).toBe(ZONES.SIBLING);
      const sibOp = repoOp(sibling);
      expect(sibOp, sibling).not.toBeNull();
      expect(toComparable(sibOp.target), sibling).toBe(toComparable(SIB));
      // After an earlier `-C`, unchanged is that earlier repository, not the directory before it.
      const chained = `git -C ${posix(SIB)} -C ${empty} checkout -- x.txt`;
      expect(ask(chained).permission, chained).toBe("deny");
      const chainOp = repoOp(chained);
      expect(chainOp, chained).not.toBeNull();
      expect(toComparable(chainOp.target), chained).toBe(toComparable(SIB));
    }
  });

  it("does not stretch that rule to anything else that looks empty", () => {
    // `-C` only, and only exactly empty. No such rule is established here for an empty `--git-dir` or
    // `--work-tree`, so those stay unresolved rather than borrowing `-C`'s. A whitespace-only `-C " "`
    // is not the empty case: git tries to change into it (measured: `cannot change to ' '`). A quoted
    // variable may or may not be empty, and after a `cd` this checker cannot follow there is no known
    // directory for "unchanged" to keep.
    for (const cmd of [
      'git --git-dir="" checkout -- x.txt',
      'git --git-dir "" checkout -- x.txt',
      'git --work-tree="" checkout -- x.txt',
      'git --work-tree "" checkout -- x.txt',
      'git -C " " checkout -- x.txt',
      'git -C "$EMPTY" checkout -- x.txt',
      'cd "$X" && git -C "" checkout -- x.txt',
    ]) {
      expect(ask(cmd).permission, cmd).toBe("allow");
    }
  });

  it("leaves ordinary read-only git alone, in every spelling", () => {
    for (const cmd of [
      `git -C ${posix(SIB)} status --porcelain`,
      `git -C ${posix(SIB)} log --oneline -5`,
      `git -C ${fwd(SIB)} worktree list`,
      `git --git-dir=${posix(join(SIB, ".git"))} rev-parse --git-dir`,
    ]) {
      expect(ask(cmd).permission, cmd).toBe("allow");
    }
  });
});

// A redirect target that is a variable, in the session's own claim: allowed with a line, not asked.
//
// Measured over three weeks and closed 2026-09-18: 228 `ask` decisions came out of this hook, and
// 131 of them were plain shell REDIRECTION and nothing else - `cd "<worktree>" && … > $LOG`,
// `set -e; B=…; … >> $B`. 134 of the 204 Bash asks literally began `cd "…" &&`, so the effective
// directory was spelled in the command and was the session's own lane. The owner accepted every one.
// That is a toll, not a control, and it hangs unattended runs on a keystroke nobody is there to
// press. The residual accepted in exchange is one recoverable file (a redirect writes one path and
// cannot recurse; git restores it), and it is pinned in BOTH directions here - the spared shape and
// the shapes that must keep their prompt - because an exemption that quietly widens is the failure.
describe("the redirect-in-own-claim exemption, pinned in both directions (2026-09-18)", () => {
  const LANE = fwd(ROOT);

  it("allows the measured shape instead of asking, and says so in context", () => {
    // The transcript's commonest row, re-spelled onto the fixture lane. Before this rule: `ask`.
    const d = ask(`cd "${LANE}" && npm run build > $LOG 2>&1`);
    expect(d.permission).toBe("allow");
    expect(d.additionalContext).toContain("Shell ownership");
    expect(d.additionalContext).toContain("redirect");
    // The trade is named in the output, so the reader is not left to infer it.
    expect(d.additionalContext).toContain("131 of 228");
  });

  it("covers the other two spellings the audit counted, and the append form", () => {
    for (const cmd of [
      `cd "${LANE}" && ./run.sh > $LOG`,
      `cd "${LANE}" && set -e; printf x >> $B`,
      // Standing in the claim already, with no `cd` at all: the cwd the hook was handed is the lane.
      `printf x > $OUT`,
      // Two unresolved redirects at once are still only redirects.
      `cd "${LANE}" && printf x > $A 2> $B`,
    ]) {
      expect(ask(cmd).permission, cmd).toBe("allow");
    }
  });

  // ── the five shapes this rule must NOT have touched ────────────────────────────────────────────

  it("still defers on an unresolved operand of a mutating VERB, in every verb family", () => {
    // Only a REDIRECT target is spared with its own note. A verb that can recurse, relocate or
    // rewrite still falls through the generic unresolved-operand path (not the redirect exemption)
    // no matter where it stands, because its blast radius is not one file.
    for (const cmd of [
      `cd "${LANE}" && rm -rf $TARGET`,
      `cd "${LANE}" && rmdir $D`,
      `cd "${LANE}" && mv $A $B`,
      `cd "${LANE}" && cp $A $B`,
      `cd "${LANE}" && sed -i 's/a/b/' $F`,
      `cd "${LANE}" && mkdir -p $D`,
      `cd "${LANE}" && git reset --hard $REF`,
      `cd "${LANE}" && git checkout -- $P`,
      `cd "${LANE}" && git clean -fd $P`,
      `cd "${LANE}" && git config user.name $N`,
      `cd "${LANE}" && find . -name '*.tmp' | xargs rm -f`,
    ]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("allow");
      expect(d.why, cmd).toContain("defers to the normal permission flow instead of being decided here");
      expect(d.additionalContext ?? "", cmd).not.toContain("Shell ownership");
    }
    // The same in PowerShell, including `Out-File`: it is a MUTATING VERB in this checker's table,
    // not a redirect operand, and the exemption is drawn on the redirect OPERATOR - a syntactic
    // category with a hard guarantee of one path and one stream - not on a verb table that has no
    // natural place to stop. Widening it to `Out-File` would have to widen it to `Set-Content` and
    // `New-Item` on the same reasoning, so it was left where the guarantee is.
    for (const cmd of [`Remove-Item $P`, `Move-Item $A $B`, `Out-File -FilePath $log`, `Set-Content $P 'x'`]) {
      const d = ask(cmd, { toolName: "PowerShell" });
      expect(d.permission, cmd).toBe("allow");
      expect(d.why, cmd).toContain("defers to the normal permission flow instead of being decided here");
    }
  });

  it("leaves the opaque interpreters exactly where the class-3 tail already had them", () => {
    // `node`/`python`/`bash -lc` are class 3, not class 2: they were ALREADY decided on the directory
    // they stand in (spec §6), and this rule changes nothing about them. Pinned as UNCHANGED rather
    // than as a defer, because asserting the generic unresolved-operand path for a case this hook
    // never routed there would be a fiction that the next reader would then try to preserve.
    const own = ask(`cd "${LANE}" && node $SCRIPT`);
    expect(own.permission).toBe("allow");
    // Proof it took the old path and not the exemption: no redirect note is attached.
    expect(own.additionalContext ?? "").not.toContain("Shell ownership");
    expect(own.why).toContain("bounded by a directory this session is standing in");
    // And standing anywhere protected that is not its own, this still defers through the generic
    // unresolved-operand path rather than being decided on the strength of the directory.
    const elsewhere = ask(`cd ${fwd(SIB)} && node $SCRIPT`);
    expect(elsewhere.permission).toBe("allow");
    expect(elsewhere.why).toContain("defers to the normal permission flow instead of being decided here");
    const bareCwd = ask(`node -e 'require("fs").writeFileSync("x","")'`, { cwd: SIB });
    expect(bareCwd.permission).toBe("allow");
    expect(bareCwd.why).toContain("defers to the normal permission flow instead of being decided here");
    expect(ask(`cd "${LANE}" && bash -lc "rm ${inSib("x.txt")}"`).permission).toBe("deny");
  });

  it("still DENIES a resolved sibling-checkout target, redirect or not", () => {
    // The whole point of the guard. A redirect whose target IS knowable and lands in another lane is
    // positive knowledge, decided long before this branch is reached.
    expect(ask(`cd "${LANE}" && printf x > ${inSib("package.json")}`).permission).toBe("deny");
    expect(ask(`cd "${LANE}" && printf x > ${inSib("notes.md")} 2> $LOG`).zone).toBe(ZONES.SIBLING);
    // And a spared redirect beside a sibling write does not launder it.
    expect(ask(`cd "${LANE}" && printf x > $LOG; rm -f ${inSib("x.txt")}`).permission).toBe("deny");
  });

  it("still DENIES a resolved protected-global target beside a spared redirect", () => {
    // `~/.claude` is `deny` through the shell; the defer this rule must not have loosened into an
    // allow is the UNKNOWN zone, which an unplaceable global-looking path reaches. Both are pinned.
    expect(ask(`cd "${LANE}" && printf x > ${fwd(join(HOME_CLAUDE, "settings.json"))}`).permission).toBe("deny");
    const d = ask(`cd "${LANE}" && printf x > $LOG && cp a.json ${fwd(join(HOME_CLAUDE, "settings.json"))}`);
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.GLOBAL);
  });

  it("still defers on the wildcard, brace and tilde shapes (#428), from inside the claim", () => {
    // #428's three rows verbatim, now run from the directory this rule exempts redirects in — proof
    // that "standing in your own claim" did not become a general licence. They are RESOLVED ops with
    // a wildcard prefix, never redirects, so they never reach the exemption's own note at all.
    const zone = vi.fn((q) => q.wildcard && (q.target === ".claude/worktrees/" || q.target === ".claude/")
      ? { zone: ZONES.UNKNOWN, abs: inRoot(".claude"), owner: null, why: "contains a registered lane" }
      : fakeZone(q));
    for (const cmd of [`cd "${LANE}" && rm -rf .claude/worktrees/*`, `cd "${LANE}" && rm -rf .claude/work{trees,}`]) {
      const d = ask(cmd, { zone });
      expect(d.permission, cmd).toBe("allow");
      expect(d.additionalContext ?? "", cmd).not.toContain("Shell ownership");
    }
    const tilde = ask(`cd "${LANE}" && rm -rf ~+/x`);
    expect(tilde.permission).toBe("allow");
    expect(tilde.additionalContext ?? "").not.toContain("Shell ownership");
    // And a brace through a variable is still an operand of `rm`, not a redirect.
    const brace = ask(`cd "${LANE}" && rm -rf $D/{a,b}`);
    expect(brace.permission).toBe("allow");
    expect(brace.additionalContext ?? "").not.toContain("Shell ownership");
  });

  it("still refuses a POSIX-drive `cd` into a sibling before the redirect is reached (#420)", () => {
    // `/c/…` is the spelling the Bash tool uses by default, and #420 is the measurement that it must
    // be understood exactly as well as `C:\…` is. If it were not, this rule would read a sibling as
    // "the claim I am standing in" and hand out the exemption.
    const drive = (p) => {
      const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
      return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}` : fwd(p);
    };
    const d = ask(`cd ${drive(SIB)} && printf x > $LOG`);
    expect(d.permission).toBe("allow");
    expect(d.why).toContain("defers to the normal permission flow instead of being decided here");
    expect(ask(`cd ${drive(SIB)} && printf x > out.log`).permission).toBe("deny");
    // The same spelling of its OWN lane is the exemption, so the two are being told apart.
    expect(ask(`cd ${drive(ROOT)} && printf x > $LOG`).permission).toBe("allow");
  });

  it("still defers, not exempts, when the effective cwd is not inside this session's own claim", () => {
    // `unprotected` is NOT enough: the class-3 tail accepts it, the redirect exemption does not — an
    // unresolved redirect from outside the claim still falls through to the generic unresolved-operand
    // path, distinguishable from the exemption by its own wording and the absence of its note.
    const notExempt = (d, label) => {
      expect(d.permission, label).toBe("allow");
      expect(d.why, label).toContain("defers to the normal permission flow instead of being decided here");
      expect(d.additionalContext ?? "", label).not.toContain("Shell ownership");
    };
    notExempt(ask(`cd ${fwd(SCRATCH)} && printf x > $LOG`), "scratch cd");
    // A `cd` this checker cannot follow leaves the directory unknown, which keeps it out of the exemption.
    notExempt(ask(`cd $D && printf x > $LOG`), "unknown cd");
    // Standing in a sibling is the case the guard exists for.
    notExempt(ask(`cd ${fwd(SIB)} && printf x > $LOG`), "sib cd");
    // And the hook's own cwd, with no `cd` at all, is judged the same way.
    notExempt(ask(`printf x > $LOG`, { cwd: SIB }), "sib bare cwd");
    notExempt(ask(`printf x > $LOG`, { cwd: SCRATCH }), "scratch bare cwd");
  });

  it("carries the unclaimed-folder advisory beside the exemption rather than replacing it", () => {
    // The #368 advisory attaches to a RESOLVED own-claim write, so the pairing shows up on a command
    // that has both: one resolved write into the lane, one unresolvable redirect. Both lines are
    // context, neither swallows the other, and neither becomes a `permissionDecision`.
    const both = ask(`cd "${LANE}" && printf y > ${inRoot("a.txt")}; printf x > $LOG`, { verify: UNCLAIMED });
    expect(both.permission).toBe("allow");
    expect(both.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(both.additionalContext).toContain("Shell ownership");
    // The exemption alone reaches no resolved own-claim target, so it carries only its own line —
    // and verification does not gate it, exactly as class 2 and class 3 are not gated by it.
    const alone = ask(`cd "${LANE}" && printf x > $LOG`, { verify: UNCLAIMED });
    expect(alone.permission).toBe("allow");
    expect(alone.additionalContext).toContain("Shell ownership");
    // A live disagreement about the folder is still a deny, exemption or not.
    expect(ask(`cd "${LANE}" && printf y > ${inRoot("a.txt")}; printf x > $LOG`, { verify: MISMATCH }).permission).toBe("deny");
  });
});

// FOUND BY INDEPENDENT REVIEW of the exemption above, and it was a real escape, not a quibble:
//
//   cd "<own lane>" && echo hi > `rm -rf ../<other lane>/src`     branch: ALLOW    main: ask
//
// The whole mechanism is in this file's own lexer. The backtick is not in `OPERATORS`, so `lex`
// folds the substitution into ordinary words; `segments` takes the single word after `>` as the
// redirect target (`` `rm ``) and scatters the rest into the `echo` segment, whose verb mutates
// nothing. `ops` came back EMPTY and the lone unresolved entry was a `redirection` standing in the
// session's own claim - precisely the shape the exemption spares. The `$( … )` spelling of the same
// command was DENIED all along, because `(`/`)` are operators and `CHAIN_OPS` boundaries, so the
// inner `rm` re-segments and zones as a sibling. Same semantics, opposite answers.
//
// The exemption's stated rationale - "a redirect writes one path and cannot recurse" - is true of
// the OPERATOR and false of a command hiding in its operand, so the fix is to require the operand to
// be a plain name. Every spelling below is pinned because the next leak will be a spelling nobody
// wrote down, and a blacklist of them is a list this lexer will outrun.
describe("no command may hide in a spared redirect operand (review of the 2026-09-18 exemption)", () => {
  const LANE = fwd(ROOT);
  const TREE = inSib("src");
  // Backticks inside template literals are noise; build these by concatenation, as the repro is
  // quoted in the issue.
  const tick = (body) => `cd "${LANE}" && echo hi > \`${body}\``;

  it("defers, never exempts, on the reviewer's backtick repro, from inside the claim", () => {
    const d = ask(tick(`rm -rf ${TREE}`));
    expect(d.permission).toBe("allow");
    // It defers for the right reason: the redirect operand, not something incidental.
    expect(d.why).toContain("not knowable from the text");
    // And the exemption's context line is NOT attached - it was not spared, it was deferred.
    expect(d.additionalContext ?? "").not.toContain("Shell ownership");
  });

  it("still DENIES the $( … ) spelling, which never leaked", () => {
    // Unchanged by the fix, and pinned so the two spellings can never drift apart again.
    expect(ask(`cd "${LANE}" && echo hi > $(rm -rf ${TREE})`).permission).toBe("deny");
    expect(ask(`cd "${LANE}" && echo hi >$(rm -rf ${TREE})`).permission).toBe("deny");
  });

  it("still ALLOWS a plain variable operand - the exemption itself still works", () => {
    for (const cmd of [
      `cd "${LANE}" && echo hi > $LOG`,
      `cd "${LANE}" && echo hi > \${LOG}`,
      `cd "${LANE}" && echo hi > "$LOG/a.txt"`,
      `cd "${LANE}" && echo hi > logs/$RUN/out.txt`,
      `cd "${LANE}" && echo a > $A 2> $B`,
    ]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("allow");
      expect(d.additionalContext, cmd).toContain("Shell ownership");
    }
  });

  it("never spares any nesting or quoting of a substitution that reaches the operand", () => {
    // The next most likely leaks, in the order a reader would try them. Each is a generic defer (the
    // operand itself is not vouched for) or `deny` (the inner command re-segmented into a sibling
    // write); what none of them may do is carry the redirect exemption's own "spared" note.
    const spellings = [
      tick(`rm -rf ${TREE}`),                                    // the repro
      `cd "${LANE}" && echo hi >\`rm -rf ${TREE}\``,             // no space after `>`
      tick(`rm -rf \\\`pwd\\\`/${TREE}`),                        // nested backticks
      tick(`$(rm -rf ${TREE})`),                                 // `$(` inside backticks
      `cd "${LANE}" && echo hi > $(\`rm -rf ${TREE}\`)`,         // backtick inside `$( )`
      `cd "${LANE}" && echo hi > "\`rm -rf ${TREE}\`"`,          // double-quoted backtick
      `cd "${LANE}" && echo hi > "$(rm -rf ${TREE})"`,           // double-quoted `$( )`
      `cd "${LANE}" && echo hi > \${X:-$(rm -rf ${TREE})}`,      // substitution inside an expansion
      `cd "${LANE}" && echo hi > >(rm -rf ${TREE})`,             // process substitution
      `cd "${LANE}" && echo hi >> \`rm -rf ${TREE}\``,           // the append operator
      `cd "${LANE}" && echo hi 2> \`rm -rf ${TREE}\``,           // a numbered fd
      `cd "${LANE}" && echo hi &> \`rm -rf ${TREE}\``,           // the combined form
      // A spared operand beside a refused one does not launder the command.
      `cd "${LANE}" && echo a > $A; echo b > \`rm -rf ${TREE}\``,
    ];
    for (const cmd of spellings) {
      const d = ask(cmd);
      expect(["allow", "deny"], cmd).toContain(d.permission);
      expect(d.additionalContext ?? "", cmd).not.toContain("Shell ownership");
    }
  });

  // WHY THE PREDICATE IS A WHITELIST. The review prescribed rejecting a raw containing a backtick or
  // `$(`, borrowing `globBounded`'s `[^$\`]`. Measured against this lexer that is NOT sufficient:
  // for `> $(rm -rf x)` the `(` is an OPERATOR, so it never reaches the operand token and the raw is
  // the single character `$`. A substring search for `$(` finds nothing and spares it. These two
  // rows are the ones a blacklist lets through, so they are pinned separately from the rest.
  it("never spares an operand the lexer reduced to a bare `$`, which a substring blacklist would spare", () => {
    // The inner command here writes nothing protected, so re-segmentation cannot save it - only the
    // operand test can. Before the whitelist these were ALLOW through the exemption itself (with its
    // note); now they still land on `allow`, but only through the generic defer, never the exemption.
    for (const cmd of [`cd "${LANE}" && echo hi > $(date)/x`, `cd "${LANE}" && echo hi > $((1+1))/x`, `cd "${LANE}" && echo hi > $((1+1))`]) {
      const d = ask(cmd);
      expect(d.permission, cmd).toBe("allow");
      expect(d.additionalContext ?? "", cmd).not.toContain("Shell ownership");
    }
    // And the neighbouring non-name expansions, not spared for the same reason: conservative, and
    // exactly the answer main gave (as `ask`, before this hook stopped issuing prompts of its own).
    for (const operand of ["$1", "$?", "${X:-y}", "a$"]) {
      const d = ask(`cd "${LANE}" && echo hi > ${operand}`);
      expect(d.permission, operand).toBe("allow");
      expect(d.additionalContext ?? "", operand).not.toContain("Shell ownership");
    }
  });

  it("carries the operand's raw text on the unresolved record, which is what the test reads", () => {
    // The predicate cannot be written at all unless `analyze` keeps the raw operand; pinning it here
    // means a refactor that drops it fails loudly instead of silently re-opening the hole.
    const { unresolved } = analyze(`cd "${LANE}" && echo hi > $LOG`, { cwd: ROOT, home: HOME, env: {} });
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].verb).toBe("redirection");
    expect(unresolved[0].raw).toBe("$LOG");
    // A record with no raw at all must never be spared - the predicate requires a string.
    const bare = analyze("cd " + LANE + " && echo hi > `rm -rf x`", { cwd: ROOT, home: HOME, env: {} });
    expect(bare.unresolved[0].raw).toContain("`");
  });

  it("answers the PowerShell spellings on PowerShell's own grammar, not bash's", () => {
    const psAsk = (command) => ask(command, { toolName: "PowerShell" });
    // PowerShell has no backtick substitution - the backtick is its ESCAPE character - so
    // `> \`rm …\`` names a literal file in the lane. It is allowed as a RESOLVED own-claim write,
    // never through the exemption, and the absence of the context line is what proves which path it
    // took. Answering this one on bash's grammar would be a false prompt on ordinary PowerShell.
    const escaped = psAsk(`Set-Location "${LANE}"; echo hi > \`rm -rf ${TREE}\``);
    expect(escaped.permission).toBe("allow");
    expect(escaped.additionalContext ?? "").not.toContain("Shell ownership");
    // PowerShell's substitution is `$( … )`, and it is denied exactly as the bash form is.
    expect(psAsk(`Set-Location "${LANE}"; echo hi > $(Remove-Item -Recurse ${TREE})`).permission).toBe("deny");
    // A plain variable is still the spared case in this dialect too.
    expect(psAsk(`Set-Location "${LANE}"; echo hi > $log`).permission).toBe("allow");
  });
});

// The exemption pinned through `run` - the wiring, not just the decision.
//
// A production probe reported the plain-variable exemption as `ask`, which would have meant the
// whole rule was dead and the 131 prompts it exists to remove were still there. It was not: the
// probe called `decideShell({ root, verdict })` where the parameter names are `sessionRoot` and
// `verify`, so `sessionRoot` arrived undefined. Measured against the live `zoneOf`, a session that
// does not say which root it is in gets `sibling-checkout` for its OWN lane - "a checkout, from a
// session that is in none" - so `cwdZone` was not `own-claim`, the exemption correctly declined, and
// the answer was `ask`.
//
// FAILING CLOSED THERE IS RIGHT, so nothing about the rule changes. What was missing is a test that
// exercises the PARAMETER NAMES: every case above hands `decideShell` a hand-built argument object,
// so a caller wiring it wrongly - or a rename of `sessionRoot`/`verify` - silently turns the
// exemption off in production while every test stays green. `run` is the real caller and does the
// real wiring, so the exemption is pinned through it here, end to end and onto the wire.
describe("the exemption survives the real wiring, not just a hand-built argument object", () => {
  const LANE = fwd(ROOT);
  const SPARED = `cd "${LANE}" && npm run build > $LOG 2>&1`;

  const hookInput = {
    tool_name: "Bash",
    tool_input: { command: SPARED },
    cwd: ROOT,
    session_id: "sess-secret-02",
    transcript_path: "/private/transcript.jsonl",
  };

  it("ALLOWS the plain-variable redirect through `run`, the production entry point", () => {
    // If this had existed, a wiring break would have failed here instead of in a probe.
    const d = run({ hookInput, env: { CLAUDE_PROJECT_DIR: ROOT }, verify: VERIFIED, zone: fakeZone, home: HOME });
    expect(d.permission).toBe("allow");
    expect(d.additionalContext).toContain("Shell ownership");
  });

  it("puts that allow on the wire as additionalContext ALONE, leaking nothing", () => {
    let wrote = "";
    const d = run({ hookInput, env: { CLAUDE_PROJECT_DIR: ROOT }, verify: VERIFIED, zone: fakeZone, home: HOME });
    expect(emit(d, { write: (s) => (wrote += s) })).toBe(0);
    const payload = JSON.parse(wrote);
    expect(Object.keys(payload.hookSpecificOutput).sort()).toEqual(["additionalContext", "hookEventName"]);
    // Never a `permissionDecision: "allow"` - that would skip the prompt AND the auto-mode
    // classifier for the call, which is broader than this rule means (#368's shape).
    expect("permissionDecision" in payload.hookSpecificOutput).toBe(false);
    expect(payload.hookSpecificOutput.additionalContext).toContain("Shell ownership");
    expect(wrote).not.toContain("sess-secret-02");
    expect(wrote).not.toContain("transcript");
  });

  // Mirrors the live resolver on the one axis this is about. Measured against the real `zoneOf`:
  // `zoneOf({ target: <the lane>, sessionRoot: <the lane> })` is `own-claim`, and the same call with
  // `sessionRoot` omitted is `sibling-checkout`, "a checkout, from a session that is in none".
  const rootAwareZone = ({ target, sessionRoot, cwd }) => {
    const abs = resolveAbsolute(target, cwd);
    if (!abs) return { zone: ZONES.UNKNOWN, abs: null, owner: null, why: "the fixture cannot place it" };
    if (sessionRoot && isWithin(abs, sessionRoot)) {
      return { zone: ZONES.OWN, abs, owner: sessionRoot, why: "inside the session root" };
    }
    if (isWithin(abs, ROOT) || isWithin(abs, SIB)) {
      return { zone: ZONES.SIBLING, abs, owner: ROOT, why: "a checkout, from a session that is in none" };
    }
    return fakeZone({ target, cwd });
  };

  it("LOSES THE EXEMPTION when the session root is missing - an unrooted session defers instead of being spared", () => {
    const withRoot = decideShell({
      toolName: "Bash", toolInput: { command: SPARED }, sessionRoot: ROOT, cwd: ROOT,
      verify: VERIFIED, zone: rootAwareZone, home: HOME, env: {},
    });
    expect(withRoot.permission).toBe("allow");
    expect(withRoot.additionalContext).toContain("Shell ownership");

    // The probe's shape: no `sessionRoot` reaches the decision at all. Still `allow` (this hook never
    // issues its own prompt), but through the generic unresolved-operand defer, not the exemption -
    // the missing `additionalContext` is what proves the exemption itself declined.
    const unrooted = decideShell({
      toolName: "Bash", toolInput: { command: SPARED }, cwd: ROOT,
      verify: VERIFIED, zone: rootAwareZone, home: HOME, env: {},
    });
    expect(unrooted.permission).toBe("allow");
    expect(unrooted.why).toContain("defers to the normal permission flow instead of being decided here");
    expect(unrooted.additionalContext ?? "").not.toContain("Shell ownership");
  });

  it("pins the record the predicate reads, so neither field can go missing unnoticed", () => {
    // The two hypotheses that would each have made the exemption silently dead: a `raw` that never
    // arrives (the predicate requires a string and fails closed), and a `raw` carrying quoting or
    // the operator rather than the bare token.
    const { ops, unresolved } = analyze(SPARED, { cwd: ROOT, home: HOME, env: {} });
    expect(ops).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ verb: "redirection", kind: "mutation", raw: "$LOG", cwdUnknown: false });
    // Exactly the bare token: no `>`, no surrounding quotes, no whitespace.
    expect(unresolved[0].raw).toBe("$LOG");
    expect(toComparable(unresolved[0].cwd)).toBe(toComparable(ROOT));
  });
});

// The operand test must be LINEAR, and that is a correctness property, not a performance nicety.
//
// The first cut of the whitelist was one alternation:
//
//   /^(?:[^$`]|\$[A-Za-z_][A-Za-z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\})*$/
//
// `[^$\`]` and the tail of `\$[A-Za-z_][A-Za-z0-9_]*` both match `[A-Za-z0-9_]`, so each `$`-run has
// as many parses as its length and the parses multiply; on a NON-matching input the engine explores
// every one. Measured on the predicate alone: n=5 0.45ms, n=6 2.6ms, n=7 26ms, n=8 170ms, n=9
// 1160ms - about 7x per added run. Through `decideShell`, where it runs at least twice per operand,
// n=9 took 2391ms; driven against the real hook process, whose `.claude/settings.json` timeout is 10
// seconds, an 82-character operand was KILLED having emitted nothing.
//
// THAT IS A SECURITY BUG, NOT A SLOW TEST. A hook that emits nothing has no opinion, so the call
// falls through to the normal permission flow - and `origin/main` answers `ask` for that same
// command. A crafted operand therefore deleted this guard's opinion and burned a core for ten
// seconds, from ANY directory, because the operand test runs before `cwdZone`. The regex did not
// exist on main; it arrived with the exemption.
//
// These tests exist so that a future reader who "simplifies" the two passes back into one readable
// alternation gets a red test instead of a silently disarmed guard.
describe("the redirect-operand test is linear, and stays linear (ReDoS regression)", () => {
  const LANE = fwd(ROOT);
  /** n runs of `$aaaaaaaa`, then a backtick so the match FAILS - the expensive direction. */
  const pathological = (n) => "$" + Array.from({ length: n }, () => "aaaaaaaa").join("$") + "`";

  it("agrees with the original alternation on the whole refuse/spare table", () => {
    // Equivalence, asserted operand by operand. The left column is what the rule must spare; the
    // right is everything the review and the reviewer between them could think of that must not be.
    for (const spare of ["$LOG", "${LOG}", "$env:TEMP\\a.log", "logs/$RUN/out.txt", '"$LOG/a.txt"', "out.log", "a$b"]) {
      expect(hook.isPlainRedirectName(spare), spare).toBe(true);
    }
    for (const refuse of [
      "$'\\x78'", "${!X}", "${X:-y}", "$1", "$?.log", "a$", "$[1+1]", "$((1+1)).log", "$(date)/x",
      '"`rm -rf x`"', '"$(rm -rf x)"', "`rm", "$", "${X:-$", "$?", "$$LOG", "${LOG", "$-", "${}",
    ]) {
      expect(hook.isPlainRedirectName(refuse), refuse).toBe(false);
    }
  });

  it("agrees with the original alternation on random strings, not just the ones we thought of", () => {
    // A differential check against the very regex that was replaced. It is cheap here only because
    // the inputs are short - the old one cannot be run on the long ones at all, which is the point.
    const OLD = /^(?:[^$`]|\$[A-Za-z_][A-Za-z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\})*$/;
    const alphabet = ["$", "{", "}", "a", "_", "1", "`", "/", ".", ":", "-", '"', "(", ")", "?"];
    for (let i = 0; i < 20000; i += 1) {
      const n = 1 + (i % 7);
      let s = "";
      for (let j = 0; j < n; j += 1) s += alphabet[Math.floor(Math.random() * alphabet.length)];
      expect(hook.isPlainRedirectName(s), s).toBe(OLD.test(s));
    }
  });

  it("decides a pathological operand well inside the hook's budget", () => {
    // Generous on purpose - 250ms is far above what a linear scan needs (measured: 0.1ms) and far
    // below the hook's 10s timeout, so it is not flaky on a loaded machine but still fails loudly if
    // the alternation comes back. The old predicate took 2391ms at n=9 and did not finish at n=12.
    const cmd = `cd "${LANE}" && echo hi > ${pathological(12)}`;
    const started = Date.now();
    const d = ask(cmd);
    const elapsed = Date.now() - started;
    expect(elapsed, `took ${elapsed}ms - the operand test is backtracking again`).toBeLessThan(250);
    // Silence is the failure mode that matters: no answer means the guard has no opinion.
    expect(d.permission).toBe("allow");
  });

  it("still ANSWERS on the pathological operand, and never spares it", () => {
    // Every length, including ones the old predicate could never have returned from. This hook no
    // longer issues its own prompt for this case (`origin/main` still does), but the guard's opinion
    // is preserved as a defer, not silence, and never as the redirect exemption's own note.
    for (const n of [8, 9, 12, 20, 64]) {
      const d = ask(`cd "${LANE}" && echo hi > ${pathological(n)}`);
      expect(d.permission, `n=${n}`).toBe("allow");
      expect(d.why, `n=${n}`).toContain("defers to the normal permission flow instead of being decided here");
      expect(d.additionalContext ?? "", `n=${n}`).not.toContain("Shell ownership");
    }
    // A long but ORDINARY operand is still spared - the fix did not buy its speed by refusing more.
    expect(ask(`cd "${LANE}" && echo hi > ${"logs/deep/".repeat(40)}$RUN.log`).permission).toBe("allow");
  });
});
