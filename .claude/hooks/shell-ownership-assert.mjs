// PreToolUse(Bash|PowerShell) — the one-writer rule, applied to shell mutations (#278).
//
// Spec: docs/superpowers/specs/2026-08-31-target-ownership-across-tools.md §4, §5, §6.
//
// WHAT THIS IS NOT. It is not a shell sandbox and does not claim to decide whether an arbitrary
// command writes. The 2026-08-21 spec §3c is right that parsing arbitrary shell for that answer
// "fails open on anything clever and fails closed on plenty that is innocent", and that argument is
// honoured rather than argued with. This decides three narrower things:
//
//   1. a RECOGNIZED literal mutation of a path it can resolve  -> answered on the target's zone;
//   2. a RECOGNIZED mutation whose target it cannot resolve    -> explicit approval, never a guess;
//   3. everything else                                          -> allowed, and §6 says so out loud.
//
// So `npm run build`, a project script, or any binary that writes without naming a recognized verb
// passes untouched. That is a documented limit, not a claim of safety. The threat model is the same
// one the entry system was built for — an unaware session reaching for the nearest tool — plus the
// specific drift #240 demonstrated: refused on `Edit`, then reaching the same file through the shell.
//
// THE ESCAPE HATCH IS PART OF THE DESIGN, NOT AN AFTERTHOUGHT (§5). A guard on the shell can, if it
// is wrong, prevent its own repair; that is exactly why `Bash` was left unmatched before. Three ways
// back in, none of which needs this file to be correct:
//
//   * `Write`/`Edit` inside the session root are UNCHANGED, so a verified session can still edit
//     `.claude/settings.json` and unregister this hook without the shell being involved at all;
//   * `COMPY_SHELL_OWNERSHIP_OFF=1` in THIS PROCESS'S environment disables it. Setting it inline in
//     a command does not work — that string is the command being inspected, not this process's env —
//     so the lever belongs to whoever launches the session, not to an agent inside one;
//   * it fails open on its own errors: unreadable stdin, an unparseable command, a throwing
//     resolver, all exit 0.
//
// DENY IS ONLY FOR POSITIVE KNOWLEDGE. A resolved path inside a checkout this session does not own
// is a fact, and gets `deny`. Ambiguity — an unresolved operand, an unknown path shape, the owner's
// global config — gets `ask`, because `ask` under an auto-approving permission mode degrades to
// allow, and a guard whose only mode degrades is not a guard.
//
// IT NEVER PERSISTS AND NEVER LOGS. No claim is written, no lineage record, no board row, no file.
// `verifySession({persist: false})`, and it is only called when a protected zone is actually in play
// — the common case (a command touching nothing protected) costs no board read at all.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { LAPSED_CODES, UNVERIFIABLE_CODES, resolveSessionRoot, verifySession } from "./session-root-assert.mjs";
import { PROTECTED_ZONES, ZONES, resolveAbsolute, zoneOf } from "./target-ownership.mjs";

/** The shell tools this installation actually emits. A guard on one of them is a hole at the other. */
export const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

export const OFF_SWITCH = "COMPY_SHELL_OWNERSHIP_OFF";

// ── lexing ───────────────────────────────────────────────────────────────────────────────────────

const OPERATORS = ["&&", "||", "2>&", "&>>", "2>>", "2>", "&>", ">&", ">>", ">", "<<<", "<<-", "<<", "<", "|", ";", "&", "(", ")", "\n"];

/**
 * The characters an escape may precede INSIDE double quotes. POSIX: `$`, backtick, `"`, `\` and a
 * newline; everything else keeps its backslash. PowerShell's backtick escapes `$`, backtick and `"`.
 * A backslash before anything else is a path separator, not an escape, and reading it as one is how
 * a quoted Windows path stops being a path.
 */
const QUOTED_ESCAPABLE = {
  posix: new Set(["$", "`", '"', "\\", "\n"]),
  powershell: new Set(["$", "`", '"', "\n"]),
};

/**
 * A here-document's BODY is data being written, not commands to run. Lexing it as shell is how a
 * guard reads `rm -rf /x` inside a text block as an intent to delete — a spurious DENY, which is the
 * expensive kind of wrong. The body is removed before lexing; the redirect that receives it
 * (`cat > file <<EOF`) is on the opening line and is still evaluated.
 */
