import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// CLOSING-KEYWORD GUARD (#343).
//
// WHY THIS EXISTS — two real incidents, not a hypothetical:
//
//   PR #338's body explained an earlier accident and, in doing so, sat a GitHub closing keyword
//   next to a live issue number in ordinary prose. Merging #338 closed that unrelated issue as a
//   side effect, seconds after the merge, with nobody intending it. A hand-run scan afterward found
//   the same shape a second time: a commit explaining THIS incident wrote a sentence of the form
//   "this does not fix #N" — negation the human reader understands instantly and GitHub does not
//   parse at all. Landed on the default branch, that sentence closes #N exactly as a bare "fixes #N"
//   would. Two lanes, two writers who already knew the hazard, both caught it only by luck or by
//   having just written the check down.
//
// The owner's decision (recorded on #343): do not try to be clever about intent. A negated keyword
// reads as a promise to a human and as a command to GitHub — any guard that tries to tell those
// apart will get it wrong in exactly the cases that bite. So this flags the PATTERN, full stop, and
// leaves rewording to the author. The one legitimate case — a commit that genuinely means to close
// an issue and says so on purpose — gets a plain, greppable, line-scoped escape hatch, the same
// idiom `mutation-boundary-allow` uses elsewhere in this repo.
//
// Two halves, same split every guard here uses: a pure function so the pattern-matching itself is
// unit-testable and provably falsifiable (below), and a live scan that reads real commit messages —
// the ones this checkout is actually about to push — off git.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Line-scoped escape hatch: `git grep closing-keyword-allow` lists every place a commit message
// asserts a closing keyword on purpose, so the intent is on the record instead of guessed at.
const ALLOW_MARKER = "closing-keyword-allow";

// GitHub's own closing-keyword set, adjacent to a reference in any of the three shapes GitHub
// acts on: `#N`, `owner/repo#N`, and the full issue or pull URL. Case-insensitive — GitHub does
// not care about case, so neither does this. Deliberately NOT negation-aware: see the header above.
const NAME = "[A-Za-z0-9_.-]+";
const REFERENCE = `(?:#[0-9]+|${NAME}\\/${NAME}#[0-9]+|https?:\\/\\/github\\.com\\/${NAME}\\/${NAME}\\/(?:issues|pull)\\/[0-9]+)`;
const PATTERN = new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+${REFERENCE}`, "gi");

export function findClosingKeywordMatches(text) {
  const matches = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const m of line.matchAll(PATTERN)) {
      matches.push({ line: idx + 1, text: m[0] });
    }
  });
  return matches;
}

// ── Live half: the commits this checkout would actually push ──────────────────────────────────
//
// A merge-time scan is a catch, not a guard — by the time a PR body is read, a bad commit message
// may already be immutable on a shared ref (#343's own second incident: found already pushed, and
// only repairable by a force-push nobody wants to authorize). So this reads the SAME commits `git
// push` would send: whatever sits ahead of the configured upstream, or — for a branch that has never
// been pushed and so has no upstream yet — ahead of the merge-base with origin/main. Both are local,
// already-cached refs, exactly what a real pre-push hook receives from git itself; this does not
// fetch, on purpose, so it never blocks on network state a real push wouldn't either.
//
// A checkout with neither (no origin/main at all — an isolated clone or fixture) has nothing to
// compare against and is skipped rather than guessed at: resolvePushBase returns null,
// commitsAheadOfBase(null) is `[]`, and the scan below runs zero iterations. That is correct
// behaviour for that checkout, not a blind spot in this guard — the fixture tests above are what
// prove the pattern-matching itself can fail, and this file's own commit history carries the record
// of a real falsification run against the live half (see the commit that adds this file).

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

