import { describe, it, expect } from "vitest";
import { readFileSync, statSync, writeFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
// (fs/path typed by src/test-node-shims.d.ts — the census reads sources from disk, same pattern as
// reachability-guard.test.ts, whose import walker this reuses deliberately rather than re-deriving.)

// AFFORDANCE CENSUS — the redesign's do-not-lose-anything net (owner constraint, 2026-08-11:
// "be sure you havent lost any current functionality or important features or finished items
// behind in the process").
//
// WHY THIS EXISTS. The bento + popout conversion rewrites the layout of every room in the app. The
// single most likely way that goes wrong is not a crash and not an ugly screen — it is a control
// that quietly fails to make the trip. A rewritten room renders, tsc is green, vitest is green, the
// screenshots look better, and a button that used to be there simply is not, because nobody was
// holding the old list. That failure is invisible to every guard the repo had before this one:
//
//   - reachability-guard pins that every MODULE is reachable. A room that loses half its buttons
//     but keeps its file is perfectly reachable.
//   - i18n/orphan-key-guard pins that every shipped STRING has a consumer. It fires when copy is
//     stranded, but a conversion that deletes the control AND its key passes it cleanly — the two
//     deletions cancel out, which is exactly the shape a careless rewrite has.
//
// So this guard holds the third thing: a per-surface BASELINE of the user-facing strings each room
// actually reaches. Strings are the honest proxy for affordances here, because this codebase routes
// every user-visible label through i18n — a button that disappears takes its t() key with it, and
// that is detectable.
//
// THE LAW. For every entry below, the set of i18n keys reachable from it must be a SUPERSET of its
// recorded baseline. Growth is free — a redesign is expected to add copy, and adding keys never
// fails. SHRINKAGE FAILS, and the failure names the exact keys that went missing, so the reviewer
// is told which affordance was dropped rather than being told a number changed.
//
// HOW TO RESPOND TO A FAILURE. In order of what is almost always correct:
//   1. You dropped a control by accident. Put it back. This is the case this guard exists for.
//   2. You MOVED the control somewhere the walker cannot see (a room now reaches it through a
//      dynamic route, a lazy edge with a computed specifier, an untracked entry). Fix the edge or
//      add the new entry — do not re-record.
//   3. The affordance is genuinely, deliberately retired. Then re-record the baseline with
//      COMPY_RECORD_AFFORDANCES=1 and say in the commit message which affordance was retired and
//      on whose call. Re-recording is a decision with an author, never a way to make red go green.
//
// WHAT THIS GUARD DOES NOT CLAIM. It pins the label layer, not behaviour: a button whose text
// survives while its onClick is dropped passes here. That gap is covered by each room's own render
// tests and by the self-review visual gate. This guard's job is the one nothing else was doing —
// noticing that something used to be reachable and now is not.

const norm = (p: string) => p.replace(/\\/g, "/");
const SRC = norm(resolve("src"));
const BASELINE = join(SRC, "affordance-census.baseline.json");

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

const STATIC_EDGE = /(?:from|import)\s+["']([^"']+)["']/g;
const LAZY_EDGE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
// Type-only edges are erased at build time and carry no copy, but they are ruinous to follow: a
// room that writes `import type { HardwareInfo } from "../App"` would pull App.tsx and, through it,
// every other room — so Home, Lab and the shell would all record an identical whole-app key set and
// the census would lose all per-room resolution. Stripped before edges are scanned.
const TYPE_ONLY_IMPORT = /^\s*(?:import|export)\s+type\s[^;]*?from\s+["'][^"']+["'];?/gm;
// A literal key: t("a.b.c"). Dotted-path shape only, so ordinary strings in the file are ignored.
const LITERAL_KEY = /\bt\(\s*["']([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["']/g;
// A composed key: t(`common.rail.${r.id}`) or `settings.supportEvidence.${key}`. The static head is
// recorded as a prefix — the same lenient shape orphan-key-guard uses, and for the same reason: a
// missed consumer is a far worse error than a coarse one.
const PREFIX_KEY = /`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\.\$\{/g;

/**
 * The surfaces whose affordances are pinned. These are the app's user-reachable entry points, not
 * every component — a control belongs to whichever room can actually get you to it, and the walker
 * finds shared components (design/, surfaces/*-panels) through the room that uses them.
 */
const ENTRIES: Record<string, string> = {
  home: "surfaces/HomeRoom.tsx",
  monitor: "surfaces/MonitorV2.tsx",
  blackbook: "surfaces/BlackbookV2.tsx",
  lab: "surfaces/LabGround.tsx",
  settings: "surfaces/Settings.tsx",
  onboarding: "Onboarding.tsx",
  firstCheck: "surfaces/FirstCheck.tsx",
  overlay: "Overlay.tsx",
  shell: "App.tsx",
};

/** Every i18n key (and composed-key prefix) reachable from one entry, following local imports. */
function keysReachableFrom(entryRel: string): string[] {
  const entry = norm(join(SRC, entryRel));
  const seen = new Set<string>();
  const keys = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of raw.matchAll(LITERAL_KEY)) keys.add(m[1]);
    for (const m of raw.matchAll(PREFIX_KEY)) keys.add(`${m[1]}.*`);
    const src = raw.replace(TYPE_ONLY_IMPORT, "");
    for (const m of src.matchAll(STATIC_EDGE)) {
      const r = resolveImport(file, m[1]);
      if (r && !/\.test\./.test(r)) queue.push(r);
    }
    for (const m of src.matchAll(LAZY_EDGE)) {
      const r = resolveImport(file, m[1]);
      if (r && !/\.test\./.test(r)) queue.push(r);
    }
  }
  return [...keys].sort();
}

const census: Record<string, string[]> = {};
for (const [name, rel] of Object.entries(ENTRIES)) census[name] = keysReachableFrom(rel);

// Re-record deliberately: COMPY_RECORD_AFFORDANCES=1 npx vitest run src/affordance-census.test.ts
// Guarded behind an env var on purpose — a baseline that rewrites itself on every run is a log,
// not a guard.
const RECORDING = process.env.COMPY_RECORD_AFFORDANCES === "1";
if (RECORDING) writeFileSync(BASELINE, `${JSON.stringify(census, null, 2)}\n`, "utf8");

describe("affordance census — the redesign may add, never silently subtract", () => {
  it("has a recorded baseline to compare against", () => {
    expect(
      existsSync(BASELINE),
      "src/affordance-census.baseline.json is missing. Record it with " +
        "COMPY_RECORD_AFFORDANCES=1 npx vitest run src/affordance-census.test.ts",
    ).toBe(true);
  });

  it("finds every pinned entry on disk", () => {
    const missing = Object.entries(ENTRIES).filter(([, rel]) => {
      try {
        return !statSync(join(SRC, rel)).isFile();
      } catch {
        return true;
      }
    });
    expect(
      missing.map(([name, rel]) => `${name} → ${rel}`),
      "A pinned entry no longer exists. If a room was renamed, point ENTRIES at its new file — " +
        "deleting the entry deletes the only record of what that room used to offer.",
    ).toEqual([]);
  });

  it("the walker still reaches real copy (floor — catches a silently broken resolver)", () => {
    // If resolveImport or the key regexes stop matching, every set collapses to empty and the
    // superset assertion below passes vacuously. This floor is what makes that impossible.
    for (const [name, keys] of Object.entries(census)) {
      expect(keys.length, `${name}: the census found almost no i18n keys — the walker is broken`).toBeGreaterThan(2);
    }
    // Per-entry floors are individually weak (Onboarding honestly owns five strings). The union is
    // the real tripwire: a broken resolver cannot keep this number up.
    const union = new Set(Object.values(census).flat());
    expect(union.size, "the census as a whole collapsed — check resolveImport and the key regexes").toBeGreaterThan(600);
  });

  it("no room has lost an affordance", () => {
    const baseline: Record<string, string[]> = JSON.parse(readFileSync(BASELINE, "utf8"));
    const lost: string[] = [];
    for (const [name, recorded] of Object.entries(baseline)) {
      const now = new Set(census[name] ?? []);
      const gone = recorded.filter((k) => !now.has(k));
      if (gone.length) lost.push(`${name} lost ${gone.length}: ${gone.slice(0, 12).join(", ")}${gone.length > 12 ? " …" : ""}`);
    }
    expect(
      lost,
      "A surface no longer reaches copy it used to reach — that is usually a control dropped in a " +
        "rewrite. Put it back. If the affordance was deliberately retired, re-record with " +
        "COMPY_RECORD_AFFORDANCES=1 and name the retirement in the commit message.",
    ).toEqual([]);
  });

  it("every pinned entry is represented in the baseline", () => {
    const baseline: Record<string, string[]> = JSON.parse(readFileSync(BASELINE, "utf8"));
    const unpinned = Object.keys(ENTRIES).filter((n) => !(n in baseline));
    expect(
      unpinned,
      "A new entry was added to ENTRIES without recording its baseline — it is currently pinned to " +
        "nothing. Record with COMPY_RECORD_AFFORDANCES=1.",
    ).toEqual([]);
  });
});
