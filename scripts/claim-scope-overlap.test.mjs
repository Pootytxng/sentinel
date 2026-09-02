// @vitest-environment node
//
// Negative 3 of the #291 acceptance test: "overlapping write scopes must block."
//
// Before this, nothing read the `Write scope` bullet the claim template has always prescribed. Two
// lanes could each declare a scope, both be dispatched, and discover the overlap later as a
// conflict -- or, silently, as one lane reverting the other while rebasing. "Disjoint scope" was a
// thing a session asserted about itself and nobody checked.
//
// The rule this pins: a directory scope and a file inside it are NOT disjoint. Every case below is
// a string, because the decision is a string question; the gathering (GitHub, git) belongs to the
// caller and is not what goes wrong.
import { describe, expect, it } from "vitest";
import {
  coversPath,
  normalizePattern,
  outsideScope,
  overlappingFiles,
  overlappingPairs,
  parseWriteScope,
} from "./lib/claim-scope.mjs";

// The two lanes of the pilot, verbatim from the bullets posted on #350 and #343 (2026-09-02). Kept
// as literals rather than fetched: this asserts that the comparison would have cleared THESE two
// scopes, which is a fact about the scopes, not about GitHub's availability today.
const ALPHA = `- Write scope: \`scripts/branch-disposition-audit.mjs\`, \`scripts/branch-disposition-audit.test.mjs\`, and this lane's own \`docs/dispositions/*.json\` record. Nothing else. This lane does not edit \`docs/SESSION_HANDOFF.md\`.
- Started: 2026-09-02 23:10 UTC`;

const BETA = `- Write scope: a new guard under \`scripts/closing-keyword-guard.test.mjs\`, plus this lane's own \`docs/dispositions/*.json\` record. Nothing else.
- Started: 2026-09-02 23:10 UTC`;

describe("a write scope is data, not prose", () => {
  it("reads the declared paths out of the bullet and ignores the sentences around them", () => {
    expect(parseWriteScope(ALPHA)).toEqual([
      "scripts/branch-disposition-audit.mjs",
      "scripts/branch-disposition-audit.test.mjs",
      "docs/dispositions/*.json",
      "docs/SESSION_HANDOFF.md",
    ]);
    // Stops at the next bullet. A scope that swallowed the rest of the claim would cover every path
    // named anywhere in it, which reads as a very broad claim and is really a parser bug.
    expect(parseWriteScope(ALPHA)).not.toContain("2026-09-02 23:10 UTC");
    expect(parseWriteScope("- Lane: something\n- Next action: `scripts/x.mjs`")).toEqual([]);
    expect(parseWriteScope("")).toEqual([]);
  });

  it("normalises the spellings a human actually writes", () => {
    for (const spelling of ["`scripts/`", "scripts\\", "./scripts", "  scripts  "]) {
      expect(normalizePattern(spelling), spelling).toBe("scripts");
    }
  });
});

describe("what counts as covered", () => {
  it("treats a directory as everything under it, which is the whole point", () => {
    expect(coversPath("scripts", "scripts/work-control-gate.mjs")).toBe(true);
    expect(coversPath("scripts/", "scripts/lib/dispositions.mjs")).toBe(true);
    expect(coversPath("scripts/work-control-gate.mjs", "scripts/work-control-gate.mjs")).toBe(true);
    // Not a prefix match on the STRING: `scripts` must not swallow `scripts-old`.
    expect(coversPath("scripts", "scripts-old/x.mjs")).toBe(false);
    expect(coversPath("docs/dispositions/*.json", "docs/dispositions/lane__x.json")).toBe(true);
    // A single star does not cross a separator.
    expect(coversPath("docs/*.md", "docs/archive/old.md")).toBe(false);
    expect(coversPath("docs/**/*.md", "docs/archive/old.md")).toBe(true);
  });
});

