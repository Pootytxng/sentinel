import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// ERROR-STYLING GUARD (2026-08-25).
//
// THE DEFECT. The Q9a receipts consent tile rendered both of its failure messages -- a refused
// consent write ("Access is denied. (os error 5)") and a refused preview -- in `receipts-hint`,
// the SAME class as the tile's ordinary calm copy two elements above. Measured on the live
// surface, the error text computed to rgb(184,188,200) at weight 400: perfectly legible, and
// indistinguishable from an explanation. A user whose sharing switch silently failed to save
// would read the failure as a footnote. Caught by the self-review rubric (contrast), which is the
// weaker tier -- so it becomes a test.
//
// THE RULE, and why it is drawn exactly here. Not "errors must be red": `LedgerHealthNotice` puts
// its failure detail in a deliberately QUIET class inside a box already marked as a warning, and
// its own comment says so ("Quieter than the body: it is evidence, not the explanation"). That is
// a considered decision, not this defect. What made the receipts tile wrong was narrower and
// mechanical: inside ONE component, the error render wore the exact class list that ordinary
// non-error text in that same component wears. Nothing distinguished them, so nothing could.
//
// A class used only for errors (`bench-err`, `ledger-health-detail`) passes. A class shared with
// calm copy fails, and the fix is one extra class -- which is precisely what shipped.

const SRC = "src";

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** `<p className="a b">{expr}</p>` -- a literal class list wrapping exactly one expression. */
const RENDER = /<[a-zA-Z][a-zA-Z0-9]*\s+className="([^"{}]*)"\s*>\s*\{([^{}]+)\}\s*<\/[a-zA-Z][a-zA-Z0-9]*>/g;

/**
 * Does this expression render an ERROR? Split the identifier chain into words and look for one
 * that STARTS with "err" -- so `consentErr`, `state.error` and `save_error` count while `terror`
 * and `ferry` do not. Anything with a call or an operator in it is skipped: the guard reasons
 * about plain reads, not about what a function might return.
 */
export function rendersError(expr: string): boolean {
  const src = expr.trim();
  if (!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(src)) return false;
  return src
    .split(/[._]|(?=[A-Z])/)
    .some((word) => /^err/i.test(word));
}

/** Class lists that carry an error in this file AND also carry ordinary text in it. */
export function undifferentiatedErrorClasses(source: string): string[] {
  const errorClasses = new Set<string>();
  const calmClasses = new Set<string>();
  for (const [, classList, expr] of source.matchAll(RENDER)) {
    const key = classList.trim().split(/\s+/).sort().join(" ");
    if (!key) continue;
    (rendersError(expr) ? errorClasses : calmClasses).add(key);
  }
  return [...errorClasses].filter((c) => calmClasses.has(c));
}

describe("error styling", () => {
  it("no component renders an error in the same class list as its ordinary copy", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      if (file.endsWith(".test.tsx")) continue;
      for (const shared of undifferentiatedErrorClasses(readFileSync(file, "utf8"))) {
        offenders.push(`${file}: className="${shared}" carries both an error and ordinary copy`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // ── falsification ──────────────────────────────────────────────────────────
  // Every branch below is a control. A guard whose failure path has never fired is a guard that
  // has never been shown to work.

  it("FALSIFICATION: flags the exact shape the receipts tile shipped with", () => {
    const before = `
      <p className="receipts-hint">{hint}</p>
      <p className="receipts-hint">{consentErr}</p>
    `;
    expect(undifferentiatedErrorClasses(before)).toEqual(["receipts-hint"]);
  });

  it("FALSIFICATION: one distinguishing class is enough to clear it", () => {
    const after = `
      <p className="receipts-hint">{hint}</p>
      <p className="receipts-hint receipts-error">{consentErr}</p>
    `;
    expect(undifferentiatedErrorClasses(after)).toEqual([]);
  });

  it("FALSIFICATION: a class used ONLY for errors is left alone, quiet or not", () => {
    // The LedgerHealthNotice shape: deliberately subdued, but never worn by ordinary copy.
    const notice = `
      <p className="ledger-health-detail">{incomplete.error}</p>
      <p className="ledger-health-detail">{revealError}</p>
    `;
    expect(undifferentiatedErrorClasses(notice)).toEqual([]);
  });

  it("FALSIFICATION: class order is not a difference", () => {
    const reordered = `
      <p className="a b">{hint}</p>
      <p className="b a">{loadError}</p>
    `;
    expect(undifferentiatedErrorClasses(reordered)).toEqual(["a b"]);
  });

  it("FALSIFICATION: the error classifier reads words, not substrings", () => {
    expect(rendersError("consentErr")).toBe(true);
    expect(rendersError("state.error")).toBe(true);
    expect(rendersError("save_error")).toBe(true);
    expect(rendersError("terror")).toBe(false);
    expect(rendersError("ferry")).toBe(false);
    expect(rendersError("describeError(e)")).toBe(false); // a call, not a plain read
  });

  it("the two receipts failure messages are styled as failures on disk", () => {
    // Pins the fix itself, not just the rule: the class exists and resolves to the danger token.
    const tsx = readFileSync(join("src", "surfaces", "ReceiptsConsent.tsx"), "utf8");
    expect(tsx).toMatch(/\{consentErr && <p className="[^"]*receipts-error"/);
    expect(tsx).toMatch(/\{previewErr && <p className="[^"]*receipts-error"/);
    const css = readFileSync(join("src", "surfaces", "Settings.css"), "utf8");
    expect(css).toMatch(/\.receipts-error\s*\{[^}]*color:\s*var\(--ix-danger\)/);
    // Source order is what decides the cascade -- both are single-class selectors.
    expect(css.indexOf(".receipts-error")).toBeGreaterThan(css.indexOf(".receipts-hint"));
  });
});
