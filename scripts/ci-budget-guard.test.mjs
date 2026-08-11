// Guard: CI must not spend the free allowance and silently take itself offline.
//
// bug->guard, twice. Read both rounds before restoring any automatic trigger -- the second round is
// a lesson about this guard, not just about the workflows.
//
// ROUND 1 (2026-08-01). CI stopped running on 9 July and nobody noticed for 22 days, because the
// failure did not look like a failure -- it looked like three red X's on every pull request. The
// jobs were rejected before a runner was assigned: 7 seconds, zero steps, zero billable
// milliseconds, and an annotation about the spending limit that nothing surfaced. Merges continued
// against checks that no test had produced. Measured from GitHub's usage metrics for July:
//
//   job                              runner    raw    x    BILLED
//   Dependency audit (informational) ubuntu    645    1      645
//   Rust (test + clippy)             windows   545    2    1,090
//   Frontend (test + build)          ubuntu    460    1      460
//                                                          -----
//                                                          2,195   vs 2,000 included
//
// The fix moved the audit to weekly, stopped docs-only commits starting runners, and added a
// projection to this file showing ~1,180 billed minutes a month. Comfortable headroom.
//
// ROUND 2 (2026-08-10). It happened again on 7 August, WITH those fixes in place AND this guard
// green. Measured from the run history for 1-7 August:
//
//   111 real CI runs in SIX DAYS   ->   ~570 runs/month
//   the projection below assumed        122 runs/month
//
// The projection was not wrong about cost per run. It was wrong about how many runs there are, and
// it was wrong in the one way a test cannot catch: RUNS_PER_MONTH was a hard-coded constant, so the
// only variable that actually moved was the one nothing was watching. Several agent lanes now push
// to `main` and to PR branches all day -- 63 pushes to main in those six days, plus 48 pull_request
// events. At ~8 billed minutes a run, 570 runs is ~6,800 minutes against a 2,000-minute allowance.
// No caching closes a 3.4x gap.
//
// THE LESSON, and why this file no longer contains a projection: a guard that models cost has to
// predict the future, and this one was defeated by a change in team behaviour that no diff to this
// repository announced. So the assertions below are now MECHANICAL. Instead of "the projected spend
// fits", they say "nothing here starts itself" -- a property that is either true or false in the
// YAML, needs no estimate of anything, and cannot be falsified by how many times people push.
//
// Verification moved to scripts/verify-local.ps1 (pinned by scripts/local-gate-guard.test.mjs),
// which runs the same checks on the owner's machine via .githooks/pre-push for zero minutes.
//
// Deliberately dependency-free: js-yaml is present only as a TRANSITIVE dependency, and a guard
// that protects the build must not be one `npm install` away from being unable to run.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WF = join(process.cwd(), ".github", "workflows");

/** Every workflow on disk, read fresh. Enumerated rather than listed, so a NEW workflow file is
 *  covered by these rules the moment it lands instead of the day someone remembers this file. */
const WORKFLOWS = Object.fromEntries(
  readdirSync(WF)
    .filter((n) => /\.ya?ml$/.test(n))
    .map((n) => [n, readFileSync(join(WF, n), "utf8")]),
);

const ci = WORKFLOWS["ci.yml"];
const audit = WORKFLOWS["audit.yml"];
const health = WORKFLOWS["ci-health.yml"];

/** Runner minute multipliers. macOS is 10x and has no business in this repository. */
const MULTIPLIER = { "ubuntu-latest": 1, "windows-latest": 2, "macos-latest": 10 };

const runnersIn = (text) => [...text.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]);

/** The trigger block: everything between `on:` and whatever section follows it. */
const triggerBlock = (text) => {
  const start = text.indexOf("\non:");
  if (start === -1) return "";
  const rest = text.slice(start + 1);
  const end = rest.search(/\n(concurrency|permissions|jobs|env|defaults):/);
  return end === -1 ? rest : rest.slice(0, end);
};

const startsItself = (text) => /^\s{2}(push|pull_request):/m.test(triggerBlock(text));

/**
 * YAML comment lines stripped. Same idiom as gate-residency-guard: a step that appears only in a
 * comment is prose, and prose does not add a build step. Without this, explaining in a comment that
 * verification moved to `npm run verify:local` would itself fail the "builds nothing" assertion --
 * which is a guard punishing its own documentation.
 */
