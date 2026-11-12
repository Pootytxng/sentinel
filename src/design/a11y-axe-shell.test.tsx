// C-13, part two: the SHELL. Same axe guard as `a11y-axe-guard.test.tsx`, split into its own file
// because these components reach for Tauri (build stamp, ledger health, window chrome, the updater)
// and `vi.mock` is file-scoped — mocking the whole IPC surface in the leaf-component roster would
// mock it for components that must not have it mocked.
//
// This half matters more than its size suggests: the rail, the topbar, the room frame and the
// command palette are the chrome a user meets on EVERY screen, so one unnamed control here is one
// unnamed control everywhere. Read `src/test/axe.ts` for what axe can and cannot see under jsdom —
// contrast is not checked here and cannot be.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));

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
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

import { expectNoAxeViolations } from "../test/axe";
import { ShellV2 } from "./ShellV2";
import { RoomShell, ForwardDoor } from "./room-shell";
import { CommandPalette } from "./CommandPalette";
import { UpdatePill } from "./UpdatePill";
import { WindowChrome } from "./WindowChrome";
import { railFor, type HomeRailItem } from "./homeRail";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ITEMS: HomeRailItem[] = railFor(false, true);
const railLabel = (item: HomeRailItem) => item.label;

const shell = (activeId: HomeRailItem["id"] = "home") => (
  <ShellV2
    items={ITEMS}
    activeId={activeId}
    onNavigate={() => {}}
    ledger={[]}
    rig="Ryzen 7 · RX 9070 XT"
    onOpenStation={() => {}}
    onOpenEntry={() => {}}
    onOpenSettings={() => {}}
  >
    <p>Room content</p>
  </ShellV2>
);

describe("axe · the app shell a user meets on every screen", () => {
  it("ShellV2 — rail, topbar and footer", async () => {
    const { container } = render(shell());
    // Wait for the rail to be live before measuring: an unresolved shell is a skeleton, and a
    // skeleton has fewer controls to get wrong. (ShellV2 deliberately does NOT probe the build
    // stamp — see its `NO BUILD-STAMP PROBE HERE` note; nothing here should wait for one.)
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(ITEMS.length));
    await expectNoAxeViolations(container);
  });

  it("RoomShell — every slot filled, inside the shell that provides its nav context", async () => {
    const { container } = render(
      <ShellV2
        items={ITEMS}
        activeId="fix"
        onNavigate={() => {}}
        ledger={[]}
        rig={null}
      >
        <RoomShell
          room="fix"
          verdict="Your PC is healthy."
          sub="2 small wins available"
          measured="last full check 14 min ago"
          primaryAction={<button type="button">Apply</button>}
          quiet={<button type="button" className="v2-quiet">Nothing else needs attention</button>}
        >
          <p>Room body</p>
        </RoomShell>
      </ShellV2>,
    );
    await expectNoAxeViolations(container);
  });

  it("ForwardDoor", async () => {
    const { container } = render(
      <ShellV2 items={ITEMS} activeId="fix" onNavigate={() => {}} ledger={[]} rig={null}>
        <ForwardDoor to="play" label="Watch it live" />
      </ShellV2>,
    );
    await expectNoAxeViolations(container);
  });

  it("CommandPalette — open, and filtered down to results", async () => {
    const { container } = render(
      <CommandPalette
        open
        onClose={() => {}}
        rail={ITEMS}
        railLabel={railLabel}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenEntry={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await expectNoAxeViolations(container);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "set" } });
    await expectNoAxeViolations(container);
  });

  it("WindowChrome", async () => {
    const { container } = render(<WindowChrome />);
    await expectNoAxeViolations(container);
  });
});

describe("axe · the update offer, in the state a user has to decide about", () => {
  it("UpdatePill — idle, and with an update offered", async () => {
    mocks.check.mockResolvedValue(null);
    const idle = render(<UpdatePill />);
    await expectNoAxeViolations(idle.container);
    cleanup();

    mocks.check.mockResolvedValue({
      version: "9.9.9",
      body: "- Fixed a crash\n- Faster checks",
      downloadAndInstall: vi.fn(),
      close: vi.fn(),
    });
    const offered = render(<UpdatePill />);
    await waitFor(() => expect(screen.getByText(/9\.9\.9/)).toBeTruthy());
    await expectNoAxeViolations(offered.container);
  });
});
