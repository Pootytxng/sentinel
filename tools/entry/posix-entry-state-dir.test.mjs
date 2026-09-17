// Guard: the compy-entry store is an ABSOLUTE path on every platform — never the checkout (#440).
//
// THE DEFECT. `.claude/hooks/session-root-assert.mjs` resolved its store as:
//
//     join(process.env.LOCALAPPDATA ?? ".", "CompyEntry")
//
// `LOCALAPPDATA` is a Windows variable. On Linux — which is where cloud Claude Code sessions run,
// rooted at paths like /home/user/sentinel — it is unset, so the expression collapsed to the
// RELATIVE string "CompyEntry", and every reader and writer of the store resolved it against the
// hook process's cwd. That cwd is the session's own checkout. Measured with LOCALAPPDATA unset and
// a POSIX cwd, the three writers produced real files:
//
//     <cwd>/CompyEntry/board.json                     (writeBoardCache, via boardFacts)
//     <cwd>/CompyEntry/launch.json                    (writeToken)
//     <cwd>/CompyEntry/sessions/<folderhash>.json     (writeLineage)
//
// `.gitignore` names no CompyEntry, so those session records sat untracked in the work tree where a
// blind `git add -A` would commit them — conversation ids, folder hashes, pids and the whole Work
// Control board cache, into a public repository.
//
// WHY IT WAS LATENT RATHER THAN LOUD. `boardFacts` writes the cache only when the board FETCH
// succeeds, and the fetch shells out to `gh`. In a container without `gh` the read fails, the hook
// reports BOARD_UNREACHABLE, no verdict is ok, and nothing is written — so the folder stays clean
// and the bug looks absent. Give the same session a working `gh` and the cache lands in the
// checkout on the very first SessionStart, before any verdict is reached: `writeBoardCache` runs
// inside `boardFacts`, ahead of the `result.ok` branch that gates `writeLineage`. "It did not fire
// here" was never "it cannot fire".
//
// WHAT IS PINNED BELOW.
//   * The store is absolute wherever it is resolved from, so no cwd can ever place it in a checkout.
//     This is the regression proper: it FAILS against the `?? "."` expression.
//   * The Windows path stays BYTE-IDENTICAL to that expression, so the records already sitting in
//     %LOCALAPPDATA%\CompyEntry on the owner's machine keep resolving. A fix that relocates the
//     Windows store orphans every live lease and brief, which is a worse bug than the one it cures.
//   * Every derived path — briefs, lineage files, the board cache — inherits the absoluteness.
//     Pinning only TOKEN_DIR would let a later `join(".", ...)` reintroduce the same class.
//
// Companion: tools/entry/session-root-assert.test.mjs (severity + the duplicated path helpers).

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entryStateDir } from "../../.claude/hooks/session-root-assert.mjs";
import {
  CACHE_DIR_NAME,
  claimCacheDir,
  entryStateDir as scopeDriftStateDir,
} from "../../scripts/lib/scope-drift.mjs";

/**
 * A fresh evaluation of the hook module under a chosen environment.
 *
 * TOKEN_DIR is a module-level const computed at import time, which is exactly how the defect
 * shipped: by the time any caller could pass an override, the wrong value was already baked in and
 * every `dir = TOKEN_DIR` default in the file had taken it. So the guard has to re-evaluate the
 * module, not just call a helper — a helper that is right while the const is wrong is not a fix.
 */
