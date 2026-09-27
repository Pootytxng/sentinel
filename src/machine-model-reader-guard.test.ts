import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import ts from "typescript";

// MACHINE-MODEL READER GUARD (#453 — Phase 2 of #385, slice 5).
//
// WHY THIS EXISTS: Phase 2 moved the Health grid, the History tape and the Test attribution onto
// ONE local model of the machine (`get_machine_model`, read only through `src/data/machine-model.ts`).
// Nothing stopped the next screen from rebuilding machine truth on its own — a fresh
// `invoke("get_hardware_info")` here, a private walk of `get_applied_changes` there — and the two
// journeys would drift apart again one surface at a time. Prose does not fail a build, so this does.
//
// The rules:
//   1. `get_machine_model` is invoked from `src/data/machine-model.ts` and nowhere else.
//   2. `get_intelligence_timeline` is invoked from nowhere. The command itself is retired (#453);
//      a new caller would be calling a command that no longer exists.
//   3. `get_hardware_info` and `get_applied_changes` are invoked only from the (file, command) pairs
//      named below, each with a written reason. They are the producers the model itself reads; the
//      named callers need a field the model does not carry, or feed a list the model does not own.
//   4. Everywhere, the reader and the exempt files included, a watched name appears only as the
//      first argument of a call. A name kept in a constant could be imported and invoked from a
//      file this guard would pass.
//   5. The sink: every `invoke` names its command as ONE plain string literal. A name assembled
//      from pieces or handed over in a variable is never a watched literal, so rules 1-4 cannot see
//      it, and there are too many ways to build a string to list them. `invoke` is imported under
//      its own name and never passed around as a value; the one wrapper that forwards its parameter
//      to `invoke` is named below, hands `invoke` that parameter as its caller wrote it, and is held
//      to the same rule at its own call sites.
//   6. `invoke` is reached only by its name: `@tauri-apps/api/core` is imported with a static
//      `import { … } from`, and nothing touches the package root, another spelling of the core
//      module, or the global Tauri objects.
//   Every rule reads the TypeScript syntax tree, not the text. A comment, a regex or JSX text is
//   what the compiler says it is, and a string or a name is read as the value it runs as, escapes
//   included. Reading the text by hand let a `"//"` inside a string blank the code after it (#582,
//   at f4ef8dd3).
//
// SCOPE: ordinary drift, not deliberate evasion (#582, round 11). The rules decide code written the
// ordinary way: a screen that calls a producer itself, keeps a command name in a constant, builds or
// forwards a name, or reaches `invoke` under another name. Code written to get past this guard is out
// of its scope. The boundary against that is the capability file (`src-tauri/capabilities/`),
// command-authority-guard, csp-lockdown-guard and review. A review finding that works only as a
// deliberate evasion is recorded as a known limit, not a defect here; ordinary code that slips past
// these rules is a defect. The known limits:
//   - Only production `.ts` and `.tsx` under `src/` is read. Code a screen loads from a test file,
//     from `src/test/`, from a `.js` file or from outside `src/` is not.
//   - A global looked up under a key built while the code runs. The syntax tree cannot follow a
//     value through execution.
//   - Code built from a string (`eval`, `new Function`, a string timer). The shipped CSP
//     (`script-src 'self'`, pinned by csp-lockdown-guard) refuses it.
//   - The build chain (Vite, tsconfig, npm scripts, Tauri and Cargo config), the files the build
//     serves, where a page navigates, and the Rust side. Rounds 5-10 of #582 pinned these here and
//     did not converge; that work, if wanted, is its own issue with its own threat model (#592).
//
// The corpus is INVERTED on purpose (walk everything, exempt explicitly), the lesson the
// mutation-boundary guard learned: a new surface is in scope the moment it exists. Test files and
// the `src/test/` support folder are out of the corpus because they MOCK these commands; a mock is
// not a reader.

const SRC = "src";
const TEST_SUPPORT = join("src", "test");

