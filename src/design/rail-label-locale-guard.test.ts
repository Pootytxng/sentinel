import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { HOME_RAIL, railFor } from "./homeRail";
// (fs/path typed by src/test-node-shims.d.ts — the locale files are read off disk, like every other
// state-drift guard here, so this grades what SHIPS rather than what a bundler resolves to.)

// RAIL-LABEL ↔ LOCALE DRIFT GUARD — the rail's English literal and the string the user actually
// reads must be the same word.
//
// Written 2026-08-19 during the Home → Health rename (owner decision, UX-1 ① third clause), because
// the rename found this hole with the fix half-applied: `HOME_RAIL[0].label` is NOT what the app
// prints. `ShellV2` renders `t("common.rail." + item.id)` (ShellV2.tsx:94) and `App.tsx` re-derives
// the Home dock's door names the same way (App.tsx:1447), so the shipped label lives in
// `src/i18n/locales/en/common.json`. Renaming only `homeRail.ts` would have left every rail button,
// topbar title and palette row still saying "Home" — with `homeRail.test.ts` green, because it
// asserts the literal the app does not use.
//
// This is the same class as `room-name-copy-guard.test.ts` (the product speaking a retired name)
// caught one layer earlier: there, the rail was renamed and the sentences pointing at it were not;
// here, the source of the name and the name itself disagree.
//
// SCOPE: the rail namespace only. Ids/nav keys are deliberately not graded — `id: "home"` is a
// persisted key the owner never sees, which is the project's standing split (see homeRail.ts).

type RailTable = Record<string, string>;

const LOCALES = join("src", "i18n", "locales");

function railTable(locale: string): RailTable {
  const raw = readFileSync(join(LOCALES, locale, "common.json"), "utf8");
  const rail = JSON.parse(raw).rail;
  if (!rail || typeof rail !== "object") throw new Error(`${locale}/common.json has no "rail" table`);
  return rail as RailTable;
}

function locales(): string[] {
  return readdirSync(LOCALES).filter((name) => !name.includes("."));
}

/** The check itself, as a pure function so the disarm proof below can run it on a seeded tree. */
function mismatches(rail: { id: string; label: string }[], table: RailTable): string[] {
  return rail
    .filter((r) => table[r.id] !== r.label)
    .map((r) => `common.rail.${r.id} is "${table[r.id] ?? "(missing)"}", the rail says "${r.label}"`);
}

describe("the rail's English literal is the string the app prints", () => {
  it("every rail room's en locale value equals its HOME_RAIL label", () => {
    const bad = mismatches(HOME_RAIL, railTable("en"));
    expect(bad.length, `rail label / locale drift:\n  ${bad.join("\n  ")}`).toBe(0);
  });

  it("the merged rail's one relabelled room is covered too", () => {
    // railFor(true) renames `fix` to "Optimize" in place; ShellV2 special-cases that label to
    // `common.rail.optimize` (ShellV2.tsx:94), so it is a real shipped string with no rail row.
    const optimize = railFor(true).find((r) => r.label === "Optimize");
    expect(optimize, "the merged rail no longer relabels a room to Optimize — update this guard").toBeTruthy();
    expect(railTable("en").optimize).toBe("Optimize");
  });

  it("every other locale translates exactly the same rooms — no key falls back to English silently", () => {
    const en = Object.keys(railTable("en")).sort();
    for (const locale of locales().filter((l) => l !== "en")) {
      expect(Object.keys(railTable(locale)).sort(), `${locale} rail keys`).toEqual(en);
      for (const [id, value] of Object.entries(railTable(locale))) {
        expect(String(value).trim().length, `${locale}.rail.${id} is empty`).toBeGreaterThan(0);
      }
    }
  });
});

// DISARM PROOF — a guard that reads the wrong file, or a comparison that can no longer fail,
// reports "clean" over a broken tree. Both halves are proven here rather than assumed.
describe("the guard can still see (disarm proof)", () => {
  it("flags the exact drift this file exists to catch", () => {
    // The half-applied rename: the rail says Health, the locale still says Home.
    const stale = { ...railTable("en"), home: "Home" };
    expect(mismatches(HOME_RAIL, stale)).toHaveLength(1);
    expect(mismatches(HOME_RAIL, stale)[0]).toContain("Health");
    // A missing key is drift too, not a pass.
    const gone = { ...railTable("en") };
    delete gone.home;
    expect(mismatches(HOME_RAIL, gone)[0]).toContain("(missing)");
  });

  it("actually reaches the locale trees it claims to read", () => {
    expect(locales()).toContain("en");
    expect(locales().length).toBeGreaterThan(1);
    expect(Object.keys(railTable("en")).length).toBeGreaterThanOrEqual(HOME_RAIL.length);
  });
});
