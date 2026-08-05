// CI health reporter — main cannot sit red unnoticed.
//
// Why this exists: main's CI was red for two days and nobody knew. Three Linux-only failures landed
// on the trunk and stayed there, because the only thing that ever looks at a run's conclusion is a
// human who happens to open the Actions tab. That is not a gate; it is a habit, and habits skip days.
// Before that it was worse — the billed-minutes allowance ran out and CI was DEAD for 22 days while
// showing red X's no test had produced. A dead gate that LOOKS like a failing gate is worse than an
// absent one.
//
// So a scheduled job reads CI's own conclusions on main and files an issue when the trunk is broken,
// then closes it when the trunk recovers. It notices on a day when nobody starts a session, which is
// precisely the failure mode. Branch protection would ALSO fix this and is stronger — it stops the
// merge instead of reporting it — but repo settings belong to the owner, so this is the half that
// can live in the repo.
//
// THE HONESTY RULE, inherited from the Trust Ledger work and load-bearing here. Three states, never
// two: RED, GREEN, and UNKNOWN. A read that failed is not a green trunk — and it is not an alarm
// either. Manufacturing a warning out of an unreadable world is the same sin as manufacturing
// reassurance, mirrored. UNKNOWN touches no issue at all and exits non-zero, so the reporter's own
// failure surfaces as the reporter's failure rather than as a verdict about main.
//
// The workflow's own red/green therefore means exactly one thing: whether the REPORTER could do its
// job. A red main is reported through the issue, not by failing this workflow, or the two signals
// would be indistinguishable in the Actions tab.

import { pathToFileURL } from "node:url";

/** The workflow whose conclusions define "main is green". Not "Deploy site", not the audit. */
export const WORKFLOW_FILE = "ci.yml";

/** Fixed title, so the report is findable by a human as well as by the marker. */
export const ISSUE_TITLE = "CI on `main` is red";

/** Machine handle for the open report. Carries the run id, which is how "new information" is judged. */
export const MARKER_PREFIX = "<!-- ci-health-report";

// A conclusion is DECISIVE when it is a statement about the code. `cancelled` and `skipped` say
// nothing (someone pushed again, concurrency killed it); `action_required` and `stale` say something
// about the queue, not the trunk; `neutral` is by definition non-committal. Walking past those is
// not optimism — it is refusing to read silence as either answer.
export const DECISIVE = new Set(["success", "failure", "timed_out", "startup_failure"]);

/** Only `success` is green. Everything else decisive is red — including infrastructure failures,
 * because "CI could not run" is exactly the 22-day outage this guard exists to catch. */
const isGreen = (conclusion) => conclusion === "success";

const short = (sha) => (typeof sha === "string" ? sha.slice(0, 7) : "unknown");

/**
 * Decide what the trunk's CI is saying, from completed runs alone.
 *
 * @param {object} input
 * @param {Array}  input.runs     workflow runs, any order; only completed ones are read
 * @param {string} [input.headSha] main's current HEAD, if known. `null`/absent stays UNKNOWN-shaped
 *                                 rather than being guessed at.
 * @param {Date}   input.now
 */
