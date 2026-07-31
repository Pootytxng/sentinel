// What is running, and whether any of it contends with the folder we are about to write to.
//
// Disclosure is the default; refusal is the exception. Refusing merely because the installed Compy
// is open would make the entrypoint cry wolf, and a launcher that cries wolf gets bypassed — which
// is how the invariant dies. So a process refuses only when it is building, testing or installing
// against THIS folder (or installing at all, since an install is machine-wide).
//
// Nothing here ever stops a process. Collision rule 6: never stop another tool's build, helper,
// editor or session to clear a claim.

import { execFileSync } from "node:child_process";
import { canonicalizePath } from "./worktree-field.mjs";

/** Names worth listing at all. Everything else is noise in a report Kuya has to read. */
export const WATCHED = [
  "compy.exe",
  "cargo.exe",
  "rustc.exe",
  "node.exe",
  "npm.exe",
  "msbuild.exe",
  "Code.exe",
];

const isInstaller = (name) => /setup\.exe$|installer\.exe$|^msiexec\.exe$/i.test(name);
const isBuilder = (name) => /^(cargo|rustc|node|npm|msbuild)\.exe$/i.test(name);

/**
 * @param {Array<{name: string, commandLine?: string}>|null} raw
 * @returns {Array<{name, count, contends, note, samples: string[]}>}
 */
export function classifyProcesses(raw, { folder }) {
  const needle = canonicalizePath(folder ?? "").toLowerCase();
  const groups = new Map();

  for (const p of raw ?? []) {
    const name = p?.name ?? "";
    if (!name) continue;
    const cmd = String(p.commandLine ?? "");
    const inFolder = needle !== "" && canonicalizePath(cmd).toLowerCase().includes(needle);
    const contends = isInstaller(name) || (isBuilder(name) && inFolder);

    const g = groups.get(name) ?? { name, count: 0, contends: false, note: null, samples: [] };
    g.count += 1;
    if (contends && !g.contends) {
      g.contends = true;
      g.note = isInstaller(name)
        ? "an installer is running — installs are machine-wide"
        : "running against this folder";
    }
    if (g.samples.length < 2 && cmd) g.samples.push(cmd);
    groups.set(name, g);
  }

  return [...groups.values()];
}

/** Read live processes via CIM. Returns [] on any failure — a probe that cannot run is not a refusal. */
export function listProcesses({ names = WATCHED } = {}) {
  const filter = names.map((n) => `Name='${n}'`).join(" or ");
  const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object Name,CommandLine | ConvertTo-Json -Compress`;
  try {
    const out = execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r) => ({ name: r.Name, commandLine: r.CommandLine ?? "" }));
  } catch {
    return [];
  }
}

export const inspectProcesses = ({ folder }) => classifyProcesses(listProcesses(), { folder });
