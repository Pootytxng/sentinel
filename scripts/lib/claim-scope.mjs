// Write scopes, compared mechanically (#291).
//
// A claim already declares "Write scope" in prose, and until now nothing read it. Two lanes could
// declare overlapping folders and both be dispatched, and the collision would surface later as a
// conflict, a lost edit, or -- worst, because it is silent -- one lane quietly reverting the other's
// work while rebasing. "Disjoint scope" was a thing sessions asserted about themselves.
//
// So the scope becomes data. The parser reads the bullet the claim template already prescribes, the
// comparison is a set question, and the answer is checkable by someone who was not there. Nothing
// here talks to GitHub or to git: the caller gathers, this decides, so every case below is provable
// from a string.
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

/**
 * A thematic break, in the form CommonMark actually defines it: three or more of the SAME marker,
 * spaces allowed between and after them, and nothing else on the line. `_ _ _` is as valid a break
 * as `___`, and the review of 242f3de8 measured the spaced underscore form swallowing the paragraph
 * below it into the scope. `- - -` and `* * *` were already caught by the bullet rule above; the
 * underscore had no other alternative to fall back on.
 */
const THEMATIC_BREAK = /^\s*(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * A line that ENDS the `Write scope` text. Decided ONCE, here, and applied by the one extractor
 * (#408): the next list item (bulleted or numbered), a heading, a table row, a fenced code block,
 * or a thematic break. A blank line ends it too and is checked separately, because "" matches
 * nothing.
 *
 * The property this protects: prose belonging to the NEXT Markdown structure must never silently
 * become additional write authority. A scope that swallowed the numbered list under it would grant
 * every path that list names, and the grant would read as the writer's own words.
 *
 * Before #408 there were three of these rules -- this one, and a private one inside
 * `parseWriteScope` that stopped only at a blank line or a `-`/`*` bullet, so the same body read
 * through the two paths granted different paths.
 */
export const ENDS_SCOPE_BULLET = new RegExp(
  `^\\s*(?:[-*+]\\s|\\d{1,9}[.)]\\s|#|\\||\`\`\`|~~~)|${THEMATIC_BREAK.source}`,
);

/**
 * A fence OPENER: three or more backticks or tildes. Deliberately liberal about indentation, because
 * the two directions of error are not symmetric. Opening a fence that CommonMark would not open only
 * hides a declaration, and a hidden declaration reads as no scope at all, which every consumer
 * already fails closed on. Failing to open one grants whatever the block contains.
 */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

/**
 * A fence CLOSER, held to the real rule instead: at most three spaces of indent, no info string, and
 * -- checked against the opener in `fencedLines` -- the SAME marker with a run at least as long.
 * This is the strict side for the same asymmetry: a line wrongly accepted as a closer re-opens label
 * parsing inside code, which is exactly how 242f3de8 granted a scope written in a code sample.
 */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Which lines sit inside a fenced code block (the fence lines themselves included). A label found in
 * there is a code sample, not a declaration -- #405's own claim quoted a `js` fence above its scope
 * bullet -- and reading one as the scope would let quoted text declare write authority.
 *
 * The scanner tracks the OPEN fence's marker and run length. A `toggle on anything fence-shaped`
 * scanner is fail-open, and the exact-head review of 242f3de8 measured it: a ``` line inside a ````
 * block, or a ~~~ line inside a ``` block, ended the block early and let the next `- Write scope:`
 * line -- sitting in what is still code -- become the declaration. It did not merely ADD the path;
 * extraction returns the FIRST match, so the code sample REPLACED the writer's real scope.
 *
 * Limitation, stated rather than implied: indented code blocks are not modelled. A fence indented
 * four or more spaces is still treated as an opener here, which is the safe direction, but a `Write
 * scope` label inside a four-space indented block with no fence around it is read as a declaration.
 */
function fencedLines(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (open) {
      mask[i] = true;
      const close = FENCE_CLOSE.exec(lines[i]);
      if (close && close[1][0] === open.marker && close[1].length >= open.length) open = null;
      continue;
    }
    const start = FENCE_OPEN.exec(lines[i]);
    if (start) {
      mask[i] = true;
      open = { marker: start[1][0], length: start[1].length };
    }
  }
  return mask;
}

/**
 * A bullet's own line plus its continuation lines, joined by a single space. The head is not trimmed
 * on its own: it is joined first and the whole is trimmed once, so a bullet that does not wrap
 * returns exactly what a single-line read returns.
 */
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
  new RegExp(
    `^\\s*[-*+]\\s*(?:\\*\\*|__)?\\s*${escLabel(name)}\\s*(?::\\s*(?:\\*\\*|__)|(?:\\*\\*|__)\\s*:|:)\\s*(.*)$`,
    "i",
  );

/** `| **Write scope** | ... |` -- a two-column row, one line by construction. */
const labelRow = (name) =>
  new RegExp(`^\\s*\\|\\s*(?:\\*\\*|__)?\\s*${escLabel(name)}\\s*(?:\\*\\*|__)?\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, "i");

/**
 * A. EXTRACT: raw Markdown -> the exact `Write scope` text, or null.
 *
 * The ONE extraction contract (#408). Every reader of a write scope goes through it: the issue body,
 * the posted claim, and `parseWriteScope` below. #399 had already collapsed two of the three
 * continuation rules into one shared helper, but each reader still owned its own label matching and
 * `parseWriteScope` still owned a third boundary rule, so "the same Markdown means the same scope"
 * was still not true of this repo. It is now, because there is one function.
 *
 * `aliases` are the other labels a writer might use for the same field. The posted claim accepts
 * `scope`; an issue body does not, because an issue body is prose and `- scope:` in it is as likely
 * to be a sentence as a declaration.
 *
 * @param {string} markdown
 * @param {{aliases?: string[]}} [opts]
 * @returns {string|null}
 */
export function scopeTextFromMarkdown(markdown, { aliases = [] } = {}) {
  if (!markdown || typeof markdown !== "string") return null;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  for (const name of ["Write scope", ...aliases]) {
    const bullet = labelBullet(name);
    for (let i = 0; i < lines.length; i += 1) {
      if (fenced[i]) continue;
      const m = bullet.exec(lines[i]);
      if (m) return joinBullet(lines, i, m[1]) || null;
    }
    const row = labelRow(name);
    for (let i = 0; i < lines.length; i += 1) {
      if (fenced[i]) continue;
      const m = row.exec(lines[i]);
      if (m) return m[1].trim() || null;
    }
  }
  return null;
}

/**
 * A path a sentence DISCLAIMS is not a path the lane claimed. Inflections of the two stems that were
 * already here, not a synonym dictionary: `excluding` matched and `excluded` did not, and on #405
 * the phrase "Still excluded, unchanged:" GRANTED the paths it was written to withhold.
 */
const DISCLAIMS = /\b(?:no|not|never|exclud\w*|except\w*|outside|other than)\b/i;

/** A clause boundary. Only this re-opens granting after a disclaimer -- see `parseScopePatterns`. */
const ENDS_CLAUSE = /[.;!?]/;

/**
 * B. PARSE: exact scope text -> normalized path patterns.
 *
 * Knows nothing about Markdown structure -- where the scope text ends was decided by A, and asking
 * this layer to re-decide it is what produced two fake `- Write scope: ` wrappers whose only purpose
 * was to reach this loop.
 *
 * Only backticked paths count as declarations: the text also carries prose ("nothing else", "this
 * lane does not edit ..."), and prose is not a scope. The verdict is judged per path rather than per
 * sentence, so `a` survives "`a` but not `b`": the text between one path and the next decides it.
 *
 * A disclaimer governs the REST OF ITS CLAUSE, which is the half #405 proved was missing. Two kinds
 * of gap carry it forward:
 *   - a bare conjunction ("no other `src/` or `src-tauri/`" -- a reading that resets at "or" grants
 *     `src-tauri/` to a lane that just said it would not touch it, the hole this repo's own closeout
 *     claim fell through, 2026-09-02);
 *   - any gap that does not end a clause (", every other living status doc, " sits INSIDE the
 *     exclusion list it continues; resetting there granted three test files on #405).
 * A gap that ends a clause re-opens granting, so "`a` but not `b`; also `c`" still declares `c`.
 */
export function parseScopePatterns(scopeText) {
  const text = String(scopeText ?? "");
  const declared = [];
  let cursor = 0;
  let disclaimed = false;
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const gap = text.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const bare = /^[\s,;/]*(?:or|and|nor)?[\s,;/]*$/i.test(gap);
    if (!bare) {
      if (DISCLAIMS.test(gap)) disclaimed = true;
      else if (ENDS_CLAUSE.test(gap)) disclaimed = false;
    }
    if (disclaimed) continue;
    declared.push(normalizePattern(match[1]));
  }
  return declared.filter((p, i, a) => p && a.indexOf(p) === i);
}

/**
 * The paths a `Write scope` bullet declares, read straight out of raw Markdown: A then B, and
 * nothing of its own. It used to carry a third boundary rule, and the two callers that wanted only B
 * used to reach it by pasting their already-extracted text into a fake `- Write scope: ` bullet.
 * Both are gone (#408) -- a caller holding scope text calls `parseScopePatterns` directly.
 */
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
 * The pairs on which two scopes are not disjoint -- reported as pairs rather than a boolean
 * because "they overlap" is not actionable and "`scripts/` contains `scripts/foo.mjs`" is.
 *
 * Containment runs both ways on purpose: a one-directional check would call `scripts/` and
 * `scripts/foo.mjs` disjoint depending on which lane was asked first, which is worse than not
 * checking. But containment is only asked when the OTHER side is a literal path, because a glob
 * matched against a glob is a category error -- `scripts/*` appears to match the string
 * "scripts/*.mjs" only because `*` is an ordinary character to a regex, and an answer that arrives
 * by that route is right by luck and wrong as often.
 *
 * So two globs are NOT decided here. `overlappingFiles` decides them, exactly, against the paths
 * that actually exist.
 */
export function overlappingPairs(scopeA, scopeB) {
  const pairs = [];
  for (const a of scopeA.map(normalizePattern).filter(Boolean)) {
    for (const b of scopeB.map(normalizePattern).filter(Boolean)) {
      const overlaps =
        a === b || (isLiteral(b) && coversPath(a, b)) || (isLiteral(a) && coversPath(b, a));
      if (overlaps) pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * The files two scopes both claim, decided against a real list of paths rather than by comparing
 * the patterns to each other. This is the tier that settles globs: `scripts/*.mjs` and
 * `scripts/work-*` share no common string and both claim `scripts/work-control-gate.mjs`, and no
 * amount of pattern-versus-pattern cleverness sees that without knowing the file exists.
 *
 * The caller supplies the paths -- `git ls-files`, a diff, whatever the question is about -- so
 * this stays a decision over strings and the answer names the file, which is the sentence a lane
 * refused dispatch deserves to be given.
 */
export function overlappingFiles(scopeA, scopeB, files) {
  const a = scopeA.map(normalizePattern).filter(Boolean);
  const b = scopeB.map(normalizePattern).filter(Boolean);
  return files
    .map(normalizePattern)
    .filter(Boolean)
    .filter((f) => a.some((p) => coversPath(p, f)) && b.some((p) => coversPath(p, f)));
}

/**
 * The files a lane changed that its own claim never covered. This is the half that catches a lane
 * drifting after dispatch: the scopes can be disjoint at claim time and the diff still reach a file
 * nobody claimed, which is the same collision arriving late.
 */
export function outsideScope(changedPaths, scope) {
  const patterns = scope.map(normalizePattern).filter(Boolean);
  return changedPaths
    .map(normalizePattern)
    .filter(Boolean)
    .filter((path) => !patterns.some((p) => coversPath(p, path)));
}
