// THE OWNER'S OFF-SWITCH SURVIVES A RENAME (bug -> guard, 2026-08-20).
//
// This guard exists because the FIRST draft of the interview (design foundation step 3, issue #177)
// shipped its flag DEFAULT ON. That looked like a fresh decision and was not: `compy_home_intake`
// was the owner's off-switch for the band the interview replaces, he set it off on sight
// (4d1afa92, 2026-08-12 - "the what are you here to do text box was ugly looks cleaner without it"),
// and he set it off a SECOND time when he caught UX-1 bypassing it (8db70795 - "intakeAvailable now
// leads with intakeOn: off means the question is not asked").
//
// Retiring that key and defaulting its successor ON is the same bypass 8db70795 was written to
// stop, just more thorough - the switch survives under a new name and answers the opposite way.
// The self-review's rubric item 10 caught it; no automated guard did, because every existing guard
// checks safety, release integrity, or that nothing was DELETED, and this defect deletes nothing.
// So the mechanism becomes a test: a flag that stands in for an owner decision has to keep
// answering the way he answered.
//
// HOW TO CHANGE THIS LEGITIMATELY. Not by editing the expectation. Get the owner's call, record it
// in docs/decisions/ (the fork and the recommendation are already written up in
// 2026-08-20-home-interview-default.md), then change the default and this file in the same commit
// citing that record. If you are reading this because the test went red, the question to answer is
// "did he say yes", not "what number makes this pass".
// `fs`/`path`, not `node:fs`/`node:path` — the app tsconfig this file is compiled under has no
// node: protocol types, and every sibling source-contract guard in src/surfaces uses the bare form.
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyHomeInterview, readHomeInterview } from "../design/theme";

const KEY = "compy_home_interview";

describe("the interview's flag keeps the owner's answer (bug -> guard 2026-08-20)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("a machine that has never been told reads OFF", () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readHomeInterview()).toBe(false);
  });

  it('only an explicit "1" turns it on - not truthiness, not any-non-zero', () => {
    for (const stored of ["0", "", "true", "yes", "on", "2", "null"]) {
      localStorage.setItem(KEY, stored);
      expect(readHomeInterview(), `stored ${JSON.stringify(stored)} must read OFF`).toBe(false);
    }
    localStorage.setItem(KEY, "1");
    expect(readHomeInterview()).toBe(true);
  });

  it("the toggle round-trips both ways and persists the literal the reader expects", () => {
    applyHomeInterview(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(readHomeInterview()).toBe(true);
    applyHomeInterview(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(readHomeInterview()).toBe(false);
  });

  it("storage throwing does not turn the door on", () => {
    // The graduated-flag convention on the live ROOM flags fails ON, so a broken storage layer can
    // never hide a shipped room. That convention is deliberately inverted here: this flag stands in
    // for an answer the owner gave, and a failsafe that flips his answer is not a failsafe.
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const real = proto.getItem;
    proto.getItem = () => {
      throw new Error("storage is unavailable");
    };
    try {
      expect(readHomeInterview()).toBe(false);
    } finally {
      proto.getItem = real;
    }
  });

  it("Home gates the door on the flag ALONE - no second term to narrow it with later", () => {
    // 8db70795's actual defect was not the default; it was that the flag got narrowed to mean
    // something smaller ("pins the panel open") while the question rendered unconditionally. A
    // single-term expression is what makes that narrowing impossible to write by accident.
    const src = readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8");
    expect(src).toContain("const interviewAvailable = interviewOn;");
    const gated = src.match(/const interviewAvailable = .*;/g) ?? [];
    expect(gated).toHaveLength(1);
  });

  it("the switch is reachable from Settings - undiscoverable is the defect, not off", () => {
    // `compy_home_intake` had no Settings toggle anywhere in src: the only way to set it was
    // devtools, so its default was the whole story for every real user. Off is a legitimate answer
    // only while there is a one-click way to say otherwise.
    const settings = readFileSync(join("src", "surfaces", "Settings.tsx"), "utf8");
    expect(settings).toContain("readHomeInterview");
    expect(settings).toContain("applyHomeInterview");
    expect(settings).toContain("behavior.homeInterview.title");
  });

  it("the decision record the default cites actually exists and names the fork", () => {
    const doc = readFileSync(
      join("docs", "decisions", "2026-08-20-home-interview-default.md"),
      "utf8",
    );
    expect(doc).toContain("compy_home_interview");
    expect(doc).toContain("8db70795");
    expect(doc.toLowerCase()).toContain("owner");
  });
});
