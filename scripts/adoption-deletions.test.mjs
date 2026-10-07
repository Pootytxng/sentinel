import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GIT_SPAWN_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";

import {
  CALL_MS,
  DIRECTORY_REASON,
  FAILED_REASON,
  RUN_MS,
  UNREADABLE_REASON,
  WATCHED,
  boundedGit,
  collectDeletions,
  formatReport,
  parseDiff,
  render,
  run,
  truncatedAt,
} from "./adoption-deletions.mjs";

// Guard 1 of #322. The unit half below starts no process: it feeds synthetic git output to the pure
// functions, and to run() through a scripted git. The CLI runs at the end use real repositories.

const HANDOFF = "docs/SESSION_HANDOFF.md";
const DISPO = "docs/BRANCH_DISPOSITIONS.md";

// Full-length ids, as run() asks git for and checks: commits are one repeated digit, blobs are not.
const sha = (c) => c.repeat(40);
const BASE = sha("9");
const OLD = "01".repeat(20);
const NEW = "02".repeat(20);
const ABSENT = sha("0");
const EMPTY = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"; // the blob with no bytes
let blobs = 0;
const blob = () => (++blobs).toString(16).padStart(40, "0");

const patch = (file, hunks, [oldOid, newOid] = [OLD, NEW]) =>
  [`diff --git a/${file} b/${file}`, `index ${oldOid}..${newOid} 100644`, `--- a/${file}`, `+++ b/${file}`, ...hunks].join("\n");

// #322 instance 2, reduced: both copies carry the same row keys (A, B), but the checkout being
// replaced also carries a retraction under row B that the adopted copy predates.
const RETRACTION = "  - RETRACTED 2026-09-01: the earlier claim that #300 landed was false; it is still open.";
const adoptionHunks = ["@@ -3,4 +3,3 @@", " | A | lane-a | open |", " | B | lane-b | landed |", `-${RETRACTION}`, " | C | lane-c | open |"];
const adoption = patch(HANDOFF, adoptionHunks);

// A scripted git: answers each call from `answers` by subcommand, with diff-tree split into the tree
// "scan" (--stdin) and one file's "patch". An Error answer is thrown. Every call is recorded.
const fake = (answers) => {
  const git = (args, input) => {
    // Skip global options such as --no-literal-pathspecs and `-c <key=value>` pairs.
    const sub = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c");
    const key = sub === "diff-tree" ? (args.includes("--stdin") ? "scan" : "patch") : sub;
    git.calls.push({ key, args, input });
    const a = answers[key];
    if (a instanceof Error) throw a;
    if (a === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
    return typeof a === "function" ? a(args, input) : a;
  };
  git.calls = [];
  return git;
};

// One watched path changed between a commit and one parent, as git reports it twice: the tree scan's
// raw record, and the file's own patch. Blob ids are fresh per change unless given; `bytes` hands the
// patch over as a Buffer of exactly those bytes (one char per byte).
const touch = (path, hunks, { modes = ["100644", "100644"], oids = [blob(), blob()], status = "M", text = patch, bytes = false } = {}) => {
  const body = `${text(path, hunks, oids)}\n`;
  return { path, record: `:${modes.join(" ")} ${oids.join(" ")} ${status}`, text: bytes ? Buffer.from(body, "latin1") : body };
};

// A history for run(), newest commit first: { sha, subject, parents = [BASE], touches } — or, for a
// merge, `against`: one list of touches per parent.
const scripted = (commits, overrides = {}) => {
  const rows = commits.map((c) => ({ parents: [BASE], ...c }));
  const touches = (id, parent) => {
    const c = rows.find((row) => row.sha === id);
    return (c.against ?? [c.touches ?? []])[parent ? c.parents.indexOf(parent) : 0];
  };
  return fake({
    "rev-list": rows.map((c) => `${[c.sha, ...c.parents].join(" ")}\n`).join(""),
    scan: (_args, input) =>
      input
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" "))
        .map(([id, parent]) => `${id}\0${touches(id, parent).map((t) => `${t.record}\0${t.path}\0`).join("")}`)
        .join(""),
    patch: (args) => {
      const [parent, id, , spec] = args.slice(-4);
      return touches(id, parent).find((t) => `:(top)${t.path}` === spec).text;
    },
    log: (_args, input) =>
      input
        .split("\n")
        .filter(Boolean)
        .map((id) => `${id}\t${rows.find((c) => c.sha === id).subject}\n`)
        .join(""),
    ...overrides,
  });
};

// run() over a scripted history with no shallow boundary.
const report = (commits, overrides) => run(["r"], scripted(commits, overrides), () => "");
const kinds = (git) => git.calls.map((c) => c.key);

describe("parseDiff", () => {
  it("collects removed lines with their old line numbers", () => {
    const f = parseDiff(adoption).get(HANDOFF);
    expect(f.removed).toEqual([{ line: 5, text: RETRACTION }]);
    expect(f.added).toEqual([]);
  });

  it("reads a removed line that looks like a header as content, not as a new file", () => {
    const text = patch(HANDOFF, ["@@ -1,2 +1,0 @@", "--- a/docs/OTHER.md", "-diff --git a/x b/x"]);
    const files = parseDiff(text);
    expect([...files.keys()]).toEqual([HANDOFF]);
    expect(files.get(HANDOFF).removed.map((r) => r.text)).toEqual(["-- a/docs/OTHER.md", "diff --git a/x b/x"]);
  });

  it("handles -U0 single-line hunks, CRLF input and no-newline markers", () => {
    const text = patch(DISPO, ["@@ -7 +7 @@", "-old row", "\\ No newline at end of file", "+new row"]).replace(/\n/g, "\r\n");
    const f = parseDiff(text).get(DISPO);
    expect(f.removed).toEqual([{ line: 7, text: "old row" }]);
    expect(f.added).toEqual([{ line: 7, text: "new row" }]);
  });

  it("attributes a whole-file deletion to the deleted path", () => {
    const text = [`diff --git a/${DISPO} b/${DISPO}`, "deleted file mode 100644", `--- a/${DISPO}`, "+++ /dev/null", "@@ -1,2 +0,0 @@", "-x", "-y"].join("\n");
    expect(parseDiff(text).get(DISPO).removed.map((r) => r.text)).toEqual(["x", "y"]);
  });

  it("keeps the index line's blob ids and counts the headers that name the file", () => {
    const f = parseDiff(adoption).get(HANDOFF);
    expect([f.headers, f.oldOid, f.newOid]).toEqual([1, OLD, NEW]);
    expect(parseDiff(`${adoption}\n${adoption}`).get(HANDOFF).headers).toBe(2);
  });
});

describe("collectDeletions — content, not row keys", () => {
  it("reports the lost retraction even though every row key survives the adoption", () => {
    const [d] = collectDeletions(adoption);
    expect(d.file).toBe(HANDOFF);
    expect(d.lines).toEqual([{ line: 5, text: RETRACTION, moved: false }]);
  });

  it("marks a line re-added verbatim in the same file as moved, matched as a multiset", () => {
    const text = patch(DISPO, ["@@ -1,3 +0,0 @@", "-dup", "-dup", "-gone", "@@ -9,0 +8,1 @@", "+dup"]);
    const [d] = collectDeletions(text);
    expect(d.lines.map((l) => [l.text, l.moved])).toEqual([
      ["dup", true],
      ["dup", false],
      ["gone", false],
    ]);
  });

  it("does not count a line re-added in a DIFFERENT file as moved", () => {
    const text = [patch(HANDOFF, ["@@ -1 +0,0 @@", "-row"]), patch(DISPO, ["@@ -0,0 +1 @@", "+row"])].join("\n");
    expect(collectDeletions(text)[0].lines[0].moved).toBe(false);
  });

  it("ignores files outside the watched pair", () => {
    expect(collectDeletions(patch("docs/BACKLOG.md", ["@@ -1 +0,0 @@", "-x"]))).toEqual([]);
    expect(WATCHED).toEqual([HANDOFF, DISPO]);
  });
});

