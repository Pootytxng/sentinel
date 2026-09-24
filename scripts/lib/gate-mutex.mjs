// gate-mutex.mjs - an ad-hoc full vitest suite queues on the pre-push gate's mutex (#543).
//
// WHY. #522 made scripts/verify-local.ps1 hold Local\Compy.TestGate.v1 through its heavy stages, so
// two gates no longer run their suites side by side. But two of the starved gate runs #522 cited had
// no peer gate at all: their load came from full suites lanes started by hand (`npm test`,
// `node scripts/run-vitest.mjs run` with no file filter). A full suite is a full suite whoever starts
// it -- one vitest pool of about one worker per core -- so scripts/run-vitest.mjs now queues on the
// same mutex whenever it runs every test file once.
//
// WHAT QUEUES, on purpose:
//   - a RUN of the FULL suite: no file filter, no --changed or --shard (`-t name` still loads every
//     file, so it queues too);
//   - never a filtered run: one file is not the load that starves a gate, and lanes run those all day;
//   - never watch mode: it holds its pool for as long as a person keeps it open, and a mutex held
//     that long would park every lane's push for the 30-minute bound and then fail it;
//   - never a run nested inside a holder. verify-local.ps1 holds the mutex around its own `npm test`
//     and exports COMPY_TEST_GATE_HELD=<its pid>; a nested run that waited on its own parent would
//     wait out the whole bound. The marker counts only while that pid is alive, so a marker leaked
//     into a long-lived shell by a crashed gate goes stale with it rather than exempting that shell.
//   - not `related`, `list`, `bench` or `init`: they are not the suite.
//
// HOW. Node has no named-mutex API. scripts/lib/gate-mutex-hold.ps1 takes the mutex through the same
// gate-mutex.ps1 the gate uses (bounded 30-minute wait, names the holder, takes over an abandoned
// mutex), prints one line when it owns it, and keeps it until its stdin closes -- which a crashed
// Node parent does too, so a dead run cannot leave the gate held.
//
// FAILURE DIRECTION. A holder that gave up after the bounded wait refuses the run, as the gate does:
// running beside a stuck holder is the collision this exists to stop, and the message names it. A
// holder that could not be STARTED (no PowerShell, a broken lib) only warns: the tests are still the
// tests, and refusing every full run on a tooling fault would cost more than one unqueued run.
//
// Pinned by scripts/run-vitest-gate-guard.test.mjs against real processes, on test mutex names only.
import { spawn } from "node:child_process";
import { join } from "node:path";

export const GATE_HELD_ENV = "COMPY_TEST_GATE_HELD";
export const HOLDER_SCRIPT = join(import.meta.dirname, "gate-mutex-hold.ps1");
export const HELD_LINE = /^GATE-MUTEX-HELD (\d+)\s*$/m;
/** gate-mutex-hold.ps1's exit code when Enter-GateMutex gave up after its bounded wait. */
export const GAVE_UP_EXIT = 3;

const COMMANDS = new Set(["run", "watch", "dev", "related", "bench", "list", "init"]);
const NOT_THE_SUITE = new Set(["related", "bench", "list", "init"]);
const isOption = (token) => token.startsWith("-");

/**
 * The argv shapes a lane actually types, answered without loading vitest: `run`, `run --flag=x`,
 * `run <file> ...`, `<file> ...`, nothing at all. Anything else (an option that takes its value as
 * the next token, `--`, a command after options) returns null and is left to vitest's own parser,
 * because only vitest knows which bare tokens are option values and which are file filters.
 */
export function classifyArgsCheaply(args) {
  const tokens = [...args];
  if (tokens.some((t) => t === "--" || /^--?(no-)?(watch|run|w|changed|shard)(=|$)/.test(t))) return null;
  const command = COMMANDS.has(tokens[0]) ? tokens[0] : null;
  if (command && NOT_THE_SUITE.has(command)) return { suite: "other", command, filters: null };
  const rest = command ? tokens.slice(1) : tokens;
  // A bare first token is a file filter: it follows the command name (or IS the first argument of
  // the default command), so no option can be claiming it as a value.
  if (rest.length > 0 && !isOption(rest[0])) return { suite: "filtered", command, filters: [rest[0]] };
  // Only options, none of which is followed by a bare token: every one is a flag or `--name=value`.
  if (rest.every(isOption)) return { suite: "full", command, filters: [] };
  return null;
}

/**
 * Whether this command line runs the full suite once. `parse` is vitest's own parseCLI (injected;
 * loaded only when the cheap reading cannot answer, since importing vitest/node costs about 2s).
 * `interactive` is stdin.isTTY outside CI: vitest's default command watches there, and a guess must
 * err toward "watch" -- a watch holding the gate would park every push; a run left unqueued costs
 * only what it cost before #543.
 */
export async function classifyRun(args, { interactive = false, parse = null } = {}) {
  let verdict = classifyArgsCheaply(args);
  let watch;
  if (verdict) {
    const { command } = verdict;
    watch = command === "watch" || command === "dev" || (command === null && interactive);
    return { ...verdict, watch, via: "cheap" };
  }
  const parseCLI = parse ?? (await import("vitest/node")).parseCLI;
  const { filter, options } = parseCLI(["vitest", ...args]);
  if (options.related?.length) return { suite: "other", command: "related", filters: null, watch: false, via: "vitest" };
  // --changed and --shard run a subset: not the load that starves a gate.
  const subset = Boolean(options.changed || options.shard);
  watch = options.watch === true ? true : options.run === true || options.watch === false ? false : interactive;
  return { suite: filter?.length || subset ? "filtered" : "full", command: options.run ? "run" : null, filters: filter ?? [], watch, via: "vitest" };
}

