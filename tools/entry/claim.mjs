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
import { scopeTextFromMarkdown } from "../../scripts/lib/claim-scope.mjs";
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

const esc = (s) => s.replace(/[.*+?^{}()|[\]\\/$]/g, "\\$&");
// One enclosing backtick pair, trimmed — a hand-written claim quotes its folder or branch as code.
const plain = (v) => (v && /^`[^`]*`$/.test(v) ? v.slice(1, -1) : v);

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * A comment's lines with everything that does not render as Markdown blanked. Headers and fields are
 * read only from these, so an example is never an event: on e56c6395 a `### Handoff` / `- Claim:
 * released` quoted inside a fence released the live claim above it (HQ review 5165670535). Blanked,
 * as CommonMark 0.31 renders them:
 * - fenced code, from an opener of three or more backticks or tildes indented at most three spaces
 *   (a backtick opener whose info string holds a backtick is inline code, not a fence) to a closer of
 *   the same character, at least as long, with only spaces or tabs after it, or to the comment's end;
 * - an HTML comment, from a line opening `<!--` through the line carrying `-->`. It renders as
 *   nothing, which makes it the worst place for a release to hide.
 * Indented code, blockquotes and mentions need no blanking: a header counts only after at most three
 * spaces (a tab makes it indented code), and a field only at the start of its line. Not modelled:
 * list items, whose fences are read as though they stood alone (the renderer differs only on a line
 * indented less than the item, which it moves out of the list), and raw HTML blocks other than
 * comments (`<pre>`, or `<details>` with no blank line after it), whose lines are read. None of the
 * 846 comments here on 2026-09-10 put a header inside either.
 *
 * `Write scope` is not read through this: `scopeTextFromMarkdown` (#408) skips fenced lines by its own
 * rule. That rule is not reused here, because its opener is looser (`/^\s*```/`): safe for a scope,
 * which fails closed when hidden, and unsafe for a header, because a hidden claim lets a close through.
 */
const authored = (body) => {
  let fence = null; // the opening run, e.g. "````"
  let comment = false;
  return String(body ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map((l) => {
    if (fence) {
      const close = FENCE_CLOSE.exec(l);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return "";
    }
    if (comment) {
      comment = !l.includes("-->");
      return "";
    }
    const open = FENCE_OPEN.exec(l);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = open[1];
      return "";
    }
    if (/^ {0,3}<!--/.test(l)) {
      comment = !l.includes("-->");
      return "";
    }
    return l;
  });
};

/**
 * One field of a claim or handoff, by label, from its `authored` lines. Reads the block this module
 * renders (`- Label: value`), the bold variants a hand-written comment uses (`- **Label:** value`,
 * `- **Label**: value`), and a two-column table row (`| **label** | value |`) — the form another
 * session posted on #224, which read as a claim with no fields and so, under #358, as a live writer
 * whose scope nobody could see (collision rule 4: a refusal the other side could not cure). Aliases
 * are the labels other writers use for the same fact.
 *
 * Every field here is read ONE LINE at a time. The one field that is not — `Write scope`, which
 * wraps — is not read here at all: it goes through `scopeTextFromMarkdown` (#408), the one
 * extraction contract in this repo, so a claim and an issue body cannot disagree about the same
 * Markdown. This function keeping its own copy of that rule is how they came to disagree.
 */
const field = (lines, label, aliases = []) => {
  for (const name of [label, ...aliases]) {
    const bullet = new RegExp("^[-*]\\s*(?:\\*\\*)?" + esc(name) + "(?::\\s*\\*\\*|\\*\\*\\s*:|:)\\s*(.*)$", "i");
    for (let i = 0; i < lines.length; i += 1) {
      const m = bullet.exec(lines[i]);
      if (m) return m[1].trim();
    }
    const row = new RegExp("^\\|\\s*(?:\\*\\*)?" + esc(name) + "(?:\\*\\*)?\\s*\\|\\s*(.*?)\\s*\\|\\s*$", "i");
    for (const l of lines) {
      const m = row.exec(l);
      if (m) return m[1].trim();
    }
  }
  return null;
};

/**
 * A claim's expiry as a Date. Writers spell it "2026-09-03", "2026-09-02T04:55Z (12 hours)",
 * "2026-09-02T12:00:00Z" or "2026-08-03 (12-hour alarm; no automatic takeover)"; a date alone ends at
 * the end of its day (UTC). A bare term — "12 hours", "12h", "2 days" — means that long after the
 * claim was POSTED, and is readable only with the posting time (`anchor`) in hand: the claim on #313
 * spelled it that way, and read without an anchor it never expired, so a lane that finished on
 * 2026-09-01 refused every overlapping writer for good. Unparseable is null — a claim stays live
 * until its expiry is READ as past, never assumed past.
 */
