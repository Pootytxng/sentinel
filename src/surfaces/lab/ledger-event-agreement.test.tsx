// #619: the Test room's screens agree after a ledger write made inside the room.
//
// LabGround mounts the Optimize station and the experiment bench side by side. The bench reads the
// Trust Ledger once, then again only on window focus, visibilitychange or LEDGER_CHANGED_EVENT. A
// change applied from the station's Check fires none of the first two (the window never lost focus),
// so without the event the bench keeps offering a change that is already on. The station's telemetry
// disable also has to reach App's refresh, or App's `changes`/`recs` and the Machine Model stay stale.
//
// Nothing here reaches Windows: invoke is mocked and the "apply" only flips a flag in this file.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import type { LabFastPathProps } from "./OptimizeStation";

const backend = vi.hoisted(() => ({ applied: false, calls: [] as string[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    backend.calls.push(cmd);
    switch (cmd) {
      case "get_experiment_gate":
        return Promise.resolve(true);
      case "get_experiments":
      case "get_session_summaries":
      case "get_applied_changes":
      case "get_startup_entries":
        return Promise.resolve([]);
      case "get_recommendations":
        return Promise.resolve([
          {
            id: "rec-power",
            title: "High performance plan",
            eligible: true,
            currently_applied: backend.applied,
          },
        ]);
      case "get_game_readiness":
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
      case "get_priorities":
      case "priorities_from":
        return Promise.resolve({
          limiters: backend.applied
            ? []
            : [
                {
                  id: "power-plan",
                  title: "Power plan",
                  reason: "Balanced plan parks cores",
                  linked: "rec-power",
                  confidence: "high",
                  status: "attention",
                },
              ],
          already_fine: [],
          not_worth_touching: [],
          session_hint: null,
          upgrade_path: null,
        });
      case "get_ledger_health":
        return Promise.resolve({ complete: true, error: null, quarantined: false });
      case "apply_recommendation":
        backend.applied = true;
        return Promise.resolve({ id: "chg-1" });
      case "disable_known_bloat_task":
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  }),
}));

vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { default: ExperimentBench } = await import("../ExperimentBench");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");

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

const NOTHING_TO_TEST = /^No changes to test right now/;

// The same pairing LabGround renders: the station and the bench, in one window.
function mountRoom(onChanged: () => void) {
  return render(
    <ConfirmProvider>
      <OptimizeStation {...fast} onChanged={onChanged} />
      <ExperimentBench />
    </ConfirmProvider>,
  );
}

afterEach(() => {
  cleanup();
  backend.applied = false;
  backend.calls = [];
});

describe("Test room: a ledger write in the Optimize station reaches the rest of the room", () => {
  it("an apply from the station's Check makes the bench stop offering that change, without a refocus", async () => {
    const onChanged = vi.fn();
    mountRoom(onChanged);
    // The bench has read the ledger and offers the change.
    await screen.findByText("Pick a change to test");
    await waitFor(() => expect(screen.queryByText(NOTHING_TO_TEST)).toBeNull());

    fireEvent.click(await screen.findByRole("switch", { name: "Apply Power plan" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // No focus or visibility event fired: only the ledger announcement can make the bench re-read.
    expect(await screen.findByText(NOTHING_TO_TEST)).toBeInTheDocument();
  });

  it("a telemetry-task disable from the station runs App's refresh", async () => {
    const onChanged = vi.fn();
    mountRoom(onChanged);
    fireEvent.click(await screen.findByText("Telemetry tasks"));
    const disable = await screen.findAllByRole("button", { name: "Disable" });
    fireEvent.click(disable[0]);
    await screen.findByRole("button", { name: "Disabled · undo in History" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(backend.calls).toContain("disable_known_bloat_task");
  });
});
