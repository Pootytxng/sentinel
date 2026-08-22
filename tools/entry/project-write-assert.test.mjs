// Guard for the write refusal (#125 step 3) — spec
// docs/superpowers/specs/2026-08-21-unverified-session-write-refusal.md §3b, §6.
//
// This hook can, if it is wrong, stop the machine from repairing it. So the properties below are not
// "does it deny" — they are the four ways a wrong version of this file would hurt:
//
//   * it refuses something that is not a project write (the scratchpad, %TEMP%, a sibling repo),
//   * it refuses without saying how to get back in, or prints a cure that would itself refuse,
//   * it grows its own copy of the identity rules and drifts away from the assert,
//   * it quietly persists a session record from a PreToolUse hook that fires on every write.
//
// Everything is driven through the injected seams (`verify`, `issueLookup`, fabricated hook input),
// so no test here touches the real launch store or this machine's live verification state.

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as tracked from "../../.claude/hooks/session-root-assert.mjs";
import {
  GUARDED_TOOLS,
  adoptCommand,
  decide,
  emit,
  isInsideRoot,
  knownIssueFor,
  run,
  targetOf,
} from "../../.claude/hooks/project-write-assert.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_FILE = join(HERE, "..", "..", ".claude", "hooks", "project-write-assert.mjs");
const SOURCE = readFileSync(HOOK_FILE, "utf8");

const ROOT = "C:\\Users\\Kuya\\code\\sentinel-home-room";
const SESSION = "11111111-2222-3333-4444-555555555555";

const write = (over = {}) => ({
  toolName: "Write",
  toolInput: { file_path: `${ROOT}\\src\\App.css` },
  verdict: { ok: false, code: "NO_TOKEN", reason: "…" },
  root: ROOT,
  sessionId: SESSION,
  cwd: ROOT,
  knownIssue: null,
  ...over,
});

describe("one implementation of identity — the hook asks, it does not decide", () => {
  it("imports verifySession from the tracked assert rather than reimplementing it", () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*\bverifySession\b[^}]*\}\s*from\s*"\.\/session-root-assert\.mjs"/s);
  });

  it("carries none of the assert's refusal codes as literals of its own", () => {
    // If this file ever names ROOT_MISMATCH or SESSION_FOREIGN itself, it has started deciding
    // identity, which is the drift this test exists to catch. It may name the two exported SETS.
    for (const code of ["ROOT_MISMATCH", "SESSION_FOREIGN", "LINEAGE_FOREIGN", "WINDOW_MISMATCH"]) {
      expect(SOURCE, `${code} is decided by session-root-assert.mjs, not here`).not.toContain(`"${code}"`);
    }
  });

  it("reads the UNVERIFIABLE / LAPSED split as data instead of re-listing the codes", () => {
    expect(SOURCE).toMatch(/\bUNVERIFIABLE_CODES\b/);
    expect(SOURCE).toMatch(/\bLAPSED_CODES\b/);
    expect(SOURCE).not.toContain('"LAUNCH_SPENT"');
    expect(SOURCE).not.toContain('"TOKEN_EXPIRED"');
  });

  it("never persists — a hook that fires on every write must not establish identity", () => {
    let sawPersist = null;
    run({
      hookInput: { tool_name: "Read", tool_input: {}, cwd: ROOT, session_id: SESSION },
      env: { CLAUDE_PROJECT_DIR: ROOT },
      verify: (args) => {
        sawPersist = args.persist;
        return { ok: true, mode: "resume" };
      },
      issueLookup: () => null,
    });
    expect(sawPersist).toBe(false);
  });
});

describe("what is and is not a project write", () => {
  it("guards exactly the three tools that change a file, and not Bash (the named hole, spec §3c)", () => {
    expect([...GUARDED_TOOLS].sort()).toEqual(["Edit", "NotebookEdit", "Write"]);
    expect(decide(write({ toolName: "Bash", toolInput: { command: "sed -i s/a/b/ src/App.css" } })).allow).toBe(true);
  });

  it("reads the target from either field, and allows a shape it does not recognize", () => {
    expect(targetOf({ file_path: "a" })).toBe("a");
    expect(targetOf({ notebook_path: "b" })).toBe("b");
    expect(targetOf({ path: "c" })).toBeNull();
    expect(decide(write({ toolInput: { path: "c" } })).allow).toBe(true);
  });

  it("refuses a NotebookEdit inside the project the same as a Write", () => {
    const d = decide(write({ toolName: "NotebookEdit", toolInput: { notebook_path: `${ROOT}\\notes.ipynb` } }));
    expect(d.allow).toBe(false);
  });

  it("never refuses a path outside the project root", () => {
    for (const outside of [join(tmpdir(), "scratch.txt"), "C:\\Users\\Kuya\\code\\sentinel\\src\\App.css", "D:\\x.md"]) {
      expect(decide(write({ toolInput: { file_path: outside } })).allow, outside).toBe(true);
    }
  });

  it("does not mistake a sibling folder whose name STARTS with the root for a child", () => {
    // `sentinel-home-room` vs `sentinel-home-room-2`: a naive startsWith on the string refuses the
    // second, which is a different checkout entirely.
    expect(isInsideRoot(`${ROOT}-2\\src\\App.css`, ROOT)).toBe(false);
    expect(isInsideRoot(`${ROOT}\\src\\App.css`, ROOT)).toBe(true);
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
  });

  it("resolves a relative target against the session cwd, and collapses an escape out of the root", () => {
    expect(isInsideRoot("src\\App.css", ROOT, { cwd: ROOT })).toBe(true);
    expect(isInsideRoot("..\\sentinel\\src\\App.css", ROOT, { cwd: ROOT })).toBe(false);
    expect(decide(write({ toolInput: { file_path: "..\\elsewhere\\x.md" } })).allow).toBe(true);
  });

  it("allows every write once the session is verified", () => {
    expect(decide(write({ verdict: { ok: true, mode: "resume" } })).allow).toBe(true);
    expect(decide(write({ verdict: { ok: true, mode: "launch" } })).allow).toBe(true);
  });
});

