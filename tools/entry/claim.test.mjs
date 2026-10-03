// Guards for the only component that writes to Work Control.
//
// The load-bearing refusal: postClaim throws unless it is handed a PASS verdict. A claim is a
// statement that the invariant holds, so a claim that can be posted without a verdict is a claim
// that can describe a state nobody verified — which is exactly the failure mode #14 exposed.
//
// Its twin (#643): a lease is ended only by `postRelease` (tools/entry/release.mjs), and only for the
// folder and branch the live claim names. On 2026-10-03 a session that had already released #637
// posted a second released Handoff eight minutes after its successor claimed, and nothing mechanical
// stopped it. postRelease measures its own seat, the thread, the board and the holding session, so
// the tests below run it against a simulated `gh` and `git` (see `simulate`); every refusal is
// asserted together with the fact that nothing was sent.
//
// Every board mutation goes through a PLAN of `gh` invocations, so the field quirks that cost real
// time are pinned here rather than rediscovered: date fields need `--date` (`--text` fails with
// "Did not receive a date value"), and clearing an expiry needs `--clear`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// The release tests (#643) run the real postRelease against a simulated GitHub and git. `world.on` is
// that simulation while one of them runs and null otherwise. Outside it git is the real git, and a
// `gh` call is an error: nothing in this file may reach GitHub.
const world = vi.hoisted(() => ({ on: null }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const execFileSync = (file, args, options) => {
    if (world.on) return world.on.exec(file, args, options);
    if (file === "gh") throw new Error("claim.test.mjs reached a real gh call outside the simulated world");
    return (actual.default ?? actual).execFileSync(file, args, options);
  };
  return { ...actual, execFileSync, default: { ...actual.default, execFileSync } };
});
vi.mock("./session-assert.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  const simulated =
    (name) =>
    (...args) =>
      world.on ? world.on[name](...args) : actual[name](...args);
  return { ...actual, readLineage: simulated("readLineage"), observeLiveness: simulated("observeLiveness"), invalidateBoardCache: simulated("invalidateBoardCache") };
});

import * as claimModule from "./claim.mjs";
import {
  calendarMs,
  claimExpiry,
  execPlan,
  HANDOFF_HEADER,
  instant,
  parseClaim,
  parseHandoff,
  parseReleaseRecord,
  planPostClaim,
  planRenew,
  postClaim,
  RELEASE_RECORD_HEADER,
  releaseDecision,
  releaseOutcome,
  renderClaim,
  renderHandoff,
  TAKEOVER_HEADER,
  threadLease,
} from "./claim.mjs";
import { readBoard, readProjectIds } from "./gather.mjs";
import * as releaseModule from "./release.mjs";
import { cmdRelease, measureSeat, parseArgs, postRelease } from "./release.mjs";
import { CORRUPT } from "./session-assert.mjs";
import { isValidBranch, samePath } from "./worktree-field.mjs";
import { readClaimCache, writeClaimCache } from "../../scripts/lib/scope-drift.mjs";
import { evaluateWorkControl } from "../../scripts/work-control-gate.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const BRANCH = "feat/single-entry-workflow";

const FACTS = {
  lane: "Claude Code",
  executor: "Claude Code (Opus 5)",
  repository: "Pootytxng/sentinel",
  folder: FOLDER,
  branch: BRANCH,
  scope: "single-entry workflow tooling only",
  started: "2026-07-30",
  expires: "2026-07-31",
  nextAction: "Implement the launcher.",
  processes: [{ name: "compy.exe", count: 1, note: "installed review build from #14" }],
};

const PASS = { verdict: "PASS", checks: [{ name: "git.clean", expected: "clean", actual: "clean", ok: true }] };
const REFUSE = { verdict: "REFUSE", checks: [{ name: "git.clean", expected: "clean", actual: "1 modified", ok: false }] };

const IDS = {
  projectId: "PVT_x",
  itemId: "PVTI_x",
  fields: {
    status: { id: "F_status", options: { Active: "o_active", "Needs Kuya": "o_needs", Review: "o_review" } },
    lane: { id: "F_lane", options: { "Claude Code": "o_cc" } },
    gate: { id: "F_gate", options: { None: "o_none", Kuya: "o_kuya" } },
    worktree: { id: "F_wt" },
    nextAction: { id: "F_next" },
    claimExpires: { id: "F_exp" },
    lastVerified: { id: "F_ver" },
  },
};

// The launcher is the one program `postClaim` and `execPlan` run for (#643 review, rounds 2 and 4):
// both write a board row without reading who holds it, so they refuse every other caller by the
// command line node was started with. Four witnesses: the program the OS handed node (the report's
// command line), the program node ran (`process.argv[1]`), no node flag (`process.execArgv`) and no
// `NODE_OPTIONS`. A test that means to reach their run says so, standing in the launcher's seat for
// that call: all four are arranged, unless `witnesses` says otherwise for one of them.
const LAUNCHER_PATH = join(dirname(fileURLToPath(import.meta.url)), "launch.mjs");
const asProgram = (program, run, witnesses = {}) => {
  const was = { program: process.argv[1], report: process.report.getReport, flags: process.execArgv, options: process.env.NODE_OPTIONS };
  const started = Object.hasOwn(witnesses, "started") ? witnesses.started : program;
  process.argv[1] = program;
  process.report.getReport = Object.hasOwn(witnesses, "report") ? witnesses.report : () => ({ header: { commandLine: [process.execPath, started] } });
  process.execArgv = Object.hasOwn(witnesses, "flags") ? witnesses.flags : [];
  if (witnesses.options === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = witnesses.options;
  try {
    return run();
  } finally {
    process.argv[1] = was.program;
    process.report.getReport = was.report;
    process.execArgv = was.flags;
    if (was.options === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = was.options;
  }
};
const asLauncher = (run, witnesses) => asProgram(LAUNCHER_PATH, run, witnesses);

describe("a claim may not be posted without a verdict", () => {
  it("throws on a REFUSE verdict", () => {
    expect(() => postClaim({ issue: 18, verdict: REFUSE, facts: FACTS, ids: IDS, dryRun: true })).toThrow(/verdict/i);
  });

  it("throws when handed no verdict at all", () => {
    expect(() => postClaim({ issue: 18, facts: FACTS, ids: IDS, dryRun: true })).toThrow(/verdict/i);
    expect(() => postClaim({ issue: 18, verdict: {}, facts: FACTS, ids: IDS, dryRun: true })).toThrow(/verdict/i);
  });

  it("proceeds on PASS", () => {
    const r = asLauncher(() => postClaim({ issue: 18, verdict: PASS, facts: FACTS, ids: IDS, dryRun: true }));
    expect(r.plan.length).toBeGreaterThan(0);
  });
});

describe("the claim block matches the WORK_CONTROL template", () => {
  const body = renderClaim({ ...FACTS, verdict: PASS });

  it.each([
    "### Ownership claim",
    "- Lane:",
    "- Executor/tool:",
    "- Repository:",
    "- Worktree folder:",
    "- Branch:",
    "- Write scope:",
    "- Started:",
    "- Claim expires:",
    "- Next action:",
    "- Active build/install/helper processes:",
  ])("carries %s", (field) => {
    expect(body).toContain(field);
  });

  it("states the measured facts, not placeholders", () => {
    expect(body).toContain(FOLDER);
    expect(body).toContain(BRANCH);
    expect(body).toMatch(/compy\.exe/);
  });

  it("carries the verdict that licensed it, so the claim is auditable", () => {
    expect(body).toMatch(/PASS/);
    expect(body).toMatch(/git\.clean/);
  });

  it("says `none` for processes rather than omitting the line", () => {
    expect(renderClaim({ ...FACTS, processes: [], verdict: PASS })).toMatch(/processes: none/i);
  });
});

describe("round-tripping a claim off the issue", () => {
  it("parses back what it rendered", () => {
    const parsed = parseClaim(renderClaim({ ...FACTS, verdict: PASS }));
    expect(parsed).toMatchObject({ lane: "Claude Code", folder: FOLDER, branch: BRANCH, expires: "2026-07-31" });
  });

  it("returns null for a comment that is not a claim", () => {
    expect(parseClaim("just a normal comment")).toBeNull();
  });

  it("reads the bold-bullet and two-column-table forms other writers post by hand", () => {
    // #224's claim (2026-09-01) was a table. It parsed as a claim with no fields — and under #358 a
    // live writer with no readable scope is a refusal the other side cannot cure.
    const table = [
      "### Ownership claim — exclusive write owner, issue #224",
      "",
      "| field | value |",
      "|---|---|",
      "| **writer** | Claude Code session `sentinel-63` |",
      "| **worktree** | `C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\compy-visual-recovery-kit-6fd074` |",
      "| **branch** | `claude/compy-visual-recovery-kit-6fd074` |",
      "| **head at claim** | `cdd976f3` |",
      "| **expiry** | 2026-09-02T12:00:00Z |",
    ].join("\n");
    expect(parseClaim(table)).toMatchObject({
      executor: "Claude Code session `sentinel-63`",
      folder: "C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\compy-visual-recovery-kit-6fd074",
      branch: "claude/compy-visual-recovery-kit-6fd074",
      expires: "2026-09-02T12:00:00Z",
      scope: null,
      lane: null,
    });
    const bold = "### Ownership claim\n- **Lane:** Codex\n- **Write scope**: `scripts/x.mjs`, `docs/`\n- **Claim expires:** 2026-09-03\n";
    expect(parseClaim(bold)).toMatchObject({ lane: "Codex", scope: "`scripts/x.mjs`, `docs/`", expires: "2026-09-03" });
  });
});

describe("claimExpiry — the expiry as writers actually spell it", () => {
  it("reads a date, a timestamp, and either with prose after it", () => {
    expect(claimExpiry("2026-09-03").toISOString()).toBe("2026-09-03T23:59:59.000Z");
    expect(claimExpiry("2026-09-02T04:55Z (12 hours)").toISOString()).toBe("2026-09-02T04:55:00.000Z");
    expect(claimExpiry("2026-09-02T12:00:00Z").toISOString()).toBe("2026-09-02T12:00:00.000Z");
    expect(claimExpiry("2026-08-03 (12-hour alarm; no automatic takeover)").toISOString()).toBe("2026-08-03T23:59:59.000Z");
  });

  it("is null, never a guess, for anything else — a claim stays live until its expiry is read as past", () => {
    expect(claimExpiry(null)).toBeNull();
    expect(claimExpiry("next Tuesday")).toBeNull();
  });

  // Round 5 of the review of PR 644: `new Date("2026-02-30")` is March 2, so an expiry written on a day
  // that is not on the calendar was read as another day's. The fields are read back off the calendar
  // as written, and a zone, when one is written, is taken off the wall-clock reading.
  it.each(["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-01-32", "2100-02-29"])("is null for a day that is not on the calendar: %s", (day) => {
    expect(claimExpiry(day)).toBeNull();
    expect(claimExpiry(`${day}T05:22Z`)).toBeNull();
    expect(claimExpiry(`${day}T05:22:01Z (12 hours)`)).toBeNull();
  });

  it.each(["2026-10-03T24:00Z", "2026-10-03T23:60Z", "2026-10-03T23:59:60Z", "2026-10-03T24:00:00Z"])("is null for a time that is not on the clock: %s", (time) => {
    expect(claimExpiry(time)).toBeNull();
  });

  it("takes a written zone off the wall-clock time, reads none as UTC, and refuses a zone that is not one", () => {
    expect(claimExpiry("2026-10-03T07:22:01+02:00").toISOString()).toBe("2026-10-03T05:22:01.000Z");
    expect(claimExpiry("2026-10-03T00:22:01-05:00").toISOString()).toBe("2026-10-03T05:22:01.000Z");
    expect(claimExpiry("2026-10-03T00:22-0500").toISOString()).toBe("2026-10-03T05:22:00.000Z");
    expect(claimExpiry("2026-10-03T05:22:01").toISOString()).toBe("2026-10-03T05:22:01.000Z");
    expect(claimExpiry("2026-10-03T07:22:01+25:00")).toBeNull();
    expect(claimExpiry("2026-10-03T07:22:01+02:60")).toBeNull();
  });

  it("anchors a relative expiry on an instant it can read, and on nothing else", () => {
    expect(claimExpiry("12 hours", { anchor: "2026-10-03T05:22:01Z" }).toISOString()).toBe("2026-10-03T17:22:01.000Z");
    expect(claimExpiry("12 hours", { anchor: new Date("2026-10-03T05:22:01Z") }).toISOString()).toBe("2026-10-03T17:22:01.000Z");
    expect(claimExpiry("2 days", { anchor: "2026-10-03T05:22:01Z" }).toISOString()).toBe("2026-10-05T05:22:01.000Z");
    expect(claimExpiry("12 hours", { anchor: "2026-02-30T05:22:01Z" }), "a day off the calendar anchors nothing").toBeNull();
    expect(claimExpiry("12 hours", { anchor: "2026-10-03" }), "a date alone is not an instant").toBeNull();
    expect(claimExpiry("12 hours", { anchor: new Date(Number.NaN) })).toBeNull();
    expect(claimExpiry("12 hours")).toBeNull();
  });
});

// Round 5 of the review of PR 644 (round 4's third finding): `Date.parse` reads 2026-02-30T05:22:01Z as
// March 2, February 29 off a leap year as March 1, April 31 as May 1 and a 24th hour as the next day.
// On c5a085bd a claim stamped on a day that is not on the calendar was read as posted on another, its
// default clock run out from there, and a takeover admitted. A stamp names an instant only when its
// fields come back off the calendar as written.
describe("instant: a posting time names an instant only when it is on the calendar", () => {
  const ROLLED = ["2026-02-30T05:22:01Z", "2026-02-29T05:22:01Z", "2026-04-31T05:22:01Z", "2026-10-03T24:00:00Z", "2100-02-29T00:00:00Z"];
  const OFF = ["2026-13-01T05:22:01Z", "2026-00-10T05:22:01Z", "2026-01-00T05:22:01Z", "2026-01-32T05:22:01Z", "2026-10-03T23:60:00Z", "2026-10-03T23:59:60Z"];

  it.each(ROLLED)("names no instant for %s, which Date.parse rolls over into a day it does not name", (stamp) => {
    expect(Number.isFinite(Date.parse(stamp)), "the premise: Date.parse takes this stamp").toBe(true);
    expect(instant(stamp)).toBeNaN();
  });

  it.each(OFF)("names no instant for %s", (stamp) => {
    expect(instant(stamp)).toBeNaN();
  });

  it.each(["2024-02-29T05:22:01Z", "2000-02-29T00:00:00Z", "2026-12-31T23:59:59Z", "2026-01-01T00:00:00Z", "2026-10-03T05:22:01.123Z"])("reads %s as Date.parse does", (stamp) => {
    expect(Number.isFinite(instant(stamp))).toBe(true);
    expect(instant(stamp)).toBe(Date.parse(stamp));
  });

  it("reads a fraction to the millisecond, as Date.parse does, and a stamp through blank space around it", () => {
    expect(instant("2026-10-03T05:22:01.1Z")).toBe(Date.parse("2026-10-03T05:22:01.100Z"));
    expect(instant("2026-10-03T05:22:01.1234567Z")).toBe(Date.parse("2026-10-03T05:22:01.123Z"));
    expect(instant(" 2026-10-03T05:22:01Z\n")).toBe(Date.parse("2026-10-03T05:22:01Z"));
  });

  it("calendarMs rolls nothing over, and names no instant for a field that is not a whole number", () => {
    expect(calendarMs("2026", "03", "02", "05", "22", "01")).toBe(Date.UTC(2026, 2, 2, 5, 22, 1));
    expect(calendarMs("2026", "02", "30", "05", "22", "01")).toBeNaN();
    expect(calendarMs("2026", "10", "03", "05", "22", "01", "5")).toBe(Date.UTC(2026, 9, 3, 5, 22, 1, 500));
    expect(calendarMs("2026", "1x", "03", "05", "22", "01")).toBeNaN();
    expect(calendarMs("2026", "10", "03", "05", "22", "1.5")).toBeNaN();
  });
});

describe("the handoff, and guard 7's other half", () => {
  const body = renderHandoff({
    outcome: "Reconciler landed.",
    files: "beca0e5",
    verification: "128 tests green",
    remaining: "launcher",
    gates: "none",
    worktreeState: "clean",
    processes: "none",
    nextAction: "Write the launcher.",
    claim: "released",
  });

  it("carries every WORK_CONTROL handoff field", () => {
    for (const f of ["### Handoff", "- Outcome:", "- Files/commits/PR:", "- Verification:", "- Remaining work:", "- Gates or owner actions:", "- Worktree state:", "- Active processes:", "- Exact next action:", "- Claim:"]) {
      expect(body).toContain(f);
    }
  });

  it("parses the exact next action back out — the value guard 7 compares against", () => {
    expect(parseHandoff(body).nextAction).toBe("Write the launcher.");
    expect(parseHandoff(body).released).toBe(true);
  });

  it("returns null for a comment that is not a handoff", () => {
    expect(parseHandoff("### Ownership claim\n- Lane: Codex")).toBeNull();
  });
});

// #411: the work-control gate asks one question of an issue thread before a close (is a lease still
// live?) and answers it through this fold, the same one gather.readIssueThread uses, so the two
// cannot disagree. Each case is the shape of a real comment found by reading all 840 comments in the
// repository on 2026-09-10.
describe("threadLease: is a lease still live on this thread?", () => {
  const at = (createdAt, ...lines) => ({ createdAt, body: lines.join("\n") });
  const CLAIM = at("2026-09-10T06:41:51Z", "### Ownership claim", "- Lane: Claude Code", "- Write scope: `src-tauri/src/race_seam.rs`");
  const RELEASE = at("2026-09-10T07:52:00Z", "### Handoff", "- Exact next action: none", "- Claim: released");

  it("reads the newest claim as live until a newer handoff releases it", () => {
    expect(threadLease([CLAIM]).claim).toMatchObject({ lane: "Claude Code", postedAt: "2026-09-10T06:41:51Z" });
    expect(threadLease([CLAIM, RELEASE]).claim).toBeNull();
    expect(threadLease([RELEASE, { ...CLAIM, createdAt: "2026-09-10T08:00:00Z" }]).claim).not.toBeNull();
    expect(threadLease([]).claim).toBeNull();
  });

  it.each(["- Claim: transferred to codex until 2026-09-11T08:00Z", "- Claim: renewed until 2026-08-04.", "- Outcome: merged"])(
    "keeps the lease live after a handoff whose last line is %j",
    (last) => {
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", "### Handoff", last)]).claim).not.toBeNull();
    },
  );

  it("does not read a HELD lease as released because its Claim line mentions the release (#399, #407)", () => {
    const held = at("2026-09-10T07:52:00Z", "### Handoff", "- Claim: **HELD.** Comment `IC_x`, scope unchanged. Released only when a review verdict lands.");
    expect(parseHandoff(held.body).released).toBe(false);
    expect(threadLease([CLAIM, held]).claim).not.toBeNull();
  });

  it.each(["released", "Released.", "**released.**", "RELEASED** by Cowork.", "Released 2026-09-03; lane complete.", "`released`"])(
    "reads a release as writers spell it: %s",
    (value) => {
      expect(parseHandoff(`### Handoff\n- Claim: ${value}`).released).toBe(true);
    },
  );

  it("does not count a sentence that merely mentions a header as a lease event", () => {
    // #283's close comment (2026-09-10T07:50:16Z) named the Handoff still to come. It is not one.
    const mention = at("2026-09-10T07:50:16Z", "Closing. The lease stays held until the carrier lands. Then the `### Handoff` and Done follow.");
    expect(parseHandoff(mention.body)).toBeNull();
    // #408 and #409 (2026-09-09) retold "a fresh **`### Ownership claim`**" after the lease was released.
    const retelling = at("2026-09-10T08:00:00Z", "The measurements that licensed it, followed by a fresh **`### Ownership claim`** (20:43).");
    expect(parseClaim(retelling.body)).toBeNull();
    expect(threadLease([CLAIM, RELEASE, retelling]).claim).toBeNull();
  });

  it("still reads a header that opens its line after a byte-order mark, or carries a suffix (#49)", () => {
    expect(parseClaim("\uFEFF### Ownership claim\n- Lane: Codex")).toMatchObject({ lane: "Codex" });
    expect(parseHandoff("### Handoff — Phase B step 3 complete\n- Claim: released.").released).toBe(true);
  });

  it("reads a claim and a release in one comment as a live lease: the release has to come after", () => {
    const both = at("2026-09-10T07:52:00Z", "### Handoff", "- Claim: released", "", "### Ownership claim", "- Lane: Codex");
    expect(threadLease([both]).claim).not.toBeNull();
  });

  // HQ review 5165670535 on e56c6395, finding 2: comparing the newest claim with the newest handoff let
  // a later Handoff that says nothing of the claim bring a released one back. The thread is folded
  // once, in posting order, one transition per comment.
  describe("folded in posting order: a release holds until a new claim", () => {
    const LATER = at("2026-09-10T08:10:00Z", "### Handoff", "- Outcome: review requested", "- Exact next action: independent review");
    const RECLAIM = at("2026-09-10T08:20:00Z", "### Ownership claim", "- Lane: Codex", "- Write scope: `docs/`");

    it("claim: live; release: none; a handoff that does not release: still none; a new claim: live", () => {
      expect(threadLease([CLAIM]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(threadLease([CLAIM, RELEASE]).claim).toBeNull();
      expect(threadLease([CLAIM, RELEASE, LATER]).claim).toBeNull();
      expect(threadLease([CLAIM, RELEASE, LATER, RECLAIM]).claim).toMatchObject({ lane: "Codex", postedAt: RECLAIM.createdAt });
    });

    it("still reports the newest handoff, released or not: guard 7 reads its next action", () => {
      expect(threadLease([CLAIM, RELEASE, LATER]).handoff).toMatchObject({ nextAction: "independent review", released: false, postedAt: LATER.createdAt });
    });

    it.each(["transferred to codex until 2026-09-11T08:00Z", "**HELD.** Scope unchanged. Released only when a review verdict lands."])(
      "keeps the lease through a handoff that preserves it (%s), and through a later one that says nothing, until a release",
      (kept) => {
        const hold = at("2026-09-10T07:52:00Z", "### Handoff", `- Claim: ${kept}`);
        const release = { ...RELEASE, createdAt: "2026-09-10T08:30:00Z" };
        expect(threadLease([CLAIM, hold]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
        expect(threadLease([CLAIM, hold, LATER]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
        expect(threadLease([CLAIM, hold, LATER, release]).claim).toBeNull();
      },
    );

    // #517: the push-time overlap gate dates a held path from the run, not the newest comment, so a
    // refresh cannot reset a lane's seniority and a release must end the run with the lease.
    it("returns the run since the last release, oldest first, ending in the live claim", () => {
      const REFRESH = at("2026-09-10T07:00:00Z", "### Ownership claim", "- Lane: Claude Code", "- Write scope: `src-tauri/src/race_seam.rs`, `docs/`");
      const lease = threadLease([CLAIM, REFRESH]);
      expect(lease.run.map((c) => c.postedAt)).toEqual([CLAIM.createdAt, REFRESH.createdAt]);
      expect(lease.run.at(-1)).toBe(lease.claim);
      expect(threadLease([CLAIM, RELEASE]).run).toEqual([]);
      expect(threadLease([CLAIM, RELEASE, LATER, RECLAIM]).run.map((c) => c.postedAt)).toEqual([RECLAIM.createdAt]);
      expect(threadLease([]).run).toEqual([]);
    });

    it("carries the claim comment's url when the reader supplied one, and invents none when it did not", () => {
      const url = "https://github.com/Pootytxng/sentinel/issues/1#issuecomment-1";
      expect(threadLease([{ ...CLAIM, url }]).claim).toMatchObject({ url });
      expect(threadLease([CLAIM]).claim).not.toHaveProperty("url");
    });
  });

  // HQ review 5165670535 on e56c6395, finding 1: a line-start regex read a release quoted inside fenced
  // code as a real one, and let a close through while the claim above it was live.
  describe("an example is not an event: nothing inside fenced code or an HTML comment is read", () => {
    const HANDOFF_EXAMPLE = ["The release will read:", "", "```text", "### Handoff", "- Exact next action: none", "- Claim: released", "```"];
    const CLAIM_EXAMPLE = ["WORK_CONTROL's template, for the next writer:", "", "```text", "### Ownership claim", "- Lane: <coordination label; informational>", "- Write scope: <exact paths/globs>", "```"];

    it("parseHandoff does not recognize a fenced Handoff example", () => {
      expect(parseHandoff(HANDOFF_EXAMPLE.join("\n"))).toBeNull();
    });

    it("parseClaim does not recognize a fenced Ownership claim example", () => {
      expect(parseClaim(CLAIM_EXAMPLE.join("\n"))).toBeNull();
    });

    it("threadLease keeps the genuine claim before the example live, and raises no claim from one", () => {
      const lease = threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...HANDOFF_EXAMPLE)]);
      expect(lease.claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(lease.handoff).toBeNull();
      expect(threadLease([CLAIM, RELEASE, at("2026-09-10T08:00:00Z", ...CLAIM_EXAMPLE)]).claim).toBeNull();
    });

    it("reads a genuine block's own fields, not the example it quotes", () => {
      const held = ["### Handoff", "- Outcome: held for review", "When the lease ends, this line reads:", "```", "- Claim: released", "```", "- Claim: transferred to codex until 2026-09-11T08:00Z"];
      expect(parseHandoff(held.join("\n")).released).toBe(false);
      const claim = ["### Ownership claim", "~~~", "- Lane: <coordination label>", "~~~", "- Lane: Claude Code"];
      expect(parseClaim(claim.join("\n")).lane).toBe("Claude Code");
    });

    // The contexts it models, each read the way CommonMark 0.31 renders it.
    it.each([
      ["a tilde fence", ["~~~", "### Handoff", "- Claim: released", "~~~"]],
      ["a fence indented three spaces", ["   ```", "### Handoff", "- Claim: released", "   ```"]],
      ["a fence a shorter run cannot close", ["````md", "```", "### Handoff", "- Claim: released", "```", "````"]],
      ["a fence the other character cannot close", ["```", "~~~", "### Handoff", "- Claim: released", "```"]],
      ["a fence never closed, which runs to the end of the comment", ["```text", "### Handoff", "- Claim: released"]],
      ["an HTML comment, which renders as nothing at all", ["<!--", "### Handoff", "- Claim: released", "-->"]],
      ["a tab's indentation, which makes it indented code", ["\t### Handoff", "- Claim: released"]],
    ])("reads no Handoff inside %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    // And what it must not over-read: hiding a genuine claim would let a close through.
    it.each([
      ["after a closed fence", ["```", "npm test", "```", "### Ownership claim", "- Lane: Codex"]],
      ["after a one-line HTML comment", ["<!-- claim below -->", "### Ownership claim", "- Lane: Codex"]],
      ["after three backticks whose info string holds a backtick: inline code, not a fence", ["```js``` opened the example", "### Ownership claim", "- Lane: Codex"]],
      ["after three backticks indented four spaces: indented code, not a fence", ["    ```", "### Ownership claim", "- Lane: Codex"]],
    ])("still reads a claim %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });
  });

  // HQ review 5167660647 on 3ce1beb9: a raw HTML block is not Markdown either, and a release quoted in
  // a `<pre>` still released the claim above it. Every shape below was rendered by GitHub's own
  // /markdown endpoint on 2026-09-10, and each expectation is what that page showed, except the ones
  // named at the end: each of those fails closed, and says so.
  describe("an example is not an event: nothing inside a raw HTML block is read", () => {
    const PRE_EXAMPLE = ["The release will read:", "", "<pre>", "### Handoff", "- Exact next action: none", "- Claim: released", "</pre>"];
    const H = ["### Handoff", "- Claim: released"];
    const C = ["### Ownership claim", "- Lane: Codex"];

    it("parseHandoff does not recognize a Handoff inside a <pre> block", () => {
      expect(parseHandoff(PRE_EXAMPLE.join("\n"))).toBeNull();
    });

    it("threadLease keeps the genuine claim before the example live", () => {
      const lease = threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...PRE_EXAMPLE)]);
      expect(lease.claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(lease.handoff).toBeNull();
      // The review's own shape. At 3ce1beb9 its claim survived only because a comment is read release
      // first, and the example still stood as the thread's newest Handoff.
      const own = threadLease([at("2026-09-10T06:41:51Z", "### Ownership claim", "- Lane: Claude Code", "", "<pre>", ...H, "</pre>")]);
      expect(own.claim).toMatchObject({ lane: "Claude Code" });
      expect(own.handoff).toBeNull();
    });

    it("still reads a genuine Handoff after the block, in the same comment or a later one", () => {
      const same = [...PRE_EXAMPLE, "", "### Handoff", "- Exact next action: independent review", "- Claim: released"];
      expect(parseHandoff(same.join("\n"))).toMatchObject({ nextAction: "independent review", released: true });
      const lease = threadLease([CLAIM, at("2026-09-10T07:51:00Z", ...PRE_EXAMPLE), RELEASE]);
      expect(lease.claim).toBeNull();
      expect(lease.handoff).toMatchObject({ postedAt: RELEASE.createdAt, released: true });
    });

    it("raises no claim from a <pre> example, and does not revive a released lease with one", () => {
      const example = ["WORK_CONTROL's template:", "", "<pre>", "### Ownership claim", "- Lane: <coordination label>", "</pre>"];
      expect(parseClaim(example.join("\n"))).toBeNull();
      expect(threadLease([CLAIM, RELEASE, at("2026-09-10T08:00:00Z", ...example)]).claim).toBeNull();
    });

    // Every kind the renderer starts, by GitHub's list of tags: `<textarea>` and `<source>` are on it,
    // `<search>` is not, and a declaration needs a capital letter.
    it.each([
      ["a <pre> never closed, which runs to the end", ["<pre>", ...H]],
      ["a <PRE> with attributes", ['<PRE class="x">', ...H, "</PRE>"]],
      ["a <textarea>, across a blank line", ["<textarea>", "x", "", ...H, "</textarea>"]],
      ["a <script>", ["<script>", ...H, "</script>"]],
      ["a <style>", ["<style>", ...H, "</style>"]],
      ["a <pre> that interrupts a paragraph", ["Example:", "<pre>", ...H, "</pre>"]],
      ["a <pre> indented three spaces", ["   <pre>", ...H, "</pre>"]],
      ["a <pre> indented two spaces, which a less indented line does not end", ["  <pre>", ...H, "</pre>"]],
      ["a processing instruction", ["<?php", ...H, "?>"]],
      ["a declaration", ["<!EXAMPLE", ...H, ">"]],
      ["CDATA", ["<![CDATA[", ...H, "]]>"]],
      ["a <details> with no blank line after it", ["<details>", "<summary>Example</summary>", ...H, "</details>"]],
      ["a <div>", ["<div>", ...H, "</div>"]],
      ["a <DIV>", ["<DIV>", ...H]],
      ["a closing </div>", ["</div>", ...H]],
      ["a <source>", ['<source src="x">', ...H]],
      ["a <div> that interrupts a paragraph", ["Example:", "<div>", ...H]],
      ["a lone open tag", ["<code>", ...H, "</code>"]],
      ["a lone tag with attributes", ['<a href="https://example.com" title=\'x\'>', ...H]],
      ["a lone closing tag", ["</span>", ...H]],
      ["a lone self-closing tag", ["<br/>", ...H]],
      ["a lone custom element", ["<my-tag>", ...H]],
      ["a lone tag whose name only starts like pre", ["<prefix>", ...H]],
      ["a lone tag after a blank line", ["Example:", "", "<span>", ...H]],
      ["a lone tag after a heading", ["### Notes", "<span>", ...H]],
      ["a lone tag after closed fenced code", ["```", "x", "```", "<span>", ...H]],
      ["a lone tag after indented code", ["    code", "<span>", ...H]],
      ["a lone tag after a setext heading", ["Notes", "---", "<span>", ...H]],
      ["a lone tag after an empty list item", ["-", "<span>", ...H]],
      ["a lone tag after a list item's lazy line", ["- item", "lazy text", "<br>", ...H]],
      ["a lone tag after a loose list item", ["- item", "", "  more", "<br>", ...H]],
      ["a lone tag after a quote's lazy line", ["> quoted", "lazy", "<br>", ...H]],
      ["a lone tag after a table", ["| a | b |", "|---|---|", "| x | y |", "<span>", ...H]],
      ["a lone tag indented less than its ordered item", ["1. item", "  <br>", ...H]],
      ["a lone tag after a footnote definition", ["Text[^1]", "", "[^1]: note", "<br>", ...H]],
      ["a lone tag after a footnote definition's lazy line", ["Text[^1]", "", "[^1]: note", "lazy", "<br>", ...H]],
      ["a lone tag after a footnote definition that interrupts a paragraph", ["Text[^1]", "[^1]: note", "<br>", ...H]],
    ])("reads no Handoff inside %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it.each([
      ["after a closed <pre>", ["<pre>", "x", "</pre>", ...H]],
      ["after a one-line <pre>", ["<pre>x</pre>", ...H]],
      ["after a <pre> that ends mid-line", ["<pre>", "x</pre> tail", ...H]],
      ["after a <pre> ended by another tag of its kind", ["<pre>", "x", "</textarea>", ...H]],
      ["after a <div> ended by a blank line", ["<div>", "x", "", ...H]],
      ["after a <div> ended by a line of spaces", ["<div>", "   ", ...H]],
      ["after a lone tag ended by a blank line", ["<span>", "x", "", ...H]],
      ["after a closed declaration", ["<!EXAMPLE", "x", ">", ...H]],
      ["after a closed processing instruction", ["<?x", "?>", ...H]],
      ["after closed CDATA", ["<![CDATA[", "x", "]]>", ...H]],
      ["after a one-line declaration", ["<!DOCTYPE html>", ...H]],
      ["after `<!` and a lowercase letter, not a declaration here", ["<!example", ...H, ">"]],
      ["after a paragraph, which a lone tag cannot interrupt", ["Taking this over.", "<br>", ...H]],
      ["after a paragraph and <search>, only a lone tag here", ["Text", "<search>", ...H]],
      ["after a tag with text after it", ["<span> text", ...H]],
      ["after an unfinished tag", ['<a href="x"', ...H]],
      ["after a tag indented four spaces: indented code", ["    <span>", ...H]],
      ["after a <pre> closed inside its list item", ["- Example:", "  <pre>", "  x", "  </pre>", ...H]],
      ["that ends a list item holding a <pre>", ["- <pre>", "### Handoff", "- Claim: released", "</pre>"]],
      ["after a link reference definition, which a lone tag cannot interrupt", ["[x]: https://example.com", "<br>", ...H]],
    ])("still reads a Handoff %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toMatchObject({ released: true });
    });

    it.each([
      ["a <details> with no blank line after it", ["<details>", "<summary>Old claim</summary>", ...C, "</details>"]],
      ["a lone </pre>", ["</pre>", ...C]],
      ["a lone tag after a list item", ["- Taking this over.", "<br>", ...C]],
      ["a lone tag after a quote", ["> quoted", "<br>", ...C]],
      ["a <pre> indented two spaces, which a less indented line does not end", ["  <pre>", ...C, "</pre>"]],
      ["a lone tag after a footnote definition", ["Text[^1]", "", "[^1]: note", "<br>", ...C]],
      ["a lone tag after a footnote definition that interrupts a paragraph", ["Text[^1]", "[^1]: note", "<br>", ...C]],
    ])("reads no claim inside %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toBeNull();
    });

    // And what it must not over-read: hiding a genuine claim would let a close through.
    it.each([
      ["after a closed <pre>", ["<pre>", "npm test", "</pre>", ...C]],
      ["after a one-line <pre>", ["<pre>npm test</pre>", ...C]],
      ["after a <pre> that ends mid-line", ["<pre>", "x</pre> tail", ...C]],
      ["after a <details> block ended by a blank line", ["<details>", "", ...C, "", "</details>"]],
      ["after a lone tag ended by a blank line", ["<br>", "", ...C]],
      ["after a paragraph, which a lone tag cannot interrupt", ["Taking this over.", "<br>", ...C]],
      ["after a paragraph whose next line only looks like a list item", ["Text", "*", "<br>", ...C]],
      ["after a paragraph whose next line only looks like an ordered item", ["Text", "2. x", "<br>", ...C]],
      ["after a paragraph and <search>, only a lone tag here", ["Text", "<search>", ...C]],
      ["after a tag with text after it", ["<span> text", ...C]],
      ["after an unfinished tag", ['<a href="x"', ...C]],
      ["after a <pre> indented four spaces: indented code", ["    <pre>", ...C]],
      ["after a sentence that mentions <pre>", ["See <pre> below", ...C]],
      ["after `<!` and a lowercase letter", ["<!example", ...C, ">"]],
      ["after a lone tag indented into its list item's paragraph", ["- item", "  <br>", ...C]],
      ["after an unclosed <pre> inside a list item, which the item's end closes", ["- Example:", "  <pre>", "  x", ...C]],
      ["after a <div> inside a list item", ["- x", "  <div>", "  y", ...C]],
      ["after a <div> on a list item's own line", ["- <div>", ...C]],
      ["after a list, a blank line and a paragraph", ["- item", "", "Text", "<br>", ...C]],
      ["after an empty list item and a paragraph", ["-", "Text", "<br>", ...C]],
    ])("still reads a claim %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });

    // Where the renderer's reading turns on list or table context this module does not track, a Handoff
    // is read as hidden and a claim as shown: a mistake keeps a lease live, never ends one. A Handoff
    // header counts only at the start of its line, where no list item can hold it.
    it.each([
      ["a <pre> opened on a list item's line", ["- <pre>", "  ### Handoff", "- Claim: released"]],
      ["a <pre> indented under a list item", ["- Example:", "  <pre>", "  ### Handoff", "- Claim: released"]],
      ["a <pre> indented four spaces under a list item", ["- x", "    <pre>", "  ### Handoff", "- Claim: released"]],
      ["a fence opened on a list item's line", ["- ```", "  ### Handoff", "- Claim: released"]],
    ])("reads no Handoff inside %s, which only a list item's indentation puts there", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it.each([
      ["an indented header", ["  ### Handoff", "- Claim: released"]],
      ["a lone tag indented into its list item's paragraph", ["- item", "  <br>", ...H]],
      ["a lone tag indented into its ordered item's paragraph", ["1. item", "   <br>", ...H]],
    ])("reads no Handoff after %s, though GitHub shows one: the lease stays live", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it("still reads an indented claim header, and a claim GitHub hides after a table: the lease holds", () => {
      expect(parseClaim(["  ### Ownership claim", "- Lane: Codex"].join("\n"))).toMatchObject({ lane: "Codex" });
      expect(parseClaim(["| a | b |", "|---|---|", "| x | y |", "<br>", ...C].join("\n"))).toMatchObject({ lane: "Codex" });
    });
  });

  // HQ review 5171061412 on c71c6d3c: a fence left open inside a list item hid a genuine claim after the
  // item to the end of the comment, though GitHub ends the fence with the item. Every shape below was
  // rendered by GitHub's /markdown endpoint on 2026-09-10, and each expectation is what that page showed,
  // except the ones named at the end: each of those fails closed, and says so.
  describe("a block left open inside a list item ends with the item", () => {
    const ITEM_FENCE = ["- Example:", "  ```", "  npm test"];
    const H = ["### Handoff", "- Claim: released"];
    const C = ["### Ownership claim", "- Lane: Codex"];

    it("parseClaim reads a genuine claim after a fence left open inside a list item", () => {
      expect(parseClaim([...ITEM_FENCE, ...C].join("\n"))).toMatchObject({ lane: "Codex" });
    });

    it("threadLease reads that claim as live, and after a release as a new lease", () => {
      const claim = at("2026-09-10T08:00:00Z", ...ITEM_FENCE, ...C);
      expect(threadLease([claim]).claim).toMatchObject({ lane: "Codex", postedAt: claim.createdAt });
      expect(threadLease([CLAIM, RELEASE, claim]).claim).toMatchObject({ lane: "Codex", postedAt: claim.createdAt });
    });

    it("reads no Handoff still inside that fence, so the claim before it stays live", () => {
      const inside = ["- Example:", "  ```", "  ### Handoff", "  - Claim: released"];
      expect(parseHandoff(inside.join("\n"))).toBeNull();
      const lease = threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...inside)]);
      expect(lease.claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(lease.handoff).toBeNull();
    });

    it.each([
      ["after a tilde fence", ["- Example:", "  ~~~", "  x", ...C]],
      ["after a fence left open in an ordered item", ["1. Run:", "   ```", "   x", ...C]],
      ["after a fence with an info string", ["- Example:", "  ```sh", "  x", ...C]],
      ["after a blank line inside the fence", ["- Example:", "  ```", "  x", "", ...C]],
      ["after a fence left open in an outer item, under a nested one", ["- a", "  - b", "  ```", "  x", ...C]],
      ["indented one space, short of the item's text", ["- Example:", "  ```", "  x", " ### Ownership claim", "- Lane: Codex"]],
      ["after a closer indented three past the item's text", ["- Example:", "  ```", "  x", "     ```", "  ### Ownership claim", "- Lane: Codex"]],
      ["after a fence indented past the item's text, closed there", ["- Example:", "   ```", "  x", "   ```", "   ### Ownership claim", "- Lane: Codex"]],
      ["after a line that only looks like its closer, four past the item's text", ["- Example:", "   ```", "  x", "      ```", "   ```", "   ### Ownership claim", "- Lane: Codex"]],
      ["after a fence under an ordered item's number, short of its text: a top-level fence, closed", ["1. Run this:", "  ```", "git status", "  ```", ...C]],
      ["after a fence under a two-space marker, short of its text: a top-level fence, closed", ["-  Example:", "  ```", "x", "  ```", ...C]],
      ["after a <pre> under a two-space marker, short of its text: a top-level block, closed", ["-  Example:", "  <pre>", "x", "", "</pre>", ...C]],
      ["after a fence closed at column 0, which GitHub reads as opening another, and a fence closing that", ["- Example:", "  ```", "  x", "```", "Then:", "```", ...C]],
    ])("still reads a claim %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });

    // The repair reaches only a block inside a list item: a top-level one still runs to its own end.
    it.each([
      ["a fence never closed", ["```", "x", ...C]],
      ["a fence still inside its list item", ["- Example:", "  ```", "  ### Ownership claim", "  - Lane: Codex"]],
      ["a fence after a list, indented one space", ["- item", "", " ```", "x", ...C]],
      ["a fence under an ordered item's number, short of its text", ["1. Run this:", "  ```", "git status", ...C]],
      ["a fence after a list and a paragraph", ["- item", "", "Text", "  ```", "x", ...C]],
      ["a fence that ends a list item", ["- item", "```", "x", ...C]],
      ["a fence after a closed one under a two-space marker", ["-  Example:", "  ```", "x", "  ```", "", "```text", ...C]],
      ["a <pre> under an ordered item's number, short of its text", ["1. item", "  <pre>", "  x", ...C]],
      ["a <pre> after a list item, indented one space", ["- item", " <pre>", "x", ...C]],
      ["an HTML comment left open inside a list item, which GitHub never closes", ["- Example:", "  <!--", "  x", ...C]],
    ])("reads no claim inside %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toBeNull();
    });

    it("reads no Handoff inside a top-level fence never closed", () => {
      expect(parseHandoff(["```", "x", ...H].join("\n"))).toBeNull();
    });

    // The line that ends the item can open a block of its own, and a Handoff after it is then code: on
    // c71c6d3c each of these released the claim above it.
    it.each([
      ["a fence closed at column 0, which GitHub reads as opening another", ["- Example:", "  ```", "  npm test", "```", ...H]],
      ["a fence opened after a list item's fence ended", ["- Example:", "  ```", "  x", "Then:", "  ```", ...H]],
      ["a fence opened at column 0 inside a list item's <pre>", ["- Example:", "  <pre>", "  x", "```", "</pre>", ...H]],
      ["a fence opened at column 0 inside a list item's <div>", ["- Example:", "  <div>", "```", "", ...H]],
      ["an HTML comment its list item ended before its `-->`", ["- Example:", "  <!--", "x", "-->", ...H]],
    ])("reads no Handoff GitHub hides after %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...lines)]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
    });

    it.each([
      ["a fence closed under the item's text", ["- Example:", "  ```", "  x", "  ```", ...H]],
      ["a fence closed a space deeper", ["- Example:", "  ```", "  x", "   ```", ...H]],
      ["a <pre> closed under the item's text", ["- Example:", "  <pre>", "  x", "  </pre>", ...H]],
      ["a <div> and a blank line", ["- Example:", "  <div>", "  x", "", ...H]],
    ])("still reads a Handoff after a list item's block that ends inside the item: %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toMatchObject({ released: true });
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...lines)]).claim).toBeNull();
    });

    // Where GitHub settles it the other way, each fails closed: past a line that may have ended a list
    // item under an open block, a claim is read and a Handoff is not.
    it.each([
      ["a fence left open inside a list item", [...ITEM_FENCE, ...H]],
      ["a fence closed at column 0 and a later pair of fences", ["- Example:", "  ```", "  x", "```", "Then:", "```", ...H]],
      ["a fence indented past the item's text, closed under it", ["- Example:", "   ```", "  x", "  ```", ...H]],
      ["a fence after a list GitHub has ended, closed at column 0", ["- item", "", " text", "  ```", "  x", "```", ...H]],
    ])("reads no Handoff after %s, though GitHub shows one: the lease stays live", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it.each([
      ["in a fence opened after a list item's fence ended", ["- Example:", "  ```", "  x", "Then:", "  ```", ...C]],
      ["after a lone tag that ends a list item's <pre>", ["- Example:", "  <pre>", "  x", "<br>", ...C]],
      ["in a fence opened by a list item's fence closed at column 0", ["- Example:", "  ```", "  npm test", "```", ...C]],
      ["in a fence opened at column 0 inside a list item's <pre>", ["- Example:", "  <pre>", "  x", "```", "</pre>", ...C]],
      ["in a fence opened at column 0 inside a list item's <div>", ["- Example:", "  <div>", "```", "", ...C]],
      ["after an HTML comment its list item ended before its `-->`", ["- Example:", "  <!--", "x", "-->", ...C]],
    ])("still reads a claim GitHub hides %s: the lease holds", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });
  });

  // HQ review 5172037615 on afc6dfc7: a Handoff read its fields from the whole comment, so a Claim line
  // above its header, or under a later heading, released the claim before it. A Handoff's section runs
  // from its header to the next line that opens another section.
  describe("a Handoff reads its fields only from its own section", () => {
    const NOTES = ["### Notes", "- Claim: released", ""];
    const OWN = ["### Handoff", "- Outcome: review requested", "- Exact next action: independent review"];
    const TEMPLATE = renderHandoff({ outcome: "merged", nextAction: "none", claim: "released" });

    it.each([
      ["above its header, in a Handoff with no Claim line", [...NOTES, ...OWN]],
      ["above its header, over the Handoff's own HELD", [...NOTES, "### Handoff", "- Claim: HELD. Review pending."]],
      ["under a later heading", [...OWN, "", "### Notes", "- Claim: released"]],
      ["under a later heading of another level", [...OWN, "", "# Notes", "- Claim: released"]],
      ["under a later setext heading", [...OWN, "", "Notes", "-----", "- Claim: released"]],
      ["that is the text of a later setext heading", [...OWN, "", "| Claim | released |", "==="]],
      ["past a thematic break", [...OWN, "", "***", "- Claim: released"]],
      ["under a heading in a later list item", [...OWN, "- ### Notes", "- Claim: released"]],
      ["under a heading in a quote", [...OWN, "", "> ### Notes", "", "- Claim: released"]],
      ["under an HTML heading", [...OWN, "", "<h3>Notes</h3>", "", "- Claim: released"]],
      ["past an HTML rule", [...OWN, "", "<hr>", "", "- Claim: released"]],
      ["that an underline indented into its list item makes a heading", [...OWN, "- Claim: released", "  ---"]],
      ["that === indented into its list item makes a heading", [...OWN, "- Claim: released", "  ==="]],
      ["that an underline four columns in makes a heading", [...OWN, "- Claim: released", "    ---"]],
      ["that an underline after a tab makes a heading", [...OWN, "- Claim: released", "\t---"]],
      ["that an underline makes a heading with the line after it", [...OWN, "- Claim: released", "  (lane)", "  ---"]],
      ["in the template, that an underline indented into its item makes a heading", [TEMPLATE, "  ---"]],
    ])("does not release on a Claim line %s, so the claim before it stays live", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toMatchObject({ released: false });
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...lines)]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
    });

    it.each([
      ["released", "HELD. Review pending.", false],
      ["HELD. Review pending.", "released", false],
      ["released", "released", true],
    ])("releases on two Handoffs in one comment only when both do: %j, then %j", (first, second, released) => {
      const body = ["### Handoff", `- Claim: ${first}`, "", "### Handoff", `- Claim: ${second}`].join("\n");
      expect(parseHandoff(body).released).toBe(released);
    });

    it("does not release when a Handoff's own Claim lines disagree", () => {
      expect(parseHandoff("### Handoff\n- Claim: released\n- Claim: HELD. Review pending.").released).toBe(false);
    });

    it("reads no field from above its header or under a later heading", () => {
      const body = ["### Notes", "- Exact next action: stale", "- Outcome: stale", "", ...OWN, "", "### Next", "- Verification: elsewhere"];
      expect(parseHandoff(body.join("\n"))).toMatchObject({
        outcome: "review requested",
        nextAction: "independent review",
        verification: null,
        released: false,
      });
    });

    it("still reads the rendered template as a release, with a section or a rule after it", () => {
      const body = renderHandoff({ outcome: "merged", nextAction: "none", claim: "released" });
      expect(parseHandoff(body)).toMatchObject({ outcome: "merged", nextAction: "none", released: true });
      expect(parseHandoff([body, "", "### Notes", "- Claim: HELD. Another lane's."].join("\n")).released).toBe(true);
      expect(parseHandoff([body, "---", "Posted by the lane."].join("\n")).released).toBe(true);
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", body)]).claim).toBeNull();
    });

    // GitHub reads each underline here as a rule, or as the heading of another item, so the Claim line
    // stays the Handoff's own.
    it("still releases when an underline below its Claim line is a rule, or takes another item", () => {
      const claim = [...OWN, "- Claim: released"];
      expect(parseHandoff([...claim, " ---"].join("\n")).released).toBe(true);
      expect(parseHandoff([...claim, "", "  ---"].join("\n")).released).toBe(true);
      expect(parseHandoff([...claim, "  ***"].join("\n")).released).toBe(true);
      expect(parseHandoff(["### Handoff", "- Claim: released", "- Outcome: review requested", "  ---"].join("\n")).released).toBe(true);
    });
  });
});

