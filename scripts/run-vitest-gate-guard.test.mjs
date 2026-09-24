// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { parseCLI } from "vitest/node";
import { GATE_HELD_ENV, classifyArgsCheaply, gateDecision, holdGate } from "./lib/gate-mutex.mjs";

// #543 -- a lane's hand-started FULL suite queues on the pre-push gate's test mutex. #522 made gates
// queue behind each other, but two of the starved gate runs it cited had no peer gate at all: the load
// was lanes' own `npm test` / unfiltered `node scripts/run-vitest.mjs run`, which took no lock. This
// file pins the fix: which command lines queue (decided without loading vitest where it can be, and
// cross-checked against vitest's own parser where it cannot), and -- against REAL processes -- that a
// full run waits for a holder and names it, a filtered run does not, a run nested in the gate does
// not wait on its own parent, a stale marker exempts nothing, and a run that dies cannot leave the
// gate held.
//
// NEVER THE PRODUCTION NAME. This file runs inside `npm test`, which runs inside a gate that HOLDS
// Local\Compy.TestGate.v1, and that gate's COMPY_TEST_GATE_HELD reaches this process. Every process
// case uses a fresh Local\Compy.Test.<uuid>, a private state directory, and an environment with the
// inherited marker removed -- a case that kept it would read as nested and prove nothing.
//
// TIMEOUT: per file, like gate-mutex-guard.test.mjs, its sibling -- these cases start Windows
// PowerShell holders and wait on them; no assertion here is about speed.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const root = join(import.meta.dirname, "..");
const libUrl = new URL("./lib/gate-mutex.mjs", import.meta.url).href;
const read = (rel) => readFileSync(join(root, ...rel.split("/")), "utf8");
const stripJsComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILTERED = "src/lib/format.test.ts";
// What vitest itself says: does this command line run every test file?
const vitestSaysFull = (args) => {
  const { filter, options } = parseCLI(["vitest", ...args]);
  return !filter?.length && !options.changed && !options.shard && !options.related?.length;
};

describe("which command lines queue on the test gate", () => {
  const decide = (args, extra = {}) => gateDecision(args, { platform: "win32", env: {}, interactive: false, parse: parseCLI, ...extra });

  it.each([
    // [args, takes the gate, why]
    [["run"], true, "npm test itself"],
    [[], true, "the default command outside a terminal runs once"],
    [["run", "--reporter=verbose"], true, "flags only"],
    [["run", "--maxWorkers", "1"], true, "an option's value is not a file filter"],
    [["run", "-t", "renders"], true, "-t still loads every file"],
    [["--run"], true, "--run is a run"],
    [["run", FILTERED], false, "a file filter"],
    [[FILTERED], false, "a file filter on the default command"],
    [["run", "--maxWorkers", "1", "--environment", "node", FILTERED], false, "vitest-filter-guard's own shape"],
    [["run", "--changed"], false, "a subset"],
    [["run", "--shard=1/4"], false, "a subset"],
    [["watch"], false, "watch"],
    [["dev"], false, "watch"],
    [["run", "--watch"], false, "watch"],
    [["list"], false, "not the suite"],
    [["bench"], false, "not the suite"],
    [["related", "src/lib/format.ts"], false, "not the suite"],
  ])("%j -> queues: %s (%s)", async (args, takes) => {
    const decision = await decide(args);
    expect(decision.take, decision.why).toBe(takes);
  });

  it("agrees with vitest's own parser wherever it answers without loading it", () => {
    const shapes = [["run"], [], ["run", "--reporter=verbose"], ["run", "--silent", "--bail=1"], ["run", FILTERED], [FILTERED], ["run", FILTERED, "src/other.test.ts"], ["watch", FILTERED]];
    for (const args of shapes) {
      const cheap = classifyArgsCheaply(args);
      expect(cheap, JSON.stringify(args)).not.toBeNull();
      expect(cheap.suite === "full", JSON.stringify(args)).toBe(vitestSaysFull(args));
    }
    // Where a bare token could be an option's value, only vitest knows -- the cheap reading declines.
    for (const args of [["run", "--maxWorkers", "1"], ["run", "-t", "x"], ["--", FILTERED], ["run", "--changed"]]) {
      expect(classifyArgsCheaply(args), JSON.stringify(args)).toBeNull();
    }
  });

  it("treats the default command in a terminal as watch, so a person's watch session never holds the gate", async () => {
    expect((await decide([], { interactive: true })).take).toBe(false);
    expect((await decide(["run"], { interactive: true })).take).toBe(true);
  });

  it("queues `npm test` exactly as package.json spells it", async () => {
    const [runner, script, ...args] = JSON.parse(read("package.json")).scripts.test.split(/\s+/);
    expect([runner, script]).toEqual(["node", "scripts/run-vitest.mjs"]);
    expect((await decide(args)).take).toBe(true);
  });

  it("does not wait inside a live holder, but a dead holder's marker exempts nothing", async () => {
    const nested = await decide(["run"], { env: { [GATE_HELD_ENV]: String(process.pid) } });
    expect(nested.take).toBe(false);
    expect(nested.why).toContain(`holder pid ${process.pid}`);
    const stale = await decide(["run"], { env: { [GATE_HELD_ENV]: "4242" }, alive: () => false });
    expect(stale.take).toBe(true);
    expect(stale.why).toMatch(/stale/);
    for (const junk of ["", "yes", "-1", "0"]) expect((await decide(["run"], { env: { [GATE_HELD_ENV]: junk } })).take).toBe(true);
  });

  it("never queues off Windows, where there is no named mutex", async () => {
    expect((await decide(["run"], { platform: "linux" })).take).toBe(false);
  });
});

