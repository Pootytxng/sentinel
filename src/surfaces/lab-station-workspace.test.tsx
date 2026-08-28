import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// MISSION 1 GUARD — THE SELECTED STATION OWNS THE ROOM.
//
// The defect this file was written to prove (RED before the fix, 2026-08-28): opening a station
// left Test in its OVERVIEW composition. RoomShell derives `data-layout="split"` from `aside !=
// null`, LabConsole passed the bench aside unconditionally, and the station body was mounted as a
// `<BentoTile span="full">` INSIDE the narrative column. So the thing the user just asked for got
// the narrow story column while the rig hologram, the four bench readings, the whole station list
// and the manual-parts disclosure kept the room around it — the chosen tool was the secondary
// object on its own screen.
//
// The contract below is the fix, stated as behaviour rather than pixels: with a station open the
// room LEAVES the split composition, the overview furniture unmounts, the station name is the one
// visible workspace heading (never printed twice), a keyboard-reachable "Back to Test" exists, and
// backing out restores the overview EXACTLY — including focus, which returns to the control that
// opened the station.
//
// Not covered here on purpose: every station's own content, loading, empty/NOT-YET and refusal
// states, which their own suites already pin. This guard is about the container.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("./rig/RigViewer", () => ({
  RigViewer: () => <div data-testid="rig-hologram" />,
}));

const { LabConsole } = await import("./LabConsole");
const { ConfirmProvider } = await import("../design/ConfirmDialog");
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { HardwareInfo } from "../App";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const recsFixture = [
  {
    id: "game-mode",
    title: "Game Mode",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  },
] as never[];

const hwFixture = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [
    { mount_point: "C:\\", total_bytes: 1000 * 1024 ** 3, available_bytes: 130 * 1024 ** 3, file_system: "NTFS" },
  ],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const fast: LabFastPathProps = {
  recs: recsFixture,
  startup: [],
  changes: [] as never[],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  onChanged: () => {},
  sessions: [],
  gpus: [],
  vendor: "amd",
};

const base = {
  fast,
  diagnostics: <div data-testid="diag" />,
  diagnosticsCaptured: true,
  vendor: "amd" as const,
  hw: hwFixture,
  hud: true,
  ledState: "ok" as const,
  classicVerdict: "Everything checked out.",
  below: <div data-testid="room-below" />,
};

const renderConsole = () =>
  render(
    <ConfirmProvider>
      <LabConsole {...base} />
    </ConfirmProvider>,
  );

const room = () => document.querySelector<HTMLElement>('.v2-room[data-room="lab"]')!;
const dockRows = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".dock-node"));
const rowNamed = (name: string) =>
  dockRows().find((b) => b.querySelector(".dock-nm")?.textContent === name)!;
// Every station this rig can actually open, read off the dock the room itself renders — never a
// hardcoded six. A rig that cannot render Tuning has no Tuning row, and this guard must not invent
// one to make the count look complete.
const openableNames = () => dockRows().map((b) => b.querySelector(".dock-nm")!.textContent!);
const backButton = () => document.querySelector<HTMLButtonElement>(".lc-ws-back");
const workspaceHeading = () => document.querySelector<HTMLElement>(".v2-room > .v2-verdict h1");

