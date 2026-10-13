// bug->guard (#648) — a working lease holder had no way to renew.
//
// Measured on #552: the one session allowed to write in its folder ran the launcher to renew, and the
// fresh-entry preflight refused it for the two things every working holder is (past its alarm, and
// not clean). The remediation told it to post a takeover of its own lease, which nothing parses.
//
// `renew` is the holder's own entry. It asks the holder question instead of the fresh-entry one,
// writes nothing unless that passes, and posts through the launcher's claim step: the comment first,
// then the board, then the cache. The command line runs the launcher as the program, because the
// launcher is the one place a claim is posted from (#643).
//
// A renewal is admitted on what the command measures about itself, never on what it is handed. Its own
// process chain, read from the machine, must reach the native session program, and the native session
// list must name that one process as the session. The root is that session's, and only the processes on
// that chain are set aside from the sweep. All of it is measured twice: once to decide, and again
// immediately before the write.
//
// Everything `renew` reads is injected, so no case here touches GitHub, git or the process table.

import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaim, planPostClaim, postClaim, threadLease } from "./claim.mjs";
// By namespace, so each guard fails on its own against a toolchain that has no renew command.
import * as cli from "./cli.mjs";
import { HERE } from "./gather.mjs";
import * as launcher from "./launch.mjs";
import * as preflight from "./preflight.mjs";
import { classifyProcesses, WATCHED } from "./processes.mjs";
import { CORRUPT } from "./session-assert.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-renew";
const ELSEWHERE = "C:\\Users\\Kuya\\code\\somewhere-else";
const BRANCH = "claude/renew-holder-648";
const COMMON_DIR = "C:\\Users\\Kuya\\code\\sentinel\\.git";
const SESSION = "5f0c2a9e-1111-4222-8333-000000000648";
const OTHER_ID = "9a9a9a9a-0000-4000-8000-000000000000";
const NOW = new Date("2026-10-13T10:00:00Z");
const SCOPE = "`tools/entry/`";

const TASK = {
  number: 648,
  itemId: "PVTI_x",
  title: "A working lease holder cannot renew",
  status: "Active",
  lane: "Claude Code",
  gate: "None",
  worktreeBranch: `${FOLDER} @ ${BRANCH}`,
  nextAction: "RED, then GREEN.",
  claimExpires: "2026-10-12",
};
// Past its alarm and mid-edit: the state #552's holder was in, and the one a renewal exists for.
const CLAIM = { issue: 648, lane: "Claude Code", executor: "Claude Code", folder: FOLDER, branch: BRANCH, scope: SCOPE, expires: "2026-10-12", postedAt: "2026-10-12T07:59:55Z" };
const OLD_CLAIM = [
  "### Ownership claim",
  "",
  "- Lane: Claude Code",
  "- Executor/tool: Claude Code",
  `- Worktree folder: ${FOLDER}`,
  `- Branch: ${BRANCH}`,
  `- Write scope: ${SCOPE}`,
  "- Claim expires: 2026-10-12",
].join("\n");
const RECORD = { sessionId: SESSION, issue: 648, folder: FOLDER, branch: BRANCH, pid: 4242 };

// What a renewing command measures about itself. The chain runs from the command (first) to the
// session program (last), each process by its id and its creation instant.
const CLI = "C:\\Users\\Kuya\\.local\\bin\\claude.exe";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const LAUNCHER = { pid: 4120, parentPid: 3980, created: "2026-10-13T09:59:58.5000000Z", name: "node.exe", executable: NODE };
const COMMAND = { pid: 3980, parentPid: 3100, created: "2026-10-13T09:59:58.1000000Z", name: "node.exe", executable: NODE };
const SHELL = { pid: 3100, parentPid: 2000, created: "2026-10-13T09:40:00.0000000Z", name: "bash.exe", executable: "C:\\Program Files\\Git\\bin\\bash.exe" };
const PROGRAM = { pid: 2000, parentPid: 992, created: "2026-10-13T03:33:32.1631900Z", name: "claude.exe", executable: CLI };
const CHAIN = [LAUNCHER, COMMAND, SHELL, PROGRAM];
const ENTRY = { pid: PROGRAM.pid, sessionId: SESSION, kind: "interactive", cwd: FOLDER, startedAt: Date.parse("2026-10-13T03:33:33.364Z") };
const AGAINST = "running against this folder";
const INSTALLING = "an installer is running — installs are machine-wide";
const WORKING = "a Claude session is already working in this folder";
/** One process as the by-process reading reports it. */
const seenAs = (p, contends = false, note = null) => ({ pid: p.pid, created: p.created, name: p.name, contends, note });
// The launcher's command line names the folder it runs from, so the stock classifier counts it.
const OWN = [seenAs(LAUNCHER, true, AGAINST), seenAs(COMMAND), seenAs(PROGRAM)];
const TAKEN = "2026-10-13T10:00:01.000Z";
const UNREAD = { ok: false, takenAt: null, rows: [], others: null };
const CALLER = { pid: LAUNCHER.pid, cli: CLI, chain: { ok: true, rows: CHAIN }, sessions: { ok: true, entries: [ENTRY] }, snapshot: { ok: true, takenAt: TAKEN, rows: OWN, others: 0 } };
const HOLDER = { sessionId: SESSION, caller: CALLER, root: { path: FOLDER, source: "native session list" }, record: RECORD, recordState: "ok", liveness: "live", sweeper: "node.exe" };
const withCaller = (patch) => ({ ...HOLDER, caller: { ...CALLER, ...patch } });
const withReading = (rows) => withCaller({ snapshot: { ...CALLER.snapshot, rows } });
// What the candidate before this one admitted on: a root named by an environment setting, and called observed.
const SET_BY_HAND = { path: FOLDER, source: "CLAUDE_PROJECT_DIR", observed: true };
// One cause, three rows: with no measured caller there is no root and no chain to set aside.
const UNWITNESSED = ["holder.caller", "holder.folder", "processes"];

// The native session list as the CLI prints it: every live session on the machine, with more about
// each than a renewal has any business carrying.
const FLEET = [
  { ...ENTRY, name: "renew-lane", status: "busy" },
  { pid: 7100, sessionId: OTHER_ID, kind: "interactive", cwd: "C:\\Users\\Kuya\\code\\private-lane", startedAt: Date.parse("2026-10-13T08:00:00Z"), name: "private-lane", status: "idle" },
  { pid: 7200, sessionId: "7b7b7b7b-0000-4000-8000-000000000000", kind: "background", cwd: "C:\\Users\\Kuya\\code\\sentinel", startedAt: Date.parse("2026-10-12T20:00:00Z"), name: "nightly", status: "idle" },
];
// A by-process reading as the machine gives it: every watched process, command lines and all.
const RAW = [
  { pid: LAUNCHER.pid, created: LAUNCHER.created, name: "node.exe", commandLine: `"${NODE}" ${FOLDER}\\tools\\entry\\launch.mjs --renew --issue 648 --session ${SESSION}` },
  { pid: COMMAND.pid, created: COMMAND.created, name: "node.exe", commandLine: `"${NODE}" tools/entry/cli.mjs renew --issue 648 --session ${SESSION}` },
  { pid: PROGRAM.pid, created: PROGRAM.created, name: "claude.exe", commandLine: `${CLI} --session-id ${SESSION}` },
  { pid: 9100, created: "2026-10-13T01:00:00.0000000Z", name: "node.exe", commandLine: `"${NODE}" C:\\Users\\Kuya\\code\\private-lane\\server.js --token hunter2` },
  { pid: 9200, created: "2026-10-13T01:00:00.0000000Z", name: "Code.exe", commandLine: "Code.exe --folder-uri file:///c%3A/Users/Kuya/code/private-lane" },
  { pid: 7100, created: "2026-10-13T08:00:00.0000000Z", name: "claude.exe", commandLine: `${CLI} --session-id ${OTHER_ID}` },
];