export function assess({ runs, headSha = null, now }) {
  const decisive = (Array.isArray(runs) ? runs : [])
    .filter((r) => r && r.status === "completed" && DECISIVE.has(r.conclusion))
    .map((r) => ({ ...r, at: new Date(r.created_at) }))
    .filter((r) => !Number.isNaN(r.at.getTime()))
    .sort((a, b) => b.at - a.at);

  if (decisive.length === 0) {
    // No decisive run in the window. That covers a genuinely quiet trunk, a docs-only stretch that
    // paths-ignore skipped, an exhausted minutes allowance, and a broken API read — and this
    // function cannot tell those apart, so it does not pretend to.
    return {
      state: "UNKNOWN",
      reason:
        "no completed CI run on `main` with a decisive conclusion was found in the window queried",
      newest: null,
      headSha,
      headTested: null,
    };
  }

  const newest = decisive[0];
  const ageHours = (now.getTime() - newest.at.getTime()) / 3_600_000;

  // Staleness is a FACT, never a verdict: docs-only pushes legitimately skip CI (paths-ignore on
  // both triggers), so an untested HEAD is normal and must not flip the state. `null` when HEAD is
  // unknown — the third state applies to this field too.
  const headTested = headSha ? newest.head_sha === headSha : null;

  const base = { newest, ageHours, headSha, headTested };

  if (isGreen(newest.conclusion)) return { state: "GREEN", ...base };

  // How long has it been broken? Walk back through consecutive non-successes. The oldest one is
  // when the trunk broke — reporting the newest run's time instead would make a two-day outage read
  // as minutes old, which is the exact misreading this guard exists to prevent.
  let oldestRed = newest;
  let redRuns = 0;
  let boundedBySearch = true;
  for (const run of decisive) {
    if (isGreen(run.conclusion)) {
      boundedBySearch = false; // we found the green it broke from, so `since` is exact
      break;
    }
    oldestRed = run;
    redRuns += 1;
  }

  return {
    state: "RED",
    ...base,
    since: oldestRed.at.toISOString(),
    sinceRun: oldestRed,
    redRuns,
    // true = we ran out of runs before finding a green one, so the trunk has been red AT LEAST this
    // long. "At least" is a weaker sentence than "since", and it gets printed as the weaker one.
    sinceIsLowerBound: boundedBySearch,
    redHours: (now.getTime() - oldestRed.at.getTime()) / 3_600_000,
  };
}

const hours = (h) => (h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`);

/** The issue body. Carries the marker, so the next run can find this report and judge novelty. */
export function renderIssueBody(verdict, { repo = "Pootytxng/sentinel" } = {}) {
  if (verdict.state !== "RED") throw new Error(`renderIssueBody expects RED, got ${verdict.state}`);
  const { newest, since, sinceIsLowerBound, redRuns, redHours, headSha, headTested } = verdict;
  const runUrl = `https://github.com/${repo}/actions/runs/${newest.id}`;

  const staleness =
    headTested === null
      ? "- `main`'s HEAD could not be read, so whether the newest run covers it is **unknown**."
      : headTested
        ? `- The newest run covers \`main\`'s current HEAD (\`${short(headSha)}\`).`
        : `- \`main\`'s HEAD is \`${short(headSha)}\`; the newest run tested \`${short(newest.head_sha)}\`. ` +
          "Docs-only pushes skip CI by design (`paths-ignore`), so this alone is not a fault — but the " +
          "conclusion above describes the tested commit, not HEAD.";

  return [
    `${MARKER_PREFIX} run:${newest.id} sha:${short(newest.head_sha)} -->`,
    "",
    "**CI on `main` is not passing.** Filed automatically by",
    "[`scripts/ci-health-report.mjs`](../blob/main/scripts/ci-health-report.mjs), which runs on a",
    "schedule so a broken trunk cannot wait for someone to open the Actions tab.",
    "",
    `- Newest decisive run: [\`${newest.conclusion}\`](${runUrl}) on \`${short(newest.head_sha)}\`, ${hours(verdict.ageHours)} ago.`,
    `- Red ${sinceIsLowerBound ? "for at least" : "since"} **${hours(redHours)}** (${since}), across ${redRuns} consecutive run${redRuns === 1 ? "" : "s"}.`,
    staleness,
    "",
    "### What this issue is and is not",
    "",
    "It is a notification, not a diagnosis — it reads conclusions, never logs, and it does not know",
    "which test failed. Open the run to find that out.",
    "",
    "It closes itself the moment a run on `main` concludes `success`. If you fix the trunk, do not",
    "close this by hand; let the next scheduled run close it, and the closing comment becomes the",
    "receipt that the fix worked.",
    "",
    "If the reporter itself cannot read CI's conclusions, it files **nothing** and fails its own",
    "workflow instead. So this issue existing means a real red run was read — silence from it means",
    "either a green trunk or a broken reporter, and those are told apart in the Actions tab.",
  ].join("\n");
}

