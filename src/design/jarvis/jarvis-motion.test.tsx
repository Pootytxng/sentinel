import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ShellV2 } from "../ShellV2";
import { railFor } from "../homeRail";
import { readJarvisMotion, applyJarvisMotion } from "../theme";
import { setMotionPref } from "../use-motion";
import { ArcGauge } from "../console/ArcGauge";

// JARVIS motion layer guards (UI_VISION_BACKLOG §A.2/A.3/A.5/A.6, train 2026-07-12).
// The three contracts every effect in the layer must keep:
//   1. FLAG-OFF BYTE-IDENTITY — compy_jarvis_motion "0" (the failsafe; DEFAULT is now ON after the
//      2026-07-12 owner-approved flip) renders the shell and gauges exactly as before the train:
//      no jv-* nodes, no data-magnetic attributes.
//   2. REDUCED-MOTION WINS — flag "1" + resolved reduced motion ⇒ the layer stands down
//      entirely (Compy's own Motion pref, mid-session flips included).
//   3. HONEST DATA-TICK — the gauge tick fires ONLY on a real→real value CHANGE. Arrival
//      (null→value) is the count-up's moment; loss (value→null) is NOT-YET; absence never
//      renders a tick node. Motion may never imply a measurement that didn't happen.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));

const ITEMS = railFor(true);

const shell = (activeId: "home" | "play" = "home") => (
  <ShellV2 items={ITEMS} activeId={activeId} onNavigate={() => {}} ledgerCount={1}>
    <div data-testid="room">room</div>
  </ShellV2>
);

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.jarvis;
  setMotionPref("full");
});
afterEach(cleanup);

describe("compy_jarvis_motion flag", () => {
  it("defaults ON (key absent); only an explicit '0' is the failsafe off", () => {
    expect(readJarvisMotion()).toBe(true);
    localStorage.setItem("compy_jarvis_motion", "0");
    expect(readJarvisMotion()).toBe(false);
    localStorage.setItem("compy_jarvis_motion", "1");
    expect(readJarvisMotion()).toBe(true);
  });

  it("renders the live layer by default (key absent) — data-magnetic on the rail", () => {
    const { container } = render(shell("home"));
    expect(container.querySelectorAll(".v2-nav-item[data-magnetic]").length).toBe(ITEMS.length);
  });

  it("applyJarvisMotion persists and mirrors onto <html data-jarvis>", () => {
    applyJarvisMotion(true);
    expect(localStorage.getItem("compy_jarvis_motion")).toBe("1");
    expect(document.documentElement.dataset.jarvis).toBe("on");
    applyJarvisMotion(false);
    expect(localStorage.getItem("compy_jarvis_motion")).toBe("0");
    expect(document.documentElement.dataset.jarvis).toBeUndefined();
  });
});

describe("flag-off byte-identity (the '0' failsafe)", () => {
  beforeEach(() => localStorage.setItem("compy_jarvis_motion", "0"));

  it("renders no jv-* nodes and no data-magnetic attributes", () => {
    const { container, rerender } = render(shell("home"));
    expect(container.querySelector("[data-magnetic]")).toBeNull();
    // A room change must not wipe either.
    rerender(shell("play"));
    expect(container.querySelector(".jv-retune")).toBeNull();
    expect(container.innerHTML).not.toContain("jv-");
  });

  it("ArcGauge renders no tick node on a real→real change", () => {
    const { container, rerender } = render(
      <ArcGauge label="Avg FPS" value={50} max={240} unit="fps" />,
    );
    rerender(<ArcGauge label="Avg FPS" value={60} max={240} unit="fps" />);
    expect(container.querySelector(".jv-gauge-tick")).toBeNull();
  });
});

describe("flag on + motion full", () => {
  beforeEach(() => localStorage.setItem("compy_jarvis_motion", "1"));

  it("rail tabs carry data-magnetic", () => {
    const { container } = render(shell("home"));
    const tabs = container.querySelectorAll(".v2-nav-item[data-magnetic]");
    expect(tabs.length).toBe(ITEMS.length);
  });

  it("never wipes on first paint; wipes once per room change and removes itself on animationend", () => {
    const { container, rerender } = render(shell("home"));
    expect(container.querySelector(".jv-retune")).toBeNull(); // no page-load choreography
    rerender(shell("play"));
    const wipe = container.querySelector(".jv-retune");
    expect(wipe).not.toBeNull();
    // The wipe listens natively (React 19's synthetic onAnimationEnd doesn't fire here) —
    // dispatch the native event the browser would emit.
    fireEvent(wipe!, new Event("animationend"));
    expect(container.querySelector(".jv-retune")).toBeNull();
  });

  it("a bare flag flip is not a navigation — no wipe without a room change", () => {
    localStorage.setItem("compy_jarvis_motion", "0");
    const { container, rerender } = render(shell("home"));
    rerender(shell("play")); // room change while OFF — tracked, but must not wipe
    expect(container.querySelector(".jv-retune")).toBeNull();
    act(() => applyJarvisMotion(true)); // flip ON — still not a navigation
    expect(container.querySelector(".jv-retune")).toBeNull();
  });
});

describe("reduced motion wins over the flag (mid-session flips included)", () => {
  beforeEach(() => localStorage.setItem("compy_jarvis_motion", "1"));

  it("flag on + reduced ⇒ no magnetic attributes, no wipe", () => {
    setMotionPref("reduced");
    const { container, rerender } = render(shell("home"));
    expect(container.querySelector("[data-magnetic]")).toBeNull();
    rerender(shell("play"));
    expect(container.querySelector(".jv-retune")).toBeNull();
  });

  it("a mid-session reduced flip stands the live layer down", () => {
    const { container } = render(shell("home"));
    expect(container.querySelector("[data-magnetic]")).not.toBeNull();
    act(() => setMotionPref("reduced"));
    expect(container.querySelector("[data-magnetic]")).toBeNull();
  });
});

describe("honest data-tick (ArcGauge, flag on)", () => {
  beforeEach(() => localStorage.setItem("compy_jarvis_motion", "1"));

  const gauge = (value: number | null) => (
    <ArcGauge label="Avg FPS" value={value} max={240} unit="fps" />
  );

  it("no data ⇒ no tick node, ever", () => {
    const { container } = render(gauge(null));
    expect(container.querySelector(".jv-gauge-tick")).toBeNull();
  });

  it("arrival (null→value) does not tick — that is the count-up's moment", () => {
    const { container, rerender } = render(gauge(null));
    rerender(gauge(72));
    expect(container.querySelector(".jv-gauge-tick")).toBeNull();
  });

  it("a real→real CHANGE ticks; losing the reading (→null) unmounts the tick node", () => {
    const { container, rerender } = render(gauge(50));
    rerender(gauge(60));
    expect(container.querySelector(".jv-gauge-tick")).not.toBeNull();
    rerender(gauge(null));
    expect(container.querySelector(".jv-gauge-tick")).toBeNull();
  });

  it("an unchanged reading does not tick", () => {
    const { container, rerender } = render(gauge(50));
    rerender(gauge(50));
    expect(container.querySelector(".jv-gauge-tick")).toBeNull();
  });
});