const failingRows = (refused) => refused.payload.checks.filter((c) => !c.ok).map((c) => c.name);
const rowOf = (verdict, name) => verdict.checks.find((c) => c.name === name);
const IDS = {
  projectId: "PVT_x",
  itemId: "PVTI_x",
  fields: {
    status: { id: "F_status", options: { Active: "o_active" } },
    lane: { id: "F_lane", options: { "Claude Code": "o_cc" } },
    worktree: { id: "F_wt" },
    nextAction: { id: "F_next" },
    claimExpires: { id: "F_exp" },
    lastVerified: { id: "F_ver" },
  },
};

const world = (over = {}) => ({
  board: { reachable: true },
  self: { lane: "Claude Code" },
  now: NOW,
  task: TASK,
  items: [TASK],
  claim: CLAIM,
  handoff: null,
  checkouts: [{ path: FOLDER, branch: BRANCH, kind: "linked", commonDir: COMMON_DIR, remote: "git@github.com:Pootytxng/sentinel.git" }],
  gitState: {
    ok: true,
    branch: BRANCH,
    detached: false,
    clean: false,
    workingTreeClean: false,
    modified: 1,
    untracked: 1,
    staged: 0,
    unmerged: 0,
    stashed: 0,
    stashedElsewhere: 0,
    ahead: 1,
    behind: 0,
    files: { modified: ["tools/entry/preflight.mjs"], untracked: ["tools/entry/renew-cli.test.mjs"], staged: [], unmerged: [] },
  },
  expectedCommonDir: COMMON_DIR,
  // The stock sweep names programs and counts them. It counts the launcher, whose command line names the folder.
  processes: [{ name: "node.exe", count: 2, contends: true, note: AGAINST, samples: [] }],
  scope: { mine: ["tools/entry"], text: SCOPE, source: "claim", others: [], files: [] },
  ...over,
});
/** The same world on a machine where the sweep counts nothing against the folder. */
const quietWorld = () => world({ processes: [{ name: "node.exe", count: 2, contends: false, note: null, samples: [] }] });

// The order an admitted renewal reaches its readers and writers in, and the two places a refusal stops.
const ADMITTED = ["board", "gather", "observe", "ids", "observe", "post", "invalidate"];
const REFUSED_AT_CHECK = ["board", "gather", "observe"];
const REFUSED_AT_WRITE = ["board", "gather", "observe", "ids", "observe"];

/** Every reader and writer `renew` has, recording the order they were reached in. */
function wired({ facts = world(), holder = HOLDER, later = holder, board = null, post = null } = {}) {
  const calls = [];
  const posted = [];
  const seen = { observed: [] };
  const inject = {
    board: () => {
      calls.push("board");
      return board ?? { reachable: true, items: facts.items };
    },
    policy: () => null,
    gather: (args) => {
      calls.push("gather");
      seen.gather = args;
      return { target: { path: FOLDER, branch: BRANCH }, base: null, facts };
    },
    // The command is measured twice: `holder` is what it finds to decide on, `later` what it finds before the write.
    observe: (args) => {
      calls.push("observe");
      seen.observed.push(args);
      seen.observe = args;
      return seen.observed.length === 1 ? holder : later;
    },
    post:
      post ??
      ((claim) => {
        calls.push("post");
        posted.push(claim);
        return { plan: [], ran: [] };
      }),
    projectIds: () => {
      calls.push("ids");
      return IDS;
    },
    invalidate: () => {
      calls.push("invalidate");
      return true;
    },
  };
  return { calls, posted, seen, inject };
}

