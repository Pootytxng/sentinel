// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");

// Every scenario emits one JSON line, success or failure, so a fail-closed message is asserted
// exactly rather than against console-wrapped PowerShell error text.
const invoke = (scenario) => {
  const output = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(root, "scripts", "production-adapter-lookup-harness.ps1"),
      "-Scenario",
      scenario,
    ],
    { cwd: root, encoding: "utf8", shell: false, timeout: 180_000 },
  );
  const combined = `${output.stderr}\n${output.stdout}`;
  const line = String(output.stdout).trim().split(/\r?\n/).at(-1);
  let payload = null;
  try {
    payload = JSON.parse(line);
  } catch {
    payload = null;
  }
  expect(payload, combined).not.toBeNull();
  // The defect this whole repair exists to kill: releases/tags/{tag} is 404 for a draft, so it may
  // never be the lookup. No scenario here is allowed to reach it.
  expect(payload.calls.some((call) => call.includes("/releases/tags/")), combined).toBe(false);
  return { payload, status: output.status, combined };
};

const listCalls = (payload) => payload.calls.filter((call) => /\/releases\?per_page=\d+&page=\d+$/.test(call));
const idCalls = (payload) => payload.calls.filter((call) => /\/releases\/\d+$/.test(call));

describe("draft-aware production release lookup", () => {
  it("returns a private draft that the releases-by-tag endpoint answers 404 for", () => {
    const { payload, status, combined } = invoke("private-draft");
    expect(status, combined).toBe(0);
    expect(payload.found).toBe(true);
    expect(payload.draft).toBe(true);
    expect(payload.release_id).toBe("990099");
    expect(payload.status).toBe("complete");
    expect(payload.state).toBe("draft");
    // Listing first (the only draft-aware discovery), then the authoritative by-id read.
    expect(listCalls(payload).length).toBeGreaterThan(0);
    expect(idCalls(payload).length).toBeGreaterThan(0);
    expect(payload.calls[0]).toMatch(/\/releases\?per_page=100&page=1$/);
  }, 180_000);

  it("returns a published release through the same lookup", () => {
    const { payload, status, combined } = invoke("published-release");
    expect(status, combined).toBe(0);
    expect(payload.found).toBe(true);
    expect(payload.draft).toBe(false);
    expect(payload.status).toBe("complete");
    expect(payload.state).toBe("published");
  }, 180_000);

  it("reports absence only for a complete listing with no matching tag", () => {
    const { payload, status, combined } = invoke("absent-empty-list");
    expect(status, combined).toBe(0);
    expect(payload.found).toBe(false);
    expect(payload.release_id).toBe("");
    expect(payload.status).toBe("absent");
    // Absence is decided by the listing alone; nothing is read by id.
    expect(idCalls(payload)).toHaveLength(0);
  }, 180_000);

  it("follows pagination until the listing ends", () => {
    const { payload, status, combined } = invoke("paginated-draft");
    expect(status, combined).toBe(0);
    expect(payload.found).toBe(true);
    expect(payload.draft).toBe(true);
    expect(payload.status).toBe("complete");
    // Page one was full and contained no match; a full page is never assumed to be the last.
    expect(payload.calls.some((call) => call.endsWith("&page=2"))).toBe(true);
  }, 180_000);

  it("inspects a private draft's assets by the same draft-aware lookup", () => {
    const { payload, status, combined } = invoke("draft-assets-private-draft");
    expect(status, combined).toBe(0);
    expect(payload.status).toBe("absent");
    expect(payload.missing).toEqual(["Compy_9.9.9_x64-setup.exe", "latest.json"]);
    expect(listCalls(payload).length).toBeGreaterThan(0);
    expect(idCalls(payload).length).toBeGreaterThan(0);
  }, 180_000);

  it("recognizes the same release after publication flips the draft flag", () => {
    const { payload, status, combined } = invoke("published-after-flag-change");
    expect(status, combined).toBe(0);
    expect(payload.draft_status).toBe("complete");
    expect(payload.draft_state).toBe("draft");
    expect(payload.draft_id).toBe("990099");
    // Before publication the stage is honestly absent...
    expect(payload.pending_status).toBe("absent");
    // ...and after only the draft flag changes, it is the SAME release, recognized as complete.
    expect(payload.published_status).toBe("complete");
    expect(payload.published_id).toBe("990099");
  }, 180_000);

  it.each([
    ["duplicate-release", /Duplicate GitHub releases for tag v9\.9\.9 .*Refusing to act on an ambiguous release\./],
    ["case-variant-tag", /case-variant tags for v9\.9\.9: V9\.9\.9\. Refusing to act on an ambiguous release namespace\./],
    ["authentication-failure", /release listing failed on page 1 .*failure\)\..*fatal here.*Bad credentials \(HTTP 401\)/],
    ["permission-failure", /release listing failed on page 1 .*fatal here.*not accessible by personal access token \(HTTP 403\)/],
    ["network-failure", /release listing failed on page 1 .*fatal here.*error connecting to api\.github\.com/],
    ["rate-limit-failure", /release listing failed on page 1 .*fatal here.*API rate limit exceeded \(HTTP 429\)/],
    ["not-found-list", /release listing failed on page 1 .*not-found\)\..*none of them mean the release is absent/],
    ["timeout-failure", /release listing timed out on page 1 .*Network failure is not absence\./],
    ["malformed-list", /release listing returned malformed JSON on page 1/],
    ["empty-list-response", /release listing returned an empty response on page 1/],
    ["wrong-shape-list", /release listing returned an unexpected response shape on page 1 .*a JSON array was required\./],
    ["unterminated-pagination", /exceeded 100 pages; refusing to act on an incompletely paginated listing\./],
    ["precise-read-failure", /API lookup failed for repos\/sandbox\/compy-releases\/releases\/990099 \(exit 1\)\..*fatal/],
    ["precise-read-timeout", /API lookup timed out for repos\/sandbox\/compy-releases\/releases\/990099\. Network failure is not absence\./],
    ["precise-read-mismatch", /release 990099 .*did not read back as tag v9\.9\.9\. Refusing to act on an inconsistent release\./],
  ])("treats %s as fatal, never as absence", (scenario, pattern) => {
    const { payload, status, combined } = invoke(scenario);
    expect(status, combined).not.toBe(0);
    expect(payload.ok).toBe(false);
    expect(payload.error, combined).toMatch(pattern);
  }, 180_000);
});