// ── Corpus ──────────────────────────────────────────────────────────────────────────────────────

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const rel = join(dir, name);
    if (statSync(rel).isDirectory()) {
      if (rel !== TEST_SUPPORT) out.push(...collect(rel));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out.sort();
}

const files = collect(SRC);

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

// A sample is read as TSX; a real file as its extension says.
const SAMPLE = "sample.tsx";

const parsed = new Map<string, ts.SourceFile>();
function parse(source: string, file: string): ts.SourceFile {
  const key = `${file}\n${source}`;
  let tree = parsed.get(key);
  if (!tree) {
    const kind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
    tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    parsed.set(key, tree);
  }
  return tree;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// A string written out whole, in quotes or in a backtick string with no `${`, as the value it runs
// as. A tagged template hands its text to a function, so it is a call, not a plain string.
function plainText(node: ts.Node): string | undefined {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return undefined;
  return ts.isTaggedTemplateExpression(node.parent) ? undefined : node.text;
}

// "line N: <that line>", for a report a reader can find.
function lineOf(tree: ts.SourceFile, node: ts.Node): string {
  const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  const starts = tree.getLineStarts();
  return `line ${line + 1}: ${tree.text.slice(starts[line], starts[line + 1] ?? tree.text.length).trim()}`;
}

// ── Detection ───────────────────────────────────────────────────────────────────────────────────

const MODEL = "get_machine_model";
const RETIRED = "get_intelligence_timeline";
const PRODUCERS = ["get_hardware_info", "get_applied_changes"] as const;
const WATCHED: readonly string[] = [MODEL, RETIRED, ...PRODUCERS];

// A command is named to `invoke` as a string literal whose whole value is the name; a type name, a
// comment, or a `source: "hardware::get_hardware_info"` provenance label is not one.
export function detect(source: string, file = SAMPLE): string[] {
  const seen = new Set<string>();
  walk(parse(source, file), (node) => {
    const text = plainText(node);
    if (text !== undefined && WATCHED.includes(text)) seen.add(text);
  });
  return WATCHED.filter((cmd) => seen.has(cmd));
}

// Rule 4: the watched names a source writes anywhere but as a call's first argument (a constant, an
// array, an object value). A violation in every file, whatever its exemption.
export function loose(source: string, file = SAMPLE): string[] {
  const seen = new Set<string>();
  walk(parse(source, file), (node) => {
    const text = plainText(node);
    const call = node.parent;
    const first = !!call && ts.isCallExpression(call) && call.arguments[0] === node;
    if (text !== undefined && WATCHED.includes(text) && !first) seen.add(text);
  });
  return WATCHED.filter((cmd) => seen.has(cmd));
}

// ── The sink (rules 5 and 6) ────────────────────────────────────────────────────────────────────

// The one wrapper that forwards its own parameter to `invoke`, by file and by the name its callers
// use. It is found by its shape: `const <name> = (<param>, …) => … invoke(<param>) …`, with that call
// in the wrapper's own body and nothing there rewriting or shadowing `<param>`. The forward is exempt
// once, and every other use of the name must be a call with a plain literal first. So rule 5 holds
// one hop out, and a second forwarding helper is a violation until it is named here.
type Wrapper = { name: string };
const WRAPPERS: Record<string, Wrapper> = {
  [join("src", "App.tsx")]: { name: "run" },
};

type Forward = { decl: ts.Node; call: ts.CallExpression };

// The function a node's code runs in.
function ownerOf(node: ts.Node): ts.Node | undefined {
  for (let up = node.parent; up; up = up.parent) if (ts.isFunctionLike(up)) return up;
  return undefined;
}

// A name in a place that writes it: the left of `=`, `+=` or another assignment, inside a
// destructuring target or not, a `++`/`--` operand, or a `for (… of/in …)` target.
function isWritten(node: ts.Node): boolean {
  let at: ts.Node = node;
  let up = node.parent;
  while (
    ts.isParenthesizedExpression(up) ||
    ts.isAsExpression(up) ||
    ts.isTypeAssertionExpression(up) ||
    ts.isNonNullExpression(up) ||
    ts.isSatisfiesExpression(up) ||
    ts.isArrayLiteralExpression(up) ||
    ts.isObjectLiteralExpression(up) ||
    ts.isSpreadElement(up) ||
    ts.isSpreadAssignment(up) ||
    (ts.isShorthandPropertyAssignment(up) && up.name === at) ||
    (ts.isPropertyAssignment(up) && up.initializer === at)
  ) {
    at = up;
    up = up.parent;
  }
  if (ts.isBinaryExpression(up)) {
    const op = up.operatorToken.kind;
    return up.left === at && op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
  }
  if (ts.isPrefixUnaryExpression(up) || ts.isPostfixUnaryExpression(up)) {
    return up.operator === ts.SyntaxKind.PlusPlusToken || up.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return (ts.isForOfStatement(up) || ts.isForInStatement(up)) && up.initializer === at;
}

// The parameter reaches `invoke` as the caller wrote it only while the wrapper's body never writes
// it and never declares another binding under its name in the wrapper's own scope. After
// `cmd = \`get_${cmd}\``, a caller's plain literal no longer names the command (#582, round 11).
function rebinds(fn: ts.ArrowFunction | ts.FunctionExpression, name: string): boolean {
  let hit = false;
  walk(fn.body, (node) => {
    if (hit || !ts.isIdentifier(node) || node.text !== name) return;
    const up = node.parent;
    const declares =
      (ts.isVariableDeclaration(up) || ts.isBindingElement(up) || ts.isFunctionDeclaration(up) || ts.isClassDeclaration(up)) &&
      up.name === node &&
      ownerOf(up) === fn;
    hit = declares || isWritten(node);
  });
  return hit;
}

function forwardOf(tree: ts.SourceFile, wrapper: Wrapper): Forward | undefined {
  let found: Forward | undefined;
  walk(tree, (node) => {
    if (found || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== wrapper.name) return;
    const fn = node.initializer;
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return;
    const param = fn.parameters[0]?.name;
    if (!param || !ts.isIdentifier(param) || rebinds(fn, param.text)) return;
    walk(fn.body, (inner) => {
      if (found || !ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression)) return;
      const arg = inner.arguments[0];
      const forwards = inner.expression.text === "invoke" && !!arg && ts.isIdentifier(arg) && arg.text === param.text;
      if (forwards && ownerOf(inner) === fn) found = { decl: node.name, call: inner };
    });
  });
  return found;
}

// A use of a name: an identifier, read as the name it spells (`inv\u006fke` IS `invoke`), or a
// string standing for one, as a key in `x["invoke"]` or a name in an import or export list.
function nameOf(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  const up = node.parent;
  const standsForName =
    !!up &&
    ((ts.isElementAccessExpression(up) && up.argumentExpression === node) ||
      ts.isImportSpecifier(up) ||
      ts.isExportSpecifier(up));
  return ts.isStringLiteralLike(node) && standsForName ? node.text : undefined;
}

// The call a name is the callee of: `f(…)`, `x.f(…)` or `x["f"](…)`, with or without `new`.
function calleeCall(node: ts.Node): ts.CallExpression | ts.NewExpression | undefined {
  const up = node.parent;
  const member =
    (ts.isPropertyAccessExpression(up) && up.name === node) ||
    (ts.isElementAccessExpression(up) && up.argumentExpression === node);
  const callee = member ? up : node;
  const call = callee.parent;
  return (ts.isCallExpression(call) || ts.isNewExpression(call)) && call.expression === callee ? call : undefined;
}

// `invoke("x", …)`, `ipc.invoke("x")` or `ipc["invoke"]("x")`: the name is what is called, and its
// first argument is a plain literal.
function calledWithPlain(node: ts.Node): boolean {
  const call = calleeCall(node);
  return !!call && ts.isCallExpression(call) && call.arguments.length > 0 && plainText(call.arguments[0]) !== undefined;
}

const CORE = "@tauri-apps/api/core";

// `import { invoke } from "@tauri-apps/api/core"`: the name brought in under itself.
function isNamedCoreImport(node: ts.Node): boolean {
  const spec = node.parent;
  if (!spec || !ts.isImportSpecifier(spec) || spec.name !== node || spec.propertyName) return false;
  const decl = spec.parent.parent.parent;
  return ts.isImportDeclaration(decl) && plainText(decl.moduleSpecifier) === CORE;
}

// A specifier for the module that exports `invoke`, however it is spelled: the package root, `core`
// or `index`, with an extension, a trailing slash, other letter case, or a `.` or `..` step.
function namesCore(spec: string): boolean {
  const m = /^@tauri-apps\/api(\/.*)?$/i.exec(spec);
  if (!m) return false;
  const rest = m[1] ?? "";
  if (/(^|\/)\.\.?(\/|$)/.test(rest)) return true;
  const bare = rest.replace(/^\/+|\/+$/g, "").replace(/\.(?:[cm]?js|d\.ts|[cm]?ts)$/i, "").toLowerCase();
  return bare === "" || bare === "core" || bare === "index";
}

// The one way in: a static named import from the core module, type-only included.
function isCoreImport(node: ts.Node): boolean {
  const decl = node.parent;
  if (!decl || !ts.isImportDeclaration(decl) || decl.moduleSpecifier !== node || plainText(node) !== CORE) return false;
  const clause = decl.importClause;
  return !!clause && !clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings);
}

