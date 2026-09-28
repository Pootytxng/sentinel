import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LOG_FORMAT,
  UNREADABLE_REASON,
  WATCHED,
  analyzeLog,
  collectDeletions,
  formatReport,
  parseDiff,
  rawTouched,
  run,
  splitLog,
  truncatedAt,
} from "./adoption-deletions.mjs";

// Guard 1 of #322. Everything below is fed synthetic diff text through pure functions; the one
// smoke run at the end spawns the CLI against the real tree (at most four git processes).

const HANDOFF = "docs/SESSION_HANDOFF.md";
const DISPO = "docs/BRANCH_DISPOSITIONS.md";

const patch = (file, hunks) =>
  [`diff --git a/${file} b/${file}`, "index 1111111..2222222 100644", `--- a/${file}`, `+++ b/${file}`, ...hunks].join(
    "\n",
  );

// #322 instance 2, reduced: both copies carry the same row keys (A, B), but the checkout being
// replaced also carries a retraction under row B that the adopted copy predates.
const RETRACTION = "  - RETRACTED 2026-09-01: the earlier claim that #300 landed was false; it is still open.";
const adoption = patch(HANDOFF, [
  "@@ -3,4 +3,3 @@",
  " | A | lane-a | open |",
  " | B | lane-b | landed |",
  `-${RETRACTION}`,
  " | C | lane-c | open |",
]);

