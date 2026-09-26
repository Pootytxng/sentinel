import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import ts from "typescript";
import { TREE_WALK_TIMEOUT_MS } from "./test/tree-walk-budget";

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
//      package.json declares. The resolver maps no other name: no alias, no tsconfig `paths`, no
//      JSX pragma, and one known plugin whose name nothing else in the config can take. Nothing
//      loads code by URL (workers, worklets, script or frame elements). The build serves nothing
//      else that runs: `index.html` holds only the entry script, `public/` holds only images and
//      fonts, and the CSP takes no script, worker or frame from anywhere but the app itself (#582,
//      at 74b64745). The build runs only the commands pinned here, with no npm lifecycle script,
//      and Tauri reads one config file, whose frontend folder, window pages and security settings
//      are pinned (#582, at 4d8f2900). No script body, and no script, hook, workflow or settings
//      file anywhere in the repo, hands Tauri another config (`--config`, `-c`, or `TAURI_CONFIG`
//      in any case). Cargo reads no config but its audit file, patches or replaces no crate, and
//      every crate in Cargo.lock comes from crates.io with a checksum. The Rust side opens no other
//      page and runs no other script in a webview: every Rust file is read as tokens, each webview
//      call is pinned whole with its arguments, any other method named like a webview API is
//      listed with why it changes no page, and no Rust file pulls in source by `include!` or
//      `#[path]` (#582, at 63c57f30 and 9c97047f).
//   Every rule reads the TypeScript syntax tree, not the text. A comment, a regex or JSX text is
//   what the compiler says it is, and a string or a name is read as the value it runs as, escapes
//   included. Reading the text by hand let a `"//"` inside a string blank the code after it (#582,
//   at f4ef8dd3). Three reads are not TypeScript on purpose: a JSX pragma lives in a comment, the
//   build scripts are read as lines for the config flags, and Rust is read as tokens (comments
//   dropped, strings kept whole) for the webview calls named below.
//
// Where a page navigates is no way around rule 7. A remote page gets no IPC: Tauri 2.11 refuses a
// custom command from a non-local origin unless a capability names that origin, and none does
// (pinned below). A local page can only be a file the build serves, which the pins above hold.
// Those two are the boundary. The navigation names (`location`, `navigation` and `open` read off
// anything, links, form actions, `<meta>` and `<base>`) are defense in depth: they keep the app
// from leaving itself in the ordinary ways, and a way this list misses still lands on a page with
// no IPC or on a file the pins hold.
//
// What it cannot decide: a global looked up under a key built from pieces while the code runs. The
// syntax tree cannot follow a value through execution, so review catches that. Code built from a
// string (`eval`, `new Function`, a string timer, an inline handler) does not run in the shipped
// app, because its CSP (`script-src 'self'`, pinned by csp-lockdown-guard) refuses it. The looser
// dev CSP never ships. Registry packages and Tauri plugins, scripts included, are trusted at the
// versions and hashes their lockfiles pin. A Rust name a macro builds from pieces is not a token
// this guard can see, so review catches that too. The machine the build runs on is outside the
// repo: a `TAURI_CONFIG` set in its shell, or a `~/.cargo` or `CARGO_HOME` config, is the
// builder's to keep clean.
//
// So this is a drift guard, not the security boundary. It decides code written the ordinary way
// and every construction a review has named. Code written to get past it is not all within its
// reach; the boundary against that is the CSP, the IPC origin check, the capability file and
// review.
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

// Where a page can be sent: the link and form targets, the names that move the page, and the
// elements that send it elsewhere or change where its links go.
const NAVIGATES = new Set(["href", "xlinkHref", "formAction"]);
const NAV_ELEMENTS = new Set(["a", "area", "meta", "base"]);
// `location`, `navigation` and `open` count read off anything, not only off a named window: a
// window is reached through a variable, an event, a node or a frame in more ways than a list of
// names can hold (#582, at 9c97047f). A data field that shares one of the names is pinned here by
// its file and exact text, and each pin must still match.
const MOVES_PAGE = new Set(["location", "navigation", "open"]);
const NAV_FIELDS = new Set([
  `${join("src", "surfaces", "SupportEvidence.tsx")}|bundle.location`,
  `${join("src", "surfaces", "lab", "OptimizeStation.tsx")}|(e.currentTarget as HTMLDetailsElement).open`,
]);
const navFieldsSeen = new Set<string>();

// The member expression when a name is read off something (`x.location`, `x["open"]`).
function readOff(node: ts.Node): ts.Expression | undefined {
  const up = node.parent;
  const member = (ts.isPropertyAccessExpression(up) && up.name === node) || (ts.isElementAccessExpression(up) && up.argumentExpression === node);
  return member ? up : undefined;
}

// An identifier that names a value where it stands: not a property, a key, a declared name, an
// attribute or a type.
function isReference(node: ts.Identifier): boolean {
  const up = node.parent;
  if (ts.isPropertyAccessExpression(up)) return up.expression === node;
  if (ts.isShorthandPropertyAssignment(up)) return true;
  if (ts.isQualifiedName(up) || ts.isTypeReferenceNode(up) || ts.isJsxAttribute(up) || ts.isImportSpecifier(up) || ts.isExportSpecifier(up)) return false;
  if (ts.isBindingElement(up) && up.propertyName === node) return false;
  return (up as { name?: ts.Node }).name !== node;
}

// `location.reload()`: the page loads itself again.
function reloads(at: ts.Node): boolean {
  const up = at.parent;
  return ts.isPropertyAccessExpression(up) && up.expression === at && up.name.text === "reload" && ts.isCallExpression(up.parent) && up.parent.expression === up;
}

// The node a declaration binds its name in, or undefined when the identifier declares nothing:
// `let`, `const` and `class` bind in their block, `var` and parameters in their function, a
// function expression's own name inside it, an import in the file, and a caught error in its catch.
function scopeOf(id: ts.Identifier): ts.Node | undefined {
  let decl: ts.Node = id.parent;
  if (ts.isBindingElement(decl) && decl.name === id) {
    while (ts.isBindingElement(decl) || ts.isObjectBindingPattern(decl) || ts.isArrayBindingPattern(decl)) decl = decl.parent;
  } else if ((decl as { name?: ts.Node }).name !== id) return undefined;
  if (ts.isParameter(decl)) return decl.parent;
  if (ts.isVariableDeclaration(decl)) {
    const list = decl.parent;
    if (ts.isCatchClause(list)) return list;
    const block = (node: ts.Node) => ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node);
    const fn = (node: ts.Node) => ts.isSourceFile(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isAccessor(node);
    const within = list.flags & ts.NodeFlags.BlockScoped ? block : fn;
    let scope: ts.Node = list.parent;
    while (!within(scope)) scope = scope.parent;
    return scope;
  }
  if (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isEnumDeclaration(decl)) return decl.parent;
  if (ts.isFunctionExpression(decl) || ts.isClassExpression(decl)) return decl;
  if (ts.isImportClause(decl) || ts.isImportSpecifier(decl) || ts.isNamespaceImport(decl) || ts.isImportEqualsDeclaration(decl)) return id.getSourceFile();
  return undefined;
}

