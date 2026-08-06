import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";

// AGENT-MACHINERY REFERENCE GUARD (2026-08-05).
//
// WHY THIS EXISTS.
// A machine-wide config sweep on 2026-08-05 found SIX defects in the agent/hook machinery. Not one
// was a logic bug — every single one was a reference that used to be true and silently stopped being
// true, in a file nothing tests because it isn't shipped code:
//
//   1. `.claude/agents/rust-tauri-reviewer.md` deferred to a `check` skill and a `security` skill.
//      CORRECTED 2026-08-05, same day: that call was WRONG. Both skills exist, machine-global, in
//      `~/.claude/skills/` — the sweep only looked in `.claude/skills/` and read "not here" as "not
//      anywhere," then deleted two live pointers as rot. The routing sentence those agents carry now
//      (mutation-gate + guard-forge, and deep security audits back to `security`) is the better one,
//      so it stands; but the reason recorded for the edit was false, and this guard was built on it.
//      The lesson is kept because it is the sharper one: a reference checker that does not know the
//      whole search path does not find rot, it manufactures it. See SKILL_ROOTS below.
//   2. `.codex/agents/rust-tauri-reviewer.toml` carried the identical reference (mirror rot is real
//      even though this instance of it was not — fixing one lane leaves the other broken).
//   3. `.claude/hooks/subagent-model-guard.mjs` cited "CLAUDE.md SUBAGENT-MODEL ORCHESTRATION" in
//      both its header and its DENY message. The 2026-08-05 CLAUDE.md trim renamed that section, so
//      the hook was telling the model to go read a heading that no longer exists — at the exact
//      moment it blocked a call.
//   4/5/6. `.claude/autopilot.json` and `.claude/USAGE_ECONOMICS.md` (twice) both stated
//      `MAX_CONTINUES = 2` while `stop-continue.mjs` had said 8 since 2026-08-03. A doc restating a
//      code literal is a drift bomb with a fuse of exactly one edit.
//
// A seventh defect was this guard's own, found in CI on 2026-08-06: teaching it the whole search
// path (defect 1) made half that path MACHINE-LOCAL, so it passed here and failed on a runner that
// has no `~/.claude/skills/`. Fixed by declaring the out-of-repo skills in git — MACHINE_GLOBAL_SKILLS
// below — rather than by discovering them from whatever filesystem happens to be underneath.
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

// A skill name resolves against TWO roots, and this guard's first version only knew about the first:
//   (a) `.claude/skills/` — project skills, in git, portable with the repo.
//   (b) `~/.claude/skills/` — machine-global skills, loaded in every session on this machine
//       regardless of repo root. `check`, `security` and `qa-harness` live here.
// Missing (b) is what made this guard's own opening premise wrong: it declared the reviewer agents'
// pointers to `check`/`security` dead and they were removed as rot, when both skills were live the
// whole time. A guard that cannot see half the search path does not find rot, it manufactures it.
const GLOBAL_SKILL_ROOT = join(homedir(), ".claude", "skills");
const SKILL_ROOTS = [".claude/skills", GLOBAL_SKILL_ROOT];
const skillsIn = (root: string) =>
  existsSync(root) ? readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()) : [];

// ...and knowing the whole search path is still not enough, because HALF OF IT IS NOT PORTABLE.
// `~/.claude/skills/` is machine-global and untracked: it is populated on the owner's machine and
// absent on a GitHub runner. Root (b) alone therefore makes the verdict depend on whose filesystem
// ran the test — which is exactly how this guard came to pass locally and fail in CI on 2026-08-06,
// reporting the live `security` skill as dead the moment it ran somewhere without a home directory
// full of skills. A guard whose answer changes with the machine is not a guard, it is a coin flip.
//
// So a skill hosted OUTSIDE the repo is declared here, in git, with the reason it lives there. The
// four tests below keep the declaration honest: it may not shadow a project skill, it may not name
// something nothing cites, it must carry a reason, and — wherever the global root IS visible — it
// must still match that machine.
const MACHINE_GLOBAL_SKILLS = new Map<string, string>([
  [
    "security",
    "Deep security audit at ~/.claude/skills/security, cited by the rust-tauri-reviewer agent in " +
      "both lanes. Machine-global on purpose: it is reused by every project on this machine, so it " +
      "is not vendored into Compy and CI has no copy of it to look at.",
  ],
]);

