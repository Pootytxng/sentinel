import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
import { pickRoute, readLauncherTasks, SUCCESSOR_PREAMBLE, successorPrompt } from "./successor-route.mjs";

// Guard for #466: "launch the successor yourself" only works if the routing decision is provable.
// pickRoute is pure so every branch below is checkable without a real scheduled-tasks store; a
// separate live CLI run (recorded in the #466 report, not here) proves the real machine currently
// has no launcher provisioned and therefore routes to chip, matching every case below with no tasks.

describe("pickRoute", () => {
  it("routes to chip when nothing is armed", () => {
    const { route, routine } = pickRoute([]);
    expect(route).toBe("chip");
    expect(routine).toEqual([]);
  });

  it("routes to the routine when compy-successor-a alone is armed", () => {
    const { route, routine } = pickRoute([{ id: "compy-successor-a", useWorktree: true }]);
    expect(route).toBe("routine");
    expect(routine).toEqual(["compy-successor-a"]);
  });

  it("routes to both, in a-then-b order, regardless of input order", () => {
    const tasks = [
      { id: "compy-successor-b", useWorktree: true },
      { id: "compy-successor-a", useWorktree: true },
    ];
    expect(pickRoute(tasks).routine).toEqual(["compy-successor-a", "compy-successor-b"]);
  });

  it("drops a disabled routine and keeps an armed one", () => {
    const tasks = [
      { id: "compy-successor-a", enabled: false, useWorktree: true },
      { id: "compy-successor-b", useWorktree: true },
    ];
    expect(pickRoute(tasks).routine).toEqual(["compy-successor-b"]);
  });

  it("treats useWorktree: false as unarmed", () => {
    expect(pickRoute([{ id: "compy-successor-a", enabled: true, useWorktree: false }]).route).toBe("chip");
  });

  it("treats a missing useWorktree field as unarmed — true must be explicit, not merely not-false", () => {
    expect(pickRoute([{ id: "compy-successor-a" }]).route).toBe("chip");
    expect(pickRoute([{ id: "compy-successor-a", enabled: true }]).route).toBe("chip");
  });

  it("ignores an id that is not one of the two known launchers", () => {
    expect(pickRoute([{ id: "someone-elses-routine", enabled: true, useWorktree: true }]).route).toBe("chip");
  });

  it("skips a malformed entry instead of throwing", () => {
    const tasks = [null, "not an object", 42, { id: "compy-successor-b", useWorktree: true }];
    expect(pickRoute(tasks).routine).toEqual(["compy-successor-b"]);
  });

  it("treats a non-array input as no tasks, never throwing", () => {
    for (const bad of [null, undefined, "garbage", 7, {}]) {
      expect(pickRoute(bad).route).toBe("chip");
    }
  });

  it("a present-but-unarmed launcher names the owner-only toggle, not a missing routine", () => {
    const why = pickRoute([{ id: "compy-successor-a", enabled: true }]).why;
    expect(why).toContain("compy-successor-a exist");
    expect(why).toContain("owner-only");
    expect(pickRoute([]).why).toContain("no compy-successor launcher routine exists");
  });

  it("always carries a human-readable why, on both routes", () => {
    expect(pickRoute([]).why).toEqual(expect.any(String));
    expect(pickRoute([]).why.length).toBeGreaterThan(0);
    expect(pickRoute([{ id: "compy-successor-a", useWorktree: true }]).why).toEqual(expect.any(String));
  });
});

