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
  // The GPU-profile surface is built but not wired into any room: applying a GPU profile cannot
  // satisfy rollback-first (AMD profile state is not user-mode readable), so it sits behind owner
  // decision B_gpu in docs/OWNER_ACTION_CHECKLIST.md. Deleting it is an owner call, not a sweep.
  "surfaces/GpuProfile.tsx": "owner decision B_gpu — GPU profile surface parked, not retired",
  "data/gpu-profile-store.ts": "owner decision B_gpu — store for the parked GPU profile surface",
  "hooks/use-gpu-profile-scope.ts": "owner decision B_gpu — hook for the parked GPU profile surface",
  "data/entitlements.ts": "owner decision B_gpu — entitlement tiers the parked surface reads",

  // Loaded outside the app graph entirely: the static-site generator pulls this through Vite's
  // ssrLoadModule at build time (scripts/lib/library-render.mjs), so no src/ file imports it.
  "data/site.ts": "loaded by scripts/lib/library-render.mjs via ssrLoadModule — build-time, not app",

  // Deliberately importer-less: keepalive-idle-guard.test.ts reads this file as TEXT to pin the
  // idle contract. Wiring it into a room would be the bug, not the fix.
  "design/KeepaliveRoom.tsx": "read as source by keepalive-idle-guard.test.ts; importer-less by design",

  // Test infrastructure, named in vitest.config.ts (setupFiles) rather than imported.
  "test/setup.ts": "vitest setupFiles entry — loaded by the runner, not by the app",
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
