import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";

// ── CONTROL-FONT GUARD (bug→guard, owner-caught 2026-08-20) ──────────────────────────────────
//
// THE BUG: the session-debrief **Share** button computed to bare `"Arial"` on installed
// `402b0080` while every sibling was Geist Sans. `.btn-small` (App.css) declares `font-size` and
// `font-weight` and NO `font-family`; so does `.debrief-ctx-head`, a <button> styled as a header
// row. Form controls do NOT inherit the page font — the UA stylesheet pins them to its own face
// (Arial on Windows) — so any button rule that never names a family falls through to it.
//
// THE REAL DEFECT IS THE IDIOM, NOT THE SELECTOR. The repo's fix for this has always been a
// per-rule `font: inherit` / `font-family: inherit`, applied ad hoc (88 such declarations across
// the sheets). Ad hoc means forgettable: measured at the time this guard was written, **97 of 290
// <button> call sites across 28 files** got a family from no rule at all — 3x what the original
// `.btn-small` finding counted. So the fix is ONE unscoped element reset, and this guard exists to
// keep that reset in place rather than to police 28 individual selectors.
//
// WHAT THIS GUARD CANNOT DO: it does not resolve the cascade, media queries, or dynamic
// classNames, and it cannot see what a font actually *renders* as. The computed-style proof
// belongs to the `self-review` skill. What it locks down is structural and exact:
//   (1) the reset exists, is UNSCOPED, and lives in a sheet the app actually loads;
//   (2) `inherit` has an app face to land on (the html/body base names one);
//   (3) no <button> in the tree is left with no family from anything — the class-level check.

const SEP = String.fromCharCode(92);
const norm = (p: string) => p.split(SEP).join("/");

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

/** Files reachable from the one document entry (index.html → src/main.tsx) by relative import. */
function entryClosure(): Set<string> {
  const seen = new Set<string>();
  const resolveImport = (from: string, spec: string): string | null => {
    if (!spec.startsWith(".")) return null; // bare package — nothing of ours downstream
    const base = join(dirname(from), spec);
    for (const cand of [base, base + ".tsx", base + ".ts", base + ".css", join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(cand) && statSync(cand).isFile()) return norm(cand);
    }
    return null;
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith(".css")) return; // CSS @import is not used in this tree
    const src = readFileSync(file, "utf8");
    // TWO patterns on purpose. One combined pattern with an optional `… from` arm swallows
    // side-effect imports: the lazy arm happily spans forward to the NEXT `from`, so
    // `import "./App.css";` disappeared into a later match and the closure came back without
    // the app's own base stylesheet (caught while writing this guard).
    const specs = [
      ...[...src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];
    for (const spec of specs) {
      const next = resolveImport(file, spec);
      if (next) visit(next);
    }
  };
  visit(norm(join("src", "main.tsx")));
  return seen;
}

type Rule = { file: string; sel: string; body: string; topLevel: boolean };

function rulesOf(file: string): Rule[] {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // This flat parser cannot SEE an at-rule wrapper — a rule inside `@media …{}` reads exactly
    // like a top-level one — so measure the brace depth at the match instead. A reset parked in a
    // media/supports block is conditional, which for a base reset is the bug wearing a hat.
    const before = src.slice(0, m.index ?? 0);
    const depth = (before.split("{").length - 1) - (before.split("}").length - 1);
    out.push({
      file: norm(file),
      sel: m[1].trim().replace(/\s+/g, " "),
      body: m[2],
      topLevel: depth === 0,
    });
  }
  return out;
}

const FAMILY = /(^|;)\s*font-family\s*:/;
const SHORTHAND = /(^|;)\s*font\s*:/; // `font: inherit` carries the family too
const INHERITS = /(?:^|;)\s*font(?:-family)?\s*:\s*inherit\s*(?:;|$)/;

const CLOSURE = entryClosure();
const LOADED_CSS = [...CLOSURE].filter((f) => f.endsWith(".css"));
const APP_CSS = norm(join("src", "App.css"));

/** The reset: a rule whose selector list carries a BARE `button` compound and inherits the family. */
function resetRules(): Rule[] {
  return LOADED_CSS.flatMap(rulesOf).filter(
    (r) =>
      INHERITS.test(r.body) &&
      r.sel
        .split(",")
        .map((s) => s.trim())
        .some((s) => s === "button"),
  );
}