describe("readLauncherTasks", () => {
  function tmpRoot() {
    return mkdtempSync(join(tmpdir(), "successor-route-"));
  }

  function writeTasks(root, org, project, tasks) {
    const dir = join(root, "claude-code-sessions", org, project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "scheduled-tasks.json"), JSON.stringify(tasks));
  }

  it("finds launcher tasks across separate org/project folders and filters out other routines", () => {
    const root = tmpRoot();
    writeTasks(root, "org1", "proj1", [
      { id: "compy-successor-a", useWorktree: true },
      { id: "some-other-routine", useWorktree: true },
    ]);
    writeTasks(root, "org1", "proj2", [{ id: "compy-successor-b", useWorktree: true }]);
    const found = readLauncherTasks({ root });
    expect(found.map((t) => t.id).sort()).toEqual(["compy-successor-a", "compy-successor-b"]);
  });

  it("returns an empty list, never throws, when the root does not exist", () => {
    const root = join(tmpdir(), "successor-route-missing-root-" + Date.now());
    expect(readLauncherTasks({ root })).toEqual([]);
  });

  it("returns an empty list, never throws, on malformed JSON", () => {
    const root = tmpRoot();
    const dir = join(root, "claude-code-sessions", "org1", "proj1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "scheduled-tasks.json"), "{ not valid json ");
    expect(readLauncherTasks({ root })).toEqual([]);
  });

  it("returns an empty list when scheduled-tasks.json holds something other than a task array", () => {
    const root = tmpRoot();
    writeTasks(root, "org1", "proj1", { unexpected: "shape" });
    expect(readLauncherTasks({ root })).toEqual([]);
  });

  // #466 review: the real store is `{ scheduledTasks: [...], recordedSkips: {...}, ... }`, not a
  // bare array and not `.tasks` — this fixture copies one real compy-successor-a entry verbatim so a
  // parser that only understood the two shapes this file previously tolerated cannot pass silently.
  it("reads the REAL scheduled-tasks.json shape (scheduledTasks key) — chip when useWorktree is absent", () => {
    const root = tmpRoot();
    const real = {
      scheduledTasks: [
        {
          id: "compy-successor-a",
          displayName: "x",
          enabled: true,
          filePath: "C:\\Users\\Kuya\\.claude\\scheduled-tasks\\compy-successor-a\\SKILL.md",
          createdAt: 1789706881443,
          cwd: "C:\\Users\\Kuya\\code\\sentinel",
          notifySessionId: "local_x",
          lastRunAt: "2026-09-18T05:01:40.780Z",
        },
      ],
      recordedSkips: {},
      sundayAliasBoundaryStamped: true,
    };
    writeTasks(root, "org1", "proj1", real);
    expect(pickRoute(readLauncherTasks({ root })).route).toBe("chip");
  });

  it("reads the REAL scheduled-tasks.json shape and routes to the routine once useWorktree: true is set", () => {
    const root = tmpRoot();
    const real = {
      scheduledTasks: [
        {
          id: "compy-successor-a",
          displayName: "x",
          enabled: true,
          useWorktree: true,
          filePath: "C:\\Users\\Kuya\\.claude\\scheduled-tasks\\compy-successor-a\\SKILL.md",
          createdAt: 1789706881443,
          cwd: "C:\\Users\\Kuya\\code\\sentinel",
          notifySessionId: "local_x",
          lastRunAt: "2026-09-18T05:01:40.780Z",
        },
      ],
      recordedSkips: {},
      sundayAliasBoundaryStamped: true,
    };
    writeTasks(root, "org1", "proj1", real);
    expect(pickRoute(readLauncherTasks({ root })).routine).toEqual(["compy-successor-a"]);
  });

  it("feeds straight into pickRoute: an unreadable store routes to chip end to end", () => {
    const root = join(tmpdir(), "successor-route-missing-e2e-" + Date.now());
    expect(pickRoute(readLauncherTasks({ root })).route).toBe("chip");
  });
});

describe("SUCCESSOR_PREAMBLE", () => {
  // #466 review: replaced the resume-doc check with the folder self-check a routine-launched
  // successor actually needs — the routine's worktree toggle can be off, landing it in the shared
  // main checkout where every write is refused, so the preamble itself must name the escape hatch.
  it("names the folder self-check, the escape hatch, the ownership re-derive step, and ends with TASK:", () => {
    expect(SUCCESSOR_PREAMBLE).toContain("git rev-parse --show-toplevel");
    expect(SUCCESSOR_PREAMBLE).toContain("C:/Users/Kuya/code/sentinel");
    expect(SUCCESSOR_PREAMBLE).toContain("spawn_task");
    expect(SUCCESSOR_PREAMBLE).toContain("docs/WORK_CONTROL.md");
    expect(SUCCESSOR_PREAMBLE).toContain("successor-route.mjs");
    expect(SUCCESSOR_PREAMBLE.endsWith("TASK:")).toBe(true);
  });

  // #466: every fresh app worktree arrives with an absolute core.hooksPath pin (#405), and
  // hookspath-fleet-guard then reds every lane's push. Only the folder's own session may repoint it,
  // so the prompt a launched session starts from has to say so.
  it("tells a launched session to repoint its own folder's absolute hooksPath, after its claim", () => {
    expect(SUCCESSOR_PREAMBLE).toContain("git config --worktree core.hooksPath .githooks");
    expect(SUCCESSOR_PREAMBLE.indexOf("core.hooksPath .githooks")).toBeGreaterThan(
      SUCCESSOR_PREAMBLE.indexOf("Ownership claim"),
    );
  });

  it("is a non-empty string independent of any live machine state", () => {
    expect(typeof SUCCESSOR_PREAMBLE).toBe("string");
    expect(SUCCESSOR_PREAMBLE.length).toBeGreaterThan(40);
  });
});

// #613: a successor handoff for #583 arrived with no `Claim:` line, and #405's Handoff released its
// lease only in prose. The lease fold reads the Claim line alone, so both leases stayed live with
// nobody writing, and nothing refused either handoff. The prompt now exists only beside a Handoff that
// the lease fold itself reads as released.
describe("successorPrompt (#613)", () => {
  const RELEASED = [
    "### Handoff",
    "",
    "- Outcome: guard landed.",
    "- Exact next action: non-author review of the PR.",
    "- Claim: released",
  ].join("\n");

  it("builds the prompt from a Handoff whose Claim line releases: preamble, then the handoff verbatim", () => {
    const built = successorPrompt(`${RELEASED}\n`);
    expect(built.ok).toBe(true);
    expect(built.prompt.startsWith(SUCCESSOR_PREAMBLE)).toBe(true);
    expect(built.prompt).toContain(`TASK:\n${RELEASED}`);
  });

  it("refuses when there is no handoff text at all", () => {
    for (const none of [undefined, null, "", "   \n\t "]) {
      const built = successorPrompt(none);
      expect(built.ok).toBe(false);
      expect(built.why).toContain("--handoff");
      expect(built).not.toHaveProperty("prompt");
    }
  });

  // The #583 shape: the outgoing session edited its Ownership claim to say it handed off.
  it("refuses an edited Ownership claim that says it handed off, with no Handoff section", () => {
    const edited = [
      "### Ownership claim",
      "- Executor/tool: claude-code",
      "  **Handed off 2026-09-28T16:30Z** to a successor session. The successor's own claim supersedes this one.",
      "- Write scope: `src/data/x.ts`",
    ].join("\n");
    const built = successorPrompt(edited);
    expect(built.ok).toBe(false);
    expect(built.why).toContain("### Handoff");
  });

  // The #405 shape: a real Handoff whose release is prose in the Outcome, with no Claim line.
  it("refuses a Handoff that says released in prose but has no Claim line", () => {
    const prose = [
      "### Handoff",
      "",
      "- Outcome: the work is open as draft PR #492. This lease is **released**.",
      "- Exact next action: an exact-head review of PR #492 by a non-author.",
    ].join("\n");
    const built = successorPrompt(prose);
    expect(built.ok).toBe(false);
    expect(built.why).toContain("- Claim: released");
  });

  it("refuses a Claim line that holds or transfers the lease", () => {
    for (const state of [
      "transferred to codex until 2026-09-30T00:00Z",
      "**HELD.** Released only when a review verdict lands",
      "active",
    ]) {
      const built = successorPrompt(`### Handoff\n- Outcome: x\n- Claim: ${state}`);
      expect(built.ok, state).toBe(false);
    }
  });

  it("refuses a release that another Claim line in the same Handoff contradicts", () => {
    const both = `${RELEASED}\n- Claim: transferred to codex until 2026-09-30T00:00Z`;
    expect(successorPrompt(both).ok).toBe(false);
  });

  // Shares the lease fold's parser: a release quoted inside a fence is an example, not a release.
  it("refuses a Handoff that exists only as a fenced example", () => {
    expect(successorPrompt(["```text", RELEASED, "```"].join("\n")).ok).toBe(false);
  });

  it("refuses a Claim: released that sits above the Handoff header, outside its section", () => {
    const above = ["- Claim: released", "", "### Handoff", "- Outcome: x"].join("\n");
    expect(successorPrompt(above).ok).toBe(false);
  });

  // Codex review of c1935955: the fold reads a comment's release first and its claim after, so a text
  // carrying both leaves the lease live, whichever comes first on the page.
  it("refuses a released Handoff that also carries an Ownership claim, in either order", () => {
    const claim = ["### Ownership claim", "- Write scope: `scripts/x.mjs`"].join("\n");
    for (const text of [`${RELEASED}\n\n${claim}`, `${claim}\n\n${RELEASED}`]) {
      const built = successorPrompt(text);
      expect(built.ok, text).toBe(false);
      expect(built.why).toContain("Ownership claim");
    }
  });
});

// #632: the #620 and #616 chains launched ten successors between 01:59Z and 10:14Z on 2026-09-29. Each
// one rechecked a gate that had not moved and re-spawned itself. The owner's direction that day: no
// successor for blocked, owner-gated, complete or observation-only work; the turn ends with a status on
// the issue and `Successor: none`. A released Handoff is not enough on its own. Its Exact next action
// has to be work a successor can start now.
describe("successorPrompt refuses blocked, owner-gated, complete and recheck work (#632)", () => {
  // #583's Handoff of 2026-09-29T02:45:45Z, verbatim
  // (https://github.com/Pootytxng/sentinel/issues/583#issuecomment-5882659619). It releases the lease,
  // and it leaves nothing for a successor: the rebase belongs to #616's and #617's own lanes, and #611
  // waits on the owner's proof. Before #632 the router printed a successor prompt for it.
  const REAL_583 = [
    "### Handoff",
    "- Outcome: lane 2b is code-complete and review-clean. Codex round 6 at `d302c9d` returned **PASS** with no blocking findings; its one non-blocking note is filed as #628. Draft PR #611 is ready for the owner's live proof and merge.",
    "- Files/commits/PR: PR #611, branch `claude/determined-galileo-mb5z29`, final head `d302c9d1718e7e8fae73f46e87c1e768a9489bf7`. This claim added `8483c8e` (Codex r4 fixes) and `d302c9d` (Codex r5 notes) on top of `13a4e21`. Files: `src-tauri/src/experiment.rs`, `src-tauri/src/lib.rs`, `src/experiment-record-first-guard.test.ts`. `actions.rs` untouched; `history.rs` only read.",
    "- Verification:",
    "  - Native pre-push gate PASS at `d302c9d` (`logs/verify-local-2026-09-29T02-31-45Z.log`): #356 write-scope and #517 lease overlap OK; frontend 469/469 files, 7827 passed / 1 expected fail / 9 skipped; Rust 1401/0/24; clippy clean.",
    "  - The new guards fail on the previous head; reverting each Rust fix reds its own test.",
    "  - Codex (independent): r4 FAIL at `13a4e21` → fixed; r5 PASS at `8483c8e` (3 notes, fixed); r6 PASS at `d302c9d` ([comment](https://github.com/Pootytxng/sentinel/pull/611#issuecomment-5882632385)).",
    "  - Self-review #8 PASS (12/12); `d302c9d` touches no UI.",
    "- Remaining work: #628 (start note wording, after #611), #620 (startup-toggle live read), #616 and #617 (★ fixes that land after #611), hidden-state item 4 (corrupt `experiments.json` loses a Running trial's context). Full list in the PR body's Remaining section.",
    "- Gates or owner actions: owner-only live proof on the owner's rig (`game-bar-disable` start → play → conclude, then kill Compy mid-start and relaunch), then the merge. The `work-control-gate.mjs` merge receipt is written at merge time against the final head. Flagged for a Cowork adversarial audit (mutation/rollback-adjacent).",
    "- Worktree state: `C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\competent-northcutt-f84e33`, branch `claude/competent-northcutt-f84e33` at `d302c9d`, clean, equal to the remote PR branch.",
    "- Active processes: none.",
    "- Exact next action: #616 and #617 may rebase onto `d302c9d` now; nothing further lands on #611 before the owner's proof.",
    "- Claim: released",
  ].join("\n");

  const released = (next) =>
    ["### Handoff", "- Outcome: x.", ...(next === null ? [] : [`- Exact next action: ${next}`]), "- Claim: released"].join(
      "\n",
    );
  const refused = (next) => {
    const built = successorPrompt(released(next));
    expect(built.ok, String(next)).toBe(false);
    expect(built).not.toHaveProperty("prompt");
    expect(built.why, String(next)).toContain("Successor: none");
    return built.why;
  };

  it("refuses #583's real released Handoff, whose next step waits on the owner's proof", () => {
    const built = successorPrompt(REAL_583);
    expect(built.ok).toBe(false);
    expect(built.why).toContain("Successor: none");
  });

  it("refuses the #620 and #616 chain shapes once they are written as released Handoffs", () => {
    for (const next of [
      "land #620's startup-entry probe after #611 merges; if #611 is still open, re-spawn this prompt.",
      "land #616 once #583 releases history.rs.",
      "land #620's live probe (gated on #611).",
      "land #618 when PR 611 lands.",
    ]) {
      refused(next);
    }
  });

  it("refuses a next action that waits on a condition or a time", () => {
    for (const next of [
      "once the native pre-push gate can pass, push 3d370073.",
      "Claude Code or Codex: when an independent review appears on #555, post a landing claim.",
      "after 09:37Z, re-run the Codex review.",
    ]) {
      refused(next);
    }
  });

  it("refuses a Handoff whose work is complete, or that names no next action", () => {
    for (const next of [
      null,
      "",
      "—",
      "none — merged as d439a5f5.",
      "Nothing; #613 closed by the merge.",
      "n/a",
      "close #452 as completed.",
      "Close with evidence: PR #314 merged as 7dafc402.",
    ]) {
      refused(next);
    }
  });

  // The #616 chain's step 1: "stop. Write `Successor: chip` with this same prompt". Anywhere in the
  // text, not only in the next action: the whole text is what the successor is handed.
  it("refuses a Handoff that tells its successor to re-spawn itself, wherever it says so", () => {
    expect(successorPrompt(released("land #620's startup-entry probe.")).ok).toBe(true);
    for (const loop of [
      "- Steps: if #611 is still open, write `Successor: chip` with this same prompt and stop.",
      "- Steps: re-spawn this prompt, appending your gate check to the history line.",
    ]) {
      const text = released("land #620's startup-entry probe.").replace("- Claim: released", `${loop}\n- Claim: released`);
      const built = successorPrompt(text);
      expect(built.ok, loop).toBe(false);
      expect(built.why).toContain("re-spawn");
    }
  });

  it("refuses a next action that is the owner's", () => {
    for (const next of [
      "Owner applies docs/superpowers/specs/2026-09-29-x.patch.",
      "Kuya runs the live proof on his rig.",
      "wait for the owner’s decision on F1.",
      "the owner-only reboot (A_wmi), then re-run the probe.",
    ]) {
      refused(next);
    }
  });

  it("refuses a next action that only rechecks, polls or re-spawns", () => {
    for (const next of ["re-check #611's state and report.", "poll PR #611 for a change.", "respawn this same prompt."]) {
      refused(next);
    }
  });

  it("still builds the prompt for work a successor can start now", () => {
    for (const next of [
      "non-author review of the PR.",
      "fix the two Codex findings on PR #630, then run the pre-push gate again.",
      "rebase #616 onto main now that #611 has merged, then push.",
      "land PR #630 at head `abc12345` after its Codex PASS.",
      "write the owner patch for the hook registration, with skipIf-gated tests.",
      // A later clause may be gated: the first step is work, and the gate is the successor's to meet.
      "Codex or HQ: review PR #464 at its head, and gate mark-ready and merge. Then the owner applies the patch.",
      "Independent exact-head review of e56c6395 (PR #412) by codex. On PASS, land it once the gate passes.",
    ]) {
      const built = successorPrompt(released(next));
      expect(built.ok, `${next}: ${built.why}`).toBe(true);
    }
  });
});

// Codex review of c1935955: the CLI refuses without --handoff, so an instruction that still says to run
// it bare sends every session following it into the refusal, and invites a hand-written prompt that
// skips the check. Every live instruction has to pass the Handoff. Captured fixtures and receipts quote
// history and are left as written.
describe("successor-route callers (#613)", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const INVOCATION = ["node scripts/", "successor-route", "\\.mjs"].join("");

  it("every tracked instruction to run it passes --handoff", { timeout: TREE_WALK_TIMEOUT_MS }, () => {
    const res = spawnSync(
      "git",
      ["grep", "-n", "-e", INVOCATION, "--", ".", ":!scripts/fixtures/", ":!.claude/work-control/"],
      { cwd: ROOT, encoding: "utf8", windowsHide: true },
    );
    expect(res.status, res.stderr).toBe(0);
    const lines = res.stdout.split("\n").filter(Boolean);
    // The preamble, CLAUDE.md and the context-size advisor at least; fewer means the search went blind.
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const bare = lines.filter((l) => !new RegExp(`${INVOCATION} --handoff\\b`).test(l));
    expect(bare).toEqual([]);
  });
});

