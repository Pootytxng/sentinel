// R3 Lane C3 — the consent surface stays DARK while the backend gate is false, and the
// inspect-your-receipt preview renders EXACTLY what the backend would share when (in a future
// owner-signed build) the gate is up.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

const gateMock = vi.hoisted(() => ({ enabled: false }));

const PAYLOAD = {
  schema_version: 1,
  hw_class: { gpu_vendor: "amd", gpu_model: "radeon rx 9070 xt", cpu_family: "ryzen x3d-class", ram_gb_bucket: "25-32" },
  outcome: {
    kind: "session",
    game: "game",
    avg_fps: 141.2,
    low1_fps_est: 118,
    duration_bucket: "30-60min",
    active_change_ids: ["hags"],
  },
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_receipts_gate") return Promise.resolve(gateMock.enabled);
    if (cmd === "preview_receipt_payload")
      return gateMock.enabled
        ? Promise.resolve(PAYLOAD)
        : Promise.reject("Receipts sharing isn't part of this build yet.");
    return Promise.resolve(null);
  }),
}));

import ReceiptsConsent from "./ReceiptsConsent";

afterEach(() => {
  cleanup();
  gateMock.enabled = false;
});

describe("ReceiptsConsent (dark)", () => {
  it("renders NOTHING while the backend gate is hard-false (every shipped build today)", async () => {
    const { container } = render(<ReceiptsConsent />);
    // Settle the gate probe, then assert total darkness.
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId("receipts-consent")).toBeNull();
  });

  it("when a future build flips the gate: consent copy + the exact inspectable payload render", async () => {
    gateMock.enabled = true;
    render(<ReceiptsConsent />);
    expect(await screen.findByTestId("receipts-consent")).toBeInTheDocument();
    expect(screen.getByText(/Off by default, anonymous by design/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect your receipt" }));
    // What you see is what would send — the rendered preview IS the payload, verbatim.
    const pre = await screen.findByText(/"schema_version": 1/);
    expect(pre.textContent).toBe(JSON.stringify(PAYLOAD, null, 2));
    expect(pre.textContent).not.toContain("Users");
  });
});
