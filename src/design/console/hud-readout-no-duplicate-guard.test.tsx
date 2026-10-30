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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ITEMS: HomeRailItem[] = railFor(false, true);
const RIG = "Ryzen 7 · RX 9070 XT";

function renderIn(activeId: HomeRailId) {
  // The readout exists only on the Solid surface since the glass redesign (2026-10-30).
  localStorage.setItem("compy_surface", "solid");
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
  return {
    readout: el ? (el.textContent ?? "") : null,
    pill: container.querySelector(".v2-rig-pill")?.textContent ?? null,
  };
}

describe("the HUD readout never repeats a fact the room already shows", () => {
  // GLASS REDESIGN (2026-10-30): the topbar's PC pill prints the rig line in EVERY room, so the
  // readout never prints it — on Health (where the Detected record and the 3D rig name it too) or
  // anywhere else. The readout still renders (clock) so this cannot pass by losing the frame.
  it("stands the rig down on Health, where the Detected record and the 3D rig both name it", () => {
    const { readout, pill } = renderIn("home");
    expect(readout, "the HUD readout must still render on Health — only its rig segment stands down")
      .not.toBeNull();
    expect(readout).not.toContain("RX 9070 XT");
    expect(pill).toContain("RX 9070 XT");
  });

  it("prints the rig exactly once in a room that has no rig of its own — the anti-vacuous half", () => {
    const { readout, pill } = renderIn("play");
    expect(readout).not.toBeNull();
    expect(readout).not.toContain("RX 9070 XT");
    expect(pill, "the rig must still be on screen once, in the topbar pill").toContain("RX 9070 XT");
  });
});