/** Pull the run id out of an existing report body, to judge whether there is new information. */
export function markerRunId(body) {
  const m = /<!--\s*ci-health-report\s+run:(\d+)/.exec(String(body ?? ""));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------------------------
// I/O below this line. Everything above is pure, because the judgment is the part worth pinning.
// ---------------------------------------------------------------------------------------------

const api = async (path, { token, method = "GET", body } = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "compy-ci-health-report",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${method} ${path} → ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
};

/** The open report, if one exists. Found by marker, not by label — no label to create or drift. */
async function findOpenReport({ repo, token }) {
  const issues = await api(`/repos/${repo}/issues?state=open&per_page=100`, { token });
  return issues.find((i) => !i.pull_request && String(i.body ?? "").includes(MARKER_PREFIX)) ?? null;
}

export async function main(argv = []) {
  const dryRun = argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY || "Pootytxng/sentinel";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  const branch = process.env.CI_HEALTH_BRANCH || "main";

  if (!token && !dryRun) {
    console.error("ci-health-report: no GITHUB_TOKEN. Refusing to guess at the world unauthenticated.");
    return 1;
  }

  const runsPath =
    `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs` +
    `?branch=${encodeURIComponent(branch)}&event=push&status=completed&per_page=30`;
  const { workflow_runs: runs = [] } = await api(runsPath, { token });

  // GITHUB_SHA on a scheduled run is the default branch's head at trigger time — free, and exactly
  // the commit we want. Absent (local --dry-run), HEAD stays unknown rather than being invented.
  const headSha = process.env.GITHUB_SHA || null;
  const verdict = assess({ runs, headSha, now: new Date() });

  if (verdict.state === "UNKNOWN") {
    // The one branch that must not write. An unreadable world gets reported as unreadable, to the
    // Actions tab, by this workflow failing — never to `main`'s users as a verdict.
    console.error(`ci-health-report: UNKNOWN — ${verdict.reason}.`);
    console.error("  No issue was opened, updated, or closed. Nothing is being claimed about `main`.");
    return 1;
  }

  const existing = dryRun ? null : await findOpenReport({ repo, token });

  if (verdict.state === "GREEN") {
    console.log(
      `ci-health-report: GREEN — run ${verdict.newest.id} on ${short(verdict.newest.head_sha)}, ${hours(verdict.ageHours)} ago.`,
    );
    if (!existing) return 0;
    const url = `https://github.com/${repo}/actions/runs/${verdict.newest.id}`;
    await api(`/repos/${repo}/issues/${existing.number}/comments`, {
      token,
      method: "POST",
      body: {
        body:
          `**Recovered.** [Run ${verdict.newest.id}](${url}) concluded \`success\` on ` +
          `\`${short(verdict.newest.head_sha)}\`. Closing — the trunk reports its own recovery, so ` +
          "this line is a receipt rather than a claim.",
      },
    });
    await api(`/repos/${repo}/issues/${existing.number}`, {
      token,
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
    });
    console.log(`  closed #${existing.number}.`);
    return 0;
  }

  const body = renderIssueBody(verdict, { repo });
  console.log(
    `ci-health-report: RED — ${verdict.redRuns} consecutive non-success run(s), ` +
      `${verdict.sinceIsLowerBound ? "at least " : ""}${hours(verdict.redHours)}.`,
  );

  if (dryRun) {
    console.log("--- issue body (dry run, nothing written) ---");
    console.log(body);
    return 0;
  }

  if (!existing) {
    const created = await api(`/repos/${repo}/issues`, {
      token,
      method: "POST",
      body: { title: ISSUE_TITLE, body },
    });
    console.log(`  opened #${created.number}.`);
    return 0;
  }

  // Refresh the body every run, so the age and the run link never rot. Comment only when the newest
  // red run has actually changed — a daily "still red" comment trains the owner to mute the thread,
  // and a muted alarm is the same as no alarm.
  await api(`/repos/${repo}/issues/${existing.number}`, { token, method: "PATCH", body: { body } });
  const known = markerRunId(existing.body);
  if (known === String(verdict.newest.id)) {
    console.log(`  refreshed #${existing.number}; no new run since ${known}, so no comment.`);
    return 0;
  }
  const url = `https://github.com/${repo}/actions/runs/${verdict.newest.id}`;
  await api(`/repos/${repo}/issues/${existing.number}/comments`, {
    token,
    method: "POST",
    body: {
      body:
        `Still red, and there is new information: [run ${verdict.newest.id}](${url}) concluded ` +
        `\`${verdict.newest.conclusion}\` on \`${short(verdict.newest.head_sha)}\`. ` +
        `Red ${verdict.sinceIsLowerBound ? "for at least" : "for"} ${hours(verdict.redHours)}.`,
    },
  });
  console.log(`  refreshed #${existing.number} and commented on run ${verdict.newest.id}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
