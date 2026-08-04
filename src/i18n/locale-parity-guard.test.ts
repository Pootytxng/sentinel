import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — see sweep-guard for why sources are read from disk.)

// LOCALE PARITY GUARD — two laws, both mechanical.
//
//   LAW 1 (key parity): every en key exists in every other locale, EXCEPT plural variants that
//   locale's grammar has no category for.
//   LAW 2 (no raw braces): every {{var}} written in any locale must be supplied by the code at
//   that key's call sites, or i18next renders the braces literally to the user.
//
// Written 2026-08-04, closing a gap BACKLOG named against itself: parity had been "spot-checked
// on the Trust-Ledger strings and the network-check line — not a full line-by-line diff."
//
// The full diff, once run, showed why a hand-check was never going to settle it. It reports 59
// en keys absent from zh-CN — and all 59 are correct. They end in `_one`, i18next's plural
// suffix, and Chinese has no `one` category: nouns do not inflect for number. A guard demanding
// raw key equality would not be strict, it would be WRONG — it would demand 59 keys that must
// not exist, and the only way to silence it would be to fabricate Chinese plurals. So Law 1
// derives each locale's categories from Intl.PluralRules — the same founding property as
// flag-default-drift-guard: the runtime's own answer, never a table someone maintains by hand.
//
// LAW 2 is the defect the count had been hiding. monitor.json's regression debrief is one
// sentence split into five keys so two spans can carry <Term> glossary links. English trails the
// game name ("… dropped past the noise floor in Valorant"); Chinese leads with it ("你在 Valorant
// 中的 1% 最低帧跌破了…"). Both are correct prose. But SessionDebrief.tsx passed { game } to the
// Post segment ONLY, so in Chinese the variable landed in a segment the code never fed, and
// i18next — which leaves an unsupplied placeholder untouched rather than blanking it (proven at
// runtime, i18next 26.3.6) — rendered "你在 {{game}} 中的" verbatim to the user.
//
// That class is invisible to every check the repo already had: the key exists, its type is fine,
// tsc and vitest are green, and the English screenshot a self-review captures is perfect. Only a
// zh-CN reader ever sees it. Hence the guard, not a rubric line (bug → guard, automated tier).
//
// SCOPE, stated so it cannot be misread as broader than it is:
//   • LAW 2 grades a key only where a STATIC t("literal") call site exists. Keys assembled at
//     runtime (t(`prefix.${id}`)) supply no literal to scan and are skipped — the floors below
//     pin how many really get graded, so a refactor that hides the call sites fails loudly
//     instead of passing on zero work.
//   • Variables are unioned across a key's call sites. Two sites passing different bags grade
//     against the union, which is optimistic; no key in the tree does this today.
//   • A `_one`/`_other` locale key is graded against its BASE key's call site, because that is
//     what the code calls — t("x", { count }) selects the variant, so the bag belongs to "x".
//   • Only translation VALUES are read. Nothing here checks that a translation is accurate; that
//     is zh-cn-verdict-vocabulary-guard's job for the verdict vocabulary.
//
// Measured at authoring (2026-08-04): 9 file pairs · 2234 en keys · 2175 zh-CN · the 59-key
// difference is entirely `_one` variants Chinese has no category for · 0 extra keys · 701 of 733
// var-bearing strings graded · 1 real placeholder defect, since fixed in SessionDebrief.tsx.

const LOCALES_DIR = join("src", "i18n", "locales");
const BASE_LOCALE = "en";
/** Quotes drifted strings for its own disarm proof — scanning it would self-trip. */
const SELF = "locale-parity-guard.test.ts";

type Flat = Map<string, string>;

