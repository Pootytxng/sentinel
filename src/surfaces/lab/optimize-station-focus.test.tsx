// The Something's-wrong card asks the Lab's optimize station for its "turn it back on" control. The station mounts
// the real Fix and Check, with "More cleanup" folded (Expert view off), so these tests prove where focus really
// lands in that tree: on a shown control, with no preference stored, and never from a request left over.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const scan = vi.hoisted(() => ({ changes: [] as unknown[], limiters: [] as unknown[] }));

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
    if (cmd === "priorities_from" || cmd === "get_priorities")
      return Promise.resolve({ limiters: scan.limiters, already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null });
    if (cmd === "get_applied_changes") return Promise.resolve(scan.changes);
    if (cmd === "get_recommendations" || cmd === "get_nic_driver_info") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
const { invalidateProbe } = await import("../../data/probe-cache");
const { requestCheckFocus, checkFocusPending } = await import("../check-focus");
import type { LabFastPathProps } from "./OptimizeStation";

const drifted = {
  id: "c1",
  rec_id: "visual-effects",
  rec_title: "Trim Windows visual effects",
  applied_at: "2026-11-19T10:00:00Z",
  snapshot: null,
  status: "applied" as const,
  is_still_active: false,
};

const rec = {
  id: "visual-effects",
  title: "Trim Windows visual effects",
  category: "visuals",
  description: "desc",
  impact: "impact",
  downside: null,
  applies_to: "Windows",
  currently_applied: false,
  provenance: "expected-impact" as const,
  severity: "safe" as const,
  eligible: true,
};

const fast = (over: Partial<LabFastPathProps>): LabFastPathProps => ({
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
  ...over,
});

const mount = (over: Partial<LabFastPathProps>) =>
  render(
    <ConfirmProvider>
      <OptimizeStation {...fast(over)} />
    </ConfirmProvider>,
  );

const moreCleanup = () => screen.getByText("More cleanup (optional)").closest("details") as HTMLDetailsElement;

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateProbe();
  scan.changes = [];
  scan.limiters = [];
  // Each test asserts for itself that its request was taken or dropped; a request still pending would fail it.
  document.body.innerHTML = "";
});

describe("the turn-it-back-on focus request, in the real Lab optimize station", () => {
  it("lands on the switch of the turned-off-outside-Compy group at the top, which is shown, and leaves More cleanup folded", async () => {
    requestCheckFocus("applied-changes");
    mount({ recs: [rec], changes: [drifted] });
    const sw = await screen.findByRole("switch", { name: /Title|Trim Windows visual effects/ });
    await waitFor(() => expect(document.activeElement).toBe(sw));
    expect(sw.closest("details")).toBeNull();
    expect(moreCleanup().open).toBe(false);
    expect(checkFocusPending()).toBe(false);
    // The switch itself was only focused: nothing was applied by asking.
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("with the change not appliable here there is no switch and no row to focus: the request is dropped, focus stays put, More cleanup stays folded", async () => {
    // Under the station's Fix v2Ia the health check never renders the applied-changes row (Fix owns it), so when Fix
    // has no switch for the change there is nothing to focus and nothing to open.
    scan.changes = [drifted];
    scan.limiters = [{ id: "applied-changes", title: "Changes Compy applied", reason: "", linked: null, confidence: "medium", status: "attention" }];
    requestCheckFocus("applied-changes");
    mount({ recs: [rec], changes: [drifted], isAppliable: () => false });
    await screen.findByText(/All 1 checks/);
    await waitFor(() => expect(checkFocusPending()).toBe(false));
    expect(document.querySelector('[data-check-row="applied-changes"]')).toBeNull();
    expect(screen.queryByRole("switch", { name: /Trim Windows visual effects/ })).toBeNull();
    expect(moreCleanup().open).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(localStorage.length).toBe(0);
  });

  it("a request that finds neither is dropped, leaves More cleanup folded, and cannot steal focus on a later visit", async () => {
    requestCheckFocus("applied-changes");
    mount({});
    await screen.findByText(/All 1 checks/);
    await waitFor(() => expect(checkFocusPending()).toBe(false));
    expect(moreCleanup().open).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
