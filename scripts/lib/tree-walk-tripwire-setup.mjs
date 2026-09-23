// #515: the vitest setup file that arms scripts/lib/tree-walk-tripwire.mjs for every test file.
//
// Each test is watched from its first beforeEach to its last afterEach. A test that walked the real
// tree or the worktree fleet on less than TREE_WALK_TIMEOUT_MS fails here, with the fix in the
// message, instead of passing today and timing out the pre-push gate the next time the machine is
// busy. The afterEach is registered first, so under vitest's "stack" hook order it runs LAST, after
// the test's own cleanup.
//
// COMPY_TREE_WALK_CENSUS=<dir> turns the failure off and writes one JSON line per test (and per file,
// for collection-time and beforeAll work) to <dir>/census-<pid>.jsonl instead. That is how the
// floors in tree-walk-tripwire.mjs were chosen, and how to re-check them.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach } from "vitest";
import { TREE_WALK_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";
import {
  beginTest,
  endTest,
  installTreeWalkTripwire,
  measures,
  takeFileLevel,
  tripwireVerdict,
  walkReason,
} from "./tree-walk-tripwire.mjs";

// No `new URL(...)`: under jsdom the global URL is jsdom's, and fileURLToPath refuses it.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CENSUS = process.env.COMPY_TREE_WALK_CENSUS;

installTreeWalkTripwire(ROOT);

function census(row, o) {
  const line = {
    ...row,
    reason: walkReason(o),
    ...measures(o),
    git: o.git.map((g) => `${g.where}:${g.sub}${g.enumerates ? "*" : ""}:${g.entries ?? "?"}:${g.ms ?? "?"}ms`),
    children: o.children.map((c) => `${c.script}:${c.ms ?? "?"}ms`),
  };
  appendFileSync(path.join(CENSUS, `census-${process.pid}.jsonl`), `${JSON.stringify(line)}\n`);
}

let started = 0;
let file = "";
beforeEach(() => {
  started = performance.now();
  beginTest();
});

afterEach((ctx) => {
  const o = endTest();
  file = path.relative(ROOT, ctx.task.file.filepath).replace(/\\/g, "/");
  if (CENSUS) {
    census({ file, name: ctx.task.fullName, timeout: ctx.task.timeout, ms: Math.round(performance.now() - started) }, o);
    return;
  }
  const failure = tripwireVerdict(ctx.task.timeout, o, TREE_WALK_TIMEOUT_MS);
  if (failure) throw new Error(failure);
});

// No parameter: vitest 4 parses a hook's first parameter as a fixture list.
afterAll(() => {
  const o = takeFileLevel();
  if (CENSUS && file) census({ file, name: "<file level>", timeout: null, ms: null }, o);
});
