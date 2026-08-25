// Resident guard for `.codex/hooks.json`.
//
// `.codex/hooks/hooks-selftest.mjs` already checks all of this and more — it runs the configured
// command lines through cmd.exe and sh from three CWDs, with negative controls. It is also run by
// nothing. It is not a `*.test.mjs`, it is outside `scripts/`, so `gate-residency-guard` never asked
// where it lives, and `npm test` never collected it. It sat red for an unknown stretch while two
// real defects accumulated:
//
//   1. The Impeccable skill's installer (`.claude/skills/impeccable/scripts/hook-admin.mjs`) added a
//      second hook with a CWD-RELATIVE script path. `hooks.json`'s own description says commands
//      must resolve the repo root because "Codex does not guarantee CWD == workspace root" — so from
//      any nested directory that hook pointed at a file that is not there, and silently did nothing.
//   2. That hook had no `commandWindows`, the field Codex uses verbatim on Windows.
//
// The selftest's own assertion for (1) was a COUNT — "exactly ONE hook entry is configured" — which
// noticed that something arrived but nothing about what. It is now an allow-set naming each hook and
// its reason.
//
// This file is the STATIC half, made resident because that is the half that drifted: schema, the
// allow-set, root resolution, echo suppression, and that every referenced script is on disk. It runs
// in milliseconds and spawns nothing. The behavioural half — do these lines actually fire from a
// nested CWD, and is stdout exactly one JSON value — stays in the selftest, because it costs ~1.5s
// of real shells and compares `git status` across its own run, which is not safe under a parallel
// suite. Run it by hand after touching hooks: `node .codex/hooks/hooks-selftest.mjs`.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HOOKS = join(".codex", "hooks.json");

/** Named, with the reason. A third hook arriving is an edit here, not a number going up. */
const ALLOWED = [
  ".codex/hooks/self-review-reminder.mjs",
  ".claude/skills/impeccable/scripts/hook.mjs",
];

const cfg = JSON.parse(readFileSync(join(ROOT, HOOKS), "utf8"));

/** Every configured command entry, flattened out of event → group → hooks. */
export function entriesOf(config) {
  return Object.values(config.hooks || {}).flatMap((event) =>
    event.flatMap((group) => (group.hooks || []).map((h) => ({ ...h, matcher: group.matcher }))),
  );
}

/** The repo-relative script each command line invokes. */
export function scriptsIn(entry) {
  const line = `${entry.command || ""} ${entry.commandWindows || ""}`;
  return [...line.matchAll(/[\w.$(){}/\\-]*?((?:\.codex|\.claude)\/[\w./-]+\.mjs)/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
}

/** A command that names a script without resolving the repo root first. */
export function isCwdRelative(command) {
  return !/git rev-parse --show-toplevel/.test(command);
}

const entries = entriesOf(cfg);

describe(".codex/hooks.json holds its own contract", () => {
  it("still catches the two defects it was written for", () => {
    // Pinned against fixtures so a green run can never mean "the parser found no hooks".
    expect(isCwdRelative('node ".claude/skills/impeccable/scripts/hook.mjs"')).toBe(true);
    expect(isCwdRelative('node "$(git rev-parse --show-toplevel)/.claude/x.mjs"')).toBe(false);
    expect(scriptsIn({ command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/a.mjs"' })).toEqual([
      ".codex/hooks/a.mjs",
    ]);
    expect(entriesOf({ hooks: { PostToolUse: [{ matcher: "x", hooks: [{ type: "command" }] }] } })).toHaveLength(1);
  });

  it("carries ONLY the two top-level keys Codex's deny_unknown_fields parser accepts", () => {
    // Any extra key — a "//" comment included — rejects the WHOLE file at load, silently.
    expect(Object.keys(cfg).sort()).toEqual(["description", "hooks"]);
  });

  it("configures exactly the hooks on the allow-set, once each", () => {
    expect(entries.length).toBeGreaterThan(0);
    const configured = entries.flatMap(scriptsIn).sort();
    expect(configured).toEqual([...ALLOWED].sort());
  });

  for (const [i, e] of entries.entries()) {
    const label = scriptsIn(e)[0] ?? `entry ${i}`;

    it(`${label} is an executable command with both platform lines`, () => {
      // "command" is the only type Codex executes; anything else is configured and inert.
      expect(e.type).toBe("command");
      expect(typeof e.command).toBe("string");
      expect(e.command.length).toBeGreaterThan(0);
      expect(typeof e.commandWindows, `${label} has no commandWindows — Windows uses that field verbatim`).toBe(
        "string",
      );
    });

    it(`${label} resolves the repo root rather than trusting the CWD`, () => {
      expect(isCwdRelative(e.command), `${label}: POSIX line is CWD-relative`).toBe(false);
      expect(isCwdRelative(e.commandWindows ?? ""), `${label}: Windows line is CWD-relative`).toBe(false);
    });

    it(`${label} suppresses cmd.exe echo so stdout stays one JSON value`, () => {
      // Codex parses the ENTIRE trimmed stdout as one JSON value. A command-echo prefix from the
      // `for /f ... do` body under default ECHO ON makes the parse fail and the advisory vanish.
      expect(e.commandWindows ?? "").toMatch(/^@echo off\s*&/);
      expect(e.commandWindows ?? "").toMatch(/do @/);
    });

    it(`${label} exists on disk`, () => {
      for (const script of scriptsIn(e)) {
        expect(existsSync(join(ROOT, script)), `${HOOKS} points at ${script}, which is not there`).toBe(true);
      }
    });
  }
});
