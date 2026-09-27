// #515: notice, at runtime, a test that walks the WHOLE real tree or the whole worktree fleet.
//
// A test like that costs the tree's size times the disk's current speed, so under load it is the
// first thing past vitest's 15 s default: on 2026-09-23 three of them took turns failing the
// pre-push gate with nothing but `Test timed out`. They need TREE_WALK_TIMEOUT_MS, and the next one
// written will not know that. A static scan of test source cannot tell a walk of the real tree from a
// walk of a 3-file fixture repo in os.tmpdir() (it found 651 candidates in 103 files, nearly all of
// them fixtures); the running test can. So this watches what the test actually does.
//
// It wraps the child_process and fs entry points once per worker, then syncs the ESM bindings, so
// `import { execFileSync } from "node:child_process"` in a test sees the wrapper too. Each call is
// attributed to the test that is running (tree-walk-tripwire-setup.mjs sets and clears it). Only
// paths in THIS checkout ("tree") or another registered checkout of the same repo ("fleet") count;
// os.tmpdir() fixtures and node_modules never do.
//
// What it cannot see, stated so nobody assumes otherwise: a walk done by a child `node` process (the
// child's own reads are not in this process; the child is recorded, not measured), a walk done at
// collection time or in beforeAll (no test is running, so there is no timeout to check; census mode
// records it as the FILE's walk), vite's `import.meta.glob` (resolved by the transform, outside the
// worker), `fs.promises.glob`, streams, and the bytes of a read made through a file descriptor (the
// open is counted, the bytes are not). A test that is slow for another reason, such as many git
// spawns against an os.tmpdir() fixture, is not a walk; the git-spawn check below (#563) covers it.
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const STATE = Symbol.for("compy.tree-walk-tripwire");

// ── what counts as a walk ───────────────────────────────────────────────────────────────────────
// "Whole tree" is measured, not guessed. On 2026-09-23 the tree was 2015 tracked files in 493
// directories, 61 MB (24 MB of it text). The path, directory and file floors below are about half
// of that. A census of the whole suite (COMPY_TREE_WALK_CENSUS, in the setup file) put every test
// that crossed a floor among the tests doing whole-tree or fleet work. The busiest test that crossed
// none sat well under each floor: 794 files and 6.5 MB read (case-endpoint-isolation), 679 paths
// listed (a recursive readdir of src/), 111 directories listed, one other checkout reached. Listing
// src/ or docs/ is not a walk of the tree; reading most of it is.
export const FLEET_CHECKOUT_FLOOR = 3; // distinct OTHER registered checkouts a test reaches into
export const LISTED_PATH_FLOOR = 1000; // paths of this tree one git enumeration, or all recursive fs listings, returned
export const DIR_LISTING_FLOOR = 250; // distinct directories of this tree listed one at a time
export const FILE_READ_FLOOR = 1000; // distinct files of this tree opened for reading
export const BYTE_READ_FLOOR = 10_000_000; // bytes read from files of this tree

export function emptyObservation() {
  return {
    git: [], // { sub, rest, where, enumerates, entries?, ms? } — tree/fleet calls only
    children: [], // { script, ms? } — `node` children started inside this tree
    fleetCheckouts: new Set(),
    listedDirs: new Set(), // directories of this tree passed to a non-recursive readdir/opendir
    recursivePaths: new Set(), // paths of this tree returned by recursive readdir or a `**` glob
    readFiles: new Set(),
    bytesRead: 0,
    gitSpawns: 0, // every git process this test started, os.tmpdir() fixtures included (#563)
    hookGitSpawns: 0, // the part of gitSpawns its beforeEach/afterEach hooks started (#563)
  };
}

// The census row / verdict inputs, as plain numbers.
export function measures(o) {
  return {
    fleet: o.fleetCheckouts.size,
    dirListings: o.listedDirs.size,
    recursivePaths: o.recursivePaths.size,
    fileReads: o.readFiles.size,
    bytesRead: o.bytesRead,
    gitSpawns: o.gitSpawns,
    hookGitSpawns: o.hookGitSpawns,
  };
}

// `git [-C dir]... [-c k=v]... [--opt]... <sub> <rest>`: the directory it runs in and what it runs.
const GLOBAL_OPTS_WITH_VALUE = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
export function parseGit(args, cwd) {
  let dir = cwd;
  let i = 0;
  for (; i < args.length; i++) {
    const a = String(args[i]);
    if (a === "-C") dir = path.resolve(dir, String(args[++i]));
    else if (GLOBAL_OPTS_WITH_VALUE.has(a)) i++;
    else if (!a.startsWith("-")) break;
  }
  return { dir, sub: i < args.length ? String(args[i]) : "", rest: args.slice(i + 1).map(String) };
}