// Probing calls (does @{upstream} exist? does origin/main?) are expected to fail on plenty of
// legitimate checkouts — that is not an error, so its stderr must not read like one. stdio here
// silences it without touching `git()` above, which real callers still want to fail loudly.
function tryGit(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function resolvePushBase() {
  const upstream = tryGit(["rev-parse", "--verify", "@{upstream}"]);
  if (upstream) return upstream;
  const originMain = tryGit(["rev-parse", "--verify", "origin/main"]);
  if (!originMain) return null;
  return tryGit(["merge-base", "origin/main", "HEAD"]);
}

export function commitsAheadOfBase(base) {
  if (!base) return [];
  const shas = tryGit(["rev-list", `${base}..HEAD`]);
  if (!shas) return [];
  return shas.split("\n").filter(Boolean);
}

export function commitBody(sha) {
  return git(["show", "-s", "--format=%B", sha]);
}

// ── Fixture half: provably falsifiable, runs every time regardless of branch state ─────────────

describe("closing-keyword guard: pattern matching", () => {
  it("fires on the #338 -> #316 shape (positive control): a keyword landing beside a live issue in explanatory prose", () => {
    const body =
      "Explains an earlier mixup where the flags sentence sat a keyword next to #316, which fixes #316 by accident.";
    expect(findClosingKeywordMatches(body).length).toBeGreaterThan(0);
  });

  it("fires on a negated sentence — GitHub does not parse the negation, so this must not either (the #341 shape)", () => {
    const body = "This does not fix #341. Whether it should is a separate question, deferred here.";
    expect(findClosingKeywordMatches(body)).toEqual([{ line: 1, text: "fix #341" }]);
  });

  it("fires case-insensitively, on every keyword form GitHub recognizes", () => {
    const cases = [
      "Closes #1",
      "closed #2",
      "CLOSES #3",
      "Fix #4",
      "fixes #5",
      "FIXED #6",
      "Resolve #7",
      "resolves #8",
      "Resolved #9",
    ];
    for (const phrase of cases) {
      expect(findClosingKeywordMatches(phrase).length, phrase).toBe(1);
    }
  });

  it("fires on the two other reference shapes GitHub acts on: owner/repo#N and the full URL", () => {
    expect(findClosingKeywordMatches("Closes Pootytxng/sentinel#337 by accident")).toEqual([
      { line: 1, text: "Closes Pootytxng/sentinel#337" },
    ]);
    expect(findClosingKeywordMatches("fixes https://github.com/Pootytxng/sentinel/issues/337")).toEqual([
      { line: 1, text: "fixes https://github.com/Pootytxng/sentinel/issues/337" },
    ]);
    expect(findClosingKeywordMatches("Resolved http://github.com/Pootytxng/sentinel/pull/359, in prose")).toEqual([
      { line: 1, text: "Resolved http://github.com/Pootytxng/sentinel/pull/359" },
    ]);
    // A repository or URL with no number is not a reference; a URL with no keyword is a mention.
    expect(findClosingKeywordMatches("fixes Pootytxng/sentinel and closes https://github.com/Pootytxng/sentinel")).toEqual([]);
    expect(findClosingKeywordMatches("see https://github.com/Pootytxng/sentinel/issues/337 for the record")).toEqual([]);
  });

  it("does not fire on a bare issue mention with no adjacent keyword", () => {
    const body = "Second half of #291. #291 asked which of two shapes to take, and this is the answer.";
    expect(findClosingKeywordMatches(body)).toEqual([]);
  });

  it("does not fire when the keyword and the reference are not adjacent", () => {
    const body = "We fixed the bug described in #12 last week, well before this change.";
    expect(findClosingKeywordMatches(body)).toEqual([]);
  });

  it("does not fire on a word that merely contains the keyword as a substring", () => {
    const body = "This is a prefixes #5 disclose #6 unresolved #7 situation, none of which are the keyword.";
    expect(findClosingKeywordMatches(body)).toEqual([]);
  });

  it("respects the line-level escape hatch, and only for the marked line", () => {
    const body = [
      `Closes #123 ${ALLOW_MARKER}: deliberate — this lane owns #123 alone and means to close it`,
      "fixes #456 left unmarked on purpose, on the next line",
    ].join("\n");
    expect(findClosingKeywordMatches(body)).toEqual([{ line: 2, text: "fixes #456" }]);
  });

  it("matches per line, not across a line break", () => {
    const body = "This fixes\n#316 on a separate line";
    expect(findClosingKeywordMatches(body)).toEqual([]);
  });
});

describe("closing-keyword guard: live scan of commits this checkout would push", () => {
  it("finds no closing keyword next to an issue/PR number in any commit ahead of the push base", () => {
    const base = resolvePushBase();
    const shas = commitsAheadOfBase(base);
    const offenders = [];
    for (const sha of shas) {
      const matches = findClosingKeywordMatches(commitBody(sha));
      if (matches.length) offenders.push(`${sha.slice(0, 8)}: ${matches.map((m) => m.text).join(", ")}`);
    }
    expect(
      offenders,
      "A commit message pairs a closing keyword with an issue/PR number. GitHub acts on this the " +
        "moment the commit lands on the default branch, whatever the surrounding sentence means " +
        `(#316 and #341 both closed this way). Reword the sentence, or mark the exact line ` +
        `${ALLOW_MARKER} if the commit genuinely means to close that issue.`,
    ).toEqual([]);
  });
});
