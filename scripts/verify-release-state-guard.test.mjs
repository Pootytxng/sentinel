import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  embeddedStampTokens,
  extractCitations,
  validateOwnerDecisionVersions,
  verifyRepo,
} from "./verify-release-state.mjs";

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
    expect(embeddedStampTokens("\0no hex runs here at all\0")).toEqual([]);
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

// The live check. Everything above proves the detector works; this is the one that fails when the
// doc and the tree part company, on the next test run rather than at the next release gate.
describe("RELEASE_STATE.md as it stands, against the tree it cites", () => {
  it("has no broken citation, no missing section and no state drift", () => {
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
