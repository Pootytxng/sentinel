import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { execFileSync } from "child_process";

// CLAUDE.md LAWS GUARD (2026-08-05).
//
// WHY THIS EXISTS.
// CLAUDE.md auto-loads into every session opened in this repo, so it is the one file whose contents
// are paid for on every single boot forever. On 2026-08-05 it was trimmed 34.5 KB → 23.5 KB by
// deleting (a) duplication of ~/.claude/CLAUDE.md, which now loads in every session on this machine
// regardless of root, and (b) the expired Fable-5-window sections. That trim is the right call and
// it is also the single most dangerous edit in the repo: a laws file rewritten by hand can silently
// drop a LOCKED rule, and nothing else in the toolchain would notice. Prose cannot defend prose.
//
// So the laws are pinned mechanically. Three checks:
//   1. REQUIRED — every operative law marker must still be present, verbatim.
//   2. BUDGET   — a ceiling (re-bloat: the doc creeps back to 34 KB and the boot tax returns) and a
//                 FLOOR (truncation or blanking: the global ~/.claude/CLAUDE.md was once found at
//                 0 bytes, which is precedent that "a laws file is important" does not keep it alive).
//   3. POINTERS — the trim converted narrative into `path` references. Dead pointers are therefore
//                 the new failure mode this file introduced, so every repo path it cites must exist.
//
// Editing a law is allowed. Editing a law WITHOUT updating this list is not — that is the point.
// vitest runs from the repo root (scripts/run-vitest.mjs); paths are repo-root-relative. ESM, no __dirname.

const CLAUDE_MD = "CLAUDE.md";
const text = readFileSync(CLAUDE_MD, "utf8");

// Markers are matched against a whitespace-collapsed copy so that re-wrapping a paragraph — which
// changes nothing about the law — cannot fail the build. The WORDING is pinned; the layout is not.
const flat = text.replace(/\s+/g, " ");

// #479 (2026-09-18): subsystem detail moved out of the root into path-scoped `.claude/rules/*.md`,
// which load only when matching files are touched. A law that moved is still a law, so an entry may
// name the `file` that now carries it; the markers are pinned there with the same strictness.
const RULES_DIR = ".claude/rules";
const flatOf = (file: string): string =>
  file === CLAUDE_MD ? flat : readFileSync(file, "utf8").replace(/\s+/g, " ");

// ── 1. Operative law markers ────────────────────────────────────────────────────────────────────
// Grouped by the law they defend so a failure names the rule, not just a missing string.

