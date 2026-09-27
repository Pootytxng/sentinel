import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import type { AutopsyLedgerEntry } from "../data/autopsy-ledger";
import { blackbookVerdict } from "./blackbook-v2-data";

// Key-echo TFunction stub: pins the i18n KEY + interpolation args, never English copy.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts === undefined ? key : `${key} ${JSON.stringify(opts)}`) as unknown as TFunction;
const T = (key: string, opts?: Record<string, unknown>) =>
  opts === undefined ? key : `${key} ${JSON.stringify(opts)}`;
const K = "blackbook.blackbookV2.verdict.";

const entry = (over: Partial<AutopsyLedgerEntry> = {}): AutopsyLedgerEntry => ({
  at: 1_700_000_000_000,
  real: 0,
  placebo: 0,
  risky: 0,
  unknown: 0,
  scamFlags: 0,
  ...over,
});

describe("blackbookVerdict", () => {
  it("empty ledger → standing promise line, zero numbers invented", () => {
    expect(blackbookVerdict([], t)).toEqual({
      headline: T(`${K}noRecordHeadline`),
      sub: T(`${K}noRecordSub`),
    });
  });

  it("single entry with graded tweaks → share headline + raw-count sub, no scam part", () => {
    const r = blackbookVerdict([entry({ real: 2, placebo: 1, risky: 1, unknown: 5 })], t);
    expect(r.headline).toBe(T(`${K}gradedHeadline`, { count: 1, pct: 50 }));
    expect(r.sub).toBe(T(`${K}recognizedBreakdown`, { real: 2, placebo: 1, risky: 1, scamPart: "" }));
  });

  it("scam flags alongside graded tweaks → inline scam part with its own count", () => {
    const r = blackbookVerdict([entry({ real: 1, placebo: 2, scamFlags: 3 })], t);
    expect(r.headline).toBe(T(`${K}gradedHeadline`, { count: 1, pct: 33 }));
    expect(r.sub).toBe(
      T(`${K}recognizedBreakdown`, {
        real: 1,
        placebo: 2,
        risky: 0,
        scamPart: T(`${K}scamFlaggedInline`, { count: 3 }),
      }),
    );
  });

  it("many entries → sums across the whole ledger (order-independent) and rounds the share", () => {
    const a = entry({ at: 1, real: 1, placebo: 1 });
    const b = entry({ at: 3, real: 1, risky: 0, placebo: 0 });
    const c = entry({ at: 2, risky: 1, scamFlags: 1 });
    const fwd = blackbookVerdict([a, b, c], t);
    expect(fwd.headline).toBe(T(`${K}gradedHeadline`, { count: 3, pct: 50 }));
    expect(fwd.sub).toBe(
      T(`${K}recognizedBreakdown`, {
        real: 2,
        placebo: 1,
        risky: 1,
        scamPart: T(`${K}scamFlaggedInline`, { count: 1 }),
      }),
    );
    expect(blackbookVerdict([c, b, a], t)).toEqual(fwd);
  });

  it("graded but no verdict-bearing tweaks, single guide → singular unrated sub, no percentages", () => {
    const r = blackbookVerdict([entry({ unknown: 4 })], t);
    expect(r.headline).toBe(T(`${K}gradedNoTweaksHeadline`, { count: 1 }));
    expect(r.sub).toBe(T(`${K}unratedClaimsSingular`));
    expect(r.headline).not.toContain("pct");
  });

  it("graded but no verdict-bearing tweaks, several guides → plural unrated sub", () => {
    const r = blackbookVerdict([entry({ unknown: 1 }), entry({ unknown: 2 })], t);
    expect(r.headline).toBe(T(`${K}gradedNoTweaksHeadline`, { count: 2 }));
    expect(r.sub).toBe(T(`${K}unratedClaimsPlural`));
  });

  it("no verdict-bearing tweaks but scam flags → scam-flagged-so-far sub wins over unrated copy", () => {
    const r = blackbookVerdict([entry({ scamFlags: 1 }), entry({ unknown: 3, scamFlags: 2 })], t);
    expect(r.headline).toBe(T(`${K}gradedNoTweaksHeadline`, { count: 2 }));
    expect(r.sub).toBe(T(`${K}scamFlaggedSoFar`, { count: 3 }));
  });

  it("all-real ledger → 100% share; unknowns never inflate the graded counts", () => {
    const r = blackbookVerdict([entry({ real: 3, unknown: 10 })], t);
    expect(r.headline).toBe(T(`${K}gradedHeadline`, { count: 1, pct: 100 }));
    expect(r.sub).toBe(T(`${K}recognizedBreakdown`, { real: 3, placebo: 0, risky: 0, scamPart: "" }));
  });

  it("zero real among graded tweaks → 0% share stated, not hidden", () => {
    const r = blackbookVerdict([entry({ placebo: 2, risky: 1 })], t);
    expect(r.headline).toBe(T(`${K}gradedHeadline`, { count: 1, pct: 0 }));
  });
});
