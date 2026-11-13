import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "../i18n";
import { AssumedBandNote, assumedBandCount, type AssumedBand } from "./assumed-band";

// Measurement item 7: one shared label for an old verdict judged on the assumed ±3% band.
const OLD: AssumedBand = { assumed_pct: 3, measured_low1_pct: null, measured_sessions: null, claimed_change: true, judged: true };

describe("assumed-band (item 7)", () => {
  it("the note shows the label for an assumed band and nothing otherwise", () => {
    const { container, rerender } = render(<AssumedBandNote band={OLD} game="Valorant.exe" />);
    expect(screen.getByTestId("assumed-band-note").textContent).toMatch(/±3%/);
    rerender(<AssumedBandNote band={null} game="Valorant.exe" />);
    expect(container.textContent).toBe("");
  });

  it("counts changes, once each, whose measured verdict was judged on the assumed band", () => {
    const measured = (v: string | null) => v === "improved" || v === "regressed" || v === "no-change";
    const exps = [
      { rec_id: "a", verdict: "improved", assumed_band: OLD },
      { rec_id: "a", verdict: "no-change", assumed_band: OLD },
      { rec_id: "b", verdict: "too-noisy", assumed_band: OLD },
      { rec_id: "c", verdict: "regressed", assumed_band: null },
      { rec_id: "d", verdict: "no-change" },
      // An old assumed-band verdict, then a newer one judged on a measured band: not counted.
      { rec_id: "e", verdict: "improved", assumed_band: OLD, concluded_at: "2026-11-01T00:00:00Z" },
      { rec_id: "e", verdict: "no-change", assumed_band: null, concluded_at: "2026-11-12T00:00:00Z" },
    ];
    expect(assumedBandCount(exps, measured)).toBe(1);
  });
});