// Commands that list the tree's paths. `git grep` also READS every file its pathspec covers.
export function enumerates({ sub, rest }) {
  if (sub === "ls-files" || sub === "grep") return true;
  if (sub === "ls-tree") return rest.some((a) => /^-[^-]*r/.test(a));
  return false;
}

// Why this observation is a whole-tree or fleet walk, or null when it is not one.
export function walkReason(o) {
  const m = measures(o);
  if (m.fleet >= FLEET_CHECKOUT_FLOOR) return `it reaches into ${m.fleet} other checkouts of this repo`;
  // git grep reads every file its pathspec covers, however little it prints.
  if (o.git.some((g) => g.where === "tree" && g.sub === "grep")) return "it runs `git grep` over this tree";
  const listed = o.git.find((g) => g.where === "tree" && g.enumerates && (g.entries ?? 0) >= LISTED_PATH_FLOOR);
  if (listed) return `\`git ${listed.sub}\` listed ${listed.entries} paths of this tree`;
  if (m.recursivePaths >= LISTED_PATH_FLOOR) return `its recursive listings returned ${m.recursivePaths} paths of this tree`;
  if (m.dirListings >= DIR_LISTING_FLOOR) return `it listed ${m.dirListings} directories of this tree`;
  if (m.fileReads >= FILE_READ_FLOOR) return `it read ${m.fileReads} files of this tree`;
  if (m.bytesRead >= BYTE_READ_FLOOR) return `it read ${(m.bytesRead / 1e6).toFixed(1)} MB of this tree`;
  return null;
}

// The failure a walker on too small a timeout gets, or null. Pure, so the rule itself is testable.
export function tripwireVerdict(timeout, o, budget) {
  const why = walkReason(o);
  if (!why || timeout >= budget) return null;
  return (
    `tree-walk tripwire (#515): this test walks the real tree or worktree fleet — ${why} — ` +
    `but runs on a ${timeout} ms timeout. Under a loaded machine that is how the pre-push gate ` +
    `fails with a bare "Test timed out". Give it the measured budget: ` +
    `\`{ timeout: TREE_WALK_TIMEOUT_MS }\` from src/test/tree-walk-budget.ts (${budget} ms), on the ` +
    `test or its describe. Do not narrow what it checks to get under the default.`
  );
}

// ── many git processes (#563) ──────────────────────────────────────────────────────────────────
// A test that builds a fixture repository in os.tmpdir() walks nothing, but every git process it
// starts pays for a process start, and the full suite's own parallelism starves those. The
// 2026-09-24 gate that failed on seven such tests (logs/verify-local-2026-09-24T05-18-40Z.log, in a
// checkout since removed, so its file times are kept here) ran their files 8.3 to 11.4 times slower
// than a census of the whole suite on 2026-09-26: verify-release-state-guard 195.7 s against 23.5 s
// (8.3), first-launch 81.0 s against 8.36 s (9.7), branch-disposition-audit 127.6 s against 12.61 s
// (10.1), target-ownership 138.7 s against 12.14 s (11.4). In that census 348 of 7,704 tests started
// git, at 60 ms a process at the median and 225 ms at worst. The floor is the lowest count that
// keeps every test under it clear of the default at the worst measured slowdown: the slowest
// default-timeout test starting fewer than 6 took 467 ms, 5.3 s at 11.4 times, a third of the 15 s
// default. At 7 that would have been a 962 ms test (11.0 s), at 8 a 1.6 s test (18.3 s, past the
// default). The count is deterministic where a time would flake.
//
// What counts as a git process: a direct git, and a git a shell runs in the ordinary forms that
// gitInvocations below lists. It reads those forms; it is not a shell parser, and these are its limits:
// - Git another program or builtin starts is not counted, such as a child `node` process, an npm
//   script, a .ps1 or .sh file, eval or xargs. That program's own children are not in this process.
// - A loop's or a function's git counts once however often it runs.
// - Git anywhere but a command position it reads is not counted, such as the command of a cmd
//   `for /f` or a program named by a substitution ("$(which git)" status).
// - Escapes (cmd's ^, sh's \, PowerShell's `) are not read. An escaped quote still quotes, and so does
//   a lone apostrophe in cmd (echo it's done & git status), so either can hide the git after it.
// - An escaped separator still separates, each shell's separators separate in all three, and a
//   comment or here-document is read as commands, so a git that never runs can be counted. That
//   over-counts, and an over-count fails loud as a budget demand, never silently.
export const GIT_SPAWN_FLOOR = 6; // git processes one test, or one hook, starts

