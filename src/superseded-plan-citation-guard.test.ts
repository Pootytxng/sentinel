import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

// SUPERSEDED-PLAN CITATION GUARD (2026-08-26).
//
// WHAT WENT WRONG. `docs/SESSION_HANDOFF.md` offered "the Instrument Bench Phase-1 build — the
// decided first UI target", citing `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`.
// That plan's own first line has said **"NOT THE CURRENT LAB PLAN ... the owner rejected it as the
// Lab"** since 2026-07-09. Worse, the handoff had inherited the claim from `CLAUDE.md` itself —
// the file that loads into EVERY session — whose LOCKED rule 6 named that rejected plan as the
// "live Lab UI". The Lab had since been rebuilt twice and shipped as the Ops Console.
//
// The owner was offered that rejected plan as a next step and picked it. Seven weeks of stale
// direction in the always-loaded brief, and nothing in the repo could see it: every existing doc
// guard checks whether a cited path EXISTS. This one existed. It was simply dead.
//
// WHY A GUARD RATHER THAN A CORRECTION. Fixing the two lines fixes today. The failure mode is
// structural — a plan gets superseded in its own header, and every doc that already pointed at it
// keeps pointing, silently, because nothing reads the target. `bug -> guard` (CLAUDE.md): a defect
// the owner catches becomes a permanent guard before the fix counts.
//
// WHAT IT ENFORCES. A live doc may cite a superseded plan or spec — often it must, as the record of
// a decision — but it must SAY SO within a line of the citation. Silence is what turns a historical
// pointer into a live recommendation. A citation that cannot say so in place gets an entry in
// CLASSIFIED below with a written reason, the same idiom as `mono-census.baseline.json`: a new one
// fails the suite until somebody classifies it, rather than passing by default.
//
// KNOWN LIMIT, stated rather than papered over: the disclosure side is a keyword window, so a line
// that happens to say "superseded" ABOUT SOMETHING ELSE passes. `docs/PRODUCT_DIRECTION.md:9` was
// exactly that — it cited the proving-ground spec beside the word "SUPERSEDED" aimed at a different
// subject. That citation was reworded to say plainly which part of the spec still stands, so the
// pass is now earned rather than lucky, but the guard cannot detect the next one of these. It stops
// the SILENT pointer, which is the failure that actually happened.

const REPO_MARKERS = ["docs/superpowers/plans", "docs/superpowers/specs"];

