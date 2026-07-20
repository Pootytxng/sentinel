#!/usr/bin/env node
// Codex hook self-test (corrective follow-up 2026-07-20).
//
// Scope: the Codex lane now retains exactly ONE hook — self-review-reminder.mjs, a PostToolUse hook
// matched on the Codex-native `apply_patch` tool name. The five Claude-lane hooks (stop-continue,
// ship-reminder, subagent-model-guard, subagent-throttle, context-size-advisor) were REMOVED as
// not-Codex-native and/or not-read-only, so their tests are gone; this test also asserts they stay
// gone (out of hooks.json and off disk).
//
// This exercises the hook TWO ways:
//   (A) direct node invocation with Codex-shaped fixtures — apply_patch payloads that carry the edit
//       in `tool_input.command` (string AND arg-array), plus the `tool_input.file_path` fallback
//       shape — proving the parse/throttle logic.
//   (B) the EXACT `commandWindows` string configured in hooks.json, run THROUGH the Windows command
//       runner (cmd.exe, via a shell), because "the node script works" and "the configured command
//       line works on Windows" are different claims — (B) catches a broken path/quoting in the config
//       that (A) would sail past. On a non-Windows host the POSIX `command` is run through the shell
//       instead, and the leg says so.
//
// HONESTY BOUND (strengthened): a green run proves this script's parse/throttle logic and that the
// configured Windows command line resolves + emits its advisory. It does NOT and CANNOT prove that
// Codex activates this hook in-product — how Codex resolves the event, matcher regex, cwd, and stdin
// lives in Codex's runtime, not here. Only a trusted Codex runtime run proves in-product activation.
// Do not read a green self-test as "the Codex failsafe is active."
//
// Run:  node .codex/hooks/hooks-selftest.mjs      (exit 0 = all pass, exit 1 = a check failed)

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: HOOKS_DIR, encoding: "utf8" })
  .stdout.trim();

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failed++;
    fails.push(name + (detail ? ` — ${detail}` : ""));
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

// A fresh, filesystem-safe session id per fire so the hook's tmpdir throttle marker starts clean and
// the trigger fires deterministically (the throttle keys off session_id).
let seq = 0;
const sid = () => `selftest-${process.pid}-${Date.now()}-${seq++}`;

// Codex-shaped apply_patch bodies. apply_patch carries the edit as a patch envelope whose file
// headers are `*** Update/Add/Delete/Move File: <path>`. A UI edit touches src/**/*.{tsx,css}.
const APPLY_UI_TSX =
  "*** Begin Patch\n*** Update File: src/surfaces/home/HomeHud.tsx\n@@\n-const a = 1;\n+const a = 2;\n*** End Patch";
const APPLY_UI_CSS =
  "*** Begin Patch\n*** Update File: src/theme.css\n@@\n-.a{color:red}\n+.a{color:blue}\n*** End Patch";
const APPLY_BACKEND =
  "*** Begin Patch\n*** Update File: src-tauri/src/lib.rs\n@@\n-let a = 1;\n+let a = 2;\n*** End Patch";