export function stripHeredocs(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    out.push(lines[i]);
    const m = lines[i].match(/<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/);
    if (!m) continue;
    const end = m[2];
    i += 1;
    while (i < lines.length && lines[i].trim() !== end) i += 1;
  }
  return out.join("\n");
}

/**
 * A token is a word or an operator. `dynamic` means the word's VALUE is not knowable from the text:
 * a variable, a substitution, a glob. That flag is the whole reason this lexer exists — a guard that
 * cannot tell `rm build.log` from `rm $TARGET` will either wave the second through or refuse the
 * first, and both are wrong.
 *
 * @param {string} text
 * @param {"posix"|"powershell"} dialect
 */
export function lex(text, dialect = "posix") {
  const escapeChar = dialect === "powershell" ? "`" : "\\";
  const src = String(text ?? "");
  const out = [];
  let word = null;

  const push = () => {
    if (word !== null) out.push({ type: "word", value: word.value, dynamic: word.dynamic, raw: word.raw });
    word = null;
  };
  const add = (ch, { dynamic = false, raw = ch } = {}) => {
    if (word === null) word = { value: "", dynamic: false, raw: "" };
    word.value += ch;
    word.raw += raw;
    if (dynamic) word.dynamic = true;
  };

  for (let i = 0; i < src.length; ) {
    const c = src[i];

    if (c === escapeChar && i + 1 < src.length) {
      // A line continuation joins words; any other escape is a literal character.
      if (src[i + 1] === "\n") {
        i += 2;
        continue;
      }
      add(src[i + 1], { raw: c + src[i + 1] });
      i += 2;
      continue;
    }

    if (c === "'") {
      // Single quotes are literal in both dialects: nothing inside can expand.
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== "'") value += src[j++];
      add(value, { raw: src.slice(i, Math.min(j + 1, src.length)) });
      i = j + 1;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let value = "";
      let dynamic = false;
      while (j < src.length && src[j] !== '"') {
        // INSIDE double quotes the escape character is special before only a few characters. Both
        // shells agree on the shape and disagree on the set. Consuming it before ANY character is
        // how `"C:\Users\Kuya\code\sentinel\README.md"` became `C:UsersKuyacodesentinelREADME.md` —
        // an unresolvable path, which this checker then routed to `ask`. Measured 2026-08-31: every
        // double-quoted Windows path in the exercise fixture was destroyed that way, so the guard
        // could neither deny the sibling write nor recognize the session's own root. Outside quotes
        // the unconditional form is CORRECT and stays — bash really does turn a bare
        // `C:\Users\x` into `C:Usersx`, and pretending otherwise would deny a command that never
        // touched the path it appears to name.
        if (src[j] === escapeChar && j + 1 < src.length && QUOTED_ESCAPABLE[dialect].has(src[j + 1])) {
          value += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === "$" || (dialect === "posix" && src[j] === "`")) dynamic = true;
        value += src[j++];
      }
      add(value, { dynamic, raw: src.slice(i, Math.min(j + 1, src.length)) });
      i = j + 1;
      continue;
    }

    if (/\s/.test(c) && c !== "\n") {
      push();
      i += 1;
      continue;
    }

    // `#` opens a comment only unquoted and at a word boundary, so `$#`, `${#x}` and `sha#1` survive.
    if (c === "#" && word === null && dialect === "posix") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      push();
      out.push({ type: "op", value: op });
      i += op.length;
      continue;
    }

    if (c === "$" || (dialect === "posix" && c === "`")) {
      add(c, { dynamic: true });
      i += 1;
      continue;
    }
    if (c === "*" || c === "?" || c === "[") {
      add(c, { dynamic: true });
      i += 1;
      continue;
    }

    add(c);
    i += 1;
  }
  push();
  return out;
}

const CHAIN_OPS = new Set(["&&", "||", ";", "|", "&", "\n", "(", ")"]);
const REDIRECTS = new Set([">", ">>", "2>", "2>>", "&>", "&>>"]);
/** `2>&1` redirects to a file DESCRIPTOR. The word after it is a number, not a path to guard. */
const FD_REDIRECTS = new Set(["2>&", ">&"]);

