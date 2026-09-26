import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESK_FLEET_RELATIONS,
  bottomLineParagraph,
  falseEquivalenceClaims,
  LINEAGE_ROW_CAPS,
  embeddedStampTokens,
  extractCitations,
  ownerDecisionsSection,
  validateOwnerDecisionVersions,
  validateStageCandidate,
  verifyRepo,
} from "./verify-release-state.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";

// TWO kinds of test live here, and neither substitutes for the other. Delete either and the guard
// stops guarding:
//
//   * everything down to the last describe tests the DETECTOR against synthetic input and against
//     miniature repos on disk. A guard that only asserts "the current doc passes" goes green the
//     moment someone edits the doc to match a broken tree.
//   * the last describe runs the detector against THIS tree. Until 2026-08-04 nothing did: every
//     check lived inside `if (IS_MAIN)`, reachable only through verify-release.ps1 — the full
//     release gate, which nobody runs between releases. Its sibling verify-module-map.mjs had the
//     same shape and sat red on `main` for two days. RELEASE_STATE.md's citations rot on every
//     commit that shifts a line, so this one rots faster. A gate nobody runs is a gate that rots.

describe("release-state owner-decision version guard", () => {
  it("accepts historical checkpoint versions when the live decision names the candidate", () => {
    const section = `## Required owner decisions (live)

1. **Publish GO/NO-GO for the next prepared release (v0.9.11)** — v0.9.9 and v0.9.10 are
   preserved historical checkpoints and must not be rewritten.
2. **Single-tester canary** — after publication.
`;

    expect(validateOwnerDecisionVersions(section, "0.9.10", "0.9.11")).toEqual([]);
  });

  it("rejects a live publish decision that does not name the candidate version", () => {
    const section = `## Required owner decisions (live)

1. **Publish GO/NO-GO for v0.9.10** — stale pending release.
`;

    expect(validateOwnerDecisionVersions(section, "0.9.10", "0.9.11")).toEqual([
      "STALE-DECISION: first live owner decision must name candidate v0.9.11",
    ]);
  });
});

// bug->guard (2026-08-19): the v0.9.26 stage failed TWICE on the same knowable state - release.ps1
// bumps STATE:latest_release_version as part of the cut but never touches STATE:candidate_version or
// the owner decision, so the release-state gate only noticed at the END of a ~13-minute
// verify + build. `--stage-candidate` moves that verdict to the front of the run; these tests hold
// the detector to the version the run is ABOUT to cut, not the one the tree currently declares.
describe("stage candidate preflight", () => {
  const doc = (candidate, decisionVersion) => `<!-- STATE:candidate_version=${candidate} -->

## Required owner decisions (live)

1. **Candidate v${decisionVersion} publish GO/NO-GO - GO GIVEN.** body
`;

  it("passes when the anchor and the live decision both name the version being cut", () => {
    expect(validateStageCandidate(doc("0.9.27", "0.9.27"), "0.9.27")).toEqual([]);
  });

  it("names the anchor edit when the doc still carries the previous candidate", () => {
    const failures = validateStageCandidate(doc("0.9.26", "0.9.26"), "0.9.27");
    expect(failures[0]).toContain("STATE:candidate_version is 0.9.26");
    expect(failures[0]).toContain("<!-- STATE:candidate_version=0.9.27 -->");
    expect(failures).toContain("STALE-DECISION: first live owner decision must name candidate v0.9.27");
  });

  it("still fails when only the decision is stale, so a hand-edited anchor cannot alone satisfy it", () => {
    expect(validateStageCandidate(doc("0.9.27", "0.9.26"), "0.9.27")).toEqual([
      "STALE-DECISION: first live owner decision must name candidate v0.9.27",
    ]);
  });

  it("treats a missing anchor as a failure rather than a pass", () => {
    const failures = validateStageCandidate(`## Required owner decisions (live)

1. **v0.9.27**
`, "0.9.27");
    expect(failures[0]).toContain("STATE:candidate_version is missing");
  });
});