// The failure a test that starts GIT_SPAWN_FLOOR or more git processes gets on too small a timeout,
// or null. Its beforeEach/afterEach hooks run on their own hook timeout, so their git is theirs.
export function gitSpawnVerdict(timeout, o, budget) {
  const n = o.gitSpawns - o.hookGitSpawns;
  if (n < GIT_SPAWN_FLOOR || timeout >= budget) return null;
  return (
    `git-spawn tripwire (#563): this test starts ${n} git processes (the floor is ${GIT_SPAWN_FLOOR}) ` +
    `but runs on a ${timeout} ms timeout. On a loaded machine each can take over a second, and that ` +
    `is how the pre-push gate fails with a bare "Test timed out". Give it the measured budget: ` +
    `\`{ timeout: GIT_SPAWN_TIMEOUT_MS }\` from src/test/tree-walk-budget.ts (${budget} ms), on the ` +
    `test or its describe, or start fewer git processes. Do not narrow what it checks.`
  );
}

// The same rule for one hook, or for the cleanup a before-hook returned: { kind, suite, timeout,
// gitSpawns, cleanup?, overlap? }. vitest keeps a before-hook's timeout on the hook, and its cleanup
// runs on that same timeout; it keeps an after-hook's only inside a closure, so that one is unknown.
export function hookGitVerdict(h, budget) {
  if (h.overlap) return overlapVerdict("hooks");
  if (h.gitSpawns < GIT_SPAWN_FLOOR || (typeof h.timeout === "number" && h.timeout >= budget)) return null;
  const count = `starts ${h.gitSpawns} git processes (the floor is ${GIT_SPAWN_FLOOR})`;
  if (h.cleanup) {
    return (
      `git-spawn tripwire (#563): the cleanup returned by the ${h.kind} hook of "${h.suite}" ${count} ` +
      `but runs on the ${h.timeout} ms timeout it takes from that hook. Give the hook the measured ` +
      `budget as its second argument, \`${h.kind}(fn, GIT_SPAWN_TIMEOUT_MS)\` from ` +
      `src/test/tree-walk-budget.ts (${budget} ms), or start fewer git processes.`
    );
  }
  const which = `the ${h.kind} hook of "${h.suite}" ${count}`;
  if (typeof h.timeout !== "number") {
    return (
      `git-spawn tripwire (#563): ${which}, and vitest does not expose an ${h.kind} hook's timeout, so ` +
      `its budget cannot be checked. Move that git work into a beforeAll or beforeEach given ` +
      `GIT_SPAWN_TIMEOUT_MS from src/test/tree-walk-budget.ts (${budget} ms) as its second argument.`
    );
  }
  return (
    `git-spawn tripwire (#563): ${which} but runs on a ${h.timeout} ms hook timeout. On a loaded ` +
    `machine that is how a whole describe fails with "Hook timed out". Give it the measured budget ` +
    `as its second argument, \`${h.kind}(fn, GIT_SPAWN_TIMEOUT_MS)\` from src/test/tree-walk-budget.ts ` +
    `(${budget} ms), or start fewer git processes.`
  );
}

// The failure for tests, or hooks, that ran at the same time in one worker. Everything above is
// counted against the one test or hook that is running, so two at once cannot be told apart; the
// tripwire fails closed rather than charge one for the other's work, or miss it.
export function overlapVerdict(what) {
  const which =
    what === "tests"
      ? "tests ran at the same time in one worker (test.concurrent, describe.concurrent or sequence.concurrent)"
      : `hooks ran at the same time in one worker (sequence.hooks "parallel", or a hook that timed out and kept running)`;
  return (
    `tree-walk and git-spawn tripwire (#515, #563): ${which}. The tripwire counts git processes and ` +
    `reads of this tree against the one test or hook that is running, so it cannot tell which of them ` +
    `did what. Run them one at a time, as vitest does by default.`
  );
}

// ── where a path lives ─────────────────────────────────────────────────────────────────────────
const norm = (p) => path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const under = (n, root) => n === root || n.startsWith(`${root}/`);

