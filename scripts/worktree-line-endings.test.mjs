// Guard: this CHECKOUT's line endings must match the .gitattributes the repo already mandates.
//
// WHY THIS EXISTS. On 2026-08-26 the pre-push gate rejected on `claude-md-laws-guard`: CLAUDE.md
// measured 25 225 bytes against a 25 000 ceiling. I reported that failure to issue #224 as
// pre-existing on origin/main. It was not. Clean main measured 24 966 bytes and the same guard
// passed 21/21 there; this worktree had been checked out with CRLF endings despite
// `.gitattributes` saying `* text=auto eol=lf`, and 259 line terminators is exactly the 259-byte
// overrun. A worktree-local environment fault was published as a repository fact.
//
// The byte-budget guards (claude-md-laws-guard, doc-budget.ps1) all measure bytes ON DISK, which is
// the honest thing to measure -- Claude really does load the on-disk file. That makes every one of
// them silently wrong on a CRLF checkout. This guard is the one that names the cause, so the next
// session reads "your checkout is CRLF" instead of "CLAUDE.md is over budget".
//
// It deliberately does NOT read git config or .gitattributes to decide what is correct. It asks git
// what the attribute resolves to per path, then checks the bytes. A guard that re-derived the rule
// from the same config that produced the fault could not see the fault.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// latin1 throughout: these streams are NUL-separated path bytes, and any multi-byte decode would
// corrupt a path before it could be checked. Byte-per-char is the point.
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 1 << 28 }).toString("latin1");

/** Tracked paths whose resolved `eol` attribute is `lf`. */
function lfPaths() {
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  if (files.length === 0) return [];
  const out = execFileSync("git", ["check-attr", "--stdin", "-z", "eol"], {
    input: Buffer.from(files.join("\0"), "latin1"),
    maxBuffer: 1 << 28,
  }).toString("latin1");
  // -z output is a flat NUL-separated stream of (path, attr, value) triples.
  const fields = out.split("\0");
  const lf = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] === "lf") lf.push(fields[i]);
  }
  return lf;
}

describe("this checkout honours the repo's own line-ending contract", () => {
  it("declares eol=lf for a meaningful share of the tree — otherwise the rule below is vacuous", () => {
    // Falsifies the silent-pass shape: if check-attr parsing broke, the list would come back empty
    // and the real rule would go green having examined nothing.
    expect(lfPaths().length).toBeGreaterThan(100);
  });

  it("has no CRLF in any file git says must be LF", () => {
    const offenders = [];
    for (const p of lfPaths()) {
      let buf;
      try {
        buf = fs.readFileSync(p);
      } catch {
        continue; // sparse or otherwise absent from this checkout
      }
      // `* text=auto eol=lf` makes check-attr report eol=lf for PNGs and MP4s too -- the `auto`
      // half is decided at filter time, not at attribute-lookup time. Apply the same NUL test
      // git does, or every binary asset in docs/ reads as an offender.
      if (buf.includes(0)) continue;
      if (buf.includes("\r\n")) offenders.push(p);
      if (offenders.length >= 8) break; // enough to diagnose; the whole list is noise
    }
    expect(
      offenders,
      `${offenders.length}+ tracked file(s) carry CRLF although .gitattributes resolves them to ` +
        `eol=lf:\n  - ${offenders.join("\n  - ")}\n` +
        `This is a CHECKOUT fault, not a content fault, and it inflates every byte-budget guard in ` +
        `the repo by one byte per line. Do NOT trim content to make those budgets pass. Renormalize ` +
        `this working tree to LF, then rebuild this worktree's index from HEAD (git status keeps ` +
        `reporting phantom modifications from the stale stat cache until you do).`,
    ).toEqual([]);
  });
});
