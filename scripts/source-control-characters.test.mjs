import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { TREE_WALK_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";

// Every source file under scripts/, tools/, src/, docs/ and src-tauri/src/ must be plain text: no
// control character other than tab, newline and carriage return.
//
// bug -> guard, raised in review on PR #289. `scripts/case-endpoint-isolation.test.mjs` carried two
// RAW NUL bytes as a glob placeholder, so git classified the file binary and its diff read
// `Bin 0 -> 7046 bytes`. The one file whose whole job is to be auditable proof that a Tier 3 case
// receiver cannot reach a deploy path had no reviewable diff, and never would have — every later
// edit to that isolation boundary would have landed invisible. A second offender,
// `scripts/verify-release-state-guard.test.mjs`, carried a raw 0x01 the same way. Both are now
// written as \u escapes, which produce byte-identical runtime strings.
//
// Scope WAS deliberately scripts/ + tools/, with the widening owed to the commit that fixed #304.
// This is that commit, so the gap closes here rather than outliving the defect: `src` and `docs`
// join ROOTS, and `src-tauri/src` with them.
//
// `src` held the two worse offenders — a literal 0x08 where `\b` was meant, which turns the assertion
// around it into a no-op that still runs and still passes. `docs` is here because a second instance
// of the same class landed in one while #304 was open: a `sed -i` replacement carrying a Windows path
// fired GNU sed's OWN escapes, `\U` uppercasing the rest and `\c` writing a raw 0x0F into
// docs/BRANCH_DISPOSITIONS.md. It was caught by luck — the byte happened to land inside a path and
// broke a drive separator, so an unrelated rule failed. The same byte in prose, a table cell or a
// link title would have passed every gate in this repo. THIS rule would have caught it directly, and
// did not, only because docs/ was out of scope.
//
// `src-tauri/src` was not named in #304 and is added anyway: all four roots were measured at this
// head before widening, the Rust tree came back clean, and leaving the last source root out to match
// a sentence written before the measurement is how a half-closed gap gets recorded as handled.
//
// #512. Reading all ~1,350 files one open at a time cost 9.5s under the parallel pre-push gate and
// timed out once on 2026-09-23. One `git grep` now reads the same tree in a single process and names
// the files holding a byte this rule flags; only those are opened and reported here. The pattern is
// generated from isControl itself, and a fixture below proves, for every one of the 256 byte values,
// that git names a file exactly when offendersIn would flag it.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const ROOTS = ["scripts", "tools", "src", "docs", "src-tauri/src"];

// Files that are legitimately not text, excluded by a NAMED extension rather than by loosening the
// byte rule. This stopped being hypothetical when docs/ joined ROOTS: a spec asset there is an mp4,
// and every byte in it would otherwise be reported. Video and font entries earn their place the same
// way — a real fixture under a root, never a pre-emptive widening.
const BINARY = /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|ico|pdf|zip|exe|dll|wasm|mp4|webm|mov|m4v)$/i;

const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
const isControl = (byte) => (byte < 0x20 && !ALLOWED.has(byte)) || byte === 0x7f;

