// What makes a pre-push hook a USABLE GATE, in one place, so the static check and the live fleet
// check cannot drift apart.
//
// Before this existed the two questions were asked by different code to different standards:
// scripts/local-gate-guard.test.mjs read THIS checkout's tracked .githooks/pre-push and asserted
// its content; scripts/hookspath-fleet-guard.test.mjs walked every worktree's LIVE resolution and
// asserted only that some file was there. A guard that proves a path and a guard that proves
// content are not the same guard, and the gap between them is a file of the right name with the
// wrong bytes -- an empty file, a truncated file, a hook somebody edited to exit 0 while debugging.
// Path identity is not protection.
//
// WHAT IS DELIBERATELY *NOT* IN THE CONTRACT, and why. The first draft of this file also required
// the fail-closed branch at .githooks/pre-push:77-82 (`[ ! -f "$repo/scripts/verify-local.ps1" ]`).
// Measured against the live fleet before it was written into the repo, that rule failed 22 of 27
// worktrees. Every one of them was SAFE: their checkouts predate that branch, they all carry
// scripts/verify-local.ps1, their hooks run it, and `set -e` stops the push when it fails. The
// branch exists to replace an ugly powershell error with a sentence a human can act on -- read its
// own comment: "must say so rather than erroring out of powershell with a path nobody reads." It
// improves the MESSAGE on a push that was already going to be refused; it is not what makes the
// refusal happen. A contract that demanded it would have turned the whole fleet red for being old
// rather than for being unguarded, which is the precise failure this guard exists to avoid making.
//
// It is still required where it is load-bearing -- a checkout with no verify-local.ps1 of its own,
// which is the only situation the branch was written for. That check lives in hookspath-inspect.mjs
// because it needs to know about the checkout, not just the hook text.
//
// WHAT THIS FILE IS NOT: a sandbox. Every check below reads TEXT. Text cannot prove that a script
// executes anything -- a sufficiently determined author defeats any static rule here, and pretending
// otherwise would be the same overclaim this lane exists to delete. What it can do is catch the
// accidents and the drift that actually happen: an empty file, a debugging `exit 0`, a hook that
// names the verifier only in a comment, a refusal branch whose `exit 1` is unreachable. Each rule
// below exists because a specific seeded hook defeated its predecessor; the residual limits are
// stated at the bottom of this file rather than left for a reader to discover.
//
// Dependency-free, like both of its callers.

/** The verifier every gate must actually run. */
export const VERIFIER = "verify-local.ps1";

/** VERIFIER as a regex-safe literal. `.` is the only metacharacter it contains. */
const VERIFIER_RE = VERIFIER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Drop a trailing `#` comment from ONE line, leaving quoted `#` alone.
 *
 * Whole-line stripping was not enough. Independent review of this lane (Codex, at dba3c79c) seeded
 * `: # verify-local.ps1` -- a no-op command with the verifier's name in a trailing comment -- and the
 * whole-line filter kept the line, so the substring search found the name and reported a hook that
 * runs nothing as a valid gate. That is the same "a comment satisfied the guard" defect this file
 * already cites twice, one column to the right.
 *
 * A `#` opens a comment only when it is unquoted AND starts a word (column zero, or after
 * whitespace). That keeps `$#`, `${#x}` and `sha#1` intact, which a naive `indexOf("#")` would
 * silently truncate -- and truncating real code would make this guard fail OPEN, not closed.
 */
function stripTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i += 1; // \" inside "..." escapes; inside '...' nothing does
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") i += 1;
    else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * The EXECUTING shell only, comments removed. Every assertion below is about what runs, and this
 * repo has now been bitten three times by a guard a comment could satisfy: PR #268's
 * comment-stripper, the case-evidence tier guard, and this file's own first draft.
 */
export const shellCode = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map(stripTrailingComment)
    .join("\n");

/**
 * The same text with every QUOTED span blanked to spaces, character for character, so offsets into
 * it match offsets into shellCode() exactly.
 *
 * Two views are needed because the two questions disagree about quotes. Finding the verifier's
 * INVOCATION must keep them -- the real hook writes `-File "$repo/scripts/verify-local.ps1"`, and
 * blanking that would hide the very thing being looked for. Counting shell STRUCTURE must drop them:
 * re-review at 77af56e4 showed `echo "will exit 1"` certifying a hook that only prints the words,
 * and `echo "fi"` decrementing the block depth so an unreachable nested exit surfaced as reachable.
 * A diagnostic message is not syntax.
 *
 * The scan is over the WHOLE text, not line by line. Re-review at f82514b5 caught the line-by-line
 * version resetting the quote state at every newline, so a perfectly ordinary multi-line diagnostic
 *
 *     echo 'this repo has no verifier
 *     exit 1
 *     '
 *
 * parsed as executable syntax and certified a hook that only PRINTS the words "exit 1" as one that
 * refuses. That is the fail-open direction, the one direction this file may never be wrong in. A
 * shell string does not end at a newline and neither does this reader.
 *
 * A newline is never blanked, never opens or closes a quote, and never gets eaten as an escape:
 * line structure and character offsets both have to keep matching shellCode() exactly.
 */
