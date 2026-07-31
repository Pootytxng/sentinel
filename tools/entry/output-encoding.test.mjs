// Guard 14 again, from the other side: the one line Kuya reads has to be readable.
//
// Everything the launcher says on success is node's words, captured through a native-command pipe.
// PowerShell decodes that pipe with [Console]::OutputEncoding, and on this machine that is the OEM
// code page -- so the first launch log that carried the success line carried it as
// "150k ΓÇö standard". The corruption happens at decode time, in the string, which means it is on
// screen too, and the same pipe carries task names in the picker and the sentence of a refusal.
//
// The fix is one process-local line. This proves it does something: the harness deliberately puts a
// non-UTF-8 code page on the console first, so the assertion below fails if the line is ever removed.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const PS1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "compy-entry.ps1");
const src = readFileSync(PS1, "utf8");

const root = mkdtempSync(join(tmpdir(), "compy-entry-encoding-"));
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0;
const ENCODING_LINE = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)";

describe("what the console decodes", () => {
  it("is set to UTF-8 before the first word is read back from node", () => {
    const set = src.indexOf(ENCODING_LINE);
    const firstNode = src.search(/^\s*(\$\w+ = )?node /m);
    expect(set, "the launcher sets its own output encoding").toBeGreaterThan(0);
    expect(firstNode, "the launcher runs node").toBeGreaterThan(0);
    expect(set, "it is set before the first capture, not after").toBeLessThan(firstNode);
  });

  it.skipIf(!hasPwsh)("survives a console that would otherwise mangle it", () => {
    const harness = join(root, "encoding.ps1");
    const out = join(root, "codes.txt");
    writeFileSync(
      harness,
      [
        "$ErrorActionPreference = 'Stop'",
        // Whatever this machine's default is, start from one that cannot represent an em dash.
        "try { [Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(850) }",
        "catch { [Console]::OutputEncoding = [System.Text.Encoding]::ASCII }",
        "function Codes($s) { (($s.ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ' ') }",
        "$label = 'node -e \"process.stdout.write(String.fromCharCode(0x2014))\"'",
        "$before = Invoke-Expression $label",
        ENCODING_LINE, // the real line, verbatim from the source above
        "$after = Invoke-Expression $label",
        `Set-Content -LiteralPath '${out.replace(/\\/g, "\\\\")}' -Encoding utf8 -Value @(`,
        "  ('before=' + (Codes $before)), ('after=' + (Codes $after)))",
      ].join("\n"),
      "utf8",
    );

    const r = spawnSync("pwsh", ["-NoProfile", "-File", harness], { encoding: "utf8" });
    expect(r.stderr, "the harness ran clean").not.toMatch(/Exception|not recognized/);
    expect(r.status).toBe(0);

    const [before, after] = readFileSync(out, "utf8").trim().split(/\r?\n/);
    // The mangling this guard exists for: one em dash arriving as several characters of noise.
    expect(before, "the harness really did start from a hostile console").not.toContain("2014");
    expect(after, "and the launcher's line repairs it").toBe("after=2014");
  });
});