describe("successor-route CLI (#613)", () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "successor-route.mjs");
  const dir = mkdtempSync(join(tmpdir(), "successor-route-cli-"));
  // A store root that does not exist, so the route is chip whatever this machine has provisioned.
  const env = { ...process.env, COMPY_ROUTINE_STORE_ROOT: join(dir, "no-store") };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, windowsHide: true });
  const file = (name, text) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const PREAMBLE_START = SUCCESSOR_PREAMBLE.slice(0, 40);

  it("with no --handoff: prints the route, withholds the prompt, exits 1", () => {
    const res = run();
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("route: chip");
    expect(res.stdout).not.toContain(PREAMBLE_START);
    expect(res.stderr).toContain("prompt: refused");
  });

  it("with a handoff that has no Claim line: withholds the prompt, exits 1", () => {
    const res = run("--handoff", file("prose.md", "### Handoff\n- Outcome: This lease is **released**.\n"));
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain(PREAMBLE_START);
    expect(res.stderr).toContain("- Claim: released");
  });

  it("with a --handoff path that cannot be read: withholds the prompt, exits 1", () => {
    const res = run("--handoff", join(dir, "missing.md"));
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain(PREAMBLE_START);
  });

  it("with a releasing Handoff (BOM and CRLF included): prints the preamble then the handoff, exits 0", () => {
    const res = run(
      "--handoff",
      file("ok.md", "\uFEFF### Handoff\r\n- Outcome: done.\r\n- Exact next action: non-author review of PR #626.\r\n- Claim: released\r\n"),
    );
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("route: chip");
    expect(res.stdout).toContain(SUCCESSOR_PREAMBLE);
    expect(res.stdout).toContain("- Claim: released");
  });

  it("with a released Handoff whose next action waits on the owner: withholds the prompt, says Successor: none, exits 1 (#632)", () => {
    const res = run(
      "--handoff",
      file("gated.md", "### Handoff\n- Outcome: done.\n- Exact next action: nothing lands before the owner's proof.\n- Claim: released\n"),
    );
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain(PREAMBLE_START);
    expect(res.stderr).toContain("Successor: none");
  });
});