// #123: the extraction lookahead used \Z, which JavaScript parses as a literal letter Z. Any capital
// Z in the section body - hit for real by an ISO publish timestamp during the v0.9.18 doc-sync -
// truncated the section BEFORE the numbered list, and a truthful decision then read as STALE.
describe("owner-decisions section extraction (#123)", () => {
  it("REGRESSION: an ISO timestamp's Z inside the section no longer truncates it", () => {
    const doc = `## Required owner decisions (live)

Publish closed 2026-08-13T06:57:36Z - receipt in the release transaction.

1. **Publish GO/NO-GO for the next prepared release (v0.9.19)** - pending.

## Gate matrix

| gate | state |
`;
    const section = ownerDecisionsSection(doc);
    expect(section).toContain("v0.9.19");
    expect(section).not.toContain("Gate matrix");
    expect(validateOwnerDecisionVersions(section, "0.9.18", "0.9.19")).toEqual([]);
  });

  it("still stops at the next heading, still reaches true end-of-input, still misses cleanly", () => {
    const lastSection = "## Required owner decisions\n\n1. the doc ends here (v0.9.19)";
    expect(ownerDecisionsSection(lastSection)).toContain("ends here");
    expect(ownerDecisionsSection("no such section anywhere")).toBe("");
  });
});

// The owner_installed_stamp check reads the stamp out of the installed binary instead of merely
// asking "is the claimed value in there?", because a discovered value can NAME the correct commit
// and reduce the fix to one edit. That only holds if extraction is exact — hence these pins.
// The stamp is NUL-delimited inside the exe; these write that as `\0` rather than a raw zero byte,
// because raw NULs made this file binary to git (no readable diff) and invisible to ripgrep.
describe("embedded build-stamp token extraction", () => {
  it("finds a delimited 7-hex run, which is the shape build.rs bakes in", () => {
    expect(embeddedStampTokens("COMPY_GIT_HASH\0c7c60d3\0release")).toEqual(["c7c60d3"]);
  });

  it("REGRESSION: an 8-hex stamp is a stamp — `--short` widens as the repo grows", () => {
    // This file used to assert `embeddedStampTokens("abcdefab") === []`, pinning the width at exactly
    // 7. Git widened this repo's abbreviation to 8 on 2026-08-06 and the scan went blind: 24 tokens
    // found, none resolved, permanent STATE-SKIP — a check that keeps printing a line while checking
    // nothing. Width is a property of the repo's object count, never of the stamp's meaning.
    expect(embeddedStampTokens("COMPY_GIT_HASH\0ff0ce65f\0release")).toEqual(["ff0ce65f"]);
    expect(embeddedStampTokens("|4ca909f8|")).toEqual(["4ca909f8"]);
  });

  it("never carves a candidate out of the middle of a longer hex run", () => {
    // A 40-char full OID, a SHA-256 digest, or any hex blob merely BEGINS with hex — it is a
    // different string, and slicing a stamp out of its middle would invent one that was never
    // embedded. The upper bound (12) is what keeps that true now that the width is a range.
    expect(embeddedStampTokens("a1be896fb5853f729d77525374a4242c6672d5a8")).toEqual([]);
    expect(embeddedStampTokens("0123456789abcdef")).toEqual([]);
    expect(embeddedStampTokens("7861729562bc302112ef84e4a16345aa22d51c7b")).toEqual([]);
    expect(embeddedStampTokens("abcdef")).toEqual([]);
  });

  it("de-duplicates, since a stamp is embedded once per use site, not once per binary", () => {
    expect(embeddedStampTokens("|c7c60d3| ... |c7c60d3|")).toEqual(["c7c60d3"]);
  });

  it("ignores uppercase hex — git short hashes are lowercase, so upper-case runs are other data", () => {
    expect(embeddedStampTokens(" C7C60D3 ")).toEqual([]);
  });

  it("returns every distinct candidate so the caller can refuse an ambiguous scan", () => {
    // Deliberately NOT a match-the-anchor test: the caller SKIPs unless exactly one candidate
    // resolves to a commit, so extraction must hand it all of them rather than pick a winner.
    expect(embeddedStampTokens("x c7c60d3 y a1be896 z").sort()).toEqual(["a1be896", "c7c60d3"]);
  });

  it("yields nothing rather than throwing on a binary with no stamp-shaped run", () => {
    expect(embeddedStampTokens("\0\u0001no hex runs here at all\0")).toEqual([]);
  });
});

