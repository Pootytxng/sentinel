#!/usr/bin/env node
// Supply-chain gate for the local release verification run.
//
// It answers three questions with current data and never with inherited counts:
//   1. what does `npm audit` say about the lockfile that is checked in right now,
//   2. what does `cargo audit` say about `src-tauri/Cargo.lock` right now,
//   3. what is actually in the shipped Windows build, so a finding is classified by reachability
//      and shipped configuration before anyone declares a severity.
//
// A finding that nobody has reviewed fails the gate. A reviewed finding whose acknowledgement has
// expired fails the gate, because an acknowledgement that never rots is just a permanent excuse.
// A tool that is missing, or an advisory database that could not be fetched, is BLOCKED - reported
// out loud, never a silent skip.
//
// Exit codes: 0 every finding classified, 1 an unclassified or expired finding, 3 blocked.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SHIPPED_TARGET = "x86_64-pc-windows-msvc";
export const POLICY_PATH = join(ROOT, "scripts", "audit-policy.json");
export const PASS = "PASS";
export const FAIL = "FAIL";
export const BLOCKED = "BLOCKED";

// cargo tree with these edges is the mechanical statement of "what the Windows build contains".
// `--target` prunes the platform-specific graph; `--edges normal,build` keeps compile-time
// dependencies in, because a build-time compromise reaches the installer just as surely.
export const CARGO_TREE_ARGS = [
  "tree",
  "--target",
  SHIPPED_TARGET,
  "--edges",
  "normal,build",
  "--prefix",
  "none",
  "--no-dedupe",
  "--quiet",
];

export function defaultRunner(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error) {
    return { exitCode: null, stdout: "", stderr: String(result.error.message), spawnFailed: true };
  }
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    spawnFailed: false,
  };
}