const tracked = (cwd = REPO) =>
  execFileSync("git", ["ls-files", "-z", ...ROOTS], { cwd, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\u0000")
    .filter(Boolean)
    .filter((f) => !BINARY.test(f));

const offendersIn = (bytes) => {
  const found = new Map();
  for (let i = 0; i < bytes.length; i += 1) {
    if (isControl(bytes[i])) {
      const key = bytes[i];
      if (!found.has(key)) found.set(key, []);
      if (found.get(key).length < 4) found.get(key).push(i);
    }
  }
  return found;
};

// Every byte isControl flags, as one PCRE character class. Built from the predicate rather than
// written out, so the two cannot drift apart.
const CONTROL_CLASS = `[${Array.from({ length: 0x80 }, (_, b) => b)
  .filter(isControl)
  .map((b) => `\\x${b.toString(16).padStart(2, "0")}`)
  .join("")}]`;

/**
 * The tracked files under ROOTS in which git finds a byte isControl flags. `-a` so a file git would
 * call binary is searched anyway -- a NUL is the very byte that makes it "binary". Exit 1 is git
 * grep's "searched, found nothing"; anything else it cannot answer throws, because an empty set from
 * a failed search would wave the whole tree through.
 */
const controlCandidates = (cwd = REPO) => {
  try {
    return new Set(
      execFileSync("git", ["grep", "-l", "-z", "-a", "-P", CONTROL_CLASS, "--", ...ROOTS], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      })
        .toString("utf8")
        .split("\u0000")
        .filter(Boolean),
    );
  } catch (e) {
    if (e?.status === 1 && !String(e.stderr ?? "").trim()) return new Set();
    throw e;
  }
};

const report = (cwd = REPO) => {
  const candidates = controlCandidates(cwd);
  const lines = [];
  for (const file of tracked(cwd)) {
    if (!candidates.has(file)) continue; // git read every byte and found none this rule flags
    const found = offendersIn(readFileSync(resolve(cwd, file)));
    for (const [byte, at] of found) {
      lines.push(
        `${file}: 0x${byte.toString(16).padStart(2, "0")} at ${at.join(", ")}` +
          ` -- write it as a \\u escape instead; the runtime string is identical and git can diff the file`,
      );
    }
  }
  return lines;
};

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("source files under every source root carry no raw control characters", () => {
  // #515: `git grep` over the whole tree rides the tree-walk budget, never the 15s default.
  it("finds no offender in any tracked file", { timeout: TREE_WALK_TIMEOUT_MS }, () => {
    expect(tracked().length).toBeGreaterThan(20);
    expect(report()).toEqual([]);
  });

  it("git names exactly the files offendersIn flags, for every byte value — fixture repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "control-chars-"));
    temps.push(repo);
    mkdirSync(join(repo, "scripts"));
    mkdirSync(join(repo, "elsewhere"));
    const bodies = {};
    for (let b = 0; b < 256; b += 1) bodies[`scripts/b${b.toString(16).padStart(2, "0")}.txt`] = [0x61, b, 0x62, 0x0a];
    // A control byte beside invalid or multi-byte UTF-8 -- the shapes a UTF-aware matcher could
    // swallow -- and at the very edges of a file.
    bodies["scripts/after-invalid.txt"] = [0xff, 0x01];
    bodies["scripts/after-truncated-lead.txt"] = [0xc3, 0x01];
    bodies["scripts/inside-truncated-seq.txt"] = [0xe2, 0x82, 0x01];
    bodies["scripts/after-valid-utf8.txt"] = [0xc3, 0xa9, 0x7f];
    bodies["scripts/first-byte.txt"] = [0x00, 0x61];
    bodies["scripts/last-byte.txt"] = [0x61, 0x0a, 0x1b];
    bodies["scripts/clean.txt"] = [0x61, 0x09, 0x62, 0x0d, 0x0a, 0xc3, 0xa9, 0x0a];
    bodies["elsewhere/out-of-scope.txt"] = [0x61, 0x01];
    for (const [name, bytes] of Object.entries(bodies)) writeFileSync(join(repo, name), Buffer.from(bytes));
    const fx = (...args) =>
      execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], {
        cwd: repo,
        stdio: ["ignore", "pipe", "pipe"],
      });
    fx("init", "-q");
    fx("add", "-A");

    const flagged = tracked(repo)
      .filter((f) => offendersIn(readFileSync(join(repo, f))).size > 0)
      .sort();
    expect([...controlCandidates(repo)].sort()).toEqual(flagged);
    // Non-vacuity: 30 single-byte offenders plus the six edge shapes, and never the clean file.
    expect(flagged).toHaveLength(36);
    expect(flagged).not.toContain("scripts/clean.txt");
    expect(report(repo)).toHaveLength(36);
  });

  it("actually detects one -- the detector is not vacuous", () => {
    // The defect this guard exists for is a pattern that still parses and still passes while
    // asserting nothing. A guard that cannot fail would be the same bug one level up.
    expect([...offendersIn(Buffer.from("ok\u0000ok", "utf8")).keys()]).toEqual([0x00]);
    expect([...offendersIn(Buffer.from("ok\u0008ok", "utf8")).keys()]).toEqual([0x08]);
    expect([...offendersIn(Buffer.from("ok\u007fok", "utf8")).keys()]).toEqual([0x7f]);
  });

  it("does not fire on tab, newline or carriage return", () => {
    expect(offendersIn(Buffer.from("a\tb\r\nc\n", "utf8")).size).toBe(0);
  });

  it("excludes binary by named extension, not by loosening the byte rule", () => {
    expect(BINARY.test("scripts/fixtures/sample.woff2")).toBe(true);
    expect(BINARY.test("scripts/case-endpoint-isolation.test.mjs")).toBe(false);
  });
});