describe("per-commit analysis", () => {
  // A later commit restoring the line must not hide the commit that deleted it.
  const history = [
    { sha: sha("b"), subject: "restore the retraction", touches: [touch(HANDOFF, ["@@ -4,0 +5 @@", `+${RETRACTION}`])] },
    { sha: sha("a"), subject: "adopt handoff wholesale", touches: [touch(HANDOFF, adoptionHunks)] },
  ];

  it("prints each touching commit's own deletions, including a commit that deletes nothing", () => {
    const out = report(history);
    expect(out).toContain("1 line(s) deleted, 0 moved");
    expect(out).toContain(`-L5: ${RETRACTION}`);
    expect(out).toContain("bbbbbbbbbb restore the retraction\n    (no lines deleted)");
  });

  it("says measured-and-empty explicitly when no commit touches the docs", () => {
    expect(formatReport("r", [])).toMatch(/measured: no commit touches/);
    expect(report([])).toMatch(/measured: no commit touches/);
    expect(report([{ sha: sha("a"), subject: "elsewhere" }])).toMatch(/measured: no commit touches/);
  });

  it("measures a merge against each of its parents and prints one answer per parent", () => {
    const [M, P1, P2, P3] = [sha("e"), sha("4"), sha("5"), sha("6")];
    const against = [[], [touch(HANDOFF, ["@@ -1,0 +2 @@", "+merged note"])], [touch(HANDOFF, ["@@ -2 +1,0 @@", `-${RETRACTION}`])]];
    const git = scripted([{ sha: M, subject: "octopus keeps the first parent's copy", parents: [P1, P2, P3], against }]);
    const out = run(["r"], git, () => "");
    // The line only the third parent had is listed; a clean first parent does not stand in for the others.
    expect(out).toContain(
      "eeeeeeeeee octopus keeps the first parent's copy\n" +
        "    against parent 1 of 3 (4444444444): watched docs unchanged\n" +
        "    against parent 2 of 3 (5555555555): (no lines deleted)\n" +
        "    against parent 3 of 3 (6666666666):\n" +
        `      ${HANDOFF}: 1 deleted, 0 moved\n` +
        `        -L2: ${RETRACTION}`,
    );
    expect(out).toMatch(/1 line\(s\) deleted, 0 moved within the file\. Review every deleted line before adopting\. A merge is measured against each of its parents/);
    // Every parent is compared in the scan, and each changed file's patch is read against its own parent.
    expect(git.calls.find((c) => c.key === "scan").input).toBe(`${M} ${P1}\n${M} ${P2}\n${M} ${P3}\n`);
    expect(git.calls.filter((c) => c.key === "patch").map((c) => c.args.slice(-4, -2))).toEqual([
      [P2, M],
      [P3, M],
    ]);
  });

  it("reads the patch between the same two blobs once, and still reports it under every commit that carries it", () => {
    const same = { oids: [OLD, NEW] };
    const git = scripted([
      { sha: sha("b"), subject: "the same change, cherry-picked", parents: [sha("8")], touches: [touch(HANDOFF, adoptionHunks, same)] },
      { sha: sha("a"), subject: "adopt handoff wholesale", touches: [touch(HANDOFF, adoptionHunks, same)] },
    ]);
    const out = run(["r"], git, () => "");
    expect(out).toMatch(/^adoption-deletions: r — 2 commit\(s\) touch the watched docs; 2 line\(s\) deleted, 0 moved/);
    expect(out.match(/-L5: /g)).toHaveLength(2);
    expect(kinds(git).filter((key) => key === "patch")).toHaveLength(1);
  });
});

describe("the tree scan is the frame — it answers every (commit, parent) pair once, in order, or nothing is trusted", () => {
  const A = sha("a");
  const B = sha("b");
  const lost = touch(DISPO, ["@@ -2 +1,0 @@", "-lost row"]);
  const adopted = touch(HANDOFF, adoptionHunks);
  const history = [
    { sha: B, subject: "later", touches: [lost] },
    { sha: A, subject: "earlier", touches: [adopted] },
  ];
  const b = `${B}\0${lost.record}\0${DISPO}\0`;
  const a = `${A}\0${adopted.record}\0${HANDOFF}\0`;

  it("accepts the well-formed stream", () => {
    expect(report(history, { scan: b + a })).toMatch(/^adoption-deletions: r — 2 commit\(s\) touch the watched docs; 2 line\(s\) deleted, 0 moved/);
  });

  it.each([
    ["a pair's answer is missing", b],
    ["the answers are out of order", a + b],
    ["a pair is answered twice", b + a + a],
    ["the stream is cut before its last NUL", (b + a).slice(0, -1)],
    ["a record has no path", `${b}${A}\0${adopted.record}\0`],
    ["a record's ids are abbreviated", b + a.replace(/ [0-9a-f]{40} [0-9a-f]{40} /, " 1111111 2222222 ")],
    ["a record's status disagrees with its modes", b + a.replace(" M\0", " A\0")],
    ["a record names a path outside the watched pair", b + a.replace(HANDOFF, "docs/BACKLOG.md")],
    ["a watched path is recorded twice for one pair", `${b}${a}${adopted.record}\0${HANDOFF}\0`],
    ["a line of document text stands where a commit id must", `${b}-${RETRACTION}\0${a}`],
  ])("NOT MEASURED when %s", (_name, stream) => {
    const git = scripted(history, { scan: stream });
    const out = run(["r"], git, () => "");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — the tree scan \(git diff-tree\) did not answer every commit and parent exactly once\. This is not a clean pass/);
    expect(out).not.toMatch(/no lines deleted|no commit touches/);
    // Nothing more is read on the strength of a stream that failed its framing.
    expect(kinds(git)).toEqual(["rev-list", "scan"]);
  });

  it("NOT MEASURED when the scan fails, or when rev-list prints anything but commit ids", () => {
    expect(report(history, { scan: new Error("spawnSync git ETIMEDOUT") })).toMatch(
      /^adoption-deletions: NOT MEASURED \(r\) — the tree scan \(git diff-tree\) failed or ran out of time/,
    );
    for (const listing of [`${B} ${BASE}\nwarning: something\n`, `${B.slice(0, 12)} ${BASE}\n`, `${B}  ${BASE}\n`]) {
      const git = scripted(history, { "rev-list": listing });
      expect(run(["r"], git, () => "")).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — git rev-list printed something other than commit ids/);
      expect(kinds(git)).toEqual(["rev-list"]);
    }
  });

  it("a root commit is one pair of its own and can only add; any other record fails the frame", () => {
    const root = (touches) => [{ sha: A, subject: "root", parents: [], touches }];
    const git = scripted(root([touch(HANDOFF, [], { modes: ["000000", "100644"], oids: [ABSENT, NEW], status: "A" })]));
    expect(run(["r"], git, () => "")).toContain("aaaaaaaaaa root\n    (no lines deleted)");
    expect(git.calls.find((c) => c.key === "scan").input).toBe(`${A}\n`);
    expect(report(root([touch(HANDOFF, adoptionHunks)]))).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — the tree scan/);
  });

  it("reads touched paths from the scan alone, so a document line shaped like a raw record cannot add one", () => {
    const rawLooking = `:100644 100644 ${OLD} ${NEW} M\t${HANDOFF}`;
    const out = report([{ sha: A, subject: "add an odd row", touches: [touch(DISPO, ["@@ -0,0 +1 @@", `+${rawLooking}`])] }]);
    expect(out).toMatch(/^adoption-deletions: r — 1 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 0 moved/);
    expect(out).toContain("aaaaaaaaaa add an odd row\n    (no lines deleted)");
    expect(out).not.toContain(HANDOFF);
  });
});

describe("binary diff of a watched doc — NOT MEASURED, never a false clean", () => {
  // A PowerShell `>` / Out-File rewrite writes UTF-16 with NUL bytes; git then prints no hunks.
  const binary = (file, _hunks, [oldOid, newOid] = [OLD, NEW]) =>
    [`diff --git a/${file} b/${file}`, `index ${oldOid}..${newOid} 100644`, `Binary files a/${file} and b/${file} differ`].join("\n");

  it("marks the binary file NOT MEASURED instead of listing zero deletions", () => {
    expect(parseDiff(binary(HANDOFF)).get(HANDOFF).binary).toBe(true);
    expect(collectDeletions(binary(HANDOFF))).toEqual([{ file: HANDOFF, lines: [], notMeasured: expect.stringMatching(/binary diff/) }]);
  });

  it("prints the commit's file as NOT MEASURED with the reason, and the summary is not a clean pass", () => {
    const out = report([
      { sha: sha("c"), subject: "re-save handoff from PowerShell", touches: [touch(HANDOFF, [], { text: binary })] },
      { sha: sha("d"), subject: "adopt dispositions", touches: [touch(DISPO, ["@@ -2 +1,0 @@", "-lost row"])] },
    ]);
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 1 watched file diff\(s\) could not be read/);
    expect(out).toMatch(/not a clean pass/);
    expect(out).toContain(`cccccccccc re-save handoff from PowerShell\n    ${HANDOFF}: NOT MEASURED — binary diff (likely an encoding change`);
    expect(out).not.toMatch(/cccccccccc[^\n]*\n\s+\(no lines deleted\)/);
    expect(out).toContain("-L2: lost row");
  });

  it("still marks a binary diff whose diff --git header is missing, by the paths the line names", () => {
    expect(parseDiff(`Binary files /dev/null and b/${DISPO} differ`).get(DISPO).binary).toBe(true);
  });
});

