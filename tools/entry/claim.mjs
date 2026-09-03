// Post, renew and release the Work Control claim — the only component here that writes to the board.
//
// The load-bearing refusal: postClaim THROWS unless handed a PASS verdict. A claim asserts that the
// governing invariant holds, so a claim that can be posted without a verdict is a claim that can
// describe a state nobody verified. That refusal is a guard, not a convention.
//
// Every board mutation is expressed as a PLAN of `gh` invocations before anything runs, so a dry run
// shows exactly what would be written, and the field quirks stay pinned by tests: date fields need
// `--date` (`--text` fails with "Did not receive a date value") and clearing an expiry needs `--clear`.

import { execFileSync } from "node:child_process";
import { writeClaimCache } from "../../scripts/lib/scope-drift.mjs";

export const CLAIM_HEADER = "### Ownership claim";
export const HANDOFF_HEADER = "### Handoff";

const line = (label, value) => `- ${label}: ${value}`;

/** The WORK_CONTROL claim block, filled from MEASURED facts plus the verdict that licensed it. */
export function renderClaim(facts) {
  const procs = facts.processes?.length
    ? facts.processes.map((p) => `${p.name} ×${p.count}${p.note ? ` (${p.note})` : ""}`).join(", ")
    : "none";
  const verdictLines = (facts.verdict?.checks ?? [])
    .map((c) => `| \`${c.name}\` | ${c.expected} | ${c.actual} | ${c.ok ? "ok" : "**FAIL**"} |`)
    .join("\n");

  return [
    CLAIM_HEADER,
    "",
    line("Lane", facts.lane),
    line("Executor/tool", facts.executor),
    line("Repository", facts.repository),
    line("Worktree folder", facts.folder),
    line("Branch", facts.branch),
    line("Write scope", facts.scope),
    line("Started", facts.started),
    line("Claim expires", facts.expires),
    line("Next action", facts.nextAction),
    line("Active build/install/helper processes", procs),
    "",
    `#### Preflight verdict: ${facts.verdict?.verdict ?? "(none)"}`,
    "",
    "| Check | Expected | Actual | |",
    "|---|---|---|---|",
    verdictLines,
    "",
    "This claim was rendered from the preflight's own measurements. It is not a description of what",
    "the folder was expected to look like.",
  ].join("\n");
}

/** The WORK_CONTROL handoff block. Its `Exact next action` is what guard 7 compares against. */
export function renderHandoff(h) {
  return [
    HANDOFF_HEADER,
    "",
    line("Outcome", h.outcome ?? ""),
    line("Files/commits/PR", h.files ?? ""),
    line("Verification", h.verification ?? ""),
    line("Remaining work", h.remaining ?? ""),
    line("Gates or owner actions", h.gates ?? ""),
    line("Worktree state", h.worktreeState ?? ""),
    line("Active processes", h.processes ?? ""),
    line("Exact next action", h.nextAction ?? ""),
    line("Claim", h.claim ?? ""),
  ].join("\n");
}

const field = (body, label) => {
  const m = body.match(new RegExp(`^-\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}:\\s*(.*)$`, "mi"));
  return m ? m[1].trim() : null;
};

/** Parse a claim comment back into facts. Returns null when the comment is not a claim. */
export function parseClaim(body) {
  if (!body?.includes(CLAIM_HEADER)) return null;
  return {
    lane: field(body, "Lane"),
    executor: field(body, "Executor/tool"),
    repository: field(body, "Repository"),
    folder: field(body, "Worktree folder"),
    branch: field(body, "Branch"),
    scope: field(body, "Write scope"),
    started: field(body, "Started"),
    expires: field(body, "Claim expires"),
    nextAction: field(body, "Next action"),
  };
}

/** Parse a handoff comment. `nextAction` is the durable record guard 7 checks the board against. */
export function parseHandoff(body) {
  if (!body?.includes(HANDOFF_HEADER)) return null;
  const claim = field(body, "Claim");
  return {
    outcome: field(body, "Outcome"),
    files: field(body, "Files/commits/PR"),
    verification: field(body, "Verification"),
    remaining: field(body, "Remaining work"),
    gates: field(body, "Gates or owner actions"),
    worktreeState: field(body, "Worktree state"),
    processes: field(body, "Active processes"),
    nextAction: field(body, "Exact next action"),
    released: /released/i.test(claim ?? ""),
  };
}

