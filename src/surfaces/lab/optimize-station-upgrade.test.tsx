// P9-upgrade-block-reachable (s22 finding): the shipped Optimize room composes Check with v2Ia, which
// suppresses Check's upgrade block (V2-4b: demoted content never leads the room) for a card OptimizeV2
// rendered below its action groups. OptimizeV2 was deleted with the dead room generations (1ab831fb,
// 2026-08-06) and no other room took the card, so the measured Phase 9 lines (the limiter, what it was
// measured from, the screen limit, what Compy can't check) never reached a user. The room renders it
// again, below its groups, labeled early, with no retail links (owner call; the default is none).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const scan = vi.hoisted(() => ({ upgrade: null as unknown }));

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
    if (cmd === "priorities_from")
      return Promise.resolve({
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: scan.upgrade,
      });
    if (cmd === "get_recommendations" || cmd === "get_applied_changes" || cmd === "get_nic_driver_info")
      return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
const { invalidateProbe } = await import("../../data/probe-cache");
import type { LabFastPathProps } from "./OptimizeStation";

const fast: LabFastPathProps = {
  recs: [],
  startup: [],
  changes: [],
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

const GPU_ROW = {
  kind: "gpu",
  title: "GPU was the measured limiter",
  why: "In your most recent monitored session the GPU sat at or above 95% for 80% of the time.",
  links: [{ retailer: "Amazon", url: "https://www.amazon.com/s?k=graphics+card" }],
  measured_from: { game: "ROB RUN.exe", started_at: "2026-11-11T20:36:00Z", busy: 720, readings: 900, threshold_pct: 95 },
};

const mount = () =>
  render(
    <ConfirmProvider>
      <OptimizeStation {...fast} />
    </ConfirmProvider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateProbe();
  scan.upgrade = null;
});

describe("P9-upgrade-block-reachable: the Optimize room shows the measured upgrade lines", () => {
  it("a GPU-limited scan renders the block below the groups, labeled early, with what it was measured from and no retail links", async () => {
    scan.upgrade = { items: [GPU_ROW], disclosure: "x" };
    mount();
    const block = await screen.findByTestId("check-upgrade");
    expect(block).toHaveAttribute("data-links", "off");
    // Exactly one copy: Check under "More cleanup" still suppresses its own (one-mention law).
    expect(screen.getAllByTestId("check-upgrade")).toHaveLength(1);
    // Below the groups, not folded inside the "More cleanup" disclosure.
    expect(block.closest("details")).toBeNull();
    expect(block).toHaveTextContent("Upgrade path (advisory)");
    expect(screen.getByTestId("check-upgrade-early")).toHaveTextContent("early — being developed");
    expect(block).toHaveTextContent("GPU was the measured limiter");
    expect(screen.getByTestId("check-upgrade-source").textContent).toMatch(
      /^Measured from your ROB RUN session on Nov 1[12](, 2026)?: 720 of 900 GPU readings were at 95% load or more\.$/,
    );
    expect(screen.getByTestId("check-upgrade-fit")).toHaveTextContent(/^Before any card: Compy can't read/);
    // No shopping: no copy buttons, no anchors, no money disclosure.
    expect(block.querySelectorAll("button, a")).toHaveLength(0);
    expect(block).not.toHaveTextContent(/Amazon|search link|earns nothing/);
  });

  it("a session that filled the screen names the screen, not the GPU", async () => {
    scan.upgrade = {
      items: [{ ...GPU_ROW, measured_from: { ...GPU_ROW.measured_from, avg_fps: 252, refresh_hz: 250 } }],
      disclosure: "x",
    };
    mount();
    await screen.findByTestId("check-upgrade");
    expect(screen.getByTestId("check-upgrade-screen")).toHaveTextContent("Your 250 Hz screen can't show more than 250 frames a second");
    expect(screen.queryByText("GPU was the measured limiter")).toBeNull();
    expect(screen.queryByTestId("check-upgrade-fit")).toBeNull();
  });

  it("an HDD install drive renders its row with what Compy can't check before any drive", async () => {
    scan.upgrade = {
      items: [{ kind: "ssd", title: "Games are on an HDD", why: "Your game install drive check found HDD storage.", links: GPU_ROW.links, measured_from: null }],
      disclosure: "x",
    };
    mount();
    const block = await screen.findByTestId("check-upgrade");
    expect(block).toHaveTextContent("Games are on an HDD");
    expect(screen.getByTestId("check-upgrade-fit")).toHaveTextContent(/^Before any drive: Compy can't read/);
    expect(screen.queryByTestId("check-upgrade-source")).toBeNull();
    expect(block.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("a re-run that measures no limiter takes the block away (never a stale limiter)", async () => {
    scan.upgrade = { items: [GPU_ROW], disclosure: "x" };
    mount();
    await screen.findByTestId("check-upgrade");
    scan.upgrade = null;
    fireEvent.click(screen.getByRole("button", { name: /re-run/i, hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("check-upgrade")).toBeNull());
  });

  it("an upgrade path with no rows renders no block in the room", async () => {
    scan.upgrade = { items: [], disclosure: "x" };
    mount();
    await screen.findByText(/All 1 checks/);
    expect(screen.queryByTestId("check-upgrade")).toBeNull();
  });

  it("no hardware limiter measured: no block at all", async () => {
    mount();
    await screen.findByText(/All 1 checks/);
    expect(screen.queryByTestId("check-upgrade")).toBeNull();
    expect(screen.queryByText("Upgrade path (advisory)")).toBeNull();
  });
});
