import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — sources are read from disk, same as
// locale-parity-guard, because vitest resolves .json imports but not a whole-tree source scan.)

// I18N ORPHAN-KEY GUARD — every shipped string must have a consumer.
//
// WHY THIS EXISTS. On 2026-08-10, PR #94's "Crash & Freeze" rename edited
// `lab.lab.readings.blackBoxLabel` and reported it to the owner as a live "latest-readings label".
// It reached no rendered surface. The key's only consumer — `lab-v2-data.ts` — had been deleted
// three days earlier by #78 ("delete five dead room generations"), which swept the COMPONENTS and
// left their STRINGS behind. Both locales still carried the block, tsc was green, vitest was green,
// locale-parity-guard was green (en and zh-CN were in perfect parity — both equally dead), and the
// PR body made a claim about UI that did not exist.
//
// reachability-guard.test.ts pins that every MODULE is reachable from main.tsx. Nothing pinned the
// string layer, so deleting a room silently orphaned its copy. That is this guard's whole law:
//
//   every key in the base locale is referenced by production source, or is named below with a
//   reason and a budget.
//
// WHY IT MATTERS BEYOND TIDINESS. An orphaned key is worse than dead weight — it is a rename target
// that reads as done. Every future copy edit, glossary pass and zh-CN translation spends real effort
// on it and produces nothing a user can see, and each of those edits ships a claim that is false.
//
// DETECTION IS DELIBERATELY LENIENT, because the failure modes are not symmetric. A false "orphan"
// costs someone five minutes of reading. A missed consumer deletes live user-facing copy. So a key
// counts as consumed if its dotted path appears ANYWHERE in production source — inside t(), in a
// const, in a comment, in a data table — or if it sits under a prefix some template literal builds
// at runtime. Three consumption shapes ship in this repo today and all three must pass:
//
//   t("lab.experimentBench.title")                          — literal
//   t(`common.rail.${r.id}`)                                — dynamic suffix
//   const k = (key: string) => `settings.supportEvidence.${key}`   — SupportEvidence.tsx:36
//
// That last one is why prefixes are harvested from every template literal whose static head is a
// dotted path, not only from ones lexically inside a t(...) call. A t()-scoped scan reports all 33
// settings.supportEvidence.* keys as dead, and acting on that would delete a shipped surface's
// entire copy. The `k()` helper is invisible to any scan that insists on seeing t( and a backtick
// in the same expression.
//
// TESTS ARE NOT CONSUMERS, on purpose — same rule as reachability-guard. A string whose only
// remaining mention is a test asserting it renders is production-dead; the test goes with it.
//
// Measured at authoring (2026-08-11, after deleting lab.lab.readings.* and lab.lab.welcome.*):
// 2243 base-locale keys · 2130 consumed · 113 orphans, every one of them fallout from #78's
// generation prune · 48 runtime-built prefixes detected.

const LOCALES_DIR = join("src", "i18n", "locales");
const BASE_LOCALE = "en";

/**
 * Known-orphan debt, by key prefix. `atMost` is a RATCHET, not a target: cleaning keys up passes
 * freely, adding one under an allowed prefix fails. Every entry needs a reason a future reader can
 * act on — "might be useful later" is not one, that is what git history is for.
 *
 * These 113 keys are all fallout from ONE event: 1ab831fb / #78 deleted five unreachable room
 * generations (Lab.tsx, LabV2.tsx, LabBento.tsx, Optimize.tsx, OptimizeV2.tsx) plus CompyHero and
 * the design Gallery, and pruned no locale files. They are listed rather than swept because this
 * guard's scope was the two blocks PR #94 tripped over; sweeping the other seven generations is a
 * copy review (some strings are worth salvaging into the live rooms), not a mechanical delete.
 */
const ALLOWED: Record<string, { atMost: number; reason: string }> = {
  "lab.lab.": {
    atMost: 35,
    reason: "retired Lab.tsx generation, deleted by #78 — strings not swept with it",
  },
  "optimize.optimizeV2.": {
    atMost: 21,
    reason: "retired OptimizeV2.tsx generation, deleted by #78",
  },
  "lab.labV2.": { atMost: 20, reason: "retired LabV2.tsx generation, deleted by #78" },
  "common.gallery.": { atMost: 14, reason: "retired design Gallery, deleted by #78" },
  "optimize.optimize.": { atMost: 8, reason: "retired Optimize.tsx generation, deleted by #78" },
  "lab.labBento.": { atMost: 7, reason: "retired LabBento.tsx generation, deleted by #78" },
  "home.compyHero.": { atMost: 6, reason: "retired CompyHero, deleted by #78" },
  "app.errors.gamingResumeFailedMerged": {
    atMost: 1,
    reason: "merged-room variant of a live toast; its caller was removed with the merged rooms",
  },
  "app.gamingToast.resumedBodyMerged": {
    atMost: 1,
    reason: "merged-room variant of a live toast; its caller was removed with the merged rooms",
  },
};

type Flat = string[];

/** Dotted-path flatten. Only string leaves are keys; a locale file holds no arrays today. */
function flatten(obj: unknown, prefix = "", out: Flat = []): Flat {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.push(key);
  }
  return out;
}

/**
 * Keys as the CODE spells them: i18n/index.ts mounts each file under its basename, so lab.json's
 * `lab.readings.blackBoxLabel` is called as "lab.lab.readings.blackBoxLabel". Getting this prefix
 * wrong makes every lookup miss and the whole app read as dead — the non-vacuity floors below are
 * what catch that.
 */