/** Dotted-path flatten. Only string leaves matter — a locale file holds no arrays today. */
function flatten(obj: unknown, prefix = "", out: Flat = new Map()): Flat {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

function localeNames(): string[] {
  return readdirSync(LOCALES_DIR).filter((d) => statSync(join(LOCALES_DIR, d)).isDirectory());
}

function areaFiles(): string[] {
  return readdirSync(join(LOCALES_DIR, BASE_LOCALE)).filter((f) => f.endsWith(".json"));
}

/**
 * Keys as the CODE spells them. i18n/index.ts mounts each file under its basename
 * (`monitor: enMonitor`), so monitor.json's `sessionDebrief.regressedSubPost` is called as
 * "monitor.sessionDebrief.regressedSubPost" — the prefix is what makes Law 2's call-site
 * lookup line up at all.
 */
function read(locale: string, area: string): Flat {
  const ns = area.replace(/\.json$/, "");
  return flatten(JSON.parse(readFileSync(join(LOCALES_DIR, locale, area), "utf8")), ns);
}

/**
 * The plural categories a locale's grammar actually has, from the runtime's CLDR data.
 * en → {one, other} · zh-CN → {other}. i18next's key suffixes are exactly these names.
 */
function categoriesOf(locale: string): Set<string> {
  return new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * Split a key into base + plural category — but ONLY when it is really a plural. A key may end in
 * "_one" and mean it literally (a phase named one), so the proof is a sibling `_other` in the same
 * file: i18next always emits `_other` for every plural, in every locale.
 */
function asPlural(key: string, siblings: Flat): { base: string; category: string } | null {
  const m = PLURAL_SUFFIX.exec(key);
  if (!m) return null;
  const base = key.slice(0, m.index);
  return siblings.has(`${base}_other`) ? { base, category: m[1] } : null;
}

/** Interpolation names in a string: {{game}}, {{count}}, {{- raw}}, {{n, number}}. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*-?\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
}

/**
 * Every variable the code supplies, per translation key, unioned over call sites.
 *
 * A regex cannot read the options object — `{ game: prettyGameName(r.game) }` and any nested
 * literal defeat `\{[^}]*\}` — so the object is brace-matched from the source text and split at
 * depth 0, then each part's leading identifier is the supplied name.
 */
function suppliedVars(): Map<string, Set<string>> {
  const supplied = new Map<string, Set<string>>();

  // Recursive readdir over the whole frontend. Tests are excluded so a guard quoting a drifted
  // string (this file does, for its own disarm proof) can never be mistaken for a call site.
  const sources = readdirSync("src", { recursive: true })
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\./.test(p) && !p.endsWith(".d.ts"))
    .map((p) => join("src", p));

  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bt\(\s*"([\w.\-]+)"/g)) {
      const key = m[1];
      if (!supplied.has(key)) supplied.set(key, new Set());
      let i = m.index! + m[0].length;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== ",") continue; // t("key") — no options object
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== "{") continue; // t("key", someVariable) — not statically readable

      let depth = 0;
      let end = i;
      for (; end < text.length; end++) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}" && --depth === 0) break;
      }

      let nest = 0;
      let part = "";
      const parts: string[] = [];
      for (const c of text.slice(i + 1, end)) {
        if ("{[(".includes(c)) nest++;
        else if ("}])".includes(c)) nest--;
        if (c === "," && nest === 0) {
          parts.push(part);
          part = "";
        } else part += c;
      }
      parts.push(part);

      for (const p of parts) {
        const name = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(p);
        if (name) supplied.get(key)!.add(name[1]);
      }
    }
  }
  return supplied;
}

type Missing = { locale: string; area: string; key: string };

/** LAW 1: keys required of `locale`, minus plural variants its grammar has no category for. */
function missingKeys(locales: string[]): Missing[] {
  const gaps: Missing[] = [];
  for (const area of areaFiles()) {
    const base = read(BASE_LOCALE, area);
    for (const locale of locales) {
      if (locale === BASE_LOCALE) continue;
      const target = read(locale, area);
      const cats = categoriesOf(locale);
      for (const key of base.keys()) {
        if (target.has(key)) continue;
        const plural = asPlural(key, base);
        if (plural && !cats.has(plural.category)) continue; // grammatically absent, not missing
        gaps.push({ locale, area, key });
      }
    }
  }
  return gaps;
}

/** Keys a locale has that the base does not — always drift; nothing legitimises an extra key. */
function extraKeys(locales: string[]): Missing[] {
  const extras: Missing[] = [];
  for (const area of areaFiles()) {
    const base = read(BASE_LOCALE, area);
    for (const locale of locales) {
      if (locale === BASE_LOCALE) continue;
      for (const key of read(locale, area).keys()) {
        if (!base.has(key)) extras.push({ locale, area, key });
      }
    }
  }
  return extras;
}

type Raw = { locale: string; area: string; key: string; variable: string };

/** LAW 2: a placeholder no call site feeds. Returns the graded count so vacuity is provable. */
function rawBraceRisks(
  locales: string[],
  supplied: Map<string, Set<string>>,
): { offenders: Raw[]; graded: number } {
  const offenders: Raw[] = [];
  let graded = 0;

  for (const area of areaFiles()) {
    for (const locale of locales) {
      const strings = read(locale, area);
      for (const [key, value] of strings) {
        const vars = placeholders(value);
        if (!vars.length) continue;
        // t("x", { count }) selects x_one/x_other — the bag is registered against the base key.
        const plural = asPlural(key, strings);
        const callKey = plural ? plural.base : key;
        const bag = supplied.get(callKey);
        if (!bag) continue; // no static call site — ungraded, see SCOPE
        graded++;
        for (const v of vars) {
          if (!bag.has(v)) offenders.push({ locale, area, key, variable: v });
        }
      }
    }
  }
  return { offenders, graded };
}

