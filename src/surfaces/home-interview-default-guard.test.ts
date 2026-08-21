// THE FLAG KEEPS THE OWNER'S ANSWER (bug -> guard, 2026-08-20 — answer updated same day).
//
// This guard exists because the FIRST draft of the interview (design foundation step 3, issue #177)
// shipped its flag DEFAULT ON while the owner's recorded answer was still OFF: `compy_home_intake`
// was his off-switch for the band the interview replaces (4d1afa92 on sight, 8db70795 when he
// caught UX-1 bypassing it), and retiring his key while defaulting the successor ON was that same
// bypass under a new name. The self-review's rubric item 10 caught it; no automated guard did. So
// the mechanism became a test: a flag that stands in for an owner decision has to keep answering
// the way he answered.
//
// THE ANSWER CHANGED LEGITIMATELY on 2026-08-20: the fork was put in front of the owner with the
// cost of OFF stated as a measured fact, and he said YES — see
// docs/decisions/2026-08-20-home-interview-default.md §OWNER ANSWERED. Default is now ON, "0" (the
// Settings toggle's off) is the one literal that closes the door, and storage-throw fails ON (the
// graduated-flag convention — a shipped surface stays reachable, and ON is his answer now).
//
// HOW TO CHANGE THIS AGAIN. Exactly the way it changed this time, and never by editing the
// expectation: get the owner's call, record it in docs/decisions/, then change the default and this
// file in the same commit citing that record. If you are reading this because the test went red,
// the question to answer is "did he say so", not "what number makes this pass".
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

  it("a machine that has never been told reads ON (the owner's 2026-08-20 answer)", () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readHomeInterview()).toBe(true);
  });

  it('only an explicit "0" turns it off - junk fails toward the shipped surface', () => {
    for (const stored of ["1", "", "true", "yes", "on", "2", "null"]) {
      localStorage.setItem(KEY, stored);
      expect(readHomeInterview(), `stored ${JSON.stringify(stored)} must read ON`).toBe(true);
    }
    localStorage.setItem(KEY, "0");
    expect(readHomeInterview()).toBe(false);
  });

  it("the toggle round-trips both ways and persists the literal the reader expects", () => {
    applyHomeInterview(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(readHomeInterview()).toBe(true);
    applyHomeInterview(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(readHomeInterview()).toBe(false);
  });

  it("storage throwing does not close the door", () => {
    // The graduated-flag convention: a broken storage layer can never hide a shipped surface.
    // While the owner's answer was OFF this was deliberately inverted (a failsafe that flips his
    // answer is not a failsafe); his answer is ON now, so the failsafe and the answer agree.
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const real = proto.getItem;
    proto.getItem = () => {
      throw new Error("storage is unavailable");
    };
    try {
      expect(readHomeInterview()).toBe(true);
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
    // The default is ON because he ANSWERED, not because a lane preferred it — the record must
    // carry the answer, not just the fork.
    expect(doc).toContain("OWNER ANSWERED");
  });
});
