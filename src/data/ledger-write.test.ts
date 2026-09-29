import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import ts from "typescript";
import { LEDGER_CHANGED_EVENT } from "../types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { writeLedger, LEDGER_WRITE_COMMANDS, BACKGROUND_LEDGER_WRITERS } from "./ledger-write";

// #619: ledger readers outside App (the Test room's experiment bench, the Machine Model) re-read only
// on LEDGER_CHANGED_EVENT or a refocus. Every ledger write announces through this one helper.
describe("writeLedger announces a ledger write, then refreshes", () => {
  const steps: string[] = [];
  const onLedger = () => steps.push("event");

  beforeEach(() => {
    steps.length = 0;
    invokeMock.mockReset();
    window.addEventListener(LEDGER_CHANGED_EVENT, onLedger);
  });
  afterEach(() => window.removeEventListener(LEDGER_CHANGED_EVENT, onLedger));

  it("invokes, then announces, then awaits the refresh, and hands back the command's result", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      steps.push(`invoke:${cmd}`);
      return { id: "chg-1" };
    });
    let settled = false;
    const result = await writeLedger("apply_recommendation", { recId: "r", recTitle: "R" }, () =>
      new Promise<void>((r) =>
        setTimeout(() => {
          steps.push("refresh");
          settled = true;
          r();
        }, 0),
      ),
    );
    expect(invokeMock).toHaveBeenCalledWith("apply_recommendation", { recId: "r", recTitle: "R" });
    expect(steps).toEqual(["invoke:apply_recommendation", "event", "refresh"]);
    expect(settled).toBe(true);
    expect(result).toEqual({ id: "chg-1" });
  });

  it("announces without a refresh when the caller has none", async () => {
    invokeMock.mockResolvedValue(null);
    await writeLedger("rollback_change", { changeId: "c" });
    expect(steps).toEqual(["event"]);
  });

  it("a write that failed announces nothing, refreshes nothing, and the caller sees the error", async () => {
    invokeMock.mockRejectedValue(new Error("UAC declined"));
    const refresh = vi.fn();
    await expect(writeLedger("disable_known_bloat_task", { taskId: "t" }, refresh)).rejects.toThrow(
      "UAC declined",
    );
    expect(steps).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a write that recorded nothing (per the caller's check) skips the announcement but still refreshes", async () => {
    invokeMock.mockResolvedValue({ applied: 0, items: [] });
    const refresh = vi.fn(() => {
      steps.push("refresh");
    });
    await writeLedger<{ applied: number }>(
      "apply_recommendations_batch",
      { items: [] },
      refresh,
      (r) => r.applied > 0,
    );
    expect(steps).toEqual(["refresh"]);
  });
});

// The helper only holds while nothing goes around it. Read with the TypeScript parser, not by text: a
// comment is not code, a `"/*"` inside a string does not start one, and an escaped literal is read as
// the name it spells (Codex, #619 round 1). A name built from pieces (`invoke(\`apply_${x}\`)`) is
// machine-model-reader-guard's rule 5: every invoke writes its command out.
const SRC = "src";
const walkTs = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};
const rel = (p: string) => p.slice(SRC.length + 1).replace(/[\\/]+/g, "/");
const parse = (source: string, file = "sample.tsx") =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const visit = (node: ts.Node, fn: (node: ts.Node) => void): void => {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
};
// A string the compiler reads whole: its `.text` is the value, escapes resolved.
const literalText = (node: ts.Node): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
const COMMANDS: readonly string[] = LEDGER_WRITE_COMMANDS;
const isWriteLedgerCall = (call: ts.Node): call is ts.CallExpression =>
  ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "writeLedger";
const lineOf = (tree: ts.SourceFile, node: ts.Node) =>
  tree.text.split("\n")[tree.getLineAndCharacterOfPosition(node.getStart(tree)).line].trim();

/** Ledger-writing commands a source names anywhere but as writeLedger's first argument. */
function bypasses(source: string, file?: string): string[] {
  const out: string[] = [];
  visit(parse(source, file), (node) => {
    const text = literalText(node);
    if (text === undefined || !COMMANDS.includes(text)) return;
    const call = node.parent;
    if (!(isWriteLedgerCall(call) && call.arguments[0] === node)) out.push(text);
  });
  return out;
}

