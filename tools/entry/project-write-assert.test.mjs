// Guard for the write refusal (#125 step 3) — spec
// docs/superpowers/specs/2026-08-21-unverified-session-write-refusal.md §3b, §6.
//
// This hook can, if it is wrong, stop the machine from repairing it. So the properties below are not
// "does it deny" — they are the four ways a wrong version of this file would hurt:
//
//   * it refuses something that is not a project write (the scratchpad, %TEMP%, a sibling repo),
//   * it refuses without saying how to get back in, or prints a cure that would itself refuse,
//   * it grows its own copy of the identity rules and drifts away from the assert,
//   * it quietly persists a session record from a PreToolUse hook that fires on every write,
//   * (#368, spec §8/§9) it refuses - or prompts on - a write in a merely UNCLAIMED folder, where the
//     ruling is allow plus one line of context naming the cure; only a contradiction or a foreign
//     checkout may still deny.
//
// Everything is driven through the injected seams (`verify`, `issueLookup`, fabricated hook input),
// so no test here touches the real launch store or this machine's live verification state.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as tracked from "../../.claude/hooks/session-root-assert.mjs";
import { ZONES, zoneOf } from "../../.claude/hooks/target-ownership.mjs";
import { decideShell } from "../../.claude/hooks/shell-ownership-assert.mjs";
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
const SIBLING = "C:\\Users\\Kuya\\code\\sentinel";
const OWNER_CONFIG = "C:\\Users\\Kuya\\.claude";

