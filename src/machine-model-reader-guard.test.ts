import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
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
//      to `invoke` is named below and held to the same rule at its own call sites.
//   6. `invoke` is reached only by its name: `@tauri-apps/api/core` is imported with a static
//      `import { … } from`, and nothing touches the package root, another spelling of the core
//      module, or the global Tauri objects.
//   7. The shipped app runs only code this guard reads. A support file, a test file, a stray `.js`
//      sibling or code outside `src/` could otherwise hand a renamed `invoke` to a screen where no
//      rule looks, and a module named by a value cannot be checked. So every module a production
//      file loads is named by a literal and is a production file or a registry package that
//      package.json declares. The resolver maps no other name: no alias, no tsconfig `paths`, and
//      one known plugin. Nothing loads code by URL (workers, worklets, script or frame elements).
//      The build serves nothing else that runs: `index.html` holds only the entry script, `public/`
//      holds only images and fonts, and the CSP takes no script, worker or frame from anywhere but
//      the app itself (#582, at 74b64745).
//   Every rule reads the TypeScript syntax tree, not the text. A comment, a regex or JSX text is
//   what the compiler says it is, and a string or a name is read as the value it runs as, escapes
//   included. Reading the text by hand let a `"//"` inside a string blank the code after it (#582,
//   at f4ef8dd3).
//
// What it cannot decide: a global looked up under a key built from pieces while the code runs. The
// syntax tree cannot follow a value through execution, so review catches that. Code built from a
// string (`eval`, `new Function`, a string timer, an inline handler) does not run in the shipped
// app, because its CSP (`script-src 'self'`, pinned by csp-lockdown-guard) refuses it. The looser
// dev CSP never ships. Everything written the ordinary way, and every construction or escape form a
// review has named, is decided here.
//
// The corpus is INVERTED on purpose (walk everything, exempt explicitly), the lesson the
// mutation-boundary guard learned: a new surface is in scope the moment it exists. Test files and
// the `src/test/` support folder are out of the corpus because they MOCK these commands; a mock is
// not a reader. Rule 7 keeps that exclusion from becoming a hiding place.

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
// Windows paths match whatever their case, so membership does too.
const corpusKeys = new Set(files.map((file) => file.toLowerCase()));

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
// in the wrapper's own body. The forward is exempt once, and every other use of the name must be a
// call with a plain literal first. So rule 5 holds one hop out, and a second forwarding helper is a
// violation until it is named here.
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

