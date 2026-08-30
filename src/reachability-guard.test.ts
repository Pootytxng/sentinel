import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";

// Reachability guard (2026-08-06 generation prune → guard).
//
// WHY THIS EXISTS. Compy accumulated FIVE unreachable generations of its own rooms — Lab.tsx,
// LabV2.tsx, LabBento.tsx, Optimize.tsx, OptimizeV2.tsx — plus CompyHero, the qpw component layer,
// a design Gallery and a second Sparkline. ~2,578 lines of code that shipped in the bundle, showed
// up in every grep, and made "change the Lab" an ambiguous instruction: which Lab? Each one was
// left behind honestly (a flag flipped, a face won, the loser was never swept), and nothing in the
// toolchain noticed. Dead flags are catchable by flag-default-drift-guard.test.ts; dead FILES were
// not catchable by anything, so they were the ones that piled up.
//
// WHAT IT PINS. Every .ts/.tsx module under src/ must be reachable from src/main.tsx by following
// imports — or be named below with a reason. That is the whole law. It is deliberately structural:
// it cannot be satisfied by a comment, and a retired face fails it the moment its last importer
// goes, not two redesigns later.
//
// TESTS ARE NOT ROOTS, ON PURPOSE. The graph excludes *.test.* files. A module whose only remaining
// importer is its own test is production-dead — that is exactly how three of the deleted faces were
// still "in use". Deleting such a module means deleting its test with it.
//
// LAZY EDGES COUNT. The 3D scenes and the setup tour arrive via React.lazy(() => import("...")),
// so a static-import-only scan would call them dead and be wrong by construction. Both edge shapes
// are matched, and a floor below fails if the lazy pattern ever stops matching anything.

const norm = (p: string) => p.replace(/\\/g, "/");
// Absolute throughout: resolveImport() below returns absolute paths, so the walker must too or the
// BFS silently matches nothing and calls the entire app dead.
const SRC = norm(resolve("src"));

/**
 * Files that legitimately have no importer. Every entry needs a reason a future reader can act on:
 * either it is loaded by something outside the import graph, or it is parked behind an open owner
 * decision. "It might be useful later" is not a reason — that is what git history is for.
 */
const ALLOWED: Record<string, string> = {
  // Compy Pro's dark tier scaffold. Deliberately importer-less: proGate() is HARD-FALSE until the
  // owner errands exist (entity + merchant-of-record + a license design), and gating a real surface
  // on it is a future commit, not a side effect. See the file's own header.
  // (The three GPU-profile entries that used to sit here were retired 2026-08-22 when C-14 / owner
  // fork B_gpu was closed by wiring the surface into LabGround as an advisory panel.)
  "data/entitlements.ts": "Compy Pro dark scaffold — proGate() hard-false, nothing may gate on it yet",

  // Loaded outside the app graph entirely: the static-site generator pulls this through Vite's
  // ssrLoadModule at build time (scripts/lib/library-render.mjs), so no src/ file imports it.
  "data/site.ts": "loaded by scripts/lib/library-render.mjs via ssrLoadModule — build-time, not app",

  // Deliberately importer-less: keepalive-idle-guard.test.ts reads this file as TEXT to pin the
  // idle contract. Wiring it into a room would be the bug, not the fix.
  "design/KeepaliveRoom.tsx": "read as source by keepalive-idle-guard.test.ts; importer-less by design",

  // Q9b Tier 3's case preview / consent screen and the corpus that feeds it (Stage 2, #258).
  // Importer-less BY CONTRACT, not by oversight: §11 gives Stage 2 the screen and nothing else —
  // no send command, no runtime reachability — and `case_evidence_gate()` is a hard-false constant
  // with no caller in the whole crate. Wiring either of these into a room is Stage 4's diff, after
  // Stage 4's review. Reviewed at docs/ui-sweep/fixture (?state=case-both and its five siblings);
  // src/case-evidence-consent-guard.test.ts fails the build if a src/ module ever imports them.
  "surfaces/CaseEvidenceConsent.tsx": "Tier 3 Stage 2 — fixture-only by contract; Stage 4 wires a host",
  "case-preview-corpus.ts": "generated Rust preview corpus for the fixture — deleted when Stage 4's command replaces it",

  // Test infrastructure, named in vitest.config.ts (setupFiles) rather than imported.
  "test/setup.ts": "vitest setupFiles entry — loaded by the runner, not by the app",
  "test/axe.ts": "the C-13 axe harness — imported by the a11y guards, never by the shipped app",
  "test/css-margin.ts": "CSS box-model reasoning shared by the #236 layout guards — tests only, never the app",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    // Ambient declarations (*.d.ts) are never imported by nature — excluded by rule, not allowlist.
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(norm(p));
    }
  }
  return out;
}