describe("the refusal ships its cure — the failure mode this whole spec exists to avoid", () => {
  it("prints a runnable adopt command with the session id already filled in", () => {
    const d = decide(write());
    expect(d.allow).toBe(false);
    expect(d.reason).toContain(`node tools/entry/cli.mjs adopt --issue <n> --session ${SESSION}`);
  });

  it("refuses every lapsed code too, and offers the issue that is still on disk", () => {
    for (const code of tracked.LAPSED_CODES) {
      const d = decide(write({ verdict: { ok: false, code, reason: "…" }, knownIssue: 125 }));
      expect(d.allow, code).toBe(false);
      expect(d.reason, code).toContain(`adopt --issue 125 --session ${SESSION}`);
    }
  });

  it("says <id> rather than a guess when the harness sent no session id", () => {
    const d = decide(write({ sessionId: null }));
    expect(d.reason).toContain("--session <id>");
    expect(adoptCommand({ sessionId: null, issue: 0 })).toBe(
      "node tools/entry/cli.mjs adopt --issue <n> --session <id>",
    );
  });

  it("does NOT offer adoption when a live record actively disagrees — it would refuse as well", () => {
    const d = decide(
      write({ verdict: { ok: false, code: "SESSION_FOREIGN", reason: "belongs to another conversation" } }),
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("SESSION_FOREIGN");
    expect(d.reason).toContain("belongs to another conversation");
    expect(d.reason).not.toContain("cli.mjs adopt");
  });

  it("stops on a code nobody classified — an unclassified refusal is not a pass", () => {
    const d = decide(write({ verdict: { ok: false, code: "SOMETHING_NEW", reason: "…" } }));
    expect(d.allow).toBe(false);
  });
});

describe("the issue suggestion is read, never invented", () => {
  it("prefers the verdict's own issue, then the folder's record, then the token", () => {
    const none = () => null;
    expect(knownIssueFor({ root: ROOT, verdict: { issue: 125 }, read: none, token: none })).toBe(125);
    expect(knownIssueFor({ root: ROOT, verdict: {}, read: () => ({ issue: 143 }), token: () => ({ issue: 9 }) })).toBe(143);
    expect(knownIssueFor({ root: ROOT, verdict: {}, read: none, token: () => ({ issue: 9 }) })).toBe(9);
  });

  it("suggests nothing from a record it cannot read", () => {
    expect(knownIssueFor({ root: ROOT, verdict: {}, read: () => tracked.CORRUPT, token: () => tracked.CORRUPT })).toBeNull();
    expect(
      knownIssueFor({
        root: ROOT,
        verdict: {},
        read: () => {
          throw new Error("locked");
        },
        token: () => null,
      }),
    ).toBeNull();
  });
});

describe("the wire format", () => {
  it("says nothing at all on an allow", () => {
    let out = "";
    expect(emit({ allow: true }, { write: (s) => (out += s) })).toBe(0);
    expect(out).toBe("");
  });

  it("emits one PreToolUse deny carrying the reason", () => {
    let out = "";
    emit({ allow: false, reason: "because" }, { write: (s) => (out += s) });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "because",
    });
  });

  it("end to end: an unverified session's write into the project is denied with its cure", () => {
    const d = run({
      hookInput: {
        tool_name: "Edit",
        tool_input: { file_path: `${ROOT}\\docs\\BACKLOG.md` },
        cwd: ROOT,
        session_id: SESSION,
      },
      env: { CLAUDE_PROJECT_DIR: ROOT },
      verify: () => ({ ok: false, code: "NO_TOKEN", reason: "nothing to check" }),
      issueLookup: () => null,
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toContain(`--session ${SESSION}`);
  });
});
