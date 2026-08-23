// bug→guard (self-review round 2, issue #49, 2026-08-23).
//
// `HudFrame`'s own doctrine is that the readout carries ONLY values no other chrome shows — the
// ledger count lives in the rail foot, the build stamp in the topbar, "so repeating them here would
// put each on screen twice" (self-review 2026-07-15). The four-room Health rebuild broke that from
// the other direction: the room itself grew a Detected record that names the processor and the GPU,
// and the 3D rig annotates the same two parts, so the shell's rig line became the THIRD copy of the
// same fact — while sitting in an opaque bottom-right box over the readings.
//
// The rule this pins: on Health the rig segment stands down, and the readout collapses to the one
// value nothing else shows (the clock). Everywhere else it still reads. The second case is what
// stops this guard from passing vacuously if `HudFrame` were ever dropped from the shell entirely.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Same file-scoped IPC mocks as `a11y-axe-shell.test.tsx`: the shell reaches for the window chrome
// and the updater, neither of which exists under jsdom.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    startDragging: () => Promise.resolve(),
    startResizeDragging: () => Promise.resolve(),
  }),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { ShellV2 } from "../ShellV2";
import { railFor, type HomeRailId, type HomeRailItem } from "../homeRail";

afterEach(cleanup);

const ITEMS: HomeRailItem[] = railFor(false, true);
const RIG = "Ryzen 7 · RX 9070 XT";

function readoutText(activeId: HomeRailId): string | null {
  const { container } = render(
    <ShellV2
      items={ITEMS}
      activeId={activeId}
      onNavigate={() => {}}
      ledgerCount={3}
      rig={RIG}
    >
      <p>Room content</p>
    </ShellV2>,
  );
  const el = container.querySelector(".hud-frame-readout");
  return el ? (el.textContent ?? "") : null;
}

describe("the HUD readout never repeats a fact the room already shows", () => {
  it("stands the rig down on Health, where the Detected record and the 3D rig both name it", () => {
    const text = readoutText("home");
    expect(text, "the HUD readout must still render on Health — only its rig segment stands down")
      .not.toBeNull();
    expect(
      text,
      "Health shows the processor and GPU in its Detected record AND on the rig; the readout " +
        "must not print them a third time (issue #49 self-review round 2).",
    ).not.toContain("RX 9070 XT");
  });

  it("still reads the rig in a room that does not show it — the anti-vacuous half", () => {
    expect(readoutText("play")).toContain("RX 9070 XT");
  });
});
