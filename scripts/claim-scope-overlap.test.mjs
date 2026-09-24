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
import { threadLease } from "../tools/entry/claim.mjs";
import { gatherScopeFacts } from "../tools/entry/gather.mjs";
import { scopeOverlapVerdict } from "../tools/entry/scope-overlap.mjs";
import {
  coversPath,
  declaresNone,
  normalizePattern,
  outsideScope,
  overlappingFiles,
  overlappingPairs,
  parseScopePatterns,
  parseWriteScope,
  scopeTextFromMarkdown,
} from "./lib/claim-scope.mjs";
import { holds } from "./lib/lease-overlap.mjs";
import { driftReport } from "./lib/scope-drift.mjs";

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
    ]);
    // The claim NAMES docs/SESSION_HANDOFF.md -- to promise it will not be touched. Reading that
    // as a grant would hand the lane the one file #291 exists to keep out of lanes, and the drift
    // check would then wave through the exact edit it was built to catch.
    expect(parseWriteScope(ALPHA)).not.toContain("docs/SESSION_HANDOFF.md");
    expect(parseWriteScope("- Write scope: `src/a.ts` but not `src/b.ts`")).toEqual(["src/a.ts"]);
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

  it("names a file in any case and either slash, as the directory and glob branches already did (#539)", () => {
    // Windows paths are case-insensitive, so both spellings are one file. Only the literal branch
    // compared exactly, and for the lease-overlap gate (#517) that miss is a false PASS: another
    // lane's claim on the same file goes unseen.
    expect(coversPath("src/Surfaces/HomeHud.tsx", "src/surfaces/homehud.tsx")).toBe(true);
    expect(coversPath("src\\Surfaces\\HomeHud.tsx", "src/surfaces/HomeHud.tsx")).toBe(true);
    expect(coversPath("src/Surfaces", "src/surfaces/HomeHud.tsx")).toBe(true);
    expect(coversPath("src/Surfaces/*.tsx", "src/surfaces/HomeHud.tsx")).toBe(true);
    // Case folding must not turn into prefix matching.
    expect(coversPath("src/Surfaces/HomeHud.tsx", "src/surfaces/HomeHud.tsx.bak")).toBe(false);
    expect(outsideScope(["src/surfaces/homehud.tsx"], ["src/Surfaces/HomeHud.tsx"])).toEqual([]);
    // Two globs that differ only in case are one scope, not two disjoint ones.
    expect(overlappingPairs(["Docs/*.md"], ["docs/*.md"])).toEqual([["Docs/*.md", "docs/*.md"]]);
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

// #554, observed 2026-09-23: #552 was a read-only measurement lane, and its claim said so in the only
// words it had. Its scope named no backticked path, so it parsed as [], and a claim that declares no
// paths holds every path (collision rule 5). The push gate then refused every later lane's push —
// #549's `tools/entry/checkouts.mjs` first. The claim below is #552's, verbatim:
// https://github.com/Pootytxng/sentinel/issues/552#issuecomment-5804878358
const CLAIM_552 = [
  "### Ownership claim",
  "",
  "- Lane: heavy compile/install vs gate npm test (#552)",
  "- Executor/tool: Claude Code — commits as `claude-code <claude-code@desk.local>`",
  "- Repository: Pootytxng/sentinel",
  "- Worktree folder: C:/Users/Kuya/code/sentinel/.claude/worktrees/ecstatic-franklin-c19ff2",
  "- Branch: claude/552-heavy-compile-gate-overlap",
  "- Base: origin/main 4a4ea2d2",
  "- Write scope: none yet. The measurement is read-only. This claim is re-posted with exact paths before any repo write.",
  "- Scope note: `scripts/lib/gate-mutex*`, `scripts/run-vitest.mjs` and `scripts/verify-local.ps1` belong to #541 and #543 until they land. Stays out of `vitest.config.ts`, `scripts/lib/tree-walk-*` and `src/test/tree-walk-budget.ts`.",
  "- Started: 2026-09-23T22:05Z",
  "- Claim expires: 2026-09-24T10:05Z (alarm only)",
  "- Next action: measure whether npm ci / tauri build / tauri dev compile / cargo overlap slows gate npm test (gate logs + transcripts, time-normalized, dose-response). Fix only if the effect is real.",
  "- Active build/install/helper processes: none",
  "",
].join("\n");
const CHECKOUTS = "tools/entry/checkouts.mjs";

describe("`Write scope: none` is declared, and holds nothing (#554)", () => {
  it("reads #552's own wording as a declaration that the lane writes nothing", () => {
    const text = scopeTextFromMarkdown(CLAIM_552, { aliases: ["scope"] });
    expect(text).toBe("none yet. The measurement is read-only. This claim is re-posted with exact paths before any repo write.");
    expect(parseScopePatterns(text)).toEqual([]);
    expect(declaresNone(text)).toBe(true);
    expect(declaresNone("none")).toBe(true);
    expect(declaresNone("None.")).toBe(true);
    expect(declaresNone("  NONE — read-only lane")).toBe(true);
  });

  it("is narrow: every other scope that names no path stays unknown, and unknown stays locked", () => {
    for (const unknown of [null, undefined, "", "TBD", "N/A", "read-only", "nothing", "the home surfaces", "nonexistent", "none-ish", "not none"]) {
      expect(declaresNone(unknown), String(unknown)).toBe(false);
    }
  });

  it("a `none` that goes on to name a path is read for the path, not as none", () => {
    const text = "none yet; will add `src/foo.ts` before writing";
    expect(declaresNone(text)).toBe(false);
    expect(parseScopePatterns(text)).toEqual(["src/foo.ts"]);
  });

  describe("every reader agrees, because each reads it through claim-scope.mjs (#408)", () => {
    const at = "2026-09-23T23:51:34Z";
    const lease = (body) => threadLease([{ body, createdAt: at, url: "u:552" }]).claim;
    const noScopeLine = CLAIM_552.replace(/^- Write scope:.*\n/m, "");
    const pathless = CLAIM_552.replace(/^- Write scope:.*$/m, "- Write scope: read-only, see the note below.");

    it("the push gate: a none claim holds no path; a pathless or missing scope holds every path", () => {
      expect(holds(lease(CLAIM_552), CHECKOUTS)).toBe(false);
      expect(lease(noScopeLine).scope).toBeNull();
      expect(holds(lease(noScopeLine), CHECKOUTS)).toBe(true);
      expect(holds(lease(pathless), CHECKOUTS)).toBe(true);
    });

    it("dispatch: a none lease is not an unknown lease, and a none task overlaps no one", () => {
      const gather = (body, scopeText = `\`${CHECKOUTS}\``) =>
        gatherScopeFacts({
          task: { number: 549 },
          items: [{ number: 552, status: "Active", lane: "Claude Code" }],
          scopeText,
          now: new Date("2026-09-24T00:10:00Z"),
          threads: () => new Map([[552, { claim: lease(body) }]]),
          git: () => `${CHECKOUTS}\n`,
          body: () => null,
        });
      const facts = gather(CLAIM_552);
      expect(facts.others).toMatchObject([{ number: 552, scope: [], none: true, live: true }]);
      expect(scopeOverlapVerdict(facts)).toMatchObject({ ok: true, unknown: [] });
      for (const body of [noScopeLine, pathless]) {
        const v = scopeOverlapVerdict(gather(body));
        expect(v.ok).toBe(false);
        expect(v.unknown).toMatchObject([{ number: 552, why: "its claim declares no paths" }]);
      }
      // The same declaration on the dispatching side: a task that writes nothing overlaps no lease,
      // even one whose scope is unknown. A task with no scope at all is still refused.
      expect(scopeOverlapVerdict(gather(pathless, "none"))).toMatchObject({ ok: true, undeclared: false });
      expect(scopeOverlapVerdict(gather(pathless, "TBD"))).toMatchObject({ ok: false, undeclared: true });
    });

    it("the drift gate: a none claim is measured, and every changed path is outside it", () => {
      const read = (text) => driftReport({ changed: [CHECKOUTS], scope: parseScopePatterns(text), none: declaresNone(text) });
      expect(read(lease(CLAIM_552).scope)).toMatchObject({ measured: true, outside: [CHECKOUTS], none: true });
      expect(read(lease(pathless).scope)).toMatchObject({ measured: false, outside: [] });
    });
  });
});
