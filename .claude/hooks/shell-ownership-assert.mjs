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

/**
 * Split a token stream into segments at chain operators, keeping each segment's redirect targets.
 *
 * In the powershell dialect a BARE `{` or `}` is also a boundary, so a scriptblock body is its own
 * segment. Without that, `Invoke-Command -ScriptBlock { Remove-Item <sibling> }` read its verb as
 * `Invoke-Command` and came back "names no recognized mutation" — allowed — while the bash spelling
 * `bash -c "rm -f <the same path>"` was refused, because `bash` is opaque and the embedded-path scan
 * runs on its body. Same literal write, same machine, opposite answers, and the ALLOWED one was in
 * this machine's primary shell. Found by independent review of #279; the lexer already emitted the
 * body as ordinary words, so nothing here needs to parse PowerShell — the checker just has to look.
 *
 * This covers `Invoke-Command`, `Start-Job`, `ForEach-Object` and `%` without a cmdlet allowlist, which is
 * the point: an allowlist would be one more table to fall behind. Splitting is safe because a
 * scriptblock body is a command list in its own right — the same thing a segment already models.
 * QUOTED braces are NOT boundaries: the token's `raw` still carries its quotes, so `Write-Host "{"`
 * stays one segment and cannot be used to split a command in half.
 */
