// Guard for scripts/land-pr.mjs -- the merge-to-prune window, closed in one command (P0-H case 10).
//
// 2026-09-03 (#362). A landed ref with no disposition record reds branch-disposition-audit for EVERY
// gate in the repository, and a merge leaves exactly that ref behind until someone prunes it. The
// pilot measured the window on PR #364: audit FAIL while the ref lingered, OK the moment it was
// pruned. These tests pin the plan's order and its refusals; the network reads are injected.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { main, planLanding, readOpenPullRequests, readView, renderPlan, retargetCommand } from "./land-pr.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const open = (pr, head, base = "main", extra = {}) => ({
  number: pr,
  state: "OPEN",
  headRefName: head,
  baseRefName: base,
  isCrossRepository: false,
  ...extra,
});

describe("planLanding: the guarded order, merge -> prune -> fetch -> audit", () => {
  it("merges with a merge commit, prunes the bare head, refreshes, then audits -- never --delete-branch, never squash", () => {
    const plan = planLanding({ pr: 364, view: open(364, "claude/lane-a"), openPrs: [open(364, "claude/lane-a")] });
    expect(plan.ok).toBe(true);
    expect(plan.steps.map((s) => s.what)).toEqual(["merge", "prune", "refresh", "audit"]);
    const [merge, prune, refresh, audit] = plan.steps.map((s) => s.cmd.join(" "));
    expect(merge).toBe("gh pr merge 364 --repo Pootytxng/sentinel --merge");
    expect(merge).not.toContain("--delete-branch");
    expect(merge).not.toContain("--squash");
    expect(prune).toBe("git push origin --delete claude/lane-a");
    expect(refresh).toBe("git fetch origin --prune");
    expect(audit).toBe("node scripts/branch-disposition-audit.mjs");
    expect(renderPlan(plan)).toContain("prune   git push origin --delete claude/lane-a");
  });

  it("strips an origin/ prefix from the head before deleting it", () => {
    const plan = planLanding({ pr: 1, view: open(1, "origin/lane/x") });
    expect(plan.head).toBe("lane/x");
    expect(plan.steps[1].cmd).toEqual(["git", "push", "origin", "--delete", "lane/x"]);
  });

  it("refuses a PR that is not OPEN, a fork PR, and a head of main", () => {
    expect(planLanding({ pr: 5, view: open(5, "lane/x", "main", { state: "MERGED" }) })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not OPEN"),
    });
    expect(planLanding({ pr: 5, view: null })).toMatchObject({ ok: false, reason: expect.stringContaining("unknown") });
    expect(planLanding({ pr: 6, view: open(6, "lane/x", "main", { isCrossRepository: true }) })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("fork"),
    });
    expect(planLanding({ pr: 7, view: open(7, "main", "release") })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("main"),
    });
  });

  it("refuses when another open PR is based on the head, naming the retarget and never the delete (#337)", () => {
    const openPrs = [open(289, "lane/case-receiver-287"), open(311, "lane/vacuous-guards-304", "lane/case-receiver-287")];
    const plan = planLanding({ pr: 289, view: openPrs[0], openPrs });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain("#311");
    expect(plan.reason).toContain(retargetCommand(311, "main"));
    expect(plan.reason).toContain("gh pr edit 311 --repo Pootytxng/sentinel --base main");
    expect(plan.reason).not.toContain("--delete");
    expect(plan.steps).toEqual([]);
  });

  it("the landing PR itself, and a PR whose HEAD is the ref, are not dependents", () => {
    const openPrs = [open(10, "lane/a"), open(11, "lane/a", "main")];
    expect(planLanding({ pr: 10, view: openPrs[0], openPrs }).ok).toBe(true);
  });

  it("refuses to prune a head a record says to keep (PRESERVE / LANDED), and ignores other words", () => {
    const view = open(2, "beta/private-beta-001");
    const keep = planLanding({ pr: 2, view, records: [{ ref: "origin/beta/private-beta-001", disposition: "PRESERVE" }] });
    expect(keep).toMatchObject({ ok: false, reason: expect.stringContaining("PRESERVE") });
    const landed = planLanding({ pr: 2, view, records: [{ ref: "origin/beta/private-beta-001", disposition: "LANDED" }] });
    expect(landed.ok).toBe(false);
    const claimed = planLanding({ pr: 2, view, records: [{ ref: "origin/beta/private-beta-001", disposition: "CLAIMED" }] });
    expect(claimed.ok).toBe(true);
  });
});

describe("the readers ask gh for exactly the fields the plan uses", () => {
  it("readView and readOpenPullRequests pass the repo and the JSON fields", () => {
    const calls = [];
    const exec = (cmd) => {
      calls.push(cmd.join(" "));
      return cmd[2] === "view" ? '{"number":1,"state":"OPEN"}' : "[]";
    };
    expect(readView(1, exec)).toEqual({ number: 1, state: "OPEN" });
    expect(readOpenPullRequests(exec)).toEqual([]);
    expect(calls[0]).toBe("gh pr view 1 --repo Pootytxng/sentinel --json number,state,baseRefName,headRefName,isCrossRepository");
    expect(calls[1]).toBe("gh pr list --repo Pootytxng/sentinel --state open --json number,baseRefName,headRefName --limit 200");
  });
});

