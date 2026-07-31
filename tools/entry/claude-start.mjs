// When the panel does not answer, start the session in the folder itself.
//
// The open-URI is the nicer path — Claude comes up inside the VS Code window, no second console — but
// it is the one step of this journey that cannot be AIMED. Measured on this machine: the extension
// registers its handler at activation (`contributes.uriHandler` is null, so there is no on-demand
// activation), and both probes landed in the window that had already activated, never in the folder
// the launcher had just opened. Opening the workspace first and waiting for its live bridge makes the
// right window the likely one; it does not make it the certain one.
//
// So the URI gets a bounded turn, and then this takes over. Starting the CLI with its working
// directory set to the worktree is exact BY CONSTRUCTION — there is no window to guess at, no handler
// to race. Claude's project root is that folder, its `.claude/settings.json` is the canonical hook
// set the launcher just verified, and the SessionStart hook there hands it the brief.
//
// Two deliberate omissions:
//
//   no positional prompt   The CLI accepts one, and it is tempting: `claude "<the brief>"` visibly
//                          starts the turn. But then the brief has TWO carriers that can disagree,
//                          and the one on the command line is the copy that does not survive
//                          compaction. The hook's `initialUserMessage` is the single carrier, and it
//                          is the same one the panel path uses -- so both paths start identically.
//   nothing is submitted   for the user. This spawns a session; it does not type into one.
//
// `--ide` is added only when a live bridge names this exact folder, because a flag that means
// "connect to the editor" is a lie when there is no editor to connect to.
//
// And one refusal that had to be learned the expensive way: this spawns a TERMINAL program, so it
// needs a terminal. When the launcher itself is running without a console — anything that started it
// headlessly, an automation host, a scheduled task — the spawned CLI inherits that nothing, draws
// into a buffer with no screen behind it, and never comes up. The launcher then waits out its whole
// budget on a session that cannot arrive, prints advice about a window Kuya cannot find, and leaves
// the process running. Measured here during the acceptance run: the console the Desktop shortcut
// creates reports a real terminal on the launcher's inherited error stream; the headless case reports
// none. So the console is a fact like the others, and a launcher with no console says so and stops
// instead of leaking a process nobody can see.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { bridgeState } from "./ide-bridge.mjs";
import { canonicalizePath } from "./session-assert.mjs";

/** Where an installed Claude Code CLI actually lives on Windows, in the order worth trying. */
export const CLI_NAMES = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];

/**
 * Find the installed CLI: the per-user install first, then PATH.
 *
 * The per-user path is tried FIRST on purpose. PATH on this machine is inherited from whatever shell
 * the shortcut happened to spawn, and resolving the launcher's most important dependency out of a
 * mutable environment variable is how a working machine becomes an unreproducible one.
 */
export function resolveClaudeCli({ exists = existsSync, env = process.env, home = homedir() } = {}) {
  const preferred = join(home, ".local", "bin", CLI_NAMES[0]);
  if (exists(preferred)) return preferred;

  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir.trim()) continue;
    for (const name of CLI_NAMES) {
      const candidate = join(dir.trim(), name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * What should the launcher spawn, if anything?
 *
 * Pure over facts so every refusal below is a guard rather than a comment. Returns the exact
 * executable, working directory and argument list, or a plain reason there is nothing to spawn.
 */
export function planClaudeStart({ folder, exe, folderExists, bridge, terminal, sessionId = null, resume = false }) {
  if (!folder) {
    return { ok: false, reason: "no folder was given, and a session started in the wrong root is worse than no session." };
  }
  if (!exe) {
    return {
      ok: false,
      reason: "the Claude Code CLI is not installed anywhere this launcher can find it, so the editor window is the only way in.",
    };
  }
  if (!folderExists) {
    return { ok: false, reason: `${folder} is not there any more, so there is nothing to start a session in.` };
  }
  // Last, because the three above name a different problem entirely and reading this one first would
  // send Kuya looking at his terminal when the real trouble is a missing folder.
  if (!terminal) {
    return {
      ok: false,
      reason: "this launcher is not running in a window that can show a Claude session, so starting one here would leave it running where nobody can see or type into it.",
    };
  }

  const cwd = canonicalizePath(folder);
  // The launcher NAMES the conversation it starts, rather than starting one and hoping to recognise
  // it later. `--session-id` on a fresh start and `--resume` on an owned one are the same id, written
  // into the launch token before either runs -- so the SessionStart hook can ask "is this the session
  // I launched" and get an answer, and a different Claude process in the same folder cannot inherit
  // the authorization by standing in the right place. Omitted when no id was assigned, because a flag
  // with an empty value is worse than no flag.
  const identity = sessionId ? [resume ? "--resume" : "--session-id", sessionId] : [];
  return {
    ok: true,
    exe,
    cwd,
    args: [...identity, ...(bridge ? ["--ide"] : [])],
    ide: Boolean(bridge),
    sessionId: sessionId ?? null,
    resume: Boolean(sessionId && resume),
    reason: bridge
      ? "starting Claude in that folder and connecting it to the editor window"
      : "starting Claude in that folder (there is no live editor bridge to connect it to)",
  };
}

/**
 * The same plan, with the facts read off this machine. Reads only; spawning is the launcher's job.
 *
 * The console is read off the ERROR stream on purpose: the launcher captures this program's output
 * into a variable to parse the plan, so the output stream is a pipe on every real run and would
 * report "no terminal" even from the Desktop shortcut. The error stream is the one the launcher
 * leaves attached to the window it was started in, which makes it the honest witness.
 */
export function planFromMachine({
  folder,
  exists = existsSync,
  env = process.env,
  home = homedir(),
  bridge = null,
  terminal = process.stderr.isTTY === true,
  sessionId = null,
  resume = false,
} = {}) {
  const live = bridge ?? bridgeState({ folder }).ok;
  return planClaudeStart({
    folder,
    exe: resolveClaudeCli({ exists, env, home }),
    folderExists: Boolean(folder) && exists(folder),
    bridge: live,
    terminal,
    sessionId,
    resume,
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const argv = process.argv.slice(2);
  const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  let plan;
  try {
    plan = planFromMachine({
      folder: argOf("--folder"),
      bridge: argv.includes("--no-ide") ? false : null,
      sessionId: argOf("--session-id"),
      resume: argv.includes("--resume"),
    });
  } catch (e) {
    plan = { ok: false, reason: `the folder could not be inspected: ${String(e.message ?? e)}` };
  }
  console.log(JSON.stringify(plan));
  process.exit(plan.ok ? 0 : 1);
}
