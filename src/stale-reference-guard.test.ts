import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { HOME_RAIL, railFor } from "./design/homeRail";

// bug -> guard (2026-06-20, extended 2026-07-12d). After the classic-surface retirement, user-facing
// copy kept naming rooms/tabs that no longer exist. Owner-caught twice: (1) "Startup tab"/"Latency
// tab" in Blackbook data; (2) 2026-07-12 — a handoff called the Blackbook room "Learn" (its retired
// id), and a sweep then found live leaks the ORIGINAL json-only guard missed: "a Play debrief"
// (TuningInstrument), "More in the library" (Term), "search the library" (Blackbook empty state),
// "Compy's Check" (tweaks.json — slipped past because the old regex only matched "<Name> tab").
//
// GROUND TRUTH — src/design/homeRail.ts, and it is READ from there rather than copied, because
// copying it is how this comment went stale. It named a rail the app had not shown since
// 2026-08-12 (the owner renamed Monitor → Live, Blackbook → History, Lab → Test) and again since
// 2026-08-19 (Home → Health) — a guard against stale room names carrying a stale room list.
// `liveLabels()` below derives the live set, and a test pins this sentence to it:
//
//   THE SHIPPED RAIL (compy_lab_ground DEFAULT ON) IS: Health · Games · Problems · Live · History · Test
//
// The persisted nav IDS stay home/check/play/fix/learn/lab (renaming one orphans stored history),
// and homeRail.ts RELABELS them on EVERY rail. So a label that is not in the live set NEVER
// renders to the user — naming a room by one of them is always a leak. Retired twice over now:
// "Play"/"Learn"/"Fix" (and Learn's retired brand "library") from the first pass, plus
// "Monitor"/"Blackbook"/"Lab"/"Home" from the 2026-08 renames.
// ("Check" is different: it IS a live label on the classic failsafe rail and appears in legit
// rail-remapped source, e.g. setup-steps.ts's classic tie, so bare "Check tab" is NOT scanned in
// source — only the possessive feature-reference form "Compy's Check".)

/** Every label the rail can show, across all four flag combinations — the live set. */
function liveLabels(): Set<string> {
  const labels = HOME_RAIL.map((i) => i.label);
  for (const merged of [false, true]) {
    for (const ground of [false, true]) {
      for (const item of railFor(merged, ground)) labels.push(item.label);
    }
  }
  return new Set(labels);
}

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
// The room names the rail no longer shows. Cross-checked against `liveLabels()` below, so a label
// can never sit in both sets — that is what would have caught the 2026-08 renames leaving this
// guard policing names the app had stopped showing, and what will catch the next half-rename.
const RETIRED_LABELS = ["Play", "Learn", "Fix", "Monitor", "Blackbook", "Lab", "Home"] as const;

const RETIRED_ROOM = [
  // id play/fix/learn named by their retired LABELS as a room/tab/debrief/screen/page.
  /\b(Play|Learn|Fix) (tab|room|debrief|screen|page)\b/g,
  // The 2026-08 renames (Monitor → Live, Blackbook → History, Lab → Test, Home → Health). Only
  // "tab" and "room" follow these four: those two nouns are unambiguously app navigation, whereas
  // "Monitor screen" is a display, "Home page" is a website, and "Lab" stays a live INTERNAL name
  // for the room's code (LabConsole and its stations) that shorthand may keep using.
  /\b(Monitor|Blackbook|Lab|Home) (tab|room)\b/g,
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
  // "Past Tweaks" — the leftovers audit's retired FEATURE label, renamed to the owner-locked
  // "Optimization Cleanup" (Phase 0, 2026-07-16). Title-case only: the lowercase descriptive
  // phrase ("past tweaks an old guide left") and the singular finding-row prefix "Past tweak ·"
  // stay legal — only the capital-T brand is retired.
  /\bPast Tweaks\b/g,
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

describe("this guard's own room list is the one the app ships", () => {
  it("calls no LIVE rail label retired", () => {
    // The failure this prevents, concretely: the owner renames a room, someone updates homeRail.ts
    // and stops there, and this guard goes on policing a name the app now shows — or never starts
    // policing the name it just retired. Deriving the live set makes half a rename fail the build.
    const live = liveLabels();
    expect(live.size).toBeGreaterThanOrEqual(4); // non-vacuous: railFor() actually returned rooms
    expect(RETIRED_LABELS.filter((label) => live.has(label))).toEqual([]);
  });

  it("keeps the self-reviewer's rail description true", () => {
    // The self-review LAW routes every visual done-claim through `.claude/agents/self-reviewer.md`,
    // and that brief tells the reviewer which rail proves it is looking at the MAIN window rather
    // than the FPS overlay. It named the pre-rename rooms, so the one check standing between a UI
    // change and a "done" was working from a rail the app stopped drawing on 2026-08-19. A stale
    // rubric is worse than no rubric: it passes.
    const brief = readFileSync(join(".claude", "agents", "self-reviewer.md"), "utf8");
    const shipped = railFor(false, true).map((i) => i.label).join(" · ");
    expect(brief).toContain(`**${shipped}**`);
  });

  it("keeps its own GROUND TRUTH sentence true", () => {
    // The stale comment IS the bug being guarded here: this file's header named a rail the app had
    // not shown for a fortnight, so a guard against stale room names was itself carrying a stale
    // room list. Reading the sentence back out and comparing it to homeRail.ts is the only thing
    // that keeps a comment honest over time.
    const header = readFileSync(join("src", "stale-reference-guard.test.ts"), "utf8");
    const claimed = header.match(/THE SHIPPED RAIL \(compy_lab_ground DEFAULT ON\) IS: (.+)/)?.[1].trim();
    const shipped = railFor(false, true).map((i) => i.label).join(" · ");
    expect(claimed, "the GROUND TRUTH sentence is missing from this file's header").toBeTruthy();
    expect(claimed).toBe(shipped);
  });
});

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