/** Split a token stream into segments at chain operators, keeping each segment's redirect targets. */
export function segments(tokens) {
  const out = [];
  let current = { words: [], redirects: [] };
  const flush = () => {
    if (current.words.length || current.redirects.length) out.push(current);
    current = { words: [], redirects: [] };
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === "op" && CHAIN_OPS.has(t.value)) {
      flush();
      continue;
    }
    if (t.type === "op" && FD_REDIRECTS.has(t.value)) {
      if (tokens[i + 1]?.type === "word") i += 1;
      continue;
    }
    if (t.type === "op" && REDIRECTS.has(t.value)) {
      const next = tokens[i + 1];
      if (next?.type === "word") {
        current.redirects.push(next);
        i += 1;
      }
      continue;
    }
    if (t.type === "op") continue; // `<`, heredocs: reads, not writes
    current.words.push(t);
  }
  flush();
  return out;
}

// ── what mutates ─────────────────────────────────────────────────────────────────────────────────

/** git verbs that only read. Everything not answered read-only here is treated as a mutation. */
const GIT_READONLY = new Set([
  "status", "log", "diff", "show", "rev-parse", "rev-list", "ls-files", "ls-tree", "ls-remote",
  "cat-file", "blame", "describe", "for-each-ref", "symbolic-ref", "var", "shortlog", "name-rev",
  "merge-base", "check-ref-format", "check-ignore", "check-attr", "grep", "count-objects",
  "whatchanged", "annotate", "verify-commit", "verify-tag", "cherry", "range-diff", "diff-tree",
  "diff-index", "help", "version", "bisect-log",
]);

const GIT_SUB_READONLY = {
  worktree: new Set(["list"]),
  remote: new Set(["", "show", "get-url"]),
  stash: new Set(["list", "show"]),
  submodule: new Set(["status"]),
  notes: new Set(["list", "show"]),
  reflog: new Set(["", "show"]),
  bisect: new Set(["log", "view"]),
};

const LISTING_ONLY = /^(-a|-r|-l|-v|-vv|--list|--all|--remotes|--show-current|--contains|--merged|--no-merged|--sort=.*|--format=.*|--color(=.*)?|--points-at=.*|-i|--ignore-case)$/;

/** Global git options that take a value and that CHANGE WHICH REPOSITORY the command acts on. */
const GIT_DIR_FLAGS = new Set(["-C", "--git-dir", "--work-tree"]);

/**
 * git flags whose NEXT word is a value, not a pathspec. Without this, `git commit -m "docs:
 * ../sentinel/README"` reads its own commit message as a path into a sibling and refuses a commit
 * that touches nothing — a false deny, which is how a guard earns its removal.
 */
const GIT_VALUE_FLAGS = new Set([
  "-m", "--message", "-F", "--file", "--author", "--date", "-S", "--gpg-sign", "-c",
  "--reuse-message", "-C", "--reedit-message", "-u", "--set-upstream-to", "--sort", "--format",
  "--pretty", "--git-dir", "--work-tree",
]);
/** Combined short flags ending in `m` (`-am`, `-sm`) take a message the same way `-m` does. */
const GIT_COMBINED_MESSAGE = /^-[A-Za-z]*m$/;

export function gitIsReadOnly(args) {
  const verb = args.find((a) => !a.startsWith("-"));
  if (!verb) return true; // bare `git` prints usage
  if (GIT_READONLY.has(verb)) return true;

  const after = args.slice(args.indexOf(verb) + 1);
  const sub = after.find((a) => !a.startsWith("-")) ?? "";

  if (verb === "config") return after.some((a) => /^(--get(-all|-regexp|-color(bool)?)?|--list|-l)$/.test(a));
  if (verb === "branch" || verb === "tag") return after.every((a) => LISTING_ONLY.test(a));
  if (GIT_SUB_READONLY[verb]) return GIT_SUB_READONLY[verb].has(sub);
  return false;
}

/**
 * Non-git commands that write, and which of their operands are targets.
 * `both` means source AND destination are evaluated — a move OUT of a protected checkout is a
 * protected operation at the source end even when the destination is scratch.
 */
