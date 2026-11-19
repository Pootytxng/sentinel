import { describe, it, expect } from "vitest";
import { PROVENANCE_LABEL, PROVENANCE_NOTE } from "./provenance";

// Guard for the honesty-doctrine breach the 1.0 audit caught: the ActionDrawer used to label the
// "verified" tier "Measured" with the note "Compy has observed this gain on real hardware." — a
// fabricated measured-gain claim. "Verified" means Compy observed the FACT, never a benchmarked gain.
describe("provenance wording (honesty doctrine)", () => {
  it("uses the same one-word chip label everywhere (no per-surface drift)", () => {
    expect(PROVENANCE_LABEL.verified).toBe("Verified");
    expect(PROVENANCE_LABEL["measured-signal"]).toBe("Measured elsewhere");
    expect(PROVENANCE_LABEL["expected-impact"]).toBe("Expected");
  });

  it("the Verified note never claims an unmeasured performance gain", () => {
    const note = PROVENANCE_NOTE.verified.toLowerCase();
    expect(note).not.toContain("observed this gain");
    expect(note).not.toMatch(/measured[^.]*gain/); // never "measured … gain"
    // It must mark the performance feel as expected, not benchmarked on this rig.
    expect(note).toContain("not benchmarked");
  });
});
