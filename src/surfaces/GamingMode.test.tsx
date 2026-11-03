// bug→guard (owner-caught, 2026-07-07 case #4): a successful Gaming Mode restore showed
// NOTHING — he couldn't tell it worked. These pins make a silent restore success a red test:
// after Stop / recovery-restore confirms, a visible confirmation must render and NAME the
// restored changes (flags-name-it law — never a bare silent success).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("./library-context", () => ({ useLibrary: () => ({ openLibrary: () => {} }) }));

import { GamingMode } from "./GamingMode";
import {
  GAMING_SESSION_RESOLVED_EVENT,
  GAMING_PANE_MOUNTED_EVENT,
  GAMING_PANE_UNMOUNTED_EVENT,
  type GamingSessionFile,
} from "./gaming-mode";

const session = (status: GamingSessionFile["status"]): GamingSessionFile => ({
  schema_version: 2,
  session_id: "gm-test",
  status,
  started_at: "2026-07-08T00:00:00Z",
  app_version: "test",
  changes: [
    { label: "Power plan → max performance", elevated_restore: false },
    { label: "USB selective suspend off (AC)", elevated_restore: true },
  ],
  started_monitoring: false,
});

// Sibling re-point (gaming-console default-ON, 2026-07-15): this suite pins the CLASSIC card —
// the default flipped, its subject didn't (same convention as monitor-v2.test.tsx). The console
// face's own guards live in gaming-console-flag.test.tsx.
beforeEach(() => localStorage.setItem("compy_gaming_console", "0"));

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  localStorage.clear();
});

describe("GamingMode restore-success confirmation", () => {
  it("Stop success renders a visible confirmation naming every restored change", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state") return Promise.resolve(session("active"));
      if (cmd === "gaming_session_is_live") return Promise.resolve(true); // this run's session → resume
      if (cmd === "stop_gaming_session") return Promise.resolve(null); // backend: every restore confirmed
      return Promise.resolve(null);
    });
    render(<GamingMode />);

    fireEvent.click(await screen.findByText("Stop Gaming Mode"));

    // The confirmation is a status region with the headline + the EXACT restored labels.
    await screen.findByText("Your settings are back");
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Restored 2 changes");
    expect(status.textContent).toContain("Power plan → max performance");
    expect(status.textContent).toContain("USB selective suspend off (AC)");

    // Dismissible — and gone once dismissed.
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByText("Your settings are back")).toBeNull();
  });

  it("recovery 'Return to normal' success renders the same confirmation", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state")
        return Promise.resolve(session("restore-pending")); // interrupted → recovery card
      if (cmd === "recover_gaming_session") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(<GamingMode />);

    // "Return to normal" also appears in the explainer list — target the button.
    fireEvent.click(await screen.findByRole("button", { name: "Return to normal" }));

    await screen.findByText("Your settings are back");
    expect(screen.getByRole("status").textContent).toContain("USB selective suspend off (AC)");
  });

  // bug→guard (self-review catch 2026-07-08): the App banner and this pane detect orphans
  // independently — resolving on one must clear the other, or the stale prompt fires a
  // second recover against the cleared contract and shows a FALSE failure.
  it("a sibling surface resolving the session clears the stale recovery prompt", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state") return Promise.resolve(session("restore-pending"));
      return Promise.resolve(null);
    });
    render(<GamingMode />);
    // Protection-first head (consumer-panel Q4 reframe, 2026-07-11).
    await screen.findByText("Finish the last Gaming Mode session");

    fireEvent(window, new Event(GAMING_SESSION_RESOLVED_EVENT));

    await waitFor(() =>
      expect(screen.queryByText("Finish the last Gaming Mode session")).toBeNull(),
    );
  });

  it("Stop broadcasts the resolved event so the global banner drops its stale prompt", async () => {
    const seen = vi.fn();
    window.addEventListener(GAMING_SESSION_RESOLVED_EVENT, seen);
    try {
      invokeMock.mockImplementation((cmd) => {
        if (cmd === "get_gaming_session_state") return Promise.resolve(session("active"));
        if (cmd === "gaming_session_is_live") return Promise.resolve(true);
        if (cmd === "stop_gaming_session") return Promise.resolve(null);
        return Promise.resolve(null);
      });
      render(<GamingMode />);
      fireEvent.click(await screen.findByText("Stop Gaming Mode"));
      await screen.findByText("Your settings are back");
      expect(seen).toHaveBeenCalled();
    } finally {
      window.removeEventListener(GAMING_SESSION_RESOLVED_EVENT, seen);
    }
  });

  it("a FAILED stop shows the honest error and NO success confirmation", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state") return Promise.resolve(session("active"));
      if (cmd === "gaming_session_is_live") return Promise.resolve(true);
      if (cmd === "stop_gaming_session")
        return Promise.reject(new Error("USB selective suspend off (AC): declined"));
      return Promise.resolve(null);
    });
    render(<GamingMode />);

    fireEvent.click(await screen.findByText("Stop Gaming Mode"));

    await waitFor(() =>
      expect(screen.getByText(/Couldn't fully restore your settings/).textContent).toBeTruthy(),
    );
    expect(screen.queryByText("Your settings are back")).toBeNull();
  });
});

