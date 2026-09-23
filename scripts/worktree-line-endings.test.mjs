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
//
// #512. Which files it READS is now narrowed by git too, and only in one direction. `git ls-files
// --eol` reports git's own count of the bytes on disk as `w/<class>`, from a raw read that no config
// or attribute touches. `lf` and `none` mean git counted ZERO CRLF pairs in the whole file, so
// those files cannot be offenders and are not re-read. Every other class -- crlf, mixed, -text, and
// the empty class git gives a missing file or a symlink -- is read here exactly as before. Reading
// all ~2,000 tracked files one open at a time cost 10.5-18s under the parallel pre-push gate, and
// timed out twice on 2026-09-23. The fixture describe at the bottom proves that git's classes still
// mean what this skip needs them to.
import { afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
import { fleetMode, foldersToJudge } from "./lib/fleet-scope.mjs";

/** The checkout this run is judging for its own push: the one vitest was started in. */
const OWN = process.cwd();

// latin1 throughout: these streams are NUL-separated path bytes, and any multi-byte decode would
// corrupt a path before it could be checked. Byte-per-char is the point.
const git = (args, cwd) =>
  execFileSync("git", args, { cwd, maxBuffer: 1 << 28 }).toString("latin1");

/** Every registered worktree, as git lists them from `cwd`. Asked only under fleet mode. */
function registeredWorktrees(cwd) {
  return git(["worktree", "list", "--porcelain"], cwd)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

// `i/<class> w/<class> attr/<attrs>\t<path>`, each class space-padded and possibly empty.
const EOL_RECORD = /^i\/\S*\s+w\/(\S*)\s+attr\/[^\t]*\t([\s\S]+)$/;

/** Classes under which git counted no CRLF pair in the working-tree bytes. */
const CRLF_FREE = new Set(["lf", "none"]);

/** Tracked paths whose resolved `eol` attribute is `lf`, each with git's class for its bytes on disk. */
function lfPaths(cwd) {
  const worktreeClass = new Map();
  for (const rec of git(["ls-files", "--eol", "-z"], cwd).split("\0").filter(Boolean)) {
    const m = EOL_RECORD.exec(rec);
    // A record this cannot parse is a path it cannot vouch for, so it fails rather than skipping.
    if (!m) throw new Error(`unrecognised \`git ls-files --eol\` record: ${JSON.stringify(rec)}`);
    worktreeClass.set(m[2], m[1]);
  }
  if (worktreeClass.size === 0) return [];
  const out = execFileSync("git", ["check-attr", "--stdin", "-z", "eol"], {
    cwd,
    input: Buffer.from([...worktreeClass.keys()].join("\0"), "latin1"),
    maxBuffer: 1 << 28,
  }).toString("latin1");
  // -z output is a flat NUL-separated stream of (path, attr, value) triples.
  const fields = out.split("\0");
  const lf = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] === "lf") lf.push({ path: fields[i], w: worktreeClass.get(fields[i]) ?? "" });
  }
  return lf;
}

/** The first few eol=lf files that carry CRLF on disk. `read` is a seam so a fixture can see what was opened. */
function crlfOffenders(paths, { cwd, read = fs.readFileSync } = {}) {
  const offenders = [];
  for (const { path: p, w } of paths) {
    if (CRLF_FREE.has(w)) continue; // git counted every byte and found no CRLF pair
    let buf;
    try {
      buf = read(cwd ? join(cwd, p) : p);
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
  return offenders;
}

/** One folder at the gate; every registered one under fleet mode. The list is asked for only then. */
const judged = foldersToJudge({
  own: OWN,
  worktrees: fleetMode() ? registeredWorktrees(OWN) : undefined,
});

// Every test below asks about the same trees at the same moment; ask git once per folder.
const live = new Map();
const liveLfPaths = (cwd) => {
  if (!live.has(cwd)) live.set(cwd, lfPaths(cwd));
  return live.get(cwd);
};

describe("this checkout honours the repo's own line-ending contract", () => {
  it("declares eol=lf for a meaningful share of the tree — otherwise the rule below is vacuous", () => {
    // Falsifies the silent-pass shape: if check-attr parsing broke, the list would come back empty
    // and the real rule would go green having examined nothing.
    expect(liveLfPaths(OWN).length).toBeGreaterThan(100);
    // #515: a whole-tree read (every tracked path, through ls-files and check-attr) rides the
    // tree-walk budget, never vitest's 15s default -- the parallel gate starves it past that.
  }, TREE_WALK_TIMEOUT_MS);

  it("has no CRLF in any file git says must be LF", () => {
    const offenders = judged.flatMap((cwd) => crlfOffenders(liveLfPaths(cwd), { cwd }).map((p) => ({ cwd, p })));
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
    // Declared, not discovered: one folder reads in seconds alone but 80s under the parallel gate on
    // 2026-09-23, and the fleet sweep reads every registered worktree (measured 2026-09-22: 24
    // folders, 48s). #515: every whole-tree walker rides the one tree-walk budget.
  }, TREE_WALK_TIMEOUT_MS);

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

// #512. The skip above trusts two of git's classes to mean "no CRLF pair anywhere in the file". That
// is falsified here on real bytes rather than assumed: a throwaway repo under the same attribute,
// one file per shape, written without conversion so the working tree keeps exactly what was written.
describe("git's working-tree classes mean what the skip needs — fixture repository", () => {
  const temps = [];
  afterAll(() => {
    for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads and flags every CRLF-bearing shape, and skips only the files git counted CRLF-free", () => {
    const repo = fs.mkdtempSync(join(tmpdir(), "line-endings-"));
    temps.push(repo);
    const files = {
      ".gitattributes": "* text=auto eol=lf\n",
      "lf.txt": "a\nb\n",
      "noeol.txt": "abc",
      "empty.txt": "",
      "crlf.txt": "a\r\nb\r\n",
      "mixed.txt": "a\r\nb\n",
      "cr-and-crlf.txt": "a\rb\r\n",
      "lone-cr.txt": "a\rb",
      "nul-and-crlf.bin": "a\0\r\nb",
    };
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(join(repo, name), Buffer.from(body, "latin1"));
    const fx = (...args) => git(["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], repo);
    fx("init", "-q");
    fx("add", "-A");

    const paths = lfPaths(repo);
    const classOf = Object.fromEntries(paths.map((e) => [e.path, e.w]));
    // The classes the skip is built on, pinned. If a git upgrade ever reports "lf" for a file
    // holding a CRLF pair, this is the assertion that says so.
    expect(classOf).toEqual({
      ".gitattributes": "lf",
      "lf.txt": "lf",
      "noeol.txt": "none",
      "empty.txt": "none",
      "crlf.txt": "crlf",
      "mixed.txt": "mixed",
      "cr-and-crlf.txt": "-text",
      "lone-cr.txt": "-text",
      "nul-and-crlf.bin": "-text",
    });

    const opened = [];
    const read = (p) => {
      opened.push(p.slice(repo.length + 1));
      return fs.readFileSync(p);
    };
    // Only CRLF-bearing text is an offender -- the NUL file keeps the old binary exemption.
    expect(crlfOffenders(paths, { cwd: repo, read }).sort()).toEqual(["cr-and-crlf.txt", "crlf.txt", "mixed.txt"]);
    // Every file git did not vouch for was opened; none it did was.
    expect(opened.sort()).toEqual(["cr-and-crlf.txt", "crlf.txt", "lone-cr.txt", "mixed.txt", "nul-and-crlf.bin"]);
  });
});