/** Resolve a relative specifier the way Vite does, or null for bare/asset imports we don't follow. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  const candidates = [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile() && /\.tsx?$/.test(c)) return norm(c);
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

const all = walk(SRC);

// Both edge shapes. Permissive on quote style on purpose: a MISSED edge makes a live file look
// dead, which is a false alarm, so this errs toward finding edges.
const STATIC_EDGE = /(?:from|import)\s+["']([^"']+)["']/g;
const LAZY_EDGE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

let lazyEdgeCount = 0;
const graph = new Map<string, Set<string>>();
for (const file of all) {
  const src = readFileSync(file, "utf8");
  const deps = new Set<string>();
  for (const m of src.matchAll(STATIC_EDGE)) {
    const r = resolveImport(file, m[1]);
    if (r) deps.add(r);
  }
  for (const m of src.matchAll(LAZY_EDGE)) {
    const r = resolveImport(file, m[1]);
    if (r) {
      deps.add(r);
      lazyEdgeCount++;
    }
  }
  graph.set(file, deps);
}

const ENTRY = norm(join(SRC, "main.tsx"));
const reachable = new Set<string>();
const stack = [ENTRY];
while (stack.length) {
  const cur = stack.pop()!;
  if (reachable.has(cur)) continue;
  reachable.add(cur);
  for (const dep of graph.get(cur) ?? []) stack.push(dep);
}

const rel = (f: string) => f.slice(`${SRC}/`.length);
const unreachable = all.filter((f) => !reachable.has(f)).map(rel).sort();

describe("every module under src/ is reachable from main.tsx", () => {
  it("has a real graph to grade — never passes vacuously", () => {
    expect(all, "found no source files; the walker is broken, not the tree").toContain(ENTRY);
    // Floors, not exact counts: they catch a collapsed walk/BFS without churning on every new file.
    expect(all.length, "src/ shrank below any plausible size — check the walker").toBeGreaterThan(150);
    expect(reachable.size, "BFS from main.tsx collapsed — check resolveImport").toBeGreaterThan(150);
    expect(
      lazyEdgeCount,
      "no React.lazy(() => import(...)) edges matched; the 3D scenes would be called dead",
    ).toBeGreaterThan(0);
  });

  it("has no orphaned module — a retired face must leave with its file, not linger in the bundle", () => {
    const orphans = unreachable.filter((f) => !(f in ALLOWED));
    expect(
      orphans,
      orphans.length
        ? `Unreachable from src/main.tsx:\n${orphans.map((f) => `  - ${f}`).join("\n")}\n\n` +
            "Either delete it (with its test), wire it into a room, or add it to ALLOWED with a reason."
        : "",
    ).toEqual([]);
  });

  it("keeps ALLOWED honest — no ghost entries, no entries that are actually wired up", () => {
    const known = new Set(all.map(rel));
    const ghosts = Object.keys(ALLOWED).filter((f) => !known.has(f));
    expect(ghosts, `ALLOWED names files that no longer exist: ${ghosts.join(", ")}`).toEqual([]);

    // The mirror case: once something IS imported, its exemption is stale and must come out, or the
    // list slowly becomes a place where live files hide from the next audit.
    const nowLive = Object.keys(ALLOWED).filter((f) => !unreachable.includes(f));
    expect(
      nowLive,
      `ALLOWED entries are now reachable — delete their exemption: ${nowLive.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Second tier: a module can be REACHABLE while the room inside it is dead.
//
// WHY THIS EXISTS. src/surfaces/Monitor.tsx passed the tier above for weeks. MonitorV2 imported one
// live symbol out of it (`TuningPresets`), so the FILE had an importer — while the classic Monitor
// shell it also exported, the actual room, had had no production caller since MonitorV2 replaced it.
// Backlog C-18 recorded it as "the one genuinely unreferenced surface"; it was not unreferenced, and
// deleting the file on that reading would have broken the build. The room only became deletable once
// the live symbol moved out (issue #146).
//
// WHAT IT PINS. The DEFAULT-EXPORTED symbol of a module must be imported by production code — under
// either form: `import X from "./m"` (or a React.lazy edge, which takes the default), or
// `import { X } from "./m"` where the same symbol is also exported by name. Default is the right
// granularity: it is how this codebase exports a room/surface, so a retired face surfaces the moment
// its last mount goes, even while named exports keep the file alive. A component whose only importer
// is its own test is production-dead — the same rule as the tier above.
//
// The BOTH-FORMS rule is load-bearing, not leniency. Two dozen surfaces here export a component by
// name AND re-export it as default, and App imports the named one; failing those would report 26
// live rooms as dead on day one, and a guard that cries wolf gets deleted. The Monitor shell was
// caught because NEITHER form was imported anywhere in production.
//
// Named exports other than the default one are deliberately out of scope: half are types and
// internal helpers, and this is a room-reachability guard, not a general dead-symbol analyzer.
const DEFAULT_ALLOWED: Record<string, string> = {
  // EMPTY, and that is the target state. The two entries this guard produced on its first run were
  // filed as backlog C-18b and then DECIDED rather than left to rot (issue #148): `Onboarding.tsx`
  // was the modal C-05 had already retired — its two live exports (`ONBOARDED_KEY`, `type RigLine`)
  // moved next to `SETUP_TOUR_KEY` in `surfaces/setup/SetupTour.tsx` and the room was deleted; the
  // vendored `Stepper` became a policy exemption below instead of a per-file entry.
  //
  // An entry here is a promise to come back, not a place to park a finding. Write the reason as the
  // decision that is still owed, and open the row that owes it.
};

// Vendored third-party modules are exempt by RULE, not by allowlist entry. `design/vendor/` holds
// code this repo did not write and re-vendors wholesale; whether its default export is mounted here
// says nothing about whether the file is correct, and pruning part of a vendored module is a
// judgement about the NEXT re-vendor, not about dead code. A per-file entry for it would be a
// promise to come back that nobody can ever keep — the exemption is permanent, so it says so.
const VENDOR_PREFIX = "design/vendor/";

// `import X from "..."` / `import X, { y } from "..."`, type-only included: a type-only default
// import is still a use. `import * as X` is not a default import and is deliberately not matched.
const DEFAULT_IMPORT = /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g;
// `import { a, b as c } from "..."` — the brace group, captured whole and split below.
const NAMED_IMPORT = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
// The shapes this codebase actually writes. An anonymous `export default () => ...` yields no
// identifier, and then the default-import edge is the only signal — which is correct for it.
const DEFAULT_EXPORT_NAME =
  /^export default (?:function\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*;?\s*$)/m;
const HAS_DEFAULT_EXPORT = /^export default\b/m;

const defaultImported = new Set<string>();
/** module → the names production code imports out of it with braces. */
const namedImported = new Map<string, Set<string>>();
for (const file of all) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(DEFAULT_IMPORT)) {
    const r = resolveImport(file, m[2]);
    if (r) defaultImported.add(r);
  }
  for (const m of src.matchAll(LAZY_EDGE)) {
    const r = resolveImport(file, m[1]);
    if (r) defaultImported.add(r);
  }
  for (const m of src.matchAll(NAMED_IMPORT)) {
    const r = resolveImport(file, m[2]);
    if (!r) continue;
    const set = namedImported.get(r) ?? new Set<string>();
    for (const raw of m[1].split(",")) {
      // `type Foo` / `Foo as Bar` → the exported name is the first identifier.
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name) set.add(name);
    }
    namedImported.set(r, set);
  }
}