// The checkouts registered with this repo: the main one plus `<common>/worktrees/*/gitdir`.
export function registeredCheckouts(root, fsx) {
  const dotGit = path.join(root, ".git");
  let common = dotGit;
  try {
    const text = fsx.readFileSync(dotGit, "utf8"); // a worktree: "gitdir: <common>/worktrees/<name>"
    const own = path.resolve(root, text.replace(/^gitdir:\s*/, "").trim());
    common = path.resolve(own, fsx.readFileSync(path.join(own, "commondir"), "utf8").trim());
  } catch {
    // .git is a directory (the main checkout), or absent: `common` stays <root>/.git
  }
  const out = [path.dirname(common)];
  let names = [];
  try {
    names = fsx.readdirSync(path.join(common, "worktrees"));
  } catch {
    // no linked worktrees
  }
  for (const name of names) {
    try {
      out.push(path.dirname(fsx.readFileSync(path.join(common, "worktrees", name, "gitdir"), "utf8").trim()));
    } catch {
      // a half-removed registration; git itself calls it prunable
    }
  }
  return out;
}

// "tree" | { fleet: <checkout> } | null, for one path. `loadFleet` is only called for a path outside
// this checkout and outside os.tmpdir(), which keeps fixture-heavy tests from paying for it.
export function createLocator(root, loadFleet, tmp = os.tmpdir()) {
  const rootN = norm(root);
  const tmpN = norm(tmp);
  let fleet = null;
  const fleetOf = (n) => {
    fleet ??= loadFleet().map(norm).filter((f) => f !== rootN).sort((a, b) => b.length - a.length);
    return fleet.find((f) => under(n, f)) ?? null;
  };
  return (p) => {
    const n = norm(p);
    if (n.includes("/node_modules/") || n.endsWith("/node_modules")) return null;
    if (under(n, rootN)) {
      // Inside this checkout, unless it is a checkout nested inside it (the main checkout holds
      // the others under .claude/worktrees).
      if (n.startsWith(`${rootN}/.claude/worktrees/`)) {
        const other = fleetOf(n);
        if (other) return { fleet: other };
      }
      return "tree";
    }
    if (under(n, tmpN)) return null;
    const other = fleetOf(n);
    return other ? { fleet: other } : null;
  };
}

// ── the wrappers ───────────────────────────────────────────────────────────────────────────────
function pathOf(p) {
  if (typeof p === "string") return p;
  // Duck-typed: under jsdom the global URL is jsdom's, so `instanceof URL` misses a node file URL.
  if (p && typeof p === "object" && p.protocol === "file:" && typeof p.href === "string") return fileURLToPath(p.href);
  if (p && typeof p === "object" && typeof p.toString === "function" && ArrayBuffer.isView(p)) return p.toString();
  return null; // a file descriptor
}

function countEntries(out) {
  if (out == null) return undefined;
  const s = typeof out === "string" ? out : ArrayBuffer.isView(out) ? Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString("latin1") : "";
  if (!s) return 0;
  const sep = s.includes("\0") ? "\0" : "\n";
  return s.split(sep).filter(Boolean).length;
}

const programOf = (p) => path.basename(String(p)).toLowerCase().replace(/\.(exe|cmd)$/, "");
const tokenize = (cmd) =>
  String(cmd)
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, ""));

// ── how many git processes a command starts (#563) ────────────────────────────────────────────
// A shell string (exec, execSync, `shell: true`) and a shell given a script (cmd /c or /k,
// powershell or pwsh -Command or any prefix of it, sh, bash, zsh or dash -c) count every git at a
// command position of the script, nested shells included: at its start, or after && || ; & | ( ) { }
// $( or a backtick or newline outside quotes, past any VAR=value, env, exec, command, time, do, then,
// else, if, elif, while, until or ! in front of it, and in PowerShell only past an assignment ($out = ,
// $out=, $all += and the other assignment operators). Inside double quotes a $(...) runs its script in sh-family shells and PowerShell, and a backtick pair does in sh-family
// shells; cmd has neither. Single quotes are literal, in cmd too, where the program cmd runs reads
// them (cmd /c "sh -c '...'"). The limits are listed above GIT_SPAWN_FLOOR.
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const POWERSHELLS = new Set(["powershell", "pwsh"]);
const LEADING_WORDS = new Set(["env", "exec", "command", "time", "do", "then", "else", "if", "elif", "while", "until", "!"]);
const PS_OPERATOR = /^(?:[-+*/%]|\?\?)?=/;
const PS_ASSIGNMENT = /^\$[A-Za-z_][\w:]*(?:[-+*/%]|\?\?)?=/;

// "cmd", "powershell" or "sh": which of the rules above a program's script is read by.
const dialectOf = (prog) => (prog === "cmd" ? "cmd" : POWERSHELLS.has(prog) ? "powershell" : "sh");

