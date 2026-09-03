// Guard: a green GitHub Actions status must never be read as evidence that a job ran.
//
// bug->guard for the 2026-08-31 "Dependency audit" run 33405544287: run `success`, its only job
// `failure` with 0 steps, and docs/RELEASE_STATE.md reading the whole situation as "hosted CI settled
// off by owner preference". The detector's judgment is a pure function; every pin below is written so
// that deleting one finding turns a test RED rather than merely describing today's output. Nothing
// here touches the network: `api` and `write` are injected end to end.

import { describe, expect, it } from "vitest";
import { EXIT, READING, REPORT_REL, assess, assessRun, gather, renderReport, run } from "./actions-health.mjs";

const NOW = new Date("2026-09-02T12:00:00Z");

// The real shape, copied from `gh api repos/Pootytxng/sentinel/actions/runs/33405544287/jobs` on
// 2026-09-02 — the incident itself, not an invented approximation of it.
const hollowRun = () => ({
  run: {
    id: 33405544287,
    name: "Dependency audit",
    event: "schedule",
    status: "completed",
    conclusion: "success",
    head_sha: "e97cfc75aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    created_at: "2026-08-31T14:56:21Z",
  },
  jobs: [{ id: 99532101573, name: "Dependency audit (informational)", status: "completed", conclusion: "failure", steps: [] }],
});

const step = (n) => ({ name: `step ${n}`, status: "completed", conclusion: "success" });

const realRun = ({ id = 1, conclusion = "success", jobs } = {}) => ({
  run: { id, name: "CI", event: "push", status: "completed", conclusion, head_sha: "b".repeat(40), created_at: "2026-09-01T00:00:00Z" },
  jobs: jobs ?? [{ id: 10, name: "test", status: "completed", conclusion, steps: [step(1), step(2)] }],
});

describe("assessRun — the three findings", () => {
  it("flags the 2026-08-31 incident as HOLLOW-JOB and GREEN-OVER-FAILURE at once", () => {
    const r = assessRun(hollowRun());
    expect(r.findings.map((f) => f.code).sort()).toEqual(["GREEN-OVER-FAILURE", "HOLLOW-JOB"]);
    expect(r.findings.find((f) => f.code === "HOLLOW-JOB").detail).toMatch(/0 steps/);
    expect(r.headSha).toBe("e97cfc75");
  });

  it("flags a completed run with no jobs at all as NO-JOBS", () => {
    const r = assessRun({ ...realRun(), jobs: [] });
    expect(r.findings.map((f) => f.code)).toEqual(["NO-JOBS"]);
  });

  it("flags a green run over a failed job that DID run steps as GREEN-OVER-FAILURE only", () => {
    const r = assessRun(
      realRun({ jobs: [{ id: 10, name: "test", status: "completed", conclusion: "failure", steps: [step(1)] }] }),
    );
    expect(r.findings.map((f) => f.code)).toEqual(["GREEN-OVER-FAILURE"]);
  });

  it("passes a run whose jobs all ran steps and whose status matches them", () => {
    expect(assessRun(realRun()).findings).toEqual([]);
    expect(assessRun(realRun({ conclusion: "failure" })).findings).toEqual([]);
  });

  it("does NOT call a queued or in-progress job hollow — it has no steps yet by nature", () => {
    const r = assessRun(realRun({ jobs: [{ id: 10, name: "test", status: "queued", conclusion: null, steps: [] }] }));
    expect(r.findings).toEqual([]);
  });

  it("does NOT call a `skipped` job hollow — it never runs steps by design (deploy-site's staged job)", () => {
    // bug->guard from the first live run on 2026-09-02: "Stage + deploy to Cloudflare Pages" is
    // gated on the credential probe ahead of it and is skipped, not refused. The refusal is the
    // probe's 0-step failure, which stays flagged.
    const r = assessRun(
      realRun({
        conclusion: "failure",
        jobs: [
          { id: 10, name: "Deploy credential present?", status: "completed", conclusion: "failure", steps: [] },
          { id: 11, name: "Stage + deploy to Cloudflare Pages", status: "completed", conclusion: "skipped", steps: [] },
        ],
      }),
    );
    expect(r.findings.map((f) => [f.code, f.job])).toEqual([["HOLLOW-JOB", "Deploy credential present?"]]);
  });

  it("does NOT call an in-progress run NO-JOBS", () => {
    const r = assessRun({ run: { ...realRun().run, status: "in_progress", conclusion: null }, jobs: [] });
    expect(r.findings).toEqual([]);
  });
});

