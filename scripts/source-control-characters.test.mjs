import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Every source file under scripts/ and tools/ must be plain text: no control character other than
// tab, newline and carriage return.
//
// bug -> guard, raised in review on PR #289. `scripts/case-endpoint-isolation.test.mjs` carried two
// RAW NUL bytes as a glob placeholder, so git classified the file binary and its diff read
// `Bin 0 -> 7046 bytes`. The one file whose whole job is to be auditable proof that a Tier 3 case
// receiver cannot reach a deploy path had no reviewable diff, and never would have — every later
// edit to that isolation boundary would have landed invisible. A second offender,
// `scripts/verify-release-state-guard.test.mjs`, carried a raw 0x01 the same way. Both are now
// written as \u escapes, which produce byte-identical runtime strings.
//
// Scope is deliberately scripts/ + tools/. `src/` holds two more offenders and they are WORSE: a
// literal 0x08 where `\b` was meant, which silently turns the assertion around it into a no-op.
// Fixing those changes what those tests assert and may surface a real product finding, so they are
// filed as issue #304 rather than folded in here. Widen ROOTS to include "src" in the commit that
// fixes #304 -- the scope gap should close with the defect, not outlive it.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const ROOTS = ["scripts", "tools"];

// Files that are legitimately not text. Nothing under ROOTS matches today; the list exists so a
// future binary fixture is excluded by a NAMED extension rather than by loosening the byte rule.
const BINARY = /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|ico|pdf|zip|exe|dll|wasm)$/i;

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

describe("source files under scripts/ and tools/ carry no raw control characters", () => {
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
