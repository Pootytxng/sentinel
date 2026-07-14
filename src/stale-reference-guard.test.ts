import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// bug -> guard (2026-06-20, extended 2026-07-12d). After the classic-surface retirement, user-facing
// copy kept naming rooms/tabs that no longer exist. Owner-caught twice: (1) "Startup tab"/"Latency
// tab" in Blackbook data; (2) 2026-07-12 — a handoff called the Blackbook room "Learn" (its retired
// id), and a sweep then found live leaks the ORIGINAL json-only guard missed: "a Play debrief"
// (TuningInstrument), "More in the library" (Term), "search the library" (Blackbook empty state),
// "Compy's Check" (tweaks.json — slipped past because the old regex only matched "<Name> tab").
//
// GROUND TRUTH — src/design/homeRail.ts. The shipped rail (compy_lab_ground DEFAULT ON) is
//   Home · Monitor · Blackbook · Lab.
// The persisted nav IDS stay home/check/play/fix/learn/lab (renaming one orphans stored history),
// but homeRail.ts RELABELS them on EVERY rail: id play → "Monitor", id fix → "Tune"/"Optimize",
// id learn → "Blackbook". So the LABELS "Play", "Learn", "Fix" (and Learn's retired brand
// "library") NEVER render to the user on any rail — naming a room by one of them is always a leak.
// ("Check" is different: it IS a live label on the classic failsafe rail and appears in legit
// rail-remapped source, e.g. setup-steps.ts's classic tie, so bare "Check tab" is NOT scanned in
// source — only the possessive feature-reference form "Compy's Check".)

// --- Scan A: the Blackbook data corpus (rail-agnostic user knowledge describing the shipped app) ---
// Here "<Retired> tab" is always stale — the ground rail has no standalone Check/Optimize/etc. tab.
// Add new src/data/*.json here when one is introduced.
const DATA_FILES = [
  "guides.json",
  "walkthroughs.json",
  "tricks.json",
  "tuning-guides.json",
  "terms.json",
  "tweaks.json",
];

const RETIRED_TAB =
  /\b(Check|Tune|Optimize|Readiness|Priorities|Sessions|Monitoring|Benchmark|Latency|Diagnostics|Garage|Overview|Startup) tab\b/g;

// --- Scan B: retired ROOM references that are wrong in ANY context (data OR rendered source) ---
// A retired LABEL used as a place/feature the user can visit, or the retired "library" brand.
// Requires a role-noun after Play/Learn/Fix so English verbs ("fix this", "play your game",
// "learn more") and component/id tokens don't match.
const RETIRED_ROOM = [
  // id play/fix/learn named by their retired LABELS as a room/tab/debrief/screen/page.
  /\b(Play|Learn|Fix) (tab|room|debrief|screen|page)\b/g,
  // "the library" as the Learn/Blackbook room's retired brand (a nav/search affordance, not the
  // common noun — the leading verb pins it to "go to / search the room").
  /\b(?:More in the|search the|open the|visit the|back to the|into the) library\b/g,
  // The retired room brand "Library" as a NAV DESTINATION — a capital "Library" reached via a
  // preposition/article (the old "Open full entry in Library" button, "back to the Library"). The
  // required leading in/to/into/from/the is what separates the brand from the legit capitalized
  // common noun ("Dynamic-Link Library", "Steam Library") and code identifiers (openLibrary,
  // LibraryContext) — a bare "Library" is NOT scanned because the common-noun sense is capitalized too.
  /\b(?:in|to|into|from|the) Library\b/g,
  // "Compy's <Retired>" — names a retired room as a Compy feature the user can use (the exact
  // form that slipped the old json-only guard, e.g. "Compy's Check looks for the rot").
  /\bCompy's (Check|Play|Learn|Fix)\b/g,
];

// Strip comments so internal shorthand ("// the Play debrief", JSDoc mentioning "in Learn") — which
// legitimately names rooms by their persisted ids — never trips the guard. We only police RENDERED
// copy. Removes /* ... */ blocks and whole-line // comments (the sources of the shorthand); leaves
// inline string contents (including any "//" inside a URL) intact.
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlocks
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

// Recursively collect non-test .ts/.tsx under a dir.
function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { recursive: true }) as string[];
  return entries
    .filter(
      (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !/\.d\.ts$/.test(p),
    )
    .map((p) => join(dir, p));
}

describe("no stale references to retired tabs (Blackbook data copy)", () => {
  for (const file of DATA_FILES) {
    it(`${file} names no retired tab`, () => {
      const text = readFileSync(join("src", "data", file), "utf8");
      const hits = text.match(RETIRED_TAB) || [];
      expect(hits).toEqual([]);
    });

    it(`${file} names no retired room label`, () => {
      const text = readFileSync(join("src", "data", file), "utf8");
      const hits = RETIRED_ROOM.flatMap((re) => text.match(re) || []);
      expect(hits).toEqual([]);
    });
  }
});

describe("no retired room labels leak into rendered surface/design copy", () => {
  const dirs = [join("src", "surfaces"), join("src", "design")];
  const files = dirs.flatMap((d) => sourceFiles(d));

  it("scans a real, non-trivial set of source files", () => {
    // Guard against a broken glob silently passing (0 files scanned == false green).
    expect(files.length).toBeGreaterThan(30);
  });

  for (const file of files) {
    it(`${file} has no rendered retired-room leak`, () => {
      const code = stripComments(readFileSync(file, "utf8"));
      const hits = RETIRED_ROOM.flatMap((re) => code.match(re) || []);
      expect(hits, `retired room label rendered in ${file}: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
