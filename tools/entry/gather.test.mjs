// Guard for #414: the dispatch overlap check sees a lease wherever it lives.
//
// A lease lives in the issue thread, not in the board column. On 2026-09-11 five items held live
// leases outside Active (#283 and #318 in Review, #201 in Needs Kuya, #372 in Blocked, #398 in Inbox),
// and `gatherScopeFacts` compared Active items only, so a new claim on #318's exact path printed PASS.
// Beside it, `readIssueThread` returned the same `{ claim: null }` for a thread it could not read as for
// a thread with no claim, so an unreadable Active item cleared (collision rule 5: unknown means locked).
//
// Every case drives the real path: readIssueThreads / readIssueThread -> threadLease ->
// gatherScopeFacts -> scopeOverlapVerdict. Only the `gh` process is replaced, and it records every
// thread it was asked for, so a case can say which threads were NOT read. No case touches the network.
import { describe, expect, it } from "vitest";
// Through the namespace, so a reader that does not exist yet fails its own case, not the file.
import * as gather from "./gather.mjs";
import { overlapRemediation, scopeOverlapVerdict } from "./scope-overlap.mjs";
import { parseScopePatterns } from "../../scripts/lib/claim-scope.mjs";

const NOW = new Date("2026-09-11T12:00:00Z");
const TRACKED = ["scripts/work-control-gate.mjs", "scripts/land-pr.mjs", "tools/entry/gather.mjs", "docs/WORK_CONTROL.md"];
const git = () => TRACKED.join("\n");

const at = (createdAt, ...lines) => ({ createdAt, body: lines.join("\n") });
const claimOn = (path, { expires = "2099-01-01T00:00Z", postedAt = "2026-09-07T10:00:00Z" } = {}) =>
  at(postedAt, "### Ownership claim", "- Lane: Claude Code", `- Write scope: \`${path}\``, `- Claim expires: ${expires}`);
// The #399 / #407 shape: a Handoff that HOLDS the lease through review.
const HELD = at("2026-09-07T12:00:00Z", "### Handoff", "- Outcome: review requested", "- Claim: **HELD.** Scope unchanged. Released only when a review verdict lands.");
const RELEASED = at("2026-09-08T09:00:00Z", "### Handoff", "- Exact next action: none", "- Claim: released");

/**
 * A stand-in for the `gh` process. `threads` maps an issue number to its comments, or to an Error for a
 * thread GitHub will not return. It answers both reads gather makes: the batched GraphQL query and the
 * one-issue `gh issue view`. A GraphQL alias that fails comes back null and gh exits non-zero with the
 * rest of the data still on stdout, which is what gh does.
 */
function fakeGh(threads, { batchFails = false, page = 100 } = {}) {
  const asked = [];
  const calls = { graphql: 0, view: 0 };
  const run = (argv) => {
    if (argv[0] === "api" && argv[1] === "graphql") {
      calls.graphql += 1;
      const numbers = [...String(argv.find((a) => a.startsWith("query=")) ?? "").matchAll(/\bi(\d+)\s*:/g)].map((m) => Number(m[1]));
      asked.push(...numbers);
      if (batchFails) throw Object.assign(new Error("gh: HTTP 502"), { stdout: "" });
      const repository = {};
      let failed = false;
      for (const n of numbers) {
        const t = threads[n];
        if (!t || t instanceof Error) {
          repository[`i${n}`] = null;
          failed = true;
        } else {
          repository[`i${n}`] = { comments: { totalCount: t.length, nodes: t.slice(0, page) } };
        }
      }
      const out = JSON.stringify({ data: { repository } });
      if (failed) throw Object.assign(new Error("gh: Could not resolve to an issue"), { stdout: out });
      return out;
    }
    if (argv[0] === "issue" && argv[1] === "view") {
      calls.view += 1;
      const n = Number(argv[2]);
      asked.push(n);
      const t = threads[n];
      if (!t || t instanceof Error) throw new Error("gh: HTTP 502");
      return JSON.stringify({ comments: t });
    }
    throw new Error(`fakeGh: unexpected gh ${argv.join(" ")}`);
  };
  return { run, asked, calls };
}

