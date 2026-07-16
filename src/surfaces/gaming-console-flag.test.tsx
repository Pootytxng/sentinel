import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Guards for the Gaming Mode console flag (console-HUD direction §Gaming Mode, 2026-07-15).
// compy_gaming_console is DEFAULT ON per the graduated-flag convention: key absent or "1"
// renders the arm/engage console (`.gc-pane`), byte-identical; the classic card stays
// reachable ONLY behind the literal "0" devtools failsafe. The console is presentation
// only — both faces share every hook/handler (same audited session commands), and the
// first-use consent modal is ONE tree: the console's Engage must hit the same consent
// gate before start_gaming_session can fire. Sibling re-point (same commit):
// GamingMode.test.tsx now sets the key to "0" so it keeps pinning the CLASSIC card it
// always did — the default flipped, its subject didn't.

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("./library-context", () => ({ useLibrary: () => ({ openLibrary: () => {} }) }));

import { GamingMode } from "./GamingMode";
import type { GamingSessionFile } from "./gaming-mode";

const activeSession: GamingSessionFile = {
  schema_version: 2,
  session_id: "gc-test",
  status: "active",
  started_at: "2026-07-15T00:00:00Z",
  app_version: "test",
  changes: [
    { label: "Power plan → max performance", elevated_restore: false },
    { label: "USB selective suspend off (AC)", elevated_restore: true },
  ],
  started_monitoring: false,
};

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  localStorage.clear();
});

const mountIdle = () => {
  invokeMock.mockImplementation(() => Promise.resolve(null));
  return render(<GamingMode />);
};

describe("Gaming console DEFAULT ON — absent renders the console face; '0' is the classic failsafe", () => {
  it("key absent renders the console face, byte-identical to key '1'", async () => {
    const first = mountIdle();
    await screen.findByRole("button", { name: "Engage Gaming Mode" });
    const absent = first.container.innerHTML;
    expect(absent).toContain("gc-pane");
    expect(absent).not.toContain("Start Gaming Mode");
    cleanup();
    localStorage.setItem("compy_gaming_console", "1");
    const second = mountIdle();
    await screen.findByRole("button", { name: "Engage Gaming Mode" });
    expect(second.container.innerHTML).toBe(absent);
  });

  it("title-header law: no standing explainer lede — the promise is a collapsed disclosure on the engage control", async () => {
    const { container } = mountIdle();
    await screen.findByRole("button", { name: "Engage Gaming Mode" });
    // The header zone carries the title + status strip ONLY (self-review 2026-07-15).
    expect(container.querySelector(".gc-pane .section-help")).toBeNull();
    const what = container.querySelector("details.gc-what");
    expect(what).toBeTruthy();
    expect(what?.hasAttribute("open")).toBe(false); // collapsed by default
    expect(what?.textContent).toContain("already-audited, fully reversible");
  });

  it("classic failsafe ('0'): the literal '0' renders today's classic card, no console classes", async () => {
    localStorage.setItem("compy_gaming_console", "0");
    const { container } = mountIdle();
    await screen.findByRole("button", { name: "Start Gaming Mode" });
    expect(container.querySelector(".gc-pane")).toBeNull();
    expect(container.innerHTML).not.toContain("gc-engage");
  });
});

describe("Gaming console is presentation only — same consent gate, same audited contract", () => {
  it("first-use Engage opens the SAME consent modal and does NOT start the session", async () => {
    mountIdle();
    fireEvent.click(await screen.findByRole("button", { name: "Engage Gaming Mode" }));
    await screen.findByRole("dialog", { name: "Turn on Gaming Mode?" });
    expect(invokeMock).not.toHaveBeenCalledWith("start_gaming_session", expect.anything());
  });

  it("engaged: the live contract names the backend session's REAL changes + one disengage control", async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "get_gaming_session_state") return Promise.resolve(activeSession);
      if (cmd === "gaming_session_is_live") return Promise.resolve(true); // this run's session → resume
      return Promise.resolve(null);
    });
    render(<GamingMode />);
    const disengage = await screen.findByRole("button", {
      name: /Disengage — restore my settings/,
    });
    expect(disengage.className).toContain("gc-engage-on");
    expect(screen.getByText("Session contract — live")).toBeTruthy();
    expect(screen.getByText("Power plan → max performance")).toBeTruthy();
    // The elevated change carries its honest admin-to-restore marker (flags-name-it law).
    expect(screen.getByText(/USB selective suspend off \(AC\)/).textContent).toContain(
      "needs admin to restore",
    );
  });
});