// Where a path LIVES is proved against real repositories in `target-ownership.test.mjs`. Injecting
// it here keeps these tests answering the only question this hook decides — what to do once the zone
// is known — instead of depending on which folders happen to exist on the machine running them.
const under = (parent, target) => String(target).toLowerCase().replace(/\//g, "\\").startsWith(`${parent.toLowerCase()}\\`);
const FAKE_ZONE = ({ target }) => {
  if (under(SIBLING, target)) return { zone: ZONES.SIBLING, abs: target, owner: SIBLING, why: "another checkout of this repository" };
  if (under(OWNER_CONFIG, target)) return { zone: ZONES.GLOBAL, abs: target, owner: OWNER_CONFIG, why: "inside the owner's global configuration" };
  if (/^[A-Za-z]:(?![\\/])/.test(String(target))) return { zone: ZONES.UNKNOWN, abs: null, owner: null, why: "the target could not be resolved to an absolute path" };
  return { zone: ZONES.UNPROTECTED, abs: target, owner: null, why: "fixture: outside every protected zone" };
};

const write = (over = {}) => ({
  toolName: "Write",
  toolInput: { file_path: `${ROOT}\\src\\App.css` },
  verdict: { ok: false, code: "FOLDER_UNCLAIMED", reason: "…" },
  root: ROOT,
  sessionId: SESSION,
  cwd: ROOT,
  knownIssue: null,
  zone: FAKE_ZONE,
  ...over,
});

describe("one implementation of identity — the hook asks, it does not decide", () => {
  it("imports verifySession from the tracked assert rather than reimplementing it", () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*\bverifySession\b[^}]*\}\s*from\s*"\.\/session-root-assert\.mjs"/s);
  });

  it("carries none of the assert's refusal codes as literals of its own", () => {
    // If this file ever names BRANCH_NOT_THE_BOARDS or WRITER_LIVE itself, it has started deciding
    // identity, which is the drift this test exists to catch. It may name the two exported SETS.
    for (const code of ["BRANCH_NOT_THE_BOARDS", "WRITER_LIVE", "WRITER_UNKNOWN", "REPO_MISMATCH"]) {
      expect(SOURCE, `${code} is decided by session-root-assert.mjs, not here`).not.toContain(`"${code}"`);
    }
  });

  it("reads the UNVERIFIABLE / LAPSED split as data instead of re-listing the codes", () => {
    expect(SOURCE).toMatch(/\bUNVERIFIABLE_CODES\b/);
    expect(SOURCE).toMatch(/\bLAPSED_CODES\b/);
    expect(SOURCE).not.toContain('"FOLDER_UNCLAIMED"');
    expect(SOURCE).not.toContain('"BOARD_UNREACHABLE"');
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
  it("guards exactly the three tools that change a file, and leaves the shell to its own hook", () => {
    // The §3c hole is closed, but NOT here: `Bash` is guarded by `shell-ownership-assert.mjs`, a
    // separate PreToolUse entry with its own off switch. This hook staying narrow is what keeps the
    // escape hatch real — a wrong shell checker cannot take `Write` down with it, and a wrong
    // `Write` refusal cannot be repaired by a shell this file also decides. See #278 spec §5.
    expect([...GUARDED_TOOLS].sort()).toEqual(["Edit", "NotebookEdit", "Write"]);
    expect(decide(write({ toolName: "Bash", toolInput: { command: "sed -i s/a/b/ src/App.css" } })).allow).toBe(true);
  });

  it("reads the target from either field, and allows a shape it does not recognize", () => {
    expect(targetOf({ file_path: "a" })).toBe("a");
    expect(targetOf({ notebook_path: "b" })).toBe("b");
    expect(targetOf({ path: "c" })).toBeNull();
    expect(decide(write({ toolInput: { path: "c" } })).allow).toBe(true);
  });

  it("answers a NotebookEdit inside the project the same as a Write", () => {
    const contradicted = { ok: false, code: "WRITER_LIVE", reason: "belongs to another conversation" };
    const nb = (over) => decide(write({ toolName: "NotebookEdit", toolInput: { notebook_path: `${ROOT}\\notes.ipynb` }, ...over }));
    // A contradicted session is refused through either tool...
    expect(nb({ verdict: contradicted }).allow).toBe(false);
    expect(decide(write({ verdict: contradicted })).allow).toBe(false);
    // ...and an unclaimed one proceeds with the same context line through either tool (#368).
    expect(nb({}).allow).toBe(true);
    expect(nb({}).additionalContext).toBe(decide(write()).additionalContext);
  });

  it("leaves an unprotected path outside the project root alone", () => {
    for (const outside of [join(tmpdir(), "scratch.txt"), "D:\\x.md"]) {
      expect(decide(write({ toolInput: { file_path: outside } })).allow, outside).toBe(true);
    }
  });

  it("refuses a SIBLING checkout of this repository, which used to pass for `outside protection`", () => {
    // This exact path was pinned as ALLOWED until #278. Distance from the root is not safety: the
    // one-writer rule is about who owns the target, and another lane's checkout is another owner's.
    const d = decide(write({ toolInput: { file_path: `${SIBLING}\\src\\App.css` } }));
    expect(d.allow).toBe(false);
    expect(d.permission).toBe("deny");
    expect(d.code).toBe("TARGET_NOT_OURS");
    expect(d.reason).toContain("switching tools is not the way round it");
  });

  it("stays refused for a sibling even once this session IS verified", () => {
    const d = decide(write({ toolInput: { file_path: `${SIBLING}\\src\\App.css` }, verdict: { ok: true, mode: "launch" } }));
    expect(d.allow).toBe(false);
    expect(d.code).toBe("TARGET_NOT_OURS");
  });

  it("routes the owner's global configuration to approval rather than deciding it", () => {
    const d = decide(write({ toolInput: { file_path: `${OWNER_CONFIG}\\settings.json` } }));
    expect(d.allow).toBe(false);
    expect(d.permission).toBe("ask");
    expect(d.code).toBe("TARGET_OWNER_CONFIG");
  });

  // The agent's own scratch under ~/.claude — 92 of ~400 measured prompts (2026-09-18). It is
  // reopened HERE and nowhere else: this hook answers only for Write/Edit/NotebookEdit, which name
  // one file and cannot recurse. `target-ownership.test.mjs` pins that `zoneOf` still says GLOBAL.
  const SCRATCH = ["projects", "todos", "plans", "file-history"].map((d) => `${OWNER_CONFIG}\\${d}`);

  it("lets a single-file write through to the agent's own scratch, with an affirmative allow", () => {
    for (const target of [
      `${OWNER_CONFIG}\\projects\\C--Users-Kuya-code-sentinel\\memory\\MEMORY.md`,
      `${OWNER_CONFIG}\\todos\\list.json`,
      `${OWNER_CONFIG}\\plans\\plan.md`,
      `${OWNER_CONFIG}\\file-history\\x.json`,
    ]) {
      for (const toolName of ["Write", "Edit", "NotebookEdit"]) {
        const field = toolName === "NotebookEdit" ? "notebook_path" : "file_path";
        const d = decide(write({ toolName, toolInput: { [field]: target }, scratch: SCRATCH }));
        expect(d.allow, target).toBe(true);
        expect(d.permission, target).toBe("allow");
        expect(d.code, target).toBe("TARGET_AGENT_SCRATCH");
      }
    }
  });

  // THE REGRESSION AN INDEPENDENT REVIEW FOUND, pinned by name. `isWithin` is true for equality, so
  // a non-strict test exempts the scratch ROOTS — and a root is every lane's store, not one file.
  it("does NOT exempt the scratch ROOTS themselves, only paths strictly beneath them", () => {
    for (const root of SCRATCH) {
      const d = decide(write({ toolInput: { file_path: root }, scratch: SCRATCH }));
      expect(d.allow, root).toBe(false);
      expect(d.permission, root).toBe("ask");
      expect(d.code, root).toBe("TARGET_OWNER_CONFIG");
    }
  });

  it("exempts nothing else under the owner's configuration, however close the spelling", () => {
    for (const rest of ["settings.json", "CLAUDE.md", "hooks\\global-laws-assert.mjs", "skills\\s\\SKILL.md", "plugins\\p.json", ".credentials.json", "projectsX\\a.md", "projects.bak\\a.md"]) {
      const d = decide(write({ toolInput: { file_path: `${OWNER_CONFIG}\\${rest}` }, scratch: SCRATCH }));
      expect(d.allow, rest).toBe(false);
      expect(d.code, rest).toBe("TARGET_OWNER_CONFIG");
    }
  });

  it("writes the affirmative allow on the wire, since 'no decision' would hand the prompt back", () => {
    const lines = [];
    const d = decide(write({ toolInput: { file_path: `${OWNER_CONFIG}\\projects\\s\\memory\\M.md` }, scratch: SCRATCH }));
    expect(emit(d, { write: (s) => lines.push(s) })).toBe(0);
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]).hookSpecificOutput;
    expect(payload.hookEventName).toBe("PreToolUse");
    expect(payload.permissionDecision).toBe("allow");
    // An ordinary advisory allow still says nothing at all — the contrast is the point.
    const quiet = [];
    emit({ allow: true, why: "advisory" }, { write: (s) => quiet.push(s) });
    expect(quiet).toEqual([]);
  });

  it("routes Write and Edit through an in-root global-config junction to approval (#429)", () => {
    const fixture = mkdtempSync(join(tmpdir(), "compy-write-global-"));
    try {
      const root = join(fixture, "repo");
      const home = join(fixture, "home");
      const config = join(home, ".claude");
      mkdirSync(root);
      mkdirSync(config, { recursive: true });
      const link = join(root, "owner-config");
      symlinkSync(config, link, process.platform === "win32" ? "junction" : "dir");
      // An unborn target proves that nearest-existing-parent resolution also stays protected.
      const target = join(link, "new-settings.json");
      const zone = (q) => zoneOf({ ...q, deps: { home } });
      expect(zone({ target, sessionRoot: root, cwd: root }).zone).toBe(ZONES.GLOBAL);
      for (const toolName of ["Write", "Edit"]) {
        for (const verdict of [{ ok: true, mode: "launch" }, { ok: false, code: "FOLDER_UNCLAIMED" }]) {
          const result = decide({ toolName, toolInput: { file_path: target }, root, cwd: root, verdict, zone });
          expect(result, `${toolName}: ${verdict.ok ? "verified" : "unclaimed"}`).toMatchObject({
            allow: false, permission: "ask", code: "TARGET_OWNER_CONFIG",
          });
        }
      }
      // Deliberate interface difference: direct writes ask; shell operations deny. Neither allows.
      const shell = decideShell({ toolName: "Bash", toolInput: { command: `rm "${target.replace(/\\/g, "/")}"` },
        sessionRoot: root, cwd: root, verify: () => ({ ok: true, root }), home, env: {} });
      expect(shell.permission).toBe("deny");
    } finally {
      if (dirname(fixture) !== tmpdir()) throw new Error("Fixture escaped temporary directory");
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("treats a path shape it cannot place as unknown, not as outside", () => {
    // A drive-relative path names a per-drive working directory this process does not have. On the
    // SESSION's own drive it resolves inside the root and is answered there (`C:notapath\x.md` ->
    // `<root>\notapath\x.md`, exactly as node's own fs would); on another drive nothing can place it.
    const d = decide(write({ toolInput: { file_path: "Z:notapath\\x.md" } }));
    expect(d.allow).toBe(false);
    expect(d.permission).toBe("ask");
    expect(d.code).toBe("TARGET_UNRESOLVED");
  });

  it("refuses an in-root target that another checkout owns: a lane registered inside the root (#425)", () => {
    // Inside the root is no proof of ownership. `.claude/worktrees/<lane>` is another writer's checkout,
    // the zone names that owner, and the answer does not change once this session is verified.
    const LANE = `${ROOT}\\.claude\\worktrees\\lane`;
    const target = `${LANE}\\src\\App.css`;
    const nested = ({ target: t }) =>
      under(LANE, t) ? { zone: ZONES.SIBLING, abs: t, owner: LANE, why: "another checkout of this repository, nested inside the session root" } : FAKE_ZONE({ target: t });
    expect(isInsideRoot(target, ROOT, { cwd: ROOT })).toBe(true);
    for (const verdict of [{ ok: false, code: "FOLDER_UNCLAIMED", reason: "…" }, { ok: true, mode: "launch" }]) {
      const d = decide(write({ toolInput: { file_path: target }, verdict, zone: nested }));
      expect(d.allow).toBe(false);
      expect(d.permission).toBe("deny");
      expect(d.code).toBe("TARGET_NOT_OURS");
    }
  });

  it("asks about an in-root checkout whose identity git would not report, rather than calling it ours", () => {
    const STALE = `${ROOT}\\.claude\\worktrees\\stale`;
    const unreadable = ({ target: t }) =>
      under(STALE, t) ? { zone: ZONES.UNKNOWN, abs: t, owner: STALE, why: "a checkout inside the session root whose identity git would not report" } : FAKE_ZONE({ target: t });
    const d = decide(write({ toolInput: { file_path: `${STALE}\\notes.md` }, verdict: { ok: true, mode: "launch" }, zone: unreadable }));
    expect(d.allow).toBe(false);
    expect(d.permission).toBe("ask");
    expect(d.code).toBe("TARGET_UNRESOLVED");
  });

  it("keeps every other in-root target on the verdict path, exactly where it was", () => {
    // Zoning in-root targets decides only the answers that name another owner. An own file, a
    // same-drive drive-relative path (unknown, but owned by no one) and an unprotected answer all get
    // the outcome an ordinary in-root write gets.
    const outcome = (d) => ({ allow: d.allow, permission: d.permission ?? null, code: d.code ?? null });
    const own = ({ target: t }) => ({ zone: ZONES.OWN, abs: t, owner: ROOT, why: "inside the session root" });
    for (const verdict of [{ ok: false, code: "FOLDER_UNCLAIMED", reason: "…" }, { ok: true, mode: "launch" }]) {
      const plain = outcome(decide(write({ verdict })));
      expect(outcome(decide(write({ verdict, zone: own })))).toEqual(plain);
      expect(outcome(decide(write({ verdict, toolInput: { file_path: "C:notapath\\x.md" } })))).toEqual(plain);
    }
  });

  it("emits `ask` as `ask`, a refusal as `deny`, and an advisory as context with NO decision", () => {
    const wire = (target, over = {}) => {
      let wrote = "";
      emit(decide(write({ toolInput: { file_path: target }, ...over })), { write: (s) => (wrote += s) });
      return JSON.parse(wrote).hookSpecificOutput;
    };
    // The stricter zones are answered the same way from an unclaimed session (the fixture default)
    // as from a verified one: the advisory code excuses nothing outside the root.
    expect(wire(`${OWNER_CONFIG}\\settings.json`).permissionDecision).toBe("ask");
    expect(wire(`${SIBLING}\\src\\App.css`).permissionDecision).toBe("deny");
    // Inside the root, unclaimed: context on the wire and NO `permissionDecision` key (#368, review
    // 2026-09-04). "allow" would skip the interactive prompt and the auto-mode classifier for the
    // call; no decision leaves the normal permission flow in charge and still reaches the model.
    const advisory = wire(`${ROOT}\\src\\App.css`);
    expect(Object.keys(advisory).sort()).toEqual(["additionalContext", "hookEventName"]);
    expect("permissionDecision" in advisory).toBe(false);
    expect(advisory.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(advisory.permissionDecisionReason).toBeUndefined();
    // Inside the root, contradicted: deny on the wire, no context.
    const refused = wire(`${ROOT}\\src\\App.css`, { verdict: { ok: false, code: "WRITER_LIVE", reason: "taken" } });
    expect(refused.permissionDecision).toBe("deny");
    expect(refused.additionalContext).toBeUndefined();
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

describe("the answer ships its cure — the failure mode this whole spec exists to avoid", () => {
  // #368 (spec §8, corrected in §9): the advisory codes PROCEED. The cure is no longer a refusal
  // printing `adopt` (which wrote a record the board check never read - a dead cure); it is one line
  // of `additionalContext` naming the Ownership claim the push gate enforces. Not `ask`: a hook ask
  // is a real prompt in every mode, and this hook fires on every write.
  it("lets an UNCLAIMED folder's write proceed and names the real cure in one line", () => {
    const d = decide(write());
    expect(d.allow).toBe(true);
    // No objection is not a decision: nothing here becomes a `permissionDecision` on the wire.
    expect(d.permission).toBeUndefined();
    expect(d.code).toBe("FOLDER_UNCLAIMED");
    expect(d.additionalContext).toContain("compy-entry: FOLDER_UNCLAIMED");
    expect(d.additionalContext).toContain("Ownership claim");
    expect(d.additionalContext).toContain("push gate");
    expect(d.additionalContext).not.toContain("\n");
    expect(d.reason).toBeUndefined();
  });

  it("proceeds on every lapsed code too, and names the issue that is still on disk", () => {
    for (const code of tracked.LAPSED_CODES) {
      const d = decide(write({ verdict: { ok: false, code, reason: "…" }, knownIssue: 125 }));
      expect(d.allow, code).toBe(true);
      expect(d.additionalContext, code).toContain(`compy-entry: ${code}`);
      expect(d.additionalContext, code).toContain("Ownership claim on #125");
    }
    // ...and says "the issue" rather than inventing a number when none is on disk.
    const d = decide(write({ verdict: { ok: false, code: [...tracked.LAPSED_CODES][0], reason: "…" }, knownIssue: null }));
    expect(d.additionalContext).toContain("Ownership claim on the issue");
  });

  it("puts no session id on the wire, and the adopt formatter says <id> rather than a guess", () => {
    const d = decide(write({ sessionId: null }));
    expect(d.additionalContext).not.toContain("--session");
    expect(decide(write()).additionalContext).not.toContain(SESSION);
    expect(adoptCommand({ sessionId: null, issue: 0 })).toBe(
      "node tools/entry/cli.mjs adopt --issue <n> --session <id>",
    );
  });

  it("does NOT offer adoption when a live record actively disagrees — it would refuse as well", () => {
    const d = decide(
      write({ verdict: { ok: false, code: "WRITER_LIVE", reason: "belongs to another conversation" } }),
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("WRITER_LIVE");
    expect(d.reason).toContain("belongs to another conversation");
    expect(d.reason).not.toContain("cli.mjs adopt");
  });

  it("stops on a code nobody classified — an unclassified refusal is not a pass", () => {
    const d = decide(write({ verdict: { ok: false, code: "SOMETHING_NEW", reason: "…" } }));
    expect(d.allow).toBe(false);
    expect(d.additionalContext).toBeUndefined();
  });

  it("#368 changes ONLY the advisory codes: claimed-by-another and contradicted still deny", () => {
    for (const code of ["WRITER_LIVE", "WRITER_UNKNOWN", "BRANCH_NOT_THE_BOARDS", "REPO_MISMATCH"]) {
      const d = decide(write({ verdict: { ok: false, code, reason: `fixture: ${code}` } }));
      expect(d.allow, code).toBe(false);
      expect(d.permission ?? "deny", code).toBe("deny");
      expect(d.reason, code).toContain(`fixture: ${code}`);
      expect(d.additionalContext, code).toBeUndefined();
    }
  });

  it("#368 changes nothing about a sibling checkout: an unclaimed session is still refused there", () => {
    const d = decide(write({ toolInput: { file_path: `${SIBLING}\\src\\App.css` } })); // verdict: FOLDER_UNCLAIMED
    expect(d.allow).toBe(false);
    expect(d.permission).toBe("deny");
    expect(d.code).toBe("TARGET_NOT_OURS");
    // ...and the owner's global config still routes to a real prompt rather than proceeding.
    expect(decide(write({ toolInput: { file_path: `${OWNER_CONFIG}\\settings.json` } })).permission).toBe("ask");
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
  it("says nothing at all on a plain allow", () => {
    let out = "";
    expect(emit({ allow: true }, { write: (s) => (out += s) })).toBe(0);
    expect(out).toBe("");
  });

  it("emits an allow that carries context as additionalContext ALONE - no permissionDecision (#368)", () => {
    // hooks-guide: exit 0 with hookSpecificOutput carrying only additionalContext is "no decision;
    // the normal permission flow still applies", and the context reaches the model. A
    // `permissionDecision: "allow"` would skip the prompt and the auto-mode classifier instead.
    let out = "";
    expect(emit({ allow: true, additionalContext: "compy-entry: X - proceed" }, { write: (s) => (out += s) })).toBe(0);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
    expect(Object.keys(parsed.hookSpecificOutput).sort()).toEqual(["additionalContext", "hookEventName"]);
    expect("permissionDecision" in parsed.hookSpecificOutput).toBe(false);
    expect(parsed.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      additionalContext: "compy-entry: X - proceed",
    });
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

  it("end to end: an unclaimed session's write into the project proceeds with its cure as context", () => {
    const hookInput = { tool_name: "Edit", tool_input: { file_path: `${ROOT}\\docs\\BACKLOG.md` }, cwd: ROOT, session_id: SESSION };
    const d = run({
      hookInput,
      env: { CLAUDE_PROJECT_DIR: ROOT },
      verify: () => ({ ok: false, code: "FOLDER_UNCLAIMED", reason: "nothing to check" }),
      issueLookup: () => 368,
    });
    expect(d.allow).toBe(true);
    expect(d.additionalContext).toContain("FOLDER_UNCLAIMED");
    expect(d.additionalContext).toContain("Ownership claim on #368");
    // ...while the same write from a session a live record contradicts is still refused end to end.
    const refused = run({
      hookInput,
      env: { CLAUDE_PROJECT_DIR: ROOT },
      verify: () => ({ ok: false, code: "WRITER_LIVE", reason: "another conversation holds this folder" }),
      issueLookup: () => null,
    });
    expect(refused.allow).toBe(false);
    expect(refused.reason).toContain("another conversation holds this folder");
  });
});
