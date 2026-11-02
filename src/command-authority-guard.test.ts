import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// COMMAND-AUTHORITY GUARD (Q2, 2026-08-03).
//
// WHY THIS EXISTS — a real, verified gap, not a hypothesis:
//
//   Tauri hands EVERY command registered in `invoke_handler(generate_handler![...])` to EVERY
//   window unless the app declares them in `tauri_build::AppManifest::commands`. Compy did not
//   declare them. Compy runs two windows. The always-on-top telemetry overlay invokes exactly
//   three read commands — and held authority over all 91, including `apply_recommendation`,
//   `rollback_change`, `set_license_key`, `suspend_known_service` and the update-restart barrier.
//
//   The capability files LOOKED least-privilege: the updater and the window controls were already
//   main-window-only. That is precisely why it survived review — the one class of authority that
//   was NOT in the capability system at all was invisible to anyone reading those files.
//
// So the rule is now mechanical, across four sources that must agree:
//
//   1. `src-tauri/src/lib.rs`            — what is actually registered
//   2. `src-tauri/build.rs` APP_COMMANDS — what is declared to the capability system
//   3. `capabilities/*.json`             — who may call what
//   4. `src/Overlay.tsx`                 — what the low-authority window actually needs
//
// A new command that is registered but not declared, or declared but granted to nobody, or granted
// to the overlay without the overlay calling it, fails the build. There is no list to remember.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const TAURI = join("src-tauri");
const CAPS = join(TAURI, "capabilities");

// ── Source 1: what lib.rs actually registers ────────────────────────────────────────────────────

// Registration entries carry their module path (`history::rollback_change`); the COMMAND NAME is
// the last segment, which is what Tauri's permission generator keys on.
export function registeredCommands(libSource: string): string[] {
  const block = /generate_handler!\[([\s\S]*?)\]\s*\)/.exec(libSource);
  if (!block) throw new Error("could not find generate_handler![...] in lib.rs");
  return block[1]
    .split(/[,\n]/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((entry) => /^[A-Za-z_][A-Za-z0-9_:]*$/.test(entry))
    .map((entry) => entry.split("::").pop() as string)
    .sort();
}

// ── Source 2: what build.rs declares ────────────────────────────────────────────────────────────

export function declaredCommands(buildSource: string): string[] {
  const block = /const APP_COMMANDS:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/.exec(buildSource);
  if (!block) throw new Error("could not find APP_COMMANDS in build.rs");
  return [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort();
}

// ── Source 3: who is granted what ───────────────────────────────────────────────────────────────

// An app command's permission is `allow-<kebab-name>` with NO plugin prefix — plugin permissions
// always carry one (`updater:allow-check`), which is exactly how the two are told apart here.
const APP_PERMISSION = /^allow-[a-z0-9-]+$/;

function permissionToCommand(permission: string): string {
  return permission.replace(/^allow-/, "").replace(/-/g, "_");
}

type Capability = { identifier: string; windows: string[]; permissions: unknown[] };

function capabilities(): Capability[] {
  return readdirSync(CAPS)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(CAPS, name), "utf8")) as Capability);
}

function grantedCommands(cap: Capability): string[] {
  return cap.permissions
    .filter((p): p is string => typeof p === "string" && APP_PERMISSION.test(p))
    .map(permissionToCommand)
    .sort();
}

// ── Source 4: what the overlay actually invokes ─────────────────────────────────────────────────

