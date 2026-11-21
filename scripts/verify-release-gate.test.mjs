// Guards for the one local release gate: scripts/verify-release.ps1 and the supply-chain
// classifier it relays. Hosted CI is off by owner decision, so this runner is the only release
// proof there is. Two failure modes matter more than anything else here, and both are silent:
//
//   1. a check quietly disappears from the runner, and the run still reports success;
//   2. a check cannot run - missing tool, unreachable advisory database, no staged candidate -
//      and the runner reports a pass instead of naming what went unproved.
//
// Everything below exists to make one of those two failures loud.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCKED,
  FAIL,
  PASS,
  SHIPPED_TARGET,
  classifyCargoFindings,
  collectCargoFindings,
  collectNpmFindings,
  exitCodeFor,
  isAcknowledgementExpired,
  parseCargoLockPackages,
  parseCargoTreePackages,
  parseNpmLockPackages,
  resolveNpmCli,
  runSupplyChainGate,
} from "./supply-chain-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_PATH = join(ROOT, "scripts", "verify-release.ps1");
const RUNNER_TEXT = readFileSync(RUNNER_PATH, "utf8");

// The guard checks bans against code, not prose, so these assertions have to do the same:
// a check name that survives only inside a comment is a check that no longer runs.
const RUNNER_CODE = RUNNER_TEXT.split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

// Q4 acceptance, restated as a list. Each entry is a check the single command must cover.
const REQUIRED_CHECKS = [
  "git diff check",
  "encoding guard",
  "release PowerShell static guard",
  "strict release-state citations",
  "documentation budget",
  "npm audit",
  "Cargo audit",
  "dependency inventory",
  "updater signature verification",
  "TypeScript",
  "Vitest suite (frontend, hooks, entrypoint, release-pipeline guards)",
  "frontend production build",
  "Rust tests",
  "Rust clippy",
];

describe("verify-release.ps1 covers the whole gate", () => {
  it("names every required check in executable code", () => {
    for (const check of REQUIRED_CHECKS) {
      expect(RUNNER_CODE, `missing check: ${check}`).toContain(`"${check}"`);
    }
  });

  it("invokes each underlying tool the check claims to run", () => {
    for (const invocation of [
      "scripts/encoding-guard.mjs",
      "scripts/release-powershell-static-guard.mjs",
      "scripts/verify-release-state.mjs",
      "scripts/doc-budget.ps1",
      "scripts/supply-chain-gate.mjs",
      "scripts/verify-updater-signature.mjs",
      "node_modules/typescript/bin/tsc",
      "clippy",
    ]) {
      expect(RUNNER_CODE, `check present but tool never invoked: ${invocation}`).toContain(invocation);
    }
  });

  it("is ASCII only, for Windows PowerShell 5.1", () => {
    const offenders = [...RUNNER_TEXT].filter((character) => character.codePointAt(0) > 127);
    expect(offenders).toEqual([]);
  });
});