// Symbol binding is what makes a citation checkable at all: `file:line` alone can only be range-
// checked, while a bound symbol can be located. Each shape below is one the doc actually uses.
describe("citation extraction", () => {
  const cite = (line) => extractCitations([line]);

  it("binds a backticked symbol sitting immediately left of the citation", () => {
    expect(cite("| gaming mode | `gaming_mode_gate()` — `lib.rs:520` |")).toEqual([
      { docLine: 1, file: "lib.rs", line: 520, sym: "gaming_mode_gate" },
    ]);
  });

  it("binds an arrow-form symbol and strips its module path", () => {
    expect(cite("`actions.rs:120` → `actions::apply_hags_enable`")[0].sym).toBe("apply_hags_enable");
  });

  it("inherits the symbol across a comma chain, and only across a comma", () => {
    const chained = cite("`f()` — `a.rs:1`, `b.rs:2`");
    expect(chained.map((c) => c.sym)).toEqual(["f", "f"]);
    // Prose between two citations breaks the chain: the second one is about something else.
    expect(cite("`f()` — `a.rs:1` and separately `b.rs:2`").map((c) => c.sym)).toEqual(["f", null]);
  });

  it("takes a bare citation with no symbol, which is range-checked rather than located", () => {
    expect(cite("see `docs/BACKLOG.md:77`")).toEqual([
      { docLine: 1, file: "docs/BACKLOG.md", line: 77, sym: null },
    ]);
  });

  it("ignores a backticked path with no line number — it is not a citation", () => {
    expect(cite("configured in `src-tauri/tauri.conf.json`")).toEqual([]);
  });
});

// A miniature repo on disk, because verifyRepo()'s job is resolving cited paths and reading the
// lines they point at — the part no synthetic string can exercise.
function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "release-state-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

