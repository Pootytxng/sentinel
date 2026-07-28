// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  releaseCriticalPowerShell,
  scanReleasePowerShell,
} from "./release-powershell-static-guard.mjs";

const root = join(import.meta.dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");

describe("permanent release PowerShell static guard", () => {
  it("scans the complete declared production release surface", () => {
    const result = scanReleasePowerShell();
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(releaseCriticalPowerShell);
    expect(result.files).toContain("scripts/lib/release-transaction.ps1");
    expect(result.files).toContain("scripts/lib/release-publish-adapter.ps1");
  });

  it("rejects the exact historical CDP NativeCommandError pattern", () => {
    const file = "scripts/lib/runtime-proof.ps1";
    const mutated =
      read(file) +
      '\n$probeText = (& node $probeScript $debugPort stamp 2>$null | Out-String).Trim()\n';
    const result = scanReleasePowerShell({ overrides: { [file]: mutated } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file, rule: "direct-native" }),
        expect.objectContaining({ file, rule: "native-stderr" }),
      ]),
    );
  });

  it("rejects the exact historical GitHub expected-404 pattern", () => {
    const file = "scripts/lib/release-publish-adapter.ps1";
    const mutated =
      read(file) +
      '\n$existing = & gh api "repos/$releasesRepo/git/refs/tags/$tag" --jq ".object.sha" 2>$null\n';
    const result = scanReleasePowerShell({ overrides: { [file]: mutated } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file, rule: "direct-native" }),
        expect.objectContaining({ file, rule: "native-stderr" }),
      ]),
    );
  });

  it("rejects weakened errors, eval, shell reparsing, and unsafe transaction order", () => {
    const releaseFile = "scripts/release.ps1";
    const transactionFile = "scripts/lib/release-transaction.ps1";
    const unsafeRelease =
      read(releaseFile) +
      '\n$ErrorActionPreference = "Continue"\nInvoke-Expression $command\nStart-Process cmd.exe\n';
    const unsafeTransaction = read(transactionFile).replace(
      '  "draft_assets_verified",\n  "release_published",',
      '  "release_published",\n  "draft_assets_verified",',
    );
    const result = scanReleasePowerShell({
      overrides: {
        [releaseFile]: unsafeRelease,
        [transactionFile]: unsafeTransaction,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.rule)).toEqual(
      expect.arrayContaining([
        "strict-error-policy",
        "no-eval",
        "process-bypass",
        "shell-string",
        "transaction-order",
      ]),
    );
  });

  it("rejects dynamic and previously unlisted native executable invocations", () => {
    const file = "scripts/release.ps1";
    for (const injected of [
      "\n& $native @args\n",
      "\ncurl.exe https://example.invalid\n",
      '\n[System.Diagnostics.Process]::Start("gh", "api repos/x")\n',
      '\n[Diagnostics.Process]::Start("gh", "api repos/x")\n',
      "\n$p = New-Object System.Diagnostics.Process\n$p.Start()\n",
    ]) {
      const result = scanReleasePowerShell({
        overrides: { [file]: read(file) + injected },
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file,
            rule: expect.stringMatching(/direct-native|process-bypass/),
          }),
        ]),
      );
    }
  });

  it("does not accept verification tokens hidden inside statically disabled code", () => {
    const file = "scripts/release.ps1";
    const original = read(file);
    for (const replacement of [
      '    if ($false) { Assert-ReceiptHash "Installer" $context.Installer $context.Receipt.installer.sha256 }',
      '    if ($null) { Assert-ReceiptHash "Installer" $context.Installer $context.Receipt.installer.sha256 }',
      '    if ($SkipReceiptVerification) { Assert-ReceiptHash "Installer" $context.Installer $context.Receipt.installer.sha256 }',
      '    function NeverCalled { Assert-ReceiptHash "Installer" $context.Installer $context.Receipt.installer.sha256 }',
    ]) {
      const bypassed = original.replace(
        '    Assert-ReceiptHash "Installer" $context.Installer $context.Receipt.installer.sha256',
        replacement,
      );
      const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file,
            rule: expect.stringMatching(/required-verification|verification-structure/),
          }),
        ]),
      );
    }
  });

  it("requires the public transition to remain inside the release_published handler", () => {
    const file = "scripts/lib/release-publish-adapter.ps1";
    const original = read(file);
    const bypassed = original
      .replace('"--draft=false"', '"--draft=true"')
      .replace(
        'Invoke-ProductionGhChecked "create private draft release"',
        '"--draft=false" | Out-Null\n        Invoke-ProductionGhChecked "create private draft release"',
      );
    const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ file, rule: "publication-order" })]),
    );
  });

  it("requires the final public-version gate to precede publication", () => {
    const file = "scripts/lib/release-publish-adapter.ps1";
    const original = read(file);
    const gate = "Invoke-ReleaseScriptBlock -ScriptBlock $publicVersionGate -ArgumentList @($context)";
    const bypassed = original
      .replace('"--draft=false"', '"--draft=true"')
      .replace(
        gate,
        `Invoke-ProductionGhChecked "premature public transition" $context @("--draft=false")\n        ${gate}`,
      );
    const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ file, rule: "publication-order" })]),
    );
  });

  it("rejects a draft-sensitive lookup that regresses to the releases-by-tag endpoint", () => {
    const file = "scripts/lib/release-publish-adapter.ps1";
    const bypassed = read(file).replace(
      "$releases = Get-ProductionReleaseList -Context $Context",
      () =>
        '$releases = @((Get-ProductionGhApi -Context $Context -Endpoint "repos/$($Context.ReleasesRepo)/releases/tags/$tag" -AllowNotFound).Value)',
    );
    const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ file, rule: "draft-lookup" })]),
    );
  });

  it("rejects a stage handler that resolves a release outside the draft-aware lookup", () => {
    const file = "scripts/lib/release-publish-adapter.ps1";
    const bypassed = read(file).replace(
      /(function Inspect-ProductionPublished \{[\s\S]*?\r?\n\s*)\$lookup = Get-ProductionRelease \$Context/,
      (_match, head) =>
        `${head}$lookup = Get-ProductionGhApi -Context $Context -Endpoint "repos/$($Context.ReleasesRepo)/releases/990099"`,
    );
    expect(bypassed).not.toBe(read(file));
    const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file,
          rule: "draft-lookup",
          message: expect.stringContaining("Inspect-ProductionPublished"),
        }),
      ]),
    );
  });

  it("rejects a releases listing that can report a transport failure as absence", () => {
    const file = "scripts/lib/release-publish-adapter.ps1";
    const bypassed = read(file).replace(
      /if \(\$result\.TimedOut\) \{(\s*\r?\n\s*throw "GitHub release listing timed out)/,
      (_match, tail) => `if ($false) {${tail}`,
    );
    expect(bypassed).not.toBe(read(file));
    const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file,
          rule: "draft-lookup",
          message: expect.stringContaining("never as absence"),
        }),
      ]),
    );
  });

  it("rejects the exact historical PowerShell 5.1 nested JSON-array parse", () => {
    const file = "scripts/release.ps1";
    const original = read(file);
    const bypassed = original.replace(
      /  try \{\r?\n    \$parsedReleaseList = \$releaseListText \| ConvertFrom-Json\r?\n[\s\S]*?\r?\n  \$releaseList = @\(\$parsedReleaseList\)/,
      "  $releaseList = @($releaseListText | ConvertFrom-Json)",
    );
    expect(bypassed).not.toBe(original);
    const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file,
          rule: "json-array-parse",
          message: expect.stringContaining("nests a JSON array on PowerShell 5.1"),
        }),
      ]),
    );
  });

  it("rejects any array-wrapped ConvertFrom-Json across the guarded surface", () => {
    for (const [file, injected] of [
      ["scripts/lib/release-publish-adapter.ps1", '\n$list = @($raw | ConvertFrom-Json)\n'],
      ["scripts/lib/release-transaction.ps1", '\n$journal = @(\n  Read-Utf8 $path |\n  ConvertFrom-Json\n)\n'],
      ["scripts/verify-release.ps1", '\n$entries = @((Get-Content -LiteralPath $p -Raw) | ConvertFrom-Json)\n'],
    ]) {
      const result = scanReleasePowerShell({ overrides: { [file]: read(file) + injected } });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ file, rule: "json-array-parse" })]),
      );
    }
  });

  it("accepts the safe per-item and assign-then-wrap JSON parses", () => {
    const file = "scripts/lib/release-transaction.ps1";
    const injected =
      '\n$lines = @(Get-Content -LiteralPath $callsPath | ForEach-Object { $_ | ConvertFrom-Json })\n' +
      "\n$parsedSafely = $raw | ConvertFrom-Json\n$wrapped = @($parsedSafely)\n";
    const result = scanReleasePowerShell({ overrides: { [file]: read(file) + injected } });
    expect(result.errors.filter((error) => error.rule === "json-array-parse")).toEqual([]);
  });

  it("requires the releases-list parse to keep its shape and malformed-JSON checks", () => {
    const file = "scripts/release.ps1";
    const original = read(file);
    for (const token of ["$releaseList = @($parsedReleaseList)", "Unexpected release entry shape."]) {
      const bypassed = original.replace(token, "");
      expect(bypassed).not.toBe(original);
      const result = scanReleasePowerShell({ overrides: { [file]: bypassed } });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ file, rule: "required-verification" })]),
      );
    }
  });

  it("requires every transitively referenced PowerShell helper to be in the guarded surface", () => {
    const file = "scripts/release.ps1";
    const result = scanReleasePowerShell({
      overrides: {
        [file]: `${read(file)}\n. (Join-Path $PSScriptRoot "repo-hygiene.ps1")\n`,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ file, rule: "surface-discovery" })]),
    );
  });
});
