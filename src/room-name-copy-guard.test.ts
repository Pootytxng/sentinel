import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { HOME_RAIL } from "./design/homeRail";
// (fs/path typed by src/test-node-shims.d.ts — sources are read from disk, like every other
// state-drift guard here, so the guard grades what SHIPS rather than what an import resolves to.)

// ROOM-NAME DRIFT GUARD — the app must call a room what the rail calls it, everywhere.
//
// Written 2026-08-18, after the owner opened his own build and found the front door telling him to
// "roll it back in the Lab" — a room that stopped existing on 2026-08-12, when he renamed Monitor →
// Live, Blackbook → History and Lab → Test. The rail was renamed; the sentences pointing AT the
// rail were not. Three of them were in Rust, where no UI review ever looks, and one of them had a
// unit test asserting the stale word (`readiness.rs`, "points at the real undo home (the Lab)") —
// so the rename could not have survived even if someone had noticed, because the suite defended it.
//
// The same drift bit the owner twice in one sitting: a session handoff told him a new feature was
// under "Monitor → CPU" and he went looking for a tab that no longer exists. A rename is not done
// when the rail changes; it is done when nothing left in the product speaks the old name.
//
// SCOPE, stated so it is not mistaken for broader than it is:
//   • User-facing copy only — the English locale values and Rust string literals. Identifiers,
//     nav keys and persistence keys are deliberately NOT graded: `id: "lab"` is a storage key the
//     owner never sees, and renaming ids would orphan his location history for zero user value.
//     That split is the project's standing decision (homeRail.ts) and this guard preserves it.
//   • Capitalised, room-shaped references only — "the Lab", "in Monitor", "Blackbook", "Lab tab".
//     Lowercase "monitor" (the display), "monitoring" and "LibreHardwareMonitor" are hardware
//     vocabulary, not room names, and are none of this guard's business.
//   • Line-level escape hatch: `room-name-allow`, greppable, for copy that must quote a historical
//     name (a changelog line, a migration note).

/** Retired label → the rail id that inherited it. Renames are owner decisions, so they are named
 *  here explicitly rather than inferred; the assertion below keeps the right-hand side honest. */
const RETIRED: Record<string, string> = {
  Monitor: "play", // → "Live"   (owner rename 2026-08-12)
  Blackbook: "learn", // → "History" (owner rename 2026-08-12)
  Lab: "lab", // → "Test"    (owner rename 2026-08-12)
};

const ALLOW = "room-name-allow";

/** Room-shaped uses only: "the Lab", "in Monitor", "to Blackbook", "Lab tab", "Monitor room". */
function stalePattern(name: string): RegExp {
  // Built from RegExp .source fragments, never from a hand-typed string: an escape level lost
  // in transit turns \b into a backspace char and the guard passes on a red tree — which is
  // exactly how the first draft of this file reported clean while four stale names sat in Rust.
  const LEAD = /\b(?:the|in|In|to|from|open|Open)\s+/.source;
  const TRAIL = /\s+(?:tab|room|screen|console)\b/.source;
  const EDGE = /\b/.source;
  return new RegExp(`${LEAD}${name}${EDGE}|${EDGE}${name}${TRAIL}`);
}

function currentLabel(id: string): string {
  const row = HOME_RAIL.find((r) => r.id === id);
  if (!row) throw new Error(`rail has no room "${id}" — RETIRED is stale, fix this guard`);
  return row.label;
}

function walk(dir: string, ext: string): string[] {
  // `{ recursive: true }` is the shape src/test-node-shims.d.ts exposes (withFileTypes is not in
  // the shim) — it returns paths relative to `dir`, so they are re-joined for reporting.
  return readdirSync(dir, { recursive: true })
    .filter((rel) => rel.endsWith(ext))
    .map((rel) => join(dir, rel));
}

type Hit = { file: string; line: number; name: string; text: string };

function scan(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      if (text.includes(ALLOW)) return;
      for (const name of Object.keys(RETIRED)) {
        if (stalePattern(name).test(text)) hits.push({ file, line: i + 1, name, text: text.trim() });
      }
    });
  }
  return hits;
}

function report(hits: Hit[]): string {
  return hits
    .map(
      (h) =>
        `  ${h.file}:${h.line}  "${h.name}" is now "${currentLabel(RETIRED[h.name])}"\n      ${h.text.slice(0, 160)}`,
    )
    .join("\n");
}

// DISARM PROOF — a scanner that stops finding things reports "clean" and is indistinguishable from
// a healthy tree. This guard already did exactly that once, twice over, in the hour it was written:
// an escape level lost in transit turned its word-boundary into a backspace char, and a directory
// walk rewritten for the type shim could have silently returned nothing. Both reported 3 passing
// tests over a tree with nine stale names in it. So the matcher and the walk are proven here, not
// assumed, and this block fails the moment the guard goes blind.
describe("the guard can still see (disarm proof)", () => {
  it("matches the real sentence that caused this file to exist", () => {
    expect(stalePattern("Lab").test("back on or roll it back in the Lab — either one clears this.")).toBe(true);
    expect(stalePattern("Monitor").test("Watch one long session in Monitor — if temps climb…")).toBe(true);
    expect(stalePattern("Blackbook").test("Open Blackbook, pick the last good session")).toBe(true);
  });

  it("leaves hardware vocabulary alone — the false positives that would get it disabled", () => {
    expect(stalePattern("Monitor").test("Run HWiNFO or LibreHardwareMonitor to read live RPM")).toBe(false);
    expect(stalePattern("Monitor").test("plug the monitor into the GPU, not the motherboard")).toBe(false);
    expect(stalePattern("Monitor").test("FPS monitoring is on — you're set to measure.")).toBe(false);
  });

  it("actually reaches the trees it claims to scan", () => {
    expect(walk(join("src-tauri", "src"), ".rs").length).toBeGreaterThan(30);
    expect(walk(join("src", "i18n", "locales", "en"), ".json").length).toBeGreaterThan(5);
  });
});

describe("room-name drift — the product speaks the rail's current labels", () => {
  it("every retired name maps to a room the rail still ships", () => {
    // If the owner renames again, this fails first and points at THIS file, so the guard is
    // updated in the same train as the rename instead of quietly grading against a dead map.
    for (const [old, id] of Object.entries(RETIRED)) {
      const label = currentLabel(id);
      expect(label, `"${old}" maps to rail id "${id}"`).not.toBe(old);
    }
  });

  it("no retired room name survives in the English copy the user reads", () => {
    const hits = scan(walk(join("src", "i18n", "locales", "en"), ".json"));
    expect(hits.length, `stale room names in user-facing locale copy:\n${report(hits)}`).toBe(0);
  });

  it("no retired room name survives in Rust string literals", () => {
    // Rust is where this class hides: the backend composes whole sentences for the front door, and
    // no visual review or frontend test ever reads them.
    const rs = walk(join("src-tauri", "src"), ".rs");
    // Comments are not copy — a `//` line explaining the history of a rename is exactly the place
    // the old name SHOULD still appear. Everything else in a .rs file that says a room name is
    // either a string the user reads or an assertion defending one.
    const hits = scan(rs).filter((h) => !h.text.startsWith("//"));
    expect(hits.length, `stale room names in Rust copy:\n${report(hits)}`).toBe(0);
  });
});
