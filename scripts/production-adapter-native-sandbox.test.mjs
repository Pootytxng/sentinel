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

    // The sandbox gh now answers 404 for a draft by tag, exactly as GitHub does. Completing the
    // draft stages anyway is the proof that 404-by-tag is no longer read as absence, and that the
    // authenticated list -- not the tag endpoint -- is the authoritative draft-aware lookup.
    expect(ghCalls.some((args) => args[0] === "api" && /\/releases\?per_page=\d+&page=\d+$/.test(args[1]))).toBe(true);
    expect(ghCalls.some((args) => args[0] === "api" && args[1].includes("/releases/tags/"))).toBe(false);
    expect(ghCalls.some((args) => args[0] === "api" && /\/releases\/\d+$/.test(args[1]))).toBe(true);
  }, 120_000);

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
  ])("fails closed in the real production handler for %s", (scenario, pattern) => {
    const output = invoke(scenario);
    const combined = `${output.stderr}\n${output.stdout}`;
    expect(output.status, combined).not.toBe(0);
    // PowerShell hard-wraps console error text at the host width, so a message is matched against
    // whitespace-normalized output rather than against accidental line breaks.
    expect(combined.replace(/\s+/g, " "), combined).toMatch(pattern);
  }, 180_000);
});