const withFixture = (files, assert) => {
  const root = fixtureRepo(files);
  try {
    assert(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const doc = (body) => ["# RELEASE_STATE", "", "## CURRENT STATE", "", "## Gate matrix", "", body, "", "## Release blockers", ""].join("\n");

describe("verifyRepo against a repo on disk (resolution and anchoring, not the string parsing)", () => {
  it("anchors a citation whose symbol is still where the doc says it is", () => {
    withFixture(
      {
        "docs/RELEASE_STATE.md": doc("| gaming mode | `gaming_mode_gate()` — `lib.rs:3` |"),
        "src-tauri/src/lib.rs": "// one\n// two\nfn gaming_mode_gate() {}\n",
      },
      (root) => {
        const { results, bad } = verifyRepo(root);
        expect(bad).toEqual([]);
        expect(results.map((r) => r.verdict)).toEqual(["OK"]);
        // Proof it resolved the bare basename to its real home rather than passing vacuously.
        expect(results[0].rel).toBe("src-tauri/src/lib.rs");
      },
    );
  });

  it("catches the c056fee class: the code moved, the citation did not", () => {
    withFixture(
      {
        "docs/RELEASE_STATE.md": doc("| gaming mode | `gaming_mode_gate()` — `lib.rs:3` |"),
        "src-tauri/src/lib.rs": `${"// filler\n".repeat(200)}fn gaming_mode_gate() {}\n`,
      },
      (root) => {
        const { bad } = verifyRepo(root);
        expect(bad).toHaveLength(1);
        expect(bad[0].verdict).toBe("DRIFT");
        expect(bad[0].detail).toContain("src-tauri/src/lib.rs:201");
      },
    );
  });

  it("catches a symbol that was deleted outright, and a line past end of file", () => {
    withFixture(
      {
        "docs/RELEASE_STATE.md": doc("`gone_fn()` — `lib.rs:1`\n\n`oob.rs:900`"),
        "src-tauri/src/lib.rs": "fn something_else() {}\n",
        "src-tauri/src/oob.rs": "fn tiny() {}\n",
      },
      (root) => {
        expect(verifyRepo(root).bad.map((r) => r.verdict).sort()).toEqual(["GONE", "LINE-OOB"]);
      },
    );
  });

  // The f21c170 class: a doc diet cut the live Gate matrix and Release blockers, and the verifier
  // passed vacuously on the gutted file. An empty contract is a failure, not a pass.
  it("reports a gutted doc as missing sections with zero citations, never as a pass", () => {
    withFixture({ "docs/RELEASE_STATE.md": "# RELEASE_STATE\n\nnothing left here.\n" }, (root) => {
      const { citations, missingSections } = verifyRepo(root);
      expect(citations).toEqual([]);
      expect(missingSections).toEqual(["CURRENT STATE", "Gate matrix", "Release blockers"]);
    });
  });

  it("names DOC-MISSING rather than throwing when the contract file is absent entirely", () => {
    withFixture({ "README.md": "no state doc here\n" }, (root) => {
      const { stateFail, missingSections } = verifyRepo(root);
      expect(stateFail).toHaveLength(1);
      expect(stateFail[0]).toContain("DOC-MISSING");
      expect(missingSections).toHaveLength(3);
    });
  });

  it("leaves the two host-dependent checks disarmed unless machine mode is asked for", () => {
    // (6) source_main_commit and (7) owner_installed_stamp answer questions about the mainline and
    // about a binary on one desk. Wiring either into `npm test` would go red for reasons no commit
    // in the tree caused — so their anchors are still required, but their VALUES are CLI-only.
    withFixture(
      {
        "docs/RELEASE_STATE.md": doc("<!-- STATE:source_main_commit=deadbee -->\n<!-- STATE:owner_installed_stamp=deadbee -->"),
      },
      (root) => {
        const { stateFail, notes } = verifyRepo(root);
        // deadbee resolves to no commit anywhere; unarmed, that is a note, not a failure.
        expect(stateFail.some((f) => f.startsWith("SOURCE-COMMIT"))).toBe(false);
        expect(notes.filter((n) => n.includes("repo-only run"))).toHaveLength(2);
      },
    );
  });
});

// The lineage cap (check 5b). The two build-identity rows are append-only: every ship prepends the
// new build and pushes the old one down inside the same table cell. On 2026-08-22 those two cells
// were 8.9 KB - 18% of the whole file - and RELEASE_STATE.md blew its byte budget four days after a
// 57 KB -> 48 KB diet, because archiving the oldest link BY HAND each ship is a judgement call made
// under time pressure mid-ship, and it converges on nothing. This is the mechanical replacement, so
// it needs a test that it can still FAIL: a cap that never fires is decoration.
describe("append-only build-identity rows (check 5b)", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const docLines = () =>
    readFileSync(join(repo, "docs", "RELEASE_STATE.md"), "utf8")
      .split("\n")
      .map((l) => l.replace(/\r$/, ""));

  it("names both rows that grow on every ship, and nothing else", () => {
    expect(Object.keys(LINEAGE_ROW_CAPS).sort()).toEqual([
      "Latest PUBLISHED release + source commit",
      "Owner-installed version + embedded stamp",
    ]);
  });

  it("both rows are inside their cap now, with the headroom a cap is supposed to leave", () => {
    const doc = docLines();
    for (const [label, cap] of Object.entries(LINEAGE_ROW_CAPS)) {
      const row = doc.find((l) => l.startsWith(`| **${label}**`));
      expect(row, `no "${label}" row`).toBeTruthy();
      const bytes = Buffer.byteLength(row, "utf8");
      expect(bytes, `"${label}" is ${bytes} bytes, cap ${cap}`).toBeLessThanOrEqual(cap);
      // Anti-slack, mirroring doc-budget-guard: a cap far above the real size has stopped capping,
      // and this one is derived from the real size on purpose, not padded to buy room in advance.
      expect(cap - bytes, `"${label}" cap has ${cap - bytes} bytes of slack - lower it`).toBeLessThan(2048);
    }
  });

  it("FIRES: a row carrying one predecessor too many is reported, with the cure in the message", () => {
    const dir = mkdtempSync(join(tmpdir(), "lineage-cap-"));
    try {
      mkdirSync(join(dir, "docs"), { recursive: true });
      const label = "Owner-installed version + embedded stamp";
      const bloated = docLines()
        .map((l) => (l.startsWith(`| **${label}**`) ? l + " It supersedes ".padEnd(4000, "x") : l))
        .join("\n");
      writeFileSync(join(dir, "docs", "RELEASE_STATE.md"), bloated);
      const { stateFail } = verifyRepo(dir);
      const hit = stateFail.find((f) => f.startsWith("LINEAGE-BLOAT:"));
      expect(hit, `no LINEAGE-BLOAT in: ${stateFail.join(" | ")}`).toBeTruthy();
      expect(hit).toContain(label);
      // A failure that does not say what to do next gets muted rather than fixed.
      expect(hit).toContain("RELEASE_STATE_HISTORY.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The live check. Everything above proves the detector works; this is the one that fails when the
// doc and the tree part company, on the next test run rather than at the next release gate.
describe("RELEASE_STATE.md as it stands, against the tree it cites", () => {
  // Explicit timeout, and NOT to paper over a flake. This test opens every file RELEASE_STATE
  // cites and reads to the cited line, so its cost scales with the doc; standing alone it takes
  // ~10s of vitest.config.ts's GLOBAL 15000ms default, which was never a budget chosen for this
  // test. That margin survives `npm test` and does not survive .githooks/pre-push, where ~23 node
  // processes compete: it timed out at 15000ms on three consecutive gate runs on 2026-09-01 while
  // passing 51/51 standing alone each time, and a gate that fails on load rather than on truth
  // teaches everyone to re-run until green, which is how a real failure gets waved through.
  // 120s (GIT_SPAWN_TIMEOUT_MS, #563) is the contention headroom, not permission to get slower —
  // if this ever needs more, the fix is to make the check cheaper, not to raise this number again.
  it("has no broken citation, no missing section and no state drift", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const { bad, missingSections, stateFail, citations } = verifyRepo(repo);
    expect(bad.map((r) => `${r.verdict} ${r.file}:${r.line} ${r.detail}`)).toEqual([]);
    expect(missingSections).toEqual([]);
    expect(stateFail).toEqual([]);
    // Anti-vacuity: a doc that cites nothing would satisfy every assertion above. NEAR drift stays
    // a warning here as it does at the CLI — `--strict` is a release-gate concern, and failing
    // `npm test` on a few lines of tolerated drift would get this muted rather than fixed.
    expect(citations.length).toBeGreaterThan(10);
  });
});

// ── check (8): the desk/fleet relation ───────────────────────────────────────────────────────────
// The defect these exist for is on the record: between 2026-08-19 and 2026-08-23 the live document
// carried published_release_commit=5e64074c and owner_installed_stamp=d5a6a630 twelve lines apart
// while asserting "the owner's desk runs those same bytes -- the deliberate desk/fleet divergence of
// 2026-08-18 is closed". It passed every gate for four days and a human fixed the words by hand.
//
// The first block is the prose detector on its own. The second builds REAL git repositories, because
// the relation is derived from ancestry and a stubbed comparator would prove only the stub -- the
// no-raw-select-guard lesson, where a mutation test passed on a string the real sweep never produces.

describe("false-equivalence prose detector", () => {
  it("fires on the exact sentence that shipped and survived four days", () => {
    const shipped =
      "**v0.9.26 (`5e64074c`)**, published 2026-08-19T09:14Z under owner GO, and the\n" +
      "owner's desk runs those same bytes — **the deliberate desk/fleet divergence of 2026-08-18 is closed.**";
    expect(falseEquivalenceClaims(shipped).length).toBeGreaterThan(0);
  });

  it("fires on the softer form that reads as a status rather than a claim", () => {
    expect(falseEquivalenceClaims("It closes the three-lane desk/fleet gap: the fleet now gets the resolver.")).toHaveLength(1);
    expect(falseEquivalenceClaims("The desk/fleet divergence is closed.")).toHaveLength(1);
    expect(falseEquivalenceClaims("Desk and fleet are byte-identical.")).toHaveLength(1);
  });

  // If the detector cannot tell a ban from its own rationale it gets muted, not fixed.
  it("stays silent on the corrective wording the document actually needs to carry", () => {
    const corrected =
      "**The owner's desk does NOT run those bytes.** It runs a newer, unreleased v0.9.26 desk build.\n" +
      "Same version number, different commit — never read byte equivalence out of a matching version string.\n" +
      "The desk/fleet divergence is NOT closed; it is deliberate, and the relation anchor records it.";
    expect(falseEquivalenceClaims(corrected)).toEqual([]);
  });

  it("lets one negated sentence excuse only itself, never the paragraph around it", () => {
    const mixed = "The desk does not run those bytes. The desk/fleet divergence is closed.";
    expect(falseEquivalenceClaims(mixed)).toHaveLength(1);
  });
});

// A REAL repository, because ancestry is the thing under test. `orphan: true` gives the second
// commit no common ancestor with the first, which is the only way to reach `divergent-history`.
const gitFixture = ({ orphan = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "release-state-git-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git("init", "-q");
  git("config", "user.email", "guard@example.invalid");
  git("config", "user.name", "guard");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  const first = git("rev-parse", "--short", "HEAD");
  if (orphan) git("checkout", "-q", "--orphan", "other-history");
  writeFileSync(join(root, "second.txt"), "second\n");
  git("add", "-A");
  git("commit", "-q", "-m", "second");
  const second = git("rev-parse", "--short", "HEAD");
  return { root, first, second, git };
};

const identityDoc = ({ published, installed, relation, prose = "" }) =>
  [
    "# RELEASE_STATE", "", "## CURRENT STATE", "",
    `<!-- STATE:published_release_commit=${published} -->`,
    `<!-- STATE:owner_installed_stamp=${installed} -->`,
    ...(relation ? [`<!-- STATE:desk_fleet_relation=${relation} -->`] : []),
    "", prose, "",
    "## Gate matrix", "", "| gate | `f()` — `seed.txt:1` |", "",
    "## Release blockers", "",
  ].join("\n");

/** Run verifyRepo over a real git repo whose RELEASE_STATE names real commits, then clean up. */
const withGitFixture = ({ orphan = false, ...docOpts }, assert) => {
  const fx = gitFixture({ orphan });
  try {
    const doc = join(fx.root, "docs", "RELEASE_STATE.md");
    mkdirSync(dirname(doc), { recursive: true });
    writeFileSync(
      doc,
      identityDoc({
        published: docOpts.published(fx),
        installed: docOpts.installed(fx),
        relation: docOpts.relation,
        prose: docOpts.prose,
      }),
    );
    assert(verifyRepo(fx.root), fx);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
};

const failures = (r) => r.stateFail.join("\n");

describe("check (8) against real repositories: the relation is derived, not believed", () => {
  it("accepts a truthfully declared desk-ahead", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      { published: (f) => f.first, installed: (f) => f.second, relation: "desk-ahead" },
      (r) => {
        expect(failures(r)).not.toContain("RELATION-DRIFT");
        expect(failures(r)).not.toContain("DIVERGENT-HISTORY");
        expect(failures(r)).not.toContain("FALSE-EQUIVALENCE");
      },
    );
  });

  // THE defect class: two unequal identities plus a claim that they are the same build.
  it("rejects a same-commit anchor while the two identities are different commits", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      { published: (f) => f.first, installed: (f) => f.second, relation: "same-commit" },
      (r) => {
        expect(failures(r)).toContain("RELATION-DRIFT");
        expect(failures(r)).toContain("says same-commit");
        expect(failures(r)).toContain("git ancestry says desk-ahead");
      },
    );
  });

  it("names desk-behind when the desk is the older of the two", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      { published: (f) => f.second, installed: (f) => f.first, relation: "desk-ahead" },
      (r) => expect(failures(r)).toContain("git ancestry says desk-behind"),
    );
  });

  it("fails closed when neither identity is an ancestor of the other", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      { orphan: true, published: (f) => f.first, installed: (f) => f.second, relation: "desk-ahead" },
      (r) => expect(failures(r)).toContain("DIVERGENT-HISTORY"),
    );
  });

  it("rejects same-bytes prose whenever the declared relation is not same-commit", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      {
        published: (f) => f.first,
        installed: (f) => f.second,
        relation: "desk-ahead",
        prose: "The owner's desk runs those same bytes and the desk/fleet divergence is closed.",
      },
      (r) => expect(failures(r)).toContain("FALSE-EQUIVALENCE"),
    );
  });

  it("treats a missing relation anchor as a failure rather than a pass", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      { published: (f) => f.first, installed: (f) => f.second, relation: null },
      (r) => expect(failures(r)).toContain("STATE:desk_fleet_relation anchor missing"),
    );
  });

  it("rejects a relation value that is not one of the four", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withGitFixture(
      { published: (f) => f.first, installed: (f) => f.second, relation: "fine" },
      (r) => {
        expect(failures(r)).toContain("RELATION-UNKNOWN");
        for (const v of DESK_FLEET_RELATIONS) expect(failures(r)).toContain(v);
      },
    );
  });

  // The whole point of deriving from ancestry: an installer hash is not evidence either way. NSIS
  // packaging is not byte-preserving and Rust release links are not reproducible, so a correct
  // install of the same commit hashes differently — that spuriously failed a good 0.9.7 install on
  // 2026-07-23. If check (8) ever reads a hash anchor, this goes red.
  it("never consults an installer hash to decide the relation", () => {
    const src = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url))), "verify-release-state.mjs"), "utf8");
    const check8 = src.slice(src.indexOf("// (8) DESK/FLEET RELATION"));
    expect(check8).not.toContain("installer_sha256");
    expect(check8).not.toContain("published_manifest_sha256");
  });
});

