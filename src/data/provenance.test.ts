import { describe, it, expect } from "vitest";
import i18n from "../i18n";
import { PROVENANCE_LABEL, PROVENANCE_NOTE } from "./provenance";

// Guard for the honesty-doctrine breach the 1.0 audit caught: the ActionDrawer used to label the
// "verified" tier "Measured" with the note "Compy has observed this gain on real hardware." — a
// fabricated measured-gain claim. "Verified" means Compy observed the FACT, never a benchmarked gain.
describe("provenance wording (honesty doctrine)", () => {
  it("uses the same one-word chip label everywhere (no per-surface drift)", () => {
    expect(PROVENANCE_LABEL.verified).toBe("Verified");
    expect(PROVENANCE_LABEL["measured-signal"]).toBe("Measured elsewhere");
    // e5b (D3 §3): expected-impact is the source "Not measured on your PC" (was "Expected", a retired word).
    expect(PROVENANCE_LABEL["expected-impact"]).toBe("Not measured on your PC");
  });

  // D4: the chip label is an i18n key, so a zh-CN screen shows Chinese, and switching back is English.
  it("the chip label follows the app's language", async () => {
    const tiers = ["verified", "measured-signal", "expected-impact"] as const;
    await i18n.changeLanguage("zh-CN");
    try {
      for (const p of tiers) expect(PROVENANCE_LABEL[p], p).toMatch(/^[一-鿿]+$/);
    } finally {
      await i18n.changeLanguage("en");
    }
    expect(tiers.map((p) => PROVENANCE_LABEL[p])).toEqual(["Verified", "Measured elsewhere", "Not measured on your PC"]);
  });

  it("the Verified note never claims an unmeasured performance gain", () => {
    const note = PROVENANCE_NOTE.verified.toLowerCase();
    expect(note).not.toContain("observed this gain");
    expect(note).not.toMatch(/measured[^.]*gain/); // never "measured … gain"
    // It must mark the performance feel as expected, not benchmarked on this rig.
    expect(note).toContain("not benchmarked");
  });
});
