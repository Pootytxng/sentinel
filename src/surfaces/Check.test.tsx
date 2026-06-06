import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// useScan polls real commands on mount; mock invoke to feed a tiny readiness/priorities scan.
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

import Check from "./Check";

afterEach(cleanup);

describe("Check", () => {
  it("renders the Check header + the scanned rows from the shared scan", async () => {
    render(<Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />);
    expect(screen.getByText("Check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-run check|Scanning/ })).toBeInTheDocument();
    // The real readiness check streams into the shared scan rows.
    expect(await screen.findByText("SSD check")).toBeInTheDocument();
  });
});
