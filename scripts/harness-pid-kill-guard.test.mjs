// @vitest-environment node
//
// #615 bug->guard: a test harness must never kill by bare pid. Windows re-issues a freed pid after a
// few hundred new process/thread ids (253 to 1568 on the dev PC, 2026-09-28), and the full-suite
// gate creates that many within seconds, so a pid read a moment ago can name a vitest worker by kill
// time (#598). A Process object from Start() holds a handle, which pins its pid; one from
// GetProcessById holds none. `taskkill /T` also walks recorded parent pids onto strangers (#559).
//
// The ratchet: every string literal in scripts/**/*.test.mjs (the harness text these tests write
// out and run), plus the .ps1 harnesses below, with comments stripped, is scanned for the three
// pid-kill shapes. A match outside ALLOWLIST fails. Kill a started process through its own object
// (.Kill(), ChildProcess.kill()), or one you did not start through lib/held-process.ps1.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Test-only PowerShell harnesses a .test.mjs runs from disk rather than from a string.
const HARNESS_FILES = ["scripts/alias-propagation-harness.ps1", "scripts/lib/foreground-probe.ps1", "scripts/lib/held-process.ps1"];

// { file, rule, count, why }: `count` findings of `rule` in `file` are accepted, for the reason in
// `why`. An entry that no longer matches exactly fails too, so the list only ever shrinks.
const ALLOWLIST = [];

const RULES = [
  { rule: "getprocessbyid-kill", test: (line) => /GetProcessById\s*\([^)]*\)\s*\.Kill\b/i.test(line) },
  { rule: "stop-process-id", test: (line) => /\bStop-Process\b(?=[^\n]*\s-Id\b)|\bStop-Process\s+[$\d]/i.test(line) },
  { rule: "taskkill-pid", test: (line) => /\btaskkill(?:\.exe)?\b[^\n]*\/PID\b/i.test(line) },
];

// Comment lines (PowerShell #, <# #> blocks, JS/C# //, cmd REM and ::) are prose, not code.
function codeLines(text) {
  return text
    .replace(/<#[\s\S]*?#>/g, (block) => block.replace(/[^\n]/g, ""))
    .split(/\r?\n/)
    .map((line) => (/^\s*(#|\/\/|REM\s|::)/i.test(line) ? "" : line));
}

function scanText(text, file, firstLine, findings) {
  const lines = codeLines(text);
  lines.forEach((line, i) => {
    for (const { rule, test } of RULES) if (test(line)) findings.push({ file, line: firstLine + i, rule, text: line.trim() });
  });
  // The two-step form: a Process object from a pid lookup, killed on a later line.
  const code = lines.join("\n");
  if (/GetProcessById/i.test(code) && /\.Kill\s*\(/.test(code) && !findings.some((f) => f.file === file && f.rule === "getprocessbyid-kill" && f.line >= firstLine && f.line < firstLine + lines.length)) {
    const at = lines.findIndex((line) => /GetProcessById/i.test(line));
    findings.push({ file, line: firstLine + at, rule: "getprocessbyid-then-kill", text: lines[at].trim() });
  }
}

// Every string literal in a JS source, a template with substitutions taken whole. A literal that
// is exactly "taskkill" is a spawn target whose /PID arrives as a separate argument.
function scanSource(source, file, findings) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.rawText ?? node.text;
      if (/^taskkill(\.exe)?$/i.test(text)) findings.push({ file, line: lineOf(node), rule: "taskkill-pid", text });
      scanText(text, file, lineOf(node), findings);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.rawText ?? node.head.text, ...node.templateSpans.map((s) => "${}" + (s.literal.rawText ?? s.literal.text))].join("");
      scanText(text, file, lineOf(node), findings);
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function testFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".test.mjs"))
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((p) => !/[\\/]node_modules[\\/]/.test(p));
}

function scanTree() {
  const findings = [];
  for (const path of testFiles(join(root, "scripts"))) {
    scanSource(readFileSync(path, "utf8"), relative(root, path).replaceAll("\\", "/"), findings);
  }
  for (const file of HARNESS_FILES) scanText(readFileSync(join(root, file), "utf8"), file, 1, findings);
  return findings;
}

describe("the pid-kill scan finds each shape and only code (#615)", () => {
  // Assembled from pieces so no single literal in THIS file is a violation.
  const SP = "Stop-" + "Process";
  const GP = "[System.Diagnostics.Process]::" + "GetProcessById";
  const TK = "task" + "kill";
  const found = (source) => {
    const findings = [];
    scanSource(source, "planted.test.mjs", findings);
    return findings.map((f) => f.rule);
  };

  it("fails on each planted shape in a harness string", () => {
    expect(found("const H = `\n$x = 1\n" + SP + " -Id $child.Id -Force\n`;")).toEqual(["stop-process-id"]);
    expect(found("const H = `" + SP + " -Force -Id $p`;")).toEqual(["stop-process-id"]);
    expect(found("const H = String.raw`" + SP + " $pid`;")).toEqual(["stop-process-id"]);
    expect(found("const H = `" + GP + "($n).Kill()`;")).toEqual(["getprocessbyid-kill"]);
    expect(found("const H = `\n$p = " + GP + "($row.ProcessId)\n${x}\n$p.Kill()\n`;")).toEqual(["getprocessbyid-then-kill"]);
    expect(found("const H = '" + TK + " /F /PID ' + n;")).toEqual(["taskkill-pid"]);
    expect(found('spawnSync("' + TK + '", ["/PID", String(p.pid), "/T", "/F"]);')).toEqual(["taskkill-pid"]);
  });

  it("ignores comments, regex pins, and a kill through a started process's own object", () => {
    expect(found("// " + SP + " -Id 1\n/* " + TK + " /PID 2 */\nexpect(x).not.toMatch(/" + SP + " -Id/);")).toEqual([]);
    expect(found("const H = `\n# " + SP + " -Id $p.Id\n<#\n" + TK + " /PID 3\n#>\n$child.Kill()\n`;")).toEqual([]);
    expect(found("const H = `" + SP + " -Name compy`;")).toEqual([]);
  });
});

describe("no test harness kills by bare pid (#615)", () => {
  it("every pid kill in a harness is allowlisted, and every allowlist entry is still needed", () => {
    const findings = scanTree();
    const key = (f) => `${f.file}|${f.rule}`;
    const counts = new Map();
    for (const f of findings) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
    const allowed = new Map(ALLOWLIST.map((a) => [key(a), a]));
    const unallowed = findings.filter((f) => !allowed.has(key(f)) || counts.get(key(f)) !== allowed.get(key(f)).count);
    expect(unallowed.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.text}`), "kill through a held handle instead").toEqual([]);
    for (const a of ALLOWLIST) {
      expect(counts.get(key(a)) ?? 0, `stale allowlist entry ${key(a)}`).toBe(a.count);
      expect(a.why.length, `allowlist entry ${key(a)} needs a reason`).toBeGreaterThan(40);
    }
  });

  it("reads every harness file it names, and the whole test tree", () => {
    expect(testFiles(join(root, "scripts")).length).toBeGreaterThan(50);
    for (const file of HARNESS_FILES) expect(readFileSync(join(root, file), "utf8").length).toBeGreaterThan(0);
  });
});