const REPO = ["--repo", "Pootytxng/sentinel"];
const comment = (issue, body) => ({ argv: ["issue", "comment", String(issue), ...REPO, "--body", body], describe: `comment on #${issue}` });
const setText = (ids, fieldId, text) => ({ argv: ["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", fieldId, "--text", text], describe: `set ${fieldId}` });
const setDate = (ids, fieldId, date) => ({ argv: ["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", fieldId, "--date", date], describe: `set ${fieldId}` });
const clear = (ids, fieldId) => ({ argv: ["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", fieldId, "--clear"], describe: `clear ${fieldId}` });
const setOption = (ids, f, name) => ({ argv: ["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", f.id, "--single-select-option-id", f.options[name]], describe: `set ${f.id}=${name}` });

/** The comment comes FIRST: a half-completed run still leaves durable evidence on the issue. */
export function planPostClaim({ issue, ids, facts, verdict }) {
  return [
    comment(issue, renderClaim({ ...facts, verdict })),
    setOption(ids, ids.fields.status, "Active"),
    setOption(ids, ids.fields.lane, facts.lane),
    setText(ids, ids.fields.worktree.id, `${facts.folder} @ ${facts.branch}`),
    setText(ids, ids.fields.nextAction.id, facts.nextAction),
    setDate(ids, ids.fields.claimExpires.id, facts.expires),
    setDate(ids, ids.fields.lastVerified.id, facts.started),
  ];
}

export function planRenew({ issue, ids, until, note = null }) {
  return [
    comment(issue, `Claim renewed until ${until}.${note ? ` ${note}` : ""}`),
    setDate(ids, ids.fields.claimExpires.id, until),
  ];
}

/**
 * Release: the durable handoff is posted first, then the index is updated to agree with it —
 * which is why guard 7 passes by construction rather than by remembering.
 */
export function planRelease({ issue, ids, handoff, status = "Review", gate = "None", lastVerified }) {
  const steps = [comment(issue, renderHandoff(handoff))];
  if (ids.fields.status.options[status]) steps.push(setOption(ids, ids.fields.status, status));
  if (ids.fields.gate.options[gate]) steps.push(setOption(ids, ids.fields.gate, gate));
  steps.push(setText(ids, ids.fields.nextAction.id, handoff.nextAction ?? ""));
  steps.push(clear(ids, ids.fields.claimExpires.id));
  if (lastVerified) steps.push(setDate(ids, ids.fields.lastVerified.id, lastVerified));
  return steps;
}

export function execPlan(plan, { dryRun = false } = {}) {
  const done = [];
  for (const step of plan) {
    if (dryRun) {
      done.push({ ...step, ran: false });
      continue;
    }
    execFileSync("gh", step.argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    done.push({ ...step, ran: true });
  }
  return done;
}

/** The refusal that makes a claim mean something. */
export function postClaim({ issue, verdict, facts, ids, dryRun = false, cacheDir = undefined }) {
  if (verdict?.verdict !== "PASS") {
    throw new Error(
      `Refusing to post a claim on #${issue}: preflight verdict is ${verdict?.verdict ?? "(none)"}. ` +
        "A claim asserts the invariant holds; posting one without a PASS would assert something nobody verified.",
    );
  }
  const plan = planPostClaim({ issue, ids, facts, verdict });
  const ran = execPlan(plan, { dryRun });
  if (!dryRun) {
    // The scope this claim just declared, remembered locally for the drift readers (#356). A cache
    // failure is not a claim failure: the thread is the record, the cache only saves a round trip.
    try {
      writeClaimCache(
        { issue, scopeText: facts.scope, folder: facts.folder ?? null, branch: facts.branch ?? null, postedAt: new Date().toISOString(), source: "postClaim" },
        cacheDir ? { dir: cacheDir } : {},
      );
    } catch {}
  }
  return { plan, ran };
}
