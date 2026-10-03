// Release a Work Control lease (#643): the one command that ends one, so no session hand-rolls it.
//
//   node tools/entry/release.mjs --issue N --handoff <file> [--status Review] [--gate None]
//                                [--takeover "<the evidence you checked>"] [--dry-run] [--json]
//
// Exit 0 = released (with --dry-run: would be).
//      1 = REFUSE: nothing was written. (FAILED: gh gave up posting the Handoff.)
//      2 = usage.
//      3 = the Handoff is posted, and the board row is unfinished or unchecked: the thread could not be
//          read back, a board edit failed, or the last look at the thread could not be shown current.
//      4 = the Handoff is posted and another claim is on the thread: the board row was left to it, or
//          was being filed while it landed.
//
// On 2026-10-03 a session that had already released #637 posted a second released Handoff eight
// minutes after its successor claimed. Every session posts through one GitHub account, so the comment
// ended the successor's lease and the board edit overwrote its row.
//
// `postRelease` here is the one function in this repository that ends a lease, and it takes no fact
// on trust: the folder it runs in and the branch that folder is on, the thread, the board's ids, the
// clock and whether the holding session is alive are all MEASURED inside it. It refuses unless that
// folder and branch are the ones the live claim names (`releaseDecision` in claim.mjs). A caller that
// could say which folder it is, or hand over the thread it read earlier, could say anything; a request
// that tries is refused, and there is no --folder.
//
// The comment it posts ends with a Release record naming the one claim it checked, so it cannot end
// another: a claim that lands in the seconds between the check and the post stays live
// (`threadLease`). The thread is read back before any board field is touched, and the board row is
// left alone when that claim was not the one this release ended, or when a claim was posted after it.
// After the board edits, whether they all ran or one failed, the comment is marked with how the row
// was filed and the thread is read until the mark shows, so the last look is current and a claim that
// landed during the edits is seen. No stop hands out an edit to run: a row left unfinished stays as it
// is until the next claim on the issue files it, and anything done to it by hand starts with reading
// the thread again.
//
// --handoff is the Handoff as Markdown: the docs/WORK_CONTROL.md block, ending "- Claim: released".
// The board's Next action is read back out of it.
//
// --takeover is the dormant-lease route, and it is never implied. It ends another folder's lease, so
// it takes the evidence that was checked, in words, and records them in the comment. A holding session
// that is live on this machine is never taken over; one that cannot be measured here is, only once its
// claim's own clock has run out.
//
// What it cannot do: a Handoff posted by hand (`gh issue comment`) carries no record and still ends
// whichever claim is live, and GitHub has no conditional write, so a claim that lands during the few
// seconds of board edits is reported (exit 4), not prevented. And the seat is the folder the command
// runs in: a claim records a folder and a branch, not a session, so a command run from inside the
// holding folder, on its branch, is the holder.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeClaim, instant, releaseComment, releaseDecision, releaseOutcome, renderHandoff } from "./claim.mjs";
import { ghReader, readBoard, readProjectIds, REPO } from "./gather.mjs";
import { CORRUPT, invalidateBoardCache, observeLiveness, readLineage, resolveSessionRoot, samePath } from "./session-assert.mjs";
import { liveFolder } from "../../scripts/scope-drift-gate.mjs";
import { dropClaimCache } from "../../scripts/lib/scope-drift.mjs";

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", off: "\x1b[0m" };

const USAGE =
  '  node tools/entry/release.mjs --issue N --handoff <file> [--status Review] [--gate None] [--takeover "<the evidence you checked>"] [--dry-run] [--json]';

const VALUED = new Set(["--issue", "--handoff", "--status", "--gate", "--takeover"]);
const SWITCHES = new Set(["--dry-run", "--json"]);

// gh's own complaint. An execFileSync error's message opens with the whole command, comment body and all.
const firstLine = (e) => String(e?.stderr || e?.message || e).split("\n").filter(Boolean)[0] ?? "unknown error";

/**
 * Strict: an argument this does not know is a mistake, never skipped. A release that ran with a
 * misspelt --dry-run would be a release. There is no --folder: see the header.
 *
 * A value never opens with a dash. `--takeover --dryrun` would otherwise record the misspelt switch
 * as the evidence that was checked, and run for real (review of PR 644).
 */
export function parseArgs(argv) {
  const seen = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (seen.has(a)) return { error: `${a} is given twice.` };
    if (SWITCHES.has(a)) seen.set(a, true);
    else if (VALUED.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) return { error: `${a} needs a value${v === undefined ? "" : `, and "${v}" reads as another argument`}.` };
      seen.set(a, v);
      i += 1;
    } else if (a === "--folder") {
      return { error: "--folder is not an argument: the releasing folder is the one this command runs in, measured." };
    } else {
      return { error: `unknown argument "${a}".` };
    }
  }
  if (!seen.has("--issue")) return { error: "--issue N is required." };
  if (!/^[1-9]\d*$/.test(seen.get("--issue"))) return { error: `--issue takes an issue number, not "${seen.get("--issue")}".` };
  if (!seen.has("--handoff")) return { error: "--handoff <file> is required: the Handoff as Markdown." };
  return {
    issue: Number(seen.get("--issue")),
    handoff: seen.get("--handoff"),
    status: seen.get("--status") ?? "Review",
    gate: seen.get("--gate") ?? "None",
    // Absent is null. Present and empty stays "": asked for, and refused for giving no reason.
    takeover: seen.has("--takeover") ? seen.get("--takeover") : null,
    dryRun: seen.has("--dry-run"),
    asJson: seen.has("--json"),
  };
}

