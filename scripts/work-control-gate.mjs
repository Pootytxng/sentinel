import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { threadLease } from "../tools/entry/claim.mjs";
import { BOARD_UNREACHABLE, boardReadFreshness, boardUnreachableBlocker, renderBoardUnreachable } from "./lib/board-blocker.mjs";
import { readAllPagesSync } from "./lib/rest-pages.mjs";

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

// ---------------------------------------------------------------------------------------------
// A CLOSE ENDS THE LEASE (#411)
// On this board, closing an issue and marking its item Done are one transition: the project's
// "Item closed" workflow sets Done when the issue closes, and "Auto-close issue" closes the issue
// when Done is set. Done tells every reader that no writer holds the item. On 2026-09-10 #283 was
// closed while its lease was live, and it read Done for three and a half minutes before any
// Handoff. So both transitions read the issue's thread first and refuse while a lease is live on
// it. A thread that cannot be read refuses too, because an unknown lease is not a released one.
// ---------------------------------------------------------------------------------------------

const LEASE_ENDING_TRANSITIONS = new Set(["close-issue", "mark-done"]);

// ---------------------------------------------------------------------------------------------
// TWO READ-ONLY TRANSPORTS BEHIND ONE READER (#445 option 1)
// `gh issue view --json` and `gh pr view --json` go through GitHub GraphQL, which the hosted lane's
// proxy refuses (403) while REST (`gh api repos/...`) answers. So each reader tries GraphQL first and,
// only when that read fails, the same facts over REST. Both transports are reads: every REST argv is
// built by restRead(), which pins `--method GET` and a path under this repository, and the test pins
// that no fallback ever issues anything else. A reader that fails both ways throws naming both: a
// thread that cannot be read is still not a released one. This is a second transport for the SAME
// answer, never a write route and never a substitute for the board read the receipt has to carry.
// ---------------------------------------------------------------------------------------------

const REST_REPO_PATH = `repos/${CANONICAL_REPO}/`;

/** A path this gate may read: under this repository, no whitespace. Anything else is refused here. */
function restPath(path) {
  const p = String(path ?? "");
  if (!p.startsWith(REST_REPO_PATH) || /[\s]/.test(p)) {
    throw new Error(`restRead: ${JSON.stringify(path)} is not a path under ${REST_REPO_PATH}`);
  }
  return p;
}

/** The argv of one bounded REST read of ONE object. GET only, this repository only. Lists go through restList. */
export function restRead(path, jq) {
  return ["api", "--method", "GET", restPath(path), "--jq", String(jq)];
}

/**
 * Every item of a list under this repository, page by explicit number (scripts/lib/rest-pages.mjs).
 * Never `--paginate`: it follows a Link header in the numeric `repositories/{id}` form, which the
 * hosted lane's proxy refuses, so the second page of anything failed from claude.ai/code.
 */
export function restList(runner, path) {
  return readAllPagesSync(runner, restPath(path));
}