/** What a refusal threw. A run that did not refuse is a failed test, not a quiet pass. */
function refusalOf(run) {
  try {
    run();
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal, and the run completed");
}

const bodyOf = (claim) => {
  const [comment] = planPostClaim(claim);
  return comment.argv[comment.argv.indexOf("--body") + 1];
};

/** The real observer over injected readers: what it asks each one, and what it hands back. */
function observed(over = {}) {
  const asked = { chain: [], sessions: [], sweep: 0, read: [], liveness: [] };
  const out = launcher.observeHolder({
    sessionId: SESSION,
    cwd: `${FOLDER}\\tools\\entry`,
    now: NOW,
    pid: LAUNCHER.pid,
    cli: CLI,
    chain: (args) => {
      asked.chain.push(args);
      return CHAIN;
    },
    sessions: (args) => {
      asked.sessions.push(args);
      return FLEET;
    },
    sweep: () => {
      asked.sweep += 1;
      return RAW;
    },
    clock: () => new Date(TAKEN),
    toplevel: () => "C:/Users/Kuya/code/sentinel-renew",
    read: ({ root }) => {
      asked.read.push(root);
      return RECORD;
    },
    // No liveness reader is the observer's to ask. One is handed in all the same, saying what a
    // command would want said, so every case can show it was never reached.
    liveness: (record) => {
      asked.liveness.push(record);
      return { liveness: "live", alive: true, seenAt: null };
    },
    ...over,
  });
  return { out, asked };
}

describe("#648: renew refuses before it writes", () => {
  it("refuses without an issue or a session, before it reads anything", () => {
    const cases = [
      [{ sessionId: SESSION }, "RENEW_NO_ISSUE"],
      [{ issue: Number.NaN, sessionId: SESSION }, "RENEW_NO_ISSUE"],
      [{ issue: 648 }, "RENEW_NO_SESSION"],
      [{ issue: 648, sessionId: "  " }, "RENEW_NO_SESSION"],
    ];
    for (const [args, code] of cases) {
      const w = wired();
      const refused = refusalOf(() => launcher.renew({ ...args, ...w.inject }));
      expect(refused.payload, code).toMatchObject({ verdict: "REFUSE", code, effects: [], wroteAnything: false });
      expect(w.calls, code).toEqual([]);
    }
  });

  it("refuses an unreachable board and an issue that is not on it", () => {
    const offline = wired({ board: { reachable: false, error: "gh: no network" } });
    expect(refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...offline.inject })).payload).toMatchObject({ verdict: "REFUSE", wroteAnything: false });
    expect(offline.calls).toEqual(["board"]);

    const absent = wired();
    expect(refusalOf(() => launcher.renew({ issue: 999, sessionId: SESSION, ...absent.inject })).payload).toMatchObject({ reason: "Issue #999 is not on the board.", wroteAnything: false });
    expect(absent.calls).toEqual(["board"]);
  });

  it("a refused verdict writes nothing: no comment, no board field, no cache", () => {
    const w = wired({ holder: { ...HOLDER, record: { ...RECORD, sessionId: OTHER_ID } } });
    const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject }));
    expect(w.calls).toEqual(REFUSED_AT_CHECK);
    expect(w.posted).toEqual([]);
    expect(refused.payload).toMatchObject({ verdict: "REFUSE", effects: [], wroteAnything: false });
    expect(refused.payload.task.number).toBe(648);
    // The whole table travels with the refusal, so the caller is told which row stopped it.
    expect(failingRows(refused)).toEqual(["holder.session"]);
  });

  it("a dirty path outside the lease refuses, and the refusal names the path", () => {
    const stray = world();
    stray.gitState = { ...stray.gitState, untracked: 2, files: { ...stray.gitState.files, untracked: ["tools/entry/renew-cli.test.mjs", "docs/BACKLOG.md"] } };
    const w = wired({ facts: stray });
    const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject }));
    expect(w.calls).toEqual(REFUSED_AT_CHECK);
    expect(rowOf(refused.payload, "git.withinLease").actual).toContain("docs/BACKLOG.md");
  });

  it("a command nobody measured refuses, whatever session id and root it was handed", () => {
    // A quiet machine, the right session id, a live record and a root that calls itself observed. A
    // command can be handed every one of those, and the candidate before this one posted on them.
    for (const caller of [undefined, { verified: false, pid: null }, { verified: true, pid: LAUNCHER.pid }]) {
      const said = JSON.stringify(caller ?? null);
      const w = wired({ facts: quietWorld(), holder: { ...HOLDER, caller, root: SET_BY_HAND } });
      const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject }));
      expect(w.calls, said).toEqual(REFUSED_AT_CHECK);
      expect(w.posted, said).toEqual([]);
      expect(refused.payload, said).toMatchObject({ verdict: "REFUSE", effects: [], wroteAnything: false });
      expect(failingRows(refused), said).toEqual(UNWITNESSED);
      expect(rowOf(refused.payload, "holder.folder").actual, said).toContain("CLAUDE_PROJECT_DIR; not observed");
    }
  });

  it("an environment that names the leased folder as this session's root admits nothing", () => {
    // The real observer, on a machine whose process table did not answer. The candidate before this
    // one read its root from this setting, called it observed, and posted.
    const w = wired({ facts: quietWorld() });
    const env = { CLAUDE_PROJECT_DIR: FOLDER };
    const observe = (args) => {
      w.calls.push("observe");
      return observed({
        ...args,
        cwd: `${FOLDER}\\tools\\entry`,
        env,
        chain: () => {
          throw new Error("the process table did not answer");
        },
        toplevel: () => FOLDER,
      }).out;
    };
    const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, env, ...w.inject, observe }));
    expect(w.calls).toEqual(REFUSED_AT_CHECK);
    expect(w.posted).toEqual([]);
    // The folder's record names this session, and that is all it does: with no command established
    // under it, nothing measured it live, whatever a reader handed in would have said.
    expect(failingRows(refused)).toEqual(["holder.session", ...UNWITNESSED]);
    expect(rowOf(refused.payload, "holder.session").actual).toBe("session 5f0c2a9e holds the record but was not measured live (unknown)");
    expect(rowOf(refused.payload, "holder.caller").actual).toBe("not established: its process chain could not be read");
    expect(rowOf(refused.payload, "holder.folder").actual).toContain("git toplevel of the working directory; not observed");
    expect(refused.payload.wroteAnything).toBe(false);
  });

  it("a build, an installer or another session against the folder refuses, and nothing is posted", () => {
    const refusedBy = (w, what) => {
      const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject }));
      expect(w.calls, what).toEqual(REFUSED_AT_CHECK);
      expect(w.posted, what).toEqual([]);
      expect(failingRows(refused), what).toEqual(["processes"]);
      expect(refused.payload.wroteAnything, what).toBe(false);
      return rowOf(refused.payload, "processes").actual;
    };
    // Counted by the stock sweep, which names programs. The command's own launcher is counted too, and waives nothing.
    const counted = [
      { name: "cargo.exe", count: 1, contends: true, note: AGAINST, samples: [] },
      { name: "msiexec.exe", count: 1, contends: true, note: INSTALLING, samples: [] },
      { name: "claude.exe", count: 1, contends: true, note: WORKING, samples: [] },
    ];
    for (const contender of counted) {
      expect(refusedBy(wired({ facts: world({ processes: [...world().processes, contender] }) }), contender.name)).toContain(`${contender.name} ×1 (${contender.note})`);
    }
    // Read by process, beside the command's own chain: none of these is on it, whoever started them.
    const strangers = [
      { pid: 7001, created: "2026-10-13T09:58:00.0000000Z", name: "cargo.exe", contends: true, note: AGAINST },
      { pid: 8800, created: "2026-10-13T09:57:00.0000000Z", name: "msiexec.exe", contends: true, note: INSTALLING },
      { pid: 7100, created: "2026-10-13T08:00:00.0000000Z", name: "claude.exe", contends: true, note: WORKING },
      { pid: 4200, created: "2026-10-13T09:59:59.0000000Z", name: "node.exe", contends: true, note: AGAINST, parentPid: LAUNCHER.pid },
      { pid: 2600, created: "2026-10-13T03:34:00.0000000Z", name: "node.exe", contends: true, note: AGAINST, parentPid: PROGRAM.pid },
    ];
    for (const stranger of strangers) {
      const what = `${stranger.name} ${stranger.pid}`;
      expect(refusedBy(wired({ holder: withReading([...OWN, stranger]) }), what)).toContain(`not this command's own: ${what} (${stranger.note})`);
    }
  });

  // Built sweeps: the stock classifier never calls an installer quiet, and the check does not lean on that.
  const listedAs = (name, standing = { contends: false, note: null }) => ({ name, count: 1, samples: [], ...standing });

  it("an installer the sweep lists refuses however the sweep judged it: no comment, no board field, no cache", () => {
    const standings = [{ contends: false, note: null }, { contends: true, note: INSTALLING }, { contends: null, note: null }];
    for (const name of ["msiexec.exe", "MsiExec.exe", "CompySetup.exe", "vs_installer.exe", "Setup.exe"]) {
      for (const base of [world(), quietWorld()]) {
        for (const standing of standings) {
          const said = `${name} ${standing.contends} beside ${base.processes[0].contends}`;
          // The command itself is measured, live and coherent: the sweep entry is the only thing wrong.
          const w = wired({ facts: { ...base, processes: [...base.processes, listedAs(name, standing)] } });
          const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject }));
          // Stopped at the check: the board's ids were never asked for, nothing was posted, the cache was left alone.
          expect(w.calls, said).toEqual(REFUSED_AT_CHECK);
          expect(w.posted, said).toEqual([]);
          expect(refused.payload, said).toMatchObject({ verdict: "REFUSE", effects: [], wroteAnything: false });
          expect(failingRows(refused), said).toEqual(["processes"]);
          expect(rowOf(refused.payload, "processes").actual, said).toContain(`an installer is never set aside, and the sweep lists one: ${name} ×1`);
        }
      }
    }
  });

  it("a quiet program the sweep lists that is no installer is still admitted, and posts once", () => {
    for (const base of [world(), quietWorld()]) {
      const w = wired({ facts: { ...base, processes: [...base.processes, listedAs("Code.exe")] } });
      expect(launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject })).toMatchObject({ renewed: true, wroteAnything: true });
      expect(w.calls).toEqual(ADMITTED);
      expect(w.posted).toHaveLength(1);
    }
  });

  it("the sweep counts a renewal run from the leased folder's own launcher, and only that one process is set aside", () => {
    // What the real classifier says about the real command line: the launcher's path names the folder.
    const leased = resolve(HERE, "..", "..");
    const { file, args } = cli.renewLauncherCommand({ issue: 648, session: SESSION });
    const sweep = classifyProcesses([{ name: "node.exe", commandLine: [file, ...args].join(" ") }], { folder: leased });
    expect(sweep).toMatchObject([{ name: "node.exe", count: 1, contends: true, note: AGAINST }]);

    // The sweep names a program, not its owner. Read by process, the launcher is this command itself.
    const own = wired({ facts: world({ processes: sweep }) });
    expect(launcher.renew({ issue: 648, sessionId: SESSION, ...own.inject })).toMatchObject({ renewed: true });
    expect(own.posted).toHaveLength(1);

    // The same sweep, and the node.exe it counts is some other process: refused on the process, not the name.
    const other = { pid: 9100, created: "2026-10-13T08:00:00.0000000Z", name: "node.exe", contends: true, note: AGAINST };
    const foreign = wired({ facts: world({ processes: sweep }), holder: withReading([seenAs(LAUNCHER), seenAs(COMMAND), seenAs(PROGRAM), other]) });
    expect(failingRows(refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...foreign.inject })))).toEqual(["processes"]);
    expect(foreign.posted).toEqual([]);

    // And with no measured caller there is nobody for that process to be the own one of.
    const nobody = wired({ facts: world({ processes: sweep }), holder: { ...HOLDER, caller: undefined } });
    expect(failingRows(refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...nobody.inject })))).toEqual(UNWITNESSED);
    expect(nobody.posted).toEqual([]);
  });

  it("the writer refuses an absent or a non-PASS verdict; that guard is pinned, not weakened", () => {
    const facts = { lane: "Claude Code", folder: FOLDER, branch: BRANCH };
    expect(() => postClaim({ issue: 648, facts, ids: IDS, dryRun: true })).toThrow(/preflight verdict is \(none\)/);
    expect(() => postClaim({ issue: 648, verdict: { verdict: "REFUSE", checks: [] }, facts, ids: IDS, dryRun: true })).toThrow(/preflight verdict is REFUSE/);
  });
});