/**
 * The folder this command runs in and the branch that folder is on, as the push gate measures them
 * (`liveFolder`). Where the environment names the session's project folder (`CLAUDE_PROJECT_DIR`) and
 * the command runs somewhere else, the two must be one work tree. They are one seat read twice, and a
 * variable set to the holding folder would otherwise be a way to say which folder this is: with two
 * answers, neither is taken (`why` says so, and the release is refused as unmeasured).
 */
export function measureSeat({ env = process.env, cwd = process.cwd() } = {}) {
  const told = resolveSessionRoot({ env, cwd }).root;
  const ran = resolveSessionRoot({ env: {}, cwd }).root;
  const live = liveFolder(told);
  if (told !== ran) {
    const here = liveFolder(ran).toplevel;
    if (!live.toplevel || !here || !samePath(live.toplevel, here)) {
      return { folder: null, branch: null, why: `the session's project folder is ${live.toplevel ?? told} and the command runs in ${here ?? ran}` };
    }
  }
  return { folder: live.toplevel, branch: live.branch };
}

/** Is a session running in the holding folder? Its record on this machine, read as the write guard reads it. */
const holderLiveness = (now) => (folder) => {
  const record = readLineage({ root: folder });
  return record === CORRUPT ? "unknown" : observeLiveness(record, { now }).liveness;
};

/**
 * The thread's comments as posted: body, time and link. `comments` is null when the thread could not be
 * read, in any way, and `why` says how. A comment that arrived without its text may be the claim or the
 * release that decides the lease, and one that arrived without the time it was posted could have been
 * posted at any (`claimsAt` in claim.mjs), so a thread holding either was not read. On 71bd4e38 a claim
 * without its time was let through, and from then on every release on that thread was refused for a
 * shared time, with a cure, a refreshed claim, that could not cure it (review of PR 644, round 3).
 */
const readThread = (issue) => {
  const unread = (why) => ({ comments: null, why });
  let printed;
  try {
    printed = ghReader()(["issue", "view", String(issue), "--repo", REPO, "--json", "comments"]);
  } catch (e) {
    return unread(`GitHub did not answer: ${firstLine(e)}`);
  }
  let answer;
  try {
    answer = JSON.parse(printed);
  } catch {
    return unread("GitHub's answer was not JSON");
  }
  const comments = answer?.comments;
  if (!Array.isArray(comments)) return unread("GitHub's answer holds no list of comments");
  for (const c of comments) {
    if (c === null || typeof c !== "object" || typeof c.body !== "string") return unread("a comment arrived without its text");
    if (!Number.isFinite(instant(c.createdAt))) return unread("a comment arrived without the time it was posted");
  }
  return { comments, why: null };
};

