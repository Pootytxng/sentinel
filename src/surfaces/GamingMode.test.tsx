// bug→guard (owner-caught, 2026-07-07 case #4): a successful Gaming Mode restore showed
// NOTHING — he couldn't tell it worked. These pins make a silent restore success a red test:
// after Stop / recovery-restore confirms, a visible confirmation must render and NAME the
// restored changes (flags-name-it law — never a bare silent success).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("./library-context", () => ({ useLibrary: () => ({ openLibrary: () => {} }) }));

import { GamingMode } from "./GamingMode";
import { GAMING_SESSION_RESOLVED_EVENT, type GamingSessionFile } from "./gaming-mode";

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

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
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
    await screen.findByText("Gaming Mode didn't close cleanly");

    fireEvent(window, new Event(GAMING_SESSION_RESOLVED_EVENT));

    await waitFor(() =>
      expect(screen.queryByText("Gaming Mode didn't close cleanly")).toBeNull(),
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