// The global Tauri objects (`__TAURI__`, `__TAURI_INTERNALS__` and their plugin kin) hand `invoke`
// over under a key, so any name or string that spells one is a way around rule 5.
function touchesGlobals(node: ts.Node): boolean {
  const text =
    ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)
      ? node.text
      : undefined;
  return text?.includes("__TAURI") ?? false;
}

// Rules 5 and 6, per file: every place `invoke` (or the file's wrapper) is used other than as a call
// with a plain literal first argument or a bare `import { invoke }`, and every other way to reach it,
// as "line N: <that line>".
export function sink(source: string, wrapper?: Wrapper, file = SAMPLE): string[] {
  const tree = parse(source, file);
  const bad = new Set<string>(); // one entry per line, however many rules it breaks
  const flag = (node: ts.Node) => bad.add(lineOf(tree, node));
  const forward = wrapper && forwardOf(tree, wrapper);
  walk(tree, (node) => {
    const text = plainText(node);
    if (text !== undefined && namesCore(text) && !isCoreImport(node)) flag(node);
    if (touchesGlobals(node)) flag(node);
    const name = nameOf(node);
    if (name === "invoke") {
      if (!isNamedCoreImport(node) && node !== forward?.call.expression && !calledWithPlain(node)) flag(node);
    } else if (wrapper && name === wrapper.name) {
      if (node !== forward?.decl && !calledWithPlain(node)) flag(node);
    }
  });
  return [...bad];
}

