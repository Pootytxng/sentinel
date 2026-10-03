// Release a Work Control lease (#643): the one command that ends one, so no session hand-rolls it.
//
//   node tools/entry/release.mjs --issue N --handoff <file> [--status Review] [--gate None]
//                                [--takeover "<the evidence you checked>"] [--dry-run] [--json]
//
// Exit 0 = released (with --dry-run: would be), 1 = REFUSE and nothing was written, 2 = usage,
// 3 = the Handoff is posted and the lease is released, but the board row is only partly updated.
//
// It refuses unless the folder it runs in, on the branch that folder is on, is the one the live claim
// names (`postRelease` in claim.mjs). On 2026-10-03 a session that had already released #637 posted a
// second released Handoff eight minutes after its successor claimed; every session posts through one
// GitHub account, so the comment ended the successor's lease and the board edit overwrote its row.
//
// The seat is MEASURED here, the way the push gate measures it, and no argument names it: a session
// that could say which folder it is could say it is any folder.
//
// --handoff is the Handoff as Markdown: the docs/WORK_CONTROL.md block, ending "- Claim: released".
// The board's Next action is read back out of it.
//
// --takeover is the dormant-lease route, and it is never implied. It ends another folder's lease, so
// it takes the evidence that was checked, in words, and records them in the comment. A holding session
// that is live on this machine is never taken over; one that cannot be measured here is, only once its
// claim's own clock has run out.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postRelease } from "./claim.mjs";
import { ghReader, readBoard, readProjectIds, REPO } from "./gather.mjs";
import { CORRUPT, invalidateBoardCache, observeLiveness, readLineage, resolveSessionRoot } from "./session-assert.mjs";
import { liveFolder } from "../../scripts/scope-drift-gate.mjs";

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", off: "\x1b[0m" };

const USAGE =
  '  node tools/entry/release.mjs --issue N --handoff <file> [--status Review] [--gate None] [--takeover "<the evidence you checked>"] [--dry-run] [--json]';

const VALUED = new Set(["--issue", "--handoff", "--status", "--gate", "--takeover"]);
const SWITCHES = new Set(["--dry-run", "--json"]);

const firstLine = (e) => String(e?.stderr || e?.message || e).split("\n").filter(Boolean)[0] ?? "unknown error";

/**
 * Strict: an argument this does not know is a mistake, never skipped. A release that ran with a
 * misspelt --dry-run would be a release. There is no --folder: see the header.
 */
export function parseArgs(argv) {
  const seen = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (seen.has(a)) return { error: `${a} is given twice.` };
    if (SWITCHES.has(a)) seen.set(a, true);
    else if (VALUED.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || VALUED.has(v) || SWITCHES.has(v)) return { error: `${a} needs a value.` };
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

/** The folder this command runs in and the branch that folder is on, as the push gate measures them. */
export function measureSeat({ env = process.env, cwd = process.cwd() } = {}) {
  const live = liveFolder(resolveSessionRoot({ env, cwd }).root);
  return { folder: live.toplevel, branch: live.branch };
}

/** Is a session running in the holding folder? Its record on this machine, read as the write guard reads it. */
function holderLiveness(folder, { now = new Date() } = {}) {
  const record = readLineage({ root: folder });
  return record === CORRUPT ? "unknown" : observeLiveness(record, { now }).liveness;
}

/** A plan step in words: the board's field by its name, not its id, and the value a text or date step writes. */
const FIELD_WORDS = { status: "Status", gate: "Gate", nextAction: "Next action", claimExpires: "Claim expires", lastVerified: "Last verified" };
const stepWords = (ids) => (step) => {
  const named = Object.entries(FIELD_WORDS).reduce((t, [key, word]) => (ids.fields?.[key]?.id ? t.replaceAll(ids.fields[key].id, word) : t), step.describe);
  const flag = ["--text", "--date"].find((f) => step.argv.includes(f));
  return flag ? `${named} = ${step.argv[step.argv.indexOf(flag) + 1]}` : named;
};

/** The thread's comments as posted: body, time and link. It throws when gh does, and that is refused. */
const readComments = (issue) => JSON.parse(ghReader()(["issue", "view", String(issue), "--repo", REPO, "--json", "comments"])).comments;

export function cmdRelease(
  argv,
  {
    seat = measureSeat,
    board = readBoard,
    projectIds = readProjectIds,
    read = readComments,
    liveness = holderLiveness,
    file = (path) => readFileSync(path, "utf8"),
    release = postRelease,
    dropBoardCache = invalidateBoardCache,
    exec = undefined,
    cacheDir = undefined,
    now = new Date(),
    log = console.log,
    err = console.error,
  } = {},
) {
  const args = parseArgs(argv);
  if (args.error) {
    err(`  ${args.error}\n${USAGE}`);
    return 2;
  }
  const { issue, asJson, dryRun } = args;
  const stop = (label, exit, code, reason, cure, extra = {}) => {
    if (asJson) log(JSON.stringify({ ok: false, issue, code, reason, cure, ...extra }, null, 2));
    else err(`\n  ${C.red}${label} — ${code}${C.off}\n  ${reason}\n  ${C.dim}${cure}${C.off}\n`);
    return exit;
  };
  const refuse = (code, reason, cure = "Nothing was written.") => stop("REFUSE", 1, code, reason, cure);

  let body;
  try {
    body = String(file(args.handoff)).replace(/\r\n?/g, "\n");
    if (body.charCodeAt(0) === 0xfeff) body = body.slice(1); // a byte-order mark is not part of the comment
  } catch (e) {
    err(`  --handoff ${args.handoff} could not be read: ${firstLine(e)}\n${USAGE}`);
    return 2;
  }

  const rows = board();
  if (!rows.reachable) return refuse("RELEASE_BOARD_UNREADABLE", `Work Control is unreachable: ${rows.error}`, "Nothing was written. Run it again when GitHub answers.");
  const row = rows.items.find((it) => it.number === issue);
  if (!row) return refuse("RELEASE_NO_BOARD_ROW", `#${issue} has no row on the Work Control board, so there is no index to bring into line with the Handoff.`);
  let ids;
  try {
    ids = projectIds(row.itemId);
  } catch (e) {
    return refuse("RELEASE_BOARD_UNREADABLE", `The board's field ids could not be read: ${firstLine(e)}`, "Nothing was written. Run it again when GitHub answers.");
  }
  // The plan skips an option the board does not have, so a misspelt one would end the lease and leave
  // the row saying Active. Said here, before anything runs.
  for (const [flag, name, field] of [
    ["--status", args.status, ids.fields?.status],
    ["--gate", args.gate, ids.fields?.gate],
  ]) {
    if (!field?.options?.[name]) {
      err(`  ${flag} "${name}" is not an option on the board. It has: ${Object.keys(field?.options ?? {}).join(", ") || "(none read)"}.\n${USAGE}`);
      return 2;
    }
  }

  const words = stepWords(ids);
  let done;
  try {
    done = release({
      issue,
      self: seat(),
      ids,
      body,
      read,
      liveness: (folder) => liveness(folder, { now }),
      takeover: args.takeover,
      status: args.status,
      gate: args.gate,
      lastVerified: now.toISOString().slice(0, 10),
      dryRun,
      now,
      ...(exec ? { exec } : {}),
      ...(cacheDir ? { cacheDir } : {}),
    });
  } catch (e) {
    if (e?.code === "RELEASE_HALF_RUN") {
      dropBoardCache(); // the board changed: the write guard's copy of it is stale
      const remaining = e.remaining.map((s) => ({ describe: words(s), argv: s.argv }));
      const exit = stop("RELEASED, BOARD ROW INCOMPLETE", 3, e.code, e.message, "Run the steps left, in order, by hand.", {
        released: true,
        ran: e.ran.map(words),
        remaining,
      });
      if (!asJson) for (const s of remaining) err(`  ${C.yellow}left to run${C.off}  ${s.describe}  ${C.dim}gh ${JSON.stringify(s.argv)}${C.off}`);
      return exit;
    }
    if (e?.code === "RELEASE_POST_FAILED") return stop("FAILED", 1, e.code, e.reason, e.cure);
    if (typeof e?.code === "string" && e.code.startsWith("RELEASE_")) return refuse(e.code, e.reason, e.cure);
    throw e;
  }

  if (!dryRun) dropBoardCache(); // the board changed: the write guard's copy of it is stale
  const steps = done.ran.map((s) => ({ describe: words(s), ran: s.ran }));
  if (asJson) {
    log(JSON.stringify({ ok: true, issue, via: done.via, dryRun, steps, body: done.body }, null, 2));
    return 0;
  }
  const whose = `${done.claim.folder} @ ${done.claim.branch}`;
  if (dryRun) {
    log(`  ${C.yellow}dry run${C.off}  nothing was written. #${issue}'s lease (${whose}) would be released${done.via === "takeover" ? " by takeover" : ""} with this comment:\n`);
    log(done.body.trimEnd().split("\n").map((l) => `  ${C.dim}|${C.off} ${l}`).join("\n"));
    log("\n  then, in order:");
    for (const s of steps.slice(1)) log(`   ${s.describe}`);
  } else {
    log(`  ${C.green}lease released${C.off}  #${issue}  ${C.dim}(${whose}${done.via === "takeover" ? ", by takeover" : ""}; ${steps.length} steps run)${C.off}`);
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