function baseKeys(): Flat {
  const keys: Flat = [];
  for (const area of readdirSync(join(LOCALES_DIR, BASE_LOCALE)).filter((f) =>
    f.endsWith(".json"),
  )) {
    const ns = area.replace(/\.json$/, "");
    keys.push(...flatten(JSON.parse(readFileSync(join(LOCALES_DIR, BASE_LOCALE, area), "utf8")), ns));
  }
  return keys;
}

/** Production source as one blob. Tests excluded — see TESTS ARE NOT CONSUMERS above. */
function productionSource(): string {
  const files = (readdirSync("src", { recursive: true }) as string[]).filter(
    (p) => /\.tsx?$/.test(p) && !/\.test\./.test(p) && !p.endsWith(".d.ts"),
  );
  return files.map((p) => readFileSync(join("src", p), "utf8")).join("\n");
}

/**
 * Key prefixes assembled at runtime: the static head of any template literal that ends in a dot
 * before its first `${`. Harvested from the whole file, not from inside t(...), so a key-builder
 * helper counts (SupportEvidence.tsx:36 is the shipped example).
 */
function dynamicPrefixes(source: string): string[] {
  return [...new Set([...source.matchAll(/`([\w.-]*\.)\$\{/g)].map((m) => m[1]))].filter(
    // A prefix must name a real namespace segment. Guards against a one-char head forgiving the
    // entire tree if some unrelated template literal happens to start with a dot.
    (p) => p.length >= 5 && p.includes("."),
  );
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** i18next selects x_one/x_other from a t("x", { count }) call, so the plural base is what code spells. */
function callSpelling(key: string): string {
  return key.replace(PLURAL_SUFFIX, "");
}

function isConsumed(key: string, source: string, prefixes: string[]): boolean {
  if (source.includes(key) || source.includes(callSpelling(key))) return true;
  return prefixes.some((p) => key.startsWith(p));
}

function orphans(): string[] {
  const source = productionSource();
  const prefixes = dynamicPrefixes(source);
  return baseKeys().filter((k) => !isConsumed(k, source, prefixes));
}

describe("i18n orphan keys: every shipped string reaches a surface", () => {
  const source = productionSource();
  const prefixes = dynamicPrefixes(source);
  const keys = baseKeys();

  it("reads the whole string tree and the whole frontend (guard is not vacuous)", () => {
    expect(keys.length).toBeGreaterThanOrEqual(2000);
    expect(source.length).toBeGreaterThanOrEqual(500_000);
    expect(prefixes.length).toBeGreaterThanOrEqual(40);
    // If the namespace prefix were wrong, or the source scan empty, nearly everything would read
    // as orphaned. This floor is the tripwire for both.
    expect(keys.filter((k) => isConsumed(k, source, prefixes)).length).toBeGreaterThanOrEqual(2000);
  });

  it("counts all three shipped consumption shapes as live", () => {
    // literal
    expect(isConsumed("lab.experimentBench.title", source, prefixes)).toBe(true);
    // dynamic suffix — t(`common.rail.${r.id}`) in App.tsx
    expect(prefixes).toContain("common.rail.");
    // key-builder helper — SupportEvidence.tsx:36. The regression this leniency exists to prevent:
    // a t()-scoped scan calls all 33 of these dead and "cleaning up" deletes a live surface's copy.
    expect(prefixes).toContain("settings.supportEvidence.");
    expect(
      keys.filter((k) => k.startsWith("settings.supportEvidence.")).length,
    ).toBeGreaterThanOrEqual(20);
    expect(
      keys
        .filter((k) => k.startsWith("settings.supportEvidence."))
        .every((k) => isConsumed(k, source, prefixes)),
    ).toBe(true);
  });

  it("detects a key no surface references (disarm proof)", () => {
    // Synthesised in memory — nothing read from or written to disk. This is the exact shape of the
    // shipped defect: a plausible key under a namespace that has live siblings.
    expect(isConsumed("lab.lab.readings.blackBoxLabel", "const x = 1;", [])).toBe(false);
    expect(isConsumed("lab.experimentBench.title", "const x = 1;", [])).toBe(false);
    // ...and a plural is graded against the base key the code actually calls.
    expect(isConsumed("x.thing_other", 't("x.thing", { count })', [])).toBe(true);
  });

  it("no orphaned key outside the named debt", () => {
    const unexplained = orphans().filter((k) => !Object.keys(ALLOWED).some((p) => k.startsWith(p)));
    expect(unexplained).toEqual([]);
  });

  it("the named debt only shrinks (ratchet)", () => {
    const found = orphans();
    const over: string[] = [];
    for (const [prefix, { atMost, reason }] of Object.entries(ALLOWED)) {
      const n = found.filter((k) => k.startsWith(prefix)).length;
      if (n > atMost) over.push(`${prefix} has ${n} orphans, budget ${atMost} (${reason})`);
    }
    expect(over).toEqual([]);
    // Total budget, so a cleanup that lands must lower a number here rather than bank the slack.
    expect(found.length).toBeLessThanOrEqual(113);
  });

  it("PR #94's two blocks stay deleted", () => {
    // The specific defect, pinned specifically: these had no consumer and were renamed anyway.
    const lab = readFileSync(join(LOCALES_DIR, BASE_LOCALE, "lab.json"), "utf8");
    const zh = readFileSync(join(LOCALES_DIR, "zh-CN", "lab.json"), "utf8");
    for (const text of [lab, zh]) {
      const inner = JSON.parse(text).lab as Record<string, unknown>;
      expect(inner.readings).toBeUndefined();
      expect(inner.welcome).toBeUndefined();
    }
  });
});
