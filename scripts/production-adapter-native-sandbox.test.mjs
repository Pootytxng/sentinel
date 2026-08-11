// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const sandboxes = [];

afterEach(() => {
  while (sandboxes.length) rmSync(sandboxes.pop(), { recursive: true, force: true });
});

const invoke = (scenario = "happy") => {
  const sandbox = mkdtempSync(join(tmpdir(), "compy-production-adapter-"));
  sandboxes.push(sandbox);
  const output = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(root, "scripts", "production-adapter-native-sandbox.ps1"),
      "-Sandbox",
      sandbox,
      "-Scenario",
      scenario,
    ],
    { cwd: root, encoding: "utf8", shell: false, timeout: 120_000, windowsHide: true },
  );
  // The sandbox path travels with the result: a run that fails emits no payload, and its journal is
  // the only place the "what did the transaction record before it stopped" question can be answered.
  return Object.assign(output, { sandbox });
};

const payloadOf = (output) => {
  expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
  return JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1));
};

const journalOf = (output) =>
  JSON.parse(readFileSync(join(output.sandbox, "native-release-transaction.json"), "utf8"));

const stages = [
  "receipt_verified",
  "runtime_proved",
  "source_main_pushed",
  "source_tag_pushed",
  "releases_tag_created",
  "draft_created",
  "draft_assets_verified",
  "release_published",
  "public_assets_verified",
];

