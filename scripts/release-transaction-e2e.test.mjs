// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// TIMEOUT: this file drives release-transaction-harness.ps1 through spawnSync on powershell.exe,
// once per scenario, with no timeout of its own. The global 15s in vitest.config.ts was calibrated for heavy React RENDER
// tests, never for process spawn under a 357-file pool. Measured 2026-08-21: with this file in the
// pool the full suite failed 7 tests across three files, all with "Test timed out in 15000ms", and
// every one of them passed when the same files were run alone. Excluding this file alone took the
// failures from 7 to 1. That is spawn latency, not a defect in what these tests assert -- the
// assertions are about exit codes and ordering, which do not become truer at 15s than at 60s.
// vitest.config.ts deliberately sets no `retry`, so a starved test here is a red FAIL, not a
// silent second attempt; this is the per-file timeout that its PowerShell-driving siblings
// (deps-bootstrap-guard, production-adapter-lookup, public-version-gate) already carry.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const root = join(import.meta.dirname, "..");
const sandboxes = [];
const sandbox = () => {
  const path = mkdtempSync(join(tmpdir(), "compy-release-sim-"));
  sandboxes.push(path);
  return path;
};
afterEach(() => {
  while (sandboxes.length) rmSync(sandboxes.pop(), { recursive: true, force: true });
});

const run = (scenario, directory, extra = [], allowPublication = true) => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(root, "scripts", "release-transaction-harness.ps1"),
      "-Scenario",
      scenario,
      "-Sandbox",
      directory,
      ...(allowPublication ? ["-AllowPublication"] : []),
      ...extra,
    ],
    { cwd: root, encoding: "utf8", shell: false, windowsHide: true },
  );
  const lines = result.stdout.trim().split(/\r?\n/);
  const payload = JSON.parse(lines.at(-1));
  return { result, payload };
};

const expectSuccess = (scenario) => {
  const output = run(scenario, sandbox());
  expect(output.result.status, output.payload.error || output.result.stderr).toBe(0);
  expect(output.payload.ok).toBe(true);
  expect(output.payload.completed).toBe(true);
  expect(output.payload.stages).toHaveLength(9);
  return output.payload;
};
const expectFailure = (scenario, pattern) => {
  const output = run(scenario, sandbox());
  expect(output.result.status).not.toBe(0);
  expect(output.payload.ok).toBe(false);
  expect(output.payload.error).toMatch(pattern);
};

