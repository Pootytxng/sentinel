// A test suite must not flash console windows across the owner's screen.
//
// Owner report, 2026-08-11: "the thing that keeps popping up stealing my foreground primarily is the
// windows terminal — i see it pull up briefly it appears blank then closes on its own shortly after."
//
// Measured the same morning with a process-spawn poller: the source was `npm test`. Seven suites
// drive the release tooling by spawning `powershell.exe`, and Node's `spawnSync` defaults to
// `windowsHide: false`. On Windows 11 the default terminal is "let Windows decide", which resolves
// to Windows Terminal, so every one of those spawns opened a real console window — blank, because
// the harness writes to the captured pipe, and self-closing when the script ended. A single test run
// does this dozens of times. When the owner is in an exclusive-fullscreen game, an activating window
// MINIMISES it, which is the same harm `should_suppress_activation` was written for and the same
// harm this repository already treats as a defect.
//
// `windowsHide: true` costs nothing — stdout/stderr are already captured through pipes, so the
// console window was never carrying information in the first place.
//
// This is the guard half of bug->guard: the fix is one option on seven call sites, and one option on
// one call site is exactly the kind of thing that comes back the next time somebody adds an eighth.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

// A call that hands work to a Windows console interpreter. `.cmd`/`.bat` go through cmd.exe and
// carry the same window, so they are covered by the same rule.
//
// The interpreter names are ASSEMBLED rather than written as quoted literals, and deliberately so:
// `windows-only-coverage.test.mjs` detects PowerShell-driving suites by looking for a quoted
// "powershell.exe" next to a spawn call, and would otherwise classify THIS file as one and demand a
// `describe.runIf(windows)` gate. That gate would be wrong — this is a static read of source text,
// it starts no process, and the rule it enforces is just as true on a Linux runner.
const EXE = (name) => `${name}\\.exe`;
const CONSOLE_SPAWN = new RegExp(`["'](?:${["powershell", "pwsh", "cmd"].map(EXE).join("|")})["']`);

const sourceFiles = () =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".mjs") || name.endsWith(".js"))
    .map((name) => ({ name, text: readFileSync(join(SCRIPTS, name), "utf8") }));

/**
 * Split a file into the individual spawn calls it makes, so a file that gets one call right and a
 * second one wrong cannot pass on the strength of the first. Balances parentheses from the call's
 * opening `(` so nested option objects and template literals stay inside their own call.
 */