/** gh's `--jq` output: one compact JSON value per line. A line that does not parse is a failed read. */
function parseJsonLines(raw) {
  return String(raw ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const bothFailed = (what, primary, fallback) =>
  new Error(`${what} could not be read over GraphQL (${firstLineOf(primary)}) nor over REST (${firstLineOf(fallback)})`);

/**
 * A reader of an issue's comments, in posting order, through `gh` (injected): GraphQL first, REST
 * when GraphQL fails. The REST shape is folded to the one threadLease reads (`body`, `createdAt`,
 * `url`), so the lease a thread shows does not depend on which transport answered.
 */
export function issueCommentsVia(runner) {
  return (issue) => {
    let primaryError;
    try {
      const raw = runner(["issue", "view", String(issue), "--repo", CANONICAL_REPO, "--json", "comments"]);
      const comments = JSON.parse(raw).comments;
      if (!Array.isArray(comments)) throw new Error("gh returned no comment list");
      return comments;
    } catch (error) {
      primaryError = error;
    }
    try {
      return restList(runner, `${REST_REPO_PATH}issues/${Number(issue)}/comments`).map((c) => ({
        body: c.body,
        createdAt: c.created_at,
        url: c.html_url,
        author: { login: c.user?.login ?? null },
        transport: "rest",
      }));
    } catch (fallbackError) {
      throw bothFailed(`#${issue}'s thread`, primaryError, fallbackError);
    }
  };
}

const GH_RUN_OPTIONS = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000, maxBuffer: 64 * 1024 * 1024 };
const ghRunner = (args) => execFileSync("gh", args, GH_RUN_OPTIONS);

/** The issue's comments in posting order, straight from GitHub. Throws when they cannot be read. */
const readIssueComments = issueCommentsVia(ghRunner);

/** The issues a close names: one positive issue number, or a list of them. Anything else is null. */
function issuesClosedBy(record) {
  const named = Array.isArray(record?.issue) ? record.issue : [record?.issue];
  return named.length > 0 && named.every((n) => Number.isInteger(n) && n > 0) ? named : null;
}

const firstLineOf = (error) => String(error instanceof Error ? error.message : error).split("\n")[0];

/**
 * The per-issue thread read both routes share. `how` says why the transition ends the issue's lease,
 * and `then` names the step the Handoff has to come before.
 */
function leaseBlockers(issues, issueComments, { how, then }) {
  const blockers = [];
  for (const issue of issues) {
    let lease;
    try {
      lease = threadLease(issueComments(issue));
    } catch (error) {
      blockers.push(
        `#${issue}'s thread could not be read (${firstLineOf(error)}), so whether its lease was released is unknown; ` +
          "environment inability is a blocker, not a pass.",
      );
      continue;
    }
    if (lease.claim) {
      blockers.push(
        `#${issue} still has a live lease: the ownership claim posted ${lease.claim.postedAt} has no newer ` +
          `Handoff releasing it. ${how ? `${how} ` : ""}Closing the issue sets its item Done (the project's "Item closed" ` +
          "workflow), which tells every reader that no writer holds it; #283 read Done that way on 2026-09-10. " +
          `Post the Handoff first, ending "- Claim: released" (planRelease moves the item to Review), then ${then}.`,
      );
    }
  }
  return blockers;
}

function closeLeaseBlockers(record, issueComments) {
  const issues = issuesClosedBy(record);
  if (!issues) {
    return [
      `A ${record?.transition} receipt must name its issue (a positive issue number, or a list of them): ` +
        "on this board that transition closes the issue and marks it Done, so the gate reads the issue's lease first.",
    ];
  }
  return leaseBlockers(issues, issueComments, { how: "", then: "close" });
}

// ---------------------------------------------------------------------------------------------
// A MERGE CLOSES WHAT ITS PR LISTS (#413)
// Merging a PR closes every issue in its closingIssuesReferences, which GitHub fills from a closing
// keyword in the body or in any of its commits, and "Item closed" then sets Done. So a merge-pr
// receipt is held to the same lease check, over the issues the PR lists, never over the receipt's own
// `issue`. Every reference must be a plain issue number in this repository: a lease the gate cannot
// read is not a released one.
// ---------------------------------------------------------------------------------------------

// GitHub fills closingIssuesReferences from a closing keyword before an issue reference, in the PR
// body or in any of its commits. REST has no such field, so the fallback derives the list from the
// same two sources with the same keywords, and deliberately OVER-approximates: every keyword before a
// `#n`, `owner/repo#n`, `GH-n` or issues URL counts, chained ones included, code fences included,
// whatever the base branch. More references mean more leases read, never fewer, so a derived list can
// only add refusals. The reader marks it `derived`, and the merge check carries that as a warning.
const CLOSING_KEYWORD = /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b:?/gi;
const REFERENCE_AT_START =
  /^(?:#(\d+)|([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)|GH-(\d+)|https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\b)/;
const REFERENCE_SEPARATOR = /^[ \t]*(?:,|and\b|&)?[ \t]*/;

/**
 * Every issue reference a closing keyword in `text` points at, in the shape closingIssuesReferences
 * uses (`number`, `repository.owner.login`, `repository.name`, `url`) plus `derived: true` and the
 * source (`via`). A bare `#n` or `GH-n` is in this repository; `owner/repo#n` and a URL keep their
 * repository, so the merge check can refuse a reference outside this one as it already does.
 */
export function closingReferencesIn(text, via = "body") {
  const refs = [];
  const seen = new Set();
  const source = String(text ?? "");
  CLOSING_KEYWORD.lastIndex = 0;
  for (let m = CLOSING_KEYWORD.exec(source); m; m = CLOSING_KEYWORD.exec(source)) {
    let rest = source.slice(m.index + m[0].length);
    for (;;) {
      rest = rest.replace(REFERENCE_SEPARATOR, "");
      const r = REFERENCE_AT_START.exec(rest);
      if (!r) break;
      const [owner, name] = r[2] ? [r[2], r[3]] : r[6] ? [r[6], r[7]] : CANONICAL_REPO.split("/");
      const number = Number(r[1] ?? r[4] ?? r[5] ?? r[8]);
      const key = `${owner}/${name}#${number}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          number,
          repository: { name, owner: { login: owner } },
          url: `https://github.com/${owner}/${name}/issues/${number}`,
          derived: true,
          via,
        });
      }
      rest = rest.slice(r[0].length);
    }
  }
  return refs;
}

