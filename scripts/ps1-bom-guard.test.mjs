// Guard (#630): a PowerShell script that carries any non-ASCII byte must start with a UTF-8 BOM.
//
// Windows PowerShell 5.1 decodes a BOM-less script as the ANSI code page (CP1252 here), so an em
// dash in a string literal prints as three characters of noise, and in the wrong place it is a parse
// error instead (tools/entry/shortcut.mjs records a debugging session lost to that). pwsh 7 reads the
// same file as UTF-8, which is why the defect hides on whichever machine wrote it.
//
// It gets in two ways, and both have happened: written that way (compy-entry.ps1 carried four
// non-ASCII characters and no BOM), or stripped by tooling. During #615 a read-modify-write through
// [IO.File]::ReadAllText + [IO.File]::WriteAllText, with no encoding argument, silently dropped the
// BOM from scripts/lib/foreground-probe.ps1 and it was caught by hand. encoding-guard.test.mjs sees
// double-encoded text, not a missing BOM, so neither was caught by a test.
//
// Pure ASCII reads the same in every code page, so it needs no BOM and is not asked for one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const EM_DASH = String.fromCharCode(0x2014); // built from its code point, so this file stays ASCII

// The 1-based line of the first byte above 0x7F that no BOM covers, or 0 when the bytes are safe.
function unguardedLine(bytes) {
  if (bytes.subarray(0, 3).equals(BOM)) return 0;
  const at = bytes.findIndex((b) => b > 0x7f);
  return at < 0 ? 0 : bytes.subarray(0, at).toString("latin1").split("\n").length;
}

// From git, not a hand list, so a new script is covered the day it is tracked. icase because the
// extension is not case-sensitive to PowerShell.
const scripts = execFileSync("git", ["ls-files", "-z", "--", ":(icase)*.ps1", ":(icase)*.psm1"], {
  cwd: repoRoot,
  encoding: "utf8",
}).split("\0").filter(Boolean);

describe("the BOM rule itself", () => {
  it.each([
    ["pure ASCII, no BOM", Buffer.from("Write-Host 'ready -- go'\n"), 0],
    ["non-ASCII behind a BOM", Buffer.concat([BOM, Buffer.from(`Note 'a ${EM_DASH} b'\n`)]), 0],
    ["non-ASCII with no BOM", Buffer.from(`# fine\nNote 'a ${EM_DASH} b'\n`), 2],
    ["a UTF-16 BOM is not a UTF-8 one", Buffer.from([0xff, 0xfe, 0x23, 0x00]), 1],
  ])("%s", (_name, bytes, line) => {
    expect(unguardedLine(bytes)).toBe(line);
  });

  // The #615 incident, replayed on the real file: the same bytes with the BOM gone must be refused.
  it("refuses foreground-probe.ps1 once a BOM-dropping write has been through it", () => {
    const bytes = readFileSync(join(repoRoot, "scripts/lib/foreground-probe.ps1"));
    expect(unguardedLine(bytes), "as tracked, it carries its BOM").toBe(0);
    const stripped = bytes.subarray(3);
    expect(stripped.some((b) => b > 0x7f), "and still has non-ASCII, so stripping it is a real test").toBe(true);
    expect(unguardedLine(stripped)).toBeGreaterThan(0);
  });
});

describe("tracked PowerShell scripts", () => {
  it("are found", () => {
    expect(scripts.length).toBeGreaterThan(30);
    expect(scripts).toContain("compy-entry.ps1");
    expect(scripts).toContain("scripts/lib/foreground-probe.ps1");
  });

  it("carry a UTF-8 BOM whenever they carry a byte above 0x7F", () => {
    const offenders = scripts
      .map((file) => ({ file, line: unguardedLine(readFileSync(join(repoRoot, file))) }))
      .filter(({ line }) => line > 0)
      .map(({ file, line }) => `${file}:${line}`);
    expect(
      offenders,
      "replace the non-ASCII characters with ASCII, or save the file as UTF-8 WITH a BOM " +
        "(a WriteAllText with no encoding argument drops it)",
    ).toEqual([]);
  });
});
