// `compy-entry adopt` — verification without a relaunch (#125 step 2).
//
// Spec: docs/superpowers/specs/2026-08-21-unverified-session-write-refusal.md §3a.
//
// WHY THIS EXISTS AT ALL. Step 3 of that spec refuses project writes from an unverified session. A
// refusal with no self-service cure turns every direct instruction from the owner — "open a window,
// do this" — into "close the window and start over", which is worse than the advisory it replaces
// because it throws away a live conversation. So the cure ships with the refusal, and this is the
// cure: it proves the same facts a launch proves, by hand, later.
//
// IT IS NOT A BYPASS. A launch asserts folder + branch + repo + issue + session id and writes a
// record binding them. So does this. What it does not do is CHOOSE any of them: the branch is read
// from the folder and never set, the session id must be supplied explicitly (a CLI run from a Bash
// tool cannot know which conversation it belongs to, and guessing is how the wrong conversation
// adopts a folder), and the issue must name a real open issue.
//
// TWO DELIBERATE DEVIATIONS FROM THE SPEC, both measured rather than assumed:
//
//   1. The `work-control` LABEL IS A NOTE, NOT A GATE. Spec §3a assertion 3 wanted "an open issue
//      labelled work-control". Measured 2026-08-22: 6 of the 13 open issues carry that label, and
//      #125 — the issue this very work is being done under — is one of the 7 that do not. A gate
//      that refuses more than half the real queue, including its own issue, is not a safety
//      property; it is an outage. So OPEN is the gate (a closed issue means the claim is over) and
//      the label is reported in the record and the output.
//   2. The CONTEXT WINDOW IS RECORDED ONLY IF THIS PROCESS CAN SEE IT. When the CLI inherits
//      CLAUDE_CODE_AUTO_COMPACT_WINDOW it is recorded; when it does not, the record claims no window
//      rather than a guessed one. Unobserved stays unknown.
//
// The refusal codes here are ADOPT_-prefixed and deliberately distinct from the assert's codes:
// these describe why an adoption was declined, not why a session is unverified, and merging the two
// vocabularies would let an adopt failure read as a session verdict.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import {
  CORRUPT,
  LINEAGE_TTL_MINUTES,
  TOKEN_DIR,
  canonicalizePath,
  normalizeRepo,
  observeLive,
  observeLiveness,
  readLineage,
  writeLineage,
} from "../../.claude/hooks/session-root-assert.mjs";

export const REPO = "Pootytxng/sentinel";

/** The one repository an adopted session may be adopted into. */
export const EXPECTED_REPO = normalizeRepo(REPO);

/**
 * One bounded `gh` read. Null when gh answered "no" (a refusal, a 404, a GraphQL the proxy will not
 * carry); a THROW when the 20 s bound killed it (#474), because a GitHub that did not answer is not a
 * transport to retry: the lookup below would otherwise wait the same 20 s again over REST.
 */
const gh = (args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    if (e?.code === "ETIMEDOUT" || e?.killed === true) throw e;
    return null;
  }
};

/**
 * The issue's state, labels and title: over GraphQL (`gh issue view`) first, and over the REST API
 * when that answers nothing (#445 option 1: the hosted lane's proxy refuses GraphQL, and the gate's
 * own cure for a folder with no session record is this command, so the cure has to work there too).
 * Both reads are read-only and bound to this repository; the shape is the same whichever answered.
 *
 * @returns {{state: string, labels: string[], title: string}|null} null = could not be read, which
 * is NOT the same as "closed" and is refused with its own code.
 */
export function lookupIssueViaGh(issue, { repo = REPO, run = gh } = {}) {
  const n = Number(issue);
  let raw;
  try {
    raw =
      run(["issue", "view", String(n), "--repo", repo, "--json", "state,labels,title"]) ??
      run(["api", "--method", "GET", `repos/${repo}/issues/${n}`, "--jq", "{state, title, labels: [.labels[].name]}"]);
  } catch {
    // The bound killed a read: GitHub is not answering, and the second transport is not asked.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      state: String(parsed.state ?? "").toUpperCase(),
      labels: (parsed.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean),
      title: parsed.title ?? "",
    };
  } catch {
    return null;
  }
}

