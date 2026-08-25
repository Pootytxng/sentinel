// Durable-release-receipt guard — issue #199 item 4.
//
// #199's disposition, in its own words: "Once that mechanism exists, add a separate guard requiring
// the current published release to reference an existing durable receipt." The mechanism is
// `scripts/emit-release-receipt.mjs` (item 3). This is the guard.
//
// WHAT WENT WRONG, AND WHY A GUARD RATHER THAN A FIX. `docs/RELEASE_STATE.md` offered a release
// transaction journal — `src-tauri/target/release/bundle/nsis/release-transaction-v0.9.11.json` —
// as the re-verify command for a "transaction complete, 9 of 9" claim. `src-tauri/.gitignore:3`
// ignores `/target/`, so that file was never committed, and `target/` has since been cleaned. The
// citation checker never noticed because it only resolves BACKTICKED `path:line` citations, and a
// bare `path.json` sitting in a re-verify column is not one.
//
// This does NOT mean any recorded outcome is false. GitHub independently proves publication,
// assets, asset hashes, manifest hash and release identity for every published release, and those
// proofs stand. What died is the ability to re-verify the nine INTERNAL pipeline stages, which
// GitHub cannot know about. #199 is explicit that the historical record must not be regenerated:
// "Do not fabricate or regenerate historical journals."
//
// So the rule this guard enforces is a fork, not a demand:
//
//   Every "9 of 9" claim in RELEASE_STATE.md must EITHER be backed by a durable receipt for every
//   version it names, OR say plainly in the same breath that it is not re-verifiable and cite #199.
//
// Today zero durable receipts exist — none can, for any past release — so every such claim takes
// the caveat branch. The first release cut after `emit-release-receipt.mjs` landed takes the
// evidence branch, and this guard is what makes that transition mechanical instead of remembered.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDurableReceipt, scrubViolations, EXPECTED_STAGES } from "./emit-release-receipt.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_STATE = join(repoRoot, "docs", "RELEASE_STATE.md");
const RECEIPTS_DIR = join(repoRoot, "docs", "release-receipts");

const read = (p) => readFileSync(p, "utf8");

/** The version the document declares CURRENT, from its own machine-readable anchor. */
export function publishedVersion(markdown) {
  const m = markdown.match(/<!--\s*STATE:published_release_version=([^\s-]+)\s*-->/);
  return m ? m[1] : null;
}

/**
 * A claim's CONTEXT — the span a caveat has to live in to count as that claim's caveat.
 *
 * A table row is its own context. That is the load-bearing choice here: the v0.9.11 row already
 * carries the caveat, and the v0.9.26 row two lines below it does not. Any looser scoping (the
 * whole table, the whole section) would read one row's honesty as covering the other's silence,
 * which is precisely the drift that left four claims uncaveated after the reconciliation lane.
 *
 * Prose gets its paragraph, because a sentence and its qualifier legitimately sit on separate
 * lines there.
 */
export function claimContext(lines, index) {
  if (lines[index].trimStart().startsWith("|")) return lines[index];
  let a = index;
  let b = index;
  while (a > 0 && lines[a - 1].trim() !== "") a--;
  while (b < lines.length - 1 && lines[b + 1].trim() !== "") b++;
  return lines.slice(a, b + 1).join("\n");
}

/**
 * Every stage-completion claim in the document, with the context a caveat would have to be in.
 *
 * "9 of 9" and "9/9" both appear; both read as a claim and the shorthand is the one that slips.
 * But nine-of-nine is ALSO the size of the self-review rubric, and the Q5 support-evidence row
 * says "9/9 rubric items" about a visual review that has nothing to do with a release transaction.
 * Demanding a #199 caveat there would be a false accusation printed in the gate matrix, so the
 * count is disqualified when the words right after it name a different scale.
 */
const COUNT = /\b9(?: of |\/)9\b/g;
const OTHER_SCALE = /^\s*(rubric|checklist|check|item)/i;