function blankQuoted(text) {
  const src = String(text ?? "");
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === "\n") {
      out += c;
      continue;
    }
    const escapable = i + 1 < src.length && src[i + 1] !== "\n";
    if (quote) {
      out += " ";
      if (c === "\\" && quote === '"' && escapable) {
        out += " ";
        i += 1;
      } else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
      out += " ";
    } else if (c === "\\" && escapable) {
      out += "  ";
      i += 1;
    } else out += c;
  }
  return out;
}

/**
 * The command word of one shell segment, or "" when there isn't one.
 *
 * Read off the BLANKED view, never the real text, so a name inside a diagnostic string cannot pose
 * as the thing being run. Leading redirections (`>&2`, `2>/dev/null`) and environment assignments
 * (`FOO=1 echo ...`) are prefixes rather than commands, so they are stepped over instead of being
 * mistaken for one: `>&2 echo "..."` is still an echo.
 */
function commandWord(maskedSegment) {
  for (const token of maskedSegment.trim().split(/\s+/)) {
    if (!token) continue;
    if (/^\d*[<>]+&?\S*$/.test(token)) continue; // a redirection
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // an env assignment
    return token;
  }
  return "";
}

/** Commands that can only PRINT their arguments. A mention inside one of these is never a run. */
const PRINTERS = new Set(["echo", "printf", ":"]);

/**
 * Does this line RUN the verifier, as opposed to merely naming it in a message?
 *
 * Independent review of this lane (session `sentinel-21`, on PR #277) found the anchor below reading
 * the first textual MENTION, which is not the same question. A single
 *
 *     echo "about to run verify-local.ps1"
 *
 * near the top moved the anchor above a later `exit 0`, so the dead-code rule searched only the lines
 * above the echo and found nothing. Measured before the fix: with that echo the hook returned NO
 * violations; the identical hook without it returned the `exit 0` violation. One ordinary diagnostic
 * disarmed the rule, and a forgotten debugging `exit 0` is precisely the accident it exists for.
 *
 * `lastIndexOf` is the obvious repair and the wrong one. It fires on
 *
 *     powershell -File "$repo/scripts/verify-local.ps1"
 *     exit 0
 *     echo "finished verify-local.ps1"
 *
 * which is a correct hook — the gate ran, `set -e` covered its failure, the trailing `exit 0` is
 * ordinary — and reports it as dead code. That is the muted-guard failure this file already names
 * three times. So the anchor asks the narrower question instead: the first line that could actually
 * execute it.
 *
 * SEGMENTS, because a line is not one command. `echo "starting" && sh scripts/verify-local.ps1` does
 * run it, and the leading echo must not speak for the whole line. The split happens on the blanked
 * view, so an operator inside a string (`echo "a|b verify-local.ps1"`) is spaces and splits nothing.
 *
 * A segment carrying the name but no recognisable command word counts as a MENTION, not a run. That
 * is the fail-closed direction: an unrecognised mention pushes the anchor LATER, which can only widen
 * the region searched for dead code, and a hook whose every mention is unrecognised reports "never
 * invokes" rather than passing.
 */
function invokesVerifier(line, maskedLine) {
  const SPLIT = /\|\||&&|[;|&]/g;
  const bounds = [];
  let at = 0;
  let m;
  while ((m = SPLIT.exec(maskedLine))) {
    bounds.push([at, m.index]);
    at = m.index + m[0].length;
  }
  bounds.push([at, maskedLine.length]);

  return bounds.some(
    ([s, e]) =>
      line.slice(s, e).includes(VERIFIER) && !PRINTERS.has(commandWord(maskedLine.slice(s, e))),
  );
}

/**
 * Contract violations in a pre-push hook's text. Empty means it is a hook that can be trusted to
 * gate a push. Each string is written to be read by whoever has to fix it.
 */
