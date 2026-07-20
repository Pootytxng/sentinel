#!/usr/bin/env node
// Codex hook self-test (2026-07-19, portability/lane-hardening train).
//
// Purpose: DEMONSTRATE — not merely assert on paper — that the six hooks in this directory
// behave as documented, using nothing but harmless, local, read-only-to-the-repo operations:
//   * reminder / context delivery      → self-review-reminder, ship-reminder, subagent-throttle,
//                                         context-size-advisor emit additionalContext / a block
//                                         reason on their trigger inputs, and stay silent otherwise.
//   * narrow denial                     → subagent-model-guard DENIES only a non-exception
//                                         non-sonnet override (opus + non-web-design-director,
//                                         fable at all) and ALLOWS the documented exception + the
//                                         default (sonnet/haiku/no-override).
//   * stop behavior                     → stop-continue ALLOWS the stop when autopilot is disarmed
//                                         (no state file) and when stop_hook_active is already set.
//   * no Compy / Windows mutation       → the whole run leaves `git status --porcelain` byte-identical
//                                         (no repo write) and every hook side effect lands only under
//                                         the OS temp dir (throttle/checkpoint markers), never the
//                                         repo, registry, services, or any Windows state.
//
// This exercises the SCRIPTS. It does NOT and CANNOT exercise Codex's own hook runtime (how Codex
// resolves the shell, cwd, env, and matcher regex for each event) — that lives in Codex, not here.
// So a green run proves the hook logic is correct and harmless; it does not prove "the Codex
// failsafes are active." Only Codex running these hooks live proves that.
//
// Run:  node .codex/hooks/hooks-selftest.mjs      (exit 0 = all pass, exit 1 = a check failed)

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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

// A fresh, filesystem-safe session id per invocation so each hook's tmpdir throttle marker starts
// clean and the trigger fires deterministically (markers are the whole point of "tmpdir only").
let seq = 0;
const sid = () => `selftest-${process.pid}-${Date.now()}-${seq++}`;

