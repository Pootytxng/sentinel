#!/usr/bin/env node
// Land a pull request in one breath: receipt gate -> retarget check -> merge -> prune -> fetch -> audit.
//
// Why (P0-H case 10, measured 2026-09-03 on PR #364, #362): between `gh pr merge` and the prune of
// the merged ref, that ref is LANDED and UNRECORDED, and scripts/branch-disposition-audit.mjs FAILS
// for every gate in the repository -- a peer's push would red on THIS lane's bookkeeping -- while the
// peer's preflight still answers PASS. Right after the merge: audit FAIL, preflight #363 PASS. After
// the prune: audit OK, preflight PASS. The cure is the prune; the window is however long a session
// spends between the two commands, and a session spends minutes. This script makes it one command
// in the guarded order (#337: retarget every dependent PR first, then delete), so the window is
// seconds and mechanical instead of attention-shaped.
//
//   node scripts/land-pr.mjs --pr N --receipt .claude/work-control/<transition>.json [--dry-run]
//
// It refuses, in this order: a receipt whose `transition` is not "merge-pr" (the gate judges a receipt
// by its own transition, so a same-PR close-issue receipt would never have this PR's closing references
// read -- HQ review 5178030363); a receipt whose `pr` is not the PR being landed (#413: the gate checks
// the closing references of the PR the receipt names, so a receipt copied from another landing would
// have it check the wrong PR); a receipt the work-control gate does not PASS; a PR that is not OPEN;
// a PR from a fork (its head is not ours to prune); a head that is `main`; a head another open PR is
// based on (names the retarget, never the delete); a head a disposition record says to keep
// (PRESERVE / LANDED). It never passes --delete-branch (GitHub closes dependent PRs, #337) and never
// squashes (a squash orphans the lane's commits from main). A merge that succeeds but a prune that
// fails is said out loud with the exact command left to run, because that is the window this exists
// to close.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAll } from "./lib/dispositions.mjs";

export const REPO = "Pootytxng/sentinel";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = new Set(["PRESERVE", "LANDED"]);

export const bareRef = (ref) => (String(ref).startsWith("origin/") ? String(ref).slice("origin/".length) : String(ref));
export const retargetCommand = (pr, base) => `gh pr edit ${pr} --repo ${REPO} --base ${base}`;

/**
 * Pure. Given the landing PR's view, the open PRs and the disposition records: the steps in the
 * guarded order, or the refusal with its cure.
 */
export function planLanding({ pr, view, openPrs = [], records = [] }) {
  const refuse = (reason) => ({ ok: false, reason, steps: [] });
  if (!view || view.state !== "OPEN") {
    return refuse(`PR #${pr} is ${view?.state ?? "unknown"}, not OPEN -- there is nothing to land.`);
  }
  if (view.isCrossRepository) {
    return refuse(`PR #${pr} comes from a fork; merge it by hand and leave its head alone -- the ref is not ours to prune.`);
  }
  const head = bareRef(view.headRefName);
  const base = bareRef(view.baseRefName);
  if (head === "main") return refuse(`PR #${pr}'s head is main; nothing here deletes main.`);
  const dependents = openPrs
    .filter((p) => p.number !== pr && bareRef(p.baseRefName) === head)
    .map((p) => p.number);
  if (dependents.length) {
    const s = dependents.length === 1 ? "" : "s";
    return refuse(
      `open PR${s} ${dependents.map((n) => `#${n}`).join(", ")} ${dependents.length === 1 ? "is" : "are"} based on ` +
        `${head}; pruning it would close ${dependents.length === 1 ? "that PR" : "them"} (#337). Retarget first: ` +
        dependents.map((n) => retargetCommand(n, base)).join(" && "),
    );
  }
  const keep = records.find((r) => bareRef(r.ref) === head && KEEP.has(r.disposition));
  if (keep) {
    return refuse(`${keep.ref} is recorded ${keep.disposition} -- kept on purpose. Merge by hand and leave the ref.`);
  }
  return {
    ok: true,
    head,
    base,
    steps: [
      { what: "merge", cmd: ["gh", "pr", "merge", String(pr), "--repo", REPO, "--merge"] },
      { what: "prune", cmd: ["git", "push", "origin", "--delete", head] },
      { what: "refresh", cmd: ["git", "fetch", "origin", "--prune"] },
      { what: "audit", cmd: ["node", "scripts/branch-disposition-audit.mjs"] },
    ],
  };
}

export const renderPlan = (plan) => plan.steps.map((s) => `  ${s.what.padEnd(8)}${s.cmd.join(" ")}`).join("\n");

