// Codex config guard - .codex/config.toml keeps getting rewritten, so the file defends itself now.
//
// TWICE, by two different lanes, the same regression appeared as an uncommitted working-tree change
// and had to be stashed rather than landed (stash@{1} 2026-08-20, stash@{0} 2026-08-21). Both
// reverted the 2026-07-19 lane-hardening train the same two ways, byte for byte: they re-added
// `[mcp_servers.shadcn]` running an unpinned `shadcn@latest`, and re-added the two `CLAUDE_CODE_*`
// env keys that configure Claude Code and do nothing for Codex. Neither lane authored the change;
// the Codex desktop app's external-agent IMPORT SYNC writes this file (#196). A global toggle to
// stop the sync (2026-08-24) did not hold either.
//
// So since 2026-09-04 the tracked file IS the sync's deterministic output, byte for byte, and the
// rewrite is a no-op. The sync re-serializes the TOML (dropping every comment line) and adds
// `[shell_environment_policy.set]` copied from `.claude/settings.json`'s `env` block and
// `[mcp_servers.shadcn]` copied from `.mcp.json`. This guard therefore pins the file to that shape,
// with each copied table asserted EQUAL TO ITS SOURCE rather than absent:
//
//   1. the advisory lane's floor: `sandbox_mode = "read-only"` and `approval_policy = "never"`, as
//      bare top-level keys BEFORE the first [table] header (below one, TOML silently makes them
//      that table's keys and the top-level setting is gone);
//   2. no `@latest` anywhere - the `.mcp.json` source is policed by mcp-config-guard.test.mjs, this
//      polices the copy;
//   3. the only MCP server table is `[mcp_servers.shadcn]`, and its args pin exactly the same
//      `package@version` string `.mcp.json` pins (a missing pin on either side fails);
//   4. `[shell_environment_policy.set]` holds exactly the keys and values of `.claude/settings.json`
//      `env` - the `CLAUDE_CODE_*` names are no-ops for Codex and are there only because the sync
//      copies them, so they must match the source or the sync will rewrite them;
//   5. no comment lines at all (the sync strips them; prose lives in .codex/README.md), and nothing
//      under `[shell_environment_policy]` but `inherit = "core"`;
//   6. `.codex/README.md` exists and mentions the import sync, so the prose cannot be silently lost.
//
// The file IS loaded: current Codex reads a project `.codex/config.toml` whenever the repository is
// trusted, and this one is (`trust_level = "trusted"` in the global config). There is no CODEX_HOME
// condition - an earlier version of this header said there was, and that was stale. A pass here is
// still not proof of how a given run was sandboxed (a runtime flag or the app's selector can sit
// above this file); it is proof that the default this checkout ships is the read-only floor.
//
// Parsing is deliberately naive (Node built-ins, line-based): the file is small, flat and generated,
// and a real TOML parser would be a dependency added to police a 16-line file.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(repoRoot, ".codex", "config.toml");
const README = join(repoRoot, ".codex", "README.md");
const MCP_JSON = join(repoRoot, ".mcp.json");
const SETTINGS = join(repoRoot, ".claude", "settings.json");

const rawLines = (toml) => toml.split(/\r?\n/);

/** Non-blank lines, minus whole-line comments. A line is a comment only when `#` is its first
 *  non-space character; a `#` anywhere else may sit inside a quoted value (`"a #1"`), so it is
 *  never stripped (review 2026-09-04). The live file has no comments (asserted below); the strip
 *  is for the fixtures in the falsification block, which still carry them. */
const isCommentLine = (line) => line.trimStart().startsWith("#");
const settings = (toml) =>
  rawLines(toml)
    .map((line) => (isCommentLine(line) ? "" : line.trim()))
    .filter(Boolean);

/** The lines above the first [table] header - TOML's bare-key region. */
const bareKeyRegion = (toml) => {
  const lines = settings(toml);
  const firstTable = lines.findIndex((l) => l.startsWith("["));
  return firstTable === -1 ? lines : lines.slice(0, firstTable);
};