// Run a hook script as Codex would: pipe a JSON event on stdin, read stdout. Returns {stdout,status}.
function runHook(script, payload, envOverrides = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS_DIR, script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, ...envOverrides },
  });
  return { stdout: r.stdout || "", status: r.status, stderr: r.stderr || "" };
}
function parse(stdout) {
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Snapshot the repo working tree so we can PROVE the run mutated nothing tracked/untracked in it.
function gitStatus() {
  return spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;
}
const statusBefore = gitStatus();

process.stdout.write("\n== Codex hook self-test ==\n");
process.stdout.write(`repo root: ${REPO_ROOT}\n`);

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[1] subagent-model-guard.mjs — narrow denial (deny only non-exception non-sonnet)\n");
{
  const deny1 = parse(runHook("subagent-model-guard.mjs", { tool_input: { model: "opus", subagent_type: "general-purpose" } }).stdout);
  check("opus + general-purpose is DENIED", deny1?.hookSpecificOutput?.permissionDecision === "deny", JSON.stringify(deny1));

  const deny2 = parse(runHook("subagent-model-guard.mjs", { tool_input: { model: "fable", subagent_type: "web-design-director" } }).stdout);
  check("fable is DENIED even for web-design-director (fable never)", deny2?.hookSpecificOutput?.permissionDecision === "deny");

  const allow1 = runHook("subagent-model-guard.mjs", { tool_input: { model: "opus", subagent_type: "web-design-director" } });
  check("opus + web-design-director is ALLOWED (documented exception, silent)", parse(allow1.stdout) === null && allow1.status === 0);

  const allow2 = runHook("subagent-model-guard.mjs", { tool_input: { model: "sonnet", subagent_type: "general-purpose" } });
  check("sonnet default is ALLOWED (silent)", parse(allow2.stdout) === null && allow2.status === 0);

  const allow3 = runHook("subagent-model-guard.mjs", { tool_input: { subagent_type: "general-purpose" } });
  check("no model override is ALLOWED (governed elsewhere, silent)", parse(allow3.stdout) === null && allow3.status === 0);
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[2] subagent-throttle.mjs — advisory reminder on the 3rd spawn, never a block\n");
{
  const s = sid();
  const r1 = parse(runHook("subagent-throttle.mjs", { session_id: s, tool_input: {} }).stdout);
  const r2 = parse(runHook("subagent-throttle.mjs", { session_id: s, tool_input: {} }).stdout);
  const r3 = parse(runHook("subagent-throttle.mjs", { session_id: s, tool_input: {} }).stdout);
  check("spawns 1 and 2 are silent (below threshold)", r1 === null && r2 === null);
  check("spawn 3 delivers additionalContext (SUBAGENT COUNT CHECK)", /SUBAGENT COUNT CHECK/.test(r3?.hookSpecificOutput?.additionalContext || ""));
  check("throttle NEVER denies — permissionDecision stays allow", r3?.hookSpecificOutput?.permissionDecision === "allow");
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[3] self-review-reminder.mjs — fires on a UI file, silent on non-UI\n");
{
  // Repo-relative path (Codex-style) — exercises the portability broadening in the hook's regex.
  const ui = parse(runHook("self-review-reminder.mjs", { session_id: sid(), tool_input: { file_path: "src/App.tsx" } }).stdout);
  check("repo-relative src/*.tsx edit delivers the self-review additionalContext", /self-review/.test(ui?.hookSpecificOutput?.additionalContext || ""));
  // Absolute path (Claude-style) — the same hook must still fire.
  const uiAbs = parse(runHook("self-review-reminder.mjs", { session_id: sid(), tool_input: { file_path: `${REPO_ROOT}/src/App.tsx` } }).stdout);
  check("absolute src/*.tsx edit delivers the self-review additionalContext", /self-review/.test(uiAbs?.hookSpecificOutput?.additionalContext || ""));
  check("it is a PostToolUse additionalContext, never a deny/block", ui?.hookSpecificOutput?.hookEventName === "PostToolUse" && !("permissionDecision" in (ui?.hookSpecificOutput || {})));

  const backend = runHook("self-review-reminder.mjs", { session_id: sid(), tool_input: { file_path: "src-tauri/src/lib.rs" } });
  check("a non-UI (.rs) edit is silent", parse(backend.stdout) === null && backend.status === 0);
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[4] ship-reminder.mjs — fires on a tauri build, silent on other bash\n");
{
  const build = parse(runHook("ship-reminder.mjs", { session_id: sid(), tool_input: { command: "npm run tauri build" } }).stdout);
  check("`tauri build` delivers the ship-law additionalContext", /ship LAW/.test(build?.hookSpecificOutput?.additionalContext || ""));

  const other = runHook("ship-reminder.mjs", { session_id: sid(), tool_input: { command: "git status" } });
  check("an unrelated bash command is silent", parse(other.stdout) === null && other.status === 0);
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[5] stop-continue.mjs — allows the stop when disarmed / already continuing\n");
{
  // No .codex/autopilot.json → disarmed → must ALLOW (never emit decision:block).
  const disarmedPath = join(HOOKS_DIR, "..", "autopilot.json");
  const disarmed = runHook("stop-continue.mjs", { session_id: sid() });
  const disarmedOut = parse(disarmed.stdout);
  check("disarmed (no autopilot.json present) ALLOWS the stop", !existsSync(disarmedPath) && (disarmedOut === null || disarmedOut.decision !== "block") && disarmed.status === 0);

  const active = runHook("stop-continue.mjs", { session_id: sid(), stop_hook_active: true });
  const activeOut = parse(active.stdout);
  check("stop_hook_active=true ALLOWS the stop (never loops)", (activeOut === null || activeOut.decision !== "block") && active.status === 0);
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[6] context-size-advisor.mjs — silent under threshold, checkpoint block over it\n");
{
  // Under threshold / no transcript → silent, harmless.
  const empty = runHook("context-size-advisor.mjs", { session_id: sid() });
  check("no transcript_path → silent (advisory, never breaks a stop)", parse(empty.stdout) === null && empty.status === 0);

  const looping = runHook("context-size-advisor.mjs", { session_id: sid(), stop_hook_active: true });
  check("stop_hook_active=true → silent (never loops)", parse(looping.stdout) === null && looping.status === 0);

  // Over threshold: build a fake transcript in the OS temp dir (NOT the repo) whose last assistant
  // usage exceeds the warn line, and confirm the hook emits a checkpoint block. All reads of repo
  // docs inside the hook are stat-only (read-only); its only writes are tmpdir markers.
  const scratch = mkdtempSync(join(tmpdir(), "compy-hooks-selftest-"));
  const fakeTranscript = join(scratch, "transcript.jsonl");
  writeFileSync(
    fakeTranscript,
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 200000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n"
  );
  const over = parse(
    runHook(
      "context-size-advisor.mjs",
      { session_id: sid(), transcript_path: fakeTranscript },
      { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000", CLAUDE_PROJECT_DIR: REPO_ROOT }
    ).stdout
  );
  check("~200k live context emits a CONTEXT CHECKPOINT block", over?.decision === "block" && /CONTEXT CHECKPOINT/.test(over?.reason || ""));
  // The checkpoint's job is persist-to-disk + let native auto-compact refresh — NOT stop the work or
  // run the old owner-paste flow. (The reason text mentions "paste"/"clear" only inside "do NOT …"
  // instructions, so assert the genuine positive properties, not naive substring absence.)
  const reason = over?.reason || "";
  check(
    "the checkpoint tells the model to persist to disk and lets auto-compact refresh (no stop)",
    /persist the working state to disk/.test(reason) && /auto-compact/.test(reason) && /do NOT stop the work/i.test(reason)
  );
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[7] no repo mutation — the whole run left the working tree byte-identical\n");
{
  const statusAfter = gitStatus();
  check("git status --porcelain unchanged across the entire self-test", statusAfter === statusBefore, statusAfter === statusBefore ? "" : "working tree changed");
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[8] hooks.json is valid and every referenced script exists\n");
{
  const hooksJsonPath = join(HOOKS_DIR, "..", "hooks.json");
  let cfg = null;
  try {
    cfg = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
  } catch (e) {
    check("hooks.json parses as JSON", false, String(e));
  }
  if (cfg) {
    check("hooks.json parses as JSON", true);
    const cmds = [];
    for (const event of Object.values(cfg.hooks || {})) {
      for (const group of event) {
        for (const h of group.hooks || []) {
          if (h.command) cmds.push(h.command);
        }
      }
    }
    check("every hook command node-invokes a .mjs under .codex/hooks", cmds.length > 0 && cmds.every((c) => /\.codex\/hooks\/[\w-]+\.mjs/.test(c)));
    const referenced = cmds.map((c) => c.match(/\.codex\/hooks\/([\w-]+\.mjs)/)?.[1]).filter(Boolean);
    const missing = referenced.filter((f) => !existsSync(join(HOOKS_DIR, f)));
    check("every referenced hook script file exists on disk", missing.length === 0, missing.join(", "));
    check("no hook command references a hardcoded workstation path", !cmds.some((c) => /[A-Za-z]:\\|Users[\\/]/.test(c)));
    check("no residual ${CLAUDE_PROJECT_DIR} (not a Codex contract)", !cmds.some((c) => c.includes("CLAUDE_PROJECT_DIR")));
  }
}

// ---------------------------------------------------------------------------------------------
process.stdout.write(`\n== ${failed === 0 ? "PASS" : "FAIL"}: ${passed} checks passed, ${failed} failed ==\n`);
if (failed > 0) {
  process.stdout.write("Failures:\n" + fails.map((f) => `  - ${f}`).join("\n") + "\n");
  process.exit(1);
}
process.exit(0);
