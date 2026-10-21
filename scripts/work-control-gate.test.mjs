// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  canonicalRemoteName,
  defaultOwnerFor,
  evaluateWorkControl as evaluateRaw,
  headProvenanceVia,
  parseRemotes,
  remoteHeadShas,
} from "./work-control-gate.mjs";
// Read through the namespace so a missing export fails its own case, not every case in this file.
import * as gate from "./work-control-gate.mjs";
import { BOARD_FRESH_MINUTES, BOARD_UNREACHABLE_CONSEQUENCES, renderBoardUnreachable } from "./lib/board-blocker.mjs";
import { leaseOverlapVerdict, renderLeaseOverlap } from "./lib/lease-overlap.mjs";
import { BOARD_TTL_MINUTES } from "../.claude/hooks/session-root-assert.mjs";
import { threadLease } from "../tools/entry/claim.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";

// Provenance has its own describe block below, with its own falsifications. Every case in the
// blocks before it is about what the receipt itself proves, so they run against a remote that
// says yes: a test that silently depended on the network would be measuring the network. The same
// holds for the issue thread a close reads (#411) and the closing references a merge reads (#413): a
// case that needs one hands it in, and any other read is refused here rather than sent to GitHub.
const evaluateWorkControl = (receipt, options = {}) =>
  evaluateRaw(receipt, {
    headProvenance: () => ({ ok: true, why: "stubbed" }),
    issueComments: () => {
      throw new Error("stubbed: this case reads no issue thread");
    },
    closingIssues: () => {
      throw new Error("stubbed: this case reads no PR");
    },
    ...options,
  });

// The REAL head of this worktree. Fixtures used to say HEAD, and the gate accepted it — which
// is precisely the hole this file now guards: a receipt is written by the actor asking for
// authorization, so a head it invented proved nothing. Every fixture below is bound to the head
// the repository is actually on, and the CLI cases re-resolve it in a child process.
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const OTHER_HEAD = `${"0".repeat(39)}1`;

// Bug -> guard (2026-08-09): PR #89 was closed after replacement evidence looked strong, but
// before PR #90's exact required gates could run. Substitute evidence and an unavailable execution
// environment must never authorize a proof-dependent GitHub transition.
const INSPECTED = {
  repository: true,
  remoteState: true,
  worktree: true,
  branch: true,
  dirtyState: true,
  liveProcesses: true,
};

const EXACT_PASS = [
  { command: "npm test", status: "passed", head: HEAD },
  { command: "cargo test --manifest-path src-tauri/Cargo.toml", status: "passed", head: HEAD },
];

// #445 option 2: a proof-dependent receipt records the authenticated fresh board read it was written
// against. Stamped at call time, so a slow run cannot age a fixture past BOARD_FRESH_MINUTES.
const freshBoard = () => ({
  status: "fresh",
  authenticated: true,
  readAt: new Date().toISOString(),
  via: "gh project item-list 1 --owner Pootytxng --format json --limit 1000",
  evidence: "stubbed in this test",
});

function record(overrides = {}) {
  return {
    actor: "codex",
    explicitHandoff: "https://github.com/Pootytxng/sentinel/issues/49#issuecomment-current",
    exclusiveWriter: true,
    inheritedWork: true,
    inspection: INSPECTED,
    transition: "close-superseded-pr",
    currentHead: HEAD,
    requiredGates: ["npm test", "cargo test --manifest-path src-tauri/Cargo.toml"],
    gateResults: EXACT_PASS,
    boardRead: freshBoard(),
    independentReview: {
      practical: true,
      reviewer: "claude-code",
      writer: "codex",
      status: "passed",
      head: HEAD,
    },
    ...overrides,
  };
}

describe("Claude/Codex role specialization", () => {
  it("keeps Claude Code as the implementation default and Codex as the independent-review default", () => {
    expect(defaultOwnerFor("implementation")).toBe("claude-code");
    expect(defaultOwnerFor("independent-review")).toBe("codex");
  });

  it("blocks either model from writing without an explicit, exclusive handoff", () => {
    const result = evaluateWorkControl(record({ explicitHandoff: "", exclusiveWriter: false }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/explicit handoff/i),
        expect.stringMatching(/exclusive writer/i),
      ]),
    );
  });

  it("rejects an implementation actor outside the declared executors", () => {
    const result = evaluateWorkControl(record({ actor: "unknown-agent" }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/implementation actor/i);
  });

  // #495: the rejection used to hardcode four names, so declaring a fifth executor left it lying.
  it("names every declared executor, grok included, when it rejects an actor", () => {
    const message = evaluateWorkControl(record({ actor: "unknown-agent" })).blockers.join("\n");
    expect([...gate.IMPLEMENTATION_ACTORS]).toContain("grok");
    for (const actor of gate.IMPLEMENTATION_ACTORS) expect(message).toContain(actor);
  });

  it("blocks inherited work until current repository, GitHub, worktree, dirty-state, and process inspection is complete", () => {
    const result = evaluateWorkControl(
      record({ inspection: { ...INSPECTED, remoteState: false, liveProcesses: false } }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/remoteState/);
    expect(result.blockers.join("\n")).toMatch(/liveProcesses/);
  });
});