const TASK = { number: 500, status: "Active" };
const item = (number, status) => ({ number, status, lane: "Claude Code" });
/** The facts and the verdict a dispatch of #500 on `mine` would get. */
function dispatch({ items, threads, mine = "`scripts/work-control-gate.mjs`", ...opts }) {
  const gh = fakeGh(threads, opts);
  const facts = gather.gatherScopeFacts({ task: TASK, items, scopeText: mine, now: NOW, git, run: gh.run });
  return { facts, verdict: scopeOverlapVerdict(facts), ...gh };
}

describe("a live lease refuses an overlapping claim in every column that is not Done (#414)", () => {
  it("refuses a claim on the path a Review item holds through review, the #399/#407 HELD shape", () => {
    const { verdict } = dispatch({ items: [item(318, "Review")], threads: { 318: [claimOn("scripts/work-control-gate.mjs"), HELD] } });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.number)).toEqual([318]);
    expect(verdict.reason).toContain("#318 (Claude Code) in Review");
  });

  it.each(["Review", "Needs Kuya", "Blocked", "Inbox", "Ready", null])("refuses when the live lease sits in %s", (status) => {
    const { verdict } = dispatch({ items: [item(201, status)], threads: { 201: [claimOn("scripts/work-control-gate.mjs")] } });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.number)).toEqual([201]);
  });

  it("passes when that lease was released, and the released item is not named at all", () => {
    const { verdict, facts } = dispatch({ items: [item(323, "Review")], threads: { 323: [claimOn("scripts/work-control-gate.mjs"), RELEASED] } });
    expect(verdict.ok).toBe(true);
    expect(facts.others).toEqual([]);
    expect(verdict.reason).toBe("no other live writer");
  });

  it("passes a disjoint live lease outside Active, and says what it compared", () => {
    const { verdict } = dispatch({ items: [item(372, "Blocked")], threads: { 372: [claimOn("docs/WORK_CONTROL.md")] } });
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe("disjoint from #372 (Claude Code) in Blocked");
  });

  it("an expired lease that was never released is named stale outside Active too, and still refuses where it overlaps", () => {
    const { verdict } = dispatch({
      items: [item(283, "Review")],
      threads: { 283: [claimOn("scripts/work-control-gate.mjs", { expires: "2026-09-10T18:41Z", postedAt: "2026-09-10T06:41:51Z" })] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings).toMatchObject([{ number: 283, stale: true }]);
    expect(verdict.reason).toContain("#283 (Claude Code) in Review (claim expired 2026-09-10)");
    expect(overlapRemediation(verdict)).toMatch(/renew .* or retire/);
  });

  it("an Active row with no live claim is still named stale, and an item off Active with none is not", () => {
    const { verdict, facts } = dispatch({ items: [item(278, "Active"), item(290, "Inbox")], threads: { 278: [], 290: [] } });
    expect(verdict.ok).toBe(true);
    expect(facts.others.map((o) => o.number)).toEqual([278]);
    expect(verdict.reason).toContain("stale on the board, not a writer: #278 (Claude Code) (no live claim)");
  });
});

describe("a Done item's thread is not read (#414 correction 3)", () => {
  it("leaves a Done item out, even one whose old lease names the same path, and never asks gh for it", () => {
    const { verdict, asked } = dispatch({
      items: [item(250, "Done"), item(318, "Review")],
      threads: { 250: [claimOn("scripts/work-control-gate.mjs")], 318: [claimOn("docs/WORK_CONTROL.md")] },
    });
    expect(verdict.ok).toBe(true);
    expect(asked).not.toContain(250);
    expect(asked).toContain(318);
  });

  it("never reads the dispatching task's own thread", () => {
    const { asked } = dispatch({ items: [item(500, "Active"), item(318, "Review")], threads: { 318: [] } });
    expect(asked).not.toContain(500);
  });
});

