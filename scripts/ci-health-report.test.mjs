// Guard: the CI health reporter must not lie about the trunk, in either direction.
//
// bug->guard for the last unticked criterion of issue #68 ("main cannot sit red for two days again
// unnoticed"). The reporter is itself a claim-making surface, so it gets the same treatment as every
// other one in this repo: the judgment is a pure function, and the pins below are written so that
// removing a protection turns them RED rather than merely describing today's behaviour.
//
// Two failure modes are pinned with equal weight, because they are the same defect mirrored:
//   - reading an unreadable world as GREEN   — the trunk stays broken and nobody is told;
//   - reading an unreadable world as RED     — a fabricated alarm, which trains the owner to mute
//                                              the thread, after which a REAL alarm is invisible.
// UNKNOWN is the third state that makes both impossible, and the write-path pins prove it stays
// silent rather than merely being labelled.

import { afterEach, describe, expect, it, vi } from "vitest";
import { assess, main, markerRunId, renderIssueBody, DECISIVE } from "./ci-health-report.mjs";

const NOW = new Date("2026-08-05T15:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const run = (over = {}) => ({
  id: 1,
  status: "completed",
  conclusion: "success",
  head_sha: "a".repeat(40),
  created_at: hoursAgo(1),
  ...over,
});

describe("a decisive conclusion decides, and nothing else does", () => {
  it("reads the newest success as GREEN", () => {
    const v = assess({ runs: [run({ id: 9, created_at: hoursAgo(1) })], now: NOW });
    expect(v.state).toBe("GREEN");
    expect(v.newest.id).toBe(9);
  });

  it("reads the newest failure as RED", () => {
    expect(assess({ runs: [run({ conclusion: "failure" })], now: NOW }).state).toBe("RED");
  });

  it("counts timed_out and startup_failure as red — 'CI could not run' is the 22-day outage", () => {
    for (const conclusion of ["timed_out", "startup_failure"]) {
      expect(assess({ runs: [run({ conclusion })], now: NOW }).state).toBe("RED");
    }
    // and the set is exactly the four that say something about the code
    expect([...DECISIVE].sort()).toEqual(["failure", "startup_failure", "success", "timed_out"]);
  });

  it("walks PAST a cancelled run to the failure beneath it", () => {
    // The regression this stops: someone pushes twice, concurrency cancels the first run, and a
    // reporter that reads the newest run of ANY kind sees `cancelled` and says nothing.
    const v = assess({
      runs: [
        run({ id: 3, conclusion: "cancelled", created_at: hoursAgo(1) }),
        run({ id: 2, conclusion: "failure", created_at: hoursAgo(4) }),
      ],
      now: NOW,
    });
    expect(v.state).toBe("RED");
    expect(v.newest.id).toBe(2);
  });

  it("ignores runs that have not finished", () => {
    const v = assess({
      runs: [
        run({ id: 3, status: "in_progress", conclusion: null, created_at: hoursAgo(1) }),
        run({ id: 2, conclusion: "failure", created_at: hoursAgo(4) }),
      ],
      now: NOW,
    });
    expect(v.newest.id).toBe(2);
  });

  it("sorts by time rather than trusting the order the API happened to return", () => {
    const v = assess({
      runs: [
        run({ id: 1, conclusion: "failure", created_at: hoursAgo(9) }),
        run({ id: 2, conclusion: "success", created_at: hoursAgo(2) }),
      ],
      now: NOW,
    });
    expect(v.state).toBe("GREEN");
  });

  it("discards a run whose timestamp cannot be parsed instead of sorting it to the top", () => {
    const v = assess({
      runs: [
        run({ id: 3, conclusion: "failure", created_at: "not-a-date" }),
        run({ id: 2, conclusion: "success", created_at: hoursAgo(2) }),
      ],
      now: NOW,
    });
    expect(v.state).toBe("GREEN");
  });
});

describe("UNKNOWN — the state that makes both lies impossible", () => {
  it("is UNKNOWN, not GREEN, when there is nothing decisive to read", () => {
    expect(assess({ runs: [], now: NOW }).state).toBe("UNKNOWN");
  });

  it("is UNKNOWN, not RED, when every run in the window is indecisive", () => {
    const v = assess({
      runs: [run({ conclusion: "cancelled" }), run({ conclusion: "skipped" }), run({ conclusion: null })],
      now: NOW,
    });
    expect(v.state).toBe("UNKNOWN");
    expect(v.newest).toBeNull();
  });

  it("says why, so the failing workflow is actionable rather than just red", () => {
    expect(assess({ runs: [], now: NOW }).reason).toMatch(/decisive/);
  });
});

