// Honesty regression guard for the tweak-debunk corpus (src/data/tweaks.json).
//
// The myth-debunk corpus is Compy's core honesty differentiator — every claim must be FACTUAL,
// never fabricated, never an unmeasured number (Compy's cardinal sin). The 2026-06-25 adversarial
// audit (8 web-verified sub-agents, ledger docs/HONESTY_AUDIT_TWEAKS.md) found three factual errors
// and fixed them. This guard PINS those three fixes so a future edit can't silently re-introduce the
// falsehood — bug -> guard ([[bug-becomes-guard]]). It is intentionally surgical: it tests only the
// specific repaired claims, by entry id, so it won't fight ordinary rewording of unrelated prose.
//
// If a future, correctly-sourced edit ever NEEDS to trip one of these (e.g. re-adding a *correctly
// attributed* fTPM example), that's a conscious change — update the matching assertion here in the
// same commit, with the source, rather than deleting the guard.

import { describe, it, expect } from "vitest";
import rawTweaks from "./tweaks.json";

type Tweak = { id: string; verdict: string; what: string; why: string };
const TWEAKS = rawTweaks as Tweak[];
const whyOf = (id: string): string => {
  const e = TWEAKS.find((t) => t.id === id);
  if (!e) throw new Error(`tweak "${id}" not found — corpus changed; update this honesty guard`);
  return e.why;
};

describe("tweak-debunk corpus — honesty regression guard (2026-06-25 audit fixes)", () => {
  // FIX 1 — sysmain-superfetch: the `why` once claimed "Frees 0.5–1.5 GB on SSD/NVMe systems."
  // That GB range was fabricated/unsourced AND mischaracterized reclaimable standby cache as freed
  // memory. The cardinal sin is the invented number, so the durable guard is: this entry must claim
  // NO specific GB quantity of memory "freed".
  it("sysmain-superfetch claims no fabricated GB-freed number", () => {
    const why = whyOf("sysmain-superfetch");
    expect(why, "sysmain must not quote a specific GB amount (fabricated-number regression)").not.toMatch(
      /\d+(\.\d+)?\s*(?:[–-]\s*\d+(\.\d+)?\s*)?gb\b/i,
    );
    // And it must keep the honest correction that the cache isn't a fixed "freed" amount.
    expect(why.toLowerCase()).toContain("standby");
  });

  // FIX 2 — disable-windows-update: the `why` cited "(fTPM stutter was fixed by an update)" inside a
  // sentence about WINDOWS Update. The Ryzen fTPM-stutter fix shipped as a BIOS/AGESA update, not
  // Windows Update — a misattribution. The honest fix dropped the example. Pin that it stays gone.
  it("disable-windows-update does not misattribute the fTPM fix to Windows Update", () => {
    const why = whyOf("disable-windows-update");
    expect(why, "fTPM was a BIOS/AGESA fix, not a Windows Update — keep it out of this entry").not.toMatch(
      /ftpm/i,
    );
  });

  // FIX 3 — defrag-ssd: the `why` claimed Optimize Drives gives an SSD "a TRIM pass ... not a defrag."
  // False: Windows DOES run an occasional SSD defrag when System Restore / Volume Shadow Copy is on
  // (Windows Storage team via Hanselman). The fix removed the absolute and named the real behaviour.
  it("defrag-ssd does not assert the false 'Windows never defrags an SSD' absolute", () => {
    const why = whyOf("defrag-ssd");
    expect(why, "Windows DOES occasionally defrag SSDs (System Restore/VSS) — don't claim 'not a defrag'").not.toMatch(
      /not a defrag/i,
    );
    // And keeps the corrected mechanism (occasional defrag tied to System Restore).
    expect(why.toLowerCase()).toContain("system restore");
  });
});
