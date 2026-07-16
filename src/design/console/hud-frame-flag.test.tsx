// compy_hud_frame guards (console-HUD direction §viewport frame, 2026-07-15). The app-wide
// viewport HUD frame + shell-scoped reticle ship DEFAULT ON (graduated-flag convention, no
// Settings row); "0" is the devtools failsafe. Pins: default-ON renders the frame with honest
// readouts only (real rig/stamp/ledger/clock — a missing source is OMITTED, never faked),
// "0" removes frame + shell reticle entirely, and the stage-scoped ReticleCursor instances
// SELF-DEFER while the flag is on (one reticle, never two) but return when it's off.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ShellV2 } from "../ShellV2";
import { ReticleCursor } from "./ReticleCursor";
import { railFor } from "../homeRail";

// Mutable stamp behavior: the honest-omission pin flips this to a rejecting probe.
let stampResult: () => Promise<string> = () => Promise.resolve("ab12cd3 · dev");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? stampResult() : Promise.resolve(null),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  stampResult = () => Promise.resolve("ab12cd3 · dev");
});

const ITEMS = railFor(true);

const shell = (over: Partial<Parameters<typeof ShellV2>[0]> = {}) => (
  <ShellV2
    items={ITEMS}
    activeId="home"
    onNavigate={() => {}}
    ledgerCount={41}
    version="0.1.0"
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
    const { container } = render(shell({ rig: "Ryzen 7 · RX 9070 XT" }));
    const frame = container.querySelector(".hud-frame");
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.querySelectorAll(".hud-frame-c").length).toBe(4);

    const readout = container.querySelector(".hud-frame-readout");
    expect(readout?.textContent).toContain("Ryzen 7 · RX 9070 XT");
    // System clock: HH:MM:SS — real, ticking, never fabricated.
    expect(readout?.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    // NO DUPLICATION (self-review 2026-07-15): the ledger count lives in the rail foot and
    // the build stamp in the topbar — the readout must never repeat either on screen.
    await waitFor(() =>
      expect(container.querySelector(".v2-stamp")?.textContent).toContain("ab12cd3 · dev"),
    );
    expect(readout?.textContent).not.toContain("ledger");
    expect(readout?.textContent).not.toContain("ab12cd3");
  });

  it("mounts the shell-scoped reticle (appWide), direct child of .v2-shell", () => {
    const { container } = render(shell());
    expect(container.querySelector(".v2-shell > .lc-reticle")).toBeTruthy();
  });

  it("HONEST OMISSION: no rig probe → the segment is absent, not faked (clock alone remains)", async () => {
    stampResult = () => Promise.reject(new Error("probe failed"));
    const { container } = render(shell({ rig: null }));
    // Let the rejected stamp promise settle — the readout must never gain a stamp either way.
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
