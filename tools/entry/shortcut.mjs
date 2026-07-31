// The one thing Kuya double-clicks has to keep being the one thing that works.
//
// bug->guard, found during the #23 acceptance journey. The Desktop shortcut shipped as
//
//     C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\pwsh.exe
//     -NoExit -NoProfile -File "C:\Users\Kuya\code\compy-control\compy-entry.ps1"
//
// and carried two defects, one visible and one waiting:
//
//   -NoExit            every successful launch left a console window for Kuya to close. That is
//                      guard 13, and it is the same chore this program exists to delete -- smaller,
//                      later, and disguised as a shortcut property rather than a line of script.
//   a versioned path   `Microsoft.PowerShell_7.6.4.0_...` is the CURRENT package folder. The Store
//                      updates PowerShell and that folder is gone, so the shortcut dies -- not at a
//                      moment anyone is testing it, but weeks later, silently, and the entrypoint
//                      is the one thing that cannot afford to be dead when it is reached for. The
//                      stable target is the execution alias in %LOCALAPPDATA%\Microsoft\WindowsApps.
//
// Neither was reachable by any test in the repository: the shortcut is not a tracked file, so every
// proof was about code the shortcut might or might not invoke. This module is what makes the
// shortcut a thing with an opinion held about it.
//
// The planner is pure over facts. `readShortcut` is the only part that touches the machine, and the
// launcher only ever REPORTS what it finds -- rewriting the owner's Desktop behind his back is not
// preparation, it is the kind of surprise the welfare-check rule exists for.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** The Store package folder that moves under the shortcut's feet on every PowerShell update. */
export const VERSIONED_PACKAGE = /WindowsApps[\\/]Microsoft\.PowerShell_\d+[\d.]*_/i;

const norm = (p) => String(p ?? "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Pull the script out of `-File "..."` / `-f ...`, quoted or not. */
export function scriptFromArgs(args) {
  const m = String(args ?? "").match(/-f(?:ile)?\s+(?:"([^"]+)"|(\S+))/i);
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * Is this shortcut one the owner can keep double-clicking?
 *
 * @param {object} facts
 * @param {string} facts.target      TargetPath — the executable
 * @param {string} facts.args        Arguments — the whole string, as the .lnk stores it
 * @param {string} facts.controlDir  the control folder the shortcut is supposed to run
 * @returns {{ok: boolean, defects: Array<{code: string, reason: string, remediation: string}>}}
 */
export function planShortcut({ target, args, controlDir, scriptName = "compy-entry.ps1" }) {
  const defects = [];
  const add = (code, reason, remediation) => defects.push({ code, reason, remediation });
  const exe = basename(norm(target));

  if (!target) {
    add("target.missing", "the shortcut has no target, so it runs nothing at all.", "recreate it pointing at pwsh.exe and compy-entry.ps1.");
  } else if (VERSIONED_PACKAGE.test(String(target))) {
    add(
      "target.versioned",
      "the shortcut points into a versioned PowerShell package folder, which the next PowerShell update deletes. It works today and dies silently later.",
      "point it at %LOCALAPPDATA%\\Microsoft\\WindowsApps\\pwsh.exe -- the execution alias survives updates.",
    );
  }

  // powershell.exe is 5.1, and 5.1 mis-decodes this repo's UTF-8-without-BOM scripts into parse
  // errors. That has already cost this project a debugging session once.
  if (target && exe !== "pwsh.exe" && exe !== "pwsh") {
    add(
      "target.notPwsh",
      `the shortcut runs ${exe || "an unknown program"} rather than pwsh. Windows PowerShell 5.1 mis-decodes this repo's UTF-8 scripts into parse errors.`,
      "point it at pwsh.exe (PowerShell 7).",
    );
  }

  if (/(^|\s)-noexit\b/i.test(String(args ?? ""))) {
    add(
      "args.noExit",
      "-NoExit holds a console window open after every successful launch, so Kuya is handed a window to close for no reason.",
      "drop -NoExit. A refusal still holds its own window; a success has nothing left to say.",
    );
  }

  // A profile can export CLAUDE_CODE_AUTO_COMPACT_WINDOW, and the process environment overrules every
  // settings file -- which is exactly the layer the launcher refuses to settle.
  if (!/(^|\s)-noprofile\b/i.test(String(args ?? ""))) {
    add(
      "args.profile",
      "without -NoProfile the launch inherits whatever a PowerShell profile exports, including a context window that would overrule the tier.",
      "add -NoProfile.",
    );
  }

  const script = scriptFromArgs(args);
  if (!script) {
    add("args.noScript", "the shortcut passes no -File, so it opens a prompt instead of starting work.", `add -File "<control>\\${scriptName}".`);
  } else if (controlDir && norm(script) !== norm(`${controlDir}\\${scriptName}`)) {
    add(
      "args.wrongScript",
      `the shortcut runs ${script}, not the launcher in ${controlDir}.`,
      `point -File at ${controlDir}\\${scriptName}.`,
    );
  }

  return { ok: defects.length === 0, defects };
}

/**
 * Find the launcher's shortcut on the Desktop.
 *
 * Matched by name rather than by asking Windows what launched this process, because a shortcut does
 * not tell its child which .lnk it was. The name is the owner's, so the match is deliberately loose:
 * "Compy - Start work", "Compy – Start work" (en dash), any casing.
 */
export function findDesktopShortcut({ home = homedir(), exists = existsSync, list = readdirSync } = {}) {
  for (const dir of [join(home, "Desktop"), join(home, "OneDrive", "Desktop")]) {
    if (!exists(dir)) continue;
    const hit = list(dir).find((f) => /^compy\b.*start.*\.lnk$/i.test(f));
    if (hit) return join(dir, hit);
  }
  return null;
}

/** Read a .lnk through the shell that owns the format. Returns null rather than throwing. */
export function readShortcut({ path, run = null }) {
  const ps = run ?? ((script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }));
  try {
    const out = ps(
      `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${JSON.stringify(path)});` +
        `[Console]::Out.Write((ConvertTo-Json @{target=$s.TargetPath;args=$s.Arguments;workdir=$s.WorkingDirectory} -Compress))`,
    );
    const parsed = JSON.parse(String(out).trim());
    return { target: parsed.target ?? "", args: parsed.args ?? "", workdir: parsed.workdir ?? "" };
  } catch {
    return null;
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const argv = process.argv.slice(2);
  const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const path = argOf("--lnk") ?? findDesktopShortcut();

  // No shortcut is not a defect. The launcher is perfectly runnable from a terminal, and inventing a
  // complaint about a file the owner never made is exactly the kind of noise this program deletes.
  if (!path) {
    console.log(JSON.stringify({ ok: true, checked: false, defects: [], reason: "no Compy shortcut on the Desktop to check." }));
    process.exit(2);
  }

  const facts = readShortcut({ path });
  const out = facts
    ? { ...planShortcut({ ...facts, controlDir: argOf("--control") }), checked: true, lnk: path, ...facts }
    : { ok: false, checked: true, lnk: path, defects: [{ code: "unreadable", reason: `the shortcut at ${path} could not be read.`, remediation: "check the path." }] };
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
}