// bug→guard (T6c, 2026-07-10): the App-level banners defer to the pane only while one is
// ACTUALLY mounted — that contract depends on the pane announcing itself. If these events
// stop firing, the global banner either duplicates the pane's card or (worse) a pending
// recovery goes invisible on the Lab again.
describe("GamingMode announces mount/unmount to the App-level banner gate", () => {
  it("dispatches MOUNTED on mount and UNMOUNTED on unmount, symmetrically", async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    window.addEventListener(GAMING_PANE_MOUNTED_EVENT, mounted);
    window.addEventListener(GAMING_PANE_UNMOUNTED_EVENT, unmounted);
    try {
      invokeMock.mockImplementation(() => Promise.resolve(null));
      const { unmount } = render(<GamingMode />);
      expect(mounted).toHaveBeenCalledTimes(1);
      expect(unmounted).not.toHaveBeenCalled();
      unmount();
      expect(unmounted).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(GAMING_PANE_MOUNTED_EVENT, mounted);
      window.removeEventListener(GAMING_PANE_UNMOUNTED_EVENT, unmounted);
    }
  });
});

// bug→guard (T6c, 2026-07-10): the pane's "Resume Gaming Mode" must restart with the
// interrupted session's OWN tiers, derived from its recorded changes — the advanced
// checkboxes reset to core-only on remount, so reading them silently downgraded the
// resumed session (USB/PCIe/service suspensions quietly dropped).
describe("GamingMode resume restarts with the interrupted session's own tiers", () => {
  it("recover leg confirms first, then start carries the tiers derived from the contract", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    invokeMock.mockImplementation((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "get_gaming_session_state")
        return Promise.resolve({
          ...session("restore-pending"),
          changes: [
            { label: "Power plan → max performance", elevated_restore: false },
            { label: "USB selective suspend off (AC)", elevated_restore: true },
            { label: "Suspend WSearch for this session", elevated_restore: true },
          ],
        });
      if (cmd === "start_gaming_session") return Promise.resolve(session("active"));
      return Promise.resolve(null);
    });
    render(<GamingMode />);

    fireEvent.click(await screen.findByRole("button", { name: "Resume Gaming Mode" }));

    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "start_gaming_session")).toBe(true),
    );
    const recoverAt = calls.findIndex((c) => c.cmd === "recover_gaming_session");
    const startAt = calls.findIndex((c) => c.cmd === "start_gaming_session");
    expect(recoverAt).toBeGreaterThanOrEqual(0); // rollback-first: restore precedes the restart
    expect(recoverAt).toBeLessThan(startAt);
    expect(calls[startAt].args).toEqual({
      opts: { advancedUsb: true, advancedPcie: false, suspendServices: ["WSearch"] },
    });
  });
});

// Codebase review 2026-11-03: a failed start whose own undo also failed leaves a restore-failed
// contract on disk; the pane showed only "…Try again" and stayed on "Standing by", and "Not now"
// dropped the only way back to a contract that was still on disk.
describe("GamingMode never stands by over a contract still on disk", () => {
  it("a start that fails AND leaves a contract routes to recovery with the may-still-be-changed line", async () => {
    let started = false;
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state")
        return Promise.resolve(started ? session("restore-failed") : null);
      if (cmd === "start_gaming_session") {
        started = true;
        return Promise.reject(new Error("power plan: declined — and undoing the partial session also failed"));
      }
      return Promise.resolve(null);
    });
    localStorage.setItem("compy_gaming_consent_v1", "1");
    render(<GamingMode />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Gaming Mode" }));

    expect(await screen.findByText(/some of its changes may still be on this PC/)).toBeTruthy();
    expect(screen.getByText("Finish the last Gaming Mode session")).toBeTruthy();
    expect(screen.queryByText(/it may need an admin OK/)).toBeNull();
    // Starting again would only refuse "recover it first" — the control is shut until it's finished.
    expect((screen.getByRole("button", { name: "Start Gaming Mode" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a start that fails with nothing left on disk keeps the plain try-again", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "start_gaming_session") return Promise.reject(new Error("UAC cancelled"));
      return Promise.resolve(null);
    });
    localStorage.setItem("compy_gaming_consent_v1", "1");
    render(<GamingMode />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Gaming Mode" }));

    expect(await screen.findByText(/it may need an admin OK/)).toBeTruthy();
    expect(screen.queryByText("Finish the last Gaming Mode session")).toBeNull();
  });

  it("a resume whose start leg fails over a fresh contract shows that contract, not standing by", async () => {
    let restored = false;
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state")
        return Promise.resolve(restored ? session("restore-failed") : session("restore-pending"));
      if (cmd === "recover_gaming_session") {
        restored = true;
        return Promise.resolve(null);
      }
      if (cmd === "start_gaming_session") return Promise.reject(new Error("undo also failed"));
      return Promise.resolve(null);
    });
    render(<GamingMode />);

    fireEvent.click(await screen.findByRole("button", { name: "Resume Gaming Mode" }));

    expect(await screen.findByText(/some of its changes may still be on this PC/)).toBeTruthy();
    expect(screen.getByText("Finish the last Gaming Mode session")).toBeTruthy();
  });

  it("Not now folds the card into a row that reopens it, and Start stays shut meanwhile", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_gaming_session_state" ? Promise.resolve(session("restore-pending")) : Promise.resolve(null),
    );
    render(<GamingMode />);

    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));

    expect(screen.queryByText("Finish the last Gaming Mode session")).toBeNull();
    expect(screen.getByText(/still has changes on this PC — finish it before starting a new one/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start Gaming Mode" }) as HTMLButtonElement).disabled).toBe(true);
    // No IPC behind "Not now": the backend's recover(false) is a no-op that leaves the contract.
    expect(invokeMock.mock.calls.some(([c]) => c === "recover_gaming_session")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Finish the last Gaming Mode session")).toBeTruthy();
  });
});
