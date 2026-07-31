// Guard for #21 acceptance criterion 1: no surface under tools/entry/ still calls 300000
// experimental, a trial, or unaccepted.
//
// Kuya accepted the tier on 2026-07-31 (#19): "300k is accepted as Compy's scoped marathon tier. It
// is not the default; routine work remains 150k." The launcher kept printing `300k — experimental`
// and `(trial — not accepted)` on every launch afterwards, which is the entrypoint asserting
// something untrue about a decision the owner had already made.
//
// A word guard alone would only push the drift one layer down — a flag still called `trial` after
// the trial concluded is the same defect wearing a different name. So this file pins the SHAPE too:
// `tiers`, never `trials`; `default` still 150000; the tier still granted per issue. Acceptance
// settled the tier's name and status, not its scoping.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HERE, loadPolicy } from "./gather.mjs";
import { contextLabel } from "./select.mjs";
import { intendedWindow } from "./settings-resolve.mjs";

/**
 * Every file that SPEAKS — code, comments and the policy file, all of which reach the owner as
 * printed output or as the thing he opens to change a decision.
 *
 * Guards are excluded on purpose. A fixture quoting #19's real GitHub title ("[OPS] Re-run and
 * decide the invalidated 300k context-window trial") is a historical record, not a claim about the
 * present, and this file would otherwise trip on its own regexes.
 */
const SURFACES = readdirSync(HERE)
  .filter((f) => (f.endsWith(".mjs") && !f.endsWith(".test.mjs")) || f === "context-policy.json")
  .map((f) => ({ file: f, text: readFileSync(join(HERE, f), "utf8") }));

const RETIRED = [
  { word: "trial", re: /\btrials?\b/i },
  { word: "experimental", re: /\bexperimental\b/i },
  { word: "unaccepted", re: /\bunaccepted\b/i },
  { word: "not accepted", re: /\bnot (?:yet |formally )?accepted\b/i },
];

describe("the launcher stopped describing an accepted tier as an open question", () => {
  it("has surfaces to check at all — an empty sweep must never read as a pass", () => {
    expect(SURFACES.length).toBeGreaterThan(10);
    expect(SURFACES.map((s) => s.file)).toEqual(
      expect.arrayContaining(["select.mjs", "launch.mjs", "context-policy.json"]),
    );
  });

  for (const { word, re } of RETIRED) {
    it(`no surface calls the marathon tier "${word}"`, () => {
      const offenders = SURFACES.filter((s) => re.test(s.text)).map((s) => s.file);
      expect(offenders).toEqual([]);
    });
  }
});

describe("the concept was renamed, not just the strings", () => {
  it("the shipped policy grants tiers, and has no trace of the old key", () => {
    const policy = loadPolicy();
    expect(Array.isArray(policy.tiers)).toBe(true);
    expect(policy.trials).toBeUndefined();
    expect(policy.tiers.find((t) => t.window === 300000)?.issues.length).toBeGreaterThan(0);
  });

  it("acceptance did NOT widen the default — routine work is still 150k", () => {
    // The named failure mode: widening `default` to make a refusal go away turns a routing mistake
    // into an invisible one. Criterion 3 of #21.
    expect(loadPolicy().default).toBe(150000);
  });

  it("the tier stays granted per issue, so a standard train still intends the default", () => {
    const policy = loadPolicy();
    expect(intendedWindow(policy, { issue: 19 })).toMatchObject({ window: 300000, marathon: true });
    expect(intendedWindow(policy, { issue: 21 })).toMatchObject({ window: 150000, marathon: false });
  });

  it("renders the accepted name on the label the owner reads on every launch", () => {
    // Criterion 2, verbatim.
    expect(contextLabel(300000, { marathon: true })).toBe("300k — marathon");
    expect(contextLabel(150000, { marathon: false })).toBe("150k — standard");
    expect(contextLabel(150000)).toBe("150k — standard");
  });
});
