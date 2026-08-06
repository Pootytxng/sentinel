// @vitest-environment node
// Secret-containment guard — the mechanical half of LOCKED rule 4 ("the Ed25519 private key NEVER
// lives in the repo — not commits, `.env*`, CI, or unencrypted home").
//
// Written 2026-08-06 after the owner produced `compy-updater.key` from a Desktop folder and the
// containment audit found the rule was surviving on prose plus a single `*.gitignore` line. Two
// formats named IN the rule were not ignored at all: `.env` (verbatim in the rule text) and the
// `.pfx`/`.p12` a code-signing certificate arrives as. Nothing had leaked — but nothing mechanical
// was stopping it either, and "we checked once" is not a guard.
//
// This test does NOT read, open, or hash any private key. It asserts two things only:
//   1. the ignore patterns that make an accidental `git add` a no-op are present, and
//   2. no key material is currently tracked in the index.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
const lines = gitignore.split(/\r?\n/).map((l) => l.trim());

// Every extension a private key or signing certificate plausibly arrives as in THIS project:
// minisign/Tauri updater keys, the Pro license key, an Authenticode cert, and env files.
const REQUIRED_PATTERNS = [
  "secrets/",
  "*.key", // compy-updater.key, compy-license.key
  "*.pem",
  "*.pfx", // Authenticode code-signing certificate — open owner decision
  "*.p12",
  "*.jks",
  "*.keystore",
  ".env",
  ".env.*",
];

// Extensions that must never appear in the index. `.env.example`/`.env.sample` are deliberately
// re-included in .gitignore (they hold no values) and are excluded here for the same reason.
const TRACKED_SECRET_RE = /(^|\/)(\.env(\..+)?)$|\.(key|pem|pfx|p12|jks|keystore)$/i;
const SAMPLE_ENV_RE = /(^|\/)\.env\.(example|sample|template)$/i;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

describe("secret containment", () => {
  it("keeps every private-key and env pattern ignored", () => {
    // Exact-line match, not substring: `*.key` does not imply `*.pem`, and a comment mentioning a
    // pattern is not the pattern. Reported as a set so a bulk deletion shows every gap at once.
    const missing = REQUIRED_PATTERNS.filter((p) => !lines.includes(p));
    expect(missing, `.gitignore lost secret-containment patterns: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps sample env files reviewable", () => {
    // The negations must survive too — ignoring `.env.example` would hide the one env file that
    // SHOULD be reviewed, which is how required config quietly stops being documented.
    expect(lines).toContain("!.env.example");
    expect(lines).toContain("!.env.sample");
  });

  it("has no key material in the git index", () => {
    // The gitignore only helps if nothing slipped in before it existed. This is the assertion that
    // would actually catch a leak; the patterns above only make one harder to cause.
    const leaked = tracked.filter((f) => TRACKED_SECRET_RE.test(f) && !SAMPLE_ENV_RE.test(f));
    expect(leaked, `key material is tracked in git: ${leaked.join(", ")}`).toEqual([]);
  });

  it("still states the rule where the key is handled", () => {
    // Belt to the braces: release.ps1 is where the signing key is consumed, so the rule has to be
    // legible at the point of use, not only in CLAUDE.md.
    const release = readFileSync(join(root, "scripts", "release.ps1"), "utf8");
    expect(release).toContain("TAURI_SIGNING_PRIVATE_KEY");
  });
});