// Whether a declaration in the file binds this reference: a local `open` is not the window's.
function boundHere(tree: ts.SourceFile, ref: ts.Identifier): boolean {
  const scopes = new Set<ts.Node>();
  walk(tree, (node) => {
    const scope = ts.isIdentifier(node) && node.text === ref.text ? scopeOf(node) : undefined;
    if (scope) scopes.add(scope);
  });
  for (let at: ts.Node | undefined = ref.parent; at; at = at.parent) if (scopes.has(at)) return true;
  return false;
}

// Where a value destructured from an `open` key is used as a flag, not handed on or called: negated,
// tested, on the left of `&&`, read from (`open.label`, but not `.call`, `.apply` or `.bind`), listed
// as a React hook's dependency, or passed to a component's prop, which is read in its own file.
const DEPENDENCY_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect", "useMemo", "useCallback", "useImperativeHandle"]);
function usedAsFlag(ref: ts.Identifier): boolean {
  const up = ref.parent;
  if (ts.isPrefixUnaryExpression(up)) return up.operator === ts.SyntaxKind.ExclamationToken;
  if (ts.isBinaryExpression(up)) return up.left === ref && up.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
  if (ts.isConditionalExpression(up)) return up.condition === ref;
  if (ts.isIfStatement(up) || ts.isWhileStatement(up) || ts.isDoStatement(up)) return up.expression === ref;
  if (ts.isPropertyAccessExpression(up)) return !["call", "apply", "bind"].includes(up.name.text);
  if (ts.isArrayLiteralExpression(up) && ts.isCallExpression(up.parent) && ts.isIdentifier(up.parent.expression)) {
    return DEPENDENCY_HOOKS.has(up.parent.expression.text) && up.parent.arguments[up.parent.arguments.length - 1] === up;
  }
  if (ts.isJsxExpression(up) && ts.isJsxAttribute(up.parent)) {
    const element = up.parent.parent.parent;
    return (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) && /^[A-Z]/.test(element.tagName.getText());
  }
  return false;
}

// Whether every use of the name an `open` key is destructured into is a flag.
function onlyFlags(tree: ts.SourceFile, bound: ts.Identifier): boolean {
  let ok = true;
  walk(tree, (node) => {
    if (ts.isIdentifier(node) && node !== bound && node.text === bound.text && isReference(node) && !usedAsFlag(node)) ok = false;
  });
  return ok;
}

// A form sent from code: `submit` or `requestSubmit` read off anything, its `action` set, or an
// attribute that sends the page or loads a file set by name.
const FORM_SENDS = new Set(["submit", "requestSubmit"]);
const SENDS_ATTRIBUTES = new Set(["action", "formaction", "href", "xlink:href", "src", "srcdoc", "data"]);
function assigned(node: ts.Node): boolean {
  const up = node.parent;
  return ts.isBinaryExpression(up) && up.left === node && up.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && up.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

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
      const text = tag && plainText(tag)?.toLowerCase();
      if (text === undefined || CODE_ELEMENTS.has(text) || NAV_ELEMENTS.has(text) || text === "form") {
        bad.add(`${lineOf(tree, node)} (an element that can load code or send the page elsewhere)`);
      }
    }
    // Navigation: `location`, `navigation` and `open` read off anything (a reload and a pinned data
    // field excepted), `location` and `navigation` reached bare, the window's `open` reached bare in
    // any way (`go = open`, `open.call(w, u)`) unless a declaration in the file binds it (#582, at
    // 3a0a9995), and a link or form target.
    if (name !== undefined && MOVES_PAGE.has(name)) {
      const member = readOff(node);
      const at = member ?? (ts.isIdentifier(node) && isReference(node) && (name !== "open" || !boundHere(tree, node)) ? node : undefined);
      const field = member && `${file}|${member.getText(tree)}`;
      if (field && NAV_FIELDS.has(field)) navFieldsSeen.add(field);
      else if (at && !reloads(at)) bad.add(`${lineOf(tree, node)} (${name} can send the page elsewhere; a data field of that name is pinned in NAV_FIELDS)`);
    }
    if (name !== undefined && NAVIGATES.has(name)) bad.add(`${lineOf(tree, node)} (${name} can send the page elsewhere)`);
    if (name !== undefined && FORM_SENDS.has(name) && readOff(node)) bad.add(`${lineOf(tree, node)} (${name} sends a form to its action)`);
    const field = name === "action" ? readOff(node) : undefined;
    if (field && assigned(field)) bad.add(`${lineOf(tree, node)} (a form's action set from code)`);
    if (name === "setAttribute" || name === "setAttributeNS") {
      const arg = calleeCall(node)?.arguments?.[name === "setAttributeNS" ? 1 : 0];
      const attribute = arg && plainText(arg)?.toLowerCase();
      if (attribute === undefined || SENDS_ATTRIBUTES.has(attribute)) bad.add(`${lineOf(tree, node)} (an attribute that sends the page or loads a file, set by name)`);
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      // `const { location } = anything`, and `const { open: go } = w` where `go` is then called or
      // handed on (#582, at 3a0a9995). A prop named `open` that is only used as a flag is not a
      // window's `open`.
      const key = node.propertyName ? (nameOf(node.propertyName) ?? plainText(node.propertyName) ?? (ts.isComputedPropertyName(node.propertyName) ? plainText(node.propertyName.expression) : undefined)) : nameOf(node.name);
      const opens = key === "open" && !(ts.isIdentifier(node.name) && onlyFlags(tree, node.name));
      if (key === "location" || key === "navigation" || opens) bad.add(`${lineOf(tree, node)} (${key} can send the page elsewhere)`);
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      const tag = node.tagName.text.toLowerCase();
      // A capitalised tag is a component (`<Area>` is a chart), and only a lower-case one is the element.
      const intrinsic = /^[a-z]/.test(node.tagName.text);
      if (CODE_ELEMENTS.has(tag)) bad.add(`${lineOf(tree, node)} (an element that loads code by URL)`);
      if (intrinsic && NAV_ELEMENTS.has(tag)) bad.add(`${lineOf(tree, node)} (an element that sends the page elsewhere)`);
      const action = node.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) && attr.name.text === "action");
      if (intrinsic && tag === "form" && action) bad.add(`${lineOf(tree, node)} (a form that submits to another page)`);
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
  // A JSX pragma (`@jsxImportSource ../test`) names the module the file's JSX compiles to, and it
  // lives in a comment, so it is read as text. A string that spells one fails too, which is safe.
  for (const match of source.matchAll(/@jsx\w*/g)) {
    bad.add(`line ${tree.getLineAndCharacterOfPosition(match.index ?? 0).line + 1} (${match[0]} picks the module JSX loads)`);
  }
  return [...bad];
}