describe("the gh plan pins the field quirks that cost real time", () => {
  const plan = planPostClaim({ issue: 18, ids: IDS, facts: FACTS, verdict: PASS }).map((s) => s.argv.join(" "));

  it("sets the five minimum fields plus Status", () => {
    expect(plan.join("\n")).toContain("F_lane");
    expect(plan.join("\n")).toContain("F_wt");
    expect(plan.join("\n")).toContain("F_next");
    expect(plan.join("\n")).toContain("F_exp");
    expect(plan.join("\n")).toContain("F_ver");
    expect(plan.join("\n")).toContain("o_active");
  });

  it("writes date fields with --date, never --text", () => {
    for (const step of plan) {
      if (step.includes("F_exp") || step.includes("F_ver")) {
        expect(step).toMatch(/--date /);
        expect(step).not.toMatch(/--text /);
      }
    }
  });

  it("writes the worktree field in canonical form", () => {
    expect(plan.join("\n")).toContain(`${FOLDER} @ ${BRANCH}`);
  });

  it("posts the claim comment before editing fields, so a half-run still leaves evidence", () => {
    const full = planPostClaim({ issue: 18, ids: IDS, facts: FACTS, verdict: PASS });
    expect(full[0].argv.slice(0, 2)).toEqual(["issue", "comment"]);
  });
});

// ── releasing a lease (#643) ─────────────────────────────────────
//
// The thread is the incident's: the predecessor claims, releases, and the successor claims. A release
// takes nothing it could measure from its caller, so no test can hand it a seat or a thread. They run
// the real `postRelease` and the real command inside `simulate`: a stand-in for `gh`, for `git`, and
// for the session records on this machine. A test says what that world looks like and reads back what
// was sent. Nothing here can reach GitHub, and the issue number names no issue.

const ISSUE = 999_637;
const HOLDER = { folder: "C:\\lanes\\successor", branch: "claude/successor" };
const PREDECESSOR = { folder: "C:\\lanes\\predecessor", branch: "claude/predecessor" };
const THIRD = { folder: "C:\\lanes\\third", branch: "claude/third" };
const NOW = new Date("2026-10-03T05:30:25Z");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const posted = (createdAt, body, n) => ({ createdAt, body, url: `https://github.com/Pootytxng/sentinel/issues/${ISSUE}#issuecomment-${n}` });
/** A claim as `renderClaim` writes it for a seat; `drop` removes whole lines by label. */
const claimText = (seat, { drop = [], ...facts } = {}) =>
  renderClaim({ ...FACTS, folder: seat.folder, branch: seat.branch, expires: "2026-10-03T17:22:01Z", verdict: PASS, ...facts })
    .split("\n")
    .filter((l) => !drop.some((label) => l.startsWith(`- ${label}:`)))
    .join("\n");
const RELEASED = renderHandoff({ outcome: "done", nextAction: "Kuya reviews.", claim: "released" });

const A_CLAIM = posted("2026-10-03T03:10:00Z", claimText(PREDECESSOR, { expires: "2026-10-03T15:10:00Z" }), 1);
const A_RELEASE = posted("2026-10-03T05:21:02Z", RELEASED, 2);
const B_CLAIM = posted("2026-10-03T05:22:01Z", claimText(HOLDER), 3);
const INCIDENT = [A_CLAIM, A_RELEASE, B_CLAIM];
/** A claim a third session posts while a release is in flight. */
const C_CLAIM = posted("2026-10-03T05:30:26Z", claimText(THIRD, { expires: "2026-10-03T17:30:26Z" }), 8);
/** The reviewer's thread (review of PR 644, round 4): the incident, then 96 plain notes, 99 comments in all; a Handoff makes 100 and a claim 101. */
const NINETY_NINE = [...INCIDENT, ...Array.from({ length: 96 }, (_, i) => posted(new Date(Date.UTC(2026, 9, 3, 5, 23, i)).toISOString().replace(".000Z", "Z"), `Note ${i + 1}.`, 100 + i))];
/** A thread holding one live claim, posted at the successor's time. */
const claimedBy = (seat = HOLDER, opts = {}) => [posted("2026-10-03T05:22:01Z", claimText(seat, opts), 3)];
/** The successor's claim, a day old and past its own expiry. */
const lapsedClaim = (opts = {}) => [posted("2026-10-02T00:00:00Z", claimText(HOLDER, { expires: "2026-10-02T12:00:00Z", ...opts }), 4)];
const LAPSED = lapsedClaim();

/** How a refusal names a claim: who holds it, since when, and its link. */
const held = (comment, seat = HOLDER) => `${seat.folder} @ ${seat.branch}, claimed ${comment.createdAt} (${comment.url})`;
/** What the tool posts for a Handoff text: the text, then the record of the one claim it ends. */
const withRecord = (text, comment, seat = HOLDER) =>
  `${text.trimEnd()}\n\n${RELEASE_RECORD_HEADER}\n\n- Ends claim: ${comment.createdAt}\n- Held by: ${seat.folder} @ ${seat.branch}\n- Link: ${comment.url}\n`;

