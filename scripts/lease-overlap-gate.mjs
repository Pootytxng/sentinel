#!/usr/bin/env node
// The push-time lease check, as a gate (#517).
//
// scripts/verify-local.ps1 runs this before the test suite on every push. It reads the live lease on
// every open issue, and refuses the push when the committed diff since origin/main touches a path
// another issue's lease holds from earlier than this lane's own claim on it. The decision is
// scripts/lib/lease-overlap.mjs; this file only gathers the facts: the diff from git, and the threads
// from GitHub, folded by tools/entry/claim.mjs's threadLease -- the same fold gather.mjs and
// work-control-gate.mjs use, so a claim is released here exactly when it is released there.
//
// What it reads, and why that set:
//   - the COMMITTED diff, `origin/main...HEAD`. A push carries commits, and .githooks/pre-push does
//     not forward the refs git hands it, so this is the same base scope-drift-gate.mjs measures.
//   - every OPEN issue with a thread, whatever its board column. Done is the column the board gives a
//     closed issue, and asking the board would put `gh project item-list`, the costliest read there
//     is, inside every push. Reading an open issue that sits in Done costs one read and can only
//     refuse more, never pass more.
//   - over REST, one bounded `gh api` per thread, several at once. One GraphQL request for every
//     thread timed out at 20 s on 2026-09-23 while single-thread reads still answered.
//
// Every read is bounded by GH_READ_TIMEOUT_MS through ghReader() (#474, #514), and any read that fails,
// times out or returns what cannot be parsed makes that lease unknown -- which refuses the push
// (collision rule 5). An empty diff reads nothing and passes: a push that writes no path cannot write
// another lane's.
//
//   node scripts/lease-overlap-gate.mjs [--issue N] [--cwd DIR] [--base REF] [--json]
//
//   --issue   this lane's issue; default: this folder's session record. None = this push holds no lease.
//   exit 1    a pushed path another live lease holds from earlier, or a lease that could not be read

import { execFile, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CORRUPT, readLineage } from "../.claude/hooks/session-root-assert.mjs";
import { threadLease } from "../tools/entry/claim.mjs";
import { GH_READ_TIMEOUT_MS, REPO, ghReader } from "../tools/entry/gather.mjs";
import { normalizePattern } from "./lib/claim-scope.mjs";
import { leaseOverlapVerdict, renderLeaseOverlap } from "./lib/lease-overlap.mjs";

/** Threads read at once. Enough to finish ~45 threads in a few seconds; few enough not to trip abuse limits. */
export const READ_CONCURRENCY = 6;

const execFileP = promisify(execFile);
/** An async `gh` for reads, through ghReader() so it shares GH_READ_TIMEOUT_MS. `exec` is the seam a guard stubs. */
export function asyncGhReader({ exec = (cmd, args, opts) => execFileP(cmd, args, opts).then((r) => r.stdout) } = {}) {
  return ghReader({ exec, timeout: GH_READ_TIMEOUT_MS });
}

const defaultGit = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
const firstLine = (e) => String(e?.stderr || e?.message || e).split("\n").filter(Boolean)[0] ?? "unknown error";

/** gh's `--jq` output: one compact JSON value per line. A line that does not parse is a failed read. */
export function parseLines(raw) {
  return String(raw ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** Every open issue (pull requests excluded) with its comment count. Throws when it cannot be read. */
export async function readOpenIssues({ gh }) {
  const raw = await gh(["api", "--paginate", `repos/${REPO}/issues?state=open&per_page=100`, "--jq", ".[] | select(.pull_request == null) | {number, comments}"]);
  return parseLines(raw).map((i) => ({ number: Number(i.number), comments: Number(i.comments) }));
}

/** One thread, folded. Never throws: a thread that could not be read comes back `unreadable`. */
export async function readThread(number, { gh }) {
  try {
    const raw = await gh(["api", "--paginate", `repos/${REPO}/issues/${number}/comments?per_page=100`, "--jq", ".[] | {body, created_at, html_url}"]);
    const comments = parseLines(raw).map((c) => ({ body: c.body, createdAt: c.created_at, url: c.html_url }));
    return { number, run: threadLease(comments).run };
  } catch (e) {
    return { number, unreadable: true, why: `its thread could not be read (${e?.killed ? `no answer in ${GH_READ_TIMEOUT_MS / 1000} s` : firstLine(e)})` };
  }
}

/** Every open issue's thread, READ_CONCURRENCY at a time. An issue with no comments has no lease to read. */
export async function readLeases({ gh, concurrency = READ_CONCURRENCY }) {
  let issues;
  try {
    issues = await readOpenIssues({ gh });
  } catch (e) {
    return { threads: [], listError: e?.killed ? `no answer in ${GH_READ_TIMEOUT_MS / 1000} s` : firstLine(e) };
  }
  const todo = issues.filter((i) => i.comments > 0).map((i) => i.number);
  const threads = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) threads.push(await readThread(todo[next++], { gh }));
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { threads: threads.sort((a, b) => a.number - b.number), listError: null };
}

/** The paths the push carries: committed since the merge base, both names of a rename. Null = no base. */
export function pushedPaths({ cwd, base = "origin/main", git = defaultGit }) {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch {
    return null;
  }
  const raw = git(cwd, ["diff", "--name-only", "-z", "--no-renames", `${base}...HEAD`]);
  return [...new Set(raw.split("\0").map(normalizePattern).filter(Boolean))].sort();
}

export function parseArgs(argv) {
  const out = { issue: null, cwd: process.cwd(), base: "origin/main", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--issue") out.issue = Number(argv[++i]);
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--base") out.base = argv[++i];
    else if (a === "--json") out.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/** The whole verdict as data, so a test can read it and `--json` can print it. */
export async function gate({ issue = null, cwd = process.cwd(), base = "origin/main", now = new Date(), lineage = readLineage, git = defaultGit, gh = asyncGhReader() } = {}) {
  const root = resolve(cwd);
  const changed = pushedPaths({ cwd: root, base, git });
  if (changed === null) {
    return { ok: false, base, changed: [], reason: `${base} is not a commit here, so what this push carries cannot be measured; fetch it and push again` };
  }
  if (changed.length === 0) return { ok: true, base, changed, reason: `nothing committed since ${base}; a push that writes no path cannot write another lane's` };
  let own = Number.isInteger(issue) && issue > 0 ? issue : null;
  if (own === null) {
    const record = lineage({ root });
    if (record && record !== CORRUPT && Number.isInteger(record.issue) && record.issue > 0) own = record.issue;
  }
  const { threads, listError } = await readLeases({ gh });
  const verdict = leaseOverlapVerdict({ changed, own, threads, listError, now });
  return { ok: verdict.ok, base, changed, verdict };
}

export function render(result) {
  if (!result.verdict) return `lease overlap (#517): ${result.ok ? "OK" : "REFUSED"} -- ${result.reason}`;
  return renderLeaseOverlap(result.verdict, { base: result.base, changed: result.changed });
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  const result = await gate({ issue: args.issue, cwd: args.cwd, base: args.base });
  process.stdout.write(`${args.json ? JSON.stringify(result, null, 2) : render(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
