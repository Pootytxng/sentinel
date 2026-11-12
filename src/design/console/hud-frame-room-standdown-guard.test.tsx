// bug→guard for the Codex REJECT of candidate 9bef1cc2 (2026-08-27).
//
// The owner rejected the installed Test room for, among other things, "an unapproved competing
// layer": the app-wide HUD frame's four viewport brackets and its bottom-right hardware readout,
// drawn over a room whose entire upper panel is the 3D rig those values describe. The approved Test
// composition has neither — verified by cropping the comp's own bottom-right corner, which is empty.
//
// This pins BOTH halves of the stand-down, because only one of them is visible:
//
//   the mount    no brackets, no readout in Test.
//   the CLASS    `.v2-shell-hud` also reserves a 36px band at the foot of the scroll lane for the
//                readout (hud-frame.css, `margin-bottom: 36px`). A room with no readout that still
//                gave up 36px would pay rent on a tenant who moved out, and at 1280x720 that band
//                is a station row — the exact viewport the same review failed the room at.
//
// And the anti-vacuous half: another room must still get the frame, or this guard would pass just
// as happily on a build that dropped HudFrame from the shell entirely.
//
// Room id "lab" is the tab labelled Test (ids are persistence keys; the user never sees them).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Same file-scoped IPC mocks the sibling shell guards use: the shell reaches for the window chrome
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

function shellIn(activeId: HomeRailId) {
  // The frame draws only on the Solid surface since the glass redesign (2026-10-30).
  localStorage.setItem("compy_surface", "solid");
  const { container } = render(
    <ShellV2
      items={ITEMS}
      activeId={activeId}
      onNavigate={() => {}}
      ledger={[]}
      rig="Ryzen 7 · RX 9070 XT"
    >
      <p>Room content</p>
    </ShellV2>,
  );
  return {
    frame: container.querySelector(".hud-frame"),
    shell: container.querySelector(".v2-shell")!,
  };
}

describe("the viewport HUD frame stands down in the room that is already an instrument", () => {
  it("draws no frame and reserves no readout band in Test", () => {
    const { frame, shell } = shellIn("lab");
    expect(frame, "Test's own bench draws the only edge in that room").toBeNull();
    expect(
      shell.classList.contains("v2-shell-hud"),
      "the 36px readout reserve must go with the readout — otherwise Test pays for a band nothing " +
        "draws in, and at 1280x720 that band is a station row",
    ).toBe(false);
  });

  it("still frames a room that is not Test — the anti-vacuous half", () => {
    const { frame, shell } = shellIn("play");
    expect(frame, "this guard must fail if HudFrame is dropped from the shell outright").not.toBeNull();
    expect(shell.classList.contains("v2-shell-hud")).toBe(true);
  });
});