const FILE_MUTATORS = new Map([
  ["mv", "both"], ["cp", "both"], ["rsync", "both"], ["install", "both"], ["ln", "both"],
  ["rm", "all"], ["rmdir", "all"], ["mkdir", "all"], ["touch", "all"], ["chmod", "all"],
  ["chown", "all"], ["truncate", "all"], ["shred", "all"], ["unlink", "all"], ["tee", "all"],
  ["patch", "all"], ["dd", "dd"],
  // PowerShell verbs, which reach here when the harness routes a PowerShell tool call.
  ["set-content", "all"], ["add-content", "all"], ["clear-content", "all"], ["out-file", "all"],
  ["remove-item", "all"], ["move-item", "both"], ["copy-item", "both"], ["rename-item", "both"],
  ["new-item", "all"], ["set-itemproperty", "all"], ["remove-itemproperty", "all"],
]);

/** Editors that rewrite a file in place only when a flag says so. */
const INPLACE = new Map([
  ["sed", /^(-i.*|--in-place.*)$/],
  ["perl", /^-.*i.*$/],
  ["ruby", /^-.*i.*$/],
  ["awk", /^--?i(nplace)?$/],
]);

/** Interpreters whose real target lives inside a string this lexer will not evaluate. */
const OPAQUE = new Set(["node", "python", "python3", "py", "ruby", "perl", "pwsh", "powershell", "powershell.exe", "cmd", "bash", "sh", "zsh", "eval", "xargs", "env", "start"]);

const CD_VERBS = new Set(["cd", "pushd", "set-location", "chdir"]);

/**
 * The claim/adoption entrypoint is never in the way of itself. A refusal prints
 * `node tools/entry/cli.mjs adopt …` as the cure, and a guard that then asks for approval to run its
 * own cure has turned "run this" into "open a window and start over" — the exact failure the
 * write-refusal spec was built to avoid. Per SEGMENT, so `cli.mjs adopt; rm -rf ../other` still has
 * its second half judged on its own.
 */
const ENTRY_CLI = /(^|[\\/])tools[\\/]entry[\\/](cli|adopt|claim|launch)\.mjs$/;

/** Absolute paths embedded in a larger string — an interpreter body, a `-c` argument, a here-string. */
export function embeddedPaths(text) {
  const out = [];
  const re = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|tmp|var|Users)\/)[^\s"'`;|&)]*/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) out.push(m[0]);
  return out;
}

const expandHome = (p, home) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? resolve(home, p.slice(2) || ".") : p);

/** A word that is dynamic ONLY because of a glob, with no `..` and no absolute prefix, is bounded by
 *  the working directory — `rm *.log` cannot leave the folder it runs in. Saying so is what keeps
 *  the checker from asking about every ordinary wildcard. */
