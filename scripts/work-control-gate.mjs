import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Resolve the repository head independently of the receipt asking for authorization. */
export function resolveRepoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// RECEIPT PROVENANCE
// Proof is useful only when the exact head is reachable from the canonical remote right now.
// Remote-tracking refs are intentionally not authority because they are only the last fetch.
// ---------------------------------------------------------------------------------------------

export const CANONICAL_REPO = "Pootytxng/sentinel";

export function canonicalRemoteName(remotes, repo = CANONICAL_REPO) {
  const want = repo.toLowerCase();
  const match = remotes.find((r) => {
    const url = String(r?.url ?? "")
      .toLowerCase()
      .replaceAll("\\", "/")
      .replace(/\/+$/, "")
      .replace(/\.git$/, "");
    return url.endsWith(`/${want}`) || url.endsWith(`:${want}`);
  });
  return match ? match.name : null;
}

export function parseRemotes(text) {
  const seen = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/);
    if (m && !seen.has(m[1])) seen.set(m[1], { name: m[1], url: m[2] });
  }
  return [...seen.values()];
}

export function remoteHeadShas(text) {
  return [...String(text).matchAll(/^([0-9a-f]{40})\s+refs\/heads\/\S+$/gm)].map((m) => m[1]);
}

export function headProvenanceVia(runner) {
  return (head) => {
    let remotes;
    try {
      remotes = parseRemotes(runner(["remote", "-v"]));
    } catch {
      return { ok: false, why: "the remote list could not be read" };
    }

    const remote = canonicalRemoteName(remotes);
    if (!remote) {
      return {
        ok: false,
        why: `no remote points at ${CANONICAL_REPO}, so there is no canonical evidence to be reachable from`,
      };
    }

    let live;
    try {
      live = remoteHeadShas(runner(["ls-remote", "--heads", remote]));
    } catch {
      return { ok: false, why: `${remote} could not be asked what it has` };
    }
    if (live.length === 0) return { ok: false, why: `${remote} reports no branches` };

    const known = live.filter((sha) => {
      try {
        runner(["cat-file", "-e", `${sha}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    });
    if (known.length === 0) {
      return {
        ok: false,
        why: `none of ${remote}'s current branch tips are in this checkout — fetch ${remote} and re-run`,
      };
    }

    try {
      const beyond = Number(String(runner(["rev-list", "--count", head, "--not", ...known])).trim());
      if (!Number.isFinite(beyond)) {
        return { ok: false, why: `the reachability count against ${remote} could not be read` };
      }
      return beyond === 0
        ? { ok: true, why: `reachable from ${remote}` }
        : {
            ok: false,
            why:
              `${beyond} commit(s) up to and including this head exist on no branch ${remote} ` +
              `currently has. A local-only, fork-only or stale-cached commit is not evidence a ` +
              `reviewer can fetch. Push this branch to ${remote} before using it for a transition`,
          };
    } catch {
      return { ok: false, why: `the reachability count against ${remote} could not be taken` };
    }
  };
}

export const canonicalHeadProvenance = headProvenanceVia((args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  }),
);

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

/** Eligible mutation/transition actors. Tool specialization is not jurisdiction. */
export const IMPLEMENTATION_ACTORS = new Set([
  "claude-code",
  "codex",
  "chatgpt-hq",
  "cowork",
]);

const REQUIRED_INSPECTION = [
  "repository",
  "remoteState",
  "worktree",
  "branch",
  "dirtyState",
  "liveProcesses",
];

/**
 * @deprecated Compatibility only for historical receipts/tests. Production dispatch MUST NOT use
 * this function to choose an executor. Current routing is live/capacity-based under WORK_CONTROL.
 * Search/guards keep this function out of selector/preflight/launcher decisions.
 */
export function defaultOwnerFor(kind) {
  if (kind === "implementation") return "claude-code";
  if (kind === "independent-review") return "codex";
  throw new Error(`unknown work kind: ${kind}`);
}

const uniq = (xs) => [...new Set(xs)];

/** All executors that mutated the proof delta, not merely the holder of the final lease. */
export function mutationAuthorsFor(record) {
  const supplied = Array.isArray(record?.mutationAuthors)
    ? record.mutationAuthors.map((x) => String(x).trim()).filter(Boolean)
    : [];
  return uniq([String(record?.actor ?? "").trim(), ...supplied].filter(Boolean));
}

export function evaluateWorkControl(
  record,
  { resolveHead = resolveRepoHead, headProvenance = canonicalHeadProvenance } = {},
) {
  const blockers = [];
  const warnings = [];

  const actor = String(record?.actor ?? "").trim();
  if (!IMPLEMENTATION_ACTORS.has(actor)) {
    blockers.push(
      "The implementation actor must be a declared executor (claude-code, codex, chatgpt-hq, or cowork).",
    );
  }

  if (
    !PROOF_DEPENDENT_TRANSITIONS.has(record?.transition) &&
    !NON_PROOF_TRANSITIONS.has(record?.transition)
  ) {
    blockers.push(`Unknown work-control transition: ${record?.transition ?? "(missing)"}.`);
  }

  // New receipts call this leaseEvidence. Historical receipts called the same durable task record an
  // explicitHandoff, so both remain readable while the runtime semantics move to mutation leases.
  const leaseEvidence = String(record?.leaseEvidence ?? record?.explicitHandoff ?? "").trim();
  if (!leaseEvidence) {
    blockers.push(
      "Implementation ownership requires durable lease evidence (historical receipts: an explicit handoff) recorded on the task.",
    );
  }

  // Historical receipts use exclusiveWriter. New receipts should use overlapExclusive, because the
  // invariant is exclusivity of overlapping bounded mutation, not a permanent single-model department.
  if (record?.overlapExclusive !== true && record?.exclusiveWriter !== true) {
    blockers.push(
      "Implementation ownership requires one exclusive writer for the overlapping bounded scope (overlapExclusive).",
    );
  }

  if (record?.inheritedWork === true) {
    for (const field of REQUIRED_INSPECTION) {
      if (record?.inspection?.[field] !== true) {
        blockers.push(`Inherited work inspection is incomplete: ${field} was not verified current.`);
      }
    }
  }

  // A declaration supplements the known actor; it cannot remove that actor from review checks.
  if (record?.mutationAuthors !== undefined) {
    if (!Array.isArray(record.mutationAuthors)) {
      blockers.push("mutationAuthors must be an array when supplied.");
    } else if (!record.mutationAuthors.some((author) => String(author).trim() === actor)) {
      blockers.push("mutationAuthors must include the receipt actor when supplied.");
    }
  }
  const authors = mutationAuthorsFor(record);
  for (const author of authors) {
    if (!IMPLEMENTATION_ACTORS.has(author)) {
      blockers.push(`Unknown mutation author "${author}" in mutationAuthors.`);
    }
  }

  if (PROOF_DEPENDENT_TRANSITIONS.has(record?.transition)) {
    const currentHead = String(record?.currentHead ?? "").trim();
    const requiredGates = Array.isArray(record?.requiredGates) ? record.requiredGates : [];
    const gateResults = Array.isArray(record?.gateResults) ? record.gateResults : [];

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
        blockers.push(`The receipt claims head ${currentHead}, but the repository is at ${actualHead}.`);
      } else {
        const provenance = headProvenance(currentHead);
        if (!provenance?.ok) {
          blockers.push(
            `The receipt is not durably reachable: ` +
              `${provenance?.why ?? "provenance could not be established"}. A merge or close ` +
              `receipt authorizes a transition on the canonical repository, so its evidence has ` +
              `to survive this checkout.`,
          );
        }
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
      const reviewer = String(review?.reviewer ?? "").trim();

      // Historical receipts explicitly named the final lease holder in review.writer. Preserve that
      // consistency check when the field exists; new multi-author receipts may omit it and rely on
      // mutationAuthors instead.
      if (review?.writer && review.writer !== actor) {
        blockers.push("The independent-review writer must match the receipt actor.");
      }

      if (review?.practical !== true || review?.status !== "passed" || !reviewer) {
        blockers.push(
          "Final review must pass with a non-writing model/reviewer whenever that review is practical.",
        );
      }

      if (reviewer && authors.includes(reviewer)) {
        blockers.push(
          `Final review must pass with a non-writing model/reviewer: ${reviewer} is one of the mutation authors (${authors.join(", ")}).`,
        );
      }

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
