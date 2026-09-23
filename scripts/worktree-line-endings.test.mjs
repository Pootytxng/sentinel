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
//
// #488: this guard walks NOTHING at the push gate. It judges the checkout it runs in -- the one
// about to push -- and a peer checkout's CRLF is that checkout's own finding, for its own push. The
// issue listed it beside the three fleet-walking checks; reading it says otherwise, and it has read
// only its own tree since 5ee0de97. Under fleet mode (scripts/lib/fleet-scope.mjs) it judges every
// registered worktree instead, so `npm run fleet:hygiene` covers all four checks. A per-push walk
// of every tree was NOT added, on purpose: it would read every file in every checkout on every push
// to advertise a fault that nothing but that checkout's own push can act on.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";

import { fleetMode, foldersToJudge } from "./lib/fleet-scope.mjs";

/** The checkout this run is judging for its own push: the one vitest was started in. */
const OWN = process.cwd();

// latin1 throughout: these streams are NUL-separated path bytes, and any multi-byte decode would
// corrupt a path before it could be checked. Byte-per-char is the point.
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, maxBuffer: 1 << 28 }).toString("latin1");

/** Every registered worktree, as git lists them from `cwd`. Asked only under fleet mode. */
function registeredWorktrees(cwd) {
  return git(cwd, "worktree", "list", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

/** Tracked paths in `cwd` whose resolved `eol` attribute is `lf`. */
function lfPaths(cwd) {
  const files = git(cwd, "ls-files", "-z").split("\0").filter(Boolean);
  if (files.length === 0) return [];
  const out = execFileSync("git", ["check-attr", "--stdin", "-z", "eol"], {
    cwd,
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

/** Up to eight eol=lf files in `cwd` that carry CRLF on disk -- enough to diagnose; the whole list is noise. */
function crlfOffenders(cwd) {
  const offenders = [];
  for (const p of lfPaths(cwd)) {
    let buf;
    try {
      buf = fs.readFileSync(join(cwd, p));
    } catch {
      continue; // sparse or otherwise absent from this checkout
    }
    // `* text=auto eol=lf` makes check-attr report eol=lf for PNGs and MP4s too -- the `auto`
    // half is decided at filter time, not at attribute-lookup time. Apply the same NUL test
    // git does, or every binary asset in docs/ reads as an offender.
    if (buf.includes(0)) continue;
    if (buf.includes("\r\n")) offenders.push(p);
    if (offenders.length >= 8) break;
  }
  return offenders;
}

/** One folder at the gate; every registered one under fleet mode. The list is asked for only then. */
const judged = foldersToJudge({
  own: OWN,
  worktrees: fleetMode() ? registeredWorktrees(OWN) : undefined,
});

describe("this checkout honours the repo's own line-ending contract", () => {
  it("declares eol=lf for a meaningful share of the tree — otherwise the rule below is vacuous", () => {
    // Falsifies the silent-pass shape: if check-attr parsing broke, the list would come back empty
    // and the real rule would go green having examined nothing.
    expect(lfPaths(OWN).length).toBeGreaterThan(100);
  });

  it("has no CRLF in any file git says must be LF", () => {
    const offenders = judged.flatMap((cwd) => crlfOffenders(cwd).map((p) => ({ cwd, p })));
    console.log(`line endings: ${judged.length} folder(s) judged${fleetMode() ? " (fleet mode)" : ""}, ${offenders.length} CRLF offender(s)`);
    expect(
      offenders,
      `${offenders.length}+ tracked file(s) carry CRLF although .gitattributes resolves them to ` +
        `eol=lf:\n  - ${offenders.map((o) => `${o.p}  (in ${o.cwd})`).join("\n  - ")}\n` +
        `This is a CHECKOUT fault, not a content fault, and it inflates every byte-budget guard in ` +
        `the repo by one byte per line. Do NOT trim content to make those budgets pass. Renormalize ` +
        `that working tree to LF, then rebuild its index from HEAD (git status keeps ` +
        `reporting phantom modifications from the stale stat cache until you do).`,
    ).toEqual([]);
    // Declared, not discovered: one folder reads in a second or two, and the fleet sweep reads every
    // eol=lf file in every registered worktree (measured 2026-09-22: 24 folders, 48s), which is past
    // vitest's 15s default. The budget scales with what was asked for, so the gate keeps its default.
  }, Math.max(15_000, 5_000 * judged.length));

  it("#488: judges only this checkout at the push gate, and every registered worktree under fleet mode", () => {
    const worktrees = [OWN, join(OWN, "..", "some-other-lane")];
    expect(foldersToJudge({ own: OWN, worktrees, fleet: false })).toEqual([OWN]);
    expect(foldersToJudge({ own: OWN, worktrees, fleet: true })).toEqual(worktrees);
    // And the list this run actually judged is the one the mode says: one folder, or the fleet.
    expect(judged, "the gate judges one folder; the sweep judges every registered one").toEqual(
      fleetMode() ? registeredWorktrees(OWN) : [OWN],
    );
  });
});
