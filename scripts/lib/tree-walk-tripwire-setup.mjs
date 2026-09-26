// #515: the vitest setup file that arms scripts/lib/tree-walk-tripwire.mjs for every test file.
//
// Each test is watched from its first beforeEach to its last afterEach. A test that walked the real
// tree or the worktree fleet on less than TREE_WALK_TIMEOUT_MS fails here, with the fix in the
// message, instead of passing today and timing out the pre-push gate the next time the machine is
// busy. So does a test that started GIT_SPAWN_FLOOR or more git processes on less than
// GIT_SPAWN_TIMEOUT_MS (#563). The afterEach is registered first, so under vitest's "stack" hook order
// it runs LAST, after the test's own cleanup.
//
// Hooks (#563): the beforeAll below runs first of the file's beforeAll hooks, after collection, and
// wraps every hook in the file so each hook's git processes are counted against that hook. A hook
// that crossed the floor on less than the budget fails the file in the afterAll, which runs last.
//
// COMPY_TREE_WALK_CENSUS=<dir> turns the failure off and writes one JSON line per test (and per file,
// for collection-time and beforeAll work, and per hook that started git) to
// <dir>/census-<pid>.jsonl instead. That is how the floors in tree-walk-tripwire.mjs were chosen, and
// how to re-check them.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, TestRunner } from "vitest";
import { GIT_SPAWN_TIMEOUT_MS, TREE_WALK_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";
import {
  beginTest,
  endTest,
  gitSpawnVerdict,
  hookGitVerdict,
  installTreeWalkTripwire,
  measures,
  takeFileLevel,
  takeHookRecords,
  tripwireVerdict,
  walkReason,
  watchHooks,
} from "./tree-walk-tripwire.mjs";

// No `new URL(...)`: under jsdom the global URL is jsdom's, and fileURLToPath refuses it.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CENSUS = process.env.COMPY_TREE_WALK_CENSUS;

installTreeWalkTripwire(ROOT);

const writeCensus = (line) => appendFileSync(path.join(CENSUS, `census-${process.pid}.jsonl`), `${JSON.stringify(line)}\n`);

function census(row, o) {
  writeCensus({
    ...row,
    reason: walkReason(o),
    ...measures(o),
    git: o.git.map((g) => `${g.where}:${g.sub}${g.enumerates ? "*" : ""}:${g.entries ?? "?"}:${g.ms ?? "?"}ms`),
    children: o.children.map((c) => `${c.script}:${c.ms ?? "?"}ms`),
  });
}

let started = 0;
let file = "";
const relative = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// No parameter: vitest 4 parses a hook's first parameter as a fixture list. It passes the file
// suite as the last argument.
beforeAll(function () {
  const suite = arguments[arguments.length - 1];
  if (suite?.filepath) file = relative(suite.filepath);
  watchHooks(suite, (s) => TestRunner.getSuiteHooks(s));
});

beforeEach(() => {
  started = performance.now();
  beginTest();
});

afterEach((ctx) => {
  const o = endTest();
  file = relative(ctx.task.file.filepath);
  if (CENSUS) {
    census({ file, name: ctx.task.fullName, timeout: ctx.task.timeout, ms: Math.round(performance.now() - started) }, o);
    return;
  }
  const failure =
    tripwireVerdict(ctx.task.timeout, o, TREE_WALK_TIMEOUT_MS) ?? gitSpawnVerdict(ctx.task.timeout, o, GIT_SPAWN_TIMEOUT_MS);
  if (failure) throw new Error(failure);
});

afterAll(() => {
  const o = takeFileLevel();
  const hooks = takeHookRecords();
  if (CENSUS) {
    if (file) census({ file, name: "<file level>", timeout: null, ms: null }, o);
    for (const h of hooks) writeCensus({ file, name: `<${h.kind}> ${h.suite}`, hook: true, timeout: h.timeout ?? null, ms: h.ms, gitSpawns: h.gitSpawns });
    return;
  }
  const failures = hooks.map((h) => hookGitVerdict(h, GIT_SPAWN_TIMEOUT_MS)).filter(Boolean);
  if (failures.length) throw new Error(failures.join("\n"));
});