const fake = (answers) => (args) => {
  // Skip global options such as --no-literal-pathspecs and `-c <key=value>` pairs.
  const key = args.find((a, i) => !a.startsWith("--") && a !== "-c" && args[i - 1] !== "-c");
  const a = answers[key];
  if (a instanceof Error) throw a;
  if (a === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
  return typeof a === "function" ? a(args) : a;
};

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

describe("per-commit log analysis", () => {
  // A later commit restoring the line must not hide the commit that deleted it.
  const log = [
    "\0commit aaaaaaaaaaaa adopt handoff wholesale",
    adoption,
    "\0commit bbbbbbbbbbbb restore the retraction",
    patch(HANDOFF, ["@@ -4,0 +5 @@", `+${RETRACTION}`]),
  ].join("\n");

  it("uses a NUL-prefixed commit marker that document content cannot forge", () => {
    expect(LOG_FORMAT.startsWith("%x00commit ")).toBe(true);
    expect(splitLog(log).map((c) => c.sha)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("prints each touching commit's own deletions, including a commit that deletes nothing", () => {
    const out = formatReport("r", analyzeLog(log));
    expect(out).toContain("1 line(s) deleted, 0 moved");
    expect(out).toContain(`-L5: ${RETRACTION}`);
    expect(out).toContain("bbbbbbbbbb restore the retraction\n    (no lines deleted)");
  });

  it("says measured-and-empty explicitly when no commit touches the docs", () => {
    expect(formatReport("r", analyzeLog(""))).toMatch(/measured: no commit touches/);
  });
});

describe("binary diff of a watched doc — NOT MEASURED, never a false clean", () => {
  // A PowerShell `>` / Out-File rewrite writes UTF-16 with NUL bytes; git then prints no hunks.
  const binary = (file) =>
    [`diff --git a/${file} b/${file}`, "index 1111111..2222222 100644", `Binary files a/${file} and b/${file} differ`].join("\n");
  const log = [
    "\0commit cccccccccccc re-save handoff from PowerShell",
    binary(HANDOFF),
    "\0commit dddddddddddd adopt dispositions",
    patch(DISPO, ["@@ -2 +1,0 @@", "-lost row"]),
  ].join("\n");

  it("marks the binary file NOT MEASURED instead of listing zero deletions", () => {
    expect(parseDiff(binary(HANDOFF)).get(HANDOFF).binary).toBe(true);
    expect(collectDeletions(binary(HANDOFF))).toEqual([{ file: HANDOFF, lines: [], notMeasured: expect.stringMatching(/binary diff/) }]);
  });

  it("prints the commit's file as NOT MEASURED with the reason, and the summary is not a clean pass", () => {
    const out = formatReport("r", analyzeLog(log));
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

describe("a listed commit whose watched diff cannot be read — NOT MEASURED, never dropped", () => {
  // `git log` is pathspec-limited, so every listed commit touches a watched doc. A user's textconv
  // (or any config that hides the patch) leaves such a commit with no watched header at all.
  const raw = (file) => `:100644 100644 1111111 2222222 M\t${file}`;
  const log = [
    "\0commit eeeeeeeeeeee textconv hid the patch",
    "",
    "\0commit ffffffffffff raw names the doc, no header",
    "",
    raw(HANDOFF),
    "",
    "\0commit 111111111111 header under a cwd-relative path",
    patch("SESSION_HANDOFF.md", ["@@ -2 +1,0 @@", "-lost"]),
    "\0commit 222222222222 one of two touched docs hidden",
    raw(HANDOFF),
    raw(DISPO),
    patch(DISPO, ["@@ -2 +1,0 @@", "-lost row"]),
    "\0commit 333333333333 mode-only change",
    raw(HANDOFF),
    `diff --git a/${HANDOFF} b/${HANDOFF}`,
    "old mode 100644",
    "new mode 100755",
  ].join("\n");

  it("keeps every commit and marks the unreadable ones NOT MEASURED, whole-commit or per file", () => {
    const commits = analyzeLog(log);
    expect(commits.map((c) => c.sha.slice(0, 4))).toEqual(["eeee", "ffff", "1111", "2222", "3333"]);
    expect(commits[0].notMeasured).toBe(UNREADABLE_REASON);
    expect(commits[1].files).toEqual([{ file: HANDOFF, lines: [], notMeasured: UNREADABLE_REASON }]);
    expect(commits[2].notMeasured).toBe(UNREADABLE_REASON);
    expect(commits[3].files.map((f) => [f.file, f.notMeasured ?? null])).toEqual([
      [HANDOFF, UNREADABLE_REASON],
      [DISPO, null],
    ]);
    expect(commits[4].notMeasured).toBeUndefined();
    expect(commits[4].files).toEqual([]);
  });

  it("prints NOT MEASURED for them and never '(no lines deleted)'; a mode-only change stays measured", () => {
    const out = formatReport("r", analyzeLog(log));
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\) — 4 watched file diff\(s\) could not be read/);
    expect(out).not.toMatch(/no commit touches/);
    expect(out).toContain(`eeeeeeeeee textconv hid the patch\n    NOT MEASURED — ${UNREADABLE_REASON}`);
    expect(out).toContain(`ffffffffff raw names the doc, no header\n    ${HANDOFF}: NOT MEASURED`);
    expect(out).toContain(`1111111111 header under a cwd-relative path\n    NOT MEASURED`);
    expect(out).toContain("-L2: lost row");
    for (const sha of ["eeeeeeeeee", "ffffffffff", "1111111111", "2222222222"])
      expect(out).not.toMatch(new RegExp(`${sha}[^\n]*\n\\s+\\(no lines deleted\\)`));
    expect(out).toContain("3333333333 mode-only change\n    (no lines deleted)");
  });

  it("marks a watched header with no hunks NOT MEASURED, but keeps an empty-file create measured", () => {
    const bare = [`diff --git a/${HANDOFF} b/${HANDOFF}`, "index 1111111..2222222 100644"].join("\n");
    expect(collectDeletions(bare)).toEqual([{ file: HANDOFF, lines: [], notMeasured: UNREADABLE_REASON }]);
    const empty = [`diff --git a/${DISPO} b/${DISPO}`, "new file mode 100644", "index 0000000..e69de29"].join("\n");
    expect(collectDeletions(empty)).toEqual([]);
  });

  it("reads raw paths only before the first diff header, so document content cannot add one", () => {
    const text = [raw(DISPO), patch(DISPO, ["@@ -0,0 +1 @@", `+${raw(HANDOFF)}`])].join("\n");
    expect([...rawTouched(text)]).toEqual([DISPO]);
    expect(collectDeletions(text)).toEqual([]);
  });
});

describe("hunks parsed by their @@ counts — a blank context line or a count mismatch is never a false clean", () => {
  // diff.suppressBlankEmpty=true + diff.interHunkContext=1 merges the two -U0 hunks below across the
  // blank line and prints that context line as "" rather than " ". The retraction after it is real.
  const blankCtx = patch(HANDOFF, ["@@ -3,2 +3,2 @@", "+- row A2", "", `-${RETRACTION}`]);

  it("reads a pure \"\" line as context while counts remain, so the deletion after it is kept", () => {
    const f = parseDiff(blankCtx).get(HANDOFF);
    expect(f.removed).toEqual([{ line: 4, text: RETRACTION }]);
    expect(f.added).toEqual([{ line: 3, text: "- row A2" }]);
    const out = formatReport("r", analyzeLog(`\0commit ${"b".repeat(40)} add A2, drop retraction\n${blankCtx}\n`));
    expect(out).toContain(`-L4: ${RETRACTION}`);
    expect(out).not.toContain("(no lines deleted)");
    expect(out).not.toMatch(/NOT MEASURED/);
  });

  it("marks a hunk whose body does not consume exactly its header counts NOT MEASURED", () => {
    // Body ends one line short of "-3,2 +3,2" (truncated), and a second hunk is cut off by the next header.
    const shortBody = patch(HANDOFF, ["@@ -3,2 +3,2 @@", "+- row A2", `-${RETRACTION}`]);
    const cutByHeader = [patch(DISPO, ["@@ -1,3 +1,1 @@", "-gone"]), patch(HANDOFF, ["@@ -9 +9 @@", "-x", "+y"])].join("\n");
    for (const [text, file] of [
      [shortBody, HANDOFF],
      [cutByHeader, DISPO],
    ]) {
      const f = collectDeletions(text).find((d) => d.file === file);
      expect(f).toMatchObject({ file, lines: [] });
      expect(f.notMeasured).toMatch(/@@ line counts/);
    }
    // The file after the cut is still read normally.
    expect(collectDeletions(cutByHeader).find((d) => d.file === HANDOFF).lines).toEqual([{ line: 9, text: "x", moved: false }]);
    const out = formatReport("r", analyzeLog(`\0commit ${"c".repeat(40)} short hunk\n${shortBody}\n`));
    expect(out).toMatch(/^adoption-deletions: NOT MEASURED \(r\)/);
    expect(out).toMatch(/docs\/SESSION_HANDOFF\.md: NOT MEASURED — .*@@ line counts/);
    expect(out).not.toContain("(no lines deleted)");
  });
});

describe("run — honest measurement, never a silent pass, never blocks", () => {
  const LOG = `\0commit ${"a".repeat(40)} adopt\n${adoption}\n`;

  it("prints NOT MEASURED when there is no merge base (CI --depth=1)", () => {
    const out = run([], fake({ "merge-base": new Error("fatal: no merge base") }));
    expect(out).toMatch(/NOT MEASURED .*no merge base \/ shallow history/);
    expect(out).toMatch(/not a clean pass/);
  });

  it("prints NOT MEASURED when git log cannot resolve the range", () => {
    const err = Object.assign(new Error("x"), { stderr: "fatal: bad revision 'abc~1..HEAD'" });
    expect(run(["abc~1..HEAD"], fake({ log: err }))).toMatch(/NOT MEASURED .*shallow history/);
  });

  it("prints NOT MEASURED when the range reaches the shallow clone boundary", () => {
    const git = fake({ "merge-base": "base\n", log: LOG, "rev-list": "c1\nc2\ngraft\n" });
    expect(run([], git, () => "graft\n")).toMatch(/NOT MEASURED .*clone boundary at graft/);
    expect(truncatedAt("c1\nc2\n", "graft\n")).toEqual([]);
  });

  it("reports deletions over the default merge-base range when history is complete", () => {
    let logArgs;
    const git = fake({
      "merge-base": "base\n",
      log: (args) => ((logArgs = args), LOG),
      "rev-list": "c1\n",
    });
    const out = run([], git, () => "");
    expect(logArgs).toContain("base..HEAD");
    expect(logArgs).toContain("--diff-merges=first-parent");
    expect(logArgs).toContain("--no-relative");
    expect(logArgs.slice(0, 5)).toEqual(["--no-literal-pathspecs", "-c", "diff.suppressBlankEmpty=false", "log", "-p"]);
    expect(logArgs).toContain("--no-show-signature");
    expect(logArgs).toContain("--no-textconv");
    expect(logArgs).toContain("--raw");
    expect(logArgs.slice(-2)).toEqual(WATCHED.map((path) => `:(top)${path}`));
    expect(out).toContain(`-L5: ${RETRACTION}`);
  });
});

describe("CLI smoke against the real tree", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const SCRIPT = join(root, "scripts", "adoption-deletions.mjs");

  it("prints one verdict line — measured or NOT MEASURED — and exits 0", () => {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toMatch(/^adoption-deletions: (NOT MEASURED|.* — (measured|\d+ commit))/);
  });

  // One temp repo shared by the config/env cases below: 5 git spawns to build it, then each CLI run
  // adds its own log, rev-list and rev-parse (20 in all), so the block carries its own timeout
  // instead of leaning on the suite-wide testTimeout.
  const GIT_SPAWN_TIMEOUT_MS = 60_000;

  describe("temp repo: config and env that once turned a deletion into a clean pass", () => {
    let repo;
    let env;
    const cli = (cwd, extraEnv) =>
      execFileSync(process.execPath, [SCRIPT, "HEAD~2..HEAD"], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
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
      const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
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

    it("still lists a deletion after a blank context line under diff.suppressBlankEmpty (+ interHunkContext or GIT_DIFF_OPTS)", () => {
      const blank = [["diff.suppressBlankEmpty", "true"]];
      expectDeletionAndUtf16(cli(repo, config([...blank, ["diff.interHunkContext", "1"]])));
      expectDeletionAndUtf16(cli(repo, { ...config(blank), GIT_DIFF_OPTS: "-u3" }));
    }, GIT_SPAWN_TIMEOUT_MS);
  });
});
