// Guard 14, the PowerShell half: the terminal gets the glance, the LOG gets the proof.
//
// narration.test.mjs holds that line for launch.mjs, which writes the check table. Everything after
// the check table — the editor, the two waits, the fallback, the verdict — lives in compy-entry.ps1,
// and it was console-only. A successful launch closes its window (guard 13) and a refusal cites the
// log as "the account of this run", so both halves of the promise were being broken by the same gap:
// scoring journey 5 of the acceptance run, the log stopped at "launch token written" while the
// journey ran on for another 18s and succeeded. Nothing on disk said so.
//
// The other half of the property is that a run which never reaches a verdict still writes NOTHING —
// the picker being cancelled must not litter the log folder. So the account buffers until launch.mjs
// creates the file, and the test below proves both halves by RUNNING the real source text.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const PS1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "compy-entry.ps1");
const src = readFileSync(PS1, "utf8");

const root = mkdtempSync(join(tmpdir(), "compy-entry-account-"));
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0;

describe("the account of a run", () => {
  it("routes every console helper through it — a line Kuya sees is a line the log keeps", () => {
    for (const fn of ["Note", "Bad", "Good", "Warn", "Head"]) {
      const decl = src.match(new RegExp(`^function ${fn}\\(\\$t\\).*$`, "m"))?.[0];
      expect(decl, `${fn} is declared`).toBeTruthy();
      expect(decl, `${fn} tees to the log`).toContain("Write-Journey");
    }
  });

  it("records the outcome of each handoff attempt, which node reports only to a window that closes", () => {
    for (const arc of ["restored panel:", "open-URI:", "CLI in the folder:"]) {
      expect(src, `${arc} reaches the log`).toContain(`Write-Journey ('${arc}`);
    }
  });

  it("still cites the log on the refusal the log exists for", () => {
    expect(src).toContain('Note "account of this run: $LogFile"');
  });

  it("cannot fail a launch by failing to write — the append is guarded", () => {
    const body = src.slice(src.indexOf("function Write-Journey"), src.indexOf("function Note("));
    expect(body).toContain("try {");
    expect(body).toContain("catch { }");
  });

  // The real source text, executed. A greppable `Write-Journey` proves the call, not the behaviour;
  // the buffering is the part with a bug in it if anyone edits this later.
  it.skipIf(!hasPwsh)("writes nothing before launch.mjs, then flushes the whole run in order", () => {
    const start = src.indexOf("$script:Journey = ");
    const end = src.indexOf("# Only trouble holds the window");
    expect(start, "the account block is findable").toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    const log = join(root, "launch.log");
    const harness = join(root, "harness.ps1");
    writeFileSync(
      harness,
      [
        `$LogFile = '${log.replace(/\\/g, "\\\\")}'`,
        src.slice(start, end),
        "Note 'before the check table'",
        "if (Test-Path -LiteralPath $LogFile) { throw 'wrote before there was a verdict to write about' }",
        "Set-Content -LiteralPath $LogFile -Value 'the check table' -Encoding utf8", // launch.mjs's doing
        "Warn 'after the check table'",
        "Good 'and the verdict'",
      ].join("\n"),
      "utf8",
    );

    const r = spawnSync("pwsh", ["-NoProfile", "-File", harness], { encoding: "utf8" });
    expect(r.stderr, "the harness ran clean").not.toMatch(/wrote before|Exception/);
    expect(r.status).toBe(0);
    expect(existsSync(log)).toBe(true);

    const lines = readFileSync(log, "utf8").trim().split(/\r?\n/);
    expect(lines[0]).toBe("the check table");
    // The line said BEFORE the file existed is not lost — it is held and flushed in order.
    expect(lines.map((l) => l.replace(/^\d{4}-\d\d-\d\dT\S+ {3}/, ""))).toEqual([
      "the check table",
      "before the check table",
      "after the check table",
      "and the verdict",
    ]);
    expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z {3}before the check table$/);
  });
});