describe("locale parity: no missing string, no raw {{braces}} in any language", () => {
  const locales = localeNames();
  const supplied = suppliedVars();

  it("reads every locale and area actually shipped (guard is not vacuous)", () => {
    expect(locales).toContain(BASE_LOCALE);
    expect(locales).toContain("zh-CN");
    expect(areaFiles().length).toBeGreaterThanOrEqual(9);
    // i18n/index.ts imports each area for each locale — a file present here but unimported would
    // be graded and never rendered, so pin that the two sets are the same size.
    const imports = readFileSync(join("src", "i18n", "index.ts"), "utf8");
    for (const area of areaFiles()) {
      expect(imports).toContain(`/${area}"`);
    }
    expect(read(BASE_LOCALE, "monitor.json").size).toBeGreaterThan(100);
  });

  it("derives plural categories from the runtime, not a hand-kept table", () => {
    expect([...categoriesOf("en")].sort()).toEqual(["one", "other"]);
    // The whole reason Law 1 cannot be raw key equality: Chinese nouns do not inflect for number.
    expect([...categoriesOf("zh-CN")]).toEqual(["other"]);
  });

  it("finds the call-site variables the code passes (guard is not vacuous)", () => {
    expect(supplied.size).toBeGreaterThanOrEqual(1500);
    expect([...supplied.values()].filter((s) => s.size).length).toBeGreaterThanOrEqual(300);
    // Brace matching, not a naive regex: this call's value contains a nested function call.
    expect(supplied.get("monitor.sessionDebrief.regressedSubPost")).toContain("game");
  });

  it("every en key exists in every locale that has grammar for it", () => {
    const gaps = missingKeys(locales).map((g) => `${g.locale}/${g.area}: ${g.key}`);
    expect(gaps).toEqual([]);
  });

  it("no locale carries a key the base locale does not", () => {
    const extras = extraKeys(locales).map((g) => `${g.locale}/${g.area}: ${g.key}`);
    expect(extras).toEqual([]);
  });

  it("detects a plural that is genuinely missing, not merely absent (disarm proof)", () => {
    // Synthesised: zh-CN HAS an `other` category, so an absent `_other` is real drift and must
    // trip — proving the plural exemption forgives only what the grammar forbids.
    const base: Flat = new Map([
      ["x_one", "1 thing"],
      ["x_other", "{{count}} things"],
    ]);
    expect(asPlural("x_one", base)).toEqual({ base: "x", category: "one" });
    expect(categoriesOf("zh-CN").has("one")).toBe(false); // forgiven
    expect(categoriesOf("zh-CN").has("other")).toBe(true); // NOT forgiven
    // And a key that merely ends in _one without an _other sibling is not a plural at all.
    expect(asPlural("phase_one", new Map([["phase_one", "Phase one"]]))).toBeNull();
  });

  it("detects a placeholder the code never supplies (disarm proof)", () => {
    // The exact shape of the shipped defect: a locale moves {{game}} into a segment whose call
    // site passes nothing. Synthesised in memory — nothing is read from or written to disk.
    expect(placeholders("你在 {{game}} 中的 ")).toEqual(["game"]);
    expect(placeholders("{{n, number}} of {{- total}}")).toEqual(["n", "total"]);
    const bag = new Set(["pct"]);
    expect(placeholders("你在 {{game}} 中的 ").filter((v) => !bag.has(v))).toEqual(["game"]);
  });

  it("no locale writes a placeholder its call site never passes", () => {
    const { offenders, graded } = rawBraceRisks(locales, supplied);
    // Non-vacuity, and the honest coverage number: 733 strings across both locales carry a
    // {{var}}; 701 of them have a static call site to grade against. The floor sits just under
    // that, so gutting the call sites — or breaking the scanner — fails here instead of quietly
    // grading nothing. (This is exactly how the first draft caught itself: the namespace prefix
    // was missing, every lookup missed, and graded came back 0.)
    expect(graded).toBeGreaterThanOrEqual(650);
    expect(
      offenders.map((o) => `${o.locale}/${o.area}: ${o.key} uses {{${o.variable}}}, never passed`),
    ).toEqual([]);
  });

  it("keeps its own quoted strings out of the scan", () => {
    expect(readdirSync(join("src", "i18n")).some((f) => f.endsWith(SELF))).toBe(true);
  });
});