const tmp = mkdtempSync(join(tmpdir(), "compy-release-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// The board as `gh project field-list` prints it. `readProjectIds` reads it into the `IDS` above.
const BOARD_FIELDS = [
  { id: "F_status", name: "Status", options: [{ id: "o_active", name: "Active" }, { id: "o_needs", name: "Needs Kuya" }, { id: "o_review", name: "Review" }] },
  { id: "F_lane", name: "Lane", options: [{ id: "o_cc", name: "Claude Code" }] },
  { id: "F_gate", name: "Gate", options: [{ id: "o_none", name: "None" }, { id: "o_kuya", name: "Kuya" }] },
  { id: "F_wt", name: "Worktree / branch" },
  { id: "F_next", name: "Next action" },
  { id: "F_exp", name: "Claim expires" },
  { id: "F_ver", name: "Last verified" },
];
const BOARD_ROWS = [{ id: "PVTI_x", title: "the release guard", content: { number: ISSUE } }];

/** `gh` failing as it does: the message is the command line, and the cause is the first line of stderr. */
const ghFailure = (argv) =>
  Object.assign(new Error(`Command failed: gh ${argv.join(" ")}`), { stderr: "GraphQL: Could not resolve to a ProjectV2Item\nsecond line\n" });
/** A write in words: the comment, the field an edit sets and what it sets it to, or the mark on the posted comment. */
const said = (argv) => (argv[0] === "api" ? "mark the posted Handoff" : argv[0] === "issue" ? `comment on #${argv[2]}` : argv.slice(argv.indexOf("--field-id") + 1).join(" "));
/** The six writes of a release that files the row as Review, in order: the comment, then the five board edits. */
const SIX_WRITES = [
  `comment on #${ISSUE}`,
  "F_status --single-select-option-id o_review",
  "F_gate --single-select-option-id o_none",
  "F_next --text Kuya reviews.",
  "F_exp --clear",
  "F_ver --date 2026-10-03",
];
const SIX_STEPS = [
  `post the Handoff on #${ISSUE}`,
  "set Status = Review",
  "set Gate = None",
  "set Next action = Kuya reviews.",
  "clear Claim expires",
  "set Last verified = 2026-10-03",
];
// Round 4 of the review: the seventh write marks the posted Handoff with how the row was filed, so a
// read that shows the mark is current. It follows the board edits whether they all ran or one failed.
const MARK_WRITE = "mark the posted Handoff";
const MARK_STEP = "mark the Handoff with how the row was filed";
const SEVEN_WRITES = [...SIX_WRITES, MARK_WRITE];
const SEVEN_STEPS = [...SIX_STEPS, MARK_STEP];
/** The writes and steps of a release whose board edit numbered `failAt` (1 to 5) failed: what ran before it, then the mark. */
const WRITES_TO = (failAt) => [...SIX_WRITES.slice(0, failAt), MARK_WRITE];
const STEPS_TO = (failAt) => [...SIX_STEPS.slice(0, failAt), MARK_STEP];
/** The mark a whole release leaves on its comment, at the fixed clock, and the one a half run leaves. */
const FILED = (body) => `${body.trimEnd()}\n- Row filed: ${NOW.toISOString()}\n`;
const UNFINISHED = (body, step) => `${body.trimEnd()}\n- Row unfinished: ${NOW.toISOString()} ("${step}" failed)\n`;

// What a stop that leaves the row in doubt says to do (#643 review, round 2). On e0362db5 a failed
// edit listed the edits left to run by hand, over whatever claim had landed meanwhile. No stop hands
// out an edit now, and every one of them starts with reading the thread again.
const UNFILED = `The row stays as it is until the next claim on #${ISSUE}, which sets its Status, Next action and Claim expires again. Before changing it by hand, read the thread again: once a claim follows this Handoff, the row is that claim's.`;
const THEIRS = "the row is that claim's: restore it from the claim's own text (Status Active, its Next action, its Claim expires)";
const CURES = {
  RELEASE_UNVERIFIED: `Run this release again: it reads the thread first and writes nothing unless this folder still holds a live claim, so its answer says whether the comment ended the lease. ${UNFILED}`,
  RELEASE_ROW_RACED: `Read the thread again. While that claim is live, ${THEIRS}. If it has been released since, check the row against the newest Handoff on the thread.`,
  RELEASE_HALF_RUN: `Nothing more is run from this release, and running it again is refused: the lease it would end is gone. ${UNFILED}`,
  RELEASE_HALF_RUN_UNCHECKED: `Nothing more is run from this release. Read the thread again. If a claim follows this Handoff, ${THEIRS}. If none does, the row stays as it is until the next claim on #${ISSUE}, which sets its Status, Next action and Claim expires again.`,
  RELEASE_ROW_UNCHECKED: `Read the thread again. If a claim follows this Handoff, ${THEIRS}. If none does, nothing is left to do.`,
};
/** Nothing a stop prints hands out an edit: no "left to run  <step>" line (the cure "Nothing is left to run." is not one), no `gh` command line, no field or row id. */
const noEditHandedOut = (text) => {
  for (const part of ["left to run  ", "gh [", "item-edit", "--field-id", "F_status", "F_gate", "F_next", "F_exp", "F_ver", "PVTI_x"]) expect(text).not.toContain(part);
};
/** How a half-filed row is described when the edit numbered `failAt` (1 to 5) fails. */
const PARTLY = [
  null,
  'no edit ran, "set Status = Review" failed (GraphQL: Could not resolve to a ProjectV2Item) and may or may not have been applied, and 4 more were not tried',
  '"set Status = Review" ran, "set Gate = None" failed (GraphQL: Could not resolve to a ProjectV2Item) and may or may not have been applied, and 3 more were not tried',
  '"set Status = Review", "set Gate = None" ran, "set Next action = Kuya reviews." failed (GraphQL: Could not resolve to a ProjectV2Item) and may or may not have been applied, and 2 more were not tried',
  '"set Status = Review", "set Gate = None", "set Next action = Kuya reviews." ran, "clear Claim expires" failed (GraphQL: Could not resolve to a ProjectV2Item) and may or may not have been applied, and 1 more was not tried',
  '"set Status = Review", "set Gate = None", "set Next action = Kuya reviews.", "clear Claim expires" ran, "set Last verified = 2026-10-03" failed (GraphQL: Could not resolve to a ProjectV2Item) and may or may not have been applied, and it was the last edit',
];

/**
 * One machine and one GitHub, as a release sees them.
 *
 *   thread          the issue's comments when the release starts
 *   seat            what git says of the folder the command runs in: { folder, branch }. Null is a
 *                   folder that is no git work tree; a branch of null is a detached HEAD.
 *   projectDir      { dir, seat }: CLAUDE_PROJECT_DIR is `dir`, and git says `seat` of that folder
 *   holder          the session record of the holding folder: "none" (no record), "corrupt", a liveness
 *                   word, or a function of the folder that answers with one (or throws)
 *   answer          (n, thread) => what the n-th thread read prints, given the thread as it is;
 *                   undefined is the thread itself; may throw
 *   lag             how many reads after the post still show the thread as it was before it
 *   staleAfterMark  how many reads after the mark still show the thread as it was just after the post
 *   beforePost      comments that land between the release's read and its post
 *   afterPost       comments that land straight after its post
 *   duringEdits     { at, comments }: comments that land after its `at`-th board edit; 0 is after the
 *                   read-back and before the first edit
 *   failAt          the write that fails: 0 is the comment, 1 to 5 the board edits
 *   markFails       true: the edit that marks the posted comment fails
 *   printUrl        false: `gh issue comment` prints nothing
 *   unlinked        true: the posted comment comes back with no link, and `gh issue comment` prints none
 *   boardFails      the board read that fails: "item-list", "view" or "field-list"
 *   rows, truncated, project, fields   what the board reads answer with
 *   dropBoardCache  "throws": dropping the cached copy of the board fails
 */
function simulate({
  thread = INCIDENT,
  seat = HOLDER,
  projectDir = null,
  holder = "none",
  answer = null,
  lag = 0,
  staleAfterMark = 0,
  beforePost = [],
  afterPost = [],
  duringEdits = null,
  failAt = null,
  markFails = false,
  printUrl = true,
  unlinked = false,
  boardFails = null,
  rows = BOARD_ROWS,
  truncated = false,
  project = { id: "PVT_x" },
  fields = BOARD_FIELDS,
  dropBoardCache = null,
  count = null,
  cut = null,
} = {}) {
  let comments = thread.map((c) => ({ ...c }));
  let before = null; // the thread as it was before the post, served to the first `lag` reads after it
  let late = 0;
  let justPosted = null; // the thread as it was just after the post
  let stale = null; // ... served to the first `staleAfterMark` reads after the mark
  let staleReads = 0;
  let served = null; // the list the last `issue view` served, whole: GitHub's count agrees with it unless `count` says otherwise
  let writes = 0;
  const seen = { sent: [], calls: [], git: [], asked: [], drops: 0, reads: 0, counts: 0, counted: [] };
  const listIn = (printed) => {
    try {
      const list = JSON.parse(printed)?.comments;
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  };

  const write = (argv) => {
    if (failAt === writes) throw ghFailure(argv);
    writes += 1;
    seen.sent.push({ argv, describe: said(argv) });
  };
  const boardRead = (name, value) => {
    if (boardFails === name) throw ghFailure(["project", name]);
    return JSON.stringify(value);
  };
  const gh = (argv) => {
    // GitHub's own count of an issue's comments: the REST route to the issue, read with nothing else.
    const issueRoute = argv[0] === "api" && argv.length === 2 ? /^repos\/Pootytxng\/sentinel\/issues\/(\d+)$/.exec(argv[1]) : null;
    const kind = issueRoute ? "api issue" : `${argv[0]} ${argv[1]}`;
    seen.calls.push(`gh ${kind}`);
    if (kind === "issue view") {
      seen.reads += 1;
      const printed = answer?.(seen.reads, comments);
      if (printed !== undefined) {
        served = listIn(printed);
        return printed;
      }
      served = before && (late += 1) <= lag ? before : stale && (staleReads += 1) <= staleAfterMark ? stale : comments;
      // `cut` serves the list short, as a page's end would, while the count stays the whole list's.
      return JSON.stringify({ comments: cut === null ? served : served.slice(0, cut) });
    }
    if (issueRoute) {
      seen.counts += 1;
      seen.counted.push(argv);
      const n = typeof count === "function" ? count(seen.counts, comments) : count;
      if (typeof n === "string") return n; // the answer as printed, for one that is not a count
      return JSON.stringify({ number: Number(issueRoute[1]), comments: n ?? (served ?? comments).length });
    }
    if (kind === "issue comment") {
      write(argv);
      before = comments;
      const url = `https://github.com/Pootytxng/sentinel/issues/${argv[2]}#issuecomment-${9000 + writes + comments.length}`;
      const mine = { body: argv.at(-1), createdAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), ...(unlinked ? {} : { url }) };
      comments = [...comments, ...beforePost, mine, ...afterPost];
      justPosted = comments;
      return printUrl && !unlinked ? `${url}\n` : "";
    }
    if (kind === "project item-list") return boardRead("item-list", { items: rows, totalCount: rows.length + (truncated ? 1 : 0) });
    if (kind === "project view") return boardRead("view", project);
    if (kind === "project field-list") return boardRead("field-list", { fields });
    if (kind === "project item-edit") {
      if (duringEdits?.at === 0 && writes === 1) comments = [...comments, ...duringEdits.comments];
      write(argv);
      if (duringEdits?.at === writes - 1) comments = [...comments, ...duringEdits.comments];
      return "";
    }
    if (kind === "api --method") {
      // The one edit of a comment GitHub's REST route allows here: PATCH the comment numbered so, with
      // its whole new text. The comment must be on the thread. gh prints the comment as edited.
      const [, , method, route, flag, field] = argv;
      const id = /^repos\/Pootytxng\/sentinel\/issues\/comments\/(\d+)$/.exec(route)?.[1];
      const target = id ? comments.find((c) => String(c.url ?? "").endsWith(`#issuecomment-${id}`)) : undefined;
      if (method !== "PATCH" || !target || flag !== "-f" || !String(field).startsWith("body=")) throw new Error(`the simulated gh does not answer "gh ${argv.join(" ")}"`);
      if (markFails) throw ghFailure(argv);
      writes += 1;
      seen.sent.push({ argv, describe: said(argv) });
      stale = justPosted;
      const edited = { ...target, body: field.slice("body=".length) };
      comments = comments.map((c) => (c === target ? edited : c));
      return JSON.stringify(edited);
    }
    throw new Error(`the simulated gh does not answer "${kind}"`);
  };
  const git = ([, root, ...rest]) => {
    const ask = rest.join(" ");
    seen.calls.push(`git ${ask}`);
    seen.git.push({ root, ask });
    const at = projectDir && samePath(root, projectDir.dir) ? projectDir.seat : seat;
    if (ask === "remote get-url origin") return "git@github.com:Pootytxng/sentinel.git\n";
    if (!at?.folder) throw new Error("fatal: not a git repository (or any of the parent directories): .git");
    if (ask === "rev-parse --show-toplevel") return `${at.folder}\n`;
    if (ask === "rev-parse --is-inside-work-tree") return "true\n";
    if (ask === "rev-parse --abbrev-ref HEAD") return `${at.branch || "HEAD"}\n`;
    throw new Error(`the simulated git does not answer "${ask}"`);
  };

  return {
    exec(file, argv) {
      if (file === "git") return git(argv);
      if (file === "gh") return gh(argv);
      throw new Error(`the simulated world runs no "${file}"`);
    },
    readLineage({ root }) {
      seen.asked.push(root);
      if (holder === "none") return null;
      return holder === "corrupt" ? CORRUPT : { root };
    },
    // As the real probe answers: "none" for no record, and for one it cannot read as well.
    observeLiveness(record) {
      const liveness = !record || record === CORRUPT ? "none" : typeof holder === "function" ? holder(record.root) : holder;
      return { liveness, alive: null, seenAt: null };
    },
    invalidateBoardCache() {
      seen.drops += 1;
      if (dropBoardCache === "throws") throw new Error("EPERM: operation not permitted, unlink 'board.json'");
      return true;
    },
    seen: () => ({ ...seen, thread: comments }),
  };
}

/** Run `run` in a simulated world, at a fixed clock. Returns what it returned or threw, and what the world saw. */
function inWorld({ now = NOW, ...options }, run) {
  const sim = simulate(options);
  vi.stubEnv("CLAUDE_PROJECT_DIR", options.projectDir?.dir ?? "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  world.on = sim;
  let result = null;
  let error = null;
  try {
    result = run();
  } catch (e) {
    error = e;
  } finally {
    world.on = null;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
  return { result, error, ...sim.seen() };
}

const given = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * One release, from `self`'s seat. What it is asked is the issue and the Handoff (`body` as text, or
 * `handoff` as fields) plus `takeover`, `status`, `gate`, `dryRun`; `request` replaces all of that
 * with a request written out whole. Everything else describes the world (see `simulate`).
 */
function attempt({ self = HOLDER, body, handoff, takeover, status, gate, dryRun, ...rest } = {}) {
  const { request, ...sim } = rest;
  const asked = Object.hasOwn(rest, "request")
    ? request
    : { issue: ISSUE, cacheDir: tmp, ...(handoff === undefined ? { body: body ?? RELEASED } : { handoff }), ...given({ takeover, status, gate, dryRun }) };
  return inWorld({ seat: self, ...sim }, () => postRelease(asked));
}

/** The release was refused with `code`, before anything was written. Returns the whole run. */
function refusedRun(code, opts) {
  const run = attempt(opts);
  expect(run.result, "the release was not refused").toBeNull();
  expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe(code);
  expect(run.error.posted).toBe(false);
  expect(run.error.cure).toMatch(/^Nothing was written/);
  expect(run.sent.map((s) => s.describe)).toEqual([]);
  expect(run.drops).toBe(0);
  return run;
}
/** The same, returning the refusal itself. */
const refused = (code, opts) => refusedRun(code, opts).error;

/** The release ran whole: the comment, the five board edits, then the mark, and the thread holds no lease after it. */
function allowed(opts, via = "holder") {
  const run = attempt(opts);
  expect(run.error, String(run.error?.stack ?? run.error)).toBeNull();
  expect(run.result.via).toBe(via);
  expect(run.sent).toHaveLength(7);
  expect(run.sent[0].argv.slice(0, 3)).toEqual(["issue", "comment", String(ISSUE)]);
  expect(run.sent[6].describe).toBe(MARK_WRITE);
  expect(run.result.steps.map((s) => s.ran)).toEqual([true, true, true, true, true, true, true]);
  const body = run.sent[0].argv.at(-1);
  expect(run.result.body).toBe(body);
  // The filing time is the clock's at the mark, which some worlds set elsewhere than NOW.
  const mark = run.sent[6].argv.at(-1);
  expect(mark.startsWith(`body=${body.trimEnd()}\n- Row filed: `), "the mark is the posted text, filed").toBe(true);
  expect(mark.slice(mark.lastIndexOf(": ") + 2)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/);
  expect(threadLease(run.thread).claim, "the lease is still live after the release").toBeNull();
  return { ...run, body };
}

describe("the simulated world the release tests run in (#643)", () => {
  it("answers the board readers with the ids the plan tests use", () => {
    expect(inWorld({}, () => readProjectIds("PVTI_x")).result).toEqual(IDS);
    expect(inWorld({}, () => readBoard()).result).toMatchObject({ reachable: true, items: [{ number: ISSUE, itemId: "PVTI_x" }] });
  });

  it("is the only gh this file can reach: outside it a gh call is an error, not a request", () => {
    expect(readBoard()).toEqual({ reachable: false, items: [], error: "claim.test.mjs reached a real gh call outside the simulated world" });
    expect(() => asLauncher(() => postClaim({ issue: ISSUE, verdict: PASS, facts: FACTS, ids: IDS, cacheDir: tmp }))).toThrow(/outside the simulated world/);
  });

  it("measures a seat from git's answers: the work tree's top level and the branch it is on", () => {
    expect(inWorld({ seat: HOLDER }, () => measureSeat()).result).toEqual(HOLDER);
    expect(inWorld({ seat: { folder: HOLDER.folder, branch: null } }, () => measureSeat()).result).toEqual({ folder: HOLDER.folder, branch: null });
    expect(inWorld({ seat: null }, () => measureSeat()).result).toEqual({ folder: null, branch: null });
  });
});

describe("postRelease: only the folder and branch the live claim names may end it (#643)", () => {
  it("lets the holder release: the comment, then the board row, then the mark on the comment", () => {
    const { result, sent, body, thread } = allowed();
    expect(body).toBe(withRecord(RELEASED, B_CLAIM));
    expect(sent.map((s) => s.describe)).toEqual(SEVEN_WRITES);
    for (const edit of sent.slice(1, 6)) expect(edit.argv.slice(0, 6)).toEqual(["project", "item-edit", "--project-id", "PVT_x", "--id", "PVTI_x"]);
    expect(result.steps).toEqual(SEVEN_STEPS.map((describe) => ({ describe, ran: true })));
    expect(result.url).toBe(thread.at(-1).url);
    expect(result.claim.url).toBe(B_CLAIM.url);
    expect(threadLease(thread).handoff).toMatchObject({ released: true, nextAction: "Kuya reviews.", postedAt: "2026-10-03T05:30:25Z" });
  });

  it("measures before it writes: the board, its own seat, then the thread and its count, and the comment straight after", () => {
    const { calls, git, reads, counts } = allowed();
    const firstWrite = calls.indexOf("gh issue comment");
    expect(calls.slice(0, 3)).toEqual(["gh project item-list", "gh project view", "gh project field-list"]);
    expect(calls.slice(3, firstWrite - 2).every((c) => c.startsWith("git "))).toBe(true);
    expect(calls.slice(firstWrite - 2, firstWrite), "the thread, then GitHub's count of it, are the last things read before the first write").toEqual(["gh issue view", "gh api issue"]);
    expect(calls.slice(firstWrite + 1)).toEqual(["gh issue view", "gh api issue", ...Array(5).fill("gh project item-edit"), "gh api --method", "gh issue view", "gh api issue"]);
    expect(reads).toBe(3);
    expect(counts).toBe(3);
    // The seat is the folder the command runs in, asked of git: four questions, all about that folder.
    expect(git.map((g) => g.ask).sort()).toEqual(["remote get-url origin", "rev-parse --abbrev-ref HEAD", "rev-parse --is-inside-work-tree", "rev-parse --show-toplevel"]);
    expect(git.every((g) => samePath(g.root, process.cwd()))).toBe(true);
  });

  it.each([
    ["prose after the branch", { branch: `${HOLDER.branch} (cut from origin/main at 1780fef1)` }],
    ["the branch in a code span, then prose", { branch: `\`${HOLDER.branch}\` cut from origin/main` }],
    ["a colon after the branch", { branch: `${HOLDER.branch}: cut from origin/main` }],
    ["a full stop after the branch", { branch: `${HOLDER.branch}. Cut from origin/main` }],
    ["the folder in a code span, then prose", { folder: `\`${HOLDER.folder}\` (created fresh by the launcher)` }],
    ["both in code spans", { folder: `\`${HOLDER.folder}\``, branch: `\`${HOLDER.branch}\`` }],
  ])("reads the holder out of a claim written with %s", (_, facts) => {
    allowed({ thread: claimedBy(HOLDER, facts) });
  });

  // A comma, a semicolon and a bracket are legal in a branch name, so they are read as part of it
  // (#643 review: stripping them let `x` release the lease of `x,`). The refusal says so.
  it.each([
    ["a comma", `${HOLDER.branch}, cut from origin/main`, `${HOLDER.branch},`],
    ["a semicolon", `${HOLDER.branch}; cut from origin/main`, `${HOLDER.branch};`],
    ["a comma straight after a code span", `\`${HOLDER.branch}\`, cut from origin/main`, `\`${HOLDER.branch}\`,`],
  ])("refuses a claim whose Branch line carries %s after the name, and says why", (_, branch, read) => {
    const error = refused("RELEASE_BRANCH_MISMATCH", { thread: claimedBy(HOLDER, { branch }) });
    expect(error.reason).toContain(`Its Branch line reads as "${read}": punctuation written straight after a branch name is read as part of it.`);
    expect(error.cure).toBe(
      "Nothing was written. Post a refreshed Ownership claim whose Branch line is the name alone, or the name in a code span with a space after it, then release.",
    );
  });

  it.each([",", ";", ")", "]"])("takes %j as part of a branch name: the branch it names may release, and its neighbour may not", (mark) => {
    const marked = { folder: HOLDER.folder, branch: `${HOLDER.branch}${mark}` };
    const thread = claimedBy(marked);
    const error = refused("RELEASE_BRANCH_MISMATCH", { thread, self: HOLDER });
    expect(error.reason).toContain(`Its Branch line reads as "${marked.branch}"`);
    allowed({ thread, self: marked });
    refused("RELEASE_BRANCH_MISMATCH", { thread: claimedBy(HOLDER), self: marked });
  });

  it.each(["c:/lanes/successor", "C:\\lanes\\successor\\", "C:\\LANES\\Successor"])("knows its own folder spelled %j", (folder) => {
    allowed({ self: { ...HOLDER, folder } });
  });

  it("refuses the incident: a predecessor releasing after its successor claimed", () => {
    const error = refused("RELEASE_NOT_HOLDER", { self: PREDECESSOR });
    for (const part of [B_CLAIM.url, `${HOLDER.folder} @ ${HOLDER.branch}`, "2026-10-03T05:22:01Z", PREDECESSOR.folder]) expect(error.message).toContain(part);
    expect(error.message).toContain(`held by another folder: ${held(B_CLAIM)}.`);
    expect(error.claim.url).toBe(B_CLAIM.url);
  });

  it.each([
    ["another folder on a branch of the same name", { folder: PREDECESSOR.folder, branch: HOLDER.branch }],
    ["a folder whose path only starts the same", { ...HOLDER, folder: `${HOLDER.folder}-2` }],
    ["the folder above it", { ...HOLDER, folder: "C:\\lanes" }],
    ["a folder inside it", { ...HOLDER, folder: `${HOLDER.folder}\\tools` }],
  ])("refuses %s", (_, self) => {
    refused("RELEASE_NOT_HOLDER", { self });
  });

  it.each([PREDECESSOR.branch, `${HOLDER.branch}-2`, "claude/success", "main", HOLDER.branch.toUpperCase()])(
    "refuses the holding folder on another branch (%s)",
    (branch) => {
      const error = refused("RELEASE_BRANCH_MISMATCH", { self: { ...HOLDER, branch } });
      expect(error.message).toContain(B_CLAIM.url);
      expect(error.message).toContain(`This folder is on ${branch}.`);
      expect(error.reason).not.toContain("punctuation");
    },
  );

  it("refuses the holding folder on a detached HEAD", () => {
    expect(refused("RELEASE_SELF_UNKNOWN", { self: { folder: HOLDER.folder, branch: null } }).message).toMatch(/on no branch right now/);
  });

  it.each([null, undefined, "", "  "])("refuses the holding folder on no branch (%j)", (branch) => {
    const decision = releaseDecision({ issue: ISSUE, comments: INCIDENT, self: { folder: HOLDER.folder, branch }, now: NOW });
    expect(decision).toMatchObject({ ok: false, code: "RELEASE_SELF_UNKNOWN" });
    expect(decision.reason).toMatch(/on no branch/);
  });

  it("refuses a caller whose folder is no git work tree", () => {
    expect(refused("RELEASE_SELF_UNKNOWN", { self: null }).message).toMatch(/could not be measured/);
  });

  it.each([null, {}, { folder: null }, { folder: "  " }, { branch: HOLDER.branch }])("refuses a caller whose own folder was not measured (%j)", (self) => {
    const decision = releaseDecision({ issue: ISSUE, comments: INCIDENT, self, now: NOW });
    expect(decision).toMatchObject({ ok: false, code: "RELEASE_SELF_UNKNOWN" });
    expect(decision.reason).toMatch(/could not be measured/);
    expect(decision.reason).toContain(B_CLAIM.url);
  });

  it("refuses a caller that says nothing of itself", () => {
    expect(releaseDecision({ issue: ISSUE, comments: INCIDENT, self: undefined, now: NOW })).toMatchObject({ ok: false, code: "RELEASE_SELF_UNKNOWN" });
  });

  // The seat is one folder read twice: where the session says its project is, and where the command
  // runs. A variable pointed at the holding folder must not make this caller the holder.
  it.each([
    ["the session's project folder is the holder's and the command runs in another", { self: PREDECESSOR, projectDir: { dir: HOLDER.folder, seat: HOLDER } }, HOLDER.folder, PREDECESSOR.folder],
    ["the command runs in the holder's folder and the session's project folder is another", { self: HOLDER, projectDir: { dir: PREDECESSOR.folder, seat: PREDECESSOR } }, PREDECESSOR.folder, HOLDER.folder],
    ["the session's project folder is no git work tree", { self: HOLDER, projectDir: { dir: "C:\\elsewhere", seat: null } }, "C:\\elsewhere", HOLDER.folder],
  ])("refuses when %s", (_, opts, told, ran) => {
    const error = refused("RELEASE_SELF_UNKNOWN", opts);
    expect(error.message).toContain(`(the session's project folder is ${told} and the command runs in ${ran})`);
  });

  it("refuses when the session's project folder is the holder's and the command runs in no git work tree", () => {
    const error = refused("RELEASE_SELF_UNKNOWN", { self: null, projectDir: { dir: HOLDER.folder, seat: HOLDER } });
    expect(error.message).toContain(`(the session's project folder is ${HOLDER.folder} and the command runs in `);
  });

  it("takes the two as one seat when they are one work tree", () => {
    const { git } = allowed({ self: HOLDER, projectDir: { dir: `${HOLDER.folder}\\tools`, seat: HOLDER } });
    expect(git).toHaveLength(8);
    expect(git.filter((g) => samePath(g.root, `${HOLDER.folder}\\tools`))).toHaveLength(4);
  });

  it.each([
    ["no folder line", { drop: ["Worktree folder"] }, "its worktree folder"],
    ["no branch line", { drop: ["Branch"] }, "its branch"],
    ["neither line", { drop: ["Worktree folder", "Branch"] }, "its worktree folder or its branch"],
    ["an empty folder", { folder: "" }, "its worktree folder"],
    ["an empty branch", { branch: "" }, "its branch"],
  ])("refuses everyone when the live claim has %s: nobody can be shown to hold it", (_, opts, missing) => {
    for (const self of [HOLDER, PREDECESSOR]) {
      const error = refused("RELEASE_HOLDER_UNKNOWN", { thread: claimedBy(HOLDER, opts), self });
      expect(error.message).toContain(`does not name ${missing}, so nobody can be shown to hold it`);
    }
  });

  it("refuses a second release, and names the first", () => {
    for (const self of [PREDECESSOR, HOLDER]) {
      const error = refused("RELEASE_NO_LIVE_CLAIM", { thread: [A_CLAIM, A_RELEASE], self });
      expect(error.message).toContain(A_RELEASE.url);
      expect(error.message).toContain("2026-10-03T05:21:02Z");
      expect(error.claim).toBeNull();
    }
  });

  it("refuses the same release run twice: the second finds no lease, and names the first", () => {
    const first = allowed();
    const error = refused("RELEASE_NO_LIVE_CLAIM", { thread: first.thread });
    expect(error.message).toContain(`already released at 2026-10-03T05:30:25Z (${first.result.url})`);
  });

  it("does not let a takeover reason open a thread that has no lease", () => {
    refused("RELEASE_NO_LIVE_CLAIM", { thread: [A_CLAIM, A_RELEASE], self: HOLDER, takeover: "it looked idle", holder: "dead" });
  });

  it.each([
    ["an empty thread", []],
    ["a note that only mentions a claim", [posted("2026-10-03T05:00:00Z", "I will post a `### Ownership claim` once the preflight passes.", 5)]],
  ])("refuses a thread nobody claimed: %s", (_, thread) => {
    expect(refused("RELEASE_NO_LIVE_CLAIM", { thread }).message).toMatch(/no Ownership claim is in force/);
  });

  it.each([
    ["gh failed", () => { throw ghFailure(["issue", "view"]); }],
    ["an answer that is not JSON", () => "<html>502 Bad Gateway</html>"],
    ["an empty answer", () => ""],
    ["null", () => "null"],
    ["an object with no comments", () => "{}"],
    ["comments that are null", () => '{"comments":null}'],
    ["comments that are a word", () => '{"comments":"none"}'],
    ["a comment that is null", () => '{"comments":[null]}'],
    ["a comment that is a word", () => '{"comments":["released"]}'],
    ["a comment that arrived with no text", () => JSON.stringify({ comments: [...INCIDENT, { createdAt: "2026-10-03T05:25:00Z" }] })],
    ["a comment whose text is a number", () => JSON.stringify({ comments: [...INCIDENT, { body: 5 }] })],
  ])("refuses when the thread was not read (%s): an unknown lease is not the caller's lease", (_, answer) => {
    for (const opts of [{ self: HOLDER }, { self: PREDECESSOR }, { self: PREDECESSOR, takeover: "it looked idle", holder: "dead" }]) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { answer, ...opts });
      expect(error.message).toMatch(/An unknown lease is not the caller's lease/);
    }
  });

  it.each([null, undefined, "", {}, "comments", 0])("reads %j as a thread that was not read", (comments) => {
    expect(releaseDecision({ issue: ISSUE, comments, self: HOLDER, now: NOW })).toMatchObject({ ok: false, code: "RELEASE_THREAD_UNREADABLE", claim: null });
  });
});

// #643 review, finding 1: postRelease took `self`, `read` and `liveness` from its caller, so a caller
// could say it was the holder. It now takes only what cannot be measured: which issue, the Handoff,
// and how to file the row.
describe("postRelease: what it measures is never passed in (#643)", () => {
  const bad = (request, opts = {}) => {
    const run = attempt({ self: PREDECESSOR, request, ...opts });
    expect(run.result).toBeNull();
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_BAD_REQUEST");
    expect(run.error.cure).toBe("Nothing was written and nothing was read.");
    expect(run.calls, "a bad request reads nothing").toEqual([]);
    expect(run.sent).toEqual([]);
    return run.error;
  };

  it("refuses the reviewer's input: the predecessor handing in the successor's seat and a thread of its own", () => {
    const error = bad({ issue: ISSUE, body: RELEASED, self: HOLDER, read: () => INCIDENT });
    expect(error.message).toContain("This request also carries self, read.");
    expect(error.message).toContain("are measured here, never passed in");
  });

  it.each([
    ["self", HOLDER],
    ["read", () => INCIDENT],
    ["comments", INCIDENT],
    ["liveness", () => "dead"],
    ["now", new Date("2027-01-01T00:00:00Z")],
    ["ids", IDS],
    ["exec", () => ""],
    ["folder", HOLDER.folder],
    ["branch", HOLDER.branch],
    ["lastVerified", "2026-07-30"],
    ["claim", B_CLAIM],
    ["force", true],
  ])("refuses a request that carries `%s`, before anything is read", (key, value) => {
    expect(bad({ issue: ISSUE, body: RELEASED, cacheDir: tmp, [key]: value }).message).toContain(`This request also carries ${key}.`);
    expect(bad({ issue: ISSUE, body: RELEASED, [key]: value }, { self: HOLDER }).message).toContain(`This request also carries ${key}.`);
  });

  it.each([
    ["no request", undefined, /names its issue by number/],
    ["a word", "release", /names its issue by number/],
    ["no issue", { body: RELEASED }, /names its issue by number/],
    ["an issue given as text", { issue: String(ISSUE), body: RELEASED }, /names its issue by number/],
    ["issue 0", { issue: 0, body: RELEASED }, /names its issue by number/],
    ["a negative issue", { issue: -5, body: RELEASED }, /names its issue by number/],
    ["a fractional issue", { issue: 1.5, body: RELEASED }, /names its issue by number/],
    ["no Handoff at all", { issue: ISSUE }, /takes the Handoff once/],
    ["the Handoff twice", { issue: ISSUE, body: RELEASED, handoff: { claim: "released" } }, /takes the Handoff once/],
    ["a body that is not text", { issue: ISSUE, body: 5 }, /`body` is the Handoff as Markdown text/],
    ["Handoff fields that are a word", { issue: ISSUE, handoff: "released" }, /`handoff` is the Handoff's fields/],
    ["takeover: true", { issue: ISSUE, body: RELEASED, takeover: true }, /`takeover` is the evidence that was checked, in words, or absent/],
    ["takeover: false", { issue: ISSUE, body: RELEASED, takeover: false }, /`takeover` is the evidence/],
    ["takeover as an object", { issue: ISSUE, body: RELEASED, takeover: { reason: "gone" } }, /`takeover` is the evidence/],
    ["a dry run that is a word", { issue: ISSUE, body: RELEASED, dryRun: "yes" }, /`dryRun` is true or false/],
    ["a cache folder that is not a path", { issue: ISSUE, body: RELEASED, cacheDir: 5 }, /`cacheDir` is a folder path/],
  ])("refuses %s, before anything is read", (_, request, reason) => {
    expect(bad(request, { self: HOLDER }).message).toMatch(reason);
  });
});

// The dormant-lease route (docs/WORK_CONTROL.md): a lease whose session is gone is ended from another
// folder. It is asked for by name, it carries the evidence in words, and it is measured: never a
// holder that is running, and otherwise only a holder that is dead or a claim whose own clock ran out.
describe("postRelease: a takeover is asked for, measured and recorded (#643)", () => {
  const REASON = "worktree removed on 2026-10-02; no claude.exe has it open; its transcript is cold";
  const ON_MAIN = { folder: HOLDER.folder, branch: "main" };
  const DEAD = "the holding session is dead (no live process, transcript cold)";
  const NO_RECORD = "no session record for the holding folder exists on this machine";
  const NOT_MEASURABLE = "whether the holding session is running could not be measured";

  it("is never implied: a dead holder and a clock run out do not make a release a takeover", () => {
    const { asked } = refusedRun("RELEASE_NOT_HOLDER", { thread: LAPSED, self: PREDECESSOR, holder: "dead" });
    expect(asked, "the holding session was measured for a release that asked for no takeover").toEqual([]);
  });

  it.each([undefined, null, false])("reads takeover: %j as no takeover asked for", (takeover) => {
    let probed = 0;
    const liveness = () => { probed += 1; return "dead"; };
    expect(releaseDecision({ issue: ISSUE, comments: LAPSED, self: PREDECESSOR, takeover, liveness, now: NOW })).toMatchObject({ ok: false, code: "RELEASE_NOT_HOLDER" });
    expect(probed).toBe(0);
  });

  it.each(["", "   ", " \n\t "])("refuses a takeover with no evidence in words (%j)", (takeover) => {
    const { error, asked } = refusedRun("RELEASE_TAKEOVER_NO_REASON", { thread: LAPSED, self: PREDECESSOR, takeover, holder: "dead" });
    expect(error.message).toContain(LAPSED[0].url);
    expect(asked).toEqual([]);
  });

  it.each([true, {}, { reason: " " }, { reason: null }])("reads takeover: %j as a takeover with no evidence", (takeover) => {
    expect(releaseDecision({ issue: ISSUE, comments: LAPSED, self: PREDECESSOR, takeover, liveness: () => "dead", now: NOW })).toMatchObject({
      ok: false,
      code: "RELEASE_TAKEOVER_NO_REASON",
    });
  });

  it("refuses the holder taking over its own lease", () => {
    const error = refused("RELEASE_TAKEOVER_NOT_NEEDED", { takeover: REASON, holder: "dead" });
    expect(error.cure).toBe("Nothing was written. Release without --takeover.");
  });

  // #643 review, finding 5: from the claimed folder on another branch, a takeover skipped the branch
  // check and never asked whether the holder was running. A takeover ends ANOTHER folder's lease.
  describe.each([
    ["past its expiry", LAPSED],
    ["inside its expiry", INCIDENT],
  ])("from the claimed folder itself, a claim %s", (_, thread) => {
    it.each(["live", "dead", "none"])("refuses the takeover whatever the holding session is (%s)", (holder) => {
      const { error, asked } = refusedRun("RELEASE_TAKEOVER_SAME_FOLDER", { thread, self: ON_MAIN, takeover: "it looked idle", holder });
      expect(error.reason).toContain(`and this folder is ${HOLDER.folder} @ main.`);
      expect(error.cure).toBe(`Nothing was written. Check out ${HOLDER.branch} and release without --takeover, or post a refreshed Ownership claim from here first.`);
      expect(asked).toEqual([]);
    });

    it("refuses it on a detached HEAD, and with no evidence given", () => {
      expect(refused("RELEASE_TAKEOVER_SAME_FOLDER", { thread, self: { folder: HOLDER.folder, branch: null }, takeover: "it looked idle" }).reason).toContain(
        `and this folder is ${HOLDER.folder} @ (detached HEAD).`,
      );
      refused("RELEASE_TAKEOVER_SAME_FOLDER", { thread, self: ON_MAIN, takeover: "" });
    });
  });

  it("refuses it from the claimed folder when the claim names no branch, and says what to post", () => {
    const error = refused("RELEASE_TAKEOVER_SAME_FOLDER", { thread: lapsedClaim({ drop: ["Branch"] }), self: ON_MAIN, takeover: REASON, holder: "dead" });
    expect(error.cure).toBe("Nothing was written. Post a refreshed Ownership claim from here that names this folder's branch, then release without --takeover.");
  });

  it.each([
    ["past its expiry", LAPSED],
    ["inside its expiry", INCIDENT],
  ])("never takes over a holder that is running, whatever its expiry says: a claim %s", (_, thread) => {
    const { error, asked } = refusedRun("RELEASE_HOLDER_LIVE", { thread, self: PREDECESSOR, takeover: REASON, holder: "live" });
    expect(error.message).toContain(thread.at(-1).url);
    expect(error.message).toContain("A live holder is never taken over, whatever its expiry says.");
    expect(asked).toEqual([HOLDER.folder]);
  });

  it("takes over a dead holder before its clock runs out", () => {
    const { body, asked } = allowed({ self: PREDECESSOR, takeover: REASON, holder: "dead" }, "takeover");
    expect(body).toContain(`- Measured: ${DEAD}; the claim's clock had not run out\n`);
    expect(asked).toEqual([HOLDER.folder]);
  });

  // Everything that is not a measured "dead": no record, a record that cannot be read, a word the
  // probe does not have, no answer, a probe that failed. None of them ends a lease inside its expiry.
  describe.each([
    ["no session record", "none", NO_RECORD],
    ["a session record that cannot be read", "corrupt", NOT_MEASURABLE],
    ["a word the probe does not have", "probably dead", NOT_MEASURABLE],
    ["no answer", () => undefined, NOT_MEASURABLE],
    ["a probe that fails", () => { throw new Error("EPERM: operation not permitted, scandir"); }, NOT_MEASURABLE],
  ])("with %s for the holding folder", (_, holder, words) => {
    it("refuses a takeover inside the claim's expiry", () => {
      const { error, asked } = refusedRun("RELEASE_LEASE_NOT_LAPSED", { self: PREDECESSOR, takeover: REASON, holder });
      expect(error.reason).toBe(
        `#${ISSUE}'s lease is not shown to be dormant: ${held(B_CLAIM)}. Measured: ${words}, and its clock runs until 2026-10-03T17:22:01.000Z (its Claim expires line). A reason alone does not end another session's lease.`,
      );
      expect(asked).toEqual([HOLDER.folder]);
    });

    it("allows it once the claim's own clock has run out, and records both", () => {
      const { body } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover: REASON, holder }, "takeover");
      expect(body).toContain(`- Measured: ${words}; the claim's clock ran out at 2026-10-02T12:00:00.000Z (its Claim expires line)\n`);
    });
  });

  it.each([null, undefined, "dead", { liveness: "dead" }])("takes a probe that is not a function (%j) as nothing measured", (liveness) => {
    const ask = (comments) => releaseDecision({ issue: ISSUE, comments, self: PREDECESSOR, takeover: REASON, liveness, now: NOW });
    expect(ask(INCIDENT)).toMatchObject({ ok: false, code: "RELEASE_LEASE_NOT_LAPSED" });
    expect(ask(LAPSED)).toMatchObject({ ok: true, via: "takeover", takeover: { holder: "unknown", lapsedAt: "2026-10-02T12:00:00.000Z" } });
  });

  it("counts a claim with no expiry line by the 12-hour default, to the second", () => {
    const thread = claimedBy(HOLDER, { drop: ["Claim expires"] });
    const early = refused("RELEASE_LEASE_NOT_LAPSED", { thread, self: PREDECESSOR, takeover: REASON, now: new Date("2026-10-03T17:22:00Z") });
    expect(early.reason).toContain("its clock runs until 2026-10-03T17:22:01.000Z (the 12-hour default)");
    const { body } = allowed({ thread, self: PREDECESSOR, takeover: REASON, now: new Date("2026-10-03T17:22:01Z") }, "takeover");
    expect(body).toContain("the claim's clock ran out at 2026-10-03T17:22:01.000Z (the 12-hour default)");
    expect(body).toContain("expires (none stated: the 12-hour default)\n");
  });

  // Six hours, not twelve: read without the posting time, the term is no expiry at all.
  it("counts an expiry written as a term from the time the claim was posted, to the second", () => {
    const thread = claimedBy(HOLDER, { expires: "6 hours" });
    const early = refused("RELEASE_LEASE_NOT_LAPSED", { thread, self: PREDECESSOR, takeover: REASON, now: new Date("2026-10-03T11:22:00Z") });
    expect(early.reason).toContain("its clock runs until 2026-10-03T11:22:01.000Z (its Claim expires line)");
    const { body } = allowed({ thread, self: PREDECESSOR, takeover: REASON, now: new Date("2026-10-03T11:22:01Z") }, "takeover");
    expect(body).toContain("the claim's clock ran out at 2026-10-03T11:22:01.000Z (its Claim expires line)");
  });

  it("does not take an expiry it cannot read as run out, however much later it is", () => {
    const thread = claimedBy(HOLDER, { expires: "when the review lands" });
    const now = new Date("2027-10-03T00:00:00Z");
    const error = refused("RELEASE_LEASE_NOT_LAPSED", { thread, self: PREDECESSOR, takeover: REASON, now });
    expect(error.reason).toContain(`Measured: ${NO_RECORD}, and its clock cannot be read, so it cannot be shown to have run out.`);
    const { body } = allowed({ thread, self: PREDECESSOR, takeover: REASON, holder: "dead", now }, "takeover");
    expect(body).toContain(`- Measured: ${DEAD}; the claim's clock could not be read\n`);
  });

  it("asks about the folder the claim names, however the claim writes it", () => {
    const thread = lapsedClaim({ folder: `\`${HOLDER.folder}\` (created fresh by the launcher)` });
    expect(allowed({ thread, self: PREDECESSOR, takeover: REASON, holder: "dead" }, "takeover").asked).toEqual([HOLDER.folder]);
  });

  it("does not measure a claim that names no folder: only its clock can end it", () => {
    const opts = { drop: ["Worktree folder"] };
    const early = refusedRun("RELEASE_LEASE_NOT_LAPSED", { thread: claimedBy(HOLDER, opts), self: PREDECESSOR, takeover: REASON, holder: "dead" });
    expect(early.error.reason).toContain("Measured: the holding session was not measured (the claim names no folder to measure), and its clock runs until");
    expect(early.asked).toEqual([]);
    const late = allowed({ thread: lapsedClaim(opts), self: PREDECESSOR, takeover: REASON, holder: "live" }, "takeover");
    expect(late.body).toContain("- Measured: the holding session was not measured (the claim names no folder to measure); the claim's clock ran out at");
    expect(late.body).toContain(`- Held by: (no folder named) @ ${HOLDER.branch}\n`);
    expect(late.asked).toEqual([]);
  });

  it("writes the takeover into the comment: whose lease, from where, what was measured, and the evidence", () => {
    const { body, result } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover: REASON, holder: "dead" }, "takeover");
    expect(body).toBe(
      [
        RELEASED.trimEnd(),
        "",
        TAKEOVER_HEADER,
        "",
        `- Previous lease: Claude Code on ${held(LAPSED[0])}, expires 2026-10-02T12:00:00Z`,
        `- Released from: ${PREDECESSOR.folder} @ ${PREDECESSOR.branch}`,
        `- Measured: ${DEAD}; the claim's clock ran out at 2026-10-02T12:00:00.000Z (its Claim expires line)`,
        `- Worktree/process evidence checked: ${REASON}`,
        "",
        RELEASE_RECORD_HEADER,
        "",
        "- Ends claim: 2026-10-02T00:00:00Z",
        `- Held by: ${HOLDER.folder} @ ${HOLDER.branch}`,
        `- Link: ${LAPSED[0].url}`,
        "",
      ].join("\n"),
    );
    expect(parseHandoff(body)).toMatchObject({ released: true, nextAction: "Kuya reviews." });
    expect(result.claim.url).toBe(LAPSED[0].url);
  });

  it("keeps the evidence on one line, so it cannot write a section of its own", () => {
    const takeover = ["gone", RELEASE_RECORD_HEADER, "- Ends claim: 2020-01-01T00:00:00Z", HANDOFF_HEADER, "- Claim: HELD", "", claimText(THIRD)].join("\n");
    const { body } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover, holder: "dead" }, "takeover");
    expect(body.split("\n").filter((l) => l.startsWith("#"))).toEqual([HANDOFF_HEADER, TAKEOVER_HEADER, RELEASE_RECORD_HEADER]);
    expect(body).toContain("- Worktree/process evidence checked: gone ### Release record - Ends claim: 2020-01-01T00:00:00Z ### Handoff - Claim: HELD ### Ownership claim");
    expect(parseClaim(body)).toBeNull();
    expect(parseReleaseRecord(body)).toEqual({ ends: ["2026-10-02T00:00:00Z"] });
  });

  it("answers a takeover with what it measured", () => {
    const decision = releaseDecision({ issue: ISSUE, comments: LAPSED, self: PREDECESSOR, takeover: { reason: `  ${REASON}\n` }, liveness: () => "dead", now: NOW });
    expect(decision).toMatchObject({ ok: true, via: "takeover", takeover: { reason: REASON, holder: "dead", lapsedAt: "2026-10-02T12:00:00.000Z", clockBy: "its Claim expires line" } });
    expect(decision.claim.url).toBe(LAPSED[0].url);
  });
});

