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
import { ConfirmProvider } from "../design/ConfirmDialog";
import { fireEvent } from "@testing-library/react";
import type { SessionSummary } from "../types";

afterEach(cleanup);

function sess(temp: number | null): SessionSummary {
  return {
    started_at: "2026-06-08T13:00:00Z",
    duration_secs: 3600,
    process_name: "game.exe",
    samples: 100,
    avg_fps: 140,
    avg_frametime_ms: 7.1,
    low1_fps_est: 138,
    peak_gpu_temp_c: temp,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
  };
}
const HOT = [sess(84), sess(83), sess(82)];

describe("Check", () => {
  it("renders the Check header + the scanned rows from the shared scan", async () => {
    render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="any" />
      </ConfirmProvider>,
    );
    expect(screen.getByText("Check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-run check|Scanning/ })).toBeInTheDocument();
    // The real readiness check streams into the shared scan rows.
    expect(await screen.findByText("SSD check")).toBeInTheDocument();
  });

  it("shows the tuning nudge ONLY when an AMD rig has run sustained-warm, linking to the guide", async () => {
    const onOpenLibrary = vi.fn();
    render(
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={onOpenLibrary}
          onChanged={vi.fn()}
          vendor="amd"
          sessions={HOT}
        />
      </ConfirmProvider>,
    );
    // Wait for the verdict phase (the result block) to render.
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
    expect(screen.getByText(/Your GPU's been running warm/i)).toBeInTheDocument();
    expect(screen.getByText(/Peaked at 84°C across your last 3 sessions/i)).toBeInTheDocument();
    // named-place law: the link is deliberate travel to the exact Learn guide.
    fireEvent.click(screen.getByRole("button", { name: /undervolt guide/i }));
    expect(onOpenLibrary).toHaveBeenCalledWith("amd-gpu-undervolt");
  });

  it("stays silent when temps are fine, or on a non-AMD rig (bathroom law / v1 scope)", async () => {
    const { rerender } = render(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="amd" sessions={[sess(60), sess(61), sess(59)]} />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
    expect(screen.queryByText(/running warm/i)).not.toBeInTheDocument();
    // NVIDIA rig, sustained-hot — still no nudge (no AMD guide; v1 AMD-only).
    rerender(
      <ConfirmProvider>
        <Check isAppliable={() => false} onOpenLibrary={vi.fn()} onChanged={vi.fn()} vendor="nvidia" sessions={HOT} />
      </ConfirmProvider>,
    );
    expect(screen.queryByText(/running warm/i)).not.toBeInTheDocument();
  });

  it("driver freshness: a >90-day driver shows the honest advisory with a copyable vendor URL", async () => {
    render(
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={vi.fn()}
          onChanged={vi.fn()}
          vendor="any"
          gpus={[{ name: "AMD Radeon RX 9070 XT", driver_age_days: 200 }]}
        />
      </ConfirmProvider>,
    );
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
    // Age is a fact; "newer exists" stays a maybe — never "out of date", no version claim.
    expect(screen.getByText(/Your AMD driver is 200 days old/)).toBeInTheDocument();
    expect(screen.getByText(/Newer ones may be available/)).toBeInTheDocument();
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument();
    // Copyable TEXT + a copy button — never a launch link (capabilities untouched).
    expect(screen.getByText("https://www.amd.com/en/support")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy link/ })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("driver freshness: unreadable date is a neutral skip; a recent driver is a quiet pass", async () => {
    const checkWith = (age: number | null) => (
      <ConfirmProvider>
        <Check
          isAppliable={() => false}
          onOpenLibrary={vi.fn()}
          onChanged={vi.fn()}
          vendor="any"
          gpus={[{ name: "AMD Radeon RX 9070 XT", driver_age_days: age }]}
        />
      </ConfirmProvider>
    );
    const { rerender } = render(checkWith(null));
    expect(await screen.findByText("Biggest limiters")).toBeInTheDocument();
    // Missing data is a skip, not an alarm — no age, no nudge, no URL.
    expect(screen.getByText(/Driver date unreadable — skip/)).toBeInTheDocument();
    expect(screen.queryByText(/days old/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
    rerender(checkWith(20));
    expect(screen.getByText(/Driver is recent — 20 days old\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
  });
});
