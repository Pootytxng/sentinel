// Guard 1 of #322: deletion-aware adoption of the two living handoff docs.
//
// When a lane takes docs/SESSION_HANDOFF.md or docs/BRANCH_DISPOSITIONS.md wholesale from another
// lane, every gate reads the RESULTING file and goes green. #322's second instance is why that is not
// enough: a copy can carry every row key the other copy has and still delete content — there, a
// retraction of a false statement that the adopted copy could not contain because it predated it.
// Row keys measure the superset; only the removed lines measure the loss.
//
// So this prints, for every commit in a range that touches either file, the exact lines that commit
// deletes, and marks the ones whose identical text the same commit re-adds elsewhere in the file
// (a move, not a loss). It prints only: it never blocks a push and always exits 0.
//
// Honest measurement: with no merge base (CI fetches --depth=1) or no readable history it prints an
// explicit "not measured" line instead of a clean pass — a silent pass is exactly #322's failure.
// The same holds per file: a watched doc whose diff git reports as binary (a PowerShell `>` rewrite
// to UTF-16 puts NUL bytes in it) yields no hunks, so it is reported NOT MEASURED, never "no lines
// deleted". `--text` is deliberately not used: NUL bytes in the patch could collide with COMMIT_MARK.
//
// Usage: node scripts/adoption-deletions.mjs [<range>]   (default: $(git merge-base origin/main HEAD)..HEAD)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WATCHED = Object.freeze(["docs/SESSION_HANDOFF.md", "docs/BRANCH_DISPOSITIONS.md"]);

// A line that begins with NUL cannot be a diff line, so it cannot be forged by document content.
const COMMIT_MARK = "\0commit ";
export const LOG_FORMAT = "%x00commit %H %s";

