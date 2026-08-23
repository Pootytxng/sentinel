// compy_hud_frame guards (console-HUD direction §viewport frame, 2026-07-15). The app-wide
// viewport HUD frame + shell-scoped reticle ship DEFAULT ON (graduated-flag convention, no
// Settings row); "0" is the devtools failsafe. Pins: default-ON renders the frame with honest
// readouts only (real rig/stamp/ledger/clock — a missing source is OMITTED, never faked),
// "0" removes frame + shell reticle entirely, and the stage-scoped ReticleCursor instances
// SELF-DEFER while the flag is on (one reticle, never two) but return when it's off.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { ShellV2 } from "../ShellV2";
import { ReticleCursor } from "./ReticleCursor";
import { railFor } from "../homeRail";

// The shell no longer probes `get_build_stamp` (the topbar node it fed was removed 2026-08-18),
// so this answers the command with the stamp the duplication pin above searches the DOM for. If
// the shell ever starts printing it again, that pin fails — which is the point of keeping the
// mock rather than deleting it along with the probe.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ITEMS = railFor(true);

const shell = (over: Partial<Parameters<typeof ShellV2>[0]> = {}) => (
  <ShellV2
    items={ITEMS}
    activeId="home"
    onNavigate={() => {}}
    ledgerCount={41}
   
    {...over}
  >
    <div data-testid="room">room</div>
  </ShellV2>
);

// A classic stage mount (how HomeConsole/LabConsole/MonitorConsole use the reticle).
function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="stage">
      <ReticleCursor scopeRef={ref} />
    </div>
  );
}

describe("compy_hud_frame default ON (the HUD frame + shell reticle)", () => {
  it("renders the frame: four corner brackets + the rig·clock readout, nothing duplicated", async () => {
    // NOT on Health: since the four-room rebuild that room names the processor and GPU in its
    // own Detected record and on the 3D rig, so the shell stands the readout's rig segment down
    // there rather than print it a third time (hud-readout-no-duplicate-guard, issue #49).
    // This case is about the frame ITSELF, so it renders in a room that still reads the rig.
    const { container } = render(shell({ rig: "Ryzen 7 · RX 9070 XT", activeId: "play" }));
    const frame = container.querySelector(".hud-frame");
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.querySelectorAll(".hud-frame-c").length).toBe(4);

    const readout = container.querySelector(".hud-frame-readout");
    expect(readout?.textContent).toContain("Ryzen 7 · RX 9070 XT");
    // System clock: HH:MM:SS — real, ticking, never fabricated.
    expect(readout?.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    // NO DUPLICATION (self-review 2026-07-15): the ledger count lives in the rail foot, and the
    // build stamp now lives in Settings → About (navigation audit §4, topbar node removed
    // 2026-08-18). This used to prove "the stamp is in the topbar, not here"; with the topbar node
    // gone it proves the STRONGER thing — no build stamp anywhere in the shell.
    //
    // The settle stays on purpose. The shell no longer probes for a stamp, so there is nothing to
    // await today; but if a future change reintroduces an async probe, asserting before it resolved
    // would pass vacuously and hide precisely the regression this line exists to catch.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".v2-stamp")).toBeNull();
    expect(container.textContent).not.toContain("ab12cd3");
    expect(readout?.textContent).not.toContain("ledger");
  });

  it("mounts the shell-scoped reticle (appWide), direct child of .v2-shell", () => {
    const { container } = render(shell());
    expect(container.querySelector(".v2-shell > .lc-reticle")).toBeTruthy();
  });

  it("HONEST OMISSION: no rig probe → the segment is absent, not faked (clock alone remains)", async () => {
    const { container } = render(shell({ rig: null }));
    // Let any pending probe settle — the readout must never gain a segment either way.
    await new Promise((r) => setTimeout(r, 0));
    const text = container.querySelector(".hud-frame-readout")?.textContent ?? "";
    // Clock only — no separator, no fabricated rig/stamp/ledger segment.
    expect(text).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
    expect(text).not.toContain(" · ");
  });

  it("stage-scoped ReticleCursor instances SELF-DEFER while the flag is on (one reticle, never two)", () => {
    const { container } = render(<Stage />);
    expect(container.querySelector(".lc-reticle")).toBeNull();
  });
});

describe('compy_hud_frame "0" failsafe', () => {
  it("removes the frame and the shell reticle entirely", () => {
    localStorage.setItem("compy_hud_frame", "0");
    const { container } = render(shell({ rig: "Ryzen 7" }));
    expect(container.querySelector(".hud-frame")).toBeNull();
    expect(container.querySelector(".lc-reticle")).toBeNull();
  });

  it("hands the reticle back to the stage scopes (classic behavior restored)", () => {
    localStorage.setItem("compy_hud_frame", "0");
    const { container } = render(<Stage />);
    expect(container.querySelector(".lc-reticle")).toBeTruthy();
  });
});
