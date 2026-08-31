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

import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ZONES, isWithin, resolveAbsolute, toComparable } from "../../.claude/hooks/target-ownership.mjs";
import {
  OFF_SWITCH,
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

  it("asks for the owner's global configuration instead of deciding it here", () => {
    const d = ask(`cp ${fwd(join(SCRATCH, "settings.json"))} ${fwd(join(HOME_CLAUDE, "settings.json"))}`);
    expect(d.permission).toBe("ask");
    expect(d.zone).toBe(ZONES.GLOBAL);
    expect(d.reason).toContain("outside every repository guard");
  });

  it("expands `~` before deciding, so the global config cannot be reached by another spelling", () => {
    expect(ask(`rm ~/.claude/settings.json`).permission).toBe("ask");
    expect(ask(`rm '~/.claude/settings.json'`).permission).toBe("ask");
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

  it("routes the same restore aimed at the owner's global config to explicit approval", () => {
    const d = ask(`cp ${fwd(join(SCRATCH, "settings.json"))} ${fwd(join(HOME_CLAUDE, "settings.json"))}`);
    expect(d.permission).toBe("ask");
    expect(d.zone).toBe(ZONES.GLOBAL);
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