/** A marker counts only while the pid it names is alive (EPERM = alive, owned by someone else). */
export function markerHolder(env, { alive = pidAlive } = {}) {
  const raw = String(env?.[GATE_HELD_ENV] ?? "").trim();
  if (!/^\d+$/.test(raw)) return { pid: null, live: false, raw };
  const pid = Number(raw);
  return { pid, live: pid > 0 && alive(pid), raw };
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/** The whole decision: { take, why }. `why` is printed when a full run does NOT queue. */
export async function gateDecision(args, { platform = process.platform, env = process.env, interactive = false, parse = null, alive = pidAlive } = {}) {
  if (platform !== "win32") return { take: false, why: "not Windows: the test-gate mutex is a Windows named mutex" };
  const marker = markerHolder(env, { alive });
  const run = await classifyRun(args, { interactive, parse });
  if (run.suite !== "full") return { take: false, why: `${run.suite} run`, run };
  if (run.watch) return { take: false, why: "watch mode holds its pool open-ended; only a single full run queues", run };
  if (marker.live) return { take: false, why: `nested inside the test-gate holder pid ${marker.pid} (${GATE_HELD_ENV})`, run, marker };
  return { take: true, why: marker.raw ? `stale ${GATE_HELD_ENV}=${marker.raw} ignored: that holder is gone` : "full suite run", run, marker };
}

export function defaultPowershell(env = process.env) {
  return env.SystemRoot ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
}

/**
 * Take the gate through gate-mutex-hold.ps1. Resolves with a lease once the holder owns the mutex;
 * rejects with err.gaveUp=true when it gave up after the bounded wait, or err.gaveUp=false when it
 * could not be started or died some other way. `stderr` is "inherit" (a person reads the TEST GATE
 * lines) or "pipe" (a test reads them from lease.child / err.stderr).
 */
export function holdGate({ name = "", stateDir = "", label = "", timeoutSeconds = 1800, noticeSeconds = 60, powershell = defaultPowershell(), stderr = "inherit" } = {}) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", HOLDER_SCRIPT, "-TimeoutSeconds", String(timeoutSeconds), "-NoticeSeconds", String(noticeSeconds)];
  if (name) args.push("-Name", name);
  if (stateDir) args.push("-StateDir", stateDir);
  if (label) args.push("-Label", label);
  const started = Date.now();
  const child = spawn(powershell, args, { stdio: ["pipe", "pipe", stderr], windowsHide: true });
  let out = "";
  let err = "";
  child.stderr?.on("data", (chunk) => (err += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  // Writing to a holder that has already exited must not crash the parent.
  child.stdin.on("error", () => {});

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message, gaveUp) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.gaveUp = gaveUp;
      error.stderr = err;
      reject(error);
    };
    child.once("error", (e) => fail(`could not start ${powershell}: ${e.message}`, false));
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const m = HELD_LINE.exec(out);
      if (!m || settled) return;
      settled = true;
      resolve({
        pid: Number(m[1]),
        child,
        waitedMs: Date.now() - started,
        stderrText: () => err,
        release: async ({ graceMs = 10_000 } = {}) => {
          if (child.exitCode === null && child.signalCode === null) child.stdin.end();
          const timer = new Promise((r) => setTimeout(() => r("timeout"), graceMs).unref());
          if ((await Promise.race([exited, timer])) === "timeout") {
            // Abandoned rather than stuck: the next waiter's WaitOne takes it over with a WARN.
            child.kill();
            await exited;
          }
          return exited;
        },
      });
    });
    exited.then(({ code, signal }) => {
      if (code === GAVE_UP_EXIT) fail("the test gate stayed busy past the bounded wait", true);
      else fail(`the gate holder exited (${signal ?? `code ${code}`}) before it held the mutex`, false);
    });
  });
}

/**
 * scripts/run-vitest.mjs's whole flow, with the vitest launch injected so the guard can drive it in
 * a real process on a test mutex name without starting a real suite. `launch(args, {cwd, env})`
 * runs vitest to completion and returns its exit status; the gate is held across it and released
 * after, whatever it returns or throws. Returns the exit status for the process.
 */
export async function runQueued(args, { cwd, env = process.env, platform = process.platform, interactive = false, gate = {}, launch, log = (line) => console.error(line) }) {
  const decision = await gateDecision(args, { platform, env, interactive });
  const childEnv = { ...env };
  let lease = null;
  if (decision.take) {
    try {
      lease = await holdGate({ label: `run-vitest.mjs full suite in ${cwd}`, ...gate });
      // The suite's own nested runs (guards that start run-vitest.mjs) must not queue behind it.
      childEnv[GATE_HELD_ENV] = String(lease.pid);
    } catch (err) {
      if (err.gaveUp) {
        log("run-vitest: the full suite did not start -- the test gate stayed busy past its bounded wait (#543).");
        log("run-vitest: run the files you changed (node scripts/run-vitest.mjs run <file>), or run it again once the gate frees.");
        return 1;
      }
      log(`run-vitest: WARN could not queue this full suite on the test gate (${err.message}); running it unqueued (#543).`);
    }
  }
  try {
    return await launch(args, { cwd, env: childEnv });
  } finally {
    if (lease) await lease.release();
  }
}
