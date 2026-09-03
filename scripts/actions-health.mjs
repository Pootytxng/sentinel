// Actions health — is remote GitHub execution actually AVAILABLE, or only reporting?
//
// WHY THIS EXISTS: on 2026-08-31 the weekly "Dependency audit" workflow run 33405544287 concluded
// `success`. Its only job concluded `failure` with ZERO steps — the runner was refused before it
// started, and `continue-on-error: true` turned that refusal into a green check mark. Read at the
// run level, that green said "CI ran and passed". docs/RELEASE_STATE.md meanwhile said hosted CI was
// "settled OFF by owner preference" — also the wrong sentence: the account is not choosing to skip
// work, GitHub is refusing to execute it (every job since ~2026-08-07 is rejected before runner
// startup, #321). The truthful statement has three parts, and this script exists so none of them
// has to be guessed at by a doc editor:
//
//   1. remote GitHub execution is currently UNAVAILABLE;
//   2. the local gate (`scripts/verify-local.ps1` via `.githooks/pre-push`) is the proof authority;
//   3. a green workflow status is NOT evidence that its job ran.
//
// Findings, each a hard failure:
//   HOLLOW-JOB           a completed job with 0 steps — nothing executed, whatever it concluded
//   NO-JOBS              a completed run that has no jobs at all
//   GREEN-OVER-FAILURE   a run concluded `success` while one of its jobs concluded `failure`
//
// RESIDENCY: deliberately NOT in `npm test`. It talks to api.github.com and its answer changes when
// GitHub's billing state changes, not when a commit does — resident, it would fail the offline gate
// for reasons no commit caused. It runs on demand (`node scripts/actions-health.mjs`) and weekly as
// the second action of the CompyUsageAudit scheduled task (`--report` writes
// docs/usage-audit/ACTIONS-HEALTH.md, gitignored like the usage report beside it). The judgment is a
// pure function so scripts/actions-health.test.mjs can prove every finding without the network.
//
// Exit codes: 0 AVAILABLE · 1 UNAVAILABLE or MASKED · 2 UNKNOWN (nothing examined, or the API could
// not be asked). UNKNOWN is never folded into either answer — the same third state
// scripts/ci-health-report.mjs uses, for the same reason: an unreadable world read as green hides a
// real failure, and read as red trains the reader to ignore the next one.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = "Pootytxng/sentinel";
export const REPORT_REL = join("docs", "usage-audit", "ACTIONS-HEALTH.md");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `gh api <path>` parsed — gh carries the auth this machine already has; no token plumbing. */
export function ghApi(path) {
  const out = execFileSync("gh", ["api", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return JSON.parse(out);
}

/** The runs to judge, each paired with its jobs. `api` is injectable so the tests never go online. */
export function gather({ repo = REPO, limit = 10, api = ghApi } = {}) {
  const runs = api(`repos/${repo}/actions/runs?per_page=${limit}`)?.workflow_runs ?? [];
  return runs.map((run) => ({
    run,
    jobs: api(`repos/${repo}/actions/runs/${run.id}/jobs`)?.jobs ?? [],
  }));
}

/**
 * One run, judged. Only COMPLETED jobs are examined: a queued job legitimately has no steps yet,
 * and calling it hollow would make the detector cry wolf on every in-flight run.
 */
export function assessRun({ run, jobs }) {
  const findings = [];
  const completed = run.status === "completed";
  if (completed && jobs.length === 0) {
    findings.push({
      code: "NO-JOBS",
      runId: run.id,
      workflow: run.name,
      job: null,
      detail: `run ${run.id} (${run.name}) completed "${run.conclusion}" with no jobs at all`,
    });
  }
  for (const job of jobs) {
    if (job.status !== "completed") continue;
    const steps = Array.isArray(job.steps) ? job.steps.length : 0;
    // A `skipped` job (its `if:` was false, or a job it `needs:` failed) never runs steps by design —
    // the first live run flagged deploy-site's "Stage + deploy" job as hollow when it was only ever
    // waiting on the credential probe ahead of it. Refusal shows up on the job that was MEANT to run.
    if (steps === 0 && job.conclusion !== "skipped") {
      findings.push({
        code: "HOLLOW-JOB",
        runId: run.id,
        workflow: run.name,
        job: job.name,
        detail: `job "${job.name}" concluded "${job.conclusion}" with 0 steps — nothing executed`,
      });
    }
    if (run.conclusion === "success" && job.conclusion === "failure") {
      findings.push({
        code: "GREEN-OVER-FAILURE",
        runId: run.id,
        workflow: run.name,
        job: job.name,
        detail: `run concluded "success" while job "${job.name}" concluded "failure"`,
      });
    }
  }
  return {
    id: run.id,
    workflow: run.name,
    event: run.event,
    createdAt: run.created_at,
    headSha: String(run.head_sha ?? "").slice(0, 8),
    status: run.status,
    conclusion: run.conclusion,
    jobs: jobs.length,
    findings,
  };
}

/**
 * The verdict over every examined run.
 *   UNAVAILABLE  any HOLLOW-JOB / NO-JOBS — GitHub is not executing this repo's jobs
 *   MASKED       no hollow jobs, but a green run is covering a failed one
 *   AVAILABLE    every completed job ran steps and no green run hides a failure
 *   UNKNOWN      nothing completed was examined — nothing can be said either way
 */
export function assess(examined) {
  const runs = examined.map(assessRun).filter((r) => r.status === "completed");
  const findings = runs.flatMap((r) => r.findings);
  if (runs.length === 0) {
    return {
      verdict: "UNKNOWN",
      summary: "no completed workflow runs examined — nothing can be said about remote execution either way",
      runs,
      findings,
    };
  }
  const hollow = runs.filter((r) => r.findings.some((f) => f.code === "HOLLOW-JOB" || f.code === "NO-JOBS"));
  const masked = runs.filter((r) => r.findings.some((f) => f.code === "GREEN-OVER-FAILURE"));
  if (hollow.length) {
    return {
      verdict: "UNAVAILABLE",
      summary:
        `remote GitHub execution currently unavailable: ${hollow.length} of ${runs.length} examined runs ` +
        `completed with a job that ran 0 steps` +
        (masked.length ? `, and ${masked.length} of them report "success" over a failed job` : ""),
      runs,
      findings,
    };
  }
  if (masked.length) {
    return {
      verdict: "MASKED",
      summary: `${masked.length} of ${runs.length} examined runs report "success" while a job inside failed — the run status is lying`,
      runs,
      findings,
    };
  }
  return {
    verdict: "AVAILABLE",
    summary: `all ${runs.length} examined runs executed their jobs and no green run hides a failure`,
    runs,
    findings,
  };
}

export const EXIT = { AVAILABLE: 0, UNAVAILABLE: 1, MASKED: 1, UNKNOWN: 2 };

export const READING =
  "Reading: the local gate (`scripts/verify-local.ps1` via `.githooks/pre-push`) is the proof authority; " +
  "a green workflow status here is not evidence its job ran.";

export function renderReport(assessment, { now = new Date(), repo = REPO } = {}) {
  const lines = [
    `# Actions health — ${repo}`,
    "",
    `Measured ${now.toISOString()}. Verdict: **${assessment.verdict}** — ${assessment.summary}.`,
    "",
    READING,
    "",
    "| Run | Workflow | Event | Head | Run says | Jobs | Findings |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of assessment.runs) {
    const f = r.findings.length ? r.findings.map((x) => `${x.code}: ${x.detail}`).join("<br>") : "—";
    lines.push(`| ${r.id} | ${r.workflow} | ${r.event} | \`${r.headSha}\` | ${r.conclusion} | ${r.jobs} | ${f} |`);
  }
  lines.push("", `Written by \`scripts/actions-health.mjs\`; re-run on demand: \`node scripts/actions-health.mjs\`.`, "");
  return lines.join("\n");
}

function parseArgs(argv) {
  const opts = { report: false, json: false, limit: 10, repo: REPO };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--report") opts.report = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--limit") opts.limit = Math.max(1, Number(argv[++i]) || 10);
    else if (a === "--repo") opts.repo = argv[++i] || REPO;
  }
  return opts;
}