describe("'red since' is how long the trunk has been broken, not when the last run finished", () => {
  it("reports the OLDEST consecutive failure — a two-day outage must not read as an hour old", () => {
    const v = assess({
      runs: [
        run({ id: 4, conclusion: "failure", created_at: hoursAgo(1) }),
        run({ id: 3, conclusion: "failure", created_at: hoursAgo(30) }),
        run({ id: 2, conclusion: "failure", created_at: hoursAgo(50) }),
        run({ id: 1, conclusion: "success", created_at: hoursAgo(70) }),
      ],
      now: NOW,
    });
    expect(v.since).toBe(hoursAgo(50));
    expect(v.redRuns).toBe(3);
    expect(Math.round(v.redHours)).toBe(50);
    expect(v.sinceIsLowerBound).toBe(false); // the green it broke from is in the window, so exact
  });

  it("marks the answer a LOWER BOUND when the window holds no green to have broken from", () => {
    const v = assess({
      runs: [
        run({ id: 2, conclusion: "failure", created_at: hoursAgo(1) }),
        run({ id: 1, conclusion: "failure", created_at: hoursAgo(20) }),
      ],
      now: NOW,
    });
    expect(v.sinceIsLowerBound).toBe(true);
  });

  it("stops at the first green rather than counting an older, already-fixed outage", () => {
    const v = assess({
      runs: [
        run({ id: 3, conclusion: "failure", created_at: hoursAgo(1) }),
        run({ id: 2, conclusion: "success", created_at: hoursAgo(5) }),
        run({ id: 1, conclusion: "failure", created_at: hoursAgo(90) }),
      ],
      now: NOW,
    });
    expect(v.redRuns).toBe(1);
    expect(Math.round(v.redHours)).toBe(1);
  });
});

describe("staleness is a fact about coverage, never a verdict about the trunk", () => {
  const sha = "b".repeat(40);

  it("is null — not false — when HEAD is unknown", () => {
    expect(assess({ runs: [run()], now: NOW }).headTested).toBeNull();
  });

  it("is true when the newest run covers HEAD", () => {
    expect(assess({ runs: [run({ head_sha: sha })], headSha: sha, now: NOW }).headTested).toBe(true);
  });

  it("is false on an untested HEAD but does NOT flip a green trunk red", () => {
    // paths-ignore means a docs-only push legitimately has no run. Treating that as a failure would
    // make the reporter cry wolf on every documentation commit.
    const v = assess({ runs: [run({ head_sha: "c".repeat(40) })], headSha: sha, now: NOW });
    expect(v.headTested).toBe(false);
    expect(v.state).toBe("GREEN");
  });
});

describe("the issue body", () => {
  const red = () =>
    assess({
      runs: [
        run({ id: 777, conclusion: "failure", created_at: hoursAgo(2) }),
        run({ id: 776, conclusion: "failure", created_at: hoursAgo(49) }),
        run({ id: 775, conclusion: "success", created_at: hoursAgo(80) }),
      ],
      headSha: "d".repeat(40),
      now: NOW,
    });

  it("round-trips its run id through the marker, which is how novelty is judged", () => {
    expect(markerRunId(renderIssueBody(red()))).toBe("777");
  });

  it("returns null for a body with no marker instead of throwing", () => {
    expect(markerRunId("some unrelated issue")).toBeNull();
    expect(markerRunId(null)).toBeNull();
  });

  it("refuses to render a red report out of a green verdict", () => {
    expect(() => renderIssueBody(assess({ runs: [run()], now: NOW }))).toThrow(/RED/);
  });

  it("says 'at least' only when the answer really is a lower bound", () => {
    expect(renderIssueBody(red())).toMatch(/Red since/);
    const bounded = assess({
      runs: [run({ id: 5, conclusion: "failure", created_at: hoursAgo(3) })],
      now: NOW,
    });
    expect(renderIssueBody(bounded)).toMatch(/Red for at least/);
  });

  it("names the untested HEAD as expected rather than as a fault", () => {
    expect(renderIssueBody(red())).toMatch(/paths-ignore.*not a fault/s);
  });
});

// ---------------------------------------------------------------------------------------------
// The write path. These are the pins that matter most: a state is only honest if it also stays
// silent, and "it does not write" is not something a label can promise.
// ---------------------------------------------------------------------------------------------

const ORIGINAL = { fetch: globalThis.fetch, env: { ...process.env } };

afterEach(() => {
  globalThis.fetch = ORIGINAL.fetch;
  process.env = { ...ORIGINAL.env };
});

