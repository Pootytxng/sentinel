// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

// TIMEOUT: this file SPAWNS Windows PowerShell, repeatedly, and holds some of those processes for
// the length of a test. The global 15s in vitest.config.ts was calibrated for heavy React RENDER
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
const harness = join(root, "scripts", "process-mutex-harness.ps1");
const powershell = process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";
const liveChildren = new Set();
const tempRoots = new Set();

const makeCase = () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "compy-process-mutex-test-"));
  tempRoots.add(stateRoot);
  return {
    stateRoot,
    readyFile: join(stateRoot, "ready.txt"),
    mutexName: `Local\\Compy.Test.${crypto.randomUUID()}`,
    resource: `test-${crypto.randomUUID()}`,
  };
};

const evidenceUrl =
  "https://github.com/Pootytxng/sentinel/issues/128#issuecomment-5295912651";

const writeEvidenceFixture = (testCase, inspection, overrides = {}) => {
  const issueNumber = overrides.issueNumber ?? 128;
  const commentIssueNumber = overrides.commentIssueNumber ?? issueNumber;
  const path = join(testCase.stateRoot, `issue-evidence-${crypto.randomUUID()}.json`);
  const body = [
    "### Mutex recovery inspection",
    `- Resource: ${testCase.resource}`,
    `- Mutex: ${testCase.mutexName}`,
    `- Recovery state SHA-256: ${inspection.RecoveryStateSha256}`,
    `- Process/worktree/Git/receipts checked: ${overrides.inspectionEvidence ?? "isolated test holder and state"}`,
    `- Decision: ${overrides.decision ?? "safe to clear"}`,
  ].join("\n");
  const fixture = {
    comment: {
      id: 5295912651,
      html_url: overrides.commentUrl ?? evidenceUrl,
      issue_url: `https://api.github.com/repos/Pootytxng/sentinel/issues/${commentIssueNumber}`,
      body,
    },
    issue: {
      number: issueNumber,
      state: overrides.issueState ?? "open",
      labels: [{ name: overrides.label ?? "work-control" }],
    },
    project: {
      items:
        overrides.projectPresent === false
          ? []
          : [
              {
                content: {
                  number: issueNumber,
                  repository: "Pootytxng/sentinel",
                  type: "Issue",
                },
                status: overrides.projectStatus ?? "Active",
              },
            ],
    },
  };
  writeFileSync(path, JSON.stringify(fixture), "utf8");
  return path;
};

const argsFor = (action, testCase, extra = []) => [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  harness,
  "-Action",
  action,
  "-MutexName",
  testCase.mutexName,
  "-Resource",
  testCase.resource,
  "-StateRoot",
  testCase.stateRoot,
  ...extra,
];

