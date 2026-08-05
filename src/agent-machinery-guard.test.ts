import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

// AGENT-MACHINERY REFERENCE GUARD (2026-08-05).
//
// WHY THIS EXISTS.
// A machine-wide config sweep on 2026-08-05 found SIX defects in the agent/hook machinery. Not one
// was a logic bug — every single one was a reference that used to be true and silently stopped being
// true, in a file nothing tests because it isn't shipped code:
//
//   1. `.claude/agents/rust-tauri-reviewer.md` deferred to a `check` skill and a `security` skill.
//      Neither exists. An agent was routing work to nowhere.
//   2. `.codex/agents/rust-tauri-reviewer.toml` carried the identical dead reference (mirror rot —
//      fixing one lane leaves the other broken, and nothing notices).
//   3. `.claude/hooks/subagent-model-guard.mjs` cited "CLAUDE.md SUBAGENT-MODEL ORCHESTRATION" in
//      both its header and its DENY message. The 2026-08-05 CLAUDE.md trim renamed that section, so
//      the hook was telling the model to go read a heading that no longer exists — at the exact
//      moment it blocked a call.
//   4/5/6. `.claude/autopilot.json` and `.claude/USAGE_ECONOMICS.md` (twice) both stated
//      `MAX_CONTINUES = 2` while `stop-continue.mjs` had said 8 since 2026-08-03. A doc restating a
//      code literal is a drift bomb with a fuse of exactly one edit.
//
// Per the owner's bug->guard law (~/.claude/CLAUDE.md §6: "when a rule gets broken, the fix is a
// guard, not another paragraph"), all three rot classes are mechanized here. They are all
// mechanically checkable, which is precisely why prose was the wrong tier for them.
//
// This file guards the CONTROL PLANE (agents, hooks, autopilot, usage doc) the way
// claude-md-laws-guard.test.ts guards the laws. Both lanes — Claude and Codex — are scanned, because
// defect 2 proves a one-lane fix is not a fix.
//
// vitest runs from the repo root (scripts/run-vitest.mjs); paths are repo-root-relative. ESM, no __dirname.

// ── The scanned surface ─────────────────────────────────────────────────────────────────────────

function filesIn(dir: string, ext: string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => ext.some((e) => f.endsWith(e)))
    .map((f) => join(dir, f).replace(/\\/g, "/"))
    .filter((p) => statSync(p).isFile());
}

const SCANNED: string[] = [
  ...filesIn(".claude/agents", [".md"]),
  ...filesIn(".claude/hooks", [".mjs"]),
  ...filesIn(".codex/agents", [".toml"]),
  ...filesIn(".codex/hooks", [".mjs"]),
  ".codex/hooks.json",
  ".claude/autopilot.json",
  ".claude/USAGE_ECONOMICS.md",
].filter((p) => existsSync(p));

const SOURCES = SCANNED.map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("agent machinery — the scanned surface itself", () => {
  // If a lane's directory gets renamed or emptied, every check below would vacuously pass. Pin the
  // floor so "0 defects" can never mean "0 files read".
  it("covers both lanes and did not silently shrink to nothing", () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(12);
    expect(SOURCES.some((s) => s.path.startsWith(".claude/agents/"))).toBe(true);
    expect(SOURCES.some((s) => s.path.startsWith(".claude/hooks/"))).toBe(true);
    expect(SOURCES.some((s) => s.path.startsWith(".codex/agents/"))).toBe(true);
    expect(SOURCES.some((s) => s.path.startsWith(".codex/hooks/"))).toBe(true);
  });
});

// ── ROT CLASS 1: dead skill references (defects 1 + 2) ──────────────────────────────────────────

const SKILLS_DIR = ".claude/skills";
const REAL_SKILLS = new Set(
  existsSync(SKILLS_DIR)
    ? readdirSync(SKILLS_DIR).filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory())
    : []
);

// Two ways a skill gets named in prose. Both are how the real defects were written:
//   (a) an explicit path — `.claude/skills/self-review/SKILL.md`
//   (b) a backticked name near the word "skill"/"skills" — "the `security` skill", and the list form
//       "the existing `check` and `security` skills" (which is why we look BACK from the word, and
//       collect every backticked token in the window rather than just the adjacent one).
function skillRefs(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\.claude\/skills\/([a-z][a-z0-9-]*)\b/g)) found.add(m[1]);
  for (const m of text.matchAll(/\bskills?\b/g)) {
    const window = text.slice(Math.max(0, m.index! - 90), m.index!);
    // Stop at a sentence break so we don't drag in backticks from the previous sentence.
    const clause = window.split(/(?<=[.;:!?])\s/).pop() ?? window;
    for (const t of clause.matchAll(/`([a-z][a-z0-9-]{2,})`/g)) found.add(t[1]);
  }
  return [...found];
}

