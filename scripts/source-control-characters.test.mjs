import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

const tracked = () =>
  execFileSync("git", ["ls-files", "-z", ...ROOTS], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
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

describe("source files under every source root carry no raw control characters", () => {
  it("finds no offender in any tracked file", () => {
    const files = tracked();
    expect(files.length).toBeGreaterThan(20);

    const report = [];
    for (const file of files) {
      const found = offendersIn(readFileSync(resolve(REPO, file)));
      for (const [byte, at] of found) {
        report.push(
          `${file}: 0x${byte.toString(16).padStart(2, "0")} at ${at.join(", ")}` +
            ` -- write it as a \\u escape instead; the runtime string is identical and git can diff the file`,
        );
      }
    }
    expect(report).toEqual([]);
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
