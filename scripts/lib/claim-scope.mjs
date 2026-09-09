// Write scopes, compared mechanically (#291). A claim declares "Write scope" in prose; this reads it,
// so "disjoint scope" stops being a thing sessions assert about themselves. Nothing here talks to
// GitHub or to git -- the caller gathers, this decides -- so every case below is provable from a
// string.
//
// The one judgement worth stating: a directory scope and a file inside it OVERLAP. `scripts/` and
// `scripts/foo.mjs` are not disjoint just because they are spelled differently, and a comparison
// that treats them as distinct strings is the exact mistake that makes this useless.

/** Forward slashes, no leading `./`, no trailing `/`, no surrounding backticks or whitespace. */
export function normalizePattern(pattern) {
  return String(pattern ?? "")
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .trim();
}

const norm = (list) => list.map(normalizePattern).filter(Boolean);

/**
 * A line that ENDS the `Write scope` text: the next list item, heading, table row, fence, or thematic
 * break (3+ of the SAME marker, spaces allowed between). Decided ONCE here and applied by the one
 * extractor (#408), so prose belonging to the NEXT structure never becomes write authority. A blank
 * line ends it too and is checked separately, because "" matches nothing.
 */
export const ENDS_SCOPE_BULLET =
  /^\s*(?:[-*+]\s|\d{1,9}[.)]\s|#|\||```|~~~)|^\s*(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * Which lines sit inside a fenced code block, fence lines included: a label in there is a code sample,
 * not a declaration. The sides are asymmetric because the errors are -- a wrongly OPENED fence only
 * hides a declaration, which every consumer fails closed on, while a wrongly accepted CLOSER re-opens
 * label parsing inside code, so the closer is held to the real rule (same marker, run at least as
 * long, no info string). Not modelled: an indented block with no fence still reads as a declaration.
 */
function fencedLines(lines) {
  let open = null;
  return lines.map((line) => {
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open[0] && close[1].length >= open.length) open = null;
      return true;
    }
    const start = /^\s*(`{3,}|~{3,})/.exec(line);
    if (start) open = start[1];
    return Boolean(start);
  });
}

/** A bullet plus its continuations, joined then trimmed ONCE, so an unwrapped bullet reads as one line. */
function joinBullet(lines, start, head) {
  const out = [String(head ?? "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l.trim() || ENDS_SCOPE_BULLET.test(l)) break;
    out.push(l.trim());
  }
  return out.join(" ").trim();
}

const escLabel = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `- Write scope: ...`, `- **Write scope:** ...`, `- **Write scope**: ...`, `+ __Write scope__: ...`. */
const labelBullet = (name) =>
  new RegExp(`^\\s*[-*+]\\s*(?:\\*\\*|__)?\\s*${escLabel(name)}\\s*(?::\\s*(?:\\*\\*|__)|(?:\\*\\*|__)\\s*:|:)\\s*(.*)$`, "i");

/** `| **Write scope** | ... |` -- a two-column row, one line by construction. */
const labelRow = (name) =>
  new RegExp(`^\\s*\\|\\s*(?:\\*\\*|__)?\\s*${escLabel(name)}\\s*(?:\\*\\*|__)?\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, "i");

/**
 * A. EXTRACT: raw Markdown -> the exact `Write scope` text, or null. The ONE extraction contract
 * (#408): every reader comes through here, so the same Markdown means the same scope. `aliases` are
 * the field's other spellings -- a posted claim accepts `scope`, an issue body does not.
 */
export function scopeTextFromMarkdown(markdown, { aliases = [] } = {}) {
  if (!markdown || typeof markdown !== "string") return null;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  for (const name of ["Write scope", ...aliases]) {
    for (const [label, read] of [
      [labelBullet(name), (m, i) => joinBullet(lines, i, m[1])],
      [labelRow(name), (m) => m[1].trim()],
    ]) {
      for (let i = 0; i < lines.length; i += 1) {
        const m = fenced[i] ? null : label.exec(lines[i]);
        if (m) return read(m, i) || null;
      }
    }
  }
  return null;
}

/**
 * Inflections of the stems already here, not a synonym dictionary: `excluding` matched and `excluded`
 * did not, so on #405 "Still excluded, unchanged:" GRANTED the seven paths written to withhold them.
 */
const DISCLAIMS = /\b(?:no|not|never|exclud\w*|except\w*|outside|other than)\b/i;

/** A clause boundary, and the ONLY thing that re-opens granting after a disclaimer. */
const ENDS_CLAUSE = /[.;!?]/;

/**
 * B. PARSE: exact scope text -> normalized path patterns. Knows nothing about Markdown structure; A
 * decided where the text ends. Only backticked paths count, each judged by the gap BEFORE it, so `a`
 * survives "`a` but not `b`". A disclaimer then governs the REST OF ITS CLAUSE (the half #405 proved
 * was missing), carried across a bare separator ("no other `src/` or `src-tauri/`") and across any
 * gap that does not end one. So a separator is never also a clause terminator: while `;` was in that
 * class it short-circuited its own boundary and "`a` but not `b`; `c`" silently dropped `c`.
 */
export function parseScopePatterns(scopeText) {
  const text = String(scopeText ?? "");
  const declared = [];
  let cursor = 0;
  let disclaimed = false;
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const gap = text.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const bare = /^[\s,/]*(?:or|and|nor)?[\s,/]*$/i.test(gap);
    if (!bare) {
      if (DISCLAIMS.test(gap)) disclaimed = true;
      else if (ENDS_CLAUSE.test(gap)) disclaimed = false;
    }
    if (disclaimed) continue;
    declared.push(normalizePattern(match[1]));
  }
  return declared.filter((p, i, a) => p && a.indexOf(p) === i);
}

