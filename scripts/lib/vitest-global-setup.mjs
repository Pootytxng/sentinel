// #339: rule C of scripts/handoff-worktree-truth.test.mjs asks origin ONE question -- which heads it
// holds -- and asked it from INSIDE the worker pool, where that file's slice of the CPU is whatever
// 400 other files leave it. A `git ls-remote` that lost its slice read as an unreachable origin and
// redded the whole pre-push gate, on a machine that was online the entire time. vitest's globalSetup
// runs once, in the main process, BEFORE the pool exists: origin is asked here, and the answer
// travels to the workers through vitest's provide/inject.
//
// null is a REFUSAL, not an empty answer: origin was unreachable (or over its deadline) at setup, and
// the consumer fails closed exactly as it did when it measured for itself. The setup never throws --
// a failed origin would otherwise abort the run before a single test spoke.
//
// The measurement is skipped when the command line names test files and none of them is the one
// consumer: `npm test -- src/foo.test.ts` must not reach the network. With nothing provided the
// consumer measures for itself, as before -- the status quo, never a silent pass. Whether it was
// measured is provided unconditionally, so a worker can tell "the setup skipped" from "the setup
// never ran" -- the second is the wiring silently gone, and scripts/vitest-global-setup.test.mjs
// fails on it live.
import { execFileSync } from "node:child_process";

export const ORIGIN_HEADS_KEY = "originLsRemote";
export const ORIGIN_MEASURED_KEY = "originLsRemoteMeasured";
export const CONSUMER = "handoff-worktree-truth";

// Bounded like scripts/fleet-snapshot.mjs's own call: an origin that hangs must read as unreachable.
const TALK_TO_ORIGIN = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 };

export function measureOriginHeads(exec = execFileSync) {
  try {
    return String(exec("git", ["ls-remote", "--heads", "origin"], TALK_TO_ORIGIN)).trim();
  } catch {
    return null;
  }
}

// vitest's command words are not filters; everything else that does not start with `-` is one. A
// value-taking option in its two-token form (`--maxWorkers 4`) leaves a stray positional, and that
// only ever narrows towards "skip", where the consumer measures for itself -- never towards a pass.
const COMMAND_WORDS = new Set(["run", "watch", "dev", "bench", "list", "related", "init"]);
export function wantsOrigin(argv) {
  const filters = argv.filter((a) => !a.startsWith("-") && !COMMAND_WORDS.has(a));
  return filters.length === 0 || filters.some((a) => a.includes(CONSUMER));
}

// What the consumer hands to snapshot(): undefined leaves snapshot's own runner in place; null is a
// runner that refuses, so originHeads() returns null and `trusted` stays null; text is the answer.
export function providedLsRemote(provided) {
  if (provided === undefined) return undefined;
  return () => {
    if (provided === null) throw new Error("origin unreachable at vitest global setup (#339)");
    return provided;
  };
}

// vitest 4 calls `setup(project)` with the TestProject; `provide` is a method on it (it reaches the
// root project through `this`), so it is called as one, never destructured.
export default async function setup(project, { argv = process.argv.slice(2), measure = measureOriginHeads } = {}) {
  const wanted = wantsOrigin(argv);
  project.provide(ORIGIN_MEASURED_KEY, wanted);
  if (wanted) project.provide(ORIGIN_HEADS_KEY, measure());
}