// ── Exemptions ──────────────────────────────────────────────────────────────────────────────────

const READER = join("src", "data", "machine-model.ts");

// `${file}|${command}` → why that file may still call a producer directly. Each must stay LIVE (the
// file exists and still calls it) or be deleted; a reason shorter than a sentence is a placeholder.
const EXCEPTIONS: Record<string, string> = {
  [`${join("src", "App.tsx")}|get_hardware_info`]:
    "App.refresh loads the full HardwareInfo once per refresh and relays the display refresh rate to the overlay window; the model carries rig identity, not live display state.",
  [`${join("src", "App.tsx")}|get_applied_changes`]:
    "App.refresh feeds the rollback lists and the ledger-health probe, which need every ledger row including rolled-back ones; in-effect COUNTS already come from the model (in-effect-counts-source-guard).",
  [`${join("src", "surfaces", "Benchmark.tsx")}|get_hardware_info`]:
    "The Benchmark rig tier band needs max VRAM, physical cores and total RAM from the full HardwareInfo struct, which the model's identity facts do not carry.",
  [`${join("src", "surfaces", "Latency.tsx")}|get_hardware_info`]:
    "The Latency network-readiness pills read hw.network_pills, a live network signal from hardware.rs that the machine model does not carry.",
  [`${join("src", "surfaces", "use-scan.ts")}|get_applied_changes`]:
    "The scan names changes the ledger still marks applied that are no longer active on the machine (deriveReverted) to offer an inline 'turn it back on'; that needs every row with its rec_id, and the model's change list is capped for display.",
};

