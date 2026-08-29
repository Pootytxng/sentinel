// MCP declaration guard — every MCP server this repo declares runs a PINNED command.
//
// Issue #203. `scripts/codex-config-guard.test.mjs` has banned `shadcn@latest` inside
// `.codex/config.toml` since 2026-08-21, in its own words: *"An unpinned @latest command means the
// next run executes whatever was published since. Pin an exact version or drop the server."* That
// guard polices a COPY. The declaration it was written about originates in `.mcp.json`, which no
// guard read at all — so the rule held in the file nobody edits and was free in the file everyone
// does. That is the same defect this repo has already been bitten by once, when `plain-language-guard`
// scanned 199 `.tsx?` files and none of the 18 locale files it existed to police: **a guard's file
// filter can be narrower than its name, and nothing says so out loud.**
//
// So this one does not take a file path as a given. It DISCOVERS every MCP declaration in the repo
// (§ "where declarations live" below) and fails if a new one appears anywhere it does not look —
// adding `foo.mcp.json` tomorrow cannot quietly escape the rule.
//
// What is asserted:
//   1. No floating dist-tag (`@latest`, `@next`, `@canary`, `@beta`, `@rc`, `@dev`, `@experimental`)
//      anywhere in a declared command or its arguments.
//   2. Anything launched through a package RUNNER (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `deno run`)
//      names an exact version — `pkg@4.19.0`, never a bare `pkg` (which resolves to `latest`) and
//      never a range (`^4`, `~4.19`, `4.x`, `>=4`), which is a floating tag wearing digits.
//
// What is NOT asserted, deliberately: whether a server SHOULD be declared, whether it is enabled
// (`.claude/settings*.json` owns that), and what version is current. A pin going stale is a
// maintenance question; a pin being absent is a supply-chain one, and only the second is a guard's
// business.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Dist-tags npm resolves at RUN time. Every one of them is "whatever was published since". */
const FLOATING_TAGS = ["latest", "next", "canary", "beta", "rc", "dev", "experimental"];

/**
 * Argv[0] values that FETCH a package and execute it, rather than running something already
 * installed. `pnpm`/`yarn` only qualify behind their `dlx` sub-command — `pnpm install` installs
 * from a lockfile and is not a run-time fetch, so treating the bare binary as a runner would report
 * findings against shapes that carry no floating risk at all.
 */
const RUNNERS = { npx: null, bunx: null, pnpx: null, pnpm: "dlx", yarn: "dlx" };

// ── where declarations live ────────────────────────────────────────────────────────────────────
// Two shapes, both keyed `mcpServers`: the portable `.mcp.json` at the repo root (Claude Code's
// project-scope file, checked in and shared) and any settings JSON under `.claude/`. Discovery walks
// the tree rather than naming paths so a third home cannot appear unpoliced.

/**
 * Every file THIS repo checks in that could carry an `mcpServers` block.
 *
 * The listing is `git ls-files`, not a directory walk, and that is load-bearing. The first run of
 * this guard went red on
 * `.claude/worktrees/merge-prs-tauri-visibility-c5660e/.mcp.json` — a nested git worktree parked on
 * an old commit, whose checkout still holds the pre-fix `shadcn@latest`. That file is a historical
 * checkout, not a declaration this repo makes; failing on it would make the guard a function of who
 * has a worktree open. What the repo DECLARES is what it tracks.
 */
export function discoverCandidates(root, list = trackedFiles) {
  return list(root)
    .filter((p) => p.endsWith(".mcp.json") || (isUnder(p, ".claude") && p.endsWith(".json")))
    .map((p) => join(root, p));
}

const isUnder = (posixPath, dir) => posixPath === dir || posixPath.startsWith(`${dir}/`);

/** `git ls-files` returns forward-slash paths on every platform, which is why filtering is posix. */
function trackedFiles(root) {
  return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64e6 })
    .split("\0")
    .filter(Boolean);
}

/**
 * Flatten a parsed config into `{ server, argv }` rows. Tolerates a file with no `mcpServers` key
 * (most `.claude/*.json` files) and a server declared with no args.
 */
export function declarations(parsed) {
  const servers = parsed && typeof parsed === "object" ? (parsed.mcpServers ?? {}) : {};
  return Object.entries(servers).map(([server, def]) => ({
    server,
    argv: [def?.command, ...(Array.isArray(def?.args) ? def.args : [])].filter(
      (v) => typeof v === "string",
    ),
  }));
}

