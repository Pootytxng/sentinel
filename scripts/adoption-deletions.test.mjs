import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LOG_FORMAT,
  WATCHED,
  analyzeLog,
  collectDeletions,
  formatReport,
  parseDiff,
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
  const key = args[0];
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
    const text = patch(DISPO, ["@@ -1,3 +1,1 @@", "-dup", "-dup", "-gone", "@@ -9,0 +8,1 @@", "+dup"]);
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

  // 4 git spawns here plus the CLI's own log, rev-list and rev-parse: 7 in all, so this test carries
  // its own timeout instead of leaning on the suite-wide testTimeout.
  const GIT_SPAWN_TIMEOUT_MS = 60_000;

  it("anchors the watched paths at the repo root, so a run from docs/ still lists the deletion — even under diff.relative=true", () => {
    const repo = mkdtempSync(join(tmpdir(), "adoption-deletions-"));
    // A git hook's GIT_DIR / GIT_INDEX_FILE would point both git and the CLI back at this checkout.
    const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...inherited } = process.env;
    const env = {
      ...inherited,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(repo, "absent-global-gitconfig"),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    };
    const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
    try {
      mkdirSync(join(repo, "docs"));
      const doc = join(repo, "docs", "SESSION_HANDOFF.md");
      writeFileSync(doc, `keep\n${RETRACTION}\n`);
      git("init", "-q");
      git("add", "docs/SESSION_HANDOFF.md");
      git("commit", "-q", "-m", "seed");
      writeFileSync(doc, "keep\n");
      git("commit", "-q", "-a", "-m", "adopt");
      // diff.relative=true via the GIT_CONFIG_* env triple (no extra spawn) would make the CLI's diff
      // headers cwd-relative (a/SESSION_HANDOFF.md) unless it passes --no-relative.
      const cliEnv = { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "diff.relative", GIT_CONFIG_VALUE_0: "true" };
      const out = execFileSync(process.execPath, [SCRIPT, "HEAD~1..HEAD"], {
        cwd: join(repo, "docs"),
        env: cliEnv,
        encoding: "utf8",
      });
      expect(out).toContain(`-L2: ${RETRACTION}`);
      expect(out).not.toContain("no commit touches");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, GIT_SPAWN_TIMEOUT_MS);
});
