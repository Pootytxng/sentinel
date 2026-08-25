import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

// .CLAUDE DIRECTORY GUARD (2026-08-25).
//
// WHY. `.claude/` is where this repo keeps the things that shape how every session behaves —
// the skills a session skims before starting a train, and the hooks that mechanize the laws.
// Three of its invariants were prose only, and prose is the weakest tier (~/.claude/CLAUDE.md §6):
//
//   1. INDEX.md's own header says "keep the table current in the same commit that adds/changes a
//      skill (doc-sync law)". Nothing checked it. A skill added without a row is invisible to the
//      one file sessions read to find skills, which is the same failure as not adding it at all.
//   2. A row naming a skill that no longer exists sends a session after something that is not
//      there — worse than silence, because it looks authoritative.
//   3. A hook file that is not wired into settings.json is INERT. That is sometimes deliberate:
//      work-control-receipt-guard.mjs ships unwired on purpose, because the owner's settings
//      hard-deny "any hook that gates the assistant's own authority" and he installs those by
//      hand. But deliberate and forgotten look identical from outside, so the file must SAY which
//      it is. Found by hand during the 2026-08-25 repo sweep; mechanized rather than remembered.

const SKILLS = ".claude/skills";
const HOOKS = ".claude/hooks";
const INDEX = join(SKILLS, "INDEX.md");
const SETTINGS = ".claude/settings.json";

const read = (p: string) => readFileSync(p, "utf8");

/** Directories under .claude/skills that actually carry a SKILL.md. */
export function skillsOnDisk(dir = SKILLS): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

/** Skill names in the INDEX's live table: the first backticked cell of each table row. */
export function skillsInIndex(markdown: string): string[] {
  const rows = markdown
    .split("\n")
    .filter((line) => /^\|\s*`[a-z0-9-]+`\s*\|/.test(line))
    .map((line) => line.match(/^\|\s*`([a-z0-9-]+)`/)?.[1])
    .filter((n): n is string => Boolean(n));
  return [...new Set(rows)].sort();
}

/** A hook may be unwired only if it says so in its own first 40 lines. */
export function declaresItselfUnwired(source: string): boolean {
  const header = source.split("\n").slice(0, 40).join("\n");
  return /\bnot wired\b|\bunwired\b/i.test(header);
}

describe(".claude/skills/INDEX.md tracks the skills that exist", () => {
  it("lists every skill on disk", () => {
    const missing = skillsOnDisk().filter((s) => !skillsInIndex(read(INDEX)).includes(s));
    expect(
      missing,
      "these skills have a SKILL.md but no row in .claude/skills/INDEX.md — the doc-sync law in " +
        "the INDEX's own header says the row lands in the same commit as the skill",
    ).toEqual([]);
  });

  it("names no skill that is gone", () => {
    const onDisk = skillsOnDisk();
    const ghosts = skillsInIndex(read(INDEX)).filter((s) => !onDisk.includes(s));
    expect(
      ghosts,
      "the INDEX's live table names skills with no directory — a row that looks authoritative and " +
        "points at nothing is worse than no row",
    ).toEqual([]);
  });

  // ── falsification ────────────────────────────────────────────────────────
  it("FALSIFICATION: the table parser reads the first cell, not any backtick on the line", () => {
    const table = [
      "| Skill | Fires when | Cheapest executor | Notes |",
      "|---|---|---|---|",
      "| `self-review` | any UI change | worker: **sonnet** | see `scripts/ship-reinstall.ps1` |",
      "| `ship` | after every build | any | `npm run tauri build` |",
    ].join("\n");
    // `scripts/ship-reinstall.ps1` and `npm run tauri build` are backticked but are not the first
    // cell, and must not be mistaken for skill names.
    expect(skillsInIndex(table)).toEqual(["self-review", "ship"]);
  });

  it("FALSIFICATION: prose mentioning a skill in backticks is not a table row", () => {
    // The INDEX's rejected-skills section is full of these; counting them would make the guard
    // demand directories for tools this repo deliberately did not add.
    const prose = "- **`mattpocock/skills`** (plugin) — looked at 2026-08-24, nothing to vendor.";
    expect(skillsInIndex(prose)).toEqual([]);
  });

  it("FALSIFICATION: the disk scan requires a SKILL.md, not just a directory", () => {
    // A stray directory under .claude/skills is not a skill and must not be demanded of the INDEX.
    expect(skillsOnDisk()).not.toContain("INDEX.md");
    for (const name of skillsOnDisk()) {
      expect(existsSync(join(SKILLS, name, "SKILL.md")), `${name} has no SKILL.md`).toBe(true);
    }
  });
});

describe(".claude/hooks are either wired or say they are not", () => {
  it("leaves no hook silently inert", () => {
    const settings = read(SETTINGS);
    const undeclared = readdirSync(HOOKS)
      .filter((n) => n.endsWith(".mjs"))
      .filter((n) => !settings.includes(n))
      .filter((n) => !declaresItselfUnwired(read(join(HOOKS, n))));
    expect(
      undeclared,
      "these hook files are not referenced in .claude/settings.json and do not say so in their own " +
        "header, so there is no way to tell a deliberate opt-out from one that was forgotten. " +
        "Either wire it, or say NOT WIRED and why in the first 40 lines.",
    ).toEqual([]);
  });

  it("FALSIFICATION: an undeclared unwired hook is caught", () => {
    expect(declaresItselfUnwired("#!/usr/bin/env node\n// PreToolUse hook.\nimport x from 'y';")).toBe(
      false,
    );
  });

  it("FALSIFICATION: both spellings of the declaration are accepted", () => {
    expect(declaresItselfUnwired("// NOT WIRED BY DEFAULT. The owner installs this by hand.")).toBe(true);
    expect(declaresItselfUnwired("// It ships UNWIRED because it gates the assistant's authority.")).toBe(true);
  });

  it("FALSIFICATION: a declaration buried below the header does not count", () => {
    // Line 200 of a file nobody scrolls is not a declaration; the reader must meet it immediately.
    const buried = `${"// filler\n".repeat(60)}// NOT WIRED.`;
    expect(declaresItselfUnwired(buried)).toBe(false);
  });

  it("the one deliberate opt-out is still the only one, and still says why", () => {
    // Pins the known state so a second silent opt-out is a visible change, not a slow drift.
    const settings = read(SETTINGS);
    const unwired = readdirSync(HOOKS)
      .filter((n) => n.endsWith(".mjs"))
      .filter((n) => !settings.includes(n));
    expect(unwired).toEqual(["work-control-receipt-guard.mjs"]);
    expect(read(join(HOOKS, "work-control-receipt-guard.mjs"))).toMatch(
      /owner installs this by hand/i,
    );
  });
});
