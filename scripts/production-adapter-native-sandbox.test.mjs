// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
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
  return spawnSync(
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
    { cwd: root, encoding: "utf8", shell: false, timeout: 120_000 },
  );
};

describe("production release adapter over sandboxed native transports", () => {
  it("runs real Git/GitHub handlers through first publish and a non-mutating retry", () => {
    const output = invoke();
    const lines = output.stdout.trim().split(/\r?\n/);
    const payload = JSON.parse(lines.at(-1));
    expect(output.status, `${output.stderr}\n${output.stdout}`).toBe(0);
    expect(payload.ok).toBe(true);
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
  }, 120_000);

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
  ])("fails closed in the real production handler for %s", (scenario, pattern) => {
    const output = invoke(scenario);
    expect(output.status, `${output.stderr}\n${output.stdout}`).not.toBe(0);
    expect(`${output.stderr}\n${output.stdout}`).toMatch(pattern);
  }, 120_000);
});