describe("postRelease: the comment must be a release, and only a release (#643)", () => {
  const handoff = (...lines) => [HANDOFF_HEADER, "", "- Exact next action: Kuya reviews.", ...lines].join("\n");

  it.each([
    ["a Handoff that holds", handoff("- Claim: HELD until the review lands. Released only then.")],
    ["a Handoff that transfers", handoff("- Claim: transferred to codex until 2026-10-04T08:00Z")],
    ["a Handoff with no Claim line", handoff()],
    ["one Claim line that releases beside one that holds", handoff("- Claim: released", "- Claim: HELD for the follow-up")],
    ["a plain note", "Released. Kuya reviews."],
    ["a Handoff header one space in", ` ${RELEASED}`],
    ["an empty file", ""],
    ["a Handoff inside a code fence", `\`\`\`\n${RELEASED}\n\`\`\``],
  ])("refuses %s: it would not end the lease", (_, body) => {
    expect(refused("RELEASE_WOULD_NOT_RELEASE", { body }).reason).toMatch(/does not end a lease/);
  });

  it.each([{}, { outcome: "done", nextAction: "Kuya reviews." }, { claim: "HELD until review" }, { claim: "transferred to codex" }])(
    "refuses Handoff fields that do not release (%j)",
    (handoff) => {
      expect(refused("RELEASE_WOULD_NOT_RELEASE", { handoff }).reason).toMatch(/does not end a lease/);
    },
  );

  it("renders Handoff fields into the comment it posts", () => {
    const { body } = allowed({ handoff: { outcome: "done", nextAction: "Kuya reviews.", claim: "released" } });
    expect(body).toBe(withRecord(RELEASED, B_CLAIM));
  });

  it("refuses a comment that releases and claims at once", () => {
    const error = refused("RELEASE_WOULD_NOT_RELEASE", { body: `${RELEASED}\n\n${claimText(PREDECESSOR)}` });
    expect(error.reason).toMatch(/carries an Ownership claim as well/);
  });

  // The record is the last thing in the comment. A Handoff text that leaves a block open would
  // swallow it, and the comment would be a release with no record: one that ends whichever claim is
  // live when it lands.
  it.each([
    ["a backtick fence", "```\nlog line"],
    ["a tilde fence", "~~~\nlog line"],
    ["an HTML comment", "<!-- note"],
    ["a <pre> block", "<pre>\nlog line"],
    ["a <script> block", "<script>\nlog line"],
  ])("refuses a Handoff that leaves %s open after it: the record would not be read", (_, open) => {
    const error = refused("RELEASE_RECORD_UNREADABLE", { body: `${RELEASED}\n\n${open}` });
    expect(error.reason).toContain("leaves a code fence or an HTML block open");
    expect(error.cure).toBe("Nothing was written. Close the fence or the HTML block in the Handoff and run it again.");
  });

  it.each([
    ["a code fence", "```\nlog"],
    ["an HTML comment", "<!-- note"],
  ])("refuses a Handoff that sits inside %s left open", (_, open) => {
    refused("RELEASE_WOULD_NOT_RELEASE", { body: `${open}\n\n${RELEASED}` });
  });

  it("allows a <details> left open: it hides nothing from the reader of the thread", () => {
    const { body } = allowed({ body: `${RELEASED}\n\n<details>\nlog line` });
    expect(parseReleaseRecord(body)).toEqual({ ends: [B_CLAIM.createdAt] });
  });

  it.each([
    ["naming the live claim", "", B_CLAIM.createdAt],
    ["naming another claim", "", A_CLAIM.createdAt],
    ["three spaces in", "   ", B_CLAIM.createdAt],
    ["with no Ends claim line", "", null],
  ])("refuses a Handoff text that brings a Release record of its own (%s)", (_, indent, stamp) => {
    const own = [`${indent}${RELEASE_RECORD_HEADER}`, "", stamp ? `- Ends claim: ${stamp}` : "- Held by: someone"].join("\n");
    const error = refused("RELEASE_BODY_HAS_RECORD", { body: `${RELEASED}\n\n${own}` });
    expect(error.reason).toContain("The release writes that itself, from the claim it checked.");
  });

  it.each([
    ["a record header four spaces in (a code block)", `${RELEASED}\n\n    ${RELEASE_RECORD_HEADER}\n\n    - Ends claim: 2020-01-01T00:00:00Z`],
    ["a record inside a closed fence", `${RELEASED}\n\n\`\`\`\n${RELEASE_RECORD_HEADER}\n\n- Ends claim: 2020-01-01T00:00:00Z\n\`\`\``],
    ["a stray Ends claim line inside the Handoff", `${RELEASED}\n- Ends claim: 2020-01-01T00:00:00Z`],
  ])("writes its own record after %s, and that is the one read", (_, body) => {
    const run = allowed({ body });
    expect(parseReleaseRecord(run.body)).toEqual({ ends: [B_CLAIM.createdAt] });
    expect(run.body.endsWith(withRecord("", B_CLAIM).trimStart())).toBe(true);
  });

  // A release names its claim by the time GitHub gave it. A comment read without that time, whatever
  // it holds, makes the thread one that was not read (round 4 of the review: on 71bd4e38 such a thread
  // was let through to a shared-time refusal whose cure, a refreshed claim, could not cure it). Every
  // comment is held to the one shape GitHub writes.
  const NO_TIME = [undefined, null, "", "2026-10-03", "yesterday", "2026-10-03T07:22:01+02:00", "2026-10-03T05:22:01", 1_759_468_921_000];
  const timed = (comment, createdAt) => ({ body: comment.body, url: comment.url, ...(createdAt === undefined ? {} : { createdAt }) });
  it.each(NO_TIME)("refuses to read a thread whose live claim carries %j for its posting time, from every seat", (createdAt) => {
    const answer = () => JSON.stringify({ comments: [A_CLAIM, A_RELEASE, timed(B_CLAIM, createdAt)] });
    for (const opts of [{ self: HOLDER }, { self: PREDECESSOR }, { self: PREDECESSOR, takeover: "it looked idle", holder: "dead" }, { self: HOLDER, dryRun: true }]) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { answer, ...opts });
      expect(error.reason).toBe(`The thread of #${ISSUE} could not be read (a comment arrived without the time it was posted), so who holds its lease is unknown. An unknown lease is not the caller's lease.`);
      expect(error.cure).toBe("Nothing was written. Run it again when GitHub answers.");
    }
  });

  it.each(NO_TIME)("refuses to read a thread where any other comment carries %j for its posting time", (createdAt) => {
    for (const comments of [
      [timed(A_CLAIM, createdAt), A_RELEASE, B_CLAIM],
      [A_CLAIM, timed(A_RELEASE, createdAt), B_CLAIM],
      [...INCIDENT, timed(posted("", "Just a note.", 30), createdAt)],
    ]) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { answer: () => JSON.stringify({ comments }) });
      expect(error.reason).toContain("(a comment arrived without the time it was posted)");
    }
  });

  it("reads a thread whose every comment carries its time, in the shape GitHub writes it", () => {
    for (const createdAt of ["2026-10-03T05:22:01Z", "2026-10-03T05:22:01.000Z", " 2026-10-03T05:22:01Z\n"]) {
      const run = allowed({ thread: [A_CLAIM, A_RELEASE, timed(B_CLAIM, createdAt)] });
      expect(parseReleaseRecord(run.body)).toEqual({ ends: [createdAt.trim()] });
    }
  });

  // Round 5 of the review of PR 644 (round 4's third finding): a stamp in GitHub's shape naming a day
  // that is not on the calendar, 2026-02-30T05:22:01Z, read as March 2 on c5a085bd. Such a stamp names
  // no time, and the refusal says which stamp it was rather than that none arrived.
  const OFF_CALENDAR = [
    "2026-02-30T05:22:01Z",
    "2026-02-29T05:22:01Z",
    "2026-04-31T05:22:01Z",
    "2026-13-01T05:22:01Z",
    "2026-00-10T05:22:01Z",
    "2026-01-00T05:22:01Z",
    "2026-01-32T05:22:01Z",
    "2026-10-03T24:00:00Z",
    "2026-10-03T23:60:00Z",
    "2026-10-03T23:59:60Z",
    "2100-02-29T00:00:00Z",
  ];
  it.each(OFF_CALENDAR)("refuses to read a thread whose live claim was stamped %s, a time not on the calendar, from every seat", (createdAt) => {
    const answer = () => JSON.stringify({ comments: [A_CLAIM, A_RELEASE, timed(B_CLAIM, createdAt)] });
    for (const opts of [{ self: HOLDER }, { self: PREDECESSOR }, { self: PREDECESSOR, takeover: "it looked idle", holder: "dead" }, { self: HOLDER, dryRun: true }]) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { answer, ...opts });
      expect(error.reason).toBe(
        `The thread of #${ISSUE} could not be read (a comment carries the posting time ${createdAt}, which is not on the calendar), so who holds its lease is unknown. An unknown lease is not the caller's lease.`,
      );
      expect(error.cure).toBe("Nothing was written. Run it again when GitHub answers.");
    }
  });

  it("refuses to read a thread where any other comment carries a time not on the calendar", () => {
    for (const comments of [
      [timed(A_CLAIM, "2026-02-30T03:10:00Z"), A_RELEASE, B_CLAIM],
      [A_CLAIM, timed(A_RELEASE, "2026-02-30T05:21:02Z"), B_CLAIM],
      [...INCIDENT, timed(posted("", "Just a note.", 30), "2026-02-30T05:25:00Z")],
    ]) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { answer: () => JSON.stringify({ comments }) });
      expect(error.reason).toMatch(/\(a comment carries the posting time 2026-02-30T\d{2}:\d{2}:\d{2}Z, which is not on the calendar\)/);
    }
  });

  // The reviewer's scenario, whole: the live claim is stamped 2026-02-30T05:22:01Z and carries no expiry
  // line; the caller is another folder with a takeover reason; the holder has no session record; the
  // clock reads 2026-03-03. On c5a085bd the default clock ran from March 2, and the takeover went through.
  describe("the reviewer's scenario: a claim stamped on a day that is not on the calendar, taken over", () => {
    const ROLLED = "2026-02-30T05:22:01Z";
    const comments = [A_CLAIM, A_RELEASE, posted(ROLLED, claimText(HOLDER, { drop: ["Claim expires"] }), 3)];
    const later = new Date("2026-03-03T00:00:00Z");

    it("is refused as a thread that was not read, before any takeover is weighed", () => {
      const error = refused("RELEASE_THREAD_UNREADABLE", { thread: comments, self: PREDECESSOR, takeover: "it looked idle", holder: "none", now: later });
      expect(error.reason).toContain(`(a comment carries the posting time ${ROLLED}, which is not on the calendar)`);
    });

    it("is no takeover even at the bare decision: a clock that cannot be read is never shown to have run out", () => {
      const decision = releaseDecision({ issue: ISSUE, comments, self: PREDECESSOR, takeover: "it looked idle", liveness: () => "none", now: later });
      expect(decision).toMatchObject({ ok: false, code: "RELEASE_LEASE_NOT_LAPSED" });
      expect(decision.reason).toContain("its clock cannot be read, so it cannot be shown to have run out");
      expect(decision.via).toBeUndefined();
    });
  });

  // `releaseComment` on its own, handed a thread the reader would have refused: it names no claim by a
  // time it does not have, and says which claim had none. The decision above it is the holder's.
  describe("names its claim by a time that is one claim's alone", () => {
    const decide = (comments) => releaseDecision({ issue: ISSUE, comments, self: HOLDER, now: NOW });
    const comment = (comments) => claimModule.releaseComment({ issue: ISSUE, comments, decision: decide(comments), self: HOLDER, text: RELEASED, now: NOW });
    const WHEN = "Nothing was written. Run it again when GitHub answers with the thread's posting times.";

    it("refuses when the live claim has no time: nothing could name it", () => {
      const undated = { body: B_CLAIM.body, url: B_CLAIM.url };
      expect(decide([A_CLAIM, A_RELEASE, undated]).ok, "the holder's decision stands; the time is the comment's problem").toBe(true);
      const r = comment([A_CLAIM, A_RELEASE, undated]);
      expect(r).toMatchObject({ ok: false, code: "RELEASE_CLAIM_UNDATED", cure: WHEN });
      expect(r.reason).toBe(
        `The live claim on #${ISSUE} was read without the time it was posted (${HOLDER.folder} @ ${HOLDER.branch}, claimed (time unknown) (${B_CLAIM.url})), so a release could not name it and would end whichever claim is live when it lands.`,
      );
    });

    it.each([
      ["a released predecessor's", [{ body: A_CLAIM.body, url: A_CLAIM.url }, A_RELEASE, B_CLAIM], A_CLAIM, PREDECESSOR],
      ["a later, released claim's", [...INCIDENT, { body: claimText(THIRD), url: C_CLAIM.url }, posted("2026-10-03T05:30:27Z", RELEASED, 10), posted("2026-10-03T05:30:28Z", claimText(HOLDER), 11)], C_CLAIM, THIRD],
    ])("refuses when another claim has no time (%s): it could have been posted at any", (_, comments, which, seat) => {
      const r = comment(comments);
      expect(r).toMatchObject({ ok: false, code: "RELEASE_CLAIM_UNDATED", cure: WHEN });
      expect(r.reason).toBe(
        `An Ownership claim on #${ISSUE} was read without the time it was posted (${seat.folder} @ ${seat.branch}, claimed (time unknown) (${which.url})). A release names the claim it ends by its posting time, and a claim with no time could have been posted at any, so this release would be posted and end nothing.`,
      );
    });

    it("refuses two dated claims in one second as a shared time, and no undated claim that way", () => {
      const shared = comment([posted(B_CLAIM.createdAt, claimText(PREDECESSOR), 2), B_CLAIM]);
      expect(shared).toMatchObject({ ok: false, code: "RELEASE_CLAIM_TIME_SHARED" });
      expect(shared.reason).not.toContain("without");
      expect(shared.cure).toContain("Post a refreshed Ownership claim from the holding folder");
    });

    it("builds the comment when every claim has a time of its own", () => {
      const r = comment([posted(B_CLAIM.createdAt, claimText(PREDECESSOR), 2), B_CLAIM, posted("2026-10-03T05:22:02Z", claimText(HOLDER), 4)]);
      expect(r.ok, String(r.reason)).toBe(true);
      expect(parseReleaseRecord(r.body)).toEqual({ ends: ["2026-10-03T05:22:02Z"] });
    });
  });

  // Round 2 of the review: a record names its claim by posting time, and GitHub stamps to the second.
  // A time two claims share names neither, so the release is refused before anything is posted.
  describe("refuses a release whose record would name a time two claims share", () => {
    const T = B_CLAIM.createdAt;
    const aAtT = posted(T, claimText(PREDECESSOR), 2);
    const SHARED = `Another Ownership claim on #${ISSUE} was posted in the same second as the live one (${held(B_CLAIM)}). A release names the claim it ends by that time, and a time two claims share names neither, so this release would be posted and end nothing.`;

    it("the reviewer's input: the holder's claim and another, both stamped the same second", () => {
      const error = refused("RELEASE_CLAIM_TIME_SHARED", { thread: [aAtT, B_CLAIM] });
      expect(error.reason).toBe(SHARED);
      expect(error.cure).toBe(
        "Nothing was written. Post a refreshed Ownership claim from the holding folder, which gets a time of its own, and release that. Where no session is left there to post one, this tool cannot end the lease: mark the row Needs Kuya.",
      );
    });

    it.each([
      ["the other claim was released since", [aAtT, posted(T, RELEASED, 20), B_CLAIM]],
      ["the other claim came after, over the holder's", [B_CLAIM, posted(T, claimText(PREDECESSOR), 2), posted(T, RELEASED, 21), posted(T, claimText(HOLDER), 22)]],
    ])("refuses when %s", (_, thread) => {
      const error = refused("RELEASE_CLAIM_TIME_SHARED", { thread });
      expect(error.reason).toContain("A release names the claim it ends by that time, and a time two claims share names neither");
    });

    it("refuses a dry run the same way", () => {
      expect(refused("RELEASE_CLAIM_TIME_SHARED", { thread: [aAtT, B_CLAIM], dryRun: true }).reason).toBe(SHARED);
    });

    it("releases a refreshed claim that has a second of its own, and its record names that second", () => {
      const fresh = posted("2026-10-03T05:22:02Z", claimText(HOLDER), 4);
      const run = allowed({ thread: [aAtT, B_CLAIM, fresh] });
      expect(parseReleaseRecord(run.body)).toEqual({ ends: ["2026-10-03T05:22:02Z"] });
      expect(run.result.claim.url).toBe(fresh.url);
    });
  });
});