const deadDefaults = all
  .filter((file) => {
    const src = readFileSync(file, "utf8");
    if (!HAS_DEFAULT_EXPORT.test(src)) return false;
    if (defaultImported.has(file)) return false;
    const named = DEFAULT_EXPORT_NAME.exec(src);
    const symbol = named?.[1] ?? named?.[2];
    if (symbol && namedImported.get(file)?.has(symbol)) return false;
    if (rel(file).startsWith(VENDOR_PREFIX)) return false;
    return true;
  })
  .map(rel)
  .sort();

describe("a default-exported room must have a production importer — not only a test", () => {
  it("has a real set to grade — never passes vacuously", () => {
    expect(
      defaultImported.size,
      "no default-import edges matched at all; the regex is broken, not the tree",
    ).toBeGreaterThan(0);
    expect(
      namedImported.size,
      "no named-import edges matched at all; every dual-export surface would read as dead",
    ).toBeGreaterThan(0);
  });

  it("has no dead room hiding inside a live file", () => {
    const dead = deadDefaults.filter((f) => !(f in DEFAULT_ALLOWED));
    expect(
      dead,
      dead.length
        ? `Default-exported component with no production importer:\n${dead.map((f) => `  - ${f}`).join("\n")}\n\n` +
            "Either delete it (with its test), mount it, or add it to DEFAULT_ALLOWED with a reason. " +
            "If a NAMED export in the same file is still live, move that symbol out first — that is " +
            "what made backlog C-18's Monitor shell deletable."
        : "",
    ).toEqual([]);
  });

  it("exempts vendored code by rule, and nothing else", () => {
    // The rule is only defensible while it stays this narrow. If `design/vendor/` ever grows a file
    // this repo actually authors, or the prefix drifts to something broader like `design/`, the
    // exemption stops meaning "not ours to prune" and becomes a hiding place.
    expect(VENDOR_PREFIX).toBe("design/vendor/");
    const vendored = all.map(rel).filter((f) => f.startsWith(VENDOR_PREFIX));
    expect(vendored.length, "the vendor exemption covers no files at all — delete it").toBeGreaterThan(0);
    // It has to be doing work, too: at least one vendored module must actually be a dead room here,
    // or this is a rule with no subject and the next reader cannot tell what it bought.
    expect(
      vendored.some((f) => {
        const src = readFileSync(join(SRC, f), "utf8");
        if (!HAS_DEFAULT_EXPORT.test(src)) return false;
        const named = DEFAULT_EXPORT_NAME.exec(src);
        const symbol = named?.[1] ?? named?.[2];
        const full = join(SRC, f);
        return !defaultImported.has(norm(full)) && !(symbol && namedImported.get(norm(full))?.has(symbol));
      }),
      "no vendored module is currently an unmounted default export — the exemption is inert",
    ).toBe(true);
  });

  it("keeps DEFAULT_ALLOWED honest — no ghosts, no entries that are actually imported", () => {
    const known = new Set(all.map(rel));
    const ghosts = Object.keys(DEFAULT_ALLOWED).filter((f) => !known.has(f));
    expect(ghosts, `DEFAULT_ALLOWED names files that no longer exist: ${ghosts.join(", ")}`).toEqual([]);
    const nowLive = Object.keys(DEFAULT_ALLOWED).filter((f) => !deadDefaults.includes(f));
    expect(
      nowLive,
      `DEFAULT_ALLOWED entries now have an importer — delete their exemption: ${nowLive.join(", ")}`,
    ).toEqual([]);
  });
});
