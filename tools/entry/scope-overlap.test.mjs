// Guard for #358: a dispatch whose Write scope overlaps another Active writer's is refused before
// anything is written. The pilot's acceptance items: a second overlapping writer is refused (5), two
// disjoint scopes are not falsely blocked (6), and — the case the naive wiring passes — two GLOBBED
// overlapping scopes are refused (the third). Every decision case is a string case; the wiring cases
// pin the readers that feed it, because a decision nobody calls is the bug this issue is about.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REMEDIATION_ORDER, reconcile } from "./preflight.mjs";
import { overlapRemediation, scopeFromText, scopeOverlapVerdict, scopeTextFromBody } from "./scope-overlap.mjs";

const read = (rel) => readFileSync(rel, "utf8");
const TRACKED = [
  "scripts/work-control-gate.mjs",
  "scripts/work-control-gate.test.mjs",
  "scripts/doc-budget.ps1",
  "scripts/lib/dispositions.mjs",
  "docs/dispositions/lane__alpha.json",
  "docs/dispositions/lane__beta.json",
  "src/App.tsx",
  "src/surfaces/Health.tsx",
];

describe("acceptance 5 — a second overlapping writer is refused", () => {
  it("the same path, exactly", () => {
    const v = scopeOverlapVerdict({ mine: ["scripts/work-control-gate.mjs"], others: [{ number: 13, lane: "Codex", scope: ["scripts/work-control-gate.mjs"] }], files: TRACKED });
    expect(v.ok).toBe(false);
    expect(v.findings.map((f) => f.number)).toEqual([13]);
    expect(v.reason).toContain("#13 (Codex)");
  });

  it("a folder against a file inside it, in both directions", () => {
    for (const [mine, theirs] of [[["scripts"], ["scripts/work-control-gate.mjs"]], [["scripts/work-control-gate.mjs"], ["scripts/"]]]) {
      const v = scopeOverlapVerdict({ mine, others: [{ number: 13, scope: theirs }], files: TRACKED });
      expect(v.ok, `${mine} vs ${theirs}`).toBe(false);
      expect(v.findings[0].pairs.length).toBeGreaterThan(0);
    }
  });

  it("the third case: two globbed scopes that share no string and claim the same file", () => {
    // overlappingPairs abstains here on purpose (#358 trap 1); the exact tier, fed the tracked
    // paths, names the file. A wiring that called only the literal tier would print "no overlap".
    const v = scopeOverlapVerdict({ mine: ["scripts/*.mjs"], others: [{ number: 13, lane: "Codex", scope: ["scripts/work-*"] }], files: TRACKED });
    expect(v.ok).toBe(false);
    expect(v.findings[0].pairs).toEqual([]);
    expect(v.findings[0].files).toEqual(["scripts/work-control-gate.mjs", "scripts/work-control-gate.test.mjs"]);
    expect(v.reason).toContain("scripts/work-control-gate.mjs");
    // The pilot's own shape: `src/*.tsx` against `src/surfaces/*` is disjoint (a star does not cross
    // a separator), and `src/**` against `src/surfaces/*` is not.
    expect(scopeOverlapVerdict({ mine: ["src/*.tsx"], others: [{ number: 13, scope: ["src/surfaces/*"] }], files: TRACKED }).ok).toBe(true);
    expect(scopeOverlapVerdict({ mine: ["src/**"], others: [{ number: 13, scope: ["src/surfaces/*"] }], files: TRACKED }).ok).toBe(false);
  });

  it("a shared glob is a real overlap, and the cure says to name the one file the lane owns", () => {
    // The pilot's two claims both said `docs/dispositions/*.json`. Each meant its own record; the
    // pattern claims every record. The dispatcher must say so rather than guess at the intent.
    const glob = ["docs/dispositions/*.json"];
    const v = scopeOverlapVerdict({ mine: glob, others: [{ number: 13, scope: glob }], files: TRACKED });
    expect(v.ok).toBe(false);
    expect(overlapRemediation(v)).toContain("docs/dispositions/<ref>.json");
    // Narrowed to the record each lane owns, the same two lanes pass.
    expect(scopeOverlapVerdict({ mine: ["docs/dispositions/lane__alpha.json"], others: [{ number: 13, scope: ["docs/dispositions/lane__beta.json"] }], files: TRACKED }).ok).toBe(true);
  });
});

