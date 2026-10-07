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
// deleted".
//
// How a range is read. Each step closes a way the first design could miss a deletion (review 6028531083):
//   1. `git rev-list --parents`, with no pathspec, lists every commit and all of its parents, so no
//      history is simplified away, and a commit is measured against EACH parent: a merge that keeps
//      its first parent's copy of a doc still drops whatever only another parent had.
//   2. One `git diff-tree --stdin --raw -z` scan of the trees says which (commit, parent) pairs change
//      a watched path. That stream carries ids, modes and paths — no document bytes — and must answer
//      every pair once, in order. Each changed file's patch then comes from its own git process, so
//      the process is the frame: no line of a document can pass for a commit boundary. The patch must
//      name that file once, between the two blobs the scan reported.
//   3. Output is read as bytes. Two lines are the same line only when their bytes are (less the line
//      ending), so two different invalid-UTF-8 bytes can no longer compare equal as one replacement
//      character and cancel a deletion as "moved".
//   4. Entry modes are kept. A symlink, submodule link or directory at a watched path is not a
//      document: NOT MEASURED with the modes named, whatever tells git to ignore submodules.
//
// Root invariant: a watched file the scan names for a (commit, parent) pair is measured or printed
// NOT MEASURED — never dropped, never "(no lines deleted)". Every git invocation is hermetic against
// the user's config/env (`--no-literal-pathspecs`, `-c diff.suppressBlankEmpty=false`, `--no-textconv`,
// `--no-ext-diff`, `--no-relative`, `--no-color`, `--ignore-submodules=none`, no GIT_DIFF_OPTS) and
// bounded (CALL_MS each, RUN_MS for the run): a diff git does not produce in time is NOT MEASURED.
// The parser fails safe too: a hunk whose body does not match its @@ counts makes that file NOT MEASURED.
//
// Usage: node scripts/adoption-deletions.mjs [<range>]   (default: $(git merge-base origin/main HEAD)..HEAD)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WATCHED = Object.freeze(["docs/SESSION_HANDOFF.md", "docs/BRANCH_DISPOSITIONS.md"]);

const BINARY = /^Binary files (.+) and (.+) differ$/;
export const BINARY_REASON = "binary diff (likely an encoding change, e.g. a UTF-16 rewrite) — its deletions cannot be read";

export const MALFORMED_REASON = "a hunk did not match its @@ line counts — its deletions cannot be read reliably";

export const UNREADABLE_REASON = "touches a watched doc but its diff could not be read (a diff driver, textconv or config hid it)";

export const FAILED_REASON = "git did not produce its diff (it failed or ran out of time)";

export const DIRECTORY_REASON = "non-regular entry (a directory holds this path) — its deletions cannot be read";

export const nonRegularReason = (oldMode, newMode) =>
  `non-regular entry (mode ${oldMode} → ${newMode}) — a symlink or submodule link is not a document, so its deletions cannot be read`;

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// "index <old blob>..<new blob>[ <mode>]". run() asks for --full-index and checks both ids.
const INDEX = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: \d{6})?$/;

