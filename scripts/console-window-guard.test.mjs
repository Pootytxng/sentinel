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
const CONSOLE_SPAWN = /["'](?:powershell\.exe|pwsh\.exe|cmd\.exe)["']/;

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

  it("catches a call that omits windowsHide", () => {
    // The guard has to fail on the shape it exists to forbid, or it is decoration.
    const bad = `spawnSync("powershell.exe", ["-File", h], { cwd: root, encoding: "utf8" })`;
    const [call] = spawnCalls(bad);
    expect(CONSOLE_SPAWN.test(call)).toBe(true);
    expect(/windowsHide\s*:\s*true/.test(call)).toBe(false);
  });

  it("accepts a call that sets it, and does not bleed across neighbouring calls", () => {
    const good =
      `spawnSync("powershell.exe", ["-File", a], { encoding: "utf8", windowsHide: true });\n` +
      `spawnSync("node", ["x.mjs"], { encoding: "utf8" });`;
    const calls = spawnCalls(good).filter((c) => CONSOLE_SPAWN.test(c));
    expect(calls).toHaveLength(1);
    expect(/windowsHide\s*:\s*true/.test(calls[0])).toBe(true);
  });
});
