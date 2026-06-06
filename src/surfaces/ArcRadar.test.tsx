import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ArcRadar, type RadarBlip } from "./ArcRadar";

afterEach(cleanup);

const blips: RadarBlip[] = [
  { id: "a", verdict: "ok" },
  { id: "b", verdict: "fix" },
  { id: "c", verdict: "unknown" },
];

describe("ArcRadar", () => {
  it("renders exactly one blip per REVEALED check (1:1 with shownCount), colored by real verdict", () => {
    const { container } = render(<ArcRadar blips={blips} shownCount={2} scanning />);
    expect(container.querySelectorAll(".fc-radar-blip")).toHaveLength(2); // only revealed so far
    expect(container.querySelector(".fc-radar-blip-ok")).toBeTruthy();
    expect(container.querySelector(".fc-radar-blip-fix")).toBeTruthy();
    expect(container.querySelector(".fc-radar-blip-unknown")).toBeFalsy(); // 3rd not revealed yet
  });

  it("reveals all blips once the scan completes", () => {
    const { container } = render(<ArcRadar blips={blips} shownCount={3} scanning={false} />);
    expect(container.querySelectorAll(".fc-radar-blip")).toHaveLength(3);
  });

  it("renders no blips when there are no findings (no invented dots)", () => {
    const { container } = render(<ArcRadar blips={[]} shownCount={0} scanning={false} />);
    expect(container.querySelectorAll(".fc-radar-blip")).toHaveLength(0);
  });
});