// Backticked words that legitimately sit next to "skill" without BEING a skill name.
const NOT_A_SKILL = new Set([
  "model",
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "agent",
  "hook",
  "project",
  "claude",
  "codex",
]);

describe("rot class 1 — every referenced skill exists", () => {
  it("has skills on disk to check against", () => {
    expect(REAL_SKILLS.size).toBeGreaterThan(5);
  });

  it.each(SOURCES)("$path cites no skill that does not exist", ({ text }) => {
    const dead = skillRefs(text).filter((s) => !NOT_A_SKILL.has(s) && !REAL_SKILLS.has(s));
    // A dead skill reference routes work to nowhere and no runtime error is ever produced.
    expect(dead).toEqual([]);
  });
});

// ── ROT CLASS 2: dead CLAUDE.md section citations (defect 3) ────────────────────────────────────

const CLAUDE_MD = readFileSync("CLAUDE.md", "utf8");

// Normalize both sides: strip everything that isn't alphanumeric and lowercase. This matches a
// citation of `Subagent routing` against the file's `**Subagent routing:**`, and `BUG -> GUARD`
// against `` `bug → guard` ``, without failing on emphasis, punctuation, or an arrow glyph.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const CLAUDE_MD_NORM = norm(CLAUDE_MD);

function sectionCitations(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /CLAUDE\.md'?s?\s+"([^"\n]{3,60})"/g, // CLAUDE.md's "Subagent routing"
    /CLAUDE\.md\s*(?:§|->|→)\s*([A-Za-z][A-Za-z0-9 ,'&/+-]{2,59})/g, // CLAUDE.md § Reports, subagents
    /CLAUDE\.md\s+([A-Z][A-Z0-9 /+-]{4,59}[A-Z])/g, // CLAUDE.md SHOUTING SECTION NAME
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      // Compound citations ("A + B") name two sections; check each independently.
      for (const part of m[1].split("+")) {
        const cleaned = part.trim().replace(/[),.;:]+$/, "");
        if (cleaned.length >= 3) found.add(cleaned);
      }
    }
  }
  return [...found];
}

describe("rot class 2 — every cited CLAUDE.md section exists", () => {
  it.each(SOURCES)("$path cites no CLAUDE.md heading that was renamed away", ({ text }) => {
    const dead = sectionCitations(text).filter((c) => !CLAUDE_MD_NORM.includes(norm(c)));
    // Defect 3 shipped this exact failure inside a DENY message — the worst possible place to send
    // the model looking for a heading that isn't there.
    expect(dead).toEqual([]);
  });

  it("actually finds citations to check (the matcher is not silently matching nothing)", () => {
    const total = SOURCES.reduce((n, s) => n + sectionCitations(s.text).length, 0);
    expect(total).toBeGreaterThan(0);
  });
});

// ── ROT CLASS 3: dead repo-path references ──────────────────────────────────────────────────────

const REPO_DIR_PREFIXES = ["src", "src-tauri", "docs", "scripts", "site", "site-app", ".claude", ".codex"];
const PATH_RE = new RegExp(
  String.raw`(?<![\w/.\-])((?:${REPO_DIR_PREFIXES.map((p) => p.replace(".", "\\.")).join("|")})\/[A-Za-z0-9_./\-]*[A-Za-z0-9_/])`,
  "g"
);

// Paths that are deliberately not real files. Each needs a stated reason — an unexplained entry here
// is how a guard rots into decoration.
const PATH_EXCEPTIONS = new Set<string>([
  // (empty by design) — the two synthetic apply_patch fixtures in .codex/hooks/hooks-selftest.mjs
  // were pointed at REAL files (src/surfaces/HomeHud.tsx, src/App.css) on 2026-08-05 rather than
  // excluded here. A fixture that names a real file tests the same behaviour and stays checkable;
  // an exception list is where a guard goes to rot. Negative controls that must stay unreal use a
  // path OUTSIDE the repo prefixes above (e.g. `dist/...`), so they never reach this check.
]);

