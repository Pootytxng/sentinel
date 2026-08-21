// Codex config guard — .codex/config.toml keeps getting rewritten, so the file defends itself now.
//
// TWICE, by two different lanes, the same regression appeared as an uncommitted working-tree change
// and had to be stashed rather than landed:
//
//   stash@{1}  2026-08-20, on feat/user-feedback-lab-recovery
//   stash@{0}  2026-08-21, on lane/rig-then-rails
//
// Both reverted the 2026-07-19 lane-hardening train the same two ways, byte for byte: they re-added
// `[mcp_servers.shadcn]` running an unpinned `shadcn@latest`, and re-added the two `CLAUDE_CODE_*`
// env keys that configure Claude Code and do nothing whatsoever for Codex. Neither lane authored the
// change on purpose; some tool writes this file. A third recurrence was predictable, and the
// standing law is that a rule which keeps getting broken becomes a guard rather than another
// paragraph — the file already carried the paragraph, in its own header comment, and the paragraph
// did not hold.
//
// The read-only floor below is asserted DEFENSIVELY, not because it was ever observed broken: both
// stashes left `sandbox_mode`/`approval_policy` intact and top-level. It is here because a rewrite
// that reorders this file is exactly what would break it, and it would break it silently.
//
// Scope is deliberately narrow. This guard asserts the FLOOR and the two named regressions, not the
// whole file: comments, ordering, formatting and any future key are free to change.
//
// NOT asserted, because the file says so itself and it is true: this config is not loaded unless
// CODEX_HOME points at this directory. The floor still has to be right — a scaffold that documents a
// read-only lane and does not encode one is worse than no scaffold — but nobody should read a pass
// here as proof of how a given Codex run was actually sandboxed.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(repoRoot, ".codex", "config.toml");

/** Strip full-line and trailing comments so the header's prose is never mistaken for a setting. */
const settings = (toml) =>
  toml
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "").trim())
    .filter(Boolean);

/** The lines above the first [table] header — TOML's bare-key region. */
const bareKeyRegion = (toml) => {
  const lines = settings(toml);
  const firstTable = lines.findIndex((l) => l.startsWith("["));
  return firstTable === -1 ? lines : lines.slice(0, firstTable);
};

const read = () => readFileSync(CONFIG, "utf8");

describe("codex config: the advisory lane's read-only floor", () => {
  it("declares sandbox_mode read-only and approval_policy never", () => {
    const lines = settings(read());
    expect(lines).toContain('sandbox_mode = "read-only"');
    expect(lines).toContain('approval_policy = "never"');
  });

  // This is the one that fails silently. Move either key below a [table] header and TOML reads it as
  // a member of that table, so the top-level setting is simply absent -- the file still LOOKS right.
  it("keeps both keys above the first [table] header, where TOML reads them as top-level", () => {
    const bare = bareKeyRegion(read());
    for (const key of ["sandbox_mode", "approval_policy"]) {
      expect(
        bare.some((l) => l.startsWith(`${key} =`)),
        `${key} must appear BEFORE the first [table] header; below one it silently becomes that ` +
          `table's key and the top-level setting is gone.`,
      ).toBe(true);
    }
  });
});

describe("codex config: the two regressions that keep coming back", () => {
  it("pins every external command — no @latest anywhere", () => {
    const offenders = settings(read()).filter((l) => l.includes("@latest"));
    expect(
      offenders,
      "An unpinned @latest command means the next run executes whatever was published since. " +
        "Pin an exact version or drop the server.",
    ).toEqual([]);
  });

  it("carries no MCP servers — Codex's role here is read-only audit and advice", () => {
    const offenders = settings(read()).filter((l) => /^\[mcp_servers\b/.test(l));
    expect(
      offenders,
      "AGENTS.md's lane split gives Codex read-only audit; UI-generation servers are outside it, " +
        "and v0 additionally spends owner-gated credits. Re-add only on an owner decision.",
    ).toEqual([]);
  });

  it("carries no CLAUDE_CODE_* keys — they configure Claude Code, not Codex", () => {
    const offenders = settings(read()).filter((l) => l.includes("CLAUDE_CODE_"));
    expect(
      offenders,
      "These are Claude Code env-var names. Setting them here does nothing; it only makes the file " +
        "look like it governs something it does not.",
    ).toEqual([]);
  });
});

// ── Falsification ────────────────────────────────────────────────────────────────────────────────
// A guard that has never been shown to fail is a guard nobody has tested. Cases 2 and 3 are the
// literal shape both stashes had — `[mcp_servers.shadcn]` on `shadcn@latest`, and the two
// `CLAUDE_CODE_*` keys. Case 1 is the failure that has not happened yet and would be invisible if
// it did.
describe("codex config guard: it fires on the shape that was actually stashed", () => {
  const FLOOR = ['sandbox_mode = "read-only"', 'approval_policy = "never"'].join("\n");

  it("catches sandbox_mode pushed below a table header", () => {
    const broken = `[shell_environment_policy]\ninherit = "core"\n${FLOOR}\n`;
    expect(settings(broken)).toContain('sandbox_mode = "read-only"'); // still LOOKS present
    expect(bareKeyRegion(broken).some((l) => l.startsWith("sandbox_mode ="))).toBe(false);
  });

  it("catches an unpinned MCP server, which trips both the @latest and the mcp_servers check", () => {
    const broken = `${FLOOR}\n\n[mcp_servers.shadcn]\ncommand = "npx"\nargs = ["shadcn@latest", "mcp"]\n`;
    expect(settings(broken).filter((l) => l.includes("@latest"))).toHaveLength(1);
    expect(settings(broken).filter((l) => /^\[mcp_servers\b/.test(l))).toHaveLength(1);
  });

  it("catches the no-op CLAUDE_CODE_* keys", () => {
    const broken = `${FLOOR}\n\n[shell_environment_policy.set]\nCLAUDE_CODE_SUBAGENT_MODEL = "sonnet"\n`;
    expect(settings(broken).filter((l) => l.includes("CLAUDE_CODE_"))).toHaveLength(1);
  });

  it("does not fire on a comment that merely discusses the banned shapes", () => {
    // The live file's header explains why @latest and the MCP servers were removed. Prose about a
    // ban must never read as the ban being violated, or the guard would fail on its own rationale.
    const commented = `# removed: [mcp_servers.shadcn] used "shadcn@latest"; CLAUDE_CODE_* did nothing\n${FLOOR}\n`;
    expect(settings(commented).filter((l) => l.includes("@latest"))).toEqual([]);
    expect(settings(commented).filter((l) => /^\[mcp_servers\b/.test(l))).toEqual([]);
    expect(settings(commented).filter((l) => l.includes("CLAUDE_CODE_"))).toEqual([]);
  });
});
