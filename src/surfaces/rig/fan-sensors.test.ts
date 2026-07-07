import { describe, it, expect } from "vitest";
import { nextFanSensors, type FanSensor } from "./fan-sensors";

// bug→guard (T1.5 #1, owner flicker report → live GL-draw probe): the 2.5s fan poll returns a
// FRESH array every tick; passing it straight to setState re-rendered the canvas tree, r3f
// committed referentially-new props and auto-invalidated — one repaint burst per poll at rest,
// which is exactly the idle pulse/hitch class. The contract mechanized here: a content-equal
// poll must return the PREVIOUS reference (React bails → no commit → no repaint); only a real
// data change may produce a new reference.

const s = (label: string, rpm: number, source = "hwinfo"): FanSensor => ({ label, rpm, source });

describe("nextFanSensors — content-equal polls keep the previous reference (idle-repaint contract)", () => {
  it("empty poll after empty poll: same reference back", () => {
    const prev: FanSensor[] = [];
    expect(nextFanSensors(prev, [])).toBe(prev);
  });

  it("equal-content populated poll: same reference back", () => {
    const prev = [s("CPU fan", 900), s("Front intake", 650)];
    const incoming = [s("CPU fan", 900), s("Front intake", 650)];
    expect(nextFanSensors(prev, incoming)).toBe(prev);
  });

  it("first poll (prev null): takes the incoming array", () => {
    const incoming: FanSensor[] = [];
    expect(nextFanSensors(null, incoming)).toBe(incoming);
  });

  it("rpm change: takes the incoming array", () => {
    const prev = [s("CPU fan", 900)];
    const incoming = [s("CPU fan", 905)];
    expect(nextFanSensors(prev, incoming)).toBe(incoming);
  });

  it("label/source/length changes: takes the incoming array", () => {
    const prev = [s("CPU fan", 900)];
    expect(nextFanSensors(prev, [s("CPU", 900)])).not.toBe(prev);
    expect(nextFanSensors(prev, [s("CPU fan", 900, "lhm")])).not.toBe(prev);
    expect(nextFanSensors(prev, [s("CPU fan", 900), s("Rear", 500)])).not.toBe(prev);
    expect(nextFanSensors(prev, [])).not.toBe(prev);
  });
});