const ghWrite = (argv) => execFileSync("gh", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The number GitHub gave a comment, off its link. Null when the link names none. */
const numericId = (url) => /#issuecomment-(\d+)$/.exec(String(url ?? ""))?.[1] ?? null;

const sameText = (a, b) => String(a ?? "").replace(/\r\n?/g, "\n").trim() === String(b ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * Where the comment just posted sits in a thread: by the id `gh issue comment` printed, or, when it
 * printed none this can read, the first comment with the same text. Its text ends with the record of
 * one claim, so the first comment that carries it is the one that ended that claim. -1 when the read
 * does not show it.
 */
const findPosted = (comments, { id, body }) => {
  const byId = id ? comments.findIndex((c) => String(c.url ?? "").endsWith(id)) : -1;
  return byId >= 0 ? byId : comments.findIndex((c) => sameText(c.body, body));
};

// A read that fails, or one served before the comment shows, is asked again. Each read takes about a
// second, which is the wait.
const READ_BACK_TRIES = 3;
const readBack = (issue, posted) => {
  for (let i = 0; i < READ_BACK_TRIES; i += 1) {
    const { comments } = readThread(issue);
    const index = comments ? findPosted(comments, posted) : -1;
    if (index >= 0) return { comments, index };
  }
  return null;
};

/** The one step after the board edits: the posted Handoff is marked with how the row was filed. */
const MARK = { describe: "mark the Handoff with how the row was filed" };

const refusal = (issue, d, extra = {}) =>
  Object.assign(new Error(`Refusing to release the lease on #${issue} (${d.code}): ${d.reason} ${d.cure}`), {
    code: d.code,
    reason: d.reason,
    cure: d.cure,
    claim: d.claim ?? null,
    posted: false,
    ...extra,
  });
const afterPost = (code, reason, cure, extra = {}) => Object.assign(new Error(`${reason} ${cure}`), { code, reason, cure, posted: true, ...extra });

/** What a caller may say. Everything else a release turns on is measured here, and a request naming it is refused. */
const REQUEST_KEYS = new Set(["issue", "handoff", "body", "takeover", "status", "gate", "dryRun", "cacheDir"]);

const BOARD_FIELDS = { status: "Status", gate: "Gate", nextAction: "Next action", claimExpires: "Claim expires", lastVerified: "Last verified" };

/** An option's id by its name: the board's own property and nothing inherited (`constructor` is not an option). */
const optionId = (field, name) => {
  const options = field?.options ?? {};
  return typeof name === "string" && name !== "" && Object.hasOwn(options, name) && typeof options[name] === "string" && options[name] !== "" ? options[name] : null;
};

/**
 * The refusal that makes a release mean something: it THROWS unless this folder, on this branch, holds
 * the lease it would end, and then nothing has run: no comment, no board edit.
 *
 * `request` says which issue, the Handoff (`body` as Markdown, or `handoff` as fields), whether a
 * takeover is asked for and why, and how to file the row (`status`, `gate`). It says nothing else. On
 * d5890abb this took the caller's seat, a thread reader and a liveness probe as arguments, so a
 * session in the wrong folder passed the right folder's name and a thread of its choosing, and was
 * read as the holder (review of PR 644). Each of those is measured here now.
 *
 * In order: the board's row and ids, the options asked for, the seat, the clock, and last the thread,
 * so nothing is read between the thread and the post. Then the decision, the comment (`releaseComment`:
 * it must read back as a release of the one claim that was checked), and the post.
 *
 * The comment is the release. What follows it only files the board row, and only once the thread,
 * read back, shows this release ended the claim it names and no claim is live after it:
 * - RELEASE_ENDED_NOTHING: another claim was live when the comment landed, so the comment ended
 *   nothing and the row is not this caller's to edit;
 * - RELEASE_ROW_TAKEN: it ended its claim and a claim was posted after it, so the row is that claim's;
 * - RELEASE_UNVERIFIED: the thread could not be read back, so no field is edited.
 * After the edits, whether they all ran or one failed, the comment is marked with how the row was
 * filed (`- Row filed: <time>`, or `- Row unfinished: <time>`, inside its Release record), by editing
 * the one comment this release posted, by the number GitHub gave it and never "the newest comment",
 * and the thread is read until a read shows the mark. Comments are written in order, so a read that
 * holds the mark holds every claim posted before it. On 71bd4e38 the first read that showed the release
 * was taken, and one served from before the edits showed no claim that had landed during them (review
 * of PR 644, round 3).
 * - RELEASE_ROW_RACED: a claim landed while the row was being edited. Reported, not prevented;
 * - RELEASE_HALF_RUN: a board edit failed, and the edits after it were not tried;
 * - RELEASE_ROW_UNCHECKED: every edit ran, and no read showed the mark: the thread could not be read,
 *   no read showed it yet, the mark could not be written, or the comment has no number to write it by.
 * On e0362db5 a failed edit skipped the last read and listed the edits left for the caller to run by
 * hand, over whatever claim had landed (review of PR 644, round 2). No stop lists an edit to run now.
 * A row left unfinished stays as it is until the next claim on the issue (a claim sets its Status,
 * Next action and Claim expires), and every stop that leaves the row in doubt says to read the thread
 * again before anything is done to it by hand: once a claim follows the Handoff, the row is that claim's.
 */
export function postRelease(request) {
  const asked = request !== null && typeof request === "object" ? request : {};
  const issue = asked.issue;
  const named = Number.isInteger(issue) && issue > 0 ? issue : "?";
  const badRequest = (reason) => refusal(named, { code: "RELEASE_BAD_REQUEST", reason, cure: "Nothing was written and nothing was read." });

  const foreign = Object.keys(asked).filter((k) => !REQUEST_KEYS.has(k));
  if (foreign.length) {
    throw badRequest(
      `A release is asked for with the issue, the Handoff, and how to file the row. This request also carries ${foreign.join(", ")}. ` +
        "The releasing folder, the thread, the board's ids, the clock and the holding session are measured here, never passed in.",
    );
  }
  const { handoff = null, body = null, takeover = null, status = "Review", gate = "None", dryRun = false, cacheDir = undefined } = asked;
  if (named === "?") throw badRequest("A release names its issue by number.");
  if ((body === null) === (handoff === null)) throw badRequest("A release takes the Handoff once: `body` as Markdown, or `handoff` as fields.");
  if (body !== null && typeof body !== "string") throw badRequest("`body` is the Handoff as Markdown text.");
  if (handoff !== null && typeof handoff !== "object") throw badRequest("`handoff` is the Handoff's fields.");
  if (takeover !== null && typeof takeover !== "string") throw badRequest("`takeover` is the evidence that was checked, in words, or absent.");
  if (typeof dryRun !== "boolean") throw badRequest("`dryRun` is true or false.");
  if (cacheDir !== undefined && typeof cacheDir !== "string") throw badRequest("`cacheDir` is a folder path.");
  const text = body ?? renderHandoff(handoff);

  const again = "Nothing was written. Run it again when GitHub answers.";
  let rows;
  try {
    rows = readBoard();
  } catch (e) {
    rows = { reachable: false, error: firstLine(e) };
  }
  if (!rows?.reachable) throw refusal(issue, { code: "RELEASE_BOARD_UNREADABLE", reason: `Work Control is unreachable: ${rows?.error ?? "no answer"}`, cure: again });
  const row = (rows.items ?? []).find((it) => it?.number === issue);
  if (!row) {
    throw refusal(issue, {
      code: "RELEASE_NO_BOARD_ROW",
      reason: `#${issue} has no row on the Work Control board, so there is no index to bring into line with the Handoff.`,
      cure: "Nothing was written.",
    });
  }
  let ids;
  try {
    ids = readProjectIds(row.itemId);
  } catch (e) {
    throw refusal(issue, { code: "RELEASE_BOARD_UNREADABLE", reason: `The board's field ids could not be read: ${firstLine(e)}`, cure: again });
  }
  const text1 = (v) => typeof v === "string" && v !== "";
  const missing = [
    ...(text1(ids?.projectId) ? [] : ["the project"]),
    ...(text1(ids?.itemId) ? [] : ["the row"]),
    ...Object.entries(BOARD_FIELDS).flatMap(([key, word]) => (text1(ids?.fields?.[key]?.id) ? [] : [`the ${word} field`])),
  ];
  if (missing.length) {
    throw refusal(issue, { code: "RELEASE_BOARD_UNREADABLE", reason: `The board answered without an id for ${missing.join(", ")}, so its row cannot be filed.`, cure: again });
  }
  // An option the board does not have would end the lease and leave the row saying Active. Said here,
  // before anything runs.
  const chosen = {};
  for (const [key, flag, name] of [
    ["status", "--status", status],
    ["gate", "--gate", gate],
  ]) {
    chosen[key] = optionId(ids.fields[key], name);
    if (!chosen[key]) {
      const options = Object.keys(ids.fields[key].options ?? {});
      throw refusal(
        issue,
        { code: "RELEASE_UNKNOWN_OPTION", reason: `${flag} "${String(name)}" is not an option on the board. It has: ${options.join(", ") || "(none read)"}.`, cure: "Nothing was written." },
        { flag, options },
      );
    }
  }

  const self = measureSeat();
  const now = new Date();
  const thread = readThread(issue); // the last read before the post. An unread thread is refused: a thread nobody could read is never guessed at
  const comments = thread.comments;
  const decision = releaseDecision({ issue, comments, unread: thread.why, self, takeover, liveness: holderLiveness(now), now });
  if (!decision.ok) throw refusal(issue, decision);
  const built = releaseComment({ issue, comments, decision, self, text, now });
  if (!built.ok) throw refusal(issue, built);

  const edit = (key, ...value) => ["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", ids.fields[key].id, ...value];
  const next = String(built.nextAction ?? "").trim();
  const today = now.toISOString().slice(0, 10);
  // The comment comes FIRST: it is the durable record, and the index is then brought into line with it.
  const plan = [
    { describe: `post the Handoff on #${issue}`, argv: ["issue", "comment", String(issue), "--repo", REPO, "--body", built.body] },
    { describe: `set Status = ${status}`, argv: edit("status", "--single-select-option-id", chosen.status) },
    { describe: `set Gate = ${gate}`, argv: edit("gate", "--single-select-option-id", chosen.gate) },
    // A Handoff that names no next action clears the field: an empty --text is not empty.
    next ? { describe: `set Next action = ${next}`, argv: edit("nextAction", "--text", next) } : { describe: "clear Next action", argv: edit("nextAction", "--clear") },
    { describe: "clear Claim expires", argv: edit("claimExpires", "--clear") },
    { describe: `set Last verified = ${today}`, argv: edit("lastVerified", "--date", today) },
  ];
  const result = { via: decision.via, claim: decision.claim, body: built.body };
  if (dryRun) return { ...result, url: null, steps: [...plan, MARK].map((s) => ({ describe: s.describe, ran: false })) };

  let printed;
  try {
    printed = ghWrite(plan[0].argv);
  } catch (e) {
    const reason = `gh failed posting the Handoff on #${issue}: ${firstLine(e)}`;
    const cure = "No board field was edited. Read the thread before running this again: a comment gh gave up on may still have been posted.";
    throw Object.assign(new Error(`${reason} ${cure}`), { code: "RELEASE_POST_FAILED", reason, cure, claim: decision.claim, posted: null, cause: e });
  }
  // The local copy of the scope this lease declared (#356) is a copy of a claim the comment may just
  // have ended. Dropping it is a courtesy to the drift readers; the thread is the record.
  try {
    dropClaimCache({ issue, ...(cacheDir ? { dir: cacheDir } : {}) });
  } catch {}
  const url = /https:\/\/\S+#issuecomment-\d+/.exec(String(printed ?? ""))?.[0] ?? null;
  const link = url ? ` (${url})` : "";
  // What a person is told once this release stops with the row in doubt. Neither sentence hands out an
  // edit to run: a row is filed by a claim or by a release, and anything done to it by hand starts from
  // the thread as it reads then, not as it read here.
  const unfiled = `The row stays as it is until the next claim on #${issue}, which sets its Status, Next action and Claim expires again. Before changing it by hand, read the thread again: once a claim follows this Handoff, the row is that claim's.`;
  const theirs = "the row is that claim's: restore it from the claim's own text (Status Active, its Next action, its Claim expires)";

  const posted = { id: url ? url.slice(url.indexOf("#issuecomment-")) : null, body: built.body };
  const back = readBack(issue, posted);
  if (!back) {
    throw afterPost(
      "RELEASE_UNVERIFIED",
      `The Handoff on #${issue} is posted${link}, but the thread could not be read back to see what it ended, so no board field was edited.`,
      `Run this release again: it reads the thread first and writes nothing unless this folder still holds a live claim, so its answer says whether the comment ended the lease. ${unfiled}`,
      { url, claim: decision.claim, ran: [plan[0].describe] },
    );
  }
  const outcome = releaseOutcome({ comments: back.comments, index: back.index });
  if (outcome.landed === "nothing") {
    // The fold reads a record by the time it names. Where the live claim has that very time and the
    // release still ended nothing, the time is not one claim's alone.
    const sameTime = outcome.before && Date.parse(outcome.before.postedAt) === Date.parse(decision.claim.postedAt);
    const why = !outcome.before
      ? "no claim was live when it landed."
      : sameTime
        ? `when it landed, the live claim was ${describeClaim(outcome.before)}, and its posting time is not one claim's alone on this thread (another was posted in the same second), so a record naming that time ends neither.`
        : `when it landed, the live claim was ${describeClaim(outcome.before)}, not the one it names.`;
    throw afterPost(
      "RELEASE_ENDED_NOTHING",
      `The Handoff on #${issue} is posted${link}, but it ended nothing: ${why} It names the claim it was checked against (${describeClaim(decision.claim)}) and can end no other. No board field was edited.`,
      "Nothing is left to run. The comment stays on the thread as the record of a release that came too late.",
      { url, claim: decision.claim, live: outcome.before, ran: [plan[0].describe] },
    );
  }
  if (outcome.landed === "taken") {
    throw afterPost(
      "RELEASE_ROW_TAKEN",
      `The Handoff on #${issue} is posted${link} and it ended the lease it names. A claim was posted after it (${describeClaim(outcome.next)}), so the board row is that claim's and no board field was edited.`,
      "Nothing is left to run.",
      { url, claim: decision.claim, live: outcome.next, ran: [plan[0].describe] },
    );
  }

  // The board row. An edit that fails stops the ones after it, and nothing is thrown yet: what the
  // thread shows after the edits decides what is said.
  let ran = 1;
  let failure = null;
  for (; ran < plan.length; ran += 1) {
    try {
      ghWrite(plan[ran].argv);
    } catch (e) {
      failure = e;
      break;
    }
  }
  // The board changed, or an edit gh gave up on may have changed it: the write guard's copy is stale.
  try {
    invalidateBoardCache();
  } catch {}

  // GitHub has no conditional write, so a claim that landed during those edits could not be stopped. It
  // is looked for once more, after every edit that ran and after one that failed, and the look has to
  // be CURRENT: on 71bd4e38 the first read that showed the release was taken, and a read served from
  // before the edits showed the release and not the claim (review of PR 644, round 3). So the Handoff
  // is first marked with how the row was filed, by editing the one comment this release posted, by the
  // number GitHub gave it, and the thread is then read until a read shows the mark. Comments are one
  // table written in order, so a read that holds the mark holds every claim posted before it. The mark
  // is a line inside the Release record, and no label of its opens with "Claim" (see `renderRecord`).
  const stamp = new Date().toISOString();
  const marked = `${built.body.trimEnd()}\n- Row ${failure ? `unfinished: ${stamp} ("${plan[ran].describe}" failed)` : `filed: ${stamp}`}\n`;
  const commentId = numericId(url) ?? numericId(back.comments[back.index]?.url);
  let markSent = false;
  let markFailure = null;
  if (commentId) {
    try {
      ghWrite(["api", "--method", "PATCH", `repos/${REPO}/issues/comments/${commentId}`, "-f", `body=${marked}`]);
      markSent = true;
    } catch (e) {
      markFailure = e;
    }
  }
  // The look. A read is current when it shows the Handoff marked. With no mark sent there is no such
  // read, and the first read that shows the Handoff is taken for what it is: a glimpse, which can show a
  // claim but cannot show there is none.
  const found = { id: posted.id ?? (commentId ? `#issuecomment-${commentId}` : null), body: posted.body };
  let shown = null;
  let glimpse = null;
  for (let i = 0; i < READ_BACK_TRIES && !shown; i += 1) {
    const { comments } = readThread(issue);
    const index = comments ? findPosted(comments, found) : -1;
    if (index < 0) continue;
    glimpse = { comments, index };
    if (markSent && sameText(comments[index].body, marked)) shown = glimpse;
    if (!markSent) break;
  }
  const after = shown ?? glimpse;
  const raced = after ? releaseOutcome({ comments: after.comments, index: after.index }).next : null;
  // Why the thread could not be shown current, when it could not.
  const unshown = shown
    ? null
    : !commentId
      ? "the Handoff carries no comment number to mark it by, so the thread could not be shown current, and a claim landing in those seconds would not have been seen."
      : markFailure
        ? `the Handoff could not be marked (${firstLine(markFailure)}), so the thread could not be shown current, and a claim landing in those seconds would not have been seen.`
        : glimpse
          ? "no read of the thread after the board edits showed the Handoff marked yet, so the thread could not be shown current, and a claim landing in those seconds would not have been seen."
          : "the thread could not be read again after the board edits, so a claim landing in those seconds would not have been seen.";
  const edits = plan.slice(1, ran).map((s) => s.describe);
  const untried = plan.slice(ran + 1).map((s) => s.describe);
  const rest = untried.length === 0 ? "it was the last edit" : `${untried.length} more ${untried.length === 1 ? "was" : "were"} not tried`;
  const partly = failure
    ? `${edits.length ? `"${edits.join('", "')}" ran` : "no edit ran"}, "${plan[ran].describe}" failed (${firstLine(failure)}) and may or may not have been applied, and ${rest}`
    : null;
  const did = {
    url,
    claim: decision.claim,
    ran: [...plan.slice(0, ran).map((s) => s.describe), ...(markSent ? [MARK.describe] : [])],
    ...(failure ? { failed: plan[ran].describe, untried, cause: failure } : {}),
  };
  if (raced) {
    throw afterPost(
      "RELEASE_ROW_RACED",
      failure
        ? `The Handoff on #${issue} is posted${link} and its lease is released, but a claim landed while the row was being edited (${describeClaim(raced)}), and the row is only partly filed: ${partly}. The row may now hold this release's values over that claim's, and no more of this release's edits are run.`
        : `The Handoff on #${issue} is posted${link}, its lease is released and the board row is filed, but a claim landed while the row was being edited (${describeClaim(raced)}). The row may now hold this release's values over that claim's.`,
      `Read the thread again. While that claim is live, ${theirs}. If it has been released since, check the row against the newest Handoff on the thread.`,
      { ...did, live: raced },
    );
  }
  if (failure) {
    throw afterPost(
      "RELEASE_HALF_RUN",
      `The Handoff on #${issue} is posted${link} and its lease is released, but the board row is only partly filed: ${partly}. ` +
        (shown ? "No claim has been posted after the Handoff." : `${unshown[0].toUpperCase()}${unshown.slice(1)}`),
      shown
        ? `Nothing more is run from this release, and running it again is refused: the lease it would end is gone. ${unfiled}`
        : `Nothing more is run from this release. Read the thread again. If a claim follows this Handoff, ${theirs}. If none does, the row stays as it is until the next claim on #${issue}, which sets its Status, Next action and Claim expires again.`,
      did,
    );
  }
  if (!shown) {
    throw afterPost(
      "RELEASE_ROW_UNCHECKED",
      `The Handoff on #${issue} is posted${link}, its lease is released and the board row is filed, but ${unshown}`,
      `Read the thread again. If a claim follows this Handoff, ${theirs}. If none does, nothing is left to do.`,
      did,
    );
  }
  return { ...result, url, steps: [...plan, MARK].map((s) => ({ describe: s.describe, ran: true })) };
}

/** How each way a release can stop is headed, and what it exits with. Anything else `RELEASE_` is a refusal: exit 1. */
const STOPS = {
  RELEASE_POST_FAILED: ["FAILED", 1],
  RELEASE_HALF_RUN: ["RELEASED, BOARD ROW INCOMPLETE", 3],
  RELEASE_ROW_UNCHECKED: ["RELEASED, ROW NOT CHECKED AGAIN", 3],
  RELEASE_UNVERIFIED: ["POSTED, NOT CONFIRMED", 3],
  RELEASE_ENDED_NOTHING: ["POSTED, ENDED NOTHING", 4],
  RELEASE_ROW_TAKEN: ["RELEASED, ROW LEFT TO THE NEW CLAIM", 4],
  RELEASE_ROW_RACED: ["RELEASED, ROW RACED", 4],
};

export function cmdRelease(argv, { file = (path) => readFileSync(path, "utf8"), cacheDir = undefined, log = console.log, err = console.error } = {}) {
  const args = parseArgs(argv);
  if (args.error) {
    err(`  ${args.error}\n${USAGE}`);
    return 2;
  }
  const { issue, asJson, dryRun } = args;

  let body;
  try {
    body = String(file(args.handoff)).replace(/\r\n?/g, "\n");
    if (body.charCodeAt(0) === 0xfeff) body = body.slice(1); // a byte-order mark is not part of the comment
  } catch (e) {
    err(`  --handoff ${args.handoff} could not be read: ${firstLine(e)}\n${USAGE}`);
    return 2;
  }

  let done;
  try {
    done = postRelease({ issue, body, takeover: args.takeover, status: args.status, gate: args.gate, dryRun, ...(cacheDir ? { cacheDir } : {}) });
  } catch (e) {
    if (typeof e?.code !== "string" || !e.code.startsWith("RELEASE_")) throw e;
    if (e.code === "RELEASE_UNKNOWN_OPTION") {
      err(`  ${e.reason}\n${USAGE}`);
      return 2;
    }
    const [label, exit] = STOPS[e.code] ?? ["REFUSE", 1];
    if (asJson) {
      log(
        JSON.stringify(
          {
            ok: false,
            issue,
            code: e.code,
            reason: e.reason,
            cure: e.cure,
            posted: e.posted,
            ...(e.url ? { url: e.url } : {}),
            ...(e.ran ? { ran: e.ran } : {}),
            ...(e.failed ? { failed: e.failed, untried: e.untried } : {}),
          },
          null,
          2,
        ),
      );
      return exit;
    }
    err(`\n  ${C.red}${label} — ${e.code}${C.off}\n  ${e.reason}\n  ${C.dim}${e.cure}${C.off}\n`);
    return exit;
  }

  if (asJson) {
    log(JSON.stringify({ ok: true, issue, via: done.via, dryRun, url: done.url, steps: done.steps, body: done.body }, null, 2));
    return 0;
  }
  const whose = `${done.claim.folder} @ ${done.claim.branch}`;
  if (dryRun) {
    log(`  ${C.yellow}dry run${C.off}  nothing was written. #${issue}'s lease (${whose}) would be released${done.via === "takeover" ? " by takeover" : ""} with this comment:\n`);
    log(done.body.trimEnd().split("\n").map((l) => `  ${C.dim}|${C.off} ${l}`).join("\n"));
    log("\n  then, once the thread shows it ended that lease, in order:");
    for (const s of done.steps.slice(1)) log(`   ${s.describe}`);
  } else {
    log(`  ${C.green}lease released${C.off}  #${issue}  ${C.dim}(${whose}${done.via === "takeover" ? ", by takeover" : ""}; ${done.steps.length} steps run)${C.off}`);
  }
  return 0;
}

// Only dispatch when this file IS the program. Importing it (the guards do) must not exit the
// process out from under the test runner.
const invokedDirectly = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exit(cmdRelease(process.argv.slice(2)));