describe("two lanes, compared", () => {
  it("clears the pilot's two scopes — and says so about the scopes, not about the lanes", () => {
    const pairs = overlappingPairs(parseWriteScope(ALPHA), parseWriteScope(BETA));
    // docs/dispositions/*.json is in BOTH — deliberately. Each lane writes its OWN record there,
    // which is the property #291 exists to create, and a comparison at pattern granularity cannot
    // tell those two files apart. So the overlap it reports is real, and the reason it is harmless
    // is that the records are named per ref. This asserts exactly that much and no more.
    expect(pairs).toEqual([["docs/dispositions/*.json", "docs/dispositions/*.json"]]);
    const codePairs = overlappingPairs(
      parseWriteScope(ALPHA).filter((p) => p.startsWith("scripts/")),
      parseWriteScope(BETA).filter((p) => p.startsWith("scripts/")),
    );
    expect(codePairs, "the two lanes' code scopes must be disjoint").toEqual([]);
  });

  it("catches a folder claim swallowing another lane's file", () => {
    // The dispatch this exists to refuse: one lane claims a folder, another claims a file in it, and
    // both claims read as reasonable on their own.
    expect(overlappingPairs(["scripts"], ["scripts/work-control-gate.mjs"])).toEqual([
      ["scripts", "scripts/work-control-gate.mjs"],
    ]);
    // Both directions, because which lane is asked first must not decide the answer.
    expect(overlappingPairs(["scripts/work-control-gate.mjs"], ["scripts"])).toEqual([
      ["scripts/work-control-gate.mjs", "scripts"],
    ]);
  });

  it("abstains on two globs, and decides them exactly against the paths that exist", () => {
    // `scripts/*.mjs` and `scripts/work-*` share no common string and both claim
    // scripts/work-control-gate.mjs. No pattern-versus-pattern comparison sees that, and one that
    // appeared to would be answering by accident: `*` is an ordinary character to a regex, so
    // `scripts/*` "matches" the literal text "scripts/*.mjs" for reasons that have nothing to do
    // with the files either scope claims. Right by luck is wrong as often, so this tier abstains.
    expect(overlappingPairs(["scripts/*.mjs"], ["scripts/work-*"])).toEqual([]);
    expect(overlappingPairs(["scripts/*"], ["scripts/*.mjs"])).toEqual([]);

    // Given the paths, the same question is exact -- and the answer names the file, which is the
    // sentence a lane refused dispatch deserves to be given.
    const files = [
      "scripts/work-control-gate.mjs",
      "scripts/work-control-gate.test.mjs",
      "scripts/doc-budget.ps1",
      "scripts/lib/dispositions.mjs",
    ];
    expect(overlappingFiles(["scripts/*.mjs"], ["scripts/work-*"], files)).toEqual([
      "scripts/work-control-gate.mjs",
      "scripts/work-control-gate.test.mjs",
    ]);
    // A single star does not reach into scripts/lib, and a .ps1 is not a .mjs -- so the exact tier
    // has to be able to say no, or it is just an expensive way to always refuse.
    expect(overlappingFiles(["scripts/*.mjs"], ["scripts/*.ps1"], files)).toEqual([]);
    expect(overlappingFiles(["scripts/*"], ["scripts/lib/*"], files)).toEqual([]);
  });
  it("leaves genuinely disjoint lanes alone", () => {
    // The cost of a false positive here is a lane refused dispatch for no reason, so this is the
    // half worth being sure about.
    expect(overlappingPairs(["src/components"], ["src-tauri/src/actions.rs"])).toEqual([]);
    expect(overlappingPairs(["docs/BACKLOG.md"], ["docs/RELEASE_STATE.md"])).toEqual([]);
    expect(overlappingPairs(["scripts-old"], ["scripts"])).toEqual([]);
    expect(overlappingPairs([], ["scripts"])).toEqual([]);
  });
});

describe("the second net: a lane that drifts after dispatch", () => {
  it("names the files a diff touched that the claim never covered", () => {
    const scope = parseWriteScope(BETA);
    expect(
      outsideScope(
        ["scripts/closing-keyword-guard.test.mjs", "docs/dispositions/lane__beta.json"],
        scope,
      ),
    ).toEqual([]);
    // Disjoint at claim time, and the diff still reaches shared prose. That is the same collision,
    // arriving late, and it is the shape #291 was opened about.
    expect(
      outsideScope(["scripts/closing-keyword-guard.test.mjs", "docs/SESSION_HANDOFF.md"], scope),
    ).toEqual(["docs/SESSION_HANDOFF.md"]);
  });

  it("is not satisfied by an empty scope", () => {
    // A lane that declared nothing has claimed nothing, so every file it touched is outside. The
    // opposite reading -- no scope means no limit -- would make the check disappear exactly where
    // the claim was sloppiest.
    expect(outsideScope(["scripts/x.mjs"], [])).toEqual(["scripts/x.mjs"]);
  });
});
