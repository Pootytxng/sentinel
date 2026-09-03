import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// WHERE DOES THIS SCRIPT RUN? — the question this file forces someone to answer.
//
// On 2026-08-04 a sweep found two gates in scripts/ that nothing ran. verify-module-map.mjs had
// every check inside `if (IS_MAIN)`, reachable only from verify-release.ps1 — the full release
// gate, which nobody runs between releases — and it had been red on `main` for two days before
// anyone noticed (9827728). Its sibling verify-release-state.mjs had the identical shape and rots
// FASTER, because RELEASE_STATE.md's citations break on any commit that shifts a line (c7c5a8d).
// Two of fourteen gates had no runner, and both were the two written most recently: a gate is at
// its most useless the week it is authored, when its author still remembers to run it by hand.
//
// So the residency question moves out of memory and into the toolchain. Every non-test script in
// scripts/ must be classified below. Add a script without classifying it and `npm test` goes red
// asking where it runs — which is the one moment anyone is thinking about the answer.
//
// What this can and cannot prove: it proves a claimed runner EXISTS and names its subject, that an
// `npm-test` subject exposes an importable API its test actually imports (the structural property
// the `IS_MAIN` trap violated — a check with no callable surface cannot be exercised by any test),
// and that repo-drift detectors are resident rather than release-only. It cannot prove a test
// meaningfully CALLS what it imported; nothing short of mutation testing can. A name-counting
// version of this guard would have gone green on both defects it exists to prevent, so the checks
// below are structural, not textual.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "scripts");
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const exists = (rel) => existsSync(join(ROOT, ...rel.split("/")));

// PowerShell comment lines stripped: a check that only appears in a comment is prose, and prose does
// not fail a build.
const code = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