export function segments(tokens, dialect = "posix") {
  const isBrace = (t) =>
    dialect === "powershell" && t.type === "word" && (t.value === "{" || t.value === "}") && t.raw === t.value;
  const out = [];
  let current = { words: [], redirects: [] };
  const flush = () => {
    if (current.words.length || current.redirects.length) out.push(current);
    current = { words: [], redirects: [] };
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (isBrace(t)) {
      flush();
      continue;
    }
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
  "diff-index", "help", "version", "bisect-log", "show-ref", "show-branch",
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
  if (verb === "branch" || verb === "tag") {
    // A listing flag makes the positional a PATTERN, not a name: `git tag -l 'v*'` reads tags, it
    // does not create one. Requiring every word to be a flag called that a mutation and refused a
    // read — the false-deny shape that gets a guard deleted rather than fixed. Without a listing
    // flag a positional IS a name to create (`git tag v1.0`), so that stays a mutation.
    const flags = after.filter((a) => a.startsWith("-"));
    const listing = flags.length > 0 && flags.every((a) => LISTING_ONLY.test(a));
    return listing || after.length === 0;
  }
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
const OPAQUE = new Set(["node", "python", "python3", "py", "ruby", "perl", "pwsh", "powershell", "powershell.exe", "cmd", "bash", "sh", "zsh", "eval", "start"]);

const CD_VERBS = new Set(["cd", "pushd", "set-location", "chdir"]);

/**
 * Wrappers whose own argv names the command that actually runs. `env rm -f ../sib/x` is ONE literal
 * write with one literal target; reading `env` as the verb is the same evasion as reading `VAR=1` as
 * one, and it was the plainest hole in the first cut of this guard (#279 review): four spellings of
 * the same write, one refused. `env`/`xargs` reached the class-3 tail and passed on an owned CWD
 * while the operand that mattered sat in a sibling; `sudo`/`command` were in no table at all, so a
 * segment whose SECOND word was `rm` came back "names no recognized mutation".
 *
 * Flag grammar per wrapper, because guessing past a flag is how the verb moves one word and the
 * checker does not follow. `flags` take no value; `values` take the next word (or an attached
 * `--long=v` / `-oV`); `assignments` allows `VAR=v` before the command; `duration` is a leading
 * positional that is a time; `positional: n` swallows n leading non-flag words of any shape,
 * capped at n, and keeps walking flags after them; `inspect` PRINTS instead of running;
 * `opaque` hands the command over as
 * a string this lexer does not evaluate. A flag in none of them is not guessed at: it becomes an
 * unresolved class-2 write, because which word is the command is genuinely unknowable from the text.
 */
export const PREFIX_VERBS = new Map([
  ["env", { flags: ["-i", "-0", "-v", "--ignore-environment", "--null", "--debug"], values: ["-u", "-C", "--unset", "--chdir"], assignments: true, opaque: ["-S", "--split-string"] }],
  ["sudo", { flags: ["-b", "-E", "-H", "-i", "-K", "-k", "-n", "-P", "-S", "-A", "-e", "-s"], values: ["-u", "-g", "-p", "-C", "-h", "-r", "-t", "-T", "-D", "-R", "--user", "--group", "--prompt", "--close-from", "--host", "--role", "--type", "--command-timeout", "--chdir", "--chroot"], assignments: true, inspect: ["-l", "-v", "-V", "--list", "--validate", "--version"] }],
  ["doas", { flags: ["-n", "-s", "-L"], values: ["-u", "-a", "-C"] }],
  ["command", { flags: ["-p"], inspect: ["-v", "-V"] }],
  // A multi-call binary, and the cheapest hole in the table: the applet IS the command, sitting in
  // the command position with nothing between. `busybox rm -f <sibling>` was ALLOWED outright,
  // because `busybox` names no recognized mutation and the checker never read the next word — not
  // an ambiguity it reported, a silent allow. No positional grammar is needed here; stepping over
  // the verb is the whole cure. `busybox sh -c "…"` lands on `sh` and stays class 3, exactly as a
  // bare `sh -c` does, because the applet inherits nothing from the wrapper.
  ["busybox", { inspect: ["--help", "--list"] }],
  // The lock file sits where chrt puts a priority — but it is a PATH, so no pattern can screen it,
  // and `flock /tmp/lock rm -f <sibling>` read `/tmp/lock` as the command and allowed the write.
  // Two things separate this from the numeric positionals above. It matches any non-flag word, so
  // it is capped at one and consumed only once. And flags continue AFTER it — `flock /tmp/l -c
  // "…"` is the documented form — so the walk keeps going rather than stopping on the next word.
  ["flock", { flags: ["-s", "--shared", "-x", "--exclusive", "-u", "--unlock", "-n", "--nb", "--nonblock", "-o", "--close", "-F", "--no-fork", "--verbose"], values: ["-w", "--wait", "--timeout", "-E", "--conflict-exit-code"], opaque: ["-c", "--command"], inspect: ["-h", "--help", "-V", "--version"], positional: 1 }],
  ["nohup", {}],
  // The username, and the second user of `positional`. `su root rm -f <sibling>` read `root` as the
  // command; the write behind it was never looked at. Two spellings matter and both are covered:
  // `-c` takes the command as a string (found by the embedded-path scan), and a bare `su root rm …`
  // lands the walk on `rm`. Real `su` hands trailing words to the login shell rather than execing
  // them, so treating `rm` as the command is stricter than the shell is — deliberately, because the
  // error that costs something here is missing a write, not refusing a form nobody uses.
  ["su", { flags: ["-", "-l", "--login", "-m", "-p", "--preserve-environment", "-P", "--pty", "-f", "--fast"], values: ["-s", "--shell", "-g", "--group", "-G", "--supp-group", "-w", "--whitelist-environment"], opaque: ["-c", "--command", "--session-command"], inspect: ["-h", "--help", "-V", "--version"], positional: 1 }],
  ["setsid", { flags: ["-f", "-w", "-c", "--fork", "--wait", "--ctty"] }],
  ["nice", { values: ["-n", "--adjustment"], numeric: true }],
  ["ionice", { flags: ["-t", "--ignore"], values: ["-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid", "--pgid", "--uid"] }],
  // `priority` is chrt's leading positional, exactly the shape `timeout`'s duration has: `chrt -f 10 rm -f x`
  // put the verb one word past where a flag walk stops, so the step read `10` as the command, found no
  // recognized mutation and ALLOWED the write. Same defect as the wrapper hole itself, one word right.
  ["chrt", { flags: ["-f", "-b", "-o", "-r", "-i", "-d", "-a", "-R", "-m"], values: ["-p", "-T", "-P"], priority: true }],
  // A CPU mask sits exactly where `chrt` puts a priority and `timeout` puts a duration — the same
  // shape a third time, and it failed the same way: `taskset 0x3 rm -f <sibling>` read the mask as
  // the command and the write was never seen. Hex (`0x3`) or a list/range (`0`, `0,1`, `0-3`), and
  // taken greedily but only while the word still LOOKS like a mask — `taskset rm -f x` must land on
  // `rm`, and the test pins that: a MASK loosened to match any word ate the `rm` silently.
  ["taskset", { flags: ["-a", "--all-tasks"], values: ["-c", "--cpu-list", "-p", "--pid"], mask: true }],
  ["time", { flags: ["-p", "--portability", "-v", "--verbose"], values: ["-o", "-f", "-a", "--output", "--format", "--append"] }],
  ["timeout", { flags: ["--preserve-status", "--foreground", "-v", "--verbose"], values: ["-s", "-k", "--signal", "--kill-after"], duration: true }],
  ["stdbuf", { values: ["-i", "-o", "-e", "--input", "--output", "--error"] }],
  // The step-over reaches the argv TEMPLATE only. `find … | xargs rm -f` names no operand there, so
  // it lands unresolved rather than clean; the stdin form stays class 3 and the tests say so.
  ["xargs", { flags: ["-0", "--null", "-r", "--no-run-if-empty", "-t", "--verbose", "-p", "--interactive", "-x", "--exit"], values: ["-a", "-d", "-E", "-e", "-I", "-i", "-L", "-l", "-n", "-P", "-s", "--arg-file", "--delimiter", "--eof", "--replace", "--max-lines", "--max-args", "--max-procs", "--max-chars"] }],
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DURATION = /^\d+(\.\d+)?[smhd]?$/;
/** taskset's leading CPU mask: hex, or a decimal list/range. Leading only, and matched once. */
const MASK = /^(0x[0-9a-fA-F]+|[0-9]+([-,][0-9]+)*)$/;

/**
 * Walks leading assignments and wrapper verbs off the front of a segment and reports where the real
 * command starts. `stop` is set when there is no real command to find: `"nothing"` (the wrapper
 * printed), `"opaque"` (the command is a string), `"unparsed"` (a flag whose arity is unknown).
 */
export function stepPrefixes(words) {
  let head = 0;
  let wrapper = null;
  for (;;) {
    while (head < words.length && ASSIGNMENT.test(words[head].value)) head += 1;
    if (head >= words.length) return { head, wrapper, stop: null };
    if (words[head].dynamic) return { head, wrapper, stop: null };
    const spec = PREFIX_VERBS.get(words[head].value.replace(/\.exe$/i, "").toLowerCase());
    if (!spec) return { head, wrapper, stop: null };
    wrapper ??= words[head].value.replace(/\.exe$/i, "").toLowerCase();
    head += 1;
    const flags = new Set(spec.flags ?? []);
    const values = new Set(spec.values ?? []);
    const inspect = new Set(spec.inspect ?? []);
    const opaque = new Set(spec.opaque ?? []);
    let sawDuration = false;
    let sawPositional = false;
    let positionals = 0;
    while (head < words.length) {
      const w = words[head].value;
      if (w === "--") {
        head += 1;
        break;
      }
      if (!w.startsWith("-")) {
        if (spec.assignments && ASSIGNMENT.test(w)) {
          head += 1;
          continue;
        }
        if (spec.duration && !sawDuration && DURATION.test(w)) {
          sawDuration = true;
          head += 1;
          continue;
        }
        if (spec.priority && !sawPositional && /^\d+$/.test(w)) {
          sawPositional = true;
          head += 1;
          continue;
        }
        // Greedy, unlike the duration and priority positionals above, and the difference is
        // deliberate AND measured: made one-shot, the walk stops on the second mask-shaped word,
        // treats THAT as the command, and `rm -f <sibling>` becomes a mere argument of something
        // unrecognised — which the checker allows. `taskset 0x3 0-1 rm -f <sibling>` went from deny
        // to allow under a one-shot version. The test pins it, so this line cannot quietly relax.
        if (spec.mask && MASK.test(w)) {
          head += 1;
          continue;
        }
        // Shape-blind, so it is COUNTED instead. A lock file is a path and a username is a name;
        // neither can be told from a command by looking at it, which is exactly why the cap is the
        // whole safety property. Uncapped, this swallows the command itself and every write behind
        // a `flock` goes unseen — measured, and the tests pin the count in both directions.
        if (spec.positional && positionals < spec.positional) {
          positionals += 1;
          head += 1;
          continue;
        }
        break; // this word is the command
      }
      const eq = w.indexOf("=");
      const bare = eq > 1 ? w.slice(0, eq) : w;
      const short2 = !w.startsWith("--") && w.length > 2 ? w.slice(0, 2) : null;
      if (opaque.has(bare)) return { head, wrapper, stop: "opaque", flag: w };
      if (inspect.has(bare)) return { head, wrapper, stop: "nothing", flag: w };
      if (flags.has(bare)) head += 1;
      else if (values.has(bare)) head += eq > 1 ? 1 : 2;
      else if (short2 && values.has(short2)) head += 1;
      else if (spec.numeric && /^-\d/.test(w)) head += 1;
      else if (short2 && [...w.slice(1)].every((c) => flags.has(`-${c}`))) head += 1;
      else return { head, wrapper, stop: "unparsed", flag: w };
    }
    if (head >= words.length) return { head, wrapper, stop: null };
  }
}

/**
 * The claim/adoption entrypoint is never in the way of itself. A refusal prints
 * `node tools/entry/cli.mjs adopt …` as the cure, and a guard that then asks for approval to run its
 * own cure has turned "run this" into "open a window and start over" — the exact failure the
 * write-refusal spec was built to avoid. Per SEGMENT, so `cli.mjs adopt; rm -rf ../other` still has
 * its second half judged on its own.
 */
const ENTRY_CLI = /(^|[\\/])tools[\\/]entry[\\/](cli|adopt|claim|launch)\.mjs$/;

/** Interpreters that can RUN the entry CLI. The exemption is theirs; `cp` and `rm` do not inherit it. */
const INTERPRETERS = new Set(["node", "python", "python3", "py", "pwsh", "powershell", "bash", "sh"]);

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

/** Punctuation that would re-lex into something other than one plain word. `find -exec` hands its
 *  command back to this analyzer as TEXT, so a word carrying any of these would come back as a
 *  DIFFERENT command than the one that ran — those are refused, not guessed at. Globs are absent on
 *  purpose: re-lexing marks them dynamic, and `globBounded` already answers for them correctly. */
const RELEX = new Set([" ", "\t", "\n", "'", '"', "`", "$", "\\", ";", "|", "&", "<", ">", "(", ")", "#"]);

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

  for (const seg of segments(lex(stripHeredocs(command), dialect), dialect)) {
    const words = seg.words;
    for (const r of seg.redirects) {
      if (r.dynamic && !globBounded(r)) cannot("redirection", `the redirect target \`${r.value}\` is not knowable from the text`);
      else at(expandHome(r.value, home), "redirection");
    }
    if (!words.length) continue;

    // `VAR=1 rm -rf …` runs `rm`, and so do `sudo rm -rf …` and `env rm -rf …`. Reading the
    // assignment or the wrapper as the verb is how a command hides from a verb-driven checker in the
    // plainest way there is, so both are stepped over before the verb is read.
    const step = stepPrefixes(words);
    const head = step.head;
    if (step.stop === "nothing") continue; // `sudo -v`, `command -v rm`: it printed, it did not run
    if (step.stop) {
      for (const p of words.flatMap((w) => embeddedPaths(w.value))) at(p, step.wrapper, "embedded");
      if (step.stop === "opaque") cannot(step.wrapper, "it hands the command over as a string this checker does not evaluate", "opaque");
      // A flag this table does not carry may or may not swallow the next word, so which word is the
      // command is not knowable from the text. That is class 2, not the class-3 tail: guessing is
      // exactly how the verb moves one word while the checker keeps watching the wrapper.
      else cannot(step.wrapper, `the flag \`${step.flag}\` may or may not take a value, so which command it runs is not knowable from the text`);
      continue;
    }
    if (head >= words.length) continue; // a segment that only sets variables writes nothing

    const verb = words[head].value.replace(/\.exe$/i, "").toLowerCase();
    const rest = words.slice(head + 1);
    const operandsOf = (ws) => ws.filter((w) => !w.value.startsWith("-"));
    /** The verb itself came out of a variable (`$cmd file`, `& $cmd file`), so which command runs is
     *  not knowable from the text. Falling through would file it under "names no recognized
     *  mutation", which is the one thing it demonstrably is not evidence of. */
    const verbUnknown = words[head].dynamic;

    // Matching an OPERAND excused `cp tools/entry/cli.mjs ../sibling/…` — a write into a checkout this
    // session does not own, waved through because the word it mentioned happened to be the cure.
    if (INTERPRETERS.has(verb) && ENTRY_CLI.test((operandsOf(rest)[0]?.value ?? "").replace(/\\/g, "/"))) continue;

    if (verbUnknown) {
      for (const p of words.flatMap((w) => embeddedPaths(w.value))) at(p, verb, "embedded");
      cannot(verb, "the command it runs is not knowable from the text", "opaque");
      continue;
    }

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

    // `find` is the last hole in §6 and the only one that is not a wrapper at all. Its command sits
    // MID-ARGV — `-exec … ;` runs a second command with the matches as its arguments — and `-delete`
    // writes without naming a command anywhere. `stepPrefixes` cannot help: nothing in the leading
    // words says a write is coming. So, like `git` above, it gets its own extraction. Measured
    // before any of this was written, all eight forms were ALLOWED, including
    // `find . -name x -exec rm -f <sibling>/y ;`, whose target is a plain literal with no `{}` in it.
    if (verb === "find") {
      // Leading options, then the path operands, then the expression. `-D` takes a value and `-O2`
      // carries its own; every other `-` word opens the expression, as do `(`, `!` and `,`.
      let i = 0;
      const paths = [];
      for (; i < rest.length; i += 1) {
        const v = rest[i].value;
        if (v === "-H" || v === "-L" || v === "-P" || /^-O[0-9]*$/.test(v)) continue;
        if (v === "-D") {
          i += 1;
          continue;
        }
        if (v.startsWith("-") || v === "(" || v === "!" || v === ",") break;
        paths.push(rest[i]);
      }
      // A `find` with no path operand searches `.`, which is a real directory and this session's
      // own — not nothing. Defaulting it is what keeps `find -delete` from reading as targetless.
      const searched = paths.length ? paths : [{ value: ".", dynamic: false }];
      const expr = rest.slice(i);
      const targetOf = (w, why) => {
        if (w.dynamic && !globBounded(w)) cannot(why, `the operand \`${w.value}\` is not knowable from the text`);
        else at(expandHome(w.value, home), why);
      };

      for (let j = 0; j < expr.length; j += 1) {
        const p = expr[j].value;
        // find's OWN writing primaries. `-delete` names no target because its targets are what it
        // searched, which is the whole reason the path operands had to be separated out above.
        if (p === "-delete") {
          for (const s of searched) targetOf(s, "find -delete");
          continue;
        }
        if (p === "-fprintf" || p === "-fls" || p === "-fprint" || p === "-fprint0") {
          const f = expr[j + 1];
          j += 1;
          if (!f) cannot(`find ${p}`, "it names no target this checker can see");
          else targetOf(f, `find ${p}`);
          continue;
        }
        if (p !== "-exec" && p !== "-execdir" && p !== "-ok" && p !== "-okdir") continue;

        // The command runs to `;` or `+`. A bare `;` has already ended the segment upstream, so most
        // of the time the terminator is simply absent and the command runs to the end.
        const start = j + 1;
        let end = start;
        while (end < expr.length && expr[end].value !== ";" && expr[end].value !== "+") end += 1;
        const cmd = expr.slice(start, end);
        j = end;
        if (!cmd.length) {
          cannot(`find ${p}`, "it names no command this checker can see");
          continue;
        }

        // Re-entry is what reads `-exec sudo rm -f …` and `-exec git -C … checkout` as what they
        // are, rather than as a second table that would drift from the first. It goes back through
        // the TEXT, so a word carrying shell punctuation would re-lex into something else — those
        // fail closed instead of being guessed at, and so does a path that cannot be spelled as an
        // argument. `{}` is find's placeholder for each match, so the real target of
        // `-exec rm -f {} ;` is what find SEARCHED: one sub-command per path operand.
        // Deliberately NOT gated on `w.dynamic`: re-lexing reads a `$VAR` back as dynamic and a
        // bounded glob back as bounded, which is a better answer than refusing both. Gating on it
        // turned `find . -exec rm -f *.log ;` into an ask, and every test stayed green while it did.
        const joinable = (w) => ![...w.value].some((c) => RELEX.has(c));
        const holes = cmd.some((w) => w.value.includes("{}"));
        for (const s of holes ? searched : [null]) {
          if (s && !joinable(s)) {
            cannot(`find ${p}`, `the path \`${s.value}\` is not knowable as an argument of the command it runs`);
            continue;
          }
          const sub = s ? cmd.map((w) => ({ ...w, value: w.value.split("{}").join(s.value) })) : cmd;
          if (!sub.every(joinable)) {
            cannot(`find ${p}`, "the command it runs is not knowable from the text");
            continue;
          }
          // Bounded without a depth cap: the sub-command is strictly shorter than the command that
          // carried it, since `find`, its path operands and `-exec` are all dropped before re-entry.
          // A cap was written first and deleted on measurement — it only ever weakened the answer,
          // turning a nested `find -exec find <sibling> -delete` from a deny into an ask.
          const inner = analyze(sub.map((w) => w.value).join(" "), { cwd: here, dialect, home });
          // `-execdir` and `-okdir` run in the directory HOLDING each match, not in this one, so a
          // relative target there resolves somewhere this checker cannot name. Absolute targets are
          // unaffected — that is exactly the split `cwdUnknown` already encodes.
          const elsewhere = p === "-execdir" || p === "-okdir";
          const carry = (e) => ({ ...e, verb: `find ${p} ${e.verb}`, cwd: here, cwdUnknown: cwdUnknown || elsewhere });
          for (const op of inner.ops) ops.push(carry(op));
          for (const u of inner.unresolved) unresolved.push(carry(u));
        }
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
        // PowerShell splatting (`$p = @{Path='…'}; Remove-Item @p`) hands the target over inside a
        // hashtable this checker never sees. `@p` carries no `$`, so it is not `dynamic`, and
        // resolving it as a path answered confidently about a file named `@p` in the session's own
        // root — an ALLOW on a write into a sibling. Splatting is ordinary PowerShell, not evasion.
        const splat = dialect === "powershell" && /^@[A-Za-z_@]/.test(value);
        if (splat || (w.dynamic && !globBounded(w))) {
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