function forwardOf(tree: ts.SourceFile, wrapper: Wrapper): Forward | undefined {
  let found: Forward | undefined;
  walk(tree, (node) => {
    if (found || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== wrapper.name) return;
    const fn = node.initializer;
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return;
    const param = fn.parameters[0]?.name;
    if (!param || !ts.isIdentifier(param)) return;
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

// ── Loaded code (rule 7) ────────────────────────────────────────────────────────────────────────

// Vite's default resolve order (the resolver pin below keeps vite.config.ts from setting another),
// then the directory's index. As Vite and TypeScript both allow, a `.js`-style specifier also names
// the `.ts` file beside it. Every candidate that exists is checked, not only the first, so the two
// resolvers cannot disagree about which file loads.
const EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

function candidates(from: string, spec: string): string[] {
  const path = spec.replace(/[?#].*$/, "");
  const base = path.startsWith("/") ? join(".", path) : join(dirname(from), path);
  const swapped = /\.[cm]?jsx?$/i.test(base) ? [base.replace(/js(x?)$/i, "ts$1"), base.replace(/\.js$/i, ".tsx")] : [];
  return [base, ...EXTENSIONS.map((ext) => base + ext), ...swapped, ...EXTENSIONS.map((ext) => join(base, `index${ext}`))];
}

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

// A bare specifier must name, whole, a package that package.json declares. Anything else could be an
// alias, a `#` subpath import or a virtual module, and any of those can map to any file.
const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const DEPENDENCIES = { ...PACKAGE.dependencies, ...PACKAGE.devDependencies };
const DECLARED = new Set(Object.keys(DEPENDENCIES));

// The names that load code from a URL rather than an import, and the elements that do the same.
const URL_LOADERS = new Set(["Worker", "SharedWorker", "serviceWorker", "importScripts", "addModule", "createContextualFragment", "srcdoc", "srcDoc"]);
const CODE_ELEMENTS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "portal", "fencedframe"]);

// Rule 7, per file: each load that names code outside the corpus, names no file, names a package
// nobody declared, or is not written as a literal at all, and each way to load code by URL.
// Rule 6 holds the Tauri API itself.
export function loads(source: string, file: string): string[] {
  const tree = parse(source, file);
  const bad = new Set<string>();
  const check = (spec: ts.Node | undefined, at: ts.Node) => {
    const text = spec && plainText(spec);
    if (text === undefined) return void bad.add(`${lineOf(tree, at)} (a module named by a value, not a literal)`);
    if (!/^(?:\.{1,2}(?:\/|$)|\/)/.test(text)) {
      const [, name = "", rest = ""] = /^(@[^/]+\/[^/]+|[^/]+)(.*)$/.exec(text.replace(/[?#].*$/, "")) ?? [];
      if (!DECLARED.has(name)) bad.add(`${text}: no package package.json declares`);
      else if (/(^|\/)\.\.?(\/|$)/.test(rest)) bad.add(`${text}: steps out of its package`);
      return;
    }
    const found = candidates(file, text).filter(isFile);
    if (found.length === 0) bad.add(`${text}: resolves to no file`);
    for (const hit of found) if (CODE.test(hit) && !corpusKeys.has(hit.toLowerCase())) bad.add(`${text} -> ${hit}: code this guard does not read`);
  };
  walk(tree, (node) => {
    // A URL can name any file the app serves, and on the dev server that is every file in the repo.
    const name = nameOf(node);
    if (name !== undefined && URL_LOADERS.has(name)) bad.add(`${lineOf(tree, node)} (${name} loads code by URL)`);
    if (name === "createElement" || name === "createElementNS") {
      const call = calleeCall(node);
      const tag = call?.arguments?.[name === "createElementNS" ? 1 : 0];
      const text = tag && plainText(tag);
      if (text === undefined || CODE_ELEMENTS.has(text.toLowerCase())) bad.add(`${lineOf(tree, node)} (an element that can load code)`);
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && CODE_ELEMENTS.has(node.tagName.text.toLowerCase())) {
      bad.add(`${lineOf(tree, node)} (an element that loads code by URL)`);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier, node);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression, node);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) check(node.arguments[0], node);
    else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      // `import.meta.glob` loads files no list names, and `import.meta.url` locates a worker or a
      // module at run time. Only the build-time `import.meta.env` flags are read here.
      const up = node.parent;
      const env = ts.isPropertyAccessExpression(up) && up.name.text === "env";
      if (!env) bad.add(`${lineOf(tree, node)} (import.meta can load files no list names)`);
    }
  });
  return [...bad];
}

// ── What the shipped build resolves and serves (rule 7) ─────────────────────────────────────────

// Every file under a folder, at any depth.
function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(rel).isDirectory() ? listFiles(rel) : [rel];
  });
}

const TAURI = JSON.parse(readFileSync(join("src-tauri", "tauri.conf.json"), "utf8")) as {
  build?: Record<string, string>;
  app?: { security?: { csp?: Record<string, string>; capabilities?: unknown[] } };
};

// The Vite settings this pin has read. A new one can change what a name resolves to or what the
// build serves.
const VITE_KEYS = new Set(["plugins", "clearScreen", "server", "port", "strictPort", "host", "hmr", "protocol", "watch", "ignored"]);