/** `pkg@1.2.3` → exact. Scoped names keep their leading `@`, so split on the LAST one. */
export function versionSpec(token) {
  const at = token.lastIndexOf("@");
  if (at <= 0) return { name: token, version: null };
  return { name: token.slice(0, at), version: token.slice(at + 1) };
}

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * The finding list for one argv. Empty array = pinned.
 *
 * A runner's package is argv[1] — except `pnpm dlx` / `yarn dlx` / `deno run`, where argv[1] is the
 * sub-command and the package is argv[2]. Resolved positionally rather than by regex over the whole
 * line, so `--yes` between runner and package is a MISS, not a false pass: an unrecognised shape
 * reports itself instead of being waved through.
 */
export function findings({ server, argv }) {
  const out = [];

  for (const token of argv) {
    const { name, version } = versionSpec(token);
    if (version && FLOATING_TAGS.includes(version)) {
      out.push(`${server}: "${token}" resolves ${name} to whatever "${version}" points at today`);
    }
  }

  const [runner, ...rest] = argv;
  if (!runner) return out;
  const base = runner.replace(/\.(cmd|exe|ps1)$/i, "").split(/[\\/]/).pop();
  if (!(base in RUNNERS)) return out;

  const words = rest.filter((a) => !a.startsWith("-"));
  const sub = RUNNERS[base];
  // `pnpm install` is not a fetch-execute. Only the declared sub-command makes it one.
  if (sub !== null && words[0] !== sub) return out;
  const pkg = sub === null ? words[0] : words[1];

  if (pkg === undefined) {
    out.push(`${server}: "${argv.join(" ")}" runs ${base} with no package to pin — shape unrecognised`);
    return out;
  }

  const { name, version } = versionSpec(pkg);
  if (version === null) {
    out.push(`${server}: "${pkg}" has no version, so ${base} resolves it to @latest at run time`);
  } else if (!FLOATING_TAGS.includes(version) && !EXACT_SEMVER.test(version)) {
    out.push(`${server}: "${pkg}" pins a RANGE, not a version — it floats the same way @latest does`);
  }

  return out;
}

// ── the live repo ───────────────────────────────────────────────────────────────────────────────

const files = discoverCandidates(repoRoot).filter(existsSync);

const parsedDeclarations = files.flatMap((file) => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return []; // a malformed .claude/*.json is another guard's problem, not a pin question
  }
  return declarations(parsed).map((d) => ({ ...d, file: relative(repoRoot, file) }));
});

describe("MCP declarations: every server runs a pinned command", () => {
  it("finds the declaration files rather than trusting a hard-coded path", () => {
    // The failure this asserts against is a guard that silently scans nothing. If discovery ever
    // returns an empty set, that is a finding in itself — `.mcp.json` may legitimately be deleted
    // (issue #203 disposition 2), but `.claude/settings.json` is tracked and always present.
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => relative(repoRoot, f))).toContain(join(".claude", "settings.json"));
  });

  it("declares no floating dist-tag and no unpinned runner package", () => {
    const offenders = parsedDeclarations.flatMap((d) =>
      findings(d).map((f) => `${d.file} → ${f}`),
    );
    expect(
      offenders,
      "An unpinned command means the next run executes whatever was published since. " +
        "Pin an exact version or drop the server. (issue #203)",
    ).toEqual([]);
  });

  it("keeps the root .mcp.json in agreement with itself if it exists at all", () => {
    const root = join(repoRoot, ".mcp.json");
    if (!existsSync(root)) return; // removal is a valid disposition, not a failure
    const decls = declarations(JSON.parse(readFileSync(root, "utf8")));
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) expect(findings(d)).toEqual([]);
  });
});

// ── falsification: each control fails exactly the check it should ──────────────────────────────
// A guard that has never been shown to go red is a guard nobody has tested. Every control below is
// the real shape, not a paraphrase — the first is byte-for-byte what `.mcp.json` carried until
// 2026-08-25.

