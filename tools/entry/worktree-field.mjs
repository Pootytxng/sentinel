// The canonical grammar for Work Control's `Worktree / branch` field.
//
// Why this module exists (spec §5.1, finding 8): the field is free text in three incompatible
// formats, so nothing can mechanically check the governing invariant — "issue, claim, session root,
// worktree, branch, dirty state, processes and settings agree". Guards 1, 3 and 4 are comparisons
// against this field and are blocked until it parses.
//
// Canonical form:
//   field  := "none" | entry ( " ; " entry )*
//   entry  := path " @ " branch
//   path   := absolute Windows path, uppercase drive letter, backslashes, no trailing separator
//   branch := a valid git ref name
//
// The separator is " @ " because git forbids whitespace in ref names, so a branch can never contain
// the separator and the split is total. Legacy forms are accepted on read and rewritten on
// normalize; a genuinely ambiguous value is REFUSED, never guessed (collision rule 4 — unknown
// means locked).
//
// Pure: no filesystem, no git, no board. Callers pass `codeRoot`, so every branch is testable.

export const CANONICAL_SEP = " @ ";
export const ENTRY_SEP = " ; ";
export const EMPTY_VALUE = "none";

/** Legacy separators, in the order they are tried, with which occurrence to split on. */
const LEGACY_SEPS = [
  // `C:\Users\Kuya\code\sentinel-feedback / feat/user-feedback-lab-recovery` (board items 14-17).
  // FIRST occurrence: a Windows path never contains " / ", but a branch routinely contains "/".
  { sep: " / ", pick: "first" },
  // `sentinel-work-control-codex · codex/work-control` (board items 10, 13).
  { sep: " \u00B7 ", pick: "first" },
];

const fail = (code, reason, raw) => ({ ok: false, code, reason, raw });

/**
 * Uppercase the drive letter, use backslashes, drop a trailing separator.
 * Casing beyond the drive letter is PRESERVED: Windows compares paths case-insensitively, but
 * `scripts/run-vitest.mjs` exists because a lowercase drive letter loaded vitest twice — casing is
 * not cosmetic, so it is stored exactly as given and only compared loosely.
 */
