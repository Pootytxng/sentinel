// The durable launch brief — the thing that means Kuya never pastes a prompt.
//
// The owner journey ends with "Claude actually begins or resumes the correct task with its durable
// instructions". Two failure modes sit behind that sentence and this file guards both:
//
//   * The brief has to reach the session WITHOUT the owner. It cannot live in a chat message he
//     copies, and it cannot ride on the command line, where a multi-line markdown document meets
//     PowerShell quoting. It lives in a file the SessionStart hook reads.
//   * It has to still be there LATER. Compaction throws away the conversation; a brief that was
//     only ever the first message is gone with it. So the brief is re-supplied on every SessionStart
//     rather than injected once, which is what makes it durable rather than merely first.
//
// And it must not lie. Every line is a fact the launcher verified on this machine — a field the
// launch could not establish is absent or named as unknown, never filled in with something
// plausible.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sessionStartOutput } from "../../.claude/hooks/session-root-assert.mjs";
import { briefFile, openingMessage, readBrief, renderBrief, sessionTitle, writeBrief } from "./brief.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const BRANCH = "tooling/start-work-marathon";

let dir;
const brief = (over = {}) => ({
  issue: 23,
  title: "Make Compy Start Work a one-selection, self-completing owner entrypoint",
  lane: "Claude Code",
  folder: FOLDER,
  branch: BRANCH,
  base: "2ef88ab1c0ffee1234567890abcdef1234567890",
  window: 300000,
  marathon: true,
  claimExpires: "2026-08-01",
  nextAction: "Build the launch brief",
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-brief-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the brief survives the conversation it was written for", () => {
  it("round-trips through a file named for the task", () => {
    // writeBrief now returns what it wrote as well as where: the digest is bound into the launch
    // token, so the caller needs it and cannot re-derive it from a path.
    const written = writeBrief(brief(), { dir });
    expect(written.file).toBe(briefFile({ issue: 23, dir }));
    expect(written.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(readBrief({ issue: 23, dir })).toMatchObject({ issue: 23, folder: FOLDER, branch: BRANCH, marathon: true });
  });

  it("returns null rather than throwing when there is no brief, or it is unreadable", () => {
    expect(readBrief({ issue: 404, dir })).toBeNull();
    writeFileSync(briefFile({ issue: 7, dir }), "{ not json");
    expect(readBrief({ issue: 7, dir })).toBeNull();
  });

  it("keeps one brief per task, so a second launch does not read the first one's scope", () => {
    writeBrief(brief(), { dir });
    writeBrief(brief({ issue: 24, title: "Something else", branch: "tooling/next" }), { dir });
    expect(readBrief({ issue: 23, dir }).title).toContain("one-selection");
    expect(readBrief({ issue: 24, dir }).branch).toBe("tooling/next");
  });

  it("records when it was written, so a stale brief can be told from a fresh one", () => {
    writeBrief(brief(), { dir, now: new Date("2026-07-31T10:00:00.000Z") });
    expect(readBrief({ issue: 23, dir }).createdAt).toBe("2026-07-31T10:00:00.000Z");
  });
});

describe("what the brief says", () => {
  const text = (over) => renderBrief(brief(over));

  const tierLine = (t) => t.split("\n").find((l) => /context tier/i.test(l)) ?? "";

  it("names the task, the folder, the branch and the tier — the four things a session must not get wrong", () => {
    const t = text();
    expect(t).toContain("#23");
    expect(t).toContain(FOLDER);
    expect(t).toContain(BRANCH);
    expect(tierLine(t)).toMatch(/marathon/i);
    expect(t).toContain("300,000");
  });

  it("says plainly that a standard task is standard, rather than leaving the tier to be assumed", () => {
    const t = text({ window: 150000, marathon: false });
    expect(tierLine(t)).toMatch(/standard/i);
    expect(tierLine(t)).not.toMatch(/marathon/i);
    expect(t).toContain("150,000");
  });

  it("tells the session the brief will come back, so it does not treat compaction as losing the task", () => {
    expect(text()).toMatch(/SessionStart|every session|compact/i);
  });

  it("omits what the launch could not establish instead of inventing it", () => {
    const t = text({ base: null, claimExpires: null, nextAction: null });
    expect(t).not.toMatch(/null|undefined|NaN/);
    expect(t).not.toMatch(/claim (expires|until)/i);
  });

  it("names the commit the worktree was created from when there is one", () => {
    expect(text()).toContain("2ef88ab");
  });

  it("stays small enough to prepend to every single session start", () => {
    // It rides on every SessionStart, forever, in a window Kuya pays for. A brief that grows into a
    // document is a tax on the task it is supposed to help.
    expect(renderBrief(brief()).length).toBeLessThan(2500);
  });

  it("carries the authorization when the launch recorded one, because scope is not folklore", () => {
    const t = text({ authorization: "Owner message 2026-07-31: one continuous authorized tooling train." });
    expect(t).toContain("one continuous authorized tooling train");
  });
});

describe("the opening message — the reason nobody types anything", () => {
  it("tells a fresh session to begin the task it was launched for", () => {
    const m = openingMessage({ mode: "launch", brief: brief() });
    expect(m).toContain("#23");
    expect(m).toMatch(/start|begin/i);
  });

  it("tells a returning session to resume rather than to start over", () => {
    const m = openingMessage({ mode: "resume", brief: brief() });
    expect(m).toContain("#23");
    expect(m).toMatch(/resume|continue/i);
    expect(m).not.toMatch(/start over|from scratch/i);
  });

  it("is a sentence, not the brief again — the brief is already in context", () => {
    expect(openingMessage({ mode: "launch", brief: brief() }).length).toBeLessThan(400);
  });

  it("has nothing to say without a brief, rather than inventing an instruction", () => {
    expect(openingMessage({ mode: "launch", brief: null })).toBeNull();
  });
});

describe("the session title", () => {
  it("names the task, so a window full of VS Code tabs is still identifiable", () => {
    expect(sessionTitle(brief())).toContain("#23");
  });

  it("is short enough to survive a title bar", () => {
    expect(sessionTitle(brief()).length).toBeLessThanOrEqual(60);
  });

  it("is null when there is no brief", () => {
    expect(sessionTitle(null)).toBeNull();
  });
});

describe("where briefs live", () => {
  it("keeps them out of the repository — a brief is machine state, not source", () => {
    const file = briefFile({ issue: 23, dir });
    expect(file.startsWith(dir)).toBe(true);
    expect(readFileSync(writeBrief(brief(), { dir }).file, "utf8")).toContain("\"issue\": 23");
  });
});

describe("handing the brief to the session", () => {
  // The mechanism is the SessionStart hook's own documented output, not an invention: CLI 2.1.220
  // validates `hookSpecificOutput` for SessionStart with additionalContext, initialUserMessage and
  // sessionTitle. additionalContext is what makes the brief durable — it is supplied again every
  // time the session restarts. initialUserMessage is what makes it self-starting, and it is exactly
  // the field that must NOT fire twice.
  const verified = (over = {}) => ({ ok: true, mode: "launch", issue: 23, root: FOLDER, branch: BRANCH, notes: [], ...over });

  it("supplies the brief as context on the launch", () => {
    writeBrief(brief(), { dir });
    const out = sessionStartOutput(verified(), { briefDir: dir, source: "startup" });

    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toContain("#23");
    expect(out.additionalContext).toContain(BRANCH);
  });

  it("supplies it AGAIN after compaction — that is what durable means", () => {
    writeBrief(brief(), { dir });
    const out = sessionStartOutput(verified({ mode: "resume" }), { briefDir: dir, source: "compact" });
    expect(out.additionalContext).toContain("#23");
  });

  it("starts the work on a fresh window, so nothing has to be typed or pasted", () => {
    writeBrief(brief(), { dir });
    expect(sessionStartOutput(verified(), { briefDir: dir, source: "startup" }).initialUserMessage).toMatch(/begin/i);
    expect(sessionStartOutput(verified({ mode: "resume" }), { briefDir: dir, source: "startup" }).initialUserMessage).toMatch(/resume/i);
  });

  it("does NOT re-issue an opening message when a live conversation is only restarting", () => {
    // A compaction is the same session mid-thought. Telling it to begin the task again would throw
    // away what it was doing — the injected message would arrive as a fresh instruction from Kuya.
    writeBrief(brief(), { dir });
    for (const source of ["compact", "resume", "clear", "fork"]) {
      const out = sessionStartOutput(verified({ mode: "resume" }), { briefDir: dir, source });
      expect(out.initialUserMessage, `${source} must not re-open the task`).toBeUndefined();
      expect(out.additionalContext, `${source} still needs the brief`).toContain("#23");
    }
  });

  it("says nothing at all when the session was refused — an unverified session gets no instructions", () => {
    writeBrief(brief(), { dir });
    expect(sessionStartOutput({ ok: false, code: "ROOT_MISMATCH", issue: 23 }, { briefDir: dir, source: "startup" })).toBeNull();
  });

  it("says nothing when there is no brief for this task, rather than improvising one", () => {
    expect(sessionStartOutput(verified(), { briefDir: dir, source: "startup" })).toBeNull();
    expect(sessionStartOutput(verified({ issue: null }), { briefDir: dir, source: "startup" })).toBeNull();
  });

  it("titles the window with the task", () => {
    writeBrief(brief(), { dir });
    expect(sessionStartOutput(verified(), { briefDir: dir, source: "startup" }).sessionTitle).toContain("#23");
  });
});
