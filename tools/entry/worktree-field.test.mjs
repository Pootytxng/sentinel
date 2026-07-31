// Guard: the Work Control `Worktree / branch` field must be machine-readable.
//
// Why this exists (spec §5.1, finding 8): the field is free text in three incompatible formats,
// so the entrypoint cannot mechanically check its own governing invariant. Guards 1, 3 and 4
// ("claimed A, session root B" / "correct folder, wrong branch" / "another writer owns the folder")
// are all comparisons against this field — they are blocked until it parses.
//
// Every legacy fixture below is a REAL value read off the board on 2026-07-30, not an invention.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_SEP,
  canonicalizePath,
  normalizeWorktreeField,
  parseWorktreeField,
  samePath,
} from "./worktree-field.mjs";

const CODE_ROOT = "C:\\Users\\Kuya\\code";
const opts = { codeRoot: CODE_ROOT };

describe("canonical form", () => {
  it("round-trips the canonical `<abs path> @ <branch>` form unchanged", () => {
    const raw = "C:\\Users\\Kuya\\code\\sentinel-workflow @ feat/single-entry-workflow";
    const norm = normalizeWorktreeField(raw, opts);
    expect(norm.ok).toBe(true);
    expect(norm.value).toBe(raw);
    expect(norm.changed).toBe(false);
    expect(norm.entries).toEqual([
      { path: "C:\\Users\\Kuya\\code\\sentinel-workflow", branch: "feat/single-entry-workflow" },
    ]);
  });

  it("splits on the LAST ` @ ` so a path containing @ cannot steal the separator", () => {
    const parsed = parseWorktreeField("C:\\Users\\Kuya\\code\\a@b @ feat/x", opts);
    expect(parsed.ok).toBe(true);
    expect(parsed.entries[0]).toEqual({ path: "C:\\Users\\Kuya\\code\\a@b", branch: "feat/x" });
  });

  it("uses a separator git can never produce, because refs cannot contain spaces", () => {
    expect(CANONICAL_SEP).toBe(" @ ");
    const parsed = parseWorktreeField("C:\\x @ feat/a b", opts);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("INVALID_BRANCH");
  });
});

describe("legacy format: `<abs path> / <branch>` (board items 14-17)", () => {
  it("splits on the FIRST ` / ` so a branch containing slashes survives", () => {
    const norm = normalizeWorktreeField(
      "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery",
      opts,
    );
    expect(norm.ok).toBe(true);
    expect(norm.entries[0]).toEqual({
      path: "C:\\Users\\Kuya\\code\\sentinel-feedback",
      branch: "feat/user-feedback-lab-recovery",
    });
    expect(norm.value).toBe(
      "C:\\Users\\Kuya\\code\\sentinel-feedback @ feat/user-feedback-lab-recovery",
    );
    expect(norm.changed).toBe(true);
  });

  it("normalizes item 17 without touching the preserved #17 worktree", () => {
    const norm = normalizeWorktreeField(
      "C:\\Users\\Kuya\\code\\sentinel-rel / codex/product-quality-blueprint",
      opts,
    );
    expect(norm.value).toBe(
      "C:\\Users\\Kuya\\code\\sentinel-rel @ codex/product-quality-blueprint",
    );
  });
});

describe("legacy format: `<leaf> · <branch>` (board items 10, 13)", () => {
  it("resolves a bare leaf name against the code root", () => {
    const norm = normalizeWorktreeField("sentinel-work-control-codex · codex/work-control", opts);
    expect(norm.ok).toBe(true);
    expect(norm.value).toBe(
      "C:\\Users\\Kuya\\code\\sentinel-work-control-codex @ codex/work-control",
    );
  });

  it("strips a trailing parenthetical note and REPORTS it rather than discarding it", () => {
    const norm = normalizeWorktreeField(
      "sentinel-codex-hygiene · codex/tool-shed-hygiene (preserve)",
      opts,
    );
    expect(norm.ok).toBe(true);
    expect(norm.entries[0].branch).toBe("codex/tool-shed-hygiene");
    expect(norm.notes).toEqual(["preserve"]);
  });
});

