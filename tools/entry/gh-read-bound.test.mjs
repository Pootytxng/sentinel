// Guard for #474: every `gh` read in gather.mjs has a time bound, and a GitHub that stops answering
// comes back unreadable instead of holding the push.
//
// `readIssueThread` sits inside every `git push`: .githooks/pre-push -> scripts/verify-local.ps1 ->
// scripts/scope-drift-gate.mjs -> resolveClaim, whenever the claim cache is missing or stale. Its `gh`
// ran through execFileSync with no `timeout`, and nothing above it had one. Measured 2026-09-18, a
// proxy that accepted the connection and never answered held that read, and the gate, for 61-63 s.
//
// Each layer fails against the gather.mjs before #474:
//   1. every reader's DEFAULT path hands execFileSync the bound;
//   2. a real child that never answers is killed at the bound, and the read comes back unreadable;
//   3. the scope-drift gate turns that read into the verdicts it already gave a GitHub that was down.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Through the namespace, so an export that does not exist yet fails its own case, not the file.
import * as gather from "./gather.mjs";
import { gate, render } from "../../scripts/scope-drift-gate.mjs";
import { CACHE_TTL_MS, writeClaimCache } from "../../scripts/lib/scope-drift.mjs";

// The literal, not gather's export: on a gather.mjs without the bound, both would be undefined and equal.
const BOUND_MS = 20_000;

// Layer 1 cannot use vi.mock: vitest loads .mjs files natively, so a mock never reaches gather.mjs's
// own `node:child_process` import. A child node does it instead. A resolve hook hands gather.mjs, and
// only gather.mjs, a child_process whose execFileSync records what each gh call was handed. Each
// reader then runs with no `run` passed. The child's PATH holds node alone, so if the hook ever
// misses, the real gh cannot be found: the case fails with no calls recorded, and never reaches GitHub.
const GATHER_URL = pathToFileURL(join(gather.HERE, "gather.mjs")).href;
const STUB = `
import * as real from "node:child_process";
export * from "node:child_process";
export function execFileSync(file, args, opts) {
  if (file !== "gh") return real.execFileSync(file, args, opts);
  globalThis.ghCalls.push({ argv: args.join(" "), timeout: opts?.timeout });
  // "project view" answers, so readProjectIds reaches its second read. Every other gh read fails.
  if (args[0] === "project" && args[1] === "view") return JSON.stringify({ id: "PVT_stub" });
  throw new Error("gh stub: no answer");
}`;
const PROBE = `
import { registerHooks } from "node:module";
const stub = "data:text/javascript," + encodeURIComponent(${JSON.stringify(STUB)});
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "node:child_process" && String(context.parentURL).endsWith("/tools/entry/gather.mjs")) {
      return { url: stub, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const gather = await import(${JSON.stringify(GATHER_URL)});
const readers = {
  readIssueThread: () => gather.readIssueThread(474),
  readIssueThreads: () => gather.readIssueThreads([474]),
  readIssueBody: () => gather.readIssueBody(474),
  readBoard: () => gather.readBoard(),
  readProjectIds: () => gather.readProjectIds("PVTI_stub"),
  gatherScopeFacts: () => gather.gatherScopeFacts({ task: { number: 474 }, items: [{ number: 1, status: "Active" }], git: () => "" }),
};
const out = {};
for (const [name, read] of Object.entries(readers)) {
  globalThis.ghCalls = [];
  try {
    read();
  } catch {}
  out[name] = globalThis.ghCalls;
}
process.stdout.write(JSON.stringify(out));
`;

