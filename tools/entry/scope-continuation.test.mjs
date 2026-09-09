// The write-scope reading contract, in one place (#408; #399 before it).
//
// A write scope is read in two operations and no more:
//   A. EXTRACT  raw Markdown -> the exact `Write scope` text          `scopeTextFromMarkdown`
//   B. PARSE    that text    -> normalized path patterns              `parseScopePatterns`
// `parseWriteScope` is A then B and nothing of its own, and `parseClaim(...).scope` is A with the
// claim's `scope` alias. Those are all of them.
//
// It took two issues to get there. Before #399 the claim reader ended its capture at the line break
// while the issue-body reader took continuations, so a claim whose scope wrapped declared a silent
// PREFIX of itself: on #398 the writer listed 12 paths and the gate measured 3. Before #408 there
// were still THREE Markdown boundary rules and TWO callers that pasted already-extracted text into a
// fake `- Write scope: ` bullet to reach the pattern parser, so the same body could still be read
// three ways.
//
// The direction that fails closed is the drift gate. The dangerous direction is the collision check
// in scope-overlap.mjs, which is fed `claim.scope`: an under-read claim makes a LIVE lane look like
// it holds fewer paths than it does, and a second writer can be dispatched onto the difference --
// collision rule 2 failing silently. The other dangerous direction is over-reading, which #405
// proved: prose the writer put down to DISCLAIM paths granted them instead.
//
// The guard is ONE case list run through EVERY production reader. Two test files, each pinning its
// own reader, is exactly how the readers drifted apart in the first place. Every case is a string,
// so every failure is reproducible by someone who was not here.

import { describe, expect, it } from "vitest";

import {
  normalizePattern,
  parseScopePatterns,
  parseWriteScope,
  scopeTextFromMarkdown,
} from "../../scripts/lib/claim-scope.mjs";
import { CLAIM_HEADER, parseClaim } from "./claim.mjs";

const FIVE = ["a/one.rs", "a/two.rs", "a/three.rs", "a/four.rs", "a/five.rs"];
const TEXT_FIVE = "`a/one.rs`, `a/two.rs`, `a/three.rs`, `a/four.rs`, `a/five.rs`";
const TWO = ["a/one.rs", "a/two.rs"];
const TEXT_TWO = "`a/one.rs`, `a/two.rs`";

/** A claim comment around a scope region, so one case feeds every reader unchanged. */
const claim = (...lines) => [CLAIM_HEADER, "", "- Lane: demo", ...lines, ""].join("\n");

/**
 * The shared case list. `text` is what EXTRACT must return; `paths` is what PARSE makes of that
 * text. `wraps` marks the cases whose bullet actually continues onto another line -- the cases the
 * pre-#399 one-line reader gets wrong. `beyond` names a path that sits past the boundary and must
 * never be granted; it is what the pre-#408 boundary set leaked.
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
    name: "terminates at the next `-` bullet",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "- Next action: write `b/nope.rs`"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at the next `*` bullet",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "* Next action: write `b/nope.rs`"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at the next `+` bullet",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "+ Next action: write `b/nope.rs`"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a blank line",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "", "Prose about `b/nope.rs`."),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a heading",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "#### Preflight verdict: `b/nope.rs`"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a table row",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "| Check | `b/nope.rs` |"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a numbered-list item",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "1. First, write `b/nope.rs`", "2. Then stop"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a `1)` numbered-list item",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "1) First, write `b/nope.rs`"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a fenced code block",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "```js", "const p = `b/nope.rs`;", "```"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a `~~~` fence",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "~~~", "`b/nope.rs`", "~~~"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "terminates at a thematic break",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`", "---", "Prose about `b/nope.rs`"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
  {
    name: "bold `- **Write scope:**`, wrapped",
    body: claim("- **Write scope:** `a/one.rs`,", "  `a/two.rs`", "- Started: 2026-09-09"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
  },
  {
    name: "bold `- **Write scope**:`, wrapped",
    body: claim("- **Write scope**: `a/one.rs`,", "  `a/two.rs`", "- Started: 2026-09-09"),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
  },
  {
    name: "wrapped and ended by the end of the body, with no terminator at all",
    body: claim("- Write scope: `a/one.rs`,", "  `a/two.rs`").replace(/\n$/, ""),
    text: TEXT_TWO,
    paths: TWO,
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
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
  },
  {
    name: "the label inside a fenced block is a code sample, not a declaration",
    body: claim(
      "```md",
      "- Write scope: `b/nope.rs`",
      "```",
      "- Write scope: `a/one.rs`,",
      "  `a/two.rs`",
      "- Started: 2026-09-09",
    ),
    text: TEXT_TWO,
    paths: TWO,
    wraps: true,
    beyond: "b/nope.rs",
  },
];

/** Every production reader of a write scope, and how each is asked for the same two answers. */
const READERS = [
  { name: "the posted-claim reader (parseClaim)", text: (b) => parseClaim(b)?.scope ?? null },
  { name: "the issue-body reader (scopeTextFromMarkdown)", text: (b) => scopeTextFromMarkdown(b) },
];

