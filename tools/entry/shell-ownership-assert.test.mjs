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

import { readFileSync } from "node:fs";
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
  it("denies a write inside its own folder when the session is not verified", () => {
    const d = ask(`printf 'x' > ${inRoot("src/App.css")}`, { verify: UNCLAIMED });
    expect(d.permission).toBe("deny");
    expect(d.zone).toBe(ZONES.OWN);
    expect(d.code).toBe("FOLDER_UNCLAIMED");
    // The cure has to be in the refusal, or a blocked session has nowhere to go.
    expect(d.reason).toContain("tools/entry/cli.mjs adopt");
    expect(d.reason).toContain("the shell is not a way around it");
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
    expect(d.permission).toBe("ask");
    expect(d.zone).toBe(ZONES.UNKNOWN);
    expect(d.reason).toContain("not evidence that it is outside");
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
    // legitimate case and routes. A shell has none. It matters which one this is, because `ask` is a
    // ROUTING decision and this machine runs `permissions.defaultMode: "auto"`, where a routed
    // decision degrades to allow — leaving the folder that holds the rules about what agents may do
    // exactly as writable as before the guard existed.
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
    expect(ask(`rm -rf $TARGET`, { verify: UNCLAIMED }).permission).toBe("ask");
    // An interpreter body standing in someone else's checkout.
    expect(ask(`node -e 'require("fs").writeFileSync("x","")'`, { cwd: SIB }).permission).toBe("ask");
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
    expect(ask("rm -f ../*/dist/*.map").permission).toBe("ask");
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
    // A splat naming nothing protected comes back `ask`, not `allow`, and that is the honest answer
    // rather than a leftover: the hashtable is just as unreadable when its contents are harmless.
    // `ask` is where every operand this checker cannot resolve already lands.
    expect(ps(`$p = @{ Path = '${inRoot("README.md")}' }; Remove-Item @p`).permission).toBe("ask");
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
    expect(ask("git tag -l 'v*'", { verify: UNCLAIMED }).permission).toBe("allow");
    expect(ask("git branch --list 'lane/*'", { verify: UNCLAIMED }).permission).toBe("allow");
    expect(ask("git show-ref --heads", { verify: UNCLAIMED }).permission).toBe("allow");
    expect(ask("git branch", { verify: UNCLAIMED }).permission).toBe("allow");

    // Without a listing flag the positional is a name being CREATED, and `-d` deletes: still writes.
    expect(ask("git tag v1.0", { verify: UNCLAIMED }).permission).not.toBe("allow");
    expect(ask("git branch -d old", { verify: UNCLAIMED }).permission).not.toBe("allow");
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
    expect(ask("cd $D && rm x.txt").permission).toBe("ask");
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

  it("says nothing at all on an allow", () => {
    let wrote = "";
    expect(emit({ permission: "allow" }, { write: (s) => (wrote += s) })).toBe(0);
    expect(wrote).toBe("");
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
    // target — and it takes the approval path rather than the class-3 tail's owned-CWD pass.
    expect(ask(`sudo --made-up-flag rm -f ${SIB_FILE}`).permission).not.toBe("allow");
    expect(ask("sudo --made-up-flag rm -f ./local.txt").permission).not.toBe("allow");
  });

  it("stays honest about xargs, whose real targets can arrive on stdin", () => {
    // The step-over reaches the argv TEMPLATE only. With no operand spelled there, the targets come
    // from a pipe this checker never evaluates, so it is unresolved rather than clean.
    expect(ask("find . -name '*.tmp' | xargs rm -f").permission).not.toBe("allow");
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
  // somewhere this checker cannot name. That is `ask`, not `allow` and not `deny`: the spec's
  // class 2. An ABSOLUTE target is unaffected by which directory it ran in, and still denies.
  it("reports find -execdir's relative target unknown rather than resolving it here", () => {
    expect(ask("find . -name x -execdir rm -f {} ;").permission).toBe("ask");
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
  // different command than the one that ran. Those refuse rather than guess — including the one
  // shape that matters most, an `-exec` whose command is itself a shell.
  it("refuses to guess at a find -exec command it cannot spell back", () => {
    for (const c of [
      `find . -exec sh -c "rm -f ${SIB_FILE}" ;`,
      "find . -exec $CMD -f x ;",
      "find . -name x -exec",
      // RELEX itself, pinned in the one direction it is observable. Emptied, this rejoins into
      // two segments — `sometool -x a` and `b` — and every test above still passes, which is the
      // shape of a line that could be deleted without anything noticing.
      `find . -exec sometool -x "a;b" ;`,
    ]) {
      expect(ask(c).permission, c).not.toBe("allow");
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
