// Guard 14: plain output for the owner, full evidence for whoever asks — both, always, from one run.
//
// These two requirements pull against each other, and the pull is the whole reason this file exists.
// A successful launch CLOSES its terminal (guard 13): the owner should not be handed a window to
// tidy up. But closing the terminal destroys everything the run said on its way through, and a
// refusal's check table is the only thing that makes "it refused" actionable rather than insulting.
//
// So narration forks: the terminal gets the glance, the log gets the proof, and `--quiet` silences
// the FIRST of those and never the second. The failure this guards against is the plausible-looking
// shortcut where quiet means "do not narrate" — which would leave a refusal with no recoverable
// account of itself the moment the window scrolls away or the process exits.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reportRefusal, setNarration } from "./launch.mjs";

let root;
let n = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-narration-"));
});
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  setNarration(); // back to the default sink: stderr, no log
});

const logPath = () => join(root, `run-${++n}.log`);
const captureStderr = () => vi.spyOn(console, "error").mockImplementation(() => {});
const readLog = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

// A REFUSE the way `reconcile` shapes one: rows with expected/actual, remediation, actions.
const refusal = () => ({
  verdict: "REFUSE",
  task: { number: 23, title: "Make Compy Start Work a one-selection entrypoint" },
  reason: "preflight refused #23",
  checks: [
    { id: "worktree.clean", name: "worktree clean", ok: false, expected: "no uncommitted work", actual: "3 modified files" },
    { id: "settings.window", name: "context window", ok: true, expected: "300000", actual: "300000", note: "marathon tier, scoped to this issue" },
  ],
  remediation: ["Commit or stash the 3 modified files in that folder, then run the shortcut again."],
  actions: [],
});

describe("where the account of a run goes", () => {
  it("writes to the terminal when no log is named — the default is unchanged", () => {
    const err = captureStderr();
    setNarration();
    reportRefusal(refusal());
    expect(err).toHaveBeenCalled();
  });

  it("writes to BOTH when a log is named and the run is loud", () => {
    const err = captureStderr();
    const file = logPath();
    setNarration({ logFile: file });
    reportRefusal(refusal());
    expect(err).toHaveBeenCalled();
    expect(readLog(file)).toContain("worktree clean");
  });

  // The one that matters. Quiet is about the owner's screen, not about the record.
  it("keeps the full check table in the log when the terminal is quiet", () => {
    const err = captureStderr();
    const file = logPath();
    setNarration({ quiet: true, logFile: file });
    reportRefusal(refusal());

    expect(err).not.toHaveBeenCalled();
    const log = readLog(file);
    expect(log).toContain("#23");
    expect(log).toContain("worktree clean");
    expect(log).toContain("3 modified files");
    expect(log).toContain("Commit or stash");
  });

  it("records a passing row's note, so a check that had something to say says it to somebody", () => {
    captureStderr();
    const file = logPath();
    setNarration({ quiet: true, logFile: file });
    reportRefusal(refusal());
    expect(readLog(file)).toContain("marathon tier, scoped to this issue");
  });

  it("creates the log directory rather than expecting one", () => {
    captureStderr();
    const file = join(root, "made", "up", "path", "launch.log");
    setNarration({ quiet: true, logFile: file });
    reportRefusal(refusal());
    expect(existsSync(file)).toBe(true);
  });

  it("strips the colour codes — a log is read in a text editor, not a terminal", () => {
    captureStderr();
    const file = logPath();
    setNarration({ quiet: true, logFile: file });
    reportRefusal(refusal());
    expect(readLog(file)).not.toContain("\u001b[");
  });

  it("stamps every line, so the log says WHEN as well as what", () => {
    captureStderr();
    const file = logPath();
    let t = 0;
    setNarration({ quiet: true, logFile: file, now: () => new Date(Date.UTC(2026, 6, 30, 12, 0, ++t)) });
    reportRefusal(refusal());
    // Spacer lines stay spacers: a stamp on an empty line is a timestamp on nothing, and it would
    // cost the log the shape that makes a check table readable.
    const lines = readLog(file).split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(line).toMatch(/^2026-07-30T12:00:\d\d\.\d{3}Z .*\S/);
  });

  // Evidence, not a precondition. A log that cannot be written is a bad thing to lose and a much
  // worse thing to fail a launch over — the owner would be refused a task for a full disk.
  it("does not throw when the log cannot be written", () => {
    captureStderr();
    setNarration({ quiet: true, logFile: root }); // a directory: appendFileSync will refuse it
    expect(() => reportRefusal(refusal())).not.toThrow();
  });
});

describe("what counts as evidence worth printing", () => {
  it("says nothing at all when there is no check table to show", () => {
    const err = captureStderr();
    const file = logPath();
    setNarration({ logFile: file });
    // The unreachable-board refusal: a reason, no rows. The launcher prints the reason itself; a
    // headed table with nothing under it would be ceremony pretending to be proof.
    expect(reportRefusal({ verdict: "REFUSE", reason: "Work Control unreachable: timed out" })).toBe(false);
    expect(err).not.toHaveBeenCalled();
    expect(readLog(file)).toBe("");
  });

  it("reports that it printed, so the launcher never has to guess whether proof exists", () => {
    captureStderr();
    setNarration({ quiet: true, logFile: logPath() });
    expect(reportRefusal(refusal())).toBe(true);
  });
});
