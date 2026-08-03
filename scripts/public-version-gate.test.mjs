// @vitest-environment node
import { describe, expect, it } from "vitest";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const releaseScript = join(root, "scripts", "release.ps1");

// Every scenario emits one JSON line, success or failure, so a fail-closed message is asserted
// exactly rather than against console-wrapped PowerShell error text.
const invoke = (scenario, sourcePath) => {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    join(root, "scripts", "public-version-gate-harness.ps1"),
    "-Scenario",
    scenario,
  ];
  if (sourcePath) args.push("-SourcePath", sourcePath);
  const output = spawnSync("powershell.exe", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 180_000,
  });
  const combined = `${output.stderr}\n${output.stdout}`;
  const line = String(output.stdout).trim().split(/\r?\n/).at(-1);
  let payload = null;
  try {
    payload = JSON.parse(line);
  } catch {
    payload = null;
  }
  expect(payload, combined).not.toBeNull();
  // The gate is only meaningful if it actually asked GitHub for the prerelease/draft flags.
  expect(payload.listed, combined).toBe(true);
  return { payload, status: output.status, combined };
};

const write = (text, label) => {
  const path = join(mkdtempSync(join(tmpdir(), "compy-public-version-gate-")), `release-${label}.ps1`);
  writeFileSync(path, text, "utf8");
  return path;
};

describe.runIf(windows)(`public version gate on Windows PowerShell 5.1 ${WINDOWS_ONLY}`, () => {
  it("accepts the compatible private draft it once rejected as a prerelease", () => {
    // The regression: draft v0.9.11 is prerelease:false, but @(<pipeline> | ConvertFrom-Json) nested
    // the whole array, $sameTag[0].isPrerelease member-enumerated to @(False, False, ...), and a
    // multi-element array is TRUE - so a resumable publish was blocked by its own gate.
    const { payload, status, combined } = invoke("compatible-draft");
    expect(status, combined).toBe(0);
    expect(payload.error).toBe("");
    expect(payload.ok).toBe(true);
  }, 180_000);

  it("reproduces the false prerelease verdict once the hardened parse is reverted", () => {
    // A guard that passes both before and after a fix proves nothing, so this rebuilds the exact
    // historical statement in a COPY of release.ps1 and requires the harness to fail on it.
    const original = readFileSync(releaseScript, "utf8");
    const start = original.indexOf('  if (-not $releaseListText.TrimStart().StartsWith("["))');
    const end = original.indexOf("  $sameTag = @($releaseList | Where-Object");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const historical =
      original.slice(0, start) +
      "  $releaseList = @($releaseListText | ConvertFrom-Json)\n" +
      original.slice(end);
    const { payload, combined } = invoke("compatible-draft", write(historical, "historical"));
    expect(payload.ok, combined).toBe(false);
    expect(payload.error).toContain("exists as a prerelease");
  }, 180_000);

  it("still fails closed when only the assign-then-wrap parse is reverted", () => {
    const original = readFileSync(releaseScript, "utf8");
    const nested = original.replace(
      /  try \{\r?\n    \$parsedReleaseList = \$releaseListText \| ConvertFrom-Json\r?\n[\s\S]*?\r?\n  \$releaseList = @\(\$parsedReleaseList\)/,
      "  $releaseList = @($releaseListText | ConvertFrom-Json)",
    );
    expect(nested).not.toBe(original);
    // The surviving entry-shape check sees one Object[] element with no tagName property, so the
    // second layer refuses instead of reading member-enumerated flags.
    const { payload, combined } = invoke("compatible-draft", write(nested, "nested"));
    expect(payload.ok, combined).toBe(false);
    expect(payload.error).toContain("Unexpected release entry shape.");
  }, 180_000);

  it("still refuses a genuine prerelease, a duplicate, and an unexpected existing release", () => {
    expect(invoke("genuine-prerelease").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("exists as a prerelease"),
    });
    expect(invoke("duplicate-release").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("Multiple releases exist for v0.9.11"),
    });
    expect(invoke("existing-without-candidate-state").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("already exists"),
    });
  }, 180_000);

  it("treats every unreadable listing as fatal, never as an absent tag", () => {
    for (const [scenario, fragment] of [
      ["unreadable-list", "gh: authentication required"],
      ["timeout-list", "Authentication/network failure is not treated as an absent tag"],
      ["empty-response", "Empty response."],
      ["malformed-json", "Malformed JSON response."],
      ["wrong-shape", "A JSON array was required."],
      ["nested-entry-shape", "Unexpected release entry shape."],
    ]) {
      const { payload, combined } = invoke(scenario);
      expect(payload.ok, combined).toBe(false);
      expect(payload.error, combined).toContain("Could not query the releases repository.");
      expect(payload.error, combined).toContain(fragment);
    }
  }, 180_000);

  it("runs the downgrade and manifest-agreement checks that the nested parse had disabled", () => {
    // $latestPublished was always $null under the nested parse, so this entire half of the gate had
    // never executed in production. These cases are what prove it is live.
    expect(invoke("downgrade-blocked").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("Refusing updater downgrade/non-increase: staged=0.9.6 public=0.9.7"),
    });
    expect(invoke("equal-version-blocked").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("Refusing updater downgrade/non-increase: staged=0.9.4 public=0.9.4"),
    });
    expect(invoke("manifest-disagreement").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("disagrees with latest tag"),
    });
    expect(invoke("non-semantic-latest-tag").payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("not semantic versioned"),
    });
  }, 180_000);

  it("permits an absent candidate tag and an empty releases repository", () => {
    expect(invoke("absent-tag").payload).toMatchObject({ ok: true, error: "" });
    expect(invoke("empty-release-list").payload).toMatchObject({ ok: true, error: "" });
  }, 180_000);
});