/**
 * A reader of a PR's closingIssuesReferences through `gh` (injected): GraphQL first (GitHub's own
 * list), and when that fails the list derived over REST from the PR body and every commit message.
 * Throws when neither transport answers. A derived list is tagged `derived` on the array itself.
 */
export function closingIssuesVia(runner) {
  return (pr) => {
    let primaryError;
    try {
      const refs = JSON.parse(runner(["pr", "view", String(pr), "--repo", CANONICAL_REPO, "--json", "closingIssuesReferences"]))
        .closingIssuesReferences;
      if (!Array.isArray(refs)) throw new Error("gh returned no closingIssuesReferences list");
      return refs;
    } catch (error) {
      primaryError = error;
    }
    try {
      const n = Number(pr);
      const [view] = parseJsonLines(runner(restRead(`${REST_REPO_PATH}pulls/${n}`, "{body, base: .base.ref}")));
      if (!view || typeof view !== "object") throw new Error("gh api returned no pull request");
      const commits = restList(runner, `${REST_REPO_PATH}pulls/${n}/commits`).map((c) => ({ message: c?.commit?.message }));
      const refs = closingReferencesIn(view.body, "body");
      const seen = new Set(refs.map((r) => `${repoOf(r)}#${r.number}`.toLowerCase()));
      for (const commit of commits) {
        for (const ref of closingReferencesIn(commit?.message, "commit")) {
          const key = `${repoOf(ref)}#${ref.number}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            refs.push(ref);
          }
        }
      }
      return Object.assign(refs, {
        derived: `GraphQL closingIssuesReferences could not be read (${firstLineOf(primaryError)}); the list was derived over REST from closing keywords in the body and ${commits.length} commit message${commits.length === 1 ? "" : "s"} (base ${view.base ?? "unknown"})`,
      });
    } catch (fallbackError) {
      throw bothFailed(`PR #${pr}'s closing references`, primaryError, fallbackError);
    }
  };
}

const readClosingIssues = closingIssuesVia(ghRunner);

const repoOf = (reference) => {
  const owner = reference?.repository?.owner?.login;
  const name = reference?.repository?.name;
  return owner && name ? `${owner}/${name}` : null;
};

function mergeLeaseBlockers(record, { closingIssues, issueComments, warnings = [] }) {
  const pr = record?.pr;
  if (!Number.isInteger(pr) || pr <= 0) {
    return [
      "A merge-pr receipt must name its PR (a positive PR number in `pr`): merging closes every issue the PR " +
        "lists in closingIssuesReferences, so the gate reads those issues' leases first.",
    ];
  }
  let refs;
  try {
    refs = closingIssues(pr);
    if (!Array.isArray(refs)) throw new Error("the reader returned no list of references");
  } catch (error) {
    return [
      `PR #${pr}'s closing references could not be read (${firstLineOf(error)}), so which issues its merge ` +
        "closes is unknown; environment inability is a blocker, not a pass.",
    ];
  }
  if (refs.derived) {
    warnings.push(
      `PR #${pr}'s closing references are derived, not GitHub's own list: ${refs.derived}. The derivation ` +
        "over-approximates (every closing keyword before a reference counts), so it can add lease reads, never drop one.",
    );
  }
  const blockers = [];
  const issues = [];
  for (const reference of refs) {
    const number = reference?.number;
    const repo = repoOf(reference);
    if (!Number.isInteger(number) || number <= 0) {
      blockers.push(
        `PR #${pr} lists a reference with no plain issue number (${JSON.stringify(number ?? null)}), so its lease ` +
          "cannot be read.",
      );
    } else if (!repo || repo.toLowerCase() !== CANONICAL_REPO.toLowerCase()) {
      blockers.push(
        `PR #${pr} lists an issue outside ${CANONICAL_REPO} (${repo ?? "no repository named"}#${number}); this gate ` +
          "reads leases only in this repository, and a lease it cannot read is not a released one.",
      );
    } else {
      issues.push(number);
    }
  }
  blockers.push(
    ...leaseBlockers(issues, issueComments, {
      how: `PR #${pr} lists it as an issue its merge closes (closingIssuesReferences).`,
      then: "merge",
    }),
  );
  return blockers;
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

/** Eligible mutation/transition actors. Tool specialization is not jurisdiction. */
export const IMPLEMENTATION_ACTORS = new Set([
  "claude-code",
  "codex",
  "chatgpt-hq",
  "cowork",
  "grok",
]);

// Review-only seats are valid reviewer identities but can never be mutation authors. Human-readable
// context and evidence stay in independentReview.reviewerNote/evidence instead of being smuggled into
// this identity token. Aliases resolve to their executor identity so spelling cannot manufacture
// independence (for example, cowork-hq reviewing cowork-authored mutation).
export const REVIEWER_ONLY_IDENTITIES = new Set([
  "frontend-ipc-contract-auditor",
  "rust-tauri-reviewer",
  "self-reviewer",
  "web-design-director",
]);

const REVIEWER_ALIASES = new Map([
  ["cowork-hq", "cowork"],
]);

export function reviewerIdentityFor(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (!token) return null;
  if (IMPLEMENTATION_ACTORS.has(token) || REVIEWER_ONLY_IDENTITIES.has(token)) return token;
  return REVIEWER_ALIASES.get(token) ?? null;
}

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
  {
    resolveHead = resolveRepoHead,
    headProvenance = canonicalHeadProvenance,
    issueComments = readIssueComments,
    closingIssues = readClosingIssues,
    now = new Date(),
  } = {},
) {
  const blockers = [];
  const warnings = [];
  /** Blockers as data (#445 option 2): each carries a `code`; the prose twin is pushed to `blockers`. */
  const structuredBlockers = [];

  const actor = String(record?.actor ?? "").trim();
  if (!IMPLEMENTATION_ACTORS.has(actor)) {
    // Built from the set, so the message cannot fall behind a newly declared executor (#495).
    blockers.push(
      `The implementation actor must be a declared executor (${[...IMPLEMENTATION_ACTORS].join(", ")}).`,
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

    // THE BOARD HAS TO HAVE BEEN READ (#445 option 2, owner-accepted 2026-10-21). A proof-dependent
    // transition changes what the board says about a lane, so the receipt records the authenticated
    // fresh read it was written against. No read, an unreachable one, a cached one, an unauthenticated
    // one or a stale one is the same answer: the board's state is unknown, and unknown is never a
    // PASS and never an exemption. The blocker is data (code + consequences) as well as prose.
    const freshness = boardReadFreshness(record?.boardRead, { now });
    if (!freshness.fresh) {
      const blocker = boardUnreachableBlocker({ transition: record.transition, why: freshness.why });
      structuredBlockers.push(blocker);
      blockers.push(renderBoardUnreachable(blocker));
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
      const reviewerToken = String(review?.reviewer ?? "").trim();
      const reviewer = reviewerIdentityFor(reviewerToken);

      // Historical receipts explicitly named the final lease holder in review.writer. Preserve that
      // consistency check when the field exists; new multi-author receipts may omit it and rely on
      // mutationAuthors instead.
      if (review?.writer && String(review.writer).trim().toLowerCase() !== actor) {
        blockers.push("The independent-review writer must match the receipt actor.");
      }

      if (review?.practical !== true || review?.status !== "passed" || !reviewerToken) {
        blockers.push(
          "Final review must pass with a non-writing model/reviewer whenever that review is practical.",
        );
      }

      if (reviewerToken && !reviewer) {
        blockers.push(
          `Unknown reviewer identity "${reviewerToken}". Use a declared executor or reviewer-only identity; ` +
            "put context and evidence in reviewerNote/evidence.",
        );
      }

      if (reviewer && authors.includes(reviewer)) {
        const identity = reviewerToken.toLowerCase() === reviewer
          ? reviewer
          : `${reviewerToken} (canonical identity ${reviewer})`;
        blockers.push(
          `Final review must pass with a non-writing model/reviewer: ${identity} is one of the mutation authors (${authors.join(", ")}).`,
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

  if (LEASE_ENDING_TRANSITIONS.has(record?.transition)) {
    blockers.push(...closeLeaseBlockers(record, issueComments));
  }
  if (record?.transition === "merge-pr") {
    blockers.push(...mergeLeaseBlockers(record, { closingIssues, issueComments, warnings }));
  }

  const codes = uniq(structuredBlockers.map((b) => b.code));
  return blockers.length > 0
    ? { decision: "BLOCKED", blockers, warnings, codes, structuredBlockers }
    : { decision: "PASS", blockers, warnings, codes, structuredBlockers };
}

/** True when a verdict is held by the board blocker, whatever else it says. */
export const heldByBoard = (verdict) => Array.isArray(verdict?.codes) && verdict.codes.includes(BOARD_UNREACHABLE);

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
