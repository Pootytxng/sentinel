#!/usr/bin/env node
// Codex hook self-test (corrective follow-up 2026-07-20).
//
// Scope: the Codex lane now retains exactly ONE hook — self-review-reminder.mjs, a PostToolUse hook
// matched on the Codex-native `apply_patch` tool name. The five Claude-lane hooks (stop-continue,
// ship-reminder, subagent-model-guard, subagent-throttle, context-size-advisor) were REMOVED as
// not-Codex-native and/or not-read-only, so their tests are gone; this test also asserts they stay
// gone (out of hooks.json and off disk).
//
// This exercises the hook FOUR ways:
//   (A) direct node invocation with Codex-shaped fixtures — apply_patch payloads that carry the edit
//       in `tool_input.command` (string AND arg-array), plus the `tool_input.file_path` fallback
//       shape — proving the parse/throttle logic.
//   (B) hooks.json SCHEMA — the file parses AND carries ONLY the two top-level keys Codex's HooksFile
//       accepts (`description`, `hooks`). Codex's HooksFile uses `deny_unknown_fields`, so ANY extra
//       top-level key (e.g. a `"//"` comment) rejects the WHOLE file at load — this section tests that
//       deny_unknown_fields contract, not merely that the JSON parses.
//   (C) the EXACT configured `command`/`commandWindows` strings, run THROUGH their NATIVE shells
//       (commandWindows via cmd.exe; the POSIX command via sh/bash) from THREE CWDs — repo root,
//       src-tauri/, and a deeper nested dir. The configured lines resolve the repo root via
//       `git rev-parse --show-toplevel`, so they must fire from any CWD; a CWD-RELATIVE script path
//       would fire from the root but MISS from a nested dir, failing this section by construction. A
//       negative control (a deliberately CWD-relative command) proves the nested-CWD test has teeth.
//   (D) NO repo mutation — the whole run leaves `git status --porcelain` byte-identical (the hook's
//       only side effect is a %TEMP% throttle marker, which this test also cleans up afterward).
//
// HONESTY BOUND (strengthened): a green run proves this script's parse/throttle logic, the hooks.json
// schema/deny_unknown_fields contract, and that the configured command lines resolve the repo root
// from any CWD + emit their advisory. It does NOT and CANNOT prove that Codex activates this hook
// in-product — how Codex resolves the event, matcher regex, cwd, and stdin lives in Codex's runtime,
// not here. Only a trusted Codex runtime run proves in-product activation. Do not read a green
// self-test as "the Codex failsafe is active."
//
// Run:  node .codex/hooks/hooks-selftest.mjs      (exit 0 = all pass, exit 1 = a check failed)

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
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
  "*** Begin Patch\n*** Update File: src/surfaces/HomeHud.tsx\n@@\n-const a = 1;\n+const a = 2;\n*** End Patch";
const APPLY_UI_CSS =
  "*** Begin Patch\n*** Update File: src/App.css\n@@\n-.a{color:red}\n+.a{color:blue}\n*** End Patch";
const APPLY_BACKEND =
  "*** Begin Patch\n*** Update File: src-tauri/src/lib.rs\n@@\n-let a = 1;\n+let a = 2;\n*** End Patch";
// Negative fixtures for the header-anchored UI detector (corrective follow-up 2026-07-20): the
// detector must key off the apply_patch FILE HEADER path (repo-root `src/…`), NEVER an arbitrary
// `src/` substring anywhere in the patch text. Both of these must be SILENT:
//   * a dist/ build artifact whose path CONTAINS "src/" but is not a repo-root src/ file, and
//   * a backend file whose patch BODY merely mentions a frontend path in a changed/context line.
const APPLY_DIST_CSS =
  "*** Begin Patch\n*** Add File: dist/src/generated.css\n@@\n+.x{color:red}\n*** End Patch";
const APPLY_BACKEND_MENTIONS_FRONTEND =
  "*** Begin Patch\n*** Update File: src-tauri/src/lib.rs\n@@\n-// see src/App.tsx for the TS contract\n+// see src/App.tsx and src/App.css for the TS contract\n*** End Patch";