describe("#408 — one extraction contract, exercised through every production reader", () => {
  for (const reader of READERS) {
    it.each(CASES)(`${reader.name} reads $name`, (c) => {
      expect(reader.text(c.body)).toBe(c.text);
      expect(parseScopePatterns(reader.text(c.body))).toEqual(c.paths);
    });
  }

  it.each(CASES)("raw Markdown through parseWriteScope declares $name", (c) => {
    expect(parseWriteScope(c.body)).toEqual(c.paths);
  });

  it.each(CASES)("every reader returns the identical text for $name", (c) => {
    const answers = READERS.map((r) => r.text(c.body));
    expect(new Set(answers).size, `readers disagreed: ${JSON.stringify(answers)}`).toBe(1);
  });

  it.each(CASES.filter((c) => c.beyond))(
    "prose past the boundary never becomes write authority — $name",
    (c) => {
      for (const reader of READERS) expect(parseScopePatterns(reader.text(c.body))).not.toContain(c.beyond);
      expect(parseWriteScope(c.body)).not.toContain(c.beyond);
    },
  );

  it("a wrapped scope and its one-line equivalent declare the same paths", () => {
    const wrapped = CASES.find((c) => c.name.startsWith("wrapped across two lines"));
    const oneLine = CASES.find((c) => c.name === "one line, five paths");
    expect(wrapped.body).not.toBe(oneLine.body);
    for (const reader of READERS) {
      expect(parseScopePatterns(reader.text(wrapped.body))).toEqual(parseScopePatterns(reader.text(oneLine.body)));
      expect(parseScopePatterns(reader.text(wrapped.body))).toEqual(FIVE);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// PARSE: what the scope text declares, and what it disclaims.

/**
 * The bullet posted on #405 at 2026-09-08T22:17:20Z, verbatim. Two paths were declared; the parser
 * of the day returned EIGHT, because its disclaimer detector matched `excluding` and not `excluded`
 * and because a gap carrying no disclaimer word RESET the verdict mid-list. Seven paths written
 * down to withhold them were granted, and the drift gate then measured the lane against a scope
 * wider than its writer had typed. This literal is the regression; it is not paraphrased.
 */
const REAL_405_BULLET =
  "- Write scope: `.claude/hooks/session-root-assert.mjs`, `tools/entry/worktree-provisioning.test.mjs` (new). " +
  "Two paths, no others. `.claude/hooks/worktree-provisioning.mjs` is **withdrawn** — it cannot exist. " +
  "Still excluded, unchanged: `docs/BRANCH_DISPOSITIONS.md`, `docs/SESSION_HANDOFF.md`, `docs/RELEASE_STATE.md`, " +
  "every other living status doc, `scripts/hookspath-fleet-guard.test.mjs` (#317), " +
  "`scripts/worktree-line-endings.test.mjs`, `scripts/handoff-worktree-truth.test.mjs` (#297), and every file " +
  "changed by open PRs #404, #400, #397, #395, #394, #391, #317, #306, #297.";

const REAL_405_PATHS = [".claude/hooks/session-root-assert.mjs", "tools/entry/worktree-provisioning.test.mjs"];

const DISCLAIMER_CASES = [
  { name: "the #405 bullet, verbatim", text: REAL_405_BULLET.replace(/^- Write scope: /, ""), paths: REAL_405_PATHS },
  { name: "`excluded` disclaims, which is the defect #405 proved", text: "`a`. Excluded: `b`", paths: ["a"] },
  { name: "`excluding` still disclaims", text: "`a`, excluding `b`", paths: ["a"] },
  { name: "`excludes` disclaims", text: "`a`. This excludes `b`", paths: ["a"] },
  { name: "`excepting` disclaims", text: "`a`. Excepting `b`", paths: ["a"] },
  { name: "`but not` disclaims", text: "`a` but not `b`", paths: ["a"] },
  { name: "a bare `,` carries the disclaimer", text: "`a` but not `b`, `c`", paths: ["a"] },
  { name: "a bare `or` carries the disclaimer", text: "No other `src/` or `src-tauri/` writes.", paths: [] },
  { name: "a clause boundary re-opens granting", text: "`a` but not `b`; also `c`", paths: ["a", "c"] },
  { name: "`;` then a disclaimer disclaims again", text: "`a`; no `b` writes", paths: ["a"] },
  {
    name: "a mid-list aside carries the disclaimer instead of resetting it",
    text: "`a`. Excluded, unchanged: `b`, every other living status doc, `c`",
    paths: ["a"],
  },
  { name: "plain conjunctions grant", text: "`a`, `b`, and `c`", paths: ["a", "b", "c"] },
  { name: "prose that names no disclaimer grants", text: "a new guard under `a`, plus this lane's own `b`", paths: ["a", "b"] },
  { name: "`never` disclaims", text: "`a`. This lane never touches `b`", paths: ["a"] },
  { name: "`outside` disclaims", text: "`a`. Nothing outside it: `b`", paths: ["a"] },
  { name: "`other than` disclaims", text: "`a`, other than `b`", paths: ["a"] },
  { name: "duplicates collapse", text: "`a`, `a`, `b`", paths: ["a", "b"] },
  { name: "unbackticked prose is not a scope", text: "scripts/foo.mjs and docs/", paths: [] },
  { name: "empty text declares nothing", text: "", paths: [] },
];

describe("#408 — a disclaimer governs the rest of its clause", () => {
  it.each(DISCLAIMER_CASES)("$name", (c) => {
    expect(parseScopePatterns(c.text)).toEqual(c.paths);
    // The same text through the raw-Markdown door must agree; there is only one parser behind both.
    expect(parseWriteScope(`- Write scope: ${c.text}`)).toEqual(c.paths);
  });

  it("the #405 bullet read as raw Markdown declares the two paths its writer typed", () => {
    expect(parseWriteScope(REAL_405_BULLET)).toEqual(REAL_405_PATHS);
    expect(scopeTextFromMarkdown(REAL_405_BULLET)).toContain("Still excluded, unchanged:");
  });

  it("a disclaimer that TRAILS its path is NOT read — stated, not fixed", () => {
    // The verdict is decided from the gap BEFORE each path, which is what lets `a` survive
    // "`a` but not `b`". The cost is that a trailing word never reaches the path it qualifies.
    // Recorded as a known limit rather than repaired by a second, looking-backwards rule: no claim
    // in this repo's history spells an exclusion that way, and a rule with two directions is a rule
    // whose two directions can disagree. A writer excluding paths puts the word first.
    expect(parseScopePatterns("`a`. `b` excepted")).toEqual(["a", "b"]);
    expect(parseScopePatterns("`a`. Excepting `b`")).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Sensitivity controls. A guard that cannot fail is not a guard, so each defect this lane repaired
// is reproduced here and asserted to be DETECTED by the case list above.

/** The claim reader as it was before #399: `(.*)$` under `m`, one line, no continuation. */
const preFixOneLineRead = (body) => {
  const m = String(body).match(/^[-*]\s*(?:\*\*)?Write scope(?::\s*\*\*|\*\*\s*:|:)\s*(.*)$/im);
  return m ? m[1].trim() : null;
};

/** The boundary set as it was before #408: bullets, headings and table rows, and nothing else. */
const PRE_408_ENDS = /^\s*(?:[-*]\s|#|\|)/;

/** Extraction under that boundary set, and with no idea that a fenced block is not prose. */
const preFixBoundaryRead = (body) => {
  const lines = String(body).replace(/\r\n/g, "\n").split("\n");
  const label = /^\s*[-*]\s*(?:\*\*|__)?\s*Write scope\s*:?\s*(?:\*\*|__)?\s*:?\s*/i;
  const start = lines.findIndex((l) => label.test(l) && /:/.test(l));
  if (start < 0) return null;
  const out = [lines[start].replace(label, "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!lines[i].trim() || PRE_408_ENDS.test(lines[i])) break;
    out.push(lines[i].trim());
  }
  return out.join(" ").trim() || null;
};

/** The pattern parser as it was before #408: `excluding` but not `excluded`, and reset on any gap. */
const preFixPatternRead = (scopeText) => {
  const text = String(scopeText ?? "");
  const declared = [];
  let cursor = 0;
  let disclaimed = false;
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const gap = text.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const bare = /^[\s,;/]*(?:or|and|nor)?[\s,;/]*$/i.test(gap);
    if (!bare) disclaimed = /\b(?:no|not|never|except|excluding|outside|other than)\b/i.test(gap);
    if (disclaimed) continue;
    declared.push(normalizePattern(match[1]));
  }
  return declared.filter((p, i, a) => p && a.indexOf(p) === i);
};

describe("#408 — the case list can fail", () => {
  it("has cases that wrap, cases that do not, and cases with prose past the boundary", () => {
    expect(CASES.filter((c) => c.wraps).length).toBeGreaterThan(0);
    expect(CASES.filter((c) => !c.wraps).length).toBeGreaterThan(0);
    expect(CASES.filter((c) => c.beyond).length).toBeGreaterThan(0);
  });

  it("the pre-#399 one-line read is WRONG on every wrapped case and right on every other", () => {
    for (const c of CASES) {
      if (c.wraps) expect(preFixOneLineRead(c.body), c.name).not.toBe(c.text);
      else expect(preFixOneLineRead(c.body), c.name).toBe(c.text);
    }
  });

  it("under the pre-#399 behaviour a wrapped claim declares a strict PREFIX, not an error", () => {
    const wrapped = CASES.find((c) => c.name.startsWith("wrapped across two lines"));
    const under = parseScopePatterns(preFixOneLineRead(wrapped.body));
    expect(under).toEqual(["a/one.rs", "a/two.rs", "a/three.rs"]);
    // Silent, and in the direction that lets a second writer onto the difference.
    expect(FIVE.slice(0, under.length)).toEqual(under);
    expect(under.length).toBeLessThan(FIVE.length);
  });

  it("the pre-#408 boundary set reads past every structure this lane added", () => {
    // Not every boundary case is one the old set got wrong — `-`, `*`, blank lines, headings and
    // table rows it already handled. This asserts the list contains ones it did NOT, which is what
    // gives the boundary half of the matrix its sensitivity.
    const overRead = CASES.filter((c) => c.beyond).filter((c) => preFixBoundaryRead(c.body) !== c.text);
    expect(overRead.map((c) => c.name)).toEqual([
      "terminates at the next `+` bullet",
      "terminates at a numbered-list item",
      "terminates at a `1)` numbered-list item",
      "terminates at a fenced code block",
      "terminates at a `~~~` fence",
      "terminates at a thematic break",
      "the label inside a fenced block is a code sample, not a declaration",
    ]);
    // On six of the seven the over-read becomes real write authority: a path from the next block is
    // GRANTED. The seventh is the ```js fence, where the code line's own backticks re-pair and the
    // old read declares junk patterns ("js const p =") instead — a different failure, not a safer one.
    const granted = overRead.filter((c) => parseScopePatterns(preFixBoundaryRead(c.body)).includes(c.beyond));
    expect(granted.map((c) => c.name)).not.toContain("terminates at a fenced code block");
    expect(granted).toHaveLength(6);
    for (const c of granted) {
      expect(parseScopePatterns(preFixBoundaryRead(c.body)), c.name).toContain(c.beyond);
      expect(parseScopePatterns(scopeTextFromMarkdown(c.body)), c.name).not.toContain(c.beyond);
    }
    const junk = parseScopePatterns(preFixBoundaryRead(CASES.find((c) => c.name === "terminates at a fenced code block").body));
    expect(junk).not.toEqual(TWO);
    expect(junk.some((p) => !TWO.includes(p))).toBe(true);
  });

  it("the pre-#408 pattern parser GRANTS the six paths the #405 bullet disclaimed", () => {
    const wrong = preFixPatternRead(REAL_405_BULLET);
    expect(wrong).toHaveLength(8);
    expect(wrong.slice(0, 2)).toEqual(REAL_405_PATHS);
    for (const granted of [
      "docs/BRANCH_DISPOSITIONS.md",
      "docs/SESSION_HANDOFF.md",
      "docs/RELEASE_STATE.md",
      "scripts/hookspath-fleet-guard.test.mjs",
      "scripts/worktree-line-endings.test.mjs",
      "scripts/handoff-worktree-truth.test.mjs",
    ]) {
      expect(wrong, "the old parser granted this").toContain(granted);
      expect(parseScopePatterns(REAL_405_BULLET), "the new parser must not").not.toContain(granted);
    }
  });

  it("the pre-#408 pattern parser is wrong on the disclaimer cases this lane added, and right on the rest", () => {
    const wrong = DISCLAIMER_CASES.filter((c) => JSON.stringify(preFixPatternRead(c.text)) !== JSON.stringify(c.paths));
    expect(wrong.map((c) => c.name)).toEqual([
      "the #405 bullet, verbatim",
      "`excluded` disclaims, which is the defect #405 proved",
      "`excludes` disclaims",
      "`excepting` disclaims",
      "a mid-list aside carries the disclaimer instead of resetting it",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("#408 — what deliberately did NOT change", () => {
  it("`- scope:` remains a claim-only alias: the body reader still requires the full label", () => {
    const body = claim("- scope: `a/one.rs`", "- Started: 2026-09-09");
    expect(parseClaim(body)?.scope).toBe("`a/one.rs`");
    expect(scopeTextFromMarkdown(body)).toBeNull();
  });

  it("a two-column table row stays one line — a row is not a wrapped bullet", () => {
    const body = [CLAIM_HEADER, "", "| field | value |", "|---|---|", "| **scope** | `a/one.rs` |", "| **branch** | `x` |"].join("\n");
    expect(parseClaim(body)?.scope).toBe("`a/one.rs`");
  });

  it("every OTHER claim field is still read one line at a time", () => {
    const body = claim("- Next action: land the fix", "  and then some prose", "- Started: 2026-09-09");
    expect(parseClaim(body)?.nextAction).toBe("land the fix");
  });

  it("a body with no scope bullet is still null in both readers", () => {
    const body = claim("- Started: 2026-09-09");
    expect(parseClaim(body)?.scope).toBeNull();
    expect(scopeTextFromMarkdown(body)).toBeNull();
  });

  it("an empty scope bullet is null, not an empty grant", () => {
    expect(scopeTextFromMarkdown("- Write scope:\n- Next: x")).toBeNull();
    expect(parseClaim(claim("- Write scope:", "- Next: x"))?.scope).toBeNull();
    expect(parseWriteScope("- Write scope:\n- Next: x")).toEqual([]);
  });

  it("nothing but a backticked path is a declaration", () => {
    expect(parseWriteScope("- Lane: something\n- Next action: `scripts/x.mjs`")).toEqual([]);
    expect(parseWriteScope("")).toEqual([]);
    expect(parseScopePatterns(null)).toEqual([]);
    expect(scopeTextFromMarkdown(null)).toBeNull();
  });
});
