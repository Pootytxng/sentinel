import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Boot theater pins (T2+T4a, spec 2026-07-06-firstcheck-monitor-mvp-train): flag-off renders the
// classic ScanStream row list (failsafe), flag-on (default) renders the HUD boot readout, a click
// skips straight to the verdict, and reduced motion bypasses the scramble (plain label).

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [
          { id: "a", label: "SSD check", status: "ready", detail: "", value: null },
          { id: "b", label: "Game Mode", status: "ready", detail: "", value: null },
          { id: "c", label: "Power plan", status: "attention", detail: "", value: null },
        ],
        ready_count: 2,
        attention_count: 1,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "get_recommendations") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import FirstCheck from "./FirstCheck";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const mount = () =>
  render(
    <ConfirmProvider>
      <FirstCheck onDone={vi.fn()} isAppliable={() => false} />
    </ConfirmProvider>,
  );

describe("FirstCheck boot theater (T2+T4a)", () => {
  it("default ON: the run state is the HUD readout, not the classic row list", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".fct-frame")).not.toBeNull());
    expect(container.querySelector(".fc-scan")).toBeNull();
    // Honest progress rail — mono counter over the real check count.
    await waitFor(() => expect(container.querySelector(".fct-rail-count")?.textContent).toMatch(/\/03$/));
  });

  it("flag OFF: the classic ScanStream renders byte-for-byte (failsafe)", async () => {
    localStorage.setItem("compy_firstcheck_theater", "0");
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".fc-scan")).not.toBeNull());
    expect(container.querySelector(".fct-frame")).toBeNull();
  });

  it("clicking the theater skips straight to the verdict", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".fct-active")).not.toBeNull());
    fireEvent.click(container.querySelector(".fct-frame")!);
    // Synchronous after the click — no waiting out the reveal timers.
    expect(screen.getByText(/Ready to play/)).toBeInTheDocument();
    // And the theater has resolved into the verdict (T1 law: never both).
    expect(container.querySelector(".fct-frame")).toBeNull();
  });

  it("reduced motion: the active check label renders plain (no scramble churn)", async () => {
    localStorage.setItem("compy_motion", "reduced");
    const { container } = mount();
    // Capture INSIDE the poll: the reveal advances at 200ms/row and resolves into the verdict,
    // so the active row can vanish between waitFor settling and a later read (observed flake).
    // The pin: whenever the active label was on screen, it was a PLAIN verbatim fixture string
    // (never scramble characters).
    let seen: string | null = null;
    await waitFor(() => {
      const el = container.querySelector(".fct-active-label");
      if (el?.textContent) seen = el.textContent;
      expect(seen).not.toBeNull();
    });
    expect(["SSD check", "Game Mode", "Power plan"]).toContain(seen);
  });
});
