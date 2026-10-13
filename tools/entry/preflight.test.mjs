// Guards 4 and 7, and every edge case in spec §7.
//
// The reconciler is the piece that makes the governing invariant checkable: "a task must not begin
// until its Work Control issue, active claim, actual session root, Git worktree, branch, dirty
// state, active processes, and effective project settings agree." It produces a VERDICT, never a
// repair, and REFUSE always precedes the first write.
//
// Pure over injected facts, so every edge case is a data fixture rather than a machine state.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverCheckouts } from "./checkouts.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
// By namespace, so the holder guards below fail one by one on a preflight that has no holder path.
import * as preflight from "./preflight.mjs";
import { verdictLines } from "./render.mjs";
import { samePath } from "./worktree-field.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const BRANCH = "feat/single-entry-workflow";
const NOW = new Date("2026-07-30T12:00:00Z");

const check = (r, name) => r.checks.find((c) => c.name === name);
// A definite conflict with a separate clone is this project's rule; Git refuses only within one common dir (#421).
const PROJECT_RULE = /^Git itself would not refuse this: a separate clone keeps its own branches\. This project does/;

function baseWorld(overrides = {}) {
  return {
    board: { reachable: true },
    self: { lane: "Claude Code" },
    now: NOW,
    task: {
      number: 18,
      title: "One owner-facing Compy entrypoint",
      status: "Active",
      lane: "Claude Code",
      gate: "None",
      worktreeBranch: `${FOLDER} @ ${BRANCH}`,
      nextAction: "Implement the reconciler.",
      claimExpires: "2026-07-31",
    },
    items: [
      { number: 18, status: "Active", lane: "Claude Code", worktreeBranch: `${FOLDER} @ ${BRANCH}` },
      {
        number: 17,
        status: "Review",
        lane: "Codex",
        worktreeBranch: "C:\\Users\\Kuya\\code\\sentinel-rel @ codex/product-quality-blueprint",
      },
    ],
    claim: { issue: 18, lane: "Claude Code", folder: FOLDER, branch: BRANCH, expires: "2026-07-31" },
    handoff: null,
    checkouts: [
      { path: FOLDER, branch: BRANCH, kind: "linked", commonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git", remote: "git@github.com:Pootytxng/sentinel.git" },
      { path: "C:\\Users\\Kuya\\code\\sentinel", branch: "release/v0.9.9-candidate", kind: "host", commonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git", remote: "git@github.com:Pootytxng/sentinel.git" },
    ],
    gitState: { ok: true, branch: BRANCH, detached: false, clean: true, workingTreeClean: true, modified: 0, untracked: 0, staged: 0, stashed: 0, ahead: 0, behind: 0, unmerged: 0, files: { modified: [], untracked: [], staged: [], unmerged: [] } },
    expectedCommonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git",
    window: {
      intended: { window: 150000, reason: "default policy window", marathon: false },
      effective: { window: 150000, configured: true, source: "settings", file: `${FOLDER}\\.claude\\settings.json`, ignored: [] },
    },
    subagentModel: { value: "sonnet", source: `${FOLDER}\\.claude\\settings.json` },
    hooks: { ok: true, checked: new Array(7).fill({}), missing: [], remediation: null },
    processes: [],
    scope: { mine: ["tools/entry"], text: "`tools/entry/`", source: "claim", others: [], files: [] },
    ...overrides,
  };
}

describe("the passing case", () => {
  it("PASSes when every value agrees", () => {
    const r = reconcile(baseWorld());
    expect(r.verdict).toBe("PASS");
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("every check is a named comparison with an expected and an actual", () => {
    // This shape is what makes the guards mechanizable rather than aspirational — a check that
    // cannot state what it expected cannot be reproduced by a test.
    for (const c of reconcile(baseWorld()).checks) {
      expect(typeof c.name).toBe("string");
      expect(c).toHaveProperty("expected");
      expect(c).toHaveProperty("actual");
      expect(typeof c.ok).toBe("boolean");
    }
  });

  it("evaluates every check even after the first failure", () => {
    // One launch should show Kuya the whole picture, not make him peel failures one at a time.
    const r = reconcile(baseWorld({ gitState: { ...baseWorld().gitState, branch: "main", clean: false, modified: 3, files: { modified: ["a", "b", "c"], untracked: [], staged: [], unmerged: [] } } }));
    expect(r.verdict).toBe("REFUSE");
    expect(r.checks.filter((c) => !c.ok).length).toBeGreaterThan(1);
    expect(r.checks.length).toBe(reconcile(baseWorld()).checks.length);
  });
});

describe("guard 4 — correct branch, but another writer owns the folder", () => {
  it("refuses when a second Active item names the same folder", () => {
    const w = baseWorld();
    w.items.push({ number: 13, status: "Active", lane: "Codex", worktreeBranch: `${FOLDER} @ codex/something-else` });
    const r = reconcile(w);
    expect(r.verdict).toBe("REFUSE");
    expect(check(r, "folder.writer").ok).toBe(false);
    expect(check(r, "folder.writer").actual).toMatch(/#13/);
  });

  it("compares folders case-insensitively — a different casing is the same folder", () => {
    const w = baseWorld();
    w.items.push({ number: 13, status: "Active", lane: "Codex", worktreeBranch: `${FOLDER.toLowerCase()} @ codex/x` });
    expect(check(reconcile(w), "folder.writer").ok).toBe(false);
  });

  it("does not count our own item as a competing writer", () => {
    expect(check(reconcile(baseWorld()), "folder.writer").ok).toBe(true);
  });

  it("does not count a non-Active item in the same folder", () => {
    const w = baseWorld();
    w.items.push({ number: 13, status: "Ready", lane: "Codex", worktreeBranch: `${FOLDER} @ codex/x` });
    expect(check(reconcile(w), "folder.writer").ok).toBe(true);
  });
});

describe("guard 7 — the board's next action drifting from the durable handoff", () => {
  it("refuses when the field and the newest handoff disagree", () => {
    const w = baseWorld({ handoff: { nextAction: "Write the launcher.", postedAt: "2026-07-30T11:00:00Z" } });
    const r = reconcile(w);
    expect(check(r, "board.nextAction").ok).toBe(false);
    expect(check(r, "board.nextAction").expected).toBe("Write the launcher.");
    expect(r.verdict).toBe("REFUSE");
  });

  it("passes when they agree, ignoring whitespace and trailing punctuation", () => {
    const w = baseWorld({ handoff: { nextAction: "  implement the reconciler  ", postedAt: "2026-07-30T11:00:00Z" } });
    expect(check(reconcile(w), "board.nextAction").ok).toBe(true);
  });

  it("passes when no handoff exists yet — a fresh task has nothing to drift from", () => {
    expect(check(reconcile(baseWorld()), "board.nextAction").ok).toBe(true);
  });
});

describe("guard 3 — correct folder, wrong branch", () => {
  it("refuses a checkout on a different branch than the claim names", () => {
    const w = baseWorld();
    w.gitState = { ...w.gitState, branch: "release/v0.9.9-candidate" };
    const r = reconcile(w);
    expect(check(r, "git.branch").ok).toBe(false);
    expect(check(r, "git.branch").expected).toBe(BRANCH);
    expect(check(r, "git.branch").actual).toBe("release/v0.9.9-candidate");
  });

  it("refuses a detached HEAD", () => {
    const w = baseWorld();
    w.gitState = { ...w.gitState, branch: null, detached: true, clean: false };
    expect(check(reconcile(w), "git.branch").ok).toBe(false);
  });
});

describe("guard 5 — dirty worktree reuse", () => {
  it.each([
    ["modified", { modified: 1, files: { modified: ["a"], untracked: [], staged: [], unmerged: [] } }],
    ["untracked", { untracked: 1, files: { modified: [], untracked: ["b"], staged: [], unmerged: [] } }],
    ["staged", { staged: 1, files: { modified: [], untracked: [], staged: ["c"], unmerged: [] } }],
    ["stashed", { stashed: 1 }],
    ["ahead", { ahead: 2 }],
    ["behind", { behind: 2 }],
  ])("refuses reuse over %s state", (_label, patch) => {
    const w = baseWorld();
    w.gitState = { ...w.gitState, ...patch, clean: false };
    const r = reconcile(w);
    expect(check(r, "git.clean").ok).toBe(false);
    expect(r.verdict).toBe("REFUSE");
  });

  it("never proposes a repair — reporting is the whole contract", () => {
    const w = baseWorld();
    w.gitState = { ...w.gitState, stashed: 1, clean: false };
    const text = JSON.stringify(reconcile(w));
    expect(text).not.toMatch(/git reset|git checkout --|git clean|stash drop|stash pop/);
  });
});

describe("guard 2 — the effective context window", () => {
  it("refuses a window that disagrees with policy, in either direction", () => {
    const small = baseWorld();
    small.window = { intended: { window: 300000, reason: "marathon tier" }, effective: { window: 150000, configured: true, file: "x", ignored: [] } };
    expect(check(reconcile(small), "settings.window").ok).toBe(false);

    const large = baseWorld();
    large.window = { intended: { window: 150000, reason: "default" }, effective: { window: 300000, configured: true, file: "x", ignored: [] } };
    expect(check(reconcile(large), "settings.window").ok).toBe(false);
  });

  // Comparing was all it could ever do, and a launcher that can only complain is the chore this
  // program deletes (#23). When the tier module says the disagreement is one the launcher may safely
  // settle in its own gitignored layer, the row passes and SAYS it will be established — a green row
  // that hides a pending write is the drift these checks exist to prevent.
  it("accepts a disagreement the launcher can safely establish, and says so on the row", () => {
    const w = baseWorld();
    w.window = {
      intended: { window: 300000, reason: "issue #23 is scoped to the 300000 marathon tier", marathon: true },
      effective: { window: 150000, configured: true, file: "x", ignored: [] },
      plan: { action: "write", window: 300000, reason: "the tracked settings configure 150000" },
    };
    const row = check(reconcile(w), "settings.window");
    expect(row.ok).toBe(true);
    expect(`${row.note ?? ""}`).toMatch(/establish/i);
  });

  // The exact line Kuya was shown, and the exact reason it was useless: 150000 against 150000, FAIL,
  // with nothing on the row explaining that the number was a fallback rather than a decision. It is
  // now a green row that names the provenance defect and what the launcher will do about it.
  it("establishes a window nothing configured, instead of failing on a number that matches", () => {
    const w = baseWorld();
    w.window = {
      intended: { window: 150000, reason: "default policy window", marathon: false },
      effective: { window: 150000, configured: false, file: null, ignored: [] },
      plan: { action: "write", window: 150000, reason: "the tracked settings configure nothing" },
    };
    const row = check(reconcile(w), "settings.window");
    expect(row.ok).toBe(true);
    expect(`${row.note ?? ""}`).toMatch(/configure/i);
  });

  it("still refuses when the file that would have to change is not the launcher's", () => {
    const w = baseWorld();
    w.window = {
      intended: { window: 300000, reason: "marathon tier", marathon: true },
      effective: { window: 150000, configured: true, file: "x", ignored: [] },
      plan: { action: "refuse", window: 300000, reason: ".claude/settings.local.json was not written by the launcher, so it is not the launcher's to change." },
    };
    const row = check(reconcile(w), "settings.window");
    expect(row.ok).toBe(false);
    expect(row.remediation).toMatch(/not written by the launcher/);
  });

  it("refuses a mismatch with no plan at all — an unexamined disagreement is not an establishable one", () => {
    const w = baseWorld();
    w.window = { intended: { window: 300000, reason: "marathon tier" }, effective: { window: 150000, configured: true, file: "x", ignored: [] } };
    expect(check(reconcile(w), "settings.window").ok).toBe(false);
  });

  it("refuses a subagent model that is not sonnet", () => {
    const w = baseWorld({ subagentModel: { value: "opus", source: "x" } });
    expect(check(reconcile(w), "settings.subagentModel").ok).toBe(false);
  });
});

describe("hooks", () => {
  it("refuses a folder whose registered hooks are absent, and carries the remediation through", () => {
    const w = baseWorld({
      hooks: { ok: false, checked: new Array(7).fill({}), missing: [{ name: "subagent-model-guard.mjs" }], remediation: "run with --repair" },
    });
    const r = reconcile(w);
    expect(check(r, "hooks.present").ok).toBe(false);
    expect(r.remediation.join(" ")).toMatch(/--repair/);
  });

  // Measured on the live 2026-07-30 PASS: the leftover WAS forgiven, and the row went green with no
  // trace of it, because the renderer prints `actual` only when a check fails. Silently repairing
  // ourselves behind a green row is how a launcher accumulates state nobody knows about. The
  // condition is "a leftover reaches the owner's screen", not "a field is populated" — so the guard
  // asserts against the rendered lines, which is what he actually reads.
  it("says a forgiven leftover out loud on a green row", () => {
    const w = baseWorld({
      hooks: { ok: true, checked: new Array(9).fill({}), missing: [], stale: [{ name: "session-assert-hook.mjs" }], remediation: null },
    });
    const c = check(reconcile(w), "hooks.present");
    expect(c.ok).toBe(true);
    expect(c.note).toMatch(/1 stale overlay entry to take back/);
  });

  it("adds no note when there is no leftover", () => {
    expect(check(reconcile(baseWorld()), "hooks.present").note).toBe(null);
  });
});

describe("what the owner actually reads", () => {
  const world = (hooks) => reconcile(baseWorld({ hooks }));

  it("renders the note under a passing check", () => {
    const lines = verdictLines({ number: 18, title: "t" }, world({ ok: true, checked: new Array(9).fill({}), missing: [], stale: [{}], remediation: null })).join("\n");
    expect(lines).toMatch(/ok/);
    expect(lines).toMatch(/1 stale overlay entry to take back/);
  });

  it("still renders the actual value under a failing check", () => {
    const lines = verdictLines({ number: 18, title: "t" }, world({ ok: false, checked: new Array(9).fill({}), missing: [{ name: "x.mjs" }], stale: [], remediation: "run with --repair" })).join("\n");
    expect(lines).toMatch(/1 missing/);
  });

  it("prints nothing extra for a check with neither", () => {
    const lines = verdictLines({ number: 18, title: "t" }, world({ ok: true, checked: new Array(9).fill({}), missing: [], stale: [], remediation: null }));
    expect(lines.filter((l) => l.includes("hooks.present"))).toHaveLength(1);
  });
});

describe("edge cases (spec §7)", () => {
  it("Work Control unavailable → refuse; offline is not a licence to start unclaimed", () => {
    const r = reconcile(baseWorld({ board: { reachable: false, error: "gh: network" } }));
    expect(r.verdict).toBe("REFUSE");
    expect(check(r, "board.reachable").ok).toBe(false);
  });

  it("owner-gated task → refuse, naming the gate", () => {
    const w = baseWorld();
    w.task = { ...w.task, gate: "Kuya", status: "Needs Kuya" };
    const r = reconcile(w);
    expect(check(r, "task.gate").ok).toBe(false);
    expect(check(r, "task.gate").actual).toBe("Kuya");
    expect(check(r, "task.status").ok).toBe(false);
  });

  it.each(["Needs Kuya", "Blocked", "Done", "Inbox"])("status %s → refuse", (status) => {
    const w = baseWorld();
    w.task = { ...w.task, status };
    expect(check(reconcile(w), "task.status").ok).toBe(false);
  });

  it("expired claim → refuse, and offer a takeover DRAFT rather than a takeover", () => {
    const w = baseWorld();
    w.claim = { ...w.claim, expires: "2026-07-29" };
    w.task = { ...w.task, claimExpires: "2026-07-29" };
    const r = reconcile(w);
    expect(check(r, "task.claim").ok).toBe(false);
    expect(r.takeoverDraft).toBeTruthy();
    expect(r.takeoverDraft).toMatch(/Verified takeover/);
    expect(JSON.stringify(r)).not.toMatch(/git reset|--force|worktree remove/);
  });

  it("another lane's live claim → refuse", () => {
    const w = baseWorld();
    w.claim = { ...w.claim, lane: "Codex", issue: 18 };
    expect(check(reconcile(w), "task.claim").ok).toBe(false);
  });

  it("missing worktree that is safely creatable → PASS with a create action, not a refusal", () => {
    const w = baseWorld();
    w.checkouts = w.checkouts.filter((c) => c.path !== FOLDER);
    w.gitState = null;
    const r = reconcile(w);
    expect(check(r, "folder.exists").ok).toBe(true);
    expect(r.actions).toContain("create-worktree");
    expect(r.verdict).toBe("PASS");
  });

  it("missing worktree whose branch is checked out elsewhere → refuse, naming the other folder", () => {
    const w = baseWorld();
    w.checkouts = [
      { path: "C:\\Users\\Kuya\\code\\sentinel-rel091", branch: BRANCH, kind: "linked", commonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git", remote: "r" },
    ];
    w.gitState = null;
    const r = reconcile(w);
    expect(check(r, "git.branchElsewhere").ok).toBe(false);
    expect(check(r, "git.branchElsewhere").actual).toMatch(/sentinel-rel091/i);
    expect(r.verdict).toBe("REFUSE");
  });

  it("the folder belongs to a different repository → refuse", () => {
    const w = baseWorld();
    w.checkouts = w.checkouts.map((c) => (c.path === FOLDER ? { ...c, commonDir: "C:\\Users\\Kuya\\code\\sister-site\\.git" } : c));
    expect(check(reconcile(w), "git.commonDir").ok).toBe(false);
  });

  it("an unparseable worktree field → refuse before anything downstream is trusted", () => {
    const w = baseWorld();
    w.task = { ...w.task, worktreeBranch: "sentinel + sentinel-feedback · exact active folder unknown/locked" };
    const r = reconcile(w);
    expect(check(r, "field.canonical").ok).toBe(false);
    expect(r.verdict).toBe("REFUSE");
  });

  it("live processes are disclosed, and a contending one refuses", () => {
    const informational = baseWorld({ processes: [{ name: "compy.exe", count: 1, contends: false, note: "installed review build from #14" }] });
    expect(check(reconcile(informational), "processes").ok).toBe(true);
    expect(check(reconcile(informational), "processes").actual).toMatch(/compy\.exe/);

    const contending = baseWorld({ processes: [{ name: "cargo.exe", count: 1, contends: true, note: "build in this folder" }] });
    expect(check(reconcile(contending), "processes").ok).toBe(false);
  });

  it("never proposes killing another tool's process (collision rule 6)", () => {
    const w = baseWorld({ processes: [{ name: "node.exe", count: 8, contends: true, note: "another session" }] });
    expect(JSON.stringify(reconcile(w))).not.toMatch(/taskkill|Stop-Process|kill -9/i);
  });
});

describe("git.branchElsewhere — a branch name belongs to one repository (#421)", () => {
  // Git keeps one branch namespace per repository, so the same name in another project is no
  // collision. Counting it refused the host on `main` because holoforge was on `main` too (#419).
  const HOST = baseWorld().checkouts[1];
  const holding = (path, commonDir, remote) => ({ path, branch: BRANCH, kind: "clone", commonDir, remote });
  const HOLOFORGE = holding("C:\\Users\\Kuya\\code\\holoforge", "C:\\Users\\Kuya\\code\\holoforge\\.git", "git@github.com:Pootytxng/holoforge.git");
  const SISTER = holding("C:\\Users\\Kuya\\code\\sister-site", "C:\\Users\\Kuya\\code\\sister-site\\.git", "https://github.com/Pootytxng/sister-site.git");
  const SCRATCH = holding("C:\\Users\\Kuya\\scratch", "C:\\Users\\Kuya\\scratch\\.git", null);
  const absent = (checkouts, overrides = {}) => baseWorld({ checkouts, gitState: null, ...overrides });

  it("another project on the same branch does not block the task's folder", () => {
    const w = baseWorld();
    w.checkouts = [...w.checkouts, HOLOFORGE];
    const r = reconcile(w);
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(true);
    expect(c.note).toBe(`also on ${BRANCH} in another repository, so not a conflict: ${HOLOFORGE.path}`);
    expect(r.verdict).toBe("PASS");
  });

  it("nor does it stop the folder being created", () => {
    const r = reconcile(absent([HOST, SISTER]));
    expect(check(r, "git.branchElsewhere").ok).toBe(true);
    expect(check(r, "folder.exists").actual).toBe("absent (creatable)");
    expect(r.actions).toContain("create-worktree");
    expect(r.verdict).toBe("PASS");
  });

  it("a separate clone of this repository still refuses, however its origin is spelled", () => {
    // The host's origin is ssh; this clone's is https without `.git`. Both name github.com/pootytxng/sentinel.
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-work-control-codex", "C:\\Users\\Kuya\\code\\sentinel-work-control-codex\\.git", "https://github.com/Pootytxng/sentinel");
    const r = reconcile(absent([HOST, SISTER, clone]));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}`);
    // Git keeps a separate clone's branches apart, so the refusal is this project's rule, not Git's.
    expect(c.remediation).toMatch(PROJECT_RULE);
    expect(c.remediation).not.toMatch(/Git would refuse/);
    expect(r.actions).not.toContain("create-worktree");
    expect(r.verdict).toBe("REFUSE");
  });

  it("a worktree of this repository refuses, and there Git would refuse too", () => {
    const lane = { path: "C:\\Users\\Kuya\\code\\sentinel-rel091", branch: BRANCH, kind: "linked", commonDir: HOST.commonDir, remote: HOST.remote };
    const c = check(reconcile(absent([HOST, lane])), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${lane.path}`);
    expect(c.remediation).toBe("Git would refuse this too, but later and less legibly.");
  });

  it("says Git would refuse only when the holder shares the common dir of the task's folder", () => {
    // The task's folder is a separate clone and a worktree of the host holds the branch. Git in the
    // clone cannot see that worktree, so the refusal is this project's rule alone.
    const folder = { path: FOLDER, branch: BRANCH, kind: "clone", commonDir: `${FOLDER}\\.git`, remote: "https://github.com/Pootytxng/sentinel.git" };
    const lane = { path: "C:\\Users\\Kuya\\code\\sentinel-rel091", branch: BRANCH, kind: "linked", commonDir: HOST.commonDir, remote: HOST.remote };
    const c = check(reconcile(baseWorld({ checkouts: [folder, HOST, lane] })), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${lane.path}`);
    expect(c.remediation).toMatch(PROJECT_RULE);
  });

  it("does not say what Git would do when the holder's common dir is unknown", () => {
    // Matched by origin alone: the project's rule still refuses, but whether the holder shares the
    // task folder's common dir, and so whether Git would refuse, cannot be told.
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-clone", null, HOST.remote);
    const c = check(reconcile(absent([HOST, clone])), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}`);
    expect(c.remediation).toMatch(/^This project refuses it: .*Whether Git would too is not known/);
    expect(c.remediation).not.toMatch(/Git would refuse|Git itself would not/);
  });

  it("the same owner and name on another host is another repository (a GitLab mirror)", () => {
    const mirror = holding("C:\\Users\\Kuya\\code\\sentinel-gitlab", "C:\\Users\\Kuya\\code\\sentinel-gitlab\\.git", "https://gitlab.com/Pootytxng/sentinel.git");
    const r = reconcile(absent([HOST, mirror]));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(true);
    expect(c.note).toBe(`also on ${BRANCH} in another repository, so not a conflict: ${mirror.path}`);
    expect(r.actions).toContain("create-worktree");
    expect(r.verdict).toBe("PASS");
  });

  it.each([
    ["scp-style ssh", "git@github.com:Pootytxng/sentinel.git"],
    ["ssh://", "ssh://git@github.com/Pootytxng/sentinel.git"],
    ["ssh on port 443", "ssh://git@ssh.github.com:443/Pootytxng/sentinel.git"],
    ["git+ssh:// without .git", "git+ssh://git@github.com/Pootytxng/sentinel"],
    ["https with a user, capitals and a trailing slash", "https://ci-bot@GitHub.com/POOTYTXNG/Sentinel.git/"],
    ["scp-style with a host in capitals and a trailing dot", "git@GitHub.COM.:Pootytxng/sentinel.git"],
  ])("a clone of this repository spelled as %s is the same host and path, so it refuses", (_, remote) => {
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-clone", "C:\\Users\\Kuya\\code\\sentinel-clone\\.git", remote);
    const c = check(reconcile(absent([HOST, clone])), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}`);
    expect(c.remediation).toMatch(PROJECT_RULE);
  });

  it.each([
    ["a Windows path", "C:\\Users\\Kuya\\code\\sentinel"],
    ["a file:// URL", "file:///C:/Users/Kuya/code/sentinel.git"],
    ["a file:// URL on a network share", "file://nas/git/sentinel.git"],
    ["a relative path", "../sentinel.git"],
    ["an scp-style address whose host has a space in it", "git@build server:Pootytxng/holoforge.git"],
  ])("an origin that is %s names no host, so the clone stays locked", (_, remote) => {
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-local", "C:\\Users\\Kuya\\code\\sentinel-local\\.git", remote);
    const c = check(reconcile(absent([HOST, clone])), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}, a checkout whose repository could not be told apart from this one`);
    expect(c.remediation).toMatch(/hosted origin on both sides to compare.*unknown identity stays locked/);
  });

  it.each([
    ["a bare alias", "git@github-work:Pootytxng/sentinel.git"],
    ["an alias dressed as a domain", "git@github.com-work:Pootytxng/sentinel.git"],
  ])("this repository's path behind %s may be this host under another name, so it stays locked", (_, remote) => {
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-work", "C:\\Users\\Kuya\\code\\sentinel-work\\.git", remote);
    const c = check(reconcile(absent([HOST, clone])), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}, a checkout whose repository could not be told apart from this one`);
    expect(c.remediation).toMatch(/SSH config alias.*unknown identity stays locked/);
  });

  // OpenSSH's `Host work.example.com` with `HostName github.com` is valid, so over SSH even a DNS name
  // may be an alias. Only a DNS name reached without SSH says which server it is.
  it.each([
    ["scp-style", "git@work.example.com:Pootytxng/sentinel.git"],
    ["ssh://", "ssh://git@work.example.com/Pootytxng/sentinel.git"],
    ["git+ssh:// on another port", "git+ssh://git@work.example.com:2222/Pootytxng/sentinel"],
  ])("this repository's path over %s to a DNS-shaped host may be an SSH config alias, so it stays locked", (_, remote) => {
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-work", "C:\\Users\\Kuya\\code\\sentinel-work\\.git", remote);
    const r = reconcile(absent([HOST, clone]));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}, a checkout whose repository could not be told apart from this one`);
    expect(c.remediation).toMatch(/SSH config alias.*unknown identity stays locked/);
    expect(r.verdict).toBe("REFUSE");
  });

  it("a clone at this repository's own address is this repository, even when this checkout reaches it through an SSH alias", () => {
    const aliased = { ...HOST, remote: "git@gh.example.com:Pootytxng/sentinel.git" };
    const clone = holding("C:\\Users\\Kuya\\code\\sentinel-clone", "C:\\Users\\Kuya\\code\\sentinel-clone\\.git", "https://github.com/Pootytxng/sentinel.git");
    const c = check(reconcile(absent([aliased, clone])), "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${clone.path}`);
    expect(c.remediation).toMatch(PROJECT_RULE);
  });

  it("a mirror on another host reached without SSH is another repository, even when this checkout's origin is an SSH alias", () => {
    const aliased = { ...HOST, remote: "git@github-work:Pootytxng/sentinel.git" };
    const mirror = holding("C:\\Users\\Kuya\\code\\sentinel-gitlab", "C:\\Users\\Kuya\\code\\sentinel-gitlab\\.git", "https://gitlab.com/Pootytxng/sentinel.git");
    const r = reconcile(absent([aliased, mirror]));
    expect(check(r, "git.branchElsewhere").ok).toBe(true);
    expect(r.verdict).toBe("PASS");
  });

  it("another path behind an SSH alias is still another repository", () => {
    const other = holding("C:\\Users\\Kuya\\code\\holoforge-work", "C:\\Users\\Kuya\\code\\holoforge-work\\.git", "git@github-work:Pootytxng/holoforge.git");
    const r = reconcile(absent([HOST, other]));
    expect(check(r, "git.branchElsewhere").ok).toBe(true);
    expect(r.verdict).toBe("PASS");
  });

  it("a holder whose common dir is unknown stays locked, even when its origin names another project", () => {
    // Setting a checkout aside needs its common dir as well as its origin, so holoforge with its
    // common dir unknown still refuses.
    const other = { ...HOLOFORGE, commonDir: null };
    const r = reconcile(absent([HOST, other]));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${other.path}, a checkout whose repository could not be told apart from this one`);
    expect(c.remediation).toMatch(/unknown identity stays locked/);
    expect(r.verdict).toBe("REFUSE");
  });

  it("a checkout with no origin cannot be told apart, so it stays locked and says why", () => {
    const r = reconcile(absent([HOST, SCRATCH]));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`${BRANCH} is checked out in ${SCRATCH.path}, a checkout whose repository could not be told apart from this one`);
    expect(c.remediation).toMatch(/unknown identity stays locked/);
    expect(r.verdict).toBe("REFUSE");
  });

  it("this repository without an origin cannot rule another project out either", () => {
    const r = reconcile(absent([{ ...HOST, remote: null }, HOLOFORGE]));
    expect(check(r, "git.branchElsewhere").ok).toBe(false);
    expect(check(r, "git.branchElsewhere").actual).toMatch(/holoforge, a checkout whose repository could not be told apart/);
    expect(r.verdict).toBe("REFUSE");
  });

  it("with no expected repository and no folder to read one from, every holder stays locked", () => {
    const r = reconcile(absent([HOLOFORGE], { expectedCommonDir: null }));
    expect(check(r, "git.branchElsewhere").ok).toBe(false);
    expect(check(r, "git.branchElsewhere").actual).toMatch(/holoforge, a checkout whose repository could not be told apart/);
    expect(r.verdict).toBe("REFUSE");
  });

  it("a definite conflict is named before an unidentified one, whatever the discovery order", () => {
    const lane = { path: "C:\\Users\\Kuya\\code\\sentinel-rel091", branch: BRANCH, kind: "linked", commonDir: HOST.commonDir, remote: HOST.remote };
    const r = reconcile(absent([HOST, SCRATCH, SISTER, lane]));
    expect(check(r, "git.branchElsewhere").actual).toBe(`${BRANCH} is checked out in ${lane.path}`);
    expect(check(r, "git.branchElsewhere").note).toBe(`also on ${BRANCH} in another repository, so not a conflict: ${SISTER.path}`);
  });
});

describe("git.branchElsewhere on real repositories — git discovers, reconcile() decides (#421)", () => {
  // The same cases over the checkouts discoverCheckouts finds on disk: a host with a linked worktree,
  // a separate clone of its remote, a mirror whose origin names the same owner and name on GitLab, a
  // clone whose origin is a local path, two other projects beside them, and a repository with no
  // origin in a second root. Only the fixture runs git; reconcile() stays pure over what discovery
  // reported.
  const git = (cwd, ...args) =>
    execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@test", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let root;
  let code;
  let inCode;
  let inBoth;
  let hostCommonDir;
  const found = (name) => inBoth.find((c) => basename(c.path) === name);

  // The launch as gather.mjs assembles it, over what discovery found.
  const launch = (folder, branch, checkouts, expectedCommonDir) => {
    const w = baseWorld();
    const field = `${folder} @ ${branch}`;
    const settings = join(folder, ".claude", "settings.json");
    return {
      ...w,
      task: { ...w.task, worktreeBranch: field },
      items: [{ number: 18, status: "Active", lane: "Claude Code", worktreeBranch: field }],
      claim: { ...w.claim, folder, branch },
      checkouts,
      gitState: checkouts.some((c) => samePath(c.path, folder)) ? { ...w.gitState, branch } : null,
      expectedCommonDir,
      window: { ...w.window, effective: { ...w.window.effective, file: settings } },
      subagentModel: { ...w.subagentModel, source: settings },
    };
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "compy-entry-branch-identity-"));
    code = join(root, "code");
    const extra = join(root, "extra");
    mkdirSync(code);
    mkdirSync(extra);
    const repo = (dir, branch) => {
      git(root, "init", "-q", "-b", branch, dir);
      writeFileSync(join(dir, "README.md"), "fixture\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "fixture");
    };

    // This repository: a host with a linked worktree, and a separate clone of the same remote.
    const bare = join(root, "sentinel.git");
    git(root, "init", "-q", "--bare", "-b", "main", bare);
    const host = join(code, "sentinel");
    repo(host, "main");
    git(host, "remote", "add", "origin", bare);
    git(host, "push", "-q", "-u", "origin", "main");
    git(host, "worktree", "add", "-b", "feat/lane", join(code, "sentinel-lane"));
    const clone = join(code, "sentinel-clone");
    git(root, "clone", "-q", bare, clone);
    git(clone, "switch", "-q", "-c", "feat/clone-lane");
    // One GitHub repository, spelled the two ways its https and ssh remotes are.
    git(host, "remote", "set-url", "origin", "https://github.com/Pootytxng/sentinel.git");
    git(clone, "remote", "set-url", "origin", "git@github.com:Pootytxng/sentinel.git");
    // The same history mirrored to GitLab under the same owner and name: another repository.
    const mirror = join(code, "sentinel-gitlab");
    git(root, "clone", "-q", bare, mirror);
    git(mirror, "switch", "-q", "-c", "feat/mirror-lane");
    git(mirror, "remote", "set-url", "origin", "https://gitlab.com/Pootytxng/sentinel.git");
    // The same history cloned from its local path, which names no host to compare.
    const local = join(code, "sentinel-local");
    git(root, "clone", "-q", bare, local);
    git(local, "switch", "-q", "-c", "feat/local-lane");

    // Other projects beside it, as on the real machine, and one repository nothing can identify.
    repo(join(code, "holoforge"), "main");
    git(join(code, "holoforge"), "remote", "add", "origin", "git@github.com:Pootytxng/holoforge.git");
    repo(join(code, "sister-site"), "release/next");
    git(join(code, "sister-site"), "remote", "add", "origin", "https://github.com/Pootytxng/sister-site.git");
    repo(join(extra, "scratch"), "release/next");

    inCode = discoverCheckouts({ roots: [code] });
    inBoth = discoverCheckouts({ roots: [code, extra] });
    hostCommonDir = inCode.find((c) => c.kind === "host").commonDir;
  }, GIT_SPAWN_TIMEOUT_MS);

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  });

  it("another project on main does not block Sentinel's host on main (the #419 launch)", () => {
    const r = reconcile(launch(found("sentinel").path, "main", inCode, hostCommonDir));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(true);
    expect(c.note).toBe(`also on main in another repository, so not a conflict: ${found("holoforge").path}`);
    expect(r.verdict).toBe("PASS");
  });

  it("another project on release/next does not stop a new lane on release/next being created", () => {
    const r = reconcile(launch(join(code, "sentinel-next"), "release/next", inCode, hostCommonDir));
    expect(check(r, "git.branchElsewhere").ok).toBe(true);
    expect(check(r, "folder.exists").actual).toBe("absent (creatable)");
    expect(r.actions).toContain("create-worktree");
    expect(r.verdict).toBe("PASS");
  });

  it("a linked worktree of this repository still refuses, naming it", () => {
    const r = reconcile(launch(join(code, "sentinel-next"), "feat/lane", inCode, hostCommonDir));
    expect(check(r, "git.branchElsewhere").ok).toBe(false);
    expect(check(r, "git.branchElsewhere").actual).toBe(`feat/lane is checked out in ${found("sentinel-lane").path}`);
    expect(check(r, "git.branchElsewhere").remediation).toBe("Git would refuse this too, but later and less legibly.");
    expect(r.actions).not.toContain("create-worktree");
    expect(r.verdict).toBe("REFUSE");
  });

  it("a separate clone of this repository, its origin over ssh where the host's is https, still refuses", () => {
    const r = reconcile(launch(join(code, "sentinel-next"), "feat/clone-lane", inCode, hostCommonDir));
    expect(check(r, "git.branchElsewhere").ok).toBe(false);
    expect(check(r, "git.branchElsewhere").actual).toBe(`feat/clone-lane is checked out in ${found("sentinel-clone").path}`);
    expect(check(r, "git.branchElsewhere").remediation).toMatch(PROJECT_RULE);
    expect(check(r, "git.branchElsewhere").remediation).not.toMatch(/Git would refuse/);
    expect(r.verdict).toBe("REFUSE");
  });

  it("a mirror under the same owner and name on GitLab does not block a lane on its branch", () => {
    const r = reconcile(launch(join(code, "sentinel-next"), "feat/mirror-lane", inCode, hostCommonDir));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(true);
    expect(c.note).toBe(`also on feat/mirror-lane in another repository, so not a conflict: ${found("sentinel-gitlab").path}`);
    expect(r.actions).toContain("create-worktree");
    expect(r.verdict).toBe("PASS");
  });

  it("a clone whose origin is a local path names no host, so it stays locked, and it is the one named", () => {
    // Discovery reports the bare repository's own path as the origin.
    expect(samePath(found("sentinel-local").remote, join(root, "sentinel.git"))).toBe(true);
    const r = reconcile(launch(join(code, "sentinel-next"), "feat/local-lane", inCode, hostCommonDir));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`feat/local-lane is checked out in ${found("sentinel-local").path}, a checkout whose repository could not be told apart from this one`);
    expect(r.actions).not.toContain("create-worktree");
    expect(r.verdict).toBe("REFUSE");
  });

  it("a repository with no origin stays locked, and it is the one named", () => {
    const r = reconcile(launch(join(code, "sentinel-next"), "release/next", inBoth, hostCommonDir));
    const c = check(r, "git.branchElsewhere");
    expect(c.ok).toBe(false);
    expect(c.actual).toBe(`release/next is checked out in ${found("scratch").path}, a checkout whose repository could not be told apart from this one`);
    expect(c.note).toBe(`also on release/next in another repository, so not a conflict: ${found("sister-site").path}`);
    expect(r.verdict).toBe("REFUSE");
  });

  it("with no expected repository and no folder to read one from, another project stays locked", () => {
    const r = reconcile(launch(join(code, "sentinel-next"), "release/next", inCode, null));
    expect(check(r, "git.branchElsewhere").ok).toBe(false);
    expect(check(r, "git.branchElsewhere").actual).toBe(`release/next is checked out in ${found("sister-site").path}, a checkout whose repository could not be told apart from this one`);
    expect(r.verdict).toBe("REFUSE");
  });
});

describe("selectTask", () => {
  // Rewritten 2026-07-30 (owner addendum on #18), narrowed 2026-07-31 (#23). It once asserted that
  // one Ready task selects itself — exactly how the shortcut skipped Kuya's own Active #18 and
  // silently launched #13. Now: READY work is only ever a choice, and a task that is already OURS,
  // Active and claimed resumes with no question. Re-pinned 2026-09-05 (#369 / PR #375, dynamic
  // mutation leases): a row's Lane label is informational and reserves nothing; only a live lease
  // held by another executor blocks. Menu shape and reasons live in select.test.mjs.
  const items = [
    { number: 13, status: "Ready", lane: "Codex", gate: "None" },
    { number: 14, status: "Needs Kuya", lane: "Kuya", gate: "Kuya" },
    { number: 17, status: "Review", lane: "Codex", gate: "None" },
  ];

  it("no startable task → says so, and never invents work", () => {
    const r = selectTask([{ number: 14, status: "Needs Kuya", gate: "Kuya" }], {});
    expect(r.kind).toBe("none");
    expect(r.reason).toMatch(/nothing is available|no .*ready/i);
  });

  it("several Ready tasks → a numbered choice; a Codex Lane label does not reserve #13", () => {
    // Dynamic mutation leases (#369 / PR #375): Lane is informational. Ready #13 labelled Codex is
    // offered like any other Ready row; only a live lease held by another executor reserves it.
    const r = selectTask([...items, { number: 19, status: "Ready", lane: "Claude Code", gate: "None" }], {});
    expect(r.kind).toBe("choice");
    expect(r.options.map((o) => o.number)).toEqual([13, 19]);
    expect(r.unavailable.map((o) => o.number)).not.toContain(13);
    expect(r.task).toBeUndefined();

    const codexHolds13 = items.map((i) => (i.number === 13 ? { ...i, status: "Active", claimExpires: "2026-07-31" } : i));
    const held = selectTask([...codexHolds13, { number: 19, status: "Ready", lane: "Claude Code", gate: "None" }], {
      self: { lane: "Claude Code" },
      now: new Date("2026-07-30T23:30:00Z"),
    });
    expect(held.options.map((o) => o.number)).toEqual([19]);
    expect(held.unavailable.find((o) => o.number === 13).reason).toMatch(/Codex executor currently holds its mutation lease/);
  });

  it("Ready work with no live lease of ours → still a choice: the shortcut asks, it does not pick", () => {
    const r = selectTask([...items, { number: 19, status: "Ready", lane: "Claude Code", gate: "None" }], { self: { lane: "Claude Code" } });
    expect(r.kind).toBe("choice");
    expect(r.task).toBeUndefined();
    expect(r.options.map((o) => o.number)).toEqual([13, 19]);
    // Even a single Ready row is offered, never started.
    const single = selectTask([{ number: 19, status: "Ready", lane: "Claude Code", gate: "None" }], { self: { lane: "Claude Code" } });
    expect(single.kind).toBe("choice");
    expect(single.options.map((o) => o.number)).toEqual([19]);
  });

  it("our own unexpired Active resumes itself — the claim on the board IS the decision", () => {
    const withMine = [...items, { number: 18, status: "Active", lane: "Claude Code", gate: "None", claimExpires: "2026-07-31" }];
    const r = selectTask(withMine, { self: { lane: "Claude Code" }, now: new Date("2026-07-30T23:30:00Z") });
    expect(r.kind).toBe("task");
    expect(r.auto).toBe(true);
    expect(r.task.number).toBe(18);
  });

  it("an explicit issue is honoured even when unstartable, so the CHECKS explain why", () => {
    // Pointing the entrypoint at #14 must produce a reasoned refusal, not "no task found".
    const r = selectTask(items, { issue: 14 });
    expect(r.kind).toBe("task");
    expect(r.task.number).toBe(14);
  });

  it("an explicit issue that is not on the board → refuse", () => {
    expect(selectTask(items, { issue: 99 }).kind).toBe("none");
  });
});

// ── #648: the continuing holder ──────────────────────────────────────────────────────────────────
//
// `reconcile` asks whether a session may BEGIN in a folder, and a working holder fails it twice over:
// its alarm may have passed, and a folder being worked in is never clean. On #552 that left the one
// session allowed to write there with no way to renew. The holder path asks a different question:
// is this the same executor and the same live session, in the same folder, on the same branch, with
// the same scope. It is asked beside `reconcile`, never instead of it.

const SESSION = "5f0c2a9e-1111-4222-8333-000000000648";
const ELSEWHERE = "C:\\Users\\Kuya\\code\\sentinel-rel";
const LEASE = { issue: 18, lane: "Claude Code", executor: "Claude Code", folder: FOLDER, branch: BRANCH, scope: "`tools/entry/`", expires: "2026-07-31", postedAt: "2026-07-30T08:00:00Z" };
const RECORD = { sessionId: SESSION, issue: 18, folder: FOLDER, branch: BRANCH, pid: 4242 };
// What a renewing command measures about itself. None of it is handed to the command: it is read from
// the machine. Its own process chain runs from the command (first) to the session program (last), the
// native session list has one entry for that one process, and a by-process reading names what is
// running by process id and creation instant, each process judged by the stock classifier.
const OTHER_ID = "9a9a9a9a-0000-4000-8000-000000000000";
const CLI = "C:\\Users\\Kuya\\.local\\bin\\claude.exe";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const LAUNCHER = { pid: 4120, parentPid: 3980, created: "2026-07-30T09:00:03.5000000Z", name: "node.exe", executable: NODE };
const COMMAND = { pid: 3980, parentPid: 3100, created: "2026-07-30T09:00:03.1000000Z", name: "node.exe", executable: NODE };
const SHELL = { pid: 3100, parentPid: 2000, created: "2026-07-30T08:40:00.0000000Z", name: "bash.exe", executable: "C:\\Program Files\\Git\\bin\\bash.exe" };
const PROGRAM = { pid: 2000, parentPid: 992, created: "2026-07-30T08:00:00.1630000Z", name: "claude.exe", executable: CLI };
const CHAIN = [LAUNCHER, COMMAND, SHELL, PROGRAM];
const ENTRY = { pid: PROGRAM.pid, sessionId: SESSION, kind: "interactive", cwd: FOLDER, startedAt: Date.parse("2026-07-30T08:00:01.364Z") };
const AGAINST = "running against this folder";
const INSTALLING = "an installer is running — installs are machine-wide";
const WORKING = "a Claude session is already working in this folder";
/** One process as the by-process reading reports it. */
const seenAs = (p, contends = false, note = null) => ({ pid: p.pid, created: p.created, name: p.name, contends, note });
// The launcher's command line names the folder it runs from, so the stock classifier counts it.
const OWN = [seenAs(LAUNCHER, true, AGAINST), seenAs(COMMAND), seenAs(PROGRAM)];
const TAKEN = "2026-07-30T09:00:04.000Z";
// `others` counts what the reading saw, judged not to contend, and left out: nothing of theirs is carried.
const CALLER = { pid: LAUNCHER.pid, cli: CLI, chain: { ok: true, rows: CHAIN }, sessions: { ok: true, entries: [ENTRY] }, snapshot: { ok: true, takenAt: TAKEN, rows: OWN, others: 0 } };
// Where the folder's record was read. It is shown in a refusal, and it is never what admits.
const NATIVE_ROOT = { path: FOLDER, source: "native session list" };
const GUESSED_ROOT = { path: FOLDER, source: "git toplevel of the working directory" };
// What the first candidate admitted on: a root named by an environment setting, and called observed.
const SET_BY_HAND = { path: FOLDER, source: "CLAUDE_PROJECT_DIR", observed: true };
const HOLDER = { sessionId: SESSION, caller: CALLER, root: NATIVE_ROOT, record: RECORD, recordState: "ok", liveness: "live", sweeper: "node.exe" };
// The stock sweep groups by name and carries no process id. It counts the launcher, and cannot say whose it is.
const SWEEP = [{ name: "node.exe", count: 2, contends: true, note: AGAINST, samples: [] }];
const QUIET = [{ name: "node.exe", count: 2, contends: false, note: null, samples: [] }];
// The three kinds of contender, exactly as `classifyProcesses` reports them.
const BUILD = { name: "cargo.exe", count: 1, contends: true, note: AGAINST, samples: [] };
const INSTALLER = { name: "msiexec.exe", count: 1, contends: true, note: INSTALLING, samples: [] };
const OTHER_SESSION = { name: "claude.exe", count: 1, contends: true, note: WORKING, samples: [] };
// Processes that are not this command's own, however close to it they stand.
const FOREIGN_BUILD = { pid: 7001, parentPid: 6000, created: "2026-07-30T08:59:00.0000000Z", name: "cargo.exe" };
const FOREIGN_SESSION = { pid: 7100, parentPid: 992, created: "2026-07-30T08:30:00.0000000Z", name: "claude.exe" };
const SIBLING = { pid: 5150, parentPid: SHELL.pid, created: "2026-07-30T09:00:02.0000000Z", name: "node.exe" };
const DESCENDANT = { pid: 4200, parentPid: LAUNCHER.pid, created: "2026-07-30T09:00:03.9000000Z", name: "node.exe" };
const HELPER = { pid: 2600, parentPid: PROGRAM.pid, created: "2026-07-30T08:00:05.0000000Z", name: "node.exe" };
const UNRELATED = { pid: 9100, parentPid: 4, created: "2026-07-29T22:00:00.0000000Z", name: "node.exe" };
const SETUP = { pid: 8800, parentPid: 700, created: "2026-07-30T08:58:00.0000000Z", name: "msiexec.exe" };
// An installer standing where the shell stands: on the command's own chain, by id and creation instant.
const SETUP_HOP = { ...SHELL, name: "CompySetup.exe", executable: "C:\\Users\\Kuya\\Downloads\\CompySetup.exe" };
/** A reading that also says who started a process. Kinship is there to be read, and never sets one aside. */
const kin = (p, contends = true, note = AGAINST) => ({ ...seenAs(p, contends, note), parentPid: p.parentPid });
// An installer's name and standing, laid over a row to build a reading that contradicts the chain or
// itself. These are fixtures: no such reading was taken from a machine.
const AS_INSTALLER = { name: "msiexec.exe", contends: true, note: "installer" };
const LATER = "2026-07-30T09:00:03.8000000Z";
const ONCE = "named more than once, where one reading names a process once";
const NOT_NAMED = "not the program the chain names for that process";
const SHOWS_ONE = "an installer is never set aside, and the reading shows one";
const LISTS_ONE = "an installer is never set aside, and the sweep lists one";
/** One sweep entry judged quiet. Under an installer's name it is built: the stock classifier never calls one quiet. */
const calledQuiet = (name, count = 1) => ({ name, count, contends: false, note: null, samples: [] });
// One cause, three rows: with no measured caller there is no root and no chain to set aside.
const UNWITNESSED = ["holder.caller", "holder.folder", "processes"];
const MEASURED_ROWS = ["holder.caller", "holder.folder", "processes"];

const holderWorld = (overrides = {}) => baseWorld({ claim: LEASE, holder: HOLDER, processes: SWEEP, ...overrides });
const leaseWith = (patch) => holderWorld({ claim: { ...LEASE, ...patch } });
const holderWith = (patch) => holderWorld({ holder: { ...HOLDER, ...patch } });
const recordWith = (patch) => holderWith({ record: { ...RECORD, ...patch } });
const callerWith = (patch) => holderWith({ caller: { ...CALLER, ...patch } });
const chainWith = (rows) => callerWith({ chain: { ok: true, rows } });
const listWith = (entries) => callerWith({ sessions: { ok: true, entries } });
const readingWith = (rows, patch = {}) => callerWith({ snapshot: { ok: true, takenAt: TAKEN, rows, others: 0, ...patch } });
/** Whole in every link and only too long: more shells between the command and its session than are ever read. */
const longChain = () => {
  const n = preflight.CALLER_MAX_HOPS;
  const shells = Array.from({ length: n }, (_, i) => ({ ...SHELL, pid: 3980 - i, parentPid: i === n - 1 ? PROGRAM.pid : 3979 - i, created: new Date(Date.parse("2026-07-30T08:50:00Z") - i * 1000).toISOString() }));
  return [LAUNCHER, ...shells, PROGRAM];
};
const taskWith = (patch) => holderWorld({ task: { ...baseWorld().task, ...patch } });
const scopeWith = (patch) => holderWorld({ scope: { ...baseWorld().scope, ...patch } });
/** A git state with these paths dirty, counted the way `inspectGitState` counts them. */
function gitWith(files = {}, extra = {}) {
  const all = { modified: [], untracked: [], staged: [], unmerged: [], ...files };
  return {
    ...baseWorld().gitState,
    clean: false,
    workingTreeClean: false,
    modified: all.modified.length,
    untracked: all.untracked.length,
    staged: all.staged.length,
    unmerged: all.unmerged.length,
    files: all,
    ...extra,
  };
}
const failing = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name);

describe("#648: a working lease holder renews through its own path", () => {
  it("admits a clean holder whose alarm has passed, and says so instead of hiding it", () => {
    const r = preflight.reconcileHolder(holderWorld({ now: new Date("2026-08-02T12:00:00Z") }));
    expect(failing(r)).toEqual([]);
    expect(r.verdict).toBe("PASS");
    expect(check(r, "task.claim").actual).toContain("alarm passed 2026-07-31");
    // Renewing is not taking over, and it creates nothing.
    expect(r.takeoverDraft).toBeNull();
    expect(r.actions).toEqual([]);
    expect(r.remediation).toEqual([]);
  });

  it("admits a dirty holder with a current lease, listing every dirty path it measured", () => {
    const dirty = { modified: ["tools/entry/preflight.mjs"], staged: ["tools/entry/cli.mjs"], untracked: ["tools/entry/renew-cli.test.mjs"] };
    const r = preflight.reconcileHolder(holderWorld({ gitState: gitWith(dirty, { ahead: 2, behind: 1, stashedElsewhere: 3 }) }));
    expect(failing(r)).toEqual([]);
    const row = check(r, "git.withinLease");
    for (const path of Object.values(dirty).flat()) expect(row.actual).toContain(path);
    // Honest, not hidden: divergence and the shared stash stack are disclosed in the row itself.
    expect(row.actual).toContain("ahead 2, behind 1");
    expect(row.actual).toContain("3 stashed on other branches");
    expect(check(r, "task.claim").actual).toBe("held by this executor until 2026-07-31");
    // The fresh-entry row is replaced, not passed: nothing here reads as "the folder was clean".
    expect(check(r, "git.clean")).toBeUndefined();
  });

  it("refuses one dirty path outside the lease, and names it beside the ones inside", () => {
    const r = preflight.reconcileHolder(holderWorld({ gitState: gitWith({ modified: ["tools/entry/preflight.mjs"], untracked: ["docs/BACKLOG.md"] }) }));
    expect(r.verdict).toBe("REFUSE");
    expect(failing(r)).toEqual(["git.withinLease"]);
    const row = check(r, "git.withinLease");
    expect(row.actual).toContain("outside the lease scope: docs/BACKLOG.md");
    expect(row.actual).toContain("tools/entry/preflight.mjs");
    expect(row.remediation).toBeTruthy();
  });

  it("with no path in the lease, any dirty path is outside it", () => {
    const world = (gitState) => holderWorld({ claim: { ...LEASE, scope: "not declared at launch" }, scope: { ...baseWorld().scope, mine: [], text: "not declared at launch" }, gitState });
    expect(preflight.reconcileHolder(world(baseWorld().gitState)).verdict).toBe("PASS");
    expect(failing(preflight.reconcileHolder(world(gitWith({ modified: ["tools/entry/cli.mjs"] }))))).toEqual(["git.withinLease"]);
  });

  // Each row is one cause on its own, so a refusal names what is wrong and not merely that something is.
  const refusals = [
    ["another executor's lease", () => leaseWith({ lane: "Codex", executor: "Codex" }), ["task.claim"]],
    ["the same lane under another executor, because a lane name alone never admits", () => leaseWith({ executor: "Codex" }), ["task.claim"]],
    ["a lease that records no executor", () => leaseWith({ executor: null }), ["task.claim"]],
    ["an executor that does not say who it is", () => holderWorld({ self: { lane: "" } }), ["task.claim"]],
    ["a lease on another issue", () => leaseWith({ issue: 19 }), ["task.claim"]],
    ["a released lease", () => holderWorld({ claim: null }), ["task.claim", "holder.folder", "holder.branch", "scope.unchanged"]],
    ["a session that gives no id", () => holderWith({ sessionId: null }), ["holder.session", ...UNWITNESSED], /handed no session id/],
    ["a folder with no native session record", () => holderWith({ record: null, recordState: "absent", liveness: "none" }), ["holder.session", "holder.folder", "holder.branch"]],
    ["an unreadable session record", () => holderWith({ record: null, recordState: "corrupt", liveness: "none" }), ["holder.session", "holder.folder", "holder.branch"]],
    ["a record that names another session", () => recordWith({ sessionId: OTHER_ID }), ["holder.session"]],
    ["a record on another issue", () => recordWith({ issue: 19 }), ["holder.session"]],
    ["a session whose liveness is unknown", () => holderWith({ liveness: "unknown" }), ["holder.session"]],
    ["a session measured dead", () => holderWith({ liveness: "dead" }), ["holder.session"]],
    ["a session with no liveness reading", () => holderWith({ liveness: "none" }), ["holder.session"]],
    ["no holder observation at all", () => holderWorld({ holder: undefined }), ["holder.session", "holder.caller", "holder.folder", "holder.branch", "processes"], /nothing was measured/],

    // The command: who is asking. A word about itself, a session id or a root it was handed establish nothing.
    ["a caller nobody measured", () => holderWith({ caller: undefined }), UNWITNESSED, /nothing was measured/],
    ["a caller that is explicitly unverified, beside a root set by hand", () => holderWith({ caller: { verified: false, pid: null }, root: SET_BY_HAND }), UNWITNESSED, /process id was not measured/],
    ["a caller that only says it is verified", () => holderWith({ caller: { verified: true, pid: LAUNCHER.pid }, root: SET_BY_HAND }), UNWITNESSED, /chain could not be read/],
    ["a live session id borrowed by a command nobody measured, with its root set by hand", () => holderWith({ caller: undefined, root: SET_BY_HAND }), UNWITNESSED, /nothing was measured/],
    ["a root this command only worked out from where it stands", () => holderWith({ caller: { ...CALLER, chain: { ok: false, rows: [] } }, root: GUESSED_ROOT }), UNWITNESSED, /chain could not be read/],
    ["a command that did not measure its own process id", () => callerWith({ pid: null }), UNWITNESSED, /process id was not measured/],
    ["a process id that is a word", () => callerWith({ pid: "4120" }), UNWITNESSED, /process id was not measured/],

    // Its process chain, read from the machine: whole, unbroken, in order, and ending at the native session program.
    ["a process chain that could not be read", () => callerWith({ chain: { ok: false, rows: CHAIN } }), UNWITNESSED, /chain could not be read/],
    ["a process chain that only says what it holds", () => callerWith({ chain: { rows: CHAIN } }), UNWITNESSED, /chain could not be read/],
    ["a process chain that came back empty", () => chainWith([]), UNWITNESSED, /chain could not be read/],
    ["a process chain that is not a list", () => chainWith("claude.exe"), UNWITNESSED, /chain could not be read/],
    ["a chain that starts at some other process", () => chainWith([COMMAND, SHELL, PROGRAM]), UNWITNESSED, /starts at process 3980, not at the command \(4120\)/],
    ["a chain with a missing link", () => chainWith([LAUNCHER, SHELL, PROGRAM]), UNWITNESSED, /chain breaks/],
    ["a chain with a hop nobody read", () => chainWith([LAUNCHER, null, SHELL, PROGRAM]), UNWITNESSED, /not read in full/],
    ["a hop whose parent was not read", () => chainWith([LAUNCHER, { ...COMMAND, parentPid: null }, SHELL, PROGRAM]), UNWITNESSED, /not read in full/],
    ["a hop whose creation instant was not read", () => chainWith([LAUNCHER, { ...COMMAND, created: null }, SHELL, PROGRAM]), UNWITNESSED, /not read in full/],
    ["a hop whose creation instant is not an instant", () => chainWith([LAUNCHER, { ...COMMAND, created: "just now" }, SHELL, PROGRAM]), UNWITNESSED, /not read in full/],
    ["a hop with no name", () => chainWith([LAUNCHER, { ...COMMAND, name: "" }, SHELL, PROGRAM]), UNWITNESSED, /not read in full/],
    ["a chain that loops back on itself", () => chainWith([LAUNCHER, COMMAND, { ...SHELL, parentPid: LAUNCHER.pid }, { ...PROGRAM, pid: LAUNCHER.pid }]), UNWITNESSED, /names process 4120 twice/],
    ["a parent created after its child, which is a reused process id", () => chainWith([LAUNCHER, COMMAND, { ...SHELL, created: "2026-07-30T09:00:03.3000000Z" }, PROGRAM]), UNWITNESSED, /process 3100 was created after process 3980/],
    ["a session program created after the shell it is said to have started", () => chainWith([LAUNCHER, COMMAND, SHELL, { ...PROGRAM, created: "2026-07-30T08:50:00.0000000Z" }]), UNWITNESSED, /process 2000 was created after process 3100/],
    ["a chain that stops short of a session program", () => chainWith([LAUNCHER, COMMAND, SHELL]), UNWITNESSED, /reaches no session program/],
    ["a chain that ends at a program merely named like one", () => chainWith([LAUNCHER, COMMAND, SHELL, { ...PROGRAM, name: "claude-helper.exe" }]), UNWITNESSED, /reaches no session program/],
    ["a chain that runs on past the first session program", () => chainWith([LAUNCHER, COMMAND, { ...SHELL, name: "claude.exe", executable: CLI }, PROGRAM]), UNWITNESSED, /on past it/],
    ["a command that is itself the session program, where a renewal is a command run under one", () => callerWith({ pid: PROGRAM.pid, chain: { ok: true, rows: [PROGRAM] }, snapshot: { ...CALLER.snapshot, rows: [seenAs(PROGRAM)] } }), UNWITNESSED, /is itself the session program/],
    ["a chain longer than a command's ancestry is read", () => chainWith(longChain()), UNWITNESSED, /processes long/],
    ["a session program run from some other file", () => chainWith([LAUNCHER, COMMAND, SHELL, { ...PROGRAM, executable: "C:\\Users\\Kuya\\Downloads\\claude.exe" }]), UNWITNESSED, /not the native one/],
    ["a session program whose file was not read", () => chainWith([LAUNCHER, COMMAND, SHELL, { ...PROGRAM, executable: null }]), UNWITNESSED, /runs from was not read/],
    ["no native session program on the machine to compare against", () => callerWith({ cli: null }), UNWITNESSED, /no native session program/],

    // The native session list: one entry for that one process, and it is the session the command was handed.
    ["a native session list that could not be read", () => callerWith({ sessions: { ok: false, entries: [ENTRY] } }), UNWITNESSED, /session list could not be read/],
    ["a native session list nobody read", () => callerWith({ sessions: undefined }), UNWITNESSED, /session list could not be read/],
    ["a native session list that is not a list", () => listWith({ pid: PROGRAM.pid }), UNWITNESSED, /session list could not be read/],
    ["a session list with no entry for the session program", () => listWith([]), UNWITNESSED, /names no session for process 2000/],
    ["the session listed under some other process", () => listWith([{ ...ENTRY, pid: FOREIGN_SESSION.pid }]), UNWITNESSED, /names no session for process 2000/],
    ["two sessions listed for the one session program", () => listWith([ENTRY, { ...ENTRY, sessionId: OTHER_ID }]), UNWITNESSED, /names 2 sessions for process 2000/],
    ["a session program that is some other session", () => listWith([{ ...ENTRY, sessionId: OTHER_ID }]), UNWITNESSED, /process 2000 is session 9a9a9a9a, not 5f0c2a9e/],
    ["the session listed twice, once under another process", () => listWith([ENTRY, { ...ENTRY, pid: FOREIGN_SESSION.pid }]), UNWITNESSED, /names session 5f0c2a9e 2 times/],
    ["a background session", () => listWith([{ ...ENTRY, kind: "background" }]), UNWITNESSED, /not an interactive one/],
    ["a session of no stated kind", () => listWith([{ ...ENTRY, kind: undefined }]), UNWITNESSED, /not an interactive one/],
    ["a session the list gives no folder", () => listWith([{ ...ENTRY, cwd: "" }]), UNWITNESSED, /no folder/],
    ["a session with no start time", () => listWith([{ ...ENTRY, startedAt: null }]), UNWITNESSED, /no start time/],
    ["a session whose start time is a word", () => listWith([{ ...ENTRY, startedAt: "2026-07-30T08:00:01Z" }]), UNWITNESSED, /no start time/],
    ["a session that started before its own program was created, which is a reused process id", () => listWith([{ ...ENTRY, startedAt: Date.parse("2026-07-30T07:00:00Z") }]), UNWITNESSED, /started before/],

    // The folder: the native root of that session, the lease and the session record, all three.
    ["a session whose native root is another folder", () => listWith([{ ...ENTRY, cwd: ELSEWHERE }]), ["holder.folder"]],
    ["a lease that names another folder", () => leaseWith({ folder: ELSEWHERE }), ["holder.folder"]],
    ["a session record for another folder", () => recordWith({ folder: ELSEWHERE }), ["holder.folder"]],
    ["a lease that names another branch", () => leaseWith({ branch: "codex/product-quality-blueprint" }), ["holder.branch"]],
    ["a session record on another branch", () => recordWith({ branch: "codex/product-quality-blueprint" }), ["holder.branch"]],
    ["a folder on another branch", () => holderWorld({ gitState: { ...baseWorld().gitState, branch: "codex/product-quality-blueprint" } }), ["holder.branch", "git.branch"]],
    ["a widened scope", () => scopeWith({ mine: ["tools/entry", "docs"], text: "`tools/entry/` `docs/`", source: "cli" }), ["scope.unchanged"]],
    ["a narrowed scope", () => scopeWith({ mine: [], text: "", source: "cli" }), ["scope.unchanged"]],
    ["scope facts nobody gathered", () => holderWorld({ scope: null }), ["scope.unchanged", "scope.overlap"]],
    ["a Ready task", () => taskWith({ status: "Ready" }), ["task.status"]],
    ["a task in Review", () => taskWith({ status: "Review" }), ["task.status"]],
    ["an owner gate", () => taskWith({ gate: "Kuya" }), ["task.gate"]],
    ["another Active item in the folder", () => holderWorld({ items: [...baseWorld().items, { number: 20, status: "Active", lane: "Codex", worktreeBranch: `${FOLDER} @ codex/other` }] }), ["folder.writer"]],
    ["a scope another live lease covers", () => scopeWith({ others: [{ number: 13, lane: "Codex", scope: ["tools/entry/cli.mjs"] }] }), ["scope.overlap"]],
    ["unmerged paths", () => holderWorld({ gitState: gitWith({ unmerged: ["tools/entry/cli.mjs"] }) }), ["git.withinLease"]],
    ["a stash on this branch", () => holderWorld({ gitState: gitWith({}, { stashed: 1 }) }), ["git.withinLease"]],
    ["dirty paths that were counted and never listed", () => holderWorld({ gitState: { ...baseWorld().gitState, clean: false, modified: 2 } }), ["git.withinLease"]],
    ["a detached head", () => holderWorld({ gitState: gitWith({}, { detached: true, branch: null }) }), ["holder.branch", "git.branch", "git.withinLease"]],
    ["git state that could not be read", () => holderWorld({ gitState: { ok: false } }), ["holder.branch", "git.branch", "git.withinLease"]],
    // The stock sweep: it must have answered, and whatever it counts against the folder must be accounted for.
    ["a process sweep that did not answer", () => holderWorld({ processes: [] }), ["processes"], /not known to have answered/],
    ["a sweep that does not list the process that ran it", () => holderWorld({ processes: [{ name: "claude.exe", count: 1, contends: false, note: null, samples: [] }] }), ["processes"], /not known to have answered/],
    ["a sweep nobody vouches for", () => holderWith({ sweeper: null }), ["processes"], /not known to have answered/],
    ["a build the sweep counted that no process of the command's own accounts for", () => holderWorld({ processes: [...SWEEP, BUILD] }), ["processes"], /the sweep counts cargo\.exe against this folder/],
    ["an installer the sweep counted", () => holderWorld({ processes: [...SWEEP, INSTALLER] }), ["processes"], /the sweep counts msiexec\.exe against this folder/],
    ["another Claude session the sweep counted", () => holderWorld({ processes: [...SWEEP, OTHER_SESSION] }), ["processes"], /the sweep counts claude\.exe against this folder/],
    ["the sweeping program counted against the folder, when the command's own process is not what contends", () => readingWith([seenAs(LAUNCHER), seenAs(COMMAND), seenAs(PROGRAM)]), ["processes"], /the sweep counts node\.exe against this folder/],
    ["a sweep entry nobody classified", () => holderWorld({ processes: [...SWEEP, { name: "rustc.exe", count: 1, note: null, samples: [] }] }), ["processes"], /rustc\.exe ×1 \(not classified\)/],
    // An install is machine-wide in the sweep too: an installer it lists refuses, however the sweep judged it.
    ["an installer the sweep lists and called quiet", () => holderWorld({ processes: [...SWEEP, calledQuiet("msiexec.exe")] }), ["processes"], new RegExp(`${LISTS_ONE}: msiexec\\.exe ×1`)],
    ["an installer the sweep lists and called quiet, with nothing counted against the folder", () => holderWorld({ processes: [...QUIET, calledQuiet("msiexec.exe")] }), ["processes"], new RegExp(`${LISTS_ONE}: msiexec\\.exe ×1`)],
    ["an installer the sweep lists and nobody judged", () => holderWorld({ processes: [...SWEEP, { name: "msiexec.exe", count: 1, note: null, samples: [] }] }), ["processes"], new RegExp(`${LISTS_ONE}: msiexec\\.exe ×1`)],

    // The by-process reading: taken, whole, and showing the command and its session program by identity.
    ["a by-process reading that failed", () => callerWith({ snapshot: { ok: false, takenAt: null, rows: [], others: null } }), ["processes"], /by process: not read/],
    ["a by-process reading nobody took", () => callerWith({ snapshot: undefined }), ["processes"], /by process: not read/],
    ["a by-process reading that only says what it holds", () => callerWith({ snapshot: { takenAt: TAKEN, rows: OWN, others: 0 } }), ["processes"], /by process: not read/],
    ["a by-process reading that is not a list", () => readingWith("node.exe"), ["processes"], /read, but not in full/],
    ["a by-process reading with no time on it", () => readingWith(OWN, { takenAt: null }), ["processes"], /read, but not in full/],
    ["a by-process reading that does not say how much else it saw", () => readingWith(OWN, { others: undefined }), ["processes"], /read, but not in full/],
    ["a process the reading could not identify", () => readingWith([...OWN, { ...seenAs(UNRELATED, true, AGAINST), pid: null }]), ["processes"], /read, but not in full/],
    ["a process with no creation instant", () => readingWith([...OWN, { ...seenAs(UNRELATED, true, AGAINST), created: null }]), ["processes"], /read, but not in full/],
    ["a process with no name", () => readingWith([...OWN, { ...seenAs(UNRELATED, true, AGAINST), name: "" }]), ["processes"], /read, but not in full/],
    ["a process nobody classified", () => readingWith([...OWN, { pid: UNRELATED.pid, created: UNRELATED.created, name: UNRELATED.name }]), ["processes"], /read, but not in full/],
    ["a reading that came back empty", () => readingWith([]), ["processes"], /this command's own process is not in it/],
    ["a reading that does not show the command itself", () => readingWith([seenAs(COMMAND), seenAs(PROGRAM)]), ["processes"], /this command's own process is not in it/],
    ["a reading that does not show the session program, which may have ended", () => readingWith([seenAs(LAUNCHER, true, AGAINST), seenAs(COMMAND)]), ["processes"], /its session program is not in it/],
    ["the command's process id under another creation instant", () => readingWith([{ ...seenAs(LAUNCHER, true, AGAINST), created: "2026-07-30T09:00:03.9000000Z" }, seenAs(COMMAND), seenAs(PROGRAM)]), ["processes"], /process id reused since the chain was read: node\.exe 4120/],
    ["a chain process id that now belongs to another process", () => readingWith([...OWN, { ...seenAs(COMMAND), created: "2026-07-30T09:00:03.8000000Z" }]), ["processes"], /process id reused since the chain was read: node\.exe 3980/],

    // What contends and is not the command's own, however close to it: each one read by process id.
    ["another tool's build against the folder", () => readingWith([...OWN, seenAs(FOREIGN_BUILD, true, AGAINST)]), ["processes"], /not this command's own: cargo\.exe 7001 \(running against this folder\)/],
    ["another Claude session working in the folder", () => readingWith([...OWN, seenAs(FOREIGN_SESSION, true, WORKING)]), ["processes"], /not this command's own: claude\.exe 7100 \(a Claude session is already working in this folder\)/],
    ["a sibling the same shell started", () => readingWith([...OWN, kin(SIBLING)]), ["processes"], /not this command's own: node\.exe 5150/],
    ["a child of the command", () => readingWith([...OWN, kin(DESCENDANT)]), ["processes"], /not this command's own: node\.exe 4200/],
    ["a helper of the same session", () => readingWith([...OWN, kin(HELPER)]), ["processes"], /not this command's own: node\.exe 2600/],
    ["an unrelated process of the same name", () => readingWith([...OWN, seenAs(UNRELATED, true, AGAINST)]), ["processes"], /not this command's own: node\.exe 9100/],
    ["an installer, wherever it runs, which the stock sweep does not watch for", () => readingWith([...OWN, seenAs(SETUP, true, INSTALLING)]), ["processes"], /not this command's own: msiexec\.exe 8800 \(an installer is running/],
    ["a builder whose command line could not be read", () => readingWith([...OWN, seenAs(UNRELATED, null, "its command line could not be read")]), ["processes"], /not this command's own: node\.exe 9100 \(its command line could not be read\)/],

    // An install is machine-wide. Nothing sets one aside, the command's own chain included.
    ["an installer the command itself runs under", () => callerWith({ chain: { ok: true, rows: [LAUNCHER, COMMAND, SETUP_HOP, PROGRAM] }, snapshot: { ...CALLER.snapshot, rows: [...OWN, seenAs(SETUP_HOP, true, INSTALLING)] } }), ["processes"], /an installer is never set aside, and this command runs under one: CompySetup\.exe 3100/],
    ["an installer the command runs under, which the reading does not show", () => chainWith([LAUNCHER, COMMAND, SETUP_HOP, PROGRAM]), ["processes"], /an installer is never set aside, and this command runs under one: CompySetup\.exe 3100/],
    // In the reading too: whichever process it is, whoever it belongs to, and however it was judged.
    ["an installer the reading judged quiet", () => readingWith([...OWN, seenAs(SETUP)]), ["processes"], new RegExp(`${SHOWS_ONE}: msiexec\\.exe 8800`)],
    ["an installer nobody could judge", () => readingWith([...OWN, seenAs(SETUP, null, "it could not be classified")]), ["processes"], new RegExp(`${SHOWS_ONE}: msiexec\\.exe 8800`)],
    ["an installer shown at the command's own process id and creation instant", () => readingWith([OWN[0], { ...OWN[1], ...AS_INSTALLER }, OWN[2]]), ["processes"], new RegExp(`${SHOWS_ONE}: msiexec\\.exe 3980`)],
    ["an installer shown at a chain process id under another creation instant", () => readingWith([OWN[0], { ...OWN[1], ...AS_INSTALLER, created: LATER }, OWN[2]]), ["processes"], new RegExp(`${SHOWS_ONE}: msiexec\\.exe 3980`)],

    // One reading names a process once. Twice is a reading that contradicts itself, whatever the two rows say.
    ["a chain process shown twice, word for word", () => readingWith([...OWN, OWN[1]]), ["processes"], new RegExp(`${ONCE}: node\\.exe 3980, node\\.exe 3980`)],
    ["a chain process shown twice under two creation instants", () => readingWith([...OWN, { ...OWN[1], created: LATER }]), ["processes"], new RegExp(`${ONCE}: node\\.exe 3980, node\\.exe 3980`)],
    ["a chain process shown twice under two names", () => readingWith([...OWN, { ...OWN[1], name: "cargo.exe" }]), ["processes"], new RegExp(`${ONCE}: node\\.exe 3980, cargo\\.exe 3980`)],
    ["a chain process shown twice, once as itself and once as an installer", () => readingWith([...OWN, { ...OWN[1], ...AS_INSTALLER }]), ["processes"], new RegExp(`${ONCE}: node\\.exe 3980, msiexec\\.exe 3980 \\(installer\\)`)],
    ["the command itself shown twice", () => readingWith([...OWN, OWN[0]]), ["processes"], new RegExp(`${ONCE}: node\\.exe 4120 \\(running against this folder\\), node\\.exe 4120 \\(running against this folder\\)`)],
    ["the session program shown twice", () => readingWith([...OWN, OWN[2]]), ["processes"], new RegExp(`${ONCE}: claude\\.exe 2000, claude\\.exe 2000`)],
    ["a process that is not the command's own shown twice, quiet both times", () => readingWith([...OWN, seenAs(UNRELATED), seenAs(UNRELATED)]), ["processes"], new RegExp(`${ONCE}: node\\.exe 9100, node\\.exe 9100`)],
    ["a process that is not the command's own shown twice under two creation instants", () => readingWith([...OWN, seenAs(UNRELATED), { ...seenAs(UNRELATED), created: LATER }]), ["processes"], new RegExp(`${ONCE}: node\\.exe 9100, node\\.exe 9100`)],
    ["a process that is not the command's own shown twice under two names", () => readingWith([...OWN, seenAs(UNRELATED), { ...seenAs(UNRELATED), name: "Code.exe" }]), ["processes"], new RegExp(`${ONCE}: node\\.exe 9100, Code\\.exe 9100`)],

    // The chain and the reading name one process by its id and creation instant, so they name one program.
    ["a chain process shown under another program's name", () => readingWith([OWN[0], { ...OWN[1], name: "cargo.exe" }, OWN[2]]), ["processes"], new RegExp(`${NOT_NAMED}: cargo\\.exe 3980 against node\\.exe`)],
    ["a chain process shown under an installer's name", () => readingWith([OWN[0], { ...OWN[1], ...AS_INSTALLER }, OWN[2]]), ["processes"], new RegExp(`${NOT_NAMED}: msiexec\\.exe 3980 \\(installer\\) against node\\.exe`)],
    ["a chain process shown under its own name in another case", () => readingWith([OWN[0], { ...OWN[1], name: "Node.exe" }, OWN[2]]), ["processes"], new RegExp(`${NOT_NAMED}: Node\\.exe 3980 against node\\.exe`)],
    ["the command itself shown under another name", () => readingWith([{ ...OWN[0], name: "cargo.exe" }, OWN[1], OWN[2]]), ["processes"], new RegExp(`${NOT_NAMED}: cargo\\.exe 4120 \\(running against this folder\\) against node\\.exe`)],
    ["the session program shown under another name", () => readingWith([OWN[0], OWN[1], { ...OWN[2], name: "node.exe" }]), ["processes"], new RegExp(`${NOT_NAMED}: node\\.exe 2000 against claude\\.exe`)],

    // The witness is good for one moment. Measured again before the write, it must be the same one.
    ["a witness that changed between the check and the write", () => holderWith({ since: "4300@2026-07-30T09:00:09.0000000Z" }), ["holder.caller"], /not stable/],
    ["a second measurement with no first one to hold it to", () => holderWith({ since: null }), ["holder.caller"], /not stable/],
  ];

  it.each(refusals)("refuses %s", (_what, world, rows, why) => {
    const r = preflight.reconcileHolder(world());
    expect(r.verdict).toBe("REFUSE");
    expect(failing(r)).toEqual(rows);
    // Where a row says why, it is the row that names the cause: the caller's when it failed, else the sweep's.
    if (why) expect(check(r, rows.includes("holder.caller") ? "holder.caller" : "processes").actual).toMatch(why);
    // Every refusal says what to do next, and none of them tells the holder to take over its own lease.
    expect(r.remediation.length).toBeGreaterThan(0);
    expect(r.remediation.join(" ")).not.toMatch(/takeover/i);
    expect(r.takeoverDraft).toBeNull();
  });

  it("admits the command measured to run under the lease's own session, and says how that was established", () => {
    const r = preflight.reconcileHolder(holderWorld());
    expect(failing(r)).toEqual([]);
    expect(r.verdict).toBe("PASS");
    expect(check(r, "holder.caller").actual).toBe("command 4120 reaches claude.exe 2000 in 3 steps, and the native session list names that process as interactive session 5f0c2a9e");
    expect(check(r, "holder.folder").actual).toContain(`root ${FOLDER} (native session list, for the session this command runs under; observed)`);
    const row = check(r, "processes");
    // The stock sweep counts the launcher against the folder it runs from, and the row still says so.
    expect(row.actual).toContain("node.exe ×2 (running against this folder)");
    // What sets it aside is the by-process reading: this command's own chain, by process, at one stated moment.
    expect(row.actual).toContain(`by process at ${TAKEN} (one moment; read again just before the write)`);
    expect(row.actual).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980, claude.exe 2000");
  });

  it("nothing handed to the command admits it: not a session id, not a root that calls itself observed, not its own word", () => {
    // A quiet machine, the right session id, a live record, the lease's own folder, and a root set by
    // hand. A command can be handed every one of these. The candidate before this one admitted all four.
    const handed = (caller) => holderWorld({ processes: QUIET, holder: { ...HOLDER, caller, root: SET_BY_HAND } });
    const unmeasured = [undefined, null, { verified: false, pid: null }, { verified: true, pid: LAUNCHER.pid }, { ...CALLER, chain: { ok: false, rows: [] } }];
    for (const caller of unmeasured) {
      const said = JSON.stringify(caller ?? null).slice(0, 60);
      const r = preflight.reconcileHolder(handed(caller));
      expect(r.verdict, said).toBe("REFUSE");
      expect(failing(r), said).toEqual(UNWITNESSED);
      expect(check(r, "holder.caller").actual, said).toMatch(/^not established: /);
      // The root is shown for what it is, beside the lease and the record it happens to agree with.
      expect(check(r, "holder.folder").actual, said).toContain(`root ${FOLDER} (CLAUDE_PROJECT_DIR; not observed)`);
      expect(check(r, "holder.caller").remediation, said).toMatch(/setting one by hand is not a way through/);
    }
    // The same world with the command measured is admitted, so the refusals above are about the caller alone.
    expect(preflight.reconcileHolder(holderWorld({ processes: QUIET, holder: { ...HOLDER, root: SET_BY_HAND } })).verdict).toBe("PASS");
  });

  it("a root is measured or it is only shown: the native one decides, whatever the command was handed", () => {
    for (const root of [GUESSED_ROOT, SET_BY_HAND, { path: FOLDER }, null]) {
      const r = preflight.reconcileHolder(holderWith({ caller: undefined, root }));
      expect(failing(r)).toEqual(UNWITNESSED);
      const row = check(r, "holder.folder");
      expect(row.actual).toContain(root ? `root ${FOLDER} (${root.source ?? "source not stated"}; not observed)` : "root (none)");
      expect(row.remediation).toMatch(/by hand/);
      expect(row.remediation).toMatch(/a guess never admits/);
    }
    // Beside a measured caller a handed root is not read at all. Pointing it elsewhere moves nothing,
    const beside = preflight.reconcileHolder(holderWith({ root: { path: ELSEWHERE, source: "CLAUDE_PROJECT_DIR", observed: true } }));
    expect(beside.verdict).toBe("PASS");
    expect(check(beside, "holder.folder").actual).not.toContain(ELSEWHERE);
    // and pointing it at the leased folder does not rescue a session whose native root is somewhere else.
    const elsewhere = preflight.reconcileHolder(holderWorld({ holder: { ...HOLDER, root: SET_BY_HAND, caller: { ...CALLER, sessions: { ok: true, entries: [{ ...ENTRY, cwd: ELSEWHERE }] } } } }));
    expect(failing(elsewhere)).toEqual(["holder.folder"]);
    expect(check(elsewhere, "holder.folder").actual).toContain(`root ${ELSEWHERE} (native session list, for the session this command runs under; observed)`);
    expect(check(elsewhere, "holder.folder").remediation).toMatch(/Run the renewal from inside the leased folder/);
  });

  it("sets a process aside by its id and creation instant: never by a name, a count or who started it", () => {
    // One stock sweep throughout: node.exe ×2, counted against the folder. It cannot tell these apart.
    expect(preflight.reconcileHolder(holderWorld()).verdict).toBe("PASS");
    for (const stranger of [SIBLING, DESCENDANT, HELPER, UNRELATED]) {
      // The launcher is quiet here, so the one node.exe counted against the folder is not this command's own.
      const r = preflight.reconcileHolder(readingWith([seenAs(LAUNCHER), seenAs(COMMAND), seenAs(PROGRAM), kin(stranger)]));
      expect(failing(r), String(stranger.pid)).toEqual(["processes"]);
      const row = check(r, "processes");
      expect(row.actual, String(stranger.pid)).toContain("node.exe ×2 (running against this folder)");
      expect(row.actual, String(stranger.pid)).toContain(`not this command's own: node.exe ${stranger.pid} (running against this folder)`);
      expect(row.remediation).toMatch(/each by its process id and creation time/);
      expect(row.remediation).toMatch(/never a program name, a count, another helper of the same session, or an installer/);
      expect(row.remediation).toMatch(/Never stop another tool's build, helper or session/);
    }
    // The whole chain may be counted against the folder and still be this command's own.
    const busy = preflight.reconcileHolder(
      holderWorld({ processes: [...SWEEP, OTHER_SESSION], holder: { ...HOLDER, caller: { ...CALLER, snapshot: { ...CALLER.snapshot, rows: [seenAs(LAUNCHER, true, AGAINST), seenAs(COMMAND, true, AGAINST), seenAs(PROGRAM, true, WORKING)] } } } }),
    );
    expect(busy.verdict).toBe("PASS");
    expect(check(busy, "processes").actual).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980 (running against this folder), claude.exe 2000 (a Claude session is already working in this folder)");
  });

  it("a build against the folder refuses a holder as it refuses a fresh entry, unless it is the command's own, and is named either way", () => {
    // A fresh entry has no reading of its own to go on: the same sweep refuses it outright.
    expect(failing(reconcile(holderWorld({ now: NOW })))).toEqual(["processes"]);
    const own = check(preflight.reconcileHolder(holderWorld()), "processes");
    expect(own.ok).toBe(true);
    expect(own.actual).toContain("node.exe ×2 (running against this folder)");
    const r = preflight.reconcileHolder(readingWith([...OWN, seenAs(FOREIGN_BUILD, true, AGAINST)]));
    expect(r.verdict).toBe("REFUSE");
    expect(failing(r)).toEqual(["processes"]);
    const row = check(r, "processes");
    expect(row.actual).toContain("node.exe ×2 (running against this folder)");
    expect(row.actual).toContain("not this command's own: cargo.exe 7001 (running against this folder)");
    expect(row.remediation).toMatch(/Something other than this command's own process chain contends for this folder/);
    expect(row.remediation).toMatch(/Never stop another tool's build, helper or session/);
  });

  it("a contender is not waived because the command's own process is also counted", () => {
    for (const contender of [BUILD, INSTALLER, OTHER_SESSION]) {
      const r = preflight.reconcileHolder(holderWorld({ processes: [...SWEEP, contender] }));
      expect(failing(r), contender.name).toEqual(["processes"]);
      expect(check(r, "processes").actual, contender.name).toContain(`${contender.name} ×1 (${contender.note})`);
    }
    // A quiet machine admits: an open editor is not a writer, and what does not contend is counted, not named.
    const quiet = preflight.reconcileHolder(
      holderWorld({
        processes: [...QUIET, { name: "Code.exe", count: 3, contends: false, note: null, samples: [] }],
        holder: { ...HOLDER, caller: { ...CALLER, snapshot: { ok: true, takenAt: TAKEN, rows: [seenAs(LAUNCHER), seenAs(COMMAND), seenAs(PROGRAM)], others: 5 } } },
      }),
    );
    expect(quiet.verdict).toBe("PASS");
    expect(check(quiet, "processes").actual).toBe(
      `node.exe ×2, Code.exe ×3 — by process at ${TAKEN} (one moment; read again just before the write): this command's own node.exe 4120, node.exe 3980, claude.exe 2000; 5 others, none contending`,
    );
  });

  it("a reading that contradicts the chain, or itself, sets nothing aside by it", () => {
    // The command's own process id and creation instant, shown as an installer. The chain names node.exe there.
    const shownAs = preflight.reconcileHolder(readingWith([OWN[0], { ...OWN[1], ...AS_INSTALLER }, OWN[2]]));
    // The same process shown twice: once as the chain names it, once as an installer.
    const shownTwice = preflight.reconcileHolder(readingWith([...OWN, { ...OWN[1], ...AS_INSTALLER }]));
    for (const r of [shownAs, shownTwice]) {
      expect(r.verdict).toBe("REFUSE");
      expect(failing(r)).toEqual(["processes"]);
      const row = check(r, "processes");
      // Process 3980 is named for what the reading said of it, and is not among what is set aside.
      expect(row.actual).toContain("this command's own node.exe 4120 (running against this folder), claude.exe 2000;");
      expect(row.actual).toContain(`${SHOWS_ONE}: msiexec.exe 3980`);
      expect(row.actual).toContain(`${NOT_NAMED}: msiexec.exe 3980 (installer) against node.exe`);
      // A reading that cannot be relied on is unknown, and unknown stays locked.
      expect(row.remediation).toMatch(/cannot be tied to this command/);
      expect(row.remediation).toMatch(/unknown stays locked/);
      expect(row.remediation).toMatch(/Never stop another tool's build, helper or session/);
    }
    expect(check(shownAs, "processes").actual).not.toContain(ONCE);
    expect(check(shownTwice, "processes").actual).toContain(`${ONCE}: node.exe 3980, msiexec.exe 3980 (installer)`);

    // A process named twice accounts for nothing, even where both rows agree: the launcher the sweep counts is not vouched for.
    const launcherTwice = check(preflight.reconcileHolder(readingWith([...OWN, OWN[0]])), "processes");
    expect(launcherTwice.actual).toContain("this command's own node.exe 3980, claude.exe 2000;");
    expect(launcherTwice.actual).toContain("the sweep counts node.exe against this folder and no process of this command's own accounts for it");
    // Nor is one counted among the quiet rest: what is named twice is named, both times.
    const strangerTwice = check(preflight.reconcileHolder(readingWith([...OWN, seenAs(UNRELATED), seenAs(UNRELATED)], { others: 4 })), "processes");
    expect(strangerTwice.actual).toContain(`${ONCE}: node.exe 9100, node.exe 9100; 4 others, none contending`);

    // Whatever the two rows call themselves, the row stays one line of plain text.
    const odd = [
      readingWith([OWN[0], { ...OWN[1], name: "ms`i|exec.exe\n" }, OWN[2]]),
      readingWith([...OWN, { ...OWN[1], name: "no`de|x.exe\n", note: "a|b`c\r\nd" }]),
      callerWith({ chain: { ok: true, rows: [LAUNCHER, { ...COMMAND, name: "no`de|x.exe\n" }, SHELL, PROGRAM] } }),
    ];
    for (const w of odd) {
      const r = preflight.reconcileHolder(w);
      expect(failing(r)).toEqual(["processes"]);
      for (const c of r.checks.filter((row) => MEASURED_ROWS.includes(row.name))) expect(`${c.expected}${c.actual}`, c.name).not.toMatch(/[|`\r\n]/);
    }
    expect(check(preflight.reconcileHolder(odd[2]), "processes").actual).toContain(`${NOT_NAMED}: node.exe 3980 against no de x.exe`);
  });

  it("no installer in the reading is set aside: not by its process id, not by the chain, not by how it was judged", () => {
    const standings = [
      [false, null],
      [true, INSTALLING],
      [null, "it could not be classified"],
    ];
    for (const name of ["msiexec.exe", "MsiExec.exe", "CompySetup.exe", "vs_installer.exe"]) {
      for (const [contends, note] of standings) {
        const said = `${name} ${contends}`;
        // Somewhere else on the machine, at the command's own process, and at a chain process id created later.
        const elsewhere = preflight.reconcileHolder(readingWith([...OWN, { ...seenAs(SETUP, contends, note), name }]));
        const own = preflight.reconcileHolder(readingWith([OWN[0], { ...OWN[1], name, contends, note }, OWN[2]]));
        const reused = preflight.reconcileHolder(readingWith([OWN[0], { ...OWN[1], name, contends, note, created: LATER }, OWN[2]]));
        for (const [r, pid] of [[elsewhere, SETUP.pid], [own, COMMAND.pid], [reused, COMMAND.pid]]) {
          expect(r.verdict, said).toBe("REFUSE");
          expect(failing(r), said).toEqual(["processes"]);
          expect(check(r, "processes").actual, said).toContain(`${SHOWS_ONE}: ${name} ${pid}`);
          expect(check(r, "processes").actual, said).not.toMatch(/others?, none contending/);
        }
        // An installer that is the only thing wrong is something to wait for, and is never stopped to clear a lease.
        expect(check(elsewhere, "processes").remediation, said).toMatch(/or an installer\. Wait for it to finish, then re-run/);
      }
    }
    // The installer the chain itself runs through refuses from the chain and from the reading, and is not set aside in either.
    const under = check(preflight.reconcileHolder(callerWith({ chain: { ok: true, rows: [LAUNCHER, COMMAND, SETUP_HOP, PROGRAM] }, snapshot: { ...CALLER.snapshot, rows: [...OWN, seenAs(SETUP_HOP, true, INSTALLING)] } })), "processes");
    expect(under.actual).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980, claude.exe 2000;");
    expect(under.actual).toContain("an installer is never set aside, and this command runs under one: CompySetup.exe 3100");
    expect(under.actual).toContain(`${SHOWS_ONE}: CompySetup.exe 3100`);
  });

  it("no installer the sweep lists is set aside either: not by how the sweep judged it, not by a reading with nothing wrong in it", () => {
    // The reproduction: the command's own chain read whole and coherent, beside a sweep entry that calls an installer quiet.
    const w = holderWorld();
    const reproduced = preflight.reconcileHolder({ ...w, processes: [...w.processes, { name: "msiexec.exe", count: 1, contends: false, note: null }] });
    expect(reproduced.verdict).toBe("REFUSE");
    expect(failing(reproduced)).toEqual(["processes"]);
    expect(check(reproduced, "processes").actual).toBe(
      `node.exe ×2 (${AGAINST}), msiexec.exe ×1; ${LISTS_ONE}: msiexec.exe ×1 — by process at ${TAKEN} (one moment; read again just before the write): this command's own node.exe 4120 (${AGAINST}), node.exe 3980, claude.exe 2000`,
    );

    // Whatever the rule calls an installer, in any letter case, however it was judged, on a busy machine or a quiet one.
    const waiting = /or an installer\. Wait for it to finish, then re-run/;
    const judged = [
      [{ contends: false, note: null }, waiting],
      [{ contends: true, note: INSTALLING }, waiting],
      [{ contends: null, note: null }, /unknown stays locked/],
      [{ note: null }, /unknown stays locked/],
    ];
    for (const name of ["msiexec.exe", "MsiExec.exe", "CompySetup.exe", "vs_installer.exe", "Setup.exe"]) {
      for (const base of [SWEEP, QUIET]) {
        for (const [standing, next] of judged) {
          const said = `${name} ${JSON.stringify(standing)} beside ${base[0].contends}`;
          const r = preflight.reconcileHolder(holderWorld({ processes: [...base, { name, count: 2, samples: [], ...standing }] }));
          expect(r.verdict, said).toBe("REFUSE");
          expect(failing(r), said).toEqual(["processes"]);
          const row = check(r, "processes");
          expect(row.actual, said).toContain(`${LISTS_ONE}: ${name} ×2`);
          // The reading shows nothing wrong, and still says what it set aside: the refusal is the sweep's.
          expect(row.actual, said).toContain(`this command's own node.exe 4120 (${AGAINST}), node.exe 3980, claude.exe 2000`);
          expect(row.actual, said).not.toContain(SHOWS_ONE);
          expect(row.remediation, said).toMatch(next);
          expect(row.remediation, said).toMatch(/Never stop another tool's build, helper or session/);
        }
      }
    }

    // Whatever an installer calls itself, the row stays one line of plain text.
    const odd = check(preflight.reconcileHolder(holderWorld({ processes: [...SWEEP, calledQuiet("Comp|y`Setup.exe")] })), "processes");
    expect(odd.actual).toContain(`${LISTS_ONE}: Comp y Setup.exe ×1`);
    expect(`${odd.expected}${odd.actual}`).not.toMatch(/[|`\r\n]/);
  });

  it("a quiet program in the sweep that is no installer is still counted, and still admitted", () => {
    for (const base of [SWEEP, QUIET]) {
      const r = preflight.reconcileHolder(holderWorld({ processes: [...base, calledQuiet("Code.exe", 3), calledQuiet("explorer.exe")] }));
      expect(failing(r)).toEqual([]);
      expect(r.verdict).toBe("PASS");
      expect(check(r, "processes").actual).toContain("Code.exe ×3, explorer.exe ×1 — by process");
      expect(check(r, "processes").actual).not.toContain(LISTS_ONE);
    }
    // The command's own chain alone, with nothing else in the sweep: admitted as it was, in the words it was.
    expect(check(preflight.reconcileHolder(holderWorld()), "processes").actual).toBe(
      `node.exe ×2 (${AGAINST}) — by process at ${TAKEN} (one moment; read again just before the write): this command's own node.exe 4120 (${AGAINST}), node.exe 3980, claude.exe 2000`,
    );
  });

  it("a reading that names each process once, as the chain names it, is still admitted", () => {
    const admitted = (rows, patch) => {
      const r = preflight.reconcileHolder(readingWith(rows, patch));
      expect(failing(r)).toEqual([]);
      expect(r.verdict).toBe("PASS");
      const said = check(r, "processes").actual;
      for (const refusal of [ONCE, NOT_NAMED, SHOWS_ONE, LISTS_ONE, "process id reused", "not this command's own"]) expect(said, refusal).not.toContain(refusal);
      return said;
    };
    expect(admitted(OWN)).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980, claude.exe 2000");
    // Every process on the chain, the shell between the command and its session included, each shown once.
    expect(admitted([...OWN, seenAs(SHELL)])).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980, bash.exe 3100, claude.exe 2000");
    // In any order: a reading is matched by process, not by where a row stands in it.
    expect(admitted([seenAs(PROGRAM), seenAs(COMMAND), seenAs(LAUNCHER, true, AGAINST)])).toContain("this command's own node.exe 4120 (running against this folder), node.exe 3980, claude.exe 2000");
    // Beside other processes, each named once, of the same names and of others, none of them contending.
    expect(admitted([...OWN, seenAs(UNRELATED), seenAs(FOREIGN_BUILD), seenAs(FOREIGN_SESSION)], { others: 2 })).toMatch(/claude\.exe 2000; 5 others, none contending$/);
  });

  it("a process is identified by an id, a creation instant and a name: one rule, for the check and for what the observer may fold into a count", () => {
    expect(preflight.isIdentified(seenAs(COMMAND))).toBe(true);
    expect(preflight.isIdentified(COMMAND)).toBe(true);
    const short = [{ pid: null }, { pid: 0 }, { pid: -1 }, { pid: "3980" }, { pid: 3980.5 }, { created: null }, { created: "" }, { created: "yesterday" }, { created: "2026-07-30 09:00:03" }, { name: "" }, { name: "  " }, { name: null }];
    for (const patch of short) {
      expect(preflight.isIdentified({ ...seenAs(COMMAND), ...patch }), JSON.stringify(patch)).toBe(false);
      // The check holds a reading to it: one process short of it, however quiet, and the reading was not read in full.
      const r = preflight.reconcileHolder(readingWith([...OWN, { ...seenAs(UNRELATED), ...patch }]));
      expect(failing(r), JSON.stringify(patch)).toEqual(["processes"]);
      expect(check(r, "processes").actual, JSON.stringify(patch)).toContain("by process: read, but not in full");
    }
    for (const none of [null, undefined, "node.exe", 3980]) expect(preflight.isIdentified(none), String(none)).toBe(false);
  });

  it("a witness is good for one moment: measured again before the write, it must be the same one", () => {
    const first = preflight.callerWitness(HOLDER);
    expect(first.verified).toBe(true);
    expect(preflight.reconcileHolder(holderWith({ since: first.identity })).verdict).toBe("PASS");

    // The same session, reached by a different command: every fact is whole, and it is not the witness that was admitted.
    const RELAUNCHED = { ...LAUNCHER, pid: 4300, created: "2026-07-30T09:00:09.0000000Z" };
    const again = { ...CALLER, pid: RELAUNCHED.pid, chain: { ok: true, rows: [RELAUNCHED, COMMAND, SHELL, PROGRAM] }, snapshot: { ...CALLER.snapshot, rows: [seenAs(RELAUNCHED, true, AGAINST), seenAs(COMMAND), seenAs(PROGRAM)] } };
    expect(preflight.reconcileHolder(holderWith({ caller: again })).verdict).toBe("PASS");
    const moved = preflight.reconcileHolder(holderWith({ caller: again, since: first.identity }));
    expect(failing(moved)).toEqual(["holder.caller"]);
    expect(check(moved, "holder.caller").actual).toBe("not stable: what this command measured about itself changed between the check and the write");
    expect(check(moved, "holder.caller").remediation).toMatch(/nothing was posted/);

    // A session that ended, or a reading that failed, between the two is not a witness at all.
    const gone = preflight.reconcileHolder(holderWith({ caller: { ...CALLER, sessions: { ok: true, entries: [] } }, since: first.identity }));
    expect(failing(gone)).toEqual(UNWITNESSED);
    expect(check(gone, "holder.caller").actual).toMatch(/^not established: /);
    const raced = preflight.reconcileHolder(holderWith({ caller: { ...CALLER, snapshot: { ok: true, takenAt: TAKEN, rows: [...OWN, seenAs(FOREIGN_BUILD, true, AGAINST)], others: 0 } }, since: first.identity }));
    expect(failing(raced)).toEqual(["processes"]);
  });

  it("callerWitness: what is established, from what, and nothing when any of it is missing", () => {
    const w = preflight.callerWitness(HOLDER);
    expect(w).toMatchObject({ verified: true, why: null, root: FOLDER, pids: CHAIN.map((p) => p.pid) });
    expect(w.host).toMatchObject({ pid: PROGRAM.pid, name: "claude.exe" });
    expect(w.session).toMatchObject({ sessionId: SESSION, kind: "interactive", pid: PROGRAM.pid });
    // The chain, each process by its id and its creation instant: this is all that is ever set aside.
    expect(w.own).toEqual(CHAIN.map((p) => `${p.pid}@${p.created}`));
    expect(w.identity).toContain(w.own.join(" "));
    expect(w.identity).toContain(SESSION);

    for (const holder of [null, {}, { ...HOLDER, caller: undefined }, { ...HOLDER, caller: { verified: true } }]) {
      expect(preflight.callerWitness(holder)).toMatchObject({ verified: false, root: null, own: [], pids: [], identity: null });
      expect(preflight.callerWitness(holder).why).toBeTruthy();
    }
    // The native program is matched as a path, the session program by its exact name.
    expect(preflight.callerWitness({ ...HOLDER, caller: { ...CALLER, cli: "c:/users/kuya/.local/bin/claude.exe" } }).verified).toBe(true);
    expect(preflight.isSessionProgram("Claude.EXE")).toBe(true);
    for (const name of ["claude-helper.exe", "claude.exe.bak", "notclaude.exe", "", null]) expect(preflight.isSessionProgram(name), String(name)).toBe(false);
    // An installer, by the sweep classifier's own rule (held to it in renew-cli.test.mjs).
    for (const name of ["msiexec.exe", "MsiExec.exe", "CompySetup.exe", "vs_installer.exe"]) expect(preflight.isInstallerProgram(name), name).toBe(true);
    for (const name of ["node.exe", "setup.exe.bak", "claude.exe", "", null]) expect(preflight.isInstallerProgram(name), String(name)).toBe(false);
    expect(preflight.CALLER_MAX_HOPS).toBe(12);
    // A chain exactly as long as is ever read is still a chain.
    const longest = longChain().filter((_, i) => i < preflight.CALLER_MAX_HOPS - 1 || i === preflight.CALLER_MAX_HOPS + 1);
    longest[longest.length - 2] = { ...longest[longest.length - 2], parentPid: PROGRAM.pid };
    expect(longest).toHaveLength(preflight.CALLER_MAX_HOPS);
    expect(preflight.callerWitness({ ...HOLDER, caller: { ...CALLER, chain: { ok: true, rows: longest } } }).verified).toBe(true);
  });

  it("every row about the command is one line of plain text, whatever a process calls itself", () => {
    const odd = { pid: 9300, created: "2026-07-30T08:00:00.0000000Z", name: "no`de|x.exe\n", contends: true, note: "a|b`c\r\nd" };
    const worlds = [
      holderWorld(),
      readingWith([...OWN, odd]),
      holderWith({ caller: undefined, root: { path: `${FOLDER}|x`, source: "a|b`c\n" } }),
      chainWith([LAUNCHER, COMMAND, SHELL, { ...PROGRAM, name: "cl`au|de.exe\n" }]),
      listWith([{ ...ENTRY, kind: "back`gr|ound\n" }]),
      listWith([{ ...ENTRY, cwd: `${ELSEWHERE}|\`x` }]),
    ];
    for (const w of worlds) {
      for (const c of preflight.reconcileHolder(w).checks.filter((row) => MEASURED_ROWS.includes(row.name))) {
        expect(`${c.expected}${c.actual}`, c.name).not.toMatch(/[|`\r\n]/);
      }
    }
    expect(check(preflight.reconcileHolder(readingWith([...OWN, odd])), "processes").actual).toContain("not this command's own: no de x.exe 9300 (a b c d)");
  });

  it("creates nothing: a folder that is not there is a fresh launch, not a renewal", () => {
    const w = holderWorld({ processes: QUIET, checkouts: baseWorld().checkouts.filter((c) => !samePath(c.path, FOLDER)) });
    expect(reconcile(w).actions).toEqual(["create-worktree"]);
    const r = preflight.reconcileHolder(w);
    expect(failing(r)).toEqual(["folder.exists", "git.withinLease"]);
    expect(r.actions).toEqual([]);
  });

  it("fresh entry is not relaxed: the states a holder renews in still refuse through `reconcile`", () => {
    const fresh = (overrides = {}) => reconcile(holderWorld({ processes: QUIET, ...overrides }));
    const expired = fresh({ now: new Date("2026-08-02T12:00:00Z") });
    expect(failing(expired)).toEqual(["task.claim"]);
    expect(expired.takeoverDraft).toContain("### Verified takeover");
    expect(failing(fresh({ gitState: gitWith({ modified: ["tools/entry/preflight.mjs"] }) }))).toEqual(["git.clean"]);
    expect(failing(fresh({ gitState: { ...baseWorld().gitState, clean: false, ahead: 1 } }))).toEqual(["git.clean"]);
    // The holder's own observations buy a fresh entry nothing: `reconcile` does not read them. A command
    // measured to its session, with its own launcher counted against the folder, is refused like anyone.
    expect(failing(reconcile(holderWorld()))).toEqual(["processes"]);
    expect(check(reconcile(holderWorld()), "processes")).toEqual(check(reconcile(baseWorld({ processes: SWEEP })), "processes"));
    expect(reconcile(holderWorld()).checks.map((c) => c.name)).toEqual(reconcile(baseWorld()).checks.map((c) => c.name));
    for (const name of ["holder.session", "holder.caller"]) expect(reconcile(holderWorld()).checks.map((c) => c.name)).not.toContain(name);
  });

  it("ranks every row it emits, in an order of its own", () => {
    const names = preflight.reconcileHolder(holderWorld()).checks.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(preflight.HOLDER_REMEDIATION_ORDER, name).toContain(name);
    // Who is asking is settled straight after which session it claims to be, and before where it is rooted.
    expect(names.slice(names.indexOf("holder.session"), names.indexOf("holder.session") + 3)).toEqual(["holder.session", "holder.caller", "holder.folder"]);
    const rank = (name) => preflight.HOLDER_REMEDIATION_ORDER.indexOf(name);
    expect(rank("holder.caller")).toBe(rank("holder.session") + 1);
    // The fresh entry's order is pinned to the fresh entry's rows (refusal-order.test.mjs); it gains none of these.
    for (const name of ["holder.session", "holder.caller"]) expect(preflight.REMEDIATION_ORDER).not.toContain(name);
  });

  it("what the owner reads: a holder refusal is the same verdict table, with the stray path in it", () => {
    const w = holderWorld({ gitState: gitWith({ untracked: ["docs/BACKLOG.md"] }) });
    const text = verdictLines(w.task, preflight.reconcileHolder(w)).join("\n");
    expect(text).toContain("git.withinLease");
    expect(text).toContain("docs/BACKLOG.md");
    // An unmeasured command is told why in the same table, in the order the rows are settled.
    const unmeasured = holderWith({ caller: undefined });
    const refused = verdictLines(unmeasured.task, preflight.reconcileHolder(unmeasured)).join("\n");
    expect(refused).toContain("holder.caller");
    expect(refused).toContain("not established: nothing was measured about the command that asked");
  });
});