const globBounded = (w) => /^[^$`]*$/.test(w.raw ?? w.value) && !w.value.includes("..") && !/^([A-Za-z]:|[\\/]|~)/.test(w.value);

/**
 * One command string -> the operations it names.
 *
 * @returns {{ops: Array<{verb: string, target: string, kind: string}>,
 *            unresolved: Array<{verb: string, why: string}>,
 *            cwdUnknown: boolean}}
 */
export function analyze(command, { cwd = null, dialect = "posix", home = homedir() } = {}) {
  const ops = [];
  const unresolved = [];
  let here = cwd;
  let cwdUnknown = false;

  const at = (target, verb, kind = "literal") => ops.push({ verb, target, kind, cwd: here, cwdUnknown });
  /**
   * `kind` separates the two reasons a target can be unknown, because they deserve different
   * answers. `"mutation"` is a RECOGNIZED write whose target is not knowable — that is the spec's
   * class 2 and always takes the approval path. `"opaque"` is a verb that runs code this checker
   * does not evaluate, which is class 3: not a known write at all. Asking about every `node` and
   * every `bash -lc` would make this guard noise, and a guard that is noise gets removed — the same
   * outcome as not having one.
   */
  const cannot = (verb, why, kind = "mutation") => unresolved.push({ verb, why, kind, cwd: here, cwdUnknown });

  for (const seg of segments(lex(stripHeredocs(command), dialect))) {
    const words = seg.words;
    for (const r of seg.redirects) {
      if (r.dynamic && !globBounded(r)) cannot("redirection", `the redirect target \`${r.value}\` is not knowable from the text`);
      else at(expandHome(r.value, home), "redirection");
    }
    if (!words.length) continue;

    // `VAR=1 rm -rf …` runs `rm`. Reading the assignment as the verb is how a command hides from a
    // verb-driven checker in the plainest way there is, so leading assignments are stepped over.
    let head = 0;
    while (head < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[head].value)) head += 1;
    if (head >= words.length) continue; // a segment that only sets variables writes nothing

    const verb = words[head].value.replace(/\.exe$/i, "").toLowerCase();
    const rest = words.slice(head + 1);
    const operandsOf = (ws) => ws.filter((w) => !w.value.startsWith("-"));

    if (rest.some((w) => ENTRY_CLI.test(w.value.replace(/\\/g, "/")))) continue;

    /** Absolute paths spelled anywhere in this segment. Positive detection only: their presence is
     *  a fact, their absence proves nothing — which is why it never downgrades an `unresolved`. */
    const scanEmbedded = () => {
      for (const p of words.flatMap((w) => embeddedPaths(w.value))) at(p, verb, "embedded");
    };

    if (CD_VERBS.has(verb)) {
      const to = operandsOf(rest)[0];
      if (!to) continue;
      if (to.dynamic) {
        cwdUnknown = true;
        here = null;
      } else {
        // Through the shared resolver, not `resolve`, for one measured reason: `cd
        // /c/Users/Kuya/code/sentinel && rm -f package.json` was ALLOWED, because `resolve` read the
        // Git-Bash drive path as `C:\c\Users\…` and every relative target after it landed in a
        // folder that does not exist. The `cd` destination has to be understood exactly as well as
        // a write target does — it IS the write target, one operand later.
        const landed = resolveAbsolute(expandHome(to.value, home), here);
        here = landed;
        cwdUnknown = !landed;
      }
      continue;
    }

    if (verb === "git") {
      // `-C dir` / `--git-dir` / `--work-tree` move the command to another repository. Missing that
      // is how a guard watches the folder you are standing in while the write lands somewhere else.
      let repoDir = here;
      let repoUnknown = cwdUnknown;
      const args = [];
      for (let i = 0; i < rest.length; i += 1) {
        const w = rest[i];
        const eq = w.value.match(/^(--git-dir|--work-tree)=(.*)$/);
        if (eq) {
          if (w.dynamic) repoUnknown = true;
          else repoDir = here ? resolve(here, expandHome(eq[2], home)) : expandHome(eq[2], home);
          continue;
        }
        if (GIT_DIR_FLAGS.has(w.value)) {
          const next = rest[i + 1];
          i += 1;
          if (!next || next.dynamic) repoUnknown = true;
          else repoDir = here ? resolve(here, expandHome(next.value, home)) : expandHome(next.value, home);
          continue;
        }
        args.push(w.value);
      }
      if (gitIsReadOnly(args)) continue;
      const gitVerb = `git ${args.find((a) => !a.startsWith("-")) ?? ""}`.trim();
      if (repoUnknown || !repoDir) {
        cannot(gitVerb, "the repository it acts on is not knowable from the text");
        scanEmbedded();
      } else at(repoDir, gitVerb, "git-repo");
      // Path operands (`git checkout -- src/App.css`) are evaluated too: the repo may be this one
      // while the pathspec reaches a file the claim does not cover. A flag's VALUE is skipped, or a
      // commit message reads as a pathspec.
      for (let i = 0; i < rest.length; i += 1) {
        const w = rest[i];
        if (w.value.startsWith("-")) {
          if (GIT_VALUE_FLAGS.has(w.value) || GIT_COMBINED_MESSAGE.test(w.value)) i += 1;
          continue;
        }
        if (w.dynamic && !globBounded(w)) cannot(gitVerb, `the pathspec \`${w.value}\` is not knowable from the text`);
        else if (/[\\/.]/.test(w.value)) at(expandHome(w.value, home), gitVerb);
      }
      continue;
    }

    const inplaceFlag = INPLACE.get(verb);
    const isInplace = inplaceFlag && rest.some((w) => inplaceFlag.test(w.value));
    const mutator = FILE_MUTATORS.get(verb);

    if (mutator || isInplace) {
      const operands = operandsOf(rest).filter((w) => !(inplaceFlag && inplaceFlag.test(w.value)));
      const targets = mutator === "dd" ? operands.filter((w) => w.value.startsWith("of=")) : operands;
      if (!targets.length) cannot(verb, "it names no target this checker can see");
      let anyUnresolved = false;
      for (const w of targets) {
        const value = mutator === "dd" ? w.value.slice(3) : w.value;
        if (w.dynamic && !globBounded(w)) {
          anyUnresolved = true;
          cannot(verb, `the operand \`${value}\` is not knowable from the text`);
        } else at(expandHome(value, home), verb);
      }
      if (anyUnresolved) scanEmbedded();
      continue;
    }

    if (OPAQUE.has(verb)) {
      // An absolute path spelled inside an interpreter body is a real signal; its absence is not
      // evidence of anything, so the `unresolved` stands either way.
      scanEmbedded();
      cannot(verb, "it runs code this checker does not evaluate", "opaque");
    }
  }

  return { ops, unresolved, cwdUnknown };
}

