import axe, { type Result, type RunOptions } from "axe-core";

// axe-core, driven from vitest/jsdom. C-13's rank-3 tooling ask (docs/decisions/2026-08-11-design-
// foundation.md §Tooling): make structural accessibility a FAILING TEST, so an unlabelled control or
// a button with no accessible name dies in the suite rather than reaching a non-technical user who
// cannot work out what the control does.
//
// WHAT THIS CANNOT SEE — and why the omission is deliberate, not an oversight.
// jsdom has no layout engine, no canvas, and `vitest.config.ts` sets `css: false`, so not one
// stylesheet is ever attached to the document under test. axe's `color-contrast` rule needs all
// three. Measured 2026-08-19 on markup with a deliberate 1.06:1 failure (#777 text on #888):
//
//     violations 0 · passes 0 · incomplete 1 ("color-contrast")
//     + jsdom console: "Not implemented: HTMLCanvasElement's getContext()"
//
// Zero violations on markup that IS a violation. Left enabled, the rule would report clean forever
// and read as contrast coverage this suite does not have — a silent false green, which is worse than
// no check at all. So it is disabled BY NAME here, and contrast stays where it is actually measured:
// `src/theme-contrast.test.ts` computes WCAG ratios from the real token hexes in instrument.css, and
// `src/design/type-scale-guard.test.ts` holds the type floor. Those are the contrast/type guards this
// harness is "joined to" — it adds the structural half they were never able to reach.
//
// Anything else axe reports as `incomplete` is likewise NOT a pass: incomplete means "needs a human
// or a real browser", and only `violations` fail here. The live-app half of that gap is the
// `self-review` skill's job on a real window.
export const JSDOM_UNRUNNABLE_RULES: RunOptions["rules"] = {
  // Needs canvas + real layout + attached stylesheets. See the block above for the measurement.
  "color-contrast": { enabled: false },
};

/** Run axe over a rendered container and return only the violations. */
export async function axeViolations(
  container: Element,
  options: RunOptions = {},
): Promise<Result[]> {
  const results = await axe.run(container, {
    // Collecting passes/incomplete node data costs real time across a large roster and nothing here
    // reads them; violations are the only result type that can fail a test.
    resultTypes: ["violations"],
    ...options,
    rules: { ...JSDOM_UNRUNNABLE_RULES, ...(options.rules ?? {}) },
  });
  return results.violations;
}

/** Format violations the way a person debugging one actually needs to read them. */
export function formatAxeViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `      ${n.html}\n        ${n.failureSummary?.replace(/\n/g, "\n        ") ?? ""}`)
        .join("\n");
      return `  [${v.impact ?? "unknown"}] ${v.id} — ${v.help}\n${nodes}`;
    })
    .join("\n");
}

/**
 * Assert a rendered container has no structural accessibility violations.
 * One line to add to any render test; the failure names the rule, the element and the fix.
 */
export async function expectNoAxeViolations(
  container: Element,
  options: RunOptions = {},
): Promise<void> {
  const violations = await axeViolations(container, options);
  if (violations.length > 0) {
    throw new Error(
      `axe found ${violations.length} accessibility violation(s):\n${formatAxeViolations(violations)}`,
    );
  }
}
