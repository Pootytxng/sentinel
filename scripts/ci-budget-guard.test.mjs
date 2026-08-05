// Guard: CI must not spend the free allowance and silently take itself offline.
//
// bug->guard, 2026-08-01. CI stopped running on 9 July and nobody noticed for 22 days, because the
// failure did not look like a failure -- it looked like three red X's on every pull request. The
// jobs were rejected before a runner was assigned: 7 seconds, zero steps, zero billable
// milliseconds, and an annotation about the spending limit that nothing surfaced. Merges continued
// against checks that no test had produced.
//
// The cause was arithmetic, measured from GitHub's own usage metrics for July:
//
//   job                              runner    raw    x    BILLED
//   Dependency audit (informational) ubuntu    645    1      645
//   Rust (test + clippy)             windows   545    2    1,090
//   Frontend (test + build)          ubuntu    460    1      460
//                                                          -----
//                                                          2,195   vs 2,000 included
//
// So the budget is now part of the workflows' contract rather than a note somebody remembers. Every
// assertion below pins a decision that, if reverted, puts the repository back over the line -- and
// each one is written so that removing the protection makes it RED, not so that it merely describes
// what the file happens to say today.
//
// Deliberately dependency-free: js-yaml is present only as a TRANSITIVE dependency, and a guard
// that protects the build must not be one `npm install` away from being unable to run.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const WF = join(process.cwd(), ".github", "workflows");
const ci = readFileSync(join(WF, "ci.yml"), "utf8");
const audit = readFileSync(join(WF, "audit.yml"), "utf8");
const health = readFileSync(join(WF, "ci-health.yml"), "utf8");

/** Runner minute multipliers. macOS is 10x and has no business in this repository. */
const MULTIPLIER = { "ubuntu-latest": 1, "windows-latest": 2, "macos-latest": 10 };

const runnersIn = (text) => [...text.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]);