describe("MCP declaration guard: it fires on the shapes that were actually shipped", () => {
  const decl = (args, command = "npx") =>
    declarations({ mcpServers: { shadcn: { command, args } } })[0];

  it("catches the live shape this issue was filed about", () => {
    expect(findings(decl(["shadcn@latest", "mcp"]))).toHaveLength(1);
    expect(findings(decl(["shadcn@latest", "mcp"]))[0]).toMatch(/whatever "latest" points at/);
  });

  it("catches every other floating dist-tag, not only @latest", () => {
    for (const tag of FLOATING_TAGS) {
      expect(findings(decl([`shadcn@${tag}`, "mcp"])), tag).toHaveLength(1);
    }
  });

  it("catches a bare package name — npx resolves it to @latest with no tag written down", () => {
    expect(findings(decl(["shadcn", "mcp"]))).toHaveLength(1);
    expect(findings(decl(["shadcn", "mcp"]))[0]).toMatch(/no version/);
  });

  it("catches a semver RANGE, which floats while looking pinned", () => {
    for (const range of ["^4.19.0", "~4.19", "4.x", ">=4", "4"]) {
      expect(findings(decl([`shadcn@${range}`, "mcp"])), range).toHaveLength(1);
    }
  });

  it("passes the exact pin that replaced it", () => {
    expect(findings(decl(["shadcn@4.19.0", "mcp"]))).toEqual([]);
    expect(findings(decl(["shadcn@4.19.0-canary.3", "mcp"]))).toEqual([]);
  });

  it("keeps a scoped package's own @ out of the version split", () => {
    expect(versionSpec("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
    expect(findings(decl(["@scope/pkg@1.2.3", "mcp"]))).toEqual([]);
    expect(findings(decl(["@scope/pkg", "mcp"]))).toHaveLength(1);
  });

  it("reads past a runner flag instead of mistaking it for the package", () => {
    expect(findings(decl(["--yes", "shadcn@4.19.0", "mcp"]))).toEqual([]);
    expect(findings(decl(["--yes", "shadcn", "mcp"]))).toHaveLength(1);
  });

  it("resolves the package past a sub-command runner", () => {
    expect(findings(decl(["dlx", "shadcn@4.19.0", "mcp"], "pnpm"))).toEqual([]);
    expect(findings(decl(["dlx", "shadcn", "mcp"], "pnpm"))).toHaveLength(1);
    expect(findings(decl(["dlx", "shadcn@latest", "mcp"], "yarn"))).toHaveLength(1);
  });

  it("does NOT treat `pnpm install` as a fetch-execute — only its dlx sub-command is one", () => {
    expect(findings(decl(["install"], "pnpm"))).toEqual([]);
    expect(findings(decl(["run", "mcp"], "pnpm"))).toEqual([]);
  });

  it("reports an unrecognised runner shape rather than passing it", () => {
    expect(findings(decl(["--yes"]))).toHaveLength(1);
    expect(findings(decl(["--yes"]))[0]).toMatch(/shape unrecognised/);
  });

  it("leaves a NON-runner command alone — a local binary is not a supply-chain fetch", () => {
    expect(findings(decl(["serve"], "node"))).toEqual([]);
    expect(findings(decl(["--stdio"], "./bin/local-server"))).toEqual([]);
  });

  it("resolves a runner named by absolute path or .cmd shim, the way Windows spawns it", () => {
    expect(findings(decl(["shadcn", "mcp"], "C:\\Program Files\\nodejs\\npx.cmd"))).toHaveLength(1);
    expect(findings(decl(["shadcn@4.19.0", "mcp"], "/usr/local/bin/npx"))).toEqual([]);
  });

  it("still catches a floating tag in a non-runner argv", () => {
    // `node ./x.js --pkg foo@latest` is not a runner invocation, but the tag is still live.
    expect(findings(decl(["./x.js", "--pkg", "foo@latest"], "node"))).toHaveLength(1);
  });

  it("survives a file with no mcpServers key and a server with no args", () => {
    expect(declarations({})).toEqual([]);
    expect(declarations(null)).toEqual([]);
    expect(declarations({ mcpServers: { x: { command: "node" } } })[0].argv).toEqual(["node"]);
  });

  it("discovery would find a NEW declaration file, not only the two known homes", () => {
    const listed = [".mcp.json", "tools/extra.mcp.json", ".claude/settings.json", "src/main.tsx"];
    const found = discoverCandidates(repoRoot, () => listed);
    expect(found).toContain(join(repoRoot, "tools", "extra.mcp.json"));
    expect(found).toContain(join(repoRoot, ".claude", "settings.json"));
    expect(found).not.toContain(join(repoRoot, "src", "main.tsx"));
  });

  it("discovery ignores an untracked nested worktree's own checkout of .mcp.json", () => {
    // The finding that shaped `discoverCandidates`: a parked worktree under `.claude/worktrees/`
    // holds the pre-fix file, and `git ls-files` never lists it because this repo does not track it.
    const listed = [".mcp.json", ".claude/settings.json"];
    const found = discoverCandidates(repoRoot, () => listed);
    // Judge the path INSIDE the repo, not the absolute one — a checkout that itself lives under
    // `.claude/worktrees/<name>/` would otherwise fail this on its own address.
    expect(found.some((p) => relative(repoRoot, p).includes("worktrees"))).toBe(false);
  });
});