describe("a touched watched doc whose patch cannot be read — NOT MEASURED, never dropped", () => {
  // The tree scan says the file changed between two blobs. A user's textconv (or any config that
  // hides the patch) must then leave it NOT MEASURED — never absent, never "(no lines deleted)".
  const hidden = () => "";
  const bare = (file, _hunks, [oldOid, newOid]) => [`diff --git a/${file} b/${file}`, `index ${oldOid}..${newOid} 100644`].join("\n");
  const relative = (_file, hunks, oids) => patch("SESSION_HANDOFF.md", hunks, oids);
  const history = [
    { sha: sha("e"), subject: "textconv hid the patch", touches: [touch(HANDOFF, [], { text: hidden })] },
    { sha: sha("f"), subject: "header with no hunks", touches: [touch(HANDOFF, [], { text: bare })] },
    { sha: sha("1"), subject: "header under a cwd-relative path", touches: [touch(HANDOFF, ["@@ -2 +1,0 @@", "-lost"], { text: relative })] },
    { sha: sha("2"), subject: "one of two touched docs hidden", touches: [touch(HANDOFF, [], { text: hidden }), touch(DISPO, ["@@ -2 +1,0 @@", "-lost row"])] },
    { sha: sha("3"), subject: "mode-only change", touches: [touch(HANDOFF, [], { modes: ["100644", "100755"], oids: [OLD, OLD] })] },
  ];

  it("keeps every commit and marks each unreadable file NOT MEASURED; a mode-only change stays measured", () => {
    const out = report(history);
    expect(out.match(/^  [0-9a-f]{10} /gm).map((l) => l.slice(2, 6))).toEqual(["eeee", "ffff", "1111", "2222", "3333"]);
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 4 watched file diff\(s\) could not be read/);
    expect(out).not.toMatch(/no commit touches/);
    expect(out).toContain(`eeeeeeeeee textconv hid the patch\n    ${HANDOFF}: NOT MEASURED — ${UNREADABLE_REASON}`);
    expect(out).toContain(`ffffffffff header with no hunks\n    ${HANDOFF}: NOT MEASURED — ${UNREADABLE_REASON}`);
    expect(out).toContain(`1111111111 header under a cwd-relative path\n    ${HANDOFF}: NOT MEASURED — ${UNREADABLE_REASON}`);
    expect(out).toContain(
      `2222222222 one of two touched docs hidden\n    ${HANDOFF}: NOT MEASURED — ${UNREADABLE_REASON}\n    ${DISPO}: 1 deleted, 0 moved\n      -L2: lost row`,
    );
    for (const id of ["eeeeeeeeee", "ffffffffff", "1111111111", "2222222222"])
      expect(out).not.toMatch(new RegExp(`${id}[^\n]*\n\\s+\\(no lines deleted\\)`));
    expect(out).toContain("3333333333 mode-only change\n    (no lines deleted)");
    // A line of a patch that was not accepted is never listed.
    expect(out).not.toMatch(/-L2: lost$/m);
  });

  it.each([
    ["names other blobs than the scan did", (file, hunks) => patch(file, hunks, [OLD, sha("d")])],
    ["has no index line", (file, hunks, oids) => patch(file, hunks, oids).replace(/^index .*\n/m, "")],
    ["names the file twice", (file, hunks, oids) => `${patch(file, hunks, oids)}\n${patch(file, ["@@ -9 +8,0 @@", "-x"], oids)}`],
    ["also carries another file's patch", (file, hunks, oids) => `${patch(file, hunks, oids)}\n${patch("docs/BACKLOG.md", ["@@ -9 +8,0 @@", "-x"], oids)}`],
    [
      "shows no changed line between two different blobs",
      (file, _hunks, [oldOid, newOid]) => [`diff --git a/${file} b/${file}`, "old mode 100644", "new mode 100755", `index ${oldOid}..${newOid}`].join("\n"),
    ],
  ])("a patch that %s is not the one the scan promised: NOT MEASURED, and no line of it is listed", (_name, text) => {
    const out = report([{ sha: sha("a"), subject: "adopt", touches: [touch(HANDOFF, adoptionHunks, { text })] }]);
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 1 watched file diff\(s\) could not be read/);
    expect(out).toContain(`aaaaaaaaaa adopt\n    ${HANDOFF}: NOT MEASURED — ${UNREADABLE_REASON}`);
    expect(out).not.toMatch(/-L\d|no lines deleted/);
  });

  it("marks a watched header with no hunks NOT MEASURED, but keeps an empty-file create measured", () => {
    const header = [`diff --git a/${HANDOFF} b/${HANDOFF}`, "index 1111111..2222222 100644"].join("\n");
    expect(collectDeletions(header)).toEqual([{ file: HANDOFF, lines: [], notMeasured: UNREADABLE_REASON }]);
    const empty = [`diff --git a/${DISPO} b/${DISPO}`, "new file mode 100644", "index 0000000..e69de29"].join("\n");
    expect(collectDeletions(empty)).toEqual([]);
  });
});

describe("hunks parsed by their @@ counts — a blank context line or a count mismatch is never a false clean", () => {
  // diff.suppressBlankEmpty=true + diff.interHunkContext=1 merges the two -U0 hunks below across the
  // blank line and prints that context line as "" rather than " ". The retraction after it is real.
  const blankHunks = ["@@ -3,2 +3,2 @@", "+- row A2", "", `-${RETRACTION}`];
  const one = (subject, hunks) => report([{ sha: sha("b"), subject, touches: [touch(HANDOFF, hunks)] }]);

  it("reads a pure \"\" line as context while counts remain, so the deletion after it is kept", () => {
    const f = parseDiff(patch(HANDOFF, blankHunks)).get(HANDOFF);
    expect(f.removed).toEqual([{ line: 4, text: RETRACTION }]);
    expect(f.added).toEqual([{ line: 3, text: "- row A2" }]);
    const out = one("add A2, drop retraction", blankHunks);
    expect(out).toContain(`-L4: ${RETRACTION}`);
    expect(out).not.toContain("(no lines deleted)");
    expect(out).not.toMatch(/NOT MEASURED/);
  });

  it("marks a hunk whose body does not consume exactly its header counts NOT MEASURED", () => {
    // Body ends one line short of "-3,2 +3,2" (truncated), and a second hunk is cut off by the next header.
    const shortHunks = ["@@ -3,2 +3,2 @@", "+- row A2", `-${RETRACTION}`];
    const cutByHeader = [patch(DISPO, ["@@ -1,3 +1,1 @@", "-gone"]), patch(HANDOFF, ["@@ -9 +9 @@", "-x", "+y"])].join("\n");
    for (const [text, file] of [
      [patch(HANDOFF, shortHunks), HANDOFF],
      [cutByHeader, DISPO],
    ]) {
      const f = collectDeletions(text).find((d) => d.file === file);
      expect(f).toMatchObject({ file, lines: [] });
      expect(f.notMeasured).toMatch(/@@ line counts/);
    }
    // The file after the cut is still read normally.
    expect(collectDeletions(cutByHeader).find((d) => d.file === HANDOFF).lines).toEqual([{ line: 9, text: "x", moved: false }]);
    const out = one("short hunk", shortHunks);
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\)/);
    expect(out).toMatch(/docs\/SESSION_HANDOFF\.md: NOT MEASURED — .*@@ line counts/);
    expect(out).not.toContain("(no lines deleted)");
  });

  it("marks a hunk whose body runs past its header counts NOT MEASURED, never skipping the extra lines", () => {
    // "-3 +3" counts one removed and one added line; the second "-" line lies past them and was
    // once skipped as a non-header, so the retraction vanished from a clean-looking report.
    const overlongHunks = ["@@ -3 +3 @@", "-row A", "+row A2", `-${RETRACTION}`];
    const f = collectDeletions(patch(HANDOFF, overlongHunks)).find((d) => d.file === HANDOFF);
    expect(f.notMeasured).toMatch(/@@ line counts/);
    expect(one("overlong hunk", overlongHunks)).toMatch(/^adoption-deletions: NOT MEASURED \(r\)/);
    // A well-formed multi-hunk, multi-file patch with a no-newline marker stays measured.
    const ok = [patch(HANDOFF, ["@@ -3 +3 @@", "-a", "+b", "\\ No newline at end of file", "@@ -9 +9 @@", "-x", "+y"]), patch(DISPO, ["@@ -1 +0,0 @@", "-gone"])].join("\n");
    expect(collectDeletions(ok).every((d) => !d.notMeasured)).toBe(true);
  });
});