function violations(file: string, hits: string[]): string[] {
  return hits.filter((cmd) => {
    if (cmd === MODEL) return file !== READER;
    if (cmd === RETIRED) return true;
    return !(`${file}|${cmd}` in EXCEPTIONS);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────

describe("screens read machine truth through the Machine Model, never around it", () => {
  it("walks a real corpus", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(join("src", "App.tsx"));
    expect(files).toContain(READER);
    expect(files.some((f) => f.startsWith(TEST_SUPPORT))).toBe(false);
  });

  it("no source calls a watched command outside its allowed place", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const bad = violations(file, detect(source, file));
      const kept = loose(source, file).map((cmd) => `${cmd} (not a call argument)`);
      if (bad.length + kept.length > 0) offenders.push(`${file}: ${[...bad, ...kept].join(", ")}`);
    }
    expect(
      offenders,
      "read machine truth through src/data/machine-model.ts; a direct producer call needs a named " +
        "exemption with a reason, get_intelligence_timeline is retired, and a watched name is only " +
        "ever a call's literal first argument",
    ).toEqual([]);
  });

  it("every invoke names its command as one plain literal, so a built or forwarded name cannot slip past", () => {
    const offenders = files.flatMap((file) =>
      sink(readFileSync(file, "utf8"), WRAPPERS[file], file).map((hit) => `${file} ${hit}`),
    );
    expect(
      offenders,
      'write the command out: invoke("command_name", …). A name built from pieces, kept in a ' +
        "variable, or forwarded by a new helper hides which command a screen reads",
    ).toEqual([]);
  });

  it("keeps the wrapper entry live, so the exemption cannot outlive the wrapper", () => {
    for (const [file, wrapper] of Object.entries(WRAPPERS)) {
      expect(
        forwardOf(parse(readFileSync(file, "utf8"), file), wrapper),
        `${file} no longer declares ${wrapper.name} as a wrapper that forwards its parameter to invoke; rename or delete its entry`,
      ).toBeDefined();
    }
  });

  it("the one reader still reads the model", () => {
    expect(detect(readFileSync(READER, "utf8"), READER)).toContain(MODEL);
  });

  it("keeps every exemption live, so the list cannot rot into a rubber stamp", () => {
    for (const [key, reason] of Object.entries(EXCEPTIONS)) {
      const [file, cmd] = key.split("|");
      expect(files, `${file} is exempted but no longer exists`).toContain(file);
      expect(
        detect(readFileSync(file, "utf8"), file),
        `${file} no longer calls ${cmd} — delete its exemption rather than leaving a standing pass`,
      ).toContain(cmd);
      expect(reason.length, `${key} needs a real reason, not a placeholder`).toBeGreaterThan(80);
    }
  });

  it("the detector fires on each command as a string literal, and not on a comment or a label", () => {
    expect(detect('invoke<MachineModel>("get_machine_model")')).toEqual([MODEL]);
    expect(detect("invoke('get_intelligence_timeline')")).toEqual([RETIRED]);
    expect(detect("invoke(`get_hardware_info`)")).toEqual(["get_hardware_info"]);
    expect(detect('run<AppliedChange[]>("get_applied_changes", setChanges)')).toEqual([
      "get_applied_changes",
    ]);
    expect(detect("// get_intelligence_timeline used to feed this tape\nconst x = 0;")).toEqual([]);
    expect(detect("/* invoke(\"get_hardware_info\") */ const y = 1;")).toEqual([]);
    expect(detect('const source = "hardware::get_hardware_info";')).toEqual([]);
    // A comment marker inside a string or a regex is text, and the code after it is still read (#582, at f4ef8dd3).
    expect(detect('const marker = "//"; invoke("get_machine_model");')).toEqual([MODEL]);
    expect(detect('const open = "/*"; invoke("get_hardware_info"); const close = "*/";')).toEqual(["get_hardware_info"]);
    expect(detect('const re = /\\/\\//; invoke("get_machine_model");')).toEqual([MODEL]);
  });

  it("a watched name kept outside a call is caught, and every real call form passes", () => {
    // Kept for import elsewhere: the invoking file would carry no literal at all.
    expect(loose('export const MODEL_CMD = "get_machine_model";')).toEqual([MODEL]);
    expect(loose("const cmds = ['get_hardware_info', 'x'];")).toEqual(["get_hardware_info"]);
    expect(loose('const t = { cmd: "get_applied_changes" };')).toEqual(["get_applied_changes"]);
    expect(loose('const url = "https://x"; const m = "//"; export const C = "get_machine_model";')).toEqual([MODEL]);
    // The forms this codebase really uses.
    expect(loose('invoke<MachineModel>("get_machine_model")')).toEqual([]);
    expect(loose('invoke<{ network_pills?: NetworkPill[] } | null>("get_hardware_info")')).toEqual([]);
    expect(loose('run<AppliedChange[]>("get_applied_changes", setChanges)')).toEqual([]);
    expect(loose('ipc.invoke(\n  "get_hardware_info",\n)')).toEqual([]);
    expect(loose('// const OLD = "get_machine_model";\nconst y = 1;')).toEqual([]);
  });

  it("the sink rule catches every name that is not written out, and every real call form passes", () => {
    // The three forms Codex found passing the prefix check this rule replaced (#582, at f9581d5a).
    expect(sink('invoke(`get_${"machine_model"}`)')).toHaveLength(1);
    expect(sink('invoke(`get_machine${"_model"}`)')).toHaveLength(1);
    expect(sink('invoke("get_" + "hardware_info")')).toHaveLength(1);
    // Other constructions and hand-overs.
    expect(sink('invoke(`get_machine_${"model"}`)')).toHaveLength(1);
    expect(sink('invoke("get_hardware_" + kind)')).toHaveLength(1);
    expect(sink('invoke(["get", "machine", "model"].join("_"))')).toHaveLength(1);
    expect(sink("invoke(CMD)")).toHaveLength(1);
    expect(sink("invoke<T>(cmd)")).toHaveLength(1);
    expect(sink('import { invoke as call } from "@tauri-apps/api/core";')).toHaveLength(1);
    expect(sink('import { "invoke" as call } from ' + '"@tauri-apps/api/core";')).toHaveLength(1);
    expect(sink('export { invoke } from "@tauri-apps/api/core";')).toHaveLength(1);
    expect(sink("const call = invoke;")).toHaveLength(1);
    expect(sink('invoke.call(null, "get_machine_model")')).toHaveLength(1);
    expect(sink("ipc[`invoke`](name)")).toHaveLength(1);
    // A comment marker inside a string no longer hides the code after it (#582, at f4ef8dd3).
    expect(sink('const marker = "//"; invoke(["get", "machine", "model"].join("_"));')).toHaveLength(1);
    expect(sink('const open = "/*"; invoke(name); const close = "*/";')).toHaveLength(1);
    // The named wrapper forwards once; its own callers are held to the rule, and a second forward is not exempt.
    const app = WRAPPERS[join("src", "App.tsx")];
    const wrapped = "const run = <T,>(cmd: string) =>\n  invoke<T>(cmd);\n";
    expect(sink(wrapped, app)).toEqual([]);
    expect(sink(wrapped + 'run<X>("get_" + kind, set);', app)).toHaveLength(1);
    expect(sink(wrapped + "run<X>(name, set);", app)).toHaveLength(1);
    expect(sink(wrapped + "invoke<T>(cmd);", app)).toHaveLength(1);
    // The exemption is the wrapper's shape, so a forward under another name, or from a nested function, is not it.
    expect(sink("const go = <T,>(cmd: string) =>\n  invoke<T>(cmd);\n", app)).toHaveLength(1);
    expect(sink("const run = (cmd: string) => [1].map(() => invoke(cmd));", app)).toHaveLength(1);
    // A wrapper that rewrites or shadows its parameter builds the name itself, so the caller's plain
    // literal no longer names the command (Codex, #582 round 11, at bee748e5).
    const call = 'run<X>("machine_model", set);';
    const rebound = [
      "const run = <T,>(cmd: string) => {\n  cmd = `get_${cmd}`;\n  return invoke<T>(cmd);\n};\n",
      'const run = <T,>(cmd: string) => {\n  cmd += "_v2";\n  return invoke<T>(cmd);\n};\n',
      "const run = <T,>(cmd: string) => {\n  [cmd] = [`get_${cmd}`];\n  return invoke<T>(cmd);\n};\n",
      "const run = <T,>(cmd: string) => {\n  ({ cmd } = { cmd: `get_${cmd}` });\n  return invoke<T>(cmd);\n};\n",
      "const run = <T,>(cmd: string) => {\n  const fix = () => {\n    cmd = `get_${cmd}`;\n  };\n  fix();\n  return invoke<T>(cmd);\n};\n",
      "const run = <T,>(cmd: string) => {\n  if (legacy) {\n    const cmd = `get_${name}`;\n    return invoke<T>(cmd);\n  }\n  return invoke<T>(cmd);\n};\n",
    ];
    for (const shape of rebound) {
      expect(forwardOf(parse(shape, SAMPLE), app), shape).toBeUndefined();
      expect(sink(shape + call, app), shape).toContain("line 1: " + shape.split("\n")[0]);
    }
    expect(sink(rebound[0] + call, app)).toContain("line 3: return invoke<T>(cmd);");
    // Reading the parameter again, or a nested function's own `cmd`, leaves the forward as written.
    const reads = [
      "const run = <T,>(cmd: string) =>\n  invoke<T>(cmd).catch((e) => fail(`${cmd} failed`, e));\n",
      "const run = <T,>(cmd: string, set: (v: T) => void) =>\n  invoke<T>(cmd).then((cmd) => set(cmd));\n",
      "const run = <T,>(cmd: string) => {\n  const label = cmd;\n  log(label);\n  return invoke<T>(cmd);\n};\n",
    ];
    for (const shape of reads) expect(sink(shape + call, app), shape).toEqual([]);
    // An escaped identifier runs as the name it spells, and the compiler reads it as that name (#582, at 9105a072).
    expect(sink('core.inv\\u006fke(["get", "machine", "model"].join("_"))')).toHaveLength(1);
    expect(sink(wrapped + 'r\\u0075n(["get", "machine", "model"].join("_"), set);', app)).toHaveLength(1);
    expect(sink('inv\\u{6f}ke(name)')).toHaveLength(1);
    expect(detect('invoke("get_m\\u0061chine_model")')).toEqual([MODEL]);
    // A quote escape stays inside its string, and an escaped backslash leaves what follows as text.
    expect(sink('invoke("get_x\\u0022")')).toEqual([]);
    expect(sink('const text = "\\\\u0069nvoke(name)";')).toEqual([]);
    // A string also spells a character with a hex escape, or with a backslash before an ordinary one.
    expect(detect('invoke("get_m\\x61chine_model")')).toEqual([MODEL]);
    expect(detect('invoke("get_\\machine\\_model")')).toEqual([MODEL]);
    // A backslash before a line break joins the two lines, and the compiler reads the joined value, so
    // the command is caught by its real name. The text-reading guard could only refuse such a literal
    // outright; now it is plain, and it names what it calls.
    expect(detect('invoke("get_machine\\\n_model")')).toEqual([MODEL]);
    expect(detect('invoke(`get_machine\\\n_model`)')).toEqual([MODEL]);
    expect(detect('invoke("get_machine\\\u2028_model")')).toEqual([MODEL]);
    // Escapes are read only where the language reads them: a regex, a raw string and JSX text stay text.
    expect(sink("const re = /invo\\ke/;")).toEqual([]);
    expect(sink("const s = String.raw`inv\\u006fke(name)`;")).toEqual([]);
    expect(sink("const el = <p>invoke(name) and inv\\u006fke(name)</p>;")).toEqual([]);
    expect(detect('const re = /\\d/; invoke("get_machine_model");')).toEqual([MODEL]);
    // Rule 6: the invoke function reached without its name.
    expect(sink('import * as core from "@tauri-apps/api/core";\ncore[["inv", "oke"].join("")](name);')).toHaveLength(1);
    expect(sink('const core = await import("@tauri-apps/api/core");')).toHaveLength(1);
    expect(sink('export * from "@tauri-apps/api/core";')).toHaveLength(1);
    expect(sink('import { core } from "@tauri-apps/api";')).toHaveLength(1);
    expect(sink('import { invoke } from "@tauri-apps/api/c\\u006fre";\nimport * as c from "@tauri-apps/api/c\\x6fre";')).toHaveLength(1);
    expect(sink('import { invoke } from "@tauri-apps/api/core.js";')).toHaveLength(1);
    expect(sink('import { invoke } from "@tauri-apps/api/./core";')).toHaveLength(1);
    expect(sink('import { invoke } from "@tauri-apps/api/index";')).toHaveLength(1);
    expect(sink('import { invoke } from "@tauri-apps/API/core";')).toHaveLength(1);
    expect(sink('window.__TAURI_INTERNALS__[key](name);')).toHaveLength(1);
    expect(sink('const t = window["__TAURI__"];')).toHaveLength(1);
    expect(sink('const t = window["__TAUR\\u0049__"];')).toHaveLength(1);
    expect(sink('const t = window[`__TAURI_${"INTERNALS"}__`];')).toHaveLength(1);
    // What real code does passes: a named import, type-only included.
    expect(sink('import { invoke } from "@tauri-apps/api/core";\nimport type { InvokeArgs } from "@tauri-apps/api/core";')).toEqual([]);
    // The forms this codebase really uses.
    expect(sink('import { invoke } from "@tauri-apps/api/core";')).toEqual([]);
    // The specifier is spliced in so fixture-parity-guard, which reads imports as text, does not
    // take this sample for a real multi-line import.
    const core = '"@tauri-apps/api/core"';
    expect(sink(`import {\n  invoke,\n  Channel,\n} from ${core};`)).toEqual([]);
    expect(sink('invoke<MachineModel>("get_machine_model")')).toEqual([]);
    expect(sink('invoke<{ network_pills?: NetworkPill[] } | null>("get_hardware_info")')).toEqual([]);
    expect(sink('invoke<Record<string, number>>("get_x", { id })')).toEqual([]);
    expect(sink('ipc.invoke(\n  "get_hardware_info",\n)')).toEqual([]);
    expect(sink('ipc["invoke"]("get_hardware_info")')).toEqual([]);
    expect(sink(wrapped + 'run<AppliedChange[]>("get_applied_changes", setChanges);', app)).toEqual([]);
    expect(sink("// invoke(name) used to live here\nconst y = 1;")).toEqual([]);
  });

  it("a planted direct reader in any other screen is a violation", () => {
    const screen = join("src", "surfaces", "HardwareGrid.tsx");
    expect(violations(screen, [MODEL])).toEqual([MODEL]);
    expect(violations(screen, ["get_hardware_info"])).toEqual(["get_hardware_info"]);
    expect(violations(READER, [RETIRED])).toEqual([RETIRED]);
    expect(violations(READER, [MODEL])).toEqual([]);
  });
});
