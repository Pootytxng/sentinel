// Every value the console shows is read here, and every value carries HOW it was obtained.
//
// The governing rule (#39): THE CONSOLE OWNS NO STATE. No database, no cache, no config file — so
// there is nowhere for a stale number to live. A source is read now or reported unreachable; it is
// never remembered from last time. That one property is what makes this safe to trust without
// maintaining it, and it is the difference between this and a notes app that rots.
//
// Consequence: nothing below throws. Failures become `{ok:false, error}` that the page renders as
// "unreachable". A blank tile is a bug. A tile quietly showing yesterday's answer is a worse one.
//
// Reuse over reimplementation: the board reader, the availability rules and the checkout scanner
// already exist in tools/entry and are covered by 659 tests. This module calls them rather than
// growing a second opinion about what "startable" means.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { readBoard, CODE_ROOT, HOST_DIR, REPO } from "../entry/gather.mjs";
import { availability } from "../entry/select.mjs";
import { discoverCheckouts } from "../entry/checkouts.mjs";
import { resolveAgent, assertSubscription } from "./agents.mjs";

export { CODE_ROOT, HOST_DIR, REPO };
export const CONTROL_DIR = join(CODE_ROOT, "compy-control");

const TIMEOUT_MS = 25_000;

function run(file, args, { cwd, timeout = TIMEOUT_MS } = {}) {
  return execFileSync(file, args, {
    cwd, timeout, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  }).trim();
}
const git = (cwd, args) => run("git", args, { cwd });
const gh = (args) => run("gh", args, { cwd: CONTROL_DIR });

/**
 * Turn a throwing read into a reachability verdict — the whole safety model, in one function.
 *
 * A failed source becomes something the page can render honestly, instead of an exception that
 * blanks a panel or a `null` indistinguishable from "nothing found".
 */
export function attempt(fn, fallback = null) {
  try {
    return { ok: true, value: fn(), error: null };
  } catch (e) {
    const line = String(e?.stderr || e?.message || e).split("\n").find((l) => l.trim()) ?? "unknown error";
    return { ok: false, value: fallback, error: line.trim().slice(0, 240) };
  }
}

/** Which agents this machine can actually drive, and — the part the owner cares about — who pays. */
export function readAgents({ env = process.env } = {}) {
  const claude = resolveAgent("claude", { env });
  const codex = resolveAgent("codex", { env });
  const version = (r) => (r.ok ? attempt(() => run(r.path, ["--version"]).split("\n")[0]) : { ok: false, value: null, error: r.error });
  const status = claude.ok ? attempt(() => run(claude.path, ["auth", "status"])) : { ok: false, value: null, error: "claude not found" };
  const billing = status.ok ? assertSubscription(status.value) : { ok: false, code: "AUTH_UNREADABLE", reason: status.error };
  return {
    claude: { ...claude, version: version(claude) },
    codex: { ...codex, version: version(codex) },
    billing,
  };
}

/** The host repository: the ONE object store every work folder hangs off (tools/entry §git.commonDir). */
export function readHost() {
  return {
    dir: HOST_DIR,
    branch: attempt(() => git(HOST_DIR, ["rev-parse", "--abbrev-ref", "HEAD"])),
    head: attempt(() => git(HOST_DIR, ["log", "-1", "--format=%h %ad %s", "--date=short"])),
    mainSha: attempt(() => git(HOST_DIR, ["rev-parse", "--short", "origin/main"])),
    dirty: attempt(() => git(HOST_DIR, ["status", "--porcelain"]).split("\n").filter(Boolean)),
    stashes: attempt(() => git(HOST_DIR, ["stash", "list"]).split("\n").filter(Boolean)),
  };
}

/**
 * Branches, with the only two facts that matter: is it published, and does it hold work nothing
 * else has.
 *
 * bug->guard: `published` used to be `Boolean(upstream)` — whether TRACKING is configured. That is
 * not the same question. Six branches on this machine exist perfectly well on the remote with no
 * upstream set, and Lost & found reported every one as "local only", i.e. as work one disk failure
 * from gone. A panel that cries wolf about six safe branches is a panel nobody reads on the day it
 * is right. Published now means what it says: a matching ref exists on the remote.
 */