const REQUIRED: { law: string; markers: string[]; file?: string }[] = [
  {
    law: "LOCKED 1 — Capability Exception Gate / no fabricated CPU temp",
    markers: [
      "Capability Exception Gate (owner decision 2026-08-09).",
      "current build ships no driver",
      "No vulnerable third-party driver",
      "external-monitor-only",
      "never fabricated",
    ],
  },
  {
    law: "LOCKED 2 — no third-party game/process injection",
    markers: [
      "No third-party game/process injection.",
      "no DLL injection",
      "game-memory access",
      "borderless/windowed",
    ],
  },
  {
    law: "LOCKED 3 — rollback-first integrity",
    markers: [
      "Rollback-first integrity.",
      "at apply time",
      "history.json` ALONE",
      "Never apply a change you can't roll back.",
    ],
  },
  {
    law: "LOCKED 4 — signed remote rules, triple-gated OFF",
    markers: [
      "triple-gated OFF",
      "remote_fetch_enabled()==false",
      "The Ed25519 private key NEVER lives in the repo",
      "Unsigned remote rules must never ship, even in beta.",
    ],
  },
  {
    law: "LOCKED 5 — GPU vendor honesty",
    markers: ["GPU vendor honesty", "not yet hardware-verified", "do NOT flip those"],
  },
  {
    law: "LOCKED 6 — tweak catalog rails and the permanent blocklist",
    markers: [
      "measurable-benefit-under-rails",
      "measurement does NOT make these safe",
      "timer/HPET",
      "bcdedit",
      "MMCSS",
      "core-parking writes",
      "Defender disable",
      "MPO disable",
      "fixed pagefile",
      "ungated kernel-level capability",
      "EAC/BattlEye",
      "GPU-profile apply",
      "`.claude/rules/tweak-catalog.md`",
    ],
  },
  {
    law: "LOCKED 6 in full — admission rails (path-scoped rule)",
    file: `${RULES_DIR}/tweak-catalog.md`,
    markers: [
      "measurable-benefit-under-rails",
      "ADD criterion",
      "per-rig Trial",
      "measurement does NOT make these safe",
      "timer/HPET",
      "bcdedit",
      "MMCSS",
      "core-parking writes",
      "Defender disable",
      "MPO disable",
      "fixed pagefile",
      "ungated kernel-level capability",
      "EAC/BattlEye",
      "GPU-profile apply",
      "rollback-first",
    ],
  },
  {
    law: "Security / system settings — owner-gated, never autonomous",
    markers: [
      "SECURITY / SYSTEM SETTINGS",
      "EnableLUA",
      "ConsentPromptBehaviorAdmin",
      "PromptOnSecureDesktop",
      "welfare-check FIRST, never flip it solo",
      "Reversibility is NOT the license here",
      "read-only probes only",
      "auto-switch on security-sensitive work as a STOP signal",
    ],
  },
  {
    law: "One mutation boundary",
    markers: [
      "ONE MUTATION BOUNDARY",
      "src-tauri/src/actions.rs",
      "nowhere else",
      "mutation-boundary-allow",
    ],
  },
  {
    law: "Honest measurement + outbound boundary",
    markers: [
      "never fabricate, never claim unmeasured",
      "default OFF and it stays OFF after arming",
      "Tier 1 signed advisory download / no machine-data upload",
      "Tier 2 scrubbed incident fingerprint",
      "Tier 3 explicit per-case evidence upload",
    ],
  },
  {
    law: "Owner-bound gates",
    markers: ["ZERO-BUDGET LAW", "never before 1.0", "16069fa", "WELFARE CHECK"],
  },
  {
    law: "Silent reinstall is mine, not the owner's",
    markers: [
      "SILENT REINSTALL IS MINE",
      "scripts/ship-reinstall.ps1",
      "build STAMP",
      "not an exe hash",
    ],
  },
  {
    law: "Self-review + bug→guard",
    markers: [
      "self-review",
      "bug → guard",
      "before the fix counts",
      "never capture or cdp-eval inline",
      "quoted PASS verdict",
    ],
  },
  {
    law: "Sources of truth + false-done protocol",
    markers: [
      "docs/RELEASE_STATE.md` is authoritative",
      "false-done",
      "a reskin is not the vision",
      "OWNER_ACTION_CHECKLIST",
    ],
  },
  {
    law: "Rename — the legacy literal is load-bearing",
    markers: ['legacy literal MUST stay "Sentinel"', "migrate_legacy_data_once"],
  },
  {
    law: "Module map is mechanically verified",
    markers: ["scripts/verify-module-map.mjs", "src-tauri/CLAUDE.md", ".claude/rules/rust-safety-boundary.md"],
  },
  {
    law: "Rust ★ safety boundary entries (path-scoped rule)",
    file: `${RULES_DIR}/rust-safety-boundary.md`,
    markers: [
      "THE Windows-mutation + rollback boundary, no exceptions",
      "Rollback resolves from local history ALONE",
      "Mutation-boundary",
      "default-OFF even armed",
      "MutationRoot",
      "owner territory",
    ],
  },
  {
    law: "Dev machine — never generalize the owner's rig (path-scoped rule)",
    file: `${RULES_DIR}/dev-machine.md`,
    markers: ["RX 9070 XT", "Never generalize", "Re-read actual detected hardware"],
  },
  {
    law: "Token law",
    markers: ["scripts/doc-budget.ps1", "never build a parallel monitor"],
  },
  {
    law: "Deference to the universal laws file (prevents re-duplication)",
    markers: ["~/.claude/CLAUDE.md"],
  },
];