const BINARY = /^Binary files (.+) and (.+) differ$/;
export const BINARY_REASON = "binary diff (likely an encoding change, e.g. a UTF-16 rewrite) — its deletions cannot be read";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function unquote(path) {
  // git quotes paths with unusual bytes; the watched paths never need it, so a plain strip suffices.
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

// Parse unified-diff text (one patch or many concatenated) into per-file removed/added lines.
// Hunk line counts are tracked, so a removed line whose text is "--- x" or "diff --git" is still
// read as content rather than as a header.
export function parseDiff(text) {
  const files = new Map();
  let current = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  const entry = (path) => {
    if (!files.has(path)) files.set(path, { removed: [], added: [], binary: false });
    return files.get(path);
  };
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("-")) {
        current?.removed.push({ line: oldNo++, text: line.slice(1) });
        oldLeft--;
        continue;
      }
      if (line.startsWith("+")) {
        current?.added.push({ line: newNo++, text: line.slice(1) });
        newLeft--;
        continue;
      }
      if (line.startsWith(" ")) {
        oldNo++;
        newNo++;
        oldLeft--;
        newLeft--;
        continue;
      }
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      // Anything else ends the hunk early (malformed or truncated input); fall through to headers.
      oldLeft = newLeft = 0;
    }
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = m ? entry(unquote(m[1])) : null;
      continue;
    }
    const bin = BINARY.exec(line);
    if (bin) {
      // Marks the file under its "diff --git" path; when that header was missing, falls back to the paths the line names.
      if (current) current.binary = true;
      else
        for (const [p, pre] of [[bin[1], "a/"], [bin[2], "b/"]])
          if (p !== "/dev/null") entry(unquote(p).replace(new RegExp(`^${pre}`), "")).binary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      // Files a rename's hunks under the OLD path. That is correct only because run() passes
      // --no-renames, so git never emits a rename pair here; drop that flag and this must key on "+++".
      const p = line.slice(4);
      if (p !== "/dev/null") {
        current = entry(unquote(p).replace(/^a\//, ""));
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      if (p !== "/dev/null" && !current) {
        current = entry(unquote(p).replace(/^b\//, ""));
      }
      continue;
    }
    const h = HUNK.exec(line);
    if (h) {
      oldNo = Number(h[1]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newNo = Number(h[3]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
    }
  }
  return files;
}

// Removed lines of the watched files, each marked `moved` when the same patch re-adds identical text
// to the same file (matched as a multiset, so two deletions of a line re-added once leave one lost).
export function collectDeletions(diffText, watched = WATCHED) {
  const parsed = parseDiff(diffText);
  const out = [];
  for (const file of watched) {
    const f = parsed.get(file);
    if (!f) continue;
    if (f.binary) {
      out.push({ file, lines: [], notMeasured: BINARY_REASON });
      continue;
    }
    if (f.removed.length === 0) continue;
    const pool = new Map();
    for (const a of f.added) pool.set(a.text, (pool.get(a.text) ?? 0) + 1);
    const lines = f.removed.map((r) => {
      const n = pool.get(r.text) ?? 0;
      if (n > 0) pool.set(r.text, n - 1);
      return { ...r, moved: n > 0 };
    });
    out.push({ file, lines });
  }
  return out;
}

// Split `git log -p --format=<LOG_FORMAT>` output into per-commit patches.
export function splitLog(logText) {
  const commits = [];
  for (const chunk of logText.split(COMMIT_MARK)) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const head = nl === -1 ? chunk : chunk.slice(0, nl);
    const sp = head.indexOf(" ");
    commits.push({
      sha: sp === -1 ? head : head.slice(0, sp),
      subject: sp === -1 ? "" : head.slice(sp + 1),
      patch: nl === -1 ? "" : chunk.slice(nl + 1),
    });
  }
  return commits;
}

export function analyzeLog(logText, watched = WATCHED) {
  return splitLog(logText)
    .map((c) => ({ sha: c.sha, subject: c.subject, files: collectDeletions(c.patch, watched) }))
    .filter((c) => c.files.length > 0 || /\S/.test(c.patch));
}

export function notMeasured(range, reason) {
  return `adoption-deletions: NOT MEASURED (${range}) — ${reason}. This is not a clean pass; review deletions to ${WATCHED.join(" / ")} by hand.`;
}

export function formatReport(range, commits) {
  const out = [];
  if (commits.length === 0) {
    out.push(`adoption-deletions: ${range} — measured: no commit touches ${WATCHED.join(" or ")}.`);
    return out.join("\n");
  }
  let lost = 0;
  let moved = 0;
  let unmeasured = 0;
  for (const c of commits)
    for (const f of c.files) {
      if (f.notMeasured) unmeasured++;
      for (const l of f.lines) l.moved ? moved++ : lost++;
    }
  if (unmeasured) {
    out.push(
      `adoption-deletions: NOT MEASURED (${range}) — ${unmeasured} watched file diff(s) could not be read; ` +
        `of the rest, ${lost} line(s) deleted, ${moved} moved. This is not a clean pass; review the unmeasured files by hand.`,
    );
  } else {
    out.push(
      `adoption-deletions: ${range} — ${commits.length} commit(s) touch the watched docs; ` +
        `${lost} line(s) deleted, ${moved} moved within the file. Review every deleted line before adopting.`,
    );
  }
  for (const c of commits) {
    out.push(`  ${c.sha.slice(0, 10)} ${c.subject}`);
    if (c.files.length === 0) {
      out.push("    (no lines deleted)");
      continue;
    }
    for (const f of c.files) {
      if (f.notMeasured) {
        out.push(`    ${f.file}: NOT MEASURED — ${f.notMeasured}`);
        continue;
      }
      const fl = f.lines.filter((l) => !l.moved).length;
      out.push(`    ${f.file}: ${fl} deleted, ${f.lines.length - fl} moved`);
      for (const l of f.lines) out.push(`      -L${l.line}${l.moved ? " [moved]" : ""}: ${l.text}`);
    }
  }
  return out.join("\n");
}

// A shallow clone's graft points: commits whose parents are absent. A range that reaches one was
// cut short by the clone, not by the history, so its answer is partial.
export function truncatedAt(revList, shallowList) {
  const cut = new Set(shallowList.split(/\s+/).filter(Boolean));
  return revList.split(/\s+/).filter((sha) => cut.has(sha));
}

const readShallow = (git) => {
  const path = git(["rev-parse", "--git-path", "shallow"]).trim();
  return path && existsSync(path) ? readFileSync(path, "utf8") : "";
};

// `git` is injectable: (args) => stdout string, throwing on failure. `shallow` returns the shallow
// file's contents ("" when not shallow). Never throws itself.
export function run(argv, git, shallow = () => readShallow(git)) {
  let range = argv[0];
  if (!range) {
    let base = "";
    try {
      base = git(["merge-base", "origin/main", "HEAD"]).trim();
    } catch {
      base = "";
    }
    if (!base) return notMeasured("origin/main...HEAD", "no merge base / shallow history");
    range = `${base}..HEAD`;
  }
  let log;
  try {
    log = git([
      "log",
      "-p",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--diff-merges=first-parent",
      `--format=${LOG_FORMAT}`,
      range,
      "--",
      // :(top) anchors each path at the repository root: a bare pathspec is cwd-relative, so run from
      // docs/ it matched nothing and printed a false "no commit touches" clean pass.
      ...WATCHED.map((path) => `:(top)${path}`),
    ]);
  } catch (e) {
    const shallow = /shallow|unknown revision|bad revision|ambiguous argument/i.test(String(e?.stderr ?? e?.message ?? e));
    return notMeasured(range, shallow ? "no merge base / shallow history" : "git log failed");
  }
  try {
    const cut = truncatedAt(git(["rev-list", range]), shallow());
    if (cut.length) return notMeasured(range, `shallow history: the range reaches the clone boundary at ${cut[0].slice(0, 10)}`);
  } catch {
    return notMeasured(range, "could not check for a shallow-history boundary");
  }
  return formatReport(range, analyzeLog(log));
}

const realGit = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(run(process.argv.slice(2), realGit));
  process.exitCode = 0;
}