// ── What the shipped build resolves and serves (rule 7) ─────────────────────────────────────────

// Every file under a folder, at any depth, past the folders named in `skip`.
function listFiles(dir: string, skip: ReadonlySet<string> = new Set()): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = join(dir, name);
    if (skip.has(rel)) return [];
    return statSync(rel).isDirectory() ? listFiles(rel, skip) : [rel];
  });
}

const TAURI = JSON.parse(readFileSync(join("src-tauri", "tauri.conf.json"), "utf8")) as {
  build?: Record<string, string>;
  app?: {
    windows?: { url?: string }[];
    security?: { csp?: Record<string, string>; capabilities?: unknown[] };
  };
};

// The Vite settings this pin has read. A new one can change what a name resolves to or what the
// build serves.
const VITE_KEYS = new Set(["plugins", "clearScreen", "server", "port", "strictPort", "host", "hmr", "protocol", "watch", "ignored"]);
// Every other name vite.config.ts may use. A helper, a class or a second `react` would be a new name.
const VITE_NAMES = new Set([...VITE_KEYS, "defineConfig", "react", "host", "process", "env", "TAURI_DEV_HOST", "undefined"]);

// npm runs these on its own: around any script it is asked to run (`prebuild`, `postbuild`), and on
// install, so one could rewrite the build before or after it.
const LIFECYCLE = new Set(["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "prepack", "postpack", "prepublish", "dependencies"]);

// ── Rust, read as tokens (rule 7) ───────────────────────────────────────────────────────────────

type RustToken = { text: string; word: boolean };

const RUST_RAW_STRING = /(?:b|c)?r(#*)"/y;
const RUST_STRING = /(?:b|c)?"/y;
const RUST_RAW_IDENT = /r#([\p{XID_Start}_][\p{XID_Continue}]*)/uy;
const RUST_IDENT = /[\p{XID_Start}_][\p{XID_Continue}]*/uy;
const RUST_NUMBER = /[0-9][0-9A-Za-z_]*/y;
const RUST_LIFETIME = /'[\p{XID_Start}_][\p{XID_Continue}]*/uy;

// Rust source as tokens. Comments are dropped (block comments nest), and so is whitespace. A string
// or a char is kept whole as it is written, and a raw identifier (`r#eval`) is the name it spells.
// So a line break, a comment or spacing between a receiver and its call changes nothing (#582, at
// 63c57f30). A literal that never closes throws, and the guard fails.
export function rustTokens(source: string): RustToken[] {
  const out: RustToken[] = [];
  const sticky = (re: RegExp, at: number) => {
    re.lastIndex = at;
    return re.exec(source);
  };
  // The end of a quoted literal that opens at `from`, past its escapes.
  const closeQuote = (from: number, quote: string) => {
    for (let j = from; j < source.length; j += 1) {
      if (source[j] === "\\") j += 1;
      else if (source[j] === quote) return j + 1;
    }
    throw new Error(`an unclosed ${quote} literal at offset ${from}`);
  };
  // A char literal opening at `at`, or undefined for a lifetime.
  const charEnd = (at: number) => {
    if (source[at + 1] === "\\") return closeQuote(at + 1, "'");
    const width = (source.codePointAt(at + 1) ?? 0) > 0xffff ? 2 : 1;
    return source[at + 1 + width] === "'" ? at + 2 + width : undefined;
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    let m: RegExpExecArray | null;
    if (/\s/.test(c)) i += 1;
    else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      let depth = 0;
      do {
        if (i >= source.length) throw new Error("an unclosed block comment");
        if (source.startsWith("/*", i)) (depth += 1), (i += 2);
        else if (source.startsWith("*/", i)) (depth -= 1), (i += 2);
        else i += 1;
      } while (depth > 0);
    } else if ((m = sticky(RUST_RAW_STRING, i))) {
      const close = `"${m[1]}`;
      const end = source.indexOf(close, i + m[0].length);
      if (end === -1) throw new Error(`an unclosed raw string at offset ${i}`);
      out.push({ text: source.slice(i, end + close.length), word: false });
      i = end + close.length;
    } else if ((m = sticky(RUST_STRING, i))) {
      const end = closeQuote(i + m[0].length, '"');
      out.push({ text: source.slice(i, end), word: false });
      i = end;
    } else if (source.startsWith("b'", i)) {
      const end = charEnd(i + 1);
      if (end === undefined) throw new Error(`a malformed byte literal at offset ${i}`);
      out.push({ text: source.slice(i, end), word: false });
      i = end;
    } else if ((m = sticky(RUST_RAW_IDENT, i))) {
      out.push({ text: m[1], word: true });
      i += m[0].length;
    } else if ((m = sticky(RUST_IDENT, i)) || (m = sticky(RUST_NUMBER, i))) {
      out.push({ text: m[0], word: true });
      i += m[0].length;
    } else if (c === "'") {
      const end = charEnd(i);
      if (end !== undefined) {
        out.push({ text: source.slice(i, end), word: false });
        i = end;
      } else if ((m = sticky(RUST_LIFETIME, i))) {
        out.push({ text: m[0], word: true });
        i += m[0].length;
      } else throw new Error(`a stray quote at offset ${i}`);
    } else if (source.startsWith("::", i)) {
      out.push({ text: "::", word: false });
      i += 2;
    } else {
      out.push({ text: c, word: false });
      i += 1;
    }
  }
  return out;
}

// Tokens written back as text: a space only between two words, so `let _ = w.eval(x)` is `let _=w.eval(x)`.
function rustText(tokens: RustToken[]): string {
  return tokens.map((token, at) => (at > 0 && token.word && tokens[at - 1].word ? ` ${token.text}` : token.text)).join("");
}

// The Rust names that pick a webview's page, run script in it, change the config the app was
// built with, or widen what the IPC answers. A type or a macro counts wherever it is named. A
// method counts where it is reached as one, after `.` or `::`, so a test's local closure called
// `eval` is not a webview. `Webview::builder` and its kin are matched with their type.
const WEBVIEW_TYPES = new Set(["WebviewWindowBuilder", "WebviewBuilder", "WindowBuilder", "WebviewUrl", "generate_context"]);
const WEBVIEW_METHODS = new Set([
  "eval", "eval_with_callback", "navigate", "with_webview", "set_url", "add_child", "from_config",
  "on_web_resource_request", "on_navigation", "on_new_window",
  "register_uri_scheme_protocol", "register_asynchronous_uri_scheme_protocol",
  "initialization_script", "initialization_script_for_all_frames", "append_invoke_initialization_script", "js_init_script",
  "js_init_script_on_all_frames", "invoke_system", "additional_browser_args",
  "config_mut", "set_assets", "assets_mut", "runtime_authority_mut", "add_capability",
]);
const BUILDER_TYPES = new Set(["WebviewWindow", "Webview", "Window"]);
// Tauri names these APIs for what they do, and so does WebView2 (`ExecuteScript`, `Navigate`), so
// any other name reached as a method or a path whose words say it runs script, moves or serves a
// page, or widens the IPC fails until a review either holds it above or lists it here with why it
// changes no page (#582, at 9c97047f). A name's words are its snake_case or CamelCase parts, so
// `description` is not `script`. Each entry must still be named somewhere.
const WEBVIEW_WORDS = new Set([
  "eval", "evaluate", "script", "scripts", "navigate", "navigation", "protocol", "webview", "invoke",
  "capability", "capabilities", "authority", "asset", "assets", "browser",
]);
const CAPTURE = "The ETW capture backend's report of what it can measure (capture.rs); it is not Tauri's capability API.";
const NOT_WEBVIEW: Record<string, string> = {
  get_webview_window: "Looks up an open window by its label; it opens, loads and runs nothing.",
  compose_batch_script: "Compy's own PowerShell batch, built in actions.rs; it never reaches a webview.",
  invoke_handler: "Registers the app's own commands, each a Rust function in this crate; it loads no page and runs no script.",
  capabilities: CAPTURE,
  capture_capabilities: CAPTURE,
  CaptureCapabilities: CAPTURE,
};

// Each name Rust source reaches after `.` or `::` whose words WEBVIEW_WORDS holds, past the
// webview names above, which are held whole.
export function webviewNames(source: string): string[] {
  const tokens = rustTokens(source);
  const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split("_");
  return tokens
    .filter((token, at) => token.word && (tokens[at - 1]?.text === "." || tokens[at - 1]?.text === "::"))
    .map((token) => token.text)
    .filter((name) => words(name).some((word) => WEBVIEW_WORDS.has(word)))
    .filter((name) => !WEBVIEW_METHODS.has(name) && !WEBVIEW_TYPES.has(name) && !BUILDER_TYPES.has(name));
}
const CLOSES: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

// Each place Rust source names one of those: the name and everything after it to the end of its
// expression (a `;` or `,` outside brackets, or the bracket that closes around it). A builder is
// held with every option it is given, and a closure with its body.
export function webviewCalls(source: string): string[] {
  const tokens = rustTokens(source);
  const found: string[] = [];
  tokens.forEach((token, at) => {
    if (!token.word) return;
    const before = tokens[at - 1]?.text;
    const builder = token.text === "builder" && before === "::" && BUILDER_TYPES.has(tokens[at - 2]?.text ?? "");
    const method = WEBVIEW_METHODS.has(token.text) && (before === "." || before === "::");
    if (!builder && !method && !WEBVIEW_TYPES.has(token.text)) return;
    const open: string[] = [];
    let end = at + 1;
    for (; end < tokens.length; end += 1) {
      const text = tokens[end].text;
      if (text in CLOSES) open.push(CLOSES[text]);
      else if (text === ")" || text === "]" || text === "}") {
        if (open.length === 0) break;
        if (open.pop() !== text) throw new Error(`unbalanced ${text} after ${token.text}`);
      } else if ((text === ";" || text === ",") && open.length === 0) break;
    }
    found.push(rustText(tokens.slice(builder ? at - 2 : at, end)));
  });
  return found;
}

// Code a Rust file takes from another file: `include!`, and a module at a `#[path]`.
export function rustIncludes(source: string): string[] {
  const tokens = rustTokens(source);
  const found: string[] = [];
  tokens.forEach((token, at) => {
    if (token.text === "include" && tokens[at + 1]?.text === "!") found.push("include!");
    if (token.text !== "#") return;
    const start = tokens[at + 1]?.text === "!" ? at + 2 : at + 1;
    if (tokens[start]?.text !== "[") return;
    let depth = 0;
    for (let j = start; j < tokens.length; j += 1) {
      if (tokens[j].text === "[") depth += 1;
      else if (tokens[j].text === "]" && --depth === 0) break;
      else if (tokens[j].text === "path" && tokens[j + 1]?.text === "=") found.push("#[path]");
    }
  });
  return found;
}

// Each webview call in the Rust sources, pinned whole, so a new one or a changed one fails until a
// review reads it and pins it here.
const RS = (file: string) => join("src-tauri", "src", file);
const WEBVIEW_PINS = [
  `${RS("lib.rs")}: generate_context!()`,
  `${RS("lib.rs")}: config_mut().app.windows{window.focus=false;}`,
  `${RS("monitoring.rs")}: eval("window.location.reload()")`,
  `${RS("tray.rs")}: WebviewUrl`,
  `${RS("tray.rs")}: WebviewWindowBuilder`,
  `${RS("tray.rs")}: WebviewWindowBuilder::new(app,"main",WebviewUrl::App("index.html".into())).title("Compy").inner_size(800.0,600.0).min_inner_size(380.0,560.0).focused(activate).build()`,
  `${RS("tray.rs")}: WebviewUrl::App("index.html".into())`,
];

// ── Build inputs outside the frontend (rule 7) ──────────────────────────────────────────────────

// Tauri takes another config from `--config`/`-c` or from TAURI_CONFIG, and Windows reads an
// environment name in any case (`$env:tauri_config`). `--config-env` is git's.
const CONFIG_FLAG = /--config(?![\w-])|TAURI_CONFIG/i;
// A short `-c`, alone or with its value attached (`-calt.json`), but not a PowerShell
// case-sensitive operator (`-contains`, `-ceq`, …).
const SHORT_C = /(?:^|[\s"'`(,=[])-c(?!(?:ontains|notcontains|eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|replace|split|in|notin)\b)/;
// A file that can start the Tauri CLI: `tauri` standing alone anywhere in it, whatever runs it and
// however the command is broken over lines (`tauri build`, `npm --silent run tauri`, `cargo tauri`,
// a name in an argument array), the CLI's package, or its binary (#582, at 3a0a9995).
// `src-tauri` and `@tauri-apps/…` are paths, not the CLI.
const TAURI_ROUTE = /(?<![\w@./\\-])tauri(?![\w-])|@tauri-apps[\\/]cli|\.bin[\\/]tauri|tauri\.cmd/i;
// A short `-c` that is prose in a record, not a command: pinned by its file and exact words. The
// rest of that line is still read, and each pin must still match.
const PROSE_C = new Map([[join(".claude", "work-control", "2026-09-01-merge-pr-277.json"), "git grep -c agent-skills-config"]]);
// The code that can start a build: every script, hook, skill, workflow and settings file in the
// repo, past the app's own source, the docs, the lockfile and what installs and builds write
// (#582, at 9c97047f).
const NOT_BUILD_CODE = new Set(["node_modules", ".git", "dist", "target", "logs", "worktrees", "package-lock.json"]);
const APP_FOLDERS = new Set(["src", "src-tauri", "docs", "public"]);
function buildCode(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = join(dir, name);
    if (NOT_BUILD_CODE.has(name) || (dir === "." && APP_FOLDERS.has(name))) return [];
    return statSync(rel).isDirectory() ? buildCode(rel) : [rel];
  });
}
const BUILD_CODE = buildCode(".").filter((file) => !/\.test\./.test(file) && (/\.(?:ps1|psm1|[cm]?[jt]s|sh|cmd|bat|py|ya?ml|json)$/i.test(file) || file.startsWith(".githooks")));

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
    expect([...NAV_FIELDS].filter((pin) => !navFieldsSeen.has(pin)), "each pinned data field still matches its file").toEqual([]);
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
    // `react()` must be the imported plugin, so nothing may declare the name again or build a
    // plugin by hand: each name is declared once, the one function is the config, there is no class,
    // and every name used is one this pin has read (#582, at 4d8f2900).
    const declared: string[] = [];
    const names = new Set<string>();
    let functions = 0;
    let classes = 0;
    walk(config, (node) => {
      const name = nameOf(node);
      if (name !== undefined) names.add(name);
      if (ts.isFunctionLike(node)) functions += 1;
      if (ts.isClassLike(node)) classes += 1;
      const up = node.parent;
      const declares =
        !!up &&
        (ts.isVariableDeclaration(up) || ts.isBindingElement(up) || ts.isParameter(up) || ts.isFunctionDeclaration(up) ||
          ts.isFunctionExpression(up) || ts.isClassDeclaration(up) || ts.isClassExpression(up) || ts.isImportClause(up) ||
          ts.isImportSpecifier(up) || ts.isNamespaceImport(up) || ts.isImportEqualsDeclaration(up) || ts.isEnumDeclaration(up) ||
          ts.isModuleDeclaration(up)) &&
        (up as { name?: ts.Node }).name === node;
      if (declares && ts.isIdentifier(node)) declared.push(node.text);
    });
    expect(declared.sort(), "vite.config.ts declares defineConfig, react and host, once each").toEqual(["defineConfig", "host", "react"]);
    expect({ functions, classes }, "vite.config.ts holds one function, the config, and no class").toEqual({ functions: 1, classes: 0 });
    expect([...names].filter((name) => !VITE_NAMES.has(name)), "vite.config.ts uses a name this pin has not read").toEqual([]);
    // tsconfig `paths`, `baseUrl` and `rootDirs` are aliases to any resolver told to read them,
    // `extends` can bring them in from elsewhere, and a JSX import source names the module JSX
    // compiles to. tsc emits nothing, so the build reads no file it wrote.
    for (const name of readdirSync(".").filter((file) => /^tsconfig.*\.json$/.test(file))) {
      const tsconfig = ts.parseConfigFileTextToJson(name, readFileSync(name, "utf8")).config ?? {};
      const options = tsconfig.compilerOptions ?? {};
      const maps = [
        ...("extends" in tsconfig ? ["extends"] : []),
        ...["paths", "baseUrl", "rootDirs", "jsxImportSource", "jsxFactory", "jsxFragmentFactory"].filter((key) => key in options),
      ];
      expect(maps, `${name} maps module names`).toEqual([]);
    }
    const root = ts.parseConfigFileTextToJson("tsconfig.json", readFileSync("tsconfig.json", "utf8")).config ?? {};
    expect(root.compilerOptions?.noEmit, "tsc, run by the build, emits nothing").toBe(true);
    // Vite also loads a PostCSS config, and a Babel config through the React plugin; either runs
    // code during the build.
    const buildConfigs = readdirSync(".").filter((file) => /^(?:\.?postcss|\.postcssrc|babel\.config|\.babelrc)/i.test(file));
    expect(buildConfigs, "the build loads no PostCSS or Babel config").toEqual([]);
    // package.json holds nothing that remaps a name (`imports`, `browser`, `overrides`, workspaces)
    // or configures a build tool.
    expect(Object.keys(PACKAGE).sort(), "package.json holds only the fields this pin has read").toEqual(
      ["dependencies", "devDependencies", "name", "private", "scripts", "type", "version"],
    );
    // A declared name must be the registry's: not a local folder, a git ref, a URL or an npm alias.
    const unregistered = Object.entries(DEPENDENCIES).filter(([, range]) => !/^[\^~]?\d/.test(range)).map(([name, range]) => `${name}: ${range}`);
    expect(unregistered, "every dependency is a registry version range").toEqual([]);
    // And what npm installs is the registry's, at a pinned hash, with no npm setting to change that.
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, { resolved?: string; integrity?: string; link?: boolean }> };
    const unpinned = Object.entries(lock.packages)
      .filter(([path, entry]) => path !== "" && (entry.link || !entry.resolved?.startsWith("https://registry.npmjs.org/") || !entry.integrity))
      .map(([path]) => path);
    expect(unpinned, "every locked package comes from the npm registry with an integrity hash").toEqual([]);
    const npmrc = existsSync(".npmrc") ? readFileSync(".npmrc", "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[#;]/.test(line)) : [];
    expect(npmrc, ".npmrc sets only include=dev").toEqual(["include=dev"]);
  });

  it("the build runs only the commands read here, and Tauri serves only the built frontend", { timeout: TREE_WALK_TIMEOUT_MS }, () => {
    // Each step of `npm run tauri build`, and no npm hook around any of them (#582, at 4d8f2900).
    const scripts = PACKAGE.scripts ?? {};
    expect({ build: scripts.build, dev: scripts.dev, tauri: scripts.tauri }).toEqual({ build: "tsc && vite build", dev: "vite", tauri: "tauri" });
    const hooks = Object.keys(scripts).filter((name) => LIFECYCLE.has(name) || (/^(?:pre|post)/.test(name) && name.replace(/^(?:pre|post)/, "") in scripts));
    expect(hooks, "no npm lifecycle script runs around the build").toEqual([]);
    // Every script body, not only the three above: one that starts Tauri is `tauri` and nothing
    // else, and none hands a tool another config (#582, at 63c57f30). The `-c` check reads every
    // body, not only Tauri's: `npm run build -- -c x` hands Vite another config.
    const bodies = Object.entries(scripts).map(([name, body]) => `${name}: ${body}`);
    expect(bodies.filter((line) => /tauri/i.test(line) && line !== "tauri: tauri"), "only the `tauri` script starts Tauri, as bare `tauri`").toEqual([]);
    expect(bodies.filter((line) => CONFIG_FLAG.test(line) || SHORT_C.test(line)), "no npm script passes a config flag").toEqual([]);
    // Tauri merges a platform file (tauri.windows.conf.json) or reads a JSON5 or TOML config in
    // place of this one, so tauri.conf.json is the only one.
    const tauriConfigs = readdirSync("src-tauri").filter((file) => /^tauri\b.*\.(?:json5?|toml)$/i.test(file));
    expect(tauriConfigs, "src-tauri holds one Tauri config, tauri.conf.json").toEqual(["tauri.conf.json"]);
    expect(TAURI.build).toEqual({
      beforeDevCommand: "npm run dev",
      devUrl: "http://localhost:1420",
      beforeBuildCommand: "npm run build",
      frontendDist: "../dist",
    });
    // No code that can start a build hands Tauri another config: no `--config` or TAURI_CONFIG
    // anywhere, however the command is spelled (`npm run tauri -- build --config x`), and no short
    // `-c` anywhere in a file that can start the Tauri CLI, so an argument array or a command split
    // over lines is read too (#582, at 63c57f30 and 3a0a9995). git's and codex's own `-c` live in
    // files that name no Tauri.
    const proseSeen = new Set<string>();
    const handed = BUILD_CODE.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      const pinned = PROSE_C.get(file);
      const hits = lines.filter((line) => {
        const read = pinned && line.includes(pinned) ? (proseSeen.add(file), line.split(pinned).join(" ")) : line;
        return CONFIG_FLAG.test(line) || (TAURI_ROUTE.test(text) && SHORT_C.test(read));
      });
      return hits.map((line) => `${file}: ${line.trim()}`);
    });
    expect(handed, "no script passes Tauri another config").toEqual([]);
    expect([...PROSE_C.keys()].filter((file) => !proseSeen.has(file)), "each pinned prose `-c` still matches its file").toEqual([]);
    expect(BUILD_CODE.filter((file) => TAURI_ROUTE.test(readFileSync(file, "utf8"))).length, "the scan finds the release build's Tauri call").toBeGreaterThan(0);
    // Cargo reads `.cargo/config.toml` (or `config`) in the folder it builds in and every folder
    // above it, and its `[env]` table can set TAURI_CONFIG for tauri-codegen. The repo's two such
    // folders hold only cargo-audit's settings, and there is no workspace above src-tauri
    // (#582, at 63c57f30). The owner's own ~/.cargo, CARGO_HOME and shell are outside the repo.
    const cargoConfigs = [".cargo", join("src-tauri", ".cargo")].flatMap((dir) => (existsSync(dir) ? listFiles(dir) : []));
    expect(cargoConfigs, "the repo gives Cargo no config").toEqual([join("src-tauri", ".cargo", "audit.toml")]);
    expect(existsSync("Cargo.toml"), "no Cargo workspace above src-tauri").toBe(false);
    expect(readFileSync(join("src-tauri", "Cargo.toml"), "utf8").match(/^\s*\[(?:patch|replace|workspace)\b.*$/gm), "Cargo.toml patches in no crate").toBeNull();
    // Every crate but the app itself comes from crates.io, and Cargo checks each against its hash.
    const crates = readFileSync(join("src-tauri", "Cargo.lock"), "utf8").split(/\r?\n\[\[package\]\]\r?\n/).slice(1);
    const foreign = crates.filter((entry) => !/^name = "compy"$/m.test(entry) && !(/^source = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"$/m.test(entry) && /^checksum = "[0-9a-f]{64}"$/m.test(entry)));
    expect(foreign.map((entry) => entry.split(/\r?\n/)[0]), "every locked crate comes from crates.io with a checksum").toEqual([]);
    expect(crates.length, "Cargo.lock was read").toBeGreaterThan(100);
    // Every window opens the app's own page.
    const pages = (TAURI.app?.windows ?? []).map((w) => w.url).filter((url) => url !== undefined && url !== "index.html");
    expect(pages, "every window opens index.html").toEqual([]);
    // The security block holds the two CSPs and nothing else: no isolation app, no inline
    // capability, no header or asset setting this pin has not read.
    expect(Object.keys(TAURI.app?.security ?? {}).sort(), "tauri.conf.json security holds csp and devCsp only").toEqual(["csp", "devCsp"]);
    // And the Rust side opens no other page, runs no other script in a webview, and changes no
    // config it was built with. Every Rust file under src-tauri is read as tokens, build.rs
    // included, and none takes code from another file (#582, at 63c57f30).
    const rust = listFiles("src-tauri", new Set([join("src-tauri", "target")])).filter((file) => file.endsWith(".rs"));
    expect(rust, "the Rust corpus holds the app and its build script").toEqual(expect.arrayContaining([join("src-tauri", "build.rs"), RS("lib.rs"), RS("tray.rs")]));
    const sources = rust.map((file) => [file, readFileSync(file, "utf8")] as const);
    expect(sources.filter(([, text]) => /TAURI_CONFIG/i.test(text)).map(([file]) => file), "no Rust file names TAURI_CONFIG").toEqual([]);
    expect(sources.flatMap(([file, text]) => rustIncludes(text).map((hit) => `${file}: ${hit}`)), "no Rust file takes code from another file").toEqual([]);
    const webview = sources.flatMap(([file, text]) => webviewCalls(text).map((call) => `${file}: ${call}`));
    expect(webview.sort(), "a Rust webview call is new or changed: check the page it opens and the script it runs, then pin it").toEqual([...WEBVIEW_PINS].sort());
    const named = new Set(sources.flatMap(([, text]) => webviewNames(text)));
    expect([...named].filter((name) => !(name in NOT_WEBVIEW)).sort(), "a Rust method is named like a webview API: hold it in WEBVIEW_METHODS, or list why it changes no page").toEqual([]);
    expect(Object.keys(NOT_WEBVIEW).filter((name) => !named.has(name)), "each name listed as no webview is still named").toEqual([]);
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
    // A browser reads a directive name in any case, so `Worker-Src` is worker-src; every name is
    // written in lower case so the lookups below see it (#582, at 4d8f2900).
    expect(Object.keys(csp ?? {}).filter((d) => !/^[a-z-]+$/.test(d)), "CSP directive names are lower case").toEqual([]);
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
    // A JSX pragma picks the module JSX compiles to, from a comment (#582, at 4d8f2900).
    expect(loads("/** @jsxImportSource ../test */\nconst x = <div />;", screen)).toHaveLength(1);
    // Navigation, by the ordinary names (#582, at 4d8f2900).
    expect(loads('location.assign("https://x");', screen)).toHaveLength(1);
    expect(loads("window.location.href = u;", screen)).toHaveLength(2);
    expect(loads("document.location = u;", screen)).toHaveLength(1);
    expect(loads("navigation.navigate(u);", screen)).toHaveLength(1);
    expect(loads("window.open(u);", screen)).toHaveLength(1);
    expect(loads('window["open"](u);', screen)).toHaveLength(1);
    expect(loads("open(u);", screen)).toHaveLength(1);
    expect(loads('const a = <a href="https://x">x</a>;', screen)).toHaveLength(2);
    expect(loads('const m = <meta httpEquiv="refresh" content="0;url=https://x" />;', screen)).toHaveLength(1);
    expect(loads("const b = <base href={u} />;", screen)).toHaveLength(2);
    expect(loads("const f = <form action={u} />;", screen)).toHaveLength(1);
    expect(loads("const b = <button formAction={u} />;", screen)).toHaveLength(1);
    expect(loads('const a = document.createElement("a");', screen)).toHaveLength(1);
    expect(loads('const f = document.createElement("form");', screen)).toHaveLength(1);
    expect(loads("window.document.location = u;", screen)).toHaveLength(1);
    expect(loads("const { location: l } = window;", screen)).toHaveLength(1);
    // A window reached from a document, an element or an event (#582, at 63c57f30).
    expect(loads("document.defaultView!.location.assign(u);", screen)).toHaveLength(1);
    expect(loads("el.ownerDocument.location = u;", screen)).toHaveLength(1);
    expect(loads("frame.contentWindow.open(u);", screen)).toHaveLength(1);
    expect(loads("event.view.location.href = u;", screen)).toHaveLength(2);
    // The names count read off anything, so a window kept in a variable or reached some other way
    // is held the same (#582, at 9c97047f).
    expect(loads("const target = document.defaultView!; target.location.assign(url);", screen)).toHaveLength(1);
    expect(loads("const w = window; w.open(u);", screen)).toHaveLength(1);
    expect(loads("node.getRootNode().location = u;", screen)).toHaveLength(1);
    expect(loads("const { open: go } = w; go(u);", screen)).toHaveLength(1);
    expect(loads("const { location } = props;", screen)).toHaveLength(1);
    expect(loads("const shown = details.open;", screen)).toHaveLength(1);
    expect(loads("window.location.reload(); anything.location.reload();", screen)).toEqual([]);
    expect(loads("function Sheet({ open }: { open: boolean }) { return open ? 1 : 0; }", screen)).toEqual([]);
    expect(loads("const [open, setOpen] = useState(false); if (open) setOpen(false);", screen)).toEqual([]);
    expect(loads("const x = { location: 1, open: true };", screen)).toEqual([]);
    // The window's `open` handed on bare, or a destructured `open` used as more than a flag, and a
    // form sent from code (#582, at 3a0a9995).
    expect(loads("const go = open; go(url);", screen)).toHaveLength(1);
    expect(loads("open.call(window, url);", screen)).toHaveLength(1);
    expect(loads("const pick = [open][0];", screen)).toHaveLength(1);
    expect(loads("const { open } = window; const go = open; go(url);", screen)).toHaveLength(1);
    expect(loads("const { open } = window; open.call(window, url);", screen)).toHaveLength(1);
    expect(loads('const { ["open"]: go } = window; go(url);', screen)).toHaveLength(1);
    expect(loads("function Tile({ open }: P) { return <button onClick={open} />; }", screen)).toHaveLength(1);
    expect(loads("formRef.current.action = url; formRef.current.submit();", screen)).toHaveLength(2);
    expect(loads('form["action"] = url;', screen)).toHaveLength(1);
    expect(loads("form.requestSubmit();", screen)).toHaveLength(1);
    expect(loads('el.setAttribute("action", url);', screen)).toHaveLength(1);
    expect(loads("el.setAttributeNS(null, name, url);", screen)).toHaveLength(1);
    expect(loads('function Sheet({ open }: P) { useEffect(() => {}, [open]); return !open ? 1 : open.label; }', screen)).toEqual([]);
    expect(loads("function Sheet({ open }: P) { return open && <Dialog open={open} />; }", screen)).toEqual([]);
    expect(loads("function run(open: () => void) { open(); }", screen)).toEqual([]);
    expect(loads("const [open] = useState(false); const shown = open;", screen)).toEqual([]);
    expect(loads('const next = step.action; el.setAttribute("aria-expanded", "true");', screen)).toEqual([]);
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
    expect(loads("const f = <form className={css} onSubmit={add} />;", app)).toEqual([]);
    // A method named `open` counts on anything now, so a dialog's own `open()` is pinned in
    // NAV_FIELDS before it passes (#582, at 9c97047f).
    expect(loads("dialog.open();", app)).toHaveLength(1);
    expect(loads("const [open, setOpen] = useState(false);\nif (open) setOpen(!open);", app)).toEqual([]);
    expect(loads("const tile = <BentoTile open={{ label }} />;", app)).toEqual([]);
    expect(loads("const retry = () => window.location.reload();", app)).toEqual([]);
    // A data field named `location` is read off something too, so it passes only once pinned; an
    // object key and a type member are not reads.
    expect(loads("const row = { location: bundle.location };\nconst { location } = bundle;\ntype T = { location: string };", app)).toHaveLength(2);
    expect(loads("const row = { location: 1 };\ntype T = { location: string; open: boolean };", app)).toEqual([]);
    expect(loads("const chart = <Area values={v} id=\"cpu\" />;", app)).toEqual([]);
  });

  it("Rust is read as tokens, and each webview call is held whole with its arguments", () => {
    const text = (source: string) => rustText(rustTokens(source));
    // Comments go; strings, raw strings and char literals stay whole; `r#eval` is `eval`.
    expect(text('let a = 1; // eval("x")\n/* outer /* nested */ eval("y") */ let b = 2;')).toBe("let a=1;let b=2;");
    expect(text('let s = r#"he said "eval""#;')).toBe('let s=r#"he said "eval""#;');
    expect(text("let c = '\\''; fn f<'a>(x: &'a str) {}")).toBe("let c='\\'';fn f<'a>(x:&'a str){}");
    expect(text("w.r#eval(x)")).toBe("w.eval(x)");
    expect(() => rustTokens('let s = "never closed;')).toThrow();
    // A call split across lines or behind a comment is still the call.
    expect(webviewCalls('w.\n  eval("x");')).toEqual(['eval("x")']);
    expect(webviewCalls('w /* here */ . /* there */ r#eval(r"x");')).toEqual(['eval(r"x")']);
    expect(webviewCalls('let js = "w.eval(1)"; // w.navigate(u)')).toEqual([]);
    // A builder is held with every option it is given, up to the end of its expression.
    expect(webviewCalls('let w = WebviewWindowBuilder::new(app, "x", url).initialization_script(s).build()?;'))
      .toEqual(expect.arrayContaining(['WebviewWindowBuilder::new(app,"x",url).initialization_script(s).build()?', "initialization_script(s).build()?"]));
    expect(webviewCalls("let w = Webview::builder(app).build();")).toEqual(["Webview::builder(app).build()"]);
    expect(webviewCalls("f(a, w.navigate(u), b);")).toEqual(["navigate(u)"]);
    expect(() => webviewCalls("w.navigate(u];")).toThrow();
    // A test's local closure named `eval` is not a webview; a path call to one is.
    expect(webviewCalls("let eval = |x| x + 1; assert_eq!(eval(2), 3);")).toEqual([]);
    expect(webviewCalls("tauri::WebviewWindow::eval(&w, s);")).toEqual(["eval(&w,s)"]);
    // Source pulled in from elsewhere is code no pin reads.
    expect(rustIncludes('include!("bridge.rs");')).toHaveLength(1);
    expect(rustIncludes('#[path = "bridge.rs"] mod m;')).toHaveLength(1);
    expect(rustIncludes('#![path = "x"]')).toHaveLength(1);
    expect(rustIncludes('let s = include_str!("a.txt"); let path = p; // include!("x")')).toEqual([]);
    // The app builder's and a plugin builder's own script hooks are held whole, and any other
    // method named like a webview API is listed by name (#582, at 9c97047f).
    expect(webviewCalls("tauri::Builder::default().invoke_system(s).run(ctx)")).toEqual(["invoke_system(s).run(ctx)"]);
    expect(webviewCalls('plugin::Builder::new("x").js_init_script_on_all_frames(s).build()')).toEqual(["js_init_script_on_all_frames(s).build()"]);
    expect(webviewNames("b.set_webview_script(x); w.evaluate_js(y); tauri::webview::Url::parse(u);")).toEqual(["set_webview_script", "evaluate_js", "webview"]);
    expect(webviewNames("w.invoke_system(s); w.eval(x); let eval = 1; script.len();")).toEqual([]);
    expect(webviewNames("d.description(); v.doubleValue(); tauri::WebviewWindow::get(); c.ExecuteScript(s);")).toEqual(["ExecuteScript"]);
  });

  it("the config-flag scan catches each way to hand Tauri a config, and not the operators around it", () => {
    expect(CONFIG_FLAG.test("npm run tauri -- build --config alt.json")).toBe(true);
    expect(CONFIG_FLAG.test("$env:TAURI_CONFIG = '{}'")).toBe(true);
    expect(CONFIG_FLAG.test("--config-file x")).toBe(false);
    expect(SHORT_C.test('$args = @("build", "-c", "alt.json")')).toBe(true);
    expect(SHORT_C.test("tauri build -calt.json")).toBe(true);
    expect(SHORT_C.test("if ($list -contains $x -or $a -ceq $b) {}")).toBe(false);
    expect(SHORT_C.test("node -e x")).toBe(false);
    expect(TAURI_ROUTE.test("npm run tauri -- build")).toBe(true);
    expect(TAURI_ROUTE.test("npx tauri build")).toBe(true);
    expect(TAURI_ROUTE.test("node node_modules\\@tauri-apps\\cli\\tauri.js build")).toBe(true);
    expect(TAURI_ROUTE.test("npm run build")).toBe(false);
    // An environment name in any case, and a runner's flags before `tauri` (#582, at 9c97047f).
    expect(CONFIG_FLAG.test("$env:tauri_config = '{}'")).toBe(true);
    expect(TAURI_ROUTE.test("npm --silent run tauri -- build -c alternate.json")).toBe(true);
    expect(TAURI_ROUTE.test("npm.cmd --prefix . exec tauri build")).toBe(true);
    expect(TAURI_ROUTE.test("cargo test --manifest-path src-tauri/Cargo.toml")).toBe(false);
    expect(TAURI_ROUTE.test('node -e "require(\'@tauri-apps/api\')"')).toBe(false);
    // A bare CLI call and a command broken over lines are routes too (#582, at 3a0a9995).
    expect(TAURI_ROUTE.test("tauri build -c alternate.json")).toBe(true);
    expect(TAURI_ROUTE.test("npm --silent run `\n  tauri -- build")).toBe(true);
    expect(BUILD_CODE).toEqual(expect.arrayContaining([join(".github", "workflows", "ci.yml"), "compy-entry.ps1", join("scripts", "release.ps1")]));
  });

  it("a planted direct reader in any other screen is a violation", () => {
    const screen = join("src", "surfaces", "HardwareGrid.tsx");
    expect(violations(screen, [MODEL])).toEqual([MODEL]);
    expect(violations(screen, ["get_hardware_info"])).toEqual(["get_hardware_info"]);
    expect(violations(READER, [RETIRED])).toEqual([RETIRED]);
    expect(violations(READER, [MODEL])).toEqual([]);
  });
});