// Run self-review-reminder.mjs directly under node with a JSON event on stdin. Returns {stdout,status}.
function runHook(payload) {
  const r = spawnSync(process.execPath, [join(HOOKS_DIR, "self-review-reminder.mjs")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  return { stdout: r.stdout || "", status: r.status };
}
function parse(stdout) {
  const line = (stdout || "").trim().split("\n").filter(Boolean).pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
const fires = (out) => /self-review discipline/.test(parse(out)?.hookSpecificOutput?.additionalContext || "");

// Snapshot the working tree so we can PROVE the run mutated nothing tracked/untracked in the repo.
const gitStatus = () =>
  spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;
const statusBefore = gitStatus();

process.stdout.write("\n== Codex hook self-test ==\n");
process.stdout.write(`repo root: ${REPO_ROOT}\n`);

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[1] self-review-reminder — Codex apply_patch fixtures (tool_input.command)\n");
{
  const strTsx = runHook({ session_id: sid(), tool_input: { command: APPLY_UI_TSX } });
  check("apply_patch command (string) touching a src/*.tsx fires the reminder", fires(strTsx.stdout));

  const strCss = runHook({ session_id: sid(), tool_input: { command: APPLY_UI_CSS } });
  check("apply_patch command touching a src/*.css fires the reminder", fires(strCss.stdout));

  const arr = runHook({ session_id: sid(), tool_input: { command: ["apply_patch", APPLY_UI_TSX] } });
  check("apply_patch command as an arg-array (joined + scanned) fires the reminder", fires(arr.stdout));

  const shape = parse(strTsx.stdout)?.hookSpecificOutput || {};
  check(
    "emits a PostToolUse additionalContext, never a deny/permissionDecision",
    shape.hookEventName === "PostToolUse" && !("permissionDecision" in shape)
  );
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[2] self-review-reminder — file_path fallback + non-UI silence\n");
{
  const rel = runHook({ session_id: sid(), tool_input: { file_path: "src/App.tsx" } });
  check("repo-relative file_path src/*.tsx fires (fallback shape)", fires(rel.stdout));

  const abs = runHook({ session_id: sid(), tool_input: { file_path: `${REPO_ROOT}/src/App.tsx` } });
  check("absolute file_path src/*.tsx fires (fallback shape)", fires(abs.stdout));

  const backend = runHook({ session_id: sid(), tool_input: { command: APPLY_BACKEND } });
  check("a backend-only apply_patch (src-tauri/src/lib.rs) is SILENT", parse(backend.stdout) === null && backend.status === 0);

  const empty = runHook({ session_id: sid(), tool_input: {} });
  check("an apply_patch with no path in the payload is SILENT (fails safe, no false nag)", parse(empty.stdout) === null && empty.status === 0);
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[3] self-review-reminder — per-session throttle (advisory, at most once / 15 min)\n");
{
  const s = sid();
  const first = runHook({ session_id: s, tool_input: { command: APPLY_UI_TSX } });
  const second = runHook({ session_id: s, tool_input: { command: APPLY_UI_TSX } });
  check("first UI edit in a session fires", fires(first.stdout));
  check("an immediate second UI edit in the SAME session is throttled (silent)", parse(second.stdout) === null);
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[4] hooks.json — single retained hook, commandWindows present, removed hooks GONE\n");
const REMOVED = ["stop-continue", "ship-reminder", "subagent-model-guard", "subagent-throttle", "context-size-advisor"];
let cfg = null;
let winCmd = null;
let posixCmd = null;
{
  const hooksJsonPath = join(HOOKS_DIR, "..", "hooks.json");
  const raw = readFileSync(hooksJsonPath, "utf8");
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    check("hooks.json parses as JSON", false, String(e));
  }
  if (cfg) {
    check("hooks.json parses as JSON", true);

    // Flatten every configured command entry.
    const entries = [];
    for (const event of Object.values(cfg.hooks || {})) {
      for (const group of event) {
        for (const h of group.hooks || []) entries.push({ ...h, matcher: group.matcher });
      }
    }
    check("exactly ONE hook entry is configured (the retained self-review reminder)", entries.length === 1, `found ${entries.length}`);

    const e0 = entries[0] || {};
    check("the retained hook matches the Codex-native `apply_patch` tool name", e0.matcher === "apply_patch", String(e0.matcher));
    check('the retained hook is type "command" (the only executed type)', e0.type === "command");
    check("the retained hook targets self-review-reminder.mjs", /self-review-reminder\.mjs/.test(`${e0.command} ${e0.commandWindows}`));

    // Every configured hook MUST carry both a POSIX command and a native-Windows commandWindows.
    check("every configured hook has a POSIX `command`", entries.every((e) => typeof e.command === "string" && e.command.length > 0));
    check("every configured hook has a native-Windows `commandWindows`", entries.every((e) => typeof e.commandWindows === "string" && e.commandWindows.length > 0));

    winCmd = e0.commandWindows;
    posixCmd = e0.command;

    // No hardcoded workstation path, no Claude-only env token, and none of the removed hooks linger.
    const allCmds = entries.flatMap((e) => [e.command, e.commandWindows].filter(Boolean));
    check("no configured command references a hardcoded workstation path", !allCmds.some((c) => /[A-Za-z]:\\Users|\/Users\//.test(c)));
    check("no residual ${CLAUDE_PROJECT_DIR} (not a Codex contract)", !allCmds.some((c) => c.includes("CLAUDE_PROJECT_DIR")));
    check(
      "no removed hook is still referenced in hooks.json",
      !REMOVED.some((name) => raw.includes(`${name}.mjs`)),
      REMOVED.filter((n) => raw.includes(`${n}.mjs`)).join(", ")
    );
  }
}
// The removed hook scripts must also be gone from disk.
{
  const stillOnDisk = REMOVED.filter((name) => existsSync(join(HOOKS_DIR, `${name}.mjs`)));
  check("every removed hook script is deleted from disk", stillOnDisk.length === 0, stillOnDisk.join(", "));
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[5] configured command line through the SHELL command runner (not node directly)\n");
{
  // Run the ACTUAL command string from hooks.json via a shell — on Windows that is cmd.exe (the
  // native command runner the `commandWindows` field exists for); elsewhere it is /bin/sh with the
  // POSIX `command`. This proves the configured line (path + quoting) actually resolves and emits,
  // which invoking node on the .mjs directly (sections [1]-[3]) does not establish.
  const onWindows = process.platform === "win32";
  const cmdLine = onWindows ? winCmd : posixCmd;
  if (!cmdLine) {
    check("a configured command line was available to run through the shell", false, "no command in hooks.json");
  } else {
    const r = spawnSync(cmdLine, {
      shell: true, // Windows → %ComSpec% (cmd.exe); POSIX → /bin/sh. This IS the command runner.
      cwd: REPO_ROOT,
      input: JSON.stringify({ session_id: sid(), tool_input: { command: APPLY_UI_TSX } }),
      encoding: "utf8",
    });
    check(
      `configured ${onWindows ? "commandWindows (cmd.exe)" : "command (/bin/sh)"} fires on a UI apply_patch`,
      fires(r.stdout || ""),
      `status=${r.status} stderr=${(r.stderr || "").trim()}`
    );
    process.stdout.write(
      `  note: ran \`${cmdLine}\` via ${onWindows ? "cmd.exe" : "/bin/sh"} — a shell-runner PASS proves the ` +
        "configured line resolves + emits; it still does NOT prove Codex activates the hook in-product.\n"
    );
  }
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[6] no repo mutation — the whole run left the working tree byte-identical\n");
{
  const statusAfter = gitStatus();
  check("git status --porcelain unchanged across the entire self-test", statusAfter === statusBefore, statusAfter === statusBefore ? "" : "working tree changed");
}

// ---------------------------------------------------------------------------------------------
process.stdout.write(
  "\nReminder: this proves the retained hook's LOGIC and that its configured command line runs. It " +
    "does NOT prove the hook is active inside a real Codex session — only a trusted Codex runtime run does.\n"
);
process.stdout.write(`\n== ${failed === 0 ? "PASS" : "FAIL"}: ${passed} checks passed, ${failed} failed ==\n`);
if (failed > 0) {
  process.stdout.write("Failures:\n" + fails.map((f) => `  - ${f}`).join("\n") + "\n");
  process.exit(1);
}
process.exit(0);