const startHarness = (action, testCase, extra = []) => {
  const child = spawn(powershell, argsFor(action, testCase, extra), {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  return child;
};

const collect = (child) =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

const runHarness = (action, testCase, extra = []) =>
  collect(startHarness(action, testCase, extra));

// Same reason as the timeout above: 10s is not enough for powershell.exe to reach its ready
// file when 357 test files are competing for the machine.
const waitFor = async (predicate, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for harness state");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
};

afterEach(async () => {
  await Promise.all([...liveChildren].map(stop));
  for (const path of tempRoots) rmSync(path, { recursive: true, force: true });
  liveChildren.clear();
  tempRoots.clear();
});

describe.runIf(process.platform === "win32")("process-scoped Compy collision guard", () => {
  it("fails closed when a second process reaches a held resource", async () => {
    const testCase = makeCase();
    const holder = startHarness("hold", testCase, [
      "-ReadyFile",
      testCase.readyFile,
      "-HoldMs",
      "1500",
    ]);
    const holderResult = collect(holder);
    await waitFor(() => existsSync(testCase.readyFile));

    const contender = await runHarness("acquire", testCase);
    expect(contender.code).not.toBe(0);
    expect(contender.stderr).toContain("MUTEX COLLISION");
    expect(contender.stderr).toContain(testCase.resource);

    expect((await holderResult).code).toBe(0);
    expect((await runHarness("acquire", testCase)).code).toBe(0);
  });

  it("keeps a crashed holder blocked until explicit issue-backed recovery inspection", async () => {
    const testCase = makeCase();
    const holder = startHarness("hold", testCase, [
      "-ReadyFile",
      testCase.readyFile,
      "-HoldMs",
      "60000",
    ]);
    await waitFor(() => existsSync(testCase.readyFile));
    await stop(holder);

    const abandoned = await runHarness("acquire", testCase);
    expect(abandoned.code).not.toBe(0);
    expect(abandoned.stderr).toContain("RECOVERY REQUIRED");
    expect(abandoned.stderr).toContain("abandoned");

    const retry = await runHarness("acquire", testCase);
    expect(retry.code).not.toBe(0);
    expect(retry.stderr).toContain("recovery inspection is still required");

    const inspection = await runHarness("inspect", testCase);
    expect(inspection.code).toBe(2);
    const inspectionState = JSON.parse(inspection.stdout);
    expect(inspectionState.RecoveryRequired).toBe(true);
    expect(inspectionState.RecoveryStateSha256).toMatch(/^[A-F0-9]{64}$/);

    const noEvidence = await runHarness("clear", testCase);
    expect(noEvidence.code).not.toBe(0);
    expect(noEvidence.stderr).toContain("issue comment URL");
    expect((await runHarness("acquire", testCase)).code).not.toBe(0);

    const placeholderEvidence = writeEvidenceFixture(testCase, inspectionState, {
      inspectionEvidence: "<exact evidence>",
    });
    const placeholderClear = await runHarness("clear", testCase, [
      "-IssueEvidenceUrl",
      evidenceUrl,
      "-IssueEvidenceFile",
      placeholderEvidence,
    ]);
    expect(placeholderClear.code).not.toBe(0);
    expect(placeholderClear.stderr).toContain("completed recovery inspection evidence");
    expect((await runHarness("acquire", testCase)).code).not.toBe(0);

    const wrongIssueEvidence = writeEvidenceFixture(testCase, inspectionState, {
      issueNumber: 128,
      commentIssueNumber: 127,
    });
    const wrongIssueClear = await runHarness("clear", testCase, [
      "-IssueEvidenceUrl",
      evidenceUrl,
      "-IssueEvidenceFile",
      wrongIssueEvidence,
    ]);
    expect(wrongIssueClear.code).not.toBe(0);
    expect(wrongIssueClear.stderr).toContain("linked open work-control issue");
    expect((await runHarness("acquire", testCase)).code).not.toBe(0);

    const inactiveProjectEvidence = writeEvidenceFixture(testCase, inspectionState, {
      projectStatus: "Inbox",
    });
    const inactiveProjectClear = await runHarness("clear", testCase, [
      "-IssueEvidenceUrl",
      evidenceUrl,
      "-IssueEvidenceFile",
      inactiveProjectEvidence,
    ]);
    expect(inactiveProjectClear.code).not.toBe(0);
    expect(inactiveProjectClear.stderr).toContain("Active in the authoritative Work Control Project");
    expect((await runHarness("acquire", testCase)).code).not.toBe(0);

    const evidenceFile = writeEvidenceFixture(testCase, inspectionState);

    rmSync(testCase.readyFile, { force: true });
    // The holder must still be holding when the clear below reaches the mutex. Signalling it to let
    // go beats timing it: a fixed hold races powershell.exe start-up, which is unbounded under a
    // full-suite pool, and losing that race made this assertion fail as though recovery had cleared
    // while a holder was live. HoldMs is now only the hang stop.
    const releaseFile = join(testCase.stateRoot, "release-raw-holder.txt");
    const rawHolder = startHarness("raw-hold", testCase, [
      "-ReadyFile",
      testCase.readyFile,
      "-ReleaseFile",
      releaseFile,
      "-HoldMs",
      "60000",
    ]);
    const rawHolderResult = collect(rawHolder);
    await waitFor(() => existsSync(testCase.readyFile));
    const activeClear = await runHarness("clear", testCase, [
      "-IssueEvidenceUrl",
      evidenceUrl,
      "-IssueEvidenceFile",
      evidenceFile,
    ]);
    expect(activeClear.code).not.toBe(0);
    expect(activeClear.stderr).toContain("MUTEX COLLISION");
    writeFileSync(releaseFile, "release", "utf8");
    expect((await rawHolderResult).code).toBe(0);

    const cleared = await runHarness("clear", testCase, [
      "-IssueEvidenceUrl",
      evidenceUrl,
      "-IssueEvidenceFile",
      evidenceFile,
    ]);
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toContain("RECOVERY CLEARED");
    expect((await runHarness("acquire", testCase)).code).toBe(0);
  });
  it("restricts the fixture lookup seam to temporary test resources", async () => {
    const testCase = makeCase();
    testCase.mutexName = `Local\\Compy.NotTest.${crypto.randomUUID()}`;
    testCase.resource = `non-test-${crypto.randomUUID()}`;
    const holder = startHarness("hold", testCase, [
      "-ReadyFile",
      testCase.readyFile,
      "-HoldMs",
      "60000",
    ]);
    await waitFor(() => existsSync(testCase.readyFile));
    await stop(holder);

    expect((await runHarness("acquire", testCase)).code).not.toBe(0);
    const inspection = await runHarness("inspect", testCase);
    expect(inspection.code).toBe(2);
    const inspectionState = JSON.parse(inspection.stdout);
    const evidenceFile = writeEvidenceFixture(testCase, inspectionState);
    const clear = await runHarness("clear", testCase, [
      "-IssueEvidenceUrl",
      evidenceUrl,
      "-IssueEvidenceFile",
      evidenceFile,
    ]);
    expect(clear.code).not.toBe(0);
    expect(clear.stderr).toContain("Test issue lookup is restricted to temporary test resources");
    expect((await runHarness("acquire", testCase)).code).not.toBe(0);
  });


  it("releases ownership when protected work throws", async () => {
    const testCase = makeCase();
    const failed = await runHarness("throw", testCase);
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("synthetic protected failure");
    expect((await runHarness("acquire", testCase)).code).toBe(0);
  });

  it("releases ownership when protected work exits from inside the critical section", async () => {
    const testCase = makeCase();
    expect((await runHarness("exit", testCase)).code).toBe(0);
    expect((await runHarness("acquire", testCase)).code).toBe(0);
  });

  // Every test above passes an explicit -StateRoot, so none of them ever executes the DEFAULT
  // state-root path -- the one a real release and a real ship both take. That is the gap this
  // closes. The root must come through the #130 resolver (scripts/lib/canonical-data-root.ps1):
  // composing it from the $env:APPDATA string is how two lanes end up writing owner.json into two
  // different roots, each seeing a clean slate, and both proceeding. data-root-guard.test.mjs bans
  // the composition statically; only running it proves the dot-source actually wires up.
  it("resolves its default state root through the canonical data-root resolver (#130)", async () => {
    const probe = [
      `. '${join(root, "scripts", "lib", "process-mutex.ps1").replace(/'/g, "''")}'`,
      "$wired = [bool](Get-Command Get-CanonicalCompyDataRoot -ErrorAction SilentlyContinue)",
      "Write-Output \"WIRED=$wired\"",
      // try/catch must stay ONE element: joining on "; " between } and catch is a parse error.
      "try { Write-Output \"ROOT=$(Get-CompyProcessMutexDefaultStateRoot)\" } catch { Write-Output \"REFUSED=$($_.Exception.Message)\" }",
    ].join("; ");
    const result = await collect(
      spawn(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", probe], {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );

    // The dot-source is the fragile half: if it ever stops landing, the resolver call below would
    // fail at release time and nowhere earlier.
    expect(result.stdout, result.stderr).toContain("WIRED=True");

    // Either outcome proves the resolver owns the decision. A refusal is a PASS here -- on a
    // redirected or packaged-host shell #130 says refuse, and a collision guard that cannot prove
    // it is looking at the shared root must not start.
    const resolved = /^ROOT=(.+)$/m.exec(result.stdout);
    if (resolved) {
      expect(resolved[1].trim().toLowerCase()).toMatch(
        /\\compy\\work-control\\process-mutex$/,
      );
    } else {
      expect(result.stdout).toMatch(/REFUSED=Refused \(process-mutex state root\):/);
    }
  });
});