// ── the decision ─────────────────────────────────────────────────────────────────────────────────

const HEADER = "Blocked: this command writes into a checkout this session does not own.";

/**
 * @returns {{permission: "allow"|"deny"|"ask", reason?: string, zone?: string, target?: string}}
 */
export function decideShell({
  toolName,
  toolInput,
  sessionRoot,
  cwd = null,
  verify = () => ({ ok: false, code: "UNKNOWN" }),
  zone = zoneOf,
  home = homedir(),
  env = process.env,
} = {}) {
  if (env?.[OFF_SWITCH] === "1") return { permission: "allow", why: `${OFF_SWITCH}=1` };
  if (!SHELL_TOOLS.has(String(toolName ?? ""))) return { permission: "allow", why: "not a shell tool" };

  const command = toolInput?.command;
  if (typeof command !== "string" || command.trim() === "") return { permission: "allow", why: "no command to inspect" };

  const dialect = toolName === "PowerShell" ? "powershell" : "posix";
  const { ops, unresolved } = analyze(command, { cwd, dialect, home });
  if (!ops.length && !unresolved.length) return { permission: "allow", why: "names no recognized mutation" };

  // Zones first, verification second: the board is only read when something protected is in play.
  // After a `cd` this checker could not follow, a RELATIVE target has no directory to resolve
  // against; handing it the session's cwd would answer confidently about the wrong folder, so it is
  // given none and comes back `unknown`. An absolute target is unaffected.
  const zoned = ops.map((op) => ({
    op,
    ...zone({ target: op.target, sessionRoot, cwd: op.cwdUnknown ? null : (op.cwd ?? cwd), deps: { home } }),
  }));
  const protectedHits = zoned.filter((z) => PROTECTED_ZONES.has(z.zone));
  if (!protectedHits.length && !unresolved.length) return { permission: "allow", why: "every target is outside protection" };

  const sibling = protectedHits.find((z) => z.zone === ZONES.SIBLING);
  if (sibling) {
    return {
      permission: "deny",
      zone: sibling.zone,
      target: sibling.abs,
      reason:
        `${HEADER}\n\n` +
        `\`${sibling.op.verb}\` would act on ${sibling.abs}, which belongs to ${sibling.owner} — ` +
        `${sibling.why}. This session is working in ${sessionRoot}, and a claim covers one checkout.\n\n` +
        `Switching tools does not change who may write: the same edit through \`Write\` is refused ` +
        `for the same reason. Make the change in a session opened on ${sibling.owner}, or in this ` +
        `one against a path it owns.`,
    };
  }

  const verdict = verify();
  const unverified = !verdict?.ok;

  const own = protectedHits.find((z) => z.zone === ZONES.OWN);
  if (own && unverified) {
    const code = verdict?.code ?? "UNKNOWN";
    const advisory = UNVERIFIABLE_CODES.has(code) || LAPSED_CODES.has(code);
    return {
      permission: "deny",
      zone: own.zone,
      target: own.abs,
      code,
      reason:
        `Blocked: this session is not verified for this folder (${code}), and \`${own.op.verb}\` ` +
        `writes inside it.\n\n${advisory ? "" : `${verdict?.reason ?? ""}\n\n`}` +
        `This is the same refusal \`Write\` and \`Edit\` give; the shell is not a way around it.` +
        (advisory
          ? `\n\nVerify this session without restarting it, then retry:\n\n    node tools/entry/cli.mjs adopt --issue <n> --session <id>`
          : `\n\nResolve the disagreement before changing ${own.abs}.`),
    };
  }

  const global = protectedHits.find((z) => z.zone === ZONES.GLOBAL);
  if (global) {
    // DENY here, where `project-write-assert` asks. The two are not inconsistent — they are answering
    // for different paths in. `ask` is a ROUTING decision, and under this machine's
    // `permissions.defaultMode: "auto"` a routed decision degrades to allow; that is acceptable for
    // the tool path, because the owner's memory store lives under `~/.claude/projects/**` and is
    // written with `Write` on purpose. Through a SHELL there is no such case: nothing in this
    // repository writes into `~/.claude` or `~/.codex` with a shell command, and those folders hold
    // the settings and hooks that decide what an agent may do on this machine. A guard that routes
    // that write in a mode which auto-approves has not protected it.
    return {
      permission: "deny",
      zone: global.zone,
      target: global.abs,
      reason:
        `\`${global.op.verb}\` would write ${global.abs}, inside the owner's global configuration ` +
        `(${global.owner}) — the settings and hooks that decide what agents may do on this machine. ` +
        `No repository claim covers it and no shell command in this repo needs to. If the owner ` +
        `asked for this change, hand him the exact before/after and let him apply it; that is the ` +
        `path his own settings already name.`,
    };
  }

  const unknown = protectedHits.find((z) => z.zone === ZONES.UNKNOWN);
  if (unknown) {
    return {
      permission: "ask",
      zone: unknown.zone,
      target: unknown.op.target,
      reason:
        `\`${unknown.op.verb}\` names \`${unknown.op.target}\`, and this checker could not work out ` +
        `where that lands (${unknown.why}). An unresolved path is not evidence that it is outside ` +
        `protection, so it takes the normal approval path rather than a guess.`,
    };
  }

  if (unresolved.length) {
    const asking = (u) => ({
      permission: "ask",
      zone: ZONES.UNKNOWN,
      reason:
        `\`${u.verb}\` can write, and ${u.why}. A keyword scan that finds no protected path is not ` +
        `proof that none is reached — a variable, an alias or a relative path still can — so this ` +
        `takes the normal approval path instead of being waved through.`,
    });

    // A recognized mutation with an unknowable target is spec class 2, and verification does not
    // enter into it: `rm -rf $TARGET` is unknowable from a verified session too. These are rare in
    // written commands, so the approval prompt costs a keystroke and buys the one case that matters.
    const named = unresolved.find((u) => u.kind !== "opaque");
    if (named) return asking(named);

    // What is left is class 3: verbs that run code this checker does not evaluate. The only thing
    // that can be said about them is where they are STANDING, so that is what decides. It is not a
    // proof — an unresolved operand could still be an absolute path into a sibling — and that
    // residual is named in spec §6; the embedded-path scan is what catches the literal version of it.
    const cwdZone = (u) => (!u.cwdUnknown && u.cwd ? zone({ target: u.cwd, sessionRoot, cwd: u.cwd, deps: { home } }).zone : ZONES.UNKNOWN);
    const stray = unresolved.find((u) => ![ZONES.OWN, ZONES.UNPROTECTED].includes(cwdZone(u)));
    if (stray) return asking(stray);
    return { permission: "allow", why: "every unresolved operand is bounded by a directory this session is standing in" };
  }

  return { permission: "allow", why: "nothing protected is reached" };
}

/** The IO shell. Injectable end to end, so no test touches the live verification state. */
export function run({ hookInput, env = process.env, verify = verifySession, zone = zoneOf, home = homedir() } = {}) {
  const cwd = hookInput?.cwd ?? null;
  const resolved = resolveSessionRoot({ env, hookInput, cwd: cwd ?? process.cwd() });
  return decideShell({
    toolName: hookInput?.tool_name,
    toolInput: hookInput?.tool_input,
    sessionRoot: resolved.root,
    cwd,
    verify: () => verify({ env, hookInput, cwd: cwd ?? process.cwd(), persist: false }),
    zone,
    home,
    env,
  });
}

/** PreToolUse wire format. An allow says nothing at all; deny and ask both carry their reason. */
export function emit(decision, { write = (s) => process.stdout.write(s) } = {}) {
  if (!decision || decision.permission === "allow") return 0;
  write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.permission,
        permissionDecisionReason: decision.reason,
      },
    })}\n`,
  );
  return 0;
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase().endsWith("shell-ownership-assert.mjs");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // unreadable stdin is this hook's problem, not the session's
  }
  try {
    process.exit(emit(run({ hookInput: input })));
  } catch {
    process.exit(0); // §5: it fails open on its own errors, always
  }
}