async function loadUnder(env) {
  vi.resetModules();
  for (const key of ["LOCALAPPDATA", "XDG_STATE_HOME", "COMPY_ENTRY_DIR"]) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("../../.claude/hooks/session-root-assert.mjs");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the store is absolute on a POSIX session — it is never the checkout (#440)", () => {
  it("does not resolve to a relative path when LOCALAPPDATA is unset", async () => {
    const m = await loadUnder({});

    // The precise shape of the bug: "CompyEntry" is a valid path, and every write succeeded. It
    // simply meant a different folder for every process that asked.
    expect(m.TOKEN_DIR).not.toBe("CompyEntry");
    expect(isAbsolute(m.TOKEN_DIR)).toBe(true);
  });

  it("answers the same folder from any cwd, so no checkout can capture it", async () => {
    const m = await loadUnder({});

    // Two cwds a cloud session plausibly runs from. An absolute store answers identically from
    // both; a relative one answers with whichever checkout it happens to be standing in.
    expect(resolve("/home/user/sentinel", m.TOKEN_DIR)).toBe(resolve("/srv/build/sentinel", m.TOKEN_DIR));
    expect(resolve("/home/user/sentinel", m.TOKEN_DIR)).not.toBe("/home/user/sentinel/CompyEntry");
  });

  it("keeps every derived path absolute too — briefs, lineage, board cache", async () => {
    const m = await loadUnder({});

    expect(isAbsolute(m.BRIEF_DIR)).toBe(true);
    expect(isAbsolute(m.briefFile({ issue: 440 }))).toBe(true);
    expect(isAbsolute(m.lineageFile({ root: "/home/user/sentinel" }))).toBe(true);
    expect(isAbsolute(join(m.TOKEN_DIR, m.BOARD_CACHE_NAME))).toBe(true);
  });

  it("honours XDG_STATE_HOME, the POSIX place for state a program keeps between runs", async () => {
    const m = await loadUnder({ XDG_STATE_HOME: "/home/user/.local/state" });
    expect(m.TOKEN_DIR).toBe(join("/home/user/.local/state", "CompyEntry"));
  });

  it("falls back to the home directory when nothing names a state root", async () => {
    const m = await loadUnder({});
    expect(m.TOKEN_DIR).toBe(join(homedir(), ".local", "state", "CompyEntry"));
  });
});

describe("the Windows store does not move — existing records must keep resolving", () => {
  const LOCAL = "C:\\Users\\Kuya\\AppData\\Local";

  it("is byte-identical to the expression it replaces", async () => {
    const m = await loadUnder({ LOCALAPPDATA: LOCAL });

    // Deliberately compared against the OLD expression rather than a hand-written literal: the
    // promise being kept is "this value did not change", and only the old expression states it.
    expect(m.TOKEN_DIR).toBe(join(LOCAL, "CompyEntry"));
  });

  it("wins over XDG_STATE_HOME, so a POSIX variable leaking into a Windows shell cannot move it", async () => {
    const m = await loadUnder({ LOCALAPPDATA: LOCAL, XDG_STATE_HOME: "/home/user/.local/state" });
    expect(m.TOKEN_DIR).toBe(join(LOCAL, "CompyEntry"));
  });
});

describe("entryStateDir — the resolver, asked directly", () => {
  const home = "/home/user";

  it("prefers COMPY_ENTRY_DIR, the override scripts/lib/scope-drift.mjs already honours", () => {
    expect(entryStateDir({ env: { COMPY_ENTRY_DIR: "/srv/entry", LOCALAPPDATA: "C:\\L" }, home })).toBe("/srv/entry");
  });

  it("treats an empty or blank variable as unset, not as the current directory", () => {
    // `"" ?? x` is `""`, so the original expression turned a defined-but-empty LOCALAPPDATA into
    // the same relative path as an unset one. Blank is absence.
    expect(entryStateDir({ env: { LOCALAPPDATA: "" }, home })).toBe(join(home, ".local", "state", "CompyEntry"));
    expect(entryStateDir({ env: { LOCALAPPDATA: "   " }, home })).toBe(join(home, ".local", "state", "CompyEntry"));
  });

  it("ignores a RELATIVE override, because a relative override is the bug wearing a new name", () => {
    // The XDG spec says a relative XDG_STATE_HOME is to be ignored. The same reasoning covers the
    // others: whatever a caller meant by "CompyEntry", it cannot be allowed to mean "here".
    for (const env of [{ XDG_STATE_HOME: "state" }, { COMPY_ENTRY_DIR: "entry" }, { LOCALAPPDATA: "Local" }]) {
      expect(entryStateDir({ env, home })).toBe(join(home, ".local", "state", "CompyEntry"));
    }
  });

  it("never returns a relative path, for any environment a caller can hand it", () => {
    const envs = [{}, { LOCALAPPDATA: "" }, { XDG_STATE_HOME: "." }, { COMPY_ENTRY_DIR: ".." }, { LOCALAPPDATA: "./x" }];
    for (const env of envs) expect(isAbsolute(entryStateDir({ env, home }))).toBe(true);
  });
});