describe("verify-release.ps1 never stops at the first failure", () => {
  it("exits only after the summary, and with exactly one code per outcome", () => {
    const summaryIndex = RUNNER_CODE.indexOf('"VERIFY SUMMARY"');
    expect(summaryIndex).toBeGreaterThan(0);

    const exits = [...RUNNER_CODE.matchAll(/^\s*exit\s+(\d+)/gm)];
    expect(exits.map((match) => match[1])).toEqual(["1", "3", "0", "0"]);
    for (const match of exits) {
      expect(match.index, `an exit precedes the summary: exit ${match[1]}`).toBeGreaterThan(summaryIndex);
    }
  });

  it("routes every long-running gate through the one wrapper that records failures", () => {
    const streamed = RUNNER_CODE.match(/Invoke-StreamedProcess/g) ?? [];
    expect(streamed).toHaveLength(1);
    expect(RUNNER_CODE).toMatch(/try\s*\{[\s\S]*Invoke-StreamedProcess[\s\S]*\}\s*catch\s*\{[\s\S]*Status "FAIL"/);
  });

  it("records results instead of throwing them", () => {
    expect(RUNNER_CODE).toContain('[ValidateSet("PASS", "FAIL", "BLOCKED", "PENDING")]');
    expect(RUNNER_CODE).toContain("Add-GateResult");
  });
});

describe("verify-release.ps1 reports absence out loud", () => {
  it("resolves tools without terminating the run", () => {
    expect(RUNNER_CODE).toMatch(/function Get-ToolPath[\s\S]*catch \{ return \$null \}/);
    for (const tool of ["node", "cargo", "git", "powershell"]) {
      expect(RUNNER_CODE, `tool never resolved: ${tool}`).toContain(`Get-ToolPath "${tool}"`);
    }
  });

  it("turns a missing tool into BLOCKED, not a skip", () => {
    expect(RUNNER_CODE).toMatch(/if \(-not \$ToolPath\) \{[\s\S]*Status "BLOCKED"/);
    expect(RUNNER_CODE).toMatch(/if \(\$null -eq \$npmInvocation\) \{[\s\S]*Status "BLOCKED"/);
  });

  // The runner reads the classifier's verdict back off disk. A file left by an earlier run would be
  // relayed as this run's result, which is the "inherited counts" the acceptance criteria forbid.
  it("cannot inherit a previous run's supply-chain or evidence artifact", () => {
    expect(RUNNER_CODE).toMatch(
      /foreach \(\$stalePath in @\(\$supplyChainPath, \$EvidencePath\)\)[\s\S]{0,200}?Remove-Item -LiteralPath \$stalePath -Force/,
    );
    const removeIndex = RUNNER_CODE.indexOf("Remove-Item -LiteralPath $stalePath");
    const readIndex = RUNNER_CODE.indexOf("$supplyChainText = Get-Content");
    expect(removeIndex).toBeGreaterThan(0);
    expect(removeIndex).toBeLessThan(readIndex);
  });

  it("blocks all three supply-chain checks when the classifier produces no result", () => {
    expect(RUNNER_CODE).toContain('$supplyChainChecks = @("npm audit", "Cargo audit", "dependency inventory")');
    expect(RUNNER_CODE).toMatch(/if \(\$null -eq \$supplyChain\) \{[\s\S]*Status "BLOCKED"/);
    expect(RUNNER_CODE).toMatch(/if \(-not \$reported\.ContainsKey\(\$checkName\)\) \{[\s\S]*Status "BLOCKED"/);
  });

  it("separates 'nothing staged to verify' from 'the staged signature is bad'", () => {
    expect(RUNNER_CODE).toMatch(/Test-Path -LiteralPath \$stageReceiptPath[\s\S]*Status "PENDING"/);
    expect(RUNNER_CODE).toMatch(/Test-Path -LiteralPath \$stageSignaturePath[\s\S]*Status "FAIL"/);
  });

  // bug->guard, 2026-08-19. The v0.9.26 stage was hard-blocked by a file from five days earlier:
  // the desk had rebuilt Compy_0.9.25_x64-setup.exe in place (desk and fleet diverge by design and
  // share a version string), so v0.9.25's staged receipt still pointed at that path while its .sig
  // matched the bytes that used to be there. The signature check did its job and said FAIL, and a
  // FAIL here aborts release.ps1 before it can stage anything -- so a stale artifact could veto
  // every future release until someone deleted it by hand. A receipt bound to a commit that is not
  // HEAD is a previous candidate, which is an ABSENCE of one for this run, not a bad signature.
  it("treats a receipt from an earlier commit as nothing staged, not as a bad signature", () => {
    expect(RUNNER_CODE).toMatch(
      /\$stagedCommit -and \$commit -ne "unknown" -and \$stagedCommit -ne \$commit[\s\S]{0,400}?Status "PENDING"/,
    );
    // The receipt's commit has to be read from the receipt itself, not assumed.
    expect(RUNNER_CODE).toMatch(/\$stagedCommit = \[string\]\(\(ConvertFrom-Json/);
  });

  // The branch above is dead code if HEAD is resolved after the gate that consults it -- $commit
  // would still be "unknown" there and every stale receipt would go back to failing. Order is the
  // load-bearing part, so it is what gets asserted.
  it("resolves HEAD before the signature gate that compares against it", () => {
    const headResolved = RUNNER_CODE.indexOf('"rev-parse", "HEAD"');
    const signatureGate = RUNNER_CODE.indexOf('VERIFY: updater signature verification');
    expect(headResolved, "verify-release.ps1 no longer resolves HEAD").toBeGreaterThan(-1);
    expect(signatureGate, "the signature gate is gone").toBeGreaterThan(-1);
    expect(headResolved).toBeLessThan(signatureGate);
  });

  // Unchanged, and the half that must never be softened: a candidate staged for THIS commit whose
  // signature does not verify is a real failure of the thing about to ship.
  it("still fails a candidate that IS this run's and cannot be verified", () => {
    expect(RUNNER_CODE).toMatch(/\$signatureFailures\.Count -gt 0[\s\S]{0,200}?Status "FAIL"/);
  });

  // scripts/release.ps1 runs this script twice before it builds anything, through
  // Invoke-StreamedProcess with no -AllowExitCodes, so any nonzero exit aborts the release. At that
  // point no candidate is staged. Calling that BLOCKED would exit 3 and break staging on a clean
  // checkout; calling it PASS would launder an unproved signature into a proof. It is PENDING: said
  // out loud, recorded in the evidence, and non-escalating - and release.ps1 owns the real
  // signature gates that run once the candidate exists.
  it("keeps a pending check out of the exit code without hiding it", () => {
    expect(RUNNER_CODE).toMatch(/if \(\$blocked\.Count -gt 0\) \{[\s\S]{0,240}?exit 3/);
    expect(RUNNER_CODE).toMatch(/if \(\$pending\.Count -gt 0\) \{[\s\S]{0,240}?exit 0/);
    expect(RUNNER_CODE).toMatch(/\{4\} pending/);
    expect(RUNNER_CODE).toMatch(/foreach \(\$result in \$results\)[\s\S]*\$result\.status, \$result\.name/);

    const releaseCode = readFileSync(join(ROOT, "scripts", "release.ps1"), "utf8");
    const embedded = [...releaseCode.matchAll(/Invoke-StreamedProcess[^\r\n]*verify-release\.ps1[^\r\n]*/g)];
    expect(embedded.length).toBeGreaterThan(0);
    for (const match of embedded) {
      expect(match[0], "release.ps1 tolerates a nonzero verify exit").not.toContain("-AllowExitCodes");
    }
  });

  // The staged receipt records repo-relative artifact paths (scripts/release.ps1). Testing those
  // strings as if they were absolute silently reports "nothing staged" on a real candidate, which
  // is the exact failure this gate exists to prevent.
  it("resolves receipt artifact paths against the repository root", () => {
    expect(RUNNER_CODE).toContain("Join-Path $repo ([string]$receipt.installer.path)");
    expect(RUNNER_CODE).toContain("Join-Path $repo ([string]$receipt.signature.path)");
    expect(RUNNER_CODE).not.toMatch(/Test-Path -LiteralPath \$receipt\./);
  });
});

describe("verify-release.ps1 writes the evidence pack", () => {
  it("records the run, the commit and the dependency inventory beside the bundle", () => {
    expect(RUNNER_CODE).toContain("verify-release-evidence.json");
    expect(RUNNER_CODE).toContain("supply_chain   = $supplyChainEvidence");
    expect(RUNNER_CODE).toMatch(/checks\s+= @\(\$results\)/);
    expect(RUNNER_CODE).toContain("New-Item -ItemType Directory -Force");
    expect(RUNNER_CODE).toContain("System.Text.UTF8Encoding($false)");
  });
});

describe("the single vitest run really does cover hooks and pipeline guards", () => {
  it("includes the entrypoint and release-guard suites", () => {
    for (const suite of [
      "scripts/release-powershell-static-guard.test.mjs",
      "scripts/verify-updater-signature.test.mjs",
      "scripts/encoding-guard.test.mjs",
    ]) {
      expect(existsSync(join(ROOT, suite)), `suite missing: ${suite}`).toBe(true);
    }
    const config = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
    const excludeBlock = config.slice(config.indexOf("exclude"), config.indexOf("exclude") + 200);
    expect(excludeBlock).not.toMatch(/scripts|tools/);
  });
});

// ---- the supply-chain classifier ---------------------------------------------------------------

const NOW = new Date("2026-07-31T12:00:00Z");
const OK = (stdout) => ({ exitCode: 0, stdout, stderr: "", spawnFailed: false });
const NPM_CLI = { command: "node", argumentPrefix: ["npm-cli.js"] };

const POLICY = {
  reviewed_on: "2026-07-31",
  npm: {
    acknowledged: {
      postcss: {
        severity: "high",
        classification: "build-time-only",
        why: "build only",
        review_by: "2026-10-31",
        advisories: ["GHSA-7fh5-64p2-3v2j"],
      },
    },
  },
  cargo: {
    acknowledged: {
      "RUSTSEC-2026-0194": {
        package: "quick-xml",
        classification: "shipped-not-reachable-with-untrusted-input",
        why: "our XML, not an attacker's",
        review_by: "2026-10-31",
      },
    },
  },
};

const NPM_REPORT = {
  vulnerabilities: {
    postcss: {
      severity: "high",
      isDirect: false,
      range: "<8.4.31",
      via: [{ title: "traversal", url: "https://github.com/advisories/GHSA-7fh5-64p2-3v2j" }],
    },
  },
};

const CARGO_REPORT = {
  vulnerabilities: {
    list: [
      {
        advisory: { id: "RUSTSEC-2026-0194", package: "quick-xml", title: "quadratic" },
        package: { name: "quick-xml", version: "0.37.5" },
        versions: { patched: [">=0.41.0"] },
      },
    ],
  },
  warnings: {},
};

const CARGO_TREE = "compy 0.9.9\nquick-xml 0.37.5\ntauri 2.9.5\n";

function classifyInvocation(command, args) {
  if (args[0] === "tree") return "cargoTree";
  if (args[0] === "audit") return "cargoAudit";
  if (args.includes("audit") && args.includes("--json")) return "npmAudit";
  if (args.includes("--version")) return args.length > 1 ? "npmVersion" : "toolVersion";
  return "other";
}

function scriptedRunner(script = {}) {
  const defaults = {
    cargoTree: OK(CARGO_TREE),
    cargoAudit: OK(JSON.stringify(CARGO_REPORT)),
    npmAudit: OK(JSON.stringify(NPM_REPORT)),
    toolVersion: OK("1.2.3"),
    npmVersion: OK("10.0.0"),
    other: OK(""),
  };
  return (command, args) => {
    const kind = classifyInvocation(command, args);
    const entry = Object.hasOwn(script, kind) ? script[kind] : defaults[kind];
    return typeof entry === "function" ? entry(command, args) : entry;
  };
}

const readLockfile = (path) => {
  if (path.endsWith("Cargo.lock")) {
    return '[[package]]\nname = "quick-xml"\nversion = "0.37.5"\n\n[[package]]\nname = "unrelated"\nversion = "1.0.0"\n';
  }
  if (path.endsWith("package-lock.json")) {
    return JSON.stringify({ packages: { "": {}, "node_modules/vite": { version: "7.3.5", dev: true } } });
  }
  throw new Error(`unexpected read: ${path}`);
};

function gate({ script = {}, policy = POLICY, npmCli = NPM_CLI, now = NOW } = {}) {
  return runSupplyChainGate({ run: scriptedRunner(script), policy, now, npmCli, readFile: readLockfile });
}

const statusOf = (result, name) => result.checks.find((check) => check.name === name)?.status;
const detailOf = (result, name) => result.checks.find((check) => check.name === name)?.detail ?? "";

describe("supply-chain gate: a reviewed finding passes, an unreviewed one does not", () => {
  it("passes when every current finding is classified", () => {
    const result = gate();
    expect(statusOf(result, "npm audit")).toBe(PASS);
    expect(statusOf(result, "Cargo audit")).toBe(PASS);
    expect(statusOf(result, "dependency inventory")).toBe(PASS);
    expect(result.status).toBe(PASS);
    expect(exitCodeFor(result.status)).toBe(0);
  });

  it("fails on an npm advisory nobody has reviewed", () => {
    const result = gate({
      script: {
        npmAudit: OK(JSON.stringify({ vulnerabilities: { "left-pad": { severity: "critical", via: [] } } })),
      },
    });
    expect(statusOf(result, "npm audit")).toBe(FAIL);
    expect(detailOf(result, "npm audit")).toContain("no reviewed classification");
    expect(exitCodeFor(result.status)).toBe(1);
  });

  it("fails on a shipped cargo advisory nobody has reviewed", () => {
    const report = {
      vulnerabilities: {
        list: [
          {
            advisory: { id: "RUSTSEC-9999-0001", package: "quick-xml", title: "new one" },
            package: { name: "quick-xml", version: "0.37.5" },
          },
        ],
      },
    };
    const result = gate({ script: { cargoAudit: OK(JSON.stringify(report)) } });
    expect(statusOf(result, "Cargo audit")).toBe(FAIL);
    expect(detailOf(result, "Cargo audit")).toContain("RUSTSEC-9999-0001");
  });

  it("fails when an acknowledgement has expired", () => {
    const result = gate({ now: new Date("2026-11-01T00:00:01Z") });
    expect(statusOf(result, "npm audit")).toBe(FAIL);
    expect(detailOf(result, "npm audit")).toContain("expired on 2026-10-31");
    expect(statusOf(result, "Cargo audit")).toBe(FAIL);
  });

  it("fails when an acknowledgement is filed against a different package", () => {
    const policy = {
      ...POLICY,
      cargo: { acknowledged: { "RUSTSEC-2026-0194": { package: "something-else", review_by: "2026-10-31" } } },
    };
    const result = gate({ policy });
    expect(statusOf(result, "Cargo audit")).toBe(FAIL);
    expect(detailOf(result, "Cargo audit")).toContain("but the audit reports quick-xml");
  });

  it("classifies a crate absent from the shipped Windows build without an acknowledgement", () => {
    const result = gate({ script: { cargoTree: OK("compy 0.9.9\ntauri 2.9.5\n") }, policy: { reviewed_on: "2026-07-31" } });
    expect(statusOf(result, "Cargo audit")).toBe(PASS);
    expect(result.findings.cargo[0].classification).toBe("not-in-shipped-build");
    expect(result.findings.cargo[0].why).toContain(SHIPPED_TARGET);
  });
});

// #675: Codex's review of #676 found npm acknowledgements keyed by package name alone, so a new
// advisory on an acknowledged package classified itself until review_by. An acknowledgement now
// covers only the advisories it names, including those that reach its package through another one.
describe("supply-chain gate: an npm acknowledgement covers only the advisories it names", () => {
  const REVIEWED = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
  const report = (bracesVia) => ({
    vulnerabilities: {
      braces: { severity: "high", range: "<3.0.3", via: bracesVia },
      micromatch: { severity: "high", range: "<=4.0.7", via: ["braces"] },
    },
  });
  const ack = (advisories) => ({
    severity: "high",
    classification: "developer-tool-only",
    why: "dev only",
    review_by: "2026-10-31",
    advisories,
  });
  const POLICY_PINNED = {
    ...POLICY,
    npm: { acknowledged: { braces: ack(["GHSA-vfj7-8cjw-p6xm"]), micromatch: ack(["GHSA-vfj7-8cjw-p6xm"]) } },
  };
  const npmGate = (npmReport, policy = POLICY_PINNED) =>
    gate({ policy, script: { npmAudit: OK(JSON.stringify(npmReport)) } });
  const classOf = (result, name) => result.findings.npm.find((finding) => finding.package === name)?.classification;

  it("passes when the acknowledgements name every advisory that reaches the package", () => {
    const result = npmGate(report([{ title: "redos", url: REVIEWED }]));
    expect(statusOf(result, "npm audit")).toBe(PASS);
    expect(classOf(result, "braces")).toBe("developer-tool-only");
    expect(classOf(result, "micromatch")).toBe("developer-tool-only");
  });

  it("fails on a new advisory against an acknowledged package before its review date", () => {
    const injected = { title: "new", url: "https://github.com/advisories/GHSA-zzzz-new0-0000" };
    const result = npmGate(report([{ title: "redos", url: REVIEWED }, injected]));
    expect(statusOf(result, "npm audit")).toBe(FAIL);
    expect(classOf(result, "braces")).toBe("unclassified");
    expect(classOf(result, "micromatch")).toBe("unclassified");
    expect(detailOf(result, "npm audit")).toContain("GHSA-zzzz-new0-0000");
  });

  it("fails when an acknowledgement names no advisory", () => {
    const policy = { ...POLICY, npm: { acknowledged: { ...POLICY_PINNED.npm.acknowledged, braces: ack(undefined) } } };
    const result = npmGate(report([{ title: "redos", url: REVIEWED }]), policy);
    expect(statusOf(result, "npm audit")).toBe(FAIL);
    expect(classOf(result, "braces")).toBe("unclassified");
  });

  it("fails when a package is reached through one that npm audit does not report", () => {
    const result = npmGate({ vulnerabilities: { micromatch: { severity: "high", via: ["braces"] } } });
    expect(statusOf(result, "npm audit")).toBe(FAIL);
    expect(detailOf(result, "npm audit")).toContain("braces");
  });

  it("fails when an advisory has no URL to pin an acknowledgement to", () => {
    const result = npmGate(report([{ title: "redos" }]));
    expect(statusOf(result, "npm audit")).toBe(FAIL);
    expect(classOf(result, "braces")).toBe("unclassified");
  });

  it("terminates on a cycle of via packages and leaves both unclassified", () => {
    const policy = { ...POLICY, npm: { acknowledged: { a: ack(["GHSA-vfj7-8cjw-p6xm"]), b: ack(["GHSA-vfj7-8cjw-p6xm"]) } } };
    const result = npmGate({ vulnerabilities: { a: { via: ["b"] }, b: { via: ["a"] } } }, policy);
    expect(classOf(result, "a")).toBe("unclassified");
    expect(classOf(result, "b")).toBe("unclassified");
  });
});

describe("supply-chain gate: what it cannot prove, it blocks", () => {
  it("blocks when the npm CLI is not there", () => {
    const result = gate({ npmCli: null });
    expect(statusOf(result, "npm audit")).toBe(BLOCKED);
    expect(statusOf(result, "dependency inventory")).toBe(BLOCKED);
    expect(exitCodeFor(result.status)).toBe(3);
  });

  it("blocks when npm cannot be started", () => {
    const result = gate({ script: { npmAudit: { exitCode: null, stdout: "", stderr: "ENOENT", spawnFailed: true } } });
    expect(statusOf(result, "npm audit")).toBe(BLOCKED);
    expect(detailOf(result, "npm audit")).toContain("npm could not be started");
  });

  it("blocks when npm audit returns no parsable JSON", () => {
    const result = gate({ script: { npmAudit: OK("<html>proxy error</html>") } });
    expect(statusOf(result, "npm audit")).toBe(BLOCKED);
  });

  it("blocks when the advisory service is unreachable", () => {
    const result = gate({
      script: { npmAudit: OK(JSON.stringify({ error: { summary: "ENOTFOUND registry.npmjs.org" } })) },
    });
    expect(statusOf(result, "npm audit")).toBe(BLOCKED);
    expect(detailOf(result, "npm audit")).toContain("advisory service");
  });

  it("blocks the cargo audit when the shipped-build graph cannot be computed", () => {
    const result = gate({ script: { cargoTree: { exitCode: 101, stdout: "", stderr: "no such target", spawnFailed: false } } });
    expect(statusOf(result, "Cargo audit")).toBe(BLOCKED);
    expect(statusOf(result, "dependency inventory")).toBe(BLOCKED);
    expect(result.findings.cargo).toEqual([]);
  });

  it("blocks when cargo tree reports nothing at all", () => {
    const result = gate({ script: { cargoTree: OK("") } });
    expect(statusOf(result, "Cargo audit")).toBe(BLOCKED);
    expect(detailOf(result, "Cargo audit")).toContain("no packages");
  });

  it("blocks when cargo-audit is missing or its database could not be fetched", () => {
    const result = gate({ script: { cargoAudit: OK("error: no such subcommand: audit") } });
    expect(statusOf(result, "Cargo audit")).toBe(BLOCKED);
    expect(detailOf(result, "Cargo audit")).toContain("advisory database");
  });

  it("blocks the inventory when a tool version cannot be recorded", () => {
    const result = gate({ script: { toolVersion: { exitCode: 1, stdout: "", stderr: "", spawnFailed: false } } });
    expect(statusOf(result, "dependency inventory")).toBe(BLOCKED);
    expect(detailOf(result, "dependency inventory")).toContain("no version could be recorded");
  });

  it("blocks the inventory when a lockfile cannot be read", () => {
    const result = runSupplyChainGate({
      run: scriptedRunner(),
      policy: POLICY,
      now: NOW,
      npmCli: NPM_CLI,
      readFile: () => {
        throw new Error("EPERM");
      },
    });
    expect(statusOf(result, "dependency inventory")).toBe(BLOCKED);
  });
});

// #672: on Linux and macOS, node lives in <prefix>/bin and npm in <prefix>/lib/node_modules, so a
// resolver that only knew the Windows layout left the npm audit BLOCKED on every POSIX machine.
describe("resolveNpmCli finds npm on each node install layout", () => {
  const windowsNode = join("/nodejs", "node.exe");
  const windowsCli = join("/nodejs", "node_modules", "npm", "bin", "npm-cli.js");
  const posixNode = join("/opt/node22", "bin", "node");
  const posixCli = join("/opt/node22", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const onDisk = (...paths) => (candidate) => paths.includes(candidate);

  it("finds npm beside node (the Windows layout)", () => {
    expect(resolveNpmCli({ execPath: windowsNode, exists: onDisk(windowsCli), env: {} })).toEqual({
      command: windowsNode,
      argumentPrefix: [windowsCli],
    });
  });

  it("finds npm under <prefix>/lib/node_modules when node is in <prefix>/bin (the POSIX layout)", () => {
    expect(resolveNpmCli({ execPath: posixNode, exists: onDisk(posixCli), env: {} })).toEqual({
      command: posixNode,
      argumentPrefix: [posixCli],
    });
  });

  it("still prefers npm beside node when both layouts exist", () => {
    const besideNode = join("/opt/node22", "bin", "node_modules", "npm", "bin", "npm-cli.js");
    expect(resolveNpmCli({ execPath: posixNode, exists: onDisk(besideNode, posixCli), env: {} })?.argumentPrefix).toEqual([
      besideNode,
    ]);
  });

  it("returns null when no layout has npm, which the gate reports as BLOCKED", () => {
    expect(resolveNpmCli({ execPath: posixNode, exists: () => false, env: {} })).toBeNull();
  });
});

describe("supply-chain gate: the evidence it produces", () => {
  it("records inventory, versions and shipped-build membership from the current lockfiles", () => {
    const result = gate();
    expect(result.schema_version).toBe(1);
    expect(result.shipped_target).toBe(SHIPPED_TARGET);
    expect(result.inventory.tools).toMatchObject({ node: "1.2.3", cargo: "1.2.3", rustc: "1.2.3", npm: "10.0.0" });
    expect(result.inventory.cargo).toEqual([
      { name: "quick-xml", version: "0.37.5", in_shipped_build: true },
      { name: "unrelated", version: "1.0.0", in_shipped_build: false },
    ]);
    expect(result.inventory.npm).toEqual([{ name: "vite", version: "7.3.5", dev: true }]);
  });

  it("re-derives findings from the report it was handed, never from a stored count", () => {
    const first = gate();
    const second = gate({ script: { npmAudit: OK(JSON.stringify({ vulnerabilities: {} })) } });
    expect(first.findings.npm).toHaveLength(1);
    expect(second.findings.npm).toHaveLength(0);
  });
});

describe("acknowledgement expiry", () => {
  it("treats a missing or malformed date as expired", () => {
    expect(isAcknowledgementExpired(undefined, NOW)).toBe(true);
    expect(isAcknowledgementExpired("soon", NOW)).toBe(true);
    expect(isAcknowledgementExpired("2026-13-45", NOW)).toBe(true);
  });

  it("expires the day after the review date, not before", () => {
    expect(isAcknowledgementExpired("2026-07-31", new Date("2026-07-31T23:59:59Z"))).toBe(false);
    expect(isAcknowledgementExpired("2026-07-31", new Date("2026-08-01T00:00:01Z"))).toBe(true);
  });
});

describe("parsers", () => {
  it("reads package names out of a flat cargo tree", () => {
    expect(parseCargoTreePackages("compy 0.9.9\n  quick-xml 0.37.5\n\n")).toEqual(new Set(["compy", "quick-xml"]));
  });

  it("reads name and version pairs out of Cargo.lock", () => {
    expect(parseCargoLockPackages('[[package]]\nname = "a"\nversion = "1"\n\n[metadata]\nname = "ignored"\n')).toEqual([
      { name: "a", version: "1" },
    ]);
  });

  it("reads the npm lockfile including nested paths", () => {
    const lock = { packages: { "": {}, "node_modules/a": { version: "1" }, "node_modules/a/node_modules/b": { version: "2", dev: true } } };
    expect(parseNpmLockPackages(lock)).toEqual([
      { name: "a", version: "1", dev: false },
      { name: "b", version: "2", dev: true },
    ]);
  });

  it("collects cargo warnings as findings, not just vulnerabilities", () => {
    const report = {
      vulnerabilities: { list: [] },
      warnings: { unmaintained: [{ advisory: { id: "RUSTSEC-2025-0081", package: "unic-common" }, package: { name: "unic-common", version: "0.9.0" } }] },
    };
    const findings = collectCargoFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "unmaintained", id: "RUSTSEC-2025-0081" });
  });

  it("keeps the dependency path npm reports for each advisory", () => {
    const findings = collectNpmFindings({
      vulnerabilities: { esbuild: { severity: "low", via: [{ title: "dev server" }, "vite"] } },
    });
    expect(findings[0].reachedThrough).toEqual(["vite"]);
  });

  it("does not classify a cargo finding as shipped when the tree says otherwise", () => {
    const classified = classifyCargoFindings({
      findings: [{ id: "RUSTSEC-X", package: "ghost", version: "1" }],
      shippedPackages: new Set(["quick-xml"]),
      policy: {},
      now: NOW,
    });
    expect(classified[0].classification).toBe("not-in-shipped-build");
  });
});

// ---- the checked-in policy ----------------------------------------------------------------------

describe("scripts/audit-policy.json", () => {
  const policy = JSON.parse(readFileSync(join(ROOT, "scripts", "audit-policy.json"), "utf8"));
  const entries = [
    ...Object.entries(policy.npm.acknowledged).map(([key, value]) => ["npm", key, value]),
    ...Object.entries(policy.cargo.acknowledged).map(([key, value]) => ["cargo", key, value]),
  ];

  it("declares the target it reasons about", () => {
    expect(policy.shipped_target).toBe(SHIPPED_TARGET);
    expect(policy.reviewed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives every acknowledgement a reason, a path and a review date", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [ecosystem, id, entry] of entries) {
      const label = `${ecosystem} ${id}`;
      expect(entry.why?.length, `${label} has no reachability argument`).toBeGreaterThan(40);
      expect(entry.classification, `${label} has no classification`).toBeTruthy();
      expect(Array.isArray(entry.paths) && entry.paths.length > 0, `${label} has no dependency path`).toBe(true);
      expect(entry.review_by, `${label} has no review date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        isAcknowledgementExpired(entry.review_by, new Date(`${policy.reviewed_on}T00:00:00Z`)),
        `${label} was already expired when it was reviewed`,
      ).toBe(false);
    }
  });

  it("pins every npm acknowledgement to the advisories it was reviewed against", () => {
    for (const [name, entry] of Object.entries(policy.npm.acknowledged)) {
      expect(Array.isArray(entry.advisories) && entry.advisories.length > 0, `npm ${name} names no advisory`).toBe(true);
      for (const id of entry.advisories) expect(id, `npm ${name}`).toMatch(/^GHSA(-[0-9a-z]{4}){3}$/);
    }
  });

  it("names the package for every cargo advisory, so an id cannot silently cover a different crate", () => {
    for (const [id, entry] of Object.entries(policy.cargo.acknowledged)) {
      expect(entry.package, `${id} has no package`).toBeTruthy();
    }
  });
});
