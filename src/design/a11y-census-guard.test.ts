import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import census from "./a11y-census.baseline.json";

// C-13's third piece, and the one that makes the other two stay true.
//
// A roster of axe checks is a snapshot: it covers what someone remembered to add on the day. The
// failure mode is silent and certain — a component lands next month, nobody adds it, and the suite
// still reports green while coverage quietly shrinks as a fraction of the app. The 2026-08-11
// tooling ask went un-done for a week for the same reason nothing was watching it.
//
// So coverage is data, not memory. Every component under src/design is either mounted in an axe
// guard or carries a NAMED reason it is not, and this file fails the build on any gap between the
// census and what the guards actually import. "Rostered" is verified against the real import list —
// a census entry cannot claim coverage a guard file does not have.
//
// Same tier and same shape as mono-census.baseline.json.

const DESIGN = join("src", "design");
const GUARD_FILES = [
  join(DESIGN, "a11y-axe-guard.test.tsx"),
  join(DESIGN, "a11y-axe-shell.test.tsx"),
] as const;

/** Repo-relative and forward-slash — the census is checked in and must read the same on every OS. */
const norm = (p: string) => p.split("\\").join("/");

/** Every non-test component file under src/design. */
function componentFiles(dir = DESIGN): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...componentFiles(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(norm(full));
  }
  return out;
}

/** The `src/design/...` modules a guard file imports, resolved from its relative specifiers. */
function importedComponents(guardFile: string): Set<string> {
  const src = readFileSync(guardFile, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
    // Guard files live IN src/design, so "./x" and "./a/b" resolve under it; "../x" leaves it.
    const spec = m[1];
    if (!spec.startsWith("./")) continue;
    found.add(`src/design/${spec.slice(2)}.tsx`);
  }
  return found;
}

const FILES = componentFiles().sort();
const ENTRIES = Object.entries(census.components) as Array<[string, string]>;
const BUCKET_OF = (v: string) => v.split(":")[0];

describe("a11y census — every src/design component is rostered or has a named reason", () => {
  it("censuses every component file that exists", () => {
    const missing = FILES.filter((f) => !(f in census.components));
    expect(
      missing,
      "New component(s) under src/design with no accessibility disposition. Add a case to " +
        "a11y-axe-guard.test.tsx (or a11y-axe-shell.test.tsx if it needs Tauri mocked) and mark it " +
        "'rostered' / 'rostered:shell' — or, if it genuinely cannot be checked, record WHY with a " +
        "'no-dom:', 'aria-hidden:' or 'unrostered:' reason. A component with no disposition is the " +
        "one this guard exists to stop.",
    ).toEqual([]);
  });

  it("censuses nothing that has been deleted or renamed", () => {
    const ghosts = ENTRIES.map(([f]) => f).filter((f) => !existsSync(f));
    expect(ghosts, "Census entries for files that no longer exist — drop the rows.").toEqual([]);
  });

  it("only calls a component rostered when a guard file actually mounts it", () => {
    const imported = {
      rostered: importedComponents(GUARD_FILES[0]),
      "rostered:shell": importedComponents(GUARD_FILES[1]),
    };
    const unproven = ENTRIES.filter(
      ([file, bucket]) => bucket in imported && !imported[bucket as keyof typeof imported].has(file),
    ).map(([file, bucket]) => `${file} (claims ${bucket})`);
    expect(
      unproven,
      "Census claims coverage that the guard file does not import. Either add the mount or change " +
        "the disposition — a coverage claim nobody checks is exactly the state C-13 was filed for.",
    ).toEqual([]);
  });

  it("makes every non-rostered disposition give its reason", () => {
    const bare = ENTRIES.filter(
      ([, v]) => !v.startsWith("rostered") && v.slice(v.indexOf(":") + 1).trim().length < 10,
    ).map(([f, v]) => `${f} → "${v}"`);
    expect(bare, "A bucket with no reason after the colon is a TODO wearing a category.").toEqual([]);
  });

  it("keeps recorded a11y debt at or below its ceiling", () => {
    const unrostered = ENTRIES.filter(([, v]) => BUCKET_OF(v) === "unrostered").map(([f]) => f);
    expect(
      unrostered.length,
      `Unrostered components: ${unrostered.join(", ")}. The ceiling only ever moves DOWN — ` +
        "raising it to land a component is how a guard becomes decoration.",
    ).toBeLessThanOrEqual(census.unrosteredCeiling);
  });

  it("uses only the documented buckets", () => {
    const KNOWN = new Set(["rostered", "no-dom", "aria-hidden", "unrostered"]);
    const strays = ENTRIES.filter(([, v]) => !KNOWN.has(BUCKET_OF(v))).map(([f, v]) => `${f} → ${v}`);
    expect(strays, "Unknown bucket — document it in the census note before using it.").toEqual([]);
  });
});