/** The whole program, with every side effect injectable so the test can run it end to end offline. */
export function run({
  argv = [],
  api = ghApi,
  now = new Date(),
  write = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
  log = (s) => process.stdout.write(`${s}\n`),
  root = ROOT,
} = {}) {
  const opts = parseArgs(argv);
  let assessment;
  try {
    assessment = assess(gather({ repo: opts.repo, limit: opts.limit, api }));
  } catch (err) {
    assessment = {
      verdict: "UNKNOWN",
      summary: `api.github.com could not be asked (${String(err?.message ?? err).split("\n")[0]})`,
      runs: [],
      findings: [],
    };
  }
  const reportPath = join(root, REPORT_REL);
  if (opts.report) write(reportPath, renderReport(assessment, { now, repo: opts.repo }));
  if (opts.json) log(JSON.stringify({ ...assessment, measuredAt: now.toISOString() }, null, 2));
  else {
    log(`actions-health: ${assessment.verdict} — ${assessment.summary}`);
    for (const f of assessment.findings) log(`  ${f.code.padEnd(18)} run ${f.runId} (${f.workflow}): ${f.detail}`);
    log(`  ${READING}`);
    if (opts.report) log(`  report: ${reportPath}`);
  }
  return { assessment, code: EXIT[assessment.verdict] ?? 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run({ argv: process.argv.slice(2) }).code;
}
