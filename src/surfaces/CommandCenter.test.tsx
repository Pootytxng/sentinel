import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CommandCenter from "./CommandCenter";
import type { SessionSummary } from "../types";

// Minimal props — readiness/priorities null (shimmer/scanning states), no sessions (honest empty
// live strip), no linked limiter rec. Asserts the surface MOUNTS without throwing and shows honest
// pre-data states rather than fabricated numbers. (AmbientBackdrop's invoke/getContext are absent
// under jsdom but it fails soft, so the surface still renders.)
const hw = {
  cpu_brand: "Test CPU",
  cpu_cores_logical: 16,
  ram_total_bytes: 32 * 1024 ** 3,
  os_name: "Windows",
  os_version: "11",
  gpus: [{ name: "Test GPU" }],
  cpu_arch: { family_label: "Ryzen 7" },
  windows_version: { product_name: "Windows 11 Pro" },
};

const baseProps = {
  hw,
  readiness: null,
  priorities: null,
  sessions: [] as SessionSummary[],
  changes: [],
  limiterRec: undefined,
  limiterAppliable: false,
  limiterActiveChange: null,
  busyLimiter: false,
  onToggleLimiter: vi.fn(),
  onSeeInFix: vi.fn(),
  onNavigate: vi.fn(),
  onRunCheck: vi.fn(),
  onBack: vi.fn(),
  canGoBack: false,
};

describe("CommandCenter", () => {
  it("mounts and shows honest pre-data states (no fabricated numbers)", () => {
    render(<CommandCenter {...baseProps} />);
    expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeTruthy();
    // Ring shimmer label, never a faked score.
    expect(screen.getByText("Scanning")).toBeTruthy();
    // Honest empty live strip.
    expect(screen.getByText(/Play a session to see this/)).toBeTruthy();
    // Rig line carries real hardware.
    expect(screen.getByText(/16 threads/)).toBeTruthy();
  });

  it("renders the win state when priorities resolve with no limiters", () => {
    render(
      <CommandCenter
        {...baseProps}
        priorities={{ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null }}
      />,
    );
    expect(screen.getByText(/Nothing worth fixing today/)).toBeTruthy();
  });
});