// The shell a shell string runs in: the one `shell` names, else cmd on Windows and sh elsewhere.
export const shellDialect = (shell, platform = process.platform) =>
  dialectOf(typeof shell === "string" ? programOf(shell) : platform === "win32" ? "cmd" : "sh");

function scriptOf(prog, args) {
  if (prog === "cmd") {
    const at = args.findIndex((a) => /^\/[ck]$/i.test(a));
    return at < 0 ? null : args.slice(at + 1).join(" ");
  }
  if (POWERSHELLS.has(prog)) {
    const at = args.findIndex((a) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(a));
    return at < 0 ? null : args.slice(at + 1).join(" ");
  }
  if (SHELLS.has(prog)) {
    const at = args.findIndex((a) => /^-[a-z]*c[a-z]*$/i.test(a));
    return at < 0 ? null : args[at + 1] ?? null;
  }
  return null;
}

// One command, as its program and arguments: 1 for git, what its script starts for a shell, else 0.
// `dialect` is the shell reading the command, or null when a program is started with no shell.
export function gitSpawnsOf(argv, dialect = null) {
  const words = argv.map(String);
  const powershell = dialect === "powershell";
  let i = 0;
  while (i < words.length) {
    // PowerShell's assignment, spaced or not: $out = git ..., $out=git ..., $all += git ...
    if (powershell && /^\$[A-Za-z_][\w:]*$/.test(words[i]) && PS_OPERATOR.test(words[i + 1] ?? "")) words.splice(i, 2, words[i] + words[i + 1]);
    const value = powershell ? words[i].replace(PS_ASSIGNMENT, "") : words[i];
    if (value !== words[i]) {
      if (value) words[i] = value;
      else i += 1;
    } else if (LEADING_WORDS.has(words[i]) || /^[A-Za-z_]\w*=/.test(words[i])) i += 1;
    else break;
  }
  if (i >= words.length) return 0;
  const prog = programOf(words[i]);
  if (prog === "git") return 1;
  const script = scriptOf(prog, words.slice(i + 1));
  return script == null ? 0 : gitInvocations(script, dialectOf(prog));
}

// The index of the ")" that closes the "(" at `open`, past quoted text; the end if there is none.
function closeOf(s, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")" && --depth === 0) {
      return i;
    }
  }
  return s.length;
}

// A shell script: the git processes its commands start, read by `dialect` (see dialectOf).
export function gitInvocations(script, dialect = "sh") {
  const s = String(script);
  let n = 0;
  let from = 0;
  let quote = null;
  const command = (end) => {
    const words = [...s.slice(from, end).matchAll(/"([^"]*)"|'([^']*)'|[^\s"']+/g)].map((m) => m[1] ?? m[2] ?? m[0]);
    n += gitSpawnsOf(words, dialect);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === '"' && dialect !== "cmd" && c === "$" && s[i + 1] === "(") {
      const end = closeOf(s, i + 1);
      n += gitInvocations(s.slice(i + 2, end), dialect);
      i = end;
    } else if (quote === '"' && dialect === "sh" && c === "`") {
      const close = s.indexOf("`", i + 1);
      const end = close < 0 ? s.length : close;
      n += gitInvocations(s.slice(i + 1, end), dialect);
      i = end;
    } else if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if ("&|;(){}`\r\n".includes(c) || (c === "$" && s[i + 1] === "(")) {
      command(i);
      from = i + 1;
    }
  }
  command(s.length);
  return n;
}

function splitArgs(rest) {
  const [first, second] = rest;
  const args = Array.isArray(first) ? first : [];
  const opts = Array.isArray(first) ? second : first;
  return { args, opts: opts && typeof opts === "object" ? opts : {} };
}

// A wrapper must carry what hangs off the function it replaces: `fs.realpathSync.native` and the
// promisify.custom hooks on exec/execFile are properties, and a test that uses one breaks without it.
const NOT_COPIED = new Set(["length", "name", "prototype", "arguments", "caller"]);
function keep(wrapper, original) {
  for (const key of Reflect.ownKeys(original)) {
    if (NOT_COPIED.has(key) || Object.hasOwn(wrapper, key)) continue;
    Object.defineProperty(wrapper, key, Object.getOwnPropertyDescriptor(original, key));
  }
  return wrapper;
}

