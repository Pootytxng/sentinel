import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Real resources, not stub keys: asserting on ENGLISH is what proves the keys exist at all.
// A typo'd key renders as `common.fpsTrace.aria` to the user and passes every structural check.
import "../i18n";
import { FpsTrace } from "./FpsTrace";

// The RENDERED half of the fps_series honesty contract (geometry.test.ts pins the maths).
// What these prove is that the honest geometry actually reaches the screen — a component can
// compute a broken line perfectly and then paint one continuous polyline anyway.
describe("FpsTrace", () => {
  const gapped: [number, number][] = [[0, 141], [10, 138], [40, 96], [50, 144]];

  it("draws one polyline per contiguous run, so a capture gap stays visibly broken", () => {
    const { container } = render(<FpsTrace series={gapped} durationSecs={60} />);
    expect(container.querySelectorAll("polyline.ds-trace-line")).toHaveLength(2);
  });

  it("draws a single polyline when nothing was missed", () => {
    const { container } = render(
      <FpsTrace series={[[0, 60], [10, 61], [20, 59]]} durationSecs={30} />,
    );
    expect(container.querySelectorAll("polyline.ds-trace-line")).toHaveLength(1);
    expect(container.querySelector(".ds-trace-gaps")).toBeNull();
  });

  // A broken line with no explanation reads as a rendering bug. The count is also the honest
  // statement that Compy stopped measuring there — it does not quietly paper over its own silence.
  it("names the gaps in words when there are any", () => {
    render(<FpsTrace series={gapped} durationSecs={60} />);
    expect(screen.getByText(/1 gap\b/)).toBeInTheDocument();
  });

  // The whole point of the item: no trace on record must NOT render as a flat line at zero, which
  // would read as "we measured no frames" — a fabricated measurement.
  it("says no trace is kept instead of drawing anything, when the series is empty", () => {
    const { container } = render(<FpsTrace series={[]} durationSecs={3600} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
    expect(screen.getByText(/No trace kept/i)).toBeInTheDocument();
  });

  it("treats an absent series the same as an empty one", () => {
    const { container } = render(<FpsTrace series={undefined} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText(/No trace kept/i)).toBeInTheDocument();
  });

  it("reports the real peak, not the last or the mean", () => {
    render(<FpsTrace series={gapped} durationSecs={60} />);
    expect(screen.getByText(/peak 144 fps/)).toBeInTheDocument();
  });

  // A chart is unreadable to a screen reader; the label is the only thing that carries it.
  it("carries the peak and the span in its accessible name", () => {
    const { container } = render(<FpsTrace series={gapped} durationSecs={600} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg!.getAttribute("aria-label")).toMatch(/144 fps/);
    expect(svg!.getAttribute("aria-label")).toMatch(/10m/);
  });

  // A measurement that exists but is alone between two holes must still be visible.
  it("paints a gap-isolated sample as a dot rather than dropping it", () => {
    const { container } = render(
      <FpsTrace series={[[0, 60], [10, 60], [90, 30]]} durationSecs={100} />,
    );
    expect(container.querySelectorAll("line.ds-trace-dot")).toHaveLength(1);
  });

  // CR-live-round (desk review 2026-11-03): the axis tick rounds a session above an hour to the
  // minute, the same rule as the Debrief title, History, Games and Live — 12,527 s is "3h 29m" in all
  // five places, never "3h 28m" under a "3h 29m" title. A near-whole hour carries, never "1h 60m".
  it("rounds the span above an hour to the minute like every other place the session is named", () => {
    const { container, unmount } = render(<FpsTrace series={[[0, 60], [10, 60]]} durationSecs={12527} />);
    expect(container.querySelector(".ds-trace-tick")?.textContent).toBe("3h 29m");
    unmount();
    const { container: carried } = render(<FpsTrace series={[[0, 60], [10, 60]]} durationSecs={3599.6} />);
    expect(carried.querySelector(".ds-trace-tick")?.textContent).toBe("59m");
    const { container: whole } = render(<FpsTrace series={[[0, 60], [10, 60]]} durationSecs={7199.5} />);
    expect(whole.querySelector(".ds-trace-tick")?.textContent).toBe("2h 0m");
  });
});