// #643 review, finding 4: the check and the post are two calls, and GitHub has no conditional write.
// A release the tool posts therefore says which claim it ends, and the fold ends that claim and no
// other. A claim that lands in between is left standing, and the release is reported, not obeyed.
describe("a release names the claim it ends (#643)", () => {
  const AT = "2026-10-03T05:30:25Z";
  const record = (...lines) => [RELEASE_RECORD_HEADER, "", ...lines].join("\n");
  const naming = (...lines) => posted(AT, `${RELEASED}\n\n${record(...lines)}\n`, 9);
  const fold = (release, thread = [B_CLAIM]) => threadLease([...thread, release]);

  it.each([
    ["the claim's posting time", ["- Ends claim: 2026-10-03T05:22:01Z"]],
    ["that time with milliseconds", ["- Ends claim: 2026-10-03T05:22:01.000Z"]],
    ["that time in a code span", ["- Ends claim: `2026-10-03T05:22:01Z`"]],
    ["that time twice", ["- Ends claim: 2026-10-03T05:22:01Z", "- Ends claim: 2026-10-03T05:22:01.000Z"]],
    ["that time under a lower-case label", ["- ends claim: 2026-10-03T05:22:01Z"]],
    ["that time among its other lines", [`- Held by: ${HOLDER.folder} @ ${HOLDER.branch}`, "- Ends claim: 2026-10-03T05:22:01Z", `- Link: ${B_CLAIM.url}`]],
  ])("ends the claim when its record names %s", (_, lines) => {
    const lease = fold(naming(...lines));
    expect(lease.claim).toBeNull();
    expect(lease.handoff).toMatchObject({ released: true, postedAt: AT, nextAction: "Kuya reviews." });
  });

  it.each([
    ["a time one second off", ["- Ends claim: 2026-10-03T05:22:02Z"]],
    ["another claim's time", ["- Ends claim: 2026-10-03T03:10:00Z"]],
    ["a date alone", ["- Ends claim: 2026-10-03"]],
    ["no value", ["- Ends claim: "]],
    ["no Ends claim line", [`- Held by: ${HOLDER.folder} @ ${HOLDER.branch}`]],
    ["nothing at all", []],
    ["the right time beside a wrong one", ["- Ends claim: 2026-10-03T05:22:01Z", "- Ends claim: 2026-10-03T03:10:00Z"]],
    ["a sentence", ["- Ends claim: the successor's claim"]],
    ["the same instant in another zone", ["- Ends claim: 2026-10-03T07:22:01+02:00"]],
    ["a time with no zone", ["- Ends claim: 2026-10-03T05:22:01"]],
  ])("ends nothing when its record names %s: it is not a lease event at all", (_, lines) => {
    const lease = fold(naming(...lines));
    expect(lease.claim?.url).toBe(B_CLAIM.url);
    expect(lease.handoff).toBeNull();
  });

  it("ends nothing when its record header is indented three spaces and names another claim", () => {
    const lease = fold(posted(AT, `${RELEASED}\n\n   ${RELEASE_RECORD_HEADER}\n\n- Ends claim: 2026-10-03T03:10:00Z\n`, 9));
    expect(lease.claim?.url).toBe(B_CLAIM.url);
  });

  // Where a Handoff's reader is in doubt it reads nothing, which keeps a lease live. For a record the
  // same doubt goes the other way: a record that is missed would let the release end any claim.
  it.each([
    ["a fence left open in a list item", ["- an item", "  ```", "  left open", "after the item", ""]],
    ["a comment left open in a list item", ["- an item", "  <!-- a note", "-->", ""]],
    ["a lone tag that may continue a paragraph", ["a | b", "<span>"]],
  ])("reads a record after %s, so the release still ends only the claim it names", (_, between) => {
    const body = [RELEASED.trimEnd(), "", ...between, RELEASE_RECORD_HEADER, "", "- Ends claim: 2026-10-03T03:10:00Z", ""].join("\n");
    expect(parseHandoff(body)).toMatchObject({ released: true });
    expect(parseReleaseRecord(body)).toEqual({ ends: ["2026-10-03T03:10:00Z"] });
    const lease = fold(posted(AT, body, 9));
    expect(lease.claim?.url).toBe(B_CLAIM.url);
    expect(lease.handoff).toBeNull();
  });

  it("replays the incident with a release that names its claim: the successor's lease stands", () => {
    const late = posted(AT, withRecord(RELEASED, A_CLAIM, PREDECESSOR), 9);
    const lease = threadLease([...INCIDENT, late]);
    expect(lease.claim?.url).toBe(B_CLAIM.url);
    expect(lease.handoff).toMatchObject({ postedAt: A_RELEASE.createdAt, url: A_RELEASE.url });
  });

  // What the tool cannot change: a Handoff written by hand carries no record, and it is read as it
  // always was. Every release on every thread before #643 is one of these.
  it("still reads a release with no record as ending whichever claim is live: the incident as it happened", () => {
    const lease = threadLease([...INCIDENT, posted(AT, RELEASED, 9)]);
    expect(lease.claim).toBeNull();
    expect(lease.handoff).toMatchObject({ released: true, postedAt: AT });
  });

  it.each([
    ["four spaces in (a code block)", `${RELEASED}\n\n    ${RELEASE_RECORD_HEADER}\n\n    - Ends claim: 2026-10-03T03:10:00Z\n`],
    ["inside a closed fence", `${RELEASED}\n\n\`\`\`\n${RELEASE_RECORD_HEADER}\n\n- Ends claim: 2026-10-03T03:10:00Z\n\`\`\`\n`],
  ])("does not read a record written %s, so that release has none", (_, body) => {
    expect(parseReleaseRecord(body)).toBeNull();
    expect(fold(posted(AT, body, 9)).claim).toBeNull();
  });

  it("ends nothing with a named release on a thread read without posting times, and ends the claim with an unnamed one", () => {
    const undated = (body) => threadLease([{ body: B_CLAIM.body }, { body }]);
    expect(undated(withRecord(RELEASED, B_CLAIM)).claim).toMatchObject({ folder: HOLDER.folder });
    expect(undated(RELEASED).claim).toBeNull();
  });

  it("reads a Handoff that holds as a Handoff, whatever record it carries", () => {
    const holding = [HANDOFF_HEADER, "", "- Exact next action: Kuya reviews.", "- Claim: HELD until review", "", record("- Ends claim: 2026-10-03T03:10:00Z")].join("\n");
    const lease = fold(posted(AT, holding, 9));
    expect(lease.claim?.url).toBe(B_CLAIM.url);
    expect(lease.handoff).toMatchObject({ released: false, postedAt: AT });
  });

  it("reads a record's Ends claim lines, and nothing where there is no record", () => {
    expect(parseReleaseRecord(withRecord(RELEASED, B_CLAIM))).toEqual({ ends: [B_CLAIM.createdAt] });
    expect(parseReleaseRecord(record("- Ends claim: `2026-10-03T05:22:01Z`", "- Ends claim: x"))).toEqual({ ends: ["2026-10-03T05:22:01Z", "x"] });
    expect(parseReleaseRecord(record("- Held by: someone"))).toEqual({ ends: [] });
    for (const none of [RELEASED, B_CLAIM.body, "", null, undefined]) expect(parseReleaseRecord(none)).toBeNull();
  });

  describe("what a posted release did, read back off the thread", () => {
    const mine = posted(AT, withRecord(RELEASED, B_CLAIM), 9);
    const lateA = posted(AT, withRecord(RELEASED, A_CLAIM, PREDECESSOR), 9);

    it("ended its claim: that claim was live when it landed, and nobody has claimed since", () => {
      expect(releaseOutcome({ comments: [...INCIDENT, mine], index: 3 })).toMatchObject({ landed: "ended", before: { url: B_CLAIM.url }, next: null });
    });

    it("ended nothing: another claim was live when it landed", () => {
      expect(releaseOutcome({ comments: [...INCIDENT, lateA], index: 3 })).toMatchObject({ landed: "nothing", before: { url: B_CLAIM.url }, next: null });
      expect(releaseOutcome({ comments: [A_CLAIM, B_CLAIM, lateA], index: 2 })).toMatchObject({ landed: "nothing", before: { url: B_CLAIM.url } });
    });

    it("ended nothing: no claim was live when it landed", () => {
      expect(releaseOutcome({ comments: [A_CLAIM, A_RELEASE, lateA], index: 2 })).toEqual({ landed: "nothing", before: null, next: null });
    });

    it("was taken: it ended its claim, and a claim was posted after it, released since or not", () => {
      const cRelease = posted("2026-10-03T05:30:27Z", withRecord(RELEASED, C_CLAIM, THIRD), 10);
      expect(releaseOutcome({ comments: [...INCIDENT, mine, C_CLAIM], index: 3 })).toMatchObject({ landed: "taken", next: { url: C_CLAIM.url } });
      expect(releaseOutcome({ comments: [...INCIDENT, mine, C_CLAIM, cRelease], index: 3 })).toMatchObject({ landed: "taken", next: { url: C_CLAIM.url } });
    });

    // Round 2 of the review: the fold compared posting times as instants, so a release naming one
    // claim's time ended another claim posted in the same second. A time names a claim only while
    // exactly one claim on the thread was posted at it.
    it("ended nothing: the claim it names shares its second with the one that was live", () => {
      const aAtT = posted(B_CLAIM.createdAt, claimText(PREDECESSOR), 2);
      const lateA2 = posted(AT, withRecord(RELEASED, aAtT, PREDECESSOR), 9);
      expect(releaseOutcome({ comments: [aAtT, B_CLAIM, lateA2], index: 2 })).toMatchObject({ landed: "nothing", before: { url: B_CLAIM.url }, next: null });
      const lease = threadLease([aAtT, B_CLAIM, lateA2]);
      expect(lease.claim?.url).toBe(B_CLAIM.url);
      expect(lease.handoff).toBeNull();
    });
  });

  // Round 2 of the review, the whole class: on e0362db5 the fold compared posting times as instants,
  // so A's late release, naming A's claim at T, ended B's claim when B had also been stamped T. A
  // time names a claim only while exactly one claim on the thread so far was posted at it.
  describe("two claims in one second are named by neither", () => {
    const T = B_CLAIM.createdAt;
    const aAtT = posted(T, claimText(PREDECESSOR), 2);
    const lateA = posted(AT, withRecord(RELEASED, aAtT, PREDECESSOR), 9);
    const lateB = posted(AT, withRecord(RELEASED, B_CLAIM), 9);

    it.each([
      ["A's release, the reviewer's input", lateA],
      ["B's own release", lateB],
    ])("%s ends neither claim: B's lease stays live and the release is not the newest Handoff", (_, release) => {
      const lease = threadLease([aAtT, B_CLAIM, release]);
      expect(lease.claim?.url).toBe(B_CLAIM.url);
      expect(lease.handoff).toBeNull();
      expect(lease.run.map((c) => c.url)).toEqual([aAtT.url, B_CLAIM.url]);
    });

    it("counts a same-second claim that was released since: the time still names two", () => {
      const byHand = posted(T, RELEASED, 20);
      const lease = threadLease([aAtT, byHand, B_CLAIM, lateB]);
      expect(lease.claim?.url).toBe(B_CLAIM.url);
      expect(lease.handoff?.url, "the record-bearing release is not the newest Handoff; the hand-posted one before B's claim is").toBe(byHand.url);
      expect(lease.run.map((c) => c.url)).toEqual([B_CLAIM.url]);
    });

    it("counts a claim read without its time as possibly posted at any time", () => {
      const lease = threadLease([{ body: A_CLAIM.body, url: A_CLAIM.url }, B_CLAIM, lateB]);
      expect(lease.claim?.url).toBe(B_CLAIM.url);
      expect(lease.handoff).toBeNull();
    });

    it("ends a refreshed claim that has a second of its own, and a hand-posted release still ends the run", () => {
      const fresh = posted("2026-10-03T05:22:02Z", claimText(HOLDER), 4);
      const byTool = threadLease([aAtT, B_CLAIM, fresh, posted(AT, withRecord(RELEASED, fresh), 9)]);
      expect(byTool.claim).toBeNull();
      expect(byTool.handoff?.released).toBe(true);
      const byHand = threadLease([aAtT, B_CLAIM, posted(AT, RELEASED, 9)]);
      expect(byHand.claim).toBeNull();
    });

    it("folds the same thread alike whether or not the reader supplied comment links", () => {
      const unlinked = (c) => ({ body: c.body, createdAt: c.createdAt });
      for (const thread of [[aAtT, B_CLAIM, lateA], [aAtT, B_CLAIM, lateB], [A_CLAIM, B_CLAIM, lateA], [...INCIDENT, lateB]]) {
        const linked = threadLease(thread);
        const plain = threadLease(thread.map(unlinked));
        expect([plain.claim?.postedAt, plain.claim?.folder, plain.handoff?.postedAt, plain.run.length]).toEqual([
          linked.claim?.postedAt,
          linked.claim?.folder,
          linked.handoff?.postedAt,
          linked.run.length,
        ]);
      }
    });
  });

  // The reviewer's input, run: A reads the thread while its own claim is live, B becomes the live
  // claimant, then A's release lands.
  it.each([
    ["A released by hand and B claimed", [A_RELEASE, B_CLAIM]],
    ["B claimed over A's live claim", [B_CLAIM]],
  ])("leaves the successor's lease and the board row alone when it lands late: %s", (_, beforePost) => {
    const { error, result, sent, thread, drops } = attempt({ thread: [A_CLAIM], self: PREDECESSOR, beforePost });
    expect(result).toBeNull();
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ENDED_NOTHING");
    expect(sent.map((s) => s.describe), "a board field was edited for a release that ended nothing").toEqual([`comment on #${ISSUE}`]);
    expect(threadLease(thread).claim?.url).toBe(B_CLAIM.url);
    expect(error.message).toContain(`when it landed, the live claim was ${held(B_CLAIM)}, not the one it names.`);
    expect(error.message).toContain(`It names the claim it was checked against (${held(A_CLAIM, PREDECESSOR)}) and can end no other.`);
    expect(error).toMatchObject({ posted: true, url: thread.at(-1).url, live: { url: B_CLAIM.url }, ran: [SIX_STEPS[0]] });
    expect(drops).toBe(0);
  });

  it("says so when no claim was live as it landed, and edits no board field", () => {
    const { error, sent } = attempt({ beforePost: [posted("2026-10-03T05:30:24Z", RELEASED, 7)] });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ENDED_NOTHING");
    expect(error.message).toContain("but it ended nothing: no claim was live when it landed.");
    expect(error.live).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("says so when the claim live as it landed shares its second with the one it names, and edits no board field", () => {
    const bAtT = posted(A_CLAIM.createdAt, claimText(HOLDER), 3);
    const { error, sent, thread, drops } = attempt({ thread: [A_CLAIM], self: PREDECESSOR, beforePost: [bAtT] });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ENDED_NOTHING");
    expect(error.message).toContain(
      `when it landed, the live claim was ${held(bAtT)}, and its posting time is not one claim's alone on this thread (another was posted in the same second), so a record naming that time ends neither.`,
    );
    expect(error.message).toContain(`It names the claim it was checked against (${held(A_CLAIM, PREDECESSOR)}) and can end no other. No board field was edited.`);
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`]);
    expect(threadLease(thread).claim?.url).toBe(bAtT.url);
    expect(drops).toBe(0);
  });

  it.each([
    ["a claim", [C_CLAIM], C_CLAIM.url],
    ["a claim, released since", [C_CLAIM, posted("2026-10-03T05:30:27Z", withRecord(RELEASED, C_CLAIM, THIRD), 10)], null],
  ])("leaves the board row to %s posted straight after it", (_, afterPost, live) => {
    const { error, sent, thread, drops } = attempt({ afterPost });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_TAKEN");
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`]);
    expect(error.message).toContain(`A claim was posted after it (${held(C_CLAIM, THIRD)}), so the board row is that claim's and no board field was edited.`);
    expect(error).toMatchObject({ posted: true, live: { url: C_CLAIM.url }, cure: "Nothing is left to run." });
    expect(threadLease(thread).claim?.url ?? null).toBe(live);
    expect(drops).toBe(0);
  });

  it.each([0, 1, 2, 3, 4, 5])("reports a claim that lands while the row is being edited (after %i of the five edits), and sends hands to the thread first", (at) => {
    const { error, sent, thread, drops, reads } = attempt({ duringEdits: { at, comments: [C_CLAIM] } });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_RACED");
    expect(sent.map((s) => s.describe)).toEqual(SEVEN_WRITES);
    expect(error.message).toContain(
      `its lease is released and the board row is filed, but a claim landed while the row was being edited (${held(C_CLAIM, THIRD)}). The row may now hold this release's values over that claim's.`,
    );
    expect(error).toMatchObject({ posted: true, live: { url: C_CLAIM.url }, ran: SEVEN_STEPS, cure: CURES.RELEASE_ROW_RACED });
    expect(error).not.toHaveProperty("failed");
    noEditHandedOut(error.message);
    expect(threadLease(thread).claim?.url).toBe(C_CLAIM.url);
    expect(drops).toBe(1);
    expect(reads).toBe(3);
  });

  it("reports a raced claim that has been released since all the same: the row was filed over it", () => {
    const cRelease = posted("2026-10-03T05:30:27Z", withRecord(RELEASED, C_CLAIM, THIRD), 10);
    const { error, thread } = attempt({ duringEdits: { at: 3, comments: [C_CLAIM, cRelease] } });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_RACED");
    expect(error.live.url).toBe(C_CLAIM.url);
    expect(error.cure).toContain("If it has been released since, check the row against the newest Handoff on the thread.");
    expect(threadLease(thread).claim).toBeNull();
  });

  it.each([1, 2])("asks again when the thread is served without the comment it just posted (%i stale read(s))", (lag) => {
    const { reads } = allowed({ lag });
    expect(reads).toBe(3 + lag);
  });

  it.each([
    ["is served stale three times", { lag: 3 }],
    ["cannot be read", { answer: (n) => (n >= 2 ? "<html>502 Bad Gateway</html>" : undefined) }],
    ["fails to read", { answer: (n) => { if (n >= 2) throw ghFailure(["issue", "view"]); } }],
  ])("edits no board field when the thread %s after the post, and hands out no edit", (_, opts) => {
    const { error, sent, reads, thread, drops } = attempt(opts);
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_UNVERIFIED");
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`]);
    expect(reads).toBe(4);
    expect(error.message).toContain("but the thread could not be read back to see what it ended, so no board field was edited.");
    expect(error).toMatchObject({ posted: true, url: thread.at(-1).url, ran: [SIX_STEPS[0]], cure: CURES.RELEASE_UNVERIFIED });
    expect(error).not.toHaveProperty("remaining");
    noEditHandedOut(error.message);
    expect(drops).toBe(0);
  });

  it("asks again when the first look after the board edits fails, and releases whole when the next answers", () => {
    const { reads } = allowed({ answer: (n) => (n === 3 ? "<html>502 Bad Gateway</html>" : undefined) });
    expect(reads).toBe(4);
  });

  // The stop names the reader's account of the last read it refused, when it refused one: a thread
  // served without the comment was read, and refused by nobody.
  it.each([
    ["cannot be read", (n) => (n >= 3 ? "<html>502 Bad Gateway</html>" : undefined), " (the last read was refused: GitHub's answer was not JSON)"],
    ["fails to read", (n) => { if (n >= 3) throw ghFailure(["issue", "view"]); }, " (the last read was refused: GitHub did not answer: GraphQL: Could not resolve to a ProjectV2Item)"],
    ["is served without the comment", (n) => (n >= 3 ? JSON.stringify({ comments: INCIDENT }) : undefined), ""],
  ])("files the row, then says it could not look again when the thread %s after the board edits", (_, answer, refusedAs) => {
    const { error, sent, reads, drops, thread } = attempt({ answer });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_UNCHECKED");
    expect(sent.map((s) => s.describe)).toEqual(SEVEN_WRITES);
    expect(error.message).toContain(
      `its lease is released and the board row is filed, but the thread could not be read again after the board edits${refusedAs}, so a claim landing in those seconds would not have been seen.`,
    );
    expect(error).toMatchObject({ posted: true, url: thread.at(-1).url, ran: SEVEN_STEPS, cure: CURES.RELEASE_ROW_UNCHECKED });
    expect(error).not.toHaveProperty("failed");
    noEditHandedOut(error.message);
    expect(reads).toBe(5);
    expect(drops).toBe(1);
  });

  it("finds its comment by its text when gh prints no link, and marks it by the number the thread gives it", () => {
    const { result, reads, sent, thread } = allowed({ printUrl: false });
    expect(result.url).toBeNull();
    expect(reads).toBe(3);
    expect(sent[6].argv[3]).toBe(`repos/Pootytxng/sentinel/issues/comments/${thread.at(-1).url.split("#issuecomment-")[1]}`);
  });
});

// Round 4 of the review: on 71bd4e38 the look after the board edits took the first read that showed
// the release, and a read served from before the edits showed the release and not the claim that had
// landed during them. The Handoff is now marked after the edits, by editing the one comment this
// release posted, by the number GitHub gave it, and a read counts as the look only once it shows the
// mark: comments are one table written in order, so a read that holds the mark holds every claim
// posted before it.
// Round 5 of the review of PR 644 (round 4's second finding): a list of comments can be cut short, at a
// page's end or anywhere, and a cut list can hold this release's own marked Handoff and still leave out
// a claim posted after it. So every read of the thread is followed by a read of GitHub's own count of
// its comments, and the list is the thread only when it holds that many. Short of that the thread was
// not read: at the decision, that refuses the release; after the board edits, no such read can show the
// thread current.
describe("the thread is read whole: GitHub's count must agree with the list (#643)", () => {
  const COUNT_ROUTE = ["api", `repos/Pootytxng/sentinel/issues/${ISSUE}`];
  const SEATS = [{ self: HOLDER }, { self: PREDECESSOR }, { self: PREDECESSOR, takeover: "it looked idle", holder: "dead" }, { self: HOLDER, dryRun: true }];

  it("reads the count straight after every list, by the REST route to the issue and nothing else", () => {
    const { calls, counted, reads, counts } = allowed();
    expect(counts).toBe(reads);
    for (const argv of counted) expect(argv).toEqual(COUNT_ROUTE);
    calls.forEach((call, i) => {
      if (call === "gh issue view") expect(calls[i + 1], `the list read at ${i} is followed by its count`).toBe("gh api issue");
    });
  });

  it.each([
    ["one more than the list", 4, `GitHub counts 4 comments on #${ISSUE} and the read held 3`],
    ["one fewer than the list", 2, `GitHub counts 2 comments on #${ISSUE} and the read held 3`],
    ["one", 1, `GitHub counts 1 comment on #${ISSUE} and the read held 3`],
    ["none", 0, `GitHub counts 0 comments on #${ISSUE} and the read held 3`],
    [
      "a count gh could not fetch",
      () => {
        throw ghFailure(COUNT_ROUTE);
      },
      `GitHub did not answer with its count of the comments on #${ISSUE}: GraphQL: Could not resolve to a ProjectV2Item`,
    ],
    ["an answer that is not JSON", () => "<html>502 Bad Gateway</html>", `GitHub's count of the comments on #${ISSUE} was not JSON`],
    ["an empty answer", () => "", `GitHub's count of the comments on #${ISSUE} was not JSON`],
    ["an issue with no count", () => "{}", `GitHub's answer holds no count of the comments on #${ISSUE}`],
    ["a count that is a word", () => '{"comments":"3"}', `GitHub's answer holds no count of the comments on #${ISSUE}`],
    ["a count that is null", () => '{"comments":null}', `GitHub's answer holds no count of the comments on #${ISSUE}`],
    ["a count that is not whole", 3.5, `GitHub's answer holds no count of the comments on #${ISSUE}`],
    ["a count below zero", -1, `GitHub's answer holds no count of the comments on #${ISSUE}`],
  ])("refuses the release, from every seat, when GitHub's count at the decision is %s", (_, count, why) => {
    for (const opts of SEATS) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { count, ...opts });
      expect(error.reason).toBe(`The thread of #${ISSUE} could not be read (${why}), so who holds its lease is unknown. An unknown lease is not the caller's lease.`);
      expect(error.cure).toBe("Nothing was written. Run it again when GitHub answers.");
    }
  });

  // The incident's own shape, one page short: the caller released, a third session claimed, and a list
  // cut before both shows the caller's claim still live. Without the count, that release would have
  // posted a released Handoff over the third session's lease.
  const B_RELEASE = posted("2026-10-03T05:29:00Z", withRecord(RELEASED, B_CLAIM), 20);
  const D_CLAIM = posted("2026-10-03T05:29:30Z", claimText(THIRD, { expires: "2026-10-03T17:29:30Z" }), 21);
  const MOVED_ON = [...INCIDENT, B_RELEASE, D_CLAIM];

  it("refuses, at the decision, a list cut before the claim that followed the caller's own release", () => {
    expect(threadLease(MOVED_ON).claim?.url, "the premise: the thread's live claim is the third session's").toBe(D_CLAIM.url);
    expect(threadLease(MOVED_ON.slice(0, 3)).claim?.url, "and the cut list shows the caller's").toBe(B_CLAIM.url);
    for (const opts of [{ self: HOLDER }, { self: HOLDER, dryRun: true }]) {
      const error = refused("RELEASE_THREAD_UNREADABLE", { thread: MOVED_ON, cut: 3, ...opts });
      expect(error.reason).toContain(`(GitHub counts 5 comments on #${ISSUE} and the read held 3)`);
    }
  });

  it("reads that thread whole for what it is: the caller holds nothing", () => {
    refused("RELEASE_NOT_HOLDER", { thread: MOVED_ON, self: HOLDER });
  });

  it("stops unverified, editing no field, when every read after the post is cut before the Handoff", () => {
    const { error, sent, reads, counts } = attempt({ cut: 3 });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_UNVERIFIED");
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`]);
    expect(reads).toBe(4);
    expect(counts).toBe(4);
  });

  it("refuses a read-back whose list holds the Handoff but falls short of GitHub's count, and takes the next read that agrees", () => {
    // The first read after the post holds the posted Handoff; GitHub already counts one comment more.
    const run = allowed({ count: (n, comments) => (n === 2 ? comments.length + 1 : comments.length) });
    expect(run.reads, "decision, a refused read-back, the read-back taken, the look after the edits").toBe(4);
    expect(run.counts).toBe(4);
  });

  it("stops unverified, editing no field, when every read-back holds the Handoff but falls short of GitHub's count", () => {
    const { error, sent, reads } = attempt({ count: (n, comments) => (n === 1 ? comments.length : comments.length + 1) });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_UNVERIFIED");
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`]);
    expect(reads).toBe(4);
  });

  // The reviewer's input (round 4): a thread of 99 comments, this release's Handoff the 100th, a claim
  // landing as the 101st during the board edits, and every read served 100 long. The marked Handoff is
  // in each read and the claim is not. On c5a085bd the first such read was taken as current, and the
  // release reported the row filed over that claim's.
  it("takes no read cut short of GitHub's count for the look after the edits, and says why the row is unchecked", () => {
    expect(NINETY_NINE).toHaveLength(99);
    const { error, sent, reads, counts, drops, thread } = attempt({ thread: NINETY_NINE, duringEdits: { at: 3, comments: [C_CLAIM] }, cut: 100 });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_UNCHECKED");
    expect(error.message).toContain(
      `its lease is released and the board row is filed, but the thread could not be read again after the board edits (the last read was refused: GitHub counts 101 comments on #${ISSUE} and the read held 100), so a claim landing in those seconds would not have been seen.`,
    );
    expect(error).toMatchObject({ posted: true, ran: SEVEN_STEPS, cure: CURES.RELEASE_ROW_UNCHECKED });
    expect(error).not.toHaveProperty("live");
    expect(sent.map((s) => s.describe)).toEqual(SEVEN_WRITES);
    expect(reads).toBe(5);
    expect(counts).toBe(5);
    expect(drops).toBe(1);
    expect(thread).toHaveLength(101);
    expect(threadLease(thread).claim?.url, "the claim every cut read hid").toBe(C_CLAIM.url);
  });

  it("releases whole on that thread when the reads are served whole: the claim is seen, and the row is said to be its", () => {
    const { error, thread } = attempt({ thread: NINETY_NINE, duringEdits: { at: 3, comments: [C_CLAIM] } });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_RACED");
    expect(error).toMatchObject({ live: { url: C_CLAIM.url } });
    expect(thread).toHaveLength(101);
  });
});