describe("CLAUDE.md carries every operative law", () => {
  for (const { law, markers, file = CLAUDE_MD } of REQUIRED) {
    it(law, () => {
      const body = flatOf(file);
      const missing = markers.filter((m) => !body.includes(m.replace(/\s+/g, " ")));
      expect(
        missing,
        `${file} no longer contains ${missing.length} marker(s) for "${law}". ` +
          `If you deliberately reworded a law, update this guard in the SAME commit. ` +
          `If you did not, you just dropped a standing rule from the always-loaded brief.`,
      ).toEqual([]);
    });
  }
});

// ── 1b. Path-scoped rules stay reachable ────────────────────────────────────────────────────────
// A rule file loads only when a file matching its `paths:` is touched. A glob that matches nothing
// (a renamed module, a typo) makes the law silently unreachable — worse than a dead pointer, because
// the file still exists and every existence check passes. So each glob must match a tracked file,
// the root must name each rule (the only way a session learns it exists), and each rule must be
// pinned above.

const TRACKED = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    "^" +
      glob
        .split("**")
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
        .join(".*") +
      "$",
  );
export const rulePaths = (body: string): string[] => {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
  return [...front.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
};
const RULE_FILES = readdirSync(RULES_DIR).filter((f) => f.endsWith(".md"));

describe("path-scoped rules are reachable and pinned", () => {
  it("the rules directory is not empty (the guard would pass vacuously)", () => {
    expect(RULE_FILES.length).toBeGreaterThanOrEqual(3);
  });

  it("the glob matcher is real: ** crosses directories, * does not", () => {
    expect(globToRegExp("src-tauri/**").test("src-tauri/src/actions.rs")).toBe(true);
    expect(globToRegExp("src-tauri/src/*.rs").test("src-tauri/src/a/b.rs")).toBe(false);
    expect(globToRegExp("src-tauri/src/actions.rs").test("src-tauri/src/actionsXrs")).toBe(false);
  });

  describe.each(RULE_FILES)("%s", (name) => {
    const rel = `${RULES_DIR}/${name}`;
    const body = readFileSync(rel, "utf8");

    it("declares paths: frontmatter and every glob matches a tracked file", () => {
      const globs = rulePaths(body);
      expect(globs.length, `${rel} has no paths: frontmatter — it would load on EVERY session`).toBeGreaterThan(0);
      const dead = globs.filter((g) => !TRACKED.some((f) => globToRegExp(g).test(f)));
      expect(dead, `${rel} scopes to globs that match no tracked file, so it never loads`).toEqual([]);
    });

    it("is named by the root CLAUDE.md", () => {
      expect(flat.includes(name), `the root never names ${name}, so no session learns it exists`).toBe(true);
    });

    it("has a law entry pinning its markers", () => {
      expect(REQUIRED.some((r) => r.file === rel), `${rel} carries law but no guard entry pins it`).toBe(true);
    });
  });
});

// ── 2. Byte budget ──────────────────────────────────────────────────────────────────────────────

// Measured 23,538 bytes after the 2026-08-05 trim (down from 34,574 — a 32% cut, not the ~60% first
// estimated by eye; the LOCKED rules and the module map are irreducible and they dominate the file).
// The ceiling was set at that measurement + ~2.5 KB of room for one more law, and it was NOT a target
// to grow into — but on 2026-08-11 the file measured 25,120: it had eaten 1.6 KB of that headroom in
// six days, leaving 880 bytes. Slack is not a budget; a ceiling nobody approaches is a ceiling that
// does nothing. So it ratchets. Trimmed to 24,742 that day and the ceiling followed it down.
//
// RATCHET RULE: when a trim lands, move this DOWN to the new measurement + ~250 bytes, in the same
// commit. Raising it is a deliberate decision that costs a law's worth of boot tax on every session
// forever — say so out loud when you do it. Never raise it to make a commit pass.
//
// 2026-08-25: the file hit 25,025 and this test went red on a 25-byte edit. Trimmed to 24,928 by
// deleting the TOKEN LAW line that re-stated the header's own deference to ~/.claude/CLAUDE.md. The
// ceiling STAYS at 25,000 — the ratchet only moves down, and measurement + 250 would raise it. So
// headroom is 72 bytes and the next addition must pay for itself with a deletion. That is the rule
// working, not the rule being inconvenient.
//
// 2026-09-18 (#479): 19,981 → 14,615 by moving the ★ module-map entries, LOCKED 6's full text and the
// dev-machine note into path-scoped `.claude/rules/*.md` (pinned above) and cutting duplicated prose.
// Ceiling ratchets to measurement + ~250. Rule files carry their own budgets in scripts/doc-budget.ps1.
const MAX_BYTES = 14_865;
const MIN_BYTES = 12_000;

// Measured as git STORES the file, not as this checkout RENDERS it. 2026-09-02: a worktree checked
// out with CRLF (core.autocrlf=true, the desktop app's worktree creation) read 25,225 bytes on disk
// for a blob git holds at 24,966 — one CR per line — and this test went red on a commit that never
// touched CLAUDE.md, in one checkout and not another. A boot-tax measurement that depends on which
// machine runs it is not a measurement. Normalizing line endings makes every checkout agree with
// `git show HEAD:CLAUDE.md | wc -c`, which is the number the ceiling was set against.
export const canonicalBytes = (s: string): number => Buffer.byteLength(s.replace(/\r\n/g, "\n"), "utf8");

describe("CLAUDE.md stays within its boot-tax budget", () => {
  const bytes = canonicalBytes(text);

  it("measures the file as git stores it — a CRLF checkout must not move the number", () => {
    const lf = text.replace(/\r\n/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(canonicalBytes(crlf)).toBe(canonicalBytes(lf));
    // The rendering really does differ, so the pin is not vacuous: CR bytes exist to be discounted.
    expect(Buffer.byteLength(crlf, "utf8")).toBeGreaterThan(Buffer.byteLength(lf, "utf8"));
  });

  it(`is under ${MAX_BYTES} bytes (re-bloat guard)`, () => {
    expect(
      bytes,
      `CLAUDE.md is ${bytes} bytes. It loads on every boot, so growth is a permanent per-session ` +
        `tax. Move narrative, history and rationale into docs/ and link it. Raise this ceiling only ` +
        `with a deliberate decision, not to make a commit pass.`,
    ).toBeLessThanOrEqual(MAX_BYTES);
  });

  it(`is over ${MIN_BYTES} bytes (truncation / blanking guard)`, () => {
    expect(
      bytes,
      `CLAUDE.md is only ${bytes} bytes — far below the size of its known law set. A blanked or ` +
        `truncated laws file loads silently and looks like "no laws", which is exactly how the ` +
        `global ~/.claude/CLAUDE.md was once found at 0 bytes.`,
    ).toBeGreaterThanOrEqual(MIN_BYTES);
  });
});

// ── 3. Every repo path CLAUDE.md points at must exist ───────────────────────────────────────────

// AGENTS.md is the Codex-lane equivalent: it auto-loads for Codex and consists almost entirely of
// pointers into CLAUDE.md and docs/. On 2026-08-05 it was found pointing at two CLAUDE.md sections
// that the trim had removed ("SPORT MODE", "Who the owner is") — a control file quietly directing a
// whole agent lane at content that no longer existed. Same failure mode, so the same check.
const POINTER_FILES = ["CLAUDE.md", "AGENTS.md"];

describe.each(POINTER_FILES)("%s has no dead pointers", (file) => {
  it("every referenced repo path exists on disk", () => {
    const body = readFileSync(file, "utf8");
    // `(?<!~\/)` drops `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` — machine-global files in the
    // home directory, deliberately outside this repo, so existsSync() against the repo root would
    // always call them dead. Only repo-relative pointers are in scope here.
    const cited = new Set(
      body.match(
        /(?<!~\/)(?:docs|scripts|src|src-tauri|\.claude)\/[A-Za-z0-9_\-./]+\.(?:md|mjs|ps1|ts|tsx|json|rs)/g,
      ) ?? [],
    );
    expect(
      cited.size,
      `path-extraction regex matched nothing in ${file} — the guard would pass vacuously`,
    ).toBeGreaterThan(5);

    const dead = [...cited].filter((p) => !existsSync(p));
    expect(
      dead,
      `${file} points at ${dead.length} path(s) that do not exist. The 2026-08-05 trim replaced ` +
        `narrative with pointers, so a moved or renamed file now silently costs a law its content.`,
    ).toEqual([]);
  });
});