const spawnCalls = (text) => {
  const calls = [];
  const opener = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(/g;
  let match;
  while ((match = opener.exec(text)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    for (; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(text.slice(match.index, i + 1));
  }
  return calls;
};

describe("no test may flash a console window on the owner's desktop", () => {
  it("every powershell/cmd spawn under scripts/ passes windowsHide", () => {
    const offenders = [];
    for (const { name, text } of sourceFiles()) {
      // This guard quotes the interpreter names it forbids, so it would otherwise report itself.
      if (name === "console-window-guard.test.mjs") continue;
      for (const call of spawnCalls(text)) {
        if (!CONSOLE_SPAWN.test(call)) continue;
        if (!/windowsHide\s*:\s*true/.test(call)) {
          offenders.push(`${name}: ${call.split(/\r?\n/)[0].trim()}`);
        }
      }
    }
    expect(
      offenders,
      `These spawn a Windows console interpreter without windowsHide: true, so each call opens a\n` +
        `blank console window on the owner's screen — and steals focus from a fullscreen game.\n` +
        `Add windowsHide: true to the options object:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  // Samples are built from this rather than written inline, for the same reason the pattern above is
  // assembled: a literal quoted interpreter name in this file would make the Windows-only coverage
  // guard mistake it for a suite that starts PowerShell.
  const PS = `power${"shell"}.exe`;

  it("catches a call that omits windowsHide", () => {
    // The guard has to fail on the shape it exists to forbid, or it is decoration.
    const bad = `spawnSync("${PS}", ["-File", h], { cwd: root, encoding: "utf8" })`;
    const [call] = spawnCalls(bad);
    expect(CONSOLE_SPAWN.test(call)).toBe(true);
    expect(/windowsHide\s*:\s*true/.test(call)).toBe(false);
  });

  it("accepts a call that sets it, and does not bleed across neighbouring calls", () => {
    const good =
      `spawnSync("${PS}", ["-File", a], { encoding: "utf8", windowsHide: true });\n` +
      `spawnSync("node", ["x.mjs"], { encoding: "utf8" });`;
    const calls = spawnCalls(good).filter((c) => CONSOLE_SPAWN.test(c));
    expect(calls).toHaveLength(1);
    expect(/windowsHide\s*:\s*true/.test(calls[0])).toBe(true);
  });
});

// The eighth call site the header predicted — and it arrived through a mechanism the rule above
// cannot read. `windowsHide` belongs to Node's spawn. A PowerShell launch through
// `Start-NativeProcess -Detached` goes out via ShellExecute, where .NET refuses `CreateNoWindow`
// outright, so the caller's request to stay invisible was being dropped rather than honoured. The
// owner kept seeing the flash for nine days after the seven suites were fixed.
//
// Behaviour is proven in `detached-window-guard.test.mjs`, which launches a real child and counts
// the visible top-level windows it owns. These are the static halves: the mapping cannot silently
// disappear again, and a NEW detached launch has to say out loud whether its child may show a
// window instead of inheriting the answer by accident.
const NATIVE_PROCESS = join(SCRIPTS, "lib", "native-process.ps1");

// `.ps1` ONLY, and that is the whole rule rather than an oversight. `Start-NativeProcess` is a
// PowerShell function, so the name appearing in a `.mjs` file is always text ABOUT a launch — a
// sample inside the release static guard, a pattern inside this file — and never a launch. Scanning
// them made the rule report its own source and another guard's corpus, which is how a guard learns
// to be ignored. The one `.mjs` file that really does BUILD such a launch is pinned by name below.
//
// Recursive because the defect lived one directory down, in lib/.
const launchSources = (dir = SCRIPTS, found = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") launchSources(full, found);
    } else if (entry.name.endsWith(".ps1")) {
      found.push(full);
    }
  }
  return found;
};

const isComment = (line) => /^\s*(#|\/\/|\*)/.test(line);

describe("a detached launch must state whether its child may show a window", () => {
  it("Start-NativeProcess carries -CreateNoWindow onto the ShellExecute path", () => {
    const text = readFileSync(NATIVE_PROCESS, "utf8");
    expect(
      text,
      "Start-NativeProcess no longer maps -CreateNoWindow to a WindowStyle under -Detached.\n" +
        "ShellExecute has no CreateNoWindow, so without that mapping the switch is silently dropped\n" +
        "and every detached console child opens a Windows Terminal window on the owner's desktop.",
    ).toMatch(/WindowStyle\s*=\s*if\s*\(\$CreateNoWindow\)/);
    expect(text).toMatch(/ProcessWindowStyle\]::Hidden/);
  });

  it("does not reinstate the silent drop that caused the flash", () => {
    const text = readFileSync(NATIVE_PROCESS, "utf8");
    expect(
      text,
      "`CreateNoWindow = (-not $Detached) -and $CreateNoWindow` is the exact line that discarded the\n" +
        "caller's request on the only path where it mattered. It is a regression, not a simplification.",
    ).not.toMatch(/CreateNoWindow\s*=\s*\(\s*-not\s+\$Detached\s*\)/);
  });

  it("every -Detached call site is either hidden or explicitly allowed to be seen", () => {
    const offenders = [];
    for (const file of launchSources()) {
      // The definition itself names the switch in its contract, its throw message and its comments;
      // the two assertions above are what hold it, not this text scan.
      if (file === NATIVE_PROCESS) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (isComment(line)) return;
        if (!line.includes("Start-NativeProcess") || !line.includes("-Detached")) return;
        if (line.includes("-CreateNoWindow") || line.includes("detached-window-allow")) return;
        offenders.push(`${file.slice(SCRIPTS.length + 1)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      "These launch a child detached without saying whether it may show a window. Add\n" +
        "-CreateNoWindow if the child is a console program (it will otherwise flash a Windows\n" +
        "Terminal window every run), or the marker `detached-window-allow` with the reason if the\n" +
        "child is a GUI app whose window the owner is meant to see:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the harness that builds a detached launch keeps its child invisible", () => {
    // native-process-guard.test.mjs assembles a real `Start-NativeProcess ... -Detached` inside a
    // generated .ps1 to prove that a detached child frees the caller's pipe. Until 2026-08-20 that
    // proof opened a Windows Terminal window on the owner's desktop every single time the suite ran,
    // and it is the last measured source of the flash he reported.
    const harness = readFileSync(join(SCRIPTS, "native-process-guard.test.mjs"), "utf8");
    const detachAssignments = harness
      .split(/\r?\n/)
      .filter((line) => !isComment(line) && /\$detach\s*=/.test(line));
    expect(detachAssignments.length).toBeGreaterThan(0);
    for (const line of detachAssignments) {
      expect(
        line,
        "The pipe-freeing proof builds its launch flags here. Every arm must carry -CreateNoWindow —\n" +
          "including the inherited one, so the pair still differs only by -Detached and neither opens\n" +
          `a console window while the suite runs:\n  ${line.trim()}`,
      ).toMatch(/-CreateNoWindow/);
    }
  });

  it("catches a detached launch that says nothing, and accepts both ways of saying it", () => {
    // The rule has to reject the shape it exists to forbid, or it is decoration.
    const bare = "$app = Start-NativeProcess -Command $exe -Detached -ArgumentList $launchArgs";
    const hidden = `${bare} -CreateNoWindow`;
    const allowed = `${bare}  # detached-window-allow: a GUI app the owner is meant to see.`;
    const says = (line) =>
      line.includes("-CreateNoWindow") || line.includes("detached-window-allow");
    expect(says(bare)).toBe(false);
    expect(says(hidden)).toBe(true);
    expect(says(allowed)).toBe(true);
    expect(isComment("  # a comment mentioning Start-NativeProcess -Detached")).toBe(true);
  });
});