/** writeLedger forwards its command to invoke, and machine-model-reader-guard reads a wrapper's
 *  callers only in the wrapper's own file. So here: every use of writeLedger elsewhere is a plain
 *  `import { writeLedger }` or a direct call with a ledger command written out first. A rename, a
 *  re-export, a namespace or key access, or a name kept in a variable is reported. */
function unwritten(source: string, file?: string): string[] {
  const tree = parse(source, file);
  const out: string[] = [];
  visit(tree, (node) => {
    const up = node.parent;
    if (literalText(node) === "writeLedger") return out.push(lineOf(tree, node));
    if (!ts.isIdentifier(node) || node.text !== "writeLedger") return;
    if (ts.isImportSpecifier(up) && up.name === node && !up.propertyName) return;
    if (isWriteLedgerCall(up) && up.expression === node) {
      const first = up.arguments[0] && literalText(up.arguments[0]);
      if (first !== undefined && COMMANDS.includes(first)) return;
    }
    out.push(lineOf(tree, node));
  });
  return out;
}

describe("no ledger-writing command is invoked outside writeLedger", () => {
  // #621 moves the bench onto writeLedger once #583 releases ExperimentBench.tsx; it then empties this
  // list. Pinned exactly, so the list can neither grow nor go stale.
  const EXEMPT_UNTIL_621 = [
    "surfaces/ExperimentBench.tsx: conclude_experiment",
    "surfaces/ExperimentBench.tsx: restore_experiment",
    "surfaces/ExperimentBench.tsx: start_experiment",
  ];
  const sources = walkTs(SRC)
    .filter((p) => rel(p) !== "data/ledger-write.ts")
    .map((p) => ({ r: rel(p), p, source: readFileSync(p, "utf8") }));

  it("every ledger-writing command named in code is writeLedger's first argument", () => {
    const found = sources.flatMap(({ r, p, source }) => bypasses(source, p).map((cmd) => `${r}: ${cmd}`));
    expect(found.sort()).toEqual(EXEMPT_UNTIL_621);
  });

  it("every writeLedger use is an import or a call that writes its command out", () => {
    const calls = sources.reduce((n, { source }) => n + (source.match(/\bwriteLedger\s*(?:<[^>]*>)?\s*\(/g) ?? []).length, 0);
    expect(calls).toBeGreaterThan(10);
    expect(sources.flatMap(({ r, p, source }) => unwritten(source, p).map((hit) => `${r}: ${hit}`))).toEqual([]);
  });

  it("the command scan fires on every way to name a command outside writeLedger, and not on prose", () => {
    expect(bypasses(`await invoke("apply_recommendation", { recId });`)).toEqual(["apply_recommendation"]);
    // A comment marker inside a string is text; the invoke between them is live code.
    expect(bypasses(`const open = "/*"; invoke("apply_recommendation", {}); const close = "*/";`)).toEqual([
      "apply_recommendation",
    ]);
    expect(bypasses(`const re = /\\/\\//; invoke("rollback_change", {});`)).toEqual(["rollback_change"]);
    // Escaped and template spellings are the same command to the compiler.
    expect(bypasses(`invoke("apply_rec\\u006fmmendation", {});`)).toEqual(["apply_recommendation"]);
    expect(bypasses(`invoke("rollback_ch\\x61nge", {});`)).toEqual(["rollback_change"]);
    expect(bypasses("invoke(`rollback_change`, {});")).toEqual(["rollback_change"]);
    // Kept for later, or handed to another function.
    expect(bypasses(`const cmd = "rollback_change"; writeLedger(cmd, {});`)).toEqual(["rollback_change"]);
    expect(bypasses(`run("disable_known_bloat_task", { taskId });`)).toEqual(["disable_known_bloat_task"]);
    // Prose and the real call form are not.
    expect(bypasses(`// invoke("apply_recommendation")\n/* invoke("rollback_change") */ const x = 1;`)).toEqual([]);
    expect(bypasses(`await writeLedger<AppliedChange>(\n  "apply_recommendation",\n  { recId },\n);`)).toEqual([]);
  });

  it("the caller check fires on every way around a written-out call, and passes the real forms", () => {
    expect(unwritten(`writeLedger(cmd, { id });`)).toHaveLength(1);
    expect(unwritten("writeLedger(`apply_${kind}`, { id });")).toHaveLength(1);
    expect(unwritten(`writeLedger("get_machine_model", {});`)).toHaveLength(1);
    expect(unwritten(`const go = writeLedger;`)).toHaveLength(1);
    expect(unwritten(`import { writeLedger as write } from "../data/ledger-write";`)).toHaveLength(1);
    expect(unwritten(`export { writeLedger } from "../data/ledger-write";`)).toHaveLength(1);
    expect(unwritten(`lw.writeLedger(cmd, {});`)).toHaveLength(1);
    expect(unwritten(`lw["writeLedger"](cmd, {});`)).toHaveLength(1);
    expect(unwritten(`writeL\\u0065dger(cmd, {});`)).toHaveLength(1);
    expect(unwritten(`const open = "/*"; writeLedger(cmd, {}); const close = "*/";`)).toHaveLength(1);
    expect(unwritten(`import { writeLedger } from "../data/ledger-write";`)).toEqual([]);
    expect(unwritten(`await writeLedger("rollback_change", { changeId }, refresh);`)).toEqual([]);
    expect(unwritten(`await writeLedger<AppliedChange>(\n  "apply_recommendation",\n  { recId },\n);`)).toEqual([]);
  });
});

// The command list is only as good as its match with the backend. Derived from every Rust file under
// src-tauri/src, nested modules included (Codex, #619 round 1): a function that calls `save_history`
// writes the ledger, and so does any function that calls one of those or hands it on as a value,
// under its own name or a `use … as` alias. The registered commands among them must be exactly the
// helper's list plus the background writers.
const RS = join("src-tauri", "src");

type Folders = { readdirSync(dir: string): string[]; statSync(p: string): { isDirectory(): boolean } };
const rustFiles = (dir: string, fs: Folders = { readdirSync, statSync }, out: string[] = []): string[] => {
  for (const name of fs.readdirSync(dir)) {
    const p = join(dir, name);
    if (fs.statSync(p).isDirectory()) rustFiles(p, fs, out);
    else if (name.endsWith(".rs")) out.push(p);
  }
  return out;
};

// Comments and string/char literals out, so braces inside them cannot skew a body's extent. The
// handler list goes too: it registers every command inside `run`, which calls none of them, and
// reading it as a use made `run` a writer and every caller of any `run` one after it.
const stripRust = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/r(#*)"[\s\S]*?"\1/g, '""')
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^\\'\n])'/g, "' '")
    .replace(/generate_handler!\s*\[[\s\S]*?\]/g, " ");

type Fn = { name: string; body: string };
function functionsIn(sources: string[]): Fn[] {
  const out: Fn[] = [];
  for (const src of sources.map(stripRust)) {
    const head = /\bfn\s+([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = head.exec(src))) {
      // The signature ends at the first `{` or `;` outside its parentheses and brackets, so an array
      // type such as `[u8; 4]` does not read as a bodiless trait signature.
      let nest = 0;
      let open = m.index + m[0].length;
      for (; open < src.length; open++) {
        const c = src[open];
        if (c === "(" || c === "[") nest++;
        else if (c === ")" || c === "]") nest--;
        else if (nest === 0 && (c === "{" || c === ";")) break;
      }
      if (src[open] !== "{") continue; // a trait signature, no body
      let depth = 0;
      let i = open;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      out.push({ name: m[1], body: src.slice(open, i + 1) });
    }
  }
  return out;
}

// `use a::name as other;` and `use a::{name as other, …};`: `other` is `name` under another name.
function aliasesIn(sources: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const src of sources.map(stripRust)) {
    for (const use of src.matchAll(/\buse\s+([^;]+);/g)) {
      for (const [, name, alias] of use[1].matchAll(/\b([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)\b/g)) {
        out.set(name, [...(out.get(name) ?? []), alias]);
      }
    }
  }
  return out;
}

// A call, `name(` or `name::<T>(`, or the function handed on as an argument. Not a method `.name(`
// on some other type, and not a field or local that merely starts with the name.
const mentions = (body: string, name: string) =>
  new RegExp(`(?:^|[^\\w.])${name}\\s*(?:::<[^>]*>)?\\s*\\(|[(,]\\s*&?${name}\\s*[,)]`).test(body);

function ledgerWriters(sources: string[]): Set<string> {
  const fns = functionsIn(sources);
  const aliases = aliasesIn(sources);
  const writers = new Set(["save_history"]);
  const reach = new Set(["save_history", ...(aliases.get("save_history") ?? [])]);
  // `drop` is a trait method name (the trial RollbackGuard's), not a callable: every `drop(x)` in
  // the crate would otherwise count as a use of it.
  const skip = new Set(["drop"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of fns) {
      if (writers.has(f.name) || skip.has(f.name)) continue;
      if ([...reach].some((name) => mentions(f.body, name))) {
        writers.add(f.name);
        for (const name of [f.name, ...(aliases.get(f.name) ?? [])]) reach.add(name);
        grew = true;
      }
    }
  }
  return writers;
}

// Same parse as command-authority-guard.test.ts's registeredCommands (not imported: importing a
// test file would run its tests here too).
const registered = (lib: string): string[] => {
  const block = /generate_handler!\[([\s\S]*?)\]\s*\)/.exec(lib);
  if (!block) throw new Error("could not find generate_handler![...] in lib.rs");
  return block[1]
    .split(/[,\n]/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((entry) => /^[A-Za-z_][A-Za-z0-9_:]*$/.test(entry))
    .map((entry) => entry.split("::").pop() as string);
};

describe("the ledger-writing command list matches src-tauri", () => {
  const sources = rustFiles(RS).map((p) => readFileSync(p, "utf8"));

  it("the parse finds the ledger's own write sites (so an empty result cannot pass)", () => {
    const seeds = functionsIn(sources)
      .filter((f) => mentions(f.body, "save_history"))
      .map((f) => f.name);
    expect(seeds).toContain("apply_recommendation_inner");
    expect(seeds).toContain("rollback_change_inner");
  });

  it("registered commands that reach save_history = LEDGER_WRITE_COMMANDS + BACKGROUND_LEDGER_WRITERS", () => {
    const writers = ledgerWriters(sources);
    const derived = registered(readFileSync(join(RS, "lib.rs"), "utf8"))
      .filter((c) => writers.has(c))
      .sort();
    expect(derived).toEqual([...LEDGER_WRITE_COMMANDS, ...BACKGROUND_LEDGER_WRITERS].sort());
  });

  it("the walk reads nested modules", () => {
    // src-tauri/src has no module folder today, so the first one is proven here on a folder tree in
    // memory: it must be walked, not skipped.
    const folders: Record<string, string[]> = { root: ["commands", "lib.rs"], [join("root", "commands")]: ["ledger.rs"] };
    const files: Record<string, string> = {
      [join("root", "lib.rs")]: "mod commands;\n",
      [join("root", "commands", "ledger.rs")]: "pub fn nested_cmd() { save_history(&h); }\n",
    };
    const found = rustFiles("root", {
      readdirSync: (dir) => folders[dir] ?? [],
      statSync: (p) => ({ isDirectory: () => p in folders }),
    });
    expect(found.sort()).toEqual(Object.keys(files).sort());
    expect(ledgerWriters(found.map((p) => files[p]))).toContain("nested_cmd");
  });

  it("the derivation follows the ledger through callers, aliases and handed-on functions, and not through prose", () => {
    const writers = ledgerWriters([
      "fn helper() { save_history(&h); }\nfn called_cmd() { helper(); }",
      "use crate::history::save_history as persist;\nfn aliased_cmd() { persist(&h).ok(); }",
      "use crate::x::{helper as go, other};\nfn grouped_cmd() { go(); }",
      "fn pointer_cmd() { retry(save_history); }",
      "fn array_cmd(bytes: [u8; 4]) -> Result<[u8; 2], E> { helper() }",
      "async fn async_cmd(state: State<'_, App>) -> Result<(), String> { tokio::spawn(async move { helper() }); Ok(()) }",
      "fn reader_cmd() { load_history(); }",
      'fn prose_cmd() {\n  // save_history(&h)\n  let s = "save_history(";\n  let r = r#"helper()"#;\n}',
      "fn field_cmd() { let x = state.helper_count; }",
      "fn method_cmd() { other.helper(); }",
      "fn run() { tauri::Builder::default().invoke_handler(tauri::generate_handler![called_cmd, helper]); }",
      "fn runner_cmd() { run(); }",
    ]);
    for (const cmd of ["called_cmd", "aliased_cmd", "grouped_cmd", "pointer_cmd", "array_cmd", "async_cmd"]) {
      expect(writers, cmd).toContain(cmd);
    }
    for (const cmd of ["reader_cmd", "prose_cmd", "field_cmd", "method_cmd", "run", "runner_cmd"]) {
      expect(writers, cmd).not.toContain(cmd);
    }
  });
});
