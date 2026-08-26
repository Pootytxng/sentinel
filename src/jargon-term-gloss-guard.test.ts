import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { knowledgeByIdForLanguage } from "./data/knowledge";
// (fs/path typed by src/test-node-shims.d.ts — the sources and the locale files are read off disk,
// like every other drift guard here, so this grades what SHIPS rather than what a bundler resolves.)

// JARGON-LABEL ↔ GLOSSARY GUARD — a bare measurement word is a dead end for the person this
// product is for.
//
// bug → guard, DIR-1 first-timer walk 2026-08-26, finding #5. The walk found "Frametime" and
// "1% low" printing as bare stat labels in Live's FPS box (`monitor-panels.tsx`). The persona
// Compy is built for — a non-technical gamer whose PC just froze — has never seen a frametime
// chart and cannot tell whether a lower number is good or bad, so the label reads as noise and
// there is nothing on screen telling them where to find out. Every OTHER surface that prints
// these two words already wrapped them in <Term> (MonitorConsole, Play, SessionDebrief,
// LogbookTape, TuningVerdict, Benchmark, DeckScope, Health's readout strip and App's monitoring
// panel); that box, and the two failsafe Home surfaces, were the places the glossary had not
// reached. The defect is not the copy — it is that the SAME word is a door in eight places and a
// dead end in three, which is exactly the inconsistency a first-timer reads as "I'm missing
// something".
//
// This guard is deliberately CORPUS-WIDE rather than a pin on the three files that were fixed:
// pinning the offenders would let the eleventh site ship bare tomorrow. It derives its own
// worklist from the shipped English locale, so a NEW label carrying one of these words is graded
// the day it is added, with no allowlist to keep in sync.
//
// SCOPE, stated so the next author does not over-read it: only labels whose whole value IS the
// jargon word are graded. A sentence that merely contains "frametime" is prose, not a label, and
// wrapping a whole sentence in a tooltip trigger would be worse than leaving it alone. Widening
// this to sentences is a product decision, not a guard tweak.

const SRC = "src";
const LOCALES = join(SRC, "i18n", "locales", "en");

// THE ONE STRUCTURAL EXCLUSION, and the fact that earns it.
//
// `src/Overlay.tsx` draws the in-game HUD, in its own Tauri window, and that window is made
// CLICK-THROUGH at runtime (`set_ignore_cursor_events(true)`). The cursor cannot land on it, so a
// hover/focus tooltip there is not merely redundant — it is unreachable, and the "More in the
// Blackbook" link inside it would be a door nobody can open. The overlay is also outside the app
// root's LibraryContext, whose default is a no-op, so that link would do nothing even if it could
// be clicked. A dead tooltip is worse than a bare label, which is why this is an exclusion and not
// an unfixed offender.
//
// The exclusion is PINNED to that fact below rather than taken on trust: if the overlay ever
// becomes interactive, this file fails and its labels have to be glossed like everywhere else.
// That is the whole difference between a reasoned exclusion and an allowlist that rots.
const CLICK_THROUGH_SURFACES = ["Overlay.tsx"];
const CLICK_THROUGH_PROOF = join("src-tauri", "src", "monitoring.rs");

// The measurement words this product prints as standalone labels, and the corpus entry each one
// must point at. Singular/plural both count — "frametimes" is the same word to a reader.
const TERM_FOR: Record<string, string> = {
  "1% low": "one-percent-lows",
  "1% lows": "one-percent-lows",
  frametime: "frametime",
  frametimes: "frametime",
};

/** Flatten one namespace's JSON into the dotted keys `t()` is actually called with. */
function flatten(prefix: string, node: unknown, out: Map<string, string>): void {
  if (typeof node === "string") {
    out.set(prefix, node);
    return;
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    flatten(prefix ? `${prefix}.${k}` : k, v, out);
  }
}