describe.runIf(windows)(`sandboxed end-to-end release publication ${WINDOWS_ONLY}`, () => {
  it("1. expected first-publish 404 is data and reaches the create branch", () => {
    const payload = expectSuccess("first-publish-404");
    expect(payload.events).toContain("inspect:expected-404");
    expect(payload.events).toContain("apply:releases_tag_created");
  });

  it("2. creates and verifies the releases-repository tag", () => {
    const payload = expectSuccess("create-releases-tag");
    expect(payload.events.indexOf("apply:source_tag_pushed")).toBeLessThan(
      payload.events.indexOf("apply:releases_tag_created"),
    );
  });

  it("3. resumes when source main was already pushed", () => {
    const payload = expectSuccess("source-main-already-pushed");
    expect(payload.events).not.toContain("apply:source_main_pushed");
  });

  it("4. resumes when the exact source tag was already pushed", () => {
    const payload = expectSuccess("source-tag-already-pushed");
    expect(payload.events).not.toContain("apply:source_tag_pushed");
  });

  it("5. resumes when the exact releases-repository tag already exists", () => {
    const payload = expectSuccess("releases-tag-already-created");
    expect(payload.events).not.toContain("apply:releases_tag_created");
  });

  // bug→guard (v0.9.12, 2026-08-03): GitHub answered 404 for the releases-repo tag the engine had
  // just successfully created, and the one-shot post-Apply verification read that absence as
  // failure. The publish needed THREE invocations, each completing exactly one stage. The engine
  // now retries a post-Apply "absent" before concluding failure. This fails on the old engine.
  it("5b. rides out a post-create 404 (read-after-write lag) inside ONE invocation", () => {
    const output = run("complete-first-publish", sandbox(), [
      "-LagOnceAtStage",
      "releases_tag_created",
    ]);
    expect(output.result.status, output.payload.error || output.result.stderr).toBe(0);
    expect(output.payload.ok).toBe(true);
    expect(output.payload.completed).toBe(true);
    expect(output.payload.stages).toHaveLength(9);
    // The lag must actually have been exercised, or this guard proves nothing.
    expect(output.payload.events).toContain("inspect:eventual-consistency-lag");
  });

  it("6. resumes when the exact draft already exists", () => {
    const payload = expectSuccess("draft-already-created");
    expect(payload.events).not.toContain("apply:draft_created");
  });

  it("7. resumes when draft assets are already uploaded and byte-correct", () => {
    const payload = expectSuccess("assets-already-uploaded");
    expect(payload.events).not.toContain("apply:draft_assets_verified");
  });

  it("8. retries safely after a failure at every mutation boundary", () => {
    const stages = [
      "runtime_proved",
      "source_main_pushed",
      "source_tag_pushed",
      "releases_tag_created",
      "draft_created",
      "draft_assets_verified",
      "release_published",
      "public_assets_verified",
    ];
    for (const stage of stages) {
      const directory = sandbox();
      const first = run("retry-boundaries", directory, ["-FailOnceAtStage", stage]);
      expect(first.result.status, stage).not.toBe(0);
      expect(first.payload.error).toContain(`injected post-side-effect failure at ${stage}`);
      const retry = run("retry-boundaries", directory, ["-FailOnceAtStage", stage]);
      expect(retry.result.status, retry.payload.error).toBe(0);
      expect(retry.payload.completed).toBe(true);
      expect(retry.payload.stages).toHaveLength(9);
      if (stage === "public_assets_verified") {
        expect(retry.payload.events).not.toContain("apply:public_assets_verified");
      } else {
        expect(retry.payload.events.filter((event) => event === `apply:${stage}`)).toHaveLength(1);
      }
    }
  }, 120_000);

  it("9. treats authentication failure as fatal", () =>
    expectFailure("authentication-failure", /failures are fatal.*Bad credentials/i));
  it("10. treats permission failure as fatal", () =>
    expectFailure("permission-failure", /failures are fatal.*not accessible/i));
  it("11. treats network failure as fatal", () =>
    expectFailure("network-failure", /failures are fatal.*error connecting/i));
  it("12. rejects a wrong source-tag target", () =>
    expectFailure("wrong-source-tag-target", /wrong source-tag target/));
  it("13. rejects a wrong installer hash", () =>
    expectFailure("wrong-installer-hash", /wrong installer hash/));
  it("14. rejects a wrong manifest hash", () =>
    expectFailure("wrong-manifest-hash", /wrong manifest hash/));
  it("15. rejects a wrong updater signature", () =>
    expectFailure("wrong-updater-signature", /wrong updater signature/));
  it("16. rejects an existing public release collision", () =>
    expectFailure("existing-public-release-collision", /existing public release collision/));
  it("17. rejects public manifest and tag version disagreement", () =>
    expectFailure("public-manifest-tag-disagreement", /public manifest.tag version disagreement/));
  it("18. rejects downloaded draft asset mismatch", () =>
    expectFailure("downloaded-draft-asset-mismatch", /sandbox downloaded asset mismatch/));
  it("19. rejects downloaded public asset mismatch", () =>
    expectFailure("downloaded-public-asset-mismatch", /sandbox downloaded asset mismatch/));

  it("20. completes the entire first-publish transaction in the fixed order", () => {
    const payload = expectSuccess("complete-first-publish");
    expect(payload.stages).toEqual([
      "receipt_verified",
      "runtime_proved",
      "source_main_pushed",
      "source_tag_pushed",
      "releases_tag_created",
      "draft_created",
      "draft_assets_verified",
      "release_published",
      "public_assets_verified",
    ]);
    const journal = JSON.parse(readFileSync(payload.journal, "utf8"));
    expect(journal.binding).toMatchObject({
      receipt_schema: 3,
      version: "9.9.9",
      release_commit: "1111111111111111111111111111111111111111",
      source_tag: "v9.9.9",
      installer_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      signature_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      manifest_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(journal.completed_stages).toEqual(payload.stages);
  });

  it("resumes a partial byte-correct draft upload without overwriting it", () => {
    const directory = sandbox();
    const partial = run("partial-draft-asset-resume", directory);
    expect(partial.result.status).not.toBe(0);
    expect(partial.payload.error).toContain("failure after first draft asset upload");
    const retry = run("partial-draft-asset-resume", directory);
    expect(retry.result.status, retry.payload.error).toBe(0);
    expect(retry.payload.completed).toBe(true);
  });

  it("stops at the fleet-visible owner boundary when publication is not authorized", () => {
    const directory = sandbox();
    const boundary = run("complete-first-publish", directory, [], false);
    expect(boundary.result.status).not.toBe(0);
    expect(boundary.payload.error).toContain("OWNER BOUNDARY");
    const state = JSON.parse(readFileSync(boundary.payload.state, "utf8"));
    expect(state.release_published).toBe(false);
    expect(state.events).not.toContain("apply:release_published");
    const journal = JSON.parse(readFileSync(boundary.payload.journal, "utf8"));
    expect(journal.completed_stages.at(-1)).toBe("draft_assets_verified");
  });

  it("rejects a journal bound to different artifact hashes", () => {
    const directory = sandbox();
    const stopped = run(
      "journal-audit",
      directory,
      ["-StopAfterStage", "receipt_verified"],
    );
    expect(stopped.result.status).toBe(0);
    const journal = JSON.parse(readFileSync(stopped.payload.journal, "utf8"));
    journal.binding.installer_sha256 = "f".repeat(64);
    writeFileSync(stopped.payload.journal, JSON.stringify(journal));
    const retry = run("journal-audit", directory);
    expect(retry.result.status).not.toBe(0);
    expect(retry.payload.error).toContain("bound to a different receipt");
  });

  it("rejects journaled completion when external state regresses", () => {
    const directory = sandbox();
    const stopped = run(
      "journal-audit",
      directory,
      ["-StopAfterStage", "source_main_pushed"],
    );
    expect(stopped.result.status).toBe(0);
    const state = JSON.parse(readFileSync(stopped.payload.state, "utf8"));
    state.source_main_pushed = false;
    writeFileSync(stopped.payload.state, JSON.stringify(state));
    const retry = run("journal-audit", directory);
    expect(retry.result.status).not.toBe(0);
    expect(retry.payload.error).toContain("real state is not compatible");
  });

  it("repairs a journal whose evidence was polluted with the dictionary surface", () => {
    const directory = sandbox();
    const stopped = run("journal-audit", directory, ["-StopAfterStage", "receipt_verified"]);
    expect(stopped.result.status).toBe(0);

    // The exact shape the real v0.9.11 journal was written with: enumerating an ordered dictionary
    // through psobject.Properties yielded the IDictionary surface, and those names were persisted as
    // literal evidence keys alongside the real stage evidence.
    const polluted = JSON.parse(readFileSync(stopped.payload.journal, "utf8"));
    const receipt = polluted.evidence.receipt_verified;
    expect(receipt).toBeTruthy();
    polluted.evidence = {
      Count: 8,
      IsReadOnly: false,
      Keys: ["Count", "IsReadOnly", "Keys", "Values", "IsFixedSize", "SyncRoot", "IsSynchronized"],
      Values: [0, false, [], [], false, {}, false],
      IsFixedSize: false,
      SyncRoot: {},
      IsSynchronized: false,
      receipt_verified: receipt,
    };
    writeFileSync(stopped.payload.journal, JSON.stringify(polluted));

    // A polluted journal is still readable and still resumable: authority never lived in evidence.
    const retry = run("journal-audit", directory);
    expect(retry.result.status, retry.payload.error).toBe(0);
    expect(retry.payload.completed).toBe(true);
    expect(retry.payload.stages).toHaveLength(9);

    const repaired = JSON.parse(readFileSync(stopped.payload.journal, "utf8"));
    expect(repaired.schema_version).toBe(1);
    expect(repaired.completed_stages).toEqual(retry.payload.stages);
    // The surface names are gone, the real evidence survived, and only stage names remain.
    for (const name of ["Count", "IsReadOnly", "Keys", "Values", "IsFixedSize", "SyncRoot", "IsSynchronized"]) {
      expect(Object.keys(repaired.evidence)).not.toContain(name);
    }
    expect(repaired.evidence.receipt_verified).toMatchObject(receipt);
    expect(Object.keys(repaired.evidence).every((key) => retry.payload.stages.includes(key))).toBe(true);
    expect(Object.keys(repaired.evidence)).toContain("public_assets_verified");
  });

  it("rejects duplicate or out-of-order journal stage lists", () => {
    for (const completed_stages of [
      ["release_published", "receipt_verified"],
      ["receipt_verified", "receipt_verified"],
    ]) {
      const directory = sandbox();
      const stopped = run(
        "journal-audit",
        directory,
        ["-StopAfterStage", "receipt_verified"],
      );
      expect(stopped.result.status).toBe(0);
      const journal = JSON.parse(readFileSync(stopped.payload.journal, "utf8"));
      journal.completed_stages = completed_stages;
      writeFileSync(stopped.payload.journal, JSON.stringify(journal));
      const retry = run("journal-audit", directory);
      expect(retry.result.status).not.toBe(0);
      expect(retry.payload.error).toMatch(/ordered prefix|duplicate stages/);
    }
  });
});