describe("main: a merge is proof-dependent, so the receipt is not optional", () => {
  const quiet = () => {
    const lines = [];
    return { io: { log: (s) => lines.push(s), error: (s) => lines.push(s) }, lines };
  };
  it("exits 2 with usage when --pr is missing or not a number", () => {
    const { io, lines } = quiet();
    expect(main([], io)).toBe(2);
    expect(main(["--pr", "x"], io)).toBe(2);
    expect(lines.join("\n")).toContain("usage:");
  });
  it("exits 2 naming WORK_CONTROL when --pr is given without --receipt and it is not a dry run", () => {
    const { io, lines } = quiet();
    expect(main(["--pr", "364"], io)).toBe(2);
    expect(lines.join("\n")).toContain("--receipt <path> is required");
    expect(lines.join("\n")).toContain("docs/WORK_CONTROL.md");
  });

  // Bug -> guard (#413): the gate checks the closing references of the PR its receipt names. A receipt
  // copied from another landing would have it check the wrong PR, so land-pr refuses one that does not
  // name the PR it was asked to land, before the gate runs. The gate's spawn is injected, and every
  // refusal case stubs it FAILING: a regression that reached it would stop at "did not PASS" instead
  // of going on to read the PR from GitHub (a PASS stub would send the old code to gh for PR #395).
  describe("the receipt has to be for the PR being landed (#413)", () => {
    const MERGE = { transition: "merge-pr" };
    const dirs = [];
    afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
    const receiptFile = (body) => {
      const dir = mkdtempSync(join(tmpdir(), "compy-land-pr-"));
      dirs.push(dir);
      const path = join(dir, "receipt.json");
      writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body), "utf8");
      return path;
    };
    /** The gate's spawn, injected and recorded, so a case can prove the gate never ran. */
    const withSpawn = (status) => {
      const q = quiet();
      const spawned = [];
      q.io.spawn = (...args) => {
        spawned.push(args);
        return { status, stdout: "" };
      };
      return { ...q, spawned };
    };

    it("refuses a receipt that names a different PR, and never runs the gate", () => {
      const { io, lines, spawned } = withSpawn(1);
      expect(main(["--pr", "395", "--receipt", receiptFile({ ...MERGE, pr: 397 })], io)).toBe(1);
      expect(lines.join("\n")).toMatch(/names PR #397, not #395/);
      expect(spawned).toEqual([]);
    });

    it.each([[undefined], [null], ["395"], [0], [-395], [395.5]])("refuses a receipt whose pr is not a plain PR number: %j", (pr) => {
      const { io, lines, spawned } = withSpawn(1);
      expect(main(["--pr", "395", "--receipt", receiptFile({ ...MERGE, pr })], io)).toBe(1);
      expect(lines.join("\n")).toMatch(/not #395/);
      expect(spawned).toEqual([]);
    });

    it("refuses a receipt it cannot read, and never runs the gate", () => {
      const { io, lines, spawned } = withSpawn(1);
      expect(main(["--pr", "395", "--receipt", receiptFile("{not json")], io)).toBe(1);
      expect(lines.join("\n")).toMatch(/could not be read/);
      expect(spawned).toEqual([]);
    });

    // HQ review 5178030363: the gate judges a receipt by its OWN transition. A close-issue receipt that
    // carries this PR's number passed the PR check, reached the gate, was judged as a close, and never
    // had this PR's closingIssuesReferences read; land-pr would then merge. Only merge-pr may land.
    it.each([["close-issue"], ["mark-done"], ["mark-pr-ready"], ["close-superseded-pr"], ["MERGE-PR"], [" merge-pr"], [undefined], [null], [["merge-pr"]]])(
      "refuses a same-PR receipt whose transition is %j, not merge-pr, and never runs the gate",
      (transition) => {
        const { io, lines, spawned } = withSpawn(1);
        expect(main(["--pr", "395", "--receipt", receiptFile({ transition, pr: 395, issue: 283 })], io)).toBe(1);
        expect(lines.join("\n")).toMatch(/is not a merge-pr receipt/);
        expect(lines.join("\n")).not.toMatch(/did not PASS/);
        expect(spawned).toEqual([]);
      },
    );

    it("hands a same-PR merge-pr receipt to the gate, and stops when the gate does not PASS", () => {
      const { io, lines, spawned } = withSpawn(1);
      const path = receiptFile({ ...MERGE, pr: 395 });
      expect(main(["--pr", "395", "--receipt", path], io)).toBe(1);
      expect(spawned).toHaveLength(1);
      expect(spawned[0][1]).toEqual(["scripts/work-control-gate.mjs", path]);
      expect(lines.join("\n")).toMatch(/did not PASS/);
    });
  });
});

describe("the script's own text keeps the two promises the plan makes", () => {
  const source = readFileSync(join(ROOT, "scripts/land-pr.mjs"), "utf8");
  it("never spells --delete-branch as an argument and never squashes", () => {
    const args = [...source.matchAll(/"(--[a-z-]+)"/g)].map((m) => m[1]);
    expect(args).toContain("--merge");
    expect(args).not.toContain("--delete-branch");
    expect(args).not.toContain("--squash");
  });
  it("says out loud what to finish by hand when the merge landed but the prune did not", () => {
    expect(source).toContain("the merge is DONE");
    expect(source).toContain("Finish by hand");
  });
});
