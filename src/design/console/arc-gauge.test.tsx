import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true })); // reduced ⇒ useCountTo snaps (deterministic)
import { ArcGauge } from "./ArcGauge";

describe("ArcGauge", () => {
  it("renders an honest NOT-YET state when value is null — never a fabricated number", () => {
    render(<ArcGauge label="GPU temp" value={null} max={100} unit="°C" />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).toBeNull(); // no numeric readout at all
  });
  it("renders the measured value + a 'measured' tag when a real value is present", () => {
    render(<ArcGauge label="Safe stack" value={7} max={9} unit="ready" measured />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/measured/i)).toBeInTheDocument();
  });

  // bug→guard (TYPE-1 visual review, v0.9.19, 2026-08-13): at the 13px floor a long unit word
  // overflowed the 56px ring ("100 SCORE" / "246 FRAMES" overlapped the ring stroke on Home and
  // Test). The ring may only carry a short unit; longer text renders BESIDE the label at the same
  // floor — never shrunk, never clipped.
  it("keeps long units OUT of the ring (beside the label) and short units IN it — nothing shrinks below the floor", () => {
    const { container, rerender } = render(
      <ArcGauge label="Safe stack" value={7} max={9} unit="ready" measured />,
    );
    const side = container.querySelector(".ag-u-side");
    expect(side, "long unit must render in the side label block").not.toBeNull();
    expect(side!.textContent).toBe("ready");
    expect(container.querySelector(".ag-ctr .ag-u"), "long unit must NOT render inside the ring").toBeNull();

    rerender(<ArcGauge label="GPU temp" value={43} max={100} unit="°C" measured />);
    const inRing = container.querySelector(".ag-ctr .ag-u");
    expect(inRing, "short unit still renders inside the ring").not.toBeNull();
    expect(inRing!.textContent).toBe("°C");

    // Empty state: the honest no-reading sentence is long by nature — side block only.
    rerender(<ArcGauge label="GPU temp" value={null} max={100} unit="°C" />);
    expect(container.querySelector(".ag-ctr .ag-u")).toBeNull();
    expect(container.querySelector(".ag-u-side")!.textContent).toMatch(/no reading/i);
  });
});