describe.runIf(windows)(`production release adapter over sandboxed native transports ${WINDOWS_ONLY}`, () => {
  it("runs real Git/GitHub handlers through first publish and a non-mutating retry", () => {
    const output = invoke();
    const lines = output.stdout.trim().split(/\r?\n/);
    const payload = JSON.parse(lines.at(-1));
    expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.first_stages).toEqual(stages);
    expect(payload.retry_stages).toEqual(stages);
    expect(payload.state).toMatchObject({
      sourceMain: "5555555555555555555555555555555555555555",
      sourceTagPushed: true,
      releasesTagCreated: true,
      draftCreated: true,
      published: true,
    });

    const gitCalls = payload.calls.filter((call) => call.tool === "git").map((call) => call.args);
    const ghCalls = payload.calls.filter((call) => call.tool === "gh").map((call) => call.args);
    expect(gitCalls.some((args) => args.includes("1111111111111111111111111111111111111111:main"))).toBe(true);
    expect(gitCalls.some((args) => args.includes("refs/tags/v9.9.9"))).toBe(true);
    expect(ghCalls.some((args) => args[0] === "api" && args[1].includes("/git/ref/tags/"))).toBe(true);
    expect(ghCalls.some((args) => args[0] === "api" && args[1].endsWith("/git/refs"))).toBe(true);
    expect(ghCalls.some((args) => args[0] === "release" && args[1] === "create")).toBe(true);
    expect(ghCalls.some((args) => args[0] === "release" && args[1] === "upload")).toBe(true);
    expect(ghCalls.some((args) => args[0] === "release" && args[1] === "edit")).toBe(true);

    const mutations = payload.mutation_calls.map((call) => `${call.tool}:${call.args.join(" ")}`);
    expect(mutations.filter((call) => call.startsWith("git:") && call.includes("1111111111111111111111111111111111111111:main"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("git:") && call.includes("refs/tags/v9.9.9"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("gh:api") && call.includes("/git/refs"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("gh:release create"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("gh:release upload"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("gh:release edit"))).toHaveLength(1);

    const journal = JSON.parse(readFileSync(payload.journal, "utf8"));
    expect(journal.completed_stages).toEqual(stages);
    expect(payload.calls_after_retry).toBeGreaterThan(payload.calls_before_retry);

    // An alias that already serves the published release costs exactly one attempt and no waiting:
    // the retry policy must not impose a delay on the common case.
    expect(payload.first_alias.latest_alias_verified).toBe(true);
    expect(payload.first_alias.latest_alias_attempts).toBe(1);
    // latest_alias_seconds is a WALL-CLOCK measurement, so `toBe(0)` was flaky: under a loaded
    // machine (full suite in parallel) the fast path measures 0.1s and the release gate went red
    // with nothing wrong. Attempts === 1 above is what actually proves "no retry happened"; this
    // line proves "no deliberate wait was imposed". Every backoff in the adapter is whole-second
    // granularity (`Start-Sleep -Seconds`, release-publish-adapter.ps1:544), so anything under a
    // second means no sleep ran. The slow-path sibling at the bottom of this file already uses a
    // tolerance (toBeCloseTo(15, 0)) for this same field.
    expect(payload.first_alias.latest_alias_seconds).toBeLessThan(1);
    expect(payload.first_alias_probes).toEqual({ manifest: 1, installer: 1 });
    // Both aliases are read on every attempt, each with its own cache-busting token, so a cached
    // edge response can never be mistaken for a converged one.
    expect(payload.alias_tokens).toHaveLength(4);
    const tokens = payload.alias_tokens.map((line) => line.split("?compy-cache-bust=").at(-1));
    expect(new Set(tokens).size).toBe(2);
    expect(payload.alias_tokens.filter((line) => line.startsWith("latest.json "))).toHaveLength(2);
    expect(payload.alias_tokens.filter((line) => line.startsWith("Compy_9.9.9_x64-setup.exe "))).toHaveLength(2);

    // The sandbox gh now answers 404 for a draft by tag, exactly as GitHub does. Completing the
    // draft stages anyway is the proof that 404-by-tag is no longer read as absence, and that the
    // authenticated list -- not the tag endpoint -- is the authoritative draft-aware lookup.
    expect(ghCalls.some((args) => args[0] === "api" && /\/releases\?per_page=\d+&page=\d+$/.test(args[1]))).toBe(true);
    expect(ghCalls.some((args) => args[0] === "api" && args[1].includes("/releases/tags/"))).toBe(false);
    expect(ghCalls.some((args) => args[0] === "api" && /\/releases\/\d+$/.test(args[1]))).toBe(true);
  }, 120_000);

  it("waits out a latest-download alias that still serves the previous release", () => {
    const output = invoke("alias-propagation-lag");
    const payload = payloadOf(output);
    // The tag-specific assets are already correct and GitHub already names the new release as
    // latest; only the alias lags. That combination is the one shape treated as transient.
    expect(payload.first_stages).toEqual(stages);
    expect(payload.first_alias.latest_alias_verified).toBe(true);
    expect(payload.first_alias.latest_alias_attempts).toBe(3);
    // Backoff really is charged against the deadline, not skipped: 5s then 10s before the third read.
    expect(payload.first_alias.latest_alias_seconds).toBeCloseTo(15, 0);
    expect(payload.first_alias_probes.manifest).toBe(3);
    // A retry must not reuse the previous attempt's download: the hashes finally recorded are the
    // receipt-bound ones, never the stale 9.9.8 body an earlier attempt left in the same file.
    const binding = journalOf(output).binding;
    expect(payload.first_alias.manifest_sha256).toBe(binding.manifest_sha256);
    expect(payload.first_alias.installer_sha256).toBe(binding.installer_sha256);
    // And the whole transaction stays idempotent across the lag: nine stages again, no second push,
    // tag, draft, upload or publication.
    expect(payload.retry_stages).toEqual(stages);
    const mutations = payload.mutation_calls.map((call) => `${call.tool}:${call.args.join(" ")}`);
    expect(mutations.filter((call) => call.startsWith("gh:release create"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("gh:release upload"))).toHaveLength(1);
    expect(mutations.filter((call) => call.startsWith("gh:release edit"))).toHaveLength(1);
  }, 180_000);

  it("requires the installer alias to converge too, not just the manifest", () => {
    const output = invoke("alias-installer-lag");
    const payload = payloadOf(output);
    // Here the manifest alias is correct from the first read while the installer alias 404s. The
    // stage must keep waiting: a converged manifest alone is not a converged release.
    expect(payload.first_stages).toEqual(stages);
    expect(payload.first_alias.latest_alias_attempts).toBe(3);
    expect(payload.first_alias_probes).toEqual({ manifest: 3, installer: 3 });
  }, 180_000);

  it("treats an alias 404 for the installer as propagation lag rather than a missing asset", () => {
    const output = invoke("alias-manifest-absent");
    const payload = payloadOf(output);
    expect(payload.first_stages).toEqual(stages);
    expect(payload.first_alias.latest_alias_attempts).toBe(3);
    expect(payload.first_alias.latest_alias_verified).toBe(true);
  }, 180_000);

  it("leaves the journal one stage short when the alias never converges", () => {
    const output = invoke("alias-never-converges");
    expect(output.status).not.toBe(0);
    // The eight stages that really did happen stay recorded -- the transaction is resumable -- but
    // public_assets_verified is not written on a stage that failed.
    const journal = journalOf(output);
    expect(journal.completed_stages).toEqual(stages.slice(0, 8));
    expect(journal.completed_stages).not.toContain("public_assets_verified");
    expect(journal.evidence.public_assets_verified).toBeUndefined();
  }, 180_000);

  it("adopts a compatible pre-existing private draft instead of creating a second release", () => {
    const output = invoke("adopt-existing-draft");
    const payload = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1));
    expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
    expect(payload.first_stages).toContain("draft_created");
    expect(payload.first_stages).toContain("release_published");
    expect(payload.state).toMatchObject({ draftCreated: true, published: true, releaseId: 990099 });
    const ghCalls = payload.calls.filter((call) => call.tool === "gh").map((call) => call.args);
    // The existing draft was invisible by tag; only the list lookup can find it, and finding it is
    // what keeps the transaction from attempting a second draft (which the fake gh rejects, 422).
    expect(ghCalls.some((args) => args[0] === "release" && args[1] === "create")).toBe(false);
    expect(ghCalls.some((args) => args[0] === "release" && args[1] === "upload")).toBe(true);
    expect(ghCalls.some((args) => args[0] === "release" && args[1] === "edit")).toBe(true);
  }, 120_000);

  it("finds a draft that only appears on a later page of the releases listing", () => {
    const output = invoke("paginated-release-list");
    const payload = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1));
    expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
    expect(payload.first_stages).toContain("release_published");
    expect(payload.state.padCount).toBe(150);
    const ghCalls = payload.calls.filter((call) => call.tool === "gh").map((call) => call.args);
    expect(ghCalls.some((args) => args[0] === "api" && args[1].endsWith("&page=2"))).toBe(true);
  }, 180_000);

  it.each([
    ["authentication-failure", /Bad credentials|failures are fatal/i],
    ["permission-failure", /not accessible|failures are fatal/i],
    ["network-failure", /error connecting|failures are fatal/i],
    ["wrong-source-tag", /not the exact annotated tag object/i],
    ["wrong-installer-hash", /Installer hash changed/i],
    ["wrong-manifest-hash", /Manifest hash changed/i],
    ["wrong-updater-signature", /sandbox signature mismatch|failed \(exit 1\)/i],
    ["public-release-collision", /Existing GitHub release collision/i],
    ["downloaded-draft-mismatch", /Downloaded draft installer hash changed/i],
    ["downloaded-public-mismatch", /Public tag-specific installer hash changed/i],
    ["incompatible-existing-draft", /Existing GitHub release collision/i],
    ["duplicate-release", /Duplicate GitHub releases for tag/i],
    ["malformed-release-list", /release listing returned malformed JSON/i],
    ["empty-release-list", /release listing returned an empty response/i],
    ["wrong-shape-release-list", /unexpected response shape/i],
    ["unpaginated-release-list", /incompletely paginated listing/i],
    ["alias-never-converges", /alias did not converge on v9\.9\.9 within 30 seconds \(3 attempts\)/i],
    ["alias-unrelated-payload", /not older than the published 9\.9\.9/i],
    ["unexpected-latest-release", /reports release 880088 \(tag v9\.9\.8\) as latest/i],
  ])("fails closed in the real production handler for %s", (scenario, pattern) => {
    const output = invoke(scenario);
    const combined = `${output.stderr}\n${output.stdout}`;
    expect(output.status, combined).not.toBe(0);
    // PowerShell hard-wraps console error text at the host width, so a message is matched against
    // whitespace-normalized output rather than against accidental line breaks.
    expect(combined.replace(/\s+/g, " "), combined).toMatch(pattern);
  }, 180_000);
});
