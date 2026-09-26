import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

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
//      file this guard would pass; a name assembled from pieces is never a literal at all.
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

// ── Detection ───────────────────────────────────────────────────────────────────────────────────

// Comments legitimately NAME a command while explaining why a screen no longer calls it; only
// executable source is in scope. `(?<!:)` keeps `https://…` in a string literal from reading as a
// line comment.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

const MODEL = "get_machine_model";
const RETIRED = "get_intelligence_timeline";
const PRODUCERS = ["get_hardware_info", "get_applied_changes"] as const;
const WATCHED = [MODEL, RETIRED, ...PRODUCERS];

// A command is named to `invoke` as a string literal; the quote pair is what separates a call from
// a type name, a comment, or a `source: "hardware::get_hardware_info"` provenance label.
export function detect(source: string): string[] {
  const code = stripComments(source);
  return WATCHED.filter((cmd) => new RegExp(`(["'\`])${cmd}\\1`).test(code));
}

// What sits right before a call's first argument: `invoke(`, `invoke<T>(`, `ipc.run<T[]>(`.
const CALL_BEFORE = /[\w$.]+\s*(?:<[^()]*>)?\s*\(\s*$/;

// Every proper prefix of a command that ends at an underscore after its verb: "get_machine_".
function prefixes(cmd: string): string[] {
  const out: string[] = [];
  for (let i = cmd.indexOf("_", cmd.indexOf("_") + 1); i > 0; i = cmd.indexOf("_", i + 1)) {
    out.push(cmd.slice(0, i + 1));
  }
  return out;
}

// Rule 4: the watched names a source mentions OUTSIDE call position (a constant, an array, an
// object value) or builds from pieces (`get_machine_${x}`, "get_hardware_" + kind). A violation in
// every file, whatever its exemption.
export function loose(source: string): string[] {
  const code = stripComments(source);
  return WATCHED.filter((cmd) => {
    for (const m of code.matchAll(new RegExp(`(["'\`])${cmd}\\1`, "g"))) {
      if (!CALL_BEFORE.test(code.slice(Math.max(0, m.index - 200), m.index))) return true;
    }
    return prefixes(cmd).some((p) =>
      new RegExp(`\`${p}\\w*\\$\\{|(["'])${p}\\w*\\1\\s*\\+`).test(code),
    );
  });
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
      const bad = violations(file, detect(source));
      const kept = loose(source).map((cmd) => `${cmd} (not a call argument)`);
      if (bad.length + kept.length > 0) offenders.push(`${file}: ${[...bad, ...kept].join(", ")}`);
    }
    expect(
      offenders,
      "read machine truth through src/data/machine-model.ts; a direct producer call needs a named " +
        "exemption with a reason, get_intelligence_timeline is retired, and a watched name is only " +
        "ever a call's literal first argument",
    ).toEqual([]);
  });

  it("the one reader still reads the model", () => {
    expect(detect(readFileSync(READER, "utf8"))).toContain(MODEL);
  });

  it("keeps every exemption live, so the list cannot rot into a rubber stamp", () => {
    for (const [key, reason] of Object.entries(EXCEPTIONS)) {
      const [file, cmd] = key.split("|");
      expect(files, `${file} is exempted but no longer exists`).toContain(file);
      expect(
        detect(readFileSync(file, "utf8")),
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
  });

  it("a watched name kept or built outside a call is caught, and every real call form passes", () => {
    // Kept for import elsewhere: the invoking file would carry no literal at all.
    expect(loose('export const MODEL_CMD = "get_machine_model";')).toEqual([MODEL]);
    expect(loose("const cmds = ['get_hardware_info', 'x'];")).toEqual(["get_hardware_info"]);
    expect(loose('const t = { cmd: "get_applied_changes" };')).toEqual(["get_applied_changes"]);
    // Built from pieces.
    expect(loose('invoke(`get_machine_${"model"}`)')).toEqual([MODEL]);
    expect(loose('invoke("get_hardware_" + kind)')).toEqual(["get_hardware_info"]);
    // The forms this codebase really uses.
    expect(loose('invoke<MachineModel>("get_machine_model")')).toEqual([]);
    expect(loose('invoke<{ network_pills?: NetworkPill[] } | null>("get_hardware_info")')).toEqual([]);
    expect(loose('run<AppliedChange[]>("get_applied_changes", setChanges)')).toEqual([]);
    expect(loose('ipc.invoke(\n  "get_hardware_info",\n)')).toEqual([]);
    expect(loose('// const OLD = "get_machine_model";\nconst y = 1;')).toEqual([]);
  });

  it("a planted direct reader in any other screen is a violation", () => {
    const screen = join("src", "surfaces", "HardwareGrid.tsx");
    expect(violations(screen, [MODEL])).toEqual([MODEL]);
    expect(violations(screen, ["get_hardware_info"])).toEqual(["get_hardware_info"]);
    expect(violations(READER, [RETIRED])).toEqual([RETIRED]);
    expect(violations(READER, [MODEL])).toEqual([]);
  });
});