describe("entry modes — only a regular file is read as a document", () => {
  const one = (touches) => scripted([{ sha: sha("a"), subject: "s", touches }]);

  it.each([
    ["a regular file becomes a symlink over the same blob", ["100644", "120000"], [OLD, OLD], "T"],
    ["a symlink becomes a regular file", ["120000", "100644"], [OLD, NEW], "T"],
    ["a symlink is retargeted", ["120000", "120000"], [OLD, NEW], "M"],
    ["a submodule link is updated", ["160000", "160000"], [OLD, NEW], "M"],
    ["a regular file becomes a submodule link", ["100644", "160000"], [OLD, NEW], "T"],
    ["a submodule link is added", ["000000", "160000"], [ABSENT, NEW], "A"],
    ["a symlink is deleted", ["120000", "000000"], [OLD, ABSENT], "D"],
  ])("NOT MEASURED, naming both modes, when %s", (_name, modes, oids, status) => {
    const git = one([touch(HANDOFF, [], { modes, oids, status })]);
    const out = run(["r"], git, () => "");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 1 watched file diff\(s\) could not be read/);
    expect(out).toContain(`aaaaaaaaaa s\n    ${HANDOFF}: NOT MEASURED — non-regular entry (mode ${modes.join(" → ")})`);
    expect(out).not.toMatch(/\[moved\]|no lines deleted/);
    // The entry is never handed to the patch reader as if it were a document.
    expect(kinds(git)).toEqual(["rev-list", "scan", "log"]);
  });

  it.each([
    ["only its mode changes between regular modes", ["100644", "100755"], [OLD, OLD], "M"],
    ["it is new", ["000000", "100644"], [ABSENT, NEW], "A"],
    ["it was empty", ["100644", "100644"], [EMPTY, NEW], "M"],
  ])("a regular doc has no line to delete when %s: measured without reading a patch", (_name, modes, oids, status) => {
    const git = one([touch(HANDOFF, [], { modes, oids, status })]);
    expect(run(["r"], git, () => "")).toMatch(/; 0 line\(s\) deleted, 0 moved[^\n]*\n  aaaaaaaaaa s\n    \(no lines deleted\)$/);
    expect(kinds(git)).toEqual(["rev-list", "scan", "log"]);
  });

  it("a deleted regular doc lists every line it had", () => {
    const gone = (file, hunks, [oldOid, newOid]) =>
      [`diff --git a/${file} b/${file}`, "deleted file mode 100644", `index ${oldOid}..${newOid}`, `--- a/${file}`, "+++ /dev/null", ...hunks].join("\n");
    const deleted = touch(DISPO, ["@@ -1,2 +0,0 @@", "-x", "-y"], { modes: ["100644", "000000"], oids: [OLD, ABSENT], status: "D", text: gone });
    expect(run(["r"], one([deleted]), () => "")).toContain(`${DISPO}: 2 deleted, 0 moved\n      -L1: x\n      -L2: y`);
  });

  it("a directory at a watched path: a change under it is NOT MEASURED, and replacing the doc with it lists every line", () => {
    const part = `${HANDOFF}/part.md`;
    const inside = one([touch(part, ["@@ -1 +1 @@", "-x", "+y"])]);
    const out = run(["r"], inside, () => "");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 1 watched file diff\(s\) could not be read/);
    expect(out).toContain(`aaaaaaaaaa s\n    ${HANDOFF}: NOT MEASURED — ${DIRECTORY_REASON}`);
    expect(kinds(inside)).toEqual(["rev-list", "scan", "log"]);

    // git prints the doc's deletion and the new file under it in the one patch asked for the doc's path.
    const both = (file, hunks) =>
      [
        `diff --git a/${file} b/${file}`,
        "deleted file mode 100644",
        `index ${OLD}..${ABSENT}`,
        `--- a/${file}`,
        "+++ /dev/null",
        ...hunks,
        `diff --git a/${part} b/${part}`,
        "new file mode 100644",
        `index ${ABSENT}..${NEW}`,
        "--- /dev/null",
        `+++ b/${part}`,
        "@@ -0,0 +1 @@",
        "+x",
      ].join("\n");
    const replaced = run(
      ["r"],
      one([
        touch(HANDOFF, ["@@ -1,2 +0,0 @@", "-keep", `-${RETRACTION}`], { modes: ["100644", "000000"], oids: [OLD, ABSENT], status: "D", text: both }),
        touch(part, [], { modes: ["000000", "100644"], oids: [ABSENT, NEW], status: "A" }),
      ]),
      () => "",
    );
    expect(replaced).toContain(`${HANDOFF}: 2 deleted, 0 moved\n      -L1: keep\n      -L2: ${RETRACTION}`);
    expect(replaced).not.toMatch(/NOT MEASURED/);
  });
});

describe("lines are compared and printed as bytes", () => {
  // The byte string run() works on: one char per byte of the UTF-8 encoding.
  const view = (text) => Buffer.from(text, "utf8").toString("latin1");
  const one = (subject, hunks, options) => report([{ sha: sha("a"), subject, touches: [touch(HANDOFF, hunks, options)] }]);

  it("two lines that differ only in an invalid UTF-8 byte (0x96 against 0x92) are different lines, not a move", () => {
    const out = one("retype one byte", ["@@ -3 +3 @@", "-caf\x96 row", "+caf\x92 row"], { bytes: true });
    expect(out).not.toContain("[moved]");
    expect(out).toMatch(/; 1 line\(s\) deleted, 0 moved/);
    expect(out).toContain(`${HANDOFF}: 1 deleted, 0 moved\n      -L3 [escaped]: caf\\x96 row`);
  });

  it("the same invalid bytes re-added elsewhere in the file are still a move", () => {
    const out = one("move the line up", ["@@ -0,0 +1 @@", "+caf\x92 row", "@@ -3 +3,0 @@", "-caf\x92 row"], { bytes: true });
    expect(out).toContain(`${HANDOFF}: 0 deleted, 1 moved\n      -L3 [moved] [escaped]: caf\\x92 row`);
  });

  it("valid UTF-8 survives byte for byte, in a deleted line and in a subject", () => {
    const line = "café — row\ttabbed";
    const out = one("drop the café row", ["@@ -2 +1,0 @@", `-${line}`]);
    expect(out).toContain(`aaaaaaaaaa drop the café row\n    ${HANDOFF}: 1 deleted, 0 moved\n      -L2: ${line}`);
    expect(out).not.toContain("[escaped]");
  });

  it("render: printable UTF-8 prints as written; control and non-UTF-8 bytes print as \\xNN, flagged, with backslashes doubled", () => {
    expect(render(view("café — row\ttabbed"))).toEqual({ text: "café — row\ttabbed", escaped: false });
    expect(render("caf\x96 row")).toEqual({ text: "caf\\x96 row", escaped: true });
    expect(render("caf\x92 row").text).not.toBe(render("caf\x96 row").text);
    expect(render("\x00commit")).toEqual({ text: "\\x00commit", escaped: true });
    expect(render(view("é\x1b[2J"))).toEqual({ text: "é\\x1b[2J", escaped: true });
    // The four typed characters "\x96" are not the byte 0x96: an unescaped line keeps its backslash
    // single, an escaped one doubles it, so the two never print alike within one line.
    expect(render("typed \\x96")).toEqual({ text: "typed \\x96", escaped: false });
    expect(render("typed \\x96, byte \x96")).toEqual({ text: "typed \\\\x96, byte \\x96", escaped: true });
    // A leading byte-order mark is content, not a decoding hint to swallow.
    expect(render("\xef\xbb\xbfkeep")).toEqual({ text: `${String.fromCharCode(0xfeff)}keep`, escaped: false });
  });
});

