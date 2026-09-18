// Guard for boundedThread in scripts/lib/scope-drift.mjs (#468).
//
// The claim cache keeps only a live claim with a scope. Every other thread answer used to leave
// nothing behind, so the PostToolUse hook asked GitHub again on the next tool call, and the one after
// that. Measured on #468: about 0.4 s and one GraphQL request per call, or the hook's whole 10 s
// timeout while GitHub hangs. boundedThread keeps those answers for the claim cache's own TTL.
//
// The properties below are the ways a wrong version would hurt:
//   * it asks more often than once per TTL for an answer that is not a scoped claim,
//   * it keeps a scoped claim, so its copy and the claim cache can disagree (#459),
//   * it changes an answer, or a memo it cannot read or write changes one,
//   * it leaves nothing behind when the reader is killed mid-ask, so the next call waits again.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CACHE_TTL_MS, boundedThread, readClaimCache, writeClaimCache } from "./lib/scope-drift.mjs";

const ROOT = resolve(process.cwd());
const T0 = new Date("2026-09-18T06:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);

const RELEASED = { claim: null, handoff: { released: true, postedAt: "2026-09-18T03:29:00Z" }, unreadable: false };
const NEVER_CLAIMED = { claim: null, handoff: null, unreadable: false };
const UNREADABLE = { claim: null, handoff: null, unreadable: true };
const SCOPELESS = { claim: { scope: null, folder: "C:/x", branch: "b", issue: 468 }, handoff: null, unreadable: false };
const SCOPED = { claim: { scope: "`docs/`", folder: "C:/x", branch: "b", issue: 468 }, handoff: null, unreadable: false };

/** A reader that answers `answer` and counts how often it was asked. */
function counted(answer) {
  const reader = (issue) => {
    reader.asked.push(issue);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(issue) : answer;
  };
  reader.asked = [];
  return reader;
}

describe("boundedThread", () => {
  let base;
  const scratch = () => mkdtempSync(join(base, "t-"));
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "compy-bounded-thread-"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("asks for a released thread once per TTL, answers the same in between, and asks again the millisecond after", () => {
    const dir = scratch();
    const read = counted(RELEASED);
    const ask = (ms) => boundedThread(read, { dir, now: at(ms) })(468);
    expect(ask(0)).toBe(RELEASED);
    for (const ms of [1, 1000, 5 * 60_000, CACHE_TTL_MS]) expect(ask(ms), `+${ms} ms`).toEqual(RELEASED);
    expect(read.asked).toHaveLength(1);
    expect(ask(CACHE_TTL_MS + 1)).toBe(RELEASED);
    expect(read.asked).toHaveLength(2);
  });

  it("keeps every answer that is not a scoped claim: never claimed, no scope, unreadable", () => {
    for (const answer of [NEVER_CLAIMED, SCOPELESS, UNREADABLE]) {
      const dir = scratch();
      const read = counted(answer);
      for (const ms of [0, 1000, 60_000]) expect(boundedThread(read, { dir, now: at(ms) })(468)).toEqual(answer);
      expect(read.asked, JSON.stringify(answer)).toHaveLength(1);
    }
  });

  it("keeps a throw as unreadable: the first call throws, and calls inside the TTL do not ask", () => {
    const dir = scratch();
    const read = counted(new Error("offline"));
    expect(() => boundedThread(read, { dir, now: at(0) })(468)).toThrow("offline");
    expect(boundedThread(read, { dir, now: at(1000) })(468)).toEqual(UNREADABLE);
    expect(read.asked).toHaveLength(1);
  });

  it("keeps a reader that answers nothing as unreadable, not as a corrupt memo that asks every call", () => {
    for (const answer of [undefined, null, "text", ["x"]]) {
      const dir = scratch();
      const read = counted(() => answer);
      expect(boundedThread(read, { dir, now: at(0) })(468)).toBe(answer);
      expect(boundedThread(read, { dir, now: at(1000) })(468)).toEqual(UNREADABLE);
      expect(read.asked).toHaveLength(1);
    }
  });

  it("never keeps a scoped claim: the caller caches that, and a second copy could disagree (#459)", () => {
    const dir = scratch();
    const read = counted(SCOPED);
    expect(boundedThread(read, { dir, now: at(0) })(468)).toBe(SCOPED);
    expect(boundedThread(read, { dir, now: at(1000) })(468)).toBe(SCOPED);
    expect(read.asked).toHaveLength(2);
    expect(() => readFileSync(join(dir, "thread-468.json"))).toThrow();
  });

  it("drops what it kept when the thread answers with a scoped claim again", () => {
    const dir = scratch();
    boundedThread(counted(RELEASED), { dir, now: at(0) })(468);
    expect(readFileSync(join(dir, "thread-468.json"), "utf8")).toContain('"released":true');
    const read = counted(SCOPED);
    expect(boundedThread(read, { dir, now: at(CACHE_TTL_MS + 1) })(468)).toBe(SCOPED);
    expect(() => readFileSync(join(dir, "thread-468.json"))).toThrow();
  });

  it("marks the thread unreadable BEFORE asking, so a reader killed mid-ask leaves a mark and the next call does not wait", () => {
    const dir = scratch();
    const inner = counted(RELEASED);
    let seenDuringAsk = null;
    const outer = counted(() => {
      seenDuringAsk = boundedThread(inner, { dir, now: at(1) })(468);
      return RELEASED;
    });
    expect(boundedThread(outer, { dir, now: at(0) })(468)).toBe(RELEASED);
    expect(seenDuringAsk).toEqual(UNREADABLE);
    expect(inner.asked).toHaveLength(0);
    // The ask finished, so what is kept now is its answer, not the mark.
    expect(boundedThread(inner, { dir, now: at(2) })(468)).toEqual(RELEASED);
    expect(inner.asked).toHaveLength(0);
  });

  it("keeps each issue apart", () => {
    const dir = scratch();
    const read = counted((issue) => (issue === 1 ? RELEASED : NEVER_CLAIMED));
    expect(boundedThread(read, { dir, now: at(0) })(1)).toEqual(RELEASED);
    expect(boundedThread(read, { dir, now: at(1) })(2)).toEqual(NEVER_CLAIMED);
    expect(boundedThread(read, { dir, now: at(2) })(1)).toEqual(RELEASED);
    expect(read.asked).toEqual([1, 2]);
  });

  it("asks when what it kept is dated in the future: a clock that went back is not a fresh answer", () => {
    const dir = scratch();
    boundedThread(counted(RELEASED), { dir, now: at(60_000) })(468);
    const read = counted(NEVER_CLAIMED);
    expect(boundedThread(read, { dir, now: at(0) })(468)).toBe(NEVER_CLAIMED);
    expect(read.asked).toHaveLength(1);
  });

  it("asks past a memo it did not write: unparsable, the wrong shape, or holding a scoped claim", () => {
    const planted = [
      "{not json",
      JSON.stringify({ askedAt: T0.toISOString() }),
      JSON.stringify({ askedAt: T0.toISOString(), read: null }),
      JSON.stringify({ askedAt: T0.toISOString(), read: [] }),
      JSON.stringify({ askedAt: "soon", read: RELEASED }),
      JSON.stringify({ askedAt: T0.toISOString(), read: SCOPED }),
    ];
    for (const text of planted) {
      const dir = scratch();
      writeFileSync(join(dir, "thread-468.json"), text);
      const read = counted(NEVER_CLAIMED);
      expect(boundedThread(read, { dir, now: at(1000) })(468), text).toBe(NEVER_CLAIMED);
      expect(read.asked, text).toHaveLength(1);
      // ...and what it wrote in its place answers the next call.
      expect(boundedThread(read, { dir, now: at(2000) })(468), text).toEqual(NEVER_CLAIMED);
      expect(read.asked, text).toHaveLength(1);
    }
  });

  it("a store it cannot write changes nothing but the cost: the answer stands, it just asks every call", () => {
    const file = join(scratch(), "not-a-dir");
    writeFileSync(file, "");
    const dir = join(file, "claims");
    const read = counted(RELEASED);
    expect(boundedThread(read, { dir, now: at(0) })(468)).toBe(RELEASED);
    expect(boundedThread(read, { dir, now: at(1000) })(468)).toBe(RELEASED);
    expect(read.asked).toHaveLength(2);
    const throwing = counted(new Error("offline"));
    expect(() => boundedThread(throwing, { dir, now: at(0) })(468)).toThrow("offline");
  });

  it("lives beside the claim cache without touching it", () => {
    const dir = scratch();
    writeClaimCache({ issue: 468, scopeText: "`docs/`" }, { dir, now: T0 });
    boundedThread(counted(RELEASED), { dir, now: at(0) })(468);
    expect(readClaimCache({ issue: 468, dir })?.scope).toEqual(["docs"]);
    boundedThread(counted(SCOPED), { dir, now: at(CACHE_TTL_MS + 1) })(468);
    expect(readClaimCache({ issue: 468, dir })?.scope).toEqual(["docs"]);
  });

  it("is not how the gate reads: the push-time verdict asks the thread itself", () => {
    const gate = readFileSync(join(ROOT, "scripts", "scope-drift-gate.mjs"), "utf8");
    expect(gate).not.toContain("boundedThread");
  });
});