export function prePushContractViolations(text) {
  const body = shellCode(text);
  const out = [];

  if (!body.trim()) {
    // An empty (or comment-only) file at the right path is the exact shape existsSync waves
    // through, and git runs it happily: no output, exit 0, push allowed.
    out.push("the file is empty, or contains nothing but comments — git runs it and allows every push");
    return out;
  }

  // Lines that RUN the verifier, with their offsets into `body`. Naming it is not running it.
  const lines = body.split("\n");
  const maskedLines = blankQuoted(body).split("\n");
  const invocations = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i += 1) {
    if (lines[i].includes(VERIFIER) && invokesVerifier(lines[i], maskedLines[i])) {
      invocations.push({ line: lines[i], at });
    }
  }

  const verifierAt = invocations.length ? invocations[0].at : -1;
  if (verifierAt < 0) {
    out.push(`it never invokes ${VERIFIER}, so it verifies nothing`);
  }

  // `set -e`: without it the script runs past a failing command and reaches its own exit 0, which
  // is a hook that reports success for a gate that failed.
  if (!/^\s*set\s+-[a-z]*e/m.test(body)) {
    out.push("it does not `set -e`, so a failing step does not stop the push");
  }

  // An UNCONDITIONAL `exit 0` before the verifier makes everything after it dead code -- the shape
  // a debugging session leaves behind. Indentation is the tell and it is a reliable one here: the
  // legitimate early exits in this hook (the deletion-only skip, the fail-closed refusal) are both
  // nested inside an `if` and therefore indented. A bare `exit 0` at column zero is not.
  if (verifierAt >= 0) {
    const before = body.slice(0, verifierAt);
    if (/^exit\s+0\s*$/m.test(before)) {
      out.push(`it hits an unconditional \`exit 0\` before reaching ${VERIFIER}, so the gate never runs`);
    }

    // `set -e` above and `set +e` below it is the same hook as one that never armed at all, and the
    // presence check further up cannot see the difference -- it asks whether the words appear, not
    // which of them ran last. Found by the same review as the anchor above; measured before the fix
    // as a hook that armed, disarmed, and then ran the gate, reported clean.
    //
    // Column zero for the same reason the `exit 0` rule uses it: an UNCONDITIONAL toggle. A `set +e`
    // indented inside an `if` is a deliberate, scoped suspension around one command, and firing on
    // that would fail a hook for being carefully written.
    const toggles = [...before.matchAll(/^set\s+([-+])[a-z]*e\b/gm)];
    if (toggles.length && toggles[toggles.length - 1][1] === "+") {
      out.push(
        `it turns error-exit back off with \`set +e\` before reaching ${VERIFIER}, so a failing step` +
          ` does not stop the push`,
      );
    }
  }

  // Invoking the verifier and CARING what it answered are two different things. `set -e` stops on a
  // failing command, but `cmd || :` is a command that succeeded, so `set -e` never fires and the
  // push proceeds on a red gate. Seeded by independent review at dba3c79c as
  // `powershell ... verify-local.ps1 || :`, which the previous contract accepted.
  // Only the lines that RUN it. A diagnostic quoting `|| true` swallows nothing, and failing a hook
  // over the contents of its own error message is the muted-guard direction again.
  for (const { line } of invocations) {
    if (/\|\|\s*(?::|true\b|exit\s+0\b)/.test(line)) {
      out.push(`it runs ${VERIFIER} but swallows a failure with \`|| :\`/\`|| true\`, so a red gate still pushes`);
    }
    if (/(^|[^&])&\s*$/.test(line)) {
      out.push(`it backgrounds ${VERIFIER} with \`&\`, so the push never waits for the gate's answer`);
    }
  }

  return out;
}

/**
 * Does this hook refuse outright when the verifier is missing? Only asked of a checkout that HAS
 * no verifier -- see the note at the top of this file about not demanding it everywhere.
 *
 * REACHABILITY, not just presence. The first version asked two independent questions -- "is there a
 * `[ ! -f ...verify-local.ps1 ]` test?" and "is there an `exit 1` anywhere?" -- which the same
 * review defeated with a hook where both were true and neither was connected:
 *
 *     if [ ! -f verify-local.ps1 ]; then :; fi
 *     if false; then exit 1; fi
 *
 * So the refusal must live INSIDE the branch that tests for the missing verifier, at that branch's
 * OWN level.
 *
 * The first attempt sliced to the next `fi` and claimed nesting could only make the answer stricter.
 * That claim was wrong, and re-review caught it at a9c895f7 with the mirror image of the case I had
 * reasoned about:
 *
 *     if missing; then if false; then exit 1; fi; fi
 *
 * Slicing to the FIRST `fi` captures the nested block, finds its unreachable `exit 1`, and answers
 * "refuses" — fail-OPEN, the one direction a guard may never be wrong in. Depth is now counted for
 * real: an `exit` only counts at depth 0, and the `fi` that takes depth below zero ends the branch.
 * A refusal genuinely nested inside a further conditional still reads as "does not refuse", which is
 * the conservative answer and is deliberate.
 */