// A plan/spec declares its own death in a header BANNER — a `>` blockquote or a `#` heading at the
// top of the file. Three things make this narrow on purpose, each learned from a false positive the
// first draft produced against the real corpus:
//
//   1. Only banner lines count. `2026-06-03-HQ-handoff-benchmark-realignment.md` says in body prose
//      that a DIFFERENT doc "is SUPERSEDED on *purpose*". Body prose discusses; banners declare.
//   2. Only "superseded"/"not the current" count, never "the owner rejected ...". Monitor v4's
//      header records that the owner rejected an eyeball ROUND; the plan itself then shipped. A doc
//      that narrates a rejection is not a rejected doc.
//   3. Voice decides. "SUPERSEDED" (passive) is a doc reporting its own death; "SUPERSEDES"
//      (active) is a doc reporting a kill, and the live Ops Console direction opens with exactly
//      that — "**SUPERSEDES the Lab's visual/layout direction from** ...". Matching the stem would
//      have marked the current Lab direction dead.
//   4. "... SUPERSEDED **by this** brief" means the file is the SUCCESSOR, not the corpse — that is
//      how `2026-07-09-lab-redesign-COURSE-CORRECTION.md` and the benchmark realignment spec both
//      open. Read one line past the marker, because that clause is usually where markdown wrapped.
//
// A false positive here is not harmless: it would push people to bolt "(superseded)" onto pointers
// at live direction, which is the same lie in the other direction.
const BANNER = /^\s*(?:>|#)/;
const SELF_SUPERSEDED = /NOT THE CURRENT|SUPERSEDED\b/i;
const SUCCESSOR = /supersed\w*\s+by\s+this\b/i;
const HEADER_LINES = 20;

// The exact set the detector is expected to find, pinned like `mono-census.baseline.json`. Pinning
// it is what keeps the guard honest in BOTH directions: a plan newly marked superseded fails here
// until a human reads it and adds it, and a detector that silently goes blind fails here too
// instead of reporting a clean corpus. Do not edit this to make a run pass — read the header first.
const EXPECTED_SUPERSEDED = [
  "2026-06-06-arc-redress.md",
  "2026-06-06-check-play-lab.md",
  "2026-07-08-lab-proving-ground.md",
  "2026-07-09-lab-instrument-bench-p1.md",
  "2026-07-09-lab-redesign-direction-proposal.md",
  "2026-07-16-intelligence-foundation-train1.md",
  "2026-07-29-product-quality-stabilization-program.md",
  "2026-08-09-compy-care-capability-exception-gate.md",
  "2026-08-21-unverified-session-write-refusal.md",
];

// Words that make a citation honest: the reader is told the target is not current direction.
const DISCLOSURE = /supersede|superseded|rejected|retired|historical|reference|no longer|point-in-time|not the current|stale|closed/i;

// Live docs whose citations must disclose. Dated point-in-time reports are excluded by pattern —
// a 2026-07-11 audit is ALLOWED to describe what was current on 2026-07-11.
const EXCLUDED = new Set(["BACKLOG_ARCHIVE.md", "CHANGELOG.md"]);
const DATED_REPORT = /_20\d\d-\d\d-\d\d\.md$/;

// Citations that are correct as they stand and cannot phrase the disclosure inline. Key is
// "<live doc>:<superseded basename>"; the value is why it is allowed. Adding an entry is a
// deliberate act with a reason attached — that is the point.
const CLASSIFIED: Record<string, string> = {};

/** True when the file's own header banner says the file is no longer current direction. */
export function declaresItselfSuperseded(text: string): boolean {
  const lines = text.split(/\r?\n/).slice(0, HEADER_LINES);
  return lines.some((line, i) => {
    if (!BANNER.test(line) || !SELF_SUPERSEDED.test(line)) return false;
    // Strip the `>` before joining: a blockquote that wraps mid-clause puts the marker at the end
    // of one line and "by this realignment" at the start of the next, with a `>` wedged between
    // "by" and "this" that would otherwise defeat the successor test.
    const unquote = (l: string) => (l ?? "").replace(/^\s*>+\s*/, "");
    return !SUCCESSOR.test(`${unquote(line)} ${unquote(lines[i + 1])}`);
  });
}

function supersededDocs(): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of REPO_MARKERS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      if (declaresItselfSuperseded(readFileSync(join(dir, name), "utf8"))) out.set(name, `${dir}/${name}`);
    }
  }
  return out;
}

function liveDocs(): string[] {
  const out = ["CLAUDE.md", join("src-tauri", "CLAUDE.md")].filter((f) => existsSync(f));
  for (const name of readdirSync("docs")) {
    if (!name.endsWith(".md") || EXCLUDED.has(name) || DATED_REPORT.test(name)) continue;
    out.push(join("docs", name));
  }
  return out;
}

/** Every undisclosed citation of a superseded plan/spec, as "<doc>:<line> -> <basename>". */
export function undisclosedCitations(
  docs: string[],
  superseded: Map<string, string>,
  read: (f: string) => string,
): string[] {
  const bad: string[] = [];
  for (const doc of docs) {
    const lines = read(doc).split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const basename of superseded.keys()) {
        if (!line.includes(basename)) continue;
        if (CLASSIFIED[`${doc.replace(/\\/g, "/")}:${basename}`]) continue;
        // A one-line window either side: markdown wraps, and the disclaimer is often the clause
        // that got pushed onto the next line by the wrap. Wider than that and any nearby mention
        // of some OTHER rejected thing would launder this citation.
        const window = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
        if (!DISCLOSURE.test(window)) bad.push(`${doc.replace(/\\/g, "/")}:${i + 1} -> ${basename}`);
      }
    });
  }
  return bad;
}

