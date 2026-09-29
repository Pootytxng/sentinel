import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";

// ALIAS-HARNESS ORPHAN GUARD (2026-09-07).
//
// WHY THIS EXISTS — a real defect, not a hypothetical:
//
//   `scripts/alias-propagation-harness.ps1` starts a real node HTTP server as a child process and
//   cleaned it up in exactly one place: a `finally` block at the bottom of the `try` that wraps the
//   three server-backed cases. `finally` is a LANGUAGE construct. It runs when the block exits —
//   normally, or by a PowerShell exception. It does NOT run when the interpreter itself is killed
//   from outside, and that is precisely how these harnesses die: the worktree that spawned the run
//   goes silent, the session is terminated, and the PowerShell parent is hard-killed mid-case.
//
//   Measured on the owner's machine 2026-08-27: two `node.exe` processes running this harness's
//   `alias-server.mjs` had been alive for 110.5 HOURS. Their parent PIDs no longer resolved to any
//   live process. Their sandbox directories had been deleted. They were still bound to ports 57221
//   and 57259, and would have held them until reboot. Nothing in the repo would ever have reaped
//   them, because the only cleanup path had already been skipped four and a half days earlier.
//
//   The bug is not "the finally block is wrong". The bug is that the child's lifetime was owned
//   ENTIRELY by the parent's goodwill. A process that cannot be killed by its parent's death is a
//   leak by construction, and a leak that holds a listening socket is a leak with a blast radius.
//
// So the rule is mechanical, and it has two halves, because one half cannot cover the other:
//
//   FORWARD  — the child owns its own lifetime. `alias-server.mjs` is handed its parent's PID and
//              polls it; when the parent is gone the server exits itself. This is the half that
//              survives a hard kill, because the guarantee lives in the process that outlives it.
//   BACKWARD — orphans that already exist are reaped. A machine that has already leaked (every
//              machine that ran the pre-fix harness) does not heal itself, so the harness sweeps
//              stale `alias-server.mjs` processes with dead parents before it starts a new one.
//
// Rules A and B pin the two halves in the source. Rule C proves the forward half actually WORKS by
// killing a real parent and watching a real child die — a static assertion alone would pass against
// a watchdog that never fires.

const HARNESS = join(process.cwd(), "scripts", "alias-propagation-harness.ps1");
const source = readFileSync(HARNESS, "utf8");

/**
 * The node server source is embedded in the harness as a single-quoted here-string. Extracting it
 * rather than duplicating it is the point: rule C then proves the EXACT text the harness writes to
 * disk, so the guard cannot drift away from the thing it guards.
 */
function embeddedServerSource() {
  const match = source.match(/Write-HarnessUtf8 \$serverPath @'\r?\n([\s\S]*?)\r?\n'@/);
  if (!match) throw new Error("the harness no longer embeds alias-server.mjs as a here-string");
  return match[1];
}

