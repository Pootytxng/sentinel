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
import { threadLease } from "./claim.mjs";
import { reconcile, selectTask } from "./preflight.mjs";
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

  it("expired claim → the draft names the remote takeover's conditions, and the verdict still refuses (#682)", () => {
    const w = baseWorld();
    w.claim = { ...w.claim, expires: "2026-07-29" };
    w.task = { ...w.task, claimExpires: "2026-07-29" };
    const r = reconcile(w);
    expect(r.verdict).toBe("REFUSE");
    expect(r.takeoverDraft).toMatch(/remote takeover/);
    expect(r.takeoverDraft).toMatch(/12 hours past expiry with nothing posted since/);
    expect(r.takeoverDraft).toMatch(/folder untouched/);
    expect(r.takeoverDraft).toMatch(/`not inspected`/);
  });

  // Codex review 5612865429: the #682 draft named the Handoff in prose only, so posting it as written
  // left the stale claim holding its paths. Fold the draft through the same reader the gates use.
  it("expired claim → the draft, posted as written, releases the stale lease", () => {
    const w = baseWorld();
    w.claim = { ...w.claim, expires: "2026-07-29" };
    w.task = { ...w.task, claimExpires: "2026-07-29" };
    const r = reconcile(w);
    const stale = {
      body: ["### Ownership claim", "- Lane: Codex", "- Write scope: `docs/WORK_CONTROL.md`", "- Claim expires: 2026-07-29"].join("\n"),
      createdAt: "2026-07-28T10:00:00Z",
    };
    expect(threadLease([stale]).claim).not.toBeNull();
    const after = threadLease([stale, { body: r.takeoverDraft, createdAt: "2026-07-30T12:00:00Z" }]);
    expect(after.claim).toBeNull();
    expect(after.handoff.released).toBe(true);
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