const OPENERS = new Set(["if", "case", "while", "until", "for"]);

export function refusesWhenVerifierMissing(text) {
  const body = shellCode(text);
  const found = new RegExp(`\\[\\s*!\\s*-f[^\\]]*${VERIFIER_RE}[^\\]]*\\]`).exec(body);
  if (!found) return false;

  // Structure is counted over the BLANKED view, where a quoted `fi` or `exit 1` is just spaces.
  // Same length as `body`, so the offset found above still points at the end of the guard test.
  const region = blankQuoted(body).slice(found.index + found[0].length);

  // `elif` does not open a block and is not matched: \b before `if` cannot follow the `l`.
  const scan = /\b(if|case|while|until|for|fi|esac|done)\b|(?:^|[\s;&|])exit\s+([0-9]+)\b/g;
  let depth = 0;
  let m;
  while ((m = scan.exec(region))) {
    if (m[1] === undefined) {
      if (depth === 0 && Number(m[2]) > 0) return true; // a refusal at the branch's own level
    } else if (OPENERS.has(m[1])) {
      depth += 1;
    } else if ((depth -= 1) < 0) {
      return false; // this `fi` closed the branch, and nothing refused inside it
    }
  }
  return false;
}

// THE THREAT MODEL, because it decides which of these gaps get closed and which do not.
//
// This guard defends against ACCIDENT AND DRIFT, not against an adversary. That is not resignation,
// it is the only coherent reading: `git push --no-verify` skips the hook entirely, in six characters,
// with no forgery required. Anyone willing to craft a hook that LOOKS armed while gating nothing --
// a here-document wrapping the verifier's name, a `| cat` that discards its exit status, a comment
// hidden after a `;` operator -- could have typed those six characters instead and saved themselves
// the trouble. Hardening the text rules against that author buys nothing and costs a rule per round.
//
// What the fleet actually produces, and what this file is therefore built to catch, is the accident:
// an empty or truncated file, a debugging `exit 0` somebody forgot, a checkout too old to have a
// verifier, a hooksPath aimed at a directory that no longer exists. Two worktrees were pushing with
// zero verification for weeks on exactly that last shape, silently, which is why this lane exists.
// Every one of those is caught, and each was MEASURED against a seeded fixture rather than assumed.
//
// RESIDUAL LIMITS, stated rather than implied. This is a text contract. It cannot see a verifier
// invoked through a variable or alias, a `verify-local.ps1` that is itself a stub, a refusal reached
// only under a condition never true at push time, a here-document body, a backslash-continued line,
// or anything a subshell does. Independent re-review (a9c895f7) enumerated those and they are
// ACCEPTED, not overlooked -- see the threat model above. It also reads only an UNQUOTED, unescaped
// `exit <digits>`: re-review at f82514b5 measured `exit "1"` and `e\xit 1` as "does not refuse".
// Both do genuinely exit, so both are false NEGATIVES -- a real refusal called insufficient, never a
// missing one called sufficient. Left as measured, because the cost of being wrong in that direction
// is a sentence telling a developer to write his refusal plainly. Closing them soundly needs the hook
// EXECUTED against a stubbed verifier, which the fixtures could do and the live fleet must not:
// running 28 real hooks in order to audit them would be the audit causing the damage.
//
// Round 5 (`sentinel-21`, on PR #277) added two more, both accepted for the same reason. The
// invocation test reads a command WORD, so a verifier reached through `eval`, a function whose body
// names it, or a variable holding `echo` is a mention this file cannot classify -- each of those
// lands on "mention", which moves the anchor later and is the fail-closed direction. And the
// `set +e` rule reads unconditional toggles only: a disarm inside an `if` that never re-arms is
// invisible to it. Closing that needs the branch conditions evaluated, which is execution again.
//
// One gap in the same review is declined for a different and stronger reason. `HOME`,
// `XDG_CONFIG_HOME`, `APPDATA` and `USERPROFILE` also select a config file that could carry
// core.hooksPath, and hookspath-inspect.mjs deliberately does NOT scrub them: at push time git reads
// the developer's real HOME, so a guard that hid it would be answering about a machine that does not
// exist. The `GIT_CONFIG*` family IS scrubbed because it is an injected override this process may
// have inherited, not ambient user identity. Fidelity and hygiene point opposite ways there, and
// fidelity wins.
//
// A green result here means "nothing known-bad in the text", never "this push was verified".