describe("#648: the command is measured again immediately before the write", () => {
  it("after the last read and before the comment, from the same seat", () => {
    const w = wired();
    launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject });
    expect(w.calls).toEqual(ADMITTED);
    expect(w.seen.observed).toHaveLength(2);
    expect(w.seen.observed[1]).toEqual(w.seen.observed[0]);
  });

  it("posts the verdict it measured last, not the one it decided on", () => {
    const LATER = "2026-10-13T10:00:03.000Z";
    const w = wired({ later: withCaller({ snapshot: { ...CALLER.snapshot, takenAt: LATER } }) });
    const out = launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject });
    expect(w.posted[0].verdict.verdict).toBe("PASS");
    expect(rowOf(w.posted[0].verdict, "processes").actual).toContain(`by process at ${LATER}`);
    expect(rowOf(out.verdict, "processes").actual).toContain(`by process at ${LATER}`);
  });

  it("a witness that changed, ended or was raced refuses there, and nothing is posted", () => {
    const RELAUNCHED = { ...LAUNCHER, pid: 4300, created: "2026-10-13T10:00:02.0000000Z" };
    const cargo = { pid: 7001, created: "2026-10-13T10:00:02.0000000Z", name: "cargo.exe", contends: true, note: AGAINST };
    const cases = [
      // Whole in every fact, and not the witness that was admitted.
      ["another command under the same session", withCaller({ pid: RELAUNCHED.pid, chain: { ok: true, rows: [RELAUNCHED, COMMAND, SHELL, PROGRAM] }, snapshot: { ...CALLER.snapshot, rows: [seenAs(RELAUNCHED, true, AGAINST), seenAs(COMMAND), seenAs(PROGRAM)] } }), ["holder.caller"]],
      ["a session that ended", withCaller({ sessions: { ok: true, entries: [] } }), UNWITNESSED],
      ["a process table that stopped answering", withCaller({ chain: { ok: false, rows: [] } }), UNWITNESSED],
      ["a build that started in between", withReading([...OWN, cargo]), ["processes"]],
      ["a by-process reading that failed", withCaller({ snapshot: UNREAD }), ["processes"]],
      ["a session program that is no longer in the reading", withReading([seenAs(LAUNCHER, true, AGAINST), seenAs(COMMAND)]), ["processes"]],
      ["a session record that changed hands", { ...HOLDER, record: { ...RECORD, sessionId: OTHER_ID } }, ["holder.session"]],
      ["a session no longer measured live", { ...HOLDER, liveness: "dead" }, ["holder.session"]],
      ["nothing measured at all", null, ["holder.session", "holder.caller", "holder.folder", "holder.branch", "processes"]],
    ];
    for (const [what, later, rows] of cases) {
      const w = wired({ later });
      const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject }));
      expect(w.calls, what).toEqual(REFUSED_AT_WRITE);
      expect(w.posted, what).toEqual([]);
      expect(refused.payload, what).toMatchObject({ verdict: "REFUSE", code: "RENEW_WITNESS_CHANGED", effects: [], wroteAnything: false });
      expect(refused.payload.task.number, what).toBe(648);
      expect(failingRows(refused), what).toEqual(rows);
    }
  });
});