// public/ is copied into the build as it is and served beside the bundle, so it holds only files
// that cannot run: images and fonts, and SVG with no script in it.
const ASSET = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf)$/i;
const RUNS_IN_SVG = /<script|<foreignobject|\son\w+\s*=|javascript:/i;

// The CSP directives that decide where a script, a worker or a frame may come from.
const CODE_DIRECTIVES = ["default-src", "script-src", "script-src-elem", "script-src-attr", "worker-src", "child-src", "frame-src"];

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

  it("every module a production file loads is one this guard reads", () => {
    const offenders = files.flatMap((file) => loads(readFileSync(file, "utf8"), file).map((hit) => `${file} ${hit}`));
    expect(
      offenders,
      "a production file may load only production files: move shared code out of tests and src/test, " +
        "turn a .js file into .ts, name every module with a literal, import packages package.json " +
        "declares, and load no code by URL",
    ).toEqual([]);
  });

  it("the resolver maps a name no other way than rule 7 reads it", () => {
    // Vite also reads vite.config.js, .mjs, .cjs, .mts and .cts, and one of those would change the
    // rules unseen.
    const configs = readdirSync(".").filter((name) => name.startsWith("vite.config."));
    expect(configs, "keep one Vite config, vite.config.ts").toEqual(["vite.config.ts"]);
    const config = parse(readFileSync("vite.config.ts", "utf8"), "vite.config.ts");
    const imports: string[] = [];
    const unread: string[] = [];
    let react: string | undefined;
    let plugins: ts.Expression | undefined;
    walk(config, (node) => {
      if (ts.isImportDeclaration(node)) {
        const spec = plainText(node.moduleSpecifier) ?? lineOf(config, node);
        imports.push(spec);
        if (spec === "@vitejs/plugin-react") react = node.importClause?.name?.text;
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || nameOf(node.expression) === "require")) {
        unread.push(lineOf(config, node));
      } else if (ts.isObjectLiteralElementLike(node)) {
        const named = ts.isSpreadAssignment(node) ? undefined : node.name;
        const key = named && (ts.isIdentifier(named) ? named.text : plainText(named));
        if (key === "plugins" && ts.isPropertyAssignment(node)) plugins = node.initializer;
        if (key === undefined || !VITE_KEYS.has(key)) unread.push(lineOf(config, node));
      }
    });
    expect(imports.sort(), "vite.config.ts imports Vite and its React plugin, nothing that could resolve a name").toEqual([
      "@vitejs/plugin-react",
      "vite",
    ]);
    expect(unread, "a new Vite setting can change what a name resolves to: check it against rule 7, then add it to VITE_KEYS").toEqual([]);
    const only = plugins && ts.isArrayLiteralExpression(plugins) && plugins.elements.length === 1 ? plugins.elements[0] : undefined;
    const reactOnly = !!only && ts.isCallExpression(only) && only.arguments.length === 0 && ts.isIdentifier(only.expression) && only.expression.text === react;
    expect(reactOnly, "the one Vite plugin is react(), with no options").toBe(true);
    // tsconfig `paths`, `baseUrl` and `rootDirs` are aliases to any resolver told to read them, and
    // `extends` can bring them in from elsewhere.
    for (const name of readdirSync(".").filter((file) => /^tsconfig.*\.json$/.test(file))) {
      const tsconfig = ts.parseConfigFileTextToJson(name, readFileSync(name, "utf8")).config ?? {};
      const options = tsconfig.compilerOptions ?? {};
      const maps = [...("extends" in tsconfig ? ["extends"] : []), ...["paths", "baseUrl", "rootDirs"].filter((key) => key in options)];
      expect(maps, `${name} maps module names`).toEqual([]);
    }
    // A declared name must be the registry's: not a local folder, a git ref, a URL or an npm alias.
    const unregistered = Object.entries(DEPENDENCIES).filter(([, range]) => !/^[\^~]?\d/.test(range)).map(([name, range]) => `${name}: ${range}`);
    expect(unregistered, "every dependency is a registry version range").toEqual([]);
    // And no build command points Vite at another config.
    const commands = [PACKAGE.scripts?.build, PACKAGE.scripts?.dev, TAURI.build?.beforeBuildCommand, TAURI.build?.beforeDevCommand];
    expect(commands.filter((cmd) => /(?:^|\s)(?:-c|--config)(?:\s|=|$)/.test(cmd ?? "")), "a build command names another Vite config").toEqual([]);
  });

  it("the shipped build serves no code beyond the bundle, and runs none it builds at run time", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html.match(/<script/gi), "index.html loads the entry script and no other").toHaveLength(1);
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(html.match(/\son\w+\s*=|javascript:|<(?:iframe|frame|object|embed|portal|base)\b/gi), "index.html runs nothing else").toBeNull();
    expect(files).toContain(join("src", "main.tsx"));
    const runnable = existsSync("public")
      ? listFiles("public").filter((file) => !ASSET.test(file) || (/\.svg$/i.test(file) && RUNS_IN_SVG.test(readFileSync(file, "utf8"))))
      : [];
    expect(runnable, "public/ is served as it is: images and fonts only, and no script in an SVG").toEqual([]);
    // Code built from a string, a blob: worker or a frame from elsewhere needs one of these to allow
    // it. csp-lockdown-guard pins default-src and script-src; the fallbacks are held here.
    const csp = TAURI.app?.security?.csp;
    expect(typeof csp, "the shipped CSP is a directive object").toBe("object");
    const open = CODE_DIRECTIVES.filter((d) => csp && d in csp && csp[d].split(/\s+/).some((t) => t && t !== "'self'" && t !== "'none'"));
    expect(open.map((d) => `${d}: ${csp?.[d]}`), "the CSP takes scripts, workers and frames from the app itself only").toEqual([]);
    // A remote origin with the IPC would run code no file here holds.
    const capabilities = listFiles(join("src-tauri", "capabilities"));
    const remote = [
      ...capabilities.filter((file) => !file.endsWith(".json") || "remote" in JSON.parse(readFileSync(file, "utf8"))),
      ...(TAURI.app?.security?.capabilities ?? []).filter((entry) => typeof entry !== "string").map(() => "an inline capability in tauri.conf.json"),
    ];
    expect(remote, "capabilities live in src-tauri/capabilities/*.json, and none opens the IPC to a remote origin").toEqual([]);
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

  it("the load rule catches code outside the corpus, and every real import passes", () => {
    const screen = join("src", "surfaces", "Sample.tsx");
    const app = join("src", "App.tsx");
    const outside = (hits: string[]) => hits.filter((hit) => hit.endsWith("code this guard does not read"));
    // A bridge in the excluded support folder, a test file, and code outside src (#582, at f4ef8dd3).
    expect(outside(loads('export { setup as call } from "../test/setup";', screen))).toHaveLength(1);
    expect(outside(loads('import "./machine-model-reader-guard.test";', app))).toHaveLength(1);
    expect(outside(loads('import { x } from "../scripts/verify-module-map";', app))).toHaveLength(1);
    expect(outside(loads('const m = await import("../scripts/verify-module-map.mjs");', app))).toHaveLength(1);
    // A module named by a value, a glob, or a name that resolves to nothing cannot be checked.
    expect(loads("const m = await import(path);", app)).toHaveLength(1);
    expect(loads("const m = await import(`./data/${name}`);", app)).toHaveLength(1);
    expect(loads("const m = require(name);", app)).toHaveLength(1);
    expect(loads('const all = import.meta.glob("./surfaces/*.tsx");', app)).toHaveLength(1);
    // The worker and the import.meta.url that locates it, one entry each.
    expect(loads('const w = new Worker(new URL("./sample.test.ts", import.meta.url));', app)).toHaveLength(2);
    expect(loads("const dev = import.meta.env.DEV;", app)).toEqual([]);
    expect(loads('import "./no-such-module";', app)).toEqual(["./no-such-module: resolves to no file"]);
    // A bare name no declared package owns could be an alias, a # import or a virtual module, and a
    // declared one can step out of its package (#582, at 74b64745).
    expect(loads('import { call } from "@bridge";', screen)).toEqual(["@bridge: no package package.json declares"]);
    expect(loads('import { call } from "#bridge";', screen)).toHaveLength(1);
    expect(loads('import { call } from "virtual:bridge";', screen)).toHaveLength(1);
    expect(loads('import { call } from "constructor";', screen)).toHaveLength(1);
    expect(loads('export { call } from "reakt";', screen)).toHaveLength(1);
    expect(loads('import { call } from "react/../../src/test/setup";', screen)).toHaveLength(1);
    // Code loaded by URL: a worker from public/ runs outside every import (#582, at 74b64745).
    expect(loads('const w = new Worker("/bridge.js", { type: "module" });', screen)).toHaveLength(1);
    expect(loads('const w = new SharedWorker("/bridge.js");', screen)).toHaveLength(1);
    expect(loads('navigator.serviceWorker.register("/bridge.js");', screen)).toHaveLength(1);
    expect(loads('CSS.paintWorklet.addModule("/bridge.js");', screen)).toHaveLength(1);
    expect(loads('importScripts("/bridge.js");', screen)).toHaveLength(1);
    expect(loads('const W = globalThis["Worker"];', screen)).toHaveLength(1);
    expect(loads("frame.srcdoc = html;", screen)).toHaveLength(1);
    expect(loads("const f = range.createContextualFragment(html);", screen)).toHaveLength(1);
    expect(loads('const s = document.createElement("script");', screen)).toHaveLength(1);
    expect(loads('const s = document.createElement("IFRAME");', screen)).toHaveLength(1);
    expect(loads('const s = document.createElementNS(ns, "script");', screen)).toHaveLength(1);
    expect(loads("const s = document.createElement(tag);", screen)).toHaveLength(1);
    expect(loads("const make = document.createElement;", screen)).toHaveLength(1);
    expect(loads('const f = <iframe src="/bridge.html" />;', screen)).toHaveLength(1);
    expect(loads('const s = <script src="/bridge.js"></script>;', screen)).toHaveLength(1);
    // What real code does passes: a corpus file by any of its specifiers, an asset, a package.
    expect(loads('import { x } from "./data/machine-model";', app)).toEqual([]);
    expect(loads('import { x } from "./data/machine-model.js";', app)).toEqual([]);
    expect(loads('import { x } from "../data/machine-model";', screen)).toEqual([]);
    expect(loads('import { x } from "/src/data/machine-model.ts";', app)).toEqual([]);
    expect(loads('import url from "./App.css?url";', app)).toEqual([]);
    expect(loads('import { invoke } from "@tauri-apps/api/core";', app)).toEqual([]);
    expect(loads('const { t } = await import("./data/machine-model");', app)).toEqual([]);
    expect(loads('import { createRoot } from "react-dom/client";', app)).toEqual([]);
    expect(loads('import * as THREE from "three";', app)).toEqual([]);
    expect(loads('const style = document.createElement("style");', app)).toEqual([]);
    expect(loads("const box = <section className={css} />;", app)).toEqual([]);
  });

  it("a planted direct reader in any other screen is a violation", () => {
    const screen = join("src", "surfaces", "HardwareGrid.tsx");
    expect(violations(screen, [MODEL])).toEqual([MODEL]);
    expect(violations(screen, ["get_hardware_info"])).toEqual(["get_hardware_info"]);
    expect(violations(READER, [RETIRED])).toEqual([RETIRED]);
    expect(violations(READER, [MODEL])).toEqual([]);
  });
});