// A repo shaped like the real one: a published commit on `main`, a lane branched off it carrying two
// desk builds, and a preserved candidate that never landed and is not reachable from the lane. Those
// four commits are exactly the four cases check (9b) has to tell apart, and no fixture with a single
// line of history can pose the question at all.
const laneFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "release-state-lane-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git("init", "-q");
  git("config", "user.email", "guard@example.invalid");
  git("config", "user.name", "guard");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "published");
  git("checkout", "-q", "-B", "main"); // -B, not -b: init.defaultBranch may already be `main`
  const published = git("rev-parse", "--short", "HEAD");
  git("checkout", "-q", "-b", "preserved");
  writeFileSync(join(root, "candidate.txt"), "candidate\n");
  git("add", "-A");
  git("commit", "-q", "-m", "failed candidate, preserved");
  const preserved = git("rev-parse", "--short", "HEAD");
  git("checkout", "-q", "main");
  git("checkout", "-q", "-b", "lane");
  writeFileSync(join(root, "slice.txt"), "slice\n");
  git("add", "-A");
  git("commit", "-q", "-m", "lane slice one");
  const older = git("rev-parse", "--short", "HEAD");
  writeFileSync(join(root, "slice2.txt"), "slice two\n");
  git("add", "-A");
  git("commit", "-q", "-m", "lane slice two");
  const desk = git("rev-parse", "--short", "HEAD");
  return { root, published, preserved, older, desk };
};