describe("Test — the selected station owns the room", () => {
  it("with NO station open, the overview composition is untouched", () => {
    renderConsole();
    expect(room().getAttribute("data-layout")).toBe("split");
    expect(document.querySelector(".v2-room-aside")).not.toBeNull();
    expect(document.querySelector(".lc-bench")).not.toBeNull();
    expect(document.querySelectorAll(".lc-readings > .lc-reading")).toHaveLength(4);
    expect(document.querySelector(".lc-headline")).not.toBeNull();
    expect(document.querySelector(".lc-start")).not.toBeNull();
    expect(document.querySelector(".lc-manual")).not.toBeNull();
    expect(dockRows().length).toBeGreaterThan(1);
    expect(backButton()).toBeNull();
  });

  it("opening a station LEAVES the split composition — no aside reserves the right side", () => {
    renderConsole();
    fireEvent.click(rowNamed("Latency"));
    expect(room().getAttribute("data-layout")).toBeNull();
    expect(document.querySelector(".v2-room-aside")).toBeNull();
  });

  it("the overview furniture unmounts — the station is not squeezed in beside it", () => {
    renderConsole();
    fireEvent.click(rowNamed("Latency"));
    expect(document.querySelector(".lc-bench"), "rig stage").toBeNull();
    expect(document.querySelector(".lc-readings"), "bench reading strip").toBeNull();
    expect(document.querySelector(".lc-headline"), "room narrative headline").toBeNull();
    expect(document.querySelector(".lc-start"), "dominant Optimize action").toBeNull();
    expect(document.querySelector(".dock"), "full station list").toBeNull();
    expect(document.querySelector(".lc-manual"), "manual-parts disclosure").toBeNull();
    expect(document.querySelector('[data-testid="room-below"]'), "the room's below surfaces").toBeNull();
  });

  it("the station name is the ONE visible heading, never printed twice", () => {
    renderConsole();
    fireEvent.click(rowNamed("Latency"));
    expect(workspaceHeading()!.textContent).toContain("Latency");
    // The old shape printed it in the enclosing BentoTile's title as well — a page header and a
    // card header saying the same word an inch apart.
    const tileTitles = Array.from(document.querySelectorAll(".v2-tile-title")).map((n) => n.textContent);
    expect(tileTitles).not.toContain("Latency");
  });

  it("carries a compact workspace header: the station mark, its purpose line, and Back to Test", () => {
    renderConsole();
    fireEvent.click(rowNamed("Latency"));
    const back = backButton();
    expect(back, "a Back to Test control").not.toBeNull();
    expect(back!.tagName, "keyboard-reachable by construction").toBe("BUTTON");
    expect(back!.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector(".lc-ws-ic"), "the existing station icon").not.toBeNull();
    // The station's existing short purpose sentence — its dockLine, the same string the list row
    // prints. New copy for this header would be a claim nobody wrote.
    expect(document.querySelector(".v2-verdict-sub")!.textContent).toBe(
      "Check system and network latency.",
    );
  });

  it("every station this rig can open enters the SAME workspace, one body at a time", () => {
    renderConsole();
    const names = openableNames();
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      fireEvent.click(rowNamed(name));
      expect(room().getAttribute("data-layout"), name).toBeNull();
      expect(workspaceHeading()!.textContent, name).toContain(name);
      expect(document.querySelectorAll(".lc-detail"), name).toHaveLength(1);
      fireEvent.click(backButton()!);
      expect(document.querySelector(".lc-bench"), `${name} -> back`).not.toBeNull();
    }
  });

  it("the dominant Optimize action opens the same workspace the list row does", () => {
    renderConsole();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".lc-start")!);
    expect(room().getAttribute("data-layout")).toBeNull();
    expect(workspaceHeading()!.textContent).toContain("Optimize");
  });

  it("Back to Test restores the overview unchanged", () => {
    renderConsole();
    fireEvent.click(rowNamed("Benchmark"));
    fireEvent.click(backButton()!);
    expect(room().getAttribute("data-layout")).toBe("split");
    expect(document.querySelector(".lc-bench")).not.toBeNull();
    expect(document.querySelectorAll(".lc-readings > .lc-reading")).toHaveLength(4);
    expect(document.querySelector(".lc-headline")).not.toBeNull();
    expect(document.querySelector('[data-testid="room-below"]')).not.toBeNull();
    expect(document.querySelector(".lc-detail")).toBeNull();
    expect(backButton()).toBeNull();
  });

  it("focus enters the workspace on open and returns to the exact opener on back", () => {
    renderConsole();
    fireEvent.click(rowNamed("Benchmark"));
    expect(
      document.activeElement,
      "focus must land in the workspace, not stay on an unmounted row",
    ).toBe(workspaceHeading()!.querySelector(".lc-ws-title"));
    fireEvent.click(backButton()!);
    expect(document.activeElement).toBe(rowNamed("Benchmark"));
  });

  // -- THE STICKY-CHROME DEFECT (measured on the installed build eda73547 at 1280x720) ---------
  //
  // The first cut of this effect scrolled the workspace TITLE with `block: "nearest"`. "Nearest"
  // performs the MINIMUM scroll, so where the room settled depended on where the reader happened
  // to be standing when they clicked -- scrollTop measured at 0, 36 and 66 across identical opens
  // of the same station, because backing out returns focus to a dock row that may itself be down
  // the page. At 66 the "Back to Test" control had a viewport rect of top 44 / bottom 71, and
  // `document.elementFromPoint()` at the button's own centre returned `.v2-top`, not the button:
  // the only way out of the workspace was painted over by the fixed chrome above it (`.wc-bar`,
  // 34px at z-index 9000, WindowChrome.css:34; `.v2-top`, 50px, shell-v2.css:224). Scrolling up
  // could not reveal it -- 66 was already the position the effect had chosen.
  //
  // The fix is to stop asking for a relative scroll. The workspace REPLACES the room, so its top
  // is the content's top: put the room's scroller back to 0 and the header lands exactly where the
  // overview's own first element sits, which every capture proves is clear of the chrome. One
  // outcome, independent of where the reader was. The `scrollIntoView` path below it is the
  // fallback for a Test rendered outside the shell scroller, and it aligns to "start" for the same
  // determinism. Both halves are pinned here; drop either and this file goes red.
  it("puts the room's scroller back to the top, so nothing opens under the fixed chrome", () => {
    const { container } = render(
      <ConfirmProvider>
        <div className="v2-content">
          <LabConsole {...base} />
        </div>
      </ConfirmProvider>,
    );
    const scroller = container.querySelector<HTMLElement>(".v2-content")!;
    scroller.scrollTop = 400; // the reader was down the page, on a dock row near the bottom
    fireEvent.click(rowNamed("Benchmark"));
    expect(
      scroller.scrollTop,
      "the workspace opened wherever the reader was standing, not at its own top",
    ).toBe(0);
  });

  it("with no shell scroller, brings the TOP of the workspace on screen, aligned to start", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      renderConsole();
      fireEvent.click(rowNamed("Benchmark"));
      const ctx = spy.mock.contexts as unknown as (Element | undefined)[];
      const i = ctx.findIndex((el) => !!el?.classList?.contains("lc-ws-bar"));
      expect(
        i,
        "the workspace bar -- the row carrying the only way out -- is never scrolled to",
      ).toBeGreaterThanOrEqual(0);
      expect(spy.mock.calls[i]?.[0]).toEqual({ block: "start" });
    } finally {
      spy.mockRestore();
    }
  });

  // -- THE FOCUS RETURNS TO A ROW NOBODY CAN SEE (found on the installed build 151677ce) --------
  //
  // Backing out of a workspace returns focus to the exact row that opened it, which is this
  // mission's own contract and is pinned above. The installed review then measured what that row
  // looks like when it holds focus: nothing. The global feedback floor draws the ring as
  // `outline: 2px solid var(--ix-accent); outline-offset: 2px` (doorknob.css:58) -- two pixels
  // OUTSIDE the border box -- and `.dock-node` carries a `clip-path` polygon that notches its
  // bottom-right corner (dock.css:45) and clips to that same box. The ring is drawn and then
  // clipped away entirely: computed style reports it, a zoomed pixel crop of the focused row shows
  // no ring at all, and setting `clip-path: none` on that one element makes it appear instantly.
  // A keyboard user backing out of a station lost their place with no way to tell where they were.
  //
  // The compensation is a NEGATIVE outline-offset, which draws the ring inside the clip instead of
  // outside it, and it is scoped to the Test room in Test's own sheet. `.dock-node` is shared with
  // Health (HomeConsole renders the same Dock) and Health is locked scope for this mission, so the
  // shared rule is left exactly as it is -- Health keeps the defect and keeps its own decision.
  // Recorded for the backlog rather than fixed here.
  it("the row focus returns to can actually paint its focus ring", () => {
    const dockCss = readFileSync(join("src", "design", "console", "dock.css"), "utf8");
    const clipped = /\.dock-node\s*\{[^}]*clip-path:/.test(dockCss);
    if (!clipped) return; // the clip is gone; the ring is no longer being cut off, so is this rule
    const labCss = readFileSync(join("src", "surfaces", "lab-console.css"), "utf8");
    const rule =
      labCss.match(/\[data-room="lab"\][^{]*\.dock-node:focus-visible\s*\{[^}]*\}/)?.[0] ?? "";
    expect(
      rule,
      "Test's dock rows are clipped and nothing pulls their focus ring inside the clip",
    ).not.toBe("");
    const offset = Number(rule.match(/outline-offset:\s*(-?\d+)px/)?.[1] ?? 1);
    expect(
      offset,
      "the ring is still drawn outside a clipped box, which paints zero pixels",
    ).toBeLessThan(0);
  });

  it("focus returns to the dominant action when the dominant action opened it", () => {
    renderConsole();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".lc-start")!);
    fireEvent.click(backButton()!);
    expect(document.activeElement).toBe(document.querySelector(".lc-start"));
  });
});