// kind:
//   npm-test          runs (or is driven) on every `npm test`, via `runner`
//   npm-script        an npm script entry point; `npm test` does not exercise it
//   release           invoked by `runner` during a release; `staticGuard` pins it into that runner
//   release-entry     a human types this one; `staticGuard` pins its contents so checks cannot vanish
//   push-gate         .githooks/pre-push runs it before every push; `staticGuard` pins its contents
//   scheduled         a Windows scheduled task runs it
//   manual            a tool, not a gate — nothing to keep resident
// `why` is required for everything that is NOT resident in `npm test`, because "nobody runs this"
// must be a decision on the record rather than an accident.
const RESIDENCY = {
  "alias-propagation-harness.ps1": {
    kind: "npm-test",
    runner: "scripts/alias-propagation-harness.test.mjs",
  },
  "backup-updater-key.ps1": {
    kind: "npm-test",
    runner: "scripts/updater-key-backup-guard.test.mjs",
  },
  "branch-disposition-audit.mjs": {
    kind: "npm-test",
    runner: "scripts/branch-disposition-audit.test.mjs",
  },
  "build-icon-ico.mjs": {
    kind: "manual",
    why: "Regenerates the .ico from source art. Run when the icon changes, which is a design event, not a commit event — there is no drift for a resident check to detect between those.",
  },
  // Also runs daily in .github/workflows/ci-health.yml — but that copy watches the trunk, it does
  // not check itself. The judgment (GREEN/RED/UNKNOWN) is pure and pinned here, on every commit.
  "ci-health-report.mjs": {
    kind: "npm-test",
    runner: "scripts/ci-health-report.test.mjs",
  },
  "compy-burst.workflow.js": {
    kind: "manual",
    why: "A Workflow script the orchestrator invokes on request, plus lane-runner.ps1. It spends tokens by design, so a resident runner would be a standing bill.",
  },
  // Dot-sourced by verify-local.ps1, which is a push-gate and therefore not resident itself. This
  // one IS: deps-bootstrap-guard.test.mjs runs it standalone (-Path) against fixture trees on every
  // `npm test`, which is the only way to prove a partial node_modules triggers a reinstall.
  "deps-satisfied.ps1": {
    kind: "npm-test",
    runner: "scripts/deps-bootstrap-guard.test.mjs",
  },
  "dev-relaunch.ps1": {
    kind: "manual",
    why: "Restarts the dev app on the owner's desk. Resident execution would seize his screen mid-session.",
  },
  // Both a module and a CLI. The report it prints is for a human; the measurement it exports is
  // what rule C drives, so the residency that matters is the test, not the printer.
  "fleet-snapshot.mjs": {
    kind: "npm-test",
    runner: "scripts/handoff-worktree-truth.test.mjs",
  },
  // Not resident on purpose. It asks the LIVE machine what is running, so a resident copy would
  // fail every time a q7 probe or a self-review legitimately holds a debug port open -- i.e. it
  // would go red exactly while the tool that opens the port is doing its job. Its residency is
  // rubric item 11 in .claude/agents/self-reviewer.md, which requires the reviewer to run it and
  // QUOTE its output line before any verdict, and mirrors that into .codex/agents/self-reviewer.toml.
  "no-debug-port.mjs": {
    kind: "manual",
    why: "A teardown check for whatever opened a debug port, not a gate. Run by the self-reviewer at the end of a review (rubric item 11) and by hand after a probe; a resident copy would fail during every legitimate measurement, which is the opposite of what it is for.",
  },
  "doc-budget.ps1": {
    kind: "npm-test",
    runner: "scripts/doc-budget-guard.test.mjs",
  },
  "e2e-updater-probe.mjs": {
    kind: "release",
    runner: "scripts/ship-reinstall.ps1",
    staticGuard: "scripts/runtime-proof-guard.test.mjs",
    why: "Probes an INSTALLED app against a staged update. Needs an installed binary and an update endpoint, neither of which a commit produces.",
  },
  "encoding-guard.mjs": { kind: "npm-test", runner: "scripts/encoding-guard.test.mjs" },
  "export-library.mjs": { kind: "npm-test", runner: "scripts/export-library.test.mjs" },
  "lane-dashboard.ps1": {
    kind: "manual",
    why: "Prints the multi-lane worktree board for a human. Read-only reporting; nothing to fail.",
  },
  "lane-runner.ps1": {
    kind: "manual",
    why: "Starts a lane agent. Spending and process-spawning by design, so it stays hand-driven.",
  },
  "inspect-process-mutex-recovery.ps1": {
    kind: "manual",
    why: "Read-only recovery diagnosis by default; explicit issue-backed clearing changes a local safety interlock and must remain operator-driven.",
  },
  "license-tool.mjs": {
    kind: "manual",
    why: "Mints and inspects Pro licences for the dark license gate. Touches key material; resident execution has nothing to assert and no business handling keys.",
  },
  "process-mutex-harness.ps1": {
    kind: "npm-test",
    runner: "scripts/process-mutex-guard.test.mjs",
  },
  "markdown-link-guard.mjs": { kind: "npm-test", runner: "scripts/markdown-link-guard.test.mjs" },
  "production-adapter-lookup-harness.ps1": {
    kind: "npm-test",
    runner: "scripts/production-adapter-lookup.test.mjs",
  },
  "production-adapter-native-sandbox.ps1": {
    kind: "npm-test",
    runner: "scripts/production-adapter-native-sandbox.test.mjs",
  },
  "public-version-gate-harness.ps1": {
    kind: "npm-test",
    runner: "scripts/public-version-gate.test.mjs",
  },
  "q7-probe.mjs": {
    kind: "manual",
    why: "Drives the INSTALLED build over a CDP port on the owner's desk and records raw traces to docs/perf/raw/ — one of its legs parks the machine hands-off for ten minutes. A resident runner would need a live app, a real GPU and a user who is not touching the mouse; CI has none of the three. What IS resident is the artifact it produces: scripts/perf-budget-guard.test.mjs re-derives every published number from those traces on every `npm test`, so a hand-edited baseline fails even though the probe never re-runs.",
  },
  // A one-time recovery tool (#130), but its merge core is pure and IS resident: every refusal
  // and the byte-preservation splice are exercised on every `npm test`. The tool is the thing
  // that will one day be pointed at a real Trust Ledger, so "nobody runs it between incidents"
  // is the argument FOR keeping its core under a resident runner, not against.
  "recover-data-root.mjs": {
    kind: "npm-test",
    runner: "scripts/recover-data-root.test.mjs",
  },
  "release-powershell-static-guard.mjs": {
    kind: "npm-test",
    runner: "scripts/release-powershell-static-guard.test.mjs",
  },
  "release-prepare.ps1": {
    kind: "release-entry",
    staticGuard: "scripts/release-pipeline-guard.test.mjs",
    why: "The stage step of the release transaction, typed by a human. It builds artifacts; running it from a test suite would build a release on every commit.",
  },
  "release-prove.ps1": {
    kind: "release-entry",
    staticGuard: "scripts/release-pipeline-guard.test.mjs",
    why: "The prove step: installs the candidate on this machine and reads its live stamp. Mutates the desk it runs on.",
  },
  "emit-release-receipt.mjs": {
    kind: "npm-test",
    runner: "scripts/release-receipt-guard.test.mjs",
  },
  "release-publish.ps1": {
    kind: "release-entry",
    staticGuard: "scripts/release-pipeline-guard.test.mjs",
    why: "The publish step — the owner-gated, fleet-visible one. Automatic residency is exactly what it must never have.",
  },
  "release-transaction-harness.ps1": {
    kind: "npm-test",
    runner: "scripts/release-transaction-e2e.test.mjs",
  },
  "release.ps1": {
    kind: "release-entry",
    staticGuard: "scripts/release-pipeline-guard.test.mjs",
    why: "The release driver a human types; it prints the next stage's command rather than chaining, so each irreversible step keeps its own decision point.",
  },
  "repo-hygiene.ps1": {
    kind: "manual",
    why: "Report-only maintenance sweep (stale CLI processes, doc budget). Its one failing gate, doc-budget, is now resident on its own.",
  },
  "run-vitest.mjs": {
    kind: "npm-script",
    why: "The runner of `npm test` itself. It cannot be resident inside the suite it starts.",
  },
  "setup-local-ci.ps1": {
    kind: "manual",
    why: "One-time wiring: points git's core.hooksPath at .githooks so the pre-push gate goes live in a checkout. A test must not run it, because reconfiguring the developer's repository as a side effect of `npm test` is exactly the kind of surprise nobody consents to.",
  },
  "ship-reinstall.ps1": {
    kind: "release-entry",
    staticGuard: "scripts/release-pipeline-guard.test.mjs",
    why: "Stops the running app, installs the new build and relaunches it on the owner's desk. A standing LAW says the agent runs it after every build; a test suite must not.",
  },
  "stage-dist-site.mjs": {
    kind: "npm-test",
    runner: "scripts/dist-site-staleness-guard.test.mjs",
  },
  "supply-chain-gate.mjs": {
    kind: "release",
    runner: "scripts/verify-release.ps1",
    staticGuard: "scripts/verify-release-gate.test.mjs",
    why: "Re-runs npm and cargo audit against live advisory databases. Its answer changes when an advisory is published, not when this repo changes, so residency would make `npm test` fail for reasons no commit caused — the classifier logic is unit-tested instead.",
  },
  "actions-health.mjs": {
    kind: "scheduled",
    why: "Asks api.github.com whether Actions jobs actually EXECUTED (a completed job with 0 steps; a green run over a failed job — the 2026-08-31 Dependency-audit incident). Its answer changes with GitHub's billing state, not with a commit, so it is not resident in `npm test`; it runs on demand and as the second action of the CompyUsageAudit task, writing docs/usage-audit/ACTIONS-HEALTH.md. The judgment is a pure function pinned by scripts/actions-health.test.mjs.",
  },
  "usage-audit.mjs": {
    kind: "scheduled",
    why: "The CompyUsageAudit Windows task runs it Mondays and writes docs/usage-audit/LATEST.md. It reads session transcripts outside the repo, so a commit cannot change its answer.",
  },
  "verify-local.ps1": {
    kind: "push-gate",
    staticGuard: "scripts/local-gate-guard.test.mjs",
    why: "The everyday pre-push gate that replaced hosted CI on 2026-08-10, after the free Actions allowance was exhausted a second time. It RUNS `npm test`, so it can never be resident inside the suite it starts; its contents are pinned against ci.yml's own steps instead.",
  },
  "verify-module-map.mjs": { kind: "npm-test", runner: "scripts/verify-module-map-guard.test.mjs" },
  "verify-release-state.mjs": {
    kind: "npm-test",
    runner: "scripts/verify-release-state-guard.test.mjs",
  },
  "verify-release.ps1": {
    kind: "release-entry",
    staticGuard: "scripts/verify-release-gate.test.mjs",
    why: "The full local release gate. Hosted CI is off by owner decision, so this is the release proof — every gate it relays is separately resident, which is what makes running it a release-time act rather than the only line of defence.",
  },
  "restore-updater-key.ps1": {
    kind: "npm-test",
    runner: "scripts/updater-key-backup-guard.test.mjs",
  },
  "verify-updater-signature.mjs": {
    kind: "npm-test",
    runner: "scripts/verify-updater-signature.test.mjs",
  },
  "work-control-gate.mjs": {
    kind: "npm-test",
    runner: "scripts/work-control-gate.test.mjs",
  },
};