describe("ambiguity is refused, never guessed", () => {
  it("refuses board item 12's two-folder value (collision rule 4: unknown means locked)", () => {
    const raw = "sentinel + sentinel-feedback · exact active folder unknown/locked";
    const norm = normalizeWorktreeField(raw, opts);
    expect(norm.ok).toBe(false);
    expect(norm.code).toBe("AMBIGUOUS_MULTI_FOLDER");
    expect(norm.raw).toBe(raw);
  });

  it("refuses a value with no recognizable separator", () => {
    const norm = normalizeWorktreeField("sentinel-feedback", opts);
    expect(norm.ok).toBe(false);
    expect(norm.code).toBe("NO_SEPARATOR");
  });

  it("gives every refusal a human reason, because the reason is the remediation line", () => {
    for (const raw of ["sentinel-feedback", "a + b · unknown", "C:\\x @ bad branch"]) {
      const norm = normalizeWorktreeField(raw, opts);
      expect(norm.ok).toBe(false);
      expect(typeof norm.reason).toBe("string");
      expect(norm.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("empty and multi-entry", () => {
  it("treats an empty or `none` field as a legal empty value, not an error", () => {
    for (const raw of ["", "   ", "none", "None"]) {
      const norm = normalizeWorktreeField(raw, opts);
      expect(norm.ok).toBe(true);
      expect(norm.value).toBe("none");
      expect(norm.entries).toEqual([]);
    }
  });

  it("parses deliberate multi-entry values separated by ` ; `", () => {
    const norm = normalizeWorktreeField("C:\\x\\a @ feat/a ; C:\\x\\b @ feat/b", opts);
    expect(norm.ok).toBe(true);
    expect(norm.entries).toHaveLength(2);
    expect(norm.entries[1]).toEqual({ path: "C:\\x\\b", branch: "feat/b" });
  });
});

describe("path canonicalization", () => {
  it("uppercases the drive letter, uses backslashes, and drops a trailing separator", () => {
    expect(canonicalizePath("c:/users/kuya/code/sentinel-rel/")).toBe(
      "C:\\users\\kuya\\code\\sentinel-rel",
    );
  });

  it("compares case-insensitively but stores the casing it was given", () => {
    // Windows path comparison is case-insensitive, but casing still matters: run-vitest.mjs exists
    // because a lowercase drive letter loaded vitest twice. Compare loosely, store exactly.
    expect(samePath("C:\\Users\\Kuya\\code\\x", "c:\\users\\kuya\\CODE\\x")).toBe(true);
    expect(samePath("C:\\Users\\Kuya\\code\\x", "C:\\Users\\Kuya\\code\\y")).toBe(false);
    const norm = normalizeWorktreeField("c:\\Users\\Kuya\\code\\Sentinel-Rel @ feat/x", opts);
    expect(norm.entries[0].path).toBe("C:\\Users\\Kuya\\code\\Sentinel-Rel");
  });

  it("treats forward and backslash separators as the same folder", () => {
    expect(samePath("C:/Users/Kuya/code/x", "C:\\Users\\Kuya\\code\\x")).toBe(true);
  });
});

describe("branch validation mirrors git's own ref rules", () => {
  it.each([
    ["feat/single-entry-workflow", true],
    ["codex/product-quality-blueprint", true],
    ["release/v0.9.9-candidate", true],
    ["main", true],
    ["feat/a b", false],
    ["", false],
    ["/leading", false],
    ["trailing/", false],
    ["double//slash", false],
    ["dot..dot", false],
    ["tilde~1", false],
    ["caret^1", false],
    ["colon:x", false],
    ["question?", false],
    ["star*", false],
    ["back\\slash", false],
    ["ends.lock", false],
  ])("branch %s valid=%s", (branch, valid) => {
    const parsed = parseWorktreeField(`C:\\x @ ${branch}`, opts);
    expect(parsed.ok).toBe(valid);
    if (!valid) expect(["INVALID_BRANCH", "NO_SEPARATOR"]).toContain(parsed.code);
  });
});
