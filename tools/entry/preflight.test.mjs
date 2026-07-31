// Guards 4 and 7, and every edge case in spec §7.
//
// The reconciler is the piece that makes the governing invariant checkable: "a task must not begin
// until its Work Control issue, active claim, actual session root, Git worktree, branch, dirty
// state, active processes, and effective project settings agree." It produces a VERDICT, never a
// repair, and REFUSE always precedes the first write.
//
// Pure over injected facts, so every edge case is a data fixture rather than a machine state.

import { describe, expect, it } from "vitest";
import { reconcile, selectTask } from "./preflight.mjs";
import { verdictLines } from "./render.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const BRANCH = "feat/single-entry-workflow";
const NOW = new Date("2026-07-30T12:00:00Z");

const check = (r, name) => r.checks.find((c) => c.name === name);

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

describe("selectTask", () => {
  // Rewritten 2026-07-30 (owner addendum on #18). This block used to assert that one Ready task
  // selects itself — which is exactly how the shortcut skipped Kuya's own Active #18 and silently
  // launched #13. Without an explicit issue, selectTask now returns a CHOICE and never a task.
  // The menu's shape and its recommendation are guarded in select.test.mjs.
  const items = [
    { number: 13, status: "Ready", lane: "Codex", gate: "None" },
    { number: 14, status: "Needs Kuya", lane: "Kuya", gate: "Kuya" },
    { number: 17, status: "Review", lane: "Codex", gate: "None" },
  ];

  it("no startable task → says so, and never invents work", () => {
    const r = selectTask([{ number: 14, status: "Needs Kuya", gate: "Kuya" }], {});
    expect(r.kind).toBe("none");
    expect(r.reason).toMatch(/no .*ready/i);
  });

  it("several Ready tasks → a numbered choice", () => {
    const r = selectTask([...items, { number: 19, status: "Ready", lane: "Claude Code", gate: "None" }], {});
    expect(r.kind).toBe("choice");
    expect(r.options.map((o) => o.number)).toEqual([13, 19]);
    expect(r.task).toBeUndefined();
  });

  it("exactly one Ready task → still a choice: the shortcut asks, it does not pick", () => {
    const r = selectTask(items, {});
    expect(r.kind).toBe("choice");
    expect(r.task).toBeUndefined();
    expect(r.options.map((o) => o.number)).toEqual([13]);
    expect(r.recommended).toBe(null);
  });

  it("our own unexpired Active outranks an unrelated Ready task", () => {
    const withMine = [...items, { number: 18, status: "Active", lane: "Claude Code", gate: "None", claimExpires: "2026-07-31" }];
    const r = selectTask(withMine, { self: { lane: "Claude Code" }, now: new Date("2026-07-30T23:30:00Z") });
    expect(r.kind).toBe("choice");
    expect(r.recommended).toBe(18);
    expect(r.options[0].number).toBe(18);
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
