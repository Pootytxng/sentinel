import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
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

// The helper only holds while nothing goes around it. Comments are stripped: prose may name a command.
describe("no ledger-writing command is invoked outside writeLedger", () => {
  const SRC = "src";
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  };
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const rel = (p: string) => p.slice(SRC.length + 1).replace(/[\\/]+/g, "/");

  // #621 moves the bench onto writeLedger once #583 releases ExperimentBench.tsx; it then empties this
  // list. Pinned exactly, so the list can neither grow nor go stale.
  const EXEMPT_UNTIL_621 = [
    "surfaces/ExperimentBench.tsx: conclude_experiment",
    "surfaces/ExperimentBench.tsx: restore_experiment",
    "surfaces/ExperimentBench.tsx: start_experiment",
  ];

  it("every ledger-writing command named in code is writeLedger's first argument", () => {
    const bypasses: string[] = [];
    for (const file of walk(SRC)) {
      const r = rel(file);
      if (r === "data/ledger-write.ts") continue;
      const code = strip(readFileSync(file, "utf8"));
      for (const cmd of LEDGER_WRITE_COMMANDS) {
        const literal = new RegExp(`["'\`]${cmd}["'\`]`, "g");
        let m: RegExpExecArray | null;
        while ((m = literal.exec(code))) {
          const before = code.slice(Math.max(0, m.index - 200), m.index);
          if (!/\bwriteLedger\s*(?:<[^>]*>)?\s*\(\s*$/.test(before)) bypasses.push(`${r}: ${cmd}`);
        }
      }
    }
    expect(bypasses.sort()).toEqual(EXEMPT_UNTIL_621);
  });

  it("the scan can fire: a direct invoke of a ledger writer is reported", () => {
    const code = `await invoke("apply_recommendation", { recId });`;
    const m = /["'`]apply_recommendation["'`]/.exec(code)!;
    expect(/\bwriteLedger\s*(?:<[^>]*>)?\s*\(\s*$/.test(code.slice(0, m.index))).toBe(false);
  });

  // writeLedger forwards its command to invoke, and machine-model-reader-guard only reads a wrapper's
  // callers in its own file. So here: every use of writeLedger outside ledger-write.ts is an import or
  // a call whose first argument is the command written out, never a name kept in a variable.
  const PLAIN_CALL = /^writeLedger\s*(?:<[^>]*>)?\s*\(\s*(["'`])[a-z_]+\1\s*,/;
  const unwritten = (code: string): string[] => {
    const out: string[] = [];
    const use = /\bwriteLedger\b/g;
    let m: RegExpExecArray | null;
    while ((m = use.exec(code))) {
      const rest = code.slice(m.index);
      const imported = /\bimport\s*(?:type\s*)?\{[^}]*$/.test(code.slice(0, m.index));
      if (!imported && !PLAIN_CALL.test(rest)) out.push(rest.split("\n")[0].trim());
    }
    return out;
  };

  it("every writeLedger call writes its command out", () => {
    const offenders: string[] = [];
    let calls = 0;
    for (const file of walk(SRC)) {
      const r = rel(file);
      if (r === "data/ledger-write.ts") continue;
      const code = strip(readFileSync(file, "utf8"));
      calls += (code.match(/\bwriteLedger\s*(?:<[^>]*>)?\s*\(/g) ?? []).length;
      for (const hit of unwritten(code)) offenders.push(`${r}: ${hit}`);
    }
    expect(calls).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("the caller check can fire: a kept, built or handed-on name is reported, a written one passes", () => {
    expect(unwritten(`writeLedger(cmd, { id });`)).toHaveLength(1);
    expect(unwritten("writeLedger(`apply_${kind}`, { id });")).toHaveLength(1);
    expect(unwritten(`const go = writeLedger;`)).toHaveLength(1);
    expect(unwritten(`import { writeLedger } from "../data/ledger-write";`)).toEqual([]);
    expect(unwritten(`await writeLedger("rollback_change", { changeId });`)).toEqual([]);
    expect(unwritten(`await writeLedger<AppliedChange>(\n  "apply_recommendation",\n  { recId },\n);`)).toEqual([]);
  });
});

// The command list is only as good as its match with the backend. Derived from src-tauri: a function
// that calls `save_history(` writes the ledger, and so does any function that calls one of those, by
// name, across every module. The registered commands among them must be exactly the helper's list
// plus the background writers.
describe("the ledger-writing command list matches src-tauri", () => {
  const RS = join("src-tauri", "src");

  // Comments and string/char literals out, so braces inside them cannot skew a body's extent.
  const stripRust = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/r(#*)"[\s\S]*?"\1/g, '""')
      .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^\\'\n])'/g, "' '");

  type Fn = { name: string; body: string };
  const functions = (): Fn[] => {
    const out: Fn[] = [];
    for (const file of readdirSync(RS).filter((n) => n.endsWith(".rs"))) {
      const src = stripRust(readFileSync(join(RS, file), "utf8"));
      const head = /\bfn\s+([A-Za-z_]\w*)/g;
      let m: RegExpExecArray | null;
      while ((m = head.exec(src))) {
        const open = src.indexOf("{", m.index);
        const semi = src.indexOf(";", m.index);
        if (open < 0 || (semi >= 0 && semi < open)) continue; // a trait signature, no body
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
  };

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

  const ledgerWriters = (fns: Fn[]): Set<string> => {
    const writers = new Set(fns.filter((f) => /\bsave_history\s*\(/.test(f.body)).map((f) => f.name));
    // `drop` is a trait method name (the trial RollbackGuard's), not a callable: every `drop(x)` in
    // the crate would otherwise count as a call to it.
    const skip = new Set(["drop"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of fns) {
        if (writers.has(f.name) || skip.has(f.name)) continue;
        for (const w of writers) {
          if (new RegExp(`(?:^|[^\\w])${w}\\s*(?:::<[^>]*>)?\\s*\\(`).test(f.body)) {
            writers.add(f.name);
            grew = true;
            break;
          }
        }
      }
    }
    return writers;
  };

  it("the parse finds the ledger's own write sites (so an empty result cannot pass)", () => {
    const seeds = functions()
      .filter((f) => /\bsave_history\s*\(/.test(f.body))
      .map((f) => f.name);
    expect(seeds).toContain("apply_recommendation_inner");
    expect(seeds).toContain("rollback_change_inner");
  });

  it("registered commands that reach save_history = LEDGER_WRITE_COMMANDS + BACKGROUND_LEDGER_WRITERS", () => {
    const writers = ledgerWriters(functions());
    const derived = registered(readFileSync(join(RS, "lib.rs"), "utf8"))
      .filter((c) => writers.has(c))
      .sort();
    expect(derived).toEqual([...LEDGER_WRITE_COMMANDS, ...BACKGROUND_LEDGER_WRITERS].sort());
  });
});
