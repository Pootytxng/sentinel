// The verdict as the owner reads it.
//
// Lifted out of cli.mjs so it can be guarded. What a check REPORTS and what the owner SEES were not
// the same thing: `actual` prints only under a FAIL, so a passing check that still had something to
// say said it to nobody. Measured on the live 2026-07-30 PASS, where a forgiven stale overlay went
// green and silent. Returning lines rather than printing them is the whole point — a test can read
// them, and a launcher that repairs itself in silence is the failure this file exists to prevent.

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", off: "\x1b[0m" };

export function verdictLines(task, result) {
  const head = result.verdict === "PASS" ? `${C.green}PASS${C.off}` : `${C.red}REFUSE${C.off}`;
  const lines = ["", `  ${C.bold}#${task?.number} ${task?.title ?? ""}${C.off}`, `  preflight: ${head}`, ""];

  const width = Math.max(...result.checks.map((c) => c.name.length));
  const gutter = `       ${" ".repeat(width)}  `;
  for (const c of result.checks) {
    const mark = c.ok ? `${C.green}ok  ${C.off}` : `${C.red}FAIL${C.off}`;
    lines.push(`  ${mark} ${c.name.padEnd(width)}  ${C.dim}expected${C.off} ${c.expected}`);
    if (!c.ok) lines.push(`${gutter}${C.dim}actual  ${C.off}${C.yellow}${c.actual}${C.off}`);
    if (c.note) lines.push(`${gutter}${C.dim}note    ${C.off}${C.yellow}${c.note}${C.off}`);
  }

  if (result.remediation.length) {
    lines.push("", `  ${C.bold}What to do${C.off}`, ...result.remediation.map((r) => `   · ${r}`));
  }
  if (result.actions.length) lines.push("", `  ${C.dim}actions on launch: ${result.actions.join(", ")}${C.off}`);
  if (result.takeoverDraft) lines.push("", result.takeoverDraft, "");
  lines.push("");
  return lines;
}