describe("run — honest measurement, never a silent pass, never blocks", () => {
  const A = sha("a");
  const history = [{ sha: A, subject: "adopt", touches: [touch(HANDOFF, adoptionHunks), touch(DISPO, ["@@ -2 +1,0 @@", "-lost row"])] }];

  it("prints NOT MEASURED when there is no merge base (CI --depth=1)", () => {
    const out = run([], fake({ "merge-base": new Error("fatal: no merge base") }));
    expect(out).toMatch(/NOT MEASURED .*no merge base \/ shallow history/);
    expect(out).toMatch(/not a clean pass/);
  });

  it("prints NOT MEASURED when git cannot resolve the range, or cannot list it for any other reason", () => {
    const err = Object.assign(new Error("x"), { stderr: "fatal: bad revision 'abc~1..HEAD'" });
    expect(run(["abc~1..HEAD"], fake({ "rev-list": err }))).toMatch(/NOT MEASURED .*shallow history/);
    expect(run(["r"], fake({ "rev-list": new Error("spawnSync git ETIMEDOUT") }))).toMatch(/NOT MEASURED \(r\) — git rev-list failed or ran out of time/);
  });

  it("prints NOT MEASURED when the range reaches the shallow clone boundary, before any tree is read", () => {
    const GRAFT = sha("7");
    const git = scripted([...history, { sha: GRAFT, subject: "graft", parents: [] }]);
    expect(run(["r"], git, () => `${GRAFT}\n`)).toMatch(/NOT MEASURED .*clone boundary at 7777777777/);
    expect(kinds(git)).toEqual(["rev-list"]);
    const unreadable = () => {
      throw new Error("EACCES");
    };
    expect(run(["r"], scripted(history), unreadable)).toMatch(/NOT MEASURED \(r\) — could not check for a shallow-history boundary/);
    expect(truncatedAt("c1\nc2\n", "graft\n")).toEqual([]);
  });

  it("reports deletions over the default merge-base range when history is complete, every git call hermetic", () => {
    const git = scripted(history.map((c) => ({ ...c, touches: [c.touches[0]] })), { "merge-base": "base\n" });
    const out = run([], git, () => "");
    expect(kinds(git)).toEqual(["merge-base", "rev-list", "scan", "patch", "log"]);
    const [mergeBase, revList, scan, filePatch, log] = git.calls;
    expect(mergeBase.args).toEqual(["merge-base", "origin/main", "HEAD"]);
    // No pathspec: history is listed whole, with every parent, and nothing is simplified away.
    expect(revList.args).toEqual(["rev-list", "--parents", "--end-of-options", "base..HEAD"]);
    expect(scan.args.slice(0, 3)).toEqual(["--no-literal-pathspecs", "diff-tree", "--stdin"]);
    for (const flag of ["-r", "--raw", "-z", "--always", "--root", "--no-renames", "--no-abbrev", "--ignore-submodules=none", "--no-ext-diff", "--no-textconv", "--no-relative"])
      expect(scan.args).toContain(flag);
    expect(scan.args.slice(-3)).toEqual(["--", ...WATCHED.map((path) => `:(top)${path}`)]);
    expect(scan.input).toBe(`${A} ${BASE}\n`);
    expect(filePatch.args.slice(0, 5)).toEqual(["--no-literal-pathspecs", "-c", "diff.suppressBlankEmpty=false", "diff-tree", "-p"]);
    for (const flag of ["-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-relative", "--full-index", "--ignore-submodules=none", "--src-prefix=a/", "--dst-prefix=b/"])
      expect(filePatch.args).toContain(flag);
    // A binary diff must stay NOT MEASURED rather than be forced into lines.
    expect(filePatch.args).not.toContain("--text");
    expect(filePatch.args.slice(-4)).toEqual([BASE, A, "--", `:(top)${HANDOFF}`]);
    for (const flag of ["--no-walk=unsorted", "--stdin", "--no-show-signature", "--encoding=UTF-8"]) expect(log.args).toContain(flag);
    expect(log.input).toBe(`${A}\n`);
    expect(out).toContain(`-L5: ${RETRACTION}`);
  });

  it("a file whose patch git did not produce is NOT MEASURED, and the rest is still measured", () => {
    const answers = scripted(history);
    const git = scripted(history, {
      patch: (args) => {
        if (args.at(-1) === `:(top)${HANDOFF}`) throw new Error("spawnSync git ETIMEDOUT");
        return answers(args);
      },
    });
    const out = run(["r"], git, () => "");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 1 watched file diff\(s\) could not be read; of the rest, 1 line\(s\) deleted, 0 moved/);
    expect(out).toContain(`aaaaaaaaaa adopt\n    ${HANDOFF}: NOT MEASURED — ${FAILED_REASON}\n    ${DISPO}: 1 deleted, 0 moved\n      -L2: lost row`);
  });

  it("commit subjects are a label only: without them the measurement stands", () => {
    const out = report(history, { log: new Error("boom") });
    expect(out).toContain(`aaaaaaaaaa (subject unavailable)\n    ${HANDOFF}: 1 deleted, 0 moved\n      -L5: ${RETRACTION}`);
    // Lines that are not "<requested id>\t<subject>" (gpg noise, another commit) are ignored, and a
    // subject's control bytes are printed escaped rather than sent to the terminal.
    const labelled = report(history, { log: `gpg: Signature made\n${sha("f")}\tnot asked for\n${A}\t\x1b[2Jadopt\n` });
    expect(labelled).toContain("aaaaaaaaaa \\x1b[2Jadopt\n");
    expect(labelled).not.toMatch(/gpg|not asked for/);
  });
});

describe("boundedGit — every git process is bounded, and so is the run", () => {
  it("caps each call at the per-call limit and at what is left of the run, then starts no more git", () => {
    let clock = 1_000;
    const started = [];
    const git = boundedGit((cmd, args, options) => (started.push({ cmd, args, options }), Buffer.from("ok")), () => clock, 100_000, 30_000);
    git(["a"]);
    clock += 80_000;
    git(["b"], "stdin");
    clock += 20_000;
    expect(() => git(["c"])).toThrow(/time budget is spent/);
    expect(started.map((s) => [s.cmd, s.args[0], s.options.timeout])).toEqual([
      ["git", "a", 30_000],
      ["git", "b", 20_000],
    ]);
    // stdin is opened only for a call that has input to send.
    expect(started.map((s) => [s.options.stdio[0], s.options.input])).toEqual([
      ["ignore", undefined],
      ["pipe", "stdin"],
    ]);
    expect([CALL_MS, RUN_MS]).toEqual([30_000, 120_000]);
  });

  it("once the run's budget is spent, what is still unread is NOT MEASURED — never clean, never waited for", () => {
    let clock = 0;
    const answers = scripted([{ sha: sha("a"), subject: "adopt", touches: [touch(HANDOFF, adoptionHunks), touch(DISPO, ["@@ -2 +1,0 @@", "-lost row"])] }]);
    const spawn = (_cmd, args, options) => {
      const out = answers(args, options.input);
      if (args.includes("--stdin") && args.includes("diff-tree")) clock += RUN_MS; // the tree scan used up the run
      return out;
    };
    const out = run(["r"], boundedGit(spawn, () => clock), () => "");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 2 watched file diff\(s\) could not be read; of the rest, 0 line\(s\) deleted, 0 moved/);
    expect(out).toContain(`aaaaaaaaaa (subject unavailable)\n    ${HANDOFF}: NOT MEASURED — ${FAILED_REASON}\n    ${DISPO}: NOT MEASURED — ${FAILED_REASON}`);
    expect(kinds(answers)).toEqual(["rev-list", "scan"]);
  });
});