function install(root) {
  const cp = require("node:child_process");
  const fs = require("node:fs");
  const orig = {
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
  };
  const state = {
    current: null,
    fileLevel: emptyObservation(),
    hooks: [], // { kind, suite, timeout, gitSpawns, ms, overlap? } for each hook run that started git (#563)
    spawned: 0, // every git process this worker started; a hook's share is the difference across it
    running: 0, // tests between beginTest and endTest, and whether two ever were at once
    testOverlap: false,
    inFlight: new Set(), // hooks and cleanups running now, and whether two ever were at once
    hookOverlap: false,
    locate: createLocator(root, () => registeredCheckouts(root, orig)),
  };
  const obs = () => state.current ?? state.fileLevel;

  const touch = (p) => {
    const s = pathOf(p);
    if (s == null) return null;
    const where = state.locate(s);
    if (where && where !== "tree") obs().fleetCheckouts.add(where.fleet);
    return where;
  };

  // A child process: count the git processes it starts, record git runs against the tree or fleet,
  // and `node` children in the tree.
  const noteChild = (cmd, args, opts, shellString) => {
    const argv = shellString || (opts.shell && args.length === 0) ? tokenize(cmd) : [String(cmd), ...args.map(String)];
    const prog = programOf(argv[0]);
    const cwd = opts.cwd ? pathOf(opts.cwd) ?? process.cwd() : process.cwd();
    const command = [String(cmd), ...args.map(String)];
    const spawns = shellString || opts.shell ? gitInvocations(command.join(" "), shellDialect(opts.shell)) : gitSpawnsOf(command);
    obs().gitSpawns += spawns;
    state.spawned += spawns;
    if (prog === "git") {
      const g = parseGit(argv.slice(1), cwd);
      const where = touch(g.dir);
      if (!where) return null;
      const rec = { sub: g.sub, rest: g.rest.slice(0, 8), where: where === "tree" ? "tree" : "fleet", enumerates: enumerates(g) };
      obs().git.push(rec);
      return rec;
    }
    if ((prog === "node" || argv[0] === process.execPath) && state.locate(cwd) === "tree") {
      const rec = { script: argv.slice(1).find((a) => !a.startsWith("-")) ?? "" };
      obs().children.push(rec);
      return rec;
    }
    return null;
  };

  const wrapSync = (name, shellString, stdoutOf) => {
    const original = cp[name];
    cp[name] = keep(function (cmd, ...rest) {
      const { args, opts } = shellString ? { args: [], opts: splitArgs(rest).opts } : splitArgs(rest);
      const rec = noteChild(cmd, args, opts, shellString);
      if (!rec) return original.call(this, cmd, ...rest);
      const t0 = performance.now();
      try {
        const out = original.call(this, cmd, ...rest);
        if ("sub" in rec) rec.entries = countEntries(stdoutOf(out));
        return out;
      } finally {
        rec.ms = Math.round(performance.now() - t0);
      }
    }, original);
  };
  const wrapAsync = (name, shellString) => {
    const original = cp[name];
    const note = (cmd, rest) => {
      const { args, opts } = shellString ? { args: [], opts: splitArgs(rest).opts } : splitArgs(rest);
      noteChild(cmd, args, opts, shellString);
    };
    const wrapper = function (cmd, ...rest) {
      note(cmd, rest);
      return original.call(this, cmd, ...rest);
    };
    // promisify(execFile) resolves { stdout, stderr } only through this hook; keep it.
    const custom = original[promisify.custom];
    if (custom) {
      wrapper[promisify.custom] = function (cmd, ...rest) {
        note(cmd, rest);
        return custom.call(this, cmd, ...rest);
      };
    }
    cp[name] = keep(wrapper, original);
  };
  wrapSync("execFileSync", false, (out) => out);
  wrapSync("spawnSync", false, (out) => out?.stdout);
  wrapSync("execSync", true, (out) => out);
  wrapAsync("spawn", false);
  wrapAsync("execFile", false);
  wrapAsync("exec", true);

  // Each hook below runs before the call and returns what to do with its result (or null). The
  // observation is captured at call time, so an async result lands on the test that asked for it.
  const entryPath = (dir, e) =>
    typeof e === "string" || ArrayBuffer.isView(e)
      ? path.join(dir, String(e))
      : path.join(e?.parentPath ?? e?.path ?? dir, String(e?.name ?? ""));
  const listing = (p, o) => {
    if (touch(p) !== "tree") return null;
    const target = obs();
    const dir = pathOf(p);
    if (!(o && typeof o === "object" && o.recursive)) {
      target.listedDirs.add(norm(dir));
      return null;
    }
    return (entries) => {
      for (const e of entries ?? []) target.recursivePaths.add(norm(entryPath(dir, e)));
    };
  };
  const reading = (p) => {
    if (touch(p) !== "tree") return null;
    const target = obs();
    target.readFiles.add(norm(pathOf(p)));
    return (out) => {
      target.bytesRead += out?.length ?? 0;
    };
  };
  const opening = (p, flags) => (flags == null || flags === "r" || flags === "rs" ? reading(p) : null);
  const globbing = (pattern, o) => {
    const cwd = (o && typeof o === "object" && o.cwd && pathOf(o.cwd)) || process.cwd();
    if (touch(cwd) !== "tree" || ![pattern].flat().some((x) => String(x).includes("**"))) return null;
    const target = obs();
    return (entries) => {
      for (const e of entries ?? []) target.recursivePaths.add(norm(entryPath(cwd, e)));
    };
  };

  const optsOf = (rest) => (rest[0] && typeof rest[0] === "object" ? rest[0] : undefined);
  const wrapFs = (target, name, hook, kind) => {
    const original = target[name];
    if (typeof original !== "function") return;
    target[name] = keep(function (p, ...rest) {
      const done = hook(p, kind === "open" ? rest[0] : optsOf(rest));
      if (!done) return original.call(this, p, ...rest);
      if (kind === "promise") return original.call(this, p, ...rest).then((out) => (done(out), out));
      if (kind === "callback") {
        const i = rest.findIndex((f) => typeof f === "function");
        if (i >= 0) {
          const cb = rest[i];
          rest[i] = function (err, out) {
            if (!err) done(out);
            return cb.apply(this, arguments);
          };
        }
        return original.call(this, p, ...rest);
      }
      const out = original.call(this, p, ...rest);
      if (kind !== "open") done(out);
      return out;
    }, original);
  };
  wrapFs(fs, "readdirSync", listing, "sync");
  wrapFs(fs, "readdir", listing, "callback");
  wrapFs(fs.promises, "readdir", listing, "promise");
  wrapFs(fs, "opendirSync", (p) => listing(p), "sync");
  wrapFs(fs, "readFileSync", reading, "sync");
  wrapFs(fs, "readFile", reading, "callback");
  wrapFs(fs.promises, "readFile", reading, "promise");
  // A read through a descriptor counts as a file read, without its bytes. readFileSync may open
  // through fs.openSync itself; the file is counted once either way.
  wrapFs(fs, "openSync", opening, "open");
  wrapFs(fs, "globSync", globbing, "sync");
  wrapFs(fs, "glob", globbing, "callback");
  // Fleet reach through the filesystem alone (no git): a stat of another checkout counts.
  for (const name of ["statSync", "lstatSync", "existsSync", "accessSync", "realpathSync"]) {
    const original = fs[name];
    fs[name] = keep(function (p, ...rest) {
      touch(p);
      return original.call(this, p, ...rest);
    }, original);
  }
  syncBuiltinESMExports();
  return state;
}