describe("a live doc may not point at a superseded plan without saying it is superseded", () => {
  it("finds exactly the superseded set, so an empty offender list is never vacuous", () => {
    // Exact, not "at least": a detector that silently stopped matching would otherwise report a
    // spotless corpus, which is the failure this whole file exists to make impossible.
    expect([...supersededDocs().keys()].sort()).toEqual(EXPECTED_SUPERSEDED);
  });

  it("does not mistake a doc that NARRATES a rejection for a doc that IS rejected", () => {
    // All three shapes are real headers from this repo that the first draft of the detector got
    // wrong. Each one would have pushed a "(superseded)" disclaimer onto a pointer at LIVE
    // direction — the same lie, aimed the other way.
    expect(
      declaresItselfSuperseded("# Monitor v4\n\n> the **owner REJECTED the eyeball** — historical note below\n"),
      "a rejected review round is not a rejected document",
    ).toBe(false);
    expect(
      declaresItselfSuperseded("# Course correction\n\n> **STATUS: the old spec is WRONG and is\n> SUPERSEDED by this brief.**\n"),
      "the successor names the corpse; it is not the corpse",
    ).toBe(false);
    expect(
      declaresItselfSuperseded("# Handoff\n\n1. **`docs/OTHER.md` is SUPERSEDED on purpose.**\n"),
      "body prose discusses supersession; a banner declares it",
    ).toBe(false);
    expect(
      declaresItselfSuperseded("# Ops Console\n\n> **SUPERSEDES the Lab's layout direction from** `old.md`\n"),
      "active voice is a doc reporting a kill, not reporting its own death",
    ).toBe(false);
    // And the shape that IS a corpse still reads as one.
    expect(declaresItselfSuperseded("# Bench\n\n> **NOT THE CURRENT LAB PLAN.** Phases 2-4 are not being built.\n")).toBe(
      true,
    );
    expect(declaresItselfSuperseded("# Arc\n\n> **PARTLY SUPERSEDED 2026-08-25 by #216.** The rest holds.\n")).toBe(true);
  });

  it("reads live docs at all", () => {
    const docs = liveDocs();
    expect(docs.length).toBeGreaterThan(10);
    expect(docs).toContain("CLAUDE.md");
    expect(docs.map((d) => d.replace(/\\/g, "/"))).toContain("docs/SESSION_HANDOFF.md");
  });

  it("no live doc cites a superseded plan or spec without disclosing it", () => {
    const bad = undisclosedCitations(liveDocs(), supersededDocs(), (f) => readFileSync(f, "utf8"));
    expect(
      bad,
      `${bad.length} citation(s) point at a plan or spec whose own header says it is superseded, ` +
        `without saying so within a line. Either add the disclosure inline, or add a CLASSIFIED ` +
        `entry with a written reason. Do NOT widen DISCLOSURE to make one pass.`,
    ).toEqual([]);
  });

  it("catches the exact shape that got through, and does not cry wolf on an honest citation", () => {
    const superseded = new Map([["dead-plan.md", "docs/superpowers/plans/dead-plan.md"]]);
    const files: Record<string, string> = {
      // The defect, verbatim in shape: a next-step recommendation pointing at a dead plan.
      "docs/HANDOFF.md": "3. **The build** —\n   `docs/superpowers/plans/dead-plan.md`. The decided first UI target.",
      // The same citation, disclosed. Must not fire.
      "docs/HONEST.md": "See `docs/superpowers/plans/dead-plan.md` — SUPERSEDED 2026-07-09, kept as reference.",
      // Disclosed on the NEXT line, which is what a markdown wrap does to a long sentence.
      "docs/WRAPPED.md": "The direction in `docs/superpowers/plans/dead-plan.md`\nwas rejected by the owner.",
      // A doc that never mentions it.
      "docs/QUIET.md": "Nothing to see.",
    };
    const read = (f: string) => files[f.replace(/\\/g, "/")] ?? "";
    expect(undisclosedCitations(Object.keys(files), superseded, read)).toEqual(["docs/HANDOFF.md:2 -> dead-plan.md"]);

    // And a disclosure two lines away does NOT launder the citation — that window would let any
    // nearby mention of some other rejected thing count.
    const far = { "docs/FAR.md": "`docs/superpowers/plans/dead-plan.md` is the target.\n\n\nIt was rejected." };
    expect(undisclosedCitations(["docs/FAR.md"], superseded, (f) => far[f as keyof typeof far] ?? "")).toEqual([
      "docs/FAR.md:1 -> dead-plan.md",
    ]);
  });
});