/** table name -> its setting lines. "" is the bare-key region. Order of first appearance kept. */
const tables = (toml) => {
  const out = new Map([["", []]]);
  let current = "";
  for (const line of settings(toml)) {
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1].trim();
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    out.get(current).push(line);
  }
  return out;
};

/** `key = "string"` pairs of one table as a plain object. A line that is not one maps to null,
 *  so an unexpected shape shows up in the equality diff instead of vanishing. */
const stringPairs = (tableLines = []) =>
  Object.fromEntries(
    tableLines.map((line) => {
      const m = /^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"$/.exec(line);
      return m ? [m[1], m[2]] : [line, null];
    }),
  );

/** The quoted strings of a TOML string array under `key`, whether written on one line or many
 *  (the sync writes `args = [` / one string per line / `]`). null when the key is absent. */
const stringArray = (tableLines = [], key) => {
  const text = tableLines.join("\n");
  const at = text.indexOf(`${key} =`);
  if (at === -1) return null;
  const open = text.indexOf("[", at);
  const close = text.indexOf("]", open);
  if (open === -1 || close === -1) return null;
  return [...text.slice(open + 1, close).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
};

/** `pkg@1.2.3` - an exact version, never a dist-tag and never a range. */
const EXACT_PIN = /^@?[^@\s]+@\d+\.\d+\.\d+$/;
const pinOf = (args) => (Array.isArray(args) ? args.find((a) => EXACT_PIN.test(a)) ?? null : null);

const read = () => readFileSync(CONFIG, "utf8");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

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

describe("codex config: the shape the import sync writes, pinned to its sources (#196)", () => {
  it("pins every external command - no @latest anywhere", () => {
    const offenders = settings(read()).filter((l) => l.includes("@latest"));
    expect(
      offenders,
      "An unpinned @latest command means the next run executes whatever was published since. " +
        "Pin an exact version in .mcp.json (the sync copies it here) or drop the server.",
    ).toEqual([]);
  });

  it("carries exactly one MCP server table, [mcp_servers.shadcn], pinned to the same version .mcp.json pins", () => {
    const t = tables(read());
    const mcpTables = [...t.keys()].filter((k) => /^mcp_servers\b/.test(k));
    expect(mcpTables, "the sync copies .mcp.json's servers; any other table is a hand edit the sync will erase").toEqual([
      "mcp_servers.shadcn",
    ]);

    const source = json(MCP_JSON).mcpServers?.shadcn;
    expect(source, ".mcp.json must declare the shadcn server the sync copies").toBeTruthy();
    const sourcePin = pinOf(source.args);
    expect(sourcePin, ".mcp.json's shadcn entry must pin an exact package@version").not.toBeNull();

    const copy = t.get("mcp_servers.shadcn");
    const copyArgs = stringArray(copy, "args");
    const copyPin = pinOf(copyArgs);
    expect(copyPin, ".codex/config.toml's shadcn entry must pin an exact package@version").not.toBeNull();
    expect(copyPin, "the copy's pin must equal .mcp.json's pin, or the sync rewrites it").toBe(sourcePin);
    expect(copyArgs, "the args are copied whole, not just the pin").toEqual(source.args);
    expect(stringPairs(copy.filter((l) => /^command\s*=/.test(l))).command).toBe(source.command);
  });

  it("[shell_environment_policy.set] holds exactly the keys and values of .claude/settings.json env", () => {
    const env = json(SETTINGS).env;
    expect(env, ".claude/settings.json must carry an env block - it is the source the sync copies").toBeTruthy();
    const set = tables(read()).get("shell_environment_policy.set");
    expect(set, "the sync writes [shell_environment_policy.set]; without it the next rewrite adds it").toBeDefined();
    expect(
      stringPairs(set),
      "the CLAUDE_CODE_* keys are no-ops for Codex and exist only as the sync's copy of settings.json env; " +
        "a value that differs from the source is a diff the sync will undo",
    ).toEqual(env);
  });

  it("carries no comment lines - the sync strips them, so prose lives in .codex/README.md", () => {
    const comments = rawLines(read()).filter(isCommentLine);
    expect(comments, "a comment here is erased by the next import sync; put it in .codex/README.md").toEqual([]);
  });

  it("[shell_environment_policy] holds nothing but inherit = core", () => {
    expect(tables(read()).get("shell_environment_policy")).toEqual(['inherit = "core"']);
  });

  it("keeps .codex/README.md, which carries the prose this file can no longer hold", () => {
    expect(existsSync(README), ".codex/README.md is where the retired header's substance lives").toBe(true);
    expect(readFileSync(README, "utf8")).toMatch(/import sync/i);
  });
});

// -- Falsification ------------------------------------------------------------------------------
// A guard that has never been shown to fail is a guard nobody has tested. Each case is the literal
// shape of a regression: the floor pushed below a header, the stashed `shadcn@latest`, an env value
// that drifted from its source, and a comment - which the sync would erase on its next pass.
describe("codex config guard: it fires on the shapes that actually came back", () => {
  const FLOOR = ['sandbox_mode = "read-only"', 'approval_policy = "never"'].join("\n");

  it("catches sandbox_mode pushed below a table header", () => {
    const broken = `[shell_environment_policy]\ninherit = "core"\n${FLOOR}\n`;
    expect(settings(broken)).toContain('sandbox_mode = "read-only"'); // still LOOKS present
    expect(bareKeyRegion(broken).some((l) => l.startsWith("sandbox_mode ="))).toBe(false);
  });

  it("catches an unpinned MCP server, which trips both the @latest and the pin check", () => {
    const broken = `${FLOOR}\n\n[mcp_servers.shadcn]\ncommand = "npx"\nargs = ["shadcn@latest", "mcp"]\n`;
    expect(settings(broken).filter((l) => l.includes("@latest"))).toHaveLength(1);
    expect(pinOf(stringArray(tables(broken).get("mcp_servers.shadcn"), "args"))).toBeNull();
  });

  it("catches an env value that no longer matches its source", () => {
    const broken = `${FLOOR}\n\n[shell_environment_policy.set]\nCLAUDE_CODE_SUBAGENT_MODEL = "opus"\n`;
    expect(stringPairs(tables(broken).get("shell_environment_policy.set"))).not.toEqual(json(SETTINGS).env);
  });

  it("reads a multi-line args array the way the sync writes it", () => {
    const synced = `[mcp_servers.x]\nargs = [\n    "pkg@1.2.3",\n    "mcp",\n]\n`;
    expect(stringArray(tables(synced).get("mcp_servers.x"), "args")).toEqual(["pkg@1.2.3", "mcp"]);
  });

  it("treats a comment line as the violation it now is", () => {
    const commented = `# removed: [mcp_servers.shadcn] used "shadcn@latest"\n  # indented too\n${FLOOR}\n`;
    expect(rawLines(commented).filter(isCommentLine)).toHaveLength(2);
    // ...while the settings view still ignores its text, so a comment cannot fake a setting either.
    expect(settings(commented).filter((l) => l.includes("@latest"))).toEqual([]);
  });

  it("never strips a # inside a quoted value - only a whole-line comment is a comment", () => {
    // Review 2026-09-04: the old strip cut `(^|\s)#.*$`, so a value with a space-then-# lost its
    // tail and a pin like "shadcn@latest" hiding after one was invisible to the @latest check.
    const quoted = `${FLOOR}\n\n[mcp_servers.x]\ncommand = "npx"\nargs = ["pkg #1", "shadcn@latest"]\n`;
    expect(settings(quoted)).toContain('args = ["pkg #1", "shadcn@latest"]');
    expect(settings(quoted).filter((l) => l.includes("@latest"))).toHaveLength(1);
    expect(rawLines(quoted).filter(isCommentLine)).toEqual([]);
  });
});