// Once per worker process. Setup files run once per test FILE, and in a reused worker the builtins
// are already wrapped; a second wrap would count everything twice.
export function installTreeWalkTripwire(root) {
  globalThis[STATE] ??= install(root);
  return globalThis[STATE];
}

// The running test's observation so far, or null when no test is running or the tripwire is not
// armed in this worker.
export function currentObservation() {
  return globalThis[STATE]?.current ?? null;
}

// A test that begins while another is running marks every test running until none is: the
// observation of each is then `overlap: true`, and the setup file fails it (#563).
export function beginTest() {
  const s = globalThis[STATE];
  if (!s) return;
  if (s.running++ > 0) s.testOverlap = true;
  s.current = emptyObservation();
}

export function endTest() {
  const s = globalThis[STATE];
  if (!s) return emptyObservation();
  const o = s.current ?? emptyObservation();
  if (s.testOverlap) o.overlap = true;
  s.running = Math.max(0, s.running - 1);
  if (s.running === 0) s.testOverlap = false;
  s.current = null;
  return o;
}

// A new test file: nothing still running from the last file in this worker, such as a hook that
// timed out and never returned, counts as running at the same time as this file's hooks.
export function beginFile() {
  const s = globalThis[STATE];
  if (!s) return;
  s.running = 0;
  s.testOverlap = false;
  s.inFlight = new Set();
  s.hookOverlap = false;
}

export function takeFileLevel() {
  const s = globalThis[STATE];
  if (!s) return emptyObservation();
  const o = s.fileLevel;
  s.fileLevel = emptyObservation();
  return o;
}