const yamlCode = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

// The single exception, and the reason it is allowed to keep an automatic trigger. Deploying the
// public site on a site change is the automation the owner explicitly asked for, it is path-scoped
// so ordinary commits never reach it, and its deploy job skips when the Cloudflare token is absent.
const AUTO_TRIGGER_ALLOWED = "deploy-site.yml";

describe("no workflow starts itself — the mechanical replacement for a projection", () => {
  it("names every workflow that carries an automatic push/pull_request trigger", () => {
    // THE assertion this file exists for. If it is red, someone is about to re-run the 7 August
    // outage, and the fix is to answer "what runs this instead?" before turning the trigger back on.
    const offenders = Object.entries(WORKFLOWS)
      .filter(([, text]) => startsItself(text))
      .map(([name]) => name)
      .filter((name) => name !== AUTO_TRIGGER_ALLOWED);
    expect(offenders).toEqual([]);
  });

  it("keeps ci.yml runnable on demand, so 'manual-only' never means 'gone'", () => {
    // Manual-only is a budget decision, not an abandonment. A release cut or a suspected
    // works-on-my-machine still deserves a clean runner.
    expect(triggerBlock(ci)).toMatch(/workflow_dispatch:/);
    // Asserted against code, not prose: a comment saying "this used to run cargo test" must not be
    // able to satisfy a check that CI still runs cargo test.
    expect(yamlCode(ci)).toMatch(/cargo test/);
    expect(yamlCode(ci)).toMatch(/npm test/);
  });

  it("proves the exception is genuinely scoped rather than merely named", () => {
    // Allowing deploy-site by filename would let it grow into an unscoped every-push workflow while
    // this guard stayed green. So the exception has to keep earning itself.
    const deploy = WORKFLOWS[AUTO_TRIGGER_ALLOWED];
    expect(deploy, `${AUTO_TRIGGER_ALLOWED} is missing`).toBeDefined();
    const on = triggerBlock(deploy);
    expect(on).not.toMatch(/^\s{2}pull_request:/m);
    expect(on).toMatch(/paths:/);
    // A `paths:` list containing "**" is an unscoped trigger wearing a scope.
    expect(on).not.toMatch(/-\s*["']\*\*["']\s*$/m);
  });

  it("has somewhere for the verification to have GONE — this is a move, not a deletion", () => {
    // The whole trade is "hosted checks off, local checks on". If the local gate ever disappears,
    // turning CI off stops being a budget decision and becomes an absence of verification.
    expect(existsSync(join(process.cwd(), "scripts", "verify-local.ps1"))).toBe(true);
    expect(existsSync(join(process.cwd(), ".githooks", "pre-push"))).toBe(true);
    expect(existsSync(join(process.cwd(), "scripts", "local-gate-guard.test.mjs"))).toBe(true);
  });
});

describe("the informational audit stays off the hot path", () => {
  it("lives in its own workflow, not in ci.yml", () => {
    expect(existsSync(join(WF, "audit.yml"))).toBe(true);
    expect(yamlCode(ci)).not.toMatch(/cargo-audit/);
    expect(yamlCode(ci)).not.toMatch(/npm audit/);
  });

  it("is NEVER triggered by a push or a pull request — that is what cost 645 minutes", () => {
    expect(startsItself(audit)).toBe(false);
    expect(triggerBlock(audit)).toMatch(/^\s*schedule:/m);
  });

  it("can still be run on demand, so 'weekly' never means 'unavailable'", () => {
    expect(audit).toMatch(/workflow_dispatch:/);
  });

  it("stays informational — a job nobody may act on must not be able to fail a build", () => {
    expect(audit).toMatch(/continue-on-error:\s*true/);
  });

  it("does not recompile the auditor on every run", () => {
    expect(audit).toMatch(/actions\/cache@v4/);
    expect(audit).toMatch(/cache-hit\s*!=\s*'true'/);
  });

  it("runs at most weekly", () => {
    // `0 7 * * 1`. A day-of-month or hour list here would multiply the bill silently.
    const cron = /cron:\s*["'](.+?)["']/.exec(audit)?.[1];
    expect(cron).toBeDefined();
    const [minute, hour, dom, month, dow] = cron.split(/\s+/);
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dom, month]).toEqual(["*", "*"]);
    expect(dow).toMatch(/^\d$/); // a single weekday, not a list
  });
});

describe("the health reporter is dormant, because it cannot see the outage that matters", () => {
  // Kept dispatchable rather than deleted. Between 7 and 10 August five consecutive scheduled runs
  // of this workflow died in ~4 seconds with zero steps and filed nothing: a hosted watchdog cannot
  // report an outage whose definition is "hosted jobs do not start". Restoring its schedule only
  // makes sense once ci.yml has an automatic trigger again for it to read.
  it("does not start itself", () => {
    expect(startsItself(health)).toBe(false);
  });

  it("has no schedule while there is no automatic CI run for it to report on", () => {
    expect(triggerBlock(health)).not.toMatch(/^\s*schedule:/m);
  });

  it("can still be run on demand", () => {
    expect(health).toMatch(/workflow_dispatch:/);
  });

  it("cannot run long enough to matter, even if the API hangs", () => {
    expect(health).toMatch(/timeout-minutes:\s*[1-9]\b/); // single digit, i.e. under ten
  });

  it("checks out one file rather than the repository", () => {
    expect(health).toMatch(/sparse-checkout:\s*scripts\/ci-health-report\.mjs/);
  });

  it("builds nothing — no cargo, no npm install, no npm run build", () => {
    // The line where this job would stop being free. If it ever needs a build, that argument gets
    // made here, not by quietly adding a step.
    expect(yamlCode(health)).not.toMatch(/cargo/);
    expect(yamlCode(health)).not.toMatch(/npm (ci|install|run)/);
  });
});

describe("runner cost is bounded by construction", () => {
  it("no workflow uses a macOS runner (10x) — nothing here needs one", () => {
    for (const [name, text] of Object.entries(WORKFLOWS)) {
      const bad = runnersIn(text).filter((r) => r.includes("macos"));
      expect(bad, `${name} must not use macOS runners`).toEqual([]);
    }
  });

  it("exactly ONE job runs on Windows, and only because the crate cannot compile elsewhere", () => {
    // Windows bills at 2x. One such job is a documented necessity (windows/winreg/wmi/ferrisetw/
    // runas/adlx); a second would be a 2x surprise that no one priced.
    expect(runnersIn(ci).filter((r) => r.includes("windows"))).toHaveLength(1);
    for (const [name, text] of Object.entries(WORKFLOWS)) {
      if (name === "ci.yml") continue;
      expect(runnersIn(text).filter((r) => r.includes("windows")), `${name}`).toEqual([]);
    }
  });

  it("every runner named is one whose price we know", () => {
    for (const [name, text] of Object.entries(WORKFLOWS)) {
      for (const r of runnersIn(text)) {
        expect(Object.keys(MULTIPLIER), `${name}: unpriced runner "${r}"`).toContain(r);
      }
    }
  });

  it("superseded runs are cancelled rather than paid for twice", () => {
    expect(ci).toMatch(/cancel-in-progress:\s*true/);
  });
});

describe("the record of what was actually measured", () => {
  // Kept as arithmetic rather than prose so the numbers stay checkable, and so nobody rebuilds the
  // projection that these very figures defeated.
  const INCLUDED = 2000;

  it("July's configuration was over the line", () => {
    expect(645 * 1 + 545 * 2 + 460 * 1).toBeGreaterThan(INCLUDED);
  });

  it("August's run VOLUME was over the line even at July's fixed per-run cost", () => {
    // 111 real runs measured over six days, extrapolated to a month.
    const runsPerMonth = (111 / 6) * 31;
    const perRunBilled = (545 / 122) * MULTIPLIER["windows-latest"] + (460 / 122) * MULTIPLIER["ubuntu-latest"];
    expect(Math.round(runsPerMonth)).toBeGreaterThan(500);
    expect(Math.round(runsPerMonth * perRunBilled)).toBeGreaterThan(INCLUDED);
  });

  it("shows the retired projection was defeated by run count alone, not by cost per run", () => {
    // The exact hole in the old guard: same per-run cost, one wrong constant, 4.7x the traffic.
    const ASSUMED_RUNS = 122;
    expect((111 / 6) * 31 / ASSUMED_RUNS).toBeGreaterThan(4);
  });

  it("manual-only bills nothing until someone asks for it", () => {
    // The property that makes the arithmetic above stop mattering.
    expect(startsItself(ci)).toBe(false);
  });
});
