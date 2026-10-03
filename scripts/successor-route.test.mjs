import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { verdictFor } from "../.claude/hooks/session-root-assert.mjs";
import { decideShell, gitIsReadOnly } from "../.claude/hooks/shell-ownership-assert.mjs";
import { ZONES } from "../.claude/hooks/target-ownership.mjs";
import { GIT_SPAWN_TIMEOUT_MS, TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
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

  // #637 gap 1: a session sat in its own worktree, so show-toplevel printed the lane, while its hooks
  // were bound to the shared checkout and refused every write. Only the SessionStart line shows that,
  // so STEP 0 reads it before STEP 1's claim, and stops on it too. Its example must be the text the
  // hook really prints for a bound session, and never text that a lane's own line also contains.
  it("checks the SessionStart line before the claim, quoting what the hook prints when bound", () => {
    const step0 = SUCCESSOR_PREAMBLE.slice(SUCCESSOR_PREAMBLE.indexOf("STEP 0"), SUCCESSOR_PREAMBLE.indexOf("\nSTEP 1 "));
    expect(step0).toContain("SessionStart");
    expect(step0).toContain("#637");
    expect(step0.match(/Write nothing/g)).toHaveLength(3);
    const example = /"(on main in [^"]+)"/.exec(step0)?.[1];
    expect(example).toBeDefined();
    const line = (branch, root) => verdictFor({ ok: true, mode: "verify", issue: 419, branch, root }).message;
    expect(line("main", "C:\\Users\\Kuya\\code\\sentinel")).toContain(example);
    expect(line("claude/lane-a", "C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\lane-a")).not.toContain(example);
  });

  // Review of PR #642: the lines for an unclaimed folder and an unreadable board name no folder, and a
  // new successor's folder is always unclaimed, so (b) cannot rest on the line alone. It falls back to
  // a probe, which the shell hook refuses in a bound session with the sentence quoted here, and lets
  // through for a session rooted in its own folder.
  it("falls back to a probe the shell hook refuses only in a bound session, quoting that refusal", () => {
    const step0 = SUCCESSOR_PREAMBLE.slice(SUCCESSOR_PREAMBLE.indexOf("STEP 0"), SUCCESSOR_PREAMBLE.indexOf("\nSTEP 1 "));
    const probe = /names no folder[^]*?run `([^`]+)` now/.exec(step0)?.[1];
    expect(probe).toBe("git remote prune --dry-run origin");
    const quoted = /"(This session is working in [^"]+)"/.exec(step0)?.[1];
    expect(quoted).toBe("This session is working in C:\\Users\\Kuya\\code\\sentinel,");

    const shared = join(tmpdir(), "compy-fixture", "sentinel");
    const lane = join(shared, ".claude", "worktrees", "lane-a");
    const zone = ({ target, sessionRoot }) =>
      target === sessionRoot
        ? { zone: ZONES.OWN, abs: target, owner: sessionRoot, why: "this session's folder" }
        : { zone: ZONES.SIBLING, abs: target, owner: target, why: "another checkout of this repository" };
    const decide = (sessionRoot) =>
      decideShell({
        toolName: "Bash",
        toolInput: { command: probe },
        sessionRoot,
        cwd: lane,
        zone,
        verify: () => ({ ok: false, code: "FOLDER_UNCLAIMED" }),
      });
    const bound = decide(shared);
    expect(bound.permission).toBe("deny");
    expect(bound.reason).toContain(quoted.replace("C:\\Users\\Kuya\\code\\sentinel", shared));
    expect(decide(lane).permission).toBe("allow");
  });

  // Second review of PR #642: that probe was `git fetch origin`, which writes refs and FETCH_HEAD
  // before STEP 1's claim (docs/WORK_CONTROL.md "Claim before write"). So of the git commands STEP 0
  // names, the only one the shell hook reads as a write is the dry-run probe, and the real fetch is
  // named after the claim.
  it("names no git command that writes before the claim; the real fetch comes after it", () => {
    const step0 = SUCCESSOR_PREAMBLE.slice(SUCCESSOR_PREAMBLE.indexOf("STEP 0"), SUCCESSOR_PREAMBLE.indexOf("\nSTEP 1 "));
    const commands = [...step0.matchAll(/`(git [^`]+)`/g)].map((m) => m[1]);
    expect(commands).toEqual(["git rev-parse --show-toplevel", "git remote prune --dry-run origin"]);
    const readAsWrites = commands.filter((c) => !gitIsReadOnly(c.split(" ").slice(1)));
    expect(readAsWrites).toEqual(["git remote prune --dry-run origin"]);
    expect(SUCCESSOR_PREAMBLE.indexOf("`git fetch origin`")).toBeGreaterThan(SUCCESSOR_PREAMBLE.indexOf("Ownership claim"));
    expect(SUCCESSOR_PREAMBLE.indexOf("`git ls-remote origin`")).toBeGreaterThan(SUCCESSOR_PREAMBLE.indexOf("\nSTEP 1 "));
    expect(gitIsReadOnly(["ls-remote", "origin"])).toBe(true);
  });

  // "It changes nothing" is measured, not assumed. Against an origin that has moved on (a new commit,
  // a new branch, a deleted branch) the probe reports what it would prune and leaves every file in
  // the clone byte-identical. A dry-run fetch does not pass this: it still downloads the new objects.
  it("the probe changes no file in the clone, against an origin that has moved on", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const step0 = SUCCESSOR_PREAMBLE.slice(SUCCESSOR_PREAMBLE.indexOf("STEP 0"), SUCCESSOR_PREAMBLE.indexOf("\nSTEP 1 "));
    const probe = /names no folder[^]*?run `git ([^`]+)` now/.exec(step0)?.[1];
    expect(probe).toBeDefined();

    const root = mkdtempSync(join(tmpdir(), "successor-probe-"));
    // git exports GIT_DIR and friends to hooks, and the pre-push gate runs this suite from one.
    // Inherited, they would aim every command below at the real repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const git = (cwd, ...args) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
        cwd,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    const snapshot = (dir) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name))
        .sort()
        .map((file) => `${file.slice(dir.length)} ${createHash("sha256").update(readFileSync(file)).digest("hex")}`);

    git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
    git(root, "clone", "-q", "origin.git", "writer");
    const writer = join(root, "writer");
    git(writer, "commit", "-q", "--allow-empty", "-m", "base");
    git(writer, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/stale");
    git(root, "clone", "-q", "origin.git", "lane");
    const lane = join(root, "lane");
    writeFileSync(join(writer, "new.txt"), "new\n");
    git(writer, "add", "new.txt");
    git(writer, "commit", "-q", "-m", "origin moves on");
    git(writer, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/fresh", ":refs/heads/stale");

    const before = snapshot(lane);
    expect(before.length).toBeGreaterThan(5);
    const said = git(lane, ...probe.split(" "));
    expect(snapshot(lane)).toEqual(before);
    // It did reach origin and had something to report, so "no change" is not "nothing to do".
    expect(said).toContain("[would prune] origin/stale");
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
      // Codex r4 on e7800a5d: another lane's gate named as a precondition, anywhere in the next action.
      "PR #611 must merge first.",
      "#611 needs to land first.",
      "Blocked: PR #611 must merge first.",
      "Land #620; PR #611 must merge first.",
      "Land #620 — PR #611 (the ETW fix) must merge first.",
      "#583's lease on history.rs must be released first, then land #616.",
      "#611 has yet to merge, then land #620.",
      // Codex r5 on 8d07e495: a quote that is the step itself, not a mention of it, is still read.
      'Follow this step: "wait for #611 to merge".',
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
      // Codex r2 on 1234d58b: completion said without none/nothing.
      "Done — merged as abc12345.",
      "Complete.",
      "All done.",
      "Already merged (PR #626).",
      "Merged as 7dafc402; nothing left.",
      "Landed in d439a5f5.",
      "Work complete - no follow-up.",
      // Codex r3 on 17a33ab4: completion said as a statement about the work.
      "PR #633 is merged.",
      "The work is complete.",
      "#632 is closed as completed.",
      "Everything has been merged.",
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
      // Codex r1 on 0dce538f: the same loop without the words re-spawn or same prompt.
      "- Steps: if #611 is still open, launch this task again.",
      // Codex r2 on 1234d58b: other verbs for the same loop.
      "- Steps: if blocked, run this task again.",
      "- Steps: if #611 is still open, re-run this prompt.",
      "- Steps: if blocked, start this chip again.",
      "- Steps: if blocked, launch a new successor with this prompt.",
      // Codex r3 on 17a33ab4: any inflection of a re- verb, and "keep launching".
      "- Steps: If blocked, keep re-running this task.",
      "- Steps: keep launching this prompt until #611 merges.",
      // Codex r4 on e7800a5d: an apostrophe inside a word does not open a quote around the loop.
      "- Steps: if it's blocked, launch this task again, per the owners' rule.",
      // Codex r5 on 8d07e495: any verb that carries the loop on, and a loop quoted as the instruction.
      "- Steps: Continue re-running this task until #611 merges.",
      "- Steps: carry on re-launching this prompt.",
      "- Steps: keep on re-spawning this chip.",
      "- Steps: continue launching this prompt until #611 merges.",
      "- Steps: If blocked, follow this instruction: `launch this task again`.",
      "- Steps: If blocked, follow this instruction: 'launch this task again'.",
      '- Steps: Run the tests, then follow this instruction: "launch this task again".',
      // A cue word reaches the quote only across "the", "a", "an" or "for": never a colon, a comma or another word.
      "- Steps: if the tests stay red: `re-run this prompt`.",
      '- Steps: if the tests fail again on main, do "launch this task again".',
      // An apostrophe after a cue word does not open a quote that hides the loop.
      "- Steps: note why it's blocked, then launch this task again, per the owners' rule.",
      "- Steps: if the guard's check fails, launch this task again, per the owners' rule.",
      // Codex r6 on d5e43ea9: a cue word in ordinary prose does not hide the instruction after it.
      "- Steps: If blocked, in that case, `launch this task again`.",
      "- Steps: In any case 're-run this prompt'.",
      "- Steps: if the tests fail, `re-run this prompt`.",
      "- Steps: If blocked, document it and `launch this task again`.",
      "- Steps: If it fails the tests, `launch this task again`.",
    ]) {
      const text = released("land #620's startup-entry probe.").replace("- Claim: released", `${loop}\n- Claim: released`);
      const built = successorPrompt(text);
      expect(built.ok, loop).toBe(false);
      expect(built.why).toContain("re-spawn");
    }
  });

  // Codex r1 on 0dce538f: a Handoff that only DESCRIBES the loop it fixed is not an instruction to
  // loop, and its successor has real work.
  it("builds the prompt for a Handoff that only describes a re-spawn loop", () => {
    for (const outcome of [
      "- Outcome: fixed the re-spawn loop.",
      "- Outcome: the #620 chain re-spawned the same prompt six times; the router now refuses it.",
      "- Outcome: stopped the loop where sessions re-sent the same prompt by hand.",
      "- Outcome: sessions kept running this task again after each recheck; the router now refuses it.",
      // Codex r3 on 17a33ab4: a quoted phrase is a mention of the loop, not an instruction to loop.
      '- Outcome: Added a guard for the phrase "launch this task again".',
      "- Outcome: the router now refuses “run this task again”.",
      // Codex r4 on e7800a5d: "kept re-running" is history; a code span or single quotes are a mention.
      "- Outcome: sessions kept re-running this task; the router now refuses it.",
      "- Outcome: Added a guard for the phrase 'launch this task again'.",
      "- Outcome: the docs now explain why `run this task again` looped.",
    ]) {
      const built = successorPrompt(released("Review PR #632.").replace("- Outcome: x.", outcome));
      expect(built.ok, `${outcome}: ${built.why}`).toBe(true);
    }
  });

  it("refuses a next action that is the owner's", () => {
    for (const next of [
      "Owner applies docs/superpowers/specs/2026-09-29-x.patch.",
      "Kuya runs the live proof on his rig.",
      "wait for the owner’s decision on F1.",
      "the owner-only reboot (A_wmi), then re-run the probe.",
      // Codex r2 on 1234d58b: the owner's gate without a possessive or an owner verb.
      "Await owner approval.",
      "Needs owner sign-off before it lands.",
      "Get owner approval for the patch.",
      "awaiting Kuya's go-ahead.",
      // Codex r3 on 17a33ab4: the owner as the source of the gate.
      "Approval from owner is required.",
      "Sign-off from the owner, then merge.",
      "The patch's owner approval is still pending.",
      // Codex r4 on e7800a5d.
      "The patch cannot land without owner approval.",
      "Owner-applied patch: apply it, then delete it.",
    ]) {
      refused(next);
    }
  });

  it("refuses a next action that only rechecks, polls or re-spawns", () => {
    for (const next of [
      "re-check #611's state and report.",
      "poll PR #611 for a change.",
      "respawn this same prompt.",
      // Codex r1 on 0dce538f: the same observation and loop in other words.
      "Check whether PR #611 has merged and report.",
      "see if #583's lease is released yet.",
      "If #611 is still open, launch this task again.",
      "if PR 611 has not merged, stop.",
      // Codex r2 on 1234d58b: the same gate asked the positive way, confirmed, or re-spawned by "run".
      "land #620. If blocked, run this task again.",
      "If PR #611 has merged, land #620.",
      "if #611 merges, land #620.",
      "if #583's lease is released, rebase #616.",
      "Confirm that PR #611 has merged and report.",
      "Make sure #611 has merged, then land #620.",
      "Verify PR #611 merged and report.",
      "Await the Codex review of PR #633.",
      "Await the landing of #611.",
      "Hold: await PR #611 before landing.",
      // Codex r3 on 17a33ab4: other observation verbs.
      "Report whether PR #611 has merged.",
      "Ask whether #583's lease is released.",
      "Watch PR #611 for a merge.",
      // Codex r4 on e7800a5d narrowed recheck to a step or a gate; #129's released Handoff still stops.
      "A fresh session opens issue #129 and rechecks HEAD/status before relying on any claim.",
    ]) {
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
      // Codex r1 on 0dce538f: the later step inside the same sentence is still a later step.
      "Implement X, then the owner applies the patch.",
      "write the probe and its tests, and then Kuya runs it on his rig.",
      "Check whether the new test fails on the old head, then push.",
      "If the gate is red, fix it and push again.",
      // Near misses for the Codex r2 fixes on 1234d58b: same words, startable work.
      "Run the flaky test again at --maxWorkers=4, then push.",
      "Complete the migration of the history.rs readers.",
      "Merge the two receipts into one commit and push.",
      "Done-state copy: rename the Done button to Finish.",
      "Wrap the invoke in an await and cover it with a test.",
      "Implement the Tier 2 off switch per the owner ruling of 2026-08-24.",
      "If the gate passes, push.",
      "Verify the fix from PR #611 is in main, then rebase #616 onto it.",
      "Check that the new test fails on the old head, then push.",
      "Get owner-facing copy reviewed by the web-design-director, then ship it.",
      "Check the claim parser against #611's released Handoff and fix what it misreads.",
      // Near misses for the Codex r3 fixes on 17a33ab4.
      "Rebase #616 onto main, now that PR #611 is merged.",
      "Track #632's receipts in the ledger, then push.",
      "Report the gate result on PR #633, then land it.",
      "Implement the approval flow from the owner patch spec.",
      // Near misses for the Codex r4 fixes on e7800a5d: polling and recheck code, owner-facing work,
      // and "first" for the successor's own step.
      "Owner-facing copy: review and revise the dialog.",
      "Fix the polling backoff and add tests.",
      "Fix the recheck loop and add tests.",
      "Land PR #633 first, then carry the receipts.",
      "Explain in the docs why #611 had to merge first.",
      "Rebase #616 onto main; #616 needs to land before Friday's cut.",
      // Near misses for the Codex r5 fixes on 8d07e495: a gate quoted as what a test or doc is about.
      'Add a regression test for "PR #611 must merge first".',
      'Add a test for "blocked on #611" and fix the parser.',
      "Document the `once #611 merges` wording the router refuses.",
      // Codex r6 on d5e43ea9: the only words a cue reaches across.
      'Add a regression test for a "PR #611 must merge first" line.',
      'Add a test for an "until #611 merges" step.',
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