export function invokedCommands(source: string): string[] {
  return [...source.matchAll(/invoke\s*(?:<[^>]*>)?\s*\(\s*"([a-z0-9_]+)"/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

describe("command-authority guard: no window holds authority it does not need", () => {
  const lib = readFileSync(join(TAURI, "src", "lib.rs"), "utf8");
  const build = readFileSync(join(TAURI, "build.rs"), "utf8");
  const registered = registeredCommands(lib);
  const caps = capabilities();

  it("parses a real registration list (the regex has not silently stopped matching)", () => {
    expect(registered.length).toBeGreaterThan(50);
    expect(registered).toContain("apply_recommendation");
    expect(registered).toContain("get_cpu_sensors");
  });

  it("declares every registered command to the capability system", () => {
    // Without this, Tauri reverts to the old behaviour for the missing ones — silently, and only
    // for the commands nobody remembered, which is the worst possible failure shape.
    expect(declaredCommands(build)).toEqual(registered);
  });

  it("keeps custom commands OUT of Tauri's all-windows default", () => {
    // Comments are stripped first: build.rs legitimately DISCUSSES the old infallible call in the
    // rerun-if-changed notes, and prose about a call is not the call. (Caught on the first run of
    // this guard — the earlier version failed on a comment, which is a false positive, and a guard
    // that cries wolf gets deleted.)
    const code = build.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
    expect(
      /AppManifest::new\(\)\s*\.commands\(\s*APP_COMMANDS\s*\)/.test(code),
      "build.rs must pass APP_COMMANDS to AppManifest::commands, or every window regains every command",
    ).toBe(true);
    expect(
      /tauri_build::build\s*\(\s*\)/.test(code),
      "the bare infallible tauri_build::build() hands every command to every window again",
    ).toBe(false);
  });

  it("grants every command to exactly the windows that need it, and no command to nobody", () => {
    const granted = new Set(caps.flatMap(grantedCommands));
    const orphans = registered.filter((c) => !granted.has(c));
    expect(
      orphans,
      "these commands are registered and declared but granted to no window — they would fail at runtime",
    ).toEqual([]);
  });

  it("grants no permission for a command that does not exist", () => {
    const known = new Set(registered);
    const ghosts = caps
      .flatMap((cap) => grantedCommands(cap).map((c) => `${cap.identifier}: ${c}`))
      .filter((row) => !known.has(row.split(": ")[1]));
    expect(ghosts, "a grant for a command that is not registered is dead authority or a typo").toEqual([]);
  });

  it("gives the overlay exactly what it invokes — no more, no less", () => {
    const overlay = caps.find((c) => c.windows.includes("overlay"));
    expect(overlay, "no capability targets the overlay window").toBeDefined();
    expect(
      overlay!.windows,
      "the overlay capability must target ONLY the overlay; adding main here re-merges the two authorities",
    ).toEqual(["overlay"]);

    const needed = invokedCommands(readFileSync(join("src", "Overlay.tsx"), "utf8"));
    expect(needed.length).toBeGreaterThan(0);
    expect(
      grantedCommands(overlay!),
      "overlay grants must equal its real call sites — extra grants are inherited authority, missing ones are a runtime failure",
    ).toEqual(needed);
  });

  it("keeps every state-changing command away from the overlay", () => {
    // Belt and braces on top of the equality check above: even if Overlay.tsx someday calls one of
    // these, that is a design error and must be argued for in review, not absorbed silently.
    const FORBIDDEN_FOR_OVERLAY = [
      "apply_recommendation", "apply_recommendations_batch", "rollback_change",
      "suspend_known_service", "disable_known_bloat_task", "remove_known_preload_app",
      "restore_leftover", "set_startup_entry_enabled", "set_license_key",
      "begin_update_restart", "cancel_update_restart", "start_gaming_session",
      "stop_gaming_session", "recover_gaming_session", "set_keep_game_mode",
      "start_experiment", "conclude_experiment", "conclude_realplay", "restore_experiment",
      "apply_outcome_choice", "undo_outcome_choice",
      "start_tweak_trial", "start_stack_trial", "start_calibration", "export_report",
    ];
    const overlay = caps.find((c) => c.windows.includes("overlay"))!;
    const granted = new Set(grantedCommands(overlay));
    expect(FORBIDDEN_FOR_OVERLAY.filter((c) => granted.has(c))).toEqual([]);
  });

  it("keeps the updater and window controls main-window-only", () => {
    // Pre-existing least privilege that the Q2 split must not quietly undo.
    for (const id of ["updater", "window-controls"]) {
      const cap = caps.find((c) => c.identifier === id);
      expect(cap, `capability ${id} is missing`).toBeDefined();
      expect(cap!.windows).toEqual(["main"]);
    }
  });

  it("catches the exact pre-fix shape (positive control)", () => {
    // The real default.json as it stood before this train: both windows, zero command permissions.
    const preFix = {
      identifier: "default",
      windows: ["main", "overlay"],
      permissions: ["core:default", "opener:default", "notification:default"],
    } as Capability;
    expect(grantedCommands(preFix)).toEqual([]);
    expect(preFix.windows).toContain("overlay");
    // And the pre-fix build.rs declared nothing, so the sync check would fail loudly:
    expect(() => declaredCommands("fn main() { tauri_build::build() }")).toThrow();
  });
});