/** A then B, and nothing of its own: the paths a `Write scope` bullet declares out of raw Markdown. */
export function parseWriteScope(markdown) {
  return parseScopePatterns(scopeTextFromMarkdown(markdown) ?? "");
}

/** `**` crosses separators, `*` and `?` do not. Anything else is literal. */
function toRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/**
 * Does `pattern` cover `path`? True when the pattern names the path, matches it as a glob, or is a
 * directory the path sits under. The directory case is the one that matters: a lane claiming
 * `scripts/` has claimed every file in it, whether or not it listed them.
 */
export function coversPath(pattern, path) {
  const p = normalizePattern(pattern);
  const target = normalizePattern(path);
  if (!p || !target) return false;
  if (p === target) return true;
  if (target.toLowerCase().startsWith(`${p.toLowerCase()}/`)) return true;
  return /[*?]/.test(p) ? toRegExp(p).test(target) : false;
}

/** No `*` and no `?`: the pattern names a path rather than a shape. */
function isLiteral(pattern) {
  return !/[*?]/.test(pattern);
}

/**
 * The pairs on which two scopes are not disjoint -- pairs rather than a boolean, because "they
 * overlap" is not actionable and "`scripts/` contains `scripts/foo.mjs`" is.
 *
 * Containment runs both ways on purpose: a one-directional check would call `scripts/` and
 * `scripts/foo.mjs` disjoint depending on which lane was asked first. But it is only asked when the
 * OTHER side is a literal path, because glob-versus-glob is a category error -- `scripts/*` appears
 * to match the string "scripts/*.mjs" only because `*` is ordinary to a regex, and an answer got
 * that way is right by luck. Two globs are decided by `overlappingFiles` instead.
 */
export function overlappingPairs(scopeA, scopeB) {
  const pairs = [];
  for (const a of norm(scopeA)) {
    for (const b of norm(scopeB)) {
      const overlaps =
        a === b || (isLiteral(b) && coversPath(a, b)) || (isLiteral(a) && coversPath(b, a));
      if (overlaps) pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * The tier that settles globs, decided against a real list of paths: `scripts/*.mjs` and
 * `scripts/work-*` share no common string and both claim `scripts/work-control-gate.mjs`. The caller
 * supplies the paths -- `git ls-files`, a diff, whatever the question is about -- so this stays a
 * decision over strings, and the answer names the file, which is the sentence a refused lane deserves.
 */
export function overlappingFiles(scopeA, scopeB, files) {
  const a = norm(scopeA);
  const b = norm(scopeB);
  return norm(files).filter((f) => a.some((p) => coversPath(p, f)) && b.some((p) => coversPath(p, f)));
}

/**
 * The files a lane changed that its own claim never covered. This is the half that catches a lane
 * drifting after dispatch: the scopes can be disjoint at claim time and the diff still reach a file
 * nobody claimed, which is the same collision arriving late.
 */
export function outsideScope(changedPaths, scope) {
  const patterns = norm(scope);
  return norm(changedPaths).filter((path) => !patterns.some((p) => coversPath(p, path)));
}