describe("the docs-only escape hatch — 42% of July's commits touched nothing a test can prove", () => {
  it("ci.yml skips runs for documentation-only changes, on BOTH triggers", () => {
    // Anchored on the trigger block so a paths-ignore that only covers `push` cannot pass: a PR of
    // pure documentation was just as expensive as a PR of code.
    const on = ci.slice(ci.indexOf("\non:"), ci.indexOf("\nconcurrency:"));
    const pushBlock = on.slice(on.indexOf("push:"), on.indexOf("pull_request:"));
    const prBlock = on.slice(on.indexOf("pull_request:"));
    expect(pushBlock).toMatch(/paths-ignore:/);
    expect(prBlock).toMatch(/paths-ignore:/);
  });

  it("ignores docs/ and markdown specifically", () => {
    expect(ci).toMatch(/["']docs\/\*\*["']/);
    expect(ci).toMatch(/["']\*\*\.md["']/);
  });

  it("still runs for anything that is not documentation", () => {
    // The inverse matters more than the rule: an ignore list that swallowed src/ or src-tauri/
    // would turn a green check into a lie, which is worse than the outage it is meant to prevent.
    for (const forbidden of ["src/**", "src-tauri/**", "scripts/**", "tools/**", "package.json", "**"]) {
      expect(ci.includes(`"${forbidden}"`)).toBe(false);
    }
  });
});

describe("the informational audit stays off the hot path", () => {
  it("lives in its own workflow, not in ci.yml", () => {
    expect(existsSync(join(WF, "audit.yml"))).toBe(true);
    expect(ci).not.toMatch(/cargo-audit/);
    expect(ci).not.toMatch(/npm audit/);
  });

  it("is NEVER triggered by a push or a pull request — that is what cost 645 minutes", () => {
    const on = audit.slice(audit.indexOf("\non:"), audit.indexOf("\nconcurrency:"));
    expect(on).not.toMatch(/^\s*push:/m);
    expect(on).not.toMatch(/^\s*pull_request:/m);
    expect(on).toMatch(/^\s*schedule:/m);
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
});

describe("the health reporter must cost less than the outage it watches for", () => {
  // Added with .github/workflows/ci-health.yml. A watchdog that eats the allowance would take CI
  // offline in exactly the way it exists to detect, so it is priced here rather than trusted.
  it("is NEVER triggered by a push or a pull request", () => {
    // A push-triggered health check bills on every commit AND tells you only about the run that
    // triggered it — paying the hot-path price for the one question you could already answer.
    const on = health.slice(health.indexOf("\non:"), health.indexOf("\nconcurrency:"));
    expect(on).not.toMatch(/^\s*push:/m);
    expect(on).not.toMatch(/^\s*pull_request:/m);
    expect(on).toMatch(/^\s*schedule:/m);
  });

  it("can be run on demand, so a suspected outage does not wait for tomorrow", () => {
    expect(health).toMatch(/workflow_dispatch:/);
  });

  it("runs at most once a day", () => {
    // `0 15 * * *` — a day-of-month or hour list here would multiply the bill silently.
    const cron = /cron:\s*["'](.+?)["']/.exec(health)?.[1];
    expect(cron).toBeDefined();
    const [minute, hour, dom, month, dow] = cron.split(/\s+/);
    for (const [field, value] of [["minute", minute], ["hour", hour]]) {
      expect(value, `${field} must be a single value, not a list or step`).toMatch(/^\d+$/);
    }
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
  });

  it("cannot run long enough to matter, even if the API hangs", () => {
    expect(health).toMatch(/timeout-minutes:\s*[1-9]\b/); // single digit, i.e. under ten
  });

  it("checks out one file rather than the repository", () => {
    expect(health).toMatch(/sparse-checkout:\s*scripts\/ci-health-report\.mjs/);
  });

  it("builds nothing — no cargo, no npm install, no npm run build", () => {
    // The line where this job would stop being free. If it ever needs a build, that argument gets
    // made here, in the projection below, not by quietly adding a step.
    expect(health).not.toMatch(/cargo/);
    expect(health).not.toMatch(/npm (ci|install|run)/);
  });
});

describe("runner cost is bounded by construction", () => {
  it("no workflow uses a macOS runner (10x) — nothing here needs one", () => {
    for (const [name, text] of [["ci.yml", ci], ["audit.yml", audit], ["ci-health.yml", health]]) {
      const bad = runnersIn(text).filter((r) => r.includes("macos"));
      expect(bad, `${name} must not use macOS runners`).toEqual([]);
    }
  });

  it("exactly ONE job runs on Windows, and only because the crate cannot compile elsewhere", () => {
    // Windows bills at 2x. One such job is a documented necessity (windows/winreg/wmi/ferrisetw/
    // runas/adlx); a second would be a 2x surprise that no one priced.
    const windows = runnersIn(ci).filter((r) => r.includes("windows"));
    expect(windows).toHaveLength(1);
    expect(runnersIn(audit).filter((r) => r.includes("windows"))).toEqual([]);
    expect(runnersIn(health).filter((r) => r.includes("windows"))).toEqual([]);
  });

  it("every runner named is one whose price we know", () => {
    for (const r of [...runnersIn(ci), ...runnersIn(audit), ...runnersIn(health)]) {
      expect(Object.keys(MULTIPLIER), `unpriced runner "${r}"`).toContain(r);
    }
  });

  it("superseded runs are cancelled rather than paid for twice", () => {
    expect(ci).toMatch(/cancel-in-progress:\s*true/);
  });
});

describe("the projected monthly cost fits inside the free allowance", () => {
  // Per-run minutes are July's measured averages, not estimates: raw job minutes / 122 runs.
  const PER_RUN = { rust: 545 / 122, frontend: 460 / 122 };
  const RUNS_PER_MONTH = 122;
  const DOCS_ONLY_SHARE = 226 / 535; // measured over July's commits to main
  const INCLUDED = 2000;

  it("lands under 2,000 billed minutes with room to spare", () => {
    const billable = RUNS_PER_MONTH * (1 - DOCS_ONLY_SHARE);
    const rust = billable * PER_RUN.rust * MULTIPLIER["windows-latest"];
    const frontend = billable * PER_RUN.frontend * MULTIPLIER["ubuntu-latest"];
    const auditWeekly = 5 * 5.3; // ~5 runs a month, ~5.3 min each, ubuntu 1x
    // site-app `npm ci` + one staged build, added so the three site guards can run at all
    // (PR #9's fix). ~1.7 min per billable run on a 1x runner — counted, not hand-waved.
    const siteSetup = billable * 1.7 * MULTIPLIER["ubuntu-latest"];
    // The health reporter: daily, sparse checkout + setup-node + two API reads. Priced at a
    // deliberately pessimistic 1 minute against a job that should finish in well under one, because
    // a watchdog that is cheaper than its own budget line is the only kind worth having.
    const healthDaily = 31 * 1 * MULTIPLIER["ubuntu-latest"];
    const total = rust + frontend + auditWeekly + siteSetup + healthDaily;

    // Recorded so a future reader sees the arithmetic rather than trusting the number.
    expect(Math.round(total)).toBeLessThan(INCLUDED);
    expect(Math.round(total)).toBeLessThan(INCLUDED * 0.6); // real headroom, not a squeaker
  });

  it("would have FAILED on July's configuration — proving this assertion can go red", () => {
    const july = 645 * 1 + 545 * 2 + 460 * 1;
    expect(july).toBeGreaterThan(INCLUDED);
  });
});