describe("an unreadable thread refuses in every column that is read (collision rule 5)", () => {
  it("readIssueThread marks a thread it could not read, and not a thread with no claim", () => {
    const failing = fakeGh({ 7: new Error("down") });
    expect(gather.readIssueThread(7, { run: failing.run })).toMatchObject({ claim: null, unreadable: true });
    const empty = fakeGh({ 8: [] });
    expect(gather.readIssueThread(8, { run: empty.run })).toMatchObject({ claim: null, unreadable: false });
  });

  it.each(["Active", "Review", "Needs Kuya", "Blocked", "Inbox", "Ready"])("refuses when a %s item's thread cannot be read, and says so", (status) => {
    const { verdict, facts } = dispatch({ items: [item(318, status), item(372, "Blocked")], threads: { 318: new Error("gone"), 372: [claimOn("docs/WORK_CONTROL.md")] } });
    expect(verdict.ok).toBe(false);
    expect(facts.others.find((o) => o.number === 318)).toMatchObject({ unreadable: true, live: true, scope: null });
    expect(verdict.reason).toMatch(/#318 .*could not be read/);
    expect(verdict.reason).not.toMatch(/declares no paths/);
    expect(overlapRemediation(verdict)).toMatch(/could not be read/);
    expect(overlapRemediation(verdict)).not.toMatch(/renew its claim/);
  });

  it("when the batched read fails, every item it should have read is a lease that could not be read", () => {
    const { verdict, facts } = dispatch({ items: [item(318, "Review"), item(201, "Needs Kuya"), item(250, "Done")], threads: {}, batchFails: true });
    expect(verdict.ok).toBe(false);
    expect(facts.others.map((o) => [o.number, o.unreadable])).toEqual([
      [318, true],
      [201, true],
    ]);
    expect(verdict.reason).toMatch(/leases could not be read/);
  });
});

describe("the read is one batched query, not one gh call per item (#414 correction 2)", () => {
  it("reads every item that is not Done in a single GraphQL call", () => {
    const items = Array.from({ length: 56 }, (_, i) => item(600 + i, ["Review", "Inbox", "Ready", "Blocked"][i % 4]));
    const threads = Object.fromEntries(items.map((it) => [it.number, []]));
    const { calls, asked, verdict } = dispatch({ items, threads });
    expect(verdict.ok).toBe(true);
    expect(calls).toEqual({ graphql: 1, view: 0 });
    expect(new Set(asked).size).toBe(56);
  });

  it("reads a thread longer than one page whole, so a claim past the first page still counts", () => {
    const noise = Array.from({ length: 100 }, (_, i) => at(`2026-09-0${1 + (i % 9)}T00:00:00Z`, `note ${i}`));
    const { verdict, calls } = dispatch({ items: [item(125, "Review")], threads: { 125: [...noise, claimOn("scripts/work-control-gate.mjs")] } });
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.number)).toEqual([125]);
    expect(calls).toEqual({ graphql: 1, view: 1 });
  });

  it("one failed alias costs only its own item", () => {
    const { facts } = dispatch({ items: [item(318, "Review"), item(372, "Blocked")], threads: { 318: new Error("transferred"), 372: [claimOn("docs/WORK_CONTROL.md")] } });
    expect(facts.others.map((o) => [o.number, Boolean(o.unreadable)])).toEqual([
      [318, true],
      [372, false],
    ]);
  });
});