describe("#648: an admitted renewal posts the full claim, then the board, then the cache", () => {
  it("reads, then posts, then clears the cached board answer", () => {
    const w = wired();
    const out = launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject });
    expect(w.calls).toEqual(ADMITTED);
    expect(out).toMatchObject({ renewed: true, issue: 648, folder: FOLDER, branch: BRANCH, expires: "2026-10-13", wroteAnything: true });
    expect(out.effects).toEqual([{ what: "renewed the ownership claim", detail: "#648 until 2026-10-13" }]);
    expect(out.verdict.verdict).toBe("PASS");
  });

  it("the comment is a full claim the thread reads the new expiry from", () => {
    const w = wired();
    launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject });
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].verdict.verdict).toBe("PASS");

    const plan = planPostClaim(w.posted[0]);
    expect(plan[0].argv.slice(0, 2)).toEqual(["issue", "comment"]);
    expect(plan.slice(1).every((step) => step.argv[0] === "project")).toBe(true);

    const body = bodyOf(w.posted[0]);
    expect(parseClaim(body)).toMatchObject({ lane: "Claude Code", executor: "Claude Code", folder: FOLDER, branch: BRANCH, scope: SCOPE, expires: "2026-10-13" });
    const lease = threadLease([
      { body: OLD_CLAIM, createdAt: CLAIM.postedAt },
      { body, createdAt: NOW.toISOString() },
    ]);
    expect(lease.claim.expires).toBe("2026-10-13");
  });

  it("the durable comment carries the measured verdict, dirty paths and the caller's witness included", () => {
    const w = wired();
    launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject });
    const body = bodyOf(w.posted[0]);
    expect(body).toContain("#### Preflight verdict: PASS");
    for (const row of ["task.claim", "holder.session", "holder.caller", "holder.folder", "holder.branch", "scope.unchanged", "git.withinLease", "processes"]) {
      expect(body, row).toContain(`| \`${row}\` |`);
    }
    expect(body).toContain("tools/entry/preflight.mjs");
    expect(body).toContain("tools/entry/renew-cli.test.mjs");
    expect(body).toContain("ahead 1, behind 0");
    // How the command was established, and the moment the by-process reading was taken, are in the record.
    expect(body).toContain("command 4120 reaches claude.exe 2000 in 3 steps");
    expect(body).toContain(`by process at ${TAKEN}`);
    // A row that broke the table would hide every row after it.
    for (const check of w.posted[0].verdict.checks) expect(`${check.expected}${check.actual}`, check.name).not.toMatch(/[|`\n]/);
  });

  it("never widens the scope: none is handed to the gatherer, and the lease's own is restated", () => {
    const w = wired();
    launcher.renew({ issue: 648, sessionId: SESSION, scope: "`tools/entry/` `docs/`", ...w.inject });
    expect(w.seen.gather).toMatchObject({ issue: 648, task: TASK });
    expect(w.seen.gather.scopeText).toBeUndefined();
    expect(w.posted[0].facts.scope).toBe(SCOPE);
  });

  it("observes this session where the command runs; a folder, a root and an environment are never arguments", () => {
    const w = wired();
    launcher.renew({ issue: 648, sessionId: SESSION, folder: ELSEWHERE, root: ELSEWHERE, env: { CLAUDE_PROJECT_DIR: ELSEWHERE }, ...w.inject });
    expect(w.seen.observe.sessionId).toBe(SESSION);
    expect(w.seen.observe.now).toBe(NOW);
    for (const seat of w.seen.observed) expect(Object.keys(seat).sort()).toEqual(["cwd", "now", "sessionId"]);
  });

  it("a comment that fails leaves the cached board answer alone", () => {
    const w = wired({
      post: () => {
        throw new Error("gh: the comment was not posted");
      },
    });
    expect(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject })).toThrow(/the comment was not posted/);
    expect(w.calls).toEqual(REFUSED_AT_WRITE);
  });
});

describe("#648: the holder is observed, never taken from an argument", () => {
  it("traces the command to its session program, and takes the root the native session list gives that session", () => {
    const { out, asked } = observed();
    expect(asked.chain).toEqual([{ pid: LAUNCHER.pid }]);
    expect(asked.sessions).toEqual([{ cli: CLI }]);
    expect(asked.sweep).toBe(1);
    expect(out.root).toEqual({ path: FOLDER, source: "native session list" });
    // The session record is the one kept for that folder. Live is what was just measured about the
    // command, agreeing with that record: no reader is asked for it.
    expect(asked.read).toEqual([FOLDER]);
    expect(asked.liveness).toEqual([]);
    expect(out).toMatchObject({ sessionId: SESSION, record: RECORD, recordState: "ok", liveness: "live" });
    // The witness the stock sweep is checked against: the program that ran it.
    expect(out.sweeper).toBe(basename(process.execPath));
    expect(out.caller).toEqual({ pid: LAUNCHER.pid, cli: CLI, chain: { ok: true, rows: CHAIN }, sessions: { ok: true, entries: [ENTRY] }, snapshot: { ok: true, takenAt: TAKEN, rows: OWN, others: 3 } });
  });

  it("what it measures is what a renewal is admitted on", () => {
    const w = wired();
    const observe = (args) => {
      w.calls.push("observe");
      return observed({ sessionId: args.sessionId, now: args.now }).out;
    };
    const out = launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject, observe });
    expect(w.calls).toEqual(ADMITTED);
    expect(rowOf(out.verdict, "holder.caller").actual).toBe("command 4120 reaches claude.exe 2000 in 3 steps, and the native session list names that process as interactive session 5f0c2a9e");
    expect(rowOf(out.verdict, "holder.folder").actual).toContain(`root ${FOLDER} (native session list, for the session this command runs under; observed)`);
    expect(rowOf(out.verdict, "processes").actual).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980, claude.exe 2000; 3 others, none contending");
  });

  it("the working directory and the environment decide nothing", () => {
    // Every seam the candidate before this one took a root from, each pointing somewhere else.
    const { out, asked } = observed({
      cwd: ELSEWHERE,
      env: { CLAUDE_PROJECT_DIR: ELSEWHERE },
      where: () => ({ root: ELSEWHERE, source: "CLAUDE_PROJECT_DIR", observed: true }),
      toplevel: () => ELSEWHERE,
    });
    expect(out.root).toEqual({ path: FOLDER, source: "native session list" });
    expect(asked.read).toEqual([FOLDER]);
    expect(JSON.stringify(out)).not.toContain("somewhere-else");
  });

  it("carries nothing of anyone else's: no other session, no folder of theirs, no command line", () => {
    const { out } = observed();
    const text = JSON.stringify(out);
    for (const theirs of ["hunter2", "private-lane", "nightly", "busy", OTHER_ID, "7b7b7b7b", "--session-id", "commandLine", "server.js"]) expect(text, theirs).not.toContain(theirs);
    expect(Object.keys(out.caller.sessions.entries[0]).sort()).toEqual(["cwd", "kind", "pid", "sessionId", "startedAt"]);
    for (const row of out.caller.snapshot.rows) expect(Object.keys(row).sort()).toEqual(["contends", "created", "name", "note", "pid"]);
    for (const row of out.caller.chain.rows) expect(Object.keys(row).sort()).toEqual(["created", "executable", "name", "parentPid", "pid"]);
  });

  it("a session listed twice is carried whole, so the check refuses it and nothing more is read", () => {
    const { out, asked } = observed({ sessions: () => [...FLEET, { ...ENTRY, pid: 7100 }] });
    expect(out.caller.sessions.entries).toEqual([ENTRY, { ...ENTRY, pid: 7100 }]);
    expect(asked.sweep).toBe(0);
    expect(out.caller.snapshot).toEqual(UNREAD);
    expect(out.root).toEqual({ path: FOLDER, source: "git toplevel of the working directory" });
  });

  it("with no chain to a session program nothing further is read, and the root is only a guess", () => {
    const unreadable = [
      () => {
        throw new Error("the process table did not answer");
      },
      () => null,
      () => "claude.exe",
      () => [LAUNCHER, COMMAND, SHELL],
    ];
    for (const chain of unreadable) {
      const { out, asked } = observed({ chain });
      expect(asked.sessions).toEqual([]);
      expect(asked.sweep).toBe(0);
      expect(out.caller.sessions).toEqual({ ok: false, entries: [] });
      expect(out.caller.snapshot).toEqual(UNREAD);
      // Shown so a refusal can say where the command stood. It is a guess, and is reported as one.
      expect(out.root).toEqual({ path: FOLDER, source: "git toplevel of the working directory" });
      expect(asked.read).toEqual([FOLDER]);
    }
    expect(observed({ chain: unreadable[0] }).out.caller.chain).toEqual({ ok: false, rows: [] });
    expect(observed({ chain: unreadable[2] }).out.caller.chain).toEqual({ ok: false, rows: [] });
    expect(observed({ chain: unreadable[3] }).out.caller.chain).toEqual({ ok: true, rows: [LAUNCHER, COMMAND, SHELL] });
  });

  it("a reader that fails is a reading that was not taken, never an empty one", () => {
    const failedLists = [
      () => {
        throw new Error("the native program did not answer");
      },
      () => null,
      () => ({ sessions: FLEET }),
    ];
    for (const sessions of failedLists) {
      const { out, asked } = observed({ sessions });
      expect(out.caller.sessions).toEqual({ ok: false, entries: [] });
      expect(asked.sweep).toBe(0);
    }
    const failedSweeps = [
      () => {
        throw new Error("the process table did not answer");
      },
      () => null,
      () => ({ rows: RAW }),
    ];
    for (const sweep of failedSweeps) {
      const { out } = observed({ sweep });
      expect(out.caller.snapshot).toEqual(UNREAD);
      // The command was still traced to its session: only the reading is missing, and the check says so.
      expect(out.root).toEqual({ path: FOLDER, source: "native session list" });
    }
    // With no native program on the machine there is no list to ask, and nothing is run to find one.
    const none = observed({ cli: null });
    expect(none.asked.sessions).toEqual([]);
    expect(none.out.caller).toMatchObject({ cli: null, sessions: { ok: false, entries: [] }, snapshot: UNREAD });
  });

  it("judges each process on its own with the stock classifier, and keeps only what the check needs", () => {
    const cargo = { pid: 7001, created: "2026-10-13T09:58:00.0000000Z", name: "cargo.exe", commandLine: `cargo build --manifest-path ${FOLDER}\\src-tauri\\Cargo.toml` };
    const msi = { pid: 8800, created: "2026-10-13T09:57:00.0000000Z", name: "msiexec.exe", commandLine: "msiexec /i C:\\Users\\Kuya\\Downloads\\thing.msi" };
    const setup = { pid: 8801, created: "2026-10-13T09:57:30.0000000Z", name: "CompySetup.exe", commandLine: "" };
    const hidden = { pid: 9300, created: "2026-10-13T02:00:00.0000000Z", name: "node.exe", commandLine: null };
    const editor = { pid: 9301, created: "2026-10-13T02:00:00.0000000Z", name: "Code.exe", commandLine: null };
    const nameless = { pid: 9400, created: "2026-10-13T02:00:00.0000000Z", name: "", commandLine: "x" };
    const judged = [
      { pid: 7001, created: cargo.created, name: "cargo.exe", contends: true, note: AGAINST },
      { pid: 8800, created: msi.created, name: "msiexec.exe", contends: true, note: INSTALLING },
      { pid: 8801, created: setup.created, name: "CompySetup.exe", contends: true, note: INSTALLING },
      // A builder whose command line could not be read may be running anywhere. Unknown is not "elsewhere".
      { pid: 9300, created: hidden.created, name: "node.exe", contends: null, note: "its command line could not be read" },
    ];
    const { out } = observed({ sweep: () => [...RAW, cargo, msi, setup, hidden, editor, nameless] });
    expect(out.caller.snapshot.rows).toEqual([...OWN, ...judged, { pid: 9400, created: nameless.created, name: "", contends: null, note: "it could not be classified" }]);
    // An editor is not a writer, with or without a command line: it is counted with the rest and not named.
    expect(out.caller.snapshot.others).toBe(4);
    expect(JSON.stringify(out)).not.toMatch(/Cargo\.toml|thing\.msi/);

    // And the renewal refuses on that reading, naming each one by its process.
    const w = wired();
    const observe = (args) => {
      w.calls.push("observe");
      return observed({ sessionId: args.sessionId, now: args.now, sweep: () => [...RAW, cargo, msi, setup, hidden, editor] }).out;
    };
    const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject, observe }));
    expect(failingRows(refused)).toEqual(["processes"]);
    const said = rowOf(refused.payload, "processes").actual;
    for (const p of judged) expect(said, p.name).toContain(`${p.name} ${p.pid} (${p.note})`);
    expect(said).toContain("not this command's own: cargo.exe 7001");
    expect(w.posted).toEqual([]);
  });

  // Built readings, each one a contradiction the machine is not known to have given. None was taken from it.
  const STRANGER = RAW[3];
  const QUIET = { pid: STRANGER.pid, created: STRANGER.created, name: "node.exe", contends: false, note: null };
  const MSI = { pid: 8800, created: "2026-10-13T09:57:00.0000000Z", name: "msiexec.exe", commandLine: "msiexec /i C:\\Users\\Kuya\\Downloads\\thing.msi" };
  // A classifier that lets an installer through. The stock one never does, and the observer does not lean on that.
  const lenient = (list, opts) => classifyProcesses(list, opts).map((g) => (preflight.isInstallerProgram(g.name) ? { ...g, contends: false, note: null } : g));
  const ONCE = "named more than once, where one reading names a process once";
  const NOT_IN_FULL = "by process: read, but not in full";
  const contradictions = [
    // A process named twice is kept both times, quiet or not: folded into the count, the reading would look whole.
    ["a quiet process named twice, word for word", { sweep: () => [...RAW, STRANGER], rows: [...OWN, QUIET, QUIET], others: 2, said: `${ONCE}: node.exe 9100, node.exe 9100` }],
    ["a quiet process named twice under two creation instants", { sweep: () => [...RAW, { ...STRANGER, created: "2026-10-13T02:00:00.0000000Z" }], rows: [...OWN, QUIET, { ...QUIET, created: "2026-10-13T02:00:00.0000000Z" }], others: 2, said: `${ONCE}: node.exe 9100, node.exe 9100` }],
    ["a quiet process named twice under two names", { sweep: () => [...RAW, { ...STRANGER, name: "Code.exe" }], rows: [...OWN, QUIET, { ...QUIET, name: "Code.exe" }], others: 2, said: `${ONCE}: node.exe 9100, Code.exe 9100` }],
    ["a process named twice, quiet once and contending once", { sweep: () => [...RAW, { ...STRANGER, commandLine: `"${NODE}" ${FOLDER}\\tools\\x.mjs` }], rows: [...OWN, QUIET, { ...QUIET, contends: true, note: AGAINST }], others: 2, said: `${ONCE}: node.exe 9100, node.exe 9100 (running against this folder)` }],
    ["the command's own process named twice", { sweep: () => [...RAW, RAW[1]], rows: [...OWN, OWN[1]], others: 3, said: `${ONCE}: node.exe 3980, node.exe 3980` }],
    // A process with no id or no creation instant cannot be told from the command's own, however quiet it looked.
    ["a quiet process with no id", { sweep: () => [...RAW, { ...STRANGER, pid: null }], rows: [...OWN, { ...QUIET, pid: null }], others: 3, said: NOT_IN_FULL }],
    ["a quiet process whose id is not a number", { sweep: () => [...RAW, { ...STRANGER, pid: "9101" }], rows: [...OWN, { ...QUIET, pid: null }], others: 3, said: NOT_IN_FULL }],
    ["a quiet process whose id is no process id", { sweep: () => [...RAW, { ...STRANGER, pid: 0 }], rows: [...OWN, { ...QUIET, pid: 0 }], others: 3, said: NOT_IN_FULL }],
    ["a quiet process with no creation instant", { sweep: () => [...RAW, { ...STRANGER, pid: 9101, created: null }], rows: [...OWN, { ...QUIET, pid: 9101, created: null }], others: 3, said: NOT_IN_FULL }],
    ["a quiet process whose creation instant is not one", { sweep: () => [...RAW, { ...STRANGER, pid: 9101, created: "13/10/2026 02:00" }], rows: [...OWN, { ...QUIET, pid: 9101, created: "13/10/2026 02:00" }], others: 3, said: NOT_IN_FULL }],
    // An installer is kept whatever a classifier made of it, and refused wherever it stands.
    ["an installer a classifier called quiet", { sweep: () => [...RAW, MSI], classify: lenient, rows: [...OWN, { pid: 8800, created: MSI.created, name: "msiexec.exe", contends: false, note: null }], others: 3, said: "an installer is never set aside, and the reading shows one: msiexec.exe 8800" }],
    [
      "an installer shown at the command's own process id and creation instant",
      {
        sweep: () => [RAW[0], { ...RAW[1], name: "msiexec.exe" }, ...RAW.slice(2)],
        rows: [OWN[0], { ...OWN[1], name: "msiexec.exe", contends: true, note: INSTALLING }, OWN[2]],
        others: 3,
        said: `not the program the chain names for that process: msiexec.exe 3980 (${INSTALLING}) against node.exe`,
      },
    ],
  ];

  it.each(contradictions)("keeps %s, so the check refuses on it and nothing is posted", (_what, { sweep, classify = classifyProcesses, rows, others, said }) => {
    const { out } = observed({ sweep, classify });
    expect(out.caller.snapshot).toEqual({ ok: true, takenAt: TAKEN, rows, others });
    // Still nothing of anyone else's but what the check must see: no command line leaves the observer.
    expect(JSON.stringify(out)).not.toMatch(/hunter2|private-lane|thing\.msi|x\.mjs|commandLine/);

    const w = wired();
    const observe = (args) => {
      w.calls.push("observe");
      return observed({ sessionId: args.sessionId, now: args.now, sweep, classify }).out;
    };
    const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject, observe }));
    expect(failingRows(refused)).toEqual(["processes"]);
    expect(rowOf(refused.payload, "processes").actual).toContain(said);
    expect(w.calls).toEqual(REFUSED_AT_CHECK);
    expect(w.posted).toEqual([]);
  });

  it("outside any work tree there is no guessed root, and no record is looked for", () => {
    const { out, asked } = observed({
      chain: () => {
        throw new Error("the process table did not answer");
      },
      toplevel: () => {
        throw new Error("fatal: not a git repository");
      },
    });
    expect(out).toMatchObject({ root: { path: null, source: null }, record: null, recordState: "absent", liveness: "none" });
    expect(asked.read).toEqual([]);
    expect(asked.liveness).toEqual([]);
  });

  it("a missing record and an unreadable one are told apart, and neither is asked for liveness", () => {
    const missing = observed({ read: () => null });
    expect(missing.out).toMatchObject({ record: null, recordState: "absent", liveness: "none" });
    const unreadable = observed({ read: () => CORRUPT });
    expect(unreadable.out).toMatchObject({ record: null, recordState: "corrupt", liveness: "none" });
    expect([...missing.asked.liveness, ...unreadable.asked.liveness]).toEqual([]);
  });

  it("live is what the command measured about itself: no reader is asked, and a recorded process id decides nothing", () => {
    // Whatever a reader handed in would answer, it is never reached: not to promote, not to condemn, not to fail.
    const answers = [
      () => ({ liveness: "dead", alive: false, seenAt: null }),
      () => ({ liveness: "unknown", alive: null, seenAt: null }),
      () => {
        throw new Error("a liveness reader was asked");
      },
    ];
    for (const answer of answers) {
      const reached = [];
      const { out } = observed({
        liveness: (...args) => {
          reached.push(args);
          return answer();
        },
      });
      expect(reached).toEqual([]);
      expect(out).toMatchObject({ record: RECORD, recordState: "ok", liveness: "live" });
    }
    // The process id in a record is whichever process a hook once ran under. It is not this session's
    // program and need not be running: the program's own, some other, or none at all, it decides nothing.
    for (const pid of [RECORD.pid, PROGRAM.pid, 99999, 0, null, undefined, "2000"]) {
      expect(observed({ read: () => ({ ...RECORD, pid }) }).out.liveness, String(pid)).toBe("live");
    }
    // The same folder spelled another way is the same folder.
    expect(observed({ read: () => ({ ...RECORD, folder: "c:/Users/Kuya/code/sentinel-renew/" }) }).out.liveness).toBe("live");

    // And a renewal is admitted on it, under a record whose process id names nothing that runs.
    const w = wired();
    const observe = (args) => {
      w.calls.push("observe");
      return observed({ sessionId: args.sessionId, read: () => ({ ...RECORD, pid: 99999 }), liveness: answers[0] }).out;
    };
    const out = launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject, observe });
    expect(w.calls).toEqual(ADMITTED);
    expect(rowOf(out.verdict, "holder.session").actual).toBe("session 5f0c2a9e holds this folder's record and is live");
  });

  it("a record is never live without an established command, whatever is handed in to say so", () => {
    const told = [];
    const sayLive = (...args) => {
      told.push(args);
      return { liveness: "live", alive: true, seenAt: NOW.toISOString() };
    };
    const noAnswer = () => {
      throw new Error("the machine did not answer");
    };
    const unestablished = [
      ["a process chain that could not be read", { chain: noAnswer }],
      ["a process chain that reaches no session program", { chain: () => [LAUNCHER, COMMAND, SHELL] }],
      ["a session program running from some other file", { chain: () => [LAUNCHER, COMMAND, SHELL, { ...PROGRAM, executable: "C:\\Temp\\claude.exe" }] }],
      ["no native program on the machine", { cli: null }],
      ["a native session list that could not be read", { sessions: noAnswer }],
      ["a native session list that names another session for the program", { sessions: () => [{ ...ENTRY, sessionId: OTHER_ID }] }],
      ["a session listed twice", { sessions: () => [...FLEET, { ...ENTRY, pid: 7100 }] }],
      ["a session that is not interactive", { sessions: () => [{ ...ENTRY, kind: "background" }] }],
      // Handed in to look alive: the recorded process id as the command's own, a record that carries
      // the session program's, and another session's id beside a record that names it.
      ["the recorded process id handed in as the command's own", { pid: RECORD.pid }],
      ["a record that carries the session program's own process id", { chain: noAnswer, read: () => ({ ...RECORD, pid: PROGRAM.pid }) }],
      ["another session's id, handed in beside a record that names it", { sessionId: OTHER_ID, read: () => ({ ...RECORD, sessionId: OTHER_ID }) }],
    ];
    for (const [what, over] of unestablished) {
      const { out } = observed({ env: { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PROJECT_DIR: FOLDER }, alive: true, live: true, ...over, liveness: sayLive });
      // The record is there, and it names the very session the command was handed. That is all it is.
      expect(out.recordState, what).toBe("ok");
      expect(out.record.sessionId, what).toBe(out.sessionId);
      expect(preflight.callerWitness(out).verified, what).toBe(false);
      expect(out.liveness, what).toBe("unknown");
    }
    expect(told).toEqual([]);
  });

  it("a record that names another session or another folder gains nothing from this command's own life", () => {
    const disagreeing = [
      ["another session", { ...RECORD, sessionId: OTHER_ID }],
      ["another session, under the session program's own process id", { ...RECORD, sessionId: OTHER_ID, pid: PROGRAM.pid }],
      ["no session at all", { ...RECORD, sessionId: undefined }],
      ["another folder", { ...RECORD, folder: ELSEWHERE }],
      ["no folder at all", { ...RECORD, folder: undefined }],
    ];
    for (const [what, record] of disagreeing) {
      const { out, asked } = observed({ read: () => record });
      // The command is established, and its session is live. The record is somebody else's, or nobody's.
      expect(preflight.callerWitness(out).verified, what).toBe(true);
      expect(out.recordState, what).toBe("ok");
      expect(out.liveness, what).toBe("unknown");
      expect(asked.liveness, what).toEqual([]);
    }

    // And the renewal refuses on it: that record is not this session's to renew under.
    const w = wired();
    const observe = (args) => {
      w.calls.push("observe");
      return observed({ sessionId: args.sessionId, read: () => disagreeing[1][1] }).out;
    };
    const refused = refusalOf(() => launcher.renew({ issue: 648, sessionId: SESSION, ...w.inject, observe }));
    expect(failingRows(refused)).toEqual(["holder.session"]);
    expect(rowOf(refused.payload, "holder.session").actual).toBe("this folder's record names session 9a9a9a9a, not 5f0c2a9e");
    expect(w.calls).toEqual(REFUSED_AT_CHECK);
    expect(w.posted).toEqual([]);
  });
});

describe("#648: what the observer asks the machine, and no more", () => {
  it("the chain is read one process id at a time, upward, and stops at the first session program", () => {
    const script = launcher.chainScript(LAUNCHER.pid);
    expect(script).not.toMatch(/[\r\n]/);
    expect(script).toContain("$id = 4120;");
    expect(script).toContain('Get-CimInstance Win32_Process -Filter "ProcessId = $id"');
    for (const field of ["ProcessId", "ParentProcessId", "CreationDate", "Name", "ExecutablePath"]) expect(script, field).toContain(field);
    // Who a process is, is its id, its creation instant and the file it runs from. Never a command line.
    expect(script).not.toContain("CommandLine");
    // Bounded: a chain is followed for as many steps as the check will accept, and no further.
    expect(script).toContain("$i -lt 12;");
    expect(script).toContain("-ieq 'claude.exe'");
    for (const bad of [0, -1, 1.5, "4120", "4120; Stop-Process -Id 1", null, undefined, Number.NaN]) expect(() => launcher.chainScript(bad), String(bad)).toThrow(/process id/);
  });

  it("each reader hands back a list, and anything else is a reading that failed", () => {
    const asked = [];
    const chain = launcher.readChain({
      pid: LAUNCHER.pid,
      run: (script) => {
        asked.push(script);
        return JSON.stringify(CHAIN);
      },
    });
    expect(chain).toEqual(CHAIN);
    expect(asked).toEqual([launcher.chainScript(LAUNCHER.pid)]);
    for (const out of ["", "not json", JSON.stringify(LAUNCHER), "null"]) expect(() => launcher.readChain({ pid: LAUNCHER.pid, run: () => out }), out).toThrow();

    const ran = [];
    const sessions = launcher.readSessions({
      cli: CLI,
      run: (file, args) => {
        ran.push([file, args]);
        return JSON.stringify(FLEET);
      },
    });
    expect(sessions).toEqual(FLEET);
    // The native program itself, asked for its own list: no folder, no session id and no shell between.
    expect(ran).toEqual([[CLI, ["agents", "--json"]]]);
    for (const out of ["", "{}", "null", "Usage: claude agents"]) expect(() => launcher.readSessions({ cli: CLI, run: () => out }), out).toThrow();
    expect(() => launcher.readSessions({ cli: null, run: () => "[]" })).toThrow();

    const swept = [];
    const reading = launcher.readSnapshot({
      run: (script) => {
        swept.push(script);
        return JSON.stringify(RAW);
      },
    });
    expect(reading).toEqual(RAW);
    expect(swept).toHaveLength(1);
    expect(swept[0]).not.toMatch(/[\r\n]/);
    expect(swept[0]).toContain(`-Filter "${launcher.snapshotFilter()}"`);
    for (const field of ["ProcessId", "CreationDate", "Name", "CommandLine"]) expect(swept[0], field).toContain(field);
    for (const out of ["", "{}", "null"]) expect(() => launcher.readSnapshot({ run: () => out }), out).toThrow();
    // An empty list is an answer: nothing watched was running, which is not a reading that failed.
    expect(launcher.readSnapshot({ run: () => "[]" })).toEqual([]);
  });

  it("the by-process reading watches everything the stock sweep does, and the installers it does not", () => {
    const filter = launcher.snapshotFilter();
    for (const name of WATCHED) expect(filter, name).toContain(`Name='${name}'`);
    expect(filter).toContain("Name='msiexec.exe'");
    expect(filter).toContain("Name LIKE '%setup.exe'");
    expect(filter).toContain("Name LIKE '%installer.exe'");
    // The stock sweep does not ask for installers at all, which is why a holder's reading has to.
    expect(WATCHED.filter((name) => /setup|installer|msiexec/i.test(name))).toEqual([]);
    // The classifier's own idea of an installer, pinned: a name it counts that this filter does not ask for is a hole.
    expect(readFileSync(join(HERE, "processes.mjs"), "utf8")).toContain("/setup\\.exe$|installer\\.exe$|^msiexec\\.exe$/i");
    for (const name of ["msiexec.exe", "MsiExec.exe", "CompySetup.exe", "vs_installer.exe", "Setup.exe"]) {
      expect(classifyProcesses([{ name, commandLine: "" }], { folder: FOLDER })[0], name).toMatchObject({ contends: true, note: INSTALLING });
      // The holder check never sets an installer aside, and knows one by the same rule.
      expect(preflight.isInstallerProgram(name), name).toBe(true);
    }
    for (const name of WATCHED) expect(preflight.isInstallerProgram(name), name).toBe(false);
  });

  it("no liveness reader is the launcher's to ask: it holds none, and the observer takes none", () => {
    const src = readFileSync(join(HERE, "launch.mjs"), "utf8");
    // The stock reader looks through the name of every project folder for a transcript. A renewal has
    // already measured the session it runs under, so the launcher does not hold that reader at all.
    // Each is compared as the list of what was found, so a failure names the reader and prints no source.
    const found = (text, pattern) => text.match(pattern) ?? [];
    expect(found(src, /observeLiveness|transcriptSeenAt|verifySession|CLAUDE_PROJECTS_DIR/g)).toEqual([]);
    const observer = src.slice(src.indexOf("export function observeHolder("), src.indexOf("export function renew("));
    expect(observer.includes("witness.verified")).toBe(true);
    expect(found(observer, /\bliveness\s*=|\bliveness\(/g)).toEqual([]);
    // Nor anything to go looking with: no environment, no home folder, no folder listing, no file's age.
    expect(found(observer, /process\.env|homedir|readdirSync|statSync|mtime/g)).toEqual([]);
  });

  it("the native program is the per-user install, never one an environment variable points at", () => {
    const home = "C:\\Users\\Kuya";
    expect(launcher.nativeCli({ exists: (p) => p === CLI, home })).toBe(CLI);
    // PATH is not read: with no per-user install there is no native program, whatever is on it.
    expect(launcher.nativeCli({ exists: (p) => p !== CLI, home })).toBeNull();
  });
});

describe("#648: the renew command runs the launcher, and only the launcher writes", () => {
  function ran(argv, status = 0) {
    const runs = [];
    const said = [];
    const code = cli.cmdRenew(argv, {
      run: (command) => {
        runs.push(command);
        return { status };
      },
      log: (line) => said.push(String(line)),
      err: (line) => said.push(String(line)),
    });
    return { code, runs, said: said.join("\n") };
  }

  it("refuses without an issue and without a session, and runs nothing", () => {
    const cases = [
      [["--session", SESSION], /--issue/],
      [["--issue", "648"], /--session/],
      [["--issue", "six", "--session", SESSION], /--issue/],
      [["--issue", "648", "--session", "--json"], /--session/],
      [[], /--issue/],
    ];
    for (const [argv, says] of cases) {
      const r = ran(argv);
      expect(r.code, argv.join(" ")).toBe(1);
      expect(r.runs, argv.join(" ")).toEqual([]);
      expect(r.said, argv.join(" ")).toMatch(says);
    }
  });

  it("hands the launcher the issue and the session, and relays its exit", () => {
    for (const [status, code] of [[0, 0], [1, 1], [3, 3], [null, 3]]) {
      const r = ran(["--issue", "648", "--session", SESSION], status);
      expect(r.runs).toEqual([{ issue: 648, session: SESSION }]);
      expect(r.code).toBe(code);
    }
  });

  it("runs the launcher itself as the program: this node, that file, no flags between them", () => {
    const { file, args } = cli.renewLauncherCommand({ issue: 648, session: SESSION });
    expect(file).toBe(process.execPath);
    expect(resolve(args[0])).toBe(resolve(join(HERE, "launch.mjs")));
    expect(args.slice(1)).toEqual(["--renew", "--issue", "648", "--session", SESSION]);
  });

  it("is a command the dispatcher knows, and the command line posts nothing of its own", () => {
    const src = readFileSync(join(HERE, "cli.mjs"), "utf8");
    expect(src).toContain("renew: cmdRenew");
    expect(src).toContain("expected preflight | choose | assert | adopt | renew | bridge | handoff");
    expect(src).not.toMatch(/claim\.mjs|postClaim|planPostClaim|planRenew|execPlan/);
  });

  it("the launcher takes `--renew` with the issue and the session it was handed", () => {
    const src = readFileSync(join(HERE, "launch.mjs"), "utf8");
    const entry = src.slice(src.lastIndexOf("if (process.argv[1] && import.meta.url"));
    expect(entry).toContain('argv.includes("--renew")');
    expect(entry).toContain('arg("--session")');
  });
});