export function stageClaims(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    const isClaim = [...line.matchAll(COUNT)].some(
      (m) => !OTHER_SCALE.test(line.slice(m.index + m[0].length, m.index + m[0].length + 24)),
    );
    if (!isClaim) return;
    out.push({ line: i + 1, text: line.trim(), context: claimContext(lines, i) });
  });
  return out;
}

/**
 * Both halves are required: "#199" alone is a cross-reference, not an admission.
 *
 * `\s+` rather than a literal space because the phrase legitimately wraps across a line in prose —
 * writing the caveat correctly and having the guard call it missing is the worst failure mode a
 * guard like this can have, and it happened on the first run of this file.
 */
export const hasCaveat = (context) =>
  /not\s+re-verifiable/i.test(context) && /#199/.test(context);

/** Every version a claim's context names, so the guard knows what evidence would discharge it. */
export function versionsNamed(context) {
  return [...new Set([...context.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)].map((m) => m[1]))];
}

/**
 * The last release published before `scripts/emit-release-receipt.mjs` existed. Everything up to
 * and including it can never have a durable receipt and lives on the honest caveat instead; every
 * release AFTER it runs the emitter as part of the transaction, so a caveat there would just be the
 * old unverifiable claim wearing new words. This constant is what stops the caveat from becoming a
 * permanent escape hatch — #199 item 4 asks for evidence, not for a phrasing.
 */
const LAST_RELEASE_WITHOUT_AN_EMITTER = "0.9.26";