// Detectors whose ANSWER changes with the repo: every commit can break them, so release-time-only
// residency is rot by construction. This is the list the 2026-08-04 sweep was really about.
const DRIFT_DETECTORS = [
  "branch-disposition-audit.mjs",
  "doc-budget.ps1",
  "encoding-guard.mjs",
  "markdown-link-guard.mjs",
  "verify-module-map.mjs",
  "verify-release-state.mjs",
];

const onDisk = readdirSync(SCRIPTS)
  .filter((n) => /\.(mjs|ps1|js)$/.test(n) && !n.endsWith(".test.mjs"))
  .sort();

describe("every script in scripts/ has a declared residency", () => {
  it("classifies each one — a new script is red until someone says where it runs", () => {
    // scripts/lib/ is deliberately out of scope: those are modules imported by the entries above,
    // and an imported module has no residency question of its own.
    expect(onDisk.filter((n) => !RESIDENCY[n])).toEqual([]);
  });

  it("declares nothing that is no longer on disk", () => {
    expect(Object.keys(RESIDENCY).filter((n) => !onDisk.includes(n))).toEqual([]);
  });

  it("is not vacuous — the sweep covered a real surface, not an empty directory", () => {
    expect(onDisk.length).toBeGreaterThan(25);
  });
});

describe("each declared runner is real, and names what it claims to run", () => {
  it("resolves every npm-test runner to a test file that imports or drives its subject", () => {
    const broken = [];
    for (const [name, entry] of Object.entries(RESIDENCY)) {
      if (entry.kind !== "npm-test") continue;
      if (!entry.runner?.endsWith(".test.mjs") || !exists(entry.runner)) {
        broken.push(`${name}: runner ${entry.runner} missing`);
        continue;
      }
      const runner = read(entry.runner);
      if (name.endsWith(".mjs")) {
        // The anti-IS_MAIN check. A module whose whole body sits inside `if (IS_MAIN)` exports
        // nothing to import, so no test can exercise it — which is precisely how both 2026-08-04
        // defects hid behind green suites.
        if (!/^export /m.test(read(`scripts/${name}`))) broken.push(`${name}: exports no callable surface`);
        if (!runner.includes(`from "./${name}"`)) broken.push(`${name}: ${entry.runner} does not import it`);
      } else if (!runner.includes(name)) {
        // A .ps1 harness is driven, not imported; the test must at least name the harness it drives.
        broken.push(`${name}: ${entry.runner} does not reference it`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every release/push-gate runner and static guard, with the call site in code rather than a comment", () => {
    const broken = [];
    for (const [name, entry] of Object.entries(RESIDENCY)) {
      if (entry.kind === "release") {
        if (!exists(entry.runner)) broken.push(`${name}: runner ${entry.runner} missing`);
        else if (!code(read(entry.runner)).includes(name)) broken.push(`${name}: ${entry.runner} does not invoke it`);
      }
      if (entry.kind === "release" || entry.kind === "release-entry" || entry.kind === "push-gate") {
        if (!exists(entry.staticGuard)) broken.push(`${name}: staticGuard ${entry.staticGuard} missing`);
        else if (!read(entry.staticGuard).includes(name)) broken.push(`${name}: ${entry.staticGuard} does not pin it`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("finds every npm-script entry in package.json", () => {
    const scripts = JSON.parse(read("package.json")).scripts ?? {};
    const declared = Object.values(scripts).join("\n");
    const missing = Object.entries(RESIDENCY)
      .filter(([, e]) => e.kind === "npm-script")
      .map(([name]) => name)
      .filter((name) => !declared.includes(`scripts/${name}`));
    expect(missing).toEqual([]);
  });
});

describe("not being resident is a decision, not an oversight", () => {
  it("makes every non-resident script carry a written reason", () => {
    const unexplained = Object.entries(RESIDENCY)
      .filter(([, e]) => e.kind !== "npm-test")
      .filter(([, e]) => (e.why ?? "").length < 40)
      .map(([name]) => name);
    expect(unexplained).toEqual([]);
  });

  it("uses only the kinds this file knows how to check", () => {
    const kinds = new Set(["npm-test", "npm-script", "release", "release-entry", "push-gate", "scheduled", "manual"]);
    const unknown = Object.entries(RESIDENCY)
      .filter(([, e]) => !kinds.has(e.kind))
      .map(([name, e]) => `${name}: ${e.kind}`);
    expect(unknown).toEqual([]);
  });
});

describe("repo-drift detectors are resident, because the repo changes every day", () => {
  it("keeps each one running on `npm test` rather than only at the release gate", () => {
    const stranded = DRIFT_DETECTORS.filter((name) => RESIDENCY[name]?.kind !== "npm-test");
    // Moving one of these to release-only re-creates the 2026-08-04 defect exactly. If a detector
    // genuinely cannot run continuously, it does not belong on this list — and taking it off is a
    // decision someone has to make deliberately, in a diff, which is the whole point.
    expect(stranded).toEqual([]);
  });

  it("still names detectors that exist", () => {
    expect(DRIFT_DETECTORS.filter((n) => !onDisk.includes(n))).toEqual([]);
  });
});

// ── The same question, asked of the directory that proved this guard's own blind spot ────────────
//
// 2026-08-25. `.codex/hooks/hooks-selftest.mjs` was found FAILING 39/2. It had been red for an
// unknown stretch, because nothing runs it: it is not a `*.test.mjs`, so `npm test` never collected
// it, and it is not in `scripts/`, so the sweep above never asked where it runs. A residency guard
// scoped to one directory answers the question only for that directory — and the un-asked directory
// is where the rot was.
//
// The two real defects it should have caught are described in `scripts/codex-hooks-guard.test.mjs`.
// This block exists so that adding a third file under `.codex/hooks/` is red until someone says
// where it runs, exactly as it is in `scripts/`.
const CODEX_HOOKS = join(ROOT, ".codex", "hooks");

const CODEX_RESIDENCY = {
  "self-review-reminder.mjs": {
    kind: "codex-runtime",
    // Its own logic and its configured command line; the in-product firing is Codex's, not ours.
    pinnedBy: "scripts/codex-hooks-guard.test.mjs",
    why: "A Codex CLI PostToolUse hook. Codex invokes it, so `npm test` cannot exercise the real path — what IS resident is the CONFIGURATION that points at it: codex-hooks-guard proves the entry names this file, resolves the repo root, carries both platform lines, and that the file is on disk. Its behaviour is exercised by hooks-selftest below.",
  },
  "hooks-selftest.mjs": {
    kind: "manual",
    // The static half of what it checks is resident; the behavioural half is not, deliberately.
    pinnedBy: "scripts/codex-hooks-guard.test.mjs",
    why: "Runs the configured command lines through real cmd.exe and sh shells from three CWDs (~1.5s) and compares `git status --porcelain` across its own run, which a parallel vitest suite would flake. Its STATIC half — schema, allow-set, root resolution, echo suppression, files-on-disk — was lifted into codex-hooks-guard and IS resident; that is the half that drifted. Run this one by hand after touching hooks: `node .codex/hooks/hooks-selftest.mjs`.",
  },
};

const codexOnDisk = readdirSync(CODEX_HOOKS)
  .filter((n) => /\.(mjs|ps1|js)$/.test(n))
  .sort();

describe("every script in .codex/hooks/ has a declared residency too", () => {
  it("classifies each one", () => {
    expect(codexOnDisk.filter((n) => !CODEX_RESIDENCY[n])).toEqual([]);
  });

  it("declares nothing that is no longer on disk", () => {
    expect(Object.keys(CODEX_RESIDENCY).filter((n) => !codexOnDisk.includes(n))).toEqual([]);
  });

  it("is not vacuous", () => {
    expect(codexOnDisk.length).toBeGreaterThan(1);
  });

  it("resolves every pin to a resident test that actually names its subject", () => {
    const broken = [];
    for (const [name, entry] of Object.entries(CODEX_RESIDENCY)) {
      if (!entry.pinnedBy?.endsWith(".test.mjs") || !exists(entry.pinnedBy)) {
        broken.push(`${name}: pinnedBy ${entry.pinnedBy} missing`);
      } else if (!read(entry.pinnedBy).includes(name)) {
        broken.push(`${name}: ${entry.pinnedBy} does not name it`);
      }
      // Nothing here is resident in the ordinary sense, so the written reason is the whole record.
      if ((entry.why ?? "").length < 40) broken.push(`${name}: no written reason`);
    }
    expect(broken).toEqual([]);
  });
});
