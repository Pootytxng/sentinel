import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";

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

// ── 1. Operative law markers ────────────────────────────────────────────────────────────────────
// Grouped by the law they defend so a failure names the rule, not just a missing string.

const REQUIRED: { law: string; markers: string[] }[] = [
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
      "default-OFF",
      "Tier 1 signed advisory download / no machine-data upload",
      "Tier 2 opt-in scrubbed incident fingerprint",
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
    markers: ["scripts/verify-module-map.mjs", "src-tauri/CLAUDE.md"],
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
  for (const { law, markers } of REQUIRED) {
    it(law, () => {
      const missing = markers.filter((m) => !flat.includes(m.replace(/\s+/g, " ")));
      expect(
        missing,
        `CLAUDE.md no longer contains ${missing.length} marker(s) for "${law}". ` +
          `If you deliberately reworded a law, update this guard in the SAME commit. ` +
          `If you did not, you just dropped a standing rule from the always-loaded brief.`,
      ).toEqual([]);
    });
  }
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
const MAX_BYTES = 25_000;
const MIN_BYTES = 12_000;

describe("CLAUDE.md stays within its boot-tax budget", () => {
  const bytes = Buffer.byteLength(text, "utf8");

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