function run(cmd) {
  return execFileSync(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function readView(pr, exec = run) {
  return JSON.parse(
    exec(["gh", "pr", "view", String(pr), "--repo", REPO, "--json", "number,state,baseRefName,headRefName,isCrossRepository"]),
  );
}

export function readOpenPullRequests(exec = run) {
  return JSON.parse(
    exec(["gh", "pr", "list", "--repo", REPO, "--state", "open", "--json", "number,baseRefName,headRefName", "--limit", "200"]),
  );
}

/**
 * The `transition` and `pr` a receipt names, read the way the gate will read it (relative to ROOT,
 * where the gate runs). `{ ok: false }` when the file cannot be read or parsed.
 */
export function receiptPr(receipt, root = ROOT) {
  try {
    const record = JSON.parse(readFileSync(resolve(root, receipt), "utf8"));
    return { ok: true, transition: record?.transition, pr: record?.pr };
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e).split("\n")[0] };
  }
}

const USAGE = "usage: node scripts/land-pr.mjs --pr N --receipt .claude/work-control/<transition>.json [--dry-run]";

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pr = Number(arg("--pr"));
  const receipt = arg("--receipt");
  const dryRun = argv.includes("--dry-run");
  if (!Number.isInteger(pr) || pr <= 0) {
    io.error(USAGE);
    return 2;
  }
  if (!receipt && !dryRun) {
    io.error("land-pr: --receipt <path> is required -- a merge is a proof-dependent transition (docs/WORK_CONTROL.md).\n" + USAGE);
    return 2;
  }
  if (receipt) {
    const named = receiptPr(receipt);
    if (!named.ok) {
      io.error(`land-pr: the receipt ${receipt} could not be read (${named.why}) -- refusing to merge.`);
      return 1;
    }
    // Exactly "merge-pr": the gate runs the checks of the receipt's own transition, and only a merge-pr
    // receipt has this PR's closingIssuesReferences held to the lease check (HQ review 5178030363).
    if (named.transition !== "merge-pr") {
      io.error(
        `land-pr: the receipt ${receipt} has transition ${JSON.stringify(named.transition ?? null)}, so it is not a merge-pr receipt -- ` +
          "refusing to merge. The gate judges a receipt by its own transition, so only a merge-pr receipt has this PR's " +
          "closing references held to the lease check (#413).",
      );
      return 1;
    }
    // `pr` was checked a plain positive integer above; strict equality refuses "395", 395.5 and a missing pr.
    if (named.pr !== pr) {
      io.error(
        `land-pr: the receipt ${receipt} names PR #${named.pr ?? "(none)"}, not #${pr} -- refusing to merge. The gate ` +
          "checks the closing references of the PR its receipt names (#413), so a receipt for another PR proves nothing here.",
      );
      return 1;
    }
    const gate = (io.spawn ?? spawnSync)("node", ["scripts/work-control-gate.mjs", receipt], { cwd: ROOT, encoding: "utf8" });
    if (gate.stdout) process.stdout.write(gate.stdout);
    if (gate.status !== 0) {
      io.error(`land-pr: the work-control gate did not PASS ${receipt} (exit ${gate.status}) -- refusing to merge.`);
      return 1;
    }
  }
  const view = readView(pr);
  const openPrs = readOpenPullRequests();
  const { records } = readAll(ROOT);
  const plan = planLanding({ pr, view, openPrs, records });
  if (!plan.ok) {
    io.error(`land-pr: refused -- ${plan.reason}`);
    return 1;
  }
  io.log(`land-pr: PR #${pr} (${plan.head} -> ${plan.base}), in this order:\n${renderPlan(plan)}`);
  if (dryRun) {
    io.log("land-pr: dry run, nothing executed.");
    return 0;
  }
  for (const [i, step] of plan.steps.entries()) {
    const t0 = Date.now();
    try {
      const out = run(step.cmd);
      if (out.trim()) process.stdout.write(out.trimEnd() + "\n");
      io.log(`land-pr: ${step.what} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      const detail = String(e?.stderr || e?.stdout || e?.message || e).trim();
      io.error(`land-pr: ${step.what} FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${detail}`);
      if (step.what !== "merge") {
        const left = plan.steps.slice(i).map((s) => s.cmd.join(" ")).join(" && ");
        io.error(
          `land-pr: the merge is DONE and ${plan.head} is still on origin -- every gate in the repo reds until it is ` +
            `pruned. Finish by hand, now: ${left}`,
        );
      }
      return 1;
    }
  }
  return 0;
}

const entry = process.argv[1] ? basename(process.argv[1]) : "";
if (entry && import.meta.url.endsWith(entry)) process.exitCode = main();