describe("CLI smoke against the real tree", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const SCRIPT = join(root, "scripts", "adoption-deletions.mjs");
  // Every CLI child is bounded, and every test that waits on one carries GIT_SPAWN_TIMEOUT_MS: a run
  // starts one git process per changed watched file per parent on top of its fixed four, so its cost
  // follows the history under test, not the suite-wide testTimeout.
  const CLI_TIMEOUT_MS = 30_000;

  it("prints one verdict line — measured or NOT MEASURED — and exits 0", () => {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    expect(out).toMatch(/^adoption-deletions: (NOT MEASURED|.* — (measured|\d+ commit))/);
  }, GIT_SPAWN_TIMEOUT_MS);

  // One temp repo shared by the config/env cases below: 5 git spawns to build it. Each CLI run is its
  // own process and starts 7 more for this range (rev-list, rev-parse, the tree scan, three file
  // patches, the subject lookup).
  describe("temp repo: config and env that once turned a deletion into a clean pass", () => {
    let repo;
    let env;
    const cli = (cwd, extraEnv) =>
      execFileSync(process.execPath, [SCRIPT, "HEAD~2..HEAD"], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: CLI_TIMEOUT_MS });
    // GIT_CONFIG_* env triples add config without a spawn.
    const config = (pairs) =>
      Object.fromEntries([
        ["GIT_CONFIG_COUNT", String(pairs.length)],
        ...pairs.flatMap(([k, v], i) => [
          [`GIT_CONFIG_KEY_${i}`, k],
          [`GIT_CONFIG_VALUE_${i}`, v],
        ]),
      ]);
    const DISPO_RETRACTION = "  - RETRACTED: #300 is still open.";
    const expectDeletionAndUtf16 = (out) => {
      expect(out).toContain(`-L2: ${RETRACTION}`);
      expect(out).toContain(`-L4: ${DISPO_RETRACTION}`);
      expect(out).not.toContain("no commit touches");
      // The UTF-16 rewrite commit is NOT MEASURED, so the run as a whole is not a clean pass.
      expect(out).toMatch(/^adoption-deletions: NOT MEASURED/);
      expect(out).toMatch(/utf-16 rewrite\n    docs\/SESSION_HANDOFF\.md: NOT MEASURED/);
    };

    beforeAll(() => {
      repo = mkdtempSync(join(tmpdir(), "adoption-deletions-"));
      // A git hook's GIT_DIR / GIT_INDEX_FILE would point both git and the CLI back at this checkout.
      const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_LITERAL_PATHSPECS, ...inherited } = process.env;
      env = {
        ...inherited,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(repo, "absent-global-gitconfig"),
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      };
      const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe", timeout: CLI_TIMEOUT_MS });
      mkdirSync(join(repo, "docs"));
      const doc = join(repo, "docs", "SESSION_HANDOFF.md");
      const dispo = join(repo, "docs", "BRANCH_DISPOSITIONS.md");
      writeFileSync(doc, `keep\n${RETRACTION}\n`);
      // The second watched doc carries the suppressBlankEmpty case: a blank line between an added row
      // and a dropped retraction, so interHunkContext merges them across a "" context line.
      writeFileSync(dispo, `# Dispositions\n- row A\n\n${DISPO_RETRACTION}\n- row B\n`);
      git("init", "-q");
      git("add", "docs");
      git("commit", "-q", "-m", "seed");
      writeFileSync(doc, "keep\n");
      writeFileSync(dispo, "# Dispositions\n- row A\n- row A2\n\n- row B\n");
      git("commit", "-q", "-a", "-m", "adopt");
      // A PowerShell `>` rewrite: UTF-16LE with a BOM, so git classes the new blob as binary.
      writeFileSync(doc, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("keep\n", "utf16le")]));
      git("commit", "-q", "-a", "-m", "utf-16 rewrite");
      writeFileSync(join(repo, "hide.attributes"), "*.md diff=hide\n");
    }, GIT_SPAWN_TIMEOUT_MS);

    afterAll(() => {
      if (repo) rmSync(repo, { recursive: true, force: true });
    });

    it("anchors the watched paths at the repo root, so a run from docs/ still lists the deletion — even under diff.relative=true", () => {
      expectDeletionAndUtf16(cli(join(repo, "docs"), config([["diff.relative", "true"]])));
    }, GIT_SPAWN_TIMEOUT_MS);

    it("ignores a user's textconv (core.attributesFile `*.md diff=hide` + diff.hide.textconv) that empties the patch", () => {
      const textconv = config([
        ["core.attributesFile", join(repo, "hide.attributes")],
        ["diff.hide.textconv", "true"],
      ]);
      expectDeletionAndUtf16(cli(repo, textconv));
    }, GIT_SPAWN_TIMEOUT_MS);

    it("keeps :(top) magic under GIT_LITERAL_PATHSPECS=1", () => {
      expectDeletionAndUtf16(cli(repo, { GIT_LITERAL_PATHSPECS: "1" }));
    }, GIT_SPAWN_TIMEOUT_MS);

    it("still reads commit subjects under i18n.logOutputEncoding=UTF-16", () => {
      expectDeletionAndUtf16(cli(repo, config([["i18n.logOutputEncoding", "UTF-16"]])));
    }, GIT_SPAWN_TIMEOUT_MS);

    it("still lists a deletion after a blank context line under diff.suppressBlankEmpty (+ interHunkContext or GIT_DIFF_OPTS)", () => {
      const blank = [["diff.suppressBlankEmpty", "true"]];
      expectDeletionAndUtf16(cli(repo, config([...blank, ["diff.interHunkContext", "1"]])));
      expectDeletionAndUtf16(cli(repo, { ...config(blank), GIT_DIFF_OPTS: "-u3" }));
    }, GIT_SPAWN_TIMEOUT_MS);
  });
});