describe("the OTHER half of the store resolves the same folder — scripts/lib/scope-drift.mjs (#440)", () => {
  // The hook WRITES the store; the drift gate READS a folder inside it. They are two files, and
  // until this guard they were two resolvers: the hook's, fixed above, and `claimCacheDir`, which
  // fell back to `join(homedir(), "AppData", "Local")` — a Windows-shaped path spelled out by hand,
  // so on Linux it answered ~/AppData/Local/CompyEntry while the hook answered ~/.local/state/…
  //
  // Nothing is corrupted by that. Both are absolute, so #440's defect — the store landing INSIDE a
  // checkout — stays closed either way. What breaks is quieter and worse for a guard: the writer
  // and the reader look at different folders, so every claim reads back as `null`, which
  // scope-drift.mjs spells "not measured", and the drift gate stops measuring while reporting
  // nothing at all. A gate that fails is a gate; a gate that silently abstains is decoration.
  //
  // The repo's answer to shared logic is to duplicate it and pin the copies equal (precedent:
  // tools/entry/session-root-assert.test.mjs, the worktree-field path helpers). This is that pin.
  const home = "/home/user";

  /** Every shape either resolver decides differently on: absent, blank, relative, Windows, XDG. */
  const MATRIX = [
    {},
    { LOCALAPPDATA: "C:\\Users\\Kuya\\AppData\\Local" },
    { LOCALAPPDATA: "" },
    { LOCALAPPDATA: "   " },
    { LOCALAPPDATA: "Local" },
    { XDG_STATE_HOME: "/home/user/.local/state" },
    { XDG_STATE_HOME: "state" },
    { XDG_STATE_HOME: "/srv/state", LOCALAPPDATA: "C:\\Users\\Kuya\\AppData\\Local" },
    { COMPY_ENTRY_DIR: "/srv/entry" },
    { COMPY_ENTRY_DIR: "entry" },
    { COMPY_ENTRY_DIR: "", XDG_STATE_HOME: "/home/user/.local/state" },
    { COMPY_ENTRY_DIR: "/srv/entry", LOCALAPPDATA: "C:\\L", XDG_STATE_HOME: "/x" },
  ];

  it("resolves the state root identically to the hook, for every environment", () => {
    for (const env of MATRIX) {
      expect(scopeDriftStateDir({ env, home }), JSON.stringify(env)).toBe(entryStateDir({ env, home }));
    }
  });

  it("puts the claim cache INSIDE the folder the hook writes, not beside it", () => {
    for (const env of MATRIX) {
      // Asked with the real homedir(), because that is what claimCacheDir uses when a caller does
      // not name one — which is how every caller in the tree actually calls it.
      expect(claimCacheDir({ env }), JSON.stringify(env)).toBe(
        join(entryStateDir({ env, home: homedir() }), CACHE_DIR_NAME),
      );
    }
  });

  it("never hands back a cache path the cwd could move, whatever the environment says", () => {
    // NOT `isAbsolute`: asked on Linux about `C:\\...` it says false, so a host-dependent assertion
    // would fail the Windows rows here and the POSIX rows on the owner's desk. The question that
    // actually matters is the one the resolver asks — is this path ROOTED, or would some cwd get to
    // decide where it lands? Spelled out here rather than imported so a resolver that quietly
    // widened what counts as rooted could not widen its own guard at the same time.
    const rooted = (s) => isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s);
    for (const env of MATRIX) expect(rooted(claimCacheDir({ env })), JSON.stringify(env)).toBe(true);
  });
});
