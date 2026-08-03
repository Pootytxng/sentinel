// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The production-adapter sandbox proves the public-assets STAGE end to end. This suite proves the
// primitives underneath it -- absence classification, cache-busting, stale-file removal and the
// lag/refusal rules -- against a real local HTTP server, so the propagation-race repair cannot be
// hollowed out from below while the stage-level test still passes.
const root = join(import.meta.dirname, "..");
const sandboxes = [];

afterEach(() => {
  while (sandboxes.length) rmSync(sandboxes.pop(), { recursive: true, force: true });
});

const run = (kase) => {
  const sandbox = mkdtempSync(join(tmpdir(), "compy-alias-propagation-"));
  sandboxes.push(sandbox);
  const output = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(root, "scripts", "alias-propagation-harness.ps1"),
      "-Sandbox",
      sandbox,
      "-Case",
      kase,
    ],
    { cwd: root, encoding: "utf8", shell: false, timeout: 120_000 },
  );
  expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
  return JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1));
};

describe.runIf(windows)(`latest-download alias propagation primitives ${WINDOWS_ONLY}`, () => {
  it("treats only a real 404 as propagation absence", () => {
    const result = run("http-classification");
    // Every probe really failed, so the classifier is being asked about real error records.
    expect(result.not_found_raised).toBe(true);
    expect(result.server_fault_raised).toBe(true);
    expect(result.unreachable_raised).toBe(true);

    // A 404 is the shape GitHub returns while the alias still points at the previous release.
    expect(result.not_found_is_absence).toBe(true);
    // A 500, a transport failure with no HTTP response at all, and "no error" are never absorbed:
    // absorbing them would let a broken network masquerade as a release that has not propagated.
    expect(result.server_fault_is_absence).toBe(false);
    expect(result.unreachable_is_absence).toBe(false);
    expect(result.null_is_absence).toBe(false);

    // The injected-transport half of the same contract, used by the sandbox and harnesses.
    expect(result.marker_is_absence).toBe(true);
    expect(result.other_message_is_absence).toBe(false);

    // The alias probe reports absence rather than throwing, and it issues exactly one request: a
    // caller that classifies absence itself must not burn the inner retry budget on an expected 404.
    expect(result.alias_probe_returned_absent).toBe(true);
    expect(result.alias_probe_requests).toBe(1);
    expect(result.alias_probe_url).toBe("/absent/latest.json?compy-cache-bust=token-alpha");
    expect(result.alias_probe_cache_control).toBe("no-cache, no-store, max-age=0");
    expect(result.alias_probe_pragma).toBe("no-cache");
  }, 120_000);

  it("never lets a retry verify a file an earlier attempt left behind", () => {
    const result = run("stale-file-removed");
    expect(result.stale_file_present_before).toBe(true);
    // The absent attempt removes the stale body before it fails, so nothing survives to be hashed.
    expect(result.alias_probe_returned_absent).toBe(true);
    expect(result.stale_file_present_after).toBe(false);
    // And on the success path the freshly served body replaces the stale one.
    expect(result.fetched_body).toBe("sandbox-alias-body");
  }, 120_000);

  it("puts a unique cache-busting token and no-cache headers on every alias read", () => {
    const result = run("unique-cache-busting");
    expect(result.both_fetched).toBe(true);
    expect(result.urls).toEqual([
      "/ok/latest.json?compy-cache-bust=token-one",
      "/ok/latest.json?compy-cache-bust=token-two",
    ]);
    expect(new Set(result.urls).size).toBe(2);
    expect(result.cache_control_values).toEqual([
      "no-cache, no-store, max-age=0",
      "no-cache, no-store, max-age=0",
    ]);
  }, 120_000);

  it("appends the cache-busting token without corrupting an existing query", () => {
    const result = run("cache-busting-query");
    expect(result.no_token).toBe("https://example.invalid/latest.json");
    expect(result.plain).toBe("https://example.invalid/latest.json?compy-cache-bust=abc");
    expect(result.existing_query).toBe("https://example.invalid/latest.json?a=1&compy-cache-bust=abc");
  }, 120_000);

  it("orders release versions numerically and refuses non-semantic input", () => {
    const result = run("version-compare");
    expect(result.older).toBe(-1);
    expect(result.equal).toBe(0);
    // 9.9.10 is NEWER than 9.9.9: a string comparison would get this backwards and read a newer
    // release on the alias as harmless propagation lag.
    expect(result.newer_patch).toBe(1);
    expect(result.newer_minor).toBe(1);
    expect(result.newer_major).toBe(1);
    expect(result.nonsemantic).toMatch(/Refusing to compare non-semantic release versions/);
    expect(result.tagged).toMatch(/Refusing to compare non-semantic release versions/);
  }, 120_000);

  it("accepts only a strictly older, correctly bound manifest as propagation lag", () => {
    const result = run("lag-refusals");
    expect(result.unparseable).toMatch(/unparseable manifest/);
    expect(result.no_version).toMatch(/no version/);
    // Newer or equal is an unrelated or newer release, never lag.
    expect(result.newer).toMatch(/not older than the published 9\.9\.9/);
    expect(result.equal).toMatch(/not older than the published 9\.9\.9/);
    // A manifest that does not bind this repository and that older version is not our previous
    // release, so it cannot be evidence that our release simply has not propagated yet.
    expect(result.foreign_repo).toMatch(/does not bind sandbox\/compy-releases v9\.9\.8/);
    expect(result.wrong_alias_version_path).toMatch(/does not bind sandbox\/compy-releases v9\.9\.8/);
    // The one accepted shape: strictly older, self-consistent, and bound to this repository.
    expect(result.older).toBe("OK:9.9.8");
  }, 120_000);
});