const REAL_SKILLS = new Set([...SKILL_ROOTS.flatMap(skillsIn), ...MACHINE_GLOBAL_SKILLS.keys()]);

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
    // Floor the PROJECT root specifically: a present global root must never be what makes this pass,
    // or the guard goes vacuous the moment the repo's own skills directory is renamed or emptied.
    expect(skillsIn(".claude/skills").length).toBeGreaterThan(5);
    expect(REAL_SKILLS.size).toBeGreaterThan(5);
  });

  it.each(SOURCES)("$path cites no skill that does not exist", ({ text }) => {
    const dead = skillRefs(text).filter((s) => !NOT_A_SKILL.has(s) && !REAL_SKILLS.has(s));
    // A dead skill reference routes work to nowhere and no runtime error is ever produced.
    expect(dead).toEqual([]);
  });

  // The declaration above is an escape hatch, and an escape hatch that is never audited becomes the
  // answer to every failure. These three keep it small and true, and they are deterministic — they
  // read only tracked files, so they hold the same verdict on a runner as on the owner's machine.
  it("declares no machine-global skill that is really a project skill", () => {
    const project = skillsIn(".claude/skills");
    const shadowed = [...MACHINE_GLOBAL_SKILLS.keys()].filter((s) => project.includes(s));
    // Exempting a skill the repo actually ships would hide its deletion behind the exemption.
    expect(shadowed).toEqual([]);
  });

  it("declares no machine-global skill that nothing cites", () => {
    const cited = new Set(SOURCES.flatMap((s) => skillRefs(s.text)));
    const unused = [...MACHINE_GLOBAL_SKILLS.keys()].filter((s) => !cited.has(s));
    // Stops the list drifting into a dumping ground of names no agent routes to any more.
    expect(unused).toEqual([]);
  });

  it("gives every machine-global declaration a written reason", () => {
    for (const [name, why] of MACHINE_GLOBAL_SKILLS) {
      expect(why.length, `${name} needs a reason it lives outside the repo`).toBeGreaterThan(40);
    }
  });

  // ...and on the one machine that CAN see the global root, still hold the declaration to reality,
  // so a renamed or deleted global skill is caught somewhere rather than nowhere. Skipped on CI by
  // design: there is nothing to compare against there, and guessing would re-create the flaw.
  it("matches the global skills actually on disk, where that directory is visible", () => {
    if (!existsSync(GLOBAL_SKILL_ROOT)) return;
    const onDisk = skillsIn(GLOBAL_SKILL_ROOT);
    const missing = [...MACHINE_GLOBAL_SKILLS.keys()].filter((s) => !onDisk.includes(s));
    expect(missing).toEqual([]);
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

// A cited path that is absent but GITIGNORED is local-only machine config, not rot: `.claude/
// autopilot.json` is ignored at .gitignore:52, so it exists in the primary checkout and in no
// worktree, clone, or CI runner. Failing on it made this guard green on exactly one directory on one
// machine — the first worktree cut after it landed went red on a file that is absent BY DESIGN.
// Ask git rather than keeping a hand-written exception list, so the excuse expires the moment the
// path stops being ignored.
function isGitIgnored(paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "--stdin"], {
      input: paths.join("\n"),
      encoding: "utf8",
    });
    return new Set(out.split(/\r?\n/).filter(Boolean));
  } catch {
    // Exit 1 means "none of them are ignored" — a normal answer, not a failure.
    return new Set();
  }
}

describe("rot class 3 — every cited repo path exists", () => {
  it.each(SOURCES)("$path cites no repo file that is gone", ({ text }) => {
    const missing = [...unwrap(text).matchAll(PATH_RE)]
      .map((m) => m[1])
      .filter((p) => !p.includes("*") && !PATH_EXCEPTIONS.has(p))
      .filter((p) => !existsSync(p));
    const ignored = isGitIgnored([...new Set(missing)]);
    const dead = missing.filter((p) => !ignored.has(p));
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
