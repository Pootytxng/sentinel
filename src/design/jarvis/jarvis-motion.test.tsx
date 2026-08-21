import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ShellV2 } from "../ShellV2";
import { railFor } from "../homeRail";
import { setMotionPref } from "../use-motion";
import { ArcGauge } from "../console/ArcGauge";

// JARVIS motion layer guards (UI_VISION_BACKLOG §A.2/A.3/A.5/A.6, train 2026-07-12; the
// separate compy_jarvis_motion flag FOLDED into the Motion preference 2026-08-20, issue #180).
// The contracts every effect in the layer must keep:
//   1. REDUCED ⇒ BYTE-IDENTITY — Motion=Reduced (the one remaining off-switch) renders the
//      shell and gauges exactly as the static tree: no jv-* nodes, no data-magnetic attributes.
//   2. FULL ⇒ LIVE — the default Motion=Full mounts the layer; mid-session flips are honored
//      both directions without a reload.
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

describe("motion pref drives the layer (the 2026-08-20 fold)", () => {
  it("renders the live layer by default — data-magnetic on the rail", () => {
    const { container } = render(shell("home"));
    expect(container.querySelectorAll(".v2-nav-item[data-magnetic]").length).toBe(ITEMS.length);
  });

  it("setMotionPref mirrors the derived <html data-jarvis> attribute both ways", () => {
    setMotionPref("full");
    expect(document.documentElement.dataset.jarvis).toBe("on");
    setMotionPref("reduced");
    expect(document.documentElement.dataset.jarvis).toBeUndefined();
  });

  it("the retired compy_jarvis_motion key is inert — an old '0' cannot stand the layer down", () => {
    localStorage.setItem("compy_jarvis_motion", "0");
    setMotionPref("full");
    const { container } = render(shell("home"));
    expect(container.querySelectorAll(".v2-nav-item[data-magnetic]").length).toBe(ITEMS.length);
  });
});

describe("reduced ⇒ byte-identity (the one off-switch)", () => {
  beforeEach(() => setMotionPref("reduced"));

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

describe("motion full — the layer is live", () => {
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

  it("a bare motion flip is not a navigation — no wipe without a room change", () => {
    setMotionPref("reduced");
    const { container, rerender } = render(shell("home"));
    rerender(shell("play")); // room change while reduced — tracked, but must not wipe
    expect(container.querySelector(".jv-retune")).toBeNull();
    act(() => setMotionPref("full")); // flip to full — still not a navigation
    expect(container.querySelector(".jv-retune")).toBeNull();
  });

  it("a mid-session reduced flip stands the live layer down", () => {
    const { container } = render(shell("home"));
    expect(container.querySelector("[data-magnetic]")).not.toBeNull();
    act(() => setMotionPref("reduced"));
    expect(container.querySelector("[data-magnetic]")).toBeNull();
  });
});

describe("honest data-tick (ArcGauge, motion full)", () => {
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
