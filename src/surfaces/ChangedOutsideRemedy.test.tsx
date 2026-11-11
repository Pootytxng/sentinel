import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";
import { ChangedOutsideRemedy, isUnconfirmedRefusal } from "./ChangedOutsideRemedy";
import { LEDGER_CHANGED_EVENT } from "../types";

// CR-unconfirmed-remedy: the second choice beside "undo it" on the owner's Synez-shaped ledger.
const offersMock = vi.hoisted(() => ({
  value: [{ rec_id: "power-ultimate", rec_title: "Switch to the Ultimate Performance power plan", observed_name: "Synez Power Plan", rows: 2 }],
  record: (): Promise<unknown> => Promise.resolve(2),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "changed_outside_offers") return Promise.resolve(offersMock.value);
    if (cmd === "record_changed_outside") return offersMock.record();
    return Promise.resolve(null);
  }),
}));

const REFUSAL =
  "experiment not started — another setting Compy changed earlier can't be confirmed as still in place, so a test couldn't show that its result is this setting's alone — undo it in Test → Applied & history, then start the test again";

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
  offersMock.record = () => Promise.resolve(2);
  void i18n.changeLanguage("en");
});

describe("ChangedOutsideRemedy", () => {
  it("shows nothing and reads nothing for any other refusal", () => {
    const { container } = render(<ChangedOutsideRemedy reason="experiment not started — the baseline session is no longer in your session history" refresh={async () => {}} />);
    expect(container.textContent).toBe("");
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(isUnconfirmedRefusal(REFUSAL)).toBe(true);
  });

  it("says what Compy saw and that nothing on the PC changes, and records only on the tap", async () => {
    const refresh = vi.fn(async () => {});
    render(<ChangedOutsideRemedy reason={REFUSAL} refresh={refresh} />);
    const keep = await screen.findByRole("button", { name: 'Keep "Synez Power Plan"' });
    expect(screen.getByText(/the power plan active now is "Synez Power Plan", which Compy didn't set/)).toBeTruthy();
    expect(screen.getByText(/nothing on your PC will change/)).toBeTruthy();
    expect(screen.getByText(/Or undo Compy's change/)).toBeTruthy();
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).toEqual(["changed_outside_offers"]);

    fireEvent.click(keep);
    await screen.findByTestId("changed-outside-done");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("record_changed_outside", { recId: "power-ultimate" });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByTestId("changed-outside-done").textContent).toMatch(/Nothing on your PC changed/);
  });

  it("a refused record says so and changes nothing", async () => {
    offersMock.record = () => Promise.reject("Compy can't read which power plan is active right now");
    render(<ChangedOutsideRemedy reason={REFUSAL} refresh={async () => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: 'Keep "Synez Power Plan"' }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't record that, and nothing changed: Compy can't read/);
    await waitFor(() => expect(screen.queryByTestId("changed-outside-done")).toBeNull());
  });

  // CR-outside-followups (c): the plan switched again while the panel is open.
  it("re-reads its offer when the ledger changes or the window regains focus", async () => {
    const before = offersMock.value;
    try {
      render(<ChangedOutsideRemedy reason={REFUSAL} refresh={async () => {}} />);
      await screen.findByRole("button", { name: 'Keep "Synez Power Plan"' });
      offersMock.value = [{ ...before[0], observed_name: "Balanced" }];
      window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
      expect(await screen.findByRole("button", { name: 'Keep "Balanced"' })).toBeTruthy();
      expect(screen.queryByRole("button", { name: 'Keep "Synez Power Plan"' })).toBeNull();
      offersMock.value = [];
      window.dispatchEvent(new Event("focus"));
      await waitFor(() => expect(screen.queryByTestId("changed-outside")).toBeNull());
    } finally {
      offersMock.value = before;
    }
  });

  it("keeps the recorded line after a re-read no longer offers it", async () => {
    const before = offersMock.value;
    try {
      render(<ChangedOutsideRemedy reason={REFUSAL} refresh={async () => {}} />);
      const keep = await screen.findByRole("button", { name: 'Keep "Synez Power Plan"' });
      offersMock.value = [];
      fireEvent.click(keep);
      await screen.findByTestId("changed-outside-done");
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "changed_outside_offers").length).toBeGreaterThan(2),
      );
      expect(screen.getByTestId("changed-outside-done").textContent).toMatch(/Nothing on your PC changed/);
    } finally {
      offersMock.value = before;
    }
  });

  it("has the same words in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    render(<ChangedOutsideRemedy reason={REFUSAL} refresh={async () => {}} />);
    expect(await screen.findByRole("button", { name: "保留“Synez Power Plan”" })).toBeTruthy();
    expect(screen.getByText(/你的电脑上不会有任何改动/)).toBeTruthy();
  });
});