// Run self-review-reminder.mjs directly under node with a JSON event on stdin. Returns {stdout,status}.
function runHook(payload, cwd = REPO_ROOT) {
  const r = spawnSync(process.execPath, [join(HOOKS_DIR, "self-review-reminder.mjs")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
  });
  return { stdout: r.stdout || "", status: r.status };
}
// Oracle that MATCHES Codex: its hook output parser (codex-rs/hooks/src/engine/output_parser.rs)
// trims the hook's ENTIRE stdout and parses it as ONE JSON value — it does NOT split lines and take
// the last one. So parse the WHOLE trimmed stdout here. This is the corrective-follow-up fix (2026-
// 07-20): the old last-line split MASKED a hook whose stdout carried a prefix (e.g. a cmd.exe
// command-echo line before the JSON) — that hook JSON.parse-fails in Codex and its advisory is
// discarded, so it must fail HERE too, not be salvaged by picking the last line.
function parse(stdout) {
  const s = (stdout || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
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

  const nestedCwd = join(REPO_ROOT, "src-tauri");
  const absUiNested = runHook(
    { session_id: sid(), tool_input: { file_path: join(REPO_ROOT, "src", "App.tsx") } },
    nestedCwd,
  );
  check(
    "absolute frontend file_path still fires when the hook CWD is nested",
    fires(absUiNested.stdout),
  );

  const absBackendCssNested = runHook(
    { session_id: sid(), tool_input: { file_path: join(REPO_ROOT, "src-tauri", "src", "fake.css") } },
    nestedCwd,
  );
  check(
    "absolute backend file_path stays SILENT when the hook CWD is nested",
    parse(absBackendCssNested.stdout) === null && absBackendCssNested.status === 0,
  );

  const backend = runHook({ session_id: sid(), tool_input: { command: APPLY_BACKEND } });
  check("a backend-only apply_patch (src-tauri/src/lib.rs) is SILENT", parse(backend.stdout) === null && backend.status === 0);

  const distCss = runHook({ session_id: sid(), tool_input: { command: APPLY_DIST_CSS } });
  check(
    "a dist/src/*.css build artifact (path CONTAINS 'src/' but is not repo-root src/) is SILENT",
    parse(distCss.stdout) === null && distCss.status === 0
  );

  const backendMentions = runHook({ session_id: sid(), tool_input: { command: APPLY_BACKEND_MENTIONS_FRONTEND } });
  check(
    "a backend apply_patch that only MENTIONS src/App.tsx in a body line is SILENT (header-anchored, not text-matched)",
    parse(backendMentions.stdout) === null && backendMentions.status === 0
  );

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

    // §1 deny_unknown_fields contract — Codex's HooksFile derives serde with deny_unknown_fields, so
    // the ONLY permitted top-level keys are `description` and `hooks`. A stray `"//"`/`"//readonly"`
    // comment key would reject the entire file at load. This is a SCHEMA guard, not a parse check.
    const ALLOWED_TOP = new Set(["description", "hooks"]);
    const topKeys = Object.keys(cfg);
    const unknownTop = topKeys.filter((k) => !ALLOWED_TOP.has(k));
    check(
      "hooks.json has ZERO unknown top-level keys (deny_unknown_fields — a `//` comment key rejects the whole file)",
      unknownTop.length === 0,
      unknownTop.length ? `unknown top-level key(s): ${unknownTop.join(", ")}` : ""
    );
    check(
      "hooks.json `description` is the single supported doc key (a non-empty string)",
      typeof cfg.description === "string" && cfg.description.length > 0,
      `typeof description = ${typeof cfg.description}`
    );
    check("hooks.json carries the required `hooks` object", cfg.hooks != null && typeof cfg.hooks === "object");

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
process.stdout.write("\n[5] configured command lines through their NATIVE shells, from MULTIPLE CWDs (CWD-independence)\n");
{
  // §2: each configured line resolves the repo root via `git rev-parse --show-toplevel`, so it must
  // fire identically whether Codex runs it from the repo root or a nested dir. We run the EXACT
  // configured strings through their native shells from three CWDs. A CWD-RELATIVE script path would
  // resolve from the root but FAIL from src-tauri/ — so a nested-CWD miss fails this section, and the
  // negative control below proves that discriminator actually has teeth.
  const EVENT = () => JSON.stringify({ session_id: sid(), tool_input: { command: APPLY_UI_TSX } });
  const CWDS = [
    ["repo root", REPO_ROOT],
    ["src-tauri/", join(REPO_ROOT, "src-tauri")],
    ["src/surfaces/ (nested)", join(REPO_ROOT, "src", "surfaces")],
  ];

  // Assemble the runnable legs — one per (configured command × native shell this host can launch).
  // cmd.exe is native for commandWindows; a POSIX sh is native for the POSIX command. An unavailable
  // shell is NOTED, never silently skipped.
  const legs = [];
  if (winCmd) {
    if (process.platform === "win32") {
      legs.push({ label: "commandWindows via cmd.exe", run: (cwd) => spawnSync(winCmd, { shell: true, cwd, input: EVENT(), encoding: "utf8" }) });
    } else {
      process.stdout.write("  note: not a Windows host — `commandWindows` (cmd.exe) leg NOTED not run; verify on Windows/CI.\n");
    }
  }
  if (posixCmd) {
    const shBin = ["sh", "bash"].find((b) => {
      const t = spawnSync(b, ["-c", "exit 0"], { encoding: "utf8" });
      return !t.error && t.status === 0;
    });
    if (shBin) {
      legs.push({ label: `command via ${shBin}`, run: (cwd) => spawnSync(shBin, ["-c", posixCmd], { cwd, input: EVENT(), encoding: "utf8" }) });
    } else {
      process.stdout.write("  note: no POSIX shell (sh/bash) launchable on this host — POSIX `command` leg NOTED not run.\n");
    }
  }
  check("at least one configured command line is runnable through a native shell on this host", legs.length > 0);

  for (const leg of legs) {
    for (const [cwdLabel, cwd] of CWDS) {
      const r = leg.run(cwd);
      check(`${leg.label} fires from ${cwdLabel}`, fires(r.stdout || ""), `status=${r.status} stderr=${(r.stderr || "").trim()}`);
    }
  }

  // §P0 (corrective follow-up 2026-07-20) — the WINDOWS leg's stdout must be Codex-parseable: the
  // WHOLE trimmed stdout is EXACTLY one JSON object, with NO cmd.exe command-echo prefix ahead of it.
  // This is the defect the old last-line-split oracle masked. Under default ECHO ON, `for /f … do
  // node …` echoes the expanded do-body (`C:\…>node "…"`) before the JSON, so JSON.parse(whole
  // stdout) throws and Codex discards the advisory. `@echo off &` + a leading `@` on the do-command
  // suppress it. The `fires()` checks above now use the whole-stdout oracle and so already fail on a
  // prefix; this asserts the property DIRECTLY and un-maskably (whole-JSON + no echo token).
  if (winCmd && process.platform === "win32") {
    const r = spawnSync(winCmd, { shell: true, cwd: REPO_ROOT, input: EVENT(), encoding: "utf8" });
    const raw = (r.stdout || "").trim();
    let whole = null;
    try {
      whole = JSON.parse(raw);
    } catch {
      whole = null;
    }
    check(
      "commandWindows stdout is EXACTLY one JSON object (whole trimmed stdout parses — Codex's contract)",
      whole !== null && typeof whole === "object",
      whole === null ? `whole stdout did not parse as JSON: ${JSON.stringify(raw.slice(0, 120))}` : ""
    );
    check(
      "commandWindows stdout carries NO cmd.exe command-echo prefix before the JSON",
      raw.startsWith("{") && !/>\s*node\b/i.test(raw) && !/rev-parse/i.test(raw),
      raw.startsWith("{") ? "" : `stdout begins with a non-JSON prefix: ${JSON.stringify(raw.slice(0, 80))}`
    );
  }

  // Negative control — a DELIBERATELY CWD-relative command must fire from the repo root but be SILENT
  // from src-tauri/. If it ever fired from src-tauri/, the CWD-independence checks above would be
  // vacuous. This is what makes "the test fails if the script path is relative to session CWD" true.
  const relCmd = process.platform === "win32"
    ? "node .codex\\hooks\\self-review-reminder.mjs"
    : "node .codex/hooks/self-review-reminder.mjs";
  const relAtRoot = spawnSync(relCmd, { shell: true, cwd: REPO_ROOT, input: EVENT(), encoding: "utf8" });
  const relAtNested = spawnSync(relCmd, { shell: true, cwd: join(REPO_ROOT, "src-tauri"), input: EVENT(), encoding: "utf8" });
  check("negative control: a CWD-relative command DOES fire from the repo root", fires(relAtRoot.stdout || ""));
  check("negative control: the SAME CWD-relative command is SILENT from src-tauri/ (proves the CWD test has teeth)", !fires(relAtNested.stdout || ""));

  process.stdout.write(
    "  note: these prove the configured lines resolve the repo root from ANY CWD + emit; a PASS still " +
      "does NOT prove Codex activates the hook in-product.\n"
  );
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[6] no repo mutation — the whole run left the working tree byte-identical\n");
{
  const statusAfter = gitStatus();
  check("git status --porcelain unchanged across the entire self-test", statusAfter === statusBefore, statusAfter === statusBefore ? "" : "working tree changed");
}

// ---------------------------------------------------------------------------------------------
process.stdout.write("\n[7] cleanup — remove the throttle markers THIS run created under %TEMP%\n");
{
  // §3: the hook's only side effect is a throttle marker in tmpdir. Every marker this run wrote is
  // keyed by a `selftest-<pid>-…` session id, so its filename is `compy-selfreview-selftest-<pid>-…`.
  // Remove ONLY that pid-scoped set — a bare `compy-selfreview-*` sweep would clobber a REAL concurrent
  // Codex/Claude session's live throttle marker, which is not ours to touch.
  const PREFIX = `compy-selfreview-selftest-${process.pid}-`;
  let removed = 0;
  let leftover = 0;
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      try {
        rmSync(join(tmpdir(), name));
        removed++;
      } catch {
        leftover++;
      }
    }
  } catch {
    /* tmpdir unreadable — nothing we can clean, and nothing was left in the repo */
  }
  check(`removed every self-test throttle marker this run created (${removed} removed)`, leftover === 0, leftover ? `${leftover} could not be removed` : "");
  process.stdout.write(`  note: cleanup is scoped to \`${PREFIX}*\` — other sessions' live markers are left untouched.\n`);
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