// ── hooks (#563) ───────────────────────────────────────────────────────────────────────────────
const HOOK_KINDS = ["beforeAll", "beforeEach", "afterEach", "afterAll"];
const HOOK_TIMEOUT = Symbol.for("VITEST_CLEANUP_TIMEOUT"); // where @vitest/runner keeps a before-hook's timeout
const WATCHED = Symbol.for("compy.git-spawn-hook");

// One hook or cleanup run: the git processes this worker started while it ran, and whether anything
// else (another hook, or a second test) was running at the same time, which makes that count
// unattributable.
function watching(s) {
  const token = {};
  if (s.inFlight.size > 0) s.hookOverlap = true;
  s.inFlight.add(token);
  const before = s.spawned;
  const t0 = performance.now();
  const testsOverlapped = s.testOverlap;
  return () => {
    const overlap = s.hookOverlap || testsOverlapped || s.testOverlap;
    s.inFlight.delete(token);
    if (s.inFlight.size === 0) s.hookOverlap = false;
    return { n: s.spawned - before, ms: Math.round(performance.now() - t0), overlap };
  };
}

function watchHook(s, hook, kind, suite, judge) {
  const w = async function (...args) {
    const target = s.current ?? s.fileLevel;
    const done = watching(s);
    let result;
    try {
      result = await hook.apply(this, args);
    } finally {
      const { n, ms, overlap } = done();
      if (kind.endsWith("Each")) target.hookGitSpawns += n;
      if (n > 0 || overlap) s.hooks.push({ kind, suite, timeout: hook[HOOK_TIMEOUT], gitSpawns: n, ms, ...(overlap ? { overlap } : {}) });
    }
    // A function a before-hook returns is its cleanup, run after the matching after-hooks: after the
    // setup file's afterEach or afterAll has judged everything else, so it is judged where it runs.
    return typeof result === "function" && kind.startsWith("before")
      ? watchCleanup(s, result, kind, suite, hook[HOOK_TIMEOUT], judge)
      : result;
  };
  w[WATCHED] = true;
  return keep(w, hook); // carries the timeout and stack-trace keys the runner reads back
}

// The cleanup runs on the timeout of the hook that returned it, so it is judged against that
// timeout. A cleanup that throws on its own keeps its own error.
function watchCleanup(s, cleanup, kind, suite, timeout, judge) {
  return keep(async function (...args) {
    const done = watching(s);
    let result;
    let seen;
    try {
      result = await cleanup.apply(this, args);
    } finally {
      seen = done();
    }
    if (seen.n > 0 || seen.overlap) {
      const record = { kind, cleanup: true, suite, timeout, gitSpawns: seen.n, ms: seen.ms, ...(seen.overlap ? { overlap: true } : {}) };
      const failure = judge?.(record);
      if (failure) throw new Error(failure);
    }
    return result;
  }, cleanup);
}

// Wrap every hook of one test file, in place, so each hook's git processes are counted against it.
// Called from the setup file's own beforeAll, which runs first and after collection, so every suite
// and hook is registered. vitest iterates a suite's beforeAll hooks from the very array it keeps, so
// the file's own top-level beforeAll hooks, still ahead in that loop, run wrapped as well. `getHooks`
// is vitest's TestRunner.getSuiteHooks, passed in so this module stays free of the runner. `judge`
// receives each cleanup's record when it runs and returns a failure message or null.
export function watchHooks(fileSuite, getHooks, judge) {
  const s = globalThis[STATE];
  if (!s || !fileSuite) return 0;
  let watched = 0;
  const walk = function* (suite) {
    yield suite;
    for (const t of suite.tasks ?? []) if (t.type === "suite") yield* walk(t);
  };
  for (const suite of walk(fileSuite)) {
    const hooks = getHooks(suite);
    for (const kind of HOOK_KINDS) {
      const list = hooks?.[kind] ?? [];
      for (let i = 0; i < list.length; i++) {
        if (list[i][WATCHED]) continue;
        list[i] = watchHook(s, list[i], kind, suite === fileSuite ? "<file>" : suite.fullName ?? suite.name, judge);
        watched++;
      }
    }
  }
  return watched;
}

// The hook runs recorded so far in this file (live, so a test can claim its own specimen), and the
// same list taken and cleared at the end of the file.
export function hookRecords() {
  return globalThis[STATE]?.hooks ?? [];
}

export function takeHookRecords() {
  const s = globalThis[STATE];
  if (!s) return [];
  const h = s.hooks;
  s.hooks = [];
  return h;
}