describe("the look after the board edits is current (#643)", () => {
  const BY_NUMBER = /^repos\/Pootytxng\/sentinel\/issues\/comments\/\d+$/;

  it("marks its own comment, by the number GitHub gave it, with the posted text and a filing line, and reads until the mark shows", () => {
    const { sent, thread, body, calls } = allowed();
    const mark = sent[6];
    expect(mark.argv.slice(0, 3)).toEqual(["api", "--method", "PATCH"]);
    expect(mark.argv[3]).toMatch(BY_NUMBER);
    expect(mark.argv[3].endsWith(`/${thread.at(-1).url.split("#issuecomment-")[1]}`), "the number is the posted comment's").toBe(true);
    expect(mark.argv.slice(4)).toEqual(["-f", `body=${FILED(body)}`]);
    expect(thread.at(-1).body).toBe(FILED(body));
    expect(calls.slice(-2), "the last read, and its count, follow the mark").toEqual(["gh issue view", "gh api issue"]);
    expect(calls.at(-3)).toBe("gh api --method");
  });

  it("the marked comment folds as the unmarked one did: released, naming the same claim, ending it", () => {
    const { thread, body } = allowed();
    const marked = thread.at(-1).body;
    expect(marked).not.toBe(body);
    expect(parseHandoff(marked)).toEqual(parseHandoff(body));
    expect(parseHandoff(marked).released).toBe(true);
    expect(parseReleaseRecord(marked)).toEqual({ ends: [B_CLAIM.createdAt] });
    expect(threadLease([...INCIDENT, { ...thread.at(-1), body: marked }]).claim).toBeNull();
    expect(threadLease([...INCIDENT, { ...thread.at(-1), body: marked }]).handoff).toEqual(threadLease([...INCIDENT, { ...thread.at(-1), body }]).handoff);
    expect(marked.split("\n").filter((l) => /^- Claim/.test(l))).toEqual(body.split("\n").filter((l) => /^- Claim/.test(l)));
  });

  it("the reviewer's input: a claim lands during the edits and the first read after them is served from before it", () => {
    const { error, sent, reads, drops, thread } = attempt({ duringEdits: { at: 2, comments: [C_CLAIM] }, staleAfterMark: 1 });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_RACED");
    expect(error).toMatchObject({ posted: true, live: { url: C_CLAIM.url }, ran: SEVEN_STEPS, cure: CURES.RELEASE_ROW_RACED });
    expect(sent.map((s) => s.describe)).toEqual(SEVEN_WRITES);
    expect(reads, "the stale read was not taken for the look").toBe(4);
    expect(drops).toBe(1);
    expect(threadLease(thread).claim?.url).toBe(C_CLAIM.url);
  });

  it.each([1, 2])("reads again while a read shows the Handoff unmarked (%i stale read(s)), and releases whole when one shows the mark", (staleAfterMark) => {
    const { reads } = allowed({ staleAfterMark });
    expect(reads).toBe(3 + staleAfterMark);
  });

  it("says the thread could not be shown current when no read after the edits shows the mark, and files the row all the same", () => {
    const { error, sent, reads, drops } = attempt({ staleAfterMark: 3 });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_UNCHECKED");
    expect(error.message).toContain(
      "its lease is released and the board row is filed, but no read of the thread after the board edits showed the Handoff marked yet, so the thread could not be shown current, and a claim landing in those seconds would not have been seen.",
    );
    expect(error).toMatchObject({ posted: true, ran: SEVEN_STEPS, cure: CURES.RELEASE_ROW_UNCHECKED });
    expect(error).not.toHaveProperty("live");
    expect(sent.map((s) => s.describe)).toEqual(SEVEN_WRITES);
    expect(reads).toBe(5);
    expect(drops).toBe(1);
  });

  it("does not take an unmarked read for the look even when a claim landed: the row is said to be unchecked, not clear", () => {
    // Every read after the mark is served from just after the post, which shows neither the mark nor the claim.
    const { error } = attempt({ duringEdits: { at: 0, comments: [C_CLAIM] }, staleAfterMark: 3 });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_UNCHECKED");
    expect(error.message).toContain("no read of the thread after the board edits showed the Handoff marked yet");
  });

  it("reports a claim an unmarked read shows all the same: a glimpse can show a claim, not that there is none", () => {
    // The mark fails, so no read can show it; the one read taken shows the thread with the claim.
    const { error, sent, reads } = attempt({ markFails: true, duringEdits: { at: 3, comments: [C_CLAIM] } });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_RACED");
    expect(error).toMatchObject({ live: { url: C_CLAIM.url }, ran: SIX_STEPS });
    expect(sent.map((s) => s.describe)).toEqual(SIX_WRITES);
    expect(reads).toBe(3);
  });

  it("says so when the mark cannot be written: the row is filed, and the thread could not be shown current", () => {
    const { error, sent, reads, drops } = attempt({ markFails: true });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_UNCHECKED");
    expect(error.message).toContain(
      "its lease is released and the board row is filed, but the Handoff could not be marked (GraphQL: Could not resolve to a ProjectV2Item), so the thread could not be shown current, and a claim landing in those seconds would not have been seen.",
    );
    expect(error.message).not.toContain("Command failed");
    expect(error).toMatchObject({ posted: true, ran: SIX_STEPS, cure: CURES.RELEASE_ROW_UNCHECKED });
    expect(sent.map((s) => s.describe)).toEqual(SIX_WRITES);
    expect(reads, "one look, since no read could show a mark").toBe(3);
    expect(drops).toBe(1);
  });

  it("says so when the posted comment has no number to mark it by", () => {
    const { error, sent, reads } = attempt({ unlinked: true });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_ROW_UNCHECKED");
    expect(error.message).toContain(
      "its lease is released and the board row is filed, but the Handoff carries no comment number to mark it by, so the thread could not be shown current, and a claim landing in those seconds would not have been seen.",
    );
    expect(error).toMatchObject({ posted: true, url: null, ran: SIX_STEPS });
    expect(sent.map((s) => s.describe)).toEqual(SIX_WRITES);
    expect(reads).toBe(3);
  });

  it("marks a half run as unfinished, naming the edit that failed, and still reads for the mark", () => {
    const { error, sent, thread } = attempt({ failAt: 2 });
    expect(error?.code, String(error?.stack ?? error)).toBe("RELEASE_HALF_RUN");
    expect(sent.map((s) => s.describe)).toEqual(WRITES_TO(2));
    expect(sent.at(-1).argv.at(-1)).toBe(`body=${UNFINISHED(withRecord(RELEASED, B_CLAIM), "set Gate = None")}`);
    expect(thread.at(-1).body).toBe(UNFINISHED(withRecord(RELEASED, B_CLAIM), "set Gate = None"));
    expect(parseReleaseRecord(thread.at(-1).body)).toEqual({ ends: [B_CLAIM.createdAt] });
    expect(threadLease(thread).claim).toBeNull();
  });

  it("never edits the newest comment as such: the mark goes by number, and release.mjs knows no --edit-last", () => {
    const source = readFileSync(join(HERE, "release.mjs"), "utf8");
    expect(source).not.toContain("edit-last");
    expect(source.match(/issues\/comments\//g)).toHaveLength(1);
    expect(source).toContain('"api", "--method", "PATCH", `repos/${REPO}/issues/comments/${commentId}`');
  });
});

/** The local copy of a claim's scope, as `postClaim` leaves it for the drift readers (#356). */
const seed = () => writeClaimCache({ issue: ISSUE, scopeText: "`tools/entry/claim.mjs`", folder: HOLDER.folder, branch: HOLDER.branch }, { dir: tmp });
const cached = () => readClaimCache({ issue: ISSUE, dir: tmp });

// #643 review, finding 2: `execPlan` ran whatever `gh` arguments it was handed, so one hand-written
// step ended whichever lease was live while the source sweep below stayed green. It now runs a plan
// only when claim.mjs built it, whole, and only when no comment in it starts or ends a lease.
describe("execPlan runs only what claim.mjs built (#643)", () => {
  const RELEASE_STEP = { argv: ["issue", "comment", "637", "--repo", "Pootytxng/sentinel", "--body", "### Handoff\n\n- Claim: released"], describe: "release" };
  const renewal = (opts = {}) => planRenew({ issue: ISSUE, ids: IDS, until: "2026-10-04", ...opts });
  const claimPlan = () => planPostClaim({ issue: ISSUE, ids: IDS, facts: FACTS, verdict: PASS });

  /** The launcher's seat, and any other program's: what is refused on its content is refused from both. */
  const SEATS = [asLauncher, (run) => run()];

  /** `make()` is refused with `code`, dry run or not, launcher or not, before anything is read or sent. Returns the refusal. */
  function refusedPlan(code, make) {
    let last = null;
    for (const dryRun of [true, false]) {
      for (const seat of SEATS) {
        const run = inWorld({}, () => seat(() => execPlan(make(), { dryRun })));
        expect(run.result, "the plan was not refused").toBeNull();
        expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe(code);
        expect(run.calls).toEqual([]);
        expect(run.sent).toEqual([]);
        last = run.error;
      }
    }
    return last;
  }

  it("refuses the reviewer's input: one hand-written step that releases", () => {
    expect(refusedPlan("PLAN_NOT_BUILT_HERE", () => [RELEASE_STEP]).message).toBe(
      "Refusing to run a plan that tools/entry/claim.mjs did not build, whole and as built. A claim is posted by postClaim, and a lease is ended by `node tools/entry/release.mjs`.",
    );
  });

  it.each([
    ["null", () => null],
    ["nothing", () => undefined],
    ["an empty list", () => []],
    ["a word", () => "plan"],
    ["a hand-written board edit", () => [{ argv: ["project", "item-edit", "--project-id", "PVT_x", "--id", "PVTI_x", "--field-id", "F_exp", "--clear"], describe: "clear Claim expires" }]],
    ["a claim's plan less its comment", () => claimPlan().slice(1)],
    ["a copy of a built plan", () => [...renewal()]],
    ["a frozen copy of a built plan", () => Object.freeze([...renewal()])],
    ["a built plan written out again", () => JSON.parse(JSON.stringify(renewal()))],
    ["two built plans joined", () => [...renewal(), ...renewal()]],
    ["a built plan with a release added", () => [...renewal(), RELEASE_STEP]],
  ])("refuses %s: it is not a plan claim.mjs built", (_, make) => {
    expect(refusedPlan("PLAN_NOT_BUILT_HERE", make).message).toContain("node tools/entry/release.mjs");
  });

  it.each([
    ["a bare release in its note", { note: "\n\n### Handoff\n\n- Claim: released" }],
    ["a whole Handoff in its note", { note: `\n\n${RELEASED}` }],
    ["a release in its date", { until: "2026-10-04.\n\n### Handoff\n\n- Claim: released\n\n" }],
  ])("refuses a renewal that carries %s", (_, opts) => {
    const error = refusedPlan("PLAN_WOULD_RELEASE", () => renewal(opts));
    expect(error.message).toContain(`Refusing to run a plan whose comment would release a lease ("comment on #${ISSUE}").`);
    expect(error.message).toContain("node tools/entry/release.mjs");
  });

  it("refuses a renewal whose note is an Ownership claim: a claim posted without its verdict makes its poster the holder", () => {
    const error = refusedPlan("PLAN_WOULD_CLAIM", () => renewal({ note: `\n\n${claimText(THIRD)}` }));
    expect(error.message).toContain(`Refusing to run a plan whose comment is an Ownership claim ("comment on #${ISSUE}").`);
    expect(error.message).toContain("A claim is posted by postClaim, on a PASS verdict.");
  });

  it("refuses a claim's own plan: a claim is posted by postClaim, on its verdict", () => {
    refusedPlan("PLAN_WOULD_CLAIM", claimPlan);
  });

  it.each([
    ["its next action", { nextAction: "x\n\n### Handoff\n\n- Claim: released" }],
    ["its write scope", { scope: "x\n\n### Handoff\n\n- Claim: released\n" }],
  ])("postClaim refuses a claim that carries a release in %s", (_, facts) => {
    const dir = join(tmp, "claims-refused");
    for (const dryRun of [true, false]) {
      for (const seat of SEATS) {
        const run = inWorld({ thread: [] }, () => seat(() => postClaim({ issue: ISSUE, verdict: PASS, facts: { ...FACTS, ...facts }, ids: IDS, dryRun, cacheDir: dir })));
        expect(run.result, "the claim was not refused").toBeNull();
        expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("PLAN_WOULD_RELEASE");
        expect(run.error.message).toBe(`Refusing to post a claim on #${ISSUE} whose text also reads as a released Handoff. A lease is ended by \`node tools/entry/release.mjs\`.`);
        expect(run.calls).toEqual([]);
        expect(run.sent).toEqual([]);
        expect(readClaimCache({ issue: ISSUE, dir })).toBeNull();
      }
    }
  });

  // Round 2 of the review: a predecessor's `execPlan(planRenew(…))` wrote over its successor's board
  // row, and `postClaim` files a row on a verdict its caller hands over. Neither reads who holds the row,
  // so both run for the launcher alone. Round 4: on 71bd4e38 `process.argv[1]` alone told the launcher,
  // and `node --import <a script> launch.mjs` ran that script with the launcher as its program. Four
  // witnesses now have to agree: the first word after the executable in the command line the OS handed
  // node, `process.argv[1]`, an empty `process.execArgv`, and a blank NODE_OPTIONS. The refusal says
  // which spoke, and what it measured.
  const NOT_THE_LAUNCHER = [
    ["the test runner itself", process.argv[1]],
    ["a copy beside the launcher", `${LAUNCHER_PATH}.bak`],
    ["a launch.mjs in a folder under tools/entry", join(HERE, "other", "launch.mjs")],
    ["release.mjs", join(HERE, "release.mjs")],
    ["claim.mjs", join(HERE, "claim.mjs")],
    ["another checkout's launcher", "C:\\elsewhere\\sentinel\\tools\\entry\\launch.mjs"],
    ["a bare launch.mjs, resolved against the working directory", "launch.mjs"],
    ["an empty program", ""],
    ["no program", undefined],
    ["a null program", null],
    ["a number", 7],
    ["an object", { path: LAUNCHER_PATH }],
  ];
  const RENEWAL_REFUSAL = (measured) =>
    `Refusing to run a plan outside the launcher (tools/entry/launch.mjs): ${measured}. A renewal moves a board row's expiry without reading who holds that row, so only the launcher runs one, after its own preflight. A session extends its own lease by posting a refreshed Ownership claim, and ends it with \`node tools/entry/release.mjs\`.`;
  const CLAIM_REFUSAL = (measured) =>
    `Refusing to post a claim on #${ISSUE} outside the launcher (tools/entry/launch.mjs): ${measured}. A claim takes the lease and files the board row on a verdict its caller hands over, so only the launcher posts one this way, on the verdict of its own preflight. A lease is ended with \`node tools/entry/release.mjs\`.`;
  /** What the witnesses say of a process started on `program`, which is its `process.argv[1]` too. */
  const startedWith = (program) => (typeof program === "string" && program !== "" ? `node was started with the program "${program}"` : "node was started with no program");

  it("none of the programs it refuses is the launcher's path", () => {
    for (const [, program] of NOT_THE_LAUNCHER) {
      if (typeof program === "string" && program !== "") expect(samePath(resolve(program), LAUNCHER_PATH), program).toBe(false);
    }
  });

  it.each(NOT_THE_LAUNCHER)("refuses to run a renewal for %s: only the launcher moves a row's expiry", (_, program) => {
    for (const dryRun of [true, false]) {
      const run = inWorld({}, () => asProgram(program, () => execPlan(renewal(), { dryRun })));
      expect(run.result, "the renewal was not refused").toBeNull();
      expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("PLAN_NOT_THE_LAUNCHER");
      expect(run.error.message).toBe(RENEWAL_REFUSAL(startedWith(program)));
      expect(run.calls).toEqual([]);
      expect(run.sent).toEqual([]);
    }
  });

  it.each(NOT_THE_LAUNCHER)("refuses to post a claim for %s: only the launcher claims on a verdict it was handed", (_, program) => {
    const dir = join(tmp, "claims-elsewhere");
    for (const dryRun of [true, false]) {
      const run = inWorld({ thread: [] }, () => asProgram(program, () => postClaim({ issue: ISSUE, verdict: PASS, facts: FACTS, ids: IDS, dryRun, cacheDir: dir })));
      expect(run.result, "the claim was not refused").toBeNull();
      expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("CLAIM_NOT_THE_LAUNCHER");
      expect(run.error.message).toBe(CLAIM_REFUSAL(startedWith(program)));
      expect(run.calls).toEqual([]);
      expect(run.sent).toEqual([]);
      expect(readClaimCache({ issue: ISSUE, dir })).toBeNull();
    }
  });

  // One witness at a time, with the other three the launcher's. The program is the launcher's path
  // unless the row says otherwise.
  const OTHER = join(HERE, "other.mjs");
  const ONE_WITNESS = [
    ["the command line names another program after the executable", LAUNCHER_PATH, { started: OTHER }, `node was started with "${OTHER}" after the executable`],
    ["the command line has a flag before the program", LAUNCHER_PATH, { started: "--import" }, 'node was started with "--import" after the executable'],
    ["the command line has nothing after the executable", LAUNCHER_PATH, { started: undefined }, "node was started with no program after the executable"],
    ["the command line cannot be read", LAUNCHER_PATH, { report: () => { throw new Error("no report"); } }, "the command line node was started with could not be read"],
    ["the report holds no command line", LAUNCHER_PATH, { report: () => ({ header: {} }) }, "the command line node was started with could not be read"],
    ["the report is empty", LAUNCHER_PATH, { report: () => null }, "the command line node was started with could not be read"],
    ["process.argv is forged to the launcher's path", OTHER, { started: LAUNCHER_PATH }, `process.argv names "${OTHER}" as the program`],
    ["node was started with flags", LAUNCHER_PATH, { flags: ["--import", "x"] }, "node was started with the flags --import x"],
    ["node was started with one flag", LAUNCHER_PATH, { flags: ["--inspect"] }, "node was started with the flag --inspect"],
    ["the flags cannot be read", LAUNCHER_PATH, { flags: null }, "the flags node was started with could not be read"],
    ["NODE_OPTIONS is set", LAUNCHER_PATH, { options: "--import=x" }, "NODE_OPTIONS is set (--import=x)"],
    ["NODE_OPTIONS is set, with space around it", LAUNCHER_PATH, { options: "  --require ./x.cjs  " }, "NODE_OPTIONS is set (--require ./x.cjs)"],
    // A witness that throws while it is read: an array whose length cannot be read. Unknown means locked.
    // Built inside the test: the runner formats a row's values when it collects the rows.
    ["a witness throws while it is measured", LAUNCHER_PATH, () => ({ flags: new Proxy([], { get(t, k) { if (k === "length") throw new Error("no length"); return Reflect.get(t, k); } }) }), "the process could not be measured"],
    [
      "every witness speaks",
      OTHER,
      { started: "--import", flags: ["--import", "x"], options: "--import=x" },
      `node was started with "--import" after the executable; process.argv names "${OTHER}" as the program; node was started with the flags --import x; NODE_OPTIONS is set (--import=x)`,
    ],
  ];
  it.each(ONE_WITNESS)("refuses both writers when %s, and says so", (_, program, row, measured) => {
    const witnesses = typeof row === "function" ? row() : row;
    for (const dryRun of [true, false]) {
      const renew = inWorld({}, () => asProgram(program, () => execPlan(renewal(), { dryRun }), witnesses));
      expect(renew.result, "the renewal was not refused").toBeNull();
      expect(renew.error?.code, String(renew.error?.stack ?? renew.error)).toBe("PLAN_NOT_THE_LAUNCHER");
      expect(renew.error.message).toBe(RENEWAL_REFUSAL(measured));
      expect(renew.calls).toEqual([]);
      expect(renew.sent).toEqual([]);
      const claim = inWorld({ thread: [] }, () => asProgram(program, () => postClaim({ issue: ISSUE, verdict: PASS, facts: FACTS, ids: IDS, dryRun }), witnesses));
      expect(claim.result, "the claim was not refused").toBeNull();
      expect(claim.error?.code, String(claim.error?.stack ?? claim.error)).toBe("CLAIM_NOT_THE_LAUNCHER");
      expect(claim.error.message).toBe(CLAIM_REFUSAL(measured));
      expect(claim.calls).toEqual([]);
      expect(claim.sent).toEqual([]);
    }
  });


  it("refuses a claim on its content before it asks who is running: a bad claim is bad from the launcher too", () => {
    const run = inWorld({ thread: [] }, () => postClaim({ issue: ISSUE, verdict: PASS, facts: { ...FACTS, branch: "`claude/x`" }, ids: IDS, dryRun: true }));
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("CLAIM_WOULD_NOT_READ_BACK");
    const refusedVerdict = inWorld({ thread: [] }, () => postClaim({ issue: ISSUE, verdict: REFUSE, facts: FACTS, ids: IDS, dryRun: true }));
    expect(refusedVerdict.error?.message).toMatch(/preflight verdict is REFUSE/);
  });

  const SPELLINGS = [
    ["as written", LAUNCHER_PATH],
    ["with forward slashes", LAUNCHER_PATH.replaceAll("\\", "/")],
    ["relative to the working directory", relative(process.cwd(), LAUNCHER_PATH)],
    ["with a dot segment", `${HERE}/./launch.mjs`],
    ...(process.platform === "win32" ? [["in upper case", LAUNCHER_PATH.toUpperCase()]] : []),
  ];
  /** Both writers run (dry) for `program`: the renewal's steps are planned and the claim's plan is built. */
  const opensFor = (program, witnesses) => {
    const renew = inWorld({}, () => asProgram(program, () => execPlan(renewal(), { dryRun: true }), witnesses));
    expect(renew.error, String(renew.error?.stack ?? renew.error)).toBeNull();
    expect(renew.result.map((s) => s.ran)).toEqual([false, false]);
    const claim = inWorld({ thread: [] }, () => asProgram(program, () => postClaim({ issue: ISSUE, verdict: PASS, facts: FACTS, ids: IDS, dryRun: true }), witnesses));
    expect(claim.error, String(claim.error?.stack ?? claim.error)).toBeNull();
    expect(claim.result.plan).toHaveLength(7);
    expect(claim.calls).toEqual([]);
  };
  it.each(SPELLINGS)("runs for the launcher named %s", (_, program) => opensFor(program));

  it.each([
    ["NODE_OPTIONS is blank", { options: "   " }],
    ["the command line spells the launcher with forward slashes", { started: LAUNCHER_PATH.replaceAll("\\", "/") }],
    ["the command line names the launcher relative to the working directory", { started: relative(process.cwd(), LAUNCHER_PATH) }],
    ["the command line names the launcher as the entry script types it", { started: `${HERE}/./launch.mjs` }],
  ])("runs for the launcher when %s", (_, witnesses) => opensFor(LAUNCHER_PATH, witnesses));

  it("runs for the launcher reached through a junction: paths are compared through links", (ctx) => {
    const link = join(tmp, "entry-junction");
    try {
      symlinkSync(HERE, link, "junction");
    } catch (e) {
      ctx.skip(`this machine would not make a junction: ${e.code ?? e.message}`);
    }
    expect(samePath(resolve(join(link, "launch.mjs")), LAUNCHER_PATH), "the junction path spells differently").toBe(false);
    opensFor(join(link, "launch.mjs"));
  });

  it("the launcher is the caller the gate names: it renews and claims through these two writers, and the entry script starts it by its path", () => {
    const launcher = readFileSync(LAUNCHER_PATH, "utf8");
    expect(launcher).toContain("execPlan(planRenew(");
    expect(launcher).toContain("postClaim({");
    expect(launcher).toContain("pathToFileURL(process.argv[1])");
    expect(readFileSync(join(ROOT, "compy-entry.ps1"), "utf8")).toContain("tools/entry/launch.mjs");
  });

  // In a real node process, against the real witnesses. The launcher's own process cannot be entered
  // from a test without the launcher's cooperation, so its opening is proved above, on the stubbed
  // witnesses; here every way in from outside is tried: a preload (`--import`), which on 71bd4e38 ran
  // both writers with the launcher as its program (review of PR 644, round 3); an inline script (`-e`);
  // a preload named in NODE_OPTIONS; a forged `process.argv[1]`; and the probe run as the program. Each
  // probe calls both writers dry and exits before the launcher itself would run. No `gh` or `git` is on
  // the PATH of any.
  it("refuses every way into the launcher's process from outside, in a real node process", () => {
    const dir = join(tmp, "probe");
    mkdirSync(join(dir, "empty-path"), { recursive: true });
    const source = (forge) =>
      [
        `import { execPlan, planRenew, postClaim } from ${JSON.stringify(pathToFileURL(join(HERE, "claim.mjs")).href)};`,
        `const ids = ${JSON.stringify(IDS)};`,
        `const facts = ${JSON.stringify(FACTS)};`,
        `const verdict = ${JSON.stringify(PASS)};`,
        ...(forge ? [`process.argv[1] = ${JSON.stringify(LAUNCHER_PATH)};`] : []),
        "const out = { argv1: process.argv[1], commandLine: process.report.getReport().header.commandLine, messages: [] };",
        "const code = (run) => { try { run(); return 'ran'; } catch (e) { out.messages.push(e.message); return e.code ?? e.message; } };",
        "try {",
        `  out.renew = code(() => execPlan(planRenew({ issue: ${ISSUE}, ids, until: "2026-10-04" }), { dryRun: true }));`,
        `  out.claim = code(() => postClaim({ issue: ${ISSUE}, verdict, facts, ids, dryRun: true }));`,
        "} finally {",
        "  process.stdout.write(JSON.stringify(out) + '\\n');",
        "  process.exit(0);",
        "}",
        "",
      ].join("\n");
    const probe = join(dir, "probe.mjs");
    const forging = join(dir, "forging.mjs");
    writeFileSync(probe, source(false), "utf8");
    writeFileSync(forging, source(true), "utf8");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:path|node_options)$/i.test(k)));
    env.PATH = join(dir, "empty-path");
    const run = (args, more = {}) => {
      const r = spawnSync(process.execPath, args, { cwd: ROOT, env: { ...env, ...more }, encoding: "utf8", timeout: 60_000, windowsHide: true });
      expect(r.error).toBeUndefined();
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      return JSON.parse(r.stdout.trim().split("\n").at(-1));
    };
    const REFUSED = { renew: "PLAN_NOT_THE_LAUNCHER", claim: "CLAIM_NOT_THE_LAUNCHER" };
    const href = pathToFileURL(probe).href;

    const preload = run(["--import", href, LAUNCHER_PATH, "--dry-run", "--quiet"]);
    expect(samePath(preload.argv1, LAUNCHER_PATH), "node names the launcher as the program all the same").toBe(true);
    expect(preload.commandLine.slice(1), "the report holds the command line as the OS handed it").toEqual(["--import", href, LAUNCHER_PATH, "--dry-run", "--quiet"]);
    expect(preload).toMatchObject(REFUSED);
    expect(preload.messages).toHaveLength(2);
    for (const m of preload.messages) {
      expect(m).toContain('node was started with "--import" after the executable');
      expect(m).toContain(`node was started with the flags --import ${href}`);
    }

    const inline = run(["-e", `import(${JSON.stringify(href)})`, LAUNCHER_PATH, "--dry-run", "--quiet"]);
    expect(inline).toMatchObject(REFUSED);
    for (const m of inline.messages) expect(m).toContain('node was started with "-e" after the executable');

    const options = run([LAUNCHER_PATH, "--dry-run", "--quiet"], { NODE_OPTIONS: `--import=${href}` });
    expect(samePath(options.argv1, LAUNCHER_PATH)).toBe(true);
    expect(samePath(options.commandLine[1], LAUNCHER_PATH), "the command line is the launcher's: only NODE_OPTIONS tells").toBe(true);
    expect(options).toMatchObject(REFUSED);
    for (const m of options.messages) expect(m).toContain(`NODE_OPTIONS is set (--import=${href})`);

    const forged = run([forging]);
    expect(samePath(forged.argv1, LAUNCHER_PATH), "process.argv was forged").toBe(true);
    expect(samePath(forged.commandLine[1], forging), "the report's command line was not").toBe(true);
    expect(forged).toMatchObject(REFUSED);
    for (const m of forged.messages) expect(m).toContain(`node was started with "${forging}" after the executable`);

    const asItself = run([probe]);
    expect(samePath(asItself.argv1, probe)).toBe(true);
    expect(asItself).toMatchObject(REFUSED);
    expect(asItself.messages).toHaveLength(2);
    for (const m of asItself.messages) expect(m).toContain(`node was started with the program "${probe}"`);
  });

  // THE LIMIT, stated (review of PR 644, round 4): all four witnesses are process state, and a program
  // that rewrites all four before it imports claim.mjs is admitted. This test shows such a program
  // reaching both writers, so the limit is on record, and a change that closes it turns this red. What
  // holds against it is structural, the writers leaving claim.mjs for one only the launcher reaches,
  // filed as a follow-up on #643: nothing measured inside a process can tell what ran in it earlier.
  it("the stated limit: a program that forges all four witnesses before importing claim.mjs is admitted", () => {
    const dir = join(tmp, "limit");
    mkdirSync(join(dir, "empty-path"), { recursive: true });
    const forger = join(dir, "forger.mjs");
    writeFileSync(
      forger,
      [
        "// Forge every witness, then load the module: nothing it can measure differs from the launcher's own process.",
        `process.argv[1] = ${JSON.stringify(LAUNCHER_PATH)};`,
        `process.report.getReport = () => ({ header: { commandLine: [process.execPath, ${JSON.stringify(LAUNCHER_PATH)}] } });`,
        "process.execArgv = [];",
        "delete process.env.NODE_OPTIONS;",
        `const { execPlan, planRenew, postClaim } = await import(${JSON.stringify(pathToFileURL(join(HERE, "claim.mjs")).href)});`,
        `const ids = ${JSON.stringify(IDS)};`,
        `const facts = ${JSON.stringify(FACTS)};`,
        `const verdict = ${JSON.stringify(PASS)};`,
        "const out = { messages: [] };",
        "const code = (run) => { try { run(); return 'ran'; } catch (e) { out.messages.push(e.message); return e.code ?? e.message; } };",
        "try {",
        `  out.renew = code(() => execPlan(planRenew({ issue: ${ISSUE}, ids, until: "2026-10-04" }), { dryRun: true }));`,
        `  out.claim = code(() => postClaim({ issue: ${ISSUE}, verdict, facts, ids, dryRun: true }));`,
        "} finally {",
        "  process.stdout.write(JSON.stringify(out) + '\\n');",
        "  process.exit(0);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:path|node_options)$/i.test(k)));
    env.PATH = join(dir, "empty-path");
    // Started with a flag and with NODE_OPTIONS set, so every witness has something to forge.
    const r = spawnSync(process.execPath, ["--no-warnings", forger], { cwd: ROOT, env: { ...env, NODE_OPTIONS: "--no-deprecation" }, encoding: "utf8", timeout: 60_000, windowsHide: true });
    expect(r.error).toBeUndefined();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const admitted = JSON.parse(r.stdout.trim().split("\n").at(-1));
    expect(admitted, "the limit: a forger of all four witnesses reaches both writers").toEqual({ messages: [], renew: "ran", claim: "ran" });
  });

  it("builds plans that cannot be edited into other plans afterwards", () => {
    const plan = renewal();
    expect(() => plan.push(RELEASE_STEP)).toThrow(TypeError);
    expect(() => {
      plan[0] = RELEASE_STEP;
    }).toThrow(TypeError);
    expect(() => {
      plan[0].argv = RELEASE_STEP.argv;
    }).toThrow(TypeError);
    expect(() => {
      plan[0].argv[6] = "### Handoff\n\n- Claim: released";
    }).toThrow(TypeError);
    expect(plan[0].argv[6]).toBe("Claim renewed until 2026-10-04.");
  });

  it("still runs a renewal, and the lease stays where it was", () => {
    const run = inWorld({}, () => asLauncher(() => execPlan(renewal({ note: "The review is still running." }))));
    expect(run.error, String(run.error?.stack ?? run.error)).toBeNull();
    expect(run.sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`, "F_exp --date 2026-10-04"]);
    expect(run.sent[0].argv.at(-1)).toBe("Claim renewed until 2026-10-04. The review is still running.");
    expect(run.result.map((s) => s.ran)).toEqual([true, true]);
    expect(threadLease(run.thread).claim).toMatchObject({ url: B_CLAIM.url });
  });

  it("runs nothing on a dry run", () => {
    const run = inWorld({}, () => asLauncher(() => execPlan(renewal(), { dryRun: true })));
    expect(run.error, String(run.error?.stack ?? run.error)).toBeNull();
    expect(run.result.map((s) => s.ran)).toEqual([false, false]);
    expect(run.calls).toEqual([]);
    expect(run.sent).toEqual([]);
  });

  it("still posts a claim on a PASS verdict: the comment, the row, and the local copy of its scope", () => {
    const dir = join(tmp, "claims");
    const run = inWorld({ thread: [] }, () => asLauncher(() => postClaim({ issue: ISSUE, verdict: PASS, facts: FACTS, ids: IDS, cacheDir: dir })));
    expect(run.error, String(run.error?.stack ?? run.error)).toBeNull();
    expect(run.sent).toHaveLength(7);
    expect(run.sent[0].argv.slice(0, 3)).toEqual(["issue", "comment", String(ISSUE)]);
    expect(run.result.ran.map((s) => s.ran)).toEqual(Array(7).fill(true));
    expect(threadLease(run.thread).claim).toMatchObject({ folder: FOLDER, branch: BRANCH });
    expect(readClaimCache({ issue: ISSUE, dir })).toMatchObject({ issue: ISSUE, folder: FOLDER, branch: BRANCH, source: "postClaim" });
  });
});

// Round 2 of the review: `plain` reads a branch wrapped in backticks as the name inside them, so a claim
// rendered for the branch `` `claude/successor` `` (git allows the backticks) read as one for
// `claude/successor`, and the folder, moved to that other branch, was taken for the holder. A claim that
// would not read back as the seat it names is refused before it is posted, with the readers a release
// uses, so a release ever matches only a claim that reads as written.
describe("postClaim posts no claim that would not read back as its own seat (#643)", () => {
  const BASE = "claude/x";
  const CACHE = join(tmp, "read-back");
  const EXPIRES = "2026-10-03T17:22:01Z";
  const claimFor = (facts, dryRun = true) =>
    inWorld({ thread: [] }, () => asLauncher(() => postClaim({ issue: ISSUE, verdict: PASS, facts: { ...FACTS, expires: EXPIRES, ...facts }, ids: IDS, dryRun, cacheDir: CACHE })));
  /** What a release makes of a posted claim: the seat `releaseDecision` admits for its body. */
  const admits = (body, self) => releaseDecision({ issue: ISSUE, comments: [posted("2026-10-03T05:22:01Z", body, 3)], self, now: NOW });
  const bodyOf = (run) => run.result.plan[0].argv.at(-1);
  /** Printable ASCII, as git allows it in a ref name. */
  const CHARS = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i));

  it("refuses the reviewer's input, dry run or not: a branch whose own name is wrapped in backticks", () => {
    for (const dryRun of [true, false]) {
      const run = claimFor({ branch: "`claude/successor`" }, dryRun);
      expect(run.result, "the claim was not refused").toBeNull();
      expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("CLAIM_WOULD_NOT_READ_BACK");
      expect(run.error.message).toContain(`It was asked to name "${FOLDER} @ \`claude/successor\`", and as written it reads "${FOLDER} @ claude/successor".`);
      expect(run.error.message).toContain("this claim would lock out its own holder or admit another seat");
      expect(run.calls).toEqual([]);
      expect(run.sent).toEqual([]);
      expect(readClaimCache({ issue: ISSUE, dir: CACHE })).toBeNull();
    }
  });

  it.each([
    ["leading", (c) => `${c}${BASE}`],
    ["trailing", (c) => `${BASE}${c}`],
    ["enclosing", (c) => `${c}${BASE}${c}`],
    ["inner", (c) => `claude/${c}x`],
    ["doubled trailing", (c) => `${BASE}${c}${c}`],
  ])("every branch name git allows with a %s character is refused, or reads back as itself and admits no shorter name", (_, shape) => {
    const names = CHARS.map(shape).filter(isValidBranch);
    expect(names.length).toBeGreaterThan(60);
    let refusals = 0;
    let posted = 0;
    for (const branch of names) {
      const run = claimFor({ branch });
      if (run.error) {
        expect(run.error.code, `${JSON.stringify(branch)}: ${run.error.message}`).toBe("CLAIM_WOULD_NOT_READ_BACK");
        refusals += 1;
        continue;
      }
      const body = bodyOf(run);
      expect(admits(body, { folder: FOLDER, branch }).ok, `${JSON.stringify(branch)} does not admit its own holder`).toBe(true);
      expect(admits(body, { folder: FOLDER, branch: BASE }).code, `${JSON.stringify(branch)} admits ${BASE}`).toBe("RELEASE_BRANCH_MISMATCH");
      posted += 1;
    }
    expect(posted).toBeGreaterThan(0);
    expect(refusals + posted).toBe(names.length);
  });

  it("refuses the branch names that read as something else, and no others", () => {
    const refusedNames = CHARS.flatMap((c) => [`${c}${BASE}${c}`, `${BASE}${c}`, `${c}${BASE}`]).filter(isValidBranch).filter((branch) => claimFor({ branch }).error);
    expect(refusedNames).toEqual(["`claude/x`"]);
  });

  it.each([
    ["leading", (c) => `${c}${FOLDER}`],
    ["trailing", (c) => `${FOLDER}${c}`],
    ["enclosing", (c) => `${c}${FOLDER}${c}`],
    ["inner", (c) => `${FOLDER}\\lane${c}s`],
  ])("every folder spelling with a %s character is refused, or reads back as itself and admits no other folder", (_, shape) => {
    const names = CHARS.filter((c) => !'<>:"/\\|?*'.includes(c)).map(shape);
    let refusals = 0;
    for (const folder of names) {
      const run = claimFor({ folder });
      if (run.error) {
        expect(run.error.code, `${JSON.stringify(folder)}: ${run.error.message}`).toBe("CLAIM_WOULD_NOT_READ_BACK");
        refusals += 1;
        continue;
      }
      const body = bodyOf(run);
      expect(admits(body, { folder, branch: BRANCH }).ok, `${JSON.stringify(folder)} does not admit its own holder`).toBe(true);
      if (!samePath(folder, FOLDER)) expect(admits(body, { folder: FOLDER, branch: BRANCH }).code, `${JSON.stringify(folder)} admits ${FOLDER}`).toBe("RELEASE_NOT_HOLDER");
    }
    expect(refusals + names.length - refusals).toBe(names.length);
  });

  it("refuses a folder whose own name is wrapped in backticks, and that alone", () => {
    const refusedNames = CHARS.filter((c) => !'<>:"/\\|?*'.includes(c))
      .flatMap((c) => [`${c}${FOLDER}${c}`, `${FOLDER}${c}`, `${c}${FOLDER}`])
      .filter((folder) => claimFor({ folder }).error);
    expect(refusedNames).toEqual([`\`${FOLDER}\``]);
  });

  it.each([
    ["a line break and a second Branch line in the lane", { lane: "Claude Code\n- Branch: claude/other" }],
    ["a line break and a second Worktree folder line in the lane", { lane: "Claude Code\n- Worktree folder: C:\\lanes\\other" }],
    ["a code fence opened in the lane", { lane: "Claude Code\n```" }],
    ["a code fence opened in the executor", { executor: "Claude Code\n~~~" }],
    ["an HTML comment opened on a line of its own in the lane", { lane: "Claude Code\n<!--" }],
    ["a line break in the branch", { branch: "claude/x\nclaude/y" }],
    ["a space in the branch's line", { branch: "claude/x (cut from origin/main)" }],
    ["a line break in the folder", { folder: "C:\\lanes\\x\nC:\\lanes\\y" }],
  ])("refuses a claim with %s: it would not read back as the seat it names", (_, facts) => {
    const run = claimFor(facts);
    expect(run.result, "the claim was not refused").toBeNull();
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("CLAIM_WOULD_NOT_READ_BACK");
    expect(run.calls).toEqual([]);
    expect(run.sent).toEqual([]);
  });

  it.each([
    ["an empty branch", { branch: "" }, "(no branch)"],
    ["a null branch", { branch: null }, "(no branch)"],
    ["no branch", { branch: undefined }, "(no branch)"],
    ["an empty folder", { folder: "" }, "(no folder)"],
    ["a null folder", { folder: null }, "(no folder)"],
    ["no folder", { folder: undefined }, "(no folder)"],
  ])("refuses a claim with %s: a seat has both a folder and a branch", (_, facts, named) => {
    const run = claimFor(facts);
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("CLAIM_WOULD_NOT_READ_BACK");
    expect(run.error.message).toContain(`It was asked to name "`);
    expect(run.error.message).toContain(named);
    expect(run.sent).toEqual([]);
  });

  it("refuses on a release in the text first: that claim is refused for what it is before how it reads", () => {
    const run = claimFor({ branch: "`claude/x`", nextAction: "x\n\n### Handoff\n\n- Claim: released" });
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("PLAN_WOULD_RELEASE");
  });

  it("still posts the claims the launcher writes: a plain folder and branch read back as themselves", () => {
    const run = claimFor({});
    expect(run.error, String(run.error?.stack ?? run.error)).toBeNull();
    expect(parseClaim(bodyOf(run))).toMatchObject({ folder: FOLDER, branch: BRANCH });
    expect(admits(bodyOf(run), { folder: FOLDER, branch: BRANCH }).ok).toBe(true);
  });
});

