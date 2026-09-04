// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  canonicalRemoteName,
  defaultOwnerFor,
  evaluateWorkControl as evaluateRaw,
  headProvenanceVia,
  mutationAuthorsFor,
  parseRemotes,
  remoteHeadShas,
} from "./work-control-gate.mjs";

const evaluateWorkControl = (receipt, options = {}) =>
  evaluateRaw(receipt, { headProvenance: () => ({ ok: true, why: "stubbed" }), ...options });

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const OTHER_HEAD = `${"0".repeat(39)}1`;

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
    leaseEvidence: "https://github.com/Pootytxng/sentinel/issues/49#issuecomment-current-lease",
    overlapExclusive: true,
    inheritedWork: true,
    inspection: INSPECTED,
    transition: "close-superseded-pr",
    currentHead: HEAD,
    mutationAuthors: ["codex"],
    requiredGates: ["npm test", "cargo test --manifest-path src-tauri/Cargo.toml"],
    gateResults: EXACT_PASS,
    independentReview: {
      practical: true,
      reviewer: "claude-code",
      status: "passed",
      head: HEAD,
    },
    ...overrides,
  };
}

describe("dynamic mutation lease model", () => {
  it("has no permanent implementation or review model", () => {
    expect(defaultOwnerFor("implementation")).toBe("best-fit-available");
    expect(defaultOwnerFor("independent-review")).toBe("non-authoring-reviewer");
  });

  it.each(["claude-code", "codex", "chatgpt-hq", "cowork"])(
    "allows %s to be the current executor when it holds the lease",
    (actor) => {
      const reviewer = actor === "claude-code" ? "codex" : "claude-code";
      const result = evaluateWorkControl(
        record({
          actor,
          mutationAuthors: [actor],
          independentReview: { practical: true, reviewer, status: "passed", head: HEAD },
        }),
      );
      expect(result.decision).toBe("PASS");
    },
  );

  it("rejects undeclared executors", () => {
    const result = evaluateWorkControl(record({ actor: "mystery-agent", mutationAuthors: ["mystery-agent"] }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/declared executor/i);
  });

  it("requires durable lease evidence, not a model default", () => {
    const result = evaluateWorkControl(record({ leaseEvidence: "", explicitHandoff: "" }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/lease evidence/i);
  });

  it("accepts historical explicitHandoff receipts as lease evidence", () => {
    const result = evaluateWorkControl(
      record({ leaseEvidence: undefined, explicitHandoff: "https://github.com/Pootytxng/sentinel/issues/49#handoff" }),
    );
    expect(result.decision).toBe("PASS");
  });

  it("requires exclusivity only for the overlapping bounded scope", () => {
    const result = evaluateWorkControl(record({ overlapExclusive: false, exclusiveWriter: false }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/overlapping bounded scope/i);
  });

  it("accepts the historical exclusiveWriter field for old receipts", () => {
    const result = evaluateWorkControl(record({ overlapExclusive: undefined, exclusiveWriter: true }));
    expect(result.decision).toBe("PASS");
  });

  it("blocks inherited work until repository/remote/worktree/branch/dirty/process truth is re-derived", () => {
    const result = evaluateWorkControl(
      record({ inspection: { ...INSPECTED, remoteState: false, liveProcesses: false } }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/remoteState/);
    expect(result.blockers.join("\n")).toMatch(/liveProcesses/);
  });

  it("deduplicates sequential mutation authors", () => {
    expect(mutationAuthorsFor(record({ mutationAuthors: ["claude-code", "codex", "claude-code"] }))).toEqual([
      "claude-code",
      "codex",
    ]);
  });

  it("falls back to the current actor for legacy single-author receipts", () => {
    expect(mutationAuthorsFor(record({ mutationAuthors: undefined, actor: "chatgpt-hq" }))).toEqual([
      "chatgpt-hq",
    ]);
  });

  it("does not demand independent review merely to claim/push/handoff ordinary work", () => {
    const result = evaluateWorkControl(
      record({
        transition: "push-branch",
        requiredGates: [],
        gateResults: [],
        independentReview: undefined,
      }),
    );
    expect(result.decision).toBe("PASS");
  });
});

describe("proof-dependent transitions", () => {
  it("blocks unknown transition names", () => {
    const result = evaluateWorkControl(record({ transition: "merge-ish" }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/unknown work-control transition/i);
  });

  it("treats an unavailable exact gate as BLOCKED even when a substitute passes", () => {
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

  it("rejects exact-gate receipts from a stale head", () => {
    const result = evaluateWorkControl(
      record({ gateResults: EXACT_PASS.map((gate) => ({ ...gate, head: OTHER_HEAD })) }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/current head/i);
  });

  it("rejects a non-40-character receipt head", () => {
    const result = evaluateWorkControl(record({ currentHead: "abc123", gateResults: [] }));
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/full 40-character commit SHA/i);
  });

  it("rejects a receipt head different from the repository head", () => {
    const result = evaluateWorkControl(
      record({
        currentHead: OTHER_HEAD,
        gateResults: EXACT_PASS.map((gate) => ({ ...gate, head: OTHER_HEAD })),
        independentReview: { practical: true, reviewer: "claude-code", status: "passed", head: OTHER_HEAD },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/repository is at/i);
  });

  it("blocks when the repository head cannot be resolved", () => {
    const result = evaluateWorkControl(record(), { resolveHead: () => null });
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/could not be resolved/i);
  });

  it("rejects review at an earlier head", () => {
    const result = evaluateWorkControl(
      record({ independentReview: { practical: true, reviewer: "claude-code", status: "passed", head: OTHER_HEAD } }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/independent review is recorded at/i);
  });

  it("rejects every mutation author as the exact-head reviewer", () => {
    const result = evaluateWorkControl(
      record({
        actor: "codex",
        mutationAuthors: ["claude-code", "codex"],
        independentReview: { practical: true, reviewer: "claude-code", status: "passed", head: HEAD },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/one of the mutation authors/i);
  });

  it("allows sequential Claude/Codex authors with an independent ChatGPT HQ review", () => {
    const result = evaluateWorkControl(
      record({
        actor: "codex",
        mutationAuthors: ["claude-code", "codex"],
        independentReview: { practical: true, reviewer: "chatgpt-hq", status: "passed", head: HEAD },
      }),
    );
    expect(result).toEqual({ decision: "PASS", blockers: [], warnings: [] });
  });

  it("requires a reason when independent review is genuinely impractical", () => {
    const result = evaluateWorkControl(
      record({ independentReview: { practical: false, reason: "" } }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/impracticality reason/i);
  });
});

describe("receipt provenance", () => {
  const ONE = "1".repeat(40);
  const TWO = "2".repeat(40);

  it("finds the canonical remote by URL and is not fooled by a fork", () => {
    for (const url of [
      "git@github.com:Pootytxng/sentinel.git",
      "https://github.com/Pootytxng/sentinel",
      "https://github.com/Pootytxng/sentinel.git/",
      "C:\\Users\\someone\\mirrors\\Pootytxng\\sentinel",
    ]) {
      expect(canonicalRemoteName([{ name: "whatever", url }]), url).toBe("whatever");
    }
    expect(canonicalRemoteName([{ name: "origin", url: "git@github.com:SomeoneElse/sentinel.git" }])).toBe(null);
  });

  it("parses remotes and only branch heads", () => {
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
    expect(remoteHeadShas(`${ONE}\trefs/heads/main\n${TWO}\trefs/tags/v1\n`)).toEqual([ONE]);
  });

  it("passes only when canonical remote tips reach the proof head", () => {
    const provenance = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n";
      if (args[0] === "ls-remote") return `${ONE}\trefs/heads/main\n`;
      if (args[0] === "cat-file") return "";
      if (args[0] === "rev-list") return "0\n";
      throw new Error(`unexpected git ${args[0]}`);
    });
    expect(provenance(TWO)).toEqual({ ok: true, why: "reachable from origin" });
  });

  it("blocks a local/fork/stale-only proof head", () => {
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

  it("blocks when canonical origin cannot be asked", () => {
    const provenance = headProvenanceVia((args) => {
      if (args[0] === "remote") return "origin\tgit@github.com:Pootytxng/sentinel.git (fetch)\n";
      throw new Error("offline");
    });
    expect(provenance(TWO)).toEqual({ ok: false, why: "origin could not be asked what it has" });
  });
});