export function claimExpiry(text, { anchor = null } = {}) {
  const s = String(text ?? "");
  const m = /^\s*(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?/.exec(s);
  if (m) {
    const time = m[2] ? (/(?:Z|[+-]\d{2}:?\d{2})$/.test(m[2]) ? m[2] : m[2] + "Z") : "T23:59:59Z";
    const d = new Date(m[1] + time);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const rel = /^\s*[(~]?\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days)\b/i.exec(s);
  if (!rel || !anchor) return null;
  const at = new Date(anchor);
  if (Number.isNaN(at.getTime())) return null;
  const n = Number(rel[1]);
  return new Date(at.getTime() + n * (/^d/i.test(rel[2]) ? 86_400_000 : 3_600_000));
}

/**
 * Whether a comment's `authored` lines carry a header: at the start of a line, after at most three
 * spaces. A sentence that mentions `### Handoff` is not a handoff. Ten of the 840 comments in this
 * repository on 2026-09-10 did exactly that, and each one read as a lease event: #283's close comment
 * as a handoff, and #408's and #409's retellings as fresh claims (#411).
 */
const headed = (lines, header) => {
  const at = new RegExp(`^ {0,3}${esc(header)}`);
  return lines.some((l) => at.test(l));
};

/** Parse a claim comment back into facts. Returns null when the comment is not a claim. */
export function parseClaim(body) {
  const lines = authored(body);
  if (!headed(lines, CLAIM_HEADER)) return null;
  return {
    lane: field(lines, "Lane"),
    executor: field(lines, "Executor/tool", ["executor", "writer"]),
    repository: plain(field(lines, "Repository", ["repo"])),
    folder: plain(field(lines, "Worktree folder", ["worktree", "folder"])),
    branch: plain(field(lines, "Branch")),
    // The one field NOT read here: extraction is one contract, shared with the issue-body reader
    // (#408). `scope` stays a claim-only alias — an issue body is prose, and `- scope:` in prose is
    // as likely to be a sentence as a declaration.
    scope: scopeTextFromMarkdown(body, { aliases: ["scope"] }),
    started: field(lines, "Started"),
    expires: field(lines, "Claim expires", ["expiry", "expires"]),
    nextAction: field(lines, "Next action"),
  };
}

/** Parse a handoff comment. `nextAction` is the durable record guard 7 checks the board against. */
export function parseHandoff(body) {
  const lines = authored(body);
  if (!headed(lines, HANDOFF_HEADER)) return null;
  const claim = field(lines, "Claim");
  return {
    outcome: field(lines, "Outcome"),
    files: field(lines, "Files/commits/PR"),
    verification: field(lines, "Verification"),
    remaining: field(lines, "Remaining work"),
    gates: field(lines, "Gates or owner actions"),
    worktreeState: field(lines, "Worktree state"),
    processes: field(lines, "Active processes"),
    nextAction: field(lines, "Exact next action"),
    // The Claim line has to open with "released". "**HELD.** ... Released only when a review verdict
    // lands" (#399, #407) is a held lease that mentions its release; read as released, it would let a
    // close through while the lease was live (#411).
    released: /^[^a-z0-9]*released\b/i.test(claim ?? ""),
  };
}

/**
 * Is a lease still live on this thread? The thread is folded once, in posting order, one transition
 * per comment: a Handoff whose Claim line releases ends the lease, and a claim starts one. A Handoff
 * that does not release changes nothing — a transfer or a HELD keeps the lease it names, and a later
 * Handoff that says nothing of the claim cannot bring a released one back (HQ review 5165670535). A
 * comment carrying both is read release first, so its claim stands. One fold, shared by
 * `gather.readIssueThread` and the work-control gate's close check (#411), so the board reader and the
 * gate cannot disagree about when a lease ended. `comments` is the thread in posting order, as
 * `gh issue view --json comments` returns it; `handoff` is the newest one, released or not, because
 * guard 7 reads its next action.
 */
export function threadLease(comments) {
  let claim = null;
  let handoff = null;
  for (const c of comments ?? []) {
    const asHandoff = parseHandoff(c.body);
    if (asHandoff) {
      handoff = { ...asHandoff, postedAt: c.createdAt };
      if (asHandoff.released) claim = null;
    }
    const asClaim = parseClaim(c.body);
    if (asClaim) claim = { ...asClaim, postedAt: c.createdAt };
  }
  return { claim, handoff };
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