describe("alias-propagation harness must not leak its HTTP server", () => {
  it("A. the embedded server watches its parent and exits when the parent dies", () => {
    const server = embeddedServerSource();
    // The parent PID has to reach the child at all...
    expect(server).toMatch(/process\.argv\.slice\(2\)/);
    expect(server).toMatch(/parentPid/);
    // ...and the child has to act on it. `process.kill(pid, 0)` is the liveness probe: it throws
    // ESRCH when the pid is gone and signals nothing when it is alive.
    expect(server).toMatch(/process\.kill\(\s*(Number\()?parentPid/);
    expect(server).toMatch(/process\.exit\(/);
  });

  it("B. the harness reaps pre-existing orphans before it starts a new server", () => {
    expect(source).toMatch(/function Stop-OrphanedAliasServer/);
    // The reaper is useless if it runs after the fact — it must precede the Start-Process that
    // creates a new child, or a run inherits the previous run's leak.
    // Matched as a bare statement line so the FUNCTION HEADER cannot stand in for the CALL, and
    // line-ending agnostic because this file is edited from both Windows and git-bash.
    const reaperCall = source.search(/^[ \t]*Stop-OrphanedAliasServer[ \t]*\r?$/m);
    const startProcess = source.indexOf("Start-Process -FilePath $node");
    expect(reaperCall).toBeGreaterThan(-1);
    expect(startProcess).toBeGreaterThan(-1);
    expect(reaperCall).toBeLessThan(startProcess);
    // And it must select on a DEAD parent, not kill every alias-server on the machine — a
    // concurrent lane's live harness is not this run's garbage.
    expect(source).toMatch(/ParentProcessId/);
  });

  it.runIf(windows)(
    `C. a real child really does exit when its parent is hard-killed ${WINDOWS_ONLY}`,
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "alias-orphan-guard-"));
      try {
        const serverPath = join(dir, "alias-server.mjs");
        writeFileSync(serverPath, embeddedServerSource(), "utf8");

        // A throwaway stand-in for the harness's PowerShell process: something with a real PID that
        // can be hard-killed the way a dying worktree kills the real one.
        // windowsHide on every spawn: console-window-guard.test.mjs enforces that no test may flash
        // a console window onto the owner's desktop, and this suite spawns three of them.
        const parent = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 120"], {
          stdio: "ignore",
          windowsHide: true,
        });
        const child = spawn(
          process.execPath,
          [serverPath, join(dir, "requests.jsonl"), join(dir, "port.txt"), String(parent.pid)],
          { stdio: "ignore", windowsHide: true },
        );

        let exited = false;
        child.on("exit", () => {
          exited = true;
        });

        // The server must be up and STAY up first, or "it exited" proves nothing about the kill.
        await waitFor(() => false, 1000);
        expect(exited, "the server died before the parent was killed").toBe(false);

        // Hard kill — no signal the child could catch, exactly like a terminated session. On Windows
        // kill() is TerminateProcess on the handle node holds, so it cannot reach a recycled pid;
        // `taskkill /T` would also walk recorded parent pids onto strangers (#559, #615).
        parent.kill("SIGKILL");

        const died = await waitFor(() => exited, 15000);
        if (!died) child.kill("SIGKILL");
        expect(died, "the server outlived its hard-killed parent — this is the 110-hour leak").toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

  // #615: the reaper killed a LISTED pid. An orphan's watchdog ends it within a second of its
  // parent's death and Windows re-issues a freed pid within seconds, so by kill time the pid could
  // name a stranger. The kill now goes through a handle proven to hold the listed command line.
  it("D. the reaper kills a listed orphan only through a handle proven to hold it", () => {
    const code = source
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(code.match(/Stop-Process|taskkill|GetProcessById|\.Kill\(\)/g) ?? []).toEqual([
      // Both on processes the harness started itself, whose Process objects hold a handle.
      ".Kill()",
      ".Kill()",
    ]);
    expect(code).toMatch(
      /Resolve-HeldProcessFate -ProcessId \(\[int\]\$Server\.ProcessId\) -Marker @\(\$Server\.CommandLine\) -WaitMs 0/,
    );
    expect(code).toMatch(/foreach \(\$server in \$servers\) \{ \[void\]\(Stop-ListedAliasOrphan \$server \$live\) \}/);
  });

  it.runIf(windows)(`E. a listed pid now held by a stranger is read as reused and left running ${WINDOWS_ONLY}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "alias-orphan-reap-"));
    try {
      const output = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-File", HARNESS, "-Sandbox", dir, "-Case", "orphan-reap"],
        // A hang backstop, not a budget: vitest cannot interrupt a synchronous spawn.
        { encoding: "utf8", shell: false, timeout: 90000, windowsHide: true },
      );
      expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
      const result = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1));
      expect(result.reused_state, "a stranger holding the listed pid was read as the orphan").toBe("reused");
      expect(result.parent_live_state).toBe("parent-live");
      expect(result.unmarked_state, "an empty marker matches every command line").toBe("unmarked");
      expect(result.stranger_alive, "the reaper killed a process it does not own").toBe(true);
      // The marked control: a verdict that never says "alive" cannot pass.
      expect(result.orphan_state).toBe("alive");
      expect(result.orphan_dead).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}
