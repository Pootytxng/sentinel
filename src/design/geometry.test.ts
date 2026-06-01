import { describe, it, expect } from "vitest";
import { gaugePercent, sparkPoints } from "./geometry";

describe("gaugePercent", () => {
  it("returns 0..100 within range", () => {
    expect(gaugePercent(50, 0, 100)).toBe(50);
    expect(gaugePercent(30, 0, 120)).toBe(25);
  });
  it("clamps out-of-range and handles a zero span", () => {
    expect(gaugePercent(-5, 0, 100)).toBe(0);
    expect(gaugePercent(150, 0, 100)).toBe(100);
    expect(gaugePercent(5, 10, 10)).toBe(0);
  });
});

describe("sparkPoints", () => {
  it("maps values to a polyline string across width/height", () => {
    const pts = sparkPoints([0, 5, 10], 100, 40);
    expect(pts).toBe("0,40 50,20 100,0");
  });
  it("returns empty string for <2 values", () => {
    expect(sparkPoints([1], 100, 40)).toBe("");
    expect(sparkPoints([], 100, 40)).toBe("");
  });
  it("flat series renders along the bottom", () => {
    expect(sparkPoints([7, 7, 7], 100, 40)).toBe("0,40 50,40 100,40");
  });
});