// BEGIN review-6028531083 end-to-end block. Its bytes are run unchanged against the script before
// and after the repair, so a case that fails before and passes after is the repair's own evidence.
// Each case asserts the observable behavior first (a deleted line listed, no invented commit, no
// false "moved", an unknown that names its entry mode) and the report layout only after that.
describe("review 6028531083 — adversarial histories, end to end through the CLI", () => {
  const SCRIPT = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "scripts", "adoption-deletions.mjs");
  const RET = "  - RETRACTED: #300 is still open.";
  const DOC = `keep 1\nkeep 2\nkeep 3\nkeep 4\n${RET}\nkeep 6\n`;
  // A document line shaped like the marker the first design split commits on: NUL + "commit <sha> <subject>".
  const FORGED_SHA = "f".repeat(40);
  const FORGED = Buffer.concat([Buffer.from([0]), Buffer.from(`commit ${FORGED_SHA} routine sync`)]);
  const bytes = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
  const FORGED_DISPO = bytes("# Dispositions\n", FORGED, "\n- row A\n- row B\n- row C\n- row D\n");
  // Every child process is bounded: one CLI run per case, well inside the case's own timeout.
  const CHILD_TIMEOUT_MS = 30_000;

  // One history per case, all in one repository built by a single `git fast-import` (two git
  // processes in all). Each entry: [mode, path, content]; null content deletes the path, and a
  // 160000 entry's content is the commit it links to.
  const COMMITS = [
    // Finding 1 — a side branch deletes the retraction, and the merge resolves the file back to its first parent's copy.
    { name: "a-base", files: [["100644", HANDOFF, DOC], ["100644", "other.txt", "o\n"]] },
    { name: "a-first", from: "a-base", files: [["100644", "other.txt", "o2\n"]] },
    { name: "a-side", from: "a-base", msg: "side branch drops the retraction", files: [["100644", HANDOFF, DOC.replace(`${RET}\n`, "")]] },
    { name: "a-merge", from: "a-first", merge: ["a-side"], msg: "merge resolved back to the first parent", files: [["100644", HANDOFF, DOC]] },
    // Finding 1 — a three-parent merge keeps its first parent's copy and so drops a line only its third parent has.
    { name: "b-base", files: [["100644", HANDOFF, "keep\n"], ["100644", "o.txt", "o\n"]] },
    { name: "b-p1", from: "b-base", files: [["100644", "o.txt", "1\n"]] },
    { name: "b-p2", from: "b-base", files: [["100644", "p2.txt", "2\n"]] },
    { name: "b-p3", from: "b-base", msg: "third parent adds the retraction", files: [["100644", HANDOFF, `keep\n${RET}\n`]] },
    { name: "b-merge", from: "b-p1", merge: ["b-p2", "b-p3"], msg: "octopus keeps the first parent's copy", files: [["100644", HANDOFF, "keep\n"], ["100644", "p2.txt", "2\n"]] },
    // Finding 1 — the same three parents, but the merge adds a line of its own, so its first-parent diff is a readable add.
    { name: "b-merge2", from: "b-p1", merge: ["b-p2", "b-p3"], msg: "octopus adds its own note", files: [["100644", HANDOFF, "keep\nmerged note\n"], ["100644", "p2.txt", "2\n"]] },
    // Finding 2 — one commit, two hunks: the first adds the forged line, a later one drops the retraction.
    { name: "f-base", files: [["100644", DISPO, `# Dispositions\n- row A\n- row B\n- row C\n${RET}\n- row D\n`], ["100644", HANDOFF, "keep\n"]] },
    { name: "f-forged", from: "f-base", msg: "adopt dispositions", files: [["100644", DISPO, FORGED_DISPO], ["100644", HANDOFF, "keep\nnew row\n"]] },
    { name: "f-unforge", from: "f-forged", msg: "drop the odd line", files: [["100644", DISPO, "# Dispositions\n- row A\n- row B\n- row C\n- row D\n"]] },
    { name: "f-forged-only", from: "f-base", msg: "adopt dispositions alone", files: [["100644", DISPO, FORGED_DISPO]] },
    // Finding 3 — the same line with byte 0x96 replaced by 0x92 (neither is valid UTF-8), then moved unchanged.
    { name: "u-base", files: [["100644", HANDOFF, bytes("keep 1\nkeep 2\ncaf", [0x96], " row\ntail\n")]] },
    { name: "u-retype", from: "u-base", msg: "retype one byte", files: [["100644", HANDOFF, bytes("keep 1\nkeep 2\ncaf", [0x92], " row\ntail\n")]] },
    { name: "u-move", from: "u-retype", msg: "move the line up", files: [["100644", HANDOFF, bytes("caf", [0x92], " row\nkeep 1\nkeep 2\ntail\n")]] },
    // Finding 4 — the handoff becomes a symlink holding the same blob; the dispositions path is a submodule link.
    { name: "s-base", files: [["100644", HANDOFF, DOC], ["160000", DISPO, "1".repeat(40)]] },
    { name: "s-symlink", from: "s-base", msg: "handoff becomes a symlink", files: [["120000", HANDOFF, DOC]] },
    { name: "s-gitlink", from: "s-symlink", msg: "bump the dispositions link", files: [["160000", DISPO, "2".repeat(40)]] },
    { name: "s-merge", from: "s-base", merge: ["s-symlink"], msg: "merge keeps the regular handoff", files: [["100644", "m.txt", "m\n"]] },
    // A regular watched doc replaced by a directory of the same name, then a change inside that directory.
    { name: "d-base", files: [["100644", HANDOFF, DOC]] },
    { name: "d-dir", from: "d-base", msg: "handoff becomes a directory", files: [["100644", HANDOFF, null], ["100644", `${HANDOFF}/part.md`, "x\n"]] },
    { name: "d-inside", from: "d-dir", msg: "edit inside the directory", files: [["100644", `${HANDOFF}/part.md`, "y\n"]] },
    // Clean controls — ordinary history must stay measured and quiet.
    { name: "c-base", files: [["100644", HANDOFF, "keep\nrow 1\nrow 2\n"], ["100644", DISPO, "# D\n- a\n"], ["100644", "other.txt", "o\n"]] },
    { name: "c-add", from: "c-base", msg: "add a row", files: [["100644", HANDOFF, "keep\nrow 1\nrow 2\nrow 3\n"]] },
    { name: "c-untouched", from: "c-add", files: [["100644", "other.txt", "o2\n"]] },
    { name: "c-mode", from: "c-untouched", msg: "make it executable", files: [["100755", HANDOFF, "keep\nrow 1\nrow 2\nrow 3\n"]] },
    { name: "c-move", from: "c-mode", msg: "move a row", files: [["100755", HANDOFF, "row 3\nkeep\nrow 1\nrow 2\n"]] },
    { name: "c-left", from: "c-base", files: [["100644", HANDOFF, "keep\nrow 1\nrow 2\nleft\n"]] },
    { name: "c-right", from: "c-base", files: [["100644", DISPO, "# D\n- a\n- right\n"]] },
    { name: "c-merge", from: "c-left", merge: ["c-right"], files: [["100644", DISPO, "# D\n- a\n- right\n"]] },
    { name: "v-base", files: [["100644", HANDOFF, "keep\ncafé — row\ttabbed\n"]] },
    { name: "v-drop", from: "v-base", msg: "drop the café row", files: [["100644", HANDOFF, "keep\n"]] },
  ];

  const importStream = (commits) => {
    const mark = new Map(commits.map((c, i) => [c.name, i + 1]));
    const out = [];
    const push = (s) => out.push(Buffer.isBuffer(s) ? s : Buffer.from(s, "utf8"));
    for (const c of commits) {
      const n = mark.get(c.name);
      const msg = c.msg ?? c.name;
      push(`commit refs/heads/${c.name}\nmark :${n}\ncommitter t <t@t> ${1_700_000_000 + n} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\n`);
      if (c.from) push(`from :${mark.get(c.from)}\n`);
      for (const m of c.merge ?? []) push(`merge :${mark.get(m)}\n`);
      for (const [mode, path, data] of c.files) {
        if (data === null) push(`D ${path}\n`);
        else if (mode === "160000") push(`M 160000 ${data} ${path}\n`);
        else {
          const body = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
          push(`M ${mode} inline ${path}\ndata ${body.length}\n`);
          push(body);
          push("\n");
        }
      }
      push("\n");
    }
    return Buffer.concat(out);
  };

  let repo;
  let env;
  const sha = {};
  const short = (name) => sha[name].slice(0, 10);
  const cli = (range, extraEnv) =>
    execFileSync(process.execPath, [SCRIPT, range], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
  const config = (pairs) =>
    Object.fromEntries([
      ["GIT_CONFIG_COUNT", String(pairs.length)],
      ...pairs.flatMap(([k, v], i) => [
        [`GIT_CONFIG_KEY_${i}`, k],
        [`GIT_CONFIG_VALUE_${i}`, v],
      ]),
    ]);
  // Forces the watched docs to diff as text even with a NUL byte in them (finding 2's precondition).
  const forceText = () => config([["core.attributesFile", join(repo, "force-text.attributes")]]);

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "adoption-deletions-review-"));
    const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_LITERAL_PATHSPECS, GIT_DIFF_OPTS, ...inherited } = process.env;
    env = { ...inherited, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(repo, "absent-global-gitconfig") };
    const git = (args, input) => execFileSync("git", args, { cwd: repo, env, input, stdio: "pipe", timeout: CHILD_TIMEOUT_MS });
    git(["init", "-q"]);
    git(["fast-import", "--quiet", `--export-marks=${join(repo, "marks")}`], importStream(COMMITS));
    for (const line of readFileSync(join(repo, "marks"), "utf8").split("\n").filter(Boolean)) {
      const [mark, id] = line.split(" ");
      sha[COMMITS[Number(mark.slice(1)) - 1].name] = id;
    }
    writeFileSync(join(repo, "force-text.attributes"), "docs/*.md diff\n");
  }, GIT_SPAWN_TIMEOUT_MS);

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("finding 1: a merge that resolved the file back to its first parent is measured against both parents, and the side branch's deletion stays listed", () => {
    const out = cli("a-base..a-merge");
    // Behavior: the side branch's deletion is enumerated, and the merge is measured rather than left unknown.
    expect(out).not.toMatch(/no commit touches/);
    expect(out).toContain(`-L5: ${RET}`);
    expect(out).not.toMatch(/NOT MEASURED/);
    // Layout.
    expect(out).toContain(`${short("a-side")} side branch drops the retraction\n    ${HANDOFF}: 1 deleted, 0 moved\n      -L5: ${RET}`);
    expect(out).toContain(
      `${short("a-merge")} merge resolved back to the first parent\n` +
        `    against parent 1 of 2 (${short("a-first")}): watched docs unchanged\n` +
        `    against parent 2 of 2 (${short("a-side")}): (no lines deleted)`,
    );
    expect(out).toMatch(/^adoption-deletions: a-base\.\.a-merge — 2 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 1: a three-parent merge that keeps its first parent's copy lists the line it drops from its third parent", () => {
    const out = cli("b-base..b-merge");
    // Behavior: the line only the third parent had is listed as deleted, and nothing is left unknown.
    expect(out).toContain(`-L2: ${RET}`);
    expect(out).not.toMatch(/NOT MEASURED/);
    // Layout.
    expect(out).toContain(
      `${short("b-merge")} octopus keeps the first parent's copy\n` +
        `    against parent 1 of 3 (${short("b-p1")}): watched docs unchanged\n` +
        `    against parent 2 of 3 (${short("b-p2")}): watched docs unchanged\n` +
        `    against parent 3 of 3 (${short("b-p3")}):\n` +
        `      ${HANDOFF}: 1 deleted, 0 moved\n` +
        `        -L2: ${RET}`,
    );
    expect(out).toMatch(/^adoption-deletions: b-base\.\.b-merge — 2 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 1: a merge whose first-parent diff is a readable add still lists the line it drops from its third parent", () => {
    const out = cli("b-base..b-merge2");
    // Behavior: a clean first-parent diff must not stand in for the other two parents.
    expect(out).toContain(`-L2: ${RET}`);
    expect(out).toMatch(/ 1 line\(s\) deleted, 0 moved/);
    // Layout.
    expect(out).toContain(
      `${short("b-merge2")} octopus adds its own note\n` +
        `    against parent 1 of 3 (${short("b-p1")}): (no lines deleted)\n` +
        `    against parent 2 of 3 (${short("b-p2")}): (no lines deleted)\n` +
        `    against parent 3 of 3 (${short("b-p3")}):\n` +
        `      ${HANDOFF}: 1 deleted, 0 moved\n` +
        `        -L2: ${RET}`,
    );
    expect(out).toMatch(/^adoption-deletions: b-base\.\.b-merge2 — 2 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 2: an added line shaped like a commit marker cannot split the commit or hide the retraction a later hunk deletes", () => {
    const out = cli("f-base..f-forged", forceText());
    // Behavior: the retraction is listed, no commit is invented from the document's bytes, nothing is left unread.
    expect(out).toContain(`-L5: ${RET}`);
    expect(out).not.toContain(FORGED_SHA.slice(0, 10));
    expect(out).not.toContain("routine sync");
    expect(out).not.toMatch(/NOT MEASURED/);
    // Layout.
    expect(out).toContain(`${short("f-forged")} adopt dispositions\n    ${DISPO}: 1 deleted, 0 moved\n      -L5: ${RET}`);
    expect(out).toMatch(/^adoption-deletions: f-base\.\.f-forged — 1 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 2: with only that one file changed, the real commit is the one that lists the deleted retraction", () => {
    const out = cli("f-base..f-forged-only", forceText());
    expect(out).toContain(`-L5: ${RET}`);
    expect(out).not.toContain(FORGED_SHA.slice(0, 10));
    expect(out).not.toMatch(/NOT MEASURED/);
    expect(out).toContain(`${short("f-forged-only")} adopt dispositions alone\n    ${DISPO}: 1 deleted, 0 moved\n      -L5: ${RET}`);
    expect(out).toMatch(/^adoption-deletions: f-base\.\.f-forged-only — 1 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 2: deleting such a line lists its full content under its real commit, never as a commit of its own", () => {
    const out = cli("f-forged..f-unforge", forceText());
    // Behavior: no invented commit, and the deleted line's content is shown rather than cut off at the marker.
    expect(out).not.toMatch(new RegExp(`^  ${FORGED_SHA.slice(0, 10)}`, "m"));
    expect(out).toContain(`\\x00commit ${FORGED_SHA} routine sync`);
    expect(out).not.toMatch(/NOT MEASURED/);
    // Layout.
    expect(out).toContain(
      `${short("f-unforge")} drop the odd line\n    ${DISPO}: 1 deleted, 0 moved\n      -L2 [escaped]: \\x00commit ${FORGED_SHA} routine sync`,
    );
    expect(out).toMatch(/^adoption-deletions: f-forged\.\.f-unforge — 1 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 3: two lines that differ only in an invalid UTF-8 byte (0x96 against 0x92) are different lines, not a move", () => {
    const out = cli("u-base..u-retype");
    // Behavior: the deletion is not cancelled as moved.
    expect(out).not.toContain("[moved]");
    expect(out).toMatch(/ 1 line\(s\) deleted, 0 moved/);
    // Layout: the byte that differs is visible.
    expect(out).toContain(`${HANDOFF}: 1 deleted, 0 moved\n      -L3 [escaped]: caf\\x96 row`);
    expect(out).toMatch(/^adoption-deletions: u-base\.\.u-retype — 1 commit\(s\) touch the watched docs; 1 line\(s\) deleted, 0 moved/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("control: the same invalid bytes re-added elsewhere in the file are still a move", () => {
    const out = cli("u-retype..u-move");
    expect(out).toMatch(/^adoption-deletions: u-retype\.\.u-move — 1 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 1 moved/);
    expect(out).toMatch(/\n      -L3 \[moved\]/);
  }, GIT_SPAWN_TIMEOUT_MS);

  it("finding 4: a watched doc that becomes a symlink over the same blob is NOT MEASURED, never a clean or moved-only report", () => {
    const out = cli("s-base..s-symlink");
    // Behavior: unknown, and not explained away as lines that moved.
    expect(out).not.toContain("[moved]");
    expect(out).not.toContain("(no lines deleted)");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(s-base\.\.s-symlink\) — 1 watched file diff\(s\) could not be read/);
    // The unknown names the file and both entry modes.
    expect(out).toContain(`${short("s-symlink")} handoff becomes a symlink\n    ${HANDOFF}: NOT MEASURED — non-regular entry (mode 100644 → 120000)`);
  }, GIT_SPAWN_TIMEOUT_MS);

  describe("finding 4: a submodule link at a watched path is NOT MEASURED, whatever tells git to ignore submodules", () => {
    const expectGitlinkUnknown = (out) => {
      // Behavior: the link is never read as document text, and never clean.
      expect(out).not.toContain("Subproject commit");
      expect(out).not.toContain("(no lines deleted)");
      expect(out).not.toMatch(/no commit touches/);
      expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(s-symlink\.\.s-gitlink\) — 1 watched file diff\(s\) could not be read/);
      // The unknown names the file and its entry mode.
      expect(out).toContain(`${short("s-gitlink")} bump the dispositions link\n    ${DISPO}: NOT MEASURED — non-regular entry (mode 160000 → 160000)`);
    };

    it("with no submodule configuration", () => {
      expectGitlinkUnknown(cli("s-symlink..s-gitlink"));
    }, GIT_SPAWN_TIMEOUT_MS);

    it("under diff.ignoreSubmodules=all", () => {
      expectGitlinkUnknown(cli("s-symlink..s-gitlink", config([["diff.ignoreSubmodules", "all"]])));
    }, GIT_SPAWN_TIMEOUT_MS);

    it("under a .gitmodules entry with ignore = all", () => {
      const gitmodules = join(repo, ".gitmodules");
      writeFileSync(gitmodules, `[submodule "dispositions"]\n\tpath = ${DISPO}\n\turl = ./elsewhere\n\tignore = all\n`);
      try {
        expectGitlinkUnknown(cli("s-symlink..s-gitlink"));
      } finally {
        rmSync(gitmodules, { force: true });
      }
    }, GIT_SPAWN_TIMEOUT_MS);
  });

  it("finding 4: a merge parent whose watched doc is a symlink is NOT MEASURED against that parent, never folded into a clean merge", () => {
    const out = cli("s-symlink..s-merge");
    expect(out).not.toContain("(no lines deleted)");
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(s-symlink\.\.s-merge\) — 1 watched file diff\(s\) could not be read/);
    // The unknown names the parent, the file and both entry modes; the other parent is still measured.
    expect(out).toContain(
      `${short("s-merge")} merge keeps the regular handoff\n` +
        `    against parent 1 of 2 (${short("s-base")}): watched docs unchanged\n` +
        `    against parent 2 of 2 (${short("s-symlink")}):\n` +
        `      ${HANDOFF}: NOT MEASURED — non-regular entry (mode 120000 → 100644)`,
    );
  }, GIT_SPAWN_TIMEOUT_MS);

  describe("controls: a directory at a watched path stays loud", () => {
    it("a regular watched doc replaced by a directory lists every one of its lines as deleted", () => {
      const out = cli("d-base..d-dir");
      expect(out).toMatch(/^adoption-deletions: d-base\.\.d-dir — 1 commit\(s\) touch the watched docs; 6 line\(s\) deleted, 0 moved/);
      expect(out).toContain(`${short("d-dir")} handoff becomes a directory\n    ${HANDOFF}: 6 deleted, 0 moved\n      -L1: keep 1`);
      expect(out).toContain(`\n      -L5: ${RET}`);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a change inside that directory is NOT MEASURED, never a clean report", () => {
      const out = cli("d-dir..d-inside");
      expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(d-dir\.\.d-inside\) — 1 watched file diff\(s\) could not be read/);
      expect(out).toContain(`${short("d-inside")} edit inside the directory\n`);
      expect(out).not.toContain("(no lines deleted)");
      expect(out).not.toMatch(/no commit touches/);
    }, GIT_SPAWN_TIMEOUT_MS);
  });

  describe("clean controls: ordinary history stays measured", () => {
    it("a root commit that creates the watched docs deletes nothing", () => {
      const out = cli("c-base");
      expect(out).toMatch(/^adoption-deletions: c-base — 1 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 0 moved/);
      expect(out).toContain(`${short("c-base")} c-base\n    (no lines deleted)`);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("an add-only commit deletes nothing", () => {
      const out = cli("c-base..c-add");
      expect(out).toMatch(/^adoption-deletions: c-base\.\.c-add — 1 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 0 moved/);
      expect(out).toContain(`${short("c-add")} add a row\n    (no lines deleted)`);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a range that never touches the watched docs says so", () => {
      expect(cli("c-add..c-untouched")).toMatch(/^adoption-deletions: c-add\.\.c-untouched — measured: no commit touches/);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a mode change between regular file modes (100644 to 100755) stays measured", () => {
      const out = cli("c-untouched..c-mode");
      expect(out).toMatch(/^adoption-deletions: c-untouched\.\.c-mode — 1 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 0 moved/);
      expect(out).toContain(`${short("c-mode")} make it executable\n    (no lines deleted)`);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a line moved within the file is marked moved, not deleted", () => {
      const out = cli("c-mode..c-move");
      expect(out).toMatch(/^adoption-deletions: c-mode\.\.c-move — 1 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 1 moved/);
      expect(out).toContain(`${short("c-move")} move a row\n    ${HANDOFF}: 0 deleted, 1 moved\n      -L4 [moved]: row 3`);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a merge that loses nothing against either parent reports no deleted line", () => {
      const out = cli("c-base..c-merge");
      expect(out).toMatch(/^adoption-deletions: c-base\.\.c-merge — 3 commit\(s\) touch the watched docs; 0 line\(s\) deleted, 0 moved/);
      expect(out).not.toMatch(/NOT MEASURED/);
      expect(out).not.toMatch(/-L\d+/);
    }, GIT_SPAWN_TIMEOUT_MS);

    it("a deleted line of valid UTF-8 prints as written, tab included", () => {
      const out = cli("v-base..v-drop");
      expect(out).toContain(`${short("v-drop")} drop the café row\n    ${HANDOFF}: 1 deleted, 0 moved\n      -L2: café — row\ttabbed`);
      expect(out).not.toContain("[escaped]");
    }, GIT_SPAWN_TIMEOUT_MS);
  });
});
// END review-6028531083 end-to-end block
