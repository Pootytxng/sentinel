import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// FirstCheck drives the shared useScan — feed it one ready check and no limiters.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "get_priorities")
      return Promise.resolve({ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null });
    if (cmd === "get_recommendations") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import FirstCheck, { FIRST_CHECK_KEY } from "./FirstCheck";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("FirstCheck (audit M1)", () => {
  it("clean rig verdict celebrates the measured win without inventing work (doctrine voice)", async () => {
    render(
      <ConfirmProvider>
        <FirstCheck onDone={vi.fn()} />
      </ConfirmProvider>,
    );
    expect(
      await screen.findByText("Ready to play — this rig measured clean"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every check came back right — measured on this rig, not assumed\./),
    ).toBeInTheDocument();
    // The anti-snake-oil close: green checks are named, work is never invented.
    expect(screen.getByText(/1 checks measured perfect — confirmed right on this rig/)).toBeInTheDocument();
    expect(screen.getByText(/won't invent work to look busy/)).toBeInTheDocument();
  });

  it("finishing marks the first check seen (gate key) and hands off to the app", async () => {
    const onDone = vi.fn();
    render(
      <ConfirmProvider>
        <FirstCheck onDone={onDone} />
      </ConfirmProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open the dashboard" }));
    expect(onDone).toHaveBeenCalled();
    expect(localStorage.getItem(FIRST_CHECK_KEY)).toBe("1");
  });
});
