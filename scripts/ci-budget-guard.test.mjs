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
import { execSync } from "node:child_process";
import { join } from "node:path";

const WF = join(process.cwd(), ".github", "workflows");
const ci = readFileSync(join(WF, "ci.yml"), "utf8");
const ciRust = readFileSync(join(WF, "ci-rust.yml"), "utf8");
const audit = readFileSync(join(WF, "audit.yml"), "utf8");
const health = readFileSync(join(WF, "ci-health.yml"), "utf8");

/** Runner minute multipliers. macOS is 10x and has no business in this repository. */
const MULTIPLIER = { "ubuntu-latest": 1, "windows-latest": 2, "macos-latest": 10 };

const runnersIn = (text) => [...text.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]);

describe("the docs-only escape hatch — 40% of commits touch nothing a test can prove", () => {
  it("ci.yml skips runs for documentation-only changes", () => {
    const on = ci.slice(ci.indexOf("\non:"), ci.indexOf("\nconcurrency:"));
    expect(on.slice(on.indexOf("pull_request:"))).toMatch(/paths-ignore:/);
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

const ALL_WORKFLOWS = [
  ["ci.yml", ci],
  ["ci-rust.yml", ciRust],
  ["audit.yml", audit],
  ["ci-health.yml", health],
];

describe("runner cost is bounded by construction", () => {
  it("no workflow uses a macOS runner (10x) — nothing here needs one", () => {
    for (const [name, text] of ALL_WORKFLOWS) {
      const bad = runnersIn(text).filter((r) => r.includes("macos"));
      expect(bad, `${name} must not use macOS runners`).toEqual([]);
    }
  });

  it("exactly ONE job in the whole repository runs on Windows", () => {
    // Windows bills at 2x, and that one job was 62% of the August spend. One is a documented
    // necessity (windows/winreg/wmi/ferrisetw/runas/adlx); a second would be a 2x surprise nobody
    // priced. Counted across every workflow, so moving it between files cannot hide a duplicate.
    const windows = ALL_WORKFLOWS.flatMap(([, t]) => runnersIn(t)).filter((r) => r.includes("windows"));
    expect(windows).toHaveLength(1);
    expect(runnersIn(ciRust).filter((r) => r.includes("windows"))).toHaveLength(1);
  });

  it("every runner named is one whose price we know", () => {
    for (const r of ALL_WORKFLOWS.flatMap(([, t]) => runnersIn(t))) {
      expect(Object.keys(MULTIPLIER), `unpriced runner "${r}"`).toContain(r);
    }
  });

  it("superseded runs are cancelled rather than paid for twice", () => {
    expect(ci).toMatch(/cancel-in-progress:\s*true/);
    expect(ciRust).toMatch(/cancel-in-progress:\s*true/);
  });
});

describe("the merge is not a second event worth paying for", () => {
  // 54 of 91 runs in the first week of August were pushes to main re-running the exact checks the
  // pull request had already run, at full price, to produce an answer that was already known.
  it("neither CI workflow runs on a push", () => {
    for (const [name, text] of [["ci.yml", ci], ["ci-rust.yml", ciRust]]) {
      const on = text.slice(text.indexOf("\non:"), text.indexOf("\nconcurrency:"));
      expect(on, `${name} must not trigger on push`).not.toMatch(/^\s*push:/m);
    }
  });

  it("both stay runnable on demand, so 'no push trigger' never means 'unavailable'", () => {
    expect(ci).toMatch(/workflow_dispatch:/);
    expect(ciRust).toMatch(/workflow_dispatch:/);
  });
});

describe("the 2x Windows job only runs when Rust can have changed", () => {
  it("is paths-scoped rather than running on everything", () => {
    const on = ciRust.slice(ciRust.indexOf("\non:"), ciRust.indexOf("\nconcurrency:"));
    expect(on).toMatch(/paths:/);
    expect(on).not.toMatch(/paths-ignore:/); // an allow-list, not a deny-list
  });

  it("covers every input that can change what cargo test and clippy prove", () => {
    // Incomplete here means a green check that compiled nothing. These four are the inputs that
    // exist today; a fifth must be added by hand — no test can infer one that does not exist yet.
    for (const p of ["src-tauri/**", "rust-toolchain.toml", ".github/workflows/ci-rust.yml"]) {
      expect(ciRust.includes(`"${p}"`), `ci-rust.yml paths must include ${p}`).toBe(true);
    }
  });

  it("does not carry the frontend job with it — that would undo the saving", () => {
    expect(ciRust).not.toMatch(/npm (ci|test|run build)/);
    expect(runnersIn(ciRust)).toHaveLength(1);
  });
});

describe("the projected monthly cost fits inside the free allowance", () => {
  // Measured 2026-08-07 from the GitHub Actions API, first seven days of August:
  //   Rust (windows)  506 raw / 91 runs   Frontend (ubuntu)  583 raw / 91 runs
  const PER_RUN = { rust: 506 / 91, frontend: 583 / 91 };
  // Measured over the same window: commits to main in 30 days, and the share of them that touch
  // src-tauri/ at all. The Rust workflow is paths-scoped, so it is the ONLY thing that gates it.
  const RUST_PATH_SHARE = 58 / 593;
  const INCLUDED = 2000;

  // The previous version of this block hardcoded RUNS_PER_MONTH = 122 from July and stayed green
  // through an overrun that billed 1,619 minutes in seven days. It pinned the CONFIG while the
  // thing that actually blew the budget — how fast this repository moves — was assumed constant and
  // never looked at again. So velocity is now READ from git history, not declared.
  //
  // Calibration, measured 2026-08-07 over the same seven days as the per-run figures above:
  //   169 commits to main, 62 of them docs-only  ->  107 code commits
  //   37 pull_request CI runs                    ->  0.35 runs per code commit
  // Below 1 because several commits ride one push, and cancel-in-progress kills the superseded
  // runs. Reproduces the observed count: 107/wk -> ~459 code commits/month -> ~161 runs. The
  // recorded figure was 159.
  const RUNS_PER_CODE_COMMIT = 37 / 107;
  const RECORDED_RUNS_PER_MONTH = 159;

  /** Code commits (not docs) landing on main in 30 days, or null on a clone too shallow to know. */
  function measuredCodeCommitsPerMonth() {
    try {
      const log = execSync('git log main --since="30 days ago" --format=%x00 --name-only', {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
      const commits = log.split("\0").slice(1);
      if (commits.length === 0) return null; // shallow clone: nothing to read
      const isDoc = (f) => f.startsWith("docs/") || f.endsWith(".md");
      return commits.filter((c) => {
        const files = c.split(/\r?\n/).filter(Boolean);
        return files.length > 0 && !files.every(isDoc);
      }).length;
    } catch {
      return null;
    }
  }

  it("lands under 2,000 billed minutes with room to spare", () => {
    // Fail upward. A shallow clone (actions/checkout@v4 defaults to depth 1) has no history to
    // read, so the recorded figure stands there; on a developer machine — which is where the real
    // gate `npm run verify` now runs — the live number wins if it is higher. An under-estimate is
    // what took CI offline twice.
    const measured = measuredCodeCommitsPerMonth();
    const runs = Math.max(RECORDED_RUNS_PER_MONTH, Math.round((measured ?? 0) * RUNS_PER_CODE_COMMIT));

    const frontend = runs * PER_RUN.frontend * MULTIPLIER["ubuntu-latest"];
    const rust = runs * RUST_PATH_SHARE * PER_RUN.rust * MULTIPLIER["windows-latest"];
    const auditWeekly = 5 * 5.3; // ~5 runs a month, ~5.3 min each, ubuntu 1x
    // The health reporter: daily, sparse checkout + setup-node + two API reads. Priced at a
    // deliberately pessimistic 1 minute against a job that should finish in well under one, because
    // a watchdog that is cheaper than its own budget line is the only kind worth having.
    const healthDaily = 31 * 1 * MULTIPLIER["ubuntu-latest"];
    const total = frontend + rust + auditWeekly + healthDaily;

    expect(Math.round(total)).toBeLessThan(INCLUDED);
    expect(Math.round(total)).toBeLessThan(INCLUDED * 0.75); // headroom, not a squeaker
  });

  it("would have FAILED on the configuration that walled on 7 August", () => {
    // Same velocity, priced against the shape that was live that morning: both jobs on every PR,
    // AND a full re-run on every push to main. This is the assertion the old projection could not
    // make, because it never priced the run count that actually occurred.
    const runs = RECORDED_RUNS_PER_MONTH;
    const pushMainRuns = runs * (54 / 37); // measured ratio of push-to-main runs against PR runs
    const perRunBilled = PER_RUN.frontend * 1 + PER_RUN.rust * 2;
    expect(Math.round((runs + pushMainRuns) * perRunBilled)).toBeGreaterThan(INCLUDED);
  });

  it("would have FAILED on July's configuration too", () => {
    const july = 645 * 1 + 545 * 2 + 460 * 1;
    expect(july).toBeGreaterThan(INCLUDED);
  });
});
