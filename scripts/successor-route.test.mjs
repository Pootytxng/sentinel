import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { pickRoute, readLauncherTasks, SUCCESSOR_PREAMBLE } from "./successor-route.mjs";

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
  // #405, 2026-09-18: the repoint used to sit "right after" the Ownership claim. A duplicate
  // successor (epic-cray-fe2842) found a peer holding the lease and stood down without claiming, so
  // it never repointed, and its pin redded the #444 lane's gate. The repoint is folder hygiene. It
  // has its own step, after STEP 0's shared-checkout stop and before the claim decision. It never
  // mentions the claim, and it says that it still applies when the session stands down.
  it("repoints the folder's absolute hooksPath in its own step, before and independent of any claim", () => {
    const steps = SUCCESSOR_PREAMBLE.split(/\n(?=STEP |LAST |TASK:)/);
    const at = (needle) => steps.findIndex((s) => s.includes(needle));
    const repoint = at("git config --worktree core.hooksPath .githooks");
    const claim = at("Ownership claim");
    const sharedStop = at("git rev-parse --show-toplevel");

    expect(repoint).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    expect(repoint).toBeGreaterThan(sharedStop); // never the shared checkout
    expect(repoint).toBeLessThan(claim); // before the claim decision, not after it
    expect(steps[repoint]).not.toMatch(/claim/i); // nothing about claiming gates it
    expect(steps[repoint]).toMatch(/stand(s|ing)? down/i); // still runs when the session stands down
  });

  it("is a non-empty string independent of any live machine state", () => {
    expect(typeof SUCCESSOR_PREAMBLE).toBe("string");
    expect(SUCCESSOR_PREAMBLE.length).toBeGreaterThan(40);
  });
});
