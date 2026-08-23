import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true })); // reduced ⇒ useCountTo snaps (deterministic)
import { ArcGauge } from "./ArcGauge";
import { readFileSync } from "fs";
import { join } from "path";

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

  it("CSS: the gauge can shrink -- its label column cannot widen the instrument (bug->guard, issue #49)", () => {
    // self-review round 6, 2026-08-23. On Health at 1280x720 the readiness gauge ran 25px past its
    // grid cell and collided with AVG FPS. An `fr` track's AUTOMATIC minimum is min-content, so the
    // label, its tag pill and its note set a floor the whole instrument could not go below. The
    // symptom was Health's, the defect is the KIT's: any room that places a gauge in a flexible cell
    // inherits it, so both halves of the fix live here -- a zero minimum on the track AND on the item.
    const css = readFileSync(join("src", "design", "console", "arc-gauge.css"), "utf8");
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

    const root = /\.arc-gauge\s*\{([^}]*)\}/.exec(strip(css));
    expect(root, ".arc-gauge must declare its own grid").not.toBeNull();
    expect(
      root![1],
      "the label column needs minmax(0, 1fr): a bare fr is sized by its content, so a long label " +
        "or tag makes the whole gauge overflow whatever cell it was placed in",
    ).toMatch(/grid-template-columns:\s*auto\s+minmax\(\s*0\s*,\s*1fr\s*\)/);

    const label = /\.ag-label\s*\{([^}]*)\}/.exec(strip(css));
    expect(label, ".ag-label must have a rule").not.toBeNull();
    expect(
      label![1],
      "clamping the track alone is not enough -- the grid ITEM keeps its own min-content floor",
    ).toMatch(/min-width:\s*0/);
  });
});
