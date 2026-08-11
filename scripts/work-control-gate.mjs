import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// A commit id, not a label. `abc123` is neither — an abbreviated or invented head cannot be matched
// against the repository, and every binding below is only as good as the head it binds to.
const FULL_SHA = /^[0-9a-f]{40}$/;

/** The head the repository is ACTUALLY on, or null when git can't answer. Never trust the receipt's
    own `currentHead`: it is written by the same actor that is asking for authorization, so on its
    own it authorizes a transition against a head that may not exist. */
export function resolveRepoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

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

export function evaluateWorkControl(record, { resolveHead = resolveRepoHead } = {}) {
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

    // The head is checked against the repository BEFORE anything is bound to it. Without this the
    // gate only proves internal consistency: a receipt that writes the same made-up SHA into
    // `currentHead` and into every gate result passes every binding below and authorizes a
    // transition whose proof was never run anywhere.
    if (!currentHead) {
      blockers.push("A proof-dependent GitHub transition requires the current head SHA.");
    } else if (!FULL_SHA.test(currentHead)) {
      blockers.push(
        `currentHead "${currentHead}" is not a full 40-character commit SHA, so it cannot be ` +
          "matched against the repository.",
      );
    } else {
      const actualHead = resolveHead();
      if (!actualHead) {
        blockers.push(
          "The repository head could not be resolved (git rev-parse HEAD failed), so no receipt " +
            "can be bound to it; environment inability is a blocker, not a pass.",
        );
      } else if (actualHead !== currentHead) {
        blockers.push(
          `The receipt claims head ${currentHead}, but the repository is at ${actualHead}.`,
        );
      }
    }

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
      // Gates were bound to the head; the review has to be too. A review of an earlier head is a
      // review of different code — the commits that came after it are exactly the unreviewed ones.
      if (currentHead && review?.head !== currentHead) {
        blockers.push(
          `The independent review is recorded at ${review?.head ?? "no head"}, not the current head ` +
            `${currentHead}; a review of earlier code does not cover the commits after it.`,
        );
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