// #445 option 1: `gh issue view` is a GraphQL read, and the hosted lane (claude.ai/code) is refused
// GraphQL outright, so readIssueThread reads the same thread over REST, one numbered page at a time.
// The cases below drive both transports through the one `gh` seam and check that the lease folded
// from a REST page is the lease folded from the GraphQL answer: same claim, same release, same
// "unreadable" when neither transport answers. Pages are asked for by explicit number, never
// `--paginate` (its numeric Link URLs are refused by the hosted proxy), and a page that is not a JSON
// array is a failed read, never an empty thread.
describe("readIssueThread answers over GraphQL or over REST, the same lease either way (#445 option 1)", () => {
  const REST_PATH = "repos/Pootytxng/sentinel/issues/7/comments";
  const asRest = (c, i) => ({ body: c.body, created_at: c.createdAt, html_url: `https://github.com/Pootytxng/sentinel/issues/7#issuecomment-${i + 1}` });
  /** A `gh` whose GraphQL read fails unless `graphql` is given, and whose REST pages come from `rest` (raw text or an array). */
  function twoTransports({ graphql = null, rest = [] } = {}) {
    const calls = [];
    const run = (argv) => {
      calls.push(argv);
      if (argv[0] === "issue" && argv[1] === "view") {
        if (!graphql) throw new Error("gh: GraphQL is not available from Claude Code sessions (HTTP 403)");
        return JSON.stringify({ comments: graphql });
      }
      if (argv[0] === "api") {
        if (typeof rest === "string") return rest;
        const m = /^(.*)\?per_page=(\d+)&page=(\d+)$/.exec(argv[3] ?? "");
        if (!m || m[1] !== REST_PATH) throw new Error(`fakeGh: unexpected gh ${argv.join(" ")}`);
        const size = Number(m[2]);
        const page = Number(m[3]);
        return JSON.stringify(rest.map(asRest).slice((page - 1) * size, page * size));
      }
      throw new Error(`fakeGh: unexpected gh ${argv.join(" ")}`);
    };
    return { run, calls };
  }
  const restCalls = (calls) => calls.filter((a) => a[0] === "api");

  it("a GraphQL answer is used as before, and REST is never asked", () => {
    const gh = twoTransports({ graphql: [claimOn("scripts/land-pr.mjs")] });
    const read = gather.readIssueThread(7, { run: gh.run });
    expect(read.unreadable).toBe(false);
    expect(read.claim).toMatchObject({ issue: 7, postedAt: "2026-09-07T10:00:00Z" });
    expect(restCalls(gh.calls)).toEqual([]);
  });

  it("when GraphQL is refused, the thread is read over REST by explicit page, and folds the same claim", () => {
    const thread = [claimOn("scripts/land-pr.mjs")];
    const viaGraphql = gather.readIssueThread(7, { run: twoTransports({ graphql: thread }).run });
    const gh = twoTransports({ rest: thread });
    const viaRest = gather.readIssueThread(7, { run: gh.run });
    expect(restCalls(gh.calls)).toEqual([["api", "--method", "GET", `${REST_PATH}?per_page=100&page=1`]]);
    expect(gh.calls.flat()).not.toContain("--paginate");
    expect(viaRest.unreadable).toBe(false);
    expect(viaRest.claim).toMatchObject({ issue: 7, postedAt: "2026-09-07T10:00:00Z", url: "https://github.com/Pootytxng/sentinel/issues/7#issuecomment-1" });
    // The one difference is the comment URL REST carries; every lease fact is the same.
    const { url, ...restClaim } = viaRest.claim;
    expect(restClaim).toEqual(viaGraphql.claim);
    // The scope REST folded is the same write authority: it parses to the one path the claim names.
    expect(parseScopePatterns(viaRest.claim.scope)).toEqual(["scripts/land-pr.mjs"]);
  });

  it("a thread longer than one page is read to its end over REST: the release on page 2 counts", () => {
    const filler = Array.from({ length: 99 }, (_, i) => at(`2026-09-07T11:${String(i % 60).padStart(2, "0")}:00Z`, `progress note ${i}`));
    const gh = twoTransports({ rest: [claimOn("scripts/land-pr.mjs"), ...filler, RELEASED] });
    const read = gather.readIssueThread(7, { run: gh.run });
    expect(restCalls(gh.calls).map((a) => a[3])).toEqual([`${REST_PATH}?per_page=100&page=1`, `${REST_PATH}?per_page=100&page=2`]);
    expect(read.unreadable).toBe(false);
    expect(read.claim).toBeNull();
    expect(read.handoff).toMatchObject({ released: true, postedAt: "2026-09-08T09:00:00Z" });
  });

  it("a thread neither transport can read is unreadable, which is not a thread with no claim", () => {
    const refused = twoTransports({ rest: "gh: HTTP 403" });
    refused.run = ((inner) => (argv) => {
      if (argv[0] === "api") throw new Error("gh: HTTP 403");
      return inner(argv);
    })(refused.run);
    expect(gather.readIssueThread(7, { run: refused.run })).toMatchObject({ claim: null, unreadable: true });
    // A REST page that is not a JSON array is a failed read, never an empty thread.
    expect(gather.readIssueThread(7, { run: twoTransports({ rest: "<html>502</html>" }).run })).toMatchObject({ claim: null, unreadable: true });
    expect(gather.readIssueThread(7, { run: twoTransports({ rest: JSON.stringify({ message: "Not Found" }) }).run })).toMatchObject({ claim: null, unreadable: true });
    // An empty REST page IS a thread with no claim.
    expect(gather.readIssueThread(7, { run: twoTransports({ rest: [] }).run })).toMatchObject({ claim: null, handoff: null, unreadable: false });
  });
});