describe("assess — the verdict, and the exit code bound to it", () => {
  it("is UNAVAILABLE with a plain-English summary when any run is hollow", () => {
    const a = assess([hollowRun(), realRun()]);
    expect(a.verdict).toBe("UNAVAILABLE");
    expect(a.summary).toMatch(/remote GitHub execution currently unavailable/);
    expect(a.summary).toMatch(/1 of 2/);
    expect(EXIT[a.verdict]).toBe(1);
  });

  it("is MASKED when no run is hollow but a green run covers a failed job", () => {
    const a = assess([
      realRun({ jobs: [{ id: 10, name: "test", status: "completed", conclusion: "failure", steps: [step(1)] }] }),
    ]);
    expect(a.verdict).toBe("MASKED");
    expect(EXIT[a.verdict]).toBe(1);
  });

  it("is AVAILABLE only when every examined run is clean", () => {
    const a = assess([realRun(), realRun({ id: 2, conclusion: "failure" })]);
    expect(a.verdict).toBe("AVAILABLE");
    expect(EXIT[a.verdict]).toBe(0);
  });

  it("is UNKNOWN — never AVAILABLE — when nothing completed was examined", () => {
    expect(assess([]).verdict).toBe("UNKNOWN");
    const inflight = { run: { ...realRun().run, status: "in_progress", conclusion: null }, jobs: [] };
    expect(assess([inflight]).verdict).toBe("UNKNOWN");
    expect(EXIT.UNKNOWN).toBe(2);
  });
});

describe("gather — pairs each run with its own jobs through the injected api", () => {
  it("asks for the run list, then one jobs call per run, against the given repo", () => {
    const calls = [];
    const api = (path) => {
      calls.push(path);
      if (path.includes("/runs?")) return { workflow_runs: [{ id: 7 }, { id: 8 }] };
      return { jobs: [{ id: Number(path.match(/runs\/(\d+)\/jobs/)[1]) * 10 }] };
    };
    const got = gather({ repo: "o/r", limit: 2, api });
    expect(calls).toEqual(["repos/o/r/actions/runs?per_page=2", "repos/o/r/actions/runs/7/jobs", "repos/o/r/actions/runs/8/jobs"]);
    expect(got.map((g) => g.jobs[0].id)).toEqual([70, 80]);
  });
});

describe("the report and the CLI", () => {
  it("renders the verdict, the incident row, and the proof-authority reading", () => {
    const text = renderReport(assess([hollowRun()]), { now: NOW });
    expect(text).toContain("Verdict: **UNAVAILABLE**");
    expect(text).toContain("| 33405544287 | Dependency audit | schedule | `e97cfc75` | success | 1 |");
    expect(text).toContain("HOLLOW-JOB");
    expect(text).toContain(READING);
    expect(READING).toMatch(/not evidence its job ran/);
  });

  it("--report writes docs/usage-audit/ACTIONS-HEALTH.md under the given root and exits 1 on the incident", () => {
    const writes = [];
    const logs = [];
    const api = (path) =>
      path.includes("/runs?") ? { workflow_runs: [hollowRun().run] } : { jobs: hollowRun().jobs };
    const { code } = run({
      argv: ["--report", "--limit", "1"],
      api,
      now: NOW,
      write: (p, t) => writes.push([p, t]),
      log: (s) => logs.push(s),
      root: "/fake/root",
    });
    expect(code).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0][0].replace(/\\/g, "/")).toBe(`/fake/root/${REPORT_REL.replace(/\\/g, "/")}`);
    expect(writes[0][1]).toContain("**UNAVAILABLE**");
    expect(logs[0]).toMatch(/^actions-health: UNAVAILABLE/);
  });

  it("an API that cannot be asked yields UNKNOWN and exit 2 — never a green report", () => {
    const writes = [];
    const { code, assessment } = run({
      argv: ["--report", "--json"],
      api: () => {
        throw new Error("gh: HTTP 403 rate limited\nmore");
      },
      now: NOW,
      write: (p, t) => writes.push(t),
      log: () => {},
      root: "/fake/root",
    });
    expect(code).toBe(2);
    expect(assessment.verdict).toBe("UNKNOWN");
    expect(assessment.summary).toContain("HTTP 403 rate limited");
    expect(writes[0]).toContain("**UNKNOWN**");
    expect(writes[0]).not.toContain("AVAILABLE**");
  });

  it("exits 0 only for a clean window", () => {
    const api = (path) => (path.includes("/runs?") ? { workflow_runs: [realRun().run] } : { jobs: realRun().jobs });
    expect(run({ argv: [], api, now: NOW, log: () => {}, root: "/fake/root" }).code).toBe(0);
  });
});
