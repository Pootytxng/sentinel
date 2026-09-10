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

// Provenance has its own describe block below, with its own falsifications. Every case in the
// blocks before it is about what the receipt itself proves, so they run against a remote that
// says yes: a test that silently depended on the network would be measuring the network. The same
// holds for the issue thread a close reads (#411): a case that needs one hands it in, and any other
// read is refused here rather than sent to GitHub.
const evaluateWorkControl = (receipt, options = {}) =>
  evaluateRaw(receipt, {
    headProvenance: () => ({ ok: true, why: "stubbed" }),
    issueComments: () => {
      throw new Error("stubbed: this case reads no issue thread");
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

  it("rejects an implementation actor outside the two declared model lanes", () => {
    const result = evaluateWorkControl(record({ actor: "unknown-agent" }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/implementation actor/i);
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
    ["claude-code", "codex", "chatgpt-hq", "cowork"].flatMap((author) => [
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
    expect(evaluateWorkControl(record())).toEqual({ decision: "PASS", blockers: [], warnings: [] });
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
  const PASSED = { decision: "PASS", blockers: [], warnings: [] };

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

  it("leaves merge-pr alone: that transition reads no thread", () => {
    expect(evaluateWorkControl(record({ transition: "merge-pr", issue: 283 }))).toEqual(PASSED);
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
      independentReview: { ...record().independentReview, head },
    });
  }

  it("exits zero and prints PASS for a complete receipt origin can actually reach", () => {
    const repo = makeRepo();
    const result = runReceipt(at(repo.pushed), repo.work);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ decision: "PASS", blockers: [], warnings: [] });
  });

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
  });

  it("refuses a receipt whose head has never left this disk", () => {
    const repo = makeRepo();
    writeFileSync(join(repo.work, "a.txt"), "two", "utf8");
    repo.git("commit", "-q", "-am", "two");
    const local = repo.git("rev-parse", "HEAD");
    expect(local).not.toBe(repo.pushed);
    const result = runReceipt(at(local), repo.work);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).blockers.join("\n")).toMatch(/not durably reachable/i);
  });

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
  });

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
  });

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
