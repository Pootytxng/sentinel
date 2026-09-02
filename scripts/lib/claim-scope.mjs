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
 * The paths a claim comment declares it will write, out of the `- Write scope:` bullet the claim
 * template prescribes. Only backticked paths count as declarations: the bullet also carries prose
 * ("nothing else", "this lane does not edit ..."), and prose is not a scope.
 *
 * Reads to the end of the bullet, which is the next `- ` at the start of a line or a blank line --
 * a scope wrapped across lines is still one bullet.
 */
export function parseWriteScope(markdown) {
  const text = String(markdown ?? "").replace(/\r\n/g, "\n");
  const start = text.search(/^[-*]\s*Write scope:/im);
  if (start < 0) return [];
  const rest = text.slice(start).replace(/^[-*]\s*Write scope:/i, "");
  const end = rest.search(/\n\s*\n|\n[-*]\s/);
  const bullet = end < 0 ? rest : rest.slice(0, end);
  const declared = [...bullet.matchAll(/`([^`]+)`/g)].map((m) => normalizePattern(m[1]));
  return declared.filter((p, i, a) => p && a.indexOf(p) === i);
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
