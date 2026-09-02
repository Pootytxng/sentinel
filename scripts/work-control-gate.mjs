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

// ---------------------------------------------------------------------------------------------
// RECEIPT PROVENANCE (#291, design requirement 4)
//
// Everything above proves the receipt is INTERNALLY sound: the head is real on this disk, the gates
// passed at that head, the review covers it. None of it asks the question that actually matters for
// a transition on GitHub -- whether the evidence exists anywhere but this one machine.
//
// It does not, by default. `git rev-parse HEAD` answers from the local object store, so a commit
// that has never been pushed, a commit on a fork, and a commit reachable only through a
// remote-tracking ref left behind by an old fetch all read identically to a commit origin actually
// has. A receipt bound to any of those authorizes merging or closing on the strength of evidence
// that disappears with the folder it lives in. That is the same defect as a detached checkout
// holding the only copy of its work, one level up: the proof, not the code.
//
// So a proof-dependent transition additionally requires the head to be reachable from the CANONICAL
// remote, asked live. Three things are deliberately not consulted:
//
//   - `refs/remotes/origin/*`, which is the last fetch rather than origin. A ref origin has pruned
//     still sits there and would launder an unreachable commit to "pushed" (measured in #312 for
//     the disposition audit's own exclusion set; the same trap, a different caller).
//   - any remote that is not the canonical repository. A fork can carry the commit and the receipt
//     still be worthless: the merge happens on the canonical repo, and evidence a reviewer there
//     cannot fetch is evidence nobody can check.
//   - the receipt's own claim about any of this, for the reason `resolveRepoHead` exists.
//
// Fail-closed, and it says which way it failed. An unreachable origin BLOCKS rather than passing --
// environment inability is a blocker in this repo, not a pass -- and the message distinguishes
// "origin could not be asked" from "origin does not have this commit", because the fixes are
// different and a wrong cause costs more than a red.
// ---------------------------------------------------------------------------------------------

/** The repository a receipt's evidence has to be reachable from. A fork is not it. */
export const CANONICAL_REPO = "Pootytxng/sentinel";

/**
 * Which of `git remote -v`'s remotes IS the canonical repository, by URL rather than by being named
 * `origin`. Pure, so the URL shapes below are falsifiable without a repository: ssh, https, with and
 * without `.git`, and a fork of the same repo name under another owner -- which must NOT match, and
 * is the case a name check would have got wrong.
 */
export function canonicalRemoteName(remotes, repo = CANONICAL_REPO) {
  const want = repo.toLowerCase();
  const match = remotes.find((r) => {
    // A remote can be an ssh URL, an https URL, or a plain filesystem path — and on Windows that
    // path is separated by backslashes, which is why the separators are normalised before the
    // owner/name is matched rather than after.
    const url = String(r?.url ?? "")
      .toLowerCase()
      .replaceAll("\\", "/")
      .replace(/\/+$/, "")
      .replace(/\.git$/, "");
    return url.endsWith(`/${want}`) || url.endsWith(`:${want}`);
  });
  return match ? match.name : null;
}

/** `git remote -v` -> [{ name, url }], deduplicated across its fetch/push pairs. */
export function parseRemotes(text) {
  const seen = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/);
    if (m && !seen.has(m[1])) seen.set(m[1], { name: m[1], url: m[2] });
  }
  return [...seen.values()];
}

/** The commit ids `git ls-remote --heads` reports, which is what the remote has RIGHT NOW. */
export function remoteHeadShas(text) {
  return [...String(text).matchAll(/^([0-9a-f]{40})\s+refs\/heads\/\S+$/gm)].map((m) => m[1]);
}

/**
 * Is `head` reachable from something the canonical remote currently has?
 *
 * `runner` is injected and takes a git argv, so every branch below -- no canonical remote, an
 * unreachable one, a commit origin does not have, a live sha whose object is missing locally -- is
 * falsifiable without a network or a fixture repository.
 */
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
    if (live.length === 0) {
      return { ok: false, why: `${remote} reports no branches` };
    }
    // Only the live shas this checkout actually holds can bound anything: rev-list cannot walk an
    // object it does not have. Dropping the rest is what makes an unfetched origin BLOCK rather than
    // silently narrow the evidence set -- if that leaves nothing, the answer below is "not reachable".
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
              `reviewer can fetch. Push this branch to ${remote} — or, if it already landed and ` +
              `the branch was pruned, take the transition from a checkout at the commit that ` +
              `landed, because a squashed lane is an ancestor of nothing`,
          };
    } catch {
      return { ok: false, why: `the reachability count against ${remote} could not be taken` };
    }
  };
}

export const canonicalHeadProvenance = headProvenanceVia((args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }),
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

export function evaluateWorkControl(
  record,
  { resolveHead = resolveRepoHead, headProvenance = canonicalHeadProvenance } = {},
) {
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
      } else {
        // The head is real HERE. Whether it is real anywhere else is a separate question, and
        // it is the one a reviewer on GitHub actually depends on.
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
