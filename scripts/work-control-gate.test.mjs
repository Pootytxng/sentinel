// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultOwnerFor, evaluateWorkControl } from "./work-control-gate.mjs";

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
  { command: "npm test", status: "passed", head: "abc123" },
  { command: "cargo test --manifest-path src-tauri/Cargo.toml", status: "passed", head: "abc123" },
];

function record(overrides = {}) {
  return {
    actor: "codex",
    explicitHandoff: "https://github.com/Pootytxng/sentinel/issues/49#issuecomment-current",
    exclusiveWriter: true,
    inheritedWork: true,
    inspection: INSPECTED,
    transition: "close-superseded-pr",
    currentHead: "abc123",
    requiredGates: ["npm test", "cargo test --manifest-path src-tauri/Cargo.toml"],
    gateResults: EXACT_PASS,
    independentReview: {
      practical: true,
      reviewer: "claude-code",
      writer: "codex",
      status: "passed",
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
          { command: "npm test", status: "unavailable", head: "abc123", reason: "sandbox policy" },
          { command: "npm test -- --exclude host-dependent", status: "passed", head: "abc123" },
          EXACT_PASS[1],
        ],
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/npm test.*unavailable.*blocker/i);
  });

  it("rejects exact gate receipts from any head other than the transition head", () => {
    const result = evaluateWorkControl(
      record({ gateResults: EXACT_PASS.map((gate) => ({ ...gate, head: "stale456" })) }),
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
      record({ independentReview: { practical: true, reviewer: "codex", writer: "codex", status: "passed" } }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/non-writing model/i);
  });

  it("binds the independent review to the actor who actually wrote the change", () => {
    const result = evaluateWorkControl(
      record({
        independentReview: {
          practical: true,
          reviewer: "claude-code",
          writer: "claude-code",
          status: "passed",
        },
      }),
    );
    expect(result.decision).toBe("BLOCKED");
    expect(result.blockers.join("\n")).toMatch(/receipt actor/i);
  });

  it("allows a proof-dependent transition only after exact current-head gates and independent review pass", () => {
    expect(evaluateWorkControl(record())).toEqual({ decision: "PASS", blockers: [], warnings: [] });
  });
});

describe("work-control receipt CLI", () => {
  function runReceipt(receipt) {
    const directory = mkdtempSync(join(tmpdir(), "compy-work-control-"));
    const path = join(directory, "receipt.json");
    writeFileSync(path, JSON.stringify(receipt), "utf8");
    try {
      return spawnSync(process.execPath, [resolve("scripts", "work-control-gate.mjs"), path], {
        encoding: "utf8",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("exits zero and prints PASS for a complete current-head receipt", () => {
    const result = runReceipt(record());
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ decision: "PASS", blockers: [], warnings: [] });
  });

  it("exits nonzero and prints BLOCKED when an exact required gate is unavailable", () => {
    const result = runReceipt(
      record({
        gateResults: [
          { command: "npm test", status: "unavailable", head: "abc123", reason: "no host access" },
          EXACT_PASS[1],
        ],
      }),
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).decision).toBe("BLOCKED");
  });
});

describe("the role and proof law stays loaded in both model lanes", () => {
  const flat = (path) => readFileSync(path, "utf8").replace(/\s+/g, " ");
  const required = {
    "docs/WORK_CONTROL.md": [
      "Claude Code is the default implementation owner",
      "Codex is the default independent reviewer",
      "explicit handoff",
      "one active implementation writer per scope",
      "required gates cannot be substituted",
      "environment inability is a blocker, not a pass",
      "proof-dependent GitHub transition",
      "non-writing model performs the final independent review whenever practical",
      "node scripts/work-control-gate.mjs <receipt.json>",
    ],
    "AGENTS.md": [
      "Claude Code is the default implementation owner",
      "Codex is the default independent reviewer",
      "explicit handoff",
      "scripts/work-control-gate.mjs",
    ],
    "CLAUDE.md": [
      "Claude Code is the default implementation owner",
      "Codex is the default independent reviewer",
      "explicit handoff",
      "required gates cannot be substituted",
      "environment inability is a blocker, not a pass",
      "scripts/work-control-gate.mjs",
    ],
  };

  for (const [path, markers] of Object.entries(required)) {
    it(`${path} carries the canonical role/proof contract`, () => {
      const text = flat(path);
      const missing = markers.filter((marker) => !text.includes(marker));
      expect(missing, `${path} dropped role/proof law markers`).toEqual([]);
    });
  }
});
