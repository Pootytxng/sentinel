import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LicensePanel } from "./LicensePanel";
import type { LicenseStatus } from "../types";

// Settable per-test backend responses (hoisted for the vi.mock factory).
const mock = vi.hoisted(() => ({
  status: { tier: "free", valid: false, armed: false, reason: "licensing not active", expires_at: null } as LicenseStatus,
  setResult: { tier: "free", valid: false, armed: true, reason: "license signature invalid", expires_at: null } as LicenseStatus,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_license_status") return Promise.resolve(mock.status);
    if (cmd === "set_license_key") return Promise.resolve(mock.setResult);
    return Promise.resolve(null);
  }),
}));

afterEach(() => {
  cleanup();
  mock.status = { tier: "free", valid: false, armed: false, reason: "licensing not active", expires_at: null };
  mock.setResult = { tier: "free", valid: false, armed: true, reason: "license signature invalid", expires_at: null };
});

describe("LicensePanel (Compy Pro — dark license surface)", () => {
  it("the DARK default shows the honest free state and NO entry form (no dead-end)", async () => {
    mock.status = { tier: "free", valid: false, armed: false, reason: "licensing not active", expires_at: null };
    render(<LicensePanel />);
    expect(await screen.findByText(/you're on the free version/i)).toBeInTheDocument();
    // never paywalls safety — the copy says core/safety is free
    expect(screen.getByText(/safety-critical/i)).toBeInTheDocument();
    // disarmed → no "Have a license key?" entry point
    expect(screen.queryByText(/have a license key/i)).not.toBeInTheDocument();
  });

  it("when licensing is ARMED, the entry form appears and a bad key shows a friendly note", async () => {
    mock.status = { tier: "free", valid: false, armed: true, reason: "no license", expires_at: null };
    render(<LicensePanel />);
    fireEvent.click(await screen.findByText(/have a license key/i));
    const input = screen.getByLabelText("License key");
    fireEvent.change(input, { target: { value: "bogus.key" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(await screen.findByText(/doesn't look valid/i)).toBeInTheDocument();
  });

  it("a valid Pro key flips the panel to 'Pro active'", async () => {
    mock.status = { tier: "free", valid: false, armed: true, reason: "no license", expires_at: null };
    mock.setResult = { tier: "pro", valid: true, armed: true, reason: "active", expires_at: null };
    render(<LicensePanel />);
    fireEvent.click(await screen.findByText(/have a license key/i));
    fireEvent.change(screen.getByLabelText("License key"), { target: { value: "good.key" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(await screen.findByText(/compy pro is active/i)).toBeInTheDocument();
  });
});
