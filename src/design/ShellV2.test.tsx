import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ShellV2, ROOM_CRUMB } from "./ShellV2";
import { railFor, HOME_RAIL } from "./homeRail";

// V2-2 shell guards: the rail renders the blessed room set with WORKING digit hints (a hint that
// does nothing is a fake affordance), the topbar carries room title + plain-English crumb + the
// real build stamp (never a fabricated one), and the footer states the outbound-honesty +
// reversibility promises with the MEASURED ledger count. (Updater ARMED 2026-07-22: the footer
// names the signed update check as the one outbound call — "zero outbound" would now be a lie.)

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));

afterEach(cleanup);

const ITEMS = railFor(true); // merged (the shipped default): Home · Optimize · Monitor · Blackbook · Lab

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

describe("ShellV2 rail", () => {
  it("renders one tab per rail room, in rail order, with 1-based digit hints", () => {
    render(shell());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(
      ITEMS.map((it, i) => `${it.label}${i + 1}`),
    );
  });

  it("marks the active room and navigates on click", () => {
    const onNavigate = vi.fn();
    render(shell({ onNavigate }));
    expect(screen.getByRole("tab", { name: /Home/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Monitor/ }));
    expect(onNavigate).toHaveBeenCalledWith("play");
  });

  it("every rail id has a plain-English crumb", () => {
    for (const r of HOME_RAIL) expect(ROOM_CRUMB[r.id]).toBeTruthy();
  });

  it("footer: outbound-honesty line + reversibility line with the measured ledger count", () => {
    render(shell());
    expect(screen.getByText("Outbound: signed update check only")).toBeTruthy();
    expect(screen.getByText("ledger 41")).toBeTruthy();
  });
});

describe("ShellV2 digit shortcuts (the kbd hints must WORK)", () => {
  it("pressing a digit navigates to that room", () => {
    const onNavigate = vi.fn();
    render(shell({ onNavigate }));
    fireEvent.keyDown(window, { key: "2" });
    expect(onNavigate).toHaveBeenCalledWith(ITEMS[1].id);
  });

  it("never fires while typing or with a modifier held", () => {
    const onNavigate = vi.fn();
    render(
      <ShellV2 items={ITEMS} activeId="home" onNavigate={onNavigate} ledgerCount={0} version="0.1.0">
        <input aria-label="field" />
      </ShellV2>,
    );
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "2" });
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    fireEvent.keyDown(window, { key: "9" }); // out of range
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("ShellV2 topbar", () => {
  it("shows the active room title, its crumb, and the REAL build stamp once fetched", async () => {
    const { container } = render(shell({ activeId: "play" }));
    expect(container.querySelector(".v2-room-title")?.textContent).toBe("Monitor");
    expect(screen.getByText(`· ${ROOM_CRUMB.play}`)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("ab12cd3 · dev")).toBeTruthy());
  });
});