describe("scripts/run-vitest.mjs routes every run through the queue", () => {
  it("hands its whole argv to runQueued and launches vitest only through it, with the child's env", () => {
    const code = stripJsComments(read("scripts/run-vitest.mjs"));
    expect(code).toMatch(/import\s*\{\s*runQueued\s*\}\s*from\s*"\.\/lib\/gate-mutex\.mjs"/);
    expect(code).toMatch(/await runQueued\(process\.argv\.slice\(2\),/);
    expect(code).toMatch(/launch:\s*launchVitest/);
    // One spawn, inside the launcher, and it passes the env runQueued built (the marker rides in it).
    expect(code.match(/spawnSync\(/g)).toHaveLength(1);
    expect(code).toMatch(/const launchVitest = \(args, \{ cwd, env \}\) =>\s*spawnSync\(process\.execPath, \[vitestBin, \.\.\.args\], \{ cwd, env,/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Real processes. The driver is run-vitest.mjs's flow (runQueued) with vitest swapped for a stub that
// stamps when it started and what marker it was handed, so no case starts a real suite.

const DRIVER = `
const [argsJson, name, stateDir, timeout, mode] = process.argv.slice(2);
const { runQueued } = await import(${JSON.stringify(libUrl)});
console.log("PID " + process.pid);
const code = await runQueued(JSON.parse(argsJson), {
  cwd: process.cwd(),
  interactive: false,
  gate: { name, stateDir, timeoutSeconds: Number(timeout), noticeSeconds: 1, stderr: "inherit", ...(mode === "no-powershell" ? { powershell: "C:\\\\no\\\\such\\\\powershell.exe" } : {}) },
  launch: async (args, { env }) => {
    console.log("LAUNCHED " + Date.now() + " marker=[" + (env.${GATE_HELD_ENV} ?? "") + "]");
    if (mode === "hang") await new Promise((resolve) => setTimeout(resolve, 600_000));
    return 7;
  },
});
console.log("EXIT " + code);
process.exit(code);
`;

let driverPath;
let driverDir;
const live = new Set();
const leases = new Set();
const tempRoots = new Set();

beforeAll(() => {
  driverDir = mkdtempSync(join(tmpdir(), "compy-run-vitest-gate-driver-"));
  driverPath = join(driverDir, "driver.mjs");
  writeFileSync(driverPath, DRIVER, "utf8");
  return () => rmSync(driverDir, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all([...leases].map((lease) => lease.release({ graceMs: 5_000 })));
  for (const child of live) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.all([...live].map((child) => child.done));
  for (const path of tempRoots) rmSync(path, { recursive: true, force: true });
  live.clear();
  leases.clear();
  tempRoots.clear();
});

const makeCase = () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "compy-run-vitest-gate-"));
  tempRoots.add(stateRoot);
  return { name: `Local\\Compy.Test.${crypto.randomUUID()}`, stateDir: join(stateRoot, "state") };
};

// The gate this process runs inside set the marker; no case may inherit it.
const cleanEnv = (marker) => {
  const env = { ...process.env };
  delete env[GATE_HELD_ENV];
  if (marker !== undefined) env[GATE_HELD_ENV] = marker;
  return env;
};

const drive = (testCase, args, { timeout = 60, marker, mode = "" } = {}) => {
  const child = spawn(process.execPath, [driverPath, JSON.stringify(args), testCase.name, testCase.stateDir, String(timeout), mode], {
    cwd: root,
    env: cleanEnv(marker),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.out = "";
  child.err = "";
  child.stdout.on("data", (chunk) => (child.out += chunk));
  child.stderr.on("data", (chunk) => (child.err += chunk));
  child.done = new Promise((resolve) => child.once("exit", (code) => resolve({ code, stdout: child.out, stderr: child.err })));
  live.add(child);
  return child;
};

const hold = async (testCase, label, timeoutSeconds = 60) => {
  const lease = await holdGate({ name: testCase.name, stateDir: testCase.stateDir, label, timeoutSeconds, noticeSeconds: 1, stderr: "pipe" });
  leases.add(lease);
  return lease;
};
const release = async (lease) => {
  leases.delete(lease);
  return lease.release();
};

const waitFor = async (predicate, what, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const launched = (stdout) => {
  const m = /^LAUNCHED (\d+) marker=\[(.*)\]\s*$/m.exec(stdout);
  return m ? { at: Number(m[1]), marker: m[2] } : null;
};

describe.runIf(process.platform === "win32")("a full ad-hoc suite queues on the gate, against real processes", () => {
  it("waits while another process holds the gate, names it, and starts only after it lets go", async () => {
    const testCase = makeCase();
    const peer = await hold(testCase, "verify-local.ps1 in peer-lane");
    const run = drive(testCase, ["run"]);
    await waitFor(() => /TEST GATE: busy/.test(run.err), "the full run to report the gate busy");
    await waitFor(() => /TEST GATE: still queued after \d+s/.test(run.err), "a still-queued notice");
    expect(run.err).toContain(`held by pid ${peer.pid} (verify-local.ps1 in peer-lane)`);
    expect(run.out).not.toMatch(/^LAUNCHED /m);

    const releasedAt = Date.now();
    expect((await release(peer)).code).toBe(0);
    const result = await run.done;
    expect(result.code, result.stderr).toBe(7);
    const start = launched(result.stdout);
    expect(start).not.toBeNull();
    expect(start.at).toBeGreaterThanOrEqual(releasedAt);
    // It hands its own holder's pid to the suite, so the suite's nested runs do not queue behind it.
    expect(start.marker).toMatch(/^\d+$/);
    expect(start.marker).not.toBe(String(peer.pid));
    expect(result.stderr).toMatch(/TEST GATE: acquired '.*' after \d+s in the queue\./);
    expect(result.stderr).toContain(`TEST GATE: released '${testCase.name}'.`);
  });

  it("runs a filtered suite at once, beside a holder", async () => {
    const testCase = makeCase();
    const peer = await hold(testCase, "verify-local.ps1 in peer-lane");
    const result = await drive(testCase, ["run", FILTERED]).done;
    expect(result.code, result.stderr).toBe(7);
    expect(launched(result.stdout)).toEqual(expect.objectContaining({ marker: "" }));
    expect(result.stderr).not.toMatch(/TEST GATE/);
    expect(peer.child.exitCode).toBeNull();
  });

  it("does not wait on the gate it runs inside -- and the same run without the marker would have", async () => {
    const testCase = makeCase();
    const gate = await hold(testCase, "verify-local.ps1 in this-lane");
    const nested = await drive(testCase, ["run"], { marker: String(gate.pid) }).done;
    expect(nested.code, nested.stderr).toBe(7);
    expect(nested.stderr).not.toMatch(/TEST GATE/);
    expect(launched(nested.stdout)?.marker).toBe(String(gate.pid));

    // Negative control: the identical run, marker removed, queues on that holder and gives up.
    const unmarked = await drive(testCase, ["run"], { timeout: 2 }).done;
    expect(unmarked.code).toBe(1);
    expect(unmarked.stdout).not.toMatch(/^LAUNCHED /m);
    expect(unmarked.stderr).toContain(`held by pid ${gate.pid} (verify-local.ps1 in this-lane)`);
    expect(unmarked.stderr).toMatch(/TEST GATE: gave up after/);
    expect(unmarked.stderr).toContain("run-vitest: the full suite did not start");
  });

  it("does not let a dead holder's leftover marker exempt a full run", async () => {
    const testCase = makeCase();
    const gone = spawn(process.execPath, ["-e", ""], { windowsHide: true });
    const deadPid = gone.pid;
    await new Promise((resolve) => gone.once("exit", resolve));
    const peer = await hold(testCase, "verify-local.ps1 in peer-lane");
    const result = await drive(testCase, ["run"], { timeout: 2, marker: String(deadPid) }).done;
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/^LAUNCHED /m);
    expect(result.stderr).toContain(`held by pid ${peer.pid}`);
  });

  it("lets go of the gate when the run dies mid-suite, without leaving it abandoned", async () => {
    const testCase = makeCase();
    const run = drive(testCase, ["run"], { mode: "hang" });
    await waitFor(() => /^LAUNCHED /m.test(run.out), "the full run to start its suite");
    run.kill();
    await run.done;
    // The holder saw its stdin close and released: the next taker gets it without a takeover.
    const next = await hold(testCase, "next gate", 30);
    const lines = next.stderrText();
    expect(lines).toMatch(/TEST GATE: acquired '.*' (\(no wait\)|after \d+s in the queue)\./);
    expect(lines).not.toMatch(/TEST GATE WARN/);
  });

  it("still runs, with a warning, when the holder cannot even be started", async () => {
    const result = await drive(makeCase(), ["run"], { mode: "no-powershell" }).done;
    expect(result.code, result.stderr).toBe(7);
    expect(result.stderr).toContain("run-vitest: WARN could not queue this full suite on the test gate");
    expect(launched(result.stdout)?.marker).toBe("");
  });

  // Codex review of PR #571: the holder mapped EVERY failure to the give-up exit, so a helper that
  // broke refused the run as if the gate were busy. A name Windows rejects ("Could not find a part
  // of the path") makes Enter-GateMutex throw something other than its bounded-wait give-up.
  it("still runs, with a warning, when the holder starts but fails for a reason other than a busy gate", async () => {
    const testCase = makeCase();
    const result = await drive({ ...testCase, name: `${testCase.name}\\not-a-name` }, ["run"]).done;
    expect(result.code, result.stderr).toBe(7);
    expect(result.stderr).toContain("TEST GATE WARN: the gate holder failed before it held");
    expect(result.stderr).toContain("run-vitest: WARN could not queue this full suite on the test gate");
    expect(result.stderr).not.toMatch(/TEST GATE: gave up/);
    expect(launched(result.stdout)?.marker).toBe("");
  });
});
