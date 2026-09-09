// Guard for #399: a wrapped `- Write scope:` bullet silently declared a PREFIX of itself.
//
// Two readers read the same bullet. `scopeTextFromBody` reads the ISSUE BODY and took continuation
// lines, as its own doc comment said it would. `parseClaim` reads the POSTED CLAIM and ended its
// capture at `(.*)$` under `m` — one line. So a claim whose scope wrapped declared fewer paths than
// a human reads in it: on #398 the claim listed 12 and the drift gate measured 3, returning
// `ok: false` with five real claimed paths listed as `outside` on a branch nobody had written to.
//
// The direction seen there fails closed. The dangerous direction is scope-overlap.mjs's collision
// check, which is fed `claim.scope`: an under-read claim makes a LIVE lane look like it holds fewer
// paths than it does, and a second writer can be dispatched onto the difference. That is collision
// rule 2 failing silently, and rule 2 is what the one-writer model rests on.
//
// The guard is ONE case list run through BOTH readers, per the issue: two independent test files,
// each pinning its own reader, is exactly how the two parsers drifted apart in the first place.
// Every case is a string, so every failure is reproducible by someone who was not here.

import { describe, expect, it } from "vitest";

import { CLAIM_HEADER, parseClaim } from "./claim.mjs";
import { scopeFromText, scopeTextFromBody } from "./scope-overlap.mjs";

const FIVE = ["a/one.rs", "a/two.rs", "a/three.rs", "a/four.rs", "a/five.rs"];
const TEXT_FIVE = "`a/one.rs`, `a/two.rs`, `a/three.rs`, `a/four.rs`, `a/five.rs`";

/** A claim comment around a scope region, so one case feeds both readers unchanged. */
const claim = (...lines) => [CLAIM_HEADER, "", "- Lane: demo", ...lines, ""].join("\n");

/**
 * The shared case list. `text` is what BOTH readers must return; `paths` is what that text declares.
 * `wraps` marks the cases whose bullet actually continues onto another line — the cases the
 * pre-#399 one-line reader gets wrong, and therefore the ones that give this list its sensitivity.
 */