describe("acceptance 6 — disjoint scopes are not falsely blocked", () => {
  it("passes disjoint literals, disjoint globs, and a lane with nobody else Active", () => {
    expect(scopeOverlapVerdict({ mine: ["src/components"], others: [{ number: 13, scope: ["src-tauri/src/actions.rs"] }], files: TRACKED }).ok).toBe(true);
    expect(scopeOverlapVerdict({ mine: ["scripts/*.mjs"], others: [{ number: 13, scope: ["scripts/*.ps1"] }], files: TRACKED }).ok).toBe(true);
    expect(scopeOverlapVerdict({ mine: ["scripts-old"], others: [{ number: 13, scope: ["scripts"] }], files: TRACKED }).ok).toBe(true);
    const alone = scopeOverlapVerdict({ mine: ["scripts"], others: [], files: TRACKED });
    expect(alone.ok).toBe(true);
    expect(alone.reason).toBe("no other live writer");
  });

  it("an Active row with no live claim behind it is named, not treated as a writer", () => {
    // The board said Active for eight rows on 2026-09-02; six had no live claim (none posted,
    // released, or expired weeks earlier). Refusing every dispatch on those would make the check a
    // wall, and passing silently would hide the hygiene finding. The row names them.
    const v = scopeOverlapVerdict({
      mine: ["scripts"],
      others: [
        { number: 278, lane: "Claude Code", scope: null, live: false },
        { number: 55, lane: "Codex", scope: [], expired: true, expires: "2026-08-03" },
      ],
      files: TRACKED,
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toContain("#278 (Claude Code) (no live claim)");
    expect(v.reason).toContain("#55 (Codex) (claim expired 2026-08-03)");
    expect(v.stale.map((s) => s.number)).toEqual([278, 55]);
    // Nor do stale rows alone refuse a task that has not declared its scope yet.
    expect(scopeOverlapVerdict({ mine: null, others: [{ number: 278, scope: null, live: false }], files: TRACKED }).ok).toBe(true);
  });

  it("still refuses when the paths a stale claim declared overlap — renew it or retire it", () => {
    const v = scopeOverlapVerdict({ mine: ["scripts"], others: [{ number: 287, lane: "Claude Code", scope: ["scripts/x.mjs"], expired: true, expires: "2026-09-02" }], files: TRACKED });
    expect(v.ok).toBe(false);
    expect(v.findings[0].stale).toBe(true);
    expect(v.reason).toContain("claim expired 2026-09-02");
    expect(overlapRemediation(v)).toContain("#287");
    expect(overlapRemediation(v)).toMatch(/renew .* or retire/);
  });

  it("names the writers it cleared, so a PASS row says what was compared", () => {
    const v = scopeOverlapVerdict({ mine: ["docs/BACKLOG.md"], others: [{ number: 13, lane: "Codex", scope: ["docs/RELEASE_STATE.md"] }, { number: 14, lane: "Cowork", scope: ["src"] }], files: TRACKED });
    expect(v.ok).toBe(true);
    expect(v.reason).toBe("disjoint from #13 (Codex), #14 (Cowork)");
  });
});

describe("unknown means locked (collision rule 4)", () => {
  it("refuses a task with no scope while another writer is Active, and only then", () => {
    const withWriter = scopeOverlapVerdict({ mine: null, others: [{ number: 13, lane: "Codex", scope: ["scripts"] }], files: TRACKED });
    expect(withWriter.ok).toBe(false);
    expect(withWriter.undeclared).toBe(true);
    expect(overlapRemediation(withWriter)).toContain("--scope");
    const alone = scopeOverlapVerdict({ mine: [], others: [], files: TRACKED });
    expect(alone.ok).toBe(true);
    expect(alone.undeclared).toBe(true);
    expect(alone.reason).toContain("narrow it before the first write");
  });

  it("refuses when the other writer's claim declares no paths — disjoint cannot be proven", () => {
    const v = scopeOverlapVerdict({ mine: ["scripts"], others: [{ number: 13, lane: "Codex", scope: [] }], files: TRACKED });
    expect(v.ok).toBe(false);
    expect(v.unknown).toEqual([{ number: 13, lane: "Codex", why: "its claim declares no paths" }]);
    expect(overlapRemediation(v)).toContain("#13");
  });

  it("refuses two globs it has no tracked-path list to decide, and still decides literals without one", () => {
    const globs = scopeOverlapVerdict({ mine: ["scripts/*.mjs"], others: [{ number: 13, scope: ["scripts/work-*"] }], files: null });
    expect(globs.ok).toBe(false);
    expect(globs.unknown[0].why).toContain("no tracked-path list");
    expect(scopeOverlapVerdict({ mine: ["scripts"], others: [{ number: 13, scope: ["scripts/x.mjs"] }], files: null }).ok).toBe(false);
    expect(scopeOverlapVerdict({ mine: ["scripts"], others: [{ number: 13, scope: ["docs"] }], files: null }).ok).toBe(true);
  });
});

describe("where a scope is read from", () => {
  it("parses the claim's own sentence through the shared parser, disclaimers included", () => {
    expect(scopeFromText("`scripts/`, `tools/entry/`. No other `src/` or `src-tauri/` writes.")).toEqual(["scripts", "tools/entry"]);
    expect(scopeFromText("")).toEqual([]);
    expect(scopeFromText(null)).toEqual([]);
  });

  it("finds the Write scope bullet in an issue body, continuation lines included, and nothing else", () => {
    const body = ["## Task", "", "- Lane: Claude Code", "- **Write scope:** `scripts/foo.mjs`,", "  `scripts/foo.test.mjs`. Nothing else.", "- Next action: start", "", "`docs/BACKLOG.md` is mentioned here and is not a scope."].join("\n");
    expect(scopeTextFromBody(body)).toBe("`scripts/foo.mjs`, `scripts/foo.test.mjs`. Nothing else.");
    expect(scopeFromText(scopeTextFromBody(body))).toEqual(["scripts/foo.mjs", "scripts/foo.test.mjs"]);
    expect(scopeTextFromBody("no bullet here")).toBeNull();
    expect(scopeTextFromBody("- Write scope:\n- Next: x")).toBeNull();
  });
});

describe("the wiring — the decision is called, ranked, and fed", () => {
  const FOLDER = "C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\x";
  const world = (scope) => ({
    board: { reachable: true },
    self: { lane: "Claude Code" },
    task: { number: 18, status: "Active", lane: "Claude Code", gate: "None", worktreeBranch: `${FOLDER} @ lane/x`, nextAction: "go" },
    items: [{ number: 18, status: "Active", lane: "Claude Code", worktreeBranch: `${FOLDER} @ lane/x` }],
    claim: { issue: 18, lane: "Claude Code", folder: FOLDER, branch: "lane/x", expires: "2099-01-01" },
    checkouts: [{ path: FOLDER, branch: "lane/x", kind: "linked", commonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git" }],
    gitState: { ok: true, branch: "lane/x", clean: true, files: { modified: [], untracked: [], staged: [], unmerged: [] } },
    ...(scope === undefined ? {} : { scope }),
  });
  const row = (facts) => reconcile(facts).checks.find((c) => c.name === "scope.overlap");

  it("is a ranked preflight row that refuses on overlap and names the other writer", () => {
    expect(REMEDIATION_ORDER.indexOf("scope.overlap")).toBe(REMEDIATION_ORDER.indexOf("folder.writer") + 1);
    const r = row(world({ mine: ["scripts"], others: [{ number: 13, lane: "Codex", scope: ["scripts/x.mjs"] }], files: TRACKED }));
    expect(r.ok).toBe(false);
    expect(r.actual).toContain("#13 (Codex)");
    expect(r.remediation).toContain("serialize");
    expect(row(world({ mine: ["docs"], others: [{ number: 13, scope: ["scripts"] }], files: TRACKED })).ok).toBe(true);
  });

  it("fails closed when the scope facts were never gathered", () => {
    const r = row(world(undefined));
    expect(r.ok).toBe(false);
    expect(r.actual).toContain("not gathered");
  });

  it("gather feeds it, launch stops posting the title as the scope, and the shell forwards --scope", () => {
    const gather = read("tools/entry/gather.mjs");
    expect(gather).toMatch(/scope:\s*gatherScopeFacts\(/);
    expect(gather).toContain("ls-tree");
    const launch = read("tools/entry/launch.mjs");
    expect(launch).not.toMatch(/scope:\s*task\.title/);
    expect(launch).toContain('arg("--scope")');
    expect(launch).toContain("scopeText");
    expect(read("tools/entry/cli.mjs")).toContain('"--scope"');
    expect(read("compy-entry.ps1")).toContain("--scope");
  });
});