function unquote(path) {
  // git quotes paths with unusual bytes; the watched paths never need it, so a plain strip suffices.
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

// Parse unified-diff text (one patch or many concatenated) into per-file removed/added lines.
// Each hunk is parsed by its @@ header counts, so a removed line whose text is "--- x" or "diff --git"
// is still read as content rather than as a header, and a body that does not consume exactly its
// counts marks the file `malformed` (reported NOT MEASURED) instead of silently losing lines.
// `headers` counts the "diff --git" lines that name the file; `oldOid`/`newOid` come from its index line.
export function parseDiff(text) {
  const files = new Map();
  let current = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let afterHunk = false; // inside a file's hunks: only "diff --git", "@@" or "\" may follow a spent hunk
  const entry = (path) => {
    if (!files.has(path))
      files.set(path, { removed: [], added: [], binary: false, modeLine: false, malformed: false, headers: 0, oldOid: null, newOid: null });
    return files.get(path);
  };
  const short = () => {
    if (current) current.malformed = true;
    oldLeft = newLeft = 0;
  };
  // Lines are "\n"-terminated: the empty tail after a final "\n" is not a line, so it cannot pass for
  // a "" context line and hide a hunk that ended short.
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      // Every body line is read against the @@ counts. "" is a context line while counts remain:
      // diff.suppressBlankEmpty prints a blank context line with no leading space, and ending the
      // hunk there once dropped the "-" line after it — a false "(no lines deleted)".
      const ctx = line === "" || line.startsWith(" ");
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      if (line.startsWith("-") && oldLeft > 0) {
        current?.removed.push({ line: oldNo++, text: line.slice(1) });
        oldLeft--;
        continue;
      }
      if (line.startsWith("+") && newLeft > 0) {
        current?.added.push({ line: newNo++, text: line.slice(1) });
        newLeft--;
        continue;
      }
      if (ctx && oldLeft > 0 && newLeft > 0) {
        oldNo++;
        newNo++;
        oldLeft--;
        newLeft--;
        continue;
      }
      // The body did not consume exactly its header counts: an unknown formatting quirk or truncated
      // input. Fail safe — that file is NOT MEASURED — and fall through to header parsing.
      short();
    } else if (afterHunk && !line.startsWith("diff --git ") && !HUNK.test(line) && !line.startsWith("\\")) {
      // Counts exhausted, yet the hunk body runs on: git never prints a line here that is not the next
      // header, so the body outgrew its @@ counts and lines past them would be skipped. Fail safe.
      if (current) current.malformed = true;
    }
    if (line.startsWith("diff --git ")) {
      afterHunk = false;
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = m ? entry(unquote(m[1])) : null;
      if (current) current.headers++;
      continue;
    }
    if (/^(old|new) mode |^(new|deleted) file mode /.test(line)) {
      // A mode change, or creating/deleting an empty file, is a real change with no hunks.
      if (current) current.modeLine = true;
      continue;
    }
    const index = INDEX.exec(line);
    if (index) {
      if (current) [, current.oldOid, current.newOid] = index;
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
      afterHunk = true;
      oldNo = Number(h[1]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newNo = Number(h[3]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
    }
  }
  if (oldLeft > 0 || newLeft > 0) short(); // input ended inside a hunk
  return files;
}

// Removed lines of the watched files, each marked `moved` when the same patch re-adds identical text
// to the same file (matched as a multiset, so two deletions of a line re-added once leave one lost).
// Takes patch text or an already parsed one. A file with nothing deleted and nothing unread is left out.
export function collectDeletions(diff, watched = WATCHED) {
  const parsed = typeof diff === "string" ? parseDiff(diff) : diff;
  const out = [];
  for (const file of watched) {
    const f = parsed.get(file);
    if (!f) continue;
    if (f.binary) {
      out.push({ file, lines: [], notMeasured: BINARY_REASON });
      continue;
    }
    if (f.malformed) {
      out.push({ file, lines: [], notMeasured: MALFORMED_REASON });
      continue;
    }
    if (f.removed.length === 0) {
      // Under -U0 every content change has a +/- line; a bare header means the hunks were hidden.
      if (f.added.length === 0 && !f.modeLine) out.push({ file, lines: [], notMeasured: UNREADABLE_REASON });
      continue;
    }
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

// git output as a byte string — one char per byte — so nothing is decoded, replaced or merged on the
// way in. (A string from an injected git is taken as UTF-8.) Ids and paths are read as UTF-8 text.
const byteString = (out) => (Buffer.isBuffer(out) ? out : Buffer.from(String(out), "utf8")).toString("latin1");
const utf8 = (out) => (Buffer.isBuffer(out) ? out.toString("utf8") : String(out));

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const escapeByte = (c) => (c === "\\" ? "\\\\" : `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

// A byte string as report text. Printable UTF-8 prints as written. Anything else is `escaped`: control
// bytes (and, when the bytes are not UTF-8 at all, every byte from 0x80 up) print as \xNN, and a
// literal backslash is doubled so the two cannot be confused.
export function render(bytes) {
  let text;
  try {
    text = STRICT_UTF8.decode(Buffer.from(bytes, "latin1"));
  } catch {
    return { text: bytes.replace(/[\\\x00-\x08\x0a-\x1f\x7f-\xff]/g, escapeByte), escaped: true };
  }
  if (!/[\x00-\x08\x0a-\x1f\x7f]/.test(text)) return { text, escaped: false };
  return { text: text.replace(/[\\\x00-\x08\x0a-\x1f\x7f]/g, escapeByte), escaped: true };
}

const OID = "(?:[0-9a-f]{40}|[0-9a-f]{64})";
const REV_LINE = new RegExp(`^${OID}(?: ${OID})*$`);
const RAW = new RegExp(`^:(\\d{6}) (\\d{6}) (${OID}) (${OID}) ([ADMT])$`);
const ABSENT = "000000";
const REGULAR = /^100\d{3}$/;
// A blob with no bytes has no line to delete (its id under SHA-1 and under SHA-256).
const EMPTY_BLOB = new Set(["sha1", "sha256"].map((algo) => createHash(algo).update("blob 0\0").digest("hex")));
// Stands in for a record when the scan names only paths UNDER a watched path.
const INSIDE = Symbol("a directory holds the path");

// `git rev-list --parents`: "<commit> <parent>…" per line, newest first. null if any line is anything else.
function parseRevList(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const rows = [];
  for (const line of lines) {
    if (!REV_LINE.test(line)) return null;
    const [sha, ...parents] = line.split(" ");
    rows.push({ sha, parents });
  }
  return rows;
}

const SCAN_ARGS = [
  // GIT_LITERAL_PATHSPECS=1 in the env would read ":(top)docs/..." as a literal filename that
  // matches nothing, so every commit vanished into a "no commit touches" clean pass.
  "--no-literal-pathspecs",
  "diff-tree",
  // One "<commit> <parent>" line per pair to compare; a line that is a lone "<commit>" is a root.
  "--stdin",
  "-r",
  // Records come from the trees alone, with their entry modes, whatever diff driver is configured.
  "--raw",
  // NUL-terminated tokens and unquoted paths: nothing in the stream needs unescaping.
  "-z",
  // A pair that changes no watched path still prints its commit id, so a missing answer is visible.
  "--always",
  "--root",
  "--no-renames",
  "--no-abbrev",
  // diff.ignoreSubmodules, or `ignore = all` in .gitmodules, would hide a submodule link's update.
  "--ignore-submodules=none",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--",
  // :(top) anchors each path at the repository root: a bare pathspec is cwd-relative, so run from
  // docs/ it matched nothing and printed a false "no commit touches" clean pass.
  ...WATCHED.map((path) => `:(top)${path}`),
];

// The scan's answer, pair by pair: Map<watched file, {oldMode, newMode, oldOid, newOid} | INSIDE>.
// The stream is "<commit>\0" then ":<old mode> <new mode> <old id> <new id> <status>\0<path>\0" per
// changed path. null unless it answers every pair once, in order, with well-formed records for
// watched paths only — a path is read only where a path must stand, so its bytes cannot pass for a record.
function parseScan(text, pairs) {
  const tokens = text.split("\0");
  if (tokens.pop() !== "") return null;
  const answers = [];
  let at = 0;
  for (const { sha, parent } of pairs) {
    if (tokens[at++] !== sha) return null;
    const files = new Map();
    while (at < tokens.length && tokens[at].startsWith(":")) {
      const m = RAW.exec(tokens[at]);
      const path = tokens[at + 1];
      at += 2;
      if (!m || path === undefined) return null;
      const [, oldMode, newMode, oldOid, newOid, status] = m;
      // The status must agree with the modes, and a commit with no parent can only add.
      if ((status === "A") !== (oldMode === ABSENT) || (status === "D") !== (newMode === ABSENT)) return null;
      if (!parent && status !== "A") return null;
      const file = WATCHED.find((w) => path === w || path.startsWith(`${w}/`));
      if (!file) return null;
      if (path !== file) {
        if (!files.has(file)) files.set(file, INSIDE);
      } else if (files.has(file) && files.get(file) !== INSIDE) return null;
      else files.set(file, { oldMode, newMode, oldOid, newOid });
    }
    answers.push(files);
  }
  return at === tokens.length ? answers : null;
}

const PATCH_ARGS = [
  "--no-literal-pathspecs",
  // diff.suppressBlankEmpty=true prints blank context lines as "" (see parseDiff); pin it off.
  "-c",
  "diff.suppressBlankEmpty=false",
  "diff-tree",
  "-p",
  "-U0",
  "--no-color",
  "--no-ext-diff",
  // A user's textconv (core.attributesFile `*.md diff=x` + diff.x.textconv) emptied the patch.
  "--no-textconv",
  "--no-renames",
  // Headers relative to the cwd (a/SESSION_HANDOFF.md from docs/) would match no watched key.
  "--no-relative",
  // Full blob ids on the index line, to check against the scan's.
  "--full-index",
  "--ignore-submodules=none",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

// One file's patch between a commit and one parent, from its own git process. `--text` is deliberately
// not used: a binary diff stays NOT MEASURED rather than being read as lines.
function readPatch(git, file, rec, sha, parent) {
  const unread = (notMeasured) => ({ file, lines: [], notMeasured });
  let parsed;
  try {
    parsed = parseDiff(byteString(git([...PATCH_ARGS, parent, sha, "--", `:(top)${file}`])));
  } catch {
    return unread(FAILED_REASON);
  }
  const f = parsed.get(file);
  // The patch must be the one the scan promised: this file once, between exactly those two blobs,
  // beside nothing but files under a directory that took the path.
  const framed =
    f?.headers === 1 &&
    f.oldOid === rec.oldOid &&
    f.newOid === rec.newOid &&
    [...parsed.keys()].every((path) => path === file || path.startsWith(`${file}/`));
  if (!framed) return unread(UNREADABLE_REASON);
  const [deletions] = collectDeletions(parsed, [file]);
  if (deletions) return deletions;
  // Two different blobs differ in at least one line, so a patch that shows none had its hunks hidden.
  return f.added.length ? null : unread(UNREADABLE_REASON);
}

// What one (commit, parent) pair deletes from one watched file: null when measured and nothing is
// deleted, else { file, lines } or { file, lines: [], notMeasured }.
function fileDeletions(git, patches, file, rec, sha, parent) {
  if (rec === INSIDE) return { file, lines: [], notMeasured: DIRECTORY_REASON };
  const { oldMode, newMode, oldOid, newOid } = rec;
  if (![oldMode, newMode].every((mode) => mode === ABSENT || REGULAR.test(mode)))
    return { file, lines: [], notMeasured: nonRegularReason(oldMode, newMode) };
  // The old side has no line this change could delete: the file is new, was empty, or only changed mode.
  if (oldMode === ABSENT || oldOid === newOid || EMPTY_BLOB.has(oldOid)) return null;
  // The same two blobs at the same path give the same patch, whichever commits they sit in.
  const key = `${file}\0${oldOid}\0${newOid}`;
  if (!patches.has(key)) patches.set(key, readPatch(git, file, rec, sha, parent));
  return patches.get(key);
}

const NO_SUBJECT = "(subject unavailable)";

// Commit subjects are a label only: they are fetched last, and the measurement never depends on them.
function readSubjects(git, shas) {
  const subjects = new Map();
  try {
    const out = git(
      [
        "log",
        "--no-walk=unsorted",
        "--stdin",
        "--no-color",
        // log.showSignature=true would put gpg: lines between the subjects.
        "--no-show-signature",
        // i18n.logOutputEncoding=UTF-16 would re-encode every line.
        "--encoding=UTF-8",
        "--format=%H%x09%s",
      ],
      shas.map((sha) => `${sha}\n`).join(""),
    );
    for (const line of byteString(out).split("\n")) {
      const tab = line.indexOf("\t");
      if (tab !== -1 && shas.includes(line.slice(0, tab))) subjects.set(line.slice(0, tab), line.slice(tab + 1));
    }
  } catch {
    // Reported as NO_SUBJECT.
  }
  return subjects;
}

export function notMeasured(range, reason) {
  return `adoption-deletions: NOT MEASURED (${range}) — ${reason}. This is not a clean pass; review deletions to ${WATCHED.join(" / ")} by hand.`;
}

// commits: [{ sha, subject, parents: [{ sha, touched, files: [{ file, lines, notMeasured? }] }] }],
// one `parents` entry per parent the commit was measured against (a root commit has one, its `sha`
// null). `subject` and each line's `text` are byte strings.
export function formatReport(range, commits) {
  const out = [];
  if (commits.length === 0) {
    out.push(`adoption-deletions: ${range} — measured: no commit touches ${WATCHED.join(" or ")}.`);
    return out.join("\n");
  }
  let lost = 0;
  let moved = 0;
  let unmeasured = 0;
  for (const c of commits) {
    for (const p of c.parents) {
      for (const f of p.files) {
        if (f.notMeasured) unmeasured++;
        for (const l of f.lines) l.moved ? moved++ : lost++;
      }
    }
  }
  // The totals count every listing, so they can exceed the number of distinct lines lost.
  const merges = commits.some((c) => c.parents.length > 1)
    ? " A merge is measured against each of its parents, so one deleted line can be counted more than once: under its own commit, and under the merge against each parent that still had it."
    : "";
  if (unmeasured) {
    out.push(
      `adoption-deletions: NOT MEASURED (${range}) — ${unmeasured} watched file diff(s) could not be read; ` +
        `of the rest, ${lost} line(s) deleted, ${moved} moved. This is not a clean pass; review the unmeasured files by hand.${merges}`,
    );
  } else {
    out.push(
      `adoption-deletions: ${range} — ${commits.length} commit(s) touch the watched docs; ` +
        `${lost} line(s) deleted, ${moved} moved within the file. Review every deleted line before adopting.${merges}`,
    );
  }
  for (const c of commits) {
    out.push(`  ${c.sha.slice(0, 10)} ${render(c.subject).text}`);
    const merge = c.parents.length > 1;
    c.parents.forEach((p, i) => {
      // A merge prints one answer per parent, never fewer: an unchanged parent says so.
      const against = merge ? `    against parent ${i + 1} of ${c.parents.length} (${p.sha.slice(0, 10)}):` : "";
      const pad = merge ? "      " : "    ";
      if (merge && !p.touched) return out.push(`${against} watched docs unchanged`);
      if (p.files.length === 0) return out.push(merge ? `${against} (no lines deleted)` : "    (no lines deleted)");
      if (merge) out.push(against);
      for (const f of p.files) {
        if (f.notMeasured) {
          out.push(`${pad}${f.file}: NOT MEASURED — ${f.notMeasured}`);
          continue;
        }
        const fl = f.lines.filter((l) => !l.moved).length;
        out.push(`${pad}${f.file}: ${fl} deleted, ${f.lines.length - fl} moved`);
        for (const l of f.lines) {
          const { text, escaped } = render(l.text);
          out.push(`${pad}  -L${l.line}${l.moved ? " [moved]" : ""}${escaped ? " [escaped]" : ""}: ${text}`);
        }
      }
    });
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
  const path = utf8(git(["rev-parse", "--git-path", "shallow"])).trim();
  return path && existsSync(path) ? readFileSync(path, "utf8") : "";
};

// `git` is injectable: (args, input?) => stdout as a Buffer (or a string, taken as UTF-8), throwing
// on failure. `shallow` returns the shallow file's contents ("" when not shallow). Never throws itself.
export function run(argv, git, shallow = () => readShallow(git)) {
  let range = argv[0];
  if (!range) {
    let base = "";
    try {
      base = utf8(git(["merge-base", "origin/main", "HEAD"])).trim();
    } catch {
      base = "";
    }
    if (!base) return notMeasured("origin/main...HEAD", "no merge base / shallow history");
    range = `${base}..HEAD`;
  }
  let rows;
  try {
    rows = parseRevList(byteString(git(["rev-list", "--parents", "--end-of-options", range])));
  } catch (e) {
    const shallow = /shallow|unknown revision|bad revision|ambiguous argument/i.test(String(e?.stderr ?? e?.message ?? e));
    return notMeasured(range, shallow ? "no merge base / shallow history" : "git rev-list failed or ran out of time");
  }
  if (!rows) return notMeasured(range, "git rev-list printed something other than commit ids");
  try {
    const cut = truncatedAt(rows.map((row) => row.sha).join("\n"), shallow());
    if (cut.length) return notMeasured(range, `shallow history: the range reaches the clone boundary at ${cut[0].slice(0, 10)}`);
  } catch {
    return notMeasured(range, "could not check for a shallow-history boundary");
  }
  if (rows.length === 0) return formatReport(range, []);
  const pairs = rows.flatMap(({ sha, parents }) => (parents.length ? parents : [null]).map((parent) => ({ sha, parent })));
  let scan;
  try {
    const input = pairs.map(({ sha, parent }) => (parent ? `${sha} ${parent}\n` : `${sha}\n`)).join("");
    scan = parseScan(byteString(git(SCAN_ARGS, input)), pairs);
  } catch {
    return notMeasured(range, "the tree scan (git diff-tree) failed or ran out of time");
  }
  if (!scan) return notMeasured(range, "the tree scan (git diff-tree) did not answer every commit and parent exactly once");
  const patches = new Map();
  const commits = [];
  let at = 0;
  for (const { sha, parents } of rows) {
    const against = (parents.length ? parents : [null]).map((parent) => {
      const changed = scan[at++];
      const files = WATCHED.flatMap((file) => {
        const deletions = changed.has(file) ? fileDeletions(git, patches, file, changed.get(file), sha, parent) : null;
        return deletions ? [deletions] : [];
      });
      return { sha: parent, touched: changed.size > 0, files };
    });
    if (against.some((p) => p.touched)) commits.push({ sha, parents: against });
  }
  if (commits.length) {
    const subjects = readSubjects(git, commits.map((c) => c.sha));
    for (const c of commits) c.subject = subjects.get(c.sha) ?? NO_SUBJECT;
  }
  return formatReport(range, commits);
}

// GIT_DIFF_OPTS (e.g. -u3) overrides -U0 and adds context lines; drop it from the child env. Global
// config is deliberately not blanked (GIT_CONFIG_GLOBAL) — that would also drop safe.directory.
const { GIT_DIFF_OPTS: _diffOpts, ...gitEnv } = process.env;

export const CALL_MS = 30_000;
export const RUN_MS = 120_000;

// The real git, bounded: each call may take CALL_MS, the run RUN_MS in all. A call that overruns is
// killed and throws, and once the run's budget is spent every later call throws without starting git,
// so run() reports whatever is still unread as NOT MEASURED instead of waiting.
export function boundedGit(spawn = execFileSync, now = Date.now, runMs = RUN_MS, callMs = CALL_MS) {
  const deadline = now() + runMs;
  return (args, input) => {
    const left = deadline - now();
    if (left <= 0) throw new Error("adoption-deletions: the run's git time budget is spent");
    return spawn("git", args, {
      env: gitEnv,
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: Math.min(callMs, left),
    });
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(run(process.argv.slice(2), boundedGit()));
  process.exitCode = 0;
}