describe("proof-gated GitHub transitions", () => {
  it("blocks unknown transition names so a typo cannot bypass proof", () => {
    const result = evaluateWorkControl(record({ transition: "close-superceded-pr" }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/unknown work-control transition/i);
  });

  it("treats an unavailable required gate as a blocker even when a substitute passes", () => {
    const result = evaluateWorkControl(
      record({
        gateResults: [
          { command: "npm test", status: "unavailable", head: HEAD, reason: "sandbox policy" },
          { command: "npm test -- --exclude host-dependent", status: "passed", head: HEAD },
          EXACT_PASS[1],
        ],
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/npm test.*unavailable.*blocker/i);
  });

  it("rejects exact gate receipts from any head other than the transition head", () => {
    const result = evaluateWorkControl(
      record({ gateResults: EXACT_PASS.map((gate) => ({ ...gate, head: OTHER_HEAD })) }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/current head/i);
  });

  it("allows an explicitly blocked draft to open without laundering it into readiness", () => {
    const result = evaluateWorkControl(
      record({
        transition: "open-draft-pr",
        requiredGates: [],
        gateResults: [],
        independentReview: { practical: false, reason: "implementation is still in progress" },
      }),
    );
    expect(result.decision).toBe("PASS");
  });

  it("requires a different model's final review when that review is practical", () => {
    const result = evaluateWorkControl(
      record({
        independentReview: { practical: true, reviewer: "codex", writer: "codex", status: "passed", head: HEAD },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/non-writing model/i);
  });

  // bug->guard #382: reviewer spelling, aliases, or prose cannot manufacture independence.
  it.each(
    ["claude-code", "codex", "chatgpt-hq", "cowork", "grok"].flatMap((author) => [
      [author, author],
      [author.toUpperCase(), author],
      [` ${author} `, author],
    ]),
  )("blocks reviewer spelling %j when %s authored the mutation", (reviewer, author) => {
    const result = evaluateWorkControl(record({
      actor: author,
      mutationAuthors: [author],
      independentReview: { practical: true, reviewer, writer: author, status: "passed", head: HEAD },
    }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/non-writing model/i);
  });

  // #495: Grok authors lanes through the GitHub API (PR #438). Undeclared, it could only sit in a
  // receipt note, where the reviewer-not-author rule never reads it.
  it("accepts grok as an author and keeps it off the review of its own delta (#438 shape)", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const receipt = (reviewer) => record({
      actor: "claude-code",
      mutationAuthors: ["claude-code", "grok"],
      independentReview: { practical: true, reviewer, status: "passed", head: HEAD },
    });
    expect(evaluateWorkControl(receipt("codex")).decision).toBe("PASS");
    for (const reviewer of ["grok", " GROK ", "claude-code"]) {
      const result = evaluateWorkControl(receipt(reviewer));
      expect(result.decision, reviewer).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/non-writing model/i);
      expect(result.blockers.join("\n")).not.toMatch(/Unknown mutation author/);
    }
    expect(evaluateWorkControl(record({
      actor: "grok",
      mutationAuthors: ["grok"],
      independentReview: { practical: true, reviewer: "grok", status: "passed", head: HEAD },
    })).decision).toBe("BLOCKED");
    expect(evaluateWorkControl(record({
      actor: "grok",
      independentReview: { practical: true, reviewer: "claude-code", writer: "grok", status: "passed", head: HEAD },
    })).decision).toBe("PASS");
  });

  it("treats cowork-hq as the cowork executor identity, not an independent alias", () => {
    const result = evaluateWorkControl(record({
      actor: "cowork",
      mutationAuthors: ["codex", "cowork"],
      independentReview: {
        practical: true,
        reviewer: " COWORK-HQ ",
        writer: "cowork",
        status: "passed",
        head: HEAD,
      },
    }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/non-writing model/i);
  });

  it.each(["mystery-reviewer", "codex (fresh read-only context)"])(
    "rejects undeclared reviewer identity %j",
    (reviewer) => {
      const result = evaluateWorkControl(record({
        independentReview: { practical: true, reviewer, writer: "codex", status: "passed", head: HEAD },
      }));
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/reviewer identity/i);
    },
  );

  it("accepts a declared reviewer-only identity and retains separate context evidence", () => {
    const result = evaluateWorkControl(record({
      independentReview: {
        practical: true,
        reviewer: "rust-tauri-reviewer",
        reviewerNote: "fresh read-only context that authored no mutation",
        evidence: "https://github.com/Pootytxng/sentinel/pull/1#pullrequestreview-1",
        writer: "codex",
        status: "passed",
        head: HEAD,
      },
    }));
    expect(result.decision).toBe("PASS");
  });

  // bug->guard #379: a supplied author list must never erase the current lease holder.
  it.each([undefined, "cowork"])("blocks omitted-actor self-review with writer %s", (writer) => {
    const result = evaluateWorkControl(record({
      actor: "cowork",
      mutationAuthors: ["codex"],
      independentReview: { practical: true, reviewer: "cowork", writer, status: "passed", head: HEAD },
    }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/non-writing model/i);
  });

  it("rejects an explicit author list that omits the receipt actor even with an independent reviewer", () => {
    const result = evaluateWorkControl(record({
      actor: "cowork", mutationAuthors: ["codex"],
      independentReview: { practical: true, reviewer: "claude-code", status: "passed", head: HEAD },
    }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/mutationAuthors.*receipt actor/i);
  });

  it.each(["codex", null, {}])("rejects malformed declared mutationAuthors %j", (mutationAuthors) => {
    expect(evaluateWorkControl(record({ mutationAuthors })).decision).toBe("BLOCKED");
  });

  it("retains every declared earlier writer and permits a separate final reviewer", () => {
    const receipt = record({
      actor: "cowork", mutationAuthors: [" codex ", "cowork", "codex"],
      independentReview: { practical: true, reviewer: "claude-code", status: "passed", head: HEAD },
    });
    expect(evaluateWorkControl(receipt).decision).toBe("PASS");
    expect(evaluateWorkControl({ ...receipt, independentReview: {
      ...receipt.independentReview, reviewer: "codex",
    }}).decision).toBe("BLOCKED");
  });

  it("binds the independent review to the actor who actually wrote the change", () => {
    const result = evaluateWorkControl(
      record({
        independentReview: {
          practical: true,
          reviewer: "claude-code",
          writer: "claude-code",
          status: "passed",
          head: HEAD,
        },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/receipt actor/i);
  });

  // Bug -> guard (2026-08-11, PR #90 recovery P4): the gate bound gate results to `currentHead` but
  // never asked git what the head WAS, so a receipt carrying one invented SHA everywhere satisfied
  // every binding in it. Internal consistency is not proof.
  it("rejects a head that is not a real commit id", () => {
    const result = evaluateWorkControl(record({ currentHead: "abc123", gateResults: [] }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/full 40-character commit SHA/i);
  });

  it("rejects a well-formed head the repository is not actually on", () => {
    const result = evaluateWorkControl(
      record({
        currentHead: OTHER_HEAD,
        gateResults: EXACT_PASS.map((gate) => ({ ...gate, head: OTHER_HEAD })),
        independentReview: {
          practical: true,
          reviewer: "claude-code",
          writer: "codex",
          status: "passed",
          head: OTHER_HEAD,
        },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/the repository is at/i);
  });

  it("blocks rather than waves through when the head cannot be resolved at all", () => {
    const result = evaluateWorkControl(record(), { resolveHead: () => null });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/could not be resolved/i);
  });

  it("rejects an independent review recorded at an earlier head than the transition", () => {
    const result = evaluateWorkControl(
      record({
        independentReview: {
          practical: true,
          reviewer: "claude-code",
          writer: "codex",
          status: "passed",
          head: OTHER_HEAD,
        },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/independent review is recorded at/i);
  });

  it("allows a proof-dependent transition only after exact current-head gates and independent review pass", () => {
    expect(evaluateWorkControl(record())).toEqual({ decision: "PASS", blockers: [], warnings: [], codes: [], structuredBlockers: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// RECEIPT PROVENANCE
//
// Everything above asks whether the receipt is internally consistent. These ask the question that
// decides whether the evidence exists anywhere but this disk -- design requirement 4 of #291: a
// merge or close receipt must be reachable from canonical remote evidence, and a purely local, a
// stale-cached, or a fork-only ref must not satisfy it.
//
// The pure cases below inject the git runner, so each failure mode is provable without a network
// and without a repository. The CLI cases further down build a REAL repository whose canonical
// origin is a bare repo on disk, because a stale remote-tracking ref is not a thing a stub can
// honestly imitate: it is a specific disagreement between what git cached and what origin has.
// ---------------------------------------------------------------------------------------------
// Bug -> guard (2026-09-10, #411): `gh issue close 283` ran while #283's lease was live, and two
// seconds later the project's "Item closed" workflow set the item Done, before any Handoff. On this
// board a close IS a Done ("Auto-close issue" runs the other way), so both transitions now read the
// issue's thread first and refuse while a lease is live on it. The threads are the shapes #283 had.
describe("a close ends the lease, so the lease has to end first (#411)", () => {
  const at = (createdAt, ...lines) => ({ createdAt, body: lines.join("\n") });
  const CLAIM_283 = at(
    "2026-09-10T06:41:51Z",
    "### Ownership claim",
    "- Lane: Claude Code",
    "- Write scope: `src-tauri/src/race_seam.rs`",
    "- Next action: land #410, close #283 and #398. The last step is a `### Handoff` that releases this lease.",
  );
  const CLOSE_NOTE = at(
    "2026-09-10T07:50:16Z",
    "Closing: #410 merged. The lease stays held until the carrier lands. Then the `### Handoff` and Done follow.",
  );
  const handoff = (claimLine) => at("2026-09-10T07:52:00Z", "### Handoff", "- Exact next action: none", `- Claim: ${claimLine}`);
  const thread = (...comments) => ({ issueComments: (issue) => (issue === 283 ? comments : []) });
  const close = (overrides = {}) => record({ transition: "close-issue", issue: 283, ...overrides });
  const PASSED = { decision: "PASS", blockers: [], warnings: [], codes: [], structuredBlockers: [] };

  it.each(["close-issue", "mark-done"])("blocks %s while the issue's lease is live, as #283's was at 07:50:17Z", (transition) => {
    const result = evaluateWorkControl(close({ transition }), thread(CLAIM_283, CLOSE_NOTE));
    expect(result.decision).toBe("BLOCKED");
    const said = result.blockers.join("\n");
    expect(said).toMatch(/#283 still has a live lease/);
    expect(said).toMatch(/2026-09-10T06:41:51Z/);
    expect(said).toMatch(/Item closed/);
    expect(said).toMatch(/Handoff first/);
  });

  it("passes once a newer Handoff releases the lease", () => {
    expect(evaluateWorkControl(close(), thread(CLAIM_283, handoff("released")))).toEqual(PASSED);
    expect(evaluateWorkControl(close({ transition: "mark-done" }), thread(CLAIM_283, handoff("released")))).toEqual(PASSED);
  });

  it.each([
    ["a transfer", "transferred to codex until 2026-09-11T08:00Z"],
    ["a HELD lease that mentions its release (#399)", "**HELD.** Scope unchanged. Released only when a review verdict lands."],
  ])("stays blocked after %s", (_, claimLine) => {
    expect(evaluateWorkControl(close(), thread(CLAIM_283, handoff(claimLine))).decision).toBe("BLOCKED");
  });

  it("blocks when the thread cannot be read, because an unknown lease is not a released one", () => {
    const result = evaluateWorkControl(close(), {
      issueComments: () => {
        throw new Error("gh: HTTP 502");
      },
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283's thread could not be read \(gh: HTTP 502\)/);
    expect(result.blockers.join("\n")).toMatch(/blocker, not a pass/);
  });

  // One-element rows: it.each spreads an array row into arguments, so a bare [] would arrive as nothing.
  it.each([[undefined], [null], [0], ["283"], [[]], [[283, "x"]]])("blocks a receipt that does not name its issue plainly: %j", (issue) => {
    const result = evaluateWorkControl(close({ issue }), thread(CLAIM_283, handoff("released")));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/must name its issue/);
  });

  it("reads every issue a receipt closes, and names only the one still leased", () => {
    const threads = { 324: [CLAIM_283, handoff("released")], 339: [CLAIM_283] };
    const result = evaluateWorkControl(close({ issue: [324, 339] }), { issueComments: (n) => threads[n] });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#339 still has a live lease/);
    expect(result.blockers.join("\n")).not.toMatch(/#324/);
  });

  // HQ review 5165670535 on e56c6395. Finding 1: a release quoted inside fenced code read as a real
  // one, so this close passed while #283's claim was live. Finding 2: a later Handoff that said nothing
  // of the claim brought a released one back, so this close was refused after a real release.
  it("stays blocked when the only release on the thread is an example inside fenced code", () => {
    const example = at("2026-09-10T07:52:00Z", "The release will read:", "", "```text", "### Handoff", "- Exact next action: none", "- Claim: released", "```");
    const result = evaluateWorkControl(close(), thread(CLAIM_283, example));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283 still has a live lease/);
  });

  it("folds the thread in order: a release holds through a later Handoff, until a new claim", () => {
    const later = at("2026-09-10T08:10:00Z", "### Handoff", "- Outcome: review requested", "- Exact next action: independent review");
    const reclaim = at("2026-09-10T08:20:00Z", "### Ownership claim", "- Lane: Codex", "- Write scope: `docs/`");
    expect(evaluateWorkControl(close(), thread(CLAIM_283, handoff("released"), later))).toEqual(PASSED);
    expect(evaluateWorkControl(close(), thread(CLAIM_283, handoff("released"), later, reclaim)).decision).toBe("BLOCKED");
  });

  // HQ review 5167660647 on 3ce1beb9: a release quoted inside a raw HTML block read as a real one too.
  it("stays blocked when the only release on the thread is an example inside a raw HTML block", () => {
    const example = at("2026-09-10T07:52:00Z", "The release will read:", "", "<pre>", "### Handoff", "- Exact next action: none", "- Claim: released", "</pre>");
    const result = evaluateWorkControl(close(), thread(CLAIM_283, example));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283 still has a live lease/);
    const released = at("2026-09-10T07:52:00Z", ...example.body.split("\n"), "", "### Handoff", "- Exact next action: none", "- Claim: released");
    expect(evaluateWorkControl(close(), thread(CLAIM_283, released))).toEqual(PASSED);
  });

  // HQ review 5171061412 on c71c6d3c: a fence left open inside a list item hid the claim after the item,
  // so this close passed while #283's lease was live.
  it.each(["close-issue", "mark-done"])("blocks %s when the claim follows a fence left open inside a list item", (transition) => {
    const claim = at("2026-09-10T06:41:51Z", "- Plan:", "  ```sh", "  npm test", "### Ownership claim", "- Lane: Claude Code", "- Write scope: `src-tauri/src/race_seam.rs`");
    const result = evaluateWorkControl(close({ transition }), thread(claim));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283 still has a live lease/);
    expect(evaluateWorkControl(close({ transition }), thread(claim, handoff("released")))).toEqual(PASSED);
  });

  it("stays blocked when the only release is a Handoff still inside a list item's fence", () => {
    const example = at("2026-09-10T07:52:00Z", "- The release will read:", "  ```", "  ### Handoff", "  - Claim: released");
    const result = evaluateWorkControl(close(), thread(CLAIM_283, example));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283 still has a live lease/);
  });

  // GitHub reads a list item's fence closed at column 0 as opening another fence, so the Handoff after
  // it is code: c71c6d3c read it as a release, and this close passed with #283's lease live.
  it("stays blocked when the only release follows a list item's fence closed at column 0", () => {
    const example = at("2026-09-10T07:52:00Z", "- Run:", "  ```", "  npm test", "```", "### Handoff", "- Exact next action: none", "- Claim: released");
    const result = evaluateWorkControl(close(), thread(CLAIM_283, example));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283 still has a live lease/);
  });

  // HQ review 5172037615 on afc6dfc7: a Handoff took its Claim line from anywhere in its comment, so a
  // `- Claim: released` above its header, or under a later heading, released #283's live claim.
  const OUTSIDE = [
    ["above the Handoff's header", ["### Notes", "- Claim: released", "", "### Handoff", "- Outcome: review requested", "- Exact next action: independent review"]],
    ["above a Handoff that says HELD", ["### Notes", "- Claim: released", "", "### Handoff", "- Claim: HELD. Review pending."]],
    ["under a heading after the Handoff", ["### Handoff", "- Outcome: review requested", "", "### Notes", "- Claim: released"]],
    ["made a heading by an underline indented into its list item", ["### Handoff", "- Outcome: review requested", "- Claim: released", "  ---"]],
  ];
  it.each(["close-issue", "mark-done"].flatMap((t) => OUTSIDE.map(([where, lines]) => [t, where, lines])))(
    "blocks %s when the only released Claim line is %s",
    (transition, _, lines) => {
      const outside = at("2026-09-10T07:52:00Z", ...lines);
      const result = evaluateWorkControl(close({ transition }), thread(CLAIM_283, outside));
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/#283 still has a live lease/);
      expect(evaluateWorkControl(close({ transition }), thread(CLAIM_283, outside, handoff("released")))).toEqual(PASSED);
    },
  );

  // Bug -> guard (#413): a merge reaches Done by another route. Merging a PR closes every issue in its
  // closingIssuesReferences (a keyword in the body or in any commit), and "Item closed" then sets Done.
  // Open PR #395 lists #283. So a merge-pr receipt is held to the same lease check, over those issues.
  describe("a merge closes the issues its PR lists, so their leases have to end first (#413)", () => {
    const ref = (number, repo = "Pootytxng/sentinel") => {
      const [login, name] = repo.split("/");
      return { number, repository: { name, owner: { login } }, url: `https://github.com/${repo}/issues/${number}` };
    };
    const merge = (overrides = {}) => record({ transition: "merge-pr", pr: 395, ...overrides });
    /** Both reads injected, and every read recorded, so a case can say what the gate did NOT read. */
    const reads = (refs, threads = {}) => {
      const asked = [];
      return {
        asked,
        options: {
          closingIssues: (pr) => {
            asked.push(`pr ${pr}`);
            if (refs instanceof Error) throw refs;
            return refs;
          },
          issueComments: (issue) => {
            asked.push(`#${issue}`);
            if (threads[issue] instanceof Error) throw threads[issue];
            if (!threads[issue]) throw new Error(`no thread stubbed for #${issue}`);
            return threads[issue];
          },
        },
      };
    };

    it("blocks while an issue the PR lists still has a live lease, as #283's was under #395", () => {
      const { asked, options } = reads([ref(283)], { 283: [CLAIM_283, CLOSE_NOTE] });
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      const said = result.blockers.join("\n");
      expect(said).toMatch(/#283 still has a live lease/);
      expect(said).toMatch(/2026-09-10T06:41:51Z/);
      expect(said).toMatch(/PR #395 lists it as an issue its merge closes/);
      expect(said).toMatch(/Handoff first/);
      expect(asked).toEqual(["pr 395", "#283"]);
    });

    it("passes once a newer Handoff releases that lease", () => {
      const { options } = reads([ref(283)], { 283: [CLAIM_283, handoff("released")] });
      expect(evaluateWorkControl(merge(), options)).toEqual(PASSED);
    });

    it("passes a PR with no closing references without reading any thread", () => {
      const { asked, options } = reads([]);
      expect(evaluateWorkControl(merge(), options)).toEqual(PASSED);
      expect(asked).toEqual(["pr 395"]);
    });

    it("reads only the PR's closing references, never the receipt's own issue", () => {
      const { asked, options } = reads([], { 283: [CLAIM_283] });
      expect(evaluateWorkControl(merge({ issue: 283 }), options)).toEqual(PASSED);
      expect(asked).toEqual(["pr 395"]);
    });

    it("reads every issue the PR lists, and names only the one still leased", () => {
      const { options } = reads([ref(318), ref(323)], { 318: [CLAIM_283], 323: [CLAIM_283, handoff("released")] });
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/#318 still has a live lease/);
      expect(result.blockers.join("\n")).not.toMatch(/#323/);
    });

    it("blocks when the PR cannot be read, because unknown references are not none", () => {
      const { asked, options } = reads(new Error("gh: HTTP 502"));
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/PR #395's closing references could not be read \(gh: HTTP 502\)/);
      expect(result.blockers.join("\n")).toMatch(/blocker, not a pass/);
      expect(asked).toEqual(["pr 395"]);
    });

    it("blocks when the reader hands back something that is not a list of references", () => {
      const { options } = reads({ closingIssuesReferences: [] });
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/PR #395's closing references could not be read/);
    });

    it("blocks when a listed issue's thread cannot be read", () => {
      const { options } = reads([ref(283)], { 283: new Error("gh: HTTP 502") });
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/#283's thread could not be read \(gh: HTTP 502\)/);
    });

    it.each([
      ["another repository's issue", { ...ref(12, "SomeoneElse/sentinel") }],
      ["a reference that names no repository", { number: 12 }],
    ])("blocks on %s, whose lease this gate cannot read, and reads no thread for it", (_, reference) => {
      const { asked, options } = reads([reference]);
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/PR #395 lists an issue outside Pootytxng\/sentinel/);
      expect(asked).toEqual(["pr 395"]);
    });

    it.each([["283"], [0], [-1], [2.5], [null]])("blocks a reference without a plain issue number: %j", (number) => {
      const { asked, options } = reads([{ ...ref(283), number }]);
      const result = evaluateWorkControl(merge(), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/PR #395 lists a reference with no plain issue number/);
      expect(asked).toEqual(["pr 395"]);
    });

    // One-element rows: it.each spreads an array row into arguments.
    it.each([[undefined], [null], [0], ["395"], [-1], [1.5]])("blocks a receipt that does not name its PR plainly: %j", (pr) => {
      const { asked, options } = reads([]);
      const result = evaluateWorkControl(merge({ pr }), options);
      expect(result.decision).toBe("BLOCKED");
      expect(result.blockers.join("\n")).toMatch(/A merge-pr receipt must name its PR/);
      expect(asked).toEqual([]);
    });

    it("the production reader asks gh for the PR's closingIssuesReferences in the canonical repository", () => {
      const calls = [];
      const read = gate.closingIssuesVia((argv) => {
        calls.push(argv.join(" "));
        return JSON.stringify({ closingIssuesReferences: [ref(283)] });
      });
      expect(read(395)).toEqual([ref(283)]);
      expect(calls).toEqual(["pr view 395 --repo Pootytxng/sentinel --json closingIssuesReferences"]);
      // A GraphQL answer with no list is a failed primary read; with REST refusing too, the reader
      // throws naming both transports (#445 option 1), and the merge stays unread, so BLOCKED.
      const neither = gate.closingIssuesVia((argv) => {
        if (argv[0] === "pr") return "{}";
        throw new Error("gh: HTTP 403");
      });
      expect(() => neither(395)).toThrow(/no closingIssuesReferences list.*nor over REST \(gh: HTTP 403\)/);
    });

    it("leaves the other proof transitions' PR alone: only a merge closes what a PR lists", () => {
      for (const transition of ["mark-pr-ready", "close-superseded-pr"]) {
        expect(evaluateWorkControl(record({ transition, pr: 395 }))).toEqual(PASSED);
      }
    });
  });
});

describe("receipt provenance", () => {
  const ONE = "1".repeat(40);
  const TWO = "2".repeat(40);

  it("finds the canonical remote by URL, and is not fooled by a fork of the same name", () => {
    const shapes = [
      "git@github.com:Pootytxng/sentinel.git",
      "https://github.com/Pootytxng/sentinel",
      "https://github.com/Pootytxng/sentinel.git/",
      "C:\\Users\\someone\\mirrors\\Pootytxng\\sentinel",
    ];
    for (const url of shapes) {
      expect(canonicalRemoteName([{ name: "whatever", url }]), url).toBe("whatever");
    }
    // The name is not the evidence. A remote CALLED origin that points at someone else's fork is
    // exactly the case a name check waves through, and the case that makes a receipt worthless:
    // the merge happens on the canonical repo, where nobody can fetch this commit.
    expect(
      canonicalRemoteName([{ name: "origin", url: "git@github.com:SomeoneElse/sentinel.git" }]),
    ).toBe(null);
    expect(canonicalRemoteName([])).toBe(null);
  });

  it("reads remotes and live heads out of git's own output", () => {
    expect(
      parseRemotes(
        "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n" +
          "origin\tgit@github.com:Pootytxng/sentinel.git (push)\n" +
          "fork\thttps://github.com/Someone/sentinel (fetch)\n",
      ),
    ).toEqual([
      { name: "origin", url: "git@github.com:Pootytxng/sentinel.git" },
      { name: "fork", url: "https://github.com/Someone/sentinel" },
    ]);
    expect(remoteHeadShas(`${ONE}\trefs/heads/main\n${TWO}\trefs/heads/lane/x\n`)).toEqual([
      ONE,
      TWO,
    ]);
    // Tags are not branches. Counting one as evidence would let a tag left on a deleted branch's
    // tip stand in for a branch origin no longer serves.
    expect(remoteHeadShas(`${ONE}\trefs/tags/v1\n`)).toEqual([]);
  });

  it("passes only when origin's own tips reach the head", () => {
    const provenance = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n";
      if (args[0] === "ls-remote") return `${ONE}\trefs/heads/main\n`;
      if (args[0] === "cat-file") return "";
      if (args[0] === "rev-list") return "0\n";
      throw new Error(`unexpected git ${args[0]}`);
    });
    expect(provenance(TWO)).toEqual({ ok: true, why: "reachable from origin" });
  });

  it("refuses a head origin does not have, whatever is holding it locally", () => {
    // "3 commits exist on no branch origin has" is the same answer for a branch that was never
    // pushed, a branch that only exists on a fork, and a remote-tracking ref left behind by a
    // fetch -- because none of them are origin, which is the whole point.
    const provenance = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n";
      if (args[0] === "ls-remote") return `${ONE}\trefs/heads/main\n`;
      if (args[0] === "cat-file") return "";
      if (args[0] === "rev-list") return "3\n";
      throw new Error(`unexpected git ${args[0]}`);
    });
    const verdict = provenance(TWO);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toMatch(/exist on no branch origin/i);
  });

  it("refuses when there is no canonical remote at all", () => {
    const provenance = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:SomeoneElse/sentinel.git (fetch)\n";
      throw new Error(`unexpected git ${args[0]}`);
    });
    const verdict = provenance(TWO);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toMatch(/no remote points at Pootytxng\/sentinel/i);
  });

  it("blocks rather than passing when origin cannot be asked", () => {
    // Environment inability is a blocker, not a pass. An unreachable origin is the one condition
    // under which it is tempting to shrug and continue, and the one where continuing means the
    // receipt was never checked against anything.
    const unreachable = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n";
      throw new Error("Could not resolve host: github.com");
    });
    expect(unreachable(TWO)).toEqual({ ok: false, why: "origin could not be asked what it has" });

    const empty = headProvenanceVia((args) =>
      args[0] === "remote" ? "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n" : "",
    );
    expect(empty(TWO).ok).toBe(false);
    expect(empty(TWO).why).toMatch(/reports no branches/i);
  });

  it("blocks when origin's tips are not in this checkout instead of narrowing the evidence", () => {
    // rev-list cannot walk an object it does not have, so an unfetched origin would otherwise
    // silently shrink the set of things the head has to be reachable from -- and an empty set
    // makes everything reachable from nothing, which reads as a pass in the wrong implementation.
    const provenance = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n";
      if (args[0] === "ls-remote") return `${ONE}\trefs/heads/main\n`;
      if (args[0] === "cat-file") throw new Error("Not a valid object name");
      throw new Error("rev-list must never be reached with an empty exclusion set");
    });
    const verdict = provenance(TWO);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toMatch(/fetch origin and re-run/i);
  });

  it("carries the refusal into the transition verdict", () => {
    const result = evaluateRaw(record(), {
      resolveHead: () => HEAD,
      headProvenance: () => ({ ok: false, why: "origin does not have it" }),
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/not durably reachable/i);
  });
});

describe("work-control receipt CLI", () => {
  // A real repository, and a real canonical origin: a bare repo on disk whose PATH ends in
  // Pootytxng/sentinel, which is what the gate matches on. No network, and nothing stubbed --
  // these cases exercise the same code the gate runs against GitHub.
  const made = [];

  // #512. Declared, not discovered. Every case below builds its own repository with two bare
  // remotes (13 git spawns) and then runs the gate CLI, which asks the fixture origin for itself:
  // 13-22 subprocesses per case. Alone a case takes ~1s; under the parallel pre-push gate they were
  // measured at 4-10.8s, and the stale-ref case timed out at vitest's 15s default on 2026-09-23.
  // The repositories cannot be shared -- each case mutates its own origin -- so the budget is named
  // here instead of the global testTimeout being raised for every file in the suite.
  const CLI_RECEIPT_TIMEOUT_MS = GIT_SPAWN_TIMEOUT_MS;

  function makeRepo() {
    const root = mkdtempSync(join(tmpdir(), "compy-wc-repo-"));
    made.push(root);
    const canonical = join(root, "Pootytxng", "sentinel");
    const fork = join(root, "SomeoneElse", "sentinel");
    const work = join(root, "work");
    const hooks = join(root, "no-hooks");
    for (const dir of [canonical, fork, work, hooks]) mkdirSync(dir, { recursive: true });
    const bare = (dir) => execFileSync("git", ["init", "-q", "--bare", "-b", "main", dir]);
    bare(canonical);
    bare(fork);
    execFileSync("git", ["init", "-q", "-b", "main", work]);
    const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
    git("config", "user.email", "gate@test.invalid");
    git("config", "user.name", "gate test");
    git("config", "commit.gpgsign", "false");
    // This repository points core.hooksPath at .githooks; a fixture repo must not inherit a
    // pre-commit hook that knows nothing about it.
    git("config", "core.hooksPath", hooks);
    writeFileSync(join(work, "a.txt"), "one", "utf8");
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    git("remote", "add", "origin", canonical);
    git("remote", "add", "fork", fork);
    git("push", "-q", "origin", "main");
    return { work, git, canonical, pushed: git("rev-parse", "HEAD") };
  }

  afterAll(() => {
    for (const root of made) rmSync(root, { recursive: true, force: true });
  });

  function runReceipt(receipt, cwd) {
    const directory = mkdtempSync(join(tmpdir(), "compy-work-control-"));
    const path = join(directory, "receipt.json");
    writeFileSync(path, JSON.stringify(receipt), "utf8");
    try {
      return spawnSync(process.execPath, [resolve("scripts", "work-control-gate.mjs"), path], {
        encoding: "utf8",
        cwd,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  /** The complete receipt, re-bound to whichever head the fixture repository is standing on. */
  function at(head) {
    return record({
      currentHead: head,
      gateResults: EXACT_PASS.map((gate) => ({ ...gate, head })),
      boardRead: freshBoard(),
      independentReview: { ...record().independentReview, head },
    });
  }

  it("exits zero and prints PASS for a complete receipt origin can actually reach", () => {
    const repo = makeRepo();
    const result = runReceipt(at(repo.pushed), repo.work);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ decision: "PASS", blockers: [], warnings: [], codes: [], structuredBlockers: [] });
  }, CLI_RECEIPT_TIMEOUT_MS);

  it("exits nonzero with the one BOARD_UNREACHABLE code when the receipt carries no board read (#445 option 2)", () => {
    const repo = makeRepo();
    const { boardRead: _dropped, ...unread } = at(repo.pushed);
    const result = runReceipt(unread, repo.work);
    expect(result.status).toBe(1);
    const printed = JSON.parse(result.stdout);
    expect(printed.decision).toBe("BLOCKED");
    expect(printed.codes).toEqual(["BOARD_UNREACHABLE"]);
    expect(printed.structuredBlockers).toHaveLength(1);
    expect(printed.structuredBlockers[0]).toMatchObject({ code: "BOARD_UNREACHABLE", transition: "close-superseded-pr" });
    expect(printed.blockers).toContain(renderBoardUnreachable(printed.structuredBlockers[0]));
  }, CLI_RECEIPT_TIMEOUT_MS);

  it("exits nonzero and prints BLOCKED when an exact required gate is unavailable", () => {
    const repo = makeRepo();
    const complete = at(repo.pushed);
    const result = runReceipt(
      {
        ...complete,
        gateResults: [
          { command: "npm test", status: "unavailable", head: repo.pushed, reason: "no host" },
          complete.gateResults[1],
        ],
      },
      repo.work,
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).decision).toBe("BLOCKED");
  }, CLI_RECEIPT_TIMEOUT_MS);

  it("refuses a receipt whose head has never left this disk", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.work, "a.txt"), "two", "utf8");
    repo.git("commit", "-q", "-am", "two");
    const local = repo.git("rev-parse", "HEAD");
    expect(local).not.toBe(repo.pushed);
    const result = runReceipt(at(local), repo.work);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).blockers.join("\n")).toMatch(/not durably reachable/i);
  }, CLI_RECEIPT_TIMEOUT_MS);

  it("refuses a receipt held up only by a stale remote-tracking ref", () => {
    // The trap this exists for: refs/remotes/origin/* is the last FETCH, not origin. Below, origin
    // genuinely had the commit and then genuinely lost it, while git's cache still says otherwise.
    // A gate that reads the cache calls this pushed; a gate that asks origin calls it gone.
    const repo = makeRepo();
    repo.git("checkout", "-q", "-b", "stale");
    writeFileSync(join(repo.work, "a.txt"), "stale", "utf8");
    repo.git("commit", "-q", "-am", "stale");
    const stranded = repo.git("rev-parse", "HEAD");
    repo.git("push", "-q", "origin", "stale");
    repo.git("fetch", "-q", "origin");
    // Deleted by someone else, on the remote itself: `git push origin --delete` would also
    // drop the local remote-tracking ref, which is the very thing this case has to keep.
    execFileSync("git", ["--git-dir", repo.canonical, "update-ref", "-d", "refs/heads/stale"]);
    repo.git("checkout", "-q", "--detach", stranded);
    repo.git("branch", "-q", "-D", "stale");
    // Only the cached ref still names it, which is what makes this a proof: the cache is the one
    // thing a naive implementation could have been reading.
    expect(repo.git("rev-parse", "refs/remotes/origin/stale")).toBe(stranded);
    const result = runReceipt(at(stranded), repo.work);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).blockers.join("\n")).toMatch(/not durably reachable/i);
  }, CLI_RECEIPT_TIMEOUT_MS);

  it("refuses a receipt that only a fork can reach", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.work, "a.txt"), "forked", "utf8");
    repo.git("commit", "-q", "-am", "forked");
    const onlyOnFork = repo.git("rev-parse", "HEAD");
    repo.git("push", "-q", "fork", "main");
    // Pushed, fetched, reachable -- from the wrong repository. The merge happens on the canonical
    // one, where this commit does not exist.
    repo.git("fetch", "-q", "fork");
    const result = runReceipt(at(onlyOnFork), repo.work);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).blockers.join("\n")).toMatch(/not durably reachable/i);
  }, CLI_RECEIPT_TIMEOUT_MS);

  it("refuses a fork standing in the place called origin, however reachable it is", () => {
    // The maximal version of the case above: the remote is named origin, it answers, it has the
    // commit, and it is still the wrong repository. Everything a name check looks at says yes.
    const repo = makeRepo();
    repo.git("remote", "remove", "origin");
    repo.git("remote", "rename", "fork", "origin");
    repo.git("push", "-q", "origin", "main");
    expect(repo.git("ls-remote", "--heads", "origin")).toContain(repo.pushed);
    const result = runReceipt(at(repo.pushed), repo.work);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).blockers.join("\n")).toMatch(
      /no remote points at Pootytxng\/sentinel/i,
    );
  }, CLI_RECEIPT_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// #445 option 1 (lane work under the owner ruling of 2026-10-21): the hosted lane's proxy refuses
// GraphQL (`gh issue view --json`, `gh pr view --json` → 403) while REST (`gh api repos/...`)
// answers. Each reader tries GraphQL first and, only when that fails, reads the SAME facts over
// REST. Both are reads; nothing here can write.
// ---------------------------------------------------------------------------------------------
describe("two read-only transports behind one reader (#445 option 1)", () => {
  const at = (createdAt, ...lines) => ({ createdAt, body: lines.join("\n") });
  const CLAIM = at("2026-10-21T09:00:00Z", "### Ownership claim", "- Lane: Claude Code", "- Write scope: `scripts/work-control-gate.mjs`", "- Next action: land the gate");
  const RELEASED = at("2026-10-21T09:30:00Z", "### Handoff", "- Exact next action: none", "- Claim: released");
  const restRow = (c, login = "Pootytxng") => ({ body: c.body, created_at: c.createdAt, html_url: `https://github.com/Pootytxng/sentinel/issues/678#issuecomment-${Date.parse(c.createdAt)}`, user: { login } });
  const page = (argv) => Number(/[?&]page=(\d+)$/.exec(argv[3] ?? "")?.[1] ?? NaN);
  const graphqlRefused = () => {
    throw new Error("gh: HTTP 403: Forbidden (https://api.github.com/graphql)\nGraphQL is refused by this proxy");
  };

  it("reads an issue's thread over GraphQL first, with the argv pinned", () => {
    const calls = [];
    const read = gate.issueCommentsVia((argv) => {
      calls.push(argv);
      return JSON.stringify({ comments: [CLAIM, RELEASED] });
    });
    expect(read(678)).toEqual([CLAIM, RELEASED]);
    expect(calls).toEqual([["issue", "view", "678", "--repo", "Pootytxng/sentinel", "--json", "comments"]]);
  });

  it("falls back to REST only after GraphQL fails, folds the REST shape to the one threadLease reads, and tags the transport", () => {
    const calls = [];
    const read = gate.issueCommentsVia((argv) => {
      calls.push(argv);
      if (argv[0] === "issue") graphqlRefused();
      return JSON.stringify([restRow(CLAIM), restRow(RELEASED)]);
    });
    const comments = read(678);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(["api", "--method", "GET", "repos/Pootytxng/sentinel/issues/678/comments?per_page=100&page=1"]);
    expect(comments).toMatchObject([
      { body: CLAIM.body, createdAt: CLAIM.createdAt, author: { login: "Pootytxng" }, transport: "rest" },
      { body: RELEASED.body, createdAt: RELEASED.createdAt, transport: "rest" },
    ]);
    expect(comments[0].url).toMatch(/^https:\/\/github\.com\/Pootytxng\/sentinel\/issues\/678#issuecomment-/);
    // The lease read from the REST shape is the same lease: released by the Handoff.
    const lease = threadLease(comments);
    expect(lease.claim).toBeNull();
    expect(lease.run).toEqual([]);
    expect(lease.handoff).toMatchObject({ released: true, postedAt: RELEASED.createdAt });
    const live = threadLease(comments.slice(0, 1));
    expect(live.claim).toMatchObject({ postedAt: CLAIM.createdAt, url: comments[0].url });
  });

  it("every REST argv is a GET under this repository, and restRead refuses anything else", () => {
    const seen = [];
    const runner = (argv) => {
      seen.push(argv);
      if (argv[0] !== "api") graphqlRefused();
      if (argv.includes("repos/Pootytxng/sentinel/issues/12/comments?per_page=100&page=1")) return "[]";
      if (argv.includes("repos/Pootytxng/sentinel/pulls/395")) return JSON.stringify({ body: "Closes #12", base: "main" });
      if (argv.includes("repos/Pootytxng/sentinel/pulls/395/commits?per_page=100&page=1")) return "[]";
      throw new Error(`unexpected argv ${argv.join(" ")}`);
    };
    gate.issueCommentsVia(runner)(12);
    gate.closingIssuesVia(runner)(395);
    const rest = seen.filter((argv) => argv[0] === "api");
    expect(rest).toHaveLength(3);
    for (const argv of rest) {
      expect(argv.slice(0, 3)).toEqual(["api", "--method", "GET"]);
      expect(argv[3]).toMatch(/^repos\/Pootytxng\/sentinel\//);
      expect(argv).not.toContain("--paginate");
      expect(argv).not.toContain("--input");
      expect(argv).not.toContain("-f");
      expect(argv).not.toContain("-F");
    }
    for (const bad of [
      "repos/other/repo/issues/1/comments",
      "repos/Pootytxng/sentinel/issues/1 --method POST",
      "/repos/Pootytxng/sentinel/issues/1",
      // Nothing that could leave this repository or rewrite the request: no `..`, query, fragment or backslash.
      "repos/Pootytxng/sentinel/../other/issues/1",
      "repos/Pootytxng/sentinel/issues/1?per_page=1",
      "repos/Pootytxng/sentinel/issues/1#fragment",
      "repos/Pootytxng/sentinel\\issues\\1",
      "",
      null,
    ]) {
      expect(() => gate.restRead(bad, ".")).toThrow(/is not a path under repos\/Pootytxng\/sentinel\//);
      expect(() => gate.restList(() => "[]", bad)).toThrow(/is not a path under repos\/Pootytxng\/sentinel\//);
    }
  });

  it("reads a list page by explicit number and never --paginate: the hosted proxy refuses the numeric Link URLs --paginate follows", () => {
    // A full page of 100 means another page may exist; the reader asks for page 2 and stops at the
    // first short page. The thread's lease is read from both pages: the release on page 2 counts.
    const filler = Array.from({ length: 99 }, (_, i) => restRow(at("2026-10-21T09:01:00Z", `noise ${i}`)));
    const calls = [];
    const read = gate.issueCommentsVia((argv) => {
      calls.push(argv);
      if (argv[0] === "issue") graphqlRefused();
      return JSON.stringify(page(argv) === 1 ? [restRow(CLAIM), ...filler] : [restRow(RELEASED)]);
    });
    const comments = read(678);
    expect(comments).toHaveLength(101);
    expect(calls.slice(1).map((argv) => argv[3])).toEqual([
      "repos/Pootytxng/sentinel/issues/678/comments?per_page=100&page=1",
      "repos/Pootytxng/sentinel/issues/678/comments?per_page=100&page=2",
    ]);
    for (const argv of calls.slice(1)) expect(argv).not.toContain("--paginate");
    expect(threadLease(comments).handoff).toMatchObject({ released: true, postedAt: RELEASED.createdAt });
  });

  it("a page that is not a JSON array is a failed read, never an empty thread: unknown is not released", () => {
    const read = gate.issueCommentsVia((argv) => {
      if (argv[0] === "issue") graphqlRefused();
      return "<html>502</html>";
    });
    expect(() => read(678)).toThrow(/#678's thread could not be read over GraphQL .* nor over REST \(repos\/Pootytxng\/sentinel\/issues\/678\/comments page 1: not JSON/);
    const object = gate.issueCommentsVia((argv) => {
      if (argv[0] === "issue") graphqlRefused();
      return JSON.stringify({ message: "Not Found" });
    });
    expect(() => object(678)).toThrow(/page 1: expected a JSON array, got object/);
    const result = evaluateWorkControl(record({ transition: "close-issue", issue: 678 }), { issueComments: read });
    expect(result.decision).toBe("BLOCKED");
  });

  it("throws naming both transports when neither answers, and the close gate stays BLOCKED on it", () => {
    const read = gate.issueCommentsVia((argv) => {
      if (argv[0] === "issue") graphqlRefused();
      throw new Error("gh: HTTP 502: Bad Gateway");
    });
    expect(() => read(283)).toThrow(/#283's thread could not be read over GraphQL \(gh: HTTP 403: Forbidden \(https:\/\/api\.github\.com\/graphql\)\) nor over REST \(gh: HTTP 502: Bad Gateway\)/);
    const result = evaluateWorkControl(record({ transition: "close-issue", issue: 283 }), { issueComments: read });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283's thread could not be read/);
  });

  it("a GraphQL read the bound killed is not retried over REST (#474): one hang costs one bound, and the thread stays unreadable", () => {
    const calls = [];
    const silent = (argv) => {
      calls.push(argv);
      throw Object.assign(new Error("spawnSync gh ETIMEDOUT"), { code: "ETIMEDOUT", killed: true });
    };
    const thread = gate.issueCommentsVia(silent);
    expect(() => thread(283)).toThrow(
      /#283's thread could not be read: gh gave no answer within 20 s over GraphQL \(spawnSync gh ETIMEDOUT\), and a read the bound killed is not retried over REST \(#474\)/,
    );
    expect(calls).toEqual([["issue", "view", "283", "--repo", "Pootytxng/sentinel", "--json", "comments"]]);
    const refs = gate.closingIssuesVia(silent);
    expect(() => refs(395)).toThrow(/PR #395's closing references could not be read: gh gave no answer within 20 s over GraphQL/);
    expect(calls.map((argv) => argv[0])).toEqual(["issue", "pr"]);
    // A child the bound killed without an error code is the same hang.
    const killedOnly = gate.issueCommentsVia(() => {
      throw Object.assign(new Error("killed"), { killed: true });
    });
    expect(() => killedOnly(283)).toThrow(/not retried over REST/);
    // The bound every real read carries is the one the message names.
    expect(gate.GH_TIMEOUT_MS).toBe(20_000);
    const result = evaluateWorkControl(record({ transition: "close-issue", issue: 283 }), { issueComments: thread });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/#283's thread could not be read: gh gave no answer within 20 s/);
  });

  describe("closing references derived over REST when GraphQL's own list cannot be read", () => {
    const ref = (number, repo = "Pootytxng/sentinel", via = "body") => {
      const [login, name] = repo.split("/");
      return { number, repository: { name, owner: { login } }, url: `https://github.com/${repo}/issues/${number}`, derived: true, via };
    };

    it("over-approximates on purpose: every reference after a closing keyword counts, chained, fenced, any case", () => {
      const text = [
        "Closes #283, #284 and #285",
        "FIXES: Pootytxng/sentinel#286 & GH-287",
        "```",
        "resolved https://github.com/Pootytxng/sentinel/issues/288",
        "```",
        "See #289 (no keyword, so not closed)",
      ].join("\n");
      expect(gate.closingReferencesIn(text).map((r) => r.number)).toEqual([283, 284, 285, 286, 287, 288]);
      expect(gate.closingReferencesIn(text)).toEqual([283, 284, 285, 286, 287, 288].map((n) => ref(n)));
    });

    it("keeps a foreign repository on its reference, so the merge check can refuse it as before", () => {
      expect(gate.closingReferencesIn("Fixes other/repo#9 and closes https://github.com/someone/else/issues/10")).toEqual([
        ref(9, "other/repo"),
        ref(10, "someone/else"),
      ]);
    });

    it("merges body and commit references, dedups across them, and says how the list was derived", () => {
      const calls = [];
      const read = gate.closingIssuesVia((argv) => {
        calls.push(argv);
        if (argv[0] === "pr") graphqlRefused();
        if (argv.includes("repos/Pootytxng/sentinel/pulls/395")) return JSON.stringify({ body: "Closes #283", base: "main" });
        return JSON.stringify([{ commit: { message: "fix: resolves #283 again" } }, { commit: { message: "chore\n\nCloses #284" } }]);
      });
      const refs = read(395);
      expect([...refs]).toEqual([ref(283), ref(284, "Pootytxng/sentinel", "commit")]);
      expect(refs.derived).toMatch(/derived over REST from closing keywords in the body and 2 commit messages \(base main\)/);
      expect(refs.derived).toMatch(/GraphQL closingIssuesReferences could not be read \(gh: HTTP 403/);
      expect(calls.map((argv) => argv[0])).toEqual(["pr", "api", "api"]);
    });

    it("a merge over a derived list is BLOCKED on the derivation itself, and still names every live lease the list reaches", () => {
      // GitHub's closingIssuesReferences also carries the issues linked by hand in the PR sidebar, which no
      // REST field exposes: a derived list can be short, so it holds the merge (collision rule 5), while
      // the leases it does reach are still read and named.
      const derived = Object.assign([ref(283)], { derived: "GraphQL closingIssuesReferences could not be read (gh: HTTP 403); the list was derived over REST from closing keywords in the body and 0 commit messages (base main)" });
      const options = { closingIssues: () => derived, issueComments: (issue) => (issue === 283 ? [CLAIM] : []) };
      const held = evaluateWorkControl(record({ transition: "merge-pr", pr: 395 }), options);
      expect(held.decision).toBe("BLOCKED");
      const blockers = held.blockers.join("\n");
      expect(blockers).toMatch(/PR #395's closing references are derived, not GitHub's own closingIssuesReferences list: GraphQL closingIssuesReferences could not be read \(gh: HTTP 403\)/);
      expect(blockers).toMatch(/sidebar, which no REST field of a pull request exposes, so a derived list can be short/);
      expect(blockers).toMatch(/unknown means locked/);
      expect(blockers).toMatch(/#283 still has a live lease/);
      expect(held.warnings).toEqual([]);

      // A released lease removes that blocker and no other: the derivation alone still holds the merge.
      const released = evaluateWorkControl(record({ transition: "merge-pr", pr: 395 }), { ...options, issueComments: () => [CLAIM, RELEASED] });
      expect(released.decision).toBe("BLOCKED");
      expect(released.blockers).toHaveLength(1);
      expect(released.blockers[0]).toMatch(/closing references are derived/);
      expect(released.warnings).toEqual([]);
      expect(released.codes).toEqual([]);

      // GitHub's own list with the same reference: the released lease clears the merge.
      const own = evaluateWorkControl(record({ transition: "merge-pr", pr: 395 }), { closingIssues: () => [ref(283)], issueComments: () => [CLAIM, RELEASED] });
      expect(own.decision).toBe("PASS");
      expect(own.blockers).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// #445 option 2 (owner-accepted 2026-10-21): unknown board state is never a PASS and never an
// exemption. A proof-dependent receipt carries the authenticated fresh read it was written against,
// or the gate holds it with the ONE structured BOARD_UNREACHABLE blocker, in the same shape the push
// gate and the session hook use. A blocker contract, not an access repair.
// ---------------------------------------------------------------------------------------------
describe("the board has to have been read: BOARD_UNREACHABLE is one structured blocker (#445 option 2)", () => {
  const ready = (overrides = {}) => record({ transition: "mark-pr-ready", pr: 679, ...overrides });
  const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

  it("passes on an authenticated read inside the freshness window, with no codes", () => {
    const result = evaluateWorkControl(ready({ boardRead: { ...freshBoard(), readAt: minutesAgo(BOARD_FRESH_MINUTES - 1) } }));
    expect(result).toMatchObject({ decision: "PASS", blockers: [], codes: [], structuredBlockers: [] });
  });

  it.each([
    ["no boardRead at all", undefined, /records no boardRead/],
    ["a boardRead that admits the board was unreachable", { status: "unreachable", why: "gh: HTTP 403 (GraphQL refused)\nsecond line" }, /records the board as unreachable \(gh: HTTP 403 \(GraphQL refused\)\)/],
    ["a boardRead with the code as its status", { status: "BOARD_UNREACHABLE" }, /records the board as unreachable/],
    ["a cached read", { ...freshBoard(), status: "cached" }, /status is "cached", not "fresh"/],
    ["an unauthenticated read", { ...freshBoard(), authenticated: false }, /authenticated is not true/],
    ["a read older than the freshness window", { ...freshBoard(), readAt: minutesAgo(BOARD_FRESH_MINUTES + 1) }, /minutes old; a fresh read is under 10 minutes/],
    ["a read stamped in the future", { ...freshBoard(), readAt: new Date(Date.now() + 5 * 60_000).toISOString() }, /is after now/],
    ["a read with no timestamp", { ...freshBoard(), readAt: "yesterday" }, /is not an ISO-8601 timestamp/],
    ["a boardRead that is a string", "fresh", /must be an object/],
  ])("blocks mark-pr-ready on %s", (_, boardRead, why) => {
    const base = ready();
    if (boardRead === undefined) delete base.boardRead;
    else base.boardRead = boardRead;
    const result = evaluateWorkControl(base);
    expect(result.decision).toBe("BLOCKED");
    expect(result.codes).toEqual(["BOARD_UNREACHABLE"]);
    expect(result.structuredBlockers).toHaveLength(1);
    const [blocker] = result.structuredBlockers;
    expect(blocker).toMatchObject({ code: "BOARD_UNREACHABLE", transition: "mark-pr-ready" });
    expect(blocker.why).toMatch(why);
    expect(blocker.consequences).toEqual([...BOARD_UNREACHABLE_CONSEQUENCES]);
    expect(result.blockers[0]).toBe(renderBoardUnreachable(blocker));
    expect(result.blockers[0]).toMatch(/^BOARD_UNREACHABLE \(mark-pr-ready\): /);
    expect(gate.heldByBoard(result)).toBe(true);
  });

  it("holds every proof-dependent transition and none of the others", () => {
    for (const transition of ["mark-pr-ready", "close-superseded-pr", "merge-pr", "close-issue", "mark-done"]) {
      const base = record({ transition, pr: 679, issue: 678 });
      delete base.boardRead;
      const result = evaluateWorkControl(base, { issueComments: () => [], closingIssues: () => [] });
      expect(result.decision, transition).toBe("BLOCKED");
      expect(result.codes, transition).toEqual(["BOARD_UNREACHABLE"]);
      expect(result.structuredBlockers[0].transition, transition).toBe(transition);
    }
    for (const transition of ["claim", "comment", "open-draft-pr", "project-active", "project-review", "push-branch", "update-pr-description"]) {
      const base = record({ transition });
      delete base.boardRead;
      const result = evaluateWorkControl(base);
      expect(result.decision, transition).toBe("PASS");
      expect(result.codes, transition).toEqual([]);
      expect(gate.heldByBoard(result)).toBe(false);
    }
  });

  it("sits next to the other blockers rather than replacing them", () => {
    const base = ready({ gateResults: [EXACT_PASS[1]] });
    delete base.boardRead;
    const result = evaluateWorkControl(base);
    expect(result.decision).toBe("BLOCKED");
    expect(result.codes).toEqual(["BOARD_UNREACHABLE"]);
    expect(result.blockers.join("\n")).toMatch(/npm test has no exact passing receipt/);
    expect(result.blockers.join("\n")).toMatch(/BOARD_UNREACHABLE \(mark-pr-ready\)/);
  });

  it("the receipt's idea of fresh is the session hook's: BOARD_FRESH_MINUTES equals BOARD_TTL_MINUTES", () => {
    expect(BOARD_FRESH_MINUTES).toBe(BOARD_TTL_MINUTES);
    expect(BOARD_UNREACHABLE_CONSEQUENCES.join(" ")).toContain(`within ${BOARD_TTL_MINUTES} minutes`);
  });

  it("the push gate carries the same blocker when the open-issue list cannot be read", () => {
    const v = leaseOverlapVerdict({ changed: ["scripts/work-control-gate.mjs"], listError: "HTTP 502" });
    expect(v.ok).toBe(false);
    expect(v.codes).toEqual(["BOARD_UNREACHABLE"]);
    expect(v.structuredBlockers[0]).toMatchObject({ code: "BOARD_UNREACHABLE", transition: "push-branch", consequences: [...BOARD_UNREACHABLE_CONSEQUENCES] });
    expect(renderLeaseOverlap(v, { changed: ["scripts/work-control-gate.mjs"] })).toContain(
      "BOARD_UNREACHABLE (push-branch): open issues: the open-issue list could not be read: HTTP 502. Consequences:",
    );
    expect(leaseOverlapVerdict({ changed: ["scripts/work-control-gate.mjs"] }).codes).toEqual([]);
  });
});

describe("the lease and proof law stays loaded in every model bootstrap", () => {
  const flat = (path) => readFileSync(path, "utf8").replace(/\s+/g, " ");
  // Owner-ratified 2026-09-04 (#369 / PR #375): the permanent "Claude implements, Codex reviews"
  // split is retired. Lane labels are informational; a mutation lease per overlapping scope is the
  // only ownership. A bootstrap that restores the old split fails here and in
  // src/dynamic-mutation-lease-guard.test.ts, so the two guards agree on one law.
  const retired = [
    "Claude Code is the default implementation owner",
    "Codex is the default independent reviewer",
  ];
  const required = {
    "docs/WORK_CONTROL.md": [
      "one active mutation lease per overlapping scope",
      "A handoff transfers only mutation authority",
      "required gates cannot be substituted",
      "environment inability is **BLOCKED**, not PASS",
      "proof-dependent GitHub transition",
      "must not be one of the mutation authors",
      "node scripts/work-control-gate.mjs <receipt.json>",
    ],
    "AGENTS.md": [
      "one active mutation lease per overlapping scope",
      "a handoff transfers mutation authority only",
      "required gates cannot be substituted",
      "environment inability is BLOCKED, not PASS",
      "must not be one of the mutation authors",
      "scripts/work-control-gate.mjs",
    ],
    "CLAUDE.md": [
      "one active mutation lease per overlapping scope",
      "Handoffs transfer mutation authority only",
      "required gates cannot be substituted",
      "environment inability is a blocker, not a pass",
      "a reviewer who did not author the mutation being approved",
      "scripts/work-control-gate.mjs",
    ],
  };

  for (const [path, markers] of Object.entries(required)) {
    it(`${path} carries the canonical lease/proof contract and not the retired role split`, () => {
      const text = flat(path);
      const missing = markers.filter((marker) => !text.includes(marker));
      expect(missing, `${path} dropped lease/proof law markers`).toEqual([]);
      const restored = retired.filter((sentence) => text.includes(sentence));
      expect(restored, `${path} restored the retired permanent role split`).toEqual([]);
    });
  }
});