describe("every reader's default gh hands execFileSync the bound", () => {
  let calls;
  beforeAll(() => {
    const env = { ...process.env, PATH: dirname(process.execPath) };
    delete env.Path;
    calls = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], { encoding: "utf8", env, timeout: 30_000 }));
  });

  it("the bound is 20 s: the slowest read measured took 4.1 s, and a silent proxy held gh for 61 s", () => {
    expect(gather.GH_READ_TIMEOUT_MS).toBe(BOUND_MS);
  });

  it.each([
    ["readIssueThread", 1],
    ["readIssueThreads", 1],
    ["readIssueBody", 1],
    ["readBoard", 1],
    ["readProjectIds", 2],
    ["gatherScopeFacts", 2],
  ])("%s", (name, count) => {
    expect(calls[name]).toHaveLength(count);
    for (const call of calls[name]) expect(call, call.argv).toMatchObject({ timeout: BOUND_MS });
  });
});

// A `gh` that never answers: gather's own reader and the real execFileSync, with a node that sleeps 5 s
// where gh would have run. Only the program is swapped; every option is the one gather hands gh.
const SLEEP_5S = "setTimeout(() => {}, 5000)";
const silentGh = (timeout, errors = []) =>
  gather.ghReader({
    timeout,
    exec: (_gh, _args, opts) => {
      try {
        return execFileSync(process.execPath, ["-e", SLEEP_5S], opts);
      } catch (e) {
        errors.push(e);
        throw e;
      }
    },
  });

describe("a gh that never answers is killed at the bound, and the read is unreadable", () => {
  const timed = (read) => {
    const t = performance.now();
    const answer = read();
    return { answer, ms: performance.now() - t };
  };

  it("readIssueThread gets control back before the child would have finished on its own", () => {
    const errors = [];
    const { answer, ms } = timed(() => gather.readIssueThread(474, { run: silentGh(300, errors) }));
    expect(answer).toEqual({ claim: null, handoff: null, unreadable: true });
    expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
    expect(ms).toBeLessThan(4_500);
  });

  it("readIssueThreads marks every issue in the batch unreadable", () => {
    const errors = [];
    const { answer, ms } = timed(() => gather.readIssueThreads([474, 475], { run: silentGh(300, errors) }));
    expect([...answer.values()].map((t) => t.unreadable)).toEqual([true, true]);
    expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
    expect(ms).toBeLessThan(4_500);
  });

  it("readBoard reports the board unreachable", () => {
    const errors = [];
    const { answer, ms } = timed(() => gather.readBoard({ run: silentGh(300, errors) }));
    expect(answer).toMatchObject({ reachable: false, items: [] });
    expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
    expect(ms).toBeLessThan(4_500);
  });
});

describe("the scope-drift gate reads a silent GitHub as unreadable, and its verdicts stand", () => {
  let dir;
  const now = new Date("2026-09-18T12:00:00Z");
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "compy-gh-read-bound-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("with no cache: not measured, in the words it already used for a thread it could not read", () => {
    const errors = [];
    const thread = (issue) => gather.readIssueThread(issue, { run: silentGh(300, errors) });
    const r = gate({ issue: 41, cwd: dir, cacheDir: dir, now, thread });
    expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
    expect(r).toMatchObject({ ok: true, measured: false, issue: 41 });
    expect(render(r)).toBe("scope drift (#356): not measured -- no claim readable for #41 (thread unreadable or claim-less, no cache)");
  });

  it("with a stale cache: measured against it, labelled stale", () => {
    writeClaimCache({ issue: 42, scopeText: "`tools/entry/`", folder: dir }, { dir, now: new Date(now.getTime() - CACHE_TTL_MS - 1) });
    const errors = [];
    const thread = (issue) => gather.readIssueThread(issue, { run: silentGh(300, errors) });
    const git = (_cwd, args) => {
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse") return "0".repeat(40);
      if (args[0] === "diff") return "tools/entry/gather.mjs\0";
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const r = gate({ issue: 42, cwd: dir, cacheDir: dir, now, thread, git });
    expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
    expect(r).toMatchObject({ ok: true, measured: true, claimSource: "cache", stale: true, outside: [] });
    expect(render(r)).toContain("measured against the claim on #42 (cache, stale)");
  });
});