export function canonicalizePath(p) {
  const raw = String(p ?? "").trim();
  // bug->guard: this used to rewrite "/" to "\" UNCONDITIONALLY, which is right for a Windows path
  // and nonsense for any other -- "/tmp/x" became "\tmp\x". Invisible on the owner's machine, and
  // the reason every checkouts.mjs test failed the moment CI ran it on Linux. A Windows-path
  // canonicalizer must only canonicalize Windows paths.
  const isWindowsPath = /^[A-Za-z]:/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\");
  if (!isWindowsPath) return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  let out = raw.replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[a-z]:/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

/** Windows folder identity: case-insensitive, separator-insensitive. */
export function samePath(a, b) {
  return canonicalizePath(a).toLowerCase() === canonicalizePath(b).toLowerCase();
}

/**
 * git check-ref-format, for a branch name. Implemented rather than shelled out so the rules are
 * visible and every case is unit-testable without a repository.
 */
export function isValidBranch(branch) {
  const b = String(branch ?? "");
  if (b === "" || b === "@") return false;
  if (/[\s~^:?*[\\]/.test(b)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(b)) return false;
  if (b.includes("..") || b.includes("//")) return false;
  if (b.startsWith("/") || b.endsWith("/")) return false;
  if (b.endsWith(".")) return false;
  return b.split("/").every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
}

function splitOn(text, sep, pick) {
  const at = pick === "last" ? text.lastIndexOf(sep) : text.indexOf(sep);
  if (at < 0) return null;
  return [text.slice(0, at), text.slice(at + sep.length)];
}

function parseEntry(rawEntry, codeRoot) {
  const entry = String(rawEntry).trim();
  if (entry === "") return fail("NO_SEPARATOR", "Empty entry between ` ; ` separators.", rawEntry);

  // Canonical separator wins, split on the LAST occurrence so a path containing "@" cannot steal it.
  let halves = splitOn(entry, CANONICAL_SEP, "last");
  for (const { sep, pick } of LEGACY_SEPS) {
    if (halves) break;
    halves = splitOn(entry, sep, pick);
  }
  if (!halves) {
    return fail(
      "NO_SEPARATOR",
      `No folder/branch separator found in "${entry}". Expected \`<folder>${CANONICAL_SEP}<branch>\`.`,
      rawEntry,
    );
  }

  let [pathPart, branchPart] = halves.map((h) => h.trim());

  if (pathPart.includes(" + ")) {
    return fail(
      "AMBIGUOUS_MULTI_FOLDER",
      `"${entry}" names more than one folder for a single writer. Collision rule 4 — unknown means ` +
        `locked: name the one active folder, or leave the field \`${EMPTY_VALUE}\`.`,
      rawEntry,
    );
  }

  // A trailing parenthetical is board metadata, not part of the branch. Stripped and REPORTED, so
  // migration can show it and Kuya can move it to `Next action` rather than have it vanish.
  let note = null;
  const noted = branchPart.match(/^(.*?)\s*\(([^)]*)\)$/);
  if (noted) {
    branchPart = noted[1].trim();
    note = noted[2].trim();
  }

  if (!isValidBranch(branchPart)) {
    return fail(
      "INVALID_BRANCH",
      `"${branchPart}" is not a valid git branch name (from "${entry}").`,
      rawEntry,
    );
  }

  // A POSIX root counts as absolute too. It is not part of the board grammar — that is a Windows
  // path — but treating "/tmp/x" as RELATIVE and joining it onto the code root produced
  // "C:\Users\Kuya\code\/tmp/x", which is not a path anywhere. The launcher's own first-launch
  // tests build real worktrees in real temp directories, so this is the difference between those
  // proofs running and being provable on exactly one desk.
  const isAbsolute = /^[A-Za-z]:/.test(pathPart) || pathPart.startsWith("\\\\") || pathPart.startsWith("/");
  if (!isAbsolute) {
    if (!codeRoot) {
      return fail(
        "RELATIVE_PATH_UNRESOLVABLE",
        `"${pathPart}" is a bare folder name and no code root was supplied to resolve it against.`,
        rawEntry,
      );
    }
    pathPart = `${canonicalizePath(codeRoot)}\\${pathPart}`;
  }

  return { ok: true, entry: { path: canonicalizePath(pathPart), branch: branchPart }, note };
}

/**
 * Parse a field value into entries.
 * @returns {{ok: true, entries: Array<{path: string, branch: string}>, notes: string[]}
 *          | {ok: false, code: string, reason: string, raw: string}}
 */
export function parseWorktreeField(raw, { codeRoot = null } = {}) {
  const text = String(raw ?? "").trim();
  if (text === "" || text.toLowerCase() === EMPTY_VALUE) return { ok: true, entries: [], notes: [] };

  const entries = [];
  const notes = [];
  for (const part of text.split(ENTRY_SEP)) {
    const parsed = parseEntry(part, codeRoot);
    if (!parsed.ok) return { ...parsed, raw: text };
    entries.push(parsed.entry);
    if (parsed.note) notes.push(parsed.note);
  }
  return { ok: true, entries, notes };
}

/** Render entries back to the canonical string. */
export function formatWorktreeField(entries) {
  if (!entries?.length) return EMPTY_VALUE;
  return entries.map((e) => `${e.path}${CANONICAL_SEP}${e.branch}`).join(ENTRY_SEP);
}

/**
 * Parse and rewrite to canonical form.
 * @returns {{ok: true, value: string, entries: Array, notes: string[], changed: boolean}
 *          | {ok: false, code: string, reason: string, raw: string}}
 */
export function normalizeWorktreeField(raw, { codeRoot = null } = {}) {
  const parsed = parseWorktreeField(raw, { codeRoot });
  if (!parsed.ok) return parsed;
  const value = formatWorktreeField(parsed.entries);
  return {
    ok: true,
    value,
    entries: parsed.entries,
    notes: parsed.notes,
    changed: value !== String(raw ?? "").trim(),
  };
}