export function readBranches() {
  const remote = attempt(() => {
    const raw = git(HOST_DIR, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"]);
    return new Set(raw.split("\n").filter(Boolean).map((r) => r.replace(/^origin\//, "")));
  }, null);

  return attempt(() => {
    const raw = git(HOST_DIR, [
      "for-each-ref", "--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(committerdate:short)", "refs/heads/",
    ]);
    return raw.split("\n").filter(Boolean).map((line) => {
      const [name, upstream, track, date] = line.split("|");
      const ahead = /ahead (\d+)/.exec(track ?? "");
      // If the remote list could not be read, say "unknown" by treating it as published rather than
      // inventing an alarm — an unreachable source must never manufacture a finding.
      const published = remote.ok ? remote.value.has(name) : true;
      return { name, upstream: upstream || null, published, ahead: ahead ? Number(ahead[1]) : 0, date };
    });
  }, []);
}

/** Open pull requests. `checks` is deliberately raw — see readCi() for why a red X may mean nothing. */
export function readPulls() {
  return attempt(() => {
    const raw = gh(["pr", "list", "--repo", REPO, "--state", "open", "--limit", "50",
      "--json", "number,title,isDraft,headRefName,mergeable,statusCheckRollup"]);
    return JSON.parse(raw).map((p) => ({
      number: p.number, title: p.title, draft: p.isDraft, branch: p.headRefName,
      mergeable: p.mergeable,
      checks: (p.statusCheckRollup ?? []).map((c) => ({ name: c.name, conclusion: c.conclusion })),
    }));
  }, []);
}

/**
 * Continuous integration — and specifically whether its verdicts MEAN anything.
 *
 * Bug->guard: on 2026-08-01 every PR showed three red checks and the last 100 runs were failures,
 * which reads as "the code is broken". It was not. Every job had `duration_ms: 0` and no steps,
 * because none of them ever started: "The job was not started because recent account payments have
 * failed or your spending limit needs to be increased." A red X that no test produced is worse than
 * no signal at all, so the console reports `meaningful:false` and says why rather than showing a
 * cross the owner would reasonably read as his fault.
 */
export function readCi() {
  return attempt(() => {
    const runs = JSON.parse(gh(["run", "list", "--repo", REPO, "--limit", "20",
      "--json", "databaseId,conclusion,createdAt,headBranch,displayTitle,workflowName"]));
    const lastSuccess = runs.find((r) => r.conclusion === "success") ?? null;
    const allFailed = runs.length > 0 && runs.every((r) => r.conclusion === "failure");
    let reason = null;
    if (allFailed && runs[0]) {
      const timing = attempt(() => JSON.parse(gh(["api", `repos/${REPO}/actions/runs/${runs[0].databaseId}/timing`])));
      const ms = timing.ok ? Number(timing.value?.run_duration_ms ?? 0) : null;
      const billable = timing.ok
        ? Object.values(timing.value?.billable ?? {}).reduce((n, b) => n + Number(b?.total_ms ?? 0), 0)
        : null;
      // Zero billable milliseconds across a completed run means no job ever executed.
      if (billable === 0) reason = `no job has started — ${ms}ms run, 0 billable ms. GitHub reports a billing or spending-limit block.`;
    }
    return { runs: runs.slice(0, 8), lastSuccess, meaningful: !reason, reason };
  }, { runs: [], lastSuccess: null, meaningful: false, reason: "GitHub unreachable" });
}

/** The board, with each item's startability decided by the SAME rule the launcher uses. */
export function readWork({ self = { lane: "Claude Code" }, now = new Date() } = {}) {
  const board = readBoard();
  if (!board.reachable) return { ok: false, error: board.error, items: [] };
  const items = board.items
    .filter((i) => i.status && i.status !== "Done")
    .map((i) => ({ ...i, availability: availability(i, { self, now }) }));
  return { ok: true, error: null, items, startable: items.filter((i) => i.availability.available).length };
}

/**
 * Lost & found — everything on this disk that nothing currently points at.
 *
 * This is the tab that exists because work keeps going missing in a project with 22 branches, 5
 * worktrees and three separate clones of the same repository. The rule for inclusion is simple and
 * mechanical: it holds work, or it occupies a name, and no open PR or live board item references it.
 */
export function readLostAndFound({ work = null, pulls = null, branches = null, host = null } = {}) {
  const w = work ?? readWork();
  const p = pulls ?? readPulls();
  const b = branches ?? readBranches();
  const h = host ?? readHost();

  const referenced = new Set();
  for (const pr of p.value ?? []) referenced.add(pr.branch);
  for (const it of w.items ?? []) {
    const m = /@\s*(\S+)\s*$/.exec(it.worktreeBranch ?? "");
    if (m) referenced.add(m[1]);
  }

  const found = [];

  for (const br of b.value ?? []) {
    if (br.name === "main") continue;
    const claimed = referenced.has(br.name);
    if (br.ahead > 0 && !claimed) {
      found.push({ kind: "branch", name: br.name, date: br.date, risk: `${br.ahead} commit${br.ahead === 1 ? "" : "s"} nothing points at`,
        why: "Ahead of its upstream, with no open PR and no live board item naming it." });
    } else if (br.ahead > 0) {
      found.push({ kind: "branch", name: br.name, date: br.date, risk: `${br.ahead} unpushed`,
        why: "Commits that exist only on this disk." });
    } else if (!br.published) {
      found.push({ kind: "branch", name: br.name, date: br.date, risk: "local only",
        why: "Never pushed — it exists on this machine and nowhere else." });
    }
  }

  if ((h.dirty.value ?? []).length) {
    found.push({ kind: "uncommitted", name: `${HOST_DIR} (${h.branch.value ?? "?"})`, date: null,
      risk: `${h.dirty.value.length} file${h.dirty.value.length === 1 ? "" : "s"}`,
      why: `Uncommitted work sitting in the host repository: ${h.dirty.value.join(", ").slice(0, 160)}` });
  }

  // Folders under the code root that git does not know about, and empty leftovers from retired worktrees.
  const known = new Set((attempt(() => discoverCheckouts({ roots: [CODE_ROOT] }), []).value ?? []).map((c) => c.path.toLowerCase()));
  const dirs = attempt(() => readdirSync(CODE_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()), []);
  for (const d of dirs.value ?? []) {
    const full = join(CODE_ROOT, d.name);
    if (known.has(full.toLowerCase())) continue;
    if (!existsSync(join(full, ".git"))) {
      const empty = attempt(() => readdirSync(full).length === 0, false);
      if (empty.value) {
        found.push({ kind: "orphan", name: full, date: null, risk: "empty folder",
          why: "Left behind when a worktree was retired. Safe to delete; a held handle clears on reboot." });
      }
    }
  }

  // Dead editor bridges: lock files for VS Code sessions whose process is long gone.
  const ideDir = join(homedir(), ".claude", "ide");
  const locks = attempt(() => readdirSync(ideDir).filter((f) => f.endsWith(".lock")), []);
  if ((locks.value ?? []).length) {
    found.push({ kind: "stale", name: `${locks.value.length} editor bridge lock files`, date: null, risk: "stale",
      why: `${ideDir} — left by editor sessions that have exited.` });
  }

  return found;
}

/** One read of everything, with a timestamp. The page asks for this and renders exactly what it gets. */
export function snapshot({ self = { lane: "Claude Code" }, now = new Date() } = {}) {
  const host = readHost();
  const branches = readBranches();
  const pulls = readPulls();
  const work = readWork({ self, now });
  const ci = readCi();
  return {
    generatedAt: now.toISOString(),
    codeRoot: CODE_ROOT,
    agents: readAgents(),
    host,
    branches,
    pulls,
    work,
    ci,
    lostAndFound: readLostAndFound({ work, pulls, branches, host }),
  };
}