/** Stub GitHub. Records every call; returns `runs` for the runs read and `issues` for the list. */
function stubGitHub({ runs = [], issues = [] } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
    const path = String(url);
    const json = path.includes("/actions/workflows/")
      ? { workflow_runs: runs }
      : path.includes("/issues?")
        ? issues
        : { number: 123 };
    return { ok: true, status: 200, statusText: "OK", json: async () => json, text: async () => "" };
  });
  return {
    calls,
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}

const withEnv = () => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPOSITORY = "Pootytxng/sentinel";
  delete process.env.GITHUB_SHA;
};

const report = (over) => ({
  number: 42,
  body: `<!-- ci-health-report run:100 sha:aaaaaaa -->\nold body`,
  pull_request: undefined,
  ...over,
});

describe("UNKNOWN writes nothing at all", () => {
  it("opens no issue, updates none, closes none — and fails its own workflow instead", async () => {
    withEnv();
    const gh = stubGitHub({ runs: [run({ conclusion: "cancelled" })] });
    expect(await main([])).toBe(1);
    expect(gh.writes()).toEqual([]);
  });

  it("refuses to read the world unauthenticated rather than reporting on a guess", async () => {
    withEnv();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    const gh = stubGitHub({ runs: [run({ conclusion: "failure" })] });
    expect(await main([])).toBe(1);
    expect(gh.calls).toEqual([]);
  });
});

describe("RED files exactly one issue and then stops shouting", () => {
  it("opens a report when none is open", async () => {
    withEnv();
    const gh = stubGitHub({ runs: [run({ id: 500, conclusion: "failure" })] });
    expect(await main([])).toBe(0);
    const posts = gh.writes();
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
    expect(posts[0].url).toMatch(/\/issues$/);
    expect(markerRunId(posts[0].body.body)).toBe("500");
  });

  it("refreshes the open report but does NOT comment when there is no new run", async () => {
    // A daily "still red" comment is how an alarm gets muted, and a muted alarm is no alarm.
    withEnv();
    const gh = stubGitHub({ runs: [run({ id: 100, conclusion: "failure" })], issues: [report()] });
    expect(await main([])).toBe(0);
    const writes = gh.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("PATCH");
    expect(writes.some((w) => w.url.endsWith("/comments"))).toBe(false);
  });

  it("comments when the newest red run has changed, because that is new information", async () => {
    withEnv();
    const gh = stubGitHub({ runs: [run({ id: 101, conclusion: "failure" })], issues: [report()] });
    expect(await main([])).toBe(0);
    const writes = gh.writes();
    expect(writes.map((w) => w.method)).toEqual(["PATCH", "POST"]);
    expect(writes[1].url).toMatch(/\/comments$/);
  });

  it("ignores an open PULL REQUEST that happens to quote the marker", async () => {
    withEnv();
    const gh = stubGitHub({
      runs: [run({ id: 500, conclusion: "failure" })],
      issues: [report({ number: 71, pull_request: { url: "..." } })],
    });
    expect(await main([])).toBe(0);
    // ...so it opens a fresh report rather than editing the pull request's description
    expect(gh.writes()[0].url).toMatch(/\/issues$/);
  });
});

describe("GREEN closes the report, and says nothing when there is nothing to close", () => {
  it("comments the recovery and closes", async () => {
    withEnv();
    const gh = stubGitHub({ runs: [run({ id: 900 })], issues: [report()] });
    expect(await main([])).toBe(0);
    const writes = gh.writes();
    expect(writes.map((w) => w.method)).toEqual(["POST", "PATCH"]);
    expect(writes[0].url).toMatch(/\/comments$/);
    expect(writes[1].body).toEqual({ state: "closed", state_reason: "completed" });
  });

  it("writes nothing when the trunk is green and no report is open", async () => {
    withEnv();
    const gh = stubGitHub({ runs: [run({ id: 900 })], issues: [] });
    expect(await main([])).toBe(0);
    expect(gh.writes()).toEqual([]);
  });
});

describe("it reads the right workflow on the right branch", () => {
  it("queries CI's own runs on main, not 'Deploy site' and not pull-request runs", async () => {
    // Precedent: a green "Deploy site" run was once nearly reported as main's CI being green.
    withEnv();
    const gh = stubGitHub({ runs: [run()] });
    await main([]);
    expect(gh.calls[0].url).toContain("/actions/workflows/ci.yml/runs");
    expect(gh.calls[0].url).toContain("branch=main");
    expect(gh.calls[0].url).toContain("event=push");
    expect(gh.calls[0].url).toContain("status=completed");
  });
});