/** Numeric semver ordering: > 0 when `a` is newer than `b`. Patch releases are not string-sortable. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const durableReceipts = () => {
  if (!existsSync(RECEIPTS_DIR)) return new Map();
  const out = new Map();
  for (const name of readdirSync(RECEIPTS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const parsed = JSON.parse(read(join(RECEIPTS_DIR, name)));
    out.set(String(parsed.version), { file: name, receipt: parsed });
  }
  return out;
};

describe("#199 item 4 — the current published release references durable evidence", () => {
  it("names a published version in its own machine-readable anchor", () => {
    const version = publishedVersion(read(RELEASE_STATE));
    expect(version, "docs/RELEASE_STATE.md lost its STATE:published_release_version anchor").toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it("has either a durable receipt for the published release or an honest caveat on its claims", () => {
    const markdown = read(RELEASE_STATE);
    const version = publishedVersion(markdown);
    const receipts = durableReceipts();
    if (receipts.has(version)) return; // discharged by evidence; the shape checks below cover it

    // No receipt — which is the correct and permanent state for every release published before
    // emit-release-receipt.mjs existed. Then the claims about it must say so.
    const claims = stageClaims(markdown).filter((c) => versionsNamed(c.context).includes(version));
    expect(
      claims.length,
      `RELEASE_STATE.md makes no stage claim about the published version ${version} — this guard ` +
        "went vacuous, or the anchor and the matrix disagree",
    ).toBeGreaterThan(0);
    const bare = claims.filter((c) => !hasCaveat(c.context));
    expect(
      bare.map((c) => `line ${c.line}`),
      `No durable receipt exists for v${version} (docs/release-receipts/v${version}.json), so every ` +
        "stage claim about it must state it is NOT re-verifiable and cite #199. Emit a receipt on " +
        "the next release, or add the caveat.",
    ).toEqual([]);
  });

  it("lets no stage claim in the document stand on prose alone", () => {
    // Not just the current release. Every "9 of 9" in the file is the same kind of assertion and
    // the same kind of unverifiable, and #199 lists six of them by line.
    const markdown = read(RELEASE_STATE);
    const receipts = durableReceipts();
    const bare = stageClaims(markdown).filter((claim) => {
      const named = versionsNamed(claim.context);
      // Discharged only when EVERY version the claim covers has evidence. A block asserting 9-of-9
      // for two releases is not half-honest because one of them has a receipt.
      const covered = named.length > 0 && named.every((v) => receipts.has(v));
      return !covered && !hasCaveat(claim.context);
    });
    expect(
      bare.map((c) => `line ${c.line}: ${c.text.slice(0, 90)}`),
      "these stage-completion claims cite no durable evidence and carry no #199 caveat",
    ).toEqual([]);
  });

  it("keeps every durable receipt on disk well-formed and agreeing with the matrix", () => {
    const markdown = read(RELEASE_STATE);
    for (const [version, { file, receipt }] of durableReceipts()) {
      expect(receipt.schema_version, `${file}: unexpected schema`).toBe(1);
      expect(receipt.kind, `${file}: unexpected kind`).toBe("release-transaction-receipt");
      expect(receipt.tag, `${file}: tag must be v-prefixed version`).toBe(`v${version}`);
      expect(receipt.source_commit, `${file}: malformed source commit`).toMatch(/^[0-9a-f]{40}$/);
      expect(receipt.transaction?.completed, `${file}: not a completed transaction`).toBe(true);
      expect(receipt.transaction?.stages, `${file}: stage list is not the engine's nine`).toEqual(
        EXPECTED_STAGES,
      );
      expect(receipt.journal_sha256, `${file}: malformed journal digest`).toMatch(/^[0-9a-f]{64}$/);
      // The receipt is evidence only if it describes the same artifacts the matrix does.
      for (const hash of [receipt.installer?.sha256, receipt.manifest_sha256]) {
        expect(
          markdown.includes(hash),
          `${file}: SHA-256 ${hash} appears in the receipt but nowhere in RELEASE_STATE.md`,
        ).toBe(true);
      }
      // And it must be as sanitized on disk as it was at emission — a hand-edit is still an edit.
      expect(scrubViolations(receipt), `${file}: carries machine-local detail`).toEqual([]);
    }
  });

  it("closes the caveat escape hatch once a release could have had a receipt", () => {
    // Without this, #199 item 4 would be satisfiable forever by writing "not re-verifiable" on
    // every new row. A release published after the emitter landed must produce evidence.
    const version = publishedVersion(read(RELEASE_STATE));
    if (compareVersions(version, LAST_RELEASE_WITHOUT_AN_EMITTER) <= 0) return;
    expect(
      durableReceipts().has(version),
      `v${version} was published after scripts/emit-release-receipt.mjs landed, so it must have ` +
        `docs/release-receipts/v${version}.json. A caveat is not an alternative here: the emitter ` +
        "runs inside the transaction, and release.ps1 prints the re-run command if it failed.",
    ).toBe(true);
  });

  it("FALSIFICATION: the version comparator orders patch releases numerically", () => {
    // "0.9.9" > "0.9.26" as strings, and that mistake would silently exempt every future release.
    expect(compareVersions("0.9.26", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.9.27", "0.9.26")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.26")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.26")).toBeGreaterThan(0);
    expect(compareVersions("0.9.26", "0.9.26")).toBe(0);
    expect(compareVersions("0.9.11", "0.9.26")).toBeLessThan(0);
  });

  it("FALSIFICATION: today's release is inside the grace window, and only just", () => {
    // Pins the boundary itself. If someone bumps the constant to wave a future release through,
    // this fails and says why.
    expect(compareVersions(publishedVersion(read(RELEASE_STATE)), LAST_RELEASE_WITHOUT_AN_EMITTER))
      .toBeLessThanOrEqual(0);
    expect(existsSync(join(RECEIPTS_DIR, `v${LAST_RELEASE_WITHOUT_AN_EMITTER}.json`))).toBe(false);
  });
});

// ── Falsification ────────────────────────────────────────────────────────────────────────────────
// The live checks above pass today because the caveat branch is satisfied. That proves nothing
// about whether they can fail. These drive the same functions with the shapes that must fail.

const JOURNAL = {
  schema_version: 1,
  binding: {
    receipt_schema: 3,
    version: "0.9.30",
    release_commit: "a".repeat(40),
    source_tag: "v0.9.30",
    installer_sha256: "b".repeat(64),
    signature_sha256: "c".repeat(64),
    manifest_sha256: "d".repeat(64),
  },
  completed_stages: EXPECTED_STAGES.slice(),
  evidence: { release_published: { release_id: 123456789 } },
};

const RECEIPT = {
  schema_version: 3,
  version: "0.9.30",
  commit: "a".repeat(40),
  tag: "v0.9.30",
  installer: { path: "C:\\Users\\somebody\\code\\x\\Compy_0.9.30_x64-setup.exe", sha256: "b".repeat(64) },
  signature: { path: "…/Compy_0.9.30_x64-setup.exe.sig", sha256: "c".repeat(64) },
  manifest: { path: "…/latest.json", sha256: "d".repeat(64) },
};

const build = (over = {}) =>
  buildDurableReceipt({
    journal: JSON.parse(JSON.stringify(JOURNAL)),
    receipt: JSON.parse(JSON.stringify(RECEIPT)),
    journalSha256: "e".repeat(64),
    emittedAt: "2026-08-25T09:30:00Z",
    ...over,
  });

describe("the emitter refuses everything it should", () => {
  it("builds a receipt from a complete, agreeing transaction", () => {
    const out = build();
    expect(out.version).toBe("0.9.30");
    expect(out.tag).toBe("v0.9.30");
    expect(out.release_id).toBe("123456789");
    expect(out.transaction.stages_completed).toBe(9);
    // The installer PATH in the staged receipt is a machine-local path; only its NAME survives.
    expect(out.installer.name).toBe("Compy_0.9.30_x64-setup.exe");
    expect(JSON.stringify(out)).not.toContain("somebody");
  });

  it("refuses a transaction that did not complete", () => {
    const journal = JSON.parse(JSON.stringify(JOURNAL));
    journal.completed_stages = EXPECTED_STAGES.slice(0, 8);
    expect(() => build({ journal })).toThrow(/not complete.*public_assets_verified/s);
  });

  it("refuses when the journal and the signed receipt disagree", () => {
    const receipt = JSON.parse(JSON.stringify(RECEIPT));
    receipt.installer.sha256 = "f".repeat(64);
    expect(() => build({ receipt })).toThrow(/disagree.*installer\.sha256/s);
  });

  it("refuses an unsupported journal or receipt schema", () => {
    expect(() => build({ journal: { ...JOURNAL, schema_version: 2 } })).toThrow(/journal schema/i);
    expect(() => build({ receipt: { ...RECEIPT, schema_version: 2 } })).toThrow(/receipt schema/i);
  });

  it("returns null rather than leaking a release id it does not recognise", () => {
    const journal = JSON.parse(JSON.stringify(JOURNAL));
    journal.evidence = { release_published: { release_id: "https://api.github.com/…/372920800" } };
    expect(build({ journal }).release_id).toBeNull();
  });

  it("scrubs the shapes that must never reach a tracked file", () => {
    const cases = [
      ["C:\\Users\\Kuya\\code", "a drive-letter path"],
      ["\\\\server\\share\\x", "a UNC share path"],
      ["/home/someone/build", "a user-home path"],
      ["%APPDATA%\\Compy", "an environment-variable expansion"],
      ["file:///tmp/x.json", "a file:// URL"],
    ];
    for (const [value, what] of cases) {
      const hits = scrubViolations({ field: value }, { user: "", host: "" });
      expect(hits.map((h) => h.what), `missed ${what} in ${value}`).toContain(what);
    }
    // And it must not fire on the things a receipt legitimately carries.
    expect(
      scrubViolations(
        { name: "Compy_0.9.30_x64-setup.exe", tag: "v0.9.30", sha: "b".repeat(64) },
        { user: "", host: "" },
      ),
    ).toEqual([]);
  });

  it("refuses to write a receipt that would carry this machine's identity", () => {
    const receipt = JSON.parse(JSON.stringify(RECEIPT));
    // An installer whose FILENAME is a path: the name-extraction would pass it straight through.
    receipt.installer.path = "C:\\builds\\%USERNAME%-setup.exe";
    expect(() => build({ receipt })).toThrow(/sanitization failed/i);
  });
});

describe("the caveat rule fires on the drift it was written for", () => {
  const ROW = (extra) =>
    `| **v0.9.11 — PUBLISHED** | transaction complete: 9 of 9 stages. | ${extra} |`;

  it("accepts a table row whose own cell carries the caveat", () => {
    const md = ROW("**The stage count is NOT re-verifiable — see issue #199.**");
    const claims = stageClaims(md);
    expect(claims).toHaveLength(1);
    expect(hasCaveat(claims[0].context)).toBe(true);
  });

  it("does NOT let a caveat one row up cover the row below it", () => {
    // The exact residual drift: line 63 caveated, line 65 not. Row-scoped context is what catches it.
    const md = [ROW("**NOT re-verifiable — see issue #199.**"), ROW("`gh release view …`")].join("\n");
    const claims = stageClaims(md);
    expect(claims).toHaveLength(2);
    expect(hasCaveat(claims[0].context)).toBe(true);
    expect(hasCaveat(claims[1].context), "a neighbouring row's honesty is not this row's").toBe(false);
  });

  it("gives a prose claim its whole paragraph, where the qualifier may be on another line", () => {
    const md = [
      "# heading",
      "",
      "The v0.9.15 release transaction is complete: 9 of 9 stages,",
      "though that count is NOT re-verifiable — see issue #199.",
      "",
      "An unrelated paragraph.",
    ].join("\n");
    const claims = stageClaims(md);
    expect(claims).toHaveLength(1);
    expect(hasCaveat(claims[0].context)).toBe(true);
  });

  it("does not reach across a blank line for a prose caveat", () => {
    const md = ["transaction 9 of 9.", "", "NOT re-verifiable — see issue #199."].join("\n");
    expect(hasCaveat(stageClaims(md)[0].context)).toBe(false);
  });

  it("accepts a caveat that wraps across a line, because prose wraps", () => {
    expect(hasCaveat("that stage count is **NOT\n   re-verifiable — see issue #199**")).toBe(true);
  });

  it("requires both halves of the caveat, not just the issue number", () => {
    expect(hasCaveat("transaction 9 of 9 (see #199)")).toBe(false);
    expect(hasCaveat("9 of 9 — not re-verifiable")).toBe(false);
  });

  it("catches the `9/9` shorthand, which reads as a claim and would otherwise slip", () => {
    expect(stageClaims("the publishes are CLOSED (through v0.9.26, 9/9).")).toHaveLength(1);
  });

  it("does not accuse the self-review rubric, which is also nine of nine", () => {
    // Literal text from the Q5 support-evidence row. The first draft of this guard flagged it, and
    // demanding a release caveat on a VISUAL review would have put a false statement in the matrix.
    const md = "the surface's visual self-review PASSed on the installed `5ff6963` release build (9/9 rubric items, live captures at the owner's real resolution).";
    expect(stageClaims(md)).toEqual([]);
    // The disqualifier is the following word, not the presence of "rubric" anywhere on the line.
    expect(stageClaims("rubric aside, the transaction closed 9 of 9 stages.")).toHaveLength(1);
  });

  it("only discharges a multi-version claim when every version it names has evidence", () => {
    const context = "v0.9.26 transaction 9 of 9; it supersedes v0.9.25, transaction 9 of 9.";
    expect(versionsNamed(context)).toEqual(["0.9.26", "0.9.25"]);
  });
});