const CASES = [
  {
    name: "one line, five paths",
    body: claim(`- Write scope: ${TEXT_FIVE}`, "- Started: 2026-09-09"),
    text: TEXT_FIVE,
    paths: FIVE,
    wraps: false,
  },
  {
    name: "wrapped across two lines — the equivalent of the one-line case",
    body: claim(
      "- Write scope: `a/one.rs`, `a/two.rs`, `a/three.rs`,",
      "  `a/four.rs`, `a/five.rs`",
      "- Started: 2026-09-09",
    ),
    text: TEXT_FIVE,
    paths: FIVE,
    wraps: true,
  },
  {
    name: "wrapped across three lines, ragged indentation",
    body: claim(
      "- Write scope: `a/one.rs`, `a/two.rs`,",
      "      `a/three.rs`, `a/four.rs`,",
      "  `a/five.rs`",
      "- Started: 2026-09-09",
    ),
    text: TEXT_FIVE,
    paths: FIVE,
    wraps: true,
  },
  {
    name: "terminates at the next `-` bullet, which is not part of the scope",
    body: claim(
      "- Write scope: `a/one.rs`,",
      "  `a/two.rs`",
      "- Next action: do not write `b/nope.rs`",
    ),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "terminates at the next `*` bullet",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "* Next action: not `b/nope.rs`"),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "terminates at a blank line",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "", "Prose about `b/nope.rs`."),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "terminates at a heading",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "#### Preflight verdict: `b/nope.rs`"),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "terminates at a table row",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "| Check | `b/nope.rs` |"),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "bold `- **Write scope:**`, wrapped",
    body: claim("- **Write scope:** `a/one.rs`,", "  `a/two.rs`", "- Started: 2026-09-09"),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "bold `- **Write scope**:`, wrapped",
    body: claim("- **Write scope**: `a/one.rs`,", "  `a/two.rs`", "- Started: 2026-09-09"),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "wrapped and ended by the end of the body, with no terminator at all",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`").replace(/\n$/, ""),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
  {
    name: "one line, CRLF body",
    body: claim(`- Write scope: ${TEXT_FIVE}`, "- Started: 2026-09-09").replace(/\n/g, "\r\n"),
    text: TEXT_FIVE,
    paths: FIVE,
    wraps: false,
  },
  {
    name: "wrapped, CRLF body",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "- Started: 2026-09-09").replace(/\n/g, "\r\n"),
    text: "`a/one.rs`, `a/two.rs`",
    paths: ["a/one.rs", "a/two.rs"],
    wraps: true,
  },
];

describe("#399 — one continuation rule, exercised through both readers of `- Write scope:`", () => {
  it.each(CASES)("the claim reader reads $name", (c) => {
    expect(parseClaim(c.body)?.scope).toBe(c.text);
    expect(scopeFromText(parseClaim(c.body)?.scope)).toEqual(c.paths);
  });

  it.each(CASES)("the issue-body reader reads $name", (c) => {
    expect(scopeTextFromBody(c.body)).toBe(c.text);
    expect(scopeFromText(scopeTextFromBody(c.body))).toEqual(c.paths);
  });

  it.each(CASES)("the two readers agree on $name", (c) => {
    expect(parseClaim(c.body)?.scope).toBe(scopeTextFromBody(c.body));
  });

  it("a wrapped scope and its one-line equivalent declare the same paths", () => {
    const wrapped = CASES.find((c) => c.name.startsWith("wrapped across two lines"));
    const oneLine = CASES.find((c) => c.name === "one line, five paths");
    expect(wrapped.body).not.toBe(oneLine.body);
    for (const read of [(b) => parseClaim(b)?.scope, scopeTextFromBody]) {
      expect(scopeFromText(read(wrapped.body))).toEqual(scopeFromText(read(oneLine.body)));
      expect(scopeFromText(read(wrapped.body))).toEqual(FIVE);
    }
  });
});

/**
 * The reader as it was before #399: `(.*)$` under `m`, one line, no continuation. Kept here as a
 * SENSITIVITY CONTROL — a case list that the old behaviour also satisfies would prove nothing, and
 * a guard that cannot fail is not a guard. This asserts the list contains cases the old reader gets
 * wrong, and equally that it contains cases the old reader got RIGHT, so the fix is pinned as
 * narrow: unwrapped bullets must still read exactly as they did.
 */
const preFixOneLineRead = (body) => {
  const m = String(body).match(/^[-*]\s*(?:\*\*)?Write scope(?::\s*\*\*|\*\*\s*:|:)\s*(.*)$/im);
  return m ? m[1].trim() : null;
};

describe("#399 — the case list can fail", () => {
  it("has cases that wrap and cases that do not", () => {
    expect(CASES.filter((c) => c.wraps).length).toBeGreaterThan(0);
    expect(CASES.filter((c) => !c.wraps).length).toBeGreaterThan(0);
  });

  it("the pre-#399 one-line read is WRONG on every wrapped case and right on every other", () => {
    for (const c of CASES) {
      if (c.wraps) expect(preFixOneLineRead(c.body), c.name).not.toBe(c.text);
      else expect(preFixOneLineRead(c.body), c.name).toBe(c.text);
    }
  });

  it("under the old behaviour a wrapped claim declares a strict PREFIX of its paths, not an error", () => {
    const wrapped = CASES.find((c) => c.name.startsWith("wrapped across two lines"));
    const under = scopeFromText(preFixOneLineRead(wrapped.body));
    expect(under).toEqual(["a/one.rs", "a/two.rs", "a/three.rs"]);
    // Silent, and in the direction that lets a second writer onto the difference.
    expect(FIVE.slice(0, under.length)).toEqual(under);
    expect(under.length).toBeLessThan(FIVE.length);
  });
});

describe("#399 — what deliberately did NOT change", () => {
  it("`- scope:` remains a claim-only alias: the body reader still requires the full label", () => {
    const body = claim("- scope: `a/one.rs`", "- Started: 2026-09-09");
    expect(parseClaim(body)?.scope).toBe("`a/one.rs`");
    expect(scopeTextFromBody(body)).toBeNull();
  });

  it("a two-column table row stays one line — a row is not a wrapped bullet", () => {
    const body = [CLAIM_HEADER, "", "| field | value |", "|---|---|", "| **scope** | `a/one.rs` |", "| **branch** | `x` |"].join("\n");
    expect(parseClaim(body)?.scope).toBe("`a/one.rs`");
  });

  it("every OTHER field is still read one line at a time", () => {
    const body = claim("- Next action: land the fix", "  and then some prose", "- Started: 2026-09-09");
    expect(parseClaim(body)?.nextAction).toBe("land the fix");
  });

  it("a body with no scope bullet is still null in both readers", () => {
    const body = claim("- Started: 2026-09-09");
    expect(parseClaim(body)?.scope).toBeNull();
    expect(scopeTextFromBody(body)).toBeNull();
  });

  it("an empty scope bullet is still null in the body reader", () => {
    expect(scopeTextFromBody("- Write scope:\n- Next: x")).toBeNull();
  });
});