/** Every shipped English string, keyed the way the surfaces ask for it (`monitor.play.…`). */
function englishStrings(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of readdirSync(LOCALES).filter((n) => n.endsWith(".json"))) {
    const ns = file.replace(/\.json$/, "");
    flatten(ns, JSON.parse(readFileSync(join(LOCALES, file), "utf8")), out);
  }
  return out;
}

/** The keys whose ENTIRE value is one of the jargon words → the id they must be glossed with. */
function jargonKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of englishStrings()) {
    const id = TERM_FOR[value.trim().toLowerCase()];
    if (id) out.set(key, id);
  }
  return out;
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      tsxFiles(path, out);
      continue;
    }
    if (!name.endsWith(".tsx")) continue;
    if (name.includes(".test.")) continue;
    if (CLICK_THROUGH_SURFACES.includes(name)) continue;
    out.push(path);
  }
  return out;
}

type Site = { file: string; key: string; id: string; wrapped: boolean };

/**
 * Every place a jargon label is rendered, and whether the glossary wraps it.
 *
 * "Wrapped" is judged on the text immediately BEFORE the call: `<Term id="…">` optionally followed
 * by a `{`. That is the only shape this codebase uses, and checking the neighbourhood rather than
 * the whole line is what makes the check falsifiable — moving the label out of the trigger is a
 * failure even when a <Term> for some other word still sits on the same line.
 */
function callSites(): Site[] {
  const wanted = jargonKeys();
  const sites: Site[] = [];
  for (const file of tsxFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) {
      const key = match[1];
      const id = wanted.get(key);
      if (!id) continue;
      const before = source.slice(Math.max(0, match.index! - 120), match.index!);
      sites.push({ file, key, id, wrapped: new RegExp(`<Term id="${id}">\s*\{?\s*$`).test(before) });
    }
  }
  return sites;
}

describe("jargon labels are glossed, everywhere they are printed", () => {
  it("finds the jargon labels and their call sites — the guard is not vacuous", () => {
    // Both halves must be non-empty or every assertion below passes by finding nothing. The floors
    // are well under today's counts on purpose: this asserts the machinery works, not a headcount
    // that would fail on the next honest rename.
    const keys = jargonKeys();
    expect(keys.size).toBeGreaterThanOrEqual(10);
    expect([...keys.values()]).toContain("one-percent-lows");
    expect([...keys.values()]).toContain("frametime");
    expect(callSites().length).toBeGreaterThanOrEqual(10);
  });

  it("wraps every standalone '1% low' / 'frametime' label in its glossary term", () => {
    const bare = callSites()
      .filter((s) => !s.wrapped)
      .map((s) => `${s.file} — t("${s.key}") needs <Term id="${s.id}">`);
    expect(bare).toEqual([]);
  });

  it("only excuses a surface the cursor physically cannot reach", () => {
    // The exclusion above is only honest while the overlay stays click-through. Reading the Rust
    // that makes it so keeps the excuse and the fact in the same failure: flip one, fail here.
    expect(CLICK_THROUGH_SURFACES).toEqual(["Overlay.tsx"]);
    const rust = readFileSync(CLICK_THROUGH_PROOF, "utf8");
    expect(rust).toMatch(/get_webview_window\("overlay"\)/);
    expect(rust).toMatch(/set_ignore_cursor_events\(true\)/);
  });

  it("points every one of those wrappers at a real term the tooltip can open", () => {
    // <Term> is fail-soft: an unknown id renders its children as plain text, so a typo'd or
    // retired id silently reverts the fix to the exact screen this guard exists to prevent.
    // Nothing on screen would look wrong, and no other test would notice.
    const corpus = knowledgeByIdForLanguage("en");
    for (const id of new Set(Object.values(TERM_FOR))) {
      const entry = corpus.get(id);
      expect(entry, `<Term id="${id}"> resolves to nothing — the tooltip would not render`).toBeTruthy();
      expect(entry!.type, `<Term id="${id}"> is not a term entry — <Term> only glosses terms`).toBe("term");
    }
  });
});