const laneDoc = ({ published, installed, bottom, after = "" }) =>
  [
    "# RELEASE_STATE", "", "## CURRENT STATE", "",
    `<!-- STATE:published_release_commit=${published} -->`,
    `<!-- STATE:owner_installed_stamp=${installed} -->`,
    "<!-- STATE:desk_fleet_relation=desk-ahead -->",
    "", bottom, "", after, "",
    "## Gate matrix", "", "| gate | `f()` — `seed.txt:1` |", "",
    "## Release blockers", "",
  ].join("\n");

/** Run verifyRepo over the lane fixture with a chosen Bottom line, then clean up. */
const withLane = (build, assert) => {
  const fx = laneFixture();
  try {
    const doc = join(fx.root, "docs", "RELEASE_STATE.md");
    mkdirSync(dirname(doc), { recursive: true });
    writeFileSync(doc, laneDoc({ published: fx.published, ...build(fx) }));
    const r = verifyRepo(fx.root);
    assert({
      unstamped: r.stateFail.filter((f) => f.startsWith("BOTTOM-LINE-DESK-UNSTAMPED")),
      stale: r.stateFail.filter((f) => f.startsWith("STALE-DESK-STAMP")),
      notes: r.notes,
    }, fx);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
};

describe("check (9): the Bottom line is read, not merely counted", () => {
  it("takes the paragraph to the first blank line, and nothing below it", () => {
    const p = bottomLineParagraph(["intro", "", "**Bottom line:** it runs `aaaaaaa`.", "second line.", "", "| a row | `bbbbbbb` |"].join("\n"));
    expect(p).toBe("**Bottom line:** it runs `aaaaaaa`.\nsecond line.");
  });

  it("returns null when the document has no Bottom line at all — that is check (5)'s business", () => {
    expect(bottomLineParagraph("# RELEASE_STATE\n\nnothing here\n")).toBeNull();
  });

  // (9a) — the half that needs no git at all.
  it("FIRES: the paragraph describes the desk build and never names the anchor", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({ installed: fx.desk, bottom: "**Bottom line:** the owner's desk runs a newer, unreleased desk build." }),
      ({ unstamped }) => {
        expect(unstamped).toHaveLength(1);
        expect(unstamped[0]).toContain("BOTTOM-LINE-DESK-UNSTAMPED");
      },
    );
  });

  it("stays silent when the paragraph names the anchor verbatim", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({ installed: fx.desk, bottom: `**Bottom line:** the owner's desk runs an unreleased build stamped \`${fx.desk}\`.` }),
      ({ unstamped, stale }) => {
        expect(unstamped).toHaveLength(0);
        expect(stale).toHaveLength(0);
      },
    );
  });

  it("stays silent when the paragraph never mentions the desk — there is no claim to go stale", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({ installed: fx.desk, bottom: "**Bottom line:** the newest published release is the one the fleet has." }),
      ({ unstamped }) => expect(unstamped).toHaveLength(0),
    );
  });

  // (9b) — THE defect of 2026-08-23, in the shape it actually shipped: the anchor moved on, the
  // sentence a reader trusts stayed on the previous lane build, and every other check passed.
  it("FIRES: a superseded lane build is named beside the current one", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({
        installed: fx.desk,
        bottom: `**Bottom line:** the owner's desk runs \`${fx.desk}\`, which replaced \`${fx.older}\`.`,
      }),
      ({ stale }, fx) => {
        expect(stale).toHaveLength(1);
        expect(stale[0]).toContain(fx.older);
        expect(stale[0]).toContain(fx.desk);
      },
    );
  });

  it("LOOKALIKE: a published hash that IS on the mainline is a release, not a stale stamp", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({
        installed: fx.desk,
        bottom: `**Bottom line:** the fleet runs \`${fx.published}\`; the owner's desk runs \`${fx.desk}\`.`,
      }),
      ({ stale, unstamped }) => {
        expect(stale).toHaveLength(0);
        expect(unstamped).toHaveLength(0);
      },
    );
  });

  // The real document cites `2bd649d`, a failed candidate preserved on its own branch. It is
  // off-mainline like every stale desk stamp, and reachability from HEAD is the only thing that
  // separates the two. Drop that condition and this goes red on correct provenance.
  it("LOOKALIKE: an off-mainline commit unreachable from HEAD is preserved provenance", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({
        installed: fx.desk,
        bottom: `**Bottom line:** the owner's desk runs \`${fx.desk}\`; the failed candidate \`${fx.preserved}\` is preserved.`,
      }),
      ({ stale }) => expect(stale).toHaveLength(0),
    );
  });

  // Scope. The owner-installed ROW is required to carry the build lineage, so every lane predecessor
  // in it would trip (9b) if the check read the whole document instead of the one paragraph.
  it("LOOKALIKE: lane predecessors listed BELOW the paragraph are lineage, and out of scope", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    withLane(
      (fx) => ({
        installed: fx.desk,
        bottom: `**Bottom line:** the owner's desk runs \`${fx.desk}\`.`,
        after: `| **Owner-installed version + embedded stamp** | \`${fx.desk}\`, whose predecessor was \`${fx.older}\`. | proof |`,
      }),
      ({ stale }) => expect(stale).toHaveLength(0),
    );
  });
});
