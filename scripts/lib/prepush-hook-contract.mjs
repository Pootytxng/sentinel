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
// Dependency-free, like both of its callers.

/** The verifier every gate must actually run. */
export const VERIFIER = "verify-local.ps1";

/**
 * Strip `#` comment lines. Every assertion below is about EXECUTING shell, and this repo has been
 * bitten twice by a guard a comment could satisfy: PR #268's comment-stripper and the case-evidence
 * tier guard both let commented-out code count as the real thing.
 */
export const shellCode = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

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

  const verifierAt = body.indexOf(VERIFIER);
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
  }

  return out;
}

/**
 * Does this hook refuse outright when the verifier is missing? Only asked of a checkout that HAS
 * no verifier -- see the note at the top of this file about not demanding it everywhere.
 */
export function refusesWhenVerifierMissing(text) {
  const body = shellCode(text);
  const guarded = new RegExp(`\\[\\s*!\\s*-f[^\\]]*${VERIFIER.replace(".", "\\.")}[^\\]]*\\]`).test(body);
  return guarded && /\bexit\s+1\b/.test(body);
}