// A long path inside a wrapped comment block gets split across lines mid-token, e.g.
//   // ... (docs/superpowers/specs/2026-07-01-token-
//   //     routing-protocol.md called this out ...
// Rejoin at a trailing `-` or `/` so the guard checks the real path instead of a truncated stub.
const unwrap = (s: string) => s.replace(/([/-])\r?\n[ \t]*(?:\/\/|#|\*)?[ \t]*/g, "$1");

describe("rot class 3 — every cited repo path exists", () => {
  it.each(SOURCES)("$path cites no repo file that is gone", ({ text }) => {
    const dead = [...unwrap(text).matchAll(PATH_RE)]
      .map((m) => m[1])
      .filter((p) => !p.includes("*") && !PATH_EXCEPTIONS.has(p))
      .filter((p) => !existsSync(p));
    // Upstream codex-rs paths (codex-rs/.../src/engine/output_parser.rs) are excluded by the
    // lookbehind: they are always preceded by a `/`, so they never match as repo-relative.
    expect([...new Set(dead)]).toEqual([]);
  });
});

// ── ROT CLASS 4: docs restating a code literal (defects 4, 5, 6) ────────────────────────────────

describe("rot class 4 — the autopilot clamp cannot drift out of sync again", () => {
  const hook = readFileSync(".claude/hooks/stop-continue.mjs", "utf8");
  const codeValue = hook.match(/const\s+MAX_CONTINUES\s*=\s*(\d+)/)?.[1];

  it("the code declares the clamp exactly once, and that is the source of truth", () => {
    expect(codeValue).toBeDefined();
    expect(hook.match(/const\s+MAX_CONTINUES\s*=\s*\d+/g)).toHaveLength(1);
  });

  // autopilot.json is gitignored LOCAL runtime state (.gitignore:52), so it is absent on a fresh
  // clone and in CI. Skip cleanly there rather than crashing — but when it IS present (every real
  // working copy, which is exactly where the drift happened) it is checked like anything else.
  const autopilotExists = existsSync(".claude/autopilot.json");
  it.skipIf(!autopilotExists)("`.claude/autopilot.json` states the same current clamp as the code", () => {
    const doc = readFileSync(".claude/autopilot.json", "utf8");
    const stated = doc.match(/the clamp is currently (\d+)/)?.[1];
    // The _doc note is allowed to recount history ("was 2") — only the CURRENT-value sentence is
    // pinned. If this sentence is reworded, reword it here too; do not delete the check.
    expect(stated, "autopilot.json must say 'the clamp is currently <N>'").toBeDefined();
    expect(stated).toBe(codeValue);
  });

  it("`.claude/USAGE_ECONOMICS.md` §5 states the same current clamp as the code", () => {
    const doc = readFileSync(".claude/USAGE_ECONOMICS.md", "utf8");
    const stated = doc.match(/\|\s*Autopilot continuation cap\s*\|\s*(\d+)/)?.[1];
    expect(stated, "USAGE_ECONOMICS.md §5 must carry an 'Autopilot continuation cap' row").toBeDefined();
    expect(stated).toBe(codeValue);
  });

  it("no OTHER file in the scanned surface hardcodes a MAX_CONTINUES value", () => {
    // The two mirrors above are deliberate and pinned. Anything else restating the literal is a new
    // drift bomb — §6's bullet was rewritten on 2026-08-05 specifically to stop doing this.
    const offenders = SOURCES.filter((s) => s.path !== ".claude/hooks/stop-continue.mjs").filter((s) =>
      /MAX_CONTINUES\s*(?:=|is|to|at)\s*\d/.test(s.text)
    );
    expect(offenders.map((s) => s.path)).toEqual([]);
  });
});

// ── Wiring: every hook the settings file invokes must actually be on disk ────────────────────────

describe("hook wiring — settings.json points at real scripts", () => {
  it("every .claude/hooks/*.mjs referenced by settings.json exists", () => {
    const settings = readFileSync(".claude/settings.json", "utf8");
    const referenced = [...settings.matchAll(/\.claude\/hooks\/([A-Za-z0-9_.-]+\.mjs)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    const missing = [...new Set(referenced)].filter((f) => !existsSync(join(".claude/hooks", f)));
    expect(missing).toEqual([]);
  });

  it("every .codex/hooks/*.mjs referenced by .codex/hooks.json exists", () => {
    const hooks = readFileSync(".codex/hooks.json", "utf8");
    const referenced = [...hooks.matchAll(/\.codex\/hooks\/([A-Za-z0-9_.-]+\.mjs)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    const missing = [...new Set(referenced)].filter((f) => !existsSync(join(".codex/hooks", f)));
    expect(missing).toEqual([]);
  });
});