describe("postRelease: the board row it files (#643)", () => {
  const without = (...names) => BOARD_FIELDS.filter((f) => !names.includes(f.name));
  const emptied = (name) => BOARD_FIELDS.map((f) => (f.name === name ? { ...f, id: "" } : f));

  it("clears the expiry with --clear: an empty --text is not empty", () => {
    const { sent } = allowed();
    expect(sent[4].argv.slice(-3)).toEqual(["--field-id", "F_exp", "--clear"]);
    expect(sent[4].argv).not.toContain("--text");
  });

  // The holder may release its own claim after that claim's clock ran out: expiry is an alarm, and
  // the lease is still its own.
  it("dates Last verified from the clock, never from its caller", () => {
    const { result, sent } = allowed({ now: new Date("2026-12-31T23:59:59Z") });
    expect(sent[5].describe).toBe("F_ver --date 2026-12-31");
    expect(result.steps[5].describe).toBe("set Last verified = 2026-12-31");
  });

  it("files the row as it was asked to", () => {
    const { result, sent } = allowed({ status: "Needs Kuya", gate: "Kuya" });
    expect(sent.slice(1, 3).map((s) => s.describe)).toEqual(["F_status --single-select-option-id o_needs", "F_gate --single-select-option-id o_kuya"]);
    expect(result.steps.slice(1, 3).map((s) => s.describe)).toEqual(["set Status = Needs Kuya", "set Gate = Kuya"]);
  });

  it("reads the Next action out of the Handoff it posts", () => {
    const { result, sent } = allowed({ handoff: { outcome: "done", claim: "released", nextAction: "Codex reviews the exact head." } });
    expect(sent[3].describe).toBe("F_next --text Codex reviews the exact head.");
    expect(result.steps[3].describe).toBe("set Next action = Codex reviews the exact head.");
  });

  it.each([undefined, "", "   "])("clears the Next action when the Handoff names none (%j)", (nextAction) => {
    const { result, sent } = allowed({ handoff: { outcome: "done", claim: "released", nextAction } });
    expect(sent[3].describe).toBe("F_next --clear");
    expect(sent[3].argv).not.toContain("--text");
    expect(result.steps[3].describe).toBe("clear Next action");
  });

  // An option the board does not have would end the lease and leave the row saying Active. A name
  // every object answers to (`constructor`) is not an option either.
  it.each(["Reveiw", "review", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", 5, null, ""])(
    "refuses a Status the board does not have (%j), before its seat or the thread is read",
    (status) => {
      const run = refusedRun("RELEASE_UNKNOWN_OPTION", { status });
      expect(run.error.reason).toBe(`--status "${String(status)}" is not an option on the board. It has: Active, Needs Kuya, Review.`);
      expect(run.error).toMatchObject({ flag: "--status", options: ["Active", "Needs Kuya", "Review"] });
      expect(run.reads).toBe(0);
      expect(run.git).toEqual([]);
    },
  );

  it.each(["none", "constructor", "__proto__", 0, null, ""])("refuses a Gate the board does not have (%j)", (gate) => {
    const run = refusedRun("RELEASE_UNKNOWN_OPTION", { gate });
    expect(run.error.reason).toBe(`--gate "${String(gate)}" is not an option on the board. It has: None, Kuya.`);
    expect(run.error).toMatchObject({ flag: "--gate", options: ["None", "Kuya"] });
    expect(run.reads).toBe(0);
    expect(run.git).toEqual([]);
  });

  it.each([
    ["the project has no id", { project: {} }, "the project"],
    ["the row has an empty id", { rows: [{ ...BOARD_ROWS[0], id: "" }] }, "the row"],
    ["the row has no id", { rows: [{ title: "the release guard", content: { number: ISSUE } }] }, "the row"],
    ...["Status", "Gate", "Next action", "Claim expires", "Last verified"].flatMap((name) => [
      [`the board has no ${name} field`, { fields: without(name) }, `the ${name} field`],
      [`the ${name} field has an empty id`, { fields: emptied(name) }, `the ${name} field`],
    ]),
    ["the board has no fields", { fields: [] }, "the Status field, the Gate field, the Next action field, the Claim expires field, the Last verified field"],
  ])("refuses when %s: a row that cannot be filed is not half filed", (_, board, words) => {
    const run = refusedRun("RELEASE_BOARD_UNREADABLE", board);
    expect(run.error.reason).toBe(`The board answered without an id for ${words}, so its row cannot be filed.`);
    expect(run.reads).toBe(0);
    expect(run.git).toEqual([]);
  });

  it("needs only the fields it files: a board without Lane and Worktree / branch still takes a release", () => {
    allowed({ fields: without("Lane", "Worktree / branch") });
  });

  it.each([
    ["the board cannot be listed", { boardFails: "item-list" }, "RELEASE_BOARD_UNREADABLE", /^Work Control is unreachable: Command failed: gh project item-list$/],
    ["the project cannot be read", { boardFails: "view" }, "RELEASE_BOARD_UNREADABLE", /^The board's field ids could not be read: GraphQL: Could not resolve to a ProjectV2Item$/],
    ["the fields cannot be listed", { boardFails: "field-list" }, "RELEASE_BOARD_UNREADABLE", /^The board's field ids could not be read: GraphQL: Could not resolve to a ProjectV2Item$/],
    ["the fields were not read at all", { fields: null }, "RELEASE_BOARD_UNREADABLE", /^The board's field ids could not be read: /],
    ["the board read was cut short", { truncated: true }, "RELEASE_BOARD_UNREADABLE", /^Work Control is unreachable: board read truncated: 1 of 2 items arrived/],
    ["the board is empty", { rows: [] }, "RELEASE_NO_BOARD_ROW", /has no row on the Work Control board/],
    ["the board holds only another issue's row", { rows: [{ id: "PVTI_other", content: { number: 12 } }] }, "RELEASE_NO_BOARD_ROW", /has no row on the Work Control board/],
  ])("refuses when %s, before its seat or the thread is read", (_, board, code, reason) => {
    const run = refusedRun(code, board);
    expect(run.error.reason).toMatch(reason);
    expect(run.reads).toBe(0);
    expect(run.git).toEqual([]);
  });
});

describe("postRelease: what a run leaves behind (#643)", () => {
  it("writes nothing on a dry run, and says what it would do", () => {
    seed();
    const run = attempt({ dryRun: true });
    expect(run.error, String(run.error?.stack ?? run.error)).toBeNull();
    expect(run.result).toEqual({
      via: "holder",
      claim: expect.objectContaining({ url: B_CLAIM.url }),
      body: withRecord(RELEASED, B_CLAIM),
      url: null,
      steps: SEVEN_STEPS.map((describe) => ({ describe, ran: false })),
    });
    expect(run.sent).toEqual([]);
    expect(run.reads).toBe(1);
    expect(run.drops).toBe(0);
    expect(cached()).toMatchObject({ folder: HOLDER.folder, branch: HOLDER.branch });
  });

  it.each([
    ["RELEASE_NOT_HOLDER", { self: PREDECESSOR }],
    ["RELEASE_NO_LIVE_CLAIM", { thread: [A_CLAIM, A_RELEASE] }],
    ["RELEASE_THREAD_UNREADABLE", { answer: () => "" }],
    ["RELEASE_WOULD_NOT_RELEASE", { body: "### Handoff\n\n- Claim: HELD" }],
    ["RELEASE_UNKNOWN_OPTION", { status: "Reveiw" }],
    ["RELEASE_HOLDER_LIVE", { thread: LAPSED, self: PREDECESSOR, takeover: "it looked idle", holder: "live" }],
  ])("refuses a dry run exactly as it refuses the release (%s)", (code, opts) => {
    expect(refused(code, { ...opts, dryRun: true }).message).toBe(refused(code, opts).message);
  });

  it("leaves the local copy of the claim's scope alone when it refuses", () => {
    seed();
    refused("RELEASE_NOT_HOLDER", { self: PREDECESSOR });
    expect(cached()).toMatchObject({ folder: HOLDER.folder, branch: HOLDER.branch });
  });

  it("drops the local copy of the claim's scope, and the cached board, once it has released", () => {
    seed();
    expect(cached()).not.toBeNull();
    const { drops } = allowed();
    expect(cached()).toBeNull();
    expect(drops).toBe(1);
  });

  it("says what ran, what failed and what was not tried when a board edit fails after the Handoff is posted, and hands out no edit", () => {
    seed();
    const run = attempt({ failAt: 2 });
    expect(run.result).toBeNull();
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_HALF_RUN");
    expect(run.error.posted).toBe(true);
    expect(run.error.url).toBe(run.thread.at(-1).url);
    expect(run.error.message).toContain(`but the board row is only partly filed: ${PARTLY[2]}. No claim has been posted after the Handoff.`);
    expect(run.error.message).not.toContain("Command failed");
    expect(run.error.message).not.toContain("second line");
    expect(run.error).toMatchObject({ ran: STEPS_TO(2), failed: "set Gate = None", untried: SIX_STEPS.slice(3), cure: CURES.RELEASE_HALF_RUN });
    expect(run.error).not.toHaveProperty("remaining");
    noEditHandedOut(run.error.message);
    expect(run.sent.map((s) => s.describe)).toEqual(WRITES_TO(2));
    expect(threadLease(run.thread).claim, "the lease is released all the same").toBeNull();
    expect(cached()).toBeNull();
    expect(run.drops).toBe(1);
    expect(run.reads).toBe(3);
  });

  it("drops the cached board when the first board edit fails too: an edit gh gave up on may have been applied", () => {
    seed();
    const run = attempt({ failAt: 1 });
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_HALF_RUN");
    expect(run.error.message).toContain(`but the board row is only partly filed: ${PARTLY[1]}. No claim has been posted after the Handoff.`);
    expect(run.error).toMatchObject({ ran: STEPS_TO(1), failed: "set Status = Review", untried: SIX_STEPS.slice(2) });
    expect(run.sent.map((s) => s.describe)).toEqual(WRITES_TO(1));
    expect(run.drops).toBe(1);
    expect(cached()).toBeNull();
  });

  // Round 2 of the review: on e0362db5 a failed edit threw at once, before the last look at the thread,
  // so a claim that had landed during the edits went unseen, and the stop listed the edits left to run
  // by hand, over that claim's row. The look is taken whether or not an edit failed, and no stop hands
  // out an edit.
  it("reports the reviewer's input: a claim lands before the edits and the Gate edit fails", () => {
    seed();
    const run = attempt({ duringEdits: { at: 0, comments: [C_CLAIM] }, failAt: 2 });
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_ROW_RACED");
    expect(run.error.message).toContain(
      `and its lease is released, but a claim landed while the row was being edited (${held(C_CLAIM, THIRD)}), and the row is only partly filed: ${PARTLY[2]}. The row may now hold this release's values over that claim's, and no more of this release's edits are run.`,
    );
    expect(run.error).toMatchObject({ posted: true, live: { url: C_CLAIM.url }, ran: STEPS_TO(2), failed: "set Gate = None", untried: SIX_STEPS.slice(3), cure: CURES.RELEASE_ROW_RACED });
    expect(run.error).not.toHaveProperty("remaining");
    noEditHandedOut(run.error.message);
    expect(run.sent.map((s) => s.describe)).toEqual(WRITES_TO(2));
    expect(threadLease(run.thread).claim?.url).toBe(C_CLAIM.url);
    expect(cached()).toBeNull();
    expect(run.drops).toBe(1);
    expect(run.reads).toBe(3);
  });

  const RACED_AND_FAILED = [1, 2, 3, 4, 5].flatMap((failAt) => Array.from({ length: failAt }, (_, at) => [failAt, at]));
  it.each(RACED_AND_FAILED)("sees the claim when edit %i fails and the claim landed after %i edits", (failAt, at) => {
    const run = attempt({ duringEdits: { at, comments: [C_CLAIM] }, failAt });
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_ROW_RACED");
    expect(run.error.message).toContain(`and the row is only partly filed: ${PARTLY[failAt]}. The row may now hold`);
    expect(run.error).toMatchObject({ live: { url: C_CLAIM.url }, ran: STEPS_TO(failAt), failed: SIX_STEPS[failAt], untried: SIX_STEPS.slice(failAt + 1), cure: CURES.RELEASE_ROW_RACED });
    noEditHandedOut(run.error.message);
    expect(run.sent.map((s) => s.describe)).toEqual(WRITES_TO(failAt));
    expect(run.drops).toBe(1);
    expect(run.reads).toBe(3);
  });

  it.each([1, 2, 3, 4, 5])("says what ran, what failed and what was not tried when edit %i fails and no claim followed", (failAt) => {
    const run = attempt({ failAt });
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_HALF_RUN");
    expect(run.error.message).toContain(`but the board row is only partly filed: ${PARTLY[failAt]}. No claim has been posted after the Handoff.`);
    expect(run.error).toMatchObject({ ran: STEPS_TO(failAt), failed: SIX_STEPS[failAt], untried: SIX_STEPS.slice(failAt + 1), cure: CURES.RELEASE_HALF_RUN });
    expect(run.error).not.toHaveProperty("live");
    noEditHandedOut(run.error.message);
    expect(run.reads).toBe(3);
    expect(run.drops).toBe(1);
  });

  it.each([1, 2, 3, 4, 5])("says it could not look again when edit %i fails and the thread cannot be read after it", (failAt) => {
    const run = attempt({ failAt, answer: (n) => (n >= 3 ? "<html>502 Bad Gateway</html>" : undefined) });
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_HALF_RUN");
    expect(run.error.message).toContain(
      `but the board row is only partly filed: ${PARTLY[failAt]}. The thread could not be read again after the board edits (the last read was refused: GitHub's answer was not JSON), so a claim landing in those seconds would not have been seen.`,
    );
    expect(run.error).toMatchObject({ ran: STEPS_TO(failAt), failed: SIX_STEPS[failAt], untried: SIX_STEPS.slice(failAt + 1), cure: CURES.RELEASE_HALF_RUN_UNCHECKED });
    noEditHandedOut(run.error.message);
    expect(run.reads).toBe(5);
    expect(run.drops).toBe(1);
  });

  it("says so when gh gives up posting the Handoff: nothing is known to be written, and the lease is untouched", () => {
    seed();
    const run = attempt({ failAt: 0 });
    expect(run.result).toBeNull();
    expect(run.error?.code, String(run.error?.stack ?? run.error)).toBe("RELEASE_POST_FAILED");
    expect(run.error.posted).toBeNull();
    expect(run.error.reason).toBe(`gh failed posting the Handoff on #${ISSUE}: GraphQL: Could not resolve to a ProjectV2Item`);
    expect(run.error.cure).toMatch(/^No board field was edited\. Read the thread before running this again/);
    expect(run.sent).toEqual([]);
    expect(run.drops).toBe(0);
    expect(cached()).toMatchObject({ folder: HOLDER.folder, branch: HOLDER.branch });
    expect(threadLease(run.thread).claim).toMatchObject({ url: B_CLAIM.url });
  });

  it("releases all the same when the cached board cannot be dropped", () => {
    const { drops } = allowed({ dropBoardCache: "throws" });
    expect(drops).toBe(1);
  });

  it("cannot finish a half-run release by running it again: the second finds no lease, and names the first", () => {
    const first = attempt({ failAt: 3 });
    expect(first.error?.code, String(first.error?.stack ?? first.error)).toBe("RELEASE_HALF_RUN");
    const error = refused("RELEASE_NO_LIVE_CLAIM", { thread: first.thread });
    expect(error.message).toContain(first.error.url);
  });
});

describe("there is no unguarded way to release (#643)", () => {
  it("claim.mjs exports the decision and no way to act on it", () => {
    const names = Object.keys(claimModule);
    for (const gone of ["postRelease", "planRelease", "runPlan"]) expect(names).not.toContain(gone);
    for (const kept of ["releaseDecision", "releaseComment", "releaseOutcome"]) expect(names).toContain(kept);
  });

  it("release.mjs exports the one function that ends a lease, its command, and what they read with", () => {
    expect(Object.keys(releaseModule).sort()).toEqual(["cmdRelease", "measureSeat", "parseArgs", "postRelease"]);
  });

  // Every source that could write to GitHub: the entry tooling, the scripts and the hooks. The sweep
  // reads text, so it finds a writer by how it is written. It is the second line: `execPlan` and
  // `postRelease` refuse by what they are handed (above).
  const sources = (dir) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(rel);
      return /\.(?:mjs|cjs|js|ts)$/.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name) ? [rel] : [];
    });
  let swept = null;
  const all = () => (swept ??= ["tools/entry", "scripts", ".claude/hooks"].flatMap(sources).map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") })));
  const naming = (pattern) =>
    all()
      .filter((s) => pattern.test(s.text))
      .map((s) => s.file)
      .sort();

  it("sweeps the entry tooling, the scripts and the hooks", () => {
    const files = all().map((s) => s.file);
    expect(files.length).toBeGreaterThan(60);
    for (const file of ["tools/entry/claim.mjs", "tools/entry/release.mjs", "tools/entry/launch.mjs", "scripts/work-control-gate.mjs", ".claude/hooks/session-root-assert.mjs"]) {
      expect(files).toContain(file);
    }
  });

  it("no source builds a release plan", () => {
    expect(naming(/planRelease/)).toEqual([]);
  });

  it("only claim.mjs and release.mjs build a `gh issue comment` command", () => {
    expect(naming(/["']issue["'],\s*["']comment["']/)).toEqual(["tools/entry/claim.mjs", "tools/entry/release.mjs"]);
  });

  // The REST route to an issue's comments. ci-health-report.mjs posts two fixed sentences on its own
  // report issue, and lease-overlap-gate.mjs only reads. A new writer joins this list, or the one
  // above, only once it is shown that it cannot post a released Handoff.
  it("only two sources name the REST comments route, and neither can post a released Handoff", () => {
    expect(naming(/issues\/[^\s"'`?]*\/comments/)).toEqual(["scripts/ci-health-report.mjs", "scripts/lease-overlap-gate.mjs"]);
  });

  // The REST route to one comment, by number. release.mjs edits the comment it has just posted, to the
  // text it posted plus a filing line (#643, round 4): that posts nothing, and it reaches no comment
  // but its own. Nothing edits "the last comment": every session posts through one account, so the
  // last comment may be a successor's claim.
  it("only release.mjs names the route to one comment, and nothing names gh's --edit-last", () => {
    expect(naming(/issues\/comments\//)).toEqual(["tools/entry/release.mjs"]);
    expect(naming(/edit-last/)).toEqual([]);
  });

  it("no source posts a comment through GraphQL", () => {
    expect(naming(/addComment|createComment|createIssueComment/)).toEqual([]);
  });

  it("the gate's live-lease blocker names the command", () => {
    const { blockers } = evaluateWorkControl(
      { transition: "close-issue", issue: ISSUE },
      { resolveHead: () => null, headProvenance: () => ({ ok: true, why: "not under test" }), issueComments: () => claimedBy(), closingIssues: () => [] },
    );
    const lease = blockers.filter((b) => b.includes("still has a live lease"));
    expect(lease).toHaveLength(1);
    expect(lease[0]).toContain(`node tools/entry/release.mjs --issue ${ISSUE} --handoff <file>`);
  });

  it("docs/WORK_CONTROL.md points the release step at the command", () => {
    expect(readFileSync(join(ROOT, "docs/WORK_CONTROL.md"), "utf8")).toContain("node tools/entry/release.mjs --issue N --handoff <file>");
  });
});

describe("release.mjs: the command (#643)", () => {
  const ARGS = ["--issue", String(ISSUE), "--handoff", "handoff.md"];
  const REASON = "worktree removed; no session record on this machine; no compy or node process";
  const USAGE_LINE = "node tools/entry/release.mjs --issue N --handoff <file>";
  const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, "g");
  const plain = (lines) => lines.join("\n").replace(COLOUR, "");

  /**
   * The command, run in a simulated world from `self`'s seat. `handoffText` is what the --handoff file
   * holds (`file` replaces the reader). `out` and `err` are what it printed, colours removed.
   */
  function runCli(argv, { handoffText = RELEASED, file = () => handoffText, self = HOLDER, ...sim } = {}) {
    const out = [];
    const err = [];
    const run = inWorld({ seat: self, ...sim }, () => cmdRelease(argv, { file, cacheDir: tmp, log: (l) => out.push(String(l)), err: (l) => err.push(String(l)) }));
    if (run.error) throw run.error;
    return { ...run, exit: run.result, out: plain(out), err: plain(err) };
  }

  // The last six rows are #643 review, finding 6: `--takeover --dryrun` took the misspelt switch as the
  // evidence that was checked and ran for real. A value never opens with a dash.
  it.each([
    ["no --issue", ["--handoff", "h.md"], /--issue N is required/],
    ["no --handoff", ["--issue", "5"], /--handoff <file> is required/],
    ["an argument it does not know", [...ARGS, "--force"], /unknown argument "--force"/],
    ["a misspelt --dry-run", [...ARGS, "--dryrun"], /unknown argument "--dryrun"/],
    ["a stray word", [...ARGS, "now"], /unknown argument "now"/],
    ["--folder", [...ARGS, "--folder", HOLDER.folder], /--folder is not an argument/],
    ["a flag given twice", [...ARGS, "--issue", "6"], /--issue is given twice/],
    ["a switch given twice", [...ARGS, "--dry-run", "--dry-run"], /--dry-run is given twice/],
    ["a flag with no value", ["--issue", String(ISSUE), "--handoff"], /--handoff needs a value\./],
    ["a flag whose value is a flag", ["--issue", String(ISSUE), "--handoff", "--dry-run"], /--handoff needs a value, and "--dry-run" reads as another argument/],
    ["an issue that is not a number", ["--issue", "abc", "--handoff", "h.md"], /takes an issue number, not "abc"/],
    ["issue 0", ["--issue", "0", "--handoff", "h.md"], /takes an issue number, not "0"/],
    ["an issue number with a tail", ["--issue", "12x", "--handoff", "h.md"], /takes an issue number, not "12x"/],
    ["a misspelt switch after --takeover", [...ARGS, "--takeover", "--dryrun"], /--takeover needs a value, and "--dryrun" reads as another argument/],
    ["a switch after --takeover", [...ARGS, "--takeover", "--dry-run"], /--takeover needs a value, and "--dry-run" reads as another argument/],
    ["evidence that opens with a dash", [...ARGS, "--takeover", "-gone"], /--takeover needs a value, and "-gone" reads as another argument/],
    ["a switch after --status", [...ARGS, "--status", "--json"], /--status needs a value, and "--json" reads as another argument/],
    ["a dash after --gate", [...ARGS, "--gate", "-x"], /--gate needs a value, and "-x" reads as another argument/],
    ["a negative issue", ["--issue", "-5", "--handoff", "h.md"], /--issue needs a value, and "-5" reads as another argument/],
  ])("exits 2 and reads nothing on %s", (_, argv, message) => {
    const { exit, out, err, calls, sent, drops } = runCli(argv, { self: PREDECESSOR, thread: LAPSED, holder: "dead" });
    expect(exit).toBe(2);
    expect(err).toMatch(message);
    expect(err).toContain(USAGE_LINE);
    expect(out).toBe("");
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
    expect(drops).toBe(0);
  });

  it("reads its arguments: Review and None unless told, and a takeover only when asked", () => {
    expect(parseArgs(ARGS)).toEqual({ issue: ISSUE, handoff: "handoff.md", status: "Review", gate: "None", takeover: null, dryRun: false, asJson: false });
    expect(parseArgs([...ARGS, "--status", "Needs Kuya", "--gate", "Kuya", "--takeover", "", "--dry-run", "--json"])).toEqual({
      issue: ISSUE,
      handoff: "handoff.md",
      status: "Needs Kuya",
      gate: "Kuya",
      takeover: "",
      dryRun: true,
      asJson: true,
    });
  });

  it.each([
    [["--status", "Reveiw"], /--status "Reveiw" is not an option on the board\. It has: Active, Needs Kuya, Review\./],
    [["--gate", "none"], /--gate "none" is not an option on the board\. It has: None, Kuya\./],
    [["--status", "constructor"], /--status "constructor" is not an option on the board\. It has: Active, Needs Kuya, Review\./],
  ])("exits 2 on an option the board does not have (%j)", (extra, message) => {
    const { exit, out, err, sent, reads, drops } = runCli([...ARGS, ...extra]);
    expect(exit).toBe(2);
    expect(err).toMatch(message);
    expect(err).toContain(USAGE_LINE);
    expect(out).toBe("");
    expect(sent).toEqual([]);
    expect(reads).toBe(0);
    expect(drops).toBe(0);
  });

  it("exits 2 when the Handoff file cannot be read", () => {
    const { exit, out, err, calls } = runCli(ARGS, {
      file: () => {
        throw new Error("ENOENT: no such file or directory, open 'handoff.md'");
      },
    });
    expect(exit).toBe(2);
    expect(err).toMatch(/--handoff handoff\.md could not be read: ENOENT/);
    expect(err).toContain(USAGE_LINE);
    expect(out).toBe("");
    expect(calls).toEqual([]);
  });

  it.each([
    ["the board cannot be listed", { boardFails: "item-list" }, "RELEASE_BOARD_UNREADABLE"],
    ["the board's fields cannot be listed", { boardFails: "field-list" }, "RELEASE_BOARD_UNREADABLE"],
    ["the issue has no row on the board", { rows: [{ id: "PVTI_other", content: { number: 12 } }] }, "RELEASE_NO_BOARD_ROW"],
    [
      "the thread cannot be read",
      {
        answer: () => {
          throw ghFailure(["issue", "view"]);
        },
      },
      "RELEASE_THREAD_UNREADABLE",
    ],
    ["GitHub counts more comments than the read held", { count: 4 }, "RELEASE_THREAD_UNREADABLE"],
    ["GitHub's count cannot be read", { count: () => "" }, "RELEASE_THREAD_UNREADABLE"],
    ["another folder holds the lease", { self: PREDECESSOR }, "RELEASE_NOT_HOLDER"],
    ["this folder is on another branch", { self: { ...HOLDER, branch: "main" } }, "RELEASE_BRANCH_MISMATCH"],
    ["this folder is no git work tree", { self: null }, "RELEASE_SELF_UNKNOWN"],
    ["the lease is already released", { thread: [A_CLAIM, A_RELEASE] }, "RELEASE_NO_LIVE_CLAIM"],
    ["the Handoff does not release", { handoffText: "### Handoff\n\n- Claim: HELD" }, "RELEASE_WOULD_NOT_RELEASE"],
  ])("exits 1 and writes nothing when %s", (_, world, code) => {
    const { exit, out, err, sent, drops } = runCli(ARGS, world);
    expect(exit).toBe(1);
    expect(err).toContain(`REFUSE — ${code}`);
    expect(err).toContain("Nothing was written.");
    expect(out).toBe("");
    expect(sent).toEqual([]);
    expect(drops).toBe(0);
  });

  it("refuses the incident, and says who holds the lease and who is asking", () => {
    const { exit, err, sent } = runCli(ARGS, { self: PREDECESSOR });
    expect(exit).toBe(1);
    expect(err).toContain(`held by another folder: ${held(B_CLAIM)}.`);
    expect(err).toContain(`This caller is ${PREDECESSOR.folder} @ ${PREDECESSOR.branch}.`);
    expect(sent).toEqual([]);
  });

  it("--dry-run prints the comment and the steps, and writes nothing", () => {
    const { exit, out, err, sent, reads, drops } = runCli([...ARGS, "--dry-run"]);
    expect(exit).toBe(0);
    expect(sent).toEqual([]);
    expect(reads).toBe(1);
    expect(drops).toBe(0);
    expect(err).toBe("");
    expect(out).toContain(`dry run  nothing was written. #${ISSUE}'s lease (${HOLDER.folder} @ ${HOLDER.branch}) would be released with this comment:`);
    for (const l of withRecord(RELEASED, B_CLAIM).trimEnd().split("\n")) expect(out).toContain(`  | ${l}`);
    expect(out).toContain("then, once the thread shows it ended that lease, in order:");
    for (const words of SEVEN_STEPS.slice(1)) expect(out).toContain(`   ${words}`);
    expect(out).not.toContain(SIX_STEPS[0]);
  });

  it("--dry-run says when the release would be a takeover", () => {
    const { exit, out, sent } = runCli([...ARGS, "--takeover", REASON, "--dry-run"], { thread: LAPSED, self: PREDECESSOR, holder: "dead" });
    expect(exit).toBe(0);
    expect(out).toContain("would be released by takeover with this comment:");
    expect(out).toContain(`  | ${TAKEOVER_HEADER}`);
    expect(sent).toEqual([]);
  });

  it("releases, files the row as asked, and says so in one line", () => {
    const { exit, out, err, sent, drops } = runCli([...ARGS, "--status", "Needs Kuya", "--gate", "Kuya"]);
    expect(exit).toBe(0);
    expect(sent).toHaveLength(7);
    expect(sent.slice(1, 3).map((s) => s.describe)).toEqual(["F_status --single-select-option-id o_needs", "F_gate --single-select-option-id o_kuya"]);
    expect(out).toBe(`  lease released  #${ISSUE}  (${HOLDER.folder} @ ${HOLDER.branch}; 7 steps run)`);
    expect(err).toBe("");
    expect(drops).toBe(1);
  });

  it("takes over a dormant lease only with --takeover and the evidence, and records it", () => {
    const dormant = { thread: LAPSED, self: PREDECESSOR, holder: "dead" };
    const bare = runCli(ARGS, dormant);
    expect(bare.exit).toBe(1);
    expect(bare.err).toContain("REFUSE — RELEASE_NOT_HOLDER");
    expect(bare.asked).toEqual([]);
    expect(bare.sent).toEqual([]);

    const unreasoned = runCli([...ARGS, "--takeover", ""], dormant);
    expect(unreasoned.exit).toBe(1);
    expect(unreasoned.err).toContain("REFUSE — RELEASE_TAKEOVER_NO_REASON");
    expect(unreasoned.asked).toEqual([]);
    expect(unreasoned.sent).toEqual([]);

    const taken = runCli([...ARGS, "--takeover", REASON], dormant);
    expect(taken.exit).toBe(0);
    expect(taken.asked).toEqual([HOLDER.folder]);
    expect(taken.sent).toHaveLength(7);
    const comment = taken.sent[0].argv.at(-1);
    expect(comment).toContain(`\n\n${TAKEOVER_HEADER}\n`);
    expect(comment).toContain(`- Worktree/process evidence checked: ${REASON}\n`);
    expect(taken.out).toContain(`lease released  #${ISSUE}  (${HOLDER.folder} @ ${HOLDER.branch}, by takeover; 7 steps run)`);
    expect(threadLease(taken.thread).claim).toBeNull();
  });

  it("never takes over a holder that is live, whatever its expiry says", () => {
    const { exit, err, sent } = runCli([...ARGS, "--takeover", REASON], { thread: LAPSED, self: PREDECESSOR, holder: "live" });
    expect(exit).toBe(1);
    expect(err).toContain("REFUSE — RELEASE_HOLDER_LIVE");
    expect(sent).toEqual([]);
  });

  it("exits 3 when a board edit fails after the post, says what ran and what did not, and hands out no edit", () => {
    const { exit, out, err, sent, drops } = runCli(ARGS, { failAt: 3 });
    expect(exit).toBe(3);
    expect(err).toContain("RELEASED, BOARD ROW INCOMPLETE — RELEASE_HALF_RUN");
    expect(err).not.toContain("REFUSE");
    expect(err).toContain(`${PARTLY[3]}. No claim has been posted after the Handoff.`);
    expect(err).toContain(CURES.RELEASE_HALF_RUN);
    noEditHandedOut(err);
    expect(out).toBe("");
    expect(sent).toHaveLength(4);
    expect(sent.at(-1).describe).toBe(MARK_WRITE);
    expect(drops).toBe(1);
  });

  it("exits 3 when the thread cannot be read back after the post: the row is left as it is, and no edit is handed out", () => {
    const { exit, err, sent, drops } = runCli(ARGS, { lag: 3 });
    expect(exit).toBe(3);
    expect(err).toContain("POSTED, NOT CONFIRMED — RELEASE_UNVERIFIED");
    expect(err).toContain(CURES.RELEASE_UNVERIFIED);
    noEditHandedOut(err);
    expect(sent).toHaveLength(1);
    expect(drops).toBe(0);
  });

  it("exits 4 when its comment landed after another claim: it ended nothing, and the row is left alone", () => {
    const { exit, err, sent, thread } = runCli(ARGS, { thread: [A_CLAIM], self: PREDECESSOR, beforePost: [B_CLAIM] });
    expect(exit).toBe(4);
    expect(err).toContain("POSTED, ENDED NOTHING — RELEASE_ENDED_NOTHING");
    noEditHandedOut(err);
    expect(sent).toHaveLength(1);
    expect(threadLease(thread).claim).toMatchObject({ url: B_CLAIM.url });
  });

  it("exits 4 when a claim was posted straight after its release: the row is that claim's", () => {
    const { exit, err, sent } = runCli(ARGS, { afterPost: [C_CLAIM] });
    expect(exit).toBe(4);
    expect(err).toContain("RELEASED, ROW LEFT TO THE NEW CLAIM — RELEASE_ROW_TAKEN");
    noEditHandedOut(err);
    expect(sent).toHaveLength(1);
  });

  it("exits 4 when a claim landed while the row was being filed, and sends hands to the thread first", () => {
    const { exit, err, sent, drops } = runCli(ARGS, { duringEdits: { at: 3, comments: [C_CLAIM] } });
    expect(exit).toBe(4);
    expect(err).toContain("RELEASED, ROW RACED — RELEASE_ROW_RACED");
    expect(err).toContain(CURES.RELEASE_ROW_RACED);
    noEditHandedOut(err);
    expect(sent).toHaveLength(7);
    expect(drops).toBe(1);
  });

  it("exits 4 when a claim landed during the edits and one of them failed: what ran is said, and no edit is handed out", () => {
    const { exit, err, sent, drops } = runCli(ARGS, { duringEdits: { at: 0, comments: [C_CLAIM] }, failAt: 2 });
    expect(exit).toBe(4);
    expect(err).toContain("RELEASED, ROW RACED — RELEASE_ROW_RACED");
    expect(err).toContain(`and the row is only partly filed: ${PARTLY[2]}. The row may now hold this release's values over that claim's, and no more of this release's edits are run.`);
    expect(err).toContain(CURES.RELEASE_ROW_RACED);
    noEditHandedOut(err);
    expect(sent).toHaveLength(3);
    expect(drops).toBe(1);
  });

  it("exits 1 and says FAILED, not REFUSE, when gh gives up posting the Handoff", () => {
    const { exit, err, sent } = runCli(ARGS, { failAt: 0 });
    expect(exit).toBe(1);
    expect(err).toContain("FAILED — RELEASE_POST_FAILED");
    expect(err).not.toContain("REFUSE");
    expect(sent).toEqual([]);
  });

  it("exits 3 when the thread cannot be read again after the board edits: the row is filed, and hands go to the thread", () => {
    const { exit, out, err, sent, drops } = runCli(ARGS, { answer: (n) => (n >= 3 ? "" : undefined) });
    expect(exit).toBe(3);
    expect(err).toContain("RELEASED, ROW NOT CHECKED AGAIN — RELEASE_ROW_UNCHECKED");
    expect(err).toContain(CURES.RELEASE_ROW_UNCHECKED);
    noEditHandedOut(err);
    expect(out).toBe("");
    expect(sent).toHaveLength(7);
    expect(drops).toBe(1);
  });

  it("exits 3, never 0, when every look after the edits is cut short of GitHub's count: the reviewer's 99, 100, 101", () => {
    const { exit, out, err, sent, counts } = runCli(ARGS, { thread: NINETY_NINE, duringEdits: { at: 3, comments: [C_CLAIM] }, cut: 100 });
    expect(exit).toBe(3);
    expect(err).toContain("RELEASED, ROW NOT CHECKED AGAIN — RELEASE_ROW_UNCHECKED");
    expect(err).toContain(`(the last read was refused: GitHub counts 101 comments on #${ISSUE} and the read held 100)`);
    expect(err).toContain(CURES.RELEASE_ROW_UNCHECKED);
    noEditHandedOut(err);
    expect(out).toBe("");
    expect(sent).toHaveLength(7);
    expect(counts).toBe(5);
  });

  it("releases whole when one look after the board edits fails and the next answers", () => {
    const { exit, out, err, reads } = runCli(ARGS, { answer: (n) => (n === 3 ? "" : undefined) });
    expect(exit).toBe(0);
    expect(out).toContain("lease released");
    expect(err).toBe("");
    expect(reads).toBe(4);
  });

  it("posts the Handoff file's text without its byte-order mark, and with plain line ends", () => {
    const { exit, sent } = runCli(ARGS, { handoffText: String.fromCharCode(0xfeff) + RELEASED.replace(/\n/g, "\r\n") });
    expect(exit).toBe(0);
    expect(sent[0].argv.at(-1)).toBe(withRecord(RELEASED, B_CLAIM));
  });

  it("--json prints a dry run as one object", () => {
    const { exit, out, err, sent } = runCli([...ARGS, "--dry-run", "--json"]);
    expect(exit).toBe(0);
    expect(err).toBe("");
    expect(sent).toEqual([]);
    expect(JSON.parse(out)).toEqual({
      ok: true,
      issue: ISSUE,
      via: "holder",
      dryRun: true,
      url: null,
      steps: SEVEN_STEPS.map((describe) => ({ describe, ran: false })),
      body: withRecord(RELEASED, B_CLAIM),
    });
  });

  it("--json prints a refusal as one object, on the output it was asked for", () => {
    const { exit, out, err, sent } = runCli([...ARGS, "--json"], { self: PREDECESSOR });
    expect(exit).toBe(1);
    expect(err).toBe("");
    const printed = JSON.parse(out);
    expect(printed).toMatchObject({ ok: false, issue: ISSUE, code: "RELEASE_NOT_HOLDER", posted: false });
    expect(printed.cure).toMatch(/^Nothing was written/);
    expect(sent).toEqual([]);
  });

  it("--json prints a half run with what ran, what failed and what was not tried, and no edit to run", () => {
    const { exit, out, err } = runCli([...ARGS, "--json"], { failAt: 4 });
    expect(exit).toBe(3);
    expect(err).toBe("");
    const printed = JSON.parse(out);
    expect(printed).toMatchObject({ ok: false, issue: ISSUE, code: "RELEASE_HALF_RUN", posted: true, ran: STEPS_TO(4), failed: "clear Claim expires", untried: SIX_STEPS.slice(5) });
    expect(printed.url).toMatch(/#issuecomment-\d+$/);
    expect(Object.keys(printed).sort()).toEqual(["code", "cure", "failed", "issue", "ok", "posted", "ran", "reason", "untried", "url"]);
    noEditHandedOut(out);
  });

  it("measures its seat as the worktree's top level, from wherever inside it the command runs", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const seat = measureSeat({ env: {}, cwd: HERE });
    expect(samePath(seat.folder, ROOT)).toBe(true);
    expect(seat.branch).not.toBe("HEAD");
  });
});