/** Is this folder a git worktree at all? Cheap, and it separates "not a repo" from "wrong repo". */
export function isWorktreeViaGit(folder) {
  try {
    const out = execFileSync("git", ["-C", folder, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "true";
  } catch {
    return false;
  }
}

const refuse = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra });

/**
 * The whole decision, with every fact injected — no disk, no git, no network. The IO wrapper below
 * gathers the facts; this decides, and the tests drive THIS with fabricated facts.
 *
 * @param {object} f
 * @param {string} f.folder            the folder being adopted (already canonical or not)
 * @param {number|string} f.issue      the issue number given on the command line
 * @param {string} f.sessionId         the conversation id, supplied explicitly
 * @param {boolean} f.isWorktree       does git call this folder a work tree
 * @param {{branch: string|null, repo: string|null}} f.live  what the folder actually is
 * @param {{state: string, labels: string[], title: string}|null} f.issueFacts  null = unreadable
 * @param {object|null} f.existing     the folder's current session record, if any
 * @param {"none"|"live"|"dead"|"unknown"} f.liveness  is the conversation holding that record still there
 * @param {number|null} f.window       the observed context window, or null if unobservable
 * @param {Date} f.now
 */
export function planAdoption({
  folder,
  issue,
  sessionId,
  isWorktree,
  live,
  issueFacts,
  existing = null,
  window = null,
  liveness = "unknown",
  now = new Date(),
}) {
  if (!sessionId) {
    return refuse(
      "ADOPT_NO_SESSION",
      "--session <id> is required. A CLI run from a shell cannot know which conversation it belongs " +
        "to, and an adoption bound to a guessed session id verifies nothing.",
    );
  }
  const issueNumber = Number(issue);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return refuse("ADOPT_NO_ISSUE", "--issue <n> is required and must be an issue number.");
  }
  if (!isWorktree) {
    return refuse(
      "ADOPT_NOT_A_WORKTREE",
      `${folder} is not a git work tree, so there is no branch, no remote and nothing to bind a ` +
        "session record to.",
    );
  }
  if (!live?.repo) {
    return refuse(
      "ADOPT_REPO_UNREADABLE",
      `The origin remote of ${folder} could not be read. A folder that cannot say which repository ` +
        "it belongs to has not been verified as this one.",
    );
  }
  if (live.repo !== EXPECTED_REPO) {
    return refuse(
      "ADOPT_REPO_MISMATCH",
      `${folder} points at ${live.repo}; adoption is only for ${EXPECTED_REPO}.`,
      { expected: EXPECTED_REPO, actual: live.repo },
    );
  }
  if (!live.branch) {
    return refuse(
      "ADOPT_BRANCH_UNREADABLE",
      `The live branch in ${folder} could not be read (a detached HEAD or a rebase in progress). ` +
        "The branch under the session is the branch the work lands on, so it cannot be unknown.",
    );
  }
  if (!issueFacts) {
    return refuse(
      "ADOPT_ISSUE_UNREADABLE",
      `Issue #${issueNumber} could not be read from ${REPO} (gh unavailable, unauthenticated, or ` +
        "the issue does not exist). Unreadable is not the same as open, so this refuses.",
    );
  }
  if (issueFacts.state !== "OPEN") {
    return refuse(
      "ADOPT_ISSUE_CLOSED",
      `Issue #${issueNumber} is ${issueFacts.state.toLowerCase()}. A session cannot be bound to a ` +
        "claim that is already over.",
      { actual: issueFacts.state },
    );
  }

  if (existing === CORRUPT) {
    return refuse(
      "ADOPT_RECORD_CORRUPT",
      `${folder} has a session record that exists and cannot be read, so there is no way to tell ` +
        "which conversation holds it. Overwriting it would be adoption by demolition — delete it " +
        "deliberately if it is yours, then adopt.",
    );
  }

  // The one-writer rule (docs/WORK_CONTROL.md). A record for THIS folder that belongs to a different
  // conversation is another writer, and adoption must not take the folder from it.
  //
  // #216: "another writer" means a writer that still EXISTS. The clock alone said the folder was
  // held for twelve hours by a session that had no process and had never written a transcript, and
  // the honest cure this command is supposed to be refused the owner's real conversation. So the
  // question asked here is liveness, not expiry: a live foreign record still refuses, a dead one
  // lapses and is taken over. "unknown" — nothing could be measured — still refuses, because
  // collision rule 4 says unknown means locked.
  const unexpired = existing && (!existing.expiresAt || new Date(existing.expiresAt) >= now) ? existing : null;
  const foreign = unexpired && unexpired.sessionId && unexpired.sessionId !== sessionId ? unexpired : null;
  if (foreign && liveness !== "dead") {
    return refuse(
      "ADOPT_FOLDER_CLAIMED",
      `${folder} already has a session record bound to another conversation ` +
        `(#${foreign.issue ?? "?"}, session ${String(foreign.sessionId).slice(0, 8)}…) and that ` +
        (liveness === "live"
          ? "conversation is still live. One writer per worktree — use a different worktree, or close that one."
          : "nothing could measure whether it is still running. Collision rule 4 — unknown means locked."),
      { expected: sessionId, actual: foreign.sessionId, liveness },
    );
  }
  // Only OUR OWN record refreshes in place; a dead foreign one is replaced, not inherited.
  const liveRecord = foreign ? null : unexpired;

  const record = {
    issue: issueNumber,
    folder: canonicalizePath(folder),
    branch: live.branch,
    window: Number.isFinite(window) ? window : null,
    repo: live.repo,
    nonce: null,
    briefHash: null,
    sessionId,
    // NOT this process's pid. `compy-entry adopt` runs from a Bash tool and exits immediately, so
    // recording it would write a pid that is dead before the record is read. The adopting
    // conversation proves its own liveness through its transcript instead (#216).
    pid: null,
    launchedAt: null,
    // Adoption is the moment this folder became verified for this conversation; re-adopting the same
    // session keeps the original first sighting so the record's history is not rewritten.
    firstSeenAt: liveRecord?.firstSeenAt ?? now.toISOString(),
    lastSeenAt: now.toISOString(),
    seenCount: (liveRecord?.seenCount ?? 0) + 1,
    expiresAt: new Date(now.getTime() + LINEAGE_TTL_MINUTES * 60_000).toISOString(),
    // Stamped so a record's provenance is never inferred from the absence of a nonce.
    adoptedAt: now.toISOString(),
  };

  const notes = [];
  if (!issueFacts.labels.includes("work-control")) {
    notes.push(`#${issueNumber} is not labelled work-control — adopted anyway, see adopt.mjs deviation 1`);
  }
  if (record.window === null) {
    notes.push("no context window observed, so the record claims none (it will not be checked)");
  }
  if (liveRecord) notes.push("this conversation already held the folder — the record was refreshed");
  if (foreign) notes.push(`took the folder over from session ${String(foreign.sessionId).slice(0, 8)}…, whose process is gone`);

  return { ok: true, record, notes, title: issueFacts.title };
}