describe("control-font reset", () => {
  it("keeps ONE unscoped `button` family reset, in a stylesheet the app loads", () => {
    const resets = resetRules();
    expect(
      resets.map((r) => `${r.file} :: ${r.sel}`),
      "form controls fall through to the UA font (Arial on Windows) unless an author rule names a " +
        "family. Restore the unscoped `button, input, select, textarea { font-family: inherit }` " +
        "reset in src/App.css — do NOT go back to per-rule `font: inherit`, which is how 97 " +
        "buttons got missed.",
    ).not.toEqual([]);
    expect(
      resets.some((r) => r.file === APP_CSS),
      "the reset must live in src/App.css (the base layer every window loads), not in a skin " +
        "stylesheet that a flag can switch off",
    ).toBe(true);
    expect(
      resets.filter((r) => r.file === APP_CSS).some((r) => r.topLevel),
      "the reset sits inside an at-rule (@media/@supports), so it applies only under that " +
        "condition — outside it every button goes back to the UA font",
    ).toBe(true);
    // Scoping it (`.v2-shell button`, `[data-hud="on"] button`) silently un-covers every button
    // outside that subtree — the exact shape of the original bug, one level up.
    for (const r of resets) {
      const scoped = r.sel
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.includes("button") && s !== "button");
      expect(
        scoped,
        "a scoped reset (`.v2-shell button`, `[data-hud=\"on\"] button`) leaves every button " +
          "outside that subtree on the UA font — the original bug, one level up",
      ).toEqual([]);
    }
  });

  it("gives `inherit` an app face to land on (html/body names the UI font)", () => {
    const base = rulesOf(APP_CSS).find(
      (r) => /(^|,)\s*(html|body)\b/.test(r.sel) && FAMILY.test(r.body) && !INHERITS.test(r.body),
    );
    expect(
      base && base.sel,
      "`font-family: inherit` on a control resolves to its ancestors — if html/body names no " +
        "family, the reset inherits nothing and the controls land back on the UA font",
    ).toBeTruthy();
  });
});

// ── THE CLASS-LEVEL CHECK ────────────────────────────────────────────────────────────────────
// A rule that styles a <button> with `font-size`/`font-weight` and no family is only harmless
// BECAUSE the reset above covers it. So the assertion is written on the real subject — the button
// — not on the rule: every <button> in the tree must get a family from something. Delete or narrow
// the reset and this fails naming every call site it just un-covered.
describe("every <button> gets an app font face", () => {
  /** Classes that some LOADED rule gives an explicit family (subject compound only). */
  function familyClasses(): Set<string> {
    const out = new Set<string>();
    for (const r of LOADED_CSS.flatMap(rulesOf)) {
      if (!(FAMILY.test(r.body) || SHORTHAND.test(r.body))) continue;
      for (const sel of r.sel.split(",").map((s) => s.trim()).filter(Boolean)) {
        const subject = sel.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
        for (const c of subject.matchAll(/\.([A-Za-z0-9_-]+)/g)) out.add(c[1]);
      }
    }
    return out;
  }

  function buttonSites(): { file: string; cls: string }[] {
    const sites: { file: string; cls: string }[] = [];
    for (const f of walkFiles("src")) {
      if (!f.endsWith(".tsx") || f.endsWith(".test.tsx")) continue;
      const src = readFileSync(f, "utf8");
      for (const tag of src.matchAll(/<button\b[\s\S]{0,800}?>/g)) {
        const tokens = new Set<string>();
        for (const c of tag[0].matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
          for (const t of (c[1] ?? c[2] ?? "").split(/[^A-Za-z0-9_-]+/)) if (t) tokens.add(t);
        }
        sites.push({ file: norm(f), cls: [...tokens].join(" ") || "(no className)" });
      }
    }
    return sites;
  }

  it("leaves no button on the UA default font", () => {
    const covered = resetRules().length > 0;
    const fam = familyClasses();
    const orphans = covered
      ? []
      : buttonSites()
          .filter((s) => !s.cls.split(" ").some((t) => fam.has(t)))
          .map((s) => `${s.file}  <button class="${s.cls}">`);
    expect(
      orphans,
      "these buttons get a family from no rule at all, so Windows renders them in Arial beside " +
        "their Geist siblings. Restore the reset in src/App.css rather than patching them one by one.",
    ).toEqual([]);
  });

  it("still finds buttons to protect (the census cannot silently read zero)", () => {
    // The first draft of the sibling census in button-legibility-guard.test.ts silently matched
    // nothing and passed. A census that finds no subjects is a broken census, not a clean repo.
    expect(buttonSites().length).toBeGreaterThan(100);
  });
});
