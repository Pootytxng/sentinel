import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PROOF_DEPENDENT_TRANSITIONS = new Set([
  "mark-pr-ready",
  "close-superseded-pr",
  "merge-pr",
  "close-issue",
  "mark-done",
]);

const NON_PROOF_TRANSITIONS = new Set([
  "claim",
  "comment",
  "open-draft-pr",
  "project-active",
  "project-review",
  "push-branch",
  "update-pr-description",
]);

const IMPLEMENTATION_ACTORS = new Set(["claude-code", "codex"]);

const REQUIRED_INSPECTION = [
  "repository",
  "remoteState",
  "worktree",
  "branch",
  "dirtyState",
  "liveProcesses",
];

export function defaultOwnerFor(kind) {
  if (kind === "implementation") return "claude-code";
  if (kind === "independent-review") return "codex";
  throw new Error(`unknown work kind: ${kind}`);
}

export function evaluateWorkControl(record) {
  const blockers = [];
  const warnings = [];

  if (!IMPLEMENTATION_ACTORS.has(record?.actor)) {
    blockers.push("The implementation actor must be either claude-code or codex.");
  }

  if (
    !PROOF_DEPENDENT_TRANSITIONS.has(record?.transition) &&
    !NON_PROOF_TRANSITIONS.has(record?.transition)
  ) {
    blockers.push(`Unknown work-control transition: ${record?.transition ?? "(missing)"}.`);
  }

  if (!String(record?.explicitHandoff ?? "").trim()) {
    blockers.push("Implementation ownership requires an explicit handoff recorded on the task.");
  }
  if (record?.exclusiveWriter !== true) {
    blockers.push("Implementation ownership requires one exclusive writer for the bounded scope.");
  }

  if (record?.inheritedWork === true) {
    for (const field of REQUIRED_INSPECTION) {
      if (record?.inspection?.[field] !== true) {
        blockers.push(`Inherited work inspection is incomplete: ${field} was not verified current.`);
      }
    }
  }

  if (PROOF_DEPENDENT_TRANSITIONS.has(record?.transition)) {
    const currentHead = String(record?.currentHead ?? "").trim();
    const requiredGates = Array.isArray(record?.requiredGates) ? record.requiredGates : [];
    const gateResults = Array.isArray(record?.gateResults) ? record.gateResults : [];

    if (!currentHead) blockers.push("A proof-dependent GitHub transition requires the current head SHA.");
    if (requiredGates.length === 0) {
      blockers.push("A proof-dependent GitHub transition requires at least one exact named gate.");
    }

    for (const command of requiredGates) {
      const exact = gateResults.filter((result) => result?.command === command);
      const passedCurrentHead = exact.some(
        (result) => result?.status === "passed" && result?.head === currentHead,
      );
      if (passedCurrentHead) continue;

      const unavailable = exact.find((result) => result?.status === "unavailable");
      if (unavailable) {
        blockers.push(
          `${command} is unavailable${unavailable.reason ? ` (${unavailable.reason})` : ""}; ` +
            "environment inability is a blocker, and substitute gates do not count as a pass.",
        );
        continue;
      }

      const passedStaleHead = exact.find((result) => result?.status === "passed");
      if (passedStaleHead) {
        blockers.push(
          `${command} passed at ${passedStaleHead.head ?? "an unknown head"}, not the current head ${currentHead}.`,
        );
      } else {
        blockers.push(`${command} has no exact passing receipt for the current head.`);
      }
    }

    const review = record?.independentReview;
    if (review?.practical === false) {
      if (!String(review?.reason ?? "").trim()) {
        blockers.push("Skipping final independent review requires a concrete impracticality reason.");
      } else {
        warnings.push(`Independent review not practical: ${review.reason}`);
      }
    } else {
      if (review?.writer !== record?.actor) {
        blockers.push("The independent-review writer must match the receipt actor.");
      }
      if (
        review?.practical !== true ||
        review?.status !== "passed" ||
        !review?.reviewer ||
        review?.reviewer === review?.writer
      ) {
        blockers.push("Final review must pass with a non-writing model whenever that review is practical.");
      }
    }
  }

  return blockers.length > 0
    ? { decision: "BLOCKED", blockers, warnings }
    : { decision: "PASS", blockers, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receiptPath = process.argv[2];
  if (!receiptPath) {
    console.error("usage: node scripts/work-control-gate.mjs <receipt.json>");
    process.exitCode = 2;
  } else {
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      const verdict = evaluateWorkControl(receipt);
      console.log(JSON.stringify(verdict, null, 2));
      process.exitCode = verdict.decision === "PASS" ? 0 : 1;
    } catch (error) {
      console.error(`work-control-gate: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  }
}