/** The IO shell: gather the facts this machine can see, then persist exactly what the plan earned. */
export function adopt({
  folder = process.cwd(),
  issue,
  sessionId,
  dir = TOKEN_DIR,
  now = new Date(),
  env = process.env,
  live = null,
  isWorktree = isWorktreeViaGit,
  lookupIssue = lookupIssueViaGh,
  read = readLineage,
  write = writeLineage,
  liveness = observeLiveness,
} = {}) {
  // The record is keyed and written in the canonical (backslash) form the session hook compares
  // with; git is asked about the folder as the filesystem spells it. On POSIX those differ, and the
  // canonical form is not a path there at all (2026-10-21: every hosted adopt refused as "not a work
  // tree" for that reason, so the push gate's own cure could not be taken from the hosted lane).
  const root = canonicalizePath(folder);
  const fsRoot = resolve(String(folder ?? "").trim() || process.cwd());
  const rawWindow = String(env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? "").trim();
  const existing = read({ root, dir });
  const plan = planAdoption({
    folder: root,
    issue,
    sessionId,
    isWorktree: isWorktree(fsRoot),
    live: live ?? observeLive(fsRoot),
    issueFacts: Number.isInteger(Number(issue)) && Number(issue) > 0 ? lookupIssue(Number(issue)) : null,
    existing,
    liveness: liveness(existing, { now }).liveness,
    window: rawWindow === "" ? null : Number(rawWindow),
    now,
  });
  if (!plan.ok) return plan;
  const file = write(plan.record, { dir });
  return { ...plan, file };
}