// Mirrors Get-NpmCliInvocation in scripts/lib/native-process.ps1: run npm through its real
// JavaScript entry point rather than the batch shim, so arguments keep array semantics.
export function resolveNpmCli({ execPath = process.execPath, exists = existsSync, env = process.env } = {}) {
  const candidates = [
    join(dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(env.APPDATA ?? "", "npm", "node_modules", "npm", "bin", "npm-cli.js"),
    join(env.ProgramFiles ?? "", "nodejs", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return { command: execPath, argumentPrefix: [candidate] };
  }
  return null;
}

export function isAcknowledgementExpired(reviewBy, now) {
  if (typeof reviewBy !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) return true;
  const deadline = Date.parse(`${reviewBy}T23:59:59Z`);
  if (!Number.isFinite(deadline)) return true;
  return now.getTime() > deadline;
}

export function loadPolicy(path = POLICY_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function parseCargoTreePackages(stdout) {
  const names = new Set();
  for (const line of String(stdout).split(/\r?\n/)) {
    const name = line.trim().split(/\s+/)[0];
    if (name && /^[A-Za-z0-9_.-]+$/.test(name)) names.add(name);
  }
  return names;
}

export function collectCargoFindings(report) {
  const findings = [];
  const seen = new Set();
  const push = (kind, entry) => {
    const advisory = entry?.advisory ?? {};
    const finding = {
      ecosystem: "cargo",
      kind,
      id: advisory.id ?? "UNKNOWN-ADVISORY",
      package: advisory.package ?? entry?.package?.name ?? "unknown",
      version: entry?.package?.version ?? "unknown",
      title: advisory.title ?? "",
      patched: entry?.versions?.patched ?? [],
    };
    const key = `${finding.id}::${finding.package}::${finding.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  for (const entry of report?.vulnerabilities?.list ?? []) push("vulnerability", entry);
  for (const [kind, list] of Object.entries(report?.warnings ?? {})) {
    for (const entry of list ?? []) push(kind, entry);
  }
  return findings;
}

export function collectNpmFindings(report) {
  const findings = [];
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    const advisories = (entry?.via ?? []).filter((via) => via && typeof via === "object");
    findings.push({
      ecosystem: "npm",
      kind: "vulnerability",
      id: name,
      package: name,
      version: entry?.range ?? "unknown",
      severity: entry?.severity ?? "unknown",
      direct: entry?.isDirect === true,
      title: advisories.map((via) => via.title).filter(Boolean).join("; "),
      advisories: advisories.map((via) => via.url).filter(Boolean),
      reachedThrough: (entry?.via ?? []).filter((via) => typeof via === "string"),
    });
  }
  return findings.sort((a, b) => a.package.localeCompare(b.package));
}

function applyAcknowledgement(finding, acknowledgement, now) {
  if (!acknowledgement) {
    return {
      ...finding,
      classification: "unclassified",
      problem: `${finding.id} (${finding.package} ${finding.version}) is in the shipped build and has no reviewed classification in scripts/audit-policy.json`,
    };
  }
  if (acknowledgement.package && acknowledgement.package !== finding.package) {
    return {
      ...finding,
      classification: "unclassified",
      problem: `${finding.id} is acknowledged for package ${acknowledgement.package} but the audit reports ${finding.package}`,
    };
  }
  if (isAcknowledgementExpired(acknowledgement.review_by, now)) {
    return {
      ...finding,
      classification: "expired",
      problem: `the acknowledgement for ${finding.id} (${finding.package}) expired on ${acknowledgement.review_by ?? "an unreadable date"} and must be re-reviewed`,
    };
  }
  return {
    ...finding,
    classification: acknowledgement.classification ?? "acknowledged",
    why: acknowledgement.why ?? "",
    reviewBy: acknowledgement.review_by,
    reviewedPaths: acknowledgement.paths ?? [],
  };
}

export function classifyCargoFindings({ findings, shippedPackages, policy, now }) {
  const acknowledged = policy?.cargo?.acknowledged ?? {};
  return findings.map((finding) => {
    if (!shippedPackages.has(finding.package)) {
      return {
        ...finding,
        classification: "not-in-shipped-build",
        why: `absent from cargo tree --target ${SHIPPED_TARGET} --edges normal,build, so it is not compiled into the shipped installer`,
      };
    }
    return applyAcknowledgement(finding, acknowledged[finding.id], now);
  });
}

export function classifyNpmFindings({ findings, policy, now }) {
  const acknowledged = policy?.npm?.acknowledged ?? {};
  return findings.map((finding) => applyAcknowledgement(finding, acknowledged[finding.package], now));
}

export function unresolvedFindings(classified) {
  return classified.filter(
    (finding) => finding.classification === "unclassified" || finding.classification === "expired",
  );
}

export function parseCargoLockPackages(text) {
  const packages = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "[[package]]") {
      if (current?.name) packages.push(current);
      current = { name: "", version: "" };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("[") && line !== "[[package]]") {
      if (current.name) packages.push(current);
      current = null;
      continue;
    }
    const match = line.match(/^(name|version)\s*=\s*"([^"]*)"$/);
    if (match) current[match[1]] = match[2];
  }
  if (current?.name) packages.push(current);
  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function parseNpmLockPackages(lock) {
  const packages = [];
  for (const [path, entry] of Object.entries(lock?.packages ?? {})) {
    if (!path) continue;
    const index = path.lastIndexOf("node_modules/");
    if (index < 0) continue;
    packages.push({
      name: path.slice(index + "node_modules/".length),
      version: entry?.version ?? "unknown",
      dev: entry?.dev === true,
    });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function excerpt(text, limit = 400) {
  const trimmed = String(text ?? "").trim().replace(/\s+/g, " ");
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function describe(classified) {
  const counts = new Map();
  for (const finding of classified) {
    counts.set(finding.classification, (counts.get(finding.classification) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => `${count} ${name}`).join(", ");
}

export function runSupplyChainGate({
  run = defaultRunner,
  policy,
  now = new Date(),
  root = ROOT,
  readFile = (path) => readFileSync(path, "utf8"),
  npmCli = resolveNpmCli(),
} = {}) {
  const checks = [];
  const addCheck = (name, status, detail) => checks.push({ name, status, detail });
  const resolvedPolicy = policy ?? loadPolicy();

  // ---- npm -----------------------------------------------------------------------------------
  let npmClassified = [];
  if (!npmCli) {
    addCheck("npm audit", BLOCKED, "npm CLI entry point (npm-cli.js) was not found beside this node");
  } else {
    const npmResult = run(npmCli.command, [...npmCli.argumentPrefix, "audit", "--json"], { cwd: root });
    const npmReport = npmResult.spawnFailed ? null : parseJsonOrNull(npmResult.stdout);
    if (npmResult.spawnFailed) {
      addCheck("npm audit", BLOCKED, `npm could not be started: ${excerpt(npmResult.stderr)}`);
    } else if (!npmReport) {
      addCheck("npm audit", BLOCKED, `npm audit produced no parsable JSON: ${excerpt(npmResult.stderr || npmResult.stdout)}`);
    } else if (npmReport.error) {
      addCheck("npm audit", BLOCKED, `npm audit could not reach the advisory service: ${excerpt(npmReport.error.summary ?? npmReport.error.detail ?? "")}`);
    } else {
      npmClassified = classifyNpmFindings({ findings: collectNpmFindings(npmReport), policy: resolvedPolicy, now });
      const unresolved = unresolvedFindings(npmClassified);
      addCheck(
        "npm audit",
        unresolved.length ? FAIL : PASS,
        unresolved.length
          ? unresolved.map((finding) => finding.problem).join(" | ")
          : `${npmClassified.length} current advisories, all classified (${describe(npmClassified) || "none"})`,
      );
    }
  }

  // ---- shipped configuration -----------------------------------------------------------------
  const cargoDir = join(root, "src-tauri");
  const treeResult = run("cargo", CARGO_TREE_ARGS, { cwd: cargoDir });
  let shippedPackages = null;
  if (treeResult.spawnFailed) {
    addCheck("Cargo audit", BLOCKED, `cargo could not be started: ${excerpt(treeResult.stderr)}`);
  } else if (treeResult.exitCode !== 0) {
    addCheck("Cargo audit", BLOCKED, `cargo tree --target ${SHIPPED_TARGET} failed, so no finding can be classified by shipped configuration: ${excerpt(treeResult.stderr)}`);
  } else {
    shippedPackages = parseCargoTreePackages(treeResult.stdout);
    if (shippedPackages.size === 0) {
      addCheck("Cargo audit", BLOCKED, `cargo tree --target ${SHIPPED_TARGET} returned no packages`);
      shippedPackages = null;
    }
  }

  // ---- cargo audit ---------------------------------------------------------------------------
  let cargoClassified = [];
  if (shippedPackages) {
    const cargoResult = run("cargo", ["audit", "--file", join(root, "src-tauri", "Cargo.lock"), "--format", "json"], { cwd: root });
    const cargoReport = cargoResult.spawnFailed ? null : parseJsonOrNull(cargoResult.stdout);
    if (cargoResult.spawnFailed) {
      addCheck("Cargo audit", BLOCKED, `cargo could not be started: ${excerpt(cargoResult.stderr)}`);
    } else if (!cargoReport) {
      addCheck("Cargo audit", BLOCKED, `cargo audit produced no parsable JSON (cargo-audit missing, or the advisory database could not be fetched): ${excerpt(cargoResult.stderr || cargoResult.stdout)}`);
    } else {
      cargoClassified = classifyCargoFindings({
        findings: collectCargoFindings(cargoReport),
        shippedPackages,
        policy: resolvedPolicy,
        now,
      });
      const unresolved = unresolvedFindings(cargoClassified);
      addCheck(
        "Cargo audit",
        unresolved.length ? FAIL : PASS,
        unresolved.length
          ? unresolved.map((finding) => finding.problem).join(" | ")
          : `${cargoClassified.length} current findings, all classified (${describe(cargoClassified) || "none"})`,
      );
    }
  }

  // ---- dependency inventory ------------------------------------------------------------------
  const tools = {};
  const missingTools = [];
  for (const [name, args] of [
    ["node", ["--version"]],
    ["cargo", ["--version"]],
    ["rustc", ["--version"]],
  ]) {
    const result = run(name, args, { cwd: root });
    if (result.spawnFailed || result.exitCode !== 0) {
      tools[name] = null;
      missingTools.push(name);
    } else {
      tools[name] = excerpt(result.stdout, 120);
    }
  }
  if (npmCli) {
    const npmVersion = run(npmCli.command, [...npmCli.argumentPrefix, "--version"], { cwd: root });
    tools.npm = npmVersion.spawnFailed || npmVersion.exitCode !== 0 ? null : excerpt(npmVersion.stdout, 120);
    if (tools.npm === null) missingTools.push("npm");
  } else {
    tools.npm = null;
    missingTools.push("npm");
  }

  let inventory = null;
  let inventoryProblem = "";
  try {
    const cargoPackages = parseCargoLockPackages(readFile(join(root, "src-tauri", "Cargo.lock"))).map((entry) => ({
      ...entry,
      in_shipped_build: shippedPackages ? shippedPackages.has(entry.name) : null,
    }));
    const npmPackages = parseNpmLockPackages(JSON.parse(readFile(join(root, "package-lock.json"))));
    inventory = { tools, shipped_target: SHIPPED_TARGET, cargo: cargoPackages, npm: npmPackages };
  } catch (error) {
    inventoryProblem = `a lockfile could not be read: ${excerpt(error?.message)}`;
  }

  if (inventoryProblem) {
    addCheck("dependency inventory", BLOCKED, inventoryProblem);
  } else if (missingTools.length) {
    addCheck("dependency inventory", BLOCKED, `no version could be recorded for: ${missingTools.join(", ")}`);
  } else if (!shippedPackages) {
    addCheck("dependency inventory", BLOCKED, `shipped-build membership is unknown because cargo tree --target ${SHIPPED_TARGET} did not run`);
  } else {
    addCheck(
      "dependency inventory",
      PASS,
      `${inventory.cargo.length} crates (${inventory.cargo.filter((entry) => entry.in_shipped_build).length} in the ${SHIPPED_TARGET} build) and ${inventory.npm.length} npm packages recorded from the current lockfiles`,
    );
  }

  const status = checks.some((check) => check.status === FAIL)
    ? FAIL
    : checks.some((check) => check.status === BLOCKED)
      ? BLOCKED
      : PASS;

  return {
    schema_version: 1,
    status,
    shipped_target: SHIPPED_TARGET,
    policy_reviewed_on: resolvedPolicy?.reviewed_on ?? null,
    checks,
    findings: { npm: npmClassified, cargo: cargoClassified },
    inventory,
  };
}

export function exitCodeFor(status) {
  if (status === PASS) return 0;
  if (status === FAIL) return 1;
  return 3;
}

function main(argv) {
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
  const result = runSupplyChainGate({ now: new Date() });

  for (const check of result.checks) {
    process.stdout.write(`${check.status.padEnd(8)} ${check.name}\n`);
    if (check.detail) process.stdout.write(`         ${check.detail}\n`);
  }

  if (outPath) {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(resolve(outPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`         evidence written to ${resolve(outPath)}\n`);
  }

  process.exit(exitCodeFor(result.status));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
